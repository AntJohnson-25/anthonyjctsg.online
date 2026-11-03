// People for the lab: packed Mixamo bodies (src/chars/<id>.js, SM.BODY) driven by the shared clips
// (src/chars/clips.js, SM.CLIPS, built by tools/build-clips.mjs). Forked from Hustlin's chars.js, trimmed:
// no gloves, no shrunk-geometry unpacking. Loops play in place; the office moves the root.
//
//   const a = new Actor(await loadBody("marcus"), "m");
//   a.hold("texting");            // a pose loop that overrides idle/walk
//   a.play("sit_to_type");        // a one-shot over everything (a.busy while it runs)
//   a.update(dt, speed);          // every frame; speed in m/s picks idle/walk when nothing is held
import * as THREE from "three";

const SM = (globalThis.SM = globalThis.SM || {});
const HEAD_M = 1.78;     // bodies are scaled so the top of the head is here (metres)
const BLEND = 0.25;      // crossfade between base clips (s)
const LOOPS = new Set(["m_idle", "m_walk", "f_idle", "f_walk", "typing", "files_low", "files_high", "cabinet", "texting", "sit", "meeting_f", "meeting_m", "device", "fax"]);

// ------------------------------------------------------------------ loading

const loading = {};
function script(src) {
  return loading[src] || (loading[src] = new Promise((res, rej) => {
    const el = document.createElement("script");
    el.src = src; el.onload = res; el.onerror = () => rej(new Error("Could not load " + src));
    document.head.appendChild(el);
  }));
}
export async function loadClips() { await script("src/chars/clips.js"); }
export async function loadBody(id, h) {
  if (!SM.BODY || !SM.BODY[id]) await script("src/chars/" + id + ".js");
  return model(id, h);
}

// ------------------------------------------------------------------ model data (once per body)

const models = {};

function model(id, h = HEAD_M) {
  if (models[id] !== undefined) return models[id];
  const D = SM.BODY && SM.BODY[id];
  if (!D) return (models[id] = null);
  const M = { id, D, BN: {} };
  D.bones.forEach((b, i) => { M.BN[b.name] = i; });
  const raw = atob(D.bin), bin = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i);
  const nv = D.verts, buf = bin.buffer;
  let o = 0;
  const take = (Type, n) => { const a = new Type(buf, o, n); o += n * Type.BYTES_PER_ELEMENT; return a; };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(take(Float32Array, nv * 3), 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(take(Float32Array, nv * 2), 2));
  geo.setAttribute("normal", new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(take(Int8Array, nv * 4), 4), 3, 0, true));
  geo.setAttribute("skinIndex", new THREE.BufferAttribute(take(Uint8Array, nv * 4), 4));
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(take(Uint8Array, nv * 4), 4, true));
  geo.setIndex(new THREE.BufferAttribute(take(D.wideIndex ? Uint32Array : Uint16Array, D.index), 1));
  let start = 0;
  D.groups.forEach((count, m) => { geo.addGroup(start, count, m); start += count; });
  geo.computeBoundingSphere();
  D.bin = null;
  M.geo = geo;

  M.mats = D.materials.map((m) => {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0.04 });
    for (const slot of Object.keys(m.tex)) {
      const img = new Image(), tx = new THREE.Texture(img);
      if (slot === "map") tx.colorSpace = THREE.SRGBColorSpace;
      tx.anisotropy = 4;
      img.onload = () => { tx.needsUpdate = true; };
      img.src = m.tex[slot];
      mat[slot] = tx;
    }
    if (mat.alphaMap) { mat.alphaTest = 0.5; mat.side = THREE.DoubleSide; }
    return mat;
  });
  M.inverses = D.inverses.map((e) => new THREE.Matrix4().fromArray(e));
  M.nb = D.bones.length;
  M.rest = new Float32Array(M.nb * 4);
  D.bones.forEach((b, i) => M.rest.set(b.q, i * 4));
  M.hipsRest = D.bones[M.BN.Hips].p;
  // Wealth Runner's packs are authored with the hips at the origin (mesh spans -0.95..+0.95, Hips bone y ~0.06), which
  // sinks the body into the floor. Hold the hips high enough that the feet land on y = 0.
  geo.computeBoundingBox();
  const minY = geo.boundingBox.min.y;
  if (minY < -0.4) M.hipsRest = [M.hipsRest[0], M.hipsRest[1] - minY, M.hipsRest[2]];

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
    const cl = { key: k, dur: c.dur, n: c.n, q: [], hp: null, s: M.hipsRest[1] / (c.hipsRest || M.hipsRest[1]), loop: LOOPS.has(k) };
    for (const tr of c.tracks) {
      if (tr.k === "hp") { cl.hp = new Float32Array(tr.v); continue; }
      const bi = M.BN[tr.b];
      if (bi !== undefined) cl.q.push({ i: bi, v: new Float32Array(tr.v) });   // raw copy: Mixamo rigs share bone axes
    }
    const e = (c.n - 1) * 3;
    cl.mps = cl.hp ? Math.hypot(cl.hp[e], cl.hp[e + 2]) * cl.s * M.scale / c.dur : 0;
    M.clips[k] = cl;
  }
  return (models[id] = M);
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

// One animated person. `sex` picks the locomotion set: "m" -> m_*, "f" -> f_*. Facing is root.rotation.y
// (0 = looking down +z).
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
    this.mesh.frustumCulled = false;
    this.body.add(this.mesh);
    this.body.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(this.bones, M.inverses), new THREE.Matrix4());
    this.q = new Float32Array(M.nb * 4);
    this.base = null; this.prev = null; this.blend = 1;
    this.lastHy = M.hipsRest[1]; this.snap = null;
    this.held = null;          // a pose loop that overrides locomotion
    this.shot = null;          // a one-shot: { cl, t, rate, keep }
    this.setBase(this.loco("idle"), Math.random() * 3);
  }
  loco(kind) { return (this.M.clips[this.sex + "_" + kind] ? this.sex : "m") + "_" + kind; }
  setBase(key, t) {
    const cl = this.M.clips[key];
    if (!cl || (this.base && this.base.cl === cl)) return;
    if (this.base) {
      this.prev = { cl: this.base.cl, t: this.base.t };
      this.blend = 0;
    }
    this.base = { cl, t: t || 0 };
  }
  hold(key, t) { this.held = key || null; if (key) this.setBase(key, t); }
  // Play a one-shot over everything. opts: { rate, keep (hold the last frame until clear()), from, to }
  play(key, opts = {}) {
    const cl = this.M.clips[key];
    if (!cl) return 0;
    // opts.reverse plays the clip backwards (a stand-up becomes a sit-down)
    const rev = !!opts.reverse;
    const from = Math.min(cl.dur, opts.from ?? (rev ? cl.dur : 0)), to = Math.max(0, Math.min(cl.dur, opts.to ?? (rev ? 0 : cl.dur)));
    const cut = !!(this.shot && this.shot.keep);
    this.shot = { cl, t: from, to, dir: rev ? -1 : 1, rate: opts.rate || 1, keep: !!opts.keep, w: cut ? 1 : 0 };
    // opts.smooth: ease from the pose on screen now into the new one (no pop between unrelated poses)
    if (opts.smooth) { this.snap = { q: Float32Array.from(this.q), hy: this.lastHy }; this.snapT = 0; }
    return Math.abs(to - from) / (opts.rate || 1);
  }
  clear() { this.shot = null; }
  get busy() { const s = this.shot; return !!s && (s.keep || (s.dir < 0 ? s.t > s.to : s.t < s.to)); }
  get shotKey() { return this.shot ? this.shot.cl.key : null; }

  update(dt, speed = 0) {
    const M = this.M;
    let key, rate = 1;
    if (this.held) key = this.held;
    else if (speed < 0.15) key = this.loco("idle");
    else { key = this.loco("walk"); const cl = M.clips[key]; rate = Math.max(0.6, Math.min(1.6, speed / (cl.mps || 1.4))); }
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
    const s = this.shot;
    if (s) {
      s.t = s.dir < 0 ? Math.max(s.to, s.t - dt * s.rate) : Math.min(s.to, s.t + dt * s.rate);
      const left = s.dir < 0 ? s.t - s.to : s.to - s.t;
      s.w = Math.min(1, s.w + dt / 0.12);
      const w = s.keep ? s.w : Math.min(s.w, left / 0.15);
      sample(s.cl, s.t, q, Math.max(0, Math.min(1, w)));
      const h = hipsAt(s.cl, s.t);
      if (h) hy = hy + (h[1] - hy) * Math.max(0, Math.min(1, w));
      if (!s.keep && left <= 0) this.shot = null;
    }
    if (this.snap) {
      this.snapT = Math.min(1, this.snapT + dt / 0.3);
      const e = this.snapT * this.snapT * (3 - 2 * this.snapT);
      for (let i = 0; i < M.nb; i++) THREE.Quaternion.slerpFlat(q, i * 4, this.snap.q, i * 4, q, i * 4, e);
      hy = this.snap.hy + (hy - this.snap.hy) * e;
      if (this.snapT >= 1) this.snap = null;
    }
    this.lastHy = hy;
    for (let i = 0; i < M.nb; i++) this.bones[i].quaternion.fromArray(q, i * 4);
    this.bones[M.BN.Hips].position.set(M.hipsRest[0], hy, M.hipsRest[2]);
  }
}

// Little props people carry, attached to bones (authored in metres).
export function attach(actor, boneName, obj) {
  const i = actor.M.BN[boneName], b = i === undefined ? null : actor.bones[i];
  if (!b) return null;
  const holder = new THREE.Group();
  holder.scale.setScalar(1 / actor.M.scale);
  holder.add(obj);
  b.add(holder);
  return holder;
}
