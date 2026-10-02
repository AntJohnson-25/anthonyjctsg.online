// The yacht. An original layout in the spirit of a luxury-yacht arena map:
// stern pool deck (team A), foredeck with a tender and cargo (team B), a
// glass-walled lounge midships with a sun deck, hot tub and wheelhouse on its
// roof, long port/starboard walkways, and a lower deck (bar + galley) reached
// by stairwells fore and aft plus a flank stair on the port walkway.
//
// Units are metres. +x is the bow, -x the stern, +z starboard, y up.
// Every box here is both collision and visuals unless flagged:
//   col:false  -> visual only        vis:false -> collision only
//   top/side/bottom -> per-face material keys (default: mat)
//   surf -> what a thrown knife sounds like hitting it
globalThis.HK = globalThis.HK || {};
(function (HK) {
  "use strict";

  const DECK = 0, LOW = -3.2, ROOF = 3.3;
  const M = {
    DECK: DECK, LOW: LOW, ROOF: ROOF, WATER: -4.3,
    boxes: [], decor: [], water: [], spawns: [], hotspots: [], lights: [],
    bounds: { x0: -36, x1: 40, z0: -16, z1: 9 }
  };

  // Hull half-width: straight sides, then a rounded bow from x=22 to the tip at 40.
  M.halfWidth = function (x) {
    if (x <= 22) return 9;
    if (x >= 40) return 0;
    const u = (x - 22) / 18;
    return 9 * Math.sqrt(Math.max(0, 1 - u * u));
  };
  // Deck outline, stern-port corner first, counter-clockwise seen from above.
  M.outline = function (inset) {
    inset = inset || 0;
    const pts = [];
    pts.push([-36 + inset, -9 + inset]);
    for (let x = 22; x < 40; x += 1) pts.push([x, -Math.max(0.05, M.halfWidth(x) - inset)]);
    pts.push([40 - inset * 2, 0]);
    for (let x = 39; x >= 22; x -= 1) pts.push([x, Math.max(0.05, M.halfWidth(x) - inset)]);
    pts.push([-36 + inset, 9 - inset]);
    return pts;
  };

  function box(x0, x1, y0, y1, z0, z1, mat, opt) {
    const b = {
      cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2,
      yaw: 0, miny: y0, maxy: y1, mat: mat || "paint", surf: "metal"
    };
    if (opt) for (const k in opt) b[k] = opt[k];
    M.boxes.push(b);
    return b;
  }
  // A thin wall/rail between two points (any angle).
  function seg(x0, z0, x1, z1, y0, y1, thick, mat, opt) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    const b = {
      cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: len / 2, hz: thick / 2,
      yaw: Math.atan2(dz, dx), miny: y0, maxy: y1, mat: mat || "paint", surf: "metal"
    };
    if (opt) for (const k in opt) b[k] = opt[k];
    M.boxes.push(b);
    return b;
  }
  // Glass railing with a chrome cap rail and posts (the cap/posts are decor).
  function rail(x0, z0, x1, z1, y, h) {
    h = h || 1.1;
    seg(x0, z0, x1, z1, y, y + h, 0.08, "glass", { surf: "glass" });
    M.decor.push({ kind: "railcap", x0: x0, z0: z0, x1: x1, z1: z1, y: y + h });
  }

  // Rectangle minus rectangular holes -> list of covering rectangles.
  function rectMinus(o, holes) {
    const xs = [o.x0, o.x1], zs = [o.z0, o.z1];
    holes.forEach(function (h) {
      [h.x0, h.x1].forEach(function (v) { if (v > o.x0 && v < o.x1) xs.push(v); });
      [h.z0, h.z1].forEach(function (v) { if (v > o.z0 && v < o.z1) zs.push(v); });
    });
    const ux = Array.from(new Set(xs)).sort(function (a, b) { return a - b; });
    const uz = Array.from(new Set(zs)).sort(function (a, b) { return a - b; });
    const strips = [];
    for (let i = 0; i < ux.length - 1; i++) {
      let start = null;
      for (let j = 0; j <= uz.length - 1; j++) {
        let free = false;
        if (j < uz.length - 1) {
          const cx = (ux[i] + ux[i + 1]) / 2, cz = (uz[j] + uz[j + 1]) / 2;
          free = !holes.some(function (h) { return cx > h.x0 && cx < h.x1 && cz > h.z0 && cz < h.z1; });
        }
        if (free && start === null) start = uz[j];
        if (!free && start !== null) { strips.push({ x0: ux[i], x1: ux[i + 1], z0: start, z1: uz[j] }); start = null; }
      }
    }
    // Merge strips with identical z-range across neighbouring x-intervals.
    const out = [];
    strips.forEach(function (s) {
      const m = out.find(function (r) { return r.x1 === s.x0 && r.z0 === s.z0 && r.z1 === s.z1; });
      if (m) m.x1 = s.x1; else out.push({ x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1 });
    });
    return out;
  }
  M.rectMinus = rectMinus;

  // A straight flight of steps. Climbs from yLow at x=xLow to yHigh at x=xHigh
  // (xHigh may be less than xLow). Each step is a solid block down to yBase.
  function stairs(xLow, xHigh, z0, z1, yLow, yHigh, yBase, n) {
    const rise = (yHigh - yLow) / n, run = (xHigh - xLow) / n;
    for (let i = 1; i <= n; i++) {
      const a = xLow + run * (i - 1), b = xLow + run * i;
      box(Math.min(a, b), Math.max(a, b), yBase, yLow + rise * i, z0, z1, "teak",
        { side: "paint", surf: "wood", stair: true });
    }
  }

  // ---------------------------------------------------------------- holes
  const HOLE_STERN = { x0: -21, x1: -16, z0: -1.4, z1: 1.4 };
  const HOLE_BOW = { x0: 16, x1: 21, z0: -1.4, z1: 1.4 };
  const HOLE_PORT = { x0: -1, x1: 4, z0: -7, z1: -5.4 };
  const HOLE_POOL = { x0: -32, x1: -26, z0: -3, z1: 3 };
  M.deckHoles = [HOLE_STERN, HOLE_BOW, HOLE_PORT, HOLE_POOL];

  // ---------------------------------------------------------------- main deck
  // Collision slabs (the visible deck is one extruded shape built by the view).
  rectMinus({ x0: -36, x1: 22, z0: -9, z1: 9 }, M.deckHoles).forEach(function (r) {
    box(r.x0, r.x1, -0.3, 0, r.z0, r.z1, "teak", { vis: false, surf: "wood" });
  });
  for (let x = 22; x < 40; x += 1) {
    const w = M.halfWidth(x);
    box(x, x + 1, -0.3, 0, -w, w, "teak", { vis: false, surf: "wood" });
  }

  // Perimeter railing (the port side has gaps for the boarding ramps).
  const RAMPS = [-9, 5.5], RAMP_W = 1.5;
  rail(-35.95, -8.9, -35.95, 8.9, DECK);
  rail(-35.95, -8.92, RAMPS[0] - RAMP_W / 2, -8.92, DECK);
  rail(RAMPS[0] + RAMP_W / 2, -8.92, RAMPS[1] - RAMP_W / 2, -8.92, DECK);
  rail(RAMPS[1] + RAMP_W / 2, -8.92, 22, -8.92, DECK);
  rail(-35.95, 8.92, 22, 8.92, DECK);
  for (let x = 22; x < 40; x += 2) {
    const xa = x, xb = Math.min(40, x + 2);
    const wa = M.halfWidth(xa) - 0.08, wb = Math.max(0.15, M.halfWidth(xb) - 0.08);
    rail(xa, -wa, xb, -wb, DECK);
    rail(xa, wa, xb, wb, DECK);
  }

  // ---------------------------------------------------------------- stern pool deck
  box(-32, -26, -1.25, -0.9, -3, 3, "tile", { surf: "tile" });                 // pool floor
  box(-32.3, -32, -1.25, -0.02, -3.3, 3.3, "tile", { surf: "tile" });          // pool walls
  box(-26, -25.7, -1.25, -0.02, -3.3, 3.3, "tile", { surf: "tile" });
  box(-32, -26, -1.25, -0.02, -3.3, -3, "tile", { surf: "tile" });
  box(-32, -26, -1.25, -0.02, 3, 3.3, "tile", { surf: "tile" });
  box(-27.4, -26, -1.25, -0.6, -3, 3, "tile", { surf: "tile" });                // pool steps (bow end)
  box(-26.7, -26, -1.25, -0.3, -3, 3, "tile", { surf: "tile" });
  box(-32, -30.6, -1.25, -0.6, -3, 3, "tile", { surf: "tile" });                // (stern end)
  box(-32, -31.3, -1.25, -0.3, -3, 3, "tile", { surf: "tile" });
  M.water.push({ x0: -32, x1: -26, z0: -3, z1: 3, y: -0.22, kind: "pool" });

  // Sun loungers along both sides of the pool.
  [-33.2, -30.2, -27.2].forEach(function (x) {
    [-1, 1].forEach(function (s) {
      box(x - 0.4, x + 0.4, 0, 0.5, s > 0 ? 5.2 : -7.1, s > 0 ? 7.1 : -5.2, "cushion", { surf: "soft", vis: false });
      M.decor.push({ kind: "lounger", x: x, z0: s > 0 ? 5.2 : -7.1, z1: s > 0 ? 7.1 : -5.2, s: s });

    });
  });
  // Aft bar with stools.
  box(-35.5, -34.4, 0, 1.1, -4, 4, "darkwood", { top: "marble", surf: "wood" });
  [-3, -1, 1, 3].forEach(function (z) { M.decor.push({ kind: "stool", x: -33.8, z: z, y: 0 }); });
  // Planters at the stern corners (cover).
  box(-35.6, -34.4, 0, 0.9, -8.6, -7.4, "planter", { surf: "wood" });
  box(-35.6, -34.4, 0, 0.9, 7.4, 8.6, "planter", { surf: "wood" });
  M.decor.push({ kind: "plant", x: -35, z: -8, y: 0.9 }, { kind: "plant", x: -35, z: 8, y: 0.9 });
  // Shade canopy over the aft deck (decor only, high enough to ignore).
  M.decor.push({ kind: "canopy", x0: -35.85, x1: -33.4, z0: -4.6, z1: 4.6, y: 3.0 });

  // ---------------------------------------------------------------- lower deck
  box(-21, 21, -3.5, LOW, -7, 7, "carpet", { surf: "soft" });
  box(-21.3, -21, -3.5, -0.3, -7.3, 7.3, "panel", { surf: "wood" });
  box(21, 21.3, -3.5, -0.3, -7.3, 7.3, "panel", { surf: "wood" });
  box(-21.3, 21.3, -3.5, -0.3, 7, 7.3, "panel", { surf: "wood" });
  box(-21.3, 21.3, -3.5, -0.3, -7.3, -7, "panel", { surf: "wood" });
  rectMinus({ x0: -21, x1: 21, z0: -7, z1: 7 }, [HOLE_STERN, HOLE_BOW, HOLE_PORT]).forEach(function (r) {
    box(r.x0, r.x1, -0.36, -0.3, r.z0, r.z1, "ceiling", { col: false });
  });
  // Stairs: aft and forward stairwells, and the port flank stair.
  stairs(-16, -21, -1.4, 1.4, LOW, DECK, -3.5, 12);
  stairs(16, 21, -1.4, 1.4, LOW, DECK, -3.5, 12);
  stairs(4, -1, -7, -5.4, LOW, DECK, -3.5, 12);
  // Rails round the stairwells (the entry side is open).
  rail(-21, -1.5, -16, -1.5, DECK, 1.0); rail(-21, 1.5, -16, 1.5, DECK, 1.0); rail(-15.95, -1.5, -15.95, 1.5, DECK, 1.0);
  rail(16, -1.5, 21, -1.5, DECK, 1.0); rail(16, 1.5, 21, 1.5, DECK, 1.0); rail(15.95, -1.5, 15.95, 1.5, DECK, 1.0);
  rail(-1, -7.08, 4, -7.08, DECK, 1.0); rail(4.05, -7.1, 4.05, -5.35, DECK, 1.0);
  // Bar, back shelf, galley, lounge, dining, pillars.
  box(-6, 6, LOW, -2.1, 4.4, 5.2, "darkwood", { top: "marble", surf: "wood" });
  box(-6, 6, LOW, -1.3, 6.5, 7, "darkwood", { surf: "wood" });
  M.decor.push({ kind: "bottles", x0: -5.5, x1: 5.5, z: 6.75, y: -1.3 });
  [-4, -2, 0, 2, 4].forEach(function (x) { M.decor.push({ kind: "stool", x: x, z: 3.7, y: LOW }); });
  box(8, 12, LOW, -2.25, -1, 1, "steel", { top: "marble" });
  box(6, 14, LOW, -2.25, -7, -6.2, "steel", { top: "marble" });
  box(13.2, 14, LOW, -1.2, 5.6, 7, "steel");                                     // fridge
  box(-13, -9, LOW, -2.45, -6.6, -5.8, "leather", { surf: "soft" });
  box(-13.8, -13, LOW, -2.45, -6.6, -3, "leather", { surf: "soft" });
  box(-12.4, -10, LOW, -2.75, -4.8, -3.4, "darkwood", { surf: "wood" });
  box(-12, -8, LOW, -2.45, 2, 4, "darkwood", { surf: "wood" });
  [[-4, -3.2], [-4, 3.2], [4, -3.2], [4, 3.2]].forEach(function (p) {
    box(p[0] - 0.22, p[0] + 0.22, LOW, -0.36, p[1] - 0.22, p[1] + 0.22, "panel", { surf: "wood" });
  });
  M.lights.push({ x: -12, y: -1.7, z: 0, color: 0xffd9a8, d: 16 }, { x: -1, y: -1.7, z: 2, color: 0xffd9a8, d: 16 }, { x: 10, y: -1.7, z: -2, color: 0xffe8cc, d: 16 });
  [-12, -6, 0, 6, 12].forEach(function (x) {
    [-3.6, 3.6].forEach(function (z) { box(x - 1.2, x + 1.2, -0.4, -0.36, z - 0.35, z + 0.35, "light", { col: false }); });
  });

  // ---------------------------------------------------------------- lounge (main deck)
  // Walls: paint below, tinted glass band, paint above; doorways with lintels.
  function loungeWall(axis, at, from, to, gaps, thick) {
    // axis "x": wall runs along x at z=at.  axis "z": runs along z at x=at.
    const t = thick / 2;
    const cuts = [from];
    gaps.forEach(function (g) { cuts.push(g[0], g[1]); });
    cuts.push(to);
    function piece(a, b, y0, y1, mat, opt) {
      if (b - a < 0.01) return;
      if (axis === "x") box(a, b, y0, y1, at - t, at + t, mat, opt);
      else box(at - t, at + t, y0, y1, a, b, mat, opt);
    }
    for (let i = 0; i < cuts.length; i += 2) {
      piece(cuts[i], cuts[i + 1], DECK, 0.9, "paint");
      piece(cuts[i], cuts[i + 1], 0.9, 2.4, "tint", { surf: "glass" });
      piece(cuts[i], cuts[i + 1], 2.4, 3.0, "paint");
    }
    gaps.forEach(function (g) { piece(g[0], g[1], 2.4, 3.0, "paint"); });
  }
  loungeWall("z", -12.85, -5.3, 5.3, [[-0.9, 0.9]], 0.3);
  loungeWall("z", 12.85, -5.3, 5.3, [[-0.9, 0.9]], 0.3);
  loungeWall("x", 5.15, -13, 13, [[-5.9, -4.1], [5.1, 6.9]], 0.3);
  loungeWall("x", -5.15, -13, 13, [[-5.9, -4.1], [5.1, 6.9]], 0.3);
  box(-13.3, 13.3, 3.0, ROOF, -5.6, 5.6, "teak", { side: "paint", bottom: "ceiling", surf: "wood" });
  box(-12.7, 12.7, DECK, 0.02, -5, 5, "carpet", { col: false });
  box(-12, 12, 2.94, 3.0, -0.25, 0.25, "light", { col: false });
  // Lounge furniture: two L-sofas aft, marble island, dining table forward.
  box(-11, -7, DECK, 0.8, -4.9, -4.1, "leather", { surf: "soft" });
  box(-11.9, -11, DECK, 0.8, -4.9, -1.6, "leather", { surf: "soft" });
  box(-10, -8, DECK, 0.42, -3.2, -2, "darkwood", { surf: "wood" });
  box(-11, -7, DECK, 0.8, 4.1, 4.9, "leather", { surf: "soft" });
  box(-11.9, -11, DECK, 0.8, 1.6, 4.9, "leather", { surf: "soft" });
  box(-10, -8, DECK, 0.42, 2, 3.2, "darkwood", { surf: "wood" });
  box(-1.5, 1.5, DECK, 1.0, -1.2, 1.2, "marble", { surf: "tile" });
  box(6.5, 10.5, DECK, 0.78, -1, 1, "darkwood", { surf: "wood" });
  [7, 8.5, 10].forEach(function (x) {
    M.decor.push({ kind: "chair", x: x, z: -1.45, y: 0, yaw: Math.PI / 2 }, { kind: "chair", x: x, z: 1.45, y: 0, yaw: -Math.PI / 2 });
  });
  M.decor.push({ kind: "tv", x: 12.65, z: 0, y: 1.6 });

  // Stairs up to the sun deck: two aft (port + starboard), one forward starboard.
  stairs(-19, -13, 2.6, 4.6, DECK, ROOF, DECK, 12);
  stairs(-19, -13, -4.6, -2.6, DECK, ROOF, DECK, 12);
  stairs(19, 13, 2.6, 4.6, DECK, ROOF, DECK, 12);
  M.decor.push(
    { kind: "handrail", x0: -19, x1: -13, z: 4.65, y0: DECK, y1: ROOF },
    { kind: "handrail", x0: -19, x1: -13, z: -4.65, y0: DECK, y1: ROOF },
    { kind: "handrail", x0: 19, x1: 13, z: 4.65, y0: DECK, y1: ROOF }
  );

  // Side-walkway deck lockers (cover).
  box(-2, -0.5, DECK, 1.0, 7.9, 8.8, "paint", { top: "teak" });
  box(7, 8.5, DECK, 1.0, -8.8, -7.9, "paint", { top: "teak" });
  M.decor.push({ kind: "lifering", x: -9, z: 8.86, y: 0.75, yaw: 0 }, { kind: "lifering", x: 11, z: -8.86, y: 0.75, yaw: Math.PI });

  // ---------------------------------------------------------------- sun deck (roof)
  const RE = 5.55;
  rail(-13.25, -RE, -13.25, -4.6, ROOF); rail(-13.25, -2.6, -13.25, 2.6, ROOF); rail(-13.25, 4.6, -13.25, RE, ROOF);
  rail(13.25, -RE, 13.25, 2.6, ROOF); rail(13.25, 4.6, 13.25, RE, ROOF);
  rail(-13.25, RE, 13.25, RE, ROOF); rail(-13.25, -RE, 13.25, -RE, ROOF);
  // Hot tub: a 0.6 m lip you hop over, shallow water inside.
  box(-8, -4, ROOF, 3.9, -2, -1.7, "tile", { surf: "tile" });
  box(-8, -4, ROOF, 3.9, 1.7, 2, "tile", { surf: "tile" });
  box(-8, -7.7, ROOF, 3.9, -1.7, 1.7, "tile", { surf: "tile" });
  box(-4.3, -4, ROOF, 3.9, -1.7, 1.7, "tile", { surf: "tile" });
  M.water.push({ x0: -7.7, x1: -4.3, z0: -1.7, z1: 1.7, y: 3.78, kind: "tub" });
  // Loungers and a bar table on the sun deck.
  box(-1, 1, ROOF, 3.8, 3.2, 4.5, "cushion", { surf: "soft" });
  box(-1, 1, ROOF, 3.8, -4.5, -3.2, "cushion", { surf: "soft" });
  box(-11.5, -10.5, ROOF, 4.35, -0.5, 0.5, "darkwood", { top: "marble", surf: "wood" });
  // Wheelhouse with a stern door and a starboard door.
  function whWall(axis, at, from, to, gaps) {
    const t = 0.125, cuts = [from];
    gaps.forEach(function (g) { cuts.push(g[0], g[1]); });
    cuts.push(to);
    function piece(a, b, y0, y1, mat, opt) {
      if (b - a < 0.01) return;
      if (axis === "x") box(a, b, y0, y1, at - t, at + t, mat, opt);
      else box(at - t, at + t, y0, y1, a, b, mat, opt);
    }
    for (let i = 0; i < cuts.length; i += 2) {
      piece(cuts[i], cuts[i + 1], ROOF, 4.2, "paint");
      piece(cuts[i], cuts[i + 1], 4.2, 5.6, "tint", { surf: "glass" });
      piece(cuts[i], cuts[i + 1], 5.6, 6.0, "paint");
    }
    gaps.forEach(function (g) { piece(g[0], g[1], 5.6, 6.0, "paint"); });
  }
  whWall("z", 4.125, -3.5, 3.5, [[-0.8, 0.8]]);
  whWall("z", 10.875, -3.5, 3.5, []);
  whWall("x", 3.375, 4, 11, [[6, 7.4]]);
  whWall("x", -3.375, 4, 11, []);
  box(3.8, 11.3, 6.0, 6.3, -3.75, 3.75, "paint", { bottom: "ceiling" });
  box(9.4, 10.6, ROOF, 4.3, -2, 2, "darkpanel");
  M.decor.push({ kind: "helm", x: 9.3, z: 0, y: 4.3 }, { kind: "captainchair", x: 8.2, z: 0, y: ROOF }, { kind: "mast", x: 7.5, z: 0, y: 6.3 });

  // ---------------------------------------------------------------- foredeck
  box(25, 30.5, DECK, 1.7, 3.6, 6.6, "paint", { vis: false });                  // tender on chocks
  M.decor.push({ kind: "tender", x0: 25, x1: 30.5, z0: 3.6, z1: 6.6, y: DECK });
  box(30, 33.5, DECK, 0.55, -1.6, 1.6, "cushion", { surf: "soft" });            // sun pad
  box(35.4, 36.4, DECK, 0.7, -1.6, -0.6, "steel");                             // anchor windlasses
  box(35.4, 36.4, DECK, 0.7, 0.6, 1.6, "steel");
  box(23.2, 24.6, DECK, 1.2, -6, -4.6, "crate", { surf: "wood" });              // cargo
  box(24.6, 25.8, DECK, 1.2, -6.2, -5, "crate", { surf: "wood" });
  box(23.4, 24.4, 1.2, 2.2, -5.8, -4.8, "crate", { surf: "wood" });
  box(27.5, 28.7, DECK, 1.2, -3.6, -2.4, "crate", { surf: "wood" });
  box(31.5, 32.3, DECK, 1.0, -6.4, -5.6, "steel", { top: "paint" });            // vent
  M.decor.push({ kind: "bowlight", x: 39.2, z: 0, y: 1.2 });

  // ---------------------------------------------------------------- yacht details (decor)
  M.decor.push(
    { kind: "sternname", x: -36.14, y: -1.55, z: 0 },                              // name on the transom
    { kind: "ensign", x: -35.7, z: -6.3, y: DECK },                                // Navy flag at the stern
    { kind: "navlight", x: 4.45, y: 5.0, z: -3.56, c: "redlight" },                // port = red
    { kind: "navlight", x: 4.45, y: 5.0, z: 3.56, c: "green" },                    // starboard = green
    { kind: "dome", x: 10.2, y: 6.3, z: -2.0, r: 0.45 },                          // radar / satcom domes
    { kind: "dome", x: 10.2, y: 6.3, z: 2.0, r: 0.32 },
    { kind: "lifering", x: -36.02, z: 5.6, y: 0.75, yaw: 0 },
    { kind: "lifering", x: -36.02, z: -4.6, y: 0.75, yaw: 0 }
  );

  // ---------------------------------------------------------------- pirate boarding boat
  // The Pirates' assault boat, lashed to the port side midships: a low outside
  // lane (deck 1.2 m below the yacht's) reached by two stepped boarding ramps,
  // with a centre cabin, drums and crates for cover. Knee-high sides: jump them
  // and you're in the sea.
  const BOAT = -1.2, BZ0 = -9.3, BZ1 = -15.2, BX0 = -13, BX1 = 9.5, BNOSE = 4;
  M.BOAT = { y: BOAT, x0: BX0, x1: BX1, z0: BZ0, z1: BZ1, nose: BNOSE };
  // Boat half-beam around its centre line, tapering to the bow.
  const BMID = (BZ0 + BZ1) / 2, BHW = (BZ0 - BZ1) / 2;
  M.boatHalf = function (x) {
    if (x <= BNOSE) return BHW;
    const u = Math.min(1, (x - BNOSE) / (BX1 - BNOSE));
    return Math.max(0.05, BHW * Math.sqrt(1 - u * u));
  };
  M.boatOutline = function (inset) {
    inset = inset || 0;
    const pts = [[BX0 + inset, BMID - BHW + inset]];
    for (let x = BNOSE; x < BX1; x += 0.5) pts.push([x, BMID - Math.max(0.05, M.boatHalf(x) - inset)]);
    pts.push([BX1 - inset * 2, BMID]);
    for (let x = BX1 - 0.5; x >= BNOSE; x -= 0.5) pts.push([x, BMID + Math.max(0.05, M.boatHalf(x) - inset)]);
    pts.push([BX0 + inset, BMID + BHW - inset]);
    return pts;
  };
  // Deck slabs (the visible deck is an extruded shape built by the view).
  box(BX0, BNOSE, BOAT - 0.3, BOAT, BZ1, BZ0, "boatdeck", { vis: false });
  for (let x = BNOSE; x < BX1; x += 0.5) {
    const w = M.boatHalf(x);
    box(x, x + 0.5, BOAT - 0.3, BOAT, BMID - w, BMID + w, "boatdeck", { vis: false });
  }
  // Knee-high gunwale round the outside, the stern and the bow (the yacht side is open).
  box(BX0, BNOSE, BOAT, BOAT + 0.5, BZ1, BZ1 + 0.18, "pirate");
  box(BX0, BX0 + 0.18, BOAT, BOAT + 0.5, BZ1, BZ0, "pirate");
  for (let x = BNOSE; x < BX1; x += 0.5) {
    const wa = M.boatHalf(x) - 0.09, wb = M.boatHalf(Math.min(BX1, x + 0.5)) - 0.09;
    seg(x, BMID - wa, x + 0.5, BMID - Math.max(0.05, wb), BOAT, BOAT + 0.5, 0.18, "pirate");
    seg(x, BMID + wa, x + 0.5, BMID + Math.max(0.05, wb), BOAT, BOAT + 0.5, 0.18, "pirate");
  }
  // Boarding ramps: five steps from the yacht's walkway down to the boat deck.
  RAMPS.forEach(function (rx) {
    const n = 5, rise = (DECK - BOAT) / n, run = 0.42;
    for (let i = 1; i < n; i++) {
      const z0 = -8.95 - run * i, z1 = z0 + run;
      box(rx - RAMP_W / 2, rx + RAMP_W / 2, BOAT - 0.3, DECK - rise * i, z0, z1, "teak", { side: "pirate", surf: "wood", stair: true });
    }
    M.decor.push({ kind: "ramprail", x: rx, w: RAMP_W, z0: -8.95, z1: -8.95 - run * (n - 1), y0: DECK, y1: BOAT + rise });
  });
  // Centre cabin with a raked windshield and a hardtop (full cover).
  box(-3.2, 0.8, BOAT, BOAT + 1.25, -14.0, -11.0, "pirate", { top: "boatdeck" });
  box(-3.2, 0.8, BOAT + 1.25, BOAT + 1.85, -14.0, -11.0, "tint", { surf: "glass" });
  box(-3.5, 1.1, BOAT + 1.85, BOAT + 2.0, -14.2, -10.8, "pirate", { top: "boatdeck" });
  M.decor.push({ kind: "boatflag", x: BX0 + 0.6, z: BZ1 + 0.6, y: BOAT + 0.5 });
  M.decor.push({ kind: "outboards", x: BX0, z: BMID, y: BOAT });
  // Cover: fuel drums aft, ammo crates forward, a cleat-and-line bollard pair.
  [[-11.2, -14.3], [-10.4, -14.4], [-11.0, -13.5]].forEach(function (d) {
    box(d[0] - 0.32, d[0] + 0.32, BOAT, BOAT + 0.95, d[1] - 0.32, d[1] + 0.32, "drum", { vis: false });
    M.decor.push({ kind: "drum", x: d[0], z: d[1], y: BOAT });
  });
  box(3.4, 4.6, BOAT, BOAT + 0.9, -14.6, -13.4, "crate", { surf: "wood" });
  box(5.6, 6.6, BOAT, BOAT + 0.8, -12.6, -11.6, "crate", { surf: "wood" });
  box(-7.2, -6.2, BOAT, BOAT + 0.75, -14.6, -13.6, "crate", { surf: "wood" });
  // The yacht's hull side is solid from the boat (no squeezing between hulls).
  box(BX0, BX1, BOAT - 0.3, -0.3, -9.1, -9.0, "hull", { vis: false });
  // Fenders between the hulls and the mooring lines (decor).
  [-11, -6, -1, 3, 7].forEach(function (x) { M.decor.push({ kind: "fender", x: x, z: -9.15, y: -1.5 }); });
  [[-12.2, -15], [8.2, -15]].forEach(function (l) { M.decor.push({ kind: "mooring", x: l[0], z: BZ0 - 0.3, y: BOAT + 0.3, tx: l[0] + (l[0] < 0 ? -1.8 : 1.8), tz: -8.92, ty: DECK + 1.0 }); });

  // ---------------------------------------------------------------- spawns
  // team 0 spawns aft facing the bow, team 1 forward facing the stern.
  const A = [[-33.2, -4.8], [-33.2, 4.8], [-29, -4.6], [-29, 4.6], [-24.5, -4], [-24.5, 4], [-24.2, 0], [-35, 7]];
  const B = [[36.5, -3.2], [36.5, 3.2], [33.5, -4.3], [33.5, 4.3], [29, -1.2], [24, -2.6], [24, 2.6], [29.5, 1.5]];
  A.forEach(function (p) { M.spawns.push({ x: p[0], y: DECK, z: p[1], yaw: 0, side: 0 }); });
  B.forEach(function (p) { M.spawns.push({ x: p[0], y: DECK, z: p[1], yaw: Math.PI, side: 1 }); });
  const MID = [
    [-8, LOW, 0, 0], [6, LOW, 3, Math.PI], [-16, LOW, -4.5, 0], [16, LOW, 4.5, Math.PI],
    [-5, DECK, 3, 0], [5, DECK, -3, Math.PI], [-10, ROOF, -3.5, 0], [2.5, ROOF, 0, Math.PI],
    [0, DECK, 7, 0], [10, DECK, -7, Math.PI], [-16, DECK, 6.5, 0], [16, DECK, -6.5, Math.PI],
    [-8, BOAT, -12.5, 0], [4.5, BOAT, -12.8, Math.PI]
  ];
  MID.forEach(function (p) { M.spawns.push({ x: p[0], y: p[1], z: p[2], yaw: p[3], side: -1 }); });
  // Places bots like to patrol through.
  M.hotspots = M.spawns.map(function (s) { return { x: s.x, y: s.y, z: s.z }; }).concat([
    { x: 7.5, y: ROOF, z: 0 }, { x: -6, y: ROOF, z: 0 }, { x: 0, y: DECK, z: -7.8 }, { x: -18, y: DECK, z: 0 },
    { x: 18, y: DECK, z: -3 }, { x: 0, y: LOW, z: 0 }, { x: 10, y: LOW, z: -4 }, { x: 0, y: DECK, z: 2.5 },
    { x: 27, y: DECK, z: 0 }, { x: -29, y: DECK, z: 0 },
    { x: -9, y: BOAT, z: -12.5 }, { x: 2.5, y: BOAT, z: -12.4 }, { x: 6.5, y: BOAT, z: -13.2 }, { x: -5, y: DECK, z: -8.2 },
    { x: -11.5, y: BOAT, z: -11 }, { x: -5.5, y: BOAT, z: -14.5 }, { x: -1, y: BOAT, z: -10.2 }, { x: 3.5, y: BOAT, z: -14.6 },
    { x: 8, y: DECK, z: -8.2 }, { x: -9, y: DECK, z: -7.6 }
  ]);

  HK.MAP = M;
})(globalThis.HK);
