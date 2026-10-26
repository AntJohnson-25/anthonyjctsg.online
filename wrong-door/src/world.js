// The complex in three.js, built from the sim's level (sim.js buildLevel). Every box the sim collides with is
// drawn as the thing it stands for (stucco wings under hip roofs, balconies on posts, stairs with treads and
// handrails, cars, the step van, dumpsters...), plus dressing only the eye needs (panel doors with hardware,
// windows with sills and blinds, porch sconces, gutters, AC units, a wood fence, trees and palms, grass tufts).
// Detail is real geometry, batched: static parts are merged into one mesh per material, repeated parts
// (balusters, fence posts, trees, cars, tufts) are instanced, so the draw calls stay low on a laptop.
// WD.detail = "low" builds lighter versions (fewer segments, no tufts) for weak machines.
globalThis.WD = globalThis.WD || {};
(function (WD) {
  "use strict";
  const THREE = globalThis.THREE;
  const W = {};

  const COL = {
    stucco: 0xe8d9bc, stuccoB: 0xdfd0b2, trim: 0xf3ede1, base: 0xb9a888, slab: 0xb1aba0, rail: 0x2e3238,
    door: 0x2f5d62, doorB: 0x6b3a35, brass: 0xc9a85e, glassDay: 0x8fb3c4, grass: 0x6f9b4b, line: 0xe9e3d0, hedge: 0x3e7438,
    tread: 0xc9c4ba, riser: 0x8d8a84, gutter: 0xe9e6de, van: 0xf4f2ee, stripe: 0xff8a1f, tire: 0x1c1c1e, chrome: 0xb9bec4,
    dumpster: 0x2f6a45, lid: 0x1f2326, mailbox: 0x8d969e, fence: 0x9c7a55, gate: 0x24272c, mat: 0x6b4a3a, ac: 0xc9ccc8
  };
  const STUCCO = [0xe8d9bc, 0xdfd0b2, 0xe6cfb0, 0xd9d3bd, 0xe9dcc6, 0xdccdb0, 0xe3d5b8, 0xd8c9a8, 0xe5d8c0];
  const DOORC = [0x2f5d62, 0x6b3a35, 0x2e3f5c, 0x3a5a3a, 0x9a7a2a, 0x3a3d44];
  const CAR = [0xb03a2e, 0x2e5fa8, 0x9ea4aa, 0x222428, 0xe2e0d8, 0x4c7a4a, 0x8a6a3c, 0x6c2c5c, 0x2a6f7a];

  // ------------------------------------------------------------------ textures (canvas, made once)
  const TEX = {};
  function canvasTex(key, w, h, paint, opt) {
    if (TEX[key]) return TEX[key];
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    paint(c.getContext("2d"), w, h, WD.rngFrom(key.length * 977 + w));
    const t = new THREE.CanvasTexture(c);
    if (!(opt && opt.data)) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return (TEX[key] = t);
  }
  function speckle(g, w, h, rnd, n, light, dark, size) {
    for (let i = 0; i < n; i++) {
      g.fillStyle = rnd() < 0.5 ? "rgba(255,255,255," + light * rnd() + ")" : "rgba(0,0,0," + dark * rnd() + ")";
      const s = 1 + rnd() * (size || 2); g.fillRect(rnd() * w, rnd() * h, s, s);
    }
  }
  // one metre of stucco (grey: tinted by the material colour), and its bump
  const stuccoTex = () => canvasTex("stucco", 256, 256, (g, w, h, r) => { g.fillStyle = "#e9e9e9"; g.fillRect(0, 0, w, h); speckle(g, w, h, r, 9000, 0.25, 0.12, 2.5); });
  const stuccoBump = () => canvasTex("stuccoBump", 256, 256, (g, w, h, r) => { g.fillStyle = "#808080"; g.fillRect(0, 0, w, h); speckle(g, w, h, r, 14000, 0.6, 0.6, 3); }, { data: true });
  // 2 m of shingles: rows of tabs, each a slightly different shade
  const shingleTex = () => canvasTex("shingle", 256, 256, (g, w, h, r) => {
    g.fillStyle = "#4a3f38"; g.fillRect(0, 0, w, h);
    const rows = 8, rh = h / rows;
    for (let y = 0; y < rows; y++) for (let x = -1; x < 9; x++) {
      const v = 60 + r() * 40 | 0, ox = (y % 2) * w / 16;
      g.fillStyle = "rgb(" + (v + 22) + "," + (v + 8) + "," + v + ")";
      g.fillRect(x * w / 8 + ox + 1, y * rh + 1, w / 8 - 2, rh - 3);
      g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(x * w / 8 + ox, y * rh + rh - 3, w / 8, 3);
    }
    speckle(g, w, h, r, 3000, 0.12, 0.2, 1.5);
  });
  // 4 m of artificial turf: two mowing-stripe bands (2 m each), short dense fibres in three greens, dark rubber infill
  // specks and a faint seam where one roll meets the next
  const grassTex = () => canvasTex("grass", 512, 512, (g, w, h, r) => {
    g.fillStyle = "#4f9f37"; g.fillRect(0, 0, w, h / 2); g.fillStyle = "#5cae3d"; g.fillRect(0, h / 2, w, h / 2);
    for (let i = 0; i < 30000; i++) {
      const x = r() * w, y = r() * h, c = r();
      g.strokeStyle = c < 0.3 ? "rgba(24,84,26," + (0.25 + r() * 0.3) + ")" : c < 0.7 ? "rgba(132,208,78," + (0.2 + r() * 0.3) + ")" : "rgba(80,150,48," + (0.25 + r() * 0.3) + ")";
      g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 2, y - 2 - r() * 3); g.stroke();
    }
    for (let i = 0; i < 2200; i++) { g.fillStyle = "rgba(38,34,26," + (0.15 + r() * 0.2) + ")"; g.fillRect(r() * w, r() * h, 1.5, 1.5); }
    g.fillStyle = "rgba(20,56,22,0.45)"; g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h);
  });
  // 6 m of asphalt: speckle, patches and a couple of cracks
  const asphaltTex = () => canvasTex("asphalt", 512, 512, (g, w, h, r) => {
    g.fillStyle = "#3d3f43"; g.fillRect(0, 0, w, h);
    speckle(g, w, h, r, 26000, 0.18, 0.25, 2);
    for (let i = 0; i < 10; i++) { g.fillStyle = "rgba(0,0,0," + (0.05 + r() * 0.08) + ")"; g.fillRect(r() * w, r() * h, 20 + r() * 90, 14 + r() * 60); }
    g.strokeStyle = "rgba(15,15,15,0.55)"; g.lineWidth = 1.2;
    for (let k = 0; k < 4; k++) { let x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); for (let i = 0; i < 14; i++) { x += (r() - 0.5) * 30; y += (r() - 0.3) * 18; g.lineTo(x, y); } g.stroke(); }
  });
  // 1.5 m of walkway: concrete with a control joint on the tile edge
  const concreteTex = () => canvasTex("concrete", 256, 256, (g, w, h, r) => {
    g.fillStyle = "#c2bdb3"; g.fillRect(0, 0, w, h);
    speckle(g, w, h, r, 9000, 0.15, 0.12, 2);
    for (let i = 0; i < 6; i++) { g.fillStyle = "rgba(90,80,60," + (0.03 + r() * 0.04) + ")"; g.beginPath(); g.arc(r() * w, r() * h, 20 + r() * 50, 0, 7); g.fill(); }
    g.fillStyle = "rgba(60,55,50,0.55)"; g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h);
  });
  // 2.4 m of fence boards
  const fenceTex = () => canvasTex("fence", 256, 128, (g, w, h, r) => {
    const n = 16, bw = w / n;
    for (let i = 0; i < n; i++) {
      const v = 120 + r() * 40 | 0; g.fillStyle = "rgb(" + (v + 30) + "," + (v + 5) + "," + (v - 30) + ")"; g.fillRect(i * bw, 0, bw, h);
      g.strokeStyle = "rgba(60,35,15,0.25)"; for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(i * bw + r() * bw, 0); g.lineTo(i * bw + r() * bw, h); g.stroke(); }
      g.fillStyle = "rgba(30,18,8,0.7)"; g.fillRect(i * bw, 0, 1.4, h);
    }
  });
  const leafTex = () => canvasTex("leaf", 256, 256, (g, w, h, r) => {
    g.fillStyle = "#3f6f35"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { const v = r(); g.fillStyle = v < 0.4 ? "rgba(20,50,15,0.5)" : v < 0.8 ? "rgba(90,140,60,0.45)" : "rgba(150,190,90,0.4)"; g.beginPath(); g.ellipse(r() * w, r() * h, 2 + r() * 4, 1 + r() * 2, r() * 3, 0, 7); g.fill(); }
  });
  const barkTex = () => canvasTex("bark", 128, 256, (g, w, h, r) => {
    g.fillStyle = "#6a4a32"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) { g.strokeStyle = "rgba(30,18,10," + (0.2 + r() * 0.4) + ")"; g.lineWidth = 1 + r() * 2; const x = r() * w; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 6, h * 0.3, x - 6, h * 0.6, x + (r() - 0.5) * 10, h); g.stroke(); }
  });
  // a window pane: blinds behind the glass, a sky reflection over them; the lit one glows warm at night
  const paneTex = (lit) => canvasTex(lit ? "paneLit" : "pane", 128, 128, (g, w, h, r) => {
    g.fillStyle = lit ? "#f2c47a" : "#e9e4d8"; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 6) { g.fillStyle = lit ? "rgba(140,80,30,0.35)" : "rgba(0,0,0,0.12)"; g.fillRect(0, y + 4, w, 2); }
    if (!lit) {
      const gr = g.createLinearGradient(0, 0, w * 0.4, h);
      gr.addColorStop(0, "rgba(200,225,245,0.92)"); gr.addColorStop(0.55, "rgba(120,160,190,0.78)"); gr.addColorStop(1, "rgba(70,95,115,0.86)");
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = "rgba(255,255,255,0.28)"; g.beginPath(); g.moveTo(w * 0.15, 0); g.lineTo(w * 0.38, 0); g.lineTo(w * 0.1, h); g.lineTo(-w * 0.1, h); g.fill();
    }
  });
  const grillTex = () => canvasTex("grille", 128, 128, (g, w, h) => { g.fillStyle = "#bfc3bf"; g.fillRect(0, 0, w, h); g.fillStyle = "rgba(40,40,40,0.75)"; for (let x = 4; x < w; x += 6) g.fillRect(x, 0, 2, h); });
  const cbuTex = () => canvasTex("cbu", 128, 256, (g, w, h) => {
    g.fillStyle = "#8d969e"; g.fillRect(0, 0, w, h);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
      g.fillStyle = "rgba(255,255,255,0.18)"; g.fillRect(4 + x * 31, 6 + y * 30, 27, 26);
      g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(4 + x * 31, 30 + y * 30, 27, 2);
      g.fillStyle = "#3a3e43"; g.beginPath(); g.arc(26 + x * 31, 18 + y * 30, 2.5, 0, 7); g.fill();
    }
  });
  const tuftTex = () => canvasTex("tuft", 64, 64, (g, w, h, r) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const x = w * 0.2 + r() * w * 0.6; g.strokeStyle = r() < 0.5 ? "#4f7f34" : "#7aa64e"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + (r() - 0.5) * 8, h * 0.5, x + (r() - 0.5) * 22, h * (0.05 + r() * 0.35)); g.stroke();
    }
  });
  const frondTex = () => canvasTex("frond", 128, 32, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = "#5d7f2f"; g.lineWidth = 2; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    g.lineWidth = 3;
    for (let x = 3; x < w - 2; x += 2) { const l = 0.48 * Math.sin(Math.PI * Math.min(1, (x + 10) / w)); g.strokeStyle = x % 4 ? "#4e7a2a" : "#6c9a3c"; g.beginPath(); g.moveTo(x, h / 2); g.lineTo(x + 9, h / 2 - h * l); g.moveTo(x, h / 2); g.lineTo(x + 9, h / 2 + h * l); g.stroke(); }
  });
  const signTex = () => canvasTex("wetsign", 128, 128, (g, w, h) => {
    g.fillStyle = "#ffcf1a"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#1d1a16"; g.font = "900 22px Trebuchet MS, sans-serif"; g.textAlign = "center"; g.fillText("CAUTION", w / 2, 26); g.font = "800 15px Trebuchet MS, sans-serif"; g.fillText("WET FLOOR", w / 2, 116);
    g.beginPath(); g.arc(w / 2, 52, 9, 0, 7); g.fill(); g.lineWidth = 7; g.strokeStyle = "#1d1a16"; g.beginPath(); g.moveTo(w / 2, 62); g.lineTo(w / 2 - 8, 86); g.lineTo(w / 2 - 22, 98); g.moveTo(w / 2 - 8, 86); g.lineTo(w / 2 + 14, 96); g.moveTo(w / 2, 68); g.lineTo(w / 2 + 18, 74); g.stroke();
  });

  // ---- text on a canvas (door numbers, signs, the van)
  function labelTex(text, opt) {
    opt = opt || {};
    const c = document.createElement("canvas"), w = opt.w || 256, h = opt.h || 128;
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    g.fillStyle = opt.bg || "#f4efe4"; g.fillRect(0, 0, w, h);
    if (opt.border) { g.strokeStyle = opt.border; g.lineWidth = Math.max(4, h * 0.06); g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth); }
    g.fillStyle = opt.fg || "#1d1a16";
    g.font = (opt.weight || "800") + " " + Math.round(h * (opt.size || 0.62)) + "px " + (opt.font || "Trebuchet MS, Segoe UI, sans-serif");
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, w / 2, h / 2 + h * 0.04);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }
  W.labelTex = labelTex;

  // ------------------------------------------------------------------ geometry helpers
  const HI = () => WD.detail !== "low";
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  const M = (x, y, z, ry, rx, rz, sx, sy, sz) => _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx || 0, ry || 0, rz || 0, "YXZ")), _s.set(sx || 1, sy === undefined ? sx || 1 : sy, sz === undefined ? sx || 1 : sz)).clone();
  // a rounded box; anything thinner than 15 cm is a plain box (the rounding is invisible on trim, and costs hundreds of triangles each)
  const rb = (w, h, d, r, seg) => (Math.min(w, h, d) < 0.15 ? new THREE.BoxGeometry(w, h, d) : WD.Gear.roundedBox(+w.toFixed(3), +h.toFixed(3), +d.toFixed(3), r, seg || (HI() ? 2 : 1)));
  // planar UVs in metres from each face's main axis, for the tiling textures (stucco, concrete, fence...)
  function worldUV(g, scale) {
    const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
      let u, v;
      if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); } else if (ax >= az) { u = p.getZ(i); v = p.getY(i); } else { u = p.getX(i); v = p.getY(i); }
      uv[i * 2] = u / scale; uv[i * 2 + 1] = v / scale;
    }
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  }
  // a lumpy version of a geometry (hedges, canopies): every vertex pushed along its normal by smooth noise
  function lumpy(g, amt, freq, seed) {
    g = g.index ? g.toNonIndexed() : g.clone();
    g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal, f = freq, s = seed || 0;
    // weld by position so the faces stay joined: same position -> same push
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = Math.sin(x * f + s) * Math.cos(z * f * 1.3 + s * 2) + 0.6 * Math.sin(y * f * 1.7 + x * f * 0.6 + s) + 0.35 * Math.sin((x + z) * f * 3.1 + y * 2.3);
      const len = Math.hypot(x, y, z) || 1;
      p.setXYZ(i, x + (x / len) * k * amt, y + (y / len) * k * amt, z + (z / len) * k * amt);
    }
    g.computeVertexNormals();
    return g;
  }
  // a hip roof over a rectangle at height y, ridge h higher; shingle UVs run along each eave
  function hipRoof(x0, x1, z0, z1, y, h) {
    const d = z1 - z0, hd = Math.min(d / 2, (x1 - x0) / 2), zc = (z0 + z1) / 2;
    const A = [x0, y, z0], B = [x1, y, z0], C = [x1, y, z1], D = [x0, y, z1], R1 = [x0 + hd, y + h, zc], R2 = [x1 - hd, y + h, zc];
    const pos = [], uv = [];
    const slope = Math.hypot(d / 2, h);
    const tri = (a, b, c, uvf) => { [a, b, c].forEach((v) => { pos.push(v[0], v[1], v[2]); const t = uvf(v); uv.push(t[0] / 2, t[1] / 2); }); };
    const front = (v) => [v[0], (z1 - v[2]) / (d / 2) * slope], back = (v) => [-v[0], (v[2] - z0) / (d / 2) * slope];
    const west = (v) => [v[2], (v[0] - x0) / hd * slope], east = (v) => [-v[2], (x1 - v[0]) / hd * slope];
    tri(D, C, R2, front); tri(D, R2, R1, front);
    tri(B, A, R1, back); tri(B, R1, R2, back);
    tri(A, D, R1, west); tri(C, B, R2, east);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  }
  // a shape in the (u, v) plane pushed out `depth` along +Z, bevelled; returned centred on its depth
  function extrude(pts, depth, bevel, curveSeg) {
    const sh = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1])));
    const g = new THREE.ExtrudeGeometry(sh, { depth: depth - 2 * (bevel || 0), bevelEnabled: !!bevel, bevelThickness: bevel || 0, bevelSize: bevel || 0, bevelSegments: HI() ? 3 : 1, curveSegments: curveSeg || 8 });
    g.translate(0, 0, -(depth - 2 * (bevel || 0)) / 2);
    return g;
  }

  W.build = function (sim, V) {
    const L = sim.level, night = !!sim.shift.night, hi = HI();
    const group = new THREE.Group();
    // ---- materials, made on first use
    const mats = {};
    const lam = (o) => new THREE.MeshLambertMaterial(o);
    const MAT = {
      stucco: () => lam({ color: COL.stucco, map: stuccoTex(), bumpMap: stuccoBump(), bumpScale: 1.2 }),
      stuccoB: () => lam({ color: COL.stuccoB, map: stuccoTex(), bumpMap: stuccoBump(), bumpScale: 1.2 }),
      trim: () => lam({ color: COL.trim }), base: () => lam({ color: COL.base, map: stuccoTex() }),
      shingle: () => lam({ map: shingleTex() }), soffit: () => lam({ color: 0xd8d0c0, emissive: night ? 0x000000 : 0x4a4436 }),
      slab: () => lam({ color: COL.slab, map: concreteTex() }), concrete: () => lam({ map: concreteTex() }),
      grass: () => lam({ map: grassTex() }), asphalt: () => lam({ map: asphaltTex() }), line: () => lam({ color: COL.line }),
      rail: () => lam({ color: COL.rail }), tread: () => lam({ color: COL.tread, map: concreteTex() }), riser: () => lam({ color: COL.riser }),
      door: () => lam({ color: COL.door }), doorB: () => lam({ color: COL.doorB }), brass: () => lam({ color: COL.brass, emissive: 0x2a1e08 }),
      pane: () => lam({ map: paneTex(false) }), paneLit: () => new THREE.MeshBasicMaterial({ map: paneTex(true) }),
      gutter: () => lam({ color: COL.gutter }), hedge: () => lam({ color: 0x8fb07a, map: leafTex() }),
      leaf: () => lam({ color: 0xffffff, map: leafTex() }), pine: () => lam({ color: 0x7f9f6a, map: leafTex() }), bark: () => lam({ map: barkTex() }),
      fence: () => lam({ map: fenceTex() }), fencePost: () => lam({ color: 0x8a6a48 }), mat: () => lam({ color: COL.mat }),
      matB: () => lam({ color: 0x3b4a5a }), van: () => lam({ color: COL.van }), stripe: () => lam({ color: COL.stripe }),
      glass: () => lam({ color: 0x6f8798, emissive: night ? 0x05080b : 0x1a2733 }), tire: () => lam({ color: COL.tire }), chrome: () => lam({ color: COL.chrome }),
      hub: () => lam({ color: 0x9aa0a6 }), headlight: () => new THREE.MeshBasicMaterial({ color: night ? 0xfff4d8 : 0xe8e8e0 }), taillight: () => lam({ color: 0xa3141a, emissive: night ? 0x600000 : 0x200000 }),
      plastic: () => lam({ color: 0x2a2c30 }), dumpster: () => lam({ color: COL.dumpster }), lid: () => lam({ color: COL.lid }),
      cbu: () => lam({ map: cbuTex() }), mailbox: () => lam({ color: COL.mailbox }), ac: () => lam({ color: COL.ac }), grille: () => lam({ map: grillTex() }),
      lightOn: () => new THREE.MeshBasicMaterial({ color: 0xffe2a0 }), lightOff: () => lam({ color: 0x8a867c }), metal: () => lam({ color: 0x3b3f45 }),
      pot: () => lam({ color: 0xa0532e }), wood: () => lam({ color: 0x8a6440 }), cardboard: () => lam({ color: 0xc8925a }),
      cone: () => lam({ color: 0xffcc1a }), wetsign: () => lam({ map: signTex() }), gate: () => lam({ color: COL.gate }),
      tuft: () => lam({ map: tuftTex(), alphaTest: 0.5, side: THREE.DoubleSide }), frond: () => lam({ map: frondTex(), alphaTest: 0.45, side: THREE.DoubleSide }),
      bikeR: () => lam({ color: 0xc23b2a }), bikeB: () => lam({ color: 0x2b6cb0 }), chair: () => lam({ color: 0x3d7fb5 }), grill: () => lam({ color: 0x1f1f22 })
    };
    // each building its own shade of stucco, each door one of six paints
    STUCCO.forEach((c, i) => { MAT["stucco" + i] = () => lam({ color: c, map: stuccoTex(), bumpMap: stuccoBump(), bumpScale: 1.2 }); });
    DOORC.forEach((c, i) => { MAT["door" + i] = () => lam({ color: c }); });
    const mat = (k) => mats[k] || (mats[k] = MAT[k]());

    // ---- batches: geometries merged per material at the end
    // Batched per ~24 m cell as well as per material, so the camera culls the buildings it isn't looking at.
    const batch = {}, CELL = 24;
    function put(key, geo, m, uvScale, noShadow) {
      let g = geo.index ? geo.toNonIndexed() : geo.clone();
      if (m) g.applyMatrix4(m);
      for (const a in g.attributes) if (a !== "position" && a !== "normal" && a !== "uv") g.deleteAttribute(a);
      if (uvScale) worldUV(g, uvScale);
      if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.computeBoundingBox();
      const bb = g.boundingBox, big = bb.max.x - bb.min.x > CELL * 1.5 || bb.max.z - bb.min.z > CELL * 1.5;
      const reg = big ? "g" : Math.floor(((bb.min.x + bb.max.x) / 2 + 100) / CELL) + "_" + Math.floor(((bb.min.z + bb.max.z) / 2 + 100) / CELL);
      const k = reg + "|" + key + (noShadow ? "|ns" : "");
      (batch[k] || (batch[k] = { key: key, list: [], shadow: !noShadow })).list.push(g);
    }
    const UNIT = new THREE.BoxGeometry(1, 1, 1);
    // a box by its extents (r > 0: rounded edges)
    function box(key, x0, x1, y0, y1, z0, z1, r, uvScale, noShadow) {
      const w = x1 - x0, h = y1 - y0, d = z1 - z0;
      if (w <= 0 || h <= 0 || d <= 0) return;
      if (r && Math.min(w, h, d) >= 0.15) put(key, rb(w, h, d, Math.min(r, w / 2, h / 2, d / 2) * 0.999), M((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), uvScale, noShadow);
      else put(key, UNIT, M((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, 0, 0, 0, w, h, d), uvScale, noShadow);
    }
    // instanced copies of one geometry
    const inst = [];
    function instanced(geo, key, list, shadow, colors) {
      if (!list.length) return null;
      const im = new THREE.InstancedMesh(geo, mat(key), list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      if (colors) colors.forEach((c, i) => im.setColorAt(i, new THREE.Color(c)));
      im.castShadow = shadow !== false; im.receiveShadow = true;
      inst.push(im); group.add(im);
      return im;
    }
    const cyl = (rt, rbm, h, seg) => new THREE.CylinderGeometry(rt, rbm, h, seg || (hi ? 16 : 8));

    // ================================================================ ground
    const B = WD.CFG.BOUNDS;
    const ground = (key, x0, x1, z0, z1, y, uvs) => { const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, y, (z0 + z1) / 2); put(key, g, null, uvs, true); };
    // turf everywhere (the lawns, the courtyard, the yards); asphalt for the lot, the alley and the back lane
    ground("grass", B.x0 - 30, B.x1 + 30, B.z0 - 30, B.z1 + 30, -0.02, 4);
    L.asphalt.forEach((a) => ground("asphalt", a[0], a[1], a[2], a[3], 0.0, 6));
    // walkways: raised a touch, with a rounded curb edge (the sim lists every one)
    const walk = (x0, x1, z0, z1) => { box("concrete", x0, x1, -0.05, 0.03, z0, z1, 0.02, 1.5, true); };
    L.walks.forEach((w) => walk(w[0], w[1], w[2], w[3]));
    // curbs along the lot
    box("concrete", B.x0, B.x1, 0, 0.14, 13.25, 13.5, 0.03, 1.5);
    // parking: stripes, a wheel stop in each bay
    for (let x = -57; x <= 57; x += 6) ground("line", x - 0.06, x + 0.06, 26.3, 32, 0.012);
    for (let x = -54; x <= 54; x += 6) box("concrete", x - 0.8, x + 0.8, 0, 0.13, 32.4, 32.65, 0.04, 1.5);
    for (let x = -57; x <= 57; x += 3) ground("line", x - 0.5, x + 0.5, 17.47, 17.53, 0.012);   // the drive lane's centre line
    for (let x = -58; x <= 58; x += 4) ground("line", x - 0.7, x + 0.7, -15.05, -14.95, 0.012);   // the alley's centre line
    for (let x = -58; x <= 58; x += 4) ground("line", x - 0.7, x + 0.7, -65.05, -64.95, 0.012);   // the back lane's

    // ================================================================ the wings
    const F = WD.CFG.FLOOR, shrubs = [];
    for (const s of L.solids) {
      if (s.kind !== "building") continue;
      const wingB = s.nz < 0, st = "stucco" + (s.bi % STUCCO.length);   // wingB: its doors face north
      box(st, s.x0, s.x1, s.y0 + 0.5, s.y1, s.z0, s.z1, 0, 1);
      // a darker base course, a belly band at the upper floor, a frieze under the eaves
      box("base", s.x0 - 0.04, s.x1 + 0.04, 0, 0.5, s.z0 - 0.04, s.z1 + 0.04, 0.02, 1);
      box("trim", s.x0 - 0.06, s.x1 + 0.06, F - 0.32, F - 0.14, s.z0 - 0.06, s.z1 + 0.06, 0.03);
      box("trim", s.x0 - 0.05, s.x1 + 0.05, s.y1 - 0.28, s.y1, s.z0 - 0.05, s.z1 + 0.05, 0.03);
      // the hip roof reaches over the upper walkway on the door side
      const rz0 = wingB ? s.z0 - 2.45 : s.z0 - 0.55, rz1 = wingB ? s.z1 + 0.55 : s.z1 + 2.45;
      put("shingle", hipRoof(s.x0 - 0.55, s.x1 + 0.55, rz0, rz1, s.y1, 1.9));
      const sof = new THREE.PlaneGeometry(s.x1 - s.x0 + 1.1, rz1 - rz0); sof.rotateX(Math.PI / 2); sof.translate((s.x0 + s.x1) / 2, s.y1 - 0.01, (rz0 + rz1) / 2);
      put("soffit", sof, null, null, true);
      // fascia and gutters round the eave, downspouts at the corners
      box("trim", s.x0 - 0.58, s.x1 + 0.58, s.y1 - 0.2, s.y1 + 0.04, rz0 - 0.03, rz0 + 0.02);
      box("trim", s.x0 - 0.58, s.x1 + 0.58, s.y1 - 0.2, s.y1 + 0.04, rz1 - 0.02, rz1 + 0.03);
      box("trim", s.x0 - 0.58, s.x0 - 0.53, s.y1 - 0.2, s.y1 + 0.04, rz0, rz1); box("trim", s.x1 + 0.53, s.x1 + 0.58, s.y1 - 0.2, s.y1 + 0.04, rz0, rz1);
      for (const ez of [rz0 - 0.09, rz1 + 0.09]) {
        const gl = s.x1 - s.x0 + 1.16, gg = cyl(0.07, 0.07, gl, hi ? 10 : 6); gg.rotateZ(Math.PI / 2);
        put("gutter", gg, M((s.x0 + s.x1) / 2, s.y1 - 0.12, ez));
      }
      const backZ = wingB ? s.z1 + 0.06 : s.z0 - 0.06;
      for (const x of [s.x0 + 0.25, s.x1 - 0.25]) put("gutter", cyl(0.045, 0.045, s.y1 - 0.15, hi ? 10 : 6), M(x, (s.y1 - 0.15) / 2, backZ));
      // windows across the back (both floors); wing B's back is the face you see from the van
      const bz = wingB ? s.z1 : s.z0, bf = wingB ? 1 : -1;
      for (let x = s.x0 + 2.25; x < s.x1; x += 4.5) for (const y of [0, F]) windowAt(x, y + 0.95, bz, bf, 1.5, 1.1, (x * 7 + y) % 5 < 2);
      // (the AC condensers along the back walls are sim solids, drawn in the solids pass below)
      // roof vents along the ridge, a shrub bed in front of each unit, a dryer vent on the back
      const ridgeZ = (rz0 + rz1) / 2;
      for (const o of [5, 13.5, 22]) { put("metal", cyl(0.13, 0.13, 0.55, hi ? 10 : 6), M(s.x0 + o, s.y1 + 1.95, ridgeZ)); put("metal", new THREE.ConeGeometry(0.2, 0.14, hi ? 10 : 6), M(s.x0 + o, s.y1 + 2.28, ridgeZ)); }
      const frontZ = wingB ? s.z0 - 2.9 : s.z1 + 2.9;
      for (let i = 0; i < 6; i++) shrubs.push(M(s.x0 + 4.5 * i + (s.mir ? 1.1 : 3.4), 0.28, frontZ, i * 1.3 + s.bi, 0, 0, 0.8 + ((i * 37 + s.bi * 11) % 5) * 0.09, 0.7 + ((i * 13 + s.bi) % 4) * 0.1, 0.8 + ((i * 29) % 5) * 0.08));
    }
    // the breezeways: a flat roof with a parapet, and the ceiling under the deck with two lights
    for (const bz of L.breezes) {
      const Zl = (lz) => bz.oz + bz.nz * lz, rng = (a, b) => [Math.min(Zl(a), Zl(b)), Math.max(Zl(a), Zl(b))];
      let r = rng(-10.05, -9.75); box("stucco" + (bz.row * 3), bz.x0, bz.x1, 6.4, 7.2, r[0], r[1], 0, 1);
      r = rng(-0.25, 0.05); box("stucco" + (bz.row * 3), bz.x0, bz.x1, 6.4, 7.2, r[0], r[1], 0, 1);
      r = rng(-10.1, 0.1); box("trim", bz.x0 - 0.05, bz.x1 + 0.05, 7.2, 7.3, r[0], r[1], 0.03);
      for (const lz of [-7.5, -2.5]) { put("metal", cyl(0.18, 0.2, 0.06), M(bz.cx, F - 0.24, Zl(lz))); put("lightOn", cyl(0.15, 0.15, 0.04), M(bz.cx, F - 0.28, Zl(lz)), null, true); }
    }

    // ---- doors: one shared panel-door geometry (door + hardware), hinged so a resident can open it
    W.doorMeshes = {};
    let _pool = null, _wash = null;   // the night porch glows (poolMat / washMat below)
    const doorGeo = (function () {
      const parts = [];
      const add = (g, m) => { const c = g.index ? g.toNonIndexed() : g.clone(); c.applyMatrix4(m); for (const a in c.attributes) if (a !== "position" && a !== "normal" && a !== "uv") c.deleteAttribute(a); parts.push(c); };
      add(rb(1.0, 2.12, 0.05, 0.012), M(0.5, 1.06, 0));
      // six raised panels on the outside face
      [[0.27, 1.78, 0.32], [0.73, 1.78, 0.32], [0.27, 1.17, 0.62], [0.73, 1.17, 0.62], [0.27, 0.45, 0.6], [0.73, 0.45, 0.6]].forEach((p) => add(rb(0.34, p[2], 0.02, 0.008), M(p[0], p[1], 0.026)));
      const slab = WD.mergeGeometries(parts);
      const hw = [];
      const addH = (g, m) => { const c = g.index ? g.toNonIndexed() : g.clone(); c.applyMatrix4(m); for (const a in c.attributes) if (a !== "position" && a !== "normal" && a !== "uv") c.deleteAttribute(a); hw.push(c); };
      const rose = cyl(0.032, 0.032, 0.02); rose.rotateX(Math.PI / 2);
      addH(rose, M(0.86, 1.0, 0.035)); addH(rose, M(0.86, 1.18, 0.035));
      addH(rb(0.12, 0.022, 0.022, 0.009), M(0.81, 1.0, 0.055));        // lever
      const bolt = cyl(0.016, 0.016, 0.03); bolt.rotateX(Math.PI / 2); addH(bolt, M(0.86, 1.18, 0.05));
      const peep = cyl(0.011, 0.011, 0.02); peep.rotateX(Math.PI / 2); addH(peep, M(0.5, 1.55, 0.035));
      addH(rb(0.9, 0.2, 0.006, 0.002), M(0.5, 0.13, 0.03));              // kick plate
      return { slab: slab, hw: WD.mergeGeometries(hw) };
    })();
    const plaqueGeo = rb(0.4, 0.31, 0.03, 0.01), wreathGeo = new THREE.TorusGeometry(0.17, 0.04, 6, hi ? 14 : 8);
    // the number plaques share one atlas (one cell per door), so they batch instead of costing a draw call each
    const ACOLS = 8, CW = 128, CH = 96, AROWS = Math.ceil(L.doors.length / ACOLS);
    const atlasC = document.createElement("canvas"); atlasC.width = ACOLS * CW; atlasC.height = AROWS * CH;
    const ag = atlasC.getContext("2d");
    L.doors.forEach((d, i) => {
      const dk = night && d.unit % 3 !== 1, ax = (i % ACOLS) * CW, ay = Math.floor(i / ACOLS) * CH;   // on night shift some porch lights are out and those are hard to read
      ag.fillStyle = dk ? "#58554f" : "#f4efe4"; ag.fillRect(ax, ay, CW, CH);
      ag.strokeStyle = dk ? "#3a3833" : "#8a7a5a"; ag.lineWidth = 6; ag.strokeRect(ax + 3, ay + 3, CW - 6, CH - 6);
      ag.fillStyle = dk ? "#2a2825" : "#1d1a16"; ag.font = "800 " + Math.round(CH * 0.72 * (String(d.unit).length > 2 ? 0.8 : 1)) + "px Trebuchet MS, Segoe UI, sans-serif";
      ag.textAlign = "center"; ag.textBaseline = "middle"; ag.fillText(String(d.unit), ax + CW / 2, ay + CH / 2 + CH * 0.04);
    });
    const atlas = new THREE.CanvasTexture(atlasC); atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 4;
    MAT.plaque = () => lam({ map: atlas }); MAT.plaqueLit = () => new THREE.MeshBasicMaterial({ map: atlas });
    MAT.pool = () => poolMat(); MAT.wash = () => washMat();
    const doorColors = []; let wreathCount = 0;
    for (let di = 0; di < L.doors.length; di++) {
      const d = L.doors[di];
      const f = d.nz, ry = f > 0 ? 0 : Math.PI, dir = d.dir, paint = (d.unit * 5 + d.bldg * 2) % DOORC.length;
      // casing round the door, a little cornice over it, the threshold
      const zf = (a, b) => [Math.min(d.z + f * a, d.z + f * b), Math.max(d.z + f * a, d.z + f * b)];
      let zz = zf(-0.01, 0.07);
      box("trim", d.x - 0.64, d.x - 0.52, d.y, d.y + 2.24, zz[0], zz[1], 0.015);
      box("trim", d.x + 0.52, d.x + 0.64, d.y, d.y + 2.24, zz[0], zz[1], 0.015);
      zz = zf(-0.01, 0.1); box("trim", d.x - 0.72, d.x + 0.72, d.y + 2.22, d.y + 2.36, zz[0], zz[1], 0.02);
      zz = zf(-0.01, 0.13); box("trim", d.x - 0.76, d.x + 0.76, d.y + 2.36, d.y + 2.4, zz[0], zz[1], 0.01);
      zz = zf(0, 0.12); box("tread", d.x - 0.55, d.x + 0.55, d.y, d.y + 0.035, zz[0], zz[1], 0.01, null, true);
      // the door itself hinges at its left edge (one instanced mesh for all the doors; a few wear a wreath)
      doorColors.push(DOORC[paint]);
      const dm = W.doorMeshes[d.unit] = { i: di, door: d, open: 0, shown: -1, want: 0, left: 0, base: ry, hx: d.x - 0.5 * f, hy: d.y, hz: d.z + f * 0.035, wreath: (d.unit * 7 + d.bldg) % 7 === 2 ? wreathCount++ : -1 };
      void dm;
      // the number plaque (a cell of the atlas)
      const dark = night && d.unit % 3 !== 1;
      put("brass", plaqueGeo, M(d.x + dir * 0.9, d.y + 1.75, d.z + f * 0.015));
      const pg = new THREE.PlaneGeometry(0.36, 0.27), uv = pg.attributes.uv, col = di % ACOLS, row = Math.floor(di / ACOLS);
      for (let k = 0; k < uv.count; k++) uv.setXY(k, (col + uv.getX(k)) / ACOLS, 1 - (row + 1) / AROWS + uv.getY(k) / AROWS);
      put(night && !dark ? "plaqueLit" : "plaque", pg, M(d.x + dir * 0.9, d.y + 1.75, d.z + f * 0.032, ry), null, true);
      // the porch sconce: back plate, arm, a glass lantern, its cap
      const sx = d.x + dir * 0.9, sy = d.y + 2.12;
      zz = zf(0, 0.025); box("metal", sx - 0.055, sx + 0.055, sy - 0.12, sy + 0.12, zz[0], zz[1], 0.01);
      put("metal", rb(0.03, 0.03, 0.1, 0.008), M(sx, sy, d.z + f * 0.07));
      put(dark ? "lightOff" : "lightOn", cyl(0.058, 0.05, 0.17, 6), M(sx, sy + 0.02, d.z + f * 0.14), null, true);
      put("metal", new THREE.ConeGeometry(0.085, 0.07, 6), M(sx, sy + 0.14, d.z + f * 0.14));
      put("metal", cyl(0.06, 0.06, 0.015, 6), M(sx, sy - 0.065, d.z + f * 0.14));
      if (night && !dark) {   // a lit porch throws a pool of light (a drawn glow, not a real light: the laptop can't afford 24)
        const pool = new THREE.PlaneGeometry(3.4, 2.6); pool.rotateX(-Math.PI / 2); put("pool", pool, M(d.x + f * 0.4, d.y + 0.04, d.z + f * 1.1), null, true);
        put("wash", new THREE.PlaneGeometry(2.6, 2.6), M(d.x + f * 0.6, d.y + 1.5, d.z + f * 0.03, ry), null, true);
      }
      // the window beside the door, and a doormat (some say WELCOME)
      windowAt(d.x + dir * 2.05, d.y + 0.9, d.z, f, 1.5, 1.2, night && d.unit % 2 === 0);
      zz = zf(0.14, 0.8); box(d.unit % 4 === 1 ? "matB" : "mat", d.x - 0.45, d.x + 0.45, d.y, d.y + 0.03, zz[0], zz[1], 0.012, null, true);
    }
    // the doors: instanced, each posed by its own hinge matrix (re-posed only while one is swinging)
    const nD = L.doors.length;
    const slabsI = new THREE.InstancedMesh(doorGeo.slab, new THREE.MeshLambertMaterial({ color: 0xffffff }), nD);
    const hwI = new THREE.InstancedMesh(doorGeo.hw, mat("brass"), nD), wrI = new THREE.InstancedMesh(wreathGeo, mat("leaf"), Math.max(1, wreathCount));
    slabsI.castShadow = true; slabsI.receiveShadow = true; wrI.count = wreathCount;
    doorColors.forEach((c, i) => slabsI.setColorAt(i, new THREE.Color(c)));
    group.add(slabsI, hwI, wrI);
    const _dm = new THREE.Matrix4(), _wm = new THREE.Matrix4();
    function setDoor(dm) {
      _dm.compose(_p.set(dm.hx, dm.hy, dm.hz), _q.setFromEuler(_e.set(0, dm.base - dm.open * 1.25, 0)), _s.set(1, 1, 1));   // swings out (the unit behind is solid)
      slabsI.setMatrixAt(dm.i, _dm); hwI.setMatrixAt(dm.i, _dm);
      if (dm.wreath >= 0) { _wm.makeTranslation(0.5, 1.5, 0.05); _wm.premultiply(_dm); wrI.setMatrixAt(dm.wreath, _wm); }
      slabsI.instanceMatrix.needsUpdate = hwI.instanceMatrix.needsUpdate = wrI.instanceMatrix.needsUpdate = true;
      dm.shown = dm.open;
    }
    for (const u in W.doorMeshes) setDoor(W.doorMeshes[u]);
    // a window: casing, a projecting sill, a meeting rail between two sliding sashes, the pane (blinds + reflection)
    function windowAt(x, y, z, f, w, h, lit) {
      const zf = (a, b) => [Math.min(z + f * a, z + f * b), Math.max(z + f * a, z + f * b)];
      let zz = zf(-0.01, 0.06);
      box("trim", x - w / 2 - 0.08, x + w / 2 + 0.08, y + h, y + h + 0.1, zz[0], zz[1], 0.015);
      box("trim", x - w / 2 - 0.08, x - w / 2, y, y + h, zz[0], zz[1], 0.015); box("trim", x + w / 2, x + w / 2 + 0.08, y, y + h, zz[0], zz[1], 0.015);
      zz = zf(-0.01, 0.12); box("trim", x - w / 2 - 0.14, x + w / 2 + 0.14, y - 0.07, y + 0.01, zz[0], zz[1], 0.015);
      zz = zf(0.02, 0.05); box("trim", x - 0.03, x + 0.03, y, y + h, zz[0], zz[1], 0.008);
      const pane = new THREE.PlaneGeometry(w, h); if (f < 0) pane.rotateY(Math.PI); pane.translate(x, y + h / 2, z + f * 0.015);
      put(lit ? "paneLit" : "pane", pane, null, null, true);
    }
    function glowTex() {
      return canvasTex("glow", 128, 128, (g) => { const r = g.createRadialGradient(64, 64, 4, 64, 64, 64); r.addColorStop(0, "rgba(255,214,150,0.85)"); r.addColorStop(0.5, "rgba(255,200,130,0.35)"); r.addColorStop(1, "rgba(255,200,130,0)"); g.fillStyle = r; g.fillRect(0, 0, 128, 128); });
    }
    function poolMat() { return _pool || (_pool = new THREE.MeshBasicMaterial({ map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); }
    function washMat() { return _wash || (_wash = new THREE.MeshBasicMaterial({ map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 })); }

    // ================================================================ everything else the sim collides with
    const balusters = [], railPosts = [], fencePosts = [], gateBars = [];
    const cars = { sedan: [], suv: [] }, carCols = { sedan: [], suv: [] };   // filled by carParts, built by buildCars
    const balG = cyl(0.013, 0.013, 1, hi ? 4 : 3);   // square-ish pickets: 2.6 cm wide, nobody counts the sides
    for (const s of L.solids) {
      const k = s.kind;
      if (k === "slab") {
        box("slab", s.x0, s.x1, s.y0, s.y1, s.z0, s.z1, 0, 1.5);
        // the balcony's fascia on its open edges
        if (s.z1 - s.z0 < 3) { const ez = s.z1 > 0.5 ? s.z1 : s.z0; box("trim", s.x0, s.x1, s.y0 - 0.12, s.y1 + 0.02, ez - 0.05, ez + 0.05, 0.02); }
      } else if (k === "roof") { /* the breezeway roof: drawn above */ }
      else if (k === "rail") {
        const alongX = s.x1 - s.x0 > s.z1 - s.z0, len = alongX ? s.x1 - s.x0 : s.z1 - s.z0, cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
        // top rail (rounded), bottom rail, balusters every 11 cm, a post every 2.25 m
        if (alongX) { box("rail", s.x0, s.x1, s.y1 - 0.055, s.y1, cz - 0.045, cz + 0.045, 0.02); box("rail", s.x0, s.x1, s.y0 + 0.08, s.y0 + 0.12, cz - 0.02, cz + 0.02, 0.01); }
        else { box("rail", cx - 0.045, cx + 0.045, s.y1 - 0.055, s.y1, s.z0, s.z1, 0.02); box("rail", cx - 0.02, cx + 0.02, s.y0 + 0.08, s.y0 + 0.12, s.z0, s.z1, 0.01); }
        const n = Math.max(2, Math.round(len / 0.11)), bh = s.y1 - s.y0 - 0.14;
        for (let i = 1; i < n; i++) { const t = i / n, x = alongX ? s.x0 + len * t : cx, z = alongX ? cz : s.z0 + len * t; balusters.push(M(x, s.y0 + 0.08 + bh / 2, z, 0, 0, 0, 1, bh, 1)); }
        const np = Math.max(1, Math.round(len / 2.25));
        for (let i = 0; i <= np; i++) { const t = i / np, x = alongX ? s.x0 + len * t : cx, z = alongX ? cz : s.z0 + len * t; railPosts.push(M(x, (s.y0 + s.y1) / 2, z)); }
      } else if (k === "stairwall") {
        box("stucco", s.x0, s.x1, s.y0, s.y1, s.z0, s.z1, 0, 1);
        box("trim", s.x0 - 0.03, s.x1 + 0.03, s.y1, s.y1 + 0.06, s.z0 - 0.03, s.z1 + 0.03, 0.02);
      } else if (k === "post") {
        // the walkway posts: a square column with a base and a cap, carried up to the roof eave
        const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
        box("trim", cx - 0.09, cx + 0.09, 0, 6.8, cz - 0.09, cz + 0.09, 0.02);
        box("trim", cx - 0.13, cx + 0.13, 0, 0.22, cz - 0.13, cz + 0.13, 0.02);
        box("trim", cx - 0.12, cx + 0.12, F - 0.38, F - 0.3, cz - 0.12, cz + 0.12, 0.02);
      } else if (k === "hedge") {
        const w = s.x1 - s.x0, h = s.y1 - s.y0, d = s.z1 - s.z0;
        const g = new THREE.BoxGeometry(w, h, d, Math.max(2, Math.round(w * (hi ? 3 : 1))), hi ? 4 : 2, hi ? 3 : 2);
        const lg = lumpy(g, 0.08, 2.1, s.x0);
        put("hedge", lg, M((s.x0 + s.x1) / 2, h / 2, (s.z0 + s.z1) / 2), 1.2);
      } else if (k === "dumpster") dumpster(s);
      else if (k === "mailbox") mailboxes(s);
      else if (k === "car") carParts(s);
      else if (k === "van") van(s);
      else if (k === "gate") {
        box("gate", s.x0, s.x1, s.y1 - 0.08, s.y1, s.z0, s.z1, 0.02); box("gate", s.x0, s.x1, 0.15, 0.22, s.z0, s.z1, 0.02); box("gate", s.x0, s.x1, s.y1 - 0.5, s.y1 - 0.45, s.z0, s.z1, 0.015);
        for (let x = s.x0 + 0.1; x < s.x1; x += 0.13) gateBars.push(M(x, s.y1 / 2, (s.z0 + s.z1) / 2));
        box("gate", s.x0 - 0.05, s.x0 + 0.05, 0, s.y1 + 0.15, s.z0 - 0.03, s.z1 + 0.03, 0.02); box("gate", s.x1 - 0.05, s.x1 + 0.05, 0, s.y1 + 0.15, s.z0 - 0.03, s.z1 + 0.03, 0.02);
        put("brass", rb(0.08, 0.14, 0.12, 0.02), M(0, 1.1, (s.z0 + s.z1) / 2));   // the padlock
      } else if (k === "ac") {
        // a condenser: a cabinet with grille sides, a fan guard on top, the line set into the wall
        const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2, w = s.x1 - s.x0, d = s.z1 - s.z0;
        box("ac", s.x0, s.x1, 0.08, s.y1 - 0.05, s.z0, s.z1, 0.03);
        box("grille", s.x0 + 0.04, s.x1 - 0.04, 0.15, s.y1 - 0.12, s.z0 - 0.005, s.z1 + 0.005, 0, 0.5);
        put("metal", cyl(Math.min(w, d) * 0.4, Math.min(w, d) * 0.4, 0.03), M(cx, s.y1 - 0.03, cz));
        box("concrete", s.x0 - 0.08, s.x1 + 0.08, 0, 0.08, s.z0 - 0.08, s.z1 + 0.08, 0.02, 1.5);
      }
    }
    instanced(balG, "rail", balusters, false);
    instanced(rb(0.07, 1.05, 0.07, 0.015), "rail", railPosts);
    if (gateBars.length) { instanced(cyl(0.015, 0.015, 2.4, hi ? 8 : 5), "gate", gateBars, false); }

    // ---- stairs: treads with a rounded nosing over steel risers, stringers, a handrail on each wall
    for (const s of L.surfaces) {
      if (!s.ramp) continue;
      const n = Math.max(8, Math.round(Math.abs(s.yb - s.ya) / 0.18));
      for (let i = 0; i < n; i++) {
        const u0 = s.a + (s.b - s.a) * (i / n), u1 = s.a + (s.b - s.a) * ((i + 1) / n), h = s.ya + (s.yb - s.ya) * ((i + 0.5) / n) + 0.1;
        const lo = Math.min(u0, u1), hiU = Math.max(u0, u1), nose = (s.b > s.a) === (s.yb < s.ya) ? -0.03 : 0.03;
        if (s.axis === "x") { box("riser", lo, hiU, Math.max(0, h - 0.6), h - 0.04, s.z0 + 0.04, s.z1 - 0.04, 0); box("tread", lo + Math.min(0, nose), hiU + Math.max(0, nose), h - 0.05, h, s.z0 + 0.02, s.z1 - 0.02, 0.018, 1); }
        else { box("riser", s.x0 + 0.04, s.x1 - 0.04, Math.max(0, h - 0.6), h - 0.04, lo, hiU, 0); box("tread", s.x0 + 0.02, s.x1 - 0.02, h - 0.05, h, lo + Math.min(0, nose), hiU + Math.max(0, nose), 0.018, 1); }
      }
      // handrails: a round rail 0.9 m over the nosings, on brackets off each side wall
      const len = Math.abs(s.b - s.a), rise = s.ya - s.yb, ang = Math.atan2(rise, len);
      const sides = s.axis === "x" ? [s.z0 + 0.06, s.z1 - 0.06] : [s.x0 + 0.06, s.x1 - 0.06];
      for (const side of sides) {
        const rg = cyl(0.025, 0.025, Math.hypot(len, rise) + 0.3, hi ? 10 : 6);
        const mid = (s.a + s.b) / 2, my = (s.ya + s.yb) / 2 + 0.98;
        // the rail climbs toward `a` (the top of the flight)
        if (s.axis === "x") { rg.rotateZ(Math.PI / 2); put("rail", rg, M(mid, my, side, 0, 0, (s.b > s.a ? -1 : 1) * ang)); }
        else { rg.rotateX(Math.PI / 2); put("rail", rg, M(side, my, mid, 0, (s.b > s.a ? 1 : -1) * ang, 0)); }
        for (let t = 0.15; t < 1; t += 0.35) {   // brackets
          const u = s.a + (s.b - s.a) * t, y = s.ya + (s.yb - s.ya) * t + 0.98;
          if (s.axis === "x") box("rail", u - 0.015, u + 0.015, y - 0.12, y - 0.02, side - 0.015, side + 0.015);
          else box("rail", side - 0.015, side + 0.015, y - 0.12, y - 0.02, u - 0.015, u + 0.015);
        }
      }
    }

    // ================================================================ props
    function dumpster(s) {
      const x0 = s.x0, x1 = s.x1, z0 = s.z0, z1 = s.z1, h = s.y1, d = z1 - z0;
      // the bin: back taller than the front, extruded along x
      const g = extrude([[0, 0.18], [d, 0.18], [d + 0.06, h - 0.1], [-0.02, h - 0.3]], x1 - x0, 0.03);
      g.rotateY(-Math.PI / 2);
      put("dumpster", g, M((x0 + x1) / 2, 0, z0));
      // two plastic lids, sloping, slightly open on one
      const lw = (x1 - x0) / 2 - 0.03, slope = Math.atan2(0.2, d);
      for (let i = 0; i < 2; i++) put("lid", rb(lw, 0.06, d + 0.16, 0.02), M(x0 + 0.03 + lw / 2 + i * (lw + 0.03), h - 0.18 + (i ? 0.03 : 0), (z0 + z1) / 2, 0, -slope - (i ? 0.08 : 0)));
      box("metal", x0 - 0.06, x1 + 0.06, h - 0.45, h - 0.33, z0 - 0.06, z0 + 0.04, 0.02);   // the fork sleeves
      for (const x of [x0 + 0.25, x1 - 0.25]) for (const z of [z0 + 0.25, z1 - 0.25]) { const w = cyl(0.08, 0.08, 0.06, 10); w.rotateZ(Math.PI / 2); put("tire", w, M(x, 0.09, z)); }
    }
    function mailboxes(s) {
      const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
      box("metal", cx - 0.3, cx + 0.3, 0, 0.35, cz - 0.3, cz + 0.3, 0.03);
      box("mailbox", s.x0, s.x1, 0.35, s.y1 - 0.1, s.z0 + 0.1, s.z1 - 0.1, 0.03);
      // the grid of little doors on both long faces
      for (const f of [-1, 1]) { const p = new THREE.PlaneGeometry(s.x1 - s.x0 - 0.1, s.y1 - 0.55); if (f < 0) p.rotateY(Math.PI); p.translate(cx, 0.35 + (s.y1 - 0.45) / 2, cz + f * ((s.z1 - s.z0) / 2 - 0.095)); put("cbu", p, null, null, true); }
      const cap = extrude([[-(s.z1 - s.z0) / 2, 0], [(s.z1 - s.z0) / 2, 0], [0, 0.18]], s.x1 - s.x0 + 0.1, 0.01); cap.rotateY(Math.PI / 2);
      put("mailbox", cap, M(cx, s.y1 - 0.1, cz));
    }
    // cars: instanced per body style, coloured per car
    function carParts(s) { const style = s.col % 3 === 1 ? "suv" : "sedan"; cars[style].push(M((s.x0 + s.x1) / 2, 0, (s.z0 + s.z1) / 2, s.col % 2 ? 0 : Math.PI)); carCols[style].push(CAR[s.col % CAR.length]); }
    function buildCars() {
      const styles = {
        sedan: { body: [[-2.2, 0.32], [2.2, 0.32], [2.23, 0.62], [2.05, 0.82], [0.95, 0.9], [0.45, 1.36], [-0.95, 1.38], [-1.65, 0.95], [-2.18, 0.86]], glass: [[0.82, 0.93], [0.4, 1.31], [-0.92, 1.33], [-1.5, 0.95]], w: 1.78, wb: 1.38 },
        suv: { body: [[-2.2, 0.38], [2.2, 0.38], [2.23, 0.72], [2.05, 0.95], [1.15, 1.02], [0.8, 1.62], [-2.05, 1.66], [-2.2, 1.0]], glass: [[1.05, 1.06], [0.76, 1.56], [-1.98, 1.6], [-2.08, 1.06]], w: 1.86, wb: 1.42 }
      };
      for (const k in styles) {
        if (!cars[k].length) continue;
        const st = styles[k];
        // the body: the side profile extruded across the width (rotated so its length runs along z)
        const body = extrude(st.body, st.w, 0.06, 6); body.rotateY(-Math.PI / 2);
        instanced(body, "van", cars[k], true, carCols[k]).material = lam({ color: 0xffffff });
        const gl = extrude(st.glass, st.w + 0.02, 0, 4); gl.rotateY(-Math.PI / 2);
        instanced(gl, "glass", cars[k], false);
        // windscreens: quads along the front and rear slopes
        // (a plane faces +z; turned about x by th it faces (0, -sin th, cos th): forward-and-up in front, back-and-up behind)
        const g0 = st.glass[0], g1 = st.glass[1], g3 = st.glass[3], g2 = st.glass[2];
        const ws = new THREE.PlaneGeometry(st.w - 0.16, Math.hypot(g1[0] - g0[0], g1[1] - g0[1]) + 0.04); ws.rotateX(-Math.atan2(g0[0] - g1[0], g1[1] - g0[1])); ws.translate(0, (g0[1] + g1[1]) / 2 + 0.02, (g0[0] + g1[0]) / 2 + 0.03);
        const rw = new THREE.PlaneGeometry(st.w - 0.2, Math.hypot(g2[0] - g3[0], g2[1] - g3[1])); rw.rotateX(-Math.PI + Math.atan2(g2[0] - g3[0], g2[1] - g3[1])); rw.translate(0, (g2[1] + g3[1]) / 2 + 0.02, (g2[0] + g3[0]) / 2 - 0.03);
        instanced(WD.mergeGeometries([ws.toNonIndexed(), rw.toNonIndexed()]), "glass", cars[k], false);
        // wheels with hubcaps, lights, bumpers
        const wheel = cyl(0.33, 0.33, 0.24, hi ? 20 : 10); wheel.rotateZ(Math.PI / 2);
        const hub = cyl(0.19, 0.19, 0.26, hi ? 14 : 8); hub.rotateZ(Math.PI / 2);
        const wl = [], hl = [];
        for (const sx of [-1, 1]) for (const z of [-st.wb, st.wb]) { const m = M(sx * (st.w / 2 - 0.1), 0.33, z); wl.push(wheel.clone().applyMatrix4(m).toNonIndexed()); hl.push(hub.clone().applyMatrix4(m).toNonIndexed()); }
        instanced(WD.mergeGeometries(wl), "tire", cars[k]); instanced(WD.mergeGeometries(hl), "hub", cars[k], false);
        const lights = [], tails = [], bump = [];
        for (const sx of [-1, 1]) { lights.push(rb(0.36, 0.12, 0.06, 0.02).clone().applyMatrix4(M(sx * 0.6, st.body[2][1] - 0.04, 2.21)).toNonIndexed()); tails.push(rb(0.34, 0.12, 0.06, 0.02).clone().applyMatrix4(M(sx * 0.6, st.body[2][1] - 0.02, -2.21)).toNonIndexed()); }
        bump.push(rb(st.w + 0.04, 0.16, 0.14, 0.05).clone().applyMatrix4(M(0, 0.4, 2.2)).toNonIndexed(), rb(st.w + 0.04, 0.16, 0.14, 0.05).clone().applyMatrix4(M(0, 0.42, -2.2)).toNonIndexed());
        instanced(WD.mergeGeometries(lights), "headlight", cars[k], false); instanced(WD.mergeGeometries(tails), "taillight", cars[k], false); instanced(WD.mergeGeometries(bump), "plastic", cars[k]);
      }
    }
    // the step van: cargo box, a raked cab, wheels, the stripe and lettering, the back open with shelves of parcels
    function van(s) {
      const x0 = s.x0, x1 = s.x1, z0 = s.z0, z1 = s.z1, cz = (z0 + z1) / 2, w = z1 - z0;
      // the cargo box is hollow at the back (roof, floor, sides, a bulkhead) so you can see the shelves inside
      box("van", x0, x0 + 4.1, s.y1 - 0.12, s.y1, z0 + 0.03, z1 - 0.03, 0.05);
      box("van", x0, x0 + 4.1, 0.45, 0.62, z0 + 0.03, z1 - 0.03, 0.05);
      box("van", x0, x0 + 4.1, 0.45, s.y1, z0 + 0.03, z0 + 0.12, 0.04); box("van", x0, x0 + 4.1, 0.45, s.y1, z1 - 0.12, z1 - 0.03, 0.04);
      box("plastic", x0 + 1.6, x0 + 1.7, 0.62, s.y1 - 0.12, z0 + 0.12, z1 - 0.12);
      box("plastic", x0 + 0.02, x0 + 1.6, 0.62, 0.64, z0 + 0.12, z1 - 0.12, 0, null, true);
      const cab = extrude([[0, 0.45], [1.5, 0.45], [1.5, 1.15], [1.38, 1.35], [0.95, 2.4], [0, 2.55]], w - 0.12, 0.05, 4);
      put("van", cab, M(x0 + 4.08, 0, cz));   // the profile runs along +x, its depth across the van
      // the windscreen (on the cab's rake) and the cab side windows
      const ws = new THREE.PlaneGeometry(w - 0.3, 1.1); ws.rotateY(Math.PI / 2); ws.rotateZ(0.39);
      put("glass", ws, M(x0 + 4.08 + 1.2, 1.875, cz), null, true);
      for (const f of [-1, 1]) { const sw = new THREE.PlaneGeometry(0.8, 0.75); if (f < 0) sw.rotateY(Math.PI); sw.translate(x0 + 4.55, 1.85, cz + f * (w / 2 - 0.02)); put("glass", sw, null, null, true); }
      // stripe, lettering, lights, bumpers, mirrors
      for (const f of [-1, 1]) {
        box("stripe", x0 + 0.05, x1 - 0.12, 1.15, 1.38, f < 0 ? z0 : z1 - 0.025, f < 0 ? z0 + 0.025 : z1, 0, null, true);
        const t = new THREE.PlaneGeometry(3.0, 0.62); if (f < 0) t.rotateY(Math.PI); t.translate(x0 + 2.0, 1.95, cz + f * (w / 2 - 0.02));
        put("vanword", t, null, null, true);
        box("plastic", x1 - 0.1, x1 + 0.02, 1.95, 2.3, cz + f * (w / 2 + 0.18) - 0.05, cz + f * (w / 2 + 0.18) + 0.05, 0.02);
        box("plastic", x1 - 0.3, x1 - 0.05, 2.15, 2.18, Math.min(cz + f * w / 2, cz + f * (w / 2 + 0.18)), Math.max(cz + f * w / 2, cz + f * (w / 2 + 0.18)));
        put("headlight", rb(0.06, 0.22, 0.3, 0.03), M(x1 + 0.01, 0.95, cz + f * (w / 2 - 0.32)));
        put("taillight", rb(0.05, 0.3, 0.16, 0.02), M(x0 - 0.01, 0.9, cz + f * (w / 2 - 0.15)));
      }
      box("plastic", x1 - 0.05, x1 + 0.12, 0.35, 0.62, z0 + 0.05, z1 - 0.05, 0.05);
      box("plastic", x0 - 0.3, x0 + 0.1, 0.3, 0.45, z0 + 0.1, z1 - 0.1, 0.03);   // the rear step
      box("metal", x1 + 0.02, x1 + 0.06, 0.7, 1.05, cz - 0.55, cz + 0.55, 0.01);   // grille
      // wheels (duals at the back)
      const wheel = cyl(0.42, 0.42, 0.3, hi ? 22 : 10); wheel.rotateX(Math.PI / 2);
      const hub = cyl(0.22, 0.22, 0.32, hi ? 14 : 8); hub.rotateX(Math.PI / 2);
      for (const x of [x0 + 0.95, x1 - 0.8]) for (const f of [-1, 1]) { put("tire", wheel, M(x, 0.42, cz + f * (w / 2 - 0.12))); put("hub", hub, M(x, 0.42, cz + f * (w / 2 - 0.1))); }
      // the open back: the roll-up door rolled at the top, shelves down both sides full of parcels, an aisle between
      box("van", x0 - 0.04, x0 + 0.06, 2.42, 2.6, z0 + 0.1, z1 - 0.1, 0.04);
      for (const side of [z0 + 0.12, z1 - 0.62]) for (const y of [0.64, 1.22, 1.8]) {
        box("metal", x0 + 0.05, x0 + 1.58, y - 0.03, y, side, side + 0.5, 0.01);
        for (let x = x0 + 0.25; x < x0 + 1.5; x += 0.42) { const b = WD.Gear.parcel(0.36, 0.22 + ((x * 13) % 3) * 0.06, 0.4); b.position.set(x, y + 0.13, side + 0.25); b.rotation.y = (x * 7) % 0.3 - 0.15; group.add(b); }
      }
      for (const side of [z0 + 0.12, z1 - 0.12]) box("metal", x0 + 0.05, x0 + 0.1, 0.62, 2.3, side - 0.02, side + 0.02);
    }
    for (const pr of L.props) {
      const x = pr.x, y = pr.y, z = pr.z;
      if (pr.kind === "plant") {
        // a terracotta pot (lathe) with a leafy shrub in it
        const pot = new THREE.LatheGeometry([[0.0, 0], [0.16, 0], [0.19, 0.03], [0.23, 0.36], [0.26, 0.38], [0.26, 0.42], [0.0, 0.42]].map((p) => new THREE.Vector2(p[0], p[1])), hi ? 20 : 10);
        put("pot", pot, M(x, y, z));
        for (let i = 0; i < 5; i++) { const ang = i * 1.256, r = i ? 0.15 : 0; put("leaf", lumpy(new THREE.IcosahedronGeometry(0.24, hi ? 2 : 1), 0.04, 9, i), M(x + Math.cos(ang) * r, y + 0.65 + (i ? 0 : 0.12), z + Math.sin(ang) * r)); }
      } else if (pr.kind === "bikes") {
        for (let i = 0; i < 2; i++) {
          const bx = x + i * 0.7, key = i ? "bikeR" : "bikeB";
          // wheels with spokes, the frame triangle, bars and a saddle (the bike runs along z)
          for (const o of [-0.52, 0.52]) {
            const t = new THREE.TorusGeometry(0.33, 0.025, 8, hi ? 28 : 14); t.rotateY(Math.PI / 2); put("tire", t, M(bx, y + 0.35, z + o));
            for (let k = 0; k < (hi ? 8 : 4); k++) { const sp = cyl(0.004, 0.004, 0.64, 4); put("chrome", sp, M(bx, y + 0.35, z + o, 0, k * Math.PI / (hi ? 8 : 4))); }
          }
          const tube = (ax, ay, bz, by) => { const len = Math.hypot(bz - ax, by - ay), g = cyl(0.018, 0.018, len, 6); put(key, g, M(bx, y + (ay + by) / 2, z + (ax + bz) / 2, 0, Math.atan2(bz - ax, by - ay))); };
          tube(-0.52, 0.35, 0.0, 0.38); tube(0.0, 0.38, 0.42, 0.8); tube(-0.1, 0.78, 0.42, 0.8); tube(-0.52, 0.35, -0.1, 0.78); tube(0.0, 0.38, -0.12, 0.8); tube(0.52, 0.35, 0.42, 0.8);
          put("plastic", rb(0.1, 0.04, 0.24, 0.02), M(bx, y + 0.84, z - 0.13));
          const bar = cyl(0.014, 0.014, 0.5, 6); bar.rotateZ(Math.PI / 2); put("chrome", bar, M(bx, y + 0.9, z + 0.42));
        }
      } else if (pr.kind === "grill") {
        // a kettle grill: bowl and lid, three legs, an ash pan
        const bowl = new THREE.SphereGeometry(0.32, hi ? 20 : 10, hi ? 12 : 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2); put("grill", bowl, M(x, y + 0.82, z));
        const lid = new THREE.SphereGeometry(0.32, hi ? 20 : 10, hi ? 10 : 5, 0, Math.PI * 2, 0, Math.PI / 2.4); put("grill", lid, M(x, y + 0.83, z));
        put("chrome", rb(0.16, 0.03, 0.03, 0.012), M(x, y + 1.13, z));
        for (let i = 0; i < 3; i++) { const a = i * 2.094; put("metal", cyl(0.012, 0.012, 0.75, 6), M(x + Math.cos(a) * 0.2, y + 0.38, z + Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2, -Math.sin(a) * 0.2)); }
        put("metal", cyl(0.14, 0.14, 0.02), M(x, y + 0.3, z));
      } else if (pr.kind === "chair") {
        // a plastic patio chair
        put("chair", rb(0.5, 0.05, 0.46, 0.02), M(x, y + 0.44, z));
        put("chair", rb(0.5, 0.5, 0.05, 0.02), M(x, y + 0.72, z - 0.25, 0, -0.18));
        for (const sx of [-0.21, 0.21]) for (const sz of [-0.19, 0.19]) put("chair", cyl(0.02, 0.025, 0.44, 8), M(x + sx, y + 0.22, z + sz));
        for (const sx of [-0.25, 0.25]) put("chair", rb(0.04, 0.04, 0.4, 0.015), M(x + sx, y + 0.64, z));
      } else if (pr.kind === "lamp") {
        // a lot light: a tapered pole on a concrete base, an arm, a shoebox head
        put("concrete", cyl(0.22, 0.25, 0.5), M(x, 0.25, z), 1.5);
        put("metal", cyl(0.055, 0.09, 4.2, 10), M(x, 2.6, z));
        put("metal", rb(0.9, 0.06, 0.06, 0.02), M(x, 4.65, z));
        put("metal", rb(0.55, 0.16, 0.34, 0.03), M(x + 0.45, 4.6, z));
        const lens = new THREE.PlaneGeometry(0.48, 0.28); lens.rotateX(Math.PI / 2); put(night ? "lightOn" : "lightOff", lens, M(x + 0.45, 4.515, z), null, true);
      } else if (pr.kind === "bench") {
        // a park bench: slatted seat and back on two cast-iron ends (built round its centre, turned by pr.ry)
        const ry = pr.ry || 0, c = Math.cos(ry), s = Math.sin(ry);
        const part = (key, g, px, py, pz) => put(key, g, M(x + px * c + pz * s, y + py, z - px * s + pz * c, ry));
        for (let i = 0; i < 3; i++) part("wood", rb(1.7, 0.035, 0.12, 0.01), 0, 0.46, -0.16 + i * 0.16);
        for (let i = 0; i < 3; i++) part("wood", rb(1.7, 0.12, 0.03, 0.01), 0, 0.62 + i * 0.15, -0.24);
        for (const sx of [-0.8, 0.8]) { part("metal", rb(0.05, 0.46, 0.5, 0.01), sx, 0.23, 0); part("metal", rb(0.05, 0.5, 0.05, 0.01), sx, 0.7, -0.26); }
      } else if (pr.kind === "bin") {
        put("metal", cyl(0.3, 0.26, 0.85, hi ? 14 : 8), M(x, y + 0.43, z)); put("lid", cyl(0.32, 0.32, 0.06, hi ? 14 : 8), M(x, y + 0.88, z));
      }
    }
    for (const sg of L.signs) {
      const t = labelTex(sg.text, { w: 512, h: 128, bg: "#20425e", fg: "#ffffff", border: "#f4efe4", size: 0.5 });
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.42), lam({ map: t }));
      const flat = sg.ry === 0 || sg.ry === Math.PI, sd = sg.ry === 0 ? 1 : -1;   // a sign on posts faces north or south
      p.position.set(sg.x, sg.y, sg.z + (flat ? 0.03 * sd : 0)); p.rotation.y = sg.ry; group.add(p);
      if (flat) {
        put("metal", rb(1.8, 0.5, 0.04, 0.015), M(sg.x, sg.y, sg.z));
        for (const o of [-0.75, 0.75]) put("metal", cyl(0.03, 0.03, sg.y + 0.25, 8), M(sg.x + o, (sg.y + 0.25) / 2, sg.z - 0.03 * sd));
      }
    }
    // the building letters, big on each building's ends and back wall
    for (const lt of L.letters) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), lam({ map: labelTex(lt.ch, { w: 256, h: 256, bg: "#" + STUCCO[lt.bi % STUCCO.length].toString(16).padStart(6, "0"), fg: "#6e5c50", size: 0.8 }) }));
      p.position.set(lt.x, lt.y, lt.z); p.rotation.y = lt.ry; group.add(p);
    }
    // the van's lettering
    mats.vanword = lam({ map: labelTex("PARCEL", { w: 512, h: 112, bg: "#f4f2ee", fg: "#1d1a16", size: 0.7 }) });
    // wet floor zones: a sheen and an A-frame sign
    for (const w of L.wet) {
      const o = new THREE.Mesh(new THREE.PlaneGeometry(w.x1 - w.x0, w.z1 - w.z0), lam({ color: 0x9fd2ff, transparent: true, opacity: 0.35, emissive: 0x1a3550 }));
      o.rotation.x = -Math.PI / 2; o.position.set((w.x0 + w.x1) / 2, w.y + 0.04, (w.z0 + w.z1) / 2); o.renderOrder = 1; group.add(o);
      const sx = w.x0 + 0.4, sz = (w.z0 + w.z1) / 2;
      for (const f of [-1, 1]) put("wetsign", rb(0.32, 0.62, 0.02, 0.01), M(sx, w.y + 0.3, sz + f * 0.08, f < 0 ? Math.PI : 0, f * 0.2));
      put("cone", cyl(0.02, 0.2, 0.05, 6), M(sx + 0.6, w.y + 0.025, sz)); put("cone", new THREE.ConeGeometry(0.16, 0.55, hi ? 16 : 8), M(sx + 0.6, w.y + 0.3, sz));
    }

    // ================================================================ trees, palms, the fence, grass
    const trnd = WD.rngFrom(99);
    const oaks = [], pines = [], palms = [];
    L.trees.forEach((t) => {
      const m = M(t[0], 0, t[1], trnd() * 6.28, 0, 0, t[2]);
      (t[3] === "oak" ? oaks : t[3] === "pine" ? pines : palms).push(m);
    });
    // trees are instanced per 40 m cell, so the ones out of sight are culled
    const cells = (list) => { const g = {}; list.forEach((m) => { const k = Math.floor((m.elements[12] + 100) / 40) + "_" + Math.floor((m.elements[14] + 100) / 40); (g[k] || (g[k] = [])).push(m); }); return Object.values(g); };
    const instTrees = (geo, key, list, shadow) => cells(list).forEach((c) => instanced(geo, key, c, shadow));
    // a live oak: a forked, tapered trunk under a spread of leafy lobes
    {
      const trunk = [], crown = [];
      const tg = cyl(0.16, 0.26, 2.4, hi ? 10 : 6); trunk.push(tg.clone().translate(0, 1.2, 0).toNonIndexed());
      [[0.7, 0.4], [-0.6, -0.5], [0.1, 0.8]].forEach((b, i) => { const g = cyl(0.07, 0.13, 1.6, hi ? 8 : 5); g.translate(0, 0.8, 0); g.applyMatrix4(M(0, 2.1, 0, i * 2.1, 0.55, 0)); trunk.push(g.toNonIndexed()); void b; });
      [[0, 4.0, 0, 1.55], [1.2, 3.6, 0.3, 1.15], [-1.1, 3.5, -0.4, 1.2], [0.3, 3.4, 1.2, 1.1], [-0.3, 3.7, -1.2, 1.1], [0.2, 4.6, 0.1, 1.0]].forEach((c, i) => {
        const g = lumpy(new THREE.IcosahedronGeometry(c[3], hi ? 2 : 1), 0.16, 2.4, i * 1.7); g.scale(1, 0.78, 1); g.translate(c[0], c[1], c[2]); crown.push(g);
      });
      const tgm = WD.mergeGeometries(trunk), cgm = WD.mergeGeometries(crown);
      worldUV(cgm, 1.4);
      instTrees(tgm, "bark", oaks); instTrees(cgm, "leaf", oaks);
    }
    // a pine: a tall straight trunk and a few lumpy tiers at the top
    {
      const tg = cyl(0.12, 0.2, 5.2, hi ? 10 : 6); tg.translate(0, 2.6, 0);
      const tiers = [];
      [[4.4, 1.3, 1.5], [5.4, 1.05, 1.3], [6.3, 0.75, 1.1], [7.0, 0.4, 0.8]].forEach((t, i) => { const g = lumpy(new THREE.ConeGeometry(t[1], t[2], hi ? 14 : 7, 3), 0.1, 3, i); g.translate(0, t[0], 0); tiers.push(g); });
      const pg = WD.mergeGeometries(tiers); worldUV(pg, 1.2);
      instTrees(tg, "bark", pines); instTrees(pg, "pine", pines);
    }
    // a palm: a curving trunk and a crown of drooping fronds
    {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.2, 2, 0), new THREE.Vector3(0.6, 4, 0), new THREE.Vector3(1.0, 5.8, 0)]);
      const tg = new THREE.TubeGeometry(curve, hi ? 16 : 8, 0.17, hi ? 10 : 6);
      const fr = [];
      for (let i = 0; i < (hi ? 11 : 7); i++) {
        const g = new THREE.PlaneGeometry(2.2, 1.0, hi ? 10 : 4, 1); g.translate(1.1, 0, 0);
        const p = g.attributes.position; for (let k = 0; k < p.count; k++) { const x = p.getX(k); p.setZ(k, 0.17 * x * x); }   // droops once turned flat
        g.rotateX(Math.PI / 2); g.computeVertexNormals();
        g.applyMatrix4(M(1.0, 5.85, 0, i * (6.283 / (hi ? 11 : 7)), 0, 0.25 + (i % 3) * 0.15));
        fr.push(g.toNonIndexed());
      }
      instTrees(tg, "bark", palms); instTrees(WD.mergeGeometries(fr), "frond", palms, true);
    }
    // the wood privacy fence round the site: boards, rails, posts every 2.4 m with caps
    const fenceRun = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0), alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      if (alongX) box("fence", Math.min(x0, x1), Math.max(x0, x1), 0.05, 1.8, z0 - 0.02, z0 + 0.02, 0, 2.4, false);
      else box("fence", x0 - 0.02, x0 + 0.02, 0.05, 1.8, Math.min(z0, z1), Math.max(z0, z1), 0, 2.4, false);
      const n = Math.round(len / 2.4);
      for (let i = 0; i <= n; i++) { const t = i / n; fencePosts.push(M(x0 + (x1 - x0) * t, 0.95, z0 + (z1 - z0) * t)); }
    };
    fenceRun(B.x0, B.z1, B.x1, B.z1); fenceRun(B.x0, B.z0, B.x1, B.z0); fenceRun(B.x0, B.z0, B.x0, B.z1); fenceRun(B.x1, B.z0, B.x1, B.z1);
    instTrees(rb(0.12, 1.9, 0.12, 0.02), "fencePost", fencePosts);
    // a low shrub in front of every unit (the turf has no tufts: it is artificial)
    instTrees(lumpy(new THREE.IcosahedronGeometry(0.55, hi ? 2 : 1), 0.08, 2.1, 3), "hedge", shrubs, false);

    buildCars();

    // ---- merge the batches
    W.stats = {};   // triangles built per material (a look at where the budget goes: WD.World.stats)
    for (const k in batch) {
      const b = batch[k];
      const g = WD.mergeGeometries(b.list);
      const mesh = new THREE.Mesh(g, mats[b.key] || mat(b.key));
      mesh.castShadow = b.shadow; mesh.receiveShadow = true;
      if (b.key === "pool" || b.key === "wash") mesh.renderOrder = 2;   // the night glows draw over everything else
      group.add(mesh);
      W.stats[b.key] = (W.stats[b.key] || 0) + g.attributes.position.count / 3;
    }
    inst.forEach((im) => { const n = (im.geometry.index ? im.geometry.index.count : im.geometry.attributes.position.count) / 3 * im.count, key = "inst:" + Object.keys(mats).find((m) => mats[m] === im.material); W.stats[key] = (W.stats[key] || 0) + n; });

    // ---- light
    const hemi = new THREE.HemisphereLight(night ? 0x6a7ab0 : 0xdfeaff, night ? 0x2a2a36 : 0x7a6d52, night ? 1.1 : 1.35);
    const sun = new THREE.DirectionalLight(night ? 0x9fb4ff : 0xfff1d8, night ? 0.55 : 1.7);   // night: moonlight
    sun.position.set(30, 50, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(hi ? 2048 : 1024, hi ? 2048 : 1024);
    const sc = sun.shadow.camera; sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 140;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
    group.add(hemi, sun, sun.target);
    V.scene.background = new THREE.Color(night ? 0x0d1324 : 0xbfd8ee);
    V.scene.fog = new THREE.Fog(night ? 0x0d1324 : 0xbfd8ee, night ? 18 : 60, night ? 70 : 170);
    // a few real lights at night: four of them, moved to the lamps nearest the driver each frame
    const lamps = L.props.filter((p) => p.kind === "lamp"), lampLights = [];
    if (night) for (let i = 0; i < 4; i++) { const pl = new THREE.PointLight(0xffd69a, 1.4, 22, 1.6); pl.position.set(0, 4.3, 0); group.add(pl); lampLights.push(pl); }
    const _near = [];

    V.scene.add(group);
    return {
      group: group, sun: sun,
      update: function (dt, focus) {
        // the shadow box follows the driver, so it can stay small and sharp
        sun.position.set(focus.x + 30, 50, focus.z + 25); sun.target.position.set(focus.x, 0, focus.z); sun.target.updateMatrixWorld();
        if (lampLights.length) {
          _near.length = 0;
          for (const l of lamps) _near.push({ l: l, d: (l.x - focus.x) * (l.x - focus.x) + (l.z - focus.z) * (l.z - focus.z) });
          _near.sort((a, b) => a.d - b.d);
          lampLights.forEach((pl, i) => { const n = _near[i]; if (n) pl.position.set(n.l.x + 0.45, 4.3, n.l.z); });
        }
        for (const u in W.doorMeshes) {
          const dm = W.doorMeshes[u];
          if (dm.hold > 0) dm.hold -= dt; else dm.want = 0;
          dm.open += (dm.want - dm.open) * Math.min(1, 7 * dt);
          if (Math.abs(dm.open - dm.shown) > 0.002) setDoor(dm);
        }
      },
      // a delivered parcel stays on its doormat for the rest of the shift
      leaveParcel: function (unit) {
        const dm = W.doorMeshes[unit];
        if (!dm) return;
        const d = dm.door, n = dm.left = (dm.left || 0) + 1;
        const b = WD.Gear.parcel(0.34 - (n % 2) * 0.06, 0.18, 0.26);
        b.position.set(d.x + 0.12 * ((n % 3) - 1), d.y + 0.12 + (n - 1) * 0.18, d.z + d.nz * 0.5);
        b.rotation.y = (n * 1.7) % 0.6 - 0.3;
        group.add(b);
        (dm.parcels || (dm.parcels = [])).push(b);
      },
      // a resident took the parcel off the mat (a wrong door keeping a valuable one)
      takeParcel: function (unit) {
        const dm = W.doorMeshes[unit];
        if (!dm || !dm.parcels || !dm.parcels.length) return;
        group.remove(dm.parcels.pop()); dm.left = Math.max(0, (dm.left || 1) - 1);
      },
      openDoor: function (unit, t) { const dm = W.doorMeshes[unit]; if (dm) { dm.want = 1; dm.hold = t || 2.2; } }
    };
  };
  WD.World = W;
})(globalThis.WD);
