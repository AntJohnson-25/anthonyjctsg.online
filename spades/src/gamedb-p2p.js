// GameDB peer to peer — multiplayer with no game server.
//
// The host player's browser holds the database and runs the hub (gamedb-hub.js). Friends
// connect straight to it over WebRTC data channels. Nothing of yours is hosted anywhere.
//
// Two browsers need a way to find each other first (the "handshake"). Two ways are built in:
//   1. Room code  — one click. The handshake goes through free public message relays (MQTT
//      brokers that anyone may use). They carry a few sealed lines for about a second and are
//      not used after that. Several are tried at once, so one being down does not matter.
//   2. Invite text — depends on nothing. The host copies an invite to a friend (any chat app),
//      the friend's game answers with a reply text, the host pastes it in. Clunkier, always there.
// Two tabs on the same computer also find each other directly (handy for trying things out).
//
//   // host                                         // friend
//   const host = await hostRoom({ app: 'spades',    const { client, room } = await joinRoom({
//     db, kit, modes, mode: 'spades' });               app: 'spades', code: 'K7QM2P' });
//   host.code  -> 'K7QM2P'   host.client -> a GameClient, same as the friend's
//
// What it cannot do: about one connection in ten fails on strict networks (some mobile
// carriers and office wifi) because there is no relay server to carry the game itself.
// Zero dependencies.
import { createHub, sha256, utf8, toHex, randomBytes, randomCode } from './gamedb-hub.js';
import { GameClient, GameClientError } from './gamedb-client.js';

/** Free public MQTT-over-WebSocket brokers used only for the handshake. Replace with your own list if you like. */
export const DEFAULT_RELAYS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
/** Free public STUN servers: they tell a browser its own public address, nothing else. */
export const DEFAULT_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];

const dec = new TextDecoder();
const err = (code, msg) => new GameClientError(code, msg);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Set globalThis.GAMEDB_DEBUG = true (browser console) to see each step of a handshake.
const trace = (...a) => { if (globalThis.GAMEDB_DEBUG) console.log('[gamedb-p2p]', ...a); };
function concat(parts) { let n = 0; for (const p of parts) n += p.length; const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
function b64(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64(text) { return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); }

// ───────────────────────── sealing the handshake ─────────────────────────
// The relays are public, and a handshake holds network addresses. So every line is encrypted
// and signed with keys made from the room code, and the relay topic is made from the code too:
// only someone who was given the code can find the room or read its handshake.
// (SHA-256 in counter mode + HMAC-SHA-256, pure JS so it also works on plain http pages.)

function hmac(key, msg) {
  const k = new Uint8Array(64); k.set(key.length > 64 ? sha256(key) : key);
  const ipad = k.map(b => b ^ 0x36), opad = k.map(b => b ^ 0x5c);
  return sha256(concat([opad, sha256(concat([ipad, msg]))]));
}
function keystream(key, nonce, n) {
  const out = new Uint8Array(n), ctr = new Uint8Array(4);
  for (let o = 0, i = 0; o < n; o += 32, i++) { new DataView(ctr.buffer).setUint32(0, i); out.set(sha256(concat([key, nonce, ctr])).subarray(0, Math.min(32, n - o)), o); }
  return out;
}
/** The relay topic and keys for a room code. */
export function roomKeys(app, code) {
  let k = sha256(utf8(`gamedb-p2p|${app}|${String(code).toUpperCase()}`));
  for (let i = 0; i < 2000; i++) k = sha256(k); // slows down guessing codes
  const part = label => sha256(concat([utf8(label), k]));
  return { topic: 'gdb/' + toHex(part('topic')).slice(0, 32), enc: part('enc'), mac: part('mac') };
}
export function seal(keys, value) {
  const pt = utf8(JSON.stringify(value)), nonce = randomBytes(12), ks = keystream(keys.enc, nonce, pt.length);
  const ct = pt.map((b, i) => b ^ ks[i]);
  return b64(concat([nonce, hmac(keys.mac, concat([nonce, ct])).subarray(0, 16), ct]));
}
export function unseal(keys, text) {
  try {
    const raw = unb64(text); if (raw.length < 29) return null;
    const nonce = raw.subarray(0, 12), tag = raw.subarray(12, 28), ct = raw.subarray(28);
    const want = hmac(keys.mac, concat([nonce, ct])); let d = 0; for (let i = 0; i < 16; i++) d |= want[i] ^ tag[i];
    if (d) return null;
    const ks = keystream(keys.enc, nonce, ct.length);
    return JSON.parse(dec.decode(ct.map((b, i) => b ^ ks[i])));
  } catch { return null; }
}

// ───────────────────────── a very small MQTT client ─────────────────────────
// Just enough of MQTT 3.1.1 to pass short messages through a public broker:
// connect, subscribe, publish (no delivery guarantees), keep-alive pings.

function mqttOpen(url, { onMessage, onClose, WS = globalThis.WebSocket, timeoutMs = 7000 }) {
  return new Promise((res, rej) => {
    let ws; try { ws = new WS(url, 'mqtt'); } catch (e) { rej(e); return; }
    ws.binaryType = 'arraybuffer';
    let buf = new Uint8Array(0), up = false, done = false, ping = null, pid = 0;
    const stop = why => {
      if (done) return; done = true; clearTimeout(timer); clearInterval(ping);
      try { ws.close(); } catch { /* already closed */ }
      if (up) { if (onClose) onClose(); } else rej(why instanceof Error ? why : new Error(String(why)));
    };
    const timer = setTimeout(() => stop('timed out'), timeoutMs);
    const str = s => { const b = utf8(s); return concat([Uint8Array.of(b.length >> 8, b.length & 255), b]); };
    const packet = (first, parts) => {
      const body = concat(parts), head = [first]; let n = body.length;
      do { let d = n % 128; n = Math.floor(n / 128); if (n) d |= 128; head.push(d); } while (n);
      return concat([Uint8Array.from(head), body]);
    };
    const send = bytes => { if (!done && ws.readyState === 1) ws.send(bytes); };
    const api = {
      url,
      subscribe: topic => send(packet(0x82, [Uint8Array.of(++pid >> 8, pid & 255), str(topic), Uint8Array.of(0)])),
      publish: (topic, text) => send(packet(0x30, [str(topic), utf8(text)])),
      close: () => { onClose = null; stop('closed'); },
    };
    ws.onopen = () => send(packet(0x10, [str('MQTT'), Uint8Array.of(4, 2, 0, 60), str('gdb' + toHex(randomBytes(8)))]));
    ws.onerror = () => stop('could not connect');
    ws.onclose = () => stop('closed');
    ws.onmessage = ev => {
      if (typeof ev.data === 'string') return;
      buf = concat([buf, new Uint8Array(ev.data)]);
      if (buf.length > 1048576) return stop('too much data');
      for (;;) {
        if (buf.length < 2) return;
        let len = 0, mul = 1, i = 1, b;
        do { if (i >= buf.length) return; if (i > 4) return stop('bad packet'); b = buf[i++]; len += (b & 127) * mul; mul *= 128; } while (b & 128);
        if (buf.length < i + len) return;
        const first = buf[0], body = buf.slice(i, i + len); buf = buf.slice(i + len);
        const type = first >> 4;
        if (type === 2) { // connection accepted (or not)
          if (body[1] !== 0) return stop('refused');
          up = true; clearTimeout(timer);
          ping = setInterval(() => send(Uint8Array.of(0xc0, 0)), 25000); if (ping.unref) ping.unref();
          res(api);
        } else if (type === 3 && body.length >= 2) { // a message
          const tl = (body[0] << 8) | body[1], off = 2 + tl + ((first >> 1) & 3 ? 2 : 0);
          if (off <= body.length) { try { onMessage(dec.decode(body.subarray(2, 2 + tl)), dec.decode(body.subarray(off))); } catch (e) { console.error(e); } }
        }
      }
    };
  });
}

// ───────────────────────── the meeting point ─────────────────────────
// One "bus" = every relay we could reach, plus a same-computer channel between browser tabs.
// A message is published on all of them; the first copy to arrive wins and the rest are dropped.

/**
 * Open a bus. onMessage(topic, text) is called once per distinct message.
 * Returns { publish, subscribe, close, relaysUp(), settled } — `settled` resolves with the number
 * of relays that connected, once every relay has either connected or failed.
 */
export function openBus({ relays = DEFAULT_RELAYS, WS = globalThis.WebSocket, onMessage, local = true, log = () => {} }) {
  const links = new Set(), topics = new Set(), seen = new Set(), order = [];
  let closed = false, bc = null;
  const got = (topic, text) => {
    if (closed || seen.has(text)) return;
    seen.add(text); order.push(text); if (order.length > 400) seen.delete(order.shift());
    onMessage(topic, text);
  };
  if (local && typeof BroadcastChannel !== 'undefined') {
    try { bc = new BroadcastChannel('gamedb-p2p'); bc.onmessage = ev => { const m = ev.data; if (m && topics.has(m.t) && typeof m.x === 'string') got(m.t, m.x); }; if (bc.unref) bc.unref(); } catch { bc = null; }
  }
  const dial = url => mqttOpen(url, { WS, onMessage: got, onClose: () => { links.forEach(l => { if (l.url === url) links.delete(l); }); if (!closed) setTimeout(() => { if (!closed) dial(url).catch(() => {}); }, 5000); } })
    .then(link => { if (closed) { link.close(); return false; } links.add(link); for (const t of topics) link.subscribe(t); return true; });
  const tries = WS ? relays.map(url => dial(url).catch(e => { log('gamedb-p2p: relay unavailable', url, e && e.message); return false; })) : [];
  return {
    publish(topic, text) { for (const l of links) l.publish(topic, text); if (bc) bc.postMessage({ t: topic, x: text }); },
    subscribe(topic) { topics.add(topic); for (const l of links) l.subscribe(topic); },
    relaysUp: () => links.size,
    settled: Promise.all(tries).then(r => r.filter(Boolean).length),
    close() { closed = true; for (const l of links) l.close(); links.clear(); if (bc) { try { bc.close(); } catch { /* closed */ } } },
  };
}
/** A bus that lives inside one page or process: for tests and same-page demos. const net = memoryBus(); pass `bus: net` to hostRoom and joinRoom. */
export function memoryBus() {
  const subs = new Set();
  return ({ onMessage }) => {
    const me = { topics: new Set(), onMessage }; subs.add(me);
    return {
      publish(topic, text) { for (const s of subs) if (s !== me && s.topics.has(topic)) setTimeout(() => { if (subs.has(s)) s.onMessage(topic, text); }, 0); },
      subscribe(topic) { me.topics.add(topic); }, relaysUp: () => 1, settled: Promise.resolve(1), close() { subs.delete(me); },
    };
  };
}

// ───────────────────────── WebRTC plumbing ─────────────────────────

const MAX_MSG = 256 * 1024, CHUNK = 4000;

// Wait until the browser has finished listing the addresses it can be reached at (or long enough).
async function finishedSdp(pc, waitMs = 2500) {
  if (pc.iceGatheringState !== 'complete') {
    await new Promise(res => {
      const t = setTimeout(res, waitMs);
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
    });
  }
  return pc.localDescription.sdp;
}
// A data channel as a simple text link: { send(text), close(), readyState, onmessage(text), onclose() }.
// Long messages are sent in pieces (browsers disagree on the largest single message).
function channelLink(pc, ch) {
  const link = { readyState: 1, onmessage: null, onclose: null, pc };
  let parts = '', ended = false, drop = null;
  const end = () => {
    if (ended) return; ended = true; link.readyState = 3; clearTimeout(drop);
    try { ch.close(); } catch { /* closed */ } try { pc.close(); } catch { /* closed */ }
    if (link.onclose) link.onclose();
  };
  ch.onmessage = ev => {
    const d = ev.data; if (typeof d !== 'string' || !d) return;
    if (d[0] === '1') { parts += d.slice(1); if (parts.length > MAX_MSG) end(); return; }
    const text = parts + d.slice(1); parts = '';
    if (link.onmessage) link.onmessage(text);
  };
  ch.onclose = end;
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === 'failed' || s === 'closed') end();
    else if (s === 'disconnected') { clearTimeout(drop); drop = setTimeout(end, 6000); }
    else if (s === 'connected') clearTimeout(drop);
  };
  link.send = text => {
    if (ended || ch.readyState !== 'open') return;
    let i = 0;
    while (text.length - i > CHUNK) {
      let j = i + CHUNK; const c = text.charCodeAt(j); if (c >= 0xdc00 && c <= 0xdfff) j--; // keep character pairs whole
      ch.send('1' + text.slice(i, j)); i = j;
    }
    ch.send('0' + text.slice(i));
  };
  link.close = end;
  return link;
}
// The link shape GameClient expects (onmessage gets { data }).
function clientLink(link) {
  const c = { get readyState() { return link.readyState; }, send: t => link.send(t), close: () => link.close(), onmessage: null, onclose: null };
  link.onmessage = text => { if (c.onmessage) c.onmessage({ data: text }); };
  link.onclose = () => { if (c.onclose) c.onclose(); };
  return c;
}
function whenOpen(ch, ms, onTimeout) {
  return new Promise((res, rej) => {
    if (ch.readyState === 'open') return res();
    const t = setTimeout(() => rej(onTimeout()), ms);
    ch.onopen = () => { clearTimeout(t); res(); };
  });
}
// Invite and reply texts: the handshake, squeezed and made safe to paste.
async function pack(value) {
  const text = JSON.stringify(value);
  if (typeof CompressionStream === 'undefined') return 'G0' + b64(utf8(text));
  const out = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return 'G1' + b64(new Uint8Array(await new Response(out).arrayBuffer()));
}
async function unpack(text) {
  try {
    text = String(text || '').trim().replace(/\s+/g, '');
    const kind = text.slice(0, 2), raw = unb64(text.slice(2));
    if (kind === 'G0') return JSON.parse(dec.decode(raw));
    if (kind !== 'G1') return null;
    const out = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return JSON.parse(await new Response(out).text());
  } catch { return null; }
}

// ───────────────────────── hosting ─────────────────────────

/**
 * Open a room on this device. This browser becomes the database and the referee.
 *   app            a short name for your game; rooms of different games never meet
 *   db, kit        an open GameDB and its GameKit (keep them on storage and friends boards survive a reload)
 *   modes, actions, clientBoards, maxMessagesPerSecond   as for the hub (gamedb-hub.js)
 *   mode           create a room of this mode straight away (its code is the code friends type)
 *   roomOptions    extra createRoom options ({ maxPlayers, options })
 *   code           reuse a code (to reopen a room after a reload); default: a fresh 6-character code
 *   name, store, profile   as for GameClient (the host is a player too)
 *   relays, iceServers     replace the public defaults; relays: [] turns the room-code handshake off
 * Resolves with:
 *   code      the room code to give to friends
 *   client    the host's own GameClient (already connected; the same API friends get)
 *   room      the room snapshot (when `mode` was given)
 *   hub       the hub, for server-side calls
 *   ready     a promise: how many relays are carrying the room code (0 = use invite texts)
 *   invite()            make an invite text for ONE friend (the no-relay handshake)
 *   accept(replyText)   finish that handshake with the reply text the friend sent back
 *   on('guest', fn)     a friend's link opened;  close()  shut the room
 */
export async function hostRoom({ app, db, kit, modes = {}, actions = {}, clientBoards = [], mode = null, roomOptions = {}, code = randomCode(6), name = null, store, profile = '', relays = DEFAULT_RELAYS, iceServers = DEFAULT_ICE, bus: busFactory = null, RTC = globalThis.RTCPeerConnection, WS = globalThis.WebSocket, log = console.log, maxMessagesPerSecond = 60 }) {
  if (!app) throw err('BAD_INPUT', 'hostRoom needs an app name');
  code = String(code).toUpperCase();
  const hub = createHub({ db, kit, modes, actions, clientBoards, openSignup: true, roomCodes: true, log, maxMessagesPerSecond });
  // No link outlives the host's page, so rooms left in a stored database by an earlier visit are dead.
  db.transaction(() => { db.run('DELETE FROM gk_room_players'); db.run('DELETE FROM gk_rooms'); });
  const keys = roomKeys(app, code), peers = new Map(), invites = new Map(), handlers = new Map();
  let closed = false;
  const emit = (ev, a) => { for (const fn of handlers.get(ev) || []) { try { fn(a); } catch (e) { console.error(e); } } };
  const plug = (pc, ch, id) => { const link = channelLink(pc, ch); hub.connect(link); emit('guest', { id }); return link; };

  // The host's own link to the hub: no network, just two ends in memory.
  const loopback = () => {
    let open = true;
    const hubEnd = { onmessage: null, onclose: null, send: t => { queueMicrotask(() => { if (open && end.onmessage) end.onmessage({ data: t }); }); }, close: () => shut() };
    const end = { readyState: 1, onmessage: null, onclose: null, send: t => { queueMicrotask(() => { if (open && hubEnd.onmessage) hubEnd.onmessage(t); }); }, close: () => shut() };
    function shut() { if (!open) return; open = false; end.readyState = 3; if (hubEnd.onclose) hubEnd.onclose(); if (end.onclose) end.onclose(); }
    hub.connect(hubEnd, { trusted: true });
    return end;
  };
  const client = new GameClient('p2p:' + code, { transport: loopback, ownIdentity: true, reconnect: false, name, store, profile });
  await client.connect();
  const room = mode ? await client.createRoom(mode, { private: true, ...roomOptions, code }) : null;

  // Room-code handshake: friends post an offer on the room's topic; we post the answer back.
  const bus = (busFactory || (o => openBus({ relays, WS, ...o })))({ onMessage: (topic, text) => { const m = unseal(keys, text); if (m && m.t === 'o') offer(m).catch(e => log('gamedb-p2p: could not answer a friend', e)); }, log });
  bus.subscribe(keys.topic + '/h');
  async function offer(m) {
    if (closed || !RTC || typeof m.p !== 'string' || m.p.length > 40 || !Number.isInteger(m.n) || typeof m.sdp !== 'string' || m.sdp.length > 20000) return;
    let p = peers.get(m.p);
    if (p && p.n === m.n) { if (p.answer) bus.publish(keys.topic + '/g/' + m.p, p.answer); return; } // they did not hear us: say it again
    if (p && p.n > m.n) return;
    if (p) p.drop(); else if (peers.size >= 32) return;
    const pc = new RTC({ iceServers });
    p = { n: m.n, pc, answer: null, link: null, drop: () => { clearTimeout(p.timer); if (p.link) p.link.close(); else { try { pc.close(); } catch { /* closed */ } } } };
    p.timer = setTimeout(() => { if (!p.link && peers.get(m.p) === p) { peers.delete(m.p); p.drop(); } }, 45000); // never connected
    peers.set(m.p, p);
    pc.ondatachannel = ev => {
      const ch = ev.channel, go = () => { if (closed || peers.get(m.p) !== p) return; trace('host: link open with', m.p); p.link = plug(pc, ch, m.p); const was = p.link.onclose; p.link.onclose = () => { if (peers.get(m.p) === p) peers.delete(m.p); if (was) was(); }; };
      if (ch.readyState === 'open') go(); else ch.onopen = go;
    };
    trace('host: offer from', m.p, 'attempt', m.n);
    await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    const sdp = await finishedSdp(pc);
    if (closed || peers.get(m.p) !== p) return;
    trace('host: answer sent to', m.p);
    p.answer = seal(keys, { t: 'a', p: m.p, n: m.n, sdp });
    bus.publish(keys.topic + '/g/' + m.p, p.answer);
  }

  const host = {
    code, hub, client, room, db, kit,
    ready: bus.settled,
    relaysUp: () => bus.relaysUp(),
    on(ev, fn) { if (!handlers.has(ev)) handlers.set(ev, new Set()); handlers.get(ev).add(fn); return () => handlers.get(ev).delete(fn); },
    /** Make an invite text for one friend. Send it to them; they send a reply text back for accept(). */
    async invite() {
      if (!RTC) throw err('NO_WEBRTC', 'this browser cannot connect peer to peer');
      const pc = new RTC({ iceServers }), ch = pc.createDataChannel('gamedb'), id = randomCode(4);
      const inv = { pc, ch, timer: setTimeout(() => { if (invites.get(id) === inv) { invites.delete(id); try { pc.close(); } catch { /* closed */ } } }, 900000) }; // 15 minutes to answer
      invites.set(id, inv);
      ch.onopen = () => { clearTimeout(inv.timer); invites.delete(id); if (!closed) plug(pc, ch, 'invite-' + id); };
      await pc.setLocalDescription(await pc.createOffer());
      return pack({ i: id, c: code, a: app, s: await finishedSdp(pc) });
    },
    /** Finish an invite with the reply text the friend sent back. */
    async accept(replyText) {
      const r = await unpack(replyText), inv = r && invites.get(r.i);
      if (!r || typeof r.s !== 'string') throw err('BAD_REPLY', 'That is not a reply text. Ask your friend to copy all of it.');
      if (!inv) throw err('BAD_REPLY', 'That reply is for an invite that is no longer open. Make a new invite.');
      await inv.pc.setRemoteDescription({ type: 'answer', sdp: r.s });
      return true;
    },
    close() {
      if (closed) return; closed = true;
      bus.close();
      for (const inv of invites.values()) { clearTimeout(inv.timer); try { inv.pc.close(); } catch { /* closed */ } } invites.clear();
      // Tell friends the room is closing (so they stop at once instead of trying to reconnect),
      // give that a moment to leave, then hang up.
      const me = client.me && client.me.playerId;
      for (const [id, s] of hub.online) if (id !== me) { try { s.conn.send('{"ev":"bye"}'); } catch { /* gone */ } }
      client.close();
      const hangUp = () => { for (const p of peers.values()) p.drop(); peers.clear(); hub.close(); };
      if (hub.online.size) setTimeout(hangUp, 250); else hangUp();
    },
  };
  // Closing the tab should hang up on friends at once rather than leave them waiting.
  if (globalThis.addEventListener) globalThis.addEventListener('pagehide', () => host.close());
  return host;
}

// ───────────────────────── joining ─────────────────────────

/**
 * Join a friend's room by its code. Resolves with { client, room }: a connected GameClient
 * (it reconnects by itself through the same handshake) and the room snapshot.
 * Rejects with a GameClientError whose code says what went wrong:
 *   NO_RELAY   none of the public relays could be reached (offline? use an invite text)
 *   NO_HOST    nobody is hosting that code right now
 *   BLOCKED    the host answered, but the two networks would not connect directly
 *   plus the hub's own: NO_ROOM, FULL, BAD_STATE
 * Options: app, code, name, store, profile, relays, iceServers, timeoutMs (20000),
 *   join (true: take a seat in the room), reconnect (true), maxRetries (5).
 */
export async function joinRoom({ app, code, name = null, store, profile = '', relays = DEFAULT_RELAYS, iceServers = DEFAULT_ICE, bus: busFactory = null, RTC = globalThis.RTCPeerConnection, WS = globalThis.WebSocket, timeoutMs = 20000, join = true, reconnect = true, maxRetries = 5, requestTimeoutMs = 10000 }) {
  if (!app) throw err('BAD_INPUT', 'joinRoom needs an app name');
  code = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(code)) throw err('NO_ROOM', 'That does not look like a room code.');
  if (!RTC) throw err('NO_WEBRTC', 'this browser cannot connect peer to peer');
  const keys = roomKeys(app, code), me = toHex(randomBytes(8));
  let attempt = 0;
  const transport = async () => {
    const n = ++attempt, pc = new RTC({ iceServers }), ch = pc.createDataChannel('gamedb');
    let answered = null; const answer = new Promise(res => { answered = res; });
    const bus = (busFactory || (o => openBus({ relays, WS, ...o })))({ onMessage: (topic, text) => { const m = unseal(keys, text); if (m && m.t === 'a' && m.p === me && m.n === n && typeof m.sdp === 'string') answered(m.sdp); } });
    try {
      bus.subscribe(keys.topic + '/g/' + me);
      trace('join: making offer, attempt', n);
      await pc.setLocalDescription(await pc.createOffer());
      const line = seal(keys, { t: 'o', p: me, n, sdp: await finishedSdp(pc) });
      // Say it until the host answers: relays do not keep messages, and the host may still be connecting.
      const until = Date.now() + timeoutMs; let sdp = null;
      trace('join: offer ready, calling the host');
      while (!sdp && Date.now() < until) { bus.publish(keys.topic + '/h', line); sdp = await Promise.race([answer, sleep(1500)]); }
      if (!sdp) throw (await Promise.race([bus.settled, sleep(50).then(() => 1)])) === 0 && bus.relaysUp() === 0
        ? err('NO_RELAY', 'Could not reach the meeting point. Check your internet, or ask the host for an invite text.')
        : err('NO_HOST', 'Nobody is hosting a room with that code right now.');
      trace('join: host answered; connecting');
      await pc.setRemoteDescription({ type: 'answer', sdp });
      trace('join: answer applied; waiting for the link', pc.connectionState);
      await whenOpen(ch, 15000, () => err('BLOCKED', 'Your network and the host\'s would not connect directly. Try another network (for example phone data instead of wifi).'));
      trace('join: link open');
      return clientLink(channelLink(pc, ch));
    } catch (e) { trace('join: failed', e && e.code, e && e.message); try { pc.close(); } catch { /* closed */ } throw e; }
    finally { bus.close(); }
  };
  const client = new GameClient('p2p:' + code, { transport, ownIdentity: true, reconnect, maxRetries, name, store, profile, timeoutMs: requestTimeoutMs });
  client.on('bye', () => { client.close(); client._emit('lost'); }); // the host closed the room
  try {
    const session = await client.connect();
    let room = session.room;
    if (join && (!room || room.code !== code)) { if (room) await client.leaveRoom(); room = await client.joinRoom(code); }
    return { client, room, code };
  } catch (e) { client.close(); throw e; }
}

/**
 * Answer an invite text (the no-relay handshake). Resolves with:
 *   reply       the text to send back to the host
 *   code        the room code
 *   connected   a promise for { client, room }, which settles once the host has pasted the reply in
 * This link cannot rebuild itself: if it drops, the client emits 'lost' and a new invite is needed.
 */
export async function answerInvite({ invite, app = null, name = null, store, profile = '', iceServers = DEFAULT_ICE, RTC = globalThis.RTCPeerConnection, join = true, waitMs = 900000, requestTimeoutMs = 10000 }) {
  if (!RTC) throw err('NO_WEBRTC', 'this browser cannot connect peer to peer');
  const inv = await unpack(invite);
  if (!inv || typeof inv.s !== 'string' || typeof inv.i !== 'string' || typeof inv.c !== 'string') throw err('BAD_INVITE', 'That is not an invite text. Ask the host to copy all of it.');
  if (app && inv.a && inv.a !== app) throw err('BAD_INVITE', 'That invite is for a different game.');
  const pc = new RTC({ iceServers }), code = inv.c.toUpperCase();
  const channel = new Promise((res, rej) => {
    const t = setTimeout(() => { try { pc.close(); } catch { /* closed */ } rej(err('NO_HOST', 'The host did not finish the invite in time.')); }, waitMs); if (t.unref) t.unref();
    pc.ondatachannel = ev => { const ch = ev.channel, go = () => { clearTimeout(t); res(ch); }; if (ch.readyState === 'open') go(); else ch.onopen = go; };
  });
  channel.catch(() => {});
  await pc.setRemoteDescription({ type: 'offer', sdp: inv.s });
  await pc.setLocalDescription(await pc.createAnswer());
  const reply = await pack({ i: inv.i, s: await finishedSdp(pc) });
  let used = false;
  const transport = async () => { if (used) throw err('GONE', 'this invite link has ended'); used = true; return clientLink(channelLink(pc, await channel)); };
  const client = new GameClient('p2p:' + code, { transport, ownIdentity: true, reconnect: true, name, store, profile, timeoutMs: requestTimeoutMs });
  client.on('bye', () => { client.close(); client._emit('lost'); }); // the host closed the room
  const connected = (async () => {
    try { const session = await client.connect(); let room = session.room; if (join && (!room || room.code !== code)) { if (room) await client.leaveRoom(); room = await client.joinRoom(code); } return { client, room, code }; }
    catch (e) { client.close(); throw e; }
  })();
  connected.catch(() => {});
  return { reply, code, client, connected, cancel: () => { client.close(); try { pc.close(); } catch { /* closed */ } } };
}
