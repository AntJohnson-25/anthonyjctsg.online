/* =============================================================
   BILLIONAIRE BARBER — UI SYSTEM
   HUD, animated counters, style picker, weekly settlement,
   milestones, event cards, panels and endgame.
   ============================================================= */

const UI = (function () {

  const el = {};
  let displayedCash = 0;
  let cashVelocity = 0;
  let activePickerCustomer = null;

  function init() {
    [
      'hud', 'hud-cash', 'hud-week', 'hud-networth', 'hud-revenue', 'hud-expenses',
      'hud-profit', 'hud-rep-bar', 'hud-rep-val', 'hud-followers', 'hud-properties',
      'hud-level', 'week-progress', 'toasts', 'style-picker', 'style-cards',
      'style-request', 'cut-progress', 'milestone', 'event-card', 'settlement',
      'floaters', 'panel-business', 'panel-portfolio', 'endgame', 'failure',
      'active-events', 'stream-list', 'btn-break', 'break-count'
    ].forEach(function (id) {
      el[id] = document.getElementById(id);
    });

    displayedCash = gameState ? gameState.cash : 0;
    bindControls();
  }

  /* -----------------------------------------------------------
     HUD
     ----------------------------------------------------------- */
  function updateHUD(dt) {
    const s = gameState;
    if (!s) return;

    // Smoothly chase the true cash value so the counter always reads as alive
    const diff = s.cash - displayedCash;
    if (Math.abs(diff) < 0.5) {
      displayedCash = s.cash;
    } else {
      displayedCash += diff * Math.min(1, dt * 7);
    }
    cashVelocity = diff;

    el['hud-cash'].textContent = money(displayedCash, { compact: Math.abs(s.cash) >= 1e6 });
    el['hud-cash'].classList.toggle('rising', cashVelocity > 1);
    el['hud-cash'].classList.toggle('falling', cashVelocity < -1);
    el['hud-cash'].classList.toggle('negative', s.cash < 0);

    const year = Math.floor((s.week - 1) / CONFIG.time.weeksPerYear) + 1;
    const wk = ((s.week - 1) % CONFIG.time.weeksPerYear) + 1;
    el['hud-week'].textContent = 'WK ' + wk;
    el['hud-week'].dataset.year = 'YR ' + year;

    const nw = computeNetWorth();
    el['hud-networth'].textContent = money(nw, { compact: true });

    const passive = Economy.projectedPassiveRevenue();
    const expenses = Economy.projectedExpenses();
    // Project this week's total by extrapolating what has already accrued
    const cutsSoFar = s.ledger.revenue['Haircuts'] || 0;
    const projRevenue = passive + cutsSoFar / Math.max(0.15, s.weekProgress);
    const profit = projRevenue - expenses;

    el['hud-revenue'].textContent = money(projRevenue, { compact: true });
    el['hud-expenses'].textContent = money(expenses, { compact: true });
    el['hud-profit'].textContent = money(profit, { compact: true, sign: true });
    el['hud-profit'].className = 'stat-value ' + (profit >= 0 ? 'good' : 'bad');

    const rep = Math.round(s.barber.reputation);
    el['hud-rep-bar'].style.width = rep + '%';
    el['hud-rep-val'].textContent = rep;

    el['hud-followers'].textContent = compactNum(s.social.followers);
    el['hud-properties'].textContent = String(s.properties.length);
    el['hud-level'].textContent = 'LVL ' + s.business.level;

    el['break-count'].textContent = String(s.breaksLeft);
    el['btn-break'].disabled = s.breaksLeft <= 0;

    el['week-progress'].style.width = (s.weekProgress * 100).toFixed(1) + '%';

    renderActiveEvents();
  }

  function renderActiveEvents() {
    const box = el['active-events'];
    const evs = gameState.activeEvents;
    const sig = evs.map(e => e.key + e.weeksLeft).join('|');
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;

    box.innerHTML = evs.map(function (e) {
      return '<div class="event-chip ' + e.type + '">' +
               '<span class="chip-name">' + e.name + '</span>' +
               '<span class="chip-weeks">' + e.weeksLeft + 'w</span>' +
             '</div>';
    }).join('');
  }

  /* -----------------------------------------------------------
     FLOATING NUMBERS (§9 / §22)
     ----------------------------------------------------------- */
  /* `anchor` is either {x, y} in stage units, or {el} to hang the number off
     an actor so it travels with them (and clears the chair — see showFeedback
     for why anything in #floaters loses to an actor's z-index). */
  function floater(text, kind, anchor) {
    const f = document.createElement('div');
    f.className = 'floater ' + (kind || '');
    f.innerHTML = text;
    if (anchor && anchor.el) {
      // dx/dy nudge it clear of the feedback card, which is anchored to the
      // same point above the head — without them the number lands on the text.
      f.classList.add('floater--pinned');
      if (anchor.dy) f.style.marginBottom = anchor.dy + 'px';
      if (anchor.dx) f.style.marginLeft = anchor.dx + 'px';
      anchor.el.appendChild(f);
    } else {
      if (anchor) {
        const p = World.project(anchor.x, anchor.y);
        f.style.left = p.left + '%';
        f.style.top = p.top + '%';
      } else {
        f.style.left = rand(44, 56) + '%';
        f.style.top = '46%';
      }
      el['floaters'].appendChild(f);
    }
    setTimeout(function () { f.remove(); }, 1900);
  }

  function toast(text, kind) {
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || 'neutral');
    t.textContent = text;
    el['toasts'].appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.remove(); }, 400);
    }, 3200);
  }

  /* -----------------------------------------------------------
     STYLE PICKER — the core decision (§7)
     ----------------------------------------------------------- */
  function showStylePicker(customer) {
    activePickerCustomer = customer;
    const requested = CONFIG.styles[customer.requested];

    el['style-request'].innerHTML =
      '<span class="req-who">' + customer.name + (customer.isRegular ? ' · regular' : '') + '</span>' +
      '<span class="req-line">asked for a <strong>' + requested.name + '</strong></span>';

    el['style-cards'].innerHTML = CONFIG.styleOrder.map(function (key) {
      const st = CONFIG.styles[key];
      const isReq = key === customer.requested;
      const rep = gameState.barber.reputation;
      const price = st.price * (1 + (rep / 100) * 0.55) * gameState.business.priceModifier;

      // Slice this style out of the supplied 3-up menu sheet
      const visual = styleArt(key, st);

      return '<button class="style-card' + (isReq ? ' requested' : '') + '" data-style="' + key + '" ' +
                     'style="--accent:' + st.accent + '">' +
               (isReq ? '<span class="req-flag">REQUESTED</span>' : '') +
               visual +
               '<span class="style-name">' + st.name + '</span>' +
               '<span class="style-tag">' + st.tagline + '</span>' +
               '<span class="style-price">' + money(price) + '</span>' +
               '<span class="style-meta">' +
                 '<span title="Reputation gain">★ ' + st.repGain + '</span>' +
                 '<span title="Viral chance">◎ ' + Math.round(st.viralChance * 100) + '%</span>' +
                 '<span title="Cut time">◷ ' + st.duration.toFixed(1) + 's</span>' +
               '</span>' +
             '</button>';
    }).join('');

    el['style-cards'].querySelectorAll('.style-card').forEach(function (card) {
      card.addEventListener('click', function () {
        const key = card.dataset.style;
        if (!activePickerCustomer) return;
        const c = activePickerCustomer;
        hideStylePicker();
        Game.serviceCustomer(c, key);
      });
    });

    el['style-picker'].classList.add('show');
  }

  function hideStylePicker(customer) {
    if (customer && activePickerCustomer && customer.id !== activePickerCustomer.id) return;
    activePickerCustomer = null;
    el['style-picker'].classList.remove('show');
  }

  function isPickerActive() { return !!activePickerCustomer; }

  /* 3D (2026-10-16): the picker no longer pops up on its own. You walk your barber up to a
     waiting client and press E / CUT (World.updateInteract), so this is a no-op kept for callers. */
  function promptNext() {}

  /* -----------------------------------------------------------
     STYLE ART — sliced from the supplied 3-up menu sheet.
     Standard sprite-crop maths: to show a sub-rect (x,y,w,h) given
     as fractions of the sheet, scale the background up by 1/w × 1/h
     and position it at x/(1-w), y/(1-h).
     ----------------------------------------------------------- */
  function styleArt(key, st) {
    const sheet = ASSETS.hairstyleSheet;
    const crop = sheet && sheet.crops ? sheet.crops[key] : null;

    // Fallback keeps the game playable if the sheet is ever missing
    if (!crop) {
      return '<div class="style-glyph ' + st.glyph + '" aria-hidden="true">' + glyphSVG(st.glyph) + '</div>';
    }

    const sizeX = (100 / crop.w).toFixed(2);
    const sizeY = (100 / crop.h).toFixed(2);
    const posX = (crop.w >= 1 ? 0 : (crop.x / (1 - crop.w)) * 100).toFixed(2);
    const posY = (crop.h >= 1 ? 0 : (crop.y / (1 - crop.h)) * 100).toFixed(2);

    return '<span class="style-photo" role="img" aria-label="' + st.name + '" style="' +
             'background-image:url(\'' + assetURL(sheet.src) + '\');' +
             'background-size:' + sizeX + '% ' + sizeY + '%;' +
             'background-position:' + posX + '% ' + posY + '%;' +
           '"></span>';
  }

  /* Fallback style art if the menu sheet is unavailable. */
  function glyphSVG(kind) {
    const head = '<ellipse cx="50" cy="58" rx="26" ry="30" fill="rgba(255,255,255,.10)"/>' +
                 '<ellipse cx="50" cy="58" rx="26" ry="30" fill="none" stroke="var(--accent)" stroke-width="1.6" opacity=".55"/>';
    let hair = '';
    if (kind === 'taper') {
      hair = '<path d="M24 50 Q50 20 76 50 Q72 34 50 30 Q28 34 24 50Z" fill="var(--accent)" opacity=".85"/>' +
             '<path d="M26 54 Q50 44 74 54" stroke="var(--accent)" stroke-width="2" fill="none" opacity=".5"/>';
    } else if (kind === 'fade') {
      hair = '<path d="M22 46 Q50 12 78 46 Q74 28 50 24 Q26 28 22 46Z" fill="var(--accent)" opacity=".9"/>' +
             '<path d="M24 52 Q50 46 76 52" stroke="var(--accent)" stroke-width="1.4" fill="none" opacity=".35"/>' +
             '<path d="M26 60 Q50 56 74 60" stroke="var(--accent)" stroke-width="1" fill="none" opacity=".2"/>';
    } else {
      // Bald — clean scalp with a beard line
      hair = '<path d="M28 44 Q50 30 72 44" stroke="var(--accent)" stroke-width="1.4" fill="none" opacity=".45"/>' +
             '<path d="M30 70 Q50 90 70 70 Q50 82 30 70Z" fill="var(--accent)" opacity=".8"/>';
    }
    return '<svg viewBox="0 0 100 100" role="img">' + head + hair + '</svg>';
  }

  /* -----------------------------------------------------------
     CUT PROGRESS
     ----------------------------------------------------------- */
  function showCutProgress(customer, styleDef, durationMs) {
    const box = el['cut-progress'];
    box.innerHTML =
      '<div class="cut-label">' + styleDef.name + ' · ' + customer.name + '</div>' +
      '<div class="cut-bar"><div class="cut-fill"></div></div>';
    box.classList.add('show');
    const fill = box.querySelector('.cut-fill');
    fill.style.transition = 'width ' + durationMs + 'ms linear';
    requestAnimationFrame(function () { fill.style.width = '100%'; });
  }

  function hideCutProgress() {
    el['cut-progress'].classList.remove('show');
  }

  /* -----------------------------------------------------------
     CUSTOMER FEEDBACK
     ----------------------------------------------------------- */
  /* Hangs off the customer rather than off the stage, so it rides above their
     head all the way to the door instead of staying pinned to the chair they
     just got out of.

     That also fixes it being buried. `.layer` sets no z-index, so it is not a
     stacking context and every actor's inline z-index (placeAt: 100 + y*4)
     competes directly with the #floaters children, which sit at auto. The
     chair and the seated sprite therefore painted straight over this card. As
     a child of the actor it shares the actor's own z-index, which is exactly
     why the request bubble was always visible and this was not. */
  function showFeedback(customer, result) {
    const f = document.createElement('div');
    f.className = 'feedback ' + result.tone;
    f.innerHTML =
      '<span class="fb-name">' + customer.name + '</span>' +
      '<span class="fb-text">' + result.feedback + '</span>' +
      '<span class="fb-meter"><i style="width:' + Math.round(result.satisfaction) + '%"></i></span>';

    if (customer.el) {
      customer.el.appendChild(f);
    } else {                                   // no actor (already gone) — old behaviour
      const p = World.project(customer.x, customer.y - 8);
      f.classList.add('feedback--stage');
      f.style.left = p.left + '%';
      f.style.top = p.top + '%';
      el['floaters'].appendChild(f);
    }

    requestAnimationFrame(function () { f.classList.add('show'); });
    // Long enough to still be over their head part-way to the door.
    setTimeout(function () {
      f.classList.remove('show');
      setTimeout(function () { f.remove(); }, 400);
    }, 3400);
  }

  /* -----------------------------------------------------------
     WEEKLY SETTLEMENT TRANSITION (§8)
     ----------------------------------------------------------- */
  function showSettlement(s, onDone) {
    const box = el['settlement'];
    const profit = s.profit;

    const revRows = Object.keys(s.ledger.revenue)
      .filter(k => Math.abs(s.ledger.revenue[k]) >= 1)
      .map(k => '<div class="ledger-row"><span>' + k + '</span><strong class="good">' +
                money(s.ledger.revenue[k], { compact: true }) + '</strong></div>').join('')
      || '<div class="ledger-row empty"><span>No revenue</span><strong>—</strong></div>';

    const expRows = Object.keys(s.ledger.expenses)
      .filter(k => Math.abs(s.ledger.expenses[k]) >= 1)
      .map(k => '<div class="ledger-row"><span>' + k + '</span><strong class="bad">' +
                money(s.ledger.expenses[k], { compact: true }) + '</strong></div>').join('')
      || '<div class="ledger-row empty"><span>No expenses</span><strong>—</strong></div>';

    box.innerHTML =
      '<div class="settle-card">' +
        '<div class="settle-head">' +
          '<span class="settle-from">WEEK ' + s.week + '</span>' +
          '<span class="settle-arrow">→</span>' +
          '<span class="settle-to">WEEK ' + (s.week + 1) + '</span>' +
        '</div>' +
        '<div class="settle-title">Weekly Financial Processing</div>' +
        '<div class="settle-cols">' +
          '<div class="settle-col"><h4>REVENUE</h4>' + revRows + '</div>' +
          '<div class="settle-col"><h4>EXPENSES</h4>' + expRows + '</div>' +
        '</div>' +
        '<div class="settle-total ' + (profit >= 0 ? 'good' : 'bad') + '">' +
          '<span>NET PROFIT</span>' +
          '<strong>' + money(profit, { compact: true, sign: true }) + '</strong>' +
        '</div>' +
        '<div class="settle-cash"><span>CASH ON HAND</span><strong>' +
          money(s.cash, { compact: Math.abs(s.cash) >= 1e6 }) + '</strong></div>' +
      '</div>';

    box.classList.add('show');
    setTimeout(function () {
      box.classList.remove('show');
      setTimeout(onDone, 420);
    }, CONFIG.time.transitionMs);
  }

  /* -----------------------------------------------------------
     EVENTS + MILESTONES
     ----------------------------------------------------------- */
  function showEvent(event, note) {
    const box = el['event-card'];
    const mods = Object.keys(event.modifiers || {}).map(function (k) {
      const v = event.modifiers[k];
      const pct = Math.round((v - 1) * 100);
      const label = { traffic: 'Customer Traffic', revenue: 'Revenue',
                      expenses: 'Expenses', propertyValue: 'Property Value' }[k] || k;
      return '<div class="mod-row"><span>' + label + '</span>' +
             '<strong class="' + (pct >= 0 ? 'good' : 'bad') + '">' +
             (pct >= 0 ? '+' : '') + pct + '%</strong></div>';
    }).join('');

    box.className = 'event-card ' + event.type;
    box.innerHTML =
      '<div class="event-kind">' + (event.type === 'good' ? 'OPPORTUNITY'
                                  : event.type === 'bad' ? 'SETBACK' : 'MARKET SHIFT') + '</div>' +
      '<div class="event-name">' + event.name + '</div>' +
      '<div class="event-text">' + event.text + '</div>' +
      (note ? '<div class="event-note">' + note + '</div>' : '') +
      (mods ? '<div class="event-mods">' + mods + '</div>' : '') +
      (event.weeks > 1 ? '<div class="event-dur">Lasts ' + event.weeks + ' weeks</div>' : '');

    box.classList.add('show');
    setTimeout(function () { box.classList.remove('show'); }, 5200);
  }

  function milestone(kicker, title, sub) {
    const box = el['milestone'];
    box.innerHTML =
      '<div class="ms-kicker">' + kicker + '</div>' +
      '<div class="ms-title">' + title + '</div>' +
      (sub ? '<div class="ms-sub">' + sub + '</div>' : '') +
      '<div class="ms-burst"></div>';
    box.classList.add('show');
    burstParticles();
    setTimeout(function () { box.classList.remove('show'); }, 3400);
  }

  function burstParticles() {
    const host = el['floaters'];
    for (let i = 0; i < 26; i++) {
      const p = document.createElement('span');
      p.className = 'spark';
      p.style.left = '50%';
      p.style.top = '44%';
      const angle = (Math.PI * 2 * i) / 26 + rand(-0.2, 0.2);
      const dist = rand(90, 300);
      p.style.setProperty('--tx', (Math.cos(angle) * dist).toFixed(0) + 'px');
      p.style.setProperty('--ty', (Math.sin(angle) * dist).toFixed(0) + 'px');
      p.style.animationDelay = rand(0, 0.18).toFixed(2) + 's';
      host.appendChild(p);
      setTimeout(function () { p.remove(); }, 1500);
    }
  }

  /* -----------------------------------------------------------
     PANELS — BUSINESS DECISIONS + PORTFOLIO
     ----------------------------------------------------------- */
  function renderBusinessPanel() {
    const s = gameState;
    const body = el['panel-business'].querySelector('.panel-body');
    const mk = s.business.marketingTier;
    const priceP = Math.round((s.business.priceModifier - 1) * 100);

    body.innerHTML =
      '<section class="dec-block">' +
        '<h4>PRICING</h4>' +
        '<p class="dec-hint">Charging more earns more per cut but costs reputation and traffic.</p>' +
        '<div class="dec-row">' +
          '<button class="btn small" data-act="price-down">− 10%</button>' +
          '<span class="dec-val">' + (priceP >= 0 ? '+' : '') + priceP + '% vs market</span>' +
          '<button class="btn small" data-act="price-up">+ 10%</button>' +
        '</div>' +
      '</section>' +

      '<section class="dec-block">' +
        '<h4>MARKETING</h4>' +
        '<p class="dec-hint">Each tier costs ' + money(CONFIG.expenses.marketingStep) +
          '/week and lifts traffic ' + Math.round(CONFIG.marketing.trafficPerTier * 100) + '%.</p>' +
        '<div class="dec-row">' +
          '<button class="btn small" data-act="mk-down">−</button>' +
          '<span class="dec-val">Tier ' + mk + ' · ' + money(mk * CONFIG.expenses.marketingStep) + '/wk</span>' +
          '<button class="btn small" data-act="mk-up">+</button>' +
        '</div>' +
      '</section>' +

      '<section class="dec-block">' +
        '<h4>REVENUE STREAMS</h4>' +
        streamRows() +
      '</section>' +

      (s.revenueStreams.mobileBarber ?
        '<section class="dec-block">' +
          '<h4>MOBILE FLEET</h4>' +
          '<p class="dec-hint">' + s.streamData.mobileUnits + ' van' +
            (s.streamData.mobileUnits === 1 ? '' : 's') + ' running.</p>' +
          '<button class="btn wide" data-act="expand-mobile">EXPAND FLEET · ' +
            money(CONFIG.streams.mobileBarber.setupCost * (1 + s.streamData.mobileUnits * 0.4), { compact: true }) +
          '</button>' +
        '</section>' : '');

    body.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const act = btn.dataset.act;
        if (act === 'price-up')   Economy.setPriceModifier(s.business.priceModifier + 0.1);
        if (act === 'price-down') Economy.setPriceModifier(s.business.priceModifier - 0.1);
        if (act === 'mk-up')      Economy.setMarketing(s.business.marketingTier + 1);
        if (act === 'mk-down')    Economy.setMarketing(s.business.marketingTier - 1);
        if (act === 'expand-mobile') Economy.expandMobile();
        renderBusinessPanel();
      });
    });
  }

  function streamRows() {
    const s = gameState;
    const rows = [
      ['Haircuts',       s.revenueStreams.haircuts,      'Always active'],
      ['Merchandise',    s.revenueStreams.merchandise,   'Rep ' + CONFIG.streams.merchandise.unlockRep + '+'],
      ['Social Media',   s.revenueStreams.socialMedia,   'Rep ' + CONFIG.streams.socialMedia.unlockRep + '+'],
      ['Hair Tool',      s.revenueStreams.hairstyleTool, 'Level 2+'],
      ['Mobile Barber',  s.revenueStreams.mobileBarber,  'Level 2+']
    ];
    return '<div class="stream-grid">' + rows.map(function (r) {
      return '<div class="stream-row ' + (r[1] ? 'on' : 'off') + '">' +
               '<span class="dot"></span>' +
               '<span class="s-name">' + r[0] + '</span>' +
               '<span class="s-status">' + (r[1] ? 'ACTIVE' : r[2]) + '</span>' +
             '</div>';
    }).join('') + '</div>';
  }

  function renderPortfolioPanel() {
    const s = gameState;
    const body = el['panel-portfolio'].querySelector('.panel-body');

    if (!s.properties.length) {
      body.innerHTML =
        '<div class="empty-state">' +
          '<div class="empty-icon">🏠</div>' +
          '<p>You don\'t own property yet.</p>' +
          '<p class="dec-hint">Build cash to ' + money(CONFIG.progression.level2Cash, { compact: true }) +
          ' and a realtor will reach out.</p>' +
          '<div class="progress-to-goal">' +
            '<div class="ptg-bar"><i style="width:' +
              clamp((s.cash / CONFIG.progression.level2Cash) * 100, 0, 100).toFixed(1) + '%"></i></div>' +
            '<span>' + money(s.cash, { compact: true }) + ' / ' +
              money(CONFIG.progression.level2Cash, { compact: true }) + '</span>' +
          '</div>' +
        '</div>';
      return;
    }

    const total = portfolioValue();
    const counts = CONFIG.property.sizeOrder.map(function (sz) {
      return { size: sz, n: countBySize(sz) };
    }).filter(c => c.n > 0);

    body.innerHTML =
      '<div class="port-summary">' +
        '<div class="port-total"><span>PORTFOLIO VALUE</span><strong>' +
          money(total, { compact: true }) + '</strong></div>' +
        '<div class="port-counts">' + counts.map(function (c) {
          return '<span class="port-pill ' + c.size + '">' + c.n + ' × ' +
                 CONFIG.property.sizes[c.size].name + '</span>';
        }).join('') + '</div>' +
      '</div>' +
      '<div class="port-list">' + s.properties.map(function (p) {
        const gain = p.value - p.purchasePrice;
        const pct = (gain / p.purchasePrice) * 100;
        return '<div class="port-item ' + p.size + '">' +
                 '<div class="port-thumb"><img src="' + assetURL(ASSETS.exteriors[p.size]) + '" alt=""></div>' +
                 '<div class="port-info">' +
                   '<div class="port-name">' + p.name + '</div>' +
                   '<div class="port-meta">' + CONFIG.property.sizes[p.size].name +
                     ' · bought wk ' + p.week + '</div>' +
                   '<div class="port-figures">' +
                     '<span>Value <strong>' + money(p.value, { compact: true }) + '</strong></span>' +
                     '<span class="' + (gain >= 0 ? 'good' : 'bad') + '">' +
                       (gain >= 0 ? '▲' : '▼') + ' ' + Math.abs(pct).toFixed(1) + '%</span>' +
                   '</div>' +
                   '<div class="port-figures"><span>Net / wk <strong class="good">' +
                     money(Economy.shopNetWeekly(p), { compact: true }) + '</strong></span></div>' +
                 '</div>' +
               '</div>';
      }).join('') + '</div>';
  }

  /* -----------------------------------------------------------
     ENDGAME + FAILURE
     ----------------------------------------------------------- */
  function showEndgame() {
    const s = gameState;
    const years = (s.week / CONFIG.time.weeksPerYear).toFixed(1);
    const box = el['endgame'];
    box.innerHTML =
      '<div class="end-card">' +
        '<div class="end-kicker">YOU BECAME THE</div>' +
        '<h1 class="end-title">BILLIONAIRE BARBER</h1>' +
        '<div class="end-grid">' +
          statTile('Total Wealth', money(computeNetWorth(), { compact: true })) +
          statTile('Shops Owned', String(s.properties.length)) +
          statTile('Customers Served', compactNum(s.totals.customersServed)) +
          statTile('Total Revenue', money(s.totals.revenueEarned, { compact: true })) +
          statTile('Total Profit', money(s.totals.revenueEarned - s.totals.expensesPaid, { compact: true })) +
          statTile('Followers', compactNum(s.social.followers)) +
          statTile('Portfolio Value', money(portfolioValue(), { compact: true })) +
          statTile('Weeks Survived', s.week + ' (' + years + ' yrs)') +
          statTile('Events Weathered', String(s.totals.eventsEncountered)) +
        '</div>' +
        '<button class="btn primary large" id="end-continue">CONTINUE BUILDING THE EMPIRE</button>' +
      '</div>';
    box.classList.add('show');
    burstParticles();
    setTimeout(burstParticles, 500);
    setTimeout(burstParticles, 1000);
    Game.pause('endgame');
    document.getElementById('end-continue').addEventListener('click', function () {
      box.classList.remove('show');
      Game.resume('endgame');
    });
  }

  function statTile(label, value) {
    return '<div class="end-stat"><span>' + label + '</span><strong>' + value + '</strong></div>';
  }

  function showFailure() {
    const box = el['failure'];
    box.innerHTML =
      '<div class="end-card fail">' +
        '<div class="end-kicker">OUT OF CASH</div>' +
        '<h1 class="end-title">THE CHAIR IS GONE</h1>' +
        '<p class="end-body">You couldn\'t cover the bills. The shop let you go.</p>' +
        '<div class="end-grid">' +
          statTile('Weeks Survived', String(gameState.week)) +
          statTile('Cuts Performed', String(gameState.totals.cutsPerformed)) +
          statTile('Peak Net Worth', money(Math.max.apply(null,
            [0].concat(gameState.history.map(h => h.netWorth))), { compact: true })) +
        '</div>' +
        '<button class="btn primary large" id="fail-restart">START OVER</button>' +
      '</div>';
    box.classList.add('show');
    Game.pause('failure');
    document.getElementById('fail-restart').addEventListener('click', function () {
      clearSave();
      location.reload();
    });
  }

  /* -----------------------------------------------------------
     CONTROLS
     ----------------------------------------------------------- */
  function bindControls() {
    document.querySelectorAll('[data-panel]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const target = document.getElementById('panel-' + btn.dataset.panel);
        const isOpen = target.classList.contains('show');
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('show'));
        if (!isOpen) {
          if (btn.dataset.panel === 'business') renderBusinessPanel();
          if (btn.dataset.panel === 'portfolio') renderPortfolioPanel();
          target.classList.add('show');
        }
      });
    });

    document.querySelectorAll('.panel-close').forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.closest('.panel').classList.remove('show');
      });
    });

    document.getElementById('btn-save').addEventListener('click', function () { saveGame(); });

    document.getElementById('btn-break').addEventListener('click', function () {
      Game.takeBreak();
    });

    document.getElementById('btn-pause').addEventListener('click', function () {
      const paused = Game.togglePause();
      document.getElementById('btn-pause').textContent = paused ? '▶' : '❚❚';
    });

    document.getElementById('btn-reset').addEventListener('click', function () {
      if (confirm('Reset the game? All progress will be lost.')) {
        clearSave();
        location.reload();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        document.querySelectorAll('.panel.show').forEach(p => p.classList.remove('show'));
      }
      // Number keys pick a style during service — keeps the loop fast
      if (activePickerCustomer && ['1', '2', '3'].indexOf(e.key) !== -1) {
        const key = CONFIG.styleOrder[Number(e.key) - 1];
        const c = activePickerCustomer;
        hideStylePicker();
        Game.serviceCustomer(c, key);
      }
    });
  }

  return {
    init, updateHUD, toast, floater, milestone,
    showStylePicker, hideStylePicker, isPickerActive, promptNext,
    showCutProgress, hideCutProgress, showFeedback,
    showSettlement, showEvent, showEndgame, showFailure,
    renderBusinessPanel, renderPortfolioPanel,
    burstParticles
  };
})();
