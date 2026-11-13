// GameDB client — connects a game (browser or Node) to a GameDB hub: the host player's
// browser (peer to peer, see gamedb-p2p.js, which builds these for you) or a GameDB server.
// Zero dependencies. Handles sign-in (a guest account remembered on the device),
// requests with replies, pushed events and automatic reconnects.
//
//   const game = new GameClient('ws://localhost:8830');
//   const me = await game.connect();
//   game.on('state', ({ state }) => draw(state));
//   await game.quickMatch('tictactoe');
//   await game.input({ cell: 4 });

export class GameClientError extends Error {
  constructor(code, msg) { super(msg); this.name = 'GameClientError'; this.code = code; }
}

function defaultStore() {
  try { const ls = globalThis.localStorage; if (ls) return { get: k => ls.getItem(k), set: (k, v) => ls.setItem(k, v) }; } catch { /* storage blocked */ }
  const m = new Map(); return { get: k => m.get(k) ?? null, set: (k, v) => { m.set(k, v); } };
}

export class GameClient {
  /**
   * @param url  ws:// or wss:// address of the server (any label when `transport` is given)
   * @param opts name (display name for a new player), store ({ get, set } for the saved login),
   *             profile (use different values to keep several players on one device), reconnect (true),
   *             transport: async () => an open link { send(text), close(), readyState: 1 } on which this
   *               client sets onmessage({ data }) and onclose(); used instead of a WebSocket,
   *             ownIdentity: true = this device makes its own player id and secret and keeps them for
   *               every hub it meets (peer to peer); false = the server hands out the account.
   */
  constructor(url, { name = null, store = defaultStore(), profile = '', reconnect = true, timeoutMs = 10000, transport = null, ownIdentity = false, maxRetries = Infinity } = {}) {
    this.url = url; this.name = name; this.store = store; this.key = ownIdentity ? `gamedb:me:${profile}` : `gamedb:${url}:${profile}`;
    this.transport = transport; this.ownIdentity = ownIdentity; this.maxRetries = maxRetries;
    this.reconnect = reconnect; this.timeoutMs = timeoutMs;
    this.ws = null; this.me = null; this._id = 0; this._pending = new Map(); this._handlers = new Map(); this._closed = false; this._retry = 0;
  }

  /** Listen for an event: 'room', 'state', 'relay', 'board', 'kicked', 'open' (connected or reconnected), 'close', 'lost' (gave up reconnecting). Returns an unsubscribe function. */
  on(ev, fn) { if (!this._handlers.has(ev)) this._handlers.set(ev, new Set()); this._handlers.get(ev).add(fn); return () => this._handlers.get(ev).delete(fn); }
  _emit(ev, data) { const hs = this._handlers.get(ev); if (hs) for (const fn of [...hs]) { try { fn(data); } catch (e) { console.error(e); } } }

  /** Connect and sign in. Resolves with { playerId, name, room, state }. */
  async connect() {
    this._closed = false;
    await this._open();
    this.me = await this._signIn();
    this._retry = 0;
    this._emit('open', this.me);
    return this.me;
  }
  _open() {
    const wire = (ws, wasOpen) => {
      ws.onmessage = ev => this._message(ev.data);
      ws.onclose = () => {
        if (this.ws !== ws) return;
        for (const p of this._pending.values()) { clearTimeout(p.timer); p.rej(new GameClientError('CLOSED', 'connection closed')); }
        this._pending.clear();
        if (!wasOpen()) return;
        this._emit('close');
        if (this.reconnect && !this._closed && !this._kicked) this._again();
      };
    };
    if (this.transport) {
      return Promise.resolve(this.transport()).then(link => {
        if (this._closed) { link.close(); throw new GameClientError('CLOSED', 'closed while connecting'); }
        this.ws = link; wire(link, () => true);
      });
    }
    return new Promise((res, rej) => {
      const ws = new WebSocket(this.url); this.ws = ws; let opened = false;
      ws.onopen = () => { opened = true; res(); };
      ws.onerror = () => { if (!opened) rej(new GameClientError('CONNECT', `could not connect to ${this.url}`)); };
      wire(ws, () => opened);
    });
  }
  /** True while the link is up. */
  get connected() { return !!this.ws && this.ws.readyState === 1; }
  /** This device's own player id and secret (made on first use), when ownIdentity is on. */
  identity() {
    let saved = null; try { saved = JSON.parse(this.store.get(this.key)); } catch { /* none yet */ }
    if (!saved || !saved.playerId || !saved.secret) {
      const hex = n => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), b => (b < 16 ? '0' : '') + b.toString(16)).join('');
      saved = { playerId: `${hex(4)}-${hex(2)}-${hex(2)}-${hex(2)}-${hex(6)}`, secret: hex(24) };
      this.store.set(this.key, JSON.stringify(saved));
    }
    return saved;
  }
  _again() {
    const wait = Math.min(10000, 500 * 2 ** this._retry++);
    // Gives up (event 'lost') when the link can never come back ('GONE') or after maxRetries tries.
    if (this._retry > this.maxRetries) { this._closed = true; this._emit('lost'); return; }
    setTimeout(() => {
      if (this._closed) return;
      this.connect().catch(e => {
        if (this._closed) return;
        if (e && e.code === 'GONE') { this._closed = true; this._emit('lost'); } else this._again();
      });
    }, wait);
  }
  async _signIn() {
    if (this.ownIdentity) { const me = this.identity(); return this.call('hello', { playerId: me.playerId, secret: me.secret, name: this.name }); }
    let saved = null; try { saved = JSON.parse(this.store.get(this.key)); } catch { /* none yet */ }
    if (saved && saved.playerId) {
      try { return await this.call('hello', { playerId: saved.playerId, secret: saved.secret, name: this.name }); }
      catch (e) { if (e.code !== 'AUTH') throw e; } // the server no longer knows us: start fresh
    }
    const r = await this.call('register', { name: this.name });
    this.store.set(this.key, JSON.stringify({ playerId: r.playerId, secret: r.secret }));
    delete r.secret;
    return r;
  }
  _message(text) {
    let m; try { m = JSON.parse(text); } catch { return; }
    if (m.ev) { if (m.ev === 'kicked') this._kicked = true; this._emit(m.ev, m); return; }
    const p = this._pending.get(m.id); if (!p) return;
    this._pending.delete(m.id); clearTimeout(p.timer);
    if (m.ok) p.res(m.r); else p.rej(new GameClientError(m.e.code, m.e.message));
  }

  /** Send a request and wait for its reply. Rejects with a GameClientError carrying the server's error code. */
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
  /** Send a move; the server runs the game rules and pushes the new state to the room. */
  input(data) { return this.call('input', { data }); }
  /** Send fast, unsaved data (positions, aim) straight to the others in the room, or to one player with `to`. */
  relay(data, to) { return this.call('relay', to === undefined ? { data } : { data, to }); }
  /** The server's clock in milliseconds. */
  time() { return this.call('time'); }
  /** Run one of the server's custom actions. */
  action(name, args = {}) { return this.call('action', { name, args }); }
}
