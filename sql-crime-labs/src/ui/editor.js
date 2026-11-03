// SQL editor: a textarea with a syntax-highlighted <pre> underneath it, kept in sync.
// Ctrl/Cmd+Enter runs, Tab indents.

const KEYWORDS = new Set(("select from where and or not in is null like between order by group having limit offset as on " +
  "join inner left right full outer cross union all except intersect distinct case when then else end with recursive " +
  "over partition asc desc exists values cast rows range preceding following unbounded current row glob escape").split(" "));
const FUNCS = new Set(("count sum avg min max round coalesce ifnull strftime julianday date datetime time lag lead rank " +
  "row_number dense_rank ntile upper lower length substr substring trim ltrim rtrim abs total group_concat nullif iif " +
  "first_value last_value replace instr printf typeof percent_rank cume_dist").split(" "));

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
}

export function highlight(sql) {
  const re = /(--[^\n]*)|('(?:[^']|'')*'?)|("(?:[^"]|"")*"?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w]*)|([\s\S])/g;
  let out = "";
  let m;
  while ((m = re.exec(sql))) {
    if (m[1]) out += "<span class=\"t-com\">" + escapeHtml(m[1]) + "</span>";
    else if (m[2]) out += "<span class=\"t-str\">" + escapeHtml(m[2]) + "</span>";
    else if (m[3]) out += "<span class=\"t-id\">" + escapeHtml(m[3]) + "</span>";
    else if (m[4]) out += "<span class=\"t-num\">" + m[4] + "</span>";
    else if (m[5]) {
      const w = m[5].toLowerCase();
      if (KEYWORDS.has(w)) out += "<span class=\"t-kw\">" + escapeHtml(m[5]) + "</span>";
      else if (FUNCS.has(w) && /^\s*\(/.test(sql.slice(re.lastIndex))) out += "<span class=\"t-fn\">" + escapeHtml(m[5]) + "</span>";
      else out += escapeHtml(m[5]);
    } else out += /[(),;.*=<>+\-/|]/.test(m[6]) ? "<span class=\"t-op\">" + escapeHtml(m[6]) + "</span>" : escapeHtml(m[6]);
  }
  return out;
}

export class Editor {
  constructor(textarea, pre, onRun) {
    this.ta = textarea;
    this.pre = pre;
    const sync = () => { this.pre.innerHTML = highlight(this.ta.value) + "\n"; this.pre.scrollTop = this.ta.scrollTop; this.pre.scrollLeft = this.ta.scrollLeft; };
    this.sync = sync;
    textarea.addEventListener("input", sync);
    textarea.addEventListener("scroll", () => { this.pre.scrollTop = this.ta.scrollTop; this.pre.scrollLeft = this.ta.scrollLeft; });
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onRun(); return; }
      if (e.key === "Tab" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        this.insert("  ");
      }
    });
    sync();
  }

  get value() { return this.ta.value; }
  set value(v) { this.ta.value = v; this.sync(); }

  insert(text) {
    const ta = this.ta;
    const a = ta.selectionStart;
    const b = ta.selectionEnd;
    ta.value = ta.value.slice(0, a) + text + ta.value.slice(b);
    ta.selectionStart = ta.selectionEnd = a + text.length;
    this.sync();
    ta.focus();
  }
}
