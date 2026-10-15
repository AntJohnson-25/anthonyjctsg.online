// The bots: bidding and card play for empty seats. They only look at their own
// hand and what's on the table (bids, tricks, cards played), never at anyone
// else's cards. Levels: "easy" (loose, never bids nil), "normal", "sharp"
// (counts cards, plays for the set). "chaos" (a host setting, off by default)
// makes them cut their own partner now and then, for the reactions.
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const R = HS.Rules;
  const B = {};
  const S = R.suit, K = R.rank, SP = R.SPADES;
  const ACE = 12, KING = 11, QUEEN = 10, JACK = 9;
  // Villa Spades' fourth table, "shark": everything "sharp" does, plus braver nils
  // and hunting the set harder.
  function isSharp(level) { return level === "sharp" || level === "shark"; }

  function bySuit(h) {
    const o = [[], [], [], []];
    h.forEach(function (c) { o[S(c)].push(c); });
    o.forEach(function (a) { a.sort(function (x, y) { return K(x) - K(y); }); });
    return o;
  }

  // ------------------------------------------------------------------ bidding
  // Expected tricks from a hand (a classic count: aces and kings, spade length,
  // short side suits once there are spades to trump with).
  B.estimate = function (h) {
    const s = bySuit(h), sp = s[SP];
    let t = 0;
    const has = function (suit, r) { return s[suit].some(function (c) { return K(c) === r; }); };
    // Spades.
    if (has(SP, ACE)) t += 1;
    if (has(SP, KING)) t += sp.length >= 2 ? 1 : 0.4;
    if (has(SP, QUEEN)) t += sp.length >= 3 ? 0.9 : 0.3;
    if (has(SP, JACK) && sp.length >= 4) t += 0.5;
    if (sp.length > 3) t += (sp.length - 3) * 0.85;
    // Side suits.
    let ruff = 0;
    for (let su = 0; su < 3; su++) {
      const n = s[su].length;
      if (has(su, ACE)) t += n <= 5 ? 1 : 0.7;
      if (has(su, KING)) t += n >= 2 && n <= 5 ? 0.75 : n === 1 ? 0.1 : 0.4;
      if (has(su, QUEEN) && n >= 3 && n <= 4) t += 0.25;
      if (n === 0) ruff += 1;
      else if (n === 1) ruff += 0.5;
    }
    // Ruffing needs spars spades beyond the ones already counted.
    t += Math.min(ruff, Math.max(0, sp.length - 1) * 0.6);
    return t;
  };
  // Is this a hand that can lose every trick?
  B.nilable = function (h, level) {
    const s = bySuit(h);
    const sp = s[SP];
    if (sp.length > 3 || sp.some(function (c) { return K(c) >= JACK; })) return false;
    let risk = 0;
    for (let su = 0; su < 4; su++) {
      s[su].forEach(function (c) {
        const r = K(c);
        if (r >= KING) risk += 3;
        else if (r === QUEEN) risk += s[su].length >= 4 ? 0.8 : 2;
        else if (r === JACK) risk += s[su].length >= 4 ? 0.4 : 1;
        else if (r >= 7) risk += s[su].length <= 2 ? 0.6 : 0.15;
      });
    }
    return risk <= (level === "shark" ? 1.9 : isSharp(level) ? 1.6 : 1.2);
  };
  B.bid = function (G, seat, level, rnd) {
    rnd = rnd || Math.random;
    const h = G.hands[seat], pt = R.partner(seat);
    const team = R.team(seat);
    // Blind nil: only when well behind, and only sometimes.
    // (A last throw: far behind and the other team close to winning.)
    const behind = G.scores[1 - team] - G.scores[team];
    if (G.blindOk[seat] && level !== "easy" && behind >= 200 && G.scores[1 - team] >= G.opts.target - 120 &&
        G.bids[pt] !== null && !R.isNil(G.bids[pt]) && G.bids[pt] >= 4 && rnd() < 0.5) return R.BLIND;
    let est = B.estimate(h);
    if (level === "easy") est += (rnd() - 0.5) * 2.2;
    if (level !== "easy" && G.bids[pt] === null && B.nilable(h, level) && est < 2.2) return R.NIL;
    if (level !== "easy" && G.bids[pt] !== null && !R.isNil(G.bids[pt]) && B.nilable(h, level) && est < 1.6) return R.NIL;
    // Partner went nil: we have to carry the team, and cover them.
    if (R.isNil(G.bids[pt])) est += 0.6;
    let b = Math.round(est + (isSharp(level) ? 0.3 : 0.15));
    // Near the target with bags piling up: shade a little higher to stop overtricks.
    if (isSharp(level) && G.bags[team] >= 7) b = Math.round(est);
    // Everyone's bids together shouldn't go far past 13.
    const others = G.bids.reduce(function (a, v) { return a + (v > 0 ? v : 0); }, 0);
    if (others + b > 14 && b > 1) b -= 1;
    return Math.max(1, Math.min(13, b));
  };

  // ------------------------------------------------------------------ play
  function lowest(cards) { return cards.slice().sort(function (a, b) { return K(a) - K(b) || (S(a) === SP) - (S(b) === SP); })[0]; }
  function highest(cards) { return cards.slice().sort(function (a, b) { return K(b) - K(a); })[0]; }
  function wins(G, seat, c) { return R.winnerOf(G.trick.concat([{ seat: seat, card: c }])).seat === seat; }
  // Cards someone else could still hold (not ours, not played).
  function outCards(G, seat) {
    const o = [];
    for (let c = 0; c < 52; c++) if (G.played.indexOf(c) < 0 && G.hands[seat].indexOf(c) < 0) o.push(c);
    return o;
  }
  function teamNeed(G, team) {
    let bid = 0, took = 0;
    [team, team + 2].forEach(function (s) { const b = G.bids[s]; if (!R.isNil(b)) { bid += b; took += G.tricks[s]; } });
    return bid - took;
  }
  // Would our card hold up if players after us still have to play? (Boss in its
  // suit and spades either led or nobody seen void - a sharp read.)
  function likelyHolds(G, seat, c, level) {
    const left = 3 - G.trick.length;
    if (left === 0) return true;
    if (S(c) === SP) return R.isBoss(G, c, G.hands[seat]);
    if (!R.isBoss(G, c, G.hands[seat])) return false;
    if (level !== "sharp") return true;
    // How many of the suit are still out: plenty means people still follow.
    const out = outCards(G, seat).filter(function (x) { return S(x) === S(c); }).length;
    return out >= 3;
  }

  B.play = function (G, seat, level, rnd, chaos) {
    rnd = rnd || Math.random;
    const legal = R.legal(G, seat);
    if (legal.length <= 1) return legal[0];
    if (level === "easy" && rnd() < 0.22) return legal[(rnd() * legal.length) | 0];
    const pt = R.partner(seat), team = R.team(seat);
    const meNil = R.isNil(G.bids[seat]) && G.tricks[seat] === 0;
    const ptNil = R.isNil(G.bids[pt]) && G.tricks[pt] === 0;
    const oppNil = [1, 3].map(function (d) { return (seat + d) % 4; }).filter(function (s) { return R.isNil(G.bids[s]) && G.tricks[s] === 0; });
    const need = teamNeed(G, team), oppNeed = teamNeed(G, 1 - team);
    const left = 13 - G.trickNo;
    const winners = legal.filter(function (c) { return wins(G, seat, c); });
    const losers = legal.filter(function (c) { return !wins(G, seat, c); });
    const cur = R.winnerOf(G.trick);
    const lastToPlay = G.trick.length === 3;

    // Chaos: sometimes take a trick off your partner with a spade anyway.
    if (chaos && cur && cur.seat === pt && !ptNil && rnd() < 0.35) {
      const cutters = winners.filter(function (c) { return S(c) === SP; });
      if (cutters.length && losers.length) return lowest(cutters);
    }
    // ---- going nil: lose every trick.
    if (meNil) {
      if (!G.trick.length) {
        const non = legal.filter(function (c) { return S(c) !== SP; });
        return lowest(non.length ? non : legal);
      }
      if (losers.length) {
        // The highest card that still loses (keeps low cards for later).
        const offSp = losers.filter(function (c) { return S(c) !== SP; });
        return highest(offSp.length ? offSp : losers);
      }
      return highest(legal);
    }
    // ---- partner is nil: cover them.
    if (ptNil) {
      const ptPlayed = G.trick.some(function (t) { return t.seat === pt; });
      if (!G.trick.length) {
        // Lead winners so partner can drop low cards under them.
        const boss = legal.filter(function (c) { return S(c) !== SP && R.isBoss(G, c, G.hands[seat]); });
        if (boss.length) return highest(boss);
        return highest(legal.filter(function (c) { return S(c) !== SP; }).length ? legal.filter(function (c) { return S(c) !== SP; }) : legal);
      }
      if (ptPlayed && cur.seat === pt) { if (winners.length) return lowest(winners); return lowest(legal); }
      if (!ptPlayed) { if (winners.length) return highest(winners); return lowest(legal); }
      // Partner played and someone else is already on top: no need to win.
      return lowest(losers.length ? losers : legal);
    }
    // ---- an opponent is nil: make them take one.
    if (oppNil.length && level !== "easy") {
      const nilSeat = oppNil[0];
      const nilPlayed = G.trick.some(function (t) { return t.seat === nilSeat; });
      if (!G.trick.length) {
        const non = legal.filter(function (c) { return S(c) !== SP; });
        return lowest(non.length ? non : legal);
      }
      if (nilPlayed && cur.seat === nilSeat && losers.length) return highest(losers.filter(function (c) { return S(c) !== SP; }).length ? losers.filter(function (c) { return S(c) !== SP; }) : losers);
      if (!nilPlayed) return lowest(losers.length ? losers : legal);
    }

    const wantTricks = need > 0 || (isSharp(level) && need <= 0 && oppNeed > 0 && oppNeed >= left - (level === "shark" ? 2 : 1));
    // ---- leading.
    if (!G.trick.length) {
      if (wantTricks) {
        const boss = legal.filter(function (c) { return R.isBoss(G, c, G.hands[seat]) && (S(c) !== SP || G.broken); });
        const sideBoss = boss.filter(function (c) { return S(c) !== SP; });
        if (sideBoss.length) return highest(sideBoss);
        if (boss.length) return highest(boss);
      }
      // Lead low from the longest side suit (keep spades for trumping).
      const s = bySuit(legal);
      let pick = null;
      [0, 1, 2].forEach(function (su) { if (s[su].length && (!pick || s[su].length > pick.length)) pick = s[su]; });
      return pick ? pick[0] : lowest(legal);
    }
    // ---- following.
    if (cur.seat === pt) {
      // Partner's winning: don't take it off them unless they'll be beaten anyway.
      const safe = lastToPlay || likelyHolds(G, pt, cur.card, level);
      if (safe || !wantTricks) return lowest(losers.length ? losers : legal);
      if (winners.length) {
        const followWin = winners.filter(function (c) { return S(c) === S(G.trick[0].card); });
        if (followWin.length) return lowest(followWin);
      }
      return lowest(losers.length ? losers : legal);
    }
    // An opponent's winning.
    if (wantTricks && winners.length) {
      if (lastToPlay) return lowest(winners);
      // Second hand low unless we can win cheaply and surely.
      const sure = winners.filter(function (c) { return likelyHolds(G, seat, c, level); });
      if (sure.length) return lowest(sure);
      if (G.trick.length === 2) return lowest(winners);
      return lowest(losers.length ? losers : legal);
    }
    // Don't need it: duck, and get rid of the highest card that still loses (bags hurt).
    if (losers.length) {
      const follow = losers.filter(function (c) { return S(c) === S(G.trick[0].card); });
      if (need <= 0) return highest(follow.length ? follow : losers.filter(function (c) { return S(c) !== SP; }).length ? losers.filter(function (c) { return S(c) !== SP; }) : losers);
      return lowest(losers);
    }
    return lowest(legal);
  };
  HS.Bot = B;
})(globalThis.HS);
