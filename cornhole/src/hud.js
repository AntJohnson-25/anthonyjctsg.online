// The on-screen display: scoreboard, whose throw it is, the how-to-throw hint, call-outs ("AIRMAIL!") and the round summary.
(function (SB) {
  "use strict";
  const CH = SB.Cornhole, C = CH.C, M = CH.M;
  const $ = (id) => document.getElementById(id);
  const H = { sim: null, names: ["", ""], noted: 0, noteRound: 0, popT: 0, subT: 0, mine: false };

  H.init = function (sim, names) {
    H.sim = sim; H.names = names;
    $("n0").textContent = names[0]; $("n1").textContent = names[1];
    $("tgt").textContent = "First to " + sim.target;
    $("hud").classList.remove("hidden");
    ["s0", "s1"].forEach(function (c, i) { document.querySelector("#score ." + c).style.setProperty("--c", SB.World.SIDE_CSS[i]); });
  };

  H.say = function (text, sub, ms, cls) {
    const p = $("pop");
    p.textContent = text; p.className = "show " + (cls || "");
    H.popT = ms / 1000;
    if (sub !== undefined) { $("sub").textContent = sub; H.subT = ms / 1000; }
    void p.offsetWidth;
  };

  const pips = (n) => { let s = ""; for (let i = 0; i < C.PER_SIDE; i++) s += '<u class="' + (i < n ? "on" : "") + '"></u>'; return s; };

  H.update = function (sim, dt, input, ctx) {
    if (H.popT > 0) { H.popT -= dt; if (H.popT <= 0) $("pop").className = ""; }
    if (H.subT > 0) { H.subT -= dt; if (H.subT <= 0) $("sub").textContent = ""; }
    $("sc0").textContent = sim.scores[0]; $("sc1").textContent = sim.scores[1];
    $("rnd").textContent = sim.round ? "Round " + sim.round : "";
    $("pips0").innerHTML = pips(sim.bagsLeft(0)); $("pips1").innerHTML = pips(sim.bagsLeft(1));
    const c = sim.cur(), who = sim.activeWho();
    const mine = sim.myTurn();
    const turn = $("turn");
    turn.className = mine ? "mine" : "";
    let txt = "";
    if (sim.phase === "wait") txt = "Get ready…";
    else if (sim.phase === "aim" && c) txt = mine ? "YOUR THROW" : sim.players[c.who].name + " is up";
    else if (sim.phase === "swing" || sim.phase === "flight") txt = who >= 0 ? sim.players[who].name : "";
    else if (sim.phase === "scored") txt = "Round " + sim.round + " is in";
    else if (sim.phase === "over") txt = "";
    if (sim.phase === "aim" && c && sim.players[c.who].side >= 0) turn.style.setProperty("--c", SB.World.SIDE_CSS[c.side]);
    else if (who >= 0) turn.style.setProperty("--c", SB.World.SIDE_CSS[sim.players[who].side]);
    $("turnTxt").textContent = txt;
    const left = Math.max(0, Math.ceil(C.TURN_TIME - sim.turnT));
    $("turnClock").textContent = sim.phase === "aim" && sim.turnT > 14 ? String(left) : "";
    // round summary
    const sm = $("summary");
    if (sim.phase === "scored" && sim.summary) {
      const s = sim.summary, cnt = [0, 1].map(function (side) {
        const mine2 = sim.bags.filter(function (b) { return b.side === side; });
        return { h: mine2.filter(function (b) { return b.mode === M.HOLE || b.mode === M.FALL; }).length, o: mine2.filter(function (b) { return b.mode === M.BOARD; }).length };
      });
      const line = function (side) { return '<div class="r s' + side + '"><b>' + esc(H.names[side]) + '</b><span>' + cnt[side].h + ' in the hole · ' + cnt[side].o + ' on the board</span><em>' + s.pts[side] + '</em></div>'; };
      const res = s.win < 0 ? "Nothing cancels out. No points." : esc(H.names[s.win]) + " score " + s.net + (s.net === 1 ? " point" : " points");
      sm.innerHTML = '<h3>ROUND ' + s.round + '</h3>' + line(0) + line(1) + '<p>' + res + '</p>';
      sm.classList.remove("hidden");
    } else sm.classList.add("hidden");
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // Call-outs. A bag that sank is announced the moment it drops; the others once the bag has stopped.
  H.event = function (e, sim) {
    if (e.t === "round") { H.noted = 0; H.noteRound = sim.round; }
    if (e.t === "hole") {
      const mine = e.bag.side;
      H.say(e.air ? "AIRMAIL!" : "IN THE HOLE!", "+3 for " + H.names[mine], 1700, "good");
    }
    if ((e.t === "turn" || e.t === "roundEnd" || e.t === "synced" || e.t === "synced-round") && sim.bags.length > H.noted && sim.round === H.noteRound) {
      const b = sim.bags[sim.bags.length - 1];
      H.noted = sim.bags.length;
      if (e.t === "synced" || e.t === "synced-round") { if (b.mode === M.HOLE) return; }
      if (b.mode === M.BOARD) H.say("ON THE BOARD", "+1 for " + H.names[b.side], 1300, "ok");
      else if (b.mode === M.GROUND) H.say("DIRT BAG", "no points", 1300, "bad");
      else if (b.mode === M.VOID) H.say("TIME!", "bag lost", 1300, "bad");
    }
    if (e.t === "round" && sim.round > 1) H.say("ROUND " + sim.round, "", 1500, "ok");
    if (e.t === "round" && sim.round === 1) H.say("PLAY!", "first to " + sim.target, 1600, "ok");
    if (e.t === "synced-round") { H.noted = sim.bags.length; H.noteRound = sim.round; }
  };

  H.sayOver = function (sim) {
    const w = sim.winner;
    if (w < 0) { H.say("GAME OVER", "", 6000, "bad"); return; }
    const mine = sim.me >= 0 && sim.players[sim.me].side === w;
    H.say(mine ? "YOU WIN!" : H.names[w].toUpperCase() + " WIN", "", 6000, mine ? "good" : "bad");
  };
  SB.Hud = H;
})(globalThis.SB);
