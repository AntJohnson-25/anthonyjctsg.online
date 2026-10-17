// Boot, the title, walking the terrace as Ant, sitting down at a table to play and
// standing up again, the frame loop, input, what happens on each table event
// (sounds, reactions, toasts, tags), the settings, and test hooks. Solo only: the
// table runs in this page (net.js in its "solo" role, no network).
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const THREE = globalThis.THREE;
  const Net = HS.Net, T = HS.Table, R = HS.Rules, View = HS.View, Room = HS.Room, Cards = HS.Cards, Seats = HS.Seats, A = HS.Audio, H = HS.HUD, Tut = HS.Tutorial, Crowd = HS.Crowd, t = HS.t;
  const $ = function (id) { return document.getElementById(id); };
  const G = {
    mode: "boot", t: 0, last: 0, fps: 60, table: -1, looked: false, hover: -1, picked: -1, sheet: false,
    opts: { timer: 0, target: 500, blindNil: true, chaos: false },
    prefs: { music: 1, sound: true, reactAuto: true, assist: true, tags: true, quality: null, sens: 1, zoomAuto: false },
    lastPlay: null, nPlay: 0,
    keys: {}, stick: { x: 0, z: 0 }, wins: {}, auto: /[?&]auto=1\b/.test(location.search), autoAt: 0, uiAt: 0, recorded: false
  };
  const DEBUG = /[?&]debug=1\b/.test(location.search);
  const LINEUP = /[?&]lineup=1\b/.test(location.search);

  // ------------------------------------------------------------------ prefs, wins
  function loadPrefs() {
    try {
      const s = JSON.parse(localStorage.getItem("villaspades.prefs") || "{}");
      Object.keys(G.prefs).forEach(function (k) { if (s[k] !== undefined) G.prefs[k] = s[k]; });
      if (s.opts) Object.keys(G.opts).forEach(function (k) { if (s.opts[k] !== undefined) G.opts[k] = s.opts[k]; });
      G.wins = JSON.parse(localStorage.getItem("villaspades.wins") || "{}") || {};
      G.char = localStorage.getItem("villaspades.char") || "Ant";
    } catch (e) { /* storage unavailable */ }
  }
  function savePrefs() { try { localStorage.setItem("villaspades.prefs", JSON.stringify(Object.assign({}, G.prefs, { opts: G.opts }))); } catch (e) { /* ignore */ } }
  function saveWins() { try { localStorage.setItem("villaspades.wins", JSON.stringify(G.wins)); } catch (e) { /* ignore */ } }
  function setLoad(f, msg) { $("loadFill").style.width = (f * 100) + "%"; if (msg) $("loadMsg").textContent = msg; }
  function quality() {
    if (G.prefs.quality) return G.prefs.quality;
    return /Mobi|Android|iPhone|iPad/.test(navigator.userAgent) ? "medium" : "high";
  }

  // ------------------------------------------------------------------ boot
  function boot() {
    HS.fillStrings();
    loadPrefs();
    ["pointerdown", "keydown"].forEach(function (ev) { window.addEventListener(ev, function () { A.unlock(); }, { once: true, passive: true }); });
    A.loadTracks();
    A.setOn(G.prefs.sound); A.setMusic(G.prefs.music);
    if (/Mobi|Android|iPhone|iPad/.test(navigator.userAgent) || "ontouchstart" in window) document.body.classList.add("touch");
    setLoad(0.05, t("boot1"));
    setTimeout(function () {
      const q = quality();
      View.init($("view"), q);
      View.sens = G.prefs.sens;
      setLoad(0.15, t("boot2"));
      setTimeout(function () {
        Room.build(View.scene, View.renderer, q);
        Cards.init(View.scene);
        H.init({ bid: onBid, look: function () { G.looked = true; }, react: onReact, dealNow: dealNow, again: playAgain, endAll: leave, back: leave });
        wire();
        if (DEBUG) startDebug();
        setLoad(0.3, t("boot3"));
        // Every character: the select screen shows them all, and the villa uses most of them.
        const ids = Object.keys(HS.CAST);
        let n = 0;
        Promise.all(ids.map(function (id) {
          return HS.Body.load(id).then(function () { n++; setLoad(0.3 + 0.6 * n / ids.length, t("boot3")); });
        })).then(function () {
          return LINEUP ? null : HS.Portraits.make(ids);
        }).then(function (pics) {
          G.pics = pics || {};
          if (LINEUP) lineup();
          View.renderer.compile(View.scene, View.camera);
          setLoad(1, t("ready"));
          $("loading").hidden = true;
          G.ready = true;
          G.last = performance.now();
          requestAnimationFrame(loop);
          if (LINEUP) { G.mode = "title"; return; }
          showLanding();
        }).catch(function (err) {
          $("err").hidden = false; $("err").textContent = "Couldn't load the game files (" + err + "). Check your connection and reload.";
        });
      }, 20);
    }, 20);
  }

  // ------------------------------------------------------------------ the cover, the character select, walking
  function showLanding() {
    G.mode = "landing";
    $("landing").hidden = false;
    new Image().src = "art/key_notitle.jpg";   // the select screen's art, ready before Play
    H.show(false);
    A.music("menu");
  }
  function showTitle() {
    A.unlock();
    G.mode = "title";
    $("landing").hidden = true;
    $("title").hidden = false;
    syncTitle();
    buildSelect();
  }
  // The character cards: a live render of each one (HS.Portraits), the picked one big.
  function buildSelect() {
    const grid = $("selGrid");
    if (!grid.children.length) {
      // You first, then the Wealth Runners, then everyone else.
      const ids = Object.keys(HS.CAST).sort(function (a, b) { const r = function (x) { return x === "Ant" ? 0 : /^runner_/.test(x) ? 1 : 2; }; return r(a) - r(b); });
      ids.forEach(function (id) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "sel-c"; b.setAttribute("data-id", id);
        b.innerHTML = "<img alt='' src='" + (G.pics[id] || "") + "'><span>" + H.esc(HS.CAST[id].name) + "</span>";
        b.onclick = function () { pick(id); };
        grid.appendChild(b);
      });
    }
    pick(G.char);
  }
  function pick(id) {
    if (!HS.CAST[id]) id = "Ant";
    G.char = id;
    $("selGrid").querySelectorAll(".sel-c").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-id") === id); });
    $("selHeroImg").src = G.pics[id] || "";
    $("selHeroName").textContent = HS.CAST[id].name;   // just the name (user: don't say which game they're from)
    try { localStorage.setItem("villaspades.char", id); } catch (e) { /* ignore */ }
  }
  function seg(id, value, on) {
    $(id).querySelectorAll("button").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-v") === String(value));
      b.onclick = function () { on(b.getAttribute("data-v")); syncTitle(); savePrefs(); };
    });
  }
  function syncTitle() {
    seg("optTimer", G.opts.timer, function (v) { G.opts.timer = +v; });
    seg("optTarget", G.opts.target, function (v) { G.opts.target = +v; });
    seg("optBlind", G.opts.blindNil ? 1 : 0, function (v) { G.opts.blindNil = v === "1"; });
    seg("optChaos", G.opts.chaos ? 1 : 0, function (v) { G.opts.chaos = v === "1"; });
  }
  function enterVilla() {
    A.unlock();
    if (G.mode === "landing") showTitle();
    // Into the villa as the chosen character (they swap places with Ant), once per visit.
    if (!Crowd.ready) { HS.setPlayer(G.char); Crowd.init(); }
    $("title").hidden = true;
    G.mode = "walk";
    $("walkHud").hidden = false;
    A.music("menu");
  }
  // The card by a table's chair: who's there, your record, sit down.
  function prompt() {
    const k = Crowd.near, el = $("prompt");
    $("walkHud").classList.toggle("prompting", G.mode === "walk" && k >= 0);
    if (G.mode !== "walk" || k < 0) { el.hidden = true; G.promptK = -1; return; }
    el.hidden = false;
    if (G.promptK === k) return;
    G.promptK = k;
    const Tb = Room.TABLES[k], crew = HS.CREWS[k], w = G.wins[Tb.tier] || 0;
    el.innerHTML = "<div class='pr-tier " + Tb.tier + "'>" + H.esc(t("tier_" + Tb.tier)) + "</div>" +
      "<div class='pr-sub'>" + H.esc(t("tierSub_" + Tb.tier)) + "</div>" +
      "<div class='pr-crew'>" + H.esc(t("crewLine", crew[1].name, crew[0].name, crew[2].name)) + "</div>" +
      "<div class='pr-wins'>" + (w ? "&#9733; " + H.esc(t("winsLine", w)) : H.esc(t("noWins"))) + "</div>" +
      "<div class='pr-btns'><button type='button' class='play' id='btnSit'>" + H.esc(t(document.body.classList.contains("touch") ? "sitDownTouch" : "sitDown")) + "</button>" +
      (k === 0 ? "<button type='button' class='ghost' id='btnLearn'>" + H.esc(t("sitLearn")) + "</button>" : "") + "</div>";
    $("btnSit").onclick = function () { sit(k, false); };
    if ($("btnLearn")) $("btnLearn").onclick = function () { sit(k, true); };
  }

  // ------------------------------------------------------------------ sitting down, standing up
  function sit(k, tutorial) {
    if (G.mode !== "walk" || k < 0) return;
    A.unlock();
    const Tb = Room.TABLES[k];
    const before = Room.world.position.clone();
    Room.setActive(k);
    View.startBlend(1.2, Room.world.position.clone().sub(before));
    Crowd.handOver(k);
    G.table = k;
    const o = tutorial ? { level: "easy", timer: 0, target: 500, blindNil: false, chaos: false } : Object.assign({ level: Tb.level }, G.opts);
    Net.start(o, tutorial ? 20261013 : undefined, Crowd.crewSeats(k));
    G.mode = "play"; G.recorded = false;
    $("walkHud").hidden = true; $("prompt").hidden = true; G.promptK = -1;
    ["summary", "final", "scoreSheet", "settings", "rulesBox"].forEach(function (id) { $(id).hidden = true; });
    H.show(true);
    H.last = {};
    H.clearChat(); H.unzoom(); G.lastPlay = null; G.picked = -1;
    View.quick("hand");
    View.yaw = View.tYaw; View.pitch = View.tPitch;
    Seats.clear();
    A.music("play");
    G.lastHn = -1;
    if (tutorial) Tut.start();
  }
  function leave() {
    if (G.mode !== "play") return;
    const k = G.table, Tb = Room.TABLES[k];
    Net.stop();
    Seats.clear();
    Tut.stop();
    H.unzoom(); H.playButton(-1); G.picked = -1;
    H.show(false);
    ["summary", "final", "scoreSheet", "rulesBox"].forEach(function (id) { $(id).hidden = true; });
    const before = Room.world.position.clone();
    Room.setActive(-1);
    View.startBlend(1.0, Room.world.position.clone().sub(before));
    Crowd.handOver(-1);
    Crowd.place(Tb.x, Tb.z + 2.15, 0);
    View.walk.yaw = View.walk.tYaw = 0; View.walk.pitch = View.walk.tPitch = -0.22;
    G.table = -1;
    G.mode = "walk";
    $("walkHud").hidden = false;
    A.music("menu");
  }
  function playAgain() { if (G.mode === "play") { const k = G.table; const st = Net.st; void st; Net.start(Object.assign({ level: Room.TABLES[k].level }, G.opts), undefined, Crowd.crewSeats(k)); G.recorded = false; H.last = {}; ["final", "summary"].forEach(function (id) { $(id).hidden = true; }); Seats.clear(); A.music("play"); } }
  function dealNow() { if (Net.runs() && Net.t) { T.nextHand(Net.t, Net.now()); Net.step(); } }

  // ------------------------------------------------------------------ acting
  function onBid(v) { if (Net.bid(v)) { A.chip(); Tut.signal("bid"); G.looked = false; } }
  function tryPlay(c) {
    if (c < 0 || !Net.myTurn() || Net.st.ph !== "play") return false;
    if (Net.legal().indexOf(c) < 0) { A.tick(); return false; }
    if (Net.play(c)) { A.card(true); G.picked = -1; Tut.signal("play"); return true; }
    return false;
  }
  function onReact(r) { if (Net.react(r)) Tut.signal("react"); }

  // ------------------------------------------------------------------ table events
  function handle(e, st, me) {
    const name = function (s) { return H.nameOf(st, s, me); };
    // "You" reads wrong as an object or a possessive: "Shade cut you", "your nil".
    const obj = function (s) { return s === me ? t("youObj") : name(s); };
    const poss = function (s) { return s === me ? t("yourPoss") : name(s) + "'s"; };
    const cap = function (x) { return x.charAt(0).toUpperCase() + x.slice(1); };
    const auto = G.prefs.reactAuto;
    switch (e.type) {
      case "deal": A.deal(); G.looked = false; G.nPlay = 0; G.lastPlay = null; H.chatHand(st.hn); break;
      case "bid": if (e.seat !== me) A.chip(); H.chatBid(st, me, e.seat, e.bid); break;
      case "play":
        if (e.seat !== me) A.card(false);
        // Every trick is 4 plays in order, so the play count says which card led.
        G.lastPlay = { seat: e.seat, card: e.card, led: G.nPlay % 4 === 0 };
        H.chatPlay(st, me, e.seat, e.card, G.lastPlay.led);
        G.nPlay++;
        if (G.prefs.zoomAuto && e.seat !== me) H.zoom(st, me, G.lastPlay, true);
        break;
      case "trick": H.chatTrick(st, me, e.winner); break;
      case "broken": H.toast(t("tBroken")); break;
      case "collect": A.sweep(); Tut.signal("trick"); break;
      case "cut": {
        const top = e.kind === "top", nil = e.kind === "nil";
        H.toast(nil ? t("tNilCut", name(e.seat), poss(e.victim)) : top ? t("tCutTop", name(e.seat), poss(e.victim)) : t("tCut", name(e.seat), obj(e.victim)), "cut");
        A.tsk();
        if (auto) {
          Seats.react(e.victim, nil ? "headdrop" : top ? "shrug" : "shake");
          if (!nil) Seats.react(e.seat, "sheepish");
          H.tag(e.seat, nil ? t("tagNil") : top ? t("tagCutTop") : t("tagCut"), "cut");
        }
        G.cutNil = nil ? e.victim : -1;
        break;
      }
      case "cover":
        H.toast(t("tCover", name(e.seat), poss(e.victim)), "good"); A.chime(false);
        if (auto) { Seats.react(e.victim, "nod"); H.tag(e.seat, t("tagCover"), "good"); }
        break;
      case "nil-broken":
        if (G.cutNil !== e.seat) { H.toast(cap(t("tNilBroken", poss(e.seat)))); if (auto) Seats.react(e.seat, "shrug"); }
        G.cutNil = -1;
        break;
      case "nil-made": H.toast(t(e.blind ? "tBlindMade" : "tNilMade", name(e.seat)), "good"); A.chime(false); break;
      case "set": H.toast(t("tSet", R.team(me >= 0 ? me : 0) === e.team ? H.teamNames(st, me).us : H.teamNames(st, me).them)); break;
      case "boston": H.toast(t("tBoston", R.team(me >= 0 ? me : 0) === e.team ? H.teamNames(st, me).us : H.teamNames(st, me).them), "good"); A.chime(true); break;
      case "bag-penalty": H.toast(t("tBagPenalty", R.team(me >= 0 ? me : 0) === e.team ? H.teamNames(st, me).us : H.teamNames(st, me).them)); break;
      case "hand-end": Tut.signal("handEnd"); break;
      case "game-over":
        A.chime(true); A.music("results");
        if (!G.recorded && st.win === R.team(me) && G.table >= 0) { G.recorded = true; const tier = Room.TABLES[G.table].tier; G.wins[tier] = (G.wins[tier] || 0) + 1; saveWins(); }
        break;
      case "timeout": H.toast(t("tTimeout", obj(e.seat))); break;
      case "react":
        Seats.react(e.seat, e.r, e.r === "point" ? (e.seat + 2) % 4 : -1);
        H.tag(e.seat, t("r_" + e.r), "react");
        break;
    }
  }

  // ------------------------------------------------------------------ the frame
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, Math.max(0, (now - G.last) / 1000));
    G.last = now;
    if (dt > 0) G.fps += (1 / dt - G.fps) * 0.05;
    G.t += dt;
    frame(dt);
    View.render();
  }
  const _focus = new THREE.Vector3(), _launch = new THREE.Vector3();
  function clampCam(p) {
    // Scene -> villa coordinates, keep inside the terrace (not in the villa, not over the sea), back.
    const o = Room.world.position;
    p.x = U.clamp(p.x - o.x, -26.8, 21.8) + o.x;
    p.z = U.clamp(p.z - o.z, -12.5, 13.4) + o.z;
  }
  const U = HS.U;
  function frame(dt) {
    let st = null, hand = [], seat = -1;
    if (G.mode === "play") {
      Net.step();
      st = Net.st; seat = st ? Net.seat : -1; hand = Net.hand;
      const ev = Net.events();
      if (st) {
        // Plays already counted in the state before this batch (for "which card led").
        let last = -1;
        ev.forEach(function (e, i) { if (e.type === "deal") last = i; });
        if (last < 0) G.nPlay = st.pl.length - ev.filter(function (e) { return e.type === "play"; }).length;
        ev.forEach(function (e) { handle(e, st, seat); });
      }
      if (G.auto) autoPlay();
      if (st && st.hn !== G.lastHn) { G.lastHn = st.hn; G.looked = false; }
    }
    H.mySeat = seat;
    const walking = G.mode === "walk" || G.mode === "title";
    // Walking input: keys or the stick.
    let mx = G.stick.x, mz = G.stick.z;
    if (G.keys.a || G.keys.arrowleft) mx -= 1;
    if (G.keys.d || G.keys.arrowright) mx += 1;
    if (G.keys.w || G.keys.arrowup) mz -= 1;
    if (G.keys.s || G.keys.arrowdown) mz += 1;
    if (G.mode !== "walk") { mx = 0; mz = 0; }
    if (!LINEUP) Crowd.update({ dt: dt, move: { x: mx, z: mz }, brisk: !!G.keys.shift, camYaw: View.walk.yaw, walking: walking });
    if (G.mode === "walk") prompt();
    const tf = function (k, a) { return t(k, a); };
    Seats.update({ st: st, seat: seat, dt: dt, t: tf, hideTags: !G.prefs.tags });
    const playing = G.mode === "play" && seat >= 0 && st;
    const myTurn = playing && Net.myTurn();
    const legal = myTurn && st.ph === "play" ? Net.legal() : [];
    const faceDown = playing && st.ph === "bid" && st.bl[seat] && st.o.blind && st.bids[seat] === null && !G.looked;
    // A card we play rises from just under the camera, where the hand strip is.
    const launch = playing ? _launch.set(0, -0.13, -0.32).applyQuaternion(View.camera.quaternion).add(View.camera.position) : null;
    Cards.update({ st: st, hand: hand, seat: seat, eye: Seats.eye, launch: launch, dt: dt });
    if (playing) H.hand({ cards: hand.slice(0, Cards.mineDealt), legal: legal, assist: G.prefs.assist, picked: G.picked, hover: G.hover, faceDown: faceDown, turn: myTurn && st.ph === "play" });
    if (LINEUP) View.update({ mode: "walk", focus: _focus.set(G.lineupX || 0, 1.2, 9), dt: dt, t: G.t });
    else View.update({ mode: playing ? "seat" : "walk", seat: seat, eye: Seats.eye, dt: dt, t: G.t, focus: Crowd.focus(_focus), clamp: clampCam });
    Room.update(dt, G.t, G.mode === "play" && G.table >= 0 ? Room.TABLES[G.table] : Crowd.pos);
    // A wave breaks on the beach once a period (the same clock as the ocean's shader).
    const wave = Math.floor(G.t / HS.Ocean.PERIOD - 0.12);
    if (wave !== G.wave) { G.wave = wave; A.surf(0.7 + Math.random() * 0.3); }
    if (G.mode === "play" && st) ui(st, seat, myTurn, faceDown);
    H.placeTags();
  }
  // The flat UI, ten times a second.
  function ui(st, seat, myTurn, faceDown) {
    if (G.t - G.uiAt < 0.1) return;
    G.uiAt = G.t;
    const now = Net.now();
    H.scores(st, seat);
    const name = function (s) { return st.seats[s][0]; };
    let txt = "", left = null, total = 0;
    if (now < (st.at || 0)) txt = t("dealing", H.nameOf(st, st.d, seat));
    else if (st.ph === "bid") txt = myTurn || st.tu === seat ? t("yourBid") : t("bidding", name(st.tu));
    else if (st.ph === "play") txt = myTurn || st.tu === seat ? (st.tr.length ? t("yourTurn") : t("yourLead")) : t("playing", name(st.tu));
    else if (st.ph === "trick") txt = st.lt ? (st.lt.w === seat ? t("youTakeTrick") : t("trickTo", H.nameOf(st, st.lt.w, seat))) : "";
    else if (st.ph === "hand" || st.ph === "over") txt = t("handOver");
    if (st.ph === "play" && st.tr.length && txt) txt += "  ·  " + t("ledSuit", R.SUITS[R.suit(st.tr[0][1])]);
    if (st.dl && (st.ph === "bid" || st.ph === "play") && !st.seats[st.tu][1]) { left = Math.max(0, (st.dl - now) / 1000); total = st.o.timer; }
    H.status(txt, myTurn, left, total);
    if (myTurn && !G.wasMyTurn) A.turn();
    G.wasMyTurn = myTurn;
    const open = myTurn && st.ph === "bid";
    let hint;
    if (open) { const est = HS.Bot.estimate(Net.hand); hint = Math.max(1, Math.min(13, Math.round(est))); }
    // Touch: a big Play button for the lifted card (a tray card is a thin target on a phone).
    const canPlay = myTurn && st.ph === "play" && G.picked >= 0 && Net.hand.indexOf(G.picked) >= 0;
    H.playButton(document.body.classList.contains("touch") && canPlay ? G.picked : -1, canPlay && Net.legal().indexOf(G.picked) >= 0);
    H.bidPanel({ open: open, blindOk: open && st.bl[seat] && st.o.blind, looked: !faceDown, hint: hint, partnerBid: seat >= 0 ? st.bids[(seat + 2) % 4] : null });
    H.summary(st, seat, st.ph === "hand", { now: now, canDeal: true });
    H.final(st, seat, st.ph === "over", { canRestart: true, online: false, host: false });
    H.sheet(st, seat, G.sheet && st.ph !== "over");
  }
  // Test hook: play our own turns with the bot's logic.
  function autoPlay() {
    if (!Net.myTurn()) { G.autoAt = 0; return; }
    if (!G.autoAt) { G.autoAt = performance.now() + 500; return; }
    if (performance.now() < G.autoAt) return;
    G.autoAt = 0;
    const st = Net.st, s = Net.seat;
    const fake = { phase: st.ph, turn: s, hands: [], trick: st.tr.map(function (x) { return { seat: x[0], card: x[1] }; }), broken: st.br, bids: st.bids.slice(), tricks: st.tk.slice(), played: st.pl.slice(), trickNo: st.tn, scores: st.sc.slice(), bags: st.bg.slice(), blindOk: st.bl.slice(), opts: { target: st.o.target } };
    fake.hands[s] = Net.hand.slice();
    if (st.ph === "bid") onBid(HS.Bot.bid(fake, s, "normal"));
    else tryPlay(HS.Bot.play(fake, s, "normal"));
  }

  // ------------------------------------------------------------------ input
  function wire() {
    const cv = $("view");
    let drag = null, stick = null;
    cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    cv.addEventListener("pointerdown", function (e) {
      A.unlock();
      const touch = e.pointerType === "touch";
      if (touch) document.body.classList.add("touch");
      // On a phone, the left third of the screen is the walking stick.
      if (G.mode === "walk" && touch && e.clientX < window.innerWidth * 0.4) {
        stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
        const s = $("stick"); s.hidden = false; s.style.left = e.clientX + "px"; s.style.top = e.clientY + "px";
        try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
        return;
      }
      // Anywhere else: drag to look around (your cards are the strip along the bottom).
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, button: e.button };
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
    });
    cv.addEventListener("pointermove", function (e) {
      if (stick && e.pointerId === stick.id) {
        const dx = e.clientX - stick.x, dy = e.clientY - stick.y, L = Math.hypot(dx, dy), k = Math.min(1, L / 55) / Math.max(1, L);
        G.stick.x = dx * k; G.stick.z = dy * k;
        $("stickKnob").style.transform = "translate(" + (G.stick.x * 38) + "px," + (G.stick.z * 38) + "px)";
        return;
      }
      if (drag && e.pointerId === drag.id) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        if (G.mode === "walk" || G.mode === "title") View.walkLook(dx, dy);
        else if (G.mode === "play") { View.look(dx, dy); Tut.signal("look", Math.abs(dx) + Math.abs(dy)); }
        drag.x = e.clientX; drag.y = e.clientY;
      }
    });
    const up = function (e) {
      if (stick && e.pointerId === stick.id) { stick = null; G.stick.x = G.stick.z = 0; $("stick").hidden = true; $("stickKnob").style.transform = ""; return; }
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null;
      // A still tap on the table puts a lifted card back down.
      if (G.mode === "play" && d.moved < 8 && d.button !== 2) G.picked = -1;
    };
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    // Your hand, the strip along the bottom. A finger: tap a card (or slide along the
    // strip) to lift it, then tap it again or press Play. A mouse: hover lifts, click plays.
    const dock = $("hand");
    let hd = null;
    const cardAt = function (x, y) {
      const el = document.elementFromPoint(x, y), b = el && el.closest ? el.closest(".hc") : null;
      return b && dock.contains(b) ? +b.getAttribute("data-c") : -1;
    };
    dock.addEventListener("pointerdown", function (e) {
      A.unlock();
      const c = cardAt(e.clientX, e.clientY);
      if (c < 0 || G.mode !== "play") return;
      e.preventDefault();
      hd = { id: e.pointerId, c: c, was: G.picked, moved: 0, x: e.clientX, y: e.clientY, touch: e.pointerType !== "mouse" };
      if (hd.touch && G.picked !== c) { G.picked = c; A.flick(); }
      try { dock.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
    });
    dock.addEventListener("pointermove", function (e) {
      if (hd && e.pointerId === hd.id) {
        hd.moved += Math.abs(e.clientX - hd.x) + Math.abs(e.clientY - hd.y);
        hd.x = e.clientX; hd.y = e.clientY;
        const c = cardAt(e.clientX, e.clientY);
        if (hd.touch && c >= 0 && c !== G.picked) { G.picked = c; A.flick(); }
      } else if (e.pointerType === "mouse" && G.mode === "play") {
        const c = cardAt(e.clientX, e.clientY);
        if (c !== G.hover && c >= 0) A.flick();
        G.hover = c;
      }
    });
    const dockUp = function (e) {
      if (!hd || e.pointerId !== hd.id) return;
      const d = hd; hd = null;
      if (e.type === "pointercancel" || d.moved > 12) return;
      // A finger plays the card that was already lifted; a click plays straight away.
      if (!d.touch || d.c === d.was) tryPlay(d.c);
    };
    dock.addEventListener("pointerup", dockUp);
    dock.addEventListener("pointercancel", dockUp);
    dock.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse" && !hd) G.hover = -1; });
    window.addEventListener("keydown", function (e) {
      const k = e.key.toLowerCase();
      if (k === "escape") { closeOverlays(); return; }
      if (G.mode === "landing") { if (k === "enter" || k === " ") { e.preventDefault(); showTitle(); } return; }
      if (G.mode === "walk" || G.mode === "title") {
        if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].indexOf(k) >= 0) { G.keys[k] = true; if (k.indexOf("arrow") === 0) e.preventDefault(); }
        if (G.mode === "title" && (k === "enter" || k === " ")) { enterVilla(); e.preventDefault(); return; }
        if (G.mode === "walk" && (k === "e" || k === "enter") && Crowd.near >= 0) sit(Crowd.near, false);
        else if (k === "p") toggleSettings();
        else if (k === "m") setSound(!G.prefs.sound);
        else if (k === "h") toggle("rulesBox");
        return;
      }
      if (G.mode !== "play" || e.repeat && e.key !== "Tab") return;
      if (H.wheelOpen && /^[0-9]$/.test(k)) { const i = (+k + 9) % 10; const r = Net.REACTS[i]; if (r) onReact(r); H.wheel(false); return; }
      if (k === "1") View.quick("partner");
      else if (k === "2") View.quick("left");
      else if (k === "3") View.quick("right");
      else if (k === "4") View.quick("trick");
      else if (k === " ") { e.preventDefault(); View.quick("hand"); }
      else if (k === "r") H.wheel();
      else if (k === "z") zoomLast();
      else if (k === "h") toggle("rulesBox");
      else if (k === "p") toggleSettings();
      else if (k === "m") setSound(!G.prefs.sound);
      else if (k === "l") leave();
      else if (k === "tab") { e.preventDefault(); G.sheet = true; }
      else if (k === "arrowleft" || k === "arrowright") { moveHover(k === "arrowleft" ? -1 : 1); e.preventDefault(); }
      else if (k === "enter" || k === "arrowup") { if (G.hover >= 0) tryPlay(G.hover); e.preventDefault(); }
      if (/^[1-4 ]$/.test(k)) Tut.signal("look", 200);
    });
    window.addEventListener("keyup", function (e) { const k = e.key.toLowerCase(); G.keys[k] = false; if (k === "tab") G.sheet = false; });
    window.addEventListener("blur", function () { G.keys = {}; });
    $("lookPad").querySelectorAll("button").forEach(function (b) { b.onclick = function () { View.quick(b.getAttribute("data-q")); Tut.signal("look", 200); }; });
    $("btnPlayCard").onclick = function () { tryPlay(G.picked); };
    $("btnZoom").onclick = zoomLast;
    $("sZoom").onclick = function () { G.prefs.zoomAuto = !G.prefs.zoomAuto; syncSettings(); savePrefs(); };
    $("btnEnter").onclick = enterVilla;
    $("btnStart").onclick = showTitle;
    $("btnRandom").onclick = function () { const ids = Object.keys(HS.CAST).filter(function (x) { return x !== G.char; }); pick(ids[(Math.random() * ids.length) | 0]); };
    $("btnRules").onclick = function () { toggle("rulesBox"); };
    $("rulesClose").onclick = function () { toggle("rulesBox"); };
    $("btnHelp").onclick = function () { toggle("rulesBox"); };
    $("btnLeave").onclick = leave;
    $("btnSettings").onclick = toggleSettings;
    $("btnWalkSettings").onclick = toggleSettings;
    $("sClose").onclick = toggleSettings;
    $("sMusic").oninput = function () { G.prefs.music = +this.value; A.setMusic(G.prefs.music); savePrefs(); };
    $("sSens").oninput = function () { G.prefs.sens = +this.value; View.sens = G.prefs.sens; savePrefs(); };
    $("sSound").onclick = function () { setSound(!G.prefs.sound); };
    $("sReact").onclick = function () { G.prefs.reactAuto = !G.prefs.reactAuto; syncSettings(); savePrefs(); };
    $("sAssist").onclick = function () { G.prefs.assist = !G.prefs.assist; syncSettings(); savePrefs(); };
    $("sTags").onclick = function () { G.prefs.tags = !G.prefs.tags; syncSettings(); savePrefs(); };
    $("sQuality").onclick = function () {
      const order = ["high", "medium", "low"], cur = View.quality;
      G.prefs.quality = order[(order.indexOf(cur) + 1) % 3];
      View.setQuality(G.prefs.quality); syncSettings(); savePrefs();
    };
    // The settings sheet doubles as the menu on a phone (only ☺ and ⚙ stay on screen there).
    $("sRules").onclick = function () { toggleSettings(); toggle("rulesBox"); };
    $("sLeave").onclick = function () { toggleSettings(); leave(); };
    syncSettings();
  }
  function closeOverlays() { ["settings", "rulesBox"].forEach(function (id) { $(id).hidden = true; }); H.wheel(false); }
  function moveHover(d) {
    const h = Net.hand;
    if (!h.length) return;
    const i = h.indexOf(G.hover);
    G.hover = h[(i < 0 ? (d > 0 ? 0 : h.length - 1) : (i + d + h.length) % h.length)];
    A.flick();
  }
  // Zoom in on the last card played (button, Z); again closes it.
  function zoomLast() {
    if (G.mode !== "play" || !Net.st) return;
    if (!$("zoom").hidden) { H.unzoom(); return; }
    H.zoom(Net.st, Net.seat, G.lastPlay);
  }
  function toggle(id) { $(id).hidden = !$(id).hidden; }
  function toggleSettings() { toggle("settings"); syncSettings(); }
  function setSound(on) { G.prefs.sound = on; A.setOn(on); syncSettings(); savePrefs(); }
  function syncSettings() {
    $("sMusic").value = G.prefs.music;
    $("sSens").value = G.prefs.sens;
    $("sSound").textContent = G.prefs.sound ? t("on") : t("off");
    $("sReact").textContent = G.prefs.reactAuto ? t("on") : t("off");
    $("sAssist").textContent = G.prefs.assist ? t("on") : t("off");
    $("sTags").textContent = G.prefs.tags ? t("on") : t("off");
    $("sZoom").textContent = G.prefs.zoomAuto ? t("on") : t("off");
    $("sQuality").textContent = t(View.quality || "high");
    $("sLeave").hidden = G.mode !== "play";
  }

  // ------------------------------------------------------------------ debug, the cast line-up, test hooks
  function startDebug() {
    const el = document.createElement("div");
    el.className = "debug";
    document.body.appendChild(el);
    setInterval(function () {
      const info = View.renderer.info;
      el.textContent = Math.round(G.fps) + " fps · calls " + info.render.calls + " · tris " + Math.round(info.render.triangles / 1000) + "k\n" +
        G.mode + (Net.st ? " · " + Net.st.ph + " hand " + Net.st.hn : "") + " · ant " + Crowd.pos.x.toFixed(1) + "," + Crowd.pos.z.toFixed(1);
    }, 500);
  }
  // ?lineup=1: every character standing in a row with its id, for picking the cast.
  function lineup() {
    const ids = Object.keys(HS.CAST);
    ids.forEach(function (id, i) {
      const b = HS.Body.make(id, HS.heightOf(id));
      b.play(i % 2 ? "idle_f" : "idle", { fade: 0 });
      b.update(0.5);
      b.root.position.set(-24 + i * 1.1, 0, 9);
      Room.world.add(b.root);
      const c = HS.Build.canvas(256, 64), g = c.getContext("2d");
      g.fillStyle = "#000"; g.fillRect(0, 0, 256, 64); g.fillStyle = "#fff"; g.font = "bold 34px sans-serif"; g.textAlign = "center"; g.fillText(id.slice(0, 12), 128, 44);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c) }));
      s.scale.set(0.9, 0.22, 1); s.position.set(-24 + i * 1.1, 2.15 + (i % 2) * 0.25, 9);
      Room.world.add(s);
    });
    View.walk.dist = 7; View.walk.yaw = View.walk.tYaw = Math.PI; View.walk.pitch = View.walk.tPitch = -0.05;
    G.lineupX = -24;
  }
  window.HST = {
    G: G,
    enter: function () { enterVilla(); return G.mode; },
    select: function (id) { if (G.mode === "landing") showTitle(); if (id) pick(id); return G.char; },
    sit: function (k, tut) { if (G.mode === "title" || G.mode === "landing") enterVilla(); sit(k || 0, !!tut); return Net.role; },
    leave: function () { leave(); return G.mode; },
    walkTo: function (x, z, yaw) { Crowd.place(x, z, yaw || 0); return [x, z]; },
    cam: function (yaw, pitch, dist) { const W = View.walk; W.yaw = W.tYaw = yaw; W.pitch = W.tPitch = pitch; if (dist) W.dist = dist; return true; },
    lineupAt: function (x) { G.lineupX = x; return x; },
    auto: function (on) { G.auto = on; return on; },
    warp: function (ms) { Net.offset += ms; return Net.offset; },
    look: function (yaw, pitch) { View.tYaw = View.yaw = yaw; View.tPitch = View.pitch = pitch; return true; },
    quick: function (k) { View.quick(k); View.yaw = View.tYaw; View.pitch = View.tPitch; return k; },
    state: function () { const s = Net.st; return s ? { ph: s.ph, hn: s.hn, tu: s.tu, seat: Net.seat, bids: s.bids, tk: s.tk, sc: s.sc, hand: Net.hand.length, tr: s.tr.length } : { mode: G.mode }; },
    react: function (s, kind) { Seats.react(s, kind); return true; },
    run: function (sec, step) { step = step || 1 / 30; for (let x = 0; x < sec; x += step) { frame(step); } View.render(); return G.mode + (Net.st ? ":" + Net.st.ph : ""); },
    stats: function () { const i = View.renderer.info; return { calls: i.render.calls, tris: i.render.triangles, geos: i.memory.geometries, tex: i.memory.textures, fps: Math.round(G.fps), roomTris: Room.stats && Room.stats.tris, leaves: Room.stats && Room.stats.leaves }; }
  };
  boot();
})(globalThis.HS);
