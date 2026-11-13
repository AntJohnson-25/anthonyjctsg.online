// GameDB hub — the multiplayer core: accounts, rooms, seats, game rules, relay, live leaderboards.
// It has no network code of its own. Anything that can pass text both ways plugs in with
// hub.connect(conn), so the same hub runs:
//   - inside the host player's browser, with friends connected peer to peer (gamedb-p2p.js);
//   - under Node behind a WebSocket server (gamedb-server.js), for those who want one.
// Zero dependencies; nothing here needs Node.
import { GameDBError } from './gamedb.js';

const fail = (code, msg) => { throw new GameDBError(code, msg); };

// ───────────────────────── small crypto helpers (pure JS, work on any page) ─────────────────────────

const PRIMES = []; for (let n = 2; PRIMES.length < 64; n++) if (PRIMES.every(p => n % p)) PRIMES.push(n);
const frac32 = x => Math.floor((x - Math.floor(x)) * 4294967296) >>> 0;
const SHA_K = new Uint32Array(PRIMES.map(p => frac32(Math.cbrt(p))));
const SHA_H = PRIMES.slice(0, 8).map(p => frac32(Math.sqrt(p)));
const rotr = (x, n) => (x >>> n) | (x << (32 - n));

/** SHA-256 of a Uint8Array. Returns a 32-byte Uint8Array. */
export function sha256(bytes) {
  const l = bytes.length, n = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(n);
  m.set(bytes); m[l] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(n - 8, Math.floor(l / 0x20000000)); dv.setUint32(n - 4, (l << 3) >>> 0);
  const h = new Uint32Array(SHA_H), w = new Uint32Array(64);
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      w[i] = (w[i - 16] + (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) + w[i - 7] + (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10))) | 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += k;
  }
  const out = new Uint8Array(32), ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]);
  return out;
}
const enc = new TextEncoder();
export const utf8 = s => enc.encode(s);
export const toHex = bytes => { let s = ''; for (const b of bytes) s += (b < 16 ? '0' : '') + b.toString(16); return s; };
export const sha256Hex = text => toHex(sha256(utf8(text)));
/** n random bytes. */
export function randomBytes(n) { return globalThis.crypto.getRandomValues(new Uint8Array(n)); }
/** A random id in the usual 8-4-4-4-12 form (works on plain http pages, unlike crypto.randomUUID). */
export function randomId() {
  const b = randomBytes(16); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = toHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alikes (0/O, 1/I)
/** A random code of n easy-to-read characters. */
export function randomCode(n) { let c = ''; for (const b of randomBytes(n)) c += CODE_CHARS[b % CODE_CHARS.length]; return c; }
const sameText = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

// ───────────────────────── the hub ─────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS gk_auth (player_id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS gk_rooms (code TEXT PRIMARY KEY, mode TEXT NOT NULL, host TEXT NOT NULL, status TEXT NOT NULL, private BOOL NOT NULL, max_players INT NOT NULL, options JSON, state JSON, tick INT NOT NULL DEFAULT 0, created TIMESTAMP NOT NULL, updated TIMESTAMP NOT NULL);
CREATE INDEX IF NOT EXISTS gk_rooms_open ON gk_rooms (status, mode);
CREATE TABLE IF NOT EXISTS gk_room_players (code TEXT NOT NULL, player_id TEXT NOT NULL, seat INT NOT NULL, ready BOOL NOT NULL DEFAULT FALSE, connected BOOL NOT NULL DEFAULT TRUE, PRIMARY KEY (code, player_id));
CREATE UNIQUE INDEX IF NOT EXISTS gk_rp_player ON gk_room_players (player_id);
`;

/**
 * Create a hub.
 *   db, kit        an open GameDB and its GameKit
 *   modes          { name: { minPlayers, maxPlayers, autoStart, init, onInput, view, result, onEnd, tickMs, onTick, onLeave } }
 *   actions        { name(ctx, args) }  functions players may call; ctx = { db, kit, player, server }
 *   clientBoards   leaderboard ids players may submit scores to (and sync) directly (default none)
 *   openSignup     true: players bring their own id and secret (made on their device) and the hub
 *                  remembers them on first sight. Used peer to peer, where there is no central
 *                  place to hand out accounts. false: the hub hands out ids ('register').
 *   roomCodes      true: createRoom may ask for a particular code (the host of a peer-to-peer room
 *                  uses the code friends were given)
 *   maxMessagesPerSecond   flood limit per connection
 */
export function createHub({ db, kit, modes = {}, actions = {}, clientBoards = [], openSignup = false, roomCodes = false, log = console.log, maxMessagesPerSecond = 60 }) {
  db.exec(SCHEMA);
  db.run('UPDATE gk_room_players SET connected = FALSE'); // nobody is connected at boot
  const now = () => kit.now();
  const online = new Map();   // player id -> session
  const watchers = new Map(); // board id -> Map(session -> n)
  const timers = [];
  const hub = { db, kit, sendTo, broadcast, connect, online };

  // ── helpers ──
  const str = (v, what, max = 64) => { if (typeof v !== 'string' || !v || v.length > max) fail('BAD_INPUT', `${what} must be text (1 to ${max} characters)`); return v; };
  function sendTo(playerId, msg) { const s = online.get(playerId); if (s) s.conn.send(JSON.stringify(msg)); }
  const members = code => db.query('SELECT rp.player_id AS id, p.name, rp.seat, rp.ready, rp.connected FROM gk_room_players rp LEFT JOIN gk_players p ON p.id = rp.player_id WHERE rp.code = ? ORDER BY rp.seat', [code]);
  function broadcast(code, msg, exceptId) { const text = JSON.stringify(msg); for (const m of members(code)) { if (m.id === exceptId) continue; const s = online.get(m.id); if (s) s.conn.send(text); } }
  const getRoom = code => db.get('SELECT * FROM gk_rooms WHERE code = ?', [code]);
  const roomOf = playerId => { const r = db.get('SELECT code FROM gk_room_players WHERE player_id = ?', [playerId]); return r ? getRoom(r.code) : null; };
  const snapshot = room => ({ code: room.code, mode: room.mode, host: room.host, status: room.status, private: room.private, maxPlayers: room.max_players, tick: room.tick, players: members(room.code) });
  const viewFor = (room, seat) => { const m = modes[room.mode]; return m && m.view ? m.view(room.state, seat) : room.state; };
  const pushRoom = code => { const room = getRoom(code); if (room) broadcast(code, { ev: 'room', room: snapshot(room) }); };
  function pushState(code) {
    const room = getRoom(code); if (!room) return;
    for (const m of members(code)) sendTo(m.id, { ev: 'state', code, tick: room.tick, state: viewFor(room, m.seat) });
  }
  function needRoom(me, status) {
    const room = roomOf(me); if (!room) fail('NO_ROOM', 'you are not in a room');
    if (status && room.status !== status) fail('BAD_STATE', `the room is ${room.status}, not ${status}`);
    return room;
  }
  const seatOf = (code, me) => db.get('SELECT seat FROM gk_room_players WHERE code = ? AND player_id = ?', [code, me]).seat;

  // ── rooms ──
  function newCode() {
    for (let tries = 0; tries < 50; tries++) { const c = randomCode(5); if (!getRoom(c)) return c; }
    fail('INTERNAL', 'could not allocate a room code');
  }
  function createRoom(me, { mode, maxPlayers, private: priv = false, options = null, code: wanted }) {
    const m = modes[str(mode, 'mode')]; if (!m) fail('NO_MODE', `unknown game mode "${mode}"`);
    if (roomOf(me)) fail('IN_ROOM', 'leave your current room first');
    const cap = m.maxPlayers ?? 8, max = maxPlayers ?? cap;
    if (!Number.isInteger(max) || max < (m.minPlayers ?? 1) || max > cap) fail('BAD_INPUT', `maxPlayers must be ${m.minPlayers ?? 1} to ${cap}`);
    let code;
    if (wanted !== undefined && wanted !== null) {
      if (!roomCodes) fail('FORBIDDEN', 'room codes are chosen for you here');
      code = str(wanted, 'room code', 12).toUpperCase();
      if (!/^[A-Z0-9]{4,12}$/.test(code)) fail('BAD_INPUT', 'a room code is 4 to 12 letters and digits');
      if (getRoom(code)) fail('IN_USE', 'that room code is already in use');
    } else code = newCode();
    const t = now();
    db.transaction(() => {
      db.run('INSERT INTO gk_rooms (code, mode, host, status, private, max_players, options, tick, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)', [code, mode, me, 'lobby', !!priv, max, options, t, t]);
      db.run('INSERT INTO gk_room_players (code, player_id, seat) VALUES (?, ?, 0)', [code, me]);
    });
    maybeStart(code);
    return code;
  }
  function joinRoom(me, code) {
    const room = getRoom(str(code, 'room code', 12).toUpperCase()); if (!room) fail('NO_ROOM', 'no room has that code');
    if (roomOf(me)) fail('IN_ROOM', 'leave your current room first');
    if (room.status !== 'lobby') fail('BAD_STATE', 'that game has already started');
    const taken = new Set(members(room.code).map(m => m.seat));
    if (taken.size >= room.max_players) fail('FULL', 'that room is full');
    let seat = 0; while (taken.has(seat)) seat++;
    db.run('INSERT INTO gk_room_players (code, player_id, seat) VALUES (?, ?, ?)', [room.code, me, seat]);
    db.run('UPDATE gk_rooms SET updated = ? WHERE code = ?', [now(), room.code]);
    pushRoom(room.code); maybeStart(room.code);
    return room.code;
  }
  function quickMatch(me, mode) {
    if (!modes[str(mode, 'mode')]) fail('NO_MODE', `unknown game mode "${mode}"`);
    for (const r of db.query("SELECT code, max_players FROM gk_rooms WHERE status = 'lobby' AND mode = ? AND private = FALSE", [mode])) {
      if (members(r.code).length < r.max_players) return joinRoom(me, r.code);
    }
    return createRoom(me, { mode });
  }
  function maybeStart(code) {
    const room = getRoom(code); if (!room || room.status !== 'lobby') return;
    const m = modes[room.mode], ps = members(code);
    if (ps.length < (m.minPlayers ?? 1)) return;
    if ((m.autoStart && ps.length >= room.max_players) || ps.every(p => p.ready)) startRoom(room);
  }
  function startRoom(room) {
    const m = modes[room.mode], ps = members(room.code);
    if (ps.length < (m.minPlayers ?? 1)) fail('BAD_STATE', `needs at least ${m.minPlayers} players`);
    const state = m.init ? m.init({ players: ps.map(p => ({ id: p.id, name: p.name, seat: p.seat })), options: room.options }) : {};
    db.run("UPDATE gk_rooms SET status = 'playing', state = ?, tick = 0, updated = ? WHERE code = ?", [state, now(), room.code]);
    pushRoom(room.code); pushState(room.code);
  }
  // Store a new state for a playing room; finish the match if the rules say it is over.
  function commitState(room, state) {
    const m = modes[room.mode];
    const results = m.result ? m.result(state) : null;
    db.transaction(() => {
      db.run('UPDATE gk_rooms SET state = ?, tick = tick + 1, status = ?, updated = ? WHERE code = ?', [state, results ? 'done' : 'playing', now(), room.code]);
      if (results) {
        const bySeat = new Map(members(room.code).map(p => [p.seat, p.id]));
        const players = results.filter(r => bySeat.has(r.seat)).map(r => ({ id: bySeat.get(r.seat), result: r.result ?? null, score: r.score ?? null, stats: r.stats ?? null }));
        const matchId = kit.recordMatch({ mode: room.mode, started: room.created, players });
        if (m.onEnd) m.onEnd({ db, kit, server: hub, room: getRoom(room.code), matchId, players });
      }
    });
    pushState(room.code);
    if (results) pushRoom(room.code);
  }
  function input(me, data) {
    const room = needRoom(me, 'playing'), m = modes[room.mode];
    if (!m.onInput) fail('BAD_STATE', 'this mode does not take inputs');
    const draft = structuredClone(room.state);
    const next = m.onInput(draft, { seat: seatOf(room.code, me), player: me, data });
    commitState(room, next === undefined ? draft : next);
  }
  function leave(me) {
    const room = roomOf(me); if (!room) return;
    const seat = seatOf(room.code, me), m = modes[room.mode];
    db.run('DELETE FROM gk_room_players WHERE code = ? AND player_id = ?', [room.code, me]);
    const left = members(room.code);
    if (!left.length) { db.run('DELETE FROM gk_rooms WHERE code = ?', [room.code]); return; }
    if (room.host === me) db.run('UPDATE gk_rooms SET host = ? WHERE code = ?', [left[0].id, room.code]);
    if (room.status === 'playing' && m && m.onLeave) {
      const draft = structuredClone(room.state), next = m.onLeave(draft, seat);
      commitState(getRoom(room.code), next === undefined ? draft : next);
    }
    pushRoom(room.code);
  }

  // ── what players may ask for ──
  const ops = {
    profile: s => kit.profile(s.player),
    setName: (s, a) => { kit.player(s.player, str(a.name, 'name', 24)); const room = roomOf(s.player); if (room) pushRoom(room.code); return kit.getPlayer(s.player).name; },
    save: (s, a) => kit.save(s.player, a.slot, a.data, a.expectedVersion === undefined ? {} : { expectedVersion: a.expectedVersion }),
    load: (s, a) => kit.load(s.player, a.slot),
    listSaves: s => kit.listSaves(s.player),
    deleteSave: (s, a) => kit.deleteSave(s.player, a.slot),
    top: (s, a) => kit.top(str(a.board, 'board'), a.n ?? 10, { offset: a.offset ?? 0 }),
    rank: (s, a) => kit.rank(str(a.board, 'board'), s.player),
    around: (s, a) => kit.around(str(a.board, 'board'), s.player, Math.min(a.radius ?? 2, 50)),
    submitScore: (s, a) => { if (!clientBoards.includes(a.board)) fail('FORBIDDEN', 'scores for this leaderboard are set by the host'); return kit.submitScore(a.board, s.player, a.score); },
    // Friends boards: a player hands over the scores their device knows and gets back the ones
    // this device knows, so both end up with the same board. `rows` may be left out to only fetch.
    syncBoard: (s, a) => {
      const b = str(a.board, 'board');
      if (a.rows !== undefined && a.rows !== null) { if (!clientBoards.includes(b)) fail('FORBIDDEN', 'this leaderboard is kept by the host'); kit.mergeBoard({ board: b, period: a.period, rows: a.rows }); }
      return kit.exportBoard(b, Math.min(a.n ?? 50, 200));
    },
    watchBoard: (s, a) => { const b = str(a.board, 'board'), n = Math.min(a.n ?? 10, 100); const top = kit.top(b, n); if (!watchers.has(b)) watchers.set(b, new Map()); watchers.get(b).set(s, n); return top; },
    unwatchBoard: (s, a) => { const w = watchers.get(a.board); if (w) w.delete(s); return true; },
    action: (s, a) => { const fn = Object.hasOwn(actions, a.name) ? actions[a.name] : null; if (!fn) fail('NO_ACTION', `unknown action "${a.name}"`); return fn({ db, kit, player: s.player, server: hub }, a.args ?? {}); },
    createRoom: (s, a) => { const code = createRoom(s.player, a); return snapshot(getRoom(code)); },
    joinRoom: (s, a) => snapshot(getRoom(joinRoom(s.player, a.code))),
    quickMatch: (s, a) => snapshot(getRoom(quickMatch(s.player, a.mode))),
    leaveRoom: s => { leave(s.player); return true; },
    room: s => { const room = roomOf(s.player); return room ? { room: snapshot(room), state: room.status === 'lobby' ? null : viewFor(room, seatOf(room.code, s.player)) } : null; },
    ready: (s, a) => { const room = needRoom(s.player, 'lobby'); db.run('UPDATE gk_room_players SET ready = ? WHERE code = ? AND player_id = ?', [a.ready !== false, room.code, s.player]); pushRoom(room.code); maybeStart(room.code); return true; },
    start: s => { const room = needRoom(s.player, 'lobby'); if (room.host !== s.player) fail('FORBIDDEN', 'only the host can start the game'); startRoom(room); return true; },
    // Play again with the same people: the host of a finished room starts a fresh match in it.
    rematch: s => { const room = needRoom(s.player, 'done'); if (room.host !== s.player) fail('FORBIDDEN', 'only the host can start a rematch'); db.run('UPDATE gk_rooms SET created = ? WHERE code = ?', [now(), room.code]); startRoom(room); return true; },
    input: (s, a) => { input(s.player, a.data); return true; },
    // Fast path for action games: passed straight to the rest of the room, never stored.
    // With `to`, only that room member gets it (private data such as a hand of cards).
    relay: (s, a) => {
      const room = needRoom(s.player), msg = { ev: 'relay', from: s.player, data: a.data };
      if (a.to === undefined || a.to === null) broadcast(room.code, msg, s.player);
      else {
        if (!db.get('SELECT seat FROM gk_room_players WHERE code = ? AND player_id = ?', [room.code, str(a.to, 'to')])) fail('BAD_INPUT', 'that player is not in your room');
        sendTo(a.to, msg);
      }
      return true;
    },
    // The hub's clock, so every player in a room can agree on timings.
    time: () => Date.now(),
  };

  function login(s, playerId) {
    const old = online.get(playerId);
    if (old && old !== s) { old.player = null; old.conn.send(JSON.stringify({ ev: 'kicked', reason: 'signed in somewhere else' })); old.conn.close(); }
    s.player = playerId; online.set(playerId, s);
    const room = roomOf(playerId);
    if (room) { db.run('UPDATE gk_room_players SET connected = TRUE WHERE code = ? AND player_id = ?', [room.code, playerId]); pushRoom(room.code); }
    const p = kit.getPlayer(playerId);
    return { playerId, name: p.name, room: room ? snapshot(getRoom(room.code)) : null, state: room && room.status !== 'lobby' ? viewFor(room, seatOf(room.code, playerId)) : null };
  }
  function handle(s, msg) {
    const a = msg.a && typeof msg.a === 'object' ? msg.a : {};
    if (msg.op === 'register') {
      if (s.player) fail('BAD_STATE', 'already signed in');
      const id = randomId(), secret = toHex(randomBytes(24));
      db.transaction(() => { kit.player(id, a.name ?? null); db.run('INSERT INTO gk_auth VALUES (?, ?)', [id, sha256Hex(secret)]); });
      return { ...login(s, id), secret };
    }
    if (msg.op === 'hello') {
      const id = str(a.playerId, 'playerId'), given = sha256Hex(str(a.secret, 'secret', 128));
      const row = db.get('SELECT secret_hash FROM gk_auth WHERE player_id = ?', [id]);
      if (!row && openSignup) {
        // First time this hub meets this player: remember the secret they came with.
        if (!/^[0-9a-f-]{16,64}$/.test(id) || a.secret.length < 16) fail('AUTH', 'that is not a valid player id and secret');
        db.transaction(() => { kit.player(id, a.name ?? null); db.run('INSERT INTO gk_auth VALUES (?, ?)', [id, given]); });
        return login(s, id);
      }
      if (!row || !sameText(given, row.secret_hash)) fail('AUTH', 'unknown player or wrong secret');
      kit.player(id, a.name ?? null);
      return login(s, id);
    }
    if (!s.player) fail('AUTH', 'sign in first (register or hello)');
    const fn = Object.hasOwn(ops, msg.op) ? ops[msg.op] : null;
    if (!fn) fail('NO_OP', `unknown request "${msg.op}"`);
    return fn(s, a);
  }

  /**
   * Plug a connection in. conn = { send(text), close(code) } and the hub sets conn.onmessage(text)
   * and conn.onclose(), which the connection calls. `trusted` skips the flood limit (the host's own link).
   */
  function connect(conn, { trusted = false } = {}) {
    const s = { conn, player: null, bucket: maxMessagesPerSecond, last: Date.now() };
    conn.onmessage = text => {
      if (!trusted) {
        const t = Date.now(); s.bucket = Math.min(maxMessagesPerSecond, s.bucket + (t - s.last) / 1000 * maxMessagesPerSecond); s.last = t;
        if (--s.bucket < 0) return conn.close(1008); // flooding
      }
      let msg; try { msg = JSON.parse(text); } catch { return conn.close(1007); }
      if (!msg || typeof msg !== 'object' || typeof msg.op !== 'string') return conn.close(1007);
      let reply;
      try { reply = { id: msg.id, ok: true, r: handle(s, msg) ?? null }; }
      catch (e) {
        if (e instanceof GameDBError) reply = { id: msg.id, ok: false, e: { code: e.code, message: e.message } };
        else { log('gamedb hub error in', msg.op, e); reply = { id: msg.id, ok: false, e: { code: 'INTERNAL', message: 'server error' } }; }
      }
      conn.send(JSON.stringify(reply));
    };
    conn.onclose = () => {
      for (const w of watchers.values()) w.delete(s);
      if (!s.player || online.get(s.player) !== s) return;
      online.delete(s.player);
      try {
        const room = roomOf(s.player); if (!room) return;
        if (room.status === 'lobby') leave(s.player); // free the seat for someone else
        else { db.run('UPDATE gk_room_players SET connected = FALSE WHERE code = ? AND player_id = ?', [room.code, s.player]); pushRoom(room.code); }
      } catch (e) { log('gamedb hub error on disconnect', e); }
    };
    return s;
  }

  // ── live leaderboards: push the new top-N when scores change ──
  const dirtyBoards = new Set(); let boardTimer = null;
  const stopWatching = db.onChange(opsList => {
    for (const op of opsList) {
      if (op[1] !== 'gk_scores') continue;
      if (op[0] === 'd') for (const b of watchers.keys()) dirtyBoards.add(b); else dirtyBoards.add(op[3][0]);
    }
    if (dirtyBoards.size && !boardTimer) boardTimer = setTimeout(() => {
      boardTimer = null;
      for (const b of dirtyBoards) { const w = watchers.get(b); if (!w) continue; for (const [s, n] of w) { try { s.conn.send(JSON.stringify({ ev: 'board', board: b, top: kit.top(b, n) })); } catch (e) { log(e); } } }
      dirtyBoards.clear();
    }, 150);
  });

  // ── tick loops for real-time modes: state advances by SQL-stored steps ──
  for (const [name, m] of Object.entries(modes)) {
    if (!m.tickMs || !m.onTick) continue;
    let last = Date.now();
    timers.push(setInterval(() => {
      const t = Date.now(), dt = t - last; last = t;
      for (const { code } of db.query("SELECT code FROM gk_rooms WHERE status = 'playing' AND mode = ?", [name])) {
        try { const room = getRoom(code), draft = structuredClone(room.state), next = m.onTick(draft, dt); if (next !== null && next !== false) commitState(room, next === undefined ? draft : next); }
        catch (e) { log('gamedb hub tick error in', name, e); }
      }
    }, m.tickMs));
  }
  // ── cleanup: drop finished rooms after 10 minutes and abandoned ones after 2 ──
  timers.push(setInterval(() => {
    const t = now();
    for (const r of db.query('SELECT code, status, updated FROM gk_rooms')) {
      const anyone = members(r.code).some(m => m.connected);
      if ((r.status === 'done' && t - r.updated > 600000) || (!anyone && t - r.updated > 120000)) {
        db.transaction(() => { db.run('DELETE FROM gk_room_players WHERE code = ?', [r.code]); db.run('DELETE FROM gk_rooms WHERE code = ?', [r.code]); });
      }
    }
  }, 30000));
  for (const t of timers) if (t && t.unref) t.unref();

  /** Stop the hub's timers and disconnect everyone. */
  hub.close = () => {
    for (const t of timers) clearInterval(t);
    if (boardTimer) clearTimeout(boardTimer);
    stopWatching();
    for (const s of [...online.values()]) s.conn.close(1001);
  };
  return hub;
}
