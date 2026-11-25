// High-poly street greenery and the Glass Mile fountain (2026-11-06, user: "refine the trees and the water fountain on
// Glass Mile, use high poly"). Every builder returns parts in LOCAL space ({ k, geo }, base at the origin); street.js
// places them with its Merger, so a whole block of trees is still a handful of draw calls. `k` names the material
// (floraMat builds it). Leaves and fronds are alpha-tested cards over a solid inner volume, so a crown reads as full
// from any side and casts a leafy shadow.
import * as THREE from "three";
import { canvasTex, concrete } from "./textures.js";

function rnd(seed) { let s = Math.abs(seed | 0) % 2147483646 || 1; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; }
// Cheap smooth 3D value noise (-1..1) for bark bumps, shrub lumps and ripples.
function hash(x, y, z) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash(xi + dx, yi + dy, zi + dz);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w) * 2 - 1;
}

// ------------------------------------------------------------------ textures
const TEX = {
  // A cluster of broad leaves on transparent ground (oak/shrub cards).
  leaf: () => canvasTex("fl-leafcard", 512, 512, (g, w, h) => {
    const r = rnd(5);
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 230; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * w * 0.42, x = w / 2 + Math.cos(a) * d, y = h / 2 + Math.sin(a) * d;
      const L = 22 + r() * 20, Wd = L * 0.48, rot = r() * Math.PI * 2, sh = r();
      g.save(); g.translate(x, y); g.rotate(rot);
      g.fillStyle = `hsl(${100 + sh * 26},${38 + sh * 20}%,${20 + sh * 22}%)`;
      g.beginPath(); g.moveTo(-L / 2, 0); g.quadraticCurveTo(0, -Wd, L / 2, 0); g.quadraticCurveTo(0, Wd, -L / 2, 0); g.fill();
      g.strokeStyle = "rgba(255,255,220,0.18)"; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-L / 2, 0); g.lineTo(L / 2, 0); g.stroke();
      g.restore();
    }
  }),
  // One palm frond seen flat: the rib down the middle (v = 0 at the trunk), leaflets raked out to both edges.
  frond: () => canvasTex("fl-frond", 256, 1024, (g, w, h) => {
    const r = rnd(9);
    g.clearRect(0, 0, w, h);
    for (let y = 30; y < h - 10; y += 7) {
      const t = y / h, reach = (w / 2 - 6) * Math.sin(Math.PI * Math.min(1, t * 1.1)) * (0.75 + r() * 0.25);
      for (const s of [-1, 1]) {
        const sh = r();
        g.strokeStyle = `hsl(${86 + sh * 30},${42 + sh * 18}%,${22 + sh * 16 + t * 8}%)`;
        g.lineWidth = 5 - t * 2.5;
        g.beginPath(); g.moveTo(w / 2, y); g.quadraticCurveTo(w / 2 + s * reach * 0.5, y + 10, w / 2 + s * reach, y + 34 + t * 20); g.stroke();
      }
    }
    g.strokeStyle = "#6b6a3a"; g.lineWidth = 6; g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h - 6); g.stroke();
  }, { repeat: false }),
  // Oak bark: dark vertical furrows.
  bark: () => canvasTex("fl-bark", 256, 512, (g, w, h) => {
    const r = rnd(13);
    g.fillStyle = "#4a3828"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x = r() * w, y = r() * h, l = 40 + r() * 160;
      g.strokeStyle = `rgba(${r() < 0.5 ? "20,14,8" : "120,100,80"},${0.25 + r() * 0.35})`; g.lineWidth = 2 + r() * 5;
      g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + (r() - 0.5) * 14, y + l / 3, x + (r() - 0.5) * 14, y + l * 0.66, x + (r() - 0.5) * 8, y + l); g.stroke();
    }
  }),
  // Palm trunk: grey-brown with the leaf-scar rings.
  palmBark: () => canvasTex("fl-palmbark", 256, 512, (g, w, h) => {
    const r = rnd(17);
    const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, "#6e6252"); gr.addColorStop(0.5, "#8a7c66"); gr.addColorStop(1, "#6e6252");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      g.fillStyle = "rgba(40,30,20,0.45)"; g.fillRect(0, y, w, 3 + r() * 2);
      g.fillStyle = "rgba(200,185,160,0.18)"; g.fillRect(0, y + 5, w, 2);
      for (let k = 0; k < 6; k++) { g.fillStyle = "rgba(30,24,16,0.22)"; g.fillRect(r() * w, y + 6, 10 + r() * 30, 6); }
    }
  })
};

export function floraMat(k, std) {
  switch (k) {
    case "bark": return std({ map: TEX.bark(), bumpMap: TEX.bark(), bumpScale: 1.6, roughness: 0.95 });
    case "palmbark": return std({ map: TEX.palmBark(), bumpMap: TEX.palmBark(), bumpScale: 1.8, roughness: 0.9 });
    case "frond": return std({ map: TEX.frond(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 });
    case "leafcard": return std({ map: TEX.leaf(), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.85 });
    case "tuft": return std({ map: TEX.tuft(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1 });
    case "leafvol": return std({ color: 0x2c4a28, roughness: 1 });
    case "shrubvol": return std({ color: 0x3e5e3a, roughness: 1 });
    case "boot": return std({ color: 0x5a4a32, roughness: 1 });
    case "coco": return std({ color: 0x5a6a2a, roughness: 0.6 });
    case "stone": return std({ color: 0xd2ccbf, map: concrete("#cfc8ba", 52), bumpMap: concrete("#cfc8ba", 52), bumpScale: 1.2, roughness: 0.62 });
    case "stonedark": return std({ color: 0x9a9488, map: concrete("#a49e92", 53), roughness: 0.7 });
    case "water": return std({ color: 0x2f6f8a, metalness: 0.35, roughness: 0.04, emissive: 0x0d3550, emissiveIntensity: 0.25 });
    case "spray": return std({ color: 0xdff2ff, emissive: 0x4a7a90, emissiveIntensity: 0.25, roughness: 0.1, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide });
    case "brassf": return std({ color: 0xc9a85a, metalness: 0.75, roughness: 0.28 });
  }
  return std({ color: 0xff00ff });
}

// ------------------------------------------------------------------ helpers
// A tube along `pts` whose radius follows rad(t) (t 0..1 along it), optional bump(t, angle) added to the radius.
function taperTube(pts, rad, radial, tub, bump) {
  const path = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(path, tub, 1, radial, false);
  const p = g.attributes.position, c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= tub; i++) {
    const t = i / tub;
    path.getPointAt(t, c);
    for (let j = 0; j <= radial; j++) {
      const n = i * (radial + 1) + j;
      v.fromBufferAttribute(p, n).sub(c);
      const a = (j / radial) * Math.PI * 2;
      v.multiplyScalar(rad(t) * (1 + (bump ? bump(t, a) : 0)));
      p.setXYZ(n, c.x + v.x, c.y + v.y, c.z + v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}
// Lumpy sphere: displaced icosahedron (detail 3 = 1280 tris).
function lump(radius, seed, amt = 0.22, detail = 3, sy = 1) {
  const g = new THREE.IcosahedronGeometry(radius, detail), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize(), k = 1 + amt * vnoise(n.x * 2.2 + seed, n.y * 2.2, n.z * 2.2) + amt * 0.4 * vnoise(n.x * 6 + seed, n.y * 6, n.z * 6);
    v.multiplyScalar(k); v.y *= sy;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
// A leaf card: a square plane, centred at c, turned at random.
function card(size, c, r) {
  const g = new THREE.PlaneGeometry(size, size);
  g.rotateZ(r() * Math.PI * 2); g.rotateX((r() - 0.5) * 2.2); g.rotateY(r() * Math.PI * 2);
  g.translate(c.x, c.y, c.z);
  return g;
}

// ------------------------------------------------------------------ palm (Glass Mile, the mall style)
export function palm(seed) {
  const r = rnd(seed * 7919 + 3), parts = [];
  const H = 7.4 + r() * 1.4, lean = (r() - 0.5) * 0.9, lz = (r() - 0.5) * 0.9;
  const top = new THREE.Vector3(lean, H, lz);
  const trunkPts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(lean * 0.15, H * 0.35, lz * 0.15), new THREE.Vector3(lean * 0.55, H * 0.7, lz * 0.55), top];
  parts.push({ k: "palmbark", geo: taperTube(trunkPts, (t) => 0.27 - t * 0.12 + (t < 0.06 ? (0.06 - t) * 2.2 : 0), 16, 44, (t, a) => 0.035 * Math.max(0, Math.sin(t * 150)) + 0.015 * Math.sin(a * 5 + t * 30)) });
  // The boot of old frond stubs where the crown starts, and a cluster of coconuts under it.
  const boot = new THREE.LatheGeometry([[0.13, -0.5], [0.26, -0.25], [0.3, 0], [0.22, 0.25], [0.08, 0.38]].map(([x, y]) => new THREE.Vector2(x, y)), 28);
  boot.translate(top.x, top.y, top.z); parts.push({ k: "boot", geo: boot });
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + r(), c = new THREE.SphereGeometry(0.11, 16, 12);
    c.translate(top.x + Math.cos(a) * 0.2, top.y - 0.22 - r() * 0.12, top.z + Math.sin(a) * 0.2); parts.push({ k: "coco", geo: c });
  }
  // Fronds: two rings, the upper ones lifted, the lower ones hanging. Each is a 3-column strip with a raised rib (a V
  // fold, so it catches light like a real frond) drooping along a parabola.
  const N = 18, SEG = 18;
  for (let f = 0; f < N; f++) {
    const ring = f % 2, yaw = f / N * Math.PI * 2 + r() * 0.3;
    const L = 3.4 + r() * 0.9, pitch = ring ? 0.75 + r() * 0.25 : 0.25 + r() * 0.25, droop = ring ? 0.17 : 0.24;
    const dx = Math.cos(yaw), dz = Math.sin(yaw), px = -dz, pz = dx;
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG, s = L * t;
      const cx = dx * s * Math.cos(pitch), cz = dz * s * Math.cos(pitch), cy = Math.sin(pitch) * s - droop * s * s;
      const w = 0.62 * Math.sin(Math.PI * Math.min(1, t * 1.08 + 0.02)) * (1 - t * 0.25), fold = w * 0.32;
      for (let j = 0; j < 3; j++) {
        const o = (j - 1) * w;
        pos.push(top.x + cx + px * o, top.y + 0.2 + cy + (j === 1 ? fold : 0), top.z + cz + pz * o);
        uv.push(j / 2, t);
      }
      if (i < SEG) for (let j = 0; j < 2; j++) { const a = i * 3 + j, b = a + 3; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    parts.push({ k: "frond", geo: g });
  }
  return { parts, top };
}

// ------------------------------------------------------------------ broadleaf tree (the residential districts)
export function oak(seed) {
  const r = rnd(seed * 104729 + 11), parts = [];
  const H = 3.2 + r() * 0.5;
  const trunkTop = new THREE.Vector3((r() - 0.5) * 0.3, H, (r() - 0.5) * 0.3);
  parts.push({ k: "bark", geo: taperTube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.05, H * 0.5, -0.04), trunkTop], (t) => 0.26 - t * 0.11 + (t < 0.08 ? (0.08 - t) * 2 : 0), 16, 18, (t, a) => 0.06 * vnoise(Math.cos(a) * 2, t * 6, Math.sin(a) * 2)) });
  const B = 6;
  for (let b = 0; b < B; b++) {
    const a = b / B * Math.PI * 2 + r() * 0.5, out = 1.3 + r() * 0.8, up = 1.0 + r() * 1.2;
    const end = new THREE.Vector3(trunkTop.x + Math.cos(a) * out, H + up, trunkTop.z + Math.sin(a) * out);
    const mid = trunkTop.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.25, 0));
    parts.push({ k: "bark", geo: taperTube([trunkTop.clone().add(new THREE.Vector3(0, -0.35, 0)), mid, end], (t) => 0.11 - t * 0.075, 8, 10) });
    // The leaf mass at the branch end: a solid lumpy core so you never see through it, cards around it.
    const R = 1.0 + r() * 0.45;
    const core = lump(R * 0.78, seed + b, 0.24, 2, 0.8); core.translate(end.x, end.y + 0.2, end.z); parts.push({ k: "leafvol", geo: core });
    const c = new THREE.Vector3();
    for (let k = 0; k < 16; k++) {
      c.set((r() - 0.5) * 2, (r() - 0.35) * 1.4, (r() - 0.5) * 2).normalize().multiplyScalar(R * (0.55 + r() * 0.45)).add(end); c.y += 0.2;
      parts.push({ k: "leafcard", geo: card(1.15 + r() * 0.4, c, r) });
    }
  }
  // A crown cap over the middle.
  const cap = lump(1.3, seed + 99, 0.22, 2, 0.75); cap.translate(trunkTop.x, H + 2.0, trunkTop.z); parts.push({ k: "leafvol", geo: cap });
  const c = new THREE.Vector3();
  for (let k = 0; k < 18; k++) { c.set((r() - 0.5) * 2, r() * 0.9, (r() - 0.5) * 2).normalize().multiplyScalar(1.5 * (0.5 + r() * 0.5)); c.x += trunkTop.x; c.y += H + 2.0; c.z += trunkTop.z; parts.push({ k: "leafcard", geo: card(1.2 + r() * 0.4, c, r) }); }
  return { parts };
}

// ------------------------------------------------------------------ a clipped shrub (planters, the valet island)
export function shrub(seed, radius = 0.5) {
  const r = rnd(seed * 31 + 5), parts = [];
  parts.push({ k: "shrubvol", geo: lump(radius, seed, 0.18, 3, 0.85) });
  const c = new THREE.Vector3();
  for (let k = 0; k < 10; k++) { c.set((r() - 0.5) * 2, (r() - 0.2) * 1.2, (r() - 0.5) * 2).normalize().multiplyScalar(radius * 0.85); parts.push({ k: "leafcard", geo: card(radius * 1.1, c, r) }); }
  return { parts };
}

// ------------------------------------------------------------------ Pecan Hollow: lighter trees for a whole town
// The Run It Up oak is ~4,000 triangles; Pecan Hollow has ~350 trees on one map, so these keep the same build (bark
// tube, branch ends, solid lumpy core + leaf cards) at ~800 (yard / street trees) or ~250 (the far tree line).
// `kind`: "pecan" (wide, low), "elm" (tall, narrow), "dead" (bare branches, a few leaves: distressed lots).
export function yardTree(seed, kind = "pecan") {
  const r = rnd(seed * 7727 + 31), parts = [];
  const tall = kind === "elm", dead = kind === "dead";
  const H = (tall ? 4.2 : 2.8) + r() * 0.8;
  const top = new THREE.Vector3((r() - 0.5) * 0.4, H, (r() - 0.5) * 0.4);
  parts.push({ k: "bark", geo: taperTube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.06, H * 0.5, -0.05), top], (t) => 0.24 - t * 0.1 + (t < 0.08 ? (0.08 - t) * 2 : 0), 8, 8, (t, a) => 0.07 * vnoise(Math.cos(a) * 2, t * 6, Math.sin(a) * 2)) });
  const B = dead ? 6 : 5;
  for (let b = 0; b < B; b++) {
    const a = b / B * Math.PI * 2 + r() * 0.6, out = (tall ? 1.0 : 1.6) + r() * 0.8, up = (tall ? 1.6 : 0.9) + r() * 1.1;
    const end = new THREE.Vector3(top.x + Math.cos(a) * out, H + up, top.z + Math.sin(a) * out);
    const mid = top.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.2, 0));
    parts.push({ k: "bark", geo: taperTube([top.clone().add(new THREE.Vector3(0, -0.3, 0)), mid, end], (t) => 0.1 - t * 0.07, 5, 5) });
    if (dead) { if (r() < 0.35) { const c = new THREE.Vector3(); for (let k = 0; k < 3; k++) { c.set(r() - 0.5, r() * 0.5, r() - 0.5).multiplyScalar(1.2).add(end); parts.push({ k: "leafcard", geo: card(0.9, c, r) }); } } continue; }
    const R = (tall ? 0.9 : 1.15) + r() * 0.4;
    const core = lump(R * 0.8, seed + b, 0.26, 1, tall ? 1.1 : 0.78); core.translate(end.x, end.y + 0.15, end.z); parts.push({ k: "leafvol", geo: core });
    const c = new THREE.Vector3();
    for (let k = 0; k < 9; k++) { c.set((r() - 0.5) * 2, (r() - 0.3) * 1.4, (r() - 0.5) * 2).normalize().multiplyScalar(R * (0.6 + r() * 0.45)).add(end); c.y += 0.15; parts.push({ k: "leafcard", geo: card(1.2 + r() * 0.4, c, r) }); }
  }
  if (!dead) {
    const cap = lump(tall ? 1.2 : 1.45, seed + 77, 0.24, 1, tall ? 1.3 : 0.7); cap.translate(top.x, H + (tall ? 2.6 : 1.7), top.z); parts.push({ k: "leafvol", geo: cap });
    const c = new THREE.Vector3();
    for (let k = 0; k < 10; k++) { c.set((r() - 0.5) * 2, r() * 0.9, (r() - 0.5) * 2).normalize().multiplyScalar(1.6 * (0.5 + r() * 0.5)); c.add(top); c.y += tall ? 2.6 : 1.7; parts.push({ k: "leafcard", geo: card(1.3 + r() * 0.4, c, r) }); }
  }
  return { parts };
}
// The tree line around town: trunk + three lumpy masses, no cards (it is always 100 m+ away and in the haze).
export function farTree(seed) {
  const r = rnd(seed * 3571 + 7), parts = [];
  const H = 3.2 + r() * 1.5;
  const t = new THREE.CylinderGeometry(0.2, 0.32, H, 5); t.translate(0, H / 2, 0); parts.push({ k: "bark", geo: t });
  for (let i = 0; i < 3; i++) { const g = lump(2.0 + r() * 1.1, seed + i * 13, 0.3, 1, 0.85); g.translate((r() - 0.5) * 2.4, H + 1.2 + r() * 1.6, (r() - 0.5) * 2.4); parts.push({ k: "leafvol", geo: g }); }
  return { parts };
}
// A hedge / foundation shrub (low lumpy mass + a few cards).
export function bush(seed, radius = 0.6, sy = 0.75) {
  const r = rnd(seed * 41 + 3), parts = [];
  parts.push({ k: "shrubvol", geo: lump(radius, seed, 0.22, 1, sy) });
  const c = new THREE.Vector3();
  for (let k = 0; k < 6; k++) { c.set((r() - 0.5) * 2, (r() - 0.1) * 1.0, (r() - 0.5) * 2).normalize().multiplyScalar(radius * 0.85); c.y *= sy; parts.push({ k: "leafcard", geo: card(radius * 1.2, c, r) }); }
  return { parts };
}
// A clump of tall grass / weeds: three crossed alpha cards (overgrown yards).
export function tuft(seed, h = 0.9) {
  const r = rnd(seed * 19 + 1), parts = [];
  for (let i = 0; i < 3; i++) {
    const w = h * (0.9 + r() * 0.5), g = new THREE.PlaneGeometry(w, h);
    g.translate(0, h / 2, 0); g.rotateY(i / 3 * Math.PI + r() * 0.4);
    parts.push({ k: "tuft", geo: g });
  }
  return { parts };
}
TEX.tuft = () => canvasTex("fl-tuft", 256, 256, (g, w, h) => {
  const r = rnd(23);
  g.clearRect(0, 0, w, h);
  for (let i = 0; i < 120; i++) {
    const x = w * 0.08 + r() * w * 0.84, lean = (r() - 0.5) * 60, top = h * (0.05 + r() * 0.5), sh = r();
    g.strokeStyle = `hsl(${55 + sh * 35},${30 + sh * 25}%,${28 + sh * 26}%)`; g.lineWidth = 2 + r() * 2.5;
    g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + lean * 0.3, h * 0.6, x + lean, top); g.stroke();
  }
  for (let i = 0; i < 6; i++) { g.fillStyle = "hsl(48,40%,62%)"; const x = w * 0.2 + r() * w * 0.6, y = h * (0.1 + r() * 0.3); g.fillRect(x, y, 3, 12); }
}, { repeat: false });

// ------------------------------------------------------------------ the Glass Mile fountain
// Two tiers: a carved basin with a rolled lip, a baluster pedestal, an upper bowl spilling a ring of water into the
// basin, a finial with a jet. Base sits at y = 0. All lathe-turned at 96 segments.
export function fountain() {
  const parts = [], S = 96;
  const lathe = (pts, k, seg = S) => parts.push({ k, geo: new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg) });
  // Basin: plinth step, bowl wall with a bead, rolled lip, inner wall down to the floor.
  lathe([[0.001, 0], [1.5, 0], [1.5, 0.08], [1.42, 0.1], [1.4, 0.22], [1.44, 0.26], [1.4, 0.3], [1.36, 0.46], [1.38, 0.52], [1.43, 0.56], [1.44, 0.6], [1.41, 0.64], [1.33, 0.66], [1.26, 0.65], [1.22, 0.6], [1.2, 0.3], [0.001, 0.28]], "stone");
  // Water in the basin: a disc with a few soft ripple rings.
  const disc = new THREE.RingGeometry(0.0, 1.21, S, 16); disc.rotateX(-Math.PI / 2);
  { const p = disc.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), d = Math.hypot(x, z); p.setY(i, 0.56 + 0.006 * Math.sin(d * 22) * Math.min(1, d * 2)); } disc.computeVertexNormals(); }
  parts.push({ k: "water", geo: disc });
  // Pedestal: a turned baluster from the basin floor to the upper bowl.
  lathe([[0.3, 0.28], [0.3, 0.36], [0.24, 0.42], [0.2, 0.6], [0.15, 0.85], [0.17, 0.98], [0.24, 1.08], [0.2, 1.16], [0.13, 1.24], [0.13, 1.38], [0.2, 1.44]], "stonedark", 64);
  // Upper bowl: scalloped-looking underside (beads), rolled lip.
  lathe([[0.2, 1.44], [0.42, 1.5], [0.6, 1.6], [0.7, 1.7], [0.72, 1.76], [0.69, 1.8], [0.62, 1.79], [0.58, 1.72], [0.001, 1.7]], "stone");
  const top = new THREE.RingGeometry(0, 0.6, 64, 6); top.rotateX(-Math.PI / 2); top.translate(0, 1.755, 0); parts.push({ k: "water", geo: top });
  // The ring of water falling from the upper lip into the basin (open, flaring a little), and a thin inner sheet.
  const fall = new THREE.CylinderGeometry(0.71, 0.86, 1.2, S, 6, true); fall.translate(0, 1.16, 0); parts.push({ k: "spray", geo: fall });
  const fall2 = new THREE.CylinderGeometry(0.69, 0.8, 1.18, S, 4, true); fall2.translate(0, 1.17, 0); parts.push({ k: "spray", geo: fall2 });
  // Finial + jet.
  lathe([[0.001, 1.72], [0.1, 1.74], [0.07, 1.86], [0.11, 1.94], [0.06, 2.02], [0.04, 2.1], [0.001, 2.12]], "brassf", 48);
  const jet = new THREE.CylinderGeometry(0.02, 0.05, 0.55, 24, 1, true); jet.translate(0, 2.38, 0); parts.push({ k: "spray", geo: jet });
  const cap = new THREE.SphereGeometry(0.09, 24, 16); cap.scale(1, 0.6, 1); cap.translate(0, 2.66, 0); parts.push({ k: "spray", geo: cap });
  return { parts };
}
