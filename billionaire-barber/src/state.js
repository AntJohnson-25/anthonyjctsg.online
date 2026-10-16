/* =============================================================
   BILLIONAIRE BARBER — GAME STATE + SAVE / LOAD
   Single centralized state object. Every system reads and writes
   here; nothing keeps its own copy of simulation truth.
   ============================================================= */

const SAVE_KEY = 'billionaire_barber_save_v1';

let gameState = null;

function createNewState(character) {
  return {
    version: 1,
    week: 1,
    weekProgress: 0,              // 0..1 within the current 30s week
    cash: CONFIG.start.cash,
    netWorth: CONFIG.start.cash,

    barber: {
      character: character,       // 'male' | 'female'
      reputation: CONFIG.start.reputation,
      clientele: CONFIG.start.clientele,
      regulars: []                // NPC keys who became repeat clients
    },

    business: {
      level: 1,
      shopType: 'rental',         // 'rental' | 'owned'
      shopSize: null,             // null while renting
      marketingTier: 0,
      priceModifier: 1.0          // player can raise/lower prices
    },

    revenueStreams: {
      haircuts: true,
      merchandise: false,
      socialMedia: false,
      hairstyleTool: false,
      mobileBarber: false,
      vending: false
    },

    breaksLeft: CONFIG.breaks.charges,   // whole-game total, not per-week

    // Bought from the street vendor (CONFIG.vendor): hot towels left, pro clippers owned
    perks: { towels: 0, clippers: false },

    // Per-stream runtime data (royalty decay, mobile health, etc.)
    streamData: {
      toolRoyalty: 0,
      mobileUnits: 0
    },

    social: { followers: 0 },

    properties: [],               // { id, size, name, purchasePrice, value, tier, week }

    // Weekly ledger — rebuilt each week, drives the settlement screen
    weeklyRevenue: 0,
    weeklyExpenses: 0,
    ledger: { revenue: {}, expenses: {} },
    lastSettlement: null,

    activeEvents: [],             // { key, name, weeksLeft, modifiers }
    eventHistory: [],
    lastEventWeek: 0,
    lastOfferWeek: 0,

    // Lifetime totals for the endgame summary
    totals: {
      cutsPerformed: 0,
      customersServed: 0,
      revenueEarned: 0,
      expensesPaid: 0,
      viralMoments: 0,
      propertiesBought: 0,
      eventsEncountered: 0
    },

    flags: {
      billionaire: false,
      seenIntro: false,
      toolOffered: false,
      mobileOffered: false,
      evicted: false,
      // Week numbers after which a declined offer may be re-pitched
      socialOfferedWeek: 0,
      merchOfferedWeek: 0
    },

    history: []                   // weekly snapshots for the trend readout
  };
}

/* -------------------------------------------------------------
   DERIVED VALUES
   Computed rather than stored, so they can never drift.
   ------------------------------------------------------------- */

function currentStations() {
  const s = gameState;
  if (s.business.shopType === 'rental') return CONFIG.stationLayouts.rental;
  return CONFIG.stationLayouts[s.business.shopSize] || CONFIG.stationLayouts.small;
}

function portfolioValue() {
  return gameState.properties.reduce((sum, p) => sum + p.value, 0);
}

function computeNetWorth() {
  return gameState.cash + portfolioValue();
}

/* Count of owned shops at a given size — drives Monopoly trade-ups. */
function countBySize(size) {
  return gameState.properties.filter(p => p.size === size).length;
}

/* Aggregate modifier from all active events, e.g. traffic or revenue. */
function eventModifier(field) {
  let mod = 1;
  for (const ev of gameState.activeEvents) {
    if (ev.modifiers && typeof ev.modifiers[field] === 'number') {
      mod *= ev.modifiers[field];
    }
  }
  return mod;
}

/* Reputation is clamped 0-100 everywhere it is touched.
   Gains suffer diminishing returns so the top of the scale has to be
   earned and maintained — otherwise reputation pins at 100 early and
   the whole difficulty curve collapses with it. */
function adjustReputation(delta) {
  if (delta > 0) {
    const headroom = Math.max(0, 1 - gameState.barber.reputation / 100);
    delta *= Math.pow(headroom, 0.85);
  }
  gameState.barber.reputation = clamp(gameState.barber.reputation + delta, 0, 100);
}

/* -------------------------------------------------------------
   SAVE / LOAD
   ------------------------------------------------------------- */

function saveGame(silent) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(gameState));
    if (!silent) UI.toast('Game saved', 'save');
    return true;
  } catch (err) {
    console.warn('Save failed:', err);
    if (!silent) UI.toast('Save failed — storage unavailable', 'bad');
    return false;
  }
}

function hasSave() {
  try {
    return !!localStorage.getItem(SAVE_KEY);
  } catch (err) {
    return false;
  }
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    // Merge onto a fresh state so saves from older builds gain new fields
    // instead of leaving them undefined.
    gameState = deepMerge(createNewState(parsed.barber ? parsed.barber.character : 'male'), parsed);
    return true;
  } catch (err) {
    console.warn('Load failed:', err);
    return false;
  }
}

function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (err) { /* ignore */ }
}

/* -------------------------------------------------------------
   SMALL SHARED UTILITIES
   ------------------------------------------------------------- */

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

function rand(min, max) { return min + Math.random() * (max - min); }

function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function chance(p) { return Math.random() < p; }

/* Recursively merge `source` onto `target`, preserving new default keys. */
function deepMerge(target, source) {
  if (source === null || source === undefined) return target;
  if (Array.isArray(source)) return source.slice();
  if (typeof source !== 'object') return source;

  const out = Array.isArray(target) ? target.slice() : Object.assign({}, target);
  for (const key of Object.keys(source)) {
    const tv = out[key];
    const sv = source[key];
    if (sv && typeof sv === 'object' && !Array.isArray(sv) &&
        tv && typeof tv === 'object' && !Array.isArray(tv)) {
      out[key] = deepMerge(tv, sv);
    } else {
      out[key] = Array.isArray(sv) ? sv.slice() : sv;
    }
  }
  return out;
}

/* Currency formatting that stays readable from $500 to $1,000,000,000. */
function money(n, opts) {
  opts = opts || {};
  const neg = n < 0;
  const abs = Math.abs(n);
  let str;

  if (opts.compact && abs >= 1e9)      str = '$' + (abs / 1e9).toFixed(2) + 'B';
  else if (opts.compact && abs >= 1e6) str = '$' + (abs / 1e6).toFixed(2) + 'M';
  else if (opts.compact && abs >= 1e4) str = '$' + (abs / 1e3).toFixed(1) + 'K';
  else str = '$' + Math.round(abs).toLocaleString('en-US');

  if (opts.sign) return (neg ? '−' : '+') + str;
  return (neg ? '−' : '') + str;
}

function compactNum(n) {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e4) return (n / 1e3).toFixed(1) + 'K';
  return Math.round(n).toLocaleString('en-US');
}
