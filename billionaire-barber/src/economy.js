/* =============================================================
   BILLIONAIRE BARBER — ECONOMY / EVENT / PROPERTY SYSTEMS
   The simulation core. Cash accrues continuously across the
   30-second week; the weekly transition reconciles rather than
   suddenly awarding money.
   ============================================================= */

const Economy = (function () {

  /* -----------------------------------------------------------
     LEDGER HELPERS
     ----------------------------------------------------------- */
  function addRevenue(category, amount) {
    if (!amount) return;
    gameState.cash += amount;
    gameState.weeklyRevenue += amount;
    gameState.totals.revenueEarned += amount;
    gameState.ledger.revenue[category] = (gameState.ledger.revenue[category] || 0) + amount;
  }

  function addExpense(category, amount) {
    if (!amount) return;
    gameState.cash -= amount;
    gameState.weeklyExpenses += amount;
    gameState.totals.expensesPaid += amount;
    gameState.ledger.expenses[category] = (gameState.ledger.expenses[category] || 0) + amount;
  }

  /* -----------------------------------------------------------
     WEEKLY PROJECTIONS
     These drive both the HUD readout and the per-second accrual.
     ----------------------------------------------------------- */
  /* Recurring haircut revenue from the clientele the player has built.
     This is the difference between having a job and having a business. */
  function clienteleRevenue() {
    const s = gameState;
    const cfg = CONFIG.clientele;
    const repPricing = 1 + (s.barber.reputation / 100) * 0.55;
    const ticket = cfg.avgTicket * repPricing * s.business.priceModifier;
    return s.barber.clientele * ticket * cfg.visitRate *
           eventModifier('traffic') * eventModifier('revenue');
  }

  function maxClientele() {
    const stations = currentStations().length;
    const shopStations = gameState.properties.reduce(function (n, p) {
      return n + CONFIG.property.sizes[p.size].stations;
    }, 0);
    return (stations + shopStations) * CONFIG.clientele.maxPerStation;
  }

  function projectedPassiveRevenue() {
    const s = gameState;
    const revMod = eventModifier('revenue');
    let total = clienteleRevenue();

    if (s.revenueStreams.merchandise) {
      const m = CONFIG.streams.merchandise;
      const gross = m.baseWeekly + s.social.followers * m.perFollower;
      total += gross * (1 - m.costRate) * revMod;
    }

    if (s.revenueStreams.hairstyleTool) {
      total += s.streamData.toolRoyalty;
    }

    if (s.revenueStreams.mobileBarber) {
      const mb = CONFIG.streams.mobileBarber;
      total += (mb.baseWeekly - mb.weeklyExpense) * s.streamData.mobileUnits * revMod;
    }

    if (s.revenueStreams.vending) {
      const v = CONFIG.streams.vending;
      total += v.baseWeekly * (1 - v.costRate) * revMod;
    }

    // Owned shops run themselves — this is how the empire scales
    for (const p of s.properties) {
      total += shopNetWeekly(p) * revMod;
    }

    return total;
  }

  function shopNetWeekly(p) {
    const def = CONFIG.property.sizes[p.size];
    const scale = Math.pow(CONFIG.property.tierPriceMultiplier, p.tier);
    return (def.baseRevenue - def.baseExpense) * scale * (p.health || 1);
  }

  function shopGrossWeekly(p) {
    const def = CONFIG.property.sizes[p.size];
    const scale = Math.pow(CONFIG.property.tierPriceMultiplier, p.tier);
    return def.baseRevenue * scale * (p.health || 1);
  }

  function projectedExpenses() {
    const s = gameState;
    let total = 0;

    if (s.business.shopType === 'rental') total += CONFIG.expenses.chairRental;
    total += CONFIG.expenses.supplies;
    total += s.business.marketingTier * CONFIG.expenses.marketingStep;

    // Property operating costs are folded into shopNetWeekly, so only the
    // player's own operation is counted here.
    return total * eventModifier('expenses');
  }

  /* -----------------------------------------------------------
     CONTINUOUS ACCRUAL (§9)
     ----------------------------------------------------------- */
  function tick(dt) {
    const perSecRevenue = projectedPassiveRevenue() / CONFIG.time.secondsPerWeek;
    const perSecExpense = projectedExpenses() / CONFIG.time.secondsPerWeek;

    if (perSecRevenue !== 0) {
      const amt = perSecRevenue * dt;
      gameState.cash += amt;
      gameState.weeklyRevenue += amt;
      gameState.totals.revenueEarned += amt;
      gameState.ledger.revenue['Operations'] = (gameState.ledger.revenue['Operations'] || 0) + amt;
    }
    if (perSecExpense !== 0) {
      const amt = perSecExpense * dt;
      gameState.cash -= amt;
      gameState.weeklyExpenses += amt;
      gameState.totals.expensesPaid += amt;
      gameState.ledger.expenses['Operating'] = (gameState.ledger.expenses['Operating'] || 0) + amt;
    }

    gameState.netWorth = computeNetWorth();
  }

  /* -----------------------------------------------------------
     SERVICE OUTCOME — the core decision resolves here
     ----------------------------------------------------------- */
  function serviceCustomer(c, chosenKey) {
    const requested = CONFIG.styles[c.requested];
    const chosen = CONFIG.styles[chosenKey];
    const cfg = CONFIG.service;
    const rep = gameState.barber.reputation;

    // Base satisfaction from the style quality itself
    let satisfaction = 45 + chosen.satisfaction * 4;

    // Compare by PRICE rank, not menu position — cutting a pricier
    // style than asked is the upsell gamble regardless of display order.
    const reqIdx = requested.rank;
    const cutIdx = chosen.rank;
    let outcomeKind;

    if (reqIdx === cutIdx) {
      satisfaction += cfg.matchBonus;
      outcomeKind = 'match';
    } else {
      // Reputation mitigates the gamble — skill sells the upgrade
      const mitigation = 1 - (rep / 100) * cfg.repMitigation;
      const penalty = cutIdx > reqIdx ? cfg.upsellPenalty : cfg.downsellPenalty;
      satisfaction += penalty * mitigation * Math.abs(cutIdx - reqIdx);
      outcomeKind = cutIdx > reqIdx ? 'upsell' : 'downsell';
    }

    // Regulars are more forgiving
    if (c.isRegular) satisfaction += 8;
    satisfaction += rand(-9, 9);
    satisfaction = clamp(satisfaction, 0, 100);

    // ---- Money ----
    const repPricing = 1 + (rep / 100) * 0.55;
    let ticket = chosen.price * repPricing * gameState.business.priceModifier;
    ticket *= eventModifier('revenue');

    let tip = 0;
    if (satisfaction >= cfg.tipThreshold) tip = ticket * cfg.tipRate * rand(0.6, 1.5);

    const supplyCost = CONFIG.expenses.supplyPerCut;

    addRevenue('Haircuts', ticket);
    if (tip) addRevenue('Tips', tip);
    addExpense('Supplies', supplyCost);

    // ---- Reputation & clientele ----
    let repDelta;
    if (satisfaction >= 75)      repDelta = chosen.repGain;
    else if (satisfaction >= 55) repDelta = chosen.repGain * 0.35;
    else if (satisfaction >= 35) repDelta = -0.8;
    else                         repDelta = -2.6;
    adjustReputation(repDelta);

    // ---- Clientele: word of mouth compounds, bad cuts cost you ----
    const cc = CONFIG.clientele;
    const cap = maxClientele();
    if (satisfaction >= 78) {
      gameState.barber.clientele += cc.perGreatCut;
    } else if (satisfaction >= cfg.repeatThreshold) {
      gameState.barber.clientele += cc.perSatisfiedCut;
    } else if (satisfaction < cfg.walkoutThreshold) {
      gameState.barber.clientele -= cc.lossPerBadCut;
    }
    gameState.barber.clientele = clamp(gameState.barber.clientele, 0, cap);

    if (satisfaction >= cfg.repeatThreshold && chance(cfg.repeatChance)) {
      if (gameState.barber.regulars.indexOf(c.key) === -1) {
        gameState.barber.regulars.push(c.key);
      }
    } else if (satisfaction < cfg.walkoutThreshold) {
      const idx = gameState.barber.regulars.indexOf(c.key);
      if (idx !== -1) gameState.barber.regulars.splice(idx, 1);
    }

    // ---- Social media ----
    let wentViral = false;
    if (gameState.revenueStreams.socialMedia) {
      if (satisfaction >= 70) {
        gameState.social.followers += Math.round(
          CONFIG.streams.socialMedia.followersPerGoodCut * rand(0.5, 1.8) * (1 + rep / 120)
        );
      }
      const viralRoll = chosen.viralChance * (satisfaction / 100) * (1 + rep / 90);
      if (chance(viralRoll)) {
        wentViral = true;
        gameState.totals.viralMoments++;
        gameState.social.followers += Math.round(
          CONFIG.streams.socialMedia.followersPerViral * rand(0.4, 1.9)
        );
      }
    }

    gameState.totals.cutsPerformed++;
    gameState.totals.customersServed++;

    return {
      satisfaction, ticket, tip, outcomeKind, wentViral,
      feedback: feedbackFor(satisfaction, outcomeKind),
      tone: satisfaction >= 70 ? 'good' : (satisfaction >= 45 ? 'neutral' : 'bad')
    };
  }

  const FEEDBACK = {
    good: [
      '🔥 This is exactly what I wanted.',
      "I'm definitely coming back.",
      'You need to charge more.',
      'Best cut I\'ve had in years.',
      'Putting this on my story right now.'
    ],
    neutral: [
      'Not bad.',
      'Pretty good.',
      "I'll think about coming back.",
      'It\'ll grow on me.',
      'Yeah… that works.'
    ],
    bad: [
      "This isn't what I asked for.",
      "I'm disappointed.",
      "I'm not coming back.",
      'You weren\'t listening to me.',
      'I\'ll fix it myself at home.'
    ]
  };

  function feedbackFor(sat, kind) {
    if (sat >= 70) return pick(FEEDBACK.good);
    if (sat >= 45) return pick(FEEDBACK.neutral);
    if (kind === 'upsell') return pick(["That's not what I asked for.", "I said something simpler."]);
    return pick(FEEDBACK.bad);
  }

  function customerWalkedOut(c) {
    adjustReputation(-1.8);
    UI.toast(c.name + ' got tired of waiting and left', 'bad');
    World.reactBarber('bad');
  }

  /* -----------------------------------------------------------
     WEEKLY SETTLEMENT
     ----------------------------------------------------------- */
  function completeWeek() {
    const s = gameState;

    // --- Social media: genuinely uncertain, resolved once per week ---
    if (s.revenueStreams.socialMedia) {
      const sm = CONFIG.streams.socialMedia;
      s.social.followers = Math.round(s.social.followers * (1 + sm.organicGrowth));
      if (!chance(sm.zeroChance)) {
        const gross = s.social.followers * sm.revenuePerFollower * rand(1 - sm.variance, 1 + sm.variance);
        if (gross > 1) addRevenue('Social Media', gross);
      }
      if (s.social.followers >= sm.sponsorshipThreshold && chance(sm.sponsorshipChance)) {
        Messages.sponsorshipOffer();
      }
    }

    // --- Hair tool royalties erode slowly ---
    if (s.revenueStreams.hairstyleTool) {
      s.streamData.toolRoyalty *= (1 - CONFIG.streams.hairstyleTool.royaltyDecay);
    }

    // --- Mobile operation risk ---
    if (s.revenueStreams.mobileBarber && chance(CONFIG.streams.mobileBarber.breakdownChance)) {
      const cost = CONFIG.streams.mobileBarber.breakdownCost * s.streamData.mobileUnits;
      addExpense('Van Repair', cost);
      UI.toast('Mobile van breakdown — ' + money(cost) + ' repair', 'bad');
    }

    // --- Property appreciation (mostly up, not always) ---
    updatePropertyValues();

    // --- Reputation drifts toward the mean if untended ---
    const rep = s.barber.reputation;
    if (rep > 40) adjustReputation(-CONFIG.balance.reputationDecay);

    // --- Clientele churn: a book of business needs maintaining ---
    s.barber.clientele = Math.max(0,
      Math.round(s.barber.clientele * (1 - CONFIG.clientele.weeklyChurn)));

    // --- Tick down active events ---
    s.activeEvents = s.activeEvents.filter(ev => {
      ev.weeksLeft--;
      if (ev.weeksLeft <= 0) {
        UI.toast(ev.name + ' has passed', 'neutral');
        return false;
      }
      return true;
    });

    // --- Snapshot the settlement for the transition screen ---
    const settlement = {
      week: s.week,
      revenue: s.weeklyRevenue,
      expenses: s.weeklyExpenses,
      profit: s.weeklyRevenue - s.weeklyExpenses,
      ledger: JSON.parse(JSON.stringify(s.ledger)),
      cash: s.cash
    };
    s.lastSettlement = settlement;
    s.history.push({
      week: s.week,
      cash: s.cash,
      netWorth: computeNetWorth(),
      profit: settlement.profit
    });
    if (s.history.length > 200) s.history.shift();

    // --- Roll into the new week ---
    s.week++;
    s.weeklyRevenue = 0;
    s.weeklyExpenses = 0;
    s.ledger = { revenue: {}, expenses: {} };
    s.netWorth = computeNetWorth();

    // --- Post-settlement checks ---
    rollEvent();
    checkStreamUnlocks();
    checkProgression();
    checkPropertyOffer();
    checkBillionaire();
    checkFailure();

    saveGame(true);
    return settlement;
  }

  /* -----------------------------------------------------------
     PROPERTY SYSTEM
     ----------------------------------------------------------- */
  function marketTier() {
    const nw = Math.max(1, computeNetWorth());
    const base = CONFIG.property.sizes.small.basePrice * CONFIG.property.tierBaseMultiple;
    const t = Math.floor(Math.log(nw / base) / Math.log(CONFIG.property.tierPriceMultiplier)) + 1;
    return clamp(t, 0, CONFIG.property.maxTier);
  }

  function priceFor(size, tier) {
    return Math.round(
      CONFIG.property.sizes[size].basePrice *
      Math.pow(CONFIG.property.tierPriceMultiplier, tier)
    );
  }

  function updatePropertyValues() {
    const cfg = CONFIG.property;
    const valueMod = eventModifier('propertyValue');
    for (const p of gameState.properties) {
      const drift = cfg.appreciationBase + rand(-cfg.appreciationVariance, cfg.appreciationVariance);
      p.value = Math.max(p.value * 0.35, p.value * (1 + drift) * valueMod);
      p.value = Math.round(p.value);
    }
  }

  const DISTRICTS = [
    'Downtown', 'Riverside', 'Northgate', 'The Heights', 'Old Mill',
    'Southside', 'Lakeview', 'Union Square', 'Eastbank', 'Grand Avenue',
    'Harbor District', 'Midtown'
  ];

  function generateOffer() {
    const tier = marketTier();
    const owned = gameState.properties.length;

    // Weight toward sizes the player can plausibly afford
    let sizePool = ['small'];
    if (owned >= 1) sizePool.push('small', 'medium');
    if (owned >= 3) sizePool.push('medium', 'medium', 'large');
    if (owned >= 6) sizePool = ['medium', 'large', 'large'];

    const size = pick(sizePool);
    const def = CONFIG.property.sizes[size];
    const base = priceFor(size, tier);
    const price = Math.round(base * rand(0.86, 1.18));
    const scale = Math.pow(CONFIG.property.tierPriceMultiplier, tier);

    return {
      id: 'p' + Date.now(),
      size: size,
      tier: tier,
      name: pick(DISTRICTS) + ' ' + (size === 'large' ? 'Flagship' : 'Barbershop'),
      price: price,
      value: Math.round(price * rand(0.96, 1.14)),
      weeklyRevenue: Math.round(def.baseRevenue * scale * rand(0.88, 1.14)),
      weeklyExpense: Math.round(def.baseExpense * scale * rand(0.9, 1.1)),
      stations: def.stations
    };
  }

  function checkPropertyOffer() {
    const s = gameState;
    if (s.business.level < 2 && s.cash < CONFIG.progression.level2Cash) return;
    if (s.week - s.lastOfferWeek < CONFIG.property.offerCooldownWeeks) return;

    const offer = generateOffer();
    if (s.cash < offer.price * CONFIG.property.offerCashRatio) return;
    if (!chance(CONFIG.property.offerChance)) return;

    s.lastOfferWeek = s.week;
    Messages.realtorOffer(offer);
  }

  function buyProperty(offer) {
    if (gameState.cash < offer.price) {
      UI.toast('Not enough cash to close', 'bad');
      return false;
    }
    gameState.cash -= offer.price;
    gameState.properties.push({
      id: offer.id,
      size: offer.size,
      tier: offer.tier,
      name: offer.name,
      purchasePrice: offer.price,
      value: offer.value,
      health: 1,
      week: gameState.week
    });
    gameState.totals.propertiesBought++;

    // First purchase graduates the player out of renting a chair
    if (gameState.business.shopType === 'rental') {
      gameState.business.shopType = 'owned';
      gameState.business.shopSize = offer.size;
      gameState.business.level = Math.max(gameState.business.level, 2);
      World.rebuild();
      UI.milestone('PROPERTY ACQUIRED', 'You own your shop', 'You cut on your own floor now.');
    } else {
      UI.milestone('PROPERTY ACQUIRED', offer.name, offer.size.toUpperCase() + ' · ' + money(offer.price, {compact:true}));
      // Move the player into the largest shop they own
      upgradeHomeShop();
    }

    gameState.netWorth = computeNetWorth();
    checkProgression();
    checkTradeUp();
    saveGame(true);
    return true;
  }

  /* The player physically works out of their biggest shop. */
  function upgradeHomeShop() {
    const order = CONFIG.property.sizeOrder;
    let best = gameState.business.shopSize || 'small';
    for (const p of gameState.properties) {
      if (order.indexOf(p.size) > order.indexOf(best)) best = p.size;
    }
    if (best !== gameState.business.shopSize) {
      gameState.business.shopSize = best;
      World.rebuild();
    }
  }

  /* Monopoly-style consolidation: 3 of a size trades up to the next. */
  function checkTradeUp() {
    const cfg = CONFIG.property;
    const order = cfg.sizeOrder;
    for (let i = 0; i < order.length - 1; i++) {
      const size = order[i];
      const held = gameState.properties.filter(p => p.size === size);
      if (held.length >= cfg.tradeUpCount) {
        const nextSize = order[i + 1];
        const tier = marketTier();
        const credit = held.slice(0, cfg.tradeUpCount)
                           .reduce((sum, p) => sum + p.value, 0) * cfg.tradeUpDiscount;
        const target = priceFor(nextSize, tier);
        const difference = Math.max(0, Math.round(target - credit));
        Messages.tradeUpOffer({
          fromSize: size,
          toSize: nextSize,
          tier: tier,
          credit: Math.round(credit),
          target: target,
          difference: difference,
          ids: held.slice(0, cfg.tradeUpCount).map(p => p.id)
        });
        return;
      }
    }
  }

  function executeTradeUp(deal) {
    if (gameState.cash < deal.difference) {
      UI.toast('Not enough cash to cover the difference', 'bad');
      return false;
    }
    gameState.cash -= deal.difference;
    gameState.properties = gameState.properties.filter(p => deal.ids.indexOf(p.id) === -1);
    const def = CONFIG.property.sizes[deal.toSize];
    const scale = Math.pow(CONFIG.property.tierPriceMultiplier, deal.tier);
    gameState.properties.push({
      id: 'p' + Date.now(),
      size: deal.toSize,
      tier: deal.tier,
      name: pick(DISTRICTS) + ' ' + (deal.toSize === 'large' ? 'Flagship' : 'Barbershop'),
      purchasePrice: deal.target,
      value: Math.round(deal.target * rand(1.0, 1.12)),
      health: 1,
      week: gameState.week
    });
    void scale;
    upgradeHomeShop();
    gameState.netWorth = computeNetWorth();
    UI.milestone('PORTFOLIO CONSOLIDATED', deal.toSize.toUpperCase() + ' SHOP', 'Three traded for one bigger.');
    checkProgression();
    saveGame(true);
    return true;
  }

  /* -----------------------------------------------------------
     PROGRESSION
     ----------------------------------------------------------- */
  function checkProgression() {
    const s = gameState;
    const prev = s.business.level;

    if (s.properties.length >= CONFIG.progression.level3Shops) s.business.level = 3;
    else if (s.properties.length >= 1) s.business.level = Math.max(s.business.level, 2);

    if (s.business.level > prev) {
      if (s.business.level === 2) {
        UI.milestone('LEVEL 2', 'FIRST BUSINESS', 'You own your operation.');
      } else if (s.business.level === 3) {
        UI.milestone('EMPIRE MILESTONE', CONFIG.progression.level3Shops + ' SHOPS OWNED',
                     'All revenue streams unlocked.');
      }
      checkStreamUnlocks();
    }
  }

  function checkStreamUnlocks() {
    const s = gameState;
    const st = CONFIG.streams;

    // Each offer fires once. Declining re-arms it after a cooling-off
    // period so a wrong early call is never permanent.
    if (!s.revenueStreams.socialMedia &&
        s.barber.reputation >= st.socialMedia.unlockRep &&
        s.week >= (s.flags.socialOfferedWeek || 0)) {
      s.flags.socialOfferedWeek = s.week + 12;
      Messages.socialUnlock();
    }
    if (!s.revenueStreams.merchandise &&
        s.barber.reputation >= st.merchandise.unlockRep &&
        s.cash >= st.merchandise.setupCost &&
        s.week >= (s.flags.merchOfferedWeek || 0)) {
      s.flags.merchOfferedWeek = s.week + 12;
      Messages.merchOffer();
    }
    if (s.business.level >= st.hairstyleTool.unlockLevel &&
        !s.revenueStreams.hairstyleTool && !s.flags.toolOffered) {
      s.flags.toolOffered = true;
      Messages.toolOffer();
    }
    if (s.business.level >= st.mobileBarber.unlockLevel &&
        !s.revenueStreams.mobileBarber && !s.flags.mobileOffered &&
        s.cash >= st.mobileBarber.setupCost) {
      s.flags.mobileOffered = true;
      Messages.mobileOffer();
    }
    // Vending is a fixture from day one — no setup decision, just a cash
    // threshold before its sales start counting.
    if (!s.revenueStreams.vending && s.cash >= st.vending.unlockCash) {
      s.revenueStreams.vending = true;
      World.refreshShopDressing();
      UI.milestone('NEW REVENUE STREAM', 'VENDING MACHINE', 'Snacks and drinks sell themselves.');
    }
  }

  function checkBillionaire() {
    if (gameState.flags.billionaire) return;
    if (computeNetWorth() >= CONFIG.progression.billionaire) {
      gameState.flags.billionaire = true;
      UI.showEndgame();
    }
  }

  function checkFailure() {
    if (gameState.cash < CONFIG.balance.bankruptcyFloor) {
      UI.showFailure();
    }
  }

  /* -----------------------------------------------------------
     RANDOM EVENT SYSTEM
     Events alter real variables, not just text (§18).
     ----------------------------------------------------------- */
  const EVENTS = [
    {
      key: 'pandemic', name: 'Pandemic', type: 'bad', weight: 5, weeks: 6,
      text: 'A health emergency has shut down foot traffic across the city.',
      modifiers: { traffic: 0.35, revenue: 0.55, propertyValue: 0.985 }
    },
    {
      key: 'crime', name: 'Crime Wave', type: 'bad', weight: 8, weeks: 4,
      text: 'Break-ins are up in the neighborhood. Clients are staying home after dark.',
      modifiers: { traffic: 0.72, propertyValue: 0.972 }
    },
    {
      key: 'recession', name: 'Economic Downturn', type: 'bad', weight: 7, weeks: 5,
      text: 'A downturn is squeezing discretionary spending everywhere.',
      modifiers: { revenue: 0.7, propertyValue: 0.98 }
    },
    {
      key: 'employer_left', name: 'Major Employer Leaves', type: 'bad', weight: 4, weeks: 8,
      text: 'The plant closed. Thousands of jobs left the area with it.',
      modifiers: { traffic: 0.68, propertyValue: 0.965 }
    },
    {
      key: 'infrastructure', name: 'Road Construction', type: 'bad', weight: 7, weeks: 3,
      text: 'The street outside is torn up. Nobody can park.',
      modifiers: { traffic: 0.6 }
    },
    {
      key: 'supply_spike', name: 'Supply Cost Spike', type: 'bad', weight: 6, weeks: 4,
      text: 'Distributors raised prices on everything from blades to shampoo.',
      modifiers: { expenses: 1.45 }
    },
    {
      key: 'viral', name: 'Viral Haircut', type: 'good', weight: 8, weeks: 3,
      text: 'A cut you did is racing around the internet.',
      modifiers: { traffic: 1.65, revenue: 1.25 },
      onStart: function () {
        const gain = Math.round(rand(6000, 30000));
        gameState.social.followers += gain;
        gameState.totals.viralMoments++;
        adjustReputation(6);
        return '+' + compactNum(gain) + ' followers';
      }
    },
    {
      key: 'development', name: 'Neighborhood Development', type: 'good', weight: 7, weeks: 6,
      text: 'New builds and new money are moving into the district.',
      modifiers: { traffic: 1.3, propertyValue: 1.022 }
    },
    {
      key: 'celebrity', name: 'Celebrity Walk-In', type: 'good', weight: 5, weeks: 2,
      text: 'Somebody famous sat in your chair and posted about it.',
      modifiers: { traffic: 1.45 },
      onStart: function () {
        const fee = Math.round(rand(2500, 14000) * (1 + gameState.business.level));
        addRevenue('Celebrity Fee', fee);
        adjustReputation(5);
        return money(fee) + ' one-time fee';
      }
    },
    {
      key: 'boom', name: 'Population Growth', type: 'good', weight: 6, weeks: 7,
      text: 'The area is growing fast. More people means more heads.',
      modifiers: { traffic: 1.28, propertyValue: 1.018 }
    },
    {
      key: 'competitor', name: 'Competitor Opens Nearby', type: 'neutral', weight: 8, weeks: 5,
      text: 'A new shop opened two blocks over. They are advertising hard.',
      modifiers: { traffic: 0.8 }
    },
    {
      key: 'influencer', name: 'Influencer Collab', type: 'neutral', weight: 5, weeks: 3,
      text: 'A local influencer wants to film in your shop.',
      modifiers: { traffic: 1.15 },
      condition: function () { return gameState.revenueStreams.socialMedia; },
      onStart: function () {
        const gain = Math.round(rand(1200, 9000));
        gameState.social.followers += gain;
        return '+' + compactNum(gain) + ' followers';
      }
    },
    {
      key: 'inspection', name: 'Health Inspection', type: 'bad', weight: 6, weeks: 1,
      text: 'The inspector found violations. Fines are due immediately.',
      modifiers: {},
      onStart: function () {
        const fine = Math.min(
          Math.round(rand(400, 2200) * (1 + gameState.properties.length)),
          Math.max(200, Math.abs(gameState.cash) * CONFIG.balance.maxSingleLossFraction)
        );
        addExpense('Fines', fine);
        return money(fine) + ' fine';
      }
    },
    {
      key: 'new_management', name: 'New Management', type: 'bad', weight: 6, weeks: 4,
      text: 'The building sold. New ownership wants to repurpose your floor.',
      modifiers: { expenses: 1.9 },
      // Only bites the player while they are renting someone else's chair
      condition: function () { return gameState.business.shopType === 'rental'; },
      onStart: function () {
        gameState.flags.evicted = true;
        return 'Chair rent nearly doubled';
      }
    }
  ];

  function rollEvent() {
    const s = gameState;
    if (s.week <= CONFIG.events.graceWeeks) return;
    if (s.week - s.lastEventWeek < CONFIG.events.minWeekBetween) return;
    if (!chance(CONFIG.events.chancePerWeek)) return;

    const pool = EVENTS.filter(e =>
      (!e.condition || e.condition()) &&
      !s.activeEvents.some(a => a.key === e.key)
    );
    if (!pool.length) return;

    const totalWeight = pool.reduce((sum, e) => sum + e.weight, 0);
    let roll = Math.random() * totalWeight;
    let chosen = pool[0];
    for (const e of pool) {
      roll -= e.weight;
      if (roll <= 0) { chosen = e; break; }
    }

    s.lastEventWeek = s.week;
    s.totals.eventsEncountered++;

    let note = '';
    if (chosen.onStart) note = chosen.onStart() || '';

    if (chosen.weeks > 0 && Object.keys(chosen.modifiers).length) {
      s.activeEvents.push({
        key: chosen.key,
        name: chosen.name,
        type: chosen.type,
        weeksLeft: chosen.weeks,
        modifiers: chosen.modifiers
      });
    }
    s.eventHistory.push({ key: chosen.key, name: chosen.name, week: s.week });

    UI.showEvent(chosen, note);
  }

  /* -----------------------------------------------------------
     PLAYER DECISIONS
     ----------------------------------------------------------- */
  function setMarketing(tier) {
    gameState.business.marketingTier = clamp(tier, 0, CONFIG.expenses.marketingMaxTier);
  }

  function setPriceModifier(mod) {
    gameState.business.priceModifier = clamp(mod, 0.7, 1.6);
    // Pricing above market costs you traffic — the tradeoff has to bite
    const over = Math.max(0, gameState.business.priceModifier - 1);
    adjustReputation(-over * 1.5);
  }

  function acceptMerch() {
    const m = CONFIG.streams.merchandise;
    if (gameState.cash < m.setupCost) { UI.toast('Not enough cash', 'bad'); return false; }
    gameState.cash -= m.setupCost;
    gameState.revenueStreams.merchandise = true;
    World.refreshShopDressing();
    UI.milestone('NEW REVENUE STREAM', 'MERCHANDISE', 'Branded product on the shelf.');
    return true;
  }

  function acceptSocial() {
    gameState.revenueStreams.socialMedia = true;
    gameState.social.followers = Math.max(gameState.social.followers, 250);
    UI.milestone('NEW REVENUE STREAM', 'SOCIAL MEDIA', 'The algorithm is watching.');
  }

  function acceptTool(takeLump) {
    const t = CONFIG.streams.hairstyleTool;
    gameState.revenueStreams.hairstyleTool = true;
    if (takeLump) {
      addRevenue('Tool License', t.lumpSum);
      gameState.streamData.toolRoyalty = t.weeklyRoyalty;
    } else {
      gameState.streamData.toolRoyalty = t.altWeeklyRoyalty;
    }
    UI.milestone('NEW REVENUE STREAM', 'HAIR TOOL LICENSE',
                 takeLump ? money(t.lumpSum) + ' up front' : money(t.altWeeklyRoyalty) + ' / week');
  }

  function acceptMobile() {
    const mb = CONFIG.streams.mobileBarber;
    if (gameState.cash < mb.setupCost) { UI.toast('Not enough cash', 'bad'); return false; }
    gameState.cash -= mb.setupCost;
    gameState.revenueStreams.mobileBarber = true;
    gameState.streamData.mobileUnits = Math.max(1, gameState.streamData.mobileUnits);
    UI.milestone('NEW REVENUE STREAM', 'MOBILE BARBER', 'The shop comes to them.');
    return true;
  }

  function expandMobile() {
    const mb = CONFIG.streams.mobileBarber;
    const cost = mb.setupCost * (1 + gameState.streamData.mobileUnits * 0.4);
    if (gameState.cash < cost) { UI.toast('Not enough cash to expand', 'bad'); return false; }
    gameState.cash -= cost;
    gameState.streamData.mobileUnits++;
    UI.toast('Mobile fleet expanded to ' + gameState.streamData.mobileUnits + ' vans', 'good');
    return true;
  }

  function acceptSponsorship(amount) {
    addRevenue('Sponsorship', amount);
    adjustReputation(2);
  }

  return {
    tick, completeWeek, serviceCustomer, customerWalkedOut,
    addRevenue, addExpense,
    projectedPassiveRevenue, projectedExpenses,
    shopNetWeekly, shopGrossWeekly,
    buyProperty, executeTradeUp, generateOffer, marketTier, priceFor,
    setMarketing, setPriceModifier,
    acceptMerch, acceptSocial, acceptTool, acceptMobile, expandMobile, acceptSponsorship,
    checkStreamUnlocks, checkProgression
  };
})();
