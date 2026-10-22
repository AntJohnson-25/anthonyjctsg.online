// Who's in the game: the user's own 3D characters from their other games (Work/chars/<id>.js,
// copied from Billionaire Barber 2 / Spades). Heights in metres; f: 1 = moves with the female clips.
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  HS.CAST = {
    Ant: { h: 1.8 },
    runner_m_dark: { h: 1.85 }, runner_f_dark: { h: 1.72, f: 1 },
    runner_m_light: { h: 1.84 }, runner_f_light: { h: 1.72, f: 1 },
    Ch02: { h: 1.68, f: 1 }, Ch06: { h: 1.8 }, Ch08: { h: 1.8 }, Ch17: { h: 1.78 }, Ch18: { h: 1.78 },
    Ch28: { h: 1.82 }, Ch31: { h: 1.77 }, Ch41: { h: 1.7, f: 1 }, Lola_B_Styperek: { h: 1.68, f: 1 }, Remy: { h: 1.8 }
  };
  HS.heightOf = function (id) { return (HS.CAST[id] && HS.CAST[id].h) || 1.75; };
  HS.idleOf = function (id) { return HS.CAST[id] && HS.CAST[id].f ? "idle_f" : "idle"; };
  HS.walkOf = function (id) { return HS.CAST[id] && HS.CAST[id].f ? "walk_f" : "walk"; };

  // Park units per metre: the park, the trucks and the old stand-in people were built at this
  // scale (a person was ~2.3 units tall), so a 1.8 m body is made 1.8 * U units tall.
  HS.U = 1.3;

  // You: the owner at the cart and in the truck. You pick one of Wealth Runner 2's four runners on
  // New game (user, 2026-10-22); the pick is remembered on this device (not in the game save).
  HS.RUNNERS = [
    // named, not labelled by gender and race (user, 2026-10-22)
    { id: "runner_m_dark", label: "Darius" }, { id: "runner_m_light", label: "Tyler" },
    { id: "runner_f_dark", label: "Jade" }, { id: "runner_f_light", label: "Brooke" }
  ];
  HS.PLAYER = "runner_m_dark";
  try { const p = localStorage.getItem("ftb_player"); if (p && HS.RUNNERS.some(function (r) { return r.id === p; })) HS.PLAYER = p; } catch (e) { /* private mode */ }
  HS.setPlayer = function (id) {
    HS.PLAYER = id;
    try { localStorage.setItem("ftb_player", id); } catch (e) { /* private mode */ }
  };
  // Your employees in the truck, in hiring order (the game starts you with two).
  HS.STAFF = ["Ch18", "Ch41", "Ch06"];
  // The public. Each customer keeps one of these for as long as they're in the park. The runners you
  // didn't pick walk around too (never your own); Ant (the user) drops by.
  HS.CROWD = ["Ch28", "Ch02", "Ch31", "Ch08", "Remy", "Lola_B_Styperek", "Ch17", "Ant",
              "runner_m_dark", "runner_m_light", "runner_f_dark", "runner_f_light"];
  // Phones download fewer characters (each is ~1 MB).
  HS.CROWD_PHONE = ["Ch28", "Ch02", "Ch31", "Remy", "runner_f_light", "runner_m_light"];
  HS.crowdIds = function (mobile) { return (mobile ? HS.CROWD_PHONE : HS.CROWD).filter(function (id) { return id !== HS.PLAYER; }); };
})(globalThis.HS);
