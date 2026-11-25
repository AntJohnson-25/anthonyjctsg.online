// Main Street's shop fronts (2026-11-24, user: "refine the details of the buildings and signage like we did to the storefronts
// in Run It Up"). Ported from Run It Up's textures.js brand system: every business has its own BRAND (colours, lettering,
// icon, what shows in its window, its ground-floor finish), and from that: a big lit sign plate across the front (spaced
// lettering drawn the plate's own shape, never squeezed), a blade sign out over the sidewalk, an awning with the name on
// its valance, a chalkboard A-frame, and a painted, lit view through the shop windows. All names are fictional.
import * as THREE from "three";
import { canvasTex } from "./textures.js";

function rnd(seed) { let s = Math.abs(seed | 0) % 2147483646 || 1; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; }

const WIDE = "'Arial Black', 'Segoe UI Black', Arial, sans-serif";
const SERIF = "'Georgia', 'Times New Roman', serif";

// ---------------------------------------------------------------- the brands (key = the BUILDINGS id in world.js)
// view = what is painted in its windows, clad = ground-floor finish, chalk = A-frame lines (false = none), line2 = the
// second line of a long name on the big sign.
export const BRANDS = {
  mentor: { name: "IRONWOOD", line2: "ACQUISITIONS", sub: "WE BUY HOUSES · CASH · AS-IS", short: "IRONWOOD", fg: "#f0e2c0", glow: "#d8a24a", bg: ["#2a1d14", "#140e08"], trim: "#c9a24a", face: SERIF, weight: "bold", awning: "#2a1d14", stripe: "#c9a24a", icon: "house", view: "office", clad: "stone", chalk: false },
  title: { name: "SOUTHLINE", line2: "TITLE & ESCROW", sub: "CLOSINGS · DEEDS · SEARCHES", short: "SOUTHLINE", fg: "#e4eefc", glow: "#7aa8e8", bg: ["#1b2636", "#0c121c"], trim: "#9ab8e0", face: WIDE, weight: "900", awning: "#1b2636", stripe: "#9ab8e0", icon: "key", view: "office", clad: "stone", chalk: false },
  diner: { name: "KETTLE DINER", sub: "OPEN LATE · PIE · BREAKFAST ALL DAY", short: "DINER", fg: "#fff2e0", glow: "#ff5a4a", bg: ["#5a1a14", "#2a0a08"], trim: "#f2e8d4", face: WIDE, weight: "900", awning: "#b8261c", stripe: "#f2e8d4", stripes: true, icon: "cup", view: "diner", clad: "brick", chalk: [["PIE OF THE DAY", 0.1], ["$4", 0.2], ["BREAKFAST ALL DAY", 0.07]] },
  barber: { name: "FADE & FLOW", sub: "BARBERS · CUTS · LINE-UPS", short: "FADE", fg: "#ffffff", glow: "#ff3a3a", bg: ["#1a1e2c", "#0b0e16"], trim: "#e8e4da", face: SERIF, weight: "bold", awning: "#1d3a8a", stripe: "#e8e4da", stripes: true, icon: "scissors", view: "barber", clad: "boards", chalk: [["CUTS $25", 0.13], ["WALK-INS", 0.14], ["LINE-UPS · SHAVES", 0.07]] },
  hardware: { name: "PLUMB & NAIL", sub: "HARDWARE · LUMBER · PAINT · KEYS CUT", short: "HARDWARE", fg: "#fff4d8", glow: "#ffb02a", bg: ["#2a2208", "#141004"], trim: "#e0a020", face: WIDE, weight: "900", awning: "#2c4a2e", stripe: "#f2e8d4", stripes: true, icon: "wrench", view: "hardware", clad: "metal", chalk: [["KEYS CUT", 0.13], ["$3", 0.2], ["PAINT · LUMBER", 0.08]] },
  lender: { name: "COBBLESTONE", line2: "BRIDGE CAPITAL", sub: "HARD MONEY · FAST CLOSINGS", short: "COBBLE", fg: "#f4f0e0", glow: "#9ab4d4", bg: ["#1e2a3c", "#0c121c"], trim: "#c0cbd8", face: SERIF, weight: "bold", awning: "#1e2a3c", stripe: "#c0cbd8", icon: "bank", view: "office", clad: "stone", chalk: false },
  agent: { name: "PECAN HOLLOW", line2: "REALTY", sub: "HOMES · LISTINGS · SHOWINGS", short: "REALTY", fg: "#fff6ea", glow: "#ff9a6a", bg: ["#5a3420", "#2a160a"], trim: "#f2c8a0", face: WIDE, weight: "900", awning: "#8a4a2a", stripe: "#f2e8d4", icon: "house", view: "agent", clad: "stone", chalk: [["OPEN HOUSE", 0.12], ["SAT 1-4", 0.18], ["HOMES FOR SALE", 0.07]] },
  pawn: { name: "SECOND CHANCE", sub: "PAWN & LOAN · GOLD · TOOLS · GUITARS", short: "PAWN", fg: "#ffe9a8", glow: "#ffcf3a", bg: ["#241a2e", "#100a16"], trim: "#d4b25a", face: WIDE, weight: "900", awning: "#3a2a4a", stripe: "#d4b25a", icon: "dollar", view: "pawn", clad: "brick", bars: true, chalk: [["WE BUY GOLD", 0.11], ["CASH NOW", 0.16], ["LOANS · TOOLS", 0.08]] },
  bank: { name: "HERITAGE", line2: "SAVINGS", sub: "SINCE 1951 · MEMBER FDIC-STYLE · ATM", short: "HERITAGE", fg: "#fff4d0", glow: "#e8c860", bg: ["#16283e", "#0a1220"], trim: "#d8b860", face: SERIF, weight: "bold", awning: "#16283e", stripe: "#d8b860", icon: "bank", view: "bank", clad: "stone", chalk: false },
  home: { name: "MAPLE COURT", line2: "APARTMENTS", sub: "RESIDENTS ONLY · NOW LEASING", short: "MAPLE CT", fg: "#fdf0dc", glow: "#ffb86a", bg: ["#3a2a1a", "#1c1208"], trim: "#d8a860", face: SERIF, weight: "bold", awning: "#5a3a22", stripe: "#d8a860", icon: "key", view: "home", clad: "brick", chalk: false },
  pharmacy: { name: "HOLLOW DRUG", sub: "PHARMACY · PRESCRIPTIONS · OPEN LATE", short: "DRUG", fg: "#ffffff", glow: "#3ad48a", bg: ["#0f5a34", "#063018"], trim: "#3ad48a", face: WIDE, weight: "900", awning: "#0f5a34", stripe: "#ffffff", icon: "cross", view: "pharmacy", clad: "stone", chalk: [["FLU SHOTS", 0.12], ["WALK-IN", 0.16], ["DRIVE-UP SOON", 0.07]] },
  laundry: { name: "SUDS LAUNDRY", sub: "WASH & FOLD · OPEN 24 HOURS", short: "SUDS", fg: "#e6fbff", glow: "#4ac8ff", bg: ["#10304a", "#081826"], trim: "#7ad4ff", face: WIDE, weight: "900", awning: "#1c4a8a", stripe: "#e6f2f8", icon: "bubbles", view: "laundry", clad: "metal", chalk: [["WASH $2", 0.13], ["DRY $1", 0.16], ["WASH & FOLD", 0.08]] },
  taco: { name: "EL CAMION TACOS", sub: "COCINA CASERA · TACOS · TORTAS", short: "TACOS", fg: "#fff4dc", glow: "#ff6a2a", bg: ["#5a1410", "#2a0806"], trim: "#ffcf3a", face: WIDE, weight: "900", awning: "#2f7a3e", stripe: "#f8f4ea", stripes: true, icon: "taco", view: "diner", clad: "stucco", chalk: [["TACOS $2", 0.13], ["AL PASTOR", 0.14], ["AGUAS FRESCAS", 0.07]] },
  coffee: { name: "BEAN THERE", sub: "COFFEE · PASTRIES · FRESH DAILY", short: "COFFEE", fg: "#ffe6b8", glow: "#ffb84a", bg: ["#3b2416", "#24150c"], trim: "#c8955a", face: SERIF, weight: "bold", awning: "#2f5a3e", stripe: "#efe4cf", stripes: true, icon: "cup", view: "coffee", clad: "boards", chalk: [["COFFEE & CAKE", 0.11], ["$4", 0.2], ["LATTE OF THE DAY", 0.07]] },
  offices: { name: "CIVIC PLAZA", line2: "OFFICES", sub: "SUITES FOR LEASE · 555-0143", short: "CIVIC", fg: "#eef2f4", glow: "#9ac0cc", bg: ["#26343a", "#10181c"], trim: "#aac4cc", face: WIDE, weight: "900", awning: "#26343a", stripe: "#aac4cc", icon: "bank", view: "office", clad: "stone", chalk: false },
  tire: { name: "AXLE TIRE & BRAKE", sub: "WHILE YOU WAIT · RIMS · ALIGNMENTS", short: "AXLE", fg: "#fff0dc", glow: "#ff9a3a", bg: ["#2a1c10", "#140c06"], trim: "#ff9a3a", face: WIDE, weight: "900", awning: "#3a2410", stripe: "#ff9a3a", icon: "wrench", view: "garage", clad: "metal", chalk: [["OIL CHANGE", 0.13], ["$39", 0.2], ["TIRES · BRAKES", 0.08]] },
  records: { name: "COUNTY RECORDS", line2: "DEEDS & PERMITS", sub: "MON-FRI 8-5 · TAKE A NUMBER", short: "RECORDS", fg: "#f4efe2", glow: "#cbbd98", bg: ["#3a362c", "#1c1a14"], trim: "#cbbd98", face: SERIF, weight: "bold", awning: "#3a362c", stripe: "#cbbd98", icon: "bank", view: "office", clad: "stone", chalk: false }
};

// ---------------------------------------------------------------- sign lettering (wide face, real letter spacing, sized to fit)
function trackedWidth(g, text, track) { let w = 0; for (const ch of text) w += g.measureText(ch).width; return w + track * Math.max(0, [...text].length - 1); }
function trackedText(g, text, cx, cy, track, how = "fill") {
  const al = g.textAlign; g.textAlign = "left";
  let x = cx - trackedWidth(g, text, track) / 2;
  for (const ch of text) { if (how === "stroke") g.strokeText(ch, x, cy); else g.fillText(ch, x, cy); x += g.measureText(ch).width + track; }
  g.textAlign = al;
}
function fitTracked(g, text, weight, family, maxW, maxH, trackK) {
  let px = Math.floor(maxH);
  for (; px > 8; px -= 2) { g.font = weight + " " + px + "px " + family; if (trackedWidth(g, text, px * trackK) <= maxW) break; }
  g.font = weight + " " + px + "px " + family;
  return px;
}
function neonLine(g, text, cx, cy, px, track, fg) {
  g.textBaseline = "middle"; g.lineJoin = "round";
  g.lineWidth = Math.max(3, px * 0.06); g.strokeStyle = "rgba(0,0,0,0.85)"; trackedText(g, text, cx, cy, track, "stroke");
  g.save(); g.shadowColor = fg; g.shadowBlur = Math.max(6, px * 0.12); g.fillStyle = fg; trackedText(g, text, cx, cy, track); g.restore();
  g.save(); g.globalAlpha = 0.35; g.fillStyle = "#ffffff"; trackedText(g, text, cx, cy - px * 0.02, track); g.restore();
}
const brandLine = (g, B, text, cx, cy, px, track) => neonLine(g, text, cx, cy, px, track, B.fg);

function brandIcon(g, kind, cx, cy, s, col) {
  g.save(); g.translate(cx, cy); g.scale(s / 100, s / 100);
  g.fillStyle = col; g.strokeStyle = col; g.lineCap = "round"; g.lineJoin = "round";
  if (kind === "cup") {
    g.beginPath(); g.moveTo(-34, -14); g.lineTo(30, -14); g.lineTo(24, 38); g.quadraticCurveTo(-2, 46, -28, 38); g.closePath(); g.fill();
    g.lineWidth = 9; g.beginPath(); g.arc(34, 8, 14, -Math.PI / 2, Math.PI / 2); g.stroke();
    g.lineWidth = 6; for (const x of [-16, 0, 16]) { g.beginPath(); g.moveTo(x, -24); g.bezierCurveTo(x - 9, -36, x + 9, -44, x, -58); g.stroke(); }
  } else if (kind === "dollar") {
    g.font = "900 110px Arial Black, Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("$", 0, 6);
  } else if (kind === "key") {
    g.lineWidth = 10; g.beginPath(); g.arc(-22, 0, 20, 0, Math.PI * 2); g.stroke();
    g.fillRect(-2, -5, 56, 10); g.fillRect(36, 5, 8, 16); g.fillRect(48, 5, 8, 12);
  } else if (kind === "wrench") {
    g.save(); g.rotate(-Math.PI / 4); g.fillRect(-8, -30, 16, 70);
    g.beginPath(); g.arc(0, -38, 20, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = "destination-out"; g.fillRect(-7, -62, 14, 28); g.restore();
  } else if (kind === "cross") {
    g.fillRect(-14, -42, 28, 84); g.fillRect(-42, -14, 84, 28);
  } else if (kind === "scissors") {
    g.lineWidth = 8;
    for (const s2 of [-1, 1]) { g.beginPath(); g.arc(s2 * 20, 28, 13, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(s2 * 14, 17); g.lineTo(-s2 * 18, -46); g.stroke(); }
  } else if (kind === "house") {
    g.beginPath(); g.moveTo(-46, -2); g.lineTo(0, -44); g.lineTo(46, -2); g.closePath(); g.fill();
    g.fillRect(-34, -4, 68, 46);
    g.globalCompositeOperation = "destination-out"; g.fillRect(-10, 12, 20, 30); g.globalCompositeOperation = "source-over";
  } else if (kind === "bank") {
    g.beginPath(); g.moveTo(-50, -18); g.lineTo(0, -46); g.lineTo(50, -18); g.closePath(); g.fill();
    for (const x of [-36, -12, 12, 36]) g.fillRect(x - 6, -12, 12, 40);
    g.fillRect(-52, 30, 104, 10);
  } else if (kind === "taco") {
    g.beginPath(); g.arc(0, 18, 46, Math.PI, Math.PI * 2); g.closePath(); g.fill();
    g.fillStyle = "#3ad46a"; for (const x of [-30, -10, 10, 30]) { g.beginPath(); g.arc(x, -22, 9, 0, Math.PI * 2); g.fill(); }
  } else if (kind === "bubbles") {
    g.lineWidth = 7; for (const [x, y, r] of [[-18, 10, 24], [20, -12, 18], [22, 26, 12]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); }
  }
  g.restore();
}

// The big sign over the shop window. aspect = plate width / height (the canvas is drawn that shape).
export function brandSign(id, aspect = 4.5) {
  aspect = Math.round(aspect * 4) / 4;
  const B = BRANDS[id], w = 1024, h = Math.max(160, Math.round(w / aspect));
  return canvasTex("dd-brand-" + id + "@" + aspect.toFixed(2), w, h, (g) => {
    const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, B.bg[0]); bg.addColorStop(1, B.bg[1]);
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.save(); g.shadowColor = B.glow; g.shadowBlur = 14; g.strokeStyle = B.trim; g.lineWidth = 7; g.strokeRect(18, 18, w - 36, h - 36); g.restore();
    g.strokeStyle = "rgba(255,255,255,0.12)"; g.lineWidth = 2; g.strokeRect(30, 30, w - 60, h - 60);
    const icon = Math.min(h * 0.5, 120), side = icon + 70;
    brandIcon(g, B.icon, 40 + icon / 2 + 10, h / 2, icon, B.trim);
    brandIcon(g, B.icon, w - 40 - icon / 2 - 10, h / 2, icon, B.trim);
    const tw = w - side * 2, nameH = (h - 60) * 0.56;
    if (B.line2) {
      const p1 = fitTracked(g, B.name, B.weight, B.face, tw, (h - 60) * 0.4, 0.14);
      const p2 = Math.min(Math.floor(p1 * 0.78), fitTracked(g, B.line2, B.weight, B.face, tw * 0.92, (h - 60) * 0.3, 0.2));
      const y1 = 30 + (h - 60) * 0.25, y2 = y1 + p1 * 0.55 + p2 * 0.62;
      g.font = B.weight + " " + p1 + "px " + B.face; brandLine(g, B, B.name, w / 2, y1, p1, p1 * 0.14);
      g.font = B.weight + " " + p2 + "px " + B.face; brandLine(g, B, B.line2, w / 2, y2, p2, p2 * 0.2);
      if (B.sub) {
        const sp = fitTracked(g, B.sub, "bold", "Arial, sans-serif", tw * 0.7, (h - 60) * 0.11, 0.25);
        g.fillStyle = B.trim; g.textBaseline = "middle"; trackedText(g, B.sub, w / 2, Math.min(h - 36 - sp * 0.5, y2 + p2 * 0.5 + sp * 0.9), sp * 0.25);
      }
      return;
    }
    const px = fitTracked(g, B.name, B.weight, B.face, tw, nameH, 0.16);
    const ny = h / 2 - (h - 60) * 0.1;
    brandLine(g, B, B.name, w / 2, ny, px, px * 0.16);
    g.save(); g.shadowColor = B.glow; g.shadowBlur = 10; g.fillStyle = B.glow; g.fillRect(w / 2 - tw * 0.36, ny + px * 0.56, tw * 0.72, Math.max(3, px * 0.035)); g.restore();
    const sp = fitTracked(g, B.sub, "bold", "Arial, sans-serif", tw * 0.9, (h - 60) * 0.15, 0.25);
    g.fillStyle = B.trim; g.textBaseline = "middle"; trackedText(g, B.sub, w / 2, ny + px * 0.56 + sp * 1.05, sp * 0.25);
  }, { repeat: false });
}
// The blade sign sticking out over the sidewalk: the icon over the short name. aspect = w / h.
export function bladeSign(id, aspect = 0.8) {
  const B = BRANDS[id], w = 384, h = Math.round(w / aspect);
  return canvasTex("dd-blade-" + id + "@" + aspect.toFixed(2), w, h, (g) => {
    const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, B.bg[0]); bg.addColorStop(1, B.bg[1]);
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.save(); g.shadowColor = B.glow; g.shadowBlur = 12; g.strokeStyle = B.trim; g.lineWidth = 7; g.strokeRect(14, 14, w - 28, h - 28); g.restore();
    brandIcon(g, B.icon, w / 2, h * 0.36, Math.min(w * 0.5, h * 0.4), B.trim);
    const px = fitTracked(g, B.short, B.weight, B.face, w - 60, h * 0.2, 0.12);
    brandLine(g, B, B.short, w / 2, h * 0.76, px, px * 0.12);
  }, { repeat: false });
}
// The awning's front flap with the name printed on it. aspect = w / h (very wide).
export function valance(id, aspect = 20) {
  aspect = Math.max(4, Math.round(aspect / 2) * 2);
  const B = BRANDS[id], w = 2048, h = Math.max(48, Math.round(w / aspect));
  return canvasTex("dd-val-" + id + "@" + aspect.toFixed(1), w, h, (g) => {
    g.fillStyle = B.awning; g.fillRect(0, 0, w, h);
    g.fillStyle = B.stripe; g.fillRect(0, h - 12, w, 6); g.fillRect(0, 4, w, 3);
    const name = B.line2 ? B.name + " " + B.line2 : B.name;
    const px = fitTracked(g, name, B.weight, B.face, w * (B.line2 ? 0.7 : 0.5), h * 0.52, 0.2);
    g.fillStyle = B.stripe; g.textBaseline = "middle"; trackedText(g, name, w / 2, h / 2 - 2, px * 0.2);
  }, { repeat: false });
}
// Awning cloth: stripes in the shop's colours, or a plain weave. Tiles every 2 m across.
export function awningCloth(id) {
  const B = BRANDS[id];
  return canvasTex("dd-awncloth-" + id, 256, 64, (g, w, h) => {
    g.fillStyle = B.awning; g.fillRect(0, 0, w, h);
    if (B.stripes) { g.fillStyle = B.stripe; for (let x = 0; x < w; x += 64) g.fillRect(x, 0, 32, h); }
    else { g.fillStyle = "rgba(255,255,255,0.05)"; for (let x = 0; x < w; x += 6) g.fillRect(x, 0, 1, h); }
    const sh = g.createLinearGradient(0, 0, 0, h); sh.addColorStop(0, "rgba(0,0,0,0.22)"); sh.addColorStop(1, "rgba(255,255,255,0.06)");
    g.fillStyle = sh; g.fillRect(0, 0, w, h);
  });
}
export function barberPole() {
  return canvasTex("dd-barberpole", 128, 256, (g, w, h) => {
    g.fillStyle = "#f4f1ea"; g.fillRect(0, 0, w, h); g.lineWidth = 22;
    for (let k = -4; k < 10; k++) { g.strokeStyle = k % 2 ? "#d82a2a" : "#2a4ad8"; g.beginPath(); g.moveTo(-20, k * 48); g.lineTo(w + 20, k * 48 + 90); g.stroke(); }
  });
}
// The chalkboard A-frame by the door.
export function chalkBoard(id) {
  const B = BRANDS[id], L = B.chalk;
  return canvasTex("dd-chalk-" + id, 256, 384, (g, w, h) => {
    g.fillStyle = "#5a3a22"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#1f2422"; g.fillRect(14, 14, w - 28, h - 28);
    g.fillStyle = "#f2efe6"; g.textBaseline = "middle";
    let y = h * 0.24;
    for (const [t, k] of L) { const px = fitTracked(g, t, "bold", "'Segoe Print', 'Comic Sans MS', Arial, sans-serif", w - 56, h * k, 0.05); trackedText(g, t, w / 2, y, px * 0.05); y += h * 0.25; }
    g.strokeStyle = B.trim; g.lineWidth = 4; g.beginPath(); g.moveTo(50, h - 44); g.quadraticCurveTo(w / 2, h - 62, w - 50, h - 44); g.stroke();
  }, { repeat: false });
}

// ---------------------------------------------------------------- what you see through the glass (painted, lit)
// shelves/hardware/pawn/laundry/pharmacy = stores, diner/coffee = a counter and tables, office/bank/agent = desks and listings,
// garage = rims and tyres, barber = chairs and mirrors, home = curtains and a lamp.
export function paintView(g, view, w, h, B, seed) {
  const r = rnd(seed), fy = h * 0.64;
  const wall = { shelves: ["#f0ead8", "#d8ccb0"], hardware: ["#d8d2c0", "#a89e84"], pawn: ["#3a2c40", "#1c1422"], laundry: ["#e8f2f6", "#b8ccd4"], pharmacy: ["#f4fbf6", "#d4e6da"],
    diner: ["#f0e4cc", "#c8a878"], coffee: ["#6a4428", "#3a2214"], office: ["#3a3022", "#22190f"], bank: ["#e8e0cc", "#b8aa88"], agent: ["#f2ece0", "#d0c4ac"], home: ["#5a4632", "#2a1e14"],
    garage: ["#c8ccd0", "#8a8e92"], barber: ["#efe8da", "#d0c4ac"] }[view] || ["#e0d8c8", "#b8ae98"];
  const bk = g.createLinearGradient(0, 0, 0, h); bk.addColorStop(0, wall[0]); bk.addColorStop(fy / h, wall[1]); bk.addColorStop(fy / h, "#4a4036"); bk.addColorStop(1, "#2a241e");
  g.fillStyle = bk; g.fillRect(0, 0, w, h);
  for (let x = w * 0.12; x < w; x += w * 0.25) {
    const lg = g.createRadialGradient(x, h * 0.06, 0, x, h * 0.06, h * 0.34); lg.addColorStop(0, view === "home" || view === "office" || view === "coffee" || view === "pawn" ? "rgba(255,210,140,0.9)" : "rgba(255,255,245,0.95)"); lg.addColorStop(1, "rgba(255,240,200,0)");
    g.fillStyle = lg; g.fillRect(x - h * 0.4, 0, h * 0.8, h * 0.5);
  }
  const cols = ["#d83a2a", "#2a6ad8", "#f2c230", "#3ab85a", "#e86a2a", "#8a4ad0", "#f2efe8", "#2a2a2e"];
  g.textAlign = "center"; g.textBaseline = "middle";
  if (view === "shelves" || view === "pharmacy") {
    for (let row = 0; row < 4; row++) {
      const y = h * (0.14 + row * 0.12);
      g.fillStyle = "#7a6a52"; g.fillRect(w * 0.04, y + h * 0.09, w * 0.56, 3);
      for (let x = w * 0.05; x < w * 0.59; x += w * 0.022) { g.fillStyle = view === "pharmacy" && r() < 0.5 ? "#3ab87a" : cols[Math.floor(r() * cols.length)]; g.fillRect(x, y + h * (0.02 + r() * 0.02), w * 0.018, h * 0.07); }
    }
    g.fillStyle = "#cfe8f0"; g.fillRect(w * 0.7, h * 0.12, w * 0.24, fy - h * 0.12);
    for (let k = 0; k < 3; k++) { g.fillStyle = "#8a9aa4"; g.fillRect(w * 0.7, h * (0.24 + k * 0.13), w * 0.24, 2); for (let j = 0; j < 8; j++) { g.fillStyle = cols[(j + k) % cols.length]; g.fillRect(w * (0.71 + j * 0.028), h * (0.16 + k * 0.13), w * 0.02, h * 0.07); } }
    if (view === "pharmacy") { g.fillStyle = "#18a860"; g.fillRect(w * 0.1, h * 0.04, w * 0.05, h * 0.1); g.fillRect(w * 0.075, h * 0.065, w * 0.1, h * 0.05); }
    g.fillStyle = "#3a2a1c"; g.fillRect(w * 0.02, fy - h * 0.12, w * 0.3, h * 0.12);
  } else if (view === "hardware") {
    g.fillStyle = "#6a5a42"; g.fillRect(w * 0.04, h * 0.1, w * 0.5, h * 0.34);   // pegboard of tools
    g.fillStyle = "#1a1c1e"; for (let k = 0; k < 16; k++) g.fillRect(w * (0.06 + (k % 8) * 0.06), h * (0.14 + Math.floor(k / 8) * 0.15), w * 0.015, h * 0.1);
    for (let k = 0; k < 6; k++) for (let j = 0; j < 3; j++) { g.fillStyle = cols[(k + j) % cols.length]; g.fillRect(w * (0.62 + k * 0.058), fy - h * 0.1 - j * h * 0.1, w * 0.048, h * 0.09); g.fillStyle = "#cfd2d4"; g.fillRect(w * (0.62 + k * 0.058), fy - h * 0.1 - j * h * 0.1, w * 0.048, 3); }   // paint cans
    g.fillStyle = "#8a6a3a"; for (let k = 0; k < 5; k++) g.fillRect(w * 0.06, fy - h * (0.04 + k * 0.025), w * 0.48, h * 0.02);   // lumber stack
  } else if (view === "pawn") {
    g.fillStyle = "#1a1a1e"; g.fillRect(w * 0.06, h * 0.14, w * 0.2, h * 0.22); g.fillStyle = "#4a7aaa"; g.fillRect(w * 0.075, h * 0.16, w * 0.17, h * 0.18);   // a TV
    for (const [x, c] of [[0.36, "#b0522a"], [0.46, "#d8c8a0"], [0.56, "#2a2a30"]]) {   // guitars
      g.fillStyle = c; g.beginPath(); g.ellipse(w * x, fy - h * 0.2, w * 0.03, h * 0.07, 0, 0, Math.PI * 2); g.fill(); g.fillRect(w * x - 2, fy - h * 0.42, 4, h * 0.2);
    }
    g.fillStyle = "#2a1c0e"; g.fillRect(w * 0.06, fy - h * 0.14, w * 0.88, h * 0.14);   // glass counter with gold under it
    g.fillStyle = "rgba(180,220,240,0.5)"; g.fillRect(w * 0.06, fy - h * 0.15, w * 0.88, h * 0.02);
    g.fillStyle = "#f2c230"; for (let k = 0; k < 9; k++) g.fillRect(w * (0.1 + k * 0.09), fy - h * 0.1, w * 0.04, h * 0.02);
  } else if (view === "laundry") {
    for (let k = 0; k < 4; k++) {
      const x = w * (0.12 + k * 0.22), y = h * 0.3;
      g.fillStyle = "#e8ecef"; g.fillRect(x - w * 0.08, y - h * 0.14, w * 0.16, fy - y + h * 0.14);
      g.fillStyle = "#2a3a48"; g.beginPath(); g.arc(x, y + h * 0.1, w * 0.06, 0, Math.PI * 2); g.fill();
      g.fillStyle = k % 2 ? "rgba(122,212,255,0.7)" : "rgba(255,255,255,0.35)"; g.beginPath(); g.arc(x, y + h * 0.1, w * 0.045, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = "#8a6a3a"; g.fillRect(w * 0.04, fy - h * 0.04, w * 0.92, h * 0.04);   // folding table
  } else if (view === "diner" || view === "coffee") {
    g.fillStyle = view === "coffee" ? "#1c1410" : "#2a1c14"; g.fillRect(w * 0.14, h * 0.14, w * 0.5, h * 0.18);
    g.fillStyle = "#f2e6cc"; g.font = "bold " + Math.round(h * 0.06) + "px Georgia, serif"; g.fillText(view === "coffee" ? "COFFEE · CAKE · DRINKS" : "BREAKFAST · PIE · COFFEE", w * 0.39, h * 0.23, w * 0.46);
    g.fillStyle = "#3a2214"; g.fillRect(w * 0.06, fy - h * 0.18, w * 0.62, h * 0.18);
    g.fillStyle = "#e9e2d4"; g.fillRect(w * 0.06, fy - h * 0.2, w * 0.62, h * 0.025);
    for (let k = 0; k < 5; k++) { g.fillStyle = "#b8261c"; g.beginPath(); g.ellipse(w * (0.12 + k * 0.12), fy + h * 0.02, w * 0.03, h * 0.015, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = "#555"; g.fillRect(w * (0.12 + k * 0.12) - 2, fy + h * 0.02, 4, h * 0.12); }   // stools
    for (const x of [0.78, 0.9]) { g.fillStyle = "#2a1a10"; g.beginPath(); g.ellipse(w * x, fy + h * 0.06, w * 0.05, h * 0.02, 0, 0, Math.PI * 2); g.fill(); g.fillRect(w * x - 2, fy + h * 0.06, 4, h * 0.2); g.fillStyle = "rgba(20,14,10,0.85)"; g.beginPath(); g.arc(w * (x - 0.045), fy - h * 0.12, h * 0.035, 0, Math.PI * 2); g.fill(); g.fillRect(w * (x - 0.062), fy - h * 0.09, h * 0.07, h * 0.12); }   // customers
  } else if (view === "office" || view === "agent" || view === "bank") {
    if (view === "agent") {
      for (let k = 0; k < 6; k++) { g.fillStyle = "#fff"; g.fillRect(w * (0.06 + k * 0.15), h * 0.12, w * 0.12, h * 0.2); g.fillStyle = cols[k % cols.length]; g.fillRect(w * (0.07 + k * 0.15), h * 0.13, w * 0.1, h * 0.12); g.fillStyle = "#555"; g.fillRect(w * (0.07 + k * 0.15), h * 0.27, w * 0.1, 3); }   // listing cards
    } else if (view === "bank") {
      g.fillStyle = "rgba(210,190,130,0.9)"; for (let k = 0; k < 4; k++) g.fillRect(w * (0.12 + k * 0.22), h * 0.12, w * 0.03, fy - h * 0.12);   // columns
      g.fillStyle = "#4a3a22"; g.fillRect(w * 0.06, fy - h * 0.12, w * 0.88, h * 0.12);   // teller counter
      g.fillStyle = "rgba(140,190,200,0.6)"; for (let k = 0; k < 3; k++) g.fillRect(w * (0.14 + k * 0.28), fy - h * 0.3, w * 0.16, h * 0.18);
    } else {
      g.fillStyle = "rgba(230,215,180,0.85)"; for (let y = 0; y < h * 0.4; y += 7) g.fillRect(0, y, w, 4);   // blinds half down
    }
    g.fillStyle = "#2a1a0e"; g.fillRect(w * 0.3, fy - h * 0.16, w * 0.42, h * 0.16);
    g.fillStyle = "#1a1a1a"; g.fillRect(w * 0.44, fy - h * 0.3, w * 0.14, h * 0.13);
    const lg = g.createRadialGradient(w * 0.68, fy - h * 0.24, 0, w * 0.68, fy - h * 0.24, h * 0.22); lg.addColorStop(0, "rgba(255,220,140,0.95)"); lg.addColorStop(1, "rgba(255,200,120,0)"); g.fillStyle = lg; g.fillRect(w * 0.5, fy - h * 0.5, w * 0.4, h * 0.5);
    g.fillStyle = "#c8a24a"; g.fillRect(w * 0.08, h * 0.46, w * 0.12, h * 0.1);
  } else if (view === "home") {
    const lg = g.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, h * 0.5); lg.addColorStop(0, "rgba(255,200,120,0.9)"); lg.addColorStop(1, "rgba(255,180,100,0)"); g.fillStyle = lg; g.fillRect(0, 0, w, h);
    for (const [x0, x1] of [[0, 0.3], [0.7, 1]]) { g.fillStyle = B.awning || "#6a2a2a"; g.fillRect(w * x0, 0, w * (x1 - x0), h); g.fillStyle = "rgba(0,0,0,0.25)"; for (let x = w * x0; x < w * x1; x += 14) g.fillRect(x, 0, 4, h); }
  } else if (view === "garage") {
    g.fillStyle = "#4a4e52"; g.fillRect(w * 0.05, h * 0.1, w * 0.3, h * 0.36);
    g.fillStyle = "#1a1c1e"; for (let k = 0; k < 14; k++) g.fillRect(w * (0.07 + (k % 7) * 0.04), h * (0.14 + Math.floor(k / 7) * 0.14), w * 0.012, h * 0.1);
    const metals = [["#f4f6f8", "#8a929c"], ["#f2d27a", "#8a6418"], ["#5a5e64", "#1c1e22"], ["#d8dde2", "#5e646c"]];
    const R = h * 0.075, x0 = w * 0.42, x1 = w * 0.97, n = Math.max(1, Math.floor((x1 - x0) / (R * 2.5)));
    for (let row = 0; row < 2; row++) for (let k = 0; k < n; k++) {
      const cx = x0 + (x1 - x0) * (k + 0.5) / n, cy = h * (0.17 + row * 0.19), m = metals[(k + row) % metals.length];
      g.fillStyle = "#0e0e10"; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
      const mgr = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R); mgr.addColorStop(0, m[0]); mgr.addColorStop(1, m[1]);
      g.fillStyle = mgr; g.beginPath(); g.arc(cx, cy, R * 0.7, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#0a0a0c"; g.beginPath(); g.arc(cx, cy, R * 0.58, 0, Math.PI * 2); g.fill();
      g.strokeStyle = m[0]; g.lineWidth = Math.max(2, R * 0.12); g.lineCap = "round";
      const sp = 5 + ((k + row) % 3);
      for (let i = 0; i < sp; i++) { const a = i * Math.PI * 2 / sp + k; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R * 0.58, cy + Math.sin(a) * R * 0.58); g.stroke(); }
      g.fillStyle = m[0]; g.beginPath(); g.arc(cx, cy, R * 0.15, 0, Math.PI * 2); g.fill();
    }
    const stacks = Math.max(2, Math.round(w / (h * 0.5))), tw = Math.min(w * 0.06, h * 0.08);
    for (let k = 0; k < stacks; k++) for (let j = 0; j < 3; j++) {
      const x = w * (k + 0.5) / stacks, y = fy - h * 0.03 - j * h * 0.042;
      g.fillStyle = j % 2 ? "#141416" : "#1a1a1c"; g.beginPath(); g.ellipse(x, y, tw, h * 0.026, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#050506"; g.beginPath(); g.ellipse(x, y - h * 0.006, tw * 0.5, h * 0.011, 0, 0, Math.PI * 2); g.fill();
    }
  } else if (view === "barber") {
    g.fillStyle = "rgba(190,215,225,0.6)"; g.fillRect(w * 0.06, h * 0.12, w * 0.88, h * 0.26);
    for (const x of [0.18, 0.5, 0.82]) {
      g.fillStyle = "#1a1a1e"; g.fillRect(w * x - w * 0.06, fy - h * 0.2, w * 0.12, h * 0.12); g.fillRect(w * x - w * 0.045, fy - h * 0.34, w * 0.09, h * 0.16);
      g.fillStyle = "#b8bcc0"; g.fillRect(w * x - 3, fy - h * 0.08, 6, h * 0.08);
    }
  }
  const sh = g.createLinearGradient(0, 0, w, h); sh.addColorStop(0, "rgba(255,255,255,0.10)"); sh.addColorStop(0.5, "rgba(255,255,255,0)"); sh.addColorStop(1, "rgba(255,255,255,0.06)");
  g.fillStyle = sh; g.fillRect(0, 0, w, h);
}
// A shop window as its own canvas (the storefront painter draws it into the glass openings).
export function viewCanvas(id, w, h) {
  const B = BRANDS[id], c = document.createElement("canvas"); c.width = Math.max(8, Math.round(w)); c.height = Math.max(8, Math.round(h));
  paintView(c.getContext("2d"), B.view, c.width, c.height, B, id.length * 17 + 3);
  return c;
}

// ---------------------------------------------------------------- layout, shared by the facade painter and the 3D fronts
// Ground floor 3.1 m of cladding and glass; the sign plate sits on it; upper-floor windows above the sign; cornice at the top.
export const GROUND = 3.1;
export function layout(b) {
  const top = b.h - 0.62;                       // under the cornice
  const room = b.h - 3.95;   // the housing, trim bars and lamps must clear the cornice
  const signH = Math.max(0.62, Math.min(2.1, room));
  const signW = Math.min(b.w - 2, signH * 6.2, 9);
  return { signY0: GROUND + 0.16, signH, signW, signY: GROUND + 0.16 + signH / 2, upperY0: GROUND + 0.16 + signH + 0.5, upperY1: b.h - 0.7 };
}
