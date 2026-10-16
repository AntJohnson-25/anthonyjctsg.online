/* =============================================================
   BILLIONAIRE BARBER — OPPORTUNITY MESSAGE SYSTEM (§17)
   Every opportunity arrives as an animated phone thread, never a
   browser alert. Bubbles land one at a time behind a typing
   indicator; decision buttons appear only after the last bubble.
   ============================================================= */

const Messages = (function () {

  let phoneEl, threadEl, headerEl, actionsEl;
  let queue = [];
  let active = null;
  let timers = [];

  function init() {
    phoneEl = document.getElementById('phone');
    threadEl = document.getElementById('phone-thread');
    headerEl = document.getElementById('phone-header');
    actionsEl = document.getElementById('phone-actions');
  }

  function clearTimers() {
    timers.forEach(t => clearTimeout(t));
    timers = [];
  }

  /* -----------------------------------------------------------
     CORE PRESENTER
     thread: [{ text } | { photo, caption } | { details: [[k,v]...] }]
     actions: [{ label, kind, onClick }]
     ----------------------------------------------------------- */
  function open(config) {
    if (active) { queue.push(config); return; }
    active = config;

    Game.pause('message');

    // Senders with a real cropped headshot get a photo; the rest use a
    // tinted emoji chip so every thread still reads as a contact.
    const avatarInner = config.avatarImg
      ? '<img src="' + assetURL(config.avatarImg) + '" alt="">'
      : (config.avatar || '\u{1F464}');

    headerEl.innerHTML =
      '<button class="phone-back" aria-label="Back">‹</button>' +
      '<div class="phone-contact">' +
        '<div class="phone-avatar ' + (config.avatarClass || '') +
          (config.avatarImg ? ' photo' : '') + '">' + avatarInner + '</div>' +
        '<div class="phone-name">' + config.sender + '</div>' +
        '<div class="phone-time">' + timestamp() + '</div>' +
      '</div>';

    threadEl.innerHTML = '';
    actionsEl.innerHTML = '';
    actionsEl.classList.remove('show');

    phoneEl.classList.add('show');
    phoneEl.setAttribute('aria-hidden', 'false');

    playThread(config.thread, 0, function () {
      renderActions(config.actions);
    });
  }

  function playThread(items, index, onDone) {
    if (index >= items.length) { onDone(); return; }
    const item = items[index];

    // Typing indicator first — the pause is what sells it as a person
    const typing = document.createElement('div');
    typing.className = 'bubble in typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    threadEl.appendChild(typing);
    scrollThread();

    const typeDelay = item.photo ? 700 : Math.min(1400, 380 + (item.text || '').length * 16);

    timers.push(setTimeout(function () {
      typing.remove();
      const el = buildBubble(item);
      threadEl.appendChild(el);
      // Force reflow so the entrance animation always runs
      void el.offsetWidth;
      el.classList.add('landed');
      scrollThread();
      timers.push(setTimeout(function () {
        playThread(items, index + 1, onDone);
      }, item.photo ? 620 : 340));
    }, typeDelay));
  }

  function buildBubble(item) {
    const el = document.createElement('div');

    if (item.photo) {
      el.className = 'bubble in photo';
      el.innerHTML =
        '<div class="mms">' +
          '<div class="mms-shimmer"></div>' +
          '<img src="' + assetURL(item.photo) + '" alt="Property exterior">' +
        '</div>' +
        (item.caption ? '<div class="mms-caption">' + item.caption + '</div>' : '');
      const img = el.querySelector('img');
      const shimmer = el.querySelector('.mms-shimmer');
      const reveal = function () { el.classList.add('loaded'); if (shimmer) shimmer.remove(); };
      if (img.complete) setTimeout(reveal, 420);
      else { img.onload = () => setTimeout(reveal, 300); img.onerror = reveal; }
      return el;
    }

    if (item.details) {
      el.className = 'bubble in details';
      el.innerHTML = '<div class="detail-card">' +
        (item.title ? '<div class="detail-title">' + item.title + '</div>' : '') +
        item.details.map(function (row) {
          return '<div class="detail-row' + (row[2] ? ' ' + row[2] : '') + '">' +
                   '<span>' + row[0] + '</span><strong>' + row[1] + '</strong>' +
                 '</div>';
        }).join('') +
      '</div>';
      return el;
    }

    el.className = 'bubble ' + (item.out ? 'out' : 'in');
    el.textContent = item.text;
    return el;
  }

  function renderActions(actions) {
    if (!actions || !actions.length) actions = [{ label: 'OK', kind: 'ghost', onClick: close }];

    actionsEl.innerHTML = '';
    actions.forEach(function (a) {
      const btn = document.createElement('button');
      btn.className = 'btn phone-btn ' + (a.kind || 'primary');
      btn.textContent = a.label;
      btn.addEventListener('click', function () {
        // Echo the player's choice as an outgoing bubble before closing
        const echo = document.createElement('div');
        echo.className = 'bubble out';
        echo.textContent = a.reply || a.label;
        threadEl.appendChild(echo);
        void echo.offsetWidth;
        echo.classList.add('landed');
        scrollThread();
        actionsEl.classList.remove('show');
        timers.push(setTimeout(function () {
          if (a.onClick) a.onClick();
          close();
        }, 520));
      });
      actionsEl.appendChild(btn);
    });

    requestAnimationFrame(function () { actionsEl.classList.add('show'); });
  }

  function close() {
    clearTimers();
    phoneEl.classList.remove('show');
    phoneEl.setAttribute('aria-hidden', 'true');
    active = null;
    setTimeout(function () {
      if (queue.length) open(queue.shift());
      else Game.resume('message');
    }, 420);
  }

  function scrollThread() {
    threadEl.scrollTop = threadEl.scrollHeight;
  }

  function timestamp() {
    const week = gameState.week;
    const year = Math.floor((week - 1) / CONFIG.time.weeksPerYear) + 1;
    const w = ((week - 1) % CONFIG.time.weeksPerYear) + 1;
    return 'Yr ' + year + ' · Wk ' + w;
  }

  /* -----------------------------------------------------------
     REALTOR — PROPERTY OFFER
     This is the ONLY place a building exterior is ever shown (§4).
     ----------------------------------------------------------- */
  function realtorOffer(offer) {
    const net = offer.weeklyRevenue - offer.weeklyExpense;
    const payback = net > 0 ? Math.ceil(offer.price / net) : null;
    const sizeName = CONFIG.property.sizes[offer.size].name;

    open({
      sender: 'Denise · Realtor',
      avatarImg: ASSETS.avatars.realtor,
      avatarClass: 'realtor',
      thread: [
        { text: 'Hey — I just came across something you may want to see.' },
        { photo: ASSETS.exteriors[offer.size], caption: offer.name },
        { text: 'It\'s a ' + sizeName.toLowerCase() +
                ' shop, ' + offer.stations + ' stations. Books are clean.' },
        { title: offer.name,
          details: [
            ['Size', sizeName + ' · ' + offer.stations + ' chairs'],
            ['Asking Price', money(offer.price, { compact: true })],
            ['Est. Weekly Revenue', money(offer.weeklyRevenue, { compact: true })],
            ['Weekly Expenses', money(offer.weeklyExpense, { compact: true })],
            ['Net Weekly', money(net, { compact: true }), net > 0 ? 'good' : 'bad'],
            ['Appraised Value', money(offer.value, { compact: true })],
            payback ? ['Payback', '~' + payback + ' weeks'] : ['Payback', 'Never at this rate', 'bad']
          ] },
        { text: gameState.cash >= offer.price
                  ? 'You\'ve got the cash. Want to pursue it?'
                  : 'You\'re short right now — you\'d need ' +
                    money(offer.price - gameState.cash, { compact: true }) + ' more.' }
      ],
      actions: [
        {
          label: 'BUY  ' + money(offer.price, { compact: true }),
          kind: gameState.cash >= offer.price ? 'primary' : 'disabled',
          reply: 'Let\'s do it.',
          onClick: function () { Economy.buyProperty(offer); }
        },
        { label: 'PASS', kind: 'ghost', reply: 'Not this one.' }
      ]
    });
  }

  /* -----------------------------------------------------------
     REALTOR — MONOPOLY-STYLE TRADE UP
     ----------------------------------------------------------- */
  function tradeUpOffer(deal) {
    const fromName = CONFIG.property.sizes[deal.fromSize].name;
    const toName = CONFIG.property.sizes[deal.toSize].name;

    open({
      sender: 'Denise · Realtor',
      avatarImg: ASSETS.avatars.realtor,
      avatarClass: 'realtor',
      thread: [
        { text: 'You\'re sitting on three ' + fromName.toLowerCase() + ' shops now.' },
        { photo: ASSETS.exteriors[deal.toSize], caption: 'Consolidation opportunity' },
        { text: 'I can trade all three into one ' + toName.toLowerCase() +
                ' location. Bigger floor, better margins.' },
        { title: 'TRADE UP → ' + toName.toUpperCase(),
          details: [
            ['Trading In', '3 × ' + fromName],
            ['Trade Credit', money(deal.credit, { compact: true }), 'good'],
            ['Target Price', money(deal.target, { compact: true })],
            ['Cash Difference', money(deal.difference, { compact: true }),
              gameState.cash >= deal.difference ? '' : 'bad']
          ] },
        { text: 'Say the word and I\'ll draw it up.' }
      ],
      actions: [
        {
          label: 'TRADE UP',
          kind: gameState.cash >= deal.difference ? 'primary' : 'disabled',
          reply: 'Draw it up.',
          onClick: function () { Economy.executeTradeUp(deal); }
        },
        { label: 'KEEP THEM', kind: 'ghost', reply: 'I\'ll hold what I have.' }
      ]
    });
  }

  /* -----------------------------------------------------------
     REVENUE STREAM UNLOCKS
     ----------------------------------------------------------- */
  function merchOffer() {
    const m = CONFIG.streams.merchandise;
    open({
      sender: 'Trey · Print Shop',
      avatar: '\u{1F9E2}',
      avatarClass: 'merch',
      thread: [
        { text: 'Yo. People keep asking me who cuts your clients\' hair.' },
        { text: 'You\'ve got a name now. Let\'s put it on something.' },
        { title: 'MERCH LINE',
          details: [
            ['Setup Cost', money(m.setupCost), gameState.cash >= m.setupCost ? '' : 'bad'],
            ['Est. Weekly Gross', money(m.baseWeekly) + '+'],
            ['Scales With', 'Social following'],
            ['Product Cost', Math.round(m.costRate * 100) + '% of gross']
          ] },
        { text: 'Shirts, caps, hoodies. I handle production, you just stock the shelf.' }
      ],
      actions: [
        {
          label: 'START MERCH LINE',
          kind: gameState.cash >= m.setupCost ? 'primary' : 'disabled',
          reply: 'Let\'s print.',
          onClick: function () { Economy.acceptMerch(); }
        },
        { label: 'NOT YET', kind: 'ghost', reply: 'Give me some time.' }
      ]
    });
  }

  function socialUnlock() {
    open({
      sender: 'Jas · Client',
      avatar: '\u{1F4F1}',
      avatarClass: 'social',
      thread: [
        { text: 'I posted my cut and it\'s doing numbers \u{1F602}' },
        { text: 'You seriously don\'t have an account? You\'re leaving money on the table.' },
        { title: 'SOCIAL MEDIA',
          details: [
            ['Setup Cost', 'Free'],
            ['Revenue', 'Uncertain — often zero'],
            ['Grows From', 'Great cuts & viral moments'],
            ['Unlocks', 'Sponsorships at 25K followers']
          ] },
        { text: 'Start posting your work. Worst case nothing happens.' }
      ],
      actions: [
        { label: 'START POSTING', kind: 'primary', reply: 'Set it up for me.',
          onClick: function () { Economy.acceptSocial(); } },
        { label: 'PASS', kind: 'ghost', reply: 'Not my thing.' }
      ]
    });
  }

  function toolOffer() {
    const t = CONFIG.streams.hairstyleTool;
    open({
      sender: 'Kwan · Manufacturer',
      avatar: '⚙️',
      avatarClass: 'tool',
      thread: [
        { text: 'We saw the guard attachment you\'ve been using. The modified one.' },
        { text: 'We want to license it. Two structures — your call.' },
        { title: 'OPTION A — LUMP SUM',
          details: [
            ['Up Front', money(t.lumpSum), 'good'],
            ['Weekly Royalty', money(t.weeklyRoyalty)]
          ] },
        { title: 'OPTION B — ROYALTY ONLY',
          details: [
            ['Up Front', money(0)],
            ['Weekly Royalty', money(t.altWeeklyRoyalty), 'good']
          ] },
        { text: 'Cash now, or more every week. Royalties do decay over time.' }
      ],
      actions: [
        { label: 'TAKE ' + money(t.lumpSum, { compact: true }) + ' NOW', kind: 'primary',
          reply: 'I\'ll take the lump sum.',
          onClick: function () { Economy.acceptTool(true); } },
        { label: 'ROYALTY ONLY', kind: 'secondary',
          reply: 'Royalties. I\'m playing long.',
          onClick: function () { Economy.acceptTool(false); } },
        { label: 'DECLINE', kind: 'ghost', reply: 'I\'ll keep it to myself.' }
      ]
    });
  }

  function mobileOffer() {
    const mb = CONFIG.streams.mobileBarber;
    open({
      sender: 'Andre · Business Partner',
      avatarImg: ASSETS.avatars.partner,
      avatarClass: 'mobile',
      thread: [
        { text: 'Found a van. Fully built out — chair, mirror, power, the whole thing.' },
        { text: 'Nursing homes, weddings, offices. They can\'t come to you, we go to them.' },
        { title: 'MOBILE OPERATION',
          details: [
            ['Setup Cost', money(mb.setupCost), gameState.cash >= mb.setupCost ? '' : 'bad'],
            ['Est. Weekly Revenue', money(mb.baseWeekly), 'good'],
            ['Weekly Expenses', money(mb.weeklyExpense)],
            ['Net Weekly', money(mb.baseWeekly - mb.weeklyExpense), 'good'],
            ['Risk', 'Breakdowns cost ' + money(mb.breakdownCost), 'bad']
          ] },
        { text: 'Higher reach, higher headache. You in?' }
      ],
      actions: [
        { label: 'BUY THE VAN',
          kind: gameState.cash >= mb.setupCost ? 'primary' : 'disabled',
          reply: 'Buy it.',
          onClick: function () { Economy.acceptMobile(); } },
        { label: 'WAIT', kind: 'ghost', reply: 'Let me build up first.' }
      ]
    });
  }

  function sponsorshipOffer() {
    const sm = CONFIG.streams.socialMedia;
    const amount = Math.round(rand(sm.sponsorshipMin, sm.sponsorshipMax) *
                              (1 + gameState.social.followers / 400000));
    open({
      sender: 'Mia · Brand Partnerships',
      avatar: '✨',
      avatarClass: 'social',
      thread: [
        { text: 'Hi! We track grooming creators and your engagement is strong.' },
        { title: 'SPONSORED CAMPAIGN',
          details: [
            ['Payout', money(amount), 'good'],
            ['Your Following', compactNum(gameState.social.followers)],
            ['Commitment', 'One campaign']
          ] },
        { text: 'One post, one payment. Interested?' }
      ],
      actions: [
        { label: 'ACCEPT  ' + money(amount, { compact: true }), kind: 'primary',
          reply: 'Send the contract.',
          onClick: function () {
            Economy.acceptSponsorship(amount);
            UI.toast('Sponsorship: ' + money(amount), 'good');
          } },
        { label: 'DECLINE', kind: 'ghost', reply: 'Not a fit for me.' }
      ]
    });
  }

  return {
    init, open, close,
    realtorOffer, tradeUpOffer,
    merchOffer, socialUnlock, toolOffer, mobileOffer, sponsorshipOffer,
    get isOpen() { return !!active; }
  };
})();
