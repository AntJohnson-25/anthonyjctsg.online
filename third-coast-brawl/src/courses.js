// The three events, one per sport, each a Houston location built for it:
//   DOWNTOWN DROP (inline skates): diagonal downtown streets, a parking-garage cut-through, the
//     park with its kickers, the market stair set, the hill down to the bayou promenade at sunset.
//   BAYOU BENDS (mountain bike): live-oak singletrack with bermed turns, a root garden, a creek
//     crossing, a cypress-swamp boardwalk, the pine drops and a jump line.
//   SHIP CHANNEL SCRAMBLE (dirt bike): the starting gate, container canyon, whoops, a mud pit under
//     the freeway, the refinery run with its tabletops and a double, rollers, the sand, the levee.
// Each definition gives the path, elevation, the cross-section on the ribbon (prof), the ground
// either side, the road texture, colours, walls, and the surfaces that slow you down.
(function (RR) {
  "use strict";
  const sm = function (a, b, x) { return RR.smoothstep(a, b, x); };
  function win(s, a, b, f) { return sm(a - f, a, s) * (1 - sm(b, b + f, s)); }
  function inR(s, r) { return s >= r[0] && s <= r[1]; }
  function table(s, s0, up, top, down, h) {
    const u = s - s0;
    if (u <= 0 || u >= up + top + down) return 0;
    if (u < up) return h * Math.pow(u / up, 1.5);
    if (u < up + top) return h;
    const t = (u - up - top) / down; return h * (1 - t * t * (3 - 2 * t));
  }
  // a take-off: a curved face up to a lip, then a steep back side (the gap of a double)
  function takeoff(s, s0, up, h, back) {
    const u = s - s0;
    if (u <= 0 || u >= up + back) return 0;
    return u < up ? h * Math.pow(u / up, 1.5) : h * (1 - (u - up) / back);
  }
  function landing(s, s0, face, h, down) {
    const u = s - s0;
    if (u <= 0 || u >= face + down) return 0;
    if (u < face) return h * u / face;
    const t = (u - face) / down; return h * (1 - t * t * (3 - 2 * t));
  }
  function byS(a, b) { return a[0] - b[0]; }
  const fbm = function (x, y, o) { return RR.fbm2(x, y, o); };
  const lerp = function (a, b, t) { return a + (b - a) * t; };
  function mix3(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

  // ---------- road textures ----------
  function px(lat, E, w) { return (lat + E) / (2 * E) * w; }
  function bothSides(fn) { fn(1); fn(-1); }

  // =====================================================================
  // DOWNTOWN DROP: inline skates
  // =====================================================================
  const SK_HW = 8, SK_E = SK_HW + 1.6;
  const skate = {
    key: "skate", sport: "skate", name: "DOWNTOWN DROP", place: "DOWNTOWN HOUSTON", sky: "dusk", music: "skate",
    blurb: "Inline skates. Main Street, the garage cut-through, the park kickers, the market stairs, then down to the bayou.",
    path: RR.legPath([0, 40], [[0, 70, 14], [-45, 250, 15], [45, 200, 15], [-45, 230, 16], [45, 200, 18], [-45, 210, 22], [-15, 130, 30], [15, 150, 30], [0, 150]], 15),
    HW: SK_HW, shoulder: 1.6, top: 30, runout: 70, bankK: 0, bankMax: 0, margin: 150, blend: [2, 26],
    roadGrain: 0.012, groundGrain: 0.012, roadRough: 0.88,
    sections: function (tr) {
      const c = tr.cornerS;
      const S = {
        start: 30, main: [c[0], c[1]], garage: [c[1] + 45, c[2] - 35], park: [c[2] + 18, c[3] - 18],
        market: [c[3] + 15, c[4] - 12], funbox: c[3] + 50, stairs: c[3] + 128, hill: [c[4] + 12, c[5] - 12],
        prom: [c[5] + 8, tr.L], bridges: [c[5] + 78, c[6] + 92], corners: c
      };
      S.waterY = tr.elev(c[5] + 8) - 2.6;
      return S;
    },
    grades: function (tr) {
      const c = tr.cornerS, st = c[3] + 128;
      return [[0, 0.004], [st - 0.6, 0.004], [st, 1.25], [st + 1.3, 1.25], [st + 1.9, 0.004], [c[4] + 5, 0.006], [c[4] + 18, 0.08], [c[5] - 14, 0.08], [c[5] + 4, 0.006], [tr.L + 1, 0.004]].sort(byS);
    },
    street: function (s, S) { return !(inR(s, S.park) || s > S.prom[0] - 4); },
    prof: function (s, lat, bank, C) {
      const S = C.S, a = Math.abs(lat), HW = SK_HW;
      let h;
      if (a <= HW) h = 0.12 * (1 - (lat / HW) * (lat / HW));
      else if (this.street(s, S)) h = a - HW < 0.45 ? -0.03 : 0.15;
      else h = -0.03;
      // the garage floor is flat
      const gw = win(s, S.garage[0], S.garage[1], 4);
      if (gw > 0 && a <= HW) h *= 1 - gw;
      // a concrete funbox across the middle lanes of the market
      h += table(s, S.funbox, 3.5, 4.5, 3.5, 0.85) * (1 - sm(3.8, 5.2, a));
      return h;
    },
    side: function (s, lat, d, x, z, C) {
      const S = C.S;
      if (s > S.prom[0] - 20) {
        const k = sm(S.prom[0] - 20, S.prom[0] + 6, s);
        return k * (lat < 0 ? -Math.min(2.6, d * 0.42) : Math.min(3.5, d * 0.3));
      }
      if (inR(s, S.park)) return (fbm(x * 0.1, z * 0.1, 2) - 0.5) * 0.35 * Math.min(1, d / 4);
      return 0;
    },
    far: function (x, z, lat, s, C) {
      const S = C.S;
      if (s > S.prom[0] - 40) {
        const k = sm(S.prom[0] - 40, S.prom[0] + 10, s);
        const water = (S.waterY - 1.4) - C.track.elev(s);
        const wl = sm(-14, -26, lat), up = sm(14, 40, lat);
        return lerp(0.15, water, wl * k) + 3.6 * up * k;
      }
      return 0.15;
    },
    roadTextures: function () {
      const E = SK_E, HW = SK_HW, W = 512, H = 1024, tile = 16, pv = H / tile;
      const street = RR.canvasTex(W, H, function (g) {
        const rnd = RR.rng(11);
        g.fillStyle = "#3a3b3f"; g.fillRect(0, 0, W, H);
        RR.speckle(g, W, H, 26000, ["#2b2c2f", "#47484c", "#525357", "#303135", "#3f4044"], 1, 2.2, rnd);
        RR.blotch(g, W, H, 14, "rgba(18,18,20,0.28)", 30, 90, rnd);
        RR.blotch(g, W, H, 8, "rgba(120,118,112,0.12)", 30, 80, rnd);
        // tar snakes over old cracks
        g.strokeStyle = "rgba(14,14,16,0.75)"; g.lineWidth = 2.5;
        for (let k = 0; k < 10; k++) { let x = rnd() * W, y = rnd() * H; g.beginPath(); g.moveTo(x, y); for (let i = 0; i < 8; i++) { x += (rnd() - 0.5) * 40; y += (rnd() - 0.2) * 30; g.lineTo(x, y); } g.stroke(); }
        const line = function (lat, wm, col, dash) {
          g.fillStyle = col;
          const x = px(lat, E, W) - wm * W / (2 * E) / 2, ww = wm * W / (2 * E);
          if (!dash) g.fillRect(x, 0, ww, H);
          else for (let v = 0; v < tile; v += 8) g.fillRect(x, v * pv, ww, 4 * pv);
        };
        line(-0.16, 0.12, "#e8b51c"); line(0.16, 0.12, "#e8b51c");
        bothSides(function (sg) { line(sg * 4, 0.14, "#e9e7e0", true); line(sg * (HW - 0.35), 0.15, "#e9e7e0"); });
        // worn paint
        RR.speckle(g, W, H, 4000, ["#3a3b3f", "#45464a"], 1, 3, rnd);
        bothSides(function (sg) {
          const a = px(sg * HW, E, W), b = px(sg * (HW + 0.45), E, W), c = px(sg * (HW + 0.65), E, W), d = px(sg * E, E, W);
          g.fillStyle = "#86837c"; g.fillRect(Math.min(a, b), 0, Math.abs(b - a), H);
          g.fillStyle = "#bdb8ad"; g.fillRect(Math.min(b, c), 0, Math.abs(c - b), H);
          g.fillStyle = "#a39e94"; g.fillRect(Math.min(c, d), 0, Math.abs(d - c) + 1, H);
          g.fillStyle = "rgba(60,58,54,0.7)";
          for (let v = 0; v < tile; v += 1.6) g.fillRect(Math.min(c, d), v * pv, Math.abs(d - c) + 1, 2);
          for (let v = 0; v < tile; v += 3.2) g.fillRect(Math.min(a, b), v * pv, Math.abs(b - a), 2);
        });
        RR.speckle(g, W, H, 3000, ["rgba(70,66,60,0.4)", "rgba(200,196,188,0.3)"], 1, 2, rnd);
      });
      const trail = RR.canvasTex(W, H, function (g) {
        const rnd = RR.rng(12);
        g.fillStyle = "#b1aa9d"; g.fillRect(0, 0, W, H);
        RR.speckle(g, W, H, 22000, ["#a49d90", "#bab4a8", "#9b9488", "#c2bcb0"], 1, 2, rnd);
        RR.blotch(g, W, H, 12, "rgba(80,74,64,0.18)", 30, 80, rnd);
        g.fillStyle = "rgba(70,66,58,0.75)";
        for (let v = 0; v < tile; v += 4) g.fillRect(0, v * pv, W, 2);
        g.fillStyle = "#e0b21e";
        for (let v = 0; v < tile; v += 8) g.fillRect(px(0, E, W) - 2, v * pv, 4, 4 * pv);
        bothSides(function (sg) {
          for (let y = 0; y < H; y += 2) {
            const e = px(sg * (HW + 0.15 + Math.sin(y * 0.05) * 0.12 + (rnd() - 0.5) * 0.15), E, W);
            g.fillStyle = rnd() < 0.5 ? "#4d6a2c" : "#5b7834";
            if (sg > 0) g.fillRect(e, y, W - e, 2); else g.fillRect(0, y, e, 2);
          }
        });
        RR.speckle(g, W, H, 900, ["#8a6a3a", "#6a4a2a", "#a07a40"], 2, 4, rnd);
      });
      const garage = RR.canvasTex(W, H, function (g) {
        const rnd = RR.rng(13);
        g.fillStyle = "#8b8985"; g.fillRect(0, 0, W, H);
        RR.speckle(g, W, H, 16000, ["#82807c", "#94928e", "#7c7a76"], 1, 2, rnd);
        RR.blotch(g, W, H, 22, "rgba(30,28,26,0.35)", 12, 46, rnd);
        g.fillStyle = "#e8b51c";
        bothSides(function (sg) {
          for (let v = 0; v < tile; v += 3.2) g.fillRect(Math.min(px(sg * (HW - 5.2), E, W), px(sg * (HW - 0.2), E, W)), v * pv, Math.abs(px(sg * 5, E, W) - px(0, E, W)), 4);
        });
        g.fillStyle = "#e9e7e0";
        for (let v = 0; v < tile; v += 8) g.fillRect(px(0, E, W) - 2, v * pv, 4, 4 * pv);
        // painted arrows
        g.fillStyle = "rgba(235,233,224,0.85)";
        [-1.6, 1.6].forEach(function (lat) {
          const x = px(lat, E, W), y = 10 * pv;
          g.beginPath(); g.moveTo(x, y - 60); g.lineTo(x + 14, y - 30); g.lineTo(x + 5, y - 30); g.lineTo(x + 5, y + 40); g.lineTo(x - 5, y + 40); g.lineTo(x - 5, y - 30); g.lineTo(x - 14, y - 30); g.closePath(); g.fill();
        });
        bothSides(function (sg) { const a = px(sg * HW, E, W), d = px(sg * E, E, W); g.fillStyle = "#5c5a56"; g.fillRect(Math.min(a, d), 0, Math.abs(d - a) + 1, H); });
      });
      return { tile: tile, maps: [street, trail, garage] };
    },
    roadVariant: function (s, C) { const S = C.S; return inR(s, S.garage) ? 2 : (inR(s, S.park) || s > S.prom[0] - 4) ? 1 : 0; },
    roadTint: function () { return [1, 1, 1]; },
    groundColor: function (x, z, d, ny, s, lat, C) {
      const S = C.S, n = fbm(x * 0.08, z * 0.08, 3);
      if (d >= 999) return [0.4 + n * 0.05, 0.4 + n * 0.05, 0.4 + n * 0.04];
      if (inR(s, S.park)) return [0.28 + n * 0.1, 0.41 + n * 0.12, 0.16 + n * 0.04];
      if (s > S.prom[0] - 10) {
        if (d < 0.5) return [0.6, 0.58, 0.54];
        if (lat < 0 && d > 5.5) return mix3([0.3, 0.4, 0.18], [0.3, 0.27, 0.21], sm(5.5, 8, d));
        return [0.3 + n * 0.08, 0.42 + n * 0.1, 0.18];
      }
      if (d < 4.3) return [0.62 + n * 0.04, 0.6 + n * 0.04, 0.56 + n * 0.04];
      return [0.34 + n * 0.08, 0.34 + n * 0.08, 0.35 + n * 0.08];
    },
    wall: function (s, C) {
      const S = C.S, HW = SK_HW;
      if (inR(s, S.garage)) return [HW + 0.5, HW + 0.5];
      if (inR(s, S.park)) return [HW + 15, HW + 15];
      if (s > S.prom[0]) return [HW + 2.2, HW + 7];
      return [HW + 4.2, HW + 4.2];
    },
    ceil: function (s, C) { return inR(s, C.S.garage) ? 3.3 : 0; },
    surface: function (s, lat, C) {
      if (inR(s, C.S.park) && Math.abs(lat) > SK_HW + 0.8) return SURF.grass;
      return SURF.ok;
    }
  };

  // =====================================================================
  // BAYOU BENDS: mountain bike
  // =====================================================================
  const MB_HW = 5.5, MB_E = MB_HW + 1.3;
  const mtb = {
    key: "mtb", sport: "mtb", name: "BAYOU BENDS", place: "MEMORIAL PARK TRAILS", sky: "morning", music: "mtb",
    blurb: "Mountain bike. Live-oak berms, the root garden, the creek, the swamp boardwalk, the pine drops and the jump line.",
    path: RR.legPath([0, 40], [[0, 60, 20], [30, 110, 24], [-25, 120, 24], [35, 100, 22], [-40, 110, 22], [15, 150, 26], [-30, 120, 24], [40, 110, 24], [-20, 140, 26], [25, 120, 24], [-10, 170, 30], [0, 150]], 22),
    HW: MB_HW, shoulder: 1.3, top: 40, runout: 60, bankK: 9, bankMax: 0.28, margin: 160, blend: [5, 45],
    roadGrain: 0.022, groundGrain: 0.025, roadRough: 0.95,
    sections: function (tr) {
      const c = tr.cornerS;
      const S = {
        start: 28, meadow: [0, c[0] + 25], oaks: [c[0] + 25, c[2] + 10], roots: [c[2] + 22, c[3] - 14], creek: c[3] + 48,
        board: [c[4] + 18, c[5] - 32], pines: [c[5] - 10, c[7]], drops: [c[6] - 34, c[6] + 46],
        tables: [c[8] + 22, c[8] + 52, c[8] + 82], final: [c[9], tr.L], corners: c
      };
      S.swampY = tr.elev((S.board[0] + S.board[1]) / 2) - 0.9;
      S.creekY = tr.elev(S.creek) - 0.95;
      return S;
    },
    grades: function (tr) {
      const c = tr.cornerS, d1 = c[6] - 34, d2 = c[6] + 46;
      const G = [[0, 0.01], [c[0] + 20, 0.03], [c[5] - 15, 0.03], [c[5], 0.07], [c[7], 0.07], [c[7] + 15, 0.025], [c[9], 0.02], [tr.L + 1, 0.01]];
      [d1, d2].forEach(function (d) { G.push([d - 0.5, 0.07], [d, 1.2], [d + 1.1, 1.2], [d + 1.6, 0.07]); });
      return G.sort(byS);
    },
    prof: function (s, lat, bank, C) {
      const S = C.S, a = Math.abs(lat), HW = MB_HW, E = MB_E, lc = RR.clamp(lat, -E, E);
      let h = 0.2 * Math.pow(Math.min(a, HW) / HW, 2) - bank * lc;
      if (a > HW) h += 0.14 * (a - HW) / 1.3;
      const rw = win(s, S.roots[0], S.roots[1], 6);
      if (rw > 0) h += rw * (0.17 * Math.pow(Math.max(0, Math.sin(s * 1.9 + lat * 0.5)), 4) + 0.07 * Math.sin(s * 0.7 - lat * 0.9));
      const dc = (s - S.creek) / 11;
      if (Math.abs(dc) < 1) h -= 1.25 * Math.pow(Math.cos(dc * Math.PI / 2), 2);
      const bw = win(s, S.board[0], S.board[1], 1.5);
      if (bw > 0) h = h * (1 - bw) + 0.45 * bw;
      const tw = 1 - sm(HW - 0.5, HW + 0.8, a);
      S.tables.forEach(function (t0) { h += table(s, t0, 4, 6, 10, 1.5) * tw; });
      return h;
    },
    side: function (s, lat, d, x, z, C) {
      const S = C.S, bw = win(s, S.board[0], S.board[1], 3);
      const creek = -1.3 * Math.exp(-Math.pow((s - S.creek) / 9, 2)) * (1 - Math.exp(-d / 1.5));
      const woods = 0.35 * (1 - Math.exp(-d / 2)) + (fbm(x * 0.15, z * 0.15, 2) - 0.5) * 0.6 * Math.min(1, d / 5);
      return woods * (1 - bw) - 1.15 * (1 - Math.exp(-d / 1.2)) * bw + creek;
    },
    far: function (x, z, lat, s, C) {
      const S = C.S;
      let h = 1.2 + (fbm(x * 0.006 + 5, z * 0.006, 4) - 0.5) * 14 + (fbm(x * 0.03, z * 0.03, 2) - 0.5) * 1.5;
      const sw = win(s, S.board[0] - 10, S.board[1] + 10, 25) * (1 - sm(50, 90, Math.abs(lat)));
      h = lerp(h, S.swampY - 0.5 - C.track.elev(s), sw);
      const ck = Math.exp(-Math.pow((s - S.creek) / 7, 2));
      h = lerp(h, S.creekY - 0.7 - C.track.elev(s), ck);
      return h;
    },
    roadTextures: function () {
      const E = MB_E, HW = MB_HW, W = 512, H = 512, tile = 12;
      const dirt = RR.canvasTex(W, H, function (g) {
        const rnd = RR.rng(21);
        g.fillStyle = "#76573a"; g.fillRect(0, 0, W, H);
        RR.blotch(g, W, H, 30, "rgba(150,112,72,0.25)", 20, 70, rnd);
        RR.blotch(g, W, H, 30, "rgba(50,34,20,0.25)", 20, 60, rnd);
        // ruts: periodic in v so the tile repeats cleanly
        [[-3.0, 1.1, 1], [-1.2, 0.8, 2], [1.0, 1.0, 1], [2.9, 0.7, 2]].forEach(function (r, k) {
          for (let y = 0; y < H; y++) {
            const lat = r[0] + Math.sin(y / H * Math.PI * 2 * r[2] + k) * 0.4, x = px(lat, E, W), w2 = r[1] * W / (2 * E) / 2;
            const gr = g.createLinearGradient(x - w2, 0, x + w2, 0);
            gr.addColorStop(0, "rgba(60,40,24,0)"); gr.addColorStop(0.5, "rgba(60,40,24,0.45)"); gr.addColorStop(1, "rgba(60,40,24,0)");
            g.fillStyle = gr; g.fillRect(x - w2, y, 2 * w2, 1);
          }
        });
        RR.speckle(g, W, H, 9000, ["#5e4430", "#8d6a48", "#9c7a56", "#4a3424", "#b09070"], 1, 3, rnd);
        bothSides(function (sg) {
          for (let y = 0; y < H; y += 2) {
            const e = px(sg * (HW - 0.3 + Math.sin(y * 0.07) * 0.25 + (rnd() - 0.5) * 0.3), E, W);
            g.fillStyle = rnd() < 0.5 ? "#5a5030" : "#4e4a2c";
            if (sg > 0) g.fillRect(e, y, W - e, 2); else g.fillRect(0, y, e, 2);
          }
        });
        RR.speckle(g, W, H, 2500, ["#a8642a", "#c08040", "#6d7a32", "#8a4a20", "#3d4a1c"], 2, 4, rnd);
      });
      return { tile: tile, maps: [dirt] };
    },
    roadVariant: function () { return 0; },
    roadTint: function (s, lat, C) {
      const S = C.S;
      const wet = 1 - 0.42 * Math.exp(-Math.pow((s - S.creek) / 12, 2));
      const rw = 1 - 0.1 * win(s, S.roots[0], S.roots[1], 6);
      return [wet * rw, wet * rw * 0.98, wet * rw * 0.96];
    },
    groundColor: function (x, z, d, ny, s, lat, C) {
      const S = C.S, n = fbm(x * 0.07, z * 0.07, 3), n2 = fbm(x * 0.4, z * 0.4, 2);
      if (d >= 999) return [0.2 + n * 0.06, 0.24 + n * 0.08, 0.13];
      if (inR(s, S.meadow)) return [0.34 + n * 0.1, 0.46 + n * 0.12, 0.19];
      const bw = win(s, S.board[0], S.board[1], 8);
      if (bw > 0.3) return mix3([0.25, 0.27, 0.16], [0.17, 0.2, 0.13], n);
      if (Math.abs(s - S.creek) < 14) return [0.3 + n * 0.06, 0.26 + n * 0.05, 0.18];
      const litter = mix3([0.34, 0.28, 0.18], [0.24, 0.3, 0.14], n2);
      return d < 1.4 ? mix3([0.42, 0.32, 0.22], litter, d / 1.4) : litter;
    },
    wall: function (s, C) {
      const S = C.S, HW = MB_HW;
      if (inR(s, S.board)) return [HW + 0.35, HW + 0.35];
      if (inR(s, S.meadow)) return [HW + 16, HW + 16];
      return [HW + 5.5, HW + 5.5];
    },
    ceil: function () { return 0; },
    surface: function (s, lat, C) {
      if (Math.abs(s - C.S.creek) < 8) return SURF.water;
      if (Math.abs(lat) > MB_HW + 0.8) return SURF.litter;
      return SURF.ok;
    }
  };

  // =====================================================================
  // SHIP CHANNEL SCRAMBLE: dirt bike
  // =====================================================================
  const MX_HW = 8.5, MX_E = MX_HW + 1.5;
  const moto = {
    key: "moto", sport: "moto", name: "SHIP CHANNEL SCRAMBLE", place: "EAST END · SHIP CHANNEL", sky: "smog", music: "moto",
    blurb: "Dirt bike. Container canyon, the whoops, mud under the freeway, refinery tabletops, the double and the levee.",
    path: RR.legPath([0, 40], [[0, 120, 28], [50, 200, 30], [-40, 230, 30], [30, 190, 30], [-55, 210, 32], [20, 230, 30], [-35, 200, 30], [45, 190, 30], [-15, 250, 34], [10, 210, 30], [0, 170]], 30),
    HW: MX_HW, shoulder: 1.5, top: 12, runout: 70, bankK: 11, bankMax: 0.32, margin: 170, blend: [6, 40],
    roadGrain: 0.022, groundGrain: 0.02, roadRough: 0.97,
    sections: function (tr) {
      const c = tr.cornerS;
      const S = {
        start: 32, gate: 30, containers: [c[1] + 25, c[2] - 30], whoops: [c[2] + 30, c[2] + 132],
        overpass: [c[3] - 72, c[3] - 6], mud: [c[3] - 56, c[3] - 22], refinery: [c[4] - 20, c[7]],
        t1: c[4] + 70, t2: c[5] + 58, dbl: c[6] + 48, rollers: [c[7] + 22, c[7] + 152], sand: [c[8] + 10, c[9] - 10],
        levee: c[8], corners: c
      };
      S.waterY = tr.elev(tr.L - 40) - 3.2;
      return S;
    },
    grades: function (tr) {
      const c = tr.cornerS;
      return [[0, 0], [c[1], 0.01], [c[3], -0.008], [c[5], 0.012], [c[7], -0.006], [c[9], 0.006], [tr.L + 1, 0]];
    },
    prof: function (s, lat, bank, C) {
      const S = C.S, a = Math.abs(lat), HW = MX_HW, E = MX_E, lc = RR.clamp(lat, -E, E);
      let h = 0.28 * Math.pow(Math.min(a, HW) / HW, 2) - bank * lc;
      if (a > HW) h += 0.38 * (a - HW) / 1.5;
      const ww = win(s, S.whoops[0], S.whoops[1], 3);
      if (ww > 0) h += ww * 0.75 * 0.5 * (1 - Math.cos(2 * Math.PI * (s - S.whoops[0]) / 8.5));
      const rw = win(s, S.rollers[0], S.rollers[1], 4);
      if (rw > 0) h += rw * 1.0 * 0.5 * (1 - Math.cos(2 * Math.PI * (s - S.rollers[0]) / 13));
      const tw = 1 - sm(HW + 0.2, E, a);
      h += tw * (table(s, S.t1, 7, 14, 14, 2.4) + table(s, S.t2, 8, 18, 16, 3.0) + takeoff(s, S.dbl, 7, 2.4, 3) + landing(s, S.dbl + 26, 3, 2.4, 14));
      h -= 0.25 * win(s, S.mud[0], S.mud[1], 4) * (1 - sm(HW - 1, HW, a));
      return h;
    },
    side: function (s, lat, d, x, z, C) {
      const S = C.S, flat = Math.max(win(s, S.containers[0], S.containers[1], 8), win(s, S.overpass[0], S.overpass[1], 8) * 0.6);
      const berm = 1.3 * Math.exp(-Math.pow((d - 1.6) / 1.5, 2)) + 0.3 * (1 - Math.exp(-d / 4)) + (fbm(x * 0.12, z * 0.12, 2) - 0.5) * 0.4 * Math.min(1, d / 4);
      return berm * (1 - flat) + 0.05 * flat;
    },
    far: function (x, z, lat, s, C) {
      const S = C.S;
      let h = 0.3 + (fbm(x * 0.01, z * 0.01, 3) - 0.5) * 1.6;
      const k = sm(S.levee - 80, S.levee, s);
      if (k > 0) {
        h += k * 3.2 * Math.exp(-Math.pow((lat - 46) / 10, 2));
        h = lerp(h, S.waterY - 2.5 - C.track.elev(s), k * sm(58, 70, lat));
      }
      return h;
    },
    roadTextures: function () {
      const E = MX_E, HW = MX_HW, W = 512, H = 512, tile = 14;
      const dirt = RR.canvasTex(W, H, function (g) {
        const rnd = RR.rng(31);
        g.fillStyle = "#97734e"; g.fillRect(0, 0, W, H);
        RR.blotch(g, W, H, 40, "rgba(190,150,104,0.22)", 20, 70, rnd);
        RR.blotch(g, W, H, 34, "rgba(70,50,32,0.22)", 20, 60, rnd);
        // tyre tracks: many thin lines through the racing lines
        for (let k = 0; k < 26; k++) {
          const lat0 = (rnd() - 0.5) * 2 * (HW - 1), f = 1 + Math.floor(rnd() * 2), amp = 0.3 + rnd() * 1.2, ph = rnd() * 6.28;
          g.strokeStyle = "rgba(62,44,28," + (0.25 + rnd() * 0.3) + ")"; g.lineWidth = 2 + rnd() * 3;
          g.beginPath();
          for (let y = 0; y <= H; y += 8) { const x = px(lat0 + Math.sin(y / H * Math.PI * 2 * f + ph) * amp, E, W); if (!y) g.moveTo(x, y); else g.lineTo(x, y); }
          g.stroke();
        }
        RR.speckle(g, W, H, 12000, ["#6e5236", "#b08a62", "#80603e", "#4e3824", "#c4a07a"], 1, 3.5, rnd);
        bothSides(function (sg) {
          const a = px(sg * HW, E, W), d = px(sg * E, E, W);
          const gr = g.createLinearGradient(a, 0, d, 0);
          gr.addColorStop(0, "rgba(90,64,40,0)"); gr.addColorStop(1, "rgba(90,64,40,0.6)");
          g.fillStyle = gr; g.fillRect(Math.min(a, d), 0, Math.abs(d - a) + 1, H);
        });
      });
      return { tile: tile, maps: [dirt] };
    },
    roadVariant: function () { return 0; },
    roadTint: function (s, lat, C) {
      const S = C.S;
      const mud = win(s, S.mud[0] - 6, S.mud[1] + 6, 6);
      const sand = win(s, S.sand[0], S.sand[1], 10);
      const w = win(s, S.whoops[0], S.whoops[1], 4) * 0.08;
      return [lerp(lerp(1 + w, 1.14, sand), 0.42, mud), lerp(lerp(1 + w, 1.1, sand), 0.36, mud), lerp(lerp(1 + w, 1.0, sand), 0.3, mud)];
    },
    groundColor: function (x, z, d, ny, s, lat, C) {
      const S = C.S, n = fbm(x * 0.06, z * 0.06, 3), n2 = fbm(x * 0.3, z * 0.3, 2);
      if (d >= 999) return [0.48 + n * 0.08, 0.43 + n * 0.07, 0.34];
      const k = sm(S.levee - 80, S.levee, s);
      if (k > 0.3 && lat > 36 && lat < 60) return [0.36 + n * 0.08, 0.4 + n * 0.08, 0.22];
      const pad = Math.max(win(s, S.containers[0], S.containers[1], 10), win(s, S.refinery[0], S.refinery[1], 10)) * sm(10, 16, d);
      const dirt = mix3([0.55, 0.45, 0.33], [0.48, 0.46, 0.3], n2 * sm(4, 14, d));
      return mix3(dirt, [0.53 + n * 0.06, 0.52 + n * 0.06, 0.5 + n * 0.05], pad);
    },
    wall: function (s, C) {
      const S = C.S, HW = MX_HW;
      if (inR(s, S.containers)) return [HW + 1.4, HW + 1.4];
      if (inR(s, S.overpass)) return [HW + 3.5, HW + 3.5];
      return [HW + 5, HW + 5];
    },
    ceil: function () { return 0; },
    surface: function (s, lat, C) {
      const S = C.S;
      if (inR(s, S.mud) && Math.abs(lat) < MX_HW) return SURF.mud;
      if (inR(s, S.sand)) return SURF.sand;
      if (Math.abs(lat) > MX_HW + 1.5) return SURF.rough;
      return SURF.ok;
    }
  };

  const SURF = {
    ok: { k: 1, kind: "" }, grass: { k: 0.72, kind: "grass" }, litter: { k: 0.8, kind: "litter" }, water: { k: 0.66, kind: "water" },
    mud: { k: 0.6, kind: "mud" }, sand: { k: 0.92, kind: "sand" }, rough: { k: 0.84, kind: "rough" }
  };

  RR.COURSES = { skate: skate, mtb: mtb, moto: moto };
  RR.COURSE_ORDER = ["skate", "mtb", "moto"];
})(window.RR = window.RR || {});
