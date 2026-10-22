// The food-cart prologue, in 3D: a hot dog cart on a city sidewalk, you behind it, the line in
// front. The game's Cart logic (queue, patience, taps, tips, the dice) is unchanged; this only
// draws it and gives it hands:
//  - every customer in Cart.queue is a body that walks up the sidewalk and joins the line, with a
//    face bubble that sours as their patience runs out;
//  - each tap dips your hand into the steamer / pretzel case / cooler; a finished item comes up in
//    your hand; a finished order goes into the customer's hand and they walk off with it; a
//    walk-out shakes their head and leaves;
//  - the three item buttons (#carthotspots, keys 1-2-3 as before) float over the real compartments.
// It is also the backdrop of the start screen (Cart3D.showcase), so it's built at boot.
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const THREE = globalThis.THREE;
  const U = HS.U;
  const C3 = { scene: null, cam: null, built: false, actors: {}, me: null, t: 0, yaw: 0, look: 0, sun: null, hemi: null };
  const _v = new THREE.Vector3(), _p = new THREE.Vector3();
  // compartment anchors (metres, cart space); the hand reaches here
  const SLOT = { dog: new THREE.Vector3(-0.58, 1.02, 0.05), pretz: new THREE.Vector3(0.02, 1.18, 0.08), soda: new THREE.Vector3(0.62, 1.0, 0.05) };
  const PROP = { dog: "hotdog", pretz: "pretz", soda: "soda" };   // cart item id -> prop maker
  const LINE_START = new THREE.Vector3(0.1, 0, 1.25);     // where the customer being served stands
  const ENTER_X = 9, EXIT_X = -12;                         // metres along the sidewalk
  const WALK = 2.0;                                        // m/s: brisk city walking

  function M(c, r, m, e) { return new THREE.MeshStandardMaterial({ color: c, roughness: r === undefined ? 0.7 : r, metalness: m || 0, emissive: e ? c : 0, emissiveIntensity: e || 0 }); }
  function box(w, h, d, mat, x, y, z, g) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; }
  function cyl(rt, rb, h, s, mat, x, y, z, g) { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, s), mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; }
  function tex(w, h, draw, rep) {
    const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); }
    return t;
  }

  /* ------------------------------------------------------------------ the street (metres; the root scales by U) */
  function facade(seed, w, h, base, lit) {
    return tex(256, 512, function (x, W, H) {
      x.fillStyle = base; x.fillRect(0, 0, W, H);
      // brick / panel noise
      for (let i = 0; i < 900; i++) { x.fillStyle = "rgba(0,0,0," + (Math.random() * 0.08) + ")"; x.fillRect(Math.random() * W, Math.random() * H, 10, 4); }
      const cols = 4, rows = 8;
      for (let r = 1; r < rows; r++) for (let cI = 0; cI < cols; cI++) {
        const wx = 18 + cI * (W - 36) / cols, wy = H - (r + 1) * H / (rows + 0.6);
        const on = lit && ((seed * 31 + r * 7 + cI * 13) % 5 === 0);
        x.fillStyle = "#2a2f36"; x.fillRect(wx - 3, wy - 3, (W - 36) / cols - 12, H / rows - 22);
        x.fillStyle = on ? "#ffd58a" : "#1a2a3a"; x.fillRect(wx, wy, (W - 36) / cols - 18, H / rows - 28);
        x.fillStyle = "rgba(255,255,255,.12)"; x.fillRect(wx, wy, 6, H / rows - 28);
      }
      // storefront
      x.fillStyle = "#1c2026"; x.fillRect(0, H - 62, W, 62);
      x.fillStyle = lit ? "#ffcf86" : "#3b4b5c"; x.fillRect(14, H - 54, W - 28, 40);
    });
  }
  function buildStreet(root) {
    // sidewalk, kerb, road
    const walk = new THREE.Mesh(new THREE.PlaneGeometry(60, 16), new THREE.MeshStandardMaterial({ map: tex(256, 64, function (x, W, H) {
      x.fillStyle = "#8d8f93"; x.fillRect(0, 0, W, H);
      x.strokeStyle = "rgba(0,0,0,.28)"; x.lineWidth = 2;
      for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(i * W / 8, 0); x.lineTo(i * W / 8, H); x.stroke(); }
      x.beginPath(); x.moveTo(0, H / 2); x.lineTo(W, H / 2); x.stroke();
      for (let i = 0; i < 300; i++) { x.fillStyle = "rgba(0,0,0," + Math.random() * 0.07 + ")"; x.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
    }, [8, 2]), roughness: 0.92 }));
    walk.rotation.x = -Math.PI / 2; walk.position.set(0, 0, -3.5); walk.receiveShadow = true; root.add(walk);
    box(60, 0.16, 0.3, M(0xa3a5a9, 0.9), 0, 0.02, 4.1, root);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(60, 12), new THREE.MeshStandardMaterial({ map: tex(512, 128, function (x, W, H) {
      x.fillStyle = "#2b2e33"; x.fillRect(0, 0, W, H);
      for (let i = 0; i < 1400; i++) { x.fillStyle = "rgba(255,255,255," + Math.random() * 0.04 + ")"; x.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
      x.fillStyle = "#e8c547"; for (let i = 0; i < 16; i++) x.fillRect(i * 32 + 4, H / 2 - 2, 18, 4);
    }, [2, 1]), roughness: 0.95 }));
    road.rotation.x = -Math.PI / 2; road.position.set(0, -0.1, 10.2); road.receiveShadow = true; root.add(road);
    // buildings behind the sidewalk, and across the road
    const bases = ["#7a3b2c", "#8a6d55", "#5d6670", "#9a8c79", "#6b2f2a", "#4f5965"];
    C3.facades = [];
    let x = -30;
    for (let i = 0; x < 30; i++) {
      const w = 6 + (i * 37 % 5), h = 11 + (i * 53 % 9);
      const mat = new THREE.MeshStandardMaterial({ map: facade(i, w, h, bases[i % bases.length], false), roughness: 0.85 });
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 4), [M(0x3a3f46), M(0x3a3f46), M(0x2c3036), M(0x2c3036), mat, M(0x3a3f46)]);
      b.position.set(x + w / 2, h / 2, -10.2); b.receiveShadow = true; root.add(b);
      box(w + 0.1, 0.35, 4.3, M(0x2c3036, 0.8), x + w / 2, h + 0.17, -10.2, root);
      // an awning on some storefronts
      if (i % 2 === 0) { const a = box(w * 0.7, 0.08, 1.3, M(i % 4 ? 0x2E7D4F : 0xC0392B, 0.7), x + w / 2, 3.2, -7.6, root); a.rotation.x = 0.3; }
      C3.facades.push(mat);
      x += w + 0.2;
    }
    x = -30;
    for (let i = 0; x < 30; i++) {
      const w = 7 + (i * 29 % 6), h = 14 + (i * 41 % 12);
      const mat = new THREE.MeshStandardMaterial({ map: facade(i + 9, w, h, bases[(i + 3) % bases.length], false), roughness: 0.85 });
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 4), [M(0x3a3f46), M(0x3a3f46), M(0x2c3036), M(0x2c3036), M(0x3a3f46), mat]);
      b.position.set(x + w / 2, h / 2, 19); root.add(b);
      C3.facades.push(mat);
      x += w + 0.3;
    }
    // lamps, a tree, a bench, a hydrant, a bin
    C3.lamps = [];
    [-9, 9].forEach(function (lx) {
      cyl(0.07, 0.09, 4.4, 8, M(0x2e3742, 0.5, 0.5), lx, 2.2, 3.6, root);
      box(0.9, 0.08, 0.08, M(0x2e3742, 0.5, 0.5), lx - 0.4, 4.35, 3.6, root);
      const bulb = box(0.4, 0.14, 0.24, M(0xfff0c8, 0.4, 0, 0.2), lx - 0.8, 4.27, 3.6, root);
      C3.lamps.push(bulb);
    });
    [-5.5, 6].forEach(function (tx) {
      box(1.2, 0.5, 1.2, M(0x5a5f66, 0.9), tx, 0.25, 3.1, root);
      cyl(0.1, 0.14, 2.2, 7, M(0x4a3524, 0.95), tx, 1.5, 3.1, root);
      for (let k = 0; k < 4; k++) { const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9 + (k % 2) * 0.25, 0), M(0x3f7a4c, 0.9)); f.position.set(tx + Math.sin(k * 2) * 0.5, 2.8 + k * 0.35, 3.1 + Math.cos(k * 2) * 0.4); f.castShadow = true; root.add(f); }
    });
    box(1.8, 0.08, 0.5, M(0x6b4f33, 0.8), -3.2, 0.48, -1.9, root); box(1.8, 0.5, 0.08, M(0x6b4f33, 0.8), -3.2, 0.78, -2.15, root);
    [-3.95, -2.45].forEach(function (bx) { box(0.08, 0.48, 0.5, M(0x2e3742, 0.5, 0.5), bx, 0.24, -1.9, root); });
    cyl(0.16, 0.18, 0.62, 10, M(0xc0392b, 0.5), 3.7, 0.31, 3.5, root); cyl(0.12, 0.16, 0.12, 10, M(0xc0392b, 0.5), 3.7, 0.68, 3.5, root);
    cyl(0.28, 0.24, 0.9, 12, M(0x2f5d3a, 0.7), -6.2, 0.45, -1.8, root);
  }

  /* ------------------------------------------------------------------ the cart */
  function buildCart(root) {
    const g = new THREE.Group(); root.add(g);
    const steel = M(0xc3cad1, 0.3, 0.8), red = M(0xc8372d, 0.5), yel = M(0xf2c12e, 0.55), dark = M(0x1c2026, 0.6, 0.3);
    box(1.9, 0.72, 0.85, steel, 0, 0.62, 0, g);                                 // body
    const side = new THREE.Mesh(new THREE.PlaneGeometry(1.86, 0.6), new THREE.MeshStandardMaterial({ map: tex(512, 160, function (x, W, H) {
      x.fillStyle = "#c8372d"; x.fillRect(0, 0, W, H);
      x.fillStyle = "#f2c12e"; x.fillRect(0, H - 22, W, 22); x.fillRect(0, 0, W, 10);
      x.font = "900 74px Archivo, 'Arial Black', sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillStyle = "#7a1d16"; x.fillText("HOT DOGS", W / 2 + 4, H / 2 - 2); x.fillStyle = "#fff4e3"; x.fillText("HOT DOGS", W / 2, H / 2 - 6);
    }), roughness: 0.6 }));
    side.position.set(0, 0.62, 0.427); g.add(side);
    box(1.96, 0.05, 0.9, M(0xdfe4e9, 0.25, 0.85), 0, 0.99, 0, g);                // top
    // big wheels at the back, a stand at the front, the push handle
    [-0.62, 0.62].forEach(function (wx) {
      const w = cyl(0.3, 0.3, 0.08, 18, M(0x15181c, 0.9), wx, 0.3, -0.47, g); w.rotation.x = Math.PI / 2;
      const h = cyl(0.1, 0.1, 0.1, 10, steel, wx, 0.3, -0.47, g); h.rotation.x = Math.PI / 2;
      box(0.05, 0.28, 0.05, steel, wx, 0.14, 0.36, g);
    });
    const hb = cyl(0.025, 0.025, 1.7, 8, steel, 0, 0.95, -0.62, g); hb.rotation.z = Math.PI / 2;
    // steamer (dogs), open lid
    box(0.56, 0.18, 0.5, steel, -0.58, 1.1, 0.02, g);
    const lid = box(0.56, 0.03, 0.3, steel, -0.58, 1.27, 0.33, g); lid.rotation.x = 1.15;   // hinged on the far side, open toward the street
    for (let i = 0; i < 4; i++) { const d = HS.Props.hotdog(); d.position.set(-0.7 + (i % 2) * 0.22, 1.2, -0.08 + Math.floor(i / 2) * 0.17); g.add(d); }
    // pretzel case (glass)
    const glass = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false });
    box(0.46, 0.46, 0.42, glass, 0.02, 1.25, 0.04, g);
    box(0.48, 0.04, 0.44, red, 0.02, 1.5, 0.04, g);
    cyl(0.01, 0.01, 0.4, 6, steel, 0.02, 1.36, 0.04, g).rotation.z = Math.PI / 2;
    for (let i = 0; i < 3; i++) { const p = HS.Props.pretz(); p.position.set(-0.12 + i * 0.14, 1.28 - (i % 2) * 0.1, 0.06); p.rotation.x = -Math.PI / 2; g.add(p); }
    // cooler of sodas on ice
    box(0.5, 0.22, 0.46, M(0x2a6fb5, 0.4), 0.62, 1.1, 0.02, g);
    box(0.46, 0.02, 0.42, M(0xe8f4ff, 0.2), 0.62, 1.2, 0.02, g);
    for (let i = 0; i < 6; i++) { const s = HS.Props.soda(); s.position.set(0.5 + (i % 3) * 0.12, 1.24, -0.08 + Math.floor(i / 3) * 0.18); s.rotation.z = (i - 3) * 0.08; if (i % 2) s.children[0].material = M(0x2a7a3f, 0.35); g.add(s); }
    // condiments, napkins, the tip jar
    cyl(0.035, 0.035, 0.18, 8, M(0xc0392b, 0.4), 0.88, 1.1, 0.33, g); cyl(0.035, 0.035, 0.18, 8, M(0xf2c12e, 0.4), 0.96, 1.1, 0.33, g);
    box(0.14, 0.12, 0.1, dark, -0.95, 1.07, 0.32, g);
    const jar = cyl(0.07, 0.07, 0.16, 12, glass, -0.3, 1.09, 0.34, g);
    C3.jarFill = cyl(0.062, 0.062, 0.01, 12, M(0x5d9b5a, 0.8), -0.3, 1.02, 0.34, g);
    // umbrella
    cyl(0.025, 0.025, 2.2, 8, steel, 0.95, 1.5, -0.3, g);
    const umb = new THREE.Mesh(new THREE.ConeGeometry(1.15, 0.45, 12, 1, true), new THREE.MeshStandardMaterial({ map: tex(256, 32, function (x, W, H) {
      for (let i = 0; i < 12; i++) { x.fillStyle = i % 2 ? "#f2c12e" : "#c8372d"; x.fillRect(i * W / 12, 0, W / 12, H); }
    }), side: THREE.DoubleSide, roughness: 0.7 }));
    umb.position.set(0.95, 2.62, -0.3); umb.castShadow = true; g.add(umb);
    // price board on the pole
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.42), new THREE.MeshStandardMaterial({ map: tex(200, 168, function (x, W, H) {
      x.fillStyle = "#15191f"; x.fillRect(0, 0, W, H);
      x.fillStyle = "#F5D97A"; x.font = "800 22px Archivo, sans-serif"; x.textAlign = "left";
      [["Hot Dog", "$5"], ["Pretzel", "$4"], ["Soda", "$3"]].forEach(function (r, i) {
        x.fillStyle = "#fff"; x.fillText(r[0], 14, 46 + i * 44); x.fillStyle = "#4FD1A5"; x.textAlign = "right"; x.fillText(r[1], W - 14, 46 + i * 44); x.textAlign = "left";
      });
    }), roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.15 }));
    board.material.emissiveMap = board.material.map;
    board.position.set(0.95, 1.85, -0.27); board.rotation.y = 0; g.add(board);
    C3.cart = g;
  }

  /* ------------------------------------------------------------------ build */
  C3.build = function () {
    if (C3.built) return;
    C3.built = true;
    const s = C3.scene = new THREE.Scene();
    s.background = new THREE.Color(0x9cc3e4);
    s.fog = new THREE.Fog(0x9cc3e4, 34 * U, 70 * U);
    C3.hemi = new THREE.HemisphereLight(0xdfe9ff, 0x4a4036, 1.4); s.add(C3.hemi);
    const sun = C3.sun = new THREE.DirectionalLight(0xfff0d4, 2.6);
    sun.position.set(-8 * U, 16 * U, 10 * U); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const d = 14 * U; Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, far: 60 * U });
    sun.shadow.bias = -0.0005;
    s.add(sun); s.add(sun.target);
    const root = C3.root = new THREE.Group(); root.scale.setScalar(U); s.add(root);
    buildStreet(root);
    buildCart(root);
    C3.cam = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 200 * U);
    C3.loadMe();
  };
  C3.loadMe = function () {
    if (C3.me && C3.me.id !== HS.PLAYER) { C3.scene.remove(C3.me.root); C3.me = null; }   // you picked someone else
    if (C3.me || !HS.Body.ready(HS.PLAYER)) return;
    const a = C3.me = HS.makeActor(HS.PLAYER);
    a.pos = new THREE.Vector3(0.05, 0, -1.05).multiplyScalar(U);
    a.root.position.copy(a.pos); a.root.rotation.y = Math.PI;      // facing the street
    a.reachT = 0; a.reachKey = null; a.hold = null; a.holdT = 0;
    C3.scene.add(a.root);
  };

  /* ------------------------------------------------------------------ hooks from the Cart logic */
  // a tap: dip into that compartment
  C3.tap = function (mid) { const a = C3.me; if (!a) return; a.reachKey = mid; a.reachT = 0.32; };
  // holding an item: keep the hand at the bottom of the dip (full reach) until you let go
  C3.holding = function (mid) { const a = C3.me; if (!a) return; a.reachKey = mid; a.reachT = 0.16; };
  // an item finished: it comes up in your hand
  C3.grab = function (mid) {
    const a = C3.me; if (!a) return;
    a.reachKey = mid; a.reachT = 0.32;
    if (a.hold) HS.Rig.drop(a.hold);
    a.hold = HS.Props[PROP[mid]](); a.hold.userData.s = U * 1.6; a.holdT = 0.75;
    HS.Rig.hold(a, "Right", a.hold, 0.09);
  };
  // a finished order: into the customer's hand, and away they go
  C3.served = function (c) {
    const r = C3.actors[c.id];
    if (C3.me && C3.me.hold) { HS.Rig.drop(C3.me.hold); C3.me.hold = null; }
    if (!r) return;
    const mid = c.items[0].m.id;
    r.carry = HS.Props[PROP[mid]](); r.carry.userData.s = U * 1.6;
    HS.Rig.hold(r.a, "Right", r.carry, 0.09);
    r.leaving = "served"; r.leaveDelay = 0.5;
    C3.me.serveT = 0.5;
  };
  C3.walkout = function (c) {
    const r = C3.actors[c.id];
    if (r) { r.leaving = "angry"; r.leaveDelay = 1.0; r.shake = 1.0; }
  };

  /* ------------------------------------------------------------------ bubbles */
  function faceSprite() {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
    s.scale.setScalar(0.24 * U); s.renderOrder = 6;           // small: in first person they're right in front of you
    s.userData = { x: c.getContext("2d"), t: t, f: "" };
    return s;
  }
  function setFace(s, f) {
    if (s.userData.f === f) return;
    s.userData.f = f;
    const x = s.userData.x; x.clearRect(0, 0, 64, 64);
    x.fillStyle = "rgba(255,255,255,.9)"; x.beginPath(); x.arc(32, 32, 28, 0, 6.29); x.fill();
    x.font = "40px serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(f, 32, 35);
    s.userData.t.needsUpdate = true;
  }
  C3.faceOf = function (c) { const p = c.pat / c.pat0; return p > 0.6 ? "🙂" : (p > 0.25 ? "😐" : "😠"); };

  /* ------------------------------------------------------------------ per frame */
  function slot(i) { return i === 0 ? LINE_START.clone() : new THREE.Vector3(0.9 + i * 0.85, 0, 1.55 + (i % 2) * 0.15); }
  function readyCrowd() { return HS.crowdIds(innerWidth < 820).filter(function (id) { return HS.Body.ready(id); }); }
  C3.update = function (dt, queue) {
    if (!C3.built) return;
    C3.t += dt;
    C3.loadMe();
    const ids = readyCrowd();
    // newcomers walk in from up the sidewalk
    queue.forEach(function (c, i) {
      let r = C3.actors[c.id];
      if (!r && ids.length) {
        const a = HS.makeActor(ids[(c.faceSeed || 0) % ids.length]);
        const start = new THREE.Vector3(ENTER_X + i * 0.6, 0, 1.9).multiplyScalar(U);
        a.root.position.copy(start);
        r = C3.actors[c.id] = { a: a, c: c, pos: start, yaw: Math.PI / 2, face: faceSprite() };
        r.face.position.y = (HS.heightOf(a.id) + 0.2) * U;
        a.root.add(r.face);
        C3.scene.add(a.root);
      }
      if (r) { r.slot = i; r.inLine = true; }
    });
    const live = {};
    queue.forEach(function (c) { live[c.id] = 1; });
    Object.keys(C3.actors).forEach(function (id) {
      const r = C3.actors[id], a = r.a;
      if (!live[id] && !r.leaving) { r.leaving = "served"; r.leaveDelay = 0; }
      let to;
      if (r.leaving) {
        r.leaveDelay -= dt;
        to = r.leaveDelay > 0 ? null : new THREE.Vector3(r.leaving === "angry" ? ENTER_X + 4 : EXIT_X, 0, 2.3).multiplyScalar(U);
      } else to = slot(r.slot).multiplyScalar(U);
      const px = r.pos.x, pz = r.pos.z;
      if (to) {
        const dx = to.x - r.pos.x, dz = to.z - r.pos.z, d = Math.hypot(dx, dz);
        if (d > 0.05) {
          const st = Math.min(d, WALK * U * dt);
          r.pos.x += dx / d * st; r.pos.z += dz / d * st;
          r.yaw = turnTo(r.yaw, Math.atan2(-dx, -dz), dt);
        } else if (r.leaving) {
          // off the end of the street
          C3.scene.remove(a.root); delete C3.actors[id]; return;
        } else {
          // in line: face the cart
          r.yaw = turnTo(r.yaw, Math.atan2(-(0 - r.pos.x), -(0 - r.pos.z)), dt);
        }
      }
      a.root.position.copy(r.pos); a.root.rotation.y = r.yaw;
      a.gait(Math.hypot(r.pos.x - px, r.pos.z - pz), dt);
      a.b.update(dt);
      if (r.shake > 0) { r.shake -= dt; a.root.updateMatrixWorld(true); HS.Rig.turnHead(a, Math.sin(r.shake * 16) * 0.45); }
      r.face.visible = !r.leaving || r.leaving === "angry";
      setFace(r.face, r.leaving === "angry" ? "😠" : (r.leaving ? "😋" : C3.faceOf(r.c)));
    });
    // you: reach into the compartment you just tapped, then hold up what you made
    const me = C3.me;
    if (me) {
      me.b.update(dt);
      me.root.updateMatrixWorld(true);
      if (me.reachT > 0 && me.reachKey) {
        me.reachT -= dt;
        const w = Math.sin(Math.min(1, 1 - me.reachT / 0.32) * Math.PI);
        const tgt = C3.cart.localToWorld(_v.copy(SLOT[me.reachKey]));
        HS.Rig.reach(me, "Right", tgt, new THREE.Vector3(1, -1, 0), w);
      } else if (me.hold && me.holdT > 0) {
        me.holdT -= dt;
        const tgt = C3.cart.localToWorld(_v.set(0.15, 1.45, 0.55));
        HS.Rig.reach(me, "Right", tgt, new THREE.Vector3(1, -1, 0), Math.min(1, me.holdT * 5));
        if (me.holdT <= 0) { HS.Rig.drop(me.hold); me.hold = null; }
      }
      if (me.serveT > 0) {
        me.serveT -= dt;
        HS.Rig.reach(me, "Left", C3.cart.localToWorld(_v.set(0.1, 1.3, 0.75)), new THREE.Vector3(-1, -1, 0), Math.min(1, me.serveT * 4));
      }
    }
    // the tip jar fills with today's tips
    if (C3.jarFill && typeof Cart !== "undefined") {
      const k = Math.min(1, (Cart.tipsDay || 0) / 120);
      C3.jarFill.scale.y = 1 + k * 13; C3.jarFill.position.y = 1.02 + k * 0.065;
    }
    // the day goes by: morning light to a warm evening
    const f = typeof Cart !== "undefined" && Cart.on ? Math.min(1, Cart.dayT / Cart.DAY) : 0.85;
    const eve = Math.max(0, (f - 0.55) / 0.45);
    C3.sun.intensity = 2.8 - eve * 1.6;
    C3.sun.color.setHex(0xfff0d4).lerp(new THREE.Color(0xff9a5a), eve);
    C3.sun.position.set((-8 + f * 16) * U, (16 - eve * 9) * U, -9 * U);     // from behind you: faces in the line are lit
    C3.scene.background.setHex(0x9cc3e4).lerp(new THREE.Color(0xe08a5c), eve * 0.75);
    C3.scene.fog.color.copy(C3.scene.background);
    C3.hemi.intensity = 1.4 - eve * 0.5;
    C3.lamps.forEach(function (l) { l.material.emissiveIntensity = 0.2 + eve * 2.5; });
  };
  function turnTo(a, b, dt) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * Math.min(1, dt * 9); }

  // First person (user, 2026-10-22): your own eyes behind the counter, looking down at the steamer,
  // the case and the cooler with the line in front of you. Your hands come up into view when you
  // reach. A drag looks along the line.
  C3.camera = function (dt, showcase) {
    const cam = C3.cam;
    if (showcase) {
      const a = C3.t * 0.08;
      cam.position.set(Math.sin(a) * 6.5 * U, 2.6 * U, (2.6 + Math.cos(a) * 4.5) * U);
      cam.lookAt(0, 1.1 * U, 0.6 * U);
      if (cam.near !== 0.1) { cam.near = 0.1; cam.fov = 48; cam.updateProjectionMatrix(); }
      return;
    }
    const narrow = innerWidth / innerHeight < 0.9;
    // just in front of your face (so your own head never fills the screen)
    _p.set(0.05, 1.72, -1.02).multiplyScalar(U);
    cam.position.lerp(_p, Math.min(1, dt * 6));
    const yaw = C3.yaw, pitch = C3.pitch || 0;
    cam.lookAt(_v.set(0.05 + Math.sin(yaw) * 3.6, 1.12 + pitch * 2, -1.02 + Math.cos(yaw) * 3.6).multiplyScalar(U));
    const fov = narrow ? 82 : 62;
    if (Math.abs(cam.fov - fov) > 0.1 || cam.near !== 0.04) { cam.fov = fov; cam.near = 0.04; cam.updateProjectionMatrix(); }
  };
  C3.drag = function (dx, dy) {
    C3.yaw = THREE.MathUtils.clamp(C3.yaw - dx * 0.003, -0.75, 0.75);
    C3.pitch = THREE.MathUtils.clamp((C3.pitch || 0) - (dy || 0) * 0.004, -0.4, 0.9);
  };

  // Float the item buttons over their compartments.
  C3.placeHotspots = function (wrap) {
    if (!wrap) return;
    wrap.querySelectorAll(".hotspot").forEach(function (b) {
      const s = SLOT[b.dataset.m]; if (!s) return;
      C3.cart.localToWorld(_v.copy(s).add(new THREE.Vector3(0, 0.05, 0.1))).project(C3.cam);
      b.style.left = ((_v.x + 1) / 2 * innerWidth) + "px";
      b.style.top = ((1 - _v.y) / 2 * innerHeight) + "px";
    });
  };

  C3.render = function (renderer, dt, showcase) {
    C3.build();
    if (C3.cam.aspect !== innerWidth / innerHeight) { C3.cam.aspect = innerWidth / innerHeight; C3.cam.updateProjectionMatrix(); }
    C3.camera(dt, showcase);
    renderer.render(C3.scene, C3.cam);
  };
  // A new day: clear anyone left on the street.
  C3.reset = function () {
    Object.keys(C3.actors).forEach(function (id) { C3.scene.remove(C3.actors[id].a.root); });
    C3.actors = {};
  };
  HS.Cart3D = C3;
})(globalThis.HS);
