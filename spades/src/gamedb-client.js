// GameDB client — a game's connection to a room's hub: the host player's browser, reached peer
// to peer (gamedb-p2p.js builds these for you). Zero dependencies. Handles sign-in with this
// device's key, requests with replies, pushed events and automatic reconnects.
//
//   const { client } = await joinRoom({ app: 'spades', code });
//   client.on('state', ({ state }) => draw(state));
//   await client.input({ cell: 4 });
import { signable } from './gamedb-hub.js';

export class GameClientError extends Error {
  constructor(code, msg) { super(msg); this.name = 'GameClientError'; this.code = code; }
}

export class GameClient {
  /**
   * @param label    a name for this connection (shown in messages only)
   * @param opts     transport: async () => an open link { send(text), close(), readyState: 1 } on which this
   *                   client sets onmessage({ data }) and onclose();
   *                 identity: this device's player (gamedb-id.js deviceIdentity);
   *                 name (display name), reconnect (true), retryForMs (keep trying this long after a
   *                 drop, default 60 s), maxRetries, timeoutMs (per request)
   */
  constructor(label, { transport, identity, name = null, reconnect = true, timeoutMs = 10000, maxRetries = Infinity, retryForMs = 60000 } = {}) {
    if (typeof transport !== 'function' || !identity) throw new GameClientError('BAD_INPUT', 'a GameClient needs a transport and an identity');
    this.url = label; this.transport = transport; this.identity = identity; this.name = name;
    this.reconnect = reconnect; this.timeoutMs = timeoutMs; this.maxRetries = maxRetries; this.retryForMs = retryForMs;
    this.ws = null; this.me = null; this._id = 0; this._pending = new Map(); this._handlers = new Map(); this._closed = false; this._retry = 0; this._lostAt = 0;
  }

  /** Listen for an event: 'room', 'state', 'relay', 'board', 'kicked', 'open' (connected or reconnected), 'close',
   *  'reconnecting' ({ attempt, since }), 'lost' (gave up reconnecting), 'host' (this device took over the room). Returns an unsubscribe function. */
  on(ev, fn) { if (!this._handlers.has(ev)) this._handlers.set(ev, new Set()); this._handlers.get(ev).add(fn); return () => this._handlers.get(ev).delete(fn); }
  _emit(ev, data) { const hs = this._handlers.get(ev); if (hs) for (const fn of [...hs]) { try { fn(data); } catch (e) { console.error(e); } } }

  /** Connect and sign in. Resolves with { playerId, name, room, state }. */
  async connect() {
    this._closed = false;
    await this._open();
    this.me = await this._signIn();
    this._retry = 0; this._lostAt = 0;
    this._emit('open', this.me);
    return this.me;
  }
  async _open() {
    const link = await this.transport();
    if (this._closed) { link.close(); throw new GameClientError('CLOSED', 'closed while connecting'); }
    this.ws = link;
    link.onmessage = ev => this._message(ev.data);
    link.onclose = () => {
      if (this.ws !== link) return;
      for (const p of this._pending.values()) { clearTimeout(p.timer); p.rej(new GameClientError('CLOSED', 'connection closed')); }
      this._pending.clear();
      this._emit('close');
      if (this.reconnect && !this._closed && !this._kicked) this._again();
    };
  }
  /** True while the link is up. */
  get connected() { return !!this.ws && this.ws.readyState === 1; }
  /** How this device reaches the host right now: 'direct', 'relay' (slower, through the meeting points) or 'host' (this device is the host). */
  get lane() { return this.ws && this.ws.readyState === 1 ? this.ws.lane || 'direct' : null; }
  _again() {
    if (!this._lostAt) this._lostAt = Date.now();
    const n = this._retry++;
    // Gives up (event 'lost') when the link can never come back ('GONE'), or after retryForMs / maxRetries.
    if (n >= this.maxRetries || Date.now() - this._lostAt > this.retryForMs) { this._closed = true; this._emit('lost'); return; }
    this._emit('reconnecting', { attempt: n + 1, since: this._lostAt });
    setTimeout(() => {
      if (this._closed) return;
      this.connect().catch(e => {
        if (this._closed) return;
        if (e && e.code === 'GONE') { this._closed = true; this._emit('lost'); } else this._again();
      });
    }, n === 0 ? 0 : Math.min(5000, 250 * 2 ** n));
  }
  async _signIn() {
    const me = this.identity, hello = extra => this.call('hello', { playerId: me.playerId, name: this.name, ...extra });
    let nonce = null;
    try { nonce = (await this.call('challenge')).nonce; } catch (e) { if (e.code !== 'NO_OP' && e.code !== 'AUTH') throw e; } // an older host has no keys yet
    if (!nonce) return hello({ secret: me.secret });
    const signed = n => ({ key: me.key, sig: me.sign(signable('gamedb-hello', n, me.playerId, me.key)) });
    try { return await hello(signed(nonce)); }
    catch (e) {
      if (e.code !== 'KEY_UNBOUND') throw e;
      // This host met us before keys existed: show the old secret once so it learns our key.
      return hello({ ...signed((await this.call('challenge')).nonce), secret: me.secret });
    }
  }
  _message(text) {
    let m; try { m = JSON.parse(text); } catch { return; }
    if (m.ev) { if (m.ev === 'kicked') this._kicked = true; this._emit(m.ev, m); return; }
    const p = this._pending.get(m.id); if (!p) return;
    this._pending.delete(m.id); clearTimeout(p.timer);
    if (m.ok) p.res(m.r); else p.rej(new GameClientError(m.e.code, m.e.message));
  }

  /** Send a request and wait for its reply. Rejects with a GameClientError carrying the hub's error code. */
  call(op, a = {}) {
    return new Promise((res, rej) => {
      if (!this.ws || this.ws.readyState !== 1) return rej(new GameClientError('CLOSED', 'not connected'));
      const id = ++this._id;
      const timer = setTimeout(() => { this._pending.delete(id); rej(new GameClientError('TIMEOUT', `no reply to "${op}"`)); }, this.timeoutMs);
      this._pending.set(id, { res, rej, timer });
      this.ws.send(JSON.stringify({ id, op, a }));
    });
  }
  /** Disconnect and stop reconnecting. */
  close() { this._closed = true; if (this.ws) this.ws.close(); }

  // ── player ──
  profile() { return this.call('profile'); }
  setName(name) { return this.call('setName', { name }); }
  // ── saves ──
  save(slot, data, expectedVersion) { return this.call('save', { slot, data, expectedVersion }); }
  load(slot) { return this.call('load', { slot }); }
  listSaves() { return this.call('listSaves'); }
  deleteSave(slot) { return this.call('deleteSave', { slot }); }
  // ── leaderboards ──
  top(board, n = 10, offset = 0) { return this.call('top', { board, n, offset }); }
  rank(board) { return this.call('rank', { board }); }
  around(board, radius = 2) { return this.call('around', { board, radius }); }
  submitScore(board, score) { return this.call('submitScore', { board, score }); }
  /** Get the top n now and a 'board' event each time it changes. */
  watchBoard(board, n = 10) { return this.call('watchBoard', { board, n }); }
  unwatchBoard(board) { return this.call('unwatchBoard', { board }); }
  /** Friends boards: hand over the scores this device knows (kit.exportBoard) and get the hub's back to merge. */
  syncBoard(board, mine = null) { return this.call('syncBoard', mine ? { board, period: mine.period, rows: mine.rows } : { board }); }
  // ── rooms ──
  createRoom(mode, opts = {}) { return this.call('createRoom', { mode, ...opts }); }
  joinRoom(code) { return this.call('joinRoom', { code }); }
  quickMatch(mode) { return this.call('quickMatch', { mode }); }
  leaveRoom() { return this.call('leaveRoom'); }
  room() { return this.call('room'); }
  ready(ready = true) { return this.call('ready', { ready }); }
  start() { return this.call('start'); }
  /** Host only: play again in a finished room with the same people. */
  rematch() { return this.call('rematch'); }
  /** Send a move; the host's hub runs the game rules and pushes the new state to the room. */
  input(data) { return this.call('input', { data }); }
  /** Send fast, unsaved data (positions, aim) straight to the others in the room, or to one player with `to`. */
  relay(data, to) { return this.call('relay', to === undefined ? { data } : { data, to }); }
  /** The host's clock in milliseconds. */
  time() { return this.call('time'); }
  /** Run one of the host's custom actions. */
  action(name, args = {}) { return this.call('action', { name, args }); }
}
