// Characters: packed Mixamo bodies (src/chars/<id>.js, SM.BODY, the Bladed/Snowball format) driven
// by the shared clips (src/chars/clips.js, SM.CLIPS). Loops play in place; the game moves the root.
//
// Body files are big (1-2.5 MB of base64), so they're loaded on demand with a <script> tag.
// Everyone wears gloves: triangles skinned to the hands get a black leather material, so any
// body can be gloved without touching its texture.
import * as THREE from "three";
import { lodReady, lodSupported, weld, simplifyRange } from "./lod.js";

const SM = (globalThis.SM = globalThis.SM || {});
// Graphics preset hooks (main.js sets them before any body loads): colour/normal maps drawn at this fraction of
// their size (Potato/Low 0.5), and the texture filtering.
let TEX_SCALE = 1, ANISO = 4;
export function setTextureScale(k) { TEX_SCALE = k; }
export function setAnisotropy(n) { ANISO = n; }
// Far LOD: people past LOD_FAR metres draw a simplified copy of their mesh (same vertices and skin, a ~35% index
// buffer), in both the picture and the shadow pass. At that range a body is under ~110 px tall on a 1080p screen.
export const LOD_RATIO = 0.35;
const meshoptReady = lodReady;
const HEAD_M = 1.76;     // bodies are scaled so the top of the head is here (metres)
const BLEND = 0.2;       // crossfade between base clips (s)
const LOOPS = new Set(["m_idle", "m_walk", "m_run", "m_sprint", "f_idle", "f_walk", "f_run", "idle_look", "idle_shift", "idle_long",
  "idle_examine", "idle_wary", "seated", "kneel", "box_idle", "box_walk", "hold_idle", "hold_walk",
  "fight_idle", "fight_idle2", "fallen", "sit", "sit_laugh", "talk_m", "talk_f", "m_idle_ph", "m_walk_ph", "f_idle_ph", "f_walk_ph",
  "cocky", "meet_m", "meet_f", "device", "phone_talk", "sit_yell", "sit_disbelief", "rifle_idle", "rifle_walk", "rifle_run", "catwalk", "lay_f", "stand_f"]);

// ------------------------------------------------------------------ loading

const loading = {};
function script(src) {
  return loading[src] || (loading[src] = new Promise((res, rej) => {
    const el = document.createElement("script");
    el.src = src; el.onload = res; el.onerror = () => rej(new Error("Could not load " + src));
    document.head.appendChild(el);
  }));
}
export async function loadClips() { await Promise.all([script("src/chars/clips.js"), meshoptReady]); }
// h: the body's standing height in metres (head top), default HEAD_M.
// Shrunk (tester) builds ship each body's geometry as `binZ`: byte-shuffled (position + uv float bytes
// grouped by byte lane) and deflate-raw compressed. Unpack it into `binBytes` before model() reads it.
async function unpackBin(D) {
  if (!D || !(D.binZ || D.binF)) return;
  // binF = the same bytes as a separate file (zips ~25% smaller than base64 text); binZ = inline base64.
  const zb = D.binF ? new Uint8Array(await (await fetch(D.binF)).arrayBuffer()) : Uint8Array.from(atob(D.binZ), (c) => c.charCodeAt(0));
  const s = new Uint8Array(await new Response(new Blob([zb]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
  const nv = D.verts, out = new Uint8Array(s.length);
  const unshuf = (o, n) => { for (let k = 0; k < 4; k++) for (let i = 0; i < n; i++) out[o + i * 4 + k] = s[o + k * n + i]; };
  unshuf(0, nv * 3); unshuf(nv * 12, nv * 2);
  out.set(s.subarray(nv * 20), nv * 20);
  if (D.idxD) { // triangle indices stored as per-triangle deltas, low bytes then high bytes (int16, wrapping)
    const n = D.index, o = nv * 32, iv = new DataView(out.buffer);
    let pa = 0;
    for (let t = 0; t < n; t += 3) {
      const g = (j) => (s[o + t + j] | (s[o + n + t + j] << 8));
      const a = (pa + g(0)) & 0xffff, b = (a + g(1)) & 0xffff, c = (a + g(2)) & 0xffff;
      pa = a;
      iv.setUint16(o + t * 2, a, true); iv.setUint16(o + t * 2 + 2, b, true); iv.setUint16(o + t * 2 + 4, c, true);
    }
  }
  D.binBytes = out; D.binZ = null;
}
// Every Meshy-made body (shattered, gutterless UV islands; see the texture loop in loadBody). The Mixamo stock bodies
// (Ch*, Aj, alex, Remy, Ant) have normal layouts and keep their mipmaps. A new Meshy body = add its id here.
const HERO_NOMIP = new Set([
  "dre", "nia", "diego", "lucia", "jake", "emily",                                   // playable six
  "marcus", "dee", "ray", "iris", "earl", "mateo", "omar", "mai", "sina",             // House Edge + Hustlin crew
  "grant", "wr_marcus",                                                               // Wealth Runner
  "cop_m", "cop_f", "labcoat_f", "scrubs_f", "suit_m", "blazer_f", "polo_m", "hijab_f", "elder_m", "auntie_f", "elder_f", "hoodie_m", "courier_m", "track_m",   // universal extras
  // 2026-11-05 new cast (G:\meshy\new-cast): hunters, line dealers, two locals, the six business outfits.
  // (pack-char.py also writes D.noMip for these; listed here too so the rule holds even on a repack without the sidecar.)
  "hit_suit", "hit_tac", "hit_f", "deal_kicks", "deal_pharma", "deal_trunk", "construction_m", "mechanic_f",
  "dre_biz", "nia_biz", "diego_biz", "lucia_biz", "jake_biz", "emily_biz",
  // Dirt and Deeds new cast (G:\meshy\dirt-and-deeds): the rule holds even if a repack has no sidecar.
  "hero_malik", "hero_simone", "hero_cole", "hero_hannah", "hero_rafa", "hero_dani",   // 2026-11-24 own heroes
  "mentor_m", "lender_f", "rival_m", "inspector_m", "code_f", "gc_m", "agent_f", "surveyor_m", "framer_m", "roofer_m", "painter_f", "demo_m", "landscaper_f"
]);
export async function loadBody(id, h) {
  if (!SM.BODY || !SM.BODY[id]) await script("src/chars/" + id + ".js");
  await unpackBin(SM.BODY && SM.BODY[id]);
  return model(id, h);
}

// ------------------------------------------------------------------ model data (once per body)

const models = {};
const gloveMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.55, metalness: 0.08 });

function model(id, h = HEAD_M) {
  if (models[id] !== undefined) return models[id];
  const D = SM.BODY && SM.BODY[id];
  if (!D) return (models[id] = null);
  const M = { id, D, BN: {} };
  D.bones.forEach((b, i) => { M.BN[b.name] = i; });
  let bin = D.binBytes;
  if (!bin) {
    const raw = atob(D.bin); bin = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i);
  }
  const nv = D.verts, buf = bin.buffer;
  let o = 0;
  const take = (Type, n) => { const a = new Type(buf, o, n); o += n * Type.BYTES_PER_ELEMENT; return a; };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(take(Float32Array, nv * 3), 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(take(Float32Array, nv * 2), 2));
  geo.setAttribute("normal", new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(take(Int8Array, nv * 4), 4), 3, 0, true));
  const si = take(Uint8Array, nv * 4), sw = take(Uint8Array, nv * 4);
  geo.setAttribute("skinIndex", new THREE.BufferAttribute(si, 4));
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4, true));
  const index = take(D.wideIndex ? Uint32Array : Uint16Array, D.index);
  if (D.colors) geo.setAttribute("color", new THREE.BufferAttribute(take(Uint8Array, nv * 4), 4, true));
  D.bin = null; D.binBytes = null;

  // Gloves: a vertex is "hand" when most of its skin weight is on a hand or finger bone.
  const handBone = new Uint8Array(D.bones.length);
  D.bones.forEach((b, i) => { if (/^(Left|Right)Hand/.test(b.name)) handBone[i] = 1; });
  const isHand = new Uint8Array(nv);
  for (let v = 0; v < nv; v++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (handBone[si[v * 4 + k]]) w += sw[v * 4 + k];
    isHand[v] = w > 140 ? 1 : 0;   // of 255
  }
  // Re-sort each material group into (body, glove) and add one glove group at the end.
  const out = new (D.wideIndex ? Uint32Array : Uint16Array)(index.length);
  const gloveTris = [];
  let w = 0, start = 0;
  const groups = [];
  D.groups.forEach((count, m) => {
    const g0 = w;
    for (let t = start; t < start + count; t += 3) {
      const a = index[t], b = index[t + 1], c = index[t + 2];
      if (isHand[a] + isHand[b] + isHand[c] >= 2) gloveTris.push(a, b, c);
      else { out[w++] = a; out[w++] = b; out[w++] = c; }
    }
    groups.push([g0, w - g0, m]);
    start += count;
  });
  const gStart = w;
  for (const v of gloveTris) out[w++] = v;
  geo.setIndex(new THREE.BufferAttribute(out, 1));
  groups.forEach(([s, n, m]) => { if (n) geo.addGroup(s, n, m); });
  if (gloveTris.length) geo.addGroup(gStart, gloveTris.length, D.materials.length);
  geo.computeBoundingSphere();
  geo.userData.keep = true;   // shared by every Actor of this body: main.js's disposeWorld leaves it alone
  M.geo = geo;
  M.geoLod = makeLod(geo, out, w, groups, gStart, gloveTris.length, D.materials.length) || geo;
  // Skinned meshes skip culling by default (three can't bound a moving skeleton), so every body drew in both
  // passes wherever it was. A fixed sphere around the rest pose, grown to cover reaching and falling, lets three
  // cull them for real, in the picture and in the sun's shadow pass.
  M.cullSphere = geo.boundingSphere.clone();
  M.cullSphere.radius *= 1.7;

  M.mats = D.materials.map((m) => {
    // ?charlit=lambert: Villa Spades' flat-diffuse look (no specular sheen, no normal-map noise) for comparing.
    const mat = /[?&]charlit=lambert/.test(location.search)
      ? new THREE.MeshLambertMaterial({ vertexColors: !!D.colors })
      : new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0.04, vertexColors: !!D.colors });
    for (const slot of Object.keys(m.tex)) {
      const img = new Image(), tx = new THREE.Texture(img);
      if (slot === "map") tx.colorSpace = THREE.SRGBColorSpace;
      tx.anisotropy = ANISO;
      // Meshy bodies draw with NO mipmaps (HERO_NOMIP). Meshy lays the skin out as islands that touch with no gutter,
      // so at select-screen / third-person size the GPU's smaller mip levels blend white shoe and skin islands into
      // black cloth: the white scratchy streaks on Dre, Nia and Emily (2026-11-03; no-mip render was clean, a Lambert
      // swap and a Meshy retexture were not). Close up they use mip 0-1 anyway; always-on-screen, so the cost is fine.
      // ?charmip=1 forces mips back on, ?charmip=0 drops them on every body (for comparing).
      const qm = /[?&]charmip=(\d)/.exec(location.search);
      const short = qm ? qm[1] === "0" : (D.noMip || HERO_NOMIP.has(id));
      if (short) { tx.generateMipmaps = false; tx.minFilter = THREE.LinearFilter; }
      img.onload = () => {
        // Potato/Low: draw it at the preset's fraction (keeps the GPU copy, and its upload, a quarter the size).
        if (TEX_SCALE < 1 && img.width > 256) {
          const c = document.createElement("canvas");
          c.width = Math.round(img.width * TEX_SCALE); c.height = Math.round(img.height * TEX_SCALE);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          tx.image = c;
        }
        if (short) shortMips(tx);
        tx.needsUpdate = true;
      };
      img.src = m.tex[slot];
      mat[slot] = tx;
    }
    if (mat.alphaMap) { mat.alphaTest = 0.5; mat.side = THREE.DoubleSide; }
    return mat;
  });
  M.mats.push(gloveMat);
  M.inverses = D.inverses.map((e) => new THREE.Matrix4().fromArray(e));
  M.nb = D.bones.length;
  M.rest = new Float32Array(M.nb * 4);
  D.bones.forEach((b, i) => M.rest.set(b.q, i * 4));
  M.hipsRest = D.bones[M.BN.Hips].p;

  // Head-top height in the rest pose -> scale to metres.
  const objs = D.bones.map((b) => {
    const ob = new THREE.Object3D();
    ob.position.fromArray(b.p); ob.quaternion.fromArray(b.q); ob.scale.fromArray(b.s);
    return ob;
  });
  const holder = new THREE.Object3D();
  D.bones.forEach((b, i) => (b.parent >= 0 ? objs[b.parent] : holder).add(objs[i]));
  holder.updateMatrixWorld(true);
  const top = M.BN.HeadTop_End !== undefined ? M.BN.HeadTop_End : M.BN.Head;
  const headY = new THREE.Vector3().setFromMatrixPosition(objs[top].matrixWorld).y;
  M.scale = h / (headY > 1 ? headY : (D.height || 180));

  M.clips = {};
  for (const k of Object.keys(SM.CLIPS || {})) {
    if (k === "__rest") continue;
    const c = SM.CLIPS[k];
    const rest = typeof c.rest === "string" ? SM.CLIPS.__rest[c.rest] : c.rest;
    const cl = { key: k, dur: c.dur, n: c.n, q: [], hp: null, s: M.hipsRest[1] / (c.hipsRest || M.hipsRest[1]), loop: LOOPS.has(k) };
    for (const tr of c.tracks) {
      if (tr.k === "hp") { cl.hp = new Float32Array(tr.v); continue; }
      const bi = M.BN[tr.b];
      if (bi !== undefined) cl.q.push({ i: bi, v: new Float32Array(tr.v), ...retarget(D, bi, rest) });
    }
    const e = (c.n - 1) * 3;
    cl.mps = cl.hp ? Math.hypot(cl.hp[e], cl.hp[e + 2]) * cl.s * M.scale / c.dur : 0;
    M.clips[k] = cl;
  }
  return (models[id] = M);
}

// The far copy: same vertex buffers (shared attributes, so no extra GPU memory for them), a simplified index per
// material group. Packed bodies split vertices along every UV seam (Meshy's atlases have hundreds), and simplifying
// that as-is opens cracks, so the mesh is welded by position first, simplified, and each output corner is mapped
// back to the original vertex of that position whose UV sits closest to the triangle's first corner (same island).
function makeLod(geo, index, count, groups, gStart, gloveN, gloveMat) {
  if (!lodSupported()) return null;
  try {
    const nv = geo.attributes.position.count;
    const Wd = weld(geo.attributes.position.array, geo.attributes.uv.array);
    const lod = [], lodGroups = [];
    const all = groups.map(([s, n, m]) => [s, n, m]);
    if (gloveN) all.push([gStart, gloveN, gloveMat]);
    for (const [s, n, m] of all) {
      if (!n) continue;
      const g0 = lod.length;
      for (const v of simplifyRange(Wd, index, s, n, LOD_RATIO, 0.02)) lod.push(v);
      lodGroups.push([g0, lod.length - g0, m]);
    }
    if (lod.length >= count * 0.8) return null;   // didn't simplify much: not worth a second geometry
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(geo.attributes)) g.setAttribute(name, attr);
    g.setIndex(new THREE.BufferAttribute(nv > 65535 ? new Uint32Array(lod) : new Uint16Array(lod), 1));
    for (const [s, n, m] of lodGroups) g.addGroup(s, n, m);
    g.boundingSphere = geo.boundingSphere;
    g.userData.keep = true;
    return g;
  } catch (e) { console.warn("LOD skipped:", e.message); return null; }
}

// ------------------------------------------------------------------ retargeting

// Clips are local bone rotations from whatever rig they were recorded on. A body whose bones rest
// at other angles (a twist along the arm, say) needs each one corrected for the difference, in
// world space: with G = a bone's rest rotation accumulated down from the root (clip rig and body),
//   C = inv(G_clip) * G_body,   q_body = inv(C_parent) * q_clip * C_bone
// (at rest this gives back exactly the body's own rest pose). Near-identical rests skip it.
const _a = new THREE.Quaternion(), _b = new THREE.Quaternion();
const restCache = new WeakMap();
function restOffsets(D, rest) {
  // Per clip rig: C for every body bone (null where the rigs already agree), cached by rest object.
  let byBody = restCache.get(rest);
  if (!byBody) restCache.set(rest, (byBody = new Map()));
  if (byBody.has(D)) return byBody.get(D);
  // The body's side comes from its skinning (world bind = inverse of the inverse bind matrix): a
  // body's stored bone rotations can be a relaxed pose rather than the T-pose its mesh was bound in
  // (Dre's arms sit ~35 degrees lower), and correcting from that put his arms behind his back.
  const gs = [], gt = [], C = [], m = new THREE.Matrix4(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  D.bones.forEach((b, i) => {
    gt[i] = new THREE.Quaternion();
    m.fromArray(D.inverses[i]).invert().decompose(v, gt[i], sc);
    const ps = b.parent >= 0 ? gs[b.parent] : new THREE.Quaternion();
    const pt = b.parent >= 0 ? gt[b.parent] : new THREE.Quaternion();
    const ls = rest[b.name] ? new THREE.Quaternion().fromArray(rest[b.name]) : pt.clone().invert().multiply(gt[i]);
    gs[i] = ps.clone().multiply(ls);
    const c = gs[i].clone().invert().multiply(gt[i]);
    C[i] = Math.abs(c.w) > 0.9995 ? null : c;
  });
  byBody.set(D, C);
  return C;
}
// OFF by default: Mixamo rigs all run each bone's axis along the limb, so a raw copy already
// moves Dre's T-posed arms correctly; correcting for his ~37 degree bind difference from Ch36 added it
// twice and folded his arms behind his back (user, 2026-10-30). ?rt=1 turns it on for testing.
const RAW = !(typeof location !== "undefined" && /[?&]rt=1/.test(location.search));
function retarget(D, bi, rest) {
  if (!rest || RAW) return {};
  const C = restOffsets(D, rest), p = D.bones[bi].parent;
  const post = C[bi] ? C[bi].toArray() : null;
  const pre = p >= 0 && C[p] ? _a.copy(C[p]).invert().toArray() : null;
  return post || pre ? { pre, post } : {};
}
function mul(out, o, a, ao, b, bo) {
  const ax = a[ao], ay = a[ao + 1], az = a[ao + 2], aw = a[ao + 3], bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3];
  out[o] = ax * bw + aw * bx + ay * bz - az * by;
  out[o + 1] = ay * bw + aw * by + az * bx - ax * bz;
  out[o + 2] = az * bw + aw * bz + ax * by - ay * bx;
  out[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

// ------------------------------------------------------------------ sampling

const QS = new Float32Array(4);
function frameOf(cl, t) {
  const f = Math.max(0, Math.min(cl.n - 1, t * (SM.CLIP_FPS || 30))), a = Math.floor(f);
  return { a, b: Math.min(cl.n - 1, a + 1), u: f - a };
}
function sample(cl, t, out, w) {
  const F = frameOf(cl, t), a = F.a * 4, b = F.b * 4;
  for (const tr of cl.q) {
    THREE.Quaternion.slerpFlat(QS, 0, tr.v, a, tr.v, b, F.u);
    if (tr.pre) mul(QS, 0, tr.pre, 0, QS, 0);
    if (tr.post) mul(QS, 0, QS, 0, tr.post, 0);
    if (w >= 1) out.set(QS, tr.i * 4);
    else THREE.Quaternion.slerpFlat(out, tr.i * 4, out, tr.i * 4, QS, 0, w);
  }
}
function hipsAt(cl, t) {
  if (!cl.hp) return null;
  const F = frameOf(cl, t), v = cl.hp, a = F.a * 3, b = F.b * 3, u = F.u;
  return [(v[a] + (v[b] - v[a]) * u) * cl.s, (v[a + 1] + (v[b + 1] - v[a + 1]) * u) * cl.s, (v[a + 2] + (v[b + 2] - v[a + 2]) * u) * cl.s];
}

// ------------------------------------------------------------------ actors

// 2026-11-24 (user): everyone in Pecan Hollow is hustling, so everyone wears white wireless earbuds.
// Two tiny bud+stem meshes on the Head bone; offsets are metres, divided by the body scale (bones live in model units).
// EAR = [lateral, up, forward] from the Head bone origin (Mixamo: base of the skull).
const EAR = [0.074, 0.075, 0.0];
let budGeo = null, budMat = null;
function addEarbuds(actor, M) {
  const head = actor.bone("Head");
  if (!head) return;
  if (!budGeo) {
    const bud = new THREE.SphereGeometry(0.0085, 8, 6), stem = new THREE.CylinderGeometry(0.0028, 0.0028, 0.022, 6);
    stem.translate(0, -0.013, 0.006);
    const merged = new THREE.BufferGeometry(), parts = [bud.toNonIndexed(), stem.toNonIndexed()];
    for (const name of ["position", "normal"]) {
      const arrs = parts.map((p) => p.attributes[name].array), len = arrs.reduce((n, a) => n + a.length, 0), out = new Float32Array(len);
      let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
      merged.setAttribute(name, new THREE.BufferAttribute(out, 3));
    }
    budGeo = merged; budGeo.userData.keep = true;
    budMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.35, metalness: 0.0 });
  }
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(budGeo, budMat);
    m.position.set(side * EAR[0] / M.scale, EAR[1] / M.scale, EAR[2] / M.scale);
    m.scale.setScalar(1 / M.scale);
    m.castShadow = false;
    head.add(m);
  }
}

// One animated person. `sex` picks the locomotion set: "m" -> m_*, "f" -> f_*.
// Each frame call update(dt, speed): the base loop is chosen from the speed (idle / walk / run /
// sprint) unless a pose is held (hold("box_walk"), hold("seated")...), and a one-shot (play("punch"))
// plays over it and hands back. Facing is root.rotation.y (0 = looking down +z).
export class Actor {
  constructor(M, sex = "m") {
    this.M = M; this.sex = sex;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.body.scale.setScalar(M.scale);
    this.root.add(this.body);
    this.bones = M.D.bones.map((b) => {
      const bone = new THREE.Bone();
      bone.name = b.name;
      bone.position.fromArray(b.p); bone.quaternion.fromArray(b.q); bone.scale.fromArray(b.s);
      return bone;
    });
    M.D.bones.forEach((b, i) => (b.parent >= 0 ? this.bones[b.parent] : this.body).add(this.bones[i]));
    this.mesh = new THREE.SkinnedMesh(M.geo, M.mats);
    this.mesh.castShadow = true;
    this.mesh.boundingSphere = M.cullSphere;   // fixed, see model(): culled in both passes like any other mesh
    this.mesh.frustumCulled = true;
    this.body.add(this.mesh);
    this.body.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(this.bones, M.inverses), new THREE.Matrix4());
    addEarbuds(this, M);
    this.q = new Float32Array(M.nb * 4);
    this.base = null; this.prev = null; this.blend = 1;
    this.held = null;          // a pose loop that overrides locomotion
    this.shot = null;          // a one-shot: { cl, t, rate, keep, travel }
    this.rate = 1;
    this.setBase(this.loco("idle"), Math.random() * 3);
  }
  loco(kind) {
    // Holding a gun (this.armed, 2026-11-04 shootouts): the rifle aiming idle / walk / run.
    if (this.armed) { const k = "rifle_" + (kind === "sprint" ? "run" : kind); if (this.M.clips[k]) return k; }
    // Phone up (this.phone): texting idle/walk when the clips exist (tools/build-clips.mjs phoneMerge).
    if (this.phone && (kind === "idle" || kind === "walk")) {
      const p = this.sex + "_" + kind + "_ph";
      if (this.M.clips[p]) return p;
      if (this.M.clips["m_" + kind + "_ph"]) return "m_" + kind + "_ph";
    }
    // A walk of their own (2026-11-06: the glam women's catwalk, actor.walk = "catwalk").
    if (kind === "walk" && this.walk && this.M.clips[this.walk]) return this.walk;
    const k = this.sex + "_" + kind;
    if (this.M.clips[k]) return k;
    if (kind === "sprint") return this.M.clips[this.sex + "_run"] ? this.sex + "_run" : "m_sprint";
    return "m_" + kind;
  }
  bone(name) { const i = this.M.BN[name]; return i === undefined ? null : this.bones[i]; }
  // Far copy on or off (main.js cullActors, by distance from the camera).
  lod(far) { const g = far ? this.M.geoLod : this.M.geo; if (this.mesh.geometry !== g) this.mesh.geometry = g; }
  setBase(key, t) {
    const cl = this.M.clips[key];
    if (!cl || (this.base && this.base.cl === cl)) return;
    if (this.base) {
      this.prev = { cl: this.base.cl, t: this.base.t };
      this.blend = 0;
      if (t === undefined && this.base.cl.loop && cl.loop && /walk|run|sprint/.test(key)) t = (this.base.t / this.base.cl.dur) * cl.dur;
    }
    this.base = { cl, t: t || 0 };
  }
  hold(key) { this.held = key || null; }
  // Play a one-shot over everything. opts: { rate, keep (hold last frame until clear()), from, to, cut (no fade-in) }
  play(key, opts = {}) {
    const cl = this.M.clips[key];
    if (!cl) return 0;
    const from = opts.from || 0, to = Math.min(cl.dur, opts.to || cl.dur);
    // Straight on from a held pose (lying on the ground -> getting up): cut, don't fade in from the base loop.
    // opts.cut (2026-11-08): hit reactions and knockouts snap in too, so they land on the frame the hit does.
    const cut = !!(this.shot && this.shot.keep) || !!opts.cut;
    this.shot = { cl, t: from, to, rate: opts.rate || 1, keep: !!opts.keep, w: cut ? 1 : 0 };
    return (to - from) / (opts.rate || 1);
  }
  clear() { this.shot = null; }
  get busy() { return !!this.shot && (this.shot.keep || this.shot.t < this.shot.to); }

  // speed in m/s along the ground.
  update(dt, speed = 0) {
    const M = this.M;
    let key, rate = 1;
    if (this.held) {
      key = this.held;
      const cl = M.clips[key];
      if (cl && cl.mps > 0.1) rate = speed < 0.1 ? 0 : Math.max(0.5, Math.min(2, speed / cl.mps));
    } else if (speed < 0.15) key = this.loco("idle");
    else if (speed < 2.3) { key = this.loco("walk"); const cl = M.clips[key]; rate = Math.max(0.6, Math.min(1.6, speed / (cl.mps || 1.6))); }
    else if (speed < 4.6) { key = this.loco("run"); const cl = M.clips[key]; rate = Math.max(0.7, Math.min(1.5, speed / (cl.mps || 4))); }
    else { key = this.loco("sprint"); const cl = M.clips[key]; rate = Math.max(0.8, Math.min(1.6, speed / (cl.mps || 5.4))); }
    this.setBase(key);
    const b = this.base;
    b.t = b.cl.loop ? (b.t + dt * rate) % b.cl.dur : Math.min(b.cl.dur, b.t + dt * rate);
    if (this.blend < 1) this.blend = Math.min(1, this.blend + dt / BLEND);
    const q = this.q;
    q.set(M.rest);
    if (this.prev && this.blend < 1) {
      this.prev.t = this.prev.cl.loop ? (this.prev.t + dt) % this.prev.cl.dur : Math.min(this.prev.cl.dur, this.prev.t + dt);
      sample(this.prev.cl, this.prev.t, q, 1);
      sample(b.cl, b.t, q, this.blend * this.blend * (3 - 2 * this.blend));
    } else sample(b.cl, b.t, q, 1);
    let hy = hipsAt(b.cl, b.t)?.[1] ?? M.hipsRest[1];
    // The one-shot, faded in and out over ~0.15 s.
    const s = this.shot;
    if (s) {
      s.t = Math.min(s.to, s.t + dt * s.rate);
      const left = s.to - s.t;
      s.w = Math.min(1, s.w + dt / 0.12);
      const w = s.keep ? s.w : Math.min(s.w, left / 0.15);
      sample(s.cl, s.t, q, Math.max(0, Math.min(1, w)));
      const h = hipsAt(s.cl, s.t);
      if (h) hy = hy + (h[1] - hy) * Math.max(0, Math.min(1, w));
      if (!s.keep && left <= 0) this.shot = null;
    }
    for (let i = 0; i < M.nb; i++) this.bones[i].quaternion.fromArray(q, i * 4);
    this.bones[M.BN.Hips].position.set(M.hipsRest[0], hy, M.hipsRest[2]);
    if (this.post) this.post(this);   // pose fix-ups on top of the clip (main.js: hands on the e-bike bars)
  }
  // Turn a bone by a world-space rotation (keeps its children attached).
  turnWorld(bone, dq) {
    bone.getWorldQuaternion(_iq1).premultiply(dq);
    bone.parent.getWorldQuaternion(_iq2).invert();
    bone.quaternion.copy(_iq2.multiply(_iq1));
    bone.updateMatrixWorld(true);
  }
  // Two-bone IK: put side ("Left"/"Right") hand on a world point. The elbow keeps the clip's bend plane.
  reach(side, target) {
    const up = this.bone(side + "Arm"), lo = this.bone(side + "ForeArm"), h = this.bone(side + "Hand");
    if (!up || !lo || !h) return;
    up.getWorldPosition(_iS); lo.getWorldPosition(_iE); h.getWorldPosition(_iH);
    const la = _iS.distanceTo(_iE), lb = _iE.distanceTo(_iH);
    const d = Math.min(_iS.distanceTo(target), (la + lb) * 0.995);
    const want = Math.acos(Math.max(-1, Math.min(1, (la * la + lb * lb - d * d) / (2 * la * lb))));
    _iu.subVectors(_iS, _iE).normalize(); _iv.subVectors(_iH, _iE).normalize();
    const cur = Math.acos(Math.max(-1, Math.min(1, _iu.dot(_iv))));
    _ia.crossVectors(_iu, _iv);
    if (_ia.lengthSq() > 1e-8) { this.turnWorld(lo, _idq.setFromAxisAngle(_ia.normalize(), want - cur)); h.getWorldPosition(_iH); }
    _iu.subVectors(_iH, _iS).normalize(); _iv.subVectors(target, _iS).normalize();
    this.turnWorld(up, _idq.setFromUnitVectors(_iu, _iv));
  }
}
const _iq1 = new THREE.Quaternion(), _iq2 = new THREE.Quaternion(), _idq = new THREE.Quaternion();
const _iS = new THREE.Vector3(), _iE = new THREE.Vector3(), _iH = new THREE.Vector3();
const _iu = new THREE.Vector3(), _iv = new THREE.Vector3(), _ia = new THREE.Vector3();

// Short mip chain for Meshy textures (2026-11-04, user: "up close it looks good, at distance the texture is ugly").
// No mips at all shimmers into noise at range; a full chain bleeds Meshy's touching islands into white streaks
// (2026-11-03). Two extra levels (1/2, 1/4 size) take the worst of the shimmer out while the bleed stays within a
// few texels of each island edge. Used for every no-mip body here and every Meshy GLB (vehicles.js).
// ?mips=N to compare (0 = no mips, as before; 3+ gets closer to the streaky full chain).
const qMips = /[?&]mips=(\d)/.exec(typeof location !== "undefined" ? location.search : "");
export const SHORT_MIPS = qMips ? +qMips[1] : 2;
export function shortMips(tx) {
  const img = tx.image;
  tx.generateMipmaps = false;
  if (!SHORT_MIPS || !img || !img.width) { tx.minFilter = THREE.LinearFilter; return; }
  const levels = [img];
  let w = img.width, h = img.height, src = img;
  for (let i = 0; i < SHORT_MIPS && w > 1 && h > 1; i++) {
    w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(src, 0, 0, w, h);
    levels.push(c); src = c;
  }
  tx.mipmaps = levels;
  tx.minFilter = THREE.LinearMipmapLinearFilter;
}

// Little props people carry or wear, attached to bones.
export function attach(actor, boneName, obj) {
  const b = actor.bone(boneName);
  if (!b) return null;
  // Bones are in centimetres under the scaled body: undo the scale so props are authored in metres.
  const holder = new THREE.Group();
  holder.scale.setScalar(1 / actor.M.scale);
  holder.add(obj);
  b.add(holder);
  return holder;
}
