// "How to play": a guided hand against three easy bots. A coach card at the
// top walks through looking around, the hand, bidding, following suit, tricks,
// cutting your partner, reactions and scoring; each step waits for you to do
// the thing (or press Next). The text is in strings.js (HS.TUTORIAL), the same
// words as Notes/HOW-TO-PLAY.md.
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const $ = function (id) { return document.getElementById(id); };
  const T = { active: false, i: 0, tricks: 0, lookMoved: 0 };
  T.start = function () {
    T.active = true; T.i = 0; T.tricks = 0; T.lookMoved = 0;
    $("coachNext").onclick = function () { T.signal("next"); };
    $("coachSkip").onclick = function () { T.stop(); };
    show();
  };
  T.stop = function () { T.active = false; $("coach").hidden = true; };
  function show() {
    const step = HS.TUTORIAL[T.i];
    if (!step) { T.stop(); return; }
    $("coach").hidden = false;
    $("coachStep").textContent = (T.i + 1) + " / " + HS.TUTORIAL.length;
    $("coachText").innerHTML = step.text;
    $("coachNext").hidden = step.wait !== "next" && step.wait !== "look";
    $("coachNext").textContent = HS.t(step.last ? "done" : "next");
  }
  // Something happened: "next", "look", "bid", "play", "trick", "react", "handEnd".
  T.signal = function (what, amount) {
    if (!T.active) return;
    const step = HS.TUTORIAL[T.i];
    if (!step) return;
    if (what === "trick") T.tricks++;
    if (what === "look") { T.lookMoved += amount || 0; if (T.lookMoved < 120) return; }
    let done = false;
    if (step.wait === what) done = true;
    if (step.wait === "look" && what === "next") done = true;
    if (step.wait === "tricks3" && T.tricks >= 3) done = true;
    // Steps that wait for an action move on if you've already done it.
    if (step.wait === "bid" && what === "play") done = true;
    if (!done) return;
    if (step.last) { T.stop(); return; }
    T.i++;
    show();
    // If the next step's condition is already met (we bid before reading it), skip ahead.
    const nx = HS.TUTORIAL[T.i];
    if (nx && nx.wait === "tricks3" && T.tricks >= 3) { T.i++; show(); }
  };
  HS.Tutorial = T;
})(globalThis.HS);
