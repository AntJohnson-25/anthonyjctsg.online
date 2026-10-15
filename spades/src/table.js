// The table the host runs: the rules (rules.js) plus pacing. Bots think for a
// moment before they bid or play, a finished trick stays on the felt long
// enough to see, the hand summary stays up, and a human who runs out of turn
// time has a sensible card played for them. Pure: the time comes in as `now`
// (HopLobby.now() in the game, a fake clock in the tests).
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const R = HS.Rules, Bot = HS.Bot, U = HS.U;
  const T = {};
  T.PACE = { bid: [900, 1600], play: [650, 1250], dealHold: 2600, trickHold: 1500, handHold: 11000, timeoutLevel: "normal" };
  T.LEVELS = ["easy", "normal", "sharp", "shark"];
  T.TIMERS = [0, 20, 30, 60];

  // o: { seats: [{ name, bot, hl, look }] x4, opts: { target, blindNil, timer, chaos, level }, seed, dealer }
  T.create = function (o) {
    const seed = (o.seed >>> 0) || 1;
    const opts = Object.assign({ target: 500, blindNil: true, timer: 30, chaos: false, level: "normal" }, o.opts || {});
    const t = {
      id: o.id || Math.random().toString(36).slice(2, 10), seed: seed, rnd: U.rng(seed), opts: opts,
      seats: o.seats.map(function (s, i) { return { name: String(s.name || "Bot").slice(0, 24), bot: !!s.bot, hl: s.hl || null, look: s.look !== undefined ? s.look : i }; }),
      G: R.newGame({ target: opts.target, blindNil: opts.blindNil }, o.dealer !== undefined ? o.dealer : (seed % 4)),
      seq: 0, log: [], v: 1, turnKey: "", actAt: 0, deadline: 0, holdUntil: 0, pending: []
    };
    return t;
  };
  function push(t, evs) {
    if (!evs) return;
    evs.forEach(function (e) { e.q = ++t.seq; t.log.push(e); t.pending.push(e); });
    if (t.log.length > 40) t.log.splice(0, t.log.length - 40);
    t.v++;
  }
  T.events = function (t) { const e = t.pending; t.pending = []; return e; };
  T.start = function (t, now) {
    push(t, R.deal(t.G, t.rnd));
    t.holdUntil = now + T.PACE.dealHold;
    t.turnKey = "";
  };
  T.nextHand = function (t, now) {
    if (t.G.phase !== "hand") return false;
    push(t, R.deal(t.G, t.rnd));
    t.holdUntil = now + T.PACE.dealHold;
    t.turnKey = "";
    return true;
  };
  function between(t, a) { return a[0] + t.rnd() * (a[1] - a[0]); }

  // A seat acts: { bid: v } or { card: c }. Returns true if it was legal.
  T.act = function (t, seat, a, now, auto) {
    const G = t.G;
    if (now < t.holdUntil && !auto) return false;
    let ev = null;
    if (a && a.bid !== undefined && G.phase === "bid") ev = R.bid(G, seat, a.bid);
    else if (a && a.card !== undefined && G.phase === "play") ev = R.play(G, seat, a.card);
    if (!ev) return false;
    if (auto === "timeout") ev.unshift({ type: "timeout", seat: seat });
    push(t, ev);
    return true;
  };
  // The bot's (or the timed-out human's) move.
  T.botMove = function (t, seat, level) {
    const G = t.G;
    if (G.phase === "bid") return { bid: Bot.bid(G, seat, level, t.rnd) };
    return { card: Bot.play(G, seat, level, t.rnd, t.opts.chaos && t.seats[seat].bot) };
  };

  T.step = function (t, now) {
    const G = t.G;
    if (now < t.holdUntil) return;
    if (G.phase === "bid" || G.phase === "play") {
      const key = G.phase + G.handNo + ":" + G.turn + ":" + G.trickNo + ":" + G.trick.length;
      if (key !== t.turnKey) {
        t.turnKey = key;
        const bot = t.seats[G.turn].bot;
        t.actAt = now + (bot ? between(t, G.phase === "bid" ? T.PACE.bid : T.PACE.play) : 0);
        t.deadline = !bot && t.opts.timer > 0 ? now + t.opts.timer * 1000 : 0;
        t.v++;
      }
      const s = G.turn, seat = t.seats[s];
      if (seat.bot && now >= t.actAt) T.act(t, s, T.botMove(t, s, t.opts.level), now, true);
      else if (!seat.bot && t.deadline && now >= t.deadline) T.act(t, s, T.botMove(t, s, T.PACE.timeoutLevel), now, "timeout");
    } else if (G.phase === "trick") {
      if (t.turnKey !== "trick" + G.handNo + ":" + G.trickNo) { t.turnKey = "trick" + G.handNo + ":" + G.trickNo; t.actAt = now + T.PACE.trickHold; }
      if (now >= t.actAt) {
        push(t, R.collect(G));
        if (G.phase === "hand") t.actAt = now + T.PACE.handHold;
      }
    } else if (G.phase === "hand") {
      if (t.turnKey !== "hand" + G.handNo) { t.turnKey = "hand" + G.handNo; t.actAt = now + T.PACE.handHold; }
      if (now >= t.actAt) T.nextHand(t, now);
    }
  };

  // ------------------------------------------------------------------ seats changing hands
  T.toBot = function (t, s) { const x = t.seats[s]; x.bot = true; x.hl = null; x.name = x.botName || x.name; t.v++; if (t.G.turn === s) t.turnKey = ""; };
  T.toHuman = function (t, s, name, hl) {
    const x = t.seats[s];
    if (!x.botName) x.botName = x.name;
    x.bot = false; x.hl = hl; x.name = String(name || "Player").slice(0, 24); t.v++;
    if (t.G.turn === s) t.turnKey = "";
  };

  // ------------------------------------------------------------------ what everyone may see
  // Never any hand: those go to their owners only (net.js).
  T.publicState = function (t) {
    const G = t.G;
    return {
      id: t.id, v: t.v, ph: G.phase, hn: G.handNo, d: G.dealer, tu: G.turn, ld: G.leader, tn: G.trickNo,
      bids: G.bids.slice(), tk: G.tricks.slice(), tr: G.trick.map(function (x) { return [x.seat, x.card]; }),
      pl: G.played.slice(), br: G.broken, sc: G.scores.slice(), bg: G.bags.slice(), hc: G.hands.map(function (h) { return h.length; }),
      lt: G.lastTrick ? { c: G.lastTrick.cards.map(function (x) { return [x.seat, x.card]; }), w: G.lastTrick.winner } : null,
      dl: t.deadline || 0, at: t.holdUntil || 0, nx: G.phase === "hand" ? t.actAt : 0,
      res: G.result, hist: G.history.slice(-12), cuts: G.cuts.slice(), cov: G.covers.slice(), win: G.winner, bl: G.blindOk.slice(),
      seats: t.seats.map(function (s) { return [s.name, s.bot ? 1 : 0, s.hl, s.look]; }),
      o: { target: t.opts.target, blind: t.opts.blindNil, timer: t.opts.timer, chaos: t.opts.chaos, level: t.opts.level },
      ev: t.log.slice(-16)
    };
  };
  T.hand = function (t, s) { return t.G.hands[s].slice(); };

  // ------------------------------------------------------------------ a new host takes over
  // Rebuild the table from the last public state plus the hands people sent in.
  // Hands nobody reported (bots, people who went quiet) are re-dealt from the
  // cards still unaccounted for, so the hand can carry on.
  T.fromPublic = function (st, known, seed) {
    const t = T.create({
      id: st.id, seed: seed, dealer: st.d,
      seats: st.seats.map(function (s) { return { name: s[0], bot: !!s[1], hl: s[2], look: s[3] }; }),
      opts: { target: st.o.target, blindNil: st.o.blind, timer: st.o.timer, chaos: st.o.chaos, level: st.o.level }
    });
    const G = t.G;
    G.phase = st.ph; G.handNo = st.hn; G.dealer = st.d; G.turn = st.tu; G.leader = st.ld; G.trickNo = st.tn;
    G.bids = st.bids.slice(); G.tricks = st.tk.slice(); G.trick = st.tr.map(function (x) { return { seat: x[0], card: x[1] }; });
    G.played = st.pl.slice(); G.broken = st.br; G.scores = st.sc.slice(); G.bags = st.bg.slice();
    G.lastTrick = st.lt ? { cards: st.lt.c.map(function (x) { return { seat: x[0], card: x[1] }; }), winner: st.lt.w } : null;
    G.result = st.res; G.history = (st.hist || []).slice(); G.cuts = st.cuts.slice(); G.covers = (st.cov || [0, 0, 0, 0]).slice();
    G.winner = st.win; G.blindOk = st.bl.slice();
    // Hands.
    const taken = new Set(G.played);
    const hands = [null, null, null, null];
    for (let s = 0; s < 4; s++) {
      const h = known[s];
      if (Array.isArray(h) && h.length === st.hc[s] && h.every(function (c) { return U.int(c, 0, 51) && !taken.has(c); })) {
        hands[s] = h.slice(); h.forEach(function (c) { taken.add(c); });
      }
    }
    const pool = [];
    for (let c = 0; c < 52; c++) if (!taken.has(c)) pool.push(c);
    U.shuffle(pool, t.rnd);
    for (let s = 0; s < 4; s++) if (!hands[s]) hands[s] = pool.splice(0, st.hc[s]);
    G.hands = hands.map(R.sortHand);
    t.seq = st.ev && st.ev.length ? st.ev[st.ev.length - 1].q : 0;
    t.log = (st.ev || []).slice();
    t.v = (st.v || 0) + 1;
    t.rebuilt = hands.map(function (h, s) { return !(Array.isArray(known[s]) && known[s].length === st.hc[s]); });
    return t;
  };
  HS.Table = T;
})(globalThis.HS);
