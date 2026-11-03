// Decides how a result set should be drawn.
//   entities  - the rows are people in the population: those figures walk onto the stage
//   aggregate - GROUP BY / aggregate results: one glowing pillar per row (at its pylon when the key is one)
//   spawn     - anything else: one new figure or crate per row drops onto the stage
import { cellKey } from "../engine/grader.js";

const ID_COL = /(^|_)id$/i;

export function stripSql(sql) {
  return String(sql || "")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?(\*\/|$)/g, " ")
    .replace(/'(?:[^']|'')*'?/g, "''");
}

export function isAggregateSql(sql) {
  const s = stripSql(sql);
  if (/\bgroup\s+by\b/i.test(s)) return true;
  // An aggregate call that isn't a window function (no OVER right after its closing paren).
  const re = /\b(count|sum|avg|min|max|total|group_concat)\s*\(/gi;
  let m;
  while ((m = re.exec(s))) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < s.length; i++) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")" && --depth === 0) break;
    }
    if (!/^\s*over\b/i.test(s.slice(i + 1))) return true;
  }
  return false;
}

export function hasOrderBy(sql) {
  return /\border\s+by\b/i.test(stripSql(sql));
}

function numericCols(result) {
  return result.columns.map((c, i) => {
    let seen = false;
    for (const r of result.rows) {
      const v = r[i];
      if (v === null) continue;
      if (typeof v !== "number") return false;
      seen = true;
    }
    return seen;
  });
}

// Index the population so result rows can be matched to people by shared column names.
export function indexPopulation(pop) {
  const cols = pop.columns.map((c) => c.toLowerCase());
  const idIdx = cols.indexOf("_id");
  const keys = pop.rows.map((r) => r.map(cellKey));
  return { cols, idIdx, keys, ids: pop.rows.map((r) => r[idIdx]) };
}

// For each row, the population id it uniquely matches (or null).
export function matchRows(columns, rows, popIndex) {
  const pairs = [];
  columns.forEach((c, i) => {
    const j = popIndex.cols.indexOf(c.toLowerCase());
    if (j >= 0 && c.toLowerCase() !== "_id") pairs.push([i, j]);
  });
  if (!pairs.length) return { ids: rows.map(() => null), unique: 0, pairs: 0 };
  let unique = 0;
  const ids = rows.map((r) => {
    let hit = -1;
    for (let p = 0; p < popIndex.keys.length; p++) {
      const k = popIndex.keys[p];
      if (pairs.every(([i, j]) => cellKey(r[i]) === k[j])) {
        if (hit >= 0) return null;
        hit = p;
      }
    }
    if (hit < 0) return null;
    unique++;
    return popIndex.ids[hit];
  });
  return { ids, unique, pairs: pairs.length };
}

export function analyze(result, sql, popIndex) {
  const n = result.rows.length;
  const numeric = numericCols(result);
  const heatCol = result.columns.findIndex((c, i) => numeric[i] && !ID_COL.test(c));
  let labelCol = result.columns.findIndex((c, i) => !numeric[i]);
  const ordered = hasOrderBy(sql);
  const plan = { mode: "spawn", n, heatCol, labelCol, measureCol: -1, ordered, ids: null };

  const agg = isAggregateSql(sql);
  if (!agg && n > 0) {
    const m = matchRows(result.columns, result.rows, popIndex);
    if (m.pairs && m.unique / n >= 0.6) {
      plan.mode = "entities";
      plan.ids = m.ids;
      return plan;
    }
  }
  if (agg && n > 0 && n <= 60) {
    let measure = -1;
    for (let i = numeric.length - 1; i >= 0; i--) if (numeric[i]) { measure = i; break; }
    if (labelCol < 0 && result.columns.length > 1 && measure !== 0) labelCol = 0;
    if (measure >= 0 && measure !== labelCol) {
      plan.mode = "aggregate";
      plan.measureCol = measure;
      plan.heatCol = measure;
      plan.labelCol = labelCol;
      return plan;
    }
  }
  if (labelCol < 0 && result.columns.length) labelCol = 0;
  plan.labelCol = labelCol;
  return plan;
}

export function heatRange(rows, col) {
  if (col < 0) return null;
  let min = Infinity;
  let max = -Infinity;
  rows.forEach((r) => {
    const v = r[col];
    if (typeof v === "number") { if (v < min) min = v; if (v > max) max = v; }
  });
  if (min === Infinity) return null;
  return { min, max };
}

export function norm(v, range) {
  if (!range || typeof v !== "number") return null;
  if (range.max === range.min) return 0.75;
  return (v - range.min) / (range.max - range.min);
}

export function fmt(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return Math.abs(v) >= 10000 ? v.toLocaleString("en-US") : String(v);
    return (Math.round(v * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  return String(v);
}
