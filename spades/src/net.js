// Villa Spades (forked from Hop Spades) is solo only: no HopLobby on the page, so this
// always runs in its "solo" role (the table runs right here) and the relay code below
// is never used. It is kept as it was so fixes can still move between the two games.
//
// Multiplayer over the HopLobby relay (the host pattern). The lobby host runs
// the table (table.js); everyone else shows what the host says.
//  - Hands are private: each one goes only to its owner, HopLobby.send(..., id).
//    The public state (scores, bids, the trick, how many cards each seat holds)
//    never carries a hand.
//  - Every message is checked: the relay passes anything along.
//  - A player who reloads or arrives late says "hi" and gets the table and
//    their own hand back; a newcomer takes a bot's seat.
//  - If the host leaves, HopLobby makes someone else host: they ask everyone
//    for their own hand, rebuild the table from the last public state and
//    carry on (cards nobody reports are re-dealt from the ones left).
// Solo (opened on its own, or a lobby of one) runs the same table locally.
//
// Messages:
//   host -> all    { t: "st", s: publicState }        on every change, and every 2.5 s
//   host -> one    { t: "hand", id, hn, c: [cards] }   your hand
//   host -> all    { t: "menu" }                      no game running
//   any  -> host   { t: "hi" }                         I'm here: send me the table
//   player -> host { t: "act", id, hn, bid } / { t: "act", id, hn, card }
//   any  -> all    { t: "re", r }                      a reaction (wave, cheer, ...)
//   new host -> all { t: "rehand?" } ; player -> new host { t: "myhand", id, hn, c }
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const T = HS.Table, R = HS.Rules, U = HS.U;
  const BEAT = 2500, REACTS = ["wave", "cheer", "shrug", "thumbs", "clap", "nod", "shake", "laugh", "facepalm", "point"];
  const N = {
    role: "solo", ctx: null, on: {}, t: null, st: null, hand: [], seat: -1, lastQ: 0, out: [],
    beatAt: 0, sentV: 0, sentHand: {}, lastHi: 0, rehand: null, pendingAct: null, reactAt: 0
  };
  N.REACTS = REACTS;
  function hl() { return typeof HopLobby !== "undefined" ? HopLobby : null; }
  function myId() { const H = hl(); return H && H.context ? H.context.playerId : "me"; }
  function hostId() { const H = hl(); return H && H.context ? H.context.hostId : "me"; }
  function send(d, to) { const H = hl(); if (N.role === "solo" || !H) return; H.send(d, to); }
  N.offset = 0;   // test hook: fast-forward the table's clock
  N.now = function () { const H = hl(); return (H && H.now ? H.now() : Date.now()) + N.offset; };

  N.init = function (ctx, handlers) {
    N.ctx = ctx;
    N.on = handlers || {};
    if (!ctx || ctx.standalone) { N.role = "solo"; return; }
    N.role = ctx.hostId === ctx.playerId ? "host" : "client";
    const H = hl();
    H.on("message", onMessage);
    H.on("players", onPlayers);
    H.on("relay", function (s) { if (s === "open" && N.role === "client") hello(true); });
    if (N.role === "client") hello(true);
  };
  N.isHost = function () { return N.role === "host"; };
  N.isClient = function () { return N.role === "client"; };
  N.online = function () { return N.role !== "solo"; };
  N.runs = function () { return N.role !== "client"; };   // this machine runs the table
  function hello(force) {
    const now = Date.now();
    if (!force && now - N.lastHi < 1500) return;
    N.lastHi = now;
    send({ t: "hi" }, hostId());
  }

  // ------------------------------------------------------------------ starting a game (host / solo)
  // Humans sit as partners first: two friends play together against two bots.
  const ORDER = [0, 2, 1, 3];
  N.humans = function () {
    const H = hl();
    if (N.role === "solo" || !H) return [{ name: (H && H.me && H.me.name) || "You", hl: myId() }];
    return H.players.slice().sort(function (a, b) { return (b.isHost ? 1 : 0) - (a.isHost ? 1 : 0); })
      .slice(0, 4).map(function (p) { return { name: String(p.name || "Player").slice(0, 24), hl: p.id }; });
  };
  // Villa Spades: `crew` is the table's four seats ({ name, look: character id }); you are seat 0.
  N.start = function (opts, seed, crew) {
    seed = seed || ((Math.random() * 4294967296) >>> 0) || 1;
    const humans = N.humans();
    const seats = crew.map(function (c) { return { name: c.name, bot: true, look: c.look }; });
    humans.forEach(function (h, i) { const s = seats[ORDER[i]]; s.botName = s.name; s.bot = false; s.hl = h.hl; });
    N.t = T.create({ seed: seed, seats: seats, opts: opts });
    seats.forEach(function (s, i) { if (s.botName) N.t.seats[i].botName = s.botName; });
    T.start(N.t, N.now());
    N.lastQ = 0; N.sentHand = {}; N.sentV = 0; N.beatAt = 0;
    adopt(T.publicState(N.t));
    hostFlush(true);
    return N.t;
  };
  N.stop = function () {
    N.t = null; N.st = null; N.hand = []; N.seat = -1;
    if (N.isHost()) send({ t: "menu" });
  };

  // The host's (and solo's) heartbeat: run the table, tell everyone what changed.
  N.step = function () {
    const now = N.now();
    if (N.rehand && now >= N.rehand.askAt && now < N.rehand.until) { N.rehand.askAt = now + 400; send({ t: "rehand?" }); }
    if (N.rehand && now >= N.rehand.until) finishRehand();
    if (N.isClient()) {
      // Our move got no answer (a dropped message): send it again.
      const p = N.pendingAct;
      if (p && N.st && p.v === N.st.v && Date.now() - p.sent > 1200) {
        p.sent = Date.now(); p.tries = (p.tries || 0) + 1;
        if (p.tries > 6) { N.pendingAct = null; if (p.a.card !== undefined) hello(true); }
        else send(Object.assign({ t: "act", id: N.st.id, hn: N.st.hn }, p.a), hostId());
      }
      return;
    }
    if (!N.t) return;
    T.step(N.t, now);
    hostFlush(false);
  };
  function hostFlush(force) {
    const t = N.t, now = N.now();
    T.events(t).forEach(function (e) { N.out.push(e); botReact(e); });
    // Hands go out again every few seconds whatever happens (a lost one heals).
    const handBeat = now >= (N.handBeatAt || 0);
    if (t.v !== N.sentV || force || now >= N.beatAt || handBeat) {
      const beat = handBeat;
      if (handBeat) N.handBeatAt = now + BEAT;
      N.sentV = t.v; N.beatAt = now + BEAT;
      const st = T.publicState(t);
      adopt(st, true);
      send({ t: "st", s: st });
      t.seats.forEach(function (s, i) {
        if (s.bot || !s.hl) return;
        const h = T.hand(t, i), key = t.G.handNo + ":" + h.join(",");
        if (s.hl === myId()) return;
        if (N.sentHand[s.hl] !== key || beat) { N.sentHand[s.hl] = key; send({ t: "hand", id: t.id, hn: t.G.handNo, c: h }, s.hl); }
      });
    }
  }
  // Bots react too: a nil made, a cut by their partner.
  function botReact(e) {
    const t = N.t;
    if (!t) return;
    const r = t.rnd();
    let seat = -1, what = "";
    if (e.type === "nil-made") { seat = R.partner(e.seat); what = "clap"; if (t.seats[e.seat].bot && r < 0.5) { seat = e.seat; what = "cheer"; } }
    else if (e.type === "game-over") { seat = [e.team, e.team + 2].find(function (s) { return t.seats[s].bot; }); what = "cheer"; }
    else if (e.type === "boston") { seat = [e.team, e.team + 2].find(function (s) { return t.seats[s].bot; }); what = "cheer"; }
    if (seat === undefined || seat < 0 || !t.seats[seat].bot) return;
    const ev = { type: "react", seat: seat, r: what, q: ++t.seq };
    t.log.push(ev); N.out.push(ev);
  }

  // What this machine shows: the public state, our seat, our hand.
  function adopt(st, ours) {
    N.st = st;
    N.seat = -1;
    st.seats.forEach(function (s, i) { if (!s[1] && s[2] === myId()) N.seat = i; });
    if (N.runs() && N.t && N.seat >= 0) N.hand = T.hand(N.t, N.seat);
    else if (N.seat < 0) N.hand = [];
    if (!ours) {
      // A client: events we haven't seen yet, in order.
      const ev = st.ev || [];
      ev.forEach(function (e) { if (e.q > N.lastQ) { N.out.push(e); N.lastQ = e.q; } });
    } else N.lastQ = N.t ? N.t.seq : N.lastQ;
  }
  N.events = function () { const o = N.out; N.out = []; return o; };

  // ------------------------------------------------------------------ acting
  N.myTurn = function () {
    if (N.pendingAct && N.st && N.pendingAct.v === N.st.v) return false;   // sent; waiting for the host
    if (N.rehand || (N.runs() && !N.t)) return false;                     // a new host still rebuilding
    return !!N.st && N.seat >= 0 && N.st.tu === N.seat && (N.st.ph === "bid" || N.st.ph === "play") && N.now() >= (N.st.at || 0);
  };
  N.legal = function () {
    const st = N.st;
    if (!N.myTurn() || st.ph !== "play") return [];
    // The same rule the host applies (rules.js), on our own hand.
    const G = { phase: "play", turn: N.seat, hands: [], trick: st.tr.map(function (x) { return { seat: x[0], card: x[1] }; }), broken: st.br };
    G.hands[N.seat] = N.hand;
    return R.legal(G, N.seat);
  };
  N.bid = function (v) { return act({ bid: v }); };
  N.play = function (c) { return act({ card: c }); };
  function act(a) {
    if (!N.myTurn()) return false;
    if (a.card !== undefined && N.legal().indexOf(a.card) < 0) return false;
    if (N.runs()) {
      const ok = T.act(N.t, N.seat, a, N.now());
      if (ok) hostFlush(false);
      return ok;
    }
    // Client: ask the host; show it straight away (the host's state confirms it).
    send(Object.assign({ t: "act", id: N.st.id, hn: N.st.hn }, a), hostId());
    N.pendingAct = { a: a, at: Date.now(), sent: Date.now(), v: N.st.v };
    if (a.card !== undefined) N.hand = N.hand.filter(function (c) { return c !== a.card; });
    return true;
  }
  N.react = function (r) {
    if (REACTS.indexOf(r) < 0 || N.seat < 0) return false;
    const now = Date.now();
    if (now - N.reactAt < 2500) return false;
    N.reactAt = now;
    N.out.push({ type: "react", seat: N.seat, r: r, mine: true });
    send({ t: "re", r: r });
    return true;
  };

  // ------------------------------------------------------------------ messages
  function seatOf(from) {
    const st = N.st;
    if (!st) return -1;
    for (let i = 0; i < 4; i++) if (!st.seats[i][1] && st.seats[i][2] === from) return i;
    return -1;
  }
  function onMessage(d, from) {
    if (!d || typeof d !== "object" || typeof d.t !== "string") return;
    if (d.t === "re") {
      const s = seatOf(from);
      if (s >= 0 && REACTS.indexOf(d.r) >= 0) N.out.push({ type: "react", seat: s, r: d.r });
      return;
    }
    if (N.isHost()) {
      if (d.t === "hi") {
        if (N.rehand) return;   // still rebuilding after the old host left: they'll hear soon
        if (!N.t) { send({ t: "menu" }, from); return; }
        seatLatecomer(from);
        const s = seatOf(from);
        send({ t: "st", s: T.publicState(N.t) }, from);
        if (s >= 0) send({ t: "hand", id: N.t.id, hn: N.t.G.handNo, c: T.hand(N.t, s) }, from);
      } else if (d.t === "act" && N.t && d.id === N.t.id && d.hn === N.t.G.handNo) {
        const s = seatOf(from);
        if (s < 0) return;
        let a = null;
        if (U.int(d.bid, -1, 13)) a = { bid: d.bid };
        else if (U.int(d.card, 0, 51)) a = { card: d.card };
        if (a && T.act(N.t, s, a, N.now())) hostFlush(false);
        else if (a) { const st = T.publicState(N.t); send({ t: "st", s: st }, from); send({ t: "hand", id: N.t.id, hn: N.t.G.handNo, c: T.hand(N.t, s) }, from); }
      } else if (d.t === "myhand" && N.rehand && Array.isArray(d.c) && d.c.length <= 13) {
        // Someone may have seen a later state than ours (the old host's last
        // message reached them, not us): the freshest one wins.
        if (validState(d.s) && N.st && d.s.id === N.st.id && d.s.v > N.st.v) N.st = d.s;
        N.rehand.hands[from] = { hn: d.hn, c: d.c.filter(function (c) { return U.int(c, 0, 51); }) };
      }
      return;
    }
    if (from !== hostId()) return;
    if (d.t === "st") clientState(d.s);
    else if (d.t === "hand") clientHand(d);
    else if (d.t === "menu") { if (N.st) { N.st = null; N.hand = []; N.seat = -1; } if (N.on.menu) N.on.menu(); }
    else if (d.t === "rehand?" && N.st && N.seat >= 0) send({ t: "myhand", id: N.st.id, hn: N.st.hn, c: fullHand(), s: N.st }, from);
  }
  // A public state from the host: checked for shape before we trust it.
  function validState(s) {
    if (!s || typeof s !== "object" || typeof s.id !== "string" || !U.num(s.v) || !Array.isArray(s.seats) || s.seats.length !== 4) return false;
    if (!Array.isArray(s.bids) || s.bids.length !== 4 || !Array.isArray(s.tk) || !Array.isArray(s.tr) || s.tr.length > 4) return false;
    if (!Array.isArray(s.sc) || !Array.isArray(s.hc) || !Array.isArray(s.pl) || ["bid", "play", "trick", "hand", "over"].indexOf(s.ph) < 0) return false;
    return s.seats.every(function (x) { return Array.isArray(x) && typeof x[0] === "string"; }) && s.tr.every(function (x) { return Array.isArray(x) && U.int(x[0], 0, 3) && U.int(x[1], 0, 51); });
  }
  function clientState(s) {
    if (!validState(s)) return;
    s.seats.forEach(function (x) { x[0] = x[0].slice(0, 24); });
    const fresh = !N.st || N.st.id !== s.id;
    if (!fresh && s.v < N.st.v) return;       // an old one, arriving late
    if (fresh) { N.lastQ = s.ev && s.ev.length ? s.ev[0].q - 1 : 0; N.hand = []; if (N.on.start) N.on.start(s); }
    const hnChanged = !N.st || N.st.hn !== s.hn;
    adopt(s, false);
    if (hnChanged && !fresh) N.hand = [];
    // Our own play went through (or was refused): the host's word stands.
    if (N.pendingAct && s.v > N.pendingAct.v) N.pendingAct = null;
    // No seat, or our cards don't add up (a hand message got lost): ask again.
    if (N.seat < 0 || (!N.pendingAct && N.st.hc[N.seat] !== N.hand.length)) hello(false);
  }
  function clientHand(d) {
    if (!N.st || d.id !== N.st.id || !Array.isArray(d.c) || d.c.length > 13 || !d.c.every(function (c) { return U.int(c, 0, 51); })) return;
    if (d.hn !== N.st.hn) return;
    // A play we just sent may not be in this copy yet.
    let c = d.c;
    if (N.pendingAct && N.pendingAct.a.card !== undefined && N.pendingAct.v === N.st.v) c = c.filter(function (x) { return x !== N.pendingAct.a.card; });
    N.hand = R.sortHand(c);
  }

  // ------------------------------------------------------------------ people coming and going
  function seatLatecomer(id) {
    if (!N.t || seatOf(id) >= 0) return false;
    const H = hl(), p = H.players.find(function (x) { return x.id === id; });
    if (!p) return false;
    // A seat a human left (a bot's keeping it warm) first, else any bot seat.
    let s = -1;
    ORDER.forEach(function (i) { if (s < 0 && N.t.seats[i].bot) s = i; });
    if (s < 0) return false;   // full: they watch
    T.toHuman(N.t, s, p.name, id);
    if (N.on.joined) N.on.joined(p.name, s);
    N.st = T.publicState(N.t);
    hostFlush(true);
    return true;
  }
  function onPlayers(players, newHost) {
    const ids = new Set(players.map(function (p) { return p.id; }));
    if (newHost === myId() && N.role === "client") {
      // The host left and HopLobby made us host.
      N.role = "host";
      if (N.st) {
        N.rehand = { until: N.now() + 2000, askAt: N.now() + 400, hands: {}, mine: N.pendingAct };
        N.rehand.hands[myId()] = { hn: N.st.hn, c: fullHand() };
        send({ t: "rehand?" });
      }
      if (N.on.promoted) N.on.promoted();
      return;
    }
    if (N.isHost() && N.t) {
      let changed = false;
      N.t.seats.forEach(function (s, i) {
        if (!s.bot && s.hl && s.hl !== myId() && !ids.has(s.hl)) {
          const name = s.name;
          T.toBot(N.t, i); changed = true;
          if (N.on.left) N.on.left(name, i);
        }
      });
      players.forEach(function (p) { if (seatOf(p.id) < 0 && p.id !== myId()) changed = seatLatecomer(p.id) || changed; });
      if (changed) hostFlush(true);
    }
  }
  // Our hand including a card we've sent but nobody's confirmed (the old host
  // may never have got it; we'll send it again to the new one).
  function fullHand() {
    const p = N.pendingAct;
    if (p && p.a.card !== undefined && N.hand.indexOf(p.a.card) < 0 && N.st && N.st.pl.indexOf(p.a.card) < 0) return R.sortHand(N.hand.concat([p.a.card]));
    return N.hand.slice();
  }
  function finishRehand() {
    const rh = N.rehand;
    N.rehand = null;
    if (!N.st) return;
    const H = hl(), ids = new Set(H ? H.players.map(function (p) { return p.id; }) : []);
    // Each seat's hand, from whoever sits there (checked against the state we go with).
    const known = [null, null, null, null];
    N.st.seats.forEach(function (s, i) { const h = !s[1] && rh.hands[s[2]]; if (h && h.hn === N.st.hn) known[i] = h.c; });
    N.t = T.fromPublic(N.st, known, (Math.random() * 4294967296) >>> 0);
    // Seats of people who've gone become bots.
    N.t.seats.forEach(function (s, i) { if (!s.bot && s.hl && !ids.has(s.hl)) T.toBot(N.t, i); });
    N.sentHand = {};
    N.t.turnKey = "";
    // Our own move the old host may not have seen: make it now.
    N.pendingAct = null;
    if (rh.mine && N.seat >= 0) T.act(N.t, N.seat, rh.mine.a, N.now(), true);
    hostFlush(true);
    if (N.on.rebuilt) N.on.rebuilt();
  }
  HS.Net = N;
})(globalThis.HS);
