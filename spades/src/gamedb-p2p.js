// GameDB peer to peer — multiplayer with no game server.
//
// The host player's browser holds the database and runs the hub (gamedb-hub.js). Friends
// connect straight to it over WebRTC data channels. Nothing of yours is hosted anywhere.
//
// Finding each other (the "handshake"):
//   1. Room code — one click. A few sealed lines pass through free public meeting points
//      (MQTT brokers, Nostr relays and WebTorrent trackers, all raced: gamedb-relays.js).
//   2. Invite text — depends on nothing. The host copies an invite to a friend (any chat app),
//      the friend's game answers with a reply text, the host pastes it in.
//   3. Friend code — call someone you have played with by their code (listen / callFriend).
//   Two tabs on the same computer also find each other directly.
//
// Staying connected:
//   - A heartbeat notices a dead link within about 4 seconds, and the link is repaired in place
//     (an ICE restart on the same connection: nothing is lost, the seat is kept).
//   - If two networks will not connect directly, the game carries on over the meeting points
//     themselves ("relay lane"): slower, encrypted end to end, fine for turn-based games.
//   - If the host leaves, the next player in seat order takes over the room (handoff).
//
// Who is who: every device has its own key (gamedb-id.js). The host signs its answers, so a
// friend can tell the real host from anyone else who knows the room code.
//
//   // host                                         // friend
//   const host = await hostRoom({ app: 'spades',    const { client, room } = await joinRoom({
//     db, kit, modes, mode: 'spades' });               app: 'spades', code: 'K7QM2P' });
//   host.code  -> 'K7QM2P'   host.client -> a GameClient, same as the friend's
// Zero dependencies.
import { createHub, sha256, utf8, toHex, randomBytes, randomCode, signable } from './gamedb-hub.js';
import { GameClient, GameClientError } from './gamedb-client.js';
import { deviceIdentity, verifyHex, friendCode, cleanFriendCode, newSecretKey, publicKey, sharedSecret, fromHex } from './gamedb-id.js';
import { DEFAULT_RELAYS, openBus, memoryBus, concat, b64, unb64, seal, unseal } from './gamedb-relays.js';
export { DEFAULT_RELAYS, openBus, memoryBus, deviceIdentity, friendCode, cleanFriendCode, seal, unseal };

/** Free public STUN servers: they tell a browser its own public address, nothing else. */
export const DEFAULT_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
/** Version of the link protocol. 2 = heartbeat, repair, relay lane, signed answers. */
export const PROTOCOL = 2;
/** How long things take (milliseconds). Pass `timing: { ... }` to change any of them. */
export const TIMING = {
  pingMs: 1000, stallMs: 4000, repairMs: 8000, // heartbeat; a link silent for stallMs is repaired; given up after repairMs
  directMs: 8000,                              // how long a direct link may take before the relay lane is used
  reconnectMs: 6000,                           // how long one reconnect attempt calls for the host
  laneAckMs: 1500, lanePingMs: 3000, laneDeadMs: 20000, // relay lane: resend, keep-alive, give up
  seatGraceMs: 20000,                          // a player who drops from a lobby keeps the seat this long
};
const timingOf = t => ({ ...TIMING, ...(t || {}) });

const dec = new TextDecoder();
const err = (code, msg) => new GameClientError(code, msg);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Set globalThis.GAMEDB_DEBUG = true (browser console) to see each step of a handshake.
const trace = (...a) => { if (globalThis.GAMEDB_DEBUG) console.log('[gamedb-p2p]', ...a); };
const isKey = k => typeof k === 'string' && /^[0-9a-f]{64}$/.test(k);

// ───────────────────────── sealing ─────────────────────────
// The meeting points are public, and a handshake holds network addresses. So every line is
// encrypted and signed with keys made from the room code, and the topic is made from the code
// too: only someone who was given the code can find the room or read its handshake.
// (seal / unseal live in gamedb-relays.js: SHA-256 in counter mode + HMAC-SHA-256, pure JS.)

/** The topic and keys for a room code. */
export function roomKeys(app, code) {
  let k = sha256(utf8(`gamedb-p2p|${app}|${String(code).toUpperCase()}`));
  for (let i = 0; i < 2000; i++) k = sha256(k); // slows down guessing codes
  const part = label => sha256(concat([utf8(label), k]));
  return { topic: 'gdb/' + toHex(part('topic')).slice(0, 32), enc: part('enc'), mac: part('mac') };
}
// Keys for one link, from a secret only its two ends know (relay lane, friend calls).
const linkKeys = (shared, label) => ({ enc: sha256(concat([utf8('enc|' + label), shared])), mac: sha256(concat([utf8('mac|' + label), shared])) });
// What the host signs when it answers (r = which repair, 0 for the first answer).
const answerProof = (app, code, p, n, r, sdp) => signable('gamedb-answer', app, code, p, n, r || 0, sdp);
const laneTag = (code, p, n) => toHex(sha256(utf8(`lane|${code}|${p}|${n}`))).slice(0, 10);

// ───────────────────────── links ─────────────────────────
// Every link is the same simple shape: { send(text), close(), readyState, onmessage(text), onclose(), lane }.

const MAX_MSG = 256 * 1024, CHUNK = 4000, PART = 3000;

// Wait until the browser has finished listing the addresses it can be reached at (or long enough).
async function finishedSdp(pc, waitMs = 2500, restarted = false) {
  if (restarted) { const t0 = Date.now(); while (pc.iceGatheringState === 'complete' && Date.now() - t0 < 300) await sleep(20); }
  if (pc.iceGatheringState !== 'complete') {
    await new Promise(res => {
      const t = setTimeout(res, waitMs);
      pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
    });
  }
  return pc.localDescription.sdp;
}
// Resolves true once the data channel opens, false if the connection fails or takes too long.
function opened(ch, pc, ms) {
  return new Promise(res => {
    if (ch.readyState === 'open') { res(true); return; }
    let done = false;
    const fin = v => { if (done) return; done = true; clearTimeout(t); clearInterval(poll); res(v); };
    const t = setTimeout(() => fin(false), ms);
    const poll = setInterval(() => { if (ch.readyState === 'open') fin(true); else if (pc.connectionState === 'failed' || pc.iceConnectionState === 'failed') fin(false); }, 100);
    ch.onopen = () => fin(true);
  });
}

// A WebRTC data channel as a link. Long messages go in pieces (browsers disagree on the largest
// single message). With `beat` (both ends speak protocol 2) the ends ping each other; a link
// that goes quiet calls onStall (the friend's side repairs it) and ends if it stays quiet.
// Frames: '0' last piece, '1' more pieces follow, '2' ping, '3' pong.
function channelLink(pc, ch, { beat = false, timing = TIMING, patience = timing.repairMs, onStall = null } = {}) {
  const link = { readyState: 1, onmessage: null, onclose: null, pc, lane: 'direct' };
  let parts = '', ended = false, drop = null, stalled = false, heard = Date.now(), said = Date.now(), beater = null;
  const end = () => {
    if (ended) return; ended = true; link.readyState = 3; clearTimeout(drop); clearInterval(beater);
    try { ch.close(); } catch { /* closed */ } try { pc.close(); } catch { /* closed */ }
    if (link.onclose) link.onclose();
  };
  const raw = d => { if (ended || ch.readyState !== 'open') return; try { ch.send(d); said = Date.now(); } catch { /* closing */ } };
  const stall = () => {
    if (stalled || ended) return; stalled = true; trace('link quiet: repairing');
    clearTimeout(drop); drop = setTimeout(end, patience);
    if (onStall) { try { onStall(); } catch (e) { console.error(e); } }
  };
  ch.onmessage = ev => {
    const d = ev.data; if (typeof d !== 'string' || !d) return;
    heard = Date.now(); if (stalled) { stalled = false; clearTimeout(drop); trace('link back'); }
    if (beat && d[0] === '2') { if (Date.now() - said > timing.pingMs / 2) raw('3'); return; }
    if (beat && d[0] === '3') return;
    if (d[0] === '1') { parts += d.slice(1); if (parts.length > MAX_MSG) end(); return; }
    const text = parts + d.slice(1); parts = '';
    if (link.onmessage) link.onmessage(text);
  };
  ch.onclose = end;
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === 'closed') end();
    else if (beat) { if (s === 'failed') stall(); }
    else if (s === 'failed') end();
    else if (s === 'disconnected') { clearTimeout(drop); drop = setTimeout(end, 6000); }
    else if (s === 'connected') clearTimeout(drop);
  };
  if (beat) {
    beater = setInterval(() => {
      const t = Date.now();
      if (t - said >= timing.pingMs) raw('2');
      if (!stalled && t - heard > timing.stallMs) stall();
    }, Math.max(50, timing.pingMs / 2));
    if (beater.unref) beater.unref();
  }
  link.send = text => {
    if (ended) return;
    let i = 0;
    while (text.length - i > CHUNK) {
      let j = i + CHUNK; const c = text.charCodeAt(j); if (c >= 0xdc00 && c <= 0xdfff) j--; // keep character pairs whole
      raw('1' + text.slice(i, j)); i = j;
    }
    raw('0' + text.slice(i));
  };
  link.stall = stall; // the network changed: check the link now
  link.close = end;
  return link;
}

// The relay lane: a link carried by the meeting points when a direct one cannot be made.
// Every frame is sealed with keys only the two ends know, numbered, acknowledged and sent again
// until it is (the meeting points promise nothing). Frames: '~' + lane tag + sealed
// { s: number (0 = only an ack), a: last number received in order, m: piece, c: 1 = more pieces, z: 1 = hang up }.
function busLink({ bus, keys, out, tag, timing = TIMING }) {
  const link = { readyState: 1, onmessage: null, onclose: null, lane: 'relay', onEnd: null };
  let sent = 0, want = 1, parts = '', ended = false, heard = Date.now(), said = 0, ackTimer = null, tokens = 20, last = Date.now();
  const waiting = new Map(), early = new Map(), queue = [];
  let ready = null; link.ready = new Promise(res => { ready = res; });
  const emit = f => { bus.publish(out, '~' + tag + seal(keys, f)); said = Date.now(); };
  const pump = () => {
    const t = Date.now(); tokens = Math.min(20, tokens + (t - last) / 50); last = t; // about 20 frames a second at most
    while (queue.length && waiting.size < 32 && tokens >= 1) {
      tokens--; const [m, c] = queue.shift(), s = ++sent, f = { s, m, c };
      waiting.set(s, { f, at: t }); emit({ ...f, a: want - 1 });
    }
  };
  const deliver = g => {
    if (typeof g.m !== 'string') return;
    if (g.c) { parts += g.m; if (parts.length > MAX_MSG) end(true); return; }
    const text = parts + g.m; parts = '';
    if (link.onmessage) link.onmessage(text);
  };
  function end(tell) {
    if (ended) return; ended = true; link.readyState = 3; clearInterval(timer); clearTimeout(ackTimer);
    if (tell) { try { emit({ z: 1 }); } catch { /* bus gone */ } }
    if (link.onEnd) link.onEnd();
    if (link.onclose) link.onclose();
  }
  link.receive = text => {
    if (ended || text.slice(1, 11) !== tag) return;
    const f = unseal(keys, text.slice(11)); if (!f) return;
    heard = Date.now(); ready();
    if (f.z) { end(false); return; }
    if (Number.isInteger(f.a)) for (const s of waiting.keys()) if (s <= f.a) waiting.delete(s);
    if (Number.isInteger(f.s) && f.s > 0) {
      if (f.s >= want && f.s < want + 512) early.set(f.s, f);
      while (early.has(want)) { const g = early.get(want); early.delete(want); want++; deliver(g); }
      if (!ackTimer) ackTimer = setTimeout(() => { ackTimer = null; if (!ended) emit({ s: 0, a: want - 1 }); }, 120);
    }
    pump();
  };
  const timer = setInterval(() => {
    const t = Date.now();
    for (const w of waiting.values()) if (t - w.at > timing.laneAckMs) { w.at = t; emit({ ...w.f, a: want - 1 }); }
    pump();
    if (t - said > timing.lanePingMs) emit({ s: 0, a: want - 1 });
    if (t - heard > timing.laneDeadMs) end(true);
  }, Math.max(50, Math.min(250, timing.laneAckMs / 3)));
  if (timer.unref) timer.unref();
  link.send = text => {
    if (ended) return;
    let i = 0;
    do {
      let j = Math.min(text.length, i + PART); if (j < text.length) { const c = text.charCodeAt(j); if (c >= 0xdc00 && c <= 0xdfff) j--; }
      queue.push([text.slice(i, j), j < text.length ? 1 : 0]); i = j;
    } while (i < text.length);
    pump();
  };
  link.hello = () => emit({ s: 0, a: want - 1 });
  link.close = () => end(true);
  return link;
}

// The link shape GameClient expects (onmessage gets { data }).
function clientLink(link) {
  const c = { get readyState() { return link.readyState; }, send: t => link.send(t), close: () => link.close(), onmessage: null, onclose: null, lane: link.lane, link };
  link.onmessage = text => { if (c.onmessage) c.onmessage({ data: text }); };
  link.onclose = () => { if (c.onclose) c.onclose(); };
  return c;
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
// Remember everyone this device shares a room with (identity.friends), so they can be called later.
function keepFriends(client, me) {
  const known = new Set();
  const see = room => {
    if (!room || !Array.isArray(room.players)) return;
    for (const p of room.players) if (isKey(p.key) && p.key !== me.key && !known.has(p.key)) { known.add(p.key); me.friends.remember({ key: p.key, playerId: p.id, name: p.name }); }
  };
  client.on('room', e => see(e.room)); client.on('open', s => see(s && s.room));
  return see;
}

// ───────────────────────── hosting ─────────────────────────

/**
 * Open a room on this device. This browser becomes the database and the referee.
 *   app            a short name for your game; rooms of different games never meet
 *   db, kit        an open GameDB and its GameKit (keep them on storage and friends boards survive a reload)
 *   modes, actions, clientBoards, maxMessagesPerSecond   as for the hub (gamedb-hub.js)
 *   mode           create a room of this mode straight away (its code is the code friends type)
 *   roomOptions    extra createRoom options ({ maxPlayers, options })
 *   allow          only these players (keys) may take a seat (used when a friend calls)
 *   code           reuse a code (to reopen a room after a reload); default: a fresh 6-character code
 *   name, store, profile, identity   who the host is (see gamedb-id.js deviceIdentity)
 *   relays, iceServers     replace the public defaults; relays: [] turns the room-code handshake off
 *   timing         see TIMING
 * Resolves with:
 *   code, friendCode, client (the host's own GameClient, same API friends get), room, hub
 *   ready      a promise: how many meeting points are carrying the room code (0 = use invite texts)
 *   invite()            make an invite text for ONE friend (the no-relay handshake)
 *   accept(replyText)   finish that handshake with the reply text the friend sent back
 *   on('guest', fn)     a friend's link opened ({ id, lane });  close({ handoff })  shut the room
 *                       (handoff: true = the others carry on, the next in seat order hosting)
 */
export async function hostRoom({ app, db, kit, modes = {}, actions = {}, clientBoards = [], mode = null, roomOptions = {}, allow = null, code = randomCode(6), name = null, store, profile = '', identity = null, relays = DEFAULT_RELAYS, iceServers = DEFAULT_ICE, bus: busFactory = null, RTC = globalThis.RTCPeerConnection, WS = globalThis.WebSocket, log = console.log, maxMessagesPerSecond = 60, timing = null, friends = true, requestTimeoutMs = 10000, restore = null, client: given = null }) {
  if (!app) throw err('BAD_INPUT', 'hostRoom needs an app name');
  code = String(code).toUpperCase();
  const tm = timingOf(timing), me = identity || deviceIdentity(store, profile);
  const hub = createHub({ db, kit, modes, actions, clientBoards, roomCodes: true, log, maxMessagesPerSecond, verify: verifyHex, seatGraceMs: tm.seatGraceMs });
  // No link outlives the host's page, so rooms left in a stored database by an earlier visit are dead.
  db.transaction(() => { db.run('DELETE FROM gk_room_players'); db.run('DELETE FROM gk_rooms'); });
  if (restore) hub.restoreRoom(restore.room, me.playerId, restore.state ?? null); // taking over from a host who left
  const keys = roomKeys(app, code), peers = new Map(), invites = new Map(), lanes = new Map(), handlers = new Map();
  let closed = false;
  const emit = (ev, a) => { for (const fn of handlers.get(ev) || []) { try { fn(a); } catch (e) { console.error(e); } } };
  const plug = (link, id) => { hub.connect(link); emit('guest', { id, lane: link.lane }); return link; };
  const keepPeer = (p, id, link, also = null) => {
    p.link = plug(link, id);
    const was = p.link.onclose; p.link.onclose = () => { if (also) also(); if (peers.get(id) === p) peers.delete(id); if (was) was(); };
  };

  // The host's own link to the hub: no network, just two ends in memory.
  const loopback = () => {
    let open = true;
    const hubEnd = { onmessage: null, onclose: null, send: t => { queueMicrotask(() => { if (open && end.onmessage) end.onmessage({ data: t }); }); }, close: () => shut() };
    const end = { readyState: 1, onmessage: null, onclose: null, lane: 'host', send: t => { queueMicrotask(() => { if (open && hubEnd.onmessage) hubEnd.onmessage(t); }); }, close: () => shut() };
    function shut() { if (!open) return; open = false; end.readyState = 3; if (hubEnd.onclose) hubEnd.onclose(); if (end.onclose) end.onclose(); }
    hub.connect(hubEnd, { trusted: true });
    return end;
  };
  const client = given || new GameClient('p2p:' + code, { transport: loopback, identity: me, reconnect: false, name, timeoutMs: requestTimeoutMs });
  if (!given) { if (friends) keepFriends(client, me); await client.connect(); }
  const room = mode && !restore ? await client.createRoom(mode, { private: true, ...roomOptions, code, ...(allow ? { allow } : {}) }) : null;

  // Room-code handshake: friends post an offer on the room's topic; we post the answer back.
  const toGuest = (p, text) => bus.publish(keys.topic + '/g/' + p, text);
  const bus = (busFactory || (o => openBus({ relays, WS, ...o })))({ onMessage: (topic, text) => {
    if (text[0] === '~') { const l = lanes.get(text.slice(1, 11)); if (l) l.receive(text); return; }
    const m = unseal(keys, text);
    if (!m || typeof m.p !== 'string' || m.p.length > 40 || !Number.isInteger(m.n)) return;
    const go = m.t === 'o' ? offer : m.t === 'r' ? reoffer : m.t === 's' ? openLane : null;
    if (go) go(m).catch(e => log('gamedb-p2p: could not answer a friend', e));
  }, log });
  bus.subscribe(keys.topic + '/h');
  const answerLine = (m, sdp, r = 0) => seal(keys, { t: 'a', p: m.p, n: m.n, ...(r ? { r } : {}), sdp, v: PROTOCOL, k: me.key, g: me.sign(answerProof(app, code, m.p, m.n, r, sdp)) });

  async function offer(m) {
    if (closed || !RTC || typeof m.sdp !== 'string' || m.sdp.length > 20000) return;
    let p = peers.get(m.p);
    if (p && p.n === m.n) { if (p.answer) toGuest(m.p, p.answer); return; } // they did not hear us: say it again
    if (p && p.n > m.n) return;
    if (p) p.drop(); else if (peers.size >= 32) return;
    const pc = new RTC({ iceServers }), v2 = m.v >= 2;
    p = { n: m.n, pc, e: isKey(m.e) ? m.e : null, answer: null, link: null, lane: null, rn: 0, rAnswer: null, drop: () => { clearTimeout(p.timer); if (p.link) p.link.close(); else { try { pc.close(); } catch { /* closed */ } } } };
    p.timer = setTimeout(() => { if (!p.link && peers.get(m.p) === p) { peers.delete(m.p); p.drop(); } }, 45000); // never connected
    peers.set(m.p, p);
    pc.ondatachannel = ev => {
      const ch = ev.channel, go = () => {
        if (closed || peers.get(m.p) !== p || p.link) return;
        trace('host: link open with', m.p); clearTimeout(p.timer);
        keepPeer(p, m.p, channelLink(pc, ch, { beat: v2, timing: tm, patience: tm.repairMs * 1.5 }));
      };
      if (ch.readyState === 'open') go(); else ch.onopen = go;
    };
    trace('host: offer from', m.p, 'attempt', m.n);
    await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    const sdp = await finishedSdp(pc);
    if (closed || peers.get(m.p) !== p) return;
    p.answer = answerLine(m, sdp);
    toGuest(m.p, p.answer);
  }
  // A friend's link went quiet: they ask to restart its network path (same connection, same seat).
  async function reoffer(m) {
    const p = peers.get(m.p);
    if (closed || !p || p.n !== m.n || !p.link || p.link.readyState !== 1 || !p.link.pc || !Number.isInteger(m.r) || typeof m.sdp !== 'string' || m.sdp.length > 20000) return;
    if (p.rn === m.r) { if (p.rAnswer) toGuest(m.p, p.rAnswer); return; }
    if (p.rn > m.r) return;
    p.rn = m.r; p.rAnswer = null; trace('host: repairing the link with', m.p);
    const pc = p.link.pc;
    await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    const sdp = await finishedSdp(pc, 2500, true);
    if (closed || p.rn !== m.r) return;
    p.rAnswer = answerLine(m, sdp, m.r);
    toGuest(m.p, p.rAnswer);
  }
  // The two networks would not connect directly: carry this friend over the meeting points.
  async function openLane(m) {
    const p = peers.get(m.p);
    if (closed || !p || p.n !== m.n || !p.e) return;
    if (p.lane) { p.lane.hello(); return; } // they have not heard us yet
    if (p.link) return;
    const shared = me.shared(p.e); if (!shared) return;
    clearTimeout(p.timer); try { p.pc.close(); } catch { /* closed */ }
    const tag = laneTag(code, m.p, m.n);
    p.lane = busLink({ bus, keys: linkKeys(shared, tag), out: keys.topic + '/g/' + m.p, tag, timing: tm });
    lanes.set(tag, p.lane); trace('host: relay lane for', m.p);
    keepPeer(p, m.p, p.lane, () => lanes.delete(tag));
    p.lane.hello();
  }

  const host = {
    code, hub, client, room, db, kit, identity: me, friendCode: me.friendCode,
    ready: bus.settled,
    relaysUp: () => bus.relaysUp(),
    loopback,
    on(ev, fn) { if (!handlers.has(ev)) handlers.set(ev, new Set()); handlers.get(ev).add(fn); return () => handlers.get(ev).delete(fn); },
    /** Make an invite text for one friend. Send it to them; they send a reply text back for accept(). */
    async invite() {
      if (!RTC) throw err('NO_WEBRTC', 'this browser cannot connect peer to peer');
      const pc = new RTC({ iceServers }), ch = pc.createDataChannel('gamedb'), id = randomCode(4);
      const inv = { pc, ch, v2: false, timer: setTimeout(() => { if (invites.get(id) === inv) { invites.delete(id); try { pc.close(); } catch { /* closed */ } } }, 900000) }; // 15 minutes to answer
      invites.set(id, inv);
      ch.onopen = () => { clearTimeout(inv.timer); invites.delete(id); if (!closed) plug(channelLink(pc, ch, { beat: inv.v2, timing: tm }), 'invite-' + id); };
      await pc.setLocalDescription(await pc.createOffer());
      return pack({ i: id, c: code, a: app, s: await finishedSdp(pc), v: PROTOCOL });
    },
    /** Finish an invite with the reply text the friend sent back. */
    async accept(replyText) {
      const r = await unpack(replyText), inv = r && invites.get(r.i);
      if (!r || typeof r.s !== 'string') throw err('BAD_REPLY', 'That is not a reply text. Ask your friend to copy all of it.');
      if (!inv) throw err('BAD_REPLY', 'That reply is for an invite that is no longer open. Make a new invite.');
      inv.v2 = r.v >= 2;
      await inv.pc.setRemoteDescription({ type: 'answer', sdp: r.s });
      return true;
    },
    close({ handoff = false } = {}) {
      if (closed) return; closed = true;
      for (const inv of invites.values()) { clearTimeout(inv.timer); try { inv.pc.close(); } catch { /* closed */ } } invites.clear();
      // Tell friends first (so they stop at once, or take over with handoff), give that a moment
      // to leave, then hang up.
      const mine = client.me && client.me.playerId, bye = JSON.stringify(handoff ? { ev: 'bye', handoff: true } : { ev: 'bye' });
      for (const [id, s] of hub.online) if (id !== mine) { try { s.conn.send(bye); } catch { /* gone */ } }
      client.close();
      const hangUp = () => { for (const p of peers.values()) p.drop(); peers.clear(); lanes.clear(); bus.close(); hub.close(); };
      if (hub.online.size) setTimeout(hangUp, 250); else hangUp();
    },
  };
  // Closing the tab should hang up on friends at once (and let them carry on) rather than leave them waiting.
  if (globalThis.addEventListener) globalThis.addEventListener('pagehide', () => host.close({ handoff: true }));
  return host;
}

// ───────────────────────── joining ─────────────────────────

/**
 * Join a friend's room by its code. Resolves with { client, room, code }: a connected GameClient
 * (it keeps itself connected: repairs, reconnects, relay lane) and the room snapshot.
 * Rejects with a GameClientError whose code says what went wrong:
 *   NO_RELAY   none of the meeting points could be reached (offline? use an invite text)
 *   NO_HOST    nobody is hosting that code right now
 *   BLOCKED    the host answered, but no link could be made, not even the relay lane
 *   plus the hub's own: NO_ROOM, FULL, BAD_STATE, FORBIDDEN
 * Options: app, code, name, store, profile, identity, relays, iceServers, timeoutMs (20000),
 *   join (true: take a seat in the room), reconnect (true), retryForMs (60000: keep trying this
 *   long after a drop), maxRetries, slowLane (true: use the relay lane when a direct link fails),
 *   hostKey (only accept a host with this key: set for you by callFriend),
 *   handoff ({ db, kit, modes, actions, clientBoards } or a function returning them: if the host
 *   leaves, this device may take over the room with these; leave it out to never host), timing.
 * The client emits 'host' (with the new host object) if this device took over the room.
 */
export async function joinRoom({ app, code, name = null, store, profile = '', identity = null, hostKey = null, relays = DEFAULT_RELAYS, iceServers = DEFAULT_ICE, bus: busFactory = null, RTC = globalThis.RTCPeerConnection, WS = globalThis.WebSocket, timeoutMs = 20000, join = true, reconnect = true, retryForMs = 60000, maxRetries = Infinity, requestTimeoutMs = 10000, slowLane = true, handoff = null, friends = true, timing = null, log = () => {} }) {
  if (!app) throw err('BAD_INPUT', 'joinRoom needs an app name');
  code = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(code)) throw err('NO_ROOM', 'That does not look like a room code.');
  if (!RTC) throw err('NO_WEBRTC', 'this browser cannot connect peer to peer');
  const tm = timingOf(timing), me = identity || deviceIdentity(store, profile);
  const keys = roomKeys(app, code), tag = toHex(randomBytes(8));
  const openB = o => (busFactory || (x => openBus({ relays, WS, ...x })))(o);
  // pins = the keys a real host may have: the room's members (whoever hosts after a handoff).
  const ctx = { room: null, state: null, pins: new Set(isKey(hostKey) ? [hostKey] : []), host: null, droppedAt: 0, hostLeft: false, link: null };
  let attempt = 0, repairs = 0, repairing = false;

  const trusted = m => {
    if (typeof m.k !== 'string') return ctx.pins.size === 0; // an older host signs nothing: only on first contact
    if (ctx.pins.size && !ctx.pins.has(m.k)) return false;
    return verifyHex(m.k, answerProof(app, code, m.p, m.n, m.r, m.sdp), m.g);
  };

  async function dial(n, waitMs) {
    const pc = new RTC({ iceServers }), ch = pc.createDataChannel('gamedb');
    const eph = newSecretKey(), e = toHex(publicKey(eph)); // for the relay lane's keys, if it comes to that
    let answered = null, lane = null, keep = false; const answer = new Promise(res => { answered = res; });
    const bus = openB({ onMessage: (topic, text) => {
      if (text[0] === '~') { if (lane) lane.receive(text); return; }
      const m = unseal(keys, text);
      if (m && m.t === 'a' && m.p === tag && m.n === n && !m.r && typeof m.sdp === 'string' && trusted(m)) answered(m);
    } });
    try {
      bus.subscribe(keys.topic + '/g/' + tag);
      trace('join: making offer, attempt', n);
      await pc.setLocalDescription(await pc.createOffer());
      const line = seal(keys, { t: 'o', p: tag, n, sdp: await finishedSdp(pc), v: PROTOCOL, e });
      // Say it until the host answers: meeting points do not keep messages, and the host may still be connecting.
      const until = Date.now() + waitMs; let m = null;
      while (!m && Date.now() < until) { bus.publish(keys.topic + '/h', line); m = await Promise.race([answer, sleep(1500)]); }
      if (!m) throw (await Promise.race([bus.settled, sleep(50).then(() => 1)])) === 0 && bus.relaysUp() === 0
        ? err('NO_RELAY', 'Could not reach the meeting point. Check your internet, or ask the host for an invite text.')
        : err('NO_HOST', 'Nobody is hosting a room with that code right now.');
      if (m.k && !ctx.pins.size) ctx.pins.add(m.k); // first contact: remember who the host is
      trace('join: host answered; connecting');
      await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
      const v2 = m.v >= 2, canLane = v2 && slowLane && isKey(m.k);
      if (await opened(ch, pc, canLane ? tm.directMs : 15000)) {
        trace('join: direct link open');
        const link = channelLink(pc, ch, { beat: v2, timing: tm, patience: tm.repairMs, onStall: v2 ? () => repair(pc, n, link) : null });
        ctx.link = link;
        return clientLink(link);
      }
      if (!canLane) throw err('BLOCKED', 'Your network and the host\'s would not connect directly. Try another network (for example phone data instead of wifi).');
      trace('join: no direct link; asking for the relay lane');
      try { pc.close(); } catch { /* closed */ }
      const shared = sharedSecret(eph, fromHex(m.k)), lt = laneTag(code, tag, n);
      lane = busLink({ bus, keys: linkKeys(shared, lt), out: keys.topic + '/h', tag: lt, timing: tm });
      const ask = seal(keys, { t: 's', p: tag, n }), stop = Date.now() + tm.directMs; let up = false;
      while (!up && Date.now() < stop) { bus.publish(keys.topic + '/h', ask); up = await Promise.race([lane.ready.then(() => true), sleep(1000).then(() => false)]); }
      if (!up) { lane.close(); throw err('BLOCKED', 'Could not reach the host, not even through the meeting points.'); }
      keep = true; lane.onEnd = () => bus.close(); ctx.link = lane;
      trace('join: relay lane open');
      return clientLink(lane);
    } catch (x) { trace('join: failed', x && x.code, x && x.message); try { pc.close(); } catch { /* closed */ } throw x; }
    finally { if (!keep) bus.close(); }
  }
  // Repair a quiet direct link in place: a new network path (ICE restart) on the same connection.
  async function repair(pc, n, link) {
    if (repairing || link.readyState !== 1) return; repairing = true;
    const r = ++repairs; let answered = null; const answer = new Promise(res => { answered = res; });
    const bus = openB({ onMessage: (topic, text) => { const m = unseal(keys, text); if (m && m.t === 'a' && m.p === tag && m.n === n && m.r === r && typeof m.sdp === 'string' && trusted(m)) answered(m); } });
    try {
      bus.subscribe(keys.topic + '/g/' + tag);
      if (pc.restartIce) pc.restartIce();
      await pc.setLocalDescription(await pc.createOffer({ iceRestart: true }));
      const line = seal(keys, { t: 'r', p: tag, n, r, sdp: await finishedSdp(pc, 2500, true), v: PROTOCOL });
      const until = Date.now() + tm.repairMs; let m = null;
      while (!m && Date.now() < until && link.readyState === 1) { bus.publish(keys.topic + '/h', line); m = await Promise.race([answer, sleep(1000)]); }
      if (m && link.readyState === 1) { await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }); trace('join: repair answered'); }
    } catch (x) { trace('join: repair failed', x && x.message); }
    finally { bus.close(); repairing = false; }
  }
  // Handoff: who takes over if the host is gone? The connected players in seat order.
  const line = () => { const r = ctx.room; return r ? r.players.filter(p => p.id !== r.host && isKey(p.key) && p.connected !== false).sort((a, b) => a.seat - b.seat) : []; };
  const myTurn = () => { const k = line().findIndex(p => p.id === me.playerId); return k === 0 || (k > 0 && Date.now() - ctx.droppedAt >= k * tm.reconnectMs * 1.5); };
  async function rehost() {
    const opts = typeof handoff === 'function' ? await handoff() : handoff;
    if (!opts || !opts.db || !opts.kit || !ctx.room) throw err('NO_HOST', 'The host left.');
    trace('join: the host is gone; taking over the room');
    const h = await hostRoom({ app, code, name, profile, identity: me, relays, iceServers, bus: busFactory, RTC, WS, timing, log, ...opts, mode: null, restore: { room: ctx.room, state: ctx.state }, client });
    ctx.host = h;
    setTimeout(() => client._emit('host', h), 0);
    return h.loopback();
  }
  const transport = async () => {
    const n = ++attempt;
    if (ctx.host) return ctx.host.loopback();
    if (n > 1 && handoff && ctx.hostLeft && line()[0] && line()[0].id === me.playerId) return rehost();
    try { return await dial(n, n === 1 ? timeoutMs : tm.reconnectMs); }
    catch (x) { if (n > 1 && handoff && x.code === 'NO_HOST' && myTurn()) return rehost(); throw x; }
  };

  const client = new GameClient('p2p:' + code, { transport, identity: me, reconnect, retryForMs, maxRetries, name, timeoutMs: requestTimeoutMs });
  // (Once the host has said it is leaving, its last words about who is connected are not to be
  // trusted: it marks people gone as it hangs up on them one by one. Keep the room as it was.)
  const see = room => { if (!room || !Array.isArray(room.players) || ctx.hostLeft) return; ctx.room = room; const ks = room.players.map(p => p.key).filter(isKey); if (ks.length) ctx.pins = new Set(ks); };
  if (friends) keepFriends(client, me);
  client.on('room', e => see(e.room));
  client.on('state', e => { ctx.state = e.state; });
  client.on('open', s => { ctx.droppedAt = 0; ctx.hostLeft = false; if (s && s.room) see(s.room); if (s && s.state) ctx.state = s.state; });
  client.on('close', () => { if (!ctx.droppedAt) ctx.droppedAt = Date.now(); });
  client.on('bye', e => { // the host closed the room
    if (e.handoff && handoff && !ctx.host && line().length) { ctx.hostLeft = true; return; } // ...but the others carry on
    client.close(); client._emit('lost');
  });
  // Moving between networks (wifi to phone data): check the link at once instead of waiting.
  const kick = () => { const l = ctx.link; if (l && l.stall && l.readyState === 1) l.stall(); };
  const conn = globalThis.navigator && globalThis.navigator.connection;
  if (globalThis.addEventListener) globalThis.addEventListener('online', kick);
  if (conn && conn.addEventListener) conn.addEventListener('change', kick);
  const unkick = () => { if (globalThis.removeEventListener) globalThis.removeEventListener('online', kick); if (conn && conn.removeEventListener) conn.removeEventListener('change', kick); };
  client.on('lost', unkick); const close0 = client.close.bind(client); client.close = () => { unkick(); close0(); };
  try {
    const session = await client.connect();
    let room = session.room;
    if (join && (!room || room.code !== code)) { if (room) await client.leaveRoom(); room = await client.joinRoom(code); }
    see(room);
    return { client, room, code, get host() { return ctx.host; } };
  } catch (x) { client.close(); throw x; }
}

/**
 * Answer an invite text (the no-relay handshake). Resolves with:
 *   reply       the text to send back to the host
 *   code        the room code
 *   connected   a promise for { client, room }, which settles once the host has pasted the reply in
 * This link cannot rebuild itself: if it drops, the client emits 'lost' and a new invite is needed.
 */
export async function answerInvite({ invite, app = null, name = null, store, profile = '', identity = null, iceServers = DEFAULT_ICE, RTC = globalThis.RTCPeerConnection, join = true, waitMs = 900000, requestTimeoutMs = 10000, timing = null, friends = true }) {
  if (!RTC) throw err('NO_WEBRTC', 'this browser cannot connect peer to peer');
  const inv = await unpack(invite);
  if (!inv || typeof inv.s !== 'string' || typeof inv.i !== 'string' || typeof inv.c !== 'string') throw err('BAD_INVITE', 'That is not an invite text. Ask the host to copy all of it.');
  if (app && inv.a && inv.a !== app) throw err('BAD_INVITE', 'That invite is for a different game.');
  const tm = timingOf(timing), me = identity || deviceIdentity(store, profile);
  const pc = new RTC({ iceServers }), code = inv.c.toUpperCase();
  const channel = new Promise((res, rej) => {
    const t = setTimeout(() => { try { pc.close(); } catch { /* closed */ } rej(err('NO_HOST', 'The host did not finish the invite in time.')); }, waitMs); if (t.unref) t.unref();
    pc.ondatachannel = ev => { const ch = ev.channel, go = () => { clearTimeout(t); res(ch); }; if (ch.readyState === 'open') go(); else ch.onopen = go; };
  });
  channel.catch(() => {});
  await pc.setRemoteDescription({ type: 'offer', sdp: inv.s });
  await pc.setLocalDescription(await pc.createAnswer());
  const reply = await pack({ i: inv.i, s: await finishedSdp(pc), v: PROTOCOL });
  let used = false;
  const transport = async () => { if (used) throw err('GONE', 'this invite link has ended'); used = true; return clientLink(channelLink(pc, await channel, { beat: inv.v >= 2, timing: tm })); };
  const client = new GameClient('p2p:' + code, { transport, identity: me, reconnect: true, name, timeoutMs: requestTimeoutMs });
  if (friends) keepFriends(client, me);
  client.on('bye', () => { client.close(); client._emit('lost'); }); // the host closed the room
  const connected = (async () => {
    try { const session = await client.connect(); let room = session.room; if (join && (!room || room.code !== code)) { if (room) await client.leaveRoom(); room = await client.joinRoom(code); } return { client, room, code }; }
    catch (x) { client.close(); throw x; }
  })();
  connected.catch(() => {});
  return { reply, code, client, connected, cancel: () => { client.close(); try { pc.close(); } catch { /* closed */ } } };
}

// ───────────────────────── calling a friend by their code ─────────────────────────
// A call is a "knock" on a topic made from the friend's code, signed with the caller's key.
// The friend's game asks them; if they say yes it opens a room only the caller may join and
// answers with its code, sealed so that only the caller can read it.

const friendKeys = (app, code) => roomKeys(app, 'FRIEND-' + code);

/**
 * Be reachable by your friend code while the game is open.
 *   onCall({ from: { key, friendCode, name, known }, accept(roomCode), decline() })
 * Returns { friendCode, ready, close() } straight away. close() stops listening; an answer
 * already given is still sent in full first (so accept, then open the room, then close is fine).
 */
export function listen({ app, onCall, store, profile = '', identity = null, relays = DEFAULT_RELAYS, bus: busFactory = null, WS = globalThis.WebSocket, log = () => {} }) {
  if (!app || typeof onCall !== 'function') throw err('BAD_INPUT', 'listen needs an app name and onCall');
  const me = identity || deviceIdentity(store, profile), fk = friendKeys(app, me.friendCode), seen = new Set();
  let sending = 0, closing = false; // (closing waits for answers still being sent)
  const bus = (busFactory || (o => openBus({ relays, WS, ...o })))({ onMessage: (topic, text) => {
    if (closing) return;
    const m = unseal(fk, text);
    if (!m || m.t !== 'k' || typeof m.id !== 'string' || m.id.length > 40 || !isKey(m.key) || !isKey(m.e) || !Number.isFinite(m.at) || seen.has(m.id)) return;
    if (Math.abs(Date.now() - m.at) > 600000) return; // an old knock played back later
    const name = typeof m.name === 'string' ? m.name.slice(0, 24) : null;
    if (!verifyHex(m.key, signable('gamedb-knock', app, me.friendCode, m.id, m.e, name, m.at), m.g)) return;
    seen.add(m.id);
    let decided = false;
    const reply = async inner => {
      if (decided) return; decided = true;
      const shared = me.shared(m.e); if (!shared) return;
      const line = seal(fk, { t: 'K', id: m.id, key: me.key, box: seal(linkKeys(shared, 'call|' + m.id), inner), g: me.sign(signable('gamedb-call', app, m.id, inner.ok, inner.code ?? null)) });
      sending++;
      try { for (const wait of [0, 800, 1600, 3200, 6400]) { await sleep(wait); bus.publish(fk.topic + '/r/' + m.id, line); } }
      finally { if (--sending === 0 && closing) bus.close(); }
    };
    const known = me.friends.list().some(f => f.key === m.key);
    try {
      onCall({ from: { key: m.key, friendCode: friendCode(m.key), name, known },
        accept: roomCode => reply({ ok: true, code: String(roomCode).toUpperCase() }),
        decline: () => reply({ ok: false }) });
    } catch (x) { log('gamedb-p2p: onCall failed', x); }
  }, log });
  bus.subscribe(fk.topic);
  return { friendCode: me.friendCode, ready: bus.settled, close() { if (closing) return; closing = true; if (!sending) bus.close(); } };
}

/**
 * Call a friend by their code. Resolves with { code, hostKey, friendCode } once they say yes:
 * pass both to joinRoom ({ code, hostKey }). Rejects with NO_ANSWER, DECLINED, NO_RELAY or BAD_INPUT.
 */
export async function callFriend({ app, friendCode: typed, name = null, store, profile = '', identity = null, relays = DEFAULT_RELAYS, bus: busFactory = null, WS = globalThis.WebSocket, timeoutMs = 60000 }) {
  const me = identity || deviceIdentity(store, profile), fc = cleanFriendCode(typed);
  if (!app) throw err('BAD_INPUT', 'callFriend needs an app name');
  if (!fc) throw err('BAD_INPUT', 'That does not look like a friend code.');
  if (fc === me.friendCode) throw err('BAD_INPUT', 'That is your own friend code.');
  const fk = friendKeys(app, fc), id = toHex(randomBytes(8)), eph = newSecretKey(), e = toHex(publicKey(eph));
  let got = null; const answer = new Promise(res => { got = res; });
  const bus = (busFactory || (o => openBus({ relays, WS, ...o })))({ onMessage: (topic, text) => {
    const m = unseal(fk, text);
    if (!m || m.t !== 'K' || m.id !== id || !isKey(m.key) || friendCode(m.key) !== fc) return; // only the person whose code we typed
    const inner = unseal(linkKeys(sharedSecret(eph, fromHex(m.key)) || new Uint8Array(32), 'call|' + id), m.box);
    if (!inner || !verifyHex(m.key, signable('gamedb-call', app, id, inner.ok, inner.code ?? null), m.g)) return;
    got({ ...inner, key: m.key });
  } });
  const knock = { t: 'k', id, key: me.key, e, name: name ? String(name).slice(0, 24) : null, at: Date.now() };
  knock.g = me.sign(signable('gamedb-knock', app, fc, id, e, knock.name, knock.at));
  const text = seal(fk, knock), until = Date.now() + timeoutMs; let r = null;
  try {
    bus.subscribe(fk.topic + '/r/' + id);
    while (!r && Date.now() < until) { bus.publish(fk.topic, text); r = await Promise.race([answer, sleep(2000)]); }
    if (!r && (await Promise.race([bus.settled, sleep(50).then(() => 1)])) === 0 && bus.relaysUp() === 0) throw err('NO_RELAY', 'Could not reach the meeting point. Check your internet.');
  } finally { bus.close(); }
  if (!r) throw err('NO_ANSWER', 'Your friend did not answer. They need the game open.');
  if (!r.ok || typeof r.code !== 'string') throw err('DECLINED', 'Your friend said not now.');
  me.friends.remember({ key: r.key });
  return { code: r.code, hostKey: r.key, friendCode: fc };
}
