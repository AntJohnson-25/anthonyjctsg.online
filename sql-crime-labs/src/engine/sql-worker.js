// SQLite lives in a worker so a runaway query (endless recursive CTE, huge cross join) can be killed
// by terminating the worker instead of freezing the page.
importScripts("../../vendor/sql-wasm.js", "sqlcore.js");

var dbs = {};
var seeds = {};
var ready = initSqlJs({ locateFile: function (f) { return "../../vendor/" + f; } });

function open(SQL, name) {
  var db = new SQL.Database();
  db.exec(seeds[name]);
  dbs[name] = db;
}

onmessage = function (e) {
  var m = e.data;
  ready.then(function (SQL) {
    try {
      if (m.type === "open") {
        seeds[m.name] = m.seed;
        open(SQL, m.name);
        postMessage({ id: m.id, ok: true });
      } else if (m.type === "run") {
        var result = SQLCore.run(dbs[m.name], m.sql, m.cap);
        // Belt and braces: the guard blocks writes, but if anything slipped through, rebuild clean.
        if (dbs[m.name].getRowsModified() > 0) { dbs[m.name].close(); open(SQL, m.name); }
        postMessage({ id: m.id, result: result });
      }
    } catch (err) {
      postMessage({ id: m.id, result: { error: String(err && err.message || err) } });
    }
  }, function (err) {
    postMessage({ id: m.id, result: { error: "The SQL engine failed to load: " + err } });
  });
};
