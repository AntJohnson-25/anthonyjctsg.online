// Snowballs in flight, snow puffs, footprints.
globalThis.SB = globalThis.SB || {};
(function (SB) {
  "use strict";
  const THREE = globalThis.THREE;
  const Fx = {};
  const MAX_BALLS = 64, MAX_PUFF = 140, MAX_PRINT = 90;

  Fx.init = function (scene) {
    const dot = SB.World.dotTexture();
    // --- snowballs (one instanced mesh)
    Fx.balls = new THREE.InstancedMesh(new THREE.SphereGeometry(SB.CFG.BALL_R * 1.15, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), MAX_BALLS);
    Fx.balls.frustumCulled = false;
    Fx.balls.castShadow = true;
    Fx.balls.count = 0;
    scene.add(Fx.balls);
    // --- puffs (a sprite pool)
    Fx.puffs = [];
    for (let i = 0; i < MAX_PUFF; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0xffffff, transparent: true, depthWrite: false, opacity: 0.9 }));
      s.visible = false;
      scene.add(s);
      Fx.puffs.push({ s: s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 0.3 });
    }
    Fx.puffI = 0;
    // --- footprints
    const pg = new THREE.PlaneGeometry(0.15, 0.34);
    pg.rotateX(-Math.PI / 2);
    const pm = new THREE.MeshBasicMaterial({ color: 0x8aa3bf, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    Fx.prints = [];
    for (let i = 0; i < MAX_PRINT; i++) { const m = new THREE.Mesh(pg, pm); m.visible = false; scene.add(m); Fx.prints.push(m); }
    Fx.printI = 0;
    Fx.last = {};   // per player: last print position
    Fx.m4 = new THREE.Matrix4(); Fx.q = new THREE.Quaternion(); Fx.sc = new THREE.Vector3(1, 1, 1); Fx.pv = new THREE.Vector3();
  };

  Fx.puff = function (x, y, z, n, size, spread, up) {
    for (let k = 0; k < n; k++) {
      const p = Fx.puffs[Fx.puffI++ % Fx.puffs.length];
      p.s.position.set(x + (Math.random() - 0.5) * 0.1, y, z + (Math.random() - 0.5) * 0.1);
      p.vx = (Math.random() - 0.5) * spread; p.vz = (Math.random() - 0.5) * spread; p.vy = Math.random() * (up || 2) + 0.4;
      p.size = size * (0.6 + Math.random() * 0.8); p.max = p.life = 0.45 + Math.random() * 0.4;
      p.s.visible = true;
      p.s.scale.setScalar(p.size);
      p.s.material.opacity = 0.9;
    }
  };

  // A sim event -> effects.
  Fx.event = function (e) {
    if (e.t === "splat") {
      if (e.on === "player") Fx.puff(e.x, e.y, e.z, 14, 0.5, 3.4, 3);
      else if (e.on === "mound") Fx.puff(e.x, e.y, e.z, 10, 0.42, 2.6, 2.4);
      else if (e.on === "ground") Fx.puff(e.x, 0.08, e.z, 5, 0.3, 1.6, 1.4);
      else Fx.puff(e.x, e.y, e.z, 7, 0.34, 2, 1.8);
    } else if (e.t === "built") Fx.puff(e.x, 0.3, e.z, 12, 0.6, 3, 2);
  };

  Fx.update = function (sim, dt) {
    // balls
    let n = 0;
    for (const b of sim.balls) {
      if (n >= MAX_BALLS) break;
      Fx.pv.set(b.x, b.y, b.z);
      Fx.balls.setMatrixAt(n++, Fx.m4.compose(Fx.pv, Fx.q.identity(), Fx.sc));
    }
    Fx.balls.count = n;
    Fx.balls.instanceMatrix.needsUpdate = true;
    // puffs
    for (const p of Fx.puffs) {
      if (!p.s.visible) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      const k = p.life / p.max;
      p.vy -= 5 * dt;
      p.s.position.x += p.vx * dt; p.s.position.y = Math.max(0.05, p.s.position.y + p.vy * dt); p.s.position.z += p.vz * dt;
      p.vx *= 1 - 1.5 * dt; p.vz *= 1 - 1.5 * dt;
      p.s.scale.setScalar(p.size * (1.2 - 0.5 * k));
      p.s.material.opacity = 0.9 * k;
    }
    // footprints: a print each 0.85 m a moving fighter walks
    for (const p of sim.players) {
      if (!p.alive || p.roll > 0) { Fx.last[p.id] = null; continue; }
      const L = Fx.last[p.id];
      if (!L) { Fx.last[p.id] = { x: p.x, z: p.z, foot: 0 }; continue; }
      const dx = p.x - L.x, dz = p.z - L.z, d = Math.hypot(dx, dz);
      if (d > 0.85 && Math.hypot(p.vx, p.vz) > 0.5) {
        const m = Fx.prints[Fx.printI++ % Fx.prints.length];
        const ang = Math.atan2(-dx, -dz), side = L.foot ? 0.11 : -0.11;
        m.position.set(p.x + Math.cos(ang) * side, 0.045, p.z - Math.sin(ang) * side);
        m.rotation.y = ang;
        m.visible = true;
        L.x = p.x; L.z = p.z; L.foot ^= 1;
      }
    }
  };
  Fx.clearPrints = function () { Fx.prints.forEach((m) => { m.visible = false; }); Fx.last = {}; };
  SB.Fx = Fx;
})(globalThis.SB);
