// Procedural houses, drawn in code. The look of a house IS the clue: a house's distress signs (game.js props) become
// overgrown yards, boards, tarps, junk, notices. Local frame: origin = lot centre on the ground, +z = toward the street,
// lot is 20 wide (x) and 22 deep (z, front edge at z = +11).
//
// 2026-11-08 realism pass (user: "it looks very cartoonish", "more realistic, like Run It Up"): textured siding,
// shingles with algae streaks, sided gable walls, fascia + gutters + downspouts, porch steps and lights, shutters and
// sills, sectional garage doors, concrete drives with joints, cedar privacy / chain-link fences, Run It Up's flora build
// for trees and shrubs, weed clumps instead of cones, AC units, meters, dishes. Cars in drives are the Meshy cars
// (pushed to mg.parked; world.js / main.js place them), never boxes.
import * as THREE from "three";
import { boxGeo, gableGeo, gableEndGeo, shedGeo, cylGeo, planeGeo, M } from "./kit3d.js";
import { yardTree, bush, tuft } from "./flora.js";
import { rng } from "./game.js";

const WALLS = {
  flats: [0xc9b79a, 0xa9bcc4, 0xb98a7a, 0xd7d0b8, 0x8fa88d, 0x9a8c7e, 0xc4a77d, 0x93a3b5],
  heights: [0xeae4d3, 0xc3cbd3, 0x8e9aab, 0xdccfb6, 0x84967f, 0xcdad8d, 0xf0ece0, 0xa9b8c4]
};
const ROOFS = [0x6a6a70, 0x7b6a60, 0x5d6a72, 0x8b5b4e, 0x4f5458, 0x75706a];
const DOORS = [0x7a1f1f, 0x1f3f6b, 0x2b2b2b, 0x3f5a3a, 0xe8e2d0, 0x6a4a2a];
const SHUTTERS = [0x2b2f33, 0x1f3a2a, 0x3a2a22, 0x2a3a52, 0xe8e4d8];
const GREY = new THREE.Color(0x6f675b);
const tint = (hex, toward, k) => new THREE.Color(hex).lerp(toward, k).getHex();

export function lawnColor(P) {
  const bad = P.signs.includes("overgrown");
  return bad ? new THREE.Color(0x9aa25a).lerp(new THREE.Color(0xb09a62), 0.4 + P.cond * 0.4).getHex() : new THREE.Color(P.district === "heights" ? 0x6aa055 : 0x7d9a58).lerp(new THREE.Color(0xa8a070), P.cond * 0.6).getHex();
}

// Flora parts are built once per (kind, variant) and reused by every lot: the merger copies them anyway.
const floraCache = new Map();
function floraParts(key, make) { let p = floraCache.get(key); if (!p) { p = make(); floraCache.set(key, p); } return p; }
export function addFlora(mg, built, x, z, ry = 0, s = 1, leafTint = 0xffffff) {
  for (const p of built.parts) {
    const leaf = p.k === "leafcard" || p.k === "tuft";
    mg.add(p.geo, "fl-" + p.k, M(x, 0, z, ry, s, s, s), p.k === "bark" ? 0xffffff : leafTint, !leaf);
  }
}

// Adds one house (and its yard, fence, trees, props) to the merger, which must already be `.at()` the lot.
// plateUv: [u0, v0, u1, v1] of this house's number in the plate atlas.
export function addHouse(mg, P, plateUv) {
  const r = rng(P.seedv), rich = P.district === "heights", cond = P.cond;
  const two = rich && P.style >= 2;
  const W = rich ? 11 + r() * 2 : 8.6 + r() * 2, D = rich ? 10 + r() * 1.5 : 7.4 + r() * 1.2;
  const H = two ? 5.4 : 2.8 + (rich ? 0.3 : 0);
  const zF = rich ? 4.6 : 5.0, zC = zF - D / 2;
  const palette = WALLS[P.district];
  let wall = palette[Math.floor(P.hue * palette.length) % palette.length];
  wall = new THREE.Color(wall).multiplyScalar(1.12).getHex();
  if (cond > 0.4) wall = tint(wall, GREY, Math.min(0.32, (cond - 0.3) * 0.5));
  const roofCol = tint(ROOFS[Math.floor(P.roofHue * ROOFS.length) % ROOFS.length], new THREE.Color(0x7a6e55), Math.min(0.45, cond * 0.55));
  const trim = tint(0xf2efe6, GREY, cond * 0.6);
  const doorCol = DOORS[(P.seedv >> 3) % DOORS.length];
  const hasSign = (k) => P.signs.includes(k);
  const brickFront = rich ? r() < 0.45 : r() < 0.18;   // a brick wainscot / full brick front (very Texas)

  // ---- lot: lawn (world-UV grass, tinted per lot)
  mg.add(planeGeo(20, 22), "grass", M(0, 0.03, 0), lawnColor(P), false);
  // ---- foundation + body
  mg.box(W + 0.2, 0.32, D + 0.2, 0, 0, zC, "conc", 0xbcb6aa);
  mg.add(boxGeo(W, H, D), "wall", M(0, 0.3 + H / 2, zC), wall);
  if (brickFront) mg.add(boxGeo(W + 0.06, two ? 2.6 : 1.0, D + 0.06), "brick", M(0, 0.3 + (two ? 1.3 : 0.5), zC), rich ? 0xffffff : 0xd8c8c0);
  if (two) mg.box(W + 0.12, 0.18, D + 0.12, 0, 2.9, zC, "plain", trim);
  // roof: style 1 faces the gable to the street. Slopes shingled, gable walls sided, fascia + gutters on the eaves.
  const rh = rich ? 2.0 + r() * 0.5 : 1.55 + r() * 0.4, ov = 0.42;
  const side = P.style === 1 && !rich;
  const ry = side ? Math.PI / 2 : 0, rw = side ? D : W, rd = side ? W : D;
  mg.add(gableGeo(rw, rd, rh, ov, 1.2, false), "roof", M(0, 0.3 + H, zC, ry), roofCol);
  mg.add(gableEndGeo(rw, rd, rh, ov), "wall", M(0, 0.3 + H, zC, ry), wall);
  {
    const gut = cond > 0.6 ? 0x6a665e : 0xeeeeea;
    for (const sz of [-1, 1]) {
      // eave runs along the roof's x; in the house frame that's x (front gable roof) or z (side gable)
      const ex = side ? sz * (rd / 2 + ov) : 0, ez = side ? 0 : sz * (rd / 2 + ov);
      const len = rw + ov * 2;
      mg.add(boxGeo(side ? 0.06 : len, 0.2, side ? len : 0.06), "plain", M(ex, 0.3 + H - 0.1, zC + ez), trim, false);                 // fascia
      if (!(cond > 0.7 && sz > 0)) mg.add(boxGeo(side ? 0.12 : len, 0.12, side ? len : 0.12), "plain", M(ex + (side ? sz * 0.08 : 0), 0.3 + H - 0.14, zC + ez + (side ? 0 : sz * 0.08)), gut, false);   // gutter
    }
    // downspouts at the two front corners
    for (const sx of [-1, 1]) mg.add(boxGeo(0.08, H, 0.08), "plain", M(sx * (W / 2 + 0.06), 0.3 + H / 2, zF - 0.05), gut, false);
    if (cond > 0.65 && r() < 0.6) mg.add(boxGeo(0.08, 1.4, 0.08), "plain", M(W / 2 + 0.35, 0.25, zF + 0.4, 0, 1, 1, 1, 0, 1.3), gut, false);   // one hanging off
  }
  // chimney (brick)
  { const cx = (r() - 0.5) * W * 0.5, cz = zC - D * 0.18;
    mg.add(boxGeo(0.75, 2.2, 0.75), "brick", M(cx, 0.3 + H + 0.75, cz), tint(0xffffff, GREY, cond * 0.4));
    mg.add(boxGeo(0.85, 0.08, 0.85), "conc", M(cx, 0.3 + H + 1.89, cz), 0x8a857c, false); }
  // ---- porch: slab, steps, posts, shed roof, a light by the door
  const px = -W * 0.22, pw = Math.min(4.2, W * 0.46), pd = 2.0;
  mg.box(pw, 0.3, pd, px, 0, zF + pd / 2, "conc", 0xc8c2b6);
  mg.box(1.4, 0.2, 0.35, px, 0, zF + pd + 0.17, "conc", 0xc0bab0);
  mg.box(0.14, H - 0.4, 0.14, px - pw / 2 + 0.12, 0.3, zF + pd - 0.12, "plain", trim);
  mg.box(0.14, H - 0.4, 0.14, px + pw / 2 - 0.12, 0.3, zF + pd - 0.12, "plain", trim);
  mg.add(shedGeo(pw + 0.5, pd + 0.4, 0.45), "roof", M(px, 0.3 + H - 0.5, zF + pd / 2 + 0.1, 0), roofCol);
  mg.add(boxGeo(pw + 0.5, 0.16, 0.05), "plain", M(px, 0.3 + H - 0.55, zF + pd + 0.32), trim, false);
  if (rich) for (const sx of [-1, 1]) { mg.box(0.06, 0.8, pd - 0.3, px + sx * (pw / 2 - 0.12), 0.3, zF + pd / 2 - 0.1, "plain", trim); }
  if (cond > 0.55) mg.box(0.14, 0.5, 0.14, px - pw / 2 + 0.12, 0.3, zF + pd - 0.12, "plain", 0x4a4339);   // a sagging post
  mg.add(boxGeo(0.14, 0.22, 0.1), P.absentee ? "plain" : "lamp", M(px + 0.75, 2.05, zF + 0.08), 0xffffff, false);
  // door + frame + knob + mat
  mg.box(1.0, 2.1, 0.09, px, 0.3, zF + 0.04, "plain", doorCol);
  for (let i = 0; i < 4; i++) mg.add(boxGeo(0.32, i < 2 ? 0.75 : 0.6, 0.03), "plain", M(px + (i % 2 ? 0.2 : -0.2), i < 2 ? 1.75 : 0.85, zF + 0.1), tint(doorCol, new THREE.Color(0), 0.25), false);
  mg.box(1.2, 0.12, 0.12, px, 2.38, zF + 0.06, "plain", trim);
  for (const sx of [-1, 1]) mg.box(0.1, 2.1, 0.1, px + sx * 0.55, 0.3, zF + 0.06, "plain", trim);
  mg.box(0.08, 0.08, 0.1, px + 0.36, 1.3, zF + 0.1, "plain", 0xc8b06a);
  if (!P.absentee) mg.add(boxGeo(0.9, 0.02, 0.55), "plain", M(px, 0.31, zF + 0.4), 0x5a4a3a, false);
  // plate with the house number, over the door
  if (plateUv) {
    const g = new THREE.PlaneGeometry(0.62, 0.3);
    const uv = g.attributes.uv; const [u0, v0, u1, v1] = plateUv;
    uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
    mg.add(g, "plate", M(px + 0.95, 2.0, zF + 0.1), 0xffffff, false);
  }
  // ---- windows (front); a boarded one when the signs say so
  const winY = 1.1 + 0.3, winW = 1.3, winH = 1.15;
  const boardIdx = hasSign("boarded") ? (r() < 0.5 ? 0 : 1) : -1;
  const gkey = (hasSign("boarded") || P.absentee) ? "glass" : "glassLit";
  const shutters = r() < (rich ? 0.6 : 0.35) ? SHUTTERS[(P.seedv >> 7) % SHUTTERS.length] : null;
  const winAC = !rich && r() < 0.35;
  [W * 0.12, W * 0.36].forEach((x, i) => {
    if (x + winW / 2 > W / 2 - 0.2 || Math.abs(x - px) < pw / 2 + 0.6) return;
    window_(mg, x, winY, zF + 0.02, winW, winH, gkey, trim, i === boardIdx, shutters, cond);
    if (two) window_(mg, x, winY + 2.7, zF + 0.02, winW, winH, gkey, trim, false, shutters, cond);
    if (winAC && i === 1 && i !== boardIdx) { mg.add(boxGeo(0.7, 0.45, 0.6), "metal", M(x, winY - 0.35, zF + 0.32), 0xd8d6cc); mg.add(boxGeo(0.6, 0.3, 0.02), "plain", M(x, winY - 0.35, zF + 0.63), 0x55575a, false); }
  });
  if (two) window_(mg, px, winY + 2.7, zF + 0.02, winW, winH, gkey, trim, false, shutters, cond);
  // side windows (both sides, two each)
  for (const sx of [-1, 1]) for (const dz of [-D * 0.2, D * 0.18]) {
    mg.add(boxGeo(0.08, winH, winW), gkey, M(sx * (W / 2 + 0.02), 1.7, zC + dz), 0xffffff, false);
    mg.add(boxGeo(0.1, winH + 0.2, winW + 0.2), "plain", M(sx * (W / 2 + 0.005), 1.7, zC + dz), trim, false);
    if (two) mg.add(boxGeo(0.08, winH, winW), gkey, M(sx * (W / 2 + 0.02), 4.2, zC + dz), 0xffffff, false);
  }
  // utility side: AC condenser on a pad, electric meter, gas meter; a dish on some Flats roofs
  {
    const sx = -1, ax = sx * (W / 2 + 0.75), az = zC - D * 0.1;   // the side away from the garage / drive
    mg.box(1.0, 0.08, 1.0, ax, 0, az, "conc", 0xb8b2a8);
    mg.add(boxGeo(0.8, 0.75, 0.8), "metal", M(ax, 0.08 + 0.375, az), cond > 0.6 ? 0xa8a296 : 0xd6d4cc);
    mg.add(cylGeo(0.3, 0.3, 0.03, 16), "plain", M(ax, 0.85, az), 0x2a2c2e, false);
    mg.add(boxGeo(0.06, 0.3, 0.22), "metal", M(sx * (W / 2 + 0.04), 1.5, zC + D * 0.25), 0xb8bcc0, false);
    if (!rich && r() < 0.4) { mg.add(cylGeo(0.03, 0.03, 0.5, 5), "metal", M(-W * 0.3, 0.3 + H + rh * 0.4, zC - D * 0.2), 0xcccccc, false); mg.add(cylGeo(0.32, 0.05, 0.12, 14), "metal", M(-W * 0.3, 0.3 + H + rh * 0.4 + 0.3, zC - D * 0.2 + 0.05, 0, 1, 1, 1, 1.1), 0xe8e8e4, false); }
  }
  // ---- garage + drive (Heights always; the Flats sometimes)
  const garage = rich || P.style === 3;
  const gx = W / 2 + 1.6;
  const gz = zC + 0.4 - (rich ? 0.0 : 0.6);
  if (garage && gx + 1.8 <= 10) {
    mg.box(3.6, 0.3, 6, gx + 0.1, 0.0, gz, "conc", 0xbcb6aa);
    mg.add(boxGeo(3.6, 2.7, 6), "wall", M(gx + 0.1, 0.3 + 1.35, gz), tint(wall, new THREE.Color(0xffffff), 0.05));
    mg.add(gableGeo(3.6, 6, 0.9, 0.3, 1.2, false), "roof", M(gx + 0.1, 3.0, gz), roofCol);
    mg.add(gableEndGeo(3.6, 6, 0.9, 0.3), "wall", M(gx + 0.1, 3.0, gz), wall);
    mg.add(boxGeo(2.8, 2.15, 0.1), "gdoor", M(gx + 0.1, 0.3 + 1.075, gz + 3.02), tint(0xffffff, GREY, cond * 0.7));
    mg.add(boxGeo(3.0, 0.12, 0.12), "plain", M(gx + 0.1, 2.5, gz + 3.05), trim, false);
    if (rich && r() < 0.35) { mg.add(cylGeo(0.05, 0.05, 3.2, 6), "metal", M(gx + 1.9, 1.6, zF + 7.5), 0x2a2a2a); mg.add(boxGeo(1.1, 0.75, 0.05), "plain", M(gx + 1.9, 3.1, zF + 7.3), 0xf0f0ec); mg.add(cylGeo(0.23, 0.23, 0.02, 12), "plain", M(gx + 1.9, 2.75, zF + 7.0), 0xd2502a, false); }   // hoop
  }
  const dx = garage ? gx + 0.1 : W / 2 + 1.7;
  mg.add(planeGeo(garage ? 3.2 : 2.6, 12), "drive", M(dx, 0.045, zF + 0.5 + 6 - 1), tint(0xffffff, GREY, cond * 0.5), false);
  // path from the porch to the street
  mg.add(planeGeo(1.1, 7), "drive", M(px, 0.045, zF + 2 + 3.5), 0xe8e4dc, false);
  // ---- fence (back and sides): cedar privacy in the Heights and some Flats lots, chain link in the rest
  const wood = rich || r() < 0.35;
  const fenceCol = tint(0xffffff, new THREE.Color(0x8a8070), cond * 0.8);
  const missing = cond > 0.45 || hasSign("junk");
  const runs = [[-9.9, -10.9, 9.9, -10.9], [-9.9, -10.9, -9.9, zF - 1], [9.9, -10.9, 9.9, zF - 1]];
  for (const [x0, z0, x1, z1] of runs) {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 2.4)), alongX = Math.abs(x1 - x0) > 0.1;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n, cx = x0 + (x1 - x0) * (t0 + t1) / 2, cz = z0 + (z1 - z0) * (t0 + t1) / 2, sl = len / n;
      mg.add(boxGeo(0.1, wood ? 1.9 : 1.25, 0.1), wood ? "plain" : "metal", M(x0 + (x1 - x0) * t0, wood ? 0.95 : 0.62, z0 + (z1 - z0) * t0), wood ? 0x6a5a48 : 0x9a9ea2);
      if (missing && r() < 0.25) continue;
      const lean = missing && r() < 0.2 ? (r() - 0.5) * 0.5 : 0;
      if (wood) mg.add(boxGeo(alongX ? sl : 0.04, 1.8, alongX ? 0.04 : sl), "fence", M(cx, 0.95, cz, 0, 1, 1, 1, alongX ? lean : 0, alongX ? 0 : lean), fenceCol);
      else {
        mg.add(boxGeo(alongX ? sl : 0.02, 1.2, alongX ? 0.02 : sl, 0.8), "chain", M(cx, 0.62, cz, 0, 1, 1, 1, alongX ? lean : 0, alongX ? 0 : lean), 0xffffff, false);
        mg.add(boxGeo(alongX ? sl : 0.05, 0.05, alongX ? 0.05 : sl), "metal", M(cx, 1.24, cz), 0x9a9ea2, false);
      }
    }
  }
  // ---- trees: shade trees in the yard, the dead one on rough lots
  const nTrees = rich ? 2 + Math.floor(r() * 2) : Math.floor(r() * 2.2);
  const leafTint = cond > 0.5 ? 0xd8d090 : 0xffffff;
  for (let i = 0; i < nTrees; i++) {
    const front = rich || r() < 0.4;
    let x = (r() - 0.5) * 15, z = front ? 7.5 + r() * 1.5 : -4.8 - r() * 5;
    if (front && Math.abs(x - px) < 2.2) x += 3.5;
    if (front && Math.abs(x - dx) < 2.6) x -= 4;
    const kind = cond > 0.75 && i === 0 ? "dead" : (P.seedv + i) % 3 === 0 ? "elm" : "pecan";
    const v = (P.seedv + i * 7) % 6;
    addFlora(mg, floraParts(kind + v, () => yardTree(v * 97 + 13, kind)), x, z, r() * 6.28, rich ? 1.05 + r() * 0.3 : 0.85 + r() * 0.3, leafTint);
  }
  // foundation shrubs along the front
  if (rich || cond < 0.5) {
    const n = rich ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + 0.7 + r() * (W - 1.4);
      if (Math.abs(x - px) < pw / 2 + 0.3) continue;
      const v = (P.seedv + i) % 4;
      addFlora(mg, floraParts("bush" + v, () => bush(v * 31 + 5, 0.55)), x, zF + 0.55, r() * 6.28, 0.9 + r() * 0.4, cond > 0.4 ? 0xd8d0a0 : 0xffffff);
    }
  }
  // ---- mailbox at the curb
  mg.box(0.09, 1.05, 0.09, px + 3.2, 0, 10.2, "plain", 0x4a3b2a);
  mg.add(boxGeo(0.22, 0.2, 0.46), "metal", M(px + 3.2, 1.12, 10.2), cond > 0.55 ? 0x5a5a56 : 0x24282e);
  mg.add(cylGeo(0.11, 0.11, 0.46, 10), "metal", M(px + 3.2, 1.22, 10.2, 0, 1, 1, 1, Math.PI / 2), cond > 0.55 ? 0x5a5a56 : 0x24282e, false);
  // ---- distress
  if (hasSign("overgrown")) {
    for (let i = 0; i < 26; i++) {
      const x = (r() - 0.5) * 18, z = r() < 0.75 ? zF + 1.0 + r() * 5 : -2 - r() * 8;
      if (Math.abs(x - px) < 0.7 || (Math.abs(x - dx) < 1.4 && z > zF)) continue;
      const v = i % 5;
      addFlora(mg, floraParts("tuft" + v, () => tuft(v + 1)), x, z, r() * 6.28, 0.7 + r() * 0.8, r() < 0.5 ? 0xffffff : 0xd8d0a0);
    }
    // weeds up the drive cracks and along the foundation
    for (let i = 0; i < 6; i++) addFlora(mg, floraParts("tuft0", () => tuft(1)), dx + (r() - 0.5) * 2, zF + r() * 9, r() * 6, 0.45, 0xe0d8a0);
    for (let i = 0; i < 4; i++) addFlora(mg, floraParts("bush" + (i % 4), () => bush((i % 4) * 31 + 5, 0.55)), (r() - 0.5) * W, zF + 0.6, r() * 6, 1.2 + r() * 0.5, 0xc8c890);
  }
  if (hasSign("tarp")) {
    const ang = Math.atan2(rh, D / 2 + 0.4) * (side ? 0 : 1);
    if (!side) { const len = Math.hypot(rh, D / 2) * 0.62; mg.add(boxGeo(W * 0.5, 0.05, len), "plain", M((r() - 0.5) * W * 0.3, 0.3 + H + rh * 0.55, zC + (D / 2) * 0.42, 0, 1, 1, 1, -ang), 0x2f6fb0, false); }
    else mg.add(boxGeo(W * 0.3, 0.05, D * 0.5), "plain", M(0, 0.3 + H + rh * 0.55, zC + (D / 2) * 0.2, 0, 1, 1, 1, 0, 0), 0x2f6fb0, false);
    for (let i = 0; i < 3; i++) mg.add(boxGeo(0.22, 0.14, 0.12), "plain", M((r() - 0.5) * W * 0.4, 0.3 + H + rh * (0.3 + r() * 0.4), zC + D * 0.3, 0, 1, 1, 1, -ang), 0xb02a1e, false);   // bricks holding it down
  }
  if (hasSign("junk")) {
    for (let i = 0; i < 8; i++) {
      const x = (r() - 0.5) * 16, z = zF + 1.3 + r() * 4.2;
      if (Math.abs(x - px) < 1.1 || Math.abs(x - dx) < 1.6) continue;
      const k = i % 5, ry2 = r() * 3;
      const fab = [0x6a5a7a, 0x7a6a4a, 0x4a5a6a][i % 3];
      if (k === 0) { mg.add(boxGeo(1.8, 0.42, 0.85), "plain", M(x, 0.21, z, ry2), fab); mg.add(boxGeo(1.8, 0.5, 0.2), "plain", M(x - Math.sin(ry2) * 0.33, 0.62, z - Math.cos(ry2) * 0.33, ry2), fab); }   // sofa
      else if (k === 1) mg.add(new THREE.TorusGeometry(0.3, 0.11, 6, 14), "plain", M(x, 0.11, z, 0, 1, 1, 1, Math.PI / 2), 0x1a1a1a, false);   // tire
      else if (k === 2) { for (let j = 0; j < 3; j++) mg.add(new THREE.IcosahedronGeometry(0.32, 1), "bag", M(x + j * 0.45, 0.28, z + (j % 2) * 0.3, r() * 3, 1, 0.8, 1), 0xffffff, false); }   // trash bags
      else if (k === 3) mg.add(boxGeo(0.9, 0.5, 0.6), "plain", M(x, 0.25, z, ry2), 0x9a8460, false);   // box
      else mg.add(boxGeo(1.4, 0.2, 1.9), "plain", M(x, 0.5, z, ry2, 1, 1, 1, 1.2), 0xd8d0c0, false);   // mattress leaning
    }
  }
  if (hasSign("mail")) for (let i = 0; i < 4; i++) mg.add(boxGeo(0.32, 0.03, 0.22), "plain", M(px - 0.5 + i * 0.28, 0.32 + i * 0.03, zF + 1.1 + (i % 2) * 0.2, r()), 0xf1ead4, false);
  if (hasSign("notice")) mg.add(boxGeo(0.42, 0.52, 0.02), "plain", M(px - 0.05, 1.6, zF + 0.12), 0xf06c14, false);
  if (hasSign("notice_white")) mg.add(boxGeo(0.4, 0.5, 0.02), "plain", M(px - 0.05, 1.6, zF + 0.12), 0xf4f4ec, false);
  if (hasSign("forrent")) { mg.box(0.07, 1.4, 0.07, px + 2.6, 0, zF + 4.5, "plain", 0x5a5348); mg.add(new THREE.PlaneGeometry(0.75, 0.5), "rentsign", M(px + 2.6, 1.35, zF + 4.55), 0xffffff, false); mg.add(new THREE.PlaneGeometry(0.75, 0.5), "plain", M(px + 2.6, 1.35, zF + 4.53, Math.PI), 0xd9d2c4, false); }
  if (hasSign("forsale")) { mg.box(0.07, 1.5, 0.07, px + 3.3, 0, zF + 5.2, "plain", 0x6a6a6a); mg.add(new THREE.PlaneGeometry(0.9, 0.6), "salesign", M(px + 3.3, 1.55, zF + 5.25), 0xffffff, false); mg.add(new THREE.PlaneGeometry(0.9, 0.6), "plain", M(px + 3.3, 1.55, zF + 5.23, Math.PI), 0x2e6bb8, false); }
  if (hasSign("rustcar")) car(mg, dx, zF + 6.5, Math.PI / 2 + (r() - 0.5) * 0.2, 0x7a4a2e, true);
  else if (!P.absentee && r() < (rich ? 0.6 : 0.45)) car(mg, dx, zF + 6.5 + (r() - 0.5) * 2, Math.PI / 2, [0xd8d8dc, 0x2b2f38, 0x9a2a2a, 0x3a5a8a, 0x5b6a5e, 0xc8c0a8][(P.seedv >> 5) % 6], false);
  // bins at the curb, rolled out on collection day
  if (!P.absentee) { const bc = rich ? 0x2d5a3a : 0x2c3a4c; mg.add(boxGeo(0.6, 0.95, 0.7), "metal", M(px + 4.2, 0.5, 9.3), bc); mg.add(boxGeo(0.66, 0.06, 0.76), "metal", M(px + 4.2, 1.0, 9.3), bc, false); if (!rich) { mg.add(boxGeo(0.6, 0.95, 0.7), "metal", M(px + 4.9, 0.5, 9.4, 0.2), 0x1e5aa0); } }
  return { W, D, H, zF, zC, px, garage: garage && gx + 1.8 <= 10, gx };
}

function window_(mg, x, y, z, w, h, gkey, trim, boarded, shutters, cond) {
  mg.add(boxGeo(w + 0.24, h + 0.24, 0.07), "plain", M(x, y, z), trim, false);
  mg.add(boxGeo(w, h, 0.09), gkey, M(x, y, z + 0.02), 0xffffff, false);
  mg.add(boxGeo(0.05, h, 0.11), "plain", M(x, y, z + 0.03), trim, false);
  mg.add(boxGeo(w, 0.04, 0.11), "plain", M(x, y + h * 0.05, z + 0.03), trim, false);
  mg.add(boxGeo(w + 0.4, 0.07, 0.16), "plain", M(x, y - h / 2 - 0.14, z + 0.06), trim, false);   // sill
  if (shutters) for (const sx of [-1, 1]) mg.add(boxGeo(0.4, h + 0.2, 0.05), "plain", M(x + sx * (w / 2 + 0.34), y, z + 0.03, 0, 1, 1, 1, 0, cond > 0.6 && sx > 0 ? 0.12 : 0), shutters, false);
  if (boarded) for (let i = 0; i < 3; i++) mg.add(boxGeo(w + 0.5, 0.24, 0.04), "ply", M(x, y - 0.4 + i * 0.4, z + 0.09, 0, 1, 1, 1, 0, (i - 1) * 0.09), 0xffffff, false);
}

// A parked car. With mg.parked (the town build) the spot goes on the list and main.js puts a Meshy car there; the
// box car below is only the fallback when there's no list.
export function car(mg, x, z, ry, color, rusty) {
  if (mg.parked) { const w = mg.world(x, z); mg.parked.push({ x: w.x, z: w.z, ry: ry + mg.ry, color, rusty }); return; }
  mg.add(boxGeo(4.4, 0.7, 1.8), "plain", M(x, 0.62, z, ry), color);
  mg.add(boxGeo(2.3, 0.62, 1.62), "plain", M(x - 0.25 * Math.cos(ry), 1.26, z + 0.25 * Math.sin(ry), ry), rusty ? 0x6a3f26 : color);
  for (const sx of [-1.4, 1.4]) for (const sz of [-0.85, 0.85]) {
    const c = Math.cos(ry), sn = Math.sin(ry);
    mg.add(cylGeo(0.34, 0.34, 0.24, 10), "plain", M(x + sx * c + sz * sn, 0.34, z - sx * sn + sz * c, ry, 1, 1, 1, Math.PI / 2), 0x151515, false);
  }
}
