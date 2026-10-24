// Rendering: the renderer, the over-the-shoulder camera (a wider view from behind your baseline while you're
// out), the players' bodies/avatars, the balls (in hand, flying with a trail, a soft shadow under each), and
// keeping the frame rate up on weak laptops (only when the player's graphics are on Auto).
globalThis.SB = globalThis.SB || {};
(function (SB) {
  "use strict";
  const THREE = globalThis.THREE;
  const V = {};
  const BASE_FOV = 66;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  V.init = function (canvas, antialias) {
    V.canvas = canvas;
    V.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: antialias === undefined ? (devicePixelRatio || 1) < 1.5 : !!antialias, powerPreference: "high-performance" });
    V.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    V.renderer.toneMappingExposure = 1.0;
    V.renderer.shadowMap.enabled = true;
    V.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    V.scene = new THREE.Scene();
    V.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.05, 120);
    V.camera.rotation.order = "YXZ";
    V.scene.add(V.camera);
    V.quality = { shadows: true, pr: Math.min(devicePixelRatio || 1, 1.5) };
    V.slow = 0; V.fps = 60; V.fov = BASE_FOV;
    V.chars = []; V.balls = [];
    V.camTmp = {}; V.outCam = 0;
    SB.Fx.init(V.scene);
    V.world = SB.World.build(V);
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
  // A graphics preset (main.js GFX: auto/low/medium/high) as numbers.
  V.applyGraphics = function (g) {
    if (!g) return;
    const sun = V.world.sun, shadows = g.shadows !== "off";
    V.preset = g;
    V.auto = !!g.auto;
    V.quality.pr = Math.max(0.5, Math.min(devicePixelRatio || 1, g.pixelRatio || 1));
    V.quality.shadows = shadows;
    V.renderer.shadowMap.enabled = shadows;
    sun.castShadow = shadows;
    if (shadows) {
      const size = g.shadows === "soft" ? 2048 : 1024;
      if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
      V.renderer.shadowMap.type = g.shadows === "soft" ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    }
    V.trails = g.level !== "potato" && g.effects !== false;
    V.slow = 0; V.downgraded = "";
    V.scene.traverse(function (o) { if (o.material) [].concat(o.material).forEach((x) => { x.needsUpdate = true; }); });
    V.resize();
  };
  V.setQuality = function (shadows, pr) {
    V.quality.shadows = shadows; V.quality.pr = pr;
    V.renderer.shadowMap.enabled = shadows;
    V.world.sun.castShadow = shadows;
    V.scene.traverse(function (o) { if (o.material) [].concat(o.material).forEach((x) => { x.needsUpdate = true; }); });
    V.resize();
  };

  // ------------------------------------------------------------------ a match
  V.startMatch = function (sim) {
    V.sim = sim;
    V.chars.forEach((c) => { if (c) V.scene.remove(c.root); });
    V.chars = [];
    sim.players.forEach(function (p) {
      const c = SB.Body.make(p, p.body, SB.World.TEAM_COL[p.team]);
      if (c) V.scene.add(c.root);
      V.chars[p.id] = c;
    });
    V.balls.forEach((b) => { V.scene.remove(b.mesh); V.scene.remove(b.blob); if (b.trail) V.scene.remove(b.trail); });
    const geo = new THREE.SphereGeometry(SB.CFG.BALL_R, 28, 18), mat = SB.World.ballMaterial();
    const blobGeo = new THREE.CircleGeometry(0.16, 20); blobGeo.rotateX(-Math.PI / 2);
    const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
    V.balls = sim.balls.map(function () {
      const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true;
      const blob = new THREE.Mesh(blobGeo, blobMat); blob.renderOrder = 1;
      const tg = new THREE.BufferGeometry(); tg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * 10), 3));
      const trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
      trail.frustumCulled = false; trail.visible = false;
      V.scene.add(mesh); V.scene.add(blob); V.scene.add(trail);
      return { mesh: mesh, blob: blob, trail: trail, pts: [], spin: new THREE.Vector3() };
    });
    V.settle = 3; V.slow = 0; V.fps = 60;
  };

  // ------------------------------------------------------------------ per frame
  const _h = new THREE.Vector3();
  function syncBalls(sim, dt) {
    sim.balls.forEach(function (B, i) {
      const v = V.balls[i];
      if (!v) return;
      const m = v.mesh;
      if (B.st === "held" && B.holder >= 0 && V.chars[B.holder]) {
        SB.Body.handPos(V.chars[B.holder], _h);
        m.position.copy(_h);
      } else {
        m.position.set(B.x, B.y, B.z);
        // roll / spin with the motion
        const sp = Math.hypot(B.vx, B.vz);
        if (sp > 0.05) { m.rotation.x += B.vz / SB.CFG.BALL_R * dt; m.rotation.z -= B.vx / SB.CFG.BALL_R * dt; }
      }
      m.visible = !(B.st === "held" && sim.players[B.holder] && sim.players[B.holder].left);
      v.blob.position.set(m.position.x, 0.008, m.position.z);
      const s = clamp(1.15 - m.position.y * 0.25, 0.25, 1);
      v.blob.scale.setScalar(s); v.blob.material.opacity = 0.35;
      // a short streak behind a live ball (team colour)
      if (V.trails !== false && B.live) {
        v.pts.push(m.position.x, m.position.y, m.position.z);
        if (v.pts.length > 30) v.pts.splice(0, 3);
        const P = v.trail.geometry.attributes.position, n = v.pts.length / 3;
        for (let k = 0; k < 10; k++) { const j = Math.max(0, n - 10 + k) * 3; P.setXYZ(k, v.pts[j], v.pts[j + 1], v.pts[j + 2]); }
        P.needsUpdate = true;
        v.trail.material.color.setHex(SB.World.TEAM_COL[B.team] || 0xffffff);
        v.trail.visible = n > 1;
      } else if (v.trail.visible || v.pts.length) { v.trail.visible = false; v.pts.length = 0; }
    });
  }

  V.update = function (sim, dt) {
    V.fps += (1 / Math.max(dt, 1e-3) - V.fps) * 0.04;
    V.settle = Math.max(0, (V.settle || 0) - dt);
    if (V.auto && V.fps < 26 && V.settle <= 0) V.slow += dt; else V.slow = Math.max(0, V.slow - dt * 0.5);
    if (V.slow > 2.5) {
      V.slow = 0;
      if (V.quality.shadows) { V.setQuality(false, V.quality.pr); V.downgraded = "shadows off"; }
      else if (V.quality.pr > 0.8) { V.setQuality(false, Math.max(0.7, V.quality.pr * 0.75)); V.downgraded = "resolution down"; }
    }
    SB.World.update(V, sim);
    SB.Fx.update(dt);
    if (!sim) return;
    sim.players.forEach(function (p) {
      const c = V.chars[p.id];
      if (!c) return;
      SB.Body.pose(c, p, dt);
      // someone standing right in front of the lens would fill the screen: hide them
      const cp = V.camera.position, near = p.kind !== "local" && Math.hypot(cp.x - p.x, cp.y - (p.y + 1), cp.z - p.z) < 1.15;
      c.root.visible = !p.left && !near;
      c.tag.visible = p.kind !== "local";
      c.tag.material.opacity = p.out ? 0.4 : 1;
      c.ring.visible = !p.out;
      // invulnerable (flip / dodge / just back in): the ring flickers
      c.ring.material.opacity = p.inv > 0 ? (Math.sin(performance.now() / 40) > 0 ? 0.95 : 0.25) : 0.85;
    });
    syncBalls(sim, dt);
    V.updateCamera(sim, sim.human(), dt);
  };

  V.updateCamera = function (sim, h, dt) {
    const cam = V.camera;
    if (V.freeCam) {
      cam.position.fromArray(V.freeCam.pos); cam.lookAt(V.freeCam.look[0], V.freeCam.look[1], V.freeCam.look[2]); setFov(V.freeCam.fov || BASE_FOV);
      return;
    }
    if (!h) { cam.position.set(0, 7, 17); cam.lookAt(0, 0.5, 0); setFov(BASE_FOV); return; }
    // out (or knocked down): drift to a wide view from behind your own baseline, still free to look round
    const wantOut = h.out && h.st === SB.ST.out ? 1 : 0;
    V.outCam += (wantOut - V.outCam) * Math.min(1, dt * 2.5);
    const c = sim.cameraOf(h, V.camTmp);
    const s = h.team === 0 ? 1 : -1;
    const ox = h.x * 0.3, oy = 6.2, oz = s * (SB.CFG.WALL_Z - 1.2);
    const u = V.outCam;
    cam.position.set(c.x + (ox - c.x) * u, c.y + (oy - c.y) * u, c.z + (oz - c.z) * u);
    const pitch = h.pitch + (-0.32 - h.pitch) * u;
    const yaw = u > 0.01 ? h.yaw + angDiff(s > 0 ? 0 : Math.PI, h.yaw) * u : h.yaw;
    cam.rotation.set(pitch, yaw, 0);
    setFov(BASE_FOV + (h.st === SB.ST.charge ? -6 * h.charge : 0));
  };
  function angDiff(a, b) { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }
  function setFov(f) {
    V.fov += (f - V.fov) * 0.2;
    if (Math.abs(V.camera.fov - V.fov) > 0.02) { V.camera.fov = V.fov; V.camera.updateProjectionMatrix(); }
  }

  V.event = function (sim, e) {
    if (e.t === "hit" || e.t === "out") {
      const p = sim.players[e.id];
      if (p && e.t === "hit") SB.Fx.burst(p.x, p.y + 1.2, p.z, 10, [0xffffff, 0xd4262b, SB.World.TEAM_COL[p.team]], 0.02, 2.4);
    }
    if (e.t === "caught" || e.t === "block") { const p = sim.players[e.id]; if (p) SB.Fx.ring(p.x, p.y + 1.2, p.z, e.t === "caught" ? 0x6dff8a : 0xffffff); }
    if (e.t === "bounce" && e.v > 4) { const B = sim.balls[e.b]; if (B && B.y < 0.2) SB.Fx.dust(B.x, B.z); }
  };
  V.render = function () { V.renderer.render(V.scene, V.camera); };
  SB.View = V;
})(globalThis.SB);
