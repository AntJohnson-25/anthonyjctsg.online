// Effects: a pooled GPU point-sprite particle system (roost, dust, water and mud spray, sparks,
// hit bursts), tyre tracks behind every rider, and ambient motes (pollen, dust, embers).
(function (RR) {
  "use strict";
  const T = window.THREE;

  RR.Particles = function (scene, max) {
    this.max = max;
    this.n = 0;
    const g = this.geo = new T.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.max0 = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.grow = new Float32Array(max);
    g.setAttribute("position", new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute("aCol", new T.BufferAttribute(this.col, 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute("aSize", new T.BufferAttribute(this.size, 1).setUsage(T.DynamicDrawUsage));
    g.setAttribute("aAlpha", new T.BufferAttribute(this.alpha, 1).setUsage(T.DynamicDrawUsage));
    g.boundingSphere = new T.Sphere(new T.Vector3(), 1e6);
    this.mat = new T.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: `attribute vec3 aCol; attribute float aSize; attribute float aAlpha; uniform float uScale;
        varying vec3 vCol; varying float vA;
        void main() { vCol = aCol; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // fade what's near the lens: the player's own spray must never bury their board
          vA = aAlpha * smoothstep(2.8, 7.5, -mv.z);
          gl_PointSize = clamp(aSize * uScale / -mv.z, 0.0, 256.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vCol; varying float vA;
        void main() { vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0; if (r > 1.0) discard;
          float a = (1.0 - r) * (1.0 - r) * vA; gl_FragColor = vec4(vCol, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false
    });
    this.pts = new T.Points(g, this.mat);
    this.pts.frustumCulled = false;
    this.pts.renderOrder = 5;
    scene.add(this.pts);
  };
  RR.Particles.prototype.emit = function (x, y, z, vx, vy, vz, life, size, r, g, b, grav, drag, grow) {
    let i = this.n;
    if (i >= this.max) { i = Math.floor(Math.random() * this.max); } else this.n++;
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.col[k] = r; this.col[k + 1] = g; this.col[k + 2] = b;
    this.life[i] = life; this.max0[i] = life; this.size[i] = size; this.alpha[i] = 1;
    this.grav[i] = grav === undefined ? 14 : grav; this.drag[i] = drag || 0.6; this.grow[i] = grow || 0;
  };
  RR.Particles.prototype.update = function (dt) {
    let n = this.n;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap with last
        n--;
        const k = i * 3, j = n * 3;
        for (let c = 0; c < 3; c++) { this.pos[k + c] = this.pos[j + c]; this.vel[k + c] = this.vel[j + c]; this.col[k + c] = this.col[j + c]; }
        this.life[i] = this.life[n]; this.max0[i] = this.max0[n]; this.size[i] = this.size[n]; this.alpha[i] = this.alpha[n];
        this.grav[i] = this.grav[n]; this.drag[i] = this.drag[n]; this.grow[i] = this.grow[n];
        i--; continue;
      }
      const k = i * 3, dr = Math.exp(-this.drag[i] * dt);
      this.vel[k] *= dr; this.vel[k + 2] *= dr; this.vel[k + 1] = this.vel[k + 1] * dr - this.grav[i] * dt;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const f = this.life[i] / this.max0[i];
      this.alpha[i] = Math.min(1, f * 2.5) * Math.min(1, (1 - f) * 12 + 0.2);
    }
    this.n = n;
    this.geo.setDrawRange(0, n);
    const A = this.geo.attributes;
    A.position.needsUpdate = A.aCol.needsUpdate = A.aSize.needsUpdate = A.aAlpha.needsUpdate = true;
  };
  // helpers
  // a ring of dust / spray kicked up on landing; col = [r, g, b] (linear-ish, can exceed 1)
  RR.Particles.prototype.splash = function (x, y, z, big, col) {
    const c = col || [0.55, 0.45, 0.35], n = big ? 90 : 30;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = (big ? 2.5 : 1.4) + Math.random() * (big ? 4 : 2);
      this.emit(x + Math.cos(a) * 0.4, y + 0.1, z + Math.sin(a) * 0.4, Math.cos(a) * s, (big ? 3.5 : 1.6) + Math.random() * (big ? 4 : 2), Math.sin(a) * s,
        0.5 + Math.random() * (big ? 0.8 : 0.5), 0.06 + Math.random() * (big ? 0.16 : 0.1), c[0], c[1], c[2], 9, 1.2, 0.35);
    }
  };
  RR.Particles.prototype.burst = function (x, y, z, n, r, g, b, speed, life, size) {
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * 6.283, s = Math.sqrt(1 - u * u), sp = speed * (0.4 + Math.random() * 0.6);
      this.emit(x, y, z, Math.cos(a) * s * sp, u * sp + speed * 0.3, Math.sin(a) * s * sp, life * (0.6 + Math.random() * 0.6), size, r, g, b, 6, 1.2);
    }
  };

  // ---------- board trails: a groove carved into the snow behind every board ----------
  RR.Trail = function (scene, N) {
    this.N = N;
    this.pts = [];
    const g = this.geo = new T.BufferGeometry();
    this.p = new Float32Array(N * 2 * 3); this.uv = new Float32Array(N * 2 * 2); this.a = new Float32Array(N * 2);
    g.setAttribute("position", new T.BufferAttribute(this.p, 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute("uv", new T.BufferAttribute(this.uv, 2).setUsage(T.DynamicDrawUsage));
    g.setAttribute("aAlpha", new T.BufferAttribute(this.a, 1).setUsage(T.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    if (!RR.trailMat) {
      RR.trailMat = new T.ShaderMaterial({
        uniforms: { uCol: { value: new T.Color(0.18, 0.12, 0.08) }, uA: { value: 0.5 } },
        vertexShader: `attribute float aAlpha; varying vec2 vUv; varying float vA;
          void main() { vUv = uv; vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform vec3 uCol; uniform float uA; varying vec2 vUv; varying float vA;
          void main() {
            float u = vUv.x;
            // a tyre track: a dark pressed band with soft edges
            float band = smoothstep(0.0, 0.25, u) * smoothstep(1.0, 0.75, u);
            gl_FragColor = vec4(uCol, band * uA * vA);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
      });
    }
    this.mesh = new T.Mesh(g, RR.trailMat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.last = -1;
    scene.add(this.mesh);
  };
  // x,y,z = board centre on the snow; (rx, rz) = board right; k = 0..1 (0 = in the air: a gap)
  RR.Trail.prototype.update = function (now, x, y, z, rx, rz, k, maxAge) {
    const pts = this.pts, N = this.N;
    if (now - this.last > 0.06) {
      this.last = now;
      pts.unshift({ x: x, y: y, z: z, rx: rx, rz: rz, t: now, k: k });
      if (pts.length > N) pts.pop();
    } else if (pts.length) {
      const p = pts[0]; p.x = x; p.y = y; p.z = z; p.rx = rx; p.rz = rz; p.k = Math.min(p.k, k);
    }
    for (let i = 0; i < N; i++) {
      const p = pts[Math.min(i, pts.length - 1)] || { x: x, y: y, z: z, rx: rx, rz: rz, t: now, k: 0 };
      const age = Math.min(1, (now - p.t) / maxAge), w = this.w || 0.17;
      const b = i * 2;
      this.p[b * 3] = p.x - p.rx * w; this.p[b * 3 + 1] = p.y + 0.03; this.p[b * 3 + 2] = p.z - p.rz * w;
      this.p[b * 3 + 3] = p.x + p.rx * w; this.p[b * 3 + 4] = p.y + 0.03; this.p[b * 3 + 5] = p.z + p.rz * w;
      this.uv[b * 2] = 0; this.uv[b * 2 + 1] = age; this.uv[b * 2 + 2] = 1; this.uv[b * 2 + 3] = age;
      const nb = pts[Math.min(i + 1, pts.length - 1)];
      const a = i >= pts.length - 1 ? 0 : Math.min(p.k, nb ? nb.k : 0) * (1 - age) * Math.min(1, i * 0.5);
      this.a[b] = a; this.a[b + 1] = a;
    }
    const A = this.geo.attributes;
    A.position.needsUpdate = A.uv.needsUpdate = A.aAlpha.needsUpdate = true;
  };
  RR.Trail.prototype.clear = function () { this.pts.length = 0; };

  // ---------- ambient motes in a box that wraps around the camera (pollen, dust, embers) ----------
  RR.Motes = function (scene, n, o) {
    const g = new T.BufferGeometry(), p = new Float32Array(n * 3), s = new Float32Array(n);
    for (let i = 0; i < n; i++) { p[i * 3] = Math.random() * 60; p[i * 3 + 1] = Math.random() * 30; p[i * 3 + 2] = Math.random() * 60; s[i] = Math.random(); }
    g.setAttribute("position", new T.BufferAttribute(p, 3));
    g.setAttribute("aSeed", new T.BufferAttribute(s, 1));
    g.boundingSphere = new T.Sphere(new T.Vector3(), 1e6);
    o = o || {};
    this.mat = new T.ShaderMaterial({
      uniforms: { uCam: { value: new T.Vector3() }, uTime: { value: 0 }, uScale: { value: 600 }, uCol: { value: new T.Color(o.color || 0xffffff) }, uFall: { value: o.fall || 0.2 }, uSize: { value: o.size || 0.03 }, uA: { value: o.alpha || 0.7 }, uRise: { value: o.rise || 0 } },
      vertexShader: `attribute float aSeed; uniform vec3 uCam; uniform float uTime; uniform float uScale; uniform float uFall; uniform float uSize; uniform float uRise; varying float vA; varying float vF;
        void main() {
          vec3 q = position;
          q.y += uTime * (uRise - uFall) * (0.6 + aSeed * 0.8);
          q.x += sin(uTime * 0.7 + aSeed * 40.0) * 1.5 + uTime * 0.4;
          q.z += cos(uTime * 0.5 + aSeed * 23.0) * 1.2;
          vec3 box = vec3(60.0, 30.0, 60.0);
          vec3 w = mod(q - uCam + box * 0.5, box) - box * 0.5 + uCam;
          vec4 mv = modelViewMatrix * vec4(w, 1.0);
          vA = smoothstep(0.8, 3.0, -mv.z) * (1.0 - smoothstep(18.0, 30.0, -mv.z));
          vF = 0.6 + 0.4 * sin(uTime * (2.0 + aSeed * 3.0) + aSeed * 30.0);
          gl_PointSize = clamp((uSize + aSeed * uSize) * uScale / -mv.z, 1.0, 10.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform vec3 uCol; uniform float uA; varying float vA; varying float vF;
        void main() { vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0; if (r > 1.0) discard;
          gl_FragColor = vec4(uCol * vF, (1.0 - r) * vA * uA);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending: o.additive ? T.AdditiveBlending : T.NormalBlending
    });
    this.pts = new T.Points(g, this.mat);
    this.pts.frustumCulled = false;
    this.pts.renderOrder = 6;
    scene.add(this.pts);
  };
  RR.Motes.prototype.update = function (cam, t) { this.mat.uniforms.uCam.value.copy(cam.position); this.mat.uniforms.uTime.value = t; };
  RR.Motes.prototype.dispose = function (scene) { scene.remove(this.pts); this.pts.geometry.dispose(); this.mat.dispose(); };
})(window.RR = window.RR || {});
