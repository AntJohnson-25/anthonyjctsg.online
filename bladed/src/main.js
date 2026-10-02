// Boot, menus, the frame loop, first-person camera and death cam, and event
// routing to sound / particles / HUD. A bot-only match plays behind the menu.
globalThis.HK = globalThis.HK || {};
(function (HK) {
  "use strict";
  const U = HK.U, V = HK.View, Mo = HK.Models, A = HK.Audio, I = HK.Input, H = HK.HUD;
  const $ = function (id) { return document.getElementById(id); };
  const STEP = 1 / 60;
  const G = {
    sim: null, mode: "boot", opts: { mode: "tdm", difficulty: "regular" }, quality: "high", sound: true,
    acc: 0, last: 0, t: 0, bob: 0, dip: 0, roll: 0, fovAdd: 0, deathCam: null, steps: {}, menuAng: 0,
    aim: -1, lunge: false, pickupT: 9, endT: -1, turnHold: 0, flipLeft: 0
  };

  function setLoad(f, msg) { $("loadFill").style.width = (f * 100) + "%"; if (msg) $("loadMsg").textContent = msg; }
  function settings() {
    try {
      const s = JSON.parse(localStorage.getItem("hk.prefs") || "{}");
      if (s.quality) G.quality = s.quality;
      if (s.sound === false) G.sound = false;
      if (s.mode) G.opts.mode = s.mode;
      if (s.difficulty) G.opts.difficulty = s.difficulty;
    } catch (e) { /* storage unavailable */ }
  }
  function savePrefs() {
    try { localStorage.setItem("hk.prefs", JSON.stringify({ quality: G.quality, sound: G.sound, mode: G.opts.mode, difficulty: G.opts.difficulty })); } catch (e) { /* ignore */ }
  }

  function boot() {
    setLoad(0.15, "Building the yacht…");
    const touchDevice = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
    G.quality = touchDevice ? "medium" : "high";
    settings();
    setTimeout(function () {
      G.world = new HK.World(HK.MAP.boxes);
      G.nav = new HK.Nav(G.world, HK.MAP);
      setLoad(0.5, "Lowering the tender…");
      setTimeout(function () {
        V.init($("view"), G.quality);
        setLoad(0.85, "Sharpening knives…");
        I.init($("view"), {
          pause: function () { if (G.mode === "play") pause(true); },
          unlocked: function () { if (G.mode === "play" && !G.sim.over) pause(true); },
          escape: function () { if (G.mode === "pause") resume(); },
          mute: function () { setSound(!G.sound); },
          touchMode: function () { $("keysDesk").hidden = true; $("keysTouch").hidden = false; checkRotate(); }
        });
        H.init();
        A.setOn(G.sound);
        wireMenus();
        setLoad(0.92, "Boarding the crew…");
        // The first deal of characters downloads behind the loading bar; later
        // deals load in the background while you play.
        Mo.prepare(function () {
          startDemo();
          setTimeout(function () {
            $("loading").hidden = true;
            if (G.mode === "menu") $("menu").hidden = false;
            G.last = performance.now();
            requestAnimationFrame(loop);
          }, 60);
        });
      }, 30);
    }, 30);
  }

  function newSim(o) {
    o.world = G.world; o.nav = G.nav; o.map = HK.MAP;
    const s = HK.createSim(o);
    s.players.forEach(function (p) { p._px = p.x; p._py = p.y; p._pz = p.z; });
    return s;
  }

  function startDemo() {
    G.sim = newSim({ mode: "tdm", difficulty: "regular", human: false, prematch: 0, timeLimit: 1e6, scoreLimit: 1e6 });
    Mo.setPlayers(G.sim);
    G.mode = "menu";
    I.active = false;
    $("hud").hidden = true;
    H.clearCut();
  }

  function startMatch() {
    A.unlock();
    G.sim = newSim({ mode: G.opts.mode, difficulty: G.opts.difficulty, human: true });
    Mo.setPlayers(G.sim);
    Mo.setSleeve(G.sim.mode === "tdm" ? 0x2d3a4e : 0x3a3f46);
    H.setup(G.sim);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    G.mode = "play"; G.acc = 0; G.deathCam = null; G.flipLeft = 0; G.endT = -1; G.pickupT = 9; G.fovAdd = 0; G.dip = 0;
    I.active = true; I.clearEdges();
    ["menu", "final", "pause"].forEach(function (id) { $(id).hidden = true; });
    $("hud").hidden = false;
    $("touch").hidden = !I.touch;
    $("clicklock").hidden = true;
    I.lock();
  }

  function pause(on) {
    if (on) {
      G.mode = "pause";
      I.active = false;
      I.unlock();
      $("pause").hidden = false;
      syncPause();
    }
  }
  function resume() {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    $("pause").hidden = true;
    G.mode = "play";
    I.active = true;
    I.clearEdges();
    G.last = performance.now();
    I.lock();
  }
  function setSound(on) { G.sound = on; A.setOn(on); savePrefs(); syncPause(); }
  function syncPause() {
    $("pSound").textContent = G.sound ? "ON" : "OFF";
    $("pQuality").textContent = G.quality.toUpperCase();
    $("pInvert").textContent = I.invert ? "ON" : "OFF";
    $("pSens").value = I.sens;
    $("pTurn").value = I.turnSpeed;
  }

  function wireMenus() {
    function seg(id, key) {
      const el = $(id);
      el.querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("on", b.dataset.v === G.opts[key]);
        b.addEventListener("click", function () {
          G.opts[key] = b.dataset.v;
          el.querySelectorAll("button").forEach(function (o) { o.classList.toggle("on", o === b); });
          savePrefs();
          A.unlock(); A.play("tick");
        });
      });
    }
    seg("optMode", "mode");
    seg("optDiff", "difficulty");
    $("btnPlay").addEventListener("click", startMatch);
    $("pResume").addEventListener("click", resume);
    $("pRestart").addEventListener("click", startMatch);
    $("pQuit").addEventListener("click", function () { $("pause").hidden = true; startDemo(); $("menu").hidden = false; });
    $("pSound").addEventListener("click", function () { setSound(!G.sound); });
    $("pInvert").addEventListener("click", function () { I.invert = !I.invert; I.save(); syncPause(); });
    $("pSens").addEventListener("input", function () { I.sens = parseFloat($("pSens").value); I.save(); });
    $("pTurn").addEventListener("input", function () { I.turnSpeed = parseFloat($("pTurn").value); I.save(); });
    $("pQuality").addEventListener("click", function () {
      G.quality = G.quality === "high" ? "medium" : G.quality === "medium" ? "low" : "high";
      V.setQuality(G.quality); savePrefs(); syncPause();
    });
    $("fAgain").addEventListener("click", startMatch);
    $("fMenu").addEventListener("click", function () { $("final").hidden = true; startDemo(); $("menu").hidden = false; });
    $("btnPause").addEventListener("click", function () { if (G.mode === "play") pause(true); });
    const sb = $("btnScores");
    sb.addEventListener("click", function () { H.scoresHeld = !H.scoresHeld; });
    $("rotateOk").addEventListener("click", function () { G.rotateOk = true; $("rotate").hidden = true; });
    window.addEventListener("resize", function () { V.resize(); checkRotate(); });
    document.addEventListener("visibilitychange", function () { if (document.hidden && G.mode === "play") pause(true); });
  }
  function checkRotate() {
    $("rotate").hidden = !(I.touch && window.innerHeight > window.innerWidth && !G.rotateOk);
  }

  // ------------------------------------------------------------------ events
  const SURF = { metal: "metal", wood: "wood", glass: "glass", tile: "glass", soft: "soft" };
  function handleEvents(sim) {
    const me = sim.humanId;
    for (let i = 0; i < sim.events.length; i++) {
      const e = sim.events[i];
      const p = e.p !== undefined ? sim.players[e.p] : null;
      switch (e.type) {
        case "throw": A.play("throw", p.id === me ? undefined : p.x, p.y + 1.5, p.z, p.id === me ? 0.7 : 1); break;
        case "lunge": A.play("lunge", p.id === me ? undefined : p.x, p.y + 1.5, p.z, 0.8); if (p.id === me) G.fovAdd = -7; break;
        case "swing": A.play("whoosh", p.id === me ? undefined : p.x, p.y + 1.5, p.z, 0.8); break;
        case "kill": {
          const v = sim.players[e.victim];
          A.play("stab", v.x, v.y + 1.2, v.z, 1.2);
          V.burst(v.x, v.y + 1.2, v.z, 26, 0x6e0b0b, 2.2, 1.0, 9, 0.7);
          if (e.killer === me && e.victim !== me) A.play("kill");
          if (e.victim === me) {
            A.play("death");
            const k = e.killer >= 0 ? sim.players[e.killer] : null;
            G.deathCam = { x: v.x, y: v.y, z: v.z, yaw: sim.input.yaw, pitch: 0, killer: k && k !== v ? k.id : -1, t: 0 };
          }
          break;
        }
        case "impact": {
          A.play(SURF[e.surf] || "metal", e.x, e.y, e.z, 1);
          if (e.surf === "metal") V.burst(e.x, e.y, e.z, 10, 0xffd27a, 3, 0.5, 9, 0.25);
          else if (e.surf === "wood") V.burst(e.x, e.y, e.z, 8, 0x7a5a38, 2, 0.8, 9, 0.5);
          else if (e.surf === "glass" || e.surf === "tile") V.burst(e.x, e.y, e.z, 8, 0xe8f6ff, 2, 0.6, 9, 0.4);
          break;
        }
        case "clatter": A.play("clatter", e.x, e.y, e.z, 0.7); break;
        case "splash": A.play("splash", e.x, e.y, e.z, 1.3); V.burst(e.x, e.y + 0.1, e.z, 24, 0xeaf6ff, 2.5, 3, 9, 0.7); V.ring(e.x, e.y, e.z); break;
        case "pickup": if (p.id === me) { A.play("pickup"); G.pickupT = 0; } else A.play("pickup", p.x, p.y + 1, p.z, 0.5); break;
        case "jump": if (p.id === me) A.play("jump"); break;
        case "land": if (p.id === me) { A.play("land", undefined, 0, 0, Math.min(1, e.v / 12)); G.dip = Math.min(0.22, e.v * 0.018); } break;
        case "dry": if (p.id === me) A.play("dry"); break;
        case "go": if (me >= 0) A.play("horn"); break;
        // Rogue Wave: horn on the warning, then the crash, spray down the
        // starboard side and a lurch of the camera (bigger if it hit you).
        case "wavewarn": A.play("horn"); A.play("swell"); break;
        case "wavehit": {
          A.play("crash");
          for (let x = -32; x <= 34; x += 3) V.burst(x, 0.6, Math.min(9.3, HK.MAP.halfWidth(x) + 0.3), 10, 0xeaf6ff, 5, 4.5, 9, 0.9);
          const mine = me >= 0 && sim.players[me];
          G.waveT = 0;
          G.waveAmp = mine && mine.staggerT > 0 ? 1 : 0.4;
          break;
        }
        case "end": if (me >= 0) { A.play("horn"); G.endT = 0; } break;
        case "spawn": if (p.id === me) { G.deathCam = null; G.fovAdd = 0; } break;
      }
      if (me >= 0) H.event(sim, e);
    }
    sim.events.length = 0;
  }

  // Footsteps for everyone close enough to hear: the main warning in a knife fight.
  function footsteps(sim, dt) {
    sim.players.forEach(function (p) {
      if (!p.alive || !p.onGround) return;
      const sp = Math.hypot(p.vx, p.vz);
      if (sp < 1) return;
      G.steps[p.id] = (G.steps[p.id] || 0) + sp * dt;
      const stride = p.sprinting ? 2.1 : 1.6;
      if (G.steps[p.id] > stride) {
        G.steps[p.id] = 0;
        if (p.id === sim.humanId) A.play("step", undefined, 0, 0, p.sprinting ? 0.35 : 0.22);
        else A.play("step", p.x, p.y, p.z, p.sprinting ? 1.4 : 0.6);
      }
    });
  }

  // ------------------------------------------------------------------ aim helpers
  function aimInfo(sim, me) {
    G.aim = -1; G.lunge = false;
    if (!me || !me.alive) return;
    const C = HK.CFG;
    const dx = Math.cos(sim.input.pitch) * Math.cos(sim.input.yaw), dy = Math.sin(sim.input.pitch), dz = Math.cos(sim.input.pitch) * Math.sin(sim.input.yaw);
    const ex = me.x, ey = me.y + C.eye, ez = me.z;
    let best = 0.05;
    sim.players.forEach(function (e) {
      if (!e.alive || !sim.isEnemy(me, e)) return;
      const tx = e.x - ex, ty = e.y + 1.2 - ey, tz = e.z - ez, tl = Math.hypot(tx, ty, tz);
      if (tl > 60) return;
      const a = Math.acos(U.clamp((tx * dx + ty * dy + tz * dz) / tl, -1, 1)) - 0.4 / tl;
      const hd = Math.hypot(e.x - me.x, e.z - me.z);
      const ha = Math.abs(U.wrap(Math.atan2(e.z - me.z, e.x - me.x) - sim.input.yaw));
      const canLunge = hd < C.lungeRange && Math.abs(e.y - me.y) < 1.4 && ha < C.lungeCone;
      if ((a < best || canLunge) && sim.W.los(ex, ey, ez, e.x, e.y + 1.3, e.z)) {
        if (a < best) { best = a; G.aim = e.id; }
        if (canLunge) G.lunge = true;
      }
    });
  }

  // ------------------------------------------------------------------ loop
  function step(sim) {
    sim.players.forEach(function (p) { p._px = p.x; p._py = p.y; p._pz = p.z; });
    sim.step(STEP);
    handleEvents(sim);
  }

  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - G.last) / 1000);
    G.last = now;
    frame(dt);
  }

  function frame(dt) {
    const sim = G.sim;
    G.t += dt;
    const me = sim.humanId >= 0 ? sim.players[sim.humanId] : null;
    if (G.mode === "play" && me) {
      const inp = sim.input;
      if (me.alive) {
        inp.yaw = U.wrap(inp.yaw + I.lookX);
        inp.pitch = U.clamp(inp.pitch - I.lookY, -1.45, 1.45);
        // Arrow keys turn: gentle for the first moment (to line up a throw),
        // then up to ~200 deg/s for turning around.
        const kt = I.turn();
        if (kt.yaw) {
          G.turnHold += dt;
          const rate = (0.8 + Math.min(1, G.turnHold / 0.5) * 1.2) * I.turnSpeed;
          inp.yaw = U.wrap(inp.yaw + kt.yaw * rate * dt);
        } else G.turnHold = 0;
        if (kt.pitch) inp.pitch = U.clamp(inp.pitch + kt.pitch * 1.4 * dt, -1.2, 1.2);
        else if (I.keyboardAim() && kt.yaw) inp.pitch *= Math.max(0, 1 - dt * 3);
        // Quick 180.
        if (I.flip) { I.flip = false; G.flipLeft = Math.PI; }
        if (G.flipLeft > 0) {
          const d = Math.min(G.flipLeft, dt * 16);
          inp.yaw = U.wrap(inp.yaw + d);
          G.flipLeft -= d;
        }
      } else { G.flipLeft = 0; I.flip = false; }
      I.lookX = 0; I.lookY = 0;
      const mv = I.move();
      inp.mx = mv.mx; inp.mz = mv.mz; inp.sprint = mv.sprint;
      // Keyboard players can only aim left/right, so throws lock on by bearing.
      inp.flat = I.keyboardAim();
      inp.assist = I.touch ? 0.14 : inp.flat ? 0.16 : 0.08;
      if (I.melee) inp.melee = true;
      if (I.throw) inp.throw = true;
      if (I.attack) inp.attack = true;
      if (I.jump) inp.jump = true;
      I.melee = I.throw = I.attack = I.jump = false;
      $("clicklock").hidden = I.touch || I.locked || (I.kbT || 0) > 0;
    }
    if (G.mode === "play" || G.mode === "menu") {
      G.acc += dt;
      let n = 0;
      while (G.acc >= STEP && n < 5) { step(sim); G.acc -= STEP; n++; }
      if (n === 5) G.acc = 0;
      footsteps(sim, dt);
    }
    if (G.endT >= 0) {
      G.endT += dt;
      if (G.endT > 1.4 && G.mode === "play") showFinal(sim);
    }
    const alpha = G.mode === "pause" ? 1 : G.acc / STEP;
    if (me) aimInfo(sim, me);
    const cam = camera(sim, me, dt, alpha);
    A.setListener(cam.x, cam.y, cam.z, cam.yaw);
    Mo.update(sim, dt, alpha, me ? me.id : -1, G.aim);
    if (me && G.deathCam) { const c = Mo.charRoot(me.id); if (c) c.visible = true; }
    G.pickupT += dt;
    Mo.updateViewmodel({
      alive: !!me && me.alive && G.mode !== "menu", state: me ? me.state : "idle", stateT: me ? me.stateT : 0,
      move: me ? Math.min(1, Math.hypot(me.vx, me.vz) / 5.4) * (me.onGround ? 1 : 0.3) : 0, sprint: me && me.sprinting,
      air: me && !me.onGround, phase: G.bob, stabT: me ? sim.t - me.stabT : 9, pickupT: G.pickupT
    }, dt);
    V.render(dt, G.t, cam);
    if (me && G.mode !== "menu") H.update(sim, dt, { lunge: G.lunge, aim: G.aim, project: V.project });
  }

  function camera(sim, me, dt, alpha) {
    const C = HK.CFG;
    if (HK.T.cam) return HK.T.cam;
    if (!me || G.mode === "menu") {
      // Slow orbit around the yacht behind the menu.
      G.menuAng += dt * 0.05;
      const a = G.menuAng;
      return { x: Math.cos(a) * 46, y: 14 + Math.sin(a * 0.7) * 3, z: Math.sin(a) * 34, yaw: Math.atan2(-Math.sin(a) * 34, -Math.cos(a) * 46), pitch: -0.28, fovAdd: -14 };
    }
    if (!me.alive && G.deathCam) {
      const d = G.deathCam;
      d.t += dt;
      const k = d.killer >= 0 ? sim.players[d.killer] : null;
      const rise = Math.min(1, d.t / 1.2);
      const cx = d.x - Math.cos(d.yaw) * 1.5 * rise, cz = d.z - Math.sin(d.yaw) * 1.5 * rise, cy = d.y + 0.6 + rise * 1.3;
      if (k && k.alive) {
        const ty = Math.atan2(k.z - cz, k.x - cx), tp = Math.atan2(k.y + 1.2 - cy, Math.hypot(k.x - cx, k.z - cz));
        d.yaw = U.turnTo(d.yaw, ty, dt * 3);
        d.pitch += (tp - d.pitch) * Math.min(1, dt * 3);
      }
      return { x: cx, y: cy, z: cz, yaw: d.yaw, pitch: d.pitch, roll: 0.12 * (1 - rise), fovAdd: 0 };
    }
    const ix = me._px + (me.x - me._px) * alpha, iy = me._py + (me.y - me._py) * alpha, iz = me._pz + (me.z - me._pz) * alpha;
    const sp = Math.hypot(me.vx, me.vz);
    if (me.onGround) G.bob += sp * dt * (me.sprinting ? 1.5 : 1.75);
    const amt = me.onGround ? Math.min(1, sp / 5.4) : 0;
    const bobY = Math.sin(G.bob * 2) * 0.035 * amt * (me.sprinting ? 1.6 : 1);
    G.dip = Math.max(0, G.dip - dt * 0.9);
    const strafe = sim.input.mx || 0;
    G.roll += (-strafe * 0.018 - G.roll) * Math.min(1, dt * 8);
    // Rogue Wave lurch: a hard roll to port that rocks back and settles.
    let waveRoll = 0, wavePitch = 0;
    if (G.waveT !== undefined && G.waveT < 2.6) {
      G.waveT += dt;
      const k = G.waveT, fade = Math.exp(-k * 1.6);
      waveRoll = Math.sin(k * 5.2) * 0.16 * fade * G.waveAmp;
      wavePitch = Math.sin(k * 3.7 + 0.8) * 0.05 * fade * G.waveAmp;
    }
    const fovT = me.state === "lunge" ? -8 : me.sprinting ? 7 : 0;
    G.fovAdd += (fovT - G.fovAdd) * Math.min(1, dt * (me.state === "lunge" ? 20 : 6));
    return {
      x: ix, y: iy + C.eye + bobY - G.dip + (me.inWater ? -0.1 : 0), z: iz,
      yaw: sim.input.yaw, pitch: sim.input.pitch + wavePitch, roll: G.roll + waveRoll + Math.sin(G.bob) * 0.006 * amt, fovAdd: G.fovAdd
    };
  }

  function showFinal(sim) {
    G.mode = "final";
    I.active = false;
    I.unlock();
    $("hud").hidden = true;
    H.clearCut();
    const me = sim.players[sim.humanId];
    let title, sub;
    if (sim.mode === "tdm") {
      title = sim.winner === -1 ? "DRAW" : sim.winner === me.team ? "VICTORY" : "DEFEAT";
      sub = "NAVY " + sim.teamScore[0] + " — " + sim.teamScore[1] + " PIRATES";
    } else {
      const order = sim.players.slice().sort(function (a, b) { return b.kills - a.kills || b.score - a.score; });
      const place = order.indexOf(me) + 1;
      title = place === 1 ? "1ST PLACE" : place === 2 ? "2ND PLACE" : place === 3 ? "3RD PLACE" : place + "TH PLACE";
      sub = "WINNER: " + (order[0] === me ? "YOU" : order[0].name.toUpperCase()) + " · " + order[0].kills + " KILLS";
    }
    $("finalTitle").textContent = title;
    $("finalTitle").style.color = /VICTORY|1ST/.test(title) ? "#ffc93a" : /DEFEAT/.test(title) ? "#ff6a50" : "#e9eef2";
    $("finalSub").textContent = sub;
    const rows = sim.players.slice().sort(function (a, b) { return b.score - a.score || b.kills - a.kills; });
    $("finalBody").innerHTML = rows.map(function (p) {
      return "<tr class='" + (p.id === sim.humanId ? "me " : "") + (sim.mode === "tdm" ? "t" + p.team : "") + "'><td class='l'>" +
        (p.id === sim.humanId ? "You" : p.name) + "</td><td>" + p.score + "</td><td>" + p.kills + "</td><td>" + p.deaths + "</td></tr>";
    }).join("");
    $("final").hidden = false;
  }

  // ------------------------------------------------------------------ test hooks
  // Headless checks drive the game deterministically through these.
  HK.T = {
    G: G,
    start: function (mode, diff) { if (mode) G.opts.mode = mode; if (diff) G.opts.difficulty = diff; startMatch(); },
    step: function (secs, inp) {
      const sim = G.sim, n = Math.round(secs / STEP);
      for (let i = 0; i < n; i++) {
        if (inp && sim.humanId >= 0) Object.assign(sim.input, inp);
        step(sim);
      }
      G.acc = 0;
      frame(0.0001);
      return { alive: sim.humanId >= 0 && sim.players[sim.humanId].alive, score: sim.teamScore.slice(), t: sim.t };
    },
    look: function (yaw, pitch) { G.sim.input.yaw = yaw; G.sim.input.pitch = pitch || 0; frame(0.0001); },
    place: function (x, y, z, yaw, pitch) {
      const me = G.sim.players[G.sim.humanId];
      me.x = me._px = x; me.y = me._py = y; me.z = me._pz = z; me.vx = me.vz = 0;
      G.sim.input.yaw = yaw || 0; G.sim.input.pitch = pitch || 0;
      frame(0.0001);
    },
    freeze: function () { G.mode = "frozen"; }
  };

  window.addEventListener("load", boot);
})(globalThis.HK);
