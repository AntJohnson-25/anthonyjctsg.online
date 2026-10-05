// Mixamo characters: loading, clip playback, and the procedural paddle swing.
//
// Bodies and clips come from assets/ (tools/pack-chars.py). Clips are the
// shared animation library's locomotion takes (idle, walk, run, strafe, back-run,
// jump, head shake, twirl). The library has NO paddle/racket swings, so the
// swing is posed in code on top of whatever the legs are doing: the right arm
// is aimed through key directions (backswing -> contact -> follow-through) and
// the chest turns with it.
import * as THREE from "three";
import { assetJSON, assetURL } from "./assets.js";

export const TRAITS = {
  Ch08: { name: "Marcus" }, Ch15: { name: "Sarge" }, Ch17: { name: "Hardhat" }, Ch20: { name: "Crimson" },
  Ch28: { name: "Shadow" }, Ch31: { name: "Smitty" },
  Paladin_J_Nordstrom: { name: "Paladin" }, Peasant_Girl: { name: "Rosa", h: 0.94, style: "f" },
  Ch02: { name: "Sunny", h: 0.96, style: "f" }, Ch06: { name: "Dash" }
};
const HEIGHT_M = 1.8;

// Metres travelled per cycle by each locomotion take (ANIMATION_MAP.md), used
// to keep the feet in step with the ground speed.
const TRAVEL = { runM: 3.11, runF: 2.54, walkM: 1.66, walkF: 1.56, strLM: 2.9, strRM: 2.9, strLF: 2.32, strRF: 2.32,
  swLM: 1.72, swRM: 1.72, swLF: 1.75, swRF: 1.75, runBack: 1.98 };

let clipsP = null;
export function loadClips() {
  return clipsP || (clipsP = assetJSON("clips.json"));
}
export function loadRoster() {
  return assetJSON("chars/roster.json");
}

const models = {};
const texLoader = new THREE.TextureLoader();

export function loadModel(id) {
  if (models[id]) return models[id];
  return (models[id] = Promise.all([assetJSON("chars/" + id + ".json"), loadClips()])
    .then(([D, clips]) => prepare(id, D, clips)));
}

function prepare(id, D, clips) {
  const M = { id, D, BN: {} };
  D.bones.forEach((b, i) => { M.BN[b.name] = i; });
  const raw = atob(D.bin), bin = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i);
  D.bin = null;
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
  D.groups.forEach((count, mi) => { geo.addGroup(start, count, mi); start += count; });
  geo.computeBoundingSphere();
  M.geo = geo;
  M.mats = D.materials.map((m) => {
    const t = {};
    for (const slot of Object.keys(m.tex)) {
      const tx = texLoader.load(assetURL("chars/" + m.tex[slot]));
      if (slot === "map") tx.colorSpace = THREE.SRGBColorSpace;
      tx.anisotropy = 4;
      t[slot] = tx;
    }
    const mat = new THREE.MeshStandardMaterial({ map: t.map || null, normalMap: t.normalMap || null, roughness: 0.8, metalness: 0.04 });
    if (t.alphaMap) { mat.alphaMap = t.alphaMap; mat.alphaTest = 0.5; mat.side = THREE.DoubleSide; }
    return mat;
  });
  M.inverses = D.inverses.map((e) => new THREE.Matrix4().fromArray(e));
  M.nb = D.bones.length;
  M.restQ = D.bones.map((b) => new THREE.Quaternion().fromArray(b.q));
  M.parent = D.bones.map((b) => b.parent);

  // Bind pose world transforms (model units, cm).
  const objs = D.bones.map((b) => {
    const ob = new THREE.Object3D();
    ob.position.fromArray(b.p); ob.quaternion.fromArray(b.q); ob.scale.fromArray(b.s);
    return ob;
  });
  const holder = new THREE.Object3D();
  D.bones.forEach((b, i) => (b.parent >= 0 ? objs[b.parent] : holder).add(objs[i]));
  holder.updateMatrixWorld(true);
  M.bindW = objs.map((ob) => ob.getWorldQuaternion(new THREE.Quaternion()));
  M.bindP = objs.map((ob) => new THREE.Vector3().setFromMatrixPosition(ob.matrixWorld));
  const top = M.BN.HeadTop_End !== undefined ? M.BN.HeadTop_End : M.BN.Head;
  const trait = TRAITS[id] || {};
  M.scale = HEIGHT_M * (trait.h || 1) / M.bindP[top].y;
  M.style = trait.style || "m";
  M.name = trait.name || id;
  M.hipsP = D.bones[M.BN.Hips].p;

  // Clips -> per-bone frame arrays.
  M.clips = {};
  M.grip = [];
  for (const k of Object.keys(clips)) {
    const c = clips[k];
    if (c.pose) {
      // Retarget the bend, not the absolute rotation: this rig's rest finger rotations differ
      // from the source rig's (thumbs by ~40 degrees), so q = rest_here * rest_src^-1 * q_src.
      for (const tr of c.tracks) {
        const bi = M.BN[tr.b];
        if (bi === undefined) continue;
        const q = new THREE.Quaternion().fromArray(tr.rest).invert().multiply(new THREE.Quaternion().fromArray(tr.v));
        M.grip.push({ i: bi, q: M.restQ[bi].clone().multiply(q) });
      }
      continue;
    }
    const cl = { dur: c.dur, fps: c.fps, n: Math.round(c.dur * c.fps) + 1, q: [], hy: null, hyScale: M.hipsP[1] / (c.hipsRest || M.hipsP[1]) };
    for (const tr of c.tracks) {
      const bi = M.BN[tr.b];
      if (bi === undefined) continue;
      if (tr.k === "q") cl.q.push({ i: bi, v: new Float32Array(tr.v) });
      else if (tr.k === "hy") cl.hy = new Float32Array(tr.v);
    }
    M.clips[k] = cl;
  }
  return M;
}

// ---- clip sampling ----------------------------------------------------------------------

function sampleClip(cl, t, out, hy) {
  let x = t * cl.fps;
  if (x < 0) x = 0;
  if (x > cl.n - 1) x = cl.n - 1;
  const a = Math.floor(x), b = Math.min(cl.n - 1, a + 1), u = x - a;
  for (const tr of cl.q) THREE.Quaternion.slerpFlat(out, tr.i * 4, tr.v, a * 4, tr.v, b * 4, u);
  if (cl.hy) hy.v = (cl.hy[a] + (cl.hy[b] - cl.hy[a]) * u) * cl.hyScale;
}

// ---- swing poses ---------------------------------------------------------------------------
// Directions in the character's frame: x = their right, y = up, z = forward.
// u = shoulder -> elbow, f = elbow -> wrist, yaw = chest turn to the right (deg).
const K = (u, f, yaw) => ({ u: new THREE.Vector3(...u).normalize(), f: new THREE.Vector3(...f).normalize(), yaw });
const READY = K([0.3, -0.85, 0.35], [0.2, 0.15, 1], 0);
const POSES = {
  fh:    { back: K([0.75, -0.45, -0.45], [0.55, 0.2, -0.6], 42), hit: K([0.6, -0.6, 0.5], [0.4, 0.05, 1], 0), follow: K([-0.3, 0.05, 0.95], [-0.9, 0.5, 0.15], -40) },
  bh:    { back: K([-0.5, -0.55, 0.55], [-0.6, -0.1, -0.45], -48), hit: K([0.05, -0.55, 0.85], [-0.2, -0.05, 1], -8), follow: K([0.55, 0.15, 0.8], [0.85, 0.5, 0.1], 28) },
  oh:    { back: K([0.55, 0.6, -0.35], [-0.1, 0.65, -0.8], 35), hit: K([0.25, 0.95, 0.25], [0.1, 0.9, 0.45], 0), follow: K([-0.15, -0.5, 0.85], [-0.4, -0.85, 0.3], -30) },
  serve: { back: K([0.45, -0.75, -0.5], [0.3, -0.85, -0.45], 22), hit: K([0.3, -0.9, 0.3], [0.2, -0.45, 1], 0), follow: K([0.2, 0.45, 0.85], [0.1, 0.95, 0.3], -10) }
};
const LEFT_SERVE = K([-0.25, -0.5, 0.85], [0.15, 0.05, 1], 0);
const LEFT_OH = K([-0.3, 0.9, 0.3], [-0.1, 1, 0.25], 0);

function lerpPose(a, b, u, out) {
  out.u.copy(a.u).lerp(b.u, u).normalize();
  out.f.copy(a.f).lerp(b.f, u).normalize();
  out.yaw = a.yaw + (b.yaw - a.yaw) * u;
  return out;
}
const smooth = (x) => x * x * (3 - 2 * x);

// Pose at tau seconds from contact (negative = before).
function swingPose(kind, tau, out) {
  const soft = kind.endsWith("-soft");
  const P = POSES[kind.replace("-soft", "")] || POSES.fh;
  const back = soft ? lerpPose(READY, P.back, 0.45, { u: new THREE.Vector3(), f: new THREE.Vector3(), yaw: 0 }) : P.back;
  const follow = soft ? lerpPose(P.hit, P.follow, 0.45, { u: new THREE.Vector3(), f: new THREE.Vector3(), yaw: 0 }) : P.follow;
  if (tau <= -0.55) return lerpPose(READY, READY, 0, out);
  if (tau <= -0.22) return lerpPose(READY, back, smooth((tau + 0.55) / 0.33), out);
  if (tau <= 0) return lerpPose(back, P.hit, smooth((tau + 0.22) / 0.22), out);
  if (tau <= 0.2) return lerpPose(P.hit, follow, smooth(tau / 0.2), out);
  return lerpPose(follow, READY, smooth(Math.min(1, (tau - 0.2) / 0.4)), out);
}

// ---- the paddle -------------------------------------------------------------------------------

function paddleMesh(color) {
  const g = new THREE.Group();
  const w = 0.2, faceL = 0.27, handle = 0.13, th = 0.014, r = 0.045;
  const sh = new THREE.Shape();
  const x0 = -w / 2, x1 = w / 2, y0 = handle, y1 = handle + faceL;
  sh.moveTo(x0, y0 + r); sh.lineTo(x0, y1 - r); sh.quadraticCurveTo(x0, y1, x0 + r, y1);
  sh.lineTo(x1 - r, y1); sh.quadraticCurveTo(x1, y1, x1, y1 - r); sh.lineTo(x1, y0 + r);
  sh.quadraticCurveTo(x1, y0, x1 - r, y0); sh.lineTo(x0 + r, y0); sh.quadraticCurveTo(x0, y0, x0, y0 + r);
  const face = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: th, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.003, bevelSegments: 2 }),
    new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.1 }));
  face.position.z = -th / 2;
  face.castShadow = true;
  g.add(face);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, handle + 0.02, 10),
    new THREE.MeshStandardMaterial({ color: 0x1d1d22, roughness: 0.9 }));
  grip.position.y = handle / 2;
  grip.castShadow = true;
  g.add(grip);
  // Edge guard.
  const edge = new THREE.Mesh(new THREE.TorusGeometry(0.001, 0.001, 2, 4), new THREE.MeshBasicMaterial());
  edge.visible = false;
  g.add(edge);
  return g;   // long axis +y, face normal +z, grip end at the origin
}

// ---- a character in the scene ----------------------------------------------------------------

// How the hand holds the paddle. tilt = degrees the head leans toward the thumb, off = cm of
// handle butt past the wrist, palm = cm the handle sits into the palm, curl = finger curl scale.
// Tuned with close-up screenshots of all 10 characters.
const GRIP = { tilt: 25, off: 2.5, palm: 0.4, curl: 1.4 };

// Finger joints curled round the handle: [bone suffix, degrees].
const CURL = [["Index1", 60], ["Index2", 75], ["Index3", 50], ["Middle1", 70], ["Middle2", 80], ["Middle3", 55],
  ["Ring1", 75], ["Ring2", 85], ["Ring3", 55], ["Pinky1", 80], ["Pinky2", 85], ["Pinky3", 55]];
const CURL_THUMB = [["Thumb1", 12], ["Thumb2", 28], ["Thumb3", 30]];
// With the sword-grip fingers (assets/clips.json "grip", from Great Sword Idle.fbx): seat = cm
// from the fist's centre back to the butt of the handle, palm = cm the handle shifts toward the palm.
const SWORD = { seat: 5, palm: 0 };
// Share of the paddle-facing wrist roll done by the forearm (the hand does the rest).
const WRIST_ROLL_FOREARM = 0.7;

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Character {
  constructor(M, paddleColor) {
    this.M = M;
    const D = M.D;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.body.scale.setScalar(M.scale);
    this.root.add(this.body);
    this.bones = D.bones.map((b) => {
      const bone = new THREE.Bone();
      bone.name = b.name;
      bone.position.fromArray(b.p); bone.quaternion.fromArray(b.q); bone.scale.fromArray(b.s);
      return bone;
    });
    D.bones.forEach((b, i) => (b.parent >= 0 ? this.bones[b.parent] : this.body).add(this.bones[i]));
    this.mesh = new THREE.SkinnedMesh(M.geo, M.mats);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.body.add(this.mesh);
    this.body.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(this.bones, M.inverses), new THREE.Matrix4());

    // Paddle in the right hand. A frame that cancels the hand's bind rotation
    // gives model axes at the hand; the paddle runs along the bind hand
    // direction (wrist -> middle knuckle) with its face parallel to the palm.
    const BN = M.BN, hand = BN.RightHand, mid = BN.RightHandMiddle1;
    const frame = new THREE.Object3D();
    frame.quaternion.copy(M.bindW[hand]).invert();
    this.bones[hand].add(frame);
    const along = mid !== undefined ? M.bindP[mid].clone().sub(M.bindP[hand]).normalize() : new THREE.Vector3(-1, 0, 0);
    const palm = new THREE.Vector3(0, 1, 0);   // measured: in these packed rigs the palm side is +y (checked with close-ups)
    const side = new THREE.Vector3().crossVectors(along, palm).normalize();   // side x along = palm: a proper (right-handed) basis
    palm.crossVectors(side, along).normalize();
    // Which way the thumb lies across the palm: the paddle head leans that way, so the
    // handle runs diagonally across the palm like a real grip.
    const th1 = BN.RightHandThumb1, th2 = BN.RightHandThumb2;
    const thumb = th1 !== undefined ? M.bindP[th2 !== undefined ? th2 : th1].clone().sub(M.bindP[th2 !== undefined ? th1 : hand]) : new THREE.Vector3();
    const toThumb = Math.sign(thumb.dot(new THREE.Vector3().crossVectors(palm, along))) || 1;
    this.paddle = paddleMesh(paddleColor);
    this.paddle.scale.setScalar(1 / M.scale);
    frame.add(this.paddle);
    this.curls = this.fingerCurls(toThumb);
    const fist = M.grip.length ? this.fistAxis(frame) : null;
    if (fist) {
      // Sword grip: the handle runs through the closed fist, head out past the index finger.
      const ax = fist.axis, face = palm.clone().addScaledVector(ax, -palm.dot(ax)).normalize();
      this.paddle.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(ax, face), ax, face));
      this.paddle.position.copy(fist.centre).addScaledVector(ax, -SWORD.seat / 100 / M.scale).addScaledVector(face, SWORD.palm / 100 / M.scale);
    } else {
      this.paddle.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, along, palm))
        .multiply(_q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), toThumb * GRIP.tilt * Math.PI / 180));
      // The butt of the handle sits just past the wrist crease and the handle lies in the palm.
      this.paddle.position.set(0, 0, 0)
        .addScaledVector(along, GRIP.off / 100 / M.scale)
        .addScaledVector(palm, GRIP.palm / 100 / M.scale);
    }
    this.paddleFace = new THREE.Object3D();   // face centre, for the ball and effects
    this.paddleFace.position.set(0, 0.13 + 0.135, 0);
    this.paddle.add(this.paddleFace);

    this.lq = new Float32Array(M.nb * 4);
    this.tmp = new Float32Array(M.nb * 4);
    this.phase = 0;
    this.idleT = Math.random() * 5;
    this.cur = { u: READY.u.clone(), f: READY.f.clone(), yaw: 0 };
    this.lcur = { u: LEFT_SERVE.u.clone(), f: LEFT_SERVE.f.clone(), yaw: 0 };
    this.lw = 0;
    this.bhW = 0;   // 0 = forehand side, 1 = backhand side (which face of the hand meets the ball)
    this.wristRoll = 0;
    this.yaw = 0;
    this.moodClip = null;
    this.moodW = 0;
    this.lastMood = null;
    this.moodStart = 0;
  }

  // The right hand's fingers: the sword-grip pose when it is loaded, else the coded curls.
  closeHand() {
    if (this.M.grip.length) {
      for (const g of this.M.grip) this.bones[g.i].quaternion.copy(g.q);
      return;
    }
    for (const c of this.curls) {
      _q.setFromAxisAngle(c.axis, c.deg * GRIP.curl * Math.PI / 180);
      this.bones[c.bi].quaternion.copy(this.M.restQ[c.bi]).multiply(_q);
    }
  }

  // Where the closed fist's hole runs, in `frame` (model axes at the hand, model units): a line
  // through the middle of each curled finger, pinky -> index. Measured on this character's own
  // hand with the grip pose applied, so the handle fits every hand size.
  fistAxis(frame) {
    const BN = this.M.BN;
    this.closeHand();
    this.body.updateMatrixWorld(true);
    const mids = [];
    for (const f of ["Index", "Middle", "Ring", "Pinky"]) {
      const c = new THREE.Vector3();
      let n = 0;
      for (let j = 1; j <= 4; j++) {
        const bi = BN["RightHand" + f + j];
        if (bi === undefined) continue;
        c.add(frame.worldToLocal(_v.setFromMatrixPosition(this.bones[bi].matrixWorld)));
        n++;
      }
      if (n >= 3) mids.push(c.divideScalar(n));
    }
    if (mids.length < 2) return null;
    const centre = mids.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(mids.length);
    const axis = mids[0].clone().sub(mids[mids.length - 1]).normalize();
    return { centre, axis };
  }

  // Per finger joint: the curl axis in that bone's own bind frame. A positive angle bends the
  // finger from straight toward the palm (axis = finger direction x palm normal); the thumb
  // bends across the palm toward the fingers.
  fingerCurls(toThumb) {
    const M = this.M, BN = M.BN, hand = BN.RightHand;
    const out = [];
    const mid = BN.RightHandMiddle1;
    if (hand === undefined || mid === undefined) return out;
    const along = M.bindP[mid].clone().sub(M.bindP[hand]).normalize();
    const palm = new THREE.Vector3(0, 1, 0);   // same palm side as the paddle seat above
    const side = new THREE.Vector3().crossVectors(along, palm).normalize();
    palm.crossVectors(side, along).normalize();
    for (const [list, thumb] of [[CURL, false], [CURL_THUMB, true]]) {
      for (const [suffix, deg] of list) {
        const bi = BN["RightHand" + suffix];
        if (bi === undefined) continue;
        const axisW = thumb
          ? new THREE.Vector3().crossVectors(palm, along).multiplyScalar(toThumb).normalize()   // thumb folds toward the fingers
          : new THREE.Vector3().crossVectors(along, palm).normalize();
        const axis = axisW.applyQuaternion(_q.copy(M.bindW[bi]).invert());
        out.push({ bi, axis, deg });
      }
    }
    return out;
  }

  clip(name) { return this.M.clips[name + (this.M.style === "f" && this.M.clips[name + "F"] ? "F" : this.M.clips[name + "M"] ? "M" : "")] || this.M.clips[name]; }

  // st: { vx, vz, yaw, time, swingKind, tau (null = no swing), left: "serve"|"oh"|null, mood }
  update(dt, st) {
    const M = this.M, lq = this.lq, tmp = this.tmp, nb = M.nb;
    this.yaw = st.yaw;
    this.root.rotation.y = st.yaw;
    // Local velocity: forward and right components.
    const fx = Math.sin(st.yaw), fz = Math.cos(st.yaw);
    // right = v . R with R = F x Y = (-fz, 0, fx)
    const fwd = st.vx * fx + st.vz * fz, rgt = st.vx * -fz + st.vz * fx;
    const sp = Math.hypot(st.vx, st.vz);
    const f = this.M.style === "f" ? "F" : "M";
    const set = [];
    const wIdle = Math.max(0, Math.min(1, 1 - (sp - 0.15) / 0.55));
    this.idleT += dt;
    set.push([M.clips["idle" + f], wIdle, this.idleT % M.clips["idle" + f].dur]);
    if (wIdle < 1) {
      const run = Math.max(0, Math.min(1, (sp - 1.5) / 2.2));
      const cf = Math.max(0, fwd / sp), cb = Math.max(0, -fwd / sp), cr = Math.max(0, rgt / sp), cl = Math.max(0, -rgt / sp);
      const tot = cf + cb + cr + cl || 1;
      const L = 1 - wIdle;
      const dirs = [
        [cf, "walk" + f, "run" + f], [cr, "swR" + f, "strR" + f], [cl, "swL" + f, "strL" + f], [cb, "runBack", "runBack"]
      ];
      let travel = 0, tw = 0;
      for (const [c, walk, runk] of dirs) {
        if (c <= 0.01) continue;
        const w = L * c / tot;
        if (walk === runk) { set.push([M.clips[runk], w, null]); travel += TRAVEL[runk] * w; tw += w; continue; }
        if (run < 1) { set.push([M.clips[walk], w * (1 - run), null]); travel += TRAVEL[walk] * w * (1 - run); tw += w * (1 - run); }
        if (run > 0) { set.push([M.clips[runk], w * run, null]); travel += TRAVEL[runk] * w * run; tw += w * run; }
      }
      const stride = (tw ? travel / tw : 2) * (M.scale * M.bindP[M.BN.Hips].y / 1.0) / 0.95;
      this.phase = (this.phase + sp * dt / Math.max(0.5, stride)) % 1;
    }
    // Blend.
    for (let j = 0; j < nb; j++) M.restQ[j].toArray(lq, j * 4);
    let wsum = 0, hy = 0;
    const hyOut = { v: M.hipsP[1] };
    for (const [cl, w, t] of set) {
      if (!cl || w <= 0.001) continue;
      sampleClip(cl, t == null ? this.phase * cl.dur : t, tmp, hyOut);
      wsum += w;
      const k = w / wsum;
      for (const tr of cl.q) THREE.Quaternion.slerpFlat(lq, tr.i * 4, lq, tr.i * 4, tmp, tr.i * 4, k);
      hy += (hyOut.v - hy) * k;
    }
    // Mood one-shots (jump, head shake, twirl) over everything.
    const moodName = st.mood === "win" ? "jump" + f : st.mood === "lose" ? "shake" : st.mood === "twirl" ? "twirl" : null;
    if (moodName && moodName !== this.lastMood) { this.moodStart = st.time; this.moodClip = M.clips[moodName]; }
    this.lastMood = moodName;
    this.moodW = Math.max(0, Math.min(1, this.moodW + (moodName ? dt / 0.2 : -dt / 0.3)));
    if (this.moodClip && this.moodW > 0) {
      const cl = this.moodClip;
      let t = st.time - this.moodStart;
      if (cl === M.clips.twirl) t %= cl.dur + 1.2;
      sampleClip(cl, Math.min(t, cl.dur), tmp, hyOut);
      const k = smooth(this.moodW);
      for (const tr of cl.q) THREE.Quaternion.slerpFlat(lq, tr.i * 4, lq, tr.i * 4, tmp, tr.i * 4, k);
      hy += (hyOut.v - hy) * k;
    }
    for (let j = 0; j < nb; j++) this.bones[j].quaternion.fromArray(lq, j * 4);
    // Fingers closed round the handle, whatever the clip does with the hand.
    this.closeHand();
    const hb = this.bones[M.BN.Hips];
    hb.position.set(M.hipsP[0], hy || M.hipsP[1], M.hipsP[2]);

    // Swing layer.
    const target = st.tau == null ? lerpPose(READY, READY, 0, { u: _v3.clone(), f: _v4.clone(), yaw: 0 }) : swingPose(st.swingKind, st.tau, { u: new THREE.Vector3(), f: new THREE.Vector3(), yaw: 0 });
    const rate = st.tau != null && st.tau > -0.25 && st.tau < 0.25 ? 40 : 14;
    const k = 1 - Math.exp(-rate * dt);
    this.cur.u.lerp(target.u, k).normalize();
    this.cur.f.lerp(target.f, k).normalize();
    this.cur.yaw += (target.yaw - this.cur.yaw) * k;
    const bh = st.tau != null && st.tau > -0.55 && st.tau < 0.6 && /^bh/.test(st.swingKind || "");
    this.bhW += ((bh ? 1 : 0) - this.bhW) * (1 - Math.exp(-10 * dt));
    const leftT = st.left === "serve" ? LEFT_SERVE : st.left === "oh" ? LEFT_OH : null;
    this.lw += ((leftT ? 1 : 0) - this.lw) * (1 - Math.exp(-10 * dt));
    if (leftT) { this.lcur.u.lerp(leftT.u, k).normalize(); this.lcur.f.lerp(leftT.f, k).normalize(); }
    const armW = st.armW == null ? 1 : st.armW;
    this.root.updateMatrixWorld(true);
    this.applyArms(armW * (1 - smooth(this.moodW)));
  }

  // Character frame -> world direction.
  toWorld(v, out) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    // R = (-fz, 0, fx), F = (fx, 0, fz)
    return out.set(v.x * -fz + v.z * fx, v.y, v.x * fx + v.z * fz);
  }

  aimBone(bi, childPos, dirWorld, w) {
    const bone = this.bones[bi];
    const from = _v.setFromMatrixPosition(bone.matrixWorld);
    const cur = _v2.copy(childPos).sub(from).normalize();
    _q.setFromUnitVectors(cur, dirWorld);
    bone.getWorldQuaternion(_q2);
    _q.multiply(_q2);                                   // new world rotation
    bone.parent.getWorldQuaternion(_q3).invert();
    _q3.multiply(_q);                                   // new local
    bone.quaternion.slerp(_q3, w);
    bone.updateMatrixWorld(true);
  }

  applyArms(w) {
    if (w <= 0.001) return;
    const BN = this.M.BN, b = this.bones;
    // Chest turn.
    const sp = b[BN.Spine1] || b[BN.Spine];
    if (sp && Math.abs(this.cur.yaw) > 0.1) {
      _q.setFromAxisAngle(UP, -this.cur.yaw * Math.PI / 180 * w);
      sp.getWorldQuaternion(_q2);
      _q.multiply(_q2);
      sp.parent.getWorldQuaternion(_q3).invert();
      sp.quaternion.copy(_q3.multiply(_q));
      sp.updateMatrixWorld(true);
    }
    const dir = new THREE.Vector3();
    const arm = (side, pose, weight) => {
      const ua = BN[side + "Arm"], fa = BN[side + "ForeArm"], ha = BN[side + "Hand"];
      this.aimBone(ua, _v4.setFromMatrixPosition(b[fa].matrixWorld), this.toWorld(pose.u, dir).normalize(), weight);
      this.aimBone(fa, _v4.setFromMatrixPosition(b[ha].matrixWorld), this.toWorld(pose.f, dir).normalize(), weight);
    };
    arm("Right", this.cur, w);
    if (this.lw > 0.01) arm("Left", this.lcur, this.lw * w);
    // Straighten the paddle wrist: the clips' relaxed hands are flexed, and that bend
    // read as a broken wrist once the arm was re-aimed and rolled.
    const hand = b[BN.RightHand], fore = b[BN.RightForeArm];
    hand.quaternion.slerp(this.M.restQ[BN.RightHand], w);
    hand.updateMatrixWorld(true);
    // Set the paddle face by rolling about the forearm axis. Most of the roll goes into the
    // forearm (pronation), the rest into the hand, so the wrist never twists hard.
    const axis = _v4.setFromMatrixPosition(hand.matrixWorld).sub(_v.setFromMatrixPosition(fore.matrixWorld)).normalize();
    // Thumb up, like a handshake: paddle +z (measured: the side of the hand that keeps the
    // thumb up) along forearm x UP. That says nothing when the forearm is vertical (overheads,
    // the serve), so there +z points back on forehands (palm to the net) and forward on backhands.
    // The two terms fade in and out continuously and never cancel in the swing poses, so the
    // hand never flips; the old "either face will do" fold flipped it 180 degrees mid-swing.
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(this.paddle.getWorldQuaternion(_q2));
    const want = new THREE.Vector3().crossVectors(axis, UP);
    const face = this.toWorld(_v2.set(0, 0, 2 * this.bhW - 1), new THREE.Vector3());
    want.addScaledVector(face.addScaledVector(axis, -face.dot(axis)), 0.6 * axis.y * axis.y);
    n.addScaledVector(axis, -n.dot(axis)).normalize();
    const wl = want.length();
    want.normalize();
    let ang = this.wristRoll;   // no clear target this frame: hold the last roll
    if (n.lengthSq() > 0.5 && wl > 0.05) {
      ang = Math.acos(Math.max(-1, Math.min(1, n.dot(want))));
      if (_v2.crossVectors(n, want).dot(axis) < 0) ang = -ang;
      // Keep the roll continuous from frame to frame: +180 and -180 give the same hand but split
      // differently between forearm and hand, so a wrap there would make the wrist jump.
      while (ang - this.wristRoll > Math.PI) ang -= 2 * Math.PI;
      while (ang - this.wristRoll < -Math.PI) ang += 2 * Math.PI;
      if (Math.abs(ang) > 1.4 * Math.PI) ang -= Math.sign(ang) * 2 * Math.PI;
      this.wristRoll = ang;
    }
    this.roll(fore, axis, ang * w * WRIST_ROLL_FOREARM);
    this.roll(hand, axis, ang * w * (1 - WRIST_ROLL_FOREARM));
  }

  // Rotate a bone about a world axis through its own origin.
  roll(bone, axis, ang) {
    _q.setFromAxisAngle(axis, ang);
    bone.getWorldQuaternion(_q2);
    _q.multiply(_q2);
    bone.parent.getWorldQuaternion(_q3).invert();
    bone.quaternion.copy(_q3.multiply(_q));
    bone.updateMatrixWorld(true);
  }

  paddleWorld(out) { return this.paddleFace.getWorldPosition(out); }
  leftHandWorld(out) {
    const BN = this.M.BN, b = this.bones[BN.LeftHandMiddle1 !== undefined ? BN.LeftHandMiddle1 : BN.LeftHand];
    return out.setFromMatrixPosition(b.matrixWorld);
  }
}
