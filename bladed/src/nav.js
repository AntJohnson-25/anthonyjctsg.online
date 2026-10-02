// Bot navigation: a walk-tested 1 m grid over every walkable surface (all
// three decks, stairs included), then A* over it. Edges are made by actually
// simulating a character walking from one node to the next, so stairs, doors
// and drops come out right without hand-placed waypoints.
globalThis.HK = globalThis.HK || {};
(function (HK) {
  "use strict";
  const SP = 1.0, R = 0.36, H = 1.8;

  // A short hash of the collision boxes: the precomputed graph in
  // src/navdata.js is only used while it matches the map.
  Nav.signature = function (map) {
    let h = 2166136261 >>> 0;
    const s = JSON.stringify(map.boxes.filter(function (b) { return b.col !== false; }).map(function (b) {
      return [b.cx, b.cz, b.hx, b.hz, b.yaw, b.miny, b.maxy].map(function (v) { return Math.round(v * 1000); });
    }));
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(16) + ":" + s.length;
  };

  function Nav(world, map) {
    this.W = world;
    this.nodes = [];
    this.cells = new Map();
    this.bounds = map.bounds;
    const sig = Nav.signature(map);
    const data = HK.NAVDATA;
    if (data && data.sig === sig) {
      const n = data.n;
      for (let i = 0; i < n.length; i += 3) {
        this.nodes.push({ x: n[i], y: n[i + 1], z: n[i + 2], ix: Math.floor((n[i] - map.bounds.x0) / SP), iz: Math.floor((n[i + 2] - map.bounds.z0) / SP), e: data.e[i / 3] });
      }
      this.fromData = true;
    } else {
      if (data && typeof console !== "undefined") console.warn("navdata.js is stale (map changed) - building nav at load; run node tools/build-nav.js");
      this.build(world, map);
    }
    this.finish();
  }

  Nav.prototype.toData = function (map) {
    const n = [], e = [];
    this.nodes.forEach(function (nd) {
      n.push(nd.x, Math.round(nd.y * 1000) / 1000, nd.z);
      e.push(nd.e.map(function (v, k) { return k % 2 ? Math.round(v * 100) / 100 : v; }));
    });
    return { sig: Nav.signature(map), n: n, e: e };
  };

  Nav.prototype.build = function (world, map) {
    const b = map.bounds;
    const self = this;
    const raw = [];
    for (let x = b.x0 + 0.5; x <= b.x1; x += SP) {
      for (let z = b.z0 + 0.5; z <= b.z1; z += SP) {
        const tops = new Set();
        world.query(x - 0.01, z - 0.01, x + 0.01, z + 0.01, []).forEach(function (bx) {
          if (HK.World.overlaps(bx, x, z, 0.02)) tops.add(Math.round(bx.maxy * 1000) / 1000);
        });
        // A character standing here rests on the highest top its footprint
        // overlaps (on stairs that's the step above the sample point).
        const ys = new Set();
        tops.forEach(function (y) {
          if (y < -4) return;
          ys.add(Math.round(world.groundAt(x, z, y + 0.01, R * 0.7) * 1000) / 1000);
        });
        ys.forEach(function (y) {
          if (!world.clear(x, y, z, R, H)) return;
          raw.push({ x: x, y: y, z: z, ix: Math.floor((x - b.x0) / SP), iz: Math.floor((z - b.z0) / SP), e: [] });
        });
      }
    }
    const byCell = new Map();
    raw.forEach(function (n, i) {
      n.i = i;
      const k = n.ix + "," + n.iz;
      if (!byCell.has(k)) byCell.set(k, []);
      byCell.get(k).push(n);
    });
    const c = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: R, h: H, onGround: true };
    function walk(a, t) {
      c.x = a.x; c.y = a.y; c.z = a.z; c.vx = 0; c.vy = 0; c.vz = 0; c.onGround = true;
      const dt = 1 / 30;
      for (let k = 0; k < 50; k++) {
        const dx = t.x - c.x, dz = t.z - c.z, d = Math.hypot(dx, dz);
        if (d < 0.08 && c.onGround) break;
        const sp = Math.min(4, d / dt);
        c.vx = d > 1e-6 ? dx / d * sp : 0; c.vz = d > 1e-6 ? dz / d * sp : 0;
        world.moveChar(c, dt, 20);
        if (c.y < Math.min(a.y, t.y) - 0.6 && c.onGround) return false;   // fell somewhere else
      }
      return Math.hypot(t.x - c.x, t.z - c.z) < 0.2 && Math.abs(c.y - t.y) < 0.3 && c.onGround;
    }
    raw.forEach(function (a) {
      for (let di = -1; di <= 1; di++) for (let dk = -1; dk <= 1; dk++) {
        if (!di && !dk) continue;
        const list = byCell.get((a.ix + di) + "," + (a.iz + dk));
        if (!list) continue;
        list.forEach(function (t) {
          if (Math.abs(t.y - a.y) > 3.6) return;
          if (t.y > a.y + 1.1) return;                       // can't walk up that much in 1 m
          if (walk(a, t)) {
            const cost = Math.hypot(t.x - a.x, (t.y - a.y) * 1.5, t.z - a.z) + (t.y < a.y - 1 ? 2 : 0);
            a.e.push(t.i, cost);
          }
        });
      }
    });
    // Keep what is reachable from the team spawns (drops the bow overhang
    // outside the rails and anything only reachable by jumping).
    const seen = new Uint8Array(raw.length);
    const queue = [];
    map.spawns.forEach(function (s) {
      const n = nearestRaw(raw, byCell, s.x, s.y, s.z, b);
      if (n && !seen[n.i]) { seen[n.i] = 1; queue.push(n.i); }
    });
    while (queue.length) {
      const i = queue.pop(), e = raw[i].e;
      for (let k = 0; k < e.length; k += 2) if (!seen[e[k]]) { seen[e[k]] = 1; queue.push(e[k]); }
    }
    const remap = new Int32Array(raw.length).fill(-1);
    raw.forEach(function (n, i) { if (seen[i]) { remap[i] = self.nodes.length; self.nodes.push(n); } });
    this.nodes.forEach(function (n) {
      const e = [];
      for (let k = 0; k < n.e.length; k += 2) if (remap[n.e[k]] >= 0) e.push(remap[n.e[k]], n.e[k + 1]);
      n.e = e;
    });
  };

  Nav.prototype.finish = function () {
    const self = this;
    this.nodes.forEach(function (n, i) {
      n.i = i;
      const key = n.ix + "," + n.iz;
      if (!self.cells.has(key)) self.cells.set(key, []);
      self.cells.get(key).push(n);
    });
    const N = this.nodes.length;
    this.g = new Float64Array(N); this.f = new Float64Array(N);
    this.came = new Int32Array(N); this.mark = new Uint32Array(N); this.closed = new Uint32Array(N);
    this.gen = 0;
  }

  function nearestRaw(raw, byCell, x, y, z, b) {
    const ix = Math.floor((x - b.x0) / SP), iz = Math.floor((z - b.z0) / SP);
    let best = null, bd = 1e9;
    for (let di = -2; di <= 2; di++) for (let dk = -2; dk <= 2; dk++) {
      const list = byCell.get((ix + di) + "," + (iz + dk));
      if (!list) continue;
      list.forEach(function (n) {
        const dy = n.y - y;
        const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z) + dy * dy * (dy > 0.5 || dy < -1.2 ? 40 : 4);
        if (d < bd) { bd = d; best = n; }
      });
    }
    return best;
  }

  Nav.prototype.nearest = function (x, y, z) {
    return nearestRaw(this.nodes, this.cells, x, y, z, this.bounds);
  };

  // A* from node a to node b. Returns an array of nodes (excluding a) or null.
  Nav.prototype.path = function (a, b) {
    if (!a || !b) return null;
    if (a === b) return [b];
    const gen = ++this.gen, g = this.g, f = this.f, came = this.came, mark = this.mark, closed = this.closed, nodes = this.nodes;
    const heap = [];
    function push(i) {
      heap.push(i);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (f[heap[p]] <= f[heap[k]]) break;
        const t = heap[p]; heap[p] = heap[k]; heap[k] = t; k = p;
      }
    }
    function pop() {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1;
          let m = k;
          if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l;
          if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r;
          if (m === k) break;
          const t = heap[m]; heap[m] = heap[k]; heap[k] = t; k = m;
        }
      }
      return top;
    }
    function h(n) { const dx = n.x - b.x, dy = n.y - b.y, dz = n.z - b.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
    g[a.i] = 0; f[a.i] = h(a); mark[a.i] = gen; came[a.i] = -1;
    push(a.i);
    let iters = 0;
    while (heap.length && iters++ < 6000) {
      const i = pop();
      if (closed[i] === gen) continue;
      closed[i] = gen;
      if (i === b.i) {
        const out = [];
        let k = i;
        while (k !== a.i && k >= 0) { out.push(nodes[k]); k = came[k]; }
        return out.reverse();
      }
      const e = nodes[i].e;
      for (let k = 0; k < e.length; k += 2) {
        const j = e[k], ng = g[i] + e[k + 1];
        if (mark[j] === gen && (closed[j] === gen || ng >= g[j])) continue;
        mark[j] = gen; g[j] = ng; f[j] = ng + h(nodes[j]); came[j] = i;
        push(j);
      }
    }
    return null;
  };

  HK.Nav = Nav;
})(globalThis.HK);
