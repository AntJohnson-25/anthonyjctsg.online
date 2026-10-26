// Wrong Door: the whole game as pure logic (no three.js), so Node can play it too
// (tools/sim-test.js). A timed delivery shift through a big apartment complex.
//
// World: x east-west, z north-south, y up. Yaw 0 looks along -z (like a three.js camera).
// The complex is three ROWS of three buildings (A-I, 12 units each = 108 doors), a breezeway with a deck and
// centre stairs between neighbours, an end stair at each row's two outer ends:
//   front row  (A B C)  doors face SOUTH onto the front lawn, the hedge and the lot where the van is
//   middle row (D E F)  doors face NORTH onto the courtyard; its back faces the alley behind the front row
//   north row  (G H I)  doors face SOUTH onto the same courtyard; its back faces the back lane
// Each building has 6 units downstairs and 6 upstairs; downstairs count away from the building's stair end
// toward the breezeway, upstairs count back (7 sits over 6, 12 over 1). That floor mix-up is the one that gets
// real drivers.
globalThis.WD = globalThis.WD || {};
(function (WD) {
  "use strict";

  const CFG = WD.CFG = {
    R: 0.34, H: 1.75, STEP: 0.45, GRAV: 22,
    RUN: 4.8, SPRINT: 7.2, LOAD_SLOW: 0.035, WET: 0.55, ACC: 16,
    STAM_USE: 0.24, STAM_GAIN: 0.22, STAM_DELAY: 0.8,
    CAM_DIST: 3.6, CAM_SIDE: 0.6, CAM_UP: 0.35, EYE: 1.6,
    DOOR_R: 1.7, VAN_R: 1.8,
    WRONG_T: 8, PTS: 100, COMBO_PTS: 25, TIME_PTS: 10, VAL_MULT: 2, KEEP_PEN: 150,
    SCAN_T: 5, STAGGER_T: 1.0, DOG_R: 1.0, DOG_CD: 3, PIRATE_R: 1.0, PIRATE_CD: 15,
    // what a wrong door can set off
    ANGRY_SPEED: 3.9, ANGRY_T: 6, ANGRY_HIT_T: 3, DOGC_SPEED: 5.6, DOGC_T: 7, DOGC_HIT_T: 4, CHASE_R: 0.95, MAX_CHASERS: 4,
    FLOOR: 3.2, COUNTDOWN: 3,
    BOUNDS: { x0: -60, x1: 60, z0: -68, z1: 36 },
    UNIT_W: 4.5
  };

  // Each shift opens more of the complex (bldgs = how many buildings, A first), adds packages, a bigger stack, a twist.
  // keep / dogs / angry: the odds that a wrong door keeps a valuable parcel / lets a dog out / sends someone out angry.
  WD.SHIFTS = [
    { id: 1, name: "First Day", blurb: "Building A only. Downstairs is 1 to 6, upstairs is 7 to 12. A wrong door costs time and sometimes a lot more.", packages: 6, carry: 3, time: 150, par: 60, bldgs: 1, scans: 3, val: 1, keep: 0.5, dogs: 0.1, angry: 0.3 },
    { id: 2, name: "Lunch Rush", blurb: "The whole front row, A to C. Mind the gold-edged parcels: nobody hands those back.", packages: 9, carry: 4, time: 200, par: 55, bldgs: 3, scans: 3, wet: true, val: 2, keep: 0.6, dogs: 0.15, angry: 0.35 },
    { id: 3, name: "Gate's Locked", blurb: "Maintenance locked the front breezeways. Buildings A to F: find another way through.", packages: 11, carry: 5, time: 300, par: 55, bldgs: 6, scans: 3, gate: true, val: 2, keep: 0.6, dogs: 0.2, angry: 0.35 },
    { id: 4, name: "Dog Day", blurb: "All nine buildings, and the loose dog is on the front lawn. Not every dog is on a leash.", packages: 13, carry: 6, time: 330, par: 55, bldgs: 9, scans: 3, wet: true, dog: "front", val: 3, keep: 0.65, dogs: 0.3, angry: 0.3 },
    { id: 5, name: "Night Shift", blurb: "Half the porch lights are out, and the alley dog is loose.", packages: 14, carry: 6, time: 350, par: 50, bldgs: 9, scans: 4, night: true, dog: "back", val: 3, keep: 0.65, dogs: 0.3, angry: 0.35 },
    { id: 6, name: "Porch Pirate", blurb: "Someone's lifting packages. Don't let them grab yours.", packages: 16, carry: 7, time: 440, par: 50, bldgs: 9, scans: 4, wet: true, gate: true, pirate: true, val: 4, keep: 0.7, dogs: 0.3, angry: 0.4 }
  ];

  const INIT = "ABCDEFGHJKLMNPRSTVWYZ", SUR = ["Okafor", "Reyes", "Nguyen", "Brooks", "Patel", "Lewis", "Ramirez", "Kim", "Johnson", "Moreau", "Walker", "Diaz", "Chen", "Haddad",
    "Ortiz", "Sato", "Ivanova", "Mensah", "Romero", "Tanaka", "Grant", "Ali", "Rossi", "Bell", "Novak", "Duarte", "Singh", "Larsen", "Boateng", "Cruz", "Fischer", "Owens"];
  const nameOf = (u) => INIT[(u * 7) % INIT.length] + ". " + SUR[(u * 5 + 3) % SUR.length];

  function rngFrom(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  WD.rngFrom = rngFrom;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

  // ------------------------------------------------------------------ the complex
  const ROWS = [{ k: "f", oz: 0, nz: 1 }, { k: "m", oz: -30, nz: -1 }, { k: "n", oz: -52, nz: 1 }];
  const WX = [-46.5, -13.5, 19.5], WLEN = 27, BZC = [-16.5, 16.5], GAPS = [-40, -16.5, 16.5, 40], YARD = 57.3, LETTERS = "ABCDEFGHI";

  // surfaces: where feet can stand (flat rects, and ramps for the stairs); the whole site is ground at y 0.
  // solids: boxes that block bodies and the camera (buildings, rails, stairwell walls, hedges, cars).
  // nodes/edges: a walking graph the bot, the chasers and the route plan use.
  function buildLevel(shift) {
    const L = { surfaces: [], solids: [], doors: [], nodes: {}, edges: [], wet: [], props: [], signs: [], letters: [], walks: [], asphalt: [], wings: [], breezes: [], gates: [], shift: shift };
    const F = CFG.FLOOR, UW = CFG.UNIT_W, B = CFG.BOUNDS;
    const solid = (x0, x1, z0, z1, y0, y1, kind) => { const s = { x0, x1, z0, z1, y0, y1, kind: kind || "wall" }; L.solids.push(s); return s; };
    const flat = (x0, x1, z0, z1, y, kind) => L.surfaces.push({ x0, x1, z0, z1, y, kind: kind || "floor" });
    const N = L.nodes;
    const node = (id, x, y, z) => { N[id] = { id, x, y, z }; return id; };
    const edge = (a, b) => L.edges.push([a, b]);
    const yardNodes = { "-": [], "+": [] }, alley = [], lane = [], lineExtras = {};

    ROWS.forEach(function (R, ri) {
      const Z = (lz) => R.oz + R.nz * lz;
      const zr = (a, b) => [Math.min(Z(a), Z(b)), Math.max(Z(a), Z(b))];
      const box = (x0, x1, a, b, y0, y1, kind) => { const z = zr(a, b); return solid(x0, x1, z[0], z[1], y0, y1, kind); };
      const fl = (x0, x1, a, b, y, kind) => { const z = zr(a, b); flat(x0, x1, z[0], z[1], y, kind); };
      const walk = (x0, x1, a, b) => { const z = zr(a, b); L.walks.push([x0, x1, z[0], z[1]]); };
      const k = R.k;
      const line = [], up = [];   // ground door-front nodes along the lawn line; the upstairs chain
      const centers = BZC;

      WX.forEach(function (x0, wi) {
        const x1 = x0 + WLEN, bi = ri * 3 + wi, mir = wi === 2, letter = LETTERS[bi];
        const b = box(x0, x1, -10, 0, 0, 6.8, "building"); b.wing = letter; b.bi = bi; b.nz = R.nz; b.row = ri; b.mir = mir;
        L.wings.push({ bi: bi, letter: letter, row: ri, nz: R.nz, x0: x0, x1: x1, z0: b.z0, z1: b.z1, first: bi * 12 + 1, mir: mir });
        fl(x0, x1, 0, 2, F, "balcony");
        box(x0, x1, 0, 2, F - 0.2, F, "slab");
        box(x0, x1, 1.95, 2.1, F, F + 1.05, "rail");
        // the posts holding up the balcony (and the roof over it), one at every unit line
        for (let j = 0; j <= 6; j++) box(x0 + UW * j - 0.1, x0 + UW * j + 0.1, 1.93, 2.13, 0, F + 1.05, "post");
        // AC condensers along the back wall
        [4, 13, 22].forEach((o) => box(x0 + o - 0.45, x0 + o + 0.45, -10.85, -10.05, 0, 0.9, "ac"));
        // doors: downstairs count toward the breezeway, upstairs count back
        for (let n = 1; n <= 12; n++) {
          const upper = n > 6, i = upper ? 12 - n : n - 1;
          const dx = mir ? x1 - UW * i - 1.2 : x0 + UW * i + 1.2, unit = bi * 12 + n;
          L.doors.push({ unit: unit, bldg: bi, wing: letter, row: ri, dir: mir ? -1 : 1, up: upper, x: dx, y: upper ? F : 0, z: Z(0), nz: R.nz, sx: dx, sz: Z(0.9) });
          const dn = node("d" + unit, dx, upper ? F : 0, Z(0.9));
          if (upper) up.push({ id: dn, x: dx });
          else { const q = node("q" + unit, dx, 0, Z(4.5)); edge(dn, q); line.push({ id: q, x: dx }); walk(dx - 0.7, dx + 0.7, 2.2, 4.8); }
        }
        // the end stairs (the row's two outer buildings): a ramp running out past the end, walled both sides, closed at the top
        if (wi === 0 || wi === 2) {
          const west = wi === 0, a = west ? x0 : x1, bb = west ? x0 - 8 : x1 + 8, z = zr(0, 2);
          L.surfaces.push({ x0: Math.min(a, bb), x1: Math.max(a, bb), z0: z[0], z1: z[1], ramp: true, axis: "x", a: a, ya: F, b: bb, yb: 0, kind: "stairs" });
          box(Math.min(a, bb), Math.max(a, bb), -0.15, 0, 0, F + 1.2, "stairwall");
          box(Math.min(a, bb), Math.max(a, bb), 2, 2.15, 0, F + 1.2, "stairwall");
          box(west ? a - 0.15 : a, west ? a : a + 0.15, 0, 2, 0, F - 0.2, "stairwall");
          const top = node(k + "t" + (west ? "w" : "e"), a + (west ? 0.4 : -0.4), F, Z(1)), base = node(k + "b" + (west ? "w" : "e"), west ? x0 - 9 : x1 + 9, 0, Z(1));
          up.push({ id: top, x: a + (west ? 0.4 : -0.4) }); edge(top, base);
          const yn = node(k + "y" + (west ? "-" : "+"), west ? -YARD : YARD, 0, Z(1)); edge(base, yn); yardNodes[west ? "-" : "+"].push({ id: yn, z: Z(1) });
          walk(west ? x0 - 11.2 : x1 + 8, west ? x0 - 8 : x1 + 11.2, -1, 3);
        }
        walk(x0, x1, 0, 2.3);
        // signs and letters
        const sx = [-27, 6, 30][wi], sz = Z(7.2);
        L.signs.push({ text: "BLDG " + letter + "  " + (bi * 12 + 1) + "-" + (bi * 12 + 12), x: sx, y: 1.6, z: sz, ry: R.nz > 0 ? 0 : Math.PI });
        L.letters.push({ ch: letter, bi: bi, x: x0 - 0.02, y: 5.0, z: Z(-5), ry: -Math.PI / 2 }, { ch: letter, bi: bi, x: x1 + 0.02, y: 5.0, z: Z(-5), ry: Math.PI / 2 },
          { ch: letter, bi: bi, x: (x0 + x1) / 2, y: 4.6, z: Z(-10) - R.nz * 0.02, ry: R.nz > 0 ? Math.PI : 0 });
        // walkway landmarks (drawn, not solid)
        const rr = rngFrom(bi * 31 + 7);
        L.props.push({ kind: "plant", x: x0 + 0.5 + 4.5 * Math.floor(rr() * 6) + 3.4, y: F, z: Z(1.6) });
        if (rr() < 0.6) L.props.push({ kind: "plant", x: x0 + 0.5 + 4.5 * Math.floor(rr() * 6) + 3.4, y: 0, z: Z(1.7) });
        if (rr() < 0.4) L.props.push({ kind: rr() < 0.5 ? "bikes" : "grill", x: x0 + 3.2 + 4.5 * Math.floor(rr() * 5), y: 0, z: Z(1.5) });
        if (rr() < 0.35) L.props.push({ kind: "chair", x: x0 + 3.4 + 4.5 * Math.floor(rr() * 5), y: F, z: Z(1.5) });
      });

      // the breezeways: a ground passage under a deck joining both upstairs walkways, centre stairs out the door side
      centers.forEach(function (xc, ci) {
        const gated = shift.gate && ri === 0;
        fl(xc - 3, xc + 3, -10, 2, F, "deck");
        box(xc - 3, xc + 3, -10, 2, F - 0.2, F, "slab");
        box(xc - 3, xc + 3, -10, 0, 6.4, 6.8, "roof");
        box(xc - 3, xc - 1.1, 1.95, 2.1, F, F + 1.05, "rail"); box(xc + 1.1, xc + 3, 1.95, 2.1, F, F + 1.05, "rail");
        box(xc - 3, xc + 3, -10.1, -9.95, F, F + 1.05, "rail");
        const za = Z(2), zb = Z(7.5);
        L.surfaces.push({ x0: xc - 1.1, x1: xc + 1.1, z0: Math.min(za, zb), z1: Math.max(za, zb), ramp: true, axis: "z", a: za, ya: F, b: zb, yb: 0, kind: "stairs" });
        box(xc - 1.25, xc - 1.1, 2, 7.5, 0, F + 1.2, "stairwall"); box(xc + 1.1, xc + 1.25, 2, 7.5, 0, F + 1.2, "stairwall");
        box(xc - 1.1, xc + 1.1, 2, 2.15, 0, F - 0.2, "stairwall");
        const zg = zr(-5.1, -4.9);
        if (gated) L.gates.push(solid(xc - 3, xc + 3, zg[0], zg[1], 0, 2.4, "gate"));
        L.breezes.push({ row: ri, cx: xc, x0: xc - 3, x1: xc + 3, nz: R.nz, oz: R.oz, gated: gated });
        walk(xc - 3, xc + 3, -10.3, 2.3);
        // graph: stair top on the deck, stair foot, the detour round the stair, the ground passage
        const st = node(k + "st" + ci, xc, F, Z(1.2)), sb = node(k + "sb" + ci, xc, 0, Z(8.3));
        up.push({ id: st, x: xc }); edge(sb, st);
        const Ln = node(k + "L" + ci, xc - 2.5, 0, Z(8.3)), Rn = node(k + "R" + ci, xc + 2.5, 0, Z(8.3));
        edge(Ln, sb); edge(sb, Rn);
        const pf = node(k + "pf" + ci, xc + 2, 0, Z(1)), pb = node(k + "pb" + ci, xc + 2, 0, Z(-11));
        edge(pf, Rn); if (!gated) edge(pf, pb);
        walk(xc - 3.2, xc + 3.2, 7.6, 9.0); walk(xc - 3.2, xc - 1.8, 4.5, 9.0); walk(xc + 1.8, xc + 3.2, 4.5, 9.0);
        if (ri === 0) walk(xc - 1.3, xc + 1.3, 8.9, 13.5);
        if (ri === 2) { const ln = node("ln" + ci + k, xc + 2, 0, -65); edge(pb, ln); lane.push({ id: ln, x: xc + 2 }); }
        else { const al = "al" + ci; if (!N[al]) { node(al, xc + 2, 0, -15); alley.push({ id: al, x: xc + 2 }); } edge(pb, al); }
      });

      // the lawn line along the door-fronts, with detours round the stairs
      const extras = ri === 0 ? [-40, 40] : [-34, 34];
      extras.forEach((x) => { const id = node(k + "x" + x, x, 0, Z(4.5)); line.push({ id: id, x: x }); lineExtras[k + x] = id; });
      [-1, 1].forEach((sg) => { const id = node(k + "y" + (sg < 0 ? "-" : "+") + "l", sg * YARD, 0, Z(4.5)); line.push({ id: id, x: sg * YARD }); yardNodes[sg < 0 ? "-" : "+"].push({ id: id, z: Z(4.5) }); });
      line.sort((p, q) => p.x - q.x);
      for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i], b = line[i + 1], ci = centers.findIndex((xc) => a.x < xc - 1.5 && b.x > xc + 1.5);
        if (ci >= 0) { edge(a.id, k + "L" + ci); edge(k + "R" + ci, b.id); } else edge(a.id, b.id);
      }
      walk(-YARD - 0.7, YARD + 0.7, 3.8, 5.2);
      // the upstairs chain along every walkway and over the decks
      up.sort((p, q) => p.x - q.x);
      for (let i = 0; i + 1 < up.length; i++) edge(up[i].id, up[i + 1].id);
    });

    // ---- the rest of the graph: yards, alley, back lane, the lot
    ["-", "+"].forEach((sg) => { const l = yardNodes[sg]; const x = sg === "-" ? -YARD : YARD;
      const al = node("ya" + sg, x, 0, -15); alley.push({ id: al, x: x }); l.push({ id: al, z: -15 });
      const ln = node("yl" + sg, x, 0, -65); lane.push({ id: ln, x: x }); l.push({ id: ln, z: -65 });
      l.sort((p, q) => p.z - q.z);
      for (let i = 0; i + 1 < l.length; i++) edge(l[i].id, l[i + 1].id);
      L.walks.push([x - 1, x + 1, -66, 5.5]);
    });
    alley.sort((p, q) => p.x - q.x); for (let i = 0; i + 1 < alley.length; i++) edge(alley[i].id, alley[i + 1].id);
    lane.sort((p, q) => p.x - q.x); for (let i = 0; i + 1 < lane.length; i++) edge(lane[i].id, lane[i + 1].id);
    // across the courtyard
    [-34, 34].forEach((x) => { edge("m" + "x" + x, "n" + "x" + x); L.walks.push([x - 1, x + 1, -48.2, -33.8]); });
    // the lot: the van, the gaps in the hedge, the way to the lawn
    node("van", 6, 0, 17.6);
    GAPS.forEach((x) => {
      node("g" + x, x, 0, 16.2); node("h" + x, x, 0, 13.1); edge("g" + x, "h" + x); edge("van", "g" + x);
      if (Math.abs(x) === 40) { edge("h" + x, "fx" + x); L.walks.push([x - 1.3, x + 1.3, 4.5, 13.5]); }
      else edge("h" + x, "fsb" + (x < 0 ? 0 : 1));
    });

    // ---- the lot, the alley, the lane: hedge, cars, bins, mailboxes, lights
    const hedgeSegs = [[-60, -42], [-38, -18.5], [-14.5, 14.5], [18.5, 38], [42, 60]];
    hedgeSegs.forEach((s) => solid(s[0], s[1], 12.8, 13.4, 0, 1.1, "hedge"));
    L.asphalt.push([B.x0, B.x1, 13.4, B.z1], [B.x0, B.x1, -20, -10], [B.x0, B.x1, B.z0, -62]);
    L.van = solid(3.2, 8.8, 19, 21.6, 0, 2.7, "van");
    [-54, -48, -42, -36, -30, -24, -12, -6, 14, 20, 26, 32, 38, 44, 50].forEach((x, i) => solid(x - 1, x + 1, 27, 31.4, 0, 1.5, "car").col = i);
    solid(-2.2, -0.8, 20.2, 21.6, 0, 1.5, "mailbox");
    [[-30, -27], [3, 6], [36, 39]].forEach((s) => solid(s[0], s[1], -19.6, -17.8, 0, 1.6, "dumpster"));
    [[-36, -33], [24, 27]].forEach((s) => solid(s[0], s[1], -64.2, -62.4, 0, 1.6, "dumpster"));
    // trees: round the edge, on the front lawn and down the courtyard (landmarks, kept off the walking lines). Only the trunk is solid.
    const trnd = rngFrom(42);
    L.trees = [];
    const kindOf = () => { const r = trnd(); return r < 0.4 ? "oak" : r < 0.7 ? "pine" : "palm"; };
    for (let x = B.x0 + 3; x < B.x1; x += 7.5) { L.trees.push([x + trnd() * 2, B.z1 - 2.5, 0.8 + trnd() * 0.5, kindOf()]); L.trees.push([x + trnd() * 2, B.z0 + 1.2, 0.8 + trnd() * 0.5, kindOf()]); }
    for (let z = B.z0 + 4; z < B.z1; z += 8) { L.trees.push([B.x0 + 0.9, z + trnd() * 2, 0.8 + trnd() * 0.5, kindOf()]); L.trees.push([B.x1 - 0.9, z + trnd() * 2, 0.8 + trnd() * 0.5, kindOf()]); }
    [-52, -33, -9, 12, 23, 50].forEach((x) => L.trees.push([x, 9.8 + trnd() * 0.5, 0.9 + trnd() * 0.3, "oak"]));
    [-48, -26, -8, 8, 26, 48].forEach((x) => L.trees.push([x, -41, 1 + trnd() * 0.3, "oak"]));
    L.trees.forEach((t) => solid(t[0] - 0.25, t[0] + 0.25, t[1] - 0.25, t[1] + 0.25, 0, 3, "tree"));
    [-52, -30, 30, 52].forEach((x) => L.props.push({ kind: "lamp", x: x, y: 0, z: 11.8 }));
    [-36, 0, 36].forEach((x) => L.props.push({ kind: "lamp", x: x, y: 0, z: -41 }));
    [-45, -5, 40].forEach((x) => L.props.push({ kind: "lamp", x: x, y: 0, z: -12.5 }));
    [-45, -5, 40].forEach((x) => L.props.push({ kind: "lamp", x: x, y: 0, z: -17.5 }));
    // the courtyard: benches, a grill spot, bins
    [[-20, -39.5], [20, -39.5], [-20, -42.5], [20, -42.5], [-44, -41], [44, -41]].forEach((p, i) => L.props.push({ kind: "bench", x: p[0], y: 0, z: p[1], ry: p[1] > -41 ? Math.PI : 0 }));
    [[-2, -40], [2, -42], [-38, -39], [38, -43]].forEach((p) => L.props.push({ kind: "bin", x: p[0], y: 0, z: p[1] }));
    L.props.push({ kind: "grill", x: -11, y: 0, z: -43.5 }, { kind: "grill", x: 12, y: 0, z: -38.5 });
    // wet floors: a patch on a ground walkway, one in a breezeway, one on an upper walkway
    if (shift.wet) L.wet.push({ x0: -8, x1: -3, z0: 0.1, z1: 2.1, y: 0 }, { x0: 13.9, x1: 19.1, z0: -7, z1: -3, y: 0 }, { x0: 5, x1: 11, z0: -32 + 0, z1: -30, y: F });

    L.adj = {};
    for (const id in N) L.adj[id] = [];
    L.edges.forEach((e) => {
      const a = N[e[0]], b = N[e[1]];
      if (!a || !b) throw new Error("graph edge to a missing node: " + e);
      const w = Math.hypot(a.x - b.x, a.z - b.z) + Math.abs(a.y - b.y) * 2;
      L.adj[e[0]].push([e[1], w]); L.adj[e[1]].push([e[0], w]);
    });

    // hazards: the dog's beat, the porch pirate's loop
    if (shift.dog === "front") L.dogPath = [[-48, 0, 6.5], [-24, 0, 6.5], [-24, 0, 10.5], [-48, 0, 10.5]];
    if (shift.dog === "back") L.dogPath = [[-40, 0, -13], [-6, 0, -13], [-6, 0, -17], [-40, 0, -17]];
    if (shift.pirate) L.pirateLoop = [[-YARD, 0, 8.3], [YARD, 0, 8.3], [YARD, 0, -41], [-YARD, 0, -41]];
    return L;
  }
  WD.buildLevel = buildLevel;

  // Height of a surface at (x, z), or null when (x, z) is off it.
  function surfY(s, x, z) {
    if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) return null;
    if (!s.ramp) return s.y;
    const v = s.axis === "x" ? x : z, t = clamp((v - s.a) / (s.b - s.a), 0, 1);
    return s.ya + (s.yb - s.ya) * t;
  }
  // The floor under a body at height y: the highest surface no more than a step above its feet.
  function floorAt(L, x, z, y) {
    let best = 0;
    for (const s of L.surfaces) { const h = surfY(s, x, z); if (h !== null && h <= y + CFG.STEP && h > best) best = h; }
    return best;
  }
  WD.floorAt = floorAt;
  const blocks = (s, feet) => feet < s.y1 - 0.4 && feet + CFG.H > s.y0;
  WD.blocks = blocks;

  // Ray against every solid box (the camera's pull-in, the view's look-at). Returns the distance to the first hit.
  function ray(L, ox, oy, oz, dx, dy, dz, max) {
    let best = max;
    for (const s of L.solids) {
      let t0 = 0, t1 = best, ok = true;
      const o = [ox, oy, oz], d = [dx, dy, dz], lo = [s.x0, s.y0, s.z0], hi = [s.x1, s.y1, s.z1];
      for (let k = 0; k < 3 && ok; k++) {
        if (Math.abs(d[k]) < 1e-9) { if (o[k] < lo[k] || o[k] > hi[k]) ok = false; continue; }
        let a = (lo[k] - o[k]) / d[k], b = (hi[k] - o[k]) / d[k];
        if (a > b) { const t = a; a = b; b = t; }
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        if (t0 > t1) ok = false;
      }
      if (ok && t0 < best) best = t0;
    }
    return best;
  }
  WD.ray = ray;

  function shuffle(a, rnd) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  // ------------------------------------------------------------------ a shift
  // opts: { shift: 1-6, seed, bot: true to let the built-in driver play it (tests, attract mode) }
  WD.createSim = function (opts) {
    opts = opts || {};
    const shift = WD.SHIFTS[clamp((opts.shift || 1) - 1, 0, WD.SHIFTS.length - 1)];
    const rnd = rngFrom(opts.seed != null ? opts.seed : (Math.random() * 1e9) | 0);
    const L = buildLevel(shift);
    const sim = { cfg: CFG, shift: shift, level: L, events: [], time: 0, phase: "countdown", phaseT: CFG.COUNTDOWN,
      clock: shift.time, score: 0, combo: 0, bestCombo: 0, wrong: 0, delivered: 0, lost: 0, scans: shift.scans, scan: null, stars: 0, bonus: 0, chasers: [], plan: null };
    const pool = L.doors.filter((d) => d.bldg < shift.bldgs).map((d) => d.unit);
    const units = shuffle(pool.slice(), rnd).slice(0, shift.packages);
    while (units.length < shift.packages) units.push(pool[Math.floor(rnd() * pool.length)]);
    sim.packages = units.map((u, i) => ({ id: i, unit: u, name: nameOf(u), state: "van", valuable: false }));
    shuffle(sim.packages.map((k) => k.id), rnd).slice(0, shift.val || 0).forEach((id) => { sim.packages[id].valuable = true; });
    sim.doorOf = (u) => L.doors.find((d) => d.unit === u);
    // the driver starts by the van, facing the complex
    const p = sim.player = { x: 6, y: 0, z: 17.6, vx: 0, vz: 0, vy: 0, yaw: 0, pitch: -0.12, stamina: 1, stamT: 0, sprint: false,
      carry: [], cur: 0, stagger: 0, moving: 0, grounded: true, wet: false, act: 0 };
    sim.dog = L.dogPath ? { x: L.dogPath[0][0], y: 0, z: L.dogPath[0][2], seg: 0, cd: 0, yaw: 0, barkT: 0 } : null;
    sim.pirate = L.pirateLoop ? { x: L.pirateLoop[3][0], y: 0, z: L.pirateLoop[3][2], seg: 3, cd: 4, yaw: 0, flee: 0, has: null } : null;

    sim.takeEvents = function () { const e = sim.events; sim.events = []; return e; };
    sim.current = () => (p.carry.length ? sim.packages[p.carry[clamp(p.cur, 0, p.carry.length - 1)]] : null);
    sim.left = () => sim.packages.filter((k) => k.state !== "delivered" && k.state !== "kept").length;
    sim.inVan = () => sim.packages.filter((k) => k.state === "van").length;

    // The door the driver is standing at, if any.
    sim.doorNear = function (q) {
      q = q || p;
      let best = null, bd = CFG.DOOR_R;
      for (const d of L.doors) {
        if (Math.abs(q.y - d.y) > 1.2) continue;
        const dd = Math.hypot(q.x - d.x, q.z - d.z);
        if (dd < bd) { bd = dd; best = d; }
      }
      return best;
    };
    function vanDist(q) {
      const v = L.van, cx = clamp(q.x, v.x0, v.x1), cz = clamp(q.z, v.z0, v.z1);
      return q.y > 1 ? 99 : Math.hypot(q.x - cx, q.z - cz);
    }
    sim.nearVan = () => vanDist(p) < CFG.VAN_R;

    // The over-the-shoulder camera: behind and right of the driver, pulled in when a wall or ceiling is in the way.
    sim.cameraOf = function (q, out) {
      out = out || {};
      const cp = Math.cos(q.pitch), sp = Math.sin(q.pitch);
      const fx = -Math.sin(q.yaw) * cp, fy = sp, fz = -Math.cos(q.yaw) * cp;
      const px = q.x + Math.cos(q.yaw) * CFG.CAM_SIDE, py = q.y + CFG.EYE + CFG.CAM_UP, pz = q.z - Math.sin(q.yaw) * CFG.CAM_SIDE;
      // the shoulder itself can be inside a wall when the driver hugs one: start from the head then
      let sx = px, sz = pz;
      const side = ray(L, q.x, py, q.z, Math.cos(q.yaw), 0, -Math.sin(q.yaw), CFG.CAM_SIDE + 0.25);
      if (side < CFG.CAM_SIDE + 0.25) { const k = Math.max(0, side - 0.25); sx = q.x + Math.cos(q.yaw) * k; sz = q.z - Math.sin(q.yaw) * k; }
      const d0 = CFG.CAM_DIST, hit = ray(L, sx, py, sz, -fx, -fy, -fz, d0);
      const d = hit < d0 ? Math.max(0.35, hit - 0.25) : d0;
      out.x = sx - fx * d; out.y = Math.max(q.y + 0.3, py - fy * d); out.z = sz - fz * d;
      out.fx = fx; out.fy = fy; out.fz = fz; out.dist = d;
      return out;
    };

    // --- movement + collision (the driver, and the chasers use it too)
    function collide(q, feet) {
      const R = CFG.R;
      for (let it = 0; it < 2; it++) {
        for (const s of L.solids) {
          if (q.x < s.x0 - R || q.x > s.x1 + R || q.z < s.z0 - R || q.z > s.z1 + R || !blocks(s, feet)) continue;
          const cx = clamp(q.x, s.x0, s.x1), cz = clamp(q.z, s.z0, s.z1);
          const dx = q.x - cx, dz = q.z - cz, d = Math.hypot(dx, dz);
          if (d >= R) continue;
          if (d > 1e-4) { q.x = cx + dx / d * R; q.z = cz + dz / d * R; }
          else {
            const l = q.x - s.x0, r = s.x1 - q.x, t = q.z - s.z0, b = s.z1 - q.z, mn = Math.min(l, r, t, b);
            if (mn === l) q.x = s.x0 - R; else if (mn === r) q.x = s.x1 + R; else if (mn === t) q.z = s.z0 - R; else q.z = s.z1 + R;
          }
        }
      }
      const B = CFG.BOUNDS;
      q.x = clamp(q.x, B.x0 + R, B.x1 - R); q.z = clamp(q.z, B.z0 + R, B.z1 - R);
    }
    sim.collide = collide;
    function settle(q, dt) {
      const f = floorAt(L, q.x, q.z, q.y);
      if (q.y - f < 0.6 && q.vy <= 0) { q.y = f; q.vy = 0; q.grounded = true; }
      else { q.grounded = false; q.vy -= CFG.GRAV * dt; q.y += q.vy * dt; if (q.y <= f) { q.y = f; q.vy = 0; q.grounded = true; } }
    }
    const onWet = (q) => L.wet.some((w) => q.x > w.x0 && q.x < w.x1 && q.z > w.z0 && q.z < w.z1 && Math.abs(q.y - w.y) < 0.5);

    function move(dt, mx, mz, sprint) {
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      let wx = -sy * mz + cy * mx, wz = -cy * mz - sy * mx;
      const wl = Math.hypot(wx, wz);
      if (wl > 1) { wx /= wl; wz /= wl; }
      const want = wl > 0.05;
      p.sprint = sprint && want && p.stamina > 0.02 && p.stagger <= 0;
      if (p.sprint) { p.stamina = Math.max(0, p.stamina - CFG.STAM_USE * dt); p.stamT = CFG.STAM_DELAY; }
      else if ((p.stamT -= dt) <= 0) p.stamina = Math.min(1, p.stamina + CFG.STAM_GAIN * dt);
      p.wet = onWet(p);
      let top = (p.sprint ? CFG.SPRINT : CFG.RUN) * (1 - CFG.LOAD_SLOW * p.carry.length);
      if (p.wet) top *= CFG.WET;
      if (p.stagger > 0) { p.stagger -= dt; top = 0; }
      const a = Math.min(1, (p.wet ? 4 : CFG.ACC) * dt);
      p.vx += (wx * top - p.vx) * a; p.vz += (wz * top - p.vz) * a;
      p.x += p.vx * dt; p.z += p.vz * dt;
      collide(p, p.y);
      settle(p, dt);
      p.moving = Math.hypot(p.vx, p.vz);
    }

    // --- packages
    function load() {
      const room = sim.shift.carry - p.carry.length;
      if (room <= 0) return;
      const got = sim.packages.filter((k) => k.state === "van").slice(0, room);
      if (!got.length) return;
      got.forEach((k) => { k.state = "carried"; p.carry.push(k.id); });
      sim.events.push({ t: "load", n: got.length });
    }
    // What a wrong door sets off: a valuable parcel may be kept; otherwise a dog may come out, or the resident, angry; or just a scolding.
    function wrongOutcome(k) {
      const sh = sim.shift, r = rnd(), r2 = rnd(), dogs = sim.chasers.filter((c) => c.kind === "dog").length, angry = sim.chasers.filter((c) => c.kind === "angry").length;
      if (k.valuable && r < sh.keep) return "keep";
      if (r2 < sh.dogs && dogs < 2 && sim.chasers.length < CFG.MAX_CHASERS) return "dog";
      if (r2 < sh.dogs + sh.angry && angry < 2 && sim.chasers.length < CFG.MAX_CHASERS) return "angry";
      return "shrug";
    }
    function spawnChaser(kind, d) {
      const c = { kind: kind, unit: d.unit, id: (sim.chaseId = (sim.chaseId || 0) + 1), x: d.x, y: d.y, z: d.z + d.nz * 0.85, vy: 0, grounded: true, yaw: d.nz > 0 ? 0 : Math.PI,
        moving: 0, t: kind === "dog" ? CFG.DOGC_T : CFG.ANGRY_T, cd: 0.7, path: [], rt: 0, state: "chase", leave: 5, home: { x: d.x, y: d.y, z: d.z + d.nz * 0.85 } };
      sim.chasers.push(c);
      return c;
    }
    function drop() {
      const k = sim.current();
      if (!k) { sim.events.push({ t: "empty" }); return; }
      const d = sim.doorNear(p);
      if (!d) { sim.events.push({ t: "nodoor" }); return; }
      p.act = 0.6;
      if (d.unit === k.unit) {
        k.state = "delivered"; k.at = sim.time;
        p.carry.splice(p.cur, 1);
        if (p.cur >= p.carry.length) p.cur = 0;
        const pts = (CFG.PTS + CFG.COMBO_PTS * sim.combo) * (k.valuable ? CFG.VAL_MULT : 1);
        sim.score += pts; sim.combo++; sim.bestCombo = Math.max(sim.bestCombo, sim.combo); sim.delivered++;
        if (sim.scan && sim.scan.unit === k.unit) sim.scan = null;
        sim.events.push({ t: "deliver", unit: d.unit, pts: pts, combo: sim.combo, valuable: k.valuable, x: d.x, y: d.y, z: d.z });
      } else {
        sim.wrong++; sim.combo = 0; sim.clock = Math.max(0, sim.clock - CFG.WRONG_T);
        const out = wrongOutcome(k);
        if (out === "keep") {
          k.state = "kept"; sim.lost++; sim.score = Math.max(0, sim.score - CFG.KEEP_PEN);
          p.carry.splice(p.cur, 1); if (p.cur >= p.carry.length) p.cur = 0;
          if (sim.scan && sim.scan.unit === k.unit) sim.scan = null;
        } else if (out === "dog") spawnChaser("dog", d);
        else if (out === "angry") spawnChaser("angry", d);
        sim.events.push({ t: "wrong", unit: d.unit, want: k.unit, out: out, x: d.x, y: d.y, z: d.z, nz: d.nz });
      }
    }
    function useScan() {
      const k = sim.current();
      if (!k || sim.scans <= 0) { sim.events.push({ t: "noscan" }); return; }
      sim.scans--;
      // it points loosely: the reading wobbles a bit and it doesn't say which floor
      sim.scan = { unit: k.unit, t: CFG.SCAN_T, err: (rnd() - 0.5) * 0.7 };
      sim.events.push({ t: "scan", unit: k.unit });
    }
    // Where the scanner points from q, in world yaw (radians), or null.
    sim.scanYaw = function (q) {
      if (!sim.scan) return null;
      const d = sim.doorOf(sim.scan.unit);
      return Math.atan2(-(d.x - q.x), -(d.z - q.z)) + sim.scan.err;
    };

    // --- hazards
    function walkPath(a, path, speed, dt, loop) {
      const tgt = path[(a.seg + 1) % path.length];
      const dx = tgt[0] - a.x, dz = tgt[2] - a.z, d = Math.hypot(dx, dz);
      const s = speed * dt;
      if (d <= s) { a.x = tgt[0]; a.z = tgt[2]; a.seg = (a.seg + 1) % path.length; }
      else { a.x += dx / d * s; a.z += dz / d * s; a.yaw = Math.atan2(-dx, -dz); }
      a.moving = speed;
    }
    // Chasers (a resident out of a wrong door, or their dog) follow the walking graph to the driver and take the last stretch straight.
    function chaseSteer(c, tx, ty, tz, dt, speed) {
      const dx = tx - c.x, dz = tz - c.z, dist = Math.hypot(dx, dz);
      let gx = tx, gz = tz;
      const direct = Math.abs(ty - c.y) < 0.8 && (dist < 1.2 || ray(L, c.x, c.y + 0.9, c.z, dx / dist, 0, dz / dist, dist) >= dist - 0.3);
      if (!direct) {
        c.rt -= dt;
        if (c.rt <= 0 || !c.path.length) {
          c.rt = 0.4;
          const a = nearestNode(c), b = nearestNode({ x: tx, y: ty, z: tz }), r = a === b ? null : route(a, b);
          c.path = r ? r.nodes.slice(1) : [];
        }
        while (c.path.length) { const n = L.nodes[c.path[0]]; if (Math.hypot(n.x - c.x, n.z - c.z) < 0.6 && Math.abs(n.y - c.y) < 0.8) c.path.shift(); else break; }
        if (c.path.length) { const n = L.nodes[c.path[0]]; gx = n.x; gz = n.z; }
      } else c.path = [];
      const ddx = gx - c.x, ddz = gz - c.z, dd = Math.hypot(ddx, ddz);
      if (dd > 0.05) { const s = Math.min(speed * dt, dd); c.x += ddx / dd * s; c.z += ddz / dd * s; c.yaw = Math.atan2(-ddx, -ddz); c.moving = speed; } else c.moving = 0;
      collide(c, c.y); settle(c, dt);
    }
    function chasers(dt) {
      for (let i = sim.chasers.length - 1; i >= 0; i--) {
        const c = sim.chasers[i], dog = c.kind === "dog";
        c.cd = Math.max(0, c.cd - dt);
        if (c.state === "chase") {
          c.t -= dt;
          if (c.t <= 0) c.state = "leave";
          chaseSteer(c, p.x, p.y, p.z, dt, dog ? CFG.DOGC_SPEED : CFG.ANGRY_SPEED);
          const d = Math.hypot(p.x - c.x, p.z - c.z);
          if (d < CFG.CHASE_R && c.cd <= 0 && p.stagger <= 0 && Math.abs(p.y - c.y) < 1) {
            p.stagger = dog ? CFG.STAGGER_T : 0.9; sim.combo = 0;
            sim.clock = Math.max(0, sim.clock - (dog ? CFG.DOGC_HIT_T : CFG.ANGRY_HIT_T));
            const k = 2.4 / Math.max(d, 0.1); p.vx = (p.x - c.x) * k; p.vz = (p.z - c.z) * k;
            c.cd = 2.5;
            if (!dog) c.state = "leave";
            sim.events.push({ t: dog ? "bite" : "shove", unit: c.unit, id: c.id });
            sim.events.push({ t: "stagger", by: c.kind });
          }
        } else {
          c.leave -= dt;
          chaseSteer(c, c.home.x, c.home.y, c.home.z, dt, dog ? CFG.DOGC_SPEED * 0.7 : CFG.ANGRY_SPEED * 0.8);
          if (Math.hypot(c.home.x - c.x, c.home.z - c.z) < 0.9 || c.leave <= 0) { sim.chasers.splice(i, 1); sim.events.push({ t: "gone", id: c.id }); }
        }
      }
    }
    function hazards(dt) {
      const dg = sim.dog;
      if (dg) {
        dg.cd = Math.max(0, dg.cd - dt); dg.barkT = Math.max(0, dg.barkT - dt);
        const d = Math.hypot(p.x - dg.x, p.z - dg.z);
        if (d < 6 && Math.abs(p.y - dg.y) < 1) {   // spotted you: comes at you
          if (dg.cd <= 0) { const k = Math.min(1, 4.2 * dt / Math.max(d, 1e-3)); dg.x += (p.x - dg.x) * k; dg.z += (p.z - dg.z) * k; dg.yaw = Math.atan2(-(p.x - dg.x), -(p.z - dg.z)); dg.moving = 4.2; }
          if (dg.barkT <= 0) { dg.barkT = 1.4; sim.events.push({ t: "bark", x: dg.x, z: dg.z }); }
        } else walkPath(dg, L.dogPath, 1.6, dt);
        if (d < CFG.DOG_R && dg.cd <= 0 && p.stagger <= 0 && Math.abs(p.y - dg.y) < 1) {
          dg.cd = CFG.DOG_CD; p.stagger = CFG.STAGGER_T;
          const k = 2.2 / Math.max(d, 0.1); p.vx = (p.x - dg.x) * k; p.vz = (p.z - dg.z) * k;
          sim.combo = 0;
          sim.events.push({ t: "stagger", by: "dog" });
        }
      }
      const pr = sim.pirate;
      if (pr) {
        pr.cd = Math.max(0, pr.cd - dt);
        walkPath(pr, L.pirateLoop, pr.flee > 0 ? 5.5 : 2.2, dt);
        pr.flee = Math.max(0, pr.flee - dt);
        const d = Math.hypot(p.x - pr.x, p.z - pr.z);
        if (d < CFG.PIRATE_R && pr.cd <= 0 && p.carry.length && Math.abs(p.y - pr.y) < 1) {
          const k = sim.current();
          k.state = "van";   // the depot sends it out again: it's back in the van
          p.carry.splice(p.cur, 1); if (p.cur >= p.carry.length) p.cur = 0;
          pr.cd = CFG.PIRATE_CD; pr.flee = 3; sim.combo = 0;
          sim.events.push({ t: "steal", unit: k.unit });
        }
      }
      chasers(dt);
    }

    // --- routing on the level graph (the bot, the chasers, the route plan)
    function route(from, to) {
      const dist = {}, prev = {}, open = new Set(Object.keys(L.nodes));
      for (const id of open) dist[id] = Infinity;
      dist[from] = 0;
      while (open.size) {
        let u = null;
        for (const id of open) if (u === null || dist[id] < dist[u]) u = id;
        if (dist[u] === Infinity || u === to) break;
        open.delete(u);
        for (const [v, w] of L.adj[u]) if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
      }
      if (dist[to] === Infinity) return null;
      const out = [to];
      while (out[0] !== from) out.unshift(prev[out[0]]);
      return { nodes: out, len: dist[to] };
    }
    sim.route = route;
    function nearestNode(q) {
      let best = null, bd = Infinity;
      for (const id in L.nodes) { const n = L.nodes[id], d = Math.hypot(n.x - q.x, n.z - q.z) + Math.abs(n.y - q.y) * 10; if (d < bd) { bd = d; best = id; } }
      return best;
    }

    // The route the driver will want: trips of up to `carry` stops, nearest door first, the van between them.
    // Shown on the handheld during the countdown (a polyline per trip, in world x/z, with the stops on it).
    function makePlan() {
      let left = sim.packages.slice(), at = "van";
      const trips = [];
      while (left.length) {
        const trip = { stops: [], pts: [] };
        for (let n = 0; n < sim.shift.carry && left.length; n++) {
          let bi = -1, br = null;
          left.forEach((k, i) => { const r = route(at, "d" + k.unit); if (r && (!br || r.len < br.len)) { br = r; bi = i; } });
          if (bi < 0) { left.splice(0, left.length); break; }
          const k = left.splice(bi, 1)[0], d = sim.doorOf(k.unit);
          br.nodes.forEach((id) => { const nd = L.nodes[id]; trip.pts.push([nd.x, nd.z, nd.y]); });
          trip.stops.push({ unit: k.unit, x: d.x, z: d.z, y: d.y, valuable: k.valuable, bldg: d.bldg });
          at = "d" + k.unit;
        }
        const back = route(at, "van");
        if (back) back.nodes.forEach((id) => { const nd = L.nodes[id]; trip.pts.push([nd.x, nd.z, nd.y]); });
        at = "van";
        trips.push(trip);
      }
      return trips;
    }

    // --- the bot driver: routes on the level graph to the van or the nearest door it carries
    const bot = sim.bot = opts.bot ? { path: ["van"], at: null, stuckT: 0, to: null, best: 0 } : null;   // first stop: the van
    function botThink(dt) {
      const out = { mx: 0, mz: 0, yaw: p.yaw, pitch: -0.12, sprint: false, act: false, next: false, scan: false };
      if (!bot.path.length) {
        let goal = "van";
        if (p.carry.length && !(sim.inVan() && p.carry.length < sim.shift.carry && bot.at === "van")) {
          let best = null;
          p.carry.forEach((id, i) => { const r = route(bot.at, "d" + sim.packages[id].unit); if (r && (!best || r.len < best.len)) best = { r, i }; });
          goal = best ? "d" + sim.packages[p.carry[best.i]].unit : "van";
        }
        if (goal === bot.at) {
          if (goal === "van") return out;   // waiting on the van (nothing left to load)
          const unit = +goal.slice(1);
          p.cur = p.carry.findIndex((id) => sim.packages[id].unit === unit);
          out.act = true; bot.path = []; return out;
        }
        const r = route(bot.at, goal);
        bot.path = r ? r.nodes.slice(1) : [];
      }
      const n = L.nodes[bot.path[0]];
      const dx = n.x - p.x, dz = n.z - p.z, d = Math.hypot(dx, dz);
      if (d < 0.45 && Math.abs(n.y - p.y) < 0.8) { bot.at = bot.path.shift(); return out; }
      out.yaw = Math.atan2(-dx, -dz); out.mz = 1; out.sprint = p.stamina > 0.35 || (p.sprint && p.stamina > 0.05);
      // the pirate: step round them, like anyone would
      const pr = sim.pirate;
      if (pr && p.carry.length && pr.cd <= 0 && Math.abs(pr.y - p.y) < 1) {
        const ox = pr.x - p.x, oz = pr.z - p.z, od = Math.hypot(ox, oz);
        const ahead = (-Math.sin(out.yaw) * ox - Math.cos(out.yaw) * oz);
        if (od < 4.5 && ahead > -0.5) { out.mx = (Math.cos(out.yaw) * ox - Math.sin(out.yaw) * oz) > 0 ? -1 : 1; out.sprint = true; }
      }
      // stuck (shoved off the line by the dog, say): no closer to the next stop for a while, so start again from the nearest one
      if (bot.to !== n.id) { bot.to = n.id; bot.best = d; bot.stuckT = 0; }
      if (d < bot.best - 0.3) { bot.best = d; bot.stuckT = 0; }
      if ((bot.stuckT += dt) > 2) { bot.at = nearestNode(p); bot.path = []; bot.to = null; sim.botReplans = (sim.botReplans || 0) + 1; }
      return out;
    }

    // ------------------------------------------------------------------ the step
    sim.step = function (dt, inp) {
      sim.time += dt;
      if (sim.phase === "countdown") {
        sim.phaseT -= dt;
        if (inp && inp.yaw != null) { p.yaw = inp.yaw; p.pitch = inp.pitch; }
        if (sim.phaseT <= 0) { sim.phase = "play"; sim.events.push({ t: "go" }); }
        return;
      }
      if (sim.phase !== "play") return;
      if (bot) inp = botThink(dt);
      inp = inp || {};
      if (inp.yaw != null) { p.yaw = wrap(inp.yaw); p.pitch = clamp(inp.pitch || 0, -1.1, 0.7); }
      if (inp.next && p.carry.length) p.cur = (p.cur + 1) % p.carry.length;
      if (inp.prev && p.carry.length) p.cur = (p.cur + p.carry.length - 1) % p.carry.length;
      if (inp.pick != null && inp.pick < p.carry.length) p.cur = inp.pick;
      move(dt, inp.mx || 0, inp.mz || 0, !!inp.sprint);
      p.act = Math.max(0, p.act - dt);
      if (sim.nearVan()) load();
      if (inp.act) drop();
      if (inp.scan) useScan();
      if (sim.scan && (sim.scan.t -= dt) <= 0) sim.scan = null;
      hazards(dt);
      sim.clock -= dt;
      if (sim.left() === 0 || sim.clock <= 0) finish();
    };
    function finish() {
      sim.clock = Math.max(0, sim.clock);
      const all = sim.left() === 0;
      sim.bonus = all ? Math.round(sim.clock) * CFG.TIME_PTS : 0;
      sim.score += sim.bonus;
      // a parcel somebody kept caps the shift at one star
      sim.stars = !all ? 0 : sim.lost ? 1 : 1 + (sim.clock >= sim.shift.par ? 1 : 0) + (sim.clock >= sim.shift.par && sim.wrong === 0 ? 1 : 0);
      sim.phase = "over";
      sim.events.push({ t: "over", all: all, stars: sim.stars, score: sim.score });
    }
    sim.start = function () { sim.events.push({ t: "start", shift: shift.id }); };
    sim.plan = makePlan();
    return sim;
  };
})(globalThis.WD);
