// Small shared helpers. Every file hangs its module off the global HK so the
// game runs from a double-clicked index.html and the same files load in Node
// (tools/check.js) for headless bot-vs-bot matches.
globalThis.HK = globalThis.HK || {};
(function (HK) {
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
  HK.U = U;
})(globalThis.HK);
