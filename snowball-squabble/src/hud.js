// The on-screen display: score bar, ammo, charge, kill feed, big messages.
globalThis.SB = globalThis.SB || {};
(function (SB) {
  "use strict";
  const THREE = globalThis.THREE;
  const H = {};
  const $ =(id) => document.getElementById(id);
  let el = null, bigT = 0, lastCount = -1, builtFor = -1;

  H.init = function () {
    el = { hud: $("hud"), big: $("big"), sub: $("sub"), ammo: $("ammo"), hint: $("ammoHint"), packWrap: $("packWrap"), packFill: $("packFill"),
      chargeWrap: $("chargeWrap"), chargeFill: $("chargeFill"), pipsBlue: $("pipsBlue"), pipsRed: $("pipsRed"), scBlue: $("scBlue"), scRed: $("scRed"),
      round: $("roundLbl"), feed: $("feed"), out: $("outBanner"), spec: $("specName"), flash: $("flash"), splats: $("splats"), keys: $("keys"), slow: $("slowNote"),
      outTitle: $("outTitle"), carry: $("carryBanner"), chips: [$("chipBlue"), $("chipRed")], marks: [$("markBlue"), $("markRed")] };
    el.marks.forEach(function (m) { if (SB.SEAL) m.firstChild.src = SB.SEAL; });
  };
  H.show = function (on) { el.hud.classList.toggle("hidden", !on); };

  function pips(box, n, total) {
    if (box.children.length !== total) { box.innerHTML = ""; for (let i = 0; i < total; i++) box.appendChild(document.createElement("i")); }
    for (let i = 0; i < total; i++) box.children[i].className = i < n ? "" : "off";
  }
  function say(text, sub, hold) {
    if (el.big.textContent !== text) { el.big.textContent = text; el.big.classList.remove("pop"); void el.big.offsetWidth; el.big.classList.add("pop"); }
    el.sub.textContent = sub || "";
    bigT = hold === undefined ? 1e9 : hold;
  }
  H.say = say;

  function feedLine(html) {
    const d = document.createElement("div");
    d.innerHTML = html;
    el.feed.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 5200);
    while (el.feed.children.length > 5) el.feed.removeChild(el.feed.firstChild);
  }
  const who = (p) => '<span class="' + (p.team === 0 ? "b" : "r") + '">' + esc(p.name) + "</span>";
  const flagName = (team) => '<span class="' + (team === 0 ? "b" : "r") + '">' + (team === 0 ? "BLUE" : "RED") + " flag</span>";

  H.event = function (e, sim) {
    if (e.t === "flagtake" || e.t === "flagdrop" || e.t === "flagreturn" || e.t === "capture") {
      const p = sim.players[e.by], mine = sim.humanTeam;
      if (e.t === "flagtake" && p) {
        feedLine(who(p) + " ⚑ grabbed the " + flagName(e.team));
        if (e.team === mine) say("THEY HAVE OUR FLAG!", "hunt the carrier", 2.2);
        else if (p.human) say("YOU HAVE THEIR FLAG!", "get it back to your stand", 2.2);
        else say("WE HAVE THEIR FLAG!", "cover the carrier", 2.2);
      } else if (e.t === "flagdrop") {
        feedLine("The " + flagName(e.team) + " was dropped");
        say(e.team === mine ? "OUR FLAG IS LOOSE" : "THEIR FLAG IS LOOSE", e.team === mine ? "touch it to send it home" : "grab it!", 1.8);
      } else if (e.t === "flagreturn") feedLine((p ? who(p) + " returned" : "Returned") + " the " + flagName(e.team));
      else if (e.t === "capture" && p) feedLine(who(p) + " ⚑ CAPTURED!");
      return;
    }
    if (e.t === "flaghit") {
      if (e.id === sim.humanId) { el.flash.classList.remove("on"); void el.flash.offsetWidth; el.flash.classList.add("on"); }
      return;
    }
    if (e.t === "out") {
      const k = sim.players[e.by], v = sim.players[e.id];
      if (k && v) feedLine(who(k) + " ❄ " + who(v));
      if (e.id === sim.humanId) {
        el.flash.classList.remove("on"); void el.flash.offsetWidth; el.flash.classList.add("on");
        for (let i = 0; i < 7; i++) {
          const s = document.createElement("i"), sz = 60 + Math.random() * 150;
          s.style.cssText = "left:" + (Math.random() * 90 + 2) + "%;top:" + (Math.random() * 80 + 4) + "%;width:" + sz + "px;height:" + sz + "px";
          el.splats.appendChild(s);
          setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 3300);
        }
      }
    } else if (e.t === "round") {
      el.feed.innerHTML = ""; el.out.classList.add("hidden");
    } else if (e.t === "go") {
      say("GO!", "", 0.9);
    } else if (e.t === "roundover") {
      const mine = sim.humanTeam;
      if (e.winner === -2) say("DRAW", sim.mode === "ctf" ? "no flag made it home" : "nobody finished it", 3.6);
      else if (e.winner === mine) say(sim.mode === "ctf" ? "FLAG CAPTURED!" : "ROUND WON", scoreText(sim), 3.6);
      else say(sim.mode === "ctf" ? "THEY CAPTURED YOUR FLAG" : "ROUND LOST", scoreText(sim), 3.6);
    }
  };
  function scoreText(sim) { return "BLUE " + sim.score[0] + "  —  " + sim.score[1] + " RED"; }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // Capture the flag: the two flag chips in the score bar, and a seal marker on each flag (clamped to the screen edge when it's off-screen).
  const _p = new THREE.Vector3();
  function flags(sim, h) {
    const cam = SB.View.camera, W = innerWidth, Ht = innerHeight;
    cam.updateMatrixWorld();
    const pos = [];
    sim.flags.forEach(function (f, team) {
      el.chips[team].className = "fchip" + (f.state === "carried" ? " carried" : f.state === "dropped" ? " dropped" : "");
      const m = el.marks[team];
      const mineCarried = h && h.alive && h.flag && f.carrier === h.id;
      if (mineCarried || sim.phase === "countdown") { m.style.display = "none"; return; }
      m.style.display = "";
      _p.set(f.x, 5.1, f.z).applyMatrix4(cam.matrixWorldInverse);
      const behind = _p.z > 0;
      _p.applyMatrix4(cam.projectionMatrix);
      let x = (_p.x * 0.5 + 0.5) * W, y = (-_p.y * 0.5 + 0.5) * Ht;
      if (behind) { x = W - x; y = Ht - 60; }
      pos[team] = { x: x, y: y };
      const d = Math.round(Math.hypot(f.x - cam.position.x, f.z - cam.position.z));
      m.lastChild.textContent = (f.state === "carried" ? "CARRIED " : f.state === "dropped" ? "LOOSE " : "") + d + "m";
    });
    // Both flags in the same direction: spread the markers sideways so the seals and labels don't overlap
    // (a "CARRIED 65m" label is ~90px wide).
    const a = pos[0], b = pos[1], GAP = 100;
    if (a && b) {
      a.x = Math.min(W - 40, Math.max(40, a.x)); b.x = Math.min(W - 40, Math.max(40, b.x));
      a.y = Math.min(Ht - 60, Math.max(96, a.y)); b.y = Math.min(Ht - 60, Math.max(96, b.y));
    }
    if (a && b && Math.abs(a.y - b.y) < 60 && Math.abs(a.x - b.x) < GAP) {
      const mid = Math.min(W - 40 - GAP / 2, Math.max(40 + GAP / 2, (a.x + b.x) / 2)), side = a.x <= b.x ? 1 : -1;
      a.x = mid - side * GAP / 2; b.x = mid + side * GAP / 2;
    }
    pos.forEach(function (p, team) {
      if (!p) return;
      const x = Math.min(W - 40, Math.max(40, p.x)), y = Math.min(Ht - 60, Math.max(96, p.y));
      el.marks[team].style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
    });
  }

  H.update = function (sim, dt) {
    const h = sim.human(), n = sim.teamSize;
    pips(el.pipsBlue, sim.alive(0), n); pips(el.pipsRed, sim.alive(1), n);
    el.scBlue.textContent = sim.score[0]; el.scRed.textContent = sim.score[1];
    const ctf = sim.mode === "ctf";
    document.body.classList.toggle("ctf", ctf);
    el.round.textContent = (ctf ? "FLAGS · " : "ROUND " + sim.round + " · ") + "FIRST TO " + sim.winRounds;
    if (ctf) flags(sim, h);
    // countdown / messages
    if (sim.phase === "countdown") {
      const c = Math.ceil(sim.phaseT - 0.2);
      if (c !== lastCount) { lastCount = c; if (c > 0) { say(String(c), ctf ? "STEAL THEIR FLAG · BRING IT HOME" : "ROUND " + sim.round, 1e9); if (SB.Audio) SB.Audio.event({ t: "count" }, sim); } }
      if (c <= 0 && sim.phaseT > 0) say("READY", "", 1e9);
    } else lastCount = -1;
    if (bigT < 1e8) { bigT -= dt; if (bigT <= 0) { el.big.textContent = ""; el.sub.textContent = ""; bigT = 1e9; } }
    if (!h) return;
    // ammo
    const M = sim.cfg.MAX_AMMO;
    if (el.ammo.children.length !== M) { el.ammo.innerHTML = ""; for (let i = 0; i < M; i++) el.ammo.appendChild(document.createElement("i")); }
    for (let i = 0; i < M; i++) el.ammo.children[i].className = i < h.ammo ? "" : "off";
    el.hint.textContent = !h.alive ? "" : h.ammo === 0 ? "Hold R to pack snow" : h.ammo < 3 ? "Low — hold R to pack" : "";
    const pk = h.packT / sim.cfg.PACK_T;
    el.packWrap.classList.toggle("on", pk > 0); el.packFill.style.width = Math.round(pk * 100) + "%";
    el.chargeWrap.classList.toggle("on", h.charge > 0.02 && h.alive);
    el.chargeFill.style.width = Math.round(h.charge * 100) + "%";
    el.out.classList.toggle("hidden", h.alive || sim.phase !== "play");
    el.carry.classList.toggle("hidden", !(h.alive && h.flag));
    if (!h.alive) {
      const t = sim.players[sim.spectateId];
      el.outTitle.textContent = ctf ? "DOWN — BACK IN " + Math.max(1, Math.ceil(h.respawnT)) : "YOU'RE OUT";
      el.spec.textContent = t ? "Watching " + t.name + " — click to switch" : "";
    }
    el.keys.style.opacity = sim.time > 25 ? "0" : "1";
    el.slow.textContent = SB.View && SB.View.downgraded ? "Performance mode: " + SB.View.downgraded : "";
  };
  SB.Hud = H;
})(globalThis.SB);
