// Landing screen: the key art layers drift with the mouse or phone tilt (an
// idle sway when there's neither), the CTSG flag ripples on a canvas, and the
// load bar turns into BOARD THE BOAT once the first characters are in.
globalThis.HK = globalThis.HK || {};
(function (HK) {
  "use strict";
  const $ = function (id) { return document.getElementById(id); };
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const L = { running: false };
  let layers = [], tx = 0, ty = 0, x = 0, y = 0, lastInput = -1e9, raf = 0, t0 = 0;
  let flagCv = null, flagCx = null, flagImg = null;

  function start() {
    const root = $("loading");
    layers = Array.prototype.map.call(root.querySelectorAll("[data-depth]"), function (el) {
      return { el: el, d: parseFloat(el.dataset.depth) };
    });
    flagCv = $("ldFlag");
    flagCx = flagCv.getContext("2d");
    flagImg = $("ldFlagImg");
    if (flagImg.complete) sizeFlag(); else flagImg.addEventListener("load", sizeFlag);

    window.addEventListener("pointermove", function (e) {
      tx = e.clientX / window.innerWidth * 2 - 1;
      ty = e.clientY / window.innerHeight * 2 - 1;
      lastInput = performance.now();
    });
    // Android hands out tilt freely; iOS needs a permission prompt, so the
    // idle sway covers iPhones instead of interrupting the page with one.
    window.addEventListener("deviceorientation", function (e) {
      if (e.gamma == null) return;
      const land = Math.abs(window.orientation || 0) === 90;
      const a = land ? e.beta : e.gamma, b = land ? e.gamma : e.beta;
      tx = Math.max(-1, Math.min(1, a / 25));
      ty = Math.max(-1, Math.min(1, (b - 40) / 25));
      lastInput = performance.now();
    });
    L.running = true;
    t0 = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function sizeFlag() {
    // flag.webp already has 24 px of clear margin, more than the wave's swing.
    flagCv.width = flagImg.naturalWidth;
    flagCv.height = flagImg.naturalHeight;
    drawFlag(0);
  }

  // The cloth is pinned at the pole (left edge): each 3 px column is shifted
  // up/down by a travelling wave that grows toward the free end, and shaded
  // by the wave's slope so the folds catch the light.
  function drawFlag(t) {
    const w = flagCv.width, h = flagCv.height;
    if (!w) return;
    flagCx.clearRect(0, 0, w, h);
    const left = w * 0.08, amp = h * 0.035, k = 2 * Math.PI / (w * 0.55), sp = 3.2;
    for (let sx = 0; sx < w; sx += 3) {
      const free = Math.max(0, (sx - left) / (w - left));
      const ph = k * sx - sp * t;
      const dy = Math.sin(ph) * amp * free;
      flagCx.drawImage(flagImg, sx, 0, 3, h, sx, dy, 3, h);
      const shade = Math.cos(ph) * free;
      if (shade > 0.05) { flagCx.fillStyle = "rgba(255,255,255," + (shade * 0.08).toFixed(3) + ")"; }
      else if (shade < -0.05) { flagCx.fillStyle = "rgba(0,0,0," + (-shade * 0.22).toFixed(3) + ")"; }
      else continue;
      flagCx.globalCompositeOperation = "source-atop";
      flagCx.fillRect(sx, 0, 3, h);
      flagCx.globalCompositeOperation = "source-over";
    }
  }

  function frame(now) {
    if (!L.running) return;
    const t = (now - t0) / 1000;
    // No input for 2.5 s: a slow figure-eight so the scene still feels alive.
    if (now - lastInput > 2500) { tx = Math.sin(t * 0.35) * 0.55; ty = Math.sin(t * 0.7) * 0.25; }
    x += (tx - x) * 0.06; y += (ty - y) * 0.06;
    if (!reduced) {
      const unit = Math.min(window.innerWidth, 1600) * 0.012;
      for (const l of layers) {
        l.el.style.transform = "translate3d(" + (-x * l.d * unit).toFixed(2) + "px," + (-y * l.d * unit * 0.6).toFixed(2) + "px,0)";
      }
      drawFlag(t);
    }
    raf = requestAnimationFrame(frame);
  }

  // Loading finished: swap the bar for the button. Any click on the art, the
  // button, or any key enters (keys too, so arrow-key players never need a mouse).
  L.ready = function (onEnter) {
    $("loadBar").hidden = true;
    $("loadMsg").hidden = true;
    $("btnEnter").hidden = false;
    $("ldHint").hidden = !!(("ontouchstart" in window) || navigator.maxTouchPoints > 0);
    let done = false;
    function enter(e) {
      if (done) return;
      if (e && e.type === "keydown" && (e.metaKey || e.ctrlKey || e.altKey)) return;
      done = true;
      if (e && e.preventDefault) e.preventDefault();
      window.removeEventListener("keydown", enter);
      const root = $("loading");
      root.classList.add("out");
      setTimeout(function () { L.running = false; cancelAnimationFrame(raf); root.hidden = true; }, 650);
      onEnter();
    }
    $("loading").addEventListener("click", enter);
    window.addEventListener("keydown", enter);
  };

  L.start = start;
  HK.Landing = L;
  start();
})(globalThis.HK);
