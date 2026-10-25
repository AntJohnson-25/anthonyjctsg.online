// Turkey Bowl 3D — boot, input, the loop, and the HUD.
//
// URL options (handy for testing):
//   ?team=0|1   skip the team select and start as that team
//   ?demo       CPU vs CPU, no human (attract mode / screenshots)
//   ?q=low|medium|high   graphics quality (also in the pause menu)
//   ?cam=chase|broadcast|high
(function () {
  const D = window.TBData;
  const Sim = window.TBSim;
  const Audio = window.TBAudio;
  const PH = Sim.PHASE;
  const $ = function (id) { return document.getElementById(id); };
  const Q = new URLSearchParams(location.search);

  // ---- errors on screen (a phone has no console) ----
  function showError(msg) {
    const el = $("err");
    el.hidden = false;
    el.textContent = String(msg).slice(0, 600);
  }
  window.addEventListener("error", function (e) { showError((e.message || e) + (e.filename ? "\n" + e.filename + ":" + e.lineno : "")); });

  const isTouch = (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || "ontouchstart" in window || navigator.maxTouchPoints > 0;
  if (isTouch) document.body.classList.add("touch");
  // iPhone Safari ignores user-scalable=no: stop double-tap zoom and pinch.
  let lastTouchEnd = 0;
  document.addEventListener("touchend", function (e) {
    const now = Date.now();
    if (now - lastTouchEnd < 350) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
  document.addEventListener("gesturestart", function (e) { e.preventDefault(); });

  // ---- settings, remembered per browser ----
  // Medium by default everywhere: this is meant to run on a modest laptop and
  // a phone. High (sharper shadows, full pixel ratio) is one tap away.
  const settings = { quality: "medium", camera: "chase", sound: true, autoReplay: true };
  try {
    const s = JSON.parse(localStorage.getItem("tb3d.settings") || "{}");
    Object.keys(settings).forEach(function (k) { if (s[k] !== undefined) settings[k] = s[k]; });
  } catch (_) { /* private mode */ }
  if (Q.get("q")) settings.quality = Q.get("q");
  if (Q.get("cam")) settings.camera = Q.get("cam");
  function saveSettings() {
    try { localStorage.setItem("tb3d.settings", JSON.stringify(settings)); } catch (_) { /* ignore */ }
  }

  let view = null;
  let gs = null;
  let mode = "loading";
  let paused = false;
  let humanTeam = 0;
  let last = performance.now();

  // ---- input ----
  const keys = Object.create(null);
  const pressed = Object.create(null);
  const tap = Object.create(null);
  const stick = { x: 0, y: 0 };
  let pendingPlay = -1;   // the human's offensive call, for the sim's next update
  let pendingDef = -1;    // ...and defensive call

  function keyName(e) {
    if (e.key === " " || e.code === "Space") return " ";
    return e.key.length === 1 ? e.key.toLowerCase() : e.key;
  }
  window.addEventListener("keydown", function (e) {
    const k = keyName(e);
    // The replay eats its keys too.
    if (mode === "game" && replay.on && replayKey(k)) { e.preventDefault(); return; }
    // The call screen eats its keys whole, so the Enter or 1 that makes a call
    // can never also snap the ball or throw it.
    if (mode === "game" && !paused && callKey(k)) { e.preventDefault(); return; }
    if (!keys[k] && (k === "1" || k === "2" || k === "3")) throwDown(parseInt(k, 10));
    if (!keys[k]) pressed[k] = true;
    keys[k] = true;
    if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].indexOf(k) !== -1) e.preventDefault();
    if (k === "p" || k === "Escape") { if (mode === "game") setPaused(!paused); }
    if (k === "c" && mode === "game") cycleCamera();
    if (k === "m") toggleSound();
    if (k === "r" && mode === "game" && !paused && canReplay()) startReplay(false);
  });
  window.addEventListener("keyup", function (e) {
    const k = keyName(e);
    keys[k] = false;
    if (k === "1" || k === "2" || k === "3") throwUp(parseInt(k, 10));
  });

  // Passing, Madden-style: TAP a target for a touch pass, HOLD it (D.THROW_HOLD)
  // for a bullet. The bullet goes the moment the hold is long enough; a touch
  // pass goes on release.
  let throwHold = null;   // { n, t0, fired }
  function throwDown(n) {
    if (!gs || gs.phase !== PH.LIVE || throwHold) return;
    throwHold = { n: n, t0: performance.now(), fired: false };
  }
  function throwUp(n) {
    if (!throwHold || throwHold.n !== n) return;
    if (!throwHold.fired) queueThrow(n, "touch");
    throwHold = null;
  }
  function checkThrowHold() {
    // The badges hide once the ball is gone, so a release may never arrive.
    if (throwHold && (!gs || gs.phase !== PH.LIVE)) throwHold = null;
    if (!throwHold || throwHold.fired) return;
    if (performance.now() - throwHold.t0 >= D.THROW_HOLD * 1000) {
      queueThrow(throwHold.n, "bullet");
      throwHold.fired = true;
    }
  }
  let throwKind = null;
  function queueThrow(n, kind) {
    tap["throw" + n] = true;
    throwKind = kind;
  }
  window.addEventListener("blur", function () { for (const k in keys) keys[k] = false; stick.x = stick.y = 0; resetKnob(); throwHold = null; });

  // The joystick: pointer events, so it also works with a mouse.
  const joy = $("joy");
  const knob = $("knob");
  let joyId = null;
  function resetKnob() { joyId = null; stick.x = stick.y = 0; knob.style.transform = "translate(0px,0px)"; }
  function joyMove(e) {
    if (e.pointerId !== joyId) return;
    const r = joy.getBoundingClientRect();
    const max = r.width / 2;
    let dx = e.clientX - (r.left + max);
    let dy = e.clientY - (r.top + max);
    const len = Math.hypot(dx, dy);
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    knob.style.transform = "translate(" + dx + "px," + dy + "px)";
    stick.x = dx / max;
    stick.y = -dy / max;
    // A small dead zone, then full speed from half deflection.
    const m = Math.hypot(stick.x, stick.y);
    if (m < 0.15) { stick.x = stick.y = 0; } else { const s = Math.min(1, m * 1.6) / m; stick.x *= s; stick.y *= s; }
  }
  joy.addEventListener("pointerdown", function (e) { joyId = e.pointerId; joy.setPointerCapture(joyId); joyMove(e); e.preventDefault(); });
  joy.addEventListener("pointermove", joyMove);
  joy.addEventListener("pointerup", function (e) { if (e.pointerId === joyId) resetKnob(); });
  joy.addEventListener("pointercancel", function (e) { if (e.pointerId === joyId) resetKnob(); });

  function readInput() {
    const held = function (a, b) { return (keys[a] || keys[b]) ? 1 : 0; };
    const sx = Math.max(-1, Math.min(1, held("ArrowRight", "d") - held("ArrowLeft", "a") + stick.x));
    const sy = Math.max(-1, Math.min(1, held("ArrowUp", "w") - held("ArrowDown", "s") + stick.y));
    // Camera-relative: up on the stick is up the screen, whichever camera.
    const b = view.inputBasis();
    const play = pendingPlay;
    const defPlay = pendingDef;
    pendingPlay = pendingDef = -1;
    checkThrowHold();
    const inp = {
      x: sx * b.rx + sy * b.ux,
      y: sx * b.ry + sy * b.uy,
      snap: !!(pressed[" "] || pressed.Enter || tap.snap),
      throw1: !!tap.throw1,
      throw2: !!tap.throw2,
      throw3: !!tap.throw3,
      throwKind: throwKind || "touch",
      pitch: !!(pressed["4"] || tap.pitch),
      // Shift/E: juke with the ball, HIGH-POINT while a pass is in the air.
      juke: !!(pressed.Shift || pressed.e || tap.juke || tap.highpoint),
      spin: !!(pressed.q || tap.spin),
      // Space or H while running: hurdle; again quickly = front corkscrew.
      hurdle: !!(pressed.h || tap.hurdle || (pressed[" "] && gs && gs.phase === PH.LIVE)),
      tackle: !!(pressed.f || tap.tackle),
      flip: !!(pressed.x || tap.flip),
      play: play,
      defPlay: defPlay
    };
    throwKind = null;
    for (const k in pressed) delete pressed[k];
    for (const k in tap) delete tap[k];
    return inp;
  }

  // ---- HUD ----
  const hud = {
    away: $("sbAway"), home: $("sbHome"), quarter: $("sbQuarter"), clock: $("sbClock"), downs: $("downs"),
    banner: $("banner"), flash: $("flash"), hint: $("hint"), badges: $("badges"),
    acts: $("acts"), fade: $("fade"), fadeLogo: $("fadeLogo")
  };
  [hud.away, hud.home].forEach(function (el, i) {
    el.querySelector("img").src = D.TEAMS[i].mascot;
    el.querySelector(".nm").textContent = D.TEAMS[i].name.toUpperCase();
  });

  // Chalkboard diagram of a call, from the same tables the sim runs.
  function playDiagram(play) {
    const VW = 160, VH = 86, SPAN_X = 54, BACK_Y = 7, DEEP_Y = 24;
    const sx = function (dx) { return VW / 2 + (dx / SPAN_X) * VW; };
    const sy = function (dy) { return VH - 6 - ((dy + BACK_Y) / (BACK_Y + DEEP_Y)) * (VH - 10); };
    const colors = { WR1: "#f2c233", WR2: "#58b4ef", TE: "#c690f0", RB: "#6cc25a", run: "#ff7a3c" };
    const spots = {};
    D.FORMATION.offense.forEach(function (f) { spots[f.slot] = f; });
    let paths = "";
    const line = function (pts, color, dashed) {
      paths += '<polyline points="' + pts.map(function (p) { return sx(p.dx).toFixed(1) + "," + sy(p.dy).toFixed(1); }).join(" ") +
        '" fill="none" stroke="' + color + '" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"' +
        (dashed ? ' stroke-dasharray="4 3"' : "") + "/>";
    };
    const route = function (slot, name) {
      const f = spots[slot];
      const flip = f.dx > 0 ? -1 : 1;
      line([{ dx: f.dx, dy: f.dy }].concat(D.ROUTES[name].map(function (p) {
        return { dx: Math.max(-D.FIELD_MID + 1.5, Math.min(D.FIELD_MID - 1.5, f.dx + p.dx * flip)), dy: f.dy + p.dy };
      })), colors[slot] || colors.RB);
    };
    const block = function (slot) {
      const f = spots[slot];
      const x = sx(f.dx), y = sy(f.dy + 2.4);
      paths += '<line x1="' + x + '" y1="' + sy(f.dy + 0.6) + '" x2="' + x + '" y2="' + y + '" stroke="#e8e2cf" stroke-width="2"/>' +
        '<line x1="' + (x - 5) + '" y1="' + y + '" x2="' + (x + 5) + '" y2="' + y + '" stroke="#e8e2cf" stroke-width="2.4"/>';
    };
    ["WR1", "WR2"].forEach(function (s) { const a = play.wr && play.wr[s]; if (a === "block") block(s); else if (a) route(s, a); });
    if (play.te === "block") block("TE"); else if (play.te) route("TE", play.te);
    if (play.rb === "block") block("RB"); else if (play.rb) route("RB", play.rb);
    if (play.handoff) {
      const rb = spots[play.handoff];
      if (play.pitchBackAfter) {
        line([{ dx: rb.dx, dy: rb.dy }, { dx: rb.dx - 1, dy: rb.dy + 4 }], colors.run);
        line([{ dx: rb.dx - 1, dy: rb.dy + 4 }, { dx: -0.8, dy: -3.6 }], "#e8e2cf", true);
      } else {
        const bias = play.runBias || 0;
        line(bias ? [{ dx: rb.dx, dy: rb.dy }, { dx: rb.dx + bias * 9, dy: rb.dy + 3 }, { dx: rb.dx + bias * 11, dy: rb.dy + 17 }]
          : [{ dx: rb.dx, dy: rb.dy }, { dx: 0.8, dy: rb.dy + 5 }, { dx: 0.8, dy: 17 }], colors.run);
      }
    }
    const xs = D.DEFENSES[0].units.map(function (u) {
      const x = sx(u.dx), y = sy(u.dy), r = 3;
      return '<path d="M' + (x - r) + "," + (y - r) + " L" + (x + r) + "," + (y + r) + " M" + (x + r) + "," + (y - r) + " L" + (x - r) + "," + (y + r) + '" stroke="#ef6b5b" stroke-width="2" stroke-linecap="round"/>';
    }).join("");
    const os = D.FORMATION.offense.map(function (f) {
      const c = f.slot === play.handoff ? colors.run : (colors[f.slot] || "#e8e2cf");
      return '<circle cx="' + sx(f.dx).toFixed(1) + '" cy="' + sy(f.dy).toFixed(1) + '" r="3.6" fill="#26402a" stroke="' + c + '" stroke-width="2"/>';
    }).join("");
    return '<svg viewBox="0 0 ' + VW + " " + VH + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
      '<line x1="3" y1="' + sy(0) + '" x2="' + (VW - 3) + '" y2="' + sy(0) + '" stroke="#e8e2cf" stroke-opacity="0.4" stroke-dasharray="3 3"/>' +
      xs + paths + os + "</svg>";
  }

  // Defensive play art, Madden-style: red rush arrows to the quarterback
  // (dashed on a long count), red man-coverage lines to the receiver, a yellow
  // hook zone for the linebacker and blue deep zones for the safeties.
  function defDiagram(def) {
    const VW = 160, VH = 86, SPAN_X = 40, BACK_Y = 6, DEEP_Y = 27;
    const sx = function (dx) { return VW / 2 + (dx / SPAN_X) * VW; };
    const sy = function (dy) { return VH - 5 - ((dy + BACK_Y) / (BACK_Y + DEEP_Y)) * (VH - 9); };
    const spots = {};
    D.FORMATION.offense.forEach(function (f) { spots[f.slot] = f; });
    const count = def.rushCount === undefined ? D.RUSH_COUNT : def.rushCount;
    let zones = "", lines = "", marks = "";
    def.units.forEach(function (u) {
      const x = sx(u.dx), y = sy(u.dy);
      if (u.ai === "CONTAIN") {
        zones += '<ellipse cx="' + x + '" cy="' + sy(Math.max(u.dy, 15) + 3) + '" rx="17" ry="6.5" fill="#3d8fe0" fill-opacity="0.38" stroke="#7cc0ff" stroke-width="1.2"/>';
        lines += '<line x1="' + x + '" y1="' + y + '" x2="' + x + '" y2="' + sy(Math.max(u.dy, 15) + 3) + '" stroke="#7cc0ff" stroke-width="1.6"/>';
      } else if (u.ai === "LB") {
        zones += '<ellipse cx="' + x + '" cy="' + sy(u.dy + 1) + '" rx="13" ry="5" fill="#f2c233" fill-opacity="0.32" stroke="#f2c233" stroke-width="1.2"/>';
      } else if (u.ai === "COVER") {
        const r = spots[u.covers];
        lines += '<line x1="' + x + '" y1="' + y + '" x2="' + sx(r.dx) + '" y2="' + sy(r.dy + 1) + '" stroke="#ff5a4a" stroke-width="2"/>';
      } else {
        lines += '<line x1="' + x + '" y1="' + y + '" x2="' + sx(0) + '" y2="' + sy(-3) + '" stroke="#ff3b2f" stroke-width="2.6"' +
          (count >= 2.5 ? ' stroke-dasharray="4 3"' : "") + ' marker-end="url(#ah)"/>';
      }
      marks += '<path d="M' + (x - 3.2) + "," + (y - 3.2) + " L" + (x + 3.2) + "," + (y + 3.2) + " M" + (x + 3.2) + "," + (y - 3.2) + " L" + (x - 3.2) + "," + (y + 3.2) +
        '" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>';
    });
    const os = D.FORMATION.offense.map(function (f) {
      return '<circle cx="' + sx(f.dx).toFixed(1) + '" cy="' + sy(f.dy).toFixed(1) + '" r="3.2" fill="none" stroke="#e8e2cf" stroke-opacity="0.55" stroke-width="1.6"/>';
    }).join("");
    return '<svg viewBox="0 0 ' + VW + " " + VH + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
      '<defs><marker id="ah" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#ff3b2f"/></marker></defs>' +
      '<line x1="3" y1="' + sy(0) + '" x2="' + (VW - 3) + '" y2="' + sy(0) + '" stroke="#e8e2cf" stroke-opacity="0.4" stroke-dasharray="3 3"/>' +
      zones + lines + os + marks + "</svg>";
  }

  // ---- the call screen (Madden-style) ----
  // Opens on its own in the huddle while the human's call is pending, closes on
  // the call. B (or the chip) reopens it to audible: offense at the line,
  // defense any time before the snap.
  const call = { open: false, audible: false, side: "off", tab: 0, page: 0, focus: 0, drawn: "" };
  const cs = {
    root: $("callscreen"), logo: $("csLogo"), side: $("csSide"), sit: $("csSit"), clock: $("csClock"),
    tabs: $("csTabs"), cards: $("csCards"), prev: $("csPrev"), next: $("csNext"), dots: $("csDots"), keys: $("csKeys"),
    chip: $("callchip"), chipSide: $("ccSide"), chipName: $("ccName"), chipKey: $("ccKey")
  };
  const PER_PAGE = 3;
  const TABS = { off: ["SUGGESTED", "RUN", "PASS", "TRICK"], def: ["SUGGESTED", "BASE", "BLITZ", "COVERAGE"] };
  const artCache = {};
  function book(side) { return side === "off" ? D.PLAYBOOK : D.DEFENSES; }
  function art(side, i) {
    const k = side + i;
    if (!artCache[k]) artCache[k] = side === "off" ? playDiagram(D.PLAYBOOK[i]) : defDiagram(D.DEFENSES[i]);
    return artCache[k];
  }
  function tabItems(side, tab) {
    if (tab === 0) return (gs && gs.suggest) ? gs.suggest.slice() : [];
    const tag = TABS[side][tab];
    const out = [];
    book(side).forEach(function (p, i) { if (p.tag === tag) out.push(i); });
    return out;
  }
  function pageItems() {
    const all = tabItems(call.side, call.tab);
    return all.slice(call.page * PER_PAGE, call.page * PER_PAGE + PER_PAGE);
  }
  function pageCount() { return Math.max(1, Math.ceil(tabItems(call.side, call.tab).length / PER_PAGE)); }
  function currentCall(side) { return side === "off" ? gs.playCall : gs.defCall; }

  // Offense can audible only at the line; defense any time before the snap.
  function canAudible() {
    if (!gs || humanTeam < 0 || gs.callPending) return false;
    if (gs.offense === humanTeam) return gs.phase === PH.PRE_SNAP;
    return gs.phase === PH.HUDDLE || gs.phase === PH.HUDDLE_BREAK || gs.phase === PH.PRE_SNAP;
  }
  function openCall(audible) {
    call.open = true;
    call.audible = !!audible;
    call.side = gs.offense === humanTeam ? "off" : "def";
    call.tab = 0;
    call.page = 0;
    call.focus = 0;
    // An audible opens on the tab and card of the current call.
    if (audible) {
      const cur = currentCall(call.side);
      const t = TABS[call.side].indexOf(book(call.side)[cur].tag);
      if (t > 0) {
        call.tab = t;
        const at = tabItems(call.side, t).indexOf(cur);
        call.page = Math.floor(at / PER_PAGE);
        call.focus = at % PER_PAGE;
      }
    }
    call.drawn = "";
    Audio.cue("click");
  }
  function closeCall() { call.open = false; call.audible = false; }
  function makeCall(index) {
    // No banner: the call chip under the down-and-distance shows the call.
    if (call.side === "off") pendingPlay = index; else pendingDef = index;
    Audio.cue("click");
    closeCall();
  }
  function moveFocus(d) {
    const items = pageItems().length;
    let f = call.focus + d;
    if (f < 0) {
      if (call.page > 0) { call.page--; f = PER_PAGE - 1; } else f = 0;
    } else if (f >= items) {
      if (call.page < pageCount() - 1) { call.page++; f = 0; } else f = items - 1;
    }
    call.focus = Math.max(0, Math.min(f, pageItems().length - 1));
  }
  function moveTab(d) {
    const n = TABS[call.side].length;
    call.tab = (call.tab + d + n) % n;
    call.page = 0;
    call.focus = 0;
  }
  // Keys while the call screen is up (or B to bring it up). True = handled.
  function callKey(k) {
    if (!gs) return false;
    if (!call.open) {
      if (k === "b" && canAudible()) { openCall(true); return true; }
      return false;
    }
    if (k === "ArrowLeft" || k === "a") moveFocus(-1);
    else if (k === "ArrowRight" || k === "d") moveFocus(1);
    else if (k === "ArrowUp" || k === "w") moveTab(-1);
    else if (k === "ArrowDown" || k === "s" || k === "Tab") moveTab(1);
    else if (k === "1" || k === "2" || k === "3") {
      const it = pageItems()[parseInt(k, 10) - 1];
      if (it !== undefined) makeCall(it);
    } else if (k === "Enter" || k === " ") {
      const it = pageItems()[call.focus];
      if (it !== undefined) makeCall(it);
    } else if ((k === "b" || k === "Backspace") && call.audible) closeCall();
    else if (k === "x" && call.side === "off") { tap.flip = true; Audio.cue("click"); }
    else if (k === "r" && canReplay()) startReplay(false);
    else return k !== "p" && k !== "Escape" && k !== "m" && k !== "c";
    return true;
  }
  $("csFlip").addEventListener("click", function () { if (call.side === "off") { tap.flip = true; Audio.cue("click"); } });
  $("csReplay").addEventListener("click", function () { if (canReplay()) startReplay(false); });
  ["csFlip", "csReplay"].forEach(function (id) { $(id).addEventListener("mousedown", function (e) { e.preventDefault(); }); });
  cs.prev.addEventListener("click", function () { if (call.page > 0) { call.page--; call.focus = 0; } });
  cs.next.addEventListener("click", function () { if (call.page < pageCount() - 1) { call.page++; call.focus = 0; } });
  cs.chip.addEventListener("click", function () { if (canAudible()) openCall(true); });
  [cs.prev, cs.next, cs.chip].forEach(function (b) { b.addEventListener("mousedown", function (e) { e.preventDefault(); }); });

  function drawCall() {
    const side = call.side;
    const items = pageItems();
    const cur = currentCall(side);
    const key = [side, call.tab, call.page, call.focus, cur, (gs.suggest || []).join("."), humanTeam, gs.humanFlip, canReplay()].join("|");
    if (key === call.drawn) return;
    call.drawn = key;
    // FLIP mirrors the play art; REPLAY shows the last play again.
    cs.root.classList.toggle("flipped", side === "off" && !!gs.humanFlip);
    $("csFlip").hidden = side !== "off";
    $("csFlip").classList.toggle("on", !!gs.humanFlip);
    $("csReplay").hidden = !canReplay();
    const team = D.TEAMS[humanTeam];
    cs.root.style.setProperty("--tc", side === "off" ? team.primary : "#2a7fb8");
    cs.logo.src = team.mascot;
    cs.side.textContent = side === "off" ? "OFFENSE" : "DEFENSE";
    cs.tabs.innerHTML = "";
    TABS[side].forEach(function (name, t) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cs-tab" + (t === call.tab ? " on" : "");
      b.textContent = name;
      b.addEventListener("mousedown", function (e) { e.preventDefault(); });
      b.addEventListener("click", function () { call.tab = t; call.page = 0; call.focus = 0; });
      cs.tabs.appendChild(b);
    });
    cs.cards.innerHTML = "";
    items.forEach(function (idx, n) {
      const p = book(side)[idx];
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ccard" + (n === call.focus ? " focus" : "") + (idx === cur && !gs.callPending ? " current" : "");
      const pick = call.tab === 0 && call.page === 0 && n === 0 ? '<span class="pick">COACH\'S PICK</span>' : "";
      const extra = side === "def" ? '<span class="rush">RUSH ' + (p.rushCount === undefined ? D.RUSH_COUNT : p.rushCount).toFixed(1) + "s</span>" : "";
      b.innerHTML = '<span class="k">' + (n + 1) + "</span>" + pick + '<span class="art">' + art(side, idx) + "</span>" +
        '<span class="nm"></span><span class="row"><span class="tg ' + p.tag + '">' + p.tag + "</span>" + extra + '</span><span class="ht"></span>';
      b.querySelector(".nm").textContent = p.name;
      b.querySelector(".ht").textContent = p.hint;
      b.addEventListener("mousedown", function (e) { e.preventDefault(); });
      b.addEventListener("mouseenter", function () { if (call.focus !== n) { call.focus = n; } });
      b.addEventListener("click", function () { makeCall(idx); });
      cs.cards.appendChild(b);
    });
    const pages = pageCount();
    cs.prev.style.visibility = call.page > 0 ? "visible" : "hidden";
    cs.next.style.visibility = call.page < pages - 1 ? "visible" : "hidden";
    cs.dots.innerHTML = pages > 1 ? new Array(pages).fill(0).map(function (_, i) { return "<i" + (i === call.page ? ' class="on"' : "") + "></i>"; }).join("") : "";
    cs.keys.textContent = isTouch ? "Tap a play to call it" + (call.audible ? " · tap outside to keep the call" : "")
      : "← → choose  ·  ↑ ↓ category  ·  1–3 or ENTER call" + (side === "off" ? "  ·  X flip" : "") + (canReplay() ? "  ·  R replay" : "") + (call.audible ? "  ·  B keep the call" : "");
  }

  function syncCall() {
    const human = humanTeam >= 0;
    const pending = human && gs.callPending && gs.phase === PH.HUDDLE && !paused && !replay.on;
    if (call.open && replay.on) closeCall();
    if (pending && !call.open) openCall(false);
    if (call.open && !pending && !call.audible) closeCall();
    if (call.open && call.audible && !canAudible()) closeCall();
    cs.root.hidden = !call.open;
    if (call.open) {
      drawCall();
      const dist = gs.firstDownMark >= 100 ? "GOAL" : Math.max(1, Math.ceil(gs.toGo));
      cs.sit.textContent = ordinal(gs.down) + " & " + dist + "  ·  " + spotText(gs.ballOn) + (call.audible ? "  ·  AUDIBLE" : "");
      const left = Math.max(0, Math.ceil(D.PLAY_CALL_SECONDS - gs.callT));
      cs.clock.hidden = !gs.callPending;
      cs.clock.firstChild.textContent = left;
      cs.clock.classList.toggle("low", left <= 5);
    }
    // The chip: the current call, and the way back into the call screen.
    const pre = gs.phase === PH.HUDDLE || gs.phase === PH.HUDDLE_BREAK || gs.phase === PH.PRE_SNAP;
    const chip = human && !call.open && pre && !gs.callPending && !paused && !replay.on;
    cs.chip.hidden = !chip;
    if (chip) {
      const side = gs.offense === humanTeam ? "off" : "def";
      cs.chipSide.textContent = side === "off" ? "PLAY" : "DEFENSE";
      cs.chipName.textContent = book(side)[currentCall(side)].name;
      cs.chipKey.textContent = canAudible() ? (isTouch ? "TAP · AUDIBLE" : "B · AUDIBLE") : "";
      cs.chip.classList.toggle("def", side === "def");
    }
  }
  // Tapping the field outside the call screen keeps the current call on an audible.
  $("view").addEventListener("pointerdown", function () { if (call.open && call.audible) closeCall(); });

  let bannerT = 0;
  function banner(text, color, big, secs) {
    hud.banner.querySelector("span").textContent = text;
    hud.banner.style.setProperty("--bc", color || "#ffcf5a");
    hud.banner.classList.toggle("big", !!big);
    hud.banner.classList.add("on");
    bannerT = secs || 1.6;
  }

  function ordinal(n) { return ["", "1ST", "2ND", "3RD", "4TH"][n] || n + "TH"; }
  function nick(e) {
    if (!e) return "";
    const c = D.CHARACTERS[D.TEAMS[e.team].id][e.char];
    return c ? c.label.toUpperCase() : "";
  }
  function spotText(y) {
    const r = Math.round(y);
    if (r === 50) return "MIDFIELD";
    return r < 50 ? "OWN " + r : "OPP " + (100 - r);
  }

  let lastHint = "";
  function syncHud(dt) {
    const s = Math.max(0, Math.ceil(gs.clock));
    hud.clock.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    hud.quarter.textContent = gs.phase === PH.GAME_OVER ? "FINAL" : "Q" + Math.min(gs.quarter, 4);
    [hud.away, hud.home].forEach(function (el, i) {
      el.querySelector(".sc").textContent = gs.score[i];
      el.classList.toggle("has", gs.offense === i);
    });
    const you = gs.offense === humanTeam ? "YOUR BALL" : (humanTeam < 0 ? D.TEAMS[gs.offense].name.toUpperCase() + " BALL" : "CPU BALL");
    const dist = gs.firstDownMark >= 100 ? "GOAL" : Math.max(1, Math.ceil(gs.toGo));
    hud.downs.textContent = ordinal(gs.down) + " & " + dist + "  ·  " + spotText(gs.ballOn) + "  ·  " + you;

    if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) hud.banner.classList.remove("on"); }
    const fl = gs.flashT > 0 && gs.message === gs.flashMsg;
    hud.flash.classList.toggle("on", fl);
    if (fl) hud.flash.textContent = gs.flashMsg;

    // The camera frames the play above the call screen while it is up.
    syncCall();
    view.insetBottom = call.open ? Math.max(0, window.innerHeight - cs.root.getBoundingClientRect().top) : 0;
    view.callFocus = call.open ? call.side : null;

    let hint;
    const mine = gs.offense === humanTeam;
    const rp = !isTouch && canReplay() ? "  ·  R replay" : "";
    if (replay.on) hint = "";
    else if (humanTeam < 0) hint = "Demo — CPU vs CPU";
    else if (call.open) hint = "";
    else if (gs.phase === PH.PRE_SNAP && mine) hint = isTouch ? "" : "SPACE snap  ·  X flip  ·  B audible  ·  C camera" + rp;
    else if (gs.phase === PH.PRE_SNAP || gs.phase === PH.HUDDLE || gs.phase === PH.HUDDLE_BREAK) hint = mine ? "" : (isTouch ? "" : "B audible  ·  you'll steer the defender closest to the ball" + rp);
    else if (gs.phase === PH.LIVE && mine && gs.loose) hint = "FUMBLE! Run to the ball";
    else if (gs.phase === PH.LIVE && mine && gs.ball.inFlight) hint = isTouch ? "Steer him under it  ·  HIGH POINT to go up for it" : "Arrows steer the receiver  ·  SHIFT high-point";
    else if (gs.phase === PH.LIVE && mine && Sim.canHumanThrow(gs)) hint = isTouch ? "TAP a number: touch pass  ·  HOLD: bullet" : "TAP 1 / 2 / 3 touch pass  ·  HOLD bullet  ·  4 pitch  ·  SHIFT juke  ·  Q spin";
    else if (gs.phase === PH.LIVE && mine) hint = isTouch ? "" : "Arrows run  ·  SHIFT juke  ·  Q spin  ·  SPACE hurdle (twice: corkscrew)";
    else if (gs.phase === PH.LIVE) hint = isTouch ? "" : "Steer the cyan-ring defender  ·  F dive (near a pass: play the ball)";
    else hint = rp ? rp.slice(5) : "";
    if (hint !== lastHint) { hud.hint.textContent = hint; hud.hint.style.opacity = hint ? "1" : "0"; lastHint = hint; }
  }

  // Throw targets over the receivers' heads.
  const badgeEls = {};
  ["WR1", "WR2", "TE"].forEach(function (slot, i) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "badge";
    b.textContent = String(i + 1);
    b.setAttribute("aria-label", "Throw to " + slot);
    b.addEventListener("mousedown", function (e) { e.preventDefault(); });
    // Tap = touch pass, press and hold = bullet (see throwDown).
    b.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      if (gs && gs.phase === PH.LIVE) throwDown(i + 1);
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (t) {
      b.addEventListener(t, function () { throwUp(i + 1); });
    });
    b.hidden = true;
    hud.badges.appendChild(b);
    badgeEls[slot] = b;
  });
  function syncBadges() {
    const show = humanTeam >= 0 && gs.offense === humanTeam && !paused && !call.open && !replay.on &&
      (gs.phase === PH.PRE_SNAP || Sim.canHumanThrow(gs));
    ["WR1", "WR2", "TE"].forEach(function (slot) {
      const b = badgeEls[slot];
      const e = show ? gs.entities.find(function (x) { return x.slot === slot; }) : null;
      if (!e || e === gs.carrier) { b.hidden = true; return; }
      const st = view.rigs[e.team][e.char];
      const p = view.project(st.pos.x, st.rig.height + 0.35, st.pos.z);
      if (p.behind) { b.hidden = true; return; }
      b.hidden = false;
      b.style.left = p.x + "px";
      b.style.top = p.y + "px";
      let sep = Infinity;
      gs.entities.forEach(function (d) { if (d.side === "def" && !(d.downT > 0)) sep = Math.min(sep, Math.hypot(d.x - e.x, d.y - e.y)); });
      const live = gs.phase === PH.LIVE;
      b.classList.toggle("open", live && sep >= D.CONTEST_RADIUS * 0.7);
      b.classList.toggle("covered", live && sep < D.CONTEST_RADIUS * 0.35);
      b.classList.toggle("dim", !live);
      // Held long enough for a bullet: the badge flashes hot.
      const n = ["WR1", "WR2", "TE"].indexOf(slot) + 1;
      b.classList.toggle("holding", !!throwHold && throwHold.n === n);
      b.classList.toggle("bullet", !!throwHold && throwHold.n === n && throwHold.fired);
    });
  }

  // Context buttons on a phone.
  let actsKey = "";
  function syncTouch() {
    if (!isTouch) return;
    let set = [];
    const mine = gs.offense === humanTeam;
    const pre = gs.phase === PH.HUDDLE || gs.phase === PH.HUDDLE_BREAK || gs.phase === PH.PRE_SNAP ||
      gs.phase === PH.BETWEEN_DOWNS || gs.phase === PH.DEAD_BALL || gs.phase === PH.TURNOVER;
    if (paused || replay.on || gs.phase === PH.GAME_OVER || call.open) set = [];
    else if (gs.phase === PH.PRE_SNAP && mine) set = [["flip", "FLIP", ""], ["snap", "SNAP", "main"]];
    else if (gs.phase === PH.HALFTIME) set = [["snap", "GO", "main"]];
    else if (gs.phase === PH.LIVE && mine && gs.ball.inFlight) set = [["highpoint", "HIGH POINT", "main"]];
    else if (gs.phase === PH.LIVE && mine && gs.carrier) {
      if (gs.carrier.role === "qb" && Sim.canHumanThrow(gs)) set = [["juke", "JUKE", ""], ["spin", "SPIN", ""], ["pitch", "PITCH", ""]];
      else set = [["juke", "JUKE", ""], ["spin", "SPIN", ""], ["hurdle", "HURDLE", "main"]];
    } else if (gs.phase === PH.LIVE && !mine) set = [["tackle", "DIVE", "main def"]];
    if (!set.length && pre && !paused && !replay.on && !call.open && canReplay()) set = [["replay", "REPLAY", "rp"]];
    const key = set.map(function (s) { return s[0]; }).join(",");
    if (key === actsKey) return;
    actsKey = key;
    hud.acts.innerHTML = "";
    set.forEach(function (s) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "act " + s[2];
      b.textContent = s[1];
      b.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        if (s[0] === "replay") { if (canReplay()) startReplay(false); return; }
        tap[s[0]] = true;
      });
      hud.acts.appendChild(b);
    });
  }

  // ---- fades between plays ----
  let fadeIn = 0;
  function phaseLength(p) {
    const T = D.PHASE_TIME;
    return p === PH.BETWEEN_DOWNS ? T.BETWEEN_DOWNS : p === PH.TURNOVER ? T.TURNOVER :
      (p === PH.TOUCHDOWN || p === PH.SAFETY) ? T.TOUCHDOWN : p === PH.QUARTER_BREAK ? T.QUARTER_BREAK : p === PH.HALFTIME ? T.HALFTIME : 0;
  }
  function syncFade(dt) {
    let a = 0;
    const L = phaseLength(gs.phase);
    if (L > 0) {
      const rem = L - gs.phaseT;
      if (rem < 0.3) a = 1 - Math.max(0, rem) / 0.3;
    }
    fadeIn = Math.max(0, fadeIn - dt);
    a = Math.max(a, fadeIn / 0.4);
    hud.fade.style.opacity = String(Math.min(1, a));
    if (a > 0.05) hud.fadeLogo.src = D.TEAMS[gs.offense].mascot;
  }

  // ---- events -> sound and banners ----
  // ---- box score, for the MVP -------------------------------------------------
  let stats = {};
  let playLog = null;   // this play: who threw, who caught, who ran
  function S(e) {
    if (!e) return null;
    const k = e.team + ":" + e.char;
    return stats[k] || (stats[k] = { team: e.team, char: e.char, att: 0, comp: 0, pass: 0, passTd: 0, ints: 0,
      rush: 0, rec: 0, recs: 0, td: 0, picks: 0, tackles: 0, sacks: 0, broken: 0, recov: 0 });
  }
  function tallyWhistle(ev) {
    if (!playLog) return;
    const g = Math.round(ev.gain || 0);
    const r = String(ev.reason);
    if (r === "INTERCEPTED" || r === "INCOMPLETE" || r.indexOf("FUMBLE") === 0 && !ev.carrier) { /* no yards */ }
    else if (playLog.completed && playLog.passer && playLog.receiver) {
      S(playLog.passer).pass += g;
      S(playLog.receiver).rec += g;
    } else if (ev.carrier) {
      S(ev.carrier).rush += g;
    }
    if (ev.tackler) {
      S(ev.tackler).tackles++;
      if (ev.carrier && ev.carrier.role === "qb" && !playLog.passer && g < 0 && ev.carrier.slot === "QB") S(ev.tackler).sacks++;
    }
  }
  function mvpScore(s) {
    return s.td * 6 + s.passTd * 4 + s.pass / 12 + s.rush / 7 + s.rec / 8 + s.recs * 0.5 +
      s.picks * 6 + s.recov * 5 + s.tackles * 1.2 + s.sacks * 3 + s.broken * 0.8 - s.ints * 4;
  }
  function statLine(s) {
    const out = [];
    if (s.att) out.push(s.comp + "/" + s.att + " · " + s.pass + " PASS YDS" + (s.passTd ? " · " + s.passTd + " PASS TD" : ""));
    if (s.rush) out.push(s.rush + " RUSH YDS");
    if (s.recs) out.push(s.recs + " REC · " + s.rec + " YDS");
    if (s.td) out.push(s.td + " TD");
    if (s.picks) out.push(s.picks + " INT");
    if (s.recov) out.push(s.recov + " FUMBLE REC");
    if (s.tackles) out.push(s.tackles + " TACKLE" + (s.tackles === 1 ? "" : "S"));
    if (s.sacks) out.push(s.sacks + " SACK" + (s.sacks === 1 ? "" : "S"));
    if (s.broken) out.push(s.broken + " BROKEN TACKLE" + (s.broken === 1 ? "" : "S"));
    return out.length ? out.join("  ·  ") : "ALL HEART";
  }

  // ---- cameos: slow-mo and a close camera on the big plays --------------------
  const cineEl = $("cine");
  const STAMPS = { picked: "assets/art/picked.png", turnover: "assets/art/turnover.png", bigcatch: "assets/art/bigcatch.png", broken: "assets/art/broken.png" };
  function cameo(ent, kind) {
    if (!ent || (playLog && playLog.cameo) || replay.on) return;
    if (playLog) playLog.cameo = true;
    view.cameo(ent, kind, kind === "broken" ? 1.5 : 1.9);
    cineEl.querySelector("img").src = STAMPS[kind];
    cineEl.querySelector("b").textContent = nick(ent);
    cineEl.className = "cine on " + kind;
    cineT = kind === "broken" ? 1.5 : 1.9;
  }
  let cineT = 0;
  function syncCine(rdt) {
    if (cineT > 0) { cineT -= rdt; if (cineT <= 0) cineEl.className = "cine"; }
  }
  function highlight(kind, star) {
    if (!rec.cur) return;
    // The best thing that happened on the play decides the replay's title.
    const rank = { touchdown: 5, picked: 4, turnover: 4, bigcatch: 3, broken: 2, corkscrew: 2 };
    if (!rec.cur.highlight || rank[kind] >= rank[rec.cur.highlight]) {
      rec.cur.highlight = kind;
      if (star) rec.cur.star = star.id;
    }
  }

  function onEvents(events) {
    events.forEach(function (ev) {
      const mineOff = gs.offense === humanTeam;
      switch (ev.type) {
        case "snap":
          Audio.cue("snap");
          playLog = { passer: null, receiver: null, completed: false, cameo: false };
          break;
        case "throw":
          Audio.cue("throw");
          playLog && (playLog.passer = ev.from);
          S(ev.from).att++;
          break;
        case "catch": {
          Audio.cue("catch");
          if (playLog) { playLog.completed = true; playLog.receiver = ev.who; }
          S(ev.who).recs++;
          if (playLog && playLog.passer) S(playLog.passer).comp++;
          const big = ev.diving || ev.contested || ev.highPoint || (ev.air || 0) >= D.CATCH.BIG_CATCH_AIR;
          if (ev.diving) banner("DIVING CATCH!", "#ffcf5a", false, 1.2);
          if (big) { highlight("bigcatch", ev.who); cameo(ev.who, "bigcatch"); }
          break;
        }
        case "pitch": Audio.cue("throw"); break;
        case "juke": case "spin": Audio.cue("juke"); break;
        case "hurdle": Audio.cue("juke"); break;
        case "corkscrew": Audio.cue("juke"); banner("CORKSCREW!", "#39e0ff", false, 0.9); highlight("corkscrew", ev.who); break;
        case "flip": Audio.cue("click"); banner(ev.flipped ? "PLAY FLIPPED" : "PLAY UNFLIPPED", "#39e0ff", false, 0.8); break;
        case "broken":
          Audio.cue("thud");
          S(ev.runner).broken++;
          highlight("broken", ev.runner);
          if (playLog && !playLog.cameo) cameo(ev.runner, "broken");
          else banner("BROKEN TACKLE!", "#ffcf5a", false, 1.0);
          break;
        case "fumble": Audio.cue("hit"); banner("FUMBLE!", "#e8452c", false, 1.4); break;
        case "recover":
          if (ev.defense) {
            S(ev.who).recov++;
            highlight("turnover", ev.who);
            if (playLog) playLog.cameo = false;   // the turnover outranks anything earlier
            cameo(ev.who, "turnover");
          }
          banner(ev.defense ? "DEFENSE RECOVERS" : "OFFENSE RECOVERS", ev.defense ? "#e8452c" : "#2e9e4f", false, 1.6);
          break;
        case "intercept":
          Audio.cue(mineOff ? "groan" : "cheer");
          S(ev.who).picks++;
          if (playLog && playLog.passer) S(playLog.passer).ints++;
          highlight("picked", ev.who);
          if (playLog) playLog.cameo = false;
          cameo(ev.who, "picked");
          banner("PICKED OFF BY " + nick(ev.who) + "!", "#e8452c", true, 1.8);
          break;
        case "whistle": {
          Audio.cue("whistle");
          if (ev.tackled) Audio.cue("hit");
          tallyWhistle(ev);
          const r = String(ev.reason);
          if (r === "TOUCHDOWN") {
            banner("TOUCHDOWN " + nick(ev.carrier) + "!", D.TEAMS[gs.offense].primary, true, 2.8);
            Audio.cue("touchdown");
          } else if (r === "TACKLED" || r === "OUT OF BOUNDS" || r === "DIVING CATCH") {
            const g = Math.round(ev.gain);
            banner((r === "OUT OF BOUNDS" ? "OUT OF BOUNDS" : r) + "  ·  " + (g === 0 ? "NO GAIN" : (g > 0 ? "+" : "") + g + " YD" + (Math.abs(g) === 1 ? "" : "S")), g > 0 ? "#2e9e4f" : "#c0392b", false, 1.4);
          } else if (r === "INCOMPLETE") {
            banner("INCOMPLETE", "#9aa0a6", false, 1.3);
          } else if (r === "SAFETY") {
            banner("SAFETY!", "#e8452c", true, 2.2);
          }
          break;
        }
        case "touchdown":
          if (ev.scorer) {
            S(ev.scorer).td++;
            if (playLog && playLog.completed && playLog.passer && playLog.receiver === ev.scorer) S(playLog.passer).passTd++;
          }
          if (ev.defensive) banner("DEFENSIVE TOUCHDOWN!", D.TEAMS[ev.team].primary, true, 2.8);
          highlight("touchdown", ev.scorer);
          break;
        case "firstdown": Audio.cue("firstdown"); banner("FIRST DOWN!", "#ffcf5a", false, 1.3); break;
        case "turnover": Audio.cue("turnover"); banner(ev.reason, "#e8452c", false, 1.8); break;
        case "formation": fadeIn = 0.4; break;
        case "autocall": banner("PLAY CLOCK · COACH'S CALL", "#ffcf5a", false, 1.4); break;
        default: break;
      }
    });
  }

  let lastPhase = null;
  function onPhase() {
    if (gs.phase === lastPhase) return;
    const was = lastPhase;
    lastPhase = gs.phase;
    if (gs.phase === PH.QUARTER_BREAK) banner(gs.message, "#ffcf5a", false, 2.4);
    if (gs.phase === PH.HALFTIME) banner("HALFTIME", "#ffcf5a", true, 3.5);
    if (gs.phase === PH.GAME_OVER) { showFinal(); banner("FINAL", "#ffcf5a", true, 2.6); }
    void was;
  }

  // ---- pause, camera, sound, quality ----
  const QUALITIES = ["low", "medium", "high"];
  function setPaused(p) {
    paused = p;
    $("pause").hidden = !p;
    syncMenu();
  }
  function cycleCamera() {
    const modes = view.cameraModes();
    settings.camera = modes[(modes.indexOf(settings.camera) + 1) % modes.length];
    view.setCameraMode(settings.camera);
    saveSettings();
    syncMenu();
    banner("CAMERA: " + settings.camera.toUpperCase(), "#39e0ff", false, 0.9);
  }
  function toggleSound() {
    settings.sound = !settings.sound;
    Audio.setEnabled(settings.sound);
    saveSettings();
    syncMenu();
  }
  function syncMenu() {
    $("pCam").textContent = settings.camera.toUpperCase();
    $("pQuality").textContent = settings.quality.toUpperCase();
    $("pSound").textContent = settings.sound ? "ON" : "OFF";
    $("pReplay").textContent = settings.autoReplay ? "ON" : "OFF";
    $("btnSound").setAttribute("aria-pressed", String(settings.sound));
  }
  $("btnPause").addEventListener("click", function () { if (mode === "game") setPaused(!paused); });
  $("btnCam").addEventListener("click", function () { if (mode === "game") { if (replay.on) replayCycleCam(); else cycleCamera(); } });
  $("btnSound").addEventListener("click", toggleSound);
  $("pResume").addEventListener("click", function () { setPaused(false); });
  $("pCam").addEventListener("click", cycleCamera);
  $("pSound").addEventListener("click", toggleSound);
  $("pReplay").addEventListener("click", function () { settings.autoReplay = !settings.autoReplay; saveSettings(); syncMenu(); });
  $("pQuality").addEventListener("click", function () {
    settings.quality = QUALITIES[(QUALITIES.indexOf(settings.quality) + 1) % QUALITIES.length];
    saveSettings();
    // The yard is built for a quality level; rebuilding means a reload.
    location.reload();
  });
  $("pRestart").addEventListener("click", function () { setPaused(false); startGame(humanTeam); });
  $("pTeams").addEventListener("click", function () { setPaused(false); toSelect(); });
  $("fAgain").addEventListener("click", function () { $("final").hidden = true; startGame(humanTeam); });
  $("fTeams").addEventListener("click", function () { $("final").hidden = true; toSelect(); });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && mode === "game" && gs && gs.phase === PH.LIVE) setPaused(true);
    last = performance.now();
  });

  function showFinal() {
    const a = gs.score[0], h = gs.score[1];
    let title;
    if (humanTeam < 0) title = a === h ? "TIE GAME" : D.TEAMS[a > h ? 0 : 1].name.toUpperCase() + " WIN";
    else if (a === h) title = "TIE GAME";
    else title = (a > h ? 0 : 1) === humanTeam ? "YOU WIN!" : "CPU WINS";
    $("finalTitle").textContent = title;
    $("finalScore").innerHTML = '<span style="background:' + D.TEAMS[0].primary + '">' + a + '</span><span style="background:' + D.TEAMS[1].primary + '">' + h + "</span>";
    // The panel itself opens with the MVP scene (enterMvp), after the gun.
    Audio.cue(title === "YOU WIN!" ? "touchdown" : "groan");
  }

  // ---- team select ----
  const labels = [];
  function buildLabels() {
    const host = $("labels");
    host.innerHTML = "";
    labels.length = 0;
    view.states.forEach(function (st) {
      const el = document.createElement("div");
      el.className = "plabel";
      const team = D.TEAMS[st.team];
      const slot = D.CHAR_SLOT[st.char];
      el.innerHTML = "<b></b><span></span>";
      el.querySelector("b").textContent = D.CHARACTERS[team.id][st.char].label.toUpperCase();
      el.querySelector("span").textContent = "#" + team.numbers[slot] + " · " + slot.replace(/\d/, "");
      host.appendChild(el);
      labels.push({ el: el, st: st });
    });
  }
  function syncLabels() {
    labels.forEach(function (l) {
      // Front row (kneeling): name under the knees. Back row: over the head.
      const kneel = l.st.lineupPose !== "idle";
      const p = kneel ? view.project(l.st.pos.x, 0, l.st.pos.z + 0.45) : view.project(l.st.pos.x, l.st.rig.height + 0.15, l.st.pos.z);
      l.el.style.left = p.x + "px";
      l.el.style.top = (kneel ? p.y + 4 : p.y - 30) + "px";
      const onScreen = p.x > 20 && p.x < window.innerWidth - 20 && !p.behind;
      l.el.style.opacity = onScreen ? "1" : "0";
    });
  }
  document.querySelectorAll(".team-btn").forEach(function (b) {
    const t = parseInt(b.dataset.team, 10);
    b.addEventListener("mouseenter", function () { view && view.focusTeam(t); });
    b.addEventListener("focus", function () { view && view.focusTeam(t); });
    b.addEventListener("mouseleave", function () { view && view.focusTeam(-1); });
    b.addEventListener("click", function () { startGame(t); });
  });

  function toSelect() {
    mode = "select";
    gs = null;
    replay.on = false;
    rpEl.root.hidden = true;
    $("cine").className = "cine";
    $("hud").hidden = true;
    $("final").hidden = true;
    $("select").hidden = false;
    view.insetBottom = 0;
    closeCall();
    cs.root.hidden = true;
    cs.chip.hidden = true;
    view.showLineup(true);
    hud.fade.style.opacity = "0";
  }

  function startGame(team) {
    Audio.start();
    Audio.setEnabled(settings.sound);
    humanTeam = team;
    gs = Sim.newGame(team);
    lastPhase = null;
    stats = {};
    playLog = null;
    replay.on = false;
    rpEl.root.hidden = true;
    rec.cur = rec.last = null;
    rec.pendingAuto = false;
    view.follow(null);
    $("cine").className = "cine";
    view.showLineup(false);
    view.setCameraMode(settings.camera);
    view.cam.init = false;
    mode = "game";
    paused = false;
    $("select").hidden = true;
    $("hud").hidden = false;
    $("pause").hidden = true;
    $("final").hidden = true;
    fadeIn = 0.6;
    actsKey = "";
    closeCall();
    syncMenu();
    banner(D.TEAMS[gs.offense].name.toUpperCase() + " BALL FIRST", "#ffcf5a", false, 1.4);
  }

  // A portrait phone gets a one-time nudge to turn sideways.
  let rotateDismissed = false;
  $("rotateOk").addEventListener("click", function () { rotateDismissed = true; $("rotate").hidden = true; });
  function syncRotate() {
    const want = isTouch && mode === "game" && !rotateDismissed && window.innerHeight > window.innerWidth * 1.1;
    if ($("rotate").hidden === want) $("rotate").hidden = !want;
  }

  // ---- instant replay ---------------------------------------------------------------
  // Every play is recorded frame by frame from the snap to just after the
  // whistle (entity fields, the ball, the event feed; entity references kept
  // as ids). A replay rebuilds a stand-in game state from those frames and
  // hands it to the same renderer, with the sim paused. Big plays replay on
  // their own at the start of the next huddle (pause menu: AUTO REPLAY); any
  // play can be replayed between downs (R, or the REPLAY button).
  const rec = { cur: null, last: null, pendingAuto: false };
  const replay = { on: false, auto: false, frames: null, rgs: null, i: 0, t: 0, endT: 0, speed: 1, cam: 0, star: null };
  const REPLAY_CAMS = ["chase", "broadcast", "high", "player"];
  const REPLAY_CAM_NAME = { chase: "BEHIND", broadcast: "SIDELINE", high: "SKY CAM", player: "PLAYER CAM" };
  const REPLAY_SPEEDS = [1, 0.5, 0.25];
  const REPLAY_TITLE = { touchdown: "TOUCHDOWN", picked: "PICKED OFF", turnover: "TURNOVER", bigcatch: "BIG CATCH", broken: "BROKEN TACKLE", corkscrew: "CORKSCREW" };
  const rpEl = { root: $("replay"), title: $("rpTitle"), cam: $("rpCam"), speed: $("rpSpeed"), bar: $("rpBar") };

  function isEnt(v) { return v && typeof v === "object" && typeof v.id === "number" && v.team !== undefined && v.char !== undefined; }
  function packVal(v) { return isEnt(v) ? { __e: v.id } : v; }
  function packObj(o) {
    if (!o) return o;
    const r = {};
    for (const k in o) r[k] = packVal(o[k]);
    return r;
  }
  function recordFrame(evs, dt) {
    const live = gs.phase === PH.LIVE;
    if (live && (!rec.cur || rec.cur.done)) {
      rec.cur = { frames: [], t: 0, highlight: null, star: null, done: false };
      rec.pendingAuto = false;
    }
    const C = rec.cur;
    if (!C || C.done) return;
    if (live || (gs.phase === PH.DEAD_BALL && gs.phaseT < 1.5)) {
      C.t += dt;
      C.frames.push({
        tc: C.t, phase: gs.phase, phaseT: gs.phaseT,
        ents: gs.entities.map(packObj), ball: packObj(gs.ball), loose: gs.loose ? Object.assign({}, gs.loose) : null,
        carrier: packVal(gs.carrier), interceptor: packVal(gs.interceptor), recoveredBy: packVal(gs.recoveredBy),
        whistleCarrier: packVal(gs.whistleCarrier), controlSlot: gs.controlSlot, looseControlId: gs.looseControlId,
        passThrown: gs.passThrown, los: gs.los, firstDownMark: gs.firstDownMark, offense: gs.offense,
        events: evs.map(packObj)
      });
      if (C.frames.length > 3600) C.frames.shift();
      return;
    }
    if (gs.phase === PH.DEAD_BALL) return;   // the last beat of the whistle, not recorded
    C.done = true;
    if (C.frames.length < 20) return;
    rec.last = C;
    if (C.highlight && settings.autoReplay && humanTeam >= 0 && gs.phase !== PH.GAME_OVER) rec.pendingAuto = true;
  }

  function unpack(v, rgs) { return v && typeof v === "object" && v.__e !== undefined ? rgs.byId[v.__e] : v; }
  function restoreFrame(rgs, fr) {
    fr.ents.forEach(function (o, i) {
      const e = rgs.entities[i];
      for (const k in e) if (!(k in o)) delete e[k];
      for (const k in o) e[k] = unpack(o[k], rgs);
    });
    rgs.ball = {};
    for (const k in fr.ball) rgs.ball[k] = unpack(fr.ball[k], rgs);
    rgs.loose = fr.loose;
    ["carrier", "interceptor", "recoveredBy", "whistleCarrier"].forEach(function (k) { rgs[k] = unpack(fr[k], rgs) || null; });
    ["phase", "phaseT", "controlSlot", "looseControlId", "passThrown", "los", "firstDownMark", "offense"].forEach(function (k) { rgs[k] = fr[k]; });
    fr.events.forEach(function (o) {
      const r = {};
      for (const k in o) r[k] = unpack(o[k], rgs);
      rgs.events.push(r);
    });
  }
  function canReplay() {
    return mode === "game" && !!rec.last && !replay.on && !!gs && !paused &&
      gs.phase !== PH.LIVE && gs.phase !== PH.GAME_OVER;
  }
  function startReplay(auto) {
    const P = rec.last;
    if (!P) return;
    const f0 = P.frames[0];
    const rgs = { entities: f0.ents.map(function (o) { return { id: o.id }; }), byId: {}, ball: {}, events: [], scoredBy: null };
    rgs.entities.forEach(function (e) { rgs.byId[e.id] = e; });
    restoreFrame(rgs, f0);
    rgs.events.length = 0;
    Object.assign(replay, { on: true, auto: auto, frames: P.frames, rgs: rgs, i: 1, t: 0, endT: 0, speed: auto ? 0.5 : 1 });
    replay.star = P.star !== null && P.star !== undefined ? rgs.byId[P.star] : null;
    if (!replay.star) {
      const last = P.frames[P.frames.length - 1];
      replay.star = unpack(last.carrier, rgs) || unpack(last.interceptor, rgs) || unpack(last.recoveredBy, rgs) || null;
    }
    replay.cam = auto ? 1 : 0;
    closeCall();
    // The bug already says INSTANT REPLAY; the tag names the big play, if any.
    rpEl.title.textContent = P.highlight ? REPLAY_TITLE[P.highlight] || "" : "";
    rpEl.root.hidden = false;
    rpEl.root.classList.add("on");
    applyReplayCam();
    syncReplayButtons();
    fadeIn = 0.35;
    Audio.cue("click");
  }
  function stopReplay() {
    if (!replay.on) return;
    replay.on = false;
    view.follow(null);
    view.setCameraMode(settings.camera);
    view.cam.init = false;
    rpEl.root.hidden = true;
    rpEl.root.classList.remove("on");
    call.drawn = "";
    actsKey = "";
    fadeIn = 0.35;
  }
  function applyReplayCam() {
    const m = REPLAY_CAMS[replay.cam];
    view.setCameraMode(m === "player" ? "chase" : m);
    view.follow(m === "player" ? replay.star : null);
    view.cam.init = false;
  }
  function syncReplayButtons() {
    const m = REPLAY_CAMS[replay.cam];
    rpEl.cam.textContent = "CAM: " + REPLAY_CAM_NAME[m];
    const s = replay.speed;
    rpEl.speed.textContent = s === 1 ? "1×" : s === 0.5 ? "½×" : "¼×";
  }
  function replayRestart() {
    const P = rec.last;
    replay.rgs.events.length = 0;
    restoreFrame(replay.rgs, P.frames[0]);
    replay.rgs.events.length = 0;
    replay.i = 1;
    replay.t = 0;
    replay.endT = 0;
    if (REPLAY_CAMS[replay.cam] === "player") view.follow(replay.star);
    view.cam.init = false;
    // A fresh entities array makes the renderer reset its poses.
    replay.rgs.entities = replay.rgs.entities.slice();
  }
  function replayCycleCam() { replay.cam = (replay.cam + 1) % REPLAY_CAMS.length; applyReplayCam(); syncReplayButtons(); }
  function replaySpeed() {
    replay.speed = REPLAY_SPEEDS[(REPLAY_SPEEDS.indexOf(replay.speed) + 1) % REPLAY_SPEEDS.length];
    syncReplayButtons();
  }
  function replayKey(k) {
    if (k === "r" || k === "ArrowLeft") replayRestart();
    else if (k === "c" || k === "ArrowUp") replayCycleCam();
    else if (k === "s" || k === "ArrowDown") replaySpeed();
    else if (k === " " || k === "Enter" || k === "Escape" || k === "b" || k === "Backspace" || k === "x") stopReplay();
    else return k !== "m";
    return true;
  }
  $("rpRestart").addEventListener("click", replayRestart);
  $("rpCam").addEventListener("click", replayCycleCam);
  $("rpSpeed").addEventListener("click", replaySpeed);
  $("rpDone").addEventListener("click", stopReplay);
  ["rpRestart", "rpCam", "rpSpeed", "rpDone"].forEach(function (id) { $(id).addEventListener("mousedown", function (e) { e.preventDefault(); }); });

  function replaySounds(evs) {
    evs.forEach(function (ev) {
      if (ev.type === "snap" || ev.type === "throw" || ev.type === "catch") Audio.cue(ev.type);
      else if (ev.type === "whistle") { Audio.cue("whistle"); if (ev.tackled) Audio.cue("hit"); }
      else if (ev.type === "broken") Audio.cue("thud");
      else if (ev.type === "juke" || ev.type === "spin" || ev.type === "hurdle" || ev.type === "corkscrew") Audio.cue("juke");
    });
  }
  function stepReplay(dt) {
    const R = replay;
    const sdt = dt * R.speed;
    R.t += sdt;
    while (R.i < R.frames.length && R.frames[R.i].tc <= R.t) { restoreFrame(R.rgs, R.frames[R.i]); R.i++; }
    replaySounds(R.rgs.events);
    view.render(R.rgs, sdt, humanTeam, dt);
    rpEl.bar.style.width = (100 * Math.min(1, R.t / R.frames[R.frames.length - 1].tc)) + "%";
    if (R.i >= R.frames.length) {
      R.endT += dt;
      // An auto replay ends itself; a requested one holds on the last frame
      // for a beat, then ends too (tap ⟲ to watch it again first).
      if (R.endT > (R.auto ? 0.9 : 1.6)) stopReplay();
    }
  }

  // ---- the MVP, after the final gun -----------------------------------------------------
  function pickMvp() {
    const a = gs.score[0], h = gs.score[1];
    const winner = a === h ? -1 : (a > h ? 0 : 1);
    let best = null, bestS = -Infinity;
    Object.keys(stats).forEach(function (k) {
      const s = stats[k];
      if (winner >= 0 && s.team !== winner) return;
      const v = mvpScore(s);
      if (v > bestS) { bestS = v; best = s; }
    });
    const team = winner >= 0 ? winner : (best ? best.team : 0);
    return best || S({ team: team, char: "utility_1", id: -1 });
  }
  function enterMvp() {
    const m = pickMvp();
    const team = D.TEAMS[m.team];
    const name = D.CHARACTERS[team.id][m.char].label.toUpperCase();
    $("mvpName").textContent = name;
    $("mvpTeam").textContent = team.name.toUpperCase() + "  ·  #" + team.numbers[D.CHAR_SLOT[m.char]];
    $("mvpTeam").style.setProperty("--tc", team.primary);
    $("mvpStats").textContent = statLine(m);
    stopReplay();
    closeCall();
    mode = "mvp";
    $("hud").hidden = true;
    hud.fade.style.opacity = "0";
    $("cine").className = "cine";
    view.showMvp(m.team, m.char);
    $("final").hidden = false;
  }

  // ---- adaptive resolution: hold ~45fps on slow machines ----
  let perfAcc = 0, perfN = 0;
  function perf(dt) {
    perfAcc += dt;
    perfN++;
    if (perfAcc < 2.5) return;
    const avg = perfAcc / perfN;
    perfAcc = 0;
    perfN = 0;
    if (avg > 1 / 38 && view.pixelRatio > 0.7) view.setPixelRatio(Math.max(0.7, view.pixelRatio - 0.2));
  }

  // ---- the loop ----
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    dt = Math.min(Math.max(dt, 0), D.MAX_DT);
    if (mode === "select") {
      view.renderLineup(dt);
      syncLabels();
      perf(dt);
      return;
    }
    if (mode === "mvp") {
      view.renderMvp(dt);
      perf(dt);
      return;
    }
    if (mode !== "game") return;
    const input = readInput();
    // A big play: the sim and the animation run in slow motion for the cameo.
    const ts = paused ? 0 : view.timeScale();
    if (replay.on) {
      if (!paused) stepReplay(dt); else view.render(replay.rgs, 0, humanTeam, 0);
    } else {
      if (!paused) Sim.update(gs, dt * ts, input);
      const evs = gs.events ? gs.events.slice() : [];
      const events = view.render(gs, dt * ts, humanTeam, paused ? 0 : dt);
      onEvents(events);
      if (!paused) recordFrame(evs, dt * ts);
      onPhase();
      // Last play's highlight, as the next huddle starts.
      if (rec.pendingAuto && !paused && gs.phase === PH.HUDDLE) { rec.pendingAuto = false; startReplay(true); }
      if (gs.phase === PH.GAME_OVER && gs.phaseT > 2.6) enterMvp();
    }
    if (mode !== "game") return;
    syncCine(paused ? 0 : dt);
    syncHud(dt);
    syncBadges();
    syncTouch();
    syncFade(dt);
    syncRotate();
    Audio.tick(dt);
    perf(dt);
  }

  window.addEventListener("resize", function () { if (view) view.resize(); });

  // ---- boot ----
  function boot() {
    try {
      view = new window.TBView.View($("view"), { quality: settings.quality });
    } catch (e) {
      showError("Could not start 3D: " + (e && e.message ? e.message : e));
      throw e;
    }
    view.setCameraMode(settings.camera);
    buildLabels();
    $("loadFill").style.width = "100%";
    $("loading").classList.add("done");
    setTimeout(function () { $("loading").hidden = true; }, 700);
    const t = Q.get("team");
    if (Q.has("demo")) startGame(-1);
    else if (t === "0" || t === "1") startGame(parseInt(t, 10));
    else {
      toSelect();
      if (!Q.has("nosplash")) {
        const sp = $("splash");
        sp.hidden = false;
        $("spPlay").addEventListener("click", function () {
          sp.classList.add("out");
          setTimeout(function () { sp.hidden = true; }, 400);        });
      }
    }
    syncMenu();
    last = performance.now();
    requestAnimationFrame(frame);
  }
  $("loadFill").style.width = "35%";
  // Two frames so the loading screen is painted before the heavy build.
  requestAnimationFrame(function () { requestAnimationFrame(boot); });

  window.TB3D = {
    state: function () { return gs; },
    view: function () { return view; },
    start: startGame,
    select: toSelect,
    pause: setPaused,
    camera: function (m) { settings.camera = m; view.setCameraMode(m); },
    // Test hook: advance the sim by `secs` in fixed steps with the given input.
    // Test hook: drive the call screen like a player would (a key name).
    key: function (k) { return callKey(k); },
    replay: function (on) { if (on === false) stopReplay(); else if (canReplay()) startReplay(!!on); return replay.on; },
    replayKey: function (k) { return replayKey(k); },
    mvp: function () { enterMvp(); },
    cameo: function (kind, slot) {
      const e = gs.entities.find(function (x) { return x.slot === (slot || "QB"); }) || gs.carrier;
      if (playLog) playLog.cameo = false;
      cameo(e, kind || "bigcatch");
    },
    stats: function () { return stats; },
    // Same as step, without drawing every frame (software GL is slow): for tests.
    fast: function (secs, input) {
      view.noDraw = true;
      try { return window.TB3D.step(Math.max(0, secs - 1 / 30), input); } finally { view.noDraw = false; }
    },
    step: function (secs, input) {
      const inp = Object.assign({ x: 0, y: 0, play: -1, defPlay: -1 }, input || {});
      for (let t = 0; t < secs; t += 1 / 60) {
        // A call made through the call screen (TB3D.key) reaches the sim here.
        if (pendingPlay >= 0) { inp.play = pendingPlay; pendingPlay = -1; }
        if (pendingDef >= 0) { inp.defPlay = pendingDef; pendingDef = -1; }
        if (replay.on) { stepReplay(1 / 60); continue; }
        Sim.update(gs, 1 / 60, inp);
        const evs = gs.events ? gs.events.slice() : [];
        const ev = view.render(gs, 1 / 60, humanTeam);
        onEvents(ev);
        recordFrame(evs, 1 / 60);
        onPhase();
        inp.snap = inp.throw1 = inp.throw2 = inp.throw3 = inp.juke = inp.spin = inp.hurdle = inp.flip = inp.tackle = false;
        inp.play = inp.defPlay = -1;
        syncFade(1 / 60);
        syncHud(1 / 60);
      }
      syncBadges();
      return { phase: gs.phase, msg: gs.message, score: gs.score.slice() };
    }
  };
})();
