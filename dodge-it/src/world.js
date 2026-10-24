// The gym: a maple floor with the court painted on, block walls with padded mats, bleachers down one side, the
// benches and scorer's table down the other, basketball hoops on the end walls, banners, a scoreboard that keeps
// the real score, and a truss ceiling full of lights. Repeated parts are instanced; one shadow-casting light.
globalThis.SB = globalThis.SB || {};
(function (SB) {
  "use strict";
  const THREE = globalThis.THREE;
  const W = {};
  W.TEAM_COL = [0x2f86ff, 0xffb81c];          // Blue (team 0, the +z half) and Gold (team 1)
  W.TEAM_NAME = ["BLUE", "GOLD"];
  const CFG = () => SB.CFG;

  function canvas(w, h, draw) {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    draw(cv.getContext("2d"), w, h);
    return cv;
  }
  function tex(cv, rx, ry, srgb) {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx || 1, ry || 1);
    t.anisotropy = 8;
    if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  // Seeded noise so every screen's gym looks the same.
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

  // ------------------------------------------------------------------ textures
  function woodTexture() {
    // boards run along z; 32 boards across a 4 m tile (12.5 cm each), staggered butt joints, a little grain
    return canvas(1024, 1024, function (g, w, h) {
      const bw = w / 32;
      for (let i = 0; i < 32; i++) {
        let y = -rnd() * 600;
        while (y < h) {
          const len = 300 + rnd() * 480;
          const l = 63 + rnd() * 8, hue = 33 + rnd() * 5;
          g.fillStyle = "hsl(" + hue + ",50%," + l + "%)";
          g.fillRect(i * bw, y, bw, len);
          // grain
          for (let k = 0; k < 4; k++) {
            g.strokeStyle = "hsla(" + (hue - 4) + ",45%," + (l - 10 - rnd() * 8) + "%," + (0.12 + rnd() * 0.16) + ")";
            g.lineWidth = 0.6 + rnd() * 1.4;
            const x0 = i * bw + rnd() * bw;
            g.beginPath(); g.moveTo(x0, y); g.bezierCurveTo(x0 + rnd() * 6 - 3, y + len * 0.3, x0 + rnd() * 6 - 3, y + len * 0.7, x0 + rnd() * 4 - 2, y + len); g.stroke();
          }
          g.fillStyle = "rgba(60,35,15,0.45)"; g.fillRect(i * bw, y + len - 1, bw, 1.5);
          y += len;
        }
        g.fillStyle = "rgba(70,40,18,0.4)"; g.fillRect(i * bw, 0, 1.2, h);
      }
    });
  }
  function blockTexture(base) {
    return canvas(512, 512, function (g, w, h) {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      const bh = 64, bw = 128;
      for (let r = 0; r < h / bh; r++) {
        for (let c = -1; c < w / bw + 1; c++) {
          const x = c * bw + (r % 2 ? bw / 2 : 0), y = r * bh;
          g.fillStyle = "rgba(0,0,0," + (rnd() * 0.05) + ")"; g.fillRect(x + 3, y + 3, bw - 6, bh - 6);
        }
        g.fillStyle = "rgba(0,0,0,0.16)"; g.fillRect(0, r * bh, w, 4);
        for (let c = 0; c <= w / bw; c++) g.fillRect(c * bw + (r % 2 ? bw / 2 : 0), r * bh, 4, bh);
      }
    });
  }
  function padTexture(col) {
    return canvas(256, 256, function (g, w, h) {
      g.fillStyle = col; g.fillRect(0, 0, w, h);
      g.fillStyle = "rgba(0,0,0,0.22)"; g.fillRect(0, 0, 4, h); g.fillRect(w / 2 - 2, 0, 4, h);
      g.fillStyle = "rgba(255,255,255,0.06)"; g.fillRect(6, 0, w / 2 - 12, h);
    });
  }
  function bannerTexture(title, sub, col, img) {
    return canvas(256, 512, function (g, w, h) {
      g.fillStyle = col; g.fillRect(0, 0, w, h);
      g.fillStyle = "rgba(255,255,255,0.92)"; g.fillRect(0, h - 70, w, 6); g.fillRect(0, 26, w, 6);
      g.beginPath(); g.moveTo(0, h - 40); g.lineTo(w / 2, h); g.lineTo(w, h - 40); g.lineTo(w, h); g.lineTo(0, h); g.closePath();
      g.fillStyle = "rgba(0,0,0,0.0)";
      g.textAlign = "center"; g.fillStyle = "#fff";
      if (img) {
        g.font = "bold 30px 'Arial Black', Impact, sans-serif"; g.fillText(title, w / 2, 110);
        g.font = "bold 22px Arial, sans-serif"; g.fillText(sub, w / 2, h - 96);
      } else {
        g.font = "bold 64px 'Arial Black', Impact, sans-serif";
        title.split(" ").forEach((t, i) => g.fillText(t, w / 2, 180 + i * 80));
        g.font = "bold 26px Arial, sans-serif"; g.fillText(sub, w / 2, h - 110);
      }
    });
  }

  // ------------------------------------------------------------------ build
  W.build = function (V) {
    const scene = V.scene, C = CFG();
    const WX = C.WALL_X, WZ = C.WALL_Z, H = C.CEIL;
    scene.background = new THREE.Color(0x1d2026);

    // light: the sky through the windows + one big "skylight" sun for the shadows
    const hemi = new THREE.HemisphereLight(0xfff6e6, 0x8a6a48, 1.25);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.7);
    sun.position.set(6, 22, 9);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -WX; sc.right = WX; sc.top = WZ; sc.bottom = -WZ; sc.near = 4; sc.far = 50;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
    scene.add(sun); scene.add(sun.target);
    W.sun = sun;

    // floor
    const woodT = tex(woodTexture(), WX * 2 / 4, WZ * 2 / 4);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(WX * 2, WZ * 2), new THREE.MeshStandardMaterial({ map: woodT, roughness: 0.42, metalness: 0.0 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    courtLines(scene);

    // walls
    const blockT = tex(blockTexture("#e6dfd2"), 8, 4);
    const wallMat = new THREE.MeshStandardMaterial({ map: blockT, roughness: 0.92 });
    const sideGeo = new THREE.PlaneGeometry(WZ * 2, H), endGeo = new THREE.PlaneGeometry(WX * 2, H);
    blockT.repeat.set(WZ * 2 / 4, H / 2);
    const endT = blockT.clone(); endT.needsUpdate = true; endT.repeat.set(WX * 2 / 4, H / 2);
    const endMat = new THREE.MeshStandardMaterial({ map: endT, roughness: 0.92 });
    [[WX, -Math.PI / 2], [-WX, Math.PI / 2]].forEach(function (a) {
      const m = new THREE.Mesh(sideGeo, wallMat); m.position.set(a[0], H / 2, 0); m.rotation.y = a[1]; m.receiveShadow = true; scene.add(m);
    });
    [[WZ, Math.PI], [-WZ, 0]].forEach(function (a) {
      const m = new THREE.Mesh(endGeo, endMat); m.position.set(0, H / 2, a[0]); m.rotation.y = a[1]; m.receiveShadow = true; scene.add(m);
    });
    // padded mats along the bottom of every wall (team colours behind each team's baseline)
    const padH = 2.1, padD = 0.12;
    const grey = new THREE.MeshStandardMaterial({ map: tex(padTexture("#3b4250"), WZ * 2 / 2, 1), roughness: 0.7 });
    [[WX - padD / 2, 0], [-WX + padD / 2, 0]].forEach(function (a) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(padD, padH, WZ * 2), grey); m.position.set(a[0], padH / 2, 0); m.receiveShadow = true; scene.add(m);
    });
    [[WZ - padD / 2, 0], [-WZ + padD / 2, 1]].forEach(function (a) {
      const col = "#" + new THREE.Color(W.TEAM_COL[a[1]]).multiplyScalar(0.8).getHexString();
      const m = new THREE.Mesh(new THREE.BoxGeometry(WX * 2, padH, padD), new THREE.MeshStandardMaterial({ map: tex(padTexture(col), WX * 2 / 2, 1), roughness: 0.7 }));
      m.position.set(0, padH / 2, a[0]); m.receiveShadow = true; scene.add(m);
    });
    // a high row of windows down both sides
    const glass = new THREE.MeshStandardMaterial({ color: 0xbfd8f0, emissive: 0xa9cbea, emissiveIntensity: 0.85, roughness: 0.2 });
    const frame = new THREE.MeshStandardMaterial({ color: 0x59606c, roughness: 0.6, metalness: 0.4 });
    const nWin = 9, winW = (WZ * 2 - 4) / nWin;
    const winGeo = new THREE.PlaneGeometry(winW - 0.5, 1.9), mullGeo = new THREE.BoxGeometry(0.12, 2.2, 0.12);
    [WX - 0.02, -WX + 0.02].forEach(function (x) {
      const s = x > 0 ? -1 : 1;
      const wins = new THREE.InstancedMesh(winGeo, glass, nWin), mulls = new THREE.InstancedMesh(mullGeo, frame, nWin + 1);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s * Math.PI / 2);
      for (let i = 0; i < nWin; i++) { m4.compose(new THREE.Vector3(x, 8.4, -WZ + 2 + winW * (i + 0.5)), q, new THREE.Vector3(1, 1, 1)); wins.setMatrixAt(i, m4); }
      for (let i = 0; i <= nWin; i++) { m4.compose(new THREE.Vector3(x + s * 0.05, 8.4, -WZ + 2 + winW * i), q, new THREE.Vector3(1, 1, 1)); mulls.setMatrixAt(i, m4); }
      scene.add(wins); scene.add(mulls);
    });

    // ceiling and trusses, with rows of hanging lights
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(WX * 2, WZ * 2), new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 1 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = H; scene.add(ceil);
    const steel = new THREE.MeshStandardMaterial({ color: 0x6b7480, roughness: 0.5, metalness: 0.6 });
    const nT = 7, chordGeo = new THREE.BoxGeometry(WX * 2, 0.16, 0.16), webGeo = new THREE.BoxGeometry(0.08, 1.25, 0.08);
    const chords = new THREE.InstancedMesh(chordGeo, steel, nT * 2), webs = new THREE.InstancedMesh(webGeo, steel, nT * 22);
    const m4 = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1), qi = new THREE.Quaternion();
    let wi = 0;
    for (let i = 0; i < nT; i++) {
      const z = -WZ + (WZ * 2) * (i + 0.5) / nT;
      m4.compose(new THREE.Vector3(0, H - 0.25, z), qi, one); chords.setMatrixAt(i * 2, m4);
      m4.compose(new THREE.Vector3(0, H - 1.55, z), qi, one); chords.setMatrixAt(i * 2 + 1, m4);
      for (let k = 0; k < 22; k++) {
        const x = -WX + 0.5 + k * (WX * 2 - 1) / 21;
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (k % 2 ? 1 : -1) * 0.55);
        m4.compose(new THREE.Vector3(x, H - 0.9, z), q, one); webs.setMatrixAt(wi++, m4);
      }
    }
    scene.add(chords); scene.add(webs);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dc, emissiveIntensity: 2.2 });
    const housing = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.6, metalness: 0.5 });
    const lampGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.05, 24), hoodGeo = new THREE.CylinderGeometry(0.3, 0.48, 0.42, 24, 1, true);
    const nL = nT * 4, lamps = new THREE.InstancedMesh(lampGeo, lampMat, nL), hoods = new THREE.InstancedMesh(hoodGeo, housing, nL);
    let li = 0;
    for (let i = 0; i < nT; i++) for (let k = 0; k < 4; k++) {
      const x = -6.6 + k * 4.4, z = -WZ + (WZ * 2) * (i + 0.5) / nT;
      m4.compose(new THREE.Vector3(x, H - 2.25, z), qi, one); lamps.setMatrixAt(li, m4);
      m4.compose(new THREE.Vector3(x, H - 2.02, z), qi, one); hoods.setMatrixAt(li, m4); li++;
    }
    scene.add(lamps); scene.add(hoods);

    bleachers(scene);
    benches(scene);
    hoops(scene);
    banners(scene);
    W.board = scoreboard(scene);
    W.lastBoard = "";
    return W;
  };

  // ------------------------------------------------------------------ court markings
  function courtLines(scene) {
    const C = CFG(), hw = C.COURT_W / 2, hl = C.COURT_L / 2, lw = 0.07;
    const white = new THREE.MeshBasicMaterial({ color: 0xf6f3ea });
    const add = function (w, d, x, z, mat) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat || white);
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.004, z); scene.add(m); return m;
    };
    add(C.COURT_W + lw, lw, 0, hl); add(C.COURT_W + lw, lw, 0, -hl);
    add(lw, C.COURT_L, hw, 0); add(lw, C.COURT_L, -hw, 0);
    add(C.COURT_W, lw * 1.6, 0, 0, new THREE.MeshBasicMaterial({ color: 0xe8413a }));     // the centre line, red
    // attack lines, dashed
    for (const z of [3, -3]) for (let x = -hw + 0.3; x < hw; x += 0.9) add(0.5, lw, x + 0.25, z);
    // team halves, faintly tinted, and the centre circle
    [0, 1].forEach(function (t) {
      const m = add(C.COURT_W, hl - 0.1, 0, (t === 0 ? 1 : -1) * (hl / 2 + 0.05), new THREE.MeshBasicMaterial({ color: W.TEAM_COL[t], transparent: true, opacity: 0.07, depthWrite: false }));
      m.position.y = 0.003;
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.75, 1.82, 64), white);
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.004; scene.add(ring);
    // a big painted title in each half
    [0, 1].forEach(function (t) {
      const cv = canvas(1024, 256, function (g, w, h) {
        g.font = "bold 170px 'Arial Black', Impact, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillStyle = "rgba(255,255,255,0.0)"; g.fillRect(0, 0, w, h);
        g.fillStyle = "#" + new THREE.Color(W.TEAM_COL[t]).getHexString(); g.globalAlpha = 0.55; g.fillText("DODGE IT", w / 2, h / 2 + 8);
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial({ map: tex(cv, 1, 1), transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.rotation.z = t === 0 ? 0 : Math.PI;
      m.position.set(0, 0.005, (t === 0 ? 1 : -1) * 7.5);
      scene.add(m);
    });
  }

  // ------------------------------------------------------------------ bleachers (the -x side)
  function bleachers(scene) {
    const C = CFG(), len = C.WALL_Z * 2 - 6, rows = 6, x0 = -C.WALL_X + 0.15, step = 0.42, rise = 0.42;
    const seatMat = new THREE.MeshStandardMaterial({ color: 0xb98a52, roughness: 0.55 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x8c96a3, roughness: 0.45, metalness: 0.7 });
    const deck = new THREE.MeshStandardMaterial({ color: 0x4a515c, roughness: 0.8 });
    for (let r = 0; r < rows; r++) {
      const x = x0 + (rows - r - 0.5) * step * 2.0 - 0.0, y = (r + 1) * rise;
      const xx = -C.WALL_X + 0.4 + (rows - 1 - r) * 0.85 + 0.4;
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, len), seatMat);
      seat.position.set(xx - 0.15, y, 0); seat.castShadow = true; seat.receiveShadow = true; scene.add(seat);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.05, len), deck);
      foot.position.set(xx, y - rise * 0.62, 0); foot.receiveShadow = true; scene.add(foot);
      const riser = new THREE.Mesh(new THREE.BoxGeometry(0.04, y - rise * 0.62, len), deck);
      riser.position.set(xx + 0.42, (y - rise * 0.62) / 2, 0); scene.add(riser);
      void x;
    }
    // end rails
    const railGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.0, 10);
    for (const z of [len / 2, -len / 2]) for (let r = 0; r < rows; r++) {
      const xx = -C.WALL_X + 0.4 + (rows - 1 - r) * 0.85 + 0.4;
      const m = new THREE.Mesh(railGeo, metal); m.position.set(xx, (r + 1) * rise + 0.45, z); scene.add(m);
    }
  }

  // ------------------------------------------------------------------ benches and the scorer's table
  function benches(scene) {
    const C = CFG();
    const wood = new THREE.MeshStandardMaterial({ color: 0x9c6b3c, roughness: 0.6 });
    const leg = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.5, metalness: 0.5 });
    [[1, 0], [-1, 1]].forEach(function (a) {
      const s = a[0], x = s * (C.BENCH_X + 0.75);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.07, 9.4), new THREE.MeshStandardMaterial({ color: W.TEAM_COL[a[1]], roughness: 0.5 }));
      seat.position.set(x, 0.45, s * 6.5); seat.castShadow = true; scene.add(seat);
      for (const dz of [-4.4, -1.5, 1.5, 4.4]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.44, 0.06), leg); l.position.set(x, 0.22, s * 6.5 + dz); scene.add(l); }
    });
    const table = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.78, 3.6), new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.5 }));
    table.position.set(C.WALL_X - 1.4, 0.39, 0); table.castShadow = true; scene.add(table);
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.6), new THREE.MeshStandardMaterial({ map: tex(canvas(512, 96, function (g, w, h) {
      g.fillStyle = "#14171c"; g.fillRect(0, 0, w, h); g.font = "bold 54px 'Arial Black', Impact, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillStyle = "#" + new THREE.Color(W.TEAM_COL[0]).getHexString(); g.fillText("DODGE", w / 2 - 70, h / 2 + 3);
      g.fillStyle = "#" + new THREE.Color(W.TEAM_COL[1]).getHexString(); g.fillText("IT", w / 2 + 120, h / 2 + 3);
    })), roughness: 0.6 }));
    skirt.position.set(C.WALL_X - 1.81, 0.42, 0); skirt.rotation.y = -Math.PI / 2; scene.add(skirt);
    // a ball rack at each end of the table (spare balls, scenery)
    const ballMat = W.ballMaterial();
    const g = new THREE.SphereGeometry(SB.CFG.BALL_R, 20, 14);
    for (const z of [2.6, -2.6]) for (let k = 0; k < 3; k++) {
      const b = new THREE.Mesh(g, ballMat); b.position.set(C.WALL_X - 1.4 + (k - 1) * 0.24, 0.11, z); b.castShadow = true; scene.add(b);
    }
  }

  // ------------------------------------------------------------------ hoops on the end walls
  function hoops(scene) {
    const C = CFG();
    const glass = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.1 });
    const edge = new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 0.5, metalness: 0.4 });
    const orange = new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.4, metalness: 0.4 });
    const net = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.7 });
    [1, -1].forEach(function (s) {
      const z = s * (C.WALL_Z - 1.2);
      const board = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.05, 0.04), glass); board.position.set(0, 3.45, z); scene.add(board);
      const fr = new THREE.Mesh(new THREE.BoxGeometry(1.86, 1.11, 0.03), edge); fr.position.set(0, 3.45, z + s * 0.03); scene.add(fr);
      const sq = new THREE.Mesh(new THREE.PlaneGeometry(0.59, 0.45), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: false, transparent: true, opacity: 0.0 }));
      sq.position.set(0, 3.25, z - s * 0.025); scene.add(sq);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.012, 8, 32), orange); rim.rotation.x = Math.PI / 2; rim.position.set(0, 3.05, z - s * 0.38); scene.add(rim);
      const n = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.15, 0.42, 12, 3, true), net); n.position.set(0, 2.83, z - s * 0.38); scene.add(n);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.2), edge); arm.position.set(0, 3.45, s * (C.WALL_Z - 0.6)); scene.add(arm);
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.5), edge); brace.position.set(0, 4.1, s * (C.WALL_Z - 0.55)); brace.rotation.x = s * 0.5; scene.add(brace);
    });
  }

  // ------------------------------------------------------------------ banners
  function banners(scene) {
    const C = CFG();
    const list = [["DODGE IT", "BLUE", W.TEAM_COL[0]], ["DODGE IT", "GOLD", W.TEAM_COL[1]], ["CHAMPIONS", "DODGEBALL", 0xc0392b], ["CHAMPIONS", "DODGEBALL", 0x1f8a5b]];
    list.forEach(function (b, i) {
      const col = "#" + new THREE.Color(b[2]).getHexString();
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 3), new THREE.MeshStandardMaterial({ map: tex(bannerTexture(b[0], b[1], col), 1, 1), roughness: 0.85, side: THREE.DoubleSide }));
      const z = -9 + i * 6;
      m.position.set(C.WALL_X - 0.05, 5.4, z); m.rotation.y = -Math.PI / 2;
      scene.add(m);
    });
    // the studio's banner on the bleacher side, high up
    const img = new Image();
    const cv = canvas(256, 512, function () {});
    const t = tex(cv, 1, 1);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 3.2), new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 }));
    m.position.set(-C.WALL_X + 0.05, 6.2, 0); m.rotation.y = Math.PI / 2; scene.add(m);
    img.onload = function () {
      const g = cv.getContext("2d");
      const bg = bannerTexture("A CTSG GAME", "CALAMITY TECH", "#14171c", true);
      g.drawImage(bg, 0, 0);
      g.drawImage(img, 28, 150, 200, 200);
      t.needsUpdate = true;
    };
    img.src = "assets/brand/ctsg-seal-color-512.png";
  }

  // ------------------------------------------------------------------ scoreboard (the +x wall, high)
  function scoreboard(scene) {
    const C = CFG();
    const cv = document.createElement("canvas"); cv.width = 1024; cv.height = 384;
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.1, 5.4), new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.6 }));
    box.position.set(C.WALL_X - 0.25, 6.4, 0); scene.add(box);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.95), new THREE.MeshBasicMaterial({ map: t }));
    face.position.set(C.WALL_X - 0.46, 6.4, 0); face.rotation.y = -Math.PI / 2; scene.add(face);
    // a second one over the far end, for the gold side
    const face2 = face.clone(); const box2 = box.clone();
    box2.rotation.y = Math.PI / 2; box2.position.set(0, 7.4, -C.WALL_Z + 0.25); scene.add(box2);
    face2.position.set(0, 7.4, -C.WALL_Z + 0.46); face2.rotation.y = 0; scene.add(face2);
    const face3 = face.clone(); const box3 = box.clone();
    box3.rotation.y = Math.PI / 2; box3.position.set(0, 7.4, C.WALL_Z - 0.25); scene.add(box3);
    face3.position.set(0, 7.4, C.WALL_Z - 0.46); face3.rotation.y = Math.PI; scene.add(face3);
    return { cv: cv, t: t };
  }
  function drawBoard(sim) {
    const B = W.board, g = B.cv.getContext("2d"), w = B.cv.width, h = B.cv.height;
    g.fillStyle = "#0b0d10"; g.fillRect(0, 0, w, h);
    g.textAlign = "center"; g.textBaseline = "middle";
    const hex = (c) => "#" + new THREE.Color(c).getHexString();
    g.font = "bold 64px 'Arial Black', Impact, sans-serif";
    g.fillStyle = hex(W.TEAM_COL[0]); g.fillText("BLUE", w * 0.2, 70);
    g.fillStyle = hex(W.TEAM_COL[1]); g.fillText("GOLD", w * 0.8, 70);
    g.font = "bold 190px 'Courier New', monospace";
    g.fillStyle = "#ff3b2f"; g.fillText(String(sim.score[0]), w * 0.2, 230); g.fillText(String(sim.score[1]), w * 0.8, 230);
    g.font = "bold 46px 'Arial Black', Impact, sans-serif"; g.fillStyle = "#ffd23a";
    g.fillText("ROUND", w / 2, 120); g.font = "bold 120px 'Courier New', monospace"; g.fillText(String(Math.max(1, sim.round)), w / 2, 220);
    // players still in, as lights
    [0, 1].forEach(function (t) {
      const team = sim.players.filter((p) => p.team === t);
      team.forEach(function (p, k) {
        g.fillStyle = p.out ? "#2a2d33" : hex(W.TEAM_COL[t]);
        g.beginPath(); g.arc((t === 0 ? w * 0.2 : w * 0.8) + (k - (team.length - 1) / 2) * 36, 340, 13, 0, Math.PI * 2); g.fill();
      });
    });
    B.t.needsUpdate = true;
  }

  // ------------------------------------------------------------------ balls
  let ballMat = null;
  W.ballMaterial = function () {
    if (ballMat) return ballMat;
    // a red playground ball with a pebbled feel and two seams
    const cv = canvas(256, 128, function (g, w, h) {
      g.fillStyle = "#d4262b"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 1400; i++) { g.fillStyle = "rgba(0,0,0," + (rnd() * 0.12) + ")"; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
      g.fillStyle = "rgba(120,10,14,0.85)"; g.fillRect(0, h / 2 - 2, w, 4); g.fillRect(w / 4 - 2, 0, 4, h); g.fillRect(w * 3 / 4 - 2, 0, 4, h);
    });
    ballMat = new THREE.MeshStandardMaterial({ map: tex(cv, 1, 1), roughness: 0.55, metalness: 0.0 });
    return ballMat;
  };

  W.update = function (V, sim) {
    if (!W.board || !sim || !sim.players) return;
    const key = sim.score.join() + "|" + sim.round + "|" + sim.players.map((p) => (p.out ? 1 : 0)).join("");
    if (key !== W.lastBoard) { W.lastBoard = key; drawBoard(sim); }
  };
  SB.World = W;
})(globalThis.SB);
