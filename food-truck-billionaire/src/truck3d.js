// The food trucks, in park units (HS.U per metre). A truck is 9 long (x), 4 deep (z), its service
// window on the +Z side facing the plaza, the cab at -X. Every truck gets the same livery from its
// cuisine (hue / accent / trim); yours is also built hollow with a working kitchen inside:
//  - three stations on the back wall (grill, fryer, prep) where the cooks stand,
//  - the service counter and pass at the window, a fridge, the exhaust hood, lights,
//  - food on whichever station is cooking, a progress ring over it, smoke, bags on the pass.
// In the kitchen view the roof, hood and back wall lift off so you can see in (setCutaway).
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const THREE = globalThis.THREE;
  const U = HS.U;
  const FLOOR = 1.06;                       // kitchen floor height (top of the truck bed)

  const mats = {};
  function M(c, r, m, e) {
    const k = c + "|" + r + "|" + m + "|" + e;
    if (!mats[k]) mats[k] = new THREE.MeshStandardMaterial({ color: c, roughness: r === undefined ? 0.6 : r, metalness: m || 0, emissive: e ? c : 0x000000, emissiveIntensity: e || 0 });
    return mats[k];
  }
  function box(w, h, d, mat, x, y, z, g) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    if (g) g.add(m);
    return m;
  }
  function cyl(rt, rb, h, seg, mat, x, y, z, g) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.position.set(x, y, z); m.castShadow = true;
    if (g) g.add(m);
    return m;
  }
  const hex = function (n) { return "#" + n.toString(16).padStart(6, "0"); };

  /* ------------------------------------------------------------------ painted signs */
  function canvasTex(w, h, draw) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }
  function nameTex(name, cu, mine) {
    return canvasTex(768, 128, function (x, w, h) {
      x.fillStyle = hex(cu.accent); x.fillRect(0, 0, w, h);
      x.fillStyle = "rgba(0,0,0,.18)"; x.fillRect(0, h - 14, w, 14);
      x.font = "800 70px Archivo, 'Arial Black', sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillStyle = "rgba(0,0,0,.35)"; x.fillText(name.toUpperCase(), w / 2 + 3, h / 2 + 5, w - 60);
      x.fillStyle = mine ? "#F5D97A" : "#ffffff"; x.fillText(name.toUpperCase(), w / 2, h / 2 + 2, w - 60);
    });
  }
  function menuTex(truck, cu) {
    return canvasTex(256, 384, function (x, w, h) {
      x.fillStyle = "#15191f"; x.fillRect(0, 0, w, h);
      x.strokeStyle = hex(cu.accent); x.lineWidth = 10; x.strokeRect(5, 5, w - 10, h - 10);
      x.fillStyle = "#F5D97A"; x.font = "800 34px Archivo, sans-serif"; x.textAlign = "center";
      x.fillText("MENU", w / 2, 50);
      x.textAlign = "left"; x.font = "600 19px Archivo, sans-serif";
      cu.menu.forEach(function (m, i) {
        const y = 100 + i * 66;
        x.fillStyle = "#ffffff"; x.fillText(m.name.length > 20 ? m.name.slice(0, 19) + "…" : m.name, 18, y, w - 36);
        x.fillStyle = "#4FD1A5"; x.font = "700 22px 'IBM Plex Mono', monospace";
        x.fillText("$" + (truck.prices[m.id] || m.price).toFixed(2), 18, y + 27);
        x.font = "600 19px Archivo, sans-serif";
      });
    });
  }
  const awningTexs = {};
  function awningTex(cu) {
    const k = cu.accent + "|" + cu.trim;
    if (!awningTexs[k]) awningTexs[k] = canvasTex(256, 64, function (x, w, h) {
      for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? hex(cu.trim) : hex(cu.accent); x.fillRect(i * w / 8, 0, w / 8, h); }
      x.fillStyle = "rgba(0,0,0,.18)"; x.fillRect(0, h - 8, w, 8);
    });
    return awningTexs[k];
  }

  /* ------------------------------------------------------------------ food (metres, scaled by U) */
  const FOOD = {
    burger: "patty", sub: "patty", pizza: "pizza", tacos: "tortilla", quesa: "tortilla",
    chick: "fried", parm: "fried", fries: "fries", emp: "fried",
    dog: "dog", alfredo: "pasta", burrito: "burrito"
  };
  function food(id) {
    const g = new THREE.Group(), kind = FOOD[id] || "patty";
    const fm = function (c, r) { return M(c, r === undefined ? 0.7 : r); };
    if (kind === "patty") {
      [-0.16, 0.16].forEach(function (x) { const p = cyl(0.11, 0.11, 0.035, 14, fm(0x5b3a22, 0.8), x, 0.018, 0, g); p.castShadow = false; });
    } else if (kind === "pizza") {
      cyl(0.22, 0.22, 0.02, 20, fm(0xe8c87a), 0, 0.01, 0, g);
      cyl(0.19, 0.19, 0.012, 20, fm(0xc0392b, 0.5), 0, 0.025, 0, g);
      for (let i = 0; i < 6; i++) { const a = i / 6 * 6.28; cyl(0.03, 0.03, 0.01, 8, fm(0xf4ecd6), Math.cos(a) * 0.11, 0.034, Math.sin(a) * 0.11, g); }
    } else if (kind === "tortilla") {
      [-0.18, 0, 0.18].forEach(function (x) { cyl(0.08, 0.08, 0.012, 14, fm(0xeed9a0), x, 0.008, 0, g); box(0.09, 0.02, 0.05, fm(0x6b3f22), x, 0.02, 0, g); });
    } else if (kind === "fried") {
      [-0.12, 0.12].forEach(function (x) { box(0.16, 0.05, 0.12, fm(0xc98a2e, 0.85), x, 0.03, 0, g); });
    } else if (kind === "fries") {
      for (let i = 0; i < 14; i++) { const s = box(0.015, 0.1, 0.015, fm(0xf2c14e), (Math.random() - 0.5) * 0.2, 0.05, (Math.random() - 0.5) * 0.14, g); s.rotation.set((Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 0.8); }
    } else if (kind === "dog") {
      const h = HS.Props.hotdog(); h.scale.setScalar(1.4); h.position.y = 0.04; g.add(h);
    } else if (kind === "pasta") {
      cyl(0.13, 0.11, 0.06, 16, fm(0x9aa3ad, 0.3), 0, 0.03, 0, g);
      cyl(0.11, 0.11, 0.02, 16, fm(0xf3e6c8), 0, 0.06, 0, g);
    } else {
      const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.16, 4, 10), fm(0xeed9a0));
      b.rotation.z = Math.PI / 2; b.position.y = 0.05; g.add(b);
    }
    g.scale.setScalar(U);
    return g;
  }

  /* ------------------------------------------------------------------ draw-call diet
     A truck is ~80 little boxes and cylinders; sixteen of them (plus their shadows) was over a
     thousand draw calls. mergeStatic folds every static mesh under `root` into one mesh per
     material (opts.bake: into ONE vertex-coloured mesh, each part keeping its material's colour).
     Objects in opts.skip (and anything under them) are left alone. */
  const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _n = new THREE.Matrix3(), _pv = new THREE.Vector3();
  function mergeStatic(root, opts) {
    opts = opts || {};
    const skip = opts.skip || new Set();
    root.updateMatrixWorld(true);
    _inv.copy(root.matrixWorld).invert();
    const buckets = new Map(), dead = [];
    let bakeMat = null;
    (function walk(o) {
      if (skip.has(o)) return;
      if (o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh && o.visible) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const g = o.geometry, idx = g.index ? g.index.array : null, nv = g.attributes.position.count;
        const groups = Array.isArray(o.material) && g.groups.length ? g.groups : [{ start: 0, count: idx ? idx.length : nv, materialIndex: 0 }];
        _m.multiplyMatrices(_inv, o.matrixWorld); _n.getNormalMatrix(_m);
        groups.forEach(function (gr) {
          const mat = mats[gr.materialIndex] || mats[0];
          const key = opts.bake ? "bake" : mat;
          if (opts.bake && !bakeMat) bakeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
          let b = buckets.get(key);
          if (!b) buckets.set(key, b = { mat: opts.bake ? bakeMat : mat, pos: [], nor: [], uv: [], col: [], idx: [], n: 0, cast: false, recv: false });
          const base = b.n, P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv;
          const col = opts.bake ? (mat.color || new THREE.Color(1, 1, 1)) : null;
          for (let i = 0; i < nv; i++) {
            _pv.fromBufferAttribute(P, i).applyMatrix4(_m); b.pos.push(_pv.x, _pv.y, _pv.z);
            if (N) { _pv.fromBufferAttribute(N, i).applyMatrix3(_n).normalize(); b.nor.push(_pv.x, _pv.y, _pv.z); } else b.nor.push(0, 1, 0);
            if (UV) b.uv.push(UV.getX(i), UV.getY(i)); else b.uv.push(0, 0);
            if (col) b.col.push(col.r, col.g, col.b);
          }
          for (let i = gr.start; i < gr.start + gr.count; i++) b.idx.push(base + (idx ? idx[i] : i));
          b.n += nv; b.cast = b.cast || o.castShadow; b.recv = b.recv || o.receiveShadow;
        });
        dead.push(o);
      }
      o.children.slice().forEach(walk);
    })(root);
    dead.forEach(function (o) { o.parent.remove(o); });
    buckets.forEach(function (b) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(b.nor, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
      if (b.col.length) geo.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
      geo.setIndex(b.n > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, b.mat);
      m.castShadow = b.cast; m.receiveShadow = b.recv;
      root.add(m);
    });
    return root;
  }
  HS.mergeStatic = mergeStatic;

  /* ------------------------------------------------------------------ the truck */
  const T = {};
  T.FLOOR = FLOOR;
  T.build = function (truck, cu, home, makeProp) {
    const g = new THREE.Group();
    const body = M(cu.hue, 0.42, 0.12), trim = M(cu.trim, 0.45, 0.1), accent = M(cu.accent, 0.5);
    const dark = M(0x14181d, 0.9), steel = M(0xb9c2cc, 0.32, 0.75), glass = M(0x1b2633, 0.12, 0.6);
    const inner = M(0xc9d0d8, 0.35, 0.55);
    const cut = [];                                     // what lifts off for the kitchen view

    // ---- body shell
    if (!home) {
      box(9, 4.2, 4, body, 0, 3.1, 0, g);
      // the window: a recess, a warm lit kitchen behind it
      box(5.4, 2.0, 0.2, dark, 0.2, 3.45, 1.95, g);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.9), new THREE.MeshBasicMaterial({ color: 0xffcf7a }));
      glow.position.set(0.2, 3.45, 1.9); g.add(glow);
      // a cook's silhouette moving in the window
      const sil = box(0.7, 1.3, 0.05, M(0x3a2a20, 0.9), -0.6, 3.2, 1.93, g); sil.castShadow = false;
      g.userData.sil = sil;
    } else {
      const wallMats = function (outIsPlusZ) {
        // +x, -x, +y, -y, +z, -z
        return outIsPlusZ ? [body, body, body, body, body, inner] : [body, body, body, body, inner, body];
      };
      // floor (diamond-plate grey) and the bed under it
      box(9, 0.12, 4, M(0x5c636c, 0.55, 0.6), 0, 1.0, 0, g);
      // back wall (-Z side) and the end walls
      const back = new THREE.Mesh(new THREE.BoxGeometry(9, 4.2, 0.12), wallMats(false));
      back.position.set(0, 3.1, -1.94); back.castShadow = back.receiveShadow = true; g.add(back); cut.push(back);
      const endA = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4.2, 4), [inner, body, body, body, body, body]);
      endA.position.set(-4.44, 3.1, 0); endA.castShadow = true; g.add(endA);
      const endB = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4.2, 4), [body, inner, body, body, body, body]);
      endB.position.set(4.44, 3.1, 0); endB.castShadow = true; g.add(endB);
      // front wall with the window opening (x -2.4..2.8, y 2.5..4.4)
      const fw = function (x0, x1, y0, y1) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, 0.12), wallMats(true));
        m.position.set((x0 + x1) / 2, (y0 + y1) / 2, 1.94); m.castShadow = m.receiveShadow = true; g.add(m); return m;
      };
      fw(-4.5, -2.4, 1.0, 5.2); fw(2.8, 4.5, 1.0, 5.2); fw(-2.4, 2.8, 1.0, 2.5);
      cut.push(fw(-2.4, 2.8, 4.4, 5.2));                                  // over the window: lifts off so you see your line
      // window frame
      cut.push(box(5.3, 0.1, 0.18, steel, 0.2, 4.42, 1.96, g)); box(0.1, 1.95, 0.18, steel, -2.42, 3.45, 1.96, g); box(0.1, 1.95, 0.18, steel, 2.82, 3.45, 1.96, g);
      // flat ceiling (part of the roof)
      const ceil = box(9, 0.1, 4, inner, 0, 5.15, 0, g); cut.push(ceil);
    }
    // stripe plates on the outside (not a box through the middle: you can see into yours)
    box(9.04, 0.6, 0.04, accent, 0, 1.7, 2.02, g); box(9.04, 0.6, 0.04, accent, 0, 1.7, -2.02, g);
    box(0.04, 0.6, 4.04, accent, 4.52, 1.7, 0, g);
    box(9.04, 0.12, 0.04, trim, 0, 2.06, 2.02, g); box(9.04, 0.12, 0.04, trim, 0, 2.06, -2.02, g);

    // ---- rounded roof
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.05, 9, 20, 1, false, 0, Math.PI), trim);
    roof.rotation.z = Math.PI / 2; roof.position.set(0, 5.2, 0); roof.scale.set(0.45, 1, 1);   // local x is height once turned roof.castShadow = true;
    g.add(roof); cut.push(roof);
    const ac = box(1.8, 0.6, 1.4, M(0xd8dde3, 0.5, 0.3), -2.6, 6.3, 0, g); cut.push(ac);
    const vent = cyl(0.22, 0.22, 1.0, 10, steel, 3.2, 6.4, -0.6, g); cut.push(vent);
    const cap = cyl(0.36, 0.3, 0.14, 10, steel, 3.2, 6.95, -0.6, g); cut.push(cap);
    // rooftop sign prop by cuisine
    const prop = makeProp(cu.prop); prop.position.set(0.8, 6.0, 0.3); g.add(prop); cut.push(prop);

    // ---- cab
    box(2.7, 2.9, 3.8, trim, -5.85, 2.55, 0, g);
    box(1.0, 1.35, 3.7, trim, -7.55, 1.75, 0, g);                       // hood
    const ws = box(0.1, 1.25, 3.3, glass, -7.05, 3.25, 0, g); ws.rotation.z = -0.32;
    box(1.4, 1.0, 0.06, glass, -5.9, 3.25, 1.91, g); box(1.4, 1.0, 0.06, glass, -5.9, 3.25, -1.91, g);
    box(0.08, 0.7, 2.8, M(0x23292f, 0.4, 0.6), -8.08, 1.55, 0, g);      // grille
    [-1.45, 1.45].forEach(function (z) { const l = cyl(0.26, 0.26, 0.1, 14, M(0xfff4d6, 0.3, 0, 1.4), -8.08, 1.95, z, g); l.rotation.z = Math.PI / 2; });
    box(0.3, 0.32, 4.0, steel, -8.15, 0.95, 0, g);                      // bumper
    box(0.3, 0.32, 4.0, steel, 4.62, 0.95, 0, g);
    [-1.4, 1.4].forEach(function (z) { box(0.06, 0.5, 0.3, M(0xff3a2e, 0.4, 0, 1.2), 4.53, 2.3, z, g); });   // tail lights
    // the back door
    box(0.04, 3.3, 1.5, M(0x000000, 0.9), 4.53, 2.75, -0.6, g).material = M(cu.hue, 0.5, 0.1);
    box(0.06, 0.08, 0.5, steel, 4.56, 2.8, -0.15, g);
    // undercarriage + wheels
    box(10.4, 0.36, 3.2, dark, -1.6, 0.78, 0, g);
    [[-5.4, 2.0], [-5.4, -2.0], [3.0, 2.0], [3.0, -2.0]].forEach(function (p) {
      const w = cyl(1.0, 1.0, 0.62, 18, M(0x15181c, 0.95), p[0], 1.0, p[1], g); w.rotation.x = Math.PI / 2;
      const hub = cyl(0.45, 0.45, 0.66, 12, steel, p[0], 1.0, p[1], g); hub.rotation.x = Math.PI / 2;
      box(2.4, 0.16, 0.5, dark, p[0], 2.12, p[1] * 1.005, g);            // arch lip
    });
    // generator + propane at the back
    box(1.0, 0.8, 1.5, M(0x3a4048, 0.6, 0.3), 5.3, 1.35, 0.6, g);
    [0.95, 1.45].forEach(function (z) { cyl(0.22, 0.22, 0.9, 12, M(0xe9ecef, 0.4, 0.2), 4.95, 1.4, -z, g); });

    // ---- the service side: awning, counter, signs, lights
    const awn = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.1, 2.5), [trim, trim, new THREE.MeshStandardMaterial({ map: awningTex(cu), roughness: 0.7 }), trim, trim, trim]);
    awn.position.set(0.2, 4.95, 3.15); awn.rotation.x = 0.26; awn.castShadow = true; g.add(awn); cut.push(awn);
    [-2.7, 3.1].forEach(function (x) { const s = box(0.06, 0.06, 1.4, steel, x, 4.65, 2.6, g); s.rotation.x = -0.6; cut.push(s); });
    for (let i = 0; i < 10; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), M(0xffe0a0, 0.4, 0, 2.2));
      b.position.set(-2.8 + i * 0.66, 4.55 - Math.sin(i / 9 * Math.PI) * 0.22, 4.35); g.add(b); cut.push(b);
    }
    box(5.8, 0.12, 0.75, steel, 0.2, 2.5, 2.38, g);                       // outside ledge
    box(0.25, 0.32, 0.18, M(0x2a2f36, 0.5, 0.4), -2.2, 2.72, 2.4, g);     // napkins
    [[1.9, 0xc0392b], [2.15, 0xf2c12e]].forEach(function (b) { cyl(0.07, 0.07, 0.32, 10, M(b[1], 0.4), b[0], 2.72, 2.42, g); });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(6.0, 0.86), new THREE.MeshBasicMaterial({ map: nameTex(truck.name, cu, truck.mine), toneMapped: false }));
    plate.position.set(0.2, 4.82, 2.03); g.add(plate); cut.push(plate);
    g.userData.namePlate = plate;
    const menu = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.1), new THREE.MeshStandardMaterial({ map: menuTex(truck, cu), roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.25 }));
    menu.material.emissiveMap = menu.material.map;
    menu.position.set(-3.45, 3.35, 2.03); g.add(menu);
    g.userData.menu = menu;

    if (home) {
      T.kitchen(g, cu, makeProp);
      // what lifts off for the kitchen view goes in one group (merged on its own), then the rest
      // of the truck merges around the moving parts (heat glow, fryer baskets, bags on the pass)
      const K = g.userData.k, cg = new THREE.Group();
      g.add(cg);
      cut.concat(K.cut).forEach(function (m) { cg.add(m); });
      mergeStatic(cg);
      const skip = new Set([cg].concat(K.bags));
      Object.keys(K.stations).forEach(function (k) { const s = K.stations[k]; skip.add(s.userData.heat); (s.userData.baskets || []).forEach(function (b) { skip.add(b); }); });
      mergeStatic(g, { skip: skip });
      cut.length = 0; cut.push(cg); K.cut = [];
    } else mergeStatic(g, { skip: new Set([g.userData.sil]) });     // everyone else's truck: a dozen draw calls
    g.userData.cut = cut;
    g.userData.cu = cu;
    return g;
  };

  /* ------------------------------------------------------------------ inside your truck */
  T.kitchen = function (g, cu) {
    const steel = M(0xb9c2cc, 0.3, 0.8), dark = M(0x16191d, 0.6, 0.4), shelf = M(0x8f99a4, 0.4, 0.6);
    const K = g.userData.k = { stations: {}, work: {}, top: {}, cut: [], smoke: [], bags: [], t: 0 };
    const mk = function (key, x) {
      const s = new THREE.Group(); s.position.set(x, 0, -1.45); g.add(s);
      box(2.3, 1.4, 0.95, steel, 0, FLOOR + 0.7, 0, s);
      box(2.36, 0.06, 1.0, M(0xd6dce2, 0.25, 0.8), 0, FLOOR + 1.43, 0, s);
      box(2.2, 0.05, 0.02, dark, 0, FLOOR + 0.9, 0.48, s);              // door seams
      [-0.55, 0.55].forEach(function (dx) { box(0.04, 0.05, 0.05, steel, dx, FLOOR + 1.15, 0.5, s); });
      if (key === "grill") {
        box(2.1, 0.08, 0.8, M(0x1a1c1f, 0.45, 0.5), 0, FLOOR + 1.5, 0.02, s);
        box(2.1, 0.3, 0.05, steel, 0, FLOOR + 1.62, -0.42, s);
        [-0.7, -0.25, 0.2, 0.65].forEach(function (dx) { const k = cyl(0.05, 0.05, 0.06, 8, dark, dx, FLOOR + 1.0, 0.5, s); k.rotation.x = Math.PI / 2; });
      } else if (key === "fryer") {
        [-0.48, 0.48].forEach(function (dx) {
          box(0.82, 0.04, 0.62, M(0x6b4d12, 0.15, 0.2), dx, FLOOR + 1.47, 0.02, s);
          const bk = box(0.6, 0.26, 0.42, M(0x3b3f45, 0.5, 0.6), dx, FLOOR + 1.62, 0.04, s);
          box(0.05, 0.05, 0.5, dark, dx, FLOOR + 1.75, 0.44, s);
          (s.userData.baskets = s.userData.baskets || []).push(bk);
        });
      } else {
        box(1.4, 0.05, 0.62, M(0xf1efe8, 0.8), -0.25, FLOOR + 1.48, 0.06, s);
        [[0.62, 0x3FA06B], [0.62, 0xD8453C], [0.62, 0xF2C14E]].forEach(function (b, i) {
          box(0.24, 0.12, 0.2, M(b[1], 0.6), b[0] + (i - 1) * 0.0, FLOOR + 1.52, -0.25 + i * 0.25, s);
        });
      }
      const heat = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.8), new THREE.MeshBasicMaterial({ color: 0xE8663C, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      heat.rotation.x = -Math.PI / 2; heat.position.set(0, FLOOR + 1.56, 0.02); s.add(heat);
      s.userData.heat = heat;
      s.userData.foodAt = new THREE.Vector3(0, FLOOR + 1.53, 0.05);
      const ring = ringSprite(); ring.position.set(0, FLOOR + 2.7, 0.3); s.add(ring); s.userData.ring = ring;
      K.stations[key] = s;
      K.work[key] = new THREE.Vector3(x, FLOOR, -0.62);
      K.top[key] = new THREE.Vector3(x, FLOOR + 1.56, -1.4);
      return s;
    };
    mk("grill", -2.6); mk("fryer", 0); mk("prep", 2.6);
    // exhaust hood over the line
    const hood = box(7.6, 0.55, 0.95, steel, 0, 4.55, -1.45, g); K.cut.push(hood);
    // front service counter + pass + POS
    box(5.5, 1.45, 0.5, steel, 0.25, FLOOR + 0.72, 1.62, g);
    box(5.5, 0.06, 0.56, M(0xd6dce2, 0.25, 0.8), 0.25, FLOOR + 1.47, 1.62, g);
    const pos = box(0.42, 0.3, 0.32, dark, 2.4, FLOOR + 1.66, 1.6, g); pos.rotation.x = -0.4;
    box(0.36, 0.22, 0.02, M(0x4FD1A5, 0.4, 0, 0.8), 2.4, FLOOR + 1.7, 1.45, g).rotation.x = -0.4;
    // tall fridge at the cab end
    box(0.95, 3.0, 0.95, M(0xe4e8ec, 0.3, 0.5), -3.9, FLOOR + 1.5, 1.4, g);
    box(0.05, 1.0, 0.05, steel, -3.45, FLOOR + 1.9, 1.0, g);
    // shelves at the back end
    [2.4, 3.2, 4.0].forEach(function (y) { box(0.5, 0.05, 1.6, shelf, 4.1, FLOOR + y - 0.9, 0.3, g); });
    [[0.15, 0xd9a24b], [0.6, 0xc0392b], [0.9, 0x3FA06B]].forEach(function (b) { box(0.35, 0.3, 0.3, M(b[1], 0.8), 4.1, FLOOR + 1.68, b[0], g); });
    // ceiling light strips + one warm light inside
    [-2.6, 0, 2.6].forEach(function (x) { const l = box(1.4, 0.04, 0.3, M(0xfff3d6, 0.4, 0, 2.0), x, 5.08, 0.4, g); l.castShadow = false; K.cut.push(l); });
    const pl = new THREE.PointLight(0xffe2b0, 18, 12, 1.4); pl.position.set(0.2, 4.6, 0.3); g.add(pl);
    // anti-fatigue mat
    const mat = box(7.4, 0.03, 1.4, M(0x22262b, 0.95), 0, FLOOR + 0.02, 0.15, g); mat.castShadow = false;
    // where your crew stands when nothing's on: by the window, and the pass
    K.window = new THREE.Vector3(0.6, FLOOR, 0.92);
    K.rest = [new THREE.Vector3(-1.2, FLOOR, 0.9), new THREE.Vector3(3.4, FLOOR, 0.6), new THREE.Vector3(-3.0, FLOOR, 0.2)];
    // the floor you can walk on (local x/z), and what's in the way
    K.bounds = { x0: -3.95, x1: 3.75, z0: -0.88, z1: 1.18 };
    K.solids = [{ x0: -4.5, x1: -3.32, z0: 0.82, z1: 2 }];
    // smoke puffs
    const sm = new THREE.SpriteMaterial({ map: puffTex(), transparent: true, depthWrite: false, opacity: 0 });
    for (let i = 0; i < 26; i++) { const s = new THREE.Sprite(sm.clone()); s.visible = false; s.scale.setScalar(0.6); g.add(s); K.smoke.push({ s: s, life: 0 }); }
    // ready bags on the pass
    for (let i = 0; i < 5; i++) { const b = HS.Props.bag(); b.scale.setScalar(1.2); b.position.set(-1.8 + i * 0.75, FLOOR + 1.98, 1.62); b.visible = false; g.add(b); K.bags.push(b); }
    K.food = {};
  };

  function puffTex() {
    if (puffTex.t) return puffTex.t;
    puffTex.t = canvasTex(64, 64, function (x) {
      const gr = x.createRadialGradient(32, 32, 2, 32, 32, 30);
      gr.addColorStop(0, "rgba(255,255,255,.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    });
    return puffTex.t;
  }
  function ringSprite() {
    const c = document.createElement("canvas"); c.width = c.height = 96;
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
    s.scale.setScalar(0.85); s.visible = false; s.renderOrder = 5;
    s.userData = { c: c, x: c.getContext("2d"), t: t, p: -1 };
    return s;
  }
  function drawRing(s, p, label) {
    const u = s.userData, q = Math.round(p * 40);
    if (u.p === q && u.l === label) return;
    u.p = q; u.l = label;
    const x = u.x; x.clearRect(0, 0, 96, 96);
    x.fillStyle = "rgba(11,14,18,.78)"; x.beginPath(); x.arc(48, 48, 40, 0, 6.29); x.fill();
    x.strokeStyle = "rgba(255,255,255,.15)"; x.lineWidth = 8; x.beginPath(); x.arc(48, 48, 32, 0, 6.29); x.stroke();
    x.strokeStyle = p >= 1 ? "#4FD1A5" : "#E8663C"; x.beginPath(); x.arc(48, 48, 32, -Math.PI / 2, -Math.PI / 2 + p * 6.283); x.stroke();
    x.font = "34px serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(label, 48, 51);
    u.t.needsUpdate = true;
  }

  // Lift the roof, hood and back wall off (kitchen view) or put them back.
  T.setCutaway = function (g, on) {
    (g.userData.cut || []).concat(g.userData.k ? g.userData.k.cut : []).forEach(function (m) { m.visible = !on; });
  };

  // Per frame for your truck: food on the stations, progress, smoke, bags on the pass.
  const ICON = { grill: "🔥", fryer: "🍟", prep: "🔪" };
  const _w = new THREE.Vector3();
  T.updateHome = function (g, dt, stations, tickets) {
    const K = g.userData.k;
    if (!K) return;
    K.t += dt;
    ["grill", "fryer", "prep"].forEach(function (key) {
      const s = K.stations[key], st = stations[key];
      // food: rebuild when the item on the station changes
      const id = st ? st.o.it.id : null;
      if (K.food[key] && K.food[key].userData.id !== id) { s.remove(K.food[key]); K.food[key] = null; }
      if (id && !K.food[key]) { const f = food(id); f.userData.id = id; f.position.copy(s.userData.foodAt); s.add(f); K.food[key] = f; }
      if (K.food[key]) K.food[key].position.y = s.userData.foodAt.y + (key === "fryer" ? -0.05 + Math.sin(K.t * 3) * 0.03 : 0);
      if (s.userData.baskets) s.userData.baskets.forEach(function (b, i) { b.position.y += ((st && i === 0 ? FLOOR + 1.45 : FLOOR + 1.62) - b.position.y) * Math.min(1, dt * 6); });
      // progress ring
      const r = s.userData.ring;
      r.visible = !!st;
      if (st) drawRing(r, 1 - Math.max(0, st.o.left) / Math.max(1e-3, st.o.total), ICON[key]);
      // smoke from the hot stations
      if (st && key !== "prep" && Math.random() < dt * 9) {
        const p = K.smoke.find(function (q) { return q.life <= 0; });
        if (p) {
          p.life = 1.6; p.s.visible = true;
          p.s.position.set(s.position.x + (Math.random() - 0.5) * 1.4, FLOOR + 1.7, s.position.z + (Math.random() - 0.5) * 0.4);
          p.vx = (Math.random() - 0.5) * 0.3;
        }
      }
    });
    K.smoke.forEach(function (p) {
      if (p.life <= 0) return;
      p.life -= dt;
      p.s.position.y += dt * 1.1; p.s.position.x += p.vx * dt;
      const k = p.life / 1.6;
      p.s.material.opacity = Math.min(1, (1 - k) * 4) * k * 0.7;
      p.s.scale.setScalar(0.5 + (1 - k) * 1.4);
      if (p.life <= 0) p.s.visible = false;
    });
    // one bag on the pass per finished ticket
    let n = 0;
    for (const tk of tickets) if (tk.ready) n++;
    K.bags.forEach(function (b, i) { b.visible = i < n; });
  };

  // The old silhouettes in other trucks' windows sway a little so the park feels busy.
  T.updateOther = function (g, t) {
    const s = g.userData.sil;
    if (s) s.position.x = -0.6 + Math.sin(t * 0.7 + g.id) * 1.6;
  };

  // Where things are, in world space.
  T.world = function (g, local, out) { return g.localToWorld((out || _w).copy(local)); };

  // A small studio render of a cuisine's truck, for the pick cards (no photos any more).
  T.portrait = function (renderer, cu, makeProp) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x141922);
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2118, 1.6));
    const key = new THREE.DirectionalLight(0xfff0d4, 2.6); key.position.set(10, 14, 12); scene.add(key);
    const fake = { name: cu.name + " Kitchen", mine: true, prices: {} };
    const g = T.build(fake, cu, false, makeProp);
    g.rotation.y = -0.55; scene.add(g);
    const fl = new THREE.Mesh(new THREE.CircleGeometry(12, 32), new THREE.MeshStandardMaterial({ color: 0x2b323c, roughness: 0.9 }));
    fl.rotation.x = -Math.PI / 2; scene.add(fl);
    const cam = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 100);
    cam.position.set(4, 7.5, 22); cam.lookAt(-0.6, 3.2, 0);
    const W = 480, H = 270;
    const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.setRenderTarget(null);
    const px = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
    rt.dispose();
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d"), img = x.createImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    x.putImageData(img, 0, 0);
    return c.toDataURL("image/jpeg", 0.85);
  };

  HS.Truck3D = T;
})(globalThis.HS);
