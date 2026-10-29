// A course: the race line (a spline that only ever heads -Z, which every lookup relies on), its
// elevation profile, and the one height field that physics, props and meshes all share.
// Inside the "ribbon" (the track plus its shoulders) the height is analytic and drawn as a fine
// textured strip (lane paint, ruts, curbs); outside it a chunked grid carries the ground out to a
// coarse skirt. Each course (src/courses.js) supplies its own path, grades and profile functions.
(function (RR) {
  "use strict";
  const T = window.THREE;

  // ---------- value noise ----------
  function hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, o) { let s = 0, a = 0.5; for (let i = 0; i < (o || 4); i++) { s += a * vnoise(x, y); x = x * 2.03 + 11.7; y = y * 2.03 - 5.3; a *= 0.5; } return s; }
  RR.fbm2 = fbm;
  RR.hash2 = hash;
  function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  RR.smoothstep = smoothstep;

  // A path from straight legs joined by rounded corners. legs: [[heading°, length, fillet?], ...],
  // heading 0 = straight down -Z, +90 would be +X (keep |heading| < 80 so z keeps falling).
  RR.legPath = function (start, legs, fillet) {
    const pts = [], corners = [];
    let cx = start[0], cz = start[1];
    const dirs = legs.map(function (l) { const h = l[0] * Math.PI / 180; return [Math.sin(h), -Math.cos(h)]; });
    for (let k = 0; k < legs.length; k++) {
      const d = dirs[k], len = legs[k][1];
      const fIn = k > 0 ? (legs[k - 1][2] || fillet) : 0;
      const fOut = k < legs.length - 1 ? (legs[k][2] || fillet) : 0;
      const a = fIn, b = len - fOut, n = Math.max(1, Math.ceil((b - a) / 25));
      for (let i = 0; i <= n; i++) { const s = a + (b - a) * i / n; pts.push([cx + d[0] * s, cz + d[1] * s]); }
      cx += d[0] * len; cz += d[1] * len;
      if (k < legs.length - 1) corners.push([cx, cz]);
    }
    return { pts: pts, corners: corners };
  };

  // ---------- the race line ----------
  function Track(def) {
    const curve = new T.CatmullRomCurve3(def.path.pts.map(function (p) { return new T.Vector3(p[0], 0, p[1]); }), false, "centripetal");
    const L = curve.getLength(), n = Math.round(L) + 1;
    const pts = curve.getSpacedPoints(n - 1);
    this.n = n; this.L = L; this.ds = L / (n - 1); this.halfW = def.HW;
    this.x = new Float32Array(n); this.z = new Float32Array(n); this.tx = new Float32Array(n); this.tz = new Float32Array(n);
    this.e = new Float32Array(n); this.bank = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.x[i] = pts[i].x; this.z[i] = pts[i].z; }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
      const dx = this.x[b] - this.x[a], dz = this.z[b] - this.z[a], l = Math.hypot(dx, dz);
      this.tx[i] = dx / l; this.tz[i] = dz / l;
    }
    // where each corner of the leg path landed, by arc length
    const self = this;
    this.cornerS = def.path.corners.map(function (c) { return self.nearestAny(c[0], c[1]) * self.ds; });
    this.finish = L - def.runout;
    // elevation: integrate the grade table (grade > 0 = downhill)
    const G = def.grades(this);
    let k = 0;
    this.e[0] = def.top;
    for (let i = 1; i < n; i++) {
      const s = i * this.ds;
      while (k < G.length - 2 && G[k + 1][0] < s) k++;
      const g = G[k][1] + (G[k + 1][1] - G[k][1]) * RR.clamp((s - G[k][0]) / Math.max(1e-3, G[k + 1][0] - G[k][0]), 0, 1);
      this.e[i] = this.e[i - 1] - g * this.ds;
    }
    // banking: how fast the line turns toward +lateral, smoothed; the outside of a bend is raised
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 6), b = Math.min(n - 1, i + 6);
      raw[i] = ((this.tx[b] - this.tx[a]) * -this.tz[i] + (this.tz[b] - this.tz[a]) * this.tx[i]) / ((b - a) * this.ds);
    }
    for (let i = 0; i < n; i++) {
      let sum = 0, c = 0;
      for (let j = Math.max(0, i - 18); j <= Math.min(n - 1, i + 18); j++) { sum += raw[j]; c++; }
      this.bank[i] = RR.clamp(sum / c * def.bankK, -def.bankMax, def.bankMax);
    }
  }
  Track.prototype.clampI = function (i) { return i < 0 ? 0 : i > this.n - 1 ? this.n - 1 : i; };
  Track.prototype.nearest = function (x, z, hint, rad) {
    if (hint === undefined || hint < 0) return this.nearestAny(x, z);
    rad = rad || 45;
    let best = hint, bd = 1e18;
    const a = Math.max(0, hint - rad), b = Math.min(this.n - 1, hint + rad);
    for (let i = a; i <= b; i++) { const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2; if (d < bd) { bd = d; best = i; } }
    return best;
  };
  Track.prototype.indexAtZ = function (z) {
    let lo = 0, hi = this.n - 1;
    if (z >= this.z[0]) return 0;
    if (z <= this.z[hi]) return hi;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.z[m] > z) lo = m; else hi = m; }
    return lo;
  };
  Track.prototype.nearestAny = function (x, z) {
    const c = this.indexAtZ(z);
    let best = c, bd = 1e18;
    const a = Math.max(0, c - 160), b = Math.min(this.n - 1, c + 160);
    for (let i = a; i <= b; i += 3) { const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2; if (d < bd) { bd = d; best = i; } }
    return this.nearest(x, z, best, 3);
  };
  Track.prototype.at = function (s, lat, out) {
    out = out || {};
    const f = RR.clamp(s / this.ds, 0, this.n - 1.001), i = Math.floor(f), j = i + 1, a = f - i;
    out.tx = this.tx[i] * (1 - a) + this.tx[j] * a; out.tz = this.tz[i] * (1 - a) + this.tz[j] * a;
    const l = Math.hypot(out.tx, out.tz); out.tx /= l; out.tz /= l;
    out.rx = -out.tz; out.rz = out.tx;
    out.x = this.x[i] * (1 - a) + this.x[j] * a + out.rx * (lat || 0);
    out.z = this.z[i] * (1 - a) + this.z[j] * a + out.rz * (lat || 0);
    out.e = this.e[i] * (1 - a) + this.e[j] * a;
    out.yaw = Math.atan2(-out.tx, -out.tz);
    return out;
  };
  Track.prototype.lateral = function (x, z, i) { return (x - this.x[i]) * -this.tz[i] + (z - this.z[i]) * this.tx[i]; };
  Track.prototype.along = function (x, z, i) { return (x - this.x[i]) * this.tx[i] + (z - this.z[i]) * this.tz[i]; };
  Track.prototype.elev = function (s) {
    const f = RR.clamp(s / this.ds, 0, this.n - 1.001), i = Math.floor(f), a = f - i;
    return this.e[i] * (1 - a) + this.e[i + 1] * a;
  };
  RR.Track = Track;

  // ---------- the height field ----------
  function Course(def) {
    this.def = def;
    const tr = this.track = new Track(def);
    this.S = def.sections(tr);
    this.S.finish = tr.finish;
    this.edge = def.HW + def.shoulder;
  }
  RR.Course = Course;
  const CP = Course.prototype;

  // the ground far from the line
  CP.far = function (x, z) {
    const tr = this.track, i = tr.indexAtZ(z);
    return tr.e[i] + this.def.far(x, z, tr.lateral(x, z, i), i * tr.ds, this);
  };
  // the cross-section inside the ribbon (|lat| <= edge), above the line's elevation
  CP.prof = function (s, i, lat) { return this.def.prof(s, lat, this.track.bank[i], this); };
  CP.heightI = function (x, z, i) {
    const tr = this.track, E = this.edge;
    const along = tr.along(x, z, i), lat = tr.lateral(x, z, i);
    let s = i * tr.ds + along, beyond = 0;
    if (s < 0) { beyond = -s; s = 0; } else if (s > tr.L) { beyond = s - tr.L; s = tr.L; }
    const ii = tr.clampI(Math.round(s / tr.ds));
    const e = tr.elev(s);
    const a = Math.abs(lat);
    const d = Math.max(a - E, beyond - 20);
    if (d <= 0) return e + this.prof(s, ii, lat);
    const edgeH = e + this.prof(s, ii, lat > 0 ? E : -E);
    const side = edgeH + this.def.side(s, lat, d, x, z, this);
    const w = smoothstep(this.def.blend[0], this.def.blend[1], d);
    if (w <= 0) return side;
    return side + (this.far(x, z) - side) * w;
  };
  // the rendered grid (two triangles per cell, split along the b-c diagonal like the mesh)
  CP.gridH = function (x, z) {
    const G = this.grid, fx = (x - G.x0) / G.cell, fz = (z - G.z0) / G.cell;
    const k = Math.floor(fx), j = Math.floor(fz);
    if (k < 0 || j < 0 || k >= G.NX - 1 || j >= G.NZ - 1) return null;
    const u = fx - k, v = fz - j, H = G.H, a = j * G.NX + k;
    const ha = H[a], hb = H[a + 1], hc = H[a + G.NX], hd = H[a + G.NX + 1];
    return u + v <= 1 ? ha + (hb - ha) * u + (hc - ha) * v : hd + (hc - hd) * (1 - u) + (hb - hd) * (1 - v);
  };
  // physics height: analytic on the ribbon (what it draws), the grid everywhere else
  CP.heightAt = function (x, z, hint) {
    const tr = this.track;
    const i = hint === undefined || hint < 0 ? tr.nearestAny(x, z) : tr.nearest(x, z, hint, 12);
    if (!this.grid || Math.abs(tr.lateral(x, z, i)) <= this.edge + 0.2) return this.heightI(x, z, i);
    const h = this.gridH(x, z);
    return h === null ? this.heightI(x, z, i) : h;
  };
  CP.normalAt = function (x, z, hint, out) {
    const tr = this.track, i = hint === undefined || hint < 0 ? tr.nearestAny(x, z) : tr.nearest(x, z, hint, 12);
    const e = Math.abs(tr.lateral(x, z, i)) <= this.edge ? 0.6 : (this.grid ? this.grid.cell * 0.75 : 0.6);
    const hx = this.heightAt(x + e, z, i) - this.heightAt(x - e, z, i), hz = this.heightAt(x, z + e, i) - this.heightAt(x, z - e, i);
    return out.set(-hx, 2 * e, -hz).normalize();
  };

  // ---------- a tiling grain normal map (asphalt aggregate, packed dirt, grass) ----------
  function grainNormal(size, seed, amp) {
    const rnd = RR.rng(seed), comps = [];
    for (let i = 0; i < 70; i++) {
      const f = 3 + Math.floor(Math.pow(rnd(), 1.2) * 60), a = rnd() * Math.PI * 2;
      const m = Math.round(Math.cos(a) * f), n = Math.round(Math.sin(a) * f);
      if (!m && !n) continue;
      comps.push([m, n, 0.5 / Math.pow(Math.hypot(m, n), 1.05), rnd() * 6.283]);
    }
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let dx = 0, dy = 0;
      for (let c = 0; c < comps.length; c++) {
        const C = comps[c], k = Math.cos(6.2832 * (C[0] * u + C[1] * v) + C[3]) * C[2] * 6.2832;
        dx += k * C[0]; dy += k * C[1];
      }
      let nx = -dx * amp, ny = -dy * amp, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255; data[i + 1] = (ny * 0.5 + 0.5) * 255; data[i + 2] = (nz * 0.5 + 0.5) * 255; data[i + 3] = 255;
    }
    const tx = new T.DataTexture(data, size, size, T.RGBAFormat);
    tx.wrapS = tx.wrapT = T.RepeatWrapping;
    tx.generateMipmaps = true; tx.minFilter = T.LinearMipmapLinearFilter; tx.magFilter = T.LinearFilter;
    tx.anisotropy = 8;
    tx.needsUpdate = true;
    return tx;
  }
  RR.grainNormal = grainNormal;

  // ---------- the ribbon: the track surface itself ----------
  // A fine strip (one row per metre, ~0.7 m columns) textured with the course's road/dirt canvas,
  // vertex-tinted for wet, muddy or painted stretches, with short skirts at the edges.
  CP.buildRibbon = function (root, q) {
    const tr = this.track, E = this.edge, def = this.def;
    const NA = Math.max(12, Math.ceil(2 * E / (q.ribbonCol || 0.7)));
    const tex = def.roadTextures();
    const grain = grainNormal(256, 33, def.roadGrain || 0.04);
    const mats = this.roadMats = tex.maps.map(function (map) {
      const mat = new T.MeshStandardMaterial({
        map: map, vertexColors: true, roughness: def.roadRough || 0.85, metalness: 0,
        normalMap: grain, normalScale: new T.Vector2(0.35, 0.35),
        envMapIntensity: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2
      });
      // the grain repeats much faster than the paint
      mat.onBeforeCompile = function (sh) {
        sh.vertexShader = sh.vertexShader.replace("#include <uv_vertex>", "#include <uv_vertex>\n#ifdef USE_NORMALMAP\n vNormalMapUv = uv * vec2(" + (2 * E / 3).toFixed(2) + ", " + (tex.tile / 3).toFixed(2) + ");\n#endif");
      };
      return mat;
    });
    // chunks of up to CH rows, split wherever the road surface changes
    const spans = [];
    let a0 = 0, v0 = def.roadVariant(0, this);
    for (let i = 1; i < tr.n; i++) {
      const v = def.roadVariant(i * tr.ds, this);
      if (v !== v0 || i - a0 >= 240 || i === tr.n - 1) { spans.push([a0, i, v0]); a0 = i; v0 = v; }
    }
    for (let sp = 0; sp < spans.length; sp++) {
      const i0 = spans[sp][0], i1 = spans[sp][1], mat = mats[spans[sp][2]] || mats[0], rows = i1 - i0 + 1, cols = NA + 1 + 2;
      const pos = new Float32Array(rows * cols * 3), uv = new Float32Array(rows * cols * 2), col = new Float32Array(rows * cols * 3);
      for (let r = 0; r < rows; r++) {
        const i = i0 + r, s = i * tr.ds, rx = -tr.tz[i], rz = tr.tx[i], e = tr.e[i];
        for (let c = 0; c < cols; c++) {
          // columns 0 and cols-1 are the skirts, hanging under the outer edge
          const cc = RR.clamp(c - 1, 0, NA), lat = -E + 2 * E * cc / NA, skirt = c === 0 || c === cols - 1;
          const v = r * cols + c;
          const x = tr.x[i] + rx * lat * (skirt ? 1.03 : 1), z = tr.z[i] + rz * lat * (skirt ? 1.03 : 1);
          pos[v * 3] = x; pos[v * 3 + 1] = e + this.prof(s, i, lat) - (skirt ? 0.8 : 0); pos[v * 3 + 2] = z;
          uv[v * 2] = cc / NA; uv[v * 2 + 1] = s / tex.tile;
          const t = def.roadTint(s, lat, this);
          col[v * 3] = t[0]; col[v * 3 + 1] = t[1]; col[v * 3 + 2] = t[2];
        }
      }
      const idx = [];
      for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c, b = a + 1, d = a + cols, e2 = d + 1;
        idx.push(a, b, d, b, e2, d);
      }
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(pos, 3));
      g.setAttribute("uv", new T.BufferAttribute(uv, 2));
      g.setAttribute("color", new T.BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const m = new T.Mesh(g, mat);
      m.receiveShadow = true;
      root.add(m);
    }
  };

  // ---------- ground mesh ----------
  CP.buildTerrain = function (root, q) {
    const tr = this.track, def = this.def, E = this.edge;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < tr.n; i++) { x0 = Math.min(x0, tr.x[i]); x1 = Math.max(x1, tr.x[i]); z0 = Math.min(z0, tr.z[i]); z1 = Math.max(z1, tr.z[i]); }
    const cell = q.terrainCell || 3, M = def.margin || 170;
    x0 = Math.floor((x0 - M) / cell) * cell; x1 = Math.ceil((x1 + M) / cell) * cell;
    z0 = Math.floor((z0 - M) / cell) * cell; z1 = Math.ceil((z1 + M) / cell) * cell;
    const NX = Math.round((x1 - x0) / cell) + 1, NZ = Math.round((z1 - z0) / cell) + 1;
    const H = new Float32Array(NX * NZ), D = new Float32Array(NX * NZ), SS = new Float32Array(NX * NZ), LT = new Float32Array(NX * NZ);
    for (let j = 0; j < NZ; j++) {
      const z = z0 + j * cell;
      let hint = -1;
      for (let k = 0; k < NX; k++) {
        const x = x0 + k * cell;
        const i = (hint < 0 || k % 12 === 0) ? tr.nearestAny(x, z) : tr.nearest(x, z, hint, 8);
        hint = i;
        const lat = tr.lateral(x, z, i);
        let h = this.heightI(x, z, i);
        // tuck the grid under the ribbon so the ribbon owns the track surface
        const sAt = i * tr.ds + tr.along(x, z, i);
        if (Math.abs(lat) < E - 0.3 && sAt > 0.5 && sAt < tr.L - 0.5) h -= 0.45;
        H[j * NX + k] = h;
        D[j * NX + k] = Math.abs(lat) - E;
        SS[j * NX + k] = i * tr.ds + tr.along(x, z, i);
        LT[j * NX + k] = lat;
      }
    }
    this.grid = { x0: x0, z0: z0, cell: cell, NX: NX, NZ: NZ, H: H, x1: x1, z1: z1 };
    const mat = this.groundMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, normalMap: grainNormal(256, 21, def.groundGrain || 0.05), normalScale: new T.Vector2(0.45, 0.45), envMapIntensity: 0.45 });
    const CHK = 64;
    const nrm = new T.Vector3();
    for (let cj = 0; cj < NZ - 1; cj += CHK) for (let ck = 0; ck < NX - 1; ck += CHK) {
      const nz = Math.min(CHK, NZ - 1 - cj) + 1, nx = Math.min(CHK, NX - 1 - ck) + 1;
      const pos = new Float32Array(nx * nz * 3), nor = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), col = new Float32Array(nx * nz * 3);
      let v = 0;
      for (let j = 0; j < nz; j++) for (let k = 0; k < nx; k++, v++) {
        const gj = cj + j, gk = ck + k, x = x0 + gk * cell, z = z0 + gj * cell, gi = gj * NX + gk, h = H[gi];
        pos[v * 3] = x; pos[v * 3 + 1] = h; pos[v * 3 + 2] = z;
        const hl = H[gj * NX + Math.max(0, gk - 1)], hr = H[gj * NX + Math.min(NX - 1, gk + 1)];
        const hd = H[Math.max(0, gj - 1) * NX + gk], hu = H[Math.min(NZ - 1, gj + 1) * NX + gk];
        nrm.set(hl - hr, 2 * cell, hd - hu).normalize();
        nor[v * 3] = nrm.x; nor[v * 3 + 1] = nrm.y; nor[v * 3 + 2] = nrm.z;
        uv[v * 2] = x / 6; uv[v * 2 + 1] = z / 6;
        const c = def.groundColor(x, z, D[gi], nrm.y, SS[gi], LT[gi], this);
        col[v * 3] = Math.pow(c[0], 2.2); col[v * 3 + 1] = Math.pow(c[1], 2.2); col[v * 3 + 2] = Math.pow(c[2], 2.2);
      }
      const idx = [];
      for (let j = 0; j < nz - 1; j++) for (let k = 0; k < nx - 1; k++) {
        const a = j * nx + k, b = a + 1, c = a + nx, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.BufferAttribute(pos, 3));
      g.setAttribute("normal", new T.BufferAttribute(nor, 3));
      g.setAttribute("uv", new T.BufferAttribute(uv, 2));
      g.setAttribute("color", new T.BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const m = new T.Mesh(g, mat);
      m.receiveShadow = true;
      root.add(m);
    }
    // the skirt: coarse ground out to the horizon, a little under the detailed grid
    {
      const SZ = 6400, N = 120, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, step = SZ / N;
      const pos = [], col = [], idx = [];
      for (let j = 0; j <= N; j++) for (let k = 0; k <= N; k++) {
        const x = cx - SZ / 2 + k * step, z = cz - SZ / 2 + j * step;
        const inside = x > x0 + 15 && x < x1 - 15 && z > z0 + 15 && z < z1 - 15;
        const h = this.far(x, z) - (inside ? 5 : 0.4);
        pos.push(x, h, z);
        const c = def.groundColor(x, z, 999, 1, 0, 999, this);
        col.push(Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2));
      }
      for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
        const a = j * (N + 1) + k, b = a + 1, c = a + N + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new T.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const uvs = new Float32Array((N + 1) * (N + 1) * 2);
      for (let v = 0; v < uvs.length / 2; v++) { uvs[v * 2] = pos[v * 3] / 6; uvs[v * 2 + 1] = pos[v * 3 + 2] / 6; }
      g.setAttribute("uv", new T.BufferAttribute(uvs, 2));
      const sk = new T.Mesh(g, mat);
      sk.renderOrder = -2;
      root.add(sk);
    }
  };
})(window.RR = window.RR || {});
