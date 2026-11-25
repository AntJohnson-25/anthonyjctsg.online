// Dirt and Deeds: the rules. Pure (no DOM, no three.js) so a Node sim can play it a thousand times.
//
// Shape of the game: every number is FOUND, not handed over. A property has a true value, true repair bill and a seller with a
// hidden motive. You learn them by walking up, knocking, phoning, building trust. The mentor (a wholesaler) pays you a finder's
// fee for a locked lead that works; once you earn the right you tie houses up yourself and assign the contract to a cash buyer.
import { T, HEROES, SITUATIONS, TEMPERS, STREETS, BUYER_NAMES, BODY, RESIDENTS, FIRST_M, FIRST_F, LAST, homeChance, money } from "./data.js";

// ---------------------------------------------------------------- random
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = (v, k) => Math.round(v / k) * k;
const gauss = (r) => { let u = 0; for (let i = 0; i < 4; i++) u += r(); return (u - 2) / 0.577; };   // ~N(0,1)
const hashf = (n, salt) => { let x = Math.imul((n + 1) ^ salt, 2654435761) >>> 0; x = Math.imul(x ^ (x >>> 15), 2246822519) >>> 0; return (x >>> 0) / 4294967296; };

// ---------------------------------------------------------------- properties (static: made from the seed, never saved)
const WEIGHTS = {
  flats: { tax: 13, probate: 8, landlord: 13, divorce: 5, foreclosure: 6, vacant: 10, code: 10, relocate: 3, downsize: 6, fire: 4, retail: 22 },
  heights: { tax: 3, probate: 5, landlord: 4, divorce: 8, foreclosure: 3, vacant: 2, code: 2, relocate: 10, downsize: 10, fire: 3, retail: 50 }
};
function weighted(r, w) { const ks = Object.keys(w); let t = 0; for (const k of ks) t += w[k]; let x = r() * t; for (const k of ks) { x -= w[k]; if (x <= 0) return k; } return ks[0]; }

// lots: [{ id, district, n, row (s1|main|s2) }]
export function genProps(seed, lots) {
  const r = rng(seed * 7919 + 13);
  const P = {};
  for (const lot of lots) {
    const d = lot.district, rich = d === "heights";
    const sit = weighted(r, WEIGHTS[d]);
    const S = SITUATIONS[sit];
    const sqft = round(rich ? 1900 + r() * 1500 : 850 + r() * 750, 25);
    const ppsf = rich ? 150 + r() * 38 : 84 + r() * 22;
    const arv = round(sqft * ppsf, 1000);
    let cond = (rich ? 0.04 + r() * 0.2 : 0.18 + r() * 0.3) + S.bias + (r() - 0.5) * 0.1;
    cond = clamp(cond, 0.02, 0.95);
    const repairs = round(sqft * cond * (rich ? 44 : 32), 500);
    const m = Math.round(S.motive[0] + r() * (S.motive[1] - S.motive[0]));
    const mo = m / 100;
    const asIs = arv - repairs * 1.1;
    const floor = round(asIs * (0.965 - 0.5 * Math.pow(mo, 1.15)), 500);
    const ask0 = round(Math.max(floor * 1.12, asIs * (1.02 + 0.28 * (1 - mo)) + (r() - 0.4) * 0.05 * asIs), 500);
    // signs
    const signs = [];
    for (const k of Object.keys(S.signs)) if (k !== "none" && k !== "sold_none" && r() < S.signs[k]) signs.push(k);
    // the Heights' worst houses still read nice from the curb; low-condition houses show less
    if (cond < 0.12) { const i = signs.indexOf("tarp"); if (i >= 0) signs.splice(i, 1); }
    const listed = sit === "retail" && rich && r() < 0.18;
    if (listed) signs.push("forsale");
    const sex = r() < 0.5 ? "m" : "f";
    const old = sit === "downsize" || sit === "code" || (sit === "tax" && r() < 0.5) || r() < 0.18;
    const pool = RESIDENTS[d];
    const body = old ? (sex === "m" ? pick(r, pool.oldM) : pick(r, pool.oldF)) : pick(r, pool[sex]);
    const first = sex === "m" ? pick(r, FIRST_M) : pick(r, FIRST_F);
    const last = pick(r, LAST);
    const absentee = r() < S.absentee;
    const temper = pick(r, Object.keys(TEMPERS));
    const street = STREETS[d][lot.row];
    P[lot.id] = {
      id: lot.id, n: lot.n, street, addr: lot.n + " " + street, district: d, row: lot.row,
      beds: sqft < 1000 ? 2 : sqft < 1500 ? 3 : sqft < 2400 ? 4 : 5, baths: sqft < 1100 ? 1 : sqft < 2200 ? 2 : 3, sqft, year: 1948 + Math.floor(r() * 62),
      arv, cond, repairs, situation: sit, motive: m, floor, ask0, signs, listed,
      owner: { name: first + " " + last, first, last, sex, body, age: old ? 64 + Math.floor(r() * 20) : 31 + Math.floor(r() * 30) },
      absentee, phoneListed: r() < (absentee ? 0.25 : 0.75), temper, titleIssue: r() < T.titleIssue,
      style: Math.floor(r() * 4), hue: r(), roofHue: r(), seedv: Math.floor(r() * 1e6)
    };
  }
  return P;
}
// Life keeps happening: a homeowner who wasn't selling can become a motivated seller (job move, divorce, death in the family,
// tax trouble). Saved as s.turned[pid] = { sit, k } and re-applied to P after a load. Only situations with no curbside signs,
// so the 3D house doesn't need to change. k (0..1) = how motivated: high early in a run, lower later (harder).
const TURN_SITS = ["divorce", "relocate", "downsize", "tax", "probate"];
export function applyTurn(p, t) {
  const S = SITUATIONS[t.sit];
  const m = Math.round(S.motive[0] + t.k * (S.motive[1] - S.motive[0])), mo = m / 100;
  const asIs = p.arv - p.repairs * 1.1;
  p.situation = t.sit; p.motive = m;
  p.floor = round(asIs * (0.965 - 0.5 * Math.pow(mo, 1.15)), 500);
  p.ask0 = round(Math.max(p.floor * 1.12, asIs * (1.02 + 0.28 * (1 - mo))), 500);
}
export function applyTurns(s, P) { for (const [pid, t] of Object.entries(s.turned || {})) if (P[pid]) applyTurn(P[pid], t); }
export const mao = (P, mkt = 1) => Math.round((T.mpd * P.arv * mkt - P.repairs - T.mpdFee) / 500) * 500;
export const isDeal = (P, mkt = 1) => !P.listed && P.floor <= mao(P, mkt) - 1000;

// ---------------------------------------------------------------- state
export function newGame(heroId, seed) {
  const hero = HEROES.find((h) => h.id === heroId) || HEROES[0];
  const r = rng(seed + 99);
  const buyers = [0, 1, 2].map((i) => makeBuyer(r, i));
  return {
    v: 1, hero: hero.id, seed, day: 1, min: T.dayStart, cash: T.startCash, rep: T.startRep + (hero.pk === "connected" ? 25 : 0), tier: 1,
    mkt: 1, mktNote: "Steady", leads: {}, sold: {}, contracts: [], sent: [], callbacks: [], buyers, nextBuyer: 3,
    inbox: [{ day: 1, from: "Mentor", text: "Welcome to the street. Find me a seller who has to move. Bring me the numbers and I pay you a finder's fee.", kind: "msg" }],
    unread: 1, closed: 0, assigned: 0, earned: 0, burns: 0, wasted: 0, driven: 0, tips: 0, rentDue: 1 + T.rentEvery, over: null, won: false,
    stats: { knocks: 0, calls: 0, notes: 0, locked: 0 }, flags: {}, turned: {}
  };
}
export const heroOf = (s) => HEROES.find((h) => h.id === s.hero) || HEROES[0];
const perk = (s, k) => heroOf(s).pk === k;
// 2026-11-24 (user): opportunities a little more plentiful at the start, harder as you go.
// ease = 1 on day 1 -> 0 once you're ~2 months in or have a real track record (whichever first).
export function ease(s) {
  const progress = (s.day - 1) / 75 + s.closed * 0.06 + s.assigned * 0.1;
  return clamp(1 - progress, 0, 1);
}
export const hour = (s) => Math.floor(s.min / 60);
export const weekend = (s) => ((s.day - 1) % 7) >= 5;
export function worth(s) { return s.cash + s.contracts.reduce((a, c) => a + (c.em || 0), 0); }

function makeBuyer(r, i) {
  const b = BUYER_NAMES[i % BUYER_NAMES.length];
  return { id: "b" + i, name: b[0], sex: b[1], biz: b[2], bio: b[3], pct: round(0.6 + r() * 0.14, 0.01), pref: r() < 0.5 ? "flats" : r() < 0.5 ? "heights" : "any", picky: r(), ghost: 0.08 + r() * 0.2, deals: 0 };
}

export function say(s, from, text, kind = "msg") { s.inbox.unshift({ day: s.day, min: Math.floor(s.min), from, text, kind }); if (s.inbox.length > 60) s.inbox.length = 60; s.unread++; }

// ---------------------------------------------------------------- the clock
export function adv(s, minutes) { s.min += minutes; return s.min >= T.dayEnd; }

// Close out the day: bills, mentor results, contracts, rivals, the market. Returns { lines, over }.
export function endDay(s, P) {
  const lines = [];
  const r = rng(s.seed * 31 + s.day * 977);
  // living costs + gas
  const gas = Math.round(s.driven * T.gasPerM);
  s.cash -= T.living + gas;
  lines.push("Food, phone and gas: " + money(T.living + gas) + (gas ? " (" + money(gas) + " of it gas)" : "") + ".");
  s.driven = 0;
  // mentor results
  const done = s.sent.filter((x) => x.resolve <= s.day);
  s.sent = s.sent.filter((x) => x.resolve > s.day);
  for (const x of done) {
    const p = P[x.pid], L = s.leads[x.pid];
    if (!p || !L) continue;
    if (x.pay > 0) {
      s.cash += x.pay; s.earned += x.pay; s.closed++; s.rep = clamp(s.rep + 6, 0, 100);
      L.status = "paid"; s.sold[x.pid] = "closed";
      const msg = "Closed on " + p.addr + ". Your finder's fee is in: " + money(x.pay) + ".";
      say(s, "Mentor", msg, "money"); lines.push(msg);
    } else {
      L.status = "dead"; s.wasted++; s.rep = clamp(s.rep - 1, 0, 100);
      const msg = x.why;
      say(s, "Mentor", msg); lines.push(msg);
    }
  }
  // locked leads going stale, rivals sniping
  for (const pid of Object.keys(s.leads)) {
    const L = s.leads[pid], p = P[pid];
    if (L.status === "locked") {
      if (s.day - L.lockedDay > T.lockDays) { L.status = "dead"; const m = "The seller on " + p.addr + " stopped answering. Lead went cold."; say(s, "Lead", m); lines.push(m); }
      else if (r() < T.rivalSnipe * (0.4 + 0.6 * (1 - ease(s))) * (p.district === "heights" ? 1.5 : 1)) { L.status = "dead"; s.sold[pid] = "rival"; const m = "Bad news: another investor got to " + p.addr + " first. It's SOLD."; say(s, "Lead", m); lines.push(m); }
    }
  }
  // the rivals keep buying the town out from under you
  if (r() < 0.15 + 0.3 * (1 - ease(s))) {
    const open = Object.values(P).filter((p) => !s.sold[p.id] && !p.listed && p.situation !== "retail" && !s.contracts.some((c) => c.pid === p.id) && !(s.leads[p.id] && ["locked", "sent"].includes(s.leads[p.id].status)));
    if (open.length) { const p = pick(r, open); s.sold[p.id] = "rival"; if (s.leads[p.id]) s.leads[p.id].status = "dead"; }
  }
  // callbacks from door cards / voicemails
  const cbs = s.callbacks.filter((c) => c.day <= s.day);
  s.callbacks = s.callbacks.filter((c) => c.day > s.day);
  for (const c of cbs) {
    const p = P[c.pid]; if (!p || s.sold[c.pid]) continue;
    const L = s.leads[c.pid]; if (L && (L.status === "locked" || L.status === "sent" || L.status === "paid")) continue;
    if (L) { L.phone = true; L.callback = true; }
    const m = p.owner.name + " called back about " + p.addr + ". They're willing to talk. Open the lead on your phone.";
    say(s, "Callback", m, "call"); lines.push(m);
  }
  // contracts
  for (const c of s.contracts.slice()) {
    const p = P[c.pid];
    if (c.close && c.close <= s.day) { lines.push(...closeContract(s, P, c, r)); continue; }
    if (!c.close && c.expires <= s.day) {
      s.contracts = s.contracts.filter((x) => x !== c);
      s.rep = clamp(s.rep - 4, 0, 100);
      const m = "The contract on " + p.addr + " ran out. You lost the " + money(c.em) + " earnest money.";
      say(s, "Contracts", m, "bad"); lines.push(m); if (s.leads[c.pid]) s.leads[c.pid].status = "dead";
    }
  }
  // random life
  if (r() < 0.05) { const c = round(120 + r() * 220, 5); s.cash -= c; const m = "Car trouble: " + money(c) + " at the shop."; say(s, "Life", m, "bad"); lines.push(m); }
  if (r() < 0.07 + 0.2 * ease(s)) {
    const pool = Object.values(P).filter((p) => !s.sold[p.id] && p.situation !== "retail" && !p.listed && !(s.leads[p.id]));
    if (pool.length) {
      const p = pick(r, pool); s.tips++;
      s.leads[p.id] = newLead(s, p); s.leads[p.id].tip = true;
      const m = "Tip from a neighbor: " + p.addr + " might be worth a knock (" + SITUATIONS[p.situation].label.toLowerCase() + ").";
      s.leads[p.id].info.situation = true;
      say(s, "Tip", m, "tip"); lines.push(m);
    }
  }
  // a neighbor's life changes and a new seller appears (about 2 a week)
  if (r() < 0.3) {
    s.turned = s.turned || {};
    const pool = Object.values(P).filter((p) => p.situation === "retail" && !p.listed && !s.sold[p.id] && !s.leads[p.id] && !s.turned[p.id]);
    if (pool.length) {
      const p = pick(r, pool), t = { sit: pick(r, TURN_SITS), k: clamp(0.35 + 0.55 * ease(s) + (r() - 0.5) * 0.4, 0, 1) };
      s.turned[p.id] = t; applyTurn(p, t);
      if (r() < 0.6) {
        s.leads[p.id] = newLead(s, p); s.leads[p.id].tip = true; s.leads[p.id].info.situation = true; s.tips++;
        const m = "Word around town: " + p.addr + " — " + SITUATIONS[t.sit].label.toLowerCase() + ". Could be worth a knock.";
        say(s, "Tip", m, "tip"); lines.push(m);
      }
    }
  }
  // market, weekly
  if (s.day % 7 === 0) {
    // Real small-town prices move a few percent a YEAR, so weekly drift is tiny (about +/-0.6%), pulled back toward the start.
    const drift = (r() - 0.5) * 0.012 + (1 - s.mkt) * 0.1;
    s.mkt = clamp(s.mkt * (1 + drift), 0.92, 1.08);
    s.mktNote = drift > 0.003 ? "Heating up" : drift < -0.003 ? "Cooling off" : "Steady";
    lines.push("Market this week: " + s.mktNote + " (" + (s.mkt >= 1 ? "+" : "") + ((s.mkt - 1) * 100).toFixed(1) + "% vs. start).");
  }
  // tier ups
  const t = checkTier(s, P); if (t) lines.push(t);
  // rent
  s.day++; s.min = T.dayStart;
  if (s.day >= s.rentDue) {
    s.rentDue += T.rentEvery;
    s.cash -= T.rent; lines.push("Rent day: " + money(T.rent) + " paid.");
  }
  if (s.cash < 0 && !s.contracts.length && !s.sent.length) {
    s.over = "broke"; lines.push("You can't cover your bills. The landlord changes the locks.");
  } else if (s.cash < -400) { s.over = "broke"; lines.push("You're too far under water to keep going."); }
  if (!s.won && worth(s) >= T.winWorth && s.tier >= 3) { s.won = true; lines.push("You hit " + money(T.winWorth) + ". You have outgrown the bird-dog life."); }
  return { lines, over: s.over };
}

export function checkTier(s) {
  if (s.tier === 1 && s.closed >= T.tier2.closed && s.rep >= T.tier2.rep) {
    s.tier = 2; say(s, "Mentor", "You're ready. From now on you can put a house under contract yourself and sell the contract to a cash buyer. Bigger fees, real risk: if you can't find a buyer before the deadline you lose your earnest money.", "tier");
    return "TIER 2 unlocked: Assignment. You can write contracts now.";
  }
  if (s.tier === 2 && worth(s) >= T.tier3.worth && s.assigned >= T.tier3.assigned) {
    s.tier = 3; say(s, "Mentor", "You've got capital and a track record. Flips, rentals and raw land are next. That part of the game is coming.", "tier");
    return "TIER 3 reached: Capital. (Flips, rentals and raw land arrive in the next build.)";
  }
  return null;
}

// ---------------------------------------------------------------- leads
function newLead(s, p) {
  return { pid: p.id, day: s.day, status: "noted", visits: 0, burns: 0, phone: false, traced: false, cooldown: 0, lockedPrice: null, lockedDay: null, callback: false, notes: [],
    info: { situation: false, timeline: false, repairs: null, repairsExact: false, ask: null, bottom: false, trust: 0, motiveFeel: null } };
}
export function noteLead(s, p) {
  if (s.sold[p.id]) return { ok: false, msg: "That one is already sold." };
  if (s.leads[p.id]) return { ok: false, msg: "Already on your list.", lead: s.leads[p.id] };
  const L = newLead(s, p);
  s.leads[p.id] = L; s.stats.notes++;
  adv(s, 1);
  if (perk(s, "appraiser")) L.arvKnown = true;
  return { ok: true, lead: L, msg: "Noted " + p.addr + "." };
}
export function skipTrace(s, p) {
  const L = s.leads[p.id]; if (!L) return { ok: false, msg: "Note the house first." };
  if (L.phone) return { ok: false, msg: "You already have a number." };
  const free = perk(s, "records");
  if (!free && s.cash < T.skipTrace) return { ok: false, msg: "A skip trace costs " + money(T.skipTrace) + "." };
  if (!free) s.cash -= T.skipTrace;
  adv(s, 3);
  const hit = free || hashf(p.seedv, s.day) < 0.72 + 0.15 * ease(s);
  if (hit) { L.phone = true; L.traced = true; return { ok: true, msg: "Found a number for " + p.owner.name + (free ? "." : " (" + money(T.skipTrace) + ").") }; }
  return { ok: false, msg: "The trace came back empty. " + money(T.skipTrace) + " gone." };
}
// Public numbers are in the book for owners who live there.
export const canCall = (L, p) => !!L && (L.phone || p.phoneListed);
export function homeNow(s, p, mode, r = Math.random) {
  if (mode === "door" && p.absentee) return false;
  if (s.sold[p.id]) return false;
  const base = homeChance(hour(s), weekend(s));
  const k = mode === "phone" ? 1.05 : 1;
  return r() < Math.min(0.95, base * k * (1 + 0.15 * ease(s))) * (p.absentee ? 0.9 : 1);
}

// ---------------------------------------------------------------- estimates the player can build from what they know
export function compPpsf(s, district) {
  const rich = district === "heights";
  const noise = 1 + (hashf(s.day >> 2, rich ? 7 : 3) - 0.5) * 0.08;
  return Math.round((rich ? 168 : 94) * s.mkt * noise);
}
export function estimate(s, p) {
  const L = s.leads[p.id];
  const exact = L && L.arvKnown;
  const arv = exact ? p.arv * s.mkt : p.sqft * compPpsf(s, p.district) * (1 + (hashf(p.seedv, 41) - 0.5) * 0.14);
  const info = L ? L.info : {};
  const rep = info.repairs != null ? info.repairs : null;
  // without a walk-through the signs give a rough range
  const per = p.district === "heights" ? 44 : 32;
  const lo = round(p.sqft * 0.05 * per, 500), hi = round(p.sqft * Math.min(0.9, 0.2 + p.signs.filter((k) => ["overgrown", "boarded", "tarp", "junk", "notice", "mail"].includes(k)).length * 0.14) * per, 500);
  return { arv: round(arv, 1000), exact: !!exact, repairs: rep, repairsExact: !!(info.repairsExact), range: [lo, Math.max(hi, lo + 3000)] };
}
export function dealMath(s, p) {
  const e = estimate(s, p), L = s.leads[p.id];
  const rep = e.repairs != null ? e.repairs : Math.round((e.range[0] + e.range[1]) / 2 / 500) * 500;
  const maoEst = Math.round((T.mpd * e.arv - rep - T.mpdFee) / 500) * 500;
  const price = L && L.info.ask != null ? L.info.ask : null;
  return { arv: e.arv, repairs: rep, repairsKnown: e.repairs != null, mao: maoEst, ask: price, spread: price != null ? maoEst - price : null, exactArv: e.exact };
}

// ---------------------------------------------------------------- the conversation
export function startTalk(s, p, mode, r = Math.random) {
  const L = s.leads[p.id] || (s.leads[p.id] = newLead(s, p));
  const hero = heroOf(s);
  const trustMult = mode === "phone" ? 0.75 : 1;
  let trust = (4 + s.rep * 0.12 + (L.callback ? 14 : 0) + (L.visits ? 4 : 0) - L.burns * 8) * trustMult;
  const temper = TEMPERS[p.temper];
  const c = {
    pid: p.id, mode, trust: Math.max(0, trust), tension: mode === "phone" ? 8 : 4, ask: L.info.ask != null ? L.info.ask : null, askNow: L.info.ask != null ? L.info.ask : p.ask0,
    turns: 0, over: null, patience: temper.patience, known: { ...L.info }, log: [], pushes: 0, minutes: 0, trustMult
  };
  c.known.askRevealed = L.info.ask != null;
  return c;
}

const POOL = {
  rapport: {
    friendly: ["Oh, it's a good block. Folks look out for each other. You from around here?", "I've been here a long time. You get to know everybody. Where are you from?"],
    guarded: ["It's fine. Quiet. What's this about again?", "Same as any street. I don't really know the neighbors."],
    chatty: ["Oh, let me tell you about this street. The Hendersons next door had that dog for fifteen years...", "You have a minute? Everybody on this block has a story."],
    blunt: ["It's a street. People mind their business. Get to it.", "It's fine. Why are you really here?"],
    proud: ["I've kept this place up for years. Nobody can say I haven't.", "It's a good house. I take care of what's mine."]
  },
  rapportBad: ["You don't need to butter me up. What do you want?", "Uh huh. Is this a sales pitch?"],
  deflect: ["I don't know you well enough to get into my business.", "Why do you want to know that?", "That's personal. Maybe another time."],
  noPlans: ["Sell? No. This is home. I'm not looking.", "I don't have any plans to leave. You'd have to make me an offer I can't turn down."],
  lookYes: ["Sure, come take a look. Watch the step. It's been a while since I fixed that.", "Come on in. I'll warn you, it's not much to see."],
  lookNo: ["I'm not letting a stranger walk through my house.", "No, no. Not today."],
  phoneCond: ["Honestly? {cond}", "I'd say {cond}"],
  priceYes: ["I'd need {ask}. That's what it's worth to me.", "{ask}. Maybe a little less for a quick, easy sale.", "I've been told {ask}. I'd listen at that."],
  priceNo: ["I haven't thought about a number. Why would I tell you?", "Let's not talk numbers yet."],
  pushOk: ["{ask}... that's tough, but I could maybe do {ask}.", "You're hurting me. But {ask} and I'd consider it.", "Okay. {ask}. That's as far as I like to go."],
  pushBottom: ["That's the lowest I can go. I mean it.", "No. I'm already giving it away at that number."],
  pushTense: ["Now you're insulting me.", "That's not a serious number. Are we done?"],
  lockYes: ["Okay. Have your partner come see it. If the number holds, we'll do business.", "Fine. Bring them by. I'm trusting you on this one."],
  lockNo: ["Not at that price. Come back with a better reason.", "I'm not ready for that. I don't know you well enough."],
  burned: ["I think we're done. Please leave.", "That's enough. Don't call me again.", "*click*"]
};
const fill = (str, o) => str.replace(/\{(\w+)\}/g, (m, k) => (o[k] != null ? o[k] : m));
const pickr = (a, r) => a[Math.floor(r() * a.length)];

export function talkActions(s, c, p) {
  const k = c.known, door = c.mode === "door", done = !!c.over;
  const acts = [];
  const add = (id, label, sub, ok = true, why = "") => acts.push({ id, label, sub, ok: ok && !done, why });
  add("rapport", door ? "Chat about the neighborhood" : "Make small talk", "Builds trust. Calms them down.");
  add("why", "Ask if they'd ever consider selling", "Needs a little trust. Learn their situation.", true);
  add("look", door ? "Ask to see inside" : "Ask what shape it's in", door ? "Walk the house: real repair numbers." : "A rough, unreliable guess.", true);
  add("price", "Ask what they'd need", "Finds their number.", true);
  add("push", "Come in lower", "Walk their number down. Tension rises.", k.askRevealed || c.ask != null, "Ask for their price first.");
  add("lock", "Ask to bring a buyer by", "Lock the lead at their number.", k.askRevealed || c.ask != null, "You need their number first.");
  if (s.tier >= 2) add("contract", "Write it up (contract)", "Put it under contract yourself. Risky.", k.askRevealed || c.ask != null, "You need their number first.");
  add("leave", c.trust >= 40 ? "Thank them and leave a card" : "Thank them and leave", "End the conversation.", true);
  return acts;
}

export function talkAct(s, c, p, id, rand = Math.random) {
  const out = { lines: [], end: null, minutes: 3, gain: 0 };
  const hero = heroOf(s), temper = TEMPERS[p.temper];
  const L = s.leads[p.id];
  const tm = temper.tension * (hero.pk === "presence" ? 0.75 : 1) * (1 - 0.15 * ease(s));
  const gainMul = temper.trust * (hero.pk === "talker" ? 1.3 : 1) * c.trustMult * (1 + 0.15 * ease(s));
  const you = (t) => out.lines.push({ who: "you", text: t });
  const him = (t) => out.lines.push({ who: "seller", text: t });
  const note = (t) => out.lines.push({ who: "note", text: t });
  const addTension = (v) => { c.tension = clamp(c.tension + v * tm, 0, 100); };
  const addTrust = (v) => { c.trust = clamp(c.trust + v * gainMul, 0, 100); };
  const first = p.owner.first;
  if (c.over) return out;
  c.turns++;
  if (c.turns > c.patience) { addTension(4); note("They glance at the clock."); }

  if (id === "rapport") {
    out.minutes = 4;
    you(c.mode === "door" ? "\"Nice place. How long have you been on this street?\"" : "\"Thanks for picking up. How's your day going?\"");
    if (c.tension > 70) { him(pickr(POOL.rapportBad, rand)); addTension(5); }
    else { him(pickr(POOL.rapport[p.temper], rand)); addTrust(10 + rand() * 6); addTension(-6); }
  } else if (id === "why") {
    out.minutes = 3;
    you("\"Have you ever thought about selling?\"");
    if (c.trust < 16) { him(pickr(POOL.deflect, rand)); addTension(11); }
    else if (p.situation === "retail") { him(pickr(POOL.noPlans, rand)); c.known.situation = true; c.known.motiveFeel = "low"; note("They're not a seller. Unless you pay retail, there's no deal here."); addTrust(3); addTension(2); }
    else {
      const S = SITUATIONS[p.situation];
      const txt = S.why[Math.floor(hashf(p.seedv, 5) * S.why.length)];
      him("\"" + txt + "\"");
      if (c.trust >= 30 || !c.known.timeline) { c.known.timeline = true; note(S.time); }
      c.known.situation = true; c.known.motiveFeel = p.motive > 75 ? "high" : p.motive > 55 ? "mid" : "low";
      note("Situation: " + S.label + ".");
      addTrust(4); addTension(2);
    }
  } else if (id === "look") {
    if (c.mode === "door") {
      out.minutes = 18;
      you("\"Would you mind if I took a quick look inside?\"");
      if (c.trust < 34) { him(pickr(POOL.lookNo, rand)); addTension(12); out.minutes = 3; }
      else {
        him(pickr(POOL.lookYes, rand));
        const exact = hero.pk === "repairs";
        const est = exact ? p.repairs : Math.max(1000, round(p.repairs * (1 + gauss(rand) * 0.12), 500));
        c.known.repairs = est; c.known.repairsExact = exact; c.known.walked = true;
        note("Walk-through: roughly " + money(est) + " in repairs" + (exact ? " (your read is exact)" : " (give or take)") + ".");
        addTrust(5); addTension(3);
      }
    } else {
      out.minutes = 4;
      you("\"What kind of shape is the house in?\"");
      if (c.trust < 24) { him(pickr(POOL.deflect, rand)); addTension(9); }
      else {
        const word = p.cond < 0.2 ? "it's in good shape, just needs paint" : p.cond < 0.4 ? "it needs some work, the kitchen and floors, that kind of thing" : p.cond < 0.6 ? "it needs a lot. Roof, kitchen, plumbing, you name it" : "it's rough. Honestly it needs everything";
        him("\"" + fill(pickr(POOL.phoneCond, rand), { cond: word }) + "\"");
        const est = Math.max(1000, round(p.repairs * (1 + gauss(rand) * 0.35), 500));
        if (c.known.repairs == null) { c.known.repairs = est; c.known.repairsExact = false; }
        note("Their description suggests about " + money(est) + " in work. It's a guess. You haven't seen it.");
        addTrust(3); addTension(2);
      }
    }
  } else if (id === "price") {
    out.minutes = 3;
    you("\"If you did sell, what number would make it worth your while?\"");
    if (c.trust < 24) { him(pickr(POOL.priceNo, rand)); addTension(9); }
    else {
      c.ask = c.askNow; c.known.askRevealed = true; c.known.ask = c.askNow;
      him("\"" + fill(pickr(POOL.priceYes, rand), { ask: money(c.askNow) }) + "\"");
      note("Their opening number: " + money(c.askNow) + ".");
      addTension(3);
    }
  } else if (id === "push") {
    out.minutes = 3;
    you("\"That's more than I can do. Could you come down to something closer to ___?\"");
    const gap = c.askNow - p.floor;
    if (c.askNow <= p.floor * 1.015) { him(pickr(POOL.pushBottom, rand)); c.known.bottom = true; note("This is their bottom line: " + money(c.askNow) + "."); addTension(20); }
    else if (c.tension > 75) { him(pickr(POOL.pushTense, rand)); addTension(15); }
    else {
      const frac = 0.2 + 0.28 * (c.trust / 100) + rand() * 0.08;
      const next = Math.max(p.floor, round(c.askNow - gap * frac, 500));
      c.askNow = next; c.ask = next; c.known.ask = next; c.known.askRevealed = true; c.pushes++;
      him("\"" + fill(pickr(POOL.pushOk, rand), { ask: money(next) }) + "\"");
      note("They'll do " + money(next) + ".");
      if (next <= p.floor * 1.015) { c.known.bottom = true; note("It feels like they have nothing left to give."); }
      addTension(16 - c.trust * 0.07);
    }
  } else if (id === "lock" || id === "contract") {
    out.minutes = id === "contract" ? 20 : 4;
    const wantContract = id === "contract";
    you(wantContract ? "\"If we can agree on " + money(c.askNow) + ", I'd like to put it in writing today.\"" : "\"I work with a buyer. Could they take a look at it this week?\"");
    const ok = p.listed ? false : c.askNow <= p.floor * (1.1 + c.trust * 0.0022) && c.trust >= (wantContract ? 55 : 42);
    if (p.listed) { him("\"I already signed with an agent. Sorry.\""); c.over = "dead"; out.end = "dead"; }
    else if (ok) {
      if (wantContract && c.trust < 55) { him(pickr(POOL.lockNo, rand)); addTension(20); }
      else {
        him("\"" + pickr(POOL.lockYes, rand) + "\"");
        c.over = wantContract ? "contract" : "locked"; out.end = c.over; c.lockedPrice = c.askNow;
      }
    } else {
      him("\"" + pickr(POOL.lockNo, rand) + "\"");
      note(c.trust < 42 ? "They don't trust you enough yet." : "Their number is still too high for them to say yes.");
      addTension(20);
    }
  } else if (id === "leave") {
    out.minutes = 1;
    you("\"Thanks for your time. I'll be in touch.\"");
    him(c.trust >= 40 ? "\"Come back anytime.\"" : "\"Sure. Take care.\"");
    c.over = "left"; out.end = "left";
  }
  if (!c.over && c.tension >= 100) {
    him(pickr(POOL.burned, rand)); c.over = "burned"; out.end = "burned"; note("You pushed too hard. The conversation is over.");
  }
  c.minutes += out.minutes;
  adv(s, out.minutes);
  return out;
}

// Write the talk back to the lead; handle locks, contracts, burns, callbacks. Returns a one-line result.
export function finishTalk(s, P, c) {
  const p = P[c.pid], L = s.leads[c.pid];
  L.visits++;
  const k = c.known;
  for (const key of ["situation", "timeline", "repairs", "repairsExact", "ask", "bottom", "motiveFeel", "walked"]) if (k[key] != null && k[key] !== false) L.info[key] = k[key];
  if (L.info.repairs != null && k.repairs != null && k.repairsExact === false && L.info.repairsExact) L.info.repairs = L.info.repairs;
  L.info.trust = Math.max(L.info.trust || 0, Math.round(c.trust));
  if (c.over === "locked") {
    L.status = "locked"; L.lockedPrice = c.lockedPrice; L.lockedDay = s.day; L.info.ask = c.lockedPrice; s.stats.locked++;
    return { kind: "locked", text: "Locked. " + p.owner.first + " agreed to " + money(c.lockedPrice) + ". Send it to your mentor from the phone." };
  }
  if (c.over === "contract") {
    const em = clamp(round(c.lockedPrice * 0.004, 50), T.emMin, T.emMax);
    if (s.cash < em) { L.status = "locked"; L.lockedPrice = c.lockedPrice; L.lockedDay = s.day; return { kind: "locked", text: "You couldn't cover the " + money(em) + " earnest money, so it's only a lead for now." }; }
    s.cash -= em;
    s.contracts.push({ pid: p.id, price: c.lockedPrice, em, day: s.day, expires: s.day + T.contractDays, close: null, buyer: null, offer: null, pitched: {} });
    L.status = "contract"; L.lockedPrice = c.lockedPrice; L.info.ask = c.lockedPrice;
    return { kind: "contract", text: "Under contract at " + money(c.lockedPrice) + ". You put down " + money(em) + ". Find a cash buyer in " + T.contractDays + " days." };
  }
  if (c.over === "burned") {
    L.burns++; L.cooldown = s.day + 6; L.status = L.status === "locked" ? L.status : "cold"; s.burns++;
    s.rep = clamp(s.rep - 1, 0, 100);
    return { kind: "burned", text: p.owner.first + " shut you out. You can try again in about a week, but they'll remember." };
  }
  if (c.over === "dead") { L.status = "dead"; return { kind: "dead", text: "That one's off the table." }; }
  // left
  if (L.status === "noted" && (k.situation || k.askRevealed)) L.status = "talked";
  if (c.trust >= 40 && L.status !== "locked") {
    if (Math.random() < 0.35) s.callbacks.push({ pid: p.id, day: s.day + 1 + Math.floor(Math.random() * 4) });
  }
  return { kind: "left", text: "Back on the street. Check your phone for the notes." };
}

// Door knocked and nobody home, or phone rang out.
export function noAnswer(s, P, p, mode, leaveCard) {
  const L = s.leads[p.id] || (s.leads[p.id] = newLead(s, p));
  adv(s, mode === "door" ? 3 : 2);
  if (mode === "door") s.stats.knocks++; else s.stats.calls++;
  const ab = p.absentee;
  let tip = null;
  if (mode === "door" && ab && !L.info.situation && Math.random() < 0.5) {
    L.info.situation = true; tip = "A neighbor says nobody has lived there for a long time. " + SITUATIONS[p.situation].label + ".";
  }
  if (leaveCard && Math.random() < (ab ? 0.12 : 0.3)) s.callbacks.push({ pid: p.id, day: s.day + 1 + Math.floor(Math.random() * 4) });
  return { text: mode === "door" ? "Nobody answers." + (leaveCard ? " You leave your card in the door." : "") + (tip ? " " + tip : "") : "It rings out." + (leaveCard ? " You leave a voicemail." : "") };
}

// ---------------------------------------------------------------- handing the lead to the mentor (wholesaler)
export function sendToMentor(s, P, pid) {
  const L = s.leads[pid], p = P[pid];
  if (!L || L.status !== "locked") return { ok: false, msg: "Lock the seller first." };
  const price = L.lockedPrice;
  const m = mao(p, s.mkt);
  const spread = m - price;
  const complete = (L.info.situation ? 0.3 : 0) + (L.info.repairs != null ? (L.info.walked ? 0.45 : 0.3) : 0) + (L.info.timeline ? 0.25 : 0);
  let pay = 0, why = "";
  if (spread < 1500) {
    why = "Mentor on " + p.addr + ": \"The numbers don't work. At " + money(price) + " there's no room for a buyer, and I'd be paying for the privilege. Learn your math before you bring me the next one.\"";
  } else {
    const closeP = clamp(0.52 + complete * 0.4 + s.rep / 400 + 0.15 * ease(s), 0, 0.97);
    if (Math.random() < closeP && !p.listed) {
      const hero = heroOf(s);
      pay = Math.round(clamp(T.feeBase + T.feePct * spread, T.feeBase, T.feeCap) * (0.6 + 0.4 * complete / 1) * (hero.pk === "connected" ? 1.15 : 1) / 25) * 25;
    } else {
      why = "Mentor on " + p.addr + ": \"The buyer I had walked. Sometimes that's how it goes. Keep sending them.\"";
    }
  }
  const resolve = s.day + T.sellMin + Math.floor(Math.random() * (T.sellMax - T.sellMin + 1));
  s.sent.push({ pid, day: s.day, resolve, pay, why });
  L.status = "sent";
  return { ok: true, msg: "Sent. The mentor will work it and call you in about " + (resolve - s.day) + " days." };
}

// ---------------------------------------------------------------- tier 2: contracts and cash buyers
export function buyerMaxPay(P, b, mkt) {
  // a buyer's own MAO: his percentage of the fixed-up value less the real repairs and costs.
  return Math.round((b.pct * P.arv * mkt - P.repairs - T.closeCosts) / 500) * 500;
}
export function pitchBuyer(s, P, ctr, bid, rand = Math.random) {
  const p = P[ctr.pid], b = s.buyers.find((x) => x.id === bid);
  if (!b) return { ok: false, msg: "No such buyer." };
  if (ctr.close) return { ok: false, msg: "This one is already sold." };
  if (ctr.pitched[bid]) return { ok: false, msg: b.name + " already saw this one." };
  ctr.pitched[bid] = true;
  adv(s, 40);
  const pay = buyerMaxPay(p, b, s.mkt);
  const pref = b.pref === "any" || b.pref === p.district;
  if (!pref && rand() < 0.65) return { ok: true, interested: false, msg: b.name + ": \"Not my area. Pass.\"" };
  if (pay < ctr.price + 800) return { ok: true, interested: false, msg: b.name + ": \"I ran it. At " + money(ctr.price) + " plus your fee it doesn't pencil for me. Pass.\"" };
  const open = Math.max(ctr.price + 500, Math.round((ctr.price + (pay - ctr.price) * (0.35 + b.picky * 0.2)) / 100) * 100);
  ctr.offer = { buyer: bid, price: open, max: pay, countered: false };
  return { ok: true, interested: true, price: open, msg: b.name + ": \"I'll take it at " + money(open) + ". Cash, quick close.\"" };
}
export function respondOffer(s, P, ctr, action, counter, rand = Math.random) {
  const o = ctr.offer; if (!o) return { ok: false, msg: "No offer on the table." };
  const b = s.buyers.find((x) => x.id === o.buyer);
  if (action === "decline") { ctr.offer = null; return { ok: true, msg: "You pass on the offer." }; }
  if (action === "counter") {
    if (o.countered) return { ok: false, msg: "He already countered once. Take it or leave it." };
    o.countered = true;
    if (counter <= o.max) { o.price = counter; return { ok: true, msg: b.name + ": \"Fine. " + money(counter) + ". You drive a hard bargain.\"", accepted: true }; }
    if (rand() < 0.35) { ctr.offer = null; return { ok: true, msg: b.name + ": \"No. That's too much. We're done.\"", gone: true }; }
    return { ok: true, msg: b.name + ": \"Too high. My number is " + money(o.price) + ".\"" };
  }
  // accept
  ctr.buyer = o.buyer; ctr.sale = o.price; ctr.close = Math.min(ctr.expires - 1, s.day + 3 + Math.floor(rand() * 3));
  if (ctr.close <= s.day) ctr.close = s.day + 1;
  ctr.offer = null;
  return { ok: true, msg: "Assigned to " + b.name + " at " + money(ctr.sale) + ". Closing around day " + ctr.close + "." };
}
function closeContract(s, P, c, r) {
  const p = P[c.pid], b = s.buyers.find((x) => x.id === c.buyer), lines = [];
  const L = s.leads[c.pid];
  if (r() < (b ? b.ghost : 0.15)) {
    c.close = null; c.buyer = null; c.sale = null;
    const m = (b ? b.name : "The buyer") + " ghosted on the closing for " + p.addr + ". " + (c.expires > s.day + 1 ? "The contract is still alive. Find someone else." : "And the contract is about to expire.");
    say(s, "Contracts", m, "bad"); lines.push(m); return lines;
  }
  if (p.titleIssue && !c.titleFixed) {
    // a lien nobody told you about
    const cost = 1500; c.titleFixed = true; c.close = s.day + 2; if (c.close >= c.expires) c.close = c.expires - 0;
    s.cash -= cost; s.rep = clamp(s.rep - 1, 0, 100);
    const m = "Title company found an old lien on " + p.addr + ". Clearing it cost " + money(cost) + " out of your fee. Closing moves 2 days.";
    say(s, "Title", m, "bad"); lines.push(m); return lines;
  }
  const fee = c.sale - c.price - T.closeCosts;
  s.cash += fee + c.em; s.earned += Math.max(0, fee); s.assigned++; s.rep = clamp(s.rep + 9, 0, 100);
  if (b) b.deals++;
  s.contracts = s.contracts.filter((x) => x !== c);
  s.sold[p.id] = "assigned"; if (L) L.status = "paid";
  const m = "Closed! " + p.addr + " assigned to " + (b ? b.name : "a buyer") + ". Fee " + money(fee) + " (earnest money back).";
  say(s, "Contracts", m, "money"); lines.push(m);
  // a happy buyer introduces a friend
  if (s.buyers.length < 6 && r() < 0.6) { s.buyers.push(makeBuyer(rng(s.seed + s.nextBuyer * 13), s.nextBuyer)); s.nextBuyer++; const nb = s.buyers[s.buyers.length - 1]; say(s, "Network", b.name + " passed your number to " + nb.name + " (" + nb.biz + "). New buyer on your list.", "tip"); }
  return lines;
}

// ---------------------------------------------------------------- save
export function serialize(s) { return JSON.stringify(s); }
export function restore(txt) { try { const s = JSON.parse(txt); return s && s.v === 1 ? s : null; } catch (e) { return null; } }
