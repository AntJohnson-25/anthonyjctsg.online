// Every word the game shows, in one place (easy to translate later). The
// how-to-play guide and the rules sheet are here too, so the in-game help and
// Notes/HOW-TO-PLAY.md say the same thing.
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const EN = {
    title: "SPADES", tag: "Partnership Spades at a villa by the sea. Walk the terrace and take the empty chair at any of four tables: the player across from you is your partner.",
    enter: "Enter the villa", startPlay: "Play",
    selStep: "Step 1 · your player", selTitle: "Choose your player",
    selSub: "Pick who you are at the villa. Whoever you pick, Ant takes their seat.",
    random: "🎲 Random",
    walkKeysDesk: "WASD or arrows to walk · Shift to walk faster · drag to look around · E to sit down at a table",
    walkKeysTouch: "Left thumb to walk · drag to look around · tap Sit down at a table",
    walkHint: "Walk up to a table's empty chair to play · WASD to walk · drag to look · P settings",
    walkHintTouch: "Walk up to a table's empty chair to play",
    tier_rookie: "Rookie table", tier_regular: "Regular table", tier_sharp: "Sharp table", tier_shark: "Shark table",
    tierSub_rookie: "Easy going. Good for learning.", tierSub_regular: "Solid players who bid honestly.", tierSub_sharp: "They count cards and play for the set.",
    tierSub_shark: "The best at the villa. Brave nils, no mercy.",
    crewLine: "Your partner {0} · against {1} and {2}", winsLine: "You've won here {0}×", noWins: "No wins here yet",
    sitDown: "Sit down (E)", sitDownTouch: "Sit down", sitLearn: "Sit down and learn", leaveTable: "Leave the table",
    play: "Play", playSolo: "Play", howTo: "How to play", rules: "Rules", settings: "Settings",
    bots: "Bots", easy: "Easy", normal: "Normal", sharp: "Sharp",
    timer: "Turn timer", off: "Off", on: "On", secs: "{0} s",
    gameTo: "Game to", chaos: "Chaos bots", chaosHelp: "Bots sometimes cut their own partner, just for the drama.",
    blindNil: "Blind nil", hostPicks: "You're the host: pick the options and press Play for everyone.", waitHost: "Waiting for the host to start the game…",
    seatsNote: "{0} at the table, {1} bots fill the other seats.", soloNote: "You and your partner against two bots, three bots in all.",
    keysDesk: "Drag to look around · your cards are along the bottom: hover one to lift it, click to play · 1 2 3 look at partner, left, right · Space back to the table · Z zoom in on the last card · R reactions · H rules · P settings",
    keysTouch: "Drag to look around · tap a card to lift it, tap again to play",
    boot1: "Opening the villa…", boot2: "Hanging the lights…", boot3: "Your friends are arriving…", ready: "Ready",
    // Status line.
    yourBid: "Your bid", yourTurn: "Your turn: play a card", yourLead: "Your lead", bidding: "{0} is bidding…", playing: "{0} is playing…",
    dealing: "{0} deals…", trickTo: "{0} takes the trick", handOver: "Hand over", watching: "Watching (the table is full)",
    // The chat feed (left side) and the status line.
    zoomAuto: "Zoom each card played", zoomCap: "{0} played", zoomNone: "No card played yet",
    ledTag: "Led", partnerTag: "Partner", chatBid: "bids {0}", chatTook: "takes the trick", chatTookYou: "take the trick", ledSuit: "{0} led",
    thinking: "thinking…", waiting: " ", took: "took {0}", timeLeft: "{0}s",
    // Bidding panel.
    bidTitle: "How many tricks will you take?", bidNil: "Nil", bidBlind: "Blind nil", bidLook: "Look at your cards",
    bidHint: "Suggested: {0}", bidPartner: "Partner bid {0}", bidBlindHelp: "You're 100+ behind: you may bid blind nil (+/-200) before looking.",
    teamBid: "Your team: {0}",
    // Scores.
    us: "US", them: "THEM", bags: "bags {0}", bid: "bid", took2: "took", hand: "Hand {0}", target: "to {0}",
    // Hand summary.
    sumTitle: "Hand {0}", sumBid: "Bid", sumTook: "Took", sumPoints: "Points", sumBags: "Bags", sumTotal: "Total",
    sumNilMade: "{0} made nil +{1}", sumNilFail: "{0} missed nil −{1}", sumSet: "Set: −{0}", sumMade: "Made it: +{0}", sumPenalty: "10 bags: −{0}",
    nextIn: "Next hand in {0}…", dealNow: "Deal now",
    // Game over.
    youWin: "You win!", youLose: "They win", teamWins: "{0} win", finalScore: "{0} – {1}", cutsLine: "Partner cuts: {0}", coversLine: "Nice covers: {0}",
    playAgain: "Play again", playAgainHost: "Play again (everyone)", endAll: "End game for everyone", backLobby: "Back to the lobby", backMenu: "Leave the table", waitNext: "Waiting for the host…",
    // Events (toasts and tags).
    tagCut: "Cut your partner", tagCutTop: "Cut your partner's top card", tagNil: "Nil broken by partner", tagCover: "Nice cover",
    // {1} in tCutTop / tNilCut / tCover and {0} in tNilBroken are possessives ("Tasha's", "your"): main.js poss().
    tCut: "{0} cut {1}", tCutTop: "{0} cut {1} top card", tNilCut: "{0} left {1} nil uncovered", tCover: "{0} covered {1} nil",
    tBroken: "Spades are broken", tNilBroken: "{0} nil is broken", yourPoss: "your", youObj: "you", youTakeTrick: "You take the trick",
    playCard: "Play {0}", tNilMade: "{0} made nil!", tBlindMade: "{0} made blind nil!", tSet: "{0} got set", tBoston: "{0} took all 13!",
    tBagPenalty: "{0}: 10 bags, −100", tTimeout: "Time's up: a card was played for {0}", tLeft: "{0} left: a bot keeps their seat", tJoined: "{0} sat down", tHostNow: "You're the host now",
    teamUs: "You & {0}", teamThem: "{0} & {1}", you: "You",
    // Reactions.
    r_wave: "Wave", r_cheer: "Cheer", r_shrug: "Shrug", r_thumbs: "Thumbs up", r_clap: "Clap", r_nod: "Nod", r_shake: "Head shake", r_laugh: "Laugh", r_facepalm: "Facepalm", r_point: "Point at partner",
    reactions: "Reactions",
    // Settings.
    music: "Music", sound: "Sound", graphics: "Graphics", high: "High", medium: "Medium", low: "Low", assist: "Glow legal cards", reactAuto: "Table reactions", tags: "Name tags",
    resume: "Back to the table", sens: "Look speed",
    close: "Close", next: "Next", skip: "Skip tutorial", done: "Done"
  };
  // The rules sheet (H). Short sections, the standard game.
  const RULES = [
    ["The game", "Four players, two teams: you and the player across the table are partners. Win as many tricks as your team bids. First team to 500 wins; a team at −200 loses."],
    ["Bidding", "After the deal everyone bids, starting left of the dealer, how many tricks they'll take (1–13). Your team's bid is you plus your partner. <b>Nil</b> (0) means you promise to take no tricks: +100 if you make it, −100 if you don't. <b>Blind nil</b>, bid before looking at your cards, is ±200 and only allowed when your team is 100 or more behind."],
    ["Playing", "The player left of the dealer leads. Everyone plays one card, clockwise. <b>Follow suit</b> if you can. If you can't, play anything, including a spade. The highest card of the suit led wins, unless someone played a spade: then the highest spade wins. The winner leads next."],
    ["Spades", "Spades are trumps. You can't <b>lead</b> a spade until one has been played on another suit (spades are “broken”), unless you have nothing but spades."],
    ["Scoring", "Make your bid: 10 points per trick bid, +1 for each extra trick (a <b>bag</b>). Miss it (you're <b>set</b>): −10 per trick bid. Every 10 bags costs 100 points. Tricks a nil bidder takes count as bags for the team."],
    ["Cutting your partner", "Trumping a trick your partner was already winning, or leaving your nil partner to take a trick you could have covered. The table notices: your partner reacts and a tag shows over your seat. Cover them well and you get a nod instead."],
    ["Controls", "Your cards are along the bottom of the screen. Hover one to lift it and click to play it (on a phone: tap or slide along them to lift one, then tap it again or press Play). Drag the table to look around. <b>1 2 3</b> look at your partner, left, right; <b>4</b> the trick; <b>Space</b> back to the table. <b>Z</b> (or 🔍, or tapping a card in the feed) zooms in on the last card played. <b>R</b> reactions, <b>Tab</b> scores, <b>H</b> rules, <b>P</b> settings, <b>L</b> leave the table. On a phone, Rules and Leave are in ⚙."],
    ["The villa", "Walk with <b>WASD</b> or the arrow keys (on a phone, your left thumb), drag to look around. Each table has its own crew and level: <b>Rookie</b>, <b>Regular</b>, <b>Sharp</b> and <b>Shark</b>. Walk up to the empty chair and press <b>E</b> to sit down. Your wins at each table are kept on this device."]
  ];
  // The tutorial: a guided hand against three bots. Each step waits for something to happen.
  const TUTORIAL = [
    { id: "look", text: "Welcome to the villa. You're sitting at the Rookie table: <b>drag</b> to look around. Your <b>partner</b> sits straight across from you; the other two are your opponents.", wait: "look" },
    { id: "keys", text: "Press <b>1</b>, <b>2</b> or <b>3</b> to glance at your partner, the player on your left, or on your right. <b>Space</b> brings you back to the table.", wait: "next" },
    { id: "hand", text: "Your 13 cards are along the bottom of the screen, sorted by suit. They stay there wherever you look. <b>Spades</b> beat every other suit, so count them.", wait: "next" },
    { id: "bid", text: "Time to <b>bid</b>: how many tricks do you think you'll win? Aces, kings and lots of spades win tricks. The suggestion is a good start.", wait: "bid" },
    { id: "follow", text: "Play goes clockwise. <b>Follow suit</b> if you can: the glowing cards are the ones you're allowed to play. Click one to play it.", wait: "play" },
    { id: "trick", text: "The highest card of the suit led takes the trick, unless someone trumps it with a spade. Keep playing: watch who wins each one.", wait: "tricks3" },
    { id: "cut", text: "<b>Cutting your partner</b>: if your partner is already winning a trick, don't trump it with a spade. Your partner will let you know. Sometimes you have no choice, and that's fine.", wait: "next" },
    { id: "react", text: "Press <b>R</b> (or the smile button) to react: wave, cheer, shrug, clap, and more. Everyone at the table sees it.", wait: "react" },
    { id: "score", text: "Make your team's bid and you score 10 a trick; miss it and you lose that much. Extra tricks are <b>bags</b>: ten of them cost 100. Play the hand out!", wait: "handEnd" },
    { id: "done", text: "That's Spades! First team to 500 wins. Press <b>H</b> any time for the rules. Good luck.", wait: "next", last: true }
  ];
  let lang = EN;
  HS.t = function (k) {
    let s = lang[k] !== undefined ? lang[k] : EN[k] !== undefined ? EN[k] : k;
    for (let i = 1; i < arguments.length; i++) s = s.split("{" + (i - 1) + "}").join(String(arguments[i]));
    return s;
  };
  HS.RULES = RULES;
  HS.TUTORIAL = TUTORIAL;
  HS.setLang = function () { lang = EN; };
  HS.fillStrings = function () {
    if (typeof document === "undefined") return;
    document.querySelectorAll("[data-t]").forEach(function (el) { el.textContent = HS.t(el.getAttribute("data-t")); });
  };
})(globalThis.HS);
