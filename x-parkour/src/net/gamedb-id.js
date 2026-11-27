// GameDB identity — every device has its own key, and players find and trust each other by it.
//
//   const me = deviceIdentity(localStorage-like store);   // made on first use, kept for good
//   me.playerId   the id boards and rooms know you by (unchanged from before keys existed)
//   me.key        your public key (64 hex characters)
//   me.friendCode the short form friends type in: 'K7QM-2PXA-9GHE'
//   me.sign(bytes) -> signature (hex); verifyHex(key, bytes, signature) -> true/false
//
// Signatures are Schnorr signatures over the secp256k1 curve (BIP-340, the same kind Nostr uses),
// written here in plain JavaScript, so they work on any page (http, https, a file opened by
// double-click) and under Node, with nothing to install. Zero dependencies.
import { sha256, utf8, toHex, randomBytes, CODE_CHARS } from './gamedb-hub.js';

// ───────────────────────── the curve ─────────────────────────

const P = 2n ** 256n - 0x1000003d1n;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = [0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n, 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n, 1n];
const mod = (a, m = P) => { const r = a % m; return r >= 0n ? r : r + m; };
function inv(a, m = P) {
  let lm = 1n, hm = 0n, low = mod(a, m), high = m;
  if (low === 0n) throw new Error('no inverse');
  while (low > 1n) { const r = high / low; [lm, hm] = [hm - lm * r, lm]; [low, high] = [high - low * r, low]; }
  return mod(lm, m);
}
function pow(b, e, m = P) { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }
// Points are [X, Y, Z] (Jacobian); Z = 0 is the point at infinity.
function dbl([x, y, z]) {
  if (z === 0n || y === 0n) return [0n, 1n, 0n];
  const a = x * x % P, b = y * y % P, c = b * b % P, d = mod(2n * ((x + b) ** 2n - a - c)), e = 3n * a % P, f = e * e % P;
  const x3 = mod(f - 2n * d);
  return [x3, mod(e * (d - x3) - 8n * c), 2n * y * z % P];
}
function add(p1, p2) {
  if (p1[2] === 0n) return p2; if (p2[2] === 0n) return p1;
  const [x1, y1, z1] = p1, [x2, y2, z2] = p2, z1z1 = z1 * z1 % P, z2z2 = z2 * z2 % P;
  const u1 = x1 * z2z2 % P, u2 = x2 * z1z1 % P, s1 = y1 * z2 % P * z2z2 % P, s2 = y2 * z1 % P * z1z1 % P;
  const h = mod(u2 - u1), r = mod(s2 - s1);
  if (h === 0n) return r === 0n ? dbl(p1) : [0n, 1n, 0n];
  const h2 = h * h % P, h3 = h * h2 % P, u1h2 = u1 * h2 % P, x3 = mod(r * r - h3 - 2n * u1h2);
  return [x3, mod(r * (u1h2 - x3) - s1 * h3), h * z1 % P * z2 % P];
}
function mul(k, p = G) { let r = [0n, 1n, 0n]; for (const bit of k.toString(2)) { r = dbl(r); if (bit === '1') r = add(r, p); } return r; }
function affine([x, y, z]) { if (z === 0n) return null; const zi = inv(z), zi2 = zi * zi % P; return { x: x * zi2 % P, y: y * zi2 % P * zi % P }; }
function liftX(x) {
  if (x >= P) return null;
  const c = mod(x ** 3n + 7n), y = pow(c, (P + 1n) / 4n);
  if (y * y % P !== c) return null;
  return [x, y & 1n ? P - y : y, 1n];
}

const big = bytes => bytes.length ? BigInt('0x' + toHex(bytes)) : 0n;
const bytes32 = n => fromHex(n.toString(16).padStart(64, '0'));
export function fromHex(hex) {
  if (typeof hex !== 'string' || hex.length % 2 || /[^0-9a-f]/i.test(hex)) throw new Error('not hex');
  const out = new Uint8Array(hex.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16); return out;
}
function cat(...parts) { let n = 0; for (const p of parts) n += p.length; const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
const tags = new Map();
function tagged(tag, ...parts) { let t = tags.get(tag); if (!t) { t = sha256(utf8(tag)); tags.set(tag, t); } return sha256(cat(t, t, ...parts)); }

// ───────────────────────── BIP-340 Schnorr ─────────────────────────

/** A fresh secret key (32 bytes). */
export function newSecretKey() { for (;;) { const k = randomBytes(32), d = big(k); if (d > 0n && d < N) return k; } }
/** The public key (32 bytes, x only) of a secret key. */
export function publicKey(sk) { const d = big(sk); if (d <= 0n || d >= N) throw new Error('bad secret key'); return bytes32(affine(mul(d)).x); }
/** Sign a message (bytes) with a secret key (bytes). Returns 64 bytes. `aux` = 32 random bytes (given only by tests). */
const signers = new Map(); // secret key -> its public point, worked out once (the slow part)
export function schnorrSign(msg, sk, aux = randomBytes(32)) {
  const d0 = big(sk); if (d0 <= 0n || d0 >= N) throw new Error('bad secret key');
  let pp = signers.get(d0); if (!pp) { pp = affine(mul(d0)); if (signers.size > 8) signers.clear(); signers.set(d0, pp); }
  const d = pp.y & 1n ? N - d0 : d0, px = bytes32(pp.x);
  const ax = tagged('BIP0340/aux', aux), t = bytes32(d).map((b, i) => b ^ ax[i]);
  const k0 = mod(big(tagged('BIP0340/nonce', t, px, msg)), N); if (k0 === 0n) throw new Error('bad nonce');
  const r = affine(mul(k0)), k = r.y & 1n ? N - k0 : k0, rx = bytes32(r.x);
  const e = mod(big(tagged('BIP0340/challenge', rx, px, msg)), N);
  return cat(rx, bytes32(mod(k + e * d, N)));
}
/** Check a signature. pub = 32 bytes, sig = 64 bytes. */
export function schnorrVerify(msg, pub, sig) {
  if (!pub || pub.length !== 32 || !sig || sig.length !== 64) return false;
  const pp = liftX(big(pub)); if (!pp) return false;
  const r = big(sig.subarray(0, 32)), s = big(sig.subarray(32)); if (r >= P || s >= N) return false;
  const e = mod(big(tagged('BIP0340/challenge', sig.subarray(0, 32), pub, msg)), N);
  const R = affine(add(mul(s), mul(mod(N - e, N), pp)));
  return !!R && !(R.y & 1n) && R.x === r;
}
/** Hex-in, hex-out forms (keys and signatures travel as hex). */
export function verifyHex(keyHex, msg, sigHex) { try { return schnorrVerify(msg, fromHex(keyHex), fromHex(sigHex)); } catch { return false; } }
/**
 * A secret both sides can work out and nobody else can (Diffie-Hellman on the same curve):
 * shared(mySecret, theirPublic) === shared(theirSecret, myPublic). Returns 32 bytes, or null.
 */
export function sharedSecret(sk, theirPub) {
  try { const p = liftX(big(theirPub)), d = big(sk); if (!p || d <= 0n || d >= N) return null; const q = affine(mul(d, p)); return q ? sha256(cat(utf8('gamedb-dh'), bytes32(q.x))) : null; }
  catch { return null; }
}

// ───────────────────────── friend codes ─────────────────────────

/** The short code for a public key: 12 easy-to-read characters, 'K7QM-2PXA-9GHE'. */
export function friendCode(keyHex) {
  const h = sha256(fromHex(keyHex)); let bits = 0n, out = '';
  for (let i = 0; i < 8; i++) bits = (bits << 8n) | BigInt(h[i]);
  for (let i = 0; i < 12; i++) out += CODE_CHARS[Number((bits >> BigInt(59 - i * 5)) & 31n)];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`;
}
/** Tidy what someone typed into a friend code (or null if it cannot be one). */
export function cleanFriendCode(text) {
  const c = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length !== 12 || [...c].some(ch => !CODE_CHARS.includes(ch))) return null;
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}

// ───────────────────────── this device ─────────────────────────

function defaultStore() {
  try { const ls = globalThis.localStorage; if (ls) return { get: k => ls.getItem(k), set: (k, v) => ls.setItem(k, v) }; } catch { /* storage blocked */ }
  const m = new Map(); return { get: k => m.get(k) ?? null, set: (k, v) => { m.set(k, v); } };
}
const hex = n => toHex(randomBytes(n));

/**
 * This device's player: made on first use and kept in `store` ({ get, set }, localStorage by default).
 * Older saves (an id and a secret from before keys) keep their id and gain a key.
 * `profile` keeps several players apart on one device (tests, or two players sharing a computer).
 */
export function deviceIdentity(store = defaultStore(), profile = '') {
  const slot = `gamedb:me:${profile}`;
  let saved = null; try { saved = JSON.parse(store.get(slot)); } catch { /* none yet */ }
  if (!saved || typeof saved !== 'object') saved = {};
  let changed = false;
  if (typeof saved.playerId !== 'string' || typeof saved.secret !== 'string') { saved.playerId = `${hex(4)}-${hex(2)}-${hex(2)}-${hex(2)}-${hex(6)}`; saved.secret = hex(24); changed = true; }
  let sk = null; try { sk = fromHex(saved.sk); publicKey(sk); } catch { sk = null; }
  if (!sk) { sk = newSecretKey(); saved.sk = toHex(sk); changed = true; }
  if (changed) { try { store.set(slot, JSON.stringify(saved)); } catch { /* storage full or blocked: this visit only */ } }
  const key = toHex(publicKey(sk));
  return {
    playerId: saved.playerId, secret: saved.secret, key, friendCode: friendCode(key),
    sign: msg => toHex(schnorrSign(msg, sk)),
    shared: theirKey => { try { return sharedSecret(sk, fromHex(theirKey)); } catch { return null; } },
    friends: friendsList(store, profile),
  };
}

/** Text to sign (as bytes) for one purpose: purpose + each part, joined unambiguously. */
export function signable(purpose, ...parts) { return sha256(utf8(JSON.stringify([purpose, ...parts]))); }

// ───────────────────────── friends ─────────────────────────

/**
 * The people this device has played with or added, kept in the same store:
 *   list() -> [{ friendCode, key, playerId, name, seen }] newest first
 *   remember({ key, playerId, name })   add or refresh (called for you after sharing a room)
 *   forget(friendCode)
 */
export function friendsList(store = defaultStore(), profile = '') {
  const slot = `gamedb:friends:${profile}`;
  const read = () => { try { const a = JSON.parse(store.get(slot)); return Array.isArray(a) ? a : []; } catch { return []; } };
  const write = a => { try { store.set(slot, JSON.stringify(a.slice(0, 100))); } catch { /* full */ } };
  return {
    list: () => read().sort((a, b) => b.seen - a.seen),
    remember({ key, playerId = null, name = null }) {
      if (typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key)) return false;
      const a = read(), i = a.findIndex(f => f.key === key), was = i >= 0 ? a[i] : null;
      const f = { friendCode: friendCode(key), key, playerId: playerId || (was && was.playerId) || null, name: (name && String(name).slice(0, 24)) || (was && was.name) || null, seen: Date.now() };
      if (i >= 0) a.splice(i, 1); a.unshift(f); write(a); return true;
    },
    forget(code) { const a = read(), b = a.filter(f => f.friendCode !== code && f.key !== code); write(b); return b.length !== a.length; },
  };
}
