// Rendering: the renderer, the over-the-shoulder camera, the fighters' bodies, the
// spectator camera, and keeping the quality up on weak laptops.
globalThis.SB = globalThis.SB || {};
(function (SB) {
  "use strict";
  const THREE = globalThis.THREE;
  const V = {};
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  V.init = function (canvas) {
    V.canvas = canvas;
    V.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, powerPreference: "high-performance" });
    V.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    V.renderer.toneMappingExposure = 0.92;
    V.renderer.shadowMap.enabled = true;
    V.renderer.shadowMap.type = THREE.PCFShadowMap;
    V.scene = new THREE.Scene();
    V.scene.background = new THREE.Color(0xdbe8f5);
    V.camera = new THREE.PerspectiveCamera(70, 1, 0.08, 900);
    V.camera.rotation.order = "YXZ";
    V.scene.add(V.camera);
    V.quality = { shadows: true, pr: Math.min(devicePixelRatio || 1, 1.5) };
    V.slow = 0; V.fps = 60;
    V.chars = [];
    V.shake = 0; V.fov = 70; V.camSm = null; V.camTmp = {};
    V.spectateT = 0; V.menuT = 0;
    SB.Fx.init(V.scene);
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
    V.scene.traverse(function (o) { if (o.material) { const m = [].concat(o.material); m.forEach((x) => { x.needsUpdate = true; }); } });
    V.resize();
  };

  // ------------------------------------------------------------------ the match
  V.startMatch = function (sim) {
    V.sim = sim;
    if (V.world) { V.scene.remove(V.world.group); }
    V.chars.forEach((c) => { if (c) V.scene.remove(c.root); });
    V.chars = [];
    V.world = SB.World.build(sim, V);
    V.world.sun.castShadow = V.quality.shadows;
    sim.players.forEach(function (p) {
      const c = SB.Body.make(sim, p, p.body || "Aj", SB.World.TEAM_COL[p.team]);
      if (c) { c.mesh.castShadow = true; c.root.visible = sim.humanId >= 0; V.scene.add(c.root); }
      V.chars[p.id] = c;
    });
    SB.Fx.clearPrints();
    V.spectateT = 0; V.camSm = null;
  };
  V.newRound = function () { if (V.world) V.world.rebuildMounds(); SB.Fx.clearPrints(); V.spectateT = 0; V.camSm = null; };

  V.event = function (sim, e) {
    if (e.t === "out") { const c = V.chars[e.id]; if (c) c.dead = null; if (e.id === sim.humanId) { V.shake = 0.5; V.spectateT = 0; } }
    if (e.t === "moundhit" && V.world) { const m = V.world.moundMeshes[e.i]; if (m) m.userData.cur.r *= 1.04; }
    if (e.t === "built" && V.world) V.world.addMound(e.i);
  };

  // ------------------------------------------------------------------ per frame
  const _v = new THREE.Vector3();
  V.update = function (sim, dt, now) {
    const human = sim.human();
    // frame-rate watch: fall back to cheaper rendering if the machine can't keep up
    V.fps += (1 / Math.max(dt, 1e-3) - V.fps) * 0.04;
    if (V.fps < 26 && !V.menuMode) V.slow += dt; else V.slow = Math.max(0, V.slow - dt * 0.5);
    if (V.slow > 2.5) {
      V.slow = 0;
      if (V.quality.shadows) { V.setQuality(false, V.quality.pr); V.downgraded = "shadows off"; }
      else if (V.quality.pr > 0.8) { V.setQuality(false, Math.max(0.7, V.quality.pr * 0.75)); V.downgraded = "resolution down"; }
    }
    V.world.update(dt, V.camera.position);

    // bodies
    sim.players.forEach(function (p) {
      const c = V.chars[p.id];
      if (!c) return;
      SB.Body.pose(c, p, dt);
      const self = p.human;
      c.root.visible = true;
      const ally = human && p.team === human.team && !self && p.alive;
      c.tag.visible = !!ally;
      c.marker.visible = !!ally;
      if (ally) { const d = Math.hypot(p.x - V.camera.position.x, p.z - V.camera.position.z); c.tag.scale.set(1.1 + d * 0.012, 0.275 + d * 0.003, 1); c.marker.scale.setScalar(0.3 + d * 0.012); c.tag.position.y = 2.25; c.marker.position.y = 2.0; }
    });
    SB.Fx.update(sim, dt);
    V.updateCamera(sim, human, dt, now);
  };

  V.updateCamera = function (sim, h, dt, now) {
    const cam = V.camera;
    V.shake = Math.max(0, V.shake - dt * 2.2);
    if (V.freeCam) { cam.position.fromArray(V.freeCam.pos); cam.lookAt(V.freeCam.look[0], V.freeCam.look[1], V.freeCam.look[2]); return; }   // test shots
    if (!h) return;
    if (h.alive) {
      // Over the shoulder: the sim says where (it is also the camera throws are aimed through).
      const c = sim.cameraOf(h, V.camTmp);
      if (!V.camSm) V.camSm = { x: c.x, y: c.y, z: c.z };
      const k = Math.min(1, 22 * dt);   // a quick ease, so a pulled-in camera doesn't snap
      V.camSm.x += (c.x - V.camSm.x) * k; V.camSm.y += (c.y - V.camSm.y) * k; V.camSm.z += (c.z - V.camSm.z) * k;
      let roll = 0, pitch = h.pitch;
      if (h.roll > 0) {
        const u = 1 - h.roll / sim.cfg.ROLL_T, kk = Math.sin(u * Math.PI);
        const side = h.rollDx * Math.cos(h.yaw) - h.rollDz * Math.sin(h.yaw);
        roll = -side * 0.12 * kk; pitch -= 0.06 * kk;
      }
      const sh = V.shake * 0.05;
      cam.position.set(V.camSm.x, V.camSm.y, V.camSm.z);
      cam.rotation.set(pitch + (Math.random() - 0.5) * sh, h.yaw + (Math.random() - 0.5) * sh, roll);
      const sp = Math.hypot(h.vx, h.vz);
      const fov = 70 + (h.sprint && sp > 5.5 ? 4 : 0) - h.charge * 4;
      V.fov += (fov - V.fov) * Math.min(1, 8 * dt);
      if (Math.abs(cam.fov - V.fov) > 0.05) { cam.fov = V.fov; cam.updateProjectionMatrix(); }
      // A wall right behind you pulls the camera inside your own body: hide it then.
      const own = V.chars[h.id];
      if (own) own.root.visible = Math.hypot(V.camSm.x - h.x, V.camSm.z - h.z) > 0.85;
    } else {
      // Out: look back at yourself for a moment, then ride along with someone still in.
      V.spectateT += dt;
      if (cam.fov !== 70) { cam.fov = 70; cam.updateProjectionMatrix(); V.fov = 70; }
      let target = null;
      if (V.spectateT > 1.7) {
        target = sim.players[sim.spectateId];
        if (!target || !target.alive) {
          target = sim.players.find((p) => p.alive && p.team === h.team) || sim.players.find((p) => p.alive);
          if (target) sim.spectateId = target.id;
        }
      }
      if (target) {
        const back = 4.4, fx = Math.sin(target.yaw), fz = Math.cos(target.yaw);
        _v.set(target.x + fx * back, 2.5, target.z + fz * back);
        cam.position.lerp(_v, Math.min(1, 5 * dt));
        cam.lookAt(target.x - fx * 6, 1.3, target.z - fz * 6);
      } else {
        const fx = -Math.sin(h.yaw), fz = -Math.cos(h.yaw);
        _v.set(h.x + fx * 3.6, 1.9 + Math.min(1.2, V.spectateT * 0.5), h.z + fz * 3.6);
        cam.position.lerp(_v, Math.min(1, 6 * dt));
        cam.lookAt(h.x, 0.8, h.z);
      }
      V.camSm = null;
    }
  };

  V.render = function () { V.renderer.render(V.scene, V.camera); };
  SB.View = V;
})(globalThis.SB);
