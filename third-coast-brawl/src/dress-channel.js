// SHIP CHANNEL SCRAMBLE dressing: the drop-down starting gate, container canyon and the yard
// beyond, the freeway overhead with its graffiti pillars and the mud pit underneath, the refinery
// (distillation columns, tank farm, pipe racks, flare stacks burning), tyre walls on the bends,
// hay bales, feather flags, the levee, the channel with a cargo ship and gantry cranes.
(function (RR) {
  "use strict";
  const T = window.THREE;
  RR.DRESS = RR.DRESS || {};

  function corrugated(col, label) {
    return RR.canvasTex(256, 128, function (g, w, h) {
      g.fillStyle = col; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 8) { g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(x, 0, 3, h); g.fillStyle = "rgba(255,255,255,0.08)"; g.fillRect(x + 4, 0, 2, h); }
      RR.blotch(g, w, h, 10, "rgba(90,40,10,0.25)", 6, 26);
      g.strokeStyle = "rgba(0,0,0,0.35)"; g.lineWidth = 3; g.strokeRect(2, 2, w - 4, h - 4);
      if (label) { g.font = "900 22px 'Lilita One', Impact, sans-serif"; g.fillStyle = "rgba(255,255,255,0.85)"; g.fillText(label, 18, 34); }
    });
  }
  function graffiti(seed) {
    const rnd = RR.rng(seed);
    return RR.canvasTex(256, 512, function (g, w, h) {
      g.fillStyle = "#9b958c"; g.fillRect(0, 0, w, h);
      RR.speckle(g, w, h, 5000, ["#8a857c", "#a8a298", "#7e786f"], 1, 2, rnd);
      const cols = ["#ff3b6b", "#2bd9ff", "#ffd23f", "#7a2bd9", "#2bd96a", "#ff7a1a"];
      for (let k = 0; k < 7; k++) {
        g.strokeStyle = cols[Math.floor(rnd() * cols.length)]; g.lineWidth = 8 + rnd() * 10; g.lineCap = "round";
        g.beginPath(); let x = rnd() * w, y = 120 + rnd() * 300; g.moveTo(x, y);
        for (let i = 0; i < 5; i++) { x += (rnd() - 0.5) * 120; y += (rnd() - 0.5) * 80; g.quadraticCurveTo(x + 30, y - 40, x, y); }
        g.stroke();
      }
      g.font = "900 64px 'Lilita One', Impact, sans-serif"; g.textAlign = "center";
      g.lineWidth = 8; g.strokeStyle = "#111"; g.fillStyle = cols[seed % cols.length];
      const tag = ["H-TOWN", "3RD WARD", "EAST END", "713", "NO BRAKES", "BRAWL"][seed % 6];
      g.save(); g.translate(w / 2, 260); g.rotate(-0.2); g.strokeText(tag, 0, 0); g.fillText(tag, 0, 0); g.restore();
    });
  }

  RR.DRESS.moto = function (W, q, rnd) {
    const tr = W.track, S = W.S, P = W.P, root = W.root, HW = tr.halfW, C = S.corners;
    const inR = function (s, r) { return s >= r[0] && s <= r[1]; };
    const steel = new T.MeshStandardMaterial({ color: 0x8c9096, roughness: 0.4, metalness: 0.8 });
    const dark = new T.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5, metalness: 0.6 });
    const white = new T.MeshStandardMaterial({ color: 0xdcdcd6, roughness: 0.55, metalness: 0.3 });

    // ---- the starting gate: a row of steel gates that drop forward on GO
    {
      const gates = [], gp = tr.at(S.gate, 0), g0 = W.ground(gp.x, gp.z, Math.round(S.gate));
      const frame = new T.Group();
      frame.position.set(gp.x, g0, gp.z); frame.rotation.y = gp.yaw;
      const beam = new T.Mesh(new T.BoxGeometry(2 * HW + 1, 0.16, 0.16), dark); beam.position.set(0, 0.1, 0.15); frame.add(beam);
      const gateMat = new T.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.35, metalness: 0.7 });
      const n = 8, gw = (2 * HW) / n;
      for (let k = 0; k < n; k++) {
        const piv = new T.Group(); piv.position.set(-HW + gw * (k + 0.5), 0.1, 0);
        const plate = new T.Mesh(new T.BoxGeometry(gw - 0.12, 0.55, 0.05), gateMat); plate.position.y = 0.3; piv.add(plate);
        const bar = new T.Mesh(new T.BoxGeometry(gw - 0.12, 0.05, 0.08), dark); bar.position.y = 0.58; piv.add(bar);
        frame.add(piv); gates.push(piv);
      }
      frame.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      root.add(frame);
      let dropT = -1;
      W.startGate = { drop: function () { dropT = 0; }, reset: function () { dropT = -1; gates.forEach(function (g) { g.rotation.x = 0; }); } };
      W.anim.push(function (t, dt) {
        if (dropT < 0) return;
        dropT += dt;
        gates.forEach(function (g, k) { g.rotation.x = -Math.min(Math.PI / 2 - 0.05, Math.pow(Math.max(0, dropT - k * 0.01) * 5, 2)); });
      });
    }

    // ---- containers: the canyon walls and the yard beyond
    const ccols = ["#a63a24", "#1f4f8a", "#2a7a46", "#d8d4c8", "#e07a1a", "#5a5e66", "#8a2a4a", "#c8a21a"];
    const cmats = ccols.map(function (c, k) { return new T.MeshStandardMaterial({ map: corrugated(c, k % 3 === 0 ? "THIRD COAST LINES" : k % 3 === 1 ? "BAYOU CITY FREIGHT" : ""), roughness: 0.7, metalness: 0.35 }); });
    const cGeo = new T.BoxGeometry(2.44, 2.59, 12.2); cGeo.translate(0, 1.295, 0);
    const cl = ccols.map(function () { return []; });
    function stack(x, z, y, yaw, hgt) { for (let h = 0; h < hgt; h++) cl[Math.floor(rnd() * ccols.length)].push([x, y + h * 2.6, z, yaw + (rnd() - 0.5) * 0.02]); }
    for (let s = S.containers[0]; s < S.containers[1]; s += 12.6) [-1, 1].forEach(function (sd) {
      for (let row = 0; row < 3; row++) {
        const p = tr.at(s, sd * (HW + 2.9 + row * 2.6)), y = W.ground(p.x, p.z) - 0.05;
        stack(p.x, p.z, y, p.yaw, 1 + Math.floor(rnd() * (row ? 3 : 2)) + (row === 2 ? 1 : 0));
      }
    });
    for (let k = 0; k < 140; k++) {
      const s = S.containers[0] - 120 + rnd() * (S.containers[1] - S.containers[0] + 260), lat = (rnd() < 0.5 ? -1 : 1) * (HW + 22 + rnd() * 120);
      const p = tr.at(s, lat), i = tr.nearestAny(p.x, p.z);
      if (Math.abs(tr.lateral(p.x, p.z, i)) < HW + 16) continue;
      stack(p.x, p.z, W.course.far(p.x, p.z) - 0.1, p.yaw + (rnd() < 0.3 ? Math.PI / 2 : 0), 1 + Math.floor(rnd() * 4));
    }
    cmats.forEach(function (m, k) { P.instanced(cGeo, m, cl[k]); });
    if (RR.DETAIL && RR.DETAIL.containers) RR.DETAIL.containers(W, [].concat.apply([], cl));
    P.gate(S.containers[0] - 8, "CONTAINER CANYON", "#1f4f8a", "#3a8ad0", HW + 2.6, { h: 7 });

    // ---- the whoops
    P.gate(S.whoops[0] - 10, "WHOOPS", "#c22a1c", "#ff7a2a", HW + 2.2, { h: 6.5 });

    // ---- the freeway overhead, graffiti pillars, the mud pit beneath
    {
      const o0 = S.overpass[0] - 30, o1 = S.overpass[1] + 30;
      const conc = new T.MeshStandardMaterial({ color: 0xa8a298, roughness: 0.85, side: T.DoubleSide });
      [9.5, 10.6].forEach(function (y) { P.strip(o0, o1, 0, 34, conc, y); });
      [-1, 1].forEach(function (sd) { P.fence(o0, o1, sd * 17, 9.5, 11.8, conc, 8, 3); });
      const gmats = [graffiti(1), graffiti(2), graffiti(3), graffiti(4), graffiti(5)].map(function (t) { return new T.MeshStandardMaterial({ map: t, roughness: 0.85 }); });
      let k = 0;
      for (let s = o0 + 10; s < o1; s += 24, k++) [-1, 1].forEach(function (sd) {
        const p = P.at(s, sd * (HW + 2.2)), y0 = tr.elev(s) - 1, h = 10.6 - (p.y - tr.elev(s)) + 1;
        const m = new T.Mesh(new T.BoxGeometry(1.6, h, 1.6), gmats[(k + (sd > 0 ? 2 : 0)) % gmats.length]);
        m.position.set(p.x, y0 + h / 2, p.z); m.rotation.y = p.yaw; m.castShadow = true; m.receiveShadow = true;
        root.add(m);
        W.obstacles.push({ x: p.x, z: p.z, r: 1.15 });
        const cap = new T.Mesh(new T.BoxGeometry(2 * HW + 9, 1.2, 2.2), conc); cap.position.set(tr.at(s, 0).x, tr.elev(s) + 9.0, tr.at(s, 0).z); cap.rotation.y = p.yaw;
        if (sd > 0) root.add(cap);
      });
      // traffic up on the deck
      if (RR.carGeometry) {
        const carMat = new T.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.4, clearcoat: 0.8 });
        [[0.75, 0.1, 0.1], [0.85, 0.85, 0.85], [0.1, 0.12, 0.3], [0.08, 0.08, 0.09]].forEach(function (c, j) {
          const list = [];
          for (let s = o0 + 8 + j * 9; s < o1 - 6; s += 40 + rnd() * 30) { const lane = [-12, -7.5, 7.5, 12][Math.floor(rnd() * 4)], p = tr.at(s, lane); list.push([p.x, W.ground(p.x, p.z) + 10.62, p.z, p.yaw + (lane > 0 ? Math.PI : 0)]); }
          P.instanced(RR.carGeometry(c), carMat, list);
        });
      }
      W.waterAlong(S.mud[0] + 2, S.mud[1] - 2, -(HW - 1.2), HW - 1.2, tr.elev((S.mud[0] + S.mud[1]) / 2) - 0.12, RR.waterMaterial(0x3e2c1c, 0.82));
      P.gate(S.mud[0] - 10, "MUD PIT", "#5a3a1c", "#9a6a2a", HW + 3, { h: 6 });
    }

    // ---- the refinery
    {
      const r0 = S.refinery[0], r1 = S.refinery[1];
      const cols = [], tanks = [], flares = [];
      for (let k = 0; k < 26; k++) {
        const s = r0 + rnd() * (r1 - r0), sd = rnd() < 0.5 ? -1 : 1, lat = sd * (HW + 40 + rnd() * 130);
        const p = tr.at(s, lat), i = tr.nearestAny(p.x, p.z);
        if (Math.abs(tr.lateral(p.x, p.z, i)) < HW + 30) continue;
        const pick = rnd(), y = W.course.far(p.x, p.z) - 0.2;
        if (pick < 0.45) cols.push([p.x, y, p.z, rnd() * 6, 1, 0.7 + rnd() * 0.8]);
        else if (pick < 0.85) tanks.push([p.x, y, p.z, 0, 0.7 + rnd() * 0.8, 0.8 + rnd() * 0.4]);
        else flares.push([p.x, y, p.z]);
      }
      // a distillation column: shell, platform rings, a ladder cage, a top cap (60 m at scaleY 1)
      const colParts = [RR.paintGeo(new T.CylinderGeometry(2.0, 2.4, 40, 18).translate(0, 20, 0), [0.75, 0.74, 0.7])];
      for (let y = 6; y < 40; y += 6) colParts.push(RR.paintGeo(new T.CylinderGeometry(3.0, 3.0, 0.25, 18).translate(0, y, 0), [0.3, 0.32, 0.34]));
      colParts.push(RR.paintGeo(new T.SphereGeometry(2.0, 14, 8, 0, 6.3, 0, 1.6).translate(0, 40, 0), [0.75, 0.74, 0.7]));
      colParts.push(RR.paintGeo(new T.BoxGeometry(0.8, 40, 0.8).translate(2.6, 20, 0), [0.85, 0.65, 0.1]));
      colParts.push(RR.paintGeo(RR.tube([0, 30, 2], [0, 44, 2.5], 0.35), [0.6, 0.6, 0.62]));
      const indMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.6 });
      P.instanced(RR.mergeGeo(colParts), indMat, cols);
      // a tank: low wide cylinder, shallow dome, a spiral-stair stripe
      const tankParts = [RR.paintGeo(new T.CylinderGeometry(14, 14, 14, 36).translate(0, 7, 0), [0.88, 0.88, 0.86]),
        RR.paintGeo(new T.SphereGeometry(14.2, 36, 6, 0, 6.3, 0, 0.35).translate(0, 14 - 14.2 * Math.cos(0.35) + 0.2, 0), [0.8, 0.8, 0.78]),
        RR.paintGeo(new T.CylinderGeometry(14.05, 14.05, 1.0, 36, 1, true).translate(0, 10, 0), [0.15, 0.3, 0.6])];
      P.instanced(RR.mergeGeo(tankParts), indMat, tanks);
      // pipe racks running beside the track
      [[r0 + 30, r0 + 260, -(HW + 14)], [r1 - 300, r1 - 60, HW + 15]].forEach(function (pr) {
        for (let k = 0; k < 4; k++) { const pipe = P.fence(pr[0], pr[1], pr[2] + (k - 1.5) * 0.9 * Math.sign(pr[2]), 5.2 + (k % 2) * 0.6, 5.7 + (k % 2) * 0.6, k % 2 ? steel : white, 6, 4); pipe.castShadow = true; }
        const legs = [];
        for (let s = pr[0]; s < pr[1]; s += 8) { const p = P.at(s, pr[2]); legs.push([p.x, p.y, p.z, p.yaw]); }
        P.instanced(new T.BoxGeometry(4.2, 0.3, 0.3).translate(0, 5.0, 0), dark, legs);
        P.instanced(RR.mergeGeo([new T.BoxGeometry(0.3, 5, 0.3).translate(-1.9, 2.5, 0), new T.BoxGeometry(0.3, 5, 0.3).translate(1.9, 2.5, 0)]), dark, legs);
      });
      // flare stacks: lattice tower, burning tip
      if (flares.length < 3) [[r0 + 120, -(HW + 70)], [(r0 + r1) / 2, HW + 90], [r1 - 80, -(HW + 110)]].forEach(function (f) { const p = tr.at(f[0], f[1]); flares.push([p.x, W.course.far(p.x, p.z), p.z]); });
      W.flames = [];
      const flameMat = new T.MeshBasicMaterial({ color: new T.Color(4.0, 1.6, 0.4), transparent: true, opacity: 0.9, depthWrite: false, fog: false });
      const flameCore = new T.MeshBasicMaterial({ color: new T.Color(8, 6, 3), transparent: true, opacity: 0.95, depthWrite: false, fog: false });
      flares.forEach(function (f, k) {
        const H = 55 + k * 8, g = new T.Group();
        const tower = new T.Mesh(new T.CylinderGeometry(0.6, 1.8, H, 6, 1), dark); tower.position.y = H / 2; g.add(tower);
        const tip = new T.Mesh(new T.CylinderGeometry(0.7, 0.7, 2, 10), steel); tip.position.y = H + 1; g.add(tip);
        const fl = new T.Mesh(new T.ConeGeometry(2.0, 9, 12, 1, true), flameMat); fl.position.y = H + 6.5; g.add(fl);
        const core = new T.Mesh(new T.ConeGeometry(0.9, 5, 10, 1, true), flameCore); core.position.y = H + 4.5; g.add(core);
        const beacon = new T.Mesh(new T.SphereGeometry(0.4, 8, 6), new T.MeshBasicMaterial({ color: new T.Color(6, 0.2, 0.1), fog: false })); beacon.position.y = H * 0.6; g.add(beacon);
        g.position.set(f[0], f[1], f[2]);
        tower.castShadow = true;
        root.add(g);
        W.flames.push({ x: f[0], y: f[1] + H + 8, z: f[2], mesh: fl, core: core, beacon: beacon, ph: k * 1.7 });
      });
      W.anim.push(function (t) {
        W.flames.forEach(function (f) {
          const k = 1 + 0.18 * Math.sin(t * 13 + f.ph) + 0.12 * Math.sin(t * 7.3 + f.ph * 2);
          f.mesh.scale.set(1 + 0.1 * Math.sin(t * 9 + f.ph), k, 1); f.core.scale.set(1, 0.9 + 0.2 * Math.sin(t * 17 + f.ph), 1);
          f.beacon.visible = Math.sin(t * 3 + f.ph) > 0;
        });
      });
      P.gate(r0 + 6, "REFINERY RUN", "#ff7a1a", "#ffd23f", HW + 2.6, { h: 7 });
    }

    // ---- jumps: banners and fans
    P.gate(S.t1 - 18, "TABLETOP", "#7a2bd9", "#ff4fa3", HW + 2.6, { h: 7 });
    P.gate(S.t2 - 20, "BIG AIR", "#ff4a1c", "#ffb31a", HW + 2.6, { h: 7.5 });
    P.gate(S.dbl - 18, "DOUBLE", "#1f6a8a", "#3ab4c8", HW + 2.6, { h: 7 });
    P.crowd(S.t2, S.t2 + 45, HW + 6, 3, 0.6, rnd);
    P.crowd(S.t2, S.t2 + 45, -(HW + 6), 3, 0.6, rnd);
    P.gate(S.rollers[0] - 10, "ROLLERS", "#2a7a46", "#7ad04a", HW + 2.6, { h: 6.5 });
    P.gate(S.sand[0] - 6, "THE SAND", "#c8a21a", "#ffe066", HW + 2.6, { h: 6.5 });

    // ---- tyre walls on the bends, hay bales on the straights, feather flags
    {
      const tires = [], bales = [], flags = [];
      C.forEach(function (cs) {
        const sgn = Math.sign(tr.bank[Math.round(cs / tr.ds)] || 1);
        for (let s = cs - 26; s < cs + 26; s += 1.4) { const p = P.at(s, sgn * (HW + 3.2)); tires.push([p.x, p.y, p.z, rnd() * 6]); W.obstacles.push({ x: p.x, z: p.z, r: 0.5 }); }
      });
      for (let s = 10; s < tr.L - 5; s += 1.3) {
        if (inR(s, S.containers) || inR(s, [S.overpass[0] - 30, S.overpass[1] + 30])) continue;
        let nearC = false; for (let i = 0; i < C.length; i++) if (Math.abs(s - C[i]) < 30) nearC = true;
        if (nearC || rnd() < 0.15) continue;
        [-1, 1].forEach(function (sd) { const p = P.at(s, sd * (HW + 4.1)); bales.push([p.x, p.y, p.z, p.yaw + Math.PI / 2]); });
      }
      for (let s = 20; s < tr.L; s += 46) [-1, 1].forEach(function (sd) { const p = P.at(s + (sd > 0 ? 23 : 0), sd * (HW + 5.5)); flags.push([p.x, p.y, p.z, p.yaw + rnd() * 0.5]); });
      P.instanced(RR.tireStackGeometry(3), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), tires);
      P.instanced(RR.hayBaleGeometry(), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), bales);
      const flagGeo = RR.mergeGeo([RR.paintGeo(new T.CylinderGeometry(0.03, 0.03, 4.2, 5).translate(0, 2.1, 0), [0.2, 0.2, 0.2]),
        RR.paintGeo((function () { const s = new T.Shape(); s.moveTo(0, 0); s.lineTo(0.8, 0.2); s.quadraticCurveTo(0.95, 1.6, 0.6, 3.1); s.lineTo(0, 3.2); s.closePath(); return new T.ShapeGeometry(s).translate(0.03, 0.9, 0); })(), [1.0, 0.35, 0.08])]);
      const flagMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: T.DoubleSide });
      P.instanced(flagGeo, flagMat, flags);
    }

    // ---- the levee, the channel, a cargo ship, gantry cranes
    {
      const wy = S.waterY;
      W.waterAlong(S.levee - 120, tr.L + 260, 62, 900, wy, RR.waterMaterial(0x3a3e34, 0.95));
      const end = tr.at(tr.L - 120, 330), ship = new T.Group();
      const hull = new T.Shape();
      hull.moveTo(-95, 0); hull.lineTo(80, 0); hull.quadraticCurveTo(108, 8, 112, 18); hull.lineTo(-100, 18); hull.lineTo(-95, 0);
      const hg = new T.ExtrudeGeometry(hull, { depth: 30, bevelEnabled: false }); hg.translate(0, 0, -15);
      ship.add(new T.Mesh(hg, new T.MeshStandardMaterial({ color: 0x8a2a24, roughness: 0.7, metalness: 0.3 })));
      const deckM = new T.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6 });
      const dk = new T.Mesh(new T.BoxGeometry(206, 1.5, 30), deckM); dk.position.set(5, 18.5, 0); ship.add(dk);
      const sup = new T.Mesh(new T.BoxGeometry(16, 22, 26), white); sup.position.set(-82, 30, 0); ship.add(sup);
      const fun = new T.Mesh(new T.CylinderGeometry(3, 3.4, 10, 12), new T.MeshStandardMaterial({ color: 0x1f4f8a, roughness: 0.5 })); fun.position.set(-90, 45, 0); ship.add(fun);
      for (let x = -66; x < 96; x += 12.6) for (let z = -12; z <= 12; z += 2.5) {
        const hh = 1 + Math.floor(rnd() * 4);
        const c = new T.Mesh(new T.BoxGeometry(12.2, 2.59 * hh, 2.44), cmats[Math.floor(rnd() * cmats.length)]);
        c.position.set(x, 19.2 + 1.3 * hh, z); ship.add(c);
      }
      ship.position.set(end.x, wy - 6, end.z); ship.rotation.y = end.yaw + Math.PI / 2;
      ship.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      root.add(ship);
      const craneM = new T.MeshStandardMaterial({ color: 0xd8a21a, roughness: 0.5, metalness: 0.5 });
      [tr.L - 240, tr.L - 40].forEach(function (s) {
        const p = tr.at(s, 50), g = new T.Group(), y = W.course.far(p.x, p.z);
        [[-9, -12], [9, -12], [-9, 12], [9, 12]].forEach(function (l) { const m = new T.Mesh(new T.BoxGeometry(1.4, 46, 1.4), craneM); m.position.set(l[0], 23, l[1]); g.add(m); });
        const top = new T.Mesh(new T.BoxGeometry(20, 4, 26), craneM); top.position.y = 46; g.add(top);
        const boom = new T.Mesh(new T.BoxGeometry(3, 2.5, 110), craneM); boom.position.set(0, 44, 40); g.add(boom);
        const cab = new T.Mesh(new T.BoxGeometry(3, 3, 4), white); cab.position.set(0, 40, 30); g.add(cab);
        g.position.set(p.x, y, p.z); g.rotation.y = p.yaw + Math.PI / 2;
        g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
        root.add(g);
      });
    }

    // ---- start + finish
    P.gate(S.start - 6, "SHIP CHANNEL SCRAMBLE", "#ff4a1c", "#ffb31a", HW + 2.6, { h: 8 });
    P.gate(S.finish, "FINISH", "#e8262a", "#ff8a3d", HW + 2.6, { h: 8 });
    P.crowd(S.start - 30, S.start + 40, HW + 5, 3, 0.7, rnd);
    P.crowd(S.start - 30, S.start + 40, -(HW + 5), 3, 0.7, rnd);
    P.crowd(S.finish - 60, S.finish + 30, HW + 5, 3, 0.75, rnd);
    P.crowd(S.finish - 60, S.finish + 30, -(HW + 5), 3, 0.75, rnd);
  };
})(window.RR = window.RR || {});
