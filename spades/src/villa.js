// The set: a white villa on a headland at sunset. A stone terrace runs from the
// villa's glass doors to a frameless glass balustrade at the cliff edge; four card
// tables stand in a row under a timber pergola hung with string lights, each one
// a tier (Rookie, Regular, Sharp, Shark) with its own felt. Beside them an
// infinity pool, loungers and an umbrella; a fire-pit lounge in the middle; a bar
// against the villa wall; palms, olive trees in terracotta pots, bougainvillea.
// Below the cliff a sandy cove, the surf (HS.Ocean) and two headlands, the sun
// going down over the sea.
// Coordinates are the villa's own; everything lives in Room.world. The card game
// always happens at the origin, so sitting at table k moves the villa by -table k
// (Room.setActive) and the table code (cards, seats, view) never needs to know.
// Seat s at a table sits at seatPos(s) (0 south +z, 1 west, 2 north, 3 east): you
// take seat 0, facing the sea (-Z).
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const THREE = globalThis.THREE;
  const B = HS.Build, U = HS.U;
  const Room = { TABLE_Y: 0.72, TABLE_R: 0.66, SEAT_R: 0.98, CHAIR_SEAT_Y: 0.45, active: -1, blockers: [] };
  Room.seatPos = function (s, r) {
    r = r === undefined ? Room.SEAT_R : r;
    const a = s * Math.PI / 2;
    return new THREE.Vector3(-Math.sin(a) * r, 0, Math.cos(a) * r);
  };
  Room.seatYaw = function (s) { return -s * Math.PI / 2; };   // turns local -Z toward the table
  // Each seat's card tray (a wooden rack on the felt; cards.js stands the hand in it), from
  // Hop Spades af347cb: centre TRAY_R from the middle toward the seat, TRAY_W wide, cards leaning
  // back TRAY_LEAN with their bottom edge in the groove TRAY_GROOVE toward the owner.
  Room.TRAY_R = 0.53; Room.TRAY_W = 0.62; Room.TRAY_LEAN = 0.42; Room.TRAY_GROOVE = 0.012; Room.TRAY_FLOOR = 0.016;
  // The four tables (villa coordinates). Tier = the bots' level there.
  Room.TABLES = [
    { x: -21, z: -7, tier: "rookie", level: "easy", felt: ["#2a8a55", "#1b6640"], trim: 0x6e4a2c },
    { x: -14, z: -7, tier: "regular", level: "normal", felt: ["#2a6aa0", "#1b4a78"], trim: 0x5b3a24 },
    { x: -7, z: -7, tier: "sharp", level: "sharp", felt: ["#8e2a3a", "#661c28"], trim: 0x3e2616 },
    { x: 0, z: -7, tier: "shark", level: "shark", felt: ["#2b2f36", "#15181d"], trim: 0x1d1d1f }
  ];
  Room.SPAWN = { x: -10.5, z: 11.2, yaw: 0 };
  Room.BOUNDS = { x0: -26.4, x1: 21.4, z0: -10.55, z1: 12.9 };
  // The cliff, the beach and the sea.
  const EDGE_Z = -11, BEACH_TOP_Z = -13.5, BEACH_TOP_Y = -5.4, SLOPE = 1.2 / 35, WATER_Y = -6.4;
  const SHORE_Z = BEACH_TOP_Z - (BEACH_TOP_Y - WATER_Y) / SLOPE;
  Room.SUN = new THREE.Vector3(0.36, 0.085, -1).normalize();
  Room.world = null;

  let rnd = U.rng(20261014);
  const R = function (a, b) { return a + rnd() * (b - a); };
  const M = B.mat;

  // ------------------------------------------------------------------ textures
  function stoneTex() {   // pale travertine flagstones, 4 x 4 per tile repeat
    const S = 512, c = B.canvas(S, S), g = c.getContext("2d");
    g.fillStyle = "#d8cbb4"; g.fillRect(0, 0, S, S);
    const n = 4, w = S / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const k = 0.9 + Math.random() * 0.14;
      g.fillStyle = "rgb(" + Math.round(222 * k) + "," + Math.round(208 * k) + "," + Math.round(184 * k) + ")";
      g.fillRect(i * w + 2, j * w + 2, w - 4, w - 4);
      // Travertine's long pits.
      for (let p = 0; p < 26; p++) { g.fillStyle = "rgba(150,128,98," + (0.15 + Math.random() * 0.25) + ")"; g.fillRect(i * w + Math.random() * w, j * w + Math.random() * w, 3 + Math.random() * 14, 1 + Math.random() * 1.5); }
    }
    g.fillStyle = "rgba(120,104,84,0.55)";
    for (let i = 0; i <= n; i++) { g.fillRect(i * w - 1, 0, 2, S); g.fillRect(0, i * w - 1, S, 2); }
    for (let i = 0; i < 9000; i++) { g.globalAlpha = Math.random() * 0.18; g.fillStyle = Math.random() < 0.5 ? "#8a7a62" : "#fff6e6"; g.fillRect(Math.random() * S, Math.random() * S, 1.5, 1.5); }
    g.globalAlpha = 1;
    return B.tex(c, true);
  }
  function stuccoTex() {
    const S = 256, c = B.canvas(S, S), g = c.getContext("2d");
    g.fillStyle = "#f3eee6"; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 14000; i++) { g.globalAlpha = Math.random() * 0.12; g.fillStyle = Math.random() < 0.5 ? "#c9bfae" : "#ffffff"; g.fillRect(Math.random() * S, Math.random() * S, 2, 2); }
    g.globalAlpha = 1;
    return B.tex(c, true);
  }
  function rockTex() {
    const S = 512, c = B.canvas(S, S), g = c.getContext("2d");
    g.fillStyle = "#8a7766"; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 300; i++) {
      const x = Math.random() * S, y = Math.random() * S, r = 8 + Math.random() * 40;
      const k = 0.7 + Math.random() * 0.5;
      g.fillStyle = "rgba(" + Math.round(150 * k) + "," + Math.round(128 * k) + "," + Math.round(108 * k) + ",0.45)";
      g.beginPath(); g.ellipse(x, y, r, r * 0.55, Math.random() * 3, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 160; i++) { g.strokeStyle = "rgba(50,40,32,0.35)"; g.lineWidth = 1 + Math.random() * 2; g.beginPath(); let x = Math.random() * S, y = Math.random() * S; g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (Math.random() - 0.5) * 40; y += Math.random() * 25; g.lineTo(x, y); } g.stroke(); }
    return B.tex(c, true);
  }
  function sandTex() {
    const S = 256, c = B.canvas(S, S), g = c.getContext("2d");
    g.fillStyle = "#e3c9a0"; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 26000; i++) { g.globalAlpha = Math.random() * 0.35; g.fillStyle = ["#c9a878", "#f2dfbd", "#b89870", "#fff1d8"][(Math.random() * 4) | 0]; g.fillRect(Math.random() * S, Math.random() * S, 1.2, 1.2); }
    g.globalAlpha = 1;
    return B.tex(c, true);
  }
  function tileRoofTex() {   // terracotta barrel tiles
    const S = 256, c = B.canvas(S, S), g = c.getContext("2d");
    for (let x = 0; x < S; x += 32) {
      const grd = g.createLinearGradient(x, 0, x + 32, 0);
      grd.addColorStop(0, "#7c3a22"); grd.addColorStop(0.5, "#c86a42"); grd.addColorStop(1, "#7c3a22");
      g.fillStyle = grd; g.fillRect(x, 0, 32, S);
    }
    for (let y = 0; y < S; y += 42) { g.fillStyle = "rgba(60,25,12,0.5)"; g.fillRect(0, y, S, 4); }
    for (let i = 0; i < 4000; i++) { g.globalAlpha = Math.random() * 0.2; g.fillStyle = Math.random() < 0.5 ? "#4a2010" : "#f0a070"; g.fillRect(Math.random() * S, Math.random() * S, 2, 2); }
    g.globalAlpha = 1;
    return B.tex(c, true);
  }
  // Felt with the club's name round a ring and a spade in the middle.
  function feltTex(cols, text) {
    const S = 1024, c = B.canvas(S, S), g = c.getContext("2d");
    const grd = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.55);
    grd.addColorStop(0, cols[0]); grd.addColorStop(1, cols[1]);
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 50000; i++) { g.globalAlpha = Math.random() * 0.14; g.fillStyle = Math.random() < 0.5 ? "#000" : "#fff"; g.fillRect(Math.random() * S, Math.random() * S, 1.5, 1.5); }
    g.globalAlpha = 1;
    g.strokeStyle = "rgba(226,190,110,0.55)"; g.lineWidth = 5;
    g.beginPath(); g.arc(S / 2, S / 2, S * 0.43, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 2; g.beginPath(); g.arc(S / 2, S / 2, S * 0.415, 0, Math.PI * 2); g.stroke();
    // (The CTSG seal in the middle is its own decal: Room.build lays it on the felt.)
    g.save(); g.translate(S / 2, S / 2);
    g.font = "700 40px Georgia, 'Times New Roman', serif"; g.textAlign = "center"; g.fillStyle = "rgba(226,190,110,0.6)";
    const Rr = S * 0.37;
    for (let k = 0; k < 2; k++) for (let i = 0; i < text.length; i++) {
      const a = (k * Math.PI) + (i - text.length / 2) * 0.062;
      g.save(); g.rotate(a); g.translate(0, -Rr); g.fillText(text[i], 0, 0); g.restore();
    }
    g.restore();
    return B.tex(c, false);
  }
  // A palm frond: a midrib with leaflets, on transparent.
  function frondTex() {
    const W = 128, H = 512, c = B.canvas(W, H), g = c.getContext("2d");
    g.strokeStyle = "#6b6a2e"; g.lineWidth = 4;
    g.beginPath(); g.moveTo(W / 2, H); g.lineTo(W / 2, 0); g.stroke();
    for (let y = 10; y < H - 20; y += 7) {
      const L = Math.sin((y / H) * Math.PI) * 56 + 6;
      [-1, 1].forEach(function (s) {
        const k = 0.75 + Math.random() * 0.35;
        g.strokeStyle = "rgb(" + Math.round(70 * k) + "," + Math.round(118 * k) + "," + Math.round(52 * k) + ")";
        g.lineWidth = 3.2;
        g.beginPath(); g.moveTo(W / 2, y); g.quadraticCurveTo(W / 2 + s * L * 0.6, y - 4, W / 2 + s * L, y + 14); g.stroke();
      });
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }
  // A canvas sign: the table's tier.
  function signTex(title, sub, color) {
    const c = B.canvas(512, 256), g = c.getContext("2d");
    g.fillStyle = "#1c1712"; g.fillRect(0, 0, 512, 256);
    g.strokeStyle = color; g.lineWidth = 10; g.strokeRect(14, 14, 484, 228);
    g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "900 92px Georgia, 'Times New Roman', serif"; g.fillText(title, 256, 112, 450);
    g.fillStyle = "#e9dcc0"; g.font = "600 34px 'Segoe UI', system-ui, sans-serif"; g.fillText(sub, 256, 192, 450);
    return B.tex(c, false);
  }

  // ------------------------------------------------------------------ materials
  function materials() {
    return {
      stone: new THREE.MeshStandardMaterial({ map: stoneTex(), vertexColors: true, roughness: 0.82 }),
      stucco: new THREE.MeshStandardMaterial({ map: stuccoTex(), vertexColors: true, roughness: 0.9 }),
      wood: new THREE.MeshStandardMaterial({ map: B.woodTex(), vertexColors: true, roughness: 0.7 }),
      rock: new THREE.MeshStandardMaterial({ map: rockTex(), vertexColors: true, roughness: 0.95 }),
      sand: new THREE.MeshStandardMaterial({ map: sandTex(), vertexColors: true, roughness: 1 }),
      tiles: new THREE.MeshStandardMaterial({ map: tileRoofTex(), vertexColors: true, roughness: 0.8 }),
      metal: new THREE.MeshStandardMaterial({ map: B.metalTex(), vertexColors: true, metalness: 0.6, roughness: 0.38 }),
      paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
      fabric: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
      leather: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.05 }),
      clay: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
      leaf: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }),
      glass: new THREE.MeshStandardMaterial({ color: 0x9fc4c8, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.4, depthWrite: false }),
      window: new THREE.MeshStandardMaterial({ color: 0x48606a, transparent: true, opacity: 0.45, roughness: 0.04, metalness: 0.6, depthWrite: false }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      interior: new THREE.MeshBasicMaterial({ vertexColors: true }),
      pool: new THREE.MeshStandardMaterial({ color: 0x3fc6d8, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.86, emissive: 0x0c4c5a, emissiveIntensity: 0.6 })
    };
  }

  // ------------------------------------------------------------------ a table and its chairs
  function table(b, T) {
    const Y = Room.TABLE_Y, TR = Room.TABLE_R, x = T.x, z = T.z;
    const top = new THREE.Mesh(new THREE.CircleGeometry(TR - 0.035, 72), null);
    top.rotation.x = -Math.PI / 2; top.position.set(x, Y + 0.002, z);
    b.add("wood", B.cyl(TR + 0.02, TR + 0.02, 0.04, 72), M([x, Y - 0.02, z]), T.trim, { tile: 0.6 });
    b.add("leather", B.torus(TR - 0.005, 0.034, 10, 72), M([x, Y + 0.012, z], [Math.PI / 2, 0, 0], [1, 1, 0.75]), 0x2a1712);
    b.add("wood", B.cyl(TR - 0.04, TR - 0.06, 0.09, 64, true), M([x, Y - 0.085, z]), T.trim, { tile: 0.6 });
    b.add("wood", B.lathe([[0.001, 0], [0.24, 0], [0.24, 0.025], [0.16, 0.05], [0.08, 0.08], [0.06, 0.16], [0.075, 0.24], [0.06, 0.33], [0.045, 0.45], [0.05, 0.55], [0.07, 0.6], [0.13, 0.63], [0.001, 0.63]], 32), M([x, 0, z]), T.trim, { tile: 0.4 });
    for (let k = 0; k < 4; k++) {
      const ca = k * Math.PI / 2 + Math.PI / 4, cx = x + Math.cos(ca) * (TR + 0.05), cz = z + Math.sin(ca) * (TR + 0.05);
      b.add("metal", B.torus(0.045, 0.008, 6, 20), M([cx, Y + 0.012, cz], [Math.PI / 2, 0, 0]), 0xb8a070);
      b.add("metal", B.cyl(0.044, 0.04, 0.07, 18, true), M([cx, Y - 0.025, cz]), 0x6a6a6a);
    }
    for (let s = 0; s < 4; s++) { const p = Room.seatPos(s, Room.SEAT_R + 0.12); chair(b, x + p.x, z + p.z, Room.seatYaw(s)); tray(b, x, z, s); }
    // A round outdoor rug.
    b.add("fabric", B.cyl(1.9, 1.9, 0.012, 48), M([x, 0.006, z]), 0xd9cdb5);
    b.add("fabric", B.torus(1.82, 0.03, 4, 64), M([x, 0.012, z], [Math.PI / 2, 0, 0], [1, 1, 0.2]), 0x7a5a3a);
    Room.blockers.push({ x: x, z: z, r: 1.62 });
    return top;
  }
  // A card tray on the felt in front of seat s of the table at (x, z): a base, a low lip on
  // the owner's side, a back rest leaning toward the middle, end caps (Hop Spades' tray).
  function tray(b, x, z, s) {
    const p = Room.seatPos(s, Room.TRAY_R), Y = Room.TABLE_Y + 0.002, W = Room.TRAY_W, L = Room.TRAY_LEAN, z0 = Room.TRAY_GROOVE, fl = Room.TRAY_FLOOR;
    const m = new THREE.Matrix4().makeRotationY(Room.seatYaw(s)).setPosition(x + p.x, 0, z + p.z);
    const add = function (g, pos, rot, col) { b.add("wood", g, m.clone().multiply(M(pos, rot)), col, { tile: 0.5 }); };
    add(B.rbox(W, fl, 0.09, 0.006), [0, Y + fl / 2, -0.005], [0, 0, 0], 0x6b4426);
    add(B.rbox(W, 0.014, 0.012, 0.004), [0, Y + fl + 0.006, z0 + 0.014], [0, 0, 0], 0x4b2f1d);
    const h = 0.05;
    add(B.rbox(W, h, 0.01, 0.004), [0, Y + fl + Math.cos(L) * h / 2, z0 - Math.sin(L) * h / 2 - 0.012], [-L, 0, 0], 0x5a3a20);
    [-1, 1].forEach(function (k) { add(B.rbox(0.014, 0.034, 0.09, 0.004), [k * (W / 2 + 0.007), Y + 0.017, -0.005], [0, 0, 0], 0x4b2f1d); });
  }
  function chair(b, x, z, yaw) {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, z);
    const add = function (mat, g, p, r, col, o) { b.add(mat, g, m.clone().multiply(M(p, r)), col, o); };
    const WOOD = 0x9a6a40, DARK = 0x5a3a22;
    for (let i = 0; i < 5; i++) add("wood", B.box(0.48, 0.025, 0.08), [0, 0.45, -0.19 + i * 0.095], [0, 0, 0], i % 2 ? WOOD : 0xa6774a, { tile: 0.5 });
    [[-0.21, -0.2], [0.21, -0.2]].forEach(function (p) { add("wood", B.cyl(0.022, 0.018, 0.44, 10), [p[0], 0.22, p[1]], [0, 0, 0], DARK, { tile: 0.5 }); });
    [[-0.21, 0.2], [0.21, 0.2]].forEach(function (p) { add("wood", B.box(0.045, 0.95, 0.045), [p[0], 0.475, p[1] + 0.03], [-0.1, 0, 0], DARK, { tile: 0.5 }); });
    add("wood", B.box(0.46, 0.03, 0.03), [0, 0.18, -0.2], [0, 0, 0], DARK, { tile: 0.5 });
    add("wood", B.box(0.46, 0.03, 0.03), [0, 0.18, 0.2], [0, 0, 0], DARK, { tile: 0.5 });
    for (let i = 0; i < 5; i++) add("wood", B.box(0.055, 0.42, 0.018), [-0.16 + i * 0.08, 0.69, 0.235 + 0.008 * Math.abs(i - 2)], [-0.1, 0, 0], WOOD, { tile: 0.5 });
    add("wood", B.box(0.48, 0.07, 0.035), [0, 0.92, 0.262], [-0.1, 0, 0], DARK, { tile: 0.5 });
    add("fabric", B.rbox(0.44, 0.05, 0.4, 0.05), [0, 0.488, 0.005], [0, 0, 0], 0xf0e8d8);
  }
  // The sign by each table: a little easel facing the villa.
  function sign(scene, b, T, i) {
    const x = T.x + 1.25, z = T.z + 1.9;
    b.add("wood", B.box(0.04, 1.1, 0.04), M([x - 0.25, 0.55, z], [0.12, 0, 0]), 0x3a2616);
    b.add("wood", B.box(0.04, 1.1, 0.04), M([x + 0.25, 0.55, z], [0.12, 0, 0]), 0x3a2616);
    b.add("wood", B.box(0.04, 1.1, 0.04), M([x, 0.52, z - 0.18], [-0.3, 0, 0]), 0x3a2616);
    const col = ["#7fd39a", "#7fb6e6", "#f08a8a", "#e8c46a"][i];
    const sub = ["Easy going", "Solid players", "They count cards", "Best at the villa"][i];
    const tex = signTex(T.tier.toUpperCase(), sub, col);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.33), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 }));
    board.position.set(x, 0.92, z + 0.05); board.rotation.x = -0.12;
    scene.add(board);
    T.sign = board;
    T.signTex = tex;
  }

  // ------------------------------------------------------------------ the terrace
  function terrace(b) {
    const X0 = -27, X1 = 22, Z0 = EDGE_Z, Z1 = 14;
    // Flagstones (the pool is cut out of them: the slab is built round it).
    const PX0 = 5, PX1 = 19, PZ0 = -10.4, PZ1 = -2.5;
    const slab = function (x0, x1, z0, z1) { b.add("stone", B.box(x1 - x0, 0.5, z1 - z0), M([(x0 + x1) / 2, -0.25, (z0 + z1) / 2]), 0xffffff, { tile: 2.4 }); };
    slab(X0, PX0, Z0, Z1); slab(PX1, X1, Z0, Z1); slab(PX0, PX1, PZ1, Z1); slab(PX0, PX1, Z0, PZ0);
    // The slab's front face down to the rock, and a thin stone lip at the edge.
    b.add("stone", B.box(X1 - X0, 0.9, 0.3), M([(X0 + X1) / 2, -0.6, Z0 - 0.15]), 0xe8dcc6, { tile: 1.2 });
    b.add("stone", B.box(X1 - X0 + 0.1, 0.05, 0.36), M([(X0 + X1) / 2, 0.025, Z0 - 0.06]), 0xf2e8d6, { tile: 1.2 });
    // The ends: low stucco walls with stone caps.
    [[X0, -1], [X1, 1]].forEach(function (e) {
      b.add("stucco", B.box(0.4, 1.0, Z1 - Z0), M([e[0] + e[1] * 0.2, 0.5, (Z0 + Z1) / 2]), 0xf6efe4, { tile: 2 });
      b.add("stone", B.box(0.55, 0.08, Z1 - Z0 + 0.1), M([e[0] + e[1] * 0.2, 1.04, (Z0 + Z1) / 2]), 0xe8dcc6, { tile: 1.2 });
    });
    // The glass balustrade: frameless panels in a steel shoe, a slim top rail.
    for (let x = X0 + 0.2; x < X1 - 0.2; x += 2) {
      const w = Math.min(1.96, X1 - 0.2 - x);
      b.add("glass", B.box(w, 1.05, 0.02), M([x + w / 2, 0.58, Z0 + 0.12]));
    }
    b.add("metal", B.box(X1 - X0, 0.06, 0.07), M([(X0 + X1) / 2, 0.04, Z0 + 0.12]), 0x9a9a9a);
    b.add("metal", B.cyl(0.022, 0.022, X1 - X0, 10), M([(X0 + X1) / 2, 1.12, Z0 + 0.12], [0, 0, Math.PI / 2]), 0xc8c8c8);
    // The infinity pool: a basin, water to the brim on the sea side, a spill channel below.
    b.add("stone", B.box(PX1 - PX0, 1.4, 0.2), M([(PX0 + PX1) / 2, -0.7, PZ1 - 0.1]), 0xf2e8d6, { tile: 1 });
    b.add("stone", B.box(0.2, 1.4, PZ1 - PZ0), M([PX0 + 0.1, -0.7, (PZ0 + PZ1) / 2]), 0xf2e8d6, { tile: 1 });
    b.add("stone", B.box(0.2, 1.4, PZ1 - PZ0), M([PX1 - 0.1, -0.7, (PZ0 + PZ1) / 2]), 0xf2e8d6, { tile: 1 });
    b.add("paint", B.box(PX1 - PX0, 0.1, PZ1 - PZ0), M([(PX0 + PX1) / 2, -1.4, (PZ0 + PZ1) / 2]), 0x6fd2e2);
    b.add("paint", B.box(PX1 - PX0 - 0.4, 1.3, 0.05), M([(PX0 + PX1) / 2, -0.75, PZ0 + 0.05]), 0x58c2d6);
    Room.pool = { x0: PX0, x1: PX1, z0: PZ0, z1: PZ1 };
    Room.blockers.push({ x0: PX0 - 0.1, x1: PX1 + 0.1, z0: PZ0 - 1, z1: PZ1 + 0.15 });
    // Steps into the pool.
    for (let i = 0; i < 3; i++) b.add("stone", B.box(2.2, 0.06, 0.4), M([PX1 - 1.4, -0.25 - i * 0.3, PZ1 - 0.35 - i * 0.4]), 0xf2e8d6);
  }
  // The pergola over the table row: posts, beams, rafters, a vine, string lights.
  function pergola(b, scene) {
    const X0 = -25, X1 = 3.5, ZF = -10, ZB = -4, H = 2.85;
    const posts = [];
    [X0, -17.5, -10.5, -3.5, X1].forEach(function (x) { [ZF, ZB].forEach(function (z) { posts.push([x, z]); }); });
    posts.forEach(function (p) {
      b.add("stucco", B.box(0.32, H, 0.32), M([p[0], H / 2, p[1]]), 0xf6efe4, { tile: 1 });
      b.add("stone", B.box(0.42, 0.1, 0.42), M([p[0], 0.05, p[1]]), 0xe0d4be);
      Room.blockers.push({ x: p[0], z: p[1], r: 0.32 });
    });
    [ZF, ZB].forEach(function (z) { b.add("wood", B.box(X1 - X0 + 0.6, 0.26, 0.16), M([(X0 + X1) / 2, H + 0.13, z]), 0x6a4528, { tile: 1 }); });
    for (let x = X0 - 0.2; x <= X1 + 0.2; x += 0.55) b.add("wood", B.box(0.07, 0.18, ZB - ZF + 1.2), M([x, H + 0.35, (ZF + ZB) / 2]), 0x7a5232, { tile: 1 });
    // String lights in swags between the beams over each table, and along the front beam.
    const bulbs = [];
    const swag = function (a, c, sag) {
      const pts = B.catenary(a, c, sag, 20);
      b.add("paint", B.tube(pts, 0.005, 40, 4), null, 0x1a1a1a);
      const len = Math.hypot(a[0] - c[0], a[2] - c[2]), n = Math.round(len / 0.45);
      for (let k = 1; k < n; k++) {
        const t = k / n, p = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (c[2] - a[2]) * t];
        b.add("glow", B.sphere(0.03, 10, 8), M([p[0], p[1] - 0.06, p[2]], [0, 0, 0], [1, 1.25, 1]), 0xffd08a);
        bulbs.push(new THREE.Vector3(p[0], p[1] - 0.06, p[2]));
      }
    };
    Room.TABLES.forEach(function (T) {
      swag([T.x - 2.6, H, ZF + 0.1], [T.x + 2.6, H, ZB - 0.1], 0.5);
      swag([T.x + 2.6, H, ZF + 0.1], [T.x - 2.6, H, ZB - 0.1], 0.5);
    });
    swag([X0, H - 0.05, ZF - 0.1], [X1, H - 0.05, ZF - 0.1], 0.35);
    const hp = new Float32Array(bulbs.length * 3);
    bulbs.forEach(function (v, i) { hp[i * 3] = v.x; hp[i * 3 + 1] = v.y; hp[i * 3 + 2] = v.z; });
    const hg = new THREE.BufferGeometry(); hg.setAttribute("position", new THREE.BufferAttribute(hp, 3));
    const halos = new THREE.Points(hg, new THREE.PointsMaterial({ map: B.glowTex(0.1), color: 0xffb860, size: 0.4, sizeAttenuation: true, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
    halos.renderOrder = 5;
    scene.add(halos);
    Room.halos = halos;
    // (No vine on the beams: against the sunset its leaves read as black specks in the sky.)
    return [];
  }
  // The villa: two white storeys, big glass doors onto the terrace, a lit interior,
  // arched upper windows, a balcony, a tiled tower roof, bougainvillea.
  function villa(b) {
    const Z = 14, X0 = -27, X1 = 22, H1 = 3.6, H2 = 7.1, D = 12;
    // Walls with openings: piers between glass bays on the ground floor.
    const bays = [[-19, -12], [-9.5, -2], [2, 9]];
    let x = X0;
    bays.forEach(function (bay) {
      b.add("stucco", B.box(bay[0] - x, H1, 0.4), M([(x + bay[0]) / 2, H1 / 2, Z + 0.2]), 0xf6efe4, { tile: 2 });
      // The glass bay: sliding doors in dark frames, the warm room behind.
      const w = bay[1] - bay[0], cx = (bay[0] + bay[1]) / 2;
      b.add("window", B.box(w, 2.9, 0.04), M([cx, 1.45, Z + 0.2]));
      for (let k = 0; k <= 4; k++) b.add("metal", B.box(0.06, 2.9, 0.08), M([bay[0] + k * w / 4, 1.45, Z + 0.2]), 0x2a2a2c);
      b.add("metal", B.box(w, 0.08, 0.1), M([cx, 2.9, Z + 0.2]), 0x2a2a2c);
      b.add("stucco", B.box(w, H1 - 2.9, 0.4), M([cx, 2.9 + (H1 - 2.9) / 2, Z + 0.2]), 0xf6efe4, { tile: 2 });
      // Inside: floor, back wall in lamplight, a sofa, a lamp, a picture.
      b.add("interior", B.box(w, 0.05, 5), M([cx, 0.02, Z + 2.8]), 0x8a6a4a);
      b.add("interior", B.box(w, 2.9, 0.1), M([cx, 1.45, Z + 5.2]), 0xe7c9a0);
      b.add("interior", B.box(w * 0.5, 0.45, 0.9), M([cx, 0.3, Z + 4.4]), 0x6a7a8a);
      b.add("interior", B.box(w * 0.5, 0.5, 0.2), M([cx, 0.65, Z + 4.85]), 0x5a6a7a);
      b.add("glow", B.sphere(0.22, 12, 8), M([bay[0] + 0.8, 1.6, Z + 4.6]), 0xffd8a0);
      b.add("interior", B.box(1.2, 0.8, 0.03), M([cx + w * 0.25, 1.7, Z + 5.12]), 0x3a6a8a);
      b.add("interior", B.box(w, 0.1, 5), M([cx, 2.9, Z + 2.8]), 0xcfb08a);
      x = bay[1];
    });
    b.add("stucco", B.box(X1 - x, H1, 0.4), M([(x + X1) / 2, H1 / 2, Z + 0.2]), 0xf6efe4, { tile: 2 });
    // Floor slab / balcony between storeys.
    b.add("stucco", B.box(X1 - X0, 0.3, 2.4), M([(X0 + X1) / 2, H1 + 0.15, Z - 0.8]), 0xf2ebe0, { tile: 2 });
    for (let xx = X0 + 0.3; xx < X1 - 0.3; xx += 2) b.add("glass", B.box(Math.min(1.96, X1 - 0.3 - xx), 1, 0.02), M([xx + Math.min(1.96, X1 - 0.3 - xx) / 2, H1 + 0.8, Z - 1.95]));
    b.add("metal", B.cyl(0.02, 0.02, X1 - X0, 8), M([(X0 + X1) / 2, H1 + 1.32, Z - 1.95], [0, 0, Math.PI / 2]), 0xc8c8c8);
    // Upper storey with arched windows.
    b.add("stucco", B.box(X1 - X0, H2 - H1, 0.4), M([(X0 + X1) / 2, (H1 + H2) / 2, Z + 0.2]), 0xf6efe4, { tile: 2 });
    for (let xx = X0 + 3; xx < X1 - 2; xx += 4.2) {
      b.add("window", B.box(1.4, 1.9, 0.05), M([xx, H1 + 1.55, Z - 0.02]));
      b.add("window", B.cyl(0.7, 0.7, 0.05, 20, false), M([xx, H1 + 2.5, Z - 0.02], [Math.PI / 2, 0, 0], [1, 1, 1]));
      b.add("interior", B.box(1.4, 2.4, 0.05), M([xx, H1 + 1.7, Z + 0.3]), 0xd9b58a);
      b.add("paint", B.box(0.7, 2.1, 0.04), M([xx - 1.05, H1 + 1.45, Z - 0.03]), 0x2f6a7a);   // shutters
      b.add("paint", B.box(0.7, 2.1, 0.04), M([xx + 1.05, H1 + 1.45, Z - 0.03]), 0x2f6a7a);
    }
    // The rest of the house (behind) and a parapet.
    b.add("stucco", B.box(X1 - X0, H2, D), M([(X0 + X1) / 2, H2 / 2, Z + 0.4 + D / 2]), 0xefe8dc, { tile: 2 });
    b.add("stone", B.box(X1 - X0 + 0.3, 0.12, 0.6), M([(X0 + X1) / 2, H2 + 0.06, Z + 0.2]), 0xe8dcc6, { tile: 1.2 });
    // A tower with a terracotta hip roof at the left.
    const TX = -20, TW = 6;
    b.add("stucco", B.box(TW, 3.2, TW), M([TX, H2 + 1.6, Z + 3.2]), 0xf6efe4, { tile: 2 });
    b.add("tiles", B.cyl(0.01, TW * 0.78, 2.2, 4), M([TX, H2 + 3.2 + 1.1, Z + 3.2], [0, Math.PI / 4, 0]), 0xffffff, { tile: 1.2 });
    for (let k = -1; k <= 1; k += 2) {
      b.add("window", B.box(0.9, 1.4, 0.05), M([TX + k * 1.4, H2 + 1.7, Z + 0.17]));
      b.add("interior", B.box(0.9, 1.4, 0.05), M([TX + k * 1.4, H2 + 1.7, Z + 0.4]), 0xe9c08a);
    }
    // Wall lanterns between the bays.
    [-20.5, -10.7, 0, 10.5].forEach(function (lx) {
      b.add("metal", B.box(0.18, 0.3, 0.18), M([lx, 2.45, Z - 0.1]), 0x2a2a2a);
      b.add("glow", B.box(0.13, 0.22, 0.13), M([lx, 2.45, Z - 0.1]), 0xffc070);
    });
    Room.blockers.push({ x0: X0, x1: X1, z0: Z - 0.2, z1: Z + 20 });
  }
  // The fire-pit lounge in the middle of the terrace: an L sofa, chairs, the fire.
  function lounge(b) {
    const cx = -6.5, cz = 4.8;
    const sofa = function (x, z, w, yaw) {
      const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, z);
      const add = function (mat, g, p, col) { b.add(mat, g, m.clone().multiply(M(p)), col); };
      add("wood", B.box(w, 0.3, 0.95), [0, 0.15, 0], 0x6a4a30);
      add("fabric", B.rbox(w - 0.06, 0.16, 0.85, 0.06), [0, 0.38, 0.02], 0xece4d4);
      add("fabric", B.rbox(w - 0.06, 0.45, 0.22, 0.08), [0, 0.62, 0.38], 0xe6dccb);
      for (let k = 0; k < Math.floor(w / 0.9); k++) add("fabric", B.rbox(0.42, 0.38, 0.14, 0.06), [-w / 2 + 0.55 + k * 0.9, 0.62, 0.22], [0x2f6a7a, 0xd98a4a, 0xe8d8b0][k % 3]);
    };
    sofa(cx, cz + 1.6, 3.6, 0);                 // facing -Z (the sea), behind the fire
    sofa(cx - 2.2, cz, 2.6, -Math.PI / 2);      // the short side, facing +X
    sofa(cx + 2.2, cz, 2.6, Math.PI / 2);
    // The fire pit: a stone bowl.
    b.add("stone", B.cyl(0.6, 0.5, 0.42, 28), M([cx, 0.21, cz]), 0xc8b8a0, { tile: 0.6 });
    b.add("rock", B.cyl(0.5, 0.5, 0.02, 24), M([cx, 0.42, cz]), 0x2a2420, { tile: 0.5 });
    Room.fire = new THREE.Vector3(cx, 0.6, cz);
    Room.blockers.push({ x0: cx - 2.75, x1: cx + 2.75, z0: cz - 1.3, z1: cz + 2.15 });
    // Where the lounge's sitters go: [x, z, yaw].
    Room.LOUNGE = [[cx - 0.8, cz + 1.45, 0], [cx + 0.8, cz + 1.45, 0], [cx - 2.05, cz - 0.4, -Math.PI / 2], [cx + 2.05, cz + 0.3, Math.PI / 2]];
    // A side table with drinks.
    b.add("wood", B.cyl(0.3, 0.3, 0.04, 20), M([cx + 1.9, 0.45, cz + 1.7]), 0x6a4a30);
    b.add("wood", B.cyl(0.04, 0.05, 0.45, 8), M([cx + 1.9, 0.22, cz + 1.7]), 0x4a3020);
  }
  // Loungers and an umbrella by the pool; the bar against the villa.
  function poolside(b) {
    for (let i = 0; i < 5; i++) {
      const x = 6.5 + i * 2.6, z = -0.6;
      const m = new THREE.Matrix4().makeRotationY(Math.PI).setPosition(x, 0, z);
      const add = function (mat, g, p, r, col) { b.add(mat, g, m.clone().multiply(M(p, r)), col); };
      add("wood", B.box(0.7, 0.08, 1.4), [0, 0.3, 0.35], [0, 0, 0], 0x8a5e3a);
      add("wood", B.box(0.7, 0.08, 0.7), [0, 0.5, -0.55], [0.6, 0, 0], 0x8a5e3a);
      add("fabric", B.rbox(0.64, 0.08, 1.36, 0.04), [0, 0.38, 0.35], [0, 0, 0], 0xf4efe6);
      add("fabric", B.rbox(0.64, 0.08, 0.66, 0.04), [0, 0.57, -0.52], [0.6, 0, 0], 0xf4efe6);
      [[-0.3, 0.95], [0.3, 0.95], [-0.3, -0.25], [0.3, -0.25]].forEach(function (p) { add("wood", B.box(0.05, 0.3, 0.05), [p[0], 0.15, p[1]], [0, 0, 0], 0x5a3a22); });
      if (i % 2 === 1) {   // a folded towel
        add("fabric", B.box(0.5, 0.06, 0.3), [0, 0.46, 0.8], [0, 0, 0], [0x2f6a7a, 0xd98a4a][i % 2 ? 0 : 1]);
      }
    }
    Room.blockers.push({ x0: 5.6, x1: 18.2, z0: -1.6, z1: 0.6 });
    // A big umbrella between loungers.
    const ux = 12.5, uz = 1.6;
    b.add("metal", B.cyl(0.035, 0.035, 2.6, 10), M([ux, 1.3, uz]), 0xd8d8d8);
    b.add("stone", B.cyl(0.3, 0.34, 0.12, 20), M([ux, 0.06, uz]), 0xd0c4b0);
    b.add("fabric", B.cyl(0.02, 1.6, 0.45, 8, true), M([ux, 2.45, uz]), 0xf4ead8);
    b.add("fabric", B.cyl(1.6, 1.6, 0.12, 8, true), M([ux, 2.17, uz]), 0x2f6a7a);
    Room.blockers.push({ x: ux, z: uz, r: 0.35 });
    // The bar.
    const bx = 14.5, bz = 11.6;
    b.add("stone", B.box(6, 1.05, 0.7), M([bx, 0.525, bz]), 0xe8dcc6, { tile: 1 });
    b.add("wood", B.box(6.2, 0.06, 0.85), M([bx, 1.08, bz - 0.05]), 0x6a4528, { tile: 1 });
    b.add("wood", B.box(6, 0.04, 0.35), M([bx, 2.0, 13.75]), 0x6a4528);
    b.add("wood", B.box(6, 0.04, 0.35), M([bx, 2.5, 13.75]), 0x6a4528);
    for (let i = 0; i < 18; i++) {   // bottles
      const px = bx - 2.8 + i * 0.32, row = i % 2;
      b.add("glow", B.cyl(0.035, 0.04, 0.26, 8), M([px, (row ? 2.5 : 2.0) + 0.15, 13.75]), [0x6a9a4a, 0xc89a4a, 0x8a3a3a, 0xd8d8b0][i % 4]);
    }
    for (let i = 0; i < 4; i++) {
      const sx = bx - 2.2 + i * 1.45, sz = bz - 0.8;
      b.add("metal", B.cyl(0.025, 0.025, 0.75, 8), M([sx, 0.38, sz]), 0x2a2a2a);
      b.add("leather", B.cyl(0.2, 0.2, 0.07, 16), M([sx, 0.78, sz]), 0x5a3a28);
      b.add("metal", B.torus(0.15, 0.012, 4, 16), M([sx, 0.3, sz], [Math.PI / 2, 0, 0]), 0x2a2a2a);
    }
    Room.blockers.push({ x0: bx - 3.2, x1: bx + 3.2, z0: bz - 0.5, z1: 14 });
    Room.BAR = [[bx - 1.5, bz - 1.2, Math.PI], [bx + 1.4, bz - 1.25, Math.PI + 0.3], [bx + 0.2, 12.9, 0]];
  }
  // Plants: palms, olive trees in terracotta pots, shrubs, bougainvillea.
  function greenery(b, scene, vine) {
    const leaves = vine.slice();
    const pot = function (x, z, r, h) {
      b.add("clay", B.lathe([[0.001, 0], [r * 0.7, 0], [r, h * 0.85], [r * 1.08, h * 0.88], [r * 1.08, h], [0.001, h]], 24), M([x, 0, z]), 0xb5623a);
      b.add("sand", B.cyl(r * 0.98, r * 0.98, 0.02, 20), M([x, h - 0.04, z]), 0x5a4030);
      Room.blockers.push({ x: x, z: z, r: r + 0.15 });
    };
    const olive = function (x, z) {
      pot(x, z, 0.42, 0.7);
      const trunk = [[x, 0.66, z], [x + 0.06, 1.1, z - 0.04], [x - 0.04, 1.6, z + 0.05], [x + 0.02, 2.0, z]];
      b.add("wood", B.tube(trunk, 0.05, 14, 7), null, 0x6a5848);
      for (let k = 0; k < 6; k++) {
        const a = k / 6 * Math.PI * 2, e = [x + Math.cos(a) * R(0.35, 0.6), R(1.9, 2.4), z + Math.sin(a) * R(0.35, 0.6)];
        for (let n = 0; n < 60; n++) {
          const u = new THREE.Vector3(R(-1, 1), R(-0.7, 1), R(-1, 1)).normalize().multiplyScalar(Math.cbrt(rnd()) * 0.45);
          leaves.push([e[0] + u.x, e[1] + u.y, e[2] + u.z, R(0.6, 1.0), 1]);
        }
      }
    };
    const shrub = function (x, z, r) {
      for (let n = 0; n < 90 * r; n++) {
        const u = new THREE.Vector3(R(-1, 1), R(0, 1), R(-1, 1)).normalize().multiplyScalar(Math.cbrt(rnd()) * r);
        leaves.push([x + u.x, 0.62 + u.y * 0.9, z + u.z, R(0.8, 1.3), 2]);
      }
    };
    [[-24.5, 11.5], [-13.8, 11.5], [-0.5, 11.5], [-25.8, -2.5], [3.8, 4.5], [20.6, 3.5]].forEach(function (p) { olive(p[0], p[1]); });
    // Planters of shrubs and lavender along the end walls.
    [[-26.2, 2], [-26.2, 7], [21.2, -6], [21.2, 7.5]].forEach(function (p) {
      b.add("stucco", B.box(0.9, 0.6, 3), M([p[0] + (p[0] < 0 ? 0.3 : -0.3), 0.3, p[1]]), 0xf3ece0, { tile: 1 });
      shrub(p[0] + (p[0] < 0 ? 0.3 : -0.3), p[1], 0.75);
      Room.blockers.push({ x0: p[0] - 0.6, x1: p[0] + 0.6, z0: p[1] - 1.6, z1: p[1] + 1.6 });
    });
    // Bougainvillea up the villa piers: magenta flower clusters with leaves.
    const flowers = [];
    [-23, -10.7, 0, 15.5].forEach(function (fx) {
      for (let n = 0; n < 420; n++) {
        const h = R(0, 3.4), sp = 0.3 + h * 0.18;
        flowers.push([fx + R(-sp, sp), h + R(0, 0.3), 13.75 + R(-0.25, 0.05), R(0.5, 0.9)]);
      }
    });
    // Instanced leaves (three greens), flowers.
    const leafShape = new THREE.Shape();
    leafShape.moveTo(0, 0); leafShape.quadraticCurveTo(0.03, 0.045, 0, 0.12); leafShape.quadraticCurveTo(-0.03, 0.045, 0, 0);
    const leafGeo = new THREE.ShapeGeometry(leafShape, 2);
    const leafMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 });
    const greens = [[0x6a8452, 0x58704a, 0x7a9060], [0x6f8a58, 0x5a7a4a, 0x84a06a], [0x4f6a3e, 0x3e5a32, 0x6a8a52]];
    const all = leaves.concat(flowers.map(function (f) { return [f[0], f[1], f[2], f[3], 3]; }));
    const im = new THREE.InstancedMesh(leafGeo, leafMat, all.length);
    const d = new THREE.Object3D(), col = new THREE.Color();
    const fcols = [0xd0287a, 0xe0409a, 0xb81e68, 0xf05aa8, 0x5a7a3e];
    all.forEach(function (L, i) {
      d.position.set(L[0], L[1], L[2]);
      d.rotation.set(R(0, 6.28), R(0, 6.28), R(0, 6.28));
      d.scale.setScalar(L[3] * (L[4] === 3 ? 0.8 : 1));
      d.updateMatrix();
      im.setMatrixAt(i, d.matrix);
      col.setHex(L[4] === 3 ? fcols[(rnd() * fcols.length) | 0] : greens[L[4] || 0][(rnd() * 3) | 0]);
      im.setColorAt(i, col);
    });
    im.castShadow = true; im.receiveShadow = true;
    scene.add(im);
    Room.stats.leaves = all.length;
    // Palms: curved ringed trunks and drooping fronds.
    const fgeo = new THREE.PlaneGeometry(0.9, 3.2, 1, 8);
    fgeo.translate(0, 1.6, 0);
    const fp = fgeo.attributes.position;
    for (let i = 0; i < fp.count; i++) { const y = fp.getY(i) / 3.2; fp.setZ(i, -y * y * 1.4); }
    fgeo.computeVertexNormals();
    const fmat = new THREE.MeshStandardMaterial({ map: frondTex(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, color: 0xd8e8b8 });
    const palms = [[-26, -9.4, 7.5], [20.8, -9.6, 8.5], [-26.2, 12.4, 9.5], [21, 12.2, 8], [4.2, -10, 6.5]];
    const fronds = new THREE.InstancedMesh(fgeo, fmat, palms.length * 11);
    let fi = 0;
    palms.forEach(function (p) {
      const lean = R(-0.5, 0.5), H = p[2];
      const top = [p[0] + Math.sin(lean) * 1.3, H, p[1] + Math.cos(lean) * 0.6 - 0.6];
      const pts = [[p[0], 0, p[1]], [p[0] + (top[0] - p[0]) * 0.2, H * 0.35, p[1] + (top[2] - p[1]) * 0.1], [p[0] + (top[0] - p[0]) * 0.6, H * 0.7, p[1] + (top[2] - p[1]) * 0.5], top];
      b.add("wood", B.tube(pts, 0.17, 24, 9), null, 0x8a7258);
      for (let r = 0; r < 14; r++) {
        const t = r / 14, q = new THREE.CatmullRomCurve3(pts.map(function (v) { return new THREE.Vector3(v[0], v[1], v[2]); })).getPoint(t);
        b.add("wood", B.torus(0.18, 0.025, 4, 12), M([q.x, q.y, q.z], [Math.PI / 2, 0, 0]), 0x6a5440);
      }
      b.add("wood", B.sphere(0.3, 10, 8), M(top), 0x5a4a2a);
      for (let k = 0; k < 11; k++) {
        d.position.set(top[0], top[1], top[2]);
        d.rotation.set(0, k / 11 * Math.PI * 2 + R(-0.2, 0.2), 0);
        d.rotateX(R(-1.25, -0.75));
        d.scale.setScalar(R(0.85, 1.1));
        d.updateMatrix();
        fronds.setMatrixAt(fi++, d.matrix);
      }
      Room.blockers.push({ x: p[0], z: p[1], r: 0.45 });
    });
    fronds.castShadow = true;
    scene.add(fronds);
    Room.palmTops = palms;
  }
  // Below the edge: the cliff, the cove, two headlands, islands on the horizon.
  function coast(b, scene) {
    // The cliff: a rough rock face from the terrace down to the sand.
    const cliff = new THREE.PlaneGeometry(130, 9, 90, 10);
    const cp = cliff.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i), y = cp.getY(i);   // y -4.5..4.5 -> top..bottom
      const u = (4.5 - y) / 9;                 // 0 top, 1 bottom
      const nz = Math.sin(x * 0.7) * 0.4 + Math.sin(x * 1.9 + y) * 0.25 + Math.sin(x * 0.23 + 2) * 0.8 + (rnd() - 0.5) * 0.35;
      cp.setXYZ(i, x - 25, -0.8 + (BEACH_TOP_Y + 0.8) * u, EDGE_Z - 0.4 - u * 2.6 + nz * Math.sin(u * Math.PI) * 0.9);
    }
    cliff.computeVertexNormals();
    b.add("rock", cliff, null, 0xcdb49a, { tile: 3 });
    // Boulders at the foot.
    for (let i = 0; i < 40; i++) {
      const x = R(-80, 40), s = R(0.5, 2.2);
      const g = B.sphere(s, 7, 5);
      const gp = g.attributes.position;
      for (let k = 0; k < gp.count; k++) gp.setXYZ(k, gp.getX(k) * R(0.8, 1.3), gp.getY(k) * R(0.5, 0.9), gp.getZ(k) * R(0.8, 1.2));
      b.add("rock", g, M([x, BEACH_TOP_Y + s * 0.2, BEACH_TOP_Z + R(-0.5, 2)]), [0x9a8470, 0x84705e, 0xa89480][i % 3], { tile: 2 });
    }
    // The beach: sand from the cliff foot gently down under the sea.
    const sand = new THREE.PlaneGeometry(320, 60, 80, 30);
    sand.rotateX(-Math.PI / 2);
    const sp = sand.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const z = sp.getZ(i) + BEACH_TOP_Z - 30, x = sp.getX(i) - 20;
      const y = BEACH_TOP_Y - (BEACH_TOP_Z - z) * SLOPE + Math.sin(x * 0.11) * 0.06 + Math.sin(x * 0.03 + z * 0.2) * 0.05;
      sp.setXYZ(i, x, Math.min(BEACH_TOP_Y + 0.1, y), z);
    }
    sand.computeVertexNormals();
    b.add("sand", sand, null, 0xffffff, { tile: 4 });
    // Headlands: green-topped rock ridges reaching into the sea either side of the cove.
    const headland = function (cx, cz, sx, sz, h, rot) {
      const g = new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2);
      const p = g.attributes.position, col = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const n = 1 + Math.sin(x * 9 + z * 5) * 0.06 + Math.sin(x * 23 - z * 17) * 0.03;
        p.setXYZ(i, x * n, y * (0.8 + 0.25 * Math.sin(z * 4 + x * 3)), z * n);
        const green = y > 0.45 ? 1 : 0;
        const c = new THREE.Color(green ? (rnd() < 0.5 ? 0x5d7a3e : 0x6e8a48) : (rnd() < 0.5 ? 0x9a8068 : 0x8a7058));
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
      m.scale.set(sx, h, sz); m.position.set(cx, WATER_Y - 2, cz); m.rotation.y = rot;
      m.receiveShadow = true;
      scene.add(m);
    };
    headland(-140, -60, 70, 140, 34, 0.35);
    headland(150, -40, 90, 120, 26, -0.4);
    headland(-60, 112, 160, 60, 30, 0.1);   // the hills behind the villa
    headland(70, 125, 160, 70, 24, -0.1);
    // Islands on the horizon, hazy.
    [[-500, -1400, 260, 60], [380, -1700, 380, 80], [900, -1500, 200, 40]].forEach(function (I) {
      const g = new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x9a7a8a, fog: true }));
      m.scale.set(I[2], I[3], I[2] * 0.4); m.position.set(I[0], WATER_Y, I[1]);
      scene.add(m);
    });
    Room.SHORE_Z = SHORE_Z;
  }

  // ------------------------------------------------------------------ sky: a sunset
  function sky(scene) {
    const geo = new THREE.SphereGeometry(5000, 40, 24);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { sun: { value: Room.SUN }, top: { value: new THREE.Color(0x3c5a9a) }, mid: { value: new THREE.Color(0x9a8ac0) }, hor: { value: new THREE.Color(0xf6a070) }, glow: { value: new THREE.Color(0xffc070) } },
      vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w * 0.99999; }",
      fragmentShader: "uniform vec3 sun, top, mid, hor, glow; varying vec3 vP;" +
        "void main(){ float h = vP.y; float s = max(dot(vP, sun), 0.0);" +
        "vec3 c = mix(hor, mid, smoothstep(0.0, 0.22, h)); c = mix(c, top, smoothstep(0.2, 0.7, h));" +
        "c = mix(c, glow, pow(s, 6.0) * 0.75 * (1.0 - smoothstep(0.1, 0.5, h)));" +
        "c += vec3(1.0, 0.75, 0.4) * pow(s, 64.0) * 0.6;" +
        "c = mix(c, vec3(1.0, 0.95, 0.8) * 2.4, smoothstep(0.9985, 0.9993, s));" +
        "c = mix(c, hor * 0.85, smoothstep(0.0, -0.05, h));" +
        "gl_FragColor = vec4(c, 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}"
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false; m.renderOrder = -10;
    scene.add(m);
    Room.skyMesh = m;
    // Long bands of cloud lit from below.
    const cc = B.canvas(256, 64), cg = cc.getContext("2d");
    for (let i = 0; i < 30; i++) {
      const x = R(20, 236), y = R(24, 40), r = R(10, 28);
      const gr = cg.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "rgba(255,255,255,0.4)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      cg.fillStyle = gr; cg.fillRect(0, 0, 256, 64);
    }
    const ct = B.tex(cc);
    Room.clouds = [];
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ct, color: i % 3 ? 0xffb090 : 0xe890a0, transparent: true, opacity: R(0.35, 0.7), fog: false, depthWrite: false }));
      const a = R(-0.9, 0.9) + 0.3, d = R(1800, 3200);
      s.position.set(Math.sin(a) * d, R(90, 520), -Math.cos(a) * d);
      s.scale.set(R(700, 1500), R(80, 200), 1);
      s.userData.x0 = s.position.x;
      scene.add(s); Room.clouds.push(s);
    }
  }

  // ------------------------------------------------------------------ build it all
  Room.build = function (scene, renderer, quality) {
    rnd = U.rng(20261014);
    Room.stats = {};
    Room.blockers = [];
    const fogColor = new THREE.Color(0xe8a888);
    scene.background = new THREE.Color(0xf0a080);
    scene.fog = new THREE.FogExp2(fogColor, 0.0011);
    const world = new THREE.Group();
    scene.add(world);
    Room.world = world;
    const mats = materials();
    Room.mats = mats;
    const b = B.batch();
    // The user's logo, the CTSG seal (G:\ICM Workspace\business logo\final, the v4 Seal they
    // picked), inlaid in the middle of every table: a decal on the felt, its top away from you.
    const sealTex = new THREE.TextureLoader().load("assets/ctsg-seal.png");
    sealTex.colorSpace = THREE.SRGBColorSpace; sealTex.anisotropy = 8;
    const sealMat = new THREE.MeshStandardMaterial({ map: sealTex, transparent: true, roughness: 0.55, emissive: 0xffffff, emissiveMap: sealTex, emissiveIntensity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    Room.TABLES.forEach(function (T, i) {
      const top = table(b, T);
      top.material = new THREE.MeshStandardMaterial({ map: feltTex(T.felt, "♠ SPADES ♠ " + T.tier.toUpperCase() + " TABLE "), roughness: 0.98 });
      top.receiveShadow = true;
      world.add(top);
      T.feltMesh = top;
      const seal = new THREE.Mesh(new THREE.CircleGeometry(0.2, 64), sealMat);
      seal.position.z = 0.0006; seal.receiveShadow = true;
      top.add(seal);
      sign(world, b, T, i);
    });
    terrace(b);
    const vine = pergola(b, world);
    villa(b);
    lounge(b);
    poolside(b);
    greenery(b, world, vine);
    coast(b, world);
    const group = b.build(mats, { cast: ["wood", "metal", "paint", "fabric", "leather", "clay", "stucco", "stone"], receive: ["stone", "wood", "fabric", "leather", "paint", "metal", "clay", "stucco", "sand", "rock"] });
    world.add(group);
    Room.stats.tris = b.tris();
    // The pool water and its glow.
    const P = Room.pool;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(P.x1 - P.x0 - 0.2, P.z1 - P.z0 - 0.1, 1, 1), mats.pool);
    water.rotation.x = -Math.PI / 2; water.position.set((P.x0 + P.x1) / 2, -0.04, (P.z0 + P.z1) / 2);
    world.add(water);
    Room.poolWater = water;
    HS.Ocean.build({ parent: world, shoreZ: SHORE_Z, waterY: WATER_Y, beachSlope: SLOPE, fog: fogColor, sunDir: Room.SUN });
    sky(scene);
    // The fire's glow.
    const fire = new THREE.Sprite(new THREE.SpriteMaterial({ map: B.glowTex(0.2), color: 0xff8a3a, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    fire.position.copy(Room.fire); fire.scale.set(1.3, 1.3, 1);
    world.add(fire);
    Room.fireGlow = fire;

    // ---- light: the low sun (the one shadow), sky fill, warm string-light spill
    const hemi = new THREE.HemisphereLight(0xa8b8e8, 0x9a7458, 0.9);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffb27a, 2.6);
    sun.castShadow = quality !== "low";
    const ms = quality === "high" ? 2048 : 1024;
    sun.shadow.mapSize.set(ms, ms);
    sun.shadow.camera.left = -7; sun.shadow.camera.right = 7; sun.shadow.camera.top = 7; sun.shadow.camera.bottom = -7;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 80;
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
    world.add(sun); world.add(sun.target);
    Room.sun = sun;
    Room.spot = sun;   // (what View.setQuality turns shadows on and off on)
    const warm = new THREE.PointLight(0xffb468, 3.5, 9, 1.6);
    warm.position.set(0, 2.5, -7);
    world.add(warm);
    Room.warm = warm;
    const fireL = new THREE.PointLight(0xff8a3a, 2.5, 6, 1.8);
    fireL.position.copy(Room.fire).add(new THREE.Vector3(0, 0.3, 0));
    world.add(fireL);
    Room.fireLight = fireL;
    Room.setActive(-1);
    return Room;
  };

  // ------------------------------------------------------------------ the table you're at
  // k >= 0: move the villa so table k is at the origin. -1: the villa where it is.
  Room.setActive = function (k) {
    Room.active = k;
    const T = Room.TABLES[k];
    Room.world.position.set(T ? -T.x : 0, 0, T ? -T.z : 0);
    Room.world.updateMatrixWorld(true);
  };
  Room.offset = function () { return Room.world.position; };
  // A point in villa coordinates -> where it is in the scene now (and back).
  Room.toScene = function (x, y, z) { return new THREE.Vector3(x, y, z).add(Room.world.position); };
  Room.toVilla = function (v) { return v.clone().sub(Room.world.position); };

  // Walking: keep a point (villa coordinates) out of the furniture, the pool and the walls.
  Room.collide = function (p, r) {
    const Bd = Room.BOUNDS;
    p.x = U.clamp(p.x, Bd.x0 + r, Bd.x1 - r); p.z = U.clamp(p.z, Bd.z0 + r, Bd.z1 - r);
    Room.blockers.forEach(function (o) {
      if (o.r !== undefined) {
        const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), m = o.r + r;
        if (d < m && d > 1e-5) { p.x = o.x + dx / d * m; p.z = o.z + dz / d * m; }
      } else if (p.x > o.x0 - r && p.x < o.x1 + r && p.z > o.z0 - r && p.z < o.z1 + r) {
        const L = p.x - (o.x0 - r), Rr = (o.x1 + r) - p.x, F = p.z - (o.z0 - r), K = (o.z1 + r) - p.z;
        const m = Math.min(L, Rr, F, K);
        if (m === L) p.x = o.x0 - r; else if (m === Rr) p.x = o.x1 + r; else if (m === F) p.z = o.z0 - r; else p.z = o.z1 + r;
      }
    });
    return p;
  };

  // ------------------------------------------------------------------ alive
  // focus: where the shadows and the warm light should be (villa coordinates).
  Room.update = function (dt, t, focus) {
    HS.Ocean.update(t);
    if (focus && Room.sun) {
      Room.sun.target.position.set(focus.x, 0, focus.z);
      Room.sun.position.set(focus.x + Room.SUN.x * 40, Room.SUN.y * 40 + 6, focus.z + Room.SUN.z * 40);
      // The warm light: over the nearest table.
      let best = null, bd = 1e9;
      Room.TABLES.forEach(function (T) { const d = Math.hypot(T.x - focus.x, T.z - focus.z); if (d < bd) { bd = d; best = T; } });
      if (best) Room.warm.position.set(best.x, 2.5, best.z);
    }
    if (Room.clouds) Room.clouds.forEach(function (c, i) { c.position.x = c.userData.x0 + Math.sin(t * 0.004 + i) * 60; });
    if (Room.halos) Room.halos.material.opacity = 0.7 + Math.sin(t * 2.3) * 0.03;
    if (Room.fireGlow) {
      const f = 0.85 + Math.sin(t * 11) * 0.06 + Math.sin(t * 17.3) * 0.05 + Math.sin(t * 5.1) * 0.04;
      Room.fireGlow.material.opacity = f; Room.fireGlow.scale.setScalar(1.2 + f * 0.25);
      Room.fireLight.intensity = 2.5 * f;
    }
    if (Room.poolWater) Room.poolWater.material.emissiveIntensity = 0.55 + Math.sin(t * 0.8) * 0.05;
  };
  HS.Room = Room;
})(globalThis.HS);
