// Small shared helpers. Every file hangs its module off the global HS so the
// same files load in the browser and in Node (tools/sim-test.js, net-test.js).
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const U = {};
  U.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.ease = function (x) { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };
  U.wrap = function (a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  };
  // A seeded generator (mulberry32): the same seed deals the same cards.
  U.rng = function (seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  U.shuffle = function (arr, rnd) {
    rnd = rnd || Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };
  U.pick = function (arr, rnd) { return arr[((rnd || Math.random)() * arr.length) | 0]; };
  U.num = function (v, lim) { return typeof v === "number" && isFinite(v) && Math.abs(v) <= (lim || 1e9); };
  U.int = function (v, a, b) { return typeof v === "number" && v === Math.floor(v) && v >= a && v <= b; };
  HS.U = U;
})(globalThis.HS);
