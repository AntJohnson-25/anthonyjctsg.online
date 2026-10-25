// Turkey Bowl 3D — procedural character builder.
//
// Each of the fourteen players is ONE SkinnedMesh: every body part (sweatshirt,
// sleeves, pants, head, hair, beard, eyes, cleats) is modelled from primitives,
// merged into a single geometry and rigidly skinned to a 14-bone skeleton. That
// keeps a whole person to one draw call (plus one for his shadow), which is
// what lets 14 players, spectators and a lawn run on a phone.
//
// Colour comes from vertex colours; the sweatshirt and sweatpants also sample a
// per-player canvas texture (wordmark, numbers, stitched bands, mud) and a shared
// fine fabric relief. A per-vertex roughness attribute gives skin, fleece,
// hair, rubber, and helmet shells distinct light response in one draw call.
//
// Conventions: units are yards, the character faces +Z, his LEFT is +X.
(function () {
  const THREE = window.THREE;

  // Bone indices. The hips bone is the skeleton root.
  const B = { hips: 0, spine: 1, chest: 2, head: 3, uaL: 4, faL: 5, uaR: 6, faR: 7,
    thL: 8, shL: 9, ftL: 10, thR: 11, shR: 12, ftR: 13 };
  const PARENT = [-1, 0, 1, 2, 2, 4, 2, 6, 0, 8, 9, 0, 11, 12];
  const NB = 14;

  const ATLAS = 512;
  const WHITE_UV = [0.5, 1 - 500 / ATLAS];      // centre of the white strip at the bottom
  // Atlas regions, in canvas pixels (y down).
  const R_JERSEY = { y0: 0, y1: 236 };           // torso wrap
  const R_SLEEVE = { y0: 236, y1: 300 };         // sleeve wrap (plain fleece + mud)
  const R_PANTS = { y0: 300, y1: 470 };          // pants wrap (stripes + mud)

  // A neutral-height canvas atlas adds a fine fleece grain only to the cloth
  // UV regions. The white UV patch used by skin and equipment stays perfectly
  // flat. CanvasTexture keeps the material usable from file://.
  function makeFabricRelief() {
    const cv = document.createElement("canvas");
    cv.width = cv.height = ATLAS;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "rgb(128,128,128)";
    ctx.fillRect(0, 0, ATLAS, ATLAS);
    for (let y = 1; y < R_PANTS.y1; y += 2) {
      for (let x = 0; x < ATLAS; x += 2) {
        const n = ((x * 17 + y * 29 + ((x * y) % 23)) % 9) - 4;
        const v = 128 + n;
        ctx.fillStyle = "rgb(" + v + "," + v + "," + v + ")";
        ctx.fillRect(x, y, 1, 1);
      }
    }
    // Stitching at the shoulder seams, cuffs, and waistband, kept very shallow.
    ctx.strokeStyle = "rgb(135,135,135)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    [[20, 20, 492, 20], [20, 224, 492, 224], [8, 247, 504, 247],
      [8, 287, 504, 287], [8, 310, 504, 310], [8, 462, 504, 462]].forEach(function (l) {
      ctx.beginPath(); ctx.moveTo(l[0], l[1]); ctx.lineTo(l[2], l[3]); ctx.stroke();
    });
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    return tex;
  }
  const FABRIC_RELIEF = makeFabricRelief();

  function athleteMaterial(tex) {
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      bumpMap: FABRIC_RELIEF,
      bumpScale: 0.012,
      vertexColors: true,
      roughness: 0.86,
      metalness: 0
    });
    // Surface roughness varies per vertex, so skin, fleece, hair, and helmet
    // shell share the same draw call while catching light like different
    // materials. The attribute is interpolated across each primitive.
    mat.onBeforeCompile = function (shader) {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        "#include <common>\nattribute float surfaceRoughness;\nvarying float vSurfaceRoughness;"
      ).replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvSurfaceRoughness = surfaceRoughness;"
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        "#include <common>\nvarying float vSurfaceRoughness;"
      ).replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = clamp(vSurfaceRoughness, 0.06, 1.0);"
      );
    };
    mat.customProgramCacheKey = function () { return "turkey-bowl-athlete-surface-v1"; };
    return mat;
  }

  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpE = new THREE.Euler();
  const tmpV = new THREE.Vector3();
  const tmpS = new THREE.Vector3();
  const tmpC = new THREE.Color();

  function smoothstep(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  // A seeded PRNG so each player's mud and hair come out the same every load.
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return (s % 100000) / 100000;
    };
  }
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // Place a geometry: position, Euler rotation, scale — applied in that TRS order.
  function place(geo, p, r, s) {
    tmpE.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0, "XYZ");
    tmpQ.setFromEuler(tmpE);
    tmpS.set(s ? s[0] : 1, s ? s[1] : 1, s ? s[2] : 1);
    tmpV.set(p ? p[0] : 0, p ? p[1] : 0, p ? p[2] : 0);
    tmpM.compose(tmpV, tmpQ, tmpS);
    geo.applyMatrix4(tmpM);
    return geo;
  }

  // Keep only the triangles whose centroid passes `keep(x, y, z)`. Used to cut
  // hairlines and beards out of spheres.
  function filterTris(geo, keep) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const uv = g.attributes.uv;
    const P = [], N = [], U = [];
    for (let i = 0; i < pos.count; i += 3) {
      const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
      const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      if (!keep(cx, cy, cz)) continue;
      for (let k = 0; k < 3; k++) {
        P.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
        N.push(nor.getX(i + k), nor.getY(i + k), nor.getZ(i + k));
        U.push(uv.getX(i + k), uv.getY(i + k));
      }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    out.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
    out.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
    return out;
  }

  // ---- body measurements -------------------------------------------------------

  function measure(spec) {
    const h = spec.height || 1;
    const w = spec.width || 1;
    const belly = spec.belly || 0;
    const m = { h: h, w: w, belly: belly };
    m.ankle = 0.075;
    m.shin = 0.435 * h;
    m.thigh = 0.465 * h;
    m.hipY = m.ankle + m.shin + m.thigh + 0.02;
    m.hipX = 0.092 * Math.pow(w, 0.7);
    m.spineY = 0.09 * h;
    m.chestY = 0.235 * h;
    m.torsoTop = 0.535 * h;                    // above the spine pivot
    m.sx = 1.16 * Math.pow(w, 0.85);           // torso girth, side to side
    m.sz = 0.8 * Math.pow(w, 0.55) * (1 + 0.28 * belly);
    m.shoulderY = 0.19 * h;                    // above the chest pivot
    m.shoulderX = torsoR(0.42 * h, m) * m.sx + 0.022 + 0.012 * w;
    m.upperArm = 0.285 * h;
    m.forearm = 0.255 * h;
    m.rUA = 0.056 * Math.pow(w, 0.75);
    m.rFA = 0.049 * Math.pow(w, 0.7);
    m.rTH = 0.083 * Math.pow(w, 0.7);
    m.rSH = 0.066 * Math.pow(w, 0.55);
    // A touch bigger than life, the way the renders draw them.
    m.headR = spec.face === "young" ? 0.166 : 0.158;
    m.neckY = 0.268 * h;                       // neck base above the chest pivot
    m.neckR = (spec.width > 1.2 ? 0.07 : 0.056);
    return m;
  }

  // Sweatshirt profile radius at height y above the spine pivot (before the
  // girth scale). The belly term is what separates the linemen from the backs.
  function torsoR(y, m) {
    const h = m.h;
    const k = y / h;
    const keys = [
      [-0.17, 0.153], [-0.14, 0.16], [-0.08, 0.158], [0.02, 0.150],
      [0.12, 0.151], [0.22, 0.158], [0.31, 0.166], [0.38, 0.17],
      [0.44, 0.167], [0.48, 0.152], [0.51, 0.118], [0.527, 0.08], [0.535, 0.06]
    ];
    let r = keys[keys.length - 1][1];
    for (let i = 0; i < keys.length - 1; i++) {
      if (k <= keys[i + 1][0]) {
        const t = (k - keys[i][0]) / (keys[i + 1][0] - keys[i][0]);
        const s = t * t * (3 - 2 * t);
        r = keys[i][1] + (keys[i + 1][1] - keys[i][1]) * Math.max(0, Math.min(1, s));
        break;
      }
    }
    // Belly: out front and low, where a lineman carries it.
    const b = m.belly * 0.05 * Math.exp(-Math.pow((k - 0.12) / 0.13, 2));
    return (r + b) * (0.9 + 0.1 * h);
  }

  // ---- the canvas texture ------------------------------------------------------

  function mudBlobs(ctx, r, x0, y0, x1, y1, count, alpha, biasLow) {
    for (let i = 0; i < count; i++) {
      const t = biasLow ? Math.pow(r(), 0.55) : r();
      const x = x0 + r() * (x1 - x0);
      const y = y0 + t * (y1 - y0);
      const rad = 2 + r() * 11;
      ctx.fillStyle = "rgba(" + (58 + (r() * 30 | 0)) + "," + (42 + (r() * 20 | 0)) + ",26," + (alpha * (0.4 + r() * 0.8)).toFixed(3) + ")";
      ctx.beginPath();
      ctx.ellipse(x, y, rad * (0.6 + r()), rad * (0.4 + r() * 0.6), r() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
      // Smears drag downward, the way wet grass stains do.
      if (r() < 0.4) {
        ctx.fillRect(x - rad * 0.3, y, rad * 0.6, rad * (1 + r() * 2));
      }
    }
  }

  function fleece(ctx, r, x0, y0, x1, y1, n) {
    for (let i = 0; i < n; i++) {
      const v = r() < 0.5 ? 255 : 0;
      ctx.fillStyle = "rgba(" + v + "," + v + "," + v + "," + (0.025 + r() * 0.04).toFixed(3) + ")";
      ctx.fillRect(x0 + r() * (x1 - x0), y0 + r() * (y1 - y0), 1 + r() * 2, 1 + r() * 2);
    }
  }

  function shade(hex, f) {
    tmpC.set(hex);
    const r = Math.round(Math.min(255, tmpC.r * 255 * f)), g = Math.round(Math.min(255, tmpC.g * 255 * f)), b = Math.round(Math.min(255, tmpC.b * 255 * f));
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  function drawPaw(ctx, x, y, s, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.ellipse(x, y + s * 0.35, s * 0.55, s * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    [[-0.62, -0.22], [-0.22, -0.55], [0.22, -0.55], [0.62, -0.22]].forEach(function (t) {
      ctx.beginPath(); ctx.ellipse(x + t[0] * s, y + t[1] * s, s * 0.2, s * 0.26, t[0] * 0.5, 0, Math.PI * 2); ctx.fill();
    });
  }

  function drawAtlas(team, number, seed) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = ATLAS;
    const ctx = cv.getContext("2d");
    const r = rng(seed);

    // Jersey wrap. u=0.75 is the chest, u=0.25 the middle of the back.
    ctx.fillStyle = team.primary;
    ctx.fillRect(0, R_JERSEY.y0, ATLAS, R_SLEEVE.y1 - R_JERSEY.y0);
    fleece(ctx, r, 0, 0, ATLAS, R_SLEEVE.y1, 2600);
    // Ribbed hem.
    ctx.fillStyle = shade(team.primary, 0.84);
    ctx.fillRect(0, R_JERSEY.y1 - 22, ATLAS, 22);
    for (let x = 0; x < ATLAS; x += 4) {
      ctx.fillStyle = "rgba(0,0,0,0.07)";
      ctx.fillRect(x, R_JERSEY.y1 - 22, 2, 22);
    }

    const fx = ATLAS * 0.75;
    if (team.id === "turkeys") {
      // Brown script wordmark with the swoosh underline.
      ctx.save();
      ctx.translate(fx, 104);
      ctx.transform(1, 0, -0.18, 1, 0, 0);
      ctx.font = "italic 900 50px Georgia, 'Times New Roman', serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(255,226,170,0.35)";
      ctx.strokeText("Turkeys", 0, 0);
      ctx.fillStyle = team.accent;
      ctx.fillText("Turkeys", 0, 0);
      ctx.restore();
      ctx.strokeStyle = team.accent;
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(fx - 78, 118);
      ctx.quadraticCurveTo(fx, 104, fx + 82, 110);
      ctx.stroke();
    } else if (team.id === "wildcats") {
      // Arched varsity "WILDCATS", a paw, and FOOTBALL, tone on tone.
      const txt = "WILDCATS";
      ctx.font = "900 30px 'Arial Black', Impact, 'Helvetica Neue', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const span = 150;
      for (let i = 0; i < txt.length; i++) {
        const t = i / (txt.length - 1) - 0.5;
        const x = fx + t * span;
        const y = 86 + t * t * 34;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * 0.42);
        ctx.lineWidth = 5;
        ctx.strokeStyle = "rgba(60,10,18,0.55)";
        ctx.strokeText(txt[i], 0, 0);
        ctx.fillStyle = "rgba(236,196,186,0.92)";
        ctx.fillText(txt[i], 0, 0);
        ctx.restore();
      }
      drawPaw(ctx, fx, 126, 18, "rgba(236,196,186,0.92)");
      ctx.font = "900 15px 'Arial Black', Impact, sans-serif";
      ctx.fillStyle = "rgba(236,196,186,0.9)";
      ctx.fillText("FOOTBALL", fx, 160);
    }

    // A small front number and stitched sleeve bands make the kit read as
    // football gear while preserving the source game's sweatshirt identity.
    if (number !== null && number !== undefined) {
      ctx.save();
      ctx.font = "900 48px 'Arial Black', Impact, 'Helvetica Neue', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 5;
      ctx.strokeStyle = team.id === "turkeys" ? "rgba(74,38,20,0.65)" : "rgba(48,8,16,0.7)";
      ctx.strokeText(String(number), fx, 196);
      ctx.fillStyle = team.accent;
      ctx.fillText(String(number), fx, 196);
      ctx.restore();
    }
    if (team.id === "turkeys" || team.id === "wildcats") {
      ctx.fillStyle = team.accent;
      ctx.fillRect(0, 244, ATLAS, 4);
      ctx.fillRect(0, 250, ATLAS, 2);
      ctx.fillRect(0, 287, ATLAS, 3);
    }

    // The number, big across the back.
    if (number !== null && number !== undefined) {
      const bx = ATLAS * 0.25;
      ctx.font = "900 92px 'Arial Black', Impact, 'Helvetica Neue', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 8;
      ctx.strokeStyle = team.id === "turkeys" ? "rgba(255,230,190,0.5)" : "rgba(50,8,16,0.6)";
      ctx.strokeText(String(number), bx, 118);
      ctx.fillStyle = team.id === "turkeys" ? team.accent : "rgba(236,196,186,0.95)";
      ctx.fillText(String(number), bx, 118);
    }

    // Mud: heaviest at the hem and on the sleeves' elbows. The family on the
    // sideline has not been rolling in the grass.
    const players = team.id === "turkeys" || team.id === "wildcats";
    mudBlobs(ctx, r, 0, 30, ATLAS, R_JERSEY.y1, players ? 34 : 0, 0.22, true);
    mudBlobs(ctx, r, 0, R_SLEEVE.y0, ATLAS, R_SLEEVE.y1, players ? 16 : 0, 0.2, false);

    // Pants: base, side stripes at u=0.25 and u=0.75 (outside and inside of
    // each leg), fleece, and grass-and-mud at the knees.
    ctx.fillStyle = team.pants;
    ctx.fillRect(0, R_PANTS.y0, ATLAS, R_PANTS.y1 - R_PANTS.y0);
    fleece(ctx, r, 0, R_PANTS.y0, ATLAS, R_PANTS.y1, 1800);
    ctx.fillStyle = team.stripe;
    [0.25, 0.75].forEach(function (u) {
      ctx.fillRect(u * ATLAS - 5, R_PANTS.y0, 10, R_PANTS.y1 - R_PANTS.y0);
    });
    mudBlobs(ctx, r, 0, R_PANTS.y0, ATLAS, R_PANTS.y1, players ? 46 : 0, 0.26, false);
    for (let i = 0; i < (players ? 10 : 0); i++) {
      ctx.fillStyle = "rgba(70,96,40," + (0.1 + r() * 0.12).toFixed(2) + ")";
      ctx.beginPath();
      ctx.ellipse(r() * ATLAS, R_PANTS.y0 + (0.3 + r() * 0.4) * (R_PANTS.y1 - R_PANTS.y0), 6 + r() * 10, 4 + r() * 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // The white strip every vertex-coloured part samples.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, R_PANTS.y1 + 4, ATLAS, ATLAS - R_PANTS.y1 - 4);

    // Small, shared helmet badge artwork. Keeping it in the character atlas
    // lets the helmet remain part of the existing single skinned draw call.
    ctx.fillStyle = team.accent;
    ctx.fillRect(224, 472, 64, 32);
    ctx.fillStyle = team.primary;
    if (team.id === "wildcats") {
      drawPaw(ctx, 256, 486, 11, team.primary);
    } else {
      // A compact turkey profile: fan, body, head, beak and wattle.
      ctx.save();
      ctx.translate(256, 488);
      for (let i = 0; i < 7; i++) {
        const a = -1.25 + i * 0.38;
        ctx.save(); ctx.rotate(a);
        ctx.beginPath(); ctx.ellipse(0, -8, 4.2, 9, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      ctx.beginPath(); ctx.ellipse(0, 1, 8, 6, -0.15, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(6, -5, 3.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = team.accent;
      ctx.beginPath(); ctx.arc(7, -6, 0.9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#c73f2d";
      ctx.beginPath(); ctx.ellipse(9, -1, 1.5, 3.2, -0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e3a52f";
      ctx.beginPath(); ctx.moveTo(9, -5); ctx.lineTo(15, -3); ctx.lineTo(9, -1); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  function remapUV(region) {
    const v0 = 1 - region.y1 / ATLAS;
    const v1 = 1 - region.y0 / ATLAS;
    return function (u, v) { return [u, v0 + v * (v1 - v0)]; };
  }

  // ---- part collection and merging -------------------------------------------

  function Parts() { this.list = []; }
  // geo is in the bone's local frame. opts.uv: undefined (white) | function(u,v).
  // opts.blend: { lo, hi, y0, y1 } — linear skin blend by local y.
  Parts.prototype.add = function (geo, bone, color, opts) {
    this.list.push({ geo: geo, bone: bone, color: color, opts: opts || {} });
    return geo;
  };

  function merge(parts, restWorld) {
    let nV = 0;
    let nI = 0;
    parts.forEach(function (p) {
      if (!p.geo.attributes.normal) p.geo.computeVertexNormals();
      nV += p.geo.attributes.position.count;
      nI += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
    });
    const pos = new Float32Array(nV * 3);
    const nor = new Float32Array(nV * 3);
    const uv = new Float32Array(nV * 2);
    const col = new Float32Array(nV * 3);
    const roughness = new Float32Array(nV);
    const si = new Uint16Array(nV * 4);
    const sw = new Float32Array(nV * 4);
    const idx = nV > 65535 ? new Uint32Array(nI) : new Uint16Array(nI);
    let v = 0;
    let ii = 0;
    const c = new THREE.Color();
    parts.forEach(function (p) {
      const g = p.geo;
      const P = g.attributes.position;
      const N = g.attributes.normal;
      const U = g.attributes.uv;
      const off = restWorld[p.bone];
      c.set(p.color);
      const base = v;
      for (let i = 0; i < P.count; i++) {
        const lx = P.getX(i), ly = P.getY(i), lz = P.getZ(i);
        pos[v * 3] = lx + off.x;
        pos[v * 3 + 1] = ly + off.y;
        pos[v * 3 + 2] = lz + off.z;
        nor[v * 3] = N.getX(i);
        nor[v * 3 + 1] = N.getY(i);
        nor[v * 3 + 2] = N.getZ(i);
        if (p.opts.uv && U) {
          const t = p.opts.uv(U.getX(i), U.getY(i));
          uv[v * 2] = t[0];
          uv[v * 2 + 1] = t[1];
        } else {
          uv[v * 2] = WHITE_UV[0];
          uv[v * 2 + 1] = WHITE_UV[1];
        }
        col[v * 3] = c.r;
        col[v * 3 + 1] = c.g;
        col[v * 3 + 2] = c.b;
        roughness[v] = p.opts.roughness === undefined ? 0.86 : p.opts.roughness;
        const bl = p.opts.blend;
        if (bl) {
          const wHi = smoothstep(bl.y0, bl.y1, ly);
          si[v * 4] = bl.lo; sw[v * 4] = 1 - wHi;
          si[v * 4 + 1] = bl.hi; sw[v * 4 + 1] = wHi;
        } else {
          si[v * 4] = p.bone; sw[v * 4] = 1;
        }
        v++;
      }
      if (g.index) {
        for (let i = 0; i < g.index.count; i++) idx[ii++] = g.index.getX(i) + base;
      } else {
        for (let i = 0; i < P.count; i++) idx[ii++] = base + i;
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("surfaceRoughness", new THREE.BufferAttribute(roughness, 1));
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    return geo;
  }

  // ---- head: face, hair, beard ------------------------------------------------

  // Head-centre coordinates. The head is an ellipsoid with semi-axes (a, b, c).
  function surf(hd, x, y, push) {
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    const k = 1 + (push || 0);
    return [hd.cx + hd.a * x * k, hd.cy + hd.b * y * k, hd.cz + hd.c * z * k];
  }

  // Blobs scattered over a shell around the head — curls, afros, shag. The
  // region is limited by the angle from the crown, lower at the back than at
  // the front so the face stays clear.
  function shellHair(parts, hd, bone, color, o) {
    const r = rng(o.seed);
    const n = o.count;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n * 3 && i < 600; i++) {
      const y = 1 - (i / (n * 3 - 1)) * 2;
      const rad = Math.sqrt(1 - y * y);
      const th = golden * i;
      const x = Math.cos(th) * rad;
      const z = Math.sin(th) * rad;
      const polar = Math.acos(y);
      const front = smoothstep(-0.25, 0.65, z);
      const lim = o.back + (o.front - o.back) * front;
      if (polar > lim) continue;
      if (r() > n / (n * 1.4)) continue;
      const k = o.shell * (0.96 + r() * 0.08);
      const s = hd.R * o.blob * (0.8 + r() * 0.45);
      const g = new THREE.SphereGeometry(s, 7, 5);
      place(g, [hd.cx + x * hd.a * k + (o.ox || 0) * hd.R, hd.cy + y * hd.b * k + (o.oy || 0) * hd.R, hd.cz + z * hd.c * k + (o.oz || 0) * hd.R],
        [r() * 3, r() * 3, 0], [1, o.squash || 1, 1]);
      parts.add(g, bone, color);
    }
  }

  // A smooth cap of hair: the crown down to `front` radians at the forehead and
  // `back` radians at the nape.
  function capHair(parts, hd, bone, color, k, front, back, seg) {
    const g = new THREE.SphereGeometry(1, seg || 24, 16);
    const cut = filterTris(g, function (x, y, z) {
      const polar = Math.acos(Math.max(-1, Math.min(1, y)));
      const lim = back + (front - back) * smoothstep(-0.25, 0.7, z);
      // Leave the ears out.
      const ear = Math.abs(x) > 0.82 && y < 0.15 && y > -0.35 && z < 0.35 && z > -0.45;
      return polar < lim && !ear;
    });
    place(cut, [hd.cx, hd.cy, hd.cz], null, [hd.a * k, hd.b * k, hd.c * k]);
    parts.add(cut, bone, color);
  }

  function buildHair(parts, spec, hd, bone, seed) {
    const col = spec.hairColor;
    const R = hd.R;
    switch (spec.hair) {
      case "buzz":
        capHair(parts, hd, bone, col, 1.018, 1.02, 1.95);
        break;
      case "short":
        capHair(parts, hd, bone, col, 1.045, 1.0, 1.95);
        // A little lift at the front hairline.
        parts.add(place(new THREE.SphereGeometry(R * 0.55, 12, 8), [hd.cx, hd.cy + hd.b * 0.72, hd.cz + hd.c * 0.35], [0.2, 0, 0], [1.3, 0.45, 0.9]), bone, col);
        break;
      case "swept":
        capHair(parts, hd, bone, col, 1.05, 0.98, 1.95);
        parts.add(place(new THREE.SphereGeometry(R * 0.62, 14, 9), [hd.cx + R * 0.12, hd.cy + hd.b * 0.8, hd.cz + hd.c * 0.28], [0.35, 0, -0.35], [1.35, 0.5, 1.0]), bone, col);
        parts.add(place(new THREE.SphereGeometry(R * 0.5, 12, 8), [hd.cx - R * 0.35, hd.cy + hd.b * 0.72, hd.cz + hd.c * 0.1], [0, 0, 0.4], [1.2, 0.5, 1.2]), bone, col);
        break;
      case "short_curly":
        capHair(parts, hd, bone, col, 1.02, 1.0, 1.9);
        shellHair(parts, hd, bone, col, { seed: seed, count: 90, shell: 1.06, blob: 0.17, front: 0.98, back: 1.85 });
        break;
      case "big_curly":
        capHair(parts, hd, bone, col, 1.03, 1.05, 2.05);
        shellHair(parts, hd, bone, col, { seed: seed, count: 110, shell: 1.2, blob: 0.3, front: 1.08, back: 2.2 });
        break;
      case "afro":
        capHair(parts, hd, bone, col, 1.03, 1.02, 1.95);
        shellHair(parts, hd, bone, col, { seed: seed, count: 110, shell: 1.26, blob: 0.4, front: 0.92, back: 1.75, oy: 0.18, oz: -0.08 });
        break;
      case "flattop": {
        capHair(parts, hd, bone, col, 1.02, 1.02, 1.9);
        const g = new THREE.CylinderGeometry(0.86, 0.94, 0.52, 18, 1);
        place(g, [hd.cx, hd.cy + hd.b * 0.8, hd.cz - hd.c * 0.04], null, [hd.a, R, hd.c * 0.98]);
        parts.add(g, bone, col);
        break;
      }
      case "messy": {
        capHair(parts, hd, bone, col, 1.05, 1.0, 1.95);
        const r = rng(seed);
        for (let i = 0; i < 9; i++) {
          const a = r() * Math.PI * 2;
          const g = new THREE.SphereGeometry(R * 0.3, 8, 6);
          place(g, [hd.cx + Math.cos(a) * R * 0.45, hd.cy + hd.b * (0.82 + r() * 0.12), hd.cz + Math.sin(a) * R * 0.45 + R * 0.1],
            [r() - 0.5, a, r() - 0.5], [0.8, 0.5, 1.8]);
          parts.add(g, bone, col);
        }
        break;
      }
      case "receding": {
        // Short hair round the back and sides only; the crown is bare.
        const g = new THREE.SphereGeometry(1, 24, 16);
        const cut = filterTris(g, function (x, y, z) {
          const polar = Math.acos(Math.max(-1, Math.min(1, y)));
          const ear = Math.abs(x) > 0.82 && y < 0.15 && y > -0.35 && z < 0.35 && z > -0.45;
          return polar > 0.95 && polar < 1.95 && z < 0.3 && !ear;
        });
        place(cut, [hd.cx, hd.cy, hd.cz], null, [hd.a * 1.025, hd.b * 1.025, hd.c * 1.025]);
        parts.add(cut, bone, col);
        break;
      }
      case "shaggy": {
        // Straight, thick and uncut: a full cap, long locks falling from the
        // crown all round (the face stays clear), and a fringe over the brow.
        capHair(parts, hd, bone, col, 1.07, 1.2, 2.25, 32);
        const r = rng(seed + 7);
        for (let i = 0; i < 26; i++) {
          const a = (i / 26) * Math.PI * 2 + r() * 0.2;
          const fz = Math.cos(a);                 // +1 at the face
          if (fz > 0.55) continue;
          const g = new THREE.SphereGeometry(R * 0.2, 8, 6);
          const drop = 0.25 + 0.35 * (1 - Math.max(0, fz));
          place(g, [hd.cx + Math.sin(a) * hd.a * 0.98, hd.cy + hd.b * (0.35 - drop * 0.5), hd.cz + fz * hd.c * 0.98],
            [fz * 0.3, a, -Math.sin(a) * 0.25], [0.75, 1.9 + drop, 0.55]);
          parts.add(g, bone, col);
        }
        for (let i = 0; i < 7; i++) {
          const x = -0.6 + i * 0.2;
          const g = new THREE.SphereGeometry(R * 0.2, 8, 6);
          place(g, [hd.cx + x * hd.a, hd.cy + hd.b * (0.52 + r() * 0.06 - Math.abs(x) * 0.1), hd.cz + hd.c * 0.84], [0.45, 0, x * 0.9], [0.95, 1.6, 0.55]);
          parts.add(g, bone, col);
        }
        // Volume on top and behind, set back so it cannot reach the eyes.
        parts.add(place(new THREE.SphereGeometry(R, 20, 14), [hd.cx, hd.cy + hd.b * 0.3, hd.cz - hd.c * 0.28], null, [1.12, 0.88, 1.0]), bone, col);
        break;
      }
      case "bun":
        // Pulled back into a bun: smooth cap, knot at the back of the crown.
        capHair(parts, hd, bone, col, 1.035, 1.1, 2.05, 28);
        parts.add(place(new THREE.SphereGeometry(R * 0.42, 14, 10), [hd.cx, hd.cy + hd.b * 0.62, hd.cz - hd.c * 0.72]), bone, col);
        break;
      default:
        break;   // bald
    }
  }

  function buildBeard(parts, spec, hd, bone) {
    if (!spec.beard) return;
    const col = spec.beardColor || spec.hairColor;
    const thin = spec.beard === "short" || spec.beardShort;
    const k = thin ? 1.035 : 1.07;
    // Fine tessellation: the beard's edge is cut along triangle boundaries,
    // and at 24 segments it came out as a staircase across the cheek.
    const g = new THREE.SphereGeometry(1, 56, 40);
    const cut = filterTris(g, function (x, y, z) {
      if (z < -0.3) return false;
      const front = Math.max(0, z);
      // Sideburns reach up at the ears; at the front the edge drops below
      // the mouth, which stays visible.
      const lim = 0.05 - 0.5 * Math.pow(front, 2.4);
      return y < lim && y > -0.99;
    });
    place(cut, [hd.cx, hd.cy, hd.cz], null, [hd.a * k, hd.b * (thin ? 1.02 : 1.06), hd.c * (thin ? 1.04 : 1.1)]);
    parts.add(cut, bone, col, { roughness: 0.82 });
    if (!thin) {
      // A fuller chin.
      parts.add(place(new THREE.SphereGeometry(hd.R * 0.42, 12, 8), [hd.cx, hd.cy - hd.b * 0.82, hd.cz + hd.c * 0.52], null, [1.15, 0.9, 0.9]), bone, col, { roughness: 0.82 });
    }
    // Moustache.
    const m = new THREE.CapsuleGeometry(hd.R * 0.07, hd.R * 0.34, 3, 8);
    place(m, [hd.cx, hd.cy - hd.b * 0.3, hd.cz + hd.c * 0.95], [0, 0, Math.PI / 2], [1, 1, 0.8]);
    parts.add(m, bone, col);
  }

  function buildFace(parts, spec, hd, bone) {
    const R = hd.R;
    const skin = spec.skin;
    const young = spec.face === "young";
    // Eyes: white, iris, pupil, and an upper lid in skin tone.
    [-1, 1].forEach(function (s) {
      const ex = s * 0.34;
      const ey = 0.1;
      const ep = surf(hd, ex, ey, -0.1);
      const er = R * (young ? 0.21 : 0.185);
      parts.add(place(new THREE.SphereGeometry(er, 16, 12), ep, null, [1, 1.05, 0.72]), bone, "#f4efe6", { roughness: 0.34 });
      parts.add(place(new THREE.SphereGeometry(er * 0.58, 14, 10), [ep[0], ep[1] - er * 0.05, ep[2] + er * 0.52], null, [1, 1, 0.5]), bone, spec.eyes || "#3b2a1a", { roughness: 0.2 });
      parts.add(place(new THREE.SphereGeometry(er * 0.28, 10, 8), [ep[0], ep[1] - er * 0.05, ep[2] + er * 0.72], null, [1, 1, 0.5]), bone, "#0d0a08", { roughness: 0.18 });
      parts.add(place(new THREE.SphereGeometry(er * 0.12, 8, 6), [ep[0] + er * 0.2, ep[1] + er * 0.2, ep[2] + er * 0.8]), bone, "#ffffff", { roughness: 0.12 });
      const lid = new THREE.SphereGeometry(er * 1.1, 12, 6, 0, Math.PI * 2, 0, young ? 1.05 : 1.2);
      place(lid, ep, [0.55, 0, 0], [1.02, 1.05, 0.8]);
      parts.add(lid, bone, skin, { roughness: 0.62 });
      // Brow.
      const bp = surf(hd, s * 0.35, 0.42, 0.02);
      const tilt = spec.scowl ? -s * 0.32 : s * 0.1;
      parts.add(place(new THREE.BoxGeometry(R * 0.36, R * 0.075, R * 0.1), bp, [-0.2, s * 0.15, tilt]), bone, spec.brows || spec.hairColor, { roughness: 0.82 });
      // Ear.
      const earS = R * 0.24 * (spec.ears || 1);
      parts.add(place(new THREE.SphereGeometry(earS, 14, 10), [hd.cx + s * hd.a * 0.97, hd.cy - hd.b * 0.02, hd.cz - hd.c * 0.06], [0, s * 0.3, 0], [0.42, 1, 0.72]), bone, skin, { roughness: 0.62 });
    });
    // Nose.
    const np = surf(hd, 0, -0.1, 0.06);
    const broad = spec.face === "broad" || spec.face === "round";
    parts.add(place(new THREE.SphereGeometry(R * 0.16, 14, 10), [np[0], np[1], np[2]], null, [broad ? 1.2 : 0.95, 1, 1.05]), bone, skin, { roughness: 0.6 });
    parts.add(place(new THREE.SphereGeometry(R * 0.1, 12, 8), [np[0], np[1] + R * 0.12, np[2] - R * 0.04], null, [0.9, 1.6, 0.9]), bone, skin, { roughness: 0.6 });
    // Mouth: a smile arc (or a flat line for the grump), with teeth for the grinners.
    const mp = surf(hd, 0, -0.44, spec.beard ? 0.08 : 0.02);
    const arc = spec.scowl ? Math.PI * 0.3 : Math.PI * 0.6;
    const mouth = new THREE.TorusGeometry(R * (spec.scowl ? 0.3 : 0.22), R * 0.035, 5, 12, arc);
    place(mouth, [mp[0], mp[1] + (spec.scowl ? -R * 0.22 : R * 0.12), mp[2]], [0, 0, spec.scowl ? Math.PI / 2 - arc / 2 : -Math.PI / 2 - arc / 2], [1, spec.scowl ? 0.5 : 1, 1]);
    parts.add(mouth, bone, "#5a2622", { roughness: 0.5 });
    if (!spec.scowl) {
      parts.add(place(new THREE.BoxGeometry(R * 0.26, R * 0.07, R * 0.04), [mp[0], mp[1] - R * 0.035, mp[2] - R * 0.01]), bone, "#f2eee6", { roughness: 0.24 });
    }
    // Cheeks and jaw for the broad and round faces.
    if (broad) {
      parts.add(place(new THREE.SphereGeometry(R * 0.82, 18, 14), [hd.cx, hd.cy - hd.b * 0.32, hd.cz + hd.c * 0.1], null, [1.12, 0.78, 0.9]), bone, skin, { roughness: 0.62 });
    }
  }

  // ---- football helmet -------------------------------------------------------

  function helmetCrownStripe(hd) {
    const rx = hd.a * 1.38, ry = hd.b * 1.48, rz = hd.c * 1.45;
    const cx = hd.cx, cy = hd.cy + hd.b * 0.13, cz = hd.cz - hd.c * 0.04;
    const half = rx * 0.055, seg = 36;
    const z0 = -rz * 0.9, z1 = rz * 0.82;
    const positions = [], indices = [];
    for (let i = 0; i <= seg; i++) {
      const z = z0 + (z1 - z0) * i / seg;
      for (let side = -1; side <= 1; side += 2) {
        const x = side * half;
        const dome = Math.sqrt(Math.max(0.08, 1 - (x / rx) * (x / rx) - (z / rz) * (z / rz)));
        positions.push(cx + x, cy + ry * dome + 0.002, cz + z);
      }
    }
    for (let i = 0; i < seg; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }

  function buildHelmet(parts, team, hd, bone) {
    // A rounded shell wraps the crown and back, with the lower front open so
    // the character's face and beard stay visible behind the grille.
    const shell = filterTris(new THREE.SphereGeometry(1, 44, 30), function (x, y, z) {
      return y > -0.48 || z < 0.36 || Math.abs(x) > 0.88;
    });
    place(shell, [hd.cx, hd.cy + hd.b * 0.13, hd.cz - hd.c * 0.04], null,
      [hd.a * 1.38, hd.b * 1.48, hd.c * 1.45]);
    parts.add(shell, bone, team.primary, { roughness: 0.24 });
    parts.add(helmetCrownStripe(hd), bone, team.accent, { roughness: 0.28 });

    // Ear cups anchor the shell at the jaw line. The cream stripe makes the
    // team colours easy to read from the broadcast camera.
    [-1, 1].forEach(function (side) {
      const x = side * hd.a * 1.28;
      const cy = hd.cy - hd.b * 0.12;
      const cz = hd.cz - hd.c * 0.02;
      parts.add(place(new THREE.CylinderGeometry(0.034, 0.034, 0.022, 16),
        [x, cy, cz], [0, 0, Math.PI / 2]), bone, shade(team.primary, 0.76), { roughness: 0.32 });
      parts.add(place(new THREE.CylinderGeometry(0.020, 0.020, 0.024, 16),
        [x + side * 0.012, cy, cz], [0, 0, Math.PI / 2]), bone, team.accent, { roughness: 0.38 });

      // Side decals use a reserved atlas patch with the team's mascot mark.
      const badge = new THREE.PlaneGeometry(0.082, 0.046);
      place(badge, [side * hd.a * 1.39, hd.cy + hd.b * 0.13, hd.cz - hd.c * 0.06],
        [0, side * Math.PI / 2, 0]);
      parts.add(badge, bone, "#ffffff", { roughness: 0.34, uv: function (u, v) {
        return [(224 + u * 64) / ATLAS, 1 - (472 + (1 - v) * 32) / ATLAS];
      }});
    });

    // Facemask bars sit forward of the eyes, nose and mouth, preserving their
    // expression while giving each player a recognizable football silhouette.
    const z = hd.cz + hd.c * 1.45;
    function bar(a, b, radius) {
      const from = new THREE.Vector3(a[0], a[1], a[2]);
      const to = new THREE.Vector3(b[0], b[1], b[2]);
      const d = to.clone().sub(from);
      const g = new THREE.CylinderGeometry(radius, radius, d.length(), 7, 1);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
      g.translate((from.x + to.x) * 0.5, (from.y + to.y) * 0.5, (from.z + to.z) * 0.5);
      parts.add(g, bone, "#34363a", { roughness: 0.36 });
    }
    const half = hd.a * 0.88;
    const brow = hd.cy + hd.b * 0.20;
    const chin = hd.cy - hd.b * 0.60;
    const mid = hd.cy - hd.b * 0.10;
    bar([-half, brow, z], [half, brow, z], 0.008);
    bar([-half, brow, z], [-half * 0.9, chin, z], 0.008);
    bar([half, brow, z], [half * 0.9, chin, z], 0.008);
    bar([-half * 0.9, mid, z], [half * 0.9, mid, z], 0.007);
    bar([-half * 0.82, chin, z], [half * 0.82, chin, z], 0.008);
    bar([0, mid, z], [0, chin, z], 0.006);
  }

  // ---- the whole person -----------------------------------------------------

  function build(spec, team, number, key) {
    const m = measure(spec);
    const seed = hash(key);

    // Rest skeleton: every bone at identity rotation, offsets only.
    const rest = [];
    rest[B.hips] = new THREE.Vector3(0, m.hipY, 0);
    rest[B.spine] = new THREE.Vector3(0, m.spineY, 0);
    rest[B.chest] = new THREE.Vector3(0, m.chestY, 0);
    rest[B.head] = new THREE.Vector3(0, m.neckY, 0.005);
    rest[B.uaL] = new THREE.Vector3(m.shoulderX, m.shoulderY, -0.012);
    rest[B.faL] = new THREE.Vector3(0, -m.upperArm, 0);
    rest[B.uaR] = new THREE.Vector3(-m.shoulderX, m.shoulderY, -0.012);
    rest[B.faR] = new THREE.Vector3(0, -m.upperArm, 0);
    rest[B.thL] = new THREE.Vector3(m.hipX, -0.02, 0);
    rest[B.shL] = new THREE.Vector3(0, -m.thigh, 0);
    rest[B.ftL] = new THREE.Vector3(0, -m.shin, 0);
    rest[B.thR] = new THREE.Vector3(-m.hipX, -0.02, 0);
    rest[B.shR] = new THREE.Vector3(0, -m.thigh, 0);
    rest[B.ftR] = new THREE.Vector3(0, -m.shin, 0);
    const restWorld = [];
    for (let i = 0; i < NB; i++) {
      restWorld[i] = rest[i].clone();
      if (PARENT[i] >= 0) restWorld[i].add(restWorld[PARENT[i]]);
    }

    const parts = new Parts();
    const primary = team.primary;
    const cuff = shade(primary, 0.8);
    const pants = team.pants;
    const skin = spec.skin;
    const jerseyUV = remapUV(R_JERSEY);
    const sleeveUV = remapUV(R_SLEEVE);
    const pantsUV = remapUV(R_PANTS);

    // Sweatshirt torso: a lathe, evenly sampled so the texture is not stretched,
    // seam turned to the left side (under the arm), skinned across spine→chest.
    const pts = [];
    const y0 = -0.17 * m.h;
    const y1 = m.torsoTop;
    const NS = 22;
    for (let i = 0; i <= NS; i++) {
      const y = y0 + (y1 - y0) * (i / NS);
      pts.push(new THREE.Vector2(Math.max(0.001, torsoR(y, m)), y));
    }
    const torso = new THREE.LatheGeometry(pts, 40);
    torso.rotateY(Math.PI / 2);
    torso.scale(m.sx, 1, m.sz);
    parts.add(torso, B.spine, "#ffffff", { uv: jerseyUV, roughness: 0.97, blend: { lo: B.spine, hi: B.chest, y0: 0.12 * m.h, y1: 0.3 * m.h } });
    // Collar rib.
    parts.add(place(new THREE.TorusGeometry(0.068 * m.sx, 0.02, 8, 24), [0, m.torsoTop - m.chestY - 0.012, 0.004], [Math.PI / 2, 0, 0], [1.05, m.sz / m.sx * 1.15, 1]), B.chest, cuff, { roughness: 0.92 });

    // Hips and seat of the sweatpants.
    parts.add(place(new THREE.SphereGeometry(1, 16, 12), [0, -0.02, -0.01], null,
      [0.155 * Math.pow(m.w, 0.85), 0.13, 0.12 * Math.pow(m.w, 0.6) * (1 + 0.15 * m.belly)]), B.hips, pants, { roughness: 0.97 });

    // Neck, skinned half to the chest so a turned head does not tear it.
    const neck = new THREE.CylinderGeometry(m.neckR, m.neckR * 1.12, 0.14, 12, 3);
    place(neck, [0, 0.05, 0]);
    parts.add(neck, B.head, skin, { roughness: 0.62, blend: { lo: B.chest, hi: B.head, y0: 0.0, y1: 0.08 } });

    // Head.
    const face = spec.face || "oval";
    const fs = face === "long" ? [0.9, 1.12, 0.97] : face === "round" ? [1.06, 1.0, 1.02] : face === "broad" ? [1.0, 1.02, 1.0] : face === "young" ? [0.96, 1.0, 0.98] : [0.94, 1.06, 0.98];
    const hd = { R: m.headR, a: m.headR * fs[0], b: m.headR * fs[1], c: m.headR * fs[2], cx: 0, cy: 0.07 + m.headR * fs[1] * 0.92, cz: 0.018 };
    parts.add(place(new THREE.SphereGeometry(1, 36, 28), [hd.cx, hd.cy, hd.cz], null, [hd.a, hd.b, hd.c]), B.head, skin, { roughness: 0.62 });
    // Jaw: the lower face, slightly forward.
    parts.add(place(new THREE.SphereGeometry(1, 28, 20), [hd.cx, hd.cy - hd.b * 0.38, hd.cz + hd.c * 0.14], null, [hd.a * 0.84, hd.b * 0.62, hd.c * 0.82]), B.head, skin, { roughness: 0.62 });
    buildFace(parts, spec, hd, B.head);
    buildBeard(parts, spec, hd, B.head);
    buildHelmet(parts, team, hd, B.head);

    // Arms: sleeve (shoulder ball, upper sleeve, elbow), forearm sleeve, cuff, hand.
    [[B.uaL, B.faL, 1], [B.uaR, B.faR, -1]].forEach(function (a) {
      const ua = a[0], fa = a[1], s = a[2];
      parts.add(place(new THREE.SphereGeometry(m.rUA * 1.12, 16, 12), [-s * 0.012, -0.02, 0]), ua, "#ffffff", { uv: sleeveUV, roughness: 0.97 });
      parts.add(place(new THREE.CapsuleGeometry(m.rUA, m.upperArm - m.rUA, 6, 16), [0, -m.upperArm / 2, 0]), ua, "#ffffff", { uv: sleeveUV, roughness: 0.97 });
      parts.add(place(new THREE.SphereGeometry(m.rUA * 0.98, 14, 10), [0, -m.upperArm, 0]), ua, "#ffffff", { uv: sleeveUV, roughness: 0.97 });
      const faLen = m.forearm - 0.03;
      parts.add(place(new THREE.CapsuleGeometry(m.rFA, faLen - m.rFA, 6, 16), [0, -faLen / 2, 0], null, [1, 1, 1]), fa, "#ffffff", { uv: sleeveUV, roughness: 0.97 });
      parts.add(place(new THREE.CylinderGeometry(m.rFA * 0.92, m.rFA * 0.84, 0.04, 16), [0, -faLen - 0.005, 0]), fa, cuff, { roughness: 0.92 });
      // Hand: palm facing the thigh, fingers curled a little.
      const hy = -m.forearm - 0.045;
      parts.add(place(new THREE.SphereGeometry(0.05, 14, 10), [s * -0.004, hy, 0.004], null, [0.62, 1.08, 0.95]), fa, skin, { roughness: 0.6 });
      parts.add(place(new THREE.SphereGeometry(0.036, 12, 8), [s * -0.012, hy - 0.04, 0.012], [0.4, 0, 0], [0.7, 1.0, 0.9]), fa, skin, { roughness: 0.6 });
      parts.add(place(new THREE.SphereGeometry(0.019, 8, 6), [s * -0.004, hy + 0.005, 0.045], [0.5, 0, 0], [1, 1.9, 1]), fa, skin, { roughness: 0.6 });
      // Five separated digits replace the mitten-like fist without adding bones.
      [-0.027, -0.009, 0.009, 0.027].forEach(function (x, i) {
        const length = [0.045, 0.052, 0.05, 0.043][i];
        const finger = new THREE.CapsuleGeometry(0.010, length - 0.02, 4, 8);
        parts.add(place(finger, [s * x, hy - 0.074, 0.019], [0.12, 0, s * x * 2]), fa, skin, { roughness: 0.6 });
      });
      const thumb = new THREE.CapsuleGeometry(0.011, 0.027, 4, 8);
      parts.add(place(thumb, [s * 0.048, hy - 0.012, 0.025], [0, 0, -s * 0.72]), fa, skin, { roughness: 0.6 });
    });

    // Legs: hip ball, thigh, knee, shin, gathered cuff, cleat.
    [[B.thL, B.shL, B.ftL, 1], [B.thR, B.shR, B.ftR, -1]].forEach(function (l) {
      const th = l[0], sh = l[1], ft = l[2], s = l[3];
      parts.add(place(new THREE.SphereGeometry(m.rTH * 1.12, 16, 12), [s * 0.008, 0, 0]), th, "#ffffff", { uv: pantsUV, roughness: 0.98 });
      parts.add(place(new THREE.CapsuleGeometry(m.rTH, m.thigh - m.rTH * 0.8, 6, 18), [0, -m.thigh / 2, 0], null, [1, 1, 1.02]), th, "#ffffff", { uv: pantsUV, roughness: 0.98 });
      parts.add(place(new THREE.SphereGeometry(m.rSH * 1.08, 16, 12), [0, -m.thigh, 0.004]), th, "#ffffff", { uv: pantsUV, roughness: 0.98 });
      const shLen = m.shin - 0.05;
      parts.add(place(new THREE.CapsuleGeometry(m.rSH, shLen - m.rSH, 6, 18), [0, -shLen / 2, 0]), sh, "#ffffff", { uv: pantsUV, roughness: 0.98 });
      parts.add(place(new THREE.CylinderGeometry(m.rSH * 0.86, m.rSH * 0.8, 0.05, 16), [0, -m.shin + 0.055, 0]), sh, shade(pants, 0.82), { roughness: 0.9 });
      // Cleat: black upper, pale sole, three stripes on the outside.
      parts.add(place(new THREE.CapsuleGeometry(0.047, 0.15, 5, 14), [0, -0.03, 0.045], [Math.PI / 2, 0, 0], [1.12, 1, 0.9]), ft, "#1c1b1d", { roughness: 0.82 });
      parts.add(place(new THREE.BoxGeometry(0.1, 0.022, 0.265), [0, -0.064, 0.048]), ft, "#d8d4ca", { roughness: 0.9 });
      for (let i = 0; i < 3; i++) {
        parts.add(place(new THREE.BoxGeometry(0.006, 0.05, 0.014), [s * 0.05, -0.035, 0.02 + i * 0.03], [0.5, 0, 0]), ft, "#ecebe6", { roughness: 0.75 });
      }
      [[-0.029, 0.105], [0.029, 0.105], [-0.029, 0.045], [0.029, 0.045], [0, -0.048]].forEach(function (spike) {
        parts.add(place(new THREE.CylinderGeometry(0.009, 0.012, 0.022, 8), [spike[0], -0.086, spike[1]]), ft, "#242326", { roughness: 0.84 });
      });
    });

    const geo = merge(parts.list, restWorld);

    // Skeleton.
    const bones = [];
    for (let i = 0; i < NB; i++) {
      const b = new THREE.Bone();
      b.position.copy(rest[i]);
      bones.push(b);
      if (PARENT[i] >= 0) bones[PARENT[i]].add(b);
    }
    const tex = drawAtlas(team, number, seed);
    const mat = athleteMaterial(tex);
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.add(bones[0]);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;

    // Anchors the ball and effects attach to.
    const handR = new THREE.Object3D();
    handR.position.set(-0.01, -m.forearm - 0.05, 0.03);
    bones[B.faR].add(handR);
    const handL = new THREE.Object3D();
    handL.position.set(0.01, -m.forearm - 0.05, 0.03);
    bones[B.faL].add(handL);

    const root = new THREE.Group();
    root.add(mesh);
    root.name = key;

    return {
      key: key,
      spec: spec,
      team: team,
      root: root,
      mesh: mesh,
      bones: bones,
      rest: rest,
      m: m,
      handR: handR,
      handL: handL,
      height: m.hipY + m.spineY + m.chestY + m.neckY + 0.07 + m.headR * 2.1,
      dispose: function () { geo.dispose(); mat.dispose(); tex.dispose(); }
    };
  }

  window.TBRig = { B: B, PARENT: PARENT, NB: NB, build: build, hash: hash, rng: rng };
})();
