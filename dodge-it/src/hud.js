// The HUD: score and who's still in up top, the crosshair with the wind-up ring, stamina, the ball in your
// hands, the feed of hits and catches and big call-outs.
globalThis.SB = globalThis.SB || {};
(function (SB) {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const H = { feed: [], bigT: 0 };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const hex = (c) => "#" + c.toString(16).padStart(6, "0");

  H.init = function () {};
  H.start = function (sim, rounds) {
    H.sim = sim;
    $("bo").textContent = rounds > 1 ? "BEST OF " + rounds : "ONE ROUND";
    [0, 1].forEach(function (t) {
      const d = $("d" + t);
      d.innerHTML = "";
      sim.players.filter((p) => p.team === t).forEach(function (p) {
        const i = document.createElement("i");
        i.title = p.name; i.dataset.id = p.id;
        if (p.kind === "local") i.className = "you";
        d.appendChild(i);
      });
    });
    const me = sim.human();
    if (me) document.body.dataset.team = String(me.team);
  };
  H.show = function (on) { $("hud").classList.toggle("hidden", !on); };

  function big(text, sub, secs, cls) {
    const b = $("big");
    b.textContent = text; b.className = "bounce " + (cls || "");
    void b.offsetWidth;
    $("sub").textContent = sub || "";
    H.bigT = secs || 1.6;
  }
  function feed(html) {
    const el = document.createElement("div");
    el.innerHTML = html;
    $("feed").prepend(el);
    H.feed.push({ el: el, t: 5 });
    while ($("feed").children.length > 5) $("feed").lastChild.remove();
  }
  const nm = (p) => '<b style="color:' + hex(SB.World.TEAM_COL[p.team]) + '">' + esc(p.name) + "</b>";

  H.event = function (e, sim) {
    const me = sim.me, P = sim.players;
    switch (e.t) {
      case "ready": big("ROUND " + e.round, "Get ready…", 1.4); break;
      case "go": big("DODGE!", "", 0.9, "go"); break;
      case "hit": if (e.id === me) big("HIT!", "", 1.0, "bad"); break;
      case "caught":
        if (e.id === me) big("CAUGHT!", "", 1.2, "good");
        break;
      case "block": if (e.id === me) big("BLOCKED", "", 0.8, "good"); break;
      case "out": {
        const p = P[e.id], by = P[e.by];
        if (e.kind === "caught") feed(nm(by) + " caught " + nm(p) + "'s throw");
        else feed(nm(by) + " hit " + nm(p));
        if (e.rev >= 0) feed(nm(P[e.rev]) + " is back in");
        if (e.id === me) big(e.kind === "caught" ? "CAUGHT OUT" : "YOU'RE OUT", "A teammate's catch brings you back in", 2.2, "bad");
        else if (e.rev === me) big("YOU'RE BACK IN!", "", 1.6, "good");
        else if (e.by === me && e.kind === "hit") big("GOT 'EM!", "", 1.0, "good");
        break;
      }
      case "left": feed(nm(P[e.id]) + " left the game"); break;
      case "roundover": {
        const mine = sim.human() && e.w === sim.human().team;
        big(e.w >= 0 ? SB.World.TEAM_NAME[e.w] + " TAKES THE ROUND" : "DRAW", "Blue " + e.score[0] + " - " + e.score[1] + " Gold", 3, e.w < 0 ? "" : mine ? "good" : "bad");
        break;
      }
      case "matchover": {
        const mine = sim.human() && e.winner === sim.human().team;
        big(SB.World.TEAM_NAME[e.winner] + " WINS!", "", 60, mine ? "good" : "bad");
        break;
      }
    }
  };

  H.update = function (sim, dt) {
    const me = sim.human(), C = SB.CFG;
    $("s0").textContent = sim.score[0]; $("s1").textContent = sim.score[1];
    $("rd").textContent = "ROUND " + Math.max(1, sim.round);
    document.querySelectorAll("#score .dots i").forEach(function (i) {
      const p = sim.players[+i.dataset.id];
      i.classList.toggle("out", !!p.out);
      i.classList.toggle("left", !!p.left);
    });
    // countdown
    if (sim.phase === "ready") { const n = Math.ceil(sim.phaseT); if (n !== H.count && n > 0) { H.count = n; $("count").textContent = n; $("count").className = "on"; void $("count").offsetWidth; } }
    else if (H.count) { H.count = 0; $("count").className = ""; }
    if (sim.phase === "wait") { $("big").textContent = "WAITING FOR PLAYERS"; $("sub").textContent = "The match starts when everyone has loaded"; H.bigT = 0.3; }
    H.bigT -= dt;
    if (H.bigT <= 0 && $("big").textContent) { $("big").textContent = ""; $("sub").textContent = ""; }
    for (let i = H.feed.length - 1; i >= 0; i--) { const f = H.feed[i]; f.t -= dt; if (f.t < 1) f.el.style.opacity = Math.max(0, f.t); if (f.t <= 0) { f.el.remove(); H.feed.splice(i, 1); } }
    if (!me) return;
    // crosshair: the wind-up fills the ring; it goes green when full
    const sight = $("sight");
    sight.classList.toggle("on", me.hold >= 0 && !me.out);
    sight.classList.toggle("full", me.charge >= 0.99);
    sight.classList.toggle("hide", !!me.out);
    $("powerRing").style.strokeDashoffset = String(157 * (1 - me.charge));
    // stamina (flips and dodges spend it)
    $("stamFill").style.width = (me.stam / C.STAM * 100).toFixed(1) + "%";
    $("stam").classList.toggle("low", me.stam < C.FLIP_COST);
    $("stam").classList.toggle("hide", !!me.out);
    const tag = $("ballTag");
    tag.className = me.hold >= 0 && !me.out ? (me.pend ? "on wait" : "on") : "";
    tag.textContent = me.pend ? "BALL…" : me.charge > 0 ? (me.ground ? "WIND UP" : "AIR THROW!") : "BALL";
    $("outNote").classList.toggle("on", !!me.out && me.st === SB.ST.out && sim.phase === "play");
  };
  SB.Hud = H;
})(globalThis.SB);
