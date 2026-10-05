// The tournament: an 8-player single-elimination bracket. Pure, no DOM, so it
// is tested in tests/ and saved as plain JSON (localStorage, see main.js).
//
// You play one match per round; the other matches of that round are decided
// when yours is, by a rally-by-rally sim under the real side-out rules (fast
// enough for a phone, and the scores look like pickleball scores). Lose once and
// the run is over; the rest of the bracket is then played out so it still names
// a champion.
import { Rules } from "./rules.js";
import { mulberry32 } from "./game.js";

export const ROUNDS = [
  { name: "QUARTERFINAL", short: "QF", target: 7, level: "easy" },
  { name: "SEMIFINAL", short: "SF", target: 7, level: "medium" },
  { name: "FINAL", short: "F", target: 11, level: "hard" }
];
export const SIZE = 8;

// roster: character ids to draw from (needs SIZE incl. me, repeats are not used).
export function newTournament(roster, me, seed = (Date.now() & 0x7fffffff)) {
  const rng = mulberry32(seed);
  const others = roster.filter((id) => id !== me);
  shuffle(others, rng);
  if (others.length < SIZE - 1) throw new Error("need " + SIZE + " players, have " + (others.length + 1));
  const draw = others.slice(0, SIZE - 1);
  draw.splice(Math.floor(rng() * SIZE), 0, me);
  return { v: 1, me, draw, seed, round: 0, results: ROUNDS.map(() => []), over: null };
}

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// The players of round r in bracket order (pairs are [0,1], [2,3], ...), or null
// where the feeding match is not decided yet.
export function entrants(t, r) {
  if (r === 0) return t.draw.slice();
  const prev = t.results[r - 1], n = SIZE >> r;
  const out = [];
  for (let i = 0; i < n; i++) out.push(prev[i] ? prev[i].w : null);
  return out;
}

// Matches of round r: [{ a, b, res }] with res = { sa, sb, w } once played.
export function matches(t, r) {
  const e = entrants(t, r);
  const out = [];
  for (let i = 0; i < e.length; i += 2) out.push({ a: e[i], b: e[i + 1], res: t.results[r][i / 2] || null });
  return out;
}

// Your match this round: { round, slot, opp, target, level, name } or null when the run is over.
export function nextMatch(t) {
  if (t.over) return null;
  const r = t.round, ms = matches(t, r);
  const slot = ms.findIndex((m) => m.a === t.me || m.b === t.me);
  if (slot < 0) return null;
  const m = ms[slot];
  return { round: r, slot, opp: m.a === t.me ? m.b : m.a, ...ROUNDS[r] };
}

// One simulated match to `target` (win by 2): { sa, sb, w }.
export function simMatch(a, b, target, rng) {
  const R = new Rules(rng() < 0.5 ? "p" : "c", target);
  for (let n = 0; n < 400 && !R.winner; n++) {
    R.end(rng() < 0.5 ? "p" : "c", "sim");
    R.award();
    R.startRally();
  }
  return { sa: R.score.p, sb: R.score.c, w: R.winner === "p" ? a : b };
}

// Record your result this round (mine, theirs = points), sim the rest of the round and
// move on. Returns the tournament (changed in place): t.over = "won" | "lost" at the end.
export function recordResult(t, mine, theirs) {
  const nm = nextMatch(t);
  if (!nm) return t;
  const rng = mulberry32(t.seed + 1000 * (t.round + 1));
  const m = matches(t, t.round)[nm.slot];
  const meA = m.a === t.me;
  t.results[t.round][nm.slot] = { sa: meA ? mine : theirs, sb: meA ? theirs : mine, w: mine > theirs ? t.me : nm.opp };
  playOut(t, t.round, rng);
  if (mine < theirs) {
    t.over = "lost";
    t.lostIn = t.round;
    for (let r = t.round + 1; r < ROUNDS.length; r++) playOut(t, r, rng);   // still crown someone
    t.round = ROUNDS.length - 1;
  } else if (t.round === ROUNDS.length - 1) {
    t.over = "won";
  } else {
    t.round++;
  }
  return t;
}

function playOut(t, r, rng) {
  matches(t, r).forEach((m, i) => { if (!m.res) t.results[r][i] = simMatch(m.a, m.b, ROUNDS[r].target, rng); });
}

export function champion(t) {
  const f = t.results[ROUNDS.length - 1][0];
  return f ? f.w : null;
}

// A saved tournament is only usable if it is whole and every player is still in the roster.
export function valid(t, roster) {
  return !!(t && t.v === 1 && Array.isArray(t.draw) && t.draw.length === SIZE && t.draw.every((id) => roster.includes(id)) &&
    Array.isArray(t.results) && t.results.length === ROUNDS.length && t.round >= 0 && t.round < ROUNDS.length);
}
