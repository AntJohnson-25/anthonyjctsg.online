// Pecan Hollow's own painted surfaces (2026-11-08 realism pass, user: "it looks very cartoonish"). Same approach as
// Run It Up's textures.js (canvas, painted once, cached, grime on everything). Textures meant to be tinted per house
// by vertex colour (grass, siding, shingles) are painted in near-neutral greys so the tint carries the hue.
import * as THREE from "three";
import { canvasTex, brick } from "./textures.js";
import { BRANDS, GROUND, layout, viewCanvas } from "./brands.js";

function rnd(seed) { let s = Math.abs(seed | 0) % 2147483646 || 1; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; }
function noise(g, w, h, r, a = 0.06) {
  const d = g.getImageData(0, 0, w, h), p = d.data;
  for (let i = 0; i < p.length; i += 4) { const n = (r() - 0.5) * 255 * a; p[i] += n; p[i + 1] += n; p[i + 2] += n; }
  g.putImageData(d, 0, 0);
}
const soft = (g, x, y, rad, rgba0, rgba1) => { const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, rgba0); gr.addColorStop(1, rgba1); g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2); };

// Lawn: light grey-green so the per-lot vertex colour sets the hue (healthy, dry, overgrown). Blade flecks, clover,
// bare patches. Tiles every 4 m (world UVs).
export function grass() {
  return canvasTex("dd-grass", 512, 512, (g, w, h) => {
    const r = rnd(41);
    g.fillStyle = "#c8cfb8"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) { const x = r() * w, y = r() * h; for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) soft(g, x + ox, y + oy, 40 + r() * 90, "rgba(" + (r() < 0.5 ? "150,160,120" : "230,232,210") + ",0.35)", "rgba(200,200,200,0)"); }
    for (let i = 0; i < 9000; i++) {
      const x = r() * w, y = r() * h, l = 3 + r() * 6, v = r();
      g.strokeStyle = v < 0.5 ? "rgba(80,96,60," + (0.25 + r() * 0.3) + ")" : "rgba(245,248,225," + (0.15 + r() * 0.25) + ")";
      g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y - l); g.stroke();
    }
    // bare dirt spots
    for (let i = 0; i < 5; i++) soft(g, r() * w, r() * h, 12 + r() * 26, "rgba(170,140,100,0.45)", "rgba(170,140,100,0)");
    noise(g, w, h, r, 0.06);
  });
}
// Dirt (the construction site, worn paths, vacant lots).
export function dirt() {
  return canvasTex("dd-dirt", 512, 512, (g, w, h) => {
    const r = rnd(43);
    g.fillStyle = "#8a7354"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) soft(g, r() * w, r() * h, 30 + r() * 80, "rgba(" + (r() < 0.5 ? "60,48,34" : "170,148,112") + ",0.35)", "rgba(0,0,0,0)");
    for (let i = 0; i < 5000; i++) { g.fillStyle = r() < 0.5 ? "rgba(40,32,22,0.5)" : "rgba(200,182,150,0.45)"; g.fillRect(r() * w, r() * h, 1 + r() * 2.5, 1 + r() * 2.5); }
    // tyre ruts
    for (let i = 0; i < 4; i++) { const y = r() * h; g.strokeStyle = "rgba(50,40,28,0.25)"; g.lineWidth = 10; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 40, w * 0.6, y - 40, w, y); g.stroke(); }
    noise(g, w, h, r, 0.1);
  });
}
// Asphalt shingles, neutral grey (tinted per house). Staggered tabs with tone per tab, dark algae streaks running down
// the slope (the black streaks every Texas roof gets), a few replaced lighter shingles. v = up the slope.
export function shingles() {
  return canvasTex("dd-shingle", 512, 512, (g, w, h) => {
    const r = rnd(47), rowH = 32, tabW = 64;
    g.fillStyle = "#c4c4c2"; g.fillRect(0, 0, w, h);
    for (let y = 0, row = 0; y < h; y += rowH, row++) {
      for (let x = (row % 2) * -tabW / 2; x < w; x += tabW) {
        const v = 150 + r() * 70 | 0;
        g.fillStyle = "rgb(" + v + "," + v + "," + (v - 4) + ")"; g.fillRect(x + 1, y, tabW - 2, rowH - 3);
        g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(x + tabW - 2, y, 2, rowH);
        if (r() < 0.03) { g.fillStyle = "rgba(255,255,255,0.35)"; g.fillRect(x + 1, y, tabW - 2, rowH - 3); }
      }
      g.fillStyle = "rgba(0,0,0,0.45)"; g.fillRect(0, y + rowH - 4, w, 4);   // the shadow line under each course
    }
    for (let i = 0; i < 9000; i++) { g.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.2)"; g.fillRect(r() * w, r() * h, 1.5, 1.5); }   // granules
    for (let i = 0; i < 16; i++) {   // algae streaks (canvas y down = down the slope)
      const x = r() * w, wd = 12 + r() * 50, gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, "rgba(20,22,18,0)"); gr.addColorStop(0.5, "rgba(20,22,18," + (0.12 + r() * 0.2) + ")"); gr.addColorStop(1, "rgba(20,22,18,0.05)");
      g.fillStyle = gr; g.fillRect(x, 0, wd, h);
    }
  });
}
// Vinyl / wood lap siding in light grey (tinted per house), weathered: dirt line at the bottom is drawn in geometry.
export function lapSiding() {
  return canvasTex("dd-siding", 256, 256, (g, w, h) => {
    const r = rnd(53);
    g.fillStyle = "#e6e6e4"; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      const gr = g.createLinearGradient(0, y, 0, y + 16); gr.addColorStop(0, "rgba(255,255,255,0.18)"); gr.addColorStop(0.8, "rgba(0,0,0,0.04)"); gr.addColorStop(1, "rgba(0,0,0,0.3)");
      g.fillStyle = gr; g.fillRect(0, y, w, 16);
      if (r() < 0.6) { const x = r() * w; g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(x, y, 2, 15); }   // butt joints
    }
    for (let i = 0; i < 18; i++) { const x = r() * w, y = r() * h * 0.4, l = 30 + r() * h * 0.6, gr = g.createLinearGradient(x, y, x, y + l); gr.addColorStop(0, "rgba(40,36,30,0.10)"); gr.addColorStop(1, "rgba(40,36,30,0)"); g.fillStyle = gr; g.fillRect(x, y, 2 + r() * 6, l); }
    noise(g, w, h, r, 0.04);
  });
}
// Window glass with something behind it: blinds or curtains, a sky reflection band. Painted to read well at any
// crop (the box UVs show 70-90% of it).
export function windowGlass(seed = 1) {
  return canvasTex("dd-glass" + seed, 128, 128, (g, w, h) => {
    const r = rnd(59 + seed);
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#3c4c5a"); gr.addColorStop(1, "#141c24");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    if (seed % 3 === 0) { for (let y = 0; y < h; y += 6) { g.fillStyle = "rgba(220,214,196,0.32)"; g.fillRect(0, y, w, 3); } }      // blinds
    else if (seed % 3 === 1) { g.fillStyle = "rgba(196,176,140,0.45)"; g.fillRect(0, 0, w * 0.3, h); g.fillRect(w * 0.7, 0, w * 0.3, h); for (let x = 0; x < w * 0.3; x += 6) { g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(x, 0, 2, h); g.fillRect(w * 0.7 + x, 0, 2, h); } }   // curtains
    const rf = g.createLinearGradient(0, 0, w, h); rf.addColorStop(0, "rgba(210,230,245,0.42)"); rf.addColorStop(0.35, "rgba(180,205,225,0.12)"); rf.addColorStop(0.55, "rgba(180,205,225,0)"); rf.addColorStop(0.7, "rgba(200,220,240,0.14)"); rf.addColorStop(1, "rgba(200,220,240,0)");
    g.fillStyle = rf; g.fillRect(0, 0, w, h);
  }, { repeat: true });
}
// Sectional garage door (4 rows of raised panels) on a 1.6 m tile.
export function garageDoor() {
  return canvasTex("dd-gdoor", 256, 256, (g, w, h) => {
    const r = rnd(61);
    g.fillStyle = "#e8e6e0"; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 64) {
      g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(0, y + 61, w, 3);
      for (let x = 0; x < w; x += 64) { g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(x + 8, y + 10, 48, 42); g.fillStyle = "rgba(255,255,255,0.35)"; g.fillRect(x + 8, y + 10, 48, 3); g.fillStyle = "rgba(0,0,0,0.2)"; g.fillRect(x + 8, y + 49, 48, 3); }
    }
    for (let i = 0; i < 10; i++) { const x = r() * w, gr = g.createLinearGradient(0, h * 0.5, 0, h); gr.addColorStop(0, "rgba(60,50,40,0)"); gr.addColorStop(1, "rgba(60,50,40,0.18)"); g.fillStyle = gr; g.fillRect(x, h * 0.5, 20 + r() * 40, h * 0.5); }
    noise(g, w, h, r, 0.05);
  });
}
// Cedar privacy fence: vertical pickets with gaps of light, weathered grey-brown, tinted per house. Tile 1.6 m.
export function fenceBoards() {
  return canvasTex("dd-fence", 256, 256, (g, w, h) => {
    const r = rnd(67);
    g.clearRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      const v = 150 + r() * 70 | 0;
      g.fillStyle = "rgb(" + v + "," + (v - 14) + "," + (v - 30) + ")"; g.fillRect(x, 0, 14, h);
      for (let k = 0; k < 6; k++) { g.fillStyle = "rgba(60,40,24,0.3)"; g.fillRect(x + 2 + r() * 10, r() * h, 1, 20 + r() * 50); }   // grain
      g.fillStyle = "rgba(40,30,20,0.6)"; g.fillRect(x + 6, 20, 2, 2); g.fillRect(x + 6, h - 24, 2, 2);   // nails
    }
    const gr = g.createLinearGradient(0, h * 0.65, 0, h); gr.addColorStop(0, "rgba(40,36,20,0)"); gr.addColorStop(1, "rgba(40,36,20,0.4)");
    g.globalCompositeOperation = "source-atop"; g.fillStyle = gr; g.fillRect(0, 0, w, h); g.globalCompositeOperation = "source-over";
  });
}
// Chain-link mesh (alpha): diamond wires. Tile 0.8 m.
export function chainLink() {
  return canvasTex("dd-chain", 128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = "rgba(200,204,206,1)"; g.lineWidth = 2;
    for (let i = -w; i < w * 2; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke(); g.beginPath(); g.moveTo(i, h); g.lineTo(i + h, 0); g.stroke(); }
  });
}
// A worn concrete apron / driveway with expansion joints every 3 m (tile 3 m).
export function drive() {
  return canvasTex("dd-drive", 256, 256, (g, w, h) => {
    const r = rnd(71);
    g.fillStyle = "#b9b5ab"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 20; i++) soft(g, r() * w, r() * h, 20 + r() * 50, "rgba(" + (r() < 0.7 ? "70,66,60" : "210,206,198") + ",0.18)", "rgba(0,0,0,0)");
    soft(g, w * 0.5, h * 0.5, 50, "rgba(30,28,26,0.35)", "rgba(30,28,26,0)");   // oil spot where the car sits
    g.strokeStyle = "rgba(40,38,34,0.6)"; g.lineWidth = 3; g.strokeRect(0, 0, w, h);
    g.strokeStyle = "rgba(40,38,34,0.4)"; g.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) { g.beginPath(); let x = r() * w, y = r() * h; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 50; y += (r() - 0.5) * 50; g.lineTo(x, y); } g.stroke(); }
    noise(g, w, h, r, 0.08);
  });
}

// ------------------------------------------------------------------ downtown storefronts
// 2026-11-24 (user: "refine the details of the buildings and signage like we did to the storefronts in Run It Up"): the
// whole front of a Main Street building, painted in one texture: real brick (or stucco) wall, a cornice, a belt course over
// the shop, upper-floor windows (above the sign plate that world.js hangs on the front: brands.js layout()), and a ground
// floor with the shop's own cladding, big windows with the painted, lit shop view behind them (brands.js paintView),
// a framed glass door in the middle, pilasters, a kick plate, hours placard and grime. The sign, blade sign, awning,
// A-frame and trim are real 3D (world.js). Returns { map, emissive, brick } (emissive = what lights up at night).
function cladFill(g, kind, x, y, w, h, r) {
  const base = { stone: "#d9d0bd", brick: "#7a3d2e", boards: "#4a2e1c", metal: "#2a2b2f", stucco: "#e0d0b2" }[kind] || "#d9d0bd";
  g.fillStyle = base; g.fillRect(x, y, w, h);
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  if (kind === "boards") { for (let xx = x; xx < x + w; xx += 14) { g.fillStyle = "rgba(0,0,0," + (0.1 + r() * 0.12) + ")"; g.fillRect(xx, y, 2, h); } }
  else if (kind === "metal") { for (let xx = x; xx < x + w; xx += 10) { g.fillStyle = "rgba(255,255,255,0.08)"; g.fillRect(xx, y, 2, h); g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(xx + 5, y, 3, h); } }
  else if (kind === "brick") { for (let yy = y; yy < y + h; yy += 9) { g.fillStyle = "rgba(220,200,180,0.22)"; g.fillRect(x, yy, w, 1.5); for (let xx = x + ((yy / 9 | 0) % 2) * 12; xx < x + w; xx += 24) g.fillRect(xx, yy, 1.5, 9); } }
  else { for (let yy = y; yy < y + h; yy += 22) { g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(x, yy, w, 1.5); for (let xx = x + ((yy / 22 | 0) % 2) * 30; xx < x + w; xx += 60) g.fillRect(xx, yy, 1.5, 22); } }
  for (let i = 0; i < 180; i++) { g.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.07)" : "rgba(255,255,255,0.06)"; g.fillRect(x + r() * w, y + r() * h, 2 + r() * 4, 2 + r() * 4); }
  g.restore();
}
export function storefront(b) {
  const B = BRANDS[b.id], W = 1024, H = Math.round(1024 * b.h / b.w * 0.5) * 2 || 512;
  const r0 = rnd(b.name.length * 131 + b.x * 7 + 900);
  const pxm = W / b.w;   // pixels per metre
  const brickWall = b.kind !== "office" || r0() < 0.5;
  const L = layout(b), litUp = [];
  const draw = (g, glow) => {
    const r = rnd(b.name.length * 131 + b.x * 7 + 901);
    const gy = H - GROUND * pxm;   // top of the ground floor
    if (!glow) {
      if (brickWall) {
        const bt = brick(b.wall, "#5a524a", 3 + (b.x | 0) % 5).image;
        const tile = 1.6 * pxm;   // the brick texture spans 1.6 m
        for (let y = 0; y < H; y += tile) for (let x = 0; x < W; x += tile) g.drawImage(bt, x, y, tile, tile);
      } else {
        g.fillStyle = b.wall; g.fillRect(0, 0, W, H);
        for (let i = 0; i < 3000; i++) { g.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)"; g.fillRect(r() * W, r() * H, 2 + r() * 3, 2 + r() * 3); }
        for (let y = 0; y < H; y += 1.2 * pxm) { g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(0, y, W, 2); }   // panel joints
      }
      // cornice at the top, a stone belt course over the shop
      g.fillStyle = "rgba(230,222,205,0.92)"; g.fillRect(0, 0, W, 0.45 * pxm); g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(0, 0.45 * pxm, W, 6);
      g.fillStyle = "rgba(230,222,205,0.92)"; g.fillRect(0, gy - 0.16 * pxm, W, 0.16 * pxm); g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(0, gy, W, 5);
    } else { g.fillStyle = "#000"; g.fillRect(0, 0, W, H); }
    // ---- upper windows: only the floors that fit between the sign plate and the cornice
    const floors = Math.max(0, Math.floor((H - L.upperY0 * pxm - (H - L.upperY1 * pxm)) / (2.9 * pxm)));
    const cols = Math.max(2, Math.round(b.w / 3.2));
    for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) {
      const cw = W / cols, ww = cw * 0.5, wx = c * cw + (cw - ww) / 2, wh = 1.55 * pxm, wy = H - (L.upperY0 + f * 2.9) * pxm - wh - 0.15 * pxm;
      const key = f * 10 + c;
      if (litUp[key] === undefined) litUp[key] = r0() < 0.4;
      if (glow) { if (litUp[key]) { g.fillStyle = r() < 0.5 ? "#ffcf8a" : "#e8ecff"; g.fillRect(wx, wy, ww, wh); } continue; }
      g.fillStyle = "rgba(0,0,0,0.4)"; g.fillRect(wx - 6, wy - 6, ww + 12, wh + 12);
      g.fillStyle = "#d9d2c0"; g.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
      const gg = g.createLinearGradient(wx, wy, wx + ww, wy + wh); gg.addColorStop(0, "#5a7286"); gg.addColorStop(0.5, "#1c2832"); gg.addColorStop(1, "#0c1218");
      g.fillStyle = gg; g.fillRect(wx, wy, ww, wh);
      if (r() < 0.5) for (let y = wy; y < wy + wh * (0.3 + r() * 0.6); y += 5) { g.fillStyle = "rgba(220,214,196,0.3)"; g.fillRect(wx, y, ww, 2.5); }
      g.fillStyle = "#d9d2c0"; g.fillRect(wx + ww / 2 - 2, wy, 4, wh); g.fillRect(wx, wy + wh * 0.5 - 2, ww, 4);
      g.fillStyle = "#cfc6b2"; g.fillRect(wx - 10, wy + wh + 4, ww + 20, 8);   // sill
      g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(wx - 6, wy + wh + 12, ww + 12, 30);   // drip stain under the sill
    }
    // ---- ground floor: cladding, pilasters, two windows with the shop view, a framed door in the middle
    const dw = 1.15 * pxm, dx0 = W / 2 - dw / 2, dx1 = dx0 + dw;
    const wTop = H - 2.75 * pxm, wBot = H - 0.5 * pxm, bays = [[0.55 * pxm, dx0 - 0.2 * pxm], [dx1 + 0.2 * pxm, W - 0.55 * pxm]];
    const dTop = H - 2.5 * pxm;
    if (!glow) {
      cladFill(g, B.clad, 0, gy, W, H - gy, r);
      g.fillStyle = "rgba(0,0,0,0.5)"; g.fillRect(0, gy, W, 4);
    }
    for (const [x0, x1] of bays) {
      const vw = x1 - x0, vh = wBot - wTop;
      if (!glow) { g.fillStyle = "#16120e"; g.fillRect(x0 - 9, wTop - 9, vw + 18, vh + 18); g.fillStyle = B.trim; g.fillRect(x0 - 5, wTop - 5, vw + 10, vh + 10); }
      const v = viewCanvas(b.id, vw, vh);
      g.save();
      if (glow) { g.globalAlpha = 0.85; g.drawImage(v, x0, wTop, vw, vh); }
      else { g.drawImage(v, x0, wTop, vw, vh); }
      g.restore();
      if (!glow) {
        // mullions, a transom bar, the glass sheen, a hours placard and a poster in the corner
        g.fillStyle = "#16120e"; const n = Math.max(1, Math.round(vw / (1.6 * pxm)));
        for (let k = 1; k < n; k++) g.fillRect(x0 + vw * k / n - 3, wTop, 6, vh);
        g.fillRect(x0, wTop + vh * 0.24, vw, 5);
        const rf = g.createLinearGradient(x0, wTop, x0 + vw * 0.6, wBot); rf.addColorStop(0, "rgba(210,228,240,0.32)"); rf.addColorStop(0.4, "rgba(210,228,240,0.03)"); rf.addColorStop(0.6, "rgba(210,228,240,0.14)"); rf.addColorStop(1, "rgba(210,228,240,0)");
        g.fillStyle = rf; g.fillRect(x0, wTop, vw, vh);
        g.fillStyle = "rgba(240,236,224,0.92)"; g.fillRect(x1 - 0.42 * pxm, wBot - 0.32 * pxm, 0.34 * pxm, 0.24 * pxm);
        g.fillStyle = "#2a2a2a"; g.font = "700 " + Math.round(0.05 * pxm) + "px Arial"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("OPEN", x1 - 0.25 * pxm, wBot - 0.2 * pxm);
      }
    }
    // door
    if (glow) { g.fillStyle = "rgba(255,214,150,0.85)"; g.fillRect(dx0 + 12, dTop + 14, dw - 24, (H - dTop) * 0.7); }
    else {
      g.fillStyle = "#16120e"; g.fillRect(dx0 - 8, dTop - 8, dw + 16, H - dTop + 8);
      g.fillStyle = B.trim; g.fillRect(dx0 - 4, dTop - 4, dw + 8, 8); g.fillRect(dx0 - 4, dTop - 4, 8, H - dTop + 4); g.fillRect(dx1 - 4, dTop - 4, 8, H - dTop + 4);
      const dg = g.createLinearGradient(0, dTop, 0, H); dg.addColorStop(0, "#5a7480"); dg.addColorStop(1, "#1c2630");
      g.fillStyle = dg; g.fillRect(dx0 + 10, dTop + 12, dw - 20, (H - dTop) * 0.74);
      g.fillStyle = "#16120e"; g.fillRect(dx0 + dw / 2 - 2, dTop + 12, 4, (H - dTop) * 0.74);
      g.fillStyle = "#c9a85a"; g.fillRect(dx0 + 12, H - (H - dTop) * 0.2, dw - 24, 6);   // push plate
      g.fillStyle = "#d8dadc"; g.fillRect(dx0 + dw / 2 + 12, dTop + (H - dTop) * 0.45, 5, 30);   // handle
      g.fillStyle = "rgba(255,255,255,0.1)"; g.fillRect(dx0 + 10, dTop + 12, (dw - 20) * 0.4, (H - dTop) * 0.74);
    }
    // pilasters at both ends and either side of the door, kick plate along the bottom
    if (!glow) {
      g.fillStyle = "rgba(230,222,205,0.85)";
      for (const x of [0, W - 0.42 * pxm]) g.fillRect(x, gy, 0.42 * pxm, H - gy);
      g.fillStyle = "rgba(0,0,0,0.22)";
      for (const x of [0.42 * pxm, W - 0.42 * pxm - 5]) g.fillRect(x, gy, 5, H - gy);
      // grime: rain streaks from the cornice, a dark band at the sidewalk
      for (let i = 0; i < 26; i++) { const x = r() * W, l = 40 + r() * H * 0.5, gr = g.createLinearGradient(x, 0, x, l); gr.addColorStop(0, "rgba(20,18,14,0.22)"); gr.addColorStop(1, "rgba(20,18,14,0)"); g.fillStyle = gr; g.fillRect(x, 0.45 * pxm, 2 + r() * 5, l); }
      const bg = g.createLinearGradient(0, H - 0.6 * pxm, 0, H); bg.addColorStop(0, "rgba(20,18,14,0)"); bg.addColorStop(1, "rgba(20,18,14,0.4)"); g.fillStyle = bg; g.fillRect(0, H - 0.6 * pxm, W, 0.6 * pxm);
    }
  };
  const map = canvasTex("dd-front2-" + b.id, W, H, (g) => draw(g, false), { repeat: false });
  const emissive = canvasTex("dd-front2e-" + b.id, W, H, (g) => draw(g, true), { repeat: false });
  return { map, emissive, brick: brickWall };
}
// Striped canvas awning.
export function awning(col) {
  return canvasTex("dd-awn" + col, 256, 64, (g, w, h) => {
    const c = new THREE.Color(col);
    for (let x = 0; x < w; x += 32) { g.fillStyle = (x / 32) % 2 ? "#" + c.getHexString() : "#ece6d6"; g.fillRect(x, 0, 32, h); }
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,0.3)"); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}
// Night: a soft pool of lamp light on the ground (additive).
export function lampPool() {
  return canvasTex("dd-pool", 128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, "rgba(255,214,150,0.9)"); gr.addColorStop(0.45, "rgba(255,190,110,0.35)"); gr.addColorStop(1, "rgba(255,170,90,0)");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, { repeat: false });
}
