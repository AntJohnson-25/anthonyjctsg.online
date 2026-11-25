// Dirt and Deeds: static data. No DOM, no three.js (so the rules can be simulated in Node).
// Fictional town, fictional companies: nothing here names a real county, agency, brand or firm.

export const TOWN = "Pecan Hollow";

// ---------------------------------------------------------------- tuning
export const T = {
  startCash: 1800, startRep: 8,
  rent: 750, rentEvery: 30, living: 38, gasPerM: 0.011,
  dayStart: 7 * 60, dayEnd: 22 * 60,
  skipTrace: 15,
  walkMinPerSec: 1.5,           // game minutes that pass per real second while you are moving about
  mpd: 0.70, mpdFee: 5000,      // an investor pays at most 70% of the fixed-up value, minus repairs, minus costs
  feeBase: 300, feePct: 0.06, feeCap: 3000,
  lockDays: 10,                 // a locked lead goes stale after this many days
  tier2: { closed: 3, rep: 25 },
  tier3: { worth: 20000, assigned: 2 },
  winWorth: 25000,
  contractDays: 14, emMin: 100, emMax: 500,
  sellMin: 4, sellMax: 8,       // days the mentor needs to resolve a lead
  rivalSnipe: 0.045,
  buyerGhost: 0.18, titleIssue: 0.12, closeCosts: 350
};

// ---------------------------------------------------------------- heroes (2026-11-24: Dirt and Deeds' own six, earbuds in, always on the move)
// pk = the perk the rules check. body = own Meshy body (G:\meshy\dirt-and-deeds, hero_*); fb = stand-in only until that body is rigged + packed.
export const HEROES = [
  { id: "malik", pk: "connected", body: "hero_malik", fb: "dre_biz", sex: "m", h: 1.8, name: "Malik", perk: "Connected", perkText: "Starts with rep 33. The mentor trusts him: fees run 15% higher.", line: "Grew up three streets from half these houses and knows who is struggling to keep them." },
  { id: "simone", pk: "presence", body: "hero_simone", fb: "nia_biz", sex: "f", h: 1.68, name: "Simone", perk: "Easy Presence", perkText: "Tension builds 25% slower. Sellers stay at the door longer.", line: "Calm, careful. People tell her things they did not mean to say." },
  { id: "rafa", pk: "repairs", body: "hero_rafa", fb: "diego_biz", sex: "m", h: 1.77, name: "Rafa", perk: "Eye for Repairs", perkText: "His walk-through repair numbers are exact, never padded or guessed.", line: "Grew up on his father's roofing crew. Can price a roof from the curb." },
  { id: "dani", pk: "talker", body: "hero_dani", fb: "lucia_biz", sex: "f", h: 1.65, name: "Dani", perk: "Smooth Talker", perkText: "Trust builds 30% faster in every conversation.", line: "Talks her way past anything with a door on it and never raises her voice." },
  { id: "cole", pk: "records", body: "hero_cole", fb: "jake_biz", sex: "m", h: 1.83, name: "Cole", perk: "Records Wizard", perkText: "Skip traces are free and always find the number.", line: "Left an IT help desk for a job that pays by the deal. Knows how the databases think." },
  { id: "hannah", pk: "appraiser", body: "hero_hannah", fb: "emily_biz", sex: "f", h: 1.7, name: "Hannah", perk: "Appraiser's Eye", perkText: "Sees a house's fixed-up value (the comps) the moment she notes it.", line: "Spreadsheets in her head and a poker face on her. Knows what everything is worth." }
];

// ---------------------------------------------------------------- cast: bodies by role. The first body in a list that has a packed file wins,
// so the new Meshy characters (mentor_m, lender_f ...) take over the moment their src/chars/<id>.js exists.
export const BODY = { // id: [sex, height]
  wr_marcus: ["m", 1.8], dee: ["f", 1.7], grant: ["m", 1.85], ray: ["m", 1.77], cop_f: ["f", 1.68], cop_m: ["m", 1.84], construction_m: ["m", 1.82], iris: ["f", 1.64], mechanic_f: ["f", 1.66],
  hoodie_m: ["m", 1.82], track_m: ["m", 1.8], earl: ["m", 1.76], mateo: ["m", 1.78], omar: ["m", 1.83], mai: ["f", 1.6], sina: ["f", 1.7], elder_m: ["m", 1.76], elder_f: ["f", 1.6], auntie_f: ["f", 1.65],
  courier_m: ["m", 1.72], crew1: ["m", 1.95], suit_m: ["m", 1.86], blazer_f: ["f", 1.67], polo_m: ["m", 1.75], marcus: ["m", 1.86], hijab_f: ["f", 1.63], scrubs_f: ["f", 1.66], barista1: ["m", 1.78],
  // new characters (Meshy -> Mixamo -> pack-char); heights are the plan's guesses
  mentor_m: ["m", 1.8], lender_f: ["f", 1.68], rival_m: ["m", 1.84], inspector_m: ["m", 1.78], code_f: ["f", 1.68], gc_m: ["m", 1.85], agent_f: ["f", 1.7], surveyor_m: ["m", 1.78],
  framer_m: ["m", 1.8], roofer_m: ["m", 1.78], painter_f: ["f", 1.65], demo_m: ["m", 1.85], landscaper_f: ["f", 1.68],
  // 2026-11-24: more Run It Up bodies that read as ordinary townspeople (same heights Run It Up uses): the sport1-5 street/gym locals,
  // the second cafe worker, and the bad boy / bad girl pair for the Flats corners.
  sport1: ["m", 1.88], sport2: ["f", 1.68], sport3: ["m", 1.78], sport4: ["f", 1.7], sport5: ["m", 1.72], barista2: ["f", 1.66], mate_m: ["m", 1.85], mate_f: ["f", 1.7]
};
HEROES.forEach((h) => { BODY[h.body] = [h.sex, h.h]; BODY[h.fb] = [h.sex, h.h]; });

// Key people: [id, fallbacks..., ] first packed wins.
export const KEYS = {
  mentor: ["mentor_m", "wr_marcus"], lender: ["lender_f", "dee"], rival: ["rival_m", "grant"], inspector: ["inspector_m", "ray"],
  code: ["code_f", "cop_f"], gc: ["gc_m", "construction_m"], agent: ["agent_f", "iris"], surveyor: ["surveyor_m", "courier_m"]
};
export const WORKER_BODIES = [["framer_m", "construction_m"], ["roofer_m", "construction_m"], ["painter_f", "mechanic_f"], ["demo_m", "construction_m"], ["landscaper_f", "mechanic_f"]];

// Who lives where. Rough streets use the Run It Up street cast; nice streets the well-dressed ones.
export const RESIDENTS = {
  flats: { m: ["hoodie_m", "track_m", "earl", "mateo", "omar", "courier_m", "sport1", "sport5"], f: ["mai", "sina", "hijab_f", "sport2", "sport4"], oldM: ["elder_m"], oldF: ["elder_f", "auntie_f"] },
  heights: { m: ["suit_m", "polo_m", "marcus", "sport3"], f: ["blazer_f", "scrubs_f", "hijab_f"], oldM: ["elder_m"], oldF: ["elder_f"] }
};
export const LOITER = ["crew1", "mate_m", "hoodie_m", "mate_f", "track_m", "mateo"];   // idle on the corners of the Flats
export const NICE_WALKERS = ["suit_m", "blazer_f", "polo_m", "marcus", "scrubs_f", "barista1", "barista2", "sport3"];

// ---------------------------------------------------------------- names
export const FIRST_M = ["James", "Marcus", "Luis", "Terrence", "Walter", "Eddie", "Raymond", "Carlos", "Dennis", "Harold", "Victor", "Andre", "Calvin", "Sam", "Roy", "Hector", "Nolan", "Wade", "Darnell", "Leon"];
export const FIRST_F = ["Gloria", "Denise", "Maria", "Patricia", "Loretta", "Yolanda", "Beverly", "Angela", "Rosa", "Tamika", "Wanda", "Carla", "Helen", "Joyce", "Monica", "Lena", "Dorothy", "Priya", "Renee", "Ines"];
export const LAST = ["Washington", "Alvarez", "Brooks", "Nguyen", "Carter", "Ortiz", "Hayes", "Patel", "Jenkins", "Morales", "Coleman", "Bell", "Reyes", "Foster", "Dixon", "Hall", "Cruz", "Pierce", "Bishop", "Whitfield", "Santos", "Greene", "Tran", "Mason"];
export const STREETS = {
  flats: { s1: "Tanner St", main: "Ash Ave", s2: "Rail St" },
  heights: { s1: "Willow Crest Dr", main: "Heritage Ln", s2: "Dogwood Ct" }
};
export const BUYER_NAMES = [
  ["Reggie Tolliver", "m", "Tolliver Renovations", "Buys anything cheap in the Flats and does his own work."],
  ["Sunita Rao", "f", "Rao Property Holdings", "Landlord with a long list. Wants rentals, not showpieces."],
  ["Big Mike Dunleavy", "m", "Dunleavy & Sons", "Old-school flipper. Pays fast, hates surprises."],
  ["Priscilla Okafor", "f", "Northgate Rentals", "Cash on hand, picky, only wants clean title."],
  ["Teddy Liang", "m", "Liang Capital Group", "New money. Will chase a deal in the Heights."],
  ["Walt Brennan", "m", "Brennan Builders", "Wants teardowns and land. Pays for lot value."]
];

// ---------------------------------------------------------------- situations
// motive: [lo, hi] hidden willingness to deal. signs: visible clues, key -> chance. bias: extra repair burden.
// why: what they tell you once they trust you. Lines use {name} (owner first name) and {st} (street).
export const SITUATIONS = {
  tax: { label: "Behind on property taxes", motive: [55, 90], bias: 0.12, absentee: 0.2, signs: { overgrown: 0.7, notice: 0.35, mail: 0.3, tarp: 0.2 },
    why: ["I got a letter from the county. I'm two years behind on the taxes and it keeps growing. I can't dig out.", "Between the taxes and the insurance I'm going backwards every month. I just want it gone."],
    time: "They want it handled before the county tax sale." },
  probate: { label: "Inherited, heirs want out", motive: [60, 95], bias: 0.18, absentee: 0.8, signs: { overgrown: 0.8, mail: 0.6, boarded: 0.3, junk: 0.4 },
    why: ["It was my mother's. Three of us own it now and none of us live in this town. Nobody wants to come clean it out.", "My uncle passed in the spring. The family just wants the paperwork finished and a check."],
    time: "The family wants it closed within a couple of months." },
  landlord: { label: "Tired landlord", motive: [45, 85], bias: 0.1, absentee: 0.7, signs: { overgrown: 0.35, junk: 0.35, forrent: 0.5, tarp: 0.2, rustcar: 0.25 },
    why: ["The last tenant tore it up and stopped paying. I'm done with toilets and tenants. I'd take a fair cash number and be free.", "Third eviction in two years. I'm tired. I just want out without fixing a thing."],
    time: "They're flexible, but the vacancy is bleeding them dry." },
  divorce: { label: "Divorce, has to sell", motive: [50, 85], bias: 0.04, absentee: 0.1, signs: { sold_none: 1, junk: 0.2 },
    why: ["We're splitting everything up. The judge wants the house sold and I'd rather take a clean offer than list it.", "I can't carry it on one income. We both just want it over."],
    time: "The court gave them a deadline." },
  foreclosure: { label: "Pre-foreclosure", motive: [70, 98], bias: 0.08, absentee: 0.05, signs: { notice_white: 0.9, overgrown: 0.3 },
    why: ["The bank sent the notice. I lost my hours at work and I'm four months behind. The sale date is coming up fast.", "I don't want it to go to auction and ruin my credit. If someone could just cover what I owe I'd walk."],
    time: "The auction is only weeks away." },
  vacant: { label: "Vacant and neglected", motive: [45, 85], bias: 0.2, absentee: 0.95, signs: { boarded: 0.7, overgrown: 0.9, mail: 0.7, junk: 0.5, tarp: 0.3 },
    why: ["I moved out of state years ago and just left it. I keep meaning to deal with it. Honestly I forgot what it looked like.", "Nobody's lived there since my dad moved to the care home. I'd sell it as is, no questions."],
    time: "No hurry, but they'd take a quick clean exit." },
  code: { label: "City code violations", motive: [50, 88], bias: 0.15, absentee: 0.2, signs: { notice: 0.95, overgrown: 0.6, rustcar: 0.4, junk: 0.5 },
    why: ["The city keeps fining me for the yard and the fence. I'm elderly, I can't do the work, and the fines are piling up.", "I got a code officer on my back every month. Every visit it's another fine. I'd rather sell."],
    time: "The city set a compliance date." },
  relocate: { label: "Relocating for work", motive: [35, 70], bias: 0.02, absentee: 0.0, signs: { none: 1 },
    why: ["I got a job offer two states over and I have to be there in a month. I don't have time for showings.", "We're moving to be near family. We want it sold quickly, even if it costs us a little."],
    time: "They need to be gone within a month." },
  downsize: { label: "Downsizing elder", motive: [30, 65], bias: 0.06, absentee: 0.0, signs: { none: 1 },
    why: ["The stairs are too much now. My daughter wants me in a place with no yard work. But I don't want a stranger tramping through.", "I raised my kids here. I'm ready to move on, I just want it to go to somebody decent and be simple."],
    time: "No rush, but they want it smooth." },
  fire: { label: "Fire / storm damage", motive: [60, 92], bias: 0.3, absentee: 0.3, signs: { tarp: 0.9, boarded: 0.7, junk: 0.5, overgrown: 0.3 },
    why: ["There was a fire in the kitchen last year. The insurance fought me and I can't afford the rebuild.", "The storm took half the roof. I can't afford to fix it and I can't live in it."],
    time: "They want out before the next season." },
  retail: { label: "Not planning to sell", motive: [5, 28], bias: 0.0, absentee: 0.0, signs: { none: 1 },
    why: ["Honestly I'm not selling. It's my home and I like it here. I'd only listen for a price way over what it's worth.", "We're not going anywhere. If you want to talk, bring a big number."],
    time: "No plans." }
};

// Visible house signs the player can read from the curb (key -> text).
export const SIGN_TEXT = {
  overgrown: "overgrown lawn", boarded: "boarded-up windows", tarp: "blue tarp on the roof", junk: "junk piled in the yard",
  mail: "mail stacked on the porch", notice: "orange city notice on the door", notice_white: "legal notice taped to the door",
  forrent: "faded FOR RENT sign", rustcar: "dead car in the drive", forsale: "listed with an agent", sold: "SOLD sign"
};

// Seller temperaments: trust gain, tension gain, how many questions before they glance at the clock.
export const TEMPERS = {
  friendly: { trust: 1.3, tension: 0.7, patience: 9, tag: "Friendly" },
  guarded: { trust: 0.7, tension: 1.0, patience: 6, tag: "Guarded" },
  chatty: { trust: 1.1, tension: 0.8, patience: 12, tag: "Chatty" },
  blunt: { trust: 0.9, tension: 1.3, patience: 5, tag: "Blunt" },
  proud: { trust: 0.8, tension: 1.15, patience: 7, tag: "Proud" }
};

// Where people stand when the clock reads...
export const homeChance = (hour, weekend) => {
  if (weekend) return hour < 9 ? 0.5 : hour < 18 ? 0.8 : 0.85;
  if (hour < 8) return 0.8; if (hour < 12) return 0.4; if (hour < 17) return 0.35; if (hour < 20) return 0.8; return 0.6;
};

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US");
export const clock = (min) => { const h = Math.floor(min / 60) % 24, m = Math.floor(min % 60); return ((h + 11) % 12 + 1) + ":" + String(m).padStart(2, "0") + (h < 12 ? " AM" : " PM"); };
