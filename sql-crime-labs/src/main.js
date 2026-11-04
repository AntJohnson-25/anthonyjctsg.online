// SQL Quest: wires the SQL engine, the attempt flow, the panels and the 3D plaza together.
import { DATASETS } from "./data/datasets.js";
import { QUESTIONS, TIERS } from "./data/questions.js";
import { SqlEngine, explainError } from "./engine/db.js";
import { grade } from "./engine/grader.js";
import { QuestionRun, loadProgress, saveProgress, MAX_ATTEMPTS, XP_SHARE } from "./game/flow.js";
import { Plaza } from "./world/plaza.js";
import { HEROES } from "./world/office.js";
import { HEAT_CSS } from "./world/parts.js";
import { fmt } from "./world/adapt.js";
import { Editor, highlight, escapeHtml } from "./ui/editor.js";
import { renderSchema, renderGrid, codeBlock } from "./ui/tables.js";
import { HeroSelect } from "./ui/select.js";
import { sfx } from "./audio/sfx.js";

const $ = (id) => document.getElementById(id);
const tierOf = (id) => TIERS.find((t) => t.id === id);

const S = {
  progress: loadProgress(),
  q: null,
  run: null,
  dsId: null,
  data: {},          // per dataset: { pop, anchors, tables }
  expected: new Map(),
  player: null,      // last graded run on this question: { res, sql, g }
  drafts: {},
  view: "mine",
  busy: false,
  name: ""           // the player's typed name (setName)
};

let engine;
let plaza;
let editor;
let heroSel;
let cardTimer = 0;

// ------------------------------------------------------------------ boot

async function boot() {
  const msg = $("ld-msg");
  engine = new SqlEngine();
  for (const id of Object.keys(DATASETS)) {
    msg.textContent = "Building the " + DATASETS[id].title + " database...";
    await engine.open(id, DATASETS[id].seed);
    const ds = DATASETS[id];
    const tables = {};
    for (const t of ds.tables) {
      const count = (await engine.run(id, "SELECT COUNT(*) FROM " + t.name)).rows[0][0];
      const sample = await engine.run(id, "SELECT * FROM " + t.name + " LIMIT 60");
      tables[t.name] = { columns: sample.columns, rows: sample.rows, count };
    }
    S.data[id] = { pop: await engine.run(id, ds.population), anchors: await engine.run(id, ds.anchors), tables };
  }
  msg.textContent = "Opening the crime lab...";
  plaza = new Plaza($("scene"));
  msg.textContent = "Staffing the lab...";
  try { await plaza.crew.load(loadHero()); } catch (e) { console.error(e); msg.textContent = "The crew couldn't load: " + e.message; }
  renderHeroPicker();
  setupName();
  editor = new Editor($("sql"), $("hl"), runQuery);
  setupAdjust();
  $("lg-bar").style.background = HEAT_CSS;

  $("run").onclick = runQuery;
  $("clear").onclick = () => { editor.value = ""; $("sql").focus(); };
  $("prev").onclick = () => step(-1);
  $("next").onclick = () => step(1);
  $("brand").onclick = showTitle;
  $("hud-toggle").onclick = (e) => { const b = e.target.closest("button"); if (b) setView(b.dataset.v); };
  $("enter").onclick = enterLab;
  $("play").onclick = showSelect;
  $("sel-back").onclick = showTitle;
  $("sel-prev").onclick = () => heroSel.step(-1);
  $("sel-next").onclick = () => heroSel.step(1);
  heroSel = new HeroSelect($("sel-canvas"), HEROES, choose);
  addEventListener("keydown", (e) => {
    if ($("ts-select").hidden || $("title").hidden || e.target.tagName === "INPUT") return;
    if (e.key === "ArrowLeft") { heroSel.step(-1); e.preventDefault(); }
    else if (e.key === "ArrowRight") { heroSel.step(1); e.preventDefault(); }
  });
  $("stand-btn").onclick = standUp;
  $("holo-btn").onclick = () => goHolo();
  $("back-term").onclick = backToTerm;
  $("board-close").onclick = closeBoard;
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !$("title").hidden) return;
    if (!$("board").hidden) closeBoard();
    else if (S.mode === "holo") { if (!$("card").hidden) hideCard(); else backToTerm(); }
    else if (S.mode === "term") standUp();
  });
  plaza.onNear = showPrompt;
  plaza.onUse = useThing;
  setupTouch();
  setupMusic();
  setupSfx();

  syncOrder();
  $("new-run").onclick = (e) => armThen(e.currentTarget, "Wipe progress &amp; XP? Click again", () => { newRun(); renderTitleRun(); });
  renderTitleRun();
  renderTiers();
  const Q = new URLSearchParams(location.search);
  if (Q.has("name")) setName(Q.get("name"), false);          // test hook: ?name=Ant (not saved)
  if ((Q.has("walk") || Q.has("desk")) && !S.name) setName("Analyst", false);
  const fromHash = QUESTIONS.find((q) => "#" + q.id === location.hash);
  openQuestion(fromHash || QUESTIONS.find((q) => q.id === S.progress.last) || ordered()[0], true);
  if (fromHash || Q.has("desk")) { plaza.startSeated(); hideTitle(); setMode("term"); }
  else { plaza.startStanding(); setMode("walk"); if (Q.has("walk")) enterLab(); else { showTitle(); if (Q.has("select")) showSelect(); } }
  heroSel.load().then(() => { $("sel-loading").hidden = true; }).catch((e) => { console.error(e); $("sel-loading").textContent = "The line-up couldn't load: " + e.message; });
  addEventListener("hashchange", () => {
    const q = QUESTIONS.find((x) => "#" + x.id === location.hash);
    if (q && q !== S.q) { hideTitle(); openQuestion(q); }
  });
  $("loading").classList.add("gone");
  setTimeout(() => $("loading").remove(), 500);
  window.SQLQuest = { S, plaza, engine, editor, openQuestion, runQuery, setView, QUESTIONS, setMode, goDesk, standUp, openBoard, closeBoard, goHolo, backToTerm, requestIncoming, newRun, restartTier, ordered, tierQs };
}

// ------------------------------------------------------------------ modes: walking the lab vs sitting at the laptop

// Leaving the laptop: let go of the query box / name field. A hidden-but-focused textarea keeps the phone keyboard
// (and iOS's zoom) up and swallows WASD on desktop, so the analyst can't walk.
function releaseTyping() {
  const el = document.activeElement;
  if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) el.blur();
  if (scrollX || scrollY) scrollTo(0, 0);
}

function setMode(m) {
  S.mode = m;
  if (m !== "term") releaseTyping();
  for (const c of ["walk", "term", "holo"]) document.body.classList.toggle(c, m === c);
  clearTimeout(S.termTimer);
  document.body.classList.remove("term-on");
  if (m === "term") {
    // zoom into the laptop screen; the terminal fades in when the screen fills the view
    plaza.zoomScreen();
    S.termTimer = setTimeout(() => { document.body.classList.add("term-on"); $("sql").focus(); }, 1000);
  }
  sfx.scene(m);
  syncInput();
}
const sleep =(ms) => new Promise((r) => setTimeout(r, ms));

// ---- the phone: a semi-urgent query request from Marcus

function beepSfx() { sfx.unlock(); sfx.phone(); try { if (navigator.vibrate) navigator.vibrate([120, 80, 120]); } catch (e) { /* ignore */ } }
function plainText(html) { const d = document.createElement("div"); d.innerHTML = html; return d.textContent.replace(/\s+/g, " ").trim(); }
function requestIncoming(q) {
  if (q !== S.q) openQuestion(q, true);
  S.pending = true;
  const txt = plainText(q.prompt);
  $("ph-msg").innerHTML = "<b>" + escapeHtml(q.title) + "</b>" + escapeHtml(playerName() + ", " + (txt.charAt(0).toLowerCase() + txt.slice(1, 150)) + (txt.length > 150 ? "…" : ""));
  const ph = $("phone");
  ph.hidden = false;
  ph.classList.remove("ring"); void ph.offsetWidth; ph.classList.add("ring");
  beepSfx();
}
function clearRequest() { S.pending = false; $("phone").hidden = true; }
function scheduleRequest(ms) {
  clearTimeout(S.reqTimer);
  S.reqTimer = setTimeout(() => {
    const free = S.mode === "walk" && $("title").hidden && $("board").hidden && !S.moving && !S.pending;
    if (!free) { if (S.mode === "walk" && !S.pending) scheduleRequest(3000); return; }
    requestIncoming(S.run && !S.run.finished ? S.q : nextOpenQuestion());
  }, ms);
}
function syncInput() { if (plaza) plaza.setWalking((S.mode === "walk" || S.mode === "holo") && $("title").hidden && $("board").hidden); }

function enterLab() {
  if (!S.name) { $("player-name").focus(); $("name-hint").hidden = false; return; }
  hideTitle();
  sfx.unlock(); sfx.scene(S.mode || "walk");
  if (S.mode === "walk") scheduleRequest(3500);
}

function showPrompt(it) {
  const el = $("wh-prompt");
  el.hidden = !it;
  if (it) el.innerHTML = "<kbd>E</kbd> " + escapeHtml(it.label);
  $("use-btn").classList.toggle("on", !!it);
}

function useThing(it) {
  if (it.id === "desk") goDesk();
  else if (it.id === "marcus") openBoard();
  else plaza.crew.talk(it.id);
}

async function goDesk() {
  if (S.moving || S.mode !== "walk") return;
  S.moving = true;
  plaza.setWalking(false);
  showPrompt(null);
  clearTimeout(S.reqTimer);
  clearRequest();
  sfx.chair();
  await plaza.sitAtDesk();
  setMode("term");
  S.moving = false;
}

async function standUp() {
  if (S.moving || S.busy || S.mode !== "term") return;
  S.moving = true;
  clearTimeout(cardTimer);
  hideCard();
  setMode("walk");
  sfx.chair();
  try {
    // never leave the analyst frozen: if the stand-up animation's timer stalls, carry on after 4 s anyway
    let done = false;
    await Promise.race([plaza.standFromDesk().then(() => { done = true; }), sleep(4000).then(() => { if (!done) { done = true; plaza.forceStand(); } })]);
    done = true;   // a late-firing timer must not snap the analyst back to the desk
  } catch (e) { console.error(e); plaza.forceStand(); }
  S.moving = false;
  syncInput();
  // the boss does not forget: an unsolved request nags again, a finished one is followed by the next
  scheduleRequest(S.run && S.run.finished ? 6000 : 25000);
}

// ---- term (zoomed into the laptop) <-> holo (zoomed out to the hologram)

async function goHolo(which) {
  if (S.mode === "holo") { if (which === "answer") setView("answer"); return; }
  if (S.mode !== "term" || S.moving) return;
  S.moving = true;
  clearTimeout(S.termTimer);
  document.body.classList.remove("term-on");
  releaseTyping();   // you walk in the hologram room: the query box must let go of the keys (and the phone keyboard)
  S.mode = "holo";
  document.body.classList.remove("term");
  document.body.classList.add("holo");
  plaza.crew.setHeroVisible(true);
  plaza.crew.pullBack();               // pull out of the laptop screen, back through the room
  sfx.holo(true); sfx.scene("holo");
  await sleep(700);
  $("fade").classList.add("on");
  await sleep(280);
  plaza.setHolo(true);
  syncInput();   // walking was switched off at the desk; turn it back on for the hologram room
  if (which === "answer") { S.view = "answer"; drawAnswer(); } else drawMine();
  $("hud-toggle").hidden = !(S.player || S.run.finished);
  syncToggle();
  $("fade").classList.remove("on");
  S.moving = false;
}
async function backToTerm() {
  if (S.mode !== "holo" || S.moving) return;
  S.moving = true;
  hideCard();
  clearTimeout(cardTimer);
  sfx.holo(false);
  $("fade").classList.add("on");
  await sleep(280);
  plaza.setHolo(false);
  $("fade").classList.remove("on");
  S.moving = false;
  setMode("term");
}

function openBoard() {
  renderTiers();
  renderBoardNow();
  $("board").hidden = false;
  showPrompt(null);
  syncInput();
}
function closeBoard() { $("board").hidden = true; syncInput(); }
function renderBoardNow() {
  const q = S.q;
  $("board-now").innerHTML = q
    ? "<div class=\"tag\">Open request &middot; text from Marcus</div><b>" + escapeHtml(q.title) + "</b><p>" + q.prompt + "</p><div class=\"muted\">Take it to your laptop, " + escapeHtml(playerName()) + ", or pick another case below.</div>"
    : "";
}

function setupTouch() {
  const stick = $("stick"), knob = $("stick-knob");
  const R = 46;
  let id = null, cx = 0, cy = 0;
  const move = (e) => {
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.transform = "translate(" + dx + "px," + dy + "px)";
    plaza.walker.stick.x = dx / R;
    plaza.walker.stick.y = dy / R;
  };
  stick.addEventListener("pointerdown", (e) => {
    id = e.pointerId;
    stick.setPointerCapture(id);
    const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    move(e);
  });
  stick.addEventListener("pointermove", (e) => { if (e.pointerId === id) move(e); });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    plaza.walker.stick.x = plaza.walker.stick.y = 0;
    knob.style.transform = "";
  };
  stick.addEventListener("pointerup", end);
  stick.addEventListener("pointercancel", end);
  $("use-btn").onclick = () => plaza.walker.use();
}

// ------------------------------------------------------------------ navigation

// Levels stay Rookie -> Semi-Pro -> Pro, but the questions inside each one come in a shuffled order. The shuffle
// is saved with the progress (so a run doesn't reorder itself on reload) and redrawn on a restart / new run.
const byId = new Map(QUESTIONS.map((q) => [q.id, q]));
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function syncOrder() {
  const o = S.progress.order || (S.progress.order = {});
  for (const t of TIERS) {
    const ids = QUESTIONS.filter((q) => q.tier === t.id).map((q) => q.id);
    const cur = (o[t.id] || []).filter((id) => ids.includes(id));
    // keep a saved shuffle (any questions added since are shuffled onto the end); otherwise draw a fresh one
    o[t.id] = cur.length ? cur.concat(shuffle(ids.filter((id) => !cur.includes(id)))) : shuffle(ids);
  }
  saveProgress(S.progress);
}
const tierQs = (tid) => S.progress.order[tid].map((id) => byId.get(id));
const ordered = () => TIERS.flatMap((t) => tierQs(t.id));
const tierXpEarned = (tid) => tierQs(tid).reduce((s, q) => { const d = S.progress.done[q.id]; return s + (typeof d === "number" ? Math.round(tierOf(tid).xp * XP_SHARE[d - 1]) : 0); }, 0);

// Replay one level from scratch: its questions open again (full XP again, so the XP they gave is taken back first)
// in a new shuffled order.
function restartTier(tid) {
  const p = S.progress;
  p.xp = Math.max(0, p.xp - tierXpEarned(tid));
  for (const q of tierQs(tid)) { delete p.done[q.id]; delete S.drafts[q.id]; }
  p.order[tid] = shuffle(p.order[tid].slice());
  saveProgress(p);
  editor.value = "";
  openQuestion(tierQs(tid)[0], true);
}
// A whole new run: no XP, nothing done, every level reshuffled, back to Rookie.
function newRun() {
  S.progress = { xp: 0, done: {}, last: null, order: {} };
  S.drafts = {};
  clearRequest();
  syncOrder();
  editor.value = "";
  openQuestion(ordered()[0], true);
}
// Two-step button for anything that wipes progress (no browser confirm() dialogs).
function armThen(btn, label, fn) {
  if (btn.dataset.armed) { fn(); return; }
  const old = btn.innerHTML;
  btn.dataset.armed = "1"; btn.innerHTML = label; btn.classList.add("armed");
  setTimeout(() => { delete btn.dataset.armed; btn.innerHTML = old; btn.classList.remove("armed"); }, 3500);
}
function renderTitleRun() {
  const any = S.progress.xp > 0 || Object.keys(S.progress.done).length > 0;
  $("new-run").hidden = !any;
  $("new-run").innerHTML = "&#8634; Start a new run (back to Rookie)";
}

function nextOpenQuestion() {
  const all = ordered();
  return all.find((q) => !S.progress.done[q.id]) || S.q || all[0];
}

function step(d) {
  const all = ordered();
  const n = all[all.indexOf(S.q) + d];
  if (n) openQuestion(n);
  else if (d > 0) showTitle();
}

function renderTiers() {
  const nav = $("tiers");
  nav.innerHTML = TIERS.map((t) => {
    const qs = tierQs(t.id);
    const done = qs.filter((q) => S.progress.done[q.id]).length;
    return "<button data-t=\"" + t.id + "\" class=\"" + (S.q && S.q.tier === t.id ? "on" : "") + "\">" + t.name + " <small>" + done + "/" + qs.length + "</small></button>";
  }).join("");
  nav.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const qs = tierQs(b.dataset.t);
    openQuestion(qs.find((q) => !S.progress.done[q.id]) || qs[0]);
  };
  $("xp-n").textContent = S.progress.xp.toLocaleString("en-US");

  $("tier-cards").innerHTML = TIERS.map((t) => {
    const qs = tierQs(t.id);
    const done = qs.filter((q) => S.progress.done[q.id]).length;
    return "<div class=\"tier-wrap\"><button class=\"tier-card\" data-t=\"" + t.id + "\"><span class=\"chip " + t.id + "\">" + t.name + "</span><p>" + t.tagline + "</p>" +
      "<div class=\"bar\"><i style=\"width:" + Math.round(100 * done / qs.length) + "%\"></i></div><div class=\"count\">" + done + " of " + qs.length + " done &middot; up to " + t.xp + " XP each</div></button>" +
      (done ? "<button class=\"ghost-btn tier-reset\" data-r=\"" + t.id + "\" title=\"Replay " + t.name + " from the start, in a new order\">&#8634; Restart " + t.name + "</button>" : "") + "</div>";
  }).join("");
  $("tier-cards").onclick = (e) => {
    const r = e.target.closest(".tier-reset");
    if (r) {
      const t = tierOf(r.dataset.r);
      const xp = tierXpEarned(t.id);
      armThen(r, xp ? "Give back " + xp + " XP &amp; restart? Click again" : "Restart " + t.name + "? Click again", () => {
        restartTier(t.id); closeBoard(); requestIncoming(S.q);
      });
      return;
    }
    const b = e.target.closest(".tier-card");
    if (!b) return;
    closeBoard();
    const qs = tierQs(b.dataset.t);
    requestIncoming(qs.find((q) => !S.progress.done[q.id]) || qs[0]);
  };
  $("board-newrun").onclick = (e) => armThen(e.currentTarget, "Wipe progress &amp; XP? Click again", () => { newRun(); closeBoard(); renderTitleRun(); requestIncoming(S.q); });
}

// ------------------------------------------------------------------ who you play (Wealth Runner's four)

function loadHero() {
  try { const h = localStorage.getItem("sqlquest.hero"); if (HEROES.some((x) => x.id === h)) return h; } catch (e) { /* ignore */ }
  return HEROES[0].id;
}
// The player's own name, typed on the title screen after picking a body; used by Marcus, the crew and the HUD.
const NAME_MAX = 18;
function cleanName(v) { return String(v || "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX); }
function loadName() { try { return cleanName(localStorage.getItem("sqlquest.name")); } catch (e) { return ""; } }
function playerName() { return S.name || "Analyst"; }
function setName(v, keep = true) {
  S.name = cleanName(v);
  if (keep) try { localStorage.setItem("sqlquest.name", S.name); } catch (e) { /* ignore */ }
  if (plaza) plaza.crew.playerName = S.name;
  const slug = S.name.toLowerCase().replace(/[^a-z0-9]+/g, "") || "analyst";
  $("question").dataset.who = slug;
  $("hud-name").textContent = S.name ? S.name + " · Lead Data Analyst" : "";
  // the query window is the player's own terminal: their prompt in the title bar, their name in the empty box
  $("ed-who").textContent = slug + "@crimelab:~$ sqlite3 evidence.db";
  $("ed-who").title = $("ed-who").textContent;
  $("sql").placeholder = (S.name ? S.name + ", type" : "type") + " your query...   (Ctrl+Enter to run)";
  $("enter").disabled = !S.name;
  $("name-hint").hidden = !!S.name;
}
function setupName() {
  const inp = $("player-name");
  inp.maxLength = NAME_MAX;
  inp.value = loadName();
  setName(inp.value);
  inp.oninput = () => setName(inp.value);
  inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter" && S.name) enterLab(); };
}

// ------------------------------------------------------------------ query window adjustments (tabs + drag grips)
// Saved per browser: sidebar width (px; height fraction on narrow screens), sidebar hidden, query box height
// (fraction of the right-hand column), text size. Unset values fall back to the CSS defaults.
const ADJ_KEY = "sqlquest.layout";
const ED_PRESETS = { "h-short": 0.3, "h-split": 0.5, "h-tall": 0.72 };
const FS_MIN = 11, FS_MAX = 22;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const narrow = () => matchMedia("(max-width: 960px)").matches;
function setupAdjust() {
  let A = {};
  try { A = JSON.parse(localStorage.getItem(ADJ_KEY)) || {}; } catch (e) { A = {}; }
  const save = () => { try { localStorage.setItem(ADJ_KEY, JSON.stringify(A)); } catch (e) { /* ignore */ } };
  const st = document.body.style;
  const apply = () => {
    const W = innerWidth;
    if (A.side) st.setProperty("--side-w", clamp(A.side, 220, Math.max(240, W - 380)) + "px"); else st.removeProperty("--side-w");
    if (A.sideH) st.setProperty("--side-h", (clamp(A.sideH, 0.12, 0.7) * 100).toFixed(1) + "%"); else st.removeProperty("--side-h");
    // never so short that Run / Clear get cut off, never so tall the results vanish
    if (A.edH) st.setProperty("--ed-h", "clamp(var(--ed-min), " + (clamp(A.edH, 0.16, 0.84) * 100).toFixed(1) + "%, calc(100% - 130px))"); else st.removeProperty("--ed-h");
    const fs = clamp(A.fs || 14, FS_MIN, FS_MAX);
    st.setProperty("--ed-fs", fs + "px");
    $("ed-fs").textContent = matchMedia("(pointer: coarse)").matches ? Math.max(16, fs) : fs;   // touch never shows under 16 (CSS)
    document.body.classList.toggle("side-off", !!A.off);
    for (const b of $("ed-tabs").querySelectorAll("button")) {
      const k = b.dataset.adj;
      b.classList.toggle("on", k === "side" ? !A.off : k in ED_PRESETS && A.edH != null && Math.abs(A.edH - ED_PRESETS[k]) < 0.01);
    }
  };
  $("ed-tabs").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const k = b.dataset.adj;
    if (k === "side") A.off = !A.off;
    else if (k === "font-") A.fs = clamp((A.fs || 14) - 1, FS_MIN, FS_MAX);
    else if (k === "font+") A.fs = clamp((A.fs || 14) + 1, FS_MIN, FS_MAX);
    else if (k in ED_PRESETS) A.edH = ED_PRESETS[k];
    else if (k === "reset") A = {};
    apply(); save();
    sfx.ui();
    $("sql").focus();
  };
  // drag a grip: pointer capture, live update, save on release
  const drag = (grip, cls, move) => {
    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (grip.id === "side-grip" && A.off) { A.off = false; reopened = performance.now(); apply(); save(); return; }   // a hidden sidebar's tab: click to bring it back
      e.preventDefault();
      const c = typeof cls === "function" ? cls() : cls;
      grip.setPointerCapture(e.pointerId);
      grip.classList.add("drag");
      document.body.classList.add("dragging", c);
      const mv = (ev) => { move(ev); apply(); };
      const up = () => {
        grip.removeEventListener("pointermove", mv);
        grip.classList.remove("drag");
        document.body.classList.remove("dragging", c);
        save();
      };
      grip.addEventListener("pointermove", mv);
      grip.addEventListener("pointerup", up, { once: true });
      grip.addEventListener("pointercancel", up, { once: true });
    });
  };
  let reopened = 0;
  drag($("side-grip"), () => (narrow() ? "drag-row" : "drag-col"), (ev) => {
    const r = $("layout").getBoundingClientRect();
    if (narrow()) A.sideH = (ev.clientY - r.top) / r.height;
    else A.side = ev.clientX - r.left;
  });
  $("side-grip").addEventListener("dblclick", () => { if (performance.now() - reopened < 600) return; A.off = !A.off; apply(); save(); });
  drag($("ed-grip"), "drag-row", (ev) => {
    const r = $("dock").getBoundingClientRect();
    A.edH = (ev.clientY - r.top) / r.height;
  });
  addEventListener("resize", apply);
  apply();
}

function renderHeroPicker() {
  const cur = plaza.crew.heroDef ? plaza.crew.heroDef.id : loadHero();
  $("hero-picker").innerHTML = HEROES.map((h) => "<button data-h=\"" + h.id + "\" class=\"" + (h.id === cur ? "on" : "") + "\"><b>" + h.label + "</b><small>" + h.tag + "</small></button>").join("");
  const def = HEROES.find((h) => h.id === cur) || HEROES[0];
  $("sel-name").textContent = def.label;
  $("sel-tag").textContent = def.tag;
  $("hero-picker").onclick = (e) => {
    const b = e.target.closest("button");
    if (b) { heroSel.pickId(b.dataset.h); choose(b.dataset.h); }
  };
}
// A body was picked (chip, click on the figure, arrows): remember it and put it in the lab.
async function choose(id) {
  try { localStorage.setItem("sqlquest.hero", id); } catch (err) { /* ignore */ }
  sfx.unlock(); sfx.pick();
  const def = HEROES.find((h) => h.id === id) || HEROES[0];
  $("sel-name").textContent = def.label;
  $("sel-tag").textContent = def.tag;
  document.querySelectorAll("#hero-picker button").forEach((b) => b.classList.toggle("on", b.dataset.h === id));
  await plaza.crew.setHero(id);
}

function showTitle() {
  renderTiers();
  renderTitleRun();
  $("title").hidden = false;
  $("title").classList.remove("sel");
  $("ts-art").hidden = false;
  $("ts-select").hidden = true;
  heroSel.hide();
  syncInput();
}
function showSelect() {
  $("title").classList.add("sel");
  $("ts-art").hidden = true;
  $("ts-select").hidden = false;
  renderHeroPicker();
  heroSel.show(plaza.crew.heroDef ? plaza.crew.heroDef.id : loadHero());
  if (!S.name) $("player-name").focus();
}
function hideTitle() { $("title").hidden = true; heroSel.hide(); syncInput(); }

// ------------------------------------------------------------------ question

function openQuestion(q, quiet) {
  if (S.q) S.drafts[S.q.id] = editor.value;
  S.q = q;
  S.run = new QuestionRun(q, tierOf(q.tier).xp, S.progress.done[q.id]);
  S.player = null;
  S.view = "mine";
  clearTimeout(cardTimer);
  hideCard();

  if (S.dsId !== q.dataset) {
    S.dsId = q.dataset;
    const d = S.data[q.dataset];
    plaza.setDataset(DATASETS[q.dataset], d.pop, d.anchors);
    renderSchema($("schema"), DATASETS[q.dataset], d.tables, (name) => editor.insert(name));
  } else {
    plaza.home();
  }

  const tier = tierOf(q.tier);
  const inTier = tierQs(q.tier);
  $("q-tier").textContent = tier.name;
  $("q-tier").className = "chip " + q.tier;
  $("q-num").textContent = "Question " + (inTier.indexOf(q) + 1) + " of " + inTier.length;
  $("q-dots").innerHTML = inTier.map((x) => {
    const d = S.progress.done[x.id];
    return "<button title=\"" + escapeHtml(x.title) + "\" data-q=\"" + x.id + "\" class=\"" + (d === "revealed" ? "revealed" : d ? "solved" : "") + (x === q ? " cur" : "") + "\"></button>";
  }).join("");
  $("q-dots").onclick = (e) => { const b = e.target.closest("button"); if (b) openQuestion(QUESTIONS.find((x) => x.id === b.dataset.q)); };
  $("q-title").textContent = q.title;
  $("q-prompt").innerHTML = q.prompt;
  $("prev").disabled = ordered().indexOf(q) === 0;
  editor.value = S.drafts[q.id] || "";
  renderGrid($("grid"), $("res-count"), null);
  $("hud-toggle").hidden = true;
  setStatus("Waiting for a query", "");
  setCaption("Every figure is a row from <b>" + escapeHtml(DATASETS[q.dataset].tables[0].name) + "</b>, standing at its " + DATASETS[q.dataset].anchorNoun + " desk. Run a query and the rows it returns step onto the evidence table.");
  $("holo-btn").hidden = true;
  $("hud-legend").hidden = true;
  renderAttempts();
  renderClue();

  if (S.run.finished) {
    const how = S.progress.done[q.id] === "revealed" ? "You saw the answer to this one." : "You solved this one.";
    feedback("info", how + " Practice it again, or <button class=\"ghost-btn\" id=\"fb-answer\">show the answer</button>");
    $("fb-answer").onclick = () => { setView("answer"); showCard("review"); };
  } else {
    feedback("info", "");
  }
  S.progress.last = q.id;
  saveProgress(S.progress);
  renderTiers();
  history.replaceState(null, "", "#" + q.id);
  if (S.mode === "holo") backToTerm();
}

function renderAttempts() {
  const r = S.run;
  const solved = S.progress.done[S.q.id];
  let h = "";
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    let cls = "";
    if (r.state === "solved" && i === r.attempt) cls = "ok";
    else if (i < r.attempt || (r.state === "revealed" && i <= r.attempt)) cls = "used";
    else if (i === r.attempt && r.state === "editing") cls = "cur";
    h += "<i class=\"" + cls + "\"></i>";
  }
  $("attempts").innerHTML = h;
  let t;
  if (r.state === "solved") t = solved && typeof solved === "number" ? "Solved on try " + solved : "Solved";
  else if (r.state === "revealed") t = "Answer revealed";
  else t = "Try " + r.attempt + " of " + MAX_ATTEMPTS + (r.attempt === MAX_ATTEMPTS ? " (last one)" : "");
  $("attempt-text").textContent = t;
}

function renderClue() {
  const show = S.run.clue || S.run.state === "revealed";
  $("clue").hidden = !show;
  if (show) $("clue").innerHTML = "<b>Clue</b>" + escapeHtml(S.q.hint);
}

// ------------------------------------------------------------------ running

async function expectedFor(q) {
  if (!S.expected.has(q.id)) S.expected.set(q.id, await engine.run(q.dataset, q.solution));
  return S.expected.get(q.id);
}

async function runQuery() {
  if (S.busy) return;
  const q = S.q;
  const sql = editor.value.trim();
  if (!sql) { feedback("info", "Type a query first. Click a table or column name on the left to insert it."); return; }
  S.busy = true;
  $("run").disabled = true;
  clearTimeout(cardTimer);
  hideCard();
  sfx.run();
  setStatus("Executing...", "");
  feedback("info", "&gt; executing...");
  const beat = sleep(500);
  try {
    const res = await engine.run(q.dataset, sql);
    await beat;
    if (q !== S.q) return;
    if (res.error) {
      const nice = explainError(res.error, DATASETS[q.dataset]);
      renderGrid($("grid"), $("res-count"), { error: nice });
      feedback("err", escapeHtml(nice) + (S.run.finished ? "" : "<div class=\"muted\" style=\"font-family:var(--ui);margin-top:4px\">Errors don't use up a try. Fix it and run again.</div>"));
      plaza.showError();
      sfx.err();
      setStatus("SQL error", "err");
      setCaption("The database couldn't run that. Nothing to show yet.");
      $("hud-legend").hidden = true;
      return;
    }
    const exp = await expectedFor(q);
    const g = grade(res, exp, { ordered: q.ordered });
    S.player = { res, sql, g };
    if (g.correct) sfx.ok(); else sfx.bad();
    renderGrid($("grid"), $("res-count"), res, g);
    const out = S.run.record(g.correct);
    S.view = "mine";
    $("holo-btn").hidden = false;
    drawMine();
    renderAttempts();
    renderClue();

    if (out.practice) {
      feedback(g.correct ? "ok" : "bad", g.correct ? "Correct. (Practice run, no XP.)" : escapeHtml(g.message));
      $("hud-toggle").hidden = false;
      syncToggle();
      if (g.correct) cardTimer = setTimeout(() => goHolo(), 1100);
    } else if (out.solved) {
      S.progress.xp += out.xp;
      S.progress.done[q.id] = out.attempt;
      saveProgress(S.progress);
      renderTiers();
      openDotsRefresh();
      feedback("ok", "Correct, " + escapeHtml(playerName()) + "! +" + out.xp + " XP. Pulling up the hologram...");
      $("hud-toggle").hidden = false;
      syncToggle();
      cardTimer = setTimeout(async () => { await goHolo(); plaza.celebrate(); cardTimer = setTimeout(() => showCard("solved", out), 1300); }, 1300);
    } else if (out.revealed) {
      S.progress.done[q.id] = "revealed";
      saveProgress(S.progress);
      renderTiers();
      openDotsRefresh();
      feedback("bad", escapeHtml(g.message) + " That was your last try. Here's the answer.");
      $("hud-toggle").hidden = false;
      cardTimer = setTimeout(async () => { await goHolo("answer"); showCard("reveal"); }, 2200);
    } else if (out.clue) {
      feedback("bad", escapeHtml(g.message) + " One try left, and Marcus is texting you a clue.");
      beepSfx();
    } else {
      feedback("bad", escapeHtml(g.message) + " " + (MAX_ATTEMPTS - S.run.attempt + 1) + " tries left.");
    }
  } finally {
    S.busy = false;
    $("run").disabled = false;
  }
}

function openDotsRefresh() {
  const d = $("q-dots").querySelector("[data-q=\"" + S.q.id + "\"]");
  if (d) d.className = (S.progress.done[S.q.id] === "revealed" ? "revealed" : "solved") + " cur";
}

// ------------------------------------------------------------------ 3D view + HUD

function drawMine() {
  const p = S.player;
  const info = plaza.show({ result: p.res, sql: p.sql, grade: p.g, expected: S.expected.get(S.q.id), vis: S.q.vis });
  if (p.g.correct) setStatus("✓ Correct", "ok");
  else setStatus("✗ Not quite", "bad");
  describe(info, p.g);
}

function drawAnswer() {
  const exp = S.expected.get(S.q.id);
  if (!exp) return;
  const info = plaza.show({ result: exp, sql: S.q.solution, vis: S.q.vis });
  setStatus("Correct result", "answer");
  describe(info, null);
}

async function setView(v) {
  await expectedFor(S.q);
  S.view = v === "mine" && S.player ? "mine" : "answer";
  $("hud-toggle").hidden = false;
  syncToggle();
  if (S.view === "mine") drawMine();
  else drawAnswer();
}

function syncToggle() {
  const t = $("hud-toggle");
  t.querySelector("[data-v=mine]").hidden = !S.player;
  t.querySelector("[data-v=answer]").hidden = !S.run.finished;
  t.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === S.view));
}

function describe(info, g) {
  const noun = DATASETS[S.q.dataset].anchorNoun;
  let s;
  const n = info.rows;
  if (info.mode === "entities") s = "<b>" + n + "</b> row" + (n === 1 ? "" : "s") + ": the matching people stepped onto the stage" + (info.joined ? ", with beams to their " + noun + "." : ".") + (info.colorBy ? " Colour = " + info.colorBy + "." : "");
  else if (info.mode === "aggregate") s = "<b>" + n + "</b> group" + (n === 1 ? "" : "s") + ". Each pillar is one result row; its height and colour are the value.";
  else s = "<b>" + n + "</b> row" + (n === 1 ? "" : "s") + " dropped onto the stage" + (info.more ? " (showing the first " + (n - info.more) + ")" : "") + ".";
  if (g && !g.correct) {
    if (g.colMismatch) s += " <em>" + escapeHtml(g.message) + "</em>";
    else if (g.orderWrong) s += " <em>Right rows, wrong order.</em>";
    else s += (g.extra.size ? " <em>Amber rings: rows that shouldn't be there.</em>" : "") + (g.missing.length ? " <strong>Red flickering ghosts: rows you're missing.</strong>" : "");
  }
  setCaption(s);
  const lg = $("hud-legend");
  if (info.legend) {
    lg.hidden = false;
    $("lg-col").textContent = "colour = " + info.legend.col;
    $("lg-min").textContent = fmt(info.legend.min);
    $("lg-max").textContent = fmt(info.legend.max);
  } else lg.hidden = true;
}

function setStatus(text, cls) { const el = $("hud-status"); el.textContent = text; el.className = "status " + (cls || ""); }
function setCaption(html) { $("hud-caption").innerHTML = html; }
function feedback(kind, html) { $("feedback").innerHTML = html ? "<div class=\"msg " + kind + "\">" + html + "</div>" : ""; }

// ------------------------------------------------------------------ cards

function showCard(kind, out) {
  const q = S.q;
  const card = $("card");
  const sol = codeBlock(q.solution, highlight);
  const dialects = "<p class=\"dialects\"><b>Other databases:</b> " + escapeHtml(q.dialects) + "</p>";
  let h = "<button class=\"x-close\" data-a=\"close\" title=\"Close\">&times;</button>";
  if (kind === "solved") {
    card.className = "card ok";
    h += "<div class=\"tag\">Correct</div><h2>" + escapeHtml(q.title) + " ✓</h2>";
    h += "<p class=\"xp-gain\">+" + out.xp + " XP" + (out.attempt > 1 ? " (try " + out.attempt + ")" : " (first try!)") + "</p>";
    h += "<p>" + escapeHtml(q.explanation) + "</p><p class=\"muted\" style=\"margin-bottom:0\">One way to write it:</p>" + sol + dialects;
    h += "<div class=\"btns\"><button class=\"run-btn\" data-a=\"next\">Next question &#8250;</button><button class=\"ghost-btn\" data-a=\"close\">Stay here</button></div>";
  } else if (kind === "clue") {
    card.className = "card clue-card";
    h += "<div class=\"tag\">Text from Marcus &middot; last try</div><h2>Here's a push, " + escapeHtml(playerName()) + "</h2><p>" + escapeHtml(q.hint) + "</p>";
    h += "<p class=\"muted\">Compare the amber and red rows in the 3D view with the question, then fix your query.</p>";
    h += "<div class=\"btns\"><button class=\"run-btn\" data-a=\"edit\">Fix my query</button></div>";
  } else {
    card.className = "card reveal";
    h += "<div class=\"tag\">" + (kind === "reveal" ? "The answer" : "Review") + "</div><h2>" + escapeHtml(q.title) + "</h2>";
    h += "<p>" + escapeHtml(q.explanation) + "</p>" + sol + dialects;
    h += "<p class=\"muted\">The 3D view now shows the correct result." + (S.player ? " Use the toggle at the top to flip back to yours." : "") + "</p>";
    h += "<div class=\"btns\"><button class=\"run-btn\" data-a=\"next\">Next question &#8250;</button><button class=\"ghost-btn\" data-a=\"load\">Load into editor</button></div>";
  }
  card.innerHTML = h;
  card.hidden = false;
  if (innerWidth > 960) plaza.setShift(card.offsetWidth / 2 + 8);
  card.onclick = (e) => {
    const a = e.target.closest("[data-a]");
    if (!a) return;
    if (a.dataset.a === "next") step(1);
    else if (a.dataset.a === "close") hideCard();
    else if (a.dataset.a === "edit") { hideCard(); $("sql").focus(); }
    else if (a.dataset.a === "load") { editor.value = q.solution; hideCard(); $("sql").focus(); }
  };
}

function hideCard() { $("card").hidden = true; if (plaza) plaza.setShift(0); }

// ------------------------------------------------------------------ music (user-supplied tracks only)

// sound effects (synthesized in src/audio/sfx.js): unlock on the first gesture, tick on keys, click on buttons, mute button
function setupSfx() {
  const first = () => { sfx.unlock(); sfx.scene(S.mode || "walk"); };
  addEventListener("pointerdown", first, { once: true });
  addEventListener("keydown", first, { once: true });
  $("sql").addEventListener("keydown", (e) => { if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length <= 9 && !e.repeat) sfx.key(e.key); });
  document.addEventListener("click", (e) => { if (e.target.closest("button") && !e.target.closest("#run, #hero-picker, #sfx-btn")) sfx.ui(); });
  // the only effect left is Marcus's beep, so this button is the beep's on/off
  const btn = $("sfx-btn");
  btn.title = "Marcus's phone beep on/off";
  const paint = () => { btn.classList.toggle("on", !sfx.muted); btn.textContent = sfx.muted ? "Beep off" : "Beep on"; };
  btn.onclick = () => { sfx.unlock(); sfx.setMuted(!sfx.muted); paint(); if (!sfx.muted) sfx.phone(); };
  paint();
}

async function setupMusic() {
  let tracks;
  try {
    const r = await fetch("assets/music/tracks.json", { cache: "no-cache" });
    if (!r.ok) return;
    tracks = await r.json();
  } catch (e) { return; }
  if (!Array.isArray(tracks) || !tracks.length) return;
  const btn = $("music-btn");
  btn.hidden = false;
  // One <audio> (iPhone Safari ignores .volume and dislikes several). One track = it loops; several = they play in turn.
  const audio = new Audio();
  let i = 0;
  audio.volume = 0.5;
  audio.preload = "auto";
  audio.loop = tracks.length === 1;
  audio.addEventListener("ended", () => { i = (i + 1) % tracks.length; audio.src = "assets/music/" + tracks[i]; audio.play().catch(() => {}); });
  // ON by default (user, 2026-11-03: the song is the game's sound); the ♫ button turns it off and that sticks
  let on = true;
  try { on = localStorage.getItem("sqlquest.music") !== "0"; } catch (e) { /* ignore */ }
  const set = (v, keep = true) => {
    on = v;
    btn.classList.toggle("on", on);
    btn.title = on ? "Music on (click to turn off)" : "Music off (click to turn on)";
    if (keep) try { localStorage.setItem("sqlquest.music", on ? "1" : "0"); } catch (e) { /* ignore */ }
    if (on) { if (!audio.src) audio.src = "assets/music/" + tracks[i]; audio.play().catch(() => {}); } else audio.pause();
  };
  btn.onclick = () => set(!on);
  btn.classList.toggle("on", on);
  // browsers only allow sound after a tap or key: start on the first one (the Play button counts)
  if (on) {
    const start = (e) => { if (e && e.target && e.target.closest && e.target.closest("#music-btn")) return; if (on && audio.paused) set(true, false); };
    addEventListener("pointerdown", start, { once: true });
    addEventListener("keydown", start, { once: true });
  }
}

boot();
