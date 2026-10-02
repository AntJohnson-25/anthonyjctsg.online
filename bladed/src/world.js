// Collision world: yaw-rotated boxes in a uniform grid, character movement
// (vertical cylinders that step up stairs and slide along walls), and a
// segment raycast used for knives and line of sight.
globalThis.HK = globalThis.HK || {};
(function (HK) {
  "use strict";
  const STEP = 0.45;      // tallest ledge a character walks up without jumping
  const SNAP = 0.55;      // how far down a grounded character sticks to stairs
  const CELL = 2, OX = -48, OZ = -16, NX = 48, NZ = 16;

  function World(boxes) {
    this.boxes = boxes.filter(function (b) { return b.col !== false; });
    this.cells = [];
    for (let i = 0; i < NX * NZ; i++) this.cells.push([]);
    this.stamp = 0;
    this.tmp = [];
    // Reused query buffers (one per caller so nested calls never collide).
    this._m = []; this._g = []; this._c = []; this._r = []; this._s = [];
    const self = this;
    this.boxes.forEach(function (b) {
      b.c = Math.cos(b.yaw); b.s = Math.sin(b.yaw);
      const ex = Math.abs(b.c) * b.hx + Math.abs(b.s) * b.hz;
      const ez = Math.abs(b.s) * b.hx + Math.abs(b.c) * b.hz;
      b.minx = b.cx - ex; b.maxx = b.cx + ex; b.minz = b.cz - ez; b.maxz = b.cz + ez;
      b._m = 0;
      const i0 = self.ix(b.minx), i1 = self.ix(b.maxx), k0 = self.iz(b.minz), k1 = self.iz(b.maxz);
      for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) self.cells[k * NX + i].push(b);
    });
  }
  World.STEP = STEP;
  World.prototype.ix = function (x) { return Math.max(0, Math.min(NX - 1, Math.floor((x - OX) / CELL))); };
  World.prototype.iz = function (z) { return Math.max(0, Math.min(NZ - 1, Math.floor((z - OZ) / CELL))); };

  World.prototype.query = function (minx, minz, maxx, maxz, out) {
    out = out || this.tmp;
    out.length = 0;
    const st = ++this.stamp;
    const i0 = this.ix(minx), i1 = this.ix(maxx), k0 = this.iz(minz), k1 = this.iz(maxz);
    for (let k = k0; k <= k1; k++) {
      for (let i = i0; i <= i1; i++) {
        const cell = this.cells[k * NX + i];
        for (let n = 0; n < cell.length; n++) {
          const b = cell[n];
          if (b._m === st) continue;
          b._m = st;
          if (b.minx <= maxx && b.maxx >= minx && b.minz <= maxz && b.maxz >= minz) out.push(b);
        }
      }
    }
    return out;
  };

  // Does a circle (x,z,r) overlap box b in plan view?
  function overlaps(b, x, z, r) {
    const rx = x - b.cx, rz = z - b.cz;
    const lx = rx * b.c + rz * b.s, lz = -rx * b.s + rz * b.c;
    const dx = Math.max(Math.abs(lx) - b.hx, 0), dz = Math.max(Math.abs(lz) - b.hz, 0);
    return dx * dx + dz * dz < r * r;
  }
  World.overlaps = overlaps;

  // Highest walkable top under a circle that is no more than STEP above feetY.
  function groundIn(list, x, z, feetY, r) {
    let best = -1e9;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.maxy <= feetY + STEP && b.maxy > best && overlaps(b, x, z, r)) best = b.maxy;
    }
    return best;
  }
  World.prototype.groundAt = function (x, z, feetY, r) {
    return groundIn(this.query(x - r, z - r, x + r, z + r, this._g), x, z, feetY, r);
  };

  // Is a standing character at (x,y,z) free of solid boxes?
  World.prototype.clear = function (x, y, z, r, h) {
    const list = this.query(x - r, z - r, x + r, z + r, this._c);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.maxy > y + STEP && b.miny < y + h && overlaps(b, x, z, r)) return false;
    }
    return true;
  };

  // Push a character's circle out of every box that blocks it at this height.
  World.prototype.resolve = function (c) {
    resolveIn(this.query(c.x - c.r - 0.2, c.z - c.r - 0.2, c.x + c.r + 0.2, c.z + c.r + 0.2, this._s), c);
  };
  function resolveIn(list, c) {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (!(b.maxy > c.y + STEP && b.miny < c.y + c.h)) continue;
        const rx = c.x - b.cx, rz = c.z - b.cz;
        const lx = rx * b.c + rz * b.s, lz = -rx * b.s + rz * b.c;
        const qx = Math.max(-b.hx, Math.min(b.hx, lx)), qz = Math.max(-b.hz, Math.min(b.hz, lz));
        let dx = lx - qx, dz = lz - qz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= c.r * c.r) continue;
        let px, pz;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2), k = (c.r - d) / d;
          px = dx * k; pz = dz * k;
        } else {
          const ox = b.hx - Math.abs(lx) + c.r, oz = b.hz - Math.abs(lz) + c.r;
          if (ox < oz) { px = (lx >= 0 ? 1 : -1) * ox; pz = 0; } else { px = 0; pz = (lz >= 0 ? 1 : -1) * oz; }
        }
        const wx = px * b.c - pz * b.s, wz = px * b.s + pz * b.c;
        c.x += wx; c.z += wz;
        // Lose the velocity going into the wall so characters slide along it.
        const len = Math.sqrt(wx * wx + wz * wz);
        if (len > 1e-9 && c.vx !== undefined) {
          const nx = wx / len, nz = wz / len, vn = c.vx * nx + c.vz * nz;
          if (vn < 0) { c.vx -= vn * nx; c.vz -= vn * nz; }
        }
        moved = true;
      }
      if (!moved) break;
    }
  };

  // Move a character (x,y,z,vx,vy,vz,r,h,onGround) for dt seconds.
  World.prototype.moveChar = function (c, dt, gravity) {
    // One broadphase query covers the whole move (plus slack for push-outs).
    const ax = Math.abs(c.vx * dt) + c.r + 0.3, az = Math.abs(c.vz * dt) + c.r + 0.3;
    const list = this.query(c.x - ax, c.z - az, c.x + ax, c.z + az, this._m);
    const dist = Math.sqrt(c.vx * c.vx + c.vz * c.vz) * dt;
    const n = Math.max(1, Math.ceil(dist / 0.12));
    for (let i = 0; i < n; i++) {
      c.x += c.vx * dt / n; c.z += c.vz * dt / n;
      resolveIn(list, c);
    }
    const wasGround = c.onGround;
    c.vy -= gravity * dt;
    let ny = c.y + c.vy * dt;
    const g = groundIn(list, c.x, c.z, c.y, c.r * 0.7);
    if (c.vy <= 0) {
      if (ny <= g) { ny = g; c.vy = 0; c.onGround = true; }
      else if (wasGround && c.y - g < SNAP) { ny = g; c.vy = 0; c.onGround = true; }
      else c.onGround = false;
    } else {
      c.onGround = false;
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (b.miny >= c.y + c.h - 0.05 && ny + c.h > b.miny && overlaps(b, c.x, c.z, c.r * 0.9)) {
          ny = b.miny - c.h; c.vy = 0;
        }
      }
    }
    c.y = ny;
  };

  // Ray vs one box, in the box's yaw frame. Returns entry t (or -1 = miss,
  // 0 = started inside) and leaves the entry face in _ax/_sg.
  let _ax = 0, _sg = 0;
  function slab(b, ox, oy, oz, dx, dy, dz) {
    const rx = ox - b.cx, rz = oz - b.cz;
    const lx = rx * b.c + rz * b.s, lz = -rx * b.s + rz * b.c;
    const ldx = dx * b.c + dz * b.s, ldz = -dx * b.s + dz * b.c;
    let tmin = -Infinity, tmax = Infinity, ax = -1, sg = 0, t1, t2, s;
    if (ldx > -1e-12 && ldx < 1e-12) { if (lx < -b.hx || lx > b.hx) return -1; }
    else {
      t1 = (-b.hx - lx) / ldx; t2 = (b.hx - lx) / ldx; s = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
      if (t1 > tmin) { tmin = t1; ax = 0; sg = s; }
      if (t2 < tmax) tmax = t2;
    }
    if (dy > -1e-12 && dy < 1e-12) { if (oy < b.miny || oy > b.maxy) return -1; }
    else {
      t1 = (b.miny - oy) / dy; t2 = (b.maxy - oy) / dy; s = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
      if (t1 > tmin) { tmin = t1; ax = 1; sg = s; }
      if (t2 < tmax) tmax = t2;
    }
    if (ldz > -1e-12 && ldz < 1e-12) { if (lz < -b.hz || lz > b.hz) return -1; }
    else {
      t1 = (-b.hz - lz) / ldz; t2 = (b.hz - lz) / ldz; s = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
      if (t1 > tmin) { tmin = t1; ax = 2; sg = s; }
      if (t2 < tmax) tmax = t2;
    }
    if (tmax < tmin || tmax <= 0) return -1;
    _ax = ax; _sg = sg;
    return tmin < 0 ? 0 : tmin;
  }

  // Segment raycast from o along d for t in [0,maxT], walking the grid cells
  // the ray crosses (DDA). Returns the first hit {t,x,y,z,nx,ny,nz,box} or
  // null; with anyHit it returns true/false as soon as anything is in the way.
  World.prototype.raycast = function (ox, oy, oz, dx, dy, dz, maxT, skipGlass, anyHit) {
    const st = ++this.stamp;
    let best = maxT, bb = null, bax = 0, bsg = 0;
    let ix = this.ix(ox), iz = this.iz(oz);
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const adx = Math.abs(dx), adz = Math.abs(dz);
    let tmx = adx < 1e-12 ? Infinity : (OX + (ix + (dx > 0 ? 1 : 0)) * CELL - ox) / dx;
    let tmz = adz < 1e-12 ? Infinity : (OZ + (iz + (dz > 0 ? 1 : 0)) * CELL - oz) / dz;
    const tdx = adx < 1e-12 ? Infinity : CELL / adx, tdz = adz < 1e-12 ? Infinity : CELL / adz;
    for (let guard = 0; guard < 200; guard++) {
      const cell = this.cells[iz * NX + ix];
      for (let n = 0; n < cell.length; n++) {
        const b = cell[n];
        if (b._m === st) continue;
        b._m = st;
        if (skipGlass && b.surf === "glass") continue;
        const t = slab(b, ox, oy, oz, dx, dy, dz);
        if (t < 0 || t >= best) continue;
        if (anyHit) return true;
        best = t; bb = b; bax = t === 0 ? -1 : _ax; bsg = _sg;
      }
      const texit = tmx < tmz ? tmx : tmz;
      if (texit >= best) break;
      if (tmx < tmz) { ix += sx; tmx += tdx; } else { iz += sz; tmz += tdz; }
      if (ix < 0 || ix >= NX || iz < 0 || iz >= NZ) break;
    }
    if (anyHit) return false;
    if (!bb) return null;
    let nx, ny, nz;
    if (bax === -1) {
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      nx = -dx / l; ny = -dy / l; nz = -dz / l;
    } else {
      const nlx = bax === 0 ? bsg : 0, nlz = bax === 2 ? bsg : 0;
      nx = nlx * bb.c - nlz * bb.s; ny = bax === 1 ? bsg : 0; nz = nlx * bb.s + nlz * bb.c;
    }
    return { t: best, x: ox + dx * best, y: oy + dy * best, z: oz + dz * best, nx: nx, ny: ny, nz: nz, box: bb };
  };

  World.prototype.los = function (ax, ay, az, bx, by, bz) {
    return !this.raycast(ax, ay, az, bx - ax, by - ay, bz - az, 1, false, true);
  };
  HK.World = World;
})(globalThis.HK);
