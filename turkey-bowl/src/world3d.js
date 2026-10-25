// Turkey Bowl 3D — the backyard: sky, light, lawn, chalk, fence, trees,
// houses, the Thanksgiving table on the sideline, and the leaves.
//
// World units are yards. The field is centred on the origin: X across
// (touchlines at ±FIELD_MID), Z along (end lines at ±60, goal lines at ±50).
// The offense always attacks toward -Z (see util.js), so the yard is built
// symmetric enough that nobody notices it turning round at a change of
// possession — the only thing that follows the teams is the end-zone paint.
(function () {
  const THREE = window.THREE;
  const D = window.TBData;
  const R = window.TBRig;

  const HALF_W = D.FIELD_W / 2;
  const FENCE_X = HALF_W + D.YARD.SIDE_MARGIN;
  const FENCE_Z = 60 + D.YARD.END_MARGIN;

  function canvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }
  function tex(c, repeat) {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat[0], repeat[1]);
    }
    t.anisotropy = 8;
    return t;
  }

  // Smooth value noise, for the lawn's large-scale colour.
  function makeNoise(seed) {
    const r = R.rng(seed);
    const N = 256;
    const perm = [];
    const val = [];
    for (let i = 0; i < N; i++) { perm.push(i); val.push(r()); }
    for (let i = N - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    function lat(x, y) { return val[(perm[(x & 255)] + (y & 255)) & 255]; }
    function n2(x, y) {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const a = lat(xi, yi), b = lat(xi + 1, yi), c = lat(xi, yi + 1), d = lat(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    return function (x, y) {
      return n2(x, y) * 0.5 + n2(x * 2.1 + 17, y * 2.1 + 9) * 0.3 + n2(x * 4.3 + 3, y * 4.3 + 41) * 0.2;
    };
  }

  // ---- sky ------------------------------------------------------------------

  function sRGB(hex) {
    const c = new THREE.Color(hex);
    // Color stores linear; the sky shader writes display values directly.
    return new THREE.Vector3(Math.pow(c.r, 1 / 2.2), Math.pow(c.g, 1 / 2.2), Math.pow(c.b, 1 / 2.2));
  }

  function buildSky(sunDir) {
    const geo = new THREE.SphereGeometry(900, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        sunDir: { value: sunDir.clone() },
        top: { value: sRGB("#5f86b4") },
        mid: { value: sRGB("#a9b9c9") },
        horizon: { value: sRGB("#f2c38c") },
        glow: { value: sRGB("#ffb56b") },
        below: { value: sRGB("#9a8a6a") }
      },
      vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: [
        "uniform vec3 sunDir, top, mid, horizon, glow, below; varying vec3 vDir;",
        "void main(){",
        "  vec3 d = normalize(vDir); float h = d.y;",
        "  float s = max(dot(d, normalize(sunDir)), 0.0);",
        "  vec3 hz = mix(horizon, glow, pow(s, 4.0) * 0.8);",
        "  vec3 c = mix(hz, mid, smoothstep(0.0, 0.2, h));",
        "  c = mix(c, top, smoothstep(0.18, 0.75, h));",
        "  c += vec3(1.0, 0.85, 0.6) * (pow(s, 900.0) * 2.5 + pow(s, 60.0) * 0.28 + pow(s, 8.0) * 0.12);",
        "  c = mix(c, below, smoothstep(0.0, -0.08, h));",
        "  gl_FragColor = vec4(c, 1.0);",
        "}"
      ].join("\n")
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    return sky;
  }

  function cloudTexture(seed) {
    const c = canvas(256, 128);
    const ctx = c.getContext("2d");
    const r = R.rng(seed);
    for (let i = 0; i < 26; i++) {
      const x = 40 + r() * 176, y = 50 + r() * 40, rad = 18 + r() * 34;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, "rgba(255,240,222,0.55)");
      g.addColorStop(1, "rgba(255,240,222,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    }
    return tex(c);
  }

  // ---- lawn -----------------------------------------------------------------

  function grassTexture() {
    const c = canvas(256, 256);
    const ctx = c.getContext("2d");
    const r = R.rng(77);
    // Near-white on average: the texture MULTIPLIES the lawn's vertex colour,
    // and a mid-grey here (0.25 in linear light) turned the grass nearly black.
    ctx.fillStyle = "#e6e6e6";
    ctx.fillRect(0, 0, 256, 256);
    // Blades: short strokes of lighter and darker grey, grain only.
    for (let i = 0; i < 5200; i++) {
      const x = r() * 256, y = r() * 256;
      const v = 170 + (r() * 85 | 0);
      ctx.strokeStyle = "rgba(" + v + "," + v + "," + v + ",0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 5);
      ctx.stroke();
    }
    return tex(c, [1, 1]);
  }

  function buildGround(world) {
    const noise = makeNoise(11);
    const W = FENCE_X * 2 + 180;
    const L = FENCE_Z * 2 + 180;
    const geo = new THREE.PlaneGeometry(W, L, 150, 190);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    // Brighter than the 2D palette: ACES tone mapping and the fog both pull
    // the lawn toward olive-brown.
    const lawn = new THREE.Color("#6f8a3a");
    const lush = new THREE.Color("#5a7a34");
    const worn = new THREE.Color("#93884f");
    const dirt = new THREE.Color("#7a6443");
    const rough = new THREE.Color("#556a2c");
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const n = noise(x * 0.06, z * 0.06);
      const n2 = noise(x * 0.23 + 50, z * 0.23);
      c.copy(lawn).lerp(lush, Math.max(0, n - 0.45) * 1.6);
      // A trodden lane up the middle, heaviest between the 30s.
      const lane = Math.exp(-Math.pow(x / 9, 2)) * Math.exp(-Math.pow(z / 42, 2));
      c.lerp(worn, Math.min(0.75, lane * (0.5 + n2 * 0.6)));
      // Bare patches where the lines keep meeting.
      const bare = Math.max(0, n2 - 0.62) * 3 * Math.exp(-Math.pow(x / 14, 2)) * (Math.abs(z) < 48 ? 1 : 0.2);
      c.lerp(dirt, Math.min(0.85, bare));
      // Past the fence: longer, darker grass.
      const out = Math.max(Math.abs(x) - FENCE_X, Math.abs(z) - FENCE_Z);
      if (out > 0) c.lerp(rough, Math.min(1, out / 6));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      uv.setXY(i, x / 3.2, z / 3.2);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshStandardMaterial({ map: grassTexture(), vertexColors: true, roughness: 1, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    world.scene.add(mesh);
  }

  // ---- chalk ------------------------------------------------------------------

  function chalkTexture() {
    const c = canvas(64, 512);
    const ctx = c.getContext("2d");
    const r = R.rng(5);
    ctx.clearRect(0, 0, 64, 512);
    for (let y = 0; y < 512; y += 2) {
      const a = 0.55 + r() * 0.45 - (r() < 0.06 ? 0.5 : 0);
      ctx.fillStyle = "rgba(255,255,255," + Math.max(0, a).toFixed(2) + ")";
      ctx.fillRect(6 + r() * 4, y, 52 - r() * 8, 2);
    }
    for (let i = 0; i < 300; i++) {
      ctx.clearRect(r() * 64, r() * 512, 1 + r() * 3, 1 + r() * 3);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  // Quads flat on the grass, as one geometry.
  function Strips() { this.P = []; this.U = []; this.C = []; this.I = []; }
  Strips.prototype.add = function (x0, z0, x1, z1, width, alpha, y) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const nx = -dz / len * width / 2, nz = dx / len * width / 2;
    const b = this.P.length / 3;
    const h = y || 0.015;
    this.P.push(x0 + nx, h, z0 + nz, x0 - nx, h, z0 - nz, x1 - nx, h, z1 - nz, x1 + nx, h, z1 + nz);
    const rep = len / 3;
    this.U.push(0, 0, 1, 0, 1, rep, 0, rep);
    for (let k = 0; k < 4; k++) this.C.push(1, 1, 1, alpha);
    this.I.push(b, b + 2, b + 1, b, b + 3, b + 2);
  };
  Strips.prototype.mesh = function (mat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.U, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.C, 4));
    g.setIndex(this.I);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = 1;
    m.receiveShadow = true;
    return m;
  };

  function buildChalk(world) {
    const s = new Strips();
    s.add(-HALF_W, -60, -HALF_W, 60, 0.2, 0.85);
    s.add(HALF_W, -60, HALF_W, 60, 0.2, 0.85);
    s.add(-HALF_W, -60, HALF_W, -60, 0.2, 0.8);
    s.add(-HALF_W, 60, HALF_W, 60, 0.2, 0.8);
    s.add(-HALF_W, -50, HALF_W, -50, 0.26, 0.95);
    s.add(-HALF_W, 50, HALF_W, 50, 0.26, 0.95);
    for (let z = -45; z <= 45; z += 5) {
      const a = z % 10 === 0 ? 0.55 : 0.34;
      s.add(-HALF_W, z, HALF_W, z, 0.13, a);
    }
    // One-yard ticks along both touchlines and the hashes.
    for (let z = -49; z <= 49; z++) {
      if (z % 5 === 0) continue;
      [-HALF_W + 0.5, HALF_W - 1.1, -3.5, 2.9].forEach(function (x) { s.add(x, z, x + 0.6, z, 0.1, 0.4); });
    }
    const mat = new THREE.MeshStandardMaterial({
      color: "#f1eee0", map: chalkTexture(), transparent: true, vertexColors: true, roughness: 1,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    });
    world.scene.add(s.mesh(mat));
  }

  // Team names chalk-painted in each end zone. Swapped at a change of
  // possession: the far end zone is always the defense's.
  function endZonePaint(team) {
    const c = canvas(1024, 256);
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, 1024, 256);
    ctx.font = "900 150px 'Arial Black', Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = team.id === "turkeys" ? "#e37a24" : "#8c2536";
    ctx.fillText(team.name.toUpperCase(), 512, 132);
    ctx.lineWidth = 8;
    ctx.strokeStyle = "rgba(245,240,225,0.9)";
    ctx.strokeText(team.name.toUpperCase(), 512, 132);
    // Rough it up: painted grass is patchy.
    const r = R.rng(team.id.length * 31);
    ctx.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = "rgba(0,0,0," + (0.2 + r() * 0.6).toFixed(2) + ")";
      ctx.fillRect(r() * 1024, r() * 256, 1 + r() * 4, 1 + r() * 4);
    }
    const t = tex(c);
    return t;
  }

  function buildEndZones(world) {
    const texs = D.TEAMS.map(endZonePaint);
    const mk = function (z, rot) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(34, 8.5), new THREE.MeshStandardMaterial({
        map: texs[0], transparent: true, opacity: 0.8, roughness: 1, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
      }));
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = rot;
      m.position.set(0, 0.012, z);
      m.receiveShadow = true;
      world.scene.add(m);
      return m;
    };
    // Letters read from the field side of each end zone.
    const far = mk(-55, 0);
    const near = mk(55, Math.PI);
    world.setEndZones = function (offense) {
      far.material.map = texs[1 - offense];
      near.material.map = texs[offense];
      far.material.needsUpdate = true;
      near.material.needsUpdate = true;
    };
  }

  // Line of scrimmage and line to gain: faint TV-style lines, plus a stake and
  // flag on each touchline at the line to gain (the backyard's chains).
  function buildMarkers(world) {
    const mk = function (color, opacity) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(D.FIELD_W, 0.3), new THREE.MeshBasicMaterial({
        color: color, transparent: true, opacity: opacity, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
      }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.02;
      m.renderOrder = 2;
      world.scene.add(m);
      return m;
    };
    const los = mk("#6fb7ff", 0.55);
    const first = mk("#ffd84a", 0.6);
    const stakes = [];
    [-1, 1].forEach(function (s) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), new THREE.MeshStandardMaterial({ color: "#d9d2bf" }));
      pole.position.y = 0.8;
      pole.castShadow = true;
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.38), new THREE.MeshStandardMaterial({ color: "#ff8a1f", side: THREE.DoubleSide }));
      flag.position.set(0, 1.4, 0.28);
      flag.rotation.y = Math.PI / 2;
      g.add(pole);
      g.add(flag);
      g.position.x = s * (HALF_W + 1.2);
      g.userData.flag = flag;
      world.scene.add(g);
      stakes.push(g);
    });
    world.setLines = function (losZ, firstZ, show, goal) {
      los.visible = show;
      first.visible = show && !goal;
      los.position.z = losZ;
      first.position.z = firstZ;
      stakes.forEach(function (g) { g.visible = show && !goal; g.position.z = firstZ; });
    };
    world.animMarkers = function (t) {
      stakes.forEach(function (g, i) { g.userData.flag.rotation.x = 0.15 * Math.sin(t * 3 + i); });
    };
  }

  // ---- static props, merged into one vertex-coloured mesh ----------------------

  function Props() { this.list = []; }
  Props.prototype.add = function (geo, color, p, r, s) {
    tmpE.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0);
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(tmpV.set(p[0], p[1], p[2]), tmpQ, tmpS.set(s ? s[0] : 1, s ? s[1] : 1, s ? s[2] : 1));
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.applyMatrix4(tmpM);
    const n = g.attributes.position.count;
    const c = new THREE.Color(color);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.deleteAttribute("uv");
    this.list.push(g);
  };
  Props.prototype.mesh = function (mat) {
    let n = 0;
    this.list.forEach(function (g) { n += g.attributes.position.count; });
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3);
    let o = 0;
    this.list.forEach(function (g) {
      P.set(g.attributes.position.array, o * 3);
      N.set(g.attributes.normal.array, o * 3);
      C.set(g.attributes.color.array, o * 3);
      o += g.attributes.position.count;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(P, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(C, 3));
    geo.computeBoundingSphere();
    return new THREE.Mesh(geo, mat);
  };
  const tmpE = new THREE.Euler(), tmpQ = new THREE.Quaternion(), tmpM = new THREE.Matrix4();
  const tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3();

  function cone(pr, x, z) {
    pr.add(new THREE.ConeGeometry(0.2, 0.62, 12), "#f06a1a", [x, 0.31, z]);
    pr.add(new THREE.CylinderGeometry(0.135, 0.165, 0.1, 12), "#f3efe6", [x, 0.3, z]);
    pr.add(new THREE.BoxGeometry(0.5, 0.05, 0.5), "#e2581a", [x, 0.025, z]);
  }

  function lawnChair(pr, x, z, rot, color) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const at = function (dx, dz) { return [x + dx * c + dz * s, z - dx * s + dz * c]; };
    const seat = at(0, 0), back = at(0, -0.28);
    pr.add(new THREE.BoxGeometry(0.62, 0.05, 0.55), color, [seat[0], 0.42, seat[1]], [0, rot, 0]);
    pr.add(new THREE.BoxGeometry(0.62, 0.62, 0.05), color, [back[0], 0.72, back[1]], [-0.25, rot, 0]);
    [[-0.3, 0.25], [0.3, 0.25], [-0.3, -0.25], [0.3, -0.25]].forEach(function (l) {
      const p = at(l[0], l[1]);
      pr.add(new THREE.CylinderGeometry(0.02, 0.02, 0.42, 5), "#c9ccd0", [p[0], 0.21, p[1]]);
    });
  }

  function pumpkin(pr, x, z, s) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      pr.add(new THREE.SphereGeometry(0.2 * s, 10, 8), i % 2 ? "#e0761f" : "#d0661a", [x + Math.cos(a) * 0.1 * s, 0.17 * s, z + Math.sin(a) * 0.1 * s], null, [0.75, 0.85, 0.75]);
    }
    pr.add(new THREE.CylinderGeometry(0.025 * s, 0.035 * s, 0.12 * s, 6), "#5a4a26", [x, 0.36 * s, z], [0.2, 0, 0.1]);
  }

  function buildSideline(world) {
    const pr = new Props();
    // Pylons at the corners of both end zones.
    [-1, 1].forEach(function (sx) {
      [-60, -50, 50, 60].forEach(function (z) { cone(pr, sx * (HALF_W + 0.35), z); });
    });
    // The Thanksgiving table, off the left touchline at midfield.
    const tx = -(HALF_W + 7.5), tz = 2;
    pr.add(new THREE.BoxGeometry(1.1, 0.05, 2.6), "#f4efe4", [tx, 0.82, tz]);                     // cloth
    pr.add(new THREE.BoxGeometry(1.12, 0.22, 2.62), "#b5482c", [tx, 0.73, tz]);                    // skirt, orange-red
    [[-0.45, -1.15], [0.45, -1.15], [-0.45, 1.15], [0.45, 1.15]].forEach(function (l) {
      pr.add(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 5), "#8a8d91", [tx + l[0], 0.4, tz + l[1]]);
    });
    // The bird, on a platter.
    pr.add(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 20), "#e8e4dc", [tx, 0.86, tz - 0.4]);
    pr.add(new THREE.SphereGeometry(0.22, 16, 12), "#a8612a", [tx, 0.97, tz - 0.4], null, [1.1, 0.72, 1.35]);
    [-1, 1].forEach(function (s) {
      pr.add(new THREE.CapsuleGeometry(0.05, 0.14, 3, 8), "#9a5524", [tx + s * 0.13, 1.0, tz - 0.14], [1.2, 0, s * 0.35]);
      pr.add(new THREE.SphereGeometry(0.035, 6, 5), "#f2eee6", [tx + s * 0.17, 1.05, tz - 0.03]);
    });
    // Pies, a pitcher of cider, cups.
    [[0.22, 0.45, "#c8792f"], [-0.2, 0.75, "#8a4a2a"], [0.2, 1.05, "#d49a3c"]].forEach(function (p) {
      pr.add(new THREE.CylinderGeometry(0.16, 0.14, 0.05, 16), p[2], [tx + p[0], 0.87, tz + p[1]]);
      pr.add(new THREE.CylinderGeometry(0.17, 0.17, 0.012, 16), "#e9e2d2", [tx + p[0], 0.85, tz + p[1]]);
    });
    pr.add(new THREE.CylinderGeometry(0.07, 0.08, 0.26, 10), "#c9772a", [tx - 0.3, 0.97, tz + 0.2]);
    for (let i = 0; i < 5; i++) pr.add(new THREE.CylinderGeometry(0.035, 0.03, 0.1, 8), "#c8312b", [tx + 0.35, 0.9, tz - 1.1 + i * 0.12]);
    // Chairs, a cooler, a kettle grill.
    lawnChair(pr, tx + 1.4, tz - 2.4, 1.3, "#2f6f8f");
    lawnChair(pr, tx + 1.5, tz - 3.4, 1.4, "#3e7a3a");
    lawnChair(pr, tx + 1.3, tz + 3.2, 1.8, "#a33a2e");
    lawnChair(pr, tx + 1.4, tz + 4.3, 1.7, "#d0a13a");
    pr.add(new THREE.BoxGeometry(0.8, 0.45, 0.45), "#c73b30", [tx + 0.3, 0.25, tz + 5.6]);
    pr.add(new THREE.BoxGeometry(0.84, 0.08, 0.49), "#f1f0ea", [tx + 0.3, 0.5, tz + 5.6]);
    pr.add(new THREE.SphereGeometry(0.34, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), "#1d1d1f", [tx - 0.6, 0.85, tz + 7.2]);
    pr.add(new THREE.SphereGeometry(0.34, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.2), "#1d1d1f", [tx - 0.6, 0.87, tz + 7.2]);
    [0, 2.1, 4.2].forEach(function (a) {
      pr.add(new THREE.CylinderGeometry(0.018, 0.018, 0.8, 5), "#2a2a2c", [tx - 0.6 + Math.cos(a) * 0.22, 0.4, tz + 7.2 + Math.sin(a) * 0.22], [Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2]);
    });
    // Hay bales and pumpkins on the right touchline, a little autumn.
    [[-8, 0], [-6.6, 0.3], [-7.3, 0.1]].forEach(function (b, i) {
      pr.add(new THREE.BoxGeometry(1.3, 0.55, 0.62), i % 2 ? "#c9a54f" : "#d4b25c", [HALF_W + 6.5, 0.28 + (i === 2 ? 0.55 : 0), b[0] + b[1]], [0, b[1], 0]);
    });
    [[HALF_W + 5.4, -6.5, 1.2], [HALF_W + 7.6, -9.2, 0.9], [HALF_W + 5.8, -9.6, 0.7], [-(HALF_W + 6.2), -6, 1.0], [-(HALF_W + 5.4), 11, 0.8]].forEach(function (p) {
      pumpkin(pr, p[0], p[1], p[2]);
    });
    // A leaf rake left against the hay.
    pr.add(new THREE.CylinderGeometry(0.02, 0.02, 1.7, 5), "#a4804d", [HALF_W + 5.5, 0.72, -8.4], [0, 0, 0.5]);
    const mesh = pr.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    world.scene.add(mesh);
    world.tablePos = new THREE.Vector3(tx, 0, tz);
  }

  // ---- fence, trees, houses ---------------------------------------------------------

  function fenceTexture() {
    const c = canvas(512, 128);
    const ctx = c.getContext("2d");
    const r = R.rng(21);
    const bw = 512 / 12;
    for (let i = 0; i < 12; i++) {
      const v = r();
      ctx.fillStyle = "rgb(" + (128 + v * 34 | 0) + "," + (96 + v * 26 | 0) + "," + (64 + v * 18 | 0) + ")";
      ctx.fillRect(i * bw, 0, bw, 128);
      for (let k = 0; k < 30; k++) {
        ctx.fillStyle = "rgba(60,40,24," + (0.05 + r() * 0.1).toFixed(2) + ")";
        ctx.fillRect(i * bw + r() * bw, r() * 128, 1, 10 + r() * 50);
      }
      ctx.fillStyle = "rgba(40,26,14,0.8)";
      ctx.fillRect(i * bw, 0, 2, 128);
      // Dog-ear tops.
      ctx.clearRect(i * bw, 0, 4, 4);
      ctx.clearRect(i * bw + bw - 4, 0, 4, 4);
    }
    // Weathering toward the bottom.
    const g = ctx.createLinearGradient(0, 70, 0, 128);
    g.addColorStop(0, "rgba(50,40,25,0)");
    g.addColorStop(1, "rgba(50,40,25,0.35)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 128);
    const t = tex(c);
    t.wrapS = THREE.RepeatWrapping;
    return t;
  }

  function buildFence(world) {
    const H = D.YARD.FENCE_H;
    const mat = new THREE.MeshStandardMaterial({ map: fenceTexture(), roughness: 0.95, side: THREE.DoubleSide, alphaTest: 0.5 });
    const wall = function (x0, z0, x1, z1) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const g = new THREE.PlaneGeometry(len, H);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / 2.4);
      const m = new THREE.Mesh(g, mat);
      m.position.set((x0 + x1) / 2, H / 2, (z0 + z1) / 2);
      m.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
      m.receiveShadow = true;
      world.scene.add(m);
    };
    wall(-FENCE_X, -FENCE_Z, FENCE_X, -FENCE_Z);
    wall(-FENCE_X, FENCE_Z, FENCE_X, FENCE_Z);
    wall(-FENCE_X, -FENCE_Z, -FENCE_X, FENCE_Z);
    wall(FENCE_X, -FENCE_Z, FENCE_X, FENCE_Z);
    // Posts and rails on the yard side.
    const pr = new Props();
    const post = function (x, z) { pr.add(new THREE.BoxGeometry(0.13, H + 0.1, 0.13), "#7b5d3c", [x, (H + 0.1) / 2, z]); };
    for (let x = -FENCE_X; x <= FENCE_X + 0.01; x += 2.66) { post(x, -FENCE_Z + 0.08); post(x, FENCE_Z - 0.08); }
    for (let z = -FENCE_Z; z <= FENCE_Z + 0.01; z += 2.66) { post(-FENCE_X + 0.08, z); post(FENCE_X - 0.08, z); }
    [0.35, 1.55].forEach(function (y) {
      pr.add(new THREE.BoxGeometry(FENCE_X * 2, 0.1, 0.05), "#80613f", [0, y, -FENCE_Z + 0.1]);
      pr.add(new THREE.BoxGeometry(FENCE_X * 2, 0.1, 0.05), "#80613f", [0, y, FENCE_Z - 0.1]);
      pr.add(new THREE.BoxGeometry(0.05, 0.1, FENCE_Z * 2), "#80613f", [-FENCE_X + 0.1, y, 0]);
      pr.add(new THREE.BoxGeometry(0.05, 0.1, FENCE_Z * 2), "#80613f", [FENCE_X - 0.1, y, 0]);
    });
    const posts = pr.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    posts.receiveShadow = true;
    world.scene.add(posts);
  }

  const FOLIAGE = ["#d06a24", "#b8421f", "#d9a236", "#a44d1e", "#e08a2c", "#c7582a", "#7a7a2e", "#5d6b2d", "#e3b64a"];

  function buildTrees(world, quality) {
    const r = R.rng(99);
    const spots = [];
    const tryAdd = function (x, z, s) {
      for (let i = 0; i < spots.length; i++) {
        if (Math.hypot(spots[i][0] - x, spots[i][1] - z) < (spots[i][2] + s) * 3.2) return;
      }
      spots.push([x, z, s]);
    };
    // A ring of trees beyond the fence, thicker behind the houses' gaps...
    const count = quality === "low" ? 70 : 120;
    for (let i = 0; i < count * 4 && spots.length < count; i++) {
      const a = r() * Math.PI * 2;
      const d = 1 + r() * 0.9;
      const x = Math.cos(a) * (FENCE_X + 6) * d * 1.3;
      const z = Math.sin(a) * (FENCE_Z + 6) * d;
      if (Math.abs(x) < FENCE_X + 3 && Math.abs(z) < FENCE_Z + 3) continue;
      tryAdd(x, z, 0.8 + r() * 0.7);
    }
    // ...and a few old trees inside the yard's corners.
    [[-FENCE_X + 5, -FENCE_Z + 6, 1.3], [FENCE_X - 6, FENCE_Z - 5, 1.2], [FENCE_X - 5, -FENCE_Z + 8, 1.1], [-FENCE_X + 6, FENCE_Z - 7, 1.25]].forEach(function (t) { spots.push(t); });

    const blobs = [];
    const trunks = [];
    spots.forEach(function (t) {
      const s = t[2];
      const h = (4 + r() * 3) * s;
      trunks.push([t[0], h / 2, t[1], 0.28 * s, h]);
      const n = 4 + (r() * 4 | 0);
      const base = FOLIAGE[(r() * FOLIAGE.length) | 0];
      for (let k = 0; k < n; k++) {
        const a = r() * Math.PI * 2;
        const rr = (1.2 + r() * 1.6) * s;
        const col = r() < 0.35 ? FOLIAGE[(r() * FOLIAGE.length) | 0] : base;
        blobs.push([t[0] + Math.cos(a) * rr * 0.8, h + (r() - 0.2) * 2.2 * s, t[1] + Math.sin(a) * rr * 0.8, (2 + r() * 1.6) * s, col]);
      }
      blobs.push([t[0], h + 1.4 * s, t[1], 2.6 * s, base]);
    });
    const trunkMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.7, 1, 1, 7), new THREE.MeshStandardMaterial({ color: "#4a3527", roughness: 1 }), trunks.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3(), sc = new THREE.Vector3();
    trunks.forEach(function (t, i) {
      m.compose(v.set(t[0], t[1], t[2]), q.identity(), sc.set(t[3], t[4], t[3]));
      trunkMesh.setMatrixAt(i, m);
    });
    trunkMesh.castShadow = true;
    world.scene.add(trunkMesh);
    const blobGeo = new THREE.IcosahedronGeometry(1, 1);
    const blobMesh = new THREE.InstancedMesh(blobGeo, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), blobs.length);
    const c = new THREE.Color();
    blobs.forEach(function (b, i) {
      q.setFromEuler(tmpE.set(r() * 3, r() * 3, r() * 3));
      m.compose(v.set(b[0], b[1], b[2]), q, sc.set(b[3], b[3] * (0.8 + r() * 0.3), b[3]));
      blobMesh.setMatrixAt(i, m);
      c.set(b[4]);
      c.offsetHSL(0, 0, (r() - 0.5) * 0.08);
      blobMesh.setColorAt(i, c);
    });
    blobMesh.castShadow = true;
    world.scene.add(blobMesh);
  }

  function buildHouses(world) {
    const pr = new Props();
    const win = new Props();
    const r = R.rng(314);
    const sidings = ["#cdbb9c", "#9fb0b3", "#b98865", "#e1d7c3", "#a9a07f", "#c4a49a"];
    const roofs = ["#4b3d36", "#5c4b40", "#3f3b3a", "#6b4b3a"];
    const house = function (x, z, rot, w, d, h) {
      const siding = sidings[(r() * sidings.length) | 0];
      const roof = roofs[(r() * roofs.length) | 0];
      const c = Math.cos(rot), s = Math.sin(rot);
      const at = function (dx, dy, dz) { return [x + dx * c + dz * s, dy, z - dx * s + dz * c]; };
      pr.add(new THREE.BoxGeometry(w, h, d), siding, at(0, h / 2, 0), [0, rot, 0]);
      // Gable roof: a stretched, rotated box pair.
      const pitch = 0.62;
      const slope = (d / 2) / Math.cos(pitch) + 0.4;
      [-1, 1].forEach(function (k) {
        pr.add(new THREE.BoxGeometry(w + 0.8, 0.25, slope), roof, at(0, h + Math.sin(pitch) * slope / 2 - 0.05, k * (d / 4 + 0.1)), [k * pitch, rot, 0]);
      });
      // Gable ends.
      const tri = new THREE.BufferGeometry();
      const rh = Math.tan(pitch) * d / 2;
      tri.setAttribute("position", new THREE.Float32BufferAttribute([-d / 2, 0, 0, d / 2, 0, 0, 0, rh, 0], 3));
      tri.computeVertexNormals();
      [-1, 1].forEach(function (k) {
        const g = tri.clone();
        pr.add(g, siding, at(k * w / 2, h, 0), [0, rot + Math.PI / 2 * k, 0]);
      });
      pr.add(new THREE.BoxGeometry(0.9, 2.4, 0.9), "#7a4a3a", at(w * 0.3, h + rh * 0.6, -d * 0.2), [0, rot, 0]);
      // Windows on both long sides, a door, some lit.
      [-1, 1].forEach(function (k) {
        for (let i = 0; i < 3; i++) {
          const wx = (i - 1) * w * 0.3;
          [h * 0.3, h * 0.72].forEach(function (wy) {
            if (wy < h * 0.5 && i === 1 && k === 1) {
              pr.add(new THREE.BoxGeometry(1.1, 2.1, 0.1), "#5b3b2a", at(wx, 1.05, k * (d / 2 + 0.02)), [0, rot, 0]);
              return;
            }
            const lit = r() < 0.45;
            (lit ? win : pr).add(new THREE.BoxGeometry(1.3, 1.1, 0.1), lit ? "#ffd48a" : "#3d4a55", at(wx, wy, k * (d / 2 + 0.03)), [0, rot, 0]);
          });
        }
      });
    };
    // Along both long sides, behind the trees' first row.
    [-1, 1].forEach(function (side) {
      for (let i = 0; i < 4; i++) {
        const z = -54 + i * 36 + (r() - 0.5) * 8;
        house(side * (FENCE_X + 22 + r() * 6), z, side * Math.PI / 2, 13 + r() * 4, 10, 6 + r() * 2.5);
      }
    });
    [-1, 1].forEach(function (end) {
      for (let i = 0; i < 3; i++) {
        house(-30 + i * 30 + (r() - 0.5) * 6, end * (FENCE_Z + 24 + r() * 5), end > 0 ? Math.PI : 0, 13 + r() * 4, 10, 6 + r() * 2);
      }
    });
    const m = pr.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    m.receiveShadow = true;
    world.scene.add(m);
    world.scene.add(win.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, emissive: "#ffb85a", emissiveIntensity: 0.9, roughness: 0.4 })));
  }

  // ---- leaves ---------------------------------------------------------------------

  function leafTexture() {
    const c = canvas(64, 64);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(32, 4);
    ctx.bezierCurveTo(54, 16, 56, 42, 32, 60);
    ctx.bezierCurveTo(8, 42, 10, 16, 32, 4);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(32, 8); ctx.lineTo(32, 58); ctx.stroke();
    return new THREE.CanvasTexture(c);
  }

  function buildLeaves(world, quality) {
    const r = R.rng(4242);
    const n = quality === "low" ? 500 : 1100;
    const mat = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
    const geo = new THREE.PlaneGeometry(0.34, 0.34);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      // More under the fence and trees, a scattering across the field.
      let x, z;
      if (r() < 0.55) {
        const edge = r() < 0.5;
        x = edge ? (r() < 0.5 ? -1 : 1) * (FENCE_X - r() * 7) : (r() - 0.5) * FENCE_X * 2;
        z = edge ? (r() - 0.5) * FENCE_Z * 2 : (r() < 0.5 ? -1 : 1) * (FENCE_Z - r() * 6);
      } else {
        x = (r() - 0.5) * (FENCE_X * 2 - 2);
        z = (r() - 0.5) * (FENCE_Z * 2 - 2);
      }
      q.setFromEuler(tmpE.set((r() - 0.5) * 0.4, r() * 6.28, (r() - 0.5) * 0.4));
      const sc = 0.7 + r() * 0.8;
      m.compose(v.set(x, 0.02 + r() * 0.02, z), q, s.set(sc, sc, sc));
      mesh.setMatrixAt(i, m);
      c.set(FOLIAGE[(r() * 6) | 0]);
      mesh.setColorAt(i, c);
    }
    mesh.receiveShadow = true;
    world.scene.add(mesh);

    // A few leaves always drifting down near the action.
    const fn = quality === "low" ? 24 : 60;
    const fall = new THREE.InstancedMesh(geo, mat, fn);
    const drift = [];
    for (let i = 0; i < fn; i++) {
      drift.push({ x: (r() - 0.5) * 60, y: r() * 14, z: (r() - 0.5) * 60, s: 0.6 + r() * 0.6, ph: r() * 6, sp: 0.5 + r() * 0.6 });
      c.set(FOLIAGE[(r() * 6) | 0]);
      fall.setColorAt(i, c);
    }
    fall.frustumCulled = false;
    world.scene.add(fall);
    world.animLeaves = function (t, dt, focus) {
      for (let i = 0; i < fn; i++) {
        const d = drift[i];
        d.y -= d.sp * dt;
        d.x += (0.8 + Math.sin(t * 0.7 + d.ph) * 0.6) * dt;
        if (d.y < 0.05) {
          d.y = 10 + r() * 6;
          d.x = focus.x + (r() - 0.5) * 50;
          d.z = focus.z + (r() - 0.5) * 50;
        }
        q.setFromEuler(tmpE.set(Math.sin(t * 2 + d.ph) * 1.2, t * 1.5 + d.ph, Math.cos(t * 1.7 + d.ph) * 0.9));
        m.compose(v.set(d.x + Math.sin(t * 1.9 + d.ph) * 0.5, d.y, d.z), q, s.set(d.s, d.s, d.s));
        fall.setMatrixAt(i, m);
      }
      fall.instanceMatrix.needsUpdate = true;
    };
  }

  // ---- the whole yard ------------------------------------------------------------------

  function create(renderer, quality) {
    const scene = new THREE.Scene();
    const sunDir = new THREE.Vector3(D.YARD.SUN.x, D.YARD.SUN.y, D.YARD.SUN.z).normalize();
    const world = { scene: scene, sunDir: sunDir, quality: quality };

    scene.add(buildSky(new THREE.Vector3(D.YARD.GLOW.x, D.YARD.GLOW.y, D.YARD.GLOW.z).normalize()));
    scene.fog = new THREE.Fog("#d9c1a0", 90, 360);

    const hemi = new THREE.HemisphereLight("#cfdcf2", "#6a5a3c", 1.25);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight("#ffd6a0", 2.5);
    sun.castShadow = quality !== "low";
    const S = 26;
    sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
    sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 160;
    const ms = quality === "high" ? 2048 : 1024;
    sun.shadow.mapSize.set(ms, ms);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);
    scene.add(sun.target);
    world.sun = sun;
    world.hemi = hemi;

    // Clouds.
    for (let i = 0; i < 7; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTexture(i + 3), transparent: true, depthWrite: false, fog: false, opacity: 0.8 }));
      const a = -1.2 + i * 0.5;
      sp.position.set(Math.cos(a) * 520, 120 + (i % 3) * 45, Math.sin(a) * 520 - 200);
      sp.scale.set(260, 110, 1);
      scene.add(sp);
    }

    buildGround(world);
    buildChalk(world);
    buildEndZones(world);
    buildMarkers(world);
    buildSideline(world);
    buildFence(world);
    buildTrees(world, quality);
    buildHouses(world);
    buildLeaves(world, quality);

    const texel = (S * 2) / ms;
    world.update = function (t, dt, focus) {
      // Keep the shadow map centred on the action, snapped to its texel grid
      // so the shadows do not crawl as the camera moves.
      const fx = Math.round(focus.x / texel) * texel;
      const fz = Math.round(focus.z / texel) * texel;
      sun.target.position.set(fx, 0, fz);
      sun.position.set(fx + sunDir.x * 80, sunDir.y * 80, fz + sunDir.z * 80);
      sun.target.updateMatrixWorld();
      if (world.animLeaves) world.animLeaves(t, dt, focus);
      if (world.animMarkers) world.animMarkers(t);
    };
    world.FENCE_X = FENCE_X;
    world.FENCE_Z = FENCE_Z;
    return world;
  }

  window.TBWorld3D = { create: create };
})();
