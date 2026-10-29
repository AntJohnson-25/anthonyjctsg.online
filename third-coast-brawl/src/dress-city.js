// DOWNTOWN DROP dressing: towers along the diagonal street grid (glass, stone, dark glass and
// brick low-rises, windows lit for dusk), the far skyline, street lights and signals, rail lines
// down Main, road works, the parking-garage cut-through, the park with its kickers, the market
// funbox and stair set, the hill, and the bayou promenade under two bridges.
(function (RR) {
  "use strict";
  const T = window.THREE;
  RR.DRESS = RR.DRESS || {};

  // ---------- building facades ----------
  function facade(style) {
    const S = {
      glass: { wall: "#26323e", win: ["#3f6a8c", "#4f7fa4", "#2e5674"], frame: "#1b232b", lit: 0.25 },
      stone: { wall: "#b8a88e", win: ["#2c3540", "#36414e", "#1f2731"], frame: "#a29276", lit: 0.35 },
      dark: { wall: "#1a1a1e", win: ["#3a3530", "#2c2a28", "#4a4036"], frame: "#121214", lit: 0.3 },
      brick: { wall: "#8a4a36", win: ["#2a2f36", "#34393f", "#20252b"], frame: "#6e3a2a", lit: 0.4 }
    }[style];
    const rnd = RR.rng(style.length * 17 + 3);
    const lit = [];
    const map = RR.canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = S.wall; g.fillRect(0, 0, w, h);
      const cols = 4, rows = 4, cw = w / cols, rh = h / rows;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const glass = style === "glass" || style === "dark";
        const x = c * cw + (glass ? 3 : 9), y = r * rh + (glass ? 4 : 12), ww = cw - (glass ? 6 : 18), hh = rh - (glass ? 10 : 22);
        g.fillStyle = S.win[Math.floor(rnd() * S.win.length)];
        g.fillRect(x, y, ww, hh);
        const gr = g.createLinearGradient(x, y, x + ww, y + hh);
        gr.addColorStop(0, "rgba(255,255,255,0.12)"); gr.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = gr; g.fillRect(x, y, ww, hh);
        g.fillStyle = S.frame; g.fillRect(x, y + hh * 0.5, ww, 2);
        if (rnd() < S.lit) lit.push([x, y, ww, hh, rnd()]);
      }
      g.fillStyle = S.frame;
      for (let r = 0; r < rows; r++) g.fillRect(0, r * rh, w, glass2(style) ? 3 : 6);
    });
    const emis = RR.canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
      lit.forEach(function (l) { g.fillStyle = l[4] < 0.6 ? "#ffcf8a" : l[4] < 0.85 ? "#fff1d6" : "#bfe1ff"; g.fillRect(l[0] + 1, l[1] + 1, l[2] - 2, l[3] - 2); });
    });
    const glassy = style === "glass" || style === "dark";
    return new T.MeshStandardMaterial({ map: map, emissiveMap: emis, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: glassy ? 0.18 : 0.82, metalness: glassy ? 0.55 : 0.02, envMapIntensity: glassy ? 1.3 : 0.6 });
  }
  function glass2(style) { return style === "glass" || style === "dark"; }
  // a box with facade uvs scaled to metres (one texture tile = 12 m x 14.4 m), roof without windows
  function boxUV(w, h, d) {
    const g = new T.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    const uv = g.attributes.uv;
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      if (f === 2 || f === 3) { uv.setXY(i, 0.003, 0.003); continue; }
      const fw = f < 2 ? d : w;
      uv.setXY(i, uv.getX(i) * fw / 12, uv.getY(i) * h / 14.4);
    }
    return g;
  }
  function flatUV(g) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.003, 0.003); return g; }
  function roofCap(w, d) { const g = new T.BoxGeometry(w * 0.6, 2.2, d * 0.5); g.translate(0, 1.1, 0); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.003, 0.003); return g; }

  // ---------- a car: an extruded side profile, a glasshouse, wheels and lamps ----------
  RR.carGeometry = function (paintRGB) {
    const body = new T.Shape();
    const P = [[2.25, 0.32], [2.3, 0.72], [2.05, 0.92], [1.25, 0.98], [0.86, 1.4], [-0.42, 1.44], [-1.05, 0.98], [-2.1, 0.84], [-2.3, 0.56], [-2.25, 0.32],
      [-1.78, 0.32], [-1.72, 0.55], [-1.42, 0.68], [-1.08, 0.55], [-1.02, 0.32], [1.02, 0.32], [1.08, 0.55], [1.42, 0.68], [1.72, 0.55], [1.78, 0.32]];
    body.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) body.lineTo(P[i][0], P[i][1]); body.closePath();
    const parts = [];
    const bg = new T.ExtrudeGeometry(body, { depth: 1.7, bevelEnabled: true, bevelSize: 0.07, bevelThickness: 0.08, bevelSegments: 3, curveSegments: 4 });
    bg.translate(0, 0, -0.85); bg.rotateY(Math.PI / 2);
    parts.push(RR.paintGeo(bg, paintRGB));
    const gl = new T.Shape();
    [[1.2, 1.0], [0.84, 1.38], [-0.4, 1.42], [-0.98, 1.0]].forEach(function (p, i) { if (!i) gl.moveTo(p[0], p[1]); else gl.lineTo(p[0], p[1]); });
    gl.closePath();
    const gg = new T.ExtrudeGeometry(gl, { depth: 1.62, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.06, bevelSegments: 2 });
    gg.translate(0, 0.005, -0.81); gg.rotateY(Math.PI / 2);
    parts.push(RR.paintGeo(gg, [0.05, 0.07, 0.09]));
    [[-1.4, 1], [1.4, 1], [-1.4, -1], [1.4, -1]].forEach(function (w) {
      const c = new T.CylinderGeometry(0.34, 0.34, 0.24, 16); c.rotateZ(Math.PI / 2); c.translate(w[1] * 0.83, 0.34, w[0]);
      parts.push(RR.paintGeo(c, [0.05, 0.05, 0.05]));
      const h = new T.CylinderGeometry(0.2, 0.2, 0.25, 10); h.rotateZ(Math.PI / 2); h.translate(w[1] * 0.85, 0.34, w[0]);
      parts.push(RR.paintGeo(h, [0.6, 0.6, 0.62]));
    });
    [-1, 1].forEach(function (s) {
      // the profile's nose ends up at +Z after the turn
      parts.push(RR.paintGeo(new T.BoxGeometry(0.34, 0.1, 0.05).translate(s * 0.62, 0.74, 2.36), [1.6, 1.55, 1.4], false));
      parts.push(RR.paintGeo(new T.BoxGeometry(0.34, 0.1, 0.05).translate(s * 0.62, 0.8, -2.36), [0.9, 0.05, 0.05]));
    });
    return RR.mergeGeo(parts);
  };

  RR.DRESS.skate = function (W, q, rnd) {
    const tr = W.track, S = W.S, P = W.P, root = W.root, HW = tr.halfW, C = S.corners;
    const ground = W.ground;
    const nearCorner = function (s, pad) { for (let i = 0; i < C.length; i++) if (Math.abs(s - C[i]) < pad) return true; return false; };
    const inR = function (s, r) { return s >= r[0] && s <= r[1]; };

    // ---- towers along the street legs
    const styles = ["glass", "stone", "dark", "brick"];
    const parts = { glass: [], stone: [], dark: [], brick: [] };
    const M4 = new T.Matrix4(), Q = new T.Quaternion(), V = new T.Vector3(), ONE = new T.Vector3(1, 1, 1), UP = new T.Vector3(0, 1, 0);
    function addBuilding(x, y, z, yaw, w, h, d, style) {
      Q.setFromAxisAngle(UP, yaw);
      M4.compose(V.set(x, y, z), Q, ONE);
      parts[style].push(boxUV(w, h, d).applyMatrix4(M4));
      trim(x, y, z, w, h, d, style);
      // crowns: a setback on the tall ones, rooftop plant on the rest
      if (h > 70 && rnd() < 0.6) {
        const k = 0.62 + rnd() * 0.15, h2 = h * (0.12 + rnd() * 0.18);
        M4.compose(V.set(x, y + h, z), Q, ONE);
        parts[style].push(boxUV(w * k, h2, d * k).applyMatrix4(M4));
        if (rnd() < 0.5) {
          const sp = new T.ConeGeometry(Math.min(w, d) * k * 0.55, h2 * 1.4, 4); sp.rotateY(Math.PI / 4); sp.translate(0, h2 * 0.7, 0);
          const uv = sp.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.003, 0.003);
          M4.compose(V.set(x, y + h + h2, z), Q, ONE);
          parts[style].push(sp.applyMatrix4(M4));
        }
      } else {
        M4.compose(V.set(x, y + h, z), Q, ONE);
        parts[style].push(roofCap(w, d).applyMatrix4(M4));
      }
    }
    // cornice, plinth, pilasters on the street faces, rooftop plant: flat-uv boxes merged into the facade mesh
    const trnd = RR.rng(77);
    function trim(x, y, z, w, h, d, style) {
      const near = h < 130;
      const put = function (g, dx, dy, dz) {
        flatUV(g); g.translate(dx, dy, dz);
        M4.compose(V.set(x, y, z), Q, ONE);
        parts[style].push(g.applyMatrix4(M4));
      };
      put(new T.BoxGeometry(w + 0.9, 0.7, d + 0.9), 0, h - 0.35, 0);
      put(new T.BoxGeometry(w + 0.5, 3.4, d + 0.5), 0, 1.7, 0);
      if (!near) return;
      if (style === "stone" || style === "brick") {
        put(new T.BoxGeometry(w + 0.6, 0.35, d + 0.6), 0, h * 0.5, 0);
        const n = Math.max(2, Math.floor(d / 6.5));
        for (let k = 0; k < n; k++) [-1, 1].forEach(function (sd) {
          put(new T.BoxGeometry(0.55, h - 4, 0.7), sd * (w / 2 + 0.15), 3.4 + (h - 4) / 2, -d / 2 + (k + 0.5) * d / n);
        });
      } else {
        // glass towers: a vertical mullion fin at each corner
        [-1, 1].forEach(function (sx) { [-1, 1].forEach(function (sz) { put(new T.BoxGeometry(0.8, h, 0.8), sx * w / 2, h / 2, sz * d / 2); }); });
      }
      if (h < 90) {
        // rooftop plant: air handlers with fans, a water tank on the older buildings
        const n = 2 + Math.floor(trnd() * 3);
        for (let k = 0; k < n; k++) {
          const ax = (trnd() - 0.5) * w * 0.6, az = (trnd() - 0.5) * d * 0.6;
          put(new T.BoxGeometry(1.9, 1.2, 1.4), ax, h + 0.6, az);
          put(new T.CylinderGeometry(0.45, 0.45, 0.08, 14), ax, h + 1.24, az);
        }
        if (style === "brick" || style === "stone") {
          const tx = (trnd() - 0.5) * w * 0.4, tz = (trnd() - 0.5) * d * 0.4;
          put(new T.CylinderGeometry(1.5, 1.5, 2.8, 16), tx, h + 3.8, tz);
          put(new T.ConeGeometry(1.65, 0.9, 16), tx, h + 5.65, tz);
          [-1, 1].forEach(function (a) { [-1, 1].forEach(function (b) { put(new T.CylinderGeometry(0.07, 0.07, 2.4, 6), tx + a * 1.1, h + 1.2, tz + b * 1.1); }); });
        }
      }
    }
    function streetBlocks(s0, s1, hMin, hMax, weights) {
      [-1, 1].forEach(function (side) {
        let s = s0 + rnd() * 6;
        while (s < s1) {
          const wa = 18 + rnd() * 22;
          if (s + wa > s1) break;
          const sc = s + wa / 2;
          if (!nearCorner(sc, 26 + wa / 2)) {
            const depth = 20 + rnd() * 22, lat = side * (HW + 4.6 + depth / 2);
            const p = tr.at(sc, lat), y = tr.elev(sc) - 1.2;
            const h = hMin + Math.pow(rnd(), 1.5) * (hMax - hMin);
            let k = rnd(), style = styles[0];
            for (let i = 0; i < 4; i++) { if (k < weights[i]) { style = styles[i]; break; } k -= weights[i]; }
            addBuilding(p.x, y, p.z, p.yaw, depth, h, wa, style);
          }
          s += wa + 2 + rnd() * 6;
        }
      });
    }
    streetBlocks(8, C[1], 45, 200, [0.45, 0.25, 0.3, 0]);
    streetBlocks(C[1], S.garage[0] - 6, 40, 150, [0.4, 0.3, 0.3, 0]);
    streetBlocks(S.garage[1] + 8, C[2], 30, 120, [0.35, 0.35, 0.3, 0]);
    streetBlocks(C[3], C[4], 12, 45, [0.15, 0.3, 0.1, 0.45]);
    streetBlocks(C[4], C[5] - 10, 9, 32, [0.1, 0.3, 0.1, 0.5]);
    // the far skyline: towers in every direction, tallest toward the downtown core
    const core = tr.at(C[1] * 0.6, 0);
    for (let k = 0; k < 170; k++) {
      const a = rnd() * Math.PI * 2, r = 260 + Math.pow(rnd(), 0.8) * 1500;
      const x = core.x + Math.cos(a) * r, z = core.z + Math.sin(a) * r;
      const i = tr.nearestAny(x, z);
      if (Math.abs(tr.lateral(x, z, i)) < 75 && i > 2 && i < tr.n - 3) continue;
      const h = 15 + Math.pow(rnd(), 1.8) * (r < 700 ? 230 : 90);
      addBuilding(x, W.course.far(x, z) - 2, z, rnd() * Math.PI, 22 + rnd() * 26, h, 22 + rnd() * 26, styles[Math.floor(rnd() * 3)]);
    }
    styles.forEach(function (st) {
      if (!parts[st].length) return;
      const m = new T.Mesh(RR.mergeGeo(parts[st]), facade(st));
      m.castShadow = true; m.receiveShadow = true;
      root.add(m);
    });

    // ---- street lights, signals, furniture
    const poleMat = new T.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5, metalness: 0.6 });
    const lampMat = new T.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffc27a, emissiveIntensity: 3.2 });
    const poles = [], heads = [];
    for (let s = 20; s < tr.L - 10; s += 30) {
      if (inR(s, S.garage) || nearCorner(s, 10)) continue;
      [-1, 1].forEach(function (sd) {
        const p = P.at(s, sd * (HW + 1.3));
        // the arm (local -Z) reaches toward the middle of the road
        poles.push([p.x, p.y, p.z, Math.atan2(sd * p.rx, sd * p.rz)]);
        const hx = p.x - p.rx * sd * 1.6, hz = p.z - p.rz * sd * 1.6;
        heads.push([hx, p.y + 7.1, hz, p.yaw]);
        W.obstacles.push({ x: p.x, z: p.z, r: 0.25 });
      });
    }
    const poleGeo = RR.mergeGeo([new T.CylinderGeometry(0.08, 0.12, 7.4, 8).translate(0, 3.7, 0), new T.BoxGeometry(0.08, 0.08, 1.7).translate(0, 7.25, -0.8)].map(function (g) { return RR.paintGeo(g, [1, 1, 1]); }));
    P.instanced(poleGeo, poleMat, poles);
    P.instanced(new T.BoxGeometry(0.5, 0.14, 0.26), lampMat, heads, false);

    // traffic signals over each street corner
    const sigBox = new T.MeshStandardMaterial({ color: 0x1b1d10, roughness: 0.6 });
    C.slice(0, 5).forEach(function (cs, k) {
      const p = P.at(cs - 16, HW + 1.5), g = new T.Group();
      const pole = new T.Mesh(new T.CylinderGeometry(0.13, 0.16, 6.2, 8), poleMat); pole.position.y = 3.1; g.add(pole);
      const arm = new T.Mesh(new T.CylinderGeometry(0.07, 0.07, 9, 6), poleMat); arm.rotation.z = Math.PI / 2; arm.position.set(-4.5, 6, 0); g.add(arm);
      [-3, -6.5].forEach(function (x) {
        const b = new T.Mesh(new T.BoxGeometry(0.42, 1.2, 0.36), sigBox); b.position.set(x, 5.4, 0); g.add(b);
        ["#ff3020", "#ffb020", "#30ff70"].forEach(function (c, j) {
          const on = (k % 2 === 0) === (j === 2) && (j !== 1);
          const l = new T.Mesh(new T.CircleGeometry(0.13, 12), new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: on ? 4 : 0.15 }));
          l.position.set(x, 5.8 - j * 0.38, -0.19); l.rotation.y = Math.PI; g.add(l);
        });
      });
      // local -X (the arm) points across the road, the lamps face oncoming riders
      g.position.set(p.x, p.y, p.z); g.rotation.y = p.yaw;
      g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
      root.add(g);
    });

    // newspaper boxes, hydrants, trash cans along the curbs (scenery)
    const furn = [[], [], []];
    for (let s = 30; s < S.prom[0] - 20; s += 9 + rnd() * 14) {
      if (inR(s, S.garage) || inR(s, S.park) || nearCorner(s, 18)) continue;
      const sd = rnd() < 0.5 ? -1 : 1, kind = Math.floor(rnd() * 3), p = P.at(s, sd * (HW + 2.2 + rnd() * 1.4));
      furn[kind].push([p.x, p.y, p.z, p.yaw + rnd() * 0.3]);
    }
    const npMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 });
    P.instanced(RR.mergeGeo([RR.paintGeo(new T.BoxGeometry(0.5, 0.9, 0.45).translate(0, 0.6, 0), [0.15, 0.35, 0.8]), RR.paintGeo(new T.BoxGeometry(0.44, 0.3, 0.02).translate(0, 0.85, -0.235), [0.85, 0.85, 0.82]), RR.paintGeo(new T.BoxGeometry(0.06, 0.2, 0.06).translate(0, 0.08, 0), [0.2, 0.2, 0.2])]), npMat, furn[0]);
    P.instanced(RR.mergeGeo([RR.paintGeo(new T.CylinderGeometry(0.16, 0.18, 0.7, 10).translate(0, 0.35, 0), [0.85, 0.75, 0.1]), RR.paintGeo(new T.SphereGeometry(0.16, 10, 6, 0, 6.3, 0, 1.6).translate(0, 0.7, 0), [0.85, 0.75, 0.1]), RR.paintGeo(new T.CylinderGeometry(0.06, 0.06, 0.5, 6).rotateZ(Math.PI / 2).translate(0, 0.45, 0), [0.85, 0.75, 0.1])]), npMat, furn[1]);
    P.instanced(RR.paintGeo(new T.CylinderGeometry(0.3, 0.27, 0.95, 12).translate(0, 0.475, 0), [0.18, 0.3, 0.2]), npMat, furn[2]);

    // ---- METRORail down Main: two rails in the middle lanes, a stop with its platform canopy
    const railMat = new T.MeshStandardMaterial({ color: 0x8a8d92, roughness: 0.25, metalness: 0.9 });
    [-0.72, 0.72].forEach(function (lat) { P.strip(C[0] + 15, C[1] - 18, lat, 0.08, railMat, 0.03); });
    const grooveMat = new T.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.6 });
    [-0.95, 0.95].forEach(function (lat) { P.strip(C[0] + 15, C[1] - 18, lat, 0.32, grooveMat, 0.02); });

    // ---- road works on Main: barriers and cones squeeze the left lanes
    const barGeo = RR.barrierGeometry(), barMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
    const coneGeo = RR.coneGeometry(), coneMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
    const bars = [], cones = [];
    function barrierRun(s0, s1, lat) {
      for (let s = s0; s < s1; s += 1.9) { const p = P.at(s, lat); bars.push([p.x, p.y, p.z, p.yaw]); W.obstacles.push({ x: p.x, z: p.z, r: 0.75 }); }
    }
    function coneTaper(s0, lat0, lat1, n) {
      for (let k = 0; k < n; k++) { const t = k / (n - 1), p = P.at(s0 + k * 3, lat0 + (lat1 - lat0) * t); cones.push([p.x, p.y, p.z, rnd() * 6]); W.obstacles.push({ x: p.x, z: p.z, r: 0.3 }); }
    }
    { const s0 = C[0] + 80; coneTaper(s0 - 15, -HW + 0.5, -4.4, 5); barrierRun(s0, s0 + 42, -4.6); coneTaper(s0 + 44, -4.4, -HW + 0.5, 4); }
    { const s0 = S.market[0] + 8; coneTaper(s0, HW - 0.5, 4.5, 4); barrierRun(s0 + 12, s0 + 30, 4.6); }
    { const s0 = S.hill[0] + 60; coneTaper(s0, -2, 2, 6); }
    // a few cones scattered on the hill and the promenade
    [[S.hill[0] + 120, -5], [S.hill[0] + 128, 4], [S.prom[0] + 140, 2.5], [S.prom[0] + 160, -3]].forEach(function (c) { const p = P.at(c[0], c[1]); cones.push([p.x, p.y, p.z, 0]); W.obstacles.push({ x: p.x, z: p.z, r: 0.3 }); });
    P.instanced(barGeo, barMat, bars);
    P.instanced(coneGeo, coneMat, cones);
    // manhole covers
    const manMat = new T.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.4, metalness: 0.7 });
    const mans = [];
    for (let s = 40; s < S.prom[0]; s += 37) { if (inR(s, S.park)) continue; const p = P.at(s, (rnd() - 0.5) * 8); mans.push([p.x, p.y + 0.02, p.z, 0]); }
    P.instanced(new T.CylinderGeometry(0.4, 0.4, 0.04, 18), manMat, mans, false);

    // ---- the parking garage the street cuts through: three decks on columns, low walls,
    // fluorescent tubes, cars parked outside the walls
    {
      const g0 = S.garage[0] - 4, g1 = S.garage[1] + 4;
      const conc = new T.MeshStandardMaterial({ color: 0x9a9690, roughness: 0.9, side: T.DoubleSide });
      const concDark = new T.MeshStandardMaterial({ color: 0x6f6c68, roughness: 0.9, side: T.DoubleSide });
      [3.3, 6.6, 9.9].forEach(function (y, k) {
        P.strip(g0, g1, 0, 2 * (HW + 5), conc, y);
        P.strip(g0, g1, 0, 2 * (HW + 5), concDark, y + 0.45);
        [-1, 1].forEach(function (sd) { P.fence(g0, g1, sd * (HW + 5), y - 0.05, y + 1.4, k === 0 ? concDark : conc, 6, 2); });
      });
      [-1, 1].forEach(function (sd) { P.fence(g0, g1, sd * (HW + 0.6), 0, 1.05, concDark, 6, 2); });
      // the end faces (fascia) above the entrance and exit
      [g0, g1].forEach(function (s) {
        for (let y = 3.3; y < 11; y += 3.3) {
          const p = P.at(s, 0), m = new T.Mesh(new T.BoxGeometry(2 * (HW + 5), 1.5, 0.4), concDark);
          m.position.set(p.x, tr.elev(s) + y + 0.6, p.z); m.rotation.y = p.yaw; m.castShadow = true; root.add(m);
        }
      });
      const cols = [];
      for (let s = g0 + 4; s < g1; s += 9) [-4.2, 4.2, -(HW + 0.6), HW + 0.6, -(HW + 5), HW + 5].forEach(function (lat, j) {
        const p = P.at(s, lat); cols.push([p.x, p.y, p.z, p.yaw]);
        if (j < 2) W.obstacles.push({ x: p.x, z: p.z, r: 0.45 });
      });
      P.instanced(new T.BoxGeometry(0.6, 10.5, 0.6).translate(0, 5.25, 0), conc, cols);
      const tubeMat = new T.MeshStandardMaterial({ color: 0xeafff2, emissive: 0xd8fff0, emissiveIntensity: 3 });
      const tubes = [];
      for (let s = g0 + 8; s < g1; s += 9) [-6, -2, 2, 6].forEach(function (lat) { const p = tr.at(s, lat); tubes.push([p.x, tr.elev(s) + 3.2, p.z, p.yaw]); });
      P.instanced(new T.BoxGeometry(0.12, 0.06, 1.3), tubeMat, tubes, false);
      // parked cars beyond the low walls, in rows facing the street
      const carCols = [[0.75, 0.1, 0.1], [0.12, 0.2, 0.45], [0.85, 0.85, 0.85], [0.08, 0.08, 0.09], [0.55, 0.57, 0.6], [0.6, 0.45, 0.2]];
      const carMat = new T.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.2 });
      const carLists = carCols.map(function () { return []; });
      for (let s = g0 + 6; s < g1 - 4; s += 2.7) [-1, 1].forEach(function (sd) {
        if (rnd() < 0.3) return;
        const p = P.at(s, sd * (HW + 3)), k = Math.floor(rnd() * carCols.length);
        carLists[k].push([p.x, p.y, p.z, p.yaw + (sd > 0 ? -Math.PI / 2 : Math.PI / 2) + (rnd() - 0.5) * 0.08]);
      });
      carCols.forEach(function (c, k) { P.instanced(RR.carGeometry(c), carMat, carLists[k]); });
      P.gate(S.garage[0] - 6, "LEVEL 1 · CUT THROUGH", "#2a2a30", "#3d3d48", HW + 5.5, { h: 3.0, stripe: 0xffc21a });
    }

    // ---- the park: grass, oaks, a pond, benches, wooden kickers
    {
      const treeG = [RR.streetTreeGeometry(3), RR.streetTreeGeometry(8)], treeMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
      const trees = [[], []];
      for (let s = S.park[0] - 5; s < S.park[1] + 5; s += 6) [-1, 1].forEach(function (sd) {
        for (let k = 0; k < 3; k++) {
          if (rnd() > 0.55) continue;
          const lat = sd * (HW + 3 + rnd() * 28), p = P.at(s + rnd() * 4, lat);
          trees[k % 2].push([p.x, p.y - 0.1, p.z, rnd() * 6, 0.85 + rnd() * 0.5]);
          if (Math.abs(lat) < HW + 15) W.obstacles.push({ x: p.x, z: p.z, r: 0.45 });
        }
      });
      P.instanced(treeG[0], treeMat, trees[0]); P.instanced(treeG[1], treeMat, trees[1]);
      // the pond off to the right
      const pm = (S.park[0] + S.park[1]) / 2;
      W.waterAlong(pm - 40, pm + 40, HW + 18, HW + 60, tr.elev(pm) - 0.12, RR.waterMaterial(0x2d4a3e, 0.92));
      const benchMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
      const bench = RR.mergeGeo([RR.paintGeo(new T.BoxGeometry(1.8, 0.06, 0.45).translate(0, 0.45, 0), [0.45, 0.3, 0.18]), RR.paintGeo(new T.BoxGeometry(1.8, 0.4, 0.05).translate(0, 0.7, 0.22), [0.45, 0.3, 0.18]), RR.paintGeo(new T.BoxGeometry(0.06, 0.45, 0.45).translate(-0.8, 0.22, 0), [0.1, 0.1, 0.1]), RR.paintGeo(new T.BoxGeometry(0.06, 0.45, 0.45).translate(0.8, 0.22, 0), [0.1, 0.1, 0.1])]);
      const benches = [];
      for (let s = S.park[0] + 10; s < S.park[1]; s += 22) [-1, 1].forEach(function (sd) { const p = P.at(s, sd * (HW + 2.2)); benches.push([p.x, p.y, p.z, p.yaw + (sd > 0 ? Math.PI / 2 : -Math.PI / 2)]); });
      P.instanced(bench, benchMat, benches);
      const ply = new T.MeshStandardMaterial({ map: RR.plywoodTexture(), roughness: 0.75 });
      P.kicker(S.park[0] + 55, -3.6, 5, 3.4, 1.15, ply);
      P.kicker(S.park[0] + 55, 3.6, 5, 3.4, 1.15, ply);
      P.kicker(S.park[0] + 140, 0, 6, 4.2, 1.5, ply);
      P.kicker(S.park[0] + 175, -4.5, 5, 3.2, 1.1, ply);
      P.kicker(S.park[0] + 175, 4.5, 5, 3.2, 1.1, ply);
      P.gate(S.park[0] + 6, "THE GREEN", "#2a8a3a", "#7ad04a", HW + 3, { h: 6 });
      P.crowd(S.park[0] + 120, S.park[0] + 160, HW + 4, 3, 0.6, rnd);
      P.crowd(S.park[0] + 120, S.park[0] + 160, -(HW + 4), 3, 0.6, rnd);
    }

    // ---- the market: funbox coping, the stair set, stall awnings
    {
      const coping = new T.MeshStandardMaterial({ color: 0xd8b028, roughness: 0.4, metalness: 0.6 });
      const f0 = S.funbox;
      [f0 + 3.5, f0 + 8].forEach(function (s) { const a = P.at(s, -4.2), b = P.at(s, 4.2), m = new T.Mesh(new T.BoxGeometry(8.4, 0.07, 0.12), coping); m.position.set((a.x + b.x) / 2, tr.elev(s) + 0.85 + 0.12 + 0.035, (a.z + b.z) / 2); m.rotation.y = a.yaw; root.add(m); });
      // stairs: seven steps across the full width, over the drop in the ribbon
      const st = S.stairs, stepMat = new T.MeshStandardMaterial({ color: 0xa8a39a, roughness: 0.85 });
      for (let k = 0; k < 7; k++) {
        const s = st + k * 1.3 / 7, p = P.at(s + 0.09, 0), y = tr.elev(s) + 0.13;
        const m = new T.Mesh(new T.BoxGeometry(2 * (HW + 1.6), 0.24, 1.3 / 7 + 0.02), stepMat);
        m.position.set(p.x, y - 0.12, p.z); m.rotation.y = p.yaw; m.receiveShadow = true; m.castShadow = true;
        root.add(m);
      }
      const railM = new T.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.25, metalness: 0.9 });
      [-6.5, 6.5].forEach(function (lat) {
        const a = P.at(st - 1, lat), b = P.at(st + 2.6, lat);
        const top0 = tr.elev(st - 1) + 1.0, top1 = tr.elev(st + 2.6) + 1.0;
        root.add(new T.Mesh(RR.tube([a.x, top0, a.z], [b.x, top1, b.z], 0.04), railM));
        [[a, top0, st - 1], [b, top1, st + 2.6]].forEach(function (e) { root.add(new T.Mesh(RR.tube([e[0].x, tr.elev(e[2]) + 0.1, e[0].z], [e[0].x, e[1], e[0].z], 0.035), railM)); });
        W.obstacles.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, r: 0.2 });
      });
      P.gate(st - 30, "MIND THE STAIRS", "#c22a1c", "#ff7a2a", HW + 4.2, { h: 6.5 });
      const awn = [], awnCols = ["#d12a2a", "#2a64d1", "#e8b51c", "#2aa34a"];
      const awnMats = awnCols.map(function (c) { return new T.MeshStandardMaterial({ color: c, roughness: 0.7, side: T.DoubleSide }); });
      for (let s = S.market[0] + 40; s < S.market[1] - 10; s += 13) [-1, 1].forEach(function (sd) {
        if (Math.abs(s - st) < 8) return;
        const p = P.at(s, sd * (HW + 3.4)), k = Math.floor(rnd() * 4), g = new T.Group();
        const top = new T.Mesh(new T.PlaneGeometry(3.2, 2.6), awnMats[k]); top.rotation.x = -Math.PI / 2 + 0.25 * sd; top.position.y = 2.7; g.add(top);
        [-1.4, 1.4].forEach(function (x) { [-1.1, 1.1].forEach(function (z) { const leg = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 2.6, 5), poleMat); leg.position.set(x, 1.3, z); g.add(leg); }); });
        const table2 = new T.Mesh(new T.BoxGeometry(2.6, 0.08, 1.2), new T.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.8 })); table2.position.y = 0.9; g.add(table2);
        g.position.set(p.x, p.y, p.z); g.rotation.y = p.yaw; g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
        root.add(g);
        awn.push(k);
      });
    }

    // ---- the bayou: water down the left bank, railing, oaks up the right bank, two bridges
    {
      const wy = S.waterY;
      W.waterAlong(S.prom[0] - 40, tr.L + 160, -(HW + 6), -420, wy, RR.waterMaterial(0x3b4a36, 0.94));
      const railM = new T.MeshStandardMaterial({ color: 0x2e3a3a, roughness: 0.4, metalness: 0.7 });
      P.fence(S.prom[0] + 5, tr.L - 3, -(HW + 1.9), 0.95, 1.05, railM, 4, 2);
      const posts = [];
      for (let s = S.prom[0] + 5; s < tr.L - 3; s += 2.5) { const p = P.at(s, -(HW + 1.9)); posts.push([p.x, p.y, p.z, p.yaw]); }
      P.instanced(new T.CylinderGeometry(0.03, 0.03, 1.05, 5).translate(0, 0.52, 0), railM, posts);
      const oaks = [RR.oakGeometry(5), RR.oakGeometry(11)], oakMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
      const ol = [[], []];
      for (let s = S.prom[0] - 10; s < tr.L + 40; s += 9) {
        if (rnd() < 0.7) { const p = P.at(s, HW + 9 + rnd() * 30); ol[Math.floor(rnd() * 2)].push([p.x, p.y - 0.2, p.z, rnd() * 6, 0.6 + rnd() * 0.35]); }
        if (rnd() < 0.25) { const p = P.at(s, -(HW + 120 + rnd() * 100)); ol[Math.floor(rnd() * 2)].push([p.x, W.course.far(p.x, p.z) + 1.4, p.z, rnd() * 6, 0.7 + rnd() * 0.3]); }
      }
      P.instanced(oaks[0], oakMat, ol[0]); P.instanced(oaks[1], oakMat, ol[1]);
      const concB = new T.MeshStandardMaterial({ color: 0xb2aca2, roughness: 0.85 });
      S.bridges.forEach(function (s, k) {
        const p = P.at(s, 0), y = tr.elev(s) + 8 + k * 2, g = new T.Group();
        const deck = new T.Mesh(new T.BoxGeometry(240, 1.4, 14), concB); deck.position.y = y; g.add(deck);
        const lip = new T.Mesh(new T.BoxGeometry(240, 1.0, 0.4), concB); lip.position.set(0, y + 1.1, 6.8); g.add(lip);
        const lip2 = lip.clone(); lip2.position.z = -6.8; g.add(lip2);
        [-(HW + 5), HW + 5, -40, 40, -80, 80].forEach(function (lat) {
          const c = new T.Mesh(new T.CylinderGeometry(1.0, 1.1, 30, 14), concB); c.position.set(lat, y - 15, 0); g.add(c);
          if (Math.abs(lat) < 20) W.obstacles.push({ x: p.x + p.rx * lat, z: p.z + p.rz * lat, r: 1.1 });
        });
        g.position.set(p.x, 0, p.z); g.rotation.y = p.yaw;
        g.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        root.add(g);
      });
      P.gate(S.prom[0] + 4, "BUFFALO BAYOU", "#1f6a8a", "#3ab4c8", HW + 2.4, { h: 6 });
    }

    // ---- start and finish
    P.gate(S.start, "DOWNTOWN DROP", "#ff4a1c", "#ffb31a", HW + 1.6, { h: 7.5 });
    P.gate(S.finish, "FINISH", "#e8262a", "#ff8a3d", HW + 2.6, { h: 7.5 });
    P.crowd(S.start - 20, S.start + 40, HW + 3, 3, 0.7, rnd);
    P.crowd(S.start - 20, S.start + 40, -(HW + 3), 3, 0.7, rnd);
    P.crowd(S.finish - 60, S.finish + 30, HW + 3, 3, 0.75, rnd);
    { const b = []; for (let s = S.finish - 60; s < S.finish + 30; s += 1.9) { const p = P.at(s, HW + 2.2); b.push([p.x, p.y, p.z, p.yaw]); } P.instanced(barGeo, barMat, b); }
  };
})(window.RR = window.RR || {});
