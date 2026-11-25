// The town of Pecan Hollow: roads, 84 lots (the Flats west, the Heights east), a downtown strip, a construction site, the sky.
// Coordinates: x east, z south (the camera starts looking north, -z). One continuous map: no loading between districts.
//
// 2026-11-08 realism pass (user: "it looks very cartoonish", "make it more realistic, like Run It Up"): Run It Up's
// look ported over. PBR materials (Standard, not Lambert) with painted textures on every surface (textures.js from Run
// It Up + surfaces.js), world-scaled UVs on the ground, gutters, manholes, storm drains, puddles, oil stains, litter,
// wooden power poles with sagging lines and service drops, cobra-head street lights with light pools at night, brick
// storefronts with lit windows, parapets and rooftop units, Run It Up's flora build for every tree, a gradient sky dome
// with a sun, a small-town skyline (water tower, grain elevator), and Meshy cars in every parking spot (W.parked; main.js
// places them).
import * as THREE from "three";
import { Merger, boxGeo, cylGeo, planeGeo, M, canvasTex } from "./kit3d.js";
import { addHouse, addFlora, car } from "./houses.js";
import { yardTree, farTree, bush, floraMat } from "./flora.js";
import { asphalt, asphaltRough, sidewalk, concrete, brick, blob, sign, facade } from "./textures.js";
import * as S from "./surfaces.js";
import { BRANDS, layout, brandSign, bladeSign, valance, awningCloth, chalkBoard, barberPole } from "./brands.js";

export const LOT_W = 20, LOT_D = 22;
export const STREET_Z = { s1: -62, main: 0, s2: 62 };
export const EDGE = { x: 238, z: 118 };

// ---------------------------------------------------------------- lots
export function makeLots() {
  const lots = []; let id = 0;
  const base = { flats: { s1: 200, main: 100, s2: 300 }, heights: { s1: 1200, main: 1100, s2: 1300 } };
  for (const district of ["flats", "heights"]) {
    const x0 = district === "flats" ? -215 : 95;
    for (const row of ["s1", "main", "s2"]) for (const side of [-1, 1]) for (let k = 0; k < 7; k++) {
      const zc = STREET_Z[row], z = zc + side * 18.5, face = side < 0 ? 1 : -1;
      lots.push({ id: id++, district, row, side, face, x: x0 + k * 20, z, n: base[district][row] + k * 2 + (side < 0 ? 0 : 1) });
    }
  }
  return lots;
}

// ---------------------------------------------------------------- downtown buildings
// face +1 = north side of Main (front toward +z), -1 = south side.
const BUILDINGS = [
  { id: "mentor", name: "IRONWOOD ACQUISITIONS", sub: "We Buy Houses", x: -62, w: 14, h: 7.5, face: 1, wall: "#8d5a3c", kind: "office" },
  { id: "title", name: "SOUTHLINE TITLE", sub: "& Escrow", x: -46, w: 12, h: 6.5, face: 1, wall: "#6f7f93", kind: "office" },
  { id: "diner", name: "KETTLE DINER", sub: "Open Late", x: -31, w: 14, h: 5.6, face: 1, wall: "#b8453a", kind: "shop" },
  { id: "barber", name: "FADE & FLOW", sub: "Barbers", x: -17, w: 10, h: 5.6, face: 1, wall: "#3f5f52", kind: "shop" },
  { id: "hardware", name: "PLUMB & NAIL", sub: "Hardware", x: -2, w: 16, h: 6, face: 1, wall: "#7a6f56", kind: "shop" },
  { id: "lender", name: "COBBLESTONE BRIDGE", sub: "Capital", x: 16, w: 14, h: 9, face: 1, wall: "#5e6e82", kind: "office" },
  { id: "agent", name: "PECAN HOLLOW REALTY", sub: "Homes & Listings", x: 32, w: 12, h: 7, face: 1, wall: "#c48f6a", kind: "office" },
  { id: "pawn", name: "SECOND CHANCE", sub: "Pawn & Loan", x: 47, w: 11, h: 5.6, face: 1, wall: "#6e5a78", kind: "shop" },
  { id: "bank", name: "HERITAGE SAVINGS", sub: "Since 1951", x: 62, w: 14, h: 8.5, face: 1, wall: "#a79b86", kind: "office" },
  { id: "home", name: "MAPLE COURT", sub: "Apartments", x: -58, w: 26, h: 9.5, face: -1, wall: "#9a8466", kind: "apt", d: 13 },
  { id: "pharmacy", name: "HOLLOW DRUG", sub: "Pharmacy", x: -36, w: 12, h: 5.6, face: -1, wall: "#477a66", kind: "shop" },
  { id: "laundry", name: "SUDS LAUNDRY", sub: "Wash & Fold", x: -22, w: 10, h: 5.6, face: -1, wall: "#6d8fa8", kind: "shop" },
  { id: "taco", name: "EL CAMION TACOS", sub: "Cocina Casera", x: -8, w: 12, h: 5.6, face: -1, wall: "#c4742e", kind: "shop" },
  { id: "coffee", name: "BEAN THERE", sub: "Coffee", x: 6, w: 11, h: 5.6, face: -1, wall: "#5a4636", kind: "shop" },
  { id: "offices", name: "CIVIC PLAZA", sub: "Offices", x: 22, w: 14, h: 7, face: -1, wall: "#7e8a8c", kind: "office" },
  { id: "tire", name: "AXLE TIRE & BRAKE", sub: "While You Wait", x: 38, w: 14, h: 5.6, face: -1, wall: "#4e4e54", kind: "shop" },
  { id: "records", name: "RECORDS OFFICE", sub: "Deeds & Permits", x: 54, w: 12, h: 7, face: -1, wall: "#9c8f7c", kind: "office" }
];

// One random stream per purpose (own seeds), so adding dressing never moves anything else.
function rnd(seed) { let s = Math.abs(seed | 0) % 2147483646 || 1; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; }

// ---------------------------------------------------------------- the town
export function buildWorld(scene, P, lots) {
  const W = { group: new THREE.Group(), lots, place: {}, boxes: [], circles: [], poi: {}, bld: {}, nightMats: [], lamps: [], parked: [] };
  scene.add(W.group);

  // ---- materials: PBR with painted maps; vertex colour tints the neutral ones per house
  const plateCols = 8, plateRows = 16;
  const plateTex = canvasTex(1024, 1024, (g) => {
    g.fillStyle = "#101820"; g.fillRect(0, 0, 1024, 1024);
    lots.forEach((l, i) => {
      const cx = i % plateCols, cy = Math.floor(i / plateCols), x = cx * 128, y = cy * 64;
      g.fillStyle = "#24282c"; g.fillRect(x + 3, y + 3, 122, 58); g.strokeStyle = "#b8a878"; g.lineWidth = 3; g.strokeRect(x + 6, y + 6, 116, 52);
      g.fillStyle = "#e8dcb8"; g.font = "700 40px Georgia"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(l.n), x + 64, y + 34, 108);
    });
  }, { clamp: true });
  const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, ...o });
  const roofTex = S.shingles(); roofTex.repeat.set(0.5, 0.5);
  const lampPoolM = new THREE.MeshBasicMaterial({ map: S.lampPool(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4 });
  W.mats = {
    plain: std({}), wall: std({ map: S.lapSiding() }), roof: std({ map: roofTex, side: THREE.DoubleSide, roughness: 0.95 }),
    brick: std({ map: brick("#9a5a44", "#6e665c", 9) }), conc: std({ map: concrete("#c4c0b6", 21) }), drive: std({ map: S.drive() }), pave: std({ map: concrete("#bdb9ae", 23) }),
    grass: std({ map: S.grass(), roughness: 1 }), dirt: std({ map: S.dirt(), roughness: 1 }),
    road: std({ map: asphalt(), roughnessMap: asphaltRough(), roughness: 1 }), walk: std({ map: sidewalk() }), paint: std({ roughness: 0.75 }),
    plate: std({ map: plateTex, roughness: 0.5, metalness: 0.4 }),
    glass: std({ map: S.windowGlass(1), roughness: 0.12, metalness: 0.25 }), glassLit: std({ map: S.windowGlass(0), roughness: 0.12, metalness: 0.25, emissive: 0xffc870, emissiveIntensity: 0 }),
    metal: std({ roughness: 0.45, metalness: 0.5 }), gdoor: std({ map: S.garageDoor(), roughness: 0.55 }),
    fence: std({ map: S.fenceBoards(), alphaTest: 0.5 }), chain: std({ map: S.chainLink(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.4, metalness: 0.6 }),
    bag: std({ color: 0x1a1a1c, roughness: 0.25, metalness: 0.1 }), ply: std({ map: concrete("#b0966a", 33), roughness: 0.95 }),
    salesign: std({ map: sign("FOR SALE", "#b8261c", "#ffffff", 384, 256), roughness: 0.5 }), rentsign: std({ map: sign("FOR RENT", "#efeadc", "#1d1d1d", 384, 256), roughness: 0.5 }),
    lamp: std({ color: 0xfff2d0, emissive: 0xffe2a0, emissiveIntensity: 0 }),
    puddle: std({ color: 0x0b0d10, alphaMap: blob(5), transparent: true, depthWrite: false, roughness: 0.05, metalness: 0.4, polygonOffset: true, polygonOffsetFactor: -3 }),
    oil: std({ color: 0x060607, alphaMap: blob(9), transparent: true, opacity: 0.6, depthWrite: false, roughness: 0.3, polygonOffset: true, polygonOffsetFactor: -2 }),
    pool: lampPoolM
  };
  for (const k of ["bark", "leafcard", "leafvol", "shrubvol", "tuft"]) W.mats["fl-" + k] = floraMat(k, std);
  W.nightMats = [W.mats.glassLit, W.mats.lamp];

  const mg = new Merger();
  mg.wuv = { grass: 4, road: 8, walk: 2, pave: 2.5, drive: 3, dirt: 6 };
  mg.parked = W.parked;
  // the land around everything: grass, a little patchier than the yards
  const gt = S.grass().clone(); gt.repeat.set(1400 / 5, 1000 / 5); gt.needsUpdate = true;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: gt, color: 0x8a9a62, roughness: 1 }));
  ground.position.y = -0.02; ground.receiveShadow = true; W.group.add(ground); W.ground = ground;

  // ---- roads, gutters, sidewalks, markings
  const RD = rnd(7001);
  const cellAt = (x, z) => { mg.cell = [Math.floor(x / 60), Math.floor(z / 60)]; };
  // sidewalks and curbs stop at the cross streets (they used to run straight over them)
  const segX = (fn) => { for (const [a0, b0] of [[-235, -85], [-75, 75], [85, 235]]) for (let x = a0; x < b0; x += 50) fn(x, Math.min(x + 50, b0)); };
  mg.at(0, 0, 0);
  for (const row of ["s1", "main", "s2"]) {
    const zc = STREET_Z[row];
    for (let x = -235; x < 235; x += 47) { cellAt(x + 23.5, zc); mg.add(planeGeo(47, 10), "road", M(x + 23.5, 0.02, zc), 0xffffff, false); }
    segX((a, b) => {
      cellAt((a + b) / 2, zc);
      for (const sd of [-1, 1]) {
        mg.add(planeGeo(b - a, 0.45), "pave", M((a + b) / 2, 0.025, zc + sd * 4.78), 0xc8c4ba, false);        // gutter pan
        mg.add(boxGeo(b - a, 0.14, 2.5), "walk", M((a + b) / 2, 0.07, zc + sd * 6.25), 0xffffff, false);
        mg.add(boxGeo(b - a, 0.16, 0.16), "conc", M((a + b) / 2, 0.08, zc + sd * 5.0), 0xd0ccc2, false);    // curb
      }
    });
    if (row === "main") for (let x = -230; x < 230; x += 8) { if (Math.abs(Math.abs(x) - 80) < 7) continue; cellAt(x, zc); mg.add(planeGeo(3.2, 0.13), "paint", M(x, 0.03, zc - 0.12), 0xc9b45a, false); mg.add(planeGeo(3.2, 0.13), "paint", M(x, 0.03, zc + 0.12), 0xc9b45a, false); }
  }
  for (const xc of [-80, 80]) {
    for (let z0 = -125; z0 < 125; z0 += 50) { cellAt(xc, z0 + 25); mg.add(planeGeo(10, 50), "road", M(xc, 0.021, z0 + 25), 0xffffff, false); }
    for (const [z0, z1] of [[-125, -67.5], [-56.5, -5], [5, 56.5], [67.5, 125]]) {
      const zm = (z0 + z1) / 2, L = z1 - z0; cellAt(xc, zm);
      for (const sd of [-1, 1]) {
        mg.add(boxGeo(2.5, 0.14, L), "walk", M(xc + sd * 6.25, 0.07, zm), 0xffffff, false);
        mg.add(boxGeo(0.16, 0.16, L), "conc", M(xc + sd * 5.0, 0.08, zm), 0xd0ccc2, false);
        mg.add(planeGeo(0.45, L), "pave", M(xc + sd * 4.78, 0.025, zm), 0xc8c4ba, false);
      }
    }
    for (let z = -120; z < 120; z += 8) { if (Object.values(STREET_Z).some((zc) => Math.abs(z - zc) < 7)) continue; cellAt(xc, z); mg.add(planeGeo(0.13, 3.2), "paint", M(xc, 0.03, z), 0xc9b45a, false); }
    // intersections: crosswalk bars + stop lines
    for (const zc of Object.values(STREET_Z)) {
      cellAt(xc, zc);
      mg.add(planeGeo(10, 10), "road", M(xc, 0.022, zc), 0xffffff, false);
      for (const sd of [-1, 1]) {
        for (let i = -4; i <= 4; i++) { mg.add(planeGeo(0.5, 2.6), "paint", M(xc + i * 1.0, 0.031, zc + sd * 6.3), 0xe8e6de, false); mg.add(planeGeo(2.6, 0.5), "paint", M(xc + sd * 6.3, 0.031, zc + i * 1.0), 0xe8e6de, false); }
        mg.add(planeGeo(4.6, 0.4), "paint", M(xc + sd * 2.5, 0.031, zc - sd * 8.0), 0xe8e6de, false);
      }
    }
  }
  // manholes in the lanes, storm-drain inlets in the curb
  for (const zc of Object.values(STREET_Z)) for (let x = -220; x <= 220; x += 46 + Math.floor(RD() * 20)) {
    cellAt(x, zc);
    const mz = zc + (RD() < 0.5 ? -2.4 : 2.4);
    mg.add(cylGeo(0.5, 0.5, 0.04, 20), "metal", M(x, 0.03, mz), 0x55575a, false);
    mg.add(new THREE.TorusGeometry(0.47, 0.04, 4, 20), "metal", M(x, 0.04, mz, 0, 1, 1, 1, Math.PI / 2), 0x3a3b3d, false);
    const sd = RD() < 0.5 ? -1 : 1;
    mg.add(boxGeo(1.2, 0.1, 0.06), "plain", M(x + 10, 0.07, zc + sd * 4.93), 0x0c0c0e, false);
    mg.add(boxGeo(1.1, 0.02, 0.5), "metal", M(x + 10, 0.03, zc + sd * 4.7), 0x2a2b2d, false);
  }

  // ---- houses
  lots.forEach((l, i) => {
    const p = P[l.id];
    const cx = i % plateCols, cy = Math.floor(i / plateCols);
    const uv = [cx / plateCols, 1 - (cy + 1) / plateRows, (cx + 1) / plateCols, 1 - cy / plateRows];
    mg.at(l.x, l.z, l.face > 0 ? 0 : Math.PI);
    const h = addHouse(mg, p, uv);
    const cs = l.face > 0 ? 1 : -1;
    const lx0 = -h.W / 2 - 1.3, lx1 = (h.garage ? h.gx + 1.9 : h.W / 2 + 0.3), lz0 = h.zF - h.D - 0.3, lz1 = h.zF + 2.2;
    const ax = l.x + lx0 * cs, bx = l.x + lx1 * cs, az = l.z + lz0 * cs, bz = l.z + lz1 * cs;
    W.boxes.push({ x0: Math.min(ax, bx), x1: Math.max(ax, bx), z0: Math.min(az, bz), z1: Math.max(az, bz) });
    W.place[l.id] = { x: l.x, z: l.z, face: l.face, door: { x: l.x + h.px * cs, z: l.z + (h.zF + 3.0) * cs }, porch: { x: l.x + h.px * cs, z: l.z + (h.zF + 1.2) * cs }, front: { x: l.x, z: l.z + 8 * cs }, yaw: l.face > 0 ? 0 : Math.PI, size: h, eave: { x: l.x + (h.W * 0.3) * cs, y: h.H + 0.1, z: l.z + (h.zF - 0.3) * cs } };
  });

  // ---- the shop fronts' real 3D parts (2026-11-24, ported from Run It Up's shopFront): window and door frames with depth,
  // a big lit sign plate on goosenecked lamps, a blade sign out over the sidewalk, an awning in the shop's colours with the name on
  // its valance, a chalkboard A-frame by the door, a barber pole / security bars where the shop has them. The painted
  // window views, door and cladding are in the facade texture (surfaces.storefront). All in the building's own frame:
  // +z toward the street, x along the front, the door at x = 0.
  W.signMats = [];
  const litMat = (map, base = 0.3) => { const m = new THREE.MeshStandardMaterial({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: base, roughness: 0.45 }); W.signMats.push(m); return m; };
  const brandMats = {};
  const bm = (k, make) => brandMats[k] || (brandMats[k] = make());
  function shopFront(b, d, grp, RB) {
    const B = BRANDS[b.id], fz = d / 2, L = layout(b), trim = new THREE.Color(B.trim).getHex();
    // frames: each window bay (0.5 .. 2.75 m up), and the door (posts 1.26 m apart, a lintel, a stone step)
    const bays = [[-b.w / 2 + 0.55, -0.775], [0.775, b.w / 2 - 0.55]];
    for (const [x0, x1] of bays) {
      const ww = x1 - x0, xc = (x0 + x1) / 2, wy = 1.625;
      for (const y of [0.44, 2.81]) mg.add(boxGeo(ww + 0.24, 0.12, 0.2), "metal", M(xc, y, fz + 0.1), trim, false);
      for (const x of [x0 - 0.06, x1 + 0.06]) mg.add(boxGeo(0.12, 2.37, 0.2), "metal", M(x, wy, fz + 0.1), trim, false);
      if (B.bars) {   // security bars over the glass
        for (let x = x0 + 0.1; x < x1; x += 0.16) mg.add(boxGeo(0.03, 2.25, 0.03), "metal", M(x, wy, fz + 0.2), 0x1a1b1d, false);
        for (const y of [0.58, 1.625, 2.67]) mg.add(boxGeo(ww, 0.04, 0.04), "metal", M(xc, y, fz + 0.2), 0x1a1b1d, false);
      }
    }
    for (const x of [-0.63, 0.63]) mg.add(boxGeo(0.16, 2.55, 0.26), "metal", M(x, 1.275, fz + 0.13), trim, false);
    mg.add(boxGeo(1.42, 0.18, 0.26), "metal", M(0, 2.55, fz + 0.13), trim, false);
    mg.add(boxGeo(1.9, 0.1, 0.9), "pave", M(0, 0.05, fz + 0.45), 0xffffff, false);
    // the big sign: dark housing, the lit plate, trim bars, four lamps on goosenecks
    const sw = L.signW, sh = L.signH, sy = L.signY;
    mg.add(boxGeo(sw + 0.3, sh + 0.3, 0.22), "metal", M(0, sy, fz + 0.11), 0x1b1c1e, false);
    const plateT = brandSign(b.id, sw / sh);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), bm("sign" + b.id + "@" + (sw / sh).toFixed(2), () => litMat(plateT, 0.3)));
    plate.position.set(0, sy, fz + 0.235); grp.add(plate);
    for (const dy of [sh / 2 + 0.17, -sh / 2 - 0.17]) mg.add(boxGeo(sw + 0.36, 0.06, 0.28), "metal", M(0, sy + dy, fz + 0.14), trim, false);
    for (let k = 0; k < 4; k++) {
      const lx = (k - 1.5) * sw * 0.28;
      mg.add(boxGeo(0.05, 0.05, 0.62), "metal", M(lx, sy + sh / 2 + 0.38, fz + 0.45), 0x26292b, false);
      mg.add(boxGeo(0.26, 0.12, 0.2), "lamp", M(lx, sy + sh / 2 + 0.32, fz + 0.78), 0xffffff, false);
    }
    // blade sign at the left end, sticking out over the sidewalk
    const bh = Math.min(1.6, b.h - 0.55 - 2.75), bw = bh * 0.8, bx = -b.w / 2 + 0.45, bz = fz + 0.35 + bw / 2, by = 2.75 + bh / 2;
    mg.add(boxGeo(0.14, bh + 0.14, bw + 0.14), "metal", M(bx, by, bz), 0x1b1c1e, false);
    mg.add(boxGeo(0.07, 0.07, bw + 0.45), "metal", M(bx, by + bh / 2 + 0.14, fz + (bw + 0.45) / 2), trim, false);
    const bT = bladeSign(b.id, 0.8), bmat = bm("blade" + b.id, () => litMat(bT, 0.3));
    for (const sd of [1, -1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), bmat); p.position.set(bx + sd * 0.075, by, bz); p.rotation.y = sd * Math.PI / 2; grp.add(p); }
    // awning: sloped cloth in the shop's colours over the windows and door, the name on its front flap
    const aw = b.w * 0.86, out = 1.35, drop = 0.42, Lh = Math.hypot(out, drop), top = 3.0;
    const cloth = bm("cloth" + b.id, () => new THREE.MeshStandardMaterial({ map: awningCloth(b.id), roughness: 0.85, side: THREE.DoubleSide }));
    const am = new THREE.Mesh(new THREE.PlaneGeometry(aw, Lh), cloth);
    am.rotation.x = -Math.atan2(out, drop); am.position.set(0, top - drop / 2, fz + out / 2); am.castShadow = true; am.receiveShadow = true; grp.add(am);
    const val = new THREE.Mesh(new THREE.PlaneGeometry(aw, 0.32), bm("val" + b.id + "@" + (aw / 0.32).toFixed(0), () => new THREE.MeshStandardMaterial({ map: valance(b.id, aw / 0.32), roughness: 0.8, side: THREE.DoubleSide })));
    val.position.set(0, top - drop - 0.15, fz + out + 0.01); grp.add(val);
    for (const sx of [-1, 1]) mg.add(boxGeo(0.04, 0.04, out), "metal", M(sx * aw / 2 * 0.96, top - drop / 2 - 0.02, fz + out / 2, 0, 1, 1, 1, Math.atan2(drop, out)), 0x2a2c2e, false);   // side arms
    // chalkboard A-frame by the door (on the side away from where people stand: world x = door - 1.7 either side of Main)
    if (B.chalk) {
      const cx = b.face > 0 ? -1.7 : 1.7, chalk = bm("chalk" + b.id, () => new THREE.MeshStandardMaterial({ map: chalkBoard(b.id), roughness: 0.85, side: THREE.DoubleSide }));
      for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.92), chalk); p.position.set(cx, 0.5, fz + 1.5 + s * 0.14); p.rotation.x = -s * 0.2; grp.add(p); }
    }
    if (b.id === "barber") {   // the striped pole beside the door
      const pole = bm("pole", () => new THREE.MeshStandardMaterial({ map: barberPole(), roughness: 0.3, emissive: 0xffffff, emissiveMap: barberPole(), emissiveIntensity: 0.15 }));
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.9, 16), pole); cyl.position.set(1.15, 2.0, fz + 0.3); grp.add(cyl);
      for (const y of [1.52, 2.48]) mg.add(cylGeo(0.14, 0.14, 0.08, 16), "metal", M(1.15, y, fz + 0.3), trim, false);
    }
  }

  // ---- downtown buildings: brick / stucco boxes, a painted storefront, cornice, parapet, rooftop units, awnings
  mg.at(0, 0, 0);
  const RB = rnd(7013);
  for (const b of BUILDINGS) {
    const d = b.d || 11, zc = b.face > 0 ? -7.5 - 0.6 - d / 2 : 7.5 + 0.6 + d / 2;
    const f = S.storefront(b);
    const sideT = f.brick ? brick(b.wall, "#5a524a", 3 + (b.x | 0) % 5) : concrete(b.wall, 11);   // same wall as the painted front
    const side = new THREE.MeshStandardMaterial({ map: sideT, roughness: 0.92 });
    const roofM = new THREE.MeshStandardMaterial({ color: 0x3e3e40, roughness: 0.95 });
    const front = new THREE.MeshStandardMaterial({ map: f.map, emissive: 0xffffff, emissiveMap: f.emissive, emissiveIntensity: 0, roughness: 0.8 });
    W.nightMats.push(front);
    const grp = new THREE.Group(); grp.position.set(b.x, 0, zc); grp.rotation.y = b.face > 0 ? 0 : Math.PI; W.group.add(grp);
    const body = new THREE.Mesh(boxGeo(b.w, b.h, d, 1.6), [side, side, roofM, side, side, side]);
    body.position.y = b.h / 2; body.castShadow = true; body.receiveShadow = true; grp.add(body);
    const fr = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.h), front); fr.position.set(0, b.h / 2, d / 2 + 0.02); fr.receiveShadow = true; grp.add(fr);
    // details in the merger, in the building's frame
    mg.at(b.x, zc, b.face > 0 ? 0 : Math.PI);
    const trimC = 0xe2dccb;
    mg.add(boxGeo(b.w + 0.3, 0.45, 0.4), "plain", M(0, b.h - 0.2, d / 2 + 0.15), trimC);              // cornice
    mg.add(boxGeo(b.w + 0.1, 0.12, 0.25), "plain", M(0, b.h - 0.48, d / 2 + 0.1), trimC, false);
    for (const [w, dd, x, z] of [[b.w, 0.25, 0, -d / 2 + 0.12], [0.25, d, -b.w / 2 + 0.12, 0], [0.25, d, b.w / 2 - 0.12, 0]]) mg.add(boxGeo(w, 0.7, dd), "brick", M(x, b.h + 0.35, z), 0xffffff);   // parapet
    const nU = 1 + Math.floor(RB() * 3);
    for (let i = 0; i < nU; i++) { const ux = (RB() - 0.5) * (b.w - 3), uz = (RB() - 0.5) * (d - 3); mg.add(boxGeo(1.6, 1.0, 1.2), "metal", M(ux, b.h + 0.5, uz), 0xbfc2c4); mg.add(cylGeo(0.35, 0.35, 0.05, 14), "plain", M(ux, b.h + 1.02, uz), 0x2a2c2e, false); }
    mg.add(cylGeo(0.08, 0.08, 1.2, 6), "metal", M((RB() - 0.5) * b.w * 0.6, b.h + 0.6, -d / 4), 0x8a8c8e, false);
    shopFront(b, d, grp, RB);
    // wall lamps either side of the door
    for (const sx of [-1, 1]) mg.add(boxGeo(0.18, 0.3, 0.16), "lamp", M(sx * 0.95, 2.6, d / 2 + 0.1), 0xffffff, false);
    const frontZ = zc + b.face * (d / 2);
    W.boxes.push({ x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: zc - d / 2, z1: zc + d / 2 });
    W.bld[b.id] = { x: b.x, z: frontZ, face: b.face, stand: { x: b.x + 1.2, z: frontZ + b.face * 2.6 }, door: { x: b.x, z: frontZ + b.face * 1.0 }, w: b.w, name: b.name };
  }
  W.poi = { mentor: { ...W.bld.mentor.stand, yaw: 0 }, lender: { ...W.bld.lender.stand, yaw: 0 }, agent: { ...W.bld.agent.stand, yaw: 0 }, home: { ...W.bld.home.stand, yaw: Math.PI } };
  // downtown sidewalk furniture: parking meters, benches, bins, hydrants, street trees in grates
  mg.at(0, 0, 0);
  // Nothing goes in front of a door / where a key person stands (stand = door x + 1.2, the rival 3 m past the coffee
  // shop), nor past the cross streets.
  const RF = rnd(7027);
  const free = (x, sd, pad = 0) => Math.abs(x) <= 72 - pad && !BUILDINGS.some((b) => b.face === -sd && Math.abs(x - (b.x + (b.id === "coffee" ? 2.6 : 0.6))) < (b.id === "coffee" ? 4.6 : 3.2) + pad);
  for (const sd of [-1, 1]) {
    for (let x = -72; x <= 72; x += 6) {
      if (!free(x, sd)) continue;
      cellAt(x, sd * 5.6);
      if (RF() < 0.8) { mg.add(cylGeo(0.035, 0.035, 1.1, 6), "metal", M(x, 0.55, sd * 5.45), 0x3a3c3e, false); mg.add(boxGeo(0.18, 0.3, 0.14), "metal", M(x, 1.25, sd * 5.45), 0x6a6c70, false); }
    }
    for (let x = -70; x <= 70; x += 7) {
      if (!free(x, sd, 0.8)) continue;
      const k = Math.round((x + 70) / 7) % 3;
      cellAt(x, sd * 5.8);
      if (k === 0) {
        mg.add(boxGeo(1.3, 0.02, 1.3), "metal", M(x, 0.15, sd * 5.8), 0x2a2a2a, false);
        const v = Math.floor(RF() * 4);
        addFlora(mg, floraParts("st" + v, () => yardTree(500 + v * 17, "elm")), x, sd * 5.8, RF() * 6.28, 0.8);
        W.circles.push({ x, z: sd * 5.8, r: 0.35 });
      } else if (k === 1) {
        mg.add(boxGeo(1.8, 0.06, 0.45), "plain", M(x, 0.46, sd * 7.0), 0x5a4030); mg.add(boxGeo(1.8, 0.4, 0.05), "plain", M(x, 0.72, sd * 7.25), 0x5a4030); for (const ex of [-0.8, 0.8]) mg.add(boxGeo(0.06, 0.46, 0.45), "metal", M(x + ex, 0.23, sd * 7.0), 0x222222, false);
        W.boxes.push({ x0: x - 0.9, x1: x + 0.9, z0: sd * 7.0 - 0.3, z1: sd * 7.0 + 0.3 });
      } else {
        mg.add(cylGeo(0.3, 0.27, 0.9, 12), "metal", M(x, 0.45, sd * 5.5), 0x2c3a30);
        W.circles.push({ x, z: sd * 5.5, r: 0.3 });
      }
    }
    for (const x of [-40, 26, 64]) { const hx = x + sd * 3; if (!free(hx, sd)) continue; hydrant(mg, hx, sd * 5.4); W.circles.push({ x: hx, z: sd * 5.4, r: 0.25 }); }
  }

  // ---- parking lots + parks on the side streets between x -75..75
  const parking = (x, z, w, d, ncars, seed) => {
    const R = rnd(seed);
    cellAt(x, z); mg.at(0, 0, 0); cellAt(x, z);
    mg.add(planeGeo(w, d), "road", M(x, 0.03, z), 0xd8d8d8, false);
    const n = Math.floor(w / 3.2);
    for (let i = 0; i <= n; i++) mg.add(planeGeo(0.12, 5.0), "paint", M(x - w / 2 + i * 3.2, 0.04, z - d / 2 + 2.6), 0xdedcd4, false);
    for (let i = 0; i < n; i++) mg.add(boxGeo(1.6, 0.12, 0.2), "conc", M(x - w / 2 + 1.6 + i * 3.2, 0.06, z - d / 2 + 0.7), 0xcac6bc, false);   // wheel stops
    for (let i = 0; i < 4; i++) mg.add(planeGeo(1.4, 1.0), "oil", M(x - w / 2 + 1.6 + Math.floor(R() * n) * 3.2, 0.035, z - d / 2 + 2.4, R() * 3), 0xffffff, false);
    mg.add(cylGeo(0.1, 0.14, 8, 8), "metal", M(x, 4, z + d / 2 - 1), 0x4a4c4e); mg.add(boxGeo(2.4, 0.1, 0.2), "metal", M(x, 8, z + d / 2 - 1), 0x4a4c4e); for (const ex of [-1.1, 1.1]) mg.add(boxGeo(0.6, 0.12, 0.35), "lamp", M(x + ex, 7.9, z + d / 2 - 1), 0xffffff, false);
    W.lamps.push({ x, z: z + d / 2 - 1 });
    const cols = [0xd8d8dc, 0x2b2f38, 0x9a2a2a, 0x3a5a8a, 0xc8c0a8, 0x5b6a5e];
    for (let i = 0; i < ncars; i++) { const s = Math.floor(R() * n); if (R() < 0.65) car(mg, x - w / 2 + 1.6 + s * 3.2, z - d / 2 + 2.6, Math.PI / 2 + (R() < 0.5 ? 0 : Math.PI), cols[(i + s) % 6], false); }
  };
  parking(-40, -43.5, 70, 14, 8, 811);
  parking(30, -43.5, 70, 14, 7, 812);
  parking(-30, 43.5, 60, 14, 6, 813);
  parking(-40, 80.5, 60, 14, 4, 814);
  // park north of the s1 street: grass, a looping path, shade trees, benches
  mg.at(0, 0, 0); cellAt(0, -80);
  const RP = rnd(7039);
  mg.add(planeGeo(150, 22), "grass", M(0, 0.035, -80.5), 0x78a050, false);
  mg.add(planeGeo(140, 1.8), "drive", M(0, 0.04, -78), 0xffffff, false);
  for (let i = 0; i < 16; i++) {
    const x = -68 + i * 9.2 + (i % 2) * 2, z = -80 + ((i * 7) % 11) - 5 + (Math.abs(-80 + ((i * 7) % 11) - 5 + 78) < 2 ? 3 : 0);
    cellAt(x, z); const v = i % 6;
    addFlora(mg, floraParts("park" + v, () => yardTree(300 + v * 23, i % 3 ? "pecan" : "elm")), x, z, RP() * 6.28, 1.15 + RP() * 0.3);
    W.circles.push({ x, z, r: 0.45 });
  }
  for (let i = 0; i < 4; i++) { const bx = -30 + i * 20; cellAt(bx, -76); mg.add(boxGeo(1.8, 0.06, 0.45), "plain", M(bx, 0.46, -76.6), 0x6a4a2a); mg.add(boxGeo(1.8, 0.4, 0.05), "plain", M(bx, 0.72, -76.85), 0x6a4a2a); for (const ex of [-0.8, 0.8]) mg.add(boxGeo(0.06, 0.46, 0.45), "metal", M(bx + ex, 0.23, -76.6), 0x222222, false); }
  cellAt(40, 80);
  mg.add(planeGeo(60, 22), "grass", M(40, 0.035, 80.5), 0x78a050, false);
  for (let i = 0; i < 9; i++) { const x = 12 + i * 7, z = 78 + (i % 3) * 3; cellAt(x, z); const v = i % 6; addFlora(mg, floraParts("park" + v, () => yardTree(300 + v * 23, i % 3 ? "pecan" : "elm")), x, z, RP() * 6.28, 1.1); W.circles.push({ x, z, r: 0.45 }); }
  for (let i = 0; i < 6; i++) { const x = 14 + i * 9; cellAt(x, 72); addFlora(mg, floraParts("bush" + (i % 4), () => bush((i % 4) * 31 + 5, 0.6)), x, 71.5, i, 1.3); }

  // ---- construction site (south of Main, east of downtown): a framed house on a slab, sheathing going on, workers,
  // dumpster, lumber, porta-john, silt fence
  const SITE = { x: 40, z: 43.5 };
  W.site = SITE;
  mg.at(SITE.x, SITE.z, 0); mg.cell = [Math.floor(SITE.x / 60), Math.floor(SITE.z / 60)];
  mg.add(planeGeo(30, 18), "dirt", M(0, 0.035, 0), 0xffffff, false);
  const wood = 0xd2b07a;
  mg.box(10, 0.25, 6.2, 0, 0.0, 0, "conc", 0xd0ccc2);
  for (let ix = -5; ix <= 5.01; ix += 0.4) for (const z of [-3, 3]) mg.box(0.05, 2.7, 0.1, ix, 0.25, z, "plain", wood);
  for (let iz = -3; iz <= 3.01; iz += 0.4) for (const x of [-5, 5]) mg.box(0.1, 2.7, 0.05, x, 0.25, iz, "plain", wood);
  for (const z of [-3, 3]) { mg.box(10.2, 0.1, 0.12, 0, 0.25, z, "plain", wood); mg.box(10.2, 0.1, 0.12, 0, 2.95, z, "plain", wood); }
  for (const x of [-5, 5]) { mg.box(0.12, 0.1, 6.2, x, 0.25, 0, "plain", wood); mg.box(0.12, 0.1, 6.2, x, 2.95, 0, "plain", wood); }
  for (let ix = -5; ix <= 5; ix += 0.6) mg.box(0.05, 0.24, 6.2, ix, 3.05, 0, "plain", wood);   // ceiling joists
  mg.add(boxGeo(4.8, 2.4, 0.03), "ply", M(-2.4, 1.45, -3.08), 0xffffff); mg.add(boxGeo(0.03, 2.4, 3.6), "ply", M(-5.08, 1.45, -1.2), 0xffffff);   // OSB sheathing on two walls
  mg.box(5.8, 1.5, 2.4, -11, 0, 5.5, "metal", 0x2c6e3f); mg.box(5.8, 0.1, 2.4, -11, 1.5, 5.5, "metal", 0x1f4d2c);   // dumpster
  for (let i = 0; i < 5; i++) mg.box(3.6, 0.3, 1.1, 10, i * 0.3, -5.5, "plain", 0xc8a46a);          // lumber stack
  mg.box(1.2, 0.15, 1.2, 12.5, 0, 5, "plain", 0x8a6a4a); mg.box(1.1, 0.9, 1.1, 12.5, 0.15, 5, "plain", 0xd8d4c8);   // pallet of sacks
  mg.box(1.2, 2.3, 1.2, 13, 0, -1, "metal", 0x2a5aa8); mg.box(1.25, 0.08, 1.25, 13, 2.3, -1, "metal", 0xe8e8e8);  // porta-john
  mg.box(0.12, 1.4, 0.12, -14, 0, 8.9, "plain", 0x666666); mg.add(boxGeo(2.4, 1.2, 0.06), "plain", M(-14, 1.5, 8.9), 0xf0a21a, false);
  for (let x = -14; x <= 14; x += 2) mg.add(boxGeo(2, 0.6, 0.02), "bag", M(x + 1, 0.3, 8.8), 0xffffff, false);   // silt fence
  for (let x = -14; x <= 14; x += 3) mg.box(0.08, 1.8, 0.08, x, 0, -8.8, "metal", 0x9a9ea2), mg.add(boxGeo(3, 1.8, 0.02, 0.8), "chain", M(x + 1.5, 0.9, -8.8), 0xffffff, false);
  W.boxes.push({ x0: SITE.x - 5.4, x1: SITE.x + 5.4, z0: SITE.z - 3.4, z1: SITE.z + 3.4 }, { x0: SITE.x - 14, x1: SITE.x - 8, z0: SITE.z + 4.2, z1: SITE.z + 6.8 }, { x0: SITE.x + 12.3, x1: SITE.x + 13.7, z0: SITE.z - 1.7, z1: SITE.z - 0.3 });

  // ---- street lights: decorative posts downtown, cobra heads on the power poles in the neighbourhoods
  mg.at(0, 0, 0);
  const lampHead = (x, y, z, armDir) => {   // armDir: +1 head toward +z
    mg.add(boxGeo(0.08, 0.08, 1.8), "metal", M(x, y, z + armDir * 0.9, 0, 1, 1, 1, -armDir * 0.08), 0x6a6c6e, false);
    mg.add(boxGeo(0.34, 0.16, 0.7), "metal", M(x, y - 0.05, z + armDir * 1.85), 0x8a8c8e, false);
    mg.add(boxGeo(0.28, 0.04, 0.55), "lamp", M(x, y - 0.14, z + armDir * 1.85), 0xffffff, false);
    W.lamps.push({ x, z: z + armDir * 1.85 });
  };
  for (const zc of [0]) for (let x = -72; x <= 72; x += 18) for (const sd of [-1, 1]) {
    let lx = x + (sd > 0 ? 9 : 0); const lz = zc + sd * 5.35;
    if (!free(lx, sd)) lx += 3.5;
    if (!free(lx, sd)) continue;
    cellAt(lx, lz);
    mg.add(cylGeo(0.07, 0.12, 4.6, 8), "metal", M(lx, 2.3, lz), 0x1c1e20);
    mg.add(cylGeo(0.18, 0.2, 0.5, 10), "metal", M(lx, 0.25, lz), 0x1c1e20, false);
    mg.add(new THREE.SphereGeometry(0.26, 12, 8), "lamp", M(lx, 4.85, lz), 0xffffff, false);
    mg.add(cylGeo(0.22, 0.12, 0.12, 10), "metal", M(lx, 5.12, lz), 0x1c1e20, false);
    W.lamps.push({ x: lx, z: lz }); W.circles.push({ x: lx, z: lz, r: 0.2 });
  }
  // ---- power poles + lines (residential; one side of each street) and service drops to every house
  const wires = [];
  const sag = (a, b, s, n = 6) => { for (let i = 0; i < n; i++) { const t0 = i / n, t1 = (i + 1) / n; for (const t of [t0, t1]) { wires.push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - Math.sin(Math.PI * t) * s, a.z + (b.z - a.z) * t); } } };
  const poles = [];
  for (const zc of Object.values(STREET_Z)) for (const [xa, xb] of [[-226, -92], [92, 226]]) {
    const pz = zc - 7.25, row = [];
    for (let x = xa; x <= xb + 0.1; x += 33.5) {
      cellAt(x, pz);
      mg.add(cylGeo(0.12, 0.17, 9.5, 7), "pole", M(x, 4.75, pz), 0xffffff);
      mg.add(boxGeo(2.4, 0.12, 0.12), "pole", M(x, 8.6, pz), 0xffffff, false);
      for (const ox of [-1.0, 0, 1.0]) mg.add(cylGeo(0.05, 0.06, 0.18, 6), "plain", M(x + ox, 8.75, pz), 0x6a7a6a, false);
      if (row.length % 3 === 1) { mg.add(cylGeo(0.28, 0.28, 0.8, 10), "metal", M(x, 7.4, pz - 0.35), 0x8a8e90); }
      lampHead(x, 6.6, pz, 1);
      W.circles.push({ x, z: pz, r: 0.22 });
      row.push(x);
    }
    poles.push({ zc, pz, row });
    for (let i = 0; i < row.length - 1; i++) {
      for (const ox of [-1.0, 0, 1.0]) sag({ x: row[i] + ox, y: 8.82, z: pz }, { x: row[i + 1] + ox, y: 8.82, z: pz }, 0.7);
      sag({ x: row[i], y: 6.9, z: pz + 0.15 }, { x: row[i + 1], y: 6.9, z: pz + 0.15 }, 0.9);   // phone / cable line
    }
  }
  for (const l of lots) {
    const pl = W.place[l.id], zc = STREET_Z[l.row], pr = poles.find((p) => p.zc === zc && ((l.x < 0) === (p.row[0] < 0)));
    if (!pr || !pl.eave) continue;
    if (P[l.id].absentee && P[l.id].cond > 0.75) continue;   // power cut to the worst vacant houses
    const px = pr.row.reduce((a, b) => (Math.abs(b - pl.eave.x) < Math.abs(a - pl.eave.x) ? b : a));
    sag({ x: px, y: 7.0, z: pr.pz + 0.15 }, { x: pl.eave.x, y: pl.eave.y, z: pl.eave.z }, 0.6, 8);
  }
  const wg = new THREE.BufferGeometry(); wg.setAttribute("position", new THREE.Float32BufferAttribute(wires, 3));
  const wl = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x141414 })); wl.frustumCulled = false; W.group.add(wl);
  W.mats.pole = std({ map: concrete("#6a5444", 61), roughness: 1 });
  // light pools on the ground under every lamp (additive, faded in at night)
  for (const L of W.lamps) { cellAt(L.x, L.z); mg.add(planeGeo(11, 11), "pool", M(L.x, 0.16, L.z), 0xffffff, false); }

  // ---- grime: puddles in the gutters, oil where cars park, litter (more of it in the Flats and downtown)
  const RG = rnd(7057);
  for (const zc of Object.values(STREET_Z)) for (let i = 0; i < 16; i++) {
    const x = -228 + RG() * 456, sd = RG() < 0.5 ? -1 : 1, s = 0.8 + RG() * 1.8;
    cellAt(x, zc);
    mg.add(planeGeo(s * 2, s), "puddle", M(x, 0.032, zc + sd * (4.5 - RG() * 0.5), RG() * 0.4), 0xffffff, false);
    if (RG() < 0.7) mg.add(planeGeo(1.6, 1.1), "oil", M(-228 + RG() * 456, 0.031, zc + sd * 3.1, RG() * 3), 0xffffff, false);
    if (RG() < 0.6) mg.add(planeGeo(1.2, 0.8), "oil", M(-228 + RG() * 456, 0.031, zc + (RG() - 0.5) * 3, RG() * 3), 0xffffff, false);
  }
  const litterCols = [0xb02020, 0xa8acb0, 0xd8d2c2, 0x8a6a44, 0xe8e4dc, 0x2a6a3a];
  for (let i = 0; i < 140; i++) {
    const zc = Object.values(STREET_Z)[i % 3], x = RG() < 0.45 ? -228 + RG() * 140 : RG() < 0.6 ? -75 + RG() * 150 : -228 + RG() * 456;
    const sd = RG() < 0.5 ? -1 : 1, z = zc + sd * (RG() < 0.6 ? 4.6 + RG() * 0.3 : 5.4 + RG() * 2), c = litterCols[Math.floor(RG() * litterCols.length)];
    cellAt(x, z);
    const y = Math.abs(z - zc) > 5.05 ? 0.15 : 0.035;
    if (c === 0xb02020 || c === 0xa8acb0 || c === 0x2a6a3a) mg.add(cylGeo(0.035, 0.035, 0.12, 8), "metal", M(x, y + 0.035, z, RG() * 3, 1, 1, 1, Math.PI / 2), c, false);
    else mg.add(boxGeo(0.12 + RG() * 0.15, 0.01, 0.1 + RG() * 0.1), "plain", M(x, y + 0.005, z, RG() * 3), c, false);
  }

  // ---- curb parked cars (Meshy, placed by main.js)
  const ccol = [0xd8d8dc, 0x2b2f38, 0x9a2a2a, 0x3a5a8a, 0x5b6a5e, 0xc8c0a8, 0x7a7f86, 0x8a5a2a];
  let ci = 0;
  for (const zc of Object.values(STREET_Z)) for (let x = -215; x <= 215; x += 21 + (ci % 3) * 4) {
    if (Math.abs(x) < 78 && zc === 0) continue;
    if (Math.abs(Math.abs(x) - 80) < 8) continue;
    ci++;
    if ((ci * 37) % 5 < 2) continue;
    const side = (ci % 2) ? 1 : -1;
    car(mg, x, zc + side * 3.1, side > 0 ? 0 : Math.PI, ccol[ci % ccol.length], false);
    W.boxes.push({ x0: x - 2.4, x1: x + 2.4, z0: zc + side * 3.1 - 1, z1: zc + side * 3.1 + 1 });
  }
  // ---- showcase cars (2026-11-24, user: Maybach, Cullinan, Corvette): the money in town parks on Main. The mentor's
  // Cullinan-style SUV outside Ironwood, the lender's Maybach-style limo outside Cobblestone Bridge, the rival's red
  // Corvette-style coupe outside the coffee shop. Curb row sits at +-3.65 so they clear the traffic lanes (+-1.8).
  for (const [id, x, side] of [["royalsuv", -67, -1], ["luxsedan", 11, -1], ["sportscar", 2.5, 1]]) {
    W.parked.push({ x, z: side * 3.65, ry: side > 0 ? 0 : Math.PI, model: id });   // (main.js placeParked adds the collision box)
  }
  // ---- the edge of town: a ring of trees, and beyond the haze a small-town skyline (water tower, grain elevator,
  // church steeple, a few warehouses and the county building)
  const r0 = (i) => ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
  for (let i = 0; i < 160; i++) {
    const t = i / 160, a = t * Math.PI * 2;
    const x = Math.cos(a) * 262 + (r0(i) - 0.5) * 10, z = Math.sin(a) * 138 + (r0(i + 400) - 0.5) * 10;
    cellAt(x, z); const v = i % 6;
    addFlora(mg, floraParts("far" + v, () => farTree(900 + v * 11)), x, z, r0(i + 9) * 6.28, 1.0 + r0(i + 9) * 0.6, 0xffffff);
    W.circles.push({ x, z, r: 0.7 });
  }
  const skyMats = [facade("concrete", "#8a8780", 3), facade("brick", "#7a4b3b", 5), facade("siding", "#9aa0a3", 7)].map((f) => { const m = new THREE.MeshStandardMaterial({ map: f.map, emissive: 0xffffff, emissiveMap: f.emissive, emissiveIntensity: 0, roughness: 0.9 }); W.nightMats.push(m); return m; });
  W.mats.sky0 = skyMats[0]; W.mats.sky1 = skyMats[1]; W.mats.sky2 = skyMats[2];
  for (let i = 0; i < 18; i++) {
    const x = -300 + i * 36 + r0(i + 700) * 14, z = (i % 2 ? -1 : 1) * (158 + r0(i + 800) * 22), h = 6 + r0(i + 900) * (i % 5 === 0 ? 22 : 9);
    cellAt(x, z);
    mg.add(boxGeo(14 + r0(i) * 12, h, 12, 3.5), "sky" + (i % 3), M(x, h / 2, z), 0xffffff);
    mg.add(boxGeo(14.4 + r0(i) * 12, 0.5, 12.4), "plain", M(x, h + 0.25, z), 0x5a5a5c, false);
  }
  { // water tower
    const x = -150, z = -175; cellAt(x, z);
    for (const [ox, oz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) mg.add(cylGeo(0.25, 0.3, 22, 6), "metal", M(x + ox * 0.8, 11, z + oz * 0.8, 0, 1, 1, 1, oz * 0.025, -ox * 0.025), 0xb8bcc0);
    mg.add(new THREE.SphereGeometry(6, 20, 12), "tank", M(x, 25, z, 0, 1, 0.75, 1), 0xffffff);
    mg.add(cylGeo(6, 6, 2.5, 20), "tank", M(x, 25, z), 0xffffff);
    W.mats.tank = new THREE.MeshStandardMaterial({ map: canvasTex(1024, 256, (g, w, h) => { g.fillStyle = "#d8dcde"; g.fillRect(0, 0, w, h); g.fillStyle = "#2a4a6a"; g.font = "900 120px Georgia, serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("PECAN HOLLOW", w / 4, h / 2, w / 2 - 20); g.fillText("PECAN HOLLOW", w * 3 / 4, h / 2, w / 2 - 20); for (let i = 0; i < 40; i++) { g.fillStyle = "rgba(120,80,40,0.15)"; g.fillRect(Math.random() * w, h * 0.6, 3, 40 + Math.random() * 80); } }), roughness: 0.6, metalness: 0.3 });
  }
  { // grain elevator: three concrete silos and a head house
    const x = 175, z = 182; cellAt(x, z);
    for (let i = 0; i < 3; i++) mg.add(cylGeo(4, 4, 30, 20), "conc", M(x + i * 8, 15, z), 0xd8d2c4);
    mg.add(boxGeo(7, 8, 7), "conc", M(x + 8, 34, z), 0xc8c2b4);
  }
  { // church steeple
    const x = 40, z = -190; cellAt(x, z);
    mg.add(boxGeo(10, 9, 18), "wall", M(x, 4.5, z), 0xf0ece0);
    mg.add(boxGeo(4, 14, 4), "wall", M(x, 7, z + 9), 0xf0ece0);
    mg.add(new THREE.ConeGeometry(2.6, 9, 4), "roof", M(x, 18.5, z + 9, Math.PI / 4), 0x4a4a50);
  }
  W.group.add(mg.build(W.mats));

  // ---- the sky: a gradient dome around the camera with a sun disc and glow
  const skyU = { top: { value: new THREE.Color(0x5d8fc9) }, horizon: { value: new THREE.Color(0xc9d6dc) }, ground: { value: new THREE.Color(0x8a8a80) }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(0xffffff) }, sunAmt: { value: 1 } };
  const skyM = new THREE.ShaderMaterial({
    uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; gl_Position.z = p.w * 0.99999; }",
    fragmentShader: "uniform vec3 top, horizon, ground, sunDir, sunCol; uniform float sunAmt; varying vec3 vDir;\n" +
      "void main(){ vec3 d = normalize(vDir); float h = d.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.5)) : mix(horizon, ground, clamp(-h * 6.0, 0.0, 1.0));\n" +
      " float s = max(dot(d, normalize(sunDir)), 0.0); c += sunCol * sunAmt * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.22 + pow(s, 3.0) * 0.06);\n" +
      " gl_FragColor = vec4(c, 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}"
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyM);
  sky.frustumCulled = false; sky.renderOrder = -10;
  sky.onBeforeRender = (r, sc, cam) => { sky.position.copy(cam.position); sky.updateMatrixWorld(); };
  W.group.add(sky); W.sky = sky;
  // Called by main's updateSky: sky colours, the sun in the dome, lamp pools.
  W.setTime = (k, sunPos, sunTarget, sunColor) => {
    skyU.top.value.copy(k.sky); skyU.horizon.value.copy(k.fog);
    skyU.ground.value.copy(k.fog).multiplyScalar(0.75);
    if (sunPos) skyU.sunDir.value.copy(sunPos).sub(sunTarget).normalize();
    if (sunColor) skyU.sunCol.value.copy(sunColor);
    skyU.sunAmt.value = Math.min(1, k.sun / 1.2);
    lampPoolM.opacity = k.night * 0.75;
  };
  return W;
}

function hydrant(mg, x, z) {
  mg.add(cylGeo(0.13, 0.15, 0.6, 10), "metal", M(x, 0.45, z), 0xc8a020);
  mg.add(new THREE.SphereGeometry(0.14, 10, 6), "metal", M(x, 0.75, z), 0xc8a020, false);
  mg.add(cylGeo(0.05, 0.05, 0.42, 8), "metal", M(x, 0.55, z, 0, 1, 1, 1, Math.PI / 2), 0xc8a020, false);
}
// shared flora part cache with houses.js (same keys never collide: different prefixes)
const fcache = new Map();
function floraParts(key, make) { let p = fcache.get(key); if (!p) { p = make(); fcache.set(key, p); } return p; }

// ---------------------------------------------------------------- collisions: push a circle out of every box / circle
export function collide(W, p, r) {
  for (const b of W.boxes) {
    if (p.x + r < b.x0 || p.x - r > b.x1 || p.z + r < b.z0 || p.z - r > b.z1) continue;
    const cx = Math.max(b.x0, Math.min(p.x, b.x1)), cz = Math.max(b.z0, Math.min(p.z, b.z1));
    let dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 < 1e-6) { // centre inside the box: shove out the shortest way
      const l = p.x - b.x0, rr = b.x1 - p.x, t = p.z - b.z0, bb = b.z1 - p.z, m = Math.min(l, rr, t, bb);
      if (m === l) p.x = b.x0 - r; else if (m === rr) p.x = b.x1 + r; else if (m === t) p.z = b.z0 - r; else p.z = b.z1 + r;
    } else { const d = Math.sqrt(d2); p.x = cx + dx / d * r; p.z = cz + dz / d * r; }
  }
  for (const c of W.circles) {
    const dx = p.x - c.x, dz = p.z - c.z, rr = r + c.r;
    if (Math.abs(dx) > rr || Math.abs(dz) > rr) continue;
    const d2 = dx * dx + dz * dz;
    if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); p.x = c.x + dx / d * rr; p.z = c.z + dz / d * rr; }
  }
  p.x = Math.max(-EDGE.x + 2, Math.min(EDGE.x - 2, p.x)); p.z = Math.max(-EDGE.z + 2, Math.min(EDGE.z - 2, p.z));
}

// ---------------------------------------------------------------- time of day
// [hour, sky (zenith), fog = horizon, sun intensity, ambient intensity, night 0..1]. 2026-11-08: hazier, less
// saturated blues (a real Texas sky washes out toward the horizon), deeper night.
const KEYS = [
  [4, 0x060a1c, 0x101830, 0.0, 0.35, 1], [6, 0x4a4a6e, 0x9a8a8e, 0.35, 0.4, 0.8], [7, 0x8a8aa8, 0xe8c0a0, 1.6, 0.7, 0.3], [9, 0x6a98cc, 0xd2dce0, 2.0, 0.8, 0],
  [13, 0x5a8cc8, 0xc8d6de, 2.3, 0.9, 0], [17, 0x6894c6, 0xd6dcdc, 1.9, 0.85, 0], [19, 0x7a7aa0, 0xeab088, 1.1, 0.6, 0.2], [20.3, 0x2e2e52, 0x7a5a6e, 0.35, 0.4, 0.7],
  [22, 0x070b1e, 0x121a34, 0.0, 0.35, 1], [28, 0x060a1c, 0x101830, 0.0, 0.35, 1]
];
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
export function skyAt(min) {
  let h = min / 60; if (h < 4) h += 24;
  let i = 0; while (i < KEYS.length - 2 && h > KEYS[i + 1][0]) i++;
  const a = KEYS[i], b = KEYS[i + 1], t = Math.max(0, Math.min(1, (h - a[0]) / (b[0] - a[0])));
  return { sky: _c1.set(a[1]).lerp(_c2.set(b[1]), t).clone(), fog: new THREE.Color(a[2]).lerp(new THREE.Color(b[2]), t), sun: a[3] + (b[3] - a[3]) * t, amb: a[4] + (b[4] - a[4]) * t, night: a[5] + (b[5] - a[5]) * t, hour: h };
}
