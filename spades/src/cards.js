// The cards: 52 faces and a back drawn in code into one atlas (pips laid out
// like a real deck, illustrated jacks, queens and kings, a fancy ace of
// spades), and everything they do on the table: the deal, everyone's hand
// standing in the tray in front of them (yours facing you, the others' backs
// to you; hover lifts one of yours out), cards flying to the middle,
// the trick swept to its winner's pile. Positions come from the game state
// each frame (net.js), so a missed message never leaves a card stranded.
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const THREE = globalThis.THREE;
  const R = HS.Rules, U = HS.U, Room = HS.Room;
  const C = { cards: [], hover: -1, picked: -1, dealT: 99, hn: -1, lastTrick: null };
  const CW = 0.08, CH = 0.112, RAD = 0.007;           // a little bigger than a poker card: easier to read
  const CELL_W = 200, CELL_H = 280, COLS = 14, ROWS = 4;
  const RED = "#c8202a", BLACK = "#16161c";

  // ------------------------------------------------------------------ drawing the deck
  function suitPath(g, suit, x, y, s) {
    g.beginPath();
    if (suit === 3) { HS.Build.spadePath(g, x, y, s); return; }
    if (suit === 2) {   // heart
      g.moveTo(x, y + s * 0.5);
      g.bezierCurveTo(x - s * 0.62, y + s * 0.02, x - s * 0.5, y - s * 0.5, x, y - s * 0.22);
      g.bezierCurveTo(x + s * 0.5, y - s * 0.5, x + s * 0.62, y + s * 0.02, x, y + s * 0.5);
      g.closePath(); return;
    }
    if (suit === 1) { g.moveTo(x, y - s * 0.55); g.quadraticCurveTo(x + s * 0.18, y - s * 0.18, x + s * 0.42, y); g.quadraticCurveTo(x + s * 0.18, y + s * 0.18, x, y + s * 0.55); g.quadraticCurveTo(x - s * 0.18, y + s * 0.18, x - s * 0.42, y); g.quadraticCurveTo(x - s * 0.18, y - s * 0.18, x, y - s * 0.55); g.closePath(); return; }
    // club: three leaves and a stem
    const r = s * 0.22;
    g.arc(x, y - s * 0.24, r, 0, Math.PI * 2); g.moveTo(x - s * 0.2 + r, y + s * 0.06); g.arc(x - s * 0.24, y + s * 0.06, r, 0, Math.PI * 2);
    g.moveTo(x + s * 0.24 + r, y + s * 0.06); g.arc(x + s * 0.24, y + s * 0.06, r, 0, Math.PI * 2);
    g.moveTo(x - s * 0.06, y); g.lineTo(x + s * 0.06, y); g.lineTo(x + s * 0.16, y + s * 0.55); g.lineTo(x - s * 0.16, y + s * 0.55); g.closePath();
  }
  function pip(g, suit, x, y, s, flip) {
    g.save(); g.translate(x, y); if (flip) g.rotate(Math.PI);
    g.fillStyle = suit === 1 || suit === 2 ? RED : BLACK;
    suitPath(g, suit, 0, 0, s); g.fill();
    g.restore();
  }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  const PIPS = {
    2: [[1, 0], [1, 1]], 3: [[1, 0], [1, 0.5], [1, 1]], 4: [[0, 0], [2, 0], [0, 1], [2, 1]], 5: [[0, 0], [2, 0], [1, 0.5], [0, 1], [2, 1]],
    6: [[0, 0], [2, 0], [0, 0.5], [2, 0.5], [0, 1], [2, 1]], 7: [[0, 0], [2, 0], [1, 0.25], [0, 0.5], [2, 0.5], [0, 1], [2, 1]],
    8: [[0, 0], [2, 0], [1, 0.25], [0, 0.5], [2, 0.5], [1, 0.75], [0, 1], [2, 1]],
    9: [[0, 0], [2, 0], [0, 1 / 3], [2, 1 / 3], [1, 0.5], [0, 2 / 3], [2, 2 / 3], [0, 1], [2, 1]],
    10: [[0, 0], [2, 0], [1, 1 / 6], [0, 1 / 3], [2, 1 / 3], [0, 2 / 3], [2, 2 / 3], [1, 5 / 6], [0, 1], [2, 1]]
  };
  // A face card's portrait: a crowned figure in robes, mirrored top and bottom like a real court card.
  function court(g, suit, rank, x0, y0, w, h) {
    const red = suit === 1 || suit === 2;
    const robe = red ? ["#c8202a", "#1f4fa0", "#e6b437"] : ["#1f4fa0", "#c8202a", "#e6b437"];
    g.save();
    g.beginPath(); g.rect(x0, y0, w, h); g.clip();
    g.fillStyle = "#f7efd8"; g.fillRect(x0, y0, w, h);
    const half = function () {
      const cx = x0 + w / 2, top = y0 + 6;
      // Robe with bands.
      g.fillStyle = robe[0];
      g.beginPath(); g.moveTo(x0 + 8, y0 + h / 2); g.quadraticCurveTo(cx - w * 0.36, top + h * 0.2, cx - w * 0.18, top + h * 0.17); g.lineTo(cx + w * 0.18, top + h * 0.17); g.quadraticCurveTo(cx + w * 0.36, top + h * 0.2, x0 + w - 8, y0 + h / 2); g.closePath(); g.fill();
      g.fillStyle = robe[1]; g.fillRect(cx - w * 0.07, top + h * 0.17, w * 0.14, h / 2 - h * 0.17 - 6);
      g.fillStyle = robe[2];
      for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(cx, top + h * 0.22 + k * 14, 3.5, 0, Math.PI * 2); g.fill(); }
      g.strokeStyle = robe[2]; g.lineWidth = 3;
      g.beginPath(); g.moveTo(cx - w * 0.3, top + h * 0.33); g.quadraticCurveTo(cx, top + h * 0.27, cx + w * 0.3, top + h * 0.33); g.stroke();
      // Face, hair or beard.
      g.fillStyle = "#f2c9a0"; g.beginPath(); g.ellipse(cx, top + h * 0.115, w * 0.11, h * 0.065, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#2a1c14";
      g.beginPath(); g.arc(cx - 6, top + h * 0.11, 2, 0, Math.PI * 2); g.arc(cx + 6, top + h * 0.11, 2, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "#8a3a2a"; g.lineWidth = 2; g.beginPath(); g.arc(cx, top + h * 0.13, 5, 0.2, Math.PI - 0.2); g.stroke();
      if (rank === 11) { g.fillStyle = "#e8e2d4"; g.beginPath(); g.ellipse(cx, top + h * 0.17, w * 0.1, h * 0.04, 0, 0, Math.PI); g.fill(); }
      if (rank === 10) { g.fillStyle = "#3a2618"; g.beginPath(); g.ellipse(cx - w * 0.12, top + h * 0.13, 7, 16, 0.2, 0, Math.PI * 2); g.ellipse(cx + w * 0.12, top + h * 0.13, 7, 16, -0.2, 0, Math.PI * 2); g.fill(); }
      // Crown (king, queen) or cap with a feather (jack).
      g.fillStyle = "#e6b437";
      if (rank >= 10) {
        g.beginPath(); g.moveTo(cx - w * 0.13, top + h * 0.06); g.lineTo(cx - w * 0.15, top + h * 0.0); g.lineTo(cx - w * 0.07, top + h * 0.035);
        g.lineTo(cx, top - 4); g.lineTo(cx + w * 0.07, top + h * 0.035); g.lineTo(cx + w * 0.15, top + h * 0.0); g.lineTo(cx + w * 0.13, top + h * 0.06); g.closePath(); g.fill();
        g.fillStyle = robe[0]; g.beginPath(); g.arc(cx, top + h * 0.035, 3, 0, Math.PI * 2); g.fill();
      } else {
        g.beginPath(); g.ellipse(cx, top + h * 0.05, w * 0.14, h * 0.03, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = robe[1]; g.lineWidth = 3; g.beginPath(); g.moveTo(cx + w * 0.08, top + h * 0.04); g.quadraticCurveTo(cx + w * 0.3, top - 6, cx + w * 0.2, top + h * 0.1); g.stroke();
      }
      // A sceptre (king), flower (queen), or axe (jack) in hand.
      g.strokeStyle = "#7a5a2a"; g.lineWidth = 3;
      g.beginPath(); g.moveTo(cx + w * 0.22, top + h * 0.2); g.lineTo(cx + w * 0.3, top + h * 0.43); g.stroke();
      g.fillStyle = rank === 11 ? "#e6b437" : rank === 10 ? RED : "#c0c0c8";
      g.beginPath(); g.arc(cx + w * 0.22, top + h * 0.2, 6, 0, Math.PI * 2); g.fill();
    };
    half();
    g.translate(x0 + w / 2, y0 + h / 2); g.rotate(Math.PI); g.translate(-(x0 + w / 2), -(y0 + h / 2));
    half();
    g.restore();
    g.strokeStyle = suit === 1 || suit === 2 ? RED : BLACK; g.lineWidth = 2; g.strokeRect(x0, y0, w, h);
    g.beginPath(); g.moveTo(x0, y0 + h / 2); g.lineTo(x0 + w, y0 + h / 2); g.stroke();
    pip(g, suit, x0 + 16, y0 + 18, 20); pip(g, suit, x0 + w - 16, y0 + h - 18, 20, true);
  }
  function drawCard(g, c, x, y) {
    const s = R.suit(c), r = R.rank(c), red = s === 1 || s === 2;
    g.save(); g.translate(x, y);
    rr(g, 2, 2, CELL_W - 4, CELL_H - 4, 16);
    g.fillStyle = "#fdfbf5"; g.fill();
    g.strokeStyle = "#cfc8b8"; g.lineWidth = 2; g.stroke();
    // Corner indices.
    const lab = R.RANKS[r];
    g.fillStyle = red ? RED : BLACK;
    g.font = "700 " + (lab === "10" ? 40 : 46) + "px Georgia, 'Times New Roman', serif"; g.textAlign = "center"; g.textBaseline = "alphabetic";
    g.fillText(lab, 27, 50);
    pip(g, s, 27, 72, 26);
    g.save(); g.translate(CELL_W, CELL_H); g.rotate(Math.PI);
    g.fillText(lab, 27, 50); pip(g, s, 27, 72, 26);
    g.restore();
    // Middle.
    const x0 = 52, y0 = 30, w = CELL_W - 104, h = CELL_H - 60;
    if (r === 12) {
      if (s === 3) {
        // The ace of spades: a big ornate spade with the game's name.
        g.save(); g.translate(CELL_W / 2, CELL_H / 2 - 4);
        g.fillStyle = BLACK; HS.Build.spadePath(g, 0, 0, 92); g.fill();
        g.strokeStyle = "#e6b437"; g.lineWidth = 2.5; HS.Build.spadePath(g, 0, 0, 78); g.stroke();
        g.fillStyle = "#e6b437"; g.font = "700 14px Georgia, serif"; g.fillText("CTSG", 0, 6);
        g.font = "700 12px Georgia, serif"; g.fillStyle = BLACK; g.fillText("SPADES", 0, 76);
        g.restore();
      } else pip(g, s, CELL_W / 2, CELL_H / 2, 70);
    } else if (r >= 9) court(g, s, r, x0 - 6, y0, w + 12, h);
    else {
      const layout = PIPS[r + 2];
      layout.forEach(function (p) {
        const px = x0 + 8 + p[0] * (w - 16) / 2, py = y0 + 16 + p[1] * (h - 32);
        pip(g, s, px, py, 30, p[1] > 0.5);
      });
    }
    g.restore();
  }
  function drawBack(g, x, y) {
    g.save(); g.translate(x, y);
    rr(g, 2, 2, CELL_W - 4, CELL_H - 4, 16); g.fillStyle = "#fdfbf5"; g.fill();
    rr(g, 12, 12, CELL_W - 24, CELL_H - 24, 10); g.fillStyle = "#1d2a52"; g.fill();
    g.save(); rr(g, 12, 12, CELL_W - 24, CELL_H - 24, 10); g.clip();
    g.strokeStyle = "rgba(230,180,55,0.45)"; g.lineWidth = 1.5;
    for (let k = -CELL_H; k < CELL_W + CELL_H; k += 12) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k - CELL_H, CELL_H); g.stroke(); g.beginPath(); g.moveTo(k - CELL_H, 0); g.lineTo(k, CELL_H); g.stroke(); }
    g.restore();
    g.strokeStyle = "#e6b437"; g.lineWidth = 3; rr(g, 20, 20, CELL_W - 40, CELL_H - 40, 8); g.stroke();
    g.fillStyle = "#1d2a52"; g.beginPath(); g.ellipse(CELL_W / 2, CELL_H / 2, 46, 58, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#e6b437"; g.lineWidth = 2; g.stroke();
    g.fillStyle = "#e6b437"; HS.Build.spadePath(g, CELL_W / 2, CELL_H / 2 - 4, 58); g.fill();
    g.fillStyle = "#1d2a52"; g.font = "700 11px Georgia, serif"; g.textAlign = "center"; g.fillText("CTSG", CELL_W / 2, CELL_H / 2 + 2);
    g.restore();
  }
  function atlas() {
    const c = HS.Build.canvas(CELL_W * COLS, CELL_H * ROWS), g = c.getContext("2d");
    for (let card = 0; card < 52; card++) drawCard(g, card, R.rank(card) * CELL_W, R.suit(card) * CELL_H);
    drawBack(g, 13 * CELL_W, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  }
  C.drawCardTo = function (g, c, x, y) { drawCard(g, c, x, y); };   // the HUD's little cards
  C.drawBackTo = function (g, x, y) { drawBack(g, x, y); };

  // ------------------------------------------------------------------ geometry
  // One mesh per card: the face (+Z) and the back (-Z) in one geometry, UVs into the atlas.
  function cardShape() {
    const s = new THREE.Shape(), w = CW / 2, h = CH / 2, r = RAD;
    s.moveTo(-w + r, -h); s.lineTo(w - r, -h); s.quadraticCurveTo(w, -h, w, -h + r); s.lineTo(w, h - r); s.quadraticCurveTo(w, h, w - r, h);
    s.lineTo(-w + r, h); s.quadraticCurveTo(-w, h, -w, h - r); s.lineTo(-w, -h + r); s.quadraticCurveTo(-w, -h, -w + r, -h);
    return s;
  }
  function cardGeo(faceCol, faceRow, backCol, backRow) {
    const sg = new THREE.ShapeGeometry(cardShape(), 4);
    const p = sg.attributes.position, n = p.count, idx = sg.index.array;
    const pos = [], uv = [], nor = [];
    const U0 = function (col, x) { return (col * CELL_W + (x / CW + 0.5) * CELL_W) / (CELL_W * COLS); };
    const V0 = function (row, y) { return 1 - (row * CELL_H + (0.5 - y / CH) * CELL_H) / (CELL_H * ROWS); };
    for (let i = 0; i < idx.length; i++) {
      const k = idx[i], x = p.getX(k), y = p.getY(k);
      pos.push(x, y, 0.0004); nor.push(0, 0, 1); uv.push(U0(faceCol, x), V0(faceRow, y));
    }
    for (let i = idx.length - 1; i >= 0; i--) {
      const k = idx[i], x = p.getX(k), y = p.getY(k);
      pos.push(x, y, -0.0004); nor.push(0, 0, -1); uv.push(U0(backCol, -x), V0(backRow, y));
    }
    void n;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    return g;
  }

  // ------------------------------------------------------------------ setup
  C.init = function (scene) {
    C.tex = atlas();
    C.group = new THREE.Group();
    scene.add(C.group);
    for (let c = 0; c < 52; c++) {
      const mat = new THREE.MeshStandardMaterial({ map: C.tex, roughness: 0.55, emissive: 0xffffff, emissiveMap: C.tex, emissiveIntensity: 0.16 });
      const m = new THREE.Mesh(cardGeo(R.rank(c), R.suit(c), 13, 0), mat);
      m.castShadow = true; m.receiveShadow = false;
      m.visible = false;
      m.userData.card = c;
      C.group.add(m);
      C.cards.push({ c: c, mesh: m, loc: "hidden", pos: new THREE.Vector3(), q: new THREE.Quaternion(), tp: new THREE.Vector3(), tq: new THREE.Quaternion(), delay: 0, speed: 9, lift: 0 });
    }
    // The others' hands (backs both sides) and won tricks (little stacks): instanced.
    const backGeo = cardGeo(13, 0, 13, 0);
    const backMat = new THREE.MeshStandardMaterial({ map: C.tex, roughness: 0.55, emissive: 0xffffff, emissiveMap: C.tex, emissiveIntensity: 0.1 });
    C.fans = new THREE.InstancedMesh(backGeo, backMat, 52);
    C.fans.castShadow = true;
    C.fans.frustumCulled = false;
    C.group.add(C.fans);
    C.fanState = [];
    for (let i = 0; i < 52; i++) C.fanState.push({ on: false, pos: new THREE.Vector3(), q: new THREE.Quaternion() });
    const pileGeo = new THREE.BoxGeometry(CW, 0.0035, CH);
    // Top face shows the back; sides are card-edge white.
    const pm = [new THREE.MeshStandardMaterial({ color: 0xf2eee4, roughness: 0.7 })];
    const topMat = new THREE.MeshStandardMaterial({ map: C.tex, roughness: 0.55 });
    const uv = pileGeo.attributes.uv;
    // Box face 2 (+Y) gets the back cell.
    for (let i = 8; i < 12; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, (13 * CELL_W + u * CELL_W) / (CELL_W * COLS), 1 - (1 - v) * CELL_H / (CELL_H * ROWS)); }
    // (Index order px nx py ny pz nz, 6 indices each: the top, +Y, gets the back.)
    pileGeo.clearGroups(); pileGeo.addGroup(0, 12, 0); pileGeo.addGroup(12, 6, 1); pileGeo.addGroup(18, 18, 0);
    pm.push(topMat);
    C.piles = new THREE.InstancedMesh(pileGeo, pm, 52);
    C.piles.castShadow = true; C.piles.receiveShadow = true;
    C.piles.frustumCulled = false;
    C.group.add(C.piles);
    C.pileCount = 0;
  };

  // ------------------------------------------------------------------ where things go
  const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(1, 1, 1);
  const UP = new THREE.Vector3(0, 1, 0);
  // Seat s's frame: origin at the seat, forward toward the table.
  function seatFrame(s) {
    const yaw = Room.seatYaw(s);
    return { yaw: yaw, fwd: new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), right: new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), pos: Room.seatPos(s) };
  }
  C.seatFrame = seatFrame;
  // Flat on the felt in front of seat s (the trick).
  function trickSpot(s, k, out, q) {
    const f = seatFrame(s);
    out.set(0, Room.TABLE_Y + 0.0045 + k * 0.0009, 0)   // above the felt (Y + 0.002) and the badge decal on it.addScaledVector(f.fwd, -0.17).addScaledVector(f.right, (k % 2 ? 1 : -1) * 0.012);
    // Face up, the card's top pointing away from whoever played it, a little askew.
    q.setFromEuler(_e.set(0, f.yaw, 0)).multiply(_q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, ((s * 37 + k * 11) % 10 - 5) * 0.025)));
  }
  // The won-tricks pile for seat s (in front of its tray, to the right).
  function pileSpot(s, k, out, q) {
    const f = seatFrame(s);
    out.copy(f.pos).multiplyScalar(0.38 / Room.SEAT_R).addScaledVector(f.right, 0.2);
    out.y = Room.TABLE_Y + 0.0018 + k * 0.0036;
    out.x += Math.sin(k * 2.1) * 0.004; out.z += Math.cos(k * 1.7) * 0.004;
    q.setFromEuler(_e.set(0, f.yaw + 0.35 + (k % 2 ? 0.06 : -0.04), 0));
  }
  // The dealer's deck (in front of their tray, the middle).
  function deckSpot(s, out, q) {
    const f = seatFrame(s);
    out.copy(f.pos).multiplyScalar(0.34 / Room.SEAT_R);
    out.y = Room.TABLE_Y + 0.02;
    q.setFromEuler(_e.set(-Math.PI / 2, f.yaw, 0, "YXZ"));
  }
  // Card i of n standing in seat s's tray (room.js builds the trays): a row, left
  // to right as the owner sees it, each card a hair nearer the owner than the one
  // to its left so the left strip (with the corner index) of every card shows.
  // Faces the owner (+Z face toward the seat), leaning back toward the middle.
  // `lift` raises it out of the tray toward the owner (hover / picked).
  const _tq = new THREE.Quaternion(), _up = new THREE.Vector3();
  function traySpot(s, i, n, lift, out, q, faceDown) {
    const f = seatFrame(s), L = Room.TRAY_LEAN;
    const span = Room.TRAY_W - 0.04 - CW, step = n > 1 ? Math.min(0.07, span / (n - 1)) : 0;
    const x = (i - (n - 1) / 2) * step;
    _up.copy(UP).multiplyScalar(Math.cos(L)).addScaledVector(f.fwd, Math.sin(L));   // the card's "up" in the world
    out.copy(f.pos).multiplyScalar(Room.TRAY_R / Room.SEAT_R).setY(Room.TABLE_Y + 0.002 + Room.TRAY_FLOOR)
      .addScaledVector(f.right, x).addScaledVector(f.fwd, -(Room.TRAY_GROOVE + i * 0.0014))
      .addScaledVector(_up, CH / 2 + 0.002 + (lift || 0)).addScaledVector(f.fwd, -(lift || 0) * 0.45);
    q.setFromEuler(_e.set(0, f.yaw, 0)).multiply(_tq.setFromAxisAngle(_up.set(1, 0, 0), -L));
    // Not looked at yet (deciding on blind nil): the backs face us.
    if (faceDown) q.multiply(_tq.setFromAxisAngle(UP, Math.PI));
  }
  C.traySpot = traySpot;

  // ------------------------------------------------------------------ per frame
  // V: { st, hand, seat (ours, or -1 watching), eye (Vector3), legal: [cards], assist, faceDown, dt, now }
  // Our hand also shows as the strip along the bottom of the screen (hud.js), so it's in
  // view wherever you look (Spades feedback 2026-10-16). C.mineDealt says how many of our
  // cards the deal has reached, for that strip.
  C.mineDealt = 0;
  C.update = function (V) {
    const st = V.st, dt = V.dt;
    if (!st) { C.cards.forEach(function (k) { k.mesh.visible = false; k.loc = "hidden"; }); C.fans.count = 0; C.piles.count = 0; return; }
    const me = V.seat >= 0 ? V.seat : 0;
    // A new hand: the deal.
    if (st.hn !== C.hn) { C.hn = st.hn; C.dealT = 0; C.cards.forEach(function (k) { k.loc = "hidden"; k.mesh.visible = false; }); C.fanState.forEach(function (f) { f.on = false; }); }
    C.dealT += dt;
    const dealing = C.dealT < 2.6;
    // How many each seat has been dealt so far (one card per seat every 0.05 s).
    const dealtTo = function (s) { if (!dealing) return 13; const order = (s - st.d + 3) % 4; return U.clamp(Math.floor((C.dealT / 0.05 - order) / 4) + 1, 0, 13); };
    C.mineDealt = V.seat >= 0 ? dealtTo(me) : 0;
    const inTrick = {};
    st.tr.forEach(function (x, k) { inTrick[x[1]] = { seat: x[0], k: k }; });
    const handIdx = {};
    V.hand.forEach(function (c, i) { handIdx[c] = i; });
    const nMine = V.hand.length;
    const deckP = new THREE.Vector3(), deckQ = new THREE.Quaternion();
    deckSpot(st.d, deckP, deckQ);
    let pileK = 0;
    C.cards.forEach(function (k) {
      const c = k.c, was = k.loc;
      if (handIdx[c] !== undefined) {
        const i = handIdx[c];
        if (was === "hidden") {
          // Dealt to us: from the deck, in dealing order.
          const order = i;
          k.pos.copy(deckP); k.q.copy(deckQ);
          k.delay = dealing ? ((order * 4 + (me - st.d + 3) % 4) * 0.05 - C.dealT) : 0;
          k.mesh.visible = false;
        }
        k.loc = "mine";
        // The card lifted in the strip (hud.js) lifts here too.
        const lift = c === C.picked ? 0.05 : c === C.hover ? 0.032 : 0;
        k.lift += (lift - k.lift) * Math.min(1, dt * 14);
        traySpot(me, i, nMine, k.lift, k.tp, k.tq, V.faceDown);
        k.speed = 10;
        // Legal cards bright, the rest dimmed (a setting can turn this off).
        const dim = V.legal && V.legal.length && V.legal.indexOf(c) < 0 && V.assist;
        k.mesh.material.color.setScalar(dim ? 0.5 : 1);
        k.mesh.material.emissiveIntensity = c === C.hover && !dim ? 0.32 : dim ? 0.05 : 0.16;
      } else if (inTrick[c]) {
        const t = inTrick[c];
        if (was === "hidden") {
          // Someone else's card: it comes from their tray.
          traySpot(t.seat, 6, 13, 0.04, k.pos, k.q);
          k.delay = 0;
        }
        k.loc = "trick";
        trickSpot(t.seat, t.k, k.tp, k.tq);
        k.speed = 7;
        k.mesh.material.color.setScalar(1); k.mesh.material.emissiveIntensity = 0.16;
      } else if (was === "trick" || was === "pile") {
        // The trick's over: swept to the winner, then it becomes part of their pile.
        const w = st.lt && st.lt.c.some(function (x) { return x[1] === c; }) ? st.lt.w : -1;
        if (w < 0) { k.loc = "hidden"; k.mesh.visible = false; return; }
        k.loc = "pile";
        pileSpot(w, Math.max(0, st.tk[w] - 1), k.tp, k.tq);
        k.speed = 5;
        if (k.pos.distanceTo(k.tp) < 0.01) { k.loc = "hidden"; k.mesh.visible = false; return; }
      } else { k.loc = "hidden"; k.mesh.visible = false; return; }
      // Move toward the target (after any deal delay).
      if (k.delay > 0) { k.delay -= dt; k.mesh.visible = false; return; }
      k.mesh.visible = true;
      const a = 1 - Math.exp(-k.speed * dt);
      // An arc: rise a little mid-flight.
      const far = k.pos.distanceTo(k.tp);
      k.pos.lerp(k.tp, a);
      if (far > 0.08 && k.loc !== "mine") k.pos.y += far * 0.06;
      k.q.slerp(k.tq, a);
      k.mesh.position.copy(k.pos); k.mesh.quaternion.copy(k.q);
    });
    void pileK;
    // Others' hands: standing in their trays, backs to us.
    let fi = 0;
    for (let s = 0; s < 4; s++) {
      if (s === V.seat) continue;
      const n = Math.min(st.hc[s], dealtTo(s));
      for (let i = 0; i < 13; i++) {
        const f = C.fanState[fi + i];
        if (i < n) {
          traySpot(s, i, n, 0, _v, _q);
          const tp = _v.clone(), tq = _q.clone();
          if (!f.on) { f.on = true; f.pos.copy(deckP); f.q.copy(deckQ); }
          const a = 1 - Math.exp(-9 * dt);
          f.pos.lerp(tp, a); f.q.slerp(tq, a);
          _m.compose(f.pos, f.q, _s);
        } else { f.on = false; _m.makeScale(0, 0, 0); }
        C.fans.setMatrixAt(fi + i, _m);
      }
      fi += 13;
    }
    for (; fi < 52; fi++) C.fans.setMatrixAt(fi, _m.makeScale(0, 0, 0));
    C.fans.instanceMatrix.needsUpdate = true;
    // Piles: one little stack per trick won, by each seat.
    let pi = 0;
    for (let s = 0; s < 4; s++) {
      // A trick still flying to its pile isn't stacked yet.
      const flying = C.cards.some(function (k) { return k.loc === "pile" && st.lt && st.lt.w === s; });
      const n = Math.max(0, st.tk[s] - (flying ? 1 : 0));
      for (let k = 0; k < n && pi < 52; k++) {
        pileSpot(s, k, _v, _q);
        _m.compose(_v, _q, _s);
        C.piles.setMatrixAt(pi++, _m);
      }
    }
    // The deck during the deal.
    if (dealing) {
      const left = Math.max(0, Math.round((2.6 - C.dealT) / 2.6 * 13));
      for (let k = 0; k < left && pi < 52; k++) {
        _m.compose(new THREE.Vector3(deckP.x, Room.TABLE_Y + 0.002 + k * 0.004, deckP.z), _q.setFromEuler(_e.set(0, Room.seatYaw(st.d), 0)), _s);
        C.piles.setMatrixAt(pi++, _m);
      }
    }
    C.piles.count = pi;
    C.piles.instanceMatrix.needsUpdate = true;
    C.fans.count = 52;
  };

  C.meshOf = function (c) { return C.cards[c] ? C.cards[c].mesh : null; };
  C.SIZE = { w: CW, h: CH };
  HS.Cards = C;
})(globalThis.HS);
