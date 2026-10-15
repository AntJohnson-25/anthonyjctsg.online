// The renderer and the first-person camera. You sit in your chair: the camera
// is at your avatar's eyes (HS.Seats gives the eye), and you look around by
// dragging (mouse or touch) within a comfortable cone, or with the quick-look
// keys. Spectators (a fifth person in the lobby) and the menu get a slow
// orbit around the table instead.
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const THREE = globalThis.THREE;
  const U = HS.U;
  const V = { yaw: 0, pitch: -0.5, tYaw: 0, tPitch: -0.5, mode: "orbit", orbitT: 0, sens: 1, invert: false, quality: "high", fovH: 90 };
  V.REST = { yaw: 0, pitch: -0.5 };
  // The table stays on screen wherever you look (user ask 2026-10-14): the side
  // players sit only ~45 degrees off straight ahead, so 0.6 still reaches them.
  V.LIMIT = { yaw: 0.6, up: 0.05, down: -0.75 };

  V.init = function (canvas, quality) {
    V.canvas = canvas;
    V.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: quality !== "low", powerPreference: "high-performance" });
    V.renderer.outputColorSpace = THREE.SRGBColorSpace;
    V.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    V.renderer.toneMappingExposure = 1.15;
    V.renderer.shadowMap.enabled = quality !== "low";
    V.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    V.scene = new THREE.Scene();
    V.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 9000);
    V.scene.add(V.camera);
    V.setQuality(quality);
    window.addEventListener("resize", V.resize);
    V.resize();
  };
  V.setQuality = function (q) {
    V.quality = q;
    const dpr = window.devicePixelRatio || 1;
    V.renderer.setPixelRatio(Math.min(dpr, q === "high" ? 2 : q === "medium" ? 1.5 : 1));
    V.renderer.shadowMap.enabled = q !== "low";
    if (HS.Room && HS.Room.spot) HS.Room.spot.castShadow = q !== "low";
    V.resize();
  };
  // Horizontal field of view (HopLobby's setting is horizontal degrees on 16:9).
  V.setFov = function (h) { V.fovH = U.clamp(h || 90, 70, 110); V.resize(); };
  V.resize = function () {
    if (!V.renderer) return;
    const w = window.innerWidth, h = window.innerHeight;
    V.renderer.setSize(w, h, false);
    V.camera.aspect = w / h;
    // Keep the 16:9 horizontal FOV; on tall screens (phones upright) widen the vertical a bit.
    const vf = 2 * Math.atan(Math.tan(V.fovH * Math.PI / 360) * 9 / 16);
    V.camera.fov = Math.min(95, vf * 180 / Math.PI * Math.max(1, (16 / 9) / Math.max(0.5, w / h) * 0.75));
    V.camera.updateProjectionMatrix();
  };

  // ------------------------------------------------------------------ looking around
  V.look = function (dx, dy) {
    V.tYaw = U.clamp(V.tYaw - dx * 0.0042 * V.sens, -V.LIMIT.yaw, V.LIMIT.yaw);
    // Drag right = turn right, drag down = look down (like moving your head).
    V.tPitch = U.clamp(V.tPitch - dy * 0.0042 * V.sens * (V.invert ? -1 : 1), V.LIMIT.down, V.LIMIT.up);
  };
  // Quick looks (relative to facing the table): partner, left, right, the trick, your hand.
  V.QUICK = { partner: [0, -0.05], left: [0.55, -0.3], right: [-0.55, -0.3], trick: [0, -0.7], hand: [0, -0.5] };
  V.quick = function (k) { const q = V.QUICK[k]; if (q) { V.tYaw = q[0]; V.tPitch = q[1]; } };
  V.lookingAt = function () { return { yaw: V.yaw, pitch: V.pitch }; };

  // ------------------------------------------------------------------ walking: a camera over Ant's shoulder
  V.walk = { yaw: 0, pitch: -0.2, dist: 3.4, tYaw: 0, tPitch: -0.2 };   // yaw 0: looking out to sea (-Z)
  V.walkLook = function (dx, dy) {
    V.walk.tYaw -= dx * 0.005 * V.sens;
    V.walk.tPitch = U.clamp(V.walk.tPitch - dy * 0.004 * V.sens * (V.invert ? -1 : 1), -0.75, 0.35);
  };
  // A blend from wherever the camera is now (moved by `shift`, when the villa moves) to the next mode.
  V.startBlend = function (dur, shift) {
    V.blend = { t: 0, dur: dur, pos: V.camera.position.clone().add(shift || new THREE.Vector3()), q: V.camera.quaternion.clone() };
  };

  // ------------------------------------------------------------------ per frame
  const _f = new THREE.Vector3(), _t = new THREE.Vector3(), _bp = new THREE.Vector3(), _bq = new THREE.Quaternion();
  // o: { seat (ours or -1), eye (Vector3), dt, t, mode: "seat" | "orbit" | "walk", focus (walk: scene point to look at) }
  V.update = function (o) {
    const dt = o.dt, cam = V.camera;
    if (o.mode === "walk") {
      const W = V.walk, k = 1 - Math.exp(-dt * 12);
      W.yaw += (W.tYaw - W.yaw) * k; W.pitch += (W.tPitch - W.pitch) * k;
      const f = o.focus;
      const cp = Math.cos(W.pitch);
      // Behind and a little to the right of the head; never through the villa wall or past the glass.
      _t.set(Math.sin(W.yaw) * cp, -Math.sin(W.pitch), Math.cos(W.yaw) * cp).multiplyScalar(W.dist);
      cam.position.copy(f).add(_t);
      cam.position.addScaledVector(_f.set(Math.cos(W.yaw), 0, -Math.sin(W.yaw)), 0.35);
      if (o.clamp) o.clamp(cam.position);
      cam.position.y = Math.max(cam.position.y, 0.35);
      cam.lookAt(_f.copy(f).addScaledVector(_t.set(Math.cos(W.yaw), 0, -Math.sin(W.yaw)), 0.35));
      V.mode = "walk";
    } else if (o.mode === "seat" && o.seat >= 0) {
      const k = 1 - Math.exp(-dt * 10);
      V.yaw += (V.tYaw - V.yaw) * k; V.pitch += (V.tPitch - V.pitch) * k;
      const base = HS.Room.seatYaw(o.seat);
      const yaw = base + V.yaw;
      // A slight breathing sway.
      const sway = Math.sin(o.t * 1.3) * 0.0025;
      cam.position.copy(o.eye); cam.position.y += sway;
      _f.set(-Math.sin(yaw) * Math.cos(V.pitch), Math.sin(V.pitch), -Math.cos(yaw) * Math.cos(V.pitch));
      cam.lookAt(_t.copy(cam.position).add(_f));
      V.mode = "seat";
    } else {
      // Orbit: the menu's slow drift round the table, or a spectator's view.
      V.orbitT += dt * (o.slow ? 0.04 : 0.06);
      const a = V.orbitT + (o.seat >= 0 ? HS.Room.seatYaw(o.seat) : 0);
      const r = o.spectate ? 2.3 : 3.1, y = o.spectate ? 2.0 : 1.9;
      cam.position.set(Math.sin(a) * r, y + Math.sin(V.orbitT * 0.7) * 0.15, Math.cos(a) * r);
      cam.lookAt(0, o.spectate ? 0.75 : 1.0, 0);
      V.mode = "orbit";
    }
    // Ease from where the camera was (sitting down, standing up).
    const B = V.blend;
    if (B && B.t < B.dur) {
      B.t += dt;
      const k = U.ease(Math.min(1, B.t / B.dur));
      _bp.copy(cam.position); _bq.copy(cam.quaternion);
      cam.position.lerpVectors(B.pos, _bp, k);
      cam.quaternion.slerpQuaternions(B.q, _bq, k);
    }
  };
  V.render = function () { V.renderer.render(V.scene, V.camera); };
  V.ndc = function (x, y) { const r = V.canvas.getBoundingClientRect(); return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1); };
  V.toScreen = function (p) {
    const v = p.clone().project(V.camera);
    return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight, behind: v.z > 1 };
  };
  HS.View = V;
})(globalThis.HS);
