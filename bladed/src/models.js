// Characters (procedural, jointed), knives (combat + throwing), name tags,
// and the first-person viewmodel (gloved hands, combat knife, throwing knife).
// Models face +x in their local frame; group.rotation.y = -yaw points them.
globalThis.HK = globalThis.HK || {};
(function (HK) {
  "use strict";
  const THREE = globalThis.THREE;
  const Mo = {};
  let V = null;

  const matCache = {};
  function mat(color, rough, metal, emissive) {
    const k = color + "/" + rough + "/" + metal + "/" + (emissive || 0);
    if (!matCache[k]) {
      matCache[k] = new THREE.MeshStandardMaterial({ color: color, roughness: rough === undefined ? 0.7 : rough, metalness: metal || 0 });
      if (emissive) { matCache[k].emissive = new THREE.Color(emissive); matCache[k].emissiveIntensity = 0.6; }
    }
    return matCache[k];
  }

  // Team looks. FFA gives each player a distinct accent.
  const STYLE = [
    { name: "NAVY", uniform: 0x2d3a4e, vest: 0x5e6248, helmet: 0x2b3038, accent: 0x38b6ff, mask: false },
    { name: "PIRATES", uniform: 0x5b2420, vest: 0x2d2b28, helmet: 0x161616, accent: 0xff4a2a, mask: true }
  ];
  const FFA_ACCENTS = [0x38b6ff, 0xff4a2a, 0xffc93a, 0x6cff6a, 0xd36bff, 0xff8fc8, 0x4af0e0, 0xf2f2f2];
  const SKINS = [0xf0c8a4, 0xc68b62, 0x8d5a3b, 0xe2b48c, 0x5e3a26, 0xd9a07a];
  Mo.STYLE = STYLE;

  // ------------------------------------------------------------------ knives
  // Combat knife: black grip, guard, clip-point blade. Blade along +x.
  function knifeMesh(scale, throwing) {
    const g = new THREE.Group();
    const steel = mat(0xaeb5bb, 0.3, 1.0), dark = mat(0x1c1d1f, 0.6, 0.2), edge = mat(0x8e979e, 0.34, 1.0);
    const s = new THREE.Shape();
    if (throwing) {
      s.moveTo(0, -0.012); s.lineTo(0.15, -0.014); s.lineTo(0.2, 0); s.lineTo(0.15, 0.014); s.lineTo(0, 0.012); s.closePath();
    } else {
      s.moveTo(0, -0.016); s.lineTo(0.13, -0.017); s.quadraticCurveTo(0.18, -0.012, 0.2, 0.004);
      s.lineTo(0.15, 0.012); s.lineTo(0.12, 0.018); s.lineTo(0, 0.018); s.closePath();
    }
    const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 }), throwing ? steel : edge);
    blade.geometry.translate(0, 0, -0.003);
    g.add(blade);
    if (throwing) {
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.022, 0.008), dark);
      grip.position.x = -0.05;
      g.add(grip);
      const ringM = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.004, 6, 12), steel);
      ringM.position.x = -0.11;
      g.add(ringM);
    } else {
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.06, 0.022), steel);
      g.add(guard);
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.014, 0.11, 10), dark);
      grip.rotation.z = Math.PI / 2;
      grip.position.x = -0.06;
      g.add(grip);
      for (let i = 0; i < 4; i++) {
        const ridge = new THREE.Mesh(new THREE.TorusGeometry(0.0165, 0.003, 4, 10), dark);
        ridge.rotation.y = Math.PI / 2;
        ridge.position.x = -0.025 - i * 0.022;
        g.add(ridge);
      }
      const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.017, 8, 6), steel);
      pommel.position.x = -0.118;
      g.add(pommel);
    }
    g.scale.setScalar(scale);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  Mo.knifeMesh = knifeMesh;

  // ------------------------------------------------------------------ characters
  function limb(r, len, m) {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 3, 8), m);
    mesh.position.y = -len / 2;
    mesh.castShadow = true;
    return mesh;
  }
  function makeCharacter(p, mode) {
    const st = STYLE[mode === "ffa" ? (p.id % 2) : p.team];
    const accent = mode === "ffa" ? FFA_ACCENTS[p.id % FFA_ACCENTS.length] : st.accent;
    const skin = mat(SKINS[(p.id * 7 + 3) % SKINS.length], 0.65);
    const uni = mat(st.uniform, 0.85), vestM = mat(st.vest, 0.8), helm = mat(st.helmet, 0.5, 0.2);
    const glove = mat(0x1a1a1a, 0.7), boot = mat(0x231d18, 0.7), acc = mat(accent, 0.5, 0, accent);

    const root = new THREE.Group();
    const fall = new THREE.Group();       // pivot at the feet for the death fall
    root.add(fall);
    const hips = new THREE.Group();
    hips.position.y = 0.95;
    fall.add(hips);
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.36), uni);
    pelvis.castShadow = true;
    hips.add(pelvis);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.38), mat(0x1e1e1e, 0.6));
    belt.position.y = 0.08;
    hips.add(belt);

    const torso = new THREE.Group();
    torso.position.y = 0.08;
    hips.add(torso);
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.28, 3, 10), uni);
    chest.scale.set(0.85, 1, 1.35);
    chest.position.y = 0.3;
    chest.castShadow = true;
    torso.add(chest);
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.42), vestM);
    vest.position.set(0.01, 0.3, 0);
    vest.castShadow = true;
    torso.add(vest);
    [-0.1, 0, 0.1].forEach(function (z) {
      const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.08), vestM);
      pouch.position.set(0.17, 0.22, z);
      torso.add(pouch);
    });
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.04, 0.43), acc);
    band.position.set(0.01, 0.43, 0);
    torso.add(band);

    const neck = new THREE.Group();
    neck.position.y = 0.56;
    torso.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10), st.mask ? mat(0x151515, 0.9) : skin);
    head.scale.set(1, 1.12, 0.95);
    head.position.y = 0.13;
    head.castShadow = true;
    neck.add(head);
    if (st.mask) {
      const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.045, 0.17), skin);
      eyes.position.set(0.1, 0.16, 0);
      neck.add(eyes);
      const bandana = new THREE.Mesh(new THREE.SphereGeometry(0.122, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), mat(0x8e1d18, 0.8));
      bandana.position.y = 0.155;
      neck.add(bandana);
    } else {
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), helm);
      helmet.position.y = 0.15;
      helmet.scale.set(1.05, 0.95, 1);
      helmet.castShadow = true;
      neck.add(helmet);
      const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.19), mat(0x111111, 0.2, 0.6));
      goggles.position.set(0.1, 0.26, 0);
      goggles.rotation.z = -0.4;
      neck.add(goggles);
    }

    function arm(side) {
      const sh = new THREE.Group();
      sh.position.set(0, 0.47, side * 0.24);
      torso.add(sh);
      sh.add(limb(0.06, 0.29, uni));
      const el = new THREE.Group();
      el.position.y = -0.29;
      sh.add(el);
      el.add(limb(0.055, 0.26, uni));
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), glove);
      hand.position.y = -0.29;
      el.add(hand);
      return { sh: sh, el: el, hand: hand };
    }
    const armR = arm(1), armL = arm(-1);
    const knife = knifeMesh(1.0, false);
    knife.position.set(0.03, -0.3, 0);
    armR.el.add(knife);

    function leg(side) {
      const hip = new THREE.Group();
      hip.position.set(0, -0.04, side * 0.11);
      hips.add(hip);
      hip.add(limb(0.085, 0.44, uni));
      const kn = new THREE.Group();
      kn.position.y = -0.44;
      hip.add(kn);
      kn.add(limb(0.072, 0.42, uni));
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.12), boot);
      b.position.set(0.04, -0.43, 0);
      b.castShadow = true;
      kn.add(b);
      return { hip: hip, kn: kn };
    }
    const legR = leg(1), legL = leg(-1);

    const tag = nameTag(p.name, accent);
    tag.position.y = 2.15;
    root.add(tag);

    return {
      root: root, fall: fall, hips: hips, torso: torso, neck: neck, armR: armR, armL: armL, legR: legR, legL: legL,
      knife: knife, tag: tag, phase: Math.random() * 6, accent: accent, fade: 1, deadT: 0, lastAlive: false
    };
  }

  function nameTag(name, color) {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 64;
    const g = c.getContext("2d");
    g.font = "bold 34px 'Bahnschrift', 'Arial Narrow', sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 6; g.strokeStyle = "rgba(0,0,0,0.75)"; g.strokeText(name, 128, 34);
    g.fillStyle = "#" + new THREE.Color(color).getHexString(); g.fillText(name, 128, 34);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    s.scale.set(1.1, 0.275, 1);
    s.renderOrder = 10;
    return s;
  }

  // ------------------------------------------------------------------ Mixamo character
  // Skinned Mixamo bodies, built by tools/build-char.mjs + pack-char.py into
  // src/chars/: clips.js (HK.CHAR_LIST roster + HK.CHAR_CLIPS, the Running,
  // Stabbing and Dying clips every body shares by bone name) and one <id>.js
  // per character (HK.CHAR_DATA[id]). Clips are sampled by hand and blended per
  // bone, so the sim's timings drive every pose: idle = stab clip frame 0
  // (fighting stance), moving = run clip, lunge/slash = the stab clip squeezed
  // around its strike, death = the dying clip, throw/jump/look = bone offsets.
  // Each match deals 8 different characters at random. Only those are
  // downloaded, and the next match's deal loads in the background
  // (Mo.prepare), so PLAY never waits. With no character data at all the
  // procedural soldiers above are used.
  const MX = { byId: {}, deck: [], next: null, loading: false };
  // Every body is scaled so the top of its head (the HeadTop_End bone, so hair,
  // hats and ears don't count) is at 1.76 m, whatever the model's units.
  const HEAD_M = 1.76;
  const DEAL = 8;
  function clipsOk() { return !!(HK.CHAR_CLIPS && HK.CHAR_CLIPS.run && HK.CHAR_CLIPS.stab); }
  function model(id) {
    if (!MX.byId[id] && HK.CHAR_DATA && HK.CHAR_DATA[id] && clipsOk()) {
      MX.byId[id] = buildModel(HK.CHAR_DATA[id]) || false;
      HK.CHAR_DATA[id].bin = null;   // decoded into the geometry; free the text
    }
    return MX.byId[id] || null;
  }
  function loadChar(id, cb) {
    if (HK.CHAR_DATA && HK.CHAR_DATA[id]) { cb(); return; }
    const s = document.createElement("script");
    s.src = "src/chars/" + encodeURIComponent(id) + ".js";
    s.onload = s.onerror = function () { cb(); };
    document.head.appendChild(s);
  }
  function shuffled(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  // Deal (and download) the next match's characters; done() once they're ready.
  Mo.prepare = function (done) {
    const list = HK.CHAR_LIST || [];
    if (!list.length || !clipsOk()) { if (done) done(); return; }
    const ids = shuffled(list).slice(0, Math.min(DEAL, list.length));
    let left = ids.length;
    MX.loading = true;
    ids.forEach(function (id) {
      loadChar(id, function () {
        if (--left > 0) return;
        MX.loading = false;
        MX.next = ids.map(model).filter(function (M) { return M; });
        if (done) done();
      });
    });
  };
  // Every character, for the art lineup and tests.
  Mo.loadAll = function (done) {
    const list = HK.CHAR_LIST || [];
    let left = list.length;
    if (!left) { done(); return; }
    list.forEach(function (id) { loadChar(id, function () { if (--left === 0) { list.forEach(model); done(); } }); });
  };

  function buildModel(D) {
    const M = { D: D, BN: {} };   // BN: bone name -> tree index ("Hips", "RightArm", ...)
    D.bones.forEach(function (b, i) { M.BN[b.name] = i; });
    if (M.BN.Hips === undefined || M.BN.RightHand === undefined) return null;
    const raw = atob(D.bin), bin = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i);
    const nv = D.verts, buf = bin.buffer;
    let o = 0;
    function take(Type, n) { const a = new Type(buf, o, n); o += n * Type.BYTES_PER_ELEMENT; return a; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(take(Float32Array, nv * 3), 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(take(Float32Array, nv * 2), 2));
    geo.setAttribute("normal", new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(take(Int8Array, nv * 4), 4), 3, 0, true));
    geo.setAttribute("skinIndex", new THREE.BufferAttribute(take(Uint8Array, nv * 4), 4));
    geo.setAttribute("skinWeight", new THREE.BufferAttribute(take(Uint8Array, nv * 4), 4, true));
    geo.setIndex(new THREE.BufferAttribute(take(D.wideIndex ? Uint32Array : Uint16Array, D.index), 1));
    let start = 0;
    D.groups.forEach(function (count, m) { geo.addGroup(start, count, m); start += count; });
    geo.computeBoundingSphere();
    M.geo = geo;
    M.tex = D.materials.map(function (m) {
      const t = {};
      Object.keys(m.tex).forEach(function (slot) {
        const img = new Image();
        const tx = new THREE.Texture(img);
        if (slot === "map") tx.colorSpace = THREE.SRGBColorSpace;
        tx.anisotropy = 4;
        img.onload = function () { tx.needsUpdate = true; };
        img.src = m.tex[slot];
        t[slot] = tx;
      });
      return t;
    });
    M.matCache = {};
    M.inverses = D.inverses.map(function (e) { return new THREE.Matrix4().fromArray(e); });
    M.nb = D.bones.length;
    M.rest = new Float32Array(M.nb * 4);
    D.bones.forEach(function (b, i) { M.rest.set(b.q, i * 4); });
    M.hipsRest = D.bones[M.BN.Hips].p;
    // Clips -> per-bone frame arrays (Mixamo bakes at a fixed frame rate). The
    // hips height is scaled from the clip's body to this one.
    M.clips = {};
    Object.keys(HK.CHAR_CLIPS).forEach(function (k) {
      const c = HK.CHAR_CLIPS[k];
      const cl = { dur: c.dur, strike: c.strike, q: [], hy: null, hyScale: M.hipsRest[1] / (c.hipsRest || M.hipsRest[1]) };
      c.tracks.forEach(function (tr) {
        const bi = M.BN[tr.b];
        if (bi === undefined) return;
        const fr = { n: tr.t.length, dt: tr.t.length > 1 ? tr.t[1] - tr.t[0] : 1, v: new Float32Array(tr.v) };
        if (tr.k === "q") cl.q.push({ i: bi, f: fr });
        else if (tr.k === "hy") cl.hy = fr;
        else if (tr.k === "hp") cl.hp = fr;   // dying: x/z travel + height
      });
      M.clips[k] = cl;
    });
    // Rest-pose height of the head top: walk the bone chain once.
    const top = M.BN.HeadTop_End !== undefined ? M.BN.HeadTop_End : M.BN.Head;
    let headY = 0;
    if (top !== undefined) {
      const objs = D.bones.map(function (b) {
        const o = new THREE.Object3D();
        o.position.fromArray(b.p); o.quaternion.fromArray(b.q); o.scale.fromArray(b.s);
        return o;
      });
      const holder = new THREE.Object3D();
      D.bones.forEach(function (b, i) { (b.parent >= 0 ? objs[b.parent] : holder).add(objs[i]); });
      holder.updateMatrixWorld(true);
      headY = new THREE.Vector3().setFromMatrixPosition(objs[top].matrixWorld).y;
    }
    M.scale = HEAD_M / (headY > 1 ? headY : (D.height || 180));
    return M;
  }

  function mxMaterials(M, tint) {
    if (!M.matCache[tint]) {
      M.matCache[tint] = M.tex.map(function (t) {
        const m = new THREE.MeshStandardMaterial({ map: t.map || null, normalMap: t.normalMap || null, color: tint, roughness: 0.78, metalness: 0.05 });
        // Hair cards, lace etc.: cut out by the alpha map, seen from both sides.
        if (t.alphaMap) { m.alphaMap = t.alphaMap; m.alphaTest = 0.5; m.side = THREE.DoubleSide; }
        return m;
      });
    }
    return M.matCache[tint];
  }

  // Team tints multiply the texture (uniform, armor and all).
  const MX_TINT = [0xa9c4ff, 0xff9c86];
  function makeMixamo(p, mode, M) {
    const accent = mode === "ffa" ? FFA_ACCENTS[p.id % FFA_ACCENTS.length] : STYLE[p.team].accent;
    const tint = mode === "art" ? 0xffffff :
      mode === "ffa" ? new THREE.Color(accent).lerp(new THREE.Color(0xffffff), 0.45).getHex() : MX_TINT[p.team];
    const D = M.D;
    const root = new THREE.Group();
    const fall = new THREE.Group();
    root.add(fall);
    // Mixamo faces +z in centimetres; the game's models face +x in metres.
    const body = new THREE.Group();
    body.rotation.y = Math.PI / 2;
    body.scale.setScalar(M.scale);
    fall.add(body);
    const bones = D.bones.map(function (b) {
      const bone = new THREE.Bone();
      bone.name = b.name;
      bone.position.fromArray(b.p); bone.quaternion.fromArray(b.q); bone.scale.fromArray(b.s);
      return bone;
    });
    D.bones.forEach(function (b, i) { (b.parent >= 0 ? bones[b.parent] : body).add(bones[i]); });
    // Vertices are baked in bind space and every bone is skinned: bind at identity.
    const mesh = new THREE.SkinnedMesh(M.geo, mxMaterials(M, tint));
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    body.add(mesh);
    body.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones, M.inverses), new THREE.Matrix4());

    // Combat knife in the right fist (bone space is the model's own units).
    const knife = knifeMesh(1.0 / M.scale, false);
    knife.position.set(MX_GRIP.p[0], MX_GRIP.p[1], MX_GRIP.p[2]);
    knife.rotation.set(MX_GRIP.r[0], MX_GRIP.r[1], MX_GRIP.r[2]);
    bones[M.BN.RightHand].add(knife);

    const tag = nameTag(p.name, accent);
    tag.position.y = 2.15;
    root.add(tag);
    return {
      mx: true, m: M, root: root, fall: fall, body: body, bones: bones, mesh: mesh, knife: knife, tag: tag,
      q: new Float32Array(M.nb * 4), hy: M.hipsRest[1],
      runT: Math.random(), turn: 0, accent: accent, deadT: 0, lastAlive: false, fallDir: 1
    };
  }
  // Knife placement in the RightHand bone (y runs along the fingers).
  // Blade out of the thumb side of the fist, tipped forward.
  const MX_GRIP = { p: [0, 8, 0], r: [0, 1.57, 0.6] };
  Mo.setGrip = function (p, r) {   // tuning hook for visual checks
    MX_GRIP.p = p; MX_GRIP.r = r;
    (Mo.chars || []).forEach(function (c) {
      if (!c.mx) return;
      c.knife.position.fromArray(p);
      c.knife.rotation.set(r[0], r[1], r[2]);
    });
  };

  // Sample a clip at time t (seconds) into out (quats per tree bone); returns
  // the hips height in model units.
  function mxSample(M, clip, t, out, w) {
    for (let k = 0; k < clip.q.length; k++) {
      const tr = clip.q[k], f = tr.f;
      let x = t / f.dt;
      if (x < 0) x = 0; if (x > f.n - 1) x = f.n - 1;
      const a = Math.floor(x), b = Math.min(f.n - 1, a + 1);
      if (w >= 1) THREE.Quaternion.slerpFlat(out, tr.i * 4, f.v, a * 4, f.v, b * 4, x - a);
      else {
        THREE.Quaternion.slerpFlat(QS, 0, f.v, a * 4, f.v, b * 4, x - a);
        THREE.Quaternion.slerpFlat(out, tr.i * 4, out, tr.i * 4, QS, 0, w);
      }
    }
    if (clip.hy) {
      const f = clip.hy, x = Math.max(0, Math.min(f.n - 1, t / f.dt)), a = Math.floor(x), b = Math.min(f.n - 1, a + 1);
      return (f.v[a] + (f.v[b] - f.v[a]) * (x - a)) * clip.hyScale;
    }
    return M.hipsRest[1];
  }
  // The dying clip's hips travel at time t, into out [dx, y, dz] (model units).
  function mxHips(clip, t, out) {
    const f = clip.hp, x = Math.max(0, Math.min(f.n - 1, t / f.dt)), a = Math.floor(x), b = Math.min(f.n - 1, a + 1), u = x - a;
    for (let k = 0; k < 3; k++) out[k] = (f.v[a * 3 + k] + (f.v[b * 3 + k] - f.v[a * 3 + k]) * u) * clip.hyScale;
    return out;
  }
  const HP = [0, 0, 0];
  const DIE_SECS = 2.1;   // the whole Dying clip plays in this long (respawn is 3.5 s)
  const QS = new Float32Array(4);
  const _q = new THREE.Quaternion(), _p = new THREE.Quaternion(), _r = new THREE.Quaternion(), _ax = new THREE.Vector3();

  // Rotate a bone about an axis given in body space (Mixamo: +y up, +z forward,
  // +x = the character's left), whatever its own local axes are.
  function mxTurn(c, name, ax, ay, az, angle) {
    if (!angle) return;
    const B = c.m.D.bones, bi = c.m.BN[name];
    if (bi === undefined) return;
    // Parent's body-space rotation from the pose buffer.
    _p.identity();
    for (let j = B[bi].parent; j >= 0; j = B[j].parent) {
      _q.fromArray(c.q, j * 4);
      _p.premultiply(_q);
    }
    _r.setFromAxisAngle(_ax.set(ax, ay, az), angle);
    // local' = P^-1 R P local
    _q.fromArray(c.q, bi * 4);
    _q.premultiply(_p).premultiply(_r).premultiply(_p.invert());
    _q.toArray(c.q, bi * 4);
  }

  function poseMixamo(c, p, ip, dt, now) {
    const M = c.m, root = c.root, R = M.clips.run, S = M.clips.stab, q = c.q;
    if (p.alive && !c.lastAlive) { c.fall.rotation.set(0, 0, 0); c.fall.position.set(0, 0, 0); c.deadT = 0; root.visible = true; }
    let hy, hx = M.hipsRest[0], hz = M.hipsRest[2];
    if (p.alive) {
      c.lastAlive = true;
      root.position.set(ip.x, ip.y, ip.z);
      root.rotation.y = -p.yaw;
      const sp = Math.hypot(p.vx, p.vz);
      const fwd = Math.cos(p.yaw) * p.vx + Math.sin(p.yaw) * p.vz;
      const side = -Math.sin(p.yaw) * p.vx + Math.cos(p.yaw) * p.vz;
      const back = fwd < -0.3;
      // Idle: the fighting stance that opens the stab clip.
      q.set(M.rest);
      hy = mxSample(M, S, 0, q, 1);
      // Run: the clip's stride covers ~3.8 m/s, so play it faster with speed.
      const w = Math.min(1, sp / 2.2);
      c.runT += dt * (sp / 3.8) * (back ? -1 : 1) * (p.sprinting ? 0.92 : 1);
      c.runT = ((c.runT % R.dur) + R.dur) % R.dur;
      const air = !p.onGround && p.airT > 0.12;
      if (air) hy += (mxSample(M, R, R.dur * 0.25, q, 0.8) - hy) * 0.8;
      else if (w > 0.01) hy += (mxSample(M, R, c.runT, q, w) - hy) * w;
      // Legs face the way we move (strafe), the chest stays on the aim.
      let turn = 0;
      if (sp > 0.8 && !air) turn = Math.atan2(side, Math.abs(fwd) + 0.01) * (back ? -1 : 1);
      turn = Math.max(-1.1, Math.min(1.1, turn));
      c.turn += (turn - c.turn) * Math.min(1, dt * 10);
      mxTurn(c, "Hips", 0, 1, 0, -c.turn);
      mxTurn(c, "Spine", 0, 1, 0, c.turn * 0.45);
      mxTurn(c, "Spine1", 0, 1, 0, c.turn * 0.3);
      mxTurn(c, "Spine2", 0, 1, 0, c.turn * 0.25);
      // Melee: the stab clip around its strike. Lunge = wind-up to the strike,
      // stab recovery after it; the slash plays the same strike faster.
      let mw = 0, mt = 0;
      const sinceStab = now - p.stabT;
      if (p.state === "lunge") {
        const k = Math.min(1, p.stateT / HK.CFG.lungeTime);
        mt = S.strike - 0.32 * (1 - k); mw = Math.min(1, p.stateT / 0.06);
      } else if (sinceStab < 0.3) {
        mt = S.strike + sinceStab * 1.4; mw = 1 - Math.max(0, (sinceStab - 0.12) / 0.18);
      } else if (p.state === "swing") {
        const k = p.stateT / HK.CFG.swingTime, hit = HK.CFG.swingHitAt / HK.CFG.swingTime;
        mt = S.strike + (k - hit) * 0.75;
        mw = Math.min(1, k / 0.12) * Math.min(1, (1 - k) / 0.25);
      }
      if (mw > 0) hy += (mxSample(M, S, mt, q, mw) - hy) * mw;
      // Throw: right arm cocks up and back, then whips forward (release at 0.1 s).
      if (p.state === "throw") {
        const k = p.stateT / HK.CFG.throwTime, rel = HK.CFG.throwWind / HK.CFG.throwTime;
        const up = k < rel ? ease(k / rel) : 1 - ease((k - rel) / (1 - rel));
        const fw = k < rel ? 0 : Math.sin(Math.min(1, (k - rel) / 0.45) * Math.PI);
        mxTurn(c, "RightArm", 1, 0, 0, 2.0 * up - 1.2 * fw);
        mxTurn(c, "RightForeArm", 1, 0, 0, 1.2 * up);
        mxTurn(c, "Spine2", 0, 1, 0, -0.35 * up + 0.4 * fw);
      }
      // Look up/down with the upper spine and head.
      const pitch = -(p.pitch || 0);
      mxTurn(c, "Spine2", 1, 0, 0, pitch * 0.4);
      mxTurn(c, "Neck", 1, 0, 0, pitch * 0.35);
      mxTurn(c, "Head", 1, 0, 0, pitch * 0.25);
    } else {
      // Death: drop the knife hand, topple backwards, sink before the respawn.
      if (c.lastAlive) { c.deadT = 0; c.fallDir = Math.random() < 0.5 ? 1 : 0.8; }
      c.lastAlive = false;
      c.deadT += dt;
      const u = ease(c.deadT / 0.45);
      q.set(M.rest);
      hy = mxSample(M, S, 0, q, 1);
      const Dc = M.clips.die;
      if (Dc && Dc.hp) {
        // The Dying clip, sped up to fit before the respawn, eased in from the stance.
        const t = Math.min(Dc.dur, c.deadT * Dc.dur / DIE_SECS), w = Math.min(1, c.deadT / 0.12);
        mxSample(M, Dc, t, q, w);
        mxHips(Dc, t, HP);
        hx += HP[0] * w; hz += HP[2] * w; hy += (HP[1] - hy) * w;
      } else {
        mxTurn(c, "LeftArm", 0, 0, 1, 1.2 * u);
        mxTurn(c, "RightArm", 0, 0, 1, -1.4 * u);
        mxTurn(c, "Spine", 1, 0, 0, -0.3 * u);
        mxTurn(c, "Head", 1, 0, 0, -0.5 * u);
        mxTurn(c, "RightUpLeg", 1, 0, 0, -0.5 * u);
        mxTurn(c, "RightLeg", 1, 0, 0, 0.6 * u);
        c.fall.rotation.z = u * 1.5 * c.fallDir;
      }
      if (c.deadT > 2.4) c.fall.position.y = -(c.deadT - 2.4) * 0.6;
      root.visible = c.deadT < 3.4;
    }
    const bones = c.bones;
    for (let i = 0; i < M.nb; i++) bones[i].quaternion.fromArray(q, i * 4);
    bones[M.BN.Hips].position.set(hx, hy, hz);
  }

  // ------------------------------------------------------------------ viewmodel
  const VM = {};
  function buildViewmodel() {
    VM.scene = new THREE.Scene();
    VM.camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    VM.scene.add(new THREE.HemisphereLight(0xdcefff, 0x5a4c3c, 1.1));
    const d = new THREE.DirectionalLight(0xfff0d8, 2.0);
    d.position.set(0.5, 1, 0.6);
    VM.scene.add(d);
    VM.sun = d;
    VM.scene.add(VM.camera);
    VM.scene.environment = V.scene.environment;
    VM.right = new THREE.Group();
    VM.left = new THREE.Group();
    VM.camera.add(VM.right); VM.camera.add(VM.left);
    function forearm(group, sleeveColor, side) {
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.42, 12), mat(sleeveColor, 0.85));
      sleeve.rotation.x = Math.PI / 2;
      sleeve.position.set(0, -0.01, 0.2);
      group.add(sleeve);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.04, 12), mat(0x1a1a1a, 0.6));
      cuff.rotation.x = Math.PI / 2;
      cuff.position.set(0, -0.01, 0.0);
      group.add(cuff);
      const gl = mat(0x1c1c1c, 0.75);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), gl);
      hand.scale.set(0.044, 0.04, 0.062);
      hand.position.set(0, -0.004, -0.045);
      group.add(hand);
      for (let i = 0; i < 4; i++) {
        const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.0125, 0.045, 3, 8), gl);
        f.rotation.z = Math.PI / 2;
        f.position.set(side * 0.006, -0.026, -0.085 + i * 0.021);
        group.add(f);
      }
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.04, 2, 6), mat(0x1c1c1c, 0.7));
      thumb.rotation.x = Math.PI / 2;
      thumb.position.set(-side * 0.03, 0.035, -0.07);
      group.add(thumb);

      group.userData.sleeve = sleeve;
    }
    forearm(VM.right, 0x2d3a4e, 1);
    forearm(VM.left, 0x2d3a4e, -1);
    // Combat knife in the right fist, blade forward and a little up.
    VM.knife = knifeMesh(1.15, false);
    VM.knife.rotation.set(0, Math.PI / 2, 0);
    VM.knife.rotation.order = "YXZ";
    VM.knife.position.set(0, 0.005, -0.08);
    VM.right.add(VM.knife);
    VM.knife.rotateZ(0.28);
    // Throwing knife pinched in the left hand.
    VM.tknife = knifeMesh(1.5, true);
    VM.tknife.rotation.set(0, Math.PI / 2, 0);
    VM.tknife.position.set(0, 0.04, -0.07);
    VM.tknife.rotateZ(0.2);
    VM.left.add(VM.tknife);
    VM.t = 0;
  }
  Mo.setSleeve = function (color) {
    [VM.right, VM.left].forEach(function (g) { g.userData.sleeve.material = mat(color, 0.85); });
  };

  function ease(t) { return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }

  // s: {state, stateT, move (0..1), sprint, air, bob phase, lungeT, knives, pickupT, alive, t}
  Mo.updateViewmodel = function (s, dt) {
    VM.t += dt;
    const R = VM.right, L = VM.left;
    if (!s.alive) { R.visible = false; L.visible = false; return; }
    R.visible = true;
    // Rest pose (camera space: x right, y up, -z forward).
    let rx = 0.25, ry = -0.25, rz = -0.42, ax = 0.12, ay = 0.18, az = 0.1;
    const bob = Math.sin(s.phase) * 0.012 * s.move, bobY = Math.abs(Math.cos(s.phase)) * 0.014 * s.move;
    rx += bob; ry += bobY - 0.007 * s.move + Math.sin(VM.t * 1.6) * 0.003;
    if (s.sprint) { rx += 0.04; ry -= 0.06; ax -= 0.35; az += 0.25; ay -= 0.3; }
    if (s.air) { ry += 0.03; }
    // Melee: lunge = stab forward; swing = slash right-to-left.
    if (s.state === "lunge" || s.stabT < 0.25) {
      const u = s.state === "lunge" ? ease(s.stateT / 0.12) : 1 - ease(s.stabT / 0.25);
      rz -= 0.22 * u; ry += 0.06 * u; rx -= 0.12 * u; ax -= 0.6 * u; ay += 0.1 * u;
    } else if (s.state === "swing") {
      const k = s.stateT / 0.34;
      const u = k < 0.25 ? -ease(k / 0.25) : -1 + 2 * ease((k - 0.25) / 0.45);
      const back = k > 0.7 ? 1 - ease((k - 0.7) / 0.3) : 1;
      rx -= 0.18 * (u + 1) * back * 0.9 - 0.08 * back; rz -= 0.1 * back; ry += 0.05 * back;
      ay += 0.9 * u * back; az -= 0.6 * back; ax += 0.2 * back;
    }
    R.position.set(rx, ry, rz);
    R.rotation.set(ax, ay, az);
    // Left hand only appears to throw.
    let lv = false;
    if (s.state === "throw") {
      lv = true;
      const k = s.stateT / 0.32;
      const wind = k < 0.3 ? ease(k / 0.3) : 1 - ease((k - 0.3) / 0.2);
      const out = k < 0.3 ? 0 : ease((k - 0.3) / 0.25) * (k > 0.7 ? 1 - ease((k - 0.7) / 0.3) : 1);
      L.position.set(-0.24 + out * 0.12, -0.12 + wind * 0.2 - (k > 0.7 ? ease((k - 0.7) / 0.3) * 0.3 : 0), -0.3 - out * 0.22 + wind * 0.08);
      L.rotation.set(0.4 * wind - 0.3 * out, -0.3, -0.6 * wind + 0.3 * out);
      VM.tknife.visible = k < 0.32;
      R.position.y -= 0.08 * Math.min(1, k * 3) * (1 - out);
    } else if (s.pickupT < 0.4) {
      lv = true;
      const k = s.pickupT / 0.4, u = Math.sin(k * Math.PI);
      L.position.set(-0.22, -0.32 + u * 0.18, -0.3);
      L.rotation.set(0.3, -0.2, -0.3);
      VM.tknife.visible = true;
    }
    L.visible = lv;
  };

  Mo.renderViewmodel = function (r) {
    if (!VM.right.visible && !VM.left.visible) return;
    r.clearDepth();
    r.render(VM.scene, VM.camera);
  };
  Mo.resize = function (w, h) {
    VM.camera.aspect = w / h;
    VM.camera.fov = w < h ? 76 : 58;
    VM.camera.updateProjectionMatrix();
  };

  // ------------------------------------------------------------------ world objects
  Mo.init = function (view) {
    V = view;
    buildViewmodel();
    Mo.chars = [];
    Mo.knives = new Map();
    Mo.knifeGroup = new THREE.Group();
    V.scene.add(Mo.knifeGroup);
    // Pickup glint shown under loose knives.
    Mo.glintMat = new THREE.SpriteMaterial({ map: V.TEX.dot, color: 0xfff2a8, transparent: true, opacity: 0.55, depthWrite: false });
  };

  Mo.setPlayers = function (sim) {
    Mo.chars.forEach(function (c) { V.scene.remove(c.root); });
    // Use the prepared deal (or the last one if the next is still loading),
    // then start loading the one after.
    if (MX.next && MX.next.length) { MX.deck = MX.next; MX.next = null; }
    if (!MX.next && !MX.loading) Mo.prepare();
    const deck = MX.deck;
    Mo.chars = sim.players.map(function (p, i) {
      const c = deck.length ? makeMixamo(p, sim.mode, deck[i % deck.length]) : makeCharacter(p, sim.mode);
      V.scene.add(c.root);
      return c;
    });
    Mo.knives.forEach(function (m) { Mo.knifeGroup.remove(m); });
    Mo.knives.clear();
  };

  // Pose one character from its sim state. ip = interpolated position.
  function pose(c, p, ip, dt, now, sim) {
    const root = c.root;
    if (p.alive) {
      if (!c.lastAlive) { c.fall.rotation.set(0, 0, 0); c.fall.position.set(0, 0, 0); c.deadT = 0; root.visible = true; }
      c.lastAlive = true;
      root.position.set(ip.x, ip.y, ip.z);
      root.rotation.y = -p.yaw;
      const sp = Math.hypot(p.vx, p.vz);
      const fwd = (Math.cos(p.yaw) * p.vx + Math.sin(p.yaw) * p.vz) / (sp || 1);
      c.phase += sp * dt * (p.sprinting ? 1.7 : 1.95) * (fwd < -0.2 ? -1 : 1);
      const amp = Math.min(1, sp / 5.4) * (p.sprinting ? 0.95 : 0.7);
      const s = Math.sin(c.phase), s2 = Math.sin(c.phase + Math.PI);
      const air = !p.onGround && p.airT > 0.12;
      c.legR.hip.rotation.z = air ? 0.6 : s * amp;
      c.legL.hip.rotation.z = air ? -0.2 : s2 * amp;
      c.legR.kn.rotation.z = air ? -1.0 : -Math.max(0, Math.sin(c.phase - 1.2)) * amp * 1.5;
      c.legL.kn.rotation.z = air ? -0.6 : -Math.max(0, Math.sin(c.phase + Math.PI - 1.2)) * amp * 1.5;
      c.hips.position.y = 0.95 - Math.abs(Math.cos(c.phase)) * 0.04 * amp - (air ? 0.05 : 0);
      let lean = -0.08 - amp * 0.12 - (p.sprinting ? 0.15 : 0);
      // Ready stance: knife hand up in front.
      let rS = 0.55, rE = 1.35, rX = 0.15, lS = -s * amp * 0.9 + 0.15, lE = 0.4 + amp * 0.4, lX = -0.1;
      if (p.sprinting) { rS = -s * 0.8 + 0.2; rE = 1.1; rX = 0.05; }
      if (p.state === "lunge" || now - p.stabT < 0.22) { lean = -0.45; rS = 1.55; rE = 0.15; rX = 0.05; }
      else if (p.state === "swing") {
        const k = p.stateT / 0.34;
        rS = 1.3; rE = 0.5; rX = 1.1 - Math.min(1, k * 1.8) * 1.8; lean = -0.2;
      } else if (p.state === "throw") {
        const k = p.stateT / 0.32;
        if (k < 0.32) { rS = 2.7; rE = 1.6; lean = 0.05; } else { rS = 0.9 - (k - 0.3) * 0.6; rE = 0.2; lean = -0.3; }
      }
      c.torso.rotation.z = lean;
      c.neck.rotation.z = -lean * 0.6 + p.pitch * 0.6;
      c.armR.sh.rotation.set(rX, 0, rS);
      c.armR.el.rotation.z = rE;
      c.armL.sh.rotation.set(lX, 0, lS);
      c.armL.el.rotation.z = lE;
      c.fade = 1;
    } else {
      // Death: topple backwards, then sink and vanish before the respawn.
      if (c.lastAlive) { c.deadT = 0; c.fallDir = Math.random() < 0.5 ? 1 : 0.8; }
      c.lastAlive = false;
      c.deadT += dt;
      const u = ease(c.deadT / 0.45);
      c.fall.rotation.z = u * 1.5 * c.fallDir;
      c.torso.rotation.z = u * 0.2;
      c.armR.sh.rotation.z = 2.2 * u; c.armL.sh.rotation.z = 2.6 * u;
      c.armR.el.rotation.z = 0.3; c.armL.el.rotation.z = 0.5;
      c.legR.hip.rotation.z = 0.3 * u; c.legL.hip.rotation.z = 0.1;
      c.legR.kn.rotation.z = -0.4 * u; c.legL.kn.rotation.z = -0.1;
      if (c.deadT > 2.4) c.fall.position.y = -(c.deadT - 2.4) * 0.6;
      root.visible = c.deadT < 3.4;
    }
  }

  Mo.update = function (sim, dt, alpha, viewerId, aimTarget) {
    if (MX.staged) {   // art staging: only the staged cast is shown
      Mo.chars.forEach(function (c) { c.root.visible = false; });
      Mo.knifeGroup.visible = false;
      return;
    }
    Mo.knifeGroup.visible = true;
    const now = sim.t;
    const viewer = viewerId >= 0 ? sim.players[viewerId] : null;
    sim.players.forEach(function (p, i) {
      const c = Mo.chars[i];
      if (!c) return;
      const ip = p._px !== undefined && p.alive && p.spawnT > 0.05 ?
        { x: p._px + (p.x - p._px) * alpha, y: p._py + (p.y - p._py) * alpha, z: p._pz + (p.z - p._pz) * alpha } : p;
      if (c.mx) poseMixamo(c, p, ip, dt, now); else pose(c, p, ip, dt, now, sim);
      // The first-person player's own body isn't drawn.
      if (viewer && i === viewerId) { c.root.visible = false; }
      // Name tags: allies always; enemies only while aimed at.
      const ally = viewer && !sim.isEnemy(viewer, p);
      c.tag.visible = p.alive && viewer !== null && i !== viewerId && (ally || aimTarget === i);
      c.tag.material.depthTest = !ally;
    });
    syncKnives(sim, dt);
  };

  function syncKnives(sim, dt) {
    const seen = new Set();
    sim.knives.forEach(function (k) {
      seen.add(k.id);
      let m = Mo.knives.get(k.id);
      if (!m) {
        m = knifeMesh(1.35, true);
        m.rotation.order = "YZX";
        Mo.knifeGroup.add(m);
        Mo.knives.set(k.id, m);
        const glint = new THREE.Sprite(Mo.glintMat);
        glint.scale.set(0.35, 0.35, 1);
        glint.visible = false;
        m.userData.glint = glint;
        Mo.knifeGroup.add(glint);
      }
      m.position.set(k.x, k.y, k.z);
      const glint = m.userData.glint;
      if (k.st === "fly" || k.st === "drop") {
        // Tumble end over end around the axis across the flight path.
        k.spin += dt * 26;
        const yaw = Math.atan2(k.dz || k.vz || 0, k.dx || k.vx || 1);
        m.rotation.set(0, -yaw, -k.spin);
        glint.visible = false;
      } else if (k.rest === "wall") {
        const yaw = Math.atan2(k.dz, k.dx), pitch = Math.asin(Math.max(-1, Math.min(1, k.dy)));
        m.rotation.set(0, -yaw, pitch);
        glint.visible = true;
        glint.position.set(k.px, k.py, k.pz);
      } else {
        m.rotation.set(Math.PI / 2, (k.id * 2.4) % 6.28, 0);
        m.position.y = k.y + 0.012;
        glint.visible = true;
        glint.position.set(k.x, k.y + 0.08, k.z);
      }
      if (glint.visible) glint.material.opacity = 0.35 + 0.25 * Math.sin(sim.t * 5 + k.id);
    });
    Mo.knives.forEach(function (m, id) {
      if (!seen.has(id)) {
        Mo.knifeGroup.remove(m);
        Mo.knifeGroup.remove(m.userData.glint);
        Mo.knives.delete(id);
      }
    });
  }

  Mo.charRoot = function (i) { return Mo.chars[i] && Mo.chars[i].root; };

  // Art staging (key art / thumbnails): freeze any number of characters in
  // chosen poses, untinted, plus knives in flight; the match's own players are
  // hidden while staged. Entry: { id, x, y, z, p: {sim-like player fields},
  // runT, deadT, now } or { knife: true, x, y, z, yaw, spin }.
  Mo.stage = function (list) {
    Mo.unstage();
    MX.staged = [];
    list.forEach(function (s) {
      if (s.knife) {
        const k = knifeMesh(1.35, true);
        k.position.set(s.x, s.y, s.z);
        k.rotation.set(0, -(s.yaw || 0), -(s.spin || 0));
        V.scene.add(k);
        MX.staged.push({ root: k });
        return;
      }
      const M = model(s.id);
      if (!M) return;
      const p = Object.assign({ id: 0, name: "", team: 0, alive: true, yaw: 0, vx: 0, vz: 0, sprinting: false, onGround: true, airT: 0, state: "idle", stateT: 0, stabT: -9, pitch: 0 }, s.p || {});
      const c = makeMixamo(p, "art", M);
      c.tag.visible = false;
      if (s.runT !== undefined) c.runT = s.runT;
      const ip = { x: s.x, y: s.y, z: s.z };
      if (!p.alive) { c.lastAlive = true; poseMixamo(c, p, ip, s.deadT || 1, s.now || 0); }
      else poseMixamo(c, p, ip, 0.0001, s.now || 0);
      if (!p.alive) c.root.position.set(s.x, s.y, s.z), c.root.rotation.y = -p.yaw;
      V.scene.add(c.root);
      MX.staged.push(c);
    });
    return MX.staged.length;
  };
  Mo.unstage = function () {
    (MX.staged || []).forEach(function (c) { V.scene.remove(c.root); });
    MX.staged = null;
  };
  // Test hooks: list the characters, give player i character mi.
  Mo.modelNames = function () { return (HK.CHAR_LIST || []).filter(function (id) { return model(id); }); };
  Mo.useModel = function (sim, i, id) {
    const M = model(id);
    if (!M) return;
    V.scene.remove(Mo.chars[i].root);
    Mo.chars[i] = makeMixamo(sim.players[i], sim.mode, M);
    V.scene.add(Mo.chars[i].root);
  };
  HK.Models = Mo;
})(globalThis.HK);
