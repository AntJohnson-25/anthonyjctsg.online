// Canvas textures for the street, copied from Run It Up (2026-11-08, user: "make the world more realistic, like Run It
// Up"). Every surface is painted once and cached; grime is part of the look. Pecan Hollow's own surfaces (grass,
// shingles, fences, window glass, storefronts) are in surfaces.js.
import * as THREE from "three";

const cache = {};
// (A negative seed used to make this go negative, and a negative grime radius threw mid-build: the
// district never finished loading and the game froze on arrival.)
function rnd(seed) { let s = Math.abs(seed | 0) % 2147483646 || 1; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; }

export function canvasTex(key, w, h, draw, { srgb = true, repeat = true } = {}) {
  if (cache[key]) return cache[key];
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return (cache[key] = t);
}

function grime(g, w, h, r, amt = 1) {
  for (let i = 0; i < 40 * amt; i++) {
    g.fillStyle = "rgba(0,0,0," + (0.03 + r() * 0.06) + ")";
    const x = r() * w, y = r() * h, rw = 10 + r() * 60, rh = 10 + r() * 60;
    g.beginPath(); g.ellipse(x, y, Math.abs(rw), Math.abs(rh), 0, 0, Math.PI * 2); g.fill();
  }
  // Rain streaks running down.
  for (let i = 0; i < 30 * amt; i++) {
    const x = r() * w, y = r() * h * 0.6, l = 20 + r() * h * 0.5;
    const gr = g.createLinearGradient(x, y, x, y + l);
    gr.addColorStop(0, "rgba(0,0,0,0.12)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(x, y, 1 + r() * 3, l);
  }
}
function noise(g, w, h, r, a = 0.06) {
  const d = g.getImageData(0, 0, w, h), p = d.data;
  for (let i = 0; i < p.length; i += 4) { const n = (r() - 0.5) * 255 * a; p[i] += n; p[i + 1] += n; p[i + 2] += n; }
  g.putImageData(d, 0, 0);
}

export function brick(base = "#7a3b2b", mortar = "#5a524a", seed = 3) {
  return canvasTex("brick" + base + seed, 256, 256, (g, w, h) => {
    const r = rnd(seed);
    g.fillStyle = mortar; g.fillRect(0, 0, w, h);
    const bh = 16, bw = 42;
    for (let y = 0, row = 0; y < h; y += bh, row++) {
      for (let x = (row % 2) * -bw / 2; x < w; x += bw) {
        const c = new THREE.Color(base).offsetHSL(0, (r() - 0.5) * 0.08, (r() - 0.5) * 0.1);
        g.fillStyle = "#" + c.getHexString();
        g.fillRect(x + 2, y + 2, bw - 3, bh - 3);
      }
    }
    noise(g, w, h, r, 0.08); grime(g, w, h, r);
  });
}
export function siding(base = "#c9c2b0", seed = 5) {
  return canvasTex("siding" + base + seed, 256, 256, (g, w, h) => {
    const r = rnd(seed);
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 14) {
      g.fillStyle = "rgba(0,0,0,0.22)"; g.fillRect(0, y + 12, w, 2);
      g.fillStyle = "rgba(255,255,255,0.08)"; g.fillRect(0, y, w, 2);
    }
    // Peeling paint.
    for (let i = 0; i < 22; i++) { g.fillStyle = "rgba(90,80,70," + (0.2 + r() * 0.3) + ")"; g.fillRect(r() * w, r() * h, 4 + r() * 26, 3 + r() * 8); }
    noise(g, w, h, r, 0.05); grime(g, w, h, r, 1.4);
  });
}
export function concrete(base = "#8a8780", seed = 7) {
  return canvasTex("concrete" + base + seed, 256, 256, (g, w, h) => {
    const r = rnd(seed);
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    noise(g, w, h, r, 0.1); grime(g, w, h, r, 1.2);
    g.strokeStyle = "rgba(0,0,0,0.25)"; g.lineWidth = 1;
    for (let i = 0; i < 6; i++) { g.beginPath(); let x = r() * w, y = r() * h; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; g.lineTo(x, y); } g.stroke(); }
  });
}
// 2026-11-04 grime pass (user: "should represent the grimey street life"): beat-up asphalt with aggregate, tar-sealed
// cracks and oil drips, plus a matching roughness map so the tar and oil catch the street lights like they're wet.
const wrap = (w, h, fn) => { for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) fn(ox, oy); };
function roadFeatures(W, H) {
  const r = rnd(12), f = { patches: [], cracks: [], oil: [] };
  for (let i = 0; i < 9; i++) f.patches.push([r() * W, r() * H, 60 + r() * 220, 40 + r() * 160, r() < 0.5]);
  for (let i = 0; i < 22; i++) {
    const pts = []; let x = r() * W, y = r() * H; pts.push([x, y]);
    for (let k = 0; k < 10; k++) { x += (r() - 0.5) * 90; y += (r() - 0.5) * 90; pts.push([x, y]); }
    f.cracks.push([pts, 2 + r() * 4]);
  }
  for (let i = 0; i < 26; i++) f.oil.push([r() * W, r() * H, 8 + r() * 46, 0.25 + r() * 0.4]);
  return f;
}
function drawRoadFeatures(g, f, W, H, c) {
  for (const [x, y, pw, ph, dark] of f.patches) { g.fillStyle = dark ? c.patchDark : c.patchLight; g.fillRect(x, y, pw, ph); g.strokeStyle = c.seam; g.lineWidth = 2; g.strokeRect(x, y, pw, ph); }
  wrap(W, H, (ox, oy) => {
    g.lineJoin = "round"; g.strokeStyle = c.crack;
    for (const [pts, lw] of f.cracks) { g.lineWidth = lw; g.beginPath(); g.moveTo(pts[0][0] + ox, pts[0][1] + oy); for (const [x, y] of pts) g.lineTo(x + ox, y + oy); g.stroke(); }
    for (const [x, y, rad, a] of f.oil) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      gr.addColorStop(0, c.oil(a)); gr.addColorStop(1, c.oil(0));
      g.fillStyle = gr; g.beginPath(); g.ellipse(x + ox, y + oy, rad, rad * 0.7, 0, 0, 7); g.fill();
    }
  });
}
export function asphalt() {
  return canvasTex("asphalt2", 1024, 1024, (g, w, h) => {
    const r = rnd(11);
    g.fillStyle = "#2a2b2d"; g.fillRect(0, 0, w, h);
    // Aggregate: light and dark stone flecks.
    for (let i = 0; i < 26000; i++) {
      g.fillStyle = r() < 0.5 ? "rgba(120,118,112," + (0.12 + r() * 0.3) + ")" : "rgba(8,8,10," + (0.2 + r() * 0.3) + ")";
      g.fillRect(r() * w, r() * h, 1 + r() * 1.6, 1 + r() * 1.6);
    }
    noise(g, w, h, r, 0.07);
    // Sun-faded, worn blotches.
    for (let i = 0; i < 18; i++) {
      const x = r() * w, y = r() * h, rad = 40 + r() * 140, gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, "rgba(95,92,86,0.18)"); gr.addColorStop(1, "rgba(95,92,86,0)");
      g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    drawRoadFeatures(g, roadFeatures(w, h), w, h, { patchDark: "rgba(14,14,16,0.45)", patchLight: "rgba(70,70,72,0.35)", seam: "rgba(0,0,0,0.4)", crack: "rgba(6,6,7,0.85)", oil: (a) => "rgba(5,5,6," + a + ")" });
  });
}
// Green channel = roughness (x the material's roughness 1): dry road ~0.92, tar seal and oil glossy.
export function asphaltRough() {
  return canvasTex("asphaltR", 512, 512, (g, w, h) => {
    g.fillStyle = "rgb(235,235,235)"; g.fillRect(0, 0, w, h);
    g.scale(w / 1024, h / 1024);
    drawRoadFeatures(g, roadFeatures(1024, 1024), 1024, 1024, { patchDark: "rgba(190,190,190,0.6)", patchLight: "rgba(245,245,245,0.6)", seam: "rgba(160,160,160,0.6)", crack: "rgb(80,80,80)", oil: (a) => "rgba(60,60,60," + Math.min(1, a * 2) + ")" });
  }, { srgb: false });
}
export function sidewalk() {
  return canvasTex("sidewalk2", 512, 512, (g, w, h) => {
    const r = rnd(13), S = 256;   // 1 m slabs (the walk plane tiles every 2 m)
    g.fillStyle = "#8d8a84"; g.fillRect(0, 0, w, h);
    // Each slab poured a little different, some darker with years of foot traffic.
    for (let x = 0; x < w; x += S) for (let y = 0; y < h; y += S) { g.fillStyle = "rgba(" + (r() < 0.5 ? "40,38,34," : "150,146,138,") + (0.05 + r() * 0.12) + ")"; g.fillRect(x, y, S, S); }
    noise(g, w, h, r, 0.09);
    // Stains: spilled drinks, drips under awnings, rust.
    for (let i = 0; i < 26; i++) {
      const x = r() * w, y = r() * h, rad = 10 + r() * 60, gr = g.createRadialGradient(x, y, 0, x, y, rad);
      const col = r() < 0.2 ? "110,62,30" : "28,26,22";
      gr.addColorStop(0, "rgba(" + col + "," + (0.18 + r() * 0.25) + ")"); gr.addColorStop(1, "rgba(" + col + ",0)");
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rad, rad * (0.5 + r() * 0.5), r() * 3, 0, 7); g.fill();
    }
    // Joints packed with dirt, chipped corners, and cracks.
    g.strokeStyle = "rgba(22,20,18,0.6)"; g.lineWidth = 3;
    for (let x = 0; x <= w; x += S) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += S) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.strokeStyle = "rgba(15,14,12,0.55)"; g.lineWidth = 1.5;
    for (let i = 0; i < 9; i++) { g.beginPath(); let x = Math.round(r() * 2) * S, y = r() * h; g.moveTo(x, y); for (let k = 0; k < 7; k++) { x += r() * 38; y += (r() - 0.5) * 40; g.lineTo(x, y); } g.stroke(); }
    grime(g, w, h, r, 1.5);
    // Gum: flattened grey-black dots everywhere.
    for (let i = 0; i < 90; i++) { g.fillStyle = r() < 0.6 ? "rgba(35,34,32,0.5)" : "rgba(170,168,160,0.45)"; g.beginPath(); g.ellipse(r() * w, r() * h, 1.5 + r() * 3.5, 1.5 + r() * 3, 0, 0, 7); g.fill(); }
  });
}
// A soft blob with a ragged edge: alpha for puddles and oil stains on the ground.
export function blob(seed = 1) {
  return canvasTex("blob" + seed, 256, 256, (g, w, h) => {
    const r = rnd(seed);
    g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) {
      const x = w / 2 + (r() - 0.5) * w * 0.45, y = h / 2 + (r() - 0.5) * h * 0.3, rad = w * (0.12 + r() * 0.16);
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.7, "rgba(255,255,255,0.85)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }
  }, { srgb: false, repeat: false });
}
export function corrugated(base = "#9aa0a3", seed = 17) {
  return canvasTex("corr" + base + seed, 256, 256, (g, w, h) => {
    const r = rnd(seed);
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 8) {
      const gr = g.createLinearGradient(x, 0, x + 8, 0);
      gr.addColorStop(0, "rgba(0,0,0,0.25)"); gr.addColorStop(0.5, "rgba(255,255,255,0.12)"); gr.addColorStop(1, "rgba(0,0,0,0.25)");
      g.fillStyle = gr; g.fillRect(x, 0, 8, h);
    }
    // Rust.
    for (let i = 0; i < 25; i++) { g.fillStyle = "rgba(120,60,20," + (0.1 + r() * 0.25) + ")"; g.beginPath(); g.ellipse(r() * w, r() * h, 4 + r() * 30, 4 + r() * 18, 0, 0, 7); g.fill(); }
    grime(g, w, h, r, 1);
  });
}

// A facade: one floor tall, two window bays wide (repeat to fit). Returns { map, emissive } where the
// emissive map lights some windows (seeded) for night.
export function facade(kind = "brick", base = "#7a3b2b", seed = 1) {
  const key = "fac" + kind + base + seed;
  if (cache[key]) return cache[key];
  const wall = kind === "brick" ? brick(base, "#4f4943", seed) : kind === "siding" ? siding(base, seed) : kind === "glass" ? null : concrete(base, seed);
  const r = rnd(seed * 31 + 7);
  const W = 256, H = 256;
  const lit = [];
  const map = canvasTex(key + "m", W, H, (g) => {
    if (wall) g.drawImage(wall.image, 0, 0, W, H);
    else {
      const glass = g.createLinearGradient(0, 0, W, H);
      glass.addColorStop(0, "#526c7b"); glass.addColorStop(0.42, base); glass.addColorStop(1, "#263b4c");
      g.fillStyle = glass; g.fillRect(0, 0, W, H);
      for (let x = 0; x < W; x += 16) { g.fillStyle = x % 32 ? "rgba(175,205,218,0.07)" : "rgba(8,16,25,0.11)"; g.fillRect(x, 0, 8, H); }
      for (let y = 0; y < H; y += 64) { g.fillStyle = "rgba(220,229,232,0.13)"; g.fillRect(0, y, W, 3); }
    }
    if (kind !== "glass") {
      g.fillStyle = "rgba(255,255,255,0.13)"; g.fillRect(0, 10, W, 3);
      g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(0, 242, W, 5);
      g.fillStyle = "rgba(0,0,0,0.14)"; g.fillRect(5, 0, 3, H); g.fillRect(W - 8, 0, 3, H);
    }
    for (let b = 0; b < 2; b++) {
      const x = 28 + b * 128, y = 50, ww = 72, wh = kind === "glass" ? 160 : 120;
      const state = r();   // lit / dark / boarded / broken
      const metal = kind === "glass" ? "#8195a0" : "#c6bda9";
      g.fillStyle = "rgba(0,0,0,0.42)"; g.fillRect(x - 7, y - 7, ww + 14, wh + 14);
      g.fillStyle = metal; g.fillRect(x - 4, y - 4, ww + 8, wh + 8);
      if (state < 0.18 && kind !== "glass") {
        g.fillStyle = "#554c42"; g.fillRect(x, y, ww, wh);
        g.fillStyle = "#87765c"; g.fillRect(x + 3, y + 4, ww - 6, 4);
        g.strokeStyle = "rgba(0,0,0,0.56)"; g.lineWidth = 2;
        for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(x, y + k * 20 + 10); g.lineTo(x + ww, y + k * 20 + 10); g.stroke(); }
        lit.push(0);
      } else {
        const gr = g.createLinearGradient(x, y, x + ww, y + wh);
        gr.addColorStop(0, kind === "glass" ? "#25485b" : "#344a58"); gr.addColorStop(0.5, "#15232d"); gr.addColorStop(1, "#09121a");
        g.fillStyle = gr; g.fillRect(x, y, ww, wh);
        const reflection = g.createLinearGradient(x, y, x + ww * 0.8, y + wh * 0.2);
        reflection.addColorStop(0, "rgba(205,229,236,0.28)"); reflection.addColorStop(0.45, "rgba(160,190,210,0.1)"); reflection.addColorStop(1, "rgba(160,190,210,0)");
        g.fillStyle = reflection; g.fillRect(x + 3, y + 3, ww * 0.44, wh - 6);
        if (state > 0.28 && state < 0.43) { g.fillStyle = "rgba(221,192,146,0.24)"; g.fillRect(x + 5, y + 8, ww - 10, wh * 0.46); g.fillStyle = "rgba(24,21,18,0.34)"; g.fillRect(x + 5, y + wh * 0.53, ww - 10, wh * 0.43); }
        g.fillStyle = "#24292a"; g.fillRect(x + ww / 2 - 2, y, 4, wh); g.fillRect(x, y + wh / 2 - 2, ww, 4);
        g.fillStyle = "rgba(230,238,236,0.42)"; g.fillRect(x + 6, y + 6, 2, wh - 12); g.fillRect(x + 5, y + wh - 7, ww - 10, 2);
        g.fillStyle = kind === "glass" ? "#70838d" : "#514b43"; g.fillRect(x - 8, y + wh + 5, ww + 16, 7);
        if (kind !== "glass") { g.fillStyle = "rgba(255,255,255,0.12)"; g.fillRect(x - 5, y - 10, ww + 10, 4); }
        if (state > 0.88) { g.strokeStyle = "rgba(220,220,220,0.5)"; g.beginPath(); g.moveTo(x + 10, y + 20); g.lineTo(x + 40, y + 60); g.lineTo(x + 30, y + 90); g.stroke(); }
        lit.push(state > 0.45 && state < 0.88 ? 1 : 0);
      }
    }
  });
  const emissive = canvasTex(key + "e", W, H, (g) => {
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    for (let b = 0; b < 2; b++) {
      if (!lit[b]) continue;
      const x = 28 + b * 128, y = 50, ww = 72, wh = kind === "glass" ? 160 : 120;
      g.fillStyle = r() < 0.5 ? "#ffcf7a" : "#b8d0ff";
      g.fillRect(x, y, ww, wh);
      g.fillStyle = "rgba(0,0,0,0.4)"; g.fillRect(x + ww / 2 - 2, y, 4, wh); g.fillRect(x, y + wh / 2 - 2, ww, 4);
    }
  });
  return (cache[key] = { map, emissive });
}

export function sign(text, bg = "#151515", fg = "#ffd23a", w = 512, h = 128) {
  return canvasTex("sign" + text + bg + fg, w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = fg;
    g.font = "900 " + Math.round(h * 0.52) + "px Impact, 'Arial Black', sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, w / 2, h / 2 + 4, w - 40);
  }, { repeat: false });
}
const TAGS = ["FLATS", "PH", "HOLLOW", "KING", "REX", "DUKE", "WEST", "NOVA", "ACE", "LOCO"];
export function graffiti(seed) {
  return canvasTex("graf" + seed, 256, 128, (g, w, h) => {
    const r = rnd(seed * 97);
    g.clearRect(0, 0, w, h);
    const t = TAGS[Math.floor(r() * TAGS.length)];
    const hue = Math.floor(r() * 360);
    g.font = "italic 900 54px Impact, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 10; g.strokeStyle = "hsl(" + hue + ",80%,20%)"; g.strokeText(t, w / 2, h / 2, w - 20);
    g.fillStyle = "hsl(" + hue + ",85%,58%)"; g.fillText(t, w / 2, h / 2, w - 20);
    for (let i = 0; i < 8; i++) { g.fillStyle = "hsla(" + hue + ",85%,58%,0.7)"; g.fillRect(w * 0.2 + r() * w * 0.6, h * 0.65, 2, 10 + r() * 30); }
  }, { repeat: false });
}
// Soft round light pool for the ground under a lamp (additive).
export function glow() {
  return canvasTex("glow", 128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, "rgba(255,210,140,1)"); gr.addColorStop(0.4, "rgba(255,190,110,0.45)"); gr.addColorStop(1, "rgba(255,170,90,0)");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, { repeat: false });
}
export function flame() {
  return canvasTex("flame", 64, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h * 0.75, 2, w / 2, h * 0.6, h * 0.55);
    gr.addColorStop(0, "rgba(255,250,200,1)"); gr.addColorStop(0.3, "rgba(255,170,40,0.9)"); gr.addColorStop(0.7, "rgba(200,60,10,0.4)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.beginPath(); g.ellipse(w / 2, h * 0.62, w * 0.45, h * 0.5, 0, 0, 7); g.fill();
  }, { repeat: false });
}
