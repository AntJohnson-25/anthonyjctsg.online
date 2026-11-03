// The schema browser (tables, columns, keys, sample values) and the results grid.
import { escapeHtml } from "./editor.js";
import { fmt } from "../world/adapt.js";

function cell(v) {
  if (v === null || v === undefined) return "<td class=\"null\">NULL</td>";
  return "<td" + (typeof v === "number" ? " class=\"num\"" : "") + ">" + escapeHtml(typeof v === "number" ? fmt(v).replace(/,/g, "") : v) + "</td>";
}

function table(columns, rows, extra) {
  let h = "<table><thead><tr>" + columns.map((c) => "<th>" + escapeHtml(c) + "</th>").join("") + "</tr></thead><tbody>";
  rows.forEach((r, i) => { h += "<tr" + (extra && extra.has(i) ? " class=\"x\"" : "") + ">" + r.map(cell).join("") + "</tr>"; });
  return h + "</tbody></table>";
}

// data: { tableName: { columns, rows, count } }. onPick(name) inserts a name into the editor.
export function renderSchema(el, ds, data, onPick) {
  let h = "<div class=\"schema-head\"><div class=\"db-name\">" + escapeHtml(ds.title) + " <span>database</span></div><p>" + escapeHtml(ds.blurb) + "</p></div>";
  ds.tables.forEach((t, i) => {
    const d = data[t.name];
    h += "<details class=\"tbl\"" + (i === 0 ? " open" : "") + "><summary><span class=\"tname pick\" data-pick=\"" + t.name + "\">" + t.name + "</span><span class=\"tcount\">" + d.count + " rows</span></summary>";
    h += "<ul class=\"cols\">" + t.columns.map((c) => {
      const keys = c[2] ? c[2].split(", ").map((k) => "<span class=\"key " + (k.startsWith("PK") ? "pk" : "fk") + "\">" + escapeHtml(k) + "</span>").join("") : "";
      return "<li><span class=\"cname pick\" data-pick=\"" + c[0] + "\">" + c[0] + "</span><span class=\"ctype\">" + escapeHtml(c[1]) + "</span>" + keys + "</li>";
    }).join("") + "</ul>";
    h += "<div class=\"sample\" data-full=\"0\">" + table(d.columns, d.rows.slice(0, 5)) + "</div>";
    if (d.count > 5) h += "<button class=\"more-btn\" data-table=\"" + t.name + "\">Show " + (d.count > d.rows.length ? "first " + d.rows.length : "all " + d.count) + " rows</button>";
    h += "</details>";
  });
  el.innerHTML = h;
  el.onclick = (e) => {
    const pick = e.target.closest("[data-pick]");
    if (pick) { e.preventDefault(); onPick(pick.dataset.pick); return; }
    const more = e.target.closest(".more-btn");
    if (more) {
      const d = data[more.dataset.table];
      const box = more.previousElementSibling;
      const full = box.dataset.full === "1";
      box.innerHTML = table(d.columns, full ? d.rows.slice(0, 5) : d.rows);
      box.dataset.full = full ? "0" : "1";
      more.textContent = full ? "Show " + (d.count > d.rows.length ? "first " + d.rows.length : "all " + d.count) + " rows" : "Show fewer";
    }
  };
}

export function renderGrid(el, countEl, res, g) {
  if (!res) { el.innerHTML = "<div class=\"empty\">No results yet. Run a query.</div>"; countEl.textContent = ""; return; }
  if (res.error) { el.innerHTML = "<div class=\"empty err\">" + escapeHtml(res.error) + "</div>"; countEl.textContent = "error"; return; }
  const shown = res.rows.slice(0, 300);
  countEl.textContent = res.rows.length + (res.truncated ? "+" : "") + " row" + (res.rows.length === 1 ? "" : "s");
  if (!res.columns.length) { el.innerHTML = "<div class=\"empty\">The query ran but returned no columns.</div>"; return; }
  let h = table(res.columns, shown, g && !g.correct ? g.extra : null);
  if (!res.rows.length) h += "<div class=\"empty\">0 rows.</div>";
  if (res.rows.length > shown.length) h += "<div class=\"empty\">+" + (res.rows.length - shown.length) + " more rows</div>";
  el.innerHTML = h;
}

export function codeBlock(sql, highlight) {
  return "<pre class=\"code\">" + highlight(sql) + "</pre>";
}
