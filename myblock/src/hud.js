// DOM HUD: scores + timer, capture-point chips, minimap, kill feed, medals,
// popups, crosshair (opens with spread), hit markers, damage direction, health
// and armour, weapon + ammo, the marksman scope, the death screen and the Tab
// scoreboard. (From Summit Protocol's HUD, gadgets taken out.)
globalThis.SP = globalThis.SP || {};
(function (SP) {
  "use strict";
  const U = SP.U, WP = SP.WEAPONS, t = SP.t;
  const H = {};
  const $ = function (id) { return document.getElementById(id); };
  function css(n) { return "#" + ("000000" + n.toString(16)).slice(-6); }
  function teamCss(sim, team) { return css(SP.FACTIONS[sim.factions[team]].color); }

  H.init = function () {
    H.el = {};
    ["hud", "sbMode", "sbRows", "sbTime", "terms", "killfeed", "cross", "hitmark", "medals", "popups", "centerMsg", "toast",
      "hpBar", "hpNum", "arBar", "arNum", "wName", "wMag", "wRes", "wAlt", "wSlots", "useHint",
      "scope", "death", "deathName", "deathHow", "deathTimer", "vignette", "dmg", "scores", "scHead", "scBody", "minimap",
      "callout", "clicklock"].forEach(function (id) { H.el[id] = $(id); });
    H.mmCtx = H.el.minimap.getContext("2d");
    H.toastT = 0; H.centerT = 0;
    H.relabel();
    H.dmgPool = [];
    // The weapon wheel's slots, round the ring starting at the top, clockwise.
    const wheel = $("wheel"), pics = SP.Models.gunPictures();
    H.wslots = WP.map(function (w, i) {
      const a = H.slotAngle(i), d = document.createElement("div");
      d.className = "wslot";
      d.style.left = (50 + Math.cos(a) * 35) + "%"; d.style.top = (50 + Math.sin(a) * 35) + "%";
      d.style.transform = "translate(-50%, -50%)";
      d.innerHTML = "<img alt='' src='" + pics[i] + "'><span>" + t("w" + i) + "</span><small></small>";
      wheel.appendChild(d);
      return d;
    });
  };
  H.slotAngle = function (i) { return -Math.PI / 2 + i * Math.PI * 2 / WP.length; };

  // The weapon wheel. st: null (closed) or { sel }.
  H.wheel = function (st, me) {
    const el = $("wheel");
    el.hidden = !st;
    if (!st || !me) return;
    H.wslots.forEach(function (s, i) {
      const inv = me.inv[i], own = inv.have && (i !== 5 || inv.mag > 0);
      s.classList.toggle("cur", i === me.cur);
      s.classList.toggle("on", i === st.sel);
      s.classList.toggle("dry", !own || inv.mag + inv.res <= 0);
      s.querySelector("small").textContent = !own ? "—" : WP[i].kind === "grenade" ? "× " + inv.mag : inv.mag + " / " + inv.res;
    });
    const w = WP[st.sel], inv = me.inv[st.sel];
    $("wheelName").textContent = w.name;
    $("wheelAmmo").textContent = !inv.have ? t("notCarried") : w.kind === "grenade" ? "× " + inv.mag : inv.mag + " / " + inv.res;
  };

  H.relabel = function () {
    H.el.wSlots.innerHTML = WP.map(function (w, i) { return "<span data-w='" + i + "'><b>" + (i + 1) + "</b>" + t("w" + i) + "</span>"; }).join("");
    H.slots = Array.prototype.slice.call(H.el.wSlots.children);
  };

  H.setup = function (sim) {
    H.sim = sim;
    H.el.killfeed.innerHTML = ""; H.el.medals.innerHTML = ""; H.el.popups.innerHTML = "";
    H.el.death.hidden = true; H.el.vignette.classList.remove("on");
    H.el.sbMode.textContent = t(sim.mode);
    H.el.sbRows.innerHTML = sim.factions.slice(0, sim.sides).map(function (f, i) { return "<div class='sb-row' id='sb" + i + "'><i></i><span class='nm'></span><span class='bar'><b></b></span><span class='sc'></span></div>"; }).join("");
    H.el.terms.hidden = sim.mode !== "turf";
    H.el.terms.innerHTML = sim.map.points.map(function (P, i) { return "<div class='tchip' id='tc" + i + "'><i></i><span>" + P.name + "</span></div>"; }).join("");
    H.drawStatic(sim);
    H.last = {};
  };

  function row(el, color, name, score, frac) {
    el.querySelector("i").style.background = color;
    el.querySelector(".nm").textContent = name;
    el.querySelector(".sc").textContent = score;
    const b = el.querySelector(".bar b");
    b.style.width = Math.min(100, frac * 100) + "%";
    b.style.background = color;
  }

  // info: { aim, spread (radians), fov, scoped, inZone }
  H.update = function (sim, dt, info) {
    const me = sim.humanId >= 0 ? sim.players[sim.humanId] : null;
    const e = H.el;
    sim.factions.slice(0, sim.sides).forEach(function (f, i) {
      const el = $("sb" + i);
      if (el) row(el, teamCss(sim, i), SP.FACTIONS[f].name, sim.teamScore[i], sim.teamScore[i] / sim.scoreLimit);
    });
    e.sbTime.textContent = U.fmtTime(sim.timeLeft);
    if (sim.mode === "turf") sim.pt.forEach(function (st, i) {
      const el = $("tc" + i);
      if (!el) return;
      const col = st.state === "loading" ? "#37e07a" : st.state === "packed" ? (st.team >= 0 ? teamCss(sim, st.team) : "#ffc93a") : "#6b737a";
      el.style.setProperty("--c", col);
      el.classList.toggle("contested", st.contested);
      el.querySelector("i").style.background = st.state === "loading" ? "conic-gradient(#37e07a " + Math.round(st.prog * 360) + "deg, rgba(255,255,255,0.15) 0)" : st.state === "packed" ? "#ffc93a" : st.state === "cool" ? "#444a50" : "";
      el.querySelector("span").textContent = sim.map.points[i].name + (st.state === "packed" ? " · " + t(st.bags === 1 ? "bags" : "bags2", st.bags) : "");
    });    if (!me) return;

    // Health and armour.
    if (H.last.hp !== me.hp) { e.hpBar.style.width = Math.max(0, me.hp) + "%"; e.hpNum.textContent = Math.max(0, Math.ceil(me.hp)); e.hpBar.parentNode.classList.toggle("low", me.hp < 30); H.last.hp = me.hp; }
    if (H.last.ar !== me.armor) { e.arBar.style.width = me.armor + "%"; e.arNum.textContent = Math.ceil(me.armor); H.last.ar = me.armor; }
    // Weapon and ammo.
    const w = WP[me.cur], st = me.inv[me.cur];
    e.wName.textContent = w.name;
    e.wMag.textContent = st.mag;
    e.wRes.textContent = w.kind === "grenade" ? "" : "/ " + st.res;
    e.wMag.classList.toggle("empty", st.mag <= 0);
    e.wAlt.textContent = me.reloadT > 0 ? t("reloading") : me.aiming ? t("aiming") : t(SP.Input.touch ? "aimTouch" : "aimClick");
    H.slots.forEach(function (s, i) {
      const own = me.inv[i].have && (i !== 5 || me.inv[5].mag > 0);
      s.classList.toggle("own", own); s.classList.toggle("on", i === me.cur);
      s.classList.toggle("dry", own && me.inv[i].mag + me.inv[i].res <= 0);
    });
    e.useHint.hidden = !info.inZone && !info.climb;
    if (info.climb) e.useHint.textContent = t(info.climb);
    else if (info.inZone) e.useHint.textContent = t(["", "capturing", "contested", "capturing", "holding"][info.inZone]);
    // Touch: the USE button only shows when there's something to use (a ladder, a vault, a body to search).
    const tUse = document.getElementById("tUse");
    if (tUse) tUse.hidden = !(info.climb === "lootHint" || info.climb === "climbHint" || info.climb === "vaultHint");
    // Crosshair: opens with the spread; red on an enemy.
    const px = Math.max(4, Math.tan(info.spread) / Math.tan(info.fov * Math.PI / 360) * window.innerHeight / 2);
    e.cross.style.setProperty("--gap", px.toFixed(1) + "px");
    e.cross.classList.toggle("enemy", info.aim >= 0 && sim.isEnemy(me, sim.players[info.aim]));
    e.cross.style.display = me.alive && !info.scoped ? "" : "none";
    e.scope.hidden = !(me.alive && info.scoped);

    if (sim.phase === "pre") e.centerMsg.innerHTML = Math.ceil(sim.preT) + "<small>" + t(sim.mode) + "</small>";
    else if (H.centerT > 0) { H.centerT -= dt; if (H.centerT <= 0) e.centerMsg.innerHTML = ""; }
    else e.centerMsg.innerHTML = "";

    if (!me.alive) {
      e.death.hidden = false;
      e.deathTimer.textContent = t("respawnIn", Math.max(0, me.respawnT).toFixed(1));
    } else if (!e.death.hidden) { e.death.hidden = true; e.vignette.classList.remove("on"); }
    if (H.toastT > 0) { H.toastT -= dt; if (H.toastT <= 0) e.toast.classList.remove("on"); }

    H.dmgPool.forEach(function (d) {
      if (d.t <= 0) return;
      d.t -= dt;
      const rel = Math.atan2(d.z - me.z, d.x - me.x) - me.yaw;
      d.el.style.transform = "rotate(" + (rel * 180 / Math.PI + 90) + "deg)";
      d.el.style.opacity = Math.max(0, d.t / 1.2);
    });
    const now = performance.now();
    Array.prototype.forEach.call(e.killfeed.children, function (c) {
      const age = now - c._t;
      if (age > 6000) c.remove(); else if (age > 5200) c.style.opacity = 0;
    });
    H.drawMinimap(sim, me);
    const showScores = SP.Input.scores || H.scoresHeld || sim.over;
    if (showScores && !sim.over) H.renderScores(sim);
    e.scores.hidden = !showScores || sim.over;
  };

  // ------------------------------------------------------------------ minimap
  function mmXY(x, z) {
    const c = H.el.minimap, b = H.sim.map.bounds, s = Math.min(c.width / (b.x1 - b.x0), c.height / (b.z1 - b.z0));
    const ox = (c.width - (b.x1 - b.x0) * s) / 2, oy = (c.height - (b.z1 - b.z0) * s) / 2;
    return [ox + (x - b.x0) * s, oy + (z - b.z0) * s, s];
  }
  H.drawStatic = function (sim) {
    const c = document.createElement("canvas");
    c.width = H.el.minimap.width; c.height = H.el.minimap.height;
    const g = c.getContext("2d");
    g.fillStyle = "rgba(60,62,66,0.7)"; g.fillRect(0, 0, c.width, c.height);
    function rect(x0, x1, z0, z1, fill) { const a = mmXY(x0, z0), b = mmXY(x1, z1); g.fillStyle = fill; g.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); }
    rect(-48, 48, -4, 4, "rgba(30,30,32,0.8)"); rect(-4, 4, -38, 38, "rgba(30,30,32,0.8)");
    sim.map.boxes.forEach(function (b) {
      if (b.col === false || b.ground || b.stair || b.rail || b.yaw || b.maxy - b.miny < 0.7 || b.perim) return;
      const tall = b.maxy > 2.4;
      rect(b.cx - b.hx, b.cx + b.hx, b.cz - b.hz, b.cz + b.hz, b.miny > 3 ? "rgba(150,140,125,0.35)" : tall ? "rgba(170,160,145,0.85)" : "rgba(130,125,115,0.7)");
    });
    H.mmStatic = c;
  };
  H.drawMinimap = function (sim, me) {
    const g = H.mmCtx, c = H.el.minimap;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(H.mmStatic, 0, 0);
    if (sim.mode === "turf") {
      sim.map.points.forEach(function (P, i) {
        const q = mmXY(P.x, P.z), st = sim.pt[i];
        g.fillStyle = st.state === "loading" ? "#37e07a" : st.state === "packed" ? "#ffc93a" : st.state === "cool" ? "#444a50" : "#fff"; g.strokeStyle = "#000";
        g.beginPath(); g.rect(q[0] - 3.5, q[1] - 3.5, 7, 7); g.fill(); g.stroke();
      });
      (sim.map.zones || []).forEach(function (Z) {
        const q = mmXY(Z.x, Z.z);
        g.fillStyle = teamCss(sim, Z.team); g.strokeStyle = "#000";
        g.beginPath(); g.moveTo(q[0], q[1] - 5); g.lineTo(q[0] + 5, q[1] + 4); g.lineTo(q[0] - 5, q[1] + 4); g.closePath(); g.fill(); g.stroke();
      });
      sim.drops.forEach(function (b) {
        const q = mmXY(b.x, b.z);
        g.fillStyle = "#ffc93a"; g.strokeStyle = "#000"; g.beginPath(); g.arc(q[0], q[1], 3.2, 0, Math.PI * 2); g.fill(); g.stroke();
      });
    }
    sim.players.forEach(function (p) {
      if (!p.alive || p === me) return;
      const enemy = sim.isEnemy(me, p);
      // Enemies show only when they fire (a carrier always shows: gold square); the dead whenever they're close.
      if (p.zombie ? Math.hypot(p.x - me.x, p.z - me.z) > 30 : enemy && sim.t - p.attackT > 1.5 && !p.carry) return;
      const q = mmXY(p.x, p.z);
      if (p.carry) { g.fillStyle = "#ffc93a"; g.fillRect(q[0] - 3.5, q[1] - 3.5, 7, 7); }
      g.fillStyle = enemy ? "#ff4a2a" : teamCss(sim, p.team);
      g.beginPath(); g.arc(q[0], q[1], p.y > 3 ? 3.4 : 2.6, 0, Math.PI * 2); g.fill();
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
  function nameSpan(sim, p) {
    const col = p.id === sim.humanId ? "#ffc93a" : teamCss(sim, p.team);
    return "<span style='color:" + col + "'>" + (p.id === sim.humanId ? t("youName") : esc(p.name)) + "</span>";
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]; }); }
  function feed(sim, e) {
    if (e.zombie && e.killer !== sim.humanId) return;      // only your own zombie kills, or the feed fills up
    const k = e.killer >= 0 ? sim.players[e.killer] : null, v = sim.players[e.victim];
    const div = document.createElement("div");
    div.className = "kf" + (e.killer === sim.humanId || e.victim === sim.humanId ? " me" : "");
    const how = e.w >= 0 && e.how === "gun" ? t("w" + e.w) : SP.howText(e.how);
    div.innerHTML = (k && k !== v ? nameSpan(sim, k) : "") + "<span class='how'>" + how + (e.hs ? " ◎" : "") + "</span>" + nameSpan(sim, v);
    div._t = performance.now();
    H.el.killfeed.appendChild(div);
    while (H.el.killfeed.children.length > 5) H.el.killfeed.firstChild.remove();
  }
  function medal(text) {
    const d = document.createElement("div");
    d.className = "medal"; d.textContent = text;
    H.el.medals.appendChild(d);
    setTimeout(function () { d.remove(); }, 1900);
    while (H.el.medals.children.length > 3) H.el.medals.firstChild.remove();
  }
  function popup(text) {
    const d = document.createElement("div");
    d.className = "pop"; d.textContent = text;
    H.el.popups.appendChild(d);
    setTimeout(function () { d.remove(); }, 1100);
  }
  H.toast = function (text, secs) { H.el.toast.textContent = text; H.el.toast.classList.add("on"); H.toastT = secs || 1.4; };
  H.center = function (html, secs) { H.el.centerMsg.innerHTML = html; H.centerT = secs || 2; };
  function hitmark(head) {
    const h = H.el.hitmark;
    h.classList.toggle("head", !!head);
    h.classList.remove("on"); void h.offsetWidth; h.classList.add("on");
  }
  function damageFrom(x, z) {
    let d = H.dmgPool.find(function (q) { return q.t <= 0; });
    if (!d) { const el = document.createElement("div"); el.className = "darc"; H.el.dmg.appendChild(el); d = { el: el, t: 0 }; H.dmgPool.push(d); }
    d.x = x; d.z = z; d.t = 1.2;
  }
  function callout(text) {
    const c = H.el.callout;
    c.textContent = text;
    c.classList.remove("on"); void c.offsetWidth; c.classList.add("on");
  }

  H.event = function (sim, e) {
    const me = sim.humanId;
    switch (e.type) {
      case "kill": {
        feed(sim, e);
        if (e.killer === me && e.zombie) { popup("+50"); callout(e.hs ? t("headshot") : t("putDown")); break; }
        if (e.killer === me && e.victim !== me) {
          popup("+100" + (e.medals.length ? "  +" + e.medals.length * 50 : ""));
          e.medals.forEach(function (m, i) { setTimeout(function () { medal(m); }, i * 380); });
          callout(e.hs ? t("headshot") : t("down"));
        }
        if (e.victim === me) {
          const k = e.killer >= 0 ? sim.players[e.killer] : null;
          H.el.deathName.textContent = k && e.killer !== me ? k.name.toUpperCase() : e.how === "fall" ? t("fell") : e.how === "bite" ? t("theDead") : t("selfOut");
          H.el.deathName.style.color = k ? teamCss(sim, k.team) : "#fff";
          H.el.deathHow.textContent = e.w >= 0 && e.how === "gun" ? WP[e.w].name : SP.howText(e.how);
          H.el.vignette.classList.add("on");
        }
        break;
      }
      case "hit":
        if (e.p === me && e.v !== me) hitmark(e.hs);
        if (e.v === me && e.p >= 0 && e.p !== me) damageFrom(e.ax, e.az);
        break;
      case "pickup":
        if (e.p === me) H.toast(t("pickedUp", e.k === "weapon" ? (e.res === "new" ? WP[e.w].name : t("w" + e.w) + " " + t("ammo")) : t(e.k)), 1.3);
        break;
      case "loot": if (e.p === me) {
        const got = [];
        if (e.guns) got.push(t("lootGun"));
        if (e.ammo) got.push(t("lootAmmo", e.ammo));
        if (e.nades) got.push(t("lootNades", e.nades));
        if (e.hp) got.push(t("lootHp", e.hp));
        if (e.armor) got.push(t("lootArmor", e.armor));
        H.toast(t("looted") + ": " + (got.length ? got.join(" · ") : t("lootNone")), 2.0);
      } break;
      case "dry": if (e.p === me) H.toast(t("noAmmo"), 1.0); break;
      case "go": H.center(t("fight"), 1.0); break;
      case "pack": {
        const mine = me >= 0 ? sim.players[me] : null, P = sim.map.points[e.i];
        if (mine && e.team === mine.team) H.toast(t("wePacked", P.name), 2.2);
        else if (mine) H.toast(t("theyPacked", SP.FACTIONS[sim.factions[e.team]].name, P.name), 2.2);
        break;
      }
      case "take": {
        const mine = me >= 0 ? sim.players[me] : null, tk = sim.players[e.p];
        if (mine && tk === mine) H.toast(t("youTook"), 2.2);
        else if (mine && tk && sim.isEnemy(mine, tk)) H.toast(t("theyTookBag", SP.FACTIONS[sim.factions[tk.team]].name), 1.6);
        break;
      }
      case "drop": { const mine = me >= 0 ? sim.players[me] : null; if (mine && e.p === me) H.toast(t("youDropped"), 2.2); else if (mine) H.toast(t("dropped"), 1.4); break; }
      case "bagback": H.toast(t("bagBack"), 1.6); break;
      case "deliver": {
        const mine = me >= 0 ? sim.players[me] : null;
        if (mine && e.team === mine.team) H.toast(t("weDelivered", e.n + "/" + sim.scoreLimit), 2.4);
        else if (mine) H.toast(t("theyDelivered", SP.FACTIONS[sim.factions[e.team]].name, e.n + "/" + sim.scoreLimit), 2.4);
        break;
      }    }
  };

  // ------------------------------------------------------------------ scoreboard
  H.renderScores = function (sim) {
    const rows = sim.players.filter(function (p) { return !p.zombie; }).sort(function (a, b) { return a.team - b.team || b.score - a.score || b.kills - a.kills; });
    H.el.scHead.innerHTML = sim.factions.slice(0, sim.sides).map(function (f, i) { return "<span style='color:" + teamCss(sim, i) + "'>" + SP.FACTIONS[f].name + " " + sim.teamScore[i] + "</span>"; }).join("<span>" + U.fmtTime(sim.timeLeft) + "</span>");
    H.el.scBody.innerHTML = rows.map(function (p) {
      return "<tr class='" + (p.id === sim.humanId ? "me " : "") + "t" + p.team + "'><td class='l'>" + (p.id === sim.humanId ? t("youName") : esc(p.name)) +
        (p.alive ? "" : " <span class='ko'>✖</span>") + "</td><td>" + p.score + "</td><td>" + p.kills + "</td><td>" + p.deaths + "</td><td>" + (sim.mode === "turf" ? p.caps : p.bestStreak) + "</td></tr>";
    }).join("");
  };

  SP.HUD = H;
})(globalThis.SP);
