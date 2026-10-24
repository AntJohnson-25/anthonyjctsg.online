// Players are rigged .glb characters (the Meshy athletes). The clips are Mixamo takes on the packed
// bodies (body.js), so one hidden body, the "driver", still plays every clip, and each frame its pose is
// copied onto the avatar (the retarget Fairway Kings and Batting Cage use):
//  - the avatar's rig is read from the skeleton's shape (19 bones; the names aren't relied on);
//  - each driver bone's rotation away from its bind pose goes onto the matching avatar bone, after the
//    avatar's own rest (T, A or arms down) is swung onto the driver's bind-pose directions;
//  - the hips go where the driver's hips are, scaled to the avatar's legs.
// Everything is measured in the driver's root frame (the root moves and turns all the time), and the avatar
// hangs under that root. Flips come along for free: the driver's bones carry the tumble.
import * as THREE from "three";
import { GLTFLoader } from "../vendor/jsm/loaders/GLTFLoader.js";

const NB = 19;
const HIPS = 0, SPINE = 1, CHEST = 2, NECK = 3, HEAD = 4;
// Logical bones on the driver (Mixamo names), in the reader's order.
const SRC = ["Hips", "Spine", "Spine2", "Neck", "Head",
  "RightShoulder", "RightArm", "RightForeArm", "RightHand", "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
  "RightUpLeg", "RightLeg", "RightFoot", "LeftUpLeg", "LeftLeg", "LeftFoot"];
// The bone each segment points at; -1 = no direction of its own (takes its parent's swing).
const TIP = [-1, CHEST, NECK, HEAD, -1, 6, 7, 8, -1, 10, 11, 12, -1, 14, 15, -1, 17, 18, -1];
const PARENT_SWING = { 4: 3, 8: 7, 12: 11, 15: 14, 18: 17 };

// ---- the rig, by shape -------------------------------------------------------------------------
function readRig(bones) {
  if (bones.length < 10) return null;
  const isBone = (o) => o && o.isBone;
  const kids = (b) => b.children.filter(isBone);
  const wp = new Map();
  bones.forEach((b) => wp.set(b, b.getWorldPosition(new THREE.Vector3())));
  const count = (b) => { let n = 1; kids(b).forEach((k) => { n += count(k); }); return n; };
  const roots = bones.filter((b) => !isBone(b.parent)).sort((a, b) => count(b) - count(a));
  const hips = roots[0];
  if (!hips) return null;
  const under = []; (function walk(b) { under.push(b); kids(b).forEach(walk); })(hips);
  const head = under.slice().sort((a, b) => wp.get(b).y - wp.get(a).y)[0];
  const path = [];
  for (let b = head; b; b = isBone(b.parent) ? b.parent : null) { path.push(b); if (b === hips) break; }
  if (path[path.length - 1] !== hips) return null;
  const onPath = new Set(path);
  const chain = (b) => { const c = [b]; let k = kids(b); while (k.length) { k.sort((x, y) => count(y) - count(x)); c.push(k[0]); k = kids(k[0]); } return c; };
  const arms = [], legs = [];
  path.forEach((b) => kids(b).forEach((k) => { if (!onPath.has(k)) (b === hips ? legs : arms).push(chain(k)); }));
  if (arms.length < 2 || legs.length < 2) return null;
  // Right = +X in the avatar's own frame (it faces -Z).
  const side = (c) => wp.get(c[Math.min(c.length - 1, 2)]).x;
  arms.sort((a, b) => side(b) - side(a));
  legs.sort((a, b) => side(b) - side(a));
  const armR = arms[0], armL = arms[arms.length - 1], legR = legs[0], legL = legs[legs.length - 1];
  if (armR.length < 3 || armL.length < 3 || legR.length < 3 || legL.length < 3) return null;
  if (wp.get(armR[armR.length - 1]).x <= 0) return null;
  const arm = (c) => { const n = c.length; return [n >= 4 ? c[n - 4] : null, c[n - 3], c[n - 2], c[n - 1]]; };
  const leg = (c) => [c[0], c[1], c[2]];
  const chest = armR[0].parent;
  const ci = path.indexOf(chest);
  if (ci < 0) return null;
  const lower = path.slice(ci + 1, path.length - 1), upper = path.slice(1, ci);
  const a = arm(armR), b = arm(armL), l = leg(legR), m = leg(legL);
  return [hips, lower.length ? lower[lower.length - 1] : null, chest, upper.length ? upper[upper.length - 1] : null, head,
    a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3], l[0], l[1], l[2], m[0], m[1], m[2]];
}

// ---- loading -------------------------------------------------------------------------------------
// A .glb (ArrayBuffer) -> an avatar that follows `driver` ({ root, bone(name), bindPose(fn) }), or null if its
// rig isn't readable. The driver must stand at the origin, unturned, while this runs.
// `tint` ({ hue }) turns the outfit colours round the colour wheel: a computer rival is built from the player's
// own model (the HopLobby look: flat-shaded, vertex colours) but dressed differently. Skin and hair tones stay.
// `opts`: facesPlusZ (Meshy's characters face +Z; the reader expects -Z), shirt (a team colour for the white tee).
export async function loadAvatar(buffer, driver, tint, opts) {
  opts = opts || {};
  const gltf = await new GLTFLoader().parseAsync(buffer.slice(0), "");
  let root = gltf.scene;
  if (opts.facesPlusZ) { const g = new THREE.Group(); root.rotation.y = Math.PI; g.add(root); root = g; }
  if (tint) retint(root, tint.hue || 0.5);
  if (opts.shirt !== undefined) dressShirt(root, opts.shirt);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  const bones = [];
  root.traverse((o) => { if (o.isBone) bones.push(o); });
  root.updateMatrixWorld(true);
  const map = readRig(bones);                    // read before turning: right = +X
  if (!map) return null;
  // Avatars face -Z; the driver's bind pose faces +Z: turn the avatar to match.
  root.rotation.set(0, Math.PI, 0);
  driver.root.add(root);
  driver.root.updateMatrixWorld(true);
  const av = new Avatar(root, map, driver);
  av.clips = gltf.animations || [];
  return av;
}

function retint(root, dh) {
  const c = new THREE.Color(), hsl = {};
  root.traverse((o) => {
    if (!o.isMesh) return;
    const a = o.geometry.getAttribute("color");
    if (!a) return;
    for (let i = 0; i < a.count; i++) {
      c.setRGB(a.getX(i), a.getY(i), a.getZ(i)).getHSL(hsl);
      if (hsl.s > 0.35 && hsl.h > 0.1 && hsl.h < 0.97) { c.setHSL((hsl.h + dh) % 1, hsl.s, hsl.l); a.setXYZ(i, c.r, c.g, c.b); }
    }
    a.needsUpdate = true;
  });
}

// Team colours on a textured character in a white tee: texels that are bright and nearly grey, between the
// hem and the neck (bind-pose height, so it holds whatever the pose), take the colour. Black shorts, skin, hair
// and the white socks and shoes (below the band) stay as they are.
function dressShirt(root, color) {
  const col = new THREE.Color(color);
  root.traverse((o) => {
    if (!o.isMesh || !o.material || !o.material.map) return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox, h = bb.max.y - bb.min.y;
    const m = o.material.clone();
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uShirt = { value: col };
      sh.uniforms.uBand = { value: new THREE.Vector2(bb.min.y + h * 0.45, bb.min.y + h * 0.86) };
      sh.vertexShader = "varying float vBindY;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvBindY = position.y;");
      sh.fragmentShader = "uniform vec3 uShirt;\nuniform vec2 uBand;\nvarying float vBindY;\n" + sh.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>
        float hiC = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
        float sat = hiC - min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
        float shirt = step(uBand.x, vBindY) * step(vBindY, uBand.y) * smoothstep(0.35, 0.55, hiC) * (1.0 - smoothstep(0.08, 0.18, sat));
        diffuseColor.rgb = mix(diffuseColor.rgb, uShirt * (0.3 + 0.8 * hiC), shirt);`);
    };
    m.customProgramCacheKey = () => "shirt";
    o.material = m;
  });
}

const _q = new THREE.Quaternion(), _p = new THREE.Quaternion(), _rq = new THREE.Quaternion();
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Matrix4();

class Avatar {
  constructor(root, map, driver) {
    this.root = root;
    this.map = map;
    this.g = driver;
    const G = driver.root;
    // Bones in parent-first order, each with its parent's index (-1 = above the skeleton).
    const order = [];
    (function walk(o) { if (o.isBone) order.push(o); o.children.forEach(walk); })(root);
    this.order = order;
    const idx = new Map(order.map((b, i) => [b, i]));
    this.oParent = order.map((b) => (idx.has(b.parent) ? idx.get(b.parent) : -1));
    this.oLogical = order.map((b) => map.indexOf(b));
    this.rq = order.map(() => new THREE.Quaternion());
    // The (static) frames above the skeleton, relative to the driver's root.
    const rootInv = new THREE.Matrix4().copy(G.matrixWorld).invert();
    const rootQInv = G.getWorldQuaternion(new THREE.Quaternion()).invert();
    const relQ = (o) => rootQInv.clone().multiply(o.getWorldQuaternion(new THREE.Quaternion()));
    const relP = (o) => o.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInv);
    this.topQ = new Map(); this.topInv = new Map();
    order.forEach((b, i) => {
      if (this.oParent[i] >= 0) return;
      this.topQ.set(b, relQ(b.parent));
      this.topInv.set(b, new THREE.Matrix4().multiplyMatrices(rootInv, b.parent.matrixWorld).invert());
    });
    const restQ = map.map((b) => (b ? relQ(b) : null));
    const restP = map.map((b) => (b ? relP(b) : null));
    this.hipsH = Math.max(0.3, restP[HIPS].y);

    // The driver in its bind pose: rotations, positions, hips height (root frame).
    const dRest = [], dPos = [];
    driver.bindPose(() => {
      SRC.forEach((n, i) => { const b = driver.bone(n); dRest[i] = relQ(b); dPos[i] = relP(b); });
    });
    this.dRestInv = dRest.map((q) => q.clone().invert());
    this.k = this.hipsH / Math.max(0.3, dPos[HIPS].y);   // avatar size / driver size

    // The avatar's rest, swung onto the driver's bind-pose directions, segment by segment.
    const sw = [];
    for (let i = 0; i < NB; i++) {
      sw[i] = new THREE.Quaternion();
      const t = TIP[i];
      if (t >= 0 && map[i] && map[t]) {
        const a = _v.copy(restP[t]).sub(restP[i]), d = _w.copy(dPos[t]).sub(dPos[i]);
        if (a.lengthSq() > 1e-8 && d.lengthSq() > 1e-8) sw[i].setFromUnitVectors(a.normalize(), d.normalize());
      }
    }
    for (let i = 0; i < NB; i++) if (PARENT_SWING[i] !== undefined) sw[i].copy(sw[PARENT_SWING[i]]);
    // Torso: keep only half the correction (an avatar's spine may lean on purpose).
    [SPINE, CHEST, NECK, HEAD].forEach((i) => sw[i].slerp(new THREE.Quaternion(), 0.5));
    this.tRest = map.map((b, i) => (b ? sw[i].clone().multiply(restQ[i]) : null));
  }

  // Copy the driver's current pose (its matrices must be up to date).
  follow() {
    const G = this.g, order = this.order, rq = this.rq;
    G.root.getWorldQuaternion(_rq).invert();
    for (let k = 0; k < order.length; k++) {
      const b = order[k], par = this.oParent[k], li = this.oLogical[k];
      const parentQ = par >= 0 ? rq[par] : this.topQ.get(b);
      if (li >= 0 && this.tRest[li]) {
        _q.copy(_rq).multiply(G.bone(SRC[li]).getWorldQuaternion(_p)).multiply(this.dRestInv[li]);   // driver's turn from its bind pose
        _q.multiply(this.tRest[li]);                                                                // onto the avatar
        b.quaternion.copy(_p.copy(parentQ).invert().multiply(_q));
      }
      rq[k].copy(parentQ).multiply(b.quaternion);
    }
    // Hips: over the driver's hips, scaled to the avatar.
    const hips = this.map[HIPS];
    _m.copy(G.root.matrixWorld).invert();
    G.bone("Hips").getWorldPosition(_v).applyMatrix4(_m).multiplyScalar(this.k);
    hips.position.copy(_v.applyMatrix4(this.topInv.get(hips) || new THREE.Matrix4()));
    this.root.updateMatrixWorld(true);
  }

  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
    this.root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); } });
  }
}
