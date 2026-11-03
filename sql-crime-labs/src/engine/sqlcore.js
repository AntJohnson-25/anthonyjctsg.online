// Read-only query runner shared by the browser worker (importScripts) and the Node validator (require).
// Plain script on purpose: classic workers can't import ES modules alongside the UMD sql.js build.
(function (root) {
  "use strict";

  var WRITES = /\b(insert|update|delete|drop|alter|create|attach|detach|pragma|replace|vacuum|reindex|analyze|begin|commit|rollback|savepoint|release|upsert)\b/i;

  // Blank out comments and string literals so keyword checks only see real SQL.
  function strip(sql) {
    return sql
      .replace(/--[^\n]*/g, " ")
      .replace(/\/\*[\s\S]*?(\*\/|$)/g, " ")
      .replace(/'(?:[^']|'')*'?/g, "''")
      .replace(/"(?:[^"]|"")*"?/g, "\"\"");
  }

  function check(sql) {
    var s = strip(sql);
    var parts = s.split(";").filter(function (p) { return p.trim() !== ""; });
    if (parts.length === 0) return "Type a query first.";
    if (parts.length > 1) return "Run one statement at a time (there's more than one ; separated statement).";
    var first = parts[0].trim().split(/\s+/)[0].toLowerCase();
    if (first !== "select" && first !== "with" && first !== "values") return "SQL Quest runs read-only queries. Start with SELECT (or WITH for a CTE).";
    var w = WRITES.exec(parts[0]);
    if (w) return "\"" + w[1].toUpperCase() + "\" changes the database. This game only runs read-only queries.";
    return null;
  }

  // Runs one SELECT, stopping after `cap` rows so a runaway join can't eat the tab.
  function run(db, sql, cap) {
    var err = check(sql);
    if (err) return { error: err };
    var stmt = null;
    try {
      stmt = db.prepare(sql);
      var columns = stmt.getColumnNames();
      var rows = [];
      var truncated = false;
      while (stmt.step()) {
        if (rows.length >= cap) { truncated = true; break; }
        rows.push(stmt.get());
      }
      return { columns: columns, rows: rows, truncated: truncated };
    } catch (e) {
      return { error: String(e && e.message || e) };
    } finally {
      if (stmt) stmt.free();
    }
  }

  var api = { check: check, run: run };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SQLCore = api;
})(typeof self !== "undefined" ? self : this);
