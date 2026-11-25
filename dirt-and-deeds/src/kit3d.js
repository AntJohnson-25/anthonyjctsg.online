// Small three.js kit for the town: a spatial Merger (everything static is merged per 60 m cell and material so frustum
// and shadow culling still work), world-sized box UVs, a gable roof, canvas textures.
import * as THREE from "three";

export const CELL = 60;

export function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = opts.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ---- geometry helpers (cached)
const boxCache = new Map();
// A box whose UVs are in metres / tile, so a texture keeps the same scale on every wall.
export function boxGeo(w, h, d, tile = 1.6) {
  const k = w.toFixed(3) + "," + h.toFixed(3) + "," + d.toFixed(3) + "," + tile;
  let g = boxCache.get(k);
  if (g) return g;
  g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, sizes = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const j = f * 4 + i; uv.setXY(j, uv.getX(j) * sizes[f][0] / tile, uv.getY(j) * sizes[f][1] / tile); }
  boxCache.set(k, g);
  return g;
}
// Gable roof: ridge along x, width w (x), depth d (z), height h, overhang o. Origin at the eave line centre, y = 0.
// The two triangular gable walls under a gableGeo roof (sided like the house, not shingled): pentagons at x = +-w/2
// filling from the wall top (y = 0) up under the slopes. UVs in metres / tile.
export function gableEndGeo(w, d, h, o = 0.35, tile = 1.6) {
  const hd = d / 2 + o, e = h * o / hd, pos = [], uv = [];
  for (const sx of [-1, 1]) {
    const x = sx * w / 2, P = [[-d / 2, 0], [d / 2, 0], [d / 2, e], [0, h * 0.985], [-d / 2, e]];
    const tri = (a, b, c) => { for (const q of [a, b, c]) { pos.push(x, P[q][1], P[q][0] * -sx); uv.push(P[q][0] / tile, P[q][1] / tile); } };
    tri(0, 1, 2); tri(0, 2, 4); tri(4, 2, 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
export function gableGeo(w, d, h, o = 0.35, tile = 1.2, ends = true) {
  const hw = w / 2 + o, hd = d / 2 + o;
  const pos = [], uv = [];
  const tri = (a, b, c, ua, ub, uc) => { pos.push(...a, ...b, ...c); uv.push(...ua, ...ub, ...uc); };
  const A = [-hw, 0, hd], B = [hw, 0, hd], C = [-hw, 0, -hd], D = [hw, 0, -hd], R1 = [-hw, h, 0], R2 = [hw, h, 0];
  const sl = Math.hypot(hd, h) / tile, lw = (hw * 2) / tile;
  tri(A, B, R2, [0, 0], [lw, 0], [lw, sl]); tri(A, R2, R1, [0, 0], [lw, sl], [0, sl]);          // front slope
  tri(D, C, R1, [0, 0], [lw, 0], [0, sl]); tri(D, R1, R2, [0, 0], [0, sl], [lw, sl]);             // back slope
  const g1 = [-hw + 0.3, 0, hd - 0.3], g2 = [-hw + 0.3, 0, -hd + 0.3];
  if (ends) {
    tri([-hw, 0, -hd], [-hw, 0, hd], R1, [0, 0], [1, 0], [0.5, 1]);                               // left gable end
    tri([hw, 0, hd], [hw, 0, -hd], R2, [0, 0], [1, 0], [0.5, 1]);                                 // right gable end
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
// Hip-less shed roof (one slope) for porches: low side at -z.
export function shedGeo(w, d, h) {
  const hw = w / 2, hd = d / 2;
  const pos = [-hw, 0, hd, hw, 0, hd, hw, h, -hd, -hw, 0, hd, hw, h, -hd, -hw, h, -hd];
  const uv = [0, 0, w, 0, w, d, 0, 0, w, d, 0, d];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
export const cylGeo = (rt, rb, h, seg = 8) => { const k = "cyl" + rt + "," + rb + "," + h + "," + seg; return cache(k, () => new THREE.CylinderGeometry(rt, rb, h, seg)); };
export const sphGeo = (r, ws = 6, hs = 5) => cache("sph" + r + "," + ws + "," + hs, () => new THREE.SphereGeometry(r, ws, hs));
export const icoGeo = (r, d = 0) => cache("ico" + r + "," + d, () => new THREE.IcosahedronGeometry(r, d));
export const planeGeo = (w, d) => cache("pl" + w + "," + d, () => { const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2); return g; });
const gcache = new Map();
function cache(k, f) { let g = gcache.get(k); if (!g) { g = f(); gcache.set(k, g); } return g; }

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
export function M(x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, "YXZ"); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

// ---- the merger
export class Merger {
  // wuv: { materialKey: metres per texture tile } = ground surfaces get UVs from their world x/z (top projection), so
  // a 470 m road and a 2 m path show the asphalt / concrete at the same real scale.
  constructor() { this.b = new Map(); this.cell = null; this.xf = null; this.ry = 0; this.wuv = {}; }
  // Everything added until the next call is placed by this parent transform too (e.g. one house in its lot).
  at(x, z, ry, y = 0) { this.xf = M(x, y, z, ry); this.ry = ry; this.ox = x; this.oz = z; this.cell = [Math.floor(x / CELL), Math.floor(z / CELL)]; return this; }
  // A local lot point -> world { x, z } (for things placed outside the merger, e.g. the Meshy parked cars).
  world(x, z) { const v = new THREE.Vector3(x, 0, z); if (this.xf) v.applyMatrix4(this.xf); return { x: v.x, z: v.z }; }
  add(geo, key, m, color = 0xffffff, cast = true) {
    const mat = this.xf ? new THREE.Matrix4().multiplyMatrices(this.xf, m) : m;
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(mat);
    const tile = this.wuv[key];
    if (tile) {
      const p = g.attributes.position, uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) / tile; uv[i * 2 + 1] = -p.getZ(i) / tile; }
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    }
    const cell = this.cell || [0, 0];
    const k = cell[0] + "," + cell[1] + "|" + key + (cast ? "" : "|nc");
    let e = this.b.get(k);
    if (!e) this.b.set(k, (e = { key, cast, pos: [], nor: [], uv: [], col: [] }));
    const n = g.attributes.position.count;
    e.pos.push(g.attributes.position.array); e.nor.push(g.attributes.normal.array);
    e.uv.push(g.attributes.uv ? g.attributes.uv.array : new Float32Array(n * 2));
    const c = new THREE.Color(color), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    e.col.push(col);
    g.dispose();
  }
  box(w, h, d, x, y, z, key, color, ry = 0, tile) { this.add(boxGeo(w, h, d, tile), key, M(x, y + h / 2, z, ry), color); }
  build(mats, shadows = true) {
    const out = new THREE.Group();
    const cat = (arrs) => { let n = 0; for (const a of arrs) n += a.length; const o = new Float32Array(n); let i = 0; for (const a of arrs) { o.set(a, i); i += a.length; } return o; };
    for (const [, e] of this.b) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(cat(e.pos), 3));
      g.setAttribute("normal", new THREE.BufferAttribute(cat(e.nor), 3));
      g.setAttribute("uv", new THREE.BufferAttribute(cat(e.uv), 2));
      g.setAttribute("color", new THREE.BufferAttribute(cat(e.col), 3));
      g.computeBoundingSphere(); g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, mats[e.key]);
      mesh.castShadow = shadows && e.cast; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      out.add(mesh);
    }
    this.b.clear();
    return out;
  }
}

// ---- text sprites / signs
export function textTex(lines, o = {}) {
  const w = o.w || 512, h = o.h || 128;
  return canvasTex(w, h, (g) => {
    g.fillStyle = o.bg || "#1c2a3a"; g.fillRect(0, 0, w, h);
    if (o.border) { g.strokeStyle = o.border; g.lineWidth = 6; g.strokeRect(5, 5, w - 10, h - 10); }
    g.fillStyle = o.fg || "#f4f1e6"; g.textAlign = "center"; g.textBaseline = "middle";
    const arr = Array.isArray(lines) ? lines : [lines];
    const fs = o.size || (arr.length > 1 ? h / (arr.length + 0.6) : h * 0.5);
    g.font = "700 " + fs + "px Georgia, 'Times New Roman', serif";
    arr.forEach((t, i) => g.fillText(t, w / 2, h * (i + 1) / (arr.length + 1), w - 24));
  }, { clamp: true });
}
export function labelSprite(text, sub) {
  const c = document.createElement("canvas"); c.width = 512; c.height = 160;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(14,20,28,.82)"; g.beginPath(); g.roundRect(6, 6, 500, 148, 22); g.fill();
  g.strokeStyle = "rgba(240,200,110,.9)"; g.lineWidth = 4; g.stroke();
  g.fillStyle = "#f6f0dc"; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = "700 54px Georgia, serif"; g.fillText(text, 256, sub ? 60 : 80, 480);
  if (sub) { g.font = "500 30px Georgia, serif"; g.fillStyle = "#cdbf94"; g.fillText(sub, 256, 116, 480); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(4.2, 1.31, 1); s.renderOrder = 10;
  return s;
}
