// The snow field as three.js objects: ground, sky, pond, pines, snowmen, forts and
// the mounds (which shrink as they're hit). Built once per match from the sim's field.
globalThis.SB = globalThis.SB || {};
(function (SB) {
  "use strict";
  const THREE = globalThis.THREE;
  const W = {};
  const TEAM_COL = [0x2f7bff, 0xff4a3d];   // blue, red

  function canvasTex(w, h, draw, repeatX, repeatY) {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    draw(cv.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX || 1, repeatY || 1);
    t.anisotropy = 4;
    return t;
  }
  function snowTexture() {
    return canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = "#eef4fb"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) {
        const v = Math.random();
        g.fillStyle = v < 0.5 ? "rgba(255,255,255,0.8)" : v < 0.85 ? "rgba(205,222,240,0.5)" : "rgba(170,196,225,0.35)";
        const s = 1 + Math.random() * 2.4;
        g.fillRect(Math.random() * w, Math.random() * h, s, s);
      }
    }, 46, 56);
  }
  function iceBlockTexture() {
    return canvasTex(128, 128, function (g, w, h) {
      g.fillStyle = "#cfe4f5"; g.fillRect(0, 0, w, h);
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const x = c * 32 + (r % 2 ? 16 : 0) - 16, y = r * 32;
          const k = 232 + Math.floor(Math.random() * 20);
          g.fillStyle = "rgb(" + (k - 30) + "," + (k - 10) + "," + k + ")";
          g.fillRect(x + 1.5, y + 1.5, 29, 29);
        }
      }
      g.strokeStyle = "rgba(120,160,200,0.7)"; g.lineWidth = 2;
      for (let r = 0; r <= 4; r++) { g.beginPath(); g.moveTo(0, r * 32); g.lineTo(w, r * 32); g.stroke(); }
    });
  }
  function dotTexture() {
    return canvasTex(32, 32, function (g, w, h) {
      const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.6, "rgba(255,255,255,0.8)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
  }
  W.dotTexture = dotTexture;

  function moundGeometry(seed) {
    const geo = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const p = geo.attributes.position;
    let s = seed;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const ph = [rnd() * 6, rnd() * 6, rnd() * 6];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 1 + 0.07 * Math.sin(x * 3 + ph[0]) * Math.cos(z * 3 + ph[1]) + 0.04 * Math.sin(y * 5 + ph[2]);
      p.setXYZ(i, x * n, y * (y < 0.02 ? 1 : n), z * n);
    }
    geo.computeVertexNormals();
    return geo;
  }

  W.build = function (sim, V) {
    const scene = V.scene, CFG = sim.cfg, field = sim.field;
    const world = { group: new THREE.Group(), moundMeshes: [], flags: [], snow: null };
    scene.add(world.group);
    const G = world.group;

    // --- sky + lights
    const sky = new THREE.Mesh(new THREE.SphereGeometry(420, 24, 12), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x6fa6df) }, mid: { value: new THREE.Color(0xc4dcf2) }, bot: { value: new THREE.Color(0xeaf2fa) } },
      vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.55)) : mix(mid, bot, clamp(-h * 4.0, 0.0, 1.0)); gl_FragColor = vec4(c, 1.0); }"
    }));
    sky.renderOrder = -10;
    G.add(sky);
    world.sky = sky;
    scene.fog = new THREE.FogExp2(0xdbe8f5, 0.0105);
    G.add(new THREE.HemisphereLight(0xcfe2ff, 0xe9f1fb, 0.95));
    const sun = new THREE.DirectionalLight(0xfff0d6, 2.1);
    sun.position.set(-26, 38, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = -36; sc.right = 36; sc.top = 36; sc.bottom = -36; sc.near = 5; sc.far = 120;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
    G.add(sun); G.add(sun.target);
    world.sun = sun;

    // --- ground + banks
    const snowTex = snowTexture();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(CFG.HX * 2 + 260, CFG.HZ * 2 + 260), new THREE.MeshStandardMaterial({ map: snowTex, roughness: 1, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    G.add(ground);
    // Far snow hills round the edge.
    const hillMat = new THREE.MeshStandardMaterial({ color: 0xf2f7fd, roughness: 1 });
    for (let i = 0; i < 26; i++) {
      const a = i / 26 * Math.PI * 2 + Math.random() * 0.2, rr = 1;
      const dx = Math.cos(a) * (CFG.HX + 55 + Math.random() * 40), dz = Math.sin(a) * (CFG.HZ + 50 + Math.random() * 40);
      const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), hillMat);
      hill.scale.set(30 + Math.random() * 30, 8 + Math.random() * 14, 30 + Math.random() * 30);
      hill.position.set(dx, 0, dz);
      G.add(hill);
    }
    // The frozen pond.
    const pond = new THREE.Mesh(new THREE.CircleGeometry(CFG.POND.r, 40), new THREE.MeshStandardMaterial({ color: 0xa9d6f0, roughness: 0.12, metalness: 0.15 }));
    pond.rotation.x = -Math.PI / 2; pond.position.set(CFG.POND.x, 0.03, CFG.POND.z);
    pond.receiveShadow = true;
    G.add(pond);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(CFG.POND.r + 0.15, 0.22, 8, 48), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }));
    rim.rotation.x = Math.PI / 2; rim.position.set(CFG.POND.x, 0.05, CFG.POND.z);
    G.add(rim);

    // --- pines (instanced): the solid ones from the sim plus a forest outside the field
    const trees = field.circles.filter((c) => c.kind === "tree").map((c) => ({ x: c.x, z: c.z, s: 0.95 + (c.r - 0.4) }));
    for (let i = 0; i < 260; i++) {
      const a = Math.random() * Math.PI * 2, k = 1.18 + Math.random() * 1.2;
      const x = Math.cos(a) * (CFG.HX + 5) * k * (1 + Math.random() * 0.4), z = Math.sin(a) * (CFG.HZ + 5) * k * 0.95;
      if (Math.abs(x) < CFG.HX + 3 && Math.abs(z) < CFG.HZ + 3) continue;
      trees.push({ x: x, z: z, s: 1 + Math.random() * 1.4 });
    }
    const green = new THREE.MeshStandardMaterial({ color: 0x2f5f45, roughness: 1 });
    const cap = new THREE.MeshStandardMaterial({ color: 0xf5faff, roughness: 1 });
    const bark = new THREE.MeshStandardMaterial({ color: 0x5a4332, roughness: 1 });
    const parts = [
      [new THREE.CylinderGeometry(0.13, 0.19, 1.2, 7), bark, 0.6],
      [new THREE.ConeGeometry(1.35, 2.3, 9), green, 1.9], [new THREE.ConeGeometry(1.35, 0.7, 9), cap, 2.62],
      [new THREE.ConeGeometry(1.0, 2.0, 9), green, 3.1], [new THREE.ConeGeometry(1.0, 0.6, 9), cap, 3.75],
      [new THREE.ConeGeometry(0.66, 1.7, 9), green, 4.15], [new THREE.ConeGeometry(0.66, 0.5, 9), cap, 4.7]
    ];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
    parts.forEach(function (pt) {
      const im = new THREE.InstancedMesh(pt[0], pt[1], trees.length);
      trees.forEach(function (t, i) {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i * 2.399) % 6.28);
        sv.set(t.s, t.s, t.s); pv.set(t.x, pt[2] * t.s, t.z);
        im.setMatrixAt(i, m4.compose(pv, q, sv));
      });
      im.castShadow = true; im.receiveShadow = true;
      G.add(im);
    });

    // --- snowmen
    field.circles.filter((c) => c.kind === "snowman").forEach(function (c) {
      const g = new THREE.Group(), white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
      const k = c.r / 0.55;
      [[0.55, 0.5], [0.42, 1.25], [0.3, 1.78]].forEach(function (s) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(s[0], 14, 10), white); m.position.y = s[1]; m.castShadow = true; g.add(m);
      });
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0xff8a1f }));
      nose.rotation.x = Math.PI / 2; nose.position.set(0, 1.8, 0.32); g.add(nose);
      const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.28, 12), new THREE.MeshStandardMaterial({ color: 0x222831 }));
      hat.position.y = 2.18; g.add(hat);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 14), hat.material); brim.position.y = 2.04; g.add(brim);
      const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.07, 8, 16), new THREE.MeshStandardMaterial({ color: 0xd94b3f }));
      scarf.rotation.x = Math.PI / 2; scarf.position.y = 1.52; g.add(scarf);
      [-0.1, 0.1].forEach(function (x) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), hat.material); e.position.set(x, 1.86, 0.27); g.add(e); });
      g.scale.setScalar(k); g.position.set(c.x, 0, c.z); g.rotation.y = Math.atan2(c.x, c.z) + Math.PI;
      G.add(g);
    });

    // --- forts
    const iceTex = iceBlockTexture();
    field.boxes.forEach(function (b) {
      const sx = b.x1 - b.x0, sz = b.z1 - b.z0, sign = (b.z0 + b.z1) / 2 > 0 ? 1 : -1;
      const tex = iceTex.clone(); tex.needsUpdate = true; tex.repeat.set(Math.max(1, Math.max(sx, sz) / 1.6), Math.max(1, b.h / 1.6));
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, b.h, sz), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
      m.position.set((b.x0 + b.x1) / 2, b.h / 2, (b.z0 + b.z1) / 2);
      m.castShadow = true; m.receiveShadow = true;
      G.add(m);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.1, 0.14, sz + 0.1), new THREE.MeshStandardMaterial({ color: TEAM_COL[sign > 0 ? 0 : 1], roughness: 0.6 }));
      trim.position.set(m.position.x, b.h + 0.07, m.position.z);
      G.add(trim);
    });
    // Battlements along every wall (the same blocks the sim's snowballs hit: CFG.MERLON).
    const ML = CFG.MERLON, merlons = [];
    field.boxes.forEach(function (b) {
      const alongX = b.ax === "x", L = alongX ? b.x1 - b.x0 : b.z1 - b.z0, thick = alongX ? b.z1 - b.z0 : b.x1 - b.x0;
      for (let i = 0; i * ML.pitch < L - 0.05; i++) {
        const w = Math.min(ML.w, L - i * ML.pitch), c = i * ML.pitch + w / 2;
        merlons.push({ x: alongX ? b.x0 + c : (b.x0 + b.x1) / 2, z: alongX ? (b.z0 + b.z1) / 2 : b.z0 + c, y: b.h + ML.h / 2,
          sx: alongX ? w : thick + 0.02, sz: alongX ? thick + 0.02 : w });
      }
    });
    const mTex = iceTex.clone(); mTex.needsUpdate = true; mTex.repeat.set(1, 1);
    const mIM = new THREE.InstancedMesh(new THREE.BoxGeometry(1, ML.h, 1), new THREE.MeshStandardMaterial({ map: mTex, roughness: 0.85 }), merlons.length);
    merlons.forEach(function (m, i) { sv.set(m.sx, 1, m.sz); pv.set(m.x, m.y, m.z); q.identity(); mIM.setMatrixAt(i, m4.compose(pv, q, sv)); });
    mIM.castShadow = true; mIM.receiveShadow = true;
    G.add(mIM);
    // Round towers: ice-block drums with a battlement ring and a team-colour band.
    field.circles.filter((c) => c.kind === "tower").forEach(function (t) {
      const team = t.z > 0 ? 0 : 1, tex = iceTex.clone(); tex.needsUpdate = true; tex.repeat.set(Math.round(t.r * 2.4), Math.round(t.h / 1.5));
      const g = new THREE.Group();
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(t.r, t.r * 1.06, t.h, 20), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
      drum.position.y = t.h / 2; drum.castShadow = true; drum.receiveShadow = true; g.add(drum);
      const band = new THREE.Mesh(new THREE.TorusGeometry(t.r * 1.02, 0.12, 8, 24), new THREE.MeshStandardMaterial({ color: TEAM_COL[team], roughness: 0.6 }));
      band.rotation.x = Math.PI / 2; band.position.y = t.h - 0.25; g.add(band);
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2, blk = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.55, 0.42), new THREE.MeshStandardMaterial({ map: mTex, roughness: 0.85 }));
        blk.position.set(Math.cos(a) * (t.r - 0.1), t.h + 0.27, Math.sin(a) * (t.r - 0.1)); blk.rotation.y = -a + Math.PI / 2; blk.castShadow = true; g.add(blk);
      }
      g.position.set(t.x, 0, t.z);
      G.add(g);
    });
    field.forts.forEach(function (f) {
      const team = f.sign > 0 ? 0 : 1, col = TEAM_COL[team];
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(26, 10.5), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.18, depthWrite: false }));
      floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0.02, f.zc); G.add(floor);
      if (sim.mode === "ctf") return;   // the real flags (below) stand here instead of the decoration
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 5, 8), new THREE.MeshStandardMaterial({ color: 0xdfe6ee }));
      pole.position.set(0, 2.5, f.sign * (CFG.HZ - 4.6)); pole.castShadow = true; G.add(pole);
      const flagGeo = new THREE.PlaneGeometry(2.2, 1.3, 10, 4);
      const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: col, side: THREE.DoubleSide, roughness: 0.7 }));
      flag.position.set(1.15, 4.3, pole.position.z); G.add(flag);
      world.flags.push({ mesh: flag, base: flagGeo.attributes.position.array.slice(), phase: team * 2 });
    });

    // --- capture the flag: each team's CTSG flag (team-colour cloth, gold edge, the seal), its stand and a beacon
    world.ctf = [];
    if (sim.mode === "ctf") {
      const seal = new Image();
      const cloths = [0, 1].map(function (team) {
        const css = "#" + TEAM_COL[team].toString(16).padStart(6, "0");
        const draw = function () {
          const tex = canvasTex(384, 256, function (g, w, h) {
            const gr = g.createLinearGradient(0, 0, 0, h);
            gr.addColorStop(0, css); gr.addColorStop(1, "rgba(0,0,0,0.35)");
            g.fillStyle = css; g.fillRect(0, 0, w, h);
            g.fillStyle = gr; g.globalAlpha = 0.45; g.fillRect(0, 0, w, h); g.globalAlpha = 1;
            g.strokeStyle = "#f2b640"; g.lineWidth = 12; g.strokeRect(6, 6, w - 12, h - 12);
            g.strokeStyle = "rgba(255,255,255,0.55)"; g.lineWidth = 3; g.setLineDash([14, 9]); g.strokeRect(20, 20, w - 40, h - 40);
            if (seal.complete && seal.naturalWidth) g.drawImage(seal, w / 2 - 98, h / 2 - 98, 196, 196);
          });
          tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.repeat.set(1, 1);
          return tex;
        };
        return { draw: draw, tex: draw() };
      });
      const stand = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.6 });
      [0, 1].forEach(function (team) {
        const f = sim.flags[team] || { hx: 0, hz: (team === 0 ? 1 : -1) * (CFG.HZ - CFG.FLAG.homeZ) }, col = TEAM_COL[team];
        // The stand where it's captured: an ice plinth and a team ring on the snow, always there even when the flag is out.
        const base = new THREE.Group();
        const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 0.3, 20), new THREE.MeshStandardMaterial({ map: iceTex, roughness: 0.85 }));
        plinth.position.y = 0.15; plinth.castShadow = true; plinth.receiveShadow = true; base.add(plinth);
        const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.95, 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.035; base.add(ring);
        base.position.set(f.hx, 0, f.hz); G.add(base);
        // The flag itself (pole origin at the foot of the pole; the cloth streams towards +x).
        const grp = new THREE.Group(), geo = new THREE.PlaneGeometry(2.55, 1.7, 14, 4);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 4.4, 8), stand);
        pole.position.y = 2.2; pole.castShadow = true; grp.add(pole);
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshStandardMaterial({ color: 0xf2b640, roughness: 0.35, metalness: 0.6 }));
        knob.position.y = 4.45; grp.add(knob);
        const front = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: cloths[team].tex, side: THREE.FrontSide, roughness: 0.75 }));
        const backTex = cloths[team].tex.clone(); backTex.repeat.x = -1; backTex.offset.x = 1; backTex.needsUpdate = true;   // seal reads right from behind too
        const back = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: backTex, side: THREE.BackSide, roughness: 0.75 }));
        front.position.set(1.3, 3.4, 0); back.position.copy(front.position);
        front.castShadow = true; grp.add(front); grp.add(back);
        const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 34, 14, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.2, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
        beacon.position.y = 17; grp.add(beacon);
        G.add(grp);
        world.ctf.push({ grp: grp, geo: geo, base: geo.attributes.position.array.slice(), beacon: beacon, phase: team * 2, cloth: cloths[team], mats: [front.material, back.material], backTex: backTex });
      });
      seal.onload = function () {   // the seal arrives after the first frame: repaint both cloths
        world.ctf.forEach(function (c) {
          const nt = c.cloth.draw();
          c.mats[0].map.image = nt.image; c.mats[0].map.needsUpdate = true;
          c.backTex.image = nt.image; c.backTex.needsUpdate = true;
        });
      };
      seal.src = SB.SEAL;
    }

    // --- mounds (one mesh per mound; rebuilt each round, grown when built)
    const geos = [moundGeometry(11), moundGeometry(23), moundGeometry(37)];
    const moundMat = new THREE.MeshStandardMaterial({ color: 0xf8fbff, roughness: 1 });
    const moundGroup = new THREE.Group();
    G.add(moundGroup);
    world.addMound = function (i) {
      const m = sim.mounds[i];
      const mesh = new THREE.Mesh(geos[i % 3], moundMat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.rotation.y = (i * 1.7) % 6.28;
      mesh.position.set(m.x, 0, m.z);
      mesh.userData.cur = { r: 0.05, h: 0.05 };
      moundGroup.add(mesh);
      world.moundMeshes[i] = mesh;
    };
    world.rebuildMounds = function () {
      while (moundGroup.children.length) moundGroup.remove(moundGroup.children[0]);
      world.moundMeshes.length = 0;
      sim.mounds.forEach(function (m, i) { world.addMound(i); });
    };
    world.rebuildMounds();

    // --- falling snow
    const N = 1600, pos = new Float32Array(N * 3), vel = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 70; pos[i * 3 + 1] = Math.random() * 28; pos[i * 3 + 2] = (Math.random() - 0.5) * 70; vel[i * 2] = Math.random() * 6.28; vel[i * 2 + 1] = 0.8 + Math.random() * 1.2; }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const snow = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.16, map: dotTexture(), transparent: true, depthWrite: false, fog: false, opacity: 0.85 }));
    snow.frustumCulled = false;
    G.add(snow);
    world.snow = { pts: snow, pos: pos, vel: vel };

    // --- per-frame
    let t = 0;
    world.update = function (dt, cam) {
      t += dt;
      // Mounds ease to their current size (hits shrink them, building grows them).
      sim.mounds.forEach(function (m, i) {
        const mesh = world.moundMeshes[i];
        if (!mesh) return;
        const r = m.hp > 0 ? sim.moundR(m) : 0.001, h = m.hp > 0 ? sim.moundH(m) : 0.001, c = mesh.userData.cur, k = Math.min(1, dt * 9);
        c.r += (r - c.r) * k; c.h += (h - c.h) * k;
        mesh.scale.set(c.r, c.h, c.r);
        mesh.visible = c.r > 0.02;
      });
      // Flags.
      world.flags.forEach(function (f) {
        const p = f.mesh.geometry.attributes.position, b = f.base;
        for (let i = 0; i < p.count; i++) {
          const x = b[i * 3] + 1.1;   // 0..2.2 along the flag
          p.setZ(i, Math.sin(x * 2.4 - t * 5 + f.phase) * 0.08 * x);
        }
        p.needsUpdate = true;
      });
      // The capture-the-flag flags: on their stands, on a carrier's back, or lying where they were dropped.
      world.ctf.forEach(function (c, team) {
        const f = sim.flags[team];
        if (!f) return;
        const p = c.geo.attributes.position, b = c.base;
        for (let i = 0; i < p.count; i++) { const x = b[i * 3] + 1.275; p.setZ(i, Math.sin(x * 2.4 - t * 6 + c.phase) * 0.08 * x); }
        p.needsUpdate = true;
        const g = c.grp, h = f.state === "carried" ? sim.players[f.carrier] : null;
        if (h) {
          // On the carrier's back-left shoulder, the cloth streaming out to the left (the follow camera sits behind the right shoulder).
          const sy = Math.sin(h.yaw), cy = Math.cos(h.yaw), dx = -cy * 0.8 + sy * 0.6, dz = sy * 0.8 + cy * 0.6;
          g.position.set(h.x + sy * 0.3 - cy * 0.22, h.roll > 0 ? 0.25 : 0, h.z + cy * 0.3 + sy * 0.22);
          g.rotation.set(0, Math.atan2(-dz, dx), 0); g.scale.setScalar(0.5);
        } else {
          g.position.set(f.x, f.state === "home" ? 0.3 : 0, f.z);
          g.rotation.set(0, f.state === "home" ? 0 : team * 2.2, f.state === "dropped" ? -0.32 : 0); g.scale.setScalar(1);
        }
        c.beacon.material.opacity = f.state === "home" ? 0.16 : f.state === "dropped" ? 0.3 + 0.18 * Math.sin(t * 7) : 0.3;
        c.beacon.visible = !(h && h.human);   // the carrier's own view isn't a pink pillar
      });
      // Snow falls round the camera.
      const S = world.snow, P = S.pos;
      for (let i = 0; i < P.length / 3; i++) {
        S.vel[i * 2] += dt * 0.4;
        P[i * 3] += Math.sin(S.vel[i * 2]) * 0.35 * dt;
        P[i * 3 + 1] -= S.vel[i * 2 + 1] * dt;
        P[i * 3 + 2] += Math.cos(S.vel[i * 2] * 0.8) * 0.3 * dt;
        if (P[i * 3 + 1] < 0) P[i * 3 + 1] += 28;
        const dx = P[i * 3] - cam.x; if (dx > 35) P[i * 3] -= 70; else if (dx < -35) P[i * 3] += 70;
        const dz = P[i * 3 + 2] - cam.z; if (dz > 35) P[i * 3 + 2] -= 70; else if (dz < -35) P[i * 3 + 2] += 70;
      }
      S.pts.geometry.attributes.position.needsUpdate = true;
      world.sky.position.copy(cam);
      // The sun's shadow box follows the viewer.
      world.sun.target.position.set(cam.x, 0, cam.z);
      world.sun.position.set(cam.x - 26, 38, cam.z + 18);
    };
    return world;
  };
  W.TEAM_COL = TEAM_COL;
  SB.World = W;
})(globalThis.SB);
