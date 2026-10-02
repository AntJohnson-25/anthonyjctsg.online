// three.js view: renderer, sky, ocean, the yacht (merged static geometry),
// particles, and the per-frame camera. Characters, knives and the first-person
// hands live in models.js. Everything is procedural (canvas textures only), so
// bladed.html runs straight from file://.
globalThis.HK = globalThis.HK || {};
(function (HK) {
  "use strict";
  const THREE = globalThis.THREE;
  const M = HK.MAP;
  const V = { quality: "high" };

  const SUN = new THREE.Vector3(-0.55, 0.62, 0.56).normalize();
  const HORIZON = new THREE.Color(0xcfe2ea), ZENITH = new THREE.Color(0x3f7fc0);
  V.SUN = SUN;

  // ------------------------------------------------------------------ textures
  function canvasTex(w, h, draw) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }
  function rnd(seed) { let s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function noise(ctx, w, h, amt, seed) {
    const r = rnd(seed || 7), img = ctx.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (r() - 0.5) * amt;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }
  const TEX = {};
  function makeTextures() {
    TEX.teak = canvasTex(512, 512, function (g, w, h) {
      const r = rnd(11), rows = 16, ph = h / rows;
      for (let i = 0; i < rows; i++) {
        let x = -r() * 300;
        while (x < w) {
          const len = 220 + r() * 260, tone = r();
          g.fillStyle = "rgb(" + (150 + tone * 40 | 0) + "," + (95 + tone * 28 | 0) + "," + (52 + tone * 16 | 0) + ")";
          g.fillRect(x, i * ph, len, ph);
          g.strokeStyle = "rgba(70,40,20,0.25)"; g.lineWidth = 1;
          for (let k = 0; k < 5; k++) {
            g.beginPath();
            const y0 = i * ph + 3 + r() * (ph - 6);
            g.moveTo(x, y0);
            for (let s = 0; s <= len; s += 20) g.lineTo(x + s, y0 + Math.sin(s * 0.03 + k) * 1.5);
            g.stroke();
          }
          g.fillStyle = "#2a1c12"; g.fillRect(x + len - 2, i * ph, 2, ph);
          x += len;
        }
        g.fillStyle = "#1e140d"; g.fillRect(0, i * ph + ph - 3, w, 3);
      }
      noise(g, w, h, 14, 3);
    });
    TEX.tile = canvasTex(256, 256, function (g, w, h) {
      const r = rnd(5);
      g.fillStyle = "#e9f4f4"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 8; i++) for (let k = 0; k < 8; k++) {
        const t = r();
        g.fillStyle = "rgb(" + (40 + t * 30 | 0) + "," + (150 + t * 40 | 0) + "," + (180 + t * 30 | 0) + ")";
        g.fillRect(i * 32 + 2, k * 32 + 2, 28, 28);
      }
      noise(g, w, h, 10, 9);
    });
    TEX.carpet = canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = "#bfae90"; g.fillRect(0, 0, w, h); noise(g, w, h, 34, 4);
    });
    TEX.panel = canvasTex(256, 256, function (g, w, h) {
      const r = rnd(8);
      for (let i = 0; i < 8; i++) {
        const t = r();
        g.fillStyle = "rgb(" + (168 + t * 20 | 0) + "," + (130 + t * 16 | 0) + "," + (94 + t * 12 | 0) + ")";
        g.fillRect(i * 32, 0, 32, h);
        g.fillStyle = "rgba(70,45,20,0.35)"; g.fillRect(i * 32, 0, 1, h);
      }
      noise(g, w, h, 16, 2);
    });
    TEX.marble = canvasTex(512, 512, function (g, w, h) {
      const r = rnd(21);
      g.fillStyle = "#f2f0eb"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 26; i++) {
        g.strokeStyle = "rgba(120,120,125," + (0.08 + r() * 0.2) + ")"; g.lineWidth = 0.6 + r() * 2;
        g.beginPath(); let x = r() * w, y = r() * h; g.moveTo(x, y);
        for (let k = 0; k < 8; k++) { x += (r() - 0.3) * 90; y += (r() - 0.5) * 90; g.lineTo(x, y); }
        g.stroke();
      }
      noise(g, w, h, 6, 5);
    });
    TEX.crate = canvasTex(256, 256, function (g, w, h) {
      const r = rnd(31);
      for (let i = 0; i < 6; i++) {
        const t = r();
        g.fillStyle = "rgb(" + (150 + t * 30 | 0) + "," + (112 + t * 20 | 0) + "," + (66 + t * 10 | 0) + ")";
        g.fillRect(0, i * 43, w, 43);
        g.fillStyle = "rgba(40,25,10,0.55)"; g.fillRect(0, i * 43, w, 3);
      }
      g.strokeStyle = "rgba(60,40,15,0.9)"; g.lineWidth = 16; g.strokeRect(8, 8, w - 16, h - 16);
      g.lineWidth = 12; g.beginPath(); g.moveTo(12, 12); g.lineTo(w - 12, h - 12); g.stroke();
      g.fillStyle = "rgba(20,20,20,0.75)"; g.font = "bold 34px sans-serif"; g.fillText("CARGO", 70, 140);
      noise(g, w, h, 18, 6);
    });
    TEX.cushion = canvasTex(128, 128, function (g, w, h) {
      g.fillStyle = "#ece6d6"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#24365a"; g.fillRect(0, 56, w, 16);
      noise(g, w, h, 10, 8);
    });
    TEX.dot = canvasTex(64, 64, function (g, w, h) {
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.5, "rgba(255,255,255,0.8)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    TEX.dot.colorSpace = THREE.NoColorSpace;
    // Pirate flag: the user's CTSG seal (src/flag.js), else the skull below.
    if (HK.FLAG_IMG) {
      const img = new Image();
      TEX.flag = new THREE.Texture(img);
      TEX.flag.colorSpace = THREE.SRGBColorSpace;
      TEX.flag.anisotropy = 8;
      img.onload = function () { TEX.flag.needsUpdate = true; };
      img.src = HK.FLAG_IMG;
    }
    TEX.jolly = canvasTex(256, 170, function (g, w, h) {
      g.fillStyle = "#111214"; g.fillRect(0, 0, w, h);
      g.save(); g.translate(w / 2, h / 2 + 8);
      [-1, 1].forEach(function (s) {
        g.save(); g.rotate(s * 0.75);
        g.fillStyle = "#e8e6df"; g.beginPath(); g.moveTo(-70, -5); g.lineTo(42, -6); g.lineTo(62, 0); g.lineTo(42, 6); g.lineTo(-70, 5); g.fill();
        g.fillStyle = "#c8161d"; g.fillRect(-82, -6, 16, 12);
        g.restore();
      });
      g.fillStyle = "#efede6";
      g.beginPath(); g.arc(0, -16, 30, 0, Math.PI * 2); g.fill();
      g.fillRect(-17, 4, 34, 20);
      g.fillStyle = "#111214";
      g.beginPath(); g.arc(-11, -16, 8, 0, Math.PI * 2); g.arc(11, -16, 8, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(0, -6); g.lineTo(-4, 2); g.lineTo(4, 2); g.fill();
      for (let x = -12; x <= 12; x += 8) g.fillRect(x - 1, 12, 2, 12);
      g.restore();
      noise(g, w, h, 12, 4);
    });
    // The yacht's name across the stern.
    TEX.sternname = canvasTex(1024, 180, function (g, w, h) {
      g.clearRect(0, 0, w, h);
      g.textAlign = "center"; g.textBaseline = "middle";
      g.font = "bold 118px 'Bahnschrift', 'Arial Black', sans-serif";
      g.fillStyle = "#1c2d4d"; g.fillText("B L A D E D", w / 2, 78);
      g.font = "600 34px 'Bahnschrift', 'Arial', sans-serif";
      g.fillStyle = "#b08a3c"; g.fillText("G E O R G E   T O W N", w / 2, 152);
    });
    TEX.sternname.wrapS = TEX.sternname.wrapT = THREE.ClampToEdgeWrapping;
    // Navy ensign: blue field, white cross, gold knife.
    TEX.ensign = canvasTex(192, 128, function (g, w, h) {
      g.fillStyle = "#1c2d4d"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#f2f1ec"; g.fillRect(0, h / 2 - 9, w, 18); g.fillRect(w * 0.36 - 9, 0, 18, h);
      g.fillStyle = "#c8161d"; g.fillRect(0, h / 2 - 4, w, 8); g.fillRect(w * 0.36 - 4, 0, 8, h);
      g.fillStyle = "#d8a64a"; g.beginPath(); g.moveTo(w * 0.62, h * 0.72); g.lineTo(w * 0.9, h * 0.28); g.lineTo(w * 0.86, h * 0.26); g.closePath(); g.fill();
      noise(g, w, h, 10, 6);
    });
  }

  // ------------------------------------------------------------------ materials
  const MATDEF = {
    teak: { color: 0xffffff, tex: "teak", rough: 0.7, uv: 1 / 2.4 },
    paint: { color: 0xf2f1ec, rough: 0.3 },
    hull: { color: 0xf5f5f2, rough: 0.22, metal: 0.05 },
    navy: { color: 0x1c2d4d, rough: 0.3 },
    tint: { color: 0x1a2733, rough: 0.06, metal: 0.65 },
    glass: { color: 0xd7f0f6, rough: 0.04, metal: 0.1, opacity: 0.2 },
    chrome: { color: 0xe3e7ea, rough: 0.16, metal: 1.0 },
    carpet: { color: 0xffffff, tex: "carpet", rough: 0.95, uv: 1 / 2, env: 0.3 },
    panel: { color: 0xffffff, tex: "panel", rough: 0.6, uv: 1 / 3, env: 0.3 },
    ceiling: { color: 0xd6cdbd, rough: 0.95, env: 0.12 },
    leather: { color: 0xe6d9c3, rough: 0.55, env: 0.5 },
    darkwood: { color: 0x4b2f1f, rough: 0.45, env: 0.5 },
    marble: { color: 0xffffff, tex: "marble", rough: 0.18, uv: 1 / 3 },
    steel: { color: 0xb8bdc2, rough: 0.32, metal: 0.85 },
    tile: { color: 0xffffff, tex: "tile", rough: 0.25, uv: 1 },
    cushion: { color: 0xffffff, tex: "cushion", rough: 0.85, uv: 1 / 1.2 },
    crate: { color: 0xffffff, tex: "crate", rough: 0.8, uv: 1 / 1.25 },
    planter: { color: 0x34383c, rough: 0.6 },
    plant: { color: 0x3f7a35, rough: 0.8 },
    light: { color: 0xfff6e0, emissive: 0xfff1d0, emissiveI: 1.3, env: 0 },
    darkpanel: { color: 0x23272c, rough: 0.4, metal: 0.4 },
    screen: { color: 0x0a1a24, emissive: 0x2a8fbf, emissiveI: 0.9 },
    fabric: { color: 0xf3efe6, rough: 0.9, side: true },
    rubber: { color: 0x1d1f22, rough: 0.9 },
    orange: { color: 0xe8541c, rough: 0.5 },
    red: { color: 0xc8231c, rough: 0.5 },
    green: { color: 0x2fb03c, emissive: 0x2fb03c, emissiveI: 1.2 },
    redlight: { color: 0xd81b1b, emissive: 0xff2a1a, emissiveI: 1.4 },
    bottle: { color: 0x5b7a3a, rough: 0.1, metal: 0.2, opacity: 0.85 },
    gold: { color: 0xd8a64a, rough: 0.3, metal: 1.0 },
    // The pirate boarding boat.
    pirate: { color: 0x2a2e33, rough: 0.38, metal: 0.35 },
    boatdeck: { color: 0x5d6266, rough: 0.92, env: 0.3 },
    redstripe: { color: 0xa3161b, rough: 0.4 },
    drum: { color: 0x8e2a1e, rough: 0.45, metal: 0.45 },
    rope: { color: 0xc9b48a, rough: 0.95, env: 0.2 },
    dome: { color: 0xf4f4f0, rough: 0.35 }
  };
  const MAT = {};
  function material(key) {
    if (MAT[key]) return MAT[key];
    const d = MATDEF[key] || MATDEF.paint;
    const m = new THREE.MeshStandardMaterial({
      color: d.color, roughness: d.rough !== undefined ? d.rough : 0.5, metalness: d.metal || 0,
      map: d.tex ? TEX[d.tex] : null
    });
    if (d.emissive) { m.emissive = new THREE.Color(d.emissive); m.emissiveIntensity = d.emissiveI || 1; }
    if (d.opacity !== undefined) { m.transparent = true; m.opacity = d.opacity; m.depthWrite = false; }
    if (d.side) m.side = THREE.DoubleSide;
    if (d.env !== undefined) m.envMapIntensity = d.env;
    MAT[key] = m;
    return m;
  }
  V.material = material;

  // ------------------------------------------------------------------ static merge
  function Merger() { this.groups = {}; }
  Merger.prototype.push = function (key, pos, nor, from, to) {
    const grp = this.groups[key] || (this.groups[key] = { pos: [], nor: [], uv: [] });
    const s = (MATDEF[key] && MATDEF[key].uv) || 1;
    for (let i = from * 3; i < to * 3; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2], nx = nor[i], ny = nor[i + 1], nz = nor[i + 2];
      grp.pos.push(x, y, z); grp.nor.push(nx, ny, nz);
      const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
      if (ay >= ax && ay >= az) grp.uv.push(x * s, z * s);
      else if (ax >= az) grp.uv.push(z * s, y * s);
      else grp.uv.push(x * s, y * s);
    }
  };
  Merger.prototype.add = function (key, geo, matrix) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    this.push(key, g.attributes.position.array, g.attributes.normal.array, 0, g.attributes.position.count);
    g.dispose();
  };
  Merger.prototype.addBox = function (b) {
    const g = new THREE.BoxGeometry(b.hx * 2, b.maxy - b.miny, b.hz * 2).toNonIndexed();
    const m = new THREE.Matrix4().makeRotationY(-b.yaw).setPosition(b.cx, (b.miny + b.maxy) / 2, b.cz);
    g.applyMatrix4(m);
    const pos = g.attributes.position.array, nor = g.attributes.normal.array;
    for (let f = 0; f < 6; f++) {
      const key = f === 2 ? (b.top || b.mat) : f === 3 ? (b.bottom || b.mat) : (b.side || b.mat);
      this.push(key, pos, nor, f * 6, f * 6 + 6);
    }
    g.dispose();
  };
  Merger.prototype.build = function (parent) {
    const meshes = [];
    for (const key in this.groups) {
      const grp = this.groups[key];
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(grp.pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(grp.nor, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(grp.uv, 2));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, material(key));
      const transparent = MATDEF[key] && MATDEF[key].opacity !== undefined;
      mesh.castShadow = !transparent && key !== "light";
      mesh.receiveShadow = !transparent;
      if (transparent) mesh.renderOrder = 2;
      parent.add(mesh);
      meshes.push(mesh);
    }
    return meshes;
  };

  const TMP = new THREE.Matrix4(), Q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
  function at(x, y, z, ry, sx, sy, sz) {
    const m = new THREE.Matrix4().makeRotationY(ry || 0);
    if (sx) m.scale(new THREE.Vector3(sx, sy, sz));
    return m.setPosition(x, y, z);
  }
  // A cylinder from point a to point b.
  function rod(mg, key, ax, ay, az, bx, by, bz, r, seg) {
    const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
    const d = b.clone().sub(a), len = d.length();
    const g = new THREE.CylinderGeometry(r, r, len, seg || 8, 1, false);
    Q.setFromUnitVectors(UP, d.normalize());
    TMP.compose(a.clone().add(b).multiplyScalar(0.5), Q, new THREE.Vector3(1, 1, 1));
    mg.add(key, g, TMP);
    g.dispose();
  }

  // ------------------------------------------------------------------ the yacht
  function flare(g, from) {
    // Hull narrows below the deck line toward the keel.
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < from) {
        const u = Math.min(1, (from - y) / 3.4);
        const k = 1 - 0.28 * u * u;
        p.setZ(i, p.getZ(i) * k);
        if (p.getX(i) < -30) p.setX(i, -30 + (p.getX(i) + 30) * (1 - 0.15 * u));
      }
    }
    g.computeVertexNormals();
  }
  function shapeOf(pts) {
    const s = new THREE.Shape();
    pts.forEach(function (p, i) { if (i === 0) s.moveTo(p[0], p[1]); else s.lineTo(p[0], p[1]); });
    s.closePath();
    return s;
  }
  function extrudeDown(shape, top, depth) {
    const g = new THREE.ExtrudeGeometry(shape, { depth: depth, bevelEnabled: false, curveSegments: 4 });
    g.rotateX(Math.PI / 2);
    g.translate(0, top, 0);
    return g;
  }

  function buildYacht(scene) {
    const group = new THREE.Group();
    const mg = new Merger();
    M.boxes.forEach(function (b) { if (b.vis !== false) mg.addBox(b); });

    // Deck: one extruded slab with the stairwell and pool holes.
    const deckShape = shapeOf(M.outline(0));
    M.deckHoles.forEach(function (h) {
      const p = new THREE.Path();
      p.moveTo(h.x0, h.z0); p.lineTo(h.x1, h.z0); p.lineTo(h.x1, h.z1); p.lineTo(h.x0, h.z1); p.closePath();
      deckShape.holes.push(p);
    });
    const deck = extrudeDown(deckShape, 0, 0.3);
    {
      const g = deck.index ? deck.toNonIndexed() : deck;
      const pos = g.attributes.position.array, nor = g.attributes.normal.array;
      // Caps get teak, the slab edges get paint.
      for (let v = 0; v < g.attributes.position.count; v += 3) {
        const key = Math.abs(nor[v * 3 + 1]) > 0.5 ? (nor[v * 3 + 1] > 0 ? "teak" : "ceiling") : "paint";
        mg.push(key, pos, nor, v, v + 3);
      }
      g.dispose();
    }
    // Hull with flare, rub rail and a navy boot stripe.
    const hull = extrudeDown(shapeOf(M.outline(-0.1)), -0.07, 5.4);
    flare(hull, -2.6);
    mg.add("hull", hull);
    const rub = extrudeDown(shapeOf(M.outline(-0.16)), -0.04, 0.22);
    mg.add("chrome", rub);
    const stripe = extrudeDown(shapeOf(M.outline(-0.12)), -3.7, 0.55);
    flare(stripe, -2.6);
    mg.add("navy", stripe);
    const stripe2 = extrudeDown(shapeOf(M.outline(-0.13)), -0.6, 0.12);
    mg.add("navy", stripe2);
    // Hull windows for the lower-deck saloon.
    [-1, 1].forEach(function (s) {
      for (let x = -19; x < 19; x += 4.2) mg.add("tint", new THREE.BoxGeometry(3.6, 0.65, 0.06), at(x + 1.8, -1.95, s * 9.11));
    });
    // Portholes along the bow hull, and the anchors in their pockets.
    [-1, 1].forEach(function (s) {
      for (let x = 23; x <= 33; x += 2.5) {
        const w = M.halfWidth(x) + 0.02, dw = (M.halfWidth(x + 0.5) - M.halfWidth(x - 0.5));
        const m = new THREE.Matrix4().makeRotationY(Math.atan2(dw, 1) * -s).premultiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
        mg.add("chrome", new THREE.CylinderGeometry(0.24, 0.24, 0.05, 16), m.clone().setPosition(x, -1.5, s * w));
        mg.add("tint", new THREE.CylinderGeometry(0.18, 0.18, 0.07, 16), m.clone().setPosition(x, -1.5, s * w));
      }
      const ax = 35.2, aw = M.halfWidth(ax) + 0.04;
      mg.add("darkpanel", new THREE.BoxGeometry(0.9, 0.9, 0.08), new THREE.Matrix4().makeRotationY(s * 0.5).setPosition(ax, -0.75, s * aw));
      mg.add("steel", new THREE.BoxGeometry(0.16, 0.7, 0.12), new THREE.Matrix4().makeRotationY(s * 0.5).setPosition(ax, -0.8, s * (aw + 0.05)));
      mg.add("steel", new THREE.TorusGeometry(0.28, 0.05, 6, 12, Math.PI), new THREE.Matrix4().makeRotationZ(Math.PI).premultiply(new THREE.Matrix4().makeRotationY(s * 0.5)).setPosition(ax, -1.05, s * (aw + 0.05)));
    });

    // The pirate boarding boat: deck slab, gunmetal hull with a red boot stripe.
    if (M.BOAT) {
      const B = M.BOAT, bcz = (B.z0 + B.z1) / 2;
      const flareAbout = function (g, from) {
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const y = p.getY(i);
          if (y < from) {
            const u = Math.min(1, (from - y) / 2.4), k = 1 - 0.38 * u * u;
            p.setZ(i, bcz + (p.getZ(i) - bcz) * k);
          }
        }
        g.computeVertexNormals();
      };
      const bdeck = extrudeDown(shapeOf(M.boatOutline(0)), B.y, 0.3);
      {
        const g = bdeck.index ? bdeck.toNonIndexed() : bdeck;
        const pos = g.attributes.position.array, nor = g.attributes.normal.array;
        for (let v = 0; v < g.attributes.position.count; v += 3) {
          const key = Math.abs(nor[v * 3 + 1]) > 0.5 ? (nor[v * 3 + 1] > 0 ? "boatdeck" : "pirate") : "pirate";
          mg.push(key, pos, nor, v, v + 3);
        }
        g.dispose();
      }
      const bhull = extrudeDown(shapeOf(M.boatOutline(-0.06)), B.y - 0.02, 3.6);
      flareAbout(bhull, B.y - 0.9);
      mg.add("pirate", bhull);
      const bstripe = extrudeDown(shapeOf(M.boatOutline(-0.09)), B.y - 0.32, 0.26);
      mg.add("redstripe", bstripe);
      // A red cap rail along the gunwale.
      const pts = M.boatOutline(0.09);
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (a[1] > B.z0 - 0.2 && b[1] > B.z0 - 0.2) continue;   // open yacht side
        rod(mg, "redstripe", a[0], B.y + 0.52, a[1], b[0], B.y + 0.52, b[1], 0.07, 6);
      }
      rod(mg, "redstripe", pts[0][0], B.y + 0.52, pts[0][1], pts[0][0], B.y + 0.52, B.z0 + 0.1, 0.07, 6);
    }

    // Decor.
    M.decor.forEach(function (d) {
      switch (d.kind) {
        case "railcap": {
          rod(mg, "chrome", d.x0, d.y, d.z0, d.x1, d.y, d.z1, 0.03);
          const len = Math.hypot(d.x1 - d.x0, d.z1 - d.z0), n = Math.max(1, Math.round(len / 1.8));
          for (let i = 0; i <= n; i++) {
            const u = i / n, x = d.x0 + (d.x1 - d.x0) * u, z = d.z0 + (d.z1 - d.z0) * u;
            rod(mg, "chrome", x, d.y - 1.12, z, x, d.y, z, 0.022, 6);
          }
          break;
        }
        case "lounger": {
          const zc = (d.z0 + d.z1) / 2, len = d.z1 - d.z0;
          mg.add("darkwood", new THREE.BoxGeometry(0.78, 0.22, len), at(d.x, 0.11, zc));
          mg.add("cushion", new THREE.BoxGeometry(0.74, 0.14, len * 0.66), at(d.x, 0.29, zc - d.s * len * 0.15));
          mg.add("cushion", new THREE.BoxGeometry(0.74, 0.12, 0.72), new THREE.Matrix4().makeRotationX(-d.s * 0.75).setPosition(d.x, 0.52, zc + d.s * len * 0.33));
          break;
        }
        case "stool":
          rod(mg, "chrome", d.x, d.y, d.z, d.x, d.y + 0.72, d.z, 0.03);
          mg.add("leather", new THREE.CylinderGeometry(0.2, 0.18, 0.08, 14), at(d.x, d.y + 0.75, d.z));
          mg.add("chrome", new THREE.CylinderGeometry(0.2, 0.2, 0.02, 14), at(d.x, d.y + 0.01, d.z));
          break;
        case "plant":
          for (let i = 0; i < 5; i++) {
            const a = i * 1.26;
            mg.add("plant", new THREE.ConeGeometry(0.22, 1.1, 6), new THREE.Matrix4().makeRotationZ(Math.cos(a) * 0.3).premultiply(new THREE.Matrix4().makeRotationY(a)).setPosition(d.x + Math.cos(a) * 0.2, d.y + 0.5, d.z + Math.sin(a) * 0.2));
          }
          break;
        case "canopy": {
          mg.add("fabric", new THREE.BoxGeometry(d.x1 - d.x0, 0.05, d.z1 - d.z0), at((d.x0 + d.x1) / 2, d.y, (d.z0 + d.z1) / 2));
          [[d.x0, d.z0], [d.x0, d.z1]].forEach(function (c) { rod(mg, "chrome", c[0], 0, c[1], c[0], d.y, c[1], 0.05); rod(mg, "chrome", c[0], d.y - 0.02, c[1], d.x1, d.y - 0.02, c[1], 0.03); });
          break;
        }
        case "bottles":
          for (let x = d.x0; x <= d.x1; x += 0.28) {
            mg.add((x * 7 | 0) % 3 ? "bottle" : "gold", new THREE.CylinderGeometry(0.04, 0.045, 0.3, 8), at(x, d.y + 0.15, d.z));
            mg.add("bottle", new THREE.CylinderGeometry(0.04, 0.045, 0.28, 8), at(x + 0.12, d.y + 0.75, d.z));
          }
          mg.add("darkwood", new THREE.BoxGeometry(d.x1 - d.x0 + 0.5, 0.04, 0.4), at((d.x0 + d.x1) / 2, d.y + 0.6, d.z));
          break;
        case "chair":
          mg.add("leather", new THREE.BoxGeometry(0.45, 0.08, 0.45), at(d.x, 0.47, d.z));
          mg.add("leather", new THREE.BoxGeometry(0.45, 0.5, 0.07), new THREE.Matrix4().makeRotationY(d.yaw).setPosition(d.x, 0.75, d.z + (d.z > 0 ? 0.22 : -0.22)));
          rod(mg, "chrome", d.x, 0, d.z, d.x, 0.45, d.z, 0.03);
          break;
        case "tv":
          mg.add("rubber", new THREE.BoxGeometry(0.06, 1.0, 1.8), at(d.x, d.y, d.z));
          mg.add("screen", new THREE.BoxGeometry(0.02, 0.9, 1.7), at(d.x - 0.04, d.y, d.z));
          break;
        case "handrail":
          rod(mg, "chrome", d.x0, d.y0 + 0.95, d.z, d.x1, d.y1 + 0.95, d.z, 0.03);
          for (let i = 0; i <= 4; i++) {
            const u = i / 4, x = d.x0 + (d.x1 - d.x0) * u, y = d.y0 + (d.y1 - d.y0) * u;
            rod(mg, "chrome", x, y, d.z, x, y + 0.95, d.z, 0.02, 6);
          }
          break;
        case "lifering":
          mg.add("orange", new THREE.TorusGeometry(0.3, 0.07, 8, 18), new THREE.Matrix4().makeRotationY(Math.PI / 2 + d.yaw).setPosition(d.x, d.y, d.z));
          break;
        case "helm":
          mg.add("darkwood", new THREE.TorusGeometry(0.25, 0.03, 6, 20), new THREE.Matrix4().makeRotationY(Math.PI / 2).premultiply(new THREE.Matrix4().makeRotationZ(-0.4)).setPosition(d.x, d.y + 0.15, d.z));
          mg.add("screen", new THREE.BoxGeometry(0.05, 0.4, 1.4), new THREE.Matrix4().makeRotationZ(0.5).setPosition(d.x + 0.5, d.y + 0.05, d.z));
          break;
        case "captainchair":
          mg.add("leather", new THREE.BoxGeometry(0.6, 0.12, 0.6), at(d.x, d.y + 0.6, d.z));
          mg.add("leather", new THREE.BoxGeometry(0.1, 0.8, 0.6), at(d.x - 0.3, d.y + 1.05, d.z));
          rod(mg, "chrome", d.x, d.y, d.z, d.x, d.y + 0.55, d.z, 0.05);
          break;
        case "mast":
          mg.add("paint", new THREE.CylinderGeometry(0.08, 0.16, 3.2, 10), at(d.x, d.y + 1.6, d.z));
          mg.add("paint", new THREE.BoxGeometry(0.3, 0.12, 2.4), at(d.x, d.y + 2.2, d.z));
          mg.add("darkpanel", new THREE.BoxGeometry(0.25, 0.1, 1.6), at(d.x, d.y + 3.0, d.z));
          mg.add("green", new THREE.SphereGeometry(0.07, 8, 6), at(d.x, d.y + 3.25, d.z));
          break;
        case "tender": {
          const L = d.x1 - d.x0, W2 = (d.z1 - d.z0) / 2, cx = d.x0 + L / 2, cz = (d.z0 + d.z1) / 2;
          const s = new THREE.Shape();
          s.moveTo(-L / 2, -W2 + 0.2); s.lineTo(L / 2 - 1.4, -W2); s.quadraticCurveTo(L / 2, -W2 * 0.6, L / 2 + 0.1, 0);
          s.quadraticCurveTo(L / 2, W2 * 0.6, L / 2 - 1.4, W2); s.lineTo(-L / 2, W2 - 0.2); s.closePath();
          const hullT = new THREE.ExtrudeGeometry(s, { depth: 0.9, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 2 });
          hullT.rotateX(-Math.PI / 2);
          hullT.translate(cx, d.y + 0.55, cz);
          mg.add("hull", hullT);
          mg.add("navy", new THREE.BoxGeometry(L - 1.2, 0.3, W2 * 2 - 0.4), at(cx - 0.4, d.y + 1.55, cz));
          mg.add("tint", new THREE.BoxGeometry(0.6, 0.35, W2 * 2 - 0.8), new THREE.Matrix4().makeRotationZ(-0.5).setPosition(cx + 0.9, d.y + 1.7, cz));
          [cx - 1.6, cx + 1.4].forEach(function (x) { mg.add("darkwood", new THREE.BoxGeometry(0.4, 0.55, W2 * 2 - 0.6), at(x, d.y + 0.27, cz)); });
          break;
        }
        case "bowlight":
          rod(mg, "chrome", d.x, 0, d.z, d.x, d.y, d.z, 0.04);
          mg.add("light", new THREE.SphereGeometry(0.09, 8, 6), at(d.x, d.y + 0.05, d.z));
          break;
        // ---- the pirate boat
        case "ramprail":
          [-1, 1].forEach(function (s) {
            const x = d.x + s * (d.w / 2 + 0.04);
            rod(mg, "rope", x, d.y0 + 0.95, d.z0, x, d.y1 + 0.95, d.z1, 0.025, 6);
            [0, 0.5, 1].forEach(function (u) {
              const z = d.z0 + (d.z1 - d.z0) * u, y = d.y0 + (d.y1 - d.y0) * u;
              rod(mg, "steel", x, y - 0.25, z, x, y + 0.98, z, 0.03, 6);
            });
          });
          break;
        case "outboards":
          [-1.1, 1.1].forEach(function (dz) {
            const z = d.z + dz;
            mg.add("pirate", new THREE.BoxGeometry(0.75, 1.0, 0.62), at(d.x - 0.55, d.y + 0.35, z));
            mg.add("redstripe", new THREE.BoxGeometry(0.77, 0.12, 0.64), at(d.x - 0.55, d.y + 0.62, z));
            mg.add("steel", new THREE.BoxGeometry(0.22, 1.9, 0.12), at(d.x - 0.6, d.y - 1.1, z));
            mg.add("steel", new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8), new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(d.x - 0.75, d.y - 2.0, z));
          });
          break;
        case "drum":
          mg.add("drum", new THREE.CylinderGeometry(0.3, 0.3, 0.92, 14), at(d.x, d.y + 0.46, d.z));
          [0.2, 0.72].forEach(function (h) { mg.add("pirate", new THREE.TorusGeometry(0.3, 0.025, 4, 16), new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(d.x, d.y + h, d.z)); });
          break;
        case "fender":
          mg.add("navy", new THREE.CylinderGeometry(0.17, 0.17, 0.75, 12), at(d.x, d.y, d.z));
          rod(mg, "rope", d.x, d.y + 0.37, d.z, d.x, 0.95, d.z + 0.15, 0.015, 4);
          break;
        case "mooring":
          rod(mg, "rope", d.x, d.y, d.z, d.tx, d.ty, d.tz, 0.03, 6);
          mg.add("steel", new THREE.BoxGeometry(0.35, 0.12, 0.12), at(d.x, d.y - 0.02, d.z));
          break;
        case "boatflag": {
          // The CTSG seal on black (HK.FLAG_IMG from src/flag.js), else a skull.
          rod(mg, "steel", d.x, d.y, d.z, d.x, d.y + 3.6, d.z, 0.04, 6);
          mg.add("steel", new THREE.SphereGeometry(0.07, 8, 6), at(d.x, d.y + 3.62, d.z));
          // At anchor the bow points into the wind, so flags fly aft (-x).
          clothFlag(group, TEX.flag || TEX.jolly, 1.8, 1.2, d.x - 0.03, d.y + 2.95, d.z, Math.PI - 0.3, 1.3);
          break;
        }
        // ---- yacht details
        case "sternname": {
          const plate = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 1.25), new THREE.MeshStandardMaterial({ map: TEX.sternname, transparent: true, roughness: 0.3, metalness: 0.6 }));
          plate.position.set(d.x, d.y, d.z);
          plate.rotation.y = -Math.PI / 2;
          group.add(plate);
          break;
        }
        case "ensign": {
          rod(mg, "chrome", d.x, d.y, d.z, d.x, d.y + 2.6, d.z, 0.035, 6);
          clothFlag(group, TEX.ensign, 1.2, 0.8, d.x - 0.02, d.y + 2.2, d.z, Math.PI + 0.2, 4.1);
          break;
        }
        case "navlight":
          mg.add("paint", new THREE.BoxGeometry(0.3, 0.22, 0.12), at(d.x, d.y, d.z));
          mg.add(d.c, new THREE.SphereGeometry(0.08, 8, 6), at(d.x + 0.08, d.y, d.z + (d.z < 0 ? -0.07 : 0.07)));
          break;
        case "dome":
          rod(mg, "paint", d.x, d.y, d.z, d.x, d.y + 0.35, d.z, 0.06, 8);
          mg.add("dome", new THREE.SphereGeometry(d.r, 16, 10), at(d.x, d.y + 0.35 + d.r * 0.85, d.z));
          break;
        case "spot":
          mg.add("chrome", new THREE.CylinderGeometry(0.12, 0.09, 0.22, 10), new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(d.x, d.y, d.z));
          mg.add("light", new THREE.CircleGeometry(0.1, 10), new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(d.x + 0.115, d.y, d.z));
          break;
      }
    });
    V.yachtMeshes = mg.build(group);

    // Water in the pool and the hot tub.
    M.water.forEach(function (w) {
      const g = new THREE.PlaneGeometry(w.x1 - w.x0, w.z1 - w.z0, 1, 1);
      g.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({ color: w.kind === "tub" ? 0x1f8ea3 : 0x0f7f9e, roughness: 0.12, metalness: 0.0, transparent: true, opacity: 0.8, envMapIntensity: 0.35 });
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.set((w.x0 + w.x1) / 2, w.y, (w.z0 + w.z1) / 2);
      mesh.renderOrder = 3;
      group.add(mesh);
    });
    // Warm lights below deck and in the lounge.
    M.lights.forEach(function (l) {
      const pl = new THREE.PointLight(l.color, 9, l.d, 1.1);
      pl.position.set(l.x, l.y, l.z);
      group.add(pl);
    });
    const lounge = new THREE.PointLight(0xffe2b8, 18, 16, 1.3);
    lounge.position.set(0, 2.6, 0);
    group.add(lounge);
    scene.add(group);
    return group;
  }

  // ------------------------------------------------------------------ flags
  // Cloth that sways in the breeze: a subdivided plane hinged at the pole,
  // rippled each frame (travelling waves that grow toward the free end).
  const FLAGS = [];
  function clothFlag(group, tex, w, h, x, y, z, yaw, seed) {
    const g = new THREE.PlaneGeometry(w, h, 18, 9);
    g.translate(w / 2, 0, 0);   // hinge on the pole
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, side: THREE.FrontSide, roughness: 0.92 }));
    // The back face gets a mirrored copy so the design reads right from both sides.
    const back = tex.clone();
    back.wrapS = THREE.RepeatWrapping; back.repeat.x = -1; back.offset.x = 1;
    back.needsUpdate = true;
    mesh.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: back, side: THREE.BackSide, roughness: 0.92 })));
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    mesh.castShadow = true;
    group.add(mesh);
    FLAGS.push({ mesh: mesh, base: Float32Array.from(g.attributes.position.array), w: w, h: h, seed: seed || 0 });
    return mesh;
  }
  // Art staging: turn every flag to fly toward a world yaw (null = as built).
  V.setFlagYaw = function (yaw) {
    FLAGS.forEach(function (f) {
      if (f.yaw0 === undefined) f.yaw0 = f.mesh.rotation.y;
      f.mesh.rotation.y = yaw === null ? f.yaw0 : yaw;
    });
  };
  function swayFlags(t) {
    for (let i = 0; i < FLAGS.length; i++) {
      const f = FLAGS[i], p = f.mesh.geometry.attributes.position, b = f.base, a = p.array;
      const gust = 0.75 + 0.25 * Math.sin(t * 0.7 + f.seed);
      for (let k = 0; k < p.count; k++) {
        const x = b[k * 3], y = b[k * 3 + 1], u = x / f.w;
        const wave = Math.sin(x * 4.2 - t * 6.5 + f.seed) * 0.6 + Math.sin(x * 7.1 - t * 9.3 + y * 2.0 + f.seed * 2) * 0.25;
        a[k * 3] = x * (1 - 0.04 * u * gust);                                   // cloth shortens as it ripples
        a[k * 3 + 1] = y - u * u * 0.08 * (1.2 - gust);                          // droops when the wind drops
        a[k * 3 + 2] = wave * 0.16 * u * gust * f.w;
      }
      p.needsUpdate = true;
      f.mesh.geometry.computeVertexNormals();
    }
  }

  // ------------------------------------------------------------------ sky + ocean
  function skyMaterial() {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { uSun: { value: SUN }, uHorizon: { value: HORIZON }, uZenith: { value: ZENITH } },
      vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }",
      fragmentShader: [
        "uniform vec3 uSun; uniform vec3 uHorizon; uniform vec3 uZenith; varying vec3 vDir;",
        "void main(){ vec3 d = normalize(vDir); float h = clamp(d.y, -1.0, 1.0);",
        " vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.55));",
        " col = mix(col, uHorizon * 0.82, smoothstep(0.0, -0.2, h));",
        " float s = max(dot(d, uSun), 0.0);",
        " col += vec3(1.0, 0.86, 0.62) * (pow(s, 12.0) * 0.25 + pow(s, 300.0) * 1.2);",
        " col += vec3(1.0, 0.98, 0.9) * smoothstep(0.9993, 0.9996, s) * 6.0;",
        " gl_FragColor = vec4(col, 1.0);",
        " #include <tonemapping_fragment>",
        " #include <colorspace_fragment>",
        "}"
      ].join("\n")
    });
  }

  function oceanMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uSun: { value: SUN }, uHorizon: { value: HORIZON }, uZenith: { value: ZENITH },
        uDeep: { value: new THREE.Color(0x0b3a55) }, uShallow: { value: new THREE.Color(0x1d7d93) }
      },
      vertexShader: [
        "uniform float uTime; varying vec3 vW; varying vec3 vN;",
        "void wave(vec2 p, vec2 d, float a, float l, float s, inout float h, inout vec2 g){",
        "  float k = 6.2831853 / l; float f = k * dot(d, p) + s * uTime;",
        "  h += a * sin(f); g += a * k * cos(f) * d; }",
        "void main(){ vec4 w = modelMatrix * vec4(position, 1.0); float h = 0.0; vec2 g = vec2(0.0);",
        " wave(w.xz, normalize(vec2(1.0, 0.35)), 0.22, 34.0, 0.9, h, g);",
        " wave(w.xz, normalize(vec2(-0.4, 1.0)), 0.12, 19.0, 1.3, h, g);",
        " wave(w.xz, normalize(vec2(0.8, -0.6)), 0.06, 11.0, 1.9, h, g);",
        " w.y += h; vN = normalize(vec3(-g.x, 1.0, -g.y)); vW = w.xyz;",
        " gl_Position = projectionMatrix * viewMatrix * w; }"
      ].join("\n"),
      fragmentShader: [
        "uniform float uTime; uniform vec3 uSun; uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uDeep; uniform vec3 uShallow;",
        "varying vec3 vW; varying vec3 vN;",
        "void main(){ vec2 q = vW.xz; vec3 n = vN;",
        " n.x += 0.05 * sin(q.x * 1.9 + uTime * 1.7 + sin(q.y * 1.1)) + 0.03 * sin(q.y * 3.7 - uTime * 2.3);",
        " n.z += 0.05 * sin(q.y * 1.6 - uTime * 1.4 + sin(q.x * 0.9)) + 0.03 * sin(q.x * 4.1 + uTime * 2.1);",
        " n = normalize(n);",
        " vec3 v = normalize(cameraPosition - vW); float dist = length(vW.xz - cameraPosition.xz);",
        " float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, v), 0.0), 5.0);",
        " vec3 r = reflect(-v, n); r.y = abs(r.y);",
        " vec3 sky = mix(uHorizon, uZenith, pow(clamp(r.y, 0.0, 1.0), 0.55));",
        " vec3 base = mix(uDeep, uShallow, clamp(0.35 + n.y * 0.2 - dot(n, v) * 0.1, 0.0, 1.0));",
        " vec3 col = mix(base, sky, fres);",
        " float s = max(dot(r, uSun), 0.0);",
        " col += vec3(1.0, 0.92, 0.75) * (pow(s, 400.0) * 4.0 + pow(s, 40.0) * 0.18);",
        " col = mix(col, uHorizon, smoothstep(120.0, 1100.0, dist));",
        " gl_FragColor = vec4(col, 1.0);",
        " #include <tonemapping_fragment>",
        " #include <colorspace_fragment>",
        "}"
      ].join("\n")
    });
  }

  function buildIslands(scene) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x4e6a4a, roughness: 1 });
    const rock = new THREE.MeshStandardMaterial({ color: 0x8c8172, roughness: 1 });
    [[620, -380, 140, 34], [760, 160, 220, 48], [-520, 610, 180, 40], [-840, -260, 260, 30], [180, 880, 120, 26]].forEach(function (s, i) {
      const g = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const a = Math.atan2(p.getZ(k), p.getX(k));
        const n = 1 + 0.18 * Math.sin(a * 3 + i) + 0.1 * Math.sin(a * 7 + i * 2);
        p.setX(k, p.getX(k) * n); p.setZ(k, p.getZ(k) * n);
      }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, i % 2 ? rock : mat);
      m.scale.set(s[2], s[3], s[2] * 0.6);
      m.position.set(s[0], M.WATER - 2, s[1]);
      m.rotation.y = i * 1.3;
      scene.add(m);
    });
  }

  // ------------------------------------------------------------------ particles
  const MAXP = 700;
  const PT = { pos: null, col: null, vel: new Float32Array(MAXP * 3), life: new Float32Array(MAXP), grav: new Float32Array(MAXP), n: 0, geo: null };
  function buildParticles(scene) {
    const g = new THREE.BufferGeometry();
    PT.pos = new Float32Array(MAXP * 3); PT.col = new Float32Array(MAXP * 3);
    g.setAttribute("position", new THREE.BufferAttribute(PT.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(PT.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const m = new THREE.PointsMaterial({ size: 0.09, vertexColors: true, map: TEX.dot, transparent: true, depthWrite: false, sizeAttenuation: true });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.renderOrder = 4;
    scene.add(pts);
    PT.geo = g;
  }
  function burst(x, y, z, n, color, speed, up, grav, life) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n && PT.n < MAXP; i++) {
      const k = PT.n++;
      PT.pos[k * 3] = x; PT.pos[k * 3 + 1] = y; PT.pos[k * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * 1.2;
      const s = speed * (0.4 + Math.random() * 0.8);
      PT.vel[k * 3] = Math.cos(a) * Math.cos(e) * s; PT.vel[k * 3 + 1] = Math.sin(e) * s + up; PT.vel[k * 3 + 2] = Math.sin(a) * Math.cos(e) * s;
      const v = 0.75 + Math.random() * 0.4;
      PT.col[k * 3] = c.r * v; PT.col[k * 3 + 1] = c.g * v; PT.col[k * 3 + 2] = c.b * v;
      PT.life[k] = life * (0.6 + Math.random() * 0.6); PT.grav[k] = grav;
    }
  }
  V.burst = burst;
  function updateParticles(dt) {
    for (let k = 0; k < PT.n; k++) {
      PT.life[k] -= dt;
      if (PT.life[k] <= 0) {
        const last = --PT.n;
        if (k !== last) {
          for (let j = 0; j < 3; j++) { PT.pos[k * 3 + j] = PT.pos[last * 3 + j]; PT.vel[k * 3 + j] = PT.vel[last * 3 + j]; PT.col[k * 3 + j] = PT.col[last * 3 + j]; }
          PT.life[k] = PT.life[last]; PT.grav[k] = PT.grav[last];
        }
        k--;
        continue;
      }
      PT.vel[k * 3 + 1] -= PT.grav[k] * dt;
      PT.pos[k * 3] += PT.vel[k * 3] * dt; PT.pos[k * 3 + 1] += PT.vel[k * 3 + 1] * dt; PT.pos[k * 3 + 2] += PT.vel[k * 3 + 2] * dt;
    }
    PT.geo.setDrawRange(0, PT.n);
    PT.geo.attributes.position.needsUpdate = true;
    PT.geo.attributes.color.needsUpdate = true;
  }

  // Splash rings on the sea.
  const rings = [];
  function ring(x, y, z) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.45, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y + 0.25, z);
    V.scene.add(m);
    rings.push({ m: m, t: 0 });
  }
  V.ring = ring;

  // ------------------------------------------------------------------ init
  V.init = function (canvas, quality) {
    makeTextures();
    V.TEX = TEX;
    const r = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: "high-performance" });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.autoClear = false;
    V.renderer = r;

    const scene = new THREE.Scene();
    V.scene = scene;
    scene.fog = new THREE.Fog(HORIZON.clone(), 260, 1300);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), skyMaterial());
    sky.frustumCulled = false;
    scene.add(sky);

    // Image-based light from the sky so chrome, glass and paint reflect it.
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), skyMaterial()));
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    pmrem.dispose();

    const hemi = new THREE.HemisphereLight(0xd8ecff, 0x6b5d4c, 0.55);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
    sun.position.copy(SUN).multiplyScalar(80);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    const sc = sun.shadow.camera;
    sc.left = -52; sc.right = 52; sc.top = 34; sc.bottom = -34; sc.near = 10; sc.far = 190;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    scene.add(sun); scene.add(sun.target);
    V.sun = sun;

    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400, 220, 220), oceanMaterial());
    ocean.geometry.rotateX(-Math.PI / 2);
    ocean.position.y = M.WATER;
    ocean.frustumCulled = false;
    scene.add(ocean);
    V.ocean = ocean;
    buildIslands(scene);
    V.yacht = buildYacht(scene);
    buildParticles(scene);

    V.camera = new THREE.PerspectiveCamera(74, 1, 0.05, 3000);
    V.camera.rotation.order = "YXZ";
    scene.add(V.camera);
    HK.Models.init(V);
    V.setQuality(quality || "high");
    V.resize();
  };

  V.setQuality = function (q) {
    V.quality = q;
    const dpr = window.devicePixelRatio || 1;
    V.renderer.setPixelRatio(q === "low" ? Math.min(dpr, 1) : q === "medium" ? Math.min(dpr, 1.5) : Math.min(dpr, 2));
    const sh = q !== "low";
    V.renderer.shadowMap.enabled = sh;
    V.sun.castShadow = sh;
    const size = q === "high" ? 2048 : 1024;
    if (V.sun.shadow.mapSize.x !== size) {
      V.sun.shadow.mapSize.set(size, size);
      if (V.sun.shadow.map) { V.sun.shadow.map.dispose(); V.sun.shadow.map = null; }
    }
    V.scene.traverse(function (o) { if (o.material && o.material.needsUpdate !== undefined) o.material.needsUpdate = true; });
    V.resize();
  };

  V.resize = function () {
    const w = window.innerWidth, h = window.innerHeight;
    V.renderer.setSize(w, h, false);
    V.camera.aspect = w / h;
    // Keep the horizontal view wide on portrait screens.
    V.baseFov = w < h ? 92 : 74;
    V.camera.updateProjectionMatrix();
    HK.Models.resize(w, h);
  };

  // cam: {x,y,z,yaw,pitch,roll,fovAdd}
  V.render = function (dt, t, cam) {
    V.ocean.material.uniforms.uTime.value = t;
    swayFlags(t);
    updateParticles(dt);
    for (let i = rings.length - 1; i >= 0; i--) {
      const g = rings[i];
      g.t += dt;
      g.m.scale.setScalar(1 + g.t * 5);
      g.m.material.opacity = Math.max(0, 0.8 - g.t * 0.9);
      if (g.t > 0.9) { V.scene.remove(g.m); g.m.geometry.dispose(); g.m.material.dispose(); rings.splice(i, 1); }
    }
    const c = V.camera;
    c.position.set(cam.x, cam.y, cam.z);
    c.rotation.set(cam.pitch, -cam.yaw - Math.PI / 2, cam.roll || 0);
    const fov = V.baseFov + (cam.fovAdd || 0);
    if (Math.abs(c.fov - fov) > 0.01) { c.fov = fov; c.updateProjectionMatrix(); }
    // Keep the shadow box centred on the yacht (it never moves).
    const r = V.renderer;
    r.clear();
    r.render(V.scene, c);
    HK.Models.renderViewmodel(r);
  };

  // World point -> CSS pixels (null if behind the camera).
  const PV = new THREE.Vector3();
  V.project = function (x, y, z) {
    PV.set(x, y, z).project(V.camera);
    if (PV.z > 1 || PV.z < -1) return null;
    return { x: (PV.x * 0.5 + 0.5) * window.innerWidth, y: (-PV.y * 0.5 + 0.5) * window.innerHeight, front: PV.z < 1 };
  };

  HK.View = V;
})(globalThis.HK);
