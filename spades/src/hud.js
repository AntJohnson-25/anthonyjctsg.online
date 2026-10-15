// The flat parts on top of the 3D view (all kept off the top of the screen, where
// the players' faces are): scores, whose turn it is (with the turn timer), the
// chat-style feed of plays and table messages, the bid chips, the little tags that float over a seat, the
// reaction wheel, the hand summary, the game-over card and the rules sheet.
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const t = HS.t, R = HS.Rules;
  const $ = function (id) { return document.getElementById(id); };
  const H = { tags: [], last: {} };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  H.esc = esc;
  H.init = function (on) {
    H.on = on;
    // Bid chips: nil, 1..13.
    const grid = $("bidGrid");
    grid.innerHTML = "";
    for (let v = 0; v <= 13; v++) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip" + (v === 0 ? " nil" : "");
      b.textContent = v === 0 ? t("bidNil") : String(v);
      b.setAttribute("data-v", v);
      b.onclick = function () { on.bid(v); };
      grid.appendChild(b);
    }
    $("btnBlind").onclick = function () { on.bid(-1); };
    $("btnLook").onclick = function () { on.look(); };
    // Reaction wheel.
    const wheel = $("wheel");
    HS.Net.REACTS.forEach(function (r, i) {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = "<kbd>" + ((i + 1) % 10) + "</kbd>" + esc(t("r_" + r));
      b.onclick = function () { on.react(r); H.wheel(false); };
      wheel.appendChild(b);
    });
    $("btnReact").onclick = function () { H.wheel(); };
    $("zoom").onclick = function () { H.unzoom(); };
    // Rules sheet.
    $("rulesBody").innerHTML = HS.RULES.map(function (s) { return "<h3>" + esc(s[0]) + "</h3><p>" + s[1] + "</p>"; }).join("");
  };
  H.show = function (on) { $("hud").hidden = !on; };
  H.wheel = function (open) {
    const w = $("wheel");
    w.hidden = open === undefined ? !w.hidden : !open;
    H.wheelOpen = !w.hidden;
  };

  // ------------------------------------------------------------------ names
  H.teamNames = function (st, seat) {
    const me = seat >= 0 ? seat : 0, pt = (me + 2) % 4, o1 = (me + 1) % 4, o2 = (me + 3) % 4;
    const n = function (s) { return st.seats[s][0]; };
    return { us: seat >= 0 ? t("teamUs", n(pt)) : n(me) + " & " + n(pt), them: t("teamThem", n(o1), n(o2)) };
  };
  function nameOf(st, s, seat) { return s === seat ? t("you") : st.seats[s][0]; }
  H.nameOf = nameOf;

  // ------------------------------------------------------------------ scores and status
  H.scores = function (st, seat) {
    const me = seat >= 0 ? seat : 0, us = me % 2, them = 1 - us;
    const names = H.teamNames(st, seat);
    const bidOf = function (team) {
      const bs = [st.bids[team], st.bids[team + 2]];
      if (bs.every(function (b) { return b === null; })) return "—";
      let n = 0;
      const nil = [];
      bs.forEach(function (b) { if (b === null) return; if (R.isNil(b)) nil.push(b === -1 ? "B.nil" : "nil"); else n += b; });
      return n + (nil.length ? " + " + nil.join(" + ") : "");
    };
    const took = function (team) { return st.tk[team] + st.tk[team + 2]; };
    const row = function (team, cls, name) {
      return "<div class='team " + cls + "'><div class='tn'><span>" + esc(name) + "</span><span>" + esc(t("bags", st.bg[team])) + "</span></div>" +
        "<div class='sc'>" + st.sc[team] + "</div><div class='sub'>" + t("bid") + " <b>" + bidOf(team) + "</b> · " + t("took2") + " <b>" + took(team) + "</b></div></div>";
    };
    const html = row(us, "us", names.us) + row(them, "them", names.them) + "<div class='meta'>" + esc(t("hand", st.hn)) + " · " + esc(t("target", st.o.target)) + "</div>";
    if (html !== H.last.scores) { $("scores").innerHTML = html; H.last.scores = html; }
  };
  H.status = function (text, mine, left, total) {
    const el = $("status");
    if (text !== H.last.status) { $("statusTxt").textContent = text; H.last.status = text; }
    el.classList.toggle("mine", !!mine);
    const timed = left !== null && left !== undefined && total > 0;
    el.classList.toggle("no-timer", !timed);
    if (timed) {
      const frac = Math.max(0, Math.min(1, left / total));
      $("ringFg").style.strokeDashoffset = String(97.4 * (1 - frac));
      $("ringTxt").textContent = String(Math.ceil(left));
      el.classList.toggle("urgent", left < 6);
    } else el.classList.remove("urgent");
  };

  // A little playing card for the HUD ("Q♥").
  function cardHtml(c, cls) {
    const s = R.suit(c);
    return "<span class='mc" + (s === 1 || s === 2 ? " red" : "") + (cls ? " " + cls : "") + "'>" + R.RANKS[R.rank(c)] + R.SUITS[s] + "</span>";
  }
  H.cardHtml = cardHtml;
  // ------------------------------------------------------------------ the chat feed (left side)
  // Like a live-chat overlay on a stream: no panel, each card played (and each bid,
  // trick won and table event) pops in as a line and fades away after a while.
  // The card that led a trick is tagged, our side's names are lime (your partner's
  // line carries a lime edge), the other team's lilac.
  const CHAT_LIFE = 10000, CHAT_MAX = 8;
  H.chat = function (html, cls) {
    const box = $("chat");
    const el = document.createElement("div");
    el.className = "msg" + (cls ? " " + cls : "");
    el.innerHTML = html;
    box.appendChild(el);
    while (box.children.length > CHAT_MAX) box.removeChild(box.firstChild);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, CHAT_LIFE);
    return el;
  };
  H.clearChat = function () { $("chat").innerHTML = ""; };
  function role(s, seat) { return seat < 0 ? (s % 2 ? "them" : "us") : s === seat ? "me" : s === (seat + 2) % 4 ? "partner" : "them"; }
  function who(st, s, seat) {
    const r = role(s, seat);
    return "<b class='who " + r + "'>" + esc(nameOf(st, s, seat)) + "</b>" + (r === "partner" ? "<i class='tagp'>" + esc(t("partnerTag")) + "</i>" : "");
  }
  // A card played: led = it opened the trick. Tap the line to zoom in on the card.
  H.chatPlay = function (st, seat, s, c, led) {
    const el = H.chat(who(st, s, seat) + " " + cardHtml(c) + (led ? "<i class='tagled'>" + esc(t("ledTag")) + " " + R.SUITS[R.suit(c)] + "</i>" : ""), role(s, seat) + " zoomable");
    el.onclick = function () { H.zoom(st, seat, { seat: s, card: c, led: led }); };
  };

  // ------------------------------------------------------------------ zoom in on a card played
  // The card big in the middle of the screen (drawn with the deck's own art), who
  // played it and whether it led. Any tap or click closes it, and it closes itself
  // (sooner when it popped up on its own, with the "zoom each card" setting).
  H.zoom = function (st, seat, p, auto) {
    const box = $("zoom");
    clearTimeout(H.zoomT);
    if (!p) { H.toast(t("zoomNone")); return; }
    const cv = $("zoomCard"), g = cv.getContext("2d");
    g.clearRect(0, 0, cv.width, cv.height);
    HS.Cards.drawCardTo(g, p.card, 0, 0);
    $("zoomCap").innerHTML = who(st, p.seat, seat) + " <span class='say'>" + esc(t("zoomCap", "").trim()) + "</span> " + cardHtml(p.card) +
      (p.led ? "<i class='tagled'>" + esc(t("ledTag")) + " " + R.SUITS[R.suit(p.card)] + "</i>" : "");
    box.classList.toggle("auto", !!auto);
    box.hidden = false;
    // Restart the pop-in animation.
    box.style.animation = "none"; void box.offsetWidth; box.style.animation = "";
    H.zoomT = setTimeout(H.unzoom, auto ? 1600 : 4000);
  };
  H.unzoom = function () { clearTimeout(H.zoomT); $("zoom").hidden = true; };
  H.chatBid = function (st, seat, s, v) {
    H.chat(who(st, s, seat) + " <span class='say'>" + esc(t("chatBid", v === -1 ? t("bidBlind") : v === 0 ? t("bidNil") : v)) + "</span>", role(s, seat) + " quiet");
  };
  H.chatTrick = function (st, seat, w) {
    H.chat("&#9733; " + who(st, w, seat) + " <span class='say'>" + esc(w === seat ? t("chatTookYou") : t("chatTook")) + "</span>", "sys " + role(w, seat));
  };

  // Touch: "Play 5♦" for the card lifted out of the tray (dimmed if it can't be played now).
  H.playButton = function (c, legal) {
    const b = $("btnPlayCard");
    b.hidden = c < 0;
    if (c < 0) return;
    const key = c + (legal ? "+" : "-");
    if (H.last.playBtn !== key) {
      H.last.playBtn = key;
      b.innerHTML = esc(t("playCard", "")).trim() + " " + cardHtml(c);
      b.classList.toggle("off", !legal);
    }
  };

  // ------------------------------------------------------------------ bidding
  // o: { open, blindOk, looked, hint, partnerBid, teamBid }
  H.bidPanel = function (o) {
    $("bidPanel").hidden = !o.open;
    if (!o.open) return;
    const blindStage = o.blindOk && !o.looked;
    $("bidGrid").hidden = blindStage;
    $("bidBlind").hidden = !blindStage;
    const parts = [];
    if (!blindStage && o.hint !== undefined) parts.push(t("bidHint", "<b>" + o.hint + "</b>"));
    if (o.partnerBid !== null && o.partnerBid !== undefined) parts.push(t("bidPartner", o.partnerBid === -1 ? t("bidBlind") : o.partnerBid === 0 ? t("bidNil") : o.partnerBid));
    $("bidSub").innerHTML = parts.join(" · ");
    $("bidGrid").querySelectorAll(".chip").forEach(function (b) { b.classList.toggle("hint", +b.getAttribute("data-v") === o.hint); });
  };

  // ------------------------------------------------------------------ table messages and floating tags
  // Messages ("Spades are broken", "Sean cut you"…) go into the chat feed (they used to pop up at the top, over faces).
  H.toast = function (text, cls) { H.chat(esc(text), "sys" + (cls ? " " + cls : "")); };
  // A tag over a seat (follows the head on screen while it shows).
  H.tag = function (seat, text, cls) {
    const el = document.createElement("div");
    el.className = "ftag" + (cls ? " " + cls : "");
    el.textContent = text;
    $("tags").appendChild(el);
    const rec = { seat: seat, el: el, until: performance.now() + 2400 };
    H.tags.push(rec);
    H.placeTags();
  };
  H.placeTags = function () {
    const now = performance.now();
    H.tags = H.tags.filter(function (r) { if (now > r.until) { r.el.remove(); return false; } return true; });
    H.tags.forEach(function (r) {
      const p = HS.Seats.headPos(r.seat);
      p.y += r.seat === H.mySeat ? -0.25 : 0.5;
      const s = HS.View.toScreen(p);
      if (r.seat === H.mySeat) { s.x = window.innerWidth / 2; s.y = window.innerHeight * 0.62; s.behind = false; }
      r.el.style.display = s.behind ? "none" : "";
      r.el.style.left = s.x + "px"; r.el.style.top = s.y + "px";
    });
  };

  // ------------------------------------------------------------------ hand summary
  H.summary = function (st, seat, open, opts) {
    $("summary").hidden = !open;
    if (!open || !st.res) return;
    const me = seat >= 0 ? seat : 0, us = me % 2, names = H.teamNames(st, seat);
    const res = st.res;
    const teamRow = function (team, cls, name) {
      const r = res.teams[team];
      const bid = r.bid + (r.nils.length ? " + " + r.nils.map(function (n) { return n.blind ? "B.nil" : "nil"; }).join(" + ") : "");
      const pts = r.points - r.penalty;
      return "<tr class='" + cls + "'><td>" + esc(name) + "</td><td>" + bid + "</td><td>" + r.tricks + "</td><td>" + (pts > 0 ? "+" : "") + pts + "</td><td>" + r.bagTotal + "</td><td class='tot'>" + r.total + "</td></tr>";
    };
    const notes = [];
    [us, 1 - us].forEach(function (team) {
      const r = res.teams[team];
      r.nils.forEach(function (n) { notes.push("<div class='" + (n.made ? "good" : "bad") + "'>" + esc(t(n.made ? "sumNilMade" : "sumNilFail", nameOf(st, n.seat, seat), n.blind ? 200 : 100)) + "</div>"); });
      const tn = team === us ? names.us : names.them;
      if (r.bid > 0) notes.push("<div class='" + (r.set ? "bad" : "good") + "'>" + esc(tn + ": " + (r.set ? t("sumSet", r.bid * 10) : t("sumMade", r.bid * 10 + Math.max(0, r.took - r.bid)))) + "</div>");
      if (r.penalty) notes.push("<div class='bad'>" + esc(tn + ": " + t("sumPenalty", r.penalty)) + "</div>");
    });
    const left = Math.max(0, Math.ceil(((st.nx || 0) - opts.now) / 1000));
    const html = "<h2>" + esc(t("sumTitle", st.hn)) + "</h2><table class='sum-table'><tr><th></th><th>" + t("sumBid") + "</th><th>" + t("sumTook") + "</th><th>" + t("sumPoints") + "</th><th>" + t("sumBags") + "</th><th>" + t("sumTotal") + "</th></tr>" +
      teamRow(us, "us", names.us) + teamRow(1 - us, "them", names.them) + "</table><div class='sum-notes'>" + notes.join("") + "</div>" +
      "<div class='sum-next'><span>" + esc(t("nextIn", left)) + "</span>" + (opts.canDeal ? "<button type='button' id='btnDeal'>" + esc(t("dealNow")) + "</button>" : "") + "</div>";
    if (html !== H.last.sum) {
      $("sumBody").innerHTML = html; H.last.sum = html;
      const b = $("btnDeal"); if (b) b.onclick = function () { H.on.dealNow(); };
    }
  };

  // ------------------------------------------------------------------ game over
  H.final = function (st, seat, open, o) {
    $("final").hidden = !open;
    if (!open) return;
    const me = seat >= 0 ? seat : 0, us = me % 2, names = H.teamNames(st, seat);
    const won = st.win === us;
    const cutsUs = st.cuts[us] + st.cuts[us + 2], cutsThem = st.cuts[1 - us] + st.cuts[3 - us];
    const per = [0, 1, 2, 3].map(function (s) { return "<div>" + esc(nameOf(st, s, seat)) + ": " + esc(t("cutsLine", st.cuts[s])) + (st.cov[s] ? " · " + esc(t("coversLine", st.cov[s])) : "") + "</div>"; }).join("");
    let btns = "";
    if (o.canRestart) btns += "<button type='button' class='primary' id='fAgain'>" + esc(o.online ? t("playAgainHost") : t("playAgain")) + "</button>";
    else btns += "<div class='sum-notes' style='text-align:center'>" + esc(t("waitNext")) + "</div>";
    if (o.online && o.host) btns += "<button type='button' id='fEnd'>" + esc(t("endAll")) + "</button>";
    btns += "<button type='button' id='fBack'>" + esc(o.online ? t("backLobby") : t("backMenu")) + "</button>";
    const html = "<div class='final-title " + (won && seat >= 0 ? "win" : "") + "'>" + esc(seat < 0 ? t("teamWins", st.win === 0 ? names.us : names.them) : won ? t("youWin") : t("youLose")) + "</div>" +
      "<div class='final-score'>" + esc(names.us) + " " + st.sc[us] + " – " + st.sc[1 - us] + " " + esc(names.them) + "</div>" +
      "<div class='sum-notes'>" + per + "</div><div class='sum-notes' style='margin-top:6px'>" + esc(t("cutsLine", cutsUs + " / " + cutsThem)) + "</div>" +
      "<div class='final-btns'>" + btns + "</div>";
    if (html !== H.last.final) {
      $("finalBody").innerHTML = html; H.last.final = html;
      const a = $("fAgain"), e = $("fEnd"), b = $("fBack");
      if (a) a.onclick = H.on.again; if (e) e.onclick = H.on.endAll; if (b) b.onclick = H.on.back;
    }
  };

  // The running score sheet (Tab).
  H.sheet = function (st, seat, open) {
    $("scoreSheet").hidden = !open;
    if (!open) return;
    const me = seat >= 0 ? seat : 0, us = me % 2, names = H.teamNames(st, seat);
    const rows = (st.hist || []).map(function (h) { return "<tr><td>" + h.hand + "</td><td>" + (h.points[us] > 0 ? "+" : "") + h.points[us] + "</td><td>" + h.scores[us] + "</td><td>" + (h.points[1 - us] > 0 ? "+" : "") + h.points[1 - us] + "</td><td>" + h.scores[1 - us] + "</td></tr>"; }).join("");
    const html = "<h2>" + esc(t("sumTotal")) + "</h2><table class='sum-table'><tr><th>#</th><th colspan='2'>" + esc(names.us) + "</th><th colspan='2'>" + esc(names.them) + "</th></tr>" + rows +
      "<tr class='tot'><td></td><td></td><td>" + st.sc[us] + "</td><td></td><td>" + st.sc[1 - us] + "</td></tr></table>";
    if (html !== H.last.sheet) { $("sheetBody").innerHTML = html; H.last.sheet = html; }
  };
  HS.HUD = H;
})(globalThis.HS);
