// One event's world: the course height field (ground grid + ribbon), its dressing (src/dress-*.js),
// the ramps riders launch off, obstacles, water, and the walls that keep the race on the line.
// Everything lives under one group so switching events can dispose it all.
(function (RR) {
  "use strict";
  const T = window.THREE;
  RR.DRESS = RR.DRESS || {};

  // water: a dark reflective sheet with a scrolling ripple normal map
  RR.waterMaterial = function (color, opacity) {
    if (!RR.waveTex) { RR.waveTex = RR.grainNormal(256, 77, 0.09); }
    const m = new T.MeshStandardMaterial({
      color: color || 0x2a3a30, roughness: 0.06, metalness: 0.15, envMapIntensity: 1.25,
      normalMap: RR.waveTex, normalScale: new T.Vector2(0.35, 0.35), transparent: true, opacity: opacity || 0.9
    });
    return m;
  };

  RR.World = function (scene, q, key, seed) {
    const def = this.def = RR.COURSES[key];
    this.key = key; this.scene = scene; this.q = q;
    const root = this.root = new T.Group();
    scene.add(root);
    const C = this.course = new RR.Course(def);
    const tr = this.track = C.track;
    this.S = C.S;
    this.obstacles = [];   // {x, z, r}
    this.ramps = [];
    this.anim = [];        // per-frame callbacks (t, dt)
    this.ground = function (x, z, hint) { return C.heightAt(x, z, hint); };
    C.buildTerrain(root, q);
    C.buildRibbon(root, q);
    this.P = new RR.Props(this);
    this.rnd = RR.rng(seed || 3);
    RR.DRESS[key](this, q, this.rnd);
    if (RR.DETAIL && RR.DETAIL[key]) RR.DETAIL[key](this, q, RR.rng((seed || 3) * 7 + 11));
    // bots plan around these
    const self = this;
    this.ramps.forEach(function (m) { const u = m.userData; u.ti = Math.round((u.s - u.len) / tr.ds); });
    this.obstacles.forEach(function (o) { o.ti = tr.nearestAny(o.x, o.z); o.lat = tr.lateral(o.x, o.z, o.ti); });
    this.rampY = function (x, z, fx_, fz_, gy) {
      let y = -1e9, on = false;
      for (let i = 0; i < self.ramps.length; i++) {
        const u = self.ramps[i].userData, dx = x - u.x0, dz = z - u.z0;
        const lz = dx * u.fx + dz * u.fz, lx = dx * u.rx + dz * u.rz;
        if (Math.abs(lx) < u.w / 2 + 0.15 && lz > 0 && lz < u.len) {
          if (u.fx * fx_ + u.fz * fz_ < 0.3) continue;   // only when riding up it
          y = Math.max(y, gy + u.h * Math.pow(lz / u.len, 1.5) + 0.04);
          on = true;
        }
      }
      return on ? y : null;
    };
  };
  const WP = RR.World.prototype;
  WP.wall = function (s) { return this.def.wall(s, this.course); };
  WP.ceil = function (s) { return this.def.ceil(s, this.course); };
  WP.surface = function (s, lat) { return this.def.surface(s, lat, this.course); };

  // a sheet of water between two laterals over a stretch of the line, at height y
  WP.waterAlong = function (s0, s1, latA, latB, y, mat) {
    const tr = this.track, pos = [], uv = [], idx = [];
    let n = 0;
    for (let s = s0; s <= s1 + 1e-3; s += 4, n++) {
      const a = tr.at(s, latA), b = tr.at(s, latB);
      pos.push(a.x, y, a.z, b.x, y, b.z); uv.push(a.x / 9, a.z / 9, b.x / 9, b.z / 9);
      if (n) { const k = (n - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    // make sure it faces up
    if (g.attributes.normal.getY(0) < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
    const m = new T.Mesh(g, mat);
    m.receiveShadow = true;
    m.renderOrder = 1;
    this.root.add(m);
    return m;
  };

  WP.update = function (t, dt) {
    for (let i = 0; i < this.anim.length; i++) this.anim[i](t, dt);
    if (RR.waveTex) RR.waveTex.offset.set(t * 0.012, t * 0.02);
  };

  WP.dispose = function () {
    this.scene.remove(this.root);
    const seen = new Set();
    this.root.traverse(function (o) {
      if (o.geometry && !o.geometry.userData.shared && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      ms.forEach(function (m) {
        if (seen.has(m) || m.userData.shared) return;
        seen.add(m);
        ["map", "emissiveMap", "alphaMap"].forEach(function (k) { if (m[k] && !seen.has(m[k]) && m[k] !== RR.waveTex) { seen.add(m[k]); m[k].dispose(); } });
        m.dispose();
      });
    });
  };
})(window.RR = window.RR || {});
