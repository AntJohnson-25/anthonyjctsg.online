// GameDB game kit — the things every game needs, written in SQL on the GameDB engine:
// players, save slots, XP and levels, currencies, unlocks, leaderboards, match history.
// Works anywhere the engine does (browser for single-player, Node for the server).
import { GameDBError } from './gamedb.js';

const fail = (code, msg) => { throw new GameDBError(code, msg); };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS gk_players (id TEXT PRIMARY KEY, name TEXT, created TIMESTAMP NOT NULL, seen TIMESTAMP NOT NULL);
CREATE TABLE IF NOT EXISTS gk_saves (player_id TEXT NOT NULL, slot INT NOT NULL, data JSON, version INT NOT NULL, updated TIMESTAMP NOT NULL, PRIMARY KEY (player_id, slot));
CREATE TABLE IF NOT EXISTS gk_progress (player_id TEXT PRIMARY KEY, xp INT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS gk_wallet (player_id TEXT NOT NULL, currency TEXT NOT NULL, amount INT NOT NULL DEFAULT 0, PRIMARY KEY (player_id, currency));
CREATE TABLE IF NOT EXISTS gk_unlocks (player_id TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, at TIMESTAMP NOT NULL, PRIMARY KEY (player_id, kind, key));
CREATE TABLE IF NOT EXISTS gk_boards (id TEXT PRIMARY KEY, higher_better BOOL NOT NULL, period TEXT NOT NULL, min_score REAL, max_score REAL);
CREATE TABLE IF NOT EXISTS gk_scores (board TEXT NOT NULL, period_key TEXT NOT NULL, player_id TEXT NOT NULL, score REAL NOT NULL, at TIMESTAMP NOT NULL, PRIMARY KEY (board, period_key, player_id));
CREATE INDEX IF NOT EXISTS gk_scores_rank ON gk_scores (board, period_key, score);
CREATE TABLE IF NOT EXISTS gk_matches (id INT PRIMARY KEY, mode TEXT, started TIMESTAMP, ended TIMESTAMP NOT NULL, data JSON);
CREATE TABLE IF NOT EXISTS gk_match_players (match_id INT NOT NULL, player_id TEXT NOT NULL, result TEXT, score REAL, stats JSON, PRIMARY KEY (match_id, player_id));
CREATE INDEX IF NOT EXISTS gk_mp_player ON gk_match_players (player_id, match_id);
`;

/** Pack a JSON-compatible value into text that is safe inside a link. */
export function encodeShare(value) {
  let bin = ''; for (const b of new TextEncoder().encode(JSON.stringify(value))) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** Unpack text made by encodeShare. Returns null if it is not valid. */
export function decodeShare(text) {
  try {
    if (typeof text !== 'string' || text.length > 20000) return null;
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
  } catch { return null; }
}

const DAY = 86400000;
const PERIODS = ['all', 'daily', 'weekly', 'monthly'];

export class GameKit {
  /**
   * @param db   an open GameDB
   * @param opts maxSlots (3), maxSaveBytes (262144), xpPerLevel (1000) or levelFor(xp) => level, now() for tests
   */
  constructor(db, opts = {}) {
    this.db = db;
    this.maxSlots = opts.maxSlots ?? 3;
    this.maxSaveBytes = opts.maxSaveBytes ?? 262144;
    this.levelFor = opts.levelFor || (xp => 1 + Math.floor(xp / (opts.xpPerLevel ?? 1000)));
    this.now = opts.now || Date.now;
    this._boards = new Map();
    db.exec(SCHEMA);
  }
  // Run fn atomically, joining a transaction the caller already opened.
  _tx(fn) { return this.db.inTransaction ? fn() : this.db.transaction(fn); }
  _id(v, what = 'player id') { if (typeof v !== 'string' || !v || v.length > 64) fail('BAD_INPUT', `${what} must be a short text value`); return v; }

  // ── players ──

  /** Create the player if new, update last-seen (and name, when given). Returns the player row. */
  player(id, name) {
    this._id(id);
    if (name != null) name = this._name(name);
    const now = this.now();
    this.db.run('INSERT INTO gk_players (id, name, created, seen) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET seen = excluded.seen, name = COALESCE(excluded.name, name)', [id, name ?? null, now, now]);
    return this.db.get('SELECT id, name, created, seen FROM gk_players WHERE id = ?', [id]);
  }
  _name(name) { name = String(name).trim().slice(0, 24); if (!name) fail('BAD_INPUT', 'name cannot be empty'); return name; }
  getPlayer(id) { return this.db.get('SELECT id, name, created, seen FROM gk_players WHERE id = ?', [id]); }

  // ── save slots ──

  /**
   * Store a save. Returns the new version number.
   * Pass expectedVersion (the version you loaded, or 0 for "slot must be empty") to refuse
   * overwriting a newer save made on another device; that throws code CONFLICT.
   */
  save(playerId, slot, data, { expectedVersion } = {}) {
    this._id(playerId);
    if (!Number.isInteger(slot) || slot < 1 || slot > this.maxSlots) fail('BAD_INPUT', `slot must be 1 to ${this.maxSlots}`);
    const text = JSON.stringify(data);
    if (text === undefined) fail('BAD_INPUT', 'save data must be JSON-compatible');
    if (text.length > this.maxSaveBytes) fail('TOO_BIG', `save is ${text.length} characters; the limit is ${this.maxSaveBytes}`);
    return this._tx(() => {
      const cur = this.db.get('SELECT version FROM gk_saves WHERE player_id = ? AND slot = ?', [playerId, slot]);
      const have = cur ? cur.version : 0;
      if (expectedVersion !== undefined && expectedVersion !== have) fail('CONFLICT', `save slot ${slot} is at version ${have}, not ${expectedVersion}`);
      this.db.run('INSERT INTO gk_saves VALUES (?, ?, ?, ?, ?) ON CONFLICT (player_id, slot) DO UPDATE SET data = excluded.data, version = excluded.version, updated = excluded.updated', [playerId, slot, text, have + 1, this.now()]);
      return have + 1;
    });
  }
  /** Returns { data, version, updated } or null. */
  load(playerId, slot) { return this.db.get('SELECT data, version, updated FROM gk_saves WHERE player_id = ? AND slot = ?', [playerId, slot]); }
  listSaves(playerId) { return this.db.query('SELECT slot, version, updated FROM gk_saves WHERE player_id = ? ORDER BY slot', [playerId]); }
  deleteSave(playerId, slot) { return this.db.run('DELETE FROM gk_saves WHERE player_id = ? AND slot = ?', [playerId, slot]) === 1; }

  // ── XP, levels, currencies, unlocks ──

  /** Add XP. Returns { xp, level, leveledUp }. */
  addXp(playerId, amount) {
    this._id(playerId);
    if (!Number.isInteger(amount) || amount <= 0) fail('BAD_INPUT', 'XP amount must be a positive whole number');
    return this._tx(() => {
      const before = this.progress(playerId);
      this.db.run('INSERT INTO gk_progress (player_id, xp) VALUES (?, ?) ON CONFLICT (player_id) DO UPDATE SET xp = xp + excluded.xp', [playerId, amount]);
      const after = this.progress(playerId);
      return { ...after, leveledUp: after.level > before.level };
    });
  }
  progress(playerId) { const r = this.db.get('SELECT xp FROM gk_progress WHERE player_id = ?', [playerId]); const xp = r ? r.xp : 0; return { xp, level: this.levelFor(xp) }; }

  _money(currency, amount) {
    if (typeof currency !== 'string' || !/^[a-z0-9_]{1,24}$/.test(currency)) fail('BAD_INPUT', 'currency must be a short lowercase name');
    if (!Number.isInteger(amount) || amount <= 0) fail('BAD_INPUT', 'amount must be a positive whole number');
  }
  /** Add currency. Returns the new balance. */
  earn(playerId, currency, amount) {
    this._id(playerId); this._money(currency, amount);
    this.db.run('INSERT INTO gk_wallet VALUES (?, ?, ?) ON CONFLICT (player_id, currency) DO UPDATE SET amount = amount + excluded.amount', [playerId, currency, amount]);
    return this.balance(playerId, currency);
  }
  /** Take currency. Throws code FUNDS if the player cannot afford it. Returns the new balance. */
  spend(playerId, currency, amount) {
    this._id(playerId); this._money(currency, amount);
    return this._tx(() => {
      const bal = this.balance(playerId, currency);
      if (bal < amount) fail('FUNDS', `needs ${amount} ${currency} but has ${bal}`);
      this.db.run('UPDATE gk_wallet SET amount = amount - ? WHERE player_id = ? AND currency = ?', [amount, playerId, currency]);
      return bal - amount;
    });
  }
  balance(playerId, currency) { const r = this.db.get('SELECT amount FROM gk_wallet WHERE player_id = ? AND currency = ?', [playerId, currency]); return r ? r.amount : 0; }
  wallet(playerId) { const o = {}; for (const r of this.db.query('SELECT currency, amount FROM gk_wallet WHERE player_id = ?', [playerId])) o[r.currency] = r.amount; return o; }

  /** Unlock a skill, item or achievement. Returns true if it was newly unlocked. */
  unlock(playerId, kind, key) {
    this._id(playerId); this._id(kind, 'kind'); this._id(key, 'key');
    return this.db.run('INSERT INTO gk_unlocks VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', [playerId, kind, key, this.now()]) === 1;
  }
  hasUnlock(playerId, kind, key) { return !!this.db.get('SELECT at FROM gk_unlocks WHERE player_id = ? AND kind = ? AND key = ?', [playerId, kind, key]); }
  /** All unlocks, or only those of one kind. */
  unlocks(playerId, kind) {
    return kind ? this.db.query('SELECT kind, key, at FROM gk_unlocks WHERE player_id = ? AND kind = ? ORDER BY key', [playerId, kind])
      : this.db.query('SELECT kind, key, at FROM gk_unlocks WHERE player_id = ? ORDER BY kind, key', [playerId]);
  }

  // ── leaderboards ──

  /**
   * Create or change a leaderboard.
   * higherBetter: false for golf/time boards. period: 'all' | 'daily' | 'weekly' | 'monthly' (resets on UTC boundaries).
   * min/max: scores outside this range are rejected.
   */
  defineBoard(id, { higherBetter = true, period = 'all', min = null, max = null } = {}) {
    this._id(id, 'board id');
    if (!PERIODS.includes(period)) fail('BAD_INPUT', `period must be one of ${PERIODS.join(', ')}`);
    this.db.run('INSERT INTO gk_boards VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET higher_better = excluded.higher_better, period = excluded.period, min_score = excluded.min_score, max_score = excluded.max_score', [id, higherBetter, period, min, max]);
    this._boards.delete(id);
  }
  _board(id) {
    let b = this._boards.get(id);
    if (!b) { b = this.db.get('SELECT * FROM gk_boards WHERE id = ?', [id]); if (!b) fail('NO_BOARD', `unknown leaderboard "${id}"`); this._boards.set(id, b); }
    return b;
  }
  /** The key of the period that time t falls in, e.g. '2026-11-12' for a daily board. */
  periodKey(boardId, t = this.now()) {
    const p = this._board(boardId).period;
    if (p === 'all') return 'all';
    if (p === 'daily') return new Date(t).toISOString().slice(0, 10);
    if (p === 'monthly') return new Date(t).toISOString().slice(0, 7);
    const monday = t - ((new Date(t).getUTCDay() + 6) % 7) * DAY;
    return 'w' + new Date(monday).toISOString().slice(0, 10);
  }
  /** Submit a score; only a personal best is kept. Returns { best, improved, rank }. */
  submitScore(boardId, playerId, score) {
    this._id(playerId);
    const b = this._board(boardId);
    if (typeof score !== 'number' || !Number.isFinite(score)) fail('BAD_INPUT', 'score must be a number');
    if ((b.min_score !== null && score < b.min_score) || (b.max_score !== null && score > b.max_score)) fail('BAD_INPUT', 'score is outside the range this leaderboard allows');
    const pk = this.periodKey(boardId);
    return this._tx(() => {
      const cur = this.db.get('SELECT score FROM gk_scores WHERE board = ? AND period_key = ? AND player_id = ?', [boardId, pk, playerId]);
      const improved = !cur || (b.higher_better ? score > cur.score : score < cur.score);
      if (improved) this.db.run('INSERT INTO gk_scores VALUES (?, ?, ?, ?, ?) ON CONFLICT (board, period_key, player_id) DO UPDATE SET score = excluded.score, at = excluded.at', [boardId, pk, playerId, score, this.now()]);
      return { best: improved ? score : cur.score, improved, rank: this.rank(boardId, playerId, { periodKey: pk }) };
    });
  }
  /** A player's rank (1 = best; tied scores share a rank), or null if they have no score. */
  rank(boardId, playerId, { periodKey } = {}) {
    const b = this._board(boardId), pk = periodKey ?? this.periodKey(boardId);
    const mine = this.db.get('SELECT score FROM gk_scores WHERE board = ? AND period_key = ? AND player_id = ?', [boardId, pk, playerId]);
    if (!mine) return null;
    const sql = b.higher_better
      ? 'SELECT COUNT(*) AS n FROM gk_scores WHERE board = ? AND period_key = ? AND score > ?'
      : 'SELECT COUNT(*) AS n FROM gk_scores WHERE board = ? AND period_key = ? AND score < ?';
    return this.db.get(sql, [boardId, pk, mine.score]).n + 1;
  }
  /** The best n entries: [{ pos, player_id, name, score, at }]. */
  top(boardId, n = 10, { offset = 0, periodKey } = {}) {
    const b = this._board(boardId), pk = periodKey ?? this.periodKey(boardId);
    if (!Number.isInteger(n) || n < 1 || n > 200 || !Number.isInteger(offset) || offset < 0) fail('BAD_INPUT', 'n must be 1 to 200 and offset 0 or more');
    const rows = this.db.query(`SELECT s.player_id, p.name, s.score, s.at FROM gk_scores s LEFT JOIN gk_players p ON p.id = s.player_id
      WHERE s.board = ? AND s.period_key = ? ORDER BY s.score ${b.higher_better ? 'DESC' : 'ASC'} LIMIT ? OFFSET ?`, [boardId, pk, n, offset]);
    return rows.map((r, i) => ({ pos: offset + i + 1, ...r }));
  }
  /** The entries around a player (radius above and below), for "you are here" views. */
  around(boardId, playerId, radius = 2, opts = {}) {
    const r = this.rank(boardId, playerId, opts);
    return r === null ? [] : this.top(boardId, radius * 2 + 1, { ...opts, offset: Math.max(0, r - 1 - radius) });
  }
  boardSize(boardId, { periodKey } = {}) { return this.db.get('SELECT COUNT(*) AS n FROM gk_scores WHERE board = ? AND period_key = ?', [boardId, periodKey ?? this.periodKey(boardId)]).n; }

  // ── friends boards: scores travel between devices with no server ──
  // Every device keeps its own copy of a board. Copies are merged when friends play together
  // (the hub's syncBoard) or when one sends the other a link (shareBoard / acceptShare).
  // A merge keeps each player's best score, so it can be repeated in any order.
  // Scores are taken on trust: this is for friends, not for prizes.

  /** A board's best n entries in a compact form another device can merge: { board, period, rows: [[id, name, score, at]] }. */
  exportBoard(boardId, n = 50) {
    const pk = this.periodKey(boardId);
    return { board: boardId, period: pk, rows: this.top(boardId, n, { periodKey: pk }).map(r => [r.player_id, r.name, r.score, r.at]) };
  }
  /**
   * Merge entries from another device (the output of exportBoard). Returns how many scores were added or beaten.
   * Entries for another period, outside the board's range or malformed are skipped.
   * self: this device's own player id; its name is never changed by a merge.
   */
  mergeBoard(data, { self = null } = {}) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.rows) || data.rows.length > 500) fail('BAD_INPUT', 'that is not a leaderboard to merge');
    const b = this._board(data.board), pk = this.periodKey(data.board);
    if (data.period !== undefined && data.period !== null && data.period !== pk) return 0;
    const now = this.now();
    let changed = 0;
    this._tx(() => {
      for (const r of data.rows) {
        if (!Array.isArray(r)) continue;
        const [id, rawName, score, at] = r;
        if (typeof id !== 'string' || !id || id.length > 64 || typeof score !== 'number' || !Number.isFinite(score)) continue;
        if ((b.min_score !== null && score < b.min_score) || (b.max_score !== null && score > b.max_score)) continue;
        const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim().slice(0, 24) : null;
        if (id === self) this.db.run('INSERT INTO gk_players (id, name, created, seen) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', [id, name, now, now]);
        else this.db.run('INSERT INTO gk_players (id, name, created, seen) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = COALESCE(excluded.name, name)', [id, name, now, now]);
        const cur = this.db.get('SELECT score FROM gk_scores WHERE board = ? AND period_key = ? AND player_id = ?', [data.board, pk, id]);
        if (cur && !(b.higher_better ? score > cur.score : score < cur.score)) continue;
        this.db.run('INSERT INTO gk_scores VALUES (?, ?, ?, ?, ?) ON CONFLICT (board, period_key, player_id) DO UPDATE SET score = excluded.score, at = excluded.at', [data.board, pk, id, score, typeof at === 'number' && Number.isFinite(at) && at <= now ? at : now]);
        changed++;
      }
    });
    return changed;
  }
  /**
   * A short piece of text, safe inside a link, that carries a board's best n entries (always including
   * the sender's own). Put it in a link to your game ("beat my score"); the friend's game calls acceptShare.
   */
  shareBoard(boardId, playerId, n = 8) {
    const data = this.exportBoard(boardId, n);
    if (!data.rows.some(r => r[0] === playerId)) {
      const mine = this.db.get('SELECT s.score, s.at, p.name FROM gk_scores s LEFT JOIN gk_players p ON p.id = s.player_id WHERE s.board = ? AND s.period_key = ? AND s.player_id = ?', [boardId, data.period, playerId]);
      if (mine) data.rows.push([playerId, mine.name, mine.score, mine.at]);
    }
    return encodeShare({ v: 1, from: playerId, ...data });
  }
  /**
   * Take in text made by shareBoard. Returns { board, merged, from: { id, name, score } | null } where
   * `from` is the friend who sent it, or null if the text is not a valid share.
   */
  acceptShare(text, { self = null } = {}) {
    const data = decodeShare(text);
    if (!data || data.v !== 1 || typeof data.board !== 'string' || !Array.isArray(data.rows)) return null;
    let merged;
    try { merged = this.mergeBoard(data, { self }); } catch (e) { if (e instanceof GameDBError) return null; throw e; }
    const row = data.rows.find(r => Array.isArray(r) && r[0] === data.from);
    const from = row && typeof row[2] === 'number' ? { id: row[0], name: typeof row[1] === 'string' ? row[1].slice(0, 24) : null, score: row[2] } : null;
    return { board: data.board, merged, from };
  }

  // ── match history ──

  /**
   * Record a finished match. players: [{ id, result ('win'|'loss'|'draw'|anything), score, stats }].
   * Returns the match id.
   */
  recordMatch({ mode = null, started = null, ended = this.now(), data = null, players = [] }) {
    return this._tx(() => {
      const last = this.db.get('SELECT id FROM gk_matches ORDER BY id DESC LIMIT 1');
      const id = (last ? last.id : 0) + 1;
      this.db.run('INSERT INTO gk_matches VALUES (?, ?, ?, ?, ?)', [id, mode, started, ended, data]);
      for (const p of players) this.db.run('INSERT INTO gk_match_players VALUES (?, ?, ?, ?, ?)', [id, this._id(p.id), p.result ?? null, p.score ?? null, p.stats ?? null]);
      return id;
    });
  }
  /** Totals per result, e.g. { played: 12, win: 7, loss: 4, draw: 1 }. */
  statsFor(playerId) {
    const out = { played: 0 };
    for (const r of this.db.query('SELECT result, COUNT(*) AS n FROM gk_match_players WHERE player_id = ? GROUP BY result', [playerId])) { out.played += r.n; if (r.result !== null) out[r.result] = r.n; }
    return out;
  }
  /** The player's most recent matches, newest first. */
  history(playerId, n = 10) {
    return this.db.query('SELECT mp.match_id, m.mode, m.ended, mp.result, mp.score, mp.stats FROM gk_match_players mp JOIN gk_matches m ON m.id = mp.match_id WHERE mp.player_id = ? ORDER BY mp.match_id DESC LIMIT ?', [playerId, n]);
  }

  /** Everything about a player in one call. */
  profile(playerId) {
    return { player: this.getPlayer(playerId), progress: this.progress(playerId), wallet: this.wallet(playerId), unlocks: this.unlocks(playerId), stats: this.statsFor(playerId) };
  }
}
