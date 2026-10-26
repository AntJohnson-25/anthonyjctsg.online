// Rendering: the renderer, the over-the-shoulder camera, the driver and the other actors,
// and keeping the frame rate up on weak laptops. The people are the Meshy characters (chars.js) once
// they've loaded; until then (or opened from disk) blocky stand-ins.
globalThis.WD = globalThis.WD || {};
(function (WD) {
  "use strict";
  const THREE = globalThis.THREE;
  const V = {};

  V.init = function (canvas) {
    V.canvas = canvas;
    V.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, powerPreference: "high-performance" });
    V.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    V.renderer.toneMappingExposure = 0.95;
    V.renderer.shadowMap.enabled = true;
    V.renderer.shadowMap.type = THREE.PCFShadowMap;
    V.scene = new THREE.Scene();
    V.camera = new THREE.PerspectiveCamera(68, 1, 0.08, 400);
    V.camera.rotation.order = "YXZ";
    V.scene.add(V.camera);
    V.quality = { shadows: true, pr: Math.min(devicePixelRatio || 1, 1.5) };
    V.slow = 0; V.fps = 60; V.camSm = null; V.camTmp = {}; V.fov = 68;
    V.resize();
    addEventListener("resize", V.resize);
  };
  V.resize = function () {
    const w = innerWidth, h = innerHeight;
    V.renderer.setPixelRatio(V.quality.pr);
    V.renderer.setSize(w, h, false);
    V.camera.aspect = w / h;
    V.camera.updateProjectionMatrix();
  };
  V.setQuality = function (shadows, pr) {
    V.quality.shadows = shadows; V.quality.pr = pr;
    V.renderer.shadowMap.enabled = shadows;
    if (V.world) V.world.sun.castShadow = shadows;
    V.scene.traverse(function (o) { if (o.material) [].concat(o.material).forEach((x) => { x.needsUpdate = true; }); });
    V.resize();
  };

  // ------------------------------------------------------------------ stand-in people
  const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
  function person(o) {
    const g = new THREE.Group(), parts = {};
    const add = (name, w, h, d, m, x, y, z, parent) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; (parent || g).add(b); parts[name] = b; return b; };
    const shirt = lam(o.shirt), pants = lam(o.pants), skin = lam(o.skin), shoe = lam(0x222222);
    // legs and arms hang from pivots so they can swing
    ["L", "R"].forEach((s, i) => {
      const hip = new THREE.Group(); hip.position.set(i ? 0.11 : -0.11, 0.92, 0); g.add(hip); parts["hip" + s] = hip;
      add("leg" + s, 0.17, 0.86, 0.2, pants, 0, -0.43, 0, hip);
      add("shoe" + s, 0.18, 0.1, 0.3, shoe, 0, -0.87, -0.04, hip);
      const sh = new THREE.Group(); sh.position.set(i ? 0.28 : -0.28, 1.45, 0); g.add(sh); parts["sh" + s] = sh;
      add("arm" + s, 0.13, 0.62, 0.14, shirt, 0, -0.29, 0, sh);
      add("hand" + s, 0.11, 0.12, 0.12, skin, 0, -0.64, 0, sh);
    });
    add("torso", 0.48, 0.62, 0.26, shirt, 0, 1.22, 0);
    add("head", 0.26, 0.3, 0.27, skin, 0, 1.7, 0);
    if (o.cap) { add("cap", 0.29, 0.1, 0.3, lam(o.cap), 0, 1.86, 0); add("brim", 0.27, 0.03, 0.16, lam(o.cap), 0, 1.82, -0.2); }
    if (o.hood) add("hood", 0.31, 0.34, 0.31, lam(o.hood), 0, 1.74, 0.02);
    g.userData.parts = parts; g.userData.phase = 0;
    return g;
  }
  function animate(g, speed, dt, carrying) {
    const P = g.userData.parts;
    g.userData.phase += dt * (2.2 + speed * 1.6);
    const sw = Math.min(1, speed / 4) * 0.7, s = Math.sin(g.userData.phase) * sw;
    P.hipL.rotation.x = s; P.hipR.rotation.x = -s;
    if (carrying) { P.shL.rotation.x = P.shR.rotation.x = 1.15; P.shL.rotation.z = -0.12; P.shR.rotation.z = 0.12; }
    else { P.shL.rotation.x = -s * 0.8; P.shR.rotation.x = s * 0.8; P.shL.rotation.z = P.shR.rotation.z = 0; }
    g.position.y += 0; // (bob is applied by the caller)
    return Math.abs(Math.sin(g.userData.phase)) * 0.05 * Math.min(1, speed / 4);
  }
  function dogMesh() {
    const g = new THREE.Group(), m = lam(0x8a5a32), d = lam(0x5a3a22);
    const b = (w, h, dd, mm, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), mm); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
    b(0.32, 0.3, 0.75, m, 0, 0.45, 0); b(0.26, 0.26, 0.3, m, 0, 0.66, -0.45); b(0.14, 0.1, 0.16, d, 0, 0.6, -0.65);
    b(0.06, 0.12, 0.06, d, -0.1, 0.83, -0.42); b(0.06, 0.12, 0.06, d, 0.1, 0.83, -0.42);
    g.userData.legs = [[-0.11, -0.28], [0.11, -0.28], [-0.11, 0.28], [0.11, 0.28]].map((p) => b(0.08, 0.32, 0.08, d, p[0], 0.16, p[1]));
    b(0.05, 0.05, 0.3, m, 0, 0.6, 0.48).rotation.x = -0.6;
    g.userData.phase = 0;
    return g;
  }
  // A Meshy character (chars.js) when they've loaded, else the stand-in. Returns [group, actor or null].
  function cast(id, standIn) {
    const a = WD.Chars && WD.Chars.ready ? WD.Chars.make(id) : null;
    return a ? [a.group, a] : [standIn(), null];
  }
  // something real-size in a hand bone (the rig's scale undone: the model's size times the armature's 0.01)
  function inHand(A, boneName, obj, pos) {
    const hand = A.bone(boneName);
    if (!hand) return false;
    A.group.updateMatrixWorld(true);
    const s = 1 / hand.getWorldScale(new THREE.Vector3()).x;
    obj.scale.setScalar(s); obj.position.set(pos[0] * s, pos[1] * s, pos[2] * s);
    hand.add(obj);
    return true;
  }

  // ------------------------------------------------------------------ the shift
  V.startShift = function (sim) {
    V.sim = sim;
    if (V.world) V.scene.remove(V.world.group);
    V.world = WD.World.build(sim, V);
    V.world.sun.castShadow = V.quality.shadows;
    V.buildActors(sim);
    V.camSm = null;
  };
  V.buildActors = function (sim) {
    if (V.actors) V.actors.forEach((a) => V.scene.remove(a));
    V.actors = [];
    for (const id in V.chasing || {}) V.scene.remove(V.chasing[id].g);
    V.chasing = {}; V.resBusy = []; V.takeT = null;
    V.real = !!(WD.Chars && WD.Chars.ready);
    [V.driver, V.driverA] = cast(WD.Chars ? WD.Chars.driverId : "driver", () => person({ shirt: 0x2b3a5a, pants: 0xb59f80, skin: 0xb07a52, cap: 0x2b3a5a }));
    // the sack rides on the driver group (not a bone, so it keeps its size); placed over the left shoulder each frame
    V.sack = WD.Gear.sack(); V.driver.add(V.sack);
    V.sackW = 1; V.lastV = 0; V.placeT = 0;
    V.scanT = 0; V.device = null; V.inHandParcel = null;
    if (V.driverA) {
      // Meshy's hand bone: +Y runs down the fingers, +Z out of the palm, so the handheld lies flat, screen up
      V.device = WD.Gear.handheld(); V.device.visible = false;
      if (!inHand(V.driverA, "RightHand", V.device, [0, 0.07, 0.015])) V.device = null;
      // the parcel he takes out of the sack and sets on the mat
      V.inHandParcel = WD.Gear.parcel(0.3, 0.16, 0.22); V.inHandParcel.visible = false;
      if (!inHand(V.driverA, "RightHand", V.inHandParcel, [0, 0.12, 0.1])) V.inHandParcel = null;
    } else { V.sack.position.set(-0.2, 1.5, 0.05); }
    V.actors.push(V.driver);
    V.dog = null; V.dogReal = false;
    if (sim.dog) { const a = cast("dog", dogMesh); V.dog = a[0]; V.dogReal = !!a[1]; V.dog.userData.phase = 0; V.actors.push(V.dog); }
    V.pirate = V.pirateA = null;
    if (sim.pirate) { [V.pirate, V.pirateA] = cast("pirate", () => person({ shirt: 0x2a2c33, pants: 0x1d1f24, skin: 0x8d6446, hood: 0x2a2c33 })); V.actors.push(V.pirate); }
    // the people behind the doors: one of them answers each wrong knock
    V.residents = V.real ? WD.Chars.RESIDENTS.map((id) => WD.Chars.make(id)).filter(Boolean).map((a) => [a.group, a])
      : [[person({ shirt: 0xb94a6a, pants: 0x34405a, skin: 0x9a6a48 }), null]];
    V.residents.forEach((r) => { r[0].visible = false; V.actors.push(r[0]); });
    V.resident = V.residents[0][0]; V.residentA = V.residents[0][1]; V.residentT = 0;
    V.actors.forEach((a) => V.scene.add(a));
  };

  V.event = function (sim, e) {
    const A = V.driverA;
    if (e.t === "wrong") {
      // somebody opens up: a scolding, or they take the valuable parcel off the mat. (A dog or an angry resident
      // comes out as a chaser instead: syncChasers.)
      V.world.openDoor(e.unit, e.out === "dog" || e.out === "angry" ? 1.6 : 2.6);
      if (e.out === "shrug" || e.out === "keep") {
        V.resident.visible = false;
        let i = e.unit % V.residents.length;
        for (let k = 0; k < V.residents.length && V.resBusy[i]; k++) i = (i + 1) % V.residents.length;
        const r = V.residents[i];
        V.resident = r[0]; V.residentA = r[1];
        const d = sim.doorOf(e.unit);
        V.resident.visible = true; V.residentT = e.out === "keep" ? 3.4 : 2.6;
        V.resident.position.set(d.x + 0.1, d.y, d.z + d.nz * 0.55);
        V.resident.rotation.y = (d.nz > 0 ? 0 : Math.PI) + Math.PI;   // faces out
        if (e.out === "keep") {
          V.world.leaveParcel(e.unit); V.takeT = { unit: e.unit, t: 1.5 };   // it lands on the mat, then they scoop it up
          if (V.residentA) V.residentA.once("place", "idle", 2.2);
        } else if (V.residentA) V.residentA.once("nope", "idle", 1.15);
      }
      V.shake = 0.2;
    }
    if (e.t === "deliver") {
      // a parcel out of the sack and down on the mat; the door opens a crack once it's there
      const unit = e.unit;
      if (A && A.has("place")) { A.once("place", "idle", 2.4); V.placeT = 2.1; V.placeUnit = unit; if (V.inHandParcel) V.inHandParcel.visible = true; }
      else { V.world.leaveParcel(unit); V.world.openDoor(unit, 0.9); }
    }
    if (e.t === "load" && A) A.once("load", "idle", 1.8);
    if (e.t === "scan") V.scanT = 3;
    if (e.t === "stagger") { V.shake = 0.45; if (A) A.once("hit", "idle", 1.3); }
    if (e.t === "steal") V.shake = 0.45;   // a snatch on the run: he just bolts
  };

  // The driver's clip for this frame: one-shots play out unless you walk off; scanning shows the handheld.
  function driverClip(A, p, dt) {
    const m = p.stagger > 0 ? 0 : p.moving;
    V.scanT = Math.max(0, V.scanT - dt);
    V.scanning = V.scanT > 0 && m < 3;   // a look at the handheld (not at a full run)
    if (A.busy() && m < 1.5) return;
    if (V.scanning) {
      if (m < 0.4) A.play("scan");
      else { A.play("scan_walk"); A.speed(Math.min(2.2, Math.max(0.6, m / Math.max(0.3, A.pace("scan_walk"))))); }
      return;
    }
    if (m < 0.4) { A.play("idle"); return; }
    const name = m < 2.6 ? "walk" : p.sprint && m > 5.6 ? "sprint" : "run";
    A.play(name);
    A.speed(Math.min(1.8, Math.max(0.5, m / Math.max(0.3, A.pace(name)))));
  }
  // The sack over the left shoulder: its neck sits just behind the shoulder joint, the left hand grips it there
  // (two-bone IK, elbow forward and down) and it leans with the chest. Worked in the driver group's own space
  // (faces -Z, left is -X), then the hand target goes back to world space.
  const _s = new THREE.Vector3(), _h = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3(), _pl = new THREE.Vector3(), _f = new THREE.Vector3();
  function holdSack(A, D, fill, dt, accel) {
    const sh = A.bone("LeftArm"), hips = A.bone("Hips"), neck = A.bone("Neck");
    if (!sh) return;
    D.worldToLocal(sh.getWorldPosition(_s));
    // the chest's lean (hips -> neck, seen from the side)
    let lean = 0;
    if (hips && neck) { D.worldToLocal(hips.getWorldPosition(_h)); D.worldToLocal(neck.getWorldPosition(_n)); lean = Math.atan2(-(_n.z - _h.z), _n.y - _h.y); }
    // the wrist just in front of the shoulder, the fingers hooked back over it; the sack's neck hangs in that fist
    _t.set(_s.x + 0.02, _s.y + 0.08, _s.z - 0.08);
    _pl.set(_s.x - 0.3, _s.y - 0.4, _s.z - 0.35);
    D.localToWorld(_t); D.localToWorld(_pl);
    _f.set(-0.1, -0.15, 1).applyQuaternion(D.quaternion);
    A.armIK("Left", _t, _pl, V.sackW, _f);
    const hand = A.bone("LeftHand");
    if (hand) { D.worldToLocal(hand.getWorldPosition(_h)); V.sack.position.set(_h.x - 0.01, _h.y + 0.0, _h.z + 0.08); }
    else V.sack.position.set(_s.x, _s.y + 0.12, _s.z + 0.03);
    V.sack.rotation.set(-lean * 0.8, 0, 0.08);
    WD.Gear.sackUpdate(V.sack, fill, dt, accel);
  }
  // walk or run at the clip's own pace
  function walker(A, speed) {
    const name = speed > 3 ? "run" : "walk";
    if (A.busy()) return;
    A.play(name); A.speed(Math.min(1.8, Math.max(0.5, speed / Math.max(0.3, A.pace(name)))));
  }

  // ------------------------------------------------------------------ chasers (a wrong door's dog, or the resident out of it, angry)
  function animDog(o, c, dt) {
    const U = o.g.userData, mv = Math.min(1, (c.moving || 0) / 3);
    U.phase = (U.phase || 0) + dt * 14;
    if (o.real) { o.g.position.y = c.y + Math.abs(Math.sin(U.phase)) * 0.05 * mv; o.g.rotation.set(Math.sin(U.phase * 2) * 0.04 * mv, c.yaw, Math.sin(U.phase) * 0.06 * mv); }
    else U.legs.forEach((l, i) => { l.rotation.x = Math.sin(U.phase + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI : 0)) * 0.5 * mv; });
  }
  function makeChaser(c) {
    if (c.kind === "dog") {
      const a = WD.Chars && WD.Chars.ready ? WD.Chars.make("dog", true) : null, g = a ? a.group : dogMesh();
      g.userData.phase = 0; V.scene.add(g);
      return { kind: "dog", g: g, real: !!a };
    }
    let i = c.unit % V.residents.length;
    for (let k = 0; k < V.residents.length && V.resBusy[i]; k++) i = (i + 1) % V.residents.length;
    const r = V.residents[i];
    if (V.resident === r[0]) { V.resident.visible = false; V.residentT = 0; }
    V.resBusy[i] = 1; r[0].visible = true;
    return { kind: "angry", g: r[0], A: r[1], res: i };
  }
  V.syncChasers = function (sim, dt) {
    const live = {};
    for (const c of sim.chasers) {
      live[c.id] = 1;
      const o = V.chasing[c.id] || (V.chasing[c.id] = makeChaser(c));
      o.g.visible = true; o.g.position.set(c.x, c.y, c.z); o.g.rotation.y = c.yaw;
      if (o.kind === "dog") animDog(o, c, dt);
      else if (o.A) {
        const m = c.moving || 0, name = m > 3 ? "run" : m > 0.5 ? "walk" : "nope";
        if (!o.A.busy()) { o.A.play(name); if (m > 0.5) o.A.speed(Math.min(1.8, Math.max(0.5, m / Math.max(0.3, o.A.pace(name))))); }
        o.A.update(dt);
      } else {
        const bob = animate(o.g, c.moving || 0, dt, false); o.g.position.y = c.y + bob;
        const P = o.g.userData.parts; P.shR.rotation.x = 2.6 + Math.sin(sim.time * 14) * 0.4;   // shaking a fist
      }
    }
    for (const id in V.chasing) if (!live[id]) {
      const o = V.chasing[id];
      if (o.kind === "dog") V.scene.remove(o.g); else { o.g.visible = false; V.resBusy[o.res] = 0; }
      delete V.chasing[id];
    }
  };

  // ------------------------------------------------------------------ per frame
  V.update = function (sim, dt) {
    V.fps += (1 / Math.max(dt, 1e-3) - V.fps) * 0.04;
    if (V.fps < 26) V.slow += dt; else V.slow = Math.max(0, V.slow - dt * 0.5);
    if (V.slow > 2.5) {
      V.slow = 0;
      if (V.quality.shadows) { V.setQuality(false, V.quality.pr); V.downgraded = "shadows off"; }
      else if (V.quality.pr > 0.8) { V.setQuality(false, Math.max(0.7, V.quality.pr * 0.75)); V.downgraded = "resolution down"; V.wantLowDetail = true; }
    }
    const p = sim.player;
    if (!V.real && WD.Chars && WD.Chars.ready) V.buildActors(sim);   // the Meshy people just finished loading
    V.world.update(dt, p);
    if (sim.phase === "countdown") V.scanT = Math.max(V.scanT, 0.5);   // the route is up on the handheld
    V.syncChasers(sim, dt);
    if (V.takeT && (V.takeT.t -= dt) <= 0) { V.world.takeParcel(V.takeT.unit); V.takeT = null; }
    // the driver: turns toward where they're walking (or where the camera looks when standing)
    const D = V.driver, A = V.driverA;
    const face = p.moving > 0.4 ? Math.atan2(-p.vx, -p.vz) : p.yaw;
    let dy = face - D.rotation.y; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    D.rotation.y += dy * Math.min(1, 12 * dt);
    const accel = (p.moving - V.lastV) / Math.max(dt, 1e-3); V.lastV = p.moving;
    const fill = sim.shift.carry ? p.carry.length / sim.shift.carry : 0;
    if (A) {
      driverClip(A, p, dt); A.update(dt);
      D.position.set(p.x, p.y, p.z);
      D.updateMatrixWorld(true);
      holdSack(A, D, fill, dt, accel);
      if (V.device) V.device.visible = V.scanning && !A.busy();
      // the parcel goes from hand to mat at the bottom of the bend
      if (V.placeT > 0) {
        V.placeT -= dt;
        if (V.placeT < 1.35 && V.placeUnit) { if (V.inHandParcel) V.inHandParcel.visible = false; V.world.leaveParcel(V.placeUnit); V.world.openDoor(V.placeUnit, 1.0); V.placeUnit = 0; }
        if (!A.busy() || p.moving > 1.5) { if (V.placeUnit) { V.world.leaveParcel(V.placeUnit); V.placeUnit = 0; } if (V.inHandParcel) V.inHandParcel.visible = false; V.placeT = 0; }
      }
    } else {
      const bob = animate(D, p.stagger > 0 ? 0 : p.moving, dt, false);
      D.position.set(p.x, p.y + bob, p.z);
      D.rotation.z = p.stagger > 0 ? Math.sin(sim.time * 18) * 0.12 : 0;
      WD.Gear.sackUpdate(V.sack, fill, dt, accel);
    }
    if (V.dog) {
      const g = sim.dog, U = V.dog.userData;
      U.phase += dt * 14;
      if (V.dogReal) {
        // Meshy's dog has no rig: a trot bounce and a waddle while it moves
        const mv = Math.min(1, (g.moving || 0) / 3);
        V.dog.position.set(g.x, g.y + Math.abs(Math.sin(U.phase)) * 0.05 * mv, g.z);
        V.dog.rotation.set(Math.sin(U.phase * 2) * 0.04 * mv, g.yaw, Math.sin(U.phase) * 0.06 * mv);
      } else {
        V.dog.position.set(g.x, g.y, g.z); V.dog.rotation.y = g.yaw;
        U.legs.forEach((l, i) => { l.rotation.x = Math.sin(U.phase + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI : 0)) * 0.5; });
      }
    }
    if (V.pirate) {
      const r = sim.pirate;
      V.pirate.position.set(r.x, r.y, r.z); V.pirate.rotation.y = r.yaw;
      if (V.pirateA) { walker(V.pirateA, r.flee > 0 ? 5.5 : 2.2); V.pirateA.update(dt); }
      else animate(V.pirate, r.flee > 0 ? 5.5 : 2.2, dt, false);
    }
    if (V.residentT > 0) {
      V.residentT -= dt;
      if (V.residentA) V.residentA.update(dt);
      else {
        const P = V.resident.userData.parts;
        P.shR.rotation.x = 2.5 + Math.sin(sim.time * 12) * 0.35;   // waving you off
        P.shL.rotation.x = 0;
      }
      if (V.residentT <= 0) V.resident.visible = false;
    }
    V.updateCamera(sim, dt);
  };

  V.updateCamera = function (sim, dt) {
    const cam = V.camera, p = sim.player;
    V.shake = Math.max(0, (V.shake || 0) - dt * 2);
    if (V.freeCam) { cam.position.fromArray(V.freeCam.pos); cam.lookAt(V.freeCam.look[0], V.freeCam.look[1], V.freeCam.look[2]); V.driver.visible = true; return; }
    const c = sim.cameraOf(p, V.camTmp);
    if (!V.camSm) V.camSm = { x: c.x, y: c.y, z: c.z };
    const k = Math.min(1, 20 * dt), ky = Math.min(1, 9 * dt);   // height eases slower: stairs don't jolt the view
    V.camSm.x += (c.x - V.camSm.x) * k; V.camSm.y += (c.y - V.camSm.y) * ky; V.camSm.z += (c.z - V.camSm.z) * k;
    const sh = V.shake * 0.05;
    cam.position.set(V.camSm.x, V.camSm.y, V.camSm.z);
    cam.rotation.set(p.pitch + (Math.random() - 0.5) * sh, p.yaw + (Math.random() - 0.5) * sh, 0);
    const fov = 68 + (p.sprint && p.moving > 5.5 ? 5 : 0);
    V.fov += (fov - V.fov) * Math.min(1, 6 * dt);
    if (Math.abs(cam.fov - V.fov) > 0.05) { cam.fov = V.fov; cam.updateProjectionMatrix(); }
    // a wall right behind you pulls the camera into your head: hide yourself then
    V.driver.visible = Math.hypot(V.camSm.x - p.x, V.camSm.z - p.z) > 0.7;
  };

  V.render = function () { V.renderer.render(V.scene, V.camera); };
  WD.View = V;
})(globalThis.WD);
