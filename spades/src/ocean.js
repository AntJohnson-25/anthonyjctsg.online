// The sea below the villa: an open ocean to the horizon with a long swell, sets of
// waves that steepen, break and run white toward the beach, and the swash: each
// wave's sheet of foam racing up the sand and sliding back, leaving it dark and wet.
// Everything is shaders on a few planes (no textures). The waves move toward +Z
// (the beach); `shoreZ` is where the still water meets the sand.
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const THREE = globalThis.THREE;
  const O = { time: { value: 0 } };
  // One breaking wave every PERIOD seconds, crests WAVELEN apart: the ocean and the
  // swash read the same clock, so a wave that breaks is the one that runs up the sand.
  O.PERIOD = 7.0; O.WAVELEN = 13.0; O.RUNUP = 7.5;

  const NOISE = [
    "float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
    "float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);",
    "  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }",
    "float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }"
  ].join("\n");
  // Height of the sea at world (x, z) and time t; `brk` = how much of a breaking crest is here.
  const WAVES = [
    "uniform float time; uniform float shoreZ; uniform float period; uniform float wavelen;",
    "float swell(vec2 p, float t){",
    "  float h = 0.0;",
    "  h += sin(dot(p, vec2(0.08, 0.6)) * 0.35 + t * 0.9) * 0.18;",
    "  h += sin(dot(p, vec2(-0.45, 0.8)) * 0.6 + t * 1.3) * 0.08;",
    "  h += sin(dot(p, vec2(0.7, 0.55)) * 1.1 + t * 1.9) * 0.035;",
    "  h += sin(dot(p, vec2(-0.2, 0.95)) * 2.3 + t * 2.7) * 0.015;",
    "  return h; }",
    // d = distance offshore (m). Crests travel shoreward one wavelength per period.
    // f = where in its cycle this spot is (0 = the crest passing); `zone` = how far into the surf.
    // The face is steep on the shore side (f near 1), the back long and gentle (f from 0).
    "float breaker(vec2 p, float t, out float brk, out float f, out float zone){",
    "  float d = shoreZ - p.y + sin(p.x * 0.045) * 2.5 + sin(p.x * 0.013 + 1.7) * 4.0;",
    "  f = fract(d / wavelen + t / period);",
    "  float crest = f > 0.88 ? smoothstep(0.88, 1.0, f) : pow(1.0 - f / 0.88, 2.2);",
    "  float grow = smoothstep(75.0, 22.0, d) * (1.0 - smoothstep(10.0, 0.0, d) * 0.8);",
    "  zone = smoothstep(36.0, 14.0, d);",
    "  brk = grow * zone * smoothstep(0.55, 0.95, crest);",
    "  return crest * grow * 1.15; }"
  ].join("\n");

  function oceanMaterial(fogColor) {
    return new THREE.ShaderMaterial({
      uniforms: {
        time: O.time, shoreZ: { value: O.shoreZ }, period: { value: O.PERIOD }, wavelen: { value: O.WAVELEN },
        sunDir: { value: O.sunDir }, deep: { value: new THREE.Color(0x0d3550) }, mid: { value: new THREE.Color(0x1b6a86) }, shallow: { value: new THREE.Color(0x3fb3ad) },
        skyCol: { value: new THREE.Color(0xf2a07a) }, zenith: { value: new THREE.Color(0x5a78b0) }, sunCol: { value: new THREE.Color(0xffd9a0) },
        fogCol: { value: fogColor }, fogDensity: { value: 0.0016 }
      },
      vertexShader: [WAVES,
        "varying vec3 vW; varying float vBrk; varying float vD; varying float vF; varying float vZone;",
        "void main(){",
        "  vec4 w = modelMatrix * vec4(position, 1.0);",
        // Waves are laid out in the villa's own coordinates (the world group may be shifted;
        // it is never rotated, and these meshes sit at its origin).
        "  vec2 q = w.xz - vec2(modelMatrix[3][0], modelMatrix[3][2]);",
        "  float b, ff, zn; float bh = breaker(q, time, b, ff, zn);",
        "  vF = ff; vZone = zn;",
        // Calm toward the edges of the fine grid, so it meets the flat far sheet without a step.
        "  float far = smoothstep(350.0, 290.0, abs(q.x)) * smoothstep(shoreZ - 317.0, shoreZ - 260.0, q.y);",
        "  float d = shoreZ - q.y;",
        "  float h = swell(q, time) * far * smoothstep(0.0, 25.0, d) + bh;",
        "  w.y += h * smoothstep(0.0, 1.5, d);",
        "  vW = w.xyz; vBrk = b; vD = d;",
        "  gl_Position = projectionMatrix * viewMatrix * w; }"].join("\n"),
      fragmentShader: [NOISE,
        "uniform float time; uniform vec3 sunDir, deep, mid, shallow, skyCol, zenith, sunCol, fogCol; uniform float fogDensity;",
        "varying vec3 vW; varying float vBrk; varying float vD; varying float vF; varying float vZone;",
        "void main(){",
        "  vec3 n = normalize(cross(dFdx(vW), dFdy(vW))); if (n.y < 0.0) n = -n;",
        // Fine ripples the mesh is too coarse for.
        "  vec2 rp = vW.xz * 0.9 + vec2(time * 0.3, time * 0.5);",
        "  n = normalize(n + vec3(vnoise(rp) - 0.5, 0.0, vnoise(rp + 17.0) - 0.5) * 0.18);",
        "  vec3 v = normalize(cameraPosition - vW);",
        "  float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);",
        "  vec3 r = reflect(-v, n);",
        "  vec3 sky = mix(skyCol, zenith, smoothstep(0.02, 0.5, r.y));",
        "  vec3 body = mix(shallow, mid, smoothstep(2.0, 30.0, vD)); body = mix(body, deep, smoothstep(30.0, 220.0, vD));",
        "  vec3 c = mix(body, sky, 0.2 + fres * 0.7);",
        "  float sp = pow(max(dot(r, sunDir), 0.0), 220.0); c += sunCol * sp * 3.5;",
        "  c += sunCol * pow(max(dot(r, sunDir), 0.0), 18.0) * 0.18;",
        // Foam: on the breaking crests, a lacy wake behind them, and a fringe at the water's edge.
        "  float lace = fbm(vW.xz * vec2(0.55, 0.9) + vec2(0.0, time * 0.25));",
        "  float foam = vBrk * smoothstep(0.15, 0.5, lace + vBrk * 0.5) * 1.3;",
        // Whitewater: the broken wave's foam trailing out behind it (seaward of the crest, f from 0).
        "  float trail = vZone * (vF < 0.45 ? pow(1.0 - vF / 0.45, 1.5) : 0.0) * smoothstep(0.3, 0.62, lace + 0.15 * vnoise(vW.xz * 2.5));",
        "  foam += trail * 0.9;",
        "  foam += smoothstep(2.2, 0.0, vD) * smoothstep(0.25, 0.65, lace);",
        "  foam += smoothstep(22.0, 6.0, vD) * smoothstep(0.58, 0.8, fbm(vW.xz * 0.35 + vec2(1.0, -time * 0.12))) * 0.35;",
        "  c = mix(c, vec3(0.95, 0.93, 0.9), clamp(foam, 0.0, 0.95));",
        "  float dist = length(cameraPosition - vW);",
        "  c = mix(c, fogCol, 1.0 - exp(-pow(fogDensity * dist, 1.6)));",
        "  gl_FragColor = vec4(c, 1.0);",
        "  #include <tonemapping_fragment>",
        "  #include <colorspace_fragment>",
        "}"].join("\n")
    });
  }

  // The swash: a sheet over the sand from the waterline up the beach.
  function swashMaterial() {
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { time: O.time, period: { value: O.PERIOD }, runup: { value: O.RUNUP }, sunDir: { value: O.sunDir } },
      vertexShader: "varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position,1.0); }",
      fragmentShader: [NOISE,
        "uniform float time, period, runup; uniform vec3 sunDir; varying vec2 vUv; varying vec3 vW;",
        "void main(){",
        "  float x = vUv.y * runup * 1.25;",                       // metres up the beach from the waterline
        "  float lx = (vUv.x - 0.5) * 300.0;",
        "  float wob = sin(lx * 0.045) * 2.5 + sin(lx * 0.013 + 1.7) * 4.0;",   // the same shoreline wobble as the breakers
        "  float s = fract(time / period + wob / 13.0 - 0.02);",   // 0 = a crest reaching the waterline
        "  float r = s < 0.28 ? runup * sin(s / 0.28 * 1.5708) : runup * pow(1.0 - (s - 0.28) / 0.72, 1.6);",
        "  r *= 0.75 + 0.25 * vnoise(vec2(lx * 0.08, floor(time / period)));",
        "  float edge = r + (fbm(vec2(lx * 0.6, time * 0.3)) - 0.5) * 0.9;",
        "  float sheet = smoothstep(edge + 0.05, edge - 0.25, x);",
        "  float front = smoothstep(0.9, 0.0, abs(x - edge)) * (s < 0.4 ? 1.0 : 0.5);",
        "  float lace = fbm(vec2(lx * 0.9, x * 1.6 - time * 0.4));",
        "  vec3 water = mix(vec3(0.38, 0.72, 0.7), vec3(0.92, 0.93, 0.9), smoothstep(0.45, 0.75, lace) * 0.7 + front * 0.6);",
        "  float a = sheet * (0.45 + 0.4 * front + 0.15 * lace);",
        // Wet sand where the last waves reached: darker, a little shiny toward the sun.
        "  float wet = smoothstep(runup * 1.02, runup * 0.55, x) * (1.0 - sheet);",
        "  vec3 c = mix(vec3(0.24, 0.17, 0.11), water, sheet);",
        "  a = max(a, wet * 0.38);",
        "  c += vec3(1.0, 0.8, 0.55) * wet * 0.08;",
        "  a *= smoothstep(0.0, 0.03, vUv.y) * smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);",
        "  gl_FragColor = vec4(c, a);",
        "  #include <tonemapping_fragment>",
        "  #include <colorspace_fragment>",
        "}"].join("\n")
    });
  }

  // o: { parent, shoreZ, waterY, beachSlope (m of rise per m inland), fog (Color), sunDir }
  O.build = function (o) {
    O.shoreZ = o.shoreZ; O.sunDir = o.sunDir;
    const mat = oceanMaterial(o.fog);
    // Near: fine grid for the breakers. Far: a coarse sheet to the horizon.
    const near = new THREE.PlaneGeometry(700, 320, 220, 160);
    near.rotateX(-Math.PI / 2);
    near.translate(0, o.waterY, o.shoreZ - 160 + 3);
    const nm = new THREE.Mesh(near, mat);
    nm.frustumCulled = false;
    o.parent.add(nm);
    // The far sheet: three flat pieces round the fine grid (x -350..350, z shoreZ-317..shoreZ+3).
    const zA = o.shoreZ - 317, zB = o.shoreZ + 3, F = 6000;
    [[-F, F, -F, zA], [-F, -350, zA, zB + 300], [350, F, zA, zB + 300]].forEach(function (r) {
      const g = new THREE.PlaneGeometry(r[1] - r[0], r[3] - r[2], 24, 24);
      g.rotateX(-Math.PI / 2);
      g.translate((r[0] + r[1]) / 2, o.waterY, (r[2] + r[3]) / 2);
      const fm = new THREE.Mesh(g, mat);
      fm.frustumCulled = false;
      o.parent.add(fm);
    });
    // Swash over the sand (follows the beach slope).
    const sw = new THREE.PlaneGeometry(300, O.RUNUP * 1.25, 120, 6);
    sw.rotateX(-Math.PI / 2);
    const sp = sw.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const up = O.RUNUP * 1.25 / 2 - sp.getZ(i);   // 0 at the waterline end
      sp.setZ(i, o.shoreZ + up);
      sp.setY(i, o.waterY + up * o.beachSlope + 0.035);
    }
    sw.computeVertexNormals();
    const smesh = new THREE.Mesh(sw, swashMaterial());
    smesh.renderOrder = 2;
    smesh.frustumCulled = false;
    o.parent.add(smesh);
    O.meshes = [nm, smesh];
    return O;
  };
  O.update = function (t) { O.time.value = t; };
  HS.Ocean = O;
})(globalThis.HS);
