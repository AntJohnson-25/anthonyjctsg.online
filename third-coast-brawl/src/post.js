// Post-processing: the scene renders linear HDR into a multisampled half-float target, then
// a dual-filter bloom (5 mips), a radial speed blur while boosting, ACES tone mapping,
// vignette and dither in one composite pass. Quality "low" skips all this and renders direct.
(function (RR) {
  "use strict";
  const T = window.THREE;

  const VS = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

  function pass(fs, uniforms) {
    return new T.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms: uniforms, depthTest: false, depthWrite: false, toneMapped: false });
  }

  RR.Post = function (renderer, q) {
    this.r = renderer;
    this.q = q;
    const hdr = { type: T.HalfFloatType, depthBuffer: false, minFilter: T.LinearFilter, magFilter: T.LinearFilter };
    this.scene = new T.WebGLRenderTarget(4, 4, { type: T.HalfFloatType, samples: q.msaa, minFilter: T.LinearFilter, magFilter: T.LinearFilter });
    this.mips = [];
    for (let i = 0; i < 5; i++) this.mips.push(new T.WebGLRenderTarget(4, 4, hdr));
    this.ups = [];
    for (let i = 0; i < 4; i++) this.ups.push(new T.WebGLRenderTarget(4, 4, hdr));

    this.fsScene = new T.Scene();
    this.fsCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    geo.setAttribute("uv", new T.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new T.Mesh(geo, null);
    this.quad.frustumCulled = false;
    this.fsScene.add(this.quad);

    this.mBright = pass(`uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThr; varying vec2 vUv;
      void main() {
        vec3 c = vec3(0.0);
        c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb; c += texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
        c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;  c += texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
        c *= 0.25;
        c = min(c, vec3(40.0));
        float l = max(c.r, max(c.g, c.b));
        float k = clamp((l - uThr) / max(l, 1e-4), 0.0, 1.0);
        gl_FragColor = vec4(c * k, 1.0);
      }`, { tSrc: { value: null }, uTexel: { value: new T.Vector2() }, uThr: { value: 1.0 } });
    this.mDown = pass(`uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
      void main() {
        vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
        s += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb; s += texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
        s += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;  s += texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
        gl_FragColor = vec4(s / 8.0, 1.0);
      }`, { tSrc: { value: null }, uTexel: { value: new T.Vector2() } });
    this.mUp = pass(`uniform sampler2D tSrc; uniform sampler2D tAdd; uniform vec2 uTexel; varying vec2 vUv;
      void main() {
        vec3 s = vec3(0.0);
        s += texture2D(tSrc, vUv + uTexel * vec2(-2.0, 0.0)).rgb; s += texture2D(tSrc, vUv + uTexel * vec2(2.0, 0.0)).rgb;
        s += texture2D(tSrc, vUv + uTexel * vec2(0.0, -2.0)).rgb; s += texture2D(tSrc, vUv + uTexel * vec2(0.0, 2.0)).rgb;
        s += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 2.0; s += texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb * 2.0;
        s += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb * 2.0;  s += texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb * 2.0;
        gl_FragColor = vec4(s / 12.0 + texture2D(tAdd, vUv).rgb, 1.0);
      }`, { tSrc: { value: null }, tAdd: { value: null }, uTexel: { value: new T.Vector2() } });
    this.mComp = pass(`uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uBloom; uniform float uExposure;
      uniform float uSpeed; uniform float uTime; uniform vec2 uRes; uniform float uFlash; varying vec2 vUv;
      vec3 aces(vec3 c) {
        const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
        const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
        c = I * c; vec3 a = c * (c + 0.0245786) - 0.000090537; vec3 b = c * (0.983729 * c + 0.4329510) + 0.238081; return clamp(O * (a / b), 0.0, 1.0);
      }
      vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      void main() {
        vec3 c = texture2D(tScene, vUv).rgb;
        if (uSpeed > 0.01) {
          vec2 dir = vUv - vec2(0.5, 0.56);
          float r = length(dir);
          vec3 acc = c; float w = 1.0;
          for (int i = 1; i < 7; i++) {
            float k = float(i) / 7.0 * uSpeed * 0.06 * smoothstep(0.12, 0.6, r);
            acc += texture2D(tScene, vUv - dir * k).rgb; w += 1.0;
          }
          c = acc / w;
        }
        c += texture2D(tBloom, vUv).rgb * uBloom;
        c *= uExposure;
        c += vec3(1.0, 0.95, 0.85) * uFlash;
        c = aces(c);
        vec2 v = vUv - 0.5; v.x *= uRes.x / uRes.y;
        c *= 1.0 - 0.28 * smoothstep(0.35, 1.05, length(v));
        c = toSRGB(c);
        float n = fract(sin(dot(gl_FragCoord.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453);
        c += (n - 0.5) / 255.0;
        gl_FragColor = vec4(c, 1.0);
      }`, {
      tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0.09 }, uExposure: { value: 1.0 },
      uSpeed: { value: 0 }, uTime: { value: 0 }, uRes: { value: new T.Vector2(1, 1) }, uFlash: { value: 0 }
    });
  };

  RR.Post.prototype.setSize = function (w, h) {
    this.w = w; this.h = h;
    this.scene.setSize(w, h);
    let mw = Math.max(1, w >> 1), mh = Math.max(1, h >> 1);
    for (let i = 0; i < 5; i++) {
      this.mips[i].setSize(mw, mh);
      if (i < 4) this.ups[i].setSize(mw, mh);
      mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1);
    }
    this.mComp.uniforms.uRes.value.set(w, h);
  };

  RR.Post.prototype.blit = function (mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.fsScene, this.fsCam);
  };

  RR.Post.prototype.render = function (scene, camera, fx) {
    const r = this.r;
    r.setRenderTarget(this.scene);
    r.render(scene, camera);
    // bloom
    const b = this.mBright.uniforms;
    b.tSrc.value = this.scene.texture; b.uTexel.value.set(1 / this.w, 1 / this.h); b.uThr.value = 2.0;   // sunlit snow sits around 1.5: only the sun, glints and lights bloom
    this.blit(this.mBright, this.mips[0]);
    for (let i = 1; i < 5; i++) {
      const d = this.mDown.uniforms, src = this.mips[i - 1];
      d.tSrc.value = src.texture; d.uTexel.value.set(1 / src.width, 1 / src.height);
      this.blit(this.mDown, this.mips[i]);
    }
    let prev = this.mips[4];
    for (let i = 3; i >= 0; i--) {
      const u = this.mUp.uniforms;
      u.tSrc.value = prev.texture; u.tAdd.value = this.mips[i].texture; u.uTexel.value.set(1 / prev.width, 1 / prev.height);
      this.blit(this.mUp, this.ups[i]);
      prev = this.ups[i];
    }
    const c = this.mComp.uniforms;
    c.tScene.value = this.scene.texture; c.tBloom.value = this.ups[0].texture;
    c.uSpeed.value = fx.speed || 0; c.uTime.value = (fx.time || 0) % 100; c.uFlash.value = fx.flash || 0;
    this.blit(this.mComp, null);
  };
})(window.RR = window.RR || {});
