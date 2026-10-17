// "The Foothold": the corner block where Ant's crew starts the war. Two streets
// cross in the middle (Main St east-west, Cross St north-south):
//   north-west  three run-down rowhouses (front stoops, back yards, an alley);
//               the middle one has stairs to its upper floor
//   north-east  the corner store and the laundromat (one storey, flat roof;
//               an outside stair up the laundromat's east wall to the roof),
//               a vacant lot behind
//   south-west  a three-storey project block: open galleries on the street
//               side, a switchback stair at its east end, a breezeway through
//               to the courtyard behind
//   south-east  a burned-out house and a fenced basketball court
// Both ends of Main St are walled off with barriers. Ant's crew spawns at the
// west end, the enemy at the east end.
//
// Units are metres. +x is east, +z is south, y up. Every box is both
// collision and visuals unless flagged:
//   col:false -> visual only      vis:false -> collision only
//   top/side/bottom -> per-face material keys (default: mat)
//   surf -> impact sound and puff colour (concrete, brick, metal, wood, glass, dirt)
globalThis.SP = globalThis.SP || {};
(function (SP) {
  "use strict";

  const M = {
    name: "THE FOOTHOLD",
    boxes: [], decor: [], spawns: [], hotspots: [], pickups: [], points: [], climbs: [], fires: [], zones: [],
    bounds: { x0: -48, x1: 48, z0: -38, z1: 38 }
  };

  function box(x0, x1, y0, y1, z0, z1, mat, opt) {
    const b = {
      cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2,
      yaw: 0, miny: y0, maxy: y1, mat: mat || "concrete", surf: "concrete"
    };
    if (opt) for (const k in opt) b[k] = opt[k];
    M.boxes.push(b);
    return b;
  }
  // A box of half-size hx,hz turned by yaw about (cx, cz).
  function rbox(cx, cz, hx, hz, yaw, y0, y1, mat, opt) {
    const b = { cx: cx, cz: cz, hx: hx, hz: hz, yaw: yaw, miny: y0, maxy: y1, mat: mat || "concrete", surf: "concrete" };
    if (opt) for (const k in opt) b[k] = opt[k];
    M.boxes.push(b);
    return b;
  }
  // A wall along x (z0..z1 thick) from x0 to x1, with openings
  // [{a, b, y0, y1}] cut out (a..b along x).
  function wallX(x0, x1, z0, z1, y0, y1, holes, mat, opt) {
    holes = (holes || []).slice().sort(function (p, q) { return p.a - q.a; });
    let x = x0;
    holes.forEach(function (h) {
      if (h.a > x) box(x, h.a, y0, y1, z0, z1, mat, opt);
      if (h.y0 > y0) box(h.a, h.b, y0, h.y0, z0, z1, mat, opt);
      if (h.y1 < y1) box(h.a, h.b, h.y1, y1, z0, z1, mat, opt);
      if (h.win) M.decor.push({ kind: h.win, axis: "x", a: h.a, b: h.b, y0: h.y0, y1: h.y1, c: (z0 + z1) / 2, t: z1 - z0 });
      else if (h.y0 === 0 && z1 - z0 < 0.5) M.decor.push({ kind: "doorframe", axis: "x", a: h.a, b: h.b, y0: 0, y1: h.y1, c: (z0 + z1) / 2, t: z1 - z0 });
      x = h.b;
    });
    if (x < x1) box(x, x1, y0, y1, z0, z1, mat, opt);
  }
  // The same along z.
  function wallZ(z0, z1, x0, x1, y0, y1, holes, mat, opt) {
    holes = (holes || []).slice().sort(function (p, q) { return p.a - q.a; });
    let z = z0;
    holes.forEach(function (h) {
      if (h.a > z) box(x0, x1, y0, y1, z, h.a, mat, opt);
      if (h.y0 > y0) box(x0, x1, y0, h.y0, h.a, h.b, mat, opt);
      if (h.y1 < y1) box(x0, x1, h.y1, y1, h.a, h.b, mat, opt);
      if (h.win) M.decor.push({ kind: h.win, axis: "z", a: h.a, b: h.b, y0: h.y0, y1: h.y1, c: (x0 + x1) / 2, t: x1 - x0 });
      else if (h.y0 === 0 && x1 - x0 < 0.5) M.decor.push({ kind: "doorframe", axis: "z", a: h.a, b: h.b, y0: 0, y1: h.y1, c: (x0 + x1) / 2, t: x1 - x0 });
      z = h.b;
    });
    if (z < z1) box(x0, x1, y0, y1, z, z1, mat, opt);
  }
  // Solid stepped stairs from height y0 to y1. axis "x" or "z"; from = the
  // coordinate of the bottom step's outer edge, to = the top step's far edge;
  // a, b = the stair's extent across.
  function stairs(axis, from, to, a, b, y0, y1, mat) {
    const n = Math.max(1, Math.round((y1 - y0) / 0.3));
    const rise = (y1 - y0) / n, run = (to - from) / n;
    for (let i = 0; i < n; i++) {
      const p0 = from + run * i, p1 = from + run * (i + 1);
      const lo = Math.min(p0, p1), hi = Math.max(p0, p1);
      const top = y0 + rise * (i + 1);
      if (axis === "x") box(lo, hi, y0, top, a, b, mat || "stair", { stair: true, top: "steptop" });
      else box(a, b, y0, top, lo, hi, mat || "stair", { stair: true, top: "steptop" });
    }
  }
  // Railings and chain-link: block bodies, not bullets or sight.
  function rail(x0, z0, x1, z1, y, h, kind) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    M.boxes.push({
      cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: len / 2, hz: 0.06, yaw: Math.atan2(dz, dx),
      miny: y, maxy: y + (h || 1.05), mat: "rail", surf: "metal", vis: false, rail: true
    });
    M.decor.push({ kind: kind || "rail", x0: x0, z0: z0, x1: x1, z1: z1, y: y, h: h || 1.05 });
  }
  function patch(x0, x1, z0, z1, y, mat) {
    box(x0, x1, y + 0.004, y + 0.02, z0, z1, mat, { col: false });
  }
  // Roadworks in place of parked cars (2026-10-17): a highway jersey barrier with three yellow
  // water-filled crash barrels lined up at its end. The group runs along yaw (local +x = the
  // barrels), centred on (x, z). Both are cover; the barrier is low enough to vault.
  function car(x, z, yaw, burnt) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    rbox(x - c * 1.05, z - s * 1.05, 1.35, 0.3, yaw, 0, 0.85, "jersey", { surf: "concrete", vis: false });
    [0.75, 1.5, 2.25].forEach(function (o) { rbox(x + c * o, z + s * o, 0.33, 0.33, yaw, 0, 0.95, "jersey", { surf: "metal", vis: false }); });
    M.decor.push({ kind: "hwy", x: x, z: z, yaw: yaw, burnt: !!burnt });
  }
  function dumpster(x, z, yaw) {
    rbox(x, z, 0.95, 0.6, yaw || 0, 0, 1.3, "dumpster", { surf: "metal" });
  }
  function barrier(x, z, yaw) {
    rbox(x, z, 1.5, 0.3, yaw || 0, 0, 0.85, "jersey", { surf: "concrete", vis: false });
    M.decor.push({ kind: "jersey", x: x, z: z, yaw: yaw || 0, len: 3 });
  }
  // A burning oil drum: solid, and its flame hurts whoever bumps into it (sim.js fireStep).
  function barrelFire(x, z) {
    box(x - 0.3, x + 0.3, 0, 0.95, z - 0.3, z + 0.3, "drum", { surf: "metal", vis: false });
    M.fires.push({ x: x, y: 0, z: z });
    M.decor.push({ kind: "barrelfire", x: x, z: z, y: 0 });
  }
  function anyOf(list, i) { return list[i % list.length]; }
  // A ladder up a wall to a roof. (x, z) is where you stand at its foot facing
  // the wall (yaw), y0 the floor there, y1 the roof you climb onto, and
  // (tx, tz) where you land on it. Press E at the foot.
  function ladder(x, z, yaw, y0, y1, tx, tz) {
    M.climbs.push({ x: x, z: z, yaw: yaw, y0: y0, y1: y1, tx: tx, tz: tz });
    M.decor.push({ kind: "ladder", x: x + Math.cos(yaw) * 0.4, z: z + Math.sin(yaw) * 0.4, yaw: yaw, y0: y0, y1: y1 + 0.75 });
  }

  // The company seal (Calamity Tech Solutions Group) painted or hung on something. (x, y, z) is its
  // centre, (nx, nz) the direction the face looks (out of the wall), size the width in metres.
  // board: a lit sign instead of weathered paint.
  function logo(x, y, z, nx, nz, size, board) {
    M.decor.push({ kind: "logo", x: x, y: y, z: z, nx: nx, nz: nz, w: size, board: !!board });
  }
  // The seal on the ground, turned rot radians (0 = top of the seal toward -z).
  function logoFloor(x, z, size, rot, y) {
    M.decor.push({ kind: "logo", x: x, y: y || 0.03, z: z, ground: true, rot: rot || 0, w: size });
  }
  // A freestanding double-sided board on two posts, standing on a roof or the ground at y0.
  function billboard(x, z, y0, size, nx, nz) {
    M.decor.push({ kind: "billboard", x: x, y: y0, z: z, nx: nx, nz: nz, w: size });
  }
  // Prop scatter: bin bags, tyres, a burning barrel, a shopping trolley...
  function junk(kind, x, z, extra) {
    const d = { kind: kind, x: x, z: z, y: 0 };
    if (extra) for (const k in extra) d[k] = extra[k];
    M.decor.push(d);
  }

  // ------------------------------------------------------------------ ground, streets, perimeter
  box(-48, 48, -1, 0, -38, 38, "asphalt", { surf: "concrete", ground: true });
  // Sidewalks (a kerb's worth of height is only visual: bots walk them flat).
  patch(-48, -4, -7.5, -4, 0, "sidewalk"); patch(4, 48, -7.5, -4, 0, "sidewalk");
  patch(-48, -4, 4, 7.5, 0, "sidewalk"); patch(4, 48, 4, 7.5, 0, "sidewalk");
  patch(-7.5, -4, -38, -7.5, 0, "sidewalk"); patch(4, 7.5, -38, -7.5, 0, "sidewalk");
  patch(-7.5, -4, 7.5, 38, 0, "sidewalk"); patch(4, 7.5, 7.5, 38, 0, "sidewalk");
  M.decor.push({ kind: "kerbs" });
  // Perimeter: brick walls round the block (the city beyond is backdrop).
  box(-48.6, -48, 0, 5, -38.6, 38.6, "brickdark", { surf: "brick", perim: true });
  box(48, 48.6, 0, 5, -38.6, 38.6, "brickdark", { surf: "brick", perim: true });
  box(-48, 48, 0, 5, -38.6, -38, "brickdark", { surf: "brick", perim: true });
  box(-48, 48, 0, 5, 38, 38.6, "brickdark", { surf: "brick", perim: true });
  // Main St is walled off at both ends: a shipping container and barriers.
  [-47, 47].forEach(function (x) {
    box(x - 1.2, x + 1.2, 0, 2.6, -6, 6, "container", { surf: "metal" });
    M.decor.push({ kind: "container", x: x, z: 0 });
  });
  barrier(-41, -2.5, 0.2); barrier(-40.6, 2.8, -0.15); barrier(41, 2.2, 0.1); barrier(40.4, -2.9, -0.25);
  barrier(-2.2, -35.5, 1.5); barrier(2.5, 35.2, 1.62);

  // ------------------------------------------------------------------ rowhouses (north-west)
  // Three houses x -42..-18 (8 m each), front wall on z -8, back wall z -18.
  const F1 = 3.0, RH = 6.0;
  [-42, -34, -26].forEach(function (x0, i) {
    const x1 = x0 + 8, mid = i === 1;
    const brick = anyOf(["brick", "siding", "brick"], i);
    // Ground floor: door, front window (boarded on the end houses).
    wallX(x0, x1, -8.3, -8, 0, F1, [
      { a: x0 + 1.2, b: x0 + 2.4, y0: 0, y1: 2.3 },
      { a: x0 + 4, b: x0 + 6.4, y0: 1.0, y1: 2.2, win: mid ? "frame" : "boards" }
    ], brick, { surf: "brick" });
    wallX(x0, x1, -8.3, -8, F1, RH, [
      { a: x0 + 1, b: x0 + 2.8, y0: F1 + 1, y1: F1 + 2.2, win: i === 2 ? "boards" : "frame" },
      { a: x0 + 4.6, b: x0 + 6.6, y0: F1 + 1, y1: F1 + 2.2, win: "frame" }
    ], brick, { surf: "brick" });
    wallX(x0, x1, -18, -17.7, 0, F1, [
      { a: x1 - 2.4, b: x1 - 1.2, y0: 0, y1: 2.3 },
      { a: x0 + 1.5, b: x0 + 3.5, y0: 1.0, y1: 2.2, win: "frame" }
    ], brick, { surf: "brick" });
    wallX(x0, x1, -18, -17.7, F1, RH, [{ a: x0 + 3, b: x0 + 5, y0: F1 + 1, y1: F1 + 2.2, win: "frame" }], brick, { surf: "brick" });
    // Side wall (west); the last house also closes its east side.
    wallZ(-17.7, -8.3, x0, x0 + 0.3, 0, RH, i === 0 ? [{ a: -14, b: -12, y0: 1.0, y1: 2.2, win: "boards" }] : [], brick, { surf: "brick" });
    if (i === 2) wallZ(-17.7, -8.3, x1 - 0.3, x1, 0, RH, [{ a: -14.5, b: -12.5, y0: 1.0, y1: 2.2, win: "frame" }, { a: -14.5, b: -12.5, y0: F1 + 1, y1: F1 + 2.2, win: "frame" }], brick, { surf: "brick" });
    patch(x0 + 0.3, x1, -17.7, -8.3, 0, "plank");
    // Upper floor slab; the middle house has stairs up the inside of its east wall.
    if (mid) {
      box(x0 + 0.3, x1 - 1.5, F1 - 0.25, F1, -17.7, -8.3, "slab", { top: "plank" });
      // (The stair starts 1.3 m in from the front wall so you walk onto it head-on.)
      box(x1 - 1.5, x1, F1 - 0.25, F1, -17.7, -15.6, "slab", { top: "plank" });
      stairs("z", -9.6, -15.6, x1 - 1.4, x1 - 0.05, 0, F1);
      rail(x1 - 1.5, -9.6, x1 - 1.5, -15.6, F1, 1.0);
      // A couch and a table downstairs, a mattress upstairs.
      box(x0 + 0.8, x0 + 3.0, 0, 0.8, -12.6, -11.7, "couch", { surf: "wood" });
      box(x0 + 3.2, x0 + 4.4, 0, 0.75, -15.6, -14.6, "wood", { surf: "wood" });
      box(x0 + 0.6, x0 + 2.6, F1, F1 + 0.35, -16.8, -15, "mattress", { surf: "wood", col: false });
    } else {
      box(x0 + 0.3, x1, F1 - 0.25, F1, -17.7, -8.3, "slab", { top: "plank" });
      box(x0 + 2, x0 + 4.5, 0, 1.1, -16.5, -15.6, "wood", { surf: "wood" });      // a gutted kitchen counter
      box(x0 + 5.2, x0 + 6.4, 0, 0.6, -11.5, -10.2, "rubble", { surf: "concrete" });
    }
    // Flat roof with a low parapet and a cornice line.
    box(x0, x1, RH, RH + 0.3, -18, -8, "roof", { top: "roof" });
    box(x0, x1, RH + 0.3, RH + 0.8, -8.3, -8, brick, { surf: "brick" });
    // Brick corbel cornice under the parapet, a downpipe, a chimney stack.
    M.decor.push({ kind: "cornice", axis: "x", a: x0, b: x1, c: -8.0, y: RH, face: 1 });
    M.decor.push({ kind: "pipe", x: x1 - 0.22, z: -7.86, y0: 0, y1: RH + 0.3 });
    box(x0 + 1.4, x0 + 2.4, RH + 0.3, RH + 2.8, -13.2, -12.2, "brickdark", { surf: "brick", top: "roof" });
    M.decor.push({ kind: "chimneycap", x: x0 + 1.9, z: -12.7, y: RH + 2.8 });
    // Front stoop (one step: a taller one would put the door lintel in your head).
    stairs("z", -9.2, -8.3, x0 + 1.0, x0 + 2.6, 0, 0.3, "stoop");
    // Back yard behind each house, chain-link along the alley and between yards.
    patch(x0, x1, -26, -18, 0, i === 1 ? "dirt" : "deadgrass");
    // A fire ladder up the back wall to the roof.
    ladder(x0 + 5.3, -18.45, Math.PI / 2, 0, RH + 0.3, x0 + 5.3, -16.6);
  });
  rail(-42, -26, -36.5, -26, 0, 1.6, "chain"); rail(-35, -26, -28.5, -26, 0, 1.6, "chain"); rail(-27, -26, -18, -26, 0, 1.6, "chain");
  rail(-34, -18, -34, -26, 0, 1.2, "chain"); rail(-26, -18, -26, -26, 0, 1.2, "chain");
  rail(-18, -18, -18, -26, 0, 1.6, "chain");
  // The alley behind (to the cross street) and the side alley to the west.
  patch(-48, -4, -38, -26, 0, "alley");
  dumpster(-22, -29.2, 0); dumpster(-9.6, -30.5, 1.57);
  box(-31, -29.6, 0, 0.9, -28.4, -27.3, "crate", { surf: "wood" });
  box(-44, -43, 0, 0.95, -33, -32, "drum", { surf: "metal" });
  box(-43.1, -42.1, 0, 0.95, -33.4, -32.4, "drum", { surf: "metal" });

  // ------------------------------------------------------------------ corner store + laundromat (north-east)
  const SR = 4.2;
  // Store x 8..26: broken shop windows either side of the door.
  wallX(8, 26, -8.3, -8, 0, SR, [
    { a: 9, b: 14.6, y0: 0.9, y1: 2.8, win: "shopfront" }, { a: 15.2, b: 16.8, y0: 0, y1: 2.6 },
    { a: 17.4, b: 25, y0: 0.9, y1: 2.8, win: "shopfront" }
  ], "plaster", { surf: "concrete" });
  wallX(8, 26, -22, -21.7, 0, SR, [{ a: 22, b: 23.4, y0: 0, y1: 2.4 }], "brick", { surf: "brick" });
  wallZ(-21.7, -8.3, 8, 8.3, 0, SR, [{ a: -15.5, b: -12.5, y0: 1.0, y1: 2.4, win: "bars" }], "plaster", { surf: "concrete" });
  wallZ(-21.7, -8.3, 25.7, 26, 0, SR, [{ a: -14, b: -12.4, y0: 0, y1: 2.4 }], "plaster", { surf: "concrete" });
  patch(8.3, 25.7, -21.7, -8.3, 0, "tile");
  // Shelves, the counter, a cooler along the back.
  [[10, 19, -12.2, -11.6], [10, 19, -16.2, -15.6]].forEach(function (s) { box(s[0], s[1], 0, 1.6, s[2], s[3], "shelf", { surf: "metal" }); });
  box(21.5, 25.4, 0, 1.1, -10.4, -9.6, "counter", { surf: "wood" });
  box(9, 20, 0, 2.1, -21.7, -21, "cooler", { surf: "glass" });
  // Laundromat x 26..42.
  wallX(26, 42, -8.3, -8, 0, SR, [
    { a: 27, b: 31.4, y0: 0.9, y1: 2.8, win: "shopfront" }, { a: 32, b: 33.6, y0: 0, y1: 2.6 },
    { a: 34.2, b: 41, y0: 0.9, y1: 2.8, win: "shopfront" }
  ], "plaster2", { surf: "concrete" });
  wallX(26, 42, -22, -21.7, 0, SR, [], "brick", { surf: "brick" });
  wallZ(-21.7, -8.3, 41.7, 42, 0, SR, [], "plaster2", { surf: "concrete" });
  patch(26, 41.7, -21.7, -8.3, 0, "tile2");
  box(27, 41, 0, 1.05, -21.7, -20.9, "washer", { surf: "metal" });
  box(29, 39, 0, 1.05, -15.4, -14.4, "washer", { surf: "metal" });
  box(30, 37, 0, 0.5, -10.8, -10.2, "bench", { surf: "wood" });
  // One flat roof over both, parapet round it (a gap where the stair lands).
  box(8, 42, SR, SR + 0.3, -22, -8, "roof", { top: "roof" });
  box(8, 42, SR + 0.3, SR + 0.9, -8.3, -8, "plaster", { surf: "concrete" });
  box(8, 42, SR + 0.3, SR + 0.9, -22, -21.7, "brick", { surf: "brick" });
  box(8, 8.3, SR + 0.3, SR + 0.9, -21.7, -8.3, "plaster", { surf: "concrete" });
  box(41.7, 42, SR + 0.3, SR + 0.9, -19.6, -8.3, "plaster", { surf: "concrete" });
  box(19, 22, SR + 0.3, SR + 1.6, -19, -16.5, "hvac", { surf: "metal" });
  box(31, 33, SR + 0.3, SR + 1.3, -13, -11, "hvac", { surf: "metal" });
  M.decor.push({ kind: "fan", x: 20.5, z: -17.75, y: SR + 1.6 }, { kind: "fan", x: 32, z: -12, y: SR + 1.3 });
  M.decor.push({ kind: "cornice", axis: "x", a: 8, b: 42, c: -8.0, y: SR, face: 1 });
  // A rusted water tank on legs over the laundromat's back half.
  box(35.2, 37.0, SR + 0.3, SR + 3.9, -19.2, -17.4, "steel", { vis: false, surf: "metal" });
  M.decor.push({ kind: "watertank", x: 36.1, z: -18.3, y: SR + 0.3 });
  // A ladder up the store's side wall (off Cross St).
  ladder(7.55, -19, 0, 0, SR + 0.3, 9.7, -19);
  // Outside stair up the laundromat's east wall (climbs north), landing at the roof gap.
  stairs("z", -8.6, -19.6, 42.2, 44.2, 0, SR + 0.3, "steel");
  box(42, 44.2, SR, SR + 0.3, -21.8, -19.6, "steel", { surf: "metal" });
  M.decor.push({ kind: "sign", x: 17, y: 3.45, z: -7.96, w: 8, h: 0.9, text: "CORNER MART", bg: "#b8261c", fg: "#ffe9a8" });
  M.decor.push({ kind: "sign", x: 34, y: 3.45, z: -7.96, w: 7, h: 0.9, text: "SPIN CITY LAUNDRY", bg: "#1d4f8a", fg: "#f2f2f2" });
  // The vacant lot behind: a burnt-out car, a dumpster.
  patch(8, 27, -38, -22, 0, "dirt");
  dumpster(11.5, -25.5, 0.1);
  car(20, -30, 0.35, true);

  // ------------------------------------------------------------------ the cemetery (behind the store)
  // An iron fence (gates on the west and north), rows of headstones with open
  // graves in front (where the dead climb out), a mausoleum, dead trees.
  patch(27, 48, -38, -22, 0, "graveyard");
  rail(27, -24.4, 35, -24.4, 0, 1.4, "iron"); rail(38, -24.4, 47.6, -24.4, 0, 1.4, "iron");
  rail(27, -24.4, 27, -29.4, 0, 1.4, "iron"); rail(27, -32.2, 27, -37.6, 0, 1.4, "iron");
  [[27, -24.4], [35, -24.4], [38, -24.4], [27, -29.4], [27, -32.2]].forEach(function (g) {
    box(g[0] - 0.22, g[0] + 0.22, 0, 1.9, g[1] - 0.22, g[1] + 0.22, "stone", { surf: "concrete" });   // gate pillars
  });
  M.graves = [];
  [-27.4, -30.4, -33.4].forEach(function (z, row) {
    for (let x = 29.4, k = 0; x < 46.5; x += 2.3, k++) {
      if (x > 35.3 && x < 38.3) continue;                       // the centre path
      const h = 0.7 + ((k * 7 + row * 3) % 4) * 0.12, cross = (k + row) % 5 === 2;
      if (cross) {
        box(x - 0.08, x + 0.08, 0, h + 0.45, z - 0.08, z + 0.08, "stone", { surf: "concrete" });
        box(x - 0.32, x + 0.32, h - 0.05, h + 0.12, z - 0.08, z + 0.08, "stone", { surf: "concrete", col: false });
      } else {
        box(x - 0.3, x + 0.3, 0, h, z - 0.09, z + 0.09, (k + row) % 3 ? "headstone" : "stone", { surf: "concrete" });
        M.decor.push({ kind: "tombtop", x: x, z: z, y: h, w: 0.6, d: 0.18 });     // a rounded top
      }
      // An open grave in front of every third stone: a dark pit outline the dead climb out of.
      if ((k + row) % 3 === 0) { box(x - 0.5, x + 0.5, 0.004, 0.025, z + 0.4, z + 2.2, "pit", { col: false }); M.graves.push({ x: x, z: z + 1.3 }); }
      else box(x - 0.45, x + 0.45, 0, 0.12, z + 0.35, z + 2.0, "dirt", { col: false });
    }
  });
  // The mausoleum: a stone block with a pitched roof and a door.
  box(41.5, 46.8, 0, 3.2, -37.6, -34.4, "stone", { surf: "concrete" });
  box(41.2, 47.1, 3.2, 3.5, -37.9, -34.1, "stone", { surf: "concrete" });
  M.decor.push({ kind: "mausoleum", x0: 41.5, x1: 46.8, z0: -37.6, z1: -34.4, y: 3.5 });
  [[30, -36.6], [46, -26]].forEach(function (t) {
    box(t[0] - 0.25, t[0] + 0.25, 0, 2.5, t[1] - 0.25, t[1] + 0.25, "trunk", { surf: "wood", vis: false });
    M.decor.push({ kind: "tree", x: t[0], z: t[1], bare: true });
  });

  // ------------------------------------------------------------------ the projects (south-west)
  // Three storeys x -42..-14, z 12..24. Open galleries on the street side,
  // a breezeway through the middle, a switchback stair at the east end.
  const P2 = 3.2, P3 = 6.4, PR = 9.6;
  box(-42, -30, 0, PR, 12.3, 24, "brickred", { surf: "brick" });
  box(-26, -14, 0, PR, 12.3, 24, "brickred", { surf: "brick" });
  box(-30, -26, P2 - 0.3, PR, 12.3, 24, "brickred", { surf: "brick" });   // over the breezeway
  patch(-30, -26, 12.3, 24, 0, "sidewalk");
  M.decor.push({ kind: "facade", x0: -42, x1: -14, z: 12.3, y0: 0, floors: [0, P2, P3], face: -1, skip: [-30, -26] });
  M.decor.push({ kind: "facade", x0: -42, x1: -14, z: 24, y0: 0, floors: [0, P2, P3], face: 1, skip: [-30, -26] });
  box(-42, -14, PR, PR + 0.6, 12.3, 12.6, "brickred", { surf: "brick" });
  // Galleries (with posts), railed on the street side.
  box(-42, -9.2, P2 - 0.25, P2, 9.8, 12.3, "slab", { top: "gallery" });
  box(-42, -14, P3 - 0.25, P3, 9.8, 12.3, "slab", { top: "gallery" });
  [-42, -35, -28, -21, -14.3].forEach(function (x) { box(x, x + 0.3, 0, P3 - 0.25, 9.8, 10.1, "post"); });
  rail(-42, 9.85, -14, 9.85, P2, 1.0); rail(-42, 9.85, -14, 9.85, P3, 1.0);
  // The switchback stair: flight 1 (z 22 -> 12.3, up to the second floor),
  // flight 2 (z 12.3 -> 22, up to the third), and a walkway back north on top.
  stairs("z", 22, 12.3, -14, -11.6, 0, P2);
  stairs("z", 12.3, 22, -11.6, -9.2, P2, P3);
  box(-11.6, -9.2, P3 - 0.25, P3, 22, 24.4, "slab", { top: "gallery" });
  box(-14, -11.6, P3 - 0.25, P3, 9.8, 24.4, "slab", { top: "gallery" });
  rail(-9.2, 9.8, -9.2, 12.3, P2, 1.0); rail(-9.2, 22, -9.2, 24.4, P3, 1.0); rail(-14, 24.4, -9.2, 24.4, P3, 1.0);
  rail(-11.6, 12.3, -11.6, 21.6, P3, 1.0);
  // Ladders to the projects' roof: from the top walkway, and all the way up the west end.
  ladder(-13.55, 18, Math.PI, P3, PR, -15.8, 18);
  ladder(-42.45, 19, 0, 0, PR, -40.2, 19);
  M.decor.push({ kind: "cornice", axis: "x", a: -42, b: -14, c: 12.3, y: PR, face: -1 });
  M.decor.push({ kind: "dish", x: -38.5, y: P3 + 1.0, z: 9.95, yaw: Math.PI }, { kind: "dish", x: -17.5, y: P3 + 1.0, z: 9.95, yaw: Math.PI });
  M.decor.push({ kind: "watertank", x: -22, z: 18, y: PR });
  box(-23.1, -20.9, PR, PR + 3.6, 16.9, 19.1, "steel", { vis: false, surf: "metal" });
  // The courtyard behind: dead grass, benches, a low wall, two trees.
  patch(-48, -4, 24, 38, 0, "deadgrass");
  box(-38, -34, 0, 0.5, 30, 30.6, "bench", { surf: "wood" });
  box(-22, -18, 0, 0.5, 30, 30.6, "bench", { surf: "wood" });
  box(-33, -23, 0, 1.0, 34.5, 35.1, "lowwall", { surf: "concrete" });
  box(-12, -10.8, 0, 1.3, 28, 29.2, "crate", { surf: "wood" });
  [[-40, 27], [-16, 33], [-45, 35]].forEach(function (t) {
    box(t[0] - 0.25, t[0] + 0.25, 0, 2.5, t[1] - 0.25, t[1] + 0.25, "trunk", { surf: "wood", vis: false });
    M.decor.push({ kind: "tree", x: t[0], z: t[1] });
  });

  // ------------------------------------------------------------------ burned house + court (south-east)
  // The burned-out house: broken walls, half a roof, rubble.
  patch(10, 24, 10, 24, 0, "dirt");
  wallX(12, 22, 12, 12.3, 0, 2.8, [{ a: 14, b: 15.4, y0: 0, y1: 2.3 }, { a: 17, b: 20.5, y0: 0.9, y1: 2.8 }], "burntwood", { surf: "wood" });
  wallX(12, 19, 21.7, 22, 0, 2.8, [{ a: 15, b: 17, y0: 1.0, y1: 2.2, win: "boards" }], "burntwood", { surf: "wood" });
  box(19, 22, 0, 1.2, 21.7, 22, "burntwood", { surf: "wood" });
  wallZ(12.3, 21.7, 12, 12.3, 0, 2.8, [{ a: 15, b: 17.5, y0: 1.0, y1: 2.2 }], "burntwood", { surf: "wood" });
  wallZ(12.3, 21.7, 21.7, 22, 0, 2.8, [{ a: 13.5, b: 18.5, y0: 0, y1: 2.8 }], "burntwood", { surf: "wood" });
  box(12, 17, 2.8, 3.0, 12, 17, "burntwood", { surf: "wood" });
  box(15.5, 18.5, 0, 0.8, 16, 18.4, "rubble", { surf: "wood" });
  box(13, 14.2, 0, 1.0, 19.5, 20.7, "rubble", { surf: "wood" });
  // The court: fenced, gaps at the corners, a hoop at each end.
  patch(26, 42, 14, 32, 0, "court");
  rail(26, 14, 40, 14, 0, 3.0, "chain"); rail(26, 32, 34, 32, 0, 3.0, "chain"); rail(36, 32, 42, 32, 0, 3.0, "chain");
  rail(26, 16, 26, 32, 0, 3.0, "chain"); rail(42, 14, 42, 30, 0, 3.0, "chain");
  [[27.2, 23, 0], [40.8, 23, Math.PI]].forEach(function (h) {
    box(h[0] - 0.12, h[0] + 0.12, 0, 3.0, h[1] - 0.12, h[1] + 0.12, "post", { vis: false });
    M.decor.push({ kind: "hoop", x: h[0], z: h[1], yaw: h[2] });
  });
  box(30, 33, 0, 0.5, 31, 31.6, "bench", { surf: "wood" });
  patch(26, 48, 32, 38, 0, "deadgrass");
  box(44, 45.2, 0, 1.3, 34, 35.2, "crate", { surf: "wood" });

  // ------------------------------------------------------------------ the south house (south-east)
  // A third abandoned house, close to where the enemy comes in: two rooms, half its roof caved in,
  // boarded windows, a back door onto the grass strip behind the court.
  const SH = { x0: 11, x1: 23, z0: 26.5, z1: 36.5, h: 3.0 };
  patch(8, 27, 24, 38, 0, "deadgrass");
  patch(SH.x0 + 0.3, SH.x1 - 0.3, SH.z0 + 0.3, SH.z1 - 0.3, 0, "plank");
  wallX(SH.x0, SH.x1, SH.z0, SH.z0 + 0.3, 0, SH.h, [
    { a: 12.2, b: 14.6, y0: 1.0, y1: 2.2, win: "boards" }, { a: 16, b: 17.2, y0: 0, y1: 2.3 },
    { a: 19.2, b: 21.6, y0: 1.0, y1: 2.2, win: "frame" }
  ], "siding", { surf: "wood" });
  wallX(SH.x0, SH.x1, SH.z1 - 0.3, SH.z1, 0, SH.h, [
    { a: 13.2, b: 14.4, y0: 0, y1: 2.3 }, { a: 19, b: 21, y0: 1.0, y1: 2.2, win: "boards" }
  ], "brick", { surf: "brick" });
  wallZ(SH.z0 + 0.3, SH.z1 - 0.3, SH.x0, SH.x0 + 0.3, 0, SH.h, [{ a: 28, b: 30, y0: 1.0, y1: 2.2, win: "boards" }, { a: 33, b: 35, y0: 1.0, y1: 2.2, win: "frame" }], "brick", { surf: "brick" });
  wallZ(SH.z0 + 0.3, SH.z1 - 0.3, SH.x1 - 0.3, SH.x1, 0, SH.h, [{ a: 33.2, b: 34.8, y0: 0, y1: 2.3 }, { a: 28, b: 30, y0: 1.0, y1: 2.2, win: "boards" }], "brick", { surf: "brick" });
  // The dividing wall: two doorways (the left one hung with a ruined curtain of plaster).
  wallX(SH.x0 + 0.3, SH.x1 - 0.3, 31.85, 32.15, 0, SH.h, [{ a: 13.6, b: 14.8, y0: 0, y1: 2.3 }, { a: 19.6, b: 20.8, y0: 0, y1: 2.3 }], "plaster", { surf: "concrete" });
  // Half a roof: the east end has fallen in (rubble heaps, a sagging beam).
  box(SH.x0, 19, SH.h, SH.h + 0.3, SH.z0, SH.z1, "roof", { top: "roof" });
  box(19, SH.x1, SH.h, SH.h + 0.25, SH.z0, 28.4, "roof", { top: "roof" });
  box(19.5, 22.5, 0, 0.9, 35.0, 36.2, "rubble", { surf: "concrete" });
  box(20.4, 22.7, 0, 0.5, 29.5, 30.8, "rubble", { surf: "concrete" });
  rbox(20.6, 33.0, 1.6, 0.14, 0.55, 1.8, 2.15, "wood", { surf: "wood", col: false });
  // Rooms: a gutted sofa, a table on its side, a mattress, boxes.
  box(11.6, 13.9, 0, 0.8, 27.4, 28.3, "couch", { surf: "wood" });
  box(12.0, 13.6, 0, 0.7, 30.3, 31.1, "wood", { surf: "wood" });
  box(21.4, 22.6, 0, 1.0, 26.9, 27.9, "crate", { surf: "wood" });
  box(12.4, 14.6, 0, 0.35, 33.0, 35.2, "mattress", { surf: "wood", col: false });
  box(16.6, 17.6, 0, 0.8, 35.0, 36.0, "crate", { surf: "wood" });
  M.decor.push({ kind: "cornice", axis: "x", a: SH.x0, b: SH.x1, c: SH.z0, y: SH.h, face: -1 });
  M.decor.push({ kind: "pipe", x: SH.x0 + 0.2, z: SH.z0 - 0.1, y0: 0, y1: SH.h });
  // A path of cracked slabs from the door to the street, a dead bush, a wrecked car in the yard.
  car(9.4, 31, 1.5, true);

  // ------------------------------------------------------------------ the streets
  car(-30, -3, 0); car(-13.5, 3, Math.PI); car(20, -3, 0.04); car(36, 3, Math.PI - 0.05);
  car(3, -20, Math.PI / 2); car(-3, 22, -Math.PI / 2); car(-3, -27, -Math.PI / 2 + 0.06);
  car(1.5, 1.2, 0.62, true);                         // crashed in the middle of the junction
  // Two box trucks, one in each lane, so Main St isn't one long shooting gallery.
  [[-22, -1.25, 0], [24, 1.35, Math.PI + 0.05]].forEach(function (t) {
    rbox(t[0], t[1], 3.3, 1.2, t[2], 0, 3.2, "truck", { surf: "metal", vis: false });
    M.decor.push({ kind: "truck", x: t[0], z: t[1], yaw: t[2] });
  });
  dumpster(-7, 9.6, 0);
  [[-36, -6.8], [-12, -6.8], [12, -6.8], [36, -6.8], [-36, 6.8], [-12, 6.8], [12, 6.8], [36, 6.8], [-6.8, -20], [6.8, 22]].forEach(function (l) {
    box(l[0] - 0.1, l[0] + 0.1, 0, 4.5, l[1] - 0.1, l[1] + 0.1, "post", { vis: false, surf: "metal" });
    M.decor.push({ kind: "lamp", x: l[0], z: l[1], face: l[1] > 0 && Math.abs(l[1]) < 8 ? -1 : l[1] < 0 && Math.abs(l[1]) < 8 ? 1 : 0 });
  });
  [[-20, 6.9], [24, -6.9]].forEach(function (h) {
    box(h[0] - 0.15, h[0] + 0.15, 0, 0.7, h[1] - 0.15, h[1] + 0.15, "hydrant", { surf: "metal", vis: false });
    M.decor.push({ kind: "hydrant", x: h[0], z: h[1] });
  });
  box(-4.6, -3.4, 0, 1.1, 30, 31.2, "crate", { surf: "wood" });
  box(9.5, 11, 0, 1.6, 6.9, 7.5, "busstop", { surf: "glass", col: false });

  // ------------------------------------------------------------------ the company seal, all over the block
  // Weathered paint on walls, a big one on the junction and the court, lit boards on the roofs.
  logoFloor(-0.4, 0.4, 8.2, 0.25, 0.02);                                  // the junction
  logoFloor(34, 23, 6.4, 0, 0.03);                                         // centre court
  logoFloor(-38, -13, 4.4, 0.4, 0.03); logoFloor(-22, -13, 4.2, -0.5, 0.03); logoFloor(19.5, 16.5, 4.2, -0.3, 0.03); logoFloor(17.5, 29.3, 3.8, 0.9, 0.03);   // inside the turf houses
  logo(-42.02, 3.4, -13, -1, 0, 5.2);                                       // rowhouses' west wall (the crew's alley)
  logo(-17.98, 3.2, -10.5, 1, 0, 3.4);                                      // rowhouses' east wall
  logo(7.98, 2.5, -10.4, -1, 0, 3.4);                                       // corner store, Cross St side
  logo(-42.02, 5.2, 15.2, -1, 0, 5.0);                                      // the projects' west end
  logo(-28, 6.3, 12.28, 0, -1, 3.6); logo(-28, 6.3, 24.02, 0, 1, 3.6);      // over the projects' breezeway
  logo(-0.15, 3.0, -37.98, 0, 1, 4.6);   logo(-30, 2.7, -37.98, 0, 1, 4.2); logo(30, 2.7, -37.98, 0, 1, 4.2);
  logo(-0.15, 3.0, 37.98, 0, -1, 4.6);   logo(-30, 2.7, 37.98, 0, -1, 4.2); logo(30, 2.7, 37.98, 0, -1, 4.2);
  logo(-47.98, 2.7, -22, 1, 0, 4.0); logo(-47.98, 2.7, 22, 1, 0, 4.0);
  logo(47.98, 2.7, -22, -1, 0, 4.0); logo(47.98, 2.7, 22, -1, 0, 4.0);
  logo(-45.78, 1.45, 0, 1, 0, 2.4); logo(45.78, 1.45, 0, -1, 0, 2.4);       // the containers at the ends of Main St
  billboard(-28, 18, PR + 0.6, 4.6, 0, 1);                                  // over the projects, facing the courtyard...
  billboard(-30, -13, RH + 0.3, 3.6, 0, 1);                                 // on the middle rowhouse, facing Main St
  billboard(33, -13.5, SR + 0.3, 4.2, 0, 1);                                // on the laundromat
  billboard(14.5, 14.6, 3.0, 3.0, 0, 1);                                    // on the burned house's last bit of roof
  // The seal on a plate on every lamp post, either side along the road.
  [[-36, -6.8, 1], [-12, -6.8, 1], [12, -6.8, 1], [36, -6.8, 1], [-36, 6.8, 1], [-12, 6.8, 1], [12, 6.8, 1], [36, 6.8, 1]].forEach(function (l) {
    logo(l[0] + 0.11, 3.1, l[1], 1, 0, 0.9, true); logo(l[0] - 0.11, 3.1, l[1], -1, 0, 0.9, true);
  });
  [[-6.8, -20], [6.8, 22]].forEach(function (l) { logo(l[0], 3.1, l[1] + 0.11, 0, 1, 0.9, true); logo(l[0], 3.1, l[1] - 0.11, 0, -1, 0.9, true); });

  // ------------------------------------------------------------------ rubbish and ruin
  [[-30, -6.2], [-9, -6.4], [22, -6.3], [-44, 7], [30, 7.0], [-19, 6.6], [9, 8], [-3, -33], [-26, -30.5], [14, -28], [-40, -31], [4, 30], [-8, 33], [31, 36.5], [-16, 27.5], [-44, 28], [44, 36], [26, -37]].forEach(function (p, i) {
    junk("bags", p[0], p[1], { n: 3 + (i % 4), seed: i * 11 + 3 });
  });
  [[-18.5, -5.2], [27, 5.4], [-45, -28.5], [10.5, 35.5], [46, 8.5]].forEach(function (p, i) { junk("tires", p[0], p[1], { n: 2 + (i % 3), seed: i + 40 }); });
  barrelFire(6.4, -25.5); barrelFire(-44.4, 9.8); barrelFire(25.5, 25);
  junk("trolley", -6, -4.9, { yaw: 0.7 }); junk("trolley", 15.5, 6.1, { yaw: -2.2 }); junk("trolley", -21.5, 31.4, { yaw: 1.3 });
  [[-12, 4.9], [14, -5.4], [-36, -5.4]].forEach(function (p, i) { junk("puddle", p[0], p[1], { r: 1.2 + i * 0.4, seed: i }); });
  [[-1.5, -2.5], [-9, 1.8], [18, 0.9], [-23, -2.6], [2, 14], [-1, -14], [34, -2], [-33, 2.3], [4, 26]].forEach(function (p, i) { junk("puddle", p[0], p[1], { r: 0.9 + (i % 3) * 0.55, seed: i + 7 }); });
  // Power poles and sagging wires over the streets.
  [[-26, -7.2], [26, -7.2], [-26, 7.2], [26, 7.2]].forEach(function (p) {
    box(p[0] - 0.14, p[0] + 0.14, 0, 8, p[1] - 0.14, p[1] + 0.14, "post", { vis: false, surf: "wood" });
    M.decor.push({ kind: "pole", x: p[0], z: p[1], h: 8 });
  });
  M.decor.push({ kind: "wires", x0: -26, z0: -7.2, x1: 26, z1: -7.2, y: 7.4 }, { kind: "wires", x0: -26, z0: 7.2, x1: 26, z1: 7.2, y: 7.4 },
    { kind: "wires", x0: -26, z0: -7.2, x1: -26, z1: 7.2, y: 7.4 }, { kind: "wires", x0: 26, z0: -7.2, x1: 26, z1: 7.2, y: 7.4 });

  // ------------------------------------------------------------------ gameplay points
  // Capture points (turf mode). spawns: where the holder can come back in.
  function point(name, x, y, z, r, spawns) {
    M.points.push({ id: M.points.length, name: name, x: x, y: y, z: z, r: r,
      spawns: spawns.map(function (s) { return { x: s[0], y: y, z: s[1], yaw: s[2] || 0 }; }) });
  }
  // Turf is fought inside the abandoned houses: the west rowhouse (the crew's end), the burned house
  // (the middle) and the south house (the enemy's end), with the east rowhouse as the crew's second.
  point("WEST ROWHOUSE", -38, 0, -13, 2.7, [[-39.2, -10, 1.57], [-37.4, -9.3, 1.57], [-36.4, -16.4, -1.57]]);
  point("EAST ROWHOUSE", -22, 0, -13, 2.7, [[-21.5, -9.4, 1.57], [-19.4, -14.6, 0], [-19.4, -16.3, 0]]);
  point("BURNED HOUSE", 19.5, 0, 16.5, 2.8, [[14, 14, 0.8], [20, 20.5, -1.57], [20.5, 14, 1.57]]);
  point("SOUTH HOUSE", 17.5, 0, 29.3, 2.4, [[13.5, 29.4, 0], [21, 28.8, 3.14], [18, 34.5, -1.57]]);

  // The duffle run: every point is a stash, a table in the middle of its house with two empty duffle
  // bags on it and a pile of silver-wrapped bricks beside it (view.js draws the bags and bricks live).
  // Each side's block is a drop zone at its end of the map: bags are carried home to it.
  M.points.forEach(function (P) {
    box(P.x - 0.85, P.x + 0.85, 0, 0.8, P.z - 0.45, P.z + 0.45, "wood", { surf: "wood", vis: false });
    M.decor.push({ kind: "stash", x: P.x, z: P.z, i: P.id });
  });
  M.zones.push({ team: 0, x: -44.8, y: 0, z: -17, r: 3.2, name: "ALEX'S BLOCK" }, { team: 1, x: 38.5, y: 0, z: 35, r: 2.9, name: "IRON WATCH BLOCK" });
  M.zones.forEach(function (Z) { logoFloor(Z.x, Z.z, Z.r * 1.5, Z.team ? 0.6 : -0.6, 0.03); });
  // Pickups. w: weapon index (see weapons.js) | armor | health | nades.
  function pk(kind, x, y, z, w) { M.pickups.push({ id: M.pickups.length, kind: kind, x: x, y: y, z: z, w: w }); }
  pk("weapon", 12, 0, -18.5, 2);           // shotgun: in the corner store
  pk("weapon", -21, 0, 33, 2);             // shotgun: the courtyard
  pk("weapon", -30, P3, 11, 3);            // marksman rifle: top gallery of the projects
  pk("weapon", 24, SR + 0.3, -13, 4);      // RPG: on the store roof
  pk("weapon", -31.5, 0, -10, 1); pk("weapon", 35, 0, -18, 1);   // rifle ammo
  pk("armor", -28.6, F1, -12, 0); pk("armor", 16.5, 0, 19.5, 0);
  pk("health", -28, 0, 31, 0); pk("health", 38, 0, -11.5, 0); pk("health", 0, 0, -31, 0); pk("health", -40, 0, -21, 0);
  pk("nades", 39, 0, 30, 5); pk("nades", -14, 0, -31, 5);
  pk("weapon", 14.2, 0, 35.2, 2);          // shotgun: the south house's back room
  pk("armor", 21.6, 0, 34.9 - 2.2, 0); pk("health", 17.6, 0, 33.6, 0);

  // Spawns, out of sight of each other. side 0 = Ant's crew (the side alley
  // west of the rowhouses), 1 = the enemy (behind the court, south-east).
  function sp(x, y, z, yaw, side) { M.spawns.push({ x: x, y: y, z: z, yaw: yaw, side: side }); }
  [[-45, -11], [-45, -14], [-45, -17], [-45, -20], [-43.5, -12.5], [-43.5, -15.5], [-43.5, -18.5], [-45, -23]].forEach(function (s) { sp(s[0], 0, s[1], Math.PI / 2, 0); });
  [[31, 35.5], [35, 35.5], [39, 35.5], [46, 33], [45, 12], [45, 16], [45, 21], [45, 27]].forEach(function (s) { sp(s[0], 0, s[1], s[1] > 32 ? -Math.PI / 2 : Math.PI, 1); });
  // The dead climb out of the open graves.
  M.graves.forEach(function (g) { sp(g.x, 0, g.z, -Math.PI / 2, "dead"); });

  // Places bots wander between.
  [[0, 0, 0], [-20, 0, 0], [20, 0, 0], [0, 0, -20], [0, 0, 20], [-30, 0, -13], [-28.6, F1, -12], [-38, 0, -13],
   [-20, 0, -22], [-30, 0, -31], [17, 0, -14], [34, 0, -12], [24, SR + 0.3, -15], [22, 0, -34], [36.8, 0, -29], [33, 0, -35.5], [-28, 0, 18],
   [-28, P2, 11], [-24, P3, 11], [-30, 0, 30], [-14, 0, 30], [14.5, 0, 15], [34, 0, 23], [30, 0, 35], [-44, 0, -30], [44, 0, -30],
   [17, 0, 29.3], [16.5, 0, 34.2], [19.5, 0, 16.5], [-38, 0, -13]].forEach(function (h) {
    M.hotspots.push({ x: h[0], y: h[1], z: h[2] });
  });

  SP.MAP = M;
})(globalThis.SP);
