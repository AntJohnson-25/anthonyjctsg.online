// The Meshy cars (assets/cars/*.glb) for the car you drive and the traffic. Same tiny GLB reader as Run It Up
// (no GLTFLoader here) and the same rule: Meshy textures draw with a short mip chain, never a full one.
import * as THREE from "three";
import { shortMips } from "./chars.js";
import { lodSupported, weld, simplifyRange } from "./lod.js";

// 2026-11-24 (user: add the Maybach, the Cullinan and the Corvette): the three Run It Up lux models, no maker names in the game.
// luxsedan = the two-tone limousine (Maybach style), royalsuv = the boxy ultra-luxury SUV (Cullinan style), sportscar = the red
// mid-engine coupe (Corvette style). Real lengths, same as Run It Up's LUX table.
const LEN = { sedan: 4.8, sedan2: 4.8, suv: 5.2, pickup: 5.4, van: 5.6, luxsedan: 5.45, royalsuv: 5.35, sportscar: 4.65 };
export const CAR_IDS = Object.keys(LEN);
export const LUX_IDS = ["luxsedan", "royalsuv", "sportscar"];
const cars = {};
const TYPES = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

export async function loadCar(id) {
  if (cars[id]) return cars[id];
  const res = await fetch("assets/cars/" + id + ".glb");
  if (!res.ok) throw new Error(id + " " + res.status);
  const buf = await res.arrayBuffer();
  const jlen = new DataView(buf).getUint32(12, true);
  const j = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jlen)));
  const bin = 28 + jlen;
  const bytes = (vi, extra = 0, len) => { const v = j.bufferViews[vi], o = bin + (v.byteOffset || 0) + extra; return buf.slice(o, o + (len ?? v.byteLength)); };
  const acc = (i) => { const a = j.accessors[i], T = TYPES[a.componentType]; return new T(bytes(a.bufferView, a.byteOffset || 0, a.count * SIZE[a.type] * T.BYTES_PER_ELEMENT)); };
  const texs = await Promise.all((j.images || []).map(async (im) => {
    const bmp = await createImageBitmap(new Blob([bytes(im.bufferView)], { type: im.mimeType }));
    const t = new THREE.Texture(bmp); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    shortMips(t); t.needsUpdate = true; return t;
  }));
  const parts = [], box = new THREE.Box3();
  for (const m of j.meshes) for (const pr of m.primitives) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(acc(pr.attributes.POSITION), 3));
    if (pr.attributes.TEXCOORD_0 !== undefined) g.setAttribute("uv", new THREE.BufferAttribute(acc(pr.attributes.TEXCOORD_0), 2, !!j.accessors[pr.attributes.TEXCOORD_0].normalized));
    if (pr.indices !== undefined) g.setIndex(new THREE.BufferAttribute(acc(pr.indices), 1));
    if (pr.attributes.NORMAL !== undefined) g.setAttribute("normal", new THREE.BufferAttribute(acc(pr.attributes.NORMAL), 3)); else g.computeVertexNormals();
    g.computeBoundingBox(); box.union(g.boundingBox); g.userData.keep = true;
    if (g.index && g.index.count > 12000 && lodSupported() && g.attributes.position.array instanceof Float32Array) {
      try {
        const Wd = weld(g.attributes.position.array, g.attributes.uv ? g.attributes.uv.array : null);
        const idx = simplifyRange(Wd, g.index.array, 0, g.index.count, 0.3, 0.03);
        const mk = (ix) => {
          const lo = new THREE.BufferGeometry();
          for (const [k, a] of Object.entries(g.attributes)) lo.setAttribute(k, a);
          lo.setIndex(new THREE.BufferAttribute(g.attributes.position.count > 65535 ? new Uint32Array(ix) : new Uint16Array(ix), 1));
          lo.boundingBox = g.boundingBox; lo.computeBoundingSphere(); lo.userData.keep = true; return lo;
        };
        if (idx.length < g.index.count * 0.8) g.userData.lod = mk(idx);
        // a much rougher copy for parked cars far down the street (2026-11-08: ~100 Meshy cars parked in town)
        const idx2 = simplifyRange(Wd, g.index.array, 0, g.index.count, 0.06, 0.08);
        if (idx2.length < idx.length * 0.6) g.userData.lod2 = mk(idx2);
      } catch (e) { /* no LOD */ }
    }
    const pm = j.materials && j.materials[pr.material], pbr = (pm && pm.pbrMetallicRoughness) || {};
    const ti = pbr.baseColorTexture && j.textures[pbr.baseColorTexture.index].source;
    parts.push({ g, mat: new THREE.MeshStandardMaterial({ map: ti !== undefined ? texs[ti] : null, roughness: 0.45, metalness: 0.35 }) });
  }
  return (cars[id] = { parts, box });
}

// Parked cars share one material per (model, look): "clean", "dusty" (the Flats), "rust" (the junker in a drive).
const looks = new Map();
function lookMat(id, p, i, look) {
  const k = id + "/" + i + "/" + look;
  let m = looks.get(k);
  if (!m) {
    m = p.mat.clone();
    if (look === "dusty") { m.color.setRGB(0.86, 0.83, 0.78); m.roughness = 0.7; m.metalness = 0.2; }
    if (look === "rust") { m.color.setRGB(0.62, 0.42, 0.3); m.roughness = 0.95; m.metalness = 0.05; }
    looks.set(k, m);
  }
  return m;
}
// A parked car: three distance levels (full, 30% past 18 m, 6% past 45 m), a look, no shadow box past the street.
export function makeParked(id, look = "clean") {
  const C = cars[id];
  if (!C) return makeCar(id);
  const len = LEN[id] || 4.8, b = C.box, s = len / (b.max.x - b.min.x), cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
  const g = new THREE.Group(), lod = new THREE.LOD();
  const level = (which) => {
    const lv = new THREE.Group();
    C.parts.forEach((p, i) => {
      const geo = which === 2 ? (p.g.userData.lod2 || p.g.userData.lod || p.g) : which === 1 ? (p.g.userData.lod || p.g) : p.g;
      const m = new THREE.Mesh(geo, look === "clean" ? p.mat : lookMat(id, p, i, look)); m.castShadow = false; m.receiveShadow = which === 0; lv.add(m);
    });
    lv.scale.setScalar(s); lv.rotation.y = Math.PI; lv.position.set(cx * s, -b.min.y * s, cz * s);
    return lv;
  };
  lod.addLevel(level(0), 0); lod.addLevel(level(1), 18); lod.addLevel(level(2), 45);
  g.add(lod);
  const sh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  sh.scale.set(len * 0.92, (b.max.y - b.min.y) * s * 0.8, (b.max.z - b.min.z) * s * 0.85); sh.position.y = (b.max.y - b.min.y) * s * 0.45; sh.castShadow = true; g.add(sh);
  g.userData.len = len;
  return g;
}

// A car group with its nose along +x and its wheels on y = 0. Past 22 m the 30% copy draws (three.LOD).
export function makeCar(id) {
  const C = cars[id], len = LEN[id] || 4.8;
  const g = new THREE.Group(), inner = new THREE.Group();
  if (!C) { // fallback: a plain box car
    const b = new THREE.Mesh(new THREE.BoxGeometry(len, 1.3, 1.9), new THREE.MeshLambertMaterial({ color: 0x7a7f86 })); b.position.y = 0.8; g.add(b); g.userData.len = len; return g;
  }
  const b = C.box, s = len / (b.max.x - b.min.x), cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
  const level = (far) => {
    const lv = new THREE.Group();
    for (const p of C.parts) { const m = new THREE.Mesh(far && p.g.userData.lod ? p.g.userData.lod : p.g, p.mat); m.castShadow = false; m.receiveShadow = true; lv.add(m); }
    lv.scale.setScalar(s); lv.rotation.y = Math.PI;   // the Meshy cars come nose -x
    lv.position.set(cx * s, -b.min.y * s, cz * s);
    return lv;
  };
  if (C.parts.some((p) => p.g.userData.lod)) { const lod = new THREE.LOD(); lod.addLevel(level(false), 0); lod.addLevel(level(true), 22); inner.add(lod); } else inner.add(level(false));
  g.add(inner);
  // one box casts the shadow (the real mesh is 30k triangles)
  const sh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  sh.scale.set(len * 0.92, (b.max.y - b.min.y) * s * 0.8, (b.max.z - b.min.z) * s * 0.85); sh.position.y = (b.max.y - b.min.y) * s * 0.45; sh.castShadow = true; g.add(sh);
  g.userData.len = len; g.userData.w = (b.max.z - b.min.z) * s;
  return g;
}
