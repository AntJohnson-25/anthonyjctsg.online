/* =============================================================
   BILLIONAIRE BARBER — CONFIGURATION
   All tunable simulation constants live here. No magic numbers
   should appear in the systems files; they read from CONFIG.
   ============================================================= */

/* -------------------------------------------------------------
   ASSET MANIFEST
   Paths are URI-encoded so the game runs from file:// where
   folder names contain spaces ("Real Estate").
   `null` slots render a designed fallback through the same code
   path, so supplied art can drop in later with no rework.
   ------------------------------------------------------------- */
const ASSETS = {
  /* The select screen shows the two barbers' original art. 3D models of these same two are being
     made (Source/barber-3d-prompts.md); until they land, stand-ins from the cast play them in the
     shop (see src/cast.js, HS.BARBERS). */
  portraits: {
    // renders of the in-game barbers (HS.BARBERS), by tools/select-portraits.js; re-render them
    // when the barbers change
    male:   'Barbers/game_male.png',
    female: 'Barbers/game_female.png'
  },

  // Exteriors appear ONLY as photo attachments inside realtor threads
  exteriors: {
    small:  'Real Estate/barbershop_buildings_small.png',
    medium: 'Real Estate/barbershop_buildings_medium.png',
    large:  'Real Estate/barbershop_buildings_large.png'
  },

  /* Contact headshots cropped out of the supplied phone mockups. */
  avatars: {
    realtor: 'Communication/avatar_b.png',
    partner: 'Communication/avatar_a.png'
  },

  /* Supplied 3-up menu sheet (1407x768). Crops are fractions of the
     sheet so the same numbers work at any rendered size. */
  hairstyleSheet: {
    src: 'haircut_menu.png',
    crops: {
      taper: { x: 0.0405, y: 0.117, w: 0.2843, h: 0.521 },
      fade:  { x: 0.3639, y: 0.117, w: 0.2843, h: 0.521 },
      bald:  { x: 0.6872, y: 0.117, w: 0.2843, h: 0.521 }
    }
  }
};

/* The images were pulled out of the old single-file build into assets/ as WebP (the names keep
   their original .png spelling here). Spaces etc. are encoded so file:// works too. */
function assetURL(path) {
  if (!path) return null;
  return ('assets/' + path.replace(/\.png$/, '.webp')).split('/').map(encodeURIComponent).join('/');
}

const CONFIG = {

  /* ---------- TIME ---------- */
  time: {
    secondsPerWeek: 60,        // THE core mechanic: 60s (1 min) = 1 week
    weeksPerYear: 52,
    transitionMs: 2600         // weekly settlement overlay duration
  },

  /* ---------- STARTING STATE ---------- */
  start: {
    cash: 500,
    reputation: 12,            // 0-100
    clientele: 0,
    followers: 0
  },

  /* ---------- HAIRCUT STYLES ----------
     Names and order follow the supplied menu sheet exactly, so the
     on-screen 1 / 2 / 3 keys match the numbers printed on the art.
     `rank` is the PRICE rank (0 = cheapest) and drives the
     upsell / downsell math — it is independent of display order. */
  styles: {
    taper: {
      key: 'taper', name: 'Taper & Beard', tagline: 'Clean. Reliable money.',
      rank: 1,
      price: 55, duration: 4.0, satisfaction: 4, repGain: 3, viralChance: 0.07,
      accent: '#c99a5b', glyph: 'taper'
    },
    fade: {
      key: 'fade', name: 'Fade & Light Beard', tagline: 'The skill cut. Show off.',
      rank: 2,
      price: 80, duration: 5.5, satisfaction: 5, repGain: 6, viralChance: 0.18,
      accent: '#c9a227', glyph: 'fade'
    },
    bald: {
      key: 'bald', name: 'Bald & Beard', tagline: 'Fast. Low ceiling.',
      rank: 0,
      price: 35, duration: 2.6, satisfaction: 3, repGain: 1, viralChance: 0.02,
      accent: '#5b9dd9', glyph: 'bald'
    }
  },
  // Display order = the order printed on the supplied menu sheet
  styleOrder: ['taper', 'fade', 'bald'],

  /* ---------- SERVICE OUTCOME MATH ---------- */
  service: {
    // Cutting what the customer asked for is the reliable play.
    matchBonus: 28,            // satisfaction points for honoring the request
    upsellPenalty: -22,        // base penalty for cutting a pricier style
    downsellPenalty: -14,      // base penalty for cutting a cheaper style
    // Reputation and skill claw back mismatch penalties — a great barber
    // can talk a client into something better.
    repMitigation: 0.55,       // fraction of penalty offset at 100 reputation
    tipThreshold: 78,          // satisfaction above this earns a tip
    tipRate: 0.22,             // tip as fraction of ticket
    repeatThreshold: 62,       // satisfaction above this may create a regular
    repeatChance: 0.45,
    walkoutThreshold: 25       // below this the customer may never return
  },

  /* ---------- CLIENTELE ----------
     Each customer you service on screen represents one relationship,
     not one week of business. A built clientele returns on its own,
     which is what turns a skill into recurring revenue. */
  clientele: {
    avgTicket: 55,             // reference ticket for recurring visits
    visitRate: 0.28,           // a regular comes in ~every 3-4 weeks
    perSatisfiedCut: 1,
    perGreatCut: 3,
    lossPerBadCut: 4,
    weeklyChurn: 0.012,        // people move, switch barbers
    maxPerStation: 130         // a chair can only hold so many regulars
  },

  /* ---------- CUSTOMER FLOW ---------- */
  customers: {
    baseArrivalInterval: 5.5,  // seconds between arrivals at reputation 0
    minArrivalInterval: 2.0,
    repArrivalBonus: 0.03,     // each reputation point shortens the gap
    maxConcurrent: 4,          // matches all 4 rental chairs — every chair can fill
    patienceSeconds: 32,       // waiting customers eventually leave (was 22 before you had to walk over)
    walkSpeed: 17,             // world units per second
    // Arrivals ebb and flow instead of a flat drip — a "wave" temporarily
    // shortens the arrival interval, so the shop periodically fills all 4
    // chairs at once (which is also what populates the benches, see
    // World.updateBenchOccupancy).
    waveIntervalMin: 15,
    waveIntervalMax: 35,
    waveDurationMin: 6,
    waveDurationMax: 12,
    waveIntervalMultiplier: 0.45   // arrival interval is cut to this fraction during a wave
  },

  /* ---------- EXPENSES (weekly, before scaling) ---------- */
  expenses: {
    chairRental: 200,          // Level 1 only — renting someone else's chair
    supplies: 50,
    supplyPerCut: 4,
    marketingBase: 0,
    marketingStep: 150,        // each marketing tier costs this per week
    marketingMaxTier: 4
  },

  /* ---------- MARKETING ---------- */
  marketing: {
    trafficPerTier: 0.14,      // +14% customer arrival rate per tier
    followerPerTier: 0.10
  },

  /* ---------- REVENUE STREAMS ---------- */
  streams: {
    merchandise: {
      name: 'Merchandise',
      unlockRep: 30,
      unlockCash: 1500,
      setupCost: 800,
      baseWeekly: 240,
      perFollower: 0.018,      // followers drive merch sales
      costRate: 0.42,          // COGS as fraction of gross
      variance: 0.35
    },
    socialMedia: {
      name: 'Social Media',
      unlockRep: 22,
      unlockCash: 0,
      setupCost: 0,
      // Social revenue is genuinely uncertain — often zero.
      zeroChance: 0.42,
      revenuePerFollower: 0.0035,
      variance: 0.9,
      sponsorshipThreshold: 25000,   // followers needed for sponsor offers
      sponsorshipChance: 0.06,
      sponsorshipMin: 4000,
      sponsorshipMax: 26000,
      organicGrowth: 0.012,          // weekly compounding on existing base
      followersPerGoodCut: 45,
      followersPerViral: 9000
    },
    hairstyleTool: {
      name: 'Hair Tool License',
      unlockLevel: 2,
      lumpSum: 45000,
      weeklyRoyalty: 3200,
      royaltyDecay: 0.0015,          // royalties slowly erode
      // Declining the lump sum means a bigger royalty instead
      altWeeklyRoyalty: 7400,
      altLumpSum: 0
    },
    mobileBarber: {
      name: 'Mobile Operation',
      unlockLevel: 2,
      setupCost: 38000,
      baseWeekly: 9800,
      weeklyExpense: 4300,
      variance: 0.45,
      breakdownChance: 0.05,
      breakdownCost: 6500
    },
    // The vending machine fixture is always visible in the shop; this is
    // just when its sales start counting. Auto-unlocks (no setup
    // decision) once the player has enough cash on hand.
    vending: {
      name: 'Vending Machine',
      unlockCash: 5000,
      baseWeekly: 70,
      costRate: 0.4            // restock cost as a fraction of gross
    }
  },

  /* ---------- SECOND (CAMEO) BARBER ----------
     Shares the floor with the player: when a client sits down and asks for a
     style, this is the chance they become the cameo's rather than the
     player's, so the split lands around 65/35 in the player's favour. A
     client is only ever handed over when the cameo is free RIGHT NOW —
     otherwise they'd sit waiting out their patience and the walkout would
     cost the PLAYER reputation for a chair they were never offered.
     Still no economy effect: the cameo's cuts are set dressing, they don't
     earn. See World.npcCanTake / updateNpcBarber. */
  npcBarber: {
    workloadShare: 0.35,
    minIdleSeconds: 2,       // breather between clients, not a work rate
    maxIdleSeconds: 5
  },

  /* ---------- BREAKS ---------- */
  breaks: {
    charges: 4,                // total for the whole game, not per week
    durationSeconds: 60        // real-time pause while the scene plays
  },

  /* ---------- PROGRESSION ---------- */
  progression: {
    level2Cash: 42000,         // capital needed before first ownership offer
    level3Shops: 3,            // shops owned to unlock empire tier
    billionaire: 1e9
  },

  /* ---------- PROPERTY / SHOPS ---------- */
  property: {
    sizes: {
      small:  { key:'small',  name:'Small',  stations:2, basePrice:125000,  baseRevenue:6400,  baseExpense:3500 },
      medium: { key:'medium', name:'Medium', stations:4, basePrice:450000,  baseRevenue:22000, baseExpense:12000 },
      large:  { key:'large',  name:'Large',  stations:6, basePrice:1600000, baseRevenue:78000, baseExpense:42000 }
    },
    sizeOrder: ['small', 'medium', 'large'],

    // Market tier scales offers with the player's net worth so the
    // Monopoly-style trade-up ladder keeps climbing toward $1B.
    // Tier 0 holds until net worth passes 4× a small shop's base price,
    // so the first offer the player sees is one they can actually close.
    tierBaseMultiple: 4,
    tierPriceMultiplier: 2.35,       // price growth per market tier
    maxTier: 9,

    appreciationBase: 0.0032,        // ~0.32% per week baseline drift up
    appreciationVariance: 0.006,
    offerCooldownWeeks: 4,
    offerCashRatio: 0.55,            // must hold this fraction of asking price
    offerChance: 0.55,
    // Monopoly trade-up: 3 of a size unlocks consolidation into the next
    tradeUpCount: 3,
    tradeUpDiscount: 0.82            // trade-in credit toward the bigger shop
  },

  /* ---------- RANDOM EVENTS ---------- */
  events: {
    chancePerWeek: 0.30,
    minWeekBetween: 3,
    graceWeeks: 4                    // no events during the opening weeks
  },

  /* ---------- BALANCE GUARDRAILS ---------- */
  balance: {
    // Challenging, but never a random total wipeout (§20)
    maxSingleLossFraction: 0.28,     // one event can't take more than this
    bankruptcyFloor: -5000,          // below this triggers the failure path
    reputationDecay: 0.6             // reputation must be actively maintained
  },

  /* ---------- 3D SHOP ----------
     The shop is a 3D room now (src/shop3d.js), one per kind of shop: the rented chair, then the
     small, medium and large shops you buy. World (src/world.js) walks everyone around it in
     metres. */
  world3d: {
    walkSpeed: 1.5,            // customers, m/s (brisk: walking in costs chair time the 2D game never had)
    barberSpeed: 1.6,          // the barbers are quicker on their feet
    barberBrisk: 2.4,          // Shift
    benchPatience: 45,         // seconds a client will wait on the bench for a chair
    sitBlend: 0.45,            // seconds to settle into / rise out of a chair
  }
};

/* The street vendor (user, 2026-10-16): walks in now and then with a tray, pitches the clients
   and the other barber (they buy now and then: set dressing, plus a little patience for a client
   who buys a snack), then hangs about at the front. YOU can walk up and buy from him (E / BUY). */
CONFIG.vendor = {
  name: 'Tez',
  everyMin: 70, everyMax: 140,   // seconds between visits
  firstAfter: 40,                // the first visit of a session
  linger: 30,                    // seconds he waits at the front for you before moving on
  npcBuyChance: 0.5,
  snackPatience: 12,             // seconds of patience a client gains from buying a snack
  // What the clients and the other barber buy from him (flavour only)
  npcGoods: [['Ice-cold water', 2], ['Earbuds', 15], ['Incense', 5], ['Phone charger', 10], ['Chips', 3], ['Shea butter', 8], ['Fitted cap', 25]],
  // What YOU can buy
  items: [
    { key: 'towels',   name: 'Hot Towel Pack', price: 180, desc: '+1 reputation on each of your next 10 cuts' },
    { key: 'clippers', name: 'Pro Clippers',   price: 650, desc: 'Your cuts are 15% quicker, for good', once: true },
    { key: 'flyers',   name: 'Street Flyers',  price: 120, desc: 'A rush of walk-ins, right now' },
    { key: 'watch',    name: 'Mystery Watch',  price: 90,  desc: '30% chance it\'s real: resells for $400' }
  ]
};

/* How many chairs each kind of shop has. Only the COUNT is read outside the 3D room (Economy's
   clientele capacity); where the chairs stand is up to src/shop3d.js. The large shop finally has
   the 6 its property card promises: the old photo only had room for 4. */
CONFIG.stationLayouts = {
  rental: [0, 1, 2, 3],
  small:  [0, 1],
  medium: [0, 1, 2, 3],
  large:  [0, 1, 2, 3, 4, 5]
};
