// Shared building blocks for the three courses: canvas textures, geometry merging and painting,
// banner gates, wooden kickers (the ramps riders launch off), decal strips laid along the line,
// fences and tape, Houston trees (live oaks with moss, loblolly pines, palmettos, street oaks),
// cones, barriers, tyre stacks, hay bales and the crowd.
(function (RR) {
  "use strict";
  const T = window.THREE;

  // ---------- textures ----------
  RR.canvasTex = function (w, h, draw, srgb) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new T.CanvasTexture(c);
    if (srgb !== false) t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 8;
    t.wrapS = t.wrapT = T.RepeatWrapping;
    return t;
  };
  // n random dots in one of `cols`, radius r0..r1 px
  RR.speckle = function (g, w, h, n, cols, r0, r1, rnd) {
    rnd = rnd || Math.random;
    for (let i = 0; i < n; i++) {
      g.fillStyle = cols[Math.floor(rnd() * cols.length)];
      const r = r0 + rnd() * (r1 - r0);
      g.fillRect(rnd() * w, rnd() * h, r, r);
    }
  };
  // soft blotches (stains, damp patches, wear)
  RR.blotch = function (g, w, h, n, col, r0, r1, rnd) {
    rnd = rnd || Math.random;
    for (let i = 0; i < n; i++) {
      const x = rnd() * w, y = rnd() * h, r = r0 + rnd() * (r1 - r0);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, col); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
  };
  RR.bannerTexture = function (text, a, b, ink, fill) {
    return RR.canvasTex(2048, 256, function (g, w, h) {
      const sq = 32;
      for (let y = 0; y < h; y += sq) for (let x = 0; x < w; x += sq) { g.fillStyle = ((x + y) / sq) % 2 ? "#111" : "#f4f4f4"; g.fillRect(x, y, sq, sq); }
      const gr = g.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, a); gr.addColorStop(0.5, b); gr.addColorStop(1, a);
      g.fillStyle = gr; g.fillRect(w * 0.08, 22, w * 0.84, h - 44);
      g.font = "900 150px 'Lilita One', Impact, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.lineWidth = 14; g.strokeStyle = ink || "#14101e"; g.strokeText(text, w / 2, h / 2 + 8);
      g.fillStyle = fill || "#ffe14d"; g.fillText(text, w / 2, h / 2 + 8);
    });
  };
  RR.plywoodTexture = function () {
    return RR.canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = "#c79a5e"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) {
        g.strokeStyle = "rgba(120,80,40," + (0.08 + Math.random() * 0.15) + ")"; g.lineWidth = 1 + Math.random() * 2;
        const y = Math.random() * h; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 6, w * 0.6, y - 6, w, y + 3); g.stroke();
      }
      RR.blotch(g, w, h, 8, "rgba(70,45,20,0.18)", 10, 40);
      g.fillStyle = "rgba(60,40,20,0.6)"; g.fillRect(0, 0, w, 3); g.fillRect(0, h / 2, w, 2);
    });
  };

  // ---------- geometry helpers ----------
  function merge(geos) {
    const out = { p: [], n: [], uv: [], c: [], i: [] };
    let base = 0;
    geos.forEach(function (g) {
      if (!g.attributes.normal) g.computeVertexNormals();
      const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, C = g.attributes.color;
      for (let k = 0; k < P.count; k++) {
        out.p.push(P.getX(k), P.getY(k), P.getZ(k));
        out.n.push(N.getX(k), N.getY(k), N.getZ(k));
        out.uv.push(U ? U.getX(k) : 0, U ? U.getY(k) : 0);
        out.c.push(C ? C.getX(k) : 1, C ? C.getY(k) : 1, C ? C.getZ(k) : 1);
      }
      if (g.index) for (let k = 0; k < g.index.count; k++) out.i.push(g.index.getX(k) + base);
      else for (let k = 0; k < P.count; k++) out.i.push(k + base);
      base += P.count;
    });
    const r = new T.BufferGeometry();
    r.setAttribute("position", new T.Float32BufferAttribute(out.p, 3));
    r.setAttribute("normal", new T.Float32BufferAttribute(out.n, 3));
    r.setAttribute("uv", new T.Float32BufferAttribute(out.uv, 2));
    r.setAttribute("color", new T.Float32BufferAttribute(out.c, 3));
    r.setIndex(out.i);
    return r;
  }
  RR.mergeGeo = merge;
  function lin(c) { return [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)]; }
  RR.lin = lin;
  function paint(g, rgb, srgb) {
    const c0 = srgb === false ? rgb : lin(rgb);
    const n = g.attributes.position.count, c = [];
    for (let i = 0; i < n; i++) c.push(c0[0], c0[1], c0[2]);
    g.setAttribute("color", new T.Float32BufferAttribute(c, 3));
    return g;
  }
  RR.paintGeo = paint;
  // a cylinder from a to b ([x,y,z] arrays), radius r0 at a and r1 at b
  RR.tube = function (a, b, r0, r1, seg) {
    const A = new T.Vector3().fromArray(a), B = new T.Vector3().fromArray(b), d = new T.Vector3().subVectors(B, A), l = d.length();
    const g = new T.CylinderGeometry(r1 === undefined ? r0 : r1, r0, l, seg || 8, 1);
    g.translate(0, l / 2, 0);
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize()));
    g.translate(A.x, A.y, A.z);
    return g;
  };
  // vertex-colour jitter (breaks up flat foliage)
  function jitter(g, base, amt, rnd) {
    const p = g.attributes.position, c = [];
    for (let i = 0; i < p.count; i++) {
      const k = 1 + (rnd() - 0.5) * amt + (RR.fbm2(p.getX(i) * 0.6 + 3, p.getZ(i) * 0.6 + p.getY(i) * 0.4, 2) - 0.5) * amt;
      c.push.apply(c, lin([base[0] * k, base[1] * k, base[2] * k]));
    }
    g.setAttribute("color", new T.Float32BufferAttribute(c, 3));
    return g;
  }
  function blob(r, sx, sy, sz, seed, det) {
    const g = new T.IcosahedronGeometry(r, det === undefined ? 2 : det);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 0.78 + 0.4 * RR.fbm2(x * 0.9 + seed, y * 0.9 + z * 0.7, 3);
      p.setXYZ(i, x * k * sx, y * k * sy, z * k * sz);
    }
    g.computeVertexNormals();
    return g;
  }

  // ---------- trees ----------
  // Southern live oak: a short thick trunk, limbs reaching out sideways, broad flat canopy clumps
  // and Spanish moss hanging off the limbs.
  RR.oakGeometry = function (seed) {
    const rnd = RR.rng(seed), parts = [];
    const bark = [0.27, 0.23, 0.2];
    parts.push(paint(RR.tube([0, -0.4, 0], [0.3, 3.2, 0.1], 0.75, 0.55, 9), bark));
    const limbs = 4 + Math.floor(rnd() * 2), ends = [];
    for (let k = 0; k < limbs; k++) {
      const a = k / limbs * Math.PI * 2 + rnd() * 0.6, len = 6 + rnd() * 4, up = 1.2 + rnd() * 2.5;
      const e = [Math.cos(a) * len, 3 + up, Math.sin(a) * len];
      const mid = [e[0] * 0.5, 3.6 + up * 0.2 - 0.6 * rnd(), e[2] * 0.5];
      parts.push(paint(RR.tube([0.2, 2.9, 0.05], mid, 0.42, 0.3, 7), bark));
      parts.push(paint(RR.tube(mid, e, 0.3, 0.12, 6), bark));
      ends.push(e, mid);
    }
    const leaf = [0.2, 0.29, 0.13];
    ends.forEach(function (e, i) {
      const g = blob(2.4 + rnd() * 1.4, 1.25, 0.55, 1.25, seed + i * 3.1, 1);
      g.translate(e[0], e[1] + 0.8, e[2]);
      parts.push(jitter(g, leaf, 0.35, rnd));
    });
    { const g = blob(3.6, 1.2, 0.6, 1.2, seed + 9, 1); g.translate(0, 6.2, 0); parts.push(jitter(g, leaf, 0.35, rnd)); }
    // Spanish moss: grey-green wisps hanging from under the canopy
    const moss = [0.52, 0.56, 0.47];
    for (let k = 0; k < 26; k++) {
      const e = ends[Math.floor(rnd() * ends.length)], f = 0.4 + rnd() * 0.7;
      const x = e[0] * f + (rnd() - 0.5) * 2.5, z = e[2] * f + (rnd() - 0.5) * 2.5, y = e[1] * (0.85 + rnd() * 0.2) + 0.3, len = 1 + rnd() * 1.8;
      const g = new T.ConeGeometry(0.16 + rnd() * 0.14, len, 5, 1);
      g.rotateX(Math.PI); g.translate(x, y - len / 2, z);
      parts.push(jitter(g, moss, 0.3, rnd));
    }
    return merge(parts);
  };
  // loblolly pine: tall bare trunk, clumped crown
  RR.pineGeometry = function (seed) {
    const rnd = RR.rng(seed), parts = [];
    const H = 13 + rnd() * 5;
    parts.push(paint(RR.tube([0, -0.3, 0], [0.2, H, 0], 0.32, 0.14, 7), [0.33, 0.27, 0.22]));
    const leaf = [0.14, 0.24, 0.12];
    for (let k = 0; k < 5; k++) {
      const a = rnd() * 6.28, r = k ? 1 + rnd() * 1.4 : 0, y = H - 3 + rnd() * 4 - (k ? 1.5 : 0);
      const g = blob(1.6 + rnd() * 1.2, 1.1, 0.7, 1.1, seed + k * 7.7, 1);
      g.translate(Math.cos(a) * r, y, Math.sin(a) * r);
      parts.push(jitter(g, leaf, 0.4, rnd));
      if (k) parts.push(paint(RR.tube([0.1, y - 1.2, 0], [Math.cos(a) * r, y, Math.sin(a) * r], 0.1, 0.06, 5), [0.33, 0.27, 0.22]));
    }
    return merge(parts);
  };
  // dwarf palmetto: a fan of blades
  RR.palmettoGeometry = function (seed) {
    const rnd = RR.rng(seed), parts = [];
    for (let k = 0; k < 9; k++) {
      const a = k / 9 * Math.PI * 2 + rnd() * 0.4, tilt = 0.5 + rnd() * 0.5, len = 0.9 + rnd() * 0.5;
      const g = new T.ConeGeometry(0.32, len, 4, 1);
      g.scale(1, 1, 0.12); g.translate(0, len / 2, 0); g.rotateX(tilt); g.rotateY(a);
      parts.push(jitter(g, [0.24, 0.36, 0.16], 0.35, rnd));
    }
    return merge(parts);
  };
  // a street / park oak (rounder, neater than the live oak)
  RR.streetTreeGeometry = function (seed) {
    const rnd = RR.rng(seed), parts = [];
    parts.push(paint(RR.tube([0, -0.2, 0], [0, 3.4, 0], 0.22, 0.16, 7), [0.3, 0.25, 0.2]));
    const leaf = [0.2, 0.33, 0.14];
    for (let k = 0; k < 4; k++) {
      const a = k * 1.9, g = blob(1.7 + rnd() * 0.6, 1, 0.85, 1, seed + k, 2);
      g.translate(Math.cos(a) * (k ? 1.1 : 0), 4.6 + rnd() * 1.4, Math.sin(a) * (k ? 1.1 : 0));
      parts.push(jitter(g, leaf, 0.35, rnd));
    }
    return merge(parts);
  };
  RR.bushGeometry = function (seed) { const rnd = RR.rng(seed); const g = blob(0.9, 1.3, 0.7, 1.3, seed, 1); g.translate(0, 0.45, 0); return jitter(g, [0.18, 0.28, 0.12], 0.4, rnd); };
  RR.rockGeometry = function (seed, col) {
    const g = new T.IcosahedronGeometry(1, 3), p = g.attributes.position, c = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 0.7 + 0.45 * RR.fbm2(x * 1.6 + seed, y * 1.6 + z * 1.1, 4) + 0.12 * RR.fbm2(x * 6 + seed, y * 6 - z * 5, 3);
      p.setXYZ(i, x * k, y * k * 0.7, z * k);
      const n = RR.fbm2(x * 3 + seed, z * 3, 2);
      c.push.apply(c, lin([(col || [0.45, 0.42, 0.38])[0] * (0.8 + n * 0.4), (col || [0.45, 0.42, 0.38])[1] * (0.8 + n * 0.4), (col || [0.45, 0.42, 0.38])[2] * (0.8 + n * 0.4)]));
    }
    g.setAttribute("color", new T.Float32BufferAttribute(c, 3));
    g.computeVertexNormals();
    return g;
  };

  // ---------- small street / track furniture ----------
  RR.coneGeometry = function () {
    const parts = [];
    parts.push(paint(new T.BoxGeometry(0.42, 0.04, 0.42).translate(0, 0.02, 0), [0.95, 0.35, 0.05]));
    const c = new T.CylinderGeometry(0.035, 0.16, 0.66, 14, 6, true); c.translate(0, 0.37, 0);
    const p = c.attributes.position, col = [];
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); col.push.apply(col, lin(y > 0.36 && y < 0.5 ? [0.95, 0.95, 0.95] : [1.0, 0.36, 0.04])); }
    c.setAttribute("color", new T.Float32BufferAttribute(col, 3));
    parts.push(c);
    return merge(parts);
  };
  // plastic water-filled barrier, orange and white
  RR.barrierGeometry = function () {
    const s = new T.Shape();
    s.moveTo(-0.32, 0); s.lineTo(0.32, 0); s.lineTo(0.3, 0.12); s.lineTo(0.12, 0.3); s.lineTo(0.12, 0.92); s.lineTo(-0.12, 0.92); s.lineTo(-0.12, 0.3); s.lineTo(-0.3, 0.12); s.lineTo(-0.32, 0);
    const g = new T.ExtrudeGeometry(s, { depth: 1.8, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
    g.translate(0, 0, -0.9);
    g.rotateY(Math.PI / 2);
    const p = g.attributes.position, c = [];
    for (let i = 0; i < p.count; i++) { const x = p.getX(i); c.push.apply(c, lin(Math.floor((x + 0.9) / 0.6) % 2 ? [0.96, 0.96, 0.94] : [1.0, 0.38, 0.06])); }
    g.setAttribute("color", new T.Float32BufferAttribute(c, 3));
    g.computeVertexNormals();
    return g;
  };
  RR.tireStackGeometry = function (n) {
    const parts = [];
    for (let k = 0; k < n; k++) { const t = new T.TorusGeometry(0.34, 0.15, 8, 18); t.rotateX(Math.PI / 2); t.translate(0, 0.15 + k * 0.28, 0); parts.push(paint(t, [0.07, 0.07, 0.08])); }
    return merge(parts);
  };
  RR.hayBaleGeometry = function () {
    const g = new T.BoxGeometry(1.2, 0.5, 0.55, 3, 2, 2); g.translate(0, 0.25, 0);
    const p = g.attributes.position, c = [];
    for (let i = 0; i < p.count; i++) { const n = RR.fbm2(p.getX(i) * 5, p.getY(i) * 5 + p.getZ(i) * 3, 2); c.push.apply(c, lin([0.82 * (0.85 + n * 0.3), 0.68 * (0.85 + n * 0.3), 0.36])); }
    g.setAttribute("color", new T.Float32BufferAttribute(c, 3));
    return g;
  };
  // a fan: legs, body, head; arms up or down
  RR.fanGeometry = function (armsUp, shirt, skin, pants) {
    const parts = [];
    parts.push(paint(new T.CylinderGeometry(0.11, 0.09, 0.85, 7).translate(-0.1, 0.42, 0), pants));
    parts.push(paint(new T.CylinderGeometry(0.11, 0.09, 0.85, 7).translate(0.1, 0.42, 0), pants));
    parts.push(paint(new T.CylinderGeometry(0.22, 0.2, 0.65, 9).translate(0, 1.15, 0), shirt));
    parts.push(paint(new T.SphereGeometry(0.13, 10, 8).translate(0, 1.62, 0), skin));
    [-1, 1].forEach(function (s) {
      if (armsUp) parts.push(paint(RR.tube([s * 0.24, 1.38, 0], [s * 0.42, 2.0, -0.05], 0.06), skin));
      else parts.push(paint(RR.tube([s * 0.24, 1.4, 0], [s * 0.3, 0.86, -0.05], 0.06), shirt));
    });
    return merge(parts);
  };

  // ---------- placement over a world ----------
  // P: helpers bound to one world (its course, its root group, its ground function)
  RR.Props = function (world) {
    this.w = world; this.tr = world.track; this.root = world.root;
    this.Mx = new T.Matrix4(); this.Qn = new T.Quaternion(); this.Sv = new T.Vector3(); this.Pv = new T.Vector3();
  };
  const PP = RR.Props.prototype;
  // instances: [[x, y, z, yaw, scale, scaleY?], ...]. Big sets are split into 140 m cells, each
  // with its own bounds, so the camera and the sun's shadow pass can cull them.
  PP.instanced = function (geo, mat, list, shadow) {
    if (!list.length) return null;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const cells = {};
    const CELL = list.length > 60 ? 140 : 1e9;
    list.forEach(function (t) { const k = Math.floor(t[0] / CELL) + "," + Math.floor(t[2] / CELL); (cells[k] = cells[k] || []).push(t); });
    const UP = new T.Vector3(0, 1, 0), self = this, gr = geo.boundingSphere.radius;
    let last = null;
    Object.keys(cells).forEach(function (k) {
      const L = cells[k];
      // a shallow copy of the geometry carrying this cell's bounds
      const g = new T.BufferGeometry();
      for (const a in geo.attributes) g.setAttribute(a, geo.attributes[a]);
      g.setIndex(geo.index);
      let cx = 0, cy = 0, cz = 0;
      L.forEach(function (t) { cx += t[0]; cy += t[1]; cz += t[2]; });
      cx /= L.length; cy /= L.length; cz /= L.length;
      let r = 0;
      L.forEach(function (t) { r = Math.max(r, Math.hypot(t[0] - cx, t[1] - cy, t[2] - cz) + gr * Math.max(t[4] || 1, t[5] || 1)); });
      g.boundingSphere = new T.Sphere(new T.Vector3(cx, cy, cz), r);
      const im = new T.InstancedMesh(g, mat, L.length);
      L.forEach(function (t, i) {
        self.Qn.setFromAxisAngle(UP, t[3] || 0);
        self.Mx.compose(self.Pv.set(t[0], t[1], t[2]), self.Qn, self.Sv.set(t[4] || 1, t[5] || t[4] || 1, t[4] || 1));
        im.setMatrixAt(i, self.Mx);
      });
      if (im.computeBoundingSphere) im.computeBoundingSphere();
      im.castShadow = shadow !== false; im.receiveShadow = true;
      self.root.add(im);
      last = im;
    });
    return last;
  };
  // a point beside the line at (s, lat), standing on the ground
  PP.at = function (s, lat) {
    const p = this.tr.at(s, lat);
    p.y = this.w.ground(p.x, p.z, Math.round(s / this.tr.ds));
    return p;
  };
  // a flat decal strip along the line (paint, rails, tape on the ground)
  PP.strip = function (s0, s1, lat, width, mat, lift, uvLen) {
    const pos = [], uv = [], idx = [];
    let n = 0, u = 0, last = null;
    for (let s = s0; s <= s1 + 1e-3; s += 1, n++) {
      const a = this.tr.at(s, lat - width / 2), b = this.tr.at(s, lat + width / 2), ti = Math.round(s / this.tr.ds);
      if (last) u += 1 / (uvLen || 1);
      pos.push(a.x, this.w.ground(a.x, a.z, ti) + (lift || 0.025), a.z, b.x, this.w.ground(b.x, b.z, ti) + (lift || 0.025), b.z);
      uv.push(0, u, 1, u);
      if (n) { const k = (n - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      last = a;
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new T.Mesh(g, mat);
    m.receiveShadow = true;
    m.castShadow = (lift || 0) > 1;   // decks and roofs overhead shade what's under them
    this.root.add(m);
    return m;
  };
  // an upright ribbon along the line (fence, tape, wall face)
  PP.fence = function (s0, s1, lat, y0, y1, mat, uvLen, step) {
    const pos = [], uv = [], idx = [];
    let u = 0, last = null, n = 0;
    for (let s = s0; s <= s1 + 1e-3; s += step || 2, n++) {
      const p = this.tr.at(s, lat), y = this.w.ground(p.x, p.z, Math.round(s / this.tr.ds));
      if (last) u += Math.hypot(p.x - last.x, p.z - last.z) / (uvLen || 4);
      pos.push(p.x, y + y0, p.z, p.x, y + y1, p.z); uv.push(u, 0, u, 1);
      if (n) { const a = (n - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      last = p;
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new T.Mesh(g, mat);
    m.castShadow = true; m.receiveShadow = true;
    this.root.add(m);
    return m;
  };
  // start / finish / section gate: two pylons and a banner across the line
  PP.gate = function (s, text, a, b, halfW, opts) {
    opts = opts || {};
    const p = this.tr.at(s, 0), g = new T.Group(), w = this.w;
    const pyl = new T.MeshStandardMaterial({ color: opts.pylon || 0x1c1c22, roughness: 0.45, metalness: 0.4 });
    const stripe = new T.MeshStandardMaterial({ color: opts.stripe || 0xff4a1c, roughness: 0.4, emissive: opts.stripe || 0xff4a1c, emissiveIntensity: 0.25 });
    const y0 = w.ground(p.x, p.z, Math.round(s));
    const H = opts.h || 7.5;
    [-1, 1].forEach(function (sg) {
      const lx = p.x + p.rx * halfW * sg, lz = p.z + p.rz * halfW * sg, gy = w.ground(lx, lz) - y0;
      const c = new T.Mesh(new T.BoxGeometry(0.9, H + 1, 0.9), pyl); c.position.set(sg * halfW, gy + (H + 1) / 2 - 0.5, 0);
      const st = new T.Mesh(new T.BoxGeometry(0.95, 0.5, 0.95), stripe); st.position.set(sg * halfW, gy + H * 0.45, 0);
      g.add(c, st);
      w.obstacles.push({ x: lx, z: lz, r: 0.75 });
    });
    const bt = RR.bannerTexture(text, a, b), bm = new T.MeshStandardMaterial({ map: bt, roughness: 0.5, emissive: 0xffffff, emissiveMap: bt, emissiveIntensity: 0.35 });
    const ban = new T.Mesh(new T.BoxGeometry(2 * halfW + 1.2, 1.9, 0.3), [pyl, pyl, pyl, pyl, bm, bm]);
    ban.position.set(0, H, 0);
    g.add(ban);
    g.position.set(p.x, y0, p.z);
    g.rotation.y = p.yaw;
    g.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.root.add(g);
    return g;
  };
  // A wooden kicker: its top follows the ground and curves up to a lip (riders launch off it).
  // Registered with the world so riders ride up it (world.rampY).
  PP.kicker = function (s, lat, len, wid, h, mat) {
    const tr = this.tr, w = this.w;
    const p0 = tr.at(s - len, lat), p1 = tr.at(s, lat);
    let fx = p1.x - p0.x, fz = p1.z - p0.z; const fl = Math.hypot(fx, fz); fx /= fl; fz /= fl;
    const rx = -fz, rz = fx, x0 = p0.x, z0 = p0.z;
    const NA = 12, NW = 4, pos = [], uv = [], idx = [];
    const prof = function (t) { return h * Math.pow(t, 1.5); };
    for (let a = 0; a <= NA; a++) for (let b = 0; b <= NW; b++) {
      const t = a / NA, u = b / NW - 0.5, x = x0 + fx * t * len + rx * u * wid, z = z0 + fz * t * len + rz * u * wid;
      pos.push(x, w.ground(x, z) + prof(t) + 0.04, z); uv.push(u * wid / 2, t * len / 2);
    }
    for (let a = 0; a < NA; a++) for (let b = 0; b < NW; b++) { const i0 = a * (NW + 1) + b, i1 = i0 + NW + 1; idx.push(i0, i0 + 1, i1, i0 + 1, i1 + 1, i1); }
    function quadStrip(pts) {
      const base = pos.length / 3;
      pts.forEach(function (q) { pos.push(q[0], q[1], q[2], q[0], q[3], q[2]); uv.push(q[4], 0, q[4], 0.4); });
      for (let k = 0; k < pts.length - 1; k++) { const a = base + k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const lip = [], sideL = [], sideR = [];
    for (let b = 0; b <= NW; b++) {
      const u = b / NW - 0.5, x = x0 + fx * len + rx * u * wid, z = z0 + fz * len + rz * u * wid, g0 = w.ground(x, z);
      lip.push([x, g0 + prof(1) + 0.04, z, g0 - 0.1, u]);
    }
    for (let a = 0; a <= NA; a++) {
      const t = a / NA;
      [[sideL, -0.5], [sideR, 0.5]].forEach(function (sd) {
        const x = x0 + fx * t * len + rx * sd[1] * wid, z = z0 + fz * t * len + rz * sd[1] * wid, g0 = w.ground(x, z);
        sd[0].push([x, g0 + prof(t) + 0.04, z, g0 - 0.1, t]);
      });
    }
    quadStrip(lip); quadStrip(sideL); quadStrip(sideR.reverse());
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new T.Mesh(g, mat);
    m.castShadow = true; m.receiveShadow = true;
    m.userData = { x0: x0, z0: z0, fx: fx, fz: fz, rx: rx, rz: rz, len: len, w: wid, h: h, s: s, lat: lat };
    this.root.add(m);
    w.ramps.push(m);
    return m;
  };
  // fans standing behind the barriers along a stretch
  PP.crowd = function (s0, s1, lat, rows, density, rnd) {
    const shirts = [[0.9, 0.15, 0.16], [0.12, 0.36, 1], [1, 0.82, 0.25], [0.95, 0.95, 0.95], [0.17, 0.85, 0.42], [1, 0.48, 0.1], [0.1, 0.1, 0.12], [0, 0.7, 0.85]];
    const skins = [[0.45, 0.3, 0.2], [0.68, 0.5, 0.36], [0.3, 0.2, 0.14], [0.85, 0.66, 0.5]];
    const pants = [[0.15, 0.18, 0.3], [0.1, 0.1, 0.1], [0.42, 0.38, 0.32]];
    if (!RR.fanGeos) {
      RR.fanGeos = [];
      for (let k = 0; k < 16; k++) { const g = RR.fanGeometry(k % 3 === 0, shirts[k % 8], skins[(k * 3 + 1) % 4], pants[k % 3]); g.userData.shared = true; RR.fanGeos.push(g); }
      RR.fanMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
      RR.fanMat.userData.shared = true;
    }
    const lists = RR.fanGeos.map(function () { return []; });
    const sg = Math.sign(lat);
    for (let s = s0; s < s1; s += 1.1) for (let r = 0; r < rows; r++) {
      if (rnd() > density) continue;
      const p = this.at(s + (rnd() - 0.5) * 0.6, lat + sg * (r * 1.0 + rnd() * 0.4));
      const yaw = p.yaw + (sg > 0 ? -Math.PI / 2 : Math.PI / 2) + (rnd() - 0.5) * 0.6;
      lists[Math.floor(rnd() * lists.length)].push([p.x, p.y + r * 0.25, p.z, yaw, 0.92 + rnd() * 0.16]);
    }
    const self = this;
    lists.forEach(function (l, k) { self.instanced(RR.fanGeos[k], RR.fanMat, l, true); });
  };
})(window.RR = window.RR || {});
