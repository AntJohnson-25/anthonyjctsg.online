/* =============================================================
   BILLIONAIRE BARBER — GAME LOOP + BOOTSTRAP
   Owns the 30s-per-week clock, the pause stack, asset preloading
   and the start / character-selection flow.
   ============================================================= */

const Game = (function () {

  let running = false;
  let lastTime = 0;
  let pauseReasons = new Set();
  let manualPause = false;
  let rafId = null;

  /* -----------------------------------------------------------
     PAUSE STACK
     Several systems can independently request a pause (messages,
     endgame, settlement). The clock only runs when all are clear.
     ----------------------------------------------------------- */
  function pause(reason) { pauseReasons.add(reason); }
  function resume(reason) { pauseReasons.delete(reason); }
  function isPaused() { return manualPause || pauseReasons.size > 0; }

  function togglePause() {
    manualPause = !manualPause;
    document.body.classList.toggle('paused', manualPause);
    return manualPause;
  }

  /* -----------------------------------------------------------
     MAIN LOOP
     ----------------------------------------------------------- */
  function loop(now) {
    rafId = requestAnimationFrame(loop);
    if (!running) return;

    // Clamp dt so a backgrounded tab doesn't fast-forward the economy
    const dt = Math.min(0.1, (now - lastTime) / 1000) || 0;
    lastTime = now;

    if (!isPaused()) {
      advanceTime(dt);
      World.update(dt);
      World.idle();
      Economy.tick(dt);
    }

    // HUD keeps animating while paused so numbers settle smoothly
    UI.updateHUD(dt);
    // the 3D shop draws every frame; paused, everyone just holds still
    World.frame(dt, isPaused());
  }

  function advanceTime(dt) {
    const s = gameState;
    s.weekProgress += dt / CONFIG.time.secondsPerWeek;

    if (s.weekProgress >= 1) {
      s.weekProgress = 0;
      endWeek();
    }
  }

  function endWeek() {
    pause('settlement');
    const settlement = Economy.completeWeek();
    UI.showSettlement(settlement, function () {
      resume('settlement');
    });
  }

  /* -----------------------------------------------------------
     BREAKS — 4 charges for the whole game. Pauses the shop for
     CONFIG.breaks.durationSeconds real seconds while both barbers
     meet at the deployment point; on return, a chance to have
     confirmed an appointment/deal.
     ----------------------------------------------------------- */
  function takeBreak() {
    if (!gameState || gameState.breaksLeft <= 0 || pauseReasons.has('break')) return false;
    gameState.breaksLeft--;
    pause('break');
    World.startBreak();
    UI.toast('Taking a break…', 'neutral');

    setTimeout(function () {
      World.endBreak();
      resume('break');
      if (chance(0.5)) {
        const gain = randInt(1, 3);
        gameState.barber.clientele += gain;
        UI.toast('Confirmed a deal on break — +' + gain + ' clientele', 'good');
      } else {
        UI.toast('Just caught up — back to work', 'neutral');
      }
      saveGame(true);
    }, CONFIG.breaks.durationSeconds * 1000);

    return true;
  }

  /* -----------------------------------------------------------
     SERVICE FLOW — player picked a style
     ----------------------------------------------------------- */
  function serviceCustomer(customer, styleKey) {
    World.performCut(customer, styleKey, function () {
      const result = Economy.serviceCustomer(customer, styleKey);

      UI.showFeedback(customer, result);
      // Anchored to the customer, so the takings rise off the head that earned
      // them as they walk out rather than hanging over an empty chair.
      UI.floater(money(result.ticket, { sign: true }) + '<small>Haircut</small>',
                 'good', { el: customer.el, dy: 64 });

      if (result.tip) {
        setTimeout(function () {
          UI.floater(money(result.tip, { sign: true }) + '<small>Tip</small>',
                     'good', { el: customer.el, dy: 64, dx: 46 });
        }, 260);
      }

      if (result.wentViral) {
        UI.milestone('VIRAL MOMENT', 'THE CUT BLEW UP', 'Followers are pouring in.');
      }

      // Hot towels from the street vendor: +1 reputation a cut while they last
      if (gameState.perks && gameState.perks.towels > 0) {
        gameState.perks.towels--;
        adjustReputation(1);
        setTimeout(function () {
          UI.floater('+1 REP<small>Hot towel</small>', 'good', { el: customer.el, dy: 110 });
        }, 520);
      }

      World.reactBarber(result.tone === 'bad' ? 'bad' : 'good');
      World.sendCustomerHome(customer, true);
      Economy.checkStreamUnlocks();
    });
  }

  /* -----------------------------------------------------------
     ASSET PRELOAD
     ----------------------------------------------------------- */
  /* The few 2D images (select portraits, realtor photos, avatars, haircut menu) plus the 3D
     bodies the shop opens with: both barbers and the first few clients. The rest of the cast
     downloads in the background once you're in (startGame). */
  function preload(onProgress) {
    const urls = Object.values(ASSETS.portraits).concat(Object.values(ASSETS.exteriors), Object.values(ASSETS.avatars), [ASSETS.hairstyleSheet.src]);
    const bodies = [HS.BARBERS.male, HS.BARBERS.female].concat(HS.CLIENT_ORDER.slice(0, 3).map(k => HS.CLIENTS[k].body));

    let loaded = 0;
    const total = urls.length + bodies.length;
    const done = function () {
      loaded++;
      if (onProgress) onProgress(loaded / total);
    };
    const imgs = urls.map(function (u) {
      return new Promise(function (resolve) {
        const img = new Image();
        img.onload = function () { done(); resolve(); };
        // A missing file must not stall the boot — fail soft
        img.onerror = function () { console.warn('Asset failed to load:', u); done(); resolve(); };
        img.src = assetURL(u);
      });
    });
    const chars = bodies.map(function (id) {
      return HS.Body.load(id).then(done, function (err) { console.warn('Character failed to load:', id, err); done(); });
    });
    return Promise.all(imgs.concat(chars));
  }

  function loadTheRest() {
    const ids = {};
    Object.values(HS.CLIENTS).forEach(c => { ids[c.body] = 1; });
    HS.EXTRAS.forEach(id => { ids[id] = 1; });
    // one at a time: the PC this was built on has very little RAM, and phones less
    Object.keys(ids).reduce(function (p, id) {
      return p.then(function () { return HS.Body.load(id).catch(function () { /* skip it */ }); });
    }, Promise.resolve());
  }

  /* -----------------------------------------------------------
     START FLOW
     ----------------------------------------------------------- */
  function boot() {
    World.init();
    Messages.init();

    const loadBar = document.getElementById('load-bar');
    const startScreen = document.getElementById('start-screen');

    ready = preload(function (p) {
      loadBar.style.width = (p * 100).toFixed(0) + '%';
    });
    ready.then(function () {
      startScreen.classList.add('loaded');
      document.getElementById('btn-continue').style.display = hasSave() ? '' : 'none';
    });

    // Key art: the landing (titled art + PLAY), then the barber select over the untitled art.
    // Until the art exists (Work/art/README.md) the start screen stays as it was.
    const art = new Image();
    art.onload = function () {
      document.body.classList.add('has-art');
      startScreen.classList.add('art');
      const landing = document.getElementById('landing');
      landing.hidden = false;
      document.getElementById('btn-play').addEventListener('click', function () {
        landing.classList.add('leaving');
        setTimeout(function () { landing.hidden = true; }, 450);
      });
    };
    art.src = 'art/key_title.jpg?v=2';

    // Character selection
    document.querySelectorAll('.char-card').forEach(function (card) {
      const char = card.dataset.char;
      const img = card.querySelector('img');
      img.src = assetURL(ASSETS.portraits[char]);

      card.addEventListener('click', function () {
        document.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        document.getElementById('btn-new').disabled = false;
        document.getElementById('btn-new').dataset.char = char;
      });
    });

    document.getElementById('btn-new').addEventListener('click', function () {
      const char = this.dataset.char;
      if (!char) return;
      clearSave();
      gameState = createNewState(char);
      startGame();
    });

    document.getElementById('btn-continue').addEventListener('click', function () {
      if (!loadGame()) {
        UI.toast('No save found', 'bad');
        return;
      }
      startGame();
    });
  }

  let ready = Promise.resolve();
  function startGame() {
    // the barbers' 3D bodies must be in before the shop can open
    ready.then(function () { setTimeout(openShop, 700); });
    document.getElementById('start-screen').classList.add('exiting');
  }
  function openShop() {
    document.getElementById('start-screen').style.display = 'none';
    document.getElementById('game').classList.add('active');

    UI.init();
    World.start();
    loadTheRest();

    running = true;
    lastTime = performance.now();
    if (!rafId) rafId = requestAnimationFrame(loop);

    if (!gameState.flags.seenIntro) {
      gameState.flags.seenIntro = true;
      setTimeout(function () {
        UI.milestone('WEEK 1', 'RENTING A CHAIR',
                     'Cut hair. Build a name. Own the city.');
      }, 500);
    }

    // A first customer right away so the loop never opens on an empty room
    setTimeout(function () { World.spawnCustomer(); }, 1400);
  }

  // Autosave periodically so a closed tab doesn't cost progress
  setInterval(function () {
    if (running && gameState) saveGame(true);
  }, 20000);

  window.addEventListener('beforeunload', function () {
    if (running && gameState) saveGame(true);
  });

  return {
    boot, startGame, serviceCustomer, takeBreak,
    pause, resume, isPaused, togglePause,
    get running() { return running; }
  };
})();

// The scripts are injected after the page has parsed (index.html's loader), so DOMContentLoaded
// may already be over.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', Game.boot);
else Game.boot();
