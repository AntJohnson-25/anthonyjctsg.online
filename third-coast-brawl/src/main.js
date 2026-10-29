// Third Coast Brawl: four riders race point to point across Houston, and anything goes on the
// way. Three events, one sport each (inline skates downtown, mountain bikes on the bayou trails,
// dirt bikes at the Ship Channel), or the TOUR: all three back to back for points.
// Controls are the arrow keys + SPACE only:
//   ◀ ▶ steer · ▼ brake · ▲ spend HYPE on a boost
//   SPACE: punch or kick a rider beside you; otherwise hold to crouch, let go to jump
//   in the air: ▲ front flip, ▼ backflip, ◀ ▶ 360 spins, hold SPACE to grab
// Tricks and knockdowns fill the HYPE meter.
(function (RR) {
  "use strict";
  const T = window.THREE;

  // ---------------- settings ----------------
  const QUALITY = {
    low:    { name: "LOW",    pr: 0.85, msaa: 0, shadow: 0,    terrainCell: 6,   ribbonCol: 1.0,  particles: 1200, motes: 0,   post: false },
    medium: { name: "MEDIUM", pr: 1.0,  msaa: 2, shadow: 1024, terrainCell: 4.5, ribbonCol: 0.85, particles: 2000, motes: 300, post: true },
    high:   { name: "HIGH",   pr: 1.5,  msaa: 4, shadow: 2048, terrainCell: 3.5, ribbonCol: 0.75, particles: 3000, motes: 600, post: true },
    ultra:  { name: "ULTRA",  pr: 2.0,  msaa: 4, shadow: 4096, terrainCell: 3,   ribbonCol: 0.7,  particles: 4500, motes: 900, post: true }
  };
  const QORDER = ["low", "medium", "high", "ultra"];
  const isTouch = window.matchMedia && matchMedia("(pointer: coarse)").matches;
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  let qKey = RR.param("q", null) || lsGet("tcb_q") || (isTouch ? "high" : "ultra");
  if (!QUALITY[qKey]) qKey = "ultra";
  const Q = QUALITY[qKey];

  // the user's characters (Ant is on the roster but not the default pick)
  const ROSTER = [
    { id: "Ch02", name: "SUNNY", num: 7, color: "#ff8a3d", skill: 0.985, aggr: 0.5, liv: { base: "#ff9a2e", nose: "#ffd84d", tail: "#ff4a3a", stripe: "#ffffff", rail: "#1a1a22" } },
    { id: "Ch06", name: "KICKS", num: 23, color: "#35e0a1", skill: 0.99, aggr: 0.9, liv: { base: "#1fc4a0", nose: "#a6f05a", tail: "#0f7f8f", stripe: "#0b2b2b", rail: "#0b2b2b" } },
    { id: "Lola_B_Styperek", name: "LOLA", num: 11, color: "#ff4fa3", skill: 0.98, aggr: 0.65, liv: { base: "#d1338a", nose: "#ff7ac2", tail: "#6a2bd9", stripe: "#ffffff", rail: "#2a0f3d" } },
    { id: "Ch36", name: "KNUCKLES", num: 99, color: "#ff3b3b", skill: 0.99, aggr: 0.95, liv: { base: "#c81d25", nose: "#ff6b35", tail: "#5a0b10", stripe: "#ffd23f", rail: "#141414" } },
    { id: "Ch18", name: "NOIR", num: 4, color: "#a78bfa", skill: 0.985, aggr: 0.7, liv: { base: "#2a2340", nose: "#a78bfa", tail: "#0b0816", stripe: "#a78bfa", rail: "#0b0816" } },
    { id: "Ant", name: "ANT", num: 1, color: "#ffd23f", skill: 1.0, aggr: 0.75, liv: { base: "#1a1a1a", nose: "#ffd23f", tail: "#0b0b0b", stripe: "#ffd23f", rail: "#0b0b0b" } },
    { id: "Rex", name: "REX", num: 8, color: "#4aa8ff", skill: 0.985, aggr: 0.7, liv: { base: "#1f6fd1", nose: "#7cc4ff", tail: "#0b2a5a", stripe: "#f2e6c8", rail: "#0b1a33" } },
    { id: "Dre", name: "DRE", num: 33, color: "#a6d84a", skill: 0.99, aggr: 0.8, liv: { base: "#5f8f2a", nose: "#c9f06a", tail: "#2a3d10", stripe: "#f4f4f0", rail: "#18240a" } },
    { id: "Tex", name: "TEX", num: 69, color: "#e0a050", skill: 0.985, aggr: 0.85, liv: { base: "#b8742a", nose: "#f2c27a", tail: "#4a2a0c", stripe: "#d63a2a", rail: "#241408" } }
  ];
  // menu-only flavour stats (the field plays even; these are for the rider cards)
  const STAT_LABELS = ["SPEED", "PUNCH", "TRICKS", "BALANCE", "HYPE"];
  const STATS = { Ch02: [80, 55, 85, 70, 75], Ch06: [75, 90, 60, 65, 80], Lola_B_Styperek: [85, 60, 90, 75, 70], Ch36: [70, 98, 50, 60, 65], Ch18: [82, 72, 70, 90, 60], Ant: [78, 75, 80, 80, 85], Rex: [90, 60, 75, 65, 70], Dre: [72, 80, 70, 92, 68], Tex: [80, 85, 60, 70, 90] };
  ROSTER.forEach(function (d) { d.st = STATS[d.id]; });
  // per sport: top speed (m/s), acceleration, turn rate, how much slope adds, jump, boost, punch reach,
  // camera, how far bikes lean, trick + grab names
  const SPORTS = {
    skate: { label: "INLINE SKATES", top: 15.5, accel: 4.2, turn: 2.15, grade: 70, jumpV: 6.6, boost: 5.5, reach: 2.9, camDist: 3.5, camH: 1.75, lean: 0.4, grab: "MUTE GRAB", trail: null },
    mtb: { label: "MOUNTAIN BIKE", top: 17, accel: 4.8, turn: 1.9, grade: 75, jumpV: 6.4, boost: 6, reach: 3.0, camDist: 4.1, camH: 1.95, lean: 0.55, grab: "NO-HANDER", trail: [0.16, 0.11, 0.07, 0.45] },
    moto: { label: "DIRT BIKE", top: 28, accel: 9, turn: 1.6, grade: 60, jumpV: 7.4, boost: 8.5, reach: 3.1, camDist: 4.7, camH: 2.15, lean: 0.65, grab: "SUPERMAN", trail: [0.2, 0.14, 0.09, 0.55] }
  };
  const GRAV = 20, PUNCH_CD = 0.9, HYPE_COST = 40;
  const TRICKS = {
    front: { axis: "x", dir: -1, dur: 0.6, name: "FRONT FLIP", hype: 30 },
    back: { axis: "x", dir: 1, dur: 0.6, name: "BACKFLIP", hype: 30 },
    spinL: { axis: "y", dir: 1, dur: 0.5, name: "360", hype: 18 },
    spinR: { axis: "y", dir: -1, dur: 0.5, name: "360", hype: 18 }
  };
  const TOUR_PTS = [10, 6, 3, 1];

  // test hooks
  const PORTRAIT = RR.num("portrait", 0) === 1;
  if (PORTRAIT) document.documentElement.classList.add("portrait");
  const AUTO = RR.num("auto", 0) === 1, SIM = RR.num("sim", 0), UNTIL = RR.param("until", ""), LEAD = RR.num("lead", 0.15);
  const CAM_SIDE = RR.param("cam", "") === "side";
  const WHO = RR.param("who", "p"), SEED = RR.num("seed", 7), NOMENU = RR.num("race", 0) === 1 || SIM > 0 || !!UNTIL;
  const PRESS = RR.param("press", "").split(",").filter(Boolean).map(function (s) { const a = s.split(":"); return { t: +a[0], k: a[1] }; })
    .concat(RR.param("hold", "").split(",").filter(Boolean).map(function (s) { const a = s.split(":"), r = a[1].split("-"); return { k: a[0], t: +r[0], t1: +r[1], done: true }; }));

  // ---------------- engine ----------------
  const canvas = document.getElementById("view");
  const renderer = new T.WebGLRenderer({ canvas: canvas, antialias: !Q.post, powerPreference: "high-performance", stencil: false });
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = Q.post ? T.NoToneMapping : T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = Q.shadow > 0;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(62, 1, 0.08, 7000);
  const post = Q.post ? new RR.Post(renderer, Q) : null;

  const G = RR.game = { scene: scene, camera: camera, racers: [], all: [], t: 0, state: "loading", pick: 0, ev: 0, raceT: 0, countT: 0, paused: false, rnd: RR.rng(SEED), events: {}, stats: { punches: 0, kos: 0, tricks: 0, boosts: 0 } };
  const EVENTS = RR.COURSE_ORDER.concat(["tour"]);

  let world = null, track = null, S = null, sport = "skate", SP = SPORTS.skate, sky, fx, motes = null;
  let renderScale = 1, frameAcc = 0, frameN = 0;

  function resize() {
    const w = innerWidth, h = innerHeight, pr = Math.min(window.devicePixelRatio || 1, Q.pr) * renderScale;
    renderer.setPixelRatio(1);
    renderer.setSize(Math.round(w * pr), Math.round(h * pr), false);
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (post) post.setSize(Math.round(w * pr), Math.round(h * pr));
    const sc = h * pr / (2 * Math.tan(camera.fov * Math.PI / 360));
    if (fx) fx.mat.uniforms.uScale.value = sc;
    if (motes) motes.mat.uniforms.uScale.value = sc;
  }
  addEventListener("resize", resize);

  // ---------------- loading ----------------
  const $ = function (id) { return document.getElementById(id); };
  const loadText = $("loading-text");
  function loadChars(done) {
    if (window.CJ_CHARS && ROSTER.every(function (d) { return CJ_CHARS[d.id]; })) { done(); return; }
    let left = ROSTER.length;
    ROSTER.forEach(function (d) {
      const s = document.createElement("script");
      s.src = "src/chars/" + d.id + ".js";
      s.onload = function () { left--; loadText.textContent = "LOADING RIDERS " + (ROSTER.length - left) + "/" + ROSTER.length; if (!left) done(); };
      s.onerror = function () { loadText.textContent = "COULD NOT LOAD " + d.id; };
      document.body.appendChild(s);
    });
  }

  function build() {
    sky = new RR.Sky(scene, renderer, Q);
    fx = G.fx = new RR.Particles(scene, Q.particles);
    ROSTER.forEach(function (d, i) { G.all.push(makeRacer(d, i)); });
    resize();
  }
  // build (or swap to) an event's world: the course, its sky, motes, everyone's machines
  function setCourse(key) {
    if (world && world.key === key) return;
    if (world) world.dispose();
    if (motes) { motes.dispose(scene); motes = null; }
    world = G.world = new RR.World(scene, Q, key, 3);
    track = G.track = world.track; S = world.S;
    sport = world.def.sport; SP = SPORTS[sport];
    sky.set(world.def.sky);
    if (Q.motes) {
      const mo = { skate: { color: 0xffe6c8, fall: 0.05, size: 0.02, alpha: 0.35 }, mtb: { color: 0xfff4c0, fall: 0.06, size: 0.025, alpha: 0.6 }, moto: { color: 0xff9a40, rise: 0.6, size: 0.03, alpha: 0.85, additive: true } }[sport];
      motes = new RR.Motes(scene, Q.motes, mo);
    }
    const tc = SP.trail;
    RR.trailMat.uniforms.uA.value = tc ? tc[3] : 0;
    if (tc) RR.trailMat.uniforms.uCol.value.setRGB(tc[0], tc[1], tc[2]);
    G.all.forEach(function (r) { useVehicle(r, sport); });
    buildMinimap();
    resize();
  }

  // ---------------- racers ----------------
  function makeRacer(d, i) {
    const rider = new RR.Rider(d.id);
    const g = new T.Group(), tilt = new T.Group(), pivot = new T.Group(), spin = new T.Group(), body = new T.Group();
    g.add(tilt); tilt.add(pivot); pivot.position.y = 0.95; pivot.add(spin); spin.add(body); body.position.y = -0.95;
    body.add(rider.r.root);
    scene.add(g);
    const tag = document.createElement("div");
    tag.className = "tag"; tag.innerHTML = '<b style="color:' + d.color + '">' + d.name + '</b><i></i>';
    $("tags").appendChild(tag);
    const liv = Object.assign({ baseCss: d.liv.base }, d.liv);
    return {
      def: d, name: d.name, i: i, rider: rider, g: g, tilt: tilt, pivot: pivot, spin: spin, body: body, liv: liv, veh: {}, v: null,
      trail: new RR.Trail(scene, 110), tag: tag, tagI: tag.querySelector("i"), n: new T.Vector3(0, 1, 0), anch: {},
      tiltQ: new T.Quaternion(), ai: { lat: 0, latT: 0, jumpT: 3, plan: 0, punchT: 2 }, stride: { phase: 0, amp: 0 }, crank: 0, stand: 0.5, tuck: 0
    };
  }
  function useVehicle(r, sp) {
    for (const k in r.veh) { r.veh[k].setVisible(false); if (r.veh[k].group.parent) r.veh[k].group.parent.remove(r.veh[k].group); if (r.veh[k].skates) r.veh[k].skates.forEach(function (s) { scene.remove(s); }); }
    if (!r.veh[sp]) r.veh[sp] = new RR.Vehicle(sp, r.liv, r.def.num);
    const v = r.v = r.veh[sp];
    if (v.skates) v.skates.forEach(function (s) { scene.add(s); });
    else r.body.add(v.group);
    v.setVisible(r.g.visible);
    r.trail.w = sp === "moto" ? 0.13 : 0.06;
  }
  function setActive(r, on) {
    r.g.visible = on; r.trail.mesh.visible = on;
    if (r.v) r.v.setVisible(on);
    if (!on) { r.tag.style.display = "none"; attachRider(r); }
  }
  function resetRacer(r, slot) {
    const rows = [[S.start - 4, -2.8], [S.start - 4, 2.8], [S.start - 10, -2.8], [S.start - 10, 2.8]][slot];
    const p = track.at(rows[0], rows[1]);
    Object.assign(r, {
      x: p.x, z: p.z, y: 0, vy: 0, yaw: p.yaw, speed: 0, steer: 0, air: false, airT: 0, onRamp: false,
      trick: null, trickQ: null, tricks: [], grabT: 0, grabbing: false, charge: 0, boost: 0, crouch: 0.3, crouchV: 0, lean: 0,
      state: "ride", wipeT: 0, finished: false, finishT: 0, place: slot + 1, hype: RR.num("hype", 0), bal: 1, stagT: 0,
      punchT: -1, hitT: -1, punchCD: 0, punchTgt: null, punchArm: "Left", punchKind: "punch", punchHit: false, spaceUsed: false,
      inv: 0, bonkCD: 0, wrongT: 0, braking: false, surf: null, splashCD: 0, slotLat: rows[1],
      st: { wipeouts: 0, hits: 0, tricks: 0, kos: 0 }
    });
    r.ti = track.nearestAny(p.x, p.z);
    r.y = G.ground(r.x, r.z, r.ti);
    r.raceDist = r.ti * track.ds - S.start;
    r.ai.lat = rows[1]; r.ai.latT = 2 + G.rnd() * 2; r.ai.jumpT = 4 + G.rnd() * 6; r.ai.punchT = 1 + G.rnd() * 2;
    r.stride.amp = 0; r.stand = sport === "moto" ? 0.8 : 0;
    attachRider(r);
    r.spin.quaternion.identity();
    r.trail.clear();
  }
  function attachRider(r) {
    const root = r.rider.r.root;
    if (root.parent !== r.body) r.body.add(root);
    root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); root.visible = true;
    r.rider.r.play("idle", { loop: true, fade: 0.15 });
  }
  G.ground = function (x, z, hint) { return world.ground(x, z, hint); };

  // ---------------- input ----------------
  const keys = {}, edges = {}, ups = {};
  const KEYMAP = { ArrowLeft: "L", ArrowRight: "R", ArrowUp: "U", ArrowDown: "D", Space: "S" };
  addEventListener("keydown", function (e) {
    const k = KEYMAP[e.code];
    if (!k) return;
    e.preventDefault();
    RR.Audio.init();
    if (e.repeat) return;
    keys[k] = true; edges[k] = true;
    uiKey(k);
  });
  addEventListener("keyup", function (e) { const k = KEYMAP[e.code]; if (k) { if (keys[k]) ups[k] = true; keys[k] = false; e.preventDefault(); } });
  document.querySelectorAll("[data-key]").forEach(function (b) {
    const k = b.getAttribute("data-key");
    function down(e) { e.preventDefault(); RR.Audio.init(); if (!keys[k]) { keys[k] = true; edges[k] = true; uiKey(k); } b.classList.add("on"); }
    function up(e) { e.preventDefault(); if (keys[k]) ups[k] = true; keys[k] = false; b.classList.remove("on"); }
    b.addEventListener("touchstart", down, { passive: false }); b.addEventListener("touchend", up, { passive: false }); b.addEventListener("touchcancel", up, { passive: false });
    b.addEventListener("mousedown", down); b.addEventListener("mouseup", up); b.addEventListener("mouseleave", function (e) { if (keys[k]) up(e); });
  });
  function take(k) { const v = edges[k]; edges[k] = false; return v; }
  function takeUp(k) { const v = ups[k]; ups[k] = false; return v; }

  // ---------------- HUD ----------------
  const hud = { place: $("place"), lap: $("lap"), time: $("time"), hype: $("hype"), hypeFill: $("hype-fill"), hypeTxt: $("hype-txt"), toast: $("toast"), trick: $("trick"), count: $("count"), wrong: $("wrong"), mini: $("mini") };
  let toastT = 0, trickT = 0;
  function toast(text, cls, dur) { hud.toast.textContent = text; hud.toast.className = "show " + (cls || ""); toastT = dur || 1.4; }
  function trickText(text) { hud.trick.innerHTML = text; hud.trick.className = "show"; trickT = 1.7; }
  function ordinal(n) { return n + (n === 1 ? "ST" : n === 2 ? "ND" : n === 3 ? "RD" : "TH"); }
  function fmtTime(s) { const m = Math.floor(s / 60), r = s - m * 60; return m + ":" + (r < 10 ? "0" : "") + r.toFixed(2); }

  let mini = null;
  function buildMinimap() {
    const c = hud.mini, g = c.getContext("2d");
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < track.n; i++) { x0 = Math.min(x0, track.x[i]); x1 = Math.max(x1, track.x[i]); z0 = Math.min(z0, track.z[i]); z1 = Math.max(z1, track.z[i]); }
    const W = c.width, H = c.height, pad = 12, k = Math.min((W - pad * 2) / (x1 - x0 + 40), (H - pad * 2) / (z1 - z0));
    mini = { g: g, k: k, ox: W / 2 - (x0 + x1) / 2 * k, oz: H / 2 + (z0 + z1) / 2 * k, W: W, H: H };
  }
  function mx(x) { return x * mini.k + mini.ox; }
  function mz(z) { return -z * mini.k + mini.oz; }
  function drawMinimap() {
    const m = mini, g = m.g;
    g.clearRect(0, 0, m.W, m.H);
    g.lineJoin = "round"; g.lineCap = "round";
    g.beginPath();
    for (let i = 0; i < track.n; i += 4) { const X = mx(track.x[i]), Y = mz(track.z[i]); if (!i) g.moveTo(X, Y); else g.lineTo(X, Y); }
    g.strokeStyle = "rgba(20,10,30,0.55)"; g.lineWidth = 9; g.stroke();
    g.strokeStyle = "rgba(255,240,225,0.95)"; g.lineWidth = 4.5; g.stroke();
    [S.start, S.finish].forEach(function (s, k) {
      const p = track.at(s, 0);
      g.strokeStyle = k ? "#ff5a3c" : "#7dffb3"; g.lineWidth = 3; g.beginPath();
      g.moveTo(mx(p.x - p.rx * 20), mz(p.z - p.rz * 20)); g.lineTo(mx(p.x + p.rx * 20), mz(p.z + p.rz * 20)); g.stroke();
    });
    G.racers.slice().sort(function (a, b) { return (a === G.player) - (b === G.player); }).forEach(function (r) {
      const X = mx(r.x), Y = mz(r.z), me = r === G.player;
      g.beginPath(); g.arc(X, Y, me ? 6 : 4.5, 0, 6.283);
      g.fillStyle = r.def.color; g.fill();
      g.lineWidth = me ? 2.5 : 1.5; g.strokeStyle = me ? "#fff" : "rgba(0,0,0,0.6)"; g.stroke();
    });
  }

  // ---------------- sound + events ----------------
  G.sound = function (name, src, vol) {
    let v = vol === undefined ? 1 : vol;
    if (src && src.x !== undefined && G.player) {
      const d = Math.hypot(src.x - camera.position.x, src.z - camera.position.z);
      v *= 1 / (1 + d * d / 900);
    }
    if (!SIM) RR.Audio.play(name, v);
  };
  function emit(name, r) {
    if (WHO === "any" || r === G.player || r === undefined) G.events[name] = G.events[name] || G.t;
  }
  const DUST = { skate: [0.62, 0.6, 0.56], mtb: [0.42, 0.31, 0.21], moto: [0.5, 0.37, 0.24] };

  // ---------------- wipeouts ----------------
  const WIPE_TEXT = { punch: "KNOCKED DOWN!", kick: "KICKED OFF!", bail: "BAILED!", crash: "WIPEOUT!", wall: "WIPEOUT!" };
  G.wipeout = function (r, reason, by, px, pz) {
    if (r.state !== "ride" || r.inv > 0 || (r.finished && reason !== "bail")) return false;
    r.state = "wipe"; r.wipeT = 0; r.landed = false;
    r.trick = null; r.trickQ = null; r.tricks = []; r.boost = 0; r.charge = 0; r.grabbing = false; r.punchT = -1;
    r.st.wipeouts++;
    if (SIM) { r.st.why = r.st.why || {}; r.st.why[reason] = (r.st.why[reason] || 0) + 1; }
    if (by && by !== r) { by.st.hits++; by.st.kos++; by.hype = Math.min(100, by.hype + 25); G.stats.kos++; emit("ko", by); }
    const root = r.rider.r.root;
    root.updateWorldMatrix(true, false);
    const wp = new T.Vector3().setFromMatrixPosition(r.body.matrixWorld);
    scene.attach(root);
    root.position.copy(wp);
    root.rotation.set(0, r.yaw + (reason === "bail" ? 0 : Math.PI), 0);
    const fx_ = -Math.sin(r.yaw), fz_ = -Math.cos(r.yaw);
    r.rv = new T.Vector3(fx_ * r.speed * 0.4 + (px || 0) * 4, 4.5 + (r.air ? 0 : 1), fz_ * r.speed * 0.4 + (pz || 0) * 4);
    r.rider.r.play(reason === "bail" ? "crash" : "thrown", { loop: false, rate: reason === "bail" ? 1.3 : 1.35, fade: 0.08, t: reason === "bail" ? 0.2 : 0.4 });
    r.boardRoll = 0; r.boardSpin = (G.rnd() - 0.5) * 4; r.rollSign = G.rnd() < 0.5 ? -1 : 1;
    r.air = false;
    G.sound("slam", r);
    if (r === G.player) { toast(WIPE_TEXT[reason] || "WIPEOUT!", "bad", 1.8); flash = 0.15; shake = 0.6; }
    else if (by === G.player) { toast(r.name + (reason === "kick" ? " KICKED DOWN!" : " KNOCKED OUT!"), "good", 1.4); trickText("KNOCKDOWN<small>+25 HYPE</small>"); }
    emit("wipe", r); emit("wipe-" + reason, r);
    return true;
  };
  function stepWipe(r, dt) {
    r.wipeT += dt;
    const root = r.rider.r.root, h = G.ground(root.position.x, root.position.z, r.ti);
    if (!r.landed) {
      r.rv.y -= GRAV * 0.9 * dt;
      root.position.addScaledVector(r.rv, dt);
      if (r.wipeT > 0.25 && root.position.y < h + 0.1) {
        r.landed = true;
        if (!SIM) fx.splash(root.position.x, h, root.position.z, true, DUST[sport]);
        G.sound("land", { x: root.position.x, z: root.position.z });
      }
    } else {
      r.rv.multiplyScalar(Math.exp(-2.4 * dt));
      root.position.x += r.rv.x * dt; root.position.z += r.rv.z * dt;
      root.position.y = RR.lerp(root.position.y, h - 0.08, 1 - Math.exp(-dt * 8));
    }
    // the machine skids on, tips over and spins
    r.speed *= Math.exp(-1.6 * dt);
    r.x += -Math.sin(r.yaw) * r.speed * dt; r.z += -Math.cos(r.yaw) * r.speed * dt;
    r.yaw += r.boardSpin * dt * Math.exp(-r.wipeT);
    r.ti = track.nearest(r.x, r.z, r.ti, 12);
    r.y = G.ground(r.x, r.z, r.ti);
    r.boardRoll = Math.min(sport === "skate" ? 0 : 1.32, r.boardRoll + dt * 4);
    collide(r);
    if (r.wipeT > 2.0) respawn(r);
  }
  function respawn(r) {
    const i = track.nearest(r.x, r.z, r.ti);
    const lat = RR.clamp(track.lateral(r.x, r.z, i), -track.halfW * 0.6, track.halfW * 0.6);
    let p = track.at(i * track.ds, lat);
    if (G.obstacleAt(p.x, p.z, 1.5)) p = track.at(i * track.ds, 0);
    r.x = p.x; r.z = p.z; r.yaw = p.yaw; r.ti = i;
    r.y = G.ground(r.x, r.z, r.ti); r.vy = 0; r.speed = SP.top * 0.4;
    r.state = "ride"; r.inv = 1.8; r.air = false; r.boardRoll = 0; r.bal = 1; r.stagT = 0;
    attachRider(r);
    emit("respawn", r);
  }
  G.obstacleAt = function (x, z, pad) {
    const o = world.obstacles;
    for (let i = 0; i < o.length; i++) { const dx = x - o[i].x, dz = z - o[i].z; if (dx * dx + dz * dz < (o[i].r + pad) * (o[i].r + pad)) return o[i]; }
    return null;
  };

  // ---------------- punches and kicks ----------------
  // a rival beside you, within reach, not far ahead or behind
  function punchTarget(r) {
    let best = null, bd = SP.reach;
    const fx_ = -Math.sin(r.yaw), fz_ = -Math.cos(r.yaw);
    G.racers.forEach(function (o) {
      if (o === r || o.state !== "ride" || o.inv > 0 || Math.abs(o.y - r.y) > 1.3) return;
      const dx = o.x - r.x, dz = o.z - r.z, d = Math.hypot(dx, dz), along = dx * fx_ + dz * fz_;
      if (d < bd && along > -2.0 && along < 2.2) { bd = d; best = o; }
    });
    return best;
  }
  function startPunch(r, tgt) {
    const fx_ = -Math.sin(r.yaw), fz_ = -Math.cos(r.yaw), rx = Math.cos(r.yaw), rz = -Math.sin(r.yaw);
    const dx = tgt.x - r.x, dz = tgt.z - r.z, side = dx * rx + dz * rz, along = dx * fx_ + dz * fz_;
    r.punchT = 0; r.punchTgt = tgt; r.punchHit = false; r.punchCD = PUNCH_CD;
    // a kick when they're level or behind you (or most of the time on skates), a punch when they're ahead
    r.punchKind = along < -0.4 || (sport === "skate" && G.rnd() < 0.5) ? "kick" : "punch";
    r.punchArm = side < 0 ? "Left" : "Right";
    r.punchStyle = G.rnd() < 0.4 ? "hook" : "jab";
    G.stats.punches++;
    G.sound("whiff", r, 0.8);
    emit("punch", r);
  }
  function stepPunch(r, dt) {
    if (r.punchT < 0) return;
    r.punchT += dt;
    if (!r.punchHit && r.punchT >= 0.24) {
      r.punchHit = true;
      const o = r.punchTgt, d = Math.hypot(o.x - r.x, o.z - r.z);
      if (o.state === "ride" && o.inv <= 0 && d < SP.reach + 0.8) {
        const nx = (o.x - r.x) / (d || 1), nz = (o.z - r.z) / (d || 1);
        G.sound(r.punchKind, o);
        if (!SIM) fx.burst(o.x, o.y + 1.2, o.z, 14, 2.2, 2.0, 1.6, 3, 0.25, 0.08);
        // the victim rocks back (side = which way they're pushed); a short hit-stop sells the contact
        o.hitT = 0; o.hitSide = Math.sign((nx * Math.cos(o.yaw) + nz * -Math.sin(o.yaw))) || 1;
        if (!SIM && (o === G.player || r === G.player)) hitStop = 0.09;
        o.bal -= 0.55 + (r.def.aggr - 0.7) * 0.2;
        emit("punchhit", r);
        if (o.bal <= 0 || o.air) G.wipeout(o, r.punchKind, r, nx, nz);
        else {
          // a stagger: knocked sideways, scrubs speed, wobbles
          o.stagT = 0.7; o.speed *= 0.82; o.x += nx * 0.4; o.z += nz * 0.4; o.yaw += (G.rnd() - 0.5) * 0.3;
          r.hype = Math.min(100, r.hype + 8);
          if (o === G.player) { shake = 0.45; toast("HIT!", "bad", 0.8); }
          else if (r === G.player) trickText((r.punchKind === "kick" ? "KICK" : "PUNCH") + "<small>+8 HYPE</small>");
        }
      }
    }
    if (r.punchT > 0.62) r.punchT = -1;
  }

  // ---------------- collisions: obstacles, walls, the garage ceiling ----------------
  function collide(r) {
    const o = world.obstacles;
    for (let i = 0; i < o.length; i++) {
      const dx = r.x - o[i].x, dz = r.z - o[i].z, rr = o[i].r + 0.5, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1, nx = dx / d, nz = dz / d;
        r.x = o[i].x + nx * rr; r.z = o[i].z + nz * rr;
        const fx_ = -Math.sin(r.yaw), fz_ = -Math.cos(r.yaw), into = -(fx_ * nx + fz_ * nz);
        if (into > 0) {
          const tx = fx_ + nx * into, tz = fz_ + nz * into;
          if (Math.hypot(tx, tz) > 0.05) r.yaw = RR.lerp(r.yaw, r.yaw + RR.wrapAngle(Math.atan2(-tx, -tz) - r.yaw), 0.5);
          if (r.state === "ride" && r.bonkCD <= 0) {
            if (into > 0.75 && r.speed > SP.top * 0.7 && !r.air) { G.wipeout(r, "crash", null, nx, nz); return; }
            r.speed *= 1 - 0.45 * into; r.bonkCD = 0.5; G.sound("bump", r); if (r === G.player) shake = 0.35;
          }
        }
      }
    }
    const s = r.ti * track.ds, lat = track.lateral(r.x, r.z, r.ti), W = world.wall(s);
    const lim = lat < 0 ? W[0] : W[1];
    if (Math.abs(lat) > lim) {
      const sg = Math.sign(lat), push = Math.abs(lat) - lim;
      r.x -= -track.tz[r.ti] * sg * push; r.z -= track.tx[r.ti] * sg * push;
      const ty = Math.atan2(-track.tx[r.ti], -track.tz[r.ti]);
      r.yaw = RR.lerp(r.yaw, r.yaw + RR.wrapAngle(ty - r.yaw), 0.35);
      if (r.bonkCD <= 0 && r.state === "ride") { r.speed *= 0.86; r.bonkCD = 0.5; G.sound("bump", r); if (r === G.player) shake = 0.25; }
    }
  }

  // ---------------- tricks ----------------
  function startTrick(r, type) {
    if (!r.trick) { r.trick = { type: type, a: 0 }; emit("trick", r); }
    else if (!r.trickQ) r.trickQ = type;
  }
  function trickName(list, grab) {
    const names = list.map(function (t) { return TRICKS[t].name; });
    const out = [];
    for (let i = 0; i < names.length; i++) {
      let n = 1; while (names[i + n] === names[i]) n++;
      if (names[i] === "360") out.push(n === 1 ? "360" : n === 2 ? "720" : (360 * n) + "");
      else out.push((n === 2 ? "DOUBLE " : n === 3 ? "TRIPLE " : "") + names[i]);
      i += n - 1;
    }
    if (grab) out.push(SP.grab);
    return out.join(" + ");
  }
  function land(r) {
    r.air = false;
    let bail = false;
    if (r.trick) {
      const a = r.trick.a, rem = Math.PI * 2 - a;
      if (rem < 0.75) r.tricks.push(r.trick.type);
      else if (a > 0.6) bail = true;
      r.trick = null; r.trickQ = null;
    }
    r.spin.quaternion.identity();
    r.grabbing = false;
    if (bail) { r.tricks = []; G.wipeout(r, "bail", null, 0, 0); return; }
    r.crouchV -= 2.6;
    const n = r.tricks.length, grab = r.grabT > 0.35;
    if (!SIM && r.airT > 0.35) fx.splash(r.x, r.y, r.z, r.airT > 0.9, DUST[sport]);
    G.sound("land", r, Math.min(1, 0.4 + r.airT * 0.5));
    if (n || grab) {
      let hype = 0;
      r.tricks.forEach(function (t) { hype += TRICKS[t].hype; });
      if (grab) hype += 22;
      hype = Math.round(hype * (1 + 0.25 * Math.max(0, n + (grab ? 1 : 0) - 1)));
      r.hype = Math.min(100, r.hype + hype);
      r.boost = Math.max(r.boost, Math.min(1.6, 0.4 + 0.35 * n));
      r.st.tricks += n; G.stats.tricks += n;
      if (r === G.player) trickText(trickName(r.tricks, grab) + "<small>+" + hype + " HYPE</small>");
      emit("landtrick", r);
    } else if (r.airT > 1.0 && r === G.player) { r.hype = Math.min(100, r.hype + 6); trickText("BIG AIR<small>+6 HYPE</small>"); }
    r.tricks = []; r.grabT = 0;
    emit("land", r);
  }

  // ---------------- the bots ----------------
  function aiDrive(r, dt, inp) {
    const ai = r.ai, d = r.def, rnd = G.rnd;
    ai.latT -= dt;
    if (ai.latT <= 0) { ai.lat = (rnd() - 0.5) * track.halfW * 1.1; ai.latT = 2 + rnd() * 3; }
    let lat = ai.lat;
    const s = r.ti * track.ds;
    // kickers: the better riders go for them
    world.ramps.forEach(function (m) {
      const u = m.userData, ds = u.ti * track.ds - s;
      if (ds > 2 && ds < 45) {
        ai.rampPick = ai.rampPick || {};
        if (ai.rampPick[m.id] === undefined) ai.rampPick[m.id] = rnd() < 0.45 + 0.5 * d.skill * d.aggr;
        if (ai.rampPick[m.id]) lat = u.lat;
      }
    });
    // hunt a rival when feeling mean
    if (d.aggr > 0.6 && ai.hunt && ai.hunt.state === "ride") {
      const o = ai.hunt, ds = o.ti * track.ds - s;
      if (Math.abs(ds) < 12) lat = RR.lerp(lat, track.lateral(o.x, o.z, o.ti), 0.7);
    }
    // obstacles in the line
    world.obstacles.forEach(function (o) {
      if (Math.abs(o.lat) > track.halfW + 4) return;
      const ds = o.ti * track.ds - s;
      if (ds < 0 || ds > 40) return;
      if (Math.abs(o.lat - lat) < o.r + 2.0) lat = o.lat + (lat >= o.lat ? 1 : -1) * (o.r + 2.6);
    });
    const W = world.wall(s);
    lat = RR.clamp(lat, -Math.min(track.halfW - 1, W[0] - 1.5), Math.min(track.halfW - 1, W[1] - 1.5));
    const look = 8 + r.speed * 0.45, p = track.at(s + look, lat);
    const want = Math.atan2(-(p.x - r.x), -(p.z - r.z));
    inp.steer = RR.clamp(RR.wrapAngle(want - r.yaw) * 2.6, -1, 1);
    // brake into the tight corners
    const i2 = track.clampI(r.ti + Math.round((14 + r.speed * 1.2) / track.ds));
    const turn = Math.abs(RR.wrapAngle(Math.atan2(-track.tx[i2], -track.tz[i2]) - Math.atan2(-track.tx[r.ti], -track.tz[r.ti])));
    inp.brake = turn > 0.75 && r.speed > SP.top * (0.95 - 0.15 * d.skill);
    if (r.air) {
      const h = G.ground(r.x, r.z, r.ti), rem = (r.vy + Math.sqrt(Math.max(0, r.vy * r.vy + 2 * GRAV * Math.max(0, r.y - h)))) / GRAV;
      // only start a trick there's time to finish (now and then a rider misjudges it)
      if (!r.trick && ai.plan > 0 && r.airT > 0.06) {
        const ks = ["front", "back", "spinL", "spinR"], k = ks[Math.floor(rnd() * 4)];
        const misjudge = ai.misjudge === undefined ? (ai.misjudge = rnd() < 0.12 * (1.6 - d.skill)) : ai.misjudge;
        if (rem > TRICKS[k].dur * (misjudge ? 0.7 : 1.15)) { startTrick(r, k); ai.plan--; }
      }
      inp.grab = rem > 0.35 && ai.plan === 0 && !r.trick && rnd() < 0.6;
    } else {
      ai.plan = 0; ai.misjudge = undefined;
      ai.jumpT -= dt;
      if (ai.jumpT <= 0) { inp.jump = true; inp.charge = 0.5 + rnd() * 0.5; ai.jumpT = 6 + rnd() * 9; ai.plan = rnd() < 0.6 ? 1 : 0; }
    }
    if (r.onRamp || (r.air && r.airT < 0.05 && r.vy > 3)) ai.plan = Math.max(ai.plan, 1 + (rnd() < 0.5 * d.skill ? 1 : 0));
    // throw hands
    ai.punchT -= dt;
    if (!r.air && r.punchCD <= 0 && G.raceT > 3 && ai.punchT <= 0) {
      const tgt = punchTarget(r);
      if (tgt) { inp.punch = tgt; ai.punchT = 0.8 + (1.2 - d.aggr) * 2.5 + rnd() * 1.5; }
    }
    if (!ai.hunt || rnd() < dt * 0.1) ai.hunt = G.racers[Math.floor(rnd() * G.racers.length)] === r ? null : G.racers[Math.floor(rnd() * G.racers.length)];
    // spend hype on a straight
    if (r.hype >= HYPE_COST && Math.abs(inp.steer) < 0.3 && !inp.brake && rnd() < dt * 0.6) inp.boost = true;
  }

  // ---------------- riding ----------------
  function stepRacer(r, dt, inp) {
    r.inv = Math.max(0, r.inv - dt); r.bonkCD -= dt; r.punchCD -= dt; r.splashCD -= dt;
    r.bal = Math.min(1, r.bal + dt * 0.3); r.stagT = Math.max(0, r.stagT - dt);
    if (r.state === "wipe") { stepWipe(r, dt); return; }
    stepPunch(r, dt);
    const live = G.state === "race" || G.state === "results";
    // actions
    if (!r.air) {
      if (inp.punch && r.punchT < 0 && r.punchCD <= 0 && live) startPunch(r, inp.punch);
      if (inp.hold) r.charge = Math.min(1, r.charge + dt / 0.6);
      if (inp.jump) {
        const c = inp.charge !== undefined ? inp.charge : r.charge;
        r.vy = Math.max(r.vy, 0) + SP.jumpV * (0.6 + 0.55 * c); r.air = true; r.airT = 0; r.tricks = []; r.grabT = 0; r.charge = 0;
        G.sound("jump", r, 0.6);
        emit("air", r);
      }
      if (inp.boost && live && r.hype >= HYPE_COST) {
        r.hype -= HYPE_COST; r.boost = Math.max(r.boost, 2.2); G.stats.boosts++;
        if (r === G.player) { G.sound("boost"); trickText("HYPE BOOST!"); }
        emit("boost", r);
      }
    } else {
      if (inp.up) startTrick(r, "front");
      if (inp.down) startTrick(r, "back");
      if (inp.left) startTrick(r, "spinL");
      if (inp.right) startTrick(r, "spinR");
      r.grabbing = !!inp.grab && !r.trick;
      if (r.grabbing) r.grabT += dt;
    }
    r.braking = !!inp.brake && !r.air;
    // steering + speed
    r.steer = RR.damp(r.steer, inp.steer, 9, dt);
    const fx_ = -Math.sin(r.yaw), fz_ = -Math.cos(r.yaw);
    r.ti = track.nearest(r.x, r.z, r.ti, 12);
    const lat = track.lateral(r.x, r.z, r.ti), s = r.ti * track.ds;
    const held = G.state === "count" || G.state === "menu";
    r.surf = world.surface(s, lat);
    if (!r.air) {
      const k = RR.clamp(r.speed / 9, 0.45, 1) * (1 - 0.25 * Math.max(0, r.speed / SP.top - 0.6));
      r.yaw += r.steer * SP.turn * k * dt * (r.braking ? 1.25 : 1);
      if (r.stagT > 0) r.yaw += Math.sin(G.t * 22 + r.i) * r.stagT * 1.6 * dt;
      world.course.normalAt(r.x, r.z, r.ti, r.n);
      const grade = RR.clamp((r.n.x * fx_ + r.n.z * fz_) / r.n.y, -0.7, 0.7);
      let target = SP.top * (r.mult || 1) * r.surf.k + grade * SP.grade * 0.25 + (r.boost > 0 ? SP.boost : 0);
      target *= 1 - 0.12 * Math.abs(r.steer);
      if (r.braking) target *= 0.4;
      if (r.charge > 0) target *= 1.02;
      if (held) target = 0;
      if (r.finished) target = Math.min(target, 5);
      if (r.speed < target) r.speed = Math.min(target, r.speed + SP.accel * (1.2 - 0.6 * r.speed / SP.top) * dt * (r.boost > 0 ? 1.8 : 1));
      else r.speed += (target - r.speed) * (r.braking ? 2.6 : 1.1) * dt;
      // gravity along the slope (up a table's face, down the back)
      if (!held) r.speed = Math.max(0, r.speed + 5.5 * grade * dt);
    } else {
      r.yaw += r.steer * SP.turn * 0.22 * dt * (r.trick && TRICKS[r.trick.type].axis === "y" ? 0 : 1);
      r.speed *= Math.exp(-0.05 * dt);
    }
    r.boost = Math.max(0, r.boost - dt);
    const dirDot = fx_ * track.tx[r.ti] + fz_ * track.tz[r.ti];
    r.wrongT = dirDot < -0.3 && r.speed > 3 && !r.finished ? r.wrongT + dt : 0;
    if (r.finished && Math.abs(lat) > 5) {
      const want = Math.atan2(-(track.x[r.ti] + track.tx[r.ti] * 20 - r.x), -(track.z[r.ti] + track.tz[r.ti] * 20 - r.z));
      r.yaw += RR.clamp(RR.wrapAngle(want - r.yaw), -1, 1) * dt * 2;
    }
    // move
    r.x += fx_ * r.speed * dt; r.z += fz_ * r.speed * dt;
    collide(r);
    if (r.state !== "ride") return;
    r.ti = track.nearest(r.x, r.z, r.ti, 12);
    if (r.ti * track.ds > track.L - 6) r.speed = Math.min(r.speed, 2);
    const h = G.ground(r.x, r.z, r.ti);
    const rampY = world.rampY(r.x, r.z, fx_, fz_, h);
    const surf = rampY === null ? h : Math.max(h, rampY);
    const onRamp = rampY !== null && rampY > h + 0.05;
    if (r.air) {
      r.airT += dt;
      r.vy -= GRAV * dt;
      r.y += r.vy * dt;
      if (r.trick) {
        const tk = TRICKS[r.trick.type];
        r.trick.a += Math.PI * 2 / tk.dur * dt;
        if (r.trick.a >= Math.PI * 2) {
          r.tricks.push(r.trick.type);
          if (r === G.player) trickText(trickName(r.tricks, false));
          r.trick = r.trickQ ? { type: r.trickQ, a: 0 } : null; r.trickQ = null;
        }
      }
      if (r.y <= surf && r.vy < 0) { r.y = surf; r.vy = 0; land(r); }
    } else {
      const svy = (surf - r.y) / dt;
      if (r.onRamp && !onRamp && rampY === null) {
        // off a kicker's lip
        r.vy = Math.max(svy, 0) * 0.35 + 2.5 + r.speed * 0.2; r.air = true; r.airT = 0; r.tricks = []; r.grabT = 0;
        emit("ramp", r); emit("air", r);
      } else if (svy - r.vy < -GRAV * dt * 1.4 && (r.vy > 2.0 || svy < -4)) {
        // the ground fell away faster than gravity: a table's lip, a whoop, a drop, the stairs
        r.air = true; r.airT = 0; r.tricks = []; r.grabT = 0; r.vy = Math.max(r.vy, 0); emit("air", r);
      } else { r.vy = svy; r.y = surf; }
    }
    r.onRamp = onRamp && !r.air;
    // the garage roof
    const ceil = world.ceil(s);
    if (ceil > 0 && r.y > h + ceil - 2.0) { r.y = h + ceil - 2.0; r.vy = Math.min(r.vy, 0); }
    // water and mud throw spray and a sound
    if (!r.air && r.surf.kind && (r.surf.kind === "water" || r.surf.kind === "mud") && r.speed > 4 && r.splashCD <= 0) {
      r.splashCD = 0.6; G.sound("splash", r, 0.5);
    }
  }

  function separate() {
    const R = G.racers;
    for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
      const a = R[i], b = R[j];
      if (a.state !== "ride" || b.state !== "ride" || Math.abs(a.y - b.y) > 1.2) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), m = sport === "moto" ? 1.5 : 1.15;
      if (d < m && d > 0.001) {
        const p = (m - d) / 2, nx = dx / d, nz = dz / d;
        a.x -= nx * p; a.z -= nz * p; b.x += nx * p; b.z += nz * p;
        if ((a === G.player || b === G.player) && a.bonkCD <= 0) { G.sound("bump", a, 0.6); a.bonkCD = 0.4; }
      }
    }
  }

  function progress(r) {
    const s = r.ti * track.ds;
    r.raceDist = s - S.start;
    if (!r.finished && r.state === "ride" && s >= S.finish && G.state === "race") {
      r.finished = true; r.finishT = G.raceT;
      if (r === G.player) finishPlayer();
      emit("finish", r);
    }
  }
  function places() {
    const R = G.racers.slice().sort(function (a, b) {
      if (a.finished && b.finished) return a.finishT - b.finishT;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.raceDist - a.raceDist;
    });
    R.forEach(function (r, i) { r.place = i + 1; });
    const p = G.player;
    G.racers.forEach(function (r) {
      let m = r.def.skill;
      if (r !== p && p) {
        const gap = p.raceDist - r.raceDist;
        m *= gap > 0 ? 1 + Math.min(0.11, gap / 400) : 1 - Math.min(0.09, -gap / 600);
      } else if (r === p) m = 1;
      r.mult = m;
    });
  }

  let finishShown = 0;
  function finishPlayer() {
    toast(ordinal(G.player.place) + " PLACE!", G.player.place === 1 ? "good" : "", 3);
    G.sound("fin");
    finishShown = 3.5;
  }

  // ---------------- the step ----------------
  const blankInp = function () { return { steer: 0, jump: false, hold: false, up: false, down: false, left: false, right: false, grab: false, brake: false, boost: false, punch: null }; };
  function step(dt) {
    G.t += dt;
    if (G.state === "count") {
      const before = Math.ceil(G.countT);
      G.countT -= dt;
      const after = Math.ceil(G.countT);
      if (after !== before && after > 0) { hud.count.textContent = after; hud.count.className = "show"; G.sound("beep"); }
      if (G.countT <= 0) {
        G.state = "race"; G.raceT = 0; hud.count.textContent = "GO!"; hud.count.className = "show go"; G.sound("go");
        if (world.startGate) world.startGate.drop();
        setTimeout(function () { hud.count.className = ""; }, 900);
        emit("go");
        G.goT = 0;
      }
    } else if (G.state === "race" || G.state === "results") G.raceT += dt;
    if (G.goT !== undefined) G.goT += dt;
    const live = G.state === "race" || G.state === "results";
    if (PRESS.length && G.state === "race") PRESS.forEach(function (p) {
      if (!p.done && G.raceT >= p.t) { p.done = true; edges[p.k] = true; ups[p.k] = true; }
      if (p.t1 !== undefined) { const on = G.raceT >= p.t && G.raceT < p.t1; if (keys[p.k] && !on) ups[p.k] = true; keys[p.k] = on; }
    });
    places();
    G.racers.forEach(function (r) {
      const inp = blankInp();
      const human = r === G.player && !AUTO && !r.finished && G.state !== "menu" && G.state !== "results";
      if (human) {
        inp.steer = (keys.L ? 1 : 0) - (keys.R ? 1 : 0);
        const up = take("U"), down = take("D"), l = take("L"), rt = take("R");
        // SPACE: a punch when someone's in reach (the release then doesn't jump), else crouch + jump
        if (take("S")) {
          const tgt = !r.air && live && r.state === "ride" && r.punchCD <= 0 && r.punchT < 0 && G.raceT > 3 ? punchTarget(r) : null;
          if (tgt) { inp.punch = tgt; r.spaceUsed = true; } else r.spaceUsed = false;
        }
        inp.hold = !!keys.S && !r.spaceUsed;
        const rel = takeUp("S");
        inp.jump = rel && !r.air && !r.spaceUsed;
        if (rel) r.spaceUsed = false;
        if (r.air) { inp.up = up; inp.down = down; inp.left = l; inp.right = rt; inp.grab = !!keys.S; }
        else { inp.boost = up; inp.brake = !!keys.D; }
        if (G.state === "race" && up && G.goT < 0.35 && !r.air) { r.boost = Math.max(r.boost, 1.4); trickText("PERFECT START"); G.sound("boost"); inp.boost = false; }
        void down;
      } else if (live && r.state === "ride" && !r.finished) aiDrive(r, dt, inp);
      if (!live) { inp.jump = inp.hold = inp.boost = false; inp.punch = null; inp.steer = 0; }
      stepRacer(r, dt, inp);
      progress(r);
    });
    separate();
  }

  // ---------------- visuals ----------------
  const _q = new T.Quaternion(), _q2 = new T.Quaternion(), _up = new T.Vector3(0, 1, 0), _v = new T.Vector3(), _v2 = new T.Vector3(), _n = new T.Vector3();
  const _bq = new T.Quaternion(), _bp = new T.Vector3();
  const AX = new T.Vector3(1, 0, 0), AY = new T.Vector3(0, 1, 0), AZ = new T.Vector3(0, 0, 1);
  function visual(r, dt) {
    const t = G.t, v = r.v;
    r.g.visible = true;
    r.g.position.set(r.x, r.y, r.z);
    r.g.rotation.set(0, r.yaw, 0);
    if (r.state === "wipe") {
      _q.setFromAxisAngle(AZ, r.boardRoll * r.rollSign);
      r.tiltQ.slerp(_q, 1 - Math.exp(-dt * 8));
    } else {
      _n.copy(r.n).applyAxisAngle(AY, -r.yaw).lerp(_up, r.air ? 0.85 : 0.15).normalize();
      _q.setFromUnitVectors(_up, _n);
      const leanT = r.air ? 0 : -r.steer * SP.lean * Math.min(1, r.speed / (SP.top * 0.6)) * (sport === "skate" ? 0.7 : 1);
      r.lean = RR.damp(r.lean, leanT, 8, dt);
      _q2.setFromAxisAngle(AZ, r.lean); _q.multiply(_q2);
      if (r.air) { _q2.setFromAxisAngle(AX, RR.clamp(r.vy * 0.035, -0.35, 0.3)); _q.multiply(_q2); }
      r.tiltQ.slerp(_q, 1 - Math.exp(-dt * 10));
    }
    r.tilt.quaternion.copy(r.tiltQ);
    if (r.trick) {
      const tk = TRICKS[r.trick.type];
      r.spin.quaternion.setFromAxisAngle(tk.axis === "x" ? AX : AY, tk.dir * r.trick.a);
    } else r.spin.quaternion.identity();
    // crouch spring: charging a jump squats you down, landings compress you
    const ct = r.air ? 0.65 : 0.2 + (r.boost > 0 ? 0.15 : 0) + r.charge * 0.7 + (r.braking ? 0.15 : 0);
    r.crouchV += ((ct - r.crouch) * 60 - r.crouchV * 9) * dt;
    r.crouch = RR.clamp(r.crouch + r.crouchV * dt, 0, 1.1);
    const live = r.state === "ride";
    // the machine: wheels, steering, cranks
    if (v) {
      if (sport === "mtb") {
        const pedal = live && !r.air && (r.speed < SP.top * (r.mult || 1) * 0.97 || r.boost > 0) && !r.braking && !r.finished && G.state !== "count";
        if (pedal) r.crank += dt * (1.6 + r.speed * 0.42);
        // coasting: pedals level
        else r.crank = RR.lerp(r.crank, Math.round((r.crank - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2, 1 - Math.exp(-dt * 3));
      }
      v.update(dt, r.state === "wipe" ? r.speed * 0.5 : r.speed, live ? -r.steer * 0.32 * (1 - 0.6 * Math.min(1, r.speed / SP.top)) : 0, r.crank);
    }
    const root = r.rider.r.root;
    if (r.state === "wipe") { r.rider.r.update(dt); }
    else {
      root.visible = r.inv <= 0 || Math.floor(r.inv * 12) % 2 === 0;
      if (v) v.setVisible(root.visible);
      r.g.updateMatrixWorld(true);
      r.body.getWorldQuaternion(_bq); r.body.getWorldPosition(_bp);
      const fxw = -Math.sin(r.yaw), fzw = -Math.cos(r.yaw);
      const P = { mode: sport, Q: _bq, pos: _bp, crouch: r.crouch, lean: r.lean * 1.4, t: t + r.i * 1.3, air: r.air, look: _v.set(fxw, 0, fzw),
        grab: r.air && r.grabbing ? Math.min(1, r.grabT * 6) : 0, cheer: r.finished && G.state !== "menu" ? 1 : 0 };
      if (sport === "skate") {
        const pushing = live && !r.air && !r.finished && G.state !== "count" && (r.speed < SP.top * (r.mult || 1) * 0.95 || r.boost > 0 || G.state === "menu");
        r.stride.amp = RR.damp(r.stride.amp, pushing && G.state !== "menu" ? 1 : 0, 4, dt);
        r.stride.phase += dt * (3.8 + 3.2 * r.speed / SP.top) * (r.stride.amp > 0.05 ? 1 : 0);
        r.tuck = RR.damp(r.tuck, r.speed > SP.top * 0.75 && !r.braking ? 1 : 0, 3, dt);
        P.stride = r.stride; P.tuck = r.tuck;
      } else {
        const standT = sport === "moto" ? (r.air ? 1 : 1 - 0.55 * Math.abs(r.steer)) : (r.air || r.boost > 0 || r.speed > SP.top * 1.05 ? 1 : 0.05);
        r.stand = RR.damp(r.stand, G.state === "menu" ? (sport === "moto" ? 0.3 : 0) : standT, 5, dt);
        P.stand = r.stand;
        P.anchors = v.anchors(r.anch);
      }
      if (r.punchT >= 0 && r.punchTgt) {
        const tgt = _v2.set(r.punchTgt.x, r.punchTgt.y + (r.punchKind === "kick" ? 0.8 : 1.35), r.punchTgt.z);
        P.strike = { kind: r.punchKind, t: r.punchT, target: tgt, arm: r.punchArm, style: r.punchStyle };
      }
      // got hit: rocks back over ~0.5 s
      if (r.hitT >= 0) {
        r.hitT += dt;
        if (r.hitT > 0.55) r.hitT = -1;
        else P.hit = { k: r.hitT < 0.08 ? RR.smooth(r.hitT / 0.08) : 1 - RR.smooth((r.hitT - 0.08) / 0.47), side: r.hitSide || 1 };
      }
      r.rider.pose(dt, P);
    }
    // skates follow the feet (on the ground, in the air and in a wipeout)
    if (v && v.skates) { root.updateMatrixWorld(true); v.placeSkates(r.rider.footFrames(), r.rider.ankleH); }
    // tyre tracks, roost, spray, boost exhaust
    const fx_ = -Math.sin(r.yaw), fz_ = -Math.cos(r.yaw), rx = Math.cos(r.yaw), rz = -Math.sin(r.yaw);
    const riding = live && !r.air;
    r.trail.update(t, r.x - fx_ * (sport === "moto" ? 0.7 : 0.5), r.y, r.z - fz_ * (sport === "moto" ? 0.7 : 0.5), rx, rz, riding && SP.trail ? 1 : 0, 9);
    if (riding && !SIM && r.speed > 5) {
      const many = Q.particles > 2000;
      const kind = r.surf ? r.surf.kind : "";
      const wet = kind === "water", mud = kind === "mud";
      const col = wet ? [1.3, 1.4, 1.5] : mud ? [0.3, 0.22, 0.15] : DUST[sport];
      if (sport === "moto" || wet || mud) {
        const n = (sport === "moto" ? (many ? 4 : 2) : 0) + (wet || mud ? 3 : 0);
        for (let k = 0; k < n; k++)
          fx.emit(r.x - fx_ * 0.85 + rx * (Math.random() - 0.5) * 0.3, r.y + 0.15, r.z - fz_ * 0.85 + rz * (Math.random() - 0.5) * 0.3,
            -fx_ * r.speed * 0.25 + rx * r.steer * 3 + (Math.random() - 0.5) * 2, 1.2 + Math.random() * 3 * (wet ? 1.4 : 1), -fz_ * r.speed * 0.25 + rz * r.steer * 3 + (Math.random() - 0.5) * 2,
            0.5 + Math.random() * 0.5, 0.05 + Math.random() * 0.09, col[0], col[1], col[2], 12, 1.0, 0.25);
        // a dust cloud hanging behind the bikes
        if (sport === "moto" && Math.random() < 0.5) fx.emit(r.x - fx_ * 1.4, r.y + 0.3, r.z - fz_ * 1.4, (Math.random() - 0.5) * 1.5, 0.4 + Math.random() * 0.6, (Math.random() - 0.5) * 1.5, 1.4 + Math.random(), 0.35 + Math.random() * 0.3, col[0] * 0.9, col[1] * 0.9, col[2] * 0.9, -0.2, 1.2, 1.2);
      } else if (sport === "mtb" && (Math.abs(r.steer) > 0.6 || r.braking) && Math.random() < 0.6) {
        fx.emit(r.x - fx_ * 0.6, r.y + 0.08, r.z - fz_ * 0.6, rx * r.steer * 2.5 + (Math.random() - 0.5), 0.6 + Math.random() * 1.2, rz * r.steer * 2.5 + (Math.random() - 0.5), 0.5, 0.05, col[0], col[1], col[2], 10, 1.2, 0.3);
      }
    }
    if (r.boost > 0 && r.state === "ride" && !SIM)
      for (let k = 0; k < 2; k++) fx.emit(r.x - fx_ * 0.9 + (Math.random() - 0.5) * 0.5, r.y + 0.4 + Math.random() * 0.3, r.z - fz_ * 0.9 + (Math.random() - 0.5) * 0.5, -fx_ * 4, 1 + Math.random(), -fz_ * 4, 0.35, 0.18, 2.8, 1.4, 0.5, 2, 2, -0.2);
  }

  // ---------------- camera ----------------
  let camYaw = 0, shake = 0, flash = 0, hitStop = 0;
  const camPos = new T.Vector3(), camLook = new T.Vector3(), menuAng = { a: 0.6 };
  function updateCamera(dt) {
    const p = G.player;
    if (!p) return;
    if (G.state === "menu" && PORTRAIT) {
      // tools hook: ?portrait=1&pick=N frames the rider's face for the menu card art
      const fx_ = -Math.sin(p.yaw), fz_ = -Math.cos(p.yaw);
      if (!G.portraitSet) {
        G.portraitSet = true;
        scene.fog = null;
        scene.background = new T.Color(ROSTER[G.pick].color).multiplyScalar(0.55);
        scene.children.forEach(function (o) { if (o !== p.g && !o.isLight && o !== sky.fill.target && o !== sky.sun.target) o.visible = false; });
      }
      const hp = new T.Vector3(p.x, p.y + 1.4, p.z);
      p.g.updateMatrixWorld(true);
      p.g.traverse(function (o) { if (/(^|:)(mixamorig)?Head$/.test(o.name)) o.getWorldPosition(hp); });
      hp.y += RR.num("py", 0.1);
      camera.position.set(hp.x + fx_ * RR.num("pd", 1.2), hp.y, hp.z + fz_ * RR.num("pd", 1.2));
      camera.lookAt(hp);
      if (camera.fov !== 30) { camera.fov = 30; camera.updateProjectionMatrix(); }
      return;
    }
    if (G.state === "menu") {
      menuAng.a += dt * 0.2;
      const r = p, fx_ = -Math.sin(r.yaw), fz_ = -Math.cos(r.yaw), rx = Math.cos(r.yaw), rz = -Math.sin(r.yaw);
      const a = Math.sin(menuAng.a) * 0.8 + 0.6, D = sport === "moto" ? 4.4 : 3.8;
      const want = _v.set(r.x + fx_ * Math.cos(a) * D + rx * Math.sin(a) * D, r.y + 1.5, r.z + fz_ * Math.cos(a) * D + rz * Math.sin(a) * D);
      const k = G.snapCam ? 1 : 1 - Math.exp(-dt * 3);
      camPos.lerp(want, k);
      camLook.lerp(_v2.set(r.x, r.y + 1.0, r.z), G.snapCam ? 1 : 1 - Math.exp(-dt * 4));
      G.snapCam = false;
      camera.position.copy(camPos); camera.lookAt(camLook);
      const side = _v.set(1, 0, 0).applyQuaternion(camera.quaternion);
      camera.lookAt(_v2.copy(camLook).addScaledVector(side, innerWidth > 700 ? -1.4 : 0));
      if (camera.fov !== 50) { camera.fov = 50; camera.updateProjectionMatrix(); }
      return;
    }
    camYaw += RR.wrapAngle(p.yaw - camYaw) * (1 - Math.exp(-dt * (p.state === "wipe" ? 1.5 : 5)));
    const fx_ = -Math.sin(camYaw), fz_ = -Math.cos(camYaw);
    const boostK = Math.min(1, p.boost * 2), sp = Math.min(1, p.speed / SP.top);
    let fxp = p.x, fyp = p.y, fzp = p.z;
    if (p.state === "wipe") { const ro = p.rider.r.root.position; fxp = (p.x + ro.x) / 2; fzp = (p.z + ro.z) / 2; fyp = Math.max(p.y, ro.y - 0.6); }
    const dist = SP.camDist + sp * 0.4 + boostK * 0.5 + (p.air ? 0.6 : 0) + (p.state === "wipe" ? 2.2 : 0);
    let hgt = SP.camH + (p.air ? 0.35 : 0) + (p.state === "wipe" ? 1.2 : 0);
    const ceil = world.ceil(p.ti * track.ds);
    if (ceil > 0) hgt = Math.min(hgt, ceil - 0.6);
    const want = _v.set(fxp - fx_ * dist, fyp + hgt, fzp - fz_ * dist);
    if (!camPos.lengthSq()) camPos.copy(want);
    camPos.x = RR.damp(camPos.x, want.x, 9, dt); camPos.z = RR.damp(camPos.z, want.z, 9, dt);
    camPos.y = RR.damp(camPos.y, want.y, p.air ? 4 : 8, dt);
    const look = _v2.set(fxp + fx_ * 2.6, fyp + 0.75, fzp + fz_ * 2.6);
    if (!camLook.lengthSq()) camLook.copy(look);
    camLook.lerp(look, 1 - Math.exp(-dt * 12));
    camera.position.copy(camPos);
    const gh = G.ground(camPos.x, camPos.z, p.ti);
    if (camera.position.y < gh + 0.7) { camera.position.y = gh + 0.7; camPos.y = camera.position.y; }
    shake = Math.max(0, shake - dt * 1.5);
    if (shake > 0) camera.position.add(_v.set((Math.random() - 0.5) * shake * 0.3, (Math.random() - 0.5) * shake * 0.3, 0));
    camera.lookAt(camLook);
    // test hook: ?cam=side looks at the player's rig from the right
    if (CAM_SIDE) {
      const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
      camera.position.set(p.x + rx * 4.6 - Math.sin(p.yaw) * 0.6, p.y + 1.3, p.z + rz * 4.6 - Math.cos(p.yaw) * 0.6);
      camera.lookAt(p.x, p.y + 0.9, p.z);
    }
    const fov = 62 + boostK * 9 + sp * 6;
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = RR.damp(camera.fov, fov, 5, dt); camera.updateProjectionMatrix(); }
  }

  // ---------------- HUD per frame ----------------
  let lastHud = {};
  function setText(el, key, v) { if (lastHud[key] !== v) { el.innerHTML = v; lastHud[key] = v; } }
  const _sp = new T.Vector3();
  function updateHud(dt) {
    const p = G.player;
    if (!p) return;
    toastT -= dt; if (toastT <= 0 && hud.toast.className) hud.toast.className = "";
    trickT -= dt; if (trickT <= 0 && hud.trick.className) hud.trick.className = "";
    if (G.state === "menu") return;
    setText(hud.place, "place", p.place + "<span>" + ordinal(p.place).slice(-2) + "</span>");
    hud.place.style.color = ["#ffd23f", "#e6edf5", "#ffa45c", "#9fb3c8"][p.place - 1];
    setText(hud.lap, "lap", (G.tour ? "TOUR <b>" + (G.tour.i + 1) + "</b>/3 · " : "") + world.def.name);
    setText(hud.time, "time", fmtTime(p.finished ? p.finishT : G.raceT) + " · " + Math.round(p.speed * 2.237) + " MPH");
    const hy = Math.round(p.hype);
    if (lastHud.hype !== hy) { hud.hypeFill.style.width = hy + "%"; hud.hype.classList.toggle("ready", hy >= HYPE_COST); lastHud.hype = hy; }
    setText(hud.hypeTxt, "hypeTxt", p.hype >= HYPE_COST ? "HYPE <b>▲ BOOST</b>" : "HYPE");
    hud.wrong.className = p.wrongT > 1.2 ? "show" : "";
    const fist = p.state === "ride" && !p.air && p.punchCD <= 0 && G.state === "race" && G.raceT > 3 ? punchTarget(p) : null;
    G.racers.forEach(function (r) {
      if (r === p) { r.tag.style.display = "none"; return; }
      _sp.set(r.x, r.y + 2.3, r.z);
      const d = _sp.distanceTo(camera.position);
      _sp.project(camera);
      if (_sp.z > 1 || d > 90 || Math.abs(_sp.x) > 1.1 || Math.abs(_sp.y) > 1.1) { r.tag.style.display = "none"; return; }
      r.tag.style.display = "block";
      r.tag.style.transform = "translate(" + ((_sp.x * 0.5 + 0.5) * innerWidth) + "px," + ((-_sp.y * 0.5 + 0.5) * innerHeight) + "px) translate(-50%,-100%) scale(" + RR.clamp(14 / d, 0.55, 1.1) + ")";
      const lbl = ordinal(r.place);
      if (r.tagI.textContent !== lbl) r.tagI.textContent = lbl;
      r.tag.classList.toggle("punch", r === fist);
    });
    drawMinimap();
    RR.Audio.ride(G.state === "results" || p.state !== "ride" ? null : sport, Math.min(1, p.speed / SP.top), Math.max(p.boost > 0 ? 1 : 0, p.speed < SP.top * 0.9 ? 0.7 : 0.3), p.air);
  }

  // ---------------- menus ----------------
  const scr = { menu: $("screen-menu"), over: $("screen-over"), pause: $("screen-pause"), build: $("screen-build") };
  function show(name) { Object.keys(scr).forEach(function (k) { scr[k].classList.toggle("on", k === name); }); document.body.classList.toggle("racing", !name); }
  let menuRow = 0;
  const EV_INFO = {
    skate: { name: "DOWNTOWN DROP", sub: "INLINE SKATES", c: "#ff8a3d" },
    mtb: { name: "BAYOU BENDS", sub: "MOUNTAIN BIKE", c: "#7ad04a" },
    moto: { name: "SHIP CHANNEL SCRAMBLE", sub: "DIRT BIKE", c: "#ffb31a" },
    tour: { name: "THE TOUR", sub: "ALL THREE · POINTS", c: "#ff4fa3" }
  };
  function buildMenu() {
    const evb = $("events");
    evb.innerHTML = "";
    EVENTS.forEach(function (k, i) {
      const b = document.createElement("button");
      b.className = "ev"; b.dataset.k = k; b.style.setProperty("--c", EV_INFO[k].c);
      b.innerHTML = "<span class=\"in\"><b>" + EV_INFO[k].name + "</b><small>" + EV_INFO[k].sub + "</small></span>";
      b.addEventListener("click", function () { RR.Audio.init(); menuRow = 0; pickEvent(i); });
      evb.appendChild(b);
    });
    const box = $("riders");
    box.innerHTML = "";
    ROSTER.forEach(function (d, i) {
      const b = document.createElement("button");
      b.className = "rider"; b.dataset.id = d.id; b.style.setProperty("--c", d.color);
      b.innerHTML = "<span class=\"in\"><i>" + d.num + "</i><b>" + d.name + "</b></span>";
      b.addEventListener("click", function () { RR.Audio.init(); menuRow = 1; G.pick = i; menuPlayer(); refreshMenu(); });
      box.appendChild(b);
    });
    $("btn-play").addEventListener("click", function () { RR.Audio.init(); startEvent(); });
    $("btn-q").addEventListener("click", function () { cycleQuality(1); });
    $("btn-again").addEventListener("click", function () { RR.Audio.init(); afterResults(); });
    $("btn-menu").addEventListener("click", function () { G.tour = null; toMenu(); });
    $("btn-pause").addEventListener("click", function () { if (G.state === "race" || G.state === "count") pause(true); });
    $("btn-resume").addEventListener("click", function () { pause(false); });
    $("btn-quit").addEventListener("click", function () { pause(false); G.tour = null; toMenu(); });
    $("btn-mute").addEventListener("click", function () { RR.Audio.init(); RR.Audio.setOn(!RR.Audio.on); $("btn-mute").textContent = RR.Audio.on ? "🔊" : "🔇"; lsSet("tcb_mute", RR.Audio.on ? "0" : "1"); });
    if (lsGet("tcb_mute") === "1") { RR.Audio.on = false; $("btn-mute").textContent = "🔇"; }
    $("q-label").textContent = Q.name;
    $("controls").innerHTML = isTouch
      ? "◀ ▶ steer · ▼ brake · ▲ spends HYPE on a boost · HIT punches or kicks a rider beside you, otherwise hold + let go to jump · in the air ▲ ▼ ◀ ▶ = flips &amp; spins, hold HIT = grab"
      : "<kbd>◀</kbd><kbd>▶</kbd> steer · <kbd>▼</kbd> brake · <kbd>▲</kbd> spend HYPE on a boost · <kbd>SPACE</kbd> <b>punch / kick</b> a rider beside you, otherwise hold + let go to jump · in the air <kbd>▲</kbd> front flip <kbd>▼</kbd> backflip <kbd>◀</kbd><kbd>▶</kbd> 360, hold <kbd>SPACE</kbd> to grab · tricks + knockdowns fill HYPE";
  }
  function refreshMenu() {
    document.querySelectorAll(".ev").forEach(function (b, i) { b.classList.toggle("sel", i === G.ev); });
    document.querySelectorAll(".rider").forEach(function (b, i) { b.classList.toggle("sel", i === G.pick); });
    document.querySelectorAll(".mrow").forEach(function (b, i) { b.classList.toggle("focus", i === menuRow); });
    const k = EVENTS[G.ev], ei = EV_INFO[k], rd = ROSTER[G.pick];
    scr.menu.dataset.k = k;
    $("hero-place").textContent = k === "tour" ? "HOUSTON · 3 EVENTS" : RR.COURSES[k].place;
    $("hero-sub").textContent = ei.sub;
    $("vs").textContent = k === "tour" ? "SKATES DOWNTOWN → BIKES ON THE BAYOU → DIRT BIKES AT THE CHANNEL · 10 / 6 / 3 / 1 POINTS" : RR.COURSES[k].blurb;
    const best = k === "tour" ? null : lsGet("tcb_best_" + k + "_" + rd.id);
    $("menu-best").textContent = best ? "BEST " + fmtTime(+best) : "";
    $("m-rider").style.setProperty("--rc", rd.color);
    $("mr-num").textContent = rd.num;
    $("mr-name").textContent = rd.name;
    $("mr-face").dataset.id = rd.id;
    $("mr-stats").innerHTML = STAT_LABELS.map(function (l, i) { return "<span>" + l + "</span><i><em style=\"width:" + rd.st[i] + "%\"></em></i>"; }).join("");
    $("mr-best").textContent = best ? "BEST " + fmtTime(+best) : "";
  }
  function pickEvent(i) {
    G.ev = (i + EVENTS.length) % EVENTS.length;
    refreshMenu();
    const k = EVENTS[G.ev] === "tour" ? "skate" : EVENTS[G.ev];
    if (world.key !== k) rebuildThen(k, function () { menuPlayer(); show("menu"); refreshMenu(); RR.Audio.song("menu"); });
  }
  // swap worlds behind a "building" card so the page can paint first
  function rebuildThen(key, done) {
    $("build-name").textContent = RR.COURSES[key].name;
    $("build-place").textContent = RR.COURSES[key].place;
    scr.build.dataset.k = key;
    show("build");
    G.state = "building";
    setTimeout(function () { setCourse(key); G.state = "menu"; done(); }, 60);
  }
  function cycleQuality(d) {
    const i = (QORDER.indexOf(qKey) + d + QORDER.length) % QORDER.length;
    lsSet("tcb_q", QORDER[i]);
    location.search = location.search.replace(/[?&]q=[^&]*/, "");
    location.reload();
  }
  function uiKey(k) {
    if (G.state === "menu") {
      if (k === "U" || k === "D") { menuRow = (menuRow + (k === "D" ? 1 : -1) + 3) % 3; refreshMenu(); G.sound("tick"); }
      else if (k === "L" || k === "R") {
        const d = k === "R" ? 1 : -1;
        if (menuRow === 0) pickEvent(G.ev + d);
        else if (menuRow === 1) { G.pick = (G.pick + d + ROSTER.length) % ROSTER.length; menuPlayer(); refreshMenu(); }
        else cycleQuality(d);
        G.sound("tick");
      } else if (k === "S") { edges.S = false; ups.S = false; startEvent(); }
    } else if (G.state === "results") {
      if (k === "S") { edges.S = false; ups.S = false; afterResults(); }
      else if (k === "U") { G.tour = null; toMenu(); }
    } else if (G.paused && k === "S") { edges.S = false; pause(false); }
  }
  function pause(on) {
    G.paused = on; show(on ? "pause" : null);
    RR.Audio.duck(on);
  }
  addEventListener("blur", function () { if ((G.state === "race" || G.state === "count") && !AUTO) pause(true); });

  function menuPlayer() {
    G.all.forEach(function (r) { setActive(r, false); });
    G.player = G.all[G.pick];
    G.racers = [G.player];
    setActive(G.player, true);
    resetRacer(G.player, 0);
    G.snapCam = true;
  }
  function pickField() {
    // you + 3 rivals from the rest of the crew (the tour keeps the same field)
    if (G.tour && G.tour.field) { G.racers = G.tour.field; }
    else {
      const others = G.all.filter(function (r) { return r !== G.player; });
      for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(G.rnd() * (i + 1)); const t = others[i]; others[i] = others[j]; others[j] = t; }
      G.racers = [G.player].concat(others.slice(0, 3));
      if (G.tour) G.tour.field = G.racers;
    }
    G.all.forEach(function (r) { setActive(r, G.racers.indexOf(r) >= 0); });
  }
  function placeGrid() {
    const order = G.racers.filter(function (r) { return r !== G.player; });
    order.splice(2, 0, G.player);
    order.forEach(function (r, slot) { resetRacer(r, slot); });
  }
  function toMenu() {
    G.state = "menu";
    menuPlayer();
    show("menu"); refreshMenu();
    RR.Audio.song("menu");
  }
  function startEvent() {
    const k = EVENTS[G.ev];
    if (k === "tour") {
      G.tour = { i: 0, pts: {}, field: null };
      if (world.key !== "skate") { rebuildThen("skate", startRace); return; }
    } else G.tour = null;
    startRace();
  }
  function startRace() {
    G.player = G.all[G.pick];
    pickField();
    placeGrid();
    G.racers.forEach(function (r) { r.mult = r.def.skill; });
    if (world.startGate) world.startGate.reset();
    G.state = "count"; G.countT = 3.2; G.goT = undefined; G.raceT = 0; finishShown = 0;
    hud.count.className = ""; lastHud = {};
    camPos.set(0, 0, 0); camLook.set(0, 0, 0); camYaw = G.player.yaw;
    show(null);
    RR.Audio.song(world.def.music);
    emit("count");
  }
  function afterResults() {
    if (G.tour && G.tour.i < 2) {
      G.tour.i++;
      rebuildThen(RR.COURSE_ORDER[G.tour.i], startRace);
    } else if (G.tour) { G.tour = null; toMenu(); }
    else startRace();
  }
  function results() {
    if (G.state === "results") return;
    G.state = "results";
    const p = G.player;
    const avg = function (r) { return Math.max(1, r.raceDist) / Math.max(1, G.raceT); };
    const L = S.finish - S.start;
    const rows = G.racers.map(function (r) {
      const tme = r.finished ? r.finishT : G.raceT + (L - r.raceDist) / Math.max(5, avg(r) * 0.98);
      return { r: r, t: tme };
    }).sort(function (a, b) { return a.t - b.t; });
    const myPlace = rows.findIndex(function (x) { return x.r === p; }) + 1;
    $("over-place").textContent = ordinal(myPlace);
    $("over-kicker").textContent = world.def.name + " · RESULT";
    if (G.tour) rows.forEach(function (x, i) { G.tour.pts[x.r.def.id] = (G.tour.pts[x.r.def.id] || 0) + TOUR_PTS[i]; });
    $("over-rows").innerHTML = rows.map(function (x, i) {
      return '<div class="row' + (x.r === p ? " me" : "") + '"><span>' + (i + 1) + '</span><b style="color:' + x.r.def.color + '">' + x.r.name + "</b><em>" + fmtTime(x.t) + (x.r.finished ? "" : "*") + "</em><small>" + x.r.st.kos + " KNOCKDOWNS · " + x.r.st.tricks + " TRICKS · " + x.r.st.wipeouts + " WIPEOUTS" + (G.tour ? " · +" + TOUR_PTS[i] + " PTS" : "") + "</small></div>";
    }).join("");
    if (G.tour) {
      const st = G.racers.slice().sort(function (a, b) { return (G.tour.pts[b.def.id] || 0) - (G.tour.pts[a.def.id] || 0); });
      $("over-tour").innerHTML = "<div class='tt'>TOUR STANDINGS · AFTER " + (G.tour.i + 1) + " OF 3</div>" + st.map(function (r, i) {
        return "<div class='ts" + (r === p ? " me" : "") + "'><span>" + (i + 1) + "</span><b style='color:" + r.def.color + "'>" + r.name + "</b><em>" + (G.tour.pts[r.def.id] || 0) + "</em></div>";
      }).join("") + (G.tour.i === 2 ? "<div class='champ'>" + (st[0] === p ? "YOU WIN THE TOUR!" : st[0].name + " WINS THE TOUR") + "</div>" : "");
      $("over-tour").style.display = "block";
      $("btn-again").innerHTML = G.tour.i < 2 ? "NEXT EVENT <small>SPACE</small>" : "BACK TO THE MENU <small>SPACE</small>";
    } else {
      $("over-tour").style.display = "none";
      $("btn-again").innerHTML = "RACE AGAIN <small>SPACE</small>";
    }
    const key = "tcb_best_" + world.key + "_" + p.def.id, best = +lsGet(key) || 0;
    if (p.finished && (!best || p.finishT < best)) { lsSet(key, p.finishT.toFixed(2)); $("over-best").textContent = "NEW BEST " + fmtTime(p.finishT); }
    else $("over-best").textContent = best ? "BEST " + fmtTime(best) : "";
    show("over");
    RR.Audio.song("menu");
  }

  // ---------------- main loop ----------------
  let last = 0, acc = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dtR = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    if (G.state === "loading" || G.state === "building") return;
    const slow = hitStop > 0 ? 0.12 : 1;
    hitStop = Math.max(0, hitStop - dtR);
    if (!G.paused && !G.frozen) {
      acc += dtR * slow;
      let n = 0;
      while (acc >= 1 / 60 && n < 4) { step(1 / 60); acc -= 1 / 60; n++; }
      if (n === 4) acc = 0;
      if (finishShown > 0) { finishShown -= dtR; if (finishShown <= 0) results(); }
    }
    const vdt = G.paused || G.frozen ? 0 : dtR * slow;
    G.racers.forEach(function (r) { visual(r, vdt); });
    world.update(G.t, vdt);
    fx.update(vdt);
    updateCamera(G.frozen ? 1 / 60 : dtR);
    if (motes) motes.update(camera, G.t);
    sky.follow(G.player ? G.player.g.position : camera.position, G.t);
    sky.followCam(camera, G.player ? G.player.g.position : camera.position);
    updateHud(dtR);
    flash = Math.max(0, flash - dtR * 2);
    if (post) post.render(scene, camera, { speed: G.player && G.state !== "menu" ? Math.min(1, G.player.boost * 1.5) : 0, time: G.t, flash: flash });
    else renderer.render(scene, camera);
    if (!AUTO && RR.num("fixedres", 0) !== 1) {
      frameAcc += dtR; frameN++;
      if (frameAcc > 1.2) {
        const ms = frameAcc / frameN * 1000;
        const prev = renderScale;
        if (ms > 21) renderScale = Math.max(0.5, renderScale * 0.88);
        else if (ms < 15.5) renderScale = Math.min(1, renderScale * 1.06);
        if (Math.abs(prev - renderScale) > 0.01) resize();
        frameAcc = 0; frameN = 0;
      }
    }
  }

  // headless: race in fast-forward, report the result in the title
  function runSim() {
    let left = SIM;
    function chunk() {
      for (let i = 0; i < 600 && left > 0; i++) {
        step(1 / 60); left -= 1 / 60;
        if (G.racers.every(function (r) { return r.finished; })) left = 0;
      }
      document.title = "SIM " + (SIM - left).toFixed(0);
      if (left > 0) { setTimeout(chunk, 0); return; }
      const out = G.racers.map(function (r) { return { n: r.name, place: r.place, fin: r.finished ? +r.finishT.toFixed(1) : null, d: Math.round(r.raceDist), hype: Math.round(r.hype), st: r.st }; });
      document.title = JSON.stringify({ course: world.key, t: +G.t.toFixed(1), L: Math.round(track.L), racers: out, stats: G.stats });
    }
    chunk();
  }
  // headless screenshots: fast-forward until an event (+ lead seconds), then freeze and render
  function runUntil() {
    let guard = 0;
    const at = RR.num("at", 0);
    G.frozen = true;
    function chunk() {
      for (let i = 0; i < 120; i++) {
        step(1 / 60); guard += 1 / 60;
        G.racers.forEach(function (r) { visual(r, 1 / 60); });
        world.update(G.t, 1 / 60);
        fx.update(1 / 60);
        updateCamera(1 / 60);
        updateHud(1 / 60);
        const ps = G.player.ti * track.ds;
        if ((UNTIL === "t" && G.raceT >= at) || (UNTIL === "s" && G.state === "race" && G.player.state === "ride" && ps >= at)) G.events[UNTIL] = G.events[UNTIL] || G.t;
        const hit = G.events[UNTIL];
        if (hit !== undefined && hit !== null && G.t - hit >= LEAD) {
          G.frozen = true;
          document.title = "AT " + UNTIL + " " + G.t.toFixed(2);
          return;
        }
        if (guard > 400) { document.title = "NO EVENT " + UNTIL; G.frozen = true; return; }
      }
      setTimeout(chunk, 0);
    }
    chunk();
  }

  function boot() {
    loadText.textContent = "BUILDING HOUSTON";
    setTimeout(function () {
      build();
      const ck = RR.param("course", null);
      G.ev = Math.max(0, EVENTS.indexOf(RR.num("tour", 0) === 1 ? "tour" : ck || lsGet("tcb_ev") || "skate"));
      const startKey = EVENTS[G.ev] === "tour" ? "skate" : EVENTS[G.ev];
      setCourse(startKey);
      buildMenu();
      G.pick = RR.clamp(RR.num("pick", 0), 0, ROSTER.length - 1);
      G.player = G.all[G.pick];
      $("loading").classList.add("done");
      if (NOMENU) {
        G.state = "menu";
        if (EVENTS[G.ev] === "tour") G.tour = { i: 0, pts: {}, field: null };
        startRace();
        if (SIM) { show(null); runSim(); }
        else if (UNTIL) runUntil();
      } else toMenu();
      requestAnimationFrame(frame);
    }, 30);
  }
  addEventListener("beforeunload", function () { lsSet("tcb_ev", EVENTS[G.ev]); });
  loadChars(boot);
})(window.RR = window.RR || {});
