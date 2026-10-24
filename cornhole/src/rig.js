// A hidden "driver" skeleton, built in code and animated by hand. src/avatar.js copies its pose onto the player's own
// HopLobby avatar each frame (the same retarget Trick Shot uses), so there are no animation files to ship.
// The driver is a T-pose skeleton with Mixamo bone names, facing +Z, the character's right at -X. All angles in rad.
//   arm hanging down:        Rz(+90 deg) on the right arm, Rz(-90 deg) on the left
//   arm swinging forward:    Rx(-a)
//   elbow bent forward:      Ry(+f) on the right forearm, Ry(-f) on the left
//   leaning forward:         Rx(+a) on the spine;  leg swinging forward: Rx(-a)
(function (SB) {
  "use strict";
  const T = globalThis.THREE;
  const HALF = Math.PI / 2;

  // name, parent, offset from the parent (metres, T-pose, character faces +Z)
  const SPEC = [
    ["Hips", null, 0, 1.0, 0],
    ["Spine", "Hips", 0, 0.10, 0], ["Spine1", "Spine", 0, 0.14, 0], ["Spine2", "Spine1", 0, 0.14, 0],
    ["Neck", "Spine2", 0, 0.20, 0], ["Head", "Neck", 0, 0.10, 0],
    ["RightShoulder", "Spine2", -0.05, 0.14, 0], ["RightArm", "RightShoulder", -0.12, 0, 0], ["RightForeArm", "RightArm", -0.28, 0, 0], ["RightHand", "RightForeArm", -0.26, 0, 0],
    ["LeftShoulder", "Spine2", 0.05, 0.14, 0], ["LeftArm", "LeftShoulder", 0.12, 0, 0], ["LeftForeArm", "LeftArm", 0.28, 0, 0], ["LeftHand", "LeftForeArm", 0.26, 0, 0],
    ["RightUpLeg", "Hips", -0.09, -0.05, 0], ["RightLeg", "RightUpLeg", 0, -0.45, 0], ["RightFoot", "RightLeg", 0, -0.45, 0],
    ["LeftUpLeg", "Hips", 0.09, -0.05, 0], ["LeftLeg", "LeftUpLeg", 0, -0.45, 0], ["LeftFoot", "LeftLeg", 0, -0.45, 0]
  ];

  const qx = (a) => new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), a);
  const qy = (a) => new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), a);
  const qz = (a) => new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), a);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

  function create(color) {
    const root = new T.Group();
    const B = {};
    SPEC.forEach(function (s) {
      const o = new T.Object3D();
      o.name = s[0]; o.position.set(s[2], s[3], s[4]);
      (s[1] ? B[s[1]] : root).add(o);
      B[s[0]] = o;
    });
    root.updateMatrixWorld(true);
    const rig = {
      root: root, B: B, color: color, t: Math.random() * 10, walkPh: 0, avatar: null, mesh: null,
      bone: function (n) { return B[n]; },
      bindPose: function (fn) {
        const saved = SPEC.map(function (s) { return [B[s[0]].quaternion.clone(), B[s[0]].position.clone()]; });
        SPEC.forEach(function (s) { B[s[0]].quaternion.identity(); B[s[0]].position.set(s[2], s[3], s[4]); });
        root.updateMatrixWorld(true);
        try { fn(); } finally {
          SPEC.forEach(function (s, i) { B[s[0]].quaternion.copy(saved[i][0]); B[s[0]].position.copy(saved[i][1]); });
          root.updateMatrixWorld(true);
        }
      }
    };
    rig.mesh = standIn(B, color);
    root.add(rig.mesh);
    return rig;
  }

  // A plain figure for when an avatar can't be had (and while it loads).
  function standIn(B, color) {
    const g = new T.Group();
    g.parts = [];                                    // the pieces hang on the driver's bones, not on `g`: hide them one by one
    const skin = new T.MeshStandardMaterial({ color: 0xe0b48f, roughness: 0.8 }), cloth = new T.MeshStandardMaterial({ color: color, roughness: 0.85 }), pants = new T.MeshStandardMaterial({ color: 0x33415a, roughness: 0.9 });
    const seg = function (bone, to, r, mat) {
      const len = to.length();
      const m = new T.Mesh(new T.CylinderGeometry(r, r * 0.9, len, 10), mat);
      m.position.copy(to).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), to.clone().normalize());
      m.castShadow = true; bone.add(m); g.parts.push(m);
    };
    seg(B.Hips, new T.Vector3(0, 0.38, 0), 0.15, pants);
    seg(B.Spine, new T.Vector3(0, 0.4, 0), 0.17, cloth);
    ["Right", "Left"].forEach(function (s) {
      seg(B[s + "Arm"], B[s + "ForeArm"].position, 0.045, cloth); seg(B[s + "ForeArm"], B[s + "Hand"].position, 0.04, skin);
      seg(B[s + "UpLeg"], B[s + "Leg"].position, 0.07, pants); seg(B[s + "Leg"], B[s + "Foot"].position, 0.06, pants);
      const foot = new T.Mesh(new T.BoxGeometry(0.09, 0.07, 0.24), new T.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8 }));
      foot.position.set(0, -0.03, 0.06); foot.castShadow = true; B[s + "Foot"].add(foot); g.parts.push(foot);
    });
    const head = new T.Mesh(new T.SphereGeometry(0.115, 14, 12), skin);
    head.position.set(0, 0.1, 0); head.castShadow = true; B.Head.add(head); g.parts.push(head);
    return g;
  }

  // Pose the driver.  s = { walk 0..1, charge -1 (no) or 0..1 (power on the meter), throwT -1 or seconds since the click,
  //   cheer 0..1, slump 0..1, look (yaw of the head, rad), hand (bag in the hand: true/false) }
  // Returns the right hand's world position is read by the caller from B.RightHand.
  function pose(rig, s, dt) {
    const B = rig.B;
    rig.t += dt;
    const t = rig.t;
    rig.walkPh += dt * (3.2 + 4.2 * s.walk) * (s.walk > 0.02 ? 1 : 0);
    const wk = s.walk, ph = rig.walkPh;
    const breathe = Math.sin(t * 1.7) * 0.012, sway = Math.sin(t * 0.9) * 0.02;

    // --- the throwing arm: underhand swing.  ang = forward angle of the arm from hanging (negative = back).
    let ang = 0.10, el = 0.25, lean = 0.05, crouch = 0.0;
    const ch = s.charge, th = s.throwT;
    if (th >= 0) {                                    // swing: back -> forward over SWING, then follow through, then relax
      const SW = 0.16;
      if (th < SW) { const k = sstep(th / SW); ang = lerp(-0.95, 1.25, k); el = lerp(0.35, 0.05, k); lean = lerp(0.22, 0.05, k); crouch = lerp(0.8, 0.2, k); }
      else { const k = sstep((th - SW) / 0.22), r = sstep((th - 0.7) / 0.9); ang = lerp(1.25, 1.75, k) * (1 - r) + 0.10 * r; el = lerp(0.05, 0.12, k) * (1 - r) + 0.25 * r; lean = 0.05; crouch = 0.2 * (1 - r); }
    } else if (ch >= 0) {                             // winding up: the arm goes back as the meter fills
      const k = sstep(Math.min(1, ch * 0.5 + 0.5) * 0.9 + 0.1);
      ang = lerp(0.1, -0.95, k); el = lerp(0.25, 0.35, k); lean = lerp(0.05, 0.22, k); crouch = k * 0.8;
    } else if (s.aim) {                               // lining it up: bag held in front
      ang = 0.55 + Math.sin(t * 2) * 0.03; el = 0.9; lean = 0.08; crouch = 0.2;
    }

    // --- cheering / slumping (both arms) layer over the idle pose
    const cheer = s.cheer || 0, slump = s.slump || 0;
    const pump = Math.sin(t * 9) * 0.18 * cheer;
    const rArmZ = lerp(HALF * 0.93, -1.25 + pump, cheer) , lArmZ = lerp(-HALF * 0.93, 1.25 - pump, cheer);

    // right arm
    const useRight = th >= 0 || ch >= 0 || s.aim;
    const rz = useRight ? HALF * 0.9 : rArmZ;
    B.RightArm.quaternion.copy(qx(useRight ? -ang : -Math.sin(t * 1.3) * 0.04 - 0.05 * wk * Math.sin(ph + Math.PI) ).multiply(qz(rz)));
    B.RightForeArm.quaternion.copy(qy(useRight ? el : 0.25 + 0.2 * cheer));
    // left arm: balance, swinging opposite in a walk; up when cheering
    const lAng = useRight ? (th >= 0 ? -0.3 : 0.35) : 0.55 * wk * Math.sin(ph);
    B.LeftArm.quaternion.copy(qx(-lAng - Math.sin(t * 1.1 + 1) * 0.04).multiply(qz(useRight ? -HALF * 0.82 : lArmZ)));
    B.LeftForeArm.quaternion.copy(qy(useRight ? -0.5 : -(0.25 + 0.2 * cheer)));
    B.RightShoulder.quaternion.identity(); B.LeftShoulder.quaternion.identity();

    // --- legs: walk cycle, or a little crouch for the throw
    const swing = 0.62 * wk;
    const t1 = -swing * Math.sin(ph) - 0.14 * crouch, t2 = swing * Math.sin(ph) - 0.14 * crouch;               // thighs (forward = negative)
    const k1 = Math.max(0, swing * Math.sin(ph - 1.2)) * 1.2 + 0.30 * crouch, k2 = Math.max(0, -swing * Math.sin(ph + 1.9)) * 1.2 + 0.30 * crouch;
    B.RightUpLeg.quaternion.copy(qx(t1)); B.LeftUpLeg.quaternion.copy(qx(t2));
    B.RightLeg.quaternion.copy(qx(k1)); B.LeftLeg.quaternion.copy(qx(k2));
    B.RightFoot.quaternion.copy(qx(-(t1 + k1) * 0.5)); B.LeftFoot.quaternion.copy(qx(-(t2 + k2) * 0.5));
    // keep the feet on the ground: the hips drop by the amount the legs shortened
    const lenR = 0.45 * (Math.cos(t1) + Math.cos(t1 + k1)), lenL = 0.45 * (Math.cos(t2) + Math.cos(t2 + k2));
    const drop = 0.9 - Math.max(lenR, lenL);
    B.Hips.position.set(0, 1.0 - drop + Math.abs(Math.sin(t * 7.5)) * 0.1 * cheer + breathe * 0.4 - slump * 0.02, 0);

    // --- spine, head
    const wind = Math.sin(ph) * 0.07 * wk;
    B.Spine.quaternion.copy(qx(lean * 0.5 + slump * 0.18 + breathe).multiply(qy(wind)));
    B.Spine1.quaternion.copy(qx(lean * 0.3 + slump * 0.1));
    B.Spine2.quaternion.copy(qx(lean * 0.3 + slump * 0.1).multiply(qy(-wind * 0.7)));
    B.Neck.quaternion.copy(qy((s.look || 0) * 0.45).multiply(qx(-lean * 0.4 + slump * 0.12)));
    B.Head.quaternion.copy(qy((s.look || 0) * 0.55 + sway).multiply(qx(-0.05 + slump * 0.15 - lean * 0.2)));
    rig.root.updateMatrixWorld(true);
    if (rig.avatar) rig.avatar.follow();
  }

  SB.Rig = { create: create, pose: pose };
})(globalThis.SB = globalThis.SB || {});
