// Players' bodies. A body is a packed Mixamo character (SB.BODY, from Snowball Squabble's tools/pack-char.py)
// driven by the clips in SB.CLIPS (tools/build-clips.mjs). Forked from Trick Shot's body.js: model loading,
// clip sampling and the avatar hand-over are the same; the posing follows a dodgeball player's states.
// Every body is hidden and drives one of the Meshy athletes (src/avatar.js); it only shows if the athlete fails.
//
// Mixamo bodies face +z with +x their left, so the root turns by yaw + PI (the sim's yaw 0 looks along -z).
globalThis.SB = globalThis.SB || {};
(function (SB) {
  "use strict";
  const THREE = globalThis.THREE;
  const Bo = {};
  const HEAD_M = 1.78;          // every body is scaled so its head top is here, metres
  const LOOPS = { idle: 1, run_f: 1, run_b: 1, run_l: 1, run_r: 1, fall: 1 };
  // Crossfade into a state, seconds.
  const BLEND = { idle: 0.25, run_f: 0.14, run_b: 0.14, run_l: 0.14, run_r: 0.14, fall: 0.12, throw: 0.08, catch: 0.06,
    dodge_f: 0.05, dodge_b: 0.05, dodge_l: 0.05, dodge_r: 0.05, flip: 0.06, twistflip: 0.06, hit: 0.05 };
  const RUN_SPEED = { run_f: 3.78, run_b: 3.13, run_l: 4.35, run_r: 4.35 };   // m/s the clip's feet cover (travel / duration)
  // Clip timings (tools/clip-scan.mjs): the throw is cocked back at 2.15 s and lets go at 2.4 s; the block has both
  // arms out at chest height at 1.0 s; the fall is flat on the floor by 1.2 s and back up by 2.6 s.
  const THROW_COCK = [1.85, 2.15], THROW_GO = 2.25, CATCH_T = 1.0;
  const FLIPS = [{ clip: "flip", t0: 0.12, rate: 1.6 }, { clip: "twistflip", t0: 0.45, rate: 1.45 }];   // X-Parkour's
  const DODGES = ["dodge_f", "dodge_b", "dodge_l", "dodge_r"];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));

  // ------------------------------------------------------------------ model data
  const models = {};
  function buildModel(id) {
    const D = SB.BODY && SB.BODY[id];
    if (!D) return null;
    const M = { id: id, D: D, BN: {} };
    D.bones.forEach(function (b, i) { M.BN[b.name] = i; });
    if (M.BN.Hips === undefined || M.BN.RightHand === undefined || M.BN.LeftHand === undefined || M.BN.Spine === undefined) return null;
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
    if (D.colors) geo.setAttribute("color", new THREE.BufferAttribute(take(Uint8Array, nv * 4), 4, true));
    let start = 0;
    D.groups.forEach(function (count, m) { geo.addGroup(start, count, m); start += count; });
    geo.computeBoundingSphere();
    M.geo = geo;
    M.tex = D.materials.map(function (m) {
      const t = {};
      Object.keys(m.tex).forEach(function (slot) {
        const img = new Image(), tx = new THREE.Texture(img);
        if (slot === "map") tx.colorSpace = THREE.SRGBColorSpace;
        tx.anisotropy = 4;
        img.onload = function () { tx.needsUpdate = true; };
        img.src = m.tex[slot];
        t[slot] = tx;
      });
      return t;
    });
    D.bin = null;
    M.mats = null;
    M.inverses = D.inverses.map(function (e) { return new THREE.Matrix4().fromArray(e); });
    M.nb = D.bones.length;
    M.rest = new Float32Array(M.nb * 4);
    D.bones.forEach(function (b, i) { M.rest.set(b.q, i * 4); });
    M.hipsRest = D.bones[M.BN.Hips].p;
    const top = M.BN.HeadTop_End !== undefined ? M.BN.HeadTop_End : M.BN.Head;
    const objs = D.bones.map(function (b) {
      const ob = new THREE.Object3D();
      ob.position.fromArray(b.p); ob.quaternion.fromArray(b.q); ob.scale.fromArray(b.s);
      return ob;
    });
    const holder = new THREE.Object3D();
    D.bones.forEach(function (b, i) { (b.parent >= 0 ? objs[b.parent] : holder).add(objs[i]); });
    holder.updateMatrixWorld(true);
    const headY = new THREE.Vector3().setFromMatrixPosition(objs[top].matrixWorld).y;
    M.scale = HEAD_M / (headY > 1 ? headY : (D.height || 180));
    M.clips = {};
    Object.keys(SB.CLIPS).forEach(function (k) {
      const c = SB.CLIPS[k];
      const cl = { key: k, dur: c.dur, n: c.n, q: [], hp: null, s: M.hipsRest[1] / (c.hipsRest || M.hipsRest[1]), loop: !!LOOPS[k] };
      c.tracks.forEach(function (tr) {
        if (tr.k === "hp") { cl.hp = new Float32Array(tr.v); return; }
        const bi = M.BN[tr.b];
        if (bi !== undefined) cl.q.push({ i: bi, v: new Float32Array(tr.v) });
      });
      M.clips[k] = cl;
    });
    return M;
  }
  function model(id) {
    if (models[id] === undefined) models[id] = buildModel(id) || null;
    return models[id];
  }
  function materials(M) {
    if (!M.mats) {
      M.mats = M.tex.map(function (t) {
        const m = new THREE.MeshStandardMaterial({ map: t.map || null, normalMap: t.normalMap || null, roughness: 0.85, metalness: 0.02, vertexColors: !!M.D.colors });
        if (t.alphaMap) { m.alphaMap = t.alphaMap; m.alphaTest = 0.5; m.side = THREE.DoubleSide; }
        return m;
      });
    }
    return M.mats;
  }

  // ------------------------------------------------------------------ clip sampling
  const QS = new Float32Array(4);
  function frameOf(cl, t) {
    const f = clamp(t * SB.CLIP_FPS, 0, cl.n - 1), a = Math.floor(f);
    return { a: a, b: Math.min(cl.n - 1, a + 1), u: f - a };
  }
  function sample(cl, t, out) {
    const F = frameOf(cl, t), a = F.a * 4, b = F.b * 4, u = F.u;
    for (let k = 0; k < cl.q.length; k++) { const tr = cl.q[k]; THREE.Quaternion.slerpFlat(out, tr.i * 4, tr.v, a, tr.v, b, u); }
  }
  function hipsY(cl, t, M) {
    if (!cl.hp) return M.hipsRest[1];
    const F = frameOf(cl, t), v = cl.hp;
    return (v[F.a * 3 + 1] + (v[F.b * 3 + 1] - v[F.a * 3 + 1]) * F.u) * cl.s;
  }
  const _aq = new THREE.Quaternion(), _sq = new THREE.Quaternion(), _rq = new THREE.Quaternion(), _av = new THREE.Vector3();
  // Rotate a bone about an axis given in the body's own space, whatever its local axes are.
  function turn(c, bone, ax, ay, az, angle) {
    if (!bone || !angle) return;
    const par = bone.parent;
    par.updateWorldMatrix(true, false);
    c.body.getWorldQuaternion(_sq);
    par.getWorldQuaternion(_aq);
    _aq.premultiply(_sq.invert());
    _rq.setFromAxisAngle(_av.set(ax, ay, az), angle);
    bone.quaternion.premultiply(_aq).premultiply(_rq).premultiply(_aq.invert());
  }

  function nameTag(name, color) {
    const cv = document.createElement("canvas");
    cv.width = 256; cv.height = 64;
    const g = cv.getContext("2d");
    g.font = "bold 34px 'Trebuchet MS', 'Arial Narrow', sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 6; g.strokeStyle = "rgba(0,0,0,0.75)"; g.strokeText(name, 128, 34);
    g.fillStyle = "#" + new THREE.Color(color).getHexString(); g.fillText(name, 128, 34);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    s.scale.set(1.0, 0.25, 1);
    s.renderOrder = 10;
    return s;
  }
  // A team-coloured ring on the floor round each player (avatars keep their own clothes).
  const ringGeo = new THREE.RingGeometry(0.42, 0.52, 40);
  ringGeo.rotateX(-Math.PI / 2);

  Bo.model = model;
  Bo.make = function (p, bodyId, color) {
    const M = model(bodyId);
    if (!M) return null;
    const root = new THREE.Group(), body = new THREE.Group();
    body.scale.setScalar(M.scale);
    root.add(body);
    const bones = M.D.bones.map(function (b) {
      const bone = new THREE.Bone();
      bone.name = b.name;
      bone.position.fromArray(b.p); bone.quaternion.fromArray(b.q); bone.scale.fromArray(b.s);
      return bone;
    });
    M.D.bones.forEach(function (b, i) { (b.parent >= 0 ? bones[b.parent] : body).add(bones[i]); });
    const mesh = new THREE.SkinnedMesh(M.geo, materials(M));
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    body.add(mesh);
    body.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones, M.inverses), new THREE.Matrix4());
    const c = { M: M, root: root, body: body, bones: bones, mesh: mesh, q: new Float32Array(M.nb * 4), from: new Float32Array(M.nb * 4),
      key: null, t: 0, blend: 1, blendT: 0, fromHy: 0, hy: 0, name: p.name, runT: 0 };
    c.tag = nameTag(p.name, color);
    c.tag.position.y = 2.1;
    root.add(c.tag);
    c.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.85, depthWrite: false }));
    c.ring.position.y = 0.012;
    c.ring.renderOrder = 2;
    root.add(c.ring);
    return c;
  };

  // ------------------------------------------------------------------ posing
  function enter(c, key) {
    if (c.key === key) return;
    c.from.set(c.q); c.fromHy = c.hy;
    c.blendT = c.key === null ? 0 : (BLEND[key] !== undefined ? BLEND[key] : 0.2);
    c.blend = c.blendT > 0 ? 0 : 1;
    c.key = key;
  }
  // Which clip, where in it, and whether the hips height is the clip's or held (flips spin round a fixed middle).
  function choose(c, p, dt) {
    const M = c.M, ST = SB.ST, CFG = SB.CFG;
    const speed = Math.hypot(p.vx, p.vz);
    switch (p.st) {
      case ST.charge: return { key: "throw", t: THROW_COCK[0] + (THROW_COCK[1] - THROW_COCK[0]) * ease(p.charge) };
      case ST.throw: return { key: "throw", t: Math.min(3.15, THROW_GO + p.stT * 2.2) };
      case ST.catch: return { key: "catch", t: Math.min(CATCH_T, 0.82 + p.stT * 1.6) };
      case ST.dodge: { const k = DODGES[p.dodgeDir] || "dodge_b", cl = M.clips[k]; return { key: k, t: Math.min(cl.dur * 0.75, p.stT * cl.dur * 0.75 / CFG.DODGE_T) }; }
      case ST.flip: { const f = FLIPS[p.flipKind] || FLIPS[0]; return { key: f.clip, t: f.t0 + p.stT * f.rate, fixedHips: 0.93 }; }
      case ST.hit: return { key: "hit", t: p.stT < 1.2 ? p.stT * 1.25 : 1.5 + (p.stT - 1.2) * 2.3 };
    }
    if (p.st === ST.out && p.stT < 0.6 && c.key === "hit") return { key: "hit", t: Math.min(2.6, 2.0 + p.stT) };
    if (!p.ground) { c.runT += dt; return { key: "fall", t: c.runT % M.clips.fall.dur }; }
    if (speed > 0.7) {
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      const fwd = -sy * p.vx - cy * p.vz, side = cy * p.vx - sy * p.vz;
      const key = Math.abs(fwd) >= Math.abs(side) ? (fwd >= 0 ? "run_f" : "run_b") : (side >= 0 ? "run_r" : "run_l");
      c.runT += dt * clamp(speed / RUN_SPEED[key], 0.55, 1.6);
      return { key: key, t: c.runT % M.clips[key].dur };
    }
    c.idleT = (c.idleT || 0) + dt;
    return { key: "idle", t: c.idleT % M.clips.idle.dur };
  }

  Bo.pose = function (c, p, dt) {
    const M = c.M, B = M.BN, bones = c.bones, q = c.q;
    c.root.position.set(p.x, p.y, p.z);
    c.root.rotation.y = p.yaw + Math.PI;
    const ch = choose(c, p, dt);
    enter(c, ch.key);
    const cl = M.clips[ch.key];
    q.set(M.rest);
    sample(cl, ch.t, q);
    let hy = ch.fixedHips ? M.hipsRest[1] * ch.fixedHips : hipsY(cl, ch.t, M);
    if (c.blend < 1) {
      c.blend = Math.min(1, c.blend + dt / c.blendT);
      const w = ease(c.blend);
      for (let i = 0; i < M.nb; i++) THREE.Quaternion.slerpFlat(q, i * 4, c.from, i * 4, q, i * 4, w);
      hy = c.fromHy + (hy - c.fromHy) * w;
    }
    c.hy = hy;
    for (let i = 0; i < M.nb; i++) bones[i].quaternion.fromArray(q, i * 4);
    bones[B.Hips].position.set(M.hipsRest[0], hy, M.hipsRest[2]);
    // Look up and down a little with the aim (the spine bends; not while tumbling or down).
    const ST = SB.ST;
    if (p.st !== ST.flip && p.st !== ST.hit && p.st !== ST.out) {
      const lean = -(p.pitch || 0) / 3.2;
      turn(c, bones[B.Spine], 1, 0, 0, lean);
      if (B.Spine1 !== undefined) turn(c, bones[B.Spine1], 1, 0, 0, lean);
      if (B.Spine2 !== undefined) turn(c, bones[B.Spine2], 1, 0, 0, lean);
    }
    c.root.updateMatrixWorld(true);
    if (c.avatar) c.avatar.follow();
  };

  // Where the ball sits in the right hand (world space).
  const _hv = new THREE.Vector3(), _hv2 = new THREE.Vector3();
  Bo.handPos = function (c, out) {
    const M = c.M;
    const hand = c.avatar ? c.avatar.map[8] : c.bones[M.BN.RightHand];
    const tip = c.avatar ? null : c.bones[M.BN.RightHandMiddle1 !== undefined ? M.BN.RightHandMiddle1 : M.BN.RightHand];
    hand.getWorldPosition(out);
    if (tip && tip !== hand) { tip.getWorldPosition(_hv); out.lerp(_hv, 0.9); }
    else if (c.avatar) {
      // an avatar's hand bone is at the wrist: reach a little further along the forearm
      const fore = c.avatar.map[7];
      if (fore) { fore.getWorldPosition(_hv2); _hv.copy(out).sub(_hv2).normalize(); out.addScaledVector(_hv, 0.1); }
    }
    return out;
  };

  // An athlete (.glb) takes over from the packed body: the body keeps playing the clips but is
  // hidden; the avatar copies its pose each frame (src/avatar.js).
  Bo.useAvatar = function (c, buffer, tint, opts) {
    if (!SB.Avatar || !c) return Promise.resolve(false);
    const M = c.M, byName = {};
    Object.keys(M.BN).forEach(function (n) { byName[n] = c.bones[M.BN[n]]; });
    const driver = {
      root: c.root,
      bone: function (n) { return byName[n]; },
      bindPose: function (fn) {
        const saved = c.bones.map(function (b) { return [b.quaternion.clone(), b.position.clone()]; });
        for (let i = 0; i < M.nb; i++) c.bones[i].quaternion.fromArray(M.rest, i * 4);
        c.bones[M.BN.Hips].position.set(M.hipsRest[0], M.hipsRest[1], M.hipsRest[2]);
        c.root.updateMatrixWorld(true);
        try { fn(); } finally {
          c.bones.forEach(function (b, i) { b.quaternion.copy(saved[i][0]); b.position.copy(saved[i][1]); });
          c.root.updateMatrixWorld(true);
        }
      }
    };
    const p = c.root.position.clone(), ry = c.root.rotation.y, bq = c.body.quaternion.clone(), bp = c.body.position.clone();
    c.root.position.set(0, 0, 0); c.root.rotation.set(0, 0, 0); c.body.quaternion.identity(); c.body.position.set(0, 0, 0);
    c.root.updateMatrixWorld(true);
    return SB.Avatar.load(buffer, driver, tint, opts).then(function (av) {
      if (av) { c.avatar = av; c.mesh.visible = false; }
      return !!av;
    }).finally(function () {
      c.root.position.copy(p); c.root.rotation.y = ry; c.body.quaternion.copy(bq); c.body.position.copy(bp);
      c.root.updateMatrixWorld(true);
    });
  };

  // Bodies are separate scripts (0.5-1 MB each): load only the ones a match uses.
  const loading = {};
  Bo.load = function (ids, onProgress) {
    let done = 0;
    const tick = function () { done++; if (onProgress) onProgress(done, ids.length); };
    return Promise.all(ids.map(function (id) {
      if (SB.BODY && SB.BODY[id]) { tick(); return Promise.resolve(); }
      if (loading[id]) return loading[id].then(tick);
      return (loading[id] = new Promise(function (res, rej) {
        let tries = 0;
        (function attempt() {
          const s = document.createElement("script");
          s.src = "src/chars/" + id + ".js?v=1" + (tries ? "&r=" + tries : "");
          s.onload = res;
          // a dropped download once killed a game (Powder Rush): try again a couple of times
          s.onerror = function () { s.remove(); if (++tries < 3) setTimeout(attempt, 600 * tries); else rej(new Error("could not load character " + id)); };
          document.head.appendChild(s);
        })();
      })).then(tick);
    }));
  };
  SB.Body = Bo;
})(globalThis.SB);
