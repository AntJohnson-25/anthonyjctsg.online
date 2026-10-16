/* =============================================================
   BILLIONAIRE BARBER — WORLD (3D)
   2026-10-16: the shop is a 3D room now (src/shop3d.js), one per kind of
   shop, with the user's 3D characters walking it (src/body.js). This
   module keeps the 2D World's public API exactly, so Economy, UI,
   Messages and Game are unchanged:
     init, start, update, rebuild, idle, spawnCustomer, performCut,
     sendCustomerHome, reactBarber, activeCustomer, getCustomerById,
     refreshShopDressing, setMerchStock, startBreak, endBreak, project
   plus frame(dt) (render, every frame, paused or not).

   Customers still carry `el` (a DOM anchor that follows their head on
   screen, so the request bubble, feedback card and money floaters hang
   over them as before), `bubble`, `state` ('arriving' | 'seated' |
   'being-cut' | 'leaving'), `requested`, `cutting`, `servedBy`, `x`/`y`
   (their head's last screen position, in % of the stage).
   ============================================================= */

const World = (function () {
  const THREE = globalThis.THREE, HS = globalThis.HS;
  const W3 = CONFIG.world3d;
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);

  let stageEl, actorsEl;
  let S = null;                 // the room (HS.Shop.build)
  let barber = null, npcBarber = null;
  let customers = [];
  let stations = [];
  let sitters = [];             // bench crowd when the shop is full
  let vendingVisitor = null;
  let spawnTimer = 0, npcCycle = 0, onBreak = false;
  let waveActive = false;
  let waveTimer = rand(CONFIG.customers.waveIntervalMin, CONFIG.customers.waveIntervalMax);
  let vendingTimer = rand(15, 30);
  let fullFor = 0, notFullFor = 0, extraCycle = 0;
  let workSplit = { player: 0, npc: 0 };
  let clock = 0, lastReact = null;
  let hair = null;

  /* -----------------------------------------------------------
     ACTORS: a body, where it is, where it's going
     ----------------------------------------------------------- */
  function makeActor(bodyId, kind) {
    const b = HS.Body.make(bodyId, HS.heightOf(bodyId));
    HS.View.actors.add(b.root);
    b.play(HS.idleOf(bodyId), { fade: 0, t: Math.random() * 5 });
    const el = document.createElement('div');
    el.className = 'actor3d ' + kind;
    actorsEl.appendChild(el);
    return {
      b: b, body: bodyId, el: el, kind: kind,
      pos: new THREE.Vector3(), yaw: 0, path: [], speed: W3.walkSpeed,
      onArrive: null, faceYaw: null, mode: 'stand', x: 50, y: 50,
      ik: 0, ikWant: 0, shake: 0, cheer: 0, hop: 0
    };
  }
  function removeActor(a) {
    HS.View.actors.remove(a.b.root);
    a.el.remove();
    if (a.waitSeat && a.waitSeat.by === a.id) a.waitSeat.by = null;
    if (a.tray) { HS.View.scene.remove(a.tray); a.tray = null; }
    if (a.mark) { HS.View.scene.remove(a.mark); a.mark = null; }
    if (a.cape) { HS.View.scene.remove(a.cape); a.cape = null; }
    if (a.ring) { HS.View.scene.remove(a.ring); a.ring = null; }
  }
  function place(a, p, yaw) { a.pos.copy(p); a.yaw = yaw; a.b.root.position.copy(p); a.b.root.rotation.y = yaw; }
  function yawTo(dx, dz) { return Math.atan2(-dx, -dz); }
  function turnToward(a, target, dt, k) {
    let d = target - a.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    a.yaw += d * Math.min(1, dt * (k || 9));
    return Math.abs(d);
  }
  function walkTo(a, points, onArrive, faceYaw) {
    a.path = points.map(function (p) { return p.clone(); });
    a.onArrive = onArrive || null;
    a.faceYaw = faceYaw === undefined ? null : faceYaw;
    a.mode = 'walk';
  }
  /* One step of walking along a path; returns true while still moving. */
  function stepWalk(a, dt) {
    if (a.mode !== 'walk') return false;
    if (!a.path.length) {
      a.mode = 'stand';
      a.b.play(HS.idleOf(a.body), { fade: 0.3 });
      const cb = a.onArrive; a.onArrive = null;
      if (cb) cb();
      return false;
    }
    const t = a.path[0];
    const dx = t.x - a.pos.x, dz = t.z - a.pos.z, dist = Math.hypot(dx, dz);
    if (dist < 0.06) { a.path.shift(); return true; }
    const step = Math.min(dist, a.speed * dt);
    a.pos.x += dx / dist * step; a.pos.z += dz / dist * step;
    turnToward(a, yawTo(dx, dz), dt, 10);
    // the clip's own pace is ~1.6 m/s on a 1.8 m body, so the feet don't slide
    a.b.play(HS.walkOf(a.body), { fade: 0.2, rate: a.speed / (1.6 * a.b.height / 1.8) });
    return true;
  }

  /* -----------------------------------------------------------
     SITTING: line a body's hips up over a seat, as Spades does
     ----------------------------------------------------------- */
  function sitOffset(b) {
    if (b.sitOff) return b.sitOff;
    const keep = { cur: b.cur, t: b.t, rate: b.rate, loop: b.loop };
    const p = b.root.position.clone(), r = b.root.rotation.y;
    b.root.position.set(0, 0, 0); b.root.rotation.y = 0;
    b.play('sit', { fade: 0, restart: true }); b.update(0);
    b.root.updateMatrixWorld(true);
    const hp = b.bonePos('Hips', new THREE.Vector3());
    b.sitOff = hp;
    b.root.position.copy(p); b.root.rotation.y = r;
    if (keep.cur) { b.play(keep.cur, { fade: 0, restart: true, t: keep.t, rate: keep.rate, loop: keep.loop }); b.update(0); }
    return hp;
  }
  /* Root position that puts the hips on a seat at (x, z), facing yaw. */
  function seatRoot(b, x, z, yaw, seatY) {
    const o = sitOffset(b);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const ox = o.x * c + o.z * s, oz = -o.x * s + o.z * c;            // the offset turned by yaw
    const back = 0.06;
    const want = (seatY + 0.15) - o.y;
    return new THREE.Vector3(x - ox + Math.sin(yaw) * back, Math.abs(want) < 0.3 ? want : 0, z - oz + Math.cos(yaw) * back);
  }
  /* Sit down: crossfade into the seated clip while gliding onto the seat. */
  function sitDown(a, x, z, yaw, seatY, onSat) {
    a.mode = 'sitting';
    a.sitFrom = a.pos.clone(); a.sitTo = seatRoot(a.b, x, z, yaw, seatY);
    a.sitYaw0 = a.yaw; a.sitYaw = yaw; a.sitT = 0; a.onSat = onSat || null;
    a.b.play('sit', { fade: W3.sitBlend, t: Math.random() * 3 });
  }
  /* Stand up and walk back out to `to`. */
  function standUp(a, to, onUp) {
    a.mode = 'rising';
    a.sitFrom = a.pos.clone(); a.sitTo = to.clone(); a.sitT = 0; a.onUp = onUp || null;
    a.b.play('standup', { fade: 0.25, loop: false, rate: 1.35 });
  }
  function stepSit(a, dt) {
    if (a.mode === 'sitting') {
      a.sitT = Math.min(1, a.sitT + dt / W3.sitBlend);
      const k = a.sitT * a.sitT * (3 - 2 * a.sitT);
      a.pos.lerpVectors(a.sitFrom, a.sitTo, k);
      a.yaw = a.sitYaw0 + angleDiff(a.sitYaw, a.sitYaw0) * k;
      if (a.sitT >= 1) {
        a.mode = 'seated';
        // hats off while they sit (HS.HATS: Cole's hard hat, Jamal's cap and headphones)
        if (HS.HATS[a.body]) a.b.hatOff(HS.HATS[a.body]);
        const cb = a.onSat; a.onSat = null; if (cb) cb();
      }
      return true;
    }
    if (a.mode === 'rising') {
      const dur = window.PK.CLIPS.standup.dur / 1.35;
      a.sitT = Math.min(1, a.sitT + dt / dur);
      const k = Math.min(1, Math.max(0, (a.sitT - 0.25) / 0.6));
      a.pos.lerpVectors(a.sitFrom, a.sitTo, k * k * (3 - 2 * k));
      if (a.sitT >= 1 || a.b.done) {
        a.mode = 'stand';
        a.b.play(HS.idleOf(a.body), { fade: 0.3 });
        if (HS.HATS[a.body]) a.b.hatOn();             // and back on once they're up
        const cb = a.onUp; a.onUp = null; if (cb) cb();
      }
      return true;
    }
    return false;
  }
  function angleDiff(a, b) { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }

  /* -----------------------------------------------------------
     ARMS: two-bone IK, so any body can reach a client's head
     (there is no haircut clip; the arms are posed in code over the idle)
     ----------------------------------------------------------- */
  function bone(a, name) { const i = a.b.M.BN[name]; return i === undefined ? null : a.b.bones[i]; }
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
  function reach(a, side, target, pole, w) {
    if (w <= 0.001) return;
    const up = bone(a, side + 'Arm'), fore = bone(a, side + 'ForeArm'), hand = bone(a, side + 'Hand');
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
  }
  /* Head shake (frustrated) and a nod, as extra turns of the head bone about world up. */
  function turnHead(a, ang) {
    const hb = bone(a, 'Head');
    if (!hb || Math.abs(ang) < 1e-4) return;
    hb.getWorldQuaternion(_q2); hb.parent.getWorldQuaternion(_q3);
    _q.setFromAxisAngle(UP, ang);
    hb.quaternion.copy(_q3.invert().multiply(_q.multiply(_q2)));
  }

  /* The barber's working pose: comb in one hand by the crown, scissors in the other
     snipping round the side of the head. */
  function workPose(a, dt) {
    a.ik += ((a.ikWant || 0) - a.ik) * Math.min(1, dt * 6);
    const c = a.client;
    if (a.ik > 0.01 && c) {
      a.b.root.updateMatrixWorld(true);
      c.b.root.updateMatrixWorld(true);
      const head = c.b.bonePos('Head', new THREE.Vector3()).add(new THREE.Vector3(0, 0.07, 0));
      const toMe = new THREE.Vector3(a.pos.x - head.x, 0, a.pos.z - head.z).normalize();
      const across = new THREE.Vector3(-toMe.z, 0, toMe.x);
      const t = clock * 9 + a.phase;
      const snip = head.clone().addScaledVector(toMe, 0.13).addScaledVector(across, -0.07 + Math.sin(t * 0.21) * 0.05)
        .add(new THREE.Vector3(0, 0.02 + Math.sin(t * 0.13) * 0.04 + Math.abs(Math.sin(t)) * 0.012, 0));
      const comb = head.clone().addScaledVector(toMe, 0.08).addScaledVector(across, 0.11).add(new THREE.Vector3(0, 0.12, 0));
      reach(a, 'Right', snip, new THREE.Vector3(0, -1, 0).addScaledVector(across, -0.6), a.ik);
      reach(a, 'Left', comb, new THREE.Vector3(0, -1, 0).addScaledVector(across, 0.6), a.ik * 0.9);
      if (a.scissors) {
        a.scissors.visible = a.ik > 0.5;
        const hb = bone(a, 'RightHand'), fb = bone(a, 'RightForeArm');
        hb.getWorldPosition(_a); fb.getWorldPosition(_b);
        a.scissors.position.copy(_a).addScaledVector(_c.copy(_a).sub(_b).normalize(), 0.07);
        a.scissors.lookAt(_d.copy(a.scissors.position).add(_c));
        a.scissors.children[0].rotation.z = 0.2 + Math.abs(Math.sin(t)) * 0.35;
        a.scissors.children[1].rotation.z = -0.2 - Math.abs(Math.sin(t)) * 0.35;
      }
    } else if (a.scissors) a.scissors.visible = false;
  }
  /* Celebrate: both fists up and a little hop. Frustrated: a head shake. */
  function reactPose(a, dt) {
    if (a.cheer > 0) {
      a.cheer = Math.max(0, a.cheer - dt);
      const w = Math.min(1, a.cheer * 3, (1.1 - a.cheer) * 6);
      a.b.root.updateMatrixWorld(true);
      const hd = a.b.bonePos('Head', new THREE.Vector3());
      const fwd = new THREE.Vector3(-Math.sin(a.yaw), 0, -Math.cos(a.yaw)), rt = new THREE.Vector3(-fwd.z, 0, fwd.x);
      reach(a, 'Right', hd.clone().addScaledVector(rt, 0.26).addScaledVector(fwd, 0.08).add(new THREE.Vector3(0, 0.42, 0)), new THREE.Vector3(0, 0, 0).addScaledVector(rt, 1), w);
      reach(a, 'Left', hd.clone().addScaledVector(rt, -0.26).addScaledVector(fwd, 0.08).add(new THREE.Vector3(0, 0.42, 0)), new THREE.Vector3(0, 0, 0).addScaledVector(rt, -1), w);
      a.b.root.position.y += Math.max(0, Math.sin((1.1 - a.cheer) * 11)) * 0.07 * w;
    }
    if (a.shake > 0) {
      a.shake = Math.max(0, a.shake - dt);
      turnHead(a, Math.sin(a.shake * 16) * 0.42 * Math.min(1, a.shake * 2));
    }
  }

  /* -----------------------------------------------------------
     PROPS: scissors, the cutting cape, falling hair, regulars' ring
     ----------------------------------------------------------- */
  function scissors() {
    const g = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.2, metalness: 1 });
    [1, -1].forEach(function () {
      const blade = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.004, 0.09), steel); m.position.z = 0.045; blade.add(m);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.003, 6, 14), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 }));
      ring.position.set(0.012, 0, -0.02); ring.rotation.x = Math.PI / 2; blade.add(ring);
      g.add(blade);
    });
    g.visible = false;
    HS.View.scene.add(g);
    return g;
  }
  /* The cutting cape: a cloth draped over THIS client as they sit, built from their own bones
     (neck, shoulders, knees). Snug collar, over the shoulders and armrests, across the lap past
     the knees and hanging down from there, shorter at the back where the chair is; fold ripples
     toward the hem. (It used to be a cone, which read as a cone.) */
  const capeTex = {};
  function capeMaterial() {
    const gold = !!(S && S.K.chair.gold);
    if (!capeTex[gold]) {
      const c = document.createElement('canvas'); c.width = 256; c.height = 256;
      const g = c.getContext('2d');
      g.fillStyle = gold ? '#121212' : '#1d2b48'; g.fillRect(0, 0, 256, 256);
      g.strokeStyle = gold ? 'rgba(201,162,39,.55)' : 'rgba(235,240,250,.22)'; g.lineWidth = 2;
      for (let x = 8; x < 256; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
      for (let i = 0; i < 1400; i++) { g.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.035) + ')'; g.fillRect(Math.random() * 256, Math.random() * 256, 1, 1); }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 1.5); t.anisotropy = 4;
      capeTex[gold] = t;
    }
    return new THREE.MeshStandardMaterial({ map: capeTex[gold], roughness: 0.62, metalness: 0.02, side: THREE.DoubleSide });
  }
  function capeGeometry(c) {
    const b = c.b;
    b.root.updateMatrixWorld(true);
    const bp = function (n, fb) { return b.bonePos(b.M.BN[n] !== undefined ? n : fb, new THREE.Vector3()); };
    const N = bp('Neck', 'Head'), LS = bp('LeftArm', 'Neck'), RS = bp('RightArm', 'Neck');
    const LK = bp('LeftLeg', 'Hips'), RK = bp('RightLeg', 'Hips'), HP = bp('Hips', 'Hips');
    const f = new THREE.Vector3(-Math.sin(c.yaw), 0, -Math.cos(c.yaw)), r = new THREE.Vector3(Math.cos(c.yaw), 0, -Math.sin(c.yaw));
    const K = LK.clone().add(RK).multiplyScalar(0.5);
    const shHalf = Math.max(0.17, LS.distanceTo(RS) / 2), knHalf = Math.max(0.1, LK.distanceTo(RK) / 2);
    const shY = (LS.y + RS.y) / 2 - N.y, kneeFwd = Math.max(0.28, K.clone().sub(N).dot(f)), kneeY = K.y - N.y, seatY = HP.y - N.y;
    const COLS = 48, ROWS = 16;
    const pos = [], uv = [], idx = [];
    const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const curve = new THREE.CatmullRomCurve3(P, false, 'centripetal');
    const lat = new THREE.Vector3(), q = new THREE.Vector3();
    for (let i = 0; i <= COLS; i++) {
      const th = i / COLS * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);   // sn > 0: front
      const fr = Math.max(0, sn), bk = Math.max(0, -sn), sd = 1 - fr - bk * 0.4;
      // 0: collar, snug round the neck, a touch below it
      P[0].set(0, -0.03, 0).addScaledVector(r, cs * 0.075).addScaledVector(f, sn * 0.065);
      // 1: on the shoulders (wide sideways, shallow front-to-back)
      P[1].set(0, shY + 0.03, 0).addScaledVector(r, cs * (shHalf + 0.05)).addScaledVector(f, sn * (sn > 0 ? 0.17 : 0.14));
      // 2: front lies over the knees; sides over the armrests; back drops behind the shoulders
      lat.set(0, 0, 0);
      const side2 = q.set(0, seatY + 0.2, 0).addScaledVector(r, cs * (shHalf + 0.17)).addScaledVector(f, sn * 0.12).clone();
      const front2 = new THREE.Vector3(0, kneeY + 0.08, 0).addScaledVector(r, cs * (knHalf + 0.16)).addScaledVector(f, kneeFwd + 0.04);
      const back2 = new THREE.Vector3(0, shY - 0.32, 0).addScaledVector(r, cs * (shHalf + 0.08)).addScaledVector(f, -0.2);
      if (sn >= 0) P[2].copy(side2).lerp(front2, Math.pow(fr, 0.8)); else P[2].copy(side2).lerp(back2, Math.pow(bk, 0.8));
      // 3, 4: the fall to the hem: longest in front (past the shins), short at the back
      const drop = 0.08 + fr * 0.3 + sd * 0.1;
      P[3].copy(P[2]).add(new THREE.Vector3(0, -drop * 0.55, 0)).addScaledVector(r, cs * 0.04).addScaledVector(f, fr * 0.04);
      P[4].copy(P[2]).add(new THREE.Vector3(0, -drop, 0)).addScaledVector(r, cs * 0.06).addScaledVector(f, fr * 0.06 - bk * 0.02);
      for (let j = 0; j <= ROWS; j++) {
        const v = j / ROWS;
        curve.getPoint(v, q);
        // folds: soft vertical ripples that grow toward the hem
        const fold = Math.sin(th * 11 + Math.sin(th * 3) * 1.5) * 0.014 * v * v;
        q.addScaledVector(r, cs * fold).addScaledVector(f, sn * fold);
        pos.push(q.x, q.y, q.z);
        uv.push(i / COLS, 1 - v);
      }
    }
    for (let i = 0; i < COLS; i++) for (let j = 0; j < ROWS; j++) {
      const a = i * (ROWS + 1) + j, b2 = (i + 1) * (ROWS + 1) + j;
      idx.push(a, b2, a + 1, b2, b2 + 1, a + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return { geo: geo, at: N };
  }
  function cape(c) {
    const g = capeGeometry(c);
    const m = new THREE.Mesh(g.geo, capeMaterial());
    m.castShadow = true; m.receiveShadow = true;
    m.position.copy(g.at);
    // the collar band
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.011, 8, 28), new THREE.MeshStandardMaterial({ color: S && S.K.chair.gold ? 0xc9a227 : 0xf2efe8, metalness: S && S.K.chair.gold ? 1 : 0, roughness: 0.35 }));
    band.rotation.x = Math.PI / 2; band.position.y = -0.03; m.add(band);
    m.scale.setScalar(0.01);
    HS.View.scene.add(m);
    c.cape = m; c.capeT = 0;
  }
  function stepCape(c, dt) {
    if (!c.cape) return;
    const on = c.state === 'being-cut';
    c.capeT = THREE.MathUtils.clamp(c.capeT + (on ? dt : -dt) * 2.6, 0, 1);
    if (!on && c.capeT <= 0) { HS.View.scene.remove(c.cape); c.cape.geometry.dispose(); c.cape = null; return; }
    // it unfurls down from the collar (and is whisked back up when the cut's done)
    const k = c.capeT * c.capeT * (3 - 2 * c.capeT);
    c.cape.scale.set(0.6 + 0.4 * k, Math.max(0.01, k), 0.6 + 0.4 * k);
  }

  function makeHair() {
    const N = 360;
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.01, 0.003, 0.028), new THREE.MeshStandardMaterial({ color: 0x1c140f, roughness: 0.9 }), N);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false;
    HS.View.scene.add(im);
    const d = new THREE.Object3D();
    d.scale.setScalar(0); d.updateMatrix();
    for (let i = 0; i < N; i++) im.setMatrixAt(i, d.matrix);
    return { im: im, N: N, next: 0, p: [], dummy: d };
  }
  function emitHair(at, n) {
    for (let i = 0; i < n; i++) {
      const k = hair.next++ % hair.N;
      hair.p[k] = { x: at.x + rand(-0.09, 0.09), y: at.y + rand(-0.05, 0.05), z: at.z + rand(-0.09, 0.09),
                    vx: rand(-0.15, 0.15), vy: rand(-0.1, 0.25), vz: rand(-0.15, 0.15), r: rand(0, 6), life: 14, s: rand(0.7, 1.4) };
    }
  }
  function stepHair(dt) {
    const d = hair.dummy;
    for (let i = 0; i < hair.N; i++) {
      const p = hair.p[i];
      if (!p) continue;
      p.life -= dt;
      if (p.y > 0.003) { p.vy -= 3.2 * dt; p.vx *= 0.96; p.vz *= 0.96; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.r += dt * 6; if (p.y < 0.003) p.y = 0.003; }
      const s = p.life > 0 ? p.s * Math.min(1, p.life / 2) : 0;
      d.position.set(p.x, p.y, p.z); d.rotation.set(p.y > 0.003 ? p.r : 0, p.r, 0); d.scale.setScalar(s);
      d.updateMatrix(); hair.im.setMatrixAt(i, d.matrix);
      if (p.life <= 0) hair.p[i] = null;
    }
    hair.im.instanceMatrix.needsUpdate = true;
  }
  function regularRing(c) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.36, 32), new THREE.MeshBasicMaterial({ color: 0xc9a227, transparent: true, opacity: 0.7, toneMapped: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    HS.View.scene.add(m);
    c.ring = m;
  }

  /* -----------------------------------------------------------
     SHOP CONSTRUCTION
     ----------------------------------------------------------- */
  function shopKind() {
    return gameState.business.shopType === 'rental' ? 'rental' : (gameState.business.shopSize || 'small');
  }
  function district(kind) {
    const p = gameState.properties.filter(q => q.size === kind)[0];
    return p ? p.name.replace(/\s+(Barbershop|Flagship)$/, '') : '';
  }
  function buildShop(sweep) {
    const kind = shopKind();
    if (S) HS.Shop.dispose(S);
    S = HS.Shop.build(kind, { district: district(kind) });
    HS.View.setShop(S, sweep);
    stations = S.stations;
    buildWaitSeats();
    stageEl.dataset.shop = kind;
    refreshShopDressing();
    setMerchStock(1);
  }

  function refreshShopDressing() {
    if (S) HS.Shop.setVending(S, gameState.revenueStreams.vending);
  }

  function setMerchStock(frac) {
    if (S) HS.Shop.setMerch(S, frac, gameState.revenueStreams.merchandise);
  }

  /* -----------------------------------------------------------
     THE WAITING BENCHES (user, 2026-10-16: "customers should come in and sit down")
     When every chair is taken, a new client takes a seat on the benches (or the lounge sofa)
     and waits their turn: state 'waiting'. When a chair frees up, whoever has waited longest gets
     up and takes it. Wait too long and they leave, quietly (no reputation hit: the shop was just
     busy). Replaces the 2D game's decorative bench crowd.
     ----------------------------------------------------------- */
  let waitSeats = [];
  function buildWaitSeats() {
    waitSeats = [];
    S.benches.forEach(function (b) { b.seats.forEach(function (p) { waitSeats.push({ p: p, yaw: b.yaw, seatY: b.seatY, by: null }); }); });
  }
  function maxWaiting() { return Math.min(4, waitSeats.length); }
  function seatFront(seat) { return seat.p.clone().add(new THREE.Vector3(-Math.sin(seat.yaw) * 0.6, 0, -Math.cos(seat.yaw) * 0.6)); }
  function waitBubble(c) {
    c.bubble.innerHTML = '<span class="bubble-name">' + c.name + '</span><span class="bubble-ask">Waiting…</span>';
    c.bubble.classList.add('show', 'waiting');
  }
  function updateWaiting(dt) {
    const waiting = customers.filter(c => c.state === 'waiting');
    // patience on the bench
    waiting.forEach(function (c) {
      if (c.mode !== 'seated') return;
      c.waitLeft -= dt;
      c.bubble.style.setProperty('--patience', String(clamp(c.waitLeft / W3.benchPatience, 0, 1)));
      if (c.waitLeft <= 0) {
        c.state = 'leaving';
        c.bubble.classList.remove('show', 'waiting');
        const seat = c.waitSeat;
        c.shake = 0.9;
        standUp(c, seatFront(seat), function () {
          seat.by = null; c.waitSeat = null;
          walkTo(c, [S.inside, S.door, S.outside], function () { c.gone = true; });
        });
      }
    });
    // a chair is free: the longest-waiting client takes it
    const st = stations.find(s => !s.occupiedBy);
    if (!st) return;
    const next = waiting.filter(c => c.mode === 'seated').sort((a, b) => a.queuedAt - b.queuedAt)[0];
    if (!next) return;
    st.occupiedBy = next.id;
    next.station = st;
    next.state = 'arriving';
    next.bubble.classList.remove('show', 'waiting');
    const seat = next.waitSeat;
    standUp(next, seatFront(seat), function () {
      seat.by = null; next.waitSeat = null;
      walkTo(next, [st.aisle, st.front], function () { seatInChair(next, st); });
    });
  }
  /* -----------------------------------------------------------
     THE STREET VENDOR (CONFIG.vendor): Tez walks in with a tray now and then, works the room
     (waiting clients, clients in the chairs, the other barber: they buy now and then), then
     waits at the front for you. Walk up and press E / BUY to see what he's got.
     ----------------------------------------------------------- */
  let vendor = null, vendorTimer = CONFIG.vendor.firstAfter, vendorPanel = null;
  function vendorTray() {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.7 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.32), wood); g.add(base);
    [[0, 0.04, 0.16, 0.5, 0.08, 0.02], [0, 0.04, -0.16, 0.5, 0.08, 0.02], [0.25, 0.04, 0, 0.02, 0.08, 0.32], [-0.25, 0.04, 0, 0.02, 0.08, 0.32]].forEach(function (b) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(b[3], b[4], b[5]), wood); m.position.set(b[0], b[1], b[2]); g.add(m);
    });
    const goods = [[0xe0614f, 0.07, 0.12, 0.05], [0x5cc08a, 0.06, 0.1, 0.06], [0xe6c866, 0.08, 0.05, 0.08], [0x5b9dd9, 0.05, 0.14, 0.05], [0xf2efe8, 0.09, 0.04, 0.06], [0x111111, 0.06, 0.08, 0.04]];
    goods.forEach(function (q, i) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(q[1], q[2], q[3]), new THREE.MeshStandardMaterial({ color: q[0], roughness: 0.5 }));
      m.position.set(-0.17 + (i % 3) * 0.17, 0.03 + q[2] / 2, i < 3 ? -0.07 : 0.07); g.add(m);
    });
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.01, 6, 24, Math.PI), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 }));
    strap.position.set(0, 0.02, 0.0); strap.rotation.set(0, 0, 0); strap.scale.set(1, 1.6, 1); g.add(strap);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    HS.View.scene.add(g);
    return g;
  }
  function spawnVendor() {
    const id = HS.Body.ready('Ch18') ? 'Ch18' : pickLoaded(HS.EXTRAS, 0);
    if (!id) return;
    const v = makeActor(id, 'vendor');
    v.el.innerHTML = '<div class="cust-bubble vendor-bubble"></div>';
    v.bubble = v.el.querySelector('.cust-bubble');
    v.name = CONFIG.vendor.name;
    v.speed = 1.3;
    v.tray = vendorTray();
    place(v, S.outside, Math.PI);
    // the round: clients on the benches, clients in the chairs, the other barber; then the front
    const stops = [];
    customers.filter(c => c.state === 'waiting' && c.waitSeat).slice(0, 2).forEach(function (c) { stops.push({ who: c, at: seatFront(c.waitSeat).add(new THREE.Vector3(0, 0, 0.25)) }); });
    customers.filter(c => c.state === 'seated' && c.station && c.servedBy === 'npc').slice(0, 1).forEach(function (c) { stops.push({ who: c, at: c.station.front.clone().lerp(c.station.aisle, 0.6) }); });
    if (npcBarber && !npcBarber.cutting) stops.push({ who: npcBarber, at: npcBarber.pos.clone().add(new THREE.Vector3(npcBarber.pos.x > 0 ? -0.9 : 0.9, 0, 0.3)) });
    v.stops = stops;
    v.phase = 'in';
    vendor = v;
    vendorSay(v.name + ' · Vendor', 'Water, earbuds, the good stuff!');
    walkTo(v, [S.door, S.inside], nextStop);
  }
  function vendorSay(who, line) {
    if (!vendor) return;
    vendor.bubble.innerHTML = '<span class="bubble-name">' + who + '</span><span class="bubble-ask">' + line + '</span>';
    vendor.bubble.classList.add('show');
  }
  function nextStop() {
    const v = vendor;
    if (!v) return;
    const s = v.stops.shift();
    if (!s) {
      // wait at the front for the player
      const spot = S.barberSpots[0].clone().lerp(S.barberSpots[1], 0.5).add(new THREE.Vector3(0, 0, -1.3));
      walkTo(v, [spot], function () { v.phase = 'linger'; v.wait = CONFIG.vendor.linger; vendorSay(v.name + ' · Vendor', 'Barber! Come see what I got.'); }, Math.PI);
      return;
    }
    walkTo(v, [new THREE.Vector3(s.at.x * 0.5, 0, s.at.z), s.at], function () {
      v.phase = 'pitch'; v.wait = 2.6; v.target = s.who;
      v.faceYaw = yawTo(s.who.pos.x - v.pos.x, s.who.pos.z - v.pos.z);
      vendorSay(v.name, pick(['Ice-cold water?', 'Need a charger?', 'Earbuds, two for one!', 'Fresh incense, boss?']));
    });
  }
  function updateVendor(dt) {
    if (!vendor) {
      if (onBreak) return;
      vendorTimer -= dt;
      if (vendorTimer <= 0) { vendorTimer = rand(CONFIG.vendor.everyMin, CONFIG.vendor.everyMax); spawnVendor(); }
      return;
    }
    const v = vendor;
    if (!stepWalk(v, dt) && v.faceYaw !== null) turnToward(v, v.faceYaw, dt, 6);
    if (v.phase === 'pitch') {
      v.wait -= dt;
      if (v.wait <= 0) {
        v.phase = 'walk';
        const t = v.target;
        if (t && !t.gone && chance(CONFIG.vendor.npcBuyChance)) {
          const g = pick(CONFIG.vendor.npcGoods);
          vendorSay(v.name, 'Sold! ' + g[0] + ' · $' + g[1]);
          if (t.kind === 'customer') {
            UI.floater(g[0] + '<small>bought from ' + v.name + '</small>', 'good', { el: t.el, dy: 40 });
            if (t.state === 'waiting') t.waitLeft = Math.min(W3.benchPatience, (t.waitLeft || 0) + CONFIG.vendor.snackPatience);
            else if (t.state === 'seated') t.patience = Math.min(CONFIG.customers.patienceSeconds, t.patience + CONFIG.vendor.snackPatience * 0.5);
          }
        } else vendorSay(v.name, pick(['Aight, maybe next time.', 'No worries, boss.', 'Your loss!']));
        setTimeout(nextStop, 900);
      }
    } else if (v.phase === 'linger') {
      if (!vendorPanelOpen()) v.wait -= dt;
      if (v.wait <= 0) vendorLeave('Catch you next time!');
    }
    if (v.gone) { closeVendorPanel(); removeActor(v); vendor = null; }
  }
  function vendorLeave(line) {
    const v = vendor;
    if (!v || v.phase === 'out') return;
    v.phase = 'out';
    closeVendorPanel();
    vendorSay(v.name, line);
    walkTo(v, [S.inside, S.door, S.outside], function () { v.gone = true; });
  }
  function trayPose(v, dt) {
    if (!v.tray) return;
    v.b.root.updateMatrixWorld(true);
    const sp = v.b.bonePos(v.b.M.BN.Spine1 !== undefined ? 'Spine1' : 'Spine', new THREE.Vector3());
    const fwd = new THREE.Vector3(-Math.sin(v.yaw), 0, -Math.cos(v.yaw)), rt = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const at = sp.clone().addScaledVector(fwd, 0.3); at.y = sp.y - 0.02;
    v.tray.position.copy(at); v.tray.rotation.y = v.yaw;
    reach(v, 'Right', at.clone().addScaledVector(rt, 0.24).addScaledVector(fwd, -0.02).add(new THREE.Vector3(0, 0.05, 0)), new THREE.Vector3(0, -1, 0).addScaledVector(rt, 1), 1);
    reach(v, 'Left', at.clone().addScaledVector(rt, -0.24).addScaledVector(fwd, -0.02).add(new THREE.Vector3(0, 0.05, 0)), new THREE.Vector3(0, -1, 0).addScaledVector(rt, -1), 1);
  }
  // His menu, for you.
  function vendorPanelOpen() { return !!(vendorPanel && vendorPanel.classList.contains('show')); }
  function closeVendorPanel() { if (vendorPanel) vendorPanel.classList.remove('show'); }
  function openVendorPanel() {
    if (!vendorPanel) {
      vendorPanel = document.createElement('div');
      vendorPanel.id = 'vendor-panel';
      document.getElementById('game').appendChild(vendorPanel);
      vendorPanel.addEventListener('click', function (e) {
        const b = e.target.closest('[data-buy]');
        if (b) buy(b.dataset.buy);
        if (e.target.closest('.vendor-close')) closeVendorPanel();
      });
      document.addEventListener('keydown', function (e) {
        if (!vendorPanelOpen()) return;
        if (e.key === 'Escape') closeVendorPanel();
        const n = Number(e.key);
        if (n >= 1 && n <= CONFIG.vendor.items.length) { e.stopImmediatePropagation(); buy(CONFIG.vendor.items[n - 1].key); }
      }, true);
    }
    renderVendorPanel();
    vendorPanel.classList.add('show');
    vendorSay(CONFIG.vendor.name, 'Take a look, everything\'s legit.');
  }
  function renderVendorPanel() {
    const P = gameState.perks;
    vendorPanel.innerHTML =
      '<div class="vendor-head"><span class="req-who">' + CONFIG.vendor.name + ' · street vendor</span><button type="button" class="vendor-close" title="Close (Esc)">✕</button></div>' +
      '<div class="vendor-cards">' + CONFIG.vendor.items.map(function (it, i) {
        const owned = it.once && P[it.key];
        const broke = gameState.cash < it.price;
        return '<button type="button" class="vendor-card' + (owned ? ' owned' : '') + '" data-buy="' + it.key + '"' + (owned || broke ? ' disabled' : '') + '>' +
                 '<span class="vc-key">' + (i + 1) + '</span>' +
                 '<span class="vc-name">' + it.name + '</span>' +
                 '<span class="vc-desc">' + it.desc + (it.key === 'towels' && P.towels ? ' <b>(' + P.towels + ' left)</b>' : '') + '</span>' +
                 '<span class="vc-price">' + (owned ? 'OWNED' : money(it.price)) + '</span>' +
               '</button>';
      }).join('') + '</div>' +
      '<p class="picker-hint">Walk away or press <kbd>Esc</kbd> to pass. Keys <kbd>1</kbd>–<kbd>4</kbd></p>';
  }
  function buy(key) {
    const it = CONFIG.vendor.items.find(x => x.key === key);
    const P = gameState.perks;
    if (!it || gameState.cash < it.price || (it.once && P[it.key])) return;
    Economy.addExpense('Vendor', it.price);
    if (key === 'towels') { P.towels += 10; UI.toast('Hot towels stocked: +1 rep on your next 10 cuts', 'good'); }
    if (key === 'clippers') { P.clippers = true; UI.toast('Pro clippers: your cuts are 15% quicker', 'good'); }
    if (key === 'flyers') { waveActive = true; waveTimer = rand(14, 20); spawnTimer = 99; UI.toast('Flyers out: here come the walk-ins', 'good'); }
    if (key === 'watch') {
      UI.toast('You bought the watch… let\'s see', 'neutral');
      setTimeout(function () {
        if (chance(0.3)) { Economy.addRevenue('Watch resale', 400); UI.toast('It was real! Resold for $400', 'good'); }
        else UI.toast('Fake. Lesson learned.', 'bad');
      }, 2500);
    }
    vendorSay(CONFIG.vendor.name, 'Pleasure doing business!');
    renderVendorPanel();
    saveGame(true);
  }

  function seatInChair(c, st) {
    sitDown(c, st.x, st.z, st.yaw, st.seatY, function () {
      setCustomerState(c, 'seated');
      requestStyle(c);
    });
  }
  function pickLoaded(list, start) {
    for (let i = 0; i < list.length; i++) { const id = list[(start + i) % list.length]; if (HS.Body.ready(id)) return id; }
    return null;
  }

  /* -----------------------------------------------------------
     BARBERS
     ----------------------------------------------------------- */
  function createBarber() {
    const a = makeActor(HS.BARBERS[gameState.barber.character], 'barber');
    a.speed = W3.barberSpeed; a.phase = 0; a.vel = 0;
    a.scissors = scissors();
    place(a, S.barberSpots[0], 0);                 // facing into the shop, the camera behind
    a.state = 'idle';
    barber = a;
    return a;
  }

  /* The barber walks itself only on the way into a cut and to the break (barber.auto). */
  function moveBarberTo(p, onArrive, faceYaw) {
    barber.ikWant = 0;
    barber.auto = true;
    walkTo(barber, [p], onArrive, faceYaw);
  }

  /* YOU walk the barber: arrow keys / the thumb wheel, relative to the camera (as in Spades). */
  function updateBarber(dt) {
    if (!barber) return;
    if (barber.auto) {
      if (!stepWalk(barber, dt) && barber.faceYaw !== null) turnToward(barber, barber.faceYaw, dt, 6);
    } else if (!barber.ikWant) {
      const I = HS.Input.read();
      const m = Math.min(1, Math.hypot(I.x, I.z));
      const want = m * (I.brisk ? W3.barberBrisk : W3.barberSpeed);
      barber.vel += (want - barber.vel) * Math.min(1, dt * 8);
      if (m > 0.05) {
        const cy = HS.View.camYaw;
        const fx = -Math.sin(cy), fz = -Math.cos(cy), rx = Math.cos(cy), rz = -Math.sin(cy);
        turnToward(barber, yawTo(fx * -I.z + rx * I.x, fz * -I.z + rz * I.x), dt, 10);
      }
      const px = barber.pos.x, pz = barber.pos.z;
      if (barber.vel > 0.05) {
        barber.pos.x += -Math.sin(barber.yaw) * barber.vel * dt;
        barber.pos.z += -Math.cos(barber.yaw) * barber.vel * dt;
        HS.Shop.collide(S, barber.pos, 0.3);
      }
      // The legs follow how fast the barber REALLY moved, not the key: pushing into a wall or a
      // chair used to keep the walk cycle going on the spot.
      const real = Math.hypot(barber.pos.x - px, barber.pos.z - pz) / Math.max(dt, 1e-4);
      barber.real = (barber.real || 0) + (real - (barber.real || 0)) * Math.min(1, dt * 12);
      if (barber.real > 0.25) {
        barber.b.play(HS.walkOf(barber.body), { fade: 0.2, rate: barber.real / (1.6 * barber.b.height / 1.8) });
        barber.mode = 'move';
      } else if (barber.mode === 'move') {
        barber.mode = 'stand';
        barber.b.play(HS.idleOf(barber.body), { fade: 0.25 });
      }
    }
    barber.state = (barber.mode === 'walk' || barber.mode === 'move') ? 'walking' : (barber.ikWant ? 'cutting' : 'idle');
  }

  /* -----------------------------------------------------------
     WALK UP AND CUT: stand at a waiting client and press E / CUT
     ----------------------------------------------------------- */
  let nearC = null, interactEl = null;
  function updateInteract() {
    nearC = null;
    if (barber && !barber.auto && !barber.ikWant && !onBreak) {
      let best = 1.5;
      customers.forEach(function (c) {
        if (c.state !== 'seated' || !c.requested || c.cutting || c.servedBy !== 'player' || !c.station) return;
        const d = Math.min(Math.hypot(barber.pos.x - c.station.work.x, barber.pos.z - c.station.work.z),
                           Math.hypot(barber.pos.x - c.pos.x, barber.pos.z - c.pos.z) * 0.9);
        if (d < best) { best = d; nearC = c; }
      });
    }
    // the vendor, if he's closer than any client
    nearVendor = false;
    if (vendor && barber && !barber.auto && !barber.ikWant && vendor.phase !== 'out' && vendor.phase !== 'in') {
      const dv = Math.hypot(barber.pos.x - vendor.pos.x, barber.pos.z - vendor.pos.z);
      const dc = nearC ? Math.hypot(barber.pos.x - nearC.station.work.x, barber.pos.z - nearC.station.work.z) : 9;
      if (dv < 1.6 && dv < dc) { nearVendor = true; nearC = null; }
      if (vendorPanelOpen() && dv > 2.4) closeVendorPanel();
    } else if (vendorPanelOpen()) closeVendorPanel();
    // walked away from the client whose menu is open: put it away
    if (UI.isPickerActive() && !nearC && !(barber && barber.auto)) UI.hideStylePicker();
    if (!interactEl) return;
    const show = (!!nearC && !UI.isPickerActive()) || (nearVendor && !vendorPanelOpen());
    interactEl.hidden = !show;
    if (show) {
      const label = nearVendor
        ? (HS.Input.touch ? 'BUY · ' : '<kbd>E</kbd> Buy from ') + CONFIG.vendor.name
        : (HS.Input.touch ? 'CUT ' : '<kbd>E</kbd> Cut ') + nearC.name + (nearC.isRegular ? ' ★' : '');
      if (interactEl.dataset.label !== label) { interactEl.innerHTML = label; interactEl.dataset.label = label; }
    }
  }
  let nearVendor = false;
  function act() {
    if (nearVendor && !vendorPanelOpen()) {
      barber.vel = 0;
      if (barber.mode === 'move') { barber.mode = 'stand'; barber.b.play(HS.idleOf(barber.body), { fade: 0.3 }); }
      if (vendor.phase === 'linger') vendor.wait = Math.max(vendor.wait, 8);
      openVendorPanel();
      return true;
    }
    if (!nearC || UI.isPickerActive()) return false;
    barber.vel = 0;
    if (barber.mode === 'move') { barber.mode = 'stand'; barber.b.play(HS.idleOf(barber.body), { fade: 0.3 }); }
    UI.showStylePicker(nearC);
    return true;
  }
  function toggleView() {
    const m = HS.View.toggleMode();
    UI.toast(m === 'overview' ? 'Overview — press V for your barber' : 'Following your barber', 'neutral');
  }
  /* A gold mark on the floor where to stand for each of YOUR waiting clients. */
  function markFor(c) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 32), new THREE.MeshBasicMaterial({ color: 0xe6c866, transparent: true, opacity: 0.8, toneMapped: false, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(c.station.work.x, 0.015, c.station.work.z);
    HS.View.scene.add(m);
    c.mark = m;
  }

  /* SECOND BARBER — whichever character the player did NOT pick. Takes ~35% of
     clients as they sit (CONFIG.npcBarber.workloadShare) and cuts them itself.
     Set dressing: its cuts don't go through Economy. */
  function createNpcBarber() {
    const ch = gameState.barber.character === 'male' ? 'female' : 'male';
    const a = makeActor(HS.BARBERS[ch], 'barber npc-barber');
    a.speed = W3.barberSpeed * 0.95; a.phase = 2.1;
    a.scissors = scissors();
    place(a, S.barberSpots[1], Math.PI);
    a.character = ch; a.targetId = null; a.cutting = false; a.cutLeft = 0; a.attending = false;
    a.cooldown = rand(CONFIG.npcBarber.minIdleSeconds, CONFIG.npcBarber.maxIdleSeconds);
    npcBarber = a;
  }

  function npcCanTake(c) {
    return !!c && c.state === 'seated' && c.requested && !c.cutting && c.servedBy === 'npc';
  }
  function findNpcTarget() { return customers.find(npcCanTake) || null; }

  /* Done (or the client left): wait right where she is for the next one. She only heads back to
     her mark after a quiet spell (homeIn), instead of pacing to the front after every cut. */
  function npcStandDown(n) {
    n.targetId = null; n.cutting = false; n.attending = false; n.ikWant = 0; n.client = null;
    n.cooldown = rand(CONFIG.npcBarber.minIdleSeconds, CONFIG.npcBarber.maxIdleSeconds);
    n.homeIn = 9;
  }

  function updateNpcBarber(dt) {
    const n = npcBarber;
    if (!n) return;
    if (!onBreak) {
      const client = n.targetId ? getCustomerById(n.targetId) : null;
      if (n.cutting) {
        n.cutLeft -= dt;
        if (client && Math.random() < dt * 9) emitHair(headOf(client), 1);
        if (!client) npcStandDown(n);
        else if (n.cutLeft <= 0) {
          lastReact = { kind: chance(0.8) ? 'good' : 'bad', at: clock };
          sendCustomerHome(client, true);          // cosmetic: no money changes hands
          npcStandDown(n);
        }
      } else if (n.targetId) {
        if (!npcCanTake(client)) npcStandDown(n);
        else if (n.attending) {
          n.cutting = true;
          n.cutLeft = CONFIG.styles[client.requested].duration;
          n.client = client; n.ikWant = 1;
          client.cutting = true;
          client.bubble.classList.remove('show');
          setCustomerState(client, 'being-cut');
        }
      } else {
        n.cooldown -= dt;
        if (n.homeIn > 0 && n.mode === 'stand') {
          n.homeIn -= dt;
          const m = S.barberSpots[1];
          if (n.homeIn <= 0 && Math.hypot(n.pos.x - m.x, n.pos.z - m.z) > 0.3) walkTo(n, [m], null, Math.PI);
        }
        if (n.cooldown <= 0) {
          const target = findNpcTarget();
          if (target && target.station) {
            n.targetId = target.id;
            const st = target.station;
            walkTo(n, [st.work], function () { n.attending = true; }, yawTo(st.x - st.work.x, st.z - st.work.z));
          }
        }
      }
    }
    if (!stepWalk(n, dt) && n.faceYaw !== null) turnToward(n, n.faceYaw, dt, 6);
  }

  /* Both barbers meet at the front of the shop to talk — player-triggered, see Game.takeBreak(). */
  function startBreak() {
    onBreak = true;
    const a = S.breakSpots[0], b = S.breakSpots[1];
    UI.hideStylePicker();
    moveBarberTo(a, null, yawTo(b.x - a.x, b.z - a.z));
    if (npcBarber) {
      npcBarber.targetId = null; npcBarber.cutting = false; npcBarber.ikWant = 0; npcBarber.client = null;
      walkTo(npcBarber, [b], null, yawTo(a.x - b.x, a.z - b.z));
    }
  }
  function endBreak() {
    onBreak = false;
    if (barber) { barber.auto = false; barber.path = []; if (barber.mode === 'walk') { barber.mode = 'stand'; barber.b.play(HS.idleOf(barber.body), { fade: 0.3 }); } }
    if (npcBarber) {
      walkTo(npcBarber, [S.barberSpots[1]], null, Math.PI);
      npcBarber.cooldown = rand(CONFIG.npcBarber.minIdleSeconds, CONFIG.npcBarber.maxIdleSeconds);
    }
  }

  /* -----------------------------------------------------------
     VENDING MACHINE PATRONS — purely cosmetic wander-in/out.
     ----------------------------------------------------------- */
  function updateVendingVisitor(dt) {
    if (!vendingVisitor) {
      if (!gameState.revenueStreams.vending) return;
      vendingTimer -= dt;
      if (vendingTimer <= 0) {
        vendingTimer = rand(20, 45);
        const id = pickLoaded(HS.EXTRAS.slice().reverse(), randInt(0, 4));
        if (!id || sitters.some(s => s.body === id)) return;
        const v = makeActor(id, 'vending-visitor');
        place(v, S.outside, Math.PI);
        const mid = new THREE.Vector3(S.vendingSpot.x * 0.4, 0, S.vendingSpot.z - 1.2);
        walkTo(v, [S.door, S.inside, mid, S.vendingSpot], function () { v.linger = rand(3, 6); }, Math.PI / 2);
        vendingVisitor = v;
      }
      return;
    }
    const v = vendingVisitor;
    if (!stepWalk(v, dt)) {
      if (v.faceYaw !== null) turnToward(v, v.faceYaw, dt, 6);
      if (v.linger !== undefined) {
        v.linger -= dt;
        if (v.linger <= 0) {
          v.linger = undefined;
          walkTo(v, [new THREE.Vector3(S.vendingSpot.x * 0.4, 0, S.vendingSpot.z - 1.2), S.inside, S.door, S.outside], function () { v.gone = true; });
        }
      }
    }
    if (v.gone) { removeActor(v); vendingVisitor = null; }
  }

  /* -----------------------------------------------------------
     CUSTOMERS
     ----------------------------------------------------------- */
  function headOf(c) { c.b.root.updateMatrixWorld(true); return c.b.bonePos('Head', new THREE.Vector3()).add(new THREE.Vector3(0, 0.06, 0)); }

  function spawnCustomer() {
    if (!S) return null;
    // a free chair (and nobody already queuing for one), or else a free seat on the benches
    const waitingNow = customers.filter(c => c.state === 'waiting').length;
    const freeStation = waitingNow ? null : stations.find(s => !s.occupiedBy);
    const seat = freeStation ? null : (waitingNow < maxWaiting() ? waitSeats.find(s => !s.by) : null);
    if (!freeStation && !seat) return null;
    // next client in the rotation whose body has downloaded
    let key = null;
    for (let i = 0; i < HS.CLIENT_ORDER.length; i++) {
      const k = HS.CLIENT_ORDER[(npcCycle + i) % HS.CLIENT_ORDER.length];
      if (HS.Body.ready(HS.CLIENTS[k].body) && !customers.some(c => c.key === k)) { key = k; npcCycle += i + 1; break; }
    }
    if (!key) return null;
    const def = HS.CLIENTS[key];
    const a = makeActor(def.body, 'customer');
    a.el.innerHTML = '<div class="cust-bubble"></div>';
    const c = Object.assign(a, {
      id: 'c' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      key: key, name: def.name,
      bubble: a.el.querySelector('.cust-bubble'),
      state: 'arriving', station: freeStation, requested: null,
      patience: CONFIG.customers.patienceSeconds, served: false,
      isRegular: gameState.barber.regulars.indexOf(key) !== -1
    });
    place(c, S.outside.clone().add(new THREE.Vector3(rand(-0.4, 0.4), 0, 0)), Math.PI);
    if (freeStation) {
      freeStation.occupiedBy = c.id;
      walkTo(c, [S.door, S.inside, freeStation.aisle, freeStation.front], function () { seatInChair(c, freeStation); });
    } else {
      // every chair's taken: come in, take a seat on the bench and wait
      c.state = 'waiting'; c.station = null; c.waitSeat = seat; seat.by = c.id; c.queuedAt = clock;
      walkTo(c, [S.door, S.inside, seatFront(seat)], function () {
        sitDown(c, seat.p.x, seat.p.z, seat.yaw, seat.seatY, function () {
          if (c.state !== 'waiting') return;
          c.waitLeft = W3.benchPatience;
          waitBubble(c);
        });
      });
    }
    customers.push(c);
    if (c.isRegular) {
      c.el.classList.add('regular');
      regularRing(c);
      UI.toast(c.name + ' is back — regular client', 'good');
    }
    return c;
  }

  function setCustomerState(c, state) {
    if (c.state === state) return;
    c.state = state;
    if (state === 'being-cut' && !c.cape) cape(c);
  }

  function updateCustomers(dt) {
    for (let i = customers.length - 1; i >= 0; i--) {
      const c = customers[i];
      stepWalk(c, dt) || stepSit(c, dt);

      if (c.state === 'seated' && c.requested) {
        c.patience -= dt;
        const frac = clamp(c.patience / CONFIG.customers.patienceSeconds, 0, 1);
        c.bubble.style.setProperty('--patience', String(frac));
        c.bubble.classList.toggle('impatient', frac < 0.35);
        // a fidget now and then while they wait
        if (frac < 0.35 && c.mode === 'seated' && Math.random() < dt * 0.5) c.shake = 0.8;
        if (c.patience <= 0) {
          Economy.customerWalkedOut(c);
          sendCustomerHome(c, false);
        }
      }
      // after the cut: react in the chair, then stand and leave
      if (c.state === 'leaving' && c.mode === 'seated') {
        c.reactLeft = (c.reactLeft === undefined ? 1.0 : c.reactLeft) - dt;
        if (c.reactLeft <= 0) {
          const st = c.leaveFrom;
          standUp(c, st ? st.front : c.pos.clone(), function () {
            if (st && st.occupiedBy === c.id) st.occupiedBy = null;
            const path = st ? [st.aisle, S.inside, S.door, S.outside] : [S.inside, S.door, S.outside];
            walkTo(c, path, function () { c.gone = true; });
          });
        }
      }
      if (c.mode === 'seated' && c.b.cur === 'sitwin' && c.b.done) c.b.play('sit', { fade: 0.4 });
      if (c.gone) {
        if (c.leaveFrom && c.leaveFrom.occupiedBy === c.id) c.leaveFrom.occupiedBy = null;
        removeActor(c);
        customers.splice(i, 1);
      }
    }
  }

  /* The customer asks for a style; the PLAYER decides what to actually cut —
     unless this one goes to the cameo barber, who just gets on with it. */
  function requestStyle(c) {
    const style = pick(CONFIG.styleOrder);
    c.requested = style;
    c.patience = CONFIG.customers.patienceSeconds;
    const def = CONFIG.styles[style];
    c.bubble.innerHTML =
      '<span class="bubble-name">' + c.name + '</span>' +
      '<span class="bubble-ask">' + def.name + '?</span>';
    c.bubble.classList.add('show');
    c.servedBy = (npcBarberIsFree() && npcIsOwedWork()) ? 'npc' : 'player';
    workSplit[c.servedBy]++;
    // yours: walk over (the gold mark) and press E / CUT; the menu doesn't pop up on its own now
    if (c.servedBy === 'player') markFor(c);
  }

  function npcIsOwedWork() {
    const total = workSplit.player + workSplit.npc + 1;
    return workSplit.npc < CONFIG.npcBarber.workloadShare * total;
  }
  function npcBarberIsFree() {
    return !!npcBarber && !npcBarber.targetId && !npcBarber.cutting && npcBarber.cooldown <= 0 && !onBreak;
  }

  function sendCustomerHome(c, wasServed) {
    c.served = !!wasServed;
    if (c.bubble) c.bubble.classList.remove('show');
    // the chair stays theirs until they've stood up and stepped away
    c.leaveFrom = c.station;
    c.station = null;
    c.state = 'leaving';
    c.cutting = false;
    const r = lastReact && lastReact.at === clock ? lastReact.kind : (wasServed ? 'good' : 'bad');
    lastReact = null;
    // No celebration after a cut (user, 2026-10-16): a happy client just gets up and goes.
    // An unhappy one (or a walkout) still shakes their head first.
    if (c.mode === 'seated') {
      if (r !== 'good') c.shake = 1.1;
      else c.reactLeft = 0.4;
    } else {
      // not sat down yet (gave up on the way in): turn round and go
      walkTo(c, [S.inside, S.door, S.outside], function () { c.gone = true; });
      if (c.leaveFrom && c.leaveFrom.occupiedBy === c.id) c.leaveFrom.occupiedBy = null;
    }
    UI.hideStylePicker(c);
    UI.promptNext();
  }

  function activeCustomer() {
    return customers.find(c => c.state === 'seated' && c.requested &&
                               !c.cutting && c.servedBy !== 'npc') || null;
  }

  function getCustomerById(id) { return customers.find(c => c.id === id) || null; }

  /* -----------------------------------------------------------
     HAIRCUT SEQUENCE
     ----------------------------------------------------------- */
  function performCut(c, chosenStyle, onDone) {
    if (!c || c.cutting) return;
    c.cutting = true;
    UI.hideStylePicker(c);
    c.bubble.classList.remove('show');
    setCustomerState(c, 'being-cut');

    const st = c.station || stations.find(s => s.occupiedBy === c.id);
    const spot = st ? st.work : c.pos;
    // you're already standing by them: step onto the mark, then cut
    moveBarberTo(spot, function () {
      barber.client = c; barber.ikWant = 1;
      const def = CONFIG.styles[chosenStyle];
      // the vendor's pro clippers make your cuts 15% quicker
      const duration = def.duration * 1000 * (gameState.perks && gameState.perks.clippers ? 0.85 : 1);
      UI.showCutProgress(c, def, duration);
      HS.View.focus(headOf(c));
      barber.cutEnds = performance.now() + duration;
      setTimeout(function () {
        barber.ikWant = 0; barber.client = null; barber.cutEnds = 0; barber.auto = false;
        c.cutting = false;
        UI.hideCutProgress();
        HS.View.unfocus();
        onDone();
      }, duration);
    }, st ? yawTo(st.x - st.work.x, st.z - st.work.z) : null);
  }

  /* Celebration / frustration reactions (§5). */
  /* The 2D game's §5 reactions. The celebration after a good cut is gone (user, 2026-10-16); a
     bad one still gets a head shake. `cheer` / reactPose stay for anything that wants them later. */
  function reactBarber(kind) {
    if (!barber) return;
    lastReact = { kind: kind, at: clock };
    if (kind !== 'good') barber.shake = 1.0;
  }

  /* -----------------------------------------------------------
     SPAWNING
     ----------------------------------------------------------- */
  function updateArrivalWave(dt) {
    const cfg = CONFIG.customers;
    waveTimer -= dt;
    if (waveTimer <= 0) {
      waveActive = !waveActive;
      waveTimer = waveActive ? rand(cfg.waveDurationMin, cfg.waveDurationMax)
                              : rand(cfg.waveIntervalMin, cfg.waveIntervalMax);
    }
  }

  function updateSpawning(dt) {
    updateArrivalWave(dt);
    const rep = gameState.barber.reputation;
    const marketing = 1 + gameState.business.marketingTier * CONFIG.marketing.trafficPerTier;
    const traffic = eventModifier('traffic');
    let interval = CONFIG.customers.baseArrivalInterval - rep * CONFIG.customers.repArrivalBonus;
    interval = Math.max(CONFIG.customers.minArrivalInterval, interval);
    interval = interval / (marketing * traffic);
    if (waveActive) interval *= CONFIG.customers.waveIntervalMultiplier;
    spawnTimer += dt;
    if (spawnTimer >= interval) {
      spawnTimer = 0;
      spawnCustomer();
    }
  }

  /* -----------------------------------------------------------
     PER FRAME (poses after the clips, then the screen anchors)
     ----------------------------------------------------------- */
  const all = [];
  const scr = {};
  function frame(dt, paused) {
    if (!S) return;
    const t = performance.now() / 1000;
    all.length = 0;
    if (barber) all.push(barber);
    if (npcBarber) all.push(npcBarber);
    customers.forEach(c => all.push(c));
    sitters.forEach(s => all.push(s));
    if (vendingVisitor) all.push(vendingVisitor);
    if (vendor) all.push(vendor);
    const adt = paused ? 0 : dt;
    let doorBusy = false;
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      a.b.root.position.copy(a.pos); a.b.root.rotation.y = a.yaw;
      a.b.update(adt);
      if (a.kind.indexOf('barber') === 0 || a.kind.indexOf('barber') > 0) workPose(a, adt);
      if (a.kind === 'vendor') trayPose(a, adt);
      reactPose(a, adt);
      stepCape(a, adt);
      if (a.ring) { a.ring.position.set(a.pos.x, 0.012, a.pos.z); a.ring.rotation.z = t; }
      if (Math.abs(a.pos.z - S.door.z) < 1.1 && Math.abs(a.pos.x - S.door.x) < 1.2 && a.mode === 'walk') doorBusy = true;
      // hair falls while a cut is going
      if (!paused && a.ikWant && a.client && a.ik > 0.6 && Math.random() < adt * 14) emitHair(headOf(a.client), 1);
    }
    S.doorWant = doorBusy;
    if (!paused) stepHair(dt);
    // your clients' floor marks pulse until you get to them
    customers.forEach(function (c) {
      if (!c.mark) return;
      const live = c.state === 'seated' && !c.cutting && c.servedBy === 'player';
      if (!live) { HS.View.scene.remove(c.mark); c.mark = null; return; }
      const k = 1 + Math.sin(t * 5) * 0.12;
      c.mark.scale.set(k, k, k);
      c.mark.material.opacity = c === nearC ? 1 : 0.55 + Math.sin(t * 5) * 0.25;
    });
    if (barber) HS.View.follow(barber.pos);
    HS.View.frame(dt, t);
    // screen anchors over heads (customers carry the bubble / feedback / floaters)
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (a.kind !== 'customer' && a.kind !== 'vendor' && a.kind.indexOf('barber') !== 0) continue;
      a.b.root.updateMatrixWorld(true);
      const p = a.b.bonePos('Head', _a); p.y += 0.3;
      HS.View.project(p, scr);
      if (scr.behind) { a.el.style.display = 'none'; continue; }
      a.el.style.display = '';
      a.el.style.transform = 'translate(' + scr.x.toFixed(1) + 'px,' + scr.y.toFixed(1) + 'px)';
      a.el.style.zIndex = String(1000 - Math.round(scr.depth * 900));
      a.x = scr.x / HS.View.w * 100; a.y = scr.y / HS.View.h * 100;
    }
  }

  /* -----------------------------------------------------------
     PUBLIC
     ----------------------------------------------------------- */
  function init() {
    stageEl = document.getElementById('stage');
    actorsEl = document.getElementById('actors');
    HS.View.init(document.getElementById('view'), stageEl);
    hair = makeHair();
    HS.Input.init(stageEl, act, toggleView);
    interactEl = document.getElementById('interact');
    interactEl.addEventListener('click', function () { act(); });
    const vb = document.getElementById('btn-view');
    if (vb) vb.addEventListener('click', toggleView);
  }

  function clearPeople() {
    customers.forEach(removeActor); customers = [];
    sitters.forEach(removeActor); sitters = [];
    if (vendingVisitor) { removeActor(vendingVisitor); vendingVisitor = null; }
    if (vendor) { closeVendorPanel(); removeActor(vendor); vendor = null; vendorTimer = CONFIG.vendor.firstAfter; }
  }

  function start() {
    clearPeople();
    if (barber) { removeActor(barber); HS.View.scene.remove(barber.scissors); barber = null; }
    if (npcBarber) { removeActor(npcBarber); HS.View.scene.remove(npcBarber.scissors); npcBarber = null; }
    spawnTimer = 0;
    workSplit = { player: 0, npc: 0 };
    buildShop(true);
    createBarber();
    createNpcBarber();
  }

  /* Called when the player buys/upgrades — a new room, and everyone back on their marks. */
  function rebuild() {
    clearPeople();
    UI.hideStylePicker();
    buildShop(true);
    [barber, npcBarber].forEach(function (b, i) {
      if (!b) return;
      b.path = []; b.mode = 'stand'; b.ikWant = 0; b.ik = 0; b.client = null; b.faceYaw = null; b.auto = false; b.vel = 0;
      b.b.play(HS.idleOf(b.body), { fade: 0 });
      place(b, S.barberSpots[i], i === 0 ? 0 : Math.PI);
    });
    if (npcBarber) { npcBarber.targetId = null; npcBarber.cutting = false; npcBarber.attending = false; }
  }

  function update(dt) {
    if (!S) return;
    clock += dt;
    updateSpawning(dt);
    updateBarber(dt);
    updateNpcBarber(dt);
    updateCustomers(dt);
    updateWaiting(dt);
    updateVendor(dt);
    updateVendingVisitor(dt);
    updateInteract();
    if (gameState.revenueStreams.merchandise) setMerchStock(1 - gameState.weekProgress);
  }

  /* The 2D barber walked home by itself between clients; now you walk it, so nothing to do. */
  function idle() {}

  // Customers' x/y are their heads' last screen position in % of the stage, so callers that ask
  // "where on screen is x, y" (UI's floater fallback) get the right spot.
  function project(x, y) { return { left: x, top: y }; }

  return {
    init, start, update, rebuild, idle, frame, act, toggleView,
    spawnCustomer, performCut, sendCustomerHome, reactBarber,
    activeCustomer, getCustomerById, refreshShopDressing, setMerchStock,
    startBreak, endBreak, project,
    get barber() { return barber; },
    get npcBarber() { return npcBarber; },
    get customers() { return customers; },
    get stations() { return stations; },
    get vendor() { return vendor; },
    spawnVendor: function () { if (!vendor) spawnVendor(); return !!vendor; },   // (tests)
    get shop() { return S; }
  };
})();
