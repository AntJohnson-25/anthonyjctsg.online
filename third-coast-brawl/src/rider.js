// The riding poses, built procedurally on any Mixamo rig every frame (the clip library has no
// skating or riding animation). Hips and chest are set from world-space frames, the legs and arms
// solve two-bone IK onto their targets:
//   SKATE: a speed-skater stride (push out to the side and back, recover under the hips), arms
//     swinging against the legs, hands behind the back in a tuck, knees tucked in the air.
//   MTB / MOTO: hands on the grips, feet on the pedals or pegs, seated or standing in the attack
//     position; the chest leans until the arms reach the bars.
// On top: punches, kicks, grabs (a skate grab, the MTB no-hander, the moto superman) and a cheer.
(function (RR) {
  "use strict";
  const T = window.THREE;
  const X = new T.Vector3(1, 0, 0), Y = new T.Vector3(0, 1, 0), NZ = new T.Vector3(0, 0, -1);

  const _m = new T.Matrix4(), _l = new T.Vector3(), _u = new T.Vector3();
  function frameQ(fwd, up, out) {
    _l.crossVectors(up, fwd).normalize();
    _u.crossVectors(fwd, _l);
    _m.makeBasis(_l, _u, fwd);
    return out.setFromRotationMatrix(_m);
  }
  RR.frameQ = frameQ;
  function V() { return new T.Vector3(); }
  function Qn() { return new T.Quaternion(); }

  const _dir = new T.Vector3();
  function twoBone(A, target, l1, l2, pole, K, F) {
    const dir = _dir.subVectors(target, A);
    let dist = dir.length();
    dir.multiplyScalar(1 / Math.max(dist, 1e-5));
    dist = Math.max(Math.abs(l1 - l2) + 1e-3, Math.min(l1 + l2 - 1e-4, dist));
    const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const perp = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
    K.copy(A).addScaledVector(dir, l1 * cosA).addScaledVector(perp, l1 * sinA);
    F.copy(A).addScaledVector(dir, dist);
  }

  function Rider(id) {
    const r = this.r = new RR.Runner(id);
    const B = this.B = {};
    r.bones.forEach(function (b) { B[b.name] = b; });
    const D = r.m.D, sc = this.sc = r.m.scale;
    const restL = this.restL = {}, restM = this.restM = {}, posM = {};
    const byName = {};
    D.bones.forEach(function (b) { byName[b.name] = b; restL[b.name] = new T.Quaternion().fromArray(b.q); });
    function model(name) {
      if (restM[name]) return;
      const b = byName[name];
      const par = b.parent >= 0 ? D.bones[b.parent].name : null;
      if (par) { model(par); restM[name] = restM[par].clone().multiply(restL[name]); posM[name] = new T.Vector3().fromArray(b.p).applyQuaternion(restM[par]).add(posM[par]); }
      else { restM[name] = restL[name].clone(); posM[name] = new T.Vector3().fromArray(b.p); }
    }
    D.bones.forEach(function (b) { model(b.name); });
    this.restMinv = {};
    for (const k in restM) this.restMinv[k] = restM[k].clone().invert();
    const len = function (n) { return B[n].position.length() * sc; };
    this.thigh = len("LeftLeg"); this.shin = len("LeftFoot");
    this.upper = len("LeftForeArm"); this.fore = len("LeftHand");
    this.legLen = this.thigh + this.shin;
    this.ankleH = Math.max(0.05, Math.min(0.14, posM.LeftFoot.y * sc));
    this.dirL = {};
    [["LeftUpLeg", "LeftLeg"], ["LeftLeg", "LeftFoot"], ["RightUpLeg", "RightLeg"], ["RightLeg", "RightFoot"],
     ["LeftArm", "LeftForeArm"], ["LeftForeArm", "LeftHand"], ["RightArm", "RightForeArm"], ["RightForeArm", "RightHand"]
    ].forEach(function (p) { this.dirL[p[0]] = B[p[1]].position.clone().normalize(); }, this);
    this.kneeL = {
      LeftUpLeg: new T.Vector3(0, 0, 1).applyQuaternion(restM.LeftUpLeg.clone().invert()),
      RightUpLeg: new T.Vector3(0, 0, 1).applyQuaternion(restM.RightUpLeg.clone().invert())
    };
    this.W = {};
    ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "LeftShoulder", "RightShoulder", "LeftArm", "RightArm",
     "LeftForeArm", "RightForeArm", "LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg", "LeftFoot", "RightFoot"
    ].forEach(function (n) { this.W[n] = Qn(); }, this);
    this.t = { fwd: V(), up: V(), right: V(), hf: V(), hu: V(), cf: V(), cu: V(), a: V(), b: V(), c: V(), d: V(), K: V(), F: V(),
      Qh: Qn(), Qc: Qn(), Qx: Qn(), Qy: Qn(), hq: Qn(), hqi: Qn(), hipsP: V(), j: V() };
    this.reach = 0.9;        // the chest pitch on a bike, adapted until the hands reach the bars
    this.feet = { L: V(), R: V(), qL: Qn(), qR: Qn() };
    r.play("idle", { loop: true });
  }

  Rider.prototype.childPos = function (parentPos, parentQ, child, out) {
    return out.copy(this.B[child].position).multiplyScalar(this.sc).applyQuaternion(parentQ).add(parentPos);
  };
  Rider.prototype.aim = function (name, parentW, dir, out) {
    out.copy(parentW).multiply(this.restL[name]);
    const cur = this.t.j.copy(this.dirL[name]).applyQuaternion(out);
    this.t.Qx.setFromUnitVectors(cur, dir);
    return out.premultiply(this.t.Qx);
  };
  Rider.prototype.setLocal = function (name, parentW) {
    this.B[name].quaternion.copy(parentW).invert().multiply(this.W[name]);
  };
  // a frame facing `fwd` pitched forward by `pitch` and rolled by `roll` about it
  function bodyFrame(fwd, up, right, pitch, roll, fOut, uOut) {
    fOut.copy(fwd).multiplyScalar(Math.cos(pitch)).addScaledVector(up, -Math.sin(pitch));
    uOut.copy(up).multiplyScalar(Math.cos(pitch)).addScaledVector(fwd, Math.sin(pitch));
    if (roll) uOut.addScaledVector(right, Math.sin(roll)).normalize();
  }

  Rider.prototype.setSpine = function (hipsP, Qh, Qc) {
    const W = this.W, spine = ["Spine", "Spine1", "Spine2"];
    let parW = W.Hips, parP = hipsP;
    for (let i = 0; i < 3; i++) {
      const n = spine[i];
      this.t.Qy.slerpQuaternions(Qh, Qc, (i + 1) / 3);
      W[n].copy(this.t.Qy).multiply(this.restM[n]);
      this.setLocal(n, parW);
      parP = this.childPos(parP, parW, n, new T.Vector3());
      parW = W[n];
    }
    return parP;
  };
  Rider.prototype.shoulderPos = function (chestPos, side) {
    const SH = side + "Shoulder", AR = side + "Arm";
    const shW = new T.Quaternion().copy(this.W.Spine2).multiply(this.B[SH].quaternion);
    const shP = this.childPos(chestPos, this.W.Spine2, SH, new T.Vector3());
    return { W: shW, P: this.childPos(shP, shW, AR, new T.Vector3()) };
  };
  Rider.prototype.leg = function (side, hipsP, target, pole, footFwd, footUp) {
    const W = this.W, t = this.t;
    const UL = side + "UpLeg", LG = side + "Leg", FT = side + "Foot";
    const hipJ = this.childPos(hipsP, W.Hips, UL, new T.Vector3());
    const K = new T.Vector3(), F = new T.Vector3();
    twoBone(hipJ, target, this.thigh, this.shin, pole, K, F);
    const dirT = new T.Vector3().subVectors(K, hipJ).normalize();
    W[UL].copy(t.Qh).multiply(this.restM[UL]);
    t.Qx.setFromUnitVectors(t.d.copy(this.dirL[UL]).applyQuaternion(W[UL]), dirT);
    W[UL].premultiply(t.Qx);
    const kc = t.d.copy(this.kneeL[UL]).applyQuaternion(W[UL]);
    kc.addScaledVector(dirT, -kc.dot(dirT)).normalize();
    const pd = pole.clone().addScaledVector(dirT, -pole.dot(dirT)).normalize();
    const ang = Math.atan2(t.a.crossVectors(kc, pd).dot(dirT), kc.dot(pd));
    t.Qx.setFromAxisAngle(dirT, ang);
    W[UL].premultiply(t.Qx);
    this.setLocal(UL, W.Hips);
    this.aim(LG, W[UL], new T.Vector3().subVectors(F, K).normalize(), W[LG]);
    this.setLocal(LG, W[UL]);
    frameQ(footFwd, footUp, t.Qy);
    W[FT].copy(t.Qy).multiply(this.restM[FT]);
    this.setLocal(FT, W[LG]);
  };
  Rider.prototype.arm = function (side, sh, dU, dF) {
    const W = this.W, AR = side + "Arm", FA = side + "ForeArm";
    W[side + "Shoulder"].copy(sh.W);
    this.aim(AR, sh.W, dU, W[AR]);
    this.setLocal(AR, sh.W);
    this.aim(FA, W[AR], dF, W[FA]);
    this.setLocal(FA, W[AR]);
  };
  // arm reaching for a point (grip, skate): returns [dU, dF]
  Rider.prototype.reachDirs = function (sh, target, pole) {
    const K = new T.Vector3(), F = new T.Vector3();
    twoBone(sh.P, target, this.upper, this.fore, pole, K, F);
    return [new T.Vector3().subVectors(K, sh.P).normalize(), new T.Vector3().subVectors(F, K).normalize()];
  };
  function blendDirs(a, b, k) { if (k <= 0) return a; a[0].lerp(b[0], k).normalize(); a[1].lerp(b[1], k).normalize(); return a; }

  // P: { mode, Q, pos, crouch, lean, t, air, stride:{phase, amp}, tuck, anchors:{seat, gripL, gripR, footL, footR},
  //      stand, grab, strike:{kind:"punch"|"kick", t, target, arm, style:"jab"|"hook"}, hit:{k, side}, cheer }
  Rider.prototype.pose = function (dt, P) {
    const r = this.r, W = this.W, t = this.t;
    r.update(dt);
    const fwd = t.fwd.copy(NZ).applyQuaternion(P.Q), up = t.up.copy(Y).applyQuaternion(P.Q), right = t.right.copy(X).applyQuaternion(P.Q);
    r.holder.updateWorldMatrix(true, false);
    r.holder.getWorldQuaternion(t.hq);
    t.hqi.copy(t.hq).invert();
    const crouch = P.crouch || 0, lean = P.lean || 0;
    const wob = Math.sin(P.t * 2.1) * 0.5 + Math.sin(P.t * 3.3) * 0.5;
    const skate = P.mode === "skate", moto = P.mode === "moto";
    const hipsP = t.hipsP;
    let hipPitch, chestPitch, roll = -lean * 0.35;
    const footT = { Left: new T.Vector3(), Right: new T.Vector3() }, footF = { Left: fwd.clone(), Right: fwd.clone() };
    const sides = ["Left", "Right"], sdOf = { Left: -1, Right: 1 };

    // ---- strike phases: c = cocked (the wind-up, chambered), e = extended (the hit), then a recovery.
    // The torso twists away while cocking and into the target on the hit; the head tracks the target.
    const K = P.strike || null, hitK = P.hit ? P.hit.k : 0;
    let c = 0, e = 0, tw = 0, tdir = null;
    if (K) {
      const W0 = 0.16, S0 = 0.1, R0 = 0.3, t0 = K.t;
      e = t0 < W0 * 0.7 ? 0 : t0 < W0 + S0 ? RR.smooth((t0 - W0 * 0.7) / (S0 + W0 * 0.3)) : t0 < W0 + S0 + 0.05 ? 1 : 1 - RR.smooth((t0 - (W0 + S0 + 0.05)) / R0);
      e = RR.clamp(e, 0, 1);
      c = t0 <= W0 + S0 ? RR.smooth(Math.min(1, t0 / W0)) * (1 - e) : 0;
      tdir = new T.Vector3().subVectors(K.target, P.pos); tdir.addScaledVector(up, -tdir.dot(up)).normalize();
      const aT = Math.atan2(tdir.dot(t.a.copy(right).negate()), tdir.dot(fwd));
      const kk = K.kind === "kick" ? 0.55 : 1;
      tw = (aT * 0.7 * e - Math.sign(aT) * 0.38 * c) * kk;
    }

    if (skate) {
      const a = P.stride ? P.stride.amp : 0, ph = P.stride ? P.stride.phase : 0;
      const push = { Left: Math.max(0, Math.sin(ph + Math.PI)), Right: Math.max(0, Math.sin(ph)) };
      const rec = { Left: Math.max(0, -Math.sin(ph + Math.PI)), Right: Math.max(0, -Math.sin(ph)) };
      const lift = RR.SKATE_H + this.ankleH;
      sides.forEach(function (S) {
        const sd = sdOf[S];
        if (P.air) {
          footT[S].copy(P.pos).addScaledVector(right, sd * 0.13).addScaledVector(up, lift + 0.28 * crouch).addScaledVector(fwd, 0.05);
        } else {
          footT[S].copy(P.pos).addScaledVector(right, sd * (0.12 + 0.3 * a * push[S]) - lean * 0.06)
            .addScaledVector(fwd, -0.12 * a * push[S] + 0.1 * a * rec[S]).addScaledVector(up, lift + 0.11 * a * rec[S]);
          const out = 0.4 * a * push[S] * sd;
          footF[S].copy(fwd).multiplyScalar(Math.cos(out)).addScaledVector(right, Math.sin(out));
        }
      });
      const shift = 0.07 * a * (push.Left - push.Right);
      const hipH = RR.SKATE_H + this.legLen * (0.88 - 0.3 * crouch) + 0.01 * wob;
      hipsP.copy(P.pos).addScaledVector(up, hipH).addScaledVector(fwd, -0.07 - 0.06 * crouch).addScaledVector(right, shift - lean * 0.1);
      if (P.air) hipsP.addScaledVector(up, 0.05);
      hipPitch = 0.35 + 0.3 * crouch; chestPitch = 0.62 + 0.3 * crouch + 0.04 * wob;
    } else {
      const A = P.anchors, st = P.stand;
      // seated: on the saddle; standing: over the pegs/pedals in the attack position
      const mid = t.a.copy(A.footL).add(A.footR).multiplyScalar(0.5);
      const seatH = t.b.copy(A.seat).addScaledVector(up, 0.11).addScaledVector(fwd, -0.03);
      const standH = t.c.copy(mid).addScaledVector(up, this.legLen * (0.74 - 0.16 * crouch)).addScaledVector(fwd, -0.14);
      hipsP.copy(seatH).lerp(standH, st);
      hipPitch = RR.lerp(moto ? 0.3 : 0.5, 0.65, st);
      chestPitch = this.reach;
      sides.forEach(function (S) {
        const sd = sdOf[S], ped = S === "Left" ? A.footL : A.footR;
        footT[S].copy(ped).addScaledVector(fwd, -0.08).addScaledVector(up, this.ankleH * 0.9).addScaledVector(right, sd * 0.02);
      }, this);
      // the superman: legs fly off the pegs, out behind
      if (P.grab > 0 && moto) sides.forEach(function (S) {
        const tg = new T.Vector3().copy(hipsP).addScaledVector(fwd, -this.legLen * 0.92).addScaledVector(up, 0.05).addScaledVector(right, sdOf[S] * 0.14);
        footT[S].lerp(tg, P.grab);
      }, this);
    }

    // ---- hips
    const hf = t.hf, hu = t.hu;
    bodyFrame(fwd, up, right, hipPitch, roll * 0.5, hf, hu);
    if (tw) { hf.applyAxisAngle(up, tw * 0.45); hu.applyAxisAngle(up, tw * 0.45); }
    frameQ(hf, hu, t.Qh);
    W.Hips.copy(t.Qh).multiply(this.restL.Hips);
    this.B.Hips.quaternion.copy(t.hqi).multiply(W.Hips);
    const hl = t.c.copy(hipsP);
    r.holder.worldToLocal(hl);
    this.B.Hips.position.copy(hl);

    // ---- chest (on a bike: lean until the hands reach the bars)
    const cf = t.cf, cu = t.cu;
    let chestPos;
    const doChest = function (pitch, act) {
      let pm = pitch, rl = roll;
      if (act) {
        // a kick leans the body back; a hit rocks the rider back and to the side
        if (K && K.kind === "kick") pm -= 0.4 * e;
        if (hitK > 0) { pm -= (skate ? 0.5 : 0.28) * hitK; rl += P.hit.side * 0.32 * hitK; }
      }
      bodyFrame(fwd, up, right, pm, rl, cf, cu);
      if (act && tw) { cf.applyAxisAngle(up, tw); cu.applyAxisAngle(up, tw); }
      frameQ(cf, cu, t.Qc);
      return this.setSpine(hipsP, t.Qh, t.Qc);
    }.bind(this);
    if (!skate) {
      const A = P.anchors, R = (this.upper + this.fore) * 0.93;
      const gm = new T.Vector3().copy(A.gripL).add(A.gripR).multiplyScalar(0.5);
      for (let it = 0; it < 2; it++) {
        chestPos = doChest(this.reach);
        const sL = this.shoulderPos(chestPos, "Left").P, sR = this.shoulderPos(chestPos, "Right").P;
        const d = sL.add(sR).multiplyScalar(0.5).distanceTo(gm);
        this.reach = RR.clamp(this.reach + (d - R) * 1.1, 0.15, 1.45);
      }
      chestPitch = this.reach;
    }
    chestPos = doChest(chestPitch, true);

    // ---- head: level, looking down the line (on the target while striking)
    const look = tdir ? t.b.copy(P.look || fwd).lerp(tdir, Math.min(1, (c + e) * 0.9)).normalize() : (P.look || fwd);
    t.d.copy(look).addScaledVector(up, -look.dot(up)).normalize();
    frameQ(t.d, up, t.Qy);
    t.Qx.slerpQuaternions(t.Qc, t.Qy, 0.5);
    W.Neck.copy(t.Qx).multiply(this.restM.Neck);
    this.setLocal("Neck", W.Spine2);
    W.Head.copy(t.Qy).multiply(this.restM.Head);
    this.setLocal("Head", W.Neck);

    // ---- kick: one leg lashes out at the target
    if (K && K.kind === "kick") {
      const S = K.arm, hipJ = this.childPos(hipsP, W.Hips, S + "UpLeg", new T.Vector3());
      const dir = new T.Vector3().subVectors(K.target, hipJ).normalize();
      // chamber: knee drawn up and across toward the target, foot tucked under it
      const flat = new T.Vector3().copy(tdir).multiplyScalar(0.3);
      const chamber = new T.Vector3().copy(hipJ).add(flat).addScaledVector(up, -this.legLen * 0.46);
      footT[S].lerp(chamber, c);
      footT[S].lerp(new T.Vector3().copy(hipJ).addScaledVector(dir, this.legLen * 0.97), e);
      footF[S].lerp(dir, e).normalize();
    }

    // ---- legs
    sides.forEach(function (S) {
      const sd = sdOf[S];
      const pole = new T.Vector3().copy(fwd).addScaledVector(right, sd * (skate ? 0.15 : moto ? 0.08 : 0.22)).addScaledVector(up, 0.1);
      const fu = skate || P.air ? up : up;
      this.leg(S, hipsP, footT[S], pole, footF[S], fu);
    }, this);

    // ---- arms
    const inside = new T.Vector3().copy(right).multiplyScalar(-lean);
    sides.forEach(function (S) {
      const sd = sdOf[S], sh = this.shoulderPos(chestPos, S);
      let dirs;
      if (skate) {
        const a = P.stride ? P.stride.amp : 0, ph = P.stride ? P.stride.phase : 0;
        const swing = Math.sin(ph + (S === "Left" ? 0 : Math.PI)) * a;
        const dU = new T.Vector3().copy(up).multiplyScalar(-0.85).addScaledVector(fwd, 0.75 * swing).addScaledVector(right, sd * 0.22).addScaledVector(inside, 0.25).normalize();
        const dF = new T.Vector3().copy(dU).addScaledVector(fwd, 0.45 + 0.3 * Math.max(0, swing)).addScaledVector(right, -sd * 0.25 * Math.max(0, swing)).normalize();
        dirs = [dU, dF];
        // tuck: hands folded behind the back
        const tk = (P.tuck || 0) * (1 - a);
        if (tk > 0) {
          const bU = new T.Vector3().copy(up).multiplyScalar(-0.55).addScaledVector(fwd, -0.65).addScaledVector(right, sd * 0.25).normalize();
          const bF = new T.Vector3().copy(right).multiplyScalar(-sd * 0.9).addScaledVector(up, 0.3).addScaledVector(fwd, -0.2).normalize();
          blendDirs(dirs, [bU, bF], tk);
        }
        if (P.air) {
          const aU = new T.Vector3().copy(right).multiplyScalar(sd * 0.8).addScaledVector(up, -0.3).addScaledVector(fwd, 0.3).normalize();
          blendDirs(dirs, [aU, new T.Vector3().copy(aU).addScaledVector(fwd, 0.6).normalize()], 0.7);
        }
        // grab: the left hand to the left skate
        if (P.grab > 0 && S === "Left") {
          const tg = new T.Vector3().copy(footT.Left).addScaledVector(fwd, 0.08).addScaledVector(right, -0.05);
          blendDirs(dirs, this.reachDirs(sh, tg, new T.Vector3().copy(right).multiplyScalar(-1).addScaledVector(up, 0.3)), P.grab);
        }
      } else {
        const A = P.anchors, grip = S === "Left" ? A.gripL : A.gripR;
        const pole = moto ? new T.Vector3().copy(right).multiplyScalar(sd).addScaledVector(up, 0.35).addScaledVector(fwd, -0.25)
          : new T.Vector3().copy(right).multiplyScalar(sd * 0.8).addScaledVector(up, -0.35).addScaledVector(fwd, -0.3);
        dirs = this.reachDirs(sh, grip, pole);
        // the MTB no-hander: arms flung out wide
        if (P.grab > 0 && !moto) {
          const oU = new T.Vector3().copy(right).multiplyScalar(sd).addScaledVector(up, 0.45).addScaledVector(fwd, 0.1).normalize();
          blendDirs(dirs, [oU, new T.Vector3().copy(oU).addScaledVector(up, 0.4).normalize()], P.grab);
        }
        if (P.cheer > 0 && S === "Right") {
          const cU = new T.Vector3().copy(up).multiplyScalar(0.9).addScaledVector(right, 0.3).normalize();
          blendDirs(dirs, [cU, up.clone()], P.cheer);
        }
      }
      if (K && K.kind === "punch") {
        const hook = K.style === "hook";
        if (S === K.arm) {
          // cocked: fist drawn back by the ribs (jab) or elbow flared wide (hook); then the hit
          const cU = hook ? new T.Vector3().copy(right).multiplyScalar(sd * 0.95).addScaledVector(fwd, 0.1).addScaledVector(up, -0.2).normalize()
            : new T.Vector3().copy(up).multiplyScalar(-0.5).addScaledVector(fwd, -0.55).addScaledVector(right, sd * 0.35).normalize();
          const cF = hook ? new T.Vector3().copy(fwd).multiplyScalar(0.75).addScaledVector(right, -sd * 0.3).addScaledVector(up, 0.2).normalize()
            : new T.Vector3().copy(fwd).multiplyScalar(0.8).addScaledVector(up, 0.5).addScaledVector(right, -sd * 0.1).normalize();
          blendDirs(dirs, [cU, cF], c);
          const pole = hook ? new T.Vector3().copy(right).multiplyScalar(sd).addScaledVector(up, 0.35) : new T.Vector3().copy(right).multiplyScalar(sd * 0.5).addScaledVector(up, -0.6);
          blendDirs(dirs, this.reachDirs(sh, K.target, pole), e);
        } else if (skate) {
          // the guard hand: up by the chin
          const gU = new T.Vector3().copy(up).multiplyScalar(-0.35).addScaledVector(fwd, 0.55).addScaledVector(right, sd * 0.35).normalize();
          const gF = new T.Vector3().copy(up).multiplyScalar(0.75).addScaledVector(fwd, 0.5).addScaledVector(right, -sd * 0.15).normalize();
          blendDirs(dirs, [gU, gF], Math.min(1, (c + e) * 0.9));
        }
      }
      // hit reaction: the arms fling out as the rider rocks back
      if (hitK > 0 && skate) {
        const hU = new T.Vector3().copy(right).multiplyScalar(sd * 0.85).addScaledVector(up, 0.35).addScaledVector(fwd, -0.2).normalize();
        blendDirs(dirs, [hU, new T.Vector3().copy(hU).addScaledVector(up, 0.3).normalize()], hitK * 0.85);
      }
      if (P.cheer > 0 && skate) {
        const cU = new T.Vector3().copy(up).multiplyScalar(0.9).addScaledVector(fwd, sd * 0.2).addScaledVector(right, sd * 0.25).normalize();
        blendDirs(dirs, [cU, up.clone()], P.cheer);
      }
      this.arm(S, sh, dirs[0], dirs[1]);
    }, this);
  };

  // world frames of the feet (sole under the ankle, toes along +Z): what the skates follow
  Rider.prototype.footFrames = function () {
    const B = this.B, f = this.feet;
    ["Left", "Right"].forEach(function (S) {
      const b = B[S + "Foot"], P = S === "Left" ? f.L : f.R, Q = S === "Left" ? f.qL : f.qR;
      b.getWorldPosition(P);
      b.getWorldQuaternion(Q);
      Q.multiply(this.restMinv[S + "Foot"]);
    }, this);
    return f;
  };

  RR.Rider = Rider;
})(window.RR = window.RR || {});
