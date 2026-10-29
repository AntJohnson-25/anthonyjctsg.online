// The machines, modelled in code in each rider's colours:
//   inline skates (a boot each, following the rider's feet),
//   a full-suspension mountain bike (steering front end, spinning cranks),
//   a dirt bike (knobby tyres, gold forks, shrouds and number plates, the exhaust).
// Bikes are built in the body frame: -Z forward, y up, the origin on the ground between the tyres.
// anchors() gives the seat, grips and pedals/pegs in world space for the rider rig.
(function (RR) {
  "use strict";
  const T = window.THREE;
  RR.SKATE_H = 0.115;         // sole height above the ground on skates

  function lin(hex) { const c = new T.Color(hex); return [c.r, c.g, c.b]; }   // THREE.Color from hex is already linear
  function col(g, hex) { return RR.paintGeo(g, lin(hex), false); }
  const tube = RR.tube;

  function wheelGeo(r, tyre, knobby, rimHex, discR) {
    const parts = { rubber: [], metal: [] };
    const tg = new T.TorusGeometry(r - tyre, tyre, 10, 40); tg.rotateY(Math.PI / 2);
    parts.rubber.push(col(tg, 0x161616));
    if (knobby) {
      for (let k = 0; k < 44; k++) {
        const a = k / 44 * Math.PI * 2;
        [-1, 0, 1].forEach(function (row) {
          if (row && k % 2) return;
          const b = new T.BoxGeometry(tyre * 0.55, tyre * 0.4, tyre * 0.5);
          b.translate(row * tyre * 0.6, r - tyre * 0.12, 0); b.rotateX(a);
          parts.rubber.push(col(b, 0x1c1c1c));
        });
      }
    }
    const rim = new T.TorusGeometry(r - tyre * 2.05, tyre * 0.32, 6, 40); rim.rotateY(Math.PI / 2);
    parts.metal.push(col(rim, rimHex));
    const hub = new T.CylinderGeometry(0.035, 0.035, 0.12, 12); hub.rotateZ(Math.PI / 2);
    parts.metal.push(col(hub, 0x9a9da2));
    for (let k = 0; k < 28; k++) {
      const a = k / 28 * Math.PI * 2, side = k % 2 ? 0.03 : -0.03, R = r - tyre * 2.1;
      parts.metal.push(col(tube([side, 0, 0], [0, Math.cos(a) * R, Math.sin(a) * R], 0.0025, 0.0025, 3), 0xb8bcc2));
    }
    if (discR) { const d = new T.CylinderGeometry(discR, discR, 0.006, 24); d.rotateZ(Math.PI / 2); d.translate(-0.06, 0, 0); parts.metal.push(col(d, 0xc8ccd2)); }
    return parts;
  }

  function plateTex(num, bg, fg) {
    return RR.canvasTex(128, 128, function (g, w, h) {
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.font = "900 92px 'Lilita One', Impact, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.lineWidth = 8; g.strokeStyle = "#111"; g.strokeText(num, w / 2, h / 2 + 6);
      g.fillStyle = fg; g.fillText(num, w / 2, h / 2 + 6);
    });
  }

  function Vehicle(sport, liv, num) {
    this.sport = sport;
    this.group = new T.Group();
    this.wheels = [];
    this.anchor = {};
    const paint = new T.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.15, clearcoat: 0.7, clearcoatRoughness: 0.15 });
    const metal = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.85 });
    const rubber = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    this.mats = [paint, metal, rubber];
    const self = this;
    function mesh(parts, mat, parent) {
      if (!parts.length) return null;
      const m = new T.Mesh(RR.mergeGeo(parts), mat); m.castShadow = true; m.receiveShadow = true;
      (parent || self.group).add(m); return m;
    }
    function wheel(at, r, tyre, knobby, rimHex, discR, parent) {
      const w = wheelGeo(r, tyre, knobby, rimHex, discR), g = new T.Group();
      g.position.set(at[0], at[1], at[2]);
      mesh(w.rubber, rubber, g); mesh(w.metal, metal, g);
      (parent || self.group).add(g);
      self.wheels.push({ g: g, r: r });
      return g;
    }
    if (sport === "skate") { this.buildSkates(liv); return; }

    if (sport === "mtb") {
      const RA = [0, 0.36, 0.56], FA = [0, 0.36, -0.6], BB = [0, 0.31, 0.12], SC = [0, 0.8, 0.24], HT = [0, 0.93, -0.4], HB = [0, 0.76, -0.45];
      const P = [], M = [], R = [];
      P.push(col(tube(HB, BB, 0.03), liv.base), col(tube(HT, SC, 0.022), liv.base), col(tube(BB, SC, 0.024), liv.base), col(tube(HB, HT, 0.032), liv.base));
      // decal sleeve on the down tube
      P.push(col(tube([0, 0.66, -0.34], [0, 0.48, -0.1], 0.0315), liv.stripe));
      [-1, 1].forEach(function (s) {
        P.push(col(tube([s * 0.03, BB[1], BB[2]], [s * 0.055, RA[1], RA[2]], 0.015), liv.base));
        P.push(col(tube([s * 0.02, 0.74, 0.25], [s * 0.055, RA[1], RA[2]], 0.012), liv.base));
      });
      // rear shock
      M.push(col(tube([0, 0.62, 0.0], [0, 0.73, 0.22], 0.022), 0x2a2a2a), col(tube([0, 0.64, 0.05], [0, 0.7, 0.17], 0.03), liv.nose));
      // seatpost + saddle
      M.push(col(tube(SC, [0, 0.97, 0.3], 0.015), 0x222222));
      const sad = new T.SphereGeometry(0.09, 12, 8); sad.scale(0.8, 0.28, 1.6); sad.translate(0, 1.0, 0.31); R.push(col(sad, 0x111111));
      // drivetrain bits
      const ring = new T.TorusGeometry(0.09, 0.006, 4, 28); ring.rotateY(Math.PI / 2); ring.translate(0.05, BB[1], BB[2]); M.push(col(ring, 0x333333));
      const cas = new T.CylinderGeometry(0.06, 0.06, 0.04, 16); cas.rotateZ(Math.PI / 2); cas.translate(-0.06, RA[1], RA[2]); M.push(col(cas, 0x888888));
      mesh(P, paint); mesh(M, metal); mesh(R, rubber);
      wheel(RA, 0.37, 0.032, false, 0x222428, 0.09);
      // the front end turns about the head tube
      const front = this.front = new T.Group(); front.position.set(HB[0], HB[1], HB[2]);
      this.steerAxis = new T.Vector3(HT[0] - HB[0], HT[1] - HB[1], HT[2] - HB[2]).normalize();
      const o = function (p) { return [p[0] - HB[0], p[1] - HB[1], p[2] - HB[2]]; };
      const FP = [], FM = [], FR = [];
      [-1, 1].forEach(function (s) {
        FM.push(col(tube(o([s * 0.065, 0.78, -0.455]), o([s * 0.065, 0.58, -0.52]), 0.019), 0xd8b028));
        FP.push(col(tube(o([s * 0.065, 0.6, -0.515]), o([s * 0.065, FA[1], FA[2]]), 0.023), liv.rail));
      });
      FP.push(col(new T.BoxGeometry(0.17, 0.04, 0.06).translate(0, 0.78 - HB[1], -0.455 - HB[2]), liv.rail));
      FM.push(col(tube(o(HT), o([0, 0.99, -0.47]), 0.017), 0x222222));
      FM.push(col(tube(o([-0.38, 1.0, -0.48]), o([0.38, 1.0, -0.48]), 0.011), 0x222222));
      [-1, 1].forEach(function (s) { FR.push(col(tube(o([s * 0.26, 1.0, -0.48]), o([s * 0.38, 1.0, -0.48]), 0.017), 0x111111)); });
      mesh(FP, paint, front); mesh(FM, metal, front); mesh(FR, rubber, front);
      wheel(o(FA), 0.37, 0.032, false, 0x222428, 0.09, front);
      this.group.add(front);
      // cranks + pedals
      const crank = this.crank = new T.Group(); crank.position.set(BB[0], BB[1], BB[2]);
      const CP = [];
      [-1, 1].forEach(function (s) {
        const top = s > 0 ? [0, 0.17, 0] : [0, -0.17, 0];
        CP.push(col(tube([s * 0.075, 0, 0], [s * 0.075, top[1], top[2]], 0.012), 0x2a2a2a));
        CP.push(col(new T.BoxGeometry(0.1, 0.02, 0.09).translate(s * 0.13, top[1], top[2]), 0x333333));
      });
      mesh(CP, metal, crank);
      this.group.add(crank);
      this.anchor = { seat: new T.Vector3(0, 1.0, 0.31), grip: [new T.Vector3(-0.33, 1.0, -0.48), new T.Vector3(0.33, 1.0, -0.48)], pedalX: 0.13, crankR: 0.17, BB: new T.Vector3(BB[0], BB[1], BB[2]) };
      this.gripLocal = this.anchor.grip.map(function (g) { return new T.Vector3(g.x - HB[0], g.y - HB[1], g.z - HB[2]); });
    }

    if (sport === "moto") {
      const RA = [0, 0.42, 0.74], FA = [0, 0.44, -0.78], HT = [0, 1.0, -0.5], HB = [0, 0.8, -0.56];
      const P = [], M = [], R = [];
      // frame + swingarm + engine
      M.push(col(tube(HB, [0, 0.42, -0.08], 0.028), 0x3a3d42), col(tube(HT, [0, 0.9, 0.25], 0.026), 0x3a3d42), col(tube([0, 0.9, 0.25], [0, 0.98, 0.72], 0.018), 0x3a3d42));
      M.push(col(tube([0, 0.42, -0.08], [0, 0.5, 0.22], 0.026), 0x3a3d42), col(tube([0, 0.9, 0.25], [0, 0.5, 0.22], 0.026), 0x3a3d42));
      [-1, 1].forEach(function (s) { M.push(col(tube([s * 0.09, 0.52, 0.2], [s * 0.09, RA[1], RA[2]], 0.028), 0xb8bcc2)); });
      M.push(col(new T.BoxGeometry(0.26, 0.3, 0.36).translate(0, 0.52, -0.06), 0x2e3034));
      M.push(col(new T.BoxGeometry(0.2, 0.17, 0.2).translate(0, 0.74, -0.16), 0x55585e));
      const cc = new T.CylinderGeometry(0.11, 0.11, 0.03, 18); cc.rotateZ(Math.PI / 2); cc.translate(0.14, 0.5, -0.04); M.push(col(cc, 0x9aa0a8));
      // shock with its spring
      M.push(col(tube([0, 0.92, 0.18], [0, 0.56, 0.36], 0.018), 0x222222), col(tube([0, 0.86, 0.21], [0, 0.66, 0.31], 0.035), liv.nose));
      // exhaust: header round the right, silencer up under the seat
      M.push(col(tube([0.05, 0.72, -0.26], [0.14, 0.62, -0.14], 0.022), 0x8a6a4a), col(tube([0.14, 0.62, -0.14], [0.16, 0.66, 0.15], 0.022), 0x8a6a4a), col(tube([0.16, 0.66, 0.15], [0.16, 0.82, 0.38], 0.024), 0x8a6a4a));
      M.push(col(tube([0.165, 0.82, 0.36], [0.165, 0.95, 0.86], 0.055), 0xc8ccd2), col(tube([0.165, 0.95, 0.86], [0.165, 0.965, 0.9], 0.04), 0x222222));
      // pegs
      [-1, 1].forEach(function (s) { M.push(col(new T.BoxGeometry(0.1, 0.03, 0.06).translate(s * 0.17, 0.41, 0.1), 0x888888)); });
      // plastics: tank + shrouds, side panels, rear fender, seat
      const tank = new T.SphereGeometry(0.16, 16, 10); tank.scale(0.85, 0.65, 1.5); tank.translate(0, 0.96, -0.2); P.push(col(tank, liv.base));
      [-1, 1].forEach(function (s) {
        const sh = new T.BoxGeometry(0.035, 0.28, 0.4); sh.rotateX(-0.25); sh.translate(s * 0.15, 0.86, -0.32); P.push(col(sh, liv.base));
        const st = new T.BoxGeometry(0.036, 0.07, 0.38); st.rotateX(-0.25); st.translate(s * 0.153, 0.84, -0.31); P.push(col(st, liv.stripe));
        const sp = new T.BoxGeometry(0.035, 0.2, 0.36); sp.rotateX(0.18); sp.translate(s * 0.13, 0.88, 0.44); P.push(col(sp, 0xf2f2f0));
      });
      const rf = new T.BoxGeometry(0.2, 0.025, 0.55); rf.rotateX(-0.28); rf.translate(0, 1.02, 0.86); P.push(col(rf, liv.base));
      const seat = new T.BoxGeometry(0.22, 0.08, 0.78); seat.rotateX(-0.06); seat.translate(0, 1.01, 0.22); R.push(col(seat, 0x141414));
      mesh(P, paint); mesh(M, metal); mesh(R, rubber);
      // side number plates
      const ptex = plateTex(String(num), "#f2f2f0", liv.baseCss);
      [-1, 1].forEach(function (s) {
        const pl = new T.Mesh(new T.PlaneGeometry(0.3, 0.17), new T.MeshStandardMaterial({ map: ptex, roughness: 0.5 }));
        pl.position.set(s * 0.15, 0.885, 0.44); pl.rotation.set(0.18, s * Math.PI / 2, 0);
        self.group.add(pl); self.mats.push(pl.material);
      });
      wheel(RA, 0.42, 0.085, true, 0x1a1a1a, 0.11);
      // front end
      const front = this.front = new T.Group(); front.position.set(HB[0], HB[1], HB[2]);
      this.steerAxis = new T.Vector3(HT[0] - HB[0], HT[1] - HB[1], HT[2] - HB[2]).normalize();
      const o = function (p) { return [p[0] - HB[0], p[1] - HB[1], p[2] - HB[2]]; };
      const FP = [], FM = [], FR = [];
      [-1, 1].forEach(function (s) {
        FM.push(col(tube(o([s * 0.085, 1.04, -0.5]), o([s * 0.085, 0.72, -0.62]), 0.03), 0xd8a21a));
        FM.push(col(tube(o([s * 0.085, 0.74, -0.615]), o([s * 0.085, FA[1], FA[2]]), 0.034), 0x1c1c1e));
      });
      FM.push(col(new T.BoxGeometry(0.26, 0.04, 0.09).translate(0, 1.04 - HB[1], -0.5 - HB[2]), 0x9aa0a8));
      FM.push(col(new T.BoxGeometry(0.26, 0.04, 0.09).translate(0, 0.86 - HB[1], -0.56 - HB[2]), 0x9aa0a8));
      FM.push(col(tube(o([-0.41, 1.17, -0.48]), o([0.41, 1.17, -0.48]), 0.013), 0x2a2a2a));
      FM.push(col(tube(o([0, 1.06, -0.5]), o([0, 1.17, -0.48]), 0.02), 0x2a2a2a));
      FR.push(col(new T.BoxGeometry(0.2, 0.05, 0.05).translate(0, 1.19 - HB[1], -0.48 - HB[2]), 0x111111));
      [-1, 1].forEach(function (s) { FR.push(col(tube(o([s * 0.29, 1.17, -0.48]), o([s * 0.42, 1.17, -0.48]), 0.019), 0x111111)); });
      const ff = new T.BoxGeometry(0.15, 0.025, 0.62); ff.rotateX(0.32); ff.translate(0, 0.93 - HB[1], -0.88 - HB[2]); FP.push(col(ff, liv.base));
      mesh(FP, paint, front); mesh(FM, metal, front); mesh(FR, rubber, front);
      const fp = new T.Mesh(new T.PlaneGeometry(0.28, 0.24), new T.MeshStandardMaterial({ map: ptex, roughness: 0.5 }));
      // facing forward, leaning back toward the rider
      fp.position.set(0, 1.04 - HB[1], -0.6 - HB[2]); fp.rotation.order = "YXZ"; fp.rotation.set(-0.35, Math.PI, 0);
      front.add(fp); this.mats.push(fp.material);
      wheel(o(FA), 0.44, 0.075, true, 0x1a1a1a, 0.13, front);
      this.group.add(front);
      this.anchor = { seat: new T.Vector3(0, 1.05, 0.12), grip: [new T.Vector3(-0.36, 1.17, -0.48), new T.Vector3(0.36, 1.17, -0.48)], pegs: [new T.Vector3(-0.19, 0.43, 0.1), new T.Vector3(0.19, 0.43, 0.1)] };
      this.gripLocal = this.anchor.grip.map(function (g) { return new T.Vector3(g.x - HB[0], g.y - HB[1], g.z - HB[2]); });
    }
    this.group.traverse(function (o) { if (o.isMesh) { o.castShadow = true; } });
  }

  // ---------- inline skates: one boot per foot, toes +Z, the wheels' contact at y = 0 ----------
  Vehicle.prototype.buildSkates = function (liv) {
    const shell = new T.Shape();
    [[-0.095, 0.11], [-0.105, 0.3], [-0.09, 0.37], [0.04, 0.37], [0.07, 0.25], [0.1, 0.2], [0.18, 0.17], [0.215, 0.14], [0.21, 0.11]].forEach(function (p, i) { if (!i) shell.moveTo(p[0], p[1]); else shell.lineTo(p[0], p[1]); });
    shell.closePath();
    const parts = [];
    const sg = new T.ExtrudeGeometry(shell, { depth: 0.085, bevelEnabled: true, bevelSize: 0.014, bevelThickness: 0.014, bevelSegments: 3, curveSegments: 3 });
    sg.translate(0, 0, -0.0425); sg.rotateY(-Math.PI / 2);
    parts.push(col(sg, liv.base));
    // cuff and straps
    const cuff = new T.CylinderGeometry(0.068, 0.072, 0.07, 16, 1); cuff.translate(-0.0, 0.34, -0.03); parts.push(col(cuff, liv.rail));
    const strap = new T.BoxGeometry(0.12, 0.025, 0.14); strap.translate(0, 0.235, 0.05); parts.push(col(strap, liv.rail));
    // sole, frame rails, wheels
    parts.push(col(new T.BoxGeometry(0.09, 0.022, 0.3).translate(0, 0.1, 0.055), 0x1a1a1a));
    [-1, 1].forEach(function (s) { parts.push(col(new T.BoxGeometry(0.007, 0.055, 0.3).translate(s * 0.017, 0.06, 0.04), 0xc8ccd2)); });
    [-0.065, 0.01, 0.085, 0.16].forEach(function (z) {
      const w = new T.CylinderGeometry(0.04, 0.04, 0.024, 18); w.rotateZ(Math.PI / 2); w.translate(0, 0.04, z); parts.push(col(w, liv.nose));
      const h = new T.CylinderGeometry(0.016, 0.016, 0.027, 10); h.rotateZ(Math.PI / 2); h.translate(0, 0.04, z); parts.push(col(h, 0xd8dade));
    });
    const geo = RR.mergeGeo(parts);
    const mat = new T.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.2, clearcoat: 0.6 });
    this.mats.push(mat);
    this.skates = [new T.Mesh(geo, mat), new T.Mesh(geo, mat)];
    // the brake on the right heel
    const br = new T.Mesh(new T.BoxGeometry(0.05, 0.05, 0.06), new T.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }));
    br.position.set(0, 0.045, -0.115); this.skates[1].add(br);
    this.skates.forEach(function (m) { m.castShadow = true; m.matrixAutoUpdate = true; });
  };

  // per frame: wheels roll, the front end steers, the cranks turn
  Vehicle.prototype.update = function (dt, speed, steer, crankA) {
    for (let i = 0; i < this.wheels.length; i++) { const w = this.wheels[i]; w.g.rotation.x -= speed / w.r * dt; }
    if (this.front) this.front.quaternion.setFromAxisAngle(this.steerAxis, steer);
    if (this.crank) this.crank.rotation.x = -crankA;
  };
  // world anchors for the rig (the group's world matrix must be current)
  Vehicle.prototype.anchors = function (out) {
    const g = this.group, A = this.anchor;
    out.seat = g.localToWorld((out.seat || new T.Vector3()).copy(A.seat));
    out.gripL = this.front.localToWorld((out.gripL || new T.Vector3()).copy(this.gripLocal[0]));
    out.gripR = this.front.localToWorld((out.gripR || new T.Vector3()).copy(this.gripLocal[1]));
    if (this.sport === "mtb") {
      const a = this.crank.rotation.x;
      out.footR = g.localToWorld((out.footR || new T.Vector3()).set(A.pedalX, A.BB.y + Math.cos(a) * A.crankR, A.BB.z + Math.sin(a) * A.crankR));
      out.footL = g.localToWorld((out.footL || new T.Vector3()).set(-A.pedalX, A.BB.y - Math.cos(a) * A.crankR, A.BB.z - Math.sin(a) * A.crankR));
    } else {
      out.footL = g.localToWorld((out.footL || new T.Vector3()).copy(A.pegs[0]));
      out.footR = g.localToWorld((out.footR || new T.Vector3()).copy(A.pegs[1]));
    }
    return out;
  };
  // skates sit under the feet: sole frame from the rig's foot bones
  Vehicle.prototype.placeSkates = function (feet, ankleH) {
    const sk = this.skates, up = new T.Vector3();
    [[feet.L, feet.qL, sk[0]], [feet.R, feet.qR, sk[1]]].forEach(function (f) {
      up.set(0, 1, 0).applyQuaternion(f[1]);
      f[2].quaternion.copy(f[1]);
      f[2].position.copy(f[0]).addScaledVector(up, -(ankleH + RR.SKATE_H) + 0.01);
    });
  };
  Vehicle.prototype.setVisible = function (on) {
    this.group.visible = on;
    if (this.skates) this.skates.forEach(function (s) { s.visible = on; });
  };

  RR.Vehicle = Vehicle;
})(window.RR = window.RR || {});
