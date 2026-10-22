// Snowball Squabble: menu, match flow, and the frame loop.
globalThis.SB = globalThis.SB || {};
(function (SB) {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const Q = new URLSearchParams(location.search);
  const NOLOCK = Q.has("nolock");     // headless tests: no pointer lock to be had
  const S = { sim: null, mode: "menu", hold: false, last: 0, now: 0, opts: null, paused: false };
  const TOUCH = Q.has("touch") || (("ontouchstart" in window) && !matchMedia("(pointer: fine)").matches);   // a phone or tablet (?touch=1 forces it)

  // --- saved settings (a convenience only; the page works without)
  function load() { try { return JSON.parse(localStorage.getItem("snowball-fight") || "{}"); } catch (e) { return {}; } }
  function save() {
    try {
      localStorage.setItem("snowball-fight", JSON.stringify({ name: $("optName").value, char: $("optChar").value, size: $("optSize").value, diff: $("optDiff").value,
        mode: $("optMode").value, rounds: $("optRounds").value, sens: $("optSens").value, vol: $("optVol").value, music: $("optMusic").value }));
    } catch (e) { /* private window */ }
  }
  function restore() {
    const o = load();
    const sel = $("optChar");
    sel.innerHTML = '<option value="">Random</option>' + SB.ROSTER.map((r) => '<option value="' + r.id + '">' + r.name + (r.tag === "spooky" ? " (spooky)" : "") + "</option>").join("");
    sel.value = "Aj";
    if (o.char !== undefined && SB.ROSTER.some((r) => r.id === o.char) || o.char === "") sel.value = o.char;
    if (o.name) $("optName").value = o.name;
    if (o.size) $("optSize").value = o.size;
    if (o.diff) $("optDiff").value = o.diff;
    if (o.mode) $("optMode").value = o.mode;
    if (Q.get("mode") === "ctf" || Q.get("mode") === "elim") $("optMode").value = Q.get("mode");   // ?mode=ctf (links, tests)
    syncMode();
    if (o.rounds) $("optRounds").value = o.rounds;
    if (o.sens) $("optSens").value = o.sens;
    if (o.vol) $("optVol").value = o.vol;
    if (o.music) $("optMusic").value = o.music;
  }

  // "First to" counts rounds in elimination and captures in capture the flag.
  function syncMode() {
    const word = $("optMode").value === "ctf" ? " captures" : " rounds";
    Array.prototype.forEach.call($("optRounds").options, function (op) { op.textContent = op.value + word; });
  }
  function options() {
    return { name: $("optName").value.trim().slice(0, 12), teamSize: +$("optSize").value, difficulty: +$("optDiff").value, winRounds: +$("optRounds").value,
      mode: $("optMode").value };
  }

  // Who plays whom: your pick (or a random one), every other fighter a different character.
  function casting(opts, pick) {
    const R = SB.ROSTER, ids = R.map((r) => r.id), tris = {};
    R.forEach((r) => { tris[r.id] = r.tris || 20000; });
    const you = pick && ids.includes(pick) ? pick : ids[Math.floor(Math.random() * ids.length)];
    const rest = ids.filter((i) => i !== you);
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = rest[i]; rest[i] = rest[j]; rest[j] = t; }
    // A weak GPU can't draw eight 50k-triangle bodies: bots are dealt in random order while the match stays under a budget.
    const want = opts.teamSize * 2 - 1, BUDGET = 230000, chosen = [];
    let sum = tris[you];
    for (const id of rest) { if (chosen.length >= want) break; if (sum + tris[id] <= BUDGET) { chosen.push(id); sum += tris[id]; } }
    for (const id of rest.slice().sort((a, b) => tris[a] - tris[b])) { if (chosen.length >= want) break; if (!chosen.includes(id)) chosen.push(id); }
    return { you: you, rest: chosen };
  }
  const nameOf = (id) => (SB.ROSTER.find((r) => r.id === id) || { name: id }).name;

  // --- a match
  function begin() {
    save();
    SB.Audio.init();
    SB.Audio.setVolume(+$("optVol").value); SB.Audio.setMusicVolume(+$("optMusic").value);
    SB.Input.sens = +$("optSens").value;
    S.opts = options();
    const cast = casting(S.opts, $("optChar").value);
    const need = [cast.you].concat(cast.rest.slice(0, S.opts.teamSize * 2 - 1));
    $("startBtn").disabled = true; $("startBtn").textContent = "Loading characters…";
    SB.Body.load(need, function (d, n) { $("startBtn").textContent = "Loading fighters " + d + "/" + n + "…"; }).then(function () { go(cast, need); }).catch(function (e) {
      $("startBtn").disabled = false; $("startBtn").textContent = "Start match";
      console.error(e); alert("Couldn't load a character: " + e.message);
    });
  }
  function go(cast, need) {
    $("startBtn").disabled = false; $("startBtn").textContent = "Start match";
    S.sim = SB.createSim(S.opts);
    S.sim.start();
    // Seat 0 is you; bots take the rest in turn and are named after their characters.
    S.sim.players.forEach(function (p, i) {
      p.body = i === 0 ? cast.you : need[i];
      if (i > 0) p.name = nameOf(p.body);
    });
    S.sim.players[0].name = S.opts.name || nameOf(cast.you);
    SB.View.startMatch(S.sim);
    SB.View.newRound();
    SB.Input.reset(0);
    S.mode = "play"; S.paused = false;
    ["menu", "pause", "over"].forEach((id) => $(id).classList.add("hidden"));
    SB.Hud.show(true);
    SB.Hud.say("", "", 0);
    if (TOUCH) {
      document.body.classList.add("playing"); SB.Input.touchReset();
      try { const de = document.documentElement; if (de.requestFullscreen) de.requestFullscreen().catch(function () {}); } catch (e) { /* iPhone Safari has none */ }
    } else if (!NOLOCK) SB.Input.lock();
  }
  function toMenu() {
    S.mode = "menu"; S.paused = false;
    document.body.classList.remove("playing");
    if (document.pointerLockElement) document.exitPointerLock();
    ["pause", "over"].forEach((id) => $(id).classList.add("hidden"));
    $("menu").classList.remove("hidden");
    SB.Hud.show(false);
  }

  function onEvents(sim) {
    const ev = sim.takeEvents();
    for (const e of ev) {
      SB.Fx.event(e);
      SB.View.event(sim, e);
      SB.Audio.event(e, sim);
      SB.Hud.event(e, sim);
      if (e.t === "round" || (e.t === "respawn" && e.id === sim.humanId)) { if (e.t === "round") SB.View.newRound(); SB.Input.reset(0); }
      if (e.t === "out" && e.id === sim.humanId) { /* spectate picks itself */ }
    }
  }

  // --- the frame
  function frame(dt, noDraw) {
    S.now += dt;
    if (S.mode === "menu") return;   // the menu is the key art (CSS); nothing to draw, so the GPU rests
    const sim = S.sim;
    const running = (SB.Input.locked || NOLOCK || TOUCH) && !S.paused && sim.phase !== "matchover";
    if (running) {
      const inp = SB.Input.sample();
      sim.step(dt, inp);
      onEvents(sim);
    } else sim.takeEvents();
    const h = sim.human();
    if (h) SB.Audio.setListener(SB.View.camera.position.x, SB.View.camera.position.z, SB.View.camera.rotation.y);
    SB.Audio.steps(sim, dt);
    SB.View.update(sim, dt, S.now);
    SB.Hud.update(sim, dt);
    if (!noDraw) SB.View.render();
    if (sim.phase === "matchover" && S.mode === "play") finish(sim);
  }
  function finish(sim) {
    S.mode = "over";
    document.body.classList.remove("playing");
    if (document.pointerLockElement) document.exitPointerLock();
    const won = sim.winner === sim.humanTeam;
    $("overKicker").textContent = sim.mode === "ctf" ? "Capture the flag · match over" : "Match over";
    $("overTitle").textContent = won ? "VICTORY" : "DEFEAT";
    $("overScore").textContent = "Blue " + sim.score[0] + "  —  " + sim.score[1] + " Red";
    $("over").classList.remove("hidden");
    SB.Hud.show(false);
  }

  function loop(t) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (t - S.last) / 1000 || 0.016);
    S.last = t;
    if (S.hold) return;
    frame(dt);
  }

  function init() {
    restore();
    SB.Hud.init();
    SB.View.init($("c"));
    SB.Input.init($("c"), function (locked) {
      if (S.mode === "play" && !locked && !NOLOCK) { S.paused = true; $("pause").classList.remove("hidden"); }
      if (locked) { S.paused = false; $("pause").classList.add("hidden"); }
    });
    $("startBtn").disabled = false; $("startBtn").textContent = "Start match";
    if (TOUCH) {
      document.body.classList.add("touch");
      $("touchNote").classList.remove("hidden");
      $("resumeBtn").textContent = "Tap to resume";
      SB.View.quality.pr = Math.min(devicePixelRatio || 1, 1.25); SB.View.resize();   // phones: fewer pixels
      SB.Input.initTouch({ canvas: $("c"), stickBase: $("stickBase"), stickKnob: $("stickKnob"), throwBtn: $("tbThrow"), rollBtn: $("tbRoll"),
        packBtn: $("tbPack"), crouchBtn: $("tbCrouch"), buildBtn: $("tbBuild"), active: function () { return S.mode === "play" && !S.paused; } });
      const pause = function () { if (S.mode === "play" && !S.paused) { S.paused = true; SB.Input.touchReset(); $("pause").classList.remove("hidden"); } };
      $("tbPause").addEventListener("touchstart", function (e) { e.preventDefault(); e.stopPropagation(); pause(); }, { passive: false });
      document.addEventListener("visibilitychange", function () { if (document.hidden) pause(); });   // switching apps pauses
    }
    // Settings & controls pop up from the gear; a click anywhere else puts them away.
    const gear = $("gearBtn"), pop = $("settings");
    gear.addEventListener("click", function (e) { e.stopPropagation(); const open = !pop.classList.contains("open"); pop.classList.toggle("open", open); gear.setAttribute("aria-expanded", open); });
    pop.addEventListener("click", function (e) { e.stopPropagation(); });
    document.addEventListener("click", function () { pop.classList.remove("open"); gear.setAttribute("aria-expanded", "false"); });
    // Start fetching your fighter while you look at the menu, so Start is quick.
    const preload = function () { const id = $("optChar").value; if (id) SB.Body.load([id]).catch(function () {}); };
    $("optChar").addEventListener("change", preload);
    preload();
    $("optMode").addEventListener("change", syncMode);
    $("startBtn").addEventListener("click", begin);
    $("againBtn").addEventListener("click", begin);
    $("menuBtn").addEventListener("click", toMenu);
    $("quitBtn").addEventListener("click", toMenu);
    $("resumeBtn").addEventListener("click", function () {
      SB.Audio.init(); SB.Input.lock();
      if (TOUCH) { S.paused = false; $("pause").classList.add("hidden"); }
    });
    ["optSens", "optVol", "optMusic"].forEach(function (id) {
      $(id).addEventListener("input", function () {
        SB.Input.sens = +$("optSens").value; SB.Audio.setVolume(+$("optVol").value); SB.Audio.setMusicVolume(+$("optMusic").value); save();
      });
    });
    // Out of the round: a tap (phone) or click (mouse) picks who to watch.
    $("c").addEventListener("touchstart", function () {
      if (S.mode !== "play" || !S.sim) return;
      const h = S.sim.human();
      if (h && !h.alive) {
        const alive = S.sim.players.filter((p) => p.alive);
        if (alive.length) { const i = alive.findIndex((p) => p.id === S.sim.spectateId); S.sim.spectateId = alive[(i + 1) % alive.length].id; }
      }
    }, { passive: true });
    document.addEventListener("mousedown", function (e) {
      if (S.mode !== "play" || !S.sim || e.button !== 0) return;
      const h = S.sim.human();
      if (h && !h.alive) {
        const alive = S.sim.players.filter((p) => p.alive);
        if (alive.length) { const i = alive.findIndex((p) => p.id === S.sim.spectateId); S.sim.spectateId = alive[(i + 1) % alive.length].id; }
      }
    });
    requestAnimationFrame(loop);
  }

  // Test hooks (headless Edge drives these).
  SB.Game = {
    S: S, begin: begin, toMenu: toMenu, options: options,
    get sim() { return S.sim; },
    // Run n seconds of game time at a fixed step, then draw once.
    advance: function (sec, step, noDraw) {
      step = step || 1 / 60;
      for (let t = 0; t < sec; t += step) frame(step, noDraw || t + step < sec);
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})(globalThis.SB);
