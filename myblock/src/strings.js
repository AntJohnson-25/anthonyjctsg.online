// Every word the player sees, in one table. SP.t(key, ...args) fills {0}, {1}.
globalThis.SP = globalThis.SP || {};
(function (SP) {
  "use strict";
  const STR = {
    tag: "Your block. Their city. Take it back one corner at a time: hold the streets, clear the buildings, and don't stop until every district flies your colours.",
    mode: "MODE", bots: "ENEMY", seats: "FIGHTERS",
    tdm: "STREET WAR", turf: "TURF",
    tdmSub: "first crew to 40 kills", turfSub: "pack the duffles · get them home · first to 10",
    recruit: "ROOKIES", regular: "SOLDIERS", hardened: "HARDENED", veteran: "VETERANS",
    play: "HIT THE STREETS", landingPlay: "PLAY",
    keys1: "WASD move · mouse look · Space jump · Shift sprint · left click fire · hold right click aim",
    keys2: "R reload · hold F weapon wheel (or 1-6 / mouse wheel) · G grenade · V punch · kick · C crouch · Q dive roll · B shoulder throw · E climb / vault / search a body",
    notCarried: "NOT CARRIED",
    climbHint: "E · CLIMB TO THE ROOF", vaultHint: "E · VAULT", letGo: "SPACE · LET GO", lootHint: "E · SEARCH BODY",
    looted: "SEARCHED", lootAmmo: "{0} ROUNDS", lootNades: "{0} FRAG", lootGun: "NEW GUN", lootHp: "{0} HEALTH", lootArmor: "{0} ARMOUR", lootNone: "NOTHING USEFUL",
    keys3: "Tab scores · P settings · M sound",
    touchKeys: "Left thumb: move (push to the edge to sprint) · right thumb: drag to look · FIRE also aims while you drag it",
    you: "YOU", youName: "Alex",
    fight: "GO", firstTo: "FIRST TO {0}",
    killedBy: "KILLED BY", respawnIn: "Back in {0}", selfOut: "YOURSELF", fell: "THE DROP",
    noAmmo: "OUT OF AMMO",
    capturing: "LOADING THE DUFFLES…", contested: "CONTESTED", holding: "PACKED · GRAB A BAG", carryHint: "CARRYING A DUFFLE · GET IT TO YOUR BLOCK",
    weTook: "WE TOOK {0}", theyTook: "{0} TOOK {1}",
    wePacked: "DUFFLES PACKED AT {0}", theyPacked: "{0} PACKED THE DUFFLES AT {1}", weDelivered: "DUFFLE HOME · {0}", theyDelivered: "{0} GOT A DUFFLE HOME · {1}", youDropped: "DUFFLE DROPPED · PICK IT UP", dropped: "A DUFFLE WAS DROPPED", bagBack: "A DUFFLE WENT BACK TO ITS TABLE", youTook: "YOU HAVE A DUFFLE · GET IT HOME", theyTookBag: "{0} HAS A DUFFLE", restocked: "{0} RESTOCKED", bags: "{0} BAG", bags2: "{0} BAGS",
    pickedUp: "+ {0}", ammo: "AMMO", armor: "ARMOUR", health: "HEALTH", nades: "GRENADES",
    victory: "THE BLOCK IS OURS", defeat: "PUSHED BACK", draw: "STANDOFF",
    again: "RUN IT BACK", menu: "MENU",
    settings: "SETTINGS", resume: "BACK IN", quit: "QUIT TO MENU", sens: "Look sensitivity", turn: "Arrow turn speed", invert: "Invert look",
    outlines: "Enemy outlines", killcamSetting: "Kill cam", killcam: "KILL CAM", killcamSkip: "Click, Space or FIRE to skip", hpLeft: "{0} HP LEFT", graphics: "Graphics", music: "Music", sfx: "Effects", sound: "Sound", on: "ON", off: "OFF",
    qhigh: "HIGH", qmedium: "MEDIUM", qlow: "LOW",
    player: "FIGHTER", score: "SCORE", kills: "K", deaths: "D",
    clickLook: "Click to look around",
    headshot: "HEADSHOT", down: "DOWN", putDown: "PUT DOWN", theDead: "THE DEAD",
    dead: "THE DEAD", deadOn: "RISING", deadOff: "RESTING", deadOnSub: "the cemetery wakes up", deadOffSub: "no zombies",
    reloading: "RELOADING…", aiming: "AIMING", aimClick: "HOLD RIGHT CLICK · AIM", aimTouch: "AIM",
    w0: "PISTOL", w1: "RIFLE", w2: "SHOTGUN", w3: "MARKSMAN", w4: "RPG", w5: "GRENADES",
    how_gun: "", how_rocket: "RPG", how_nade: "FRAG", how_melee: "RIFLE BUTT", how_punch: "PUNCHED", how_kick: "KICKED", how_throw: "THROWN", how_backstrike: "FROM BEHIND", how_fall: "THE DROP", how_bite: "BITTEN", how_fire: "BURNED",
    tFire: "FIRE", tAim: "AIM", tJump: "JUMP", tReload: "RELOAD", tSwap: "SWAP", tNade: "NADE", tMelee: "STRIKE", tThrow: "THROW", tCrouch: "CROUCH", tRoll: "ROLL", tUse: "USE", controls: "CONTROLS", back: "BACK", ctlKeys: "KEYBOARD + MOUSE", ctlTouch: "TOUCH",
    rotate: "Turn your phone sideways", rotateOk: "Play upright anyway",
    boot1: "Walking the block…", boot2: "Boarding up the windows…", boot3: "Waking the crew…", ready: "Ready"
  };
  // The controls screen: [heading, [[key / gesture, what it does], ...]] per input style.
  SP.CONTROLS = {
    kb: [
      ["MOVE", [["W A S D", "Walk"], ["Shift", "Sprint (forward)"], ["Space", "Jump"], ["C / Left Ctrl", "Crouch (toggle)"], ["Q", "Dive roll"], ["X", "Quick turn round"]]],
      ["FIGHT", [["Mouse", "Look"], ["Left click", "Fire"], ["Right click (hold)", "Aim down the sights"], ["R", "Reload"], ["1 - 6 / wheel", "Pick a gun"], ["Hold F", "Weapon wheel (let go to take it)"], ["G", "Throw a grenade"]]],
      ["HAND TO HAND", [["V", "Punch, then kick, then punch (from behind: takedown)"], ["B", "Flying shoulder throw: leap at an enemy up to 5 m away and fling them (7 s cooldown)"]]],
      ["THE STREET", [["E", "Climb a ladder, vault a wall or car, search a body"], ["Space", "Let go of a ladder"], ["Tab", "Scores"], ["P", "Settings"], ["M", "Sound on / off"]]],
      ["TURF: THE DUFFLE RUN", [["Stand at a table", "Packs the bricks into the bags: 5 seconds, a green meter fills (an enemy in the room pauses it)"], ["Walk up to a packed table", "Take a bag (one each; the other crew can steal them)"], ["Get it home", "Carry it to your block's drop zone: the blue beam. A carrier who dies drops the bag, and anyone can pick it up"]]]
    ],
    touch: [
      ["MOVE + LOOK", [["Left thumb", "Stick: put it down anywhere on the left, push to the edge to sprint"], ["Right thumb", "Drag anywhere to look"], ["JUMP", "Jump"], ["CROUCH", "Crouch (toggle)"], ["ROLL", "Dive roll"]]],
      ["FIGHT", [["FIRE", "Fire (drag it to aim and shoot with one thumb)"], ["AIM", "Aim down the sights (toggle)"], ["RELOAD", "Reload"], ["SWAP", "Next gun"], ["NADE", "Throw a grenade"]]],
      ["HAND TO HAND", [["STRIKE", "Punch, then kick, then punch"], ["THROW", "Flying shoulder throw at an enemy ahead of you"]]],
      ["THE STREET", [["USE", "Appears when you can climb a ladder, vault something or search a body"], ["\u2630", "Scores"], ["\u2699", "Settings (sound, graphics, controls)"]]],
      ["TURF: THE DUFFLE RUN", [["Stand at a table", "Packs the bricks into the bags: 5 seconds"], ["Walk up to a packed table", "Take a bag"], ["Get it home", "Carry it to your block's blue beam; a carrier who dies drops it"]]]
    ]
  };
  SP.t = function (key) {
    let s = STR[key];
    if (s === undefined) s = key;
    for (let i = 1; i < arguments.length; i++) s = String(s).replace("{" + (i - 1) + "}", arguments[i]);
    return s;
  };
  SP.howText = function (how) { return SP.t("how_" + how); };
  // Fill every [data-t] element with its string.
  SP.fillStrings = function (root) {
    (root || document).querySelectorAll("[data-t]").forEach(function (el) { el.textContent = SP.t(el.dataset.t); });
  };
  SP.STR = STR;
})(globalThis.SP);
