// Who works in and visits the shop: the user's own 3D characters from their other games
// (Work/chars/<id>.js, copied from Spades). Heights in metres; f: 1 = moves with the female clips.
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

  // The two barbers (the select screen's "male" / "female"). STAND-INS: the closest cast members
  // to the barbers' 2D art, until the user's own 3D models of them arrive
  // (Source/barber-3d-prompts.md). Swap the ids here when they do.
  HS.BARBERS = { male: "runner_m_dark", female: "runner_f_dark" };

  // The clients, keyed as in the 2D game (saved regulars are stored by these keys), with the body
  // that now plays each one. Ant (the user) drops in too.
  HS.CLIENTS = {
    brownman:  { name: "Marcus", body: "Ch28" },
    whiteman2: { name: "Ethan",  body: "Ch31" },
    whiteman:  { name: "Danny",  body: "runner_m_light" },
    brownman2: { name: "Jamal",  body: "Ch06" },
    latinoman: { name: "Rico",   body: "Ch08" },
    whiteman3: { name: "Cole",   body: "Ch17" },
    brownman3: { name: "Andre",  body: "Remy" },
    ant:       { name: "Ant",    body: "Ant" }
  };
  // Hats off in the chair (user, 2026-10-16), back on once they're up again (Body.hatless):
  // Jamal's cap is its own material (group 2). His headphones and Cole's hard hat are separate
  // mesh islands inside the body material, found and dropped by Body.hatless. Jamal's model has
  // no top of the head under the cap, so he also gets a cut line and a fitted short-cut hair cap.
  HS.HATS = {
    // (no cut lines any more: only the headwear pieces come out, and a soft two-layer cap, skin
    // then a short fade, covers the top; see Body.hatOff)
    // wig: a real modelled haircut borrowed from that cast member's hair (Body.wig): Marcus's short
    // black top for Jamal, Ethan's short dark-brown cut for Cole. Jamal also gets a soft skin layer
    // underneath (his model has no top of the head); Cole's real scalp is there already.
    Ch06: { groups: [2], wig: "Ch28", wigScalp: 0.45, scalpTint: "#7c6c6a" },
    Ch17: { tilt: 0.3, skin: false, strap: [0.3, 0.75], wig: "Ch31", wigLift: -0.05, wigScale: 1.12 }
  };
  // Round-robin arrival order (spread out so lookalikes don't come in back to back).
  HS.CLIENT_ORDER = ["brownman", "whiteman2", "ant", "whiteman", "brownman2", "latinoman", "whiteman3", "brownman3"];

  // People on the waiting benches when every chair is full, and at the vending machine.
  HS.EXTRAS = ["runner_f_light", "Ch02", "Ch41", "Lola_B_Styperek", "Ch18"];
})(globalThis.HS);
