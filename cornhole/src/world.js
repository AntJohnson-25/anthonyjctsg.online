// The backyard: lawn, two regulation boards, bags, fence, trees, string lights. Everything is built in code;
// textures are painted on canvases at run time (nothing to download).
(function (SB) {
  "use strict";
  const T = globalThis.THREE;
  const CH = SB.Cornhole, C = CH.C;
  const AL = Math.atan((C.HB - C.HF) / C.BL), COS = Math.cos(AL), SIN = Math.sin(AL);
  const SIDE_COL = [0x2f6df0, 0xff7a1a];                  // side 0 blue, side 1 orange
  const SIDE_CSS = ["#4f86ff", "#ff8a35"];

  function canvas(w, h, draw) { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; return t; }
  function rnd(seed) { let a = seed; return function () { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }

  // A soft round glow, for halos round lamps (additive sprites and points are far cheaper than real lights).
  function glowTex(inner) {
    return canvas(128, 128, function (g) {
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(inner || 0.15, "rgba(255,255,255,0.55)"); gr.addColorStop(0.5, "rgba(255,255,255,0.12)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    });
  }

  // ---- textures
  // Artificial turf: a dark backing showing between rows of short, bright, slightly curled blades, with a few tan
  // thatch strands. The tile is 1.2 m across (so the pile reads as fine from the camera and coarser close up).
  const TURF_TILE = 1.2;
  function turfTex() {
    const r = rnd(7);
    const t = canvas(512, 512, function (g, w, h) {
      g.fillStyle = "#2f6a2a"; g.fillRect(0, 0, w, h);                                   // the backing / shadowed base
      const rows = 64, rh = h / rows;                                                    // stitched rows run along x
      for (let row = 0; row < rows; row++) {
        const y0 = row * rh;
        g.fillStyle = "rgba(10,40,14," + (0.16 + (row % 2) * 0.1) + ")"; g.fillRect(0, y0 + rh * 0.7, w, rh * 0.3);          // the gap between rows
        for (let i = 0; i < 70; i++) {
          const x = r() * w, y = y0 + rh * (0.1 + r() * 0.8), len = 5 + r() * 6, lean = (r() - 0.5) * 5;
          const thatch = r() < 0.045;
          g.strokeStyle = thatch ? "hsla(" + (48 + r() * 12) + ",38%," + (50 + r() * 14) + "%,0.85)" : "hsla(" + (88 + r() * 24) + "," + (58 + r() * 22) + "%," + (30 + r() * 24) + "%,0.92)";
          g.lineWidth = 1 + r() * 0.8;
          g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + lean * 0.4, y - len * 0.6, x + lean, y - len); g.stroke();
        }
      }
      for (let i = 0; i < 1400; i++) { g.fillStyle = "rgba(255,255,200," + (0.04 + r() * 0.07) + ")"; g.fillRect(r() * w, r() * h, 1, 2); }     // sun on the tips
    });
    t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(400 / TURF_TILE, 400 / TURF_TILE);
    return t;
  }
  const boardTexCache = {};
  function boardTex(side, logo, hl) {
    return boardTexCache[side] || (boardTexCache[side] = paintBoard(side, logo, hl));
  }
  function paintBoard(side, logo, hl) {
    const w = 512, h = 1024;                                  // x = across (2 ft), y = along (4 ft); y=0 is the back edge in canvas, u runs up
    const base = side ? "#d9611a" : "#2358c4", dark = side ? "#a8460f" : "#173f8f";
    return canvas(w, h, function (g) {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      const r = rnd(side + 3);
      for (let i = 0; i < 110; i++) { g.strokeStyle = "rgba(0,0,0," + (0.02 + r() * 0.05) + ")"; g.lineWidth = 1 + r() * 2; g.beginPath(); const y = r() * h; g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + (r() - 0.5) * 14, w * 0.6, y + (r() - 0.5) * 14, w, y + (r() - 0.5) * 8); g.stroke(); }
      g.fillStyle = "#f7f2e6"; g.fillRect(0, 0, w, 22); g.fillRect(0, h - 22, w, 22); g.fillRect(0, 0, 22, h); g.fillRect(w - 22, 0, 22, h);
      g.strokeStyle = dark; g.lineWidth = 6; g.strokeRect(34, 34, w - 68, h - 68);
      // the hole sits 12 in from the back edge (canvas top): ring it
      const hy = h * (0.25), hr = h * (C.HOLE_R / C.BL) * 1.45;
      g.strokeStyle = "#f7f2e6"; g.lineWidth = 10; g.beginPath(); g.arc(w / 2, hy, hr, 0, 7); g.stroke();
      g.fillStyle = "#f7f2e6"; g.fillRect(w / 2 - 6, h * 0.42, 12, h * 0.16);
      if (logo) { const s = 170, y = h * 0.68; g.globalAlpha = 0.95; g.drawImage(logo, w / 2 - s / 2, y - s / 2, s, s); g.globalAlpha = 1; }
      if (hl) {                                                // the HopLobby wordmark is made for dark, so it sits on a dark plate
        const pw = 380, ph = 96, px = w / 2 - pw / 2, py = h * 0.88 - ph / 2, lw = pw - 36, lh = lw * hl.height / hl.width;
        g.fillStyle = "#14181f"; g.beginPath(); g.roundRect(px, py, pw, ph, 18); g.fill();
        g.drawImage(hl, w / 2 - lw / 2, py + (ph - lh) / 2, lw, lh);
      }
    });
  }
  function clothTex(col) {
    const css = "#" + col.toString(16).padStart(6, "0");
    return canvas(128, 128, function (g, w, h) {
      g.fillStyle = css; g.fillRect(0, 0, w, h);
      const r = rnd(col);
      for (let i = 0; i < 700; i++) { g.fillStyle = "rgba(255,255,255," + (r() * 0.07) + ")"; g.fillRect(r() * w, r() * h, 2, 1); g.fillStyle = "rgba(0,0,0," + (r() * 0.07) + ")"; g.fillRect(r() * w, r() * h, 1, 2); }
      g.strokeStyle = "rgba(255,255,255,0.85)"; g.setLineDash([6, 5]); g.lineWidth = 2; g.strokeRect(9, 9, w - 18, h - 18);
    });
  }
  function woodTex(base) {
    const r = rnd(11);
    return canvas(128, 128, function (g, w, h) {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) { g.strokeStyle = "rgba(0,0,0," + (0.05 + r() * 0.1) + ")"; g.beginPath(); g.moveTo(0, r() * h); g.lineTo(w, r() * h); g.stroke(); }
    });
  }

  // ---- the boards
  function slopeBasis() {                                       // shape (x, u, z) -> x, along the slope, DOWN from the surface
    const m = new T.Matrix4();
    m.makeBasis(new T.Vector3(1, 0, 0), new T.Vector3(0, SIN, COS), new T.Vector3(0, -COS, SIN));
    return m;
  }
  function makeBoard(side, logo, hl) {
    const g = new T.Group();
    const L = C.BL / COS, W = C.BW, th = 0.024;
    const sh = new T.Shape();
    sh.moveTo(-W / 2, 0); sh.lineTo(W / 2, 0); sh.lineTo(W / 2, L); sh.lineTo(-W / 2, L); sh.lineTo(-W / 2, 0);
    const hole = new T.Path(); hole.absarc(0, C.HOLE_U / COS, C.HOLE_R, 0, Math.PI * 2, true); sh.holes.push(hole);
    const geo = new T.ExtrudeGeometry(sh, { depth: th, bevelEnabled: false, curveSegments: 28 });
    geo.applyMatrix4(slopeBasis());
    geo.translate(0, C.HF, 0);
    // top-face uv: x across, u along (the canvas has the back edge at the top)
    const uv = geo.attributes.uv, pos = geo.attributes.position;
    for (let i = 0; i < uv.count; i++) { const x = pos.getX(i), y = pos.getY(i); uv.setXY(i, 0.5 - x / W,(y - C.HF) / (C.HB - C.HF)); }
    const tex = boardTex(side, logo, hl);
    const top = new T.Mesh(geo, [new T.MeshStandardMaterial({ map: tex, roughness: 0.55 }), new T.MeshStandardMaterial({ color: 0xe9dcc0, roughness: 0.85 })]);
    top.castShadow = true; top.receiveShadow = true;
    g.add(top);
    // rails (2x4 on the flat) along both sides, front and back; and four legs
    const wood = new T.MeshStandardMaterial({ map: woodTex("#c9a56b"), roughness: 0.9 });
    const rail = function (x, len) { const m = new T.Mesh(new T.BoxGeometry(0.038, 0.089, len), wood); m.position.set(x, 0, 0); m.castShadow = true; return m; };
    [-1, 1].forEach(function (s) {
      const r = rail(s * (W / 2 - 0.019), L); r.position.set(s * (W / 2 - 0.019), (C.HF + C.HB) / 2 - 0.05, C.BL / 2);
      r.rotation.x = -AL; r.scale.set(1, 1, 1); g.add(r);
    });
    const front = new T.Mesh(new T.BoxGeometry(W, 0.089, 0.038), wood); front.position.set(0, C.HF - 0.052, 0.02); front.castShadow = true; g.add(front);
    const back = new T.Mesh(new T.BoxGeometry(W, 0.089, 0.038), wood); back.position.set(0, C.HB - 0.052, C.BL - 0.02); back.castShadow = true; g.add(back);
    [[-1, C.BL - 0.07, C.HB - 0.1], [1, C.BL - 0.07, C.HB - 0.1], [-1, 0.07, C.HF - 0.1], [1, 0.07, C.HF - 0.1]].forEach(function (a) {
      const lh = a[2] + 0.1, leg = new T.Mesh(new T.BoxGeometry(0.045, lh, 0.045), wood);
      leg.position.set(a[0] * (W / 2 - 0.045), lh / 2 - 0.1 + 0.0, a[1]); leg.castShadow = true; g.add(leg);
    });
    return g;
  }

  // ---- a bag: puffy cloth square
  const bagGeo = (function () {
    const s = 0.152, geo = new T.BoxGeometry(s, 0.034, s, 7, 2, 7);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), r = Math.max(Math.abs(x), Math.abs(z)) / (s / 2);
      const puff = 1 - r * r * 0.55;                                  // thick in the middle, thin at the seams
      p.setY(i, y * (0.6 + 0.9 * puff) + (y > 0 ? 0.003 : -0.003) * puff);
      const cut = Math.min(1, r) > 0.9 ? 0.985 : 1;                   // soften the corners a touch
      p.setX(i, x * cut); p.setZ(i, z * cut);
    }
    geo.computeVertexNormals();
    return geo;
  })();
  const bagMats = [0, 1].map(function (s) { return new T.MeshStandardMaterial({ map: clothTex(SIDE_COL[s]), roughness: 0.95 }); });
  function makeBag(side) {
    const m = new T.Mesh(bagGeo, bagMats[side]);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  // ---- the yard
  function build(scene, logoImg, hlLogo, detail) {
    const W = { scene: scene, boards: [], sun: null, lights: [] };
    // ---- the night (the look of Rooftop Spades): a gradient sky glowing at the horizon, stars, the moon, dark fog
    const sky = new T.Mesh(new T.SphereGeometry(170, 32, 20), new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new T.Color(0x060a1c) }, mid: { value: new T.Color(0x1c2550) }, hor: { value: new T.Color(0x6a4a6e) }, glow: { value: new T.Color(0xd08a5a) } },
      vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader: "uniform vec3 top; uniform vec3 mid; uniform vec3 hor; uniform vec3 glow; varying vec3 vP;" +
        "void main(){ float h = vP.y; vec3 c = mix(hor, mid, smoothstep(-0.02, 0.18, h)); c = mix(c, top, smoothstep(0.18, 0.75, h));" +
        "float n = smoothstep(0.35, -0.05, h) * (0.55 + 0.45 * max(0.0, -vP.z)); c = mix(c, glow, n * 0.45); gl_FragColor = vec4(c, 1.0); }"
    }));
    scene.add(sky);
    scene.fog = new T.Fog(0x1a1d36, 38, 115);
    const sr = rnd(77), sn = detail === 0 ? 700 : 1500, sp = new Float32Array(sn * 3), sc2 = new Float32Array(sn * 3);
    for (let i = 0; i < sn; i++) {
      const v = new T.Vector3(sr() * 2 - 1, 0.08 + sr() * 0.92, sr() * 2 - 1).normalize().multiplyScalar(160);
      sp[i * 3] = v.x; sp[i * 3 + 1] = v.y; sp[i * 3 + 2] = v.z;
      const k = 0.4 + sr() * 0.6; sc2[i * 3] = k; sc2[i * 3 + 1] = k; sc2[i * 3 + 2] = k * (0.9 + sr() * 0.2);
    }
    const sg = new T.BufferGeometry(); sg.setAttribute("position", new T.BufferAttribute(sp, 3)); sg.setAttribute("color", new T.BufferAttribute(sc2, 3));
    scene.add(new T.Points(sg, new T.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85, fog: false, depthWrite: false })));
    const moonTex = canvas(256, 256, function (g) {
      const gr = g.createRadialGradient(118, 112, 10, 128, 128, 120); gr.addColorStop(0, "#fffbe8"); gr.addColorStop(1, "#d9d2bc");
      g.fillStyle = gr; g.beginPath(); g.arc(128, 128, 120, 0, 6.2832); g.fill();
      const mr = rnd(5); for (let i = 0; i < 18; i++) { g.fillStyle = "rgba(150,140,120," + (0.12 + mr() * 0.18) + ")"; g.beginPath(); g.arc(50 + mr() * 156, 50 + mr() * 156, 6 + mr() * 20, 0, 6.2832); g.fill(); }
    });
    const moonDir = new T.Vector3(-0.45, 0.42, -0.79).normalize();
    const moon = new T.Sprite(new T.SpriteMaterial({ map: moonTex, fog: false, depthWrite: false }));
    moon.position.copy(moonDir).multiplyScalar(150); moon.scale.set(16, 16, 1); scene.add(moon);
    const halo = new T.Sprite(new T.SpriteMaterial({ map: glowTex(0.05), color: 0xbfd0ff, transparent: true, opacity: 0.5, fog: false, depthWrite: false, blending: T.AdditiveBlending }));
    halo.position.copy(moonDir).multiplyScalar(149); halo.scale.set(95, 95, 1); scene.add(halo);
    // ---- light: cool sky and moon, and the floodlights' warm key (the one that casts shadows)
    scene.add(new T.HemisphereLight(0x5a6aa8, 0x3a2a20, 0.5));
    const moonL = new T.DirectionalLight(0x9db0ff, 0.5); moonL.position.copy(moonDir).multiplyScalar(30); scene.add(moonL);
    const sun = new T.DirectionalLight(0xffe2b0, 1.3);
    sun.position.set(-5, 15, 3); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -9; sc.right = 9; sc.top = 9; sc.bottom = -9; sc.near = 1; sc.far = 40;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    scene.add(sun); scene.add(sun.target);
    W.sun = sun;
    // lawn
    const turf = turfTex();
    const lawn = new T.Mesh(new T.PlaneGeometry(400, 400), new T.MeshStandardMaterial({ map: turf, bumpMap: detail >= 1 ? turf : null, bumpScale: 0.6, roughness: 1, color: 0xe9f7e0 }));
    lawn.rotation.x = -Math.PI / 2; lawn.receiveShadow = true; scene.add(lawn);
    // the play mat: a slightly different pile between the boards, with painted lines round it
    const strip = new T.Mesh(new T.PlaneGeometry(2.6, 13.4), new T.MeshStandardMaterial({ color: 0x3f8f3a, roughness: 1, transparent: true, opacity: 0.5 }));
    strip.rotation.x = -Math.PI / 2; strip.position.y = 0.004; strip.receiveShadow = true; scene.add(strip);
    const lineMat = new T.MeshBasicMaterial({ color: 0xf4f4ee });
    [[-1.3, 0, 0.05, 13.4], [1.3, 0, 0.05, 13.4], [0, -6.7, 2.65, 0.05], [0, 6.7, 2.65, 0.05]].forEach(function (l) {
      const m = new T.Mesh(new T.PlaneGeometry(l[2], l[3]), lineMat); m.rotation.x = -Math.PI / 2; m.position.set(l[0], 0.006, l[1]); scene.add(m);
    });
    // turf roll seams (a 12 ft roll), running along the lane
    const seamMat = new T.MeshBasicMaterial({ color: 0x1f4a20, transparent: true, opacity: 0.28, depthWrite: false });
    for (let x = -3.66 * 3; x <= 3.66 * 3 + 0.01; x += 3.66) {
      const m = new T.Mesh(new T.PlaneGeometry(0.025, 31), seamMat); m.rotation.x = -Math.PI / 2; m.position.set(x + 0.9, 0.005, 0); scene.add(m);
    }

    // boards: board 0 at +z, board 1 at -z (the one facing the thrower is the target of the round)
    const logoCanvas = logoImg || null;
    [1, -1].forEach(function (dir, i) {
      const b = makeBoard(i, logoCanvas, hlLogo);
      b.position.z = dir * C.LANE;
      if (dir < 0) b.rotation.y = Math.PI;
      scene.add(b); W.boards.push(b);
    });
    // more lanes around the yard (set dressing, nobody throws at these). None stand on the +x side near the
    // overview camera, where they would block the view of the real lane.
    [[-5.4, 0], [-9.8, 1], [9.8, 1]].forEach(function (l) {
      [1, -1].forEach(function (dir, i) {
        const b = makeBoard((i + l[1]) % 2, logoCanvas, hlLogo);
        b.position.set(l[0], 0, dir * C.LANE);
        if (dir < 0) b.rotation.y = Math.PI;
        scene.add(b);
      });
    });

    // boundary: picket fence on a rectangle around the yard
    const fenceMat = new T.MeshStandardMaterial({ color: 0xf2eee4, roughness: 0.8 });
    const FX = 11.5, FZ = 15.5;
    const picket = new T.BoxGeometry(0.11, 1.5, 0.025);
    const nPick = Math.floor((FX * 2) / 0.2) * 2 + Math.floor((FZ * 2) / 0.2) * 2;
    const pk = new T.InstancedMesh(picket, fenceMat, nPick);
    const mtx = new T.Matrix4(), q = new T.Quaternion(), sc1 = new T.Vector3(1, 1, 1), pp = new T.Vector3();
    let n = 0;
    const row = function (x0, z0, x1, z1, rot) {
      const len = Math.hypot(x1 - x0, z1 - z0), cnt = Math.floor(len / 0.2);
      q.setFromAxisAngle(new T.Vector3(0, 1, 0), rot);
      for (let i = 0; i < cnt && n < nPick; i++) { const t = i / cnt; pp.set(x0 + (x1 - x0) * t, 0.75, z0 + (z1 - z0) * t); mtx.compose(pp, q, sc1); pk.setMatrixAt(n++, mtx); }
      const rl = new T.Mesh(new T.BoxGeometry(len, 0.08, 0.05), fenceMat);
      [0.35, 1.15].forEach(function (y) { const r = rl.clone(); r.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); r.rotation.y = rot === 0 ? 0 : Math.PI / 2; scene.add(r); });
    };
    row(-FX, -FZ, FX, -FZ, 0); row(-FX, FZ, FX, FZ, 0); row(-FX, -FZ, -FX, FZ, Math.PI / 2); row(FX, -FZ, FX, FZ, Math.PI / 2);
    pk.count = n; pk.castShadow = true; pk.receiveShadow = true; pk.instanceMatrix.needsUpdate = true; scene.add(pk);

    // where the turf ends: timber edging, then a strip of gravel against the fence
    const gravel = canvas(256, 256, function (g, w, h) {
      const gr = rnd(21); g.fillStyle = "#a89f8e"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 1800; i++) { const v = 90 + gr() * 120; g.fillStyle = "rgb(" + v + "," + (v - 6) + "," + (v - 18) + ")"; g.beginPath(); g.arc(gr() * w, gr() * h, 1 + gr() * 2.2, 0, 6.3); g.fill(); }
    });
    gravel.wrapS = gravel.wrapT = T.RepeatWrapping; gravel.repeat.set(24, 3);
    const gravelM = new T.MeshStandardMaterial({ map: gravel, roughness: 1 });
    const edgeM = new T.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 });
    [[0, -1, FX * 2, 0.5, true], [0, 1, FX * 2, 0.5, true], [-1, 0, 0.5, FZ * 2, false], [1, 0, 0.5, FZ * 2, false]].forEach(function (e) {
      const gp = new T.Mesh(new T.PlaneGeometry(e[2], e[3]), gravelM); gp.rotation.x = -Math.PI / 2;
      gp.position.set(e[0] * (FX - 0.25) * (e[4] ? 0 : 1), 0.003, e[1] * (FZ - 0.25) * (e[4] ? 1 : 0)); gp.receiveShadow = true; scene.add(gp);
      const eb = new T.Mesh(new T.BoxGeometry(e[4] ? FX * 2 : 0.1, 0.1, e[4] ? 0.1 : FZ * 2), edgeM);
      eb.position.set(e[0] * (FX - 0.5) * (e[4] ? 0 : 1), 0.05, e[1] * (FZ - 0.5) * (e[4] ? 1 : 0)); eb.castShadow = true; eb.receiveShadow = true; scene.add(eb);
    });

    // trees behind the fence
    const trunkM = new T.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 });
    const leafMs = [0x3f8a3b, 0x4b9a44, 0x2f7a3a].map(function (c) { return new T.MeshStandardMaterial({ color: c, roughness: 0.95, flatShading: true }); });
    const r2 = rnd(5);
    for (let i = 0; i < 26; i++) {
      const a = i / 26 * Math.PI * 2 + r2() * 0.2, rx = 19 + r2() * 8, rz = 23 + r2() * 8;
      const tr = new T.Group(), h = 3 + r2() * 3;
      const tk = new T.Mesh(new T.CylinderGeometry(0.25, 0.4, h, 7), trunkM); tk.position.y = h / 2; tk.castShadow = true; tr.add(tk);
      for (let k = 0; k < 3; k++) { const l = new T.Mesh(new T.IcosahedronGeometry(2.2 + r2() * 1.4, 1), leafMs[(i + k) % 3]); l.position.set((r2() - 0.5) * 2.2, h + 0.8 + k * 0.9, (r2() - 0.5) * 2.2); l.castShadow = true; tr.add(l); }
      tr.position.set(Math.cos(a) * rx, 0, Math.sin(a) * rz);
      scene.add(tr);
    }
    // yard furniture: picnic table, cooler, chairs, a banner on the fence
    const table = new T.Group(), woodM = new T.MeshStandardMaterial({ map: woodTex("#a77c4c"), roughness: 0.9 });
    const tp = new T.Mesh(new T.BoxGeometry(1.9, 0.06, 0.8), woodM); tp.position.y = 0.76; table.add(tp);
    [-0.7, 0.7].forEach(function (z) { const bn = new T.Mesh(new T.BoxGeometry(1.9, 0.05, 0.28), woodM); bn.position.set(0, 0.45, z * 0.95 + (z < 0 ? -0.1 : 0.1)); table.add(bn); });
    [-0.7, 0.7].forEach(function (x) { const lg = new T.Mesh(new T.BoxGeometry(0.07, 0.76, 1.5), woodM); lg.position.set(x, 0.38, 0); table.add(lg); });
    table.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    table.position.set(-8.2, 0, -1.5); table.rotation.y = 0.35; scene.add(table);
    const cooler = new T.Mesh(new T.BoxGeometry(0.7, 0.45, 0.42), new T.MeshStandardMaterial({ color: 0xd24b3a, roughness: 0.6 }));
    cooler.position.set(-7.6, 0.225, 2.6); cooler.rotation.y = 0.5; cooler.castShadow = true; scene.add(cooler);
    const lid = new T.Mesh(new T.BoxGeometry(0.72, 0.07, 0.44), new T.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.6 })); lid.position.set(-7.6, 0.48, 2.6); lid.rotation.y = 0.5; scene.add(lid);
    const chairM = new T.MeshStandardMaterial({ color: 0xf0c04a, roughness: 0.85 });
    [[7.6, -2.2, -0.3], [7.9, 0.2, -0.1], [7.4, 2.5, 0.3]].forEach(function (c) {
      const ch = new T.Group(), seat = new T.Mesh(new T.BoxGeometry(0.55, 0.06, 0.55), chairM); seat.position.y = 0.42; ch.add(seat);
      const bk = new T.Mesh(new T.BoxGeometry(0.55, 0.6, 0.06), chairM); bk.position.set(0, 0.72, 0.27); bk.rotation.x = 0.15; ch.add(bk);
      [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]].forEach(function (p) { const lg = new T.Mesh(new T.BoxGeometry(0.04, 0.42, 0.04), new T.MeshStandardMaterial({ color: 0x555555 })); lg.position.set(p[0], 0.21, p[1]); ch.add(lg); });
      ch.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
      ch.position.set(c[0], 0, c[1]); ch.rotation.y = -Math.PI / 2 + c[2]; scene.add(ch);
    });
    // banner on the far fence
    if (hlLogo) {
      const tex = new T.CanvasTexture(hlLogo); tex.colorSpace = T.SRGBColorSpace;
      const bn = new T.Mesh(new T.PlaneGeometry(4.2, 1.05), new T.MeshStandardMaterial({ map: tex, roughness: 0.9, side: T.DoubleSide }));
      bn.position.set(0, 1.9, -FZ + 0.1); scene.add(bn);
      const bn2 = bn.clone(); bn2.position.z = FZ - 0.1; bn2.rotation.y = Math.PI; scene.add(bn2);
    }
    // string lights over the lane, between the fence posts
    // (night: the bulbs glow: one merged mesh of lit bulbs plus one additive halo layer, no real lights for them)
    const bulbGeo = new T.SphereGeometry(0.07, 8, 6);
    const lightGroup = new T.Group();
    const bulbParts = [], bulbPos = [];
    [-4.8, 4.8].forEach(function (z) {
      const pts = [];
      for (let i = 0; i <= 40; i++) { const t = i / 40; pts.push(new T.Vector3(-FX + 0.4 + t * (FX * 2 - 0.8), 3.7 - Math.sin(t * Math.PI) * 0.5, z)); }
      const line = new T.Line(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: 0x222222 }));
      lightGroup.add(line);
      for (let i = 1; i < 40; i += 2) {
        const bp = pts[i].clone(); bp.y -= 0.06;
        bulbParts.push(bulbGeo.clone().translate(bp.x, bp.y, bp.z)); bulbPos.push(bp.x, bp.y, bp.z);
      }
    });
    lightGroup.add(new T.Mesh(SB.Merge(bulbParts, false), new T.MeshBasicMaterial({ color: 0xffd8a0, toneMapped: false })));
    {
      const hg = new T.BufferGeometry(); hg.setAttribute("position", new T.Float32BufferAttribute(bulbPos, 3));
      const halos = new T.Points(hg, new T.PointsMaterial({ map: glowTex(0.1), color: 0xffb860, size: 0.5, sizeAttenuation: true, transparent: true, opacity: 0.8, depthWrite: false, blending: T.AdditiveBlending }));
      halos.renderOrder = 5; lightGroup.add(halos);
    }
    // floodlight poles round the lane: playing under the lights
    const poleM = new T.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.6, metalness: 0.4 });
    const lampM = new T.MeshBasicMaterial({ color: 0xfff3d0, toneMapped: false });
    const lampPos = [];
    [[-5.2, -9.4], [5.2, -9.4], [-5.2, 9.4], [5.2, 9.4]].forEach(function (p) {
      const x = p[0], z = p[1];
      const pole = new T.Mesh(new T.CylinderGeometry(0.08, 0.12, 5.8, 10), poleM); pole.position.set(x, 2.9, z); pole.castShadow = true; lightGroup.add(pole);
      const head = new T.Group(); head.position.set(x, 5.8, z); head.rotation.set(0.42, Math.atan2(-x, -z), 0, "YXZ");
      const housing = new T.Mesh(new T.BoxGeometry(1.5, 0.85, 0.2), poleM); head.add(housing);
      for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) { const lamp = new T.Mesh(new T.CylinderGeometry(0.17, 0.17, 0.06, 14), lampM); lamp.rotation.x = Math.PI / 2; lamp.position.set(-0.45 + c * 0.45, -0.2 + r * 0.4, 0.12); head.add(lamp); }
      lightGroup.add(head);
      head.updateMatrixWorld(true);
      lampPos.push(new T.Vector3(0, 0, 0.3).applyMatrix4(head.matrixWorld));
      // a floodlight: a warm cone on the lane from the diagonal poles (medium and high only)
      if (detail >= 1 && (x * z > 0 || detail >= 2)) {
        const sl = new T.SpotLight(0xfff0d0, 60, 26, 0.7, 0.55, 1.4);
        sl.position.set(x, 5.7, z); sl.target.position.set(0, 0, 0); scene.add(sl); scene.add(sl.target);
      }
    });
    {
      const hg = new T.BufferGeometry(); hg.setAttribute("position", new T.Float32BufferAttribute(lampPos.flatMap(function (v) { return [v.x, v.y, v.z]; }), 3));
      const big = new T.Points(hg, new T.PointsMaterial({ map: glowTex(0.1), color: 0xfff0d0, size: 4.2, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false, blending: T.AdditiveBlending }));
      big.renderOrder = 6; big.frustumCulled = false; lightGroup.add(big);
    }
    // a soft warm spill from the string lights over each end of the lane
    if (detail >= 1) [-4.8, 4.8].forEach(function (z) { const pl = new T.PointLight(0xffb468, 4.5, 12, 1.6); pl.position.set(0, 3.2, z); scene.add(pl); });
    [-FX + 0.4, FX - 0.4].forEach(function (x) {                                // the poles they hang from
      [-4.8, 4.8].forEach(function (z) { const p = new T.Mesh(new T.CylinderGeometry(0.05, 0.06, 3.8, 6), trunkM); p.position.set(x, 1.9, z); p.castShadow = true; lightGroup.add(p); });
    });
    scene.add(lightGroup);

    // the dressing: grill, patio set, fire pit, shed, arbor, planters, hedges, gnomes ... (src/yard.js)
    if (SB.Yard) W.yard = SB.Yard.build(scene, detail, FX, FZ);

    // the aim guide: a thin strip laid on the ground along the throw
    const guide = new T.Mesh(new T.PlaneGeometry(0.07, 1), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false }));
    guide.rotation.x = -Math.PI / 2; guide.renderOrder = 3; guide.visible = false; scene.add(guide);
    W.guide = guide;
    return W;
  }

  SB.World = { build: build, makeBag: makeBag, SIDE_COL: SIDE_COL, SIDE_CSS: SIDE_CSS };
})(globalThis.SB);
