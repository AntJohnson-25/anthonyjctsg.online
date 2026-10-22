// People: the user's 3D characters (src/body.js) as customers, your crew and you.
//  - HS.Rig: two-bone arm IK and head turns over whatever clip is playing (there is no cooking
//    or serving clip in the library, so working hands are posed in code, as in Billionaire Barber 2).
//  - HS.Actor(id, units): a body in park units (HS.U per metre) with a walk/idle helper.
//  - HS.Crowd: the park's customers. The game's logic still moves each customer's c.mesh (a
//    holder group) exactly as before; the nearest few to the camera wear a real body inside it,
//    everyone further off keeps the cheap stand-in figure (you can't tell them apart from up there).
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const THREE = globalThis.THREE;
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);

  /* ------------------------------------------------------------------ rig helpers */
  const Rig = {};
  Rig.bone = function (a, name) { const i = a.b.M.BN[name]; return i === undefined ? null : a.b.bones[i]; };
  function aim(bn, childWorld, targetWorld) {
    bn.getWorldPosition(_a);
    _b.copy(childWorld).sub(_a).normalize();
    _c.copy(targetWorld).sub(_a).normalize();
    if (_b.lengthSq() < 1e-8 || _c.lengthSq() < 1e-8) return;
    _q.setFromUnitVectors(_b, _c);
    bn.getWorldQuaternion(_q2);
    bn.parent.getWorldQuaternion(_q3);
    bn.quaternion.copy(_q3.invert().multiply(_q.multiply(_q2)));
    bn.updateMatrixWorld(true);
  }
  const _s = new THREE.Vector3(), _e = new THREE.Vector3(), _h = new THREE.Vector3(), _t = new THREE.Vector3(), _pole = new THREE.Vector3();
  // Put a hand at `target` (world), elbow bending toward `pole`, blended by w (0..1).
  Rig.reach = function (a, side, target, pole, w) {
    if (w <= 0.001) return;
    const up = Rig.bone(a, side + "Arm"), fore = Rig.bone(a, side + "ForeArm"), hand = Rig.bone(a, side + "Hand");
    if (!up || !fore || !hand) return;
    up.getWorldPosition(_s); fore.getWorldPosition(_e); hand.getWorldPosition(_h);
    const l1 = _s.distanceTo(_e), l2 = _e.distanceTo(_h);
    _t.copy(_h).lerp(target, w);
    const toT = _d.copy(_t).sub(_s);
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.005);
    toT.normalize();
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d), hgt = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    _pole.copy(pole).addScaledVector(toT, -pole.dot(toT));
    if (_pole.lengthSq() < 1e-6) _pole.set(0, -1, 0);
    _pole.normalize();
    const elbow = _c.copy(_s).addScaledVector(toT, along).addScaledVector(_pole, hgt).clone();
    aim(up, _e, elbow);
    fore.getWorldPosition(_e); hand.getWorldPosition(_h);
    aim(fore, _h, _t.copy(_s).addScaledVector(toT, d));
  };
  // An extra turn of the head about world up (a head shake when someone's fed up).
  Rig.turnHead = function (a, ang) {
    const hb = Rig.bone(a, "Head");
    if (!hb || Math.abs(ang) < 1e-4) return;
    hb.getWorldQuaternion(_q2); hb.parent.getWorldQuaternion(_q3);
    _q.setFromAxisAngle(UP, ang);
    hb.quaternion.copy(_q3.invert().multiply(_q.multiply(_q2)));
  };
  // Hang a prop off a hand bone, sized in world units whatever the bone's scale is.
  Rig.hold = function (a, side, prop, offset) {
    const hb = Rig.bone(a, side + "Hand");
    if (!hb) return;
    a.b.root.updateMatrixWorld(true);
    hb.getWorldScale(_a);
    const k = 1 / Math.max(1e-6, _a.x);
    prop.scale.setScalar(k * (prop.userData.s || 1));     // userData.s: props modelled in metres say HS.U
    prop.position.set(0, (offset === undefined ? 0.12 : offset) * k, 0);
    hb.add(prop);
  };
  Rig.drop = function (prop) { if (prop && prop.parent) prop.parent.remove(prop); };
  HS.Rig = Rig;

  /* ------------------------------------------------------------------ an actor */
  function Actor(id, units) {
    this.id = id;
    this.b = HS.Body.make(id, units);
    this.root = this.b.root;
    this.b.play(HS.idleOf(id), { fade: 0, t: Math.random() * 5 });
    this.real = 0;
    this.moving = false;
  }
  // Walk or stand, from how far the actor really moved this frame (so legs never run on the spot).
  Actor.prototype.gait = function (moved, dt) {
    const real = moved / Math.max(dt, 1e-4);
    this.real += (real - this.real) * Math.min(1, dt * 10);
    if (this.real > 0.35) {
      this.b.play(HS.walkOf(this.id), { fade: 0.2, rate: THREE.MathUtils.clamp(this.real / (1.6 * this.b.height / 1.8), 0.5, 1.9) });
      this.moving = true;
    } else if (this.moving || !this.b.cur) {
      this.b.play(HS.idleOf(this.id), { fade: 0.3 });
      this.moving = false;
    }
  };
  HS.Actor = Actor;
  HS.makeActor = function (id, metres) { return new Actor(id, (metres || HS.heightOf(id)) * HS.U); };

  // A full-length studio render of a character standing idle (the character-select cards), as a
  // data URL. Resolves once the body and its textures are in.
  HS.portrait = function (renderer, id, w, h) {
    w = w || 300; h = h || 420;
    return HS.Body.load(id).then(function () { return HS.Body.texReady(id); }).then(function () {
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xfff4e6, 0x3a2a20, 2.0));
      const key = new THREE.DirectionalLight(0xffe6c8, 2.4); key.position.set(1.5, 3, 4); scene.add(key);
      const rim = new THREE.DirectionalLight(0xffb070, 1.6); rim.position.set(-3, 2.5, -2); scene.add(rim);
      const b = HS.Body.make(id, HS.heightOf(id));
      b.play(HS.idleOf(id), { fade: 0, t: 1.2 }); b.update(0);
      b.root.rotation.y = Math.PI + 0.35;          // a body faces -Z; turn it to the camera, three-quarter
      scene.add(b.root);
      const ht = HS.heightOf(id);
      const cam = new THREE.PerspectiveCamera(26, w / h, 0.1, 50);
      cam.position.set(0.4, ht * 0.62, 4.6); cam.lookAt(0, ht * 0.5, 0);
      const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4 });
      rt.texture.colorSpace = THREE.SRGBColorSpace;
      const clear = renderer.getClearAlpha();
      renderer.setClearAlpha(0);
      renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, cam); renderer.setRenderTarget(null);
      renderer.setClearAlpha(clear);
      const px = new Uint8Array(w * h * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
      rt.dispose();
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const x = c.getContext("2d"), img = x.createImageData(w, h);
      for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      x.putImageData(img, 0, 0);
      return c.toDataURL("image/png");
    });
  };

  /* ------------------------------------------------------------------ props */
  const Props = {};
  const pm = function (c, r) { return new THREE.MeshStandardMaterial({ color: c, roughness: r === undefined ? 0.7 : r }); };
  // A takeout bag (what you hand over at the window).
  Props.bag = function () {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.22), pm(0xc9a26b, 0.9));
    b.position.y = -0.24; g.add(b);
    const fold = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.06), pm(0xb08a55, 0.9));
    fold.position.y = -0.02; g.add(fold);
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.012), pm(0xE8663C, 0.6));
    st.position.set(0, -0.2, 0.116); g.add(st);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    return g;
  };
  // The cart's three things, as held in a hand (metres; the caller scales).
  Props.hotdog = function () {
    const g = new THREE.Group();
    const bun = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.12, 4, 8), pm(0xd9a24b, 0.8));
    bun.rotation.z = Math.PI / 2; bun.scale.set(1, 1, 1.25); g.add(bun);
    const dog = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.15, 4, 8), pm(0x9c3d24, 0.5));
    dog.rotation.z = Math.PI / 2; dog.position.y = 0.025; g.add(dog);
    const mus = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.008, 0.01), pm(0xf2c12e, 0.5));
    mus.position.y = 0.045; g.add(mus);
    return g;
  };
  Props.pretz = function () {
    const g = new THREE.Group();
    const m = pm(0x8a4b1c, 0.6);
    [[-0.035, 0, 0.6], [0.035, 0, -0.6]].forEach(function (p) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.014, 6, 14), m);
      t.position.set(p[0], 0.01, 0); t.rotation.z = p[2]; g.add(t);
    });
    const bar = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.014, 6, 14, Math.PI), m);
    bar.position.y = 0.035; g.add(bar);
    g.rotation.x = Math.PI / 2;
    const w = new THREE.Group(); w.add(g); return w;
  };
  Props.soda = function () {
    const g = new THREE.Group();
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.12, 14), pm(0xc0392b, 0.35));
    g.add(c);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.033, 0.01, 14), pm(0xd0d4d8, 0.3));
    top.position.y = 0.065; g.add(top);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0335, 0.0335, 0.03, 14), pm(0xf4f4f4, 0.4));
    band.position.y = -0.01; g.add(band);
    return g;
  };
  HS.Props = Props;

  /* ------------------------------------------------------------------ the crowd (park customers) */
  const Crowd = { pool: {}, ids: [], near: 14, maxDist: 95, timer: 0, onEnter: null };
  Crowd.init = function (mobile) {
    Crowd.near = mobile ? 7 : 14;
    Crowd.maxDist = mobile ? 70 : 95;
    Crowd.mobile = mobile;
  };
  function readyIds() { return HS.crowdIds(Crowd.mobile).filter(function (id) { return HS.Body.ready(id); }); }
  function acquire(c) {
    const ids = readyIds();
    if (!ids.length) return;
    if (!c.bodyId || !HS.Body.ready(c.bodyId) || c.bodyId === HS.PLAYER) c.bodyId = ids[Math.floor(Math.random() * ids.length)];
    const list = Crowd.pool[c.bodyId] || (Crowd.pool[c.bodyId] = []);
    let a = list.pop();
    if (!a) {
      try { a = HS.makeActor(c.bodyId); } catch (err) { console.warn("body", c.bodyId, err); return; }
    }
    a.root.position.set(0, 0, 0);
    a.root.rotation.y = Math.PI;          // the holder faces +Z (the old figures did); a body faces -Z
    a.root.visible = true;
    a.real = 0; a.moving = false;
    a.b.play(HS.idleOf(a.id), { fade: 0, t: Math.random() * 4 });
    c.mesh.add(a.root);
    c.actor = a;
    c.mesh.userData.proxy.visible = false;
    c.mesh.position.y = 0;
    c.lastX = c.pos.x; c.lastZ = c.pos.y;
    if (c.carrying) { c.carrying = null; }
  }
  Crowd.release = function (c) {
    const a = c.actor;
    if (!a) return;
    if (c.carrying) { HS.Rig.drop(c.carrying); c.carrying = null; }
    c.mesh.remove(a.root);
    (Crowd.pool[a.id] || (Crowd.pool[a.id] = [])).push(a);
    c.actor = null;
    if (c.mesh.userData.proxy) c.mesh.userData.proxy.visible = true;
  };
  const _cam = new THREE.Vector3();
  Crowd.update = function (dt, cam, customers, forceNear) {
    Crowd.timer -= dt;
    if (Crowd.timer <= 0) {
      Crowd.timer = 0.35;
      cam.getWorldPosition(_cam);
      const list = [];
      for (const c of customers) {
        if (!c.mesh.visible) continue;
        c.mesh.getWorldPosition(_a);
        let d = _a.distanceTo(_cam);
        if (forceNear && forceNear(c)) d *= 0.25;       // your own queue gets bodies first
        c._d = d;
        list.push(c);
      }
      list.sort(function (x, y) { return x._d - y._d; });
      for (let i = 0; i < list.length; i++) {
        const c = list[i], want = i < Crowd.near && c._d < Crowd.maxDist;
        if (want && !c.actor) acquire(c);
        else if (!want && c.actor) Crowd.release(c);
      }
    }
    const t = performance.now() * 0.001;
    for (const c of customers) {
      const a = c.actor;
      if (!a) continue;
      const moved = Math.hypot(c.pos.x - (c.lastX === undefined ? c.pos.x : c.lastX), c.pos.y - (c.lastZ === undefined ? c.pos.y : c.lastZ));
      c.lastX = c.pos.x; c.lastZ = c.pos.y;
      a.gait(moved, dt);
      a.b.update(dt);
      // fed up in the line: a slow head shake now and then
      if ((c.state === "queue" || c.state === "waiting") && c.patience < 0.35) {
        a.root.updateMatrixWorld(true);
        HS.Rig.turnHead(a, Math.sin(t * 5 + c.phase) * 0.35 * Math.max(0, Math.sin(t * 0.7 + c.phase)));
      }
      // served: they walk off with the bag
      if (c.state === "eating" && !c.carrying) { c.carrying = Props.bag(); HS.Rig.hold(a, "Right", c.carrying, 0.08); }
      if (c.state !== "eating" && c.state !== "leaving" && c.carrying) { HS.Rig.drop(c.carrying); c.carrying = null; }
    }
  };
  HS.Crowd = Crowd;
})(globalThis.HS);
