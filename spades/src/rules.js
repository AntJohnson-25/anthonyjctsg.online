// The rules of partnership Spades, the standard way (Notes/PLAN.md section 5).
// Pure: no DOM, no network, no clock. The host runs it; tools/sim-test.js
// plays thousands of games through it.
//
// Cards are numbers 0..51: suit = c / 13 (0 clubs, 1 diamonds, 2 hearts,
// 3 spades), rank = c % 13 (0 = two ... 12 = ace). Seats 0..3 go clockwise
// (play passes to the left); partners sit opposite: team = seat % 2.
// Bids: 1..13 tricks, 0 = nil, -1 = blind nil.
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const R = {};
  const SPADES = 3, NIL = 0, BLIND = -1;
  R.SPADES = SPADES; R.NIL = NIL; R.BLIND = BLIND;
  R.suit = function (c) { return (c / 13) | 0; };
  R.rank = function (c) { return c % 13; };
  R.card = function (suit, rank) { return suit * 13 + rank; };
  R.partner = function (s) { return (s + 2) % 4; };
  R.team = function (s) { return s % 2; };
  R.isNil = function (b) { return b === NIL || b === BLIND; };
  const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const SUITS = ["♣", "♦", "♥", "♠"];
  R.RANKS = RANKS; R.SUITS = SUITS;
  R.name = function (c) { return RANKS[R.rank(c)] + SUITS[R.suit(c)]; };

  R.DEFAULTS = { target: 500, floor: -200, blindNil: true, bagLimit: 10, bagPenalty: 100 };

  // ------------------------------------------------------------------ a game
  R.newGame = function (opts, firstDealer) {
    const o = Object.assign({}, R.DEFAULTS, opts || {});
    return {
      opts: o, scores: [0, 0], bags: [0, 0], handNo: 0, dealer: (firstDealer || 0) % 4,
      phase: "idle", hands: [[], [], [], []], bids: [null, null, null, null], tricks: [0, 0, 0, 0],
      trick: [], leader: 0, turn: 0, broken: false, played: [], trickNo: 0, lastTrick: null,
      history: [], cuts: [0, 0, 0, 0], covers: [0, 0, 0, 0], winner: -1, result: null, nilRisk: null, blindOk: [false, false, false, false]
    };
  };

  // Deal a new hand. The dealer moves one seat left each hand (not before the first).
  R.deal = function (G, rnd) {
    if (G.handNo > 0) G.dealer = (G.dealer + 1) % 4;
    G.handNo++;
    const deck = [];
    for (let c = 0; c < 52; c++) deck.push(c);
    HS.U.shuffle(deck, rnd);
    G.hands = [0, 1, 2, 3].map(function (s) { return R.sortHand(deck.slice(s * 13, s * 13 + 13)); });
    G.bids = [null, null, null, null];
    G.tricks = [0, 0, 0, 0];
    G.trick = []; G.played = []; G.trickNo = 0; G.broken = false; G.lastTrick = null; G.result = null; G.nilRisk = null; G.nilSave = null;
    G.turn = (G.dealer + 1) % 4;
    G.leader = G.turn;
    G.phase = "bid";
    // Blind nil: only for a team at least 100 points behind when the hand starts.
    G.blindOk = [0, 1, 2, 3].map(function (s) {
      const t = R.team(s);
      return !!G.opts.blindNil && G.scores[1 - t] - G.scores[t] >= 100;
    });
    return [{ type: "deal", hand: G.handNo, dealer: G.dealer }];
  };
  // Sorted the way people hold them: by suit (clubs, diamonds, spades, hearts
  // alternate colours), low to high.
  const SUIT_ORDER = [0, 1, 3, 2];
  R.sortHand = function (h) {
    return h.slice().sort(function (a, b) { return SUIT_ORDER[R.suit(a)] - SUIT_ORDER[R.suit(b)] || R.rank(a) - R.rank(b); });
  };

  // ------------------------------------------------------------------ bidding
  R.validBid = function (G, seat, v) {
    if (G.phase !== "bid" || G.turn !== seat) return false;
    if (v === BLIND) return !!G.blindOk[seat];
    return typeof v === "number" && v === Math.floor(v) && v >= 0 && v <= 13;
  };
  R.bid = function (G, seat, v) {
    if (!R.validBid(G, seat, v)) return null;
    G.bids[seat] = v;
    const ev = [{ type: "bid", seat: seat, bid: v }];
    if (G.bids.every(function (b) { return b !== null; })) {
      G.phase = "play";
      G.turn = G.leader = (G.dealer + 1) % 4;
      ev.push({ type: "play-start" });
    } else G.turn = (G.turn + 1) % 4;
    return ev;
  };

  // ------------------------------------------------------------------ tricks
  // Who's winning a (partial) trick: the highest spade, else the highest card of the suit led.
  R.winnerOf = function (trick) {
    if (!trick.length) return null;
    let best = trick[0];
    for (let i = 1; i < trick.length; i++) {
      const t = trick[i], bs = R.suit(best.card), ts = R.suit(t.card);
      if (ts === bs) { if (R.rank(t.card) > R.rank(best.card)) best = t; }
      else if (ts === SPADES) best = t;   // a different suit only wins if it's a spade
    }
    return best;
  };
  R.legal = function (G, seat) {
    const h = G.hands[seat];
    if (G.phase !== "play" || G.turn !== seat || !h.length) return [];
    if (!G.trick.length) {
      // Leading: no spades until they're broken, unless that's all you have.
      if (G.broken) return h.slice();
      const non = h.filter(function (c) { return R.suit(c) !== SPADES; });
      return non.length ? non : h.slice();
    }
    const led = R.suit(G.trick[0].card);
    const follow = h.filter(function (c) { return R.suit(c) === led; });
    return follow.length ? follow : h.slice();
  };
  R.isLegal = function (G, seat, c) { return R.legal(G, seat).indexOf(c) >= 0; };
  // Is card c the highest one of its suit still out (every higher one played)?
  R.isBoss = function (G, c, extraKnown) {
    const s = R.suit(c);
    for (let r = R.rank(c) + 1; r < 13; r++) {
      const k = R.card(s, r);
      if (G.played.indexOf(k) < 0 && !(extraKnown && extraKnown.indexOf(k) >= 0)) return false;
    }
    return true;
  };

  R.play = function (G, seat, c) {
    if (!R.isLegal(G, seat, c)) return null;
    const ev = [];
    const before = G.trick.slice(), legal = R.legal(G, seat);
    const cur = R.winnerOf(before), pt = R.partner(seat), ptNil = R.isNil(G.bids[pt]);
    const after = before.concat([{ seat: seat, card: c }]);
    const takes = R.winnerOf(after).seat === seat;
    if (cur && cur.seat === pt) {
      const wouldTake = function (x) { return R.winnerOf(before.concat([{ seat: seat, card: x }])).seat === seat; };
      if (!ptNil && takes && R.suit(c) === SPADES) {
        // Cutting your partner: a spade that takes a trick your partner was
        // winning, when you had a card that would have left it with them.
        if (legal.some(function (x) { return x !== c && !wouldTake(x); })) {
          // A "top card" cut: their card was the best one still out in its suit.
          const top = R.isBoss(G, cur.card, before.map(function (t) { return t.card; }));
          ev.push({ type: "cut", seat: seat, victim: pt, kind: top ? "top" : "trick" });
          G.cuts[seat]++;
        }
      }
      if (ptNil && !takes && legal.some(function (x) { return wouldTake(x); })) {
        // Your nil partner is winning and you could have covered them: if
        // nobody else takes it off them, that's on you.
        G.nilRisk = { seat: seat, victim: pt };
      }
      if (ptNil && takes) G.nilSave = { seat: seat, victim: pt };
    }
    G.hands[seat] = G.hands[seat].filter(function (x) { return x !== c; });
    G.trick.push({ seat: seat, card: c });
    G.played.push(c);
    if (R.suit(c) === SPADES && !G.broken) { G.broken = true; ev.push({ type: "broken", seat: seat }); }
    ev.unshift({ type: "play", seat: seat, card: c });
    if (G.trick.length < 4) { G.turn = (G.turn + 1) % 4; return ev; }
    // The trick is complete: it stays on the table until R.collect().
    const w = R.winnerOf(G.trick).seat;
    G.tricks[w]++;
    G.lastTrick = { cards: G.trick.slice(), winner: w };
    G.phase = "trick";
    G.turn = -1;
    ev.push({ type: "trick", winner: w, no: G.trickNo });
    if (G.nilRisk && G.nilRisk.victim === w) {
      ev.push({ type: "cut", seat: G.nilRisk.seat, victim: w, kind: "nil" });
      G.cuts[G.nilRisk.seat]++;
    } else if (G.nilSave && G.nilSave.seat === w) {
      ev.push({ type: "cover", seat: w, victim: G.nilSave.victim });
      G.covers[w]++;
    }
    if (R.isNil(G.bids[w]) && G.tricks[w] === 1) ev.push({ type: "nil-broken", seat: w });
    G.nilRisk = null; G.nilSave = null;
    return ev;
  };

  // Clear the finished trick: the winner leads the next one, or the hand is scored.
  R.collect = function (G) {
    if (G.phase !== "trick") return null;
    const w = G.lastTrick.winner;
    G.trick = [];
    G.trickNo++;
    if (G.trickNo < 13) {
      G.phase = "play";
      G.turn = G.leader = w;
      return [{ type: "collect", winner: w }];
    }
    return [{ type: "collect", winner: w }].concat(R.score(G));
  };

  // ------------------------------------------------------------------ scoring
  R.scoreTeam = function (G, t) {
    const seats = [t, t + 2];
    const r = { team: t, bid: 0, took: 0, nils: [], points: 0, bags: 0, set: false, penalty: 0, tricks: 0 };
    seats.forEach(function (s) {
      const b = G.bids[s], k = G.tricks[s];
      r.tricks += k;
      if (R.isNil(b)) {
        const made = k === 0, val = b === BLIND ? 200 : 100;
        r.nils.push({ seat: s, blind: b === BLIND, made: made, points: made ? val : -val });
        r.points += made ? val : -val;
        // Tricks a nil bidder takes don't help the contract; they are bags.
        r.points += k; r.bags += k;
      } else { r.bid += b; r.took += k; }
    });
    if (r.bid > 0) {
      if (r.took >= r.bid) { const over = r.took - r.bid; r.points += 10 * r.bid + over; r.bags += over; }
      else { r.points -= 10 * r.bid; r.set = true; }
    } else { r.points += r.took; r.bags += r.took; }   // both partners bid nil
    return r;
  };
  R.score = function (G) {
    const ev = [];
    const res = [0, 1].map(function (t) { return R.scoreTeam(G, t); });
    res.forEach(function (r) {
      const t = r.team;
      G.scores[t] += r.points;
      G.bags[t] += r.bags;
      while (G.bags[t] >= G.opts.bagLimit) {
        G.bags[t] -= G.opts.bagLimit; G.scores[t] -= G.opts.bagPenalty; r.penalty += G.opts.bagPenalty;
        ev.push({ type: "bag-penalty", team: t });
      }
      r.total = G.scores[t]; r.bagTotal = G.bags[t];
      if (r.set) ev.push({ type: "set", team: t });
      if (r.tricks === 13) ev.push({ type: "boston", team: t });
      r.nils.forEach(function (n) { ev.push({ type: n.made ? "nil-made" : "nil-failed", seat: n.seat, blind: n.blind }); });
    });
    G.result = { hand: G.handNo, teams: res, bids: G.bids.slice(), tricks: G.tricks.slice() };
    G.history.push({ hand: G.handNo, points: [res[0].points - res[0].penalty, res[1].points - res[1].penalty], scores: G.scores.slice() });
    const s = G.scores, o = G.opts;
    if ((s[0] >= o.target || s[1] >= o.target || s[0] <= o.floor || s[1] <= o.floor) && s[0] !== s[1]) {
      G.winner = s[0] > s[1] ? 0 : 1;
      G.phase = "over";
      ev.push({ type: "hand-end", hand: G.handNo });
      ev.push({ type: "game-over", team: G.winner });
    } else {
      G.phase = "hand";
      ev.push({ type: "hand-end", hand: G.handNo });
    }
    return ev;
  };

  HS.Rules = R;
})(globalThis.HS);
