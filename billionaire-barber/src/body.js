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

  // ------------------------------------------------------------------ hats off (Billionaire Barber)
  // For while a client sits in the barber's chair: a copy of their geometry with the headwear
  // taken out, plus a short fresh-cut "hair cap" fitted to their skull (some models have no top
  // of the head under a hat: it was never modelled).
  // spec = { groups: [material groups that are only headwear],
  //          cut: 0..1   everything skinned to the head above this fraction of the head's height
  //                      comes off (the hat, and whatever was squashed under it),
  //          sides: [colours]   below the cut, side pieces in these colours come off too
  //                      (headphone cups): "red" | "white" | "grey" | "dark" (dark only when it
  //                      sticks out past the skull),
  //          hair: "#rrggbb"   the hair cap's colour }
  const hatless = {};
  Body.hatless = function (id, spec) {
    if (hatless[id]) return hatless[id];
    const M = model(id), D = M.D, geo = M.geo;
    const P = geo.attributes.position.array, UV = geo.attributes.uv.array;
    const SI = geo.attributes.skinIndex.array, SW = geo.attributes.skinWeight.array;
    const IDX = geo.index.array, hb = M.BN.Head;
    // how much of each vertex is skinned to the head (or anything under it: eyes, head top)
    const under = {};
    D.bones.forEach(function (b, i) { let p = i; while (p >= 0) { if (p === hb) { under[i] = 1; break; } p = D.bones[p].parent; } });
    const nv = P.length / 3, headW = new Float32Array(nv);
    for (let v = 0; v < nv; v++) for (let k = 0; k < 4; k++) if (under[SI[v * 4 + k]]) headW[v] += SW[v * 4 + k] / 255;
    const isHead = function (v) { return headW[v] > 0.6; };
    // The skull, from the bones (hoods and collars are often skinned to the head too, so the
    // vertices alone over-measure it): the Head joint to HeadTop_End at the crown is length L.
    const bindPos = function (i) { return new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(M.inverses[i]).invert()); };
    const H0 = bindPos(hb);
    const ti = M.BN.HeadTop_End !== undefined ? M.BN.HeadTop_End : -1;
    const H1 = ti >= 0 ? bindPos(ti) : H0.clone().add(new THREE.Vector3(0, D.height * 0.1, 0));
    const L = Math.max(1e-6, H1.y - H0.y);
    const hy = function (y) { return (y - H0.y) / L; };          // 0 at the Head joint, 1 at the crown
    const near = function (v) { const dx = P[v * 3] - H0.x, dz = P[v * 3 + 2] - H0.z; return hy(P[v * 3 + 1]) > -0.25 && dx * dx + dz * dz < L * L * 1.6; };
    const cut = spec.cut === undefined ? 9 : spec.cut, cutY = H0.y + L * cut;
    // the skull's width and depth just under the cut (percentiles, so cups and brims don't count)
    const cx = H0.x, dxs = [], zs = [];
    for (let v = 0; v < nv; v++) {
      if (!isHead(v) || !near(v)) continue;
      const f = hy(P[v * 3 + 1]);
      if (f >= cut - 0.35 && f <= cut) dxs.push(Math.abs(P[v * 3] - cx));
    }
    dxs.sort(function (a, b) { return a - b; });
    const jawR = dxs.length ? dxs[Math.floor(dxs.length * 0.8)] : L * 0.46;
    for (let v = 0; v < nv; v++) {
      if (!isHead(v) || !near(v)) continue;
      const f = hy(P[v * 3 + 1]);
      if (f >= cut - 0.35 && f <= cut && Math.abs(P[v * 3] - cx) < jawR * 0.5) zs.push(P[v * 3 + 2]);
    }
    zs.sort(function (a, b) { return a - b; });
    // the jaw/cheeks (well below any hat or headphones): the best guide to the head's real width
    const low = [];
    for (let v = 0; v < nv; v++) if (isHead(v) && near(v)) { const f = hy(P[v * 3 + 1]); if (f > 0.05 && f < 0.28) low.push(Math.abs(P[v * 3] - cx)); }
    low.sort(function (a, b) { return a - b; });
    const jawRLow = low.length ? low[Math.floor(low.length * 0.9)] : L * 0.42;
    const zb = zs.length ? zs[Math.floor(zs.length * 0.03)] : H0.z - L * 0.6, zf = zs.length ? zs[Math.floor(zs.length * 0.97)] : H0.z + L * 0.6;
    const xr = jawR;
    const imgs = D.materials.map(function (m) { if (!m.tex.map) return null; const img = new Image(); img.src = m.tex.map; return img; });
    return (hatless[id] = Promise.all(imgs.map(function (img) { return img && img.decode ? img.decode().catch(function () {}) : null; })).then(function () {
      const data = imgs.map(function (img) {
        if (!img || !img.width) return null;
        const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
        const g = c.getContext("2d"); g.drawImage(img, 0, 0);
        return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data };
      });
      function colorAt(m, v) {
        const t = data[m]; if (!t) return null;
        const u = UV[v * 2] - Math.floor(UV[v * 2]), w = UV[v * 2 + 1] - Math.floor(UV[v * 2 + 1]);
        const x = Math.min(t.w - 1, Math.floor(u * t.w)), y = Math.min(t.h - 1, Math.floor((1 - w) * t.h));
        const i = (y * t.w + x) * 4;
        return [t.d[i], t.d[i + 1], t.d[i + 2]];
      }
      function isColor(c, names, out) {
        if (!c) return false;
        const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
        return names.some(function (nm) {
          // (strict on purpose: brown skin is "reddish" and must never match)
          if (nm === "white") return mn > 140 && mx - mn < 50;
          if (nm === "grey") return mn > 105 && mx - mn < 30;
          if (nm === "midgrey") return mn > (spec.greyMin || 55) && mx - mn < 22;
          if (nm === "red") return c[0] > 90 && c[0] > c[1] * 2.1 && c[0] > c[2] * 2.1;
          if (nm === "dark") return out && mx < 70;
          return false;
        });
      }
      const drop = spec.groups || [], sides = spec.sides || [];
      const tilt = spec.tilt === undefined ? 0.3 : spec.tilt;
      // Islands: hats and headphones are modelled as separate pieces, not joined to the skin.
      // Weld vertices by position (UV seams split the skin into pieces otherwise), join each
      // triangle's corners, then an island that's entirely head-skinned and sits high on the head
      // or out at the sides is headwear. Eyes, teeth and brows are low and in front: they stay.
      const parent = new Int32Array(nv);
      for (let v = 0; v < nv; v++) parent[v] = v;
      const root = function (v) { while (parent[v] !== v) { parent[v] = parent[parent[v]]; v = parent[v]; } return v; };
      const join = function (a, b) { a = root(a); b = root(b); if (a !== b) parent[a] = b; };
      const q = L * 0.002, seen = new Map();
      for (let v = 0; v < nv; v++) {
        const k = Math.round(P[v * 3] / q) + "," + Math.round(P[v * 3 + 1] / q) + "," + Math.round(P[v * 3 + 2] / q);
        const s = seen.get(k);
        if (s === undefined) seen.set(k, v); else join(v, s);
      }
      for (let i = 0; i < IDX.length; i += 3) { join(IDX[i], IDX[i + 1]); join(IDX[i], IDX[i + 2]); }
      const isl = new Map();      // root -> { n, head, x, y, z }
      for (let v = 0; v < nv; v++) {
        const r = root(v);
        let s = isl.get(r);
        if (!s) isl.set(r, s = { n: 0, head: 0, x: 0, y: 0, z: 0 });
        s.n++; if (isHead(v)) s.head++;
        s.x += P[v * 3]; s.y += P[v * 3 + 1]; s.z += P[v * 3 + 2];
      }
      const hatIsland = new Set();
      isl.forEach(function (s, r) {
        if (s.head < s.n * 0.97) return;                        // not wholly on the head (the body)
        const x = s.x / s.n - cx, f = hy(s.y / s.n), z = s.z / s.n - H0.z;
        const front = z > L * 0.25 && Math.abs(x) < L * 0.3;
        if (front && f < 0.62) return;                          // eyes, teeth, tongue, brows
        if (f > (spec.islandAbove || 0.55) || Math.abs(x) > L * 0.38) hatIsland.add(r);
        // a strap or band round the back of the head (a hard hat's harness)
        else if (spec.islandBack && z < -L * 0.15 && Math.abs(x) < L * 0.3 && f > 0.42 && s.n < 400) hatIsland.add(r);
      });
      const skR = new THREE.Vector3(Math.max(L * 0.42, jawRLow), L * 0.62, L * 0.6), skC = new THREE.Vector3(cx, H0.y + L * 0.4, H0.z + L * 0.06);
      const keep = [], groups = [], scalp = [];
      let start = 0, removed = 0;
      D.groups.forEach(function (count, m) {
        const before = keep.length;
        if (drop.indexOf(m) !== -1) removed += count / 3;
        else for (let i = start; i < start + count; i += 3) {
          const a = IDX[i], b = IDX[i + 1], c = IDX[i + 2];
          let hat = false;
          if (isHead(a) && isHead(b) && isHead(c) && near(a)) {
            const my = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3, mx = (P[a * 3] + P[b * 3] + P[c * 3]) / 3;
            const mz = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3;
            // the hat line is tilted like a hatband: higher at the forehead, lower at the back
            const lineY = cutY + tilt * (mz - H0.z);
            // how far outside a skull-shaped ellipsoid this triangle sits (1 = on its surface)
            const ex = (mx - cx) / skR.x, ey = (my - skC.y) / skR.y, ez = (mz - skC.z) / skR.z;
            const outside = Math.sqrt(ex * ex + ey * ey + ez * ez);
            // a hat's harness strap round the back of the head: greyish, unsaturated, back half
            if (spec.strap && mz < H0.z && hy(my) > spec.strap[0] && hy(my) < spec.strap[1]) {
              let votes = 0;
              [a, b, c].forEach(function (v) { const k = colorAt(m, v); if (k) { const mx2 = Math.max(k[0], k[1], k[2]), mn2 = Math.min(k[0], k[1], k[2]); if (mn2 > 55 && mx2 < 200 && mx2 - mn2 < 30) votes++; } });
              if (votes >= 2) hat = true;
            }
            if (hat) { /* already the strap */ }
            else if (spec.islands !== false && hatIsland.has(root(a))) hat = true;
            else if (my > lineY) hat = true;
            else if (hy(my) > 0.28 && outside > (spec.outside || 1.6)) hat = true;      // stray bits well out
            else if (sides.length && hy(my) > (spec.ringFrom === undefined ? 0.15 : spec.ringFrom)) {
              // headwear colours anywhere on the head except the face (so the eyes stay): cups,
              // bands and brims that hang below the cut
              const dx = Math.abs(mx - cx), out = dx > jawRLow * 1.1;
              const face = dx < jawRLow * 0.85 && mz > H0.z + L * 0.3;
              if (!face) {
                let votes = 0;
                [a, b, c].forEach(function (v) { if (isColor(colorAt(m, v), sides, out)) votes++; });
                hat = votes >= 2;
              }
            }
          }
          if (hat) removed++;
          else {
            keep.push(a, b, c);
            // the scalp the cap must cover: kept skin (the body material) high on the head
            if (m === 0 && isHead(a) && near(a) && hy(P[a * 3 + 1]) > (spec.fitFrom || 0.6)) scalp.push(a);
          }
        }
        groups.push([before, keep.length - before, m]);
        start += count;
      });
      const g2 = new THREE.BufferGeometry();
      Object.keys(geo.attributes).forEach(function (k) { g2.setAttribute(k, geo.attributes[k]); });
      g2.setIndex(keep);
      groups.forEach(function (gr) { if (gr[1]) g2.addGroup(gr[0], gr[1], gr[2]); });
      g2.boundingSphere = geo.boundingSphere;
      g2.removedTris = removed;
      // The cap, in mesh (bind) space: a skull-shaped shell over the top of the head, sized from
      // the bones (a head is about 0.45 L wide and 0.56 L deep each way from its middle), nudged by
      // the measured jaw so a broad head gets a broad cap. hatOff() draws it as two soft layers.
      let rx = THREE.MathUtils.clamp(jawRLow * 1.06, L * 0.4, L * 0.52) * (spec.capScale || 1), rz = rx * 1.22;
      const capC = new THREE.Vector3(cx, H0.y + L * (spec.capY === undefined ? 0.42 : spec.capY), H0.z + L * (spec.capZ === undefined ? 0.05 : spec.capZ));
      let ry = Math.max(L * 0.4, H1.y + L * 0.03 - capC.y);
      // Grow the shell until the real scalp is inside it (a bald head under a hard hat is bigger
      // than the bones suggest): the 97th percentile of how far out the scalp sits, in the
      // shell's own tipped-back frame.
      const fitQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.atan(tilt));
      const ds = [], qv = new THREE.Vector3();
      scalp.forEach(function (v) {
        qv.set(P[v * 3] - capC.x, P[v * 3 + 1] - capC.y, P[v * 3 + 2] - capC.z).applyQuaternion(fitQ);
        if (qv.y < 0) return;
        ds.push(Math.sqrt((qv.x / rx) * (qv.x / rx) + (qv.y / ry) * (qv.y / ry) + (qv.z / rz) * (qv.z / rz)));
      });
      ds.sort(function (a, b) { return a - b; });
      const fit = ds.length ? Math.max(1, ds[Math.floor(ds.length * 0.97)] * 1.03) : 1;
      rx *= fit; ry *= fit; rz *= fit;
      // their skin tone, from the face (cheeks and forehead; the median, so brows and eyes don't count)
      const sk = [[], [], []];
      for (let v = 0; v < nv; v++) {
        if (!isHead(v) || !near(v)) continue;
        const f = hy(P[v * 3 + 1]);
        if (f < 0.2 || f > 0.55 || P[v * 3 + 2] < H0.z + L * 0.3 || Math.abs(P[v * 3] - cx) > L * 0.3) continue;
        const col = colorAt(0, v);                  // material 0 is the body, which owns the face
        if (!col) continue;
        const lum = (col[0] + col[1] + col[2]) / 3;
        if (lum < 25 || lum > 235) continue;
        sk[0].push(col[0]); sk[1].push(col[1]); sk[2].push(col[2]);
      }
      const med = function (a) { if (!a.length) return 120; a.sort(function (x, y) { return x - y; }); return a[Math.floor(a.length / 2)]; };
      const skin = [med(sk[0]), med(sk[1]), med(sk[2])];
      // (dbg: the measurements, in units of L, for tools/hats.js)
      const hist = {};
      for (let i = 0; i < IDX.length; i += 3) {
        const a = IDX[i];
        if (!isHead(a) || !near(a) || hy(P[a * 3 + 1]) < 0.28) continue;
        const ex = (P[a * 3] - cx) / skR.x, ey = (P[a * 3 + 1] - skC.y) / skR.y, ez = (P[a * 3 + 2] - skC.z) / skR.z;
        const k = (Math.round(Math.sqrt(ex * ex + ey * ey + ez * ez) * 10) / 10).toFixed(1);
        hist[k] = (hist[k] || 0) + 1;
      }
      const islands = [];
      isl.forEach(function (s, r) { if (s.head >= s.n * 0.97) islands.push([s.n, +hy(s.y / s.n).toFixed(2), +((s.x / s.n - cx) / L).toFixed(2), +((s.z / s.n - H0.z) / L).toFixed(2), hatIsland.has(r) ? 'HAT' : '']); });
      const dbg = { L: +L.toFixed(2), jawRLow: +(jawRLow / L).toFixed(2), islands: islands.sort(function (a, b) { return b[0] - a[0]; }).slice(0, 14) };
      dbg.skin = skin; dbg.fit = +fit.toFixed(2); dbg.scalp = scalp.length;
      return { geo: g2, dbg: dbg, skin: skin, cap: { c: capC, r: new THREE.Vector3(rx, ry, rz), tilt: Math.atan(tilt) } };
    }));
  };
  // The cap's textures. V runs from the crown (top of the canvas) to the cap's lower edge.
  //  - hair: fine strands combed down from the crown, as a grey map tinted by the hair colour
  //  - fade(start, end, ragged): an alpha ramp, solid above `start`, gone by `end`; ragged > 0
  //    breaks the edge into uneven strand tips (a hairline, not a ruler line)
  const capTex = {};
  function hairStrands() {
    if (capTex.hair) return capTex.hair;
    const c = document.createElement("canvas"); c.width = 256; c.height = 256;
    const g = c.getContext("2d");
    // short hair: dense tiny specks (a fade or a buzz), not long strands
    g.fillStyle = "#bdbdbd"; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 14000; i++) {
      const v = 90 + Math.random() * 165;
      g.fillStyle = "rgba(" + v + "," + v + "," + v + ",.8)";
      g.fillRect(Math.random() * 256, Math.random() * 256, 1, 1 + Math.random() * 1.5);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 3);
    return (capTex.hair = t);
  }
  function fade(start, end, ragged) {
    const key = start + "/" + end + "/" + ragged;
    if (capTex[key]) return capTex[key];
    const W = 512, H = 256, c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d");
    const img = g.createImageData(W, H);
    // a per-column ragged offset, smooth-ish, plus fine strand tips
    const off = new Float32Array(W);
    for (let x = 0; x < W; x++) off[x] = (Math.sin(x * 0.11) * 0.5 + Math.sin(x * 0.37 + 1.3) * 0.3 + (Math.random() - 0.5) * 0.9) * ragged;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = y / H + off[x];
      let a = v <= start ? 1 : (v >= end ? 0 : 1 - (v - start) / (end - start));
      a = a * a * (3 - 2 * a);
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(a * 255); img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return (capTex[key] = new THREE.CanvasTexture(c));
  }
  // A real haircut borrowed from another cast member (all Mixamo rigs: the same Head bone). The
  // donor's hair group, taken into the donor's head-bone space, scaled from the donor's skull to
  // the client's (Head joint to HeadTop_End), comes out in the client's head-bone space, ready to
  // hang on the client's Head bone. Hair is skinned wholly to the head, so a static mesh is enough.
  const wigs = {};
  // Head joint to crown, in the head bone's own space (HeadTop_End's offset from Head), so two
  // models exported at different scales still compare.
  function skullLen(M) {
    const ti = M.BN.HeadTop_End;
    if (ti !== undefined) return Math.max(1e-6, new THREE.Vector3().fromArray(M.D.bones[ti].p).length());
    return M.D.height * 0.1;
  }
  Body.wig = function (clientId, donorId, group, opts) {
    opts = opts || {};
    const key = clientId + ">" + donorId + ":" + group + ":" + (opts.from === undefined ? "" : opts.from) + ":" + (opts.scale || 1) + ":" + (opts.lift || 0);
    if (wigs[key]) return wigs[key];
    const CM = model(clientId), DM = model(donorId), dg = DM.geo;
    let start = 0;
    for (let k = 0; k < group; k++) start += DM.D.groups[k];
    const count = DM.D.groups[group];
    const IDX = dg.index.array, P = dg.attributes.position, N = dg.attributes.normal, UV = dg.attributes.uv;
    // opts.from (0..1): only triangles skinned to the head and above this fraction of the way from
    // the Head joint to the crown (to borrow the top of a scalp, not the face)
    let keepTri = null;
    if (opts.from !== undefined) {
      const SI = dg.attributes.skinIndex.array, SW = dg.attributes.skinWeight.array, under = {};
      DM.D.bones.forEach(function (b, i) { let p = i; while (p >= 0) { if (p === DM.BN.Head) { under[i] = 1; break; } p = DM.D.bones[p].parent; } });
      const headW = function (v) { let w = 0; for (let k = 0; k < 4; k++) if (under[SI[v * 4 + k]]) w += SW[v * 4 + k] / 255; return w; };
      const bp = function (i) { return new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(DM.inverses[i]).invert()); };
      const h0 = bp(DM.BN.Head), h1 = DM.BN.HeadTop_End !== undefined ? bp(DM.BN.HeadTop_End) : h0.clone().add(new THREE.Vector3(0, DM.D.height * 0.1, 0));
      const cutY = h0.y + (h1.y - h0.y) * opts.from;
      keepTri = function (i) {
        for (let k = 0; k < 3; k++) { const a = IDX[i + k]; if (headW(a) < 0.9 || P.getY(a) < cutY) return false; }
        return true;
      };
    }
    const toHead = new THREE.Matrix4().copy(DM.inverses[DM.BN.Head]);
    const s = skullLen(CM) / skullLen(DM) * (opts.scale || 1);
    const nrm = new THREE.Matrix3().getNormalMatrix(toHead);
    const pos = [], nor = [], uv = [], v = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = start; i < start + count; i++) {
      if (keepTri && i % 3 === (start % 3) && !keepTri(i)) { i += 2; continue; }
      const a = IDX[i];
      v.fromBufferAttribute(P, a).applyMatrix4(toHead).multiplyScalar(s);
      v.y += (opts.lift || 0) * skullLen(CM);
      pos.push(v.x, v.y, v.z);
      n.fromBufferAttribute(N, a).applyMatrix3(nrm).normalize();
      nor.push(n.x, n.y, n.z);
      uv.push(UV.getX(a), UV.getY(a));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    return (wigs[key] = { geo: g, mat: DM.mats[group] });
  };
  // Hats off / back on for one body (the full geometry is M.geo).
  B.prototype.hatOff = function (spec) {
    const self = this;
    self.wantHat = false;
    return Body.hatless(self.id, spec).then(function (h) {
      if (self.wantHat) return h;
      self.mesh.geometry = h.geo;
      if (spec.cap === false) return h;
      if (!self.hairCap) {
        // Two soft layers on a skull-shaped shell, built in mesh space and carried into the head
        // bone's space so they move with the head, tipped back like a hairline (higher at the brow):
        //  - skin, in their own skin tone: closes the head where the hat hid it (some models were
        //    never modelled up there) and melts into the real skin at its lower edge
        //  - hair, a short fade: solid on top, thinning out to ragged strand tips at the hairline
        const shell = function (scale, thetaLen) {
          const g = new THREE.SphereGeometry(1, 40, 18, 0, Math.PI * 2, 0, thetaLen);
          g.scale(h.cap.r.x * scale, h.cap.r.y * scale, h.cap.r.z * scale);
          g.rotateX(-h.cap.tilt);
          g.translate(h.cap.c.x, h.cap.c.y, h.cap.c.z);
          g.applyMatrix4(self.M.inverses[self.M.BN.Head]);
          return g;
        };
        const grp = new THREE.Group();
        const skinCol = new THREE.Color("rgb(" + h.skin.map(Math.round).join(",") + ")");
        if (spec.wigScalp !== undefined) {
          // the donor's own scalp under the borrowed hair, tinted toward the client's skin tone
          const ws = Body.wig(self.id, spec.wig, 0, { from: spec.wigScalp, scale: spec.wigScale, lift: spec.wigLift });
          const sm = ws.mat.clone();
          if (spec.scalpTint) sm.color = new THREE.Color(spec.scalpTint);
          const smesh = new THREE.Mesh(ws.geo, sm);
          smesh.castShadow = true; smesh.renderOrder = 1;
          grp.add(smesh);
        } else if (spec.skin !== false) {
          const skinM = new THREE.MeshStandardMaterial({ color: skinCol, roughness: 0.75, alphaMap: fade(spec.skinSolid || 0.62, spec.skinGone || 0.98, 0.02), transparent: true, alphaTest: 0.02 });
          const skinL = new THREE.Mesh(shell(0.985, Math.PI * (spec.skinReach || 0.6)), skinM);
          skinL.renderOrder = 1;
          grp.add(skinL);
        }
        if (spec.wig) {
          // a real modelled haircut borrowed from another cast member (Body.wig)
          const w = Body.wig(self.id, spec.wig, spec.wigGroup === undefined ? 1 : spec.wigGroup, { scale: spec.wigScale, lift: spec.wigLift });
          const wm = new THREE.Mesh(w.geo, w.mat);
          wm.castShadow = true; wm.renderOrder = 2;
          grp.add(wm);
        } else {
          const hairM = new THREE.MeshStandardMaterial({ color: spec.hair || "#17120f", map: hairStrands(), roughness: 0.92,
            alphaMap: fade(spec.hairSolid || 0.45, spec.hairGone || 0.9, 0.06), transparent: true, alphaTest: 0.02, depthWrite: false,
            opacity: spec.hairOpacity || 1 });
          const hairL = new THREE.Mesh(shell(1.0, Math.PI * (spec.hairReach || 0.58)), hairM);
          hairL.renderOrder = 2;
          hairL.castShadow = true;
          grp.add(hairL);
        }
        self.hairCap = grp;
      }
      self.bones[self.M.BN.Head].add(self.hairCap);
      return h;
    });
  };
  B.prototype.hatOn = function () {
    this.wantHat = true;
    this.mesh.geometry = this.M.geo;
    if (this.hairCap && this.hairCap.parent) this.hairCap.parent.remove(this.hairCap);
  };
  // Resolves once a character's textures have decoded (for one-off renders, like portraits).
  Body.texReady = function (id) { return model(id).texReady; };
  HS.Body = Body;
})(globalThis.HS);
