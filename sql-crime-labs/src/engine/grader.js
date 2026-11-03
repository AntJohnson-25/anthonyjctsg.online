// Compares the player's result with the reference solution's result.
// Rows are a multiset unless the question is ordered. Columns are matched by name when both sides
// use the same set of names, otherwise by position. Numbers are compared to 2 decimal places.

export function cellKey(v) {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "number") return numKey(v);
  if (typeof v === "string" && v.trim() !== "" && isFinite(Number(v))) return numKey(Number(v));
  return "s:" + String(v);
}
function numKey(n) {
  return "n:" + (Math.round(n * 100) / 100);
}

export function rowKey(row) {
  return row.map(cellKey).join("␟");
}

export function grade(player, expected, opts) {
  const ordered = !!(opts && opts.ordered);
  const out = { correct: false, extra: new Set(), missing: [], colMismatch: false, orderWrong: false, message: "" };
  const pc = player.columns.length;
  const ec = expected.columns.length;

  if (pc !== ec) {
    out.colMismatch = true;
    out.message = "Expected " + ec + " column" + (ec === 1 ? "" : "s") + " (" + expected.columns.join(", ") + "), you returned " + pc + ".";
    return out;
  }

  // Line the player's columns up with the expected ones by name when that's possible.
  let perm = null;
  const pn = player.columns.map((c) => c.toLowerCase());
  const en = expected.columns.map((c) => c.toLowerCase());
  if (new Set(pn).size === pc && en.every((c) => pn.indexOf(c) >= 0)) perm = en.map((c) => pn.indexOf(c));
  const pRows = perm ? player.rows.map((r) => perm.map((i) => r[i])) : player.rows;

  const pKeys = pRows.map(rowKey);
  const eKeys = expected.rows.map(rowKey);

  const pool = new Map();
  eKeys.forEach((k, i) => { if (!pool.has(k)) pool.set(k, []); pool.get(k).push(i); });
  pKeys.forEach((k, i) => {
    const list = pool.get(k);
    if (list && list.length) list.shift();
    else out.extra.add(i);
  });
  pool.forEach((list) => list.forEach((i) => out.missing.push(expected.rows[i])));

  const sameSet = out.extra.size === 0 && out.missing.length === 0;
  if (sameSet && ordered && pKeys.some((k, i) => k !== eKeys[i])) out.orderWrong = true;
  out.correct = sameSet && !out.orderWrong && !player.truncated;

  if (out.correct) out.message = "Correct.";
  else if (player.truncated) out.message = "Your query returned more than " + player.rows.length + " rows, which is far too many.";
  else if (out.orderWrong) out.message = "Right rows, wrong order. Check your ORDER BY.";
  else {
    const parts = [];
    parts.push("You returned " + pRows.length + " row" + (pRows.length === 1 ? "" : "s") + ", expected " + expected.rows.length + ".");
    if (out.extra.size) parts.push(out.extra.size + " row" + (out.extra.size === 1 ? " shouldn't" : "s shouldn't") + " be there (amber).");
    if (out.missing.length) parts.push(out.missing.length + " row" + (out.missing.length === 1 ? " is" : "s are") + " missing (red).");
    // Wrong columns with the right count: say which columns the question asks for.
    if (!perm && pn.some((c) => en.indexOf(c) < 0)) parts.push("The question asks for: " + expected.columns.join(", ") + ".");
    out.message = parts.join(" ");
  }
  return out;
}
