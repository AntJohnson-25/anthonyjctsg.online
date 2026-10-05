// Landing screen: the key art full-bleed (landscape or portrait by window shape) with a slow push-in,
// pointer/tilt parallax and a PLAY button. PLAY fades it out onto the fighter menu (and counts as the
// first tap, so audio can start). Skipped for any test URL (?auto, ?sim, ?until, ...) or ?nolanding=1.
(function () {
  "use strict";
  const el = document.getElementById("landing");
  if (!el) return;
  const q = new URLSearchParams(location.search);
  const skip = ["auto", "sim", "until", "trace", "seed", "pick", "race", "route", "series", "lane", "fallat", "press", "nolanding"]
    .some(function (k) { return q.has(k); });
  if (skip) { el.remove(); return; }

  const art = el.querySelector(".ld-art");
  let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0, gone = false;
  function move(x, y) { tx = (x / window.innerWidth - 0.5) * 2; ty = (y / window.innerHeight - 0.5) * 2; }
  window.addEventListener("pointermove", function (e) { move(e.clientX, e.clientY); });
  window.addEventListener("deviceorientation", function (e) {
    if (e.gamma == null) return;
    tx = Math.max(-1, Math.min(1, e.gamma / 25)); ty = Math.max(-1, Math.min(1, (e.beta - 45) / 25));
  });
  function tick() {
    cx += (tx - cx) * 0.06; cy += (ty - cy) * 0.06;
    art.style.setProperty("--px", (cx * -14).toFixed(2) + "px");
    art.style.setProperty("--py", (cy * -9).toFixed(2) + "px");
    if (!gone) raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  function play() {
    if (gone) return; gone = true;
    cancelAnimationFrame(raf);
    el.classList.add("out");
    setTimeout(function () { el.remove(); }, 650);
  }
  el.querySelector(".ld-play").addEventListener("click", play);
  window.addEventListener("keydown", function (e) {
    if (!gone && (e.code === "Enter" || e.code === "Space")) { e.preventDefault(); play(); }
  });
})();
