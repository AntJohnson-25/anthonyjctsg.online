// Fighters' bodies. A body is a packed Mixamo character (SB.BODY, tools/pack-char.py)
// driven by the shared clips (SB.CLIPS, tools/build-clips.mjs). Clips play in place and
// the sim moves the root. Forked from My Block's models.js; kept to what a snowball
// fight needs: idle/run/strafe/crouch-walk, the three throws as an upper-body overlay,
// the dive roll, and two falls.
//
// Mixamo bodies face +z with +x their left, so the root turns by yaw + PI (the sim's
// yaw 0 looks along -z).
globalThis.SB = globalThis.SB || {};
(function (SB) {
  "use strict";
  const THREE = globalThis.THREE;
  const Bo = {};
  const HEAD_M = 1.78;          // every body is scaled so its head top is here, metres
  const BLEND = 0.16;           // crossfade between base clips, seconds
  const LOOPS = { idle: 1, run_forward: 1, run_back: 1, run_left: 1, run_right: 1, walk_left: 1, walk_right: 1,
    crouch_walk: 1, crouch_sneak_left: 1, crouch_sneak_right: 1 };
  const TRAVEL = { death_back: 1, death_forward: 1 };
  const SETS = {
    stand: ["run_forward", "run_back", "run_left", "run_right"],
    crouch: ["crouch_walk", "-crouch_walk", "crouch_sneak_left", "crouch_sneak_right"]
  };
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));

  // ------------------------------------------------------------------ model data
  const models = {};
  function buildModel(id) {
    const D = SB.BODY && SB.BODY[id];
    if (!D) return null;
    const M = { id: id, D: D, BN: {} };
    D.bones.forEach(function (b, i) { M.BN[b.name] = i; });
    if (M.BN.Hips === undefined || M.BN.RightHand === undefined || M.BN.Spine === undefined) return null;
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
    // Painted bodies (Ant) append RGBA vertex colours after the index.
    if (D.colors) geo.setAttribute("color", new THREE.BufferAttribute(take(Uint8Array, nv * 4), 4, true));
    let start = 0;
    D.groups.forEach(function (count, m) { geo.addGroup(start, count, m); start += count; });
    geo.computeBoundingSphere();
    M.geo = geo;
    M.tex = D.materials.map(function (m) {
      const t = {};
      Object.keys(m.tex).forEach(function (slot) {
        const img = new Image(), tx = new THREE.Texture(img);
        if (slot === "map") tx.colorSpace = THREE.SRGBColorSpace;
        tx.anisotropy = 4;
        img.onload = function () { tx.needsUpdate = true; };
        img.src = m.tex[slot];
        t[slot] = tx;
      });
      return t;
    });
    D.bin = null;
    M.mats = null;
    M.inverses = D.inverses.map(function (e) { return new THREE.Matrix4().fromArray(e); });
    M.nb = D.bones.length;
    M.rest = new Float32Array(M.nb * 4);
    D.bones.forEach(function (b, i) { M.rest.set(b.q, i * 4); });
    M.hipsRest = D.bones[M.BN.Hips].p;
    // Upper body = Spine and everything under it: what the throw overlay drives.
    M.upper = new Uint8Array(M.nb);
    D.bones.forEach(function (b, i) {
      for (let k = i; k >= 0; k = D.bones[k].parent) if (k === M.BN.Spine) { M.upper[i] = 1; break; }
    });
    // Head-top height in the rest pose -> scale to metres.
    const top = M.BN.HeadTop_End !== undefined ? M.BN.HeadTop_End : M.BN.Head;
    const objs = D.bones.map(function (b) {
      const ob = new THREE.Object3D();
      ob.position.fromArray(b.p); ob.quaternion.fromArray(b.q); ob.scale.fromArray(b.s);
      return ob;
    });
    const holder = new THREE.Object3D();
    D.bones.forEach(function (b, i) { (b.parent >= 0 ? objs[b.parent] : holder).add(objs[i]); });
    holder.updateMatrixWorld(true);
    const headY = new THREE.Vector3().setFromMatrixPosition(objs[top].matrixWorld).y;
    M.scale = HEAD_M / (headY > 1 ? headY : (D.height || 180));
    // Clips -> per-bone frame arrays; hips height and travel scaled to this body.
    M.clips = {};
    Object.keys(SB.CLIPS).forEach(function (k) {
      const c = SB.CLIPS[k];
      const cl = { key: k, dur: c.dur, n: c.n, q: [], hp: null, s: M.hipsRest[1] / (c.hipsRest || M.hipsRest[1]),
        release: c.release, loop: !!LOOPS[k], travel: !!TRAVEL[k] };
      c.tracks.forEach(function (tr) {
        if (tr.k === "hp") { cl.hp = new Float32Array(tr.v); return; }
        const bi = M.BN[tr.b];
        if (bi !== undefined) cl.q.push({ i: bi, v: new Float32Array(tr.v) });
      });
      // A loop's own ground speed (m/s) and the direction it travels in relative to
      // facing (0 ahead, + to the right; the body's +x is its left).
      const e = (c.n - 1) * 3;
      cl.mps = cl.hp ? Math.hypot(cl.hp[e], cl.hp[e + 2]) * cl.s * M.scale / c.dur : 0;
      cl.ang = cl.hp ? Math.atan2(-cl.hp[e], cl.hp[e + 2]) : 0;
      M.clips[k] = cl;
    });
    M.sets = {};
    Object.keys(SETS).forEach(function (s) {
      M.sets[s] = SETS[s].map(function (k) {
        const rev = k.charAt(0) === "-", cl = M.clips[k.replace(/^-/, "")];
        return cl ? { cl: cl, rev: rev, ang: wrap(cl.ang + (rev ? Math.PI : 0)) } : null;
      }).filter(Boolean);
    });
    return M;
  }
  function model(id) {
    if (models[id] === undefined) models[id] = buildModel(id) || null;
    return models[id];
  }
  function materials(M) {
    if (!M.mats) {
      M.mats = M.tex.map(function (t) {
        const m = new THREE.MeshStandardMaterial({ map: t.map || null, normalMap: t.normalMap || null, roughness: 0.85, metalness: 0.02, vertexColors: !!M.D.colors });
        if (t.alphaMap) { m.alphaMap = t.alphaMap; m.alphaTest = 0.5; m.side = THREE.DoubleSide; }
        return m;
      });
    }
    return M.mats;
  }

  // ------------------------------------------------------------------ clip sampling
  const QS = new Float32Array(4);
  function frameOf(cl, t) {
    const f = clamp(t * SB.CLIP_FPS, 0, cl.n - 1), a = Math.floor(f);
    return { a: a, b: Math.min(cl.n - 1, a + 1), u: f - a };
  }
  // Pose clip cl at time t into out (bone quaternions) at weight w; mask limits it to some bones.
  function sample(cl, t, out, w, mask) {
    const F = frameOf(cl, t), a = F.a * 4, b = F.b * 4, u = F.u;
    for (let k = 0; k < cl.q.length; k++) {
      const tr = cl.q[k];
      if (mask && !mask[tr.i]) continue;
      if (w >= 1) THREE.Quaternion.slerpFlat(out, tr.i * 4, tr.v, a, tr.v, b, u);
      else {
        THREE.Quaternion.slerpFlat(QS, 0, tr.v, a, tr.v, b, u);
        THREE.Quaternion.slerpFlat(out, tr.i * 4, out, tr.i * 4, QS, 0, w);
      }
    }
  }
  const OFF = [0, 0, 0];
  function hipsOffset(cl, t) {
    const F = frameOf(cl, t), v = cl.hp, a = F.a * 3, b = F.b * 3, u = F.u;
    OFF[0] = (v[a] + (v[b] - v[a]) * u) * cl.s;
    OFF[1] = (v[a + 1] + (v[b + 1] - v[a + 1]) * u) * cl.s;
    OFF[2] = (v[a + 2] + (v[b + 2] - v[a + 2]) * u) * cl.s;
    return OFF;
  }
  const _aq = new THREE.Quaternion(), _sq = new THREE.Quaternion(), _rq = new THREE.Quaternion(), _av = new THREE.Vector3();
  // Rotate a bone about an axis given in the body's own space, whatever its local axes are.
  function turn(c, bone, ax, ay, az, angle) {
    if (!bone || !angle) return;
    const par = bone.parent;
    par.updateWorldMatrix(true, false);
    c.body.getWorldQuaternion(_sq);
    par.getWorldQuaternion(_aq);
    _aq.premultiply(_sq.invert());
    _rq.setFromAxisAngle(_av.set(ax, ay, az), angle);
    bone.quaternion.premultiply(_aq).premultiply(_rq).premultiply(_aq.invert());
  }

  // ------------------------------------------------------------------ team dress
  let markerTex = null;
  function marker(color) {
    if (!markerTex) {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 64;
      const g = cv.getContext("2d");
      g.beginPath(); g.moveTo(32, 60); g.lineTo(8, 22); g.lineTo(32, 4); g.lineTo(56, 22); g.closePath();
      g.fillStyle = "#fff"; g.fill(); g.lineWidth = 5; g.strokeStyle = "rgba(0,0,0,0.7)"; g.stroke();
      markerTex = new THREE.CanvasTexture(cv);
      markerTex.colorSpace = THREE.SRGBColorSpace;
    }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTex, color: color, transparent: true, depthWrite: false, depthTest: false }));
    s.renderOrder = 9;
    return s;
  }
  function nameTag(name, color) {
    const cv = document.createElement("canvas");
    cv.width = 256; cv.height = 64;
    const g = cv.getContext("2d");
    g.font = "bold 34px 'Trebuchet MS', 'Arial Narrow', sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.lineWidth = 6; g.strokeStyle = "rgba(0,0,0,0.75)"; g.strokeText(name, 128, 34);
    g.fillStyle = "#" + new THREE.Color(color).getHexString(); g.fillText(name, 128, 34);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    s.scale.set(1.1, 0.275, 1);
    s.renderOrder = 10;
    return s;
  }
  const mats = {};
  const teamMat = (color) => mats[color] || (mats[color] = new THREE.MeshStandardMaterial({ color: color, roughness: 0.7, emissive: color, emissiveIntensity: 0.18, side: THREE.DoubleSide }));
  const snowMat = new THREE.MeshStandardMaterial({ color: 0xf4f9ff, roughness: 0.95 });
  // A ski mask: a knit balaclava that covers the WHOLE head (cap, hood, hair and all) and the lower face, leaving
  // only an eye slit. It is built to the head itself: slice by slice up the head, the vertices mostly weighted to
  // the Head bone (in that bone's own space, via the inverse bind matrix) give the half width and the front and
  // back reach, so it hugs jaw, nose and cap alike on a realistic head or a cartoon-big one.
  // The head bone's own axes needn't match the body's (its "forward" may be any axis): the body's rest-pose
  // right/up/forward, expressed in head-bone space, give the frame the mask is built in.
  function headFrame(c) {
    const M = c.M;
    if (M.headFrame) return M.headFrame;
    c.body.updateMatrixWorld(true);
    const q = new THREE.Quaternion();
    c.bones[M.BN.Head].getWorldQuaternion(q);
    const bq = new THREE.Quaternion();
    c.body.getWorldQuaternion(bq);
    q.premultiply(bq.invert()).invert();   // body space -> head space
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q), u = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const x = new THREE.Vector3().crossVectors(u, f).normalize();
    M.headFrame = { x: x, y: u, z: f };
    return M.headFrame;
  }
  const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.max(0, Math.min(s.length - 1, Math.floor(s.length * p)))]; };
  let knitTex = null;
  function knitMat(color) {
    const key = "knit" + color;
    if (mats[key]) return mats[key];
    if (!knitTex) {
      const cv = document.createElement("canvas");
      cv.width = 64; cv.height = 64;
      const g = cv.getContext("2d");
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, 64, 64);
      for (let x = 0; x < 64; x += 4) { g.fillStyle = "rgba(0,0,0,0.22)"; g.fillRect(x, 0, 1.5, 64); g.fillStyle = "rgba(255,255,255,0.0)"; }
      for (let y = 0; y < 64; y += 8) { g.fillStyle = "rgba(0,0,0,0.10)"; g.fillRect(0, y, 64, 1); }
      knitTex = new THREE.CanvasTexture(cv);
      knitTex.wrapS = knitTex.wrapT = THREE.RepeatWrapping;
      knitTex.repeat.set(1, 1);
      knitTex.colorSpace = THREE.SRGBColorSpace;
    }
    mats[key] = new THREE.MeshStandardMaterial({ color: color, map: knitTex, roughness: 0.95, emissive: color, emissiveIntensity: 0.12, side: THREE.DoubleSide });
    return mats[key];
  }
  function maskGeometry(c) {
    const M = c.M;
    if (M.maskGeo !== undefined) return M.maskGeo;
    const F = headFrame(c), BN = M.BN, bones = M.D.bones;
    const geo = M.geo, P = geo.attributes.position, SI = geo.attributes.skinIndex, SW = geo.attributes.skinWeight, hi = BN.Head;
    const v = new THREE.Vector3(), pts = [];
    for (let i = 0; i < P.count; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (SI.getComponent(i, k) === hi) w += SW.getComponent(i, k);
      if (w < 0.55) continue;
      v.fromBufferAttribute(P, i).applyMatrix4(M.inverses[hi]);
      pts.push([v.dot(F.x), v.dot(F.y), v.dot(F.z)]);
    }
    if (pts.length < 80) { M.maskGeo = null; return null; }
    const ys = pts.map((p) => p[1]);
    const Hh = BN.HeadTop_End !== undefined ? bones[BN.HeadTop_End].p[1] : null;
    // (ears, antlers or a tall hat must not balloon the whole mask: the top stops a little above the head-top bone)
    const y0 = pct(ys, 0.02), y1 = Hh ? Math.min(pct(ys, 0.9995), Hh * 1.12) : pct(ys, 0.9995), N = 16, M2 = 28;
    const step = (y1 - y0) / (N - 1);
    // Per slice: half width, and how far the head reaches forward and back.
    const sl = [];
    for (let i = 0; i < N; i++) {
      const y = y0 + step * i, near = pts.filter((p) => Math.abs(p[1] - y) <= step * 0.9);
      if (near.length < 14) { sl.push(null); continue; }
      const xs = near.map((p) => Math.abs(p[0])), zs = near.map((p) => p[2]);
      // (near the very extremes: a cap's crown and brim, hair, a hood must all end up under the mask)
      sl.push({ y: y, hx: pct(xs, 0.992), zf: pct(zs, 0.992), zb: pct(zs, 0.008) });
    }
    for (let i = 0; i < N; i++) if (!sl[i]) { // fill gaps from the nearest slices
      let a = i - 1, b = i + 1;
      while (a >= 0 && !sl[a]) a--;
      while (b < N && !sl[b]) b++;
      const A = sl[a] || sl[b], B = sl[b] || sl[a];
      sl[i] = { y: y0 + step * i, hx: (A.hx + B.hx) / 2, zf: (A.zf + B.zf) / 2, zb: (A.zb + B.zb) / 2 };
    }
    // No slice may be much wider or deeper than the face's own (ears, big hair or horns stick out through the mask instead).
    const mid = sl.filter((s) => Hh ? (s.y > Hh * 0.2 && s.y < Hh * 0.62) : true), med = (k) => { const a = mid.map((s) => s[k]).sort((p, q) => p - q); return a[Math.floor(a.length / 2)]; };
    if (mid.length) {
      const fx = med("hx"), fzf = med("zf"), fzb = med("zb"), dz = (fzf - fzb) / 2;
      sl.forEach((s) => { s.hx = Math.min(s.hx, fx * 1.3); s.zf = Math.min(s.zf, fzf + dz * 0.3); s.zb = Math.max(s.zb, fzb - dz * 0.3); });
    }
    for (let pass = 0; pass < 2; pass++) for (let i = 1; i < N - 1; i++) { // smooth the profile
      sl[i].hx = (sl[i - 1].hx + 2 * sl[i].hx + sl[i + 1].hx) / 4; sl[i].zf = (sl[i - 1].zf + 2 * sl[i].zf + sl[i + 1].zf) / 4; sl[i].zb = (sl[i - 1].zb + 2 * sl[i].zb + sl[i + 1].zb) / 4;
    }
    // The eye slit: ~0.32-0.52 of the way from the head joint to the head top.
    const H = BN.HeadTop_End !== undefined ? bones[BN.HeadTop_End].p[1] : (y1 - y0) * 0.9;
    const eyeLo = H * 0.33, eyeHi = H * 0.52, slitHalf = 0.95;
    const pos = [], uv = [], idx = [], grow = 1.07, pad = H * 0.02;
    for (let i = 0; i < N; i++) {
      const s = sl[i], taper = i === N - 1 ? 0.55 : 1, hz = (s.zf - s.zb) / 2 * grow + pad, zc = (s.zf + s.zb) / 2;
      for (let j = 0; j < M2; j++) {
        const a = j / M2 * Math.PI * 2;
        const x = Math.sin(a) * (s.hx * grow + pad) * taper, z = zc + Math.cos(a) * hz * taper;
        pos.push(F.x.x * x + F.y.x * s.y + F.z.x * z, F.x.y * x + F.y.y * s.y + F.z.y * z, F.x.z * x + F.y.z * s.y + F.z.z * z);
        uv.push(j / M2 * 6, i / (N - 1) * 3);
      }
    }
    const apex = pos.length / 3, top = sl[N - 1], ya = top.y + step * 0.9, zca = (top.zf + top.zb) / 2;
    pos.push(F.y.x * ya + F.z.x * zca, F.y.y * ya + F.z.y * zca, F.y.z * ya + F.z.z * zca); uv.push(0.5, 3);
    for (let i = 0; i < N - 1; i++) {
      const ymid = (sl[i].y + sl[i + 1].y) / 2;
      const inSlit = ymid > eyeLo && ymid < eyeHi;
      for (let j = 0; j < M2; j++) {
        const j2 = (j + 1) % M2, am = (j + 0.5) / M2 * Math.PI * 2;
        if (inSlit && Math.abs(Math.atan2(Math.sin(am), Math.cos(am))) < slitHalf) continue;   // open across the front
        const a = i * M2 + j, b = i * M2 + j2, c2 = (i + 1) * M2 + j, d = (i + 1) * M2 + j2;
        idx.push(a, c2, b, b, c2, d);
      }
    }
    for (let j = 0; j < M2; j++) idx.push((N - 1) * M2 + j, apex, (N - 1) * M2 + (j + 1) % M2);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    M.maskGeo = g;
    return g;
  }
  function skiMask(c, color) {
    const g = maskGeometry(c);
    if (!g) return;
    const m = new THREE.Mesh(g, knitMat(color));
    m.castShadow = false;
    c.bones[c.M.BN.Head].add(m);
  }
  // Scarf round the neck, band round each upper arm: seen from any side, and from far off.
  function dress(c, color) {
    const BN = c.M.BN, inv = 1 / c.M.scale;
    // The team must read from far off and from behind: a team-coloured ski mask, a scarf, and a band on each arm.
    if (BN.Head !== undefined) skiMask(c, color);
    if (BN.Neck !== undefined) {
      const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.1 * inv, 0.034 * inv, 8, 18), teamMat(color));
      scarf.rotation.x = Math.PI / 2; scarf.position.set(0, 0.03 * inv, 0.0);
      c.bones[BN.Neck].add(scarf);
    }
    ["LeftArm", "RightArm"].forEach(function (nm) {
      if (BN[nm] === undefined) return;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.075 * inv, 0.075 * inv, 0.12 * inv, 12, 1, true), teamMat(color));
      b.position.y = 0.14 * inv;
      c.bones[BN[nm]].add(b);
    });
    // The snowball in the throwing hand.
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.085 * inv, 10, 8), snowMat);
    ball.position.set(0, 0.09 * inv, 0.02 * inv);
    c.bones[BN.RightHand].add(ball);
    c.handBall = ball;
  }

  Bo.model = model;
  Bo.make = function (sim, p, bodyId, color) {
    const M = model(bodyId);
    if (!M) return null;
    const root = new THREE.Group(), body = new THREE.Group();
    body.scale.setScalar(M.scale);
    root.add(body);
    const bones = M.D.bones.map(function (b) {
      const bone = new THREE.Bone();
      bone.name = b.name;
      bone.position.fromArray(b.p); bone.quaternion.fromArray(b.q); bone.scale.fromArray(b.s);
      return bone;
    });
    M.D.bones.forEach(function (b, i) { (b.parent >= 0 ? bones[b.parent] : body).add(bones[i]); });
    const mesh = new THREE.SkinnedMesh(M.geo, materials(M));
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    body.add(mesh);
    body.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones, M.inverses), new THREE.Matrix4());
    const c = { M: M, root: root, body: body, bones: bones, mesh: mesh, q: new Float32Array(M.nb * 4),
      base: null, prev: null, blend: 1, twist: 0, lean: 0, lastAlive: true, dead: null, name: p.name, handBall: null };
    dress(c, color);
    c.tag = nameTag(p.name, color);
    c.tag.position.y = 2.2;
    root.add(c.tag);
    c.marker = marker(color);
    c.marker.position.y = 2.05; c.marker.visible = false;
    root.add(c.marker);
    setBase(c, "idle", Math.random() * 3);
    return c;
  };

  // ------------------------------------------------------------------ posing
  function setBase(c, key, t) {
    const cl = c.M.clips[key];
    if (!cl || (c.base && c.base.cl === cl)) return;
    if (c.base) {
      c.prev = { cl: c.base.cl, t: c.base.t };
      c.blend = 0;
      if (t === undefined && c.base.cl.loop && cl.loop) t = (c.base.t / c.base.cl.dur) * cl.dur;
    }
    c.base = { cl: cl, t: t || 0 };
  }

  // Which base clip now. { key, rev, twist, sp, at (hold one frame) }
  function chooseBase(c, p) {
    const M = c.M, sp = Math.hypot(p.vx, p.vz);
    if (p.roll > 0 && M.clips.dive_roll) {
      const dr = M.clips.dive_roll, u = 1 - p.roll / SB.CFG.ROLL_T;
      return { key: "dive_roll", at: 0.15 + u * (dr.dur - 0.55), twist: 0, sp: 0 };
    }
    const crouched = p.crouch > 0.5;
    if (sp < 0.4) {
      if (crouched) return { key: "crouch_to_kneel", at: M.clips.crouch_to_kneel.dur - 0.05, twist: 0, sp: 0 };
      return { key: "idle", twist: 0, sp: 0 };
    }
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    const side = p.vx * cy - p.vz * sy, fwd = -p.vx * sy - p.vz * cy;   // side > 0: moving right
    const a = Math.atan2(side, fwd);
    const set = M.sets[crouched ? "crouch" : "stand"];
    let best = set[0], bd = 9;
    for (let i = 0; i < set.length; i++) { const d = Math.abs(wrap(a - set[i].ang)); if (d < bd) { bd = d; best = set[i]; } }
    return { key: best.cl.key, rev: best.rev, twist: wrap(a - best.ang), sp: sp };
  }

  // Pose character c for player p. ip = where to draw it.
  Bo.pose = function (c, p, dt) {
    const M = c.M, B = M.BN, bones = c.bones, q = c.q;
    c.root.position.set(p.x, 0, p.z);
    if (!p.alive) {
      // Down: a fall from the moment of the hit, holding its last frame.
      if (c.lastAlive || !c.dead) {
        const k = p.fall || "death_back";
        c.dead = { cl: M.clips[k] || M.clips.death_back, t: 0 };
        c.root.rotation.y = p.yaw + Math.PI;
      }
      c.lastAlive = false;
      c.dead.t = Math.min(c.dead.t + dt, c.dead.cl.dur);
      q.set(M.rest);
      sample(c.dead.cl, c.dead.t, q, 1);
      for (let i = 0; i < M.nb; i++) bones[i].quaternion.fromArray(q, i * 4);
      const off = c.dead.cl.hp ? hipsOffset(c.dead.cl, c.dead.t) : [0, M.hipsRest[1], 0];
      bones[B.Hips].position.set(M.hipsRest[0] + off[0], off[1], M.hipsRest[2] + off[2]);
      if (c.handBall) c.handBall.visible = false;
      return;
    }
    if (!c.lastAlive) c.dead = null;
    c.lastAlive = true;
    c.root.rotation.y = p.yaw + Math.PI;
    const ch = chooseBase(c, p);
    setBase(c, ch.key);
    const cl = c.base.cl;
    if (ch.at !== undefined) c.base.t = Math.min(ch.at, cl.dur);
    else {
      let rate = cl.mps > 0.2 && ch.sp > 0 ? clamp(ch.sp / cl.mps, 0.6, 1.7) : 1;
      if (ch.rev) rate = -rate;
      c.base.t = ((c.base.t + dt * rate) % cl.dur + cl.dur) % cl.dur;
    }
    if (c.blend < 1) c.blend = Math.min(1, c.blend + dt / BLEND);
    q.set(M.rest);
    let hy;
    if (c.prev && c.blend < 1) {
      sample(c.prev.cl, c.prev.t, q, 1);
      sample(cl, c.base.t, q, ease(c.blend));
      const h0 = c.prev.cl.hp ? hipsOffset(c.prev.cl, c.prev.t)[1] : M.hipsRest[1];
      const h1 = cl.hp ? hipsOffset(cl, c.base.t)[1] : M.hipsRest[1];
      hy = h0 + (h1 - h0) * ease(c.blend);
    } else {
      sample(cl, c.base.t, q, 1);
      hy = cl.hp ? hipsOffset(cl, c.base.t)[1] : M.hipsRest[1];
    }
    // The throw: the clip from just before the release to just after, over the arms and chest.
    const WIND = SB.CFG.WIND_BOT, THROW_LEN = 0.95;
    const throwing = p.throwT < THROW_LEN && p.roll <= 0;
    if (throwing) {
      const gc = M.clips[Math.hypot(p.vx, p.vz) > 2.8 && p.crouch < 0.5 ? "throw_run" : "throw_object"];
      const wd = p.human ? SB.CFG.WIND_HUMAN : WIND;
      const t = Math.max(0, gc.release - wd) + p.throwT * 1.05;
      sample(gc, t, q, Math.min(1, p.throwT * 9, (THROW_LEN - p.throwT) * 7), M.upper);
    } else if (p.charge > 0.02 && p.roll <= 0) {
      // Winding up: the arm drawn back, a little further the longer it's held.
      const gc = M.clips.throw_object;
      const cp = SB.CFG.CHARGE_POSE;   // [seconds before the release to start from, how far the hold winds it on]
      sample(gc, Math.max(0, gc.release - cp[0]) + cp[1] * p.charge, q, Math.min(1, p.charge * 10), M.upper);
    }
    for (let i = 0; i < M.nb; i++) bones[i].quaternion.fromArray(q, i * 4);
    bones[B.Hips].position.set(M.hipsRest[0], hy, M.hipsRest[2]);
    if (c.handBall) c.handBall.visible = p.ammo > 0 && (!throwing || p.throwT < (p.human ? SB.CFG.WIND_HUMAN : WIND)) && p.roll <= 0;
    if (p.roll > 0) { c.twist = 0; return; }
    // Hips twist toward a diagonal run; the chest turns back so the head stays on target.
    const tw = clamp(ch.twist, -0.7, 0.7);
    c.twist += (tw - c.twist) * Math.min(1, dt * 10);
    turn(c, bones[B.Hips], 0, 1, 0, -c.twist);
    turn(c, bones[B.Spine], 0, 1, 0, c.twist * 0.5);
    if (B.Spine1 !== undefined) turn(c, bones[B.Spine1], 0, 1, 0, c.twist * 0.5);
    // Look pitch through the spine (+x is the body's left: a positive turn leans forward).
    const lean = clamp(-(p.pitch || 0), -0.9, 0.9) / 3;
    turn(c, bones[B.Spine], 1, 0, 0, lean);
    if (B.Spine1 !== undefined) turn(c, bones[B.Spine1], 1, 0, 0, lean);
    if (B.Spine2 !== undefined) turn(c, bones[B.Spine2], 1, 0, 0, lean);
  };

  // Bodies are separate scripts (1-2.5 MB each): load only the ones a match uses.
  const loading = {};
  Bo.load = function (ids, onProgress) {
    let done = 0;
    const tick = function () { done++; if (onProgress) onProgress(done, ids.length); };
    return Promise.all(ids.map(function (id) {
      if (SB.BODY && SB.BODY[id]) { tick(); return Promise.resolve(); }
      if (loading[id]) return loading[id].then(tick);
      return (loading[id] = new Promise(function (res, rej) {
        const s = document.createElement("script");
        s.src = "src/chars/" + id + ".js?v=1";
        s.onload = res;
        s.onerror = function () { rej(new Error("could not load character " + id)); };
        document.head.appendChild(s);
      })).then(tick);
    }));
  };
  SB.Body = Bo;
})(globalThis.SB);
