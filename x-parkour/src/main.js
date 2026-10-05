// X-Parkour (was Street Rivals): a three-way parkour race with fighting. You and two bots run the same street
// course (world.js: streets, containers, traffic, roofs, swing bars) to a finish line; get close to
// a rival and you can punch, kick, block or fly at them. Forward is -Z. Metres and seconds.
//
// Every runner is an "agent" (the player is driven by input, the other two by botDrive()); one
// stepAgent() runs them all, so the parkour physics, climbs and combat are identical for everyone.
// Nobody dies: a crash is a stumble (about 1.5 s lost), a fall is a respawn, a knockdown costs ~2 s.
(function (G) {
  "use strict";
  const T = window.THREE, W = G.World, A = G.Audio, PK = window.PK;
  const LANES = W.LANES;
  const V0 = 8.5, VMAX = 19, GRAV = 26, JUMPV = 9.5;
  const RACE_LEN = 1500;                      // metres to the finish line
  const FINISH_Z = -RACE_LEN;
  const JACKS_N = 3;                        // handfuls of jacks per runner per race
  // A series is best of 3, first to 2 wins, and each race is a different side of the city
  // (world.js setRoute), so the third race only happens when it is 1-1(-1).
  const RACES = [
    { name: "ROOFTOP RUN", route: "roof", pal: 0, blurb: "Containers, wall-runs and the roofs" },
    { name: "TRUCK ROUTE", route: "truck", pal: 3, blurb: "Box trucks dropping barrels" },
    { name: "THE DECIDER", route: "mixed", pal: 1, blurb: "Rooftops and trucks, after dark" }
  ];
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const FALL_AT = +params.get("fallat") || 0;          // test: the player falls at this many seconds
  const mobile = !!params.get("mobile") || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 820);
  const ROSTER = G.ROSTER;
  const COLORS = [0xffb02e, 0x36d3ff, 0xff5fd0];

  // The ladder clip faces away from the rungs compared with every other clip: turn its hips once.
  (function () {
    const c = PK.CLIPS.ladder, tr = c && c.tracks.Hips;
    if (!tr) return;
    const q = new T.Quaternion(), r = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI);
    for (let i = 0; i < tr.length; i += 4) { q.fromArray(tr, i).premultiply(r); q.toArray(tr, i); }
  })();
  // The diagonal wall run turns off the wall to the runner's right. Its mirror image (left and right
  // bones swapped, rotations reflected in the body's centre plane; the Mixamo rigs are symmetric)
  // is the kick-off to the left.
  (function () {
    const c = PK.CLIPS.diagwall;
    if (!c) return;
    const tracks = {};
    Object.keys(c.tracks).forEach(function (n) {
      const s = c.tracks[n], v = new Array(s.length);
      for (let i = 0; i < s.length; i += 4) { v[i] = s[i]; v[i + 1] = -s[i + 1]; v[i + 2] = -s[i + 2]; v[i + 3] = s[i + 3]; }
      tracks[/^Left/.test(n) ? "Right" + n.slice(4) : /^Right/.test(n) ? "Left" + n.slice(5) : n] = v;
    });
    PK.CLIPS.diagwallL = { dur: c.dur, n: c.n, tracks: tracks, hips: c.hips.map(function (v, i) { return i % 3 === 0 ? -v : v; }) };
  })();

  // ---------- renderer & scene ----------
  const canvas = $("view");
  const renderer = new T.WebGLRenderer({ canvas: canvas, antialias: !mobile, powerPreference: "high-performance" });
  let pixelMax = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2), pixelRatio = pixelMax;
  renderer.setPixelRatio(pixelRatio);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(62, 1, 0.1, 620);
  W.init(scene);
  G.Traffic.attach(scene);
  G.Traffic.onDrop = function () { g.drops = (g.drops || 0) + 1; };
  const populate = G.Traffic.populate;
  G.Traffic.populate = function (s) { g.truckZones = (g.truckZones || 0) + 1; populate(s); };
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    g.baseFov = 62 + Math.max(0, Math.min(1, (1.15 - camera.aspect))) * 38;
    camera.updateProjectionMatrix();
  }

  // ---------- game state ----------
  const g = G.game = {
    mode: "menu", t: 0, cdT: 0, timeScale: 1, shake: 0, camUp: 0, cy: 0, baseFov: 62, hint: "",
    seed: parseInt(params.get("seed") || "0", 10) || (Math.floor(Math.random() * 1e6) + 1),
    pick: 0, agents: [], player: null, finishers: 0, overT: 0, finishObj: null, auto: false, stats: { stumbles: 0, falls: 0, blocks: 0, parries: 0 }
  };
  const runners = {};
  let best = {};
  try { best = JSON.parse(localStorage.getItem("sr_best") || "{}"); if (localStorage.getItem("sr_muted") === "1") A.muted = true; } catch (e) {}

  // ---------- character loading (one script per character, only when raced) ----------
  const loadedChars = {};
  function loadChar(id) {
    if (window.CJ_CHARS && window.CJ_CHARS[id]) return Promise.resolve();
    if (loadedChars[id]) return loadedChars[id];
    return (loadedChars[id] = new Promise(function (res, rej) {
      const s = document.createElement("script");
      s.src = "src/chars/" + id + ".js";
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error("could not load " + id)); };
      document.head.appendChild(s);
    }));
  }

  // ---------- agents ----------
  const ring = (c) => { const m = new T.Mesh(new T.RingGeometry(0.62, 0.8, 32), new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9, depthWrite: false, side: T.DoubleSide })); m.rotation.x = -Math.PI / 2; m.renderOrder = 4; return m; };
  const blobGeo = new T.CircleGeometry(0.55, 18);
  function newAgent(def, lane, player, slot) {
    if (!runners[def.id]) runners[def.id] = new G.Runner(def.id);
    const runner = runners[def.id];
    scene.add(runner.root);
    const rg = ring(COLORS[slot]); scene.add(rg);
    const bl = new T.Mesh(blobGeo, new T.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.35, depthWrite: false })); bl.rotation.x = -Math.PI / 2; scene.add(bl);
    return {
      def: def, id: def.id, name: def.name, player: player, slot: slot, runner: runner, ring: rg, blob: bl,
      x: LANES[lane], tx: LANES[lane], y: 0, z: 0, vy: 0, lane: lane, laneCd: 0,
      air: false, jumped: false, coyote: 0.1, peakY: 0, dive: false, flipped: false, flipping: false, noFence: false,
      state: "idle", stateT: 0, lastGround: 0, jumpBuf: 0, slideBuf: 0, arm: null, armT: 0, climb: null, swing: null, lastHop: null,
      speed: 0, mul: 1, dist: 0, stepPhase: 0, ghost: 0, ghostZ: null, boost: 0, backTo: null, safe: { x: LANES[lane], z: 0, y: 0 },
      cd: 0, spCd: 0, atk: null, blockT: 0, blockAge: 0, blockCd: 0, chain: 0, chainT: 0, punchIdx: 0, kickIdx: 0, spIdx: 0, face: null, faceT: 0, aim: 0, aimT: 0, lift: 0,
      hits: 0, taken: 0, finished: false, finishT: 0, place: 0, jacks: JACKS_N, jackT: 0, jackWind: 0, diagReq: 0, diagReqT: 0, diags: 0,
      bot: player ? null : { skill: 0.55 + Math.random() * 0.4, aggr: 0.5 + Math.random() * 0.9, climbPref: Math.random(), react: 0.85 + Math.random() * 0.2, seen: {} },
      botDbg: ""
    };
  }
  function removeAgents() {
    g.agents.forEach(function (a) { scene.remove(a.runner.root); scene.remove(a.ring); scene.remove(a.blob); });
    g.agents = [];
  }

  // the speed the course is laid out for at a distance; rows are spaced for it, never the momentary speed
  function cruiseOf(d) { return V0 + (VMAX - V0) * (1 - Math.exp(-d / 1200)); }

  // ---------- starting a race ----------
  function pickOpponents() {
    const others = ROSTER.filter(function (r, i) { return i !== g.pick; });
    for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)), t = others[i]; others[i] = others[j]; others[j] = t; }
    return others.slice(0, 2);
  }
  g.opp = pickOpponents();
  function showVs() {
    const me = ROSTER[g.pick];
    $("vs").innerHTML = "<b>" + me.name + "</b><i>vs</i>" + g.opp.map(function (o) { return o.name; }).join("<i>·</i>");
  }
  // the series: wins, points (3/2/1 a race) and total time per slot; slot 0 is the player and the
  // rivals keep their slots for the whole series
  function newSeries() {
    const r0 = Math.max(0, Math.min(2, (parseInt(params.get("race"), 10) || 1) - 1));   // test: start at race N
    g.series = { race: r0, wins: [0, 0, 0], pts: [0, 0, 0], time: [0, 0, 0], winners: [], over: false, champ: null };
  }
  // who has won the series, or null while it is still going
  function seriesChamp(S) {
    for (let i = 0; i < 3; i++) if (S.wins[i] >= 2) return i;
    if (S.race < 3) return null;
    return [0, 1, 2].sort(function (p, q) { return S.pts[q] - S.pts[p] || S.time[p] - S.time[q]; })[0];
  }
  async function startRace() {
    if (g.loading) return;
    g.loading = true;
    A.unlock();
    show(null);
    if (!g.series || g.series.over) newSeries();
    const RC = RACES[g.series.race];
    $("loading").classList.remove("gone"); $("loading-text").textContent = "LOADING FIGHTERS";
    const defs = [ROSTER[g.pick]].concat(g.opp);
    if (params.get("trace")) document.title = "BOOT loading " + defs.map(function (d) { return d.id; }).join(",");
    try { await Promise.all(defs.map(function (d) { return loadChar(d.id); })); }
    catch (e) { $("loading-text").textContent = "COULD NOT LOAD A FIGHTER"; g.loading = false; return; }
    if (params.get("trace")) document.title = "BOOT loaded";
    removeAgents();
    g.seed = params.get("seed") ? g.seed : Math.floor(Math.random() * 1e6) + 1;
    W.setRoute(params.get("route") || RC.route, RC.pal);
    W.reset(g.seed);
    clearJacks();
    g.truckZones = 0;
    const lanes = [1, 0, 2].sort(function () { return Math.random() - 0.5; });
    if (params.get("lane")) { const L = +params.get("lane"); lanes.splice(lanes.indexOf(L), 1); lanes.unshift(L); }   // test: the player's lane
    g.agents = defs.map(function (d, i) { return newAgent(d, lanes[i], i === 0, i); });
    g.player = g.agents[0];
    g.agents.forEach(function (a) { a.runner.root.rotation.z = 0; a.runner.play("fistfight", { fade: 0, loop: true }); a.runner.update(0); });
    if (params.get("trace")) document.title = "BOOT agents built";
    W.update(0, V0, 0, 0);
    g.agents.forEach(function (a) { a.y = W.floor(a.x, 0, 99) || 0; a.lastGround = a.y; });
    g.finishers = 0; g.t = 0; g.cdT = 0; g.timeScale = 1; g.shake = 0; g.overT = 0; g.cy = g.player.y; g.camUp = 0;
    g.stats = { stumbles: 0, falls: 0, blocks: 0, parries: 0 };
    g.drops = 0; g.moveLog = {}; g.landLog = {}; g.jackLog = { thrown: 0, hit: 0 }; g.jkShown = -1;
    const S = g.series;
    $("bn-race").textContent = "RACE " + (S.race + 1) + " OF 3";
    $("bn-name").textContent = RC.name; $("bn-blurb").textContent = RC.blurb;
    $("series").innerHTML = "R" + (S.race + 1) + "/3" + S.winners.map(function (w) { return "<i style='background:#" + COLORS[w].toString(16).padStart(6, "0") + "'></i>"; }).join("");
    if (g.finishObj) { scene.remove(g.finishObj); g.finishObj = null; }
    g.agents.forEach(function (a) { place(a, 0); });
    updateCamera(0.016, true);
    g.mode = "countdown"; g.cdN = 4;
    $("hud").classList.add("on"); if (mobile) $("pad").classList.add("on");
    $("loading").classList.add("gone"); g.loading = false;
    track();
  }

  // ---------- input (player) ----------
  const P = () => g.player;
  function canAct(a) { return a.state === "run" || a.state === "start" || a.state === "slide" || a.state === "roll"; }
  function busy(a) { const s = a.state; return s === "crash" || s === "climb" || s === "swing" || s === "atk" || s === "hit" || s === "down" || s === "fell" || s === "block" || s === "done" || s === "idle"; }
  // An arrow also aims: the side you pressed is the side you hit. Sandwiched between two rivals there
  // is nowhere to go, so the arrow only aims.
  function laneMove(a, dir) {
    if (!a) return;
    a.aim = dir; a.aimT = 0.5;
    if (g.mode !== "play") return;
    if (canDiag(a)) { startDiag(a, dir); return; }                 // on a container's face: wall-run off it
    if (diagArmed(a)) { a.diagReq = dir; a.diagReqT = 0.4; return; } // about to hit one: do it on contact
    if (busy(a)) return;
    if (sandwiched(a)) { if (a.player) setHint(dir < 0 ? "◀ AIMING LEFT" : "AIMING RIGHT ▶", 0.6); return; }
    const n = Math.max(0, Math.min(2, a.lane + dir));
    if (n !== a.lane) { a.lane = n; a.tx = LANES[n]; }
  }
  function doJump(a) { if (g.mode === "play" && a.state !== "done") a.jumpBuf = 0.15; }
  function doSlide(a) {
    if (g.mode !== "play" || busy(a)) return;
    if (a.air && !a.dive) { a.dive = true; a.vy = Math.min(a.vy, -15); }
    else a.slideBuf = 0.15;
  }
  const KEYS = {
    ArrowLeft: (a) => laneMove(a, -1), KeyA: (a) => laneMove(a, -1), ArrowRight: (a) => laneMove(a, 1), KeyD: (a) => laneMove(a, 1),
    ArrowUp: doJump, KeyW: doJump, Space: doJump, ArrowDown: doSlide, KeyS: doSlide,
    KeyJ: (a) => tryAttack(a, "punch"), KeyK: (a) => tryAttack(a, "kick"), KeyL: (a) => tryAttack(a, "special"), KeyU: (a) => startBlock(a), ShiftLeft: (a) => startBlock(a), ShiftRight: (a) => startBlock(a),
    KeyI: (a) => throwJacks(a), KeyE: (a) => throwJacks(a)
  };
  window.addEventListener("keydown", function (e) {
    if (e.repeat) return;
    if (g.mode === "menu" && (e.code === "Enter" || e.code === "Space")) { e.preventDefault(); startRace(); return; }
    if (g.mode === "over" && g.overT > 1 && (e.code === "Enter" || e.code === "Space")) { e.preventDefault(); startRace(); return; }
    if (e.code === "Escape" || e.code === "KeyP") { togglePause(); return; }
    if (e.code === "KeyM") { toggleMute(); return; }
    if (g.mode === "paused" && (e.code === "Enter" || e.code === "Space")) { togglePause(); return; }
    if (HELD[e.code]) held[e.code] = true;
    const f = KEYS[e.code];
    if (f && g.player) { e.preventDefault(); A.unlock(); if (!g.auto) f(g.player); }
  });
  // an arrow held down keeps aiming that way
  const HELD = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 }, held = {};
  window.addEventListener("keyup", function (e) { if (HELD[e.code]) held[e.code] = false; });
  window.addEventListener("blur", function () { for (const k in held) held[k] = false; });
  function heldAim() { let d = 0; for (const k in held) if (held[k]) d = HELD[k]; return d; }
  // touch: swipe to move (left/right lane, up jump, down slide), buttons for the fighting
  let touch = null;
  const SWIPE = 26;
  canvas.addEventListener("pointerdown", function (e) {
    A.unlock();
    touch = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), fired: false };
    try { canvas.setPointerCapture(e.pointerId); } catch (er) {}
  });
  canvas.addEventListener("pointermove", function (e) {
    if (!touch || e.pointerId !== touch.id || !g.player || g.auto) return;
    const dx = e.clientX - touch.x, dy = e.clientY - touch.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE) return;
    if (Math.abs(dx) > Math.abs(dy)) laneMove(g.player, dx > 0 ? 1 : -1); else if (dy < 0) doJump(g.player); else doSlide(g.player);
    touch.x = e.clientX; touch.y = e.clientY; touch.fired = true;
  });
  function endTouch(e) {
    if (!touch || e.pointerId !== touch.id) return;
    if (!touch.fired && performance.now() - touch.t < 350 && g.player && !g.auto) doJump(g.player);
    touch = null;
  }
  canvas.addEventListener("pointerup", endTouch);
  canvas.addEventListener("pointercancel", function () { touch = null; });
  Array.prototype.forEach.call(document.querySelectorAll("#pad button"), function (b) {
    b.addEventListener("pointerdown", function (e) {
      e.preventDefault(); e.stopPropagation(); A.unlock();
      const a = g.player; if (!a || g.auto) return;
      const k = b.dataset.act;
      if (k === "block") startBlock(a); else if (k === "jacks") throwJacks(a); else tryAttack(a, k);
    });
  });
  ["gesturestart", "gesturechange"].forEach(function (n) { document.addEventListener(n, function (e) { e.preventDefault(); }); });
  let lastEnd = 0;
  document.addEventListener("touchend", function (e) { const n = Date.now(); if (n - lastEnd < 350) e.preventDefault(); lastEnd = n; }, { passive: false });
  document.addEventListener("touchmove", function (e) { if (e.target === canvas || e.target.closest("#pad")) e.preventDefault(); }, { passive: false });
  document.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  // ---------- feedback ----------
  function toast(text) { const el = $("toast"); el.textContent = text; el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop"); }
  // a trick: a little speed for a moment, shown to the player
  function trick(a, label) {
    a.boost = 1.6;
    if (a.player) { toast(label); A.trick(); }
  }

  // ---------- parkour (the Concrete Jungle moves, per agent) ----------
  function startSlide(a) {
    a.state = "slide"; a.stateT = 0.8;
    a.runner.play("slide", { loop: false, rate: 1.7, fade: 0.07, y: "abs" });
    if (a.player) A.slide();
  }
  function doJumpNow(a) {
    a.vy = JUMPV; a.air = true; a.jumped = true; a.coyote = 0; a.peakY = a.y; a.state = "air";
    a.jumpBuf = 0;
    a.runner.play("jump", { loop: false, rate: 1.15, fade: 0.07, y: "flat" });
    if (a.player) A.jump();
  }
  // the double jump: a stylish flip, or every other time the combat set's front twist flip
  const FLIPS = [{ clip: "flip", t0: 0.12, tEnd: 1.2, rate: 1.6, label: "FLIP" }, { clip: "twistflip", t0: 0.45, tEnd: 1.35, rate: 1.45, label: "TWIST FLIP" }];
  const FLIP_V = 8.5;
  function doFlip(a) {
    a.vy = FLIP_V; a.flipped = true; a.peakY = Math.max(a.peakY, a.y);
    a.jumpBuf = 0;
    const f = a.flipping = FLIPS[(a.flipN = (a.flipN || 0) + 1) % 2];
    a.runner.play(f.clip, { t: f.t0, rate: f.rate, loop: false, fade: 0.06, y: 93 });
    if (a.player) A.jump();
    trick(a, f.label);
  }
  function land(a, gy, obj) {
    const fallH = a.peakY - gy;
    a.y = gy; a.vy = 0; a.air = false; a.jumped = false; a.noFence = false; a.lastGround = gy;
    a.flipped = false; a.flipping = false;
    if (a.state === "crash" || a.state === "hit" || a.state === "down" || a.state === "fell") return;
    if (fallH > 2.4 || a.dive) {
      a.state = "roll"; a.stateT = 0.78;
      a.runner.play("roll", { loop: false, rate: 1.8, fade: 0.05, y: "abs" });
      if (a.player) { A.land(true); g.shake = Math.min(0.5, 0.15 + fallH * 0.04); }
    } else {
      a.state = "run";
      a.runner.play("run", { loop: true, fade: 0.1 });
      if (a.player) { A.land(false); g.shake = Math.max(g.shake, 0.08); }
    }
    a.dive = false;
    if (obj && obj !== a.lastHop) {
      if (obj.type === "car") { a.lastHop = obj; trick(a, "TRUCK SURF"); }
      else if (obj.type === "container" || obj.type === "stack" || obj.type === "wall") { a.lastHop = obj; trick(a, obj.type === "stack" ? "TOP OF THE STACK" : "CONTAINER HOP"); }
    }
  }

  // Scripted climbs: fence/brick (a clip carries the body over) and the ledge climbs (wall-run up any
  // container or building face, ladders, scaffolds) that end in a mantle onto the top.
  const CLIMB = {
    fence: { clip: "climb", t0: 0.85, tEnd: 3.2, rate: 2.2, off0: 0.55 },
    brick: { clip: "wallup", t0: 0.2, tEnd: 1.5, rate: 1.3, off0: 1.67 },
    wallrun: { ledge: true, off0: 1.67 },
    container: { ledge: true, off0: 1.67 }, stack: { ledge: true, off0: 1.67 }, wall: { ledge: true, off0: 1.67 },
    ladder: { ledge: true, off0: 1.1 }, scaffold: { ledge: true, off0: 1.1 }
  };
  const WALLISH = { wallrun: 1, container: 1, stack: 1, wall: 1 };
  const WALLRUN_RISE = 3.11;
  const MANTLE = { t0: 1.7, t1: 3.45, rise: 1.96, rate: 1.8 };
  const LADDER_V = 2.4, LADDER_RATE = 2.4;
  function nearClimb(a, range) {
    let best = null, bd = range || 14;
    for (let i = 0; i < W.slabs.length; i++) {
      const s = W.slabs[i];
      if (s.z1 < a.z && s.z1 > a.z - bd && W.slabs[i + 1] && W.slabs[i + 1].z0 < s.z1 - 0.01) bd = a.z - s.z1;   // a gap comes first
      for (let k = 0; k < s.obs.length; k++) {
        const o = s.obs[k];
        if (Math.abs(a.x - o.x) > 1.1) continue;
        const d = a.z - (o.z + o.d / 2);
        if (d > 0 && d < bd) { bd = d; best = CLIMB[o.type] ? o : null; }
      }
    }
    if (best && WALLISH[best.type] && best.type !== "wallrun" && a.y > best.base + 0.6) return null;   // standing on a crate: jump off it
    return best;
  }
  function startClimb(a, o, pr) {
    a.state = "climb"; a.air = false; a.vy = 0; a.atk = null;
    a.climb = { o: o, pr: pr, faceZ: o.z + o.d / 2, base: o.base, top: o.base + o.h, t: 0, y0: a.y };
    a.arm = null; a.jumpBuf = 0;
    if (!pr.ledge) {
      a.runner.play(pr.clip, { t: pr.t0, rate: pr.rate, loop: false, fade: 0.08, y: "abs" });
      if (a.player) A.jump();
      return;
    }
    a.tx = o.x;
    if (WALLISH[o.type]) {
      a.climb.kind = "wall";
      a.runner.play("wallup", { t: 0.2, rate: 1.35, loop: false, fade: 0.08, y: "abs" });
      if (a.player) A.jump();
      if (!o.face) {         // a container in the lane: a side pressed (or held) on contact = wall-run off it
        const dir = a.diagReqT > 0 ? a.diagReq : a.player && !g.auto ? heldAim() : botDiag(a, o);
        a.diagReq = 0; a.diagReqT = 0;
        if (dir) startDiag(a, dir);
      }
    } else {
      a.climb.kind = "ladder";
      a.climb.ly = Math.max(o.base, Math.min(a.y, a.climb.top - 1.9));
      a.runner.play("ladder", { rate: LADDER_RATE, loop: true, fade: 0.14, y: "flat" });
      if (a.player) A.grab();
    }
  }
  function climbZ(clip, t) {
    const f = Math.min(t * 30, clip.n - 1), i = Math.floor(f), k = f - i, j = Math.min(i + 1, clip.n - 1);
    return clip.hips[i * 3 + 2] * (1 - k) + clip.hips[j * 3 + 2] * k;
  }
  function stepClimb(a, dt) {
    const c = a.climb, clip = PK.CLIPS[c.pr.clip], r = a.runner;
    const target = c.faceZ + c.pr.off0 - (climbZ(clip, r.curT) - climbZ(clip, c.pr.t0)) / 100;
    if (a.z > target) a.z = Math.max(target, a.z - 16 * dt);
    a.x += Math.sign(a.tx - a.x) * Math.min(Math.abs(a.tx - a.x), 16 * dt);
    const gs = W.groundAt(a.z);
    if (gs) { a.y = W.top(gs, a.z); a.lastGround = a.y; }
    if (r.curT >= c.pr.tEnd || r.done) {
      a.y = c.o.base + c.o.h; a.vy = 0; a.air = true; a.peakY = a.y; a.jumped = true; a.noFence = true;
      a.state = "air"; a.climb = null;
      r.play("run", { loop: true, fade: 0.12, y: "flat" });
    }
  }
  function mantle(a, c) {
    c.kind = "mantle"; c.mz = a.z;
    a.runner.play("climb", { t: MANTLE.t0, rate: MANTLE.rate, loop: false, fade: 0.12, y: "abs" });
    if (a.player) A.grab();
  }
  // Diagonal wall run: jump into a container in your lane and press (or hold) a side as you hit it:
  // up the face at an angle and kick off into that lane, quicker than climbing over. Bots do it too.
  // The clip turns off the wall to the right ("diagwall"); "diagwallL" is its mirror. Clip seconds.
  const DIAG = { rate: 1.3, kick: 0.55, tEnd: 0.9, window: 0.8, bot: params.get("diag") ? +params.get("diag") : 0.5 };
  function canDiag(a) { const c = a.climb; return a.state === "climb" && !!c && c.kind === "wall" && !c.o.face && a.runner.curT < DIAG.window; }
  function diagArmed(a) { const o = a.arm; return !!o && !!WALLISH[o.type] && !o.face && canAct(a) && a.z - (o.z + o.d / 2) < 6; }
  function laneClear(l, z) {      // nothing standing in lane l where a kick-off would land
    for (let i = 0; i < W.slabs.length; i++) {
      const s = W.slabs[i];
      if (z > s.z0 + 10 || z < s.z1 - 10) continue;
      for (let k = 0; k < s.obs.length; k++) { const o = s.obs[k]; if (o.x === LANES[l] && !o.face && o.z + o.d / 2 > z - 6 && o.z - o.d / 2 < z + 1) return false; }
    }
    for (let i = 0; i < W.cars.length; i++) { const c = W.cars[i]; if (Math.abs(c.x - LANES[l]) < 1 && Math.abs(c.z - z) < c.d / 2 + 4) return false; }
    return true;
  }
  function botDiag(a, o) {        // a bot (or the test bot) wall-runs off about half the containers it climbs
    if (Math.random() >= DIAG.bot) return 0;
    const l = LANES.indexOf(o.x), z = o.z + o.d / 2;
    const ok = [-1, 1].filter(function (d) { return l + d >= 0 && l + d <= 2 && laneClear(l + d, z); });
    return ok.length ? ok[Math.floor(Math.random() * ok.length)] : 0;
  }
  function hipsAt(clip, t, axis) { // the clip's hips position (cm) on one axis at clip time t
    const f = Math.min(Math.max(0, t) * 30, clip.n - 1), i = Math.floor(f), k = f - i, j = Math.min(i + 1, clip.n - 1);
    return clip.hips[i * 3 + axis] * (1 - k) + clip.hips[j * 3 + axis] * k;
  }
  function startDiag(a, dir) {
    const c = a.climb, o = c.o, r = a.runner, l = LANES.indexOf(o.x) + dir;
    const name = dir > 0 ? "diagwall" : "diagwallL", clip = PK.CLIPS[name];
    if (l < 0 || l > 2 || !clip) return false;
    // already part way up the wallup: start the diagonal run a little way in too
    const tA = Math.min(0.4, 0.05 + Math.max(0, r.curT - 0.2) * 0.6), hA = hipsAt(clip, tA, 1), s = r.m.scale;
    c.kind = "diag"; c.clip = clip; c.dir = dir; c.tA = tA; c.e = 0; c.fwd = 0; c.kicked = false;
    c.xA = a.x; c.x1 = LANES[l]; c.yA = a.y;
    c.yOff = (r.hipsY - hA * r.m.hyScale) * s;          // the hips crossfade to the new clip's height: the body follows
    c.latEnd = -(hipsAt(clip, DIAG.tEnd, 0) - hipsAt(clip, tA, 0)) * s;
    r.play(name, { t: tA, rate: DIAG.rate, loop: false, fade: 0.1, y: hA });
    a.lane = l; a.tx = c.x1;
    if (a.player) A.jump();
    return true;
  }
  // The clip carries the body: up (a.y), along the wall into the next lane (a.x, scaled to land on the
  // lane line) and forward, but never into the container until the body is clear of it.
  function stepDiag(a, dt) {
    const c = a.climb, o = c.o, r = a.runner, clip = c.clip, s = r.m.scale, t = Math.min(r.curT, DIAG.tEnd);
    c.e += dt;
    const lat = -(hipsAt(clip, t, 0) - hipsAt(clip, c.tA, 0)) * s;
    a.x = c.xA + (c.x1 - c.xA) * Math.max(-0.15, Math.min(1, c.latEnd ? lat / c.latEnd : 1));
    const fwd = (hipsAt(clip, t, 2) - hipsAt(clip, c.tA, 2)) * s, clear = Math.abs(a.x - o.x) > o.w / 2 + 0.3;
    a.z -= Math.max(0, fwd - c.fwd) + (clear ? a.speed * 0.6 * dt : 0); c.fwd = fwd;
    if (!clear) a.z = Math.max(a.z, c.faceZ + 0.35);
    a.y = c.yA + c.yOff * Math.min(1, c.e / 0.1) + (hipsAt(clip, t, 1) - hipsAt(clip, c.tA, 1)) * r.m.hyScale * s;
    if (!c.kicked && t >= DIAG.kick) { c.kicked = true; a.diags++; trick(a, "DIAGONAL WALL RUN"); }
    if (r.curT >= DIAG.tEnd || r.done) {
      const vy = (hipsAt(clip, DIAG.tEnd, 1) - hipsAt(clip, DIAG.tEnd - 0.05, 1)) / 0.05 * r.m.hyScale * s * DIAG.rate;
      a.x = c.x1; a.lastHop = o;
      a.state = "air"; a.air = true; a.vy = vy; a.peakY = a.y; a.jumped = true; a.flipped = false; a.noFence = true; a.climb = null;
      r.play("fall", { loop: true, fade: 0.22, y: "flat" });
    }
  }
  function stepLedge(a, dt) {
    const c = a.climb, o = c.o, r = a.runner;
    if (c.kind === "diag") { stepDiag(a, dt); return; }
    c.t += dt;
    a.x += Math.sign(o.x - a.x) * Math.min(Math.abs(o.x - a.x), 8 * dt);
    const ease = Math.max(0, 1 - c.t / 0.2);
    if (c.kind === "wall") {
      const clip = PK.CLIPS.wallup, t = r.curT;
      const target = c.faceZ + 1.67 - (climbZ(clip, t) - climbZ(clip, 0.2)) / 100;
      if (a.z > target) a.z = Math.max(target, a.z - 16 * dt);
      const k = Math.min(1, Math.max(0, (t - 0.2) / 0.8));
      a.y = c.base + (c.top - c.base - WALLRUN_RISE) * k + (c.y0 - c.base) * ease;
      if (t >= 1.0) mantle(a, c);
    } else if (c.kind === "ladder") {
      a.z += (c.faceZ + 0.4 - a.z) * Math.min(1, dt * 12);
      c.ly += LADDER_V * Math.min(1, c.t / 0.2) * dt;
      a.y = c.ly;
      if (c.ly >= c.top - 1.9) mantle(a, c);
    } else {
      const clip = PK.CLIPS.climb;
      a.z = c.mz - (climbZ(clip, r.curT) - climbZ(clip, MANTLE.t0)) / 100;
      a.y = c.top - MANTLE.rise;
      if (r.curT >= MANTLE.t1 || r.done) {
        a.y = c.top; a.vy = 0; a.air = false; a.lastGround = c.top; a.peakY = c.top; a.climb = null;
        a.z = Math.min(a.z, c.faceZ - 0.3);
        a.state = "start"; a.stateT = 0.45;
        r.play("start", { t: 0.1, loop: false, fade: 0.15, y: "abs" });
        trick(a, WALLISH[o.type] ? "WALL RUN" : o.type === "ladder" ? "LADDER" : "SCAFFOLD");
      }
    }
  }
  const SWING_REL = 0.55;
  function checkSwing(a) {
    for (let i = 0; i < W.slabs.length; i++) {
      const b = W.slabs[i].bar;
      if (!b || (b.used && b.used[a.slot])) continue;
      if (a.z <= b.z + 1.25 && a.z >= b.z - 0.6 && a.y + 2.35 >= b.y - 0.15 && a.y <= b.y - 0.3) { startSwing(a, b); return true; }
    }
    return false;
  }
  function startSwing(a, b) {
    (b.used = b.used || {})[a.slot] = true;
    a.state = "swing"; a.air = false; a.vy = 0; a.arm = null; a.jumpBuf = 0; a.atk = null;
    const span = Math.max(3, a.z - b.landZ);
    const rate = Math.max(0.85, Math.min(1.8, Math.max(a.speed, 9) * 1.45 / span));
    a.swing = { b: b, z0: a.z, y0: a.y, t: 0 };
    a.runner.play("swingland", { t: 0, rate: rate, loop: false, fade: 0.08, y: "abs" });
    if (a.player) A.grab();
  }
  function stepSwing(a, dt) {
    const w = a.swing, b = w.b, clip = PK.CLIPS.swingland, r = a.runner, t = r.curT;
    w.t += dt;
    const zA = climbZ(clip, 0), zR = climbZ(clip, SWING_REL), zB = climbZ(clip, 1.45);
    const zRel = w.z0 - (zR - zA) / 100;
    if (t < SWING_REL) a.z = w.z0 - (climbZ(clip, t) - zA) / 100;
    else a.z = zRel - Math.min(1, (climbZ(clip, t) - zR) / (zB - zR)) * (zRel - b.landZ);
    a.y = b.landY + (w.y0 - b.landY) * Math.max(0, 1 - w.t / 0.15);
    a.x += Math.sign(a.tx - a.x) * Math.min(Math.abs(a.tx - a.x), 8 * dt);
    if (t >= 1.42 || r.done) {
      a.y = b.landY; a.vy = 0; a.air = false; a.lastGround = b.landY; a.peakY = b.landY; a.swing = null;
      a.state = "roll"; a.stateT = 0.6;
      r.play("roll", { loop: false, rate: 1.8, fade: 0.1, y: "abs" });
      if (a.player) { A.land(true); g.shake = 0.25; }
      trick(a, "SWING");
    }
  }
  function faceFixture(a, s) {
    for (let k = 0; k < s.obs.length; k++) { const o = s.obs[k]; if (o.face && Math.abs(a.x - o.x) <= 1.1) return o; }
    return null;
  }

  // ---------- stumbles and falls ----------
  // A crash is a stumble: lie there, get up, and run through the thing that tripped you (ghost) so a
  // bot that cannot dodge it is not stuck. Hitting a building face sends you back to try again.
  function stumble(a, why, o, backTo) {
    if (a.state === "crash" || a.state === "fell" || a.state === "done") return;
    a.state = "crash"; a.stateT = 1.35; a.air = false; a.vy = 0; a.atk = null; a.arm = null; a.dive = false; a.flipping = false; a.jumpBuf = 0; a.blockT = 0;
    a.ghostZ = o ? o.z - o.d / 2 - 0.7 : null;
    a.backTo = backTo === undefined ? null : backTo;
    a.runner.play("crash", { loop: false, rate: 1.1, fade: 0.04, y: "abs" });
    a.why = why;
    if (a.player) { A.crash(); g.shake = 0.6; g.stats.stumbles++; }
  }
  function fallOff(a) {
    if (a.state === "fell" || a.state === "done") return;
    // the second fall at the same gap within 15 s: respawn on the far side (no one gets stuck in a loop)
    a.skipGap = a.lastFall && Math.abs(a.lastFall.z - a.z) < 30 && g.t - a.lastFall.t < 15;
    a.lastFall = { z: a.z, t: g.t };
    a.state = "fell"; a.stateT = 1.5; a.air = true; a.atk = null; a.arm = null; a.climb = null; a.swing = null;
    a.runner.play("fall", { loop: true, fade: 0.1, y: "flat" });
    if (a.player) {
      A.fall(); g.shake = 0.2; g.stats.falls++;
      const s = W.slabs.find(function (q) { return q.z1 < a.z + 30 && q.z0 > a.z - 30 && q.z1 <= a.z + 0.5; }) || W.groundAt(a.z);
      (g.fallLog = g.fallLog || []).push(Math.round(-a.z) + ":" + (s ? s.kind + (s.traffic ? "T" : "") + (s.face ? "/" + s.face : "") + "->" + (s.next ? s.next.kind + (s.next.face ? "/" + s.next.face : "") + (s.next.swing ? "/swing" : "") : "?") + " gap" + (s.gap || 0).toFixed(1) : "none"));
    }
  }
  function respawn(a) {
    const s = a.safe;
    let z = s.z + 7;
    if (!W.groundAt(z) || z > 0) z = Math.min(0, s.z);
    if (a.skipGap) {                          // over the gap: the first slab that starts past where they fell
      const far = W.slabs.find(function (q) { return q.z0 < a.lastFall.z && q.z0 - q.z1 > 8; });
      if (far) z = far.z0 - 3;
      a.skipGap = false; a.lastFall = null;
    }
    a.z = z; a.x = LANES[a.lane]; a.tx = a.x;
    a.y = W.floor(a.x, a.z, 99) || s.y; a.vy = 0; a.air = false; a.lastGround = a.y; a.peakY = a.y;
    a.state = "start"; a.stateT = 0.5; a.ghost = 1.2; a.ghostZ = null;
    a.runner.root.visible = true;
    a.runner.play("start", { loop: false, fade: 0.1, y: "abs" });
  }

  // ---------- combat ----------
  // The same three buttons do different moves depending on where the rival is:
  //   SIDE   alongside in the next lane   -> side punch, side kick, CORKSCREW spin into them
  //   FRONT  right in front, same lane    -> jab/cross/hook chain (3rd = headbutt), roundhouse/martelo, troca/flip kick
  //   AHEAD  a few metres up the road     -> flying knee combo, flying bicycle kick, corkscrew / flying kick (all lunge)
  //   BACK   on your heels                -> turn and hook, martelo, flip kick
  //   SANDWICHED (a rival on each side)   -> arrows stop changing lanes and pick the side you hit;
  //                                          special with no side picked = hurricane kick, hits both
  // Move: clip (defaults to the key), zone it reaches, mul = speed while it plays, kd = knockdown time,
  // shove = knocks the victim a lane away from you, hop = metres of air (bicycle), lunge = carries you in.
  const hitT = (k, d) => (PK.HIT && PK.HIT[k] && PK.HIT[k].t) || d;
  const MOVES = {
    punch:     { kind: "punch", label: "JAB",          zone: "front", mul: 0.5,  stun: 0.8,  cd: 0.28, wind: 0.25 },
    cross:     { kind: "punch", label: "CROSS",        zone: "front", mul: 0.5,  stun: 0.85, cd: 0.30, wind: 0.30 },
    hook:      { kind: "punch", label: "HOOK",         zone: "front", mul: 0.5,  stun: 0.9,  cd: 0.30, wind: 0.30 },
    headbutt:  { kind: "punch", label: "HEADBUTT",     zone: "front", mul: 0.45, stun: 1.1,  cd: 0.45, wind: 0.30 },
    sidehook:  { clip: "hook",  kind: "punch", label: "SIDE PUNCH", zone: "side", mul: 0.55, stun: 0.95, cd: 0.30, wind: 0.30 },
    sidecross: { clip: "cross", kind: "punch", label: "SIDE CROSS", zone: "side", mul: 0.55, stun: 0.9,  cd: 0.30, wind: 0.30 },
    backhook:  { clip: "hook",  kind: "punch", label: "TURN & HOOK", zone: "back", mul: 0.5, stun: 1.0, cd: 0.35, wind: 0.30 },
    kneecombo: { kind: "punch", label: "FLYING KNEE COMBO", zone: "ahead", mul: 1.45, down: true, kd: 1.9, cd: 1.1, wind: 0.3, lunge: 6 },
    kick:      { kind: "kick",  label: "KICK",         zone: "front", mul: 0.4,  down: true, kd: 1.7, cd: 0.7, wind: 0.30 },
    sidekick:  { clip: "kick",  kind: "kick", label: "SIDE KICK", zone: "side", mul: 0.45, down: true, kd: 1.7, cd: 0.7, wind: 0.30, shove: true },
    roundhouse:{ kind: "kick",  label: "ROUNDHOUSE",   zone: "front", mul: 0.4,  down: true, kd: 1.8, cd: 0.8, wind: 0.30 },
    martelo:   { kind: "kick",  label: "MARTELO",      zone: "front", mul: 0.4,  down: true, kd: 1.7, cd: 0.7, wind: 0.30 },
    backkick:  { clip: "martelo", kind: "kick", label: "SPIN BACK KICK", zone: "back", mul: 0.4, down: true, kd: 1.7, cd: 0.7, wind: 0.30 },
    bicycle:   { kind: "kick",  label: "BICYCLE KICK", zone: "ahead", mul: 1.4,  down: true, kd: 1.8, cd: 1.0, t0: 0, tEnd: 0.64, lunge: 5.5, hop: 1.1, rate: 0.75 },
    corkscrew: { clip: "evade", kind: "special", label: "CORKSCREW", zone: "any", mul: 1.2, down: true, kd: 2.1, thrown: true, cd: 0.8, t0: 0.45, tHit: 1.0, tEnd: 2.25, rate: 1.3, lunge: 6, shove: true },
    flykick:   { kind: "special", label: "FLYING KICK", zone: "ahead", mul: 1.5,  down: true, kd: 2.0, cd: 0.9, wind: 0.25, lunge: 5.5 },
    hurricane: { kind: "special", label: "HURRICANE KICK", zone: "aoe", mul: 0.5, down: true, kd: 2.1, thrown: true, cd: 1.0, wind: 0.2, shove: true },
    flipkick:  { kind: "special", label: "FLIP KICK",  zone: "back", mul: 0.6,  down: true, kd: 1.9, cd: 1.0, wind: 0.3 },
    troca:     { kind: "kick",  label: "TROCA",        zone: "front", mul: 0.45, down: true, kd: 1.9, cd: 1.0, wind: 0.3 },
    // grabs: a block does not stop them; the victim plays "Shoulder Throw, Victim" from v.t (pulled down,
    // flipped, on their back) facing the one who grabbed them
    shoulderthrow: { kind: "special", label: "FLYING SHOULDER THROW", zone: "front", grab: true, mul: 0.55, down: true, cd: 1.0, t0: 0.5, tHit: 1.4, tEnd: 2.55, rate: 1.3, lunge: 3, victim: { t: 2.0, rate: 1.4, kd: 2.0 } },
    grabslam:  { kind: "special", label: "GRAB & SLAM", zone: "front", grab: true, mul: 0.15, down: true, cd: 1.0, t0: 0.7, tHit: 1.45, tEnd: 3.0, rate: 1.3, victim: { t: 2.0, rate: 1.2, kd: 2.4 } }
  };
  const SP_CD = 4.5;
  function untouchable(r) { return r.ghost > 0 || r.state === "climb" || r.state === "swing" || r.state === "fell" || r.state === "done" || r.state === "down" || r.state === "crash" || r.state === "idle"; }
  // where rival r is relative to a: "side" | "front" | "ahead" | "back" | null (out of reach)
  function zoneOf(a, r, slack) {
    const s = slack || 0, dx = r.x - a.x, adx = Math.abs(dx), ahead = a.z - r.z;
    if (adx >= 0.7 - s && adx <= 3.0 + s && Math.abs(ahead) <= 2.0 + s) return "side";
    if (adx < 0.7 + s && ahead >= -0.5 - s && ahead <= 2.1 + s) return "front";
    if (ahead > 2.1 - s && ahead <= 6.5 + s && adx <= 2.8 + s) return "ahead";
    if (ahead < -0.5 + s && ahead >= -3.2 - s && adx <= 3.0 + s) return "back";
    return null;
  }
  function reaches(a, r, m, slack) {
    if (r === a || untouchable(r) || Math.abs(r.y - a.y) > 1.3) return false;
    if (m.zone === "aoe") return Math.hypot(r.x - a.x, r.z - a.z) <= 3.2 + (slack || 0);
    const z = zoneOf(a, r, slack);
    if (m.zone === "any") return !!z;
    if (m.zone === "ahead") return z === "ahead" || z === "front";      // a lunge still connects if you closed the gap
    return z === m.zone;
  }
  // the rivals in reach, by zone; the side ones split left (-1) / right (+1)
  function around(a) {
    const o = { side: { "-1": null, "1": null }, front: null, ahead: null, back: null };
    g.agents.forEach(function (r) {
      if (r === a || untouchable(r) || Math.abs(r.y - a.y) > 1.3) return;
      const z = zoneOf(a, r);
      if (!z) return;
      const d = Math.hypot(r.x - a.x, r.z - a.z);
      if (z === "side") { const k = r.x > a.x ? "1" : "-1"; if (!o.side[k] || d < o.side[k].d) o.side[k] = { r: r, d: d }; }
      else if (!o[z] || d < o[z].d) o[z] = { r: r, d: d };
    });
    return o;
  }
  // a rival right beside you on both sides
  function sandwiched(a) { const o = around(a); return !!(o.side["-1"] && o.side["1"]); }
  // the side the player is pointing at: an arrow held, or pressed in the last half second
  function aimOf(a) { return a.aimT > 0 ? a.aim : 0; }
  // Which move a button does right now, and at whom.
  function pickMove(a, which) {
    const o = around(a), L = o.side["-1"], R = o.side["1"], aim = aimOf(a);
    let side = null;
    if (L && R) side = aim < 0 ? L : aim > 0 ? R : (L.d < R.d ? L : R);
    else side = L || R;
    const front = o.front, ahead = o.ahead, back = o.back;
    // nearest first: someone in front or right beside you beats someone up the road or behind
    const near = [front, side, back, ahead].filter(Boolean).sort(function (p, q) { return p.d - q.d; })[0];
    const tgt = (x) => x ? x.r : null;
    if (which === "punch") {
      if (front && near === front) { const k = ["punch", "cross", "hook"][a.punchIdx++ % 3]; return { key: a.chain >= 2 ? "headbutt" : k, tg: front.r }; }
      if (side && near === side) return { key: a.punchIdx++ % 2 ? "sidecross" : "sidehook", tg: side.r };
      if (back && near === back) return { key: "backhook", tg: back.r };
      if (ahead) return { key: "kneecombo", tg: ahead.r };
      return { key: ["punch", "cross"][a.punchIdx++ % 2], tg: null };
    }
    if (which === "kick") {
      if (front && near === front) return { key: ["roundhouse", "martelo", "troca"][a.kickIdx++ % 3], tg: front.r };
      if (side && near === side) return { key: a.kickIdx++ % 3 === 2 ? "roundhouse" : "sidekick", tg: side.r };
      if (back && near === back) return { key: "backkick", tg: back.r };
      if (ahead) return { key: "bicycle", tg: ahead.r };
      return { key: "kick", tg: null };
    }
    // special
    if (L && R && !aim) return { key: "hurricane", tg: null };
    if (side && near === side) return { key: "corkscrew", tg: side.r };
    if (front && near === front) return { key: a.spIdx++ % 2 ? "grabslam" : "shoulderthrow", tg: front.r };
    if (back && near === back) return { key: "flipkick", tg: back.r };
    if (ahead) return { key: a.spIdx++ % 2 ? "flykick" : "corkscrew", tg: ahead.r };
    return { key: "corkscrew", tg: tgt(near) };
  }
  function tryAttack(a, which) {
    if (g.mode !== "play" || !a || !canAct(a) || a.air || a.cd > 0 || g.t < 2.2 || a.jackWind > 0) return false;      // let the pack spread out first
    if (which === "special") { if (a.spCd > 0) return false; }
    const pk = pickMove(a, which), key = pk.key, m = MOVES[key], ck = m.clip || key, clip = PK.CLIPS[ck];
    if (!clip) return false;
    const rate = m.rate || 1;
    const tHit = m.tHit || hitT(ck, 0.45), t0 = m.t0 !== undefined ? m.t0 : Math.max(0, tHit - m.wind);
    const tEnd = m.tEnd || Math.min(clip.dur - 0.05, tHit + (m.tail || 0.5));
    const tg = pk.tg;
    a.state = "atk"; a.stateT = 5; a.atk = { key: key, move: m, tHit: tHit, t0: t0, tEnd: tEnd, done: false, target: tg, t: 0 };
    a.jumpBuf = a.slideBuf = 0; a.arm = null;
    if (which === "special") a.spCd = SP_CD;
    // face the target (beside you: the strike goes sideways; behind you: turn round), or straight ahead
    if (tg) a.face = Math.atan2(tg.x - a.x, tg.z - a.z); else a.face = Math.PI;
    a.faceT = 0;
    a.runner.play(ck, { t: t0, rate: rate, loop: false, fade: 0.08, y: "abs", restart: true });
    if (a.player) { A.whiff(); if (tg) toast(m.label); }
    g.moveLog[key] = (g.moveLog[key] || 0) + 1;
    return true;
  }
  function startBlock(a) {
    if (g.mode !== "play" || !a || !canAct(a) || a.air || a.blockCd > 0 || a.jackWind > 0) return;
    a.state = "block"; a.stateT = 0.62; a.blockT = 0.62; a.blockAge = 0; a.blockCd = 1.1; a.atk = null; a.arm = null; a.jumpBuf = a.slideBuf = 0;
    a.face = null;
    a.runner.play("block", { t: 0.3, rate: 1.0, loop: false, fade: 0.06, y: "abs" });
  }
  function stun(v, m) {
    v.atk = null; v.arm = null; v.blockT = 0; v.face = null; v.flipping = false;
    v.state = "hit"; v.stateT = m.stun || 0.85;
    v.runner.play("hitpunch", { t: 0.05, rate: 1.3, loop: false, fade: 0.05, y: "abs" });
  }
  function knockdown(v, m, from) {
    v.atk = null; v.arm = null; v.blockT = 0; v.face = null; v.flipping = false; v.lift = 0;
    v.state = "down"; v.stateT = m.kd || 1.8;
    if (m.shove && from) {                     // knocked a lane away from the hitter; off the edge = into the wall
      const dir = v.x === from.x ? (v.lane === 0 ? 1 : -1) : Math.sign(v.x - from.x), n = v.lane + dir;
      if (n >= 0 && n <= 2) { v.lane = n; v.tx = LANES[n]; } else v.stateT += 0.4;
    }
    if (m.victim) {
      v.stateT = m.victim.kd;
      if (from) v.face = Math.atan2(from.x - v.x, from.z - v.z);
      v.runner.play("throwvictim", { t: m.victim.t, rate: m.victim.rate, loop: false, fade: 0.08, y: "abs" });
      return;
    }
    const clip = m.thrown ? "thrown" : "hitback", dur = PK.CLIPS[clip].dur;
    v.runner.play(clip, { t: 0, rate: Math.min(2.2, dur / (v.stateT + 0.05)), loop: false, fade: 0.05, y: "abs" });
  }
  function applyHit(att, vic, m) {
    if (vic.state === "block" && vic.blockT > 0 && !m.grab) {
      if (vic.blockAge < 0.22) {                           // a parry: they swung into a fresh block
        vic.blockT = 0; vic.state = "start"; vic.stateT = 0.4; vic.runner.play("dodge", { t: 0.3, rate: 1.3, loop: false, fade: 0.05, y: "abs" });
        knockdown(att, { kd: 1.6 });
        A.block(); A.ko();
        if (vic.player) { toast("PARRY!"); g.stats.parries++; g.shake = 0.3; }
        if (att.player) toast("PARRIED");
      } else {
        att.atk = null; att.state = "hit"; att.stateT = 0.5; att.face = null;
        att.runner.play("hitpunch", { t: 0.05, rate: 1.6, loop: false, fade: 0.05, y: "abs" });
        A.block();
        if (vic.player) { toast("BLOCKED"); g.stats.blocks++; }
      }
      return;
    }
    att.hits++; vic.taken++;
    g.landLog[att.atk ? att.atk.key : "?"] = (g.landLog[att.atk ? att.atk.key : "?"] || 0) + 1;
    att.chain = att.chainT > 0 ? att.chain + 1 : 1; att.chainT = 1.3;
    const down = m.down || (m.kind === "punch" && att.chain >= 3);
    if (down) knockdown(vic, m, att); else stun(vic, m);
    if (m.kind === "punch" && !down) A.punch(); else A.kick();
    if (down) A.ko();
    if (att.player) { toast(down ? m.label + "!  KO" : m.label); g.shake = Math.max(g.shake, 0.18); }
    if (vic.player) { toast(m.grab ? "GRABBED!" : "OUCH"); g.shake = 0.45; }
  }
  function resolveStrike(a) {
    const atk = a.atk, m = atk.move;
    atk.done = true;
    // the one you aimed at, if they are still in reach (a little slack: they moved); else whoever is
    const tg = atk.target;
    if (m.zone !== "aoe" && tg && reaches(a, tg, m, 0.7)) { applyHit(a, tg, m); return; }
    const victims = g.agents.filter(function (r) { return reaches(a, r, m, 0.3); });
    if (!victims.length) { if (a.player) A.whiff(); return; }
    victims.sort(function (p, q) { return Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(q.x - a.x, q.z - a.z); });
    (m.zone === "aoe" ? victims : [victims[0]]).forEach(function (v) { applyHit(a, v, m); });
  }
  function endAttack(a) {
    a.cd = a.atk.move.cd; a.atk = null; a.face = null; a.lift = 0;
    a.tx = LANES[a.lane];
    a.state = "run"; a.runner.play("run", { loop: true, fade: 0.15 });
  }
  // while a move plays: keep facing the target until it lands, carry a lunge in, lift a flying kick
  function stepAttack(a, dt) {
    const atk = a.atk, m = atk.move, r = a.runner, t = r.curT, tg = atk.target;
    if (tg && !atk.done && !untouchable(tg)) a.face = Math.atan2(tg.x - a.x, tg.z - a.z);
    let extra = 0;
    if (m.lunge && t > atk.tHit - 0.5 && t < atk.tHit + 0.15) {
      extra = m.lunge * dt;
      if (tg && !atk.done) {                       // steer into them: a rival in the next lane gets spun into
        const side = Math.sign(tg.x - a.x);
        a.tx = Math.abs(tg.x - a.x) > 0.8 ? tg.x - side * 0.75 : a.tx;
        const gap = a.z - tg.z;                    // do not overshoot someone already alongside
        if (gap < 0.9) extra = Math.max(0, Math.min(extra, gap - 0.4));
      }
    }
    if (m.hop) { const k = (t - atk.t0) / Math.max(0.01, atk.tEnd - atk.t0); a.lift = k > 0 && k < 1 ? Math.sin(k * Math.PI) * m.hop : 0; }
    return extra;
  }

  // ---------- jacks ----------
  // Mario Kart style. Everyone starts a race with JACKS_N handfuls. Throw one (I / E, or JACKS on a
  // phone): the nearest rival up the road gets it landing in their lane about a second in front of
  // them; with nobody ahead you drop it behind you. Run over a patch and you stumble and fall; jump it
  // and you are fine. A patch trips one runner and is gone. Your own jacks trip you too.
  const jacks = [];
  let jackTpl = null, jackId = 1;
  function jackTemplate() {
    if (jackTpl) return jackTpl;
    const g6 = new T.Group(), steel = new T.MeshLambertMaterial({ color: 0xdfe3ea }), tip = new T.MeshLambertMaterial({ color: 0xff3b30 });
    const L = 0.46, rod = new T.CylinderGeometry(0.035, 0.035, L, 6), ball = new T.SphereGeometry(0.075, 8, 6);
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]].forEach(function (ax) {        // three crossed rods, a ball on each end
      const m = new T.Mesh(rod, steel);
      if (ax[2]) m.rotation.x = Math.PI / 2; else if (ax[0]) m.rotation.z = Math.PI / 2;
      g6.add(m);
      [-1, 1].forEach(function (e) { const b = new T.Mesh(ball, tip); b.position.set(ax[0] * e * L / 2, ax[1] * e * L / 2, ax[2] * e * L / 2); g6.add(b); });
    });
    W.bake(g6);
    return (jackTpl = g6);
  }
  const jackDisc = new T.MeshBasicMaterial({ color: 0xff6a2b, transparent: true, opacity: 0.32, depthWrite: false });
  const jackDiscGeo = new T.CircleGeometry(0.85, 20);
  function jackPatch() {
    const grp = new T.Group(), cl = new T.Group();
    for (let i = 0; i < 5; i++) {
      const m = jackTemplate().clone();
      m.position.set((Math.random() - 0.5) * 1.1, 0.17, (Math.random() - 0.5) * 1.0);
      m.rotation.set(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3);
      cl.add(m);
    }
    const d = new T.Mesh(jackDiscGeo, jackDisc); d.rotation.x = -Math.PI / 2; d.position.y = 0.03; d.visible = false; d.renderOrder = 3;
    grp.add(cl); grp.add(d);
    grp.userData.cluster = cl; grp.userData.disc = d;
    return grp;
  }
  // where a patch comes to rest: the slab or a static obstacle top (never a moving truck roof)
  function jackGround(x, z) {
    const y = W.floor(x, z, 99);
    if (y === null) return null;
    if (W.floorObj && W.floorObj.type === "car") { const s = W.groundAt(z); return s ? W.top(s, z) : null; }
    return y;
  }
  // The throw is the Goalie Throw clip on the upper body (the legs keep running): wind up from t0, the
  // handful leaves the left hand at rel, follow through to t1. Knocked over before the release = no throw.
  const THROW = { t0: 0.45, rel: 0.95, t1: 1.5, rate: 1.4 };
  function throwJacks(a) {
    if (g.mode !== "play" || !a || a.jacks <= 0 || g.t < 2.2 || a.finished || a.jackWind > 0) return false;
    if (!canAct(a) && a.state !== "air") return false;
    a.jackWind = (THROW.rel - THROW.t0) / THROW.rate;
    a.runner.overlay("throw", { t: THROW.t0, t1: THROW.t1, rate: THROW.rate });
    return true;
  }
  function windJacks(a, dt) {
    if (!(a.jackWind > 0)) return;
    const s = a.state;
    if (s === "crash" || s === "down" || s === "fell" || s === "hit" || s === "climb" || s === "swing" || s === "done") { a.jackWind = 0; a.runner.overlay(null); return; }
    a.jackWind -= dt;
    if (a.jackWind <= 0) launchJacks(a);
  }
  const _hand = new T.Vector3();
  function launchJacks(a) {
    let tg = null;
    g.agents.forEach(function (r) { const d = a.z - r.z; if (r !== a && !r.finished && d > 2 && d < 28 && (!tg || d < a.z - tg.z)) tg = r; });
    let tx, tz, tf;
    if (tg) { tf = 0.6; tx = LANES[tg.lane]; tz = tg.z - Math.max(7, tg.speed) * (tf + 0.95); }
    else { tf = 0.35; tx = LANES[a.lane]; tz = a.z + 2.6; }
    const ty = jackGround(tx, tz);
    a.jacks--;
    // out of the throwing hand (the matrices are a frame old at most; fine for a launch point)
    const ru = a.runner, hb = ru.bones[ru.m.BN.LeftHand];
    ru.root.updateMatrixWorld(true);
    if (hb) hb.getWorldPosition(_hand); else _hand.set(a.x, a.y + 1.4, a.z - 0.4);
    const grp = jackPatch();
    const j = { id: jackId++, owner: a, x: tx, z: tz, y: ty === null ? a.y - 9 : ty, lost: ty === null, air: true, t: 0, tf: tf,
      fx: _hand.x, fy: _hand.y, fz: _hand.z, group: grp, life: 0, back: !tg };
    grp.position.set(j.fx, j.fy, j.fz); scene.add(grp);
    jacks.push(j);
    g.jackLog.thrown++;
    if (a.player) { toast(tg ? "JACKS AT " + tg.name + "!" : "JACKS DROPPED"); A.whiff(); }
  }
  function removeJack(i) { scene.remove(jacks[i].group); jacks.splice(i, 1); }
  function clearJacks() { for (let i = jacks.length - 1; i >= 0; i--) removeJack(i); }
  function stepJacks(dt) {
    const p = g.player;
    let back = -1e9;
    g.agents.forEach(function (a) { if (a.z > back) back = a.z; });
    for (let i = jacks.length - 1; i >= 0; i--) {
      const j = jacks[i], grp = j.group, cl = grp.userData.cluster;
      j.life += dt;
      if (j.air) {
        j.t += dt;
        const k = Math.min(1, j.t / j.tf);
        grp.position.set(j.fx + (j.x - j.fx) * k, j.fy + (j.y - j.fy) * k + Math.sin(k * Math.PI) * (j.back ? 0.7 : 2.8), j.fz + (j.z - j.fz) * k);
        cl.rotation.x += dt * 7; cl.rotation.y += dt * 11;
        if (k >= 1) {
          if (j.lost) { removeJack(i); continue; }                      // over a gap: gone
          j.air = false; cl.rotation.set(0, Math.random() * 6.3, 0); grp.userData.disc.visible = true;
          if (p && Math.abs(p.z - j.z) < 35) A.jacks();
        }
        continue;
      }
      if (j.z > back + 30 || j.life > 60) removeJack(i);
    }
  }
  // a runner on the ground over a patch: down they go
  function jackCheck(a) {
    if (a.air) return false;
    for (let i = 0; i < jacks.length; i++) {
      const j = jacks[i];
      if (j.air || Math.abs(a.x - j.x) > 0.95 || Math.abs(a.z - j.z) > 0.75 || Math.abs(a.y - j.y) > 0.45) continue;
      if (j.owner === a && j.life < 1.2) continue;
      removeJack(i);
      stumble(a, "jacks", null);
      g.jackLog.hit++;
      if (j.owner !== a) { j.owner.hits++; a.taken++; }
      if (a.player) toast(j.owner === a ? "YOUR OWN JACKS!" : "JACKED BY " + j.owner.name);
      else if (j.owner.player) { toast("JACKED " + a.name + "!"); A.ko(); }
      return true;
    }
    return false;
  }

  // ---------- one runner, one step ----------
  const MUL ={ atk: 0.4, hit: 0.3, down: 0, crash: 0, fell: 0, block: 0.5, done: 0, idle: 0 };
  function stepAgent(a, dt) {
    const r = a.runner;
    a.jumpBuf -= dt; a.slideBuf -= dt; a.laneCd -= dt; a.cd -= dt; a.spCd -= dt; a.blockCd -= dt; a.chainT -= dt; a.aimT -= dt; a.diagReqT -= dt;
    if (a.player && !g.auto) { const h = heldAim(); if (h) { a.aim = h; a.aimT = 0.15; } }
    if (a.ghost > 0) a.ghost -= dt;
    if (a.boost > 0) a.boost -= dt;
    if (a.faceT < 1) a.faceT += dt * 6;
    a.stateT -= dt;
    if (a.state === "block") { a.blockT -= dt; a.blockAge += dt; }
    windJacks(a, dt);
    if (!a.air) a.coyote = 0.11; else a.coyote -= dt;

    // states where the runner stays put
    if (a.state === "crash") {
      if (a.stateT <= 0) {
        if (a.backTo !== null) { a.z = a.backTo; a.y = W.floor(a.x, a.z, 99) || a.y; a.lastGround = a.y; a.backTo = null; a.ghostZ = null; }
        else a.ghost = 0.6;
        a.state = "start"; a.stateT = 0.5; r.play("start", { loop: false, fade: 0.15, y: "abs" });
      }
      r.update(dt); return;
    }
    if (a.state === "fell") {
      a.vy -= GRAV * dt; a.y += a.vy * dt;
      const pf = W.pitFloor(a.z);
      if (a.y < pf && !W.groundAt(a.z)) a.y = pf, a.vy = 0;
      if (a.stateT < 0.5) r.root.visible = false;
      if (a.stateT <= 0) respawn(a);
      r.update(dt); return;
    }
    if (a.state === "down") {
      a.x += Math.sign(a.tx - a.x) * Math.min(Math.abs(a.tx - a.x), 7 * dt);      // shoved across a lane
      if (a.stateT <= 0) { a.state = "start"; a.stateT = 0.5; a.ghost = 0.3; a.face = null; r.play("start", { loop: false, fade: 0.2, y: "abs" }); }
      vertical(a, dt); r.update(dt); return;
    }
    if (a.state === "done" || a.state === "idle") { r.update(dt); return; }

    // speed
    const base = cruiseOf(a.dist);
    let target = MUL[a.state] !== undefined ? MUL[a.state] : 1;
    if (a.state === "atk" && a.atk) target = a.atk.move.mul;
    a.mul += (target - a.mul) * Math.min(1, dt * 10);
    let sp = base * a.mul * (a.boost > 0 ? 1.07 : 1) * (a.band || 1);
    if (a.state === "start") sp = Math.min(sp, 3 + (0.5 - a.stateT) * 22);
    a.speed = sp;

    // jump near a climbable arms a climb; it starts when the body reaches the wall
    if (a.jumpBuf > 0 && !a.air && canAct(a)) {
      const o = nearClimb(a, 14);
      if (o) { a.arm = o; a.armT = 2.0; a.jumpBuf = 0; }
    }
    if (a.arm) {
      let o = a.arm;
      if (Math.abs(a.x - o.x) > 1.1 && o.face) o = a.arm = nearClimb(a, 14);
      if (o) {
        const pr = CLIMB[o.type], d = a.z - (o.z + o.d / 2);
        a.armT -= dt;
        if (Math.abs(a.x - o.x) > 1.1 || a.armT <= 0 || d <= -0.2 || a.air || busyCombat(a)) a.arm = null;
        else if (d <= pr.off0 + 0.05) startClimb(a, o, pr);
      }
    }
    if (a.state === "climb" || a.state === "swing") {
      if (a.state === "swing") stepSwing(a, dt);
      else if (a.climb.kind) stepLedge(a, dt);
      else stepClimb(a, dt);
      r.update(dt);
      return;
    }

    // combat timing
    let lungeDz = 0;
    if (a.state === "atk") {
      const atk = a.atk;
      lungeDz = stepAttack(a, dt);
      if (!atk.done && r.curT >= atk.tHit) resolveStrike(a);
      if (a.state === "atk" && atk && (r.curT >= atk.tEnd || r.done)) endAttack(a);
    } else if (a.state === "block" && a.stateT <= 0) {
      a.state = "run"; a.blockT = 0; r.play("run", { loop: true, fade: 0.12 });
    } else if (a.state === "hit" && a.stateT <= 0) {
      a.state = "run"; r.play("run", { loop: true, fade: 0.15 });
    }
    if (a.chainT <= 0) a.chain = 0;

    // actions
    const act = canAct(a);
    if (a.jumpBuf > 0 && act && (!a.air || a.coyote > 0) && !(a.air && a.jumped)) doJumpNow(a);
    else if (a.jumpBuf > 0 && a.air && a.state === "air" && !a.flipped && !a.dive && !a.climb) {
      const fy = W.floor(a.x, a.z);
      if (fy === null || a.y - fy > 0.8 || a.vy > 0) doFlip(a);
    } else if (a.slideBuf > 0 && !a.air && (a.state === "run" || a.state === "start")) { startSlide(a); a.slideBuf = 0; }
    if (a.flipping && (r.curT >= a.flipping.tEnd || r.cur !== a.flipping.clip)) {
      a.flipping = false;
      if (a.air && a.state === "air") r.play("fall", { loop: true, fade: 0.15, y: "flat" });
    }
    if (a.stateT <= 0) {
      if (a.state === "start") { a.state = "run"; r.play("run", { loop: true, fade: 0.1 }); }
      else if (a.state === "slide" || a.state === "roll") { a.state = "run"; r.play("run", { loop: true, fade: 0.12 }); }
    }

    // movement
    const prevZ = a.z;
    const dz = a.speed * dt + lungeDz;          // flying moves carry you in
    a.z -= dz;
    const dx = a.tx - a.x;
    a.x += Math.sign(dx) * Math.min(Math.abs(dx), 16 * dt);
    if (-a.z > a.dist) a.dist = -a.z;

    // building faces: a gap you fell short of, or a wall you ran into. Jumping into a ladder / scaffold /
    // wall-run face catches on instead.
    for (let i = 0; i < W.slabs.length; i++) {
      const s = W.slabs[i];
      if (prevZ > s.z0 && a.z <= s.z0 && a.y < s.y0 - 0.3) {
        const fx = a.air ? faceFixture(a, s) : null;
        if (fx && CLIMB[fx.type] && a.y > fx.base - 0.5) {
          a.z = s.z0 + 0.15;
          startClimb(a, fx, CLIMB[fx.type]);
          stepLedge(a, dt); r.update(dt);
          return;
        }
        if (a.air && (a.vy < -8 || a.y < s.y0 - 4)) { fallOff(a); r.update(dt); return; }
        stumble(a, "face", null, s.z0 + 6);
        a.z = s.z0 + 0.3;
        r.update(dt); return;
      }
    }
    vertical(a, dt);
    if (a.air && checkSwing(a)) { stepSwing(a, dt); r.update(dt); return; }
    if (a.air && a.y < 0.3 && !W.groundAt(a.z)) { fallOff(a); r.update(dt); return; }
    if (a.air && a.y < a.lastGround - 40) { fallOff(a); r.update(dt); return; }
    if (!a.air && a.state === "run") {          // a respawn point: solid ground with room before the next gap
      const s = W.groundAt(a.z);
      if (s && a.z - s.z1 > 12) a.safe = { x: a.x, z: a.z, y: a.y };
    }

    // obstacles (a ghost runs through; so does the one who just got up, until they are past it)
    const ghosted = a.ghost > 0 || (a.ghostZ !== null && a.z > a.ghostZ);
    if (a.ghostZ !== null && a.z <= a.ghostZ) a.ghostZ = null;
    if (!ghosted) {
      const H = (a.state === "slide" || a.state === "roll") ? 0.65 : 1.8;
      for (let i = 0; i < W.slabs.length; i++) {
        const s = W.slabs[i];
        if (a.z > s.z0 + 14 || a.z < s.z1 - 8) continue;
        for (let k = 0; k < s.obs.length; k++) {
          const o = s.obs[k];
          if (o.face && !o.plat) continue;
          if ((o.type === "fence" || o.type === "brick") && a.noFence) continue;
          if (Math.abs(a.z - o.z) > o.d / 2 + 0.25 || Math.abs(a.x - o.x) > o.w / 2 + 0.28) continue;
          let hit;
          if (o.type === "bar") hit = a.y + H > o.base + o.yb && a.y < o.base + o.h;
          else if (o.plat) hit = a.y < o.base + W.platTop(o, Math.max(o.z - o.d / 2, Math.min(o.z + o.d / 2, a.z))) - 0.35;
          else hit = a.y < o.base + o.h - 0.14;
          const fz = a.z - (o.z + o.d / 2);
          if (hit && o.plat && a.air && CLIMB[o.type] && CLIMB[o.type].ledge && fz < 1.0 && fz > -0.45 && a.y > o.base - 0.4) {
            a.z = o.z + o.d / 2 + 0.15;          // jumped into a container face: catch on and run up it
            startClimb(a, o, CLIMB[o.type]);
            stepLedge(a, dt); r.update(dt);
            return;
          }
          if (hit) { stumble(a, o.type, o); r.update(dt); return; }
        }
      }
      for (let i = 0; i < W.cars.length; i++) {      // moving traffic
        const c = W.cars[i];
        if (Math.abs(a.z - c.z) > c.d / 2 + 0.25 || Math.abs(a.x - c.x) > c.w / 2 + 0.28) continue;
        const top = W.platTop(c, Math.max(c.z - c.d / 2, Math.min(c.z + c.d / 2, a.z)));
        if (a.y < top - 0.35) { stumble(a, "car", { z: c.z, d: c.d }); r.update(dt); return; }
      }
      for (let i = 0; i < W.barrels.length; i++) {   // drums off the back of a truck
        const b = W.barrels[i];
        if (b.dead || Math.abs(a.x - b.x) > b.w / 2 + 0.28) continue;
        const dzb = a.z - b.z;
        if (Math.abs(dzb) < b.r + 0.3) {
          if (a.y < b.y + b.r * 2 - 0.15) { G.Traffic.knock(b, Math.sign(b.x - a.x) || 1); stumble(a, "barrel", null); r.update(dt); return; }
          if (a.air && !(b.hop && b.hop[a.slot])) { (b.hop = b.hop || {})[a.slot] = true; trick(a, "BARREL HOP"); }
        }
      }
      if (jackCheck(a)) { r.update(dt); return; }
    }

    // finish line
    if (!a.finished && a.z <= FINISH_Z) finishAgent(a);

    // animation rate follows speed
    if (a.state === "run") {
      r.rate = Math.max(1, Math.min(1.75, a.speed / 4.8));
      if (a.player) {
        const ph = r.curT / r.clip.dur * 2, idx = Math.floor(ph);
        if (idx !== a.stepPhase) { a.stepPhase = idx; A.step(0.8); }
      }
    }
    r.update(dt);
  }
  function busyCombat(a) { return a.state === "atk" || a.state === "hit" || a.state === "down" || a.state === "block"; }

  function vertical(a, dt) {
    const gy = W.floor(a.x, a.z, a.y), obj = W.floorObj;
    if (!a.air) {
      if (gy === null || gy < a.y - 0.3) { a.air = true; a.vy = 0; a.peakY = a.y; if (a.state === "run" || a.state === "start" || a.state === "slide" || a.state === "roll") { a.state = "air"; a.runner.play("fall", { loop: true, fade: 0.12, y: "flat" }); } }
      else { a.y = gy; a.lastGround = gy; }
    }
    if (a.air) {
      a.vy -= GRAV * dt;
      const ny = a.y + a.vy * dt;
      if (a.y > a.peakY) a.peakY = a.y;
      if (gy !== null && a.vy <= 0 && ny <= gy && a.y >= gy - 0.35) land(a, gy, obj);
      else a.y = ny;
    }
  }

  function finishAgent(a) {
    a.finished = true; a.finishT = g.t; a.place = ++g.finishers;
    a.state = "done"; a.atk = null; a.arm = null; a.air = false; a.vy = 0; a.blockT = 0; a.face = null;
    a.y = W.floor(a.x, a.z, 99) || a.y;
    a.runner.play(a.place === 1 ? "twirl" : "idle", { loop: a.place !== 1, fade: 0.2, y: "abs", t: 0 });
    if (a.player) { A.finish(); toast(a.place === 1 ? "YOU WIN!" : "FINISHED  " + ordinal(a.place)); g.overT = 0; g.mode = "finishing"; }
  }
  const ordinal = (n) => n + (n === 1 ? "ST" : n === 2 ? "ND" : "RD");

  // ---------- bots ----------
  // The Concrete Jungle test bot, one per runner, with a skill level; plus a fighter's brain.
  const AUTO_BRAIN = { skill: 0.85, aggr: 1.1, climbPref: 0.5, react: 1, seen: {} };   // the test bot driving the player
  function botDrive(a, dt) {
    if (busy(a) && a.state !== "block") return;
    const b = a.bot || AUTO_BRAIN, sp = a.speed || 8;
    // a lane gap or a drop is a jump
    const gs = W.groundAt(a.z);
    if (gs && !a.air && a.state !== "start") {
      const de = a.z - gs.z1, next = W.slabs[W.slabs.indexOf(gs) + 1];
      if (de < sp * 0.12 + 0.15 && next && next.z0 < gs.z1 - 0.01) a.jumpBuf = 0.1;
    }
    const block = [99, 99, 99], soon = [false, false, false];
    let jumpNow = false, slideNow = false;
    for (let i = 0; i < W.slabs.length; i++) {
      const s = W.slabs[i];
      for (let k = 0; k < s.obs.length; k++) {
        const o = s.obs[k], lane = LANES.indexOf(o.x);
        const front = a.z - (o.z + o.d / 2), back = a.z - (o.z - o.d / 2);
        if (back < -1.2 || front > 45) continue;
        if (o.face) { if (lane === a.lane && !a.air && !o.plat && front > 0 && front < 10) jumpNow = true; continue; }
        if (CLIMB[o.type] && CLIMB[o.type].ledge && !o.face) {      // a container: climb it (some bots like to), or go round
          const likes = (((Math.abs(o.z) * 7 + lane) % 10) / 10) < b.climbPref;
          if (likes) { if (lane === a.lane && Math.abs(a.x - o.x) < 0.9 && !a.air && front > 0 && front < 9) jumpNow = true; continue; }
        }
        if (o.plat && o.type !== "barrier") block[lane] = Math.min(block[lane], Math.max(0, front));
        if (front < sp * 0.5 + 1.5) soon[lane] = true;
        if (lane === a.lane && Math.abs(a.x - o.x) < 0.9 && !a.air) {
          if (o.type === "barrier" && front > 0 && front < sp * 0.3 + 0.2) jumpNow = true;
          if (o.type === "bar" && front > 0 && front < sp * 0.26 + 0.2) slideNow = true;
          if ((o.type === "fence" || o.type === "brick") && front > 0 && front < sp * 0.5 + 2) jumpNow = true;
        }
      }
    }
    for (let i = 0; i < W.cars.length; i++) {
      const c = W.cars[i], lane = LANES.indexOf(c.x), close = Math.max(4, sp + c.vz);
      const front = a.z - (c.z + c.d / 2);
      if (front < -c.d || front > 60) continue;
      if (c.h > 2.0) block[lane] = Math.min(block[lane], Math.max(0, front));
      if (front < close * 0.5 + 1.5) soon[lane] = true;
      if (lane === a.lane && Math.abs(a.x - c.x) < 0.9 && !a.air && c.h <= 2.0 && front > 0 && front < close * 0.3 + 0.2) jumpNow = true;
    }
    for (let i = 0; i < W.barrels.length; i++) {      // a drum rolling at you: jump it (a weak bot sometimes misses one)
      const br = W.barrels[i];
      if (br.dead || Math.abs(a.x - br.x) > 0.9 || a.air) continue;
      const front = a.z - (br.z + br.r), close = sp + Math.max(0, br.vz);
      if (front <= 0 || front > close * 0.3 + 0.35) continue;
      if (b.seen[br.id] === undefined) b.seen[br.id] = Math.random() < 0.8 + 0.2 * b.skill;
      if (b.seen[br.id]) jumpNow = true;
    }
    for (let i = 0; i < jacks.length; i++) {          // jacks on the road: jump them (a weak bot sometimes misses them)
      const j = jacks[i];
      if (j.air || a.air || Math.abs(a.x - j.x) > 0.95 || Math.abs(a.y - j.y) > 0.5) continue;
      const front = a.z - (j.z + 0.75);
      if (front <= 0 || front > sp * 0.3 + 0.35) continue;
      const k = "j" + j.id;
      if (b.seen[k] === undefined) b.seen[k] = Math.random() < 0.6 + 0.3 * b.skill;
      if (b.seen[k]) jumpNow = true;
    }
    // jacks: at a rival a little way up the road, or dropped in front of one on your heels
    a.jackT -= dt;
    if (a.jacks > 0 && g.t > 4 && a.jackT <= 0) {
      a.jackT = 0.5;
      let want = false;
      g.agents.forEach(function (r) {
        if (r === a || r.finished) return;
        const d = a.z - r.z;
        if ((d > 5 && d < 22) || (d < -1.5 && d > -9 && r.lane === a.lane)) want = true;
      });
      if (want && Math.random() < 0.1 * b.aggr && throwJacks(a)) a.jackT = 7 + Math.random() * 8;
    }
    if (block[a.lane] < sp * 1.3 * b.react + 5 && a.laneCd <= 0 && !a.air) {
      let bestL = a.lane;
      for (let l = 0; l < 3; l++) if (block[l] > block[bestL] + 0.5) bestL = l;
      if (bestL !== a.lane) { const st = bestL > a.lane ? 1 : -1; if (!soon[a.lane + st]) { laneMove(a, st); a.laneCd = 0.16 + (1 - b.skill) * 0.25; } }
    }
    if (jumpNow) a.jumpBuf = 0.1;
    if (slideNow) a.slideBuf = 0.1;
    // fight: swing at whoever is in reach; block what is about to land
    if (!canAct(a) && a.state !== "block") return;
    let threat = null;
    // one read per incoming strike: block it (early, a plain block) or, rarely and only for a sharp
    // bot, parry it (late); otherwise eat it. Roughly 30-55% of strikes get blocked.
    g.agents.forEach(function (r) {
      if (r === a || !r.atk || r.atk.done || !reaches(r, a, r.atk.move, 0.4)) return;
      const left = (r.atk.tHit - r.runner.curT) / (r.atk.move.rate || 1);
      const k = "read" + a.slot;
      if (r.atk[k] === undefined) { const u = Math.random(); r.atk[k] = u < 0.08 * b.skill ? "parry" : u < 0.2 + 0.4 * b.skill ? "block" : "none"; }
      if ((r.atk[k] === "block" && left < 0.45 && left > 0.25) || (r.atk[k] === "parry" && left < 0.16 && left > 0.04)) threat = r;
    });
    if (threat && a.state !== "block") { startBlock(a); return; }
    // no starting a fight with a gap or a step up just ahead: a long move (a grab is ~2 s) runs you off the edge
    let edgeNear = false;
    if (gs) {
      const nx = W.slabs[W.slabs.indexOf(gs) + 1];
      edgeNear = a.z - gs.z1 < 14 && !!nx && (nx.z0 < gs.z1 - 0.01 || nx.y0 > gs.y1 + 0.3);
    }
    if (a.cd <= 0 && !a.air && canAct(a) && a.state !== "slide" && !edgeNear) {
      // the buttons are situational, so a bot only decides which button; pickMove decides the move
      const o = around(a), close = o.front || o.side["-1"] || o.side["1"] || o.back;
      if (close && Math.random() < dt * 2.4 * b.aggr) {
        if (a.spCd <= 0 && Math.random() < 0.22) tryAttack(a, "special");
        else tryAttack(a, Math.random() < 0.55 ? "punch" : "kick");
        return;
      }
      if (o.ahead && Math.random() < dt * 0.9 * b.aggr) tryAttack(a, a.spCd <= 0 && Math.random() < 0.5 ? "special" : Math.random() < 0.5 ? "punch" : "kick");
    }
  }

  // ---------- race bookkeeping ----------
  function rank() {
    const list = g.agents.slice().sort(function (p, q) {
      if (p.finished !== q.finished) return p.finished ? -1 : 1;
      if (p.finished) return p.finishT - q.finishT;
      return p.z - q.z;
    });
    list.forEach(function (a, i) { a.rank = i + 1; });
    return list;
  }
  function track() {
    const list = rank(), p = g.player;
    $("place").className = "p" + p.rank;
    $("place").innerHTML = p.rank + "<span>" + (p.rank === 1 ? "ST" : p.rank === 2 ? "ND" : "RD") + "</span>";
    $("meters").textContent = Math.max(0, Math.min(RACE_LEN, Math.floor(-p.z)));
    g.agents.forEach(function (a) { $("mk" + a.slot).style.left = Math.max(0, Math.min(100, -a.z / RACE_LEN * 100)) + "%"; });
    const sp = $("spcd"); if (sp) sp.style.width = Math.max(0, Math.min(100, p.spCd / SP_CD * 100)) + "%";
    if (g.jkShown !== p.jacks) {
      g.jkShown = p.jacks;
      let h = "";
      for (let i = 0; i < JACKS_N; i++) h += "<i class='" + (i < p.jacks ? "on" : "") + "'>✱</i>";
      $("jacks").innerHTML = h; $("jkn").textContent = "×" + p.jacks;
      $("b-jacks").classList.toggle("empty", p.jacks <= 0);
    }
    $("banner").classList.toggle("on", g.mode === "countdown" || (g.mode === "play" && g.t < 1.2));
    return list;
  }

  // The finish gantry, placed once the slab under it exists.
  function placeFinish() {
    if (g.finishObj) return;
    const s = W.groundAt(FINISH_Z);
    if (!s) return;
    const grp = new T.Group(), y = W.top(s, FINISH_Z), w = 5.6;
    const cv = document.createElement("canvas"); cv.width = 512; cv.height = 128;
    const c = cv.getContext("2d");
    for (let i = 0; i < 32; i++) for (let j = 0; j < 8; j++) { c.fillStyle = (i + j) % 2 ? "#f4f0e6" : "#15151a"; c.fillRect(i * 16, j * 16, 16, 16); }
    c.fillStyle = "rgba(10,10,14,.78)"; c.fillRect(96, 30, 320, 68);
    c.font = "900 54px 'Arial Black', Impact, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = "#ffd23f"; c.fillText("FINISH", 256, 66);
    const tx = new T.CanvasTexture(cv); tx.colorSpace = T.SRGBColorSpace;
    const banner = new T.Mesh(new T.PlaneGeometry(w * 2, 1.6), new T.MeshBasicMaterial({ map: tx, side: T.DoubleSide, fog: true }));
    banner.position.set(0, 5.2, 0); grp.add(banner);
    const post = new T.MeshLambertMaterial({ color: 0xdedbd2 });
    [-1, 1].forEach(function (sd) { const p = new T.Mesh(new T.BoxGeometry(0.4, 6, 0.4), post); p.position.set(sd * w, 3, 0); grp.add(p); });
    const line = new T.Mesh(new T.PlaneGeometry(w * 2, 1.2), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false }));
    line.rotation.x = -Math.PI / 2; line.position.set(0, 0.05, 0); grp.add(line);
    grp.position.set(0, y, FINISH_Z);
    scene.add(grp); g.finishObj = grp;
  }

  function placeCountdown(dt) {
    const n = Math.ceil(3.4 - g.cdT);
    if (n !== g.cdN) {
      g.cdN = n;
      const el = $("count");
      if (n >= 1 && n <= 3) { el.textContent = String(n); A.beep(false); }
      else { el.textContent = "GO!"; A.beep(true); }
      el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop");
    }
  }

  // ---------- the loop ----------
  function step(dt) {
    if (g.mode === "menu" || g.mode === "paused" || !g.agents.length) return;
    dt *= g.timeScale;
    g.t += dt;
    if (g.mode === "countdown") {
      g.cdT += dt;
      placeCountdown(dt);
      g.agents.forEach(function (a) { a.runner.update(dt); });
      if (g.cdT >= 3.4) {
        g.mode = "play"; g.t = 0;
        g.agents.forEach(function (a) { a.state = "start"; a.stateT = 0.5; a.runner.play("start", { loop: false, fade: 0.1, y: "abs" }); });
      }
      return;
    }
    if (FALL_AT && !g.fellTest && g.t > FALL_AT && g.player.state !== "climb") { g.fellTest = true; fallOff(g.player); }   // test: ?fallat=8
    const zs = g.agents.map(function (a) { return a.z; });
    G.Traffic.tick(dt, zs);
    // bots (and the test mode where the bot also drives the player)
    g.agents.forEach(function (a) { if (!a.finished && (a.bot || g.auto)) botDrive(a, dt); });
    // rubber band: the bot far ahead eases off a touch, the one far behind catches up a touch
    g.agents.forEach(function (a) {
      if (!a.bot) { a.band = 1; return; }
      const others = g.agents.filter(function (o) { return o !== a; }).map(function (o) { return o.z; });
      const bestOther = Math.min.apply(null, others);
      a.band = a.z < bestOther - 45 ? 0.97 : (a.z > bestOther + 60 ? 1.04 : 1);
    });
    stepJacks(dt);
    g.agents.forEach(function (a) { stepAgent(a, dt); });
    // the world follows the leader and keeps what the last runner still stands on
    const leadA = g.agents.reduce(function (m, a) { return a.z < m.z ? a : m; }, g.agents[0]);
    W.update(leadA.z, cruiseOf(leadA.dist), leadA.dist, Math.max.apply(null, g.agents.map(function (a) { return a.z; })));
    placeFinish();
    g.agents.forEach(function (a) { place(a, dt); });
    track();
    if (g.mode === "finishing") {
      g.overT += dt / g.timeScale;
      g.timeScale = Math.max(0.5, g.timeScale - dt * 0.5);
      if (g.overT > 2.4) raceOver();
    }
    if (g.mode === "play" && g.agents.every(function (a) { return a.finished; })) raceOver();
  }

  const _up = new T.Vector3(0, 1, 0);
  function place(a, dt) {
    const r = a.runner;
    r.root.position.set(a.x, a.y + (a.state === "atk" ? a.lift : 0), a.z);
    const dxl = Math.max(-2.5, Math.min(2.5, a.tx - a.x));
    let yaw = Math.PI - dxl * 0.12;
    if (a.face !== null && (a.state === "atk" || a.state === "down")) yaw = a.face;      // a grabbed runner faces the grabber
    let dy = yaw - r.holder.rotation.y;                      // the short way round
    dy = ((dy + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    r.holder.rotation.y += dy * Math.min(1, (dt || 1) * (a.state === "atk" ? 22 : 12));
    r.root.rotation.z = a.state === "run" || a.state === "air" ? -dxl * 0.035 : 0;
    if (a.state === "done" && a.place === 1) r.holder.rotation.y = Math.PI * 0.85;
    const fy = W.floor(a.x, a.z, a.y + 0.05);
    a.blob.visible = fy !== null && r.root.visible;
    if (fy !== null) { a.blob.position.set(a.x, fy + 0.04, a.z); a.blob.scale.setScalar(Math.max(0.3, 1 - Math.max(0, a.y - fy) * 0.12)); }
    a.ring.visible = fy !== null && r.root.visible;
    if (fy !== null) { a.ring.position.set(a.x, fy + 0.06, a.z); a.ring.scale.setScalar(a.player ? 1.08 : 1); }
    // blink while a ghost (just got up through something)
    r.root.visible = a.state === "fell" && a.stateT < 0.5 ? false : (a.ghost > 0 ? Math.floor(g.t * 14) % 2 === 0 : true);
  }
  function raceOver() {
    if (g.mode === "over") return;
    g.mode = "over"; g.overT = 0; g.timeScale = 1;
    $("hud").classList.remove("on"); $("pad").classList.remove("on"); $("banner").classList.remove("on");
    const list = rank(), p = g.player, S = g.series, RC = RACES[S.race];
    // series bookkeeping: a win, 3/2/1 points, and time (a runner still out there gets an estimate)
    list.forEach(function (a, i) {
      S.pts[a.slot] += 3 - i;
      S.time[a.slot] += a.finished ? a.finishT : g.t + Math.max(0, a.z - FINISH_Z) / VMAX;
    });
    S.wins[list[0].slot]++; S.winners.push(list[0].slot);
    S.race++;
    const champ = seriesChamp(S);
    if (champ !== null) { S.over = true; S.champ = champ; }
    const big = $("over-place");
    if (S.over) {
      $("over-title").textContent = "BEST OF 3 · SERIES OVER";
      big.textContent = champ === 0 ? "CHAMPION" : g.agents[champ].name + " WINS";
      big.classList.add("word");
      if (champ === 0) A.finish();
    } else {
      $("over-title").textContent = "RACE " + S.race + " OF 3 · " + RC.name + (p.rank === 1 ? " · VICTORY" : "");
      big.textContent = ordinal(p.rank); big.classList.remove("word");
    }
    const pips = function (slot) { let s = ""; for (let i = 0; i < 2; i++) s += i < S.wins[slot] ? "★" : "☆"; return "<em>" + s + "</em>"; };
    $("over-rows").innerHTML = list.map(function (a, i) {
      const right = a.finished ? a.finishT.toFixed(1) + " s" : "+" + Math.max(0, Math.round(a.z - list[0].z)) + " m";
      return "<div class='" + (a.player ? "me" : "") + "'><span>" + (i + 1) + ". " + a.name + (a.player ? " (YOU)" : "") + "</span><span>" + a.hits + " hits · " + right + pips(a.slot) + "</span></div>";
    }).join("");
    // the standings: wins first; when it went the distance at 1-1-1, points then time decided it
    const tie = S.over && S.wins[champ] < 2;
    $("over-series").textContent = (S.over ? (tie ? "1-1-1, decided on points (3 / 2 / 1 a race)" : "First to 2 wins") : "First to 2 wins · next: " + RACES[S.race].name);
    const key = p.id + "/" + RC.route; let line = "";
    if (p.finished) { if (!best[key] || p.finishT < best[key]) { best[key] = +p.finishT.toFixed(1); line = "NEW BEST ON " + RC.name + "  " + best[key] + " s"; try { localStorage.setItem("sr_best", JSON.stringify(best)); } catch (e) {} } else line = RC.name + " best " + best[key] + " s"; }
    $("over-best").textContent = line; $("over-best").classList.toggle("new", /NEW/.test(line));
    $("btn-again").textContent = S.over ? "NEW SERIES" : "NEXT RACE";
    show("screen-over");
    if (S.over) g.opp = pickOpponents();
  }

  // ---------- camera ----------
  const look = new T.Vector3(), want = new T.Vector3();
  function updateCamera(dt, snap) {
    const p = g.player;
    // falling: the screen is black, so hold the camera still (following the drop clipped through the
    // buildings); on the respawn it snaps to the runner while still black, then the view fades back in
    const fell = !!p && p.state === "fell" && g.mode !== "menu";
    if (fell !== g.blackout) { g.blackout = fell; $("blackout").classList.toggle("on", fell); if (!fell && p) { g.cy = p.y; snap = true; } }
    if (fell) return;
    if (!p) { want.set(1.2, 1.6, 4.4); look.set(-1.5, 1.0, -0.5); }
    else if (g.mode === "menu") { want.set(1.2, 2, 4); look.set(0, 1, -1); }
    else {
      const climbing = p.state === "climb" && p.climb && p.climb.kind ? 1.8 : 0;
      g.camUp += (climbing - g.camUp) * Math.min(1, dt * 3);
      g.cy += (p.y - g.cy) * Math.min(1, dt * (p.y > g.cy ? 7 : 4));
      want.set(p.x * 0.55, g.cy + 2.6 + g.camUp * 0.25, p.z + 5.7 + g.camUp * 0.5);
      look.set(p.x * 0.7, g.cy + 1.25 + g.camUp, p.z - 8);
    }
    const k = snap ? 1 : 1 - Math.exp(-dt * 7);
    camera.position.lerp(want, k);
    if (g.shake > 0) { camera.position.x += (Math.random() - 0.5) * g.shake * 0.35; camera.position.y += (Math.random() - 0.5) * g.shake * 0.35; g.shake = Math.max(0, g.shake - dt * 1.6); }
    camera.lookAt(look);
    const sp = p ? p.speed : 0;
    const tf = g.baseFov + (g.mode === "play" ? Math.max(0, (sp - V0)) * 0.9 : 0);
    if (Math.abs(camera.fov - tf) > 0.05) { camera.fov += (tf - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
    W.followSky(camera);
  }

  // ---------- screens ----------
  // hold = seconds a hint stays up over the automatic ones (the aim arrows)
  let hintHold = 0, hintHoldAt = 0;
  function setHint(h, hold) {
    if (hold) { hintHold = hold; hintHoldAt = performance.now(); }
    if (h === g.hint) return; g.hint = h; $("hint").textContent = h; $("hint").classList.toggle("on", !!h);
  }
  function hints() {
    const p = g.player;
    if (hintHold && performance.now() - hintHoldAt < hintHold * 1000) return;
    hintHold = 0;
    let h = "";
    if (g.mode === "play" && p && canAct(p) && sandwiched(p)) h = mobile ? "SANDWICHED · SWIPE ◀ ▶ TO AIM" : "SANDWICHED · HOLD ◀ ▶ TO PICK WHO YOU HIT";
    // jumped at a container: a side now is a diagonal wall run off it (the first few times)
    if (!h && g.mode === "play" && p && (p.diags || 0) < 3 && (diagArmed(p) || canDiag(p))) h = (mobile ? "SWIPE" : "PRESS") + " ◀ ▶ TO WALL-RUN OFF IT";
    if (!h && g.mode === "play" && p && !p.air) {          // jacks on the road in your lane
      for (let i = 0; i < jacks.length && !h; i++) { const j = jacks[i], d = p.z - j.z; if (!j.air && Math.abs(p.x - j.x) < 1.1 && d > 2 && d < 18) h = (mobile ? "TAP" : "JUMP") + " THE JACKS!"; }
    }
    // the first time a rival is in range, say how to throw
    if (!h && g.mode === "play" && p && p.jacks === JACKS_N && !g.jackTip && g.t > 5 && g.agents.some(function (r) { const d = p.z - r.z; return r !== p && d > 5 && d < 22; })) {
      g.jackTip = true; setHint(mobile ? "HIT JACKS TO TRIP THE RUNNER AHEAD" : "PRESS I TO THROW JACKS AT THE RUNNER AHEAD", 2.6); return;
    }
    if (!h && g.mode === "play" && p && !p.arm && canAct(p)) {
      for (let i = 0; i < W.slabs.length && !h; i++) {
        const s = W.slabs[i], d = p.z - s.z0, e = p.z - s.z1;
        const fx = s.face && d > 2 && d < 30 ? faceFixture(p, s) : null;
        if (fx && g.t < 90) h = fx.type === "stairs" ? "TAKE THE STAIRS" : (mobile ? "TAP" : "JUMP") + " TO " + (fx.type === "wallrun" ? "RUN UP THE WALL" : "CLIMB");
        else if (s.bar && !(s.bar.used && s.bar.used[p.slot]) && e > 0 && e < 26 && p.z > s.z1) h = (mobile ? "TAP" : "JUMP") + " AT THE EDGE TO GRAB THE BAR";
      }
    }
    setHint(h);
  }
  function show(id) { ["screen-menu", "screen-over", "screen-pause"].forEach(function (n) { $(n).classList.toggle("show", n === id); }); }
  function toMenu() {
    removeAgents(); clearJacks(); g.player = null; g.mode = "menu"; g.series = null;
    if (!g.opp) g.opp = pickOpponents(); showVs();
    $("banner").classList.remove("on");
    $("hud").classList.remove("on"); $("pad").classList.remove("on");
    show("screen-menu"); setHint("");
  }
  function togglePause() {
    if (g.mode === "play" || g.mode === "countdown") { g.prevMode = g.mode; g.mode = "paused"; show("screen-pause"); A.wind(0, false); }
    else if (g.mode === "paused") { g.mode = g.prevMode || "play"; show(null); }
  }
  function toggleMute() { A.setMuted(!A.muted); $("btn-mute").textContent = A.muted ? "🔇" : "🔊"; }
  $("btn-play").addEventListener("click", startRace);
  $("btn-again").addEventListener("click", startRace);
  $("btn-menu").addEventListener("click", toMenu);
  $("btn-resume").addEventListener("click", togglePause);
  $("btn-quit").addEventListener("click", function () { g.mode = "paused"; toMenu(); });
  $("btn-pause").addEventListener("click", togglePause);
  $("btn-mute").addEventListener("click", function () { A.unlock(); toggleMute(); });
  $("btn-mute").textContent = A.muted ? "🔇" : "🔊";
  document.addEventListener("visibilitychange", function () { if (document.hidden && (g.mode === "play" || g.mode === "countdown")) togglePause(); });
  $("controls-text").innerHTML = mobile
    ? "<b>Swipe</b> ← → lane · ↑ jump · ↓ slide · tap twice to flip<br>Buttons: PUNCH · KICK · SPECIAL · BLOCK · <b>JACKS</b><br>Moves change with where your rival is: beside you, ahead, behind.<br>3 handfuls of jacks a race: they trip whoever runs over them."
    : "<b>← →</b> lane · <b>↑ / Space</b> jump (twice to flip) · <b>↓</b> slide<br><b>J</b> punch · <b>K</b> kick · <b>L</b> special · <b>U / Shift</b> block · <b>I</b> jacks<br>Moves change with where your rival is: beside you, ahead, behind.<br>3 handfuls of jacks a race: they trip whoever runs over them.";
  ROSTER.forEach(function (c, i) {
    const b = document.createElement("button");
    b.dataset.i = i; b.textContent = c.name;
    b.addEventListener("click", function () { g.pick = i; g.opp = pickOpponents(); refreshPick(); });
    $("chars").appendChild(b);
  });
  function refreshPick() {
    Array.prototype.forEach.call(document.querySelectorAll("#chars button"), function (b) { b.classList.toggle("on", +b.dataset.i === g.pick); });
    try { localStorage.setItem("sr_pick", String(g.pick)); } catch (e) {}
    showVs();
  }
  try { const s = parseInt(localStorage.getItem("sr_pick"), 10); if (s >= 0 && s < ROSTER.length) { g.pick = s; g.opp = pickOpponents(); } } catch (e) {}
  const bestVals = Object.keys(best).map(function (k) { return best[k]; });
  $("menu-best").textContent = bestVals.length ? "Best time " + Math.min.apply(null, bestVals) + " s" : "";

  // ---------- loop ----------
  let last = performance.now(), acc = 0, ft = 16, frames = 0, tAcc = 0, resizeNext = false;
  function frame(now) {
    requestAnimationFrame(frame);
    if (resizeNext) { resizeNext = false; renderer.setPixelRatio(pixelRatio); resize(); }
    let dt = (now - last) / 1000; last = now;
    if (dt > 0.25) dt = 0.25;
    acc += dt;
    let n = 0;
    while (acc >= 1 / 60 && n < 5) { step(1 / 60); acc -= 1 / 60; n++; }
    if (n === 5) acc = 0;
    hints();
    updateCamera(dt, false);
    renderer.render(scene, camera);
    ft += (dt * 1000 - ft) * 0.05; frames++; tAcc += dt;
    if (tAcc > 1.2 && frames > 30) {
      if (ft > 24 && pixelRatio > 0.6) { pixelRatio = Math.max(0.6, pixelRatio - 0.15); resizeNext = true; }
      else if (ft < 14 && pixelRatio < pixelMax) { pixelRatio = Math.min(pixelMax, pixelRatio + 0.1); resizeNext = true; }
      tAcc = 0;
    }
  }

  // ---------- test helpers ----------
  g.sim = function (seconds) {      // run the race without rendering
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n && (g.mode === "play" || g.mode === "countdown" || g.mode === "finishing"); i++) step(1 / 60);
    const hit = {};
    g.agents.forEach(function (a) { hit[a.name] = { m: Math.round(-a.z), st: a.state, hits: a.hits, taken: a.taken, place: a.place || a.rank }; });
    g.agents.forEach(function (a) { hit[a.name].jacks = a.jacks; hit[a.name].diags = a.diags; });
    const S = g.series;
    return { mode: g.mode, t: +g.t.toFixed(1), agents: hit, stats: g.stats, slabs: W.slabs.length, trucks: W.cars.length, drops: g.drops, jacks: g.jackLog, falls: (g.fallLog || []).slice(0, 6), moves: g.moveLog, landed: g.landLog,
      series: S && { race: S.race, wins: S.wins, pts: S.pts, over: S.over, champ: S.champ } };
  };
  g.begin = startRace; g.step = step; g.snapCamera = function () { updateCamera(0.016, true); };
  window.addEventListener("resize", resize);
  resize();
  refreshPick();
  W.reset(g.seed); W.update(0, V0, 0, 0);
  updateCamera(0.016, true);
  $("loading").classList.add("gone");
  show("screen-menu");
  requestAnimationFrame(frame);

  // ?auto=1: the bot drives the player too (and starts the race); ?sim=N runs N seconds headless and
  // reports in the page title; ?until=fight|climb|finish freezes a frame for a screenshot
  (async function () {
    if (!params.get("auto") && !params.get("sim") && !params.get("until")) return;
    if (params.get("pick")) { g.pick = Math.max(0, Math.min(ROSTER.length - 1, parseInt(params.get("pick"), 10) || 0)); g.opp = pickOpponents(); }
    g.auto = !!params.get("auto");
    try { await startRace(); } catch (e) { document.title = "STARTERR " + e.message + " | " + (e.stack || "").split("\n").slice(0, 4).join(" ; "); return; }
    document.title = "STARTED " + g.mode + " agents=" + g.agents.length;
    // ?press=3.0:KeyJ,4.5:ArrowUp : drive the player like a keyboard (headless test of the controls);
    // with ?until= the presses run inside the until loop instead
    const sched = (params.get("press") || "").split(",").filter(Boolean).map(function (s) { const i = s.indexOf(":"); return { t: parseFloat(s.slice(0, i)), code: s.slice(i + 1), done: false }; });
    const presses = function () { sched.forEach(function (e) { if (!e.done && g.mode === "play" && g.t >= e.t) { e.done = true; window.dispatchEvent(new KeyboardEvent("keydown", { code: e.code })); } }); };
    if (sched.length && !params.get("until")) {
      const total = parseFloat(params.get("sim") || "20");
      let sec = 0;
      while ((g.mode === "play" || g.mode === "countdown") && sec < total * 60) { presses(); g.step(1 / 60); sec++; }
      params.delete("sim");
      const out = g.sim(0.0001); out.pressed = sched.filter(function (e) { return e.done; }).length;
      document.title = "PRESS " + JSON.stringify(out);
    }
    // ?series=1&sim=240: play the whole best of 3 with bots, one line per race
    if (params.get("series")) {
      const out = [];
      try {
        for (let k = 0; k < 3; k++) {
          const rc = RACES[g.series.race].name, r = g.sim(parseFloat(params.get("sim") || "240"));
          out.push({ race: rc, mode: r.mode, t: r.t, places: Object.keys(r.agents).map(function (n) { return n + ":" + r.agents[n].place; }).join(" "),
            truckZones: g.truckZones, drops: r.drops, jacks: r.jacks, stumbles: r.stats.stumbles });
          if (g.series.over || g.mode !== "over") break;
          await startRace();
        }
        const S = g.series;
        document.title = "SERIES " + JSON.stringify({ races: out, wins: S.wins, pts: S.pts, over: S.over, champ: S.champ });
      } catch (e) { document.title = "SERIESERR " + e.message + " | " + (e.stack || "").split("\n").slice(0, 4).join(" ; "); }
      return;
    }
    if (params.get("sim")) {
      try { const r = g.sim(parseFloat(params.get("sim"))); document.title = "SIM " + JSON.stringify(r); }
      catch (e) { document.title = "SIMERR " + e.message + " | " + (e.stack || "").split("\n").slice(0, 4).join(" ; "); }
    }
    if (params.get("until")) {
      const what = params.get("until");
      const ok = function () {
        const ags = g.agents;
        if (what === "fight") return ags.some(function (a) { return a.state === "atk" && a.atk && a.atk.target && a.runner.curT > a.atk.tHit - 0.02 && a.runner.curT < a.atk.tHit + 0.12; });
        if (what === "down") return ags.some(function (a) { return a.state === "down" && a.runner.curT > 0.5; });
        if (what === "climb") return ags.some(function (a) { return a.state === "climb" && a.climb && a.climb.kind === "wall" && a.y > 0.9 && a.y < 1.8; });
        if (what === "go") return g.mode === "play" && g.t > 0.5;
        if (what === "diag") return ags.some(function (a) { return a.state === "climb" && a.climb && a.climb.kind === "diag" && a.runner.curT > (+params.get("lead") || 0.5) && (!params.get("who") || a.player); });
        if (what.indexOf("atk-") === 0) return ags.some(function (a) { return a.state === "atk" && a.atk && a.atk.key === what.slice(4) && a.runner.curT > a.atk.tHit - (+params.get("lead") || 0.08); });
        if (what === "thrown") return jacks.some(function (j) { return j.owner === g.player && j.air && j.t > (+params.get("lead") || 0.1); });
        if (what === "fell") return g.player.state === "fell" && g.player.stateT < 1.1;
        if (what === "respawned") return g.fellTest && g.player.state === "run";
        if (what === "throw") return g.player.jackWind > 0 && g.player.jackWind < (+params.get("lead") || 0.05);
        if (what === "grabbed") return ags.some(function (a) { return a.state === "down" && a.runner.cur === "throwvictim" && a.runner.curT > (+params.get("vt") || 2.6); });
        if (what === "jacks") return jacks.some(function (j) { return j.air && !j.back && j.t / j.tf > 0.45; });
        if (what === "jackground") return jacks.some(function (j) { const d = g.player.z - j.z; return !j.air && d > 7 && d < 14; });
        if (what === "jackhit") return ags.some(function (a) { return a.state === "crash" && a.why === "jacks" && a.runner.curT > 0.35; });
        if (what === "truck") return W.barrels.some(function (b) { return b.air && !b.dead && g.player.z - b.z > 6 && g.player.z - b.z < 22; });
        return false;
      };
      let n = 0;
      while ((g.mode === "play" || g.mode === "countdown") && n++ < 60 * 600 && !(g.mode === "play" && ok())) { presses(); g.step(1 / 60); }
      const found = ok();
      g.mode = "paused"; $("screen-pause").classList.remove("show");
      document.title = "UNTIL " + what + " " + (found ? "hit" : "miss") + " t=" + (n / 60).toFixed(1);
      g.snapCamera();
    }
  })();
})(window.CJ = window.CJ || {});
