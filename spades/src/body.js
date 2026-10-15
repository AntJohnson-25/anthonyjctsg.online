// Bodies: the user's own characters from their other games (Work/chars/<id>.js, packed by
// tools/pack-chars.py: a Mixamo rig, skinned mesh, small JPEG textures) driven by the Mixamo
// clips in src/clips.js (tools/build-clips.mjs: walk, idle, the seated set). From X-Parkour's
// runner.js. A body faces -Z like everything else here (the holder turns Mixamo's +Z round).
//  - Body.load(id) downloads a character (with retries); Body.make(id, height) builds one.
//  - b.play(clip, { fade, rate, loop }) / b.update(dt): a little clip player (walking, the crowd).
//  - b.e: the same body seen the way seats.js reads an avatar (bones, rest pose, a 19-bone rig
//    by Mixamo bone name, clips as THREE.AnimationClips), so the table code drives it directly.
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const THREE = globalThis.THREE;
  const FPS = 30;
  const Body = { loading: {} };

  function fetchText(url, attempt) {
    return fetch(url + (attempt ? "?retry=" + attempt : "")).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .catch(function (err) { if (attempt < 3) return new Promise(function (ok) { setTimeout(ok, 500 * (attempt + 1)); }).then(function () { return fetchText(url, attempt + 1); }); throw err; });
  }
  Body.ready = function (id) { return !!(window.CJ_CHARS && window.CJ_CHARS[id]); };
  Body.load = function (id) {
    if (Body.ready(id)) return Promise.resolve(id);
    if (Body.loading[id]) return Body.loading[id];
    Body.loading[id] = fetchText("chars/" + id + ".js?v=1", 0).then(function (text) {
      const s = document.createElement("script");
      s.textContent = text + "\n//# sourceURL=chars/" + id + ".js";
      document.body.appendChild(s);
      return id;
    });
    return Body.loading[id];
  };

  // ------------------------------------------------------------------ shared per character
  const models = {};
  function model(id) {
    if (models[id]) return models[id];
    const D = window.CJ_CHARS[id];
    const raw = atob(D.bin), bin = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i);
    const nv = D.verts, buf = bin.buffer;
    let o = 0;
    function take(Type, n) { const a = new Type(buf, o, n); o += n * Type.BYTES_PER_ELEMENT; return a; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(take(Float32Array, nv * 3), 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(take(Float32Array, nv * 2), 2));
    geo.setAttribute("normal", new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(take(Int8Array, nv * 4), 4), 3, 0, true));
    geo.setAttribute("skinIndex", new THREE.BufferAttribute(take(Uint8Array, nv * 4), 4));
    geo.setAttribute("skinWeight", new THREE.BufferAttribute(take(Uint8Array, nv * 4), 4, true));
    geo.setIndex(new THREE.BufferAttribute(take(D.wideIndex ? Uint32Array : Uint16Array, D.index), 1));
    // Painted characters (Ant: image-to-3D, no texture) carry RGBA vertex colours after the index.
    if (D.colors) geo.setAttribute("color", new THREE.BufferAttribute(take(Uint8Array, nv * 4), 4, true));
    let start = 0;
    D.groups.forEach(function (count, m) { geo.addGroup(start, count, m); start += count; });
    const waits = [];
    const mats = D.materials.map(function (m) {
      const p = { color: 0xffffff, vertexColors: !!D.colors };
      ["map", "alphaMap"].forEach(function (slot) {
        if (!m.tex[slot]) return;
        const img = new Image(), tx = new THREE.Texture(img);
        if (slot === "map") tx.colorSpace = THREE.SRGBColorSpace;
        tx.anisotropy = 4;
        waits.push(new Promise(function (ok) { img.onload = function () { tx.needsUpdate = true; ok(); }; img.onerror = ok; }));
        img.src = m.tex[slot];
        p[slot] = tx;
      });
      const mat = new THREE.MeshLambertMaterial(p);
      if (p.alphaMap) { mat.alphaTest = 0.5; mat.side = THREE.DoubleSide; }
      return mat;
    });
    const BN = {};
    D.bones.forEach(function (b, i) { BN[b.name] = i; });
    let minY = Infinity;
    const P = geo.attributes.position.array;
    for (let i = 1; i < P.length; i += 3) if (P[i] < minY) minY = P[i];
    const hipsY = D.bones[BN.Hips].p[1];
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, hipsY, 0), D.height * 0.75);
    // Some models stand on y = 0, some (the Wealth Runner Meshy bodies) are centred on the hips:
    // clip hips heights are measured from the soles (minY), and the holder lifts the soles to 0.
    return (models[id] = {
      D: D, geo: geo, mats: mats, BN: BN, hipsY: hipsY, minY: minY, texReady: Promise.all(waits),
      inverses: D.inverses.map(function (e) { return new THREE.Matrix4().fromArray(e); }),
      hyScale: (hipsY - minY) / restHips()
    });
  }
  function restHips() { return window.PK.REST.find(function (b) { return b.n === "Hips"; }).pos[1]; }

  // The table code's 19 bones (seats.js order), by Mixamo name.
  const RIG = ["Hips", "Spine", "Spine2", "Neck", "Head",
    "RightShoulder", "RightArm", "RightForeArm", "RightHand", "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
    "RightUpLeg", "RightLeg", "RightFoot", "LeftUpLeg", "LeftLeg", "LeftFoot"];
  // A clip as a THREE.AnimationClip for this character (the hips height scaled to its rig).
  function animClip(b, key, name) {
    const c = window.PK.CLIPS[key];
    if (!c) return null;
    const times = new Float32Array(c.n);
    for (let i = 0; i < c.n; i++) times[i] = Math.min(i / FPS, c.dur);
    const tracks = [];
    Object.keys(c.tracks).forEach(function (bn) { if (b.M.BN[bn] !== undefined) tracks.push(new THREE.QuaternionKeyframeTrack(bn + ".quaternion", times, c.tracks[bn])); });
    const hp = new Float32Array(c.n * 3), k = b.M.hyScale;
    for (let i = 0; i < c.n; i++) { hp[i * 3] = b.hx; hp[i * 3 + 1] = c.hips[i * 3 + 1] * k + b.footY; hp[i * 3 + 2] = b.hz; }
    tracks.push(new THREE.VectorKeyframeTrack("Hips.position", times, hp));
    return new THREE.AnimationClip(name, c.dur, tracks);
  }

  // ------------------------------------------------------------------ one body
  function B(id, height) {
    const M = this.M = model(id);
    const D = M.D;
    this.id = id;
    this.height = height || 1.75;
    this.scale = this.height / D.height;
    this.root = new THREE.Group();          // feet on the ground, facing -Z
    this.holder = new THREE.Group();
    this.holder.scale.setScalar(this.scale);
    this.holder.rotation.y = Math.PI;
    this.holder.position.y = -M.minY * this.scale;
    this.footY = M.minY;
    this.root.add(this.holder);
    const holder = this.holder;
    const bones = this.bones = D.bones.map(function (b) {
      const bone = new THREE.Bone();
      bone.name = b.name;
      bone.position.fromArray(b.p); bone.quaternion.fromArray(b.q); bone.scale.fromArray(b.s);
      return bone;
    });
    D.bones.forEach(function (b, i) { (b.parent >= 0 ? bones[b.parent] : holder).add(bones[i]); });
    this.mesh = new THREE.SkinnedMesh(M.geo, M.mats);
    this.mesh.castShadow = true;
    holder.add(this.mesh);
    holder.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(bones, M.inverses), new THREE.Matrix4());
    this.nb = bones.length;
    this.hips = bones[M.BN.Hips];
    this.hx = D.bones[M.BN.Hips].p[0]; this.hz = D.bones[M.BN.Hips].p[2];
    this.restQ = new Float32Array(this.nb * 4);
    D.bones.forEach(function (b, i) { this.restQ.set(b.q, i * 4); }, this);
    this.pose = new Float32Array(this.nb * 4); this.pose.set(this.restQ);
    this.from = new Float32Array(this.nb * 4);
    this.cur = null; this.t = 0; this.rate = 1; this.loop = true; this.fade = 0; this.fadeLen = 0.2;
    this.hipsY = D.bones[M.BN.Hips].p[1]; this.fromY = this.hipsY;
    this.done = false;
  }
  // Start a clip, crossfading from whatever pose is showing.
  B.prototype.play = function (name, o) {
    o = o || {};
    const c = window.PK.CLIPS[name];
    if (!c) return;
    if (this.cur === name && !o.restart) { if (o.rate !== undefined) this.rate = o.rate; return; }
    this.from.set(this.pose); this.fromY = this.hipsY;
    this.fade = o.fade === undefined ? 0.25 : o.fade; this.fadeLen = Math.max(1e-4, this.fade);
    this.cur = name; this.clip = c; this.t = o.t !== undefined ? o.t : 0;
    this.loop = o.loop !== false; this.rate = o.rate || 1; this.done = false;
  };
  B.prototype.update = function (dt) {
    const c = this.clip;
    if (!c) return;
    this.t += dt * this.rate;
    if (this.t >= c.dur) { if (this.loop) this.t %= c.dur; else { this.t = c.dur; this.done = true; } }
    const f = Math.min(this.t * FPS, c.n - 1), i0 = Math.floor(f), i1 = Math.min(i0 + 1, c.n - 1), a = f - i0;
    const pose = this.pose, rest = this.restQ;
    for (let b = 0; b < this.nb; b++) {
      const tr = c.tracks[this.bones[b].name];
      if (tr) THREE.Quaternion.slerpFlat(pose, b * 4, tr, i0 * 4, tr, i1 * 4, a);
      else { pose[b * 4] = rest[b * 4]; pose[b * 4 + 1] = rest[b * 4 + 1]; pose[b * 4 + 2] = rest[b * 4 + 2]; pose[b * 4 + 3] = rest[b * 4 + 3]; }
    }
    let y = (c.hips[i0 * 3 + 1] * (1 - a) + c.hips[i1 * 3 + 1] * a) * this.M.hyScale + this.footY;
    if (this.fade > 0) {
      this.fade -= dt;
      const w = 1 - Math.max(0, this.fade) / this.fadeLen;
      for (let b = 0; b < this.nb; b++) THREE.Quaternion.slerpFlat(pose, b * 4, this.from, b * 4, pose, b * 4, w);
      y = this.fromY + (y - this.fromY) * w;
    }
    for (let b = 0; b < this.nb; b++) this.bones[b].quaternion.set(pose[b * 4], pose[b * 4 + 1], pose[b * 4 + 2], pose[b * 4 + 3]);
    this.hips.position.set(this.hx, y, this.hz);
    this.hipsY = y;
  };
  // Where a bone is in the world.
  B.prototype.bonePos = function (name, out) { return this.bones[this.M.BN[name]].getWorldPosition(out || new THREE.Vector3()); };

  // The table code's view of this body (what seats.js got from a glTF avatar).
  Object.defineProperty(B.prototype, "e", {
    get: function () {
      if (this._e) return this._e;
      const self = this, BN = this.M.BN;
      const wrap = new THREE.Group();
      wrap.add(this.root);
      this.root.updateMatrixWorld(true);
      const e = {
        gltf: { scene: wrap }, body: this, bones: this.bones,
        // The bind pose straight from the file (the bones may already have been animated).
        rest: this.M.D.bones.map(function (b) { return new THREE.Quaternion().fromArray(b.q); }),
        restPos: this.M.D.bones.map(function (b) { return new THREE.Vector3().fromArray(b.p); }),
        restScale: this.M.D.bones.map(function (b) { return new THREE.Vector3().fromArray(b.s); }),
        rig: RIG.map(function (n) { return BN[n] !== undefined ? self.bones[BN[n]] : null; }),
        height: this.height, minY: 0,   // the holder already stands the soles on y = 0
        clips: { "sit-table": animClip(this, "sit", "sit-table"), cheer: animClip(this, "sitwin", "cheer"), clap: animClip(this, "sitclap", "clap") }
      };
      if (e.rig.some(function (b, i) { return !b && i !== 3; })) e.rig = null;
      return (this._e = e);
    }
  });
  Body.make = function (id, height) { return new B(id, height); };
  // Resolves once a character's textures have decoded (for one-off renders, like portraits).
  Body.texReady = function (id) { return model(id).texReady; };
  HS.Body = Body;
})(globalThis.HS);
