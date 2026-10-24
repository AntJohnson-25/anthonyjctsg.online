// Cornhole, arcade edition (anthonyjctsg.online). Solo against the computer: you and, in 2v2, a computer partner
// against computer opponents, all played by the cookout cast (rigged Meshy characters in assets/chars/).
// The sim runs here alone as its own host; there is no network. The title menu picks your player and the rules.
globalThis.SB = globalThis.SB || {};
(function (SB) {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const CH = SB.Cornhole;

  // The CTSG universe: Ant, the Dodge It athletes and the Wealth Runner 2 runners (assets/chars/<id>.glb + .png card).
  const CAST = [
    { id: "ant", name: "Ant", blurb: "The man himself. Black tracksuit, white zip, never rattled." },
    { id: "marcus", name: "Marcus", blurb: "Dodge It's smoothest athlete, with a smooth release to match." },
    { id: "diego", name: "Diego", blurb: "Fresh fade, light stubble, plenty of confidence." },
    { id: "kenji", name: "Kenji", blurb: "Steady hands and a textured cut that never moves." },
    { id: "sofia", name: "Sofia", blurb: "Ponytail up. Competitive since the first toss." },
    { id: "priya", name: "Priya", blurb: "Braid down her back and deadly accurate." },
    { id: "jada", name: "Jada", blurb: "Afro puffs and a flawless underhand." },
    { id: "darius", name: "Darius", blurb: "Wealth Runner 2's sharpest dresser, now on the turf." },
    { id: "tyler", name: "Tyler", blurb: "Polo tucked in and ready for anything." },
    { id: "jade", name: "Jade", blurb: "Business casual. Cold-blooded closer." },
    { id: "brooke", name: "Brooke", blurb: "Ponytail, polo and a killer arm." }
  ];
  // Graphics presets, in the shape view.js's applyGraphics reads.
  const GFX = {
    low: { shadows: "off", pixelRatio: 0.85, particles: 0.4, drawDistance: 0.7, adaptive: true },
    medium: { shadows: "hard", pixelRatio: 1, particles: 1, drawDistance: 1 },
    high: { shadows: "soft", pixelRatio: 1.5, particles: 1, drawDistance: 1 }
  };
  // A phone or tablet (a coarse pointer) starts on Low; the choice is remembered once made, and the render scale also adapts to the frame rate.
  const COARSE = !!(globalThis.matchMedia && matchMedia("(pointer: coarse)").matches);
  const DEFAULTS = { char: "ant", mode: "1v1", target: "15", rival: "1", gfx: COARSE ? "low" : "medium", guide: true, sound: true };
  const STORE = "cornhole.arcade", AUTO = "cornhole.autostart", BACK = "cornhole.back";
  const S = { sim: null, mode: "menu", last: 0, now: 0, hold: false, manual: false, aimT: 0, endT: -1, ended: false, guide: true, names: ["", ""], players: [] };
  let cfg = load();

  function load() {
    let c = {};
    try { c = JSON.parse(localStorage.getItem(STORE) || "{}") || {}; } catch (e) { /* storage blocked */ }
    const q = new URLSearchParams(location.search);
    for (const k of ["char", "mode", "target", "rival", "gfx"]) if (q.has(k)) c[k] = q.get(k);
    return Object.assign({}, DEFAULTS, c);
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) { /* storage blocked */ } }
  function progress(f, msg) {
    $("ld-fill").style.width = Math.round(f * 100) + "%";
    if (msg) $("ld-msg").textContent = msg;
  }
  function loadImg(src) {
    return new Promise(function (res) { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  }
  function teamName(sim, side) {
    const n = sim.team[side].map((i) => sim.players[i].name);
    return n.join(" & ");
  }
  const castOf = (id) => CAST.find((c) => c.id === id) || CAST[0];

  // ------------------------------------------------------------------ title menu
  function menu() {
    const box = $("cast");
    box.innerHTML = "";
    CAST.forEach(function (c) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "c"; b.dataset.id = c.id;
      b.innerHTML = '<img src="assets/chars/' + c.id + '.png" alt=""><b>' + c.name + "</b>";
      b.title = c.blurb;
      b.addEventListener("click", function () { cfg.char = c.id; save(); mark(); });
      box.appendChild(b);
    });
    document.querySelectorAll(".seg").forEach(function (seg) {
      seg.querySelectorAll("button").forEach(function (b) {
        b.addEventListener("click", function () { cfg[seg.dataset.key] = b.dataset.v; save(); mark(); });
      });
    });
    $("btnPlay").addEventListener("click", function () { play(); });
    $("landPlay").addEventListener("click", function () { SB.Audio.init(); $("landing").classList.add("hidden"); $("menu").classList.remove("hidden"); });
    mark();
  }
  function mark() {
    document.querySelectorAll("#cast .c").forEach((b) => b.classList.toggle("on", b.dataset.id === cfg.char));
    const me = castOf(cfg.char);
    $("castInfo").innerHTML = "<b>" + me.name + "</b> " + me.blurb;
    document.querySelectorAll(".seg").forEach(function (seg) {
      seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", String(cfg[seg.dataset.key]) === b.dataset.v));
    });
  }

  // ------------------------------------------------------------------ a match
  // Seats alternate sides: you (blue), an opponent (orange), then in 2v2 your partner and the second opponent.
  // Everyone else is dealt at random from the rest of the cast.
  function seats() {
    const you = castOf(cfg.char), others = CAST.filter((c) => c.id !== you.id);
    for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
    const pick = cfg.mode === "2v2" ? [you, others[0], others[1], others[2]] : [you, others[0]];       // you, opp, partner, opp
    return pick.map((c, i) => ({ id: c.id, name: c.name, bot: i > 0, you: i === 0 }));
  }

  async function play() {
    if (S.mode !== "menu") return;
    S.mode = "load";
    $("menu").classList.add("hidden");
    $("loading").classList.remove("hidden");
    progress(0.05, "Setting up the yard…");
    S.players = seats();
    S.guide = cfg.guide !== false;
    const sim = CH.createSim({ players: S.players, target: parseInt(cfg.target, 10) || 15, difficulty: Math.max(0, Math.min(2, parseInt(cfg.rival, 10) || 0)), host: true, me: 0, seed: (Date.now() ^ 0x5bd1e995) >>> 0 });
    S.sim = sim;
    S.names = [teamName(sim, 0), teamName(sim, 1)];

    const seal = await loadImg("assets/brand/ctsg-seal-color-512.png");
    progress(0.2, "Building the lawn…");
    SB.View.init($("c"), cfg.gfx !== "low");
    SB.View.applyGraphics(GFX[cfg.gfx] || GFX.medium);
    SB.View.start(sim, S.players, { seal: seal });
    SB.View.snapCamera();
    if (SB.View.yardInfo) console.log("[yard] " + JSON.stringify(SB.View.yardInfo()));
    SB.Hud.init(sim, S.names);

    SB.Avatar.maxTex = cfg.gfx === "low" ? 1024 : 2048;                 // texture size: full on Medium and High
    progress(0.35, "Meeting the crew…");
    let done = 0;
    await Promise.all(S.players.map(async function (p, i) {
      try {
        const buf = await (await fetch("assets/chars/" + p.id + ".glb")).arrayBuffer();
        await SB.View.useAvatar(i, buf);
      } catch (e) { console.warn("character", p.name, e); }     // the plain stand-in figure plays instead
      progress(0.35 + 0.6 * (++done / S.players.length));
    }));

    SB.Input.init($("c"));
    SB.Input.dirSign = sim.dirOf(sim.me);
    wire();
    S.mode = "play";
    $("loading").classList.add("hidden");
    addEventListener("pointerdown", function () { SB.Audio.init(); }, { once: true });
    addEventListener("keydown", function () { SB.Audio.init(); }, { once: true });
    requestAnimationFrame(loop);
    setInterval(function () { if (document.hidden && S.mode === "play") { const t = performance.now(); frame(Math.min(0.1, (t - S.last) / 1000 || 0.1)); S.last = t; } }, 100);
  }

  function wire() {
    const sync = function () {
      $("btnGuide").classList.toggle("off", !S.guide);
      $("btnSound").classList.toggle("off", cfg.sound === false);
      SB.Audio.setVolume(cfg.sound === false ? 0 : 1);
    };
    $("btnGuide").addEventListener("click", function () { S.guide = !S.guide; cfg.guide = S.guide; save(); sync(); });
    $("btnSound").addEventListener("click", function () { cfg.sound = cfg.sound === false; save(); sync(); });
    const toMenu = function () { try { sessionStorage.setItem(BACK, "1"); } catch (e) { /* storage blocked */ } location.reload(); };   // straight to the menu, no splash
    $("btnMenu").addEventListener("click", toMenu);
    $("btnBack").addEventListener("click", toMenu);
    $("btnAgain").addEventListener("click", function () { try { sessionStorage.setItem(AUTO, "1"); } catch (e) { /* storage blocked */ } location.reload(); });
    sync();
  }

  function endGame() {
    if (S.ended) return;
    S.ended = true;
    const sim = S.sim, w = sim.winner;
    const mine = w >= 0 && sim.players[sim.me].side === w;
    const t = $("endTitle");
    t.textContent = w < 0 ? "GAME OVER" : mine ? "YOU WIN!" : S.names[w].toUpperCase() + " WIN";
    t.className = mine ? "" : "bad";
    $("endSub").textContent = S.names[0] + " " + sim.scores[0] + "  –  " + sim.scores[1] + " " + S.names[1];
    $("end").classList.remove("hidden");
  }

  // ------------------------------------------------------------------ events
  function onEvents(sim) {
    const events = sim.takeEvents();
    for (const e of events) {
      if (e.t === "turn" || e.t === "synced") SB.Input.cancel();
      if (e.t === "matchover") { SB.Hud.sayOver(sim); S.endT = 4.8; }
      SB.View.event(sim, e);
      SB.Audio.event(e, sim);
      SB.Hud.event(e, sim);
    }
  }

  // ------------------------------------------------------------------ the frame
  function localTurn(sim, dt) {
    const I = SB.Input;
    I.enabled = sim.myTurn();
    I.dirSign = sim.dirOf(sim.me);
    if (!I.enabled) return;
    const thr = I.update(dt);
    sim.setAim({ x: I.x, yaw: I.yaw(), pit: I.pit(), ch: I.meterP(), st: I.style });
    if (thr) sim.throw(thr, sim.me);
  }
  function frame(dt, noDraw) {
    S.now += dt;
    const sim = S.sim;
    if (!sim || S.mode !== "play") return;
    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(0.05, left); left -= h;
      localTurn(sim, h);
      sim.step(h);
      onEvents(sim);
    }
    SB.View.update(sim, dt, S.now, { guide: S.guide });
    SB.Hud.update(sim, dt, SB.Input, S);
    if (!noDraw) SB.View.render();
    if (S.endT > 0) { S.endT -= dt; if (S.endT <= 0) { S.endT = -1; endGame(); } }
  }
  function loop(t) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (t - S.last) / 1000 || 0.016);
    S.last = t;
    if (S.hold || S.manual || document.hidden) return;
    frame(dt);
  }

  // Test hooks (headless Edge drives these).
  SB.Game = {
    S: S,
    cfg: cfg,
    get sim() { return S.sim; },
    play: play,
    step: function (n, dt, noDraw) { S.manual = true; for (let i = 0; i < n; i++) frame(dt || 1 / 20, noDraw || i < n - 1); },
    advance: function (sec, step, noDraw) { step = step || 1 / 60; for (let t = 0; t < sec; t += step) frame(step, noDraw || t + step < sec); }
  };

  function start() {
    progress(1, "");
    menu();
    $("loading").classList.add("hidden");
    let auto = false, back = false;
    try { auto = sessionStorage.getItem(AUTO) === "1"; back = sessionStorage.getItem(BACK) === "1"; sessionStorage.removeItem(AUTO); sessionStorage.removeItem(BACK); } catch (e) { /* storage blocked */ }
    if (auto || new URLSearchParams(location.search).has("play")) play().catch(fail);
    else $(back ? "menu" : "landing").classList.remove("hidden");           // first visit: the title splash, then the menu
  }
  function fail(e) {
    console.error(e);
    $("loading").classList.remove("hidden");
    $("ld-msg").textContent = "Could not start: " + (e && e.message || e);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})(globalThis.SB);
