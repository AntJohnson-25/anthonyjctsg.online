// Wrong Door: the menu (shift select), a shift's flow, the results, and the frame loop.
globalThis.WD = globalThis.WD || {};
(function (WD) {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const Q = new URLSearchParams(location.search);
  const NOLOCK = Q.has("nolock");     // headless tests: no pointer lock to be had
  const ALL = Q.has("all");           // every shift unlocked (tests)
  const TOUCH = Q.has("touch") || (("ontouchstart" in window) && !matchMedia("(pointer: fine)").matches);
  const S = { sim: null, mode: "menu", last: 0, paused: false, pick: 1 };

  // --- saved progress + settings (a convenience only; the page works without)
  const KEY = "wrong-door";
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } }
  function save(o) { try { localStorage.setItem(KEY, JSON.stringify(Object.assign(load(), o))); } catch (e) { /* private window */ } }
  const best = () => load().best || {};
  const unlocked = (id) => ALL || id === 1 || (best()[id - 1] && best()[id - 1].stars > 0);

  function menuCards() {
    const b = best();
    $("shifts").innerHTML = WD.SHIFTS.map(function (sh) {
      const open = unlocked(sh.id), r = b[sh.id];
      const stars = [1, 2, 3].map((i) => '<i class="' + (r && r.stars >= i ? "on" : "") + '">★</i>').join("");
      return '<button class="shift' + (sh.id === S.pick ? " sel" : "") + (open ? "" : " locked") + '" data-id="' + sh.id + '"' + (open ? "" : " disabled") + '>' +
        '<span class="num">Shift ' + sh.id + '</span><b>' + sh.name + '</b><span class="stars">' + stars + '</span>' +
        '<span class="meta">' + (open ? sh.packages + " parcels · " + (sh.bldgs === 1 ? "1 building" : sh.bldgs + " buildings") + " · " + Math.round(sh.time / 60 * 10) / 10 + " min" + (r ? " · best " + r.score : "") : "Earn a star on shift " + (sh.id - 1)) + "</span></button>";
    }).join("");
    $("shiftBlurb").textContent = WD.SHIFTS[S.pick - 1].blurb;
  }

  function driverCards() {
    const cur = WD.Chars.driverId;
    $("drivers").innerHTML = WD.Chars.DRIVERS.map((d) => '<button class="drv' + (d.id === cur ? " sel" : "") + '" data-id="' + d.id + '" aria-pressed="' + (d.id === cur) + '">' +
      '<img src="assets/drivers/' + d.id + '.jpg?v=1" alt=""><b>' + d.name + "</b></button>").join("");
  }

  // --- a shift
  const TIPS = ["Downstairs is 1 to 6, upstairs is 7 to 12", "A wrong door costs 8 seconds, and maybe a dog", "Sprint outruns the dogs and the angry residents", "Gold-edged parcels are worth double, and the neighbour may keep them", "Check the handheld: the route draws itself before the clock starts"];
  // the world takes ~3 s to build: paint the loading screen first, then do the work
  function begin(id) {
    $("ldTip").textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    $("loading").classList.remove("hidden");
    setTimeout(function () { try { beginNow(id); } finally { $("loading").classList.add("hidden"); } }, 80);
  }
  function beginNow(id) {
    S.pick = id || S.pick;
    save({ pick: S.pick });
    WD.Audio.init();
    WD.Audio.setVolume(+$("optVol").value); WD.Audio.setMusicVolume(+$("optMusic").value);
    WD.Input.sens = +$("optSens").value;
    WD.detail = $("optDetail").value;   // world.js builds lighter geometry on "low"
    S.sim = WD.createSim({ shift: S.pick, seed: Q.has("seed") ? +Q.get("seed") : undefined, bot: Q.has("bot") });   // ?bot=1: the sim's own driver plays (tests)
    S.sim.start();
    WD.View.startShift(S.sim);
    WD.Input.reset(S.sim.player.yaw);
    S.mode = "play"; S.paused = false;
    ["menu", "pause", "over"].forEach((x) => $(x).classList.add("hidden"));
    WD.Hud.show(true); WD.Hud.trayKey = "";
    if (TOUCH) {
      document.body.classList.add("playing"); WD.Input.touchReset();
      try { const de = document.documentElement; if (de.requestFullscreen) de.requestFullscreen().catch(function () {}); } catch (e) { /* iPhone Safari has none */ }
    } else if (!NOLOCK) WD.Input.lock();
  }
  function toMenu() {
    S.mode = "menu"; S.paused = false;
    document.body.classList.remove("playing");
    if (document.pointerLockElement) document.exitPointerLock();
    ["pause", "over"].forEach((x) => $(x).classList.add("hidden"));
    $("menu").classList.remove("hidden");
    WD.Hud.show(false);
    menuCards();
  }

  function onEvents(sim) {
    for (const e of sim.takeEvents()) {
      WD.View.event(sim, e);
      WD.Audio.event(e, sim);
      WD.Hud.event(e, sim);
    }
  }

  function frame(dt, noDraw) {
    if (S.mode === "menu") return;   // the menu is CSS over the key art: nothing to draw
    const sim = S.sim;
    const running = (WD.Input.locked || NOLOCK || TOUCH) && !S.paused && sim.phase !== "over";
    if (running) { sim.step(dt, WD.Input.sample()); onEvents(sim); }
    WD.View.update(sim, dt);
    WD.Hud.update(sim, dt, WD.View.camera.rotation.y);
    if (!noDraw) WD.View.render();
    if (sim.phase === "over" && S.mode === "play") finish(sim);
  }
  function finish(sim) {
    S.mode = "over";
    // this machine struggled even with shadows off: build the next shifts with the lighter detail
    if (WD.View.wantLowDetail && $("optDetail").value === "high") { $("optDetail").value = "low"; save({ detail: "low" }); }
    document.body.classList.remove("playing");
    if (document.pointerLockElement) document.exitPointerLock();
    const all = sim.left() === 0, b = best(), prev = b[sim.shift.id];
    const isBest = !prev || sim.score > prev.score;
    if (all && (isBest || sim.stars > prev.stars)) { b[sim.shift.id] = { score: Math.max(sim.score, prev ? prev.score : 0), stars: Math.max(sim.stars, prev ? prev.stars : 0) }; save({ best: b }); }
    $("overKicker").textContent = "Shift " + sim.shift.id + " · " + sim.shift.name;
    $("overTitle").textContent = all ? (sim.wrong ? "Shift done" : "Clean route!") : "Out of time";
    $("overStars").innerHTML = [1, 2, 3].map((i) => '<i class="' + (sim.stars >= i ? "on" : "") + '">★</i>').join("");
    $("overStats").innerHTML =
      "<li><span>Delivered</span><b>" + sim.delivered + " / " + sim.packages.length + "</b></li>" +
      "<li><span>Wrong doors</span><b>" + sim.wrong + "</b></li>" +
      (sim.lost ? "<li><span>Kept by a resident</span><b>" + sim.lost + "</b></li>" : "") +
      "<li><span>Best combo</span><b>×" + sim.bestCombo + "</b></li>" +
      "<li><span>Time bonus</span><b>+" + sim.bonus + "</b></li>" +
      '<li class="tot"><span>Score</span><b>' + sim.score + (all && isBest ? " · best!" : "") + "</b></li>";
    $("overNote").textContent = !all ? "Every parcel has to go out to earn a star." : sim.lost ? "A resident kept a valuable parcel: one star at most. Check the gold-edged ones twice." : sim.stars < 2 ? "★★ finish with " + sim.shift.par + "s left · ★★★ and no wrong doors" : sim.stars < 3 ? "★★★: same again with no wrong doors" : "";
    const next = WD.SHIFTS[sim.shift.id];
    $("nextBtn").classList.toggle("hidden", !(next && unlocked(next.id)));
    $("over").classList.remove("hidden");
    WD.Hud.show(false);
  }

  function loop(t) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (t - S.last) / 1000 || 0.016);
    S.last = t;
    if (!S.hold) frame(dt);
  }

  function init() {
    const o = load();
    if (o.sens) $("optSens").value = o.sens;
    if (o.vol) $("optVol").value = o.vol;
    if (o.music) $("optMusic").value = o.music;
    if (o.detail) $("optDetail").value = o.detail;
    $("optDetail").addEventListener("change", function () { save({ detail: $("optDetail").value }); });
    if (o.pick && unlocked(o.pick)) S.pick = o.pick;
    WD.Hud.init();
    WD.View.init($("c"));
    if (o.driver) WD.Chars.driverId = o.driver;
    WD.Chars.load();   // the Meshy people, in the background (stand-ins until they arrive)
    driverCards();
    $("drivers").addEventListener("click", function (e) {
      const b = e.target.closest(".drv");
      if (!b) return;
      WD.Chars.setDriver(b.dataset.id); save({ driver: b.dataset.id }); driverCards();
    });
    WD.Input.init($("c"), function (locked) {
      if (S.mode === "play" && !locked && !NOLOCK) { S.paused = true; $("pause").classList.remove("hidden"); }
      if (locked) { S.paused = false; $("pause").classList.add("hidden"); }
    });
    menuCards();
    $("shifts").addEventListener("click", function (e) {
      const b = e.target.closest(".shift");
      if (!b || b.disabled) return;
      S.pick = +b.dataset.id; menuCards();
    });
    $("shifts").addEventListener("dblclick", function (e) { const b = e.target.closest(".shift"); if (b && !b.disabled) begin(+b.dataset.id); });
    if (TOUCH) {
      document.body.classList.add("touch");
      $("touchNote").classList.remove("hidden");
      $("resumeBtn").textContent = "Tap to resume";
      WD.View.quality.pr = Math.min(devicePixelRatio || 1, 1.25); WD.View.resize();
      WD.Input.initTouch({ canvas: $("c"), stickBase: $("stickBase"), stickKnob: $("stickKnob"), dropBtn: $("tbDrop"), nextBtn: $("tbNext"), scanBtn: $("tbScan"), runBtn: $("tbRun"),
        active: function () { return S.mode === "play" && !S.paused; } });
      const pause = function () { if (S.mode === "play" && !S.paused) { S.paused = true; WD.Input.touchReset(); $("pause").classList.remove("hidden"); } };
      $("tbPause").addEventListener("touchstart", function (e) { e.preventDefault(); e.stopPropagation(); pause(); }, { passive: false });
      document.addEventListener("visibilitychange", function () { if (document.hidden) pause(); });
    }
    const gear = $("gearBtn"), pop = $("settings");
    gear.addEventListener("click", function (e) { e.stopPropagation(); const open = !pop.classList.contains("open"); pop.classList.toggle("open", open); gear.setAttribute("aria-expanded", open); });
    pop.addEventListener("click", function (e) { e.stopPropagation(); });
    document.addEventListener("click", function () { pop.classList.remove("open"); gear.setAttribute("aria-expanded", "false"); });
    $("startBtn").addEventListener("click", function () { begin(); });
    $("againBtn").addEventListener("click", function () { begin(); });
    $("nextBtn").addEventListener("click", function () { begin(S.pick + 1); });
    $("menuBtn").addEventListener("click", toMenu);
    $("quitBtn").addEventListener("click", toMenu);
    $("resumeBtn").addEventListener("click", function () {
      WD.Audio.init(); WD.Input.lock();
      if (TOUCH || NOLOCK) { S.paused = false; $("pause").classList.add("hidden"); }
    });
    ["optSens", "optVol", "optMusic"].forEach(function (id) {
      $(id).addEventListener("input", function () {
        WD.Input.sens = +$("optSens").value; WD.Audio.setVolume(+$("optVol").value); WD.Audio.setMusicVolume(+$("optMusic").value);
        save({ sens: $("optSens").value, vol: $("optVol").value, music: $("optMusic").value });
      });
    });
    requestAnimationFrame(loop);
    $("loading").classList.add("hidden");   // the page-load cover (in the HTML) comes off once the menu is ready
  }

  // Test hooks (headless Edge drives these).
  WD.Game = {
    S: S, begin: beginNow, toMenu: toMenu,   // tests call begin synchronously: no loading screen
    get sim() { return S.sim; },
    advance: function (sec, step, noDraw) { step = step || 1 / 60; for (let t = 0; t < sec; t += step) frame(step, noDraw || t + step < sec); }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})(globalThis.WD);
