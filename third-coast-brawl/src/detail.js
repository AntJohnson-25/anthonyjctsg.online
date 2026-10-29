// Medium-to-high poly detail pass over the three courses. Runs after each dress-*.js (own rng, so the
// original layouts do not move). Lathe-turned street furniture and sidewalks for DOWNTOWN DROP, ferns,
// grass, logs, knees, mushrooms and reeds for BAYOU BENDS, drums, pallets, flood masts, flags, rubble and
// container hardware for SHIP CHANNEL SCRAMBLE. Everything is instanced vertex-colour geometry.
(function (RR) {
  "use strict";
  const T = window.THREE;
  RR.DETAIL = RR.DETAIL || {};

  // ---------- geometry builders ----------
  function paint(g, c) { return RR.paintGeo(g, c); }
  function lathe(pts, seg, col) {
    return paint(new T.LatheGeometry(pts.map(function (p) { return new T.Vector2(p[0], p[1]); }), seg || 16), col);
  }
  function colorize(g, fn) {
    const p = g.attributes.position, c = [];
    for (let i = 0; i < p.count; i++) { const k = fn(p.getX(i), p.getY(i), p.getZ(i), i); c.push.apply(c, RR.lin(k)); }
    g.setAttribute("color", new T.Float32BufferAttribute(c, 3));
    return g;
  }
  function noisy(g, amt, seed, scale) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + (RR.fbm2(x * (scale || 3) + seed, y * (scale || 3) + z * 2, 3) - 0.5) * amt;
      p.setXYZ(i, x * k, y, z * k);
    }
    g.computeVertexNormals();
    return g;
  }
  function flatUV(g) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.003, 0.003); return g; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

  // a curved tapering blade or frond: n segments, from (0,base,0) heading a
  function blade(parts, o) {
    const n = o.segs || 4, pos = [], col = [], idx = [];
    const ca = Math.cos(o.a), sa = Math.sin(o.a), px = -sa, pz = ca;
    for (let i = 0; i <= n; i++) {
      const t = i / n, R = o.reach * t, Y = o.base + o.height * t - o.droop * t * t;
      const w = o.fern ? o.w * Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * t)), 0.8) * (i % 2 ? 0.82 : 1) : o.w * Math.pow(1 - t, 0.75);
      const cx = o.x + ca * R, cz = o.z + sa * R;
      pos.push(cx + px * w, Y, cz + pz * w, cx - px * w, Y, cz - pz * w);
      const c = RR.lin(mix(o.c0, o.c1, t * (0.85 + o.j * 0.3)));
      col.push(c[0], c[1], c[2], c[0], c[1], c[2]);
      if (i) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new T.Float32BufferAttribute(col, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0), 2));
    g.setIndex(idx); g.computeVertexNormals();
    parts.push(g);
  }
  // upright normals look better on foliage lit from above: point every normal mostly up
  function softNormals(g) {
    const n = g.attributes.normal;
    for (let i = 0; i < n.count; i++) {
      const x = n.getX(i) * 0.4, y = Math.abs(n.getY(i)) * 0.4 + 0.8, z = n.getZ(i) * 0.4, l = Math.hypot(x, y, z);
      n.setXYZ(i, x / l, y / l, z / l);
    }
    return g;
  }
  RR.fernGeometry = function (seed, c0, c1) {
    const rnd = RR.rng(seed), parts = [];
    for (let k = 0; k < 13; k++) {
      const a = k / 13 * Math.PI * 2 + rnd() * 0.4;
      blade(parts, { x: 0, z: 0, a: a, reach: 0.9 + rnd() * 0.5, height: 0.55 + rnd() * 0.35, droop: 0.85 + rnd() * 0.5, base: 0.05, w: 0.15 + rnd() * 0.05, segs: 7, fern: true, c0: c0 || [0.08, 0.2, 0.06], c1: c1 || [0.26, 0.44, 0.14], j: rnd() });
    }
    return softNormals(RR.mergeGeo(parts));
  };
  RR.grassGeometry = function (seed, c0, c1, tall) {
    const rnd = RR.rng(seed), parts = [];
    for (let k = 0; k < 18; k++) {
      const r = rnd() * 0.22, aa = rnd() * 6.28;
      blade(parts, { x: Math.cos(aa) * r, z: Math.sin(aa) * r, a: rnd() * 6.28, reach: 0.12 + rnd() * 0.3, height: (0.45 + rnd() * 0.55) * (tall || 1), droop: 0.1 + rnd() * 0.3, base: 0, w: 0.028 + rnd() * 0.012, segs: 4, c0: c0 || [0.12, 0.2, 0.06], c1: c1 || [0.46, 0.55, 0.2], j: rnd() });
    }
    return softNormals(RR.mergeGeo(parts));
  };
  // cat-tail reeds with brown heads
  RR.reedGeometry = function (seed) {
    const rnd = RR.rng(seed), parts = [];
    for (let k = 0; k < 9; k++) {
      const a = rnd() * 6.28, r = rnd() * 0.25, h = 1.2 + rnd() * 0.9;
      blade(parts, { x: Math.cos(a) * r, z: Math.sin(a) * r, a: rnd() * 6.28, reach: 0.15 + rnd() * 0.25, height: h, droop: 0.1, base: 0, w: 0.04, segs: 5, c0: [0.14, 0.24, 0.08], c1: [0.5, 0.56, 0.22], j: rnd() });
      if (k < 3) {
        const hd = new T.CylinderGeometry(0.035, 0.035, 0.3, 7); hd.translate(Math.cos(a) * r + 0.05, h * 0.9, Math.sin(a) * r);
        parts.push(paint(hd, [0.28, 0.16, 0.08]));
      }
    }
    return softNormals(RR.mergeGeo(parts));
  };
  RR.kneeGeometry = function (seed) {
    const g = new T.LatheGeometry([[0.3, 0], [0.24, 0.18], [0.17, 0.45], [0.11, 0.75], [0.05, 0.95], [0.0, 1.02]].map(function (p) { return new T.Vector2(p[0], p[1]); }), 12, 0, Math.PI * 2);
    noisy(g, 0.5, seed, 4);
    return colorize(g, function (x, y) { return mix([0.3, 0.24, 0.18], [0.46, 0.4, 0.3], y); });
  };
  RR.logGeometry = function (seed) {
    const g = new T.CylinderGeometry(0.3, 0.37, 3.6, 16, 12);
    const p = g.attributes.position, nrm = g.attributes.normal, caps = [];
    for (let i = 0; i < p.count; i++) caps.push(Math.abs(nrm.getY(i)) > 0.9);
    noisy(g, 0.28, seed, 3.5);
    colorize(g, function (x, y, z, i) { const n = RR.fbm2(x * 6 + seed, y * 2 + z * 5, 3); return caps[i] ? [0.58, 0.45, 0.3] : [0.2 + n * 0.12, 0.16 + n * 0.1, 0.12 + n * 0.08]; });
    const parts = [g.rotateZ(Math.PI / 2)];
    for (let k = 0; k < 2; k++) {
      const s = k ? 1 : -1, b = RR.tube([s * 0.4, 0.1, 0.2], [s * 0.8, 0.5, 0.45], 0.07, 0.03, 6);
      parts.push(paint(b, [0.22, 0.18, 0.14]));
    }
    // moss on top
    const m = new T.SphereGeometry(0.34, 10, 6, 0, Math.PI * 2, 0, 1.1); m.scale(3.2, 0.35, 1); m.translate(-0.3, 0.2, 0);
    parts.push(paint(m, [0.16, 0.3, 0.1]));
    return RR.mergeGeo(parts);
  };
  RR.mushroomGeometry = function (seed) {
    const rnd = RR.rng(seed), parts = [];
    for (let k = 0; k < 5; k++) {
      const s = 0.5 + rnd() * 0.8, a = rnd() * 6.28, r = k ? 0.1 + rnd() * 0.14 : 0;
      const stem = new T.CylinderGeometry(0.022 * s, 0.03 * s, 0.12 * s, 8); stem.translate(0, 0.06 * s, 0);
      const cap = new T.SphereGeometry(0.07 * s, 10, 6, 0, Math.PI * 2, 0, 1.45); cap.scale(1, 0.55, 1); cap.translate(0, 0.12 * s, 0);
      const dx = Math.cos(a) * r, dz = Math.sin(a) * r;
      stem.translate(dx, 0, dz); cap.translate(dx, 0, dz);
      parts.push(paint(stem, [0.85, 0.82, 0.7]));
      parts.push(paint(cap, rnd() < 0.5 ? [0.72, 0.24, 0.12] : [0.55, 0.4, 0.22]));
    }
    return RR.mergeGeo(parts);
  };
  RR.trailSignGeometry = function () {
    const parts = [];
    parts.push(paint(new T.BoxGeometry(0.11, 1.5, 0.11).translate(0, 0.75, 0), [0.32, 0.22, 0.14]));
    parts.push(paint(new T.BoxGeometry(0.7, 0.24, 0.05).translate(0.2, 1.3, 0.07), [0.2, 0.42, 0.2]));
    parts.push(paint(new T.BoxGeometry(0.66, 0.06, 0.055).translate(0.2, 1.3, 0.075), [0.9, 0.9, 0.82]));
    const tip = new T.ConeGeometry(0.17, 0.22, 3); tip.rotateZ(-Math.PI / 2); tip.scale(1, 1, 0.2); tip.translate(0.65, 1.3, 0.07);
    parts.push(paint(tip, [0.2, 0.42, 0.2]));
    parts.push(paint(new T.BoxGeometry(0.5, 0.2, 0.05).translate(-0.1, 1.05, 0.07), [0.55, 0.3, 0.1]));
    return RR.mergeGeo(parts);
  };

  // ---------- street furniture ----------
  RR.hydrantGeometry = function () {
    const red = [0.78, 0.12, 0.08], steel = [0.55, 0.55, 0.52], parts = [];
    parts.push(lathe([[0.2, 0], [0.2, 0.06], [0.14, 0.1], [0.13, 0.5], [0.16, 0.54], [0.16, 0.6], [0.12, 0.66], [0.09, 0.74], [0.0, 0.78]], 16, red));
    parts.push(lathe([[0.22, 0], [0.22, 0.05], [0.0, 0.05]], 16, steel));
    [-1, 1].forEach(function (s) {
      const n = new T.CylinderGeometry(0.06, 0.06, 0.16, 10); n.rotateZ(Math.PI / 2); n.translate(s * 0.17, 0.38, 0);
      parts.push(paint(n, red));
      const c = new T.CylinderGeometry(0.07, 0.07, 0.05, 10); c.rotateZ(Math.PI / 2); c.translate(s * 0.27, 0.38, 0);
      parts.push(paint(c, steel));
    });
    const f = new T.CylinderGeometry(0.075, 0.075, 0.16, 10); f.rotateX(Math.PI / 2); f.translate(0, 0.38, 0.17);
    parts.push(paint(f, red));
    parts.push(paint(new T.CylinderGeometry(0.05, 0.05, 0.06, 6).translate(0, 0.78, 0), steel));
    return RR.mergeGeo(parts);
  };
  RR.binGeometry = function () {
    const col = [0.14, 0.26, 0.2], parts = [];
    parts.push(lathe([[0.0, 0.04], [0.26, 0.04], [0.28, 0.1], [0.3, 0.9], [0.32, 0.94], [0.0, 0.94]], 16, col));
    for (let k = 0; k < 3; k++) parts.push(paint(new T.TorusGeometry(0.3, 0.012, 5, 18).rotateX(Math.PI / 2).translate(0, 0.25 + k * 0.28, 0), [0.3, 0.32, 0.3]));
    parts.push(lathe([[0.0, 0.98], [0.2, 0.98], [0.33, 0.96], [0.34, 0.92], [0.28, 0.92]], 16, [0.2, 0.2, 0.2]));
    parts.push(paint(new T.SphereGeometry(0.06, 8, 6).translate(0, 1.02, 0), [0.4, 0.4, 0.4]));
    return RR.mergeGeo(parts);
  };
  RR.bollardGeometry = function () {
    return RR.mergeGeo([
      lathe([[0.1, 0], [0.1, 0.78], [0.12, 0.82], [0.09, 0.86], [0.0, 0.9]], 14, [0.18, 0.19, 0.2]),
      paint(new T.TorusGeometry(0.102, 0.018, 6, 14).rotateX(Math.PI / 2).translate(0, 0.66, 0), [0.95, 0.8, 0.12]),
      paint(new T.TorusGeometry(0.102, 0.018, 6, 14).rotateX(Math.PI / 2).translate(0, 0.58, 0), [0.95, 0.8, 0.12]),
      lathe([[0.14, 0], [0.14, 0.04], [0.1, 0.07], [0.0, 0.07]], 14, [0.3, 0.3, 0.3])
    ]);
  };
  // ornate pedestrian lamp: a fluted base and shaft, a scrolled arm, a glass lantern (glow is separate)
  RR.pedLampGeometry = function () {
    const iron = [0.08, 0.1, 0.09], parts = [], glow = [];
    parts.push(lathe([[0.0, 0], [0.26, 0], [0.26, 0.14], [0.2, 0.2], [0.17, 0.42], [0.2, 0.5], [0.1, 0.56], [0.075, 0.7], [0.07, 3.9], [0.1, 4.0], [0.1, 4.1], [0.0, 4.1]], 14, iron));
    parts.push(paint(new T.TorusGeometry(0.1, 0.02, 6, 14).rotateX(Math.PI / 2).translate(0, 3.7, 0), iron));
    [-1, 1].forEach(function (s) {
      const arc = new T.TorusGeometry(0.32, 0.025, 6, 12, Math.PI); arc.rotateZ(Math.PI / 2 * (s > 0 ? 1 : -1) + (s > 0 ? 0 : Math.PI)); arc.translate(s * 0.32, 3.4, 0);
      parts.push(paint(arc, iron));
      parts.push(lathe([[0.0, 0], [0.09, 0.02], [0.11, 0.08], [0.09, 0.14], [0.0, 0.16]], 10, iron).translate(s * 0.64, 4.0, 0));
      glow.push(paint(new T.SphereGeometry(0.15, 12, 9).translate(s * 0.64, 4.22, 0), [1, 0.82, 0.55]));
      parts.push(lathe([[0.0, 0.0], [0.17, 0.0], [0.19, 0.04], [0.0, 0.1]], 10, iron).translate(s * 0.64, 4.34, 0));
    });
    return { body: RR.mergeGeo(parts), glow: RR.mergeGeo(glow) };
  };
  RR.benchGeometry = function () {
    const wood = [0.42, 0.28, 0.16], iron = [0.08, 0.09, 0.09], parts = [];
    for (let k = 0; k < 4; k++) parts.push(paint(new T.BoxGeometry(1.7, 0.035, 0.1).translate(0, 0.46, -0.17 + k * 0.115), wood));
    for (let k = 0; k < 3; k++) parts.push(paint(new T.BoxGeometry(1.7, 0.1, 0.03).translate(0, 0.66 + k * 0.125, -0.24 - k * 0.025), wood));
    [-1, 1].forEach(function (s) {
      parts.push(paint(new T.BoxGeometry(0.05, 0.46, 0.45).translate(s * 0.8, 0.23, 0), iron));
      parts.push(paint(new T.BoxGeometry(0.05, 0.05, 0.45).translate(s * 0.8, 0.68, 0), iron));
      parts.push(paint(RR.tube([s * 0.8, 0.46, -0.2], [s * 0.8, 0.95, -0.28], 0.025, 0.025, 6), iron));
    });
    return RR.mergeGeo(parts);
  };
  RR.planterGeometry = function (seed) {
    const rnd = RR.rng(seed), parts = [];
    parts.push(paint(new T.BoxGeometry(1.3, 0.62, 1.3).translate(0, 0.31, 0), [0.62, 0.6, 0.56]));
    parts.push(paint(new T.BoxGeometry(1.4, 0.07, 1.4).translate(0, 0.65, 0), [0.7, 0.68, 0.64]));
    parts.push(paint(new T.BoxGeometry(1.1, 0.04, 1.1).translate(0, 0.62, 0), [0.16, 0.1, 0.06]));
    for (let k = 0; k < 4; k++) {
      const g = new T.IcosahedronGeometry(0.34 + rnd() * 0.12, 2); g.scale(1, 0.8, 1);
      noisy(g, 0.4, seed + k * 3, 2.2);
      g.translate((k % 2 ? 1 : -1) * 0.22 * (k > 1 ? -1 : 1), 0.95 + rnd() * 0.15, (k < 2 ? -1 : 1) * 0.2);
      parts.push(colorize(g, function (x, y) { return mix([0.1, 0.24, 0.08], [0.32, 0.5, 0.16], Math.min(1, Math.max(0, (y - 0.6) * 1.4)) * (0.7 + rnd() * 0.3)); }));
    }
    return RR.mergeGeo(parts);
  };
  RR.bikeRackGeometry = function () {
    const steel = [0.6, 0.62, 0.66], parts = [];
    for (let k = 0; k < 3; k++) {
      const a = new T.TorusGeometry(0.34, 0.022, 6, 14, Math.PI); a.translate(k * 0.55 - 0.55, 0.0, 0);
      parts.push(paint(a, steel));
    }
    return RR.mergeGeo(parts);
  };
  RR.tireGeometry = function () {
    return paint(new T.TorusGeometry(0.34, 0.15, 10, 22).rotateX(Math.PI / 2).translate(0, 0.15, 0), [0.07, 0.07, 0.08]);
  };

  // ---------- materials ----------
  function pavingMat() {
    const tex = RR.canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = "#a9a59d"; g.fillRect(0, 0, w, h);
      RR.speckle(g, w, h, 600, ["#9b978f", "#b4b0a8", "#8e8a83"], 1, 3, RR.rng(4));
      RR.blotch(g, w, h, 6, "rgba(60,58,52,0.14)", 10, 40, RR.rng(5));
      g.fillStyle = "#615e58"; g.fillRect(0, 0, w, 4); g.fillRect(0, 0, 4, h);
      g.fillStyle = "rgba(255,255,255,0.12)"; g.fillRect(4, 4, w - 4, 3);
    });
    tex.repeat.set(2, 1);
    return new T.MeshStandardMaterial({ map: tex, roughness: 0.92 });
  }
  function zebraMat() {
    const tex = RR.canvasTex(64, 64, function (g, w, h) {
      g.clearRect(0, 0, w, h); g.fillStyle = "#e6e4dc"; g.fillRect(8, 0, 24, h);
      RR.speckle(g, w, h, 60, ["rgba(0,0,0,0.25)"], 1, 2, RR.rng(6));
    });
    tex.repeat.set(10, 1);
    return new T.MeshStandardMaterial({ map: tex, roughness: 0.8, transparent: true, alphaTest: 0.3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  }
  function vcMat(rough, metal) { return new T.MeshStandardMaterial({ vertexColors: true, roughness: rough === undefined ? 0.7 : rough, metalness: metal || 0.1, side: T.DoubleSide }); }
  const foliageMat = function () { return new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: T.DoubleSide, envMapIntensity: 0.4 }); };

  // shared scatterer: returns a helper bound to one world
  function scatterer(W, rnd, den) {
    const tr = W.track, HW = tr.halfW;
    return {
      // points beside the line, one list per call; skip anything that lands on the road
      along: function (s0, s1, step, latMin, latMax, prob, fn, margin) {
        for (let s = s0; s < s1; s += step) [-1, 1].forEach(function (sd) {
          if (rnd() > prob * den) return;
          const lat = sd * (latMin + rnd() * (latMax - latMin)), p = tr.at(s + rnd() * step, lat);
          if (Math.abs(tr.lateral(p.x, p.z, tr.nearestAny(p.x, p.z))) < HW + (margin === undefined ? 1.2 : margin)) return;
          fn(p.x, W.ground(p.x, p.z) - 0.04, p.z, rnd(), sd, s);
        });
      }
    };
  }
  function densityOf(q) { return !q ? 1 : q.name === "LOW" ? 0.3 : q.name === "MEDIUM" ? 0.65 : 1; }

  // =====================================================================
  // DOWNTOWN DROP
  // =====================================================================
  RR.DETAIL.skate = function (W, q, rnd) {
    const den = densityOf(q), tr = W.track, P = W.P, S = W.S, HW = tr.halfW, root = W.root, C = S.corners;
    const inR = function (s, r) { return s >= r[0] && s <= r[1]; };
    const nearCorner = function (s, pad) { for (let i = 0; i < C.length; i++) if (Math.abs(s - C[i]) < pad) return true; return false; };
    const isStreet = function (s) { return W.def.street(s, S) && !inR(s, S.garage) && s > 12 && s < S.prom[0] - 4; };

    // ---- paved sidewalks on both sides, a painted gutter line, zebra crossings at the corners
    const pave = pavingMat();
    let a = null;
    const runs = [];
    for (let s = 12; s <= S.prom[0]; s += 4) {
      if (isStreet(s)) { if (a === null) a = s; } else if (a !== null) { runs.push([a, s]); a = null; }
    }
    if (a !== null) runs.push([a, S.prom[0] - 4]);
    const gutter = new T.MeshStandardMaterial({ color: 0x45433f, roughness: 0.85 });
    runs.forEach(function (r) {
      [-1, 1].forEach(function (sd) {
        P.strip(r[0], r[1], sd * (HW + 3.0), 2.9, pave, 0.045, 1.45);
        P.strip(r[0], r[1], sd * (HW + 1.45), 0.5, gutter, 0.035, 4);
      });
    });
    const zebra = zebraMat();
    C.slice(0, 5).forEach(function (cs) { P.strip(cs - 14, cs - 10.5, 0, 2 * HW - 0.4, zebra, 0.05, 3.5); });

    // ---- furniture along the sidewalks
    const hyd = [], bins = [], bols = [], lampsB = [], benches = [], plant = [], racks = [], trees = [], treeG = [RR.streetTreeGeometry(21), RR.streetTreeGeometry(34)], tl = [[], []];
    for (let s = 18; s < S.prom[0] - 6; s += 15) {
      if (!isStreet(s) || nearCorner(s, 14)) continue;
      [-1, 1].forEach(function (sd) {
        const k = Math.floor(s / 15) % 6, lat = sd * (HW + 3.3);
        const p = P.at(s + (sd > 0 ? 4 : 9), lat), pl = P.at(s + 7, sd * (HW + 3.9));
        const e = [p.x, p.y, p.z, p.yaw + rnd() * 6, 1];
        if (k === 0 || k === 3) { hyd.push(e); W.obstacles.push({ x: p.x, z: p.z, r: 0.25 }); }
        else if (k === 1) { bins.push(e); W.obstacles.push({ x: p.x, z: p.z, r: 0.3 }); }
        else if (k === 2) { benches.push([p.x, p.y, p.z, pl.yaw + (sd > 0 ? Math.PI / 2 : -Math.PI / 2), 1]); W.obstacles.push({ x: p.x, z: p.z, r: 0.5 }); }
        else if (k === 4) { plant.push([p.x, p.y, p.z, p.yaw, 1]); W.obstacles.push({ x: p.x, z: p.z, r: 0.75 }); }
        else { racks.push([p.x, p.y, p.z, p.yaw + Math.PI / 2, 1]); W.obstacles.push({ x: p.x, z: p.z, r: 0.5 }); }
        // pedestrian lamps between the road lamps, bollards guarding the corners, a street tree each way
        const lp = P.at(s + 1.5, sd * (HW + 4.0)); lampsB.push([lp.x, lp.y, lp.z, lp.yaw, 1]); W.obstacles.push({ x: lp.x, z: lp.z, r: 0.25 });
        const tp = P.at(s + 11, sd * (HW + 3.7)); tl[Math.floor(rnd() * 2)].push([tp.x, tp.y - 0.05, tp.z, rnd() * 6, 0.62 + rnd() * 0.18]);
        W.obstacles.push({ x: tp.x, z: tp.z, r: 0.35 });
      });
    }
    C.slice(0, 5).forEach(function (cs) {
      for (let k = -3; k <= 3; k++) [-1, 1].forEach(function (sd) {
        if (Math.abs(k) < 2 && rnd() < 0.5) return;
        const p = P.at(cs - 17.2, sd * (HW + 1.7) - k * 0.1); bols.push([p.x, p.y, p.z, 0, 1]);
      });
    });
    const furnMat = vcMat(0.55, 0.3);
    P.instanced(RR.hydrantGeometry(), furnMat, hyd);
    P.instanced(RR.binGeometry(), furnMat, bins);
    P.instanced(RR.benchGeometry(), vcMat(0.7, 0.1), benches);
    P.instanced(RR.planterGeometry(9), vcMat(0.85, 0), plant);
    P.instanced(RR.bikeRackGeometry(), furnMat, racks);
    P.instanced(RR.bollardGeometry(), furnMat, bols);
    const pl = RR.pedLampGeometry();
    P.instanced(pl.body, vcMat(0.45, 0.6), lampsB);
    P.instanced(pl.glow, new T.MeshStandardMaterial({ vertexColors: true, emissive: 0xffc47a, emissiveIntensity: 2.6 }), lampsB, false);
    const treeMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    P.instanced(treeG[0], treeMat, tl[0]); P.instanced(treeG[1], treeMat, tl[1]);
    // storm grates and gutter debris on the road edge
    const grates = [];
    for (let s = 26; s < S.prom[0] - 10; s += 22) { if (!isStreet(s)) continue; [-1, 1].forEach(function (sd) { const p = P.at(s, sd * (HW + 0.9)); grates.push([p.x, p.y + 0.03, p.z, p.yaw, 1]); }); }
    const grateG = RR.mergeGeo([paint(new T.BoxGeometry(0.9, 0.03, 0.5), [0.1, 0.1, 0.1])].concat([0, 1, 2, 3, 4, 5].map(function (k) { return paint(new T.BoxGeometry(0.05, 0.034, 0.46).translate(-0.375 + k * 0.15, 0.002, 0), [0.28, 0.28, 0.28]); })));
    P.instanced(grateG, vcMat(0.4, 0.7), grates, false);

    // ---- the promenade and the park: more grass tufts, shrubs, rocks
    const gm = foliageMat(), grass = [RR.grassGeometry(3, [0.14, 0.24, 0.07], [0.5, 0.6, 0.24]), RR.grassGeometry(9, [0.12, 0.2, 0.06], [0.44, 0.52, 0.2], 1.4)];
    const gl = [[], []];
    const sc = scatterer(W, rnd, den);
    sc.along(S.park[0] - 4, S.park[1] + 4, 1.6, HW + 2.2, HW + 22, 0.85, function (x, y, z, r) { gl[r < 0.7 ? 0 : 1].push([x, y, z, r * 40, 0.9 + r * 0.7]); });
    sc.along(S.prom[0] - 4, tr.L + 20, 2.2, HW + 2.6, HW + 24, 0.8, function (x, y, z, r) { gl[r < 0.7 ? 0 : 1].push([x, y, z, r * 40, 0.9 + r * 0.7]); });
    P.instanced(grass[0], gm, gl[0], false); P.instanced(grass[1], gm, gl[1], false);
    const rocks = [RR.rockGeometry(3, [0.4, 0.38, 0.34]), RR.rockGeometry(8, [0.36, 0.38, 0.34])], rl = [[], []], rm = vcMat(0.95, 0);
    sc.along(S.park[0], S.park[1], 18, HW + 6, HW + 30, 0.7, function (x, y, z, r) { rl[r < 0.5 ? 0 : 1].push([x, y, z, r * 9, 0.3 + r * 0.5]); });
    sc.along(S.prom[0], tr.L, 14, HW + 3, HW + 20, 0.6, function (x, y, z, r) { rl[r < 0.5 ? 0 : 1].push([x, y, z, r * 9, 0.35 + r * 0.6]); });
    P.instanced(rocks[0], rm, rl[0]); P.instanced(rocks[1], rm, rl[1]);
    // palmettos and ferns under the promenade oaks, reeds at the bayou edge
    const fl = [], ferns = RR.fernGeometry(4), reeds = RR.reedGeometry(2), rdl = [];
    sc.along(S.prom[0], tr.L + 20, 3, HW + 3, HW + 14, 0.8, function (x, y, z, r) { fl.push([x, y, z, r * 40, 0.8 + r * 0.7]); });
    for (let s = S.prom[0] + 4; s < tr.L - 4; s += 3.2) if (rnd() < den) { const p = tr.at(s, -(HW + 2.5 + rnd() * 3.5)); rdl.push([p.x, W.ground(p.x, p.z) - 0.1, p.z, rnd() * 6, 0.9 + rnd() * 0.7]); }
    P.instanced(ferns, gm, fl, false); P.instanced(reeds, gm, rdl, false);
    // lamp posts on the bridges' undersides would be lost in the dusk: hanging work lights under each bridge
    const wl = [], wb = [];
    S.bridges.forEach(function (s, k) {
      for (let lat = -90; lat <= 90; lat += 18) { const p = tr.at(s, lat); wl.push([p.x, tr.elev(s) + 6.7 + k * 2, p.z, p.yaw, 1]); }
    });
    P.instanced(new T.SphereGeometry(0.22, 10, 8), new T.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffd9a0, emissiveIntensity: 3 }), wl, false);
    // graffiti on the bridge piers' road-side faces is left to the pillars of the channel; add warning stripes on the pier bases
    void wb;
  };

  // =====================================================================
  // BAYOU BENDS
  // =====================================================================
  RR.DETAIL.mtb = function (W, q, rnd) {
    const den = densityOf(q), tr = W.track, P = W.P, S = W.S, HW = tr.halfW;
    const inR = function (s, r) { return s >= r[0] && s <= r[1]; };
    const sc = scatterer(W, rnd, den), gm = foliageMat(), prop = vcMat(0.9, 0);
    const board = [S.board[0] - 4, S.board[1] + 4];
    const edge = function (s) { return inR(s, board) ? HW + 2.8 : HW + 1.5; };

    // ferns and palmettos under the canopy, grass tufts and clover on the edges
    const fern = [RR.fernGeometry(1), RR.fernGeometry(7, [0.1, 0.22, 0.05], [0.34, 0.5, 0.12])], fl = [[], []];
    const grass = [RR.grassGeometry(5), RR.grassGeometry(11, [0.2, 0.26, 0.08], [0.6, 0.58, 0.28], 1.3)], gl = [[], []];
    for (let s = -30; s < tr.L + 50; s += 2.2) [-1, 1].forEach(function (sd) {
      const e = edge(s), meadow = inR(s, S.meadow) || s > S.final[0] + 30;
      for (let k = 0; k < 2; k++) {
        if (rnd() > 0.8 * den) continue;
        const lat = sd * (e + Math.pow(rnd(), 1.6) * (meadow ? 14 : 9)), p = tr.at(s + rnd() * 2.2, lat);
        if (Math.abs(tr.lateral(p.x, p.z, tr.nearestAny(p.x, p.z))) < e - 0.1) continue;
        const r = rnd(), y = W.ground(p.x, p.z) - 0.05;
        if (r < (meadow ? 0.15 : 0.5)) fl[r < 0.2 ? 1 : 0].push([p.x, y, p.z, rnd() * 6, 0.7 + rnd() * 0.7]);
        else gl[rnd() < 0.7 ? 0 : 1].push([p.x, y, p.z, rnd() * 6, 0.8 + rnd() * 0.8]);
      }
    });
    fern.forEach(function (g, k) { P.instanced(g, gm, fl[k], false); });
    grass.forEach(function (g, k) { P.instanced(g, gm, gl[k], false); });

    // fallen logs, stumps, mushrooms, rocks
    const logs = [RR.logGeometry(1), RR.logGeometry(5)], ll = [[], []];
    sc.along(0, tr.L, 21, 2.4 + HW, 14 + HW, 0.55, function (x, y, z, r, sd) { ll[r < 0.5 ? 0 : 1].push([x, y + 0.12, z, r * 12, 0.8 + r * 0.7]); });
    P.instanced(logs[0], prop, ll[0]); P.instanced(logs[1], prop, ll[1]);
    const mush = RR.mushroomGeometry(3), ml = [];
    sc.along(0, tr.L, 9, HW + 1.7, HW + 9, 0.4, function (x, y, z, r) { ml.push([x, y, z, r * 20, 0.9 + r * 1.2]); });
    P.instanced(mush, vcMat(0.6, 0), ml, false);
    const rocks = [RR.rockGeometry(2, [0.34, 0.37, 0.3]), RR.rockGeometry(6, [0.42, 0.4, 0.36]), RR.rockGeometry(10, [0.3, 0.34, 0.28])], rl = [[], [], []];
    sc.along(0, tr.L, 11, HW + 1.8, HW + 18, 0.55, function (x, y, z, r) { rl[Math.floor(r * 3)].push([x, y - 0.06, z, r * 30, 0.25 + (r * 7 % 1) * 0.6]); });
    rocks.forEach(function (g, k) { P.instanced(g, vcMat(0.95, 0), rl[k]); });

    // trail signs at the section starts
    const sg = [];
    [S.meadow[1], S.oaks[0], S.roots[0], S.creek - 40, S.board[0] - 12, S.pines[0], S.drops[0] - 8, S.tables[0] - 20, S.final[0] - 6].forEach(function (s, k) {
      const p = P.at(s, (k % 2 ? 1 : -1) * (HW + 1.9)); sg.push([p.x, p.y, p.z, p.yaw + (k % 2 ? 0.2 : Math.PI - 0.2), 1.15]);
      W.obstacles.push({ x: p.x, z: p.z, r: 0.2 });
    });
    P.instanced(RR.trailSignGeometry(), vcMat(0.8, 0), sg);

    // the root garden: cypress-style knees and extra roots; the creek and swamp: reeds, knees, lily pad clusters
    const knees = [RR.kneeGeometry(2), RR.kneeGeometry(9)], kl = [[], []];
    sc.along(S.roots[0] - 20, S.roots[1] + 20, 5, HW + 1.4, HW + 12, 0.7, function (x, y, z, r) { kl[r < 0.5 ? 0 : 1].push([x, y - 0.1, z, r * 9, 0.5 + r * 0.9]); });
    sc.along(S.board[0] - 8, S.board[1] + 8, 3.2, HW + 2.9, HW + 14, 0.9, function (x, y, z, r) { kl[r < 0.5 ? 0 : 1].push([x, y - 0.12, z, r * 9, 0.6 + r * 1.2]); });
    P.instanced(knees[0], vcMat(0.9, 0), kl[0]); P.instanced(knees[1], vcMat(0.9, 0), kl[1]);
    const reeds = RR.reedGeometry(4), rl2 = [];
    sc.along(S.creek - 26, S.creek + 30, 1.5, HW + 1.2, HW + 8, 0.95, function (x, y, z, r) { rl2.push([x, y - 0.05, z, r * 20, 0.9 + r * 0.9]); }, 1.0);
    sc.along(S.board[0] - 6, S.board[1] + 6, 2.2, HW + 3.0, HW + 12, 0.9, function (x, y, z, r) { rl2.push([x, y - 0.05, z, r * 20, 0.9 + r * 0.9]); }, 1.0);
    P.instanced(reeds, gm, rl2, false);

    // wildflowers in the meadow stretches
    const flw = [], colsF = [[1, 0.85, 0.2], [0.95, 0.95, 0.95], [0.75, 0.4, 0.85], [0.95, 0.5, 0.3]];
    const flowerGeo = function (c) {
      const parts = [paint(new T.CylinderGeometry(0.008, 0.012, 0.32, 5).translate(0, 0.16, 0), [0.2, 0.4, 0.14])];
      for (let k = 0; k < 6; k++) { const pe = new T.SphereGeometry(0.034, 6, 4); pe.scale(1, 0.4, 1.7); pe.rotateY(k / 6 * Math.PI * 2); pe.translate(Math.cos(k / 6 * 6.28) * 0.04, 0.33, Math.sin(k / 6 * 6.28) * 0.04); parts.push(paint(pe, c)); }
      parts.push(paint(new T.SphereGeometry(0.02, 6, 4).translate(0, 0.335, 0), [1, 0.8, 0.1]));
      return RR.mergeGeo(parts);
    };
    const fls = colsF.map(function () { return []; });
    [[-30, S.meadow[1]], [S.final[0] + 20, tr.L + 30]].forEach(function (r) {
      sc.along(r[0], r[1], 1.4, HW + 1.6, HW + 20, 0.9, function (x, y, z, rr) { const k = Math.floor(rr * 4); fls[k].push([x, y, z, rr * 40, 0.8 + (rr * 9 % 1) * 0.8]); });
    });
    colsF.forEach(function (c, k) { P.instanced(flowerGeo(c), vcMat(0.7, 0), fls[k], false); });
  };

  // =====================================================================
  // SHIP CHANNEL SCRAMBLE
  // =====================================================================
  RR.DETAIL.moto = function (W, q, rnd) {
    const den = densityOf(q), tr = W.track, P = W.P, S = W.S, HW = tr.halfW;
    const sc = scatterer(W, rnd, den), gm = foliageMat();
    const steel = vcMat(0.5, 0.7), mat = vcMat(0.8, 0.1);

    // dry scrub and tough weeds on the edges; rocks and rubble
    const dry = [RR.grassGeometry(31, [0.28, 0.24, 0.1], [0.72, 0.62, 0.3], 0.9), RR.grassGeometry(33, [0.3, 0.3, 0.12], [0.6, 0.62, 0.3], 1.4)], dl = [[], []];
    sc.along(0, tr.L + 30, 1.8, HW + 1.6, HW + 14, 0.85, function (x, y, z, r) { dl[r < 0.65 ? 0 : 1].push([x, y, z, r * 40, 0.8 + (r * 11 % 1) * 0.9]); });
    P.instanced(dry[0], gm, dl[0], false); P.instanced(dry[1], gm, dl[1], false);
    const rocks = [RR.rockGeometry(21, [0.5, 0.45, 0.38]), RR.rockGeometry(25, [0.42, 0.4, 0.36])], rl = [[], []];
    sc.along(0, tr.L, 10, HW + 1.8, HW + 20, 0.6, function (x, y, z, r) { rl[r < 0.5 ? 0 : 1].push([x, y - 0.06, z, r * 30, 0.2 + (r * 7 % 1) * 0.55]); });
    rocks.forEach(function (g, k) { P.instanced(g, vcMat(0.95, 0), rl[k]); });

    // oil drums, pallets and tyres along the work areas
    const drum = function (col) {
      const parts = [lathe([[0.0, 0.0], [0.29, 0.0], [0.3, 0.02], [0.3, 0.88], [0.29, 0.9], [0.0, 0.9]], 18, col)];
      [0.2, 0.45, 0.7].forEach(function (y) { parts.push(paint(new T.TorusGeometry(0.3, 0.012, 5, 20).rotateX(Math.PI / 2).translate(0, y, 0), mix(col, [0, 0, 0], 0.3))); });
      parts.push(paint(new T.CylinderGeometry(0.04, 0.04, 0.03, 8).translate(0.12, 0.915, 0.05), [0.3, 0.3, 0.3]));
      return RR.mergeGeo(parts);
    };
    const drumCols = [[0.15, 0.3, 0.6], [0.7, 0.18, 0.1], [0.5, 0.28, 0.12], [0.85, 0.7, 0.12]], dr = drumCols.map(function () { return []; });
    const work = [[S.containers[0] - 40, S.containers[1] + 40], [S.refinery[0], S.refinery[1]], [S.start - 20, S.start + 60], [S.finish - 70, S.finish + 20]];
    work.forEach(function (r) {
      sc.along(r[0], r[1], 16, HW + 3.4, HW + 10, 0.8, function (x, y, z, rr, sd) {
        const n = 2 + Math.floor(rr * 4);
        for (let k = 0; k < n; k++) dr[Math.floor(((rr * 7 + k) % 1) * 4)].push([x + Math.cos(k * 2.1) * 0.7, y, z + Math.sin(k * 2.1) * 0.7, k, 1]);
        W.obstacles.push({ x: x, z: z, r: 1.0 });
      });
    });
    drumCols.forEach(function (c, k) { P.instanced(drum(c), steel, dr[k]); });
    const pallet = (function () {
      const parts = [], wood = [0.58, 0.44, 0.26];
      for (let k = 0; k < 5; k++) parts.push(paint(new T.BoxGeometry(1.2, 0.025, 0.14).translate(0, 0.15, -0.4 + k * 0.2), wood));
      [-0.5, 0, 0.5].forEach(function (x) { parts.push(paint(new T.BoxGeometry(0.1, 0.12, 1.0).translate(x, 0.075, 0), mix(wood, [0, 0, 0], 0.2))); });
      return RR.mergeGeo(parts);
    })();
    const pl = [];
    work.forEach(function (r) {
      sc.along(r[0], r[1], 14, HW + 4, HW + 11, 0.7, function (x, y, z, rr) {
        const n = 1 + Math.floor(rr * 4);
        for (let k = 0; k < n; k++) pl.push([x, y + k * 0.15, z, rr * 3 + k * 0.1, 1]);
      });
    });
    P.instanced(pallet, mat, pl);
    const tires = [];
    sc.along(S.mud[0] - 20, S.mud[1] + 40, 6, HW + 2.2, HW + 6, 0.7, function (x, y, z, r) { tires.push([x, y, z, r * 6, 1]); });
    P.instanced(RR.tireGeometry(), vcMat(0.8, 0), tires);

    // flood masts over the refinery and the container yard, marshal flags around the track
    const mast = (function () {
      const parts = [lathe([[0.0, 0], [0.4, 0], [0.4, 0.4], [0.18, 0.5], [0.14, 13.8], [0.0, 13.8]], 14, [0.42, 0.44, 0.46]), paint(new T.BoxGeometry(2.8, 0.14, 0.14).translate(0, 13.6, 0), [0.3, 0.3, 0.3])];
      return RR.mergeGeo(parts);
    })();
    const lamps = RR.mergeGeo([-1.1, 0, 1.1].map(function (x) { return paint(new T.BoxGeometry(0.7, 0.4, 0.3).translate(x, 13.4, 0.25), [1, 0.95, 0.8], false); }));
    const ms = [];
    [[S.containers[0], S.containers[1]], [S.refinery[0], S.refinery[1]]].forEach(function (r) {
      for (let s = r[0] + 20; s < r[1]; s += 70) [-1, 1].forEach(function (sd) {
        const p = tr.at(s, sd * (HW + 16)), y = W.ground(p.x, p.z) - 0.1; ms.push([p.x, y, p.z, p.yaw + (sd > 0 ? Math.PI : 0), 1]);
      });
    });
    P.instanced(mast, steel, ms);
    P.instanced(lamps, new T.MeshStandardMaterial({ vertexColors: true, emissive: 0xfff2d0, emissiveIntensity: 2.8 }), ms, false);
    const flagGeo = (function (c) {
      const parts = [paint(RR.tube([0, 0, 0], [0, 3.4, 0], 0.03, 0.025, 7), [0.8, 0.8, 0.78])];
      const pl2 = new T.PlaneGeometry(0.9, 0.6, 5, 3), p = pl2.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i) + 0.45; p.setZ(i, Math.sin(x * 5) * 0.07 * x); p.setY(i, p.getY(i) + 3.0); p.setX(i, x + 0.03); }
      pl2.computeVertexNormals();
      return { pole: RR.mergeGeo(parts), flag: pl2 };
    })();
    const fcols = [[0.95, 0.8, 0.1], [0.85, 0.15, 0.1], [0.15, 0.6, 0.25]], fls = fcols.map(function () { return []; });
    for (let s = 60; s < tr.L - 30; s += 85) { const sd = Math.floor(s / 85) % 2 ? 1 : -1, p = P.at(s, sd * (HW + 2.2)), k = Math.floor(s / 85) % 3; fls[k].push([p.x, p.y, p.z, p.yaw, 1]); }
    P.instanced(flagGeo.pole, mat, [].concat.apply([], fls), false);
    fcols.forEach(function (c, k) { P.instanced(flagGeo.flag, new T.MeshStandardMaterial({ color: new T.Color(c[0], c[1], c[2]), roughness: 0.7, side: T.DoubleSide }), fls[k], false); });
  };

  // container hardware: corner castings, door locking bars and handles (called by dress-channel)
  RR.DETAIL.containers = function (W, list) {
    if (!list.length) return;
    const dark = [0.12, 0.12, 0.13], steel = [0.55, 0.57, 0.6], parts = [];
    [-1, 1].forEach(function (sx) {
      [-1, 1].forEach(function (sz) {
        [0, 1].forEach(function (y) {
          parts.push(paint(new T.BoxGeometry(0.2, 0.18, 0.2).translate(sx * 1.2, y ? 2.5 : 0.09, sz * 6.0), dark));
        });
      });
    });
    [-0.8, -0.3, 0.3, 0.8].forEach(function (x) {
      parts.push(paint(new T.CylinderGeometry(0.022, 0.022, 2.35, 8).translate(x, 1.3, 6.13), steel));
      parts.push(paint(new T.BoxGeometry(0.1, 0.05, 0.07).translate(x, 0.55, 6.15), dark));
      parts.push(paint(new T.BoxGeometry(0.1, 0.05, 0.07).translate(x, 1.45, 6.15), dark));
      parts.push(paint(new T.BoxGeometry(0.16, 0.04, 0.05).translate(x, 2.4, 6.15), dark));
      parts.push(paint(new T.BoxGeometry(0.16, 0.04, 0.05).translate(x, 0.2, 6.15), dark));
    });
    parts.push(paint(new T.BoxGeometry(0.06, 2.4, 0.04).translate(0, 1.3, 6.13), dark));
    parts.push(paint(new T.BoxGeometry(2.3, 0.07, 0.07).translate(0, 2.52, 6.09), dark));
    parts.push(paint(new T.BoxGeometry(2.3, 0.07, 0.07).translate(0, 0.07, 6.09), dark));
    // a roof-side rail running the length, and fork pockets
    [-1, 1].forEach(function (sx) {
      parts.push(paint(new T.BoxGeometry(0.1, 0.1, 12.0).translate(sx * 1.2, 2.55, 0), dark));
      parts.push(paint(new T.BoxGeometry(0.1, 0.1, 12.0).translate(sx * 1.2, 0.05, 0), dark));
    });
    W.P.instanced(RR.mergeGeo(parts), vcMat(0.6, 0.5), list);
  };
})(window.RR = window.RR || {});
