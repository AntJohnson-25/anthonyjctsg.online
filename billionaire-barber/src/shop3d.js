// The barbershop as a 3D room: one per kind of shop, so buying a shop moves you somewhere new.
//   rental  the rented chair in somebody else's worn little shop (4 chairs, theirs)
//   small   your first own place: compact, wood and navy, your name in neon (2 chairs)
//   medium  a real shop: brick, a lounge sofa and a TV (4 chairs)
//   large   the flagship: tall, black marble and gold, chandeliers, an espresso bar (6 chairs)
// Shop.build(kind, opts) returns the room (S.group) plus every spot World walks people to.
// Layout (metres, y up): the front (+Z) is open to the camera, like a doll's house. The back
// wall (-Z) is the storefront: glass, the door in the middle, the street outside. The chairs
// stand along both side walls facing the aisle, turned a little toward the camera; clients come
// in at the back and walk down the aisle, as in the 2D game. Bodies and chairs face -Z at yaw 0.
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const THREE = globalThis.THREE;

  // ------------------------------------------------------------------ the four rooms
  const KINDS = {
    rental: {
      W: 7.2, D: 8, H: 3.2, rows: 2, perRow: 2, name: "CORNER CUTS", sub: "CHAIRS FOR RENT",
      floor: "checker", floorA: "#e9e4d8", floorB: "#1d1d1f", worn: 0.5,
      wall: "#3e6656", wallLow: "#3a2a20", trim: "#8a6a3a",
      chair: { seat: "#8e1f1f", metal: 0xc9cdd2, gold: false },
      frame: "#5b4632", lamp: "tube", sign: "#ff5a3c", accent: "#e2c46a",
      warm: 0xfff1d6, keyI: 2.1, hemiI: 0.9, decor: ["posters", "rentsign", "radiator", "plant"]
    },
    small: {
      W: 8, D: 7.6, H: 3.3, rows: 1, perRow: 2, name: "BILLIONAIRE BARBER", sub: "",
      floor: "planks", floorA: "#8a5a34", floorB: "#6c4326",
      wall: "#1f2f4f", wallLow: "#d8c9a8", trim: "#c9a227",
      chair: { seat: "#151515", metal: 0xd4d8dc, gold: false },
      frame: "#c9a227", lamp: "edison", sign: "#ffd27a", accent: "#c9a227",
      warm: 0xffd9a0, keyI: 1.9, hemiI: 0.75, decor: ["plants", "frames", "records", "armchair"]
    },
    medium: {
      W: 10, D: 10, H: 3.6, rows: 2, perRow: 2, name: "BILLIONAIRE BARBER", sub: "",
      floor: "tiles", floorA: "#cfc8bc", floorB: "#b9b1a4",
      wall: "brick", wallLow: "#2a2420", trim: "#c9a227",
      chair: { seat: "#2a1a12", metal: 0xc9a227, gold: true },
      frame: "#c9a227", lamp: "track", sign: "#ffcf5a", accent: "#c9a227",
      warm: 0xffe6c0, keyI: 2.0, hemiI: 0.8, decor: ["lounge", "tv", "shelves", "plants", "rug"]
    },
    large: {
      W: 13, D: 13.6, H: 4.6, rows: 3, perRow: 2, name: "BILLIONAIRE BARBER", sub: "FLAGSHIP",
      floor: "marble", floorA: "#2a2724", floorB: "#c9a227",
      wall: "#24201c", wallLow: "#15120f", trim: "#c9a227",
      chair: { seat: "#1a1410", metal: 0xd8b347, gold: true },
      frame: "#d8b347", lamp: "chandelier", sign: "#ffd86a", accent: "#d8b347",
      warm: 0xffe2b0, keyI: 2.6, hemiI: 1.15, decor: ["bar", "lounge", "art", "plants", "runner", "tv"]
    }
  };

  // ------------------------------------------------------------------ small helpers
  const cache = {};
  function std(color, rough, metal, o) {
    const key = [color, rough, metal, o ? JSON.stringify(o) : ""].join("|");
    if (!o || !o.map) { if (cache[key]) return cache[key]; }
    const m = new THREE.MeshStandardMaterial(Object.assign({ color: color, roughness: rough === undefined ? 0.7 : rough, metalness: metal || 0 }, o || {}));
    if (!o || !o.map) cache[key] = m;
    return m;
  }
  function glow(color, o) { return new THREE.MeshBasicMaterial(Object.assign({ color: color, toneMapped: false }, o || {})); }
  function mesh(geo, mat, x, y, z, parent, o) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (o && o.ry) m.rotation.y = o.ry;
    if (o && o.rx) m.rotation.x = o.rx;
    if (o && o.rz) m.rotation.z = o.rz;
    m.castShadow = !!(o && o.cast); m.receiveShadow = !(o && o.noReceive);
    if (parent) parent.add(m);
    return m;
  }
  function box(w, h, d, mat, x, y, z, parent, o) { return mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent, o); }
  function cyl(rt, rb, h, mat, x, y, z, parent, o) { return mesh(new THREE.CylinderGeometry(rt, rb, h, (o && o.seg) || 20), mat, x, y, z, parent, o); }
  function tex(w, h, draw, rx, ry) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    if (rx || ry) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx || 1, ry || 1); }
    return t;
  }
  let seed = 7;
  function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

  // ------------------------------------------------------------------ surfaces
  function floorTex(K) {
    if (K.floor === "checker") return tex(512, 512, function (g, w) {
      const n = 8, s = w / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = (i + j) % 2 ? K.floorB : K.floorA; g.fillRect(i * s, j * s, s, s); }
      // scuffs: the rented shop's floor has seen some years
      for (let k = 0; k < 900 * K.worn; k++) { g.fillStyle = "rgba(60,48,36," + (rnd() * 0.12) + ")"; g.beginPath(); g.arc(rnd() * w, rnd() * w, rnd() * 9, 0, 7); g.fill(); }
    }, K.W / 2.4, K.D / 2.4);
    if (K.floor === "planks") return tex(512, 512, function (g, w, h) {
      const rows = 8, rh = h / rows;
      for (let r = 0; r < rows; r++) {
        let x = -rnd() * 200;
        while (x < w) {
          const len = 160 + rnd() * 200, l = 30 + rnd() * 14;
          g.fillStyle = "hsl(26," + (44 + rnd() * 10) + "%," + l + "%)"; g.fillRect(x, r * rh, len, rh);
          g.strokeStyle = "rgba(30,16,8,.55)"; g.lineWidth = 2; g.strokeRect(x, r * rh, len, rh);
          for (let k = 0; k < 6; k++) { g.strokeStyle = "rgba(40,22,10,.18)"; g.beginPath(); const yy = r * rh + rnd() * rh; g.moveTo(x, yy); g.bezierCurveTo(x + len * .3, yy + 4, x + len * .6, yy - 4, x + len, yy); g.stroke(); }
          x += len;
        }
      }
    }, K.W / 3, K.D / 3);
    if (K.floor === "tiles") return tex(512, 512, function (g, w) {
      const n = 4, s = w / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        g.fillStyle = (i + j) % 2 ? K.floorA : K.floorB; g.fillRect(i * s, j * s, s, s);
        for (let k = 0; k < 5; k++) { g.strokeStyle = "rgba(120,110,100,.18)"; g.lineWidth = 1 + rnd() * 2; g.beginPath(); g.moveTo(i * s + rnd() * s, j * s); g.bezierCurveTo(i * s + rnd() * s, j * s + s * .3, i * s + rnd() * s, j * s + s * .6, i * s + rnd() * s, j * s + s); g.stroke(); }
      }
      g.strokeStyle = "rgba(60,55,50,.5)"; g.lineWidth = 3;
      for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, w); g.stroke(); g.beginPath(); g.moveTo(0, i * s); g.lineTo(w, i * s); g.stroke(); }
    }, K.W / 4, K.D / 4);
    // marble: black with pale veins and a gold inlay grid
    return tex(1024, 1024, function (g, w) {
      g.fillStyle = K.floorA; g.fillRect(0, 0, w, w);
      for (let k = 0; k < 60; k++) {
        g.strokeStyle = "rgba(220,215,205," + (0.04 + rnd() * 0.1) + ")"; g.lineWidth = 0.5 + rnd() * 2.5;
        g.beginPath(); let x = rnd() * w, y = rnd() * w; g.moveTo(x, y);
        for (let s = 0; s < 6; s++) { x += (rnd() - 0.3) * 140; y += (rnd() - 0.5) * 140; g.lineTo(x, y); }
        g.stroke();
      }
      g.strokeStyle = K.floorB; g.lineWidth = 5;
      g.strokeRect(2, 2, w - 4, w - 4);
      g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, w); g.moveTo(0, w / 2); g.lineTo(w, w / 2); g.stroke();
    }, K.W / 3.4, K.D / 3.4);
  }
  function wallMat(K, len, h) {
    if (K.wall === "brick") return std(0xffffff, 0.9, 0, { map: tex(512, 512, function (g, w, hh) {
      g.fillStyle = "#cfc6bb"; g.fillRect(0, 0, w, hh);
      const bh = 32, bw = 96;
      for (let r = 0; r < hh / bh; r++) for (let c = -1; c < w / bw + 1; c++) {
        const x = c * bw + (r % 2) * bw / 2, l = 30 + rnd() * 12;
        g.fillStyle = "hsl(" + (10 + rnd() * 10) + ",45%," + l + "%)"; g.fillRect(x + 3, r * bh + 3, bw - 6, bh - 6);
      }
    }, len / 2.2, h / 2.2) });
    return std(K.wall, 0.85, 0);
  }

  // ------------------------------------------------------------------ signs, posters, backdrop
  function signTex(text, sub, color, font) {
    return tex(1024, 256, function (g, w, h) {
      g.clearRect(0, 0, w, h);
      g.textAlign = "center"; g.textBaseline = "middle";
      // shrink the lettering until it fits, with room left for the glow
      let size = sub ? 104 : 124;
      const face = font || "Georgia, 'Times New Roman', serif";
      do { g.font = "700 " + size + "px " + face; size -= 4; } while (g.measureText(text).width > w * 0.9 && size > 30);
      g.shadowColor = color; g.shadowBlur = 26; g.fillStyle = color;
      g.fillText(text, w / 2, sub ? h * 0.4 : h / 2);
      g.shadowBlur = 8; g.fillStyle = "#fffaf0"; g.globalAlpha = 0.55; g.fillText(text, w / 2, sub ? h * 0.4 : h / 2); g.globalAlpha = 1;
      if (sub) { g.font = "600 46px 'Segoe UI', sans-serif"; g.shadowBlur = 14; g.fillStyle = color; g.fillText(sub.split("").join(" "), w / 2, h * 0.82); }
    });
  }
  function poster(title, sub, bg, fg) {
    return tex(256, 360, function (g, w, h) {
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(12, 12, w - 24, h - 24);
      g.fillStyle = fg; g.textAlign = "center"; g.font = "700 44px Georgia, serif";
      title.split("\n").forEach(function (line, i) { g.fillText(line, w / 2, 110 + i * 52); });
      g.font = "600 20px 'Segoe UI', sans-serif"; g.fillText(sub, w / 2, h - 44);
      g.beginPath(); g.arc(w / 2, 230, 34, 0, 7); g.stroke();
      g.beginPath(); g.moveTo(w / 2 - 22, 250); g.lineTo(w / 2 + 22, 210); g.moveTo(w / 2 - 22, 210); g.lineTo(w / 2 + 22, 250); g.stroke();
    });
  }
  function streetTex(kind) {
    return tex(1024, 512, function (g, w, h) {
      const sky = g.createLinearGradient(0, 0, 0, h * 0.7);
      sky.addColorStop(0, "#0b1230"); sky.addColorStop(0.6, "#2c2350"); sky.addColorStop(1, "#6b3b52");
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) { g.fillStyle = "rgba(255,255,255," + rnd() * 0.6 + ")"; g.fillRect(rnd() * w, rnd() * h * 0.35, 1.5, 1.5); }
      let x = -20;
      while (x < w) {
        const bw = 70 + rnd() * 120, bh = h * (0.3 + rnd() * 0.45), top = h * 0.78 - bh;
        g.fillStyle = "hsl(240,18%," + (9 + rnd() * 8) + "%)"; g.fillRect(x, top, bw, bh);
        for (let wy = top + 12; wy < h * 0.74; wy += 22) for (let wx = x + 10; wx < x + bw - 14; wx += 20)
          if (rnd() < 0.42) { g.fillStyle = rnd() < 0.7 ? "rgba(255,206,130,.85)" : "rgba(150,200,255,.8)"; g.fillRect(wx, wy, 9, 12); }
        x += bw + 6;
      }
      g.fillStyle = "#2a2a30"; g.fillRect(0, h * 0.78, w, h * 0.22);               // the road
      g.fillStyle = "rgba(255,220,120,.7)";
      for (let lx = 30; lx < w; lx += 120) g.fillRect(lx, h * 0.89, 60, 5);         // lane marks
      for (let l = 0; l < 3; l++) {                                                 // street lamps
        const lx = w * (0.15 + l * 0.35);
        const gl = g.createRadialGradient(lx, h * 0.5, 2, lx, h * 0.5, 90);
        gl.addColorStop(0, "rgba(255,214,150,.9)"); gl.addColorStop(1, "rgba(255,214,150,0)");
        g.fillStyle = gl; g.fillRect(lx - 90, h * 0.5 - 90, 180, 180);
        g.fillStyle = "#151519"; g.fillRect(lx - 3, h * 0.5, 6, h * 0.3);
      }
      if (kind === "large") { g.fillStyle = "rgba(201,162,39,.25)"; g.fillRect(0, h * 0.76, w, 6); }
    });
  }
  function poleTex() {
    const t = tex(128, 256, function (g, w, h) {
      g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
      for (let i = -4; i < 12; i++) {
        g.fillStyle = i % 2 ? "#c4322c" : "#16376d";
        g.beginPath(); g.moveTo(0, i * 48); g.lineTo(w, i * 48 - 64); g.lineTo(w, i * 48 - 40); g.lineTo(0, i * 48 + 24); g.fill();
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  function vendingTex() {
    return tex(256, 512, function (g, w, h) {
      g.fillStyle = "#0d1a24"; g.fillRect(0, 0, w, h);
      const cols = ["#e0614f", "#5cc08a", "#e6c866", "#5b9dd9", "#c06a97", "#f08d3c"];
      for (let r = 0; r < 6; r++) {
        g.fillStyle = "rgba(255,255,255,.12)"; g.fillRect(10, 30 + r * 76 + 52, w - 20, 4);
        for (let c = 0; c < 4; c++) { g.fillStyle = cols[(r * 3 + c) % cols.length]; g.fillRect(20 + c * 56, 30 + r * 76 + 8, 36, 44); g.fillStyle = "rgba(255,255,255,.35)"; g.fillRect(22 + c * 56, 30 + r * 76 + 10, 8, 40); }
      }
    });
  }

  // ------------------------------------------------------------------ furniture
  // A barber chair, front toward -Z (the way a body faces at yaw 0). Seat top at about 0.56 m.
  function barberChair(K) {
    const g = new THREE.Group();
    const leather = std(K.chair.seat, 0.45, 0.05), metal = std(K.chair.metal, 0.25, 1);
    cyl(0.34, 0.36, 0.05, metal, 0, 0.025, 0, g, { cast: true });
    cyl(0.07, 0.09, 0.32, metal, 0, 0.2, 0, g, { cast: true });
    box(0.6, 0.06, 0.56, metal, 0, 0.37, 0, g, { cast: true });
    box(0.56, 0.14, 0.54, leather, 0, 0.47, -0.02, g, { cast: true });
    box(0.54, 0.62, 0.12, leather, 0, 0.84, 0.25, g, { cast: true, rx: -0.12 });
    box(0.3, 0.14, 0.1, leather, 0, 1.26, 0.31, g, { cast: true, rx: -0.12 });
    cyl(0.015, 0.015, 0.2, metal, 0, 1.13, 0.3, g);
    [-1, 1].forEach(function (s) {
      box(0.08, 0.06, 0.5, leather, s * 0.33, 0.7, -0.02, g, { cast: true });
      box(0.04, 0.26, 0.04, metal, s * 0.33, 0.55, -0.2, g);
      box(0.04, 0.26, 0.04, metal, s * 0.33, 0.55, 0.18, g);
    });
    box(0.44, 0.03, 0.18, metal, 0, 0.16, -0.48, g, { cast: true });
    box(0.03, 0.26, 0.03, metal, 0, 0.28, -0.4, g, { rx: 0.5 });
    return g;
  }
  // The station on the wall behind a chair: mirror, lights, counter and tools. Built facing -Z
  // in its own space (the wall at +Z), turned with the chair.
  function station(K, g) {
    const frameM = std(K.frame, 0.35, K.chair.gold ? 1 : 0.2);
    const mirror = std(0xe8eef3, 0.04, 1);
    const isOval = K.chair.gold;
    if (isOval) {
      const geo = new THREE.CircleGeometry(0.5, 40); geo.scale(1, 1.32, 1);
      mesh(geo, mirror, 0, 1.6, -0.02, g, { ry: Math.PI });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 10, 48), frameM);
      ring.scale.set(1, 1.32, 0.6); ring.position.set(0, 1.6, -0.03); g.add(ring);
    } else {
      mesh(new THREE.PlaneGeometry(0.95, 1.2), mirror, 0, 1.6, -0.02, g, { ry: Math.PI });
      box(1.05, 0.05, 0.05, frameM, 0, 2.22, -0.03, g); box(1.05, 0.05, 0.05, frameM, 0, 0.98, -0.03, g);
      box(0.05, 1.29, 0.05, frameM, -0.5, 1.6, -0.03, g); box(0.05, 1.29, 0.05, frameM, 0.5, 1.6, -0.03, g);
    }
    // light bar over the mirror
    box(0.8, 0.05, 0.06, glow(K.lamp === "tube" ? 0xeaf6ff : 0xffe3b0), 0, isOval ? 2.36 : 2.3, -0.05, g);
    // counter + cabinet
    const wood = std(K.wallLow, 0.6, 0.05), top = std(K.chair.gold ? 0x111111 : 0x8b7d6b, 0.3, K.chair.gold ? 0.3 : 0);
    box(1.2, 0.86, 0.42, wood, 0, 0.43, -0.22, g, { cast: true });
    box(1.26, 0.05, 0.46, top, 0, 0.885, -0.22, g);
    // the tools: barbicide jar, spray bottle, clippers, towels
    cyl(0.06, 0.06, 0.2, std(0x2d7fd0, 0.1, 0, { transparent: true, opacity: 0.75 }), -0.42, 1.01, -0.2, g);
    cyl(0.035, 0.04, 0.17, std(0xe8e8e8, 0.4), -0.25, 0.995, -0.15, g);
    box(0.06, 0.03, 0.16, std(0x222222, 0.3, 0.6), 0.1, 0.925, -0.18, g, { ry: 0.4 });
    box(0.06, 0.03, 0.16, std(0xb08d57, 0.3, 0.8), 0.22, 0.925, -0.14, g, { ry: -0.3 });
    for (let i = 0; i < 3; i++) box(0.26, 0.05, 0.2, std(i % 2 ? 0xf2efe8 : 0x1f2f4f, 0.95), 0.42, 0.935 + i * 0.05, -0.22, g);
  }

  function bench(K, len, g, x, z, yaw) {
    const b = new THREE.Group(); b.position.set(x, 0, z); b.rotation.y = yaw; g.add(b);
    const fancy = K.chair.gold;
    const seat = std(fancy ? 0x2a1a12 : 0x6b4a2e, fancy ? 0.45 : 0.7), leg = std(fancy ? 0xc9a227 : 0x222222, 0.4, fancy ? 1 : 0.4);
    box(len, fancy ? 0.16 : 0.06, 0.48, seat, 0, fancy ? 0.4 : 0.44, 0, b, { cast: true });
    if (fancy) box(len, 0.46, 0.14, seat, 0, 0.7, 0.24, b, { cast: true });
    else box(len, 0.06, 0.06, seat, 0, 0.8, 0.22, b, { cast: true });
    [-1, 1].forEach(function (s) { box(0.05, 0.42, 0.4, leg, s * (len / 2 - 0.08), 0.21, 0, b); });
    return b;
  }

  function vendingMachine(g, x, z, yaw) {
    const v = new THREE.Group(); v.position.set(x, 0, z); v.rotation.y = yaw; g.add(v);
    box(0.92, 1.86, 0.78, std(0x1b2d3b, 0.5, 0.3), 0, 0.93, 0, v, { cast: true });
    const front = new THREE.MeshStandardMaterial({ map: vendingTex(), emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0, roughness: 0.15 });
    front.emissiveMap = front.map;
    mesh(new THREE.PlaneGeometry(0.6, 1.3), front, -0.1, 1.08, -0.395, v, { ry: Math.PI });
    const strip = glow(0x5cc0e6); strip.transparent = true; strip.opacity = 0.35;
    box(0.86, 0.12, 0.02, strip, 0, 1.78, -0.4, v);
    box(0.16, 0.5, 0.02, std(0x2a3a48, 0.4, 0.5), 0.33, 1.2, -0.4, v);
    box(0.5, 0.14, 0.04, std(0x0a0a0a, 0.5), -0.1, 0.3, -0.39, v);
    return { group: v, front: front, strip: strip };
  }

  function merchTable(K, g, x, z, yaw) {
    const m = new THREE.Group(); m.position.set(x, 0, z); m.rotation.y = yaw; g.add(m);
    const wood = std(K.chair.gold ? 0x1a1a1a : 0x7a5434, 0.55, 0.05);
    box(1.3, 0.05, 0.66, wood, 0, 0.82, 0, m, { cast: true });
    [[-0.6, -0.28], [0.6, -0.28], [-0.6, 0.28], [0.6, 0.28]].forEach(function (p) { box(0.05, 0.8, 0.05, wood, p[0], 0.4, p[1], m); });
    // stacks of folded shirts (black, gold, white): they sell down over the week
    const cols = [0x111111, 0xc9a227, 0xf2efe8, 0x16376d];
    const stacks = [];
    for (let s = 0; s < 4; s++) {
      const st = [];
      for (let i = 0; i < 5; i++) st.push(box(0.26, 0.045, 0.3, std(cols[s], 0.95), -0.45 + s * 0.3, 0.87 + i * 0.047, -0.04, m, { cast: true }));
      stacks.push(st);
    }
    // a sign: MERCH
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.2), new THREE.MeshBasicMaterial({ map: signTex("MERCH", "", K.sign, "'Segoe UI', sans-serif"), transparent: true, toneMapped: false }));
    sign.position.set(0, 1.42, 0.25); sign.rotation.y = Math.PI; m.add(sign);
    box(0.03, 0.62, 0.03, std(0x222222, 0.5, 0.5), 0, 1.12, 0.25, m);
    return { group: m, stacks: stacks, sign: sign };
  }

  let solidsOut = null;            // the room being built, so plant() can register itself
  function plant(g, x, z, s) {
    s = s || 1;
    if (solidsOut) solidsOut.push({ x: x, z: z, r: 0.3 * s });
    cyl(0.22 * s, 0.17 * s, 0.4 * s, std(0x2b2b2b, 0.6), x, 0.2 * s, z, g, { cast: true });
    const leaf = std(0x2f6b3a, 0.8);
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2, l = new THREE.Mesh(new THREE.SphereGeometry(0.2 * s, 8, 6), leaf);
      l.scale.set(0.5, 1.6, 0.25); l.position.set(x + Math.cos(a) * 0.13 * s, (0.62 + (i % 3) * 0.12) * s, z + Math.sin(a) * 0.13 * s);
      l.rotation.set(Math.sin(a) * 0.5, -a, Math.cos(a) * 0.5); l.castShadow = true; g.add(l);
    }
  }

  // ------------------------------------------------------------------ the street outside
  // Facade textures: brick, pale stone, dark glass curtain wall.
  const facadeCache = {};
  function facade(type) {
    if (facadeCache[type]) return facadeCache[type];
    let t;
    if (type === "brick") t = tex(256, 256, function (g, w, h) {
      g.fillStyle = "#3a2420"; g.fillRect(0, 0, w, h);
      for (let r = 0; r < 16; r++) for (let c = -1; c < 9; c++) {
        const x = c * 32 + (r % 2) * 16; g.fillStyle = "hsl(" + (8 + rnd() * 12) + ",42%," + (22 + rnd() * 10) + "%)"; g.fillRect(x + 1.5, r * 16 + 1.5, 29, 13);
      }
    });
    else if (type === "stone") t = tex(256, 256, function (g, w, h) {
      g.fillStyle = "#8f877a"; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 3000; k++) { g.fillStyle = "rgba(" + (rnd() < 0.5 ? "255,250,240" : "40,35,30") + "," + rnd() * 0.08 + ")"; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
      g.strokeStyle = "rgba(50,45,40,.35)"; g.lineWidth = 2;
      for (let y = 0; y < h; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      for (let y = 0; y < h; y += 64) for (let x = (y / 64 % 2) * 64; x < w; x += 128) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 64); g.stroke(); }
    });
    else t = tex(256, 256, function (g, w, h) {
      const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, "#1a2333"); gr.addColorStop(1, "#0d121c");
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.strokeStyle = "rgba(160,190,230,.25)"; g.lineWidth = 3;
      for (let x = 0; x <= w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      for (let y = 0; y <= h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return (facadeCache[type] = t);
  }
  function skyTex() {
    return tex(512, 512, function (g, w, h) {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, "#04060f"); gr.addColorStop(0.45, "#121735"); gr.addColorStop(0.62, "#3a2a55"); gr.addColorStop(0.72, "#6b3b52"); gr.addColorStop(1, "#14101a");
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) { g.fillStyle = "rgba(255,255,255," + rnd() * 0.7 + ")"; g.fillRect(rnd() * w, rnd() * h * 0.5, 1.2, 1.2); }
    });
  }

  /* The block across the road, built for real: a row of buildings with window grids (frames,
     sills, lintels, lit and dark panes), cornices, pilasters, storefronts with awnings, fire
     escapes on the brick ones, rooftop water towers, AC units and antennas; street lamps, kerbs
     and lane marks; a distant skyline and the night sky. Everything that repeats is instanced, so
     the detail costs a handful of draw calls. */
  function cityBlock(S, K, g) {
    const W = S.W, hd = S.D / 2;
    const big = S.kind === "large" || S.kind === "medium";
    const inst = {};                                   // key -> { geo, mat, m: [Matrix4], c: [Color] }
    const o3 = new THREE.Object3D();
    function put(key, geo, mat, x, y, z, sx, sy, sz, ry, col) {
      const e = inst[key] || (inst[key] = { geo: geo, mat: mat, m: [], c: [] });
      o3.position.set(x, y, z); o3.rotation.set(0, ry || 0, 0); o3.scale.set(sx || 1, sy || 1, sz || 1); o3.updateMatrix();
      e.m.push(o3.matrix.clone()); if (col) e.c.push(col);
    }
    const BOX = new THREE.BoxGeometry(1, 1, 1), CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 14), CONE = new THREE.ConeGeometry(0.5, 1, 14);
    const POOL = new THREE.CircleGeometry(1, 24); POOL.rotateX(-Math.PI / 2);
    const trimM = std(0x2a2724, 0.7), frameM = std(0x18181a, 0.5, 0.4), sillM = std(0xb8b0a2, 0.7), metalM = std(0x2b2d30, 0.5, 0.7);
    const paneM = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const cols = [new THREE.Color(1.0, 0.78, 0.48), new THREE.Color(1.0, 0.86, 0.62), new THREE.Color(0.62, 0.78, 1.0), new THREE.Color(0.05, 0.06, 0.09), new THREE.Color(0.08, 0.09, 0.12), new THREE.Color(0.9, 0.55, 0.3)];

    // ground: the road, the kerbs, both pavements, and dark ground beyond so nothing ends in a void
    mesh(new THREE.PlaneGeometry(140, 140), std(0x101014, 0.95), 0, -0.32, 0, g, { rx: -Math.PI / 2 });
    const roadZ = -hd - 6.2, span = W + 46;
    mesh(new THREE.PlaneGeometry(span, 3.2), std(0x5a5a62, 0.9), 0, -0.01, -hd - 1.6, g, { rx: -Math.PI / 2 });     // our pavement
    mesh(new THREE.PlaneGeometry(span, 6.4), std(0x1c1c22, 0.6, 0.1), 0, -0.13, roadZ, g, { rx: -Math.PI / 2 });     // road, a bit wet
    mesh(new THREE.PlaneGeometry(span, 3.0), std(0x55555c, 0.9), 0, -0.01, roadZ - 4.7, g, { rx: -Math.PI / 2 });    // far pavement
    box(span, 0.13, 0.22, std(0x7a7a80, 0.8), 0, -0.065, -hd - 3.2, g);
    box(span, 0.13, 0.22, std(0x7a7a80, 0.8), 0, -0.065, roadZ - 3.2, g);
    const dashM = glow(0xd8b04a);
    for (let x = -span / 2 + 1; x < span / 2; x += 3) put("dash", BOX, dashM, x, -0.12, roadZ, 1.4, 0.01, 0.12);
    for (let x = -3; x <= 3; x += 0.6) put("zebra", BOX, std(0xd8d8d8, 0.8), x, -0.12, roadZ, 0.35, 0.01, 5.2);   // a crossing outside the door
    // street lamps on both pavements, each with a soft pool of light on the ground
    const lampHead = glow(0xffd28a), poolM = new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.16, depthWrite: false, toneMapped: false });
    [[-hd - 2.9, 1], [roadZ - 3.4, -1]].forEach(function (row) {
      for (let x = -span / 2 + 4; x < span / 2; x += 9) {
        if (row[1] > 0 && Math.abs(x) < W / 2 + 0.5) continue;      // not in front of our own window
        const z = row[0];
        put("lampPole", CYL, metalM, x, 2.4, z, 0.12, 4.8, 0.12);
        put("lampArm", BOX, metalM, x, 4.75, z - row[1] * 0.5, 0.08, 0.08, 1.0);
        put("lampHead", BOX, lampHead, x, 4.68, z - row[1] * 0.95, 0.34, 0.1, 0.5);
        put("lampPool", POOL, poolM, x, -0.11, z - row[1] * 1.2, 2.6, 2.6, 2.6);
      }
    });

    // the buildings across the road, their faces at fz, running along x
    const fz = roadZ - 4.7 - 1.5;
    let x = -span / 2;
    while (x < span / 2) {
      const bw = 6 + rnd() * 6, floors = (big ? 4 : 3) + Math.floor(rnd() * (big ? 7 : 4)), fh = 3.2, bh = floors * fh + 1.2;
      const type = rnd() < 0.45 ? "brick" : (rnd() < 0.55 ? "stone" : "glass");
      const cx = x + bw / 2, depth = 8;
      const fm = facade(type).clone(); fm.needsUpdate = true; fm.repeat.set(bw / 3, bh / 3);
      const mat = new THREE.MeshStandardMaterial({ map: fm, roughness: type === "glass" ? 0.15 : 0.85, metalness: type === "glass" ? 0.5 : 0 });
      const b = box(bw - 0.1, bh, depth, mat, cx, bh / 2, fz - depth / 2, g);
      b.receiveShadow = false;
      // ground floor: a storefront with a lit window, a door and an awning
      // lit shop windows: dimmed (full-bright glass across the road drowned the facades), split by
      // mullions, with a door
      const shopCol = new THREE.Color([0x8a6a42, 0x4a5a72, 0x7a4a58, 0x4f6a52][Math.floor(rnd() * 4)]);
      put("shopGlass", BOX, paneM, cx, 1.45, fz + 0.03, bw - 1.6, 2.1, 0.04, 0, shopCol);
      for (let k = 1; k < 4; k++) put("shopMull", BOX, frameM, cx - (bw - 1.6) / 2 + (bw - 1.6) * k / 4, 1.45, fz + 0.06, 0.07, 2.1, 0.06);
      put("shopDoor", BOX, std(0x1a1a1c, 0.5, 0.3), cx + bw * 0.3, 1.1, fz + 0.05, 0.9, 2.2, 0.05);
      put("shopFrame", BOX, frameM, cx, 2.62, fz + 0.06, bw - 1.2, 0.18, 0.1);
      put("awning", BOX, std([0x7a1e1e, 0x1f3a5f, 0x2f5a3a, 0x3a2a4f][Math.floor(rnd() * 4)], 0.8), cx, 2.95, fz + 0.6, bw - 1.0, 0.08, 1.2);
      put("awningLip", BOX, std(0xe8e0d0, 0.8), cx, 2.86, fz + 1.18, bw - 1.0, 0.18, 0.04);
      // upper floors: a grid of windows with frames, sills, lintels; pilasters between columns
      const wc = Math.max(2, Math.floor(bw / 1.6)), step = (bw - 1.2) / wc;
      for (let f = 1; f < floors; f++) {
        const wy = f * fh + 1.5;
        put("band", BOX, trimM, cx, f * fh + 0.12, fz + 0.08, bw, 0.22, 0.2);                           // floor band
        for (let c = 0; c < wc; c++) {
          const wx = cx - (bw - 1.2) / 2 + step * (c + 0.5);
          const lit = rnd();
          put("pane", BOX, paneM, wx, wy, fz + 0.02, step * 0.55, 1.5, 0.04, 0, cols[lit < 0.35 ? (lit < 0.2 ? 0 : 1) : (lit < 0.45 ? 2 : (lit < 0.5 ? 5 : (lit < 0.8 ? 3 : 4)))]);
          put("frameV", BOX, frameM, wx, wy, fz + 0.05, 0.05, 1.5, 0.06);                               // mullion
          put("frameH", BOX, frameM, wx, wy + 0.1, fz + 0.05, step * 0.55, 0.05, 0.06);                 // transom
          if (type !== "glass") {
            put("sill", BOX, sillM, wx, wy - 0.82, fz + 0.12, step * 0.7, 0.08, 0.2);
            put("lintel", BOX, sillM, wx, wy + 0.84, fz + 0.08, step * 0.68, 0.14, 0.12);
          }
          if (c > 0 && type === "stone") put("pilaster", BOX, sillM, wx - step / 2, f * fh + fh / 2, fz + 0.1, 0.18, fh - 0.25, 0.16);
        }
        // fire escape on brick buildings: a landing per floor, rails, and a ladder
        if (type === "brick" && bw > 7) {
          const ex = cx + bw * 0.18;
          put("feDeck", BOX, metalM, ex, f * fh + 0.2, fz + 0.65, 2.6, 0.05, 1.1);
          put("feRail", BOX, metalM, ex, f * fh + 0.7, fz + 1.18, 2.6, 0.04, 0.04);
          put("feRail", BOX, metalM, ex, f * fh + 0.45, fz + 1.18, 2.6, 0.03, 0.03);
          for (let k = -1; k <= 1; k += 2) put("fePost", BOX, metalM, ex + k * 1.28, f * fh + 0.45, fz + 1.18, 0.04, 0.5, 0.04);
          put("feLadder", BOX, metalM, ex + 0.9, f * fh - fh / 2 + 0.2, fz + 0.8, 0.4, fh, 0.03, 0);
        }
      }
      // cornice and parapet
      put("cornice", BOX, trimM, cx, bh - 0.55, fz + 0.18, bw + 0.1, 0.35, 0.45);
      put("cornice2", BOX, trimM, cx, bh - 0.3, fz + 0.1, bw, 0.15, 0.3);
      put("parapet", BOX, trimM, cx, bh + 0.25, fz - depth / 2, bw - 0.1, 0.5, depth);
      // roof furniture
      if (rnd() < 0.55) {                                  // a water tower on legs
        const tx = cx + (rnd() - 0.5) * bw * 0.5, tz = fz - depth * 0.55, ty = bh + 0.5;
        for (let k = 0; k < 4; k++) put("wtLeg", CYL, metalM, tx + (k % 2 ? 0.7 : -0.7), ty + 1.0, tz + (k < 2 ? 0.7 : -0.7), 0.08, 2.0, 0.08);
        put("wtTank", CYL, std(0x6b4a30, 0.85), tx, ty + 2.9, tz, 2.0, 1.8, 2.0);
        put("wtRoof", CONE, std(0x3a2a20, 0.8), tx, ty + 4.15, tz, 2.2, 0.7, 2.2);
      }
      for (let k = 0; k < 2; k++) put("ac", BOX, std(0x9a9ea4, 0.6, 0.4), cx + (rnd() - 0.5) * bw * 0.7, bh + 0.75, fz - 1.5 - rnd() * 4, 1.1, 0.7, 0.8);
      if (rnd() < 0.4) put("antenna", CYL, metalM, cx + (rnd() - 0.5) * bw * 0.6, bh + 2.0, fz - 2, 0.05, 3.0, 0.05);
      // a blinking red light on the tall ones
      if (bh > 20) { const bl = mesh(new THREE.SphereGeometry(0.15, 8, 6), glow(0xff3030), cx, bh + 0.7, fz - depth / 2, g); S.anim.push(function (t) { bl.visible = Math.sin(t * 3 + cx) > 0.2; }); }
      x += bw;
    }
    // the skyline further back, and the sky
    for (let k = 0; k < 24; k++) {
      const sx = (k / 23 - 0.5) * (span + 40), sh = 18 + rnd() * (big ? 45 : 30), sw = 5 + rnd() * 8;
      put("tower", BOX, std(0x141824, 0.6, 0.3), sx, sh / 2, fz - 22 - rnd() * 12, sw, sh, 6);
      for (let j = 0; j < 14; j++) put("towerWin", BOX, paneM, sx + (rnd() - 0.5) * sw * 0.8, 3 + rnd() * (sh - 4), fz - 18.9 - 0.1, 0.6, 0.8, 0.05, 0, cols[Math.floor(rnd() * 3)]);
    }
    const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ map: skyTex(), side: THREE.BackSide, toneMapped: false, fog: false }));
    sky.position.set(0, -2, 0); g.add(sky);

    Object.keys(inst).forEach(function (key) {
      const e = inst[key];
      const im = new THREE.InstancedMesh(e.geo, e.mat, e.m.length);
      e.m.forEach(function (m, i) { im.setMatrixAt(i, m); if (e.c.length) im.setColorAt(i, e.c[i]); });
      im.castShadow = false; im.receiveShadow = false;
      g.add(im);
    });
  }

  // ------------------------------------------------------------------ the room
  function build(kind, opts) {
    opts = opts || {};
    seed = 7 + kind.length * 31;
    const K = KINDS[kind] || KINDS.rental;
    const W = K.W, D = K.D, H = K.H, hw = W / 2, hd = D / 2;
    const g = new THREE.Group();
    const S = { kind: kind, K: K, group: g, W: W, D: D, H: H, stations: [], benches: [], anim: [], lights: [], solids: [] };

    // floor, with a little skirt so the doll's-house edge reads as a cut
    const floorM = std(0xffffff, K.floor === "marble" ? 0.18 : (K.floor === "tiles" ? 0.3 : 0.62), K.floor === "marble" ? 0.2 : 0, { map: floorTex(K) });
    mesh(new THREE.PlaneGeometry(W, D), floorM, 0, 0, 0, g, { rx: -Math.PI / 2 });
    box(W + 0.3, 0.3, 0.15, std(0x0d0a08, 0.8), 0, -0.15, hd + 0.075, g);

    // The CTSG seal set into the floor of the aisle, reading the right way up from the front
    // (user, 2026-10-16). A glossy inlay; a gold ring round it in the gold shops.
    const SEAL = { rental: [1.7, -0.25], small: [1.9, 0.5], medium: [2.2, -0.4], large: [2.8, -0.6] }[kind] || [1.8, 0];
    const sealTex = new THREE.TextureLoader().load("assets/ctsg-seal.png?v=1");
    sealTex.colorSpace = THREE.SRGBColorSpace; sealTex.anisotropy = 8;
    const onRug = kind === "medium" || kind === "large";
    const sealY = onRug ? 0.011 : 0.004;
    const seal = mesh(new THREE.CircleGeometry(SEAL[0] / 2, 72), new THREE.MeshStandardMaterial({
      map: sealTex, transparent: true, roughness: 0.22, metalness: 0.05,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    }), 0, sealY, SEAL[1], g, { rx: -Math.PI / 2 });
    seal.receiveShadow = true;
    if (K.chair.gold) {
      const ring = mesh(new THREE.RingGeometry(SEAL[0] / 2 + 0.02, SEAL[0] / 2 + 0.07, 72), std(0xd8b347, 0.25, 1, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 0, sealY, SEAL[1], g, { rx: -Math.PI / 2 });
      ring.receiveShadow = true;
    }
    S.seal = seal;
    box(W + 0.3, 0.3, D, std(0x0d0a08, 0.8), 0, -0.151 - 0.15, 0, g, { noReceive: true });

    // side walls (solid) with a lower panel and a trim line
    const wallM = wallMat(K, D, H), lowM = std(K.wallLow, 0.6, 0.05), trimM = std(K.trim, 0.35, K.chair.gold ? 1 : 0.3);
    [-1, 1].forEach(function (s) {
      box(0.16, H, D, wallM, s * (hw + 0.08), H / 2, 0, g);
      box(0.04, 1.0, D, lowM, s * (hw - 0.02), 0.5, 0, g);
      box(0.05, 0.05, D, trimM, s * (hw - 0.03), 1.02, 0, g);
      box(0.06, 0.12, D, trimM, s * (hw - 0.03), H - 0.06, 0, g);
    });

    // the storefront: glass either side of the door, posts, a fascia with the shop's name
    const glassM = new THREE.MeshStandardMaterial({ color: 0x9fc4e0, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.16, depthWrite: false });
    const postM = std(K.chair.gold ? 0x111111 : 0x2a2a2a, 0.4, 0.6);
    const doorW = 1.3, doorH = 2.35, fasciaY = Math.min(H - 0.45, 2.95);
    box(W + 0.32, 0.5, 0.18, lowM, 0, 0.25, -hd - 0.09, g);                              // sill
    box(W + 0.32, H - fasciaY + 0.25, 0.2, std(K.chair.gold ? 0x0e0e0e : K.wallLow, 0.6), 0, (fasciaY + H) / 2 - 0.1, -hd - 0.1, g);
    [-1, 1].forEach(function (s) {
      const gx0 = doorW / 2 + 0.08, gx1 = hw, gw = gx1 - gx0;
      mesh(new THREE.PlaneGeometry(gw, fasciaY - 0.5), glassM, s * (gx0 + gw / 2), 0.5 + (fasciaY - 0.5) / 2, -hd - 0.05, g);
      box(0.1, fasciaY, 0.14, postM, s * (doorW / 2 + 0.05), fasciaY / 2, -hd - 0.08, g, { cast: true });
      box(0.1, fasciaY, 0.14, postM, s * (gx0 + gw / 2), fasciaY / 2, -hd - 0.08, g);
    });
    box(doorW, fasciaY - doorH, 0.14, postM, 0, (doorH + fasciaY) / 2, -hd - 0.08, g);
    // the door itself (glass in a frame), standing open a crack
    const door = new THREE.Group(); door.position.set(-doorW / 2, 0, -hd - 0.06); g.add(door);
    box(0.05, doorH, 0.05, postM, 0.03, doorH / 2, 0, door); box(0.05, doorH, 0.05, postM, doorW - 0.03, doorH / 2, 0, door);
    box(doorW, 0.06, 0.05, postM, doorW / 2, doorH - 0.03, 0, door); box(doorW, 0.12, 0.05, postM, doorW / 2, 0.06, 0, door);
    mesh(new THREE.PlaneGeometry(doorW - 0.08, doorH - 0.18), glassM, doorW / 2, doorH / 2, 0, door);
    box(0.03, 0.4, 0.05, std(K.accent, 0.3, 1), doorW - 0.18, 1.05, -0.04, door);
    S.doorMesh = door;
    // OPEN neon in the window
    const open = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.3), new THREE.MeshBasicMaterial({ map: signTex("OPEN", "", "#ff3b6b", "'Segoe UI', sans-serif"), transparent: true, toneMapped: false }));
    open.position.set(-(doorW / 2 + 0.9), 1.9, -hd - 0.02); g.add(open);
    S.anim.push(function (t) { open.material.opacity = 0.85 + 0.15 * Math.sin(t * 9) * (Math.sin(t * 0.7) > 0.96 ? 1 : 0); });
    // the shop's name, lit, inside above the door
    const name = opts.district ? K.name : K.name;
    const sub = kind === "rental" ? K.sub : (opts.district ? opts.district.toUpperCase() + (K.sub ? " " + K.sub : "") : K.sub);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(W * 0.62, 6.4), Math.min(W * 0.62, 6.4) / 4),
      new THREE.MeshBasicMaterial({ map: signTex(name, sub, K.sign), transparent: true, toneMapped: false }));
    sign.position.set(0, fasciaY + (H - fasciaY) / 2 + 0.02, -hd + 0.02); g.add(sign);

    // outside: pavement, the street at night, a barber pole by the door
    // outside: the street at night and the 3D block across the road (cityBlock)
    cityBlock(S, K, g);
    const pt = poleTex();
    const pole = cyl(0.09, 0.09, 0.9, new THREE.MeshBasicMaterial({ map: pt, toneMapped: false }), doorW / 2 + 0.35, 2.0, -hd - 0.35, g);
    cyl(0.12, 0.12, 0.08, std(K.accent, 0.3, 1), doorW / 2 + 0.35, 2.49, -hd - 0.35, g);
    cyl(0.12, 0.12, 0.08, std(K.accent, 0.3, 1), doorW / 2 + 0.35, 1.51, -hd - 0.35, g);
    mesh(new THREE.SphereGeometry(0.1, 14, 10), std(K.accent, 0.3, 1), doorW / 2 + 0.35, 2.6, -hd - 0.35, g);
    S.anim.push(function (t) { pt.offset.y = (t * 0.35) % 1; });

    // waypoints: outside -> the door -> the aisle
    S.outside = new THREE.Vector3(0.5, 0, -hd - 2.6);
    S.door = new THREE.Vector3(0, 0, -hd - 0.3);
    S.inside = new THREE.Vector3(0, 0, -hd + 0.9);

    // ---------------------------------------------------------------- the stations
    const rows = K.rows, perRow = K.perRow;
    const z0 = -hd + 2.5, dz = rows > 1 ? Math.min(2.5, (hd - 2.2 - z0) / (rows - 1)) : 0;
    const zr = rows === 1 ? -0.5 : null;
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      const z = zr !== null ? zr : z0 + r * dz;
      for (let c = 0; c < perRow; c++) {
        const s = c === 0 ? -1 : 1;                   // left wall, right wall
        const turn = 0.42;                             // toward the camera
        const yaw = s < 0 ? -Math.PI / 2 - turn : Math.PI / 2 + turn;
        const cx = s * (hw - 1.05);
        // wall unit (mirror/counter) on the side wall behind the chair
        const unit = new THREE.Group();
        unit.position.set(s * (hw - 0.02), 0, z); unit.rotation.y = s < 0 ? -Math.PI / 2 : Math.PI / 2; g.add(unit);
        station(K, unit);
        const chair = barberChair(K);
        chair.position.set(cx, 0, z); chair.rotation.y = yaw; g.add(chair);
        S.solids.push({ x: cx, z: z, r: 0.42 });
        S.solids.push(s < 0 ? { x0: -hw, x1: -hw + 0.5, z0: z - 0.64, z1: z + 0.64 } : { x0: hw - 0.5, x1: hw, z0: z - 0.64, z1: z + 0.64 });
        const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));     // where a sitter faces
        const side = new THREE.Vector3(0, 0, -1);                             // barber works from the storefront side
        const st = {
          index: idx++, x: cx, z: z, yaw: yaw, side: s, chair: chair, seatY: 0.54,
          // the client walks to here, turns and sits
          front: new THREE.Vector3(cx, 0, z).addScaledVector(fwd, 0.62),
          aisle: new THREE.Vector3(s * 0.55, 0, z + 0.2),
          // the barber's mark: beside the chair, a little toward the aisle
          work: new THREE.Vector3(cx, 0, z).addScaledVector(side, 0.66).addScaledVector(fwd, 0.18),
          head: new THREE.Vector3(cx, 1.22, z).addScaledVector(fwd, 0.02),
          occupiedBy: null
        };
        S.stations.push(st);
      }
    }
    // A stand for an empty slot in the 2-chair shop's single row reads as part of the design:
    // the small shop's back-and-front space goes to a lounge instead (decor below).

    // ---------------------------------------------------------------- the barbers' marks
    const fz = hd - 1.7;
    S.barberSpots = [new THREE.Vector3(-0.55, 0, fz), new THREE.Vector3(0.55, 0, fz)];
    S.breakSpots = [new THREE.Vector3(-0.42, 0, fz - 0.4), new THREE.Vector3(0.42, 0, fz - 0.4)];

    // ---------------------------------------------------------------- waiting benches
    // Under the storefront glass, either side of the door, facing into the shop.
    const blen = Math.min(2.2, hw - doorW / 2 - 0.9);
    [-1, 1].forEach(function (s) {
      const bx = s * (doorW / 2 + 0.55 + blen / 2), bz = -hd + 0.55;
      bench(K, blen, g, bx, bz, Math.PI);
      S.solids.push({ x0: bx - blen / 2, x1: bx + blen / 2, z0: bz - 0.3, z1: bz + 0.3 });
      const n = blen > 1.6 ? 3 : 2, seats = [];
      for (let i = 0; i < n; i++) seats.push(new THREE.Vector3(bx + (i - (n - 1) / 2) * (blen / n), 0, bz));
      S.benches.push({ x: bx, z: bz, yaw: Math.PI, seatY: K.chair.gold ? 0.48 : 0.47, seats: seats });
    });

    // ---------------------------------------------------------------- vending, merch, amenities
    const vz = hd - 0.9;
    S.vending = vendingMachine(g, -hw + 0.5, vz, -Math.PI / 2);
    S.vendingSpot = new THREE.Vector3(-hw + 1.35, 0, vz);
    S.merch = merchTable(K, g, hw - 0.62, vz - 0.1, Math.PI / 2);
    S.solids.push({ x0: -hw, x1: -hw + 0.92, z0: vz - 0.5, z1: vz + 0.5 });
    S.solids.push({ x0: hw - 1.0, x1: hw, z0: vz - 0.8, z1: vz + 0.6 });
    // restroom + ATM sign on the left wall, between the storefront and the first chair
    const rz = -hd + 1.25;
    const rdoor = new THREE.Group(); rdoor.position.set(-hw + 0.02, 0, rz); rdoor.rotation.y = -Math.PI / 2; g.add(rdoor);
    box(0.9, 2.1, 0.05, std(K.chair.gold ? 0x1a1a1a : 0x5a3f2a, 0.5), 0, 1.05, -0.03, rdoor);
    box(0.06, 0.2, 0.05, std(K.accent, 0.3, 1), 0.33, 1.05, -0.07, rdoor);
    const rs = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), new THREE.MeshBasicMaterial({ map: signTex("ATM & RESTROOM", "", "#9fe0ff", "'Segoe UI', sans-serif"), transparent: true, toneMapped: false }));
    rs.position.set(0, 2.32, -0.07); rs.rotation.y = Math.PI; rdoor.add(rs);

    // ---------------------------------------------------------------- lights
    const hemi = new THREE.HemisphereLight(0xfff2e0, 0x2a2018, K.hemiI); g.add(hemi);
    const key = new THREE.DirectionalLight(K.warm, K.keyI);
    key.position.set(W * 0.25, H + 6, hd + 3); key.target.position.set(0, 0, -1); g.add(key); g.add(key.target);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera, ext = Math.max(W, D) * 0.62;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = H + 20;
    key.shadow.bias = -0.0006; key.shadow.normalBias = 0.02;
    S.key = key;
    const fill = new THREE.PointLight(K.warm, kind === "large" ? 2.4 : 1.6, Math.max(W, D) * 1.2, 1.6);
    fill.position.set(0, H - 0.3, -hd + 2); g.add(fill);
    const rim = new THREE.PointLight(0x8fb4ff, 0.7, 10, 2); rim.position.set(0, 2.4, -hd - 1.2); g.add(rim);

    // ---------------------------------------------------------------- dressing per kind
    dress(S, K);
    return S;
  }

  // Lamps and the extra furniture that makes each room its own.
  function dress(S, K) {
    const g = S.group, W = S.W, D = S.D, H = S.H, hw = W / 2, hd = D / 2;
    solidsOut = S.solids;
    // lamps over the aisle (they hang from above the top of the view)
    const n = Math.max(2, Math.round(D / 3));
    for (let i = 0; i < n; i++) {
      const z = -hd + 1.8 + i * ((D - 3.2) / Math.max(1, n - 1));
      if (K.lamp === "tube") {
        box(1.4, 0.05, 0.14, std(0xdddddd, 0.5, 0.4), 0, H - 0.25, z, g);
        box(1.3, 0.035, 0.07, glow(0xeef8ff), 0, H - 0.285, z, g);
        cyl(0.005, 0.005, 0.4, std(0x111111), -0.6, H - 0.05, z, g); cyl(0.005, 0.005, 0.4, std(0x111111), 0.6, H - 0.05, z, g);
      } else if (K.lamp === "edison") {
        [-1, 1].forEach(function (s) {
          cyl(0.006, 0.006, 0.9, std(0x111111), s * 0.9, H - 0.45, z, g);
          mesh(new THREE.SphereGeometry(0.07, 12, 10), glow(0xffc46b), s * 0.9, H - 0.95, z, g);
          cyl(0.03, 0.03, 0.06, std(0x8a6a3a, 0.4, 1), s * 0.9, H - 0.88, z, g);
        });
      } else if (K.lamp === "track") {
        box(0.06, 0.06, D * 0.7, std(0x111111, 0.4, 0.6), -1.3, H - 0.2, 0, g); box(0.06, 0.06, D * 0.7, std(0x111111, 0.4, 0.6), 1.3, H - 0.2, 0, g);
        for (let k = 0; k < 3; k++) [-1.3, 1.3].forEach(function (x) { cyl(0.05, 0.07, 0.14, std(0x1a1a1a, 0.4, 0.6), x, H - 0.3, z - 0.6 + k * 0.6, g); mesh(new THREE.CircleGeometry(0.05, 12), glow(0xfff0d0), x, H - 0.375, z - 0.6 + k * 0.6, g, { rx: Math.PI / 2 }); });
      } else if (K.lamp === "chandelier" && i % 2 === 0) {
        const c = new THREE.Group(); c.position.set(0, H - 1.0, z); g.add(c);
        cyl(0.01, 0.01, 1.0, std(0xd8b347, 0.3, 1), 0, 0.5, 0, c);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.025, 8, 40), std(0xd8b347, 0.25, 1)); ring.rotation.x = Math.PI / 2; c.add(ring);
        const ring2 = ring.clone(); ring2.scale.setScalar(0.6); ring2.position.y = -0.22; c.add(ring2);
        const crystal = glow(0xfff4d8);
        for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2; const cr = mesh(new THREE.OctahedronGeometry(0.045), crystal, Math.cos(a) * 0.55, -0.1, Math.sin(a) * 0.55, c); cr.scale.y = 2; }
        for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; const cr = mesh(new THREE.OctahedronGeometry(0.035), crystal, Math.cos(a) * 0.33, -0.32, Math.sin(a) * 0.33, c); cr.scale.y = 2; }
        // each chandelier actually lights the room (no shadows: they're cheap point lights)
        const cl = new THREE.PointLight(0xffe2b0, 2.2, 9, 1.6); cl.position.set(0, -0.5, 0); c.add(cl);
        S.anim.push(function (t) { c.rotation.y = Math.sin(t * 0.25 + z) * 0.08; });
      }
    }
    const has = function (d) { return K.decor.indexOf(d) !== -1; };
    // rental: somebody else's shop, and it shows
    if (has("posters")) {
      const p1 = poster("FRESH\nCUTS", "WALK-INS WELCOME", "#e9dcc0", "#8e1f1f"), p2 = poster("CASH\nONLY", "NO CHECKS. NO CREDIT.", "#1f2f4f", "#e6c866");
      // between the two mirrors on each wall
      const mid = (S.stations[0].z + S.stations[S.stations.length - 1].z) / 2;
      [[p1, -1], [p2, 1]].forEach(function (q) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.87), std(0xffffff, 0.9, 0, { map: q[0] }));
        m.position.set(q[1] * (hw - 0.01), 1.75, mid); m.rotation.y = q[1] < 0 ? Math.PI / 2 : -Math.PI / 2; g.add(m);
      });
    }
    if (has("rentsign")) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.34), std(0xffffff, 0.8, 0, { map: tex(512, 160, function (c, w, h) { c.fillStyle = "#f4f0e6"; c.fillRect(0, 0, w, h); c.fillStyle = "#b02a2a"; c.font = "700 54px 'Segoe UI', sans-serif"; c.textAlign = "center"; c.fillText("CHAIR RENT $200/WK", w / 2, 70); c.fillStyle = "#333"; c.font = "500 30px 'Segoe UI', sans-serif"; c.fillText("pay the front desk every monday", w / 2, 125); }) }));
      m.position.set(hw - 0.01, 2.35, S.stations[S.stations.length - 1].z + 1.0); m.rotation.y = -Math.PI / 2; g.add(m);
    }
    if (has("radiator")) {
      const r = std(0xb9b2a4, 0.6, 0.4);
      for (let k = 0; k < 8; k++) box(0.05, 0.6, 0.12, r, -hw + 0.12, 0.42, 1.9 + k * 0.08, g);
      S.solids.push({ x0: -hw, x1: -hw + 0.22, z0: 1.8, z1: 2.6 });
    }
    if (has("plant")) plant(g, hw - 0.4, -hd + 1.35, 0.9);
    // small: your own place, done with care
    if (has("plants")) {
      plant(g, hw - 0.4, -hd + 1.3, 1);
      if (S.kind === "small") plant(g, -hw + 0.4, -hd + 2.0, 1);
      else if (S.kind === "medium") plant(g, hw - 0.45, hd - 2.2, 1.2);
      else plant(g, hw - 0.45, 1.9, 1.2);
    }
    if (has("frames")) {
      [[-1, -hd + 2.1], [1, -hd + 2.1], [-1, 1.0]].forEach(function (f, k) {
        const t = poster(["THE\nFADE", "STAY\nSHARP", "BUILT\nNOT\nBOUGHT"][k], "EST. WEEK 1", ["#16376d", "#2a1f06", "#8e1f1f"][k], "#e6c866");
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), std(0xffffff, 0.8, 0, { map: t }));
        const s = f[0];
        m.position.set(s * (hw - 0.01), 2.1, f[1]); m.rotation.y = s < 0 ? Math.PI / 2 : -Math.PI / 2; g.add(m);
        box(0.03, 0.76, 0.56, std(0xc9a227, 0.3, 1), s * (hw - 0.005), 2.1, f[1], g);
      });
    }
    if (has("records")) {
      box(0.9, 0.7, 0.42, std(0x3a2618, 0.6), hw - 0.3, 0.35, 1.6, g, { cast: true });
      S.solids.push({ x0: hw - 0.78, x1: hw, z0: 1.36, z1: 1.84 });
      cyl(0.17, 0.17, 0.02, std(0x0a0a0a, 0.3), hw - 0.3, 0.72, 1.6, g);
      S.anim.push((function () { const disc = g.children[g.children.length - 1]; return function (t) { disc.rotation.y = t * 3.5; }; })());
    }
    if (has("armchair")) {
      const a = new THREE.Group(); a.position.set(-hw + 1.0, 0, hd - 2.3); a.rotation.y = -Math.PI / 2 - 0.5; g.add(a);
      S.solids.push({ x: -hw + 1.0, z: hd - 2.3, r: 0.52 });
      const lm = std(0x6b3a1e, 0.5);
      box(0.8, 0.4, 0.75, lm, 0, 0.25, 0, a, { cast: true }); box(0.8, 0.6, 0.18, lm, 0, 0.7, 0.3, a, { cast: true });
      box(0.14, 0.3, 0.75, lm, -0.38, 0.55, 0, a); box(0.14, 0.3, 0.75, lm, 0.38, 0.55, 0, a);
    }
    // medium + large: a lounge with a sofa and a TV
    if (has("lounge")) {
      const big = S.kind === "large";
      const sofaZ = big ? hd - 4.1 : hd - 2.6, sofaX = -hw + 1.1;
      const sofa = bench(K, big ? 2.4 : 2.0, g, sofaX, sofaZ, -Math.PI / 2);
      sofa.scale.set(1, 1, 1.25);
      const seats = [], len = big ? 2.4 : 2.0;
      for (let i = 0; i < 3; i++) seats.push(new THREE.Vector3(sofaX, 0, sofaZ + (i - 1) * (len / 3)));
      S.benches.push({ x: sofaX, z: sofaZ, yaw: -Math.PI / 2, seatY: 0.48, seats: seats });
      S.solids.push({ x0: -hw, x1: sofaX + 0.34, z0: sofaZ - len / 2, z1: sofaZ + len / 2 });
      S.solids.push({ x0: sofaX + 0.75, x1: sofaX + 1.35, z0: sofaZ - 0.3, z1: sofaZ + 0.3 });
      box(0.9, 0.06, 0.5, std(K.chair.gold ? 0x0e0e0e : 0x3a2618, 0.3, 0.2), sofaX + 1.05, 0.42, sofaZ, g, { cast: true });
      cyl(0.04, 0.06, 0.4, std(K.accent, 0.3, 1), sofaX + 1.05, 0.2, sofaZ, g);
    }
    if (has("rug")) mesh(new THREE.PlaneGeometry(2.6, 3.4), std(0x6e1d1d, 0.95, 0, { map: tex(256, 320, function (c, w, h) { c.fillStyle = "#6e1d1d"; c.fillRect(0, 0, w, h); c.strokeStyle = "#c9a227"; c.lineWidth = 8; c.strokeRect(14, 14, w - 28, h - 28); c.lineWidth = 3; c.strokeRect(30, 30, w - 60, h - 60); }) }), 0, 0.005, -0.4, g, { rx: -Math.PI / 2 });
    if (has("runner")) mesh(new THREE.PlaneGeometry(1.5, D - 1.4), std(0x2a0d0d, 0.95, 0, { map: tex(128, 512, function (c, w, h) { c.fillStyle = "#3a0f12"; c.fillRect(0, 0, w, h); c.fillStyle = "#d8b347"; c.fillRect(8, 0, 5, h); c.fillRect(w - 13, 0, 5, h); }) }), 0, 0.005, 0.2, g, { rx: -Math.PI / 2 });
    if (has("tv")) {
      const big = S.kind === "large";
      const tv = new THREE.Group(); tv.position.set(hw - 0.04, 2.2, big ? hd - 3.4 : hd - 2.9); tv.rotation.y = -Math.PI / 2; g.add(tv);
      box(1.5, 0.86, 0.06, std(0x0a0a0a, 0.3, 0.4), 0, 0, 0, tv);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 0.78), new THREE.MeshBasicMaterial({ color: 0x223355, toneMapped: false }));
      screen.position.z = -0.035; screen.rotation.y = Math.PI; tv.add(screen);
      S.anim.push(function (t) { const k = 0.5 + 0.5 * Math.sin(t * 0.6); screen.material.color.setRGB(0.12 + 0.15 * k, 0.22 + 0.1 * Math.sin(t * 1.3), 0.38 - 0.12 * k); });
    }
    if (has("shelves")) {
      for (let k = 0; k < 3; k++) {
        box(1.4, 0.04, 0.3, std(0x3a2618, 0.5), hw - 0.17, 1.4 + k * 0.42, -hd + 1.35, g, { ry: Math.PI / 2 });
        for (let j = 0; j < 5; j++) cyl(0.04, 0.04, 0.16, std([0xc9a227, 0x111111, 0xe8e8e8][(j + k) % 3], 0.35, (j + k) % 3 === 0 ? 0.9 : 0.1), hw - 0.17, 1.5 + k * 0.42, -hd + 0.8 + j * 0.27, g);
      }
    }
    if (has("bar")) {
      // the espresso bar on the right wall, under the TV, facing the lounge across the aisle
      const bz = hd - 3.2, bx = hw - 0.55;
      S.solids.push({ x0: hw - 1.35, x1: hw, z0: bz - 1.2, z1: bz + 1.2 });
      S.solids.push({ x: bx - 1.15, z: bz - 0.4, r: 0.22 }, { x: bx - 1.15, z: bz + 0.4, r: 0.22 });
      box(0.7, 1.05, 2.2, std(0x0e0e0e, 0.3, 0.3), bx - 0.4, 0.525, bz, g, { cast: true });
      box(0.8, 0.05, 2.3, std(0xd8b347, 0.25, 1), bx - 0.4, 1.075, bz, g);
      box(0.4, 0.42, 0.36, std(0xb8bcc2, 0.25, 1), bx - 0.25, 1.31, bz - 0.5, g, { cast: true });
      for (let k = 0; k < 3; k++) cyl(0.04, 0.035, 0.08, std(0xf2efe8, 0.4), bx - 0.5, 1.14, bz + 0.2 + k * 0.2, g);
      for (let k = 0; k < 2; k++) { cyl(0.2, 0.2, 0.05, std(0x2a1a12, 0.45), bx - 1.15, 0.74, bz - 0.4 + k * 0.8, g, { cast: true }); cyl(0.03, 0.03, 0.72, std(0xd8b347, 0.3, 1), bx - 1.15, 0.36, bz - 0.4 + k * 0.8, g); }
    }
    if (has("art")) {
      for (let k = 0; k < 2; k++) {
        const t = tex(256, 256, function (c, w, h) { const gr = c.createLinearGradient(0, 0, w, h); gr.addColorStop(0, k ? "#c9a227" : "#16376d"); gr.addColorStop(1, k ? "#2a1f06" : "#c4322c"); c.fillStyle = gr; c.fillRect(0, 0, w, h); c.strokeStyle = "rgba(255,255,255,.5)"; c.lineWidth = 6; for (let i = 0; i < 5; i++) { c.beginPath(); c.arc(w / 2, h / 2, 20 + i * 22, i, i + 2.5); c.stroke(); } });
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), std(0xffffff, 0.8, 0, { map: t }));
        const s = k ? 1 : -1;
        m.position.set(s * (hw - 0.01), 3.35, -hd + 3 + k * 4); m.rotation.y = s < 0 ? Math.PI / 2 : -Math.PI / 2; g.add(m);
      }
      // gold pilasters between the stations
      for (let z = -hd + 1.3; z < hd - 1; z += 2.5) [-1, 1].forEach(function (s) { if (s < 0 && Math.abs(z - (-hd + 1.25)) < 0.7) return; box(0.04, S.H - 1.1, 0.08, std(0xd8b347, 0.25, 1), s * (hw - 0.03), 1.05 + (S.H - 1.1) / 2, z, g); });
    }
  }

  HS.Shop = {
    KINDS: KINDS,
    build: build,
    // Keep a walker (circle radius r) inside the room and out of the furniture.
    collide: function (S, p, r) {
      const hw = S.W / 2, hd = S.D / 2;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < S.solids.length; i++) {
          const o = S.solids[i];
          let cx, cz, rr;
          if (o.r !== undefined) { cx = o.x; cz = o.z; rr = o.r; }
          else { cx = Math.max(o.x0, Math.min(p.x, o.x1)); cz = Math.max(o.z0, Math.min(p.z, o.z1)); rr = 0; }
          let dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
          const need = r + rr;
          if (d >= need) continue;
          if (d < 1e-5) { dx = 0; dz = 1; d = 1; }        // dead centre of a box: push toward the camera
          p.x = cx + dx / d * need; p.z = cz + dz / d * need;
        }
        p.x = Math.max(-hw + 0.25, Math.min(hw - 0.25, p.x));
        p.z = Math.max(-hd + 0.35, Math.min(hd - 0.25, p.z));
      }
      return p;
    },
    update: function (S, t, dt) {
      for (let i = 0; i < S.anim.length; i++) S.anim[i](t);
      // the door swings out while someone is passing through it (World sets doorWant)
      S.doorT = (S.doorT || 0) + ((S.doorWant ? 1 : 0) - (S.doorT || 0)) * Math.min(1, (dt || 0.016) * 5);
      S.doorMesh.rotation.y = S.doorT * 1.35;
    },
    // Merch stock 0..1: shirts disappear from the stacks as the week sells them.
    setMerch: function (S, frac, active) {
      const per = S.merch.stacks[0].length, left = Math.round(frac * per);
      S.merch.stacks.forEach(function (st, k) { st.forEach(function (m, i) { m.visible = i < Math.max(k === 0 ? 1 : 0, left - (k % 2)); }); });
      S.merch.sign.material.opacity = active ? 1 : 0.35;
    },
    setVending: function (S, on) {
      S.vending.front.emissiveIntensity = on ? 0.75 : 0.08;
      S.vending.strip.opacity = on ? 0.95 : 0.25;
    },
    dispose: function (S) {
      S.group.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        ms.forEach(function (m) { if (m.map) m.map.dispose(); if (!Object.values(cache).includes(m)) m.dispose(); });
      });
    }
  };
})(globalThis.HS);
