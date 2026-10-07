// The runner: a skinned Mixamo character (src/chars/<id>.js, built by tools/build-char.mjs +
// pack-chars.py) driven by the shared clips in PK.CLIPS by bone name. Bodies are in
// centimetres and scaled to 1.78 m; the holder turns Mixamo's +Z "forward" to the game's -Z.
(function (G) {
  "use strict";
  const T = window.THREE, PK = window.PK;
  const FPS = 30;
  const HEIGHT_M = 1.78;
  const REF_HIPS = 93.5;      // standing hips height (cm) in the clips' source rig

  const models = {};
  function model(id) {
    if (models[id]) return models[id];
    const D = window.CJ_CHARS[id];
    const raw = atob(D.bin), bin = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i);
    const nv = D.verts, buf = bin.buffer;
    let o = 0;
    function take(Type, n) { const a = new Type(buf, o, n); o += n * Type.BYTES_PER_ELEMENT; return a; }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.BufferAttribute(take(Float32Array, nv * 3), 3));
    geo.setAttribute("uv", new T.BufferAttribute(take(Float32Array, nv * 2), 2));
    geo.setAttribute("normal", new T.InterleavedBufferAttribute(new T.InterleavedBuffer(take(Int8Array, nv * 4), 4), 3, 0, true));
    geo.setAttribute("skinIndex", new T.BufferAttribute(take(Uint8Array, nv * 4), 4));
    geo.setAttribute("skinWeight", new T.BufferAttribute(take(Uint8Array, nv * 4), 4, true));
    geo.setIndex(new T.BufferAttribute(take(D.wideIndex ? Uint32Array : Uint16Array, D.index), 1));
    // Painted characters (Ant: image-to-3D, no texture) append RGBA vertex colours after the index.
    if (D.colors) geo.setAttribute("color", new T.BufferAttribute(take(Uint8Array, nv * 4), 4, true));
    let start = 0;
    D.groups.forEach(function (count, m) { geo.addGroup(start, count, m); start += count; });
    const mats = D.materials.map(function (m) {
      const p = { color: 0xffffff, vertexColors: !!D.colors };
      ["map", "alphaMap"].forEach(function (slot) {
        if (!m.tex[slot]) return;
        const img = new Image(), tx = new T.Texture(img);
        if (slot === "map") tx.colorSpace = T.SRGBColorSpace;
        tx.anisotropy = 4;
        img.onload = function () { tx.needsUpdate = true; };
        img.src = m.tex[slot];
        p[slot] = tx;
      });
      const mat = new T.MeshLambertMaterial(p);
      if (p.alphaMap) { mat.alphaTest = 0.5; mat.side = T.DoubleSide; }
      mat.emissive = new T.Color(0x1c1814);
      return mat;
    });
    const BN = {};
    D.bones.forEach(function (b, i) { BN[b.name] = i; });
    const hipsY = D.bones[BN.Hips].p[1];
    geo.boundingSphere = new T.Sphere(new T.Vector3(0, hipsY, 0), D.height * 1.2);
    return (models[id] = {
      D: D, geo: geo, mats: mats, BN: BN, hipsY: hipsY,
      inverses: D.inverses.map(function (e) { return new T.Matrix4().fromArray(e); }),
      scale: HEIGHT_M / D.height, hyScale: hipsY / REF_HIPS
    });
  }

  function Runner(id) {
    const M = this.m = model(id);
    const D = M.D;
    this.id = id;
    this.root = new T.Group();
    this.holder = new T.Group();
    this.holder.scale.setScalar(M.scale);
    this.holder.rotation.y = Math.PI;
    this.root.add(this.holder);
    this.bones = D.bones.map(function (b) {
      const bone = new T.Bone();
      bone.name = b.name;
      bone.position.fromArray(b.p); bone.quaternion.fromArray(b.q); bone.scale.fromArray(b.s);
      return bone;
    });
    const bones = this.bones, holder = this.holder;
    D.bones.forEach(function (b, i) { (b.parent >= 0 ? bones[b.parent] : holder).add(bones[i]); });
    this.mesh = new T.SkinnedMesh(M.geo, M.mats);
    this.mesh.frustumCulled = false;
    holder.add(this.mesh);
    holder.updateMatrixWorld(true);
    this.mesh.bind(new T.Skeleton(bones, M.inverses), new T.Matrix4());
    this.nb = bones.length;
    this.hips = bones[M.BN.Hips];
    this.restQ = new Float32Array(this.nb * 4);
    D.bones.forEach(function (b, i) { this.restQ.set(b.q, i * 4); }, this);
    this.hx = D.bones[M.BN.Hips].p[0]; this.hz = D.bones[M.BN.Hips].p[2];

    this.cur = null; this.curT = 0; this.rate = 1; this.loop = true; this.yMode = "abs";
    this.from = new Float32Array(this.nb * 4); this.fade = 0; this.fadeLen = 0.12;
    this.pose = new Float32Array(this.nb * 4);
    this.pose.set(this.restQ);
    this.fromY = M.D.bones[M.BN.Hips].p[1]; this.hipsY = this.fromY;
    this.done = false;
    // upper-body weight per bone for overlay(): the lowest spine bone half, everything above it full
    this.upper = new Float32Array(this.nb);
    bones.forEach(function (b, i) { this.upper[i] = b.name === "Spine" ? 0.5 : UPPER.test(b.name) ? 1 : 0; }, this);
    this.ov = null;
  }
  const UPPER = /Spine|Neck|Head|Shoulder|Arm|Hand|Thumb|Index|Middle|Ring|Pinky/;
  const _q = new Float32Array(4);

  // An upper-body overlay: clip `name` from o.t to o.t1 on the spine, arms and head, while the legs
  // keep the base clip (a throw on the run). Fades in and out; overlay(null) stops it.
  Runner.prototype.overlay = function (name, o) {
    const c = name && PK.CLIPS[name];
    if (!c) { this.ov = null; return; }
    o = o || {};
    this.ov = { c: c, t0: o.t || 0, t: o.t || 0, t1: Math.min(c.dur, o.t1 || c.dur), rate: o.rate || 1 };
  };

  // Start a clip. o: {loop, rate, fade, t, y:'abs'|'flat'|cm}. Crossfades from whatever pose is showing.
  Runner.prototype.play = function (name, o) {
    o = o || {};
    const c = PK.CLIPS[name];
    if (!c) return;
    if (this.cur === name && !o.restart) { if (o.rate !== undefined) this.rate = o.rate; return; }
    this.from.set(this.pose);
    this.fromY = this.hipsY;
    this.fade = o.fade === undefined ? 0.12 : o.fade;
    this.fadeLen = Math.max(this.fade, 1e-4);
    this.cur = name;
    this.clip = c;
    this.curT = o.t || 0;
    this.loop = o.loop !== false;
    this.rate = o.rate || 1;
    this.yMode = o.y || "abs";
    this.done = false;
  };

  Runner.prototype.update = function (dt) {
    const c = this.clip;
    if (!c) return;
    this.curT += dt * this.rate;
    if (this.curT >= c.dur) {
      if (this.loop) this.curT %= c.dur; else { this.curT = c.dur; this.done = true; }
    }
    const f = Math.min(this.curT * FPS, c.n - 1);
    const i0 = Math.floor(f), i1 = Math.min(i0 + 1, c.n - 1), a = f - i0;
    const pose = this.pose, rest = this.restQ;
    for (let b = 0; b < this.nb; b++) {
      const tr = c.tracks[this.bones[b].name];
      if (tr) T.Quaternion.slerpFlat(pose, b * 4, tr, i0 * 4, tr, i1 * 4, a);
      else { pose[b * 4] = rest[b * 4]; pose[b * 4 + 1] = rest[b * 4 + 1]; pose[b * 4 + 2] = rest[b * 4 + 2]; pose[b * 4 + 3] = rest[b * 4 + 3]; }
    }
    const hp = c.hips, k = this.m.hyScale;
    // y: "abs" = the clip's hips height, "flat" = its first frame, a number = that height (cm) held fixed
    let y = (typeof this.yMode === "number" ? this.yMode : this.yMode === "flat" ? hp[1] : hp[i0 * 3 + 1] * (1 - a) + hp[i1 * 3 + 1] * a) * k;
    if (this.fade > 0) {
      this.fade -= dt;
      const w = 1 - Math.max(0, this.fade) / this.fadeLen;
      for (let b = 0; b < this.nb; b++) T.Quaternion.slerpFlat(pose, b * 4, this.from, b * 4, pose, b * 4, w);
      y = this.fromY + (y - this.fromY) * w;
    }
    const ov = this.ov;
    if (ov) {
      ov.t += dt * ov.rate;
      const into = (ov.t - ov.t0) / ov.rate, left = (ov.t1 - ov.t) / ov.rate;
      if (left <= 0) this.ov = null;
      else {
        const w = Math.min(1, into / 0.1, left / 0.18);
        const oc = ov.c, of = Math.min(ov.t * FPS, oc.n - 1), j0 = Math.floor(of), j1 = Math.min(j0 + 1, oc.n - 1), oa = of - j0;
        for (let b = 0; b < this.nb; b++) {
          const u = this.upper[b], tr = u && oc.tracks[this.bones[b].name];
          if (!tr) continue;
          T.Quaternion.slerpFlat(_q, 0, tr, j0 * 4, tr, j1 * 4, oa);
          T.Quaternion.slerpFlat(pose, b * 4, pose, b * 4, _q, 0, w * u);
        }
      }
    }
    for (let b = 0; b < this.nb; b++) this.bones[b].quaternion.set(pose[b * 4], pose[b * 4 + 1], pose[b * 4 + 2], pose[b * 4 + 3]);
    this.hips.position.set(this.hx, y, this.hz);
    this.hipsY = y;
  };

  G.Runner = Runner;
})(window.CJ = window.CJ || {});
