// Main-thread handle on the SQLite worker. Every query has a time limit; on timeout the worker is
// killed, a fresh one is started and the databases are rebuilt from their seed SQL.

const RUN_TIMEOUT_MS = 4000;
const OPEN_TIMEOUT_MS = 30000;

export class SqlEngine {
  constructor() {
    this.seq = 0;
    this.pending = new Map();
    this.seeds = {};
    this.ready = Promise.resolve();
    this._spawn();
  }

  _spawn() {
    this.worker = new Worker(new URL("./sql-worker.js", import.meta.url));
    this.worker.onmessage = (e) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(e.data.id);
      p.resolve(e.data);
    };
    this.worker.onerror = (e) => {
      const err = new Error(e.message || "SQL worker failed to start");
      this.pending.forEach((p) => { clearTimeout(p.timer); p.reject(err); });
      this.pending.clear();
    };
    const names = Object.keys(this.seeds);
    this.ready = Promise.all(names.map((n) => this._send({ type: "open", name: n, seed: this.seeds[n] }, OPEN_TIMEOUT_MS)));
  }

  _send(msg, timeout) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("timeout")); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage(Object.assign({ id }, msg));
    });
  }

  async open(name, seed) {
    this.seeds[name] = seed;
    await this._send({ type: "open", name, seed }, OPEN_TIMEOUT_MS);
  }

  // Resolves to { columns, rows, truncated } or { error }.
  async run(name, sql, cap = 5000) {
    await this.ready;
    try {
      const reply = await this._send({ type: "run", name, sql, cap }, RUN_TIMEOUT_MS);
      return reply.result;
    } catch (err) {
      if (err.message !== "timeout") return { error: err.message };
      this.worker.terminate();
      this.pending.forEach((p) => { clearTimeout(p.timer); p.reject(new Error("restarted")); });
      this.pending.clear();
      this._spawn();
      await this.ready;
      return { error: "Stopped after " + RUN_TIMEOUT_MS / 1000 + " seconds. Look for a join with no ON condition, or a recursive CTE that never stops." };
    }
  }
}

// Friendlier SQLite errors: suggest the nearest real column/table name for typos.
export function explainError(message, dataset) {
  const m = /no such (column|table): ([\w.]+)/i.exec(message);
  if (!m) return message;
  const wanted = m[2].split(".").pop().toLowerCase();
  const names = m[1].toLowerCase() === "table"
    ? dataset.tables.map((t) => t.name)
    : Array.from(new Set([].concat.apply([], dataset.tables.map((t) => t.columns.map((c) => c[0])))));
  let best = null;
  let bestD = 99;
  names.forEach((n) => { const d = distance(wanted, n.toLowerCase()); if (d < bestD) { bestD = d; best = n; } });
  if (best && bestD <= Math.max(2, Math.floor(wanted.length / 3))) return message + ". Did you mean " + best + "?";
  return message;
}

function distance(a, b) {
  const d = [];
  for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}
