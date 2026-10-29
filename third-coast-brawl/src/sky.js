// Houston skies, one per event: DUSK (golden hour over downtown), MORNING (humid haze in the
// woods) and SMOG (a low orange sun through the refinery haze). One sky-dome shader driven by
// uniforms, the sun + hemisphere lights, fog, and a PMREM environment baked from the same sky so the
// riders and machines pick up its colour. Also the shared noise GLSL.
(function (RR) {
  "use strict";
  const T = window.THREE;

  RR.SUN_DIR = new T.Vector3(-0.58, 0.55, 0.22).normalize();
  RR.skyUniforms = {
    uSunDir: { value: RR.SUN_DIR }, uCloudT: { value: 0 },
    uZen: { value: new T.Color() }, uHor: { value: new T.Color() }, uHaze: { value: new T.Color() }, uSunCol: { value: new T.Color() },
    uCloudCol: { value: new T.Color() }, uCloudAmt: { value: 0.5 }, uGroundCol: { value: new T.Color() }
  };

  // colours are linear HDR
  RR.SKIES = {
    dusk: {
      sun: [0.62, 0.15, -0.77], zen: [0.05, 0.08, 0.26], hor: [1.0, 0.5, 0.24], haze: [1.05, 0.72, 0.5], sunCol: [1.0, 0.62, 0.3],
      cloud: [1.25, 0.62, 0.52], cloudAmt: 0.55, ground: [0.32, 0.26, 0.24],
      light: 0xffa868, intensity: 2.5, hemiSky: 0x8a96d0, hemiGround: 0x5a463c, hemi: 0.6, fog: 0xc98e72, fogD: 0.0011
    },
    morning: {
      sun: [-0.42, 0.62, 0.34], zen: [0.05, 0.17, 0.44], hor: [0.62, 0.74, 0.86], haze: [0.86, 0.9, 0.9], sunCol: [1.0, 0.92, 0.78],
      cloud: [1.35, 1.35, 1.3], cloudAmt: 0.45, ground: [0.2, 0.26, 0.16],
      light: 0xfff0d6, intensity: 2.3, hemiSky: 0xa6c4e0, hemiGround: 0x46552f, hemi: 0.62, fog: 0xa9bcb8, fogD: 0.0021
    },
    smog: {
      sun: [0.48, 0.1, -0.87], zen: [0.09, 0.1, 0.22], hor: [1.0, 0.45, 0.18], haze: [0.98, 0.58, 0.32], sunCol: [1.0, 0.5, 0.22],
      cloud: [0.85, 0.5, 0.38], cloudAmt: 0.62, ground: [0.36, 0.28, 0.2],
      light: 0xff9550, intensity: 2.4, hemiSky: 0x9a88a6, hemiGround: 0x5e4630, hemi: 0.62, fog: 0xbb7f5a, fogD: 0.0016
    }
  };

  RR.GLSL_NOISE = /* glsl */`
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm3(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
float fbm5(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3; a *= 0.5; } return s; }
`;

  RR.GLSL_SKY = /* glsl */`
uniform vec3 uSunDir, uZen, uHor, uHaze, uSunCol, uCloudCol, uGroundCol;
uniform float uCloudT, uCloudAmt;
vec3 skyBase(vec3 d) {
  float y = clamp(d.y, -1.0, 1.0);
  float yy = max(y, 0.0);
  float sd = max(dot(d, uSunDir), 0.0);
  vec3 c = mix(uHor, uZen, pow(yy, 0.5));
  c = mix(c, uHaze, pow(1.0 - yy, 10.0) * 0.85);
  c += uSunCol * (pow(sd, 6.0) * 0.35 + pow(sd, 48.0) * 0.8 + pow(sd, 600.0) * 5.0);
  if (y < 0.0) c = mix(c, uGroundCol, clamp(-y * 4.0, 0.0, 1.0));
  return c;
}
float cloudMask(vec3 d, int hq) {
  if (d.y <= 0.01) return 0.0;
  vec2 uv = d.xz / (d.y + 0.12) * 0.9 + vec2(uCloudT * 0.006, uCloudT * 0.002);
  float n = hq == 1 ? fbm5(uv) : fbm3(uv);
  float m = smoothstep(0.72 - uCloudAmt * 0.18, 0.9 - uCloudAmt * 0.1, n);
  return m * smoothstep(0.02, 0.18, d.y);
}
vec3 skyColor(vec3 d, int hq) {
  vec3 c = skyBase(d);
  float sd = max(dot(d, uSunDir), 0.0);
  c += uSunCol * smoothstep(0.99955, 0.99975, sd) * 40.0;
  float m = cloudMask(d, hq);
  if (m > 0.0) {
    vec3 cl = mix(uCloudCol * 0.55, uCloudCol * 1.25, 0.35 + 0.65 * pow(sd, 3.0));
    c = mix(c, cl, m * 0.85);
  }
  return c;
}
`;

  function skyMaterial(hq) {
    return new T.ShaderMaterial({
      uniforms: RR.skyUniforms,
      vertexShader: `varying vec3 vDir;
        void main() { vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: RR.GLSL_NOISE + RR.GLSL_SKY + `varying vec3 vDir;
        void main() { vec3 d = normalize(vDir); gl_FragColor = vec4(skyColor(d, ${hq ? 1 : 0}), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: T.BackSide, depthWrite: false, fog: false
    });
  }

  RR.Sky = function (scene, renderer, q) {
    this.scene = scene; this.renderer = renderer;
    const dome = new T.Mesh(new T.SphereGeometry(4500, 48, 24), skyMaterial(true));
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    scene.add(dome);
    this.dome = dome;
    const sun = this.sun = new T.DirectionalLight(0xffffff, 2.4);
    sun.castShadow = q.shadow > 0;
    if (sun.castShadow) {
      sun.shadow.mapSize.set(q.shadow, q.shadow);
      const c = sun.shadow.camera;
      c.left = -18; c.right = 18; c.top = 18; c.bottom = -18; c.near = 1; c.far = 220;
      sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03;
      sun.shadow.radius = 3;
    }
    scene.add(sun, sun.target);
    this.hemi = new T.HemisphereLight(0xffffff, 0x444444, 0.6);
    scene.add(this.hemi);
    // soft fill from behind the camera so riders facing away from the low sun still read clearly
    this.fill = new T.DirectionalLight(0xfff4e6, 1.15);
    scene.add(this.fill, this.fill.target);
    scene.fog = new T.FogExp2(0xffffff, 0.001);
    this.envScene = new T.Scene();
    this.envScene.add(new T.Mesh(new T.SphereGeometry(100, 32, 16), skyMaterial(false)));
    this.envGround = new T.Mesh(new T.CircleGeometry(90, 32), new T.MeshBasicMaterial({ color: 0x888888 }));
    this.envGround.rotation.x = -Math.PI / 2; this.envGround.position.y = -6;
    this.envScene.add(this.envGround);
  };
  RR.Sky.prototype.set = function (key) {
    const P = RR.SKIES[key], U = RR.skyUniforms;
    RR.SUN_DIR.set(P.sun[0], P.sun[1], P.sun[2]).normalize();
    U.uZen.value.setRGB(P.zen[0], P.zen[1], P.zen[2]); U.uHor.value.setRGB(P.hor[0], P.hor[1], P.hor[2]);
    U.uHaze.value.setRGB(P.haze[0], P.haze[1], P.haze[2]); U.uSunCol.value.setRGB(P.sunCol[0], P.sunCol[1], P.sunCol[2]);
    U.uCloudCol.value.setRGB(P.cloud[0], P.cloud[1], P.cloud[2]); U.uCloudAmt.value = P.cloudAmt;
    U.uGroundCol.value.setRGB(P.ground[0], P.ground[1], P.ground[2]);
    this.sun.color.set(P.light); this.sun.intensity = P.intensity;
    this.hemi.color.set(P.hemiSky); this.hemi.groundColor.set(P.hemiGround); this.hemi.intensity = P.hemi + 0.5;
    this.scene.fog.color.set(P.fog); this.scene.fog.density = P.fogD;
    this.envGround.material.color.setRGB(P.ground[0], P.ground[1], P.ground[2]);
    // rebake the reflections from this sky
    const r = this.renderer, pm = new T.PMREMGenerator(r), tm = r.toneMapping;
    r.toneMapping = T.NoToneMapping;
    if (this.envRT) this.envRT.dispose();
    this.envRT = pm.fromScene(this.envScene, 0.02);
    this.env = this.envRT.texture;
    r.toneMapping = tm;
    pm.dispose();
    this.scene.environment = this.env;
    this.key = key;
  };
  // keep the shadow box on the player
  RR.Sky.prototype.followCam = function (cam, p) {
    this.fill.target.position.copy(p);
    this.fill.position.copy(cam.position).add(cam.position.clone().sub(p).setY(0).multiplyScalar(0.3)).setY(cam.position.y + 6);
  };
  RR.Sky.prototype.follow = function (p, t) {
    this.sun.target.position.copy(p);
    this.sun.position.copy(p).addScaledVector(RR.SUN_DIR, 100);
    RR.skyUniforms.uCloudT.value = t;
  };
})(window.RR = window.RR || {});
