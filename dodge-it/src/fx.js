// Little bursts: bits off a hit, a ring for a catch or a block, a puff of floor dust when a ball slams down.
globalThis.SB = globalThis.SB || {};
(function (SB) {
  "use strict";
  const THREE = globalThis.THREE;
  const F = { bits: [], rings: [] };
  const MAX = 160;
  let geo = null, ringGeo = null;
  const mats = {};
  const mat = (col) => mats[col] || (mats[col] = new THREE.MeshStandardMaterial({ color: col, roughness: 0.7 }));

  F.init = function (scene) {
    F.scene = scene;
    geo = new THREE.IcosahedronGeometry(1, 0);
    ringGeo = new THREE.TorusGeometry(0.35, 0.025, 6, 32);
  };
  F.burst = function (x, y, z, n, cols, size, speed) {
    if (SB.View && SB.View.preset && SB.View.preset.particles === 0) return;
    for (let i = 0; i < n; i++) {
      if (F.bits.length >= MAX) { const old = F.bits.shift(); F.scene.remove(old.m); }
      const m = new THREE.Mesh(geo, mat(cols[i % cols.length]));
      const s = size * (0.5 + Math.random());
      m.scale.setScalar(s);
      m.position.set(x, y, z);
      F.scene.add(m);
      const a = Math.random() * Math.PI * 2;
      F.bits.push({ m: m, vx: Math.cos(a) * speed * (0.3 + Math.random()), vy: speed * (0.3 + Math.random()), vz: Math.sin(a) * speed * (0.3 + Math.random()), life: 0.9 + Math.random() * 0.5, s: s });
    }
  };
  F.dust = function (x, z) { F.burst(x, 0.03, z, 5, [0xcbb48a, 0xe0d0b0], 0.012, 0.8); };
  F.ring = function (x, y, z, col) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthWrite: false }));
    m.position.set(x, y, z);
    m.rotation.x = Math.PI / 2;
    F.scene.add(m);
    F.rings.push({ m: m, life: 0.5 });
  };
  F.update = function (dt) {
    for (let i = F.bits.length - 1; i >= 0; i--) {
      const b = F.bits[i];
      b.life -= dt; b.vy -= 9.8 * dt;
      b.m.position.x += b.vx * dt; b.m.position.y += b.vy * dt; b.m.position.z += b.vz * dt;
      if (b.m.position.y < 0.01) { b.m.position.y = 0.01; b.vx *= 0.6; b.vz *= 0.6; b.vy = Math.abs(b.vy) * 0.25; }
      if (b.life < 0.3) b.m.scale.setScalar(Math.max(0.0001, b.s * b.life / 0.3));
      if (b.life <= 0) { F.scene.remove(b.m); F.bits.splice(i, 1); }
    }
    for (let i = F.rings.length - 1; i >= 0; i--) {
      const r = F.rings[i];
      r.life -= dt;
      const u = 1 - r.life / 0.5;
      r.m.scale.setScalar(1 + u * 2.2); r.m.material.opacity = 0.9 * (1 - u);
      if (r.life <= 0) { F.scene.remove(r.m); r.m.material.dispose(); F.rings.splice(i, 1); }
    }
  };
  F.clear = function () { F.bits.forEach((b) => F.scene.remove(b.m)); F.bits = []; F.rings.forEach((r) => F.scene.remove(r.m)); F.rings = []; };
  SB.Fx = F;
})(globalThis.SB);
