// Turkey Bowl 3D — the sim's coordinate helpers (the non-camera half of the
// 2D game's world.js).
//
// Sim units are YARDS, offense-relative:
//   y is downfield: y=0 is the offense's own goal line, y=100 the one they attack.
//   x is across the field: x=0 the left sideline (seen from behind the offense).
// The renderer maps that onto three.js as X = x - FIELD_MID, Z = 50 - y, so the
// offense always attacks toward -Z, away from the default camera.
(function () {
  const G = typeof window !== "undefined" ? window : globalThis;

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function dist(ax, ay, bx, by) {
    return Math.hypot(bx - ax, by - ay);
  }

  // Shortest distance between two moving points over one frame, treated as the
  // distance between their swept segments. Point-distance-per-frame tunnels at
  // the closing speeds this game reaches.
  function sweptDistance(a0x, a0y, a1x, a1y, b0x, b0y, b1x, b1y) {
    const rx = a0x - b0x;
    const ry = a0y - b0y;
    const vx = a1x - a0x - (b1x - b0x);
    const vy = a1y - a0y - (b1y - b0y);
    const vv = vx * vx + vy * vy;
    let t = 0;
    if (vv > 1e-9) t = clamp(-(rx * vx + ry * vy) / vv, 0, 1);
    return Math.hypot(rx + vx * t, ry + vy * t);
  }

  const TBWorld = { clamp: clamp, dist: dist, sweptDistance: sweptDistance };
  G.TBWorld = TBWorld;
  if (typeof module !== "undefined") module.exports = TBWorld;
})();
