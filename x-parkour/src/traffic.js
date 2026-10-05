// Box trucks. A street slab flagged `traffic` (world.js plan()) gets no static rows: two or three box
// trucks drive up it the runners' way, a little slower than they run, with the roll-up door open, and
// barrels tumble out of the back onto the road. A barrel lands, bounces, and rolls slowly back toward
// the runners: jump it or change lanes; run into one and you stumble.
// Trucks are standable like the containers (W.floor and the collision loop in main.js read W.cars):
// the cargo box is 2.7 m (a double jump), the cab 2.15 m. Barrels live in W.barrels.
// A truck sleeps (parked) until a runner is within WAKE metres behind it, so the stretch is still where
// the generator laid it out when it comes into view; it brakes to a stop before the end of its slab.
(function (G) {
  "use strict";
  const T = window.THREE, W = G.World;
  const WAKE = 45;
  const GRAV = 26;
  const TRUCK = { w: 2.3, d: 7.8, box: 5.6, plat: [[0, 2.7], [5.6, 2.7], [5.65, 2.15], [7.4, 2.15], [7.8, 1.3]] };
  const BARREL = { r: 0.42, len: 0.92 };
  const MAX_DROPS = 7;
  const CAB = [0xd6442e, 0x2f6fb8, 0xe0a91f, 0x3f8a55, 0xe8e6df];
  const DRUM = [0xc0392b, 0x2a62b8, 0xd9a521, 0x3d8f4e];
  W.barrels = [];
  const mats = {};
  const tpl = {};
  function mat(c, emissive) {
    const k = c + (emissive ? "e" : "");
    return mats[k] || (mats[k] = emissive ? new T.MeshBasicMaterial({ color: c }) : new T.MeshLambertMaterial({ color: c }));
  }
  function box(w, h, d, m, x, y, z) { const o = new T.Mesh(new T.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; }
  function canvasTex(w, h, draw) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }
  // the cargo box's side panel: a freight livery
  let sideMat = null, rearMat = null;
  function sideMaterial() {
    if (sideMat) return sideMat;
    const tx = canvasTex(512, 180, function (c, w, h) {
      c.fillStyle = "#ecebe6"; c.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 32) { c.fillStyle = "rgba(0,0,0,0.06)"; c.fillRect(x, 0, 2, h); }
      c.fillStyle = "#1d1f26"; c.fillRect(0, h - 26, w, 26);
      c.fillStyle = "#ff6a2b"; c.fillRect(0, h - 34, w, 8);
      c.font = "900 64px 'Arial Black', Impact, sans-serif"; c.textBaseline = "middle"; c.fillStyle = "#1d1f26";
      c.fillText("DRUM", 34, 66);
      c.fillStyle = "#ff6a2b"; c.fillText("RUNNER", 230, 66);
      c.font = "700 22px Arial, sans-serif"; c.fillStyle = "#4a4d57"; c.fillText("CITY FREIGHT  ·  NO RIDERS", 38, 120);
    });
    return (sideMat = new T.MeshLambertMaterial({ map: tx }));
  }
  // the open back: a dark load space with drums stacked inside
  function rearMaterial() {
    if (rearMat) return rearMat;
    const tx = canvasTex(256, 220, function (c, w, h) {
      c.fillStyle = "#0d0e12"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#1a1c22"; c.fillRect(10, 10, w - 20, h - 20);
      const cols = ["#9e2f24", "#23519a", "#b38719", "#9e2f24", "#2f7340"];
      for (let row = 0; row < 2; row++) for (let i = 0; i < 4; i++) {
        const x = 22 + i * 56, y = h - 18 - (row + 1) * 88;
        c.fillStyle = cols[(i + row * 2) % cols.length]; c.fillRect(x, y, 46, 84);
        c.fillStyle = "rgba(0,0,0,0.35)"; c.fillRect(x, y + 24, 46, 5); c.fillRect(x, y + 58, 46, 5);
        c.fillStyle = "rgba(255,255,255,0.12)"; c.fillRect(x + 6, y + 4, 6, 76);
      }
      c.fillStyle = "#c9c7bf"; c.fillRect(0, 0, w, 12);           // the rolled-up door
    });
    return (rearMat = new T.MeshBasicMaterial({ map: tx, fog: true }));
  }

  // One merged mesh set per cab colour. Local +z = the open back, the end the runners meet first.
  function template(ci) {
    if (tpl[ci]) return tpl[ci];
    const g = new T.Group(), s = TRUCK, w = s.w, h2 = s.d / 2;
    const cab = mat(CAB[ci]), dark = mat(0x16181c), glass = mat(0x1b2431), white = mat(0xe4e2dc), steel = mat(0x8d9099);
    const bz0 = h2, bz1 = h2 - s.box, bc = (bz0 + bz1) / 2;
    g.add(box(w - 0.3, 0.32, s.d - 0.4, dark, 0, 0.55, -0.1));                       // chassis
    const cargo = box(w, 1.95, s.box, white, 0, 0.75 + 0.975, bc); g.add(cargo);
    [-1, 1].forEach(function (sx) {                                                  // livery on both sides
      const p = new T.Mesh(new T.PlaneGeometry(s.box - 0.2, 1.7), sideMaterial());
      p.rotation.y = sx * Math.PI / 2; p.position.set(sx * (w / 2 + 0.006), 1.72, bc); g.add(p);
    });
    const back = new T.Mesh(new T.PlaneGeometry(w - 0.16, 1.8), rearMaterial());   // the open door
    back.position.set(0, 1.68, bz0 + 0.006); g.add(back);
    g.add(box(w + 0.04, 0.1, 0.12, steel, 0, 2.66, bz0 - 0.04));                     // door frame
    [-1, 1].forEach(function (sx) { g.add(box(0.08, 1.95, 0.12, steel, sx * (w / 2 - 0.02), 1.72, bz0 - 0.04)); });
    g.add(box(w, 0.16, 0.3, mat(0x2b2d33), 0, 0.62, bz0 + 0.1));                     // bumper / step
    for (let i = 0; i < 6; i++) g.add(box(w / 6 - 0.02, 0.1, 0.02, mat(i % 2 ? 0x16181c : 0xffc21a), -w / 2 + w / 12 + i * w / 6, 0.62, bz0 + 0.26));
    // cab
    const cz0 = bz1 - 0.05, cz1 = -h2, cc = (cz0 + cz1) / 2, cl = cz0 - cz1;
    g.add(box(w - 0.1, 1.15, cl, cab, 0, 0.5 + 0.575, cc));
    g.add(box(w - 0.14, 0.55, cl - 0.5, cab, 0, 1.6 + 0.0, cc + 0.25));
    g.add(box(w - 0.2, 0.5, 0.05, glass, 0, 1.62, cz1 + 0.24));                       // windscreen at the front
    [-1, 1].forEach(function (sx) { g.add(box(0.04, 0.42, cl - 0.9, glass, sx * (w / 2 - 0.06), 1.62, cc + 0.1)); });
    g.add(box(w - 0.06, 0.1, cl - 0.4, cab, 0, 1.92, cc + 0.2));
    g.add(box(w + 0.02, 0.3, 0.1, steel, 0, 0.62, cz1 - 0.02));                       // front bumper
    // wheels
    [h2 - 1.0, h2 - 2.2, cz1 + 0.85].forEach(function (z) { [-1, 1].forEach(function (sx) {
      const wh = new T.Mesh(new T.CylinderGeometry(0.42, 0.42, 0.3, 12), dark);
      wh.rotation.z = Math.PI / 2; wh.position.set(sx * (w / 2 - 0.12), 0.42, z); g.add(wh);
      const hub = new T.Mesh(new T.CylinderGeometry(0.18, 0.18, 0.32, 8), steel);
      hub.rotation.z = Math.PI / 2; hub.position.set(sx * (w / 2 - 0.12), 0.42, z); g.add(hub);
    }); });
    // lights: tail lights by the open back, headlights at the front
    [-1, 1].forEach(function (sx) {
      g.add(box(0.2, 0.34, 0.05, mat(0xff2a22, true), sx * (w / 2 - 0.08), 1.0, bz0 + 0.02));
      g.add(box(0.12, 0.08, 0.05, mat(0xffa21a, true), sx * (w / 2 - 0.08), 2.55, bz0 + 0.02));
      g.add(box(0.36, 0.18, 0.05, mat(0xfff3c2, true), sx * (w / 2 - 0.32), 0.9, cz1 - 0.03));
    });
    W.bake(g);
    return (tpl[ci] = g);
  }

  // barrels: one shared shape, a mesh group per barrel (only a handful are ever out)
  const drumGeo = new T.CylinderGeometry(BARREL.r, BARREL.r, BARREL.len, 14);
  const ringGeo = new T.CylinderGeometry(BARREL.r + 0.02, BARREL.r + 0.02, 0.05, 14);
  const capGeo = new T.CircleGeometry(BARREL.r * 0.98, 14);
  function drumMesh(ci) {
    const g = new T.Group(), body = new T.Group();
    const m = mat(DRUM[ci]);
    body.add(new T.Mesh(drumGeo, m));
    [-0.22, 0.22].forEach(function (y) { const r = new T.Mesh(ringGeo, mat(0x23252b)); r.position.y = y; body.add(r); });
    [-1, 1].forEach(function (e) {
      const c = new T.Mesh(capGeo, mat(0x3a3c44)); c.rotation.x = -e * Math.PI / 2; c.position.y = e * (BARREL.len / 2 + 0.003); body.add(c);
      const h = new T.Mesh(new T.CircleGeometry(0.16, 3), mat(0xffd23f)); h.rotation.x = -e * Math.PI / 2; h.position.y = e * (BARREL.len / 2 + 0.006); body.add(h);
    });
    body.rotation.z = Math.PI / 2;              // lying on its side, across the lane, rolls along z
    g.add(body);
    g.userData.body = body;
    return g;
  }

  const T_ = G.Traffic = {};
  let scene = null, nextId = 1;
  T_.attach = function (sc) { scene = sc; };

  function spawn(s, lane, zRear, cruise) {
    const ci = Math.floor(W.rand() * CAB.length);
    const group = template(ci).clone();
    const c = {
      type: "car", kind: "truck", x: W.LANES[lane], lane: lane, z: zRear - TRUCK.d / 2, w: TRUCK.w, d: TRUCK.d, h: 2.7,
      base: 0, plat: TRUCK.plat, vz: 0, cruise: cruise, awake: false, zone: s, group: group,
      dropT: 0.5 + W.rand() * 0.6, drops: 0
    };
    group.position.set(c.x, 0, c.z);
    scene.add(group);
    W.cars.push(c);
  }

  // Fill a traffic slab: two trucks in different lanes near the start (one lane always open), and on a
  // long stretch a third further up the road.
  T_.populate = function (s) {
    const R = function (a, b) { return a + (b - a) * W.rand(); };
    const dist = Math.max(0, -s.z0), cruise = 8.5 + 10.5 * (1 - Math.exp(-dist / 1200));
    const lanes = [0, 1, 2].sort(function () { return W.rand() - 0.5; });
    const sp = cruise * R(0.55, 0.65);
    const z1 = s.z0 - R(26, 34);
    spawn(s, lanes[0], z1, sp);
    spawn(s, lanes[1], z1 - R(16, 34), sp);
    if (s.z0 - s.z1 > 170) spawn(s, lanes[2], z1 - R(95, 115), sp * 1.05);
  };

  function removeCar(i) { const c = W.cars[i]; scene.remove(c.group); W.cars.splice(i, 1); }
  function removeBarrel(i) { scene.remove(W.barrels[i].mesh); W.barrels.splice(i, 1); }
  T_.dropZone = function (s) {
    for (let i = W.cars.length - 1; i >= 0; i--) if (W.cars[i].zone === s) removeCar(i);
    for (let i = W.barrels.length - 1; i >= 0; i--) if (W.barrels[i].zone === s) removeBarrel(i);
  };
  T_.clear = function () {
    for (let i = W.cars.length - 1; i >= 0; i--) removeCar(i);
    for (let i = W.barrels.length - 1; i >= 0; i--) removeBarrel(i);
  };

  function dropBarrel(c) {
    const ci = Math.floor(Math.random() * DRUM.length), mesh = drumMesh(ci);
    const b = {
      id: nextId++, x: c.x, lane: c.lane, z: c.z + c.d / 2 + 0.35, y: 0.95, vy: 1 + Math.random() * 1.5,
      vz: c.vz + 3 + Math.random() * 2, r: BARREL.r, w: BARREL.len, air: true, dead: false, deadT: 0, life: 0, zone: c.zone, mesh: mesh
    };
    mesh.position.set(b.x, b.y + b.r, b.z);
    scene.add(mesh);
    W.barrels.push(b);
    c.drops++;
    if (T_.onDrop) T_.onDrop(b, c);
  }
  // a runner ran into it: it goes flying
  T_.knock = function (b, dir) { b.dead = true; b.deadT = 1.2; b.air = true; b.vy = 5; b.vz = -7; b.vx = dir * 2; };

  // zs = the z of every runner: a truck wakes when one is close behind it, a barrel or truck is gone
  // once it is behind all of them
  T_.tick = function (dt, zs) {
    let back = -1e9;
    for (let k = 0; k < zs.length; k++) if (zs[k] > back) back = zs[k];
    for (let i = W.cars.length - 1; i >= 0; i--) {
      const c = W.cars[i];
      let behind = 1e9;                              // nearest runner behind the open back
      for (let k = 0; k < zs.length; k++) { const d = zs[k] - (c.z + c.d / 2); if (d > -1 && d < behind) behind = d; }
      if (!c.awake && behind < WAKE) c.awake = true;
      if (c.awake) {
        const braking = c.z - c.d / 2 < c.zone.z1 + 16;
        const want = braking ? 0 : -c.cruise;
        const acc = braking ? 6 : 3.5;
        c.vz += Math.max(-acc * dt, Math.min(acc * dt, want - c.vz));
        c.z += c.vz * dt; c.group.position.z = c.z;
        // drop a drum when someone is following, but never on top of a runner right behind
        if (c.vz < -2 && c.drops < MAX_DROPS && behind > 9 && behind < 50) {
          c.dropT -= dt;
          if (c.dropT <= 0) { dropBarrel(c); c.dropT = 0.9 + Math.random() * 1.2; }
        }
      }
      if (c.z - c.d / 2 > back + 30) removeCar(i);
    }
    for (let i = W.barrels.length - 1; i >= 0; i--) {
      const b = W.barrels[i];
      b.life += dt;
      if (b.air) {
        b.vy -= GRAV * dt; b.y += b.vy * dt;
        if (b.y <= 0 && !b.dead) { b.y = 0; if (b.vy < -2.5) b.vy = -b.vy * 0.32; else { b.vy = 0; b.air = false; } }
      }
      if (!b.air && !b.dead) b.vz += (1.4 - b.vz) * Math.min(1, dt * 1.1);       // rolls back toward the runners
      b.z += b.vz * dt;
      if (b.vx) b.x += b.vx * dt;
      b.mesh.position.set(b.x, b.y + b.r, b.z);
      b.mesh.userData.body.rotation.x -= (b.dead ? 9 : b.vz / b.r) * dt;
      if (b.dead) { b.deadT -= dt; if (b.deadT <= 0) { removeBarrel(i); continue; } }
      if (b.z - 1 > back + 30 || b.life > 40) removeBarrel(i);
    }
  };
})(window.CJ = window.CJ || {});
