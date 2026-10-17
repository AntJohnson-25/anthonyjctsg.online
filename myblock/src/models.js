// Characters and their guns. Every fighter is a packed Mixamo body (SP.BODY,
// tools/pack-bodies.py) driven by the shared rifle clips (SP.CLIPS), with a
// procedural gun in the right hand. (Body loading, clip sampling and the grip
// measurement come from War Room's soldiers.js; outlines from Summit Protocol.)
//
// Clips play in place and the sim moves the root. Each frame a character gets
//   - a base clip picked from its velocity relative to where it faces (idle,
//     walk, run, strafe, backpedal, airborne), crossfaded when it changes;
//   - an upper-body overlay (reload, grenade throw, hit flinch);
//   - turns in code on top: the hips twist toward a diagonal run, the spine
//     bends with the aim pitch, the gun kicks on each shot, the rifle butt swings.
// Models face +x in the game's frame: root.rotation.y = -yaw, and the Mixamo
// body inside (which faces +z, with +x its left) is turned a quarter turn.
globalThis.SP = globalThis.SP || {};
(function (SP) {
  "use strict";
  const THREE = globalThis.THREE;
  const U = SP.U, WP = SP.WEAPONS;
  const Mo = {};
  let V = null;
  const HEAD_M = 1.76;          // every body is scaled so its head top is here
  const BLEND = 0.18;           // crossfade between base clips, seconds
  const TRAVEL = { rifle_death_walking: 1, death_backward: 1, death_forward: 1, zombie_death: 1, zombie_dying: 1, crouch_death: 1 };
  // Moving clips per stance. Each frame the one whose own direction of travel
  // (measured from its hips) is closest to where the body is really going is
  // played; "-name" plays a clip backwards. Walk tier below 2.4 m/s, run above.
  const SETS = {
    rifle: {
      walk: ["rifle_walk", "rifle_walk_back", "rifle_strafe_left_walk", "rifle_strafe_right_walk"],
      run: ["pro_run_forward", "rifle_run_back", "rifle_strafe_left_run", "rifle_strafe_right_run"]
    },
    pistol: {
      walk: ["pistol_walk", "pistol_walk_backward", "pistol_strafe", "pistol_strafe_2", "pistol_walk_arc", "pistol_walk_arc_2", "pistol_walk_backward_arc", "pistol_walk_backward_arc_2"],
      run: ["pistol_run", "pistol_run_backward", "pistol_strafe", "pistol_strafe_2", "pistol_run_arc", "pistol_run_arc_2", "pistol_run_backward_arc", "pistol_run_backward_arc_2"]
    },
    crouch: {
      walk: ["crouch_walk", "-crouch_walk", "crouch_sneak_left", "crouch_sneak_right", "pro_walk_crouching_forward_right", "crouch_cover"],
      run: ["crouch_walk", "-crouch_walk", "crouch_sneak_left", "crouch_sneak_right", "pro_walk_crouching_forward_right", "crouch_cover"]
    }
  };
  const LOOPS = {
    rifle_idle: 1, rifle_run: 1, rifle_fire_loop: 1, pro_idle: 1, pro_sprint_forward: 1, pistol_idle: 1, pistol_kneeling_idle: 1,
    zombie_walk: 1, zombie_run: 1, zombie_idle: 1, ladder: 1, hang: 1
  };
  Object.keys(SETS).forEach(function (s) { ["walk", "run"].forEach(function (t) { SETS[s][t].forEach(function (k) { LOOPS[k.replace(/^-/, "")] = 1; }); }); });
  function ease(t) { return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }

  // ------------------------------------------------------------------ model data
  const models = {};
  function buildModel(id) {
    const D = SP.BODY && SP.BODY[id];
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
    // Painted bodies (Ant) append RGBA vertex colours after the index.
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
    D.bin = null;   // decoded into the geometry; free the text
    M.mats = null;
    M.inverses = D.inverses.map(function (e) { return new THREE.Matrix4().fromArray(e); });
    M.nb = D.bones.length;
    M.rest = new Float32Array(M.nb * 4);
    D.bones.forEach(function (b, i) { M.rest.set(b.q, i * 4); });
    M.hipsRest = D.bones[M.BN.Hips].p;
    // Upper body = Spine and everything under it (arms, neck, head): what the
    // reload, throw and flinch overlays drive.
    M.upper = new Uint8Array(M.nb);
    D.bones.forEach(function (b, i) {
      for (let k = i; k >= 0; k = D.bones[k].parent) if (k === M.BN.Spine) { M.upper[i] = 1; break; }
    });
    // Head-top height in the rest pose -> scale to metres.
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
    // Clips -> per-bone frame arrays; hips height and travel scaled to this body.
    M.clips = {};
    Object.keys(SP.CLIPS).forEach(function (k) {
      const c = SP.CLIPS[k];
      const cl = { key: k, dur: c.dur, n: c.n, q: [], hp: null, s: M.hipsRest[1] / (c.hipsRest || M.hipsRest[1]),
        release: c.release, loop: !!LOOPS[k], travel: !!TRAVEL[k] };
      c.tracks.forEach(function (tr) {
        if (tr.k === "hp") { cl.hp = new Float32Array(tr.v); return; }
        const bi = M.BN[tr.b];
        if (bi !== undefined) cl.q.push({ i: bi, v: new Float32Array(tr.v) });
      });
      // A loop's own ground speed in m/s (its hips travel over one cycle), and
      // the direction it travels in, relative to facing (0 ahead, + to the right;
      // the body's +x is its left).
      const e = (c.n - 1) * 3;
      cl.mps = cl.hp ? Math.hypot(cl.hp[e], cl.hp[e + 2]) * cl.s * M.scale / c.dur : 0;
      cl.ang = cl.hp ? Math.atan2(-cl.hp[e], cl.hp[e + 2]) : 0;
      M.clips[k] = cl;
    });
    // The stance sets, resolved to this body's clips.
    M.sets = {};
    Object.keys(SETS).forEach(function (s) {
      M.sets[s] = {};
      ["walk", "run"].forEach(function (t) {
        M.sets[s][t] = SETS[s][t].map(function (k) {
          const rev = k.charAt(0) === "-", cl = M.clips[k.replace(/^-/, "")];
          return cl ? { cl: cl, rev: rev, ang: U.wrap(cl.ang + (rev ? Math.PI : 0)) } : null;
        }).filter(Boolean);
      });
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
        const m = new THREE.MeshStandardMaterial({ map: t.map || null, normalMap: t.normalMap || null,
          roughness: 0.82, metalness: 0.05, vertexColors: !!M.D.colors });
        if (t.alphaMap) { m.alphaMap = t.alphaMap; m.alphaTest = 0.5; m.side = THREE.DoubleSide; }
        return m;
      });
    }
    return M.mats;
  }

  // ------------------------------------------------------------------ clip sampling
  const QS = new Float32Array(4);
  function frameOf(cl, t) {
    const f = Math.max(0, Math.min(cl.n - 1, t * SP.CLIP_FPS)), a = Math.floor(f);
    return { a: a, b: Math.min(cl.n - 1, a + 1), u: f - a };
  }
  // Pose clip cl at time t into out (bone quaternions), at weight w; mask
  // (optional) limits it to some bones.
  function sample(cl, t, out, w, mask) {
    const F = frameOf(cl, t), a = F.a * 4, b = F.b * 4, u = F.u;
    for (let k = 0; k < cl.q.length; k++) {
      const tr = cl.q[k];
      if (mask && !mask[tr.i]) continue;
      if (w >= 1) THREE.Quaternion.slerpFlat(out, tr.i * 4, tr.v, a, tr.v, b, u);
      else {
        THREE.Quaternion.slerpFlat(QS, 0, tr.v, a, tr.v, b, u);
        THREE.Quaternion.slerpFlat(out, tr.i * 4, out, tr.i * 4, QS, 0, w);
      }
    }
  }
  const OFF = [0, 0, 0];
  function hipsOffset(cl, t) {
    const F = frameOf(cl, t), v = cl.hp, a = F.a * 3, b = F.b * 3, u = F.u;
    OFF[0] = (v[a] + (v[b] - v[a]) * u) * cl.s;
    OFF[1] = (v[a + 1] + (v[b + 1] - v[a + 1]) * u) * cl.s;
    OFF[2] = (v[a + 2] + (v[b + 2] - v[a + 2]) * u) * cl.s;
    return OFF;
  }

  // Rotate a bone about an axis given in the body's own space (Mixamo: +x
  // left, +y up, +z forward), whatever its local axes are.
  const _aq = new THREE.Quaternion(), _sq = new THREE.Quaternion(), _rq = new THREE.Quaternion(), _av = new THREE.Vector3();
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

  // ------------------------------------------------------------------ guns
  // Guns in metres. Origin = where the right fist closes on the grip; the bore
  // runs along +x; +y is the top of the gun. userData.muzzle = the barrel tip.
  const gunMats = {};
  function gmat(c, r, m) {
    const k = c + "/" + r + "/" + m;
    return gunMats[k] || (gunMats[k] = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m }));
  }
  function gunMesh(w, scale) {
    const g = new THREE.Group();
    const black = gmat(0x1b1d20, 0.5, 0.4), poly = gmat(0x2a2c2a, 0.75, 0.1), steel = gmat(0x46494d, 0.35, 0.85),
      wood = gmat(0x6b4426, 0.6, 0.05), olive = gmat(0x4a5233, 0.7, 0.1), tan = gmat(0x8c7a5a, 0.7, 0.05);
    function box(w_, h, d, x, y, z, m, rz) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w_, h, d), m);
      b.position.set(x, y, z);
      if (rz) b.rotation.z = rz;
      g.add(b);
      return b;
    }
    function tube(r, len, x, y, m, seg, r2) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(r2 === undefined ? r : r2, r, len, seg || 10), m);
      c.rotation.z = -Math.PI / 2;     // along +x
      c.position.set(x, y, 0);
      g.add(c);
      return c;
    }
    let mx = 0.6, my = 0.055;
    switch (w) {
      case 0:   // 9mm pistol
        box(0.19, 0.034, 0.028, 0.06, 0.058, 0, black);            // slide
        box(0.15, 0.026, 0.026, 0.05, 0.03, 0, poly);              // frame
        box(0.032, 0.11, 0.028, -0.005, -0.02, 0, poly, -0.25);    // grip
        box(0.04, 0.008, 0.02, 0.035, 0.008, 0, poly);             // trigger guard
        mx = 0.158; my = 0.058;
        break;
      case 1:   // assault rifle
        box(0.34, 0.07, 0.045, 0.05, 0.05, 0, black);              // receiver
        box(0.24, 0.058, 0.052, 0.32, 0.052, 0, poly);             // handguard
        box(0.24, 0.012, 0.02, 0.32, 0.087, 0, black);             // top rail
        box(0.26, 0.05, 0.04, -0.28, 0.035, 0, poly, 0.06);        // stock
        box(0.05, 0.1, 0.045, -0.4, 0.015, 0, poly);               // butt pad
        box(0.035, 0.09, 0.03, -0.01, -0.02, 0, poly, -0.35);      // pistol grip
        box(0.05, 0.08, 0.03, 0.12, -0.02, 0, black, -0.1);        // magazine (curved: two pieces)
        box(0.05, 0.07, 0.03, 0.135, -0.085, 0, black, -0.3);
        box(0.03, 0.05, 0.014, 0.08, 0.105, 0, black);             // rear sight
        tube(0.011, 0.18, 0.53, 0.055, steel, 8);                  // barrel
        box(0.012, 0.05, 0.012, 0.47, 0.09, 0, black);             // front sight post
        tube(0.016, 0.05, 0.635, 0.055, black, 8);                 // muzzle brake
        mx = 0.665;
        break;
      case 2:   // pump shotgun
        box(0.2, 0.065, 0.045, 0.06, 0.05, 0, black);              // receiver
        tube(0.014, 0.5, 0.42, 0.065, steel, 10);                  // barrel
        tube(0.012, 0.4, 0.37, 0.035, black, 10);                  // tube magazine
        box(0.16, 0.045, 0.055, 0.33, 0.035, 0, wood);             // pump forend
        box(0.28, 0.06, 0.04, -0.2, 0.025, 0, wood, 0.12);         // stock
        box(0.035, 0.085, 0.03, -0.01, -0.015, 0, wood, -0.4);     // grip
        mx = 0.67; my = 0.065;
        break;
      case 3:   // marksman rifle
        box(0.32, 0.07, 0.045, 0.06, 0.05, 0, black);              // receiver
        box(0.26, 0.06, 0.05, 0.34, 0.05, 0, tan);                 // handguard
        tube(0.011, 0.36, 0.64, 0.055, steel, 8);                  // long barrel
        tube(0.02, 0.07, 0.83, 0.055, black, 8);                   // suppressor-style brake
        box(0.3, 0.06, 0.042, -0.26, 0.03, 0, tan, 0.05);          // stock
        box(0.14, 0.03, 0.04, -0.22, 0.075, 0, tan);               // cheek rest
        box(0.035, 0.09, 0.03, -0.01, -0.02, 0, black, -0.35);     // grip
        box(0.06, 0.07, 0.03, 0.12, -0.025, 0, black);             // magazine
        tube(0.022, 0.3, 0.07, 0.13, black, 12);                   // scope tube
        tube(0.03, 0.05, 0.24, 0.13, black, 12, 0.022);            // objective bell
        box(0.02, 0.04, 0.02, 0.0, 0.1, 0, black); box(0.02, 0.04, 0.02, 0.14, 0.1, 0, black);   // rings
        mx = 0.87;
        break;
      case 4: { // RPG
        tube(0.042, 1.0, 0.12, 0.1, olive, 12);                    // launch tube
        tube(0.04, 0.06, -0.38, 0.1, black, 12, 0.055);            // venturi flare
        tube(0.05, 0.16, 0.68, 0.1, olive, 12);                    // warhead body
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 12), olive);
        cone.rotation.z = -Math.PI / 2; cone.position.set(0.86, 0.1, 0); g.add(cone);
        box(0.035, 0.1, 0.03, 0.0, 0.02, 0, wood, -0.3);           // grip
        box(0.035, 0.09, 0.03, 0.22, 0.02, 0, wood, -0.2);         // fore grip
        box(0.05, 0.05, 0.02, 0.1, 0.17, 0, black);                // sight
        mx = 0.96; my = 0.1;
        break;
      }
      case 5: { // frag
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 9), olive);
        s.scale.set(1, 1.15, 1); g.add(s);
        box(0.018, 0.05, 0.014, 0.022, 0.035, 0, steel);
        mx = 0; my = 0;
        break;
      }
    }
    const muzzle = new THREE.Object3D();
    muzzle.position.set(mx, my, 0);
    g.add(muzzle);
    g.userData.muzzle = muzzle;
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    if (scale) g.scale.setScalar(scale);
    return g;
  }
  Mo.gunMesh = gunMesh;

  // A side-on picture of every gun (PNG data URLs, transparent background) for
  // the weapon wheel: each model rendered once by a small throwaway renderer.
  Mo.gunPictures = function () {
    if (Mo._pics) return Mo._pics;
    const W = 320, H = 160;
    const r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    r.setSize(W, H, false);
    r.setClearColor(0x000000, 0);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xf2f4ff, 0x3a3630, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.8); key.position.set(0.5, 1.2, 1); scene.add(key);
    const rim = new THREE.DirectionalLight(0xffd9a8, 1.6); rim.position.set(-1, 0.4, -0.6); scene.add(rim);
    const cam = new THREE.PerspectiveCamera(20, W / H, 0.01, 50);
    const half = Math.tan(cam.fov * Math.PI / 360);
    Mo._pics = WP.map(function (w) {
      const g = gunMesh(w.id);
      g.rotation.set(0.12, -0.18, 0.04);           // a slight three-quarter turn
      scene.add(g);
      g.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      g.position.sub(c);
      const fit = Math.max(s.x / cam.aspect, s.y) / (2 * half) * 1.18;
      cam.position.set(0, 0, fit + s.z / 2); cam.lookAt(0, 0, 0);
      r.render(scene, cam);
      const url = r.domElement.toDataURL("image/png");
      scene.remove(g);
      return url;
    });
    r.dispose(); r.forceContextLoss();
    return Mo._pics;
  };

  // Gun placement, measured once per body in the aiming idle: right fist on
  // the grip, bore pointing at the left hand, top of the gun up. The same
  // placement relative to the left hand carries the gun while the right hand
  // throws a grenade.
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _m2 = new THREE.Matrix4();
  function measureGrip(c) {
    const M = c.M, bones = c.bones;
    poseRest(c, M.clips.rifle_idle, 0);
    c.root.updateMatrixWorld(true);
    const rh = bones[M.BN.RightHand], lh = bones[M.BN.LeftHand];
    const fb = bones[M.BN.RightHandMiddle1 !== undefined ? M.BN.RightHandMiddle1 : M.BN.RightHand];
    const R = rh.getWorldPosition(new THREE.Vector3()), L = lh.getWorldPosition(new THREE.Vector3());
    const F = fb.getWorldPosition(new THREE.Vector3());
    const grip = R.clone().lerp(F, 0.6);
    const X = _a.copy(L).sub(grip).normalize();
    const Z = _b.copy(X).cross(_c.set(0, 1, 0)).normalize();
    const Y = _c.copy(Z).cross(X).normalize();
    const want = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(grip);
    function local(bone, m) {
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      _m2.copy(bone.matrixWorld).invert().multiply(m || want).decompose(p, q, sc);
      return { p: p, q: q, s: sc };
    }
    M.grip = { R: local(rh), L: local(lh) };
    // The pistol: measured in the pistol pack's stance, the barrel out along the forearm.
    if (M.clips.pistol_idle) {
      poseRest(c, M.clips.pistol_idle, 0);
      c.root.updateMatrixWorld(true);
      const fa = bones[M.BN.RightForeArm !== undefined ? M.BN.RightForeArm : M.BN.RightHand];
      const R2 = rh.getWorldPosition(new THREE.Vector3()), F2 = fb.getWorldPosition(new THREE.Vector3()), A2 = fa.getWorldPosition(new THREE.Vector3());
      const g2 = R2.clone().lerp(F2, 0.55);
      const X2 = R2.clone().sub(A2).normalize();
      const Z2 = X2.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
      const Y2 = Z2.clone().cross(X2).normalize();
      M.grip.P = local(rh, new THREE.Matrix4().makeBasis(X2, Y2, Z2).setPosition(g2));
    } else M.grip.P = M.grip.R;
  }
  // hand: "R" (rifle grip), "P" (pistol grip, right hand) or "L" (carried in the left while throwing).
  function holdGun(c, hand) {
    if (c.hand === hand) return;
    const g = c.M.grip[hand], bone = c.bones[c.M.BN[hand === "L" ? "LeftHand" : "RightHand"]];
    bone.add(c.holder);
    c.holder.position.copy(g.p); c.holder.quaternion.copy(g.q); c.holder.scale.copy(g.s);
    c.hand = hand;
  }
  function setGun(c, w) {
    if (c.gunW === w) return;
    if (c.guns[c.gunW]) c.guns[c.gunW].visible = false;
    if (!c.guns[w]) {
      c.guns[w] = gunMesh(w);
      c.holder.add(c.guns[w]);
      c.guns[w].traverse(function (o) { if (o.isMesh) o.castShadow = Mo.charShadows; });
    }
    c.guns[w].visible = true;
    c.gunW = w;
  }

  // ------------------------------------------------------------------ outlines, tags, markers
  // Enemies get a bright outline (an inverted hull: the same skinned mesh drawn
  // back faces only, pushed out along smoothed normals) that thickens with
  // distance, and a small marker over the head at range. Both are depth-tested:
  // walls still hide them.
  Mo.outlines = true;
  const OUTLINE_COL = 0xff3b2f;
  function outlineNormals(geo) {
    if (geo.attributes.outlineNormal) return;
    const pos = geo.attributes.position, nor = geo.attributes.normal, n = pos.count;
    const acc = new Map(), out = new Float32Array(n * 3);
    const key = function (i) { return Math.round(pos.getX(i) * 100) + "," + Math.round(pos.getY(i) * 100) + "," + Math.round(pos.getZ(i) * 100); };
    for (let i = 0; i < n; i++) {
      const k = key(i), a = acc.get(k) || [0, 0, 0];
      if (nor) { a[0] += nor.getX(i); a[1] += nor.getY(i); a[2] += nor.getZ(i); }
      acc.set(k, a);
    }
    for (let i = 0; i < n; i++) {
      const a = acc.get(key(i)), l = Math.hypot(a[0], a[1], a[2]) || 1;
      out[i * 3] = a[0] / l; out[i * 3 + 1] = a[1] / l; out[i * 3 + 2] = a[2] / l;
    }
    geo.setAttribute("outlineNormal", new THREE.BufferAttribute(out, 3));
  }
  function outlineMaterial() {
    const m = new THREE.MeshBasicMaterial({ color: OUTLINE_COL, side: THREE.BackSide });
    m.userData.thick = { value: 2 };
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uThick = m.userData.thick;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec3 outlineNormal;\nuniform float uThick;")
        .replace("#include <skinning_vertex>", "#include <skinning_vertex>\n#ifdef USE_SKINNING\n transformed += normalize((skinMatrix * vec4(outlineNormal, 0.0)).xyz) * uThick;\n#else\n transformed += outlineNormal * uThick;\n#endif");
    };
    m.customProgramCacheKey = function () { return "mb-outline"; };
    return m;
  }
  function nameTag(name, color) {
    const cv = document.createElement("canvas");
    cv.width = 256; cv.height = 64;
    const g = cv.getContext("2d");
    g.font = "bold 34px 'Bahnschrift', 'Arial Narrow', sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 6; g.strokeStyle = "rgba(0,0,0,0.75)"; g.strokeText(name, 128, 34);
    g.fillStyle = "#" + new THREE.Color(color).getHexString(); g.fillText(name, 128, 34);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    s.scale.set(1.1, 0.275, 1);
    s.renderOrder = 10;
    return s;
  }
  let markerTex = null;
  function marker() {
    if (!markerTex) {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 64;
      const g = cv.getContext("2d");
      g.beginPath(); g.moveTo(32, 60); g.lineTo(8, 22); g.lineTo(32, 4); g.lineTo(56, 22); g.closePath();
      g.fillStyle = "#ff3b2f"; g.fill(); g.lineWidth = 5; g.strokeStyle = "rgba(0,0,0,0.75)"; g.stroke();
      markerTex = new THREE.CanvasTexture(cv);
      markerTex.colorSpace = THREE.SRGBColorSpace;
    }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTex, transparent: true, depthWrite: false }));
    s.renderOrder = 9;
    return s;
  }
  // Coloured band round a limb bone (Mixamo limb bones run along +y).
  const bandGeo = new THREE.CylinderGeometry(0.068, 0.068, 0.075, 12, 1, true);
  const bandMats = {};
  function armband(c, boneName, color, along) {
    const bi = c.M.BN[boneName];
    if (bi === undefined) return;
    const m = bandMats[color] || (bandMats[color] = new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 0.3, roughness: 0.6, side: THREE.DoubleSide }));
    const b = new THREE.Mesh(bandGeo, m);
    b.scale.setScalar(1 / c.M.scale);
    b.position.y = along / c.M.scale;
    c.bones[bi].add(b);
  }

  // ------------------------------------------------------------------ characters
  function bodyFor(sim, p) {
    if (p.id === sim.humanId) return SP.FACTION_BODY.leader;
    if (p.zombie && SP.ZOMBIE_BODIES) return SP.ZOMBIE_BODIES[p.id % SP.ZOMBIE_BODIES.length];
    return SP.FACTION_BODY[sim.factions[p.team]] || SP.FACTION_BODY.iron;
  }
  function makeChar(sim, p) {
    const M = model(bodyFor(sim, p));
    if (!M) return null;
    const color = SP.FACTIONS[sim.factions[p.team]].color;
    const root = new THREE.Group(), body = new THREE.Group();
    body.rotation.y = Math.PI / 2;
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
    const c = {
      M: M, root: root, body: body, bones: bones, mesh: mesh, q: new Float32Array(M.nb * 4),
      base: null, prev: null, blend: 1, twist: 0, lastAlive: false, dead: null,
      holder: new THREE.Group(), hand: null, guns: {}, gunW: -1,
      kickT: 9, kick: 0, throwT: 9, hitT: 9, meleeT: 9, swapT: 9, atkT: 9, name: p.name, zombie: !!p.zombie
    };
    if (!c.zombie) {
      armband(c, "LeftArm", color, 0.13);
      armband(c, "RightArm", color, 0.13);
      if (!M.grip) measureGrip(c);
      holdGun(c, "R");
      setGun(c, p.cur);
    }
    c.tag = nameTag(p.id === sim.humanId || c.zombie ? "" : p.name, color);
    c.tag.position.y = 2.15;
    root.add(c.tag);
    // Outline hull: the same skinned geometry, drawn back faces only.
    outlineNormals(M.geo);
    c.outlineMat = outlineMaterial();
    c.outline = new THREE.SkinnedMesh(M.geo, c.outlineMat);
    c.outline.bind(mesh.skeleton, mesh.bindMatrix);
    c.outline.frustumCulled = false; c.outline.castShadow = false;
    body.add(c.outline);
    c.marker = marker();
    c.marker.position.y = 2.25; c.marker.visible = false;
    root.add(c.marker);
    setBase(c, c.zombie ? "zombie_walk" : "rifle_idle", Math.random() * 2);
    return c;
  }

  // The dead: climbing out of the grave, shambling or sprinting, a full-body
  // swing, and their own deaths. No gun, no aim.
  function poseZombie(c, p, ip, dt) {
    const M = c.M, B = M.BN, bones = c.bones, q = c.q;
    c.root.position.set(ip.x, ip.y, ip.z);
    if (!p.alive) {
      if (c.lastAlive || !c.dead) c.dead = { cl: M.clips[Math.random() < 0.5 ? "zombie_death" : "zombie_dying"] || M.clips.death_backward, t: 0 };
      c.lastAlive = false;
      c.dead.t = Math.min(c.dead.t + dt, c.dead.cl.dur);
      q.set(M.rest);
      sample(c.dead.cl, c.dead.t, q, 1);
      for (let i = 0; i < M.nb; i++) bones[i].quaternion.fromArray(q, i * 4);
      const off = c.dead.cl.hp ? hipsOffset(c.dead.cl, c.dead.t) : [0, M.hipsRest[1], 0];
      bones[B.Hips].position.set(M.hipsRest[0] + off[0], off[1], M.hipsRest[2] + off[2]);
      return;
    }
    if (!c.lastAlive) { c.dead = null; c.root.visible = true; }
    c.lastAlive = true;
    c.root.rotation.y = -p.yaw;
    const sp = Math.hypot(p.vx, p.vz);
    let hy;
    q.set(M.rest);
    if (p.rise > 0 && M.clips.zombie_stand_up) {
      // The whole stand-up clip squeezed into the climb out of the grave (in place).
      const su = M.clips.zombie_stand_up, u = 1 - p.rise / SP.CFG.zRise;
      sample(su, u * su.dur, q, 1);
      hy = su.hp ? hipsOffset(su, u * su.dur)[1] : M.hipsRest[1];
      c.base = null;
    } else {
      const still = sp < 0.15 && M.clips.zombie_idle;
      setBase(c, sp > 2.2 ? "zombie_run" : still ? "zombie_idle" : "zombie_walk");
      const cl = c.base.cl;
      const rate = still ? 1 : sp < 0.15 ? 0.25 : cl.mps > 0.1 ? U.clamp(sp / cl.mps, 0.6, sp > 2.2 ? 1.6 : 3) : 1;
      c.base.t = (c.base.t + dt * rate) % cl.dur;
      if (c.blend < 1) c.blend = Math.min(1, c.blend + dt / BLEND);
      if (c.prev && c.blend < 1) { sample(c.prev.cl, c.prev.t, q, 1); sample(cl, c.base.t, q, ease(c.blend)); }
      else sample(cl, c.base.t, q, 1);
      hy = cl.hp ? hipsOffset(cl, c.base.t)[1] : M.hipsRest[1];
      // The swing: the middle of the attack clip, over the whole body.
      c.atkT += dt;
      const at = M.clips.zombie_attack;
      if (at && c.atkT < 0.95) sample(at, 0.55 + c.atkT * 1.2, q, Math.min(1, c.atkT * 8, (0.95 - c.atkT) * 8));
    }
    for (let i = 0; i < M.nb; i++) bones[i].quaternion.fromArray(q, i * 4);
    bones[B.Hips].position.set(M.hipsRest[0], hy, M.hipsRest[2]);
  }

  // Bind pose + one clip frame (for measuring).
  function poseRest(c, cl, t) {
    c.q.set(c.M.rest);
    sample(cl, t, c.q, 1);
    for (let i = 0; i < c.M.nb; i++) c.bones[i].quaternion.fromArray(c.q, i * 4);
    const hp = cl.hp ? hipsOffset(cl, t) : [0, c.M.hipsRest[1], 0];
    c.bones[c.M.BN.Hips].position.set(c.M.hipsRest[0], hp[1], c.M.hipsRest[2]);
  }

  function setBase(c, key, t) {
    const cl = c.M.clips[key];
    if (!cl || (c.base && c.base.cl === cl)) return;
    if (c.base) {
      c.prev = { cl: c.base.cl, t: c.base.t };
      c.blend = 0;
      // Keep the stride's phase when one loop hands over to another.
      if (t === undefined && c.base.cl.loop && cl.loop) t = (c.base.t / c.base.cl.dur) * cl.dur;
    }
    c.base = { cl: cl, t: t || 0 };
  }

  // Which base clip now, and how to play it. Returns { key, twist (hips toward
  // the run), sp, and optionally at (hold one frame), rate, rev (backwards),
  // flat (keep the hips at standing height: the sim moves the body) }.
  function chooseBase(c, p, dt, now) {
    const M = c.M, CF = SP.CFG, sp = Math.hypot(p.vx, p.vz);
    const yawRate = c.lastYaw === undefined ? 0 : U.wrap(p.yaw - c.lastYaw) / Math.max(dt, 1e-3);
    c.lastYaw = p.yaw;
    if (p.down) {
      // Thrown: fall on the back (the death fall, held), then the stand-up clip squeezed into the last second.
      const dn = p.down, up = dn.dur - 1.0;
      if (dn.t < up && M.clips.death_backward) return { key: "death_backward", at: Math.min(dn.t, M.clips.death_backward.dur), twist: 0, sp: 0 };
      if (M.clips.zombie_stand_up) return { key: "zombie_stand_up", at: Math.max(0, dn.t - up) * M.clips.zombie_stand_up.dur, twist: 0, sp: 0 };
    }
    if (p.mv) {
      // Hand to hand: the move's own clip across the move's own time.
      const cl = M.clips[p.mv.kind === "throw" ? "shoulder_throw" : p.mv.kind];
      if (cl) return { key: p.mv.kind === "throw" ? "shoulder_throw" : p.mv.kind, at: Math.min(cl.dur, p.mv.t / p.mv.dur * cl.dur), twist: 0, sp: 0 };
    }
    if (p.climb) {
      // (The ladder clip is authored facing away from its ladder: turned round to face the wall.)
      if (p.climb.ph === "up") return { key: "ladder", rate: CF.climbSpeed / 0.62, twist: 0, sp: 0, flat: true, flip: true };
      // Hauling over the top: the second half of the climb-over clip.
      const T = p.climb.kind === "vault" ? CF.vaultT : CF.overT, u = Math.min(1, p.climb.t / T);
      const t0 = p.climb.kind === "vault" ? 0.9 : 1.5, t1 = 3.3;
      return { key: "climb_over", at: t0 + (t1 - t0) * u, twist: 0, sp: 0, flat: true };
    }
    if (p.rollT > 0 && M.clips.dive_roll) {
      const dr = M.clips.dive_roll, u = 1 - p.rollT / CF.rollT;
      return { key: "dive_roll", at: 0.25 + u * (dr.dur - 0.5), twist: 0, sp: 0 };
    }
    if (!p.onGround && p.airT > 0.15) return { key: "rifle_jump", at: M.clips.rifle_jump.dur * 0.42, twist: 0, sp: sp };
    const pistol = p.cur === 0;
    if (sp < 0.45) {
      if (p.crouch) return pistol && M.clips.pistol_kneeling_idle ? { key: "pistol_kneeling_idle", twist: 0, sp: 0 } :
        { key: "crouch_to_kneel", at: M.clips.crouch_to_kneel ? M.clips.crouch_to_kneel.dur - 0.05 : 0, twist: 0, sp: 0 };
      if (pistol) return { key: "pistol_idle", twist: 0, sp: 0 };
      // Turning on the spot (the yaw grows clockwise: positive is a right turn).
      if (Math.abs(yawRate) > 1.3 && !p.aiming) return { key: yawRate > 0 ? "rifle_turn_right_45" : "pro_turn_90_left", rate: 1.3, twist: 0, sp: 0 };
      // Rifle up when aiming, reloading or just after shooting; otherwise at ease.
      const ready = p.aiming || p.reloadT > 0 || now - (p.lastFireT || -9) < 2.5 || now - (p.hurtT || -9) < 2;
      return { key: ready || !M.clips.pro_idle ? "rifle_idle" : "pro_idle", twist: 0, sp: 0 };
    }
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    const fwd = cy * p.vx + sy * p.vz, side = -sy * p.vx + cy * p.vz;   // side > 0: moving right
    const a = Math.atan2(side, fwd);
    if (p.sprinting && M.clips.pro_sprint_forward) return { key: "pro_sprint_forward", twist: a, sp: sp };
    const set = M.sets[p.crouch ? "crouch" : pistol ? "pistol" : "rifle"];
    const tier = sp > 2.4 && !p.crouch ? set.run : set.walk;
    let best = tier[0], bd = 9;
    for (let i = 0; i < tier.length; i++) { const d = Math.abs(U.wrap(a - tier[i].ang)); if (d < bd) { bd = d; best = tier[i]; } }
    return { key: best.cl.key, rev: best.rev, twist: U.wrap(a - best.ang), sp: sp };
  }

  function pose(c, p, ip, dt, now) {
    if (c.zombie) { poseZombie(c, p, ip, dt); return; }
    const M = c.M, B = M.BN, bones = c.bones, q = c.q;
    if (p.alive && !c.lastAlive) { c.dead = null; c.root.visible = true; holdGun(c, "R"); }
    setGun(c, c.throwT < 0.9 ? 5 : p.cur);
    const busy = !!(p.climb || p.rollT > 0 || p.mv || p.down);          // climbing, rolling, fighting or thrown: gun away, no overlays
    c.holder.visible = !busy;
    if (!p.alive) {
      // Dead: a death clip from the moment it happened, holding its last frame.
      if (c.lastAlive || !c.dead) {
        const k = p._fallKey || (Math.hypot(p.vx, p.vz) > 2.4 ? "rifle_death_walking" : Math.random() < 0.6 ? "death_backward" : "death_forward");
        c.dead = { cl: M.clips[k] || M.clips.death_backward, t: 0 };
      }
      c.lastAlive = false;
      c.dead.t = Math.min(c.dead.t + dt, c.dead.cl.dur);
      q.set(M.rest);
      sample(c.dead.cl, c.dead.t, q, 1);
      for (let i = 0; i < M.nb; i++) bones[i].quaternion.fromArray(q, i * 4);
      const off = c.dead.cl.hp ? hipsOffset(c.dead.cl, c.dead.t) : [0, M.hipsRest[1], 0];
      bones[B.Hips].position.set(M.hipsRest[0] + off[0], off[1], M.hipsRest[2] + off[2]);
      c.root.position.set(ip.x, ip.y, ip.z);
      return;
    }
    c.lastAlive = true;
    c.root.position.set(ip.x, ip.y, ip.z);
    c.root.rotation.y = -p.yaw;
    // Base clip, crossfaded, at a rate that matches the ground speed.
    const ch = chooseBase(c, p, dt, now);
    if (ch.flip) c.root.rotation.y = -p.yaw + Math.PI;
    setBase(c, ch.key);
    const cl = c.base.cl;
    if (ch.at !== undefined) c.base.t = Math.min(ch.at, cl.dur);
    else {
      let rate = ch.rate !== undefined ? ch.rate : cl.mps > 0.2 ? U.clamp(ch.sp / cl.mps, 0.65, 1.9) : 1;
      if (ch.rev) rate = -rate;
      c.base.t = ((c.base.t + dt * rate) % cl.dur + cl.dur) % cl.dur;
    }
    if (c.blend < 1) c.blend = Math.min(1, c.blend + dt / BLEND);
    q.set(M.rest);
    let hy;
    if (c.prev && c.blend < 1) {
      sample(c.prev.cl, c.prev.t, q, 1);
      sample(cl, c.base.t, q, ease(c.blend));
      const h0 = c.prev.cl.hp ? hipsOffset(c.prev.cl, c.prev.t)[1] : M.hipsRest[1];
      const h1 = cl.hp ? hipsOffset(cl, c.base.t)[1] : M.hipsRest[1];
      hy = h0 + (h1 - h0) * ease(c.blend);
    } else {
      sample(cl, c.base.t, q, 1);
      hy = cl.hp ? hipsOffset(cl, c.base.t)[1] : M.hipsRest[1];
    }
    if (ch.flat) hy = M.hipsRest[1];
    // Upper-body overlays: reload, grenade throw, a flinch when hit.
    const w = WP[p.cur];
    if (p.reloadT > 0 && w.reload > 0 && !busy) {
      const u = 1 - p.reloadT / w.reload, rl = M.clips.rifle_reload;
      sample(rl, u * rl.dur, q, Math.min(1, u * 6, (1 - u) * 6), M.upper);
    }
    c.throwT += dt;
    if (c.throwT < 0.9 && !busy) {
      // The throw clip from just before the release to just after, in 0.9 s.
      const gc = M.clips.rifle_grenade, t0 = Math.max(0, gc.release - 0.75);
      sample(gc, t0 + (c.throwT / 0.9) * 1.1, q, Math.min(1, c.throwT * 8, (0.9 - c.throwT) * 8), M.upper);
      holdGun(c, "L");
    } else holdGun(c, p.cur === 0 ? "P" : "R");
    c.hitT += dt;
    if (c.hitT < 0.43 && !busy) { const hr = M.clips.rifle_hit_react; sample(hr, c.hitT, q, 0.65 * Math.min(1, (0.43 - c.hitT) * 6), M.upper); }
    for (let i = 0; i < M.nb; i++) bones[i].quaternion.fromArray(q, i * 4);
    bones[B.Hips].position.set(M.hipsRest[0], hy, M.hipsRest[2]);
    if (busy) { c.twist = 0; return; }
    // Hips twist toward a diagonal run; the chest turns back so the gun stays on target.
    const tw = U.clamp(ch.twist, -0.75, 0.75);
    c.twist += (tw - c.twist) * Math.min(1, dt * 10);
    turn(c, bones[B.Hips], 0, 1, 0, -c.twist);
    turn(c, bones[B.Spine], 0, 1, 0, c.twist * 0.5);
    turn(c, bones[B.Spine1], 0, 1, 0, c.twist * 0.5);
    // Aim pitch through the spine (+x is the body's left: a positive turn leans forward).
    const pitch = U.clamp(p.pitch || 0, -1.1, 1.1);
    let lean = -pitch / 3;
    // Recoil: a short kick back and up; the rifle butt swings forward on melee.
    c.kickT += dt;
    const kick = c.kickT < 0.12 ? (1 - c.kickT / 0.12) * c.kick : 0;
    c.meleeT += dt;
    let swing = 0;
    if (c.meleeT < 0.45) swing = Math.sin(c.meleeT / 0.45 * Math.PI);
    c.swapT += dt;
    const swap = c.swapT < 0.45 ? Math.sin(c.swapT / 0.45 * Math.PI) : 0;
    turn(c, bones[B.Spine], 1, 0, 0, lean - kick * 0.35 + swing * 0.35);
    turn(c, bones[B.Spine1], 1, 0, 0, lean - kick * 0.25);
    if (B.Spine2 !== undefined) turn(c, bones[B.Spine2], 1, 0, 0, lean);
    if (swing) turn(c, bones[B.Spine1], 0, 1, 0, -swing * 0.7);
    if (swap && B.RightArm !== undefined) { turn(c, bones[B.RightArm], 1, 0, 0, swap * 0.7); if (B.LeftArm !== undefined) turn(c, bones[B.LeftArm], 1, 0, 0, swap * 0.5); }
  }

  // Characters cast shadows only while the sun's shadows are redrawn each frame.
  Mo.charShadows = true;
  function applyShadows(c) {
    c.mesh.castShadow = Mo.charShadows;
    for (const k in c.guns) c.guns[k].traverse(function (o) { if (o.isMesh) o.castShadow = Mo.charShadows; });
  }
  Mo.setCharShadows = function (on) {
    Mo.charShadows = on;
    (Mo.chars || []).forEach(function (c) { if (c) applyShadows(c); });
  };

  Mo.setPlayers = function (sim) {
    (Mo.chars || []).forEach(function (c) { if (c) V.scene.remove(c.root); });
    Mo.chars = sim.players.map(function (p) {
      const c = makeChar(sim, p);
      if (c) { applyShadows(c); V.scene.add(c.root); }
      return c;
    });
  };

  // What the sim just did, for the bodies: shots kick, throws, hits, melee, swaps.
  Mo.event = function (sim, e) {
    const c = Mo.chars && e.p !== undefined && e.p >= 0 ? Mo.chars[e.p] : null;
    switch (e.type) {
      case "fire":
        if (!c) return;
        if (e.w === 5) c.throwT = 0;
        else { c.kickT = 0; c.kick = e.w === 2 || e.w === 3 ? 0.5 : e.w === 4 ? 0.4 : e.w === 0 ? 0.25 : 0.16; }
        break;
      case "melee": if (c) c.meleeT = 0; break;
      case "zattack": if (c) c.atkT = 0; break;
      case "switch": if (c) c.swapT = 0; break;
      case "hit": { const v = Mo.chars && Mo.chars[e.v]; if (v) v.hitT = 0; break; }
      case "kill": {
        // Fall away from the shot: backward if they were facing the shooter.
        const v = sim.players[e.victim], k = e.killer >= 0 ? sim.players[e.killer] : null;
        if (!v) return;
        if (v.crouch && !v.zombie) v._fallKey = "crouch_death";
        else if (Math.hypot(v.vx, v.vz) > 2.4) v._fallKey = "rifle_death_walking";
        else if (k) {
          const facing = Math.cos(v.yaw) * (k.x - v.x) + Math.sin(v.yaw) * (k.z - v.z);
          v._fallKey = facing > 0 ? "death_backward" : "death_forward";
        } else v._fallKey = "death_backward";
        break;
      }
      case "spawn": { const p = sim.players[e.p]; if (p) p._fallKey = null; break; }
    }
  };

  Mo.update = function (sim, dt, alpha, viewerId, aimTarget, hideViewer) {
    const viewer = viewerId >= 0 ? sim.players[viewerId] : null;
    const cam = V.camera.position;
    sim.players.forEach(function (p, i) {
      const c = Mo.chars[i];
      if (!c) return;
      const ip = p._px !== undefined && p.alive && p.spawnT > 0.05 ?
        { x: p._px + (p.x - p._px) * alpha, y: p._py + (p.y - p._py) * alpha, z: p._pz + (p.z - p._pz) * alpha } : p;
      pose(c, p, ip, dt, sim.t);
      // The duffle run: a carrier wears the bag across their back.
      if (p.carry && p.alive && !c.duffle && V.bagMesh) { c.duffle = V.bagMesh(); c.duffle.rotation.y = Math.PI / 2; c.duffle.scale.setScalar(1.35); c.duffle.position.set(-0.27, 1.12, 0); c.root.add(c.duffle); }
      if (c.duffle) c.duffle.visible = p.carry && p.alive;
      c.root.visible = !(hideViewer && i === viewerId);
      // Name tags: allies only. Enemies: outline and long-range marker.
      const ally = viewer && !sim.isEnemy(viewer, p);
      c.tag.visible = p.alive && viewer !== null && i !== viewerId && (ally || aimTarget === i);
      c.tag.material.depthTest = !ally;
      const enemy = !!viewer && i !== viewerId && sim.isEnemy(viewer, p) && p.alive;
      const dist = Math.hypot(ip.x - cam.x, ip.y + 1 - cam.y, ip.z - cam.z);
      // (Up close the hull outlines every pouch on a vest: only past 9 m.)
      c.outline.visible = enemy && Mo.outlines && dist > 9;
      if (c.outline.visible) c.outlineMat.userData.thick.value = (0.012 + dist * 0.0028) / c.M.scale;
      c.marker.visible = enemy && Mo.outlines && dist > 14 && c.root.visible;
      if (c.marker.visible) { const s = 0.22 + dist * 0.014; c.marker.scale.set(s, s, 1); c.marker.position.y = 2.25 + dist * 0.008; }
    });
  };
  Mo.charRoot = function (i) { return Mo.chars && Mo.chars[i] && Mo.chars[i].root; };
  // The barrel tip of what player i holds, in the world (null if no body yet).
  Mo.muzzle = function (i, out) {
    const c = Mo.chars && Mo.chars[i];
    if (!c || !c.guns[c.gunW]) return null;
    c.root.updateMatrixWorld(true);
    return c.guns[c.gunW].userData.muzzle.getWorldPosition(out || new THREE.Vector3());
  };

  // Decode every body now (so the first match doesn't hitch), then go.
  Mo.prepare = function (done) {
    (SP.BODY_FILES || []).forEach(function (id) { model(id); });
    if (done) done();
  };
  Mo.init = function (view) {
    V = view;
    Mo.chars = [];
  };
  SP.Models = Mo;
})(globalThis.SP);
