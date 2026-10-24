// Dodge It, arcade edition (anthonyjctsg.online): you and bot teammates against a bot team, 1v1 up to 5v5.
// This file runs the title menu (pick your player and the match), the pause menu and settings, the results
// screen, and the frame loop. Everyone on court is one of the six Meshy athletes in Work/assets/players: a
// hidden Mixamo body plays the clips and the athlete copies its pose (src/avatar.js).
//
// The sim still has its online plumbing (src/sim.js); here this screen is the host of a one-human match, so
// it decides everything itself and the outgoing messages are dropped.
globalThis.SB = globalThis.SB || {};
(function (SB) {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const DRIVER = "Aj";                                  // the hidden body that plays the clips for every athlete
  const ATHLETES = [
    { id: "marcus", name: "Marcus" }, { id: "diego", name: "Diego" }, { id: "kenji", name: "Kenji" },
    { id: "sofia", name: "Sofia" }, { id: "priya", name: "Priya" }, { id: "jada", name: "Jada" }
  ];
  // Graphics presets, in the shape view.js's applyGraphics reads.
  const GFX = {
    auto: { auto: true, shadows: "hard", pixelRatio: 1, level: "medium" },
    low: { shadows: "off", pixelRatio: 0.75, level: "potato", effects: false },
    medium: { shadows: "hard", pixelRatio: 1, level: "medium" },
    high: { shadows: "soft", pixelRatio: 1.5, level: "high" }
  };
  const DEFAULTS = { athlete: "marcus", size: "3", rounds: "3", level: "1", gfx: "auto", sens: 1, invertY: false, vol: 0.8, music: 0.6 };
  const STORE = "dodgeit.arcade";
  const S = { sim: null, mode: "menu", paused: false, last: 0, hold: false, manual: false, endT: -1, ended: false, lockFails: 0 };
  // A phone or tablet (touch and no mouse; ?touch=1 forces it for tests): on-screen controls, no pointer lock, Low graphics until chosen.
  const TOUCH = (function () {
    const q = new URLSearchParams(location.search);
    if (q.has("touch")) return q.get("touch") !== "0";
    const fine = !!(globalThis.matchMedia && matchMedia("(any-pointer: fine)").matches);
    return !fine && ("ontouchstart" in globalThis || (navigator.maxTouchPoints || 0) > 0);
  })();
  let cfg = load();

  function load() {
    let c = {};
    try { c = JSON.parse(localStorage.getItem(STORE) || "{}") || {}; } catch (e) { /* storage blocked */ }
    return Object.assign({}, DEFAULTS, TOUCH ? { gfx: "low" } : {}, c);
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) { /* storage blocked */ } }
  function progress(f, msg) {
    $("ld-fill").style.width = Math.round(f * 100) + "%";
    if (msg) $("ld-msg").textContent = msg;
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // ------------------------------------------------------------------ title menu
  function menu() {
    const grid = $("athletes");
    grid.innerHTML = "";
    ATHLETES.forEach(function (a) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "athlete"; b.dataset.id = a.id;
      b.innerHTML = '<img src="assets/players/' + a.id + '.png" alt=""><span>' + a.name + "</span>";
      b.addEventListener("click", function () { cfg.athlete = a.id; save(); pickMarks(); });
      grid.appendChild(b);
    });
    pickMarks();
    document.querySelectorAll("#menu [data-opt]").forEach(function (g) {
      g.querySelectorAll("button").forEach(function (b) {
        b.addEventListener("click", function () { cfg[g.dataset.opt] = b.dataset.v; save(); pickMarks(); });
      });
    });
    $("play").addEventListener("click", function () { SB.Audio.init(); go(); });
    $("menuSettings").addEventListener("click", function () { openSettings(); });
    $("menuCredits").addEventListener("click", function () { $("credits").classList.remove("hidden"); });
    $("landPlay").addEventListener("click", function () { SB.Audio.init(); $("landing").classList.add("hidden"); $("menu").classList.remove("hidden"); });
    $("loading").classList.add("hidden");
    // The title splash first; "Menu" and "Play again" (a reload) skip it, and "Play again" starts straight away.
    let back = "";
    try { back = sessionStorage.getItem("dodgeit.back") || ""; sessionStorage.removeItem("dodgeit.back"); } catch (e) { /* storage blocked */ }
    $(back ? "menu" : "landing").classList.remove("hidden");
    if (back === "again") go();
  }
  function go() {
    startMatch().catch(function (e) {
      console.error(e);
      $("ld-msg").textContent = "Could not start: " + (e && e.message || e);
    });
  }
  function pickMarks() {
    document.querySelectorAll("#athletes .athlete").forEach((b) => b.classList.toggle("on", b.dataset.id === cfg.athlete));
    document.querySelectorAll("#menu [data-opt]").forEach(function (g) {
      g.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === String(cfg[g.dataset.opt])));
    });
    const a = ATHLETES.find((x) => x.id === cfg.athlete) || ATHLETES[0];
    $("pickName").textContent = a.name;
  }

  // ------------------------------------------------------------------ settings (title and pause menus)
  function openSettings() {
    document.querySelectorAll("#settings [data-gfx]").forEach((b) => b.classList.toggle("on", b.dataset.gfx === cfg.gfx));
    $("setSens").value = cfg.sens; $("setInv").checked = !!cfg.invertY;
    $("setVol").value = cfg.vol; $("setMusic").value = cfg.music;
    $("settings").classList.remove("hidden");
  }
  function wireSettings() {
    document.querySelectorAll("#settings [data-gfx]").forEach(function (b) {
      b.addEventListener("click", function () { cfg.gfx = b.dataset.gfx; save(); openSettings(); if (S.sim) SB.View.applyGraphics(GFX[cfg.gfx]); });
    });
    $("setSens").addEventListener("input", function () { cfg.sens = +this.value; save(); applySettings(); });
    $("setInv").addEventListener("change", function () { cfg.invertY = this.checked; save(); applySettings(); });
    $("setVol").addEventListener("input", function () { cfg.vol = +this.value; save(); applySettings(); });
    $("setMusic").addEventListener("input", function () { cfg.music = +this.value; save(); applySettings(); });
    $("setDone").addEventListener("click", function () { $("settings").classList.add("hidden"); });
  }
  function applySettings() {
    SB.Input.sens = cfg.sens;
    SB.Input.invertY = !!cfg.invertY;
    SB.Audio.setVolume(cfg.vol);
    SB.Audio.setMusicVolume(cfg.music);
  }

  // ------------------------------------------------------------------ the match
  // Teams: you on Blue with bot teammates, a bot team in Gold. Nobody shows up twice on the same team, and up to
  // 3v3 nobody shows up twice at all; past that (six athletes, up to ten players) the other team repeats some.
  function lineup(size) {
    const me = ATHLETES.find((a) => a.id === cfg.athlete) || ATHLETES[0];
    const others = shuffle(ATHLETES.filter((a) => a !== me));
    const mates = others.slice(0, size - 1);
    const foes = others.slice(size - 1).concat([me], shuffle(mates.slice()));
    const teams = SB.buildTeams(["me"], size, true);
    let nm = 0, nf = 0;
    return teams.map(function (o) {
      if (!o.bot) return { name: me.name, team: o.team, kind: "local", body: DRIVER, look: me.id };
      const a = o.team === 0 ? mates[nm++] : foes[nf++];
      return { name: a.name, team: o.team, kind: "bot", body: DRIVER, look: a.id };
    });
  }

  const glbs = {};
  function fetchGlb(id) {
    if (!glbs[id]) {
      glbs[id] = (async function () {
        for (let tries = 0; ; tries++) {
          try {
            const r = await fetch("assets/players/" + id + ".glb?v=1");
            if (!r.ok) throw new Error(r.status + " " + r.statusText);
            return await r.arrayBuffer();
          } catch (e) { if (tries >= 2) throw new Error("could not load " + id + ": " + e.message); await new Promise((res) => setTimeout(res, 600 * (tries + 1))); }
        }
      })();
    }
    return glbs[id];
  }

  async function startMatch() {
    $("menu").classList.add("hidden");
    $("settings").classList.add("hidden");
    $("loading").classList.remove("hidden");
    S.mode = "load";
    const size = +cfg.size || 3, rounds = +cfg.rounds || 3, level = +cfg.level;
    const players = lineup(size);

    progress(0.05, "Loading moves…");
    await SB.Body.load([DRIVER]);
    progress(0.15, "Opening the gym…");
    const sim = SB.createSim({ players: players, host: true, seed: (Math.random() * 4294967296) >>> 0, rounds: rounds, difficulty: level });
    S.sim = sim;
    SB.View.init($("c"));
    SB.View.applyGraphics(GFX[cfg.gfx] || GFX.auto);
    SB.View.startMatch(sim);
    SB.Hud.init();
    SB.Hud.start(sim, rounds);

    const looks = Array.from(new Set(players.map((p) => p.look)));
    let done = 0;
    await Promise.all(looks.map((id) => fetchGlb(id).then(function () { progress(0.2 + 0.6 * (++done / looks.length), "Loading players " + done + "/" + looks.length + "…"); })));
    progress(0.85, "Lacing up…");
    for (let i = 0; i < players.length; i++) {
      const p = players[i], c = SB.View.chars[i];
      const ok = await SB.Body.useAvatar(c, await fetchGlb(p.look), null, { facesPlusZ: true, shirt: SB.World.TEAM_COL[p.team] }).catch(function (e) { console.warn("athlete", p.look, e); return false; });
      if (!ok) console.warn("athlete", p.look, "kept the stand-in body");
    }

    SB.Input.init($("c"), onLock);
    if (TOUCH) {
      SB.Input.initTouch();                                // the joystick, look zone and buttons; no pointer lock on a phone
      SB.Input.free = true;                                // (so a resume never asks for the lock)
      document.body.classList.add("playing");
    } else {
      SB.Input.wantLock = true;
      SB.Input.onFail = onLockFail;
    }
    const h = sim.human();
    SB.Input.yaw = h.yaw; SB.Input.pitch = h.pitch;
    applySettings();
    SB.Hud.show(true);
    S.mode = "play";
    SB.Input.active = true;
    $("loading").classList.add("hidden");
    sim.hostStart();
    if (!SB.autopilot && !TOUCH) showClick("Click to play", "Esc pauses");
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ events and results
  function onEvents(sim) {
    for (const e of sim.takeEvents()) {
      if (e.t === "matchover") { S.mode = "over"; S.endT = 3.5; }
      if (e.t === "ready" || e.t === "go") SB.Input.clearEdges();
      if (e.t === "out" && e.rev === sim.me) { const h = sim.human(); SB.Input.yaw = h.yaw; SB.Input.pitch = 0.05; }
      if (e.t === "ready") { const h = sim.human(); SB.Input.yaw = h.yaw; SB.Input.pitch = 0.05; }
      SB.View.event(sim, e);
      SB.Audio.event(e, sim);
      SB.Hud.event(e, sim);
    }
  }
  function results() {
    if (S.ended) return;
    S.ended = true;
    SB.Input.active = false;
    const sim = S.sim, me = sim.human(), w = sim.winner, won = me && me.team === w;
    if (document.pointerLockElement) document.exitPointerLock();
    $("needClick").classList.add("hidden");
    SB.Hud.show(false);
    $("resTitle").textContent = won ? "YOU WIN!" : "YOU LOSE";
    $("resTitle").className = won ? "good" : "bad";
    $("resScore").textContent = "Blue " + sim.score[0] + " – " + sim.score[1] + " Gold";
    const rows = sim.players.slice().sort((a, b) => (b.hits + b.catches) - (a.hits + a.catches));
    $("resTable").innerHTML = rows.map(function (p) {
      return '<tr class="t' + p.team + (p.kind === "local" ? " you" : "") + '"><td>' + p.name + (p.kind === "local" ? " (you)" : "") +
        "</td><td>" + p.hits + "</td><td>" + p.catches + "</td></tr>";
    }).join("");
    $("results").classList.remove("hidden");
  }
  function backToMenu(again) {
    try { sessionStorage.setItem("dodgeit.back", again ? "again" : "menu"); } catch (e) { /* storage blocked */ }
    location.reload();
  }

  // ------------------------------------------------------------------ pause and pointer lock
  function showClick(title, sub) {
    $("ncTitle").textContent = title; $("ncSub").textContent = sub || "";
    $("needClick").classList.remove("hidden");
  }
  function pause(on) {
    if (S.mode !== "play" && S.mode !== "over") return;
    S.paused = on;
    SB.Input.active = !on;
    $("pause").classList.toggle("hidden", !on);
    if (on) { $("needClick").classList.add("hidden"); if (document.pointerLockElement) document.exitPointerLock(); if (SB.Input.touchReset) SB.Input.touchReset(); }
    else { $("settings").classList.add("hidden"); S.last = performance.now(); if (!SB.Input.free) SB.Input.lock(); }
  }
  function onLock(locked) {
    if (locked) { $("needClick").classList.add("hidden"); return; }
    // Esc (or alt-tab) lets go of the mouse: pause the match
    if (S.mode === "play" && !SB.Input.free && !SB.autopilot && !S.ended) pause(true);
  }
  function onLockFail() {
    // a browser that will not give out pointer lock: fall back to the plain mouse
    if (++S.lockFails >= 2) { SB.Input.free = true; $("needClick").classList.add("hidden"); }
    else if (S.mode === "play") showClick("Click to play", "");
  }

  // ------------------------------------------------------------------ the frame
  function localInput(sim, dt) {
    const I = SB.Input;
    if (SB.autopilot) return SB.autopilot(sim, dt);
    if (I.locked || I.free || I.active) return I.sample();
    I.clearEdges();
    return { yaw: I.yaw, pitch: I.pitch, mx: 0, mz: 0, jump: false, dodge: false, fire: false, catchQ: false };
  }
  function frame(dt, noDraw) {
    const sim = S.sim;
    if (!sim || S.mode === "load") return;
    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(0.05, left); left -= h;
      S.clock = (S.clock || 0) + h;
      sim.step(h, localInput(sim, h), S.clock);
      onEvents(sim);
      sim.takeNet();
    }
    SB.View.update(sim, dt);
    SB.Hud.update(sim, dt);
    if (!noDraw) SB.View.render();
    if (S.endT > 0) { S.endT -= dt; if (S.endT <= 0) { S.endT = -1; results(); } }
  }
  function loop(t) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (t - S.last) / 1000 || 0.016);
    S.last = t;
    if (S.hold || S.manual || S.paused || document.hidden) return;
    frame(dt);
  }

  // Test hooks (headless Edge drives these).
  SB.Game = {
    S: S,
    get sim() { return S.sim; },
    start: startMatch,
    cfg: cfg,
    step: function (n, dt, noDraw) {
      S.manual = true;
      for (let i = 0; i < n; i++) frame(dt || 1 / 20, noDraw || i < n - 1);
    }
  };

  function start() {
    if (TOUCH) {
      document.body.classList.add("touch");
      $("bPause").addEventListener("pointerdown", function (e) { e.preventDefault(); e.stopPropagation(); pause(true); });
      // leaving the browser (a call, the app switcher) pauses the match
      document.addEventListener("visibilitychange", function () { if (document.hidden && S.mode === "play" && !S.ended) pause(true); });
    }
    wireSettings();
    $("resAgain").addEventListener("click", function () { backToMenu(true); });
    $("resMenu").addEventListener("click", function () { backToMenu(false); });
    $("pResume").addEventListener("click", function () { pause(false); });
    $("pSettings").addEventListener("click", openSettings);
    $("pQuit").addEventListener("click", function () { backToMenu(false); });
    $("needClick").addEventListener("click", function () { SB.Audio.init(); SB.Input.lock(); });
    addEventListener("keydown", function (e) { if (e.code === "Escape" && S.paused && $("settings").classList.contains("hidden")) pause(false); });
    addEventListener("pointerdown", function () { SB.Audio.init(); }, { once: true });
    try { menu(); } catch (e) {
      console.error(e);
      $("ld-msg").textContent = "Could not start: " + (e && e.message || e);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})(globalThis.SB);
