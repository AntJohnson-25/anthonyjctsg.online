// The HUD: shift clock, score + combo, stamina, the tray of parcels you're carrying (the
// selected one is the one you'll leave), the scanner's arrow, prompts and call-outs.
globalThis.WD = globalThis.WD || {};
(function (WD) {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const H = { toastT: 0, trayKey: "" };

  H.init = function () {};
  H.show = function (on) { $("hud").classList.toggle("hidden", !on); };
  const mmss = (t) => { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };

  H.toast = function (text, kind, t) {
    const el = $("toast");
    el.textContent = text; el.className = "show " + (kind || "");
    H.toastT = t || 1.8;
  };
  H.big = function (text, sub) { $("big").textContent = text || ""; $("bigSub").textContent = sub || ""; };

  H.event = function (e, sim) {
    if (e.t === "deliver") H.toast("+" + e.pts + (e.valuable ? "  ★ valuable" : "") + (e.combo > 1 ? "   ×" + e.combo + " combo" : ""), "good", 1.3);
    else if (e.t === "wrong") {
      const t = WD.CFG.WRONG_T;
      if (e.out === "keep") H.toast("#" + e.unit + " kept the valuable parcel!   −" + t + "s  −" + WD.CFG.KEEP_PEN, "bad", 3);
      else if (e.out === "dog") H.toast("#" + e.unit + "'s dog is out: RUN!   −" + t + "s", "bad", 2.6);
      else if (e.out === "angry") H.toast("#" + e.unit + " is furious: RUN!   −" + t + "s", "bad", 2.6);
      else H.toast("\"I'm " + e.unit + ", not " + e.want + "!\"   −" + t + "s", "bad", 2.2);
    }
    else if (e.t === "bite") H.toast("Bitten!   −" + WD.CFG.DOGC_HIT_T + "s", "bad", 1.4);
    else if (e.t === "shove") H.toast("Shoved!   −" + WD.CFG.ANGRY_HIT_T + "s", "bad", 1.4);
    else if (e.t === "load") H.toast("Loaded " + e.n + (e.n === 1 ? " parcel" : " parcels"), "", 1.2);
    else if (e.t === "nodoor") H.toast("No door here", "", 0.9);
    else if (e.t === "empty") H.toast(sim.inVan() ? "Hands empty: back to the van" : "Hands empty", "", 1.1);
    else if (e.t === "scan") H.toast("Scanner: #" + e.unit + " is that way-ish", "", 1.4);
    else if (e.t === "noscan") H.toast(sim.scans <= 0 ? "Scanner's dead" : "Nothing to scan", "", 1);
    else if (e.t === "stagger") { if (e.by === "dog" && !H.toastT) H.toast("The dog!", "bad", 1.2); }
    else if (e.t === "steal") H.toast("Porch pirate took #" + e.unit + "! It's back at the van", "bad", 2.4);
    else if (e.t === "go") H.big("", "");
  };

  // ------------------------------------------------------------------ the handheld's route map (the countdown)
  // A top-down plan of the complex, the route drawing itself from the van through the first trip's stops, the
  // stops numbered in order (▲ = upstairs, gold = valuable). Later trips show as quiet dots.
  function planLayer(sim) {
    if (sim._plan) return sim._plan;
    const L = sim.level, B = sim.cfg.BOUNDS, c = document.createElement("canvas"); c.width = 480; c.height = 416;
    const g = c.getContext("2d"), sx = (x) => (x - B.x0) / (B.x1 - B.x0) * c.width, sz = (z) => (z - B.z0) / (B.z1 - B.z0) * c.height;
    const rect = (r, col) => { g.fillStyle = col; g.fillRect(sx(r[0]), sz(r[2]), sx(r[1]) - sx(r[0]), sz(r[3]) - sz(r[2])); };
    g.fillStyle = "#1d3a27"; g.fillRect(0, 0, c.width, c.height);            // turf
    L.asphalt.forEach((a) => rect(a, "#2a2d33"));
    L.walks.forEach((w) => rect(w, "#3c434b"));
    L.wings.forEach((w) => { rect([w.x0, w.x1, w.z0, w.z1], "#c9b48c"); });
    g.fillStyle = "rgba(20,30,22,0.9)";
    L.trees.forEach((t) => { g.beginPath(); g.arc(sx(t[0]), sz(t[1]), 3, 0, 7); g.fill(); });
    g.fillStyle = "#59606a"; L.solids.forEach((s) => { if (s.kind === "car") g.fillRect(sx(s.x0), sz(s.z0), sx(s.x1) - sx(s.x0), sz(s.z1) - sz(s.z0)); });
    g.fillStyle = "#ff8a1f"; g.fillRect(sx(L.van.x0), sz(L.van.z0), sx(L.van.x1) - sx(L.van.x0), sz(L.van.z1) - sz(L.van.z0));
    L.breezes.forEach((b) => rect([b.x0, b.x1, Math.min(b.oz, b.oz - 10 * b.nz), Math.max(b.oz, b.oz - 10 * b.nz)], "#7a6f58"));
    // door ticks on the door side of every building, then the building letters
    g.fillStyle = "#6d5a3c"; L.doors.forEach((d) => g.fillRect(sx(d.x) - 1, sz(d.z) - (d.nz > 0 ? 0 : 3), 2.4, 3));
    g.font = "800 15px Trebuchet MS, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#3b2f1c";
    L.wings.forEach((w) => g.fillText(w.letter, sx((w.x0 + w.x1) / 2), sz((w.z0 + w.z1) / 2)));
    g.font = "700 9px Trebuchet MS, sans-serif"; g.fillStyle = "#7da98b";
    g.fillText("FRONT LAWN", sx(0), sz(8.6)); g.fillText("COURTYARD", sx(0), sz(-41)); g.fillText("ALLEY", sx(-52), sz(-15)); g.fillText("LOT", sx(-52), sz(24));
    return (sim._plan = c);
  }
  const lettersOf = (sim, unit) => sim.level.doors.find((d) => d.unit === unit);
  function drawDevice(sim, t) {
    const cv = $("deviceMap"), g = cv.getContext("2d"), B = sim.cfg.BOUNDS, trips = sim.plan || [], trip = trips[0];
    const sx = (x) => (x - B.x0) / (B.x1 - B.x0) * cv.width, sz = (z) => (z - B.z0) / (B.z1 - B.z0) * cv.height;
    g.clearRect(0, 0, cv.width, cv.height); g.drawImage(planLayer(sim), 0, 0);
    if (!trip) return;
    // later trips: quiet dots
    trips.slice(1).forEach((tr) => tr.stops.forEach((s) => { g.fillStyle = s.valuable ? "rgba(255,216,74,0.55)" : "rgba(255,255,255,0.4)"; g.beginPath(); g.arc(sx(s.x), sz(s.z), 3.2, 0, 7); g.fill(); }));
    // the first trip's route, drawn along its length as `t` goes 0 -> 1
    const pts = trip.pts, len = [0];
    for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = len[len.length - 1] || 1, upto = total * Math.min(1, t);
    g.lineJoin = g.lineCap = "round";
    const stroke = (w, col) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(sx(pts[0][0]), sz(pts[0][1])); let hx = pts[0][0], hz = pts[0][1];
      for (let i = 1; i < pts.length; i++) { if (len[i] <= upto) { g.lineTo(sx(pts[i][0]), sz(pts[i][1])); hx = pts[i][0]; hz = pts[i][1]; } else { const k = (upto - len[i - 1]) / Math.max(1e-6, len[i] - len[i - 1]); hx = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k; hz = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k; g.lineTo(sx(hx), sz(hz)); break; } }
      g.stroke(); return [hx, hz]; };
    stroke(9, "rgba(255,138,31,0.25)");
    const head = stroke(3.4, "#ff8a1f");
    // the stops, numbered, as the line reaches them
    let reach = 0;
    trip.stops.forEach((s, i) => {
      let best = Infinity, at = 0; pts.forEach((q, k) => { const d = Math.hypot(q[0] - s.x, q[1] - s.z); if (d < best) { best = d; at = k; } });
      if (len[at] > upto + 0.5) return;
      reach++;
      g.fillStyle = s.valuable ? "#ffd84a" : "#ffffff"; g.beginPath(); g.arc(sx(s.x), sz(s.z), 9, 0, 7); g.fill();
      g.strokeStyle = "#1b1712"; g.lineWidth = 2; g.stroke();
      g.fillStyle = "#1b1712"; g.font = "900 11px Trebuchet MS, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(i + 1), sx(s.x), sz(s.z) + 0.5);
    });
    g.fillStyle = "#fff"; g.beginPath(); g.arc(sx(head[0]), sz(head[1]), 5, 0, 7); g.fill();
    g.fillStyle = "#1b1712"; g.font = "800 10px Trebuchet MS, sans-serif"; g.fillText("VAN", sx(sim.level.van.x0 + 2.8), sz(sim.level.van.z0) - 8);
  }
  function deviceHtml(sim) {
    const trip = (sim.plan || [])[0];
    if (!trip) return "";
    return trip.stops.map((s, i) => { const d = lettersOf(sim, s.unit); return '<b class="' + (s.valuable ? "val" : "") + '"><u>' + (i + 1) + "</u>#" + s.unit + " " + d.wing + (d.up ? " ▲" : "") + (s.valuable ? " ★" : "") + "</b>"; }).join("");
  }
  H.device = function (sim) {
    const el = $("device"), on = sim.phase === "countdown";
    if (!on) { el.classList.remove("on"); if (!el.classList.contains("hidden")) el.classList.add("hidden"); H.devSim = null; return; }
    el.classList.remove("hidden");
    const C = sim.cfg.COUNTDOWN, el_t = C - sim.phaseT;
    if (H.devSim !== sim) {
      H.devSim = sim;
      const trips = sim.plan || [];
      $("devTrip").textContent = trips.length > 1 ? "TRIP 1 OF " + trips.length : "ONE TRIP";
      $("devStops").innerHTML = deviceHtml(sim);
    }
    el.classList.toggle("on", el_t > 0.05 && sim.phaseT > 0.25);
    drawDevice(sim, Math.max(0, Math.min(1, (el_t - 0.35) / 1.8)));
    $("devCount").textContent = Math.max(1, Math.ceil(sim.phaseT));
  };

  H.update = function (sim, dt, camYaw) {
    const p = sim.player;
    H.device(sim);
    if (sim.phase === "countdown") H.big(String(Math.ceil(sim.phaseT)), sim.shift.name + ": " + sim.shift.blurb);
    const c = $("clock");
    c.textContent = mmss(sim.clock);
    c.classList.toggle("low", sim.phase === "play" && sim.clock < 20);
    $("score").textContent = sim.score;
    $("combo").textContent = sim.combo > 1 ? "×" + sim.combo : "";
    $("left").textContent = sim.delivered + " / " + sim.packages.length + " delivered";
    $("vanLeft").textContent = sim.inVan() ? sim.inVan() + " in the van" : "van empty";
    $("stamFill").style.width = (p.stamina * 100).toFixed(1) + "%";
    $("stam").classList.toggle("tired", p.stamina < 0.2);
    $("scans").textContent = "SCAN ×" + sim.scans;
    // the tray: rebuilt only when it changes
    const key = p.carry.join(",") + "|" + p.cur;
    if (key !== H.trayKey) {
      H.trayKey = key;
      $("tray").innerHTML = p.carry.map(function (id, i) {
        const k = sim.packages[id];
        return '<div class="card' + (i === p.cur ? " cur" : "") + (k.valuable ? " val" : "") + '"><i>' + (i + 1) + '</i><b>' + k.unit + '</b><span>' + k.name + '</span></div>';
      }).join("");
    }
    // what you can do here
    let hint = "";
    if (sim.phase === "play") {
      const k = sim.current(), d = sim.doorNear(p), touch = WD.Input.touch;
      if (k && d) hint = (touch ? "DROP" : "E") + ": leave #" + k.unit + " here";
      else if (!k && sim.inVan()) hint = "Back to the van for more";
      else if (sim.nearVan() && !sim.inVan() && !p.carry.length) hint = "";
    }
    $("hint").textContent = hint;
    $("hint").classList.toggle("hidden", !hint);
    // the scanner arrow, relative to where the camera looks
    const sy = sim.scanYaw(p), arrow = $("scanArrow");
    if (sy === null) arrow.classList.add("hidden");
    else {
      arrow.classList.remove("hidden");
      const rel = camYaw - sy;
      arrow.style.transform = "translateX(-50%) rotate(" + rel.toFixed(3) + "rad)";
      const d = sim.doorOf(sim.scan.unit);
      $("scanTxt").textContent = "#" + sim.scan.unit + " · " + Math.round(Math.hypot(d.x - p.x, d.z - p.z)) + "m";
    }
    if (H.toastT > 0 && (H.toastT -= dt) <= 0) $("toast").className = "";
  };
  WD.Hud = H;
})(globalThis.WD);
