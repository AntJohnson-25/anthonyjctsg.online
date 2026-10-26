// The Meshy characters: rigged .glb bodies packed by tools/pack-chars.py, animated with the Mixamo clips in
// assets/clips.json (tools/build-clips.mjs). A clip there is rig-free: per body bone, its world rotation away
// from a T-pose. Each Meshy rig also stands in a T-pose facing +Z, so a bone's world rotation is just
// delta * its own bind world rotation; that's turned into ordinary local tracks once, when a character is made.
// Loaded in the background at start; until they arrive (or if they can't, e.g. the page opened from disk)
// view.js keeps its blocky stand-ins.
// Every clip is split in two layers, the arms and the rest, so the driver can run on "run" legs with "carry"
// arms holding the parcels.
// make(id) -> an actor: { group (faces -Z like the stand-ins), play(name, arms, fade), once(name, then, speed),
//                         busy(), speed(k), pace(name) (the clip's own ground speed, m/s), update(dt) }.
globalThis.WD = globalThis.WD || {};
(function (WD) {
  "use strict";
  const THREE = globalThis.THREE;
  // id -> standing height in metres (the dog: to the top of its head)
  const CAST = { driver: 1.8, maya: 1.68, luis: 1.74, jess: 1.66, kenji: 1.75, walt: 1.76, keisha: 1.68, tyrone: 1.83, rosa: 1.6, pirate: 1.78, dog: 0.62 };
  const FEMALE = { keisha: 1, rosa: 1, maya: 1, jess: 1 };   // idle/walk take the _f versions
  const ARM = /^(Left|Right)(Shoulder|Arm|ForeArm|Hand)$/;
  // the drivers you can pick on the menu (same uniform; portraits in assets/drivers/<id>.jpg)
  const DRIVERS = [{ id: "driver", name: "Dre" }, { id: "maya", name: "Maya" }, { id: "luis", name: "Luis" }, { id: "jess", name: "Jess" }, { id: "kenji", name: "Kenji" }];
  const C = { ready: false, gltf: {}, actors: {}, clips: null, RESIDENTS: ["walt", "keisha", "tyrone", "rosa"], DRIVERS: DRIVERS, driverId: "driver" };
  let loader = null;
  const loadOne = (id) => C.gltf[id] ? Promise.resolve() : loader.loadAsync("assets/chars/" + id + ".glb?v=2").then(function (g) { C.gltf[id] = g; }, function (e) { console.warn("Wrong Door: no character " + id, e); });

  // the residents, the pirate, the dog and the picked driver (the other drivers load only when picked)
  C.load = function () {
    if (!WD.GLTFLoader || location.protocol === "file:") return Promise.resolve(false);
    loader = new WD.GLTFLoader();
    const clips = fetch("assets/clips.json?v=2").then((r) => r.json()).then((j) => { C.clips = j; }, (e) => console.warn("Wrong Door: no clips", e));
    const ids = Object.keys(CAST).filter((id) => !DRIVERS.some((d) => d.id === id) || id === C.driverId);
    return Promise.all([clips].concat(ids.map(loadOne))).then(function () { C.ready = !!C.gltf[C.driverId]; return C.ready; });
  };
  // pick a driver: ready again once their body has loaded
  C.setDriver = function (id) {
    if (!DRIVERS.some((d) => d.id === id)) id = "driver";
    C.driverId = id;
    if (!loader) return Promise.resolve(false);
    C.ready = !!C.gltf[id];
    return loadOne(id).then(function () { C.ready = !!C.gltf[id] && !!C.clips; return C.ready; });
  };

  // Meshy's bone names -> the clip's (Mixamo) names: compare without case, prefixes or zero padding.
  const norm = (s) => s.replace(/^mixamorig\d*:?/i, "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/0(\d)/g, "$1");
  function boneMap(model, names) {
    const want = {};
    names.forEach((n) => { want[norm(n)] = n; });
    const m = new Map();
    model.traverse((o) => { if (o.isBone && want[norm(o.name)]) m.set(o, want[norm(o.name)]); });
    // The spine goes by its place in the chain, not its name: Meshy counts it the other way up
    // (Hips > Spine02 > Spine01 > Spine > neck), Mixamo Hips > Spine > Spine1 > Spine2 > Neck.
    const find = (n) => [...m.keys()].find((b) => m.get(b) === n);
    const hips = find("Hips"), neck = find("Neck");
    if (hips && neck) {
      const chain = [];
      for (let b = neck.parent; b && b !== hips && b.isBone; b = b.parent) chain.unshift(b);
      chain.forEach((b) => m.delete(b));
      ["Spine", "Spine1", "Spine2"].slice(0, chain.length).forEach((n, i) => { m.set(chain[i], n); });
    }
    return m;
  }

  // One clip from clips.json -> a THREE clip for this rig (tracks named by bone uuid), split arms / body.
  function bake(key, src, rig) {
    const n = src.n, fps = C.clips.fps, times = new Float32Array(n);
    for (let i = 0; i < n; i++) times[i] = Math.min(src.dur, i / fps);
    const W = rig.order.map(() => new THREE.Quaternion()), d = new THREE.Quaternion(), tmp = new THREE.Quaternion();
    const vals = rig.order.map((b) => (rig.map.has(b) && src.q[rig.map.get(b)] ? new Float32Array(n * 4) : null));
    for (let i = 0; i < n; i++) {
      rig.order.forEach((b, k) => {
        const p = rig.parent[k], pw = p >= 0 ? W[p] : rig.topQ[k];
        const q = vals[k] && src.q[rig.map.get(b)];
        if (q) { d.fromArray(q, i * 4); W[k].copy(d).multiply(rig.bindW[k]); }
        else W[k].copy(pw).multiply(rig.bindL[k]);
        if (vals[k]) { tmp.copy(pw).invert().multiply(W[k]); tmp.toArray(vals[k], i * 4); }
      });
    }
    const body = [], arms = [];
    rig.order.forEach((b, k) => {
      if (!vals[k]) return;
      (ARM.test(rig.map.get(b)) ? arms : body).push(new THREE.QuaternionKeyframeTrack(b.uuid + ".quaternion", times, vals[k]));
    });
    // hips height (the clip's dip and bob, in leg lengths above the floor); the game moves the body itself
    const hp = new Float32Array(n * 3), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(rig.hipsW.x, rig.floor + rig.leg * src.hy[i], rig.hipsW.z).applyMatrix4(rig.hipsParentInv);
      v.toArray(hp, i * 3);
    }
    body.push(new THREE.VectorKeyframeTrack(rig.hips.uuid + ".position", times, hp));
    return { body: new THREE.AnimationClip(key + ":body", src.dur, body), arms: new THREE.AnimationClip(key + ":arms", src.dur, arms) };
  }

  function readRig(model) {
    model.updateMatrixWorld(true);
    const map = boneMap(model, C.clips.bones);
    const hips = [...map.keys()].find((b) => map.get(b) === "Hips");
    if (!hips || map.size < 14) return null;
    const order = [];
    (function walk(o) { if (o.isBone) order.push(o); o.children.forEach(walk); })(model);
    const idx = new Map(order.map((b, i) => [b, i]));
    const rig = { map: map, hips: hips, order: order, parent: order.map((b) => (idx.has(b.parent) ? idx.get(b.parent) : -1)) };
    rig.bindW = order.map((b) => b.getWorldQuaternion(new THREE.Quaternion()));
    rig.bindL = order.map((b) => b.quaternion.clone());
    rig.topQ = order.map((b) => (b.parent ? b.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion()));
    rig.hipsW = hips.getWorldPosition(new THREE.Vector3());
    rig.hipsParentInv = hips.parent.matrixWorld.clone().invert();
    rig.leg = rig.hipsW.y - Math.min(...[...map.keys()].map((b) => b.getWorldPosition(new THREE.Vector3()).y));
    rig.floor = new THREE.Box3().setFromObject(model).min.y;
    return rig;
  }

  // turn `bone` (at `o`, world) so its child at `from` points at `to` instead, and refresh the matrices below it
  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(),
    _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3(), _v7 = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(),
    _q = new THREE.Quaternion(), _wq = new THREE.Quaternion(), _pq = new THREE.Quaternion();
  function aim(bone, o, from, to) {
    _a.copy(from).sub(o).normalize(); _b.copy(to).sub(o).normalize();
    _q.setFromUnitVectors(_a, _b);
    bone.getWorldQuaternion(_wq); bone.parent.getWorldQuaternion(_pq);
    bone.quaternion.copy(_pq.invert().multiply(_q.multiply(_wq)));
    bone.updateMatrixWorld(true);
  }

  // fresh: a new copy that isn't cached (for the dogs that chase you: the dog has no rig, so a plain clone does)
  C.make = function (id, fresh) {
    if (!fresh && C.actors[id]) { const a = C.actors[id]; if (a.group.parent) a.group.parent.remove(a.group); a.play("idle", null, 0); return a; }
    const g = C.gltf[id];
    if (!g) return null;
    const model = fresh ? g.scene.clone(true) : g.scene;
    model.traverse(function (o) {
      if (!o.isMesh) return;
      o.castShadow = true; o.frustumCulled = false;
      [].concat(o.material).forEach(function (m) { if (m.isMeshStandardMaterial) { m.metalness = 0; m.roughness = 0.85; } });
    });
    const rig = C.clips ? readRig(model) : null;
    // stand it on the floor at its height, turned to face -Z (Meshy's face +Z)
    const box = new THREE.Box3().setFromObject(model), h = box.max.y - box.min.y;
    const k = CAST[id] / Math.max(0.05, h);
    const group = new THREE.Group(); group.add(model);

    const a = { id: id, group: group, model: model, body: {}, arms: {}, paces: {}, cur: null, curArms: null, curName: "", after: null };
    if (rig) {
      a.mixer = new THREE.AnimationMixer(model);
      const legM = rig.leg * k;
      Object.keys(C.clips.clips).forEach(function (key) {
        const src = C.clips.clips[key];
        const b = bake(key, src, rig);
        // the female idle/walk stand in for the plain ones on the women
        let name = key;
        if (FEMALE[id] && C.clips.clips[key + "_f"]) return;
        if (/_f$/.test(key)) { if (!FEMALE[id]) return; name = key.slice(0, -2); }
        a.body[name] = a.mixer.clipAction(b.body); a.arms[name] = a.mixer.clipAction(b.arms);
        a.paces[name] = src.pace * legM;
      });
      a.mixer.addEventListener("finished", function (e) {
        if (e.action === a.cur && a.after) { const n = a.after; a.after = null; a.play(n, null, 0.25); }
      });
    }
    model.scale.multiplyScalar(k);
    model.position.y = -box.min.y * k;
    model.rotation.y = Math.PI;

    const pick = (name) => (a.body[name] ? name : a.body.idle ? "idle" : Object.keys(a.body)[0]);
    const start = function (act, prev, fade) {
      act.reset(); act.setLoop(THREE.LoopRepeat, Infinity); act.clampWhenFinished = false; act.timeScale = 1; act.setEffectiveWeight(1); act.play();
      if (prev && prev !== act) prev.crossFadeTo(act, fade, false);
    };
    a.has = function (name) { return !!a.body[name]; };
    // a bone by its Mixamo name (Hips, Spine2, RightHand...)
    a.bone = function (n) { if (rig) for (const [b, m] of rig.map) if (m === n) return b; return null; };
    a.pace = function (name) { return a.paces[name] || 0; };
    // `arms`: another clip for the arms (null = the clip's own)
    a.play = function (name, arms, fade) {
      if (!a.mixer) return;
      name = pick(name); arms = arms && a.arms[arms] ? arms : name;
      fade = fade === undefined ? 0.2 : fade;
      if (name !== a.curName || !a.cur.isRunning()) { start(a.body[name], a.cur, fade); a.cur = a.body[name]; a.curName = name; }
      if (a.arms[arms] !== a.curArms || !a.curArms.isRunning()) { start(a.arms[arms], a.curArms, fade); a.curArms = a.arms[arms]; }
      a.after = null;
    };
    // a one-shot (load, drop, grab, hit), then back to `then`
    a.once = function (name, then, speed, fade) {
      if (!a.body[name]) return;
      a.curName = ""; a.play(name, null, fade === undefined ? 0.12 : fade);
      [a.cur, a.curArms].forEach(function (x) { x.setLoop(THREE.LoopOnce, 1); x.clampWhenFinished = true; x.timeScale = speed || 1; });
      a.after = then || "idle";
    };
    // Two-bone IK on one arm after the mixer has posed it: the hand goes to `target` (world), the elbow bends
    // toward `pole` (world); w blends from the clip's pose (0) to the reach (1). Call after update().
    // `fingers` (world direction, optional): turn the hand so its fingers point that way (Meshy hands: +Y).
    a.armIK = function (side, target, pole, w, fingers) {
      const up = a.bone(side + "Arm"), fore = a.bone(side + "ForeArm"), hand = a.bone(side + "Hand");
      if (!up || !fore || !hand || w <= 0) return;
      up.updateMatrixWorld(true);
      const A = up.getWorldPosition(_v1), B = fore.getWorldPosition(_v2), Cp = hand.getWorldPosition(_v3);
      const la = A.distanceTo(B), lb = B.distanceTo(Cp);
      const toT = _v4.copy(target).sub(A), d = Math.min(la + lb - 1e-4, Math.max(Math.abs(la - lb) + 1e-4, toT.length()));
      const dir = toT.normalize();
      const x = (la * la - lb * lb + d * d) / (2 * d), h = Math.sqrt(Math.max(0, la * la - x * x));
      const perp = _v5.copy(pole).sub(A); perp.addScaledVector(dir, -perp.dot(dir));
      if (perp.lengthSq() < 1e-8) perp.set(0, -1, 0); perp.normalize();
      const E = _v6.copy(A).addScaledVector(dir, x).addScaledVector(perp, h);
      const q0u = up.quaternion.clone(), q0f = fore.quaternion.clone();
      aim(up, A, B, E);
      fore.getWorldPosition(_v2); hand.getWorldPosition(_v3);
      aim(fore, _v2, _v3, _v7.copy(A).addScaledVector(dir, d));
      const q0h = hand.quaternion.clone();
      if (fingers) {
        hand.getWorldPosition(_v3);
        hand.getWorldQuaternion(_wq);
        aim(hand, _v3, _v2.set(0, 1, 0).applyQuaternion(_wq).add(_v3), _v7.copy(fingers).normalize().add(_v3));
      }
      if (w < 1) { up.quaternion.slerpQuaternions(q0u, up.quaternion, w); fore.quaternion.slerpQuaternions(q0f, fore.quaternion, w); hand.quaternion.slerpQuaternions(q0h, hand.quaternion, w); up.updateMatrixWorld(true); }
    };
    a.busy = function () { return !!a.after; };
    a.speed = function (k2) { if (a.cur) { a.cur.timeScale = k2; a.curArms.timeScale = a.curArms === a.arms[a.curName] ? k2 : 1; } };
    a.update = function (dt) { if (a.mixer) a.mixer.update(dt); };
    a.play("idle", null, 0);
    if (!fresh) C.actors[id] = a;
    return a;
  };

  WD.Chars = C;
})(globalThis.WD);
