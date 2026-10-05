// Endless city. The route is a chain of "slabs" along -Z that cycles through
//   STREET   - road between shop fronts, parked cars to hop across, barriers, vans
//   ASCENT   - wall-run up a shop front, then ladders or scaffolding up to a roof
//   ROOFTOPS - gaps, ramps, drops, step-ups and swing bars over the widest gaps
//   DESCENT  - drop roof to roof back down to the street
// Obstacles are laid on each slab as the player nears; behind the player
// everything is recycled, so memory stays flat forever. Each slab's static meshes are
// merged per material (bake) to keep draw calls low on phones.
(function (G) {
  "use strict";
  const T = window.THREE;
  const HALF = 5;                       // roof half width (m)
  const LANES = [-2.2, 0, 2.2];
  const STREET = 0;
  const AIR_T = 0.73;                   // jump airtime, from the player's physics
  const W = { HALF: HALF, LANES: LANES, slabs: [], cars: [] };
  G.World = W;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  let rnd = mulberry32(1);
  const R = (a, b) => a + (b - a) * rnd();
  const RI = (a, b) => Math.floor(R(a, b + 1));
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  // ---------- textures & materials ----------
  function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function tex(c, srgb) {
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.anisotropy = 4;
    if (srgb !== false) t.colorSpace = T.SRGBColorSpace;
    return t;
  }
  function facade(style, seed) {
    const r = mulberry32(seed);
    const S = 128, col = canvas(S, S), em = canvas(S, S);
    const a = col.getContext("2d"), b = em.getContext("2d");
    const wall = [["#6b6a68", "#5b5a58"], ["#4d5a68", "#3f4a57"], ["#7d5648", "#6a4639"], ["#8a8780", "#77746d"]][style];
    a.fillStyle = wall[0]; a.fillRect(0, 0, S, S);
    for (let i = 0; i < 260; i++) { a.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.07)" : "rgba(255,255,255,0.05)"; a.fillRect(r() * S, r() * S, 2 + r() * 8, 1 + r() * 3); }
    a.fillStyle = wall[1];
    for (let y = 0; y < 4; y++) a.fillRect(0, y * 32 + 28, S, 4);      // floor slabs
    b.fillStyle = "#000"; b.fillRect(0, 0, S, S);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const wx = x * 32 + 6, wy = y * 32 + 5, ww = 20, wh = 20;
      a.fillStyle = style === 1 ? "#1b2735" : "#262c34"; a.fillRect(wx, wy, ww, wh);
      a.fillStyle = "rgba(160,190,220,0.18)"; a.fillRect(wx, wy, ww, 5);
      if (r() < 0.38) {
        const c = r() < 0.8 ? "#ffd27a" : (r() < 0.5 ? "#9fe4ff" : "#ffb3d9");
        b.fillStyle = c; b.fillRect(wx, wy, ww, wh);
        a.fillStyle = c; a.fillRect(wx, wy, ww, wh);
      }
    }
    return { map: tex(col), em: tex(em) };
  }
  function roofTex() {
    const S = 128, c = canvas(S, S), a = c.getContext("2d");
    a.fillStyle = "#aaa8a2"; a.fillRect(0, 0, S, S);
    for (let i = 0; i < 700; i++) { a.fillStyle = Math.random() < 0.5 ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.07)"; a.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 5, 1 + Math.random() * 5); }
    a.fillStyle = "rgba(40,40,44,0.5)"; a.fillRect(0, 62, S, 3); a.fillRect(62, 0, 3, S);   // expansion joints
    for (let i = 0; i < 4; i++) { a.fillStyle = "rgba(30,30,34,0.22)"; a.beginPath(); a.ellipse(Math.random() * S, Math.random() * S, 8 + Math.random() * 14, 5 + Math.random() * 9, Math.random() * 3, 0, 7); a.fill(); }
    return tex(c);
  }
  function hazardTex() {
    const c = canvas(64, 16), a = c.getContext("2d");
    a.fillStyle = "#f1c40f"; a.fillRect(0, 0, 64, 16);
    a.fillStyle = "#1c1c1c";
    for (let x = -16; x < 80; x += 16) { a.beginPath(); a.moveTo(x, 16); a.lineTo(x + 8, 16); a.lineTo(x + 16, 0); a.lineTo(x + 8, 0); a.fill(); }
    return tex(c);
  }
  // shipping container long side: corrugated ribs, rails, rust streaks, stencilled line name + number
  function containerSideTex(color, word) {
    const c = canvas(256, 128), a = c.getContext("2d");
    a.fillStyle = color; a.fillRect(0, 0, 256, 128);
    for (let x = 0; x < 256; x += 9) {
      const g = a.createLinearGradient(x, 0, x + 9, 0);
      g.addColorStop(0, "rgba(255,255,255,0.12)"); g.addColorStop(0.45, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.3)");
      a.fillStyle = g; a.fillRect(x, 7, 9, 114);
    }
    a.fillStyle = "rgba(0,0,0,0.38)"; a.fillRect(0, 0, 256, 7); a.fillRect(0, 121, 256, 7);
    a.fillStyle = "rgba(255,255,255,0.08)"; a.fillRect(0, 7, 256, 1);
    for (let i = 0; i < 46; i++) { a.fillStyle = "rgba(105,48,18," + (0.06 + Math.random() * 0.16) + ")"; a.fillRect(Math.random() * 256, 5 + Math.random() * 25, 1 + Math.random() * 3, 15 + Math.random() * 90); }
    for (let i = 0; i < 260; i++) { a.fillStyle = "rgba(28,24,20,0.09)"; a.fillRect(Math.random() * 256, 86 + Math.random() * 40, 2 + Math.random() * 7, 1 + Math.random() * 4); }
    for (let i = 0; i < 12; i++) { a.fillStyle = "rgba(0,0,0,0.12)"; a.fillRect(Math.random() * 256, Math.random() * 128, 6 + Math.random() * 16, 2 + Math.random() * 3); }
    a.textBaseline = "top"; a.fillStyle = "rgba(244,240,230,0.85)";
    a.font = "bold 22px 'Arial Black', Impact, sans-serif"; a.fillText(word, 20, 16);
    a.font = "bold 10px monospace"; a.fillText("CJLU " + (400000 + Math.floor(Math.random() * 599999)) + " 2", 20, 44); a.fillText("22G1", 20, 58);
    return tex(c);
  }
  // container door end: two doors, four locking bars, handles
  function containerDoorTex(color) {
    const c = canvas(128, 128), a = c.getContext("2d");
    a.fillStyle = color; a.fillRect(0, 0, 128, 128);
    for (let y = 8; y < 120; y += 14) { a.fillStyle = "rgba(0,0,0,0.13)"; a.fillRect(6, y, 116, 5); a.fillStyle = "rgba(255,255,255,0.07)"; a.fillRect(6, y + 5, 116, 2); }
    a.strokeStyle = "rgba(0,0,0,0.5)"; a.lineWidth = 6; a.strokeRect(3, 3, 122, 122);
    a.fillStyle = "rgba(0,0,0,0.5)"; a.fillRect(63, 6, 2, 116);
    [22, 46, 82, 106].forEach(function (x) {
      a.fillStyle = "#3a3d42"; a.fillRect(x - 2, 6, 4, 116);
      a.fillStyle = "rgba(255,255,255,0.18)"; a.fillRect(x - 2, 6, 1, 116);
      a.fillStyle = "#2a2c30"; a.fillRect(x - 4, 60, 8, 14); a.fillRect(x - 4, 12, 8, 6); a.fillRect(x - 4, 110, 8, 6);
    });
    for (let i = 0; i < 30; i++) { a.fillStyle = "rgba(105,48,18," + (0.06 + Math.random() * 0.14) + ")"; a.fillRect(Math.random() * 128, Math.random() * 40, 1 + Math.random() * 2, 10 + Math.random() * 60); }
    return tex(c);
  }
  function plankTex() {
    const c = canvas(64, 64), a = c.getContext("2d");
    a.fillStyle = "#9a7a52"; a.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 64; y += 13) { a.fillStyle = "rgba(60,40,20,0.55)"; a.fillRect(0, y, 64, 2); }
    for (let i = 0; i < 120; i++) { a.fillStyle = Math.random() < 0.5 ? "rgba(70,45,20,0.15)" : "rgba(255,230,190,0.08)"; a.fillRect(Math.random() * 64, Math.random() * 64, 4 + Math.random() * 14, 1); }
    a.fillStyle = "rgba(40,30,20,0.5)"; a.fillRect(0, 0, 3, 64); a.fillRect(61, 0, 3, 64);
    return tex(c);
  }
  function brickTex() {
    const c = canvas(128, 64), a = c.getContext("2d");
    a.fillStyle = "#4a2a22"; a.fillRect(0, 0, 128, 64);
    for (let y = 0; y < 8; y++) for (let x = -1; x < 5; x++) {
      const ox = (y % 2) * 16;
      a.fillStyle = "hsl(" + (8 + Math.random() * 10) + "," + (40 + Math.random() * 15) + "%," + (30 + Math.random() * 12) + "%)";
      a.fillRect(x * 32 + ox + 1, y * 8 + 1, 30, 6);
    }
    return tex(c);
  }
  function neonTex(word, color) {
    const c = canvas(256, 96), a = c.getContext("2d");
    a.fillStyle = "#07070c"; a.fillRect(0, 0, 256, 96);
    a.strokeStyle = color; a.lineWidth = 4; a.strokeRect(6, 6, 244, 84);
    a.font = "bold 52px Impact, 'Arial Black', sans-serif"; a.textAlign = "center"; a.textBaseline = "middle";
    a.shadowColor = color; a.shadowBlur = 16; a.fillStyle = "#fff"; a.fillText(word, 128, 52);
    a.shadowBlur = 0; a.fillStyle = color; a.globalCompositeOperation = "multiply"; a.fillText(word, 128, 52);
    return tex(c);
  }
  // road: 10.6 m wide x 12 m long per tile, dashed lane lines between the three lanes
  function asphaltTex() {
    const c = canvas(128, 256), a = c.getContext("2d");
    a.fillStyle = "#2b2c31"; a.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 1800; i++) { a.fillStyle = Math.random() < 0.5 ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.05)"; a.fillRect(Math.random() * 128, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 2); }
    for (let i = 0; i < 6; i++) { a.fillStyle = "rgba(18,18,22,0.35)"; a.fillRect(Math.random() * 100, Math.random() * 230, 12 + Math.random() * 26, 8 + Math.random() * 24); }
    const px = (x) => (x + 5.3) / 10.6 * 128;
    a.fillStyle = "rgba(236,230,214,0.85)";
    [-1.1, 1.1].forEach(function (x) { for (let y = 0; y < 256; y += 128) a.fillRect(px(x) - 1.5, y + 16, 3, 64); });
    a.fillStyle = "rgba(226,186,62,0.85)";
    [-4.9, 4.9].forEach(function (x) { a.fillRect(px(x) - 1.2, 0, 2.4, 256); });
    return tex(c);
  }
  function sidewalkTex() {
    const c = canvas(64, 64), a = c.getContext("2d");
    a.fillStyle = "#8f8d88"; a.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 300; i++) { a.fillStyle = Math.random() < 0.5 ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.06)"; a.fillRect(Math.random() * 64, Math.random() * 64, 1 + Math.random() * 3, 1 + Math.random() * 3); }
    a.fillStyle = "rgba(40,40,40,0.35)"; a.fillRect(0, 0, 64, 2); a.fillRect(0, 0, 2, 64);
    return tex(c);
  }
  // ground-floor shop front, 8 m x 4 m: sign band, lit windows, a door
  function shopTex(seed) {
    const r = mulberry32(seed * 31 + 7);
    const col = canvas(256, 128), em = canvas(256, 128), a = col.getContext("2d"), b = em.getContext("2d");
    a.fillStyle = ["#3b3533", "#2f3640", "#4a3a2c", "#35302f"][seed % 4]; a.fillRect(0, 0, 256, 128);
    b.fillStyle = "#000"; b.fillRect(0, 0, 256, 128);
    const sc = ["#c0392b", "#16a085", "#8e44ad", "#d35400", "#2c6fa8", "#b8860b"][seed % 6];
    const word = ["DELI", "PAWN", "LAUNDRY", "TACOS", "PHARMACY", "BARBER", "NOODLES", "DONUTS", "BODEGA", "SNEAKERS"][seed % 10];
    [a, b].forEach(function (g, i) {
      g.fillStyle = sc; g.fillRect(4, 6, 248, 24);
      g.font = "bold 18px 'Arial Black', Impact, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillStyle = i ? "#fff" : "#f4efe6"; g.fillText(word, 128, 19);
    });
    const lit = r() < 0.85;
    for (let x = 0; x < 3; x++) {
      const wx = 10 + x * 82, ww = x === 1 ? 40 : 70, wy = 40;
      a.fillStyle = "#151a22"; a.fillRect(wx, wy, ww, 80);
      if (x === 1) { a.fillStyle = "#1d1410"; a.fillRect(wx + 46, wy, 26, 80); }
      if (lit) {
        const g = a.createLinearGradient(0, wy, 0, wy + 80); g.addColorStop(0, "#ffe2a8"); g.addColorStop(1, "#c98a42");
        a.fillStyle = g; a.fillRect(wx + 3, wy + 3, ww - 6, 74);
        b.fillStyle = "#c9a26a"; b.fillRect(wx + 3, wy + 3, ww - 6, 74);
        a.fillStyle = "rgba(40,30,20,0.55)"; for (let k = 0; k < 4; k++) a.fillRect(wx + 6 + r() * (ww - 20), wy + 30 + r() * 30, 6 + r() * 10, 18 + r() * 20);
      }
    }
    return { map: tex(col), em: tex(em) };
  }
  function stripeTex(c1, c2) {
    const c = canvas(64, 16), a = c.getContext("2d");
    for (let x = 0; x < 64; x += 16) { a.fillStyle = c1; a.fillRect(x, 0, 8, 16); a.fillStyle = c2; a.fillRect(x + 8, 0, 8, 16); }
    return tex(c);
  }
  // chalked chevrons: "run up here"
  function arrowTex() {
    const c = canvas(64, 128), a = c.getContext("2d");
    a.clearRect(0, 0, 64, 128);
    a.strokeStyle = "rgba(245,245,240,0.92)"; a.lineWidth = 7; a.lineCap = "round"; a.lineJoin = "round";
    [24, 58, 92].forEach(function (y) { a.beginPath(); a.moveTo(10, y + 18); a.lineTo(32, y); a.lineTo(54, y + 18); a.stroke(); });
    const t = tex(c); t.wrapS = t.wrapT = T.ClampToEdgeWrapping; return t;
  }

  let M = null;
  function materials() {
    if (M) return M;
    M = { facade: [], roof: new T.MeshLambertMaterial({ map: roofTex() }), emissives: [] };
    for (let s = 0; s < 4; s++) {
      const f = facade(s, 100 + s * 17);
      const m = new T.MeshLambertMaterial({ map: f.map, emissiveMap: f.em, emissive: 0xffffff, emissiveIntensity: 0.4 });
      M.facade.push(m); M.emissives.push(m);
    }
    M.parapet = new T.MeshLambertMaterial({ color: 0x9a9892 });
    M.metal = new T.MeshLambertMaterial({ color: 0x8a9096 });
    M.dark = new T.MeshLambertMaterial({ color: 0x2b2e34 });
    M.rust = new T.MeshLambertMaterial({ color: 0x7a4b34 });
    M.concrete = new T.MeshLambertMaterial({ color: 0xa9a7a0 });
    M.hazard = new T.MeshLambertMaterial({ map: hazardTex(), emissive: 0x302400 });
    // shipping-line colours: rust red, navy, green, mustard, grey, off-white, orange
    const CTR = [["#8e3326", "OCEANIC"], ["#22476e", "TRANSPAC"], ["#2f6a4c", "NORDLINK"], ["#b8902f", "SEAFAST"], ["#5c656e", "HARBOR LINE"], ["#bdb8ac", "CJL"], ["#a8481f", "PACIFICA"]];
    M.ctrSide = CTR.map(function (c) { return new T.MeshLambertMaterial({ map: containerSideTex(c[0], c[1]) }); });
    M.ctrDoor = CTR.map(function (c) { return new T.MeshLambertMaterial({ map: containerDoorTex(c[0]) }); });
    M.wood = new T.MeshLambertMaterial({ map: plankTex() });
    M.dirt = new T.MeshLambertMaterial({ color: 0x4a3a2c });
    M.pit = new T.MeshBasicMaterial({ color: 0x0b0b0d });
    const words = [["RAMEN", "#ff4f81"], ["HOTEL", "#36e0ff"], ["24H", "#ffd23f"], ["BAR", "#b86bff"], ["ARCADE", "#3dffa8"], ["PIZZA", "#ff8a3d"]];
    M.neon = words.map(function (w) { return new T.MeshBasicMaterial({ map: neonTex(w[0], w[1]), fog: true }); });
    M.brick = new T.MeshLambertMaterial({ map: brickTex() });
    M.street = new T.MeshLambertMaterial({ color: 0x15171c });
    M.asphalt = new T.MeshLambertMaterial({ map: asphaltTex() });
    M.sidewalk = new T.MeshLambertMaterial({ map: sidewalkTex() });
    M.shops = [];
    for (let i = 0; i < 10; i++) {
      const s = shopTex(i);
      const m = new T.MeshLambertMaterial({ map: s.map, emissiveMap: s.em, emissive: 0xffffff, emissiveIntensity: 0.6 });
      M.shops.push(m); M.emissives.push(m);
    }
    M.awnings = [["#c0392b", "#f4efe6"], ["#16a085", "#f4efe6"], ["#2c3e50", "#d9cba3"], ["#d35400", "#2b2b2b"]].map(function (p) { return new T.MeshLambertMaterial({ map: stripeTex(p[0], p[1]) }); });
    M.tailL = new T.MeshBasicMaterial({ color: 0xff3a30 });
    M.lamp = new T.MeshBasicMaterial({ color: 0xffe2a8 });
    M.dumpster = new T.MeshLambertMaterial({ color: 0x2f6b3a });
    M.ladder = new T.MeshLambertMaterial({ color: 0xd4a62a });
    M.hydrant = new T.MeshLambertMaterial({ color: 0xb02a22 });
    M.arrow = new T.MeshBasicMaterial({ map: arrowTex(), alphaTest: 0.4, transparent: false, fog: true });
    M.brickWall = new T.MeshLambertMaterial({ map: brickTex() });
    return M;
  }
  function scaleUV(geo, face, su, sv) {
    const uv = geo.attributes.uv;
    for (let i = face * 4; i < face * 4 + 4; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  // Box whose facade tile (8 m x 12.8 m) is not stretched.
  function towerGeo(w, h, d) {
    const g = new T.BoxGeometry(w, h, d);
    scaleUV(g, 0, d / 8, h / 12.8); scaleUV(g, 1, d / 8, h / 12.8);
    scaleUV(g, 4, w / 8, h / 12.8); scaleUV(g, 5, w / 8, h / 12.8);
    return g;
  }

  // Merge every mesh under root into one mesh per material (positions, normals, uvs),
  // so a slab with hundreds of boxes (ladder rungs, cars, lamps) costs a handful of draw calls.
  const _v = new T.Vector3(), _nm = new T.Matrix3(), _rel = new T.Matrix4();
  function bake(root) {
    root.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(root.matrixWorld).invert();
    const buckets = new Map(), meshes = [];
    root.traverse(function (o) {
      if (!o.isMesh || o.userData.keep) return;
      meshes.push(o);
      if (!buckets.has(o.material)) buckets.set(o.material, []);
      buckets.get(o.material).push(o);
    });
    buckets.forEach(function (list, mat) {
      let n = 0;
      const parts = list.map(function (o) {
        const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
        n += g.attributes.position.count;
        return { g: g, m: new T.Matrix4().multiplyMatrices(inv, o.matrixWorld) };
      });
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
      let off = 0;
      parts.forEach(function (p) {
        const P = p.g.attributes.position, N = p.g.attributes.normal, U = p.g.attributes.uv;
        _nm.getNormalMatrix(p.m);
        for (let i = 0; i < P.count; i++) {
          const k = (off + i) * 3;
          _v.fromBufferAttribute(P, i).applyMatrix4(p.m); pos[k] = _v.x; pos[k + 1] = _v.y; pos[k + 2] = _v.z;
          if (N) { _v.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize(); nor[k] = _v.x; nor[k + 1] = _v.y; nor[k + 2] = _v.z; }
          if (U) { uv[(off + i) * 2] = U.getX(i); uv[(off + i) * 2 + 1] = U.getY(i); }
        }
        off += P.count;
        p.g.dispose();
      });
      const geo = new T.BufferGeometry();
      geo.setAttribute("position", new T.BufferAttribute(pos, 3));
      geo.setAttribute("normal", new T.BufferAttribute(nor, 3));
      geo.setAttribute("uv", new T.BufferAttribute(uv, 2));
      geo.computeBoundingSphere();
      root.add(new T.Mesh(geo, mat));
    });
    meshes.forEach(function (o) { o.geometry.dispose(); o.parent.remove(o); });
  }

  // ---------- palettes ----------
  const PAL = [
    { name: "dusk", top: 0x2d2358, mid: 0xb4507a, hor: 0xff9a5a, fog: 0xd48a74, sun: 0xffc690, hemiS: 0xffb899, hemiG: 0x40384e, dir: 0xffc9a0, dirI: 1.15, win: 0.45 },
    { name: "night", top: 0x050816, mid: 0x1b2352, hor: 0x4a3c8a, fog: 0x1b2146, sun: 0x8fa6ff, hemiS: 0x5b6bb0, hemiG: 0x15162a, dir: 0x8aa2ff, dirI: 0.55, win: 1.15 },
    { name: "dawn", top: 0x3d4f8f, mid: 0xe08fa8, hor: 0xffd6a1, fog: 0xcfa9a6, sun: 0xffe3b0, hemiS: 0xffd6c4, hemiG: 0x4b4455, dir: 0xffdcb4, dirI: 1.05, win: 0.35 },
    { name: "day", top: 0x3f78c4, mid: 0x93bde6, hor: 0xe6e9ee, fog: 0xb8c5d2, sun: 0xffffff, hemiS: 0xdfeaff, hemiG: 0x6b6a66, dir: 0xfff1d8, dirI: 1.25, win: 0.05 }
  ];
  const PAL_LEN = 1400;                  // metres per palette (incl. blend)
  const cA = new T.Color(), cB = new T.Color();
  function lerpCol(out, a, b, t) { cA.setHex(a); cB.setHex(b); out.copy(cA).lerp(cB, t); }

  // ---------- scene objects ----------
  let scene, sky, skyMat, hemi, dirL, streetMesh;
  const bgSegs = new Map();
  const SEG = 56;
  const pal = { top: new T.Color(), mid: new T.Color(), hor: new T.Color(), fog: new T.Color(), sun: new T.Color() };

  W.init = function (sc) {
    scene = sc;
    materials();
    scene.fog = new T.Fog(0xd48a74, 50, 230);
    hemi = new T.HemisphereLight(0xffb899, 0x40384e, 1.35); scene.add(hemi);
    dirL = new T.DirectionalLight(0xffc9a0, 1.1); dirL.position.set(-30, 60, 20); scene.add(dirL); scene.add(dirL.target);
    skyMat = new T.ShaderMaterial({
      uniforms: { top: { value: pal.top }, mid: { value: pal.mid }, hor: { value: pal.hor }, sun: { value: pal.sun } },
      vertexShader: "varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader: "uniform vec3 top,mid,hor,sun; varying vec3 vP; void main(){ float h=clamp(vP.y,-0.2,1.0); vec3 c=mix(hor,mid,smoothstep(0.0,0.28,h)); c=mix(c,top,smoothstep(0.22,0.9,h)); float s=max(dot(normalize(vP),normalize(vec3(-0.25,0.12,-1.0))),0.0); c+=sun*(pow(s,48.0)*0.9+pow(s,6.0)*0.25); gl_FragColor=vec4(c,1.0);} ",
      side: T.BackSide, depthWrite: false, fog: false
    });
    sky = new T.Mesh(new T.SphereGeometry(420, 24, 12), skyMat);
    sky.renderOrder = -10; sky.frustumCulled = false;
    scene.add(sky);
    streetMesh = new T.Mesh(new T.PlaneGeometry(900, 900), M.street);
    streetMesh.rotation.x = -Math.PI / 2; streetMesh.position.y = STREET - 0.06;
    scene.add(streetMesh);
    W.setPalette(0);
  };

  W.setPalette = function (dist) {
    const u = dist / PAL_LEN + palStart, i = Math.floor(u) % PAL.length, j = (i + 1) % PAL.length;
    const f = Math.min(1, Math.max(0, (u - Math.floor(u) - 0.65) / 0.35));   // blend over the last 35 %
    const e = f * f * (3 - 2 * f), A = PAL[i], B = PAL[j];
    lerpCol(pal.top, A.top, B.top, e); lerpCol(pal.mid, A.mid, B.mid, e); lerpCol(pal.hor, A.hor, B.hor, e);
    lerpCol(pal.fog, A.fog, B.fog, e); lerpCol(pal.sun, A.sun, B.sun, e);
    scene.fog.color.copy(pal.fog);
    lerpCol(hemi.color, A.hemiS, B.hemiS, e); lerpCol(hemi.groundColor, A.hemiG, B.hemiG, e);
    lerpCol(dirL.color, A.dir, B.dir, e);
    dirL.intensity = A.dirI + (B.dirI - A.dirI) * e;
    const win = A.win + (B.win - A.win) * e;
    M.emissives.forEach(function (m) { m.emissiveIntensity = M.shops.indexOf(m) >= 0 ? 0.25 + win * 0.75 : win; });
    W.paletteName = e > 0.5 ? B.name : A.name;
  };

  // ---------- ground queries ----------
  W.top = function (s, z) { return s.y0 + (s.y1 - s.y0) * ((s.z0 - z) / (s.z0 - s.z1)); };
  W.groundAt = function (z) {
    for (let i = 0; i < W.slabs.length; i++) { const s = W.slabs[i]; if (z <= s.z0 && z >= s.z1) return s; }
    return null;
  };
  // Height of a standable obstacle (car, van, dumpster, barrier, container) at world z, measured
  // from its base; null when z is off its length. o.plat = [[u, top], ...], u = metres from the front.
  function platTop(o, z) {
    const u = o.z + o.d / 2 - z, P = o.plat;
    if (u < 0 || u > o.d) return null;
    for (let i = 1; i < P.length; i++) if (u <= P[i][0]) { const a = P[i - 1], b = P[i]; return a[1] + (b[1] - a[1]) * (u - a[0]) / Math.max(1e-6, b[0] - a[0]); }
    return P[P.length - 1][1];
  }
  W.platTop = platTop;
  // the bottom of whatever you fall into at z: a road-works trench, or the street
  W.pitFloor = function (z) {
    for (let i = 0; i < W.slabs.length; i++) { const p = W.slabs[i].pit; if (p && z < p.z0 && z > p.z1) return -5.8; }
    return 0;
  };
  // The highest thing the feet can stand on at (x, z): the slab, or a vehicle roof the feet
  // are at (or barely below). y undefined = ignore the feet (for the shadow). W.floorObj = the obstacle.
  W.floor = function (x, z, y) {
    const s = W.groundAt(z);
    let best = s ? W.top(s, z) : null;
    W.floorObj = null;
    for (let i = 0; i < W.slabs.length; i++) {
      const sl = W.slabs[i];
      if (z > sl.z0 + 14 || z < sl.z1 - 8) continue;      // face stairs reach up to ~11 m before the slab
      for (let k = 0; k < sl.obs.length; k++) {
        const o = sl.obs[k];
        if (!o.plat || Math.abs(x - o.x) > o.w / 2 + 0.15) continue;
        const t = platTop(o, z);
        if (t === null) continue;
        const ty = o.base + t;
        if ((y === undefined || y >= ty - 0.36) && (best === null || ty > best)) { best = ty; W.floorObj = o; }
      }
    }
    for (let i = 0; i < W.cars.length; i++) {            // moving traffic: roofs and hoods are floor too
      const c = W.cars[i];
      if (Math.abs(x - c.x) > c.w / 2 + 0.15) continue;
      const t = platTop(c, z);
      if (t === null) continue;
      if ((y === undefined || y >= t - 0.36) && (best === null || t > best)) { best = t; W.floorObj = c; }
    }
    return best;
  };

  function box(w, h, d, mat, x, y, z) { const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; }
  function cyl(r, h, mat, x, y, z, axis) {
    const m = new T.Mesh(new T.CylinderGeometry(r, r, h, 10), mat);
    if (axis === "x") m.rotation.z = Math.PI / 2; else if (axis === "z") m.rotation.x = Math.PI / 2;
    m.position.set(x, y, z); return m;
  }
  // a side-profile prism: pts are [z, y] pairs in the obstacle's local frame, extruded across x
  function prism(pts, width, mat) {
    const sh = new T.Shape();
    sh.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
    sh.closePath();
    const g = new T.ExtrudeGeometry(sh, { depth: width, bevelEnabled: false });
    g.rotateY(-Math.PI / 2); g.translate(width / 2, 0, 0);
    return new T.Mesh(g, mat);
  }

  // ---------- obstacles ----------
  function addBarrier(g, o) {
    const m = M.concrete;
    g.add(box(2.0, 0.78, 0.75, m, 0, 0.39, 0));
    g.add(box(2.0, 0.24, 0.5, m, 0, 0.9, 0));
    g.add(box(2.02, 0.12, 0.52, M.hazard, 0, 0.78, 0));
    o.h = 1.02; o.d = 0.75; o.plat = [[0, 1.02], [0.75, 1.02]];
  }
  function addBar(g, o) {
    g.add(box(2.1, 0.5, 0.45, M.hazard, 0, 1.3, 0));
    g.add(box(0.16, 2.6, 0.16, M.metal, -1.0, 1.3, 0)); g.add(box(0.16, 2.6, 0.16, M.metal, 1.0, 1.3, 0));
    o.yb = 1.05; o.h = 1.55; o.d = 0.45;
  }
  // Shipping container (corrugated sides, door ends, corner castings), length L along z, sitting on y0.
  // 2.6 m tall: too high to jump from the ground, so step up off a crate or dumpster, or double jump.
  const CTR_W = 2.1, CTR_H = 2.6;
  function buildContainer(g, L, y0, k) {
    const side = M.ctrSide[k], door = M.ctrDoor[k], h = CTR_H - 0.12;
    const b = box(CTR_W, h, L, side, 0, y0 + 0.12 + h / 2, 0);
    scaleUV(b.geometry, 2, 0.3, 0.1); scaleUV(b.geometry, 3, 0.3, 0.1);
    scaleUV(b.geometry, 0, L / 6.06, 1); scaleUV(b.geometry, 1, L / 6.06, 1);
    g.add(b);
    [-1, 1].forEach(function (e) {
      const p = new T.Mesh(new T.PlaneGeometry(CTR_W - 0.04, h - 0.02), door);
      p.rotation.y = e > 0 ? 0 : Math.PI; p.position.set(0, y0 + 0.12 + h / 2, e * (L / 2 + 0.006)); g.add(p);
    });
    g.add(box(CTR_W, 0.12, L, M.dark, 0, y0 + 0.06, 0));
    [-1, 1].forEach(function (sx) { [-1, 1].forEach(function (sz) { [0.11, CTR_H - 0.1].forEach(function (y) {
      g.add(box(0.2, 0.2, 0.2, M.dark, sx * (CTR_W / 2 - 0.08), y0 + y, sz * (L / 2 - 0.08)));
    }); }); });
  }
  function addWall(g, o) {           // a 10 ft container on a roof
    buildContainer(g, 3.0, 0, RI(0, M.ctrSide.length - 1));
    o.w = CTR_W; o.h = CTR_H; o.d = 3.0; o.plat = [[0, CTR_H], [3.0, CTR_H]];
  }
  function addContainer(g, o) {      // a 20 ft container in the street
    buildContainer(g, 6.06, 0, RI(0, M.ctrSide.length - 1));
    o.w = CTR_W; o.h = CTR_H; o.d = 6.06; o.plat = [[0, CTR_H], [6.06, CTR_H]];
  }
  function addStack(g, o) {          // two high: only a double jump off another container reaches the top
    const k = RI(0, M.ctrSide.length - 1);
    buildContainer(g, 6.06, 0, k);
    buildContainer(g, 6.06, CTR_H, (k + RI(1, 3)) % M.ctrSide.length);
    o.w = CTR_W; o.h = CTR_H * 2; o.d = 6.06; o.plat = [[0, CTR_H * 2], [6.06, CTR_H * 2]];
  }
  function addCrate(g, o) {          // stacked shipping crates: the step up onto a container
    g.add(box(1.8, 0.75, 1.8, M.wood, 0, 0.375, 0));
    g.add(box(1.4, 0.4, 1.3, M.wood, 0.1, 0.95, 0.1));
    g.add(box(1.84, 0.06, 1.84, M.dark, 0, 0.76, 0));
    o.w = 1.8; o.h = 1.15; o.d = 1.8; o.plat = [[0, 0.75], [0.25, 1.15], [1.6, 1.15], [1.8, 0.75]];
  }
  // climbable: a thin concrete fence (climb over it) and a brick wall (run up it)
  function addFence(g, o) {
    g.add(box(2.0, 1.9, 1.0, M.concrete, 0, 0.95, 0));
    g.add(box(2.04, 0.12, 1.04, M.hazard, 0, 1.86, 0));
    o.h = 1.9; o.d = 1.0;
  }
  function addBrick(g, o) {
    const b = box(2.0, 1.7, 1.0, M.brick, 0, 0.85, 0);
    scaleUV(b.geometry, 4, 1, 1); g.add(b);
    g.add(box(2.1, 0.12, 1.1, M.parapet, 0, 1.76, 0));
    o.h = 1.7; o.d = 1.0;
  }
  function addDumpster(g, o) {
    g.add(box(1.9, 1.15, 1.6, M.dumpster, 0, 0.62, 0));
    g.add(box(1.96, 0.1, 1.66, M.dark, 0, 1.25, 0));
    g.add(box(1.9, 0.06, 0.06, M.metal, 0, 0.9, 0.83));
    o.w = 1.9; o.h = 1.3; o.d = 1.6; o.plat = [[0, 1.3], [1.6, 1.3]];
  }
  W.bake = bake;
  W.rand = function () { return rnd(); };            // the seeded stream, so traffic is part of the seed
  const BUILD = { barrier: addBarrier, bar: addBar, wall: addWall, fence: addFence, brick: addBrick, container: addContainer, stack: addStack, crate: addCrate, dumpster: addDumpster };
  // zFront = the face the runner meets first
  function obstacle(s, type, lane, zFront) {
    const o = { type: type, x: LANES[lane], z: zFront, w: 2.0, d: 0.75, h: 1, yb: 0, base: W.top(s, zFront), plat: null, group: new T.Group() };
    BUILD[type](o.group, o);
    o.z = zFront - o.d / 2;
    o.group.position.set(o.x, o.base, o.z);
    s.group.add(o.group);
    s.obs.push(o);
    return o;
  }
  function depthOf(type) { return { container: 6.06, stack: 6.06, crate: 1.8, dumpster: 1.6, wall: 3.0, barrier: 0.75, bar: 0.45, fence: 1.0, brick: 1.0 }[type]; }

  // ---------- slab visuals ----------
  function buildSlab(s, withProps) {
    const g = new T.Group();
    const len = s.z0 - s.z1, midZ = (s.z0 + s.z1) / 2, midY = (s.y0 + s.y1) / 2;
    const annex = s.kind === "annex";
    // body: a prism down to the street
    const shape = new T.Shape();
    shape.moveTo(s.z0, STREET - 5); shape.lineTo(s.z1, STREET - 5); shape.lineTo(s.z1, s.y1 - 0.4); shape.lineTo(s.z0, s.y0 - 0.4); shape.closePath();
    const eg = new T.ExtrudeGeometry(shape, { depth: HALF * 2, bevelEnabled: false });
    eg.rotateY(-Math.PI / 2); eg.translate(HALF, 0, 0);
    // facade UVs by face direction (tile 8 m x 12.8 m; brick 2 m x 1 m), so windows stay upright on every wall
    const tw = annex ? 2 : 8, th = annex ? 1 : 12.8;
    const uv = eg.attributes.uv, pos = eg.attributes.position, nor = eg.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      const nx = Math.abs(nor.getX(i)), nz = Math.abs(nor.getZ(i));
      if (nx > 0.5) uv.setXY(i, pos.getZ(i) / tw, pos.getY(i) / th);
      else if (nz > 0.5) uv.setXY(i, pos.getX(i) / tw, pos.getY(i) / th);
      else uv.setXY(i, pos.getX(i) / 8, pos.getZ(i) / 8);
    }
    g.add(new T.Mesh(eg, annex ? M.brickWall : M.facade[s.style]));
    if (annex) {   // shop front on the street side of the one-storey annex, under its wall-run face
      [-1, 1].forEach(function (sd) {
        const p = new T.Mesh(new T.PlaneGeometry(len - 1, 2.6), pick(M.shops));
        p.rotation.y = sd > 0 ? Math.PI / 2 : -Math.PI / 2; p.position.set(sd * (HALF + 0.02), 1.3, midZ); g.add(p);
      });
    }
    if (s.kind === "stairs") { buildSteps(g, s); return g; }
    // roof frame, sloped like the slab
    const slope = (s.y1 - s.y0) / (s.z1 - s.z0);
    const roof = new T.Group();
    roof.position.set(0, midY, midZ);
    roof.rotation.x = -Math.atan(slope);
    const L = len * Math.sqrt(1 + slope * slope);
    const rg = new T.BoxGeometry(HALF * 2 + 0.3, 0.3, L + 0.04);
    scaleUV(rg, 2, (HALF * 2) / 6, L / 6);
    const rm = new T.Mesh(rg, M.roof); rm.position.y = -0.15; roof.add(rm);
    [-1, 1].forEach(function (sd) { roof.add(box(0.4, 0.65, L, M.parapet, sd * (HALF - 0.05), 0.32, 0)); });
    g.add(roof);
    if (withProps && !annex) props(roof, L);
    return g;
  }

  // A full-width flight of concrete steps over a sloped slab, with handrails. Underfoot the ground
  // stays the smooth slope (W.top), the steps sit around it.
  function buildSteps(g, s) {
    const len = s.z0 - s.z1, dy = s.y1 - s.y0, n = Math.max(2, Math.round(Math.abs(dy) / 0.19)), run = len / n;
    for (let i = 0; i < n; i++) {
      const zm = s.z0 - (i + 0.5) * run, top = W.top(s, zm) + Math.abs(dy / n) * 0.3;
      g.add(box(HALF * 2 + 0.3, 0.8, run + 0.02, M.concrete, 0, top - 0.4, zm));
      g.add(box(HALF * 2 + 0.32, 0.03, 0.06, M.dark, 0, top + 0.005, zm + (dy > 0 ? run / 2 - 0.03 : -run / 2 + 0.03)));
    }
    const L = Math.hypot(len, dy), midZ = (s.z0 + s.z1) / 2, midY = (s.y0 + s.y1) / 2;
    [-1, 1].forEach(function (sd) {
      for (let z = s.z0 - 0.3; z > s.z1; z -= 1.6) g.add(box(0.06, 1.0, 0.06, M.metal, sd * (HALF - 0.2), W.top(s, z) + 0.5, z));
      const r = box(0.08, 0.08, L, M.metal, sd * (HALF - 0.2), midY + 1.0, midZ);
      r.rotation.x = Math.atan2(dy, len); g.add(r);
    });
  }

  function props(roof, L) {
    // decorations along both edges, clear of the three lanes
    for (let z = -L / 2 + 3; z < L / 2 - 2; z += R(4, 10)) {
      const side = rnd() < 0.5 ? -1 : 1, x = side * R(3.7, 4.5), t = rnd();
      let m;
      if (t < 0.28) {                                    // AC unit
        m = new T.Group(); m.add(box(1.5, 1.0, 1.3, M.metal, 0, 0.5, 0));
        const fan = new T.Mesh(new T.CylinderGeometry(0.42, 0.42, 0.06, 14), M.dark); fan.position.y = 1.02; m.add(fan);
      } else if (t < 0.5) {                              // water tank
        m = new T.Group();
        const tank = new T.Mesh(new T.CylinderGeometry(1.05, 1.05, 2.0, 14), M.rust); tank.position.y = 2.3; m.add(tank);
        const cone = new T.Mesh(new T.ConeGeometry(1.15, 0.7, 14), M.dark); cone.position.y = 3.65; m.add(cone);
        [[-.7, -.7], [.7, -.7], [-.7, .7], [.7, .7]].forEach(function (p) { m.add(box(0.1, 1.3, 0.1, M.dark, p[0], 0.65, p[1])); });
      } else if (t < 0.66) {                             // antenna mast
        m = new T.Group(); m.add(box(0.1, 5.5, 0.1, M.metal, 0, 2.75, 0)); m.add(box(1.2, 0.08, 0.08, M.metal, 0, 4.4, 0)); m.add(box(0.8, 0.08, 0.08, M.metal, 0, 3.6, 0));
        const lamp = new T.Mesh(new T.SphereGeometry(0.13, 8, 6), M.tailL); lamp.position.y = 5.55; m.add(lamp);
      } else if (t < 0.82) {                             // crate pile
        m = new T.Group(); const c1 = box(1.2, 1.0, 1.2, M.rust, 0, 0.5, 0); const c2 = box(0.9, 0.8, 0.9, M.dark, 0.2, 1.4, 0.1); c2.rotation.y = 0.5; m.add(c1, c2);
      } else {                                           // rooftop billboard
        m = new T.Group(); m.add(box(0.12, 2.2, 0.12, M.metal, -1.4, 1.1, 0)); m.add(box(0.12, 2.2, 0.12, M.metal, 1.4, 1.1, 0));
        const sg = new T.Mesh(new T.PlaneGeometry(3.4, 1.28), pick(M.neon)); sg.position.set(0, 2.7, 0.08); m.add(sg);
        m.add(box(3.5, 1.35, 0.1, M.dark, 0, 2.7, 0));
      }
      m.position.set(x, 0, z);
      m.rotation.y = rnd() < 0.5 ? 0 : (t > 0.8 ? 0 : Math.PI / 2);
      roof.add(m);
    }
  }

  // A street: road, curbs, sidewalks, shop fronts with awnings, street lamps, containers at the curb.
  function buildStreet(s) {
    const g = new T.Group(), len = s.z0 - s.z1, mz = (s.z0 + s.z1) / 2;
    const road = box(10.6, 0.3, len, M.asphalt, 0, -0.15, mz);
    scaleUV(road.geometry, 2, 1, len / 12); g.add(road);
    [-1, 1].forEach(function (sd) {
      const walk = box(3.2, 0.45, len, M.sidewalk, sd * 6.9, -0.075, mz);
      scaleUV(walk.geometry, 2, 3.2 / 1.5, len / 1.5); g.add(walk);
      g.add(box(0.22, 0.47, len, M.concrete, sd * 5.4, -0.065, mz));
      // buildings along the street
      let z = s.z0;
      while (z > s.z1 + 3) {
        const w = Math.min(z - s.z1, R(8, 15)), d = R(8, 12), h = R(9, 26), cz = z - w / 2;
        const bld = new T.Mesh(towerGeo(d, h, w), M.facade[RI(0, 3)]);
        bld.position.set(sd * (8.5 + d / 2), h / 2 - 0.2, cz); g.add(bld);
        const shop = new T.Mesh(new T.PlaneGeometry(w - 0.6, 3.6), pick(M.shops));
        shop.rotation.y = sd > 0 ? -Math.PI / 2 : Math.PI / 2; shop.position.set(sd * 8.47, 1.95, cz); g.add(shop);
        if (rnd() < 0.6) { const aw = box(1.4, 0.07, w * 0.8, pick(M.awnings), sd * 7.85, 3.55, cz); aw.rotation.z = sd * 0.28; g.add(aw); }
        if (rnd() < 0.3) { const n = new T.Mesh(new T.PlaneGeometry(3.2, 1.2), pick(M.neon)); n.rotation.y = shop.rotation.y; n.position.set(sd * 8.45, 5.4 + rnd() * 3, cz); g.add(n); }
        z -= w + R(0.2, 1.2);
      }
      // street lamps, arm out over the road
      for (let lz = s.z0 - (sd > 0 ? 4 : 13); lz > s.z1; lz -= 18) {
        g.add(cyl(0.08, 5.4, M.dark, sd * 6.3, 2.7, lz));
        g.add(box(1.5, 0.08, 0.1, M.dark, sd * 5.6, 5.35, lz));
        g.add(box(0.5, 0.12, 0.26, M.lamp, sd * 5.0, 5.27, lz));
      }
      // containers dropped at the curb, some stacked, and crates (scenery: the lanes stay clear of them)
      for (let cz = s.z0 - R(1, 8); cz > s.z1 + 6.5; cz -= R(7, 16)) {
        const r = rnd();
        if (r < 0.5) {
          const c = new T.Group();
          buildContainer(c, 6.06, 0, RI(0, M.ctrSide.length - 1));
          if (rnd() < 0.35) buildContainer(c, 6.06, CTR_H, RI(0, M.ctrSide.length - 1));
          c.position.set(sd * 4.5, 0, cz - 3.03); g.add(c);
        } else if (r < 0.68) { const c = new T.Group(); addCrate(c, {}); c.position.set(sd * 4.4, 0, cz - 1); g.add(c); }
        else if (r < 0.82) { g.add(cyl(0.14, 0.7, M.hydrant, sd * 5.9, 0.5, cz - 2)); }
      }
    });
    return g;
  }

  // Climb fixtures on the front face of a slab, one per lane: o.base = the ground below, o.h = rise.
  function addFace(s) {
    const h = s.y0 - s.base;
    for (let l = 0; l < 3; l++) {
      const r = rnd();
      const type = s.face === "wallrun" ? (r < 0.3 ? "stairs" : "wallrun") : (r < 0.36 ? "ladder" : r < 0.7 ? "scaffold" : "stairs");
      const o = { type: type, face: true, x: LANES[l], z: s.z0 - 0.05, w: 2.0, d: 0.1, h: h, yb: 0, base: s.base, plat: null, group: new T.Group() };
      const g = o.group;
      if (type === "stairs") {
        // concrete steps up the face: just run up them. Standable (plat), 36 degrees.
        const L = h * 1.35, n = Math.max(2, Math.round(h / 0.19)), run = L / n, rise = h / n;
        o.d = L; o.z = s.z0 + L / 2; o.plat = [[0, rise * 0.5], [L - run * 0.5, h], [L, h]];
        for (let i = 0; i < n; i++) {
          g.add(box(1.9, (i + 1) * rise, run + 0.01, M.concrete, 0, (i + 1) * rise / 2, L / 2 - (i + 0.5) * run));
          g.add(box(1.92, 0.03, 0.06, M.dark, 0, (i + 1) * rise + 0.005, L / 2 - i * run - 0.03));
        }
        [-1, 1].forEach(function (sd) {
          for (let u = 0.3; u < L; u += 1.5) g.add(box(0.05, 1.0, 0.05, M.metal, sd * 0.98, u / L * h + 0.5, L / 2 - u));
          const rail = box(0.07, 0.07, Math.hypot(L, h), M.metal, sd * 0.98, h / 2 + 1.0, 0);
          rail.rotation.x = Math.atan2(h, L); g.add(rail);
        });
        g.position.set(o.x, o.base, o.z);
        s.group.add(g);
        s.obs.push(o);
        continue;
      }
      if (type === "ladder") {
        const H = h + 1.0;
        [-0.3, 0.3].forEach(function (x) { g.add(box(0.07, H, 0.07, M.ladder, x, H / 2, 0.2)); });
        for (let y = 0.3; y < H - 0.05; y += 0.3) g.add(box(0.6, 0.045, 0.045, M.ladder, 0, y, 0.2));
        for (let y = 1; y < h; y += 2) [-0.3, 0.3].forEach(function (x) { g.add(box(0.05, 0.05, 0.2, M.dark, x, y, 0.1)); });
        [-0.3, 0.3].forEach(function (x) { const hoop = box(0.05, 0.05, 0.55, M.ladder, x, h + 0.95, -0.08); g.add(hoop); });
      } else if (type === "scaffold") {
        const H = h + 1.2;
        [-1.0, -0.35, 0.35, 1.0].forEach(function (x) { g.add(cyl(0.04, H, M.metal, x, H / 2, 0.12)); });
        for (let y = 0.5; y < H; y += 0.5) g.add(cyl(0.035, 2.1, M.metal, 0, y, 0.12, "x"));
        [-1.08, 1.08].forEach(function (x) {
          g.add(cyl(0.045, H, M.metal, x, H / 2, 0.95));
          for (let y = 1; y < H; y += 2) g.add(cyl(0.035, 0.85, M.metal, x, y, 0.53, "z"));
        });
        for (let y = 2; y < H; y += 2) g.add(cyl(0.035, 2.16, M.metal, 0, y, 0.95, "x"));
        g.add(box(2.2, 0.12, 0.12, M.hazard, 0, h + 0.05, 0.95));
      } else {       // wall-run: chalked chevrons and a hazard lip on top
        const a = new T.Mesh(new T.PlaneGeometry(0.9, 1.8), M.arrow); a.position.set(0, 1.4, 0.03); g.add(a);
        g.add(box(2.0, 0.1, 0.22, M.hazard, 0, h + 0.02, 0.08));
      }
      g.position.set(o.x, o.base, s.z0);
      s.group.add(g);
      s.obs.push(o);
    }
  }

  // Swing bar over a wide roof gap: jump at the edge, the hands catch it, swing across.
  // The bar hangs 2.9 m above the far roof, which is what the swing clip expects.
  function addSwing(s, next, speed) {
    const bz = s.z1 - Math.max(2.6, speed * 0.3), by = next.y0 + 2.9;
    s.bar = { z: bz, y: by, landY: next.y0, landZ: s.z1 - next.gap - 2.5 };
    const g = new T.Group();
    if (s.kind === "street") {   // a road-works trench across the street: swing over it or fall in
      const gap = next.gap, zc = s.z1 - gap / 2;
      s.pit = { z0: s.z1, z1: s.z1 - gap };
      g.add(box(10.6, 0.2, gap, M.pit, 0, -5.9, zc));
      [s.z1 - 0.15, s.z1 - gap + 0.15].forEach(function (z) { g.add(box(10.6, 5.9, 0.3, M.dirt, 0, -2.95, z)); });
      [-1, 1].forEach(function (sd) { g.add(box(0.3, 5.9, gap, M.dirt, sd * 5.45, -2.95, zc)); });
      [s.z1 + 0.2, s.z1 - gap - 0.2].forEach(function (z) { g.add(box(10.6, 0.05, 0.3, M.hazard, 0, 0.025, z)); });
      for (let x = -4.5; x <= 4.5; x += 3) g.add(cyl(0.12, 2.0, M.metal, x, -3, zc, "z"));   // exposed pipes
    }
    g.add(cyl(0.06, 11.6, M.metal, 0, by, bz, "x"));
    LANES.forEach(function (x) { g.add(cyl(0.068, 0.7, M.hazard, x, by, bz, "x")); });
    [-1, 1].forEach(function (sd) {
      g.add(box(0.16, by + 0.6, 0.16, M.dark, sd * 5.85, (by + 0.6) / 2 - 0.3, bz));
      g.add(box(0.5, 0.12, 0.12, M.dark, sd * 5.7, by + 0.25, bz));
    });
    s.group.add(g);
  }

  // ---------- generation ----------
  // A route flavours the course for one race of a series:
  //   "roof"  - no traffic, longer rooftop runs
  //   "truck" - long streets that are mostly box-truck stretches, short roof runs
  //   "mixed" - the usual mix, but always at least one truck stretch
  // pal = the palette the race starts in (0 dusk, 1 night, 2 dawn, 3 day).
  let route = "mixed", hadTraffic = false, palStart = 0;
  W.setRoute = function (r, pal) { route = r || "mixed"; palStart = pal || 0; };
  const streetLeft = (a, b) => route === "truck" ? R(a + 200, b + 240) : R(a, b);
  let cursorZ, prevY, phase, left, pending, prevKind, prevTraffic;
  W.reset = function (seed) {
    rnd = mulberry32(seed || 1);
    W.slabs.forEach(function (s) { dropSlab(s); });
    W.slabs.length = 0;
    bgSegs.forEach(function (g) { dropBg(g); });
    bgSegs.clear();
    if (G.Traffic) G.Traffic.clear();
    cursorZ = 40; prevY = 0; phase = "street"; left = 0; pending = null; prevKind = null; prevTraffic = false; hadTraffic = false;
    W.setPalette(0);
  };
  W.rewindSeed = function (seed) { rnd = mulberry32(seed); };

  function S(o) { if (o.y1 === undefined) o.y1 = o.y0; o.gap = o.gap || 0; return o; }
  function climbTo() { phase = "roof"; left = route === "truck" ? R(140, 220) : route === "roof" ? R(340, 500) : R(260, 440); }
  // Decide the next slab from the one before it.
  function plan(prev, speed, dist) {
    const D = Math.max(8, Math.min(20, speed)) * AIR_T;
    if (!prev) { phase = "street"; left = streetLeft(140, 200); return S({ kind: "street", len: 130, y0: 0 }); }
    const y = prev.y1;
    if (phase === "street") {
      if (left > 0) {
        // a stretch of moving traffic: no static rows, the trucks are the obstacle course
        const want = route === "truck" ? 0.9 : route === "roof" ? 0 : hadTraffic ? 0.34 : 1;
        if (dist > 40 && prev.kind === "street" && !prev.gap && !prev.traffic && left > (want >= 0.9 ? 60 : 150) && rnd() < want) {
          const len = R(150, 200); left -= len; hadTraffic = true;
          return S({ kind: "street", len: len, y0: 0, traffic: true });
        }
        const len = R(42, 66); left -= len;
        // a road-works trench with a swing bar over it
        if (dist > 120 && prev.kind === "street" && !prev.gap && !prev.traffic && rnd() < 0.22) {
          const gap = Math.max(speed * 0.3 + R(5, 7), D * 1.15 + 1);
          left -= gap;
          return S({ kind: "street", len: len, y0: 0, gap: gap, swing: true });
        }
        return S({ kind: "street", len: len, y0: 0 });
      }
      const r = rnd();
      if (r < 0.25) { phase = "stairsUp"; return S({ kind: "stairs", ramp: true, len: 3.1 * 1.45, y0: 0, y1: 3.1 }); }
      if (r < 0.7) { phase = "annex"; return S({ kind: "annex", len: R(18, 24) + speed * 0.6, y0: 3.1, face: "wallrun" }); }
      climbTo();
      return S({ kind: "roof", len: R(36, 56), y0: R(6.5, 8), face: "ladder" });
    }
    if (phase === "stairsUp") { phase = "annex"; return S({ kind: "annex", len: R(18, 24) + speed * 0.6, y0: y }); }
    if (phase === "annex") { climbTo(); return S({ kind: "roof", len: R(36, 56), y0: y + R(4.6, 6.2), face: "ladder" }); }
    if (phase === "roof" && left > 0) {
      const flatPrev = prev.kind === "roof" && !prev.ramp;
      if (flatPrev && dist > 80 && rnd() < 0.16) {
        const gap = Math.max(3.2, D * R(0.4, 0.74)), len = R(16, 24);
        const dir = y < 12 ? 1 : y > 22 ? -1 : (rnd() < 0.5 ? 1 : -1);
        left -= len + gap;
        return S({ kind: rnd() < 0.45 ? "stairs" : "roof", ramp: true, len: len, y0: y, y1: y + dir * R(2.5, 5), gap: gap });
      }
      let gap = Math.max(3.2, D * R(0.4, 0.74)), dy = 0, swing = false;
      const r = rnd();
      if (flatPrev && dist > 220 && r < 0.2) { swing = true; gap = Math.max(speed * 0.3 + R(5, 8), D * 1.15 + 1); dy = y - 0.8 > 7 ? -R(0, 0.8) : 0; }
      else if (r > 0.55 && r <= 0.88) dy = -R(1.2, 4);
      else if (r > 0.88) dy = R(0.45, 0.95);
      let y0 = y + dy;
      if (y0 < 7) y0 = y + 0.6;
      if (y0 > 26) y0 = y - 2;
      if (y0 > y) gap = Math.min(gap, D * 0.5);
      const len = R(28, 62);
      left -= len + gap;
      return S({ kind: "roof", len: len, y0: y0, gap: gap, swing: swing });
    }
    // descent: drop roof to roof, then down to the street (a jump, or a flight of stairs)
    phase = "down";
    if (y > 4.8) return S({ kind: "roof", len: R(20, 32), y0: Math.max(3.4, y - R(2.6, 4)), gap: Math.max(3.2, D * R(0.4, 0.66)) });
    if (y > 0.5 && prev.kind === "roof" && rnd() < 0.5) return S({ kind: "stairs", ramp: true, len: y * 1.45, y0: y, y1: 0 });
    phase = "street"; left = streetLeft(160, 260);
    return S({ kind: "street", len: R(42, 66), y0: 0, gap: 0 });
  }

  function addNext(speed, dist) {
    const sp = pending || plan(null, speed, dist);
    const z0 = cursorZ - sp.gap;
    const s = { kind: sp.kind, z0: z0, z1: z0 - sp.len, y0: sp.y0, y1: sp.y1, ramp: !!sp.ramp, style: RI(0, 3), obs: [], face: sp.face, base: prevY, prevKind: prevKind, gapBefore: sp.gap, traffic: !!sp.traffic, prevTraffic: prevTraffic };
    pending = plan(sp, speed, dist);
    s.gap = pending.gap; s.next = pending;
    s.group = s.kind === "street" ? buildStreet(s) : buildSlab(s, !s.ramp);
    W.slabs.push(s);
    if (s.face) addFace(s);
    if (s.traffic) G.Traffic.populate(s);
    else if (s.kind === "street") fillStreet(s, speed);
    else if (s.kind === "roof" && !s.ramp) fillRoof(s, speed);
    if (pending.swing) addSwing(s, pending, speed);
    bake(s.group);
    scene.add(s.group);
    cursorZ = s.z1; prevY = s.y1; prevKind = s.kind; prevTraffic = s.traffic;
  }

  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  function fillRoof(s, speed) {
    const first = s.z0 > 30;
    const sp = Math.min(24, speed + 2);
    const from = s.z0 - (first ? 90 : 12 + sp * 0.95);   // room to land (a drop adds airtime) and react
    const to = s.z1 + 9 + sp * 0.5;
    const dist = Math.max(0, -s.z0);
    const hard = Math.min(1, dist / 1500);
    let z = from;
    while (z > to) {
      const kind = rnd(), climbRow = dist > 100 && rnd() < 0.18;
      const free = RI(0, 2);                          // a lane that stays open for the row
      const lanes = [0, 1, 2];
      if (climbRow) {                                  // climb a fence / run up a brick wall
        const type = rnd() < 0.5 ? "fence" : "brick", n = rnd() < 0.6 ? 3 : 2;
        shuffle(lanes).slice(0, n).forEach(function (l) { obstacle(s, type, l, z); });
      } else if (kind < 0.30) {                        // low barriers: jump
        const n = rnd() < 0.5 ? 1 + RI(0, 1) : 3;
        const set = n === 3 ? lanes : shuffle(lanes).slice(0, n);
        set.forEach(function (l) { obstacle(s, "barrier", l, z); });
      } else if (kind < 0.52) {                        // overhead bars: slide
        const set = rnd() < 0.5 ? lanes : shuffle(lanes).slice(0, 2);
        set.forEach(function (l) { obstacle(s, "bar", l, z); });
      } else if (kind < 0.52 + 0.14 + 0.2 * hard) {    // containers: switch lane
        lanes.filter(function (l) { return l !== free; }).forEach(function (l) { if (rnd() < 0.85) obstacle(s, "wall", l, z); });
      } else if (kind < 0.9 + 0.1 * hard) {            // mixed: wall + barrier + open lane
        const o = lanes.filter(function (l) { return l !== free; });
        obstacle(s, "wall", o[0], z); obstacle(s, rnd() < 0.5 ? "barrier" : "bar", o[1], z);
      }                                                // else an open row: a breather
      z -= Math.max(11, sp * R(1.25, 1.9)) + 2;
    }
  }

  // Street rows. Every row leaves one lane open; the rest is shipping containers (2.6 m: step up
  // off a crate or dumpster, or double jump), double stacks, barriers and scaffold bars.
  // Crate -> container gap is 1.5-2 m: enough that a jump off the crate's back edge still clears
  // the container's front at the slowest speed.
  function fillStreet(s, speed) {
    const sp = Math.min(24, speed + 2);
    const dist = Math.max(0, -s.z0);
    const hard = Math.min(1, dist / 1500);
    const nextStreet = s.next.kind === "street" && !s.next.swing, prevStreet = s.prevKind === "street" && !s.gapBefore && !s.prevTraffic;
    let z = s.z0 - (s.z0 > 30 ? 90 : prevStreet ? 3 : 12 + sp * 0.95);
    const to = s.z1 + (nextStreet ? 2 : 14 + sp * 0.6);
    const step = function () { return rnd() < 0.6 ? "crate" : "dumpster"; };
    while (z > to) {
      const free = RI(0, 2), others = shuffle([0, 1, 2].filter(function (l) { return l !== free; }));
      const room = z - to, k = rnd();
      let depth = 1.6;
      if (k < 0.24 && room > 11) {                         // containers across two lanes, a step up in front of one
        const withStep = rnd() < 0.65;
        others.forEach(function (l, i) {
          if (i === 1 && rnd() < 0.25) return;
          if (i === 0 && withStep) { obstacle(s, step(), l, z); obstacle(s, "container", l, z - 1.8 - R(1.5, 2.0)); }
          else obstacle(s, "container", l, z - R(0, 1.5));
        });
        depth = 1.8 + 2.0 + 6.06;
      } else if (k < 0.40 && room > 24) {                  // containers end to end: step up and run the tops
        const l = others[0], n = RI(2, 3);
        obstacle(s, step(), l, z);
        let zz = z - 1.8 - R(1.5, 2.0);
        for (let i = 0; i < n; i++) {
          if (zz - 6.06 < to) break;
          obstacle(s, "container", l, zz);
          zz -= 6.06 + R(0.4, 0.9);
        }
        depth = z - zz;
        if (rnd() < 0.5) obstacle(s, rnd() < 0.5 ? "barrier" : "container", others[1], z - R(0, depth - 7));
      } else if (k < 0.5 && room > 16) {                   // container yard: step-up container beside a double stack
        obstacle(s, step(), others[0], z);
        obstacle(s, "container", others[0], z - 3.5);
        obstacle(s, "stack", others[1], z - 4.5);
        depth = 4.5 + 6.06;
      } else if (k < 0.7) {                                // jersey barriers: jump (or land on them)
        const n = rnd() < 0.5 ? 1 + RI(0, 1) : 3;
        (n === 3 ? [0, 1, 2] : others.slice(0, n)).forEach(function (l) { obstacle(s, "barrier", l, z); });
      } else if (k < 0.8 + 0.06 * hard) {                  // scaffold bars: slide
        (rnd() < 0.5 ? [0, 1, 2] : others).forEach(function (l) { obstacle(s, "bar", l, z); });
      } else if (k < 0.9 && dist > 100) {                  // fence / brick wall: climb over
        const type = rnd() < 0.5 ? "fence" : "brick";
        others.forEach(function (l) { obstacle(s, type, l, z); });
        if (rnd() < 0.6) obstacle(s, type, free, z);
      }                                                    // else an open row: a breather
      z -= depth + Math.max(11, sp * R(1.25, 1.9));
    }
  }

  function dropSlab(s) {
    if (G.Traffic) G.Traffic.dropZone(s);
    scene.remove(s.group);
    s.group.traverse(function (o) { if (o.geometry && !o.userData.shared) o.geometry.dispose(); });
  }

  // ---------- skyline ----------
  function buildBg(idx) {
    const r = mulberry32(idx * 7919 + 17);
    const g = new T.Group();
    const zTop = -idx * SEG;               // seg covers [zTop - SEG, zTop]
    [-1, 1].forEach(function (side) {
      [[10, 12, 60, 16, 32], [36, 28, 95, 18, 34], [66, 40, 150, 20, 40]].forEach(function (row, ri) {
        let z = zTop - r() * 6;
        while (z > zTop - SEG) {
          const w = row[3] + r() * (row[4] - row[3]), d = 14 + r() * 16, h = row[1] + r() * (row[2] - row[1]);
          const geo = towerGeo(w, h, d);
          const m = new T.Mesh(geo, M.facade[Math.floor(r() * 4)]);
          const x = side * (row[0] + w / 2 + r() * 4);
          m.position.set(x, STREET - 2 + h / 2, z - d / 2);
          g.add(m);
          if (ri === 0 && r() < 0.4 && h > 18) {
            const sg = new T.Mesh(new T.PlaneGeometry(6.4, 2.4), M.neon[Math.floor(r() * M.neon.length)]);
            sg.position.set(x - side * (w / 2 + 0.06), STREET + 9 + r() * Math.min(h - 12, 26), z - d / 2);
            sg.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
            g.add(sg);
          }
          if (ri < 2 && r() < 0.35) {   // rooftop cap / antenna
            g.add(box(0.3, 6 + r() * 12, 0.3, M.metal, x, STREET - 2 + h + 4, z - d / 2));
          }
          z -= d + 3 + r() * 6;
        }
      });
    });
    bake(g);
    scene.add(g);
    return g;
  }
  function dropBg(g) { scene.remove(g); g.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); }

  // ---------- per-frame ----------
  // pz = the leader (the world is generated ahead of it), pzTail = the last racer (nothing is
  // recycled while anyone can still stand on it)
  W.update = function (pz, speed, dist, pzTail) {
    if (pzTail === undefined) pzTail = pz;
    // generate ahead
    let guard = 0;
    while (cursorZ > pz - 190 && guard++ < 8) addNext(speed, dist);
    // recycle behind
    while (W.slabs.length > 3 && W.slabs[0].z1 > pzTail + 45) { dropSlab(W.slabs[0]); W.slabs.shift(); }
    // skyline segments
    const a = Math.floor((-pzTail - 60) / SEG), b = Math.floor((-pz + 240) / SEG);
    for (let i = a; i <= b; i++) if (!bgSegs.has(i)) bgSegs.set(i, buildBg(i));
    bgSegs.forEach(function (g, i) { if (i < a - 1) { dropBg(g); bgSegs.delete(i); } });
    // environment follows the player
    streetMesh.position.x = 0; streetMesh.position.z = pz;
    W.setPalette(dist);
  };
  W.followSky = function (cam) { sky.position.copy(cam.position); };
  W.AIR_T = AIR_T;
})(window.CJ = window.CJ || {});
