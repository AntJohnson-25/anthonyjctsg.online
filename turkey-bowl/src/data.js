// Turkey Bowl 3D — tunable constants and static tables. No logic lives here.
//
// Forked from the 2D game's gameData.js (E:\ICM Workspace\01-Projects\Turkey-bowl).
// The gameplay numbers below are the 2D game's, which were tuned over many
// measured CPU-vs-CPU iterations; its comments explain why each one is what it
// is. Sprite manifests and the 2D camera are gone. What is new is CHARACTERS:
// the 3D look of each of the fourteen people, read off the 2D art.
(function () {
  const FIELD_W = 160 / 3;

  const TBData = {
    FIELD_W,
    FIELD_MID: FIELD_W / 2,
    END_ZONE: 10,

    // Was 120. The clock now runs between plays (CLOCK_RUNOFF_MAX), which
    // halved the snaps in a game (149 -> 72 CPU vs CPU, tools/check.js 30).
    QUARTER_SECONDS: 180,
    QUARTERS: 4,
    TOUCHBACK_SPOT: 20,

    TAU_ACCEL: 0.15,
    MAX_DT: 0.05,

    JUKE_SPEED: 10.2,
    JUKE_DURATION: 0.22,
    JUKE_COOLDOWN: 1.15,
    JUKE_BURST: 3.3,
    SPIN_SPEED: 9.5,
    SPIN_DURATION: 0.36,
    SPIN_COOLDOWN: 2.2,
    SPIN_BURST: 4.8,

    // The hurdle (Space / HURDLE), and the front corkscrew flip on a double
    // tap. Airborne, a lone tackler has a much worse shot at the runner; the
    // flip is the bigger escape but costs speed and a stumble on landing.
    HURDLE: {
      DURATION: 0.8, AIR_FROM: 0.12, AIR_TO: 0.62, SPEED: 0.92, BREAK: 0.4, COOLDOWN: 1.3,
      DOUBLE_TAP: 0.35,
      FLIP_DURATION: 1.05, FLIP_AIR_TO: 0.85, FLIP_SPEED: 0.78, FLIP_BREAK: 0.55, FLIP_STUMBLE: 0.45
    },

    // The game clock keeps running between plays after a run or a completed
    // catch that ends in bounds, as in the real game. At most this many seconds
    // run off per down, so a 2-minute quarter still has plays in it.
    CLOCK_RUNOFF_MAX: 8,

    PASS_SPEED: 20.0,
    PASS_ARC_H: 2.2,
    PASS_SHOULDER_LEAD: 1.35,

    // Graded coverage: inside this radius a defender breaks a pass up with a
    // chance that scales with how close they are. See the 2D game's notes —
    // a binary radius either never fired or killed every covered pass.
    CONTEST_RADIUS: 5.0,
    CATCH_RADIUS: 2.2,

    // How the human throws (2026-10-24, Madden-style): TAP a target for a
    // TOUCH pass (high, soft, over the underneath man, easier to run under),
    // HOLD it for a BULLET (fast and flat: less time for coverage to close,
    // but a defender near the throwing lane can tip or pick it). The CPU QB
    // keeps throwing "normal" passes, so its measured balance is unchanged.
    //   speed yd/s · arc: view height per yard (minArc floor) · catchR yd
    PASS_KIND: {
      normal: { speed: 20.0, arc: 0.13, minArc: 1.6, catchR: 2.2 },
      // contestMul: a touch pass is dropped in over the man, so a defender at
      // the catch point breaks it up less often. Measured by tools/test-rules.js
      // (WR2 out on FLOOD, 120 throws each); first cut had touch at 23%.
      touch:  { speed: 17.0, arc: 0.22, minArc: 2.8, catchR: 3.0, intMul: 0.7, contestMul: 0.72 },
      bullet: { speed: 27.0, arc: 0.045, minArc: 0.55, catchR: 2.3, intMul: 1.0, tip: 0.22, tipInt: 0.3, tipR: 1.2 }
    },
    THROW_HOLD: 0.22,   // seconds a target has to be held for a bullet

    // Catching (2026-10-24). A ball just out of reach can be dived for; while
    // the ball is in the air the human can steer the receiver, and the
    // HIGH-POINT button (Shift/E, or the touch button) goes up for it:
    // longer reach and a better chance against a defender, no run after.
    // On defense, the DIVE button near the landing spot plays the ball.
    CATCH: {
      DIVE_RADIUS: 3.5, DIVE_CHANCE: 0.62,
      HIGH_POINT_REACH: 0.45, HIGH_POINT_CONTEST: 0.55,
      PLAY_BALL_RADIUS: 6, PLAY_BALL_CONTEST: 1.35, PLAY_BALL_INT: 1.6,
      BIG_CATCH_AIR: 18
    },
    CPU_SNAP_DELAY: 1.3,
    // Was 0.25. Once coverage could reach the wheel and the flat (2026-10-03),
    // 0.25 made 9.7% of all plays interceptions; 0.18 is 6.0%, the old rate.
    INT_CHANCE: 0.18,

    REACT_MIN: 0.15,
    REACT_MAX: 0.45,
    LEAD_CAP: 1.2,

    // Backyard rule: rushers count before they can cross the line.
    RUSH_COUNT: 2.0,
    QB_POCKET: {
      DEPTH: 6.5,
      HOLD_PAST_COUNT: 0.9,
      PANIC_RADIUS: 1.8,
      SLIDE_RADIUS: 4.0,
      DEF_BREAK_DELAY: 0.25,
      THROW_OPEN: 0.62,
      DESPERATE_OPEN: 0.45,
      // Until this many seconds after the snap the CPU QB only looks at his
      // first read (a random downfield route, sim.js pickRead).
      READ_FIRST: 1.4
    },
    COVER_TRAIL: 1.6,
    // Man coverage never trails closer to the line of scrimmage than this.
    COVER_FLOOR: 3,
    // Yards the linebacker lines up toward the tight end's side. Head-up on
    // the ball he was 17 yards from the TE's flat route, which was then
    // completed every time it was thrown.
    LB_SHADE: 3.5,
    CONTAIN_OUTSIDE: 2.5,
    CONTAIN_CUSHION: 5.0,
    CONTAIN_CLOSE: 4.0,

    BLOCK_ENGAGE_DIST: 0.8,
    BLOCK_HOLD_MIN: 1.2,
    BLOCK_HOLD_VAR: 1.3,
    BLOCK_SPEED_CAP: 0.30,
    BLOCK_COMMIT: 0.3,

    // Every defender must be faster than every ball carrier, or a runner who
    // breaks clean can never be caught.
    SPEED: { qb: 7.6, rb: 8.4, wr: 8.5, te: 8.0, ol: 6.5, def: 8.6 },
    DEF_SPEED_MIN: 8.7,
    DEF_SPEED_MAX: 9.2,

    // Longer than the 2D game's dead-ball and touchdown beats: in 3D the
    // tackle is a real fall and the celebration is worth watching. The clock
    // only runs during LIVE, so none of this changes game length.
    PHASE_TIME: {
      HUDDLE: 1.8,
      HUDDLE_BREAK: 0.9,
      DEAD_BALL: 1.6,
      BETWEEN_DOWNS: 1.2,
      TOUCHDOWN: 4.2,
      XP_DELAY: 1.0,
      TURNOVER: 2.2,
      QUARTER_BREAK: 3.0,
      HALFTIME: 6.0
    },

    // Offsets in yards from the ball spot. +dy is downfield for the offense.
    //
    // One change from 2D: the lineman is now a real CENTER, over the ball,
    // because in 3D the ball is visibly snapped from the ground to the
    // quarterback, and a snap with nobody over it read as the ball jumping by
    // itself. His partner plays left guard. Both sit just behind the line
    // instead of a yard past it, so the two lines face each other across a
    // gap instead of standing inside one another.
    FORMATION: {
      offense: [
        { role: "qb", slot: "QB", char: "utility_1", dx: 0, dy: -4 },
        { role: "rb", slot: "RB", char: "utility_2", dx: -2.5, dy: -5 },
        { role: "wr", slot: "WR1", char: "utility_3", dx: -13, dy: 0 },
        { role: "wr", slot: "WR2", char: "utility_4", dx: 14, dy: 0 },
        { role: "te", slot: "TE", char: "tight_end", dx: 6, dy: 0 },
        { role: "ol", slot: "OL", char: "lineman", dx: 0, dy: -0.35 },
        { role: "ol", slot: "OL2", char: "lineman_2", dx: -2.4, dy: -0.35 }
      ]
    },

    // Waypoints in yards relative to the receiver's snap position, authored
    // for a receiver on the LEFT; sim.js mirrors dx for the right side.
    ROUTES: {
      go:    [{ dx: 0, dy: 9 }, { dx: 0, dy: 21 }],
      slant: [{ dx: 0, dy: 3 }, { dx: 7, dy: 8 }, { dx: 14, dy: 13 }],
      out:   [{ dx: 0, dy: 6 }, { dx: -8, dy: 8 }, { dx: -13, dy: 9 }],
      post:  [{ dx: 0, dy: 10 }, { dx: 6, dy: 18 }, { dx: 11, dy: 24 }],
      wheel: [{ dx: -5, dy: 1 }, { dx: -8, dy: 6 }, { dx: -8, dy: 19 }],
      flat:  [{ dx: -6, dy: 1 }, { dx: -11, dy: 3 }],
      cross: [{ dx: 0, dy: 5 }, { dx: 13, dy: 10 }, { dx: 24, dy: 13 }],
      seam:   [{ dx: 0, dy: 6 }, { dx: -1, dy: 13 }, { dx: -1, dy: 20 }],
      corner: [{ dx: 0, dy: 7 }, { dx: -5, dy: 12 }, { dx: -9, dy: 15 }],
      screen: [{ dx: 1.5, dy: -2 }, { dx: 3, dy: -3, stop: true }]
    },

    // Nine calls. Alignment is identical for all of them — only assignments
    // change — so the defense cannot read the call off the formation.
    PLAYBOOK: [
      {
        id: "dive", name: "DIVE", tag: "RUN",
        hint: "Straight up the gut. Safe yards, nowhere to hide.",
        handoff: "RB", runBias: 0,
        wr: { WR1: "block", WR2: "block" }, te: "block"
      },
      {
        id: "sweep", name: "SWEEP", tag: "RUN",
        hint: "Get outside left. Slow to develop, big if it turns the corner.",
        handoff: "RB", runBias: -1,
        wr: { WR1: "block", WR2: "block" }, te: "block"
      },
      {
        id: "slants", name: "SLANTS", tag: "PASS",
        hint: "Both receivers break in quick. Throw it early.",
        wr: { WR1: "slant", WR2: "slant" }, te: "flat", rb: "block"
      },
      {
        id: "flood", name: "FLOOD", tag: "PASS",
        hint: "Deep, intermediate and a checkdown. Something is always open.",
        wr: { WR1: "go", WR2: "out" }, te: "cross", rb: "flat"
      },
      {
        id: "postwheel", name: "POST + WHEEL", tag: "PASS",
        hint: "Both receivers run deep. Needs time you may not get.",
        wr: { WR1: "post", WR2: "wheel" }, te: "out", rb: "block"
      },
      {
        id: "flea", name: "FLEA-FLICKER", tag: "TRICK",
        hint: "Pitch out, pitch back, then throw it deep.",
        handoff: "RB", pitchBackAfter: 0.75, runBias: 0,
        wr: { WR1: "go", WR2: "cross" }, te: "flat"
      },
      {
        id: "teseam", name: "TE SEAM", tag: "PASS",
        hint: "Receivers clear out deep; the tight end splits the safeties.",
        wr: { WR1: "go", WR2: "go" }, te: "seam", rb: "flat"
      },
      {
        id: "ycorner", name: "Y-CORNER", tag: "PASS",
        hint: "WR2 slants under, the tight end breaks for the corner behind him.",
        wr: { WR1: "post", WR2: "slant" }, te: "corner", rb: "block"
      },
      {
        id: "tescreen", name: "TE SCREEN", tag: "TRICK",
        hint: "Tight end slips out behind the line. Let the rush come, then dump it off.",
        wr: { WR1: "block", WR2: "block" }, te: "screen", rb: "block", quick: "TE"
      },
      // 2026-10-24 additions. Indices 0-8 above are fixed (tests pin them).
      {
        id: "mesh", name: "MESH", tag: "PASS",
        hint: "Both receivers cross underneath and rub their men off. Hit one on the break.",
        wr: { WR1: "cross", WR2: "cross" }, te: "out", rb: "flat"
      },
      {
        id: "draw", name: "HB DRAW", tag: "RUN",
        hint: "Sell the pass, then slip it to the back once the rush is upfield.",
        handoff: "RB", handoffAfter: 0.8, runBias: 0,
        wr: { WR1: "go", WR2: "go" }, te: "block"
      },
      {
        id: "sneak", name: "QB SNEAK", tag: "RUN",
        hint: "Everybody blocks and the quarterback keeps it. Inches to go.",
        qbRun: true,
        wr: { WR1: "block", WR2: "block" }, te: "block", rb: "block"
      },
      {
        id: "hailmary", name: "HAIL MARY", tag: "TRICK",
        hint: "Everybody deep. Throw it up and pray.",
        wr: { WR1: "go", WR2: "go" }, te: "seam", rb: "wheel"
      }
    ],

    // Seconds to make a call in the huddle (the Madden-style call screen). When
    // it runs out, the top SUGGESTED call is made for you.
    PLAY_CALL_SECONDS: 25,

    // The defensive playbook. The first three are the 2D game's looks and the
    // only ones the CPU calls (pickDefense), so CPU-vs-CPU balance is unchanged;
    // the last three are for the human. The trade between them is TIME (the
    // rush count) and depth, never personnel — see the 2D game's notes on what
    // spending a body on the blitz did. `tag` is the call-screen category.
    DEFENSES: [
      {
        id: "base", name: "BASE 2-3", tag: "BASE",
        hint: "Two rushers on the count, man corners, a linebacker and two safeties. Sound against anything.",
        units: [
          { ai: "PURSUE", char: "lineman", dx: -2.5, dy: 1.5 },
          { ai: "PURSUE", char: "lineman_2", dx: 2.5, dy: 1.5 },
          { ai: "COVER", char: "utility_3", dx: -11, dy: 7, covers: "WR1" },
          { ai: "COVER", char: "utility_4", dx: 11, dy: 7, covers: "WR2" },
          { ai: "LB", char: "tight_end", dx: 0, dy: 7.5 },
          { ai: "CONTAIN", char: "utility_2", dx: -8, dy: 17 },
          { ai: "CONTAIN", char: "utility_1", dx: 8, dy: 17 }
        ]
      },
      {
        id: "blitz", name: "BLITZ", tag: "BLITZ",
        hint: "The rush comes early and everyone creeps up. Get home before he finds someone.",
        rushCount: 0.8,
        units: [
          { ai: "PURSUE", char: "lineman", dx: -3, dy: 1.5 },
          { ai: "PURSUE", char: "lineman_2", dx: 3, dy: 1.5 },
          { ai: "COVER", char: "utility_3", dx: -11, dy: 6, covers: "WR1" },
          { ai: "COVER", char: "utility_4", dx: 11, dy: 6, covers: "WR2" },
          { ai: "LB", char: "tight_end", dx: 0, dy: 5.5 },
          { ai: "CONTAIN", char: "utility_2", dx: -7, dy: 13 },
          { ai: "CONTAIN", char: "utility_1", dx: 7, dy: 13 }
        ]
      },
      {
        id: "deep", name: "COVER 3", tag: "COVERAGE",
        hint: "One rusher on a long count, three deep. Nothing gets behind you; the run is open.",
        rushCount: 2.8,
        units: [
          { ai: "PURSUE", char: "lineman", dx: 0, dy: 1.5 },
          { ai: "COVER", char: "utility_3", dx: -11, dy: 8, covers: "WR1" },
          { ai: "COVER", char: "utility_4", dx: 11, dy: 8, covers: "WR2" },
          { ai: "LB", char: "tight_end", dx: 0, dy: 10 },
          { ai: "CONTAIN", char: "lineman_2", dx: -9, dy: 18 },
          { ai: "CONTAIN", char: "utility_2", dx: 0, dy: 20 },
          { ai: "CONTAIN", char: "utility_1", dx: 9, dy: 18 }
        ]
      },
      {
        id: "press", name: "PRESS MAN", tag: "BASE",
        hint: "Corners in the receivers' faces at the line. Jams quick throws; a step lost is a big play.",
        units: [
          { ai: "PURSUE", char: "lineman", dx: -2.5, dy: 1.5 },
          { ai: "PURSUE", char: "lineman_2", dx: 2.5, dy: 1.5 },
          { ai: "COVER", char: "utility_3", dx: -13, dy: 2.2, covers: "WR1" },
          { ai: "COVER", char: "utility_4", dx: 14, dy: 2.2, covers: "WR2" },
          { ai: "LB", char: "tight_end", dx: 0, dy: 6 },
          { ai: "CONTAIN", char: "utility_2", dx: -9, dy: 15 },
          { ai: "CONTAIN", char: "utility_1", dx: 9, dy: 15 }
        ]
      },
      {
        id: "zero", name: "ZERO BLITZ", tag: "BLITZ",
        hint: "The rush goes almost at the snap and the safeties come down. All or nothing.",
        rushCount: 0.4,
        units: [
          { ai: "PURSUE", char: "lineman", dx: -2.5, dy: 1.3 },
          { ai: "PURSUE", char: "lineman_2", dx: 2.5, dy: 1.3 },
          { ai: "COVER", char: "utility_3", dx: -12, dy: 4, covers: "WR1" },
          { ai: "COVER", char: "utility_4", dx: 12, dy: 4, covers: "WR2" },
          { ai: "LB", char: "tight_end", dx: 0, dy: 4 },
          { ai: "CONTAIN", char: "utility_2", dx: -6, dy: 11 },
          { ai: "CONTAIN", char: "utility_1", dx: 6, dy: 11 }
        ]
      },
      {
        id: "prevent", name: "PREVENT", tag: "COVERAGE",
        hint: "One slow rusher, everyone else deep. Give up the short stuff, never the touchdown.",
        rushCount: 3.6,
        units: [
          { ai: "PURSUE", char: "lineman", dx: 0, dy: 1.5 },
          { ai: "COVER", char: "utility_3", dx: -12, dy: 11, covers: "WR1" },
          { ai: "COVER", char: "utility_4", dx: 12, dy: 11, covers: "WR2" },
          { ai: "LB", char: "tight_end", dx: 0, dy: 13 },
          { ai: "CONTAIN", char: "lineman_2", dx: -11, dy: 22 },
          { ai: "CONTAIN", char: "utility_2", dx: 0, dy: 25 },
          { ai: "CONTAIN", char: "utility_1", dx: 11, dy: 22 }
        ]
      }
    ],

    TACKLE: {
      RADIUS: 0.9,
      BREAK_BASE: 0.22,
      BREAK_JUKE: 0.18,
      BREAK_FROM_BEHIND: 0.12,
      GANG_RADIUS: 1.5,
      STUMBLE_TIME: 0.35,
      STUMBLE_SPEED: 0.45,
      TACKLER_DOWN_TIME: 1.1,
      COOLDOWN: 0.8,
      FUMBLE_CHANCE: 0.04,
      FUMBLE_STUN: 0.56,
      FUMBLE_RECOVERY_DELAY: 0.20,
      FUMBLE_RECOVERY_RADIUS: 1.05,
      FUMBLE_TIMEOUT: 3.2
    },

    // Held poses: locomotion must not overwrite these mid-animation.
    ACTION_HOLD: {
      catch: 0.38,
      intercept: 0.48,
      celebrate: 4.0,
      block: 0.5,
      handoff: 0.3,
      throw: 0.52,
      stumble: 0.35,
      tackle: 1.0,
      tackled: 1.0
    },

    TEAMS: [
      {
        id: "wildcats",
        name: "Wildcats",
        short: "WLD",
        primary: "#7c2733",
        accent: "#e8d9b5",
        pants: "#8a8e95",
        stripe: "#e9e6de",
        numbers: { QB: 7, RB: 22, WR1: 84, WR2: 11, TE: 88, OL: 66, OL2: 64 },
        mascot: "assets/mascot-paw.png"
      },
      {
        id: "turkeys",
        name: "Turkeys",
        short: "TRK",
        primary: "#dc7422",
        accent: "#5b3417",
        pants: "#4d3526",
        stripe: "#d9782c",
        numbers: { QB: 9, RB: 28, WR1: 80, WR2: 15, TE: 87, OL: 71, OL2: 75 },
        mascot: "assets/mascot-turkey.png"
      }
    ],

    // Which offensive slot each person plays. Everyone keeps his own number
    // on both sides of the ball — it is his sweatshirt, not a position.
    CHAR_SLOT: {
      utility_1: "QB", utility_2: "RB", utility_3: "WR1", utility_4: "WR2",
      tight_end: "TE", lineman: "OL", lineman_2: "OL2"
    },

    // The fourteen people, read off the 2D art (Source/reference/). Builds are
    // relative: height 1 is a six-footer, width 1 an average frame.
    //   hair   buzz | short | swept | short_curly | big_curly | afro | flattop
    //          messy | receding | shaggy | bald
    //   beard  full | short | stubble | none
    CHARACTERS: {
      turkeys: {
        lineman:   { label: "Big Walt", skin: "#e7b391", hair: "swept", hairColor: "#a19d97", brows: "#8a8580", eyes: "#4f3a28", height: 1.0, width: 1.26, belly: 0.55, face: "broad", age: 1 },
        lineman_2: { label: "Pops", skin: "#6e4630", hair: "bald", hairColor: "#c9c3bb", beard: "short", beardColor: "#c9c3bb", brows: "#3a2a22", eyes: "#2c1d14", height: 0.99, width: 1.3, belly: 0.7, face: "broad", age: 1 },
        tight_end: { label: "Dre", skin: "#5a3827", hair: "short_curly", hairColor: "#17110e", brows: "#17110e", eyes: "#26170f", height: 1.05, width: 1.1, belly: 0, face: "oval" },
        utility_1: { label: "Curls", skin: "#b27b55", hair: "big_curly", hairColor: "#21160f", beard: "full", beardColor: "#21160f", brows: "#21160f", eyes: "#3a2616", height: 1.0, width: 1.02, belly: 0, face: "oval" },
        utility_2: { label: "Smoke", skin: "#7b4f35", hair: "buzz", hairColor: "#18120e", brows: "#18120e", eyes: "#2a1a10", height: 0.98, width: 1.0, belly: 0, face: "long" },
        utility_3: { label: "Sami", skin: "#b88562", hair: "short", hairColor: "#1c1612", beard: "full", beardColor: "#1c1612", beardShort: true, brows: "#1c1612", eyes: "#2e1e12", height: 1.0, width: 0.97, belly: 0, face: "oval" },
        utility_4: { label: "Stretch", skin: "#efc8a6", hair: "receding", hairColor: "#6a5645", brows: "#6a5645", eyes: "#4a5a66", height: 1.02, width: 0.88, belly: 0, face: "long", ears: 1.4 }
      },
      wildcats: {
        lineman:   { label: "Moose", skin: "#efc3a0", hair: "short", hairColor: "#c6a063", brows: "#b08c55", eyes: "#4a6272", height: 1.0, width: 1.34, belly: 0.9, face: "round" },
        lineman_2: { label: "Grizz", skin: "#dfab86", hair: "messy", hairColor: "#2b1c13", beard: "full", beardColor: "#2b1c13", brows: "#2b1c13", eyes: "#3a2a1c", height: 1.0, width: 1.3, belly: 0.35, face: "broad", scowl: true },
        tight_end: { label: "Tank", skin: "#3e271b", hair: "flattop", hairColor: "#0e0a08", brows: "#0e0a08", eyes: "#1e130c", height: 1.05, width: 1.02, belly: 0, face: "oval" },
        utility_1: { label: "Slim", skin: "#8a5a3c", hair: "buzz", hairColor: "#130e0b", brows: "#130e0b", eyes: "#24160d", height: 1.04, width: 0.94, belly: 0, face: "long" },
        utility_2: { label: "Beau", skin: "#e0ad89", hair: "swept", hairColor: "#5b3b24", beard: "full", beardColor: "#5b3b24", brows: "#4c311e", eyes: "#3e5a3a", height: 1.0, width: 1.06, belly: 0, face: "broad" },
        utility_3: { label: "Fro", skin: "#3a2419", hair: "afro", hairColor: "#0d0907", brows: "#0d0907", eyes: "#1c120b", height: 1.01, width: 0.98, belly: 0, face: "oval" },
        utility_4: { label: "Sunny", skin: "#f3cfb0", hair: "shaggy", hairColor: "#dcb86c", brows: "#b8944e", eyes: "#4f7fa6", height: 0.94, width: 0.86, belly: 0, face: "young" }
      }
    },

    // The yard around the field: a big back lawn on a late autumn afternoon.
    YARD: {
      SIDE_MARGIN: 15,        // grass between each touchline and the fence
      END_MARGIN: 9,          // grass between each end line and the fence
      FENCE_H: 2.0,
      // Toward the sun: low, from the left and a little behind the camera, so
      // faces turned to the camera are lit. The sunset GLOW in the sky is a
      // separate direction, out on the far horizon where the camera looks.
      SUN: { x: -0.72, y: 0.42, z: 0.38 },
      GLOW: { x: -0.5, y: 0.08, z: -0.86 }
    }
  };

  const G = typeof window !== "undefined" ? window : globalThis;
  G.TBData = TBData;
  if (typeof module !== "undefined") module.exports = TBData;
})();
