// Small building blocks for the plaza: geometry, the thermal shader, heat colours, text labels.
import * as THREE from "three";

// ---------------------------------------------------------------- heat ramp

const STOPS = [
  [0.0, new THREE.Color("#0b4a1f")],
  [0.3, new THREE.Color("#12913d")],
  [0.55, new THREE.Color("#25e05c")],
  [0.72, new THREE.Color("#5dff82")],
  [0.86, new THREE.Color("#a6ffba")],
  [1.0, new THREE.Color("#ebfff1")]
];
export const HEAT_CSS = "linear-gradient(90deg, #0b4a1f, #12913d 30%, #25e05c 55%, #5dff82 72%, #a6ffba 86%, #ebfff1)";

export function heat(t, out) {
  out = out || new THREE.Color();
  t = Math.min(1, Math.max(0, t));
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const a = STOPS[i - 1];
      const b = STOPS[i];
      return out.copy(a[1]).lerp(b[1], (t - a[0]) / (b[0] - a[0]));
    }
  }
  return out.copy(STOPS[STOPS.length - 1][1]);
}

export const COLORS = {
  lit: new THREE.Color("#39ff6e"),
  dim: new THREE.Color("#1f8a43"),
  missing: new THREE.Color("#ff3048"),
  extra: new THREE.Color("#ffb020"),
  bg: new THREE.Color("#000000")
};

// ---------------------------------------------------------------- geometry

// Concatenate non-indexed copies of several geometries (position + normal only).
function merge(list) {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  parts.forEach((g) => { n += g.attributes.position.count; });
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  parts.forEach((g) => {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return out;
}

// A low-poly standing person, feet at y = 0, about 1.8 units tall, facing +z.
export function figureGeometry() {
  const torso = new THREE.CapsuleGeometry(0.25, 0.5, 4, 12);
  torso.scale(1, 1, 0.68);
  torso.translate(0, 1.12, 0);
  const head = new THREE.SphereGeometry(0.17, 16, 12);
  head.translate(0, 1.66, 0.01);
  const neck = new THREE.CylinderGeometry(0.07, 0.08, 0.12, 8);
  neck.translate(0, 1.48, 0);
  const legL = new THREE.CapsuleGeometry(0.095, 0.62, 4, 8);
  legL.translate(-0.12, 0.42, 0);
  const legR = legL.clone();
  legR.translate(0.24, 0, 0);
  const armL = new THREE.CapsuleGeometry(0.07, 0.56, 4, 8);
  armL.rotateZ(0.12);
  armL.translate(-0.34, 1.05, 0);
  const armR = new THREE.CapsuleGeometry(0.07, 0.56, 4, 8);
  armR.rotateZ(-0.12);
  armR.translate(0.34, 1.05, 0);
  return merge([torso, head, neck, legL, legR, armL, armR]);
}

// A shipping crate with a lid lip, base at y = 0.
export function crateGeometry() {
  const body = new THREE.BoxGeometry(0.86, 0.78, 0.86, 2, 2, 2);
  body.translate(0, 0.39, 0);
  const lid = new THREE.BoxGeometry(0.94, 0.1, 0.94);
  lid.translate(0, 0.82, 0);
  const band = new THREE.BoxGeometry(0.9, 0.08, 0.9);
  band.translate(0, 0.22, 0);
  return merge([body, lid, band]);
}

// A unit-height bar, base at y = 0 (scaled on y to the value).
export function pillarGeometry() {
  const g = new THREE.BoxGeometry(0.9, 1, 0.9);
  g.translate(0, 0.5, 0);
  return merge([g]);
}

// ---------------------------------------------------------------- thermal material

// Self-lit "heat camera" look: bright core facing the viewer, hot rim, a scan shimmer.
// Per instance: aColor (rgb) and aState (x = brightness 0..1, y = 0 normal | 1 missing | 2 extra).
export function thermalMaterial(shared) {
  return new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: /* glsl */`
      attribute vec3 aColor;
      attribute vec2 aState;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vC;
      varying vec2 vS;
      varying float vY;
      varying float vDist;
      void main() {
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz);
        vC = aColor;
        vS = aState;
        vY = w.y;
        vDist = length(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uFog;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vC;
      varying vec2 vS;
      varying float vY;
      varying float vDist;
      void main() {
        float facing = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
        float core = pow(facing, 1.5);
        float rim = pow(1.0 - facing, 2.5);
        vec3 col = vC * (0.22 + 1.0 * core) + mix(vC, vec3(1.0), 0.35) * rim * 0.9;
        col *= 0.9 + 0.1 * sin(vY * 34.0 - uTime * 5.0);
        if (vS.y > 0.5 && vS.y < 1.5) {
          float p = 0.5 + 0.5 * sin(uTime * 6.5);
          col = mix(col, vec3(1.0, 0.16, 0.2) * (0.35 + core), 0.55 + 0.4 * p);
          col *= 0.55 + 0.45 * step(0.5, fract(vY * 9.0 + uTime * 1.5));
        } else if (vS.y > 1.5) {
          col = mix(col, vec3(1.0, 0.69, 0.13) * (0.3 + core), 0.45);
        }
        col *= mix(0.3, 1.0, vS.x);
        float fog = smoothstep(26.0, 70.0, vDist);
        gl_FragColor = vec4(mix(col, uFog, fog), 1.0);
      }`
  });
}

export function groundMaterial(shared) {
  return new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: /* glsl */`
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uFog;
      uniform float uStageR;
      uniform float uPulse;
      uniform float uHolo;
      uniform vec3 uStageColor;
      varying vec3 vW;
      float grid(vec2 p, float s, float w) {
        vec2 q = p / s;
        vec2 g = abs(fract(q - 0.5) - 0.5) / (fwidth(q) * w);
        return 1.0 - min(min(g.x, g.y), 1.0);
      }
      void main() {
        vec2 p = vW.xz;
        float sd = length(p);
        vec3 col = mix(vec3(0.36, 0.39, 0.44), vec3(0.0), uHolo);
        vec3 gc = mix(vec3(0.05, 0.28, 0.45), vec3(0.1, 1.0, 0.4), uHolo);
        col += gc * (grid(p, 1.0, 1.0) * mix(0.025, 0.1, uHolo) + grid(p, 5.0, 1.4) * mix(0.09, 0.32, uHolo));
        float inside = smoothstep(uStageR, uStageR - 0.6, sd);
        col = mix(col, col * 0.6 + uStageColor * 0.07, inside);
        float ring = smoothstep(0.16, 0.0, abs(sd - uStageR));
        float ring2 = smoothstep(0.06, 0.0, abs(sd - uStageR - 0.45));
        col += uStageColor * (ring * (0.75 + 0.25 * sin(uTime * 2.2)) + ring2 * 0.35);
        float wave = mod(uTime * 9.0, 40.0);
        col += uStageColor * smoothstep(0.9, 0.0, abs(sd - wave)) * 0.5 * uPulse * (1.0 - wave / 40.0);
        float fog = smoothstep(46.0, 110.0, distance(vW, cameraPosition));
        gl_FragColor = vec4(mix(col, uFog, fog), 1.0);
      }`
  });
}

// ---------------------------------------------------------------- labels

export function makeLabel(text, opts) {
  opts = opts || {};
  const size = opts.size || 30;
  const pad = 14;
  const c = document.createElement("canvas");
  const g = c.getContext("2d");
  const font = "600 " + size + "px 'Cascadia Mono', Consolas, monospace";
  const subFont = "500 " + Math.round(size * 0.72) + "px 'Cascadia Mono', Consolas, monospace";
  g.font = font;
  let w = g.measureText(text).width;
  if (opts.sub) { g.font = subFont; w = Math.max(w, g.measureText(opts.sub).width); }
  const h = size + (opts.sub ? size * 0.95 : 0) + pad * 1.2;
  c.width = Math.ceil(w + pad * 2);
  c.height = Math.ceil(h);
  const accent = opts.color || "#39ff6e";
  g.fillStyle = "rgba(0, 8, 2, 0.84)";
  roundRect(g, 1, 1, c.width - 2, c.height - 2, 10);
  g.fill();
  g.strokeStyle = accent;
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = "#c8ffd8";
  g.font = font;
  g.textBaseline = "top";
  g.fillText(text, pad, pad * 0.6);
  if (opts.sub) {
    g.fillStyle = accent;
    g.font = subFont;
    g.fillText(opts.sub, pad, pad * 0.6 + size * 1.05);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true });
  const s = new THREE.Sprite(mat);
  const worldH = (opts.height || 0.42) * (c.height / (size + pad * 1.2));
  s.scale.set(worldH * c.width / c.height, worldH, 1);
  s.center.set(0.5, 0);
  s.renderOrder = 20;
  return s;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function disposeLabel(s) {
  s.material.map.dispose();
  s.material.dispose();
  if (s.parent) s.parent.remove(s);
}
