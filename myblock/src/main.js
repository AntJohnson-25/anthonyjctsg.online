// Boot, menus, the frame loop, the over-the-shoulder camera, the death camera,
// and event routing to sound / effects / bodies / HUD. A bots-only battle plays
// behind the menu. (Structure from Summit Protocol's main, solo only.)
//
// Third person: the mouse turns the camera (G.look), which sits behind Ant's
// right shoulder. Every frame the crosshair's ray is cast into the world and
// Ant's aim (the sim's yaw and pitch) is pointed from his eyes at whatever it
// hits, so shots land where the crosshair is although the camera is off to the
// side. With the marksman rifle, aiming goes to the scope (first person).
globalThis.SP = globalThis.SP || {};
(function (SP) {
  "use strict";
  const U = SP.U, V = SP.View, Mo = SP.Models, A = SP.Audio, I = SP.Input, H = SP.HUD, WP = SP.WEAPONS, t = SP.t, KC = SP.KillCam;
  const $ = function (id) { return document.getElementById(id); };
  const STEP = 1 / 60;
  const CAM = { dist: 2.6, aimDist: 1.4, side: 0.62, aimSide: 0.55, height: 1.62, up: 0.18 };
  const G = {
    sim: null, mode: "boot", opts: { mode: "tdm", difficulty: "regular", seats: 8, dead: "on" }, quality: "high", sound: true,
    acc: 0, last: 0, t: 0, shake: 0, recoil: 0, recoilYaw: 0, deathCam: null, steps: {}, menuAng: 0,
    look: { yaw: 0, pitch: 0 }, cam: null, aimPt: null, aim: -1, endT: -1, turnHold: 0, flipLeft: 0, adsK: 0,
    holds: { settings: false, hidden: false }
  };
  function held() { return G.holds.settings || G.holds.hidden; }

  // ?debug=1: a status line (fps, resolution, shadows).
  const DEBUG = /[?&]debug=1\b/.test(location.search);
  function startDebug() {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;left:8px;bottom:70px;z-index:99;font:12px monospace;color:#cfe;background:rgba(0,0,0,.6);padding:4px 8px;pointer-events:none";
    document.body.appendChild(el);
    setInterval(function () {
      el.textContent = Math.round(V.fps()) + " fps · res " + V.pixelRatio().toFixed(2) + " · shadows " + V.shadowMode + (V.autoStatic ? " (auto)" : "") + " · audio " + (A.ready() ? "ready" : "…");
    }, 500);
  }
  function checkRotate() {
    $("rotate").hidden = !(I.touch && window.innerHeight > window.innerWidth && !G.rotateOk);
  }

  function setLoad(f, msg) {
    $("loadFill").style.width = (f * 100) + "%";
    if (msg) $("loadMsg").textContent = msg;
  }
  function loadPrefs() {
    try {
      const s = JSON.parse(localStorage.getItem("mb.prefs") || "{}");
      if (s.quality) { G.quality = s.quality; G.qualitySaved = true; }
      if (s.sound === false) G.sound = false;
      if (SP.MODES[s.mode]) G.opts.mode = s.mode;
      if (SP.DIFF[s.difficulty]) G.opts.difficulty = s.difficulty;
      if ([8, 12].indexOf(s.seats) >= 0) G.opts.seats = s.seats;
      if (s.dead === "on" || s.dead === "off") G.opts.dead = s.dead;
      if (typeof s.music === "number") A.musicVol = s.music;
      if (typeof s.sfx === "number") A.sfxVol = s.sfx;
      if (s.outlines === false) Mo.outlines = false;
      if (s.killcam === false) KC.on = false;
    } catch (e) { /* storage unavailable */ }
    // A phone or tablet with no saved choice starts lighter (phones: low, tablets: medium, no enemy outline hulls).
    if (SP.isCoarse() && !G.qualitySaved) { G.quality = Math.min(screen.width, screen.height) < 600 ? "low" : "medium"; Mo.outlines = false; }
  }
  function savePrefs() {
    try { localStorage.setItem("mb.prefs", JSON.stringify({ quality: G.quality, sound: G.sound, mode: G.opts.mode, difficulty: G.opts.difficulty, seats: G.opts.seats, dead: G.opts.dead, music: A.musicVol, sfx: A.sfxVol, outlines: Mo.outlines, killcam: KC.on })); } catch (e) { /* ignore */ }
  }

  // The cover (art/key_title.jpg, or the tall one on a phone held upright) shows once before the setup screen;
  // if the art is missing the setup screen comes straight up.
  function showCover() {
    const land = $("landing"), done = function () { $("menu").hidden = false; };
    if (!land || G.coverSeen) { done(); return; }
    G.coverSeen = true;
    const img = new Image();
    img.onload = function () { if (G.mode === "menu") land.hidden = false; else done(); };
    img.onerror = done;
    img.src = window.matchMedia && window.matchMedia("(orientation: portrait)").matches ? "art/key_portrait.jpg" : "art/key_title.jpg";
    const go = function () { if (land.hidden) return; land.hidden = true; $("menu").hidden = false; A.unlock(); A.song("menu"); };
    land.addEventListener("click", go);
    window.addEventListener("keydown", function (e) { if (!land.hidden && (e.code === "Enter" || e.code === "Space")) { e.preventDefault(); go(); } });
  }

  function boot() {
    SP.fillStrings();
    if (DEBUG) startDebug();
    ["pointerdown", "keydown"].forEach(function (ev) {
      window.addEventListener(ev, function () { A.unlock(); A.song(G.mode === "play" ? "match" : "menu"); }, { once: true, passive: true });
    });
    setLoad(0.12, t("boot1"));
    loadPrefs();
    A.loadTracks();
    setTimeout(function () {
      G.world = new SP.World(SP.MAP.boxes, SP.MAP.bounds);
      G.nav = new SP.Nav(G.world, SP.MAP);
      setLoad(0.45, t("boot2"));
      setTimeout(function () {
        V.init($("view"), G.quality);
        setLoad(0.8, t("boot3"));
        I.init($("view"), {
          pause: function () { if (G.mode === "play") pause(true); },
          escape: function () { if (G.holds.settings) resume(); },
          mute: function () { setSound(!G.sound); },
          touchMode: function () {
            $("keysDesk").hidden = true; $("keysTouch").hidden = false;
            if (H.el) H.relabel();
            if (G.mode === "play") $("touch").hidden = false;
            checkRotate();
          }
        });
        H.init();
        A.setOn(G.sound);
        wireMenus();
        Mo.prepare(function () {
          startDemo();
          setLoad(1, t("ready"));
          $("loading").hidden = true;
          if (G.mode === "menu") showCover();
          G.last = performance.now();
          requestAnimationFrame(loop);
          G.ready = true;
        });
      }, 30);
    }, 30);
  }

  function newSim(o) {
    o.world = G.world; o.nav = G.nav; o.map = SP.MAP;
    const s = SP.createSim(o);
    s.players.forEach(function (p) { p._px = p.x; p._py = p.y; p._pz = p.z; });
    return s;
  }

  function startDemo() {
    G.sim = newSim({ mode: "tdm", difficulty: "regular", human: false, prematch: 0, timeLimit: 1e6, scoreLimit: 1e6, seats: 8 });
    Mo.setPlayers(G.sim);
    G.mode = "menu";
    I.active = false;
    $("hud").hidden = true;
    A.song("menu");
  }

  function startMatch() {
    A.unlock();
    const sim = newSim({ mode: G.opts.mode, difficulty: G.opts.difficulty, human: true, humanName: "Alex", seats: G.opts.seats, zombies: G.opts.dead === "on" ? 6 : 0 });
    Mo.setPlayers(sim);
    enterPlay(sim);
  }

  function enterPlay(sim) {
    G.sim = sim;
    const me = sim.players[sim.humanId];
    G.look.yaw = me.yaw; G.look.pitch = 0; G.cam = null;
    H.setup(sim);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    KC.reset(); setKillcamUi(false);
    G.mode = "play"; G.acc = 0; G.deathCam = null; G.flipLeft = 0; G.endT = -1; G.shake = 0; G.recoil = 0; G.recoilYaw = 0;
    G.holds.settings = false;
    I.active = !held(); I.clearEdges();
    ["menu", "final", "pause"].forEach(function (id) { $(id).hidden = true; });
    $("hud").hidden = false;
    $("clicklock").hidden = true;
    $("touch").hidden = !I.touch;
    I.lock();
    A.song("match");
  }

  function setHold(reason, on) {
    const was = held();
    G.holds[reason] = on;
    if (held() && !was) { I.active = false; I.keys = {}; I.clearEdges(); I.unlock(); }
    else if (!held() && was && G.mode === "play") { I.active = true; I.clearEdges(); }
  }
  function pause(on) {
    if (on) { setHold("settings", true); $("pause").hidden = false; syncPause(); A.duck(true); }
  }
  function resume() {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    $("pause").hidden = true;
    setHold("settings", false);
    A.duck(false);
    if (!held()) I.lock();
  }
  function backToMenu() {
    ["final", "pause"].forEach(function (id) { $(id).hidden = true; });
    G.holds.settings = false; A.duck(false);
    startDemo(); $("menu").hidden = false;
  }

  function setSound(on) { G.sound = on; A.setOn(on); savePrefs(); syncPause(); }
  function syncPause() {
    $("pSound").textContent = G.sound ? t("on") : t("off");
    $("pQuality").textContent = t("q" + G.quality);
    $("pInvert").textContent = I.invert ? t("on") : t("off");
    $("pOutline").textContent = Mo.outlines ? t("on") : t("off");
    $("pKillcam").textContent = KC.on ? t("on") : t("off");
    $("pSens").value = I.sens; $("pTurn").value = I.turnSpeed;
    $("pMusic").value = A.musicVol; $("pSfx").value = A.sfxVol;
  }

  function wireMenus() {
    function seg(id, key, parse) {
      const el = $(id);
      el.querySelectorAll("button").forEach(function (b) {
        const v = parse ? parse(b.dataset.v) : b.dataset.v;
        b.classList.toggle("on", v === G.opts[key]);
        b.addEventListener("click", function () {
          G.opts[key] = v;
          el.querySelectorAll("button").forEach(function (o) { o.classList.toggle("on", o === b); });
          savePrefs();
          A.unlock(); A.play("tick");
        });
      });
    }
    seg("optMode", "mode");
    seg("optDiff", "difficulty");
    seg("optSeats", "seats", function (v) { return parseInt(v, 10); });
    seg("optDead", "dead");
    $("btnPlay").addEventListener("click", startMatch);
    $("pResume").addEventListener("click", resume);
    $("pSound").addEventListener("click", function () { setSound(!G.sound); });
    $("pInvert").addEventListener("click", function () { I.invert = !I.invert; I.save(); syncPause(); });
    $("pOutline").addEventListener("click", function () { Mo.outlines = !Mo.outlines; savePrefs(); syncPause(); });
    $("pKillcam").addEventListener("click", function () { KC.on = !KC.on; savePrefs(); syncPause(); });
    $("pSens").addEventListener("input", function () { I.sens = parseFloat($("pSens").value); I.save(); });
    $("pTurn").addEventListener("input", function () { I.turnSpeed = parseFloat($("pTurn").value); I.save(); });
    $("pMusic").addEventListener("input", function () { A.setMusicVol(parseFloat($("pMusic").value)); savePrefs(); });
    $("pSfx").addEventListener("input", function () { A.setSfxVol(parseFloat($("pSfx").value)); savePrefs(); });
    $("pQuality").addEventListener("click", function () {
      G.quality = G.quality === "high" ? "medium" : G.quality === "medium" ? "low" : "high";
      V.setQuality(G.quality); savePrefs(); syncPause();
    });
    // Controls screen: keyboard + mouse and touch, opened from the setup screen and the pause menu.
    function showControls(tab) {
      $("ctlTabs").querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b.dataset.v === tab); });
      $("ctlBody").innerHTML = SP.CONTROLS[tab].map(function (sec) {
        return "<section><h3>" + sec[0] + "</h3>" + sec[1].map(function (r) { return "<div class='ctl-row'><kbd>" + r[0] + "</kbd><span>" + r[1] + "</span></div>"; }).join("") + "</section>";
      }).join("");
      $("ctlBody").scrollTop = 0;
    }
    function openControls() { $("controls").hidden = false; showControls(I.touch ? "touch" : "kb"); }
    function closeControls() { $("controls").hidden = true; }
    $("btnControls").addEventListener("click", openControls);
    $("pControls").addEventListener("click", openControls);
    $("ctlBack").addEventListener("click", closeControls);
    $("ctlTabs").querySelectorAll("button").forEach(function (b) { b.addEventListener("click", function () { showControls(b.dataset.v); }); });
    window.addEventListener("keydown", function (e) { if (!$("controls").hidden && (e.code === "Escape" || e.code === "KeyP")) { e.preventDefault(); e.stopPropagation(); closeControls(); } }, true);
    $("pQuit").addEventListener("click", backToMenu);
    $("fAgain").addEventListener("click", startMatch);
    $("fMenu").addEventListener("click", backToMenu);
    $("btnPause").addEventListener("click", function () { if (G.mode === "play") pause(true); });
    $("btnScores").addEventListener("click", function () { H.scoresHeld = !H.scoresHeld; });
    window.addEventListener("resize", function () { V.resize(); checkRotate(); });
    $("rotateOk").addEventListener("click", function () { G.rotateOk = true; $("rotate").hidden = true; });
    document.addEventListener("visibilitychange", function () { setHold("hidden", document.hidden); });
  }

  // ------------------------------------------------------------------ events
  const _mz = new THREE.Vector3();
  // Where player p's barrel is (the body's gun if it has one, else a guess).
  function muzzleWorld(p) {
    const m = Mo.muzzle(p.id, _mz);
    if (m) return { x: m.x, y: m.y, z: m.z };
    const d = U.dir(p.yaw, p.pitch), rx = -Math.sin(p.yaw), rz = Math.cos(p.yaw);
    return { x: p.x + d.x * 0.7 + rx * 0.18, y: p.y + 1.45 + d.y * 0.7, z: p.z + d.z * 0.7 + rz * 0.18 };
  }
  // Recoil climb per shot (radians) and the camera's push.
  const KICK = [0.014, 0.0075, 0.04, 0.03, 0.03, 0];
  function handleEvents(sim) {
    const me = sim.humanId >= 0 ? sim.players[sim.humanId] : null, meId = sim.humanId;
    for (let i = 0; i < sim.events.length; i++) {
      const e = sim.events[i];
      if (G.mode === "play" && me) KC.note(sim, e);
      Mo.event(sim, e);
      const p = e.p !== undefined && e.p >= 0 ? sim.players[e.p] : null;
      const mine = p && p === me && G.mode === "play";
      switch (e.type) {
        case "fire": {
          if (!p) break;
          const m = muzzleWorld(p);
          A.gun(e.w, m.x, m.y, m.z, mine);
          if (e.w <= 4) {
            V.flash(m.x, m.y, m.z, e.w === 2 ? 0.75 : e.w === 4 ? 0.9 : e.w === 0 ? 0.4 : 0.5);
            if (e.w <= 3) V.casing(m.x - Math.cos(p.yaw) * 0.35, m.y, m.z - Math.sin(p.yaw) * 0.35, p.yaw);
          }
          if (mine) { G.recoil += KICK[e.w]; G.recoilYaw += (Math.random() - 0.5) * KICK[e.w] * 0.6; }
          break;
        }
        case "shot": {
          if (!p) break;
          const m = muzzleWorld(p);
          V.tracer(m.x, m.y, m.z, e.x, e.y, e.z, mine);
          if (!mine && me && me.alive) flyby(m, e, me);
          break;
        }
        case "imp":
          V.impact(e.x, e.y, e.z, e.nx, e.ny, e.nz, e.surf);
          if (Math.random() < 0.7) A.emit("imp_" + (e.surf || "concrete"), e.x, e.y, e.z, { vol: 0.55, far: 0.25 });
          break;
        case "blood": V.blood(e.x, e.y, e.z); A.emit("body", e.x, e.y, e.z, { vol: 0.6, far: 0.15 }); break;
        case "boom": {
          V.explosion(e.x, e.y, e.z, e.r);
          A.emit("boom", e.x, e.y, e.z, { vol: 1.8, far: 1 });
          const c = G.cam || (me ? me : null);
          if (c) { const d = Math.hypot(c.x - e.x, c.y - e.y, c.z - e.z); G.shake = Math.max(G.shake, Math.max(0, 1 - d / 26)); }
          break;
        }
        case "bounce": A.emit("bounce", e.x, e.y, e.z, { vol: 0.5, far: 0.15 }); break;
        case "kill": {
          const v = sim.players[e.victim];
          if (e.killer === meId && e.victim !== meId && G.mode === "play") A.play("kill");
          if (e.victim === meId && G.mode === "play") {
            const k = e.killer >= 0 ? sim.players[e.killer] : null;
            G.deathCam = { x: v.x, y: v.y, z: v.z, yaw: G.look.yaw, pitch: -0.3, killer: k && k !== v ? k.id : -1, t: 0 };
            if (KC.begin(sim, e)) showKillcamInfo(sim);
          }
          break;
        }
        case "hit":
          if (G.mode !== "play") break;
          if (e.v === meId && e.p !== meId) A.play("hurt");
          else if (e.p === meId) A.play(e.hs ? "head" : "hit");
          break;
        case "melee": if (p) A.emit("melee", mine ? undefined : p.x, p.y + 1.4, p.z, { vol: 0.7, far: 0.15 }); break;
        case "grab": if (p) A.emit("melee", mine ? undefined : p.x, p.y + 1, p.z, { vol: 1.0, far: 0.25, rate: 0.7 }); break;
        case "throw": { const v = sim.players[e.v]; if (v) { A.emit("smack", v.x, v.y + 1.2, v.z, { vol: 1.1, far: 0.3 }); A.emit("land", v.x, v.y, v.z, { vol: 1.0, far: 0.3, delay: 0.35 }); } break; }
        case "smack": { const v = sim.players[e.v]; if (v) A.emit("smack", v.x, v.y + 1.2, v.z, { vol: 0.9, far: 0.2 }); break; }
        case "reload": if (p) A.reload(e.w, WP[e.w].reload, p.x, p.y + 1.3, p.z, mine); break;
        case "pickup": if (mine) A.play("pickup"); break;
        case "burn": V.flareFire(e.x, e.z); break;
        case "loot": if (mine) { A.play("pickup"); A.play("magin"); } break;
        case "dry": if (mine) A.play("dry"); break;
        case "switch": if (mine) A.play("switch"); break;
        case "jump": if (mine) A.play("jump"); break;
        case "land":
          if (mine) A.emit("land", undefined, 0, 0, { vol: Math.min(1, e.v / 10) });
          else if (p) A.emit("land", p.x, p.y, p.z, { vol: 0.5, far: 0.15 });
          break;
        case "zspot": if (p && Math.random() < 0.6) A.emit("zscream", p.x, p.y + 1.6, p.z, { vol: 0.9, far: 0.45 }); break;
        case "zattack": if (p) A.emit("zswipe", p.x, p.y + 1.5, p.z, { vol: 0.9, far: 0.2 }); break;
        case "roll": if (p) A.emit("land", mine ? undefined : p.x, p.y, p.z, { vol: 0.7, far: 0.15 }); break;
        case "climb": if (p) A.emit("switch", mine ? undefined : p.x, p.y + 1, p.z, { vol: 0.8, far: 0.15 }); break;
        case "deliver": case "pack": if (me && G.mode === "play") A.play(e.team === me.team ? "capture" : "lost"); break;
        case "take": if (me && G.mode === "play" && p && p !== me) A.emit("switch", p.x, p.y + 1, p.z, { vol: 0.7, far: 0.2 }); break;
        case "drop": if (me && G.mode === "play") A.emit("land", e.x, e.y, e.z, { vol: 0.8, far: 0.3 }); break;
        case "go": if (me && G.mode === "play") A.play("go"); break;
        case "end": if (me && G.mode === "play") G.endT = 0; break;
        case "spawn":
          if (e.rise && p) A.emit("rise", p.x, p.y + 0.5, p.z, { vol: 1, far: 0.3 });
          if (mine) { G.deathCam = null; KC.stop(); setKillcamUi(false); G.look.yaw = p.yaw; G.look.pitch = 0; G.cam = null; } break;
      }
      if (me && G.mode === "play") H.event(sim, e);
    }
    sim.events.length = 0;
  }
  // A round that passes close to your head cracks or whizzes past.
  function flyby(m, e, me) {
    const hx = me.x, hy = me.y + 1.5, hz = me.z;
    const dx = e.x - m.x, dy = e.y - m.y, dz = e.z - m.z, L2 = dx * dx + dy * dy + dz * dz;
    if (L2 < 1) return;
    const u = U.clamp(((hx - m.x) * dx + (hy - m.y) * dy + (hz - m.z) * dz) / L2, 0, 1);
    const px = m.x + dx * u, py = m.y + dy * u, pz = m.z + dz * u, miss = Math.hypot(px - hx, py - hy, pz - hz);
    if (miss < 3 && u > 0.05 && u < 0.98) A.flyby(e.w, px, py, pz, miss);
  }

  // Kill cam banner: who, with what, and how much health they had left.
  function showKillcamInfo(sim) {
    const c = KC.cur;
    $("kcName").textContent = c.name.toUpperCase();
    $("kcName").style.color = "#" + ("000000" + SP.FACTIONS[sim.factions[c.team]].color.toString(16)).slice(-6);
    const what = c.w >= 0 && c.how === "gun" ? WP[c.w].name : SP.howText(c.how);
    $("kcWhat").textContent = (what ? what + " · " : "") + t("hpLeft", c.hp);
  }
  function setKillcamUi(on) {
    if (G.kcUi === on) return;
    G.kcUi = on;
    $("killcam").hidden = !on;
    document.body.classList.toggle("killcam", on);
  }

  // Footsteps for everyone close enough to hear, and the dead groaning.
  function footsteps(sim, dt) {
    sim.players.forEach(function (p) {
      if (p.zombie && p.alive && p.rise <= 0 && Math.random() < dt * (p.ai.target >= 0 ? 0.45 : 0.18)) A.emit("groan", p.x, p.y + 1.6, p.z, { vol: 0.8, far: 0.25, travel: false });
      if (!p.alive || !p.onGround) return;
      const sp = Math.hypot(p.vx, p.vz);
      if (sp < 1) return;
      G.steps[p.id] = (G.steps[p.id] || 0) + sp * dt;
      const stride = p.sprinting ? 1.9 : 1.5;
      if (G.steps[p.id] > stride) {
        G.steps[p.id] = 0;
        if (p.id === sim.humanId && G.mode === "play") A.emit("step", undefined, 0, 0, { vol: p.sprinting ? 0.3 : 0.18 });
        else A.emit("step", p.x, p.y, p.z, { vol: p.sprinting ? 0.9 : 0.45, far: 0.12, travel: false });
      }
    });
  }

  // ------------------------------------------------------------------ aiming
  function scoped(me) { return me && me.alive && me.aiming && WP[me.cur].scope; }
  // Point Ant's aim from his eyes at what the crosshair (the camera's ray) is on.
  function aimFromCamera(sim, me, cam) {
    const d = U.dir(cam.yaw, cam.pitch);
    // Start the ray level with Ant, so nothing between the camera and him counts.
    const back = Math.max(0, (me.x - cam.x) * d.x + (SP.eyeOf(me) - cam.y) * d.y + (me.z - cam.z) * d.z);
    const ox = cam.x + d.x * back, oy = cam.y + d.y * back, oz = cam.z + d.z * back;
    const tr = SP.trace(sim, me, ox, oy, oz, d, 220, null);
    G.aim = tr.p ? tr.p.id : -1;
    let ax = tr.x, ay = tr.y, az = tr.z;
    const ex = me.x, ey = SP.eyeOf(me), ez = me.z;
    if (Math.hypot(ax - ex, az - ez) < 2.5) { ax = ox + d.x * 30; ay = oy + d.y * 30; az = oz + d.z * 30; }
    G.aimPt = { x: ax, y: ay, z: az };
    sim.input.yaw = Math.atan2(az - ez, ax - ex);
    sim.input.pitch = U.clamp(Math.atan2(ay - ey, Math.hypot(ax - ex, az - ez)), -1.4, 1.4);
  }

  // ------------------------------------------------------------------ loop
  function step(sim) {
    sim.players.forEach(function (p) { p._px = p.x; p._py = p.y; p._pz = p.z; });
    sim.step(STEP);
    handleEvents(sim);
    if (G.mode === "play" && sim.humanId >= 0) KC.record(sim);
  }
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - G.last) / 1000);
    G.last = now;
    advance(dt);
    render(dt);
  }

  function advance(dt) {
    const sim = G.sim;
    G.t += dt;
    const me = sim.humanId >= 0 ? sim.players[sim.humanId] : null;
    const inp = sim.input;
    if (G.mode === "play" && me && held()) {
      inp.mx = inp.mz = 0; inp.sprint = false; inp.fire = false; inp.aim = false;
      I.lookX = 0; I.lookY = 0;
    } else if (G.mode === "play" && me) {
      // The weapon wheel (hold F): while it's open the mouse picks a slot
      // instead of turning, and letting go of F takes that gun.
      if (me.alive && I.wheelHeld()) {
        if (!G.wheel) G.wheel = { x: 0, y: 0, sel: me.cur };
        G.wheel.x += I.lookX; G.wheel.y += I.lookY;
        const m = Math.hypot(G.wheel.x, G.wheel.y);
        if (m > 0.25) { G.wheel.x *= 0.25 / m; G.wheel.y *= 0.25 / m; }
        if (m > 0.04) {
          const a = Math.atan2(G.wheel.y, G.wheel.x);
          let best = 0, bd = 9;
          WP.forEach(function (w, i) { const d = Math.abs(U.wrap(a - H.slotAngle(i))); if (d < bd) { bd = d; best = i; } });
          G.wheel.sel = best;
        }
        I.lookX = 0; I.lookY = 0; I.firePressed = false;
      } else if (G.wheel) {
        if (me.alive && G.wheel.sel !== me.cur) inp.sel = G.wheel.sel;
        G.wheel = null;
      }
      if (me.alive) {
        const zf = me.aiming ? WP[me.cur].ads : 1;
        I.zoomSens = 1 / zf;
        G.look.yaw = U.wrap(G.look.yaw + I.lookX);
        G.look.pitch = U.clamp(G.look.pitch - I.lookY, -1.2, 1.3);
        const kt = I.turn();
        if (kt.yaw) {
          G.turnHold += dt;
          const rate = (0.8 + Math.min(1, G.turnHold / 0.5) * 1.3) * I.turnSpeed / zf;
          G.look.yaw = U.wrap(G.look.yaw + kt.yaw * rate * dt);
        } else G.turnHold = 0;
        if (kt.pitch) G.look.pitch = U.clamp(G.look.pitch + kt.pitch * 1.3 * dt / zf, -1.2, 1.3);
        if (I.flip) { I.flip = false; G.flipLeft = Math.PI; }
        if (G.flipLeft > 0) { const d = Math.min(G.flipLeft, dt * 16); G.look.yaw = U.wrap(G.look.yaw + d); G.flipLeft -= d; }
        // Recoil: the muzzle climbs with each shot and settles back most of the way.
        const settle = Math.min(1, dt * 7);
        G.look.pitch = U.clamp(G.look.pitch + G.recoil * settle * 0.35, -1.2, 1.3);
        G.recoil -= G.recoil * settle; G.recoilYaw -= G.recoilYaw * settle;
      } else {
        G.flipLeft = 0; I.flip = false;
        // Click, Space or FIRE skips the kill cam.
        if (KC.pending() && (I.firePressed || I.jump)) KC.skip();
      }
      I.lookX = 0; I.lookY = 0;
      const mv = I.move();
      inp.mx = mv.mx; inp.mz = mv.mz; inp.sprint = mv.sprint;
      inp.fire = I.fireHeld() && !G.wheel; inp.aim = I.aimHeld();
      if (I.firePressed) inp.firePressed = true;
      if (I.reload) inp.reload = true;
      if (I.sel >= 0) inp.sel = I.sel;
      if (I.next) inp.next = I.next;
      if (I.melee) inp.melee = true;
      if (I.grab) inp.grab = true;
      if (I.jump) inp.jump = true;
      if (I.crouch) inp.crouch = true;
      if (I.roll) inp.roll = true;
      if (I.use) inp.use = true;
      I.firePressed = I.reload = I.melee = I.grab = I.jump = I.crouch = I.roll = I.use = false; I.sel = -1; I.next = 0;
      $("clicklock").hidden = I.locked || (I.kbT || 0) > 0;
    }
    if (G.mode === "play" || G.mode === "menu") {
      G.acc += dt;
      let n = 0;
      while (G.acc >= STEP && n < 7) { step(sim); G.acc -= STEP; n++; }
      if (n === 7) G.acc = 0;
      footsteps(sim, dt);
    }
    if (G.endT >= 0) { G.endT += dt; if (G.endT > 1.6 && G.mode === "play") showFinal(sim); }
  }

  function render(dt) {
    const sim = G.sim;
    const me = sim.humanId >= 0 ? sim.players[sim.humanId] : null;
    const alpha = G.acc / STEP;
    const replay = G.mode === "play" && KC.update(dt);
    setKillcamUi(replay);
    const cam = replay ? KC.camera(sim, dt) : camera(sim, me, dt, alpha);
    if (me && me.alive && G.mode === "play" && !replay) aimFromCamera(sim, me, cam);
    A.setListener(cam.x, cam.y, cam.z, cam.yaw);
    if (replay) Mo.update(KC.cur.proxy, dt, 1, -1, -1, false);
    else Mo.update(sim, dt, alpha, me && G.mode !== "menu" ? me.id : -1, G.aim, scoped(me) || (me && cam.inside));
    V.render(dt, G.t, cam, sim);
    if (me && G.mode !== "menu") {
      let inZone = 0;
      if (sim.mode === "turf" && me.alive) sim.map.points.forEach(function (P, i) {
        if (Math.hypot(me.x - P.x, me.z - P.z) < P.r && Math.abs(me.y - P.y) < 1.7) {
          const st = sim.pt[i];
          inZone = st.state === "cool" ? 0 : st.contested ? 2 : st.state === "packed" ? 4 : st.state === "loading" && st.team === me.team ? 3 : 1;
        }
      });
      H.wheel(G.mode === "play" && me.alive ? G.wheel : null, me);
      const body = me.alive && G.mode === "play" ? SP.corpseNear(sim, me) : null;
      const climb = body ? "body" : me.alive && G.mode === "play" ? (me.climb ? "climbing" : SP.climbAt(sim, me)) : null;
      H.update(sim, dt, { aim: G.aim, spread: SP.spreadOf(me, WP[me.cur]), fov: V.camera.fov, scoped: scoped(me), inZone: inZone,
        climb: climb === "body" ? "lootHint" : climb === "climbing" ? (me.climb.ph === "up" ? "letGo" : "") : climb ? (climb.kind === "ladder" ? "climbHint" : "vaultHint") : me.carry && me.alive ? "carryHint" : "" });
    }
  }

  // Over the right shoulder; tighter and closer while aiming; pulled in when a
  // wall is behind.
  function camera(sim, me, dt, alpha) {
    if (SP.T.cam) return SP.T.cam;
    if (!me || G.mode === "menu") {
      // A slow drift over the block behind the menu.
      G.menuAng += dt * 0.035;
      const a = G.menuAng;
      const cx = Math.cos(a) * 34, cz = Math.sin(a) * 26;
      return { x: cx, y: 13 + Math.sin(a * 0.7) * 3, z: cz, yaw: Math.atan2(-cz, -cx), pitch: -0.36, fovAdd: -6 };
    }
    G.shake = Math.max(0, G.shake - dt * 2.2);
    const sh = G.shake * G.shake * 0.3;
    if (!me.alive && G.deathCam) {
      // Rise over the body and watch whoever did it.
      const d = G.deathCam;
      d.t += dt;
      const k = d.killer >= 0 ? sim.players[d.killer] : null;
      const rise = Math.min(1, d.t / 1.2);
      const cx = d.x - Math.cos(d.yaw) * 3 * rise, cz = d.z - Math.sin(d.yaw) * 3 * rise, cy = d.y + 1.2 + rise * 2.2;
      if (k && k.alive) {
        const ty = Math.atan2(k.z - cz, k.x - cx), tp = Math.atan2(k.y + 1.2 - cy, Math.hypot(k.x - cx, k.z - cz));
        d.yaw = U.turnTo(d.yaw, ty, dt * 3);
        d.pitch += (tp - d.pitch) * Math.min(1, dt * 3);
      }
      return { x: cx, y: cy, z: cz, yaw: d.yaw, pitch: d.pitch, roll: 0, fovAdd: 0 };
    }
    const ix = me._px + (me.x - me._px) * alpha, iy = me._py + (me.y - me._py) * alpha, iz = me._pz + (me.z - me._pz) * alpha;
    const yaw = G.look.yaw + G.recoilYaw, pitch = U.clamp(G.look.pitch + G.recoil * 0.5, -1.25, 1.35);
    const w = WP[me.cur];
    const ads = me.aiming ? 1 : 0;
    G.adsK += (ads - G.adsK) * Math.min(1, dt * 12);
    const rnd = function () { return (Math.random() - 0.5) * sh; };
    if (scoped(me)) {
      // The scope: from the eye, zoomed.
      return { x: ix + rnd(), y: iy + SP.CFG.eye + rnd(), z: iz + rnd(), yaw: yaw, pitch: pitch, roll: 0, fov: V.baseFov / w.ads, inside: true };
    }
    const dist = U.lerp(CAM.dist, CAM.aimDist, G.adsK), side = U.lerp(CAM.side, CAM.aimSide, G.adsK);
    const d = U.dir(yaw, pitch), rx = -Math.sin(yaw), rz = Math.cos(yaw);
    // Pivot over the right shoulder (lower when crouched), then back along the view.
    G.crouchK = (G.crouchK || 0) + ((me.crouch ? 1 : 0) - (G.crouchK || 0)) * Math.min(1, dt * 8);
    const hx = ix, hy = iy + CAM.height - G.crouchK * 0.5, hz = iz;
    let px = hx + rx * side, py = hy + CAM.up, pz = hz + rz * side;
    const sideHit = sim.W.raycast(hx, hy, hz, px - hx, py - hy, pz - hz, 1, true, false);
    if (sideHit) { const s = Math.max(0, sideHit.t - 0.25 / side); px = hx + (px - hx) * s; py = hy + (py - hy) * s; pz = hz + (pz - hz) * s; }
    let bx = -d.x * dist, by = -d.y * dist, bz = -d.z * dist;
    const backHit = sim.W.raycast(px, py, pz, bx, by, bz, 1, true, false);
    let k = 1;
    if (backHit) k = Math.max(0.08, backHit.t - 0.22 / dist);
    // Ease out after a wall (snap in at once) so the camera doesn't pop.
    G.camK = G.camK === undefined || k < G.camK ? k : G.camK + (k - G.camK) * Math.min(1, dt * 5);
    const cx = px + bx * G.camK, cy = py + by * G.camK, cz = pz + bz * G.camK;
    const fovAdd = me.sprinting ? 5 : 0;
    G.cam = { x: cx + rnd(), y: cy + rnd(), z: cz + rnd(), yaw: yaw, pitch: pitch, roll: 0,
      fov: G.adsK > 0.01 ? V.baseFov / U.lerp(1, w.ads, G.adsK) : 0, fovAdd: fovAdd, inside: G.camK * dist < 0.45 };
    return G.cam;
  }

  function showFinal(sim) {
    G.mode = "final";
    $("pause").hidden = true; G.holds.settings = false;
    I.active = false; I.unlock();
    $("hud").hidden = true;
    A.song("results");
    const me = sim.players[sim.humanId];
    const title = sim.winner === -1 ? t("draw") : sim.winner === me.team ? t("victory") : t("defeat");
    $("finalTitle").textContent = title;
    $("finalTitle").style.color = title === t("victory") ? "#ffc93a" : title === t("defeat") ? "#ff6a50" : "#e9eef2";
    $("finalSub").textContent = sim.factions.slice(0, sim.sides).map(function (f, i) { return SP.FACTIONS[f].name + " " + sim.teamScore[i]; }).join("  —  ");
    const rows = sim.players.filter(function (p) { return !p.zombie; }).sort(function (a, b) { return b.score - a.score || b.kills - a.kills; });
    $("finalBody").innerHTML = rows.map(function (p) {
      const nm = String(p.id === sim.humanId ? t("youName") : p.name).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; });
      return "<tr class='" + (p.id === sim.humanId ? "me " : "") + "t" + p.team + "'><td class='l'>" + nm + "</td><td>" + p.score + "</td><td>" + p.kills + "</td><td>" + p.deaths + "</td></tr>";
    }).join("");
    $("final").hidden = false;
  }

  // ------------------------------------------------------------------ test hooks
  // Headless checks drive the game deterministically through these.
  SP.T = {
    G: G,
    start: function (mode, diff, seats) { if (mode) G.opts.mode = mode; if (diff) G.opts.difficulty = diff; if (seats) G.opts.seats = seats; startMatch(); },
    step: function (secs, inp) {
      const sim = G.sim, n = Math.round(secs / STEP);
      for (let i = 0; i < n; i++) { if (inp && sim.humanId >= 0) Object.assign(sim.input, inp); step(sim); }
      G.acc = 0;
      render(0.016);
      return { alive: sim.humanId >= 0 && sim.players[sim.humanId].alive, score: sim.teamScore.slice(), t: sim.t };
    },
    look: function (yaw, pitch) { G.look.yaw = yaw; G.look.pitch = pitch || 0; render(0.016); },
    place: function (x, y, z, yaw, pitch) {
      const me = G.sim.players[G.sim.humanId];
      me.x = me._px = x; me.y = me._py = y; me.z = me._pz = z; me.vx = me.vz = 0;
      G.look.yaw = yaw || 0; G.look.pitch = pitch || 0; G.camK = undefined;
      me.yaw = G.sim.input.yaw = yaw || 0; me.pitch = G.sim.input.pitch = pitch || 0;
      render(0.016);
    },
    give: function (w) { const me = G.sim.players[G.sim.humanId]; me.inv[w].have = true; me.inv[w].mag = WP[w].mag; me.inv[w].res = WP[w].reserve; SP.switchTo(G.sim, me, w); me.switchT = 0; },
    render: function (n) { for (let i = 0; i < (n || 1); i++) render(1 / 60); },
    freeze: function () { G.mode = "frozen"; }
  };

  if (document.readyState === "complete") boot(); else window.addEventListener("load", boot);
})(globalThis.SP);
