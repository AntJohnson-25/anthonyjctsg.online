// three.js view: renderer, a late-afternoon city sky and skyline, the block
// (merged static geometry), street furniture, pickups, capture points,
// projectiles, tracers, muzzle flashes, particles and explosions, and the
// per-frame camera. Characters and guns live in models.js. Everything is
// procedural (canvas textures only). (Structure from Summit Protocol's view.)
globalThis.SP = globalThis.SP || {};
(function (SP) {
  "use strict";
  const THREE = globalThis.THREE;
  const M = SP.MAP;
  const V = { quality: "high" };

  // A low sun in the west-south-west behind the overcast: long, soft-edged shadows down the streets.
  const SUN = new THREE.Vector3(-0.62, 0.42, 0.5).normalize();
  const HORIZON = new THREE.Color(0x7d8580), ZENITH = new THREE.Color(0x3b4249);
  V.SUN = SUN;
  V.colorOf = function (sim, p) { return SP.FACTIONS[sim.factions[p.team]].color; };

  // ------------------------------------------------------------------ textures
  function canvasTex(w, h, draw, srgb) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    if (srgb !== false) grime(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }
  function rnd(seed) { let s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  // The whole block is under a cold overcast: every colour texture gets a damp, sooty wash and
  // rain streaks (source-atop: only where the texture already has pixels, so cut-outs stay clear).
  function grime(g, w, h) {
    const r = rnd(w * 31 + h * 7);
    g.save();
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = "rgba(30,38,42,0.34)"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < w / 4; i++) {
      const x = r() * w, y = r() * h * 0.6, len = 16 + r() * h * 0.5;
      const gr = g.createLinearGradient(0, y, 0, y + len);
      gr.addColorStop(0, "rgba(8,10,10,0)"); gr.addColorStop(0.35, "rgba(8,10,10," + (0.1 + r() * 0.2) + ")"); gr.addColorStop(1, "rgba(8,10,10,0)");
      g.fillStyle = gr; g.fillRect(x, y, 1 + r() * 2.5, len);
    }
    g.restore();
  }
  function noise(ctx, w, h, amt, seed) {
    const r = rnd(seed || 7), img = ctx.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (r() - 0.5) * amt;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }
  function stains(g, w, h, n, col, seed) {
    const r = rnd(seed);
    for (let i = 0; i < n; i++) {
      const x = r() * w, y = r() * h, rad = 6 + r() * 40;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, col); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  }
  function cracks(g, w, h, n, col, seed) {
    const r = rnd(seed);
    g.strokeStyle = col; g.lineWidth = 1.2;
    for (let i = 0; i < n; i++) {
      let x = r() * w, y = r() * h;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; g.lineTo(x, y); }
      g.stroke();
    }
  }
  // Running-bond brick: 8 courses per tile, each brick its own shade.
  function brick(base, mortar, seed) {
    return canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = mortar; g.fillRect(0, 0, w, h);
      const r = rnd(seed), c = new THREE.Color(base);
      for (let row = 0; row < 8; row++) {
        const off = row % 2 ? 32 : 0;
        for (let col = -1; col < 5; col++) {
          const k = 0.8 + r() * 0.35, x = col * 64 + off;
          g.fillStyle = "rgb(" + (c.r * 255 * k | 0) + "," + (c.g * 255 * k | 0) + "," + (c.b * 255 * k | 0) + ")";
          g.fillRect(x + 2, row * 32 + 2, 60, 28);
        }
      }
      noise(g, w, h, 22, seed + 1);
      stains(g, w, h, 6, "rgba(20,15,10,0.25)", seed + 2);
    });
  }
  const TEX = {};
  function makeTextures() {
    TEX.brick = brick(0x7e4030, "#6e675e", 3);
    TEX.brickdark = brick(0x5a3a2e, "#4f4a43", 5);
    TEX.brickred = brick(0x86593f, "#7d756a", 9);
    // Lap siding, faded and peeling.
    TEX.siding = canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = "#8ea3ad"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 8; i++) {
        g.fillStyle = "rgba(255,255,255,0.08)"; g.fillRect(0, i * 32, w, 12);
        g.fillStyle = "rgba(20,30,35,0.45)"; g.fillRect(0, i * 32 + 29, w, 3);
      }
      const r = rnd(21);
      for (let i = 0; i < 14; i++) { g.fillStyle = "rgba(205,195,175," + (0.5 + r() * 0.4) + ")"; g.fillRect(r() * w, (r() * 8 | 0) * 32 + 6, 8 + r() * 40, 6 + r() * 16); }
      noise(g, w, h, 18, 22);
      stains(g, w, h, 5, "rgba(40,45,40,0.3)", 23);
    });
    TEX.plaster = canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = "#c9b99c"; g.fillRect(0, 0, w, h);
      noise(g, w, h, 26, 31);
      stains(g, w, h, 8, "rgba(60,50,40,0.22)", 32);
      cracks(g, w, h, 4, "rgba(60,50,40,0.45)", 33);
    });
    TEX.asphalt = canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = "#3c3d3f"; g.fillRect(0, 0, w, h);
      const r = rnd(41);
      for (let i = 0; i < 900; i++) { g.fillStyle = r() < 0.5 ? "rgba(140,140,140,0.35)" : "rgba(15,15,15,0.4)"; g.fillRect(r() * w, r() * h, 2, 2); }
      noise(g, w, h, 16, 42);
      stains(g, w, h, 6, "rgba(10,10,10,0.35)", 43);
      cracks(g, w, h, 5, "rgba(15,15,15,0.7)", 44);
    });
    TEX.sidewalk = canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = "#a6a29b"; g.fillRect(0, 0, w, h);
      noise(g, w, h, 18, 51);
      stains(g, w, h, 7, "rgba(40,35,30,0.25)", 52);
      g.strokeStyle = "rgba(60,55,50,0.6)"; g.lineWidth = 2;
      g.strokeRect(1, 1, 127, 127); g.strokeRect(129, 1, 126, 127); g.strokeRect(1, 129, 127, 126); g.strokeRect(129, 129, 126, 126);
      cracks(g, w, h, 3, "rgba(50,45,40,0.6)", 53);
    });
    TEX.dirt = canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = "#6e5a44"; g.fillRect(0, 0, w, h);
      const r = rnd(61);
      for (let i = 0; i < 500; i++) { g.fillStyle = "rgba(" + (90 + r() * 80 | 0) + "," + (80 + r() * 60 | 0) + "," + (60 + r() * 50 | 0) + ",0.6)"; g.fillRect(r() * w, r() * h, 2 + r() * 3, 2 + r() * 3); }
      noise(g, w, h, 24, 62);
    });
    TEX.grass = canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = "#6f6a3e"; g.fillRect(0, 0, w, h);
      const r = rnd(71);
      for (let i = 0; i < 1400; i++) {
        g.strokeStyle = "rgba(" + (100 + r() * 70 | 0) + "," + (95 + r() * 55 | 0) + "," + (40 + r() * 30 | 0) + ",0.7)";
        const x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 4, y - 3 - r() * 6); g.stroke();
      }
      stains(g, w, h, 8, "rgba(90,70,45,0.5)", 72);
    });
    TEX.court = canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = "#3f6a52"; g.fillRect(0, 0, w, h);
      noise(g, w, h, 16, 81);
      stains(g, w, h, 5, "rgba(20,30,25,0.3)", 82);
      cracks(g, w, h, 3, "rgba(20,25,20,0.6)", 83);
    });
    TEX.tile = canvasTex(256, 256, function (g, w, h) {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? "#d9d4c6" : "#3a3a3a"; g.fillRect(x * 32, y * 32, 32, 32); }
      noise(g, w, h, 20, 91);
      stains(g, w, h, 8, "rgba(60,50,30,0.3)", 92);
    });
    TEX.tile2 = canvasTex(256, 256, function (g, w, h) {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { g.fillStyle = (x * 7 + y * 3) % 5 ? "#e4e8ea" : "#7fa6c4"; g.fillRect(x * 16 + 1, y * 16 + 1, 14, 14); }
      noise(g, w, h, 14, 93);
      stains(g, w, h, 6, "rgba(70,60,40,0.25)", 94);
    });
    TEX.plank = canvasTex(256, 256, function (g, w, h) {
      const r = rnd(13);
      for (let i = 0; i < 8; i++) {
        const t = r();
        g.fillStyle = "rgb(" + (110 + t * 30 | 0) + "," + (75 + t * 20 | 0) + "," + (45 + t * 10 | 0) + ")";
        g.fillRect(0, i * 32, w, 32);
        g.fillStyle = "rgba(40,22,10,0.55)"; g.fillRect(0, i * 32, w, 2);
      }
      noise(g, w, h, 14, 5);
      stains(g, w, h, 5, "rgba(20,15,10,0.35)", 6);
    });
    TEX.roof = canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = "#3a3734"; g.fillRect(0, 0, w, h);
      const r = rnd(101);
      for (let i = 0; i < 1200; i++) { g.fillStyle = "rgba(" + (120 + r() * 80 | 0) + "," + (115 + r() * 70 | 0) + "," + (100 + r() * 60 | 0) + ",0.4)"; g.fillRect(r() * w, r() * h, 2, 2); }
      stains(g, w, h, 6, "rgba(15,15,15,0.4)", 102);
    });
    TEX.concrete = canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = "#b5afa5"; g.fillRect(0, 0, w, h);
      noise(g, w, h, 18, 3);
      stains(g, w, h, 7, "rgba(40,35,30,0.25)", 111);
      cracks(g, w, h, 3, "rgba(50,45,40,0.5)", 112);
    });
    TEX.wood = canvasTex(256, 256, function (g, w, h) {
      const r = rnd(11);
      for (let i = 0; i < 8; i++) {
        const t = r();
        g.fillStyle = "rgb(" + (140 + t * 40 | 0) + "," + (100 + t * 26 | 0) + "," + (60 + t * 14 | 0) + ")";
        g.fillRect(i * 32, 0, 32, h);
        g.fillStyle = "rgba(50,28,12,0.5)"; g.fillRect(i * 32, 0, 2, h);
      }
      noise(g, w, h, 16, 2);
    });
    TEX.ply = canvasTex(128, 128, function (g, w, h) {
      g.fillStyle = "#a88a5c"; g.fillRect(0, 0, w, h);
      const r = rnd(121);
      for (let i = 0; i < 30; i++) { g.strokeStyle = "rgba(90,65,35," + (0.2 + r() * 0.3) + ")"; g.beginPath(); g.moveTo(0, r() * h); g.bezierCurveTo(w / 3, r() * h, w * 2 / 3, r() * h, w, r() * h); g.stroke(); }
      noise(g, w, h, 16, 122);
      stains(g, w, h, 3, "rgba(40,35,25,0.4)", 123);
    });
    TEX.burnt = canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = "#1f1b18"; g.fillRect(0, 0, w, h);
      const r = rnd(131);
      for (let i = 0; i < 60; i++) { g.fillStyle = "rgba(" + (60 + r() * 50 | 0) + "," + (40 + r() * 30 | 0) + ",25," + (0.3 + r() * 0.4) + ")"; g.fillRect(r() * w, r() * h, 2 + r() * 30, 1 + r() * 4); }
      noise(g, w, h, 20, 132);
    });
    TEX.metal = canvasTex(128, 128, function (g, w, h) {
      g.fillStyle = "#b8bdc2"; g.fillRect(0, 0, w, h);
      const r = rnd(141);
      for (let y = 0; y < h; y++) { g.fillStyle = "rgba(255,255,255," + (r() * 0.08) + ")"; g.fillRect(0, y, w, 1); }
      noise(g, w, h, 10, 12);
      stains(g, w, h, 4, "rgba(90,50,20,0.35)", 142);
    });
    TEX.corrugated = canvasTex(128, 128, function (g, w, h) {
      for (let x = 0; x < w; x++) { const s = 0.75 + 0.25 * Math.sin(x / 128 * Math.PI * 16); g.fillStyle = "rgba(" + (200 * s | 0) + "," + (200 * s | 0) + "," + (200 * s | 0) + ",1)"; g.fillRect(x, 0, 1, h); }
      stains(g, w, h, 6, "rgba(120,60,20,0.45)", 151);
      noise(g, w, h, 12, 152);
    });
    TEX.crate = canvasTex(256, 256, function (g, w, h) {
      const r = rnd(31);
      for (let i = 0; i < 6; i++) {
        const t = r();
        g.fillStyle = "rgb(" + (140 + t * 30 | 0) + "," + (104 + t * 20 | 0) + "," + (62 + t * 10 | 0) + ")";
        g.fillRect(0, i * 43, w, 43);
        g.fillStyle = "rgba(40,25,10,0.55)"; g.fillRect(0, i * 43, w, 3);
      }
      g.strokeStyle = "rgba(60,40,15,0.9)"; g.lineWidth = 16; g.strokeRect(8, 8, w - 16, h - 16);
      noise(g, w, h, 18, 6);
    });
    // Distant towers: a dark facade with a window grid, a few lit.
    // A tile = 4 floors x 4 bays (14 m); 128 px per bay. Punched windows with frames, sills, lintels,
    // a few lit warm, curtained, boarded or broken, and an air-conditioner here and there.
    function towerTile(seed, wall, glassA, glassB, curtain) {
      return canvasTex(512, 512, function (g, w, h) {
        const r = rnd(seed);
        g.fillStyle = wall; g.fillRect(0, 0, w, h);
        for (let fy = 0; fy < 4; fy++) for (let bx = 0; bx < 4; bx++) {
          const x = bx * 128, y = fy * 128;
          if (curtain) {
            // Glass curtain wall: dark spandrel at the floor line, mullions every bay.
            const gr = g.createLinearGradient(x, y, x + 128, y + 128);
            gr.addColorStop(0, glassA); gr.addColorStop(1, glassB);
            g.fillStyle = gr; g.fillRect(x + 3, y + 3, 122, 86);
            g.fillStyle = "rgba(10,14,18,0.85)"; g.fillRect(x, y + 90, 128, 38);
            g.fillStyle = "rgba(190,200,205,0.32)"; g.fillRect(x, y, 4, 128); g.fillRect(x, y, 128, 3);
            const q = r();
            if (q < 0.1) { g.fillStyle = "rgba(255,214,140,0.8)"; g.fillRect(x + 6, y + 6, 116, 80); }
            else if (q < 0.16) { g.fillStyle = "rgba(10,10,12,0.55)"; g.fillRect(x + 6, y + 6, 116, 80); }
            continue;
          }
          g.fillStyle = "rgba(0,0,0,0.22)"; g.fillRect(x + 22, y + 22, 84, 84);        // reveal shadow
          const q = r();
          const lit = q < 0.1, curt = q >= 0.1 && q < 0.22, board = q >= 0.22 && q < 0.27, broken = q >= 0.27 && q < 0.4;
          g.fillStyle = lit ? "rgba(255,206,130,0.92)" : "rgb(" + (24 + r() * 22 | 0) + "," + (30 + r() * 24 | 0) + "," + (38 + r() * 26 | 0) + ")";
          g.fillRect(x + 26, y + 26, 76, 76);
          if (curt) { g.fillStyle = "rgba(150,138,118,0.7)"; g.fillRect(x + 26, y + 26, 76, 36); }
          if (board) { g.fillStyle = "#4a3d2e"; for (let k = 0; k < 4; k++) g.fillRect(x + 24, y + 28 + k * 19, 80, 15); }
          if (broken) { g.strokeStyle = "rgba(210,220,225,0.55)"; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x + 26, y + 30); g.lineTo(x + 70, y + 64); g.lineTo(x + 100, y + 40); g.moveTo(x + 70, y + 64); g.lineTo(x + 60, y + 100); g.stroke(); }
          g.fillStyle = "rgba(205,205,198,0.5)"; g.fillRect(x + 62, y + 26, 4, 76); g.fillRect(x + 26, y + 62, 76, 3);   // sash bars
          g.fillStyle = "rgba(215,212,204,0.55)"; g.fillRect(x + 20, y + 102, 88, 7);                                       // sill
          g.fillStyle = "rgba(90,86,80,0.7)"; g.fillRect(x + 20, y + 18, 88, 6);                                            // lintel
          if (r() < 0.07) { g.fillStyle = "#b9bbb8"; g.fillRect(x + 36, y + 106, 56, 18); g.fillStyle = "rgba(0,0,0,0.5)"; g.fillRect(x + 40, y + 110, 48, 4); }   // AC box
        }
        noise(g, w, h, 12, seed + 1);
        stains(g, w, h, 10, "rgba(10,12,12,0.4)", seed + 2);
      });
    }
    TEX.towers = towerTile(161, "#4b4a4c", "", "", false);
    TEX.towers2 = towerTile(171, "#9a8f7e", "", "", false);
    TEX.towers3 = towerTile(181, "#3a4248", "#35566c", "#14232e", true);
    TEX.chain = canvasTex(128, 128, function (g, w, h) {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = "rgba(170,175,178,0.9)"; g.lineWidth = 1.6;
      for (let i = -8; i < 16; i++) {
        g.beginPath(); g.moveTo(i * 16, 0); g.lineTo(i * 16 + h, h); g.stroke();
        g.beginPath(); g.moveTo(i * 16 + h, 0); g.lineTo(i * 16, h); g.stroke();
      }
    }, false);
    TEX.glass = canvasTex(128, 128, function (g, w, h) {
      const gr = g.createLinearGradient(0, 0, w, h);
      gr.addColorStop(0, "#2a3540"); gr.addColorStop(0.5, "#46525c"); gr.addColorStop(1, "#1d252c");
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      noise(g, w, h, 10, 171);
    });
    TEX.dot = canvasTex(64, 64, function (g, w, h) {
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.45, "rgba(255,255,255,0.75)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }, false);
    TEX.smoke = canvasTex(64, 64, function (g, w, h) {
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, "rgba(255,255,255,0.9)"); gr.addColorStop(0.6, "rgba(255,255,255,0.35)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }, false);
    // Muzzle flash: a hot core with four spikes.
    TEX.flash = canvasTex(128, 128, function (g, w, h) {
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 40);
      gr.addColorStop(0, "rgba(255,255,240,1)"); gr.addColorStop(0.35, "rgba(255,210,120,0.9)"); gr.addColorStop(1, "rgba(255,140,40,0)");
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = "rgba(255,220,150,0.85)";
      [[64, 4, 6, 60], [64, 124, 6, 60], [4, 64, 60, 6], [124, 64, 60, 6]].forEach(function (s) {
        g.beginPath(); g.moveTo(s[0], s[1]); g.lineTo(64 + (s[0] === 64 ? 7 : 0), 64 + (s[1] === 64 ? 7 : 0)); g.lineTo(64 - (s[0] === 64 ? 7 : 0), 64 - (s[1] === 64 ? 7 : 0)); g.closePath(); g.fill();
      });
    }, false);
  }

  // ------------------------------------------------------------------ materials
  const MATDEF = {
    asphalt: { color: 0xffffff, tex: "asphalt", rough: 0.92, uv: 1 / 5 },
    sidewalk: { color: 0xffffff, tex: "sidewalk", rough: 0.9, uv: 1 / 3 },
    alley: { color: 0x8a847b, tex: "concrete", rough: 0.92, uv: 1 / 4 },
    kerb: { color: 0x9c978f, tex: "concrete", rough: 0.9, uv: 1 / 2 },
    paintY: { color: 0xd8b23a, rough: 0.8 },
    paintW: { color: 0xd9d6cc, rough: 0.8 },
    dirt: { color: 0xffffff, tex: "dirt", rough: 0.97, uv: 1 / 4 },
    deadgrass: { color: 0xffffff, tex: "grass", rough: 0.97, uv: 1 / 4 },
    court: { color: 0xffffff, tex: "court", rough: 0.85, uv: 1 / 6 },
    // A tile of brick is 0.75 m: courses ~9 cm, bricks ~19 cm, like the real thing.
    brick: { color: 0xffffff, tex: "brick", rough: 0.9, uv: 1 / 0.75 },
    brickdark: { color: 0xffffff, tex: "brickdark", rough: 0.92, uv: 1 / 0.75 },
    brickred: { color: 0xffffff, tex: "brickred", rough: 0.9, uv: 1 / 0.75 },
    siding: { color: 0xffffff, tex: "siding", rough: 0.8, uv: 1 / 2.4 },
    plaster: { color: 0xffffff, tex: "plaster", rough: 0.92, uv: 1 / 3 },
    plaster2: { color: 0xc8d6e0, tex: "plaster", rough: 0.92, uv: 1 / 3 },
    concrete: { color: 0xffffff, tex: "concrete", rough: 0.9, uv: 1 / 3 },
    slab: { color: 0xcfc8bd, tex: "concrete", rough: 0.9, uv: 1 / 3 },
    gallery: { color: 0x9d988f, tex: "concrete", rough: 0.9, uv: 1 / 2 },
    lowwall: { color: 0xbab3a8, tex: "concrete", rough: 0.9, uv: 1 / 2 },
    jersey: { color: 0xc9c3b8, tex: "concrete", rough: 0.9, uv: 1 / 2 },
    stair: { color: 0xa9a399, tex: "concrete", rough: 0.9, uv: 1 / 2 },
    steptop: { color: 0x8f8a82, rough: 0.92 },
    stoop: { color: 0x9a948b, tex: "concrete", rough: 0.9, uv: 1 / 2 },
    roof: { color: 0xffffff, tex: "roof", rough: 0.96, uv: 1 / 4 },
    plank: { color: 0xffffff, tex: "plank", rough: 0.8, uv: 1 / 2.5 },
    tile: { color: 0xffffff, tex: "tile", rough: 0.6, uv: 1 / 2.5 },
    tile2: { color: 0xffffff, tex: "tile2", rough: 0.5, uv: 1 / 2 },
    wood: { color: 0xffffff, tex: "wood", rough: 0.75, uv: 1 / 2.5 },
    burntwood: { color: 0xffffff, tex: "burnt", rough: 0.95, uv: 1 / 2.5 },
    rubble: { color: 0x7d766c, tex: "concrete", rough: 0.97, uv: 1 / 1.5 },
    crate: { color: 0xffffff, tex: "crate", rough: 0.8, uv: 1 / 1.2 },
    ply: { color: 0xffffff, tex: "ply", rough: 0.85, uv: 1 / 1.2 },
    steel: { color: 0x8f969c, tex: "metal", rough: 0.45, metal: 0.75, uv: 1 / 2 },
    post: { color: 0x2c2f33, rough: 0.6, metal: 0.4 },
    rail: { color: 0x3a3e42, rough: 0.55, metal: 0.5 },
    chain: { color: 0xffffff, tex: "chain", rough: 0.6, metal: 0.5, uv: 1 / 1.4, cutout: true },
    dumpster: { color: 0x2f5b3a, tex: "metal", rough: 0.6, metal: 0.4, uv: 1 / 2 },
    container: { color: 0x2d5f8a, tex: "corrugated", rough: 0.65, metal: 0.4, uv: 1 / 2.5 },
    drum: { color: 0x2b4f7a, rough: 0.55, metal: 0.4 },
    hvac: { color: 0xb7bbbd, tex: "metal", rough: 0.45, metal: 0.6, uv: 1 / 2 },
    shelf: { color: 0xc9ccc9, tex: "metal", rough: 0.5, metal: 0.4, uv: 1 / 2 },
    counter: { color: 0x6a4a2e, tex: "wood", rough: 0.7, uv: 1 / 2 },
    cooler: { color: 0xdfe6ec, emissive: 0x9fd0ff, emissiveI: 0.35, rough: 0.3 },
    washer: { color: 0xe9e9e4, rough: 0.35, metal: 0.2 },
    bench: { color: 0x7a5a3a, tex: "wood", rough: 0.8, uv: 1 / 2 },
    couch: { color: 0x5a4a6e, rough: 0.95 },
    mattress: { color: 0xb8b09a, rough: 0.95 },
    hydrant: { color: 0xb8241c, rough: 0.5, metal: 0.3 },
    busstop: { color: 0x9fb4c0, rough: 0.2, metal: 0.3, opacity: 0.45 },
    trunk: { color: 0x4a3a2c, rough: 0.95 },
    leaves: { color: 0x5c5a32, rough: 0.95 },
    glass: { color: 0x6c7880, tex: "glass", rough: 0.12, metal: 0.5, uv: 1, opacity: 0.94 },
    frame: { color: 0xd8d3c6, rough: 0.6 },
    framedark: { color: 0x2b2b2b, rough: 0.6, metal: 0.3 },
    sill: { color: 0xaaa399, rough: 0.85 },
    door: { color: 0x5a3b2a, rough: 0.7 },
    doorgreen: { color: 0x2f4a3c, rough: 0.6, metal: 0.3 },
    ac: { color: 0xc8c8c2, rough: 0.5, metal: 0.3 },
    tire: { color: 0x151515, rough: 0.9 },
    carRed: { color: 0x6e1c1c, rough: 0.35, metal: 0.5 },
    carBlue: { color: 0x1e3350, rough: 0.35, metal: 0.5 },
    carGray: { color: 0x6c7076, rough: 0.35, metal: 0.5 },
    carWhite: { color: 0xc9c8c2, rough: 0.35, metal: 0.4 },
    carBlack: { color: 0x1c1d20, rough: 0.3, metal: 0.5 },
    burnt: { color: 0xffffff, tex: "burnt", rough: 0.95, metal: 0.2, uv: 1 / 2 },
    chrome: { color: 0xc0c4c8, rough: 0.2, metal: 0.95 },
    soot: { color: 0x141210, rough: 1 },
    graveyard: { color: 0x8a8a70, tex: "grass", rough: 0.97, uv: 1 / 3 },
    headstone: { color: 0x9a9890, tex: "concrete", rough: 0.85, uv: 1 / 0.8 },
    stone: { color: 0x7d7a72, tex: "concrete", rough: 0.9, uv: 1 / 1.5 },
    pit: { color: 0x1c140e, rough: 1 },
    iron: { color: 0x1a1a1c, rough: 0.5, metal: 0.6 },
    taillight: { color: 0x8a1010, emissive: 0x5a0606, emissiveI: 0.6, rough: 0.3 },
    lamphead: { color: 0xf3e2bd, emissive: 0xffd9a0, emissiveI: 0.25, env: 0 },
    backboard: { color: 0xeeeeea, rough: 0.6 },
    rim: { color: 0xd8501c, rough: 0.5, metal: 0.5 },
    truckbox: { color: 0xd9d7d0, tex: "metal", rough: 0.5, metal: 0.3, uv: 1 / 3 },
    truckcab: { color: 0x7a1f1f, rough: 0.4, metal: 0.5 },
    // Towers: a 14 m tile of 4 floors x 4 bays (see makeTextures).
    towers: { color: 0xffffff, tex: "towers", rough: 0.85, uv: 1 / 14, env: 0.2 },
    towers2: { color: 0xd2c2a8, tex: "towers2", rough: 0.85, uv: 1 / 14, env: 0.2 },
    towers3: { color: 0xffffff, tex: "towers3", rough: 0.35, metal: 0.4, uv: 1 / 14, env: 0.7 },
    bag: { color: 0x14161a, rough: 0.35 },
    can: { color: 0x7d7f80, rough: 0.4, metal: 0.7 },
    rust: { color: 0x6b4630, tex: "metal", rough: 0.85, metal: 0.4, uv: 1 / 2 },
    fire: { color: 0xff7a1a, emissive: 0xff6a10, emissiveI: 2.6, rough: 1 },
    glowfloor: { color: 0xff7a30, emissive: 0xff6a20, emissiveI: 1.4, opacity: 0.2 },
    puddle: { color: 0x0d1114, rough: 0.04, metal: 0.9, env: 1.8 },
    beacon: { color: 0xff2a1a, emissive: 0xff2a1a, emissiveI: 3.0, rough: 0.4 },
    wire: { color: 0x0e0e0e, rough: 0.7 },
    clay: { color: 0x7a3c26, rough: 0.9 },
    barrelyellow: { color: 0xe9ae00, rough: 0.42 },
    barrelburnt: { color: 0x5a4a1a, rough: 0.8 },
    jerseyburnt: { color: 0x4a4744, tex: "concrete", rough: 0.95, uv: 1 / 2 },
  };
  const MAT = {};
  function material(key) {
    if (MAT[key]) return MAT[key];
    const d = MATDEF[key] || MATDEF.concrete;
    const m = new THREE.MeshStandardMaterial({
      color: d.color, roughness: d.rough !== undefined ? d.rough : 0.6, metalness: d.metal || 0,
      map: d.tex ? TEX[d.tex] : null
    });
    if (d.emissive) { m.emissive = new THREE.Color(d.emissive); m.emissiveIntensity = d.emissiveI || 1; }
    if (d.opacity !== undefined) { m.transparent = true; m.opacity = d.opacity; m.depthWrite = false; }
    if (d.cutout) { m.alphaTest = 0.4; m.side = THREE.DoubleSide; m.transparent = false; }
    if (d.env !== undefined) m.envMapIntensity = d.env;
    MAT[key] = m;
    return m;
  }
  V.material = material;

  // ------------------------------------------------------------------ static merge
  function Merger() { this.groups = {}; }
  Merger.prototype.push = function (key, pos, nor, from, to) {
    const grp = this.groups[key] || (this.groups[key] = { pos: [], nor: [], uv: [] });
    const s = (MATDEF[key] && MATDEF[key].uv) || 1;
    for (let i = from * 3; i < to * 3; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2], nx = nor[i], ny = nor[i + 1], nz = nor[i + 2];
      grp.pos.push(x, y, z); grp.nor.push(nx, ny, nz);
      const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
      if (ay >= ax && ay >= az) grp.uv.push(x * s, z * s);
      else if (ax >= az) grp.uv.push(z * s, y * s);
      else grp.uv.push(x * s, y * s);
    }
  };
  Merger.prototype.add = function (key, geo, matrix) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    this.push(key, g.attributes.position.array, g.attributes.normal.array, 0, g.attributes.position.count);
    g.dispose();
  };
  Merger.prototype.addBox = function (b) {
    const g = new THREE.BoxGeometry(b.hx * 2, b.maxy - b.miny, b.hz * 2).toNonIndexed();
    const m = new THREE.Matrix4().makeRotationY(-b.yaw).setPosition(b.cx, (b.miny + b.maxy) / 2, b.cz);
    g.applyMatrix4(m);
    const pos = g.attributes.position.array, nor = g.attributes.normal.array;
    for (let f = 0; f < 6; f++) {
      const key = f === 2 ? (b.top || b.mat) : f === 3 ? (b.bottom || b.mat) : (b.side || b.mat);
      this.push(key, pos, nor, f * 6, f * 6 + 6);
    }
    g.dispose();
  };
  Merger.prototype.build = function (parent, shadows) {
    const meshes = [];
    for (const key in this.groups) {
      const grp = this.groups[key];
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(grp.pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(grp.nor, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(grp.uv, 2));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, material(key));
      const transparent = MATDEF[key] && MATDEF[key].opacity !== undefined;
      mesh.castShadow = shadows !== false && !transparent;
      mesh.receiveShadow = !transparent;
      if (transparent) mesh.renderOrder = 2;
      parent.add(mesh);
      meshes.push(mesh);
    }
    return meshes;
  };

  function at(x, y, z, ry) { return new THREE.Matrix4().makeRotationY(ry || 0).setPosition(x, y, z); }
  const TMP = new THREE.Matrix4(), Q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
  function rod(mg, key, ax, ay, az, bx, by, bz, r, seg) {
    const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
    const d = b.clone().sub(a), len = d.length();
    const g = new THREE.CylinderGeometry(r, r, len, seg || 12, 1, false);
    Q.setFromUnitVectors(UP, d.normalize());
    TMP.compose(a.clone().add(b).multiplyScalar(0.5), Q, new THREE.Vector3(1, 1, 1));
    mg.add(key, g, TMP);
    g.dispose();
  }

  // Window dressing on a hole cut by map.js (frame + glass, boards, a broken
  // shopfront, bars). d: {axis, a, b, y0, y1, c, t}.
  function windowDecor(mg, d) {
    const len = d.b - d.a, h = d.y1 - d.y0, mid = (d.a + d.b) / 2, ym = (d.y0 + d.y1) / 2;
    // Place a thin box spanning `len` along the wall at offset o from the wall centre.
    function piece(key, along, w, y, hh, off, thick) {
      if (d.axis === "x") mg.add(key, new THREE.BoxGeometry(w, hh, thick), at(along, y, d.c + off));
      else mg.add(key, new THREE.BoxGeometry(thick, hh, w), at(d.c + off, y, along));
    }
    const half = d.t / 2;
    if (d.kind === "doorframe") {
      // Jambs, a lintel and a threshold on both faces; narrow doors may hang open off one hinge.
      [-1, 1].forEach(function (sgn) {
        piece("frame", d.a - 0.05, 0.1, ym, h, sgn * (half + 0.03), 0.07);
        piece("frame", d.b + 0.05, 0.1, ym, h, sgn * (half + 0.03), 0.07);
        piece("frame", mid, len + 0.2, d.y1 + 0.05, 0.1, sgn * (half + 0.03), 0.07);
        piece("sill", mid, len, d.y0 + 0.02, 0.04, sgn * (half + 0.05), 0.12);
      });
      const r = rnd(Math.round(d.a * 19 + d.c * 11));
      if (len < 1.7 && r() < 0.65) {
        const door = new THREE.BoxGeometry(d.axis === "x" ? len * 0.92 : 0.05, h - 0.06, d.axis === "x" ? 0.05 : len * 0.92);
        door.translate(d.axis === "x" ? len * 0.46 : 0, 0, d.axis === "x" ? 0 : len * 0.46);
        const ang = (r() < 0.5 ? 1 : -1) * (0.9 + r() * 0.7);
        const m = new THREE.Matrix4().makeRotationY(ang);
        m.setPosition(d.axis === "x" ? d.a : d.c, ym, d.axis === "x" ? d.c : d.a);
        mg.add(r() < 0.5 ? "door" : "doorgreen", door, m);
        door.dispose();
      }
    } else if (d.kind === "frame" || d.kind === "shopfront") {
      const fk = d.kind === "frame" ? "frame" : "framedark", fw = 0.07;
      [-1, 1].forEach(function (sgn) {
        piece(fk, mid, len + fw * 2, d.y1 + fw / 2, fw, sgn * (half + 0.02), 0.05);
        piece(fk, mid, len + fw * 2, d.y0 - fw / 2, fw, sgn * (half + 0.02), 0.05);
        piece(fk, d.a - fw / 2, fw, ym, h, sgn * (half + 0.02), 0.05);
        piece(fk, d.b + fw / 2, fw, ym, h, sgn * (half + 0.02), 0.05);
      });
      if (d.kind === "frame") {
        piece("sill", mid, len + 0.2, d.y0 - 0.06, 0.06, -half - 0.08, 0.16);
        piece("sill", mid, len + 0.2, d.y0 - 0.06, 0.06, half + 0.08, 0.16);
        piece("glass", mid, len, ym, h, 0, 0.02);
        piece("frame", mid, 0.05, ym, h, 0, 0.04);       // the sash bar
      } else {
        // Broken shop glass: jagged pieces left at the corners.
        const r = rnd(Math.round(d.a * 13 + d.c * 7));
        for (let k = 0; k < 5; k++) {
          const w = 0.2 + r() * 0.6, hh = 0.2 + r() * 0.5;
          const along = r() < 0.5 ? d.a + w / 2 : d.b - w / 2, y = r() < 0.5 ? d.y0 + hh / 2 : d.y1 - hh / 2;
          piece("glass", along, w, y, hh, 0, 0.015);
        }
      }
    } else if (d.kind === "boards") {
      const n = Math.max(2, Math.round(h / 0.32));
      const r = rnd(Math.round(d.a * 31 + d.c * 3));
      for (let k = 0; k < n; k++) {
        if (r() < 0.18) continue;          // a missing board: a gap to see (and shoot) through
        piece("ply", mid + (r() - 0.5) * 0.1, len + 0.25, d.y0 + (k + 0.5) * h / n, h / n * 0.82, -half - 0.03, 0.025);
      }
    } else if (d.kind === "bars") {
      for (let x = d.a + 0.12; x < d.b; x += 0.16) {
        if (d.axis === "x") rod(mg, "rail", x, d.y0, d.c - half - 0.04, x, d.y1, d.c - half - 0.04, 0.012, 5);
        else rod(mg, "rail", d.c - half - 0.04, d.y0, x, d.c - half - 0.04, d.y1, x, 0.012, 5);
      }
      piece("glass", mid, len, ym, h, 0, 0.02);
    }
  }

  // The projects' long faces: windows on every floor, and front doors with
  // air-conditioner boxes along the galleries on the street side.
  function facade(mg, d) {
    const r = rnd(Math.round(d.z * 17));
    const off = d.face * 0.04;
    d.floors.forEach(function (fy, fi) {
      for (let x = d.x0 + 1.6; x < d.x1 - 1; x += 3.5) {
        if (x > d.skip[0] - 1 && x < d.skip[1] + 1) continue;
        const door = d.face < 0 && fi > 0 && Math.round((x - d.x0) / 3.5) % 2 === 1;
        if (door) {
          mg.add(r() < 0.5 ? "doorgreen" : "door", new THREE.BoxGeometry(1.0, 2.1, 0.08), at(x, fy + 1.05, d.z + off));
          mg.add("frame", new THREE.BoxGeometry(1.2, 0.08, 0.1), at(x, fy + 2.14, d.z + off));
        } else {
          const boarded = r() < 0.38;
          mg.add(boarded ? "ply" : "glass", new THREE.BoxGeometry(1.3, 1.3, 0.06), at(x, fy + 1.75, d.z + off));
          mg.add("frame", new THREE.BoxGeometry(1.42, 0.07, 0.1), at(x, fy + 2.43, d.z + off));
          mg.add("sill", new THREE.BoxGeometry(1.5, 0.07, 0.18), at(x, fy + 1.07, d.z + d.face * 0.08));
          if (!boarded && r() < 0.3) mg.add("ac", new THREE.BoxGeometry(0.6, 0.4, 0.45), at(x + 0.2, fy + 1.3, d.z + d.face * 0.25));
        }
      }
    });
  }

  // ------------------------------------------------------------------ vehicles
  // Cars are side profiles (hood, raked windscreen, curved roof, boot, wheel
  // arches) extruded across the car's width with rounded (bevelled) edges, a
  // window band on top, and round wheels with hubs. Built once per shape, then
  // placed. Local frame: x along the car (+x = nose), y up, z across.
  function profile(pts, arches) {
    // pts: the outline as [x, y] from the rear bottom round over the top to the
    // front bottom; the bottom edge runs back with a wheel arch cut at each axle.
    const s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (p.length === 4) s.quadraticCurveTo(p[0], p[1], p[2], p[3]); else s.lineTo(p[0], p[1]);
    }
    const last = pts[pts.length - 1], y0 = last[last.length - 1];
    arches.slice().sort(function (a, b) { return b[0] - a[0]; }).forEach(function (a) {
      s.lineTo(a[0] + a[1], y0);
      s.absarc(a[0], y0, a[1], 0, Math.PI, false);
    });
    s.lineTo(pts[0][0], pts[0][1]);
    return s;
  }
  function extrude(shape, width, bevel) {
    const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
    g.translate(0, 0, -(width - bevel * 2) / 2);
    g.computeVertexNormals();
    return g;
  }
  const VEH = {};
  function vehicleShapes() {
    if (VEH.sedan) return VEH;
    // Each vehicle: the lower body up to the beltline (with wheel arches), a
    // tinted glass cabin above it, and a painted roof panel on the glass.
    // Sedan: 4.6 m long, 1.8 m wide, 1.43 m tall.
    VEH.sedan = {
      body: extrude(profile([[-2.28, 0.32], [-2.32, 0.62], [-2.3, 0.86, -2.12, 0.94], [-1.5, 0.99], [-1.1, 1.0], [1.1, 1.0], [2.0, 0.88], [2.34, 0.82, 2.36, 0.6], [2.32, 0.32]],
        [[1.38, 0.42], [-1.38, 0.42]]), 1.78, 0.07),
      glass: extrude(profile([[-1.08, 0.98], [-0.68, 1.36, -0.2, 1.39], [0.28, 1.39], [0.62, 1.37, 1.08, 0.98]], []), 1.62, 0.04),
      roof: extrude(profile([[-0.75, 1.3], [-0.5, 1.44, -0.15, 1.44], [0.3, 1.44], [0.55, 1.43, 0.75, 1.3]], []), 1.56, 0.04),
      wheels: [[1.38, 0.33], [-1.38, 0.33]], track: 0.78, lights: 2.3, len: 4.6
    };
    // Small SUV: taller, a near-vertical tailgate.
    VEH.suv = {
      body: extrude(profile([[-2.15, 0.36], [-2.2, 0.7], [-2.2, 1.06, -2.05, 1.08], [1.18, 1.08], [2.0, 0.98], [2.3, 0.92, 2.3, 0.65], [2.26, 0.36]],
        [[1.4, 0.45], [-1.35, 0.45]]), 1.86, 0.08),
      glass: extrude(profile([[-2.08, 1.06], [-2.04, 1.6], [0.3, 1.62], [0.66, 1.6, 1.14, 1.06]], []), 1.7, 0.04),
      roof: extrude(profile([[-2.05, 1.55], [-2.02, 1.71], [0.3, 1.71], [0.5, 1.7, 0.65, 1.55]], []), 1.66, 0.04),
      wheels: [[1.4, 0.36], [-1.35, 0.36]], track: 0.8, lights: 2.25, len: 4.5
    };
    // Box truck cab (the cargo box is a rounded block behind it).
    VEH.cab = {
      body: extrude(profile([[-0.9, 0.5], [-0.9, 1.45], [0.95, 1.4], [1.06, 1.3, 1.06, 0.95], [1.02, 0.5]], [[0.2, 0.5]]), 2.25, 0.1),
      glass: extrude(profile([[-0.85, 1.42], [-0.85, 2.3], [0.3, 2.3], [0.55, 2.25, 0.92, 1.42]], []), 2.1, 0.04),
      roof: extrude(profile([[-0.9, 2.25], [-0.9, 2.48], [0.25, 2.48], [0.45, 2.46, 0.6, 2.25]], []), 2.2, 0.05)
    };
    VEH.box = extrude((function () { const s = new THREE.Shape(); s.moveTo(-2.3, 0.75); s.lineTo(-2.3, 3.1); s.lineTo(2.3, 3.1); s.lineTo(2.3, 0.75); s.lineTo(-2.3, 0.75); return s; })(), 2.35, 0.08);
    return VEH;
  }
  function placeAt(x, z, yaw, lx, ly, lz) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return new THREE.Matrix4().makeRotationY(-yaw).setPosition(x + lx * c - lz * s, ly, z + lx * s + lz * c);
  }
  // A road wheel: tyre, hub and a lip, axle across the car.
  function roundWheel(mg, x, z, yaw, lx, lz, r, hubKey) {
    const tyre = new THREE.CylinderGeometry(r, r, 0.24, 20);
    tyre.rotateX(Math.PI / 2);
    mg.add("tire", tyre, placeAt(x, z, yaw, lx, r, lz));
    const hub = new THREE.CylinderGeometry(r * 0.58, r * 0.6, 0.02, 16);
    hub.rotateX(Math.PI / 2);
    mg.add(hubKey, hub, placeAt(x, z, yaw, lx, r, lz + Math.sign(lz) * 0.125));
  }
  function lamp(mg, key, x, z, yaw, lx, ly, lz, s) {
    const g = new THREE.SphereGeometry(1, 10, 8);
    g.scale(0.05, s * 0.09, s * 0.16);
    mg.add(key, g, placeAt(x, z, yaw, lx, ly, lz));
  }
  const CAR_COLS = ["carRed", "carBlue", "carGray", "carWhite", "carBlack"];
  function carDecor(mg, d) {
    const S = vehicleShapes(), shape = d.c % 3 === 1 ? S.suv : S.sedan;
    const key = d.burnt ? "burnt" : CAR_COLS[d.c % CAR_COLS.length], x = d.x, z = d.z, y = d.yaw;
    const m = placeAt(x, z, y, 0, 0, 0);
    mg.add(key, shape.body, m);
    mg.add(d.burnt ? "soot" : "glass", shape.glass, m);
    mg.add(key, shape.roof, m);
    shape.wheels.forEach(function (w) {
      [1, -1].forEach(function (sg) { if (!d.burnt || w[0] > 0) roundWheel(mg, x, z, y, w[0], sg * shape.track, w[1], d.burnt ? "burnt" : "chrome"); });
    });
    if (!d.burnt) {
      [0.58, -0.58].forEach(function (lz) {
        lamp(mg, "lamphead", x, z, y, shape.lights, 0.74, lz, 1);
        lamp(mg, "taillight", x, z, y, -shape.lights - 0.02, 0.8, lz, 0.9);
      });
      const bump = new THREE.CapsuleGeometry(0.07, 1.55, 4, 8);
      bump.rotateX(Math.PI / 2);
      mg.add("carBlack", bump, placeAt(x, z, y, shape.len / 2 - 0.02, 0.42, 0));
      mg.add("carBlack", bump, placeAt(x, z, y, -shape.len / 2 + 0.02, 0.42, 0));
    }
  }
  function truckDecor(mg, d) {
    const S = vehicleShapes(), x = d.x, z = d.z, y = d.yaw;
    mg.add("truckbox", S.box, placeAt(x, z, y, -0.8, 0, 0));
    mg.add("truckcab", S.cab.body, placeAt(x, z, y, 2.3, 0, 0));
    mg.add("glass", S.cab.glass, placeAt(x, z, y, 2.3, 0, 0));
    mg.add("truckcab", S.cab.roof, placeAt(x, z, y, 2.3, 0, 0));
    const chassis = new THREE.CapsuleGeometry(0.12, 6.0, 4, 8);
    chassis.rotateZ(Math.PI / 2);
    mg.add("carBlack", chassis, placeAt(x, z, y, 0.3, 0.55, 0.7));
    mg.add("carBlack", chassis, placeAt(x, z, y, 0.3, 0.55, -0.7));
    [[2.5, 1.0], [2.5, -1.0], [-1.6, 1.0], [-1.6, -1.0], [-2.65, 1.0], [-2.65, -1.0]].forEach(function (w) { roundWheel(mg, x, z, y, w[0], w[1], 0.46, "chrome"); });
    [0.8, -0.8].forEach(function (lz) { lamp(mg, "lamphead", x, z, y, 3.37, 0.9, lz, 1.2); });
  }
  function treeDecor(mg, d) {
    const r = rnd(Math.round(d.x * 7 + d.z * 3));
    mg.add("trunk", new THREE.CylinderGeometry(0.14, 0.27, 3.2, 16, 4), at(d.x, 1.6, d.z));
    for (let k = 0; k < (d.bare ? 7 : 5); k++) {
      const a = r() * Math.PI * 2, y0 = 2.2 + r() * 1.2, l = 1.2 + r() * 1.2;
      const ex = d.x + Math.cos(a) * l, ey = y0 + 0.8 + r() * 0.8, ez = d.z + Math.sin(a) * l;
      rod(mg, "trunk", d.x, y0, d.z, ex, ey, ez, 0.06, 5);
      if (d.bare) rod(mg, "trunk", ex, ey, ez, ex + Math.cos(a + 0.8) * 0.7, ey + 0.6, ez + Math.sin(a + 0.8) * 0.7, 0.03, 4);
      else if (r() < 0.7) mg.add("leaves", new THREE.IcosahedronGeometry(0.7 + r() * 0.5, 1), at(ex, y0 + 1.3, ez, r() * 3));
    }
  }

  // ------------------------------------------------------------------ detail pass
  // Everything map.js only names ("cornice", "bags", "watertank"...): real geometry with plenty of
  // segments, merged with the rest of the block. detail() returns true when it handled the entry.

  // The company seal: one texture, two merged meshes (weathered paint, lit boards), built from quads.
  const LG = { paint: { pos: [], nor: [], uv: [] }, board: { pos: [], nor: [], uv: [] }, tex: null };
  function logoTexture() {
    if (LG.tex) return LG.tex;
    const img = new Image(), t = new THREE.Texture(img);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    img.onload = function () { t.needsUpdate = true; };
    img.src = SP.LOGO_URL || "";
    LG.tex = t;
    return t;
  }
  // c = centre, r = the quad's right, u = its up (unit vectors), n = its normal, w = width.
  function logoQuad(list, cx, cy, cz, r, u, n, w) {
    const hw = w / 2, L = list;
    const P = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (k) {
      return [cx + r[0] * hw * k[0] + u[0] * hw * k[1], cy + r[1] * hw * k[0] + u[1] * hw * k[1], cz + r[2] * hw * k[0] + u[2] * hw * k[1]];
    });
    const UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
    [0, 1, 2, 0, 2, 3].forEach(function (i) { L.pos.push(P[i][0], P[i][1], P[i][2]); L.nor.push(n[0], n[1], n[2]); L.uv.push(UV[i][0], UV[i][1]); });
  }
  // On a wall: facing (nx, nz).
  function logoWall(list, x, y, z, nx, nz, w) {
    const m = Math.hypot(nx, nz) || 1; nx /= m; nz /= m;
    logoQuad(list, x, y, z, [nz, 0, -nx], [0, 1, 0], [nx, 0, nz], w);
  }
  function logoFloor(list, x, y, z, rot, w) {
    const c = Math.cos(rot), s = Math.sin(rot);
    logoQuad(list, x, y, z, [c, 0, s], [s, 0, -c], [0, 1, 0], w);
  }
  function buildLogos(parent) {
    const t = logoTexture();
    const mats = {
      paint: new THREE.MeshStandardMaterial({ map: t, color: 0xf2f5f5, roughness: 0.85, alphaTest: V.msaa ? 0.05 : 0.5, alphaToCoverage: !!V.msaa, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      board: new THREE.MeshStandardMaterial({ map: t, color: 0xffffff, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.65, roughness: 0.7, alphaTest: V.msaa ? 0.05 : 0.5, alphaToCoverage: !!V.msaa, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    };
    ["paint", "board"].forEach(function (k) {
      const L = LG[k];
      if (!L.pos.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(L.pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(L.nor, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(L.uv, 2));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mats[k]);
      m.receiveShadow = true; m.renderOrder = 1; m.frustumCulled = false;
      parent.add(m);
    });
  }
  V.LOGO_MESHES = buildLogos;

  // A strip along a wall: axis "x" runs a..b at z = c (out is +/-z), axis "z" runs a..b at x = c.
  function strip(mg, key, axis, a, b, c, y, hh, off, thick) {
    if (axis === "x") mg.add(key, new THREE.BoxGeometry(b - a, hh, thick), at((a + b) / 2, y, c + off));
    else mg.add(key, new THREE.BoxGeometry(thick, hh, b - a), at(c + off, y, (a + b) / 2));
  }
  // A ring of small boxes round a cylinder-ish thing, for hoops and ribs.
  function hoop(mg, key, x, y, z, r, tube) {
    const t = new THREE.TorusGeometry(r, tube, 8, 28);
    t.rotateX(Math.PI / 2);
    mg.add(key, t, at(x, y, z));
    t.dispose();
  }
  function lerp3(a, b, u) { return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]; }

  // The New Jersey barrier profile (across = x, up = y) extruded len metres along local x.
  function jerseyGeo(len) {
    const sh = new THREE.Shape();
    [[-0.3, 0], [0.3, 0], [0.3, 0.18], [0.23, 0.46], [0.1, 0.85], [-0.1, 0.85], [-0.23, 0.46], [-0.3, 0.18]].forEach(function (p, i) { if (i) sh.lineTo(p[0], p[1]); else sh.moveTo(p[0], p[1]); });
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2 });
    g.translate(0, 0, -len / 2);
    g.rotateY(Math.PI / 2);
    return g;
  }
  function detail(mg, d) {
    switch (d.kind) {
      case "logo": {
        const list = d.board ? LG.board : LG.paint;
        if (d.ground) logoFloor(list, d.x, d.y, d.z, d.rot || 0, d.w); else logoWall(list, d.x, d.y, d.z, d.nx, d.nz, d.w);
        return true;
      }
      case "billboard": {
        // A double-sided lit board on two steel posts, the seal on both faces.
        const n = Math.hypot(d.nx, d.nz) || 1, nx = d.nx / n, nz = d.nz / n, th = Math.atan2(nx, nz), s = d.w, cy = d.y + 1.4 + s / 2;
        const rx = nz, rz = -nx;
        mg.add("framedark", new THREE.BoxGeometry(s + 0.3, s + 0.3, 0.16), at(d.x, cy, d.z, th));
        [-0.32, 0.32].forEach(function (o) { rod(mg, "post", d.x + rx * s * o, d.y, d.z + rz * s * o, d.x + rx * s * o, cy - s / 2, d.z + rz * s * o, 0.07, 12); });
        rod(mg, "post", d.x - rx * s * 0.32, d.y + 0.6, d.z - rz * s * 0.32, d.x + rx * s * 0.32, d.y + 0.6, d.z + rz * s * 0.32, 0.04, 8);
        logoWall(LG.board, d.x + nx * 0.09, cy, d.z + nz * 0.09, nx, nz, s);
        logoWall(LG.board, d.x - nx * 0.09, cy, d.z - nz * 0.09, -nx, -nz, s);
        return true;
      }
      case "cornice": {
        // Stepped brick corbels under the roofline, a row of dentils, and a projecting lip.
        const a = d.a, b = d.b, len = b - a, f = d.face;
        for (let s = 0; s < 3; s++) strip(mg, "sill", d.axis, a - 0.04 * s, b + 0.04 * s, d.c, d.y - 0.07 - s * 0.075, 0.075, f * (0.04 + s * 0.045), 0.1 + s * 0.09);
        const n = V.lowDetail ? 0 : Math.max(2, Math.round(len / 0.24));
        for (let i = 0; i < n; i++) {
          const u = a + (i + 0.5) * len / n;
          if (d.axis === "x") mg.add("sill", new THREE.BoxGeometry(0.11, 0.1, 0.12), at(u, d.y - 0.34, d.c + f * 0.08));
          else mg.add("sill", new THREE.BoxGeometry(0.12, 0.1, 0.11), at(d.c + f * 0.08, d.y - 0.34, u));
        }
        strip(mg, "stone", d.axis, a - 0.08, b + 0.08, d.c, d.y + 0.03, 0.12, f * 0.13, 0.3);
        return true;
      }
      case "pipe": {
        rod(mg, "rail", d.x, d.y0, d.z, d.x, d.y1 - 0.05, d.z, 0.055, 14);
        const e = new THREE.SphereGeometry(0.075, 12, 8);
        mg.add("rail", e, at(d.x, d.y1 - 0.05, d.z)); e.dispose();
        for (let y = d.y0 + 0.6; y < d.y1 - 0.3; y += 1.5) hoop(mg, "rail", d.x, y, d.z, 0.075, 0.016);
        const m = new THREE.CylinderGeometry(0.1, 0.07, 0.3, 14);
        mg.add("rail", m, at(d.x, d.y0 + 0.15, d.z)); m.dispose();
        return true;
      }
      case "chimneycap": {
        mg.add("stone", new THREE.BoxGeometry(1.25, 0.12, 1.25), at(d.x, d.y + 0.06, d.z));
        [-0.28, 0.28].forEach(function (o) {
          const pot = new THREE.CylinderGeometry(0.13, 0.17, 0.45, 16);
          mg.add("clay", pot, at(d.x + o, d.y + 0.34, d.z)); pot.dispose();
          const lip = new THREE.TorusGeometry(0.14, 0.03, 8, 16); lip.rotateX(Math.PI / 2);
          mg.add("clay", lip, at(d.x + o, d.y + 0.57, d.z)); lip.dispose();
        });
        return true;
      }
      case "fan": {
        // A rooftop air-handler's fan: ring, grille bars and five blades.
        const cyl = new THREE.CylinderGeometry(0.42, 0.42, 0.1, 28);
        mg.add("hvac", cyl, at(d.x, d.y + 0.05, d.z)); cyl.dispose();
        hoop(mg, "framedark", d.x, d.y + 0.11, d.z, 0.4, 0.03);
        for (let i = 0; i < 5; i++) mg.add("framedark", new THREE.BoxGeometry(0.36, 0.012, 0.07), new THREE.Matrix4().makeRotationY(i * 1.2566).setPosition(d.x, d.y + 0.1, d.z));
        for (let k = -2; k <= 2; k++) mg.add("framedark", new THREE.BoxGeometry(0.8, 0.012, 0.015), at(d.x, d.y + 0.125, d.z + k * 0.16));
        return true;
      }
      case "watertank": {
        // A wooden-stave tank on steel legs, hoops and a conical lid; rust running down it.
        const base = d.y + 1.4;
        [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]].forEach(function (o) { rod(mg, "rust", d.x + o[0], d.y, d.z + o[1], d.x + o[0] * 0.9, base, d.z + o[1] * 0.9, 0.06, 10); });
        rod(mg, "rust", d.x - 0.8, d.y + 0.7, d.z - 0.8, d.x + 0.8, d.y + 0.7, d.z + 0.8, 0.03, 8);
        rod(mg, "rust", d.x + 0.8, d.y + 0.7, d.z - 0.8, d.x - 0.8, d.y + 0.7, d.z + 0.8, 0.03, 8);
        const tank = new THREE.CylinderGeometry(1.0, 1.0, 1.9, 32, 3);
        mg.add("rust", tank, at(d.x, base + 0.95, d.z)); tank.dispose();
        [0.15, 0.7, 1.25, 1.75].forEach(function (y) { hoop(mg, "framedark", d.x, base + y, d.z, 1.02, 0.03); });
        const lid = new THREE.ConeGeometry(1.1, 0.6, 32);
        mg.add("rust", lid, at(d.x, base + 2.2, d.z)); lid.dispose();
        rod(mg, "rail", d.x + 1.05, base - 0.2, d.z, d.x + 1.05, base + 1.9, d.z, 0.02, 6);
        return true;
      }
      case "dish": {
        // A satellite dish on a short arm, angled up and out.
        rod(mg, "rail", d.x, d.y - 0.5, d.z, d.x, d.y, d.z, 0.03, 8);
        const dish = new THREE.CylinderGeometry(0.42, 0.05, 0.14, 24);
        const rot = new THREE.Matrix4().makeRotationY(-d.yaw).multiply(new THREE.Matrix4().makeRotationX(-1.0));   // opens up and toward yaw (0 = north, PI = south)
        const dir = new THREE.Vector3(0, 1, 0).applyMatrix4(rot);
        mg.add("ac", dish, rot.clone().setPosition(d.x, d.y + 0.15, d.z)); dish.dispose();
        rod(mg, "rail", d.x, d.y + 0.15, d.z, d.x + dir.x * 0.5, d.y + 0.15 + dir.y * 0.5, d.z + dir.z * 0.5, 0.012, 5);
        return true;
      }
      case "tombtop": {
        const top = new THREE.CylinderGeometry(d.w / 2, d.w / 2, d.d + 0.01, 20);
        top.rotateX(Math.PI / 2);
        mg.add("stone", top, at(d.x, d.y, d.z)); top.dispose();
        return true;
      }
      case "bags": {
        // Split bin bags, a flattened carton, a couple of crushed cans.
        const r = rnd(d.seed || 1);
        for (let k = 0; k < d.n; k++) {
          const g = new THREE.IcosahedronGeometry(0.26 + r() * 0.16, V.lowDetail ? 1 : 2);
          g.scale(1, 0.7 + r() * 0.2, 1);
          mg.add("bag", g, at(d.x + (r() - 0.5) * 1.5, 0.17, d.z + (r() - 0.5) * 1.5, r() * 6)); g.dispose();
        }
        const car = new THREE.BoxGeometry(0.5, 0.05, 0.38);
        mg.add("crate", car, at(d.x + (r() - 0.5) * 1.2, 0.03, d.z + (r() - 0.5) * 1.2, r() * 3)); car.dispose();
        for (let k = 0; k < 3; k++) {
          const can = new THREE.CylinderGeometry(0.035, 0.035, 0.11, 12);
          can.rotateZ(Math.PI / 2);
          mg.add("can", can, at(d.x + (r() - 0.5) * 2, 0.04, d.z + (r() - 0.5) * 2, r() * 6)); can.dispose();
        }
        return true;
      }
      case "tires": {
        const r = rnd(d.seed || 1);
        for (let k = 0; k < d.n; k++) {
          const t = new THREE.TorusGeometry(0.3, 0.12, 12, 28); t.rotateX(Math.PI / 2);
          mg.add("tire", t, at(d.x + (r() - 0.5) * 0.15, 0.12 + k * 0.24, d.z + (r() - 0.5) * 0.15, r() * 3)); t.dispose();
        }
        return true;
      }
      case "barrelfire": {
        // An oil drum with a fire in it: ribs, glowing flames, and a warm pool of light on the ground.
        const drum = new THREE.CylinderGeometry(0.3, 0.3, 0.92, 24, 1, true);
        mg.add("drum", drum, at(d.x, 0.46, d.z)); drum.dispose();
        [0.15, 0.46, 0.77].forEach(function (y) { hoop(mg, "framedark", d.x, y, d.z, 0.305, 0.018); });
        const lid = new THREE.CylinderGeometry(0.29, 0.29, 0.02, 24); mg.add("framedark", lid, at(d.x, 0.1, d.z)); lid.dispose();
        const pool = new THREE.CircleGeometry(2.2, 32); pool.rotateX(-Math.PI / 2);
        mg.add("glowfloor", pool, at(d.x, 0.045, d.z)); pool.dispose();
        return true;
      }
      case "trolley": {
        if (V.lowDetail) return true;
        // A shopping trolley on its side-ish: wire basket, handle, four little wheels.
        const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
        function P(lx, y, lz) { return [d.x + lx * c - lz * s, y, d.z + lx * s + lz * c]; }
        function wire(a, b) { rod(mg, "chrome", a[0], a[1], a[2], b[0], b[1], b[2], 0.008, 6); }
        const B = [[-0.4, 0.4, -0.25], [0.4, 0.4, -0.25], [0.4, 0.4, 0.25], [-0.4, 0.4, 0.25]], T = [[-0.5, 0.85, -0.28], [0.5, 0.85, -0.28], [0.5, 0.85, 0.28], [-0.5, 0.85, 0.28]];
        for (let i = 0; i < 4; i++) {
          wire(P(B[i][0], B[i][1], B[i][2]), P(B[(i + 1) % 4][0], B[(i + 1) % 4][1], B[(i + 1) % 4][2]));
          wire(P(T[i][0], T[i][1], T[i][2]), P(T[(i + 1) % 4][0], T[(i + 1) % 4][1], T[(i + 1) % 4][2]));
          wire(P(B[i][0], B[i][1], B[i][2]), P(T[i][0], T[i][1], T[i][2]));
        }
        for (let k = 0; k <= 4; k++) { const u = -0.4 + k * 0.2; wire(P(u, 0.4, -0.25), P(u * 1.2, 0.85, -0.28)); wire(P(u, 0.4, 0.25), P(u * 1.2, 0.85, 0.28)); }
        wire(P(-0.5, 0.85, -0.28), P(-0.62, 0.95, -0.28)); wire(P(-0.5, 0.85, 0.28), P(-0.62, 0.95, 0.28)); wire(P(-0.62, 0.95, -0.28), P(-0.62, 0.95, 0.28));
        [[-0.38, -0.22], [0.38, -0.22], [-0.38, 0.22], [0.38, 0.22]].forEach(function (w) {
          const t = new THREE.TorusGeometry(0.05, 0.016, 6, 12); t.rotateX(Math.PI / 2); t.rotateY(-d.yaw);
          const p = P(w[0], 0.06, w[1]); mg.add("tire", t, at(p[0], p[1], p[2])); t.dispose();
        });
        return true;
      }
      case "puddle": {
        // Rain-water on the asphalt: near-black, mirror-bright against the overcast sky.
        const r = rnd((d.seed || 1) * 17 + 5), base = d.r || 1;
        const g = new THREE.CircleGeometry(1, 24); g.rotateX(-Math.PI / 2);
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) { const k = 0.75 + 0.35 * Math.sin(i * 2.4 + (d.seed || 0)) * r(); pos.setX(i, pos.getX(i) * base * 1.4 * k); pos.setZ(i, pos.getZ(i) * base * k); }
        mg.add("puddle", g, at(d.x, 0.022, d.z, r() * 3)); g.dispose();
        return true;
      }
      case "hydrant": {
        const body = new THREE.CylinderGeometry(0.13, 0.15, 0.5, 20); mg.add("hydrant", body, at(d.x, 0.35, d.z)); body.dispose();
        const dome = new THREE.SphereGeometry(0.14, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2); mg.add("hydrant", dome, at(d.x, 0.6, d.z)); dome.dispose();
        const base = new THREE.CylinderGeometry(0.19, 0.2, 0.1, 20); mg.add("hydrant", base, at(d.x, 0.05, d.z)); base.dispose();
        [-1, 1].forEach(function (s) { const n = new THREE.CylinderGeometry(0.05, 0.05, 0.14, 12); n.rotateZ(Math.PI / 2); mg.add("chrome", n, at(d.x + s * 0.17, 0.4, d.z)); n.dispose(); });
        const cap = new THREE.CylinderGeometry(0.05, 0.05, 0.1, 12); cap.rotateX(Math.PI / 2); mg.add("chrome", cap, at(d.x, 0.4, d.z + 0.15)); cap.dispose();
        return true;
      }
      case "jersey": {
        // A New Jersey highway barrier: the sloped-and-stepped concrete profile, len m long, with
        // lifting-pin slots and a faded yellow reflector.
        const L = d.len || 3;
        mg.add("jersey", jerseyGeo(L), at(d.x, 0, d.z, -d.yaw));
        return true;
      }
      case "hwy": {
        // Roadworks: one jersey barrier and three yellow water-filled crash barrels in a row at its end.
        const c = Math.cos(d.yaw), s = Math.sin(d.yaw), ry = -d.yaw, key = d.burnt ? "jerseyburnt" : "jersey", bk = d.burnt ? "barrelburnt" : "barrelyellow";
        mg.add(key, jerseyGeo(2.7), at(d.x - c * 1.05, 0, d.z - s * 1.05, ry));
        [0.75, 1.5, 2.25].forEach(function (o, i) {
          const x = d.x + c * o, z = d.z + s * o;
          const body = new THREE.CylinderGeometry(0.31, 0.34, 0.95, 28, 3); mg.add(bk, body, at(x, 0.475, z)); body.dispose();
          const shoulder = new THREE.CylinderGeometry(0.3, 0.31, 0.06, 28); mg.add(bk, shoulder, at(x, 0.98, z)); shoulder.dispose();
          const cap = new THREE.CylinderGeometry(0.1, 0.11, 0.07, 16); mg.add("framedark", cap, at(x + 0.12, 1.04, z + 0.05)); cap.dispose();
          [0.2, 0.47, 0.74].forEach(function (y) { hoop(mg, d.burnt ? "soot" : "framedark", x, y, z, 0.345, 0.014); });      // moulded ribs
          const rim = new THREE.TorusGeometry(0.31, 0.022, 8, 28); rim.rotateX(Math.PI / 2); mg.add(bk, rim, at(x, 0.95, z)); rim.dispose();
        });
        return true;
      }
      case "stash": {
        // The stash table: plank top on four legs, a cloth, an old work lamp on a stand at one end.
        mg.add("wood", new THREE.BoxGeometry(1.7, 0.07, 0.9), at(d.x, 0.765, d.z));
        mg.add("slab", new THREE.BoxGeometry(1.62, 0.012, 0.82), at(d.x, 0.805, d.z));
        [[-0.78, -0.4], [0.78, -0.4], [-0.78, 0.4], [0.78, 0.4]].forEach(function (o) { mg.add("wood", new THREE.BoxGeometry(0.07, 0.73, 0.07), at(d.x + o[0], 0.365, d.z + o[1])); });
        rod(mg, "rail", d.x + 0.95, 0, d.z - 0.55, d.x + 0.95, 1.5, d.z - 0.55, 0.018, 8);
        mg.add("lamphead", new THREE.BoxGeometry(0.22, 0.12, 0.22), at(d.x + 0.95, 1.55, d.z - 0.55));
        return true;
      }
      case "pole": {
        // A wooden power pole: taper, two crossarms with insulators, a transformer can.
        const p = new THREE.CylinderGeometry(0.1, 0.16, d.h, 16, 3); mg.add("trunk", p, at(d.x, d.h / 2, d.z)); p.dispose();
        const arm1 = new THREE.BoxGeometry(0.12, 0.12, 1.5); mg.add("trunk", arm1, at(d.x, d.h - 0.5, d.z)); arm1.dispose();
        const arm2 = new THREE.BoxGeometry(1.5, 0.12, 0.12); mg.add("trunk", arm2, at(d.x, d.h - 1.0, d.z)); arm2.dispose();
        [-0.55, 0, 0.55].forEach(function (o) {
          const i1 = new THREE.CylinderGeometry(0.03, 0.045, 0.14, 10); mg.add("chrome", i1, at(d.x, d.h - 0.38, d.z + o)); i1.dispose();
          const i2 = new THREE.CylinderGeometry(0.03, 0.045, 0.14, 10); mg.add("chrome", i2, at(d.x + o, d.h - 0.88, d.z)); i2.dispose();
        });
        const can = new THREE.CylinderGeometry(0.28, 0.28, 0.7, 20); mg.add("steel", can, at(d.x + 0.38, d.h - 1.8, d.z)); can.dispose();
        return true;
      }
      case "wires": {
        // Three drooping lines between two poles (each pole's arm carries them).
        const alongX = Math.abs(d.x1 - d.x0) > Math.abs(d.z1 - d.z0), y = alongX ? d.y + 0.2 : d.y - 0.3;
        [-0.55, 0, 0.55].forEach(function (o) {
          let prev = null;
          for (let i = 0; i <= 12; i++) {
            const u = i / 12, sag = Math.sin(u * Math.PI) * 0.9;
            const pt = alongX ? [d.x0 + (d.x1 - d.x0) * u, y - sag, d.z0 + o] : [d.x0 + o, y - sag, d.z0 + (d.z1 - d.z0) * u];
            if (prev) rod(mg, "wire", prev[0], prev[1], prev[2], pt[0], pt[1], pt[2], 0.014, 5);
            prev = pt;
          }
        });
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ fire barrels
  // Each burning drum (map.js barrelFire) gets a live flame: three glowing sprites and five flame
  // tongues that flicker and sway, smoke rising off the top and the odd ember. The damage when you
  // bump into it is the sim's (fireStep); here the flame just flares when someone is hurt by it.
  const FLAMES = [];
  function buildFlames(parent) {
    (M.fires || []).forEach(function (f, i) {
      const g = new THREE.Group();
      g.position.set(f.x, 0.95, f.z);
      const layers = [[0xff4a08, 0.95, 1.0], [0xff9a2a, 0.8, 0.72], [0xffe48a, 0.65, 0.42]].map(function (L) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.dot, color: L[0], transparent: true, opacity: L[1], blending: THREE.AdditiveBlending, depthWrite: false }));
        s.scale.set(L[2], L[2] * 1.5, 1); s.position.y = 0.3;
        g.add(s);
        return { s: s, w: L[2] };
      });
      const tongues = [];
      for (let k = 0; k < 5; k++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.075 + (k % 2) * 0.03, 0.5, 10), material("fire"));
        cone.userData.a = k * 1.2566; cone.userData.r = k ? 0.12 : 0;
        g.add(cone);
        tongues.push(cone);
      }
      parent.add(g);
      FLAMES.push({ g: g, layers: layers, tongues: tongues, seed: i * 1.7 + 0.4, x: f.x, z: f.z, smokeT: Math.random(), flare: 0, hurtT: 0 });
    });
  }
  // t = clock seconds; flare(i) makes flame i leap for a moment.
  V.updateFlames = function (t, dt) {
    for (let i = 0; i < FLAMES.length; i++) {
      const F = FLAMES[i];
      F.flare = Math.max(0, F.flare - dt * 2.5);
      const fl = 1 + F.flare * 0.8;
      F.layers.forEach(function (L, k) {
        const b = 1 + 0.22 * Math.sin(t * (11 + k * 3) + F.seed * (k + 1)) + 0.12 * Math.sin(t * 27 + F.seed * 2.3 + k);
        L.s.scale.set(L.w * (0.9 + 0.1 * b) * fl, L.w * 1.5 * b * fl, 1);
        L.s.position.y = 0.28 * b + k * 0.05;
      });
      F.tongues.forEach(function (c, k) {
        const u = 0.75 + 0.5 * Math.abs(Math.sin(t * (7 + k * 1.3) + F.seed + k * 1.9));
        const sway = 0.04 * Math.sin(t * 5 + k + F.seed);
        c.scale.set(1, u * fl, 1);
        c.position.set(Math.cos(c.userData.a) * c.userData.r + sway, 0.14 + 0.25 * u * fl, Math.sin(c.userData.a) * c.userData.r);
        c.rotation.z = sway * 2;
      });
      F.smokeT -= dt;
      if (F.smokeT <= 0) { F.smokeT = 0.3 + Math.random() * 0.25; smokePuff(F.x, 1.7, F.z, 0.45 + Math.random() * 0.3, 0x3a3836, 2.2, 0.28); }
      if (Math.random() < dt * 3.5 + F.flare * dt * 30) burst(F.x, 1.25, F.z, 1, Math.random() < 0.5 ? 0xff8a30 : 0xffc060, 0.5, 1.6, -0.2, 1.1);
    }
  };
  V.flareFire = function (x, z) {
    for (let i = 0; i < FLAMES.length; i++) if (Math.hypot(FLAMES[i].x - x, FLAMES[i].z - z) < 1.5) FLAMES[i].flare = 1;
  };
  // ------------------------------------------------------------------ the block
  function buildBlock(scene) {
    const group = new THREE.Group();
    const mg = new Merger();
    M.boxes.forEach(function (b) { if (b.vis !== false && !b.ground) mg.addBox(b); });
    // Ground: asphalt that runs on under the skyline.
    mg.add("asphalt", new THREE.BoxGeometry(420, 1, 420), at(0, -0.5, 0));
    M.decor.forEach(function (d) {
      if (detail(mg, d)) return;
      switch (d.kind) {
        case "frame": case "boards": case "shopfront": case "bars": windowDecor(mg, d); break;
        case "facade": facade(mg, d); break;
        case "car": carDecor(mg, d); break;
        case "truck": truckDecor(mg, d); break;
        case "tree": treeDecor(mg, d); break;
        case "rail": {
          const h = d.h || 1.05;
          rod(mg, "rail", d.x0, d.y + h, d.z0, d.x1, d.y + h, d.z1, 0.03);
          rod(mg, "rail", d.x0, d.y + h * 0.5, d.z0, d.x1, d.y + h * 0.5, d.z1, 0.02);
          const len = Math.hypot(d.x1 - d.x0, d.z1 - d.z0), n = Math.max(1, Math.round(len / 1.6));
          for (let i = 0; i <= n; i++) {
            const u = i / n, x = d.x0 + (d.x1 - d.x0) * u, z = d.z0 + (d.z1 - d.z0) * u;
            rod(mg, "rail", x, d.y, z, x, d.y + h, z, 0.025, 6);
          }
          break;
        }
        case "ladder": {
          // Steel fire ladder bolted to the wall: two rails and a rung every 30 cm.
          const rx = -Math.sin(d.yaw) * 0.24, rz = Math.cos(d.yaw) * 0.24;
          [-1, 1].forEach(function (s) { rod(mg, "rail", d.x + rx * s, d.y0, d.z + rz * s, d.x + rx * s, d.y1, d.z + rz * s, 0.025, 6); });
          for (let y = d.y0 + 0.3; y < d.y1; y += 0.3) rod(mg, "rail", d.x - rx, y, d.z - rz, d.x + rx, y, d.z + rz, 0.015, 5);
          break;
        }
        case "iron": {
          // Wrought-iron cemetery fence: pickets with spear tips between two rails.
          const len = Math.hypot(d.x1 - d.x0, d.z1 - d.z0), n = Math.max(1, Math.round(len / 0.18));
          for (let i = 0; i <= n; i++) {
            const u = i / n, x = d.x0 + (d.x1 - d.x0) * u, z = d.z0 + (d.z1 - d.z0) * u;
            rod(mg, "iron", x, d.y, z, x, d.y + d.h, z, 0.015, 4);
            mg.add("iron", new THREE.ConeGeometry(0.035, 0.12, 4), at(x, d.y + d.h + 0.06, z));
          }
          rod(mg, "iron", d.x0, d.y + d.h - 0.15, d.z0, d.x1, d.y + d.h - 0.15, d.z1, 0.02, 4);
          rod(mg, "iron", d.x0, d.y + 0.15, d.z0, d.x1, d.y + 0.15, d.z1, 0.02, 4);
          break;
        }
        case "mausoleum": {
          // A pitched stone roof and, on the front (west, toward the path), an iron door between columns.
          const cz = (d.z0 + d.z1) / 2, w = d.z1 - d.z0;
          const roof = new THREE.CylinderGeometry(w * 0.62, w * 0.62, d.x1 - d.x0 + 0.6, 3, 1);
          roof.rotateZ(Math.PI / 2); roof.rotateX(Math.PI / 2);
          mg.add("stone", roof, at((d.x0 + d.x1) / 2, d.y + 0.25, cz));
          mg.add("iron", new THREE.BoxGeometry(0.08, 2.2, 1.4), at(d.x0 - 0.03, 1.1, cz));
          [-0.95, 0.95].forEach(function (o) { mg.add("stone", new THREE.CylinderGeometry(0.18, 0.2, 3.2, 10), at(d.x0 - 0.25, 1.6, cz + o)); });
          break;
        }
        case "chain": {
          const len = Math.hypot(d.x1 - d.x0, d.z1 - d.z0), n = Math.max(1, Math.round(len / 2.5));
          for (let i = 0; i <= n; i++) {
            const u = i / n, x = d.x0 + (d.x1 - d.x0) * u, z = d.z0 + (d.z1 - d.z0) * u;
            rod(mg, "post", x, d.y, z, x, d.y + d.h + 0.05, z, 0.035, 6);
          }
          rod(mg, "post", d.x0, d.y + d.h, d.z0, d.x1, d.y + d.h, d.z1, 0.025, 6);
          const g = new THREE.PlaneGeometry(len, d.h);
          mg.add("chain", g, new THREE.Matrix4().makeRotationY(-Math.atan2(d.z1 - d.z0, d.x1 - d.x0)).setPosition((d.x0 + d.x1) / 2, d.y + d.h / 2, (d.z0 + d.z1) / 2));
          break;
        }
        case "lamp": {
          rod(mg, "post", d.x, 0, d.z, d.x, 4.6, d.z, 0.08, 16);
          const dz = d.face || 0, dx = dz ? 0 : 1;
          rod(mg, "post", d.x, 4.5, d.z, d.x + dx * 1.3, 4.7, d.z + dz * 1.3, 0.05, 6);
          mg.add("lamphead", new THREE.BoxGeometry(dz ? 0.3 : 0.6, 0.1, dz ? 0.6 : 0.3), at(d.x + dx * 1.45, 4.66, d.z + dz * 1.45));
          break;
        }
        case "hoop": {
          const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
          mg.add("backboard", new THREE.BoxGeometry(0.06, 1.05, 1.8), at(d.x + c * 0.15, 3.35, d.z + s * 0.15, -d.yaw));
          const rim = new THREE.TorusGeometry(0.23, 0.02, 10, 32);
          mg.add("rim", rim, new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(d.x + c * 0.45, 3.05, d.z + s * 0.45));
          rod(mg, "post", d.x, 0, d.z, d.x, 3.6, d.z, 0.06, 8);
          break;
        }
        case "container":
          // Doors and locking bars on the street-facing end.
          [-1, 1].forEach(function (sg) { for (let k = -2; k <= 2; k++) rod(mg, "steel", d.x + sg * 1.22, 0.1, d.z + k * 1.1, d.x + sg * 1.22, 2.5, d.z + k * 1.1, 0.025, 5); });
          break;
        case "kerbs": {
          // Kerb stones along the road edges, broken at the junction.
          [[-48, -4], [4, 48]].forEach(function (r) {
            [-4.05, 4.05].forEach(function (z) { mg.add("kerb", new THREE.BoxGeometry(r[1] - r[0], 0.14, 0.18), at((r[0] + r[1]) / 2, 0.07, z)); });
          });
          [[-38, -4], [4, 38]].forEach(function (r) {
            [-4.05, 4.05].forEach(function (x) { mg.add("kerb", new THREE.BoxGeometry(0.18, 0.14, r[1] - r[0]), at(x, 0.07, (r[0] + r[1]) / 2)); });
          });
          // Lane paint: a dashed yellow centre line, stop lines and a zebra crossing.
          for (let x = -46; x < 46; x += 4) if (Math.abs(x) > 8) mg.add("paintY", new THREE.BoxGeometry(2, 0.01, 0.12), at(x + 1, 0.012, 0));
          for (let z = -36; z < 36; z += 4) if (Math.abs(z) > 8) mg.add("paintY", new THREE.BoxGeometry(0.12, 0.01, 2), at(0, 0.012, z + 1));
          for (let k = -3; k <= 3; k++) {
            mg.add("paintW", new THREE.BoxGeometry(2.4, 0.01, 0.45), at(-6, 0.012, k * 1.05));
            mg.add("paintW", new THREE.BoxGeometry(2.4, 0.01, 0.45), at(6, 0.012, k * 1.05));
            mg.add("paintW", new THREE.BoxGeometry(0.45, 0.01, 2.4), at(k * 1.05, 0.012, -6));
            mg.add("paintW", new THREE.BoxGeometry(0.45, 0.01, 2.4), at(k * 1.05, 0.012, 6));
          }
          break;
        }
      }
    });
    // Court lines.
    [[34, 23, 15.4, 0.08], [34, 14.6, 15.4, 0.08], [34, 31.4, 15.4, 0.08]].forEach(function (l) { mg.add("paintW", new THREE.BoxGeometry(l[2], 0.01, l[3]), at(l[0], 0.024, l[1])); });
    [26.6, 41.4].forEach(function (x) { mg.add("paintW", new THREE.BoxGeometry(0.08, 0.01, 16.8), at(x, 0.024, 23)); });
    V.blockMeshes = mg.build(group);
    buildLogos(group);
    buildFlames(group);
    // Store signs: canvas text panels.
    M.decor.forEach(function (d) {
      if (d.kind !== "sign") return;
      const t = canvasTex(512, 64, function (g, w, h) {
        g.fillStyle = d.bg; g.fillRect(0, 0, w, h);
        g.font = "bold 40px 'Arial Black', 'Bahnschrift', sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillStyle = d.fg; g.fillText(d.text, w / 2, h / 2 + 2);
        noise(g, w, h, 26, 9); stains(g, w, h, 4, "rgba(0,0,0,0.35)", 3);
      });
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      const m = new THREE.Mesh(new THREE.BoxGeometry(d.w, d.h, 0.12), [material("framedark"), material("framedark"), material("framedark"), material("framedark"),
        new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.15 }), material("framedark")]);
      m.position.set(d.x, d.y, d.z - 0.06);
      m.rotation.y = Math.PI;
      m.castShadow = true;
      group.add(m);
    });
    scene.add(group);
    return group;
  }

  // ------------------------------------------------------------------ sky + skyline
  // A low, heavy overcast: clouds from a few octaves of value noise, the sun only a pale smear.
  function skyMaterial() {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { uSun: { value: SUN }, uHorizon: { value: HORIZON }, uZenith: { value: ZENITH } },
      vertexShader: "varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }",
      fragmentShader: [
        "uniform vec3 uSun; uniform vec3 uHorizon; uniform vec3 uZenith; varying vec3 vDir;",
        "float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
        "float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);",
        " return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }",
        "float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }",
        "void main(){ vec3 d = normalize(vDir); float h = clamp(d.y, -1.0, 1.0);",
        " vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.5));",
        " vec2 uv = d.xz / (max(d.y, 0.0) + 0.28);",
        " float c = fbm(uv * 0.9 + vec2(4.0, 1.0)), c2 = fbm(uv * 2.2 - vec2(2.0, 7.0));",
        " float cover = smoothstep(0.28, 0.8, c * 0.75 + c2 * 0.35);",
        " col = mix(col * 1.12, col * 0.5, cover * smoothstep(0.0, 0.18, h));",
        " col = mix(col, vec3(0.17, 0.18, 0.18), smoothstep(0.02, -0.2, h));",
        " float s = max(dot(d, uSun), 0.0);",
        " col += vec3(0.55, 0.52, 0.44) * pow(s, 22.0) * 0.28 * (1.0 - cover * 0.8);",
        " gl_FragColor = vec4(col, 1.0);",
        " #include <tonemapping_fragment>",
        " #include <colorspace_fragment>",
        "}"
      ].join("\n")
    });
  }

  // One tower: a podium, up to three tiers that step in, corner piers, floor bands, a roof with
  // plant on it, and for the tall ones an antenna with a red light (or a spire). x, z is the centre.
  function tower(mg, r, x, z, w, dep, h, withLogo) {
    const key = ["towers", "towers2", "towers3"][(r() * 3) | 0];
    const tall = h > 34, tiers = tall ? [[1, 0.6], [0.8, 0.27], [0.55, 0.13]] : [[1, 1]];
    let y = 0, cw = w, cd = dep;
    if (tall) {
      const hb = 5 + r() * 5;
      mg.add("brickdark", new THREE.BoxGeometry(w * 1.2, hb, dep * 1.2), at(x, hb / 2, z));
      mg.add("slab", new THREE.BoxGeometry(w * 1.24, 0.4, dep * 1.24), at(x, hb, z));
    }
    tiers.forEach(function (t, i) {
      const th = h * t[1];
      cw = w * t[0]; cd = dep * t[0];
      mg.add(key, new THREE.BoxGeometry(cw, th, cd), at(x, y + th / 2, z));
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (k) {
        mg.add("slab", new THREE.BoxGeometry(0.9, th, 0.9), at(x + k[0] * (cw / 2 - 0.1), y + th / 2, z + k[1] * (cd / 2 - 0.1)));
      });
      for (let by = 14; by < th - 2; by += 14) mg.add("slab", new THREE.BoxGeometry(cw + 0.3, 0.35, cd + 0.3), at(x, y + by, z));
      y += th;
      // The roof of this tier: a deck, a parapet, and on the last one the plant.
      mg.add("roof", new THREE.BoxGeometry(cw + 0.5, 0.5, cd + 0.5), at(x, y + 0.1, z));
      [[0, cd / 2 + 0.2, cw + 0.5, 0.35], [0, -cd / 2 - 0.2, cw + 0.5, 0.35]].forEach(function (p) { mg.add("slab", new THREE.BoxGeometry(p[2], 1.0, p[3]), at(x + p[0], y + 0.6, z + p[1])); });
      [[cw / 2 + 0.2, 0], [-cw / 2 - 0.2, 0]].forEach(function (p) { mg.add("slab", new THREE.BoxGeometry(0.35, 1.0, cd + 0.5), at(x + p[0], y + 0.6, z + p[1])); });
    });
    const top = y + 0.6;
    mg.add("hvac", new THREE.BoxGeometry(cw * 0.4, 3.2, cd * 0.4), at(x + cw * 0.12, top + 1.6, z - cd * 0.1));
    if (r() < 0.6) mg.add("hvac", new THREE.BoxGeometry(2.4, 1.8, 2.4), at(x - cw * 0.25, top + 0.9, z + cd * 0.2));
    if (!tall) {
      // Mid-rises carry a wooden water tank.
      const tk = new THREE.CylinderGeometry(1.6, 1.6, 2.8, 24);
      mg.add("rust", tk, at(x - cw * 0.2, top + 3.1, z - cd * 0.25)); tk.dispose();
      const lid = new THREE.ConeGeometry(1.75, 0.9, 24);
      mg.add("rust", lid, at(x - cw * 0.2, top + 4.95, z - cd * 0.25)); lid.dispose();
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (k) { rod(mg, "rust", x - cw * 0.2 + k[0], top, z - cd * 0.25 + k[1], x - cw * 0.2 + k[0], top + 1.7, z - cd * 0.25 + k[1], 0.08, 8); });
    } else {
      const ah = 12 + r() * 16;
      if (r() < 0.45) {
        const sp = new THREE.ConeGeometry(cw * 0.22, ah, 14);
        mg.add("steel", sp, at(x, top + ah / 2 + 3, z)); sp.dispose();
      } else {
        rod(mg, "rail", x, top + 3, z, x, top + 3 + ah, z, 0.22, 12);
        rod(mg, "rail", x, top + 3 + ah * 0.6, z - 1.5, x, top + 3 + ah * 0.6, z + 1.5, 0.12, 8);
      }
      const bc = new THREE.SphereGeometry(0.55, 14, 10);
      mg.add("beacon", bc, at(x, top + 3 + ah + 0.4, z)); bc.dispose();
    }
    if (withLogo) {
      // The seal, lit, on the face that looks at the block.
      const fx = Math.abs(x) > Math.abs(z), s = Math.min(w, dep) * 0.7, ly = Math.min(y * 0.55, 26) + 6;
      if (fx) logoWall(LG.board, x - Math.sign(x) * (w / 2 + 0.2), ly, z, -Math.sign(x), 0, Math.min(s, 15));
      else logoWall(LG.board, x, ly, z - Math.sign(z) * (dep / 2 + 0.2), 0, -Math.sign(z), Math.min(s, 15));
    }
  }
  // A ring of towers and low-rises beyond the walls, so the block sits in a city.
  function buildSkyline(scene) {
    const mg = new Merger(), r = rnd(2024);
    for (let i = 0; i < (V.lowDetail ? 110 : 190); i++) {
      const a = r() * Math.PI * 2, d = 62 + r() * 150;
      const x = Math.cos(a) * d * 1.1, z = Math.sin(a) * d;
      if (Math.abs(x) < 56 && Math.abs(z) < 46) continue;
      const w = 10 + r() * 18, dep = 10 + r() * 18, h = d < 100 ? 8 + r() * 28 : 26 + r() * 76;
      tower(mg, r, x, z, w, dep, h, d < 150 && r() < 0.22);
    }
    // Rooftops just over the walls: the neighbours' houses, each with a chimney.
    for (let x = -60; x <= 60; x += 9) {
      [-46, 46].forEach(function (z) {
        const h = 5 + r() * 5;
        mg.add(r() < 0.5 ? "brick" : "brickdark", new THREE.BoxGeometry(8.6, h, 6), at(x, h / 2, z + Math.sign(z) * 0.5));
        mg.add("brickdark", new THREE.BoxGeometry(1, 2.2, 1), at(x + 2, h + 1.1, z + Math.sign(z) * 0.5));
      });
    }
    for (let z = -40; z <= 40; z += 9) {
      [-56, 56].forEach(function (x) {
        const h = 5 + r() * 6;
        mg.add(r() < 0.5 ? "brick" : "brickred", new THREE.BoxGeometry(6, h, 8.6), at(x, h / 2, z));
        mg.add("brickdark", new THREE.BoxGeometry(1, 2.2, 1), at(x, h + 1.1, z + 2));
      });
    }
    const grp = new THREE.Group();
    mg.build(grp, false);
    grp.traverse(function (o) { if (o.isMesh) o.receiveShadow = false; });
    scene.add(grp);
  }

  // ------------------------------------------------------------------ pickups
  const PK = [];
  function pickupMesh(q) {
    const g = new THREE.Group();
    if (q.kind === "weapon" || q.kind === "nades") {
      const gun = SP.Models.gunMesh(q.kind === "nades" ? 5 : q.w, q.kind === "nades" ? 2 : 1.1);
      gun.position.x = -0.15;
      g.add(gun);
    } else if (q.kind === "armor") {
      const vest = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.18), new THREE.MeshStandardMaterial({ color: 0x3b4630, roughness: 0.8 }));
      g.add(vest);
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.08, 0.2), new THREE.MeshStandardMaterial({ color: 0x1d2218 }));
      strap.position.y = -0.05; g.add(strap);
    } else {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.5 }));
      g.add(box);
      const cm = new THREE.MeshStandardMaterial({ color: 0xd8262a, emissive: 0x7a0a0a, emissiveIntensity: 0.6 });
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.32), cm));
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.32), cm));
    }
    return g;
  }
  function buildPickups(scene) {
    M.pickups.forEach(function (q) {
      const root = new THREE.Group();
      root.position.set(q.x, q.y, q.z);
      const col = q.kind === "weapon" ? 0xffc93a : q.kind === "armor" ? 0x5aa0ff : q.kind === "health" ? 0x7dff8a : 0xff9f43;
      const glow = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.46, 24), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
      glow.rotation.x = -Math.PI / 2; glow.position.y = 0.03; root.add(glow);
      const item = pickupMesh(q);
      item.position.y = 0.6;
      item.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
      root.add(item);
      scene.add(root);
      PK.push({ root: root, item: item, glow: glow, q: q, seed: q.id * 1.3 });
    });
  }
  V.updatePickups = function (sim, t) {
    for (let i = 0; i < PK.length; i++) {
      const k = PK[i], up = sim.pick[i] ? sim.pick[i].up : true;
      k.item.visible = up;
      k.glow.material.opacity = up ? 0.55 + 0.25 * Math.sin(t * 3 + k.seed) : 0.12;
      if (up) { k.item.rotation.y = t * 1.2 + k.seed; k.item.position.y = 0.6 + Math.sin(t * 2 + k.seed) * 0.05; }
    }
  };

  // ------------------------------------------------------------------ the duffle run (turf)
  // Each stash: a ring on the floor, a pile of silver-wrapped bricks (an instanced mesh that shrinks
  // as they go into the bags), two duffle bags on the table (flat while empty, fat once packed) and a
  // green meter over the table while they're being loaded. Each side's block gets a beam of light.
  // Dropped bags lie where their carrier fell, with a glowing marker.
  const PTS = [], ZN = [], DR = [];
  const STATE_COL = { empty: 0x9aa4ad, loading: 0x37e07a, packed: 0xffc93a, cool: 0x4a4f54 };
  let BAGMAT = null;
  // A squared-off gym duffle: a rounded-rectangle body (small radius, bevelled edges), a darker base,
  // end pockets, a zip along the top, two flat straps and the seal on both sides.
  function bagMesh() {
    if (!BAGMAT) {
      const t = logoTexture();
      BAGMAT = {
        cloth: new THREE.MeshStandardMaterial({ color: 0x25312b, roughness: 0.9 }),
        dark: new THREE.MeshStandardMaterial({ color: 0x0f1311, roughness: 0.8 }),
        strap: new THREE.MeshStandardMaterial({ color: 0x151816, roughness: 0.7 }),
        zip: new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.35, metalness: 0.8 }),
        patch: new THREE.MeshBasicMaterial({ map: t, alphaTest: 0.05, alphaToCoverage: true })
      };
      const sh = new THREE.Shape(), w = 0.17, h = 0.15, r = 0.045;
      sh.moveTo(-w + r, -h); sh.lineTo(w - r, -h); sh.quadraticCurveTo(w, -h, w, -h + r); sh.lineTo(w, h - r); sh.quadraticCurveTo(w, h, w - r, h);
      sh.lineTo(-w + r, h); sh.quadraticCurveTo(-w, h, -w, h - r); sh.lineTo(-w, -h + r); sh.quadraticCurveTo(-w, -h, -w + r, -h);
      const body = new THREE.ExtrudeGeometry(sh, { depth: 0.52, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 3, curveSegments: 6 });
      body.translate(0, 0, -0.26); body.rotateY(Math.PI / 2);
      BAGMAT.body = body;
    }
    const g = new THREE.Group();
    g.add(new THREE.Mesh(BAGMAT.body, BAGMAT.cloth));
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.31), BAGMAT.dark); base.position.y = -0.158; g.add(base);
    [-1, 1].forEach(function (s) {
      const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.17, 0.25), BAGMAT.cloth); pocket.position.set(s * 0.325, -0.02, 0); g.add(pocket);
      const tab = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.03, 0.1), BAGMAT.dark); tab.position.set(s * 0.325, 0.06, 0); g.add(tab);
    });
    const zip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 0.03), BAGMAT.zip); zip.position.y = 0.19; g.add(zip);
    [-0.14, 0.14].forEach(function (x) {
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.013, 6, 12, Math.PI), BAGMAT.strap);
      strap.scale.set(1, 1, 0.45); strap.rotation.y = Math.PI / 2; strap.position.set(x, 0.19, 0); g.add(strap);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.31, 0.345), BAGMAT.strap); band.position.set(x, 0.0, 0); g.add(band);
    });
    [0.206, -0.206].forEach(function (z) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), BAGMAT.patch);
      p.position.set(0, 0.01, z); if (z < 0) p.rotation.y = Math.PI; g.add(p);
    });
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    return g;
  }  V.bagMesh = bagMesh;

  // The brick pile: four layers of silver foil bricks, alternate layers crosswise, narrowing upward.
  const BRICK_N = 9 + 5 + 6 + 3;
  function brickPile() {
    const geo = new THREE.BoxGeometry(0.26, 0.075, 0.12);
    const mat = new THREE.MeshStandardMaterial({ color: 0xcfd4d9, metalness: 0.85, roughness: 0.28, emissive: 0x6a727a, emissiveIntensity: 0.22 });
    const im = new THREE.InstancedMesh(geo, mat, BRICK_N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1);
    let n = 0;
    function put(x, layer, z, cross) {
      e.set(Math.sin(n * 7.3) * 0.02, (cross ? Math.PI / 2 : 0) + Math.sin(n * 3.1) * 0.05, 0);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, 0.0375 + layer * 0.078, z), q, sc);
      im.setMatrixAt(n++, m);
    }
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) put((c - 1) * 0.28, 0, (r - 1) * 0.14, false);
    for (let c = 0; c < 5; c++) put((c - 2) * 0.13, 1, 0, true);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) put((c - 1) * 0.28, 2, (r - 0.5) * 0.14, false);
    for (let c = 0; c < 3; c++) put((c - 1) * 0.13, 3, 0, true);
    im.count = n; im.userData.total = n;
    im.castShadow = true; im.frustumCulled = false;
    return im;
  }
  function buildPoints(scene) {
    M.points.forEach(function (P) {
      const g = new THREE.Group();
      g.position.set(P.x, P.y, P.z);
      const ring = new THREE.Mesh(new THREE.RingGeometry(P.r - 0.1, P.r, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; ring.renderOrder = 2;
      g.add(ring);
      const bricks = brickPile();
      bricks.position.set(0, 0, 1.0);
      g.add(bricks);
      const bags = [-0.45, 0.45].map(function (x) {
        const b = bagMesh(); b.position.set(x, 0.97, 0); b.rotation.y = x < 0 ? 0.25 : -0.2; g.add(b); return b;
      });
      // The meter: a dark bar with a green fill, turned to face the camera each frame.
      const bar = new THREE.Group();
      const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.22), new THREE.MeshBasicMaterial({ color: 0x0b0d0c, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, fog: false }));
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.15), new THREE.MeshBasicMaterial({ color: 0x37e07a, transparent: true, depthTest: false, depthWrite: false, fog: false }));
      bg.renderOrder = 10; fill.renderOrder = 11; fill.position.z = 0.002;
      bar.add(bg); bar.add(fill); bar.position.y = 2.15; bar.visible = false;
      g.add(bar);
      scene.add(g);
      PTS.push({ g: g, ring: ring, bricks: bricks, bags: bags, bar: bar, fill: fill, P: P });
    });
    (M.zones || []).forEach(function (Z) {
      const col = SP.FACTIONS[Z.team === 0 ? "crew" : "iron"] ? SP.FACTIONS[Z.team === 0 ? "crew" : "iron"].color : 0xffffff;
      const g = new THREE.Group(); g.position.set(Z.x, Z.y || 0, Z.z);
      const ring = new THREE.Mesh(new THREE.RingGeometry(Z.r - 0.14, Z.r, 56), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.035; ring.renderOrder = 2; g.add(ring);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(Z.r * 0.92, Z.r * 0.92, 7, 32, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      beam.position.y = 3.5; beam.renderOrder = 3; g.add(beam);
      scene.add(g);
      ZN.push({ g: g, beam: beam, Z: Z });
    });
  }

  function dropMesh() {
    const g = new THREE.Group();
    const b = bagMesh(); b.position.y = 0.19; b.rotation.y = Math.random() * 6; g.add(b);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 28), new THREE.MeshBasicMaterial({ color: 0xffc93a, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; g.add(ring);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 3.2, 14, 1, true), new THREE.MeshBasicMaterial({ color: 0xffc93a, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    beam.position.y = 1.6; g.add(beam);
    V.scene.add(g);
    return { g: g, ring: ring, beam: beam };
  }

  V.updatePoints = function (sim, t) {
    const on = sim.mode === "turf", cam = V.camera;
    PTS.forEach(function (k, i) {
      k.g.visible = on;
      if (!on) return;
      const st = sim.pt[i];
      k.ring.material.color.setHex(st.state === "packed" && st.team >= 0 ? SP.FACTIONS[sim.factions[st.team]].color : STATE_COL[st.state] || 0xffffff);
      // Bricks go into the bags as the meter fills; they come back when the stash restocks.
      const fill = st.state === "loading" ? st.prog : st.state === "packed" || st.state === "cool" ? 1 : 0;
      k.bricks.count = Math.max(0, Math.ceil(k.bricks.userData.total * (1 - fill)));
      k.bricks.visible = k.bricks.count > 0;
      k.bags.forEach(function (b, j) {
        b.visible = st.state === "empty" || st.state === "loading" || (st.state === "packed" && j < st.bags);
        const f = fill;
        b.scale.set(1, 0.32 + 0.68 * f, 1 + 0.4 * (1 - f));
        b.position.y = 0.8 + 0.18 * b.scale.y + 0.01;
      });
      k.bar.visible = st.state === "loading";
      if (k.bar.visible) {
        k.bar.quaternion.copy(cam.quaternion);
        k.fill.scale.x = Math.max(0.001, st.prog);
        k.fill.position.x = -0.75 + 0.75 * st.prog;
        k.fill.material.color.setHex(st.contested ? 0xff7a2a : 0x37e07a);
      }
    });
    ZN.forEach(function (k) {
      k.g.visible = on;
      if (on) k.beam.material.opacity = 0.11 + 0.04 * Math.sin(t * 2 + k.Z.team);
    });
    // Dropped bags.
    const drops = on ? sim.drops : [];
    while (DR.length < drops.length) DR.push(dropMesh());
    DR.forEach(function (d, i) {
      const b = drops[i];
      d.g.visible = !!b;
      if (!b) return;
      d.g.position.set(b.x, b.y, b.z);
      const pulse = 0.7 + 0.3 * Math.sin(t * 5 + i), left = 1 - b.t / 30;
      d.ring.material.opacity = (left < 0.25 ? 0.4 + 0.5 * Math.sin(t * 14) : 0.9) * pulse;
      d.beam.material.opacity = 0.22 * pulse;
    });
  };

  // ------------------------------------------------------------------ projectiles
  const PJ = new Map();
  V.updateProjectiles = function (sim, dt) {
    const seen = new Set();
    sim.proj.forEach(function (q) {
      seen.add(q.id);
      let m = PJ.get(q.id);
      if (!m) {
        if (q.k === "rocket") {
          m = new THREE.Group();
          const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.5, 8), material("leaves"));
          body.rotation.z = Math.PI / 2; m.add(body);
          const nose = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.22, 8), material("leaves"));
          nose.rotation.z = -Math.PI / 2; nose.position.x = 0.36; m.add(nose);
          const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.dot, color: 0xffb040, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
          flame.scale.set(0.55, 0.55, 1); flame.position.x = -0.32; m.add(flame);
        } else m = SP.Models.gunMesh(5, 1.1);
        V.scene.add(m);
        PJ.set(q.id, m);
      }
      m.position.set(q.x, q.y, q.z);
      const sp = Math.hypot(q.vx, q.vz);
      if (q.k === "nade") { m.rotation.x += dt * 9; m.rotation.z += dt * 5; }
      else { m.rotation.set(0, -Math.atan2(q.vz, q.vx), Math.atan2(q.vy, sp)); }
      if (q.k === "rocket" && Math.random() < 0.85) smokePuff(q.x, q.y, q.z, 0.35, 0xcfcac2, 1.2);
    });
    PJ.forEach(function (m, id) { if (!seen.has(id)) { V.scene.remove(m); PJ.delete(id); } });
  };

  // ------------------------------------------------------------------ tracers, flashes
  const TR = [];
  V.tracer = function (x0, y0, z0, x1, y1, z1, own) {
    // A short streak that runs down the bullet's path (most of the path stays dark).
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, len = Math.hypot(dx, dy, dz) || 1;
    const seg = Math.min(len, 4 + Math.random() * 3);
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x0 + dx / len * seg, y0 + dy / len * seg, z0 + dz / len * seg)]);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: own ? 0.3 : 0.7, depthWrite: false }));
    l.renderOrder = 3;
    V.scene.add(l);
    TR.push({ o: l, t: 0, life: Math.min(0.12, len / 400), from: [x0, y0, z0], d: [dx / len, dy / len, dz / len], len: len, seg: seg });
  };
  const FLASH = [];
  V.flash = function (x, y, z, size) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.flash, color: 0xffd9a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, rotation: Math.random() * Math.PI }));
    s.position.set(x, y, z); s.scale.set(size, size, 1);
    V.scene.add(s);
    FLASH.push({ o: s, t: 0, life: 0.05 });
  };

  // ------------------------------------------------------------------ particles
  const MAXP = 1200;
  const PT = { pos: null, col: null, vel: new Float32Array(MAXP * 3), life: new Float32Array(MAXP), grav: new Float32Array(MAXP), n: 0, geo: null };
  function buildParticles(scene) {
    const g = new THREE.BufferGeometry();
    PT.pos = new Float32Array(MAXP * 3); PT.col = new Float32Array(MAXP * 3);
    g.setAttribute("position", new THREE.BufferAttribute(PT.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(PT.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const m = new THREE.PointsMaterial({ size: 0.07, vertexColors: true, map: TEX.dot, transparent: true, depthWrite: false, sizeAttenuation: true });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false; pts.renderOrder = 4;
    scene.add(pts);
    PT.geo = g;
  }
  function particle(x, y, z, vx, vy, vz, c, grav, life) {
    if (PT.n >= MAXP) return;
    const k = PT.n++;
    PT.pos[k * 3] = x; PT.pos[k * 3 + 1] = y; PT.pos[k * 3 + 2] = z;
    PT.vel[k * 3] = vx; PT.vel[k * 3 + 1] = vy; PT.vel[k * 3 + 2] = vz;
    const v = 0.75 + Math.random() * 0.4;
    PT.col[k * 3] = c.r * v; PT.col[k * 3 + 1] = c.g * v; PT.col[k * 3 + 2] = c.b * v;
    PT.life[k] = life * (0.6 + Math.random() * 0.6); PT.grav[k] = grav;
  }
  const _pc = new THREE.Color();
  function burst(x, y, z, n, color, speed, up, grav, life) {
    _pc.set(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * 1.2;
      const s = speed * (0.4 + Math.random() * 0.8);
      particle(x, y, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + up, Math.sin(a) * Math.cos(e) * s, _pc, grav, life);
    }
  }
  V.burst = burst;
  // Particles thrown along a direction (impact debris off a wall, a spent casing).
  function spray(x, y, z, dx, dy, dz, n, color, speed, jitter, grav, life) {
    _pc.set(color);
    for (let i = 0; i < n; i++) {
      const s = speed * (0.5 + Math.random() * 0.7);
      particle(x, y, z, (dx + (Math.random() - 0.5) * jitter) * s, (dy + (Math.random() - 0.5) * jitter) * s, (dz + (Math.random() - 0.5) * jitter) * s, _pc, grav, life);
    }
  }
  V.spray = spray;
  function updateParticles(dt) {
    for (let k = 0; k < PT.n; k++) {
      PT.life[k] -= dt;
      if (PT.life[k] <= 0) {
        const last = --PT.n;
        if (k !== last) {
          for (let j = 0; j < 3; j++) { PT.pos[k * 3 + j] = PT.pos[last * 3 + j]; PT.vel[k * 3 + j] = PT.vel[last * 3 + j]; PT.col[k * 3 + j] = PT.col[last * 3 + j]; }
          PT.life[k] = PT.life[last]; PT.grav[k] = PT.grav[last];
        }
        k--;
        continue;
      }
      PT.vel[k * 3 + 1] -= PT.grav[k] * dt;
      PT.pos[k * 3] += PT.vel[k * 3] * dt; PT.pos[k * 3 + 1] += PT.vel[k * 3 + 1] * dt; PT.pos[k * 3 + 2] += PT.vel[k * 3 + 2] * dt;
      if (PT.pos[k * 3 + 1] < 0.02 && PT.grav[k] > 0) { PT.pos[k * 3 + 1] = 0.02; PT.vel[k * 3] *= 0.5; PT.vel[k * 3 + 1] *= -0.3; PT.vel[k * 3 + 2] *= 0.5; }
    }
    PT.geo.setDrawRange(0, PT.n);
    PT.geo.attributes.position.needsUpdate = true;
    PT.geo.attributes.color.needsUpdate = true;
  }

  // Soft smoke puffs (sprites that grow and fade): impacts, rocket trails, blasts.
  const SMOKE = [];
  function smokePuff(x, y, z, size, color, life, op) {
    if (SMOKE.length > 160) return;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.smoke, color: color || 0xffffff, transparent: true, opacity: op || 0.8, depthWrite: false }));
    s.position.set(x, y, z); s.scale.set(size, size, 1);
    V.scene.add(s);
    SMOKE.push({ o: s, t: 0, life: life || 1, size: size, op: op || 0.8, vy: 0.3 + Math.random() * 0.3, vx: (Math.random() - 0.5) * 0.5, vz: (Math.random() - 0.5) * 0.5 });
  }
  V.smokePuff = smokePuff;
  // A bullet strike: dust in the colour of what it hit, sparks off metal.
  const SURF = { concrete: 0xbdb6aa, brick: 0x9a5a44, metal: 0xffd27a, wood: 0x8a5a33, glass: 0xdff2ff, dirt: 0x7a6248 };
  V.impact = function (x, y, z, nx, ny, nz, surf) {
    spray(x, y, z, nx, ny + 0.3, nz, surf === "metal" ? 7 : 5, SURF[surf] || 0xbdb6aa, surf === "metal" ? 5 : 2.5, 1.2, 9, surf === "metal" ? 0.25 : 0.5);
    if (surf !== "metal" && surf !== "glass") smokePuff(x + nx * 0.1, y + ny * 0.1, z + nz * 0.1, 0.35, SURF[surf] || 0xbdb6aa, 0.7, 0.55);
  };
  V.blood = function (x, y, z) {
    burst(x, y, z, 6, 0x6a0c0c, 1.6, 0.2, 9, 0.4);
    smokePuff(x, y, z, 0.3, 0x7a1010, 0.35, 0.5);
  };
  V.casing = function (x, y, z, yaw) {
    // Ejected to the right and up, brass.
    spray(x, y, z, -Math.sin(yaw) * 0.9 + Math.cos(yaw) * -0.2, 0.9, Math.cos(yaw) * 0.9 + Math.sin(yaw) * -0.2, 1, 0xd8a840, 2.4, 0.5, 9.8, 0.9);
  };
  // Explosions: fireball, smoke, debris and a flash.
  const BOOMS = [];
  V.explosion = function (x, y, z, r) {
    [[0xff7a1a, 0.6, 0.9], [0xfff0a0, 0.3, 1.0]].forEach(function (f) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshBasicMaterial({ color: f[0], transparent: true, opacity: f[2], depthWrite: false }));
      m.position.set(x, y, z); m.scale.setScalar(0.3);
      m.renderOrder = 5;
      V.scene.add(m);
      BOOMS.push({ o: m, t: 0, r: r * f[1], keep: f[0] });
    });
    for (let i = 0; i < 12; i++) smokePuff(x + (Math.random() - 0.5) * r * 0.6, y + Math.random() * r * 0.4, z + (Math.random() - 0.5) * r * 0.6, r * 0.55, 0x4a4642, 2.4, 0.85);
    burst(x, y, z, 40, 0xffc060, 9, 3, 12, 0.6);
    burst(x, y, z, 30, 0x3a3530, 7, 4, 12, 1.2);
    V.flash(x, y + 0.5, z, r * 2.4);
  };
  function updateFx(dt) {
    [TR, FLASH].forEach(function (L) {
      for (let i = L.length - 1; i >= 0; i--) {
        const f = L[i];
        if (f.base === undefined) f.base = f.o.material.opacity;
        f.t += dt;
        if (L === TR) {
          // Slide the streak along the path.
          const u = Math.min(1, f.t / f.life), head = f.seg + (f.len - f.seg) * u, tail = Math.max(0, head - f.seg);
          const p = f.o.geometry.attributes.position;
          p.setXYZ(0, f.from[0] + f.d[0] * tail, f.from[1] + f.d[1] * tail, f.from[2] + f.d[2] * tail);
          p.setXYZ(1, f.from[0] + f.d[0] * head, f.from[1] + f.d[1] * head, f.from[2] + f.d[2] * head);
          p.needsUpdate = true;
        } else f.o.material.opacity = f.base * Math.max(0, 1 - f.t / f.life);
        if (f.t >= f.life) { V.scene.remove(f.o); if (L === TR) f.o.geometry.dispose(); f.o.material.dispose(); L.splice(i, 1); }
      }
    });
    for (let i = SMOKE.length - 1; i >= 0; i--) {
      const s = SMOKE[i];
      s.t += dt;
      const u = s.t / s.life;
      s.o.position.x += s.vx * dt; s.o.position.y += s.vy * dt; s.o.position.z += s.vz * dt;
      const sc = s.size * (1 + u * 1.6);
      s.o.scale.set(sc, sc, 1);
      s.o.material.opacity = s.op * (1 - u);
      if (u >= 1) { V.scene.remove(s.o); s.o.material.dispose(); SMOKE.splice(i, 1); }
    }
    for (let i = BOOMS.length - 1; i >= 0; i--) {
      const b = BOOMS[i];
      b.t += dt;
      const u = Math.min(1, b.t / 0.4);
      b.o.scale.setScalar(0.3 + b.r * Math.sqrt(u));
      b.o.material.opacity = 0.95 * (1 - u * u);
      if (b.keep === 0xff7a1a) b.o.material.color.setRGB(1, 0.48 - u * 0.25, 0.1 - u * 0.05);
      if (b.t > 0.4) { V.scene.remove(b.o); b.o.geometry.dispose(); b.o.material.dispose(); BOOMS.splice(i, 1); }
    }
  }

  // ------------------------------------------------------------------ init
  V.init = function (canvas, quality) {
    makeTextures();
    V.TEX = TEX;
    V.msaa = !SP.isCoarse();
    V.lowDetail = quality === "low";                       // fewer towers, no dentils or trolleys, cheaper bags
    const r = new THREE.WebGLRenderer({ canvas: canvas, antialias: V.msaa, powerPreference: "high-performance" });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.08;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.autoClear = false;
    V.renderer = r;

    const scene = new THREE.Scene();
    V.scene = scene;
    scene.fog = new THREE.Fog(0x6c746f, 38, 300);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), skyMaterial());
    sky.frustumCulled = false;
    scene.add(sky);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), skyMaterial()));
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    pmrem.dispose();

    scene.add(new THREE.HemisphereLight(0xa6b8ca, 0x56534b, 0.95));
    scene.add(new THREE.AmbientLight(0x8d99a6, 0.22));      // a little light even where the sun never reaches (inside the houses)
    const sun = new THREE.DirectionalLight(0xc9d3da, 1.35);
    sun.target.position.set(0, 0, 0);
    sun.position.copy(SUN).multiplyScalar(110).add(sun.target.position);
    sun.castShadow = true;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    scene.add(sun); scene.add(sun.target);
    V.sun = sun;
    // Fit the shadow box round the block (in the sun's view).
    const sc = sun.shadow.camera;
    sc.position.copy(sun.position); sc.lookAt(sun.target.position); sc.updateMatrixWorld(true);
    const lv = new THREE.Vector3(), b = M.bounds;
    let lx0 = 1e9, lx1 = -1e9, ly0 = 1e9, ly1 = -1e9, lz0 = 1e9, lz1 = -1e9;
    [b.x0, b.x1].forEach(function (x) { [b.z0, b.z1].forEach(function (z) { [-1, 12].forEach(function (y) {
      lv.set(x, y, z).applyMatrix4(sc.matrixWorldInverse);
      lx0 = Math.min(lx0, lv.x); lx1 = Math.max(lx1, lv.x); ly0 = Math.min(ly0, lv.y); ly1 = Math.max(ly1, lv.y);
      lz0 = Math.min(lz0, -lv.z); lz1 = Math.max(lz1, -lv.z);
    }); }); });
    sc.left = lx0 - 2; sc.right = lx1 + 2; sc.bottom = ly0 - 2; sc.top = ly1 + 2; sc.near = Math.max(1, lz0 - 4); sc.far = lz1 + 4;
    sc.updateProjectionMatrix();

    buildSkyline(scene);
    V.block = buildBlock(scene);
    buildParticles(scene);

    V.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 3000);
    V.camera.rotation.order = "YXZ";
    scene.add(V.camera);
    SP.Models.init(V);
    buildPickups(scene);
    buildPoints(scene);
    V.setQuality(quality || "high");
    V.resize();
  };

  // Adaptive resolution: if frames run long, draw fewer pixels (down to 55%);
  // when there is room again, climb back toward the quality setting's ratio.
  const AR = { base: 1, cur: 1, ema: 1 / 60, t: 0 };
  function setRatio(v) { AR.cur = v; V.renderer.setPixelRatio(v); V.resize(); }
  function adaptResolution(dt) {
    if (V.adaptive === false || dt <= 0 || dt > 0.25) return;
    AR.ema += (dt - AR.ema) * 0.05;
    AR.t += dt;
    // Still slow after 4 s: the sun's moving shadows are the biggest single
    // cost on integrated graphics, so freeze them (the block keeps its shadows).
    AR.slow = AR.ema > 1 / 45 ? (AR.slow || 0) + dt : 0;
    if (AR.slow > 4 && V.shadowMode === "dynamic") { V.setShadowMode("static"); V.autoStatic = true; AR.slow = 0; }
    if (AR.t < 1.5) return;
    AR.t = 0;
    if (AR.ema > 1 / 48 && AR.cur > AR.base * 0.55) setRatio(Math.max(AR.base * 0.55, AR.cur * 0.85));
    else if (AR.ema < 1 / 62 && AR.cur < AR.base) setRatio(Math.min(AR.base, AR.cur * 1.08));
  }
  V.pixelRatio = function () { return AR.cur; };
  V.fps = function () { return 1 / AR.ema; };

  V.setQuality = function (q) {
    V.quality = q;
    const dpr = window.devicePixelRatio || 1;
    AR.base = AR.cur = q === "low" ? Math.min(dpr, 1) : q === "medium" ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
    V.renderer.setPixelRatio(AR.cur);
    V.setShadowMode(q === "high" ? "dynamic" : q === "medium" ? "static" : "off", true);
    const size = q === "high" ? 2048 : 1024;
    if (V.sun.shadow.mapSize.x !== size) {
      V.sun.shadow.mapSize.set(size, size);
      if (V.sun.shadow.map) { V.sun.shadow.map.dispose(); V.sun.shadow.map = null; }
    }
    V.scene.traverse(function (o) { if (o.material && o.material.needsUpdate !== undefined) o.material.needsUpdate = true; });
    V.resize();
  };

  // Shadows: "dynamic" (everything, redrawn every other frame), "static" (the
  // block only, drawn once), "off".
  V.setShadowMode = function (mode, quiet) {
    const was = V.shadowMode;
    V.shadowMode = mode;
    const on = mode !== "off";
    V.renderer.shadowMap.enabled = on;
    V.sun.castShadow = on;
    V.shadowDirty = true;
    SP.Models.setCharShadows(mode === "dynamic");
    if (!quiet && (was === "off") !== (mode === "off")) V.scene.traverse(function (o) { if (o.material && o.material.needsUpdate !== undefined) o.material.needsUpdate = true; });
  };

  V.resize = function () {
    const w = window.innerWidth, h = window.innerHeight;
    V.renderer.setSize(w, h, false);
    V.camera.aspect = w / h;
    V.baseFov = w < h ? 86 : 70;
    V.camera.updateProjectionMatrix();
  };

  // cam: {x,y,z,yaw,pitch,roll,fov (absolute, optional), fovAdd}
  V.render = function (dt, t, cam, sim) {
    updateParticles(dt);
    updateFx(dt);
    V.updateFlames(t, dt);
    if (sim) { V.updatePickups(sim, t); V.updatePoints(sim, t); V.updateProjectiles(sim, dt); }
    const c = V.camera;
    c.position.set(cam.x, cam.y, cam.z);
    c.rotation.set(cam.pitch, -cam.yaw - Math.PI / 2, cam.roll || 0);
    const fov = cam.fov || (V.baseFov + (cam.fovAdd || 0));
    if (Math.abs(c.fov - fov) > 0.01) { c.fov = fov; c.updateProjectionMatrix(); }
    const r = V.renderer;
    V.frame = (V.frame || 0) + 1;
    r.shadowMap.autoUpdate = false;
    r.shadowMap.needsUpdate = V.shadowMode === "dynamic" ? (V.frame & 1) === 0 : !!V.shadowDirty;
    V.shadowDirty = false;
    adaptResolution(dt);
    r.clear();
    r.render(V.scene, c);
  };

  // World point -> CSS pixels (null if behind the camera).
  const PV = new THREE.Vector3();
  V.project = function (x, y, z) {
    PV.set(x, y, z).project(V.camera);
    if (PV.z > 1 || PV.z < -1) return null;
    return { x: (PV.x * 0.5 + 0.5) * window.innerWidth, y: (-PV.y * 0.5 + 0.5) * window.innerHeight };
  };

  SP.View = V;
})(globalThis.SP);
