// Small shared helpers: seeded random, params, maths.
(function (RR) {
  "use strict";
  RR.rng = function (seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const qs = new URLSearchParams(location.search);
  RR.param = function (k, d) { const v = qs.get(k); return v === null ? d : v; };
  RR.num = function (k, d) { const v = qs.get(k); return v === null || v === "" ? d : +v; };
  RR.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  RR.lerp = function (a, b, t) { return a + (b - a) * t; };
  RR.damp = function (a, b, k, dt) { return b + (a - b) * Math.exp(-k * dt); };
  RR.wrapAngle = function (a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  RR.smooth = function (t) { t = RR.clamp(t, 0, 1); return t * t * (3 - 2 * t); };
})(window.RR = window.RR || {});
