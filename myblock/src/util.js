// Small shared helpers. Every file hangs its module off the global SP so the
// same files load in the browser and in Node (tools/sim-test.js, net-test.js)
// for headless bot matches.
globalThis.SP = globalThis.SP || {};
(function (SP) {
  "use strict";
  const U = {};
  U.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.wrap = function (a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  };
  // Turn angle a toward b by at most step radians.
  U.turnTo = function (a, b, step) {
    const d = U.wrap(b - a);
    if (Math.abs(d) <= step) return b;
    return U.wrap(a + Math.sign(d) * step);
  };
  U.rand = function (a, b) { return a + Math.random() * (b - a); };
  U.pick = function (arr) { return arr[(Math.random() * arr.length) | 0]; };
  U.shuffle = function (arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };
  U.fmtTime = function (s) {
    s = Math.max(0, Math.ceil(s));
    const m = Math.floor(s / 60), r = s % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  };
  // Unit direction from yaw (0 = +x, turning toward +z) and pitch (up +).
  U.dir = function (yaw, pitch) {
    const cp = Math.cos(pitch);
    return { x: Math.cos(yaw) * cp, y: Math.sin(pitch), z: Math.sin(yaw) * cp };
  };
  U.gauss = function () { return (Math.random() + Math.random() + Math.random() - 1.5) * 1.15; };
  SP.U = U;
  // A touch-first device (phone or tablet): the primary pointer is coarse and there is no fine one.
  SP.isCoarse = function () { return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(pointer: fine)").matches); };
})(globalThis.SP);
