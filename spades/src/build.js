// Building blocks for the set: a batcher that merges hundreds of small pieces
// into one mesh per material (lots of detail, few draw calls; the game must run
// on laptop graphics), world-scale texture coordinates for tiled materials,
// and the procedural textures (wood, brick, roof, felt, windows ...), all drawn
// in code: nothing to download, nothing to license.
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const THREE = globalThis.THREE;
  const B = {};
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  const _c = new THREE.Color();

  // A transform from position [x,y,z], rotation [rx,ry,rz] (radians), scale (number or [x,y,z]).
  B.mat = function (p, r, s) {
    _e.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0);
    _q.setFromEuler(_e);
    if (s === undefined) _s.set(1, 1, 1); else if (typeof s === "number") _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
    return new THREE.Matrix4().compose(_p.set(p ? p[0] : 0, p ? p[1] : 0, p ? p[2] : 0), _q.clone(), _s.clone());
  };

  // ------------------------------------------------------------------ the batcher
  // b = B.batch(); b.add("wood", geometry, matrix, colour, { tile: 1.5 }); b.build(materials) -> Group
  B.batch = function () {
    const lists = {};
    return {
      lists: lists,
      add: function (mat, geo, matrix, color, o) {
        o = o || {};
        let g = geo.index ? geo.toNonIndexed() : geo.clone();
        if (matrix) g.applyMatrix4(matrix);
        if (!g.attributes.normal) g.computeVertexNormals();
        const n = g.attributes.position.count;
        _c.set(color === undefined ? 0xffffff : color);
        const col = new Float32Array(n * 3);
        const jitter = o.jitter || 0;
        for (let i = 0; i < n; i++) {
          const k = jitter ? 1 + (Math.random() - 0.5) * jitter : 1;
          col[i * 3] = _c.r * k; col[i * 3 + 1] = _c.g * k; col[i * 3 + 2] = _c.b * k;
        }
        g.setAttribute("color", new THREE.BufferAttribute(col, 3));
        // World-scale UVs (box projection) for tiled materials: the same plank
        // or brick size on every piece, however it's scaled.
        if (o.tile) {
          const pos = g.attributes.position, nor = g.attributes.normal, uv = new Float32Array(n * 2);
          for (let i = 0; i < n; i++) {
            const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
            const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
            let u, v;
            if (ay >= ax && ay >= az) { u = x; v = z; } else if (ax >= az) { u = z; v = y; } else { u = x; v = y; }
            if (o.rotUV) { const t = u; u = v; v = t; }
            uv[i * 2] = u / o.tile; uv[i * 2 + 1] = v / o.tile;
          }
          g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
        } else if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
        ["uv1", "uv2", "tangent"].forEach(function (k) { if (g.attributes[k]) g.deleteAttribute(k); });
        (lists[mat] = lists[mat] || []).push(g);
        return g;
      },
      build: function (materials, o) {
        o = o || {};
        const group = new THREE.Group();
        Object.keys(lists).forEach(function (k) {
          const geo = B.merge(lists[k]);
          const mesh = new THREE.Mesh(geo, materials[k]);
          mesh.name = k;
          mesh.castShadow = !!(o.cast && o.cast.indexOf(k) >= 0);
          mesh.receiveShadow = !!(o.receive && o.receive.indexOf(k) >= 0);
          mesh.matrixAutoUpdate = false;
          group.add(mesh);
        });
        return group;
      },
      tris: function () { let t = 0; Object.keys(lists).forEach(function (k) { lists[k].forEach(function (g) { t += g.attributes.position.count / 3; }); }); return t; }
    };
  };
  // Merge non-indexed geometries with position, normal, uv, color.
  B.merge = function (geos) {
    let n = 0;
    geos.forEach(function (g) { n += g.attributes.position.count; });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
    let o = 0;
    geos.forEach(function (g) {
      const c = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      uv.set(g.attributes.uv.array.length === c * 2 ? g.attributes.uv.array : new Float32Array(c * 2), o * 2);
      col.set(g.attributes.color.array, o * 3);
      o += c;
      g.dispose();
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    return geo;
  };

  // ------------------------------------------------------------------ shapes
  B.box = function (w, h, d) { return new THREE.BoxGeometry(w, h, d); };
  B.cyl = function (rt, rb, h, seg, open) { return new THREE.CylinderGeometry(rt, rb, h, seg || 16, 1, !!open); };
  B.sphere = function (r, w, h, phiStart, phiLen, thStart, thLen) { return new THREE.SphereGeometry(r, w || 16, h || 12, phiStart, phiLen, thStart, thLen); };
  B.torus = function (R, r, rs, ts, arc) { return new THREE.TorusGeometry(R, r, rs || 8, ts || 24, arc); };
  B.lathe = function (pts, seg) { return new THREE.LatheGeometry(pts.map(function (p) { return new THREE.Vector2(p[0], p[1]); }), seg || 24); };
  // A box with rounded vertical edges (cushions, planters, AC units): an extruded rounded rectangle.
  B.rbox = function (w, h, d, r, seg) {
    r = Math.min(r, w / 2 - 0.001, d / 2 - 0.001);
    const s = new THREE.Shape(), x = -w / 2, y = -d / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: true, bevelThickness: Math.min(r, h * 0.3), bevelSize: Math.min(r, h * 0.3) * 0.8, bevelSegments: seg || 3, curveSegments: 6 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, -h / 2, 0);
    return g;
  };
  // A tube along points (cables, pipes, neon).
  B.tube = function (pts, r, seg, rs, closed) {
    const curve = new THREE.CatmullRomCurve3(pts.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); }), !!closed);
    return new THREE.TubeGeometry(curve, seg || Math.max(8, pts.length * 6), r, rs || 6, !!closed);
  };
  // A sagging cable between two points.
  B.catenary = function (a, b, sag, n) {
    const pts = [];
    n = n || 16;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t]);
    }
    return pts;
  };

  // ------------------------------------------------------------------ textures
  function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function tex(c, repeat) {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    return t;
  }
  B.canvas = canvas; B.tex = tex;
  function noise(g, w, h, n, a, colors) {
    for (let i = 0; i < n; i++) {
      g.globalAlpha = a * Math.random();
      g.fillStyle = colors[(Math.random() * colors.length) | 0];
      const s = Math.random() * 2 + 0.5;
      g.fillRect(Math.random() * w, Math.random() * h, s, s);
    }
    g.globalAlpha = 1;
  }
  // Wood: long boards with grain (greyscale-ish warm; vertex colours tint it).
  B.woodTex = function () {
    const c = canvas(512, 512), g = c.getContext("2d");
    g.fillStyle = "#c9b49a"; g.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y += 2) {
      const k = 0.85 + 0.15 * Math.sin(y * 0.07 + Math.sin(y * 0.013) * 4) + (Math.random() - 0.5) * 0.06;
      g.fillStyle = "rgba(" + Math.round(150 * k) + "," + Math.round(118 * k) + "," + Math.round(88 * k) + ",0.55)";
      g.fillRect(0, y, 512, 2);
    }
    for (let i = 0; i < 9; i++) {   // knots
      const x = Math.random() * 512, y = Math.random() * 512;
      g.strokeStyle = "rgba(90,60,40,0.35)"; g.lineWidth = 1.5;
      for (let r = 2; r < 14; r += 3) { g.beginPath(); g.ellipse(x, y, r * 2.2, r * 0.6, 0, 0, Math.PI * 2); g.stroke(); }
    }
    noise(g, 512, 512, 4000, 0.25, ["#5a4030", "#e8d6bd"]);
    return tex(c, true);
  };
  // Deck boards: planks with gaps along U.
  B.deckTex = function () {
    const c = canvas(512, 512), g = c.getContext("2d");
    const n = 8, h = 512 / n;
    for (let i = 0; i < n; i++) {
      const k = 0.82 + Math.random() * 0.22;
      g.fillStyle = "rgb(" + Math.round(176 * k) + "," + Math.round(132 * k) + "," + Math.round(96 * k) + ")";
      g.fillRect(0, i * h, 512, h);
      for (let y = 0; y < h; y += 2) {
        g.fillStyle = "rgba(80,50,30," + (0.08 + 0.1 * Math.abs(Math.sin(y * 0.6 + i * 3 + Math.sin(y * 0.1) * 2))) + ")";
        g.fillRect(0, i * h + y, 512, 1);
      }
      // Board ends, staggered.
      const off = (i * 197) % 512;
      g.fillStyle = "rgba(30,20,12,0.85)"; g.fillRect(off, i * h, 3, h);
      g.fillStyle = "rgba(30,20,12,0.9)"; g.fillRect(0, i * h + h - 4, 512, 4);
      // Screws.
      g.fillStyle = "rgba(40,40,40,0.8)";
      for (let x = 30; x < 512; x += 128) { g.fillRect(x + (i % 2) * 64, i * h + 8, 3, 3); g.fillRect(x + (i % 2) * 64, i * h + h - 14, 3, 3); }
    }
    noise(g, 512, 512, 3000, 0.2, ["#3b2a1d", "#f0dcc0"]);
    return tex(c, true);
  };
  B.brickTex = function () {
    const c = canvas(512, 512), g = c.getContext("2d");
    g.fillStyle = "#8d8378"; g.fillRect(0, 0, 512, 512);
    const bw = 64, bh = 24;
    for (let row = 0; row < 512 / bh + 1; row++) {
      for (let col = -1; col < 512 / bw + 1; col++) {
        const x = col * bw + (row % 2 ? bw / 2 : 0), y = row * bh;
        const k = 0.75 + Math.random() * 0.35;
        const r = 148 + Math.random() * 40, gg = 70 + Math.random() * 25, b = 52 + Math.random() * 18;
        g.fillStyle = "rgb(" + Math.round(r * k) + "," + Math.round(gg * k) + "," + Math.round(b * k) + ")";
        g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
        g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(x + 2, y + bh - 6, bw - 4, 4);
      }
    }
    noise(g, 512, 512, 9000, 0.3, ["#2a1a14", "#d8b8a0", "#6b5446"]);
    return tex(c, true);
  };
  B.roofTex = function () {   // tar and gravel
    const c = canvas(512, 512), g = c.getContext("2d");
    g.fillStyle = "#3c3d40"; g.fillRect(0, 0, 512, 512);
    noise(g, 512, 512, 26000, 0.7, ["#55575c", "#2a2b2e", "#6d6c68", "#47484c", "#7d786e"]);
    // Seams of the membrane.
    g.strokeStyle = "rgba(20,20,22,0.5)"; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, 256); g.lineTo(512, 256); g.stroke();
    return tex(c, true);
  };
  B.concreteTex = function () {
    const c = canvas(256, 256), g = c.getContext("2d");
    g.fillStyle = "#9a958d"; g.fillRect(0, 0, 256, 256);
    noise(g, 256, 256, 9000, 0.35, ["#7e7a73", "#b5b0a6", "#6d6a64"]);
    return tex(c, true);
  };
  // Metal: brushed streaks (for vertex-coloured steel, AC housings, poles).
  B.metalTex = function () {
    const c = canvas(256, 256), g = c.getContext("2d");
    g.fillStyle = "#c8c8c8"; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 400; i++) { g.fillStyle = "rgba(" + (Math.random() < 0.5 ? "90,90,90" : "240,240,240") + ",0.12)"; g.fillRect(0, Math.random() * 256, 256, 1); }
    noise(g, 256, 256, 2000, 0.25, ["#555", "#eee"]);
    return tex(c, true);
  };
  // Windows for the skyline: a grid of lit and dark windows; the emissive map is the lit ones only.
  B.windowTex = function () {
    const c = canvas(512, 512), e = canvas(512, 512), g = c.getContext("2d"), h = e.getContext("2d");
    const cols = 16, rows = 16, cw = 512 / cols, ch = 512 / rows;
    g.fillStyle = "#4b4f57"; g.fillRect(0, 0, 512, 512);
    h.fillStyle = "#000"; h.fillRect(0, 0, 512, 512);
    noise(g, 512, 512, 6000, 0.3, ["#30333a", "#6a6e76"]);
    const warm = ["#ffd88a", "#ffcf73", "#ffe2a8", "#f7c66a"], cool = ["#bfe3ff", "#9ad0ff", "#e6f4ff"], tv = ["#8fa8ff", "#b48cff"];
    for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
      const x = col * cw + 5, y = r * ch + 6, w = cw - 10, hh = ch - 11;
      const lit = Math.random();
      g.fillStyle = "#1c2230"; g.fillRect(x, y, w, hh);
      if (lit < 0.42) {
        const pal = lit < 0.3 ? warm : lit < 0.39 ? cool : tv;
        const col0 = pal[(Math.random() * pal.length) | 0];
        g.fillStyle = col0; g.fillRect(x, y, w, hh);
        h.fillStyle = col0; h.globalAlpha = 0.55 + Math.random() * 0.45; h.fillRect(x, y, w, hh); h.globalAlpha = 1;
        // A blind or a curtain half down.
        if (Math.random() < 0.4) { const k = Math.random() * hh * 0.6; g.fillStyle = "rgba(60,40,20,0.6)"; g.fillRect(x, y, w, k); h.fillStyle = "rgba(0,0,0,0.7)"; h.fillRect(x, y, w, k); }
      } else {
        g.fillStyle = "rgba(120,140,170,0.18)"; g.fillRect(x, y, w * 0.4, hh);   // reflection
      }
      g.fillStyle = "#2b2e35"; g.fillRect(x - 2, y + hh, w + 4, 3);   // sill
    }
    return { map: tex(c, true), emissive: tex(e, true) };
  };
  // Green felt with the table's printed emblem.
  B.feltTex = function () {
    const S = 1024, c = canvas(S, S), g = c.getContext("2d");
    const grd = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.55);
    grd.addColorStop(0, "#1f7a4d"); grd.addColorStop(1, "#155c3a");
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
    noise(g, S, S, 60000, 0.18, ["#0c3d26", "#2b9462", "#1a6b44"]);
    // A thin gold ring and the spade emblem in the middle.
    g.strokeStyle = "rgba(226,190,110,0.55)"; g.lineWidth = 5;
    g.beginPath(); g.arc(S / 2, S / 2, S * 0.43, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 2; g.beginPath(); g.arc(S / 2, S / 2, S * 0.415, 0, Math.PI * 2); g.stroke();
    g.save(); g.translate(S / 2, S / 2);
    g.fillStyle = "rgba(10,50,30,0.55)";
    B.spadePath(g, 0, -10, 150); g.fill();
    g.strokeStyle = "rgba(226,190,110,0.5)"; g.lineWidth = 4; B.spadePath(g, 0, -10, 150); g.stroke();
    g.font = "700 40px Georgia, 'Times New Roman', serif"; g.textAlign = "center"; g.fillStyle = "rgba(226,190,110,0.55)";
    // Lettering around the ring.
    const text = "♠ VILLA SPADES ♠ ";
    const R = S * 0.37;
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i < text.length; i++) {
        const a = (k * Math.PI) + (i - text.length / 2) * 0.062;
        g.save(); g.rotate(a); g.translate(0, -R); g.fillText(text[i], 0, 0); g.restore();
      }
    }
    g.restore();
    return tex(c, false);
  };
  // A spade outline, centred at (x, y), size s.
  B.spadePath = function (g, x, y, s) {
    g.beginPath();
    g.moveTo(x, y - s * 0.62);
    g.bezierCurveTo(x + s * 0.18, y - s * 0.32, x + s * 0.62, y - s * 0.12, x + s * 0.5, y + s * 0.22);
    g.bezierCurveTo(x + s * 0.4, y + s * 0.45, x + s * 0.12, y + s * 0.42, x + s * 0.04, y + s * 0.26);
    g.quadraticCurveTo(x + s * 0.1, y + s * 0.5, x + s * 0.24, y + s * 0.62);
    g.lineTo(x - s * 0.24, y + s * 0.62);
    g.quadraticCurveTo(x - s * 0.1, y + s * 0.5, x - s * 0.04, y + s * 0.26);
    g.bezierCurveTo(x - s * 0.12, y + s * 0.42, x - s * 0.4, y + s * 0.45, x - s * 0.5, y + s * 0.22);
    g.bezierCurveTo(x - s * 0.62, y - s * 0.12, x - s * 0.18, y - s * 0.32, x, y - s * 0.62);
    g.closePath();
  };
  // A rug's pattern.
  B.rugTex = function () {
    const S = 512, c = canvas(S, S), g = c.getContext("2d");
    g.fillStyle = "#6b2f2a"; g.fillRect(0, 0, S, S);
    g.translate(S / 2, S / 2);
    const rings = ["#d9b26a", "#2c3f5c", "#a8453a", "#e8d9b8", "#2c3f5c", "#d9b26a"];
    rings.forEach(function (col, i) { g.strokeStyle = col; g.lineWidth = 7; g.beginPath(); g.arc(0, 0, 240 - i * 26, 0, Math.PI * 2); g.stroke(); });
    for (let i = 0; i < 24; i++) {
      g.save(); g.rotate(i / 24 * Math.PI * 2);
      g.fillStyle = i % 2 ? "#d9b26a" : "#e8d9b8";
      g.beginPath(); g.moveTo(0, -205); g.lineTo(10, -185); g.lineTo(0, -165); g.lineTo(-10, -185); g.closePath(); g.fill();
      g.restore();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    noise(g, S, S, 20000, 0.25, ["#000", "#fff"]);
    return tex(c, false);
  };
  // A soft round glow (string-light halos, the moon, the lantern).
  B.glowTex = function (inner) {
    const c = canvas(128, 128), g = c.getContext("2d");
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(inner || 0.15, "rgba(255,255,255,0.55)"); grd.addColorStop(0.5, "rgba(255,255,255,0.12)"); grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  HS.Build = B;
})(globalThis.HS);
