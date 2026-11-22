// GameDB meeting points — how two browsers that know nothing about each other's address find
// each other. Free public services that pass short messages along:
//   - MQTT brokers (message brokers anyone may use)
//   - Nostr relays (a large network of independent relays)
//   - WebTorrent trackers (the servers BitTorrent-in-the-browser uses to find peers)
// All of them are raced at once, so any one being down, slow or blocked does not matter.
// Everything sent through them is sealed first (see gamedb-p2p.js): they only ever see
// unreadable text on a topic that is itself a hash. Nothing is stored there.
//
//   relays: ['wss://broker.example/mqtt', 'nostr:wss://relay.example', 'bt:wss://tracker.example']
//   (a plain address is an MQTT broker)
// Zero dependencies.
import { sha256, utf8, toHex, randomBytes } from './gamedb-hub.js';
import { newSecretKey, publicKey, schnorrSign, fromHex } from './gamedb-id.js';

/** The public meeting points used by default. Checked by tests/check_relays.js (2026-11-21: all but HiveMQ delivered, 0.1 to 0.3 s). */
export const DEFAULT_RELAYS = [
  'wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081/mqtt', 'wss://broker.hivemq.com:8884/mqtt',
  'nostr:wss://nos.lol', 'nostr:wss://nostr.mom', 'nostr:wss://relay.primal.net',
  'bt:wss://tracker.openwebtorrent.com', 'bt:wss://tracker.webtorrent.dev',
];

const dec = new TextDecoder();
export function concat(parts) { let n = 0; for (const p of parts) n += p.length; const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
export function b64(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
export function unb64(text) { return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); }

// ── sealing: everything that passes through a meeting point is encrypted and signed first ──
// keys = { enc, mac } (32 bytes each). SHA-256 in counter mode + HMAC-SHA-256, pure JS so it
// also works on plain http and file:// pages.
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
/** Encrypt and sign a JSON-compatible value. Returns link-safe text. */
export function seal(keys, value) {
  const pt = utf8(JSON.stringify(value)), nonce = randomBytes(12), ks = keystream(keys.enc, nonce, pt.length);
  const ct = pt.map((b, i) => b ^ ks[i]);
  return b64(concat([nonce, hmac(keys.mac, concat([nonce, ct])).subarray(0, 16), ct]));
}
/** The value inside text made by seal with the same keys, or null if it is not one. */
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

/** What kind of meeting point an address is: { kind: 'mqtt' | 'nostr' | 'bt', url }. */
export function relayKind(spec) {
  const s = String(spec);
  if (s.startsWith('nostr:')) return { kind: 'nostr', url: s.slice(6) };
  if (s.startsWith('bt:')) return { kind: 'bt', url: s.slice(3) };
  return { kind: 'mqtt', url: s };
}

// Each opener resolves with { url, subscribe(topic), publish(topic, text), close() } once connected,
// calls onMessage(topic, text) for messages on subscribed topics and onClose() if the line drops later.
function socket(url, protocols, WS, timeoutMs, onUp, onData, onClose, rej) {
  let ws; try { ws = protocols ? new WS(url, protocols) : new WS(url); } catch (e) { rej(e); return null; }
  let up = false, done = false;
  const s = {
    send: data => { if (!done && ws.readyState === 1) ws.send(data); },
    up: () => { if (up) return; up = true; clearTimeout(timer); onUp(); },
    stop: why => {
      if (done) return; done = true; clearTimeout(timer); if (s.onStop) s.onStop();
      try { ws.close(); } catch { /* already closed */ }
      if (up) { const f = onClose(); if (f) f(); } else rej(why instanceof Error ? why : new Error(String(why)));
    },
    ws, onStop: null,
  };
  const timer = setTimeout(() => s.stop('timed out'), timeoutMs);
  ws.onerror = () => s.stop('could not connect');
  ws.onclose = () => s.stop('closed');
  ws.onmessage = ev => { try { onData(ev.data); } catch (e) { console.error(e); } };
  return s;
}

// ── MQTT 3.1.1, just enough: connect, subscribe, publish (no delivery guarantees), keep-alive ──
// (Connecting can take a while: a slow name lookup alone has been seen to take 10 seconds.)
const CONNECT_MS = 12000;
export function mqttOpen(url, { onMessage, onClose, WS = globalThis.WebSocket, timeoutMs = CONNECT_MS }) {
  return new Promise((res, rej) => {
    let buf = new Uint8Array(0), pid = 0, ping = null, api = null;
    const str = s => { const b = utf8(s); return concat([Uint8Array.of(b.length >> 8, b.length & 255), b]); };
    const packet = (first, parts) => {
      const body = concat(parts), head = [first]; let n = body.length;
      do { let d = n % 128; n = Math.floor(n / 128); if (n) d |= 128; head.push(d); } while (n);
      return concat([Uint8Array.from(head), body]);
    };
    const s = socket(url, 'mqtt', WS, timeoutMs, () => res(api), data => {
      if (typeof data === 'string') return;
      buf = concat([buf, new Uint8Array(data)]);
      if (buf.length > 1048576) return s.stop('too much data');
      for (;;) {
        if (buf.length < 2) return;
        let len = 0, mul = 1, i = 1, b;
        do { if (i >= buf.length) return; if (i > 4) return s.stop('bad packet'); b = buf[i++]; len += (b & 127) * mul; mul *= 128; } while (b & 128);
        if (buf.length < i + len) return;
        const first = buf[0], body = buf.slice(i, i + len); buf = buf.slice(i + len);
        const type = first >> 4;
        if (type === 2) { // connection accepted (or not)
          if (body[1] !== 0) return s.stop('refused');
          ping = setInterval(() => s.send(Uint8Array.of(0xc0, 0)), 25000); if (ping.unref) ping.unref();
          s.up();
        } else if (type === 3 && body.length >= 2) { // a message
          const tl = (body[0] << 8) | body[1], off = 2 + tl + ((first >> 1) & 3 ? 2 : 0);
          if (off <= body.length) onMessage(dec.decode(body.subarray(2, 2 + tl)), dec.decode(body.subarray(off)));
        }
      }
    }, () => onClose, rej);
    if (!s) return;
    s.ws.binaryType = 'arraybuffer';
    s.onStop = () => clearInterval(ping);
    s.ws.onopen = () => s.send(packet(0x10, [str('MQTT'), Uint8Array.of(4, 2, 0, 60), str('gdb' + toHex(randomBytes(8)))]));
    api = {
      url,
      subscribe: topic => s.send(packet(0x82, [Uint8Array.of(++pid >> 8, pid & 255), str(topic), Uint8Array.of(0)])),
      // retain: the broker keeps this message and hands it to whoever subscribes later (mailboxes, gamedb-mail.js).
      publish: (topic, text, retain = false) => s.send(packet(retain ? 0x31 : 0x30, [str(topic), utf8(text)])),
      close: () => { onClose = null; s.stop('closed'); },
    };
  });
}

// ── Nostr (NIP-01): signed events over a WebSocket ──
// Kinds 20000-29999 are "ephemeral": relays hand them to whoever is listening and never store
// them. Relays check every event's signature, so each bus signs with a throwaway key of its own.
export const NOSTR_KIND = 21059;
// Kind 30078 (NIP-78, app data) is stored, one event per author + 'd' tag: mailboxes (gamedb-mail.js).
export const MAIL_KIND = 30078;
export function nostrSigner() {
  const sk = newSecretKey(), pub = toHex(publicKey(sk)), made = new Map();
  return (topic, text) => {
    const k = topic + '\n' + text; let ev = made.get(k); if (ev) return ev;
    const created_at = Math.floor(Date.now() / 1000), tags = [['x', topic]];
    const id = toHex(sha256(utf8(JSON.stringify([0, pub, created_at, NOSTR_KIND, tags, text]))));
    ev = { id, pubkey: pub, created_at, kind: NOSTR_KIND, tags, content: text, sig: toHex(schnorrSign(fromHex(id), sk)) };
    if (made.size > 32) made.clear(); made.set(k, ev); return ev;
  };
}
export function nostrOpen(url, { onMessage, onClose, WS = globalThis.WebSocket, timeoutMs = CONNECT_MS, sign = nostrSigner() }) {
  return new Promise((res, rej) => {
    const subs = new Map(); let api = null;
    const s = socket(url, null, WS, timeoutMs, () => res(api), data => {
      if (typeof data !== 'string') return;
      let m; try { m = JSON.parse(data); } catch { return; }
      if (!Array.isArray(m) || m[0] !== 'EVENT' || !m[2] || typeof m[2].content !== 'string' || !Array.isArray(m[2].tags)) return;
      const tag = m[2].tags.find(t => Array.isArray(t) && t[0] === 'x');
      if (tag && subs.get(tag[1]) === m[1]) onMessage(tag[1], m[2].content, m[2]);
    }, () => onClose, rej);
    if (!s) return;
    s.ws.onopen = () => s.up();
    api = {
      url,
      // stored: also hand over the stored mailbox letters (MAIL_KIND) on this topic, not only new messages.
      subscribe(topic, { stored = false } = {}) {
        if (subs.has(topic)) return; const id = 'g' + toHex(randomBytes(6)); subs.set(topic, id);
        s.send(JSON.stringify(['REQ', id, stored ? { kinds: [MAIL_KIND], '#x': [topic], limit: 200 } : { kinds: [NOSTR_KIND], '#x': [topic], since: Math.floor(Date.now() / 1000) - 60 }]));
      },
      publish: (topic, text) => s.send(JSON.stringify(['EVENT', sign(topic, text)])),
      /** Send an event that is already signed (a mailbox letter, which the relay keeps). */
      put: ev => s.send(JSON.stringify(['EVENT', ev])),
      close: () => { onClose = null; for (const id of subs.values()) s.send(JSON.stringify(['CLOSE', id])); s.stop('closed'); },
    };
  });
}

// ── WebTorrent trackers: the "offer" relay of BitTorrent in the browser ──
// A tracker groups peers by a 20-character swarm id and hands each "offer" a peer announces
// to another peer of the same swarm, untouched. We use a swarm per topic and put our own
// sealed text where the offer would go. Being in a swarm = being subscribed.
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const id20 = () => { let s = ''; for (const b of randomBytes(20)) s += ALNUM[b % ALNUM.length]; return s; };
export const swarmOf = topic => b64(sha256(utf8('gamedb-bt|' + topic))).slice(0, 20);
export function trackerOpen(url, { onMessage, onClose, WS = globalThis.WebSocket, timeoutMs = CONNECT_MS, copies = 3 }) {
  return new Promise((res, rej) => {
    const me = id20(), swarms = new Map(); let api = null, again = null;
    const announce = (hash, extra = {}) => s.send(JSON.stringify({ action: 'announce', info_hash: hash, peer_id: me, numwant: (extra.offers || []).length, uploaded: 0, downloaded: 0, left: 1, ...extra }));
    const s = socket(url, null, WS, timeoutMs, () => res(api), data => {
      if (typeof data !== 'string') return;
      let m; try { m = JSON.parse(data); } catch { return; }
      if (!m || m.action !== 'announce' || !m.offer || typeof m.offer.sdp !== 'string') return;
      const topic = swarms.get(m.info_hash); if (topic) onMessage(topic, m.offer.sdp);
    }, () => onClose, rej);
    if (!s) return;
    s.onStop = () => clearInterval(again);
    s.ws.onopen = () => {
      // Trackers forget peers that stay quiet for a couple of minutes.
      again = setInterval(() => { for (const h of swarms.keys()) announce(h); }, 50000); if (again.unref) again.unref();
      s.up();
    };
    api = {
      url,
      subscribe(topic) { const h = swarmOf(topic); if (swarms.has(h)) return; swarms.set(h, topic); announce(h, { event: 'started' }); },
      publish(topic, text) {
        const h = swarmOf(topic), offers = []; for (let i = 0; i < copies; i++) offers.push({ offer_id: id20(), offer: { type: 'offer', sdp: text } });
        announce(h, { offers });
        if (!swarms.has(h)) announce(h, { event: 'stopped' }); // only passing through: leave that swarm again
      },
      close: () => { onClose = null; for (const h of swarms.keys()) announce(h, { event: 'stopped' }); s.stop('closed'); },
    };
  });
}

const OPENERS = { mqtt: mqttOpen, nostr: nostrOpen, bt: trackerOpen };

// ───────────────────────── the bus ─────────────────────────
// One "bus" = every meeting point we could reach, plus a same-computer channel between browser
// tabs. A message is published on all of them; the first copy to arrive wins, the rest are dropped.

/**
 * Open a bus. onMessage(topic, text) is called once per distinct message.
 * Returns { publish, subscribe, close, relaysUp(), settled } — `settled` resolves with the number
 * of meeting points that connected, once every one has either connected or failed.
 */
export function openBus({ relays = DEFAULT_RELAYS, WS = globalThis.WebSocket, onMessage, local = true, log = () => {} }) {
  const links = new Set(), topics = new Set(), seen = new Set(), order = [], sign = nostrSigner();
  let closed = false, bc = null;
  const got = (topic, text) => {
    // Sealed texts start with a random nonce and tag, so their opening characters tell them apart.
    const id = text.length + ':' + text.slice(0, 48);
    if (closed || !topics.has(topic) || seen.has(id)) return;
    seen.add(id); order.push(id); if (order.length > 2000) seen.delete(order.shift());
    onMessage(topic, text);
  };
  if (local && typeof BroadcastChannel !== 'undefined') {
    try { bc = new BroadcastChannel('gamedb-p2p'); bc.onmessage = ev => { const m = ev.data; if (m && typeof m.t === 'string' && typeof m.x === 'string') got(m.t, m.x); }; if (bc.unref) bc.unref(); } catch { bc = null; }
  }
  const dial = (spec, wait = 5000) => {
    const { kind, url } = relayKind(spec);
    return OPENERS[kind](url, { WS, sign, onMessage: got, onClose: () => {
      for (const l of links) if (l.spec === spec) links.delete(l);
      if (!closed) setTimeout(() => { if (!closed) dial(spec, Math.min(wait * 2, 60000)).catch(() => {}); }, wait);
    } }).then(link => { if (closed) { link.close(); return false; } link.spec = spec; links.add(link); for (const t of topics) link.subscribe(t); return true; });
  };
  const tries = WS ? relays.map(spec => dial(spec).catch(e => { log('gamedb: meeting point unavailable', spec, e && e.message); return false; })) : [];
  return {
    publish(topic, text) { for (const l of links) l.publish(topic, text); if (bc) bc.postMessage({ t: topic, x: text }); },
    subscribe(topic) { if (topics.has(topic)) return; topics.add(topic); for (const l of links) l.subscribe(topic); },
    relaysUp: () => links.size,
    settled: Promise.all(tries).then(r => r.filter(Boolean).length),
    close() { closed = true; for (const l of links) l.close(); links.clear(); if (bc) { try { bc.close(); } catch { /* closed */ } } },
  };
}

/**
 * A bus that lives inside one page or process: for tests and same-page demos.
 *   const net = memoryBus();  pass `bus: net` to hostRoom and joinRoom.
 *   net.loss = 0.2   drops one message in five (to test the relay lane);  net.down = true  drops all.
 */
export function memoryBus({ loss = 0, seed = 7 } = {}) {
  const subs = new Set();
  let r = seed; const rand = () => { r = (r * 1103515245 + 12345) % 2147483648; return r / 2147483648; };
  const factory = ({ onMessage }) => {
    const me = { topics: new Set(), onMessage }; subs.add(me);
    return {
      publish(topic, text) {
        for (const s of subs) {
          if (s === me || !s.topics.has(topic) || factory.down || (factory.loss && rand() < factory.loss)) continue;
          setTimeout(() => { if (subs.has(s)) s.onMessage(topic, text); }, 0);
        }
      },
      subscribe(topic) { me.topics.add(topic); }, relaysUp: () => (factory.down ? 0 : 1), settled: Promise.resolve(factory.down ? 0 : 1), close() { subs.delete(me); },
    };
  };
  factory.loss = loss; factory.down = false;
  return factory;
}
