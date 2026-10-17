// The armoury: street-war guns, generic names.
//   kind      hitscan (instant ray) | rocket | grenade (projectiles the sim flies)
//   dmg       per pellet (hitscan) or at the blast centre (rocket, grenade)
//   head      headshot multiplier
//   rate      seconds between shots
//   spread    cone (radians, roughly 1 sigma) standing still; moveSpread is
//             added at full run, bloom per shot (up to bloomMax), recovering
//   ads       right mouse (held): the view zooms by `ads` and spread is
//             multiplied by adsSpread
//   pref      the range a bot likes to fight at with it (metres)
//   snd       which gunshot recipe audio.js plays
globalThis.SP = globalThis.SP || {};
(function (SP) {
  "use strict";
  SP.WEAPONS = [
    { id: 0, key: "pistol", name: "9MM PISTOL", short: "PISTOL", kind: "hitscan", auto: false, dmg: 26, head: 2.2, rate: 0.16,
      mag: 15, reserve: 45, maxRes: 90, pellets: 1, spread: 0.012, moveSpread: 0.03, bloom: 0.012, bloomMax: 0.04,
      range: 70, reload: 1.4, pref: 12, ads: 1.25, adsSpread: 0.55, snd: "pistol", start: true },
    { id: 1, key: "rifle", name: "ASSAULT RIFLE", short: "RIFLE", kind: "hitscan", auto: true, dmg: 22, head: 2.0, rate: 0.095,
      mag: 30, reserve: 90, maxRes: 180, pellets: 1, spread: 0.012, moveSpread: 0.035, bloom: 0.0045, bloomMax: 0.045,
      range: 120, reload: 2.2, pref: 20, ads: 1.45, adsSpread: 0.45, snd: "rifle", start: true },
    { id: 2, key: "shotgun", name: "PUMP SHOTGUN", short: "SHOTGUN", kind: "hitscan", auto: false, dmg: 12, head: 1.3, rate: 0.9,
      mag: 6, reserve: 18, maxRes: 36, pellets: 9, spread: 0.065, moveSpread: 0.015, bloom: 0, bloomMax: 0,
      range: 30, reload: 2.6, pref: 6, ads: 1.2, adsSpread: 0.75, snd: "shotgun" },
    { id: 3, key: "marksman", name: "MARKSMAN RIFLE", short: "MARKSMAN", kind: "hitscan", auto: false, dmg: 70, head: 2.2, rate: 0.45,
      mag: 10, reserve: 20, maxRes: 40, pellets: 1, spread: 0.035, moveSpread: 0.05, bloom: 0.01, bloomMax: 0.02,
      range: 180, reload: 2.5, pref: 34, ads: 4, adsSpread: 0.04, scope: true, snd: "marksman" },
    { id: 4, key: "rpg", name: "RPG", short: "RPG", kind: "rocket", auto: false, dmg: 130, head: 1, rate: 1.2,
      mag: 1, reserve: 3, maxRes: 5, pellets: 1, spread: 0.004, moveSpread: 0.02, bloom: 0, bloomMax: 0,
      range: 120, reload: 2.4, pref: 18, splash: 5, speed: 34, ads: 1.3, adsSpread: 0.5, snd: "rpg" },
    { id: 5, key: "grenade", name: "FRAG", short: "GRENADES", kind: "grenade", auto: false, dmg: 110, head: 1, rate: 0.9,
      mag: 2, reserve: 0, maxRes: 0, maxMag: 4, pellets: 1, spread: 0, moveSpread: 0, bloom: 0, bloomMax: 0,
      range: 40, reload: 0, pref: 14, splash: 5.5, speed: 17, fuse: 2.4, ads: 1, adsSpread: 1, snd: "throw", start: true }
  ];
  // Quick melee (V): a rifle-butt strike. From behind it drops them in one.
  SP.MELEE = {
    dmg: 55, back: 100, range: 2.2, cone: 0.75, cd: 0.7,
    // Hand to hand (V): punch, then kick, then punch... A strike within `window` s of the last one carries
    // the combo on. dur = seconds the move takes, hit = when it lands, clip = the animation's own length.
    window: 1.3,
    punch: { dmg: 30, dur: 0.5, hit: 0.2, clip: 1.0 },
    kick: { dmg: 48, dur: 0.75, hit: 0.32, clip: 1.4333 }
  };
  // The flying shoulder throw (B): leap at an enemy up to `range` away, grab and fling them over your
  // shoulder; they lie `down` seconds. The leap is the first `hit` seconds of the clip.
  SP.THROW = { range: 5.5, cone: 0.7, reach: 1.9, dur: 2.7, hit: 0.9, dmg: 55, down: 2.6, cd: 7, clip: 3.7 };
  // Pickup respawn times (seconds).
  SP.RESPAWN = { weapon: 25, rocket: 40, armor: 30, health: 20, nades: 25 };
})(globalThis.SP);
