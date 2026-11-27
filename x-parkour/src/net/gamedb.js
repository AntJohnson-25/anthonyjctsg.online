// GameDB — a standalone SQL database engine for games.
// Zero dependencies. One ES module. Runs in the browser and under Node.
// Phase 1: SQL core (tables, indexes, SELECT/INSERT/UPDATE/DELETE, joins,
// GROUP BY, upsert, transactions) + snapshot/log persistence.

export class GameDBError extends Error {
  constructor(code, msg) { super(msg); this.name = 'GameDBError'; this.code = code; }
}
const fail = (code, msg) => { throw new GameDBError(code, msg); };

// ───────────────────────── tokenizer ─────────────────────────

const RESERVED = new Set(('SELECT FROM WHERE AND OR NOT NULL IS IN BETWEEN LIKE INSERT INTO VALUES ' +
  'UPDATE SET DELETE CREATE DROP JOIN LEFT INNER ON AS ORDER BY GROUP HAVING LIMIT OFFSET ' +
  'DISTINCT TRUE FALSE ASC DESC').split(' '));
const OPS2 = new Set(['<=', '>=', '<>', '!=', '==', '||']);
const OPS1 = '=<>+-*/%(),.;?';
const RE_NUM = /(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/y;
const RE_WORD = /[A-Za-z_][A-Za-z0-9_]*/y;

function tokenize(s) {
  const out = []; const n = s.length; let i = 0;
  while (i < n) {
    const c = s[i];
    if (c <= ' ') { i++; continue; }
    if (c === '-' && s[i + 1] === '-') { while (i < n && s[i] !== '\n') i++; continue; }
    if (c === "'") {
      let j = i + 1, v = '';
      for (;;) {
        if (j >= n) fail('SYNTAX', 'unterminated string');
        if (s[j] === "'") { if (s[j + 1] === "'") { v += "'"; j += 2; continue; } break; }
        v += s[j++];
      }
      out.push({ k: 'str', v }); i = j + 1; continue;
    }
    if (c === '"') {
      const j = s.indexOf('"', i + 1);
      if (j < 0) fail('SYNTAX', 'unterminated quoted name');
      const v = s.slice(i + 1, j);
      out.push({ k: 'w', v, u: v.toUpperCase(), q: true }); i = j + 1; continue;
    }
    if ((c >= '0' && c <= '9') || (c === '.' && s[i + 1] >= '0' && s[i + 1] <= '9')) {
      RE_NUM.lastIndex = i; const m = RE_NUM.exec(s);
      out.push({ k: 'num', v: Number(m[0]) }); i += m[0].length; continue;
    }
    RE_WORD.lastIndex = i; const m = RE_WORD.exec(s);
    if (m) { out.push({ k: 'w', v: m[0].toLowerCase(), u: m[0].toUpperCase(), q: false }); i += m[0].length; continue; }
    const two = s.substr(i, 2);
    if (OPS2.has(two)) { out.push({ k: 'op', v: two }); i += 2; continue; }
    if (OPS1.includes(c)) { out.push({ k: 'op', v: c }); i++; continue; }
    fail('SYNTAX', `unexpected character ${JSON.stringify(c)}`);
  }
  out.push({ k: 'eof', v: '' });
  return out;
}

// ───────────────────────── parser ─────────────────────────

const TYPES = {
  INT: 'int', INTEGER: 'int', BIGINT: 'int', SMALLINT: 'int',
  REAL: 'real', FLOAT: 'real', DOUBLE: 'real', NUMERIC: 'real', DECIMAL: 'real',
  TEXT: 'text', VARCHAR: 'text', CHAR: 'text', STRING: 'text', UUID: 'text',
  BOOL: 'bool', BOOLEAN: 'bool', JSON: 'json', JSONB: 'json',
  TIMESTAMP: 'time', TIMESTAMPTZ: 'time', DATETIME: 'time',
};

class Parser {
  constructor(sql) { this.t = tokenize(sql); this.p = 0; this.np = 0; }
  get cur() { return this.t[this.p]; }
  kw(u, o = 0) { const t = this.t[this.p + o]; return !!t && t.k === 'w' && !t.q && t.u === u; }
  op(v, o = 0) { const t = this.t[this.p + o]; return !!t && t.k === 'op' && t.v === v; }
  akw(u) { if (this.kw(u)) { this.p++; return true; } return false; }
  aop(v) { if (this.op(v)) { this.p++; return true; } return false; }
  ekw(u) { if (!this.akw(u)) this.bad(`expected ${u}`); }
  eop(v) { if (!this.aop(v)) this.bad(`expected "${v}"`); }
  bad(m) { const t = this.cur; fail('SYNTAX', `${m} near ${t.k === 'eof' ? 'end of input' : JSON.stringify(String(t.v))}`); }
  ident() {
    const t = this.cur;
    if (t.k !== 'w' || (!t.q && RESERVED.has(t.u))) this.bad('expected a name');
    this.p++; return t.v;
  }
  nameList() { const a = []; this.eop('('); do a.push(this.ident()); while (this.aop(',')); this.eop(')'); return a; }

  all() {
    const out = [];
    for (;;) {
      while (this.aop(';'));
      if (this.cur.k === 'eof') break;
      out.push(this.stmt());
      if (this.cur.k !== 'eof' && !this.op(';')) this.bad('unexpected input');
    }
    return out;
  }

  stmt() {
    if (this.kw('SELECT')) return this.select();
    if (this.akw('INSERT')) return this.insert();
    if (this.akw('UPDATE')) return this.update();
    if (this.akw('DELETE')) {
      this.ekw('FROM'); const table = this.ident();
      return { s: 'delete', table, where: this.akw('WHERE') ? this.expr() : null };
    }
    if (this.akw('CREATE')) return this.create();
    if (this.akw('DROP')) {
      const what = this.akw('TABLE') ? 'dropTable' : this.akw('INDEX') ? 'dropIndex' : this.bad('expected TABLE or INDEX');
      let ifExists = false;
      if (this.akw('IF')) { this.ekw('EXISTS'); ifExists = true; }
      return { s: what, name: this.ident(), ifExists };
    }
    if (this.akw('BEGIN')) { this.akw('TRANSACTION'); return { s: 'begin' }; }
    if (this.akw('COMMIT')) return { s: 'commit' };
    if (this.akw('ROLLBACK')) return { s: 'rollback' };
    this.bad('unknown statement');
  }

  create() {
    const unique = this.akw('UNIQUE');
    if (this.akw('INDEX')) {
      const ifNot = this.ifNotExists();
      const name = this.ident(); this.ekw('ON'); const table = this.ident();
      return { s: 'createIndex', name, table, cols: this.nameList(), unique, ifNot };
    }
    if (unique) this.bad('expected INDEX');
    this.ekw('TABLE');
    const ifNot = this.ifNotExists();
    const name = this.ident(); const cols = []; let pk = null; const uniques = [];
    this.eop('(');
    do {
      if (this.kw('PRIMARY') && this.kw('KEY', 1)) { this.p += 2; pk = this.nameList(); continue; }
      if (this.kw('UNIQUE') && this.op('(', 1)) { this.p++; uniques.push(this.nameList()); continue; }
      const col = { name: this.ident(), type: null, notNull: false, def: null };
      const tt = this.cur;
      if (tt.k !== 'w' || !TYPES[tt.u]) this.bad('expected a column type (INT, REAL, TEXT, BOOL, JSON, TIMESTAMP)');
      col.type = TYPES[tt.u]; this.p++;
      if (this.aop('(')) { while (!this.aop(')')) { if (this.cur.k === 'eof') this.bad('expected ")"'); this.p++; } }
      for (;;) {
        if (this.kw('PRIMARY') && this.kw('KEY', 1)) { this.p += 2; pk = [col.name]; }
        else if (this.kw('NOT') && this.kw('NULL', 1)) { this.p += 2; col.notNull = true; }
        else if (this.akw('NULL')) { /* default */ }
        else if (this.akw('UNIQUE')) uniques.push([col.name]);
        else if (this.akw('DEFAULT')) col.def = this.unary();
        else break;
      }
      cols.push(col);
    } while (this.aop(','));
    this.eop(')');
    return { s: 'createTable', name, ifNot, cols, pk, uniques };
  }
  ifNotExists() { if (this.akw('IF')) { this.ekw('NOT'); this.ekw('EXISTS'); return true; } return false; }

  insert() {
    this.ekw('INTO'); const table = this.ident();
    const cols = this.op('(') ? this.nameList() : null;
    this.ekw('VALUES'); const rows = [];
    do { this.eop('('); const r = []; do r.push(this.expr()); while (this.aop(',')); this.eop(')'); rows.push(r); } while (this.aop(','));
    let conflict = null;
    if (this.akw('ON')) {
      this.ekw('CONFLICT');
      if (this.op('(')) this.nameList();
      this.ekw('DO');
      if (this.akw('NOTHING')) conflict = { set: null };
      else { this.ekw('UPDATE'); this.ekw('SET'); conflict = { set: this.setList() }; }
    }
    return { s: 'insert', table, cols, rows, conflict };
  }
  setList() { const a = []; do { const col = this.ident(); this.eop('='); a.push({ col, e: this.expr() }); } while (this.aop(',')); return a; }
  update() {
    const table = this.ident(); this.ekw('SET'); const set = this.setList();
    return { s: 'update', table, set, where: this.akw('WHERE') ? this.expr() : null };
  }

  tref() {
    const name = this.ident(); let alias = name;
    if (this.akw('AS')) alias = this.ident();
    else if (this.cur.k === 'w' && (this.cur.q || !RESERVED.has(this.cur.u))) alias = this.ident();
    return { name, alias };
  }
  select() {
    this.ekw('SELECT');
    const st = { s: 'select', distinct: this.akw('DISTINCT'), items: [], from: null, joins: [], where: null, groupBy: [], having: null, orderBy: [], limit: null, offset: null };
    do {
      if (this.aop('*')) { st.items.push({ star: true, table: null }); continue; }
      if (this.cur.k === 'w' && this.op('.', 1) && this.op('*', 2)) { const table = this.ident(); this.p += 2; st.items.push({ star: true, table }); continue; }
      const e = this.expr(); let as = null;
      if (this.akw('AS')) as = this.ident();
      else if (this.cur.k === 'w' && (this.cur.q || !RESERVED.has(this.cur.u))) as = this.ident();
      st.items.push({ e, as });
    } while (this.aop(','));
    if (this.akw('FROM')) {
      st.from = this.tref();
      for (;;) {
        let left = false;
        if (this.akw('LEFT')) { left = true; this.akw('OUTER'); this.ekw('JOIN'); }
        else if (this.akw('INNER')) this.ekw('JOIN');
        else if (!this.akw('JOIN')) break;
        const r = this.tref(); this.ekw('ON');
        st.joins.push({ left, name: r.name, alias: r.alias, on: this.expr() });
      }
    }
    if (this.akw('WHERE')) st.where = this.expr();
    if (this.akw('GROUP')) { this.ekw('BY'); do st.groupBy.push(this.expr()); while (this.aop(',')); }
    if (this.akw('HAVING')) st.having = this.expr();
    if (this.akw('ORDER')) {
      this.ekw('BY');
      do { const e = this.expr(); let desc = false; if (this.akw('DESC')) desc = true; else this.akw('ASC'); st.orderBy.push({ e, desc }); } while (this.aop(','));
    }
    if (this.akw('LIMIT')) { st.limit = this.expr(); if (this.akw('OFFSET')) st.offset = this.expr(); }
    return st;
  }

  expr() { let l = this.and(); while (this.akw('OR')) l = { t: 'bin', op: 'or', l, r: this.and() }; return l; }
  and() { let l = this.not(); while (this.akw('AND')) l = { t: 'bin', op: 'and', l, r: this.not() }; return l; }
  not() { return this.akw('NOT') ? { t: 'un', op: 'not', e: this.not() } : this.cmp(); }
  cmp() {
    let l = this.concat();
    for (;;) {
      const t = this.cur;
      if (t.k === 'op' && ['=', '==', '!=', '<>', '<', '<=', '>', '>='].includes(t.v)) {
        this.p++;
        const op = t.v === '==' ? '=' : t.v === '<>' ? '!=' : t.v;
        l = { t: 'bin', op, l, r: this.concat() }; continue;
      }
      if (this.akw('IS')) { const not = this.akw('NOT'); this.ekw('NULL'); l = { t: 'isnull', e: l, not }; continue; }
      let not = false;
      if (this.kw('NOT') && (this.kw('IN', 1) || this.kw('BETWEEN', 1) || this.kw('LIKE', 1))) { this.p++; not = true; }
      if (this.akw('IN')) { this.eop('('); const list = []; do list.push(this.expr()); while (this.aop(',')); this.eop(')'); l = { t: 'in', e: l, list, not }; continue; }
      if (this.akw('BETWEEN')) { const lo = this.concat(); this.ekw('AND'); l = { t: 'between', e: l, lo, hi: this.concat(), not }; continue; }
      if (this.akw('LIKE')) { l = { t: 'like', e: l, pat: this.concat(), not }; continue; }
      return l;
    }
  }
  concat() { let l = this.add(); while (this.aop('||')) l = { t: 'bin', op: '||', l, r: this.add() }; return l; }
  add() { let l = this.mul(); for (;;) { if (this.aop('+')) l = { t: 'bin', op: '+', l, r: this.mul() }; else if (this.aop('-')) l = { t: 'bin', op: '-', l, r: this.mul() }; else return l; } }
  mul() { let l = this.unary(); for (;;) { const t = this.cur; if (t.k === 'op' && (t.v === '*' || t.v === '/' || t.v === '%')) { this.p++; l = { t: 'bin', op: t.v, l, r: this.unary() }; } else return l; } }
  unary() { if (this.aop('-')) return { t: 'un', op: '-', e: this.unary() }; if (this.aop('+')) return this.unary(); return this.primary(); }
  primary() {
    const t = this.cur;
    if (t.k === 'num' || t.k === 'str') { this.p++; return { t: 'lit', v: t.v }; }
    if (this.aop('?')) return { t: 'param', i: this.np++ };
    if (this.aop('(')) { const e = this.expr(); this.eop(')'); return e; }
    if (this.akw('TRUE')) return { t: 'lit', v: true };
    if (this.akw('FALSE')) return { t: 'lit', v: false };
    if (this.akw('NULL')) return { t: 'lit', v: null };
    if (t.k === 'w' && this.op('(', 1) && !t.q) {
      const name = t.v; this.p += 2; const f = { t: 'fn', name, args: [], star: false, distinct: false };
      if (this.aop('*')) f.star = true;
      else if (!this.op(')')) { f.distinct = this.akw('DISTINCT'); do f.args.push(this.expr()); while (this.aop(',')); }
      this.eop(')'); return f;
    }
    const a = this.ident();
    if (this.aop('.')) return { t: 'col', table: a, name: this.ident() };
    return { t: 'col', table: null, name: a };
  }
}

// ───────────────────────── values ─────────────────────────

const RANK = { boolean: 0, number: 1, string: 2, object: 3 };
function cmpVals(a, b) {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  const ta = typeof a, tb = typeof b;
  if (ta !== tb) return RANK[ta] - RANK[tb];
  if (ta === 'object') { a = JSON.stringify(a); b = JSON.stringify(b); }
  return a < b ? -1 : a > b ? 1 : 0;
}
function cmpKey(a, b) { for (let i = 0; i < a.length; i++) { const c = cmpVals(a[i], b[i]); if (c) return c; } return 0; }
function cmpN(a, b, n) { for (let i = 0; i < n; i++) { const c = cmpVals(a[i], b[i]); if (c) return c; } return 0; }
const tb = v => (v === null ? null : !!v);
function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k in o) deepFreeze(o[k]); } return o; }

function coerce(col, v) {
  if (v === null || v === undefined) return null;
  switch (col.type) {
    case 'int': if (typeof v === 'boolean') return v ? 1 : 0; if (typeof v === 'number' && Number.isInteger(v)) return v; break;
    case 'real': if (typeof v === 'number' && !Number.isNaN(v)) return v; break;
    case 'text': if (typeof v === 'string') return v; if (typeof v === 'number') return String(v); break;
    case 'bool': if (typeof v === 'boolean') return v; if (v === 0 || v === 1) return v === 1; break;
    case 'json':
      if (typeof v === 'string') { try { return deepFreeze(JSON.parse(v)); } catch { return v; } }
      if (typeof v === 'object') return Object.isFrozen(v) ? v : deepFreeze(JSON.parse(JSON.stringify(v)));
      return v;
    case 'time':
      if (typeof v === 'number') return v;
      if (v instanceof Date) return v.getTime();
      if (typeof v === 'string') { const t = Date.parse(v); if (!Number.isNaN(t)) return t; }
      break;
  }
  fail('TYPE', `column "${col.name}" (${col.type}) cannot store ${JSON.stringify(v)}`);
}

// ───────────────────────── expression compiler ─────────────────────────
// Every compiled expression is f(r, g): r = array of source rows (one per table),
// g = finished aggregate values for the current group (or null).

const AGG = new Set(['count', 'sum', 'avg', 'min', 'max']);
const likeCache = new Map();
function likeRe(p) {
  let re = likeCache.get(p);
  if (!re) {
    re = new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'is');
    if (likeCache.size > 200) likeCache.clear();
    likeCache.set(p, re);
  }
  return re;
}
const num = (f) => (...a) => (a.some(v => v === null) ? null : f(...a));
const FUNCS = {
  abs: num(Math.abs), floor: num(Math.floor), ceil: num(Math.ceil),
  round: (x, d = 0) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d),
  lower: num(s => String(s).toLowerCase()), upper: num(s => String(s).toUpperCase()),
  length: num(s => String(s).length),
  coalesce: (...a) => { for (const v of a) if (v !== null) return v; return null; },
  greatest: (...a) => a.reduce((m, v) => (v === null ? m : m === null || cmpVals(v, m) > 0 ? v : m), null),
  least: (...a) => a.reduce((m, v) => (v === null ? m : m === null || cmpVals(v, m) < 0 ? v : m), null),
  now: () => Date.now(), random: () => Math.random(),
  json_get: (v, path) => {
    if (v === null || path === null) return null;
    for (const k of String(path).split('.')) { if (v === null || typeof v !== 'object') return null; v = v[k]; if (v === undefined) return null; }
    return v;
  },
};

function walk(e, fn) {
  if (!e) return; fn(e);
  switch (e.t) {
    case 'bin': walk(e.l, fn); walk(e.r, fn); break;
    case 'un': case 'isnull': walk(e.e, fn); break;
    case 'fn': e.args.forEach(a => walk(a, fn)); break;
    case 'in': walk(e.e, fn); e.list.forEach(a => walk(a, fn)); break;
    case 'between': walk(e.e, fn); walk(e.lo, fn); walk(e.hi, fn); break;
    case 'like': walk(e.e, fn); walk(e.pat, fn); break;
  }
}
// Which tables does an expression read? null = unusable for index lookups.
function refs(e, cx) {
  const s = new Set(); let bad = false;
  walk(e, n => {
    if (n.t === 'col') { const r = cx.resolve(n.table, n.name, true); if (!r) bad = true; else s.add(r.ti); }
    else if (n.t === 'fn' && AGG.has(n.name)) bad = true;
  });
  return bad ? null : s;
}
function conjuncts(e, out = []) { if (!e) return out; if (e.t === 'bin' && e.op === 'and') { conjuncts(e.l, out); conjuncts(e.r, out); } else out.push(e); return out; }

function compile(e, cx) {
  switch (e.t) {
    case 'lit': { const v = e.v; return () => v; }
    case 'param': { const E = cx.E, i = e.i; return () => { const v = E.params[i]; if (v === undefined) fail('PARAM', `missing value for parameter ${i + 1}`); return v instanceof Date ? v.getTime() : v; }; }
    case 'col': { const { ti, ci } = cx.resolve(e.table, e.name); return r => { const x = r[ti]; return x ? x[ci] : null; }; }
    case 'un': {
      const f = compile(e.e, cx);
      if (e.op === '-') return (r, g) => { const v = f(r, g); return v === null ? null : -v; };
      return (r, g) => { const v = tb(f(r, g)); return v === null ? null : !v; };
    }
    case 'isnull': { const f = compile(e.e, cx), not = e.not; return (r, g) => (f(r, g) === null) !== not; }
    case 'in': {
      const f = compile(e.e, cx), list = e.list.map(x => compile(x, cx)), not = e.not;
      return (r, g) => {
        const v = f(r, g); if (v === null) return null;
        let sawNull = false;
        for (const lf of list) { const w = lf(r, g); if (w === null) sawNull = true; else if (cmpVals(v, w) === 0) return !not; }
        return sawNull ? null : not;
      };
    }
    case 'between': {
      const f = compile(e.e, cx), lo = compile(e.lo, cx), hi = compile(e.hi, cx), not = e.not;
      return (r, g) => { const v = f(r, g), a = lo(r, g), b = hi(r, g); if (v === null || a === null || b === null) return null; return (cmpVals(v, a) >= 0 && cmpVals(v, b) <= 0) !== not; };
    }
    case 'like': {
      const f = compile(e.e, cx), pf = compile(e.pat, cx), not = e.not;
      return (r, g) => { const v = f(r, g), p = pf(r, g); if (v === null || p === null) return null; return likeRe(String(p)).test(String(v)) !== not; };
    }
    case 'fn': {
      if (AGG.has(e.name)) {
        if (!cx.aggs) fail('AGGREGATE', `${e.name}() is not allowed here`);
        if (!e.star && e.args.length !== 1) fail('SYNTAX', `${e.name}() takes one argument`);
        if (e.star && e.name !== 'count') fail('SYNTAX', `${e.name}(*) is not valid`);
        const idx = cx.aggs.length;
        cx.aggs.push({ name: e.name, star: e.star, distinct: e.distinct, arg: e.star ? null : compile(e.args[0], { ...cx, aggs: null }) });
        return (r, g) => g[idx];
      }
      const fn = FUNCS[e.name]; if (!fn) fail('NO_FUNCTION', `unknown function ${e.name}()`);
      const args = e.args.map(a => compile(a, cx));
      return (r, g) => fn(...args.map(a => a(r, g)));
    }
    case 'bin': {
      const l = compile(e.l, cx), rr = compile(e.r, cx);
      switch (e.op) {
        case 'and': return (r, g) => { const a = tb(l(r, g)); if (a === false) return false; const b = tb(rr(r, g)); if (b === false) return false; return a === null || b === null ? null : true; };
        case 'or': return (r, g) => { const a = tb(l(r, g)); if (a === true) return true; const b = tb(rr(r, g)); if (b === true) return true; return a === null || b === null ? null : false; };
        case '=': return (r, g) => { const a = l(r, g), b = rr(r, g); return a === null || b === null ? null : cmpVals(a, b) === 0; };
        case '!=': return (r, g) => { const a = l(r, g), b = rr(r, g); return a === null || b === null ? null : cmpVals(a, b) !== 0; };
        case '<': return (r, g) => { const a = l(r, g), b = rr(r, g); return a === null || b === null ? null : cmpVals(a, b) < 0; };
        case '<=': return (r, g) => { const a = l(r, g), b = rr(r, g); return a === null || b === null ? null : cmpVals(a, b) <= 0; };
        case '>': return (r, g) => { const a = l(r, g), b = rr(r, g); return a === null || b === null ? null : cmpVals(a, b) > 0; };
        case '>=': return (r, g) => { const a = l(r, g), b = rr(r, g); return a === null || b === null ? null : cmpVals(a, b) >= 0; };
        case '+': return (r, g) => { const a = l(r, g), b = rr(r, g); return a === null || b === null ? null : a + b; };
        case '-': return (r, g) => { const a = l(r, g), b = rr(r, g); return a === null || b === null ? null : a - b; };
        case '*': return (r, g) => { const a = l(r, g), b = rr(r, g); return a === null || b === null ? null : a * b; };
        case '/': return (r, g) => { const a = l(r, g), b = rr(r, g); return a === null || b === null || b === 0 ? null : a / b; };
        case '%': return (r, g) => { const a = l(r, g), b = rr(r, g); return a === null || b === null || b === 0 ? null : a % b; };
        case '||': return (r, g) => { const a = l(r, g), b = rr(r, g); return a === null || b === null ? null : String(a) + String(b); };
      }
    }
  }
  fail('INTERNAL', `cannot compile ${e.t}`);
}

function aggStep(a, st, r) {
  if (a.star) { st.n++; return; }
  const v = a.arg(r, null); if (v === null) return;
  if (a.distinct) { const k = JSON.stringify(v); if (!st.set) st.set = new Set(); if (st.set.has(k)) return; st.set.add(k); }
  st.n++;
  if (a.name === 'sum' || a.name === 'avg') st.s += v;
  else if (a.name === 'min') { if (st.v === null || cmpVals(v, st.v) < 0) st.v = v; }
  else if (a.name === 'max') { if (st.v === null || cmpVals(v, st.v) > 0) st.v = v; }
}
function aggFinal(a, st) {
  switch (a.name) {
    case 'count': return st.n;
    case 'sum': return st.n ? st.s : null;
    case 'avg': return st.n ? st.s / st.n : null;
    default: return st.v;
  }
}

// ───────────────────────── storage structures ─────────────────────────

// Ordered index: entries { k: key values, id: row id } kept sorted by (k, id) in
// small chunks, so inserts and deletes only shift a few hundred entries however
// big the table is. Serves equality lookups, uniqueness checks and in-order
// scans (ORDER BY ... LIMIT n).
const CHUNK = 512;
class Index {
  constructor(name, cols, unique) { this.name = name; this.cols = cols; this.unique = unique; this.c = [[]]; }
  key(row) { const c = this.cols, k = new Array(c.length); for (let i = 0; i < c.length; i++) k[i] = row[c[i]]; return k; }
  // Position { ci, p } of the first entry that sorts at or after the target.
  // The target is the first n key values (plus row id when id is not null).
  // after = true moves past entries equal to the target.
  seek(key, n, id, after) {
    const less = en => { let c = cmpN(en.k, key, n); if (c === 0 && id !== null) c = en.id < id ? -1 : en.id > id ? 1 : 0; return c < 0 || (after && c === 0); };
    const c = this.c; let lo = 0, hi = c.length - 1;
    while (lo < hi) { const mid = (lo + hi) >>> 1, ch = c[mid]; if (less(ch[ch.length - 1])) lo = mid + 1; else hi = mid; }
    const ch = c[lo]; let a = 0, b = ch.length;
    while (a < b) { const m = (a + b) >>> 1; if (less(ch[m])) a = m + 1; else b = m; }
    return { ci: lo, p: a };
  }
  add(row, id) {
    const k = this.key(row), pos = this.seek(k, k.length, id, false);
    const ch = this.c[pos.ci]; ch.splice(pos.p, 0, { k, id });
    if (ch.length > CHUNK * 2) this.c.splice(pos.ci + 1, 0, ch.splice(CHUNK));
  }
  remove(row, id) {
    const k = this.key(row), pos = this.seek(k, k.length, id, false);
    const ch = this.c[pos.ci], en = ch[pos.p];
    if (!en || en.id !== id) return;
    ch.splice(pos.p, 1);
    if (!ch.length && this.c.length > 1) this.c.splice(pos.ci, 1);
  }
  find(key) { return this.ids(this.seek(key, key.length, null, false), this.seek(key, key.length, null, true)); }
  ids(a, b) { const out = []; this.walk(a, b, false, en => { out.push(en.id); }); return out; }
  // Number of entries between two positions, without visiting them.
  count(a, b) {
    if (a.ci > b.ci || (a.ci === b.ci && a.p >= b.p)) return 0;
    if (a.ci === b.ci) return b.p - a.p;
    let n = this.c[a.ci].length - a.p + b.p;
    for (let ci = a.ci + 1; ci < b.ci; ci++) n += this.c[ci].length;
    return n;
  }
  // Visit entries from position a up to (not including) b, in key order or
  // reverse. fn returns false to stop; walk then returns false too.
  walk(a, b, desc, fn) {
    const c = this.c;
    if (desc) {
      for (let ci = b.ci; ci >= a.ci; ci--) { const ch = c[ci], s = ci === a.ci ? a.p : 0, e = ci === b.ci ? b.p : ch.length; for (let p = e - 1; p >= s; p--) if (fn(ch[p]) === false) return false; }
    } else {
      for (let ci = a.ci; ci <= b.ci; ci++) { const ch = c[ci], s = ci === a.ci ? a.p : 0, e = ci === b.ci ? b.p : ch.length; for (let p = s; p < e; p++) if (fn(ch[p]) === false) return false; }
    }
    return true;
  }
  each(desc, fn) { const last = this.c.length - 1; return this.walk({ ci: 0, p: 0 }, { ci: last, p: this.c[last].length }, desc, fn); }
  hasDuplicates() {
    let prev = null, dup = false;
    this.each(false, en => { if (prev && !en.k.includes(null) && cmpKey(en.k, prev.k) === 0) { dup = true; return false; } prev = en; });
    return dup;
  }
  rebuild(rows) {
    const all = []; for (const [id, row] of rows) all.push({ k: this.key(row), id });
    all.sort((a, b) => cmpKey(a.k, b.k) || (a.id - b.id));
    this.c = []; for (let i = 0; i < all.length; i += CHUNK) this.c.push(all.slice(i, i + CHUNK));
    if (!this.c.length) this.c.push([]);
  }
}

/** Storage that lives in memory only (lost when the page or process ends). */
export function memoryStorage() {
  const m = new Map();
  return { read: n => (m.has(n) ? m.get(n) : null), write: (n, s) => { m.set(n, s); }, append: (n, s) => { m.set(n, (m.get(n) || '') + s); } };
}
/** Browser storage on localStorage. Good for single-player saves of modest size. */
export function localStorageStorage(prefix = 'gamedb:') {
  const ls = globalThis.localStorage;
  return { read: n => ls.getItem(prefix + n), write: (n, s) => ls.setItem(prefix + n, s), append: (n, s) => ls.setItem(prefix + n, (ls.getItem(prefix + n) || '') + s) };
}

/**
 * Browser storage on IndexedDB, for saves too big for localStorage.
 * Usage: const storage = await indexedDBStorage(); GameDB.open({ storage })
 * Data is held in memory and written to IndexedDB a moment after each change.
 */
export async function indexedDBStorage(dbName = 'gamedb') {
  const idb = await new Promise((res, rej) => {
    const r = globalThis.indexedDB.open(dbName, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const mem = new Map();
  await new Promise((res, rej) => {
    const tx = idb.transaction('files'), cur = tx.objectStore('files').openCursor();
    cur.onsuccess = () => { const c = cur.result; if (c) { mem.set(c.key, c.value); c.continue(); } };
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
  const dirty = new Set(); let timer = null;
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!dirty.size) return;
    const os = idb.transaction('files', 'readwrite').objectStore('files'); // one transaction: snapshot and log land together
    for (const n of dirty) os.put(mem.get(n), n);
    dirty.clear();
  };
  const mark = n => { dirty.add(n); if (!timer) timer = setTimeout(flush, 200); };
  if (globalThis.addEventListener) { globalThis.addEventListener('pagehide', flush); globalThis.addEventListener('visibilitychange', () => { if (globalThis.document && globalThis.document.hidden) flush(); }); }
  return { read: n => (mem.has(n) ? mem.get(n) : null), write: (n, s) => { mem.set(n, s); mark(n); }, append: (n, s) => { mem.set(n, (mem.get(n) || '') + s); mark(n); }, flush };
}

// ───────────────────────── the database ─────────────────────────

export class GameDB {
  /** Open a database. With `storage`, data is loaded from and saved to it. */
  static open(opts = {}) { const db = new GameDB(opts); db._load(); return db; }

  constructor({ name = 'game', storage = null, checkpointEvery = 2000 } = {}) {
    this.name = name; this.storage = storage; this.checkpointEvery = checkpointEvery;
    this.tables = new Map(); this.indexNames = new Map();
    this._tx = null; this._seq = 0; this._logCount = 0;
    this._cache = new Map(); this._listeners = []; this._E = { params: [] };
  }

  // ── public API ──

  /** Run one or more SQL statements. Returns { columns, rows, changes } of the last one. */
  exec(sql, params = []) {
    let stmts = this._cache.get(sql);
    if (!stmts) { stmts = new Parser(sql).all(); if (this._cache.size > 500) this._cache.clear(); this._cache.set(sql, stmts); }
    this._E.params = params;
    let res = null;
    for (const st of stmts) res = this._runStmt(st);
    return res || { columns: [], rows: [], changes: 0 };
  }
  /** Run a query and return its rows as objects. */
  query(sql, params) { return this.exec(sql, params).rows; }
  /** Run a query and return the first row, or null. */
  get(sql, params) { return this.exec(sql, params).rows[0] ?? null; }
  /** Run a write and return how many rows changed. */
  run(sql, params) { return this.exec(sql, params).changes; }
  /** Run fn inside a transaction: all of its writes commit together or not at all. */
  transaction(fn) {
    this.exec('BEGIN');
    try { const r = fn(this); this.exec('COMMIT'); return r; }
    catch (e) { if (this._tx) this.exec('ROLLBACK'); throw e; }
  }
  /** True while a BEGIN ... COMMIT block is open. */
  get inTransaction() { return !!this._tx && this._tx.explicit; }
  /** Listen for committed changes: fn(ops) with ops like ['i'|'u'|'d', table, rowId, row]. */
  onChange(fn) { this._listeners.push(fn); return () => { this._listeners = this._listeners.filter(f => f !== fn); }; }

  /** Write a full snapshot and empty the change log. */
  checkpoint() {
    if (!this.storage) return;
    const tables = [];
    for (const t of this.tables.values()) {
      tables.push({ def: t.def, nextId: t.nextId, rows: [...t.rows], indexes: t.indexes.filter(ix => !ix.auto).map(ix => ({ name: ix.name, cols: ix.cols.map(c => t.cols[c].name), unique: ix.unique })) });
    }
    this.storage.write(this.name + '.snap', JSON.stringify({ v: 1, seq: this._seq, tables }));
    this.storage.write(this.name + '.log', '');
    this._logCount = 0;
  }

  // ── persistence ──

  _load() {
    if (!this.storage) return;
    const snap = this.storage.read(this.name + '.snap');
    if (snap) {
      const d = JSON.parse(snap); this._seq = d.seq;
      for (const tt of d.tables) {
        this._ddl(tt.def);
        const t = this.tables.get(tt.def.name); t.nextId = tt.nextId;
        for (const [id, row] of tt.rows) t.rows.set(id, t.jsonCols.length ? this._freezeRow(t, row) : row);
        for (const ix of tt.indexes) this._ddl({ s: 'createIndex', name: ix.name, table: t.name, cols: ix.cols, unique: ix.unique });
        for (const ix of t.indexes) ix.rebuild(t.rows);
      }
    }
    const log = this.storage.read(this.name + '.log');
    if (log) {
      for (const line of log.split('\n')) {
        if (!line) continue;
        let rec; try { rec = JSON.parse(line); } catch { break; } // torn final write after a crash
        this._logCount++;
        if (rec.s <= this._seq) continue;
        for (const op of rec.o) this._replay(op);
        this._seq = rec.s;
      }
    }
  }
  _freezeRow(t, row) { for (const ci of t.jsonCols) deepFreeze(row[ci]); return row; }
  _replay(op) {
    if (op[0] === 'ddl') { this._ddl(op[1]); return; }
    const t = this.tables.get(op[1]);
    if (op[0] === 'i') this._rawInsert(t, op[2], this._freezeRow(t, op[3]));
    else if (op[0] === 'u') this._rawUpdate(t, op[2], this._freezeRow(t, op[3]));
    else this._rawDelete(t, op[2]);
  }

  // ── transactions ──

  _runStmt(st) {
    if (st.s === 'begin') { if (this._tx) fail('TX', 'a transaction is already open'); this._tx = { undo: [], redo: [], explicit: true }; return null; }
    if (st.s === 'commit') { if (!this._tx) fail('TX', 'no transaction is open'); this._commit(); return null; }
    if (st.s === 'rollback') { if (!this._tx) fail('TX', 'no transaction is open'); this._rollbackTo(0); this._tx = null; return null; }
    const implicit = !this._tx;
    if (implicit) this._tx = { undo: [], redo: [], explicit: false };
    const tx = this._tx, mark = tx.undo.length, rmark = tx.redo.length;
    let res;
    try {
      switch (st.s) {
        case 'select': res = this._select(st); break;
        case 'insert': res = this._insert(st); break;
        case 'update': res = this._update(st); break;
        case 'delete': res = this._delete(st); break;
        default:
          if (!implicit) fail('TX', 'CREATE and DROP cannot run inside a transaction');
          if (this._ddl(st)) tx.redo.push(['ddl', st]);
          res = { columns: [], rows: [], changes: 0 };
      }
    } catch (e) {
      this._rollbackTo(mark); tx.redo.length = rmark;
      if (implicit) this._tx = null;
      throw e;
    }
    if (implicit) this._commit();
    return res;
  }
  _rollbackTo(mark) { const u = this._tx.undo; while (u.length > mark) u.pop()(); }
  _commit() {
    const tx = this._tx; this._tx = null;
    if (!tx.redo.length) return;
    this._seq++;
    if (this.storage) {
      this.storage.append(this.name + '.log', JSON.stringify({ s: this._seq, o: tx.redo }) + '\n');
      if (++this._logCount >= this.checkpointEvery) this.checkpoint();
    }
    for (const fn of this._listeners) fn(tx.redo);
  }

  // ── schema ──

  _table(name) { const t = this.tables.get(name); if (!t) fail('NO_TABLE', `unknown table "${name}"`); return t; }
  // Returns true when the schema actually changed.
  _ddl(st) {
    if (st.s === 'createTable') {
      if (this.tables.has(st.name)) { if (st.ifNot) return false; fail('EXISTS', `table "${st.name}" already exists`); }
      const colIdx = new Map();
      st.cols.forEach((c, i) => { if (colIdx.has(c.name)) fail('SYNTAX', `column "${c.name}" appears twice`); colIdx.set(c.name, i); });
      const need = n => { const i = colIdx.get(n); if (i === undefined) fail('NO_COLUMN', `unknown column "${n}" in table "${st.name}"`); return i; };
      const cols = st.cols.map(c => ({ ...c }));
      const t = { name: st.name, def: st, cols, colIdx, rows: new Map(), nextId: 1, indexes: [], jsonCols: cols.map((c, i) => (c.type === 'json' ? i : -1)).filter(i => i >= 0) };
      if (st.pk) { const pc = st.pk.map(need); pc.forEach(i => { cols[i].notNull = true; }); const ix = new Index(st.name + '_pkey', pc, true); ix.auto = true; t.indexes.push(ix); }
      st.uniques.forEach((u, n) => { const ix = new Index(`${st.name}_unique${n + 1}`, u.map(need), true); ix.auto = true; t.indexes.push(ix); });
      for (const ix of t.indexes) this.indexNames.set(ix.name, t.name);
      this.tables.set(st.name, t);
      return true;
    }
    if (st.s === 'createIndex') {
      if (this.indexNames.has(st.name)) { if (st.ifNot) return false; fail('EXISTS', `index "${st.name}" already exists`); }
      const t = this._table(st.table);
      const ix = new Index(st.name, st.cols.map(n => { const i = t.colIdx.get(n); if (i === undefined) fail('NO_COLUMN', `unknown column "${n}" in table "${t.name}"`); return i; }), st.unique);
      ix.rebuild(t.rows);
      if (ix.unique && ix.hasDuplicates()) fail('UNIQUE', `cannot create unique index "${st.name}": duplicate values exist`);
      t.indexes.push(ix); this.indexNames.set(ix.name, t.name);
      return true;
    }
    if (st.s === 'dropTable') {
      const t = this.tables.get(st.name);
      if (!t) { if (st.ifExists) return false; fail('NO_TABLE', `unknown table "${st.name}"`); }
      for (const ix of t.indexes) this.indexNames.delete(ix.name);
      this.tables.delete(st.name);
      return true;
    }
    if (st.s === 'dropIndex') {
      const tn = this.indexNames.get(st.name);
      if (!tn) { if (st.ifExists) return false; fail('NO_INDEX', `unknown index "${st.name}"`); }
      const t = this.tables.get(tn); const ix = t.indexes.find(x => x.name === st.name);
      if (ix.auto) fail('NO_INDEX', `index "${st.name}" belongs to the table definition and cannot be dropped`);
      t.indexes = t.indexes.filter(x => x !== ix); this.indexNames.delete(st.name);
      return true;
    }
    fail('INTERNAL', `unknown statement ${st.s}`);
  }

  // ── row operations ──
  // raw* = apply without checks or logging (used by undo and by log replay).

  _rawInsert(t, id, row) { t.rows.set(id, row); for (const ix of t.indexes) ix.add(row, id); if (id >= t.nextId) t.nextId = id + 1; }
  _rawDelete(t, id) { const row = t.rows.get(id); if (!row) return; for (const ix of t.indexes) ix.remove(row, id); t.rows.delete(id); }
  _rawUpdate(t, id, row) {
    const old = t.rows.get(id);
    for (const ix of t.indexes) { if (cmpKey(ix.key(old), ix.key(row)) === 0) continue; ix.remove(old, id); ix.add(row, id); }
    t.rows.set(id, row);
  }

  _checkRow(t, row) {
    for (let i = 0; i < t.cols.length; i++) {
      const c = t.cols[i]; row[i] = coerce(c, row[i]);
      if (row[i] === null && c.notNull) fail('NOT_NULL', `column "${c.name}" in table "${t.name}" cannot be null`);
    }
  }
  // First unique-index clash for this row, ignoring row `exceptId`.
  _conflict(t, row, exceptId) {
    for (const ix of t.indexes) {
      if (!ix.unique) continue;
      const k = ix.key(row); if (k.includes(null)) continue;
      for (const id of ix.find(k)) if (id !== exceptId) return { id, ix };
    }
    return null;
  }
  _ins(t, row) {
    const id = t.nextId++;
    this._rawInsert(t, id, row);
    this._tx.undo.push(() => this._rawDelete(t, id)); this._tx.redo.push(['i', t.name, id, row]);
  }
  _upd(t, id, row) {
    const c = this._conflict(t, row, id);
    if (c) fail('UNIQUE', `duplicate value for "${c.ix.name}"`);
    const old = t.rows.get(id);
    this._rawUpdate(t, id, row);
    this._tx.undo.push(() => this._rawUpdate(t, id, old)); this._tx.redo.push(['u', t.name, id, row]);
  }
  _del(t, id) {
    const old = t.rows.get(id);
    this._rawDelete(t, id);
    this._tx.undo.push(() => this._rawInsert(t, id, old)); this._tx.redo.push(['d', t.name, id]);
  }

  // ── planning helpers ──

  _scope(srcs) {
    return (tn, n, soft) => {
      let hit = null;
      for (let i = 0; i < srcs.length; i++) {
        const s = srcs[i]; if (tn && s.alias !== tn) continue;
        const ci = s.table.colIdx.get(n); if (ci === undefined) continue;
        if (hit) { if (soft) return null; fail('AMBIGUOUS', `column "${n}" exists in more than one table; write table.${n}`); }
        hit = { ti: i, ci };
      }
      if (!hit && !soft) fail('NO_COLUMN', `unknown column "${tn ? tn + '.' : ''}${n}"`);
      return hit;
    };
  }
  // Find the conditions on table `ti` an index could serve: "col = value" and
  // "col < / <= / > / >= / BETWEEN value", where value does not read this table.
  _analyze(ti, conjs, cx, refsOk) {
    const eq = new Map(), rng = new Map();
    const usable = (colE, valE) => {
      if (colE.t !== 'col') return null;
      const rc = cx.resolve(colE.table, colE.name, true); if (!rc || rc.ti !== ti) return null;
      const rs = refs(valE, cx); return rs === null || !refsOk(rs) ? null : rc.ci;
    };
    const slot = ci => { let r = rng.get(ci); if (!r) { r = { lo: null, hi: null }; rng.set(ci, r); } return r; };
    for (const c of conjs) {
      if (c.t === 'bin' && c.op === '=') {
        for (const [a, b] of [[c.l, c.r], [c.r, c.l]]) { const ci = usable(a, b); if (ci === null) continue; if (!eq.has(ci)) eq.set(ci, { f: compile(b, cx), node: c }); break; }
      } else if (c.t === 'bin' && (c.op === '<' || c.op === '<=' || c.op === '>' || c.op === '>=')) {
        let ci = usable(c.l, c.r), op = c.op, v = c.r;
        if (ci === null) { ci = usable(c.r, c.l); v = c.l; op = (op[0] === '<' ? '>' : '<') + op.slice(1); }
        if (ci === null) continue;
        const r = slot(ci), side = op[0] === '>' ? 'lo' : 'hi';
        if (!r[side]) r[side] = { f: compile(v, cx), incl: op.length === 2, node: c };
      } else if (c.t === 'between' && !c.not) {
        const ci = usable(c.e, c.lo); if (ci === null || usable(c.e, c.hi) === null) continue;
        const r = slot(ci); if (r.lo || r.hi) continue;
        r.lo = { f: compile(c.lo, cx), incl: true, node: c }; r.hi = { f: compile(c.hi, cx), incl: true, node: c };
      }
    }
    return { eq, rng };
  }
  // A plan reads the part of an index where the first p columns equal given
  // values and (optionally) the next column lies in a range.
  _mkPlan(ix, p, an) {
    const eqF = [], used = new Set();
    for (let i = 0; i < p; i++) { const e = an.eq.get(ix.cols[i]); eqF.push(e.f); used.add(e.node); }
    const r = p < ix.cols.length ? an.rng.get(ix.cols[p]) : null, lo = r && r.lo, hi = r && r.hi;
    if (lo) used.add(lo.node); if (hi) used.add(hi.node);
    const bounds = cur => {
      const key = eqF.map(f => f(cur, null)); if (key.includes(null)) return null;
      let a, b;
      if (lo) { const v = lo.f(cur, null); if (v === null) return null; a = ix.seek([...key, v], p + 1, null, !lo.incl); }
      else if (hi) a = ix.seek([...key, null], p + 1, null, true); // a range never matches NULL
      else a = ix.seek(key, p, null, false);
      if (hi) { const v = hi.f(cur, null); if (v === null) return null; b = ix.seek([...key, v], p + 1, null, hi.incl); }
      else b = ix.seek(key, p, null, true);
      return [a, b];
    };
    return { ix, used, bounds };
  }
  _pick(table, an) {
    let best = null, bestScore = 0;
    for (const ix of table.indexes) {
      let p = 0; while (p < ix.cols.length && an.eq.has(ix.cols[p])) p++;
      const full = p === ix.cols.length, r = !full && an.rng.has(ix.cols[p]);
      if (p === 0 && !r) continue;
      const score = full ? (ix.unique ? 1000 : 500) + p : p * 2 + (r ? 1 : 0);
      if (score > bestScore) { bestScore = score; best = this._mkPlan(ix, p, an); }
    }
    return best;
  }
  // A plan whose index order already matches ORDER BY columns `oc`.
  _pickOrdered(table, an, oc) {
    for (const ix of table.indexes) {
      let maxP = 0; while (maxP < ix.cols.length && an.eq.has(ix.cols[maxP])) maxP++;
      for (let p = Math.min(maxP, ix.cols.length - oc.length); p >= 0; p--) {
        if (oc.every((c, i) => ix.cols[p + i] === c)) return this._mkPlan(ix, p, an);
      }
    }
    return null;
  }
  // Rows of one table matching WHERE, as [id, row] pairs (for UPDATE and DELETE).
  _targets(t, whereAst) {
    const cx = { resolve: this._scope([{ alias: t.name, table: t }]), E: this._E, aggs: null };
    const where = whereAst ? compile(whereAst, cx) : null;
    const plan = whereAst ? this._pick(t, this._analyze(0, conjuncts(whereAst), cx, s => s.size === 0)) : null;
    const out = [], cur = [null];
    const test = (id, row) => { cur[0] = row; if (!where || where(cur, null) === true) out.push([id, row]); };
    if (plan) { const b = plan.bounds(cur); if (b) for (const id of plan.ix.ids(b[0], b[1])) test(id, t.rows.get(id)); }
    else for (const [id, row] of t.rows) test(id, row);
    return { out, cx };
  }

  // ── statements ──

  _insert(st) {
    const t = this._table(st.table);
    const cols = st.cols ? st.cols.map(n => { const i = t.colIdx.get(n); if (i === undefined) fail('NO_COLUMN', `unknown column "${n}" in table "${t.name}"`); return i; }) : t.cols.map((_, i) => i);
    const cx0 = { resolve: (tn, n) => fail('NO_COLUMN', `unknown column "${n}"`), E: this._E, aggs: null };
    let sets = null;
    if (st.conflict && st.conflict.set) {
      const scope = this._scope([{ alias: t.name, table: t }, { alias: 'excluded', table: t }]);
      const cx = { resolve: (tn, n, soft) => scope(tn || t.name, n, soft), E: this._E, aggs: null };
      sets = st.conflict.set.map(s => ({ ci: cx.resolve(t.name, s.col).ci, f: compile(s.e, cx) }));
    }
    let changes = 0;
    for (const tuple of st.rows) {
      if (tuple.length !== cols.length) fail('COUNT', `expected ${cols.length} values but got ${tuple.length}`);
      const row = new Array(t.cols.length).fill(undefined);
      cols.forEach((ci, i) => { row[ci] = compile(tuple[i], cx0)([], null); });
      for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = t.cols[i].def ? compile(t.cols[i].def, cx0)([], null) : null;
      this._checkRow(t, row);
      const c = this._conflict(t, row, null);
      if (c) {
        if (!st.conflict) fail('UNIQUE', `duplicate value for "${c.ix.name}"`);
        if (sets) {
          const old = t.rows.get(c.id), nr = old.slice();
          for (const s of sets) nr[s.ci] = s.f([old, row], null);
          this._checkRow(t, nr); this._upd(t, c.id, nr); changes++;
        }
        continue;
      }
      this._ins(t, row); changes++;
    }
    return { columns: [], rows: [], changes };
  }

  _update(st) {
    const t = this._table(st.table);
    const { out, cx } = this._targets(t, st.where);
    const sets = st.set.map(s => ({ ci: cx.resolve(null, s.col).ci, f: compile(s.e, cx) }));
    for (const [id, row] of out) {
      const nr = row.slice();
      for (const s of sets) nr[s.ci] = s.f([row], null);
      this._checkRow(t, nr); this._upd(t, id, nr);
    }
    return { columns: [], rows: [], changes: out.length };
  }

  _delete(st) {
    const t = this._table(st.table);
    const { out } = this._targets(t, st.where);
    for (const [id] of out) this._del(t, id);
    return { columns: [], rows: [], changes: out.length };
  }

  _select(st) {
    const srcs = [];
    if (st.from) {
      srcs.push({ alias: st.from.alias, table: this._table(st.from.name), left: false, onAst: null });
      for (const j of st.joins) srcs.push({ alias: j.alias, table: this._table(j.name), left: j.left, onAst: j.on });
      const seen = new Set();
      for (const s of srcs) { if (seen.has(s.alias)) fail('AMBIGUOUS', `table name "${s.alias}" is used twice; give one an alias`); seen.add(s.alias); }
    }
    const resolve = this._scope(srcs);
    const cxRow = { resolve, E: this._E, aggs: null };
    const cxAgg = { resolve, E: this._E, aggs: [] };

    // Output columns.
    const items = [];
    for (const it of st.items) {
      if (it.star) {
        if (!srcs.length) fail('SYNTAX', 'SELECT * needs a FROM');
        let any = false;
        srcs.forEach((s, ti) => { if (it.table && s.alias !== it.table) return; any = true; s.table.cols.forEach((c, ci) => items.push({ name: c.name, e: { t: 'col', table: s.alias, name: c.name }, ti, ci })); });
        if (!any) fail('NO_TABLE', `unknown table "${it.table}"`);
      } else items.push({ name: it.as || (it.e.t === 'col' ? it.e.name : it.e.t === 'fn' ? it.e.name : `col${items.length + 1}`), e: it.e, as: it.as });
    }
    const itemFns = items.map(it => compile(it.e, cxAgg));
    const having = st.having ? compile(st.having, cxAgg) : null;
    const orderFns = st.orderBy.map(o => {
      if (o.e.t === 'lit' && Number.isInteger(o.e.v)) { const i = o.e.v - 1; if (i < 0 || i >= items.length) fail('SYNTAX', `ORDER BY ${o.e.v} is out of range`); return (r, g, out) => out[i]; }
      if (o.e.t === 'col' && !o.e.table) { const i = items.findIndex(it => it.as === o.e.name); if (i >= 0) return (r, g, out) => out[i]; }
      return compile(o.e, cxAgg);
    });
    const grouped = cxAgg.aggs.length > 0 || st.groupBy.length > 0;
    const groupFns = st.groupBy.map(e => compile(e, cxRow));
    const where = st.where ? compile(st.where, cxRow) : null;
    const lim = (e, dflt) => { if (!e) return dflt; const v = compile(e, cxRow)([], null); if (typeof v !== 'number' || v < 0) fail('SYNTAX', 'LIMIT and OFFSET must be non-negative numbers'); return Math.floor(v); };
    const limit = lim(st.limit, Infinity), offset = lim(st.offset, 0);

    // Access paths.
    let presorted = false;
    const whereConjs = conjuncts(st.where);
    srcs.forEach((s, i) => {
      s.an = this._analyze(i, i === 0 ? whereConjs : conjuncts(s.onAst), cxRow, i === 0 ? (set => set.size === 0) : (set => [...set].every(x => x < i)));
      s.plan = this._pick(s.table, s.an); s.desc = false;
      s.on = s.onAst ? compile(s.onAst, cxRow) : null;
    });
    // If an index on the first table already yields rows in ORDER BY order, read
    // it in that order and skip the sort (this is what makes top-N instant).
    if (!grouped && !st.distinct && srcs.length && st.orderBy.length) {
      const desc = st.orderBy[0].desc; let oc = [];
      for (const o of st.orderBy) {
        if (o.e.t !== 'col' || o.desc !== desc || (!o.e.table && items.some(it => it.as === o.e.name))) { oc = null; break; }
        const rc = resolve(o.e.table, o.e.name, true); if (!rc || rc.ti !== 0) { oc = null; break; }
        oc.push(rc.ci);
      }
      const op = oc && this._pickOrdered(srcs[0].table, srcs[0].an, oc);
      if (op) { srcs[0].plan = op; srcs[0].desc = desc; presorted = true; }
    }

    // Row source: nested-loop join, calling emit(cur) for each combined row.
    const cur = new Array(srcs.length).fill(null);
    const step = (i, emit) => {
      if (i === srcs.length) { if (where && where(cur, null) !== true) return true; return emit(cur); }
      const s = srcs[i], rows = s.table.rows; let matched = false;
      const visit = row => { cur[i] = row; if (s.on && s.on(cur, null) !== true) return true; matched = true; return step(i + 1, emit); };
      if (s.plan) { const b = s.plan.bounds(cur); if (b && s.plan.ix.walk(b[0], b[1], s.desc, en => visit(rows.get(en.id))) === false) return false; }
      else for (const row of rows.values()) if (visit(row) === false) return false;
      if (!matched && s.left) { cur[i] = null; if (step(i + 1, emit) === false) return false; }
      return true;
    };

    let results = []; // { o: output values, k: sort keys }
    const needKeys = orderFns.length > 0 && !presorted;
    if (grouped) {
      const aggs = cxAgg.aggs, groups = new Map();
      const newGroup = first => ({ first, st: aggs.map(() => ({ n: 0, s: 0, v: null, set: null })) });
      // COUNT(*) answered straight from an index (or the table size) when every
      // WHERE condition is covered by the index range: no rows are visited.
      const plan0 = srcs.length === 1 ? srcs[0].plan : null;
      const fastCount = !groupFns.length && srcs.length === 1 && aggs.length === 1 && aggs[0].star &&
        (!where || (plan0 && whereConjs.every(c => plan0.used.has(c))));
      if (fastCount) {
        const grp = newGroup([null]);
        if (!where) grp.st[0].n = srcs[0].table.rows.size;
        else { const b = plan0.bounds(cur); grp.st[0].n = b ? plan0.ix.count(b[0], b[1]) : 0; }
        groups.set('', grp);
      } else step(0, r => {
        const key = groupFns.length ? JSON.stringify(groupFns.map(f => f(r, null))) : '';
        let grp = groups.get(key); if (!grp) { grp = newGroup(r.slice()); groups.set(key, grp); }
        for (let i = 0; i < aggs.length; i++) aggStep(aggs[i], grp.st[i], r);
        return true;
      });
      if (!groups.size && !groupFns.length) groups.set('', newGroup(srcs.map(() => null)));
      for (const grp of groups.values()) {
        const g = grp.st.map((s, i) => aggFinal(aggs[i], s));
        if (having && having(grp.first, g) !== true) continue;
        const o = itemFns.map(f => f(grp.first, g));
        results.push({ o, k: needKeys ? orderFns.map(f => f(grp.first, g, o)) : null });
      }
    } else {
      if (having) fail('SYNTAX', 'HAVING needs GROUP BY or an aggregate');
      const stopAt = (!needKeys && !st.distinct) ? offset + limit : Infinity;
      if (stopAt > 0) step(0, r => {
        const o = itemFns.map(f => f(r, null));
        results.push({ o, k: needKeys ? orderFns.map(f => f(r, null, o)) : null });
        return results.length < stopAt;
      });
    }
    if (st.distinct) { const seen = new Set(); results = results.filter(x => { const k = JSON.stringify(x.o); if (seen.has(k)) return false; seen.add(k); return true; }); }
    if (needKeys) {
      const desc = st.orderBy.map(o => o.desc);
      results.sort((a, b) => { for (let i = 0; i < desc.length; i++) { const c = cmpVals(a.k[i], b.k[i]); if (c) return desc[i] ? -c : c; } return 0; });
    }
    if (offset || limit !== Infinity) results = results.slice(offset, offset + limit);
    const columns = items.map(it => it.name);
    const rows = results.map(x => { const obj = {}; for (let i = 0; i < columns.length; i++) obj[columns[i]] = x.o[i]; return obj; });
    return { columns, rows, changes: 0 };
  }
}
