// Turkey Bowl 3D — Mixamo players.
//
// The fourteen players are skinned Mixamo characters (src/chars/<id>.js, built by
// tools/pack-char.py). They plug into the game exactly where the procedural
// athletes did: build() returns the same rig object (root, mesh, bones[14],
// rest, m, handL/R, height) and MxAnimator drives it with the same state calls.
//
//   - The 14-bone procedural pose (IK arms and legs, run cycle, stances...) is
//     RETARGETED onto the Mixamo skeleton: a custom bone's world rotation is
//     applied on top of the Mixamo bone's world rotation in an "arms down" rest
//     pose, so every procedural animation still works on every body.
//   - Mixamo clips (Football Stance, Quarterback Pass, catches, Defender, Running,
//     Dying) are a layer on top: the view asks for one with st.clip and the
//     animator fades it in over the retargeted pose.
//   - Team colours: a flat team-coloured disc on the ground under each player (the bodies are all
//     different people in different clothes).
//
// Units: the game is in yards, the Mixamo data in centimetres; each body is
// scaled so the top of its head is at HEAD_YD (times a per-character factor).
(function () {
  const THREE = window.THREE;
  const A = window.TBAnim;
  const B = A.B;
  const PARENT = window.TBRig.PARENT;
  const NB = 14;

  // Mixamo bone for each of the 14 procedural bones (indexed by B).
  const ORDER = ["Hips", "Spine", "Spine2", "Head", "LeftArm", "LeftForeArm", "RightArm", "RightForeArm",
    "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot"];
  const HEAD_YD = 1.95;

  // Per-character look: nickname, height factor (head top vs HEAD_YD).
  // 2026-10-03: humans only (the user's pick of the 16): the mouse, mannequin,
  // dark knight, creature, vampire and zombie were dropped.
  const TRAITS = {
    Ch08: { name: "Marcus" }, Ch15: { name: "Sarge" }, Ch17: { name: "Hardhat" }, Ch20: { name: "Crimson" },
    Ch28: { name: "Shadow" }, Ch31: { name: "Smitty" }, Ch46: { name: "Neon", h: 0.84 },
    // style "f": the female-style library takes (idleF, walkF) in view.js.
    Paladin_J_Nordstrom: { name: "Paladin" }, Peasant_Girl: { name: "Rosa", h: 0.86, style: "f" },
    Vanguard_By_T_Choonyung: { name: "Vanguard" },
    // 2026-10-06: the user's own players (new-players/, painted in team colours by
    // tools/paint-players.py). Nicknames are mine; a few reuse the 2D cast's names where
    // the look matches (Pops, Curls, Stretch, Moose, Grizz).
    turkey_01: { name: "Pops", h: 0.92 }, turkey_02: { name: "Thor" }, turkey_03: { name: "Kiki", h: 0.93, style: "f" },
    turkey_04: { name: "Dre" }, turkey_05: { name: "Stretch", h: 1.04 }, turkey_06: { name: "Curls" },
    turkey_07: { name: "Beanie", h: 0.94 }, turkey_07_w: { name: "Beanie Jr.", h: 0.94 },
    wildcat_01: { name: "Moose", h: 0.96 }, wildcat_02: { name: "Sarge", h: 1.02 }, wildcat_03: { name: "Slim" },
    wildcat_04: { name: "Ace", h: 0.97 }, wildcat_05: { name: "Grizz", h: 1.01 }, wildcat_06: { name: "Doc" },
    wildcat_07: { name: "Jazz", h: 0.93, style: "f" }
  };
  // Who plays where: each team wears its own colours, so its people are fixed to it. A slot
  // lists fallbacks (the first one loaded plays).
  // 2026-10-24: all 14 are textured Meshy remakes (tools/texture-players.py), uniforms in the
  // texture; wildcat_01 is rigged now, so the turkey_07_w stand-in is gone.
  const CAST = {
    turkeys: { lineman: ["turkey_02"], lineman_2: ["turkey_07"], tight_end: ["turkey_06"], utility_1: ["turkey_04"],
      utility_2: ["turkey_03"], utility_3: ["turkey_05"], utility_4: ["turkey_01"] },
    wildcats: { lineman: ["wildcat_01"], lineman_2: ["wildcat_02"], tight_end: ["wildcat_05"], utility_1: ["wildcat_06"],
      utility_2: ["wildcat_03"], utility_3: ["wildcat_04"], utility_4: ["wildcat_07"] }
  };

  // Clip fixes, applied once to TBChars.clips before any body uses them.
  //   yaw:     turn the whole take about the vertical (Run Backward is authored
  //            facing away from its travel; Slow Jog Backwards is skewed 20 deg).
  //   detrend: the take turns as it goes (Run Arc Left, Sprint Turn); the game
  //            turns the player itself, so take the turn out and keep the rest.
  //   mirror:  a left/right mirrored copy, named <clip>_m (the skeletons are
  //            symmetric to a few degrees, fingers only).
  const CLIP_FIX = {
    runB: { yaw: Math.PI }, jogB: { yaw: 20 * Math.PI / 180 },
    arcL: { detrend: true, mirror: true }, sprintTurn: { detrend: true, mirror: true },
    strafe: { mirror: true }, strafeR: { mirror: true }, lookRun: { mirror: true }, gkCatch: { mirror: true }
  };

  const Mx = { ready: false, cache: {}, assign: null };
  window.TBMx = Mx;

  const _q = new THREE.Quaternion();
  const _q2 = new THREE.Quaternion();
  const _v = new THREE.Vector3();
  const _m = new THREE.Matrix4();

  function chars() { return window.TBChars; }
  // Seven distinct bodies per team is the minimum; fewer than 14 means repeats across teams.
  Mx.available = function () { return !!(chars() && chars().list && chars().list.length >= 7 && chars().clips); };

  // ---- clip fixes (once) ----------------------------------------------------------------

  function hipsYaw(v, o) {
    const x = v[o], y = v[o + 1], z = v[o + 2], w = v[o + 3];
    return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
  }
  // Pre-rotate hips key k by a yaw (world vertical: the hips are the root bone).
  function yawKey(v, o, a) {
    _q2.set(0, Math.sin(a / 2), 0, Math.cos(a / 2));
    _q.fromArray(v, o).premultiply(_q2).toArray(v, o);
  }
  function fixClips() {
    const C = chars().clips;
    if (C._fixed) return;
    Object.keys(CLIP_FIX).forEach(function (name) {
      const c = C[name], fx = CLIP_FIX[name];
      if (!c) return;
      const hq = c.tracks.find(function (t) { return t.k === "q" && t.b === "Hips"; });
      if (hq && fx.yaw) for (let o = 0; o < hq.v.length; o += 4) yawKey(hq.v, o, fx.yaw);
      if (hq && fx.detrend) {
        const n = hq.v.length / 4;
        const y0 = hipsYaw(hq.v, 0);
        let turn = hipsYaw(hq.v, (n - 1) * 4) - y0;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        for (let k = 0; k < n; k++) yawKey(hq.v, k * 4, -(y0 + turn * k / Math.max(1, n - 1)));
      }
      if (fx.mirror) {
        const swap = function (b) { return b.indexOf("Left") === 0 ? "Right" + b.slice(4) : b.indexOf("Right") === 0 ? "Left" + b.slice(5) : b; };
        C[name + "_m"] = {
          dur: c.dur, hipsRest: c.hipsRest,
          tracks: c.tracks.map(function (t) {
            const v = t.v.slice();
            if (t.k === "q") for (let o = 0; o < v.length; o += 4) { v[o + 1] = -v[o + 1]; v[o + 2] = -v[o + 2]; }
            else if (t.k === "hp") for (let o = 0; o < v.length; o += 3) v[o] = -v[o];
            return { b: swap(t.b), k: t.k, t: t.t, v: v };
          })
        };
      }
    });
    Object.defineProperty(C, "_fixed", { value: true, enumerable: false });   // prepare() lists the clips
  }
  Mx.fixClips = fixClips;

  // ---- model preparation (once per character) ------------------------------------------

  function prepare(id) {
    if (Mx.cache[id] !== undefined) return Mx.cache[id];
    fixClips();
    const D = chars().data[id];
    if (!D) return (Mx.cache[id] = null);
    const M = { id: id, D: D, BN: {} };
    D.bones.forEach(function (b, i) { M.BN[b.name] = i; });
    const raw = atob(D.bin), bin = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i);
    D.bin = null;
    const nv = D.verts, buf = bin.buffer;
    let o = 0;
    function take(Type, n) { const a = new Type(buf, o, n); o += n * Type.BYTES_PER_ELEMENT; return a; }
    const geo = new THREE.BufferGeometry();
    const pos = take(Float32Array, nv * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(take(Float32Array, nv * 2), 2));
    geo.setAttribute("normal", new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(take(Int8Array, nv * 4), 4), 3, 0, true));
    const skinIdx = take(Uint8Array, nv * 4);
    geo.setAttribute("skinIndex", new THREE.BufferAttribute(skinIdx, 4));
    const skinW = take(Uint8Array, nv * 4);
    geo.setAttribute("skinWeight", new THREE.BufferAttribute(skinW, 4, true));
    geo.setIndex(new THREE.BufferAttribute(take(D.wideIndex ? Uint32Array : Uint16Array, D.index), 1));
    // The user's new players (tools/paint-players.py: no texture, painted in team colours)
    // append RGBA vertex colours after the index.
    if (D.colors) geo.setAttribute("color", new THREE.BufferAttribute(take(Uint8Array, nv * 4), 4, true));
    let start = 0;
    D.groups.forEach(function (count, mi) { geo.addGroup(start, count, mi); start += count; });
    geo.computeBoundingSphere();
    M.geo = geo;
    M.pos = pos; M.skinIdx = skinIdx; M.skinW = skinW;
    M.mats = D.materials.map(function (m) {
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
      const mat = new THREE.MeshStandardMaterial({ map: t.map || null, normalMap: t.normalMap || null, roughness: 0.78, metalness: 0.05, vertexColors: !!D.colors });
      if (t.alphaMap) { mat.alphaMap = t.alphaMap; mat.alphaTest = 0.5; mat.side = THREE.DoubleSide; }
      return mat;
    });
    M.inverses = D.inverses.map(function (e) { return new THREE.Matrix4().fromArray(e); });
    M.nb = D.bones.length;
    M.restQ = D.bones.map(function (b) { return new THREE.Quaternion().fromArray(b.q); });

    // Bind pose, then the "arms down" pose the procedural rig's rest matches.
    const objs = D.bones.map(function (b) {
      const ob = new THREE.Object3D();
      ob.position.fromArray(b.p); ob.quaternion.fromArray(b.q); ob.scale.fromArray(b.s);
      return ob;
    });
    const holder = new THREE.Object3D();
    D.bones.forEach(function (b, i) { (b.parent >= 0 ? objs[b.parent] : holder).add(objs[i]); });
    holder.updateMatrixWorld(true);
    const wpos = function (i, out) { return out.setFromMatrixPosition(objs[i].matrixWorld); };
    const bindW = objs.map(function (ob) { return ob.getWorldQuaternion(new THREE.Quaternion()); });
    const top = M.BN.HeadTop_End !== undefined ? M.BN.HeadTop_End : M.BN.Head;
    const headY = wpos(top, _v).y;
    const trait = TRAITS[id] || {};
    M.scale = HEAD_YD * (trait.h || 1) / headY;

    ["Left", "Right"].forEach(function (side) {
      const ai = M.BN[side + "Arm"], fi = M.BN[side + "ForeArm"];
      const a = wpos(ai, new THREE.Vector3()), f = wpos(fi, new THREE.Vector3());
      const dir = f.sub(a).normalize();
      const down = new THREE.Quaternion().setFromUnitVectors(dir, new THREE.Vector3(0, -1, 0));
      const pw = objs[D.bones[ai].parent].getWorldQuaternion(new THREE.Quaternion());
      objs[ai].quaternion.copy(pw.invert().multiply(down).multiply(bindW[ai]));
    });
    holder.updateMatrixWorld(true);
    M.R0w = objs.map(function (ob) { return ob.getWorldQuaternion(new THREE.Quaternion()); });
    M.P0 = objs.map(function (ob) { return new THREE.Vector3().setFromMatrixPosition(ob.matrixWorld); });
    M.bindP = null;
    M.cmap = new Int8Array(M.nb).fill(-1);
    M.cidx = ORDER.map(function (n, i) { M.cmap[M.BN[n]] = i; return M.BN[n]; });
    M.parent = D.bones.map(function (b) { return b.parent; });
    M.bindY = {};
    M.hipsRest = D.bones[M.BN.Hips].p;

    // Bone offsets in the procedural rig's parent spaces, in yards.
    const s = M.scale;
    const P = M.P0, I = M.cidx;
    const rel = function (i, j) { return P[I[i]].clone().sub(P[I[j]]).multiplyScalar(s); };
    const rest = [];
    rest[B.hips] = P[I[B.hips]].clone().multiplyScalar(s);
    rest[B.spine] = rel(B.spine, B.hips);
    rest[B.chest] = rel(B.chest, B.spine);
    rest[B.head] = rel(B.head, B.chest);
    rest[B.uaL] = rel(B.uaL, B.chest);
    rest[B.faL] = rel(B.faL, B.uaL);
    rest[B.uaR] = rel(B.uaR, B.chest);
    rest[B.faR] = rel(B.faR, B.uaR);
    rest[B.thL] = rel(B.thL, B.hips);
    rest[B.shL] = rel(B.shL, B.thL);
    rest[B.ftL] = rel(B.ftL, B.shL);
    rest[B.thR] = rel(B.thR, B.hips);
    rest[B.shR] = rel(B.shR, B.thR);
    rest[B.ftR] = rel(B.ftR, B.shR);
    M.rest = rest;
    const handIdx = M.BN.LeftHand;
    const thigh = rest[B.shL].length(), shin = rest[B.ftL].length();
    const ankle = P[I[B.ftL]].y * s;
    M.m = {
      h: 1, w: 1, belly: 0, ankle: ankle, shin: shin, thigh: thigh,
      hipY: ankle + thigh + shin - rest[B.thL].y,
      hipX: rest[B.thL].x,
      upperArm: rest[B.faL].length(),
      forearm: wpos(handIdx, new THREE.Vector3()).clone().sub(P[I[B.faL]]).length() * s,
      sx: 1.16, sz: 0.8, spineY: rest[B.spine].y, chestY: rest[B.chest].y
    };
    // Height of the top of the head, for labels.
    M.height = headY * s;

    // Clips -> per-bone frame arrays; hips height scaled from the clip's body.
    M.clips = {};
    const hipsH = D.bones[M.BN.Hips].p[1];
    Object.keys(chars().clips).forEach(function (k) {
      const c = chars().clips[k];
      const cl = { dur: c.dur, q: [], hy: null, hp: null, hyScale: hipsH / (c.hipsRest || hipsH) };
      c.tracks.forEach(function (tr) {
        const bi = M.BN[tr.b];
        if (bi === undefined) return;
        const fr = { n: tr.t.length, dt: tr.t.length > 1 ? tr.t[1] - tr.t[0] : 1, v: new Float32Array(tr.v) };
        if (tr.k === "q") cl.q.push({ i: bi, f: fr });
        else if (tr.k === "hy") cl.hy = fr;
        else if (tr.k === "hp") cl.hp = fr;
      });
      M.clips[k] = cl;
    });
    return (Mx.cache[id] = M);
  }

  // ---- team marker: a flat disc on the ground -------------------------------------------
  // Nothing is attached to the body, so no outfit, dive or fall can distort it. Sits
  // inside the 0.55 steer/carrier rings (view.js) so those still read around it.

  function buildMarker(team) {
    const group = new THREE.Group();
    group.name = "teamMarker";
    const mk = function (r0, r1, color, order) {
      const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 36), new THREE.MeshBasicMaterial({
        color: color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide
      }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.03;
      m.renderOrder = order;
      return m;
    };
    const rim = team.id === "turkeys" ? "#4a2a12" : (team.accent || "#ffffff");
    group.add(mk(0, 0.34, team.primary, 2), mk(0.34, 0.42, rim, 2));
    const mats = group.children.map(function (m) { return m; });
    return {
      group: group,
      dispose: function () { mats.forEach(function (m) { m.geometry.dispose(); m.material.dispose(); }); }
    };
  }
  // ---- deal: which body plays which slot ---------------------------------------------------

  function shuffled(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // Random fourteen, in team/char order. Also renames the players to match.
  // With fewer than 14 bodies every one plays, and the shortfall is made up by
  // bodies repeated from the other team (never twice on one team); the repeat
  // is "<name> Jr." so the two teams' rosters read as different people.
  Mx.deal = function (D) {
    const slots = Object.keys(D.CHAR_SLOT), per = slots.length;
    // The team-painted cast, when every slot has a body: fixed teams and slots.
    const list = chars().list;
    const pick = function (team, c) { return ((CAST[team] || {})[c] || []).find(function (id) { return list.indexOf(id) >= 0; }); };
    if (D.TEAMS.every(function (team) { return slots.every(function (c) { return pick(team.id, c); }); })) {
      Mx.assign = { wildcats: {}, turkeys: {} };
      D.TEAMS.forEach(function (team) {
        slots.forEach(function (c) {
          const id = pick(team.id, c), spec = D.CHARACTERS[team.id][c];
          Mx.assign[team.id][c] = id;
          spec.label = (TRAITS[id] && TRAITS[id].name) || id;
          spec.mxId = id;
        });
      });
      Mx.ready = true;
      return;
    }
    const pool = shuffled(chars().list);
    const first = pool.slice(0, per);
    let second = pool.slice(per, per * 2);
    const repeats = shuffled(first).slice(0, per - second.length);
    second = shuffled(second.concat(repeats));
    const teams = Math.random() < 0.5 ? [first, second] : [second, first];
    Mx.assign = { wildcats: {}, turkeys: {} };
    D.TEAMS.forEach(function (team, ti) {
      const ids = teams[ti];
      slots.forEach(function (c, ci) {
        const id = ids[ci];
        Mx.assign[team.id][c] = id;
        const spec = D.CHARACTERS[team.id][c];
        const name = (TRAITS[id] && TRAITS[id].name) || id;
        spec.label = repeats.indexOf(id) >= 0 && ids !== first ? name + " Jr." : name;
        spec.mxId = id;
      });
    });
    Mx.ready = true;
  };

  // ---- rig ---------------------------------------------------------------------------------

  Mx.build = function (spec, team, number, key) {
    const id = spec.mxId;
    const M = prepare(id);
    if (!M) return null;
    const D = M.D;
    const root = new THREE.Group();
    root.name = key;
    const body = new THREE.Group();
    body.scale.setScalar(M.scale);
    root.add(body);
    const bones = D.bones.map(function (b) {
      const bone = new THREE.Bone();
      bone.name = b.name;
      bone.position.fromArray(b.p); bone.quaternion.fromArray(b.q); bone.scale.fromArray(b.s);
      return bone;
    });
    D.bones.forEach(function (b, i) { (b.parent >= 0 ? bones[b.parent] : body).add(bones[i]); });
    const mesh = new THREE.SkinnedMesh(M.geo, M.mats);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    body.add(mesh);
    body.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones, M.inverses), new THREE.Matrix4());
    const marker = buildMarker(team);
    root.add(marker.group);

    // Ball anchors at the palms, and the procedural "forearm frame" the ball
    // orientation is read from (world rotation == the procedural bone's).
    function anchor(side) {
      const hand = bones[M.BN[side + "Hand"]];
      const mid = M.BN[side + "HandMiddle1"];
      const a = new THREE.Object3D();
      if (mid !== undefined) a.position.fromArray(D.bones[mid].p).multiplyScalar(0.85);
      else a.position.set(0, 8, 0);
      hand.add(a);
      return a;
    }
    const handL = anchor("Left"), handR = anchor("Right");
    const cb = []; // procedural-index frames (world rotation == custom bone's world rotation)
    for (let i = 0; i < NB; i++) {
      const fr = new THREE.Object3D();
      fr.quaternion.copy(M.R0w[M.cidx[i]]).invert();
      bones[M.cidx[i]].add(fr);
      cb.push(fr);
    }

    const rig = {
      key: key, spec: spec, team: team, root: root, mesh: mesh, bones: cb, mxBones: bones,
      rest: M.rest, m: M.m, handR: handR, handL: handL, height: M.height, mx: M, mxId: id,
      style: (TRAITS[id] && TRAITS[id].style) || "m",
      dispose: function () { marker.dispose(); }
    };
    return rig;
  };

  // ---- clip sampling -------------------------------------------------------------------------

  function sampleQ(f, i, t, out, base) {
    let x = t / f.dt;
    if (x < 0) x = 0; if (x > f.n - 1) x = f.n - 1;
    const a = Math.floor(x), b = Math.min(f.n - 1, a + 1);
    THREE.Quaternion.slerpFlat(out, base, f.v, a * 4, f.v, b * 4, x - a);
  }
  function sampleV3(f, t, k, scale, out) {
    let x = t / f.dt;
    if (x < 0) x = 0; if (x > f.n - 1) x = f.n - 1;
    const a = Math.floor(x), b = Math.min(f.n - 1, a + 1), u = x - a;
    for (let c = 0; c < 3; c++) out[c] = (f.v[a * 3 + c] + (f.v[b * 3 + c] - f.v[a * 3 + c]) * u) * scale;
    void k;
    return out;
  }

  // ---- animator ------------------------------------------------------------------------------

  const UPPER_NAMES = ["Spine", "Spine1", "Spine2", "Neck", "Head", "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
    "RightShoulder", "RightArm", "RightForeArm", "RightHand"];
  const ARM_NAMES = ["LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand", "RightShoulder", "RightArm", "RightForeArm", "RightHand"];
  const LOWER_NAMES = ["Hips", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase"];
  function partSet(M, part) {
    const key = "_p_" + part;
    if (M[key]) return M[key];
    const set = new Uint8Array(M.nb);
    if (part === "all") set.fill(1);
    else (part === "arms" ? ARM_NAMES : part === "lower" ? LOWER_NAMES : UPPER_NAMES).forEach(function (n) { if (M.BN[n] !== undefined) set[M.BN[n]] = 1; });
    return (M[key] = set);
  }

  // Same API as TBAnim.Animator, plus st.clip = { name, t, part, hips, fadeIn, fadeOut }.
  function MxAnimator(rig, seed) {
    A.Animator.call(this, rig, seed);
    const M = rig.mx;
    this.M = M;
    this.W = [];
    for (let i = 0; i < NB; i++) this.W.push(new THREE.Quaternion());
    this.Wm = [];
    this.lq = new Float32Array(M.nb * 4);
    this.cq = new Float32Array(M.nb * 4);
    for (let j = 0; j < M.nb; j++) this.Wm.push(new THREE.Quaternion());
    this.clip = null;      // current clip request
    this.clipW = 0;
    this.clipName = "";
    this.clipPart = "all";
    this.clipHips = false;
    this.hips = [0, 0, 0];
    this.last = new Float32Array(M.nb * 4);   // the pose on screen, for cross-fades between clips
    this.snap = new Float32Array(M.nb * 4);
    this.snapW = 0;
    this.dt = 0;
  }
  MxAnimator.prototype = Object.create(A.Animator.prototype);
  MxAnimator.prototype.constructor = MxAnimator;

  MxAnimator.prototype.update = function (dt, st) {
    const c = st.clip;
    this.dt = dt;
    if (c && M_has(this.M, c.name)) {
      if (this.clipName !== c.name) {
        // Switching clips mid-play: fade from the pose that was on screen.
        if (this.clipW > 0.05) { this.snap.set(this.last); this.snapW = 1; }
        this.clipName = c.name;
        if (this.clipW < 0.05) this.clipW = 0;
      }
      this.clip = c;
      this.clipPart = c.part || "all";
      this.clipHips = !!c.hips;
      this.clipW = Math.min(1, this.clipW + dt / (c.fadeIn || 0.12));
    } else {
      this.clipW = Math.max(0, this.clipW - dt / ((this.clip && this.clip.fadeOut) || 0.15));
      if (this.clipW === 0) this.clip = null;
    }
    A.Animator.prototype.update.call(this, dt, st);   // ends in apply()
  };
  function M_has(M, name) { return !!M.clips[name]; }

  MxAnimator.prototype.apply = function () {
    const M = this.M, rig = this.rig, out = this.out, W = this.W, Wm = this.Wm, lq = this.lq, nb = M.nb;
    const bones = rig.mxBones, s = M.scale;
    for (let i = 0; i < NB; i++) {
      const p = PARENT[i];
      if (p >= 0) W[i].copy(W[p]).multiply(out.q[i]); else W[i].copy(out.q[i]);
    }
    for (let j = 0; j < nb; j++) {
      const p = M.parent[j];
      const ci = M.cmap[j];
      if (ci >= 0) {
        _q.copy(W[ci]).multiply(M.R0w[j]);
        Wm[j].copy(_q);
        if (p >= 0) _q.premultiply(_q2.copy(Wm[p]).invert());
        _q.toArray(lq, j * 4);
      } else {
        M.restQ[j].toArray(lq, j * 4);
        if (p >= 0) Wm[j].copy(Wm[p]).multiply(M.restQ[j]); else Wm[j].copy(M.restQ[j]);
      }
    }
    // Hips: the procedural height; a clip's own height when asked.
    const hips = this.hips;
    hips[0] = out.hp.x / s; hips[1] = out.hp.y / s; hips[2] = out.hp.z / s;

    if (this.clip && this.clipW > 0.001) {
      const cl = M.clips[this.clipName];
      const set = partSet(M, this.clipPart);
      const t = this.clip.t || 0, cq = this.cq;
      const w = this.clipW * this.clipW * (3 - 2 * this.clipW);
      for (let k = 0; k < cl.q.length; k++) {
        const tr = cl.q[k];
        if (!set[tr.i]) continue;
        sampleQ(tr.f, tr.i, t, cq, tr.i * 4);
        THREE.Quaternion.slerpFlat(lq, tr.i * 4, lq, tr.i * 4, cq, tr.i * 4, w);
      }
      if (this.clipHips && cl.hp) {
        const v = sampleV3(cl.hp, t, 0, cl.hyScale, [0, 0, 0]);
        hips[1] += (v[1] - hips[1]) * w;
        if (this.clip.travel) { hips[0] += v[0] * w; hips[2] += v[2] * w; }
      } else if (this.clipHips && cl.hy) {
        let x = t / cl.hy.dt; x = Math.max(0, Math.min(cl.hy.n - 1, x));
        const a = Math.floor(x), b = Math.min(cl.hy.n - 1, a + 1);
        const y = (cl.hy.v[a] + (cl.hy.v[b] - cl.hy.v[a]) * (x - a)) * cl.hyScale;
        hips[1] += (y - hips[1]) * w;
      }
    }
    if (this.snapW > 0) {
      const k = this.snapW * this.snapW * (3 - 2 * this.snapW);
      for (let j = 0; j < nb; j++) THREE.Quaternion.slerpFlat(lq, j * 4, lq, j * 4, this.snap, j * 4, k);
      this.snapW = Math.max(0, this.snapW - this.dt / 0.14);
    }
    this.last.set(lq);
    for (let j = 0; j < nb; j++) bones[j].quaternion.fromArray(lq, j * 4);
    bones[M.cidx[0]].position.set(hips[0], hips[1], hips[2]);
  };

  Mx.Animator = MxAnimator;
})();
