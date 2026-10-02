// DOM HUD: score bar + timer, minimap, kill feed, medals, score popups,
// crosshair (turns red when a lunge will connect), knife counter, markers on
// loose knives, death screen and the Tab scoreboard.
globalThis.HK = globalThis.HK || {};
(function (HK) {
  "use strict";
  const U = HK.U;
  const H = {};
  const $ = function (id) { return document.getElementById(id); };
  const TEAM = [{ name: "NAVY", color: "#38b6ff" }, { name: "PIRATES", color: "#ff4a2a" }];
  const HOW = { melee: "BLADED", throw: "CUTTIN' UP", fall: "FELL", wave: "ROGUE WAVE" };
  // Words for the death cut when you're the one killed.
  const CUT = { melee: "BLADED", throw: "CUTTIN' UP", fall: "OVERBOARD", wave: "WASHED OUT" };
  H.TEAM = TEAM;

  H.init = function () {
    H.el = {
      hud: $("hud"), sbA: $("sbA"), sbB: $("sbB"), time: $("sbTime"), feed: $("killfeed"), cross: $("cross"),
      hit: $("hitmark"), medals: $("medals"), pops: $("popups"), center: $("centerMsg"), knives: $("knivesHud"),
      k0: $("k0"), k1: $("k1"), toast: $("toast"), markers: $("markers"), death: $("death"), deathName: $("deathName"),
      deathHow: $("deathHow"), deathTimer: $("deathTimer"), vig: $("vignette"), scores: $("scores"), scHead: $("scHead"),
      scBody: $("scBody"), tCount: $("tCount"), mm: $("minimap"), khint: $("khint"),
      callout: $("callout"), cut: $("cut"), cutText: $("cutText"), streak: $("streak")
    };
    H.mmCtx = H.el.mm.getContext("2d");
    H.markerPool = [];
    H.toastT = 0;
  };

  H.setup = function (sim) {
    H.sim = sim;
    H.el.feed.innerHTML = ""; H.el.medals.innerHTML = ""; H.el.pops.innerHTML = "";
    H.el.death.hidden = true; H.el.vig.classList.remove("on");
    H.clearCut();
    H.el.callout.classList.remove("on");
    H.lastKnives = -1;
    H.lastStreak = -1;
    H.drawStatic();
  };

  function row(el, color, name, score, frac) {
    el.querySelector("i").style.background = color;
    el.querySelector(".nm").textContent = name;
    el.querySelector(".sc").textContent = score;
    const b = el.querySelector(".bar b");
    b.style.width = Math.min(100, frac * 100) + "%";
    b.style.background = color;
  }

  H.update = function (sim, dt, info) {
    const me = sim.humanId >= 0 ? sim.players[sim.humanId] : null;
    const e = H.el;
    if (sim.mode === "tdm") {
      row(e.sbA, TEAM[0].color, TEAM[0].name, sim.teamScore[0], sim.teamScore[0] / sim.scoreLimit);
      row(e.sbB, TEAM[1].color, TEAM[1].name, sim.teamScore[1], sim.teamScore[1] / sim.scoreLimit);
    } else if (me) {
      let lead = null;
      sim.players.forEach(function (p) { if (p !== me && (!lead || p.kills > lead.kills)) lead = p; });
      row(e.sbA, "#ffc93a", "YOU", me.kills, me.kills / sim.scoreLimit);
      row(e.sbB, "#cfd6dc", lead.name.toUpperCase(), lead.kills, lead.kills / sim.scoreLimit);
    }
    e.time.textContent = U.fmtTime(sim.timeLeft);
    if (!me) return;

    if (me.knives !== H.lastKnives) {
      if (me.knives > H.lastKnives && H.lastKnives >= 0) { e.knives.classList.remove("flash"); void e.knives.offsetWidth; e.knives.classList.add("flash"); }
      H.lastKnives = me.knives;
      e.k0.classList.toggle("full", me.knives >= 1);
      e.k1.classList.toggle("full", me.knives >= 2);
      e.knives.classList.toggle("empty", me.knives === 0);
      e.tCount.textContent = me.knives;
      e.khint.innerHTML = me.knives ? "ATTACK <kbd>SPACE</kbd>" : "STAB ONLY";
    }
    // Kill streak toward the next Rogue Wave.
    const need = HK.CFG.waveStreak, st = me.alive ? me.streak : 0;
    if (st !== H.lastStreak) {
      H.lastStreak = st;
      const left = need - (st % need);
      e.streak.innerHTML = st ? "STREAK <b>" + st + "</b>" + (left === 1 ? " · <i>1 MORE: ROGUE WAVE</i>" : " · wave in " + left) : "";
      e.streak.classList.toggle("hot", left === 1);
    }
    e.cross.classList.toggle("lunge", !!info.lunge);
    e.cross.classList.toggle("enemy", info.aim >= 0);
    e.cross.style.display = me.alive ? "" : "none";

    // Prematch countdown.
    if (sim.phase === "pre") e.center.innerHTML = Math.ceil(sim.preT) + "<small>" + (sim.mode === "tdm" ? "TEAM DEATHMATCH" : "FREE-FOR-ALL") + " · KNIVES ONLY</small>";
    else if (H.centerT > 0) { H.centerT -= dt; if (H.centerT <= 0) e.center.innerHTML = ""; }
    else e.center.innerHTML = "";

    // Death screen.
    if (!me.alive) {
      e.death.hidden = false;
      e.deathTimer.textContent = "Respawn in " + Math.max(0, me.respawnT).toFixed(1);
    } else if (!e.death.hidden) { e.death.hidden = true; e.vig.classList.remove("on"); H.clearCut(); }

    if (H.toastT > 0) { H.toastT -= dt; if (H.toastT <= 0) e.toast.classList.remove("on"); }

    // Markers over loose knives within reach of a short run.
    let n = 0;
    if (me.alive) {
      for (let i = 0; i < sim.knives.length && n < 10; i++) {
        const k = sim.knives[i];
        if (k.st !== "rest") continue;
        const d = Math.hypot(k.px - me.x, k.py - me.y, k.pz - me.z);
        if (d > 32) continue;
        const s = info.project(k.px, k.py + 0.25, k.pz);
        if (!s || s.x < 0 || s.y < 0 || s.x > window.innerWidth || s.y > window.innerHeight) continue;
        let m = H.markerPool[n];
        if (!m) { m = document.createElement("div"); m.className = "mk"; e.markers.appendChild(m); H.markerPool.push(m); }
        m.style.display = "";
        m.style.left = s.x + "px"; m.style.top = s.y + "px";
        m.style.opacity = d < 6 ? 1 : 0.75;
        m.textContent = Math.round(d) + "m";
        n++;
      }
    }
    for (let i = n; i < H.markerPool.length; i++) H.markerPool[i].style.display = "none";

    // Kill feed ageing.
    const now = performance.now();
    Array.prototype.forEach.call(e.feed.children, function (c) {
      const age = now - c._t;
      if (age > 6000) c.remove(); else if (age > 5200) c.style.opacity = 0;
    });

    H.drawMinimap(sim, me);
    const showScores = HK.Input.scores || H.scoresHeld || sim.over;
    if (showScores && !sim.over) H.renderScores(sim);
    e.scores.hidden = !showScores || sim.over;
  };

  // ------------------------------------------------------------------ minimap
  const MM = { x0: -38, x1: 42, z0: -16, z1: 10.5 };
  function mmXY(x, z) {
    const c = H.el.mm, s = Math.min(c.width / (MM.x1 - MM.x0), c.height / (MM.z1 - MM.z0));
    const ox = (c.width - (MM.x1 - MM.x0) * s) / 2, oy = (c.height - (MM.z1 - MM.z0) * s) / 2;
    return [ox + (x - MM.x0) * s, oy + (z - MM.z0) * s, s];
  }
  H.drawStatic = function () {
    const c = document.createElement("canvas");
    c.width = H.el.mm.width; c.height = H.el.mm.height;
    const g = c.getContext("2d");
    g.fillStyle = "rgba(20,70,100,0.35)"; g.fillRect(0, 0, c.width, c.height);
    g.beginPath();
    HK.MAP.outline(0).forEach(function (p, i) { const q = mmXY(p[0], p[1]); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); });
    g.closePath();
    g.fillStyle = "rgba(196,150,100,0.55)"; g.fill();
    g.strokeStyle = "rgba(255,255,255,0.7)"; g.lineWidth = 1; g.stroke();
    if (HK.MAP.boatOutline) {   // the pirate boat alongside
      g.beginPath();
      HK.MAP.boatOutline(0).forEach(function (p, i) { const q = mmXY(p[0], p[1]); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); });
      g.closePath();
      g.fillStyle = "rgba(70,76,84,0.9)"; g.fill();
      g.strokeStyle = "rgba(200,40,40,0.8)"; g.stroke();
    }
    function rect(x0, x1, z0, z1, fill) { const a = mmXY(x0, z0), b = mmXY(x1, z1); g.fillStyle = fill; g.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); }
    rect(-13, 13, -5.3, 5.3, "rgba(240,240,236,0.75)");
    rect(4, 11, -3.5, 3.5, "rgba(120,130,140,0.9)");
    HK.MAP.deckHoles.forEach(function (h) { rect(h.x0, h.x1, h.z0, h.z1, "rgba(10,20,30,0.85)"); });
    rect(-32, -26, -3, 3, "rgba(60,190,215,0.9)");
    rect(-7.7, -4.3, -1.7, 1.7, "rgba(60,190,215,0.9)");
    rect(25, 30.5, 3.6, 6.6, "rgba(255,255,255,0.6)");
    H.mmStatic = c;
  };
  H.drawMinimap = function (sim, me) {
    const g = H.mmCtx, c = H.el.mm;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(H.mmStatic, 0, 0);
    const level = function (p) { return p.y < -1.5 ? 0.65 : p.y > 2.5 ? 1.25 : 1; };
    sim.players.forEach(function (p) {
      if (!p.alive || p === me) return;
      const enemy = sim.isEnemy(me, p);
      if (enemy && sim.t - p.attackT > 1.6) return;      // enemies show only when they attack
      const q = mmXY(p.x, p.z);
      g.fillStyle = enemy ? "#ff4a2a" : (sim.mode === "tdm" ? "#38b6ff" : "#ddd");
      g.beginPath(); g.arc(q[0], q[1], 2.6 * level(p), 0, Math.PI * 2); g.fill();
    });
    if (me.alive) {
      const q = mmXY(me.x, me.z);
      g.save(); g.translate(q[0], q[1]); g.rotate(me.yaw);
      g.fillStyle = "#ffc93a"; g.strokeStyle = "#000"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(6, 0); g.lineTo(-4, -3.5); g.lineTo(-2, 0); g.lineTo(-4, 3.5); g.closePath(); g.fill(); g.stroke();
      g.restore();
    }
  };

  // ------------------------------------------------------------------ events
  function feed(sim, e) {
    const k = e.killer >= 0 ? sim.players[e.killer] : null, v = sim.players[e.victim];
    const div = document.createElement("div");
    div.className = "kf" + (e.killer === sim.humanId || e.victim === sim.humanId ? " me" : "");
    function nm(p) {
      const col = sim.mode === "tdm" ? TEAM[p.team].color : (p.id === sim.humanId ? "#ffc93a" : "#e9eef2");
      return "<span style='color:" + col + "'>" + (p.id === sim.humanId ? "You" : p.name) + "</span>";
    }
    div.innerHTML = (k && k !== v ? nm(k) : "") + "<span class='how'>" + (HOW[e.how] || "") + "</span>" + nm(v);
    div._t = performance.now();
    H.el.feed.appendChild(div);
    while (H.el.feed.children.length > 5) H.el.feed.firstChild.remove();
  }
  function medal(text, sub) {
    const d = document.createElement("div");
    d.className = "medal";
    d.innerHTML = text + (sub ? "<small>" + sub + "</small>" : "");
    H.el.medals.appendChild(d);
    setTimeout(function () { d.remove(); }, 1900);
    while (H.el.medals.children.length > 3) H.el.medals.firstChild.remove();
  }
  function popup(text) {
    const d = document.createElement("div");
    d.className = "pop"; d.textContent = text;
    H.el.pops.appendChild(d);
    setTimeout(function () { d.remove(); }, 1100);
  }
  H.toast = function (text, secs) {
    H.el.toast.textContent = text;
    H.el.toast.classList.add("on");
    H.toastT = secs || 1.4;
  };
  H.center = function (html, secs) { H.el.center.innerHTML = html; H.centerT = secs || 2; };

  // Your kill: the word slams in mid-screen.
  function callout(text) {
    const c = H.el.callout;
    c.textContent = text;
    c.classList.remove("on"); void c.offsetWidth; c.classList.add("on");
  }
  // Your death: GTA-style cut (grey world, dark band, the word, a boom).
  function cut(text) {
    H.el.cutText.textContent = text;
    H.el.cut.hidden = false;
    document.body.classList.add("cut");
    clearTimeout(H.cutSnd);
    H.cutSnd = setTimeout(function () { HK.Audio.play("wasted"); }, 480);
  }
  H.clearCut = function () {
    if (!H.el) return;
    H.el.cut.hidden = true;
    document.body.classList.remove("cut");
    clearTimeout(H.cutSnd);
  };

  H.event = function (sim, e) {
    const me = sim.humanId;
    if (e.type === "kill") {
      feed(sim, e);
      if (e.killer === me && e.victim !== me) {
        H.el.hit.classList.remove("on"); void H.el.hit.offsetWidth; H.el.hit.classList.add("on");
        popup("+100" + (e.medals.length ? "  +" + e.medals.length * 50 : ""));
        e.medals.forEach(function (m, i) { setTimeout(function () { medal(m); HK.Audio.play("medal"); }, i * 380); });
        if (e.how === "throw" && e.dist > 8) H.toast(Math.round(e.dist) + " m THROW", 1.2);
        if (e.how === "melee" || e.how === "throw") callout(HOW[e.how]);
        else if (e.how === "wave") callout("WASHED OUT");
      }
      if (e.victim === me) {
        const k = e.killer >= 0 ? sim.players[e.killer] : null;
        H.el.deathName.textContent = k && e.killer !== me ? k.name.toUpperCase() : "THE SEA";
        H.el.deathName.style.color = k && sim.mode === "tdm" ? TEAM[k.team].color : "#fff";
        H.el.deathHow.textContent = HOW[e.how] || "";
        H.el.vig.classList.add("on");
        cut(CUT[e.how] || "WASTED");
      }
    } else if (e.type === "pickup" && e.p === me) {
      H.toast("+1 THROWING KNIFE", 1.2);
    } else if (e.type === "dry" && e.p === me) {
      H.toast("NO KNIVES · PICK ONE UP", 1.4);
    } else if (e.type === "go") {
      H.center("FIGHT", 1.2);
    } else if (e.type === "wavewarn") {
      const caller = sim.players[e.p], mine = sim.players[me];
      if (e.p === me) H.center("<span class='wave-you'>ROGUE WAVE</span><small>YOUR STREAK CALLED IT · YOUR TEAM IS BRACED</small>", 2.4);
      else if (mine && !sim.isEnemy(mine, caller)) H.center("<span class='wave-you'>ROGUE WAVE</span><small>" + caller.name.toUpperCase() + " CALLED IT · YOUR TEAM IS BRACED</small>", 2.4);
      else H.center("<span class='wave-foe'>ROGUE WAVE INCOMING</span><small>" + caller.name.toUpperCase() + " CALLED IT · GET OFF THE PIRATE BOAT</small>", 2.4);
    }
  };

  // ------------------------------------------------------------------ scoreboard
  H.renderScores = function (sim) {
    const rows = sim.players.slice().sort(function (a, b) { return (sim.mode === "tdm" ? a.team - b.team : 0) || b.score - a.score || b.kills - a.kills; });
    H.el.scHead.innerHTML = sim.mode === "tdm" ?
      "<span style='color:" + TEAM[0].color + "'>NAVY " + sim.teamScore[0] + "</span><span>" + U.fmtTime(sim.timeLeft) + "</span><span style='color:" + TEAM[1].color + "'>" + sim.teamScore[1] + " PIRATES</span>" :
      "<span>FREE-FOR-ALL</span><span>" + U.fmtTime(sim.timeLeft) + "</span><span>FIRST TO " + sim.scoreLimit + "</span>";
    H.el.scBody.innerHTML = rows.map(function (p) {
      return "<tr class='" + (p.id === sim.humanId ? "me " : "") + (sim.mode === "tdm" ? "t" + p.team : "") + "'><td class='l'>" + (p.id === sim.humanId ? "You" : p.name) +
        (p.alive ? "" : " <span style='color:#ff6a50'>✖</span>") + "</td><td>" + p.score + "</td><td>" + p.kills + "</td><td>" + p.deaths + "</td><td>" + p.bestStreak + "</td></tr>";
    }).join("");
  };

  HK.HUD = H;
})(globalThis.HK);
