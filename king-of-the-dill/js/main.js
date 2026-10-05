// Boot, menus, the loop, the third-person camera, HUD and effects.
// The match itself is js/game.js (pure); this file only feeds it input and
// draws what it says.
//
// URL options (for testing): ?play=1 skips the menu, ?auto=1 lets the
// computer play your side too, ?level=easy|medium|hard, ?seed=N, ?char=Ch08.
import * as THREE from "three";
import { DT } from "./physics.js";
import { Game, TIMING } from "./game.js";
import { loadRoster, loadModel, Character, TRAITS } from "./chars.js";
import { View } from "./view.js";
import { Swipe } from "./input.js";
import * as A from "./audio.js";
import * as T from "./tournament.js";

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const AUTO = Q.get("auto") === "1";
const SEED = Q.get("seed") == null ? null : +Q.get("seed");
const MOBILE = matchMedia("(pointer: coarse)").matches;

const store = {
  get(k, d) { try { const v = localStorage.getItem("pb_" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("pb_" + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
};

// ---- renderer, scene, camera ------------------------------------------------------------
const canvas = $("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const view = new View(MOBILE);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
let dprScale = 1;

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, MOBILE ? 1.6 : 2) * dprScale;
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / Math.max(1, innerHeight);
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
addEventListener("orientationchange", () => setTimeout(resize, 200));
resize();

// ---- state --------------------------------------------------------------------------------
const S = {
  mode: "loading",      // loading | title | play | paused | result | bracket | champ
  level: store.get("level", "medium"),
  roster: [], charIdx: 0, oppId: null,
  slow: 0, shake: 0, overAt: 0, demoAgain: 0, hinted: false,
  helpBack: null, startAfterHelp: false,
  tour: null,           // the saved tournament (js/tournament.js), or null
  tourMatch: null       // while playing a tournament match: T.nextMatch() for it
};
if (Q.get("level")) S.level = Q.get("level");
let game = null;
const chars = { p: null, c: null };
const loadTok = { p: 0, c: 0 };

async function setChar(side, id) {
  const tok = ++loadTok[side];
  const M = await loadModel(id);
  if (tok !== loadTok[side]) return;
  if (chars[side]) view.scene.remove(chars[side].root);
  const ch = new Character(M, side === "p" ? 0xff6a3d : 0x38b8ff);
  ch.id = id;
  view.scene.add(ch.root);
  chars[side] = ch;
}

const nameOf = (id) => (TRAITS[id] && TRAITS[id].name) || id;
const myId = () => S.roster[S.charIdx];
function pickOpponent() {
  if (Q.get("opp") && S.roster.includes(Q.get("opp"))) return Q.get("opp");   // test hook: ?opp=Ch02
  const others = S.roster.filter((id) => id !== myId());
  return others[Math.floor(Math.random() * others.length)] || myId();
}

// ---- HUD helpers ----------------------------------------------------------------------------
let flashT = 0, bannerT = 0;
function flash(text, color, ms = 650) {
  const el = $("flash");
  el.textContent = text;
  el.style.color = color || "#fff";
  el.classList.remove("on"); void el.offsetWidth; el.classList.add("on");
  flashT = ms / 1000;
}
function banner(title, sub, cls, ms = 1900) {
  const el = $("banner");
  el.querySelector("b").textContent = title;
  el.querySelector("span").textContent = sub || "";
  el.className = "on " + (cls || "");
  bannerT = ms / 1000;
}
function prompt(text) {
  const el = $("prompt");
  if (text) { el.textContent = text; el.classList.add("on"); } else el.classList.remove("on");
}
function updateScore() {
  const R = game.rules;
  $("pScore").textContent = R.score.p;
  $("cScore").textContent = R.score.c;
  $("pSrv").classList.toggle("on", R.server === "p");
  $("cSrv").classList.toggle("on", R.server === "c");
  $("call").textContent = R.call();
}
function updateRally() {
  const el = $("rally");
  const n = game ? game.rally : 0;
  if (game && game.phase === "rally" && n >= 3) { el.textContent = "RALLY " + n; el.classList.add("on"); }
  else el.classList.remove("on");
}
function updateDepthBtn() {
  const atNet = game && game.depthPref === "kitchen";
  const b = $("btnDepth");
  b.textContent = atNet ? "STAY BACK" : "TO NET";
  b.classList.toggle("at-net", atNet);
}
const vibrate = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* not allowed */ } };

// ---- panels ---------------------------------------------------------------------------------
const PANELS = ["title", "help", "pause", "result", "bracket", "champ"];
function show(id) { for (const p of PANELS) $(p).classList.toggle("hidden", p !== id); }

function refreshTitle() {
  $("charName").textContent = nameOf(myId());
  for (const b of $("levels").children) b.classList.toggle("on", b.dataset.level === S.level);
  const w = store.get("wins", {});
  const parts = ["easy", "medium", "hard"].filter((k) => w[k]).map((k) => k[0].toUpperCase() + k.slice(1) + " " + w[k]);
  const crowns = store.get("crowns", 0);
  if (crowns) parts.unshift("Crowns " + crowns);
  $("record").textContent = parts.length ? "Wins: " + parts.join(" · ") : "";
  const t = S.tour;
  $("tourSub").textContent = t && !t.over ? "CONTINUE · " + T.ROUNDS[t.round].name + " · " + nameOf(t.me).toUpperCase() : "3 WINS TO THE CROWN";
  const s = A.isMuted() ? "SOUND OFF" : "SOUND ON";
  $("btnSound").textContent = s; $("btnPauseSound").textContent = s;
}

function toTitle() {
  S.mode = "title";
  S.tourMatch = null;
  $("hud").classList.add("hidden");
  swipe.enabled = false;
  prompt(null);
  view.showMarker(null);
  show("title");
  refreshTitle();
  startDemo();
}

function startDemo() {
  game = new Game({ level: "medium", demo: true, seed: SEED == null ? undefined : SEED });
  S.demoAgain = 0;
}

// tm: a tournament match (T.nextMatch), or null for a quick match.
async function startMatch(rematch, tm = null) {
  S.tourMatch = tm;
  if (tm) S.oppId = tm.opp;
  else if (!rematch || !S.oppId) S.oppId = pickOpponent();
  if (!store.get("seenHelp", false) && !AUTO) {
    store.set("seenHelp", true);
    S.startAfterHelp = tm ? "tour" : "quick";
    S.helpBack = null;
    show("help");
    return;
  }
  $("loadMsg").textContent = "Loading players...";
  const slow = setTimeout(() => $("loading").classList.remove("done"), 250);
  await Promise.all([chars.p && chars.p.id === myId() ? null : setChar("p", myId()), chars.c && chars.c.id === S.oppId ? null : setChar("c", S.oppId)]);
  clearTimeout(slow);
  $("loading").classList.add("done");
  game = new Game({ level: tm ? tm.level : S.level, target: tm ? tm.target : 11, demo: AUTO, seed: SEED == null ? undefined : SEED });
  S.mode = "play";
  S.overAt = 0;
  S.hinted = false;
  show(null);
  $("hud").classList.remove("hidden");
  for (const id of ["btnPause", "btnDepth"]) $(id).classList.remove("hidden");
  $("pName").textContent = nameOf(myId()).toUpperCase();
  $("cName").textContent = nameOf(S.oppId).toUpperCase();
  swipe.enabled = !AUTO;
  updateScore();
  updateDepthBtn();
  view.showMarker(null);
  if (tm) banner(tm.name, "FIRST TO " + tm.target, "", 2400);
}

function pause(on) {
  if (on && S.mode === "play") { S.mode = "paused"; show("pause"); refreshTitle(); }
  else if (!on && S.mode === "paused") { S.mode = "play"; show(null); }
}

function showResult() {
  S.mode = "result";
  swipe.enabled = false;
  for (const id of ["btnPause", "btnDepth"]) $(id).classList.add("hidden");
  prompt(null);
  const R = game.rules, won = R.winner === "p", tm = S.tourMatch;
  $("resTitle").textContent = won ? (tm && tm.round === T.ROUNDS.length - 1 ? "CHAMPION!" : "YOU WIN") : tm ? "ELIMINATED" : "YOU LOSE";
  $("resTitle").className = won ? "win" : "lose";
  $("resScore").textContent = R.score.p + " - " + R.score.c;
  const st = game.stats, longest = st.rallies.length ? Math.max(...st.rallies) : 0;
  $("resStats").innerHTML =
    `<div><b>${longest}</b><small>LONGEST RALLY</small></div>` +
    `<div><b>${st.perfect}</b><small>PERFECT HITS</small></div>` +
    (tm ? `<div><b>${tm.short}</b><small>${tm.name}</small></div>`
      : `<div><b>${S.level[0].toUpperCase() + S.level.slice(1)}</b><small>LEVEL</small></div>`);
  $("btnAgain").textContent = tm ? "CONTINUE" : "REMATCH";
  show("result");
}

// ---- tournament -------------------------------------------------------------------------------
function saveTour() { store.set("tour", S.tour); }

// TOURNAMENT on the title: resume the saved run, or draw a new one for the chosen player.
function openTournament() {
  if (!S.tour || S.tour.over) newTournament();
  showBracket();
}
function newTournament() {
  S.tour = T.newTournament(S.roster, myId(), SEED == null ? undefined : SEED);
  saveTour();
}

function showBracket() {
  const t = S.tour;
  S.mode = "bracket";
  S.tourMatch = null;
  $("hud").classList.add("hidden");
  swipe.enabled = false;
  prompt(null);
  view.showMarker(null);
  if (!game || !game.demo) startDemo();
  const nm = T.nextMatch(t);
  $("brTitle").textContent = nm ? nm.name : t.over === "won" ? "CHAMPION" : "BRACKET";
  let html = "";
  T.ROUNDS.forEach((rd, r) => {
    html += `<div class="col"><div class="hd${nm && nm.round === r ? " now" : ""}">${rd.short} · TO ${rd.target}</div>`;
    for (const m of T.matches(t, r)) {
      const mine = m.a === t.me || m.b === t.me;
      const row = (id, sc) => {
        if (!id) return `<div class="pl tbd"><span>—</span><b></b></div>`;
        const cls = ["pl"];
        if (m.res) cls.push(m.res.w === id ? "w" : "out");
        if (id === t.me) cls.push("me");
        return `<div class="${cls.join(" ")}"><span>${id === t.me ? "YOU · " : ""}${nameOf(id)}</span><b>${m.res ? sc : ""}</b></div>`;
      };
      html += `<div class="m${mine && !m.res ? " mine" : ""}">${row(m.a, m.res && m.res.sa)}${row(m.b, m.res && m.res.sb)}</div>`;
    }
    html += `</div>`;
  });
  $("brGrid").innerHTML = html;
  if (nm) {
    $("brNext").innerHTML = `NEXT: <em>YOU</em> vs ${nameOf(nm.opp).toUpperCase()}<small>${nm.name} · FIRST TO ${nm.target} · ${nm.level.toUpperCase()}</small>`;
    $("btnTourPlay").textContent = "PLAY " + nm.name;
  } else {
    const champ = T.champion(t);
    $("brNext").innerHTML = t.over === "lost"
      ? `OUT IN THE ${T.ROUNDS[t.lostIn].name}<small>${nameOf(champ).toUpperCase()} IS KING OF THE DILL</small>`
      : `<em>YOU</em> ARE KING OF THE DILL`;
    $("btnTourPlay").textContent = "NEW TOURNAMENT";
  }
  $("btnTourQuit").classList.toggle("hidden", !nm);
  $("btnTourQuit").classList.remove("arm");
  $("btnTourQuit").textContent = "ABANDON";
  show("bracket");
}

function tourPlay() {
  if (!S.tour || S.tour.over) { newTournament(); showBracket(); return; }
  // Your player is locked for the whole run.
  const i = S.roster.indexOf(S.tour.me);
  if (i >= 0 && i !== S.charIdx) { S.charIdx = i; store.set("char", myId()); }
  startMatch(false, T.nextMatch(S.tour));
}

// Abandon takes two taps (no browser dialogs: they freeze the game on phones).
function tourQuit() {
  const b = $("btnTourQuit");
  if (!b.classList.contains("arm")) { b.classList.add("arm"); b.textContent = "TAP AGAIN TO QUIT"; return; }
  S.tour = null;
  saveTour();
  toTitle();
}

function showChampion() {
  const t = S.tour;
  S.mode = "champ";
  swipe.enabled = false;
  for (const id of ["btnPause", "btnDepth"]) $(id).classList.add("hidden");
  $("hud").classList.add("hidden");
  $("chName").textContent = nameOf(t.me).toUpperCase();
  $("chPath").innerHTML = T.ROUNDS.map((rd, r) => {
    const m = T.matches(t, r).find((x) => x.a === t.me || x.b === t.me);
    const meA = m.a === t.me, opp = meA ? m.b : m.a;
    return `<div><b>${meA ? m.res.sa : m.res.sb}-${meA ? m.res.sb : m.res.sa}</b><small>${rd.short} · ${nameOf(opp).toUpperCase()}</small></div>`;
  }).join("");
  show("champ");
}

// Called when a tournament match ends: save the result before anything else can go wrong.
function tourResult(mine, theirs) {
  T.recordResult(S.tour, mine, theirs);
  if (S.tour.over === "won") store.set("crowns", store.get("crowns", 0) + 1);
  saveTour();
}

// ---- events from the match ------------------------------------------------------------------
const REASON = {
  "out": "OUT", "into the net": "INTO THE NET", "kitchen volley": "KITCHEN FAULT", "two-bounce rule": "TWO-BOUNCE RULE",
  "serve out": "SERVE OUT", "serve in the kitchen": "SERVE IN THE KITCHEN", "serve into the net": "SERVE IN THE NET", "dead ball": "DEAD BALL"
};
const TIMING_TEXT = {
  perfect: ["PERFECT!", "#7dff6a"], good: ["GOOD", "#e4ff3a"], early: ["EARLY", "#ffb84a"], late: ["LATE", "#ffb84a"],
  miss: ["MISSED", "#ff5a4a"], far: ["TOO FAR", "#ff5a4a"]
};
const pan = (x) => Math.max(-1, Math.min(1, x / 4));

function onEvents(evs) {
  const play = S.mode === "play" || S.mode === "result";
  for (const e of evs) {
    if (e.type === "gameOver") {
      if (!play) { S.demoAgain = 3; continue; }
      S.overAt = 2.6;
      A.win(e.winner === "p");
      const lvl = S.tourMatch ? S.tourMatch.level : S.level;
      if (e.winner === "p" && !AUTO) { const w = store.get("wins", {}); w[lvl] = (w[lvl] || 0) + 1; store.set("wins", w); }
      if (S.tourMatch) tourResult(game.rules.score.p, game.rules.score.c);
      continue;
    }
    if (!play) continue;
    switch (e.type) {
      case "hit": {
        const mine = e.who === "p";
        A.pop(Math.min(1, e.speed / 24), pan(game.ball.x), !mine);
        if (mine && !AUTO) { vibrate(14); prompt(null); }
        if (e.kind === "smash") { S.slow = 0.55; S.shake = Math.max(S.shake, mine ? 0.3 : 0.2); if (mine) flash("SMASH!", "#ff6a3d", 800); }
        view.showMarker(null);
        break;
      }
      case "timing":
        if (e.who === "p" && TIMING_TEXT[e.q]) {
          const [t, c] = TIMING_TEXT[e.q];
          flash(t, c);
          if (e.q === "perfect") { A.perfect(); S.shake = Math.max(S.shake, 0.08); }
        }
        break;
      case "predict":
        if (e.bounce && e.bounce.z > 0 && game.rules.lastHitter === "c" && !AUTO) view.showMarker(e.bounce, e.out);
        else view.showMarker(null);
        break;
      case "bounce":
        A.bounce(e.hard, pan(e.x));
        view.puff(e.x, e.z);
        if (e.z > 0) view.showMarker(null);
        break;
      case "net":
        A.net();
        break;
      case "point": {
        const won = e.winner === "p";
        let sub = REASON[e.reason] || "";
        if (e.reason === "two bounces") sub = won ? "WINNER" : "COULDN'T GET IT";
        const title = e.sideOut ? "SIDE OUT" : won ? "POINT!" : "THEIR POINT";
        banner(title, sub, won ? "win" : "lose");
        if (e.reason !== "two bounces" && e.reason !== "out") A.whistle();
        A.chime(won);
        view.showMarker(null);
        updateScore();
        break;
      }
      case "setup":
        updateScore();
        prompt(null);
        break;
      case "serveReady":
        updateScore();
        if (e.human) prompt(MOBILE ? "YOUR SERVE · SWIPE UP" : "YOUR SERVE · SWIPE UP OR SPACE");
        break;
    }
  }
}

// ---- input ------------------------------------------------------------------------------------
const swipe = new Swipe(canvas, $("fx"), (intent) => {
  if (S.mode !== "play" || !game) return;
  game.input(intent);
});

addEventListener("pointerdown", () => A.unlock(), { capture: true });
addEventListener("keydown", () => A.unlock(), { capture: true });

const held = new Set();
addEventListener("keyup", (e) => held.delete(e.code));
addEventListener("keydown", (e) => {
  held.add(e.code);
  if (e.repeat) return;
  if (e.code === "KeyM") { A.setMuted(!A.isMuted()); refreshTitle(); return; }
  if (S.mode === "paused" && (e.code === "KeyP" || e.code === "Escape")) { pause(false); return; }
  if (S.mode === "title" && e.code === "Enter") { startMatch(); return; }
  if (S.mode !== "play") return;
  if (e.code === "KeyP" || e.code === "Escape") { pause(true); return; }
  if (e.code === "KeyN") { toggleDepth(); return; }
  const L = held.has("ArrowLeft") || held.has("KeyA"), Rt = held.has("ArrowRight") || held.has("KeyD");
  const up = held.has("ArrowUp") || held.has("KeyW"), down = held.has("ArrowDown") || held.has("KeyS");
  const power = held.has("ShiftLeft") || held.has("ShiftRight");
  const aim = ((Rt ? 1 : 0) - (L ? 1 : 0)) * 0.8;
  let intent = null;
  if (e.code === "Space" || e.code === "KeyX") {
    intent = down && !power ? { kind: "drive", aim, depth: 0.15, pace: 0.1 }
      : { kind: "drive", aim, depth: up ? 0.95 : down ? 0.25 : 0.6, pace: power ? 0.95 : 0.5 };
  } else if (e.code === "KeyZ") intent = { kind: "dink", aim, depth: up ? 0.7 : 0.35, pace: 0.3 };
  else if (e.code === "KeyC") intent = { kind: "lob", aim, depth: up ? 0.9 : 0.6, pace: 0.4 };
  if (intent) { e.preventDefault(); game.input(intent); }
});

function toggleDepth() {
  if (!game || S.mode !== "play") return;
  game.setDepth(game.depthPref === "kitchen" ? "base" : "kitchen");
  updateDepthBtn();
}

// Buttons.
const tap = (id, fn) => $(id).addEventListener("click", (e) => { e.stopPropagation(); A.unlock(); fn(); });
tap("btnPlay", () => startMatch());
tap("btnTour", () => openTournament());
tap("btnTourPlay", () => tourPlay());
tap("btnTourQuit", () => tourQuit());
tap("btnTourMenu", () => toTitle());
tap("btnChampNew", () => { newTournament(); showBracket(); });
tap("btnChampMenu", () => toTitle());
tap("prevChar", () => { S.charIdx = (S.charIdx + S.roster.length - 1) % S.roster.length; charChanged(); });
tap("nextChar", () => { S.charIdx = (S.charIdx + 1) % S.roster.length; charChanged(); });
for (const b of $("levels").children) b.addEventListener("click", () => { S.level = b.dataset.level; store.set("level", S.level); refreshTitle(); });
const soundBtn = () => { A.setMuted(!A.isMuted()); refreshTitle(); };
tap("btnSound", soundBtn);
tap("btnPauseSound", soundBtn);
tap("btnHow", () => { S.helpBack = "title"; show("help"); });
tap("btnPauseHow", () => { S.helpBack = "pause"; show("help"); });
tap("btnHelpOk", () => {
  if (S.startAfterHelp) {
    const which = S.startAfterHelp;
    S.startAfterHelp = false;
    if (which === "tour") tourPlay(); else startMatch();
    return;
  }
  show(S.helpBack || "title");
});
tap("btnPause", () => pause(true));
tap("btnResume", () => pause(false));
tap("btnQuit", () => toTitle());
tap("btnDepth", () => toggleDepth());
tap("btnAgain", () => {
  if (!S.tourMatch) { startMatch(true); return; }
  if (S.tour && S.tour.over === "won") showChampion(); else showBracket();
});
tap("btnMenu", () => toTitle());

function charChanged() {
  store.set("char", myId());
  refreshTitle();
  if (S.oppId === myId()) S.oppId = null;
  setChar("p", myId());
  if (chars.c && chars.c.id === myId()) setChar("c", pickOpponent());
}

document.addEventListener("visibilitychange", () => { if (document.hidden) pause(true); });
// iPhone Safari: no pinch / double-tap zoom, no rubber-band scrolling.
for (const n of ["gesturestart", "gesturechange"]) document.addEventListener(n, (e) => e.preventDefault());
let lastEnd = 0;
document.addEventListener("touchend", (e) => {
  const n = Date.now();
  if (n - lastEnd < 350 && !(e.target.closest && e.target.closest("button"))) e.preventDefault();
  lastEnd = n;
}, { passive: false });
document.addEventListener("touchmove", (e) => { if (e.target === canvas) e.preventDefault(); }, { passive: false });
document.addEventListener("contextmenu", (e) => e.preventDefault());

// ---- per-frame: characters, ball, camera ------------------------------------------------------
function charState(pl) {
  const g = game;
  const st = { vx: pl.vx, vz: pl.vz, yaw: pl.side === "p" ? Math.PI : 0, time: g.time, swingKind: null, tau: null, left: null, mood: pl.mood };
  const serving = g.rules.server === pl.side && (g.phase === "serve" || g.phase === "setup");
  if (pl.swing && g.time - pl.swing.t < 0.75) { st.swingKind = pl.swing.kind; st.tau = g.time - pl.swing.t; }
  else if (pl.plan && g.phase === "rally") {
    st.swingKind = pl.plan.kind; st.tau = g.time - pl.plan.t;
    if (pl.plan.kind === "oh" && st.tau > -0.8) st.left = "oh";
  } else if (serving) {
    st.left = "serve";
    if (g.phase === "serve") { st.swingKind = "serve"; st.tau = g.aiControlled(pl) ? g.phaseT - 1.1 : -0.3; }
  }
  return st;
}

const cam = { x: 0, y: 2.5, z: 11, lx: 0, ly: 0.6, lz: 0, fov: 50, ready: false };
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
let orbitT = 0;

function updateCamera(dt) {
  const portrait = camera.aspect < 0.95;
  let w;
  if (S.mode === "champ") {
    // In front of the champion (the human faces -z), swaying slowly while they twirl.
    orbitT += dt * 0.5;
    // Far enough back for the flip; on a tall phone the panel covers the bottom half, so aim
    // low to put the player in the top half.
    const pl = game.p, a = Math.sin(orbitT) * 0.5, d = portrait ? 6 : 4.4;
    w = { x: pl.x + Math.sin(a) * d, y: portrait ? 1.6 : 1.5, z: pl.z - Math.cos(a) * d, lx: pl.x, ly: portrait ? -1.4 : 1.0, lz: pl.z, fov: portrait ? 60 : 45 };
  } else if (S.mode === "title" || S.mode === "loading" || S.mode === "bracket") {
    // A slow sweep inside the fence (clear of the light poles), from behind
    // your baseline round to a sideline view.
    orbitT += dt * 0.07;
    const a = 0.55 + Math.sin(orbitT) * 0.55;
    w = portrait
      ? { x: Math.sin(a) * 4.2, y: 7.4, z: Math.cos(a) * 10, lx: 0, ly: -2.6, lz: 0.5, fov: 64 }
      : { x: Math.sin(a) * 4.2, y: 5.2, z: Math.cos(a) * 10, lx: 0, ly: 0.2, lz: 0.8, fov: 54 };
  } else {
    // Over the right shoulder, behind the baseline, looking down the court (Last Light style).
    // Never behind the back fence (z 10.7): a tall phone screen gets height instead of distance.
    const pl = game.p;
    const back = portrait ? 3.4 : 3.7, up = portrait ? 4.3 : 2.35, side = portrait ? 0.2 : 0.6;
    w = { x: pl.x * 0.75 + side, y: up, z: Math.min(10.2, pl.z + back), lx: pl.x * 0.3, ly: portrait ? -1.2 : 0.55, lz: pl.z - 8.5, fov: portrait ? 64 : 50 };
  }
  if (!cam.ready) { Object.assign(cam, w); cam.ready = true; }
  const k = S.mode === "title" ? 1.5 : 4.5;
  for (const key of ["x", "y", "z", "lx", "ly", "lz", "fov"]) cam[key] = damp(cam[key], w[key], key[0] === "l" ? k * 0.9 : k, dt);
  camera.position.set(cam.x, cam.y, cam.z);
  if (S.shake > 0) {
    const s = S.shake * 0.12;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    S.shake = Math.max(0, S.shake - dt * 1.6);
  }
  camera.lookAt(cam.lx, cam.ly, cam.lz);
  // Wide screens: the menu sits on the right, so shift the picture left.
  const off = !portrait && S.mode !== "play" && S.mode !== "paused" && S.mode !== "result" ? 0.2 : 0;
  cam.off = damp(cam.off || 0, off, 3, dt);
  const W = innerWidth, H = innerHeight;
  if (cam.off > 0.002) camera.setViewOffset(W, H, W * cam.off, 0, W, H);
  else if (camera.view && camera.view.enabled) camera.clearViewOffset();
  if (Math.abs(camera.fov - cam.fov) > 0.05 || cam.off > 0.002) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
}

const _v = new THREE.Vector3();
function updateBall() {
  const g = game, b = g.ball;
  if (g.phase === "setup" || g.phase === "serve") {
    const srv = chars[g.rules.server];
    if (srv) { srv.leftHandWorld(_v); view.setBall(_v.x, _v.y - 0.04, _v.z, false, 0); }
    else { const h = g.heldBall(); view.setBall(h.x, h.y, h.z, false, 0); }
    return;
  }
  view.setBall(b.x, b.y, b.z, g.ballLive, Math.hypot(b.vx, b.vy, b.vz));
}

// Adaptive resolution: drop the pixel ratio if frames run slow.
let perfT = 0, perfN = 0, perfSum = 0;
function perf(rdt) {
  perfT += rdt; perfN++; perfSum += rdt;
  if (perfT < 2.5) return;
  const avg = perfSum / perfN;
  if (avg > 0.026 && dprScale > 0.55) { dprScale = Math.max(0.55, dprScale - 0.15); resize(); }
  perfT = perfN = perfSum = 0;
}

let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!game) return;
  let ts = 1;
  if (S.slow > 0) { S.slow -= rdt; ts = 0.3; }
  const running = S.mode !== "paused" && S.mode !== "loading";
  if (running) {
    acc += rdt * ts;
    let n = 0;
    while (acc >= DT && n < 30) { game.step(DT); onEvents(game.drain()); acc -= DT; n++; }
    if (n >= 30) acc = 0;
  }
  const gdt = running ? rdt * ts : 0;
  for (const side of ["p", "c"]) {
    const ch = chars[side];
    if (!ch) continue;
    const pl = game.get(side);
    ch.root.position.set(pl.x, 0, pl.z);
    ch.update(gdt, charState(pl));
  }
  updateBall();
  updateCamera(rdt);
  const hc = S.mode === "play" ? game.humanContact() : null;
  view.showRing(hc, camera, TIMING.perfect);
  if (hc && !S.hinted && hc.left < 0.5 && game.rules.shots <= 2) { S.hinted = true; prompt("SWIPE UP AS THE RING CLOSES"); setTimeout(() => prompt(null), 1600); }
  view.update(gdt);
  swipe.draw(rdt);
  if (flashT > 0 && (flashT -= rdt) <= 0) $("flash").classList.remove("on");
  if (bannerT > 0 && (bannerT -= rdt) <= 0) $("banner").classList.remove("on");
  updateRally();
  if (S.mode === "play" && S.overAt > 0 && (S.overAt -= rdt) <= 0) showResult();
  if ((S.mode === "title" || S.mode === "bracket") && S.demoAgain > 0 && (S.demoAgain -= rdt) <= 0) startDemo();
  renderer.render(view.scene, camera);
  perf(rdt);
}

// ---- boot -------------------------------------------------------------------------------------
async function boot() {
  try {
    S.roster = await loadRoster();
    const saved = store.get("tour", null);
    S.tour = T.valid(saved, S.roster) ? saved : null;
    const want = Q.get("char") || store.get("char", null);
    S.charIdx = Math.max(0, S.roster.indexOf(want));
    S.oppId = pickOpponent();
    await Promise.all([setChar("p", myId()), setChar("c", S.oppId)]);
  } catch (e) {
    $("loadMsg").textContent = "Could not load the game files (" + e.message + "). Serve the folder or use the single-file version.";
    console.error(e);
    return;
  }
  startDemo();
  requestAnimationFrame((t) => { last = t; frame(t); });
  $("loading").classList.add("done");
  if (Q.get("play") === "1") { store.set("seenHelp", true); startMatch(); }
  else toTitle();
}

// finish(mine, theirs): test hook, ends the current match with that score through the real game-over path.
const finish = (mine, theirs) => {
  const R = game.rules;
  R.score.p = mine; R.score.c = theirs; R.winner = mine > theirs ? "p" : "c";
  game.phase = "over"; game.ballLive = false;
  game.get(R.winner).mood = "twirl"; game.get(R.winner).moodT = game.time;
  onEvents([{ type: "gameOver", winner: R.winner }]);
  updateScore();
  S.overAt = 0.05;
};
window.PB = { S, view, camera, chars, start: startMatch, tour: openTournament, finish, get game() { return game; } };
boot();
