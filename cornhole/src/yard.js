// The backyard dressing: a grill and smoke, a patio set under an umbrella, a fire pit with chairs, a garden shed, an arbor
// with roses, planter beds, hedges, gnomes, flamingos, tiki torches, bunting, a bird bath, a wheelbarrow, stepping
// stones, snacks on the picnic table on turf.
// Everything is generated here (no files). The static parts are merged into four chunks by quarter of the yard, with
// vertex colours, so the camera can skip the chunks it isn't facing and the whole yard is a handful of draw calls.
// `detail` (0 low, 1 medium, 2 high) scales how finely round things are cut and how many plants there are.
(function (SB) {
  "use strict";
  const T = globalThis.THREE;
  const Y = {};
  const TAU = Math.PI * 2;

  Y.build = function (scene, detail, FX, FZ) {
    detail = detail === undefined ? 1 : detail;
    const K = [0.55, 1, 1.5][detail];
    const seg = (n) => Math.max(6, Math.round(n * K));
    const rnd = SB.Cornhole.rngOf(7771);
    const buckets = [[], [], [], []];
    const keep = [];                                  // [x, z, r] circles the plants stay out of
    const col = new T.Color(), q = new T.Quaternion(), eu = new T.Euler(), m4 = new T.Matrix4();
    const v3 = new T.Vector3(), s3 = new T.Vector3();
    let tris = 0, lab = "misc";
    const byLab = {};

    // Add a geometry to the yard: colour, position, rotation, scale. grad > 0 darkens it towards its bottom.
    function P(geo, hex, o) {
      o = o || {};
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      g.deleteAttribute("uv");
      g.computeBoundingBox();
      const y0 = g.boundingBox.min.y, ys = Math.max(1e-6, g.boundingBox.max.y - y0);
      const sx = o.sx !== undefined ? o.sx : o.s !== undefined ? o.s : 1;
      const sy = o.sy !== undefined ? o.sy : o.s !== undefined ? o.s : 1;
      const sz = o.sz !== undefined ? o.sz : o.s !== undefined ? o.s : 1;
      eu.set(o.rx || 0, o.ry || 0, o.rz || 0, "YXZ"); q.setFromEuler(eu);
      m4.compose(v3.set(o.x || 0, o.y || 0, o.z || 0), q, s3.set(sx, sy, sz));
      const pos = g.attributes.position, c = new Float32Array(pos.count * 3);
      const j = 1 + (rnd() - 0.5) * (o.jit !== undefined ? o.jit : 0.1);
      col.set(hex);
      for (let i = 0; i < pos.count; i++) {
        const t = o.grad ? 1 - o.grad * (1 - (pos.getY(i) - y0) / ys) : 1;
        c[i * 3] = col.r * j * t; c[i * 3 + 1] = col.g * j * t; c[i * 3 + 2] = col.b * j * t;
      }
      g.setAttribute("color", new T.BufferAttribute(c, 3));
      g.applyMatrix4(m4);
      tris += pos.count / 3; byLab[lab] = (byLab[lab] || 0) + pos.count / 3;
      buckets[((o.x || 0) < 0 ? 0 : 1) + ((o.z || 0) < 0 ? 0 : 2)].push(g);
    }
    // a part placed relative to a group that sits at (gx, gy, gz) turned by yaw
    function G(gx, gy, gz, yaw) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      return function (geo, hex, o) {
        o = Object.assign({}, o || {});
        const lx = o.x || 0, lz = o.z || 0;
        o.x = gx + lx * c + lz * s; o.z = gz - lx * s + lz * c; o.y = gy + (o.y || 0); o.ry = (o.ry || 0) + yaw;
        P(geo, hex, o);
      };
    }
    const cyl = (r0, r1, h, n) => new T.CylinderGeometry(r0, r1, h, n === undefined ? seg(16) : Math.max(6, n));
    const sph = (r, w, h) => new T.SphereGeometry(r, seg(w || 20), seg(h || 14));
    const box = (x, y, z) => new T.BoxGeometry(x, y, z);

    // ---------------------------------------------------------------- shared pieces
    function chair(add, x, z, ry, hex) {                               // a simple patio chair
      const g = G(x, 0, z, ry);
      g(box(0.5, 0.05, 0.5), hex, { y: 0.45 });
      g(box(0.5, 0.5, 0.045), hex, { y: 0.72, z: -0.24, rx: -0.12 });
      [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]].forEach((l) => g(cyl(0.022, 0.018, 0.45, 8), 0x4a4a4a, { x: l[0], z: l[1], y: 0.225 }));
    }
    function adirondack(x, z, ry, hex) {
      const g = G(x, 0, z, ry);
      for (let i = 0; i < 7; i++) g(box(0.075, 0.9, 0.025), hex, { x: -0.3 + i * 0.1, y: 0.62, z: -0.28, rx: -0.35 });       // fan back slats
      for (let i = 0; i < 6; i++) g(box(0.6, 0.025, 0.075), hex, { y: 0.34 - i * 0.004, z: -0.2 + i * 0.11, rx: 0.1 });       // seat slats
      [-1, 1].forEach((s) => { g(box(0.06, 0.03, 0.6), hex, { x: s * 0.34, y: 0.55, z: 0 }); g(box(0.05, 0.4, 0.05), hex, { x: s * 0.34, y: 0.35, z: 0.2 }); g(box(0.05, 0.4, 0.05), hex, { x: s * 0.3, y: 0.2, z: -0.25 }); });
    }
    // bushes: a displaced icosphere, three variants
    const bushGeos = [11, 12, 13].map(function (sd) {
      const g = new T.IcosahedronGeometry(1, detail === 0 ? 2 : 3), p = g.attributes.position, r = SB.Cornhole.rngOf(sd), ph = [r() * 6, r() * 6, r() * 6];
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const n = (Math.sin(x * 4.1 + ph[0] + y * 2.3) + Math.sin(z * 5.7 + ph[1] - x * 1.9) + Math.sin(y * 6.1 + ph[2] + z * 3.3)) / 3;
        const f = 1 + n * 0.2;
        p.setXYZ(i, x * f, y * f * 0.8, z * f);
      }
      g.computeVertexNormals();
      return g;
    });
    function bush(x, z, s) {
      const gr = [0x2f6f34, 0x3a7d3a, 0x2b6430][Math.floor(rnd() * 3)];
      P(bushGeos[Math.floor(rnd() * 3)], gr, { x: x, y: 0.55 * s, z: z, s: s, ry: rnd() * TAU, grad: 0.55, jit: 0.16 });
    }
    // flowers: stem + head + ring of petals
    const FLOWER = [0xff5d73, 0xffd23f, 0xffffff, 0xc77dff, 0xff9f43, 0x6cc4ff];
    const stemG = new T.CylinderGeometry(0.008, 0.01, 1, 5, 1, true), headG = new T.IcosahedronGeometry(0.03, detail >= 2 ? 1 : 0);
    const petalG = new T.ConeGeometry(0.028, 0.055, 5).rotateX(Math.PI / 2).translate(0, 0, 0.04);
    const blobG = new T.IcosahedronGeometry(1, 1);                                          // leaves, rose buds: 80 faces each
    function flower(x, y, z, h, hex) {
      P(stemG, 0x3c8a3c, { x: x, y: y + h / 2, z: z, sy: h });
      const top = y + h, np = detail === 0 ? 4 : 5;
      for (let i = 0; i < np; i++) P(petalG, hex, { x: x, y: top, z: z, ry: (i / np) * TAU, rx: 0.5, jit: 0.15 });
      P(headG, 0xffcf40, { x: x, y: top + 0.012, z: z, jit: 0.1 });
    }
    function planter(x, z, ry, len, nFlowers) {
      const g = G(x, 0, z, ry), wood = 0x8a5a33;
      g(box(len, 0.34, 0.06), wood, { y: 0.17, z: 0.3 }); g(box(len, 0.34, 0.06), wood, { y: 0.17, z: -0.3 });
      g(box(0.06, 0.34, 0.66), wood, { x: len / 2, y: 0.17 }); g(box(0.06, 0.34, 0.66), wood, { x: -len / 2, y: 0.17 });
      g(box(len - 0.06, 0.28, 0.56), 0x3a2a1c, { y: 0.15 });
      for (let i = 0; i < nFlowers; i++) {
        const lx = (rnd() - 0.5) * (len - 0.2), lz = (rnd() - 0.5) * 0.46, h = 0.14 + rnd() * 0.3;
        const c = Math.cos(ry), s = Math.sin(ry);
        flower(x + lx * c + lz * s, 0.28, z - lx * s + lz * c, h, FLOWER[Math.floor(rnd() * FLOWER.length)]);
        if (i % 2 === 0) { const px = x + (lx + 0.05) * c + lz * s, pz = z - (lx + 0.05) * s + lz * c; P(blobG, 0x3f9440, { x: px, y: 0.3, z: pz, sx: 0.07, sy: 0.04, sz: 0.07 }); }
      }
      keep.push([x, z, len / 2 + 0.5]);
    }

    // ---------------------------------------------------------------- the grill and its smoke
    lab = "grill";
    const GR = { x: -7.3, z: -8.4, ry: 0.7 };
    {
      const g = G(GR.x, 0, GR.z, GR.ry);
      g(new T.SphereGeometry(0.34, seg(36), seg(20), 0, TAU, Math.PI / 2, Math.PI / 2), 0x1d1d20, { y: 0.98 });                // bowl (lower half)
      g(new T.SphereGeometry(0.345, seg(36), seg(20), 0, TAU, 0, Math.PI / 2), 0x8e1b1b, { y: 0.98, ry: 0.4 });               // lid
      g(new T.TorusGeometry(0.345, 0.014, 8, seg(40)).rotateX(Math.PI / 2), 0x2a2a2a, { y: 0.98 });
      g(new T.TorusGeometry(0.1, 0.012, 8, 20), 0x303030, { y: 1.28, z: 0.2, rx: 0.2 });                                          // handle
      g(cyl(0.035, 0.035, 0.03, 12), 0xb0b0b0, { y: 1.32, z: -0.1 });                                                              // vent
      for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + 0.5; g(cyl(0.016, 0.016, 0.7, 8), 0x303030, { x: Math.cos(a) * 0.24, z: Math.sin(a) * 0.24, y: 0.38, rz: Math.cos(a) * 0.13, rx: -Math.sin(a) * 0.13 }); }
      g(cyl(0.2, 0.2, 0.02, seg(24)), 0x303030, { y: 0.3 });                                                                       // ash catcher
      g(cyl(0.055, 0.055, 0.03, 16), 0x202020, { x: 0.3, z: 0.1, y: 0.06, rz: Math.PI / 2 });                                      // wheel
      g(box(0.8, 0.05, 0.45), 0x8a5a33, { x: 0.85, y: 0.8, z: 0.05 });                                                             // side table
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach((l) => g(cyl(0.02, 0.02, 0.8, 8), 0x303030, { x: 0.85 + l[0] * 0.36, z: 0.05 + l[1] * 0.2, y: 0.4 }));
      g(box(0.3, 0.025, 0.2), 0xe8e8e8, { x: 0.7, y: 0.84, z: 0.05 });                                                             // platter
      for (let i = 0; i < 5; i++) g(cyl(0.022, 0.022, 0.16, 8), 0xb5532d, { x: 0.62 + i * 0.04, y: 0.86, z: 0.05, rz: Math.PI / 2, ry: 0.2 });   // hot dogs
      g(cyl(0.05, 0.04, 0.12, 12), 0xd94a2e, { x: 1.1, y: 0.9, z: 0.15 });                                                         // ketchup
      g(cyl(0.05, 0.04, 0.12, 12), 0xe9c628, { x: 1.2, y: 0.9, z: 0.0 });                                                          // mustard
      keep.push([GR.x + 0.5, GR.z, 1.9]);
    }

    // ---------------------------------------------------------------- patio set under an umbrella
    lab = "patio";
    const PT = { x: -7.8, z: 8.2 };
    {
      for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {                                // flagstone patio, slightly uneven
        const dx = i * 0.62 + (rnd() - 0.5) * 0.04, dz = j * 0.62 + (rnd() - 0.5) * 0.04;
        P(box(0.58, 0.035, 0.58), [0xa9a49a, 0x9a958c, 0xb4afa4][(i + j + 6) % 3], { x: PT.x + dx, y: 0.017, z: PT.z + dz, ry: (rnd() - 0.5) * 0.06, jit: 0.1 });
      }
      const g = G(PT.x, 0.035, PT.z, 0);
      g(cyl(0.62, 0.62, 0.04, seg(40)), 0xf1ece0, { y: 0.74 });                                      // table top
      g(cyl(0.6, 0.6, 0.012, seg(40)), 0x6b8fb5, { y: 0.765 });                                       // cloth
      g(cyl(0.045, 0.06, 0.74, 14), 0x3d3d3d, { y: 0.37 }); g(cyl(0.3, 0.34, 0.03, 24), 0x3d3d3d, { y: 0.015 });
      g(cyl(0.025, 0.025, 2.35, 10), 0xdedede, { y: 1.17 });                                          // umbrella pole
      // canopy: a ribbed cone, red and white gores
      const canopy = new T.ConeGeometry(1.75, 0.55, seg(48), 6, true);
      const gores = 12;
      canopy.deleteAttribute("uv");
      P(canopy, 0xffffff, { x: PT.x, y: 2.58, z: PT.z, jit: 0 });
      // (colour the canopy's gores after the fact: the last pushed geometry is ours)
      const last = buckets[(PT.x < 0 ? 0 : 1) + (PT.z < 0 ? 0 : 2)].slice(-1)[0], lp = last.attributes.position, lc = last.attributes.color;
      for (let i = 0; i < lp.count; i++) {
        const a = Math.atan2(lp.getZ(i) - PT.z, lp.getX(i) - PT.x), gi = Math.floor(((a + Math.PI) / TAU) * gores);
        col.set(gi % 2 ? 0xd93b3b : 0xf7f1e6); lc.setXYZ(i, col.r, col.g, col.b);
      }
      for (let i = 0; i < gores; i++) { const a = i / gores * TAU; g(cyl(0.01, 0.01, 1.85, 6), 0xcfcfcf, { x: Math.cos(a) * 0.82, z: Math.sin(a) * 0.82, y: 2.38, rz: Math.cos(a) * 0.95, rx: -Math.sin(a) * 0.95 }); }
      g(sph(0.05, 10, 8), 0xdedede, { y: 2.88 });
      [0, 1, 2, 3].forEach((i) => { const a = i / 4 * TAU + 0.4; chair(g, PT.x + Math.cos(a) * 1.15, PT.z + Math.sin(a) * 1.15, -a + Math.PI / 2, [0xe8c14b, 0xe3e3e3, 0xe8c14b, 0xe3e3e3][i]); });
      g(cyl(0.035, 0.03, 0.11, 14), 0xf6f6f6, { x: 0.18, y: 0.82, z: 0.12 }); g(cyl(0.035, 0.03, 0.11, 14), 0xf6f6f6, { x: -0.2, y: 0.82, z: -0.1 });   // glasses
      g(new T.LatheGeometry([[0.001, 0], [0.12, 0.01], [0.17, 0.07], [0.19, 0.08]].map((p) => new T.Vector2(p[0], p[1])), seg(24)), 0xe85d4a, { x: -0.05, y: 0.77, z: 0.2 });   // bowl
      keep.push([PT.x, PT.z, 3.2]);
    }

    // ---------------------------------------------------------------- fire pit with two Adirondack chairs
    lab = "firepit";
    const FP = { x: 7.7, z: -8.5 };
    {
      P(cyl(0.9, 0.95, 0.04, seg(32)), 0x777067, { x: FP.x, y: 0.02, z: FP.z });
      const nst = 14;
      for (let i = 0; i < nst; i++) {
        const a = i / nst * TAU;
        for (let l = 0; l < 2; l++) P(new T.IcosahedronGeometry(1, 2), [0x8a867e, 0x6f6b64, 0x9c978d][(i + l) % 3], { x: FP.x + Math.cos(a) * 0.62, z: FP.z + Math.sin(a) * 0.62, y: 0.09 + l * 0.14, sx: 0.17, sy: 0.1, sz: 0.14, ry: a + l, jit: 0.2 });
      }
      P(cyl(0.5, 0.5, 0.03, seg(24)), 0x2a2623, { x: FP.x, y: 0.06, z: FP.z });
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI; P(cyl(0.055, 0.06, 0.75, 12), i % 2 ? 0x5a3a22 : 0x6a4529, { x: FP.x, y: 0.2 + (i % 3) * 0.06, z: FP.z, rz: Math.PI / 2 - 0.15, ry: a }); }
      adirondack(FP.x - 1.6, FP.z + 0.6, Math.PI / 2 + 0.35, 0x4a7ba6);
      adirondack(FP.x + 0.2, FP.z + 1.7, Math.PI + 0.25, 0xc0463d);
      keep.push([FP.x, FP.z, 2.8]);
    }

    // ---------------------------------------------------------------- garden shed
    lab = "shed";
    {
      const g = G(5.3, 0, -13.7, 0), wall = 0xb8453a, trim = 0xf2eee4;
      for (let i = 0; i < 22; i++) { g(box(0.145, 2.3, 0.05), wall, { x: -1.5 + i * 0.1363, y: 1.15, z: 1.05, jit: 0.07 }); }          // front planks
      for (let i = 0; i < 22; i++) g(box(0.145, 2.3, 0.05), wall, { x: -1.5 + i * 0.1363, y: 1.15, z: -1.05, jit: 0.07 });
      for (let i = 0; i < 16; i++) { g(box(0.05, 2.3, 0.145), wall, { x: -1.5, y: 1.15, z: -1.0 + i * 0.133, jit: 0.07 }); g(box(0.05, 2.3, 0.145), wall, { x: 1.5, y: 1.15, z: -1.0 + i * 0.133, jit: 0.07 }); }
      g(box(3.1, 0.12, 2.2), 0x6b4a2b, { y: 0.06 });
      [-1, 1].forEach((s) => g(box(3.4, 0.07, 1.4), 0x4a4540, { y: 2.55, z: s * 0.62, rx: s * 0.42 }));                                  // roof
      g(box(3.4, 0.09, 0.16), trim, { y: 2.95 });
      g(box(0.85, 1.85, 0.07), trim, { x: -0.5, y: 0.98, z: 1.1 }); g(box(0.7, 1.7, 0.04), 0x2f5d8a, { x: -0.5, y: 0.98, z: 1.14 });      // door
      g(sph(0.035, 10, 8), 0xd6b25e, { x: -0.2, y: 0.95, z: 1.2 });
      g(box(0.8, 0.7, 0.05), trim, { x: 0.85, y: 1.35, z: 1.1 }); g(box(0.68, 0.58, 0.03), 0x1b2a3a, { x: 0.85, y: 1.35, z: 1.13 });      // window
      g(box(0.03, 0.58, 0.04), trim, { x: 0.85, y: 1.35, z: 1.15 }); g(box(0.68, 0.03, 0.04), trim, { x: 0.85, y: 1.35, z: 1.15 });
      g(box(0.9, 0.16, 0.2), 0x8a5a33, { x: 0.85, y: 0.95, z: 1.22 });
      for (let i = 0; i < 9; i++) flower(5.3 + 0.85 - 0.36 + i * 0.09, 1.03, -13.7 + 1.22, 0.1 + rnd() * 0.12, FLOWER[i % FLOWER.length]);
      g(cyl(0.2, 0.17, 0.3, 16), 0x9b5b36, { x: 1.9, y: 0.15, z: 1.2 }); g(sph(0.22, 14, 10), 0x3f9440, { x: 1.9, y: 0.4, z: 1.2 });          // pot
      g(cyl(0.22, 0.2, 0.55, 14), 0x5a5a5e, { x: -1.95, y: 0.28, z: 0.9 }); g(cyl(0.225, 0.225, 0.03, 14), 0x6a6a70, { x: -1.95, y: 0.57, z: 0.9 });   // bin
      keep.push([5.3, -13.7, 3]);
    }

    // ---------------------------------------------------------------- arbor with climbing roses, and a bench
    lab = "arbor";
    {
      const AX = -4.6, AZ = 13.6, g = G(AX, 0, AZ, Math.PI), wood = 0xf2eee4;
      [-1, 1].forEach((s) => { g(box(0.12, 2.5, 0.12), wood, { x: s * 1.05, y: 1.25, z: 0.35 }); g(box(0.12, 2.5, 0.12), wood, { x: s * 1.05, y: 1.25, z: -0.35 }); });
      const arch = new T.TorusGeometry(1.05, 0.055, 10, seg(36), Math.PI).rotateX(0);
      g(arch, wood, { y: 2.5, z: 0.35 }); g(arch, wood, { y: 2.5, z: -0.35 });
      for (let i = 0; i < 6; i++) g(box(0.08, 0.08, 0.8), wood, { x: Math.cos((i + 0.5) / 6 * Math.PI) * 1.05, y: 2.5 + Math.sin((i + 0.5) / 6 * Math.PI) * 1.05, z: 0, ry: 0, rz: (i + 0.5) / 6 * Math.PI - Math.PI / 2 });
      [-1, 1].forEach((s) => { for (let i = 0; i < 6; i++) { g(box(0.025, 0.9, 0.025), wood, { x: s * 1.05, y: 0.5 + i * 0.3, z: 0.0, rx: 0.6 }); g(box(0.025, 0.9, 0.025), wood, { x: s * 1.05, y: 0.5 + i * 0.3, z: 0.0, rx: -0.6 }); } });
      const nr = detail === 0 ? 40 : detail === 1 ? 80 : 120;                                       // roses and leaves climbing the arch and posts
      for (let i = 0; i < nr; i++) {
        const t = rnd(), onArch = rnd() < 0.55, a = t * Math.PI, side = rnd() < 0.5 ? -1 : 1;
        const px = onArch ? Math.cos(a) * 1.05 : side * 1.05, py = onArch ? 2.5 + Math.sin(a) * 1.05 : 0.2 + rnd() * 2.3, pz = (rnd() - 0.5) * 0.7;
        const ls = 0.07 + rnd() * 0.04;
        g(blobG, 0x3a8a3c, { x: px, y: py, z: pz, sx: ls, sy: ls * 0.7, sz: ls, jit: 0.2 });
        if (rnd() < 0.5) g(blobG, [0xd7263d, 0xff6b81, 0xf4a6b8][i % 3], { x: px + (rnd() - 0.5) * 0.06, y: py + 0.03, z: pz + 0.07, s: 0.05 });
      }
      const gb = G(AX, 0, AZ - 0.1, Math.PI);                                                      // bench under the arbor
      for (let i = 0; i < 5; i++) gb(box(1.4, 0.03, 0.07), 0x9a6a3c, { y: 0.45, z: -0.12 + i * 0.075 });
      for (let i = 0; i < 4; i++) gb(box(1.4, 0.07, 0.025), 0x9a6a3c, { y: 0.62 + i * 0.1, z: -0.24, rx: -0.15 });
      [-0.6, 0.6].forEach((x) => { gb(box(0.05, 0.45, 0.4), 0x4a4a4a, { x: x, y: 0.225 }); gb(box(0.05, 0.5, 0.05), 0x4a4a4a, { x: x, y: 0.7, z: -0.25, rx: -0.15 }); });
      keep.push([AX, AZ, 2.2]);
    }

    // ---------------------------------------------------------------- planter beds
    lab = "planters";
    planter(-8.0, -14.4, 0, 3.4, Math.round(60 * K)); planter(-3.2, -14.4, 0, 2.4, Math.round(45 * K));
    planter(-1.0, 14.4, Math.PI, 2.8, Math.round(50 * K)); planter(2.2, 14.4, Math.PI, 3.0, Math.round(55 * K)); planter(8.2, 14.4, Math.PI, 3.4, Math.round(60 * K));
    planter(-10.4, -11.0, Math.PI / 2, 3.0, Math.round(50 * K)); planter(10.4, 10.6, Math.PI / 2, 3.2, Math.round(55 * K)); planter(10.4, -1.0, Math.PI / 2, 2.6, Math.round(45 * K));

    // ---------------------------------------------------------------- small things: gnomes, flamingos, bird bath, wheelbarrow
    lab = "small";
    function gnome(x, z, ry) {
      const g = G(x, 0, z, ry);
      g(cyl(0.1, 0.12, 0.28, 18), 0x3b6ea8, { y: 0.2 });                       // coat
      g(sph(0.115, 18, 12), 0x3b6ea8, { y: 0.34, sy: 0.9 });
      g(box(0.24, 0.025, 0.24), 0x2a2a2a, { y: 0.24 });                          // belt
      g(sph(0.065, 14, 10), 0xf1c9a5, { y: 0.5, z: 0.01 });                      // face
      g(sph(0.014, 8, 6), 0xe08a7c, { y: 0.5, z: 0.075 });                       // nose
      g(new T.ConeGeometry(0.075, 0.16, 16), 0xffffff, { y: 0.4, z: 0.065, rx: Math.PI });   // beard
      g(new T.ConeGeometry(0.085, 0.3, 20), 0xd23a3a, { y: 0.68 });              // hat
      g(sph(0.02, 8, 6), 0xffffff, { y: 0.84 });
      [-1, 1].forEach((s) => g(box(0.07, 0.05, 0.12), 0x3a2a1a, { x: s * 0.05, y: 0.03, z: 0.03 }));
      keep.push([x, z, 0.8]);
    }
    function flamingo(x, z, ry, s) {
      const g = G(x, 0, z, ry);
      [[-0.03, 0.4], [0.03, 0]].forEach((l, i) => g(cyl(0.007, 0.007, 0.5 + (i ? 0 : 0.0), 6), 0xe86a8c, { x: l[0] * 1.2, y: 0.25, z: l[1] * 0 }));
      g(sph(0.12, 18, 12), 0xf4779a, { y: 0.56, sz: 1.5, sy: 0.85 });
      const curve = new T.CatmullRomCurve3([new T.Vector3(0, 0.58, 0.14), new T.Vector3(0, 0.78, 0.22), new T.Vector3(0, 0.98, 0.1), new T.Vector3(0, 1.06, 0.18), new T.Vector3(0, 1.0, 0.28)]);
      g(new T.TubeGeometry(curve, seg(24), 0.024, 8), 0xf4779a, {});
      g(sph(0.04, 12, 8), 0xf4779a, { y: 1.0, z: 0.3 });
      g(new T.ConeGeometry(0.02, 0.1, 8), 0x2a2a2a, { y: 0.98, z: 0.37, rx: Math.PI / 2 + 0.3 });
      keep.push([x, z, 0.7]);
    }
    gnome(-3.4, -11.6, 0.4); gnome(3.0, 12.2, 3.6); gnome(10.4, -3.2, 2.2); gnome(-10.2, 8.8, 1.0);
    flamingo(-10.6, 2.4, 1.2); flamingo(-10.2, 2.9, 0.7); flamingo(-10.7, 3.3, 1.5); flamingo(9.9, 8.6, 4.2); flamingo(10.3, 9.6, 3.8);
    {                                                                                                                  // bird bath
      const bb = [[0.001, 0], [0.18, 0.02], [0.16, 0.05], [0.07, 0.12], [0.06, 0.6], [0.09, 0.7], [0.3, 0.76], [0.34, 0.82], [0.3, 0.86], [0.26, 0.82], [0.001, 0.8]];
      P(new T.LatheGeometry(bb.map((p) => new T.Vector2(p[0], p[1])), seg(32)), 0xb9b4a8, { x: 10.0, z: -9.3, grad: 0.3 });
      P(cyl(0.255, 0.255, 0.01, seg(24)), 0x6fb6d8, { x: 10.0, y: 0.8, z: -9.3 });
      keep.push([10.0, -9.3, 1]);
    }
    {                                                                                                                  // wheelbarrow with flowers
      const g = G(-10.2, 0, -8.4, 0.5);
      g(box(0.62, 0.22, 0.95), 0x2f6b4f, { y: 0.42, rx: 0.12 }); g(box(0.5, 0.26, 0.82), 0x3a2a1c, { y: 0.5, rx: 0.12 });
      g(new T.TorusGeometry(0.2, 0.05, 10, seg(28)), 0x222222, { y: 0.2, z: 0.62, ry: Math.PI / 2 }); g(cyl(0.05, 0.05, 0.1, 10), 0xaaaaaa, { y: 0.2, z: 0.62, rz: Math.PI / 2 });
      [-1, 1].forEach((s) => { g(cyl(0.022, 0.022, 1.15, 8), 0xa5703a, { x: s * 0.26, y: 0.52, z: -0.4, rx: Math.PI / 2 - 0.12 }); g(cyl(0.02, 0.02, 0.4, 8), 0x303030, { x: s * 0.27, y: 0.2, z: -0.5, rz: 0 }); });
      for (let i = 0; i < Math.round(14 * K); i++) { const fx = (rnd() - 0.5) * 0.4, fz = (rnd() - 0.5) * 0.7, c = Math.cos(0.5), s = Math.sin(0.5); flower(-10.2 + fx * c + fz * s, 0.58, -8.4 - fx * s + fz * c, 0.15 + rnd() * 0.15, FLOWER[Math.floor(rnd() * FLOWER.length)]); }
      keep.push([-10.2, -8.4, 1.2]);
    }

    // ---------------------------------------------------------------- snacks on the picnic table (table at -8.2, -1.5, turned 0.35)
    lab = "snacks";
    {
      const g = G(-8.2, 0.79, -1.5, 0.35);
      const mel = new T.SphereGeometry(0.17, seg(32), seg(22));
      P(mel, 0x2f7d3a, { x: -8.2 + 0.3 * Math.cos(0.35), y: 0.79 + 0.16, z: -1.5 - 0.3 * Math.sin(0.35), sy: 0.85, sz: 1.15, ry: 0.35, grad: 0.0 });
      const mp = buckets[0].slice(-1)[0], mpos = mp.attributes.position, mcol = mp.attributes.color;   // dark stripes on the rind
      for (let i = 0; i < mpos.count; i++) { const a = Math.atan2(mpos.getX(i) + 8.2 - 0.3 * Math.cos(0.35), mpos.getZ(i) + 1.5 + 0.3 * Math.sin(0.35)); if (Math.sin(a * 7) > 0.3) mcol.setXYZ(i, 0.01, 0.12, 0.03); }
      g(new T.LatheGeometry([[0.001, 0], [0.1, 0.01], [0.14, 0.09], [0.15, 0.1]].map((p) => new T.Vector2(p[0], p[1])), seg(24)), 0xf2b134, { x: -0.25, z: 0.2 });   // chips bowl
      g(sph(0.11, 14, 8), 0xe8a82a, { x: -0.25, y: 0.08, z: 0.2, sy: 0.5 });
      for (let i = 0; i < 6; i++) g(cyl(0.18, 0.18, 0.006, seg(24)), i % 2 ? 0xf6f6f6 : 0xe34a4a, { x: -0.7 + i * 0.32, y: 0.004, z: -0.3 });
      for (let i = 0; i < 5; i++) g(new T.CylinderGeometry(0.045, 0.032, 0.11, seg(16)), [0xe34a4a, 0x2f6fd0, 0xe34a4a, 0xf2c230, 0x2f6fd0][i], { x: -0.6 + i * 0.28, y: 0.055, z: 0.05 + (i % 2) * 0.2 });
      g(box(0.28, 0.14, 0.16), 0x6b6b72, { x: 0.8, y: 0.07, z: 0.15 }); g(cyl(0.05, 0.05, 0.01, 16), 0x2a2a2a, { x: 0.72, y: 0.145, z: 0.15 }); g(cyl(0.05, 0.05, 0.01, 16), 0x2a2a2a, { x: 0.88, y: 0.145, z: 0.15 });   // speaker
      keep.push([-8.2, -1.5, 1.5]);
    }
    {                                                                                                                  // the cooler's twin and a stack of bag buckets near the lane
      P(box(0.5, 0.32, 0.34), 0x2f6fd0, { x: -3.2, y: 0.16, z: 2.4, ry: 0.4 }); P(box(0.52, 0.05, 0.36), 0xf4f4f4, { x: -3.2, y: 0.345, z: 2.4, ry: 0.4 });
    }

    // ---------------------------------------------------------------- tiki torches and stepping stones
    lab = "torches";
    const flames = [];
    const torch = (x, z) => {
      P(cyl(0.025, 0.03, 1.85, 10), 0x9a7a45, { x: x, y: 0.925, z: z });
      for (let i = 0; i < 5; i++) P(cyl(0.032, 0.032, 0.02, 10), 0x6b4f28, { x: x, y: 0.2 + i * 0.35, z: z });
      P(new T.CylinderGeometry(0.075, 0.045, 0.1, 14, 1, true), 0x4a4a4a, { x: x, y: 1.88, z: z });
      P(cyl(0.012, 0.012, 0.06, 6), 0x2a2a2a, { x: x, y: 1.93, z: z });
      flames.push({ x: x, y: 2.0, z: z, s: 0.08, ph: rnd() * 6 });
      keep.push([x, z, 0.4]);
    };
    [[-3.8, -13.2], [3.0, -13.0], [-2.2, 13.1], [3.0, 13.0], [-10.6, 0.8], [-10.6, -4.2], [10.6, 3.8], [10.6, -6.2]].forEach((p) => torch(p[0], p[1]));
    [[-6.4, 6.9], [-5.6, 6.3], [-4.8, 5.8], [-4.0, 5.4], [-6.6, -7.0], [-5.8, -6.5], [-5.0, -6.1], [-4.2, -5.9]].forEach((p, i) => P(cyl(0.27, 0.29, 0.05, seg(24)), 0x9d988d, { x: p[0], y: 0.025, z: p[1], sx: 1, sz: 0.85 + (i % 3) * 0.08, ry: rnd() * 3, jit: 0.15 }));

    // ---------------------------------------------------------------- bunting along both side fences
    lab = "bunting";
    [-1, 1].forEach((side) => {
      const x = side * 11.15;
      for (let i = 0; i < 26; i++) {
        const t = i / 25, z = -13 + t * 26, sag = Math.sin(t * Math.PI * 2) * 0;       // flat run between the poles
        const y = 3.25 - Math.sin(Math.min(1, (t * 26 % 6.5) / 6.5) * Math.PI) * 0.4;
        if (i < 25 && (i + 1) % 6 !== 0) {                                                 // the string between this flag and the next
          const t2 = (i + 1) / 25, z2 = -13 + t2 * 26, y2 = 3.25 - Math.sin(Math.min(1, (t2 * 26 % 6.5) / 6.5) * Math.PI) * 0.4;
          P(box(0.012, 0.012, Math.hypot(z2 - z, y2 - y)), 0x222222, { x: x, y: (y + y2) / 2, z: (z + z2) / 2, rx: -Math.atan2(y2 - y, z2 - z), jit: 0 });
        }
        P(new T.ConeGeometry(0.17, 0.32, 3), [0xe34a4a, 0xf2c230, 0x2f6fd0, 0xffffff, 0x3f9440][i % 5], { x: x, y: y - 0.16, z: z + sag, rx: Math.PI, ry: Math.PI / 2, sz: 0.15, jit: 0.05 });
      }
    });

    // ---------------------------------------------------------------- hedges and bushes around the fence line
    lab = "bushes";
    const clear = (x, z, r) => keep.every((k) => Math.hypot(x - k[0], z - k[1]) > k[2] + r);
    const nb = [28, 46, 60][detail];
    for (let i = 0, tries = 0; i < nb && tries < 400; tries++) {
      const edge = Math.floor(rnd() * 4), t = rnd();
      const x = edge < 2 ? -FX + 0.9 + t * (FX * 2 - 1.8) : (edge === 2 ? -FX + 0.75 : FX - 0.75);
      const z = edge < 2 ? (edge === 0 ? -FZ + 0.8 : FZ - 0.8) : -FZ + 1.5 + t * (FZ * 2 - 3);
      const s = 0.55 + rnd() * 0.6;
      if (!clear(x, z, s * 0.9)) continue;
      bush(x, z, s); i++;
    }
    // a few round shrubs standing alone near the corners
    [[-9.4, 12.4, 1.0], [9.3, -12.5, 1.0], [-9.8, -13.0, 0.8], [9.6, 12.8, 0.9]].forEach((b) => { if (clear(b[0], b[1], b[2])) bush(b[0], b[1], b[2]); });

    // ---------------------------------------------------------------- merge the chunks
    const group = new T.Group();
    const mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: T.DoubleSide });
    buckets.forEach((list) => {
      if (!list.length) return;
      const geo = SB.Merge(list, false);
      list.forEach((g) => g.dispose());
      const mesh = new T.Mesh(geo, mat);
      mesh.receiveShadow = true; mesh.castShadow = false;
      group.add(mesh);
    });

    scene.add(group);

    // ---------------------------------------------------------------- the moving bits: flames and grill smoke
    const flameMat = [new T.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.9, depthWrite: false }), new T.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.95, depthWrite: false })];
    const flameGeo = new T.ConeGeometry(1, 2.2, 10, 1, true).translate(0, 1.1, 0);
    const fl = [];
    const addFlame = (f, m) => { const mesh = new T.Mesh(flameGeo, flameMat[m]); mesh.position.set(f.x, f.y, f.z); mesh.scale.setScalar(f.s); group.add(mesh); fl.push({ mesh: mesh, base: f.s, ph: f.ph }); };
    flames.forEach((f) => addFlame(f, 0));
    for (let i = 0; i < 4; i++) { const a = i * 1.7; addFlame({ x: FP.x + Math.cos(a) * 0.15, y: 0.26, z: FP.z + Math.sin(a) * 0.15, s: 0.2 + (i % 2) * 0.05, ph: i * 1.3 }, i % 2); }
    const smokeTex = (function () {
      const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
      const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, "rgba(220,220,220,.9)"); gr.addColorStop(1, "rgba(220,220,220,0)");
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new T.CanvasTexture(c);
    })();
    const smoke = [];
    const vx = GR.x + Math.sin(GR.ry) * -0.1, vz = GR.z + Math.cos(GR.ry) * -0.1;
    for (let i = 0; i < 7; i++) {
      const sp = new T.Sprite(new T.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0, depthWrite: false }));
      group.add(sp); smoke.push({ sp: sp, t: i / 7 * 3.4 });
    }
    // ---- night glow: halos round the torch flames, the fire pit and the shed window (additive points), a lit shed window,
    // and a flickering light from the fire pit (medium and high)
    const glowTex = (function () {
      const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d");
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.15, "rgba(255,255,255,0.55)"); gr.addColorStop(0.5, "rgba(255,255,255,0.12)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new T.CanvasTexture(c);
    })();
    const halo = function (arr, size, color) {
      const g = new T.BufferGeometry(); g.setAttribute("position", new T.Float32BufferAttribute(arr, 3));
      const pts = new T.Points(g, new T.PointsMaterial({ map: glowTex, color: color, size: size, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false, blending: T.AdditiveBlending }));
      pts.renderOrder = 5; pts.frustumCulled = false; group.add(pts);
    };
    const small = [];
    flames.forEach((f) => small.push(f.x, f.y + 0.12, f.z));
    halo(small, 0.9, 0xffa040);
    halo([FP.x, 0.5, FP.z], 2.4, 0xff8a3a);
    halo([5.3 + 0.85, 1.35, -13.7 + 1.35], 1.6, 0xffc070);
    const shedWin = new T.Mesh(new T.PlaneGeometry(0.66, 0.56), new T.MeshBasicMaterial({ color: 0xffd68a, toneMapped: false }));
    shedWin.position.set(5.3 + 0.85, 1.35, -13.7 + 1.17); group.add(shedWin);
    let fireLight = null;
    if (detail >= 1) { fireLight = new T.PointLight(0xff8a3a, 3.6, 10, 1.8); fireLight.position.set(FP.x, 0.7, FP.z); group.add(fireLight); }

    return {
      group: group, tris: tris, byLab: byLab,
      update: function (dt, now) {
        if (fireLight) fireLight.intensity = 3.2 + 0.7 * Math.sin(now * 13) + 0.4 * Math.sin(now * 29);
        fl.forEach((f) => { const k = 1 + 0.18 * Math.sin(now * 11 + f.ph) + 0.1 * Math.sin(now * 23 + f.ph * 2); f.mesh.scale.set(f.base * (1 - (k - 1) * 0.5), f.base * k, f.base * (1 - (k - 1) * 0.5)); f.mesh.rotation.y += dt * 2; });
        smoke.forEach((s) => {
          s.t += dt; if (s.t > 3.4) s.t -= 3.4;
          const u = s.t / 3.4;
          s.sp.position.set(vx + 0.15 * u + Math.sin(s.t * 1.7) * 0.08, 1.4 + u * 2.2, vz + 0.1 * u);
          s.sp.scale.setScalar(0.25 + u * 0.9); s.sp.material.opacity = Math.sin(u * Math.PI) * 0.28;
        });
      }
    };
  };

  SB.Yard = Y;
})(globalThis.SB);
