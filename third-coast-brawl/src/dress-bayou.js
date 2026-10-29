// BAYOU BENDS dressing: live oaks dripping Spanish moss over the berms, loblolly pines, palmetto
// understorey, course tape along the trail, the root garden's roots, the creek with its rocks, the
// cypress-swamp boardwalk, rock lips on the pine drops, the jump line, and the downtown skyline
// in the haze past the finish.
(function (RR) {
  "use strict";
  const T = window.THREE;
  RR.DRESS = RR.DRESS || {};

  function cypressGeometry(seed) {
    const rnd = RR.rng(seed), parts = [];
    // a flared, buttressed base, a straight trunk and a thin flat crown
    const base = new T.CylinderGeometry(0.35, 1.0, 2.2, 9, 3); base.translate(0, 1.1, 0);
    const p = base.attributes.position;
    for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)), y = p.getY(i), k = 1 + 0.25 * Math.sin(a * 5 + seed) * (1 - y / 2.2); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
    base.computeVertexNormals();
    parts.push(RR.paintGeo(base, [0.42, 0.36, 0.3]));
    const H = 12 + rnd() * 5;
    parts.push(RR.paintGeo(RR.tube([0, 2, 0], [0.2, H, 0.1], 0.36, 0.14, 7), [0.42, 0.36, 0.3]));
    for (let k = 0; k < 4; k++) {
      const g = new T.IcosahedronGeometry(1.9 + rnd(), 1); g.scale(1.3, 0.35, 1.3);
      const a = rnd() * 6.28, r = rnd() * 1.6;
      g.translate(Math.cos(a) * r, H - 1.5 + k * 0.9, Math.sin(a) * r);
      parts.push(RR.paintGeo(g, [0.26 + rnd() * 0.06, 0.34, 0.16]));
    }
    return RR.mergeGeo(parts);
  }

  RR.DRESS.mtb = function (W, q, rnd) {
    const tr = W.track, S = W.S, P = W.P, root = W.root, HW = tr.halfW, C = S.corners;
    const inR = function (s, r) { return s >= r[0] && s <= r[1]; };
    const fol = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, envMapIntensity: 0.45 });

    // ---- the woods
    const oakG = [RR.oakGeometry(2), RR.oakGeometry(7), RR.oakGeometry(13)], pineG = [RR.pineGeometry(4), RR.pineGeometry(9)];
    const palG = RR.palmettoGeometry(5), bushG = RR.bushGeometry(6);
    const oaks = [[], [], []], pines = [[], []], pals = [], bushes = [];
    const wallAt = function (s) { return W.wall(s)[1]; };
    function plant(list, x, z, sc, s, lat, rObs) {
      const y = W.ground(x, z) - 0.15;
      list.push([x, y, z, rnd() * 6.28, sc]);
      if (Math.abs(lat) < wallAt(s) + 1 && rObs) W.obstacles.push({ x: x, z: z, r: rObs * sc });
    }
    for (let s = -40; s < tr.L + 60; s += 4) {
      const meadow = inR(s, S.meadow) || s > S.final[0] + 40, board = inR(s, [S.board[0] - 6, S.board[1] + 6]);
      const oaky = inR(s, S.oaks) || inR(s, S.roots) || s > S.final[0] - 60, piney = inR(s, S.pines);
      [-1, 1].forEach(function (sd) {
        const n = meadow ? 1 : 3;
        for (let k = 0; k < n; k++) {
          if (rnd() > (meadow ? 0.3 : 0.7)) continue;
          const minL = meadow ? HW + 30 : board ? HW + 9 : HW + 3.2;
          const lat = sd * (minL + Math.pow(rnd(), 1.2) * (meadow ? 140 : 75));
          const p = tr.at(s + rnd() * 4, lat);
          const i = tr.nearestAny(p.x, p.z);
          if (Math.abs(tr.lateral(p.x, p.z, i)) < HW + 2.6) continue;
          const pick = rnd();
          if (board) { if (pick < 0.5) plant(pines[k % 2], p.x, p.z, 0.8 + rnd() * 0.4, s, lat, 0); continue; }
          if ((oaky && pick < 0.6) || (!piney && pick < 0.35)) plant(oaks[Math.floor(rnd() * 3)], p.x, p.z, 0.55 + rnd() * 0.45, s, lat, 0.55);
          else plant(pines[Math.floor(rnd() * 2)], p.x, p.z, 0.75 + rnd() * 0.45, s, lat, 0.35);
        }
        // understorey near the trail
        if (!meadow && !board) for (let k = 0; k < 3; k++) {
          const lat = sd * (HW + 1.6 + rnd() * 16), p = tr.at(s + rnd() * 4, lat), i = tr.nearestAny(p.x, p.z);
          if (Math.abs(tr.lateral(p.x, p.z, i)) < HW + 1.3) continue;
          (rnd() < 0.6 ? pals : bushes).push([p.x, W.ground(p.x, p.z) - 0.05, p.z, rnd() * 6.28, 0.7 + rnd() * 0.7]);
        }
      });
    }
    oakG.forEach(function (g, k) { P.instanced(g, fol, oaks[k]); });
    pineG.forEach(function (g, k) { P.instanced(g, fol, pines[k]); });
    P.instanced(palG, fol, pals, false);
    P.instanced(bushG, fol, bushes, false);

    // ---- course tape on stakes along both edges
    const tapeTex = RR.canvasTex(256, 16, function (g, w, h) { for (let x = 0; x < w; x += 32) { g.fillStyle = "#ff6a10"; g.fillRect(x, 0, 16, h); g.fillStyle = "#f4f4f0"; g.fillRect(x + 16, 0, 16, h); } });
    const tapeMat = new T.MeshStandardMaterial({ map: tapeTex, roughness: 0.6, side: T.DoubleSide, emissive: 0x401a00, emissiveIntensity: 0.3 });
    const stakeMat = new T.MeshStandardMaterial({ color: 0x8a6a40, roughness: 0.8 });
    const stakes = [];
    let run0 = -1;
    for (let s = 6; s <= tr.L - 4; s += 7) {
      const skip = inR(s, [S.board[0] - 4, S.board[1] + 4]) || Math.abs(s - S.creek) < 14;
      if (!skip && run0 < 0) run0 = s;
      if ((skip || s + 7 > tr.L - 4) && run0 >= 0) { [-1, 1].forEach(function (sd) { P.fence(run0, s - 7, sd * (HW + 1.0), 0.78, 0.86, tapeMat, 1.5, 3.5); }); run0 = -1; }
      if (!skip) [-1, 1].forEach(function (sd) { const p = P.at(s, sd * (HW + 1.0)); stakes.push([p.x, p.y, p.z, 0]); });
    }
    P.instanced(new T.CylinderGeometry(0.025, 0.03, 0.95, 5).translate(0, 0.45, 0), stakeMat, stakes, false);

    // ---- the root garden: roots lying along the ridges of the bumps
    {
      const rootMat = new T.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.9 });
      for (let k = 0; ; k++) {
        const s0 = (Math.PI / 2 + 2 * Math.PI * k) / 1.9;
        if (s0 < S.roots[0] - 4) continue;
        if (s0 > S.roots[1] + 4) break;
        if (k % 2) continue;
        const pts = [];
        for (let lat = -HW - 0.6; lat <= HW + 0.61; lat += 1.1) {
          const s = s0 - lat * 0.5 / 1.9, p = tr.at(s, lat);
          pts.push(new T.Vector3(p.x, W.ground(p.x, p.z) + 0.02, p.z));
        }
        const g = new T.TubeGeometry(new T.CatmullRomCurve3(pts), 24, 0.09 + rnd() * 0.04, 6, false);
        const m = new T.Mesh(g, rootMat); m.castShadow = true; m.receiveShadow = true;
        root.add(m);
      }
      P.gate(S.roots[0] - 4, "ROOT GARDEN", "#5a3a1c", "#9a6a2a", HW + 1.8, { h: 5.5 });
    }

    // ---- the creek: water across the line, rocks on the banks, stepping stones
    {
      W.waterAlong(S.creek - 9, S.creek + 9, -90, 90, S.creekY, RR.waterMaterial(0x3a4a32, 0.86));
      const rockMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
      const rocks = [];
      for (let k = 0; k < 40; k++) {
        const s = S.creek + (rnd() < 0.5 ? -1 : 1) * (7 + rnd() * 5), lat = (rnd() - 0.5) * 70;
        if (Math.abs(lat) < HW + 1) continue;
        const p = tr.at(s, lat); rocks.push([p.x, W.ground(p.x, p.z) - 0.1, p.z, rnd() * 6, 0.3 + rnd() * 0.8]);
      }
      for (let lat = -HW + 1; lat < HW; lat += 2.4) { const p = tr.at(S.creek + (rnd() - 0.5) * 3, lat); rocks.push([p.x, S.creekY - 0.12, p.z, rnd() * 6, 0.35, 0.25]); }
      P.instanced(RR.rockGeometry(3, [0.42, 0.4, 0.36]), rockMat, rocks);
      P.gate(S.creek - 26, "CREEK CROSSING", "#1f6a8a", "#3ab4c8", HW + 1.8, { h: 5.5 });
    }

    // ---- the swamp boardwalk: planks, stringers, posts, rails, piles in the water, cypresses
    {
      const b0 = S.board[0] - 1.5, b1 = S.board[1] + 1.5;
      W.waterAlong(b0 - 30, b1 + 30, -95, 95, S.swampY, RR.waterMaterial(0x2c3a26, 0.95));
      const plank = new T.MeshStandardMaterial({ map: RR.plywoodTexture(), color: 0x9a8066, roughness: 0.85 });
      const planks = [];
      for (let s = b0; s < b1; s += 0.36) { const p = tr.at(s, 0); planks.push([p.x, tr.elev(s) + 0.45 + 0.005, p.z, p.yaw + (rnd() - 0.5) * 0.02]); }
      P.instanced(new T.BoxGeometry(2 * HW + 0.8, 0.06, 0.31).translate(0, -0.03, 0), plank, planks);
      const wood = new T.MeshStandardMaterial({ color: 0x5e4834, roughness: 0.9 });
      const posts = [], piles = [];
      for (let s = b0; s < b1; s += 2.4) [-1, 1].forEach(function (sd) {
        const p = tr.at(s, sd * (HW + 0.32)), y = tr.elev(s) + 0.45;
        posts.push([p.x, y, p.z, p.yaw]);
        piles.push([p.x, S.swampY - 2, p.z, 0, 1, (y - S.swampY + 2) / 2.5]);
      });
      P.instanced(new T.BoxGeometry(0.12, 1.05, 0.12).translate(0, 0.52, 0), wood, posts);
      P.instanced(new T.CylinderGeometry(0.12, 0.14, 2.5, 7).translate(0, 1.25, 0), wood, piles, false);
      [-1, 1].forEach(function (sd) {
        P.fence(b0, b1, sd * (HW + 0.32), 0.95, 1.06, wood, 4, 2);
        P.fence(b0, b1, sd * (HW + 0.32), 0.45, 0.5, wood, 4, 2);
        P.fence(b0, b1, sd * (HW + 0.4), -0.3, 0.0, wood, 4, 2);
      });
      const cyp = [cypressGeometry(3), cypressGeometry(8)], cl = [[], []], knees = [];
      for (let k = 0; k < 120; k++) {
        const s = b0 - 20 + rnd() * (b1 - b0 + 40), lat = (rnd() < 0.5 ? -1 : 1) * (HW + 5 + rnd() * 70), p = tr.at(s, lat);
        cl[k % 2].push([p.x, S.swampY - 0.6, p.z, rnd() * 6, 0.7 + rnd() * 0.5]);
        for (let j = 0; j < 3; j++) knees.push([p.x + (rnd() - 0.5) * 4, S.swampY - 0.15, p.z + (rnd() - 0.5) * 4, 0, 0.6 + rnd() * 0.6]);
      }
      P.instanced(cyp[0], fol, cl[0]); P.instanced(cyp[1], fol, cl[1]);
      P.instanced(RR.paintGeo(new T.ConeGeometry(0.14, 0.6, 6).translate(0, 0.3, 0), [0.4, 0.34, 0.28]), fol, knees, false);
      // lily pads
      const pads = [];
      for (let k = 0; k < 160; k++) { const p = tr.at(b0 + rnd() * (b1 - b0), (rnd() < 0.5 ? -1 : 1) * (HW + 1 + rnd() * 30)); pads.push([p.x, S.swampY + 0.01, p.z, rnd() * 6, 0.5 + rnd() * 0.6]); }
      P.instanced(RR.paintGeo(new T.CircleGeometry(0.35, 9, 0.3, 5.9).rotateX(-Math.PI / 2), [0.26, 0.42, 0.18]), fol, pads, false);
      P.gate(S.board[0] - 6, "SWAMP BOARDWALK", "#3a5a2a", "#7aa04a", HW + 1.3, { h: 5.5 });
    }

    // ---- rock lips on the pine drops
    {
      const rockMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
      const lips = [];
      S.drops.forEach(function (d) {
        for (let lat = -HW - 1.5; lat <= HW + 1.5; lat += 1.4) { const p = tr.at(d + 0.4 + rnd() * 0.6, lat); lips.push([p.x, tr.elev(d) - 0.55, p.z, rnd() * 6, 0.65 + rnd() * 0.25, 0.7]); }
        P.gate(d - 24, "DROP!", "#c22a1c", "#ff7a2a", HW + 2, { h: 5.5 });
      });
      P.instanced(RR.rockGeometry(9, [0.5, 0.47, 0.42]), rockMat, lips);
    }

    // ---- the jump line: a banner and fans either side of the tables
    P.gate(S.tables[0] - 14, "JUMP LINE", "#ff4a1c", "#ffb31a", HW + 2, { h: 6 });
    P.crowd(S.tables[0], S.tables[2] + 20, HW + 3.5, 2, 0.55, rnd);
    P.crowd(S.tables[0], S.tables[2] + 20, -(HW + 3.5), 2, 0.55, rnd);

    // ---- start + finish
    P.gate(S.start, "BAYOU BENDS", "#2a8a3a", "#ffb31a", HW + 1.8, { h: 6.5 });
    P.gate(S.finish, "FINISH", "#e8262a", "#ff8a3d", HW + 2.2, { h: 6.5 });
    P.crowd(S.start - 20, S.start + 30, HW + 4, 3, 0.65, rnd);
    P.crowd(S.start - 20, S.start + 30, -(HW + 4), 3, 0.65, rnd);
    P.crowd(S.finish - 50, S.finish + 25, HW + 4, 3, 0.7, rnd);
    P.crowd(S.finish - 50, S.finish + 25, -(HW + 4), 3, 0.7, rnd);
    const bales = [];
    for (let s = S.finish - 50; s < S.finish + 25; s += 1.25) [-1, 1].forEach(function (sd) { const p = P.at(s, sd * (HW + 2.6)); bales.push([p.x, p.y, p.z, p.yaw + Math.PI / 2]); });
    P.instanced(RR.hayBaleGeometry(), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), bales);

    // ---- the downtown skyline beyond the finish, in the haze (unfogged, coloured into the mist)
    {
      const end = tr.at(tr.L, 0), fogC = new T.Color(RR.SKIES.morning.fog);
      const parts = [];
      for (let k = 0; k < 34; k++) {
        const h = 40 + Math.pow(rnd(), 1.6) * 230, w = 18 + rnd() * 26;
        const g = new T.BoxGeometry(w, h, w); g.translate(0, h / 2, 0);
        const f = 0.55 + rnd() * 0.2, c = new T.Color(0.12, 0.15, 0.2).lerp(fogC, f);
        RR.paintGeo(g, [c.r, c.g, c.b], false);
        g.translate(end.x + (rnd() - 0.5) * 600, tr.e[tr.n - 1] - 6, end.z - 1300 - rnd() * 300);
        parts.push(g);
      }
      const m = new T.Mesh(RR.mergeGeo(parts), new T.MeshBasicMaterial({ vertexColors: true, fog: false }));
      root.add(m);
    }
  };
})(window.RR = window.RR || {});
