// Who's at the villa: the user's own characters from their other games (tools/pack-chars.py
// says where each one comes from). Heights in metres. Ant is the user.
// Picked from a line-up (?lineup=1) on 2026-10-14: every human character the games have.
// Left out: Ch14 (a cartoon mouse), Ch36 (a wooden mannequin), Ch24 (a ninja), Ch20 (a red
// racing suit and helmet), Ch44 (a featureless dark figure).
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  HS.CAST = {
    Ant: { name: "Ant", h: 1.8 },
    // Wealth Runner 2's runners.
    runner_m_dark: { name: "Marcus", h: 1.85 }, runner_f_dark: { name: "Imani", h: 1.72, f: 1 },
    runner_m_light: { name: "Cole", h: 1.84 }, runner_f_light: { name: "Brooke", h: 1.72, f: 1 },
    // X-Parkour, King of the Dill, Bladed, Last Light.
    Ch02: { name: "Sunny", h: 1.68, f: 1 }, Ch06: { name: "Kicks", h: 1.8 }, Ch08: { name: "Dre", h: 1.8 },
    Ch15: { name: "Vic", h: 1.84 }, Ch17: { name: "Tony", h: 1.78 }, Ch18: { name: "Noir", h: 1.78 },
    Ch28: { name: "Shade", h: 1.82 }, Ch31: { name: "Ash", h: 1.77 }, Ch41: { name: "Vanessa", h: 1.7, f: 1 },
    Ch46: { name: "Mika", h: 1.6, f: 1 }, Lola_B_Styperek: { name: "Lola", h: 1.68, f: 1 }, Remy: { name: "Remy", h: 1.8 }
  };
  HS.heightOf = function (id) { return (HS.CAST[id] && HS.CAST[id].h) || 1.75; };
  HS.idleOf = function (id) { return HS.CAST[id] && HS.CAST[id].f ? "idle_f" : "idle"; };
  // You: Ant unless you pick someone else on the character select. Whoever you pick
  // leaves their seat (or the fire pit, or the bar) and Ant takes it.
  HS.PLAYER = "Ant";
  HS.setPlayer = function (id) {
    if (!HS.CAST[id]) id = "Ant";
    const swap = function (x) { if (x.id === id) { x.id = HS.PLAYER; x.name = HS.CAST[HS.PLAYER].name; } };
    HS.CREWS.forEach(function (c) { c.forEach(swap); });
    HS.EXTRAS.forEach(swap);
    HS.PLAYER = id;
  };
  // Each table's crew: [left opponent, your partner (across), right opponent].
  // A Wealth Runner sits across from you at every table.
  HS.CREWS = [
    ["Remy", "runner_f_light", "Ch46"],          // Rookie: Brooke with Remy and Mika
    ["Ch02", "runner_m_light", "Ch08"],          // Regular: Cole with Sunny and Dre
    ["Ch18", "runner_f_dark", "Lola_B_Styperek"], // Sharp: Imani with Noir and Lola
    ["Ch28", "runner_m_dark", "Ch41"]            // Shark: Marcus with Shade and Vanessa
  ].map(function (c) { return c.map(function (id) { return { id: id, name: HS.CAST[id].name }; }); });
  // Everyone else on the terrace: at the fire pit (Room.LOUNGE spots) and the bar (Room.BAR).
  HS.EXTRAS = [
    { id: "Ch06", at: "lounge", i: 0 }, { id: "Ch31", at: "lounge", i: 3 },
    { id: "Ch17", at: "bar", i: 0, clip: "idle" }, { id: "Ch15", at: "bar", i: 1, clip: "idle" }
  ];
})(globalThis.HS);
