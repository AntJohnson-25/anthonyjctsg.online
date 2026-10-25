// Turkey Bowl 3D — procedural animation.
//
// A Pose is the hips position plus one quaternion per bone (rest rotations are
// identity, so a quaternion IS the bone's local rotation). Every animation in
// the game is a function that writes a Pose from time and a few parameters:
// there are no keyframe files. Arms and stances are placed with two-bone IK
// (hand and foot targets), runs are a phase-driven FK cycle.
//
// An Animator owns one character: it evaluates a base pose (stance, run,
// tackle...), lays an upper-body overlay on top when one is active (carrying
// the ball, a throw, a catch, a block), and cross-fades from whatever was on
// screen whenever the base changes, so nothing ever pops.
(function () {
  const G = typeof window !== "undefined" ? window : globalThis;
  const THREE = G.THREE || (typeof require !== "undefined" ? require("../vendor/three.min.js") : null);

  // Mirrors TBRig.B (rig.js) — duplicated so this file also loads in Node.
  const B = { hips: 0, spine: 1, chest: 2, head: 3, uaL: 4, faL: 5, uaR: 6, faR: 7,
    thL: 8, shL: 9, ftL: 10, thR: 11, shR: 12, ftR: 13 };
  const NB = 14;
  const UPPER = [B.spine, B.chest, B.head, B.uaL, B.faL, B.uaR, B.faR];
  const ARMS = [B.chest, B.head, B.uaL, B.faL, B.uaR, B.faR];
  const ARMS_ONLY = [B.uaL, B.faL, B.uaR, B.faR];

  const PI = Math.PI;
  const X_AXIS = new THREE.Vector3(1, 0, 0);
  const ONE = new THREE.Vector3(1, 1, 1);
  const _e = new THREE.Euler();
  const _q = new THREE.Quaternion();
  const _q2 = new THREE.Quaternion();
  const _m1 = new THREE.Matrix4();
  const _m2 = new THREE.Matrix4();
  const _m3 = new THREE.Matrix4();
  const _v = new THREE.Vector3();
  const _S = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const _E = new THREE.Vector3();
  const _u = new THREE.Vector3();
  const _w = new THREE.Vector3();
  const _x = new THREE.Vector3();
  const _y = new THREE.Vector3();
  const _t = new THREE.Vector3();
  const _pole = new THREE.Vector3();

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function easeOut(t) { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t); }
  function easeIn(t) { t = clamp(t, 0, 1); return t * t; }
  // Piecewise: value along keys [[t, v], ...] with smoothstep between.
  function keys(t, k) {
    if (t <= k[0][0]) return k[0][1];
    for (let i = 0; i < k.length - 1; i++) {
      if (t <= k[i + 1][0]) {
        const s = sstep((t - k[i][0]) / (k[i + 1][0] - k[i][0]));
        return k[i][1] + (k[i + 1][1] - k[i][1]) * s;
      }
    }
    return k[k.length - 1][1];
  }

  // ---- Pose -----------------------------------------------------------------

  function Pose() {
    this.hp = new THREE.Vector3();
    this.q = [];
    for (let i = 0; i < NB; i++) this.q.push(new THREE.Quaternion());
  }
  Pose.prototype.copy = function (o) {
    this.hp.copy(o.hp);
    for (let i = 0; i < NB; i++) this.q[i].copy(o.q[i]);
    return this;
  };
  Pose.prototype.reset = function (rig) {
    this.hp.copy(rig.rest[B.hips]);
    for (let i = 0; i < NB; i++) this.q[i].identity();
    return this;
  };
  // Mix `o` into this pose by t (0 keeps this, 1 becomes o), optionally only
  // for the listed bones.
  Pose.prototype.mix = function (o, t, bones) {
    if (t <= 0) return this;
    if (bones) {
      for (let i = 0; i < bones.length; i++) this.q[bones[i]].slerp(o.q[bones[i]], t);
    } else {
      this.hp.lerp(o.hp, t);
      for (let i = 0; i < NB; i++) this.q[i].slerp(o.q[i], t);
    }
    return this;
  };

  function E(pose, i, x, y, z) {
    _e.set(x || 0, y || 0, z || 0, "XYZ");
    pose.q[i].setFromEuler(_e);
  }
  // Rotate a bone further by an Euler, on top of what it has.
  function addE(pose, i, x, y, z) {
    _e.set(x || 0, y || 0, z || 0, "XYZ");
    _q.setFromEuler(_e);
    pose.q[i].multiply(_q);
  }

  // ---- IK -------------------------------------------------------------------

  // Two-bone IK in the limb's PARENT space. `pole` is where the elbow/knee
  // points. Arms bend with -rx (forearm toward local +Z), legs with +rx.
  function solve(pose, rig, upper, lower, target, pole, isLeg) {
    const m = rig.m;
    _S.copy(rig.rest[upper]);
    const L1 = isLeg ? m.thigh : m.upperArm;
    const L2 = isLeg ? m.shin : m.forearm + 0.05;
    _d.subVectors(target, _S);
    let dist = _d.length();
    if (dist < 1e-5) return;
    _d.multiplyScalar(1 / dist);
    dist = clamp(dist, Math.abs(L1 - L2) + 0.01, (L1 + L2) * 0.9985);
    _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
    if (_p.lengthSq() < 1e-8) {
      _p.set(0, 0, 1).addScaledVector(_d, -_d.z);
      if (_p.lengthSq() < 1e-8) _p.set(1, 0, 0);
    }
    _p.normalize();
    const cosA = clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    _E.copy(_S).addScaledVector(_d, L1 * cosA).addScaledVector(_p, L1 * sinA);
    _u.subVectors(_E, _S).normalize();
    // The side of the upper bone the target lies on.
    _w.copy(_d).multiplyScalar(dist);
    _w.addScaledVector(_u, -_w.dot(_u));
    if (_w.lengthSq() < 1e-10) _w.copy(_p).negate();
    _w.normalize();
    _y.copy(_u).negate();
    if (isLeg) _w.negate();
    _x.crossVectors(_y, _w);
    _m1.makeBasis(_x, _y, _w);
    pose.q[upper].setFromRotationMatrix(_m1);
    const cosB = clamp((L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2), -1, 1);
    const bend = PI - Math.acos(cosB);
    pose.q[lower].setFromAxisAngle(X_AXIS, isLeg ? bend : -bend);
  }

  // Chest frame in root space: T(hp)R(hips) T(spine)R(spine) T(chest)R(chest).
  function chestMatrix(pose, rig, out) {
    _m2.compose(pose.hp, pose.q[B.hips], ONE);
    _m3.compose(rig.rest[B.spine], pose.q[B.spine], ONE);
    out.multiplyMatrices(_m2, _m3);
    _m3.compose(rig.rest[B.chest], pose.q[B.chest], ONE);
    return out.multiply(_m3);
  }

  // Hand target. `side` +1 left / -1 right. Coordinates are written for the
  // LEFT hand and mirrored in x for the right, so one set of numbers gives a
  // symmetric pose. space "chest" (default) or "root".
  function arm(pose, rig, side, x, y, z, px, py, pz, space) {
    _t.set(x * side, y, z);
    _pole.set(px * side, py, pz);
    if (space === "root") {
      chestMatrix(pose, rig, _m1);
      _m1.invert();
      _t.applyMatrix4(_m1);
      _pole.transformDirection(_m1);
    }
    solve(pose, rig, side > 0 ? B.uaL : B.uaR, side > 0 ? B.faL : B.faR, _t, _pole, false);
  }

  // Foot target in ROOT space (x mirrored for the right foot). The knee
  // points along `pole` (hips space, mirrored). The foot is then turned flat
  // to the ground unless `toe` pitches it.
  function leg(pose, rig, side, x, y, z, px, py, pz, toe) {
    _t.set(x * side, y, z);
    _m2.compose(pose.hp, pose.q[B.hips], ONE).invert();
    _t.applyMatrix4(_m2);
    _pole.set((px || 0) * side, py || 0, pz === undefined ? 1 : pz);
    const th = side > 0 ? B.thL : B.thR;
    const sh = side > 0 ? B.shL : B.shR;
    const ft = side > 0 ? B.ftL : B.ftR;
    solve(pose, rig, th, sh, _t, _pole, true);
    // Flat foot: undo hips*thigh*shin.
    _q.copy(pose.q[B.hips]).multiply(pose.q[th]).multiply(pose.q[sh]).invert();
    _e.set(toe || 0, 0, 0, "XYZ");
    _q2.setFromEuler(_e);
    pose.q[ft].copy(_q).multiply(_q2);
  }

  // ---- base poses ------------------------------------------------------------

  function relaxedArms(pose, rig, t, seed, spread) {
    const m = rig.m;
    const ab = 0.07 + 0.2 * m.belly + 0.12 * Math.max(0, m.w - 1) + (spread || 0);
    const sway = 0.03 * Math.sin(t * 1.3 + seed);
    E(pose, B.uaL, 0.04 + sway, 0.05, ab);
    E(pose, B.faL, -0.25 - 0.05 * Math.sin(t * 0.9 + seed), 0, 0);
    E(pose, B.uaR, 0.04 - sway, -0.05, -ab);
    E(pose, B.faR, -0.25 - 0.05 * Math.sin(t * 0.8 + seed * 2), 0, 0);
  }

  function idle(pose, rig, t, p) {
    const m = rig.m;
    const s = p.seed || 0;
    pose.reset(rig);
    pose.hp.y = m.hipY - 0.012 + 0.004 * Math.sin(t * 1.9 + s);
    E(pose, B.hips, 0, 0.03 * Math.sin(t * 0.31 + s), 0.025 * Math.sin(t * 0.52 + s));
    E(pose, B.spine, 0.03, 0, -0.02 * Math.sin(t * 0.52 + s));
    E(pose, B.chest, 0.02 + 0.018 * Math.sin(t * 1.9 + s), 0, 0);
    E(pose, B.head, -0.03 + 0.04 * Math.sin(t * 0.37 + s), (p.look || 0) + 0.22 * Math.sin(t * 0.23 + s * 3), 0);
    relaxedArms(pose, rig, t, s);
    const w = 0.14 + 0.03 * m.w;
    leg(pose, rig, 1, w * 0.62, m.ankle, 0.02, 0.2, 0, 1);
    leg(pose, rig, -1, w * 0.62, m.ankle, -0.02, 0.2, 0, 1);
  }

  // Everything that crouches: hips height and lean, then feet planted by IK.
  function crouch(pose, rig, o) {
    const m = rig.m;
    pose.reset(rig);
    pose.hp.set(o.hx || 0, m.hipY * o.h, o.hz || 0);
    E(pose, B.hips, o.hrx || 0, o.hry || 0, o.hrz || 0);
    E(pose, B.spine, o.lean || 0, o.sry || 0, 0);
    E(pose, B.chest, o.chest || 0, o.cry || 0, 0);
    E(pose, B.head, -((o.lean || 0) + (o.chest || 0) + (o.hrx || 0)) * (o.look === undefined ? 0.85 : o.look), o.headY || 0, 0);
    const f = o.feet;
    leg(pose, rig, 1, f[0], m.ankle + (f[4] || 0), f[1], 0.35, 0, 1, f[5] || 0);
    leg(pose, rig, -1, f[2], m.ankle + (f[6] || 0), f[3], 0.35, 0, 1, f[7] || 0);
  }

  const STANCES = {
    // Center over the ball: wide, low, right hand on the ball.
    ol: function (pose, rig) {
      const m = rig.m;
      crouch(pose, rig, { h: 0.66, hz: -0.1, lean: 0.95, chest: 0.3, feet: [0.26, -0.02, 0.28, -0.1], look: 0.9 });
      arm(pose, rig, -1, 0.02, 0.1, 0.5, 0.4, 0.2, -1, "root");
      arm(pose, rig, 1, m.hipX + 0.08, m.hipY * 0.62, 0.3, 1, 0, -0.3, "root");
    },
    // Defensive lineman: three-point, weight forward, a hand in the grass.
    rush: function (pose, rig) {
      const m = rig.m;
      crouch(pose, rig, { h: 0.62, hz: -0.12, lean: 1.05, chest: 0.3, feet: [0.24, 0.08, 0.24, -0.28], look: 0.95 });
      arm(pose, rig, -1, 0.08, 0.06, 0.55, 0.4, 0.2, -1, "root");
      arm(pose, rig, 1, m.hipX + 0.1, m.hipY * 0.64, 0.24, 1, 0, -0.4, "root");
    },
    // Receiver: two-point, left foot up, eyes on the ball.
    wr: function (pose, rig) {
      crouch(pose, rig, { h: 0.88, lean: 0.42, chest: 0.12, feet: [0.12, 0.22, 0.14, -0.3], look: 0.6 });
      arm(pose, rig, 1, 0.16, -0.26, 0.22, 1, -0.3, -0.6);
      arm(pose, rig, -1, 0.14, -0.3, 0.12, 1, -0.3, -0.6);
    },
    te: function (pose, rig) {
      crouch(pose, rig, { h: 0.82, lean: 0.55, chest: 0.12, feet: [0.2, 0.1, 0.2, -0.16], look: 0.7 });
      arm(pose, rig, 1, 0.16, -0.24, 0.3, 1, -0.4, -0.5);
      arm(pose, rig, -1, 0.16, -0.24, 0.3, 1, -0.4, -0.5);
    },
    // Shotgun QB: hands out, ready for the snap.
    qb: function (pose, rig) {
      crouch(pose, rig, { h: 0.9, lean: 0.28, chest: 0.05, feet: [0.2, 0.03, 0.2, -0.06], look: 0.7 });
      arm(pose, rig, 1, 0.1, -0.02, 0.36, 1, -0.6, -0.2);
      arm(pose, rig, -1, 0.1, -0.02, 0.36, 1, -0.6, -0.2);
    },
    // Back: hands on thighs.
    rb: function (pose, rig) {
      const m = rig.m;
      crouch(pose, rig, { h: 0.8, lean: 0.62, chest: 0.12, feet: [0.2, 0.05, 0.2, -0.05], look: 0.75 });
      arm(pose, rig, 1, m.hipX + 0.06, m.hipY * 0.68, 0.24, 1, 0, -0.3, "root");
      arm(pose, rig, -1, m.hipX + 0.06, m.hipY * 0.68, 0.24, 1, 0, -0.3, "root");
    },
    // Corner: backpedal-ready, weight on the balls of the feet.
    cover: function (pose, rig) {
      crouch(pose, rig, { h: 0.82, lean: 0.45, chest: 0.1, feet: [0.18, -0.12, 0.2, 0.12], look: 0.75 });
      arm(pose, rig, 1, 0.14, -0.2, 0.28, 1, -0.5, -0.4);
      arm(pose, rig, -1, 0.14, -0.2, 0.28, 1, -0.5, -0.4);
    },
    // Linebacker: square, hands up to take on a block.
    lb: function (pose, rig) {
      crouch(pose, rig, { h: 0.8, lean: 0.4, chest: 0.1, feet: [0.24, 0.02, 0.24, -0.02], look: 0.8 });
      arm(pose, rig, 1, 0.14, 0.02, 0.32, 1, -0.6, -0.3);
      arm(pose, rig, -1, 0.14, 0.02, 0.32, 1, -0.6, -0.3);
    },
    // Safety: deep, hands on knees, reading the quarterback.
    contain: function (pose, rig) {
      const m = rig.m;
      crouch(pose, rig, { h: 0.84, lean: 0.55, chest: 0.1, feet: [0.2, 0.0, 0.2, 0.0], look: 0.8 });
      arm(pose, rig, 1, m.hipX + 0.07, m.hipY * 0.62, 0.22, 1, 0, -0.3, "root");
      arm(pose, rig, -1, m.hipX + 0.07, m.hipY * 0.62, 0.22, 1, 0, -0.3, "root");
    }
  };

  function stance(pose, rig, t, p) {
    (STANCES[p.stance] || STANCES.wr)(pose, rig);
    // Breathing and the odd shift of weight, so the line is not a photograph.
    const s = p.seed || 0;
    addE(pose, B.chest, 0.015 * Math.sin(t * 2.1 + s), 0, 0);
    addE(pose, B.head, 0, 0.08 * Math.sin(t * 0.5 + s), 0);
    pose.hp.y += 0.006 * Math.sin(t * 2.1 + s);
  }

  // Bent over in the huddle, hands on knees; the QB stands and calls it.
  function huddle(pose, rig, t, p) {
    if (p.caller) {
      idle(pose, rig, t, p);
      E(pose, B.spine, 0.25, 0, 0);
      E(pose, B.head, 0.1, 0.35 * Math.sin(t * 1.4), 0);
      arm(pose, rig, -1, 0.14, 0.02 + 0.06 * Math.sin(t * 5), 0.36, 1, -0.6, -0.2);
      return;
    }
    STANCES.rb(pose, rig);
    addE(pose, B.head, 0.35, 0, 0);
    pose.hp.y += 0.006 * Math.sin(t * 2 + (p.seed || 0));
  }

  // One knee down, as in the team photo; hands on the up knee or on the ball.
  function kneel(pose, rig, t, p) {
    const m = rig.m;
    pose.reset(rig);
    pose.hp.set(0, m.hipY * 0.6, -0.05);
    E(pose, B.hips, -0.05, 0, 0);
    E(pose, B.spine, 0.12, 0, 0);
    E(pose, B.chest, 0.04 + 0.015 * Math.sin(t * 1.9 + (p.seed || 0)), 0, 0);
    E(pose, B.head, -0.12, 0.12 * Math.sin(t * 0.4 + (p.seed || 0)), 0);
    // Left foot planted forward, right knee on the grass.
    leg(pose, rig, 1, 0.2, m.ankle, 0.42, 0, 0, 1);
    leg(pose, rig, -1, 0.18, 0.1, -0.5, 0, -1, 0.3, -1.1);
    if (p.ball) {
      arm(pose, rig, 1, 0.11, -0.2, 0.33, 1, -0.6, -0.3);
      arm(pose, rig, -1, 0.11, -0.2, 0.33, 1, -0.6, -0.3);
    } else {
      arm(pose, rig, 1, 0.22, m.hipY * 0.98, 0.38, 1, 0, -0.2, "root");
      arm(pose, rig, -1, 0.18, m.hipY * 0.62, 0.12, 1, 0, -0.2, "root");
    }
  }

  // The run cycle. p.speed yd/s, p.phase radians, p.fwd/p.side the direction of
  // travel in the character's frame (unit), p.lean accel lean.
  function locomotion(pose, rig, t, p) {
    const m = rig.m;
    const sp = p.speed || 0;
    if (sp < 0.35) { idle(pose, rig, t, p); return; }
    pose.reset(rig);
    const a = clamp(sp / 8.6, 0, 1.2);
    const walk = clamp(sp / 2.2, 0, 1);         // fade the cycle in from standing
    const ph = p.phase;
    const s = Math.sin(ph);
    const fwd = p.fwd === undefined ? 1 : p.fwd;
    const side = p.side || 0;
    const back = fwd < -0.2;
    const A = (0.28 + 0.5 * a) * walk * (back ? 0.7 : 1);
    const K = (0.3 + 1.2 * a) * walk * (back ? 0.6 : 1);

    pose.hp.y = m.hipY * (1 - 0.05 * a) + 0.03 * a * Math.cos(2 * ph) - (back ? 0.06 : 0);
    E(pose, B.hips, 0, 0.14 * a * s * fwd, 0.04 * a * Math.sin(ph + 1.2));
    // Legs swing along the direction of travel.
    const legs = [[B.thL, B.shL, B.ftL, 1, ph], [B.thR, B.shR, B.ftR, -1, ph + PI]];
    for (let i = 0; i < 2; i++) {
      const L = legs[i];
      const sn = Math.sin(L[4]);
      const cs = Math.cos(L[4]);
      const swing = A * sn;
      E(pose, L[0], -swing * fwd - 0.08 * a, 0, L[3] * 0.035 + swing * side * 0.75);
      const knee = (0.12 + 0.18 * a) * walk + K * Math.pow(Math.max(0, Math.cos(L[4] - 0.35)), 1.4);
      E(pose, L[1], knee, 0, 0);
      E(pose, L[2], -0.25 * a * cs * Math.max(0, fwd) - 0.05, 0, 0);
    }
    // Torso: lean into the run (less when backpedalling), counter-rotate.
    const lean = back ? 0.2 : (0.05 + 0.24 * a) * Math.max(0, fwd) + 0.1 * Math.abs(side) * a;
    E(pose, B.spine, lean + (p.lean || 0), -0.06 * a * s * fwd, -(p.bank || 0));
    E(pose, B.chest, 0.04 * a, -0.2 * a * s * fwd, 0);
    E(pose, B.head, -(lean + 0.04 * a) * 0.85, 0.12 * a * s * fwd, (p.bank || 0) * 0.5);
    // Arms pump opposite the legs.
    const AA = (0.35 + 0.8 * a) * walk;
    const ab = 0.1 + 0.15 * m.belly + 0.1 * Math.max(0, m.w - 1);
    E(pose, B.uaL, AA * s * (back ? 0.5 : 1), 0, ab + 0.05 * a);
    E(pose, B.faL, -(1.05 + 0.4 * a) - 0.25 * a * Math.max(0, -s), 0, 0);
    E(pose, B.uaR, -AA * s * (back ? 0.5 : 1), 0, -ab - 0.05 * a);
    E(pose, B.faR, -(1.05 + 0.4 * a) - 0.25 * a * Math.max(0, s), 0, 0);
  }

  // Tackles and falls. dir: +1 falls forward (prone), -1 backward (supine).
  function fall(pose, rig, t, p) {
    const m = rig.m;
    const fwd = p.dir >= 0;
    const T = p.dur || 0.5;
    const k = easeIn(t / T);
    const kk = easeOut(t / T);
    pose.reset(rig);
    const bounce = t > T ? 0.03 * Math.exp(-(t - T) * 9) * Math.abs(Math.sin((t - T) * 18)) : 0;
    const d = p.dist === undefined ? (fwd ? 0.75 : 0.55) : p.dist;
    pose.hp.set(0, lerp(m.hipY, 0.19, k) + bounce, (fwd ? 1 : -1) * d * kk);
    E(pose, B.hips, (fwd ? 1.42 : -1.38) * k, 0, 0);
    if (fwd) {
      E(pose, B.spine, -0.1 * k, 0, 0);
      E(pose, B.head, -0.95 * k, 0, 0);
      E(pose, B.thL, 0.1 * k, 0, 0.12);
      E(pose, B.thR, -0.05 * k, 0, -0.1);
      E(pose, B.shL, 0.5 * k, 0, 0);
      E(pose, B.shR, 0.9 * k, 0, 0);
      E(pose, B.ftL, 0.4 * k, 0, 0);
      E(pose, B.ftR, 0.4 * k, 0, 0);
      // Arms out front: reaching for the grass or stretching the ball.
      arm(pose, rig, 1, 0.2, 0.25 + 0.3 * k, 0.28, 1, 0, -0.6);
      arm(pose, rig, -1, 0.16, 0.3 + 0.3 * k, 0.32, 1, 0, -0.6);
    } else {
      E(pose, B.spine, 0.2 * k, 0, 0);
      E(pose, B.head, 0.55 * k, 0.2, 0);
      E(pose, B.thL, -0.7 * k, 0, 0.15);
      E(pose, B.thR, -0.3 * k, 0, -0.12);
      E(pose, B.shL, 1.1 * k, 0, 0);
      E(pose, B.shR, 0.4 * k, 0, 0);
      arm(pose, rig, 1, 0.4, 0.1, 0.02, 0, -1, 0);
      arm(pose, rig, -1, 0.36, 0.2, 0.06, 0, -1, 0);
    }
    // Getting up again, when asked to.
    if (p.rise && t > p.rise) {
      const r = sstep((t - p.rise) / 0.45);
      _pose2.reset(rig);
      crouchInto(_pose2, rig);
      pose.mix(_pose2, r);
    }
  }
  const _pose2 = new Pose();
  function crouchInto(pose, rig) {
    crouch(pose, rig, { h: 0.78, lean: 0.5, feet: [0.2, 0.05, 0.2, -0.1], look: 0.7 });
    relaxedArms(pose, rig, 0, 0, 0.1);
  }

  // The tackler: launch, wrap, land on top.
  function tackle(pose, rig, t, p) {
    const m = rig.m;
    pose.reset(rig);
    const k1 = easeOut(t / 0.22);
    const k2 = easeIn(clamp((t - 0.12) / 0.3, 0, 1));
    const d = p.dist === undefined ? 1.1 : p.dist;
    pose.hp.set(0, lerp(lerp(m.hipY, m.hipY * 0.7, k1), 0.22, k2), d * easeOut(t / 0.42));
    E(pose, B.hips, lerp(0.5 * k1, 1.45, k2), 0, 0);
    E(pose, B.spine, 0.25 * (1 - k2), 0, 0);
    E(pose, B.head, -0.9 * k2 - 0.3 * k1, 0.3, 0);
    E(pose, B.thL, lerp(-0.6 * k1, 0.15, k2), 0, 0.1);
    E(pose, B.thR, lerp(0.5 * k1, 0.05, k2), 0, -0.1);
    E(pose, B.shL, lerp(0.8, 0.6, k2), 0, 0);
    E(pose, B.shR, lerp(0.4, 0.9, k2), 0, 0);
    // Wrap up.
    const wrap = sstep((t - 0.1) / 0.2);
    arm(pose, rig, 1, lerp(0.35, 0.12, wrap), lerp(0.2, 0.12, wrap), lerp(0.35, 0.42, wrap), 1, -0.2, -0.4);
    arm(pose, rig, -1, lerp(0.35, 0.12, wrap), lerp(0.2, 0.18, wrap), lerp(0.35, 0.42, wrap), 1, -0.2, -0.4);
    if (p.rise && t > p.rise) {
      const r = sstep((t - p.rise) / 0.45);
      _pose2.reset(rig);
      crouchInto(_pose2, rig);
      pose.mix(_pose2, r);
    }
  }

  // Celebrations. Variants: 0 jump, 1 point to the sky, 2 turkey strut,
  // 3 wildcat claw, 4 dance, 5 spike-and-flex.
  function celebrate(pose, rig, t, p) {
    const m = rig.m;
    const v = p.variant || 0;
    const s = p.seed || 0;
    if (v === 0) {
      // Jumping with both arms up.
      const c = (t * 1.6 + s) % 1;
      const air = Math.max(0, Math.sin(c * PI * 2));
      idle(pose, rig, t, p);
      pose.hp.y = m.hipY - 0.12 * (1 - air) + 0.28 * air * air;
      E(pose, B.spine, 0.1 * (1 - air) - 0.08, 0, 0);
      E(pose, B.head, -0.25, 0, 0);
      leg(pose, rig, 1, 0.14, m.ankle + 0.25 * air * air, 0.02, 0.3, 0, 1, 0.4 * air);
      leg(pose, rig, -1, 0.14, m.ankle + 0.25 * air * air, -0.02, 0.3, 0, 1, 0.4 * air);
      arm(pose, rig, 1, 0.22, 0.72 + 0.05 * air, 0.05, 1, 0, 0);
      arm(pose, rig, -1, 0.22, 0.72 + 0.05 * air, 0.05, 1, 0, 0);
    } else if (v === 1) {
      // Point to the sky, then pound the chest.
      idle(pose, rig, t, p);
      E(pose, B.spine, -0.12, 0, 0);
      E(pose, B.head, -0.45, 0, 0);
      const phase = (t % 2.2);
      if (phase < 1.3) {
        arm(pose, rig, -1, 0.1, 0.85, 0.12, 1, 0, 0);
        arm(pose, rig, 1, 0.12, 0.8, 0.14, 1, 0, 0);
      } else {
        const hit = Math.abs(Math.sin((phase - 1.3) * 9));
        arm(pose, rig, -1, 0.02, 0.12, 0.2 + 0.08 * hit, 1, -1, -0.3);
        arm(pose, rig, 1, 0.3, -0.1, 0.1, 1, -1, -0.3);
      }
    } else if (v === 2) {
      // The turkey strut: elbows flapping, head bobbing, high knees.
      const ph = t * 7 + s;
      locomotion(pose, rig, t, { speed: 1.4, phase: t * 5 + s, fwd: 1, side: 0, seed: s });
      const flap = Math.sin(ph * 1.6);
      arm(pose, rig, 1, 0.1, 0.08, 0.02, 1, 0.3 + 0.9 * flap, -0.4);
      arm(pose, rig, -1, 0.1, 0.08, 0.02, 1, 0.3 + 0.9 * flap, -0.4);
      E(pose, B.head, -0.25 + 0.3 * Math.sin(ph), 0, 0);
      addE(pose, B.spine, 0.18, 0, 0);
    } else if (v === 3) {
      // The wildcat: crouch, claws up, swipe.
      const sw = Math.sin(t * 5 + s);
      crouch(pose, rig, { h: 0.78, lean: 0.35, chest: 0.05, feet: [0.28, 0.1, 0.28, -0.1], look: 0.9, cry: 0.2 * sw });
      arm(pose, rig, 1, 0.3 + 0.08 * sw, 0.45, 0.32 - 0.1 * sw, 1, -0.3, -0.5);
      arm(pose, rig, -1, 0.3 - 0.08 * sw, 0.45, 0.32 + 0.1 * sw, 1, -0.3, -0.5);
    } else if (v === 4) {
      // Dance: hip sway and arm pumps.
      idle(pose, rig, t, p);
      const b = Math.sin(t * 8 + s);
      pose.hp.x = 0.05 * b;
      pose.hp.y = m.hipY - 0.06 - 0.03 * Math.abs(b);
      E(pose, B.hips, 0, 0, 0.12 * b);
      E(pose, B.spine, 0.05, 0, -0.18 * b);
      E(pose, B.head, 0, 0, 0.1 * b);
      arm(pose, rig, 1, 0.28, 0.3 + 0.25 * Math.max(0, b), 0.2, 1, -1, 0);
      arm(pose, rig, -1, 0.28, 0.3 + 0.25 * Math.max(0, -b), 0.2, 1, -1, 0);
      leg(pose, rig, 1, 0.16 + 0.04 * b, m.ankle, 0.02, 0.4, 0, 1);
      leg(pose, rig, -1, 0.16 - 0.04 * b, m.ankle, -0.02, 0.4, 0, 1);
    } else {
      // Flex.
      idle(pose, rig, t, p);
      const f = 0.5 + 0.5 * Math.sin(t * 3 + s);
      E(pose, B.spine, -0.1, 0, 0);
      E(pose, B.head, -0.15, 0.4 * Math.sin(t * 0.9), 0);
      arm(pose, rig, 1, 0.34, 0.28 + 0.06 * f, 0.02, 0.2, -1, 0);
      arm(pose, rig, -1, 0.34, 0.28 + 0.06 * f, 0.02, 0.2, -1, 0);
    }
  }

  // The other side of a touchdown.
  function dejected(pose, rig, t, p) {
    const m = rig.m;
    idle(pose, rig, t * 0.6, p);
    E(pose, B.spine, 0.12, 0, 0);
    E(pose, B.head, 0.45 + 0.05 * Math.sin(t), 0.2 * Math.sin(t * 0.4 + (p.seed || 0)), 0);
    if ((p.variant || 0) % 2 === 0) {
      // Hands on hips.
      arm(pose, rig, 1, 0.16 * m.sx + 0.05, -0.3, -0.02, 1, 0.1, -0.7);
      arm(pose, rig, -1, 0.16 * m.sx + 0.05, -0.3, -0.02, 1, 0.1, -0.7);
    } else {
      // Hands on head.
      arm(pose, rig, 1, 0.1, 0.62, 0.02, 1, 0.3, 0);
      arm(pose, rig, -1, 0.1, 0.62, 0.02, 1, 0.3, 0);
      E(pose, B.head, -0.2, 0, 0);
    }
  }

  // In a lawn chair, hands in the lap; arms up and bouncing when p.cheer.
  function sit(pose, rig, t, p) {
    const m = rig.m;
    const s = p.seed || 0;
    pose.reset(rig);
    const bounce = p.cheer ? Math.abs(Math.sin(t * 7 + s)) * 0.05 : 0;
    pose.hp.set(0, 0.5 + bounce, -0.08);
    E(pose, B.hips, -0.12, 0, 0);
    E(pose, B.spine, p.cheer ? 0.05 : -0.05, 0, 0);
    E(pose, B.chest, 0.02 * Math.sin(t * 1.8 + s), 0, 0);
    E(pose, B.head, 0.05, 0.3 * Math.sin(t * 0.3 + s), 0);
    E(pose, B.thL, -1.45, 0, 0.12);
    E(pose, B.thR, -1.45, 0, -0.12);
    E(pose, B.shL, 1.35, 0, 0);
    E(pose, B.shR, 1.35, 0, 0);
    if (p.cheer) {
      const w = Math.sin(t * 9 + s);
      arm(pose, rig, 1, 0.24, 0.7 + 0.06 * w, 0.1, 1, 0, 0);
      arm(pose, rig, -1, 0.24, 0.7 - 0.06 * w, 0.1, 1, 0, 0);
    } else {
      arm(pose, rig, 1, 0.12, 0.62, 0.34, 1, -0.3, -0.5, "root");
      arm(pose, rig, -1, 0.12, 0.62, 0.34, 1, -0.3, -0.5, "root");
    }
    void m;
  }

  const BASES = {
    sit: sit,
    idle: idle,
    stance: stance,
    huddle: huddle,
    kneel: kneel,
    loco: locomotion,
    fall: fall,
    tackle: tackle,
    celebrate: celebrate,
    dejected: dejected
  };

  // ---- upper-body overlays ------------------------------------------------------
  // Each writes chest/head/arm bones on top of whatever the legs are doing.

  const OVER = {
    // Ball tucked under one arm; the other keeps pumping.
    carryR: function (pose, rig) {
      arm(pose, rig, -1, 0.1, 0.0, 0.2, 1, -0.4, -1);
    },
    carryL: function (pose, rig) {
      arm(pose, rig, 1, 0.1, 0.0, 0.2, 1, -0.4, -1);
    },
    // Two hands on the ball at the chest: the QB in the pocket.
    carry2: function (pose, rig) {
      arm(pose, rig, 1, 0.07, 0.06, 0.3, 1, -0.6, -0.2);
      arm(pose, rig, -1, 0.07, 0.06, 0.3, 1, -0.6, -0.2);
    },
    // The QB in the pocket: ball cocked by the right ear, left hand steadying it.
    // The same arm pose the throw winds up from, so the release has no hitch.
    carryQB: function (pose, rig) {
      arm(pose, rig, -1, 0.16, 0.2, 0.05, 1, -0.3, -0.6);
      arm(pose, rig, 1, 0.12, 0.07, 0.31, 1, -0.6, -0.3);
    },
    // Blocker or engaged defender: hands in the other man's chest.
    block: function (pose, rig, t, p) {
      const push = 0.04 * Math.sin(t * 9 + (p.seed || 0));
      addE(pose, B.spine, 0.35, 0, 0);
      E(pose, B.head, -0.4, 0, 0);
      arm(pose, rig, 1, 0.14, 0.14, 0.46 + push, 1, -1, -0.3);
      arm(pose, rig, -1, 0.14, 0.14, 0.46 - push, 1, -1, -0.3);
    },
    // Right-handed throw. The sim lets the ball go at t=0; the renderer keeps
    // it in the hand until RELEASE so the arm is seen to throw it.
    throw: function (pose, rig, t) {
      const k1 = 0.35 + 0.65 * sstep(t / 0.08);   // cock: starts at the carryQB pocket pose (k1 = 0.35)
      const k2 = sstep((t - 0.08) / 0.08);        // whip
      const k3 = sstep((t - 0.18) / 0.3);         // follow through and settle
      E(pose, B.chest, 0.05 + 0.25 * k2 - 0.2 * k3, lerp(-0.55 * k1, 0.55, k2) * (1 - k3 * 0.8), 0);
      E(pose, B.head, -0.1, lerp(0.5 * k1, -0.3, k2) * (1 - k3), 0);
      const x = lerp(lerp(0.12, 0.24, k1), lerp(0.1, -0.2, k3), k2);
      const y = lerp(lerp(0.1, 0.4, k1), lerp(0.42, -0.1, k3), k2);
      const z = lerp(lerp(0.2, -0.22, k1), lerp(0.42, 0.28, k3), k2);
      arm(pose, rig, -1, x, y, z, 1, lerp(-0.3, -1, k2), -0.6);
      // The glove hand points at the target, then tucks.
      arm(pose, rig, 1, lerp(0.12, 0.16, k1), lerp(0.05, 0.15, k1 * (1 - k3)), lerp(0.3, 0.42, k1 * (1 - k3)), 1, -0.6, -0.3);
    },
    handoff: function (pose, rig, t) {
      const k = sstep(t / 0.12) * (1 - sstep((t - 0.2) / 0.1));
      arm(pose, rig, -1, lerp(0.08, 0.34, k), lerp(0.05, -0.05, k), lerp(0.3, 0.12, k), 1, -0.5, -0.4);
      arm(pose, rig, 1, 0.08, 0.05, 0.3, 1, -0.6, -0.2);
      addE(pose, B.chest, 0, -0.3 * k, 0);
    },
    // Receptions by where the ball arrives from.
    catch_away: function (pose, rig, t) {
      const up = 1 - sstep((t - 0.22) / 0.16);
      E(pose, B.head, lerp(0.1, -0.7, up), 0, 0);
      arm(pose, rig, 1, 0.1, lerp(0.05, 0.62, up), lerp(0.24, 0.2, up), 1, 0, -0.5);
      arm(pose, rig, -1, 0.1, lerp(0.02, 0.62, up), lerp(0.2, 0.2, up), 1, 0, -0.5);
    },
    catch_toward: function (pose, rig, t) {
      const up = 1 - sstep((t - 0.22) / 0.16);
      E(pose, B.head, -0.15 * up, 0, 0);
      arm(pose, rig, 1, lerp(0.07, 0.1, up), lerp(0.05, 0.3, up), lerp(0.28, 0.42, up), 1, -0.8, 0);
      arm(pose, rig, -1, lerp(0.07, 0.1, up), lerp(0.05, 0.3, up), lerp(0.28, 0.42, up), 1, -0.8, 0);
    },
    catch_side: function (pose, rig, t, p) {
      const up = 1 - sstep((t - 0.22) / 0.16);
      const s = p.catchSide || 1;
      E(pose, B.head, -0.2 * up, 0.6 * s * up, 0);
      addE(pose, B.chest, 0, 0.3 * s * up, 0);
      arm(pose, rig, s, lerp(0.1, 0.4, up), lerp(0.05, 0.4, up), lerp(0.25, 0.2, up), 1, -0.3, -0.5);
      arm(pose, rig, -s, lerp(0.07, -0.05, up), lerp(0.05, 0.42, up), lerp(0.25, 0.4, up), 1, -0.3, -0.5);
    },
    // A hand up to knock the ball down.
    swat: function (pose, rig, t) {
      const k = sstep(t / 0.12);
      const down = sstep((t - 0.12) / 0.15);
      E(pose, B.head, -0.5 * (1 - down), 0, 0);
      arm(pose, rig, -1, 0.12, lerp(lerp(0.1, 0.78, k), 0.25, down), lerp(0.25, 0.45, down), 1, 0, -0.5);
      arm(pose, rig, 1, 0.26, 0.2, 0.2, 1, -1, -0.3);
    },
    // Arms windmilling for balance.
    stumble: function (pose, rig, t) {
      const w = Math.sin(t * 18);
      addE(pose, B.spine, 0.35, 0, 0.1 * w);
      arm(pose, rig, 1, 0.42, 0.1 + 0.15 * w, 0.2, 0.3, -1, 0);
      arm(pose, rig, -1, 0.42, 0.1 - 0.15 * w, 0.2, 0.3, -1, 0);
    },
    // Holding the ball up after an interception or a recovery.
    showball: function (pose, rig, t) {
      const k = sstep(t / 0.3);
      E(pose, B.head, -0.3 * k, 0, 0);
      arm(pose, rig, -1, lerp(0.1, 0.22, k), lerp(0.05, 0.78, k), lerp(0.25, 0.12, k), 1, 0, 0);
      arm(pose, rig, 1, lerp(0.12, 0.3, k), lerp(0.0, 0.3, k), 0.2, 1, -1, 0);
    },
    // Lunge arms for the human defender's tackle button.
    reach: function (pose, rig) {
      addE(pose, B.spine, 0.3, 0, 0);
      arm(pose, rig, 1, 0.16, 0.1, 0.5, 1, -0.5, -0.4);
      arm(pose, rig, -1, 0.16, 0.1, 0.5, 1, -0.5, -0.4);
    }
  };
  const OVER_BONES = {
    carryR: [B.uaR, B.faR], carryL: [B.uaL, B.faL], carry2: ARMS_ONLY, carryQB: ARMS_ONLY,
    block: UPPER, throw: ARMS, handoff: ARMS, catch_away: ARMS, catch_toward: ARMS,
    catch_side: ARMS, swat: ARMS, stumble: UPPER, showball: ARMS, reach: UPPER
  };

  // ---- Animator -------------------------------------------------------------------

  function Animator(rig, seed) {
    this.rig = rig;
    this.seed = seed || 0;
    this.out = new Pose().reset(rig);
    this.from = new Pose().reset(rig);
    this.base = new Pose().reset(rig);
    this.over = new Pose().reset(rig);
    this.baseKey = "";
    this.fadeT = 1;
    this.fadeDur = 0.2;
    this.overKey = "";
    this.overW = 0;
    this.overPrev = "";
    this.overPrevW = 0;
    this.prevOver = new Pose().reset(rig);
    this.t = 0;
  }

  // st: { base, key, t, fade, params, over, overT, overFade }
  // `key` identifies the base clip; a new key starts a cross-fade from the
  // last pose shown.
  Animator.prototype.update = function (dt, st) {
    const rig = this.rig;
    const p = st.params || {};
    p.seed = this.seed;
    this.t += dt;
    const key = st.key || st.base;
    if (key !== this.baseKey) {
      this.from.copy(this.out);
      this.baseKey = key;
      this.fadeT = 0;
      this.fadeDur = st.fade === undefined ? 0.2 : st.fade;
    }
    this.fadeT += dt;
    (BASES[st.base] || idle)(this.base, rig, st.t === undefined ? this.t : st.t, p);

    // Overlay: fades in over 0.1s (overFade) and out over 0.15s. A retired
    // overlay fades out from a snapshot while the next one fades in.
    const want = st.over || "";
    if (want !== this.overKey) {
      if (this.overKey) {
        this.overPrev = this.overKey;
        this.overPrevW = this.overW;
        this.prevOver.copy(this.over);
      }
      if (want && want === this.overPrev) {
        this.overW = this.overPrevW;
        this.overPrev = "";
        this.overPrevW = 0;
      } else {
        this.overW = 0;
      }
      this.overKey = want;
    }
    if (this.overKey) {
      this.overW = Math.min(1, this.overW + dt / (st.overFade || 0.1));
      this.over.copy(this.base);
      OVER[this.overKey](this.over, rig, st.overT || 0, p);
    }
    this.overPrevW = Math.max(0, this.overPrevW - dt / 0.15);

    const out = this.out;
    out.copy(this.base);
    if (this.overPrevW > 0 && this.overPrev) out.mix(this.prevOver, sstep(this.overPrevW), OVER_BONES[this.overPrev]);
    if (this.overKey) out.mix(this.over, sstep(this.overW), OVER_BONES[this.overKey]);
    if (this.fadeT < this.fadeDur) {
      const k = sstep(this.fadeT / this.fadeDur);
      // Blend from the frozen last pose toward the live one.
      _poseTmp.copy(this.from).mix(out, k);
      out.copy(_poseTmp);
    }
    // Look-at: a head turn toward something (the ball in the air), on top.
    if (st.lookYaw) {
      addE(out, B.head, st.lookPitch || 0, clamp(st.lookYaw, -1.1, 1.1), 0);
    }
    this.apply();
  };
  const _poseTmp = new Pose();

  Animator.prototype.apply = function () {
    const bones = this.rig.bones;
    const out = this.out;
    bones[0].position.copy(out.hp);
    for (let i = 0; i < NB; i++) bones[i].quaternion.copy(out.q[i]);
  };

  const TBAnim = {
    B: B, Pose: Pose, Animator: Animator, BASES: BASES, OVER: OVER,
    solve: solve, arm: arm, leg: leg, chestMatrix: chestMatrix,
    util: { clamp: clamp, lerp: lerp, sstep: sstep, keys: keys }
  };
  G.TBAnim = TBAnim;
  if (typeof module !== "undefined") module.exports = TBAnim;
})();
