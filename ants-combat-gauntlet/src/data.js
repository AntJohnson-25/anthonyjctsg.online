// Fighter, stage and gauntlet definitions. Pure data: the engine in game.js
// reads these; tune balance here.
//
// Move fields
//   frames  [[spriteFrame, ticks], ...]       animation, 60 ticks = 1s
//   hits    [{from,to, x:[near,far], y:[low,high], dmg, stun, push, kd, launch}]
//           x is distance ahead of the fighter's centre, y is height above the
//           feet (world px, fighters stand ~270px tall). kd = knockdown.
//   shots   [{at, dx, dy, vx, dmg, r, kind, stun, push, kd}] projectiles
//   cool    ticks before the move can be used again
//   lunge   forward speed on start;  dive [vx, vy] for air moves
//   chain   {on: moveName, from: tick, to: moveName} press again to follow up
//   air     true = only from a jump; ends on landing
(function () {
  const P = (dmg, stun, push, extra) => Object.assign({ dmg, stun, push }, extra || {});

  const CHARACTERS = {
    ant: {
      name: 'ANT', title: 'The Cowboy', sprite: 'ant', color: '#f0a64a',
      hp: 1000, speed: 4.6, jump: 19,
      frames: {
        idle: ['idle'], walk: ['walk_1', 'idle', 'walk_2', 'idle'], jump: ['jump_1', 'jump_2'],
        block: 'block', hit: 'hit', knockdown: ['knockdown_1', 'knockdown_2'],
        getup: ['getup_1', 'getup_2'], evade: ['evade_1', 'evade_2', 'evade_3'], win: 'getup_2',
      },
      moves: {
        punch: {
          frames: [['punch_1', 5], ['punch_2', 7], ['punch_3', 8]],
          hits: [{ from: 5, to: 12, x: [30, 140], y: [150, 225], ...P(55, 17, 5) }],
          chain: { on: 'punch', from: 8, to: 'power' },
        },
        power: {
          frames: [['uppercut_1', 4], ['power_punch', 16]],
          hits: [{ from: 4, to: 11, x: [30, 160], y: [150, 230], ...P(80, 26, 13) }],
          sfx: 'heavy',
        },
        kick: {
          frames: [['kick_1', 6], ['kick_2', 7], ['kick_3', 9]],
          hits: [{ from: 6, to: 15, x: [30, 165], y: [90, 185], ...P(70, 20, 7) }],
        },
        heavy: { // uppercut launcher
          frames: [['uppercut_1', 8], ['uppercut_2', 5], ['uppercut_3', 14]],
          hits: [{ from: 8, to: 16, x: [20, 125], y: [130, 280], ...P(110, 0, 5, { kd: true, launch: 15 }) }],
          sfx: 'heavy',
        },
        sweep: { // roundhouse
          frames: [['roundhouse_1', 8], ['roundhouse_2', 5], ['roundhouse_3', 14]],
          hits: [{ from: 8, to: 17, x: [30, 175], y: [100, 240], ...P(120, 0, 8, { kd: true }) }],
          sfx: 'heavy',
        },
        shoot: {
          frames: [['revolver_draw', 8], ['revolver_aim_1', 6], ['revolver_fire', 10], ['revolver_aim_2', 8]],
          shots: [{ at: 14, dx: 110, dy: 190, vx: 17, dmg: 60, r: 9, kind: 'bullet', stun: 14, push: 4 }],
          cool: 55, sfx: null,
        },
        special: { // dual revolvers: two shots
          frames: [['guns_draw', 10], ['guns_aim', 8], ['guns_fire', 8], ['guns_aim', 6], ['guns_fire', 8], ['guns_holster', 12]],
          shots: [
            { at: 18, dx: 115, dy: 200, vx: 18, dmg: 55, r: 9, kind: 'bullet', stun: 16, push: 4 },
            { at: 32, dx: 115, dy: 185, vx: 18, dmg: 55, r: 9, kind: 'bullet', stun: 20, push: 9 },
          ],
          cool: 160, sfx: null,
        },
        air: {
          frames: [['dive_kick', 40]], air: true, dive: [8, 6],
          hits: [{ from: 2, to: 40, x: [0, 140], y: [0, 130], ...P(85, 0, 6, { kd: true }) }],
        },
      },
    },

    competitor1: {
      name: 'SCARLET', title: 'The Blade', sprite: 'competitor1', color: '#c8334a',
      hp: 1000, speed: 4.8, jump: 19,
      frames: {
        idle: ['idle'], walk: ['walk_1', 'idle', 'walk_2', 'idle'], jump: ['run', 'run'],
        block: 'getup_2', hit: 'knockdown_1', knockdown: ['knockdown_1', 'knockdown_2'],
        getup: ['getup_1', 'getup_2'], evade: ['evade_1', 'evade_2', 'evade_3'], win: 'getup_2',
      },
      moves: {
        punch: {
          frames: [['heavy_1', 5], ['heavy_4', 8], ['heavy_1', 6]],
          hits: [{ from: 5, to: 12, x: [30, 150], y: [150, 225], ...P(50, 16, 5) }],
          chain: { on: 'punch', from: 8, to: 'kick' },
        },
        kick: {
          frames: [['spin_2', 5], ['spin_1', 10], ['spin_2', 6]],
          hits: [{ from: 5, to: 15, x: [30, 175], y: [90, 185], ...P(65, 20, 7) }],
        },
        heavy: {
          frames: [['heavy_1', 7], ['heavy_2', 5], ['heavy_3', 14]],
          hits: [{ from: 7, to: 15, x: [20, 130], y: [130, 280], ...P(105, 0, 5, { kd: true, launch: 15 }) }],
          sfx: 'heavy',
        },
        sweep: {
          frames: [['spin_2', 7], ['spin_3', 14]],
          hits: [{ from: 7, to: 16, x: [30, 165], y: [120, 270], ...P(115, 0, 8, { kd: true }) }],
          sfx: 'heavy',
        },
        shoot: { // knife flurry: two quick slashes
          frames: [['weapon_1', 8], ['weapon_2', 7], ['weapon_3', 7], ['weapon_4', 10]],
          hits: [
            { from: 8, to: 14, x: [30, 185], y: [120, 230], ...P(45, 18, 3) },
            { from: 22, to: 30, x: [30, 190], y: [120, 230], ...P(60, 22, 10) },
          ],
          cool: 70, sfx: 'slash',
        },
        special: { // lunging counter kick
          frames: [['counter', 24]], lunge: 10,
          hits: [{ from: 4, to: 18, x: [20, 165], y: [60, 210], ...P(95, 0, 8, { kd: true }) }],
          cool: 130, sfx: 'heavy',
        },
        air: {
          frames: [['air', 40]], air: true, dive: [8, 6],
          hits: [{ from: 2, to: 40, x: [0, 140], y: [0, 130], ...P(85, 0, 6, { kd: true }) }],
        },
      },
    },

    competitor2: {
      name: 'FANG', title: 'The Painted Dog', sprite: 'competitor2', color: '#c88a3a',
      hp: 920, speed: 5.4, jump: 20,
      frames: {
        idle: ['idle'], walk: ['walk_1', 'idle', 'walk_2', 'idle'], jump: ['run', 'run'],
        block: 'getup_2', hit: 'knockdown_1', knockdown: ['knockdown_1', 'knockdown_2'],
        getup: ['getup_1', 'getup_2'], evade: ['evade_1', 'evade_2', 'evade_3'], win: 'getup_2',
      },
      moves: {
        punch: {
          frames: [['heavy_1', 4], ['heavy_4', 7], ['heavy_1', 5]],
          hits: [{ from: 4, to: 10, x: [30, 145], y: [150, 225], ...P(45, 15, 5) }],
          chain: { on: 'punch', from: 7, to: 'shoot' },
        },
        kick: {
          frames: [['spin_2', 5], ['spin_1', 9], ['spin_2', 5]],
          hits: [{ from: 5, to: 14, x: [30, 170], y: [90, 185], ...P(60, 19, 7) }],
        },
        heavy: {
          frames: [['heavy_1', 6], ['heavy_2', 5], ['heavy_3', 12]],
          hits: [{ from: 6, to: 14, x: [20, 130], y: [130, 280], ...P(100, 0, 5, { kd: true, launch: 15 }) }],
          sfx: 'heavy',
        },
        sweep: {
          frames: [['spin_2', 6], ['spin_3', 13]],
          hits: [{ from: 6, to: 15, x: [30, 165], y: [120, 270], ...P(105, 0, 8, { kd: true }) }],
          sfx: 'heavy',
        },
        shoot: { // claw rake
          frames: [['weapon_1', 6], ['weapon_2', 6], ['weapon_3', 6], ['weapon_4', 9]],
          hits: [
            { from: 6, to: 12, x: [30, 175], y: [120, 230], ...P(40, 17, 3) },
            { from: 18, to: 26, x: [30, 180], y: [120, 230], ...P(55, 22, 10) },
          ],
          cool: 60, sfx: 'slash',
        },
        special: {
          frames: [['counter', 22]], lunge: 12,
          hits: [{ from: 3, to: 16, x: [20, 165], y: [60, 210], ...P(90, 0, 8, { kd: true }) }],
          cool: 110, sfx: 'heavy',
        },
        air: {
          frames: [['air', 40]], air: true, dive: [9, 7],
          hits: [{ from: 2, to: 40, x: [0, 140], y: [0, 130], ...P(80, 0, 6, { kd: true }) }],
        },
      },
    },

    competitor3: {
      name: 'HEX', title: 'The Hollow Wizard', sprite: 'competitor3', color: '#56e07a',
      hp: 900, speed: 4.0, jump: 18, teleport: true,
      frames: {
        idle: ['idle'], walk: ['walk_1', 'idle', 'walk_2', 'idle'], jump: ['walk_2', 'walk_2'],
        block: 'counter', hit: 'evade_1', knockdown: ['fall_1', 'fall_2'],
        getup: ['fall_3', 'recover'], evade: ['evade_1', 'evade_1', 'evade_1'], win: 'portal',
      },
      moves: {
        punch: {
          frames: [['dagger', 4], ['cast_2', 9], ['dagger', 6]],
          hits: [{ from: 4, to: 12, x: [30, 150], y: [130, 215], ...P(45, 16, 5) }],
          chain: { on: 'punch', from: 9, to: 'kick' }, sfx: 'magic',
        },
        kick: { // staff swing
          frames: [['staff_1', 6], ['staff_swing', 12]],
          hits: [{ from: 6, to: 15, x: [30, 190], y: [70, 200], ...P(65, 20, 8) }],
        },
        heavy: { // crescent sweep, reaches behind too
          frames: [['staff_1', 8], ['staff_2', 8], ['staff_3', 12]],
          hits: [{ from: 8, to: 20, x: [-60, 200], y: [0, 230], ...P(100, 0, 7, { kd: true }) }],
          sfx: 'heavy',
        },
        sweep: { // arcane spin: hits all around
          frames: [['spin', 26]],
          hits: [{ from: 4, to: 20, x: [-120, 125], y: [0, 210], ...P(75, 0, 9, { kd: true, launch: 12 }) }],
          sfx: 'magic',
        },
        shoot: {
          frames: [['bolt_1', 8], ['bolt_2', 8], ['bolt_3', 12]],
          shots: [{ at: 16, dx: 120, dy: 175, vx: 12, dmg: 55, r: 14, kind: 'orb', stun: 16, push: 5 }],
          cool: 60, sfx: 'magic',
        },
        special: { // magic missile
          frames: [['bolt_2', 12], ['missile', 26]],
          shots: [{ at: 14, dx: 140, dy: 165, vx: 10, dmg: 110, r: 28, kind: 'missile', stun: 0, push: 8, kd: true }],
          cool: 200, sfx: 'magic',
        },
        air: {
          frames: [['slam', 40]], air: true, dive: [6, 9],
          hits: [{ from: 2, to: 40, x: [-20, 130], y: [0, 150], ...P(85, 0, 6, { kd: true }) }],
        },
      },
    },
  };

  function challenger(c) {
    return {
      name: c.name, title: c.title, sprite: c.id, color: c.color,
      hp: c.hp, speed: c.speed, jump: c.jump, teleport: !!c.teleport, keepBlock: !!c.keepBlock,
      frames: {
        idle: ['idle'], walk: c.walk || ['walk_1', 'idle', 'walk_2', 'idle'], jump: c.jumpFrames,
        block: c.block, hit: c.hit, knockdown: c.knockdown, getup: c.getup,
        evade: c.evade, win: c.win,
      },
      moves: {
        punch: {
          frames: c.punch,
          hits: [{ from: 5, to: 13, x: [25, 150], y: [140, 230], ...P(c.damage[0], 17, 5) }],
          chain: { on: 'punch', from: 8, to: 'kick' },
        },
        kick: {
          frames: c.kick,
          hits: [{ from: 6, to: 15, x: [25, 175], y: [70, 200], ...P(c.damage[1], 20, 7) }],
        },
        heavy: {
          frames: c.heavy,
          hits: [{ from: 8, to: 17, x: [20, 155], y: [100, 280], ...P(c.damage[2], 0, 7, { kd: true, launch: 13 }) }],
          sfx: 'heavy',
        },
        sweep: {
          frames: c.sweep,
          hits: [{ from: 7, to: 18, x: [-20, 180], y: [0, 235], ...P(c.damage[3], 0, 8, { kd: true }) }],
          sfx: 'heavy',
        },
        shoot: c.shoot,
        special: c.special,
        air: {
          frames: [[c.air, 40]], air: true, dive: c.dive || [8, 6],
          hits: [{ from: 2, to: 40, x: [0, 150], y: [0, 145], ...P(c.damage[4], 0, 7, { kd: true }) }],
        },
      },
    };
  }

  Object.assign(CHARACTERS, {
    competitor4: challenger({
      id: 'competitor4', name: 'FROST', title: 'The Tundra Bruiser', color: '#b9e8f6',
      hp: 1160, speed: 4.0, jump: 17,
      block: 'block', hit: 'evade_1', knockdown: ['knockdown_1', 'knockdown_2'],
      getup: ['getup_1', 'getup_2'], evade: ['evade_1', 'evade_2', 'evade_3'], win: 'getup_2',
      jumpFrames: ['run', 'dive_kick'], air: 'dive_kick',
      punch: [['uppercut_1', 5], ['uppercut_2', 7], ['uppercut_3', 8]],
      kick: [['roundhouse_1', 6], ['roundhouse_2', 7], ['roundhouse_3', 9]],
      heavy: [['uppercut_1', 8], ['uppercut_2', 5], ['power_punch', 14]],
      sweep: [['roundhouse_1', 8], ['roundhouse_2', 5], ['roundhouse_3', 14]],
      damage: [55, 72, 112, 118, 88],
      shoot: {
        frames: [['weapon_1', 8], ['weapon_2', 10]],
        hits: [{ from: 7, to: 18, x: [25, 190], y: [50, 235], ...P(68, 18, 6) }],
        cool: 65, sfx: 'slash',
      },
      special: {
        frames: [['special', 30]],
        hits: [{ from: 7, to: 24, x: [45, 260], y: [0, 245], ...P(145, 0, 13, { kd: true }) }],
        cool: 185, sfx: 'heavy',
      },
    }),
    competitor5: challenger({
      id: 'competitor5', name: 'SABLE', title: 'The Horned Outlaw', color: '#d9a762',
      hp: 960, speed: 5.0, jump: 20,
      block: 'block', hit: 'hit', knockdown: ['hit_alt', 'hit'],
      getup: ['idle', 'block'], evade: ['jump_1', 'jump_1', 'jump_1'], win: 'weapon_4',
      walk: ['walk_1', 'idle', 'walk_2', 'idle'], jumpFrames: ['jump_1', 'jump_1'], air: 'kick_3',
      punch: [['punch_1', 5], ['punch_2', 7], ['punch_3', 8]],
      kick: [['kick_1', 6], ['kick_2', 7], ['kick_3', 9]],
      heavy: [['punch_1', 7], ['punch_2', 5], ['punch_3', 14]],
      sweep: [['kick_1', 7], ['kick_2', 6], ['kick_3', 13]],
      damage: [52, 67, 102, 108, 82],
      shoot: {
        frames: [['weapon_1', 7], ['weapon_2', 7], ['weapon_3', 7], ['weapon_4', 10]],
        hits: [
          { from: 7, to: 14, x: [25, 215], y: [80, 245], ...P(48, 17, 4) },
          { from: 21, to: 30, x: [25, 230], y: [80, 245], ...P(58, 22, 9) },
        ],
        cool: 70, sfx: 'slash',
      },
      special: {
        frames: [['weapon_4', 25]], lunge: 9,
        hits: [{ from: 4, to: 19, x: [20, 230], y: [50, 240], ...P(100, 0, 10, { kd: true }) }],
        cool: 125, sfx: 'heavy',
      },
    }),
    competitor6: challenger({
      id: 'competitor6', name: 'CHAIN', title: 'The Cybernetic Brawler', color: '#45d9e5',
      hp: 1080, speed: 4.4, jump: 18,
      block: 'block', hit: 'hit', knockdown: ['idle_alt', 'hit'],
      getup: ['idle', 'idle_alt'], evade: ['evade_1', 'evade_1', 'evade_1'], win: 'idle_alt',
      jumpFrames: ['kick_1', 'kick_2'], air: 'kick_3',
      punch: [['punch_1', 5], ['punch_2', 7], ['punch_3', 8]],
      kick: [['kick_1', 6], ['kick_2', 7], ['kick_3', 9]],
      heavy: [['heavy_1', 7], ['heavy_2', 5], ['heavy_3', 14]],
      sweep: [['heavy_2', 6], ['heavy_3', 7], ['heavy_4', 14]],
      damage: [53, 70, 106, 112, 84],
      shoot: {
        frames: [['punch_2', 9], ['punch_3', 15]],
        hits: [{ from: 7, to: 19, x: [55, 285], y: [80, 255], ...P(72, 20, 8) }],
        cool: 80, sfx: 'heavy',
      },
      special: {
        frames: [['heavy_3', 10], ['heavy_4', 18]],
        hits: [{ from: 8, to: 24, x: [35, 285], y: [30, 265], ...P(132, 0, 13, { kd: true }) }],
        cool: 170, sfx: 'heavy',
      },
    }),
    competitor7: challenger({
      id: 'competitor7', name: 'SAINT', title: 'The Chain Warden', color: '#f3e1b7',
      hp: 920, speed: 4.2, jump: 19, teleport: true,
      block: 'block', hit: 'hit', knockdown: ['recover', 'recover'],
      getup: ['getup_1', 'idle_alt'], evade: ['evade_1', 'evade_1', 'evade_1'], win: 'utility_1',
      walk: ['walk_1', 'idle', 'walk_1', 'idle'], jumpFrames: ['walk_1', 'run'], air: 'kick_3',
      punch: [['cast_1', 5], ['cast_2', 7], ['cast_3', 8]],
      kick: [['kick_1', 6], ['kick_2', 7], ['kick_3', 9]],
      heavy: [['cast_1', 7], ['cast_2', 5], ['cast_3', 14]],
      sweep: [['cast_2', 7], ['cast_3', 6], ['cast_4', 13]],
      damage: [48, 62, 96, 102, 80],
      shoot: {
        frames: [['bolt_1', 8], ['bolt_2', 8], ['bolt_3', 12]],
        shots: [{ at: 16, dx: 115, dy: 180, vx: 13, dmg: 58, r: 15, kind: 'orb', stun: 17, push: 6 }],
        cool: 68, sfx: 'magic',
      },
      special: {
        frames: [['bolt_2', 12], ['bolt_3', 25]],
        shots: [{ at: 14, dx: 130, dy: 175, vx: 11, dmg: 112, r: 26, kind: 'missile', stun: 0, push: 10, kd: true }],
        cool: 190, sfx: 'magic',
      },
    }),
    // raw-assets/pop_diva.jpg (2026-09-28). Her kick and its music-note blast are one
    // painted frame (kick_fx), so the kick, the dive kick and the special all use it.
    competitor8: challenger({
      id: 'competitor8', name: 'STARLA', title: 'The Pop Diva', color: '#e59ae0',
      hp: 940, speed: 5.0, jump: 20,
      block: 'block', hit: 'hit', knockdown: ['hit', 'taunt'],
      getup: ['taunt', 'idle_alt'], evade: ['jump_1', 'jump_1', 'jump_1'], win: 'pose',
      // her sheet idle has a hand on the hip, so the stride cycles through the run pose instead
      walk: ['walk_1', 'walk_2', 'run', 'walk_2'],
      jumpFrames: ['jump_1', 'jump_1'], air: 'kick_fx',
      punch: [['punch_1', 5], ['punch_2', 7], ['punch_3', 8]],
      kick: [['kick_recover', 6], ['kick_fx', 9], ['kick_recover', 7]],
      heavy: [['punch_3', 8], ['punch_2', 5], ['punch_1', 14]],
      sweep: [['kick_recover', 7], ['kick_fx', 17]],
      damage: [50, 68, 100, 108, 82],
      shoot: { // the water-swirl punch throws a sound wave
        frames: [['punch_1', 8], ['punch_2', 16]],
        shots: [{ at: 10, dx: 120, dy: 185, vx: 13, dmg: 56, r: 15, kind: 'orb', stun: 17, push: 6 }],
        cool: 65, sfx: 'magic',
      },
      special: { // music-note blast: a long reach off the kick
        frames: [['kick_recover', 10], ['kick_fx', 24]], lunge: 6,
        hits: [{ from: 10, to: 28, x: [40, 300], y: [0, 250], ...P(128, 0, 13, { kd: true }) }],
        cool: 175, sfx: 'magic',
      },
    }),
    // raw-assets/Hawaain_surfer.jpg (2026-09-28). The sheet's bottom row is cut-off
    // head shots, so it isn't extracted; he has no knockdown/get-up art of his own.
    competitor9: challenger({
      id: 'competitor9', name: 'KAI', title: 'The North Shore Surfer', color: '#ffb347',
      hp: 1040, speed: 4.6, jump: 19, keepBlock: true,
      block: 'block', hit: 'hit', knockdown: ['hit', 'hit'],
      getup: ['jump_1', 'idle'], evade: ['run', 'run', 'run'], win: 'board_wave',
      walk: ['walk_1', 'walk_2', 'run', 'walk_2'],
      jumpFrames: ['jump_1', 'jump_1'], air: 'kick_3',
      punch: [['board_punch', 5], ['board_wave', 7], ['board_punch', 8]],
      kick: [['kick_1', 6], ['kick_3', 9], ['kick_1', 7]],
      heavy: [['board_punch', 8], ['spark_punch', 5], ['spark_punch', 14]],
      sweep: [['kick_1', 7], ['kick_board', 6], ['kick_board', 13]],
      damage: [54, 70, 104, 112, 84],
      shoot: { // board-and-fist splash: a wave that rolls forward
        frames: [['board_punch', 8], ['board_wave', 16]],
        shots: [{ at: 10, dx: 150, dy: 180, vx: 12, dmg: 60, r: 16, kind: 'orb', stun: 18, push: 7 }],
        cool: 70, sfx: 'magic',
      },
      special: { // surfboard kick riding a wave
        frames: [['kick_1', 9], ['kick_board', 22]], lunge: 11,
        hits: [{ from: 8, to: 24, x: [30, 280], y: [20, 240], ...P(135, 0, 13, { kd: true }) }],
        cool: 180, sfx: 'heavy',
      },
    }),
  });

  // ---- qualifying-round goons
  // Real art: tools/generate_all.py + extract_sprites.py write assets/sprites/goon_*/
  // with frames idle, walk_1, walk_2, back_1, attack_1, attack_2, hit, down.
  // Until those exist the engine falls back to `placeholder`: an existing
  // fighter's sprite, recoloured with a canvas filter, frames mapped by alias.
  const PH_ALIAS = {
    competitor1: { attack_1: 'heavy_4', attack_2: 'spin_1', hit: 'knockdown_1', down: 'knockdown_2', back_1: 'walk_2' },
    competitor2: { attack_1: 'heavy_4', attack_2: 'spin_1', hit: 'knockdown_1', down: 'knockdown_2', back_1: 'walk_2' },
    competitor3: { attack_1: 'cast_2', attack_2: 'staff_swing', hit: 'evade_1', down: 'fall_2', back_1: 'walk_2' },
  };
  // One knob for qualifying difficulty. 2026-09-26: the user found v1 "a bit
  // easy" (1.0 / 1.0 / windup 8), so goons got tougher and faster to swing.
  const GOON_TUNING = { hp: 1.35, dmg: 1.25, windup: 6, speed: 1.1 };
  function goon(id, name, title, color, o) {
    const T = GOON_TUNING, w = T.windup;
    o = { ...o, dmg1: Math.round(o.dmg1 * T.dmg), dmg2: Math.round(o.dmg2 * T.dmg) };
    return {
      name, title, sprite: id, color, goon: true,
      hp: Math.round(o.hp * T.hp), speed: o.speed * T.speed, jump: 17, size: o.size || 1,
      frames: {
        idle: ['idle'], walk: ['walk_1', 'idle', 'walk_2', 'idle'], back: ['back_1', 'idle'],
        jump: ['idle', 'idle'], block: 'idle', hit: 'hit', knockdown: ['hit', 'down'],
        getup: ['idle', 'idle'], evade: ['idle'], win: 'idle',
      },
      moves: {
        punch: {
          frames: [['idle', w], ['attack_1', 11], ['idle', 7]],
          hits: [{ from: w, to: w + 8, x: [30, 150], y: [110, 230], ...P(o.dmg1, 18, 6) }],
        },
        kick: {
          frames: [['idle', w + 5], ['attack_2', 13], ['idle', 9]],
          hits: [{ from: w + 5, to: w + 15, x: [30, 170], y: [40, 230], ...P(o.dmg2, 24, 9, { kd: !!o.kd }) }],
          sfx: 'heavy',
        },
      },
      placeholder: { sprite: o.base, filter: o.filter, alias: PH_ALIAS[o.base] },
    };
  }
  Object.assign(CHARACTERS, {
    goon_bouncer: goon('goon_bouncer', 'KNUCKLES', 'Saloon Bouncer', '#d0a070',
      { hp: 300, speed: 3.4, size: 1.12, dmg1: 50, dmg2: 70, kd: true, base: 'competitor2', filter: 'brightness(0.55) contrast(1.2)' }),
    goon_rattler: goon('goon_rattler', 'RATTLER', 'Knife Outlaw', '#b0b8a0',
      { hp: 200, speed: 4.8, size: 0.95, dmg1: 40, dmg2: 50, base: 'competitor1', filter: 'grayscale(0.7) brightness(0.85)' }),
    goon_buzzard: goon('goon_buzzard', 'BUZZARD', 'Vulture Bandit', '#c07aa0',
      { hp: 220, speed: 4.2, dmg1: 45, dmg2: 55, base: 'competitor2', filter: 'hue-rotate(250deg) saturate(0.7)' }),
    goon_dynamite: goon('goon_dynamite', 'DYNAMITE DALE', 'Crazed Miner', '#e0a040',
      { hp: 240, speed: 3.8, size: 1.03, dmg1: 45, dmg2: 65, kd: true, base: 'competitor1', filter: 'sepia(0.9) brightness(0.7)' }),
    goon_coyote: goon('goon_coyote', 'COYOTE', 'Cattle Rustler', '#d8b070',
      { hp: 210, speed: 5.0, dmg1: 40, dmg2: 55, base: 'competitor2', filter: 'hue-rotate(35deg) brightness(1.15)' }),
    goon_digger: goon('goon_digger', 'GRAVE DIGGER', 'Undead Undertaker', '#80e0a0',
      { hp: 250, speed: 3.6, size: 1.05, dmg1: 45, dmg2: 60, kd: true, base: 'competitor3', filter: 'hue-rotate(80deg) brightness(1.5)' }),
  });

  const QUALIFY = {
    goons: ['goon_rattler', 'goon_coyote', 'goon_buzzard', 'goon_dynamite', 'goon_digger', 'goon_bouncer'],
    attempts: 3,
    maxActive: 3,      // goons in the fight at once; the rest wait in the background
    maxAttackers: 3,   // goons allowed to swing at the same moment (was 2: too easy)
    stage: 'Railroad Depot Corral',
  };
  // was react 26 / block 0.1 / aggression 0.6 ("a bit easy")
  const AI_GOON = { react: 17, block: 0.2, evade: 0, aggression: 0.75, jumpin: 0, ranged: 0, combo: 0 };

  // The gauntlet is every fighter except the player's, in a random order that
  // is reshuffled for each run (see beginGauntlet in game.js). This list is
  // the pool.
  const GAUNTLET_ORDER = ['ant', 'competitor1', 'competitor2', 'competitor3',
    'competitor4', 'competitor5', 'competitor6', 'competitor7', 'competitor8', 'competitor9'];

  // AI grows sharper with each gauntlet stage.
  const AI_LEVELS = [
    { react: 24, block: 0.22, evade: 0.08, aggression: 0.5, jumpin: 0.12, ranged: 0.35, combo: 0.3 },
    { react: 17, block: 0.4, evade: 0.14, aggression: 0.62, jumpin: 0.18, ranged: 0.45, combo: 0.55 },
    { react: 11, block: 0.55, evade: 0.2, aggression: 0.72, jumpin: 0.22, ranged: 0.55, combo: 0.8 },
  ];
  // per-fighter personality nudges on top of the level
  const AI_STYLE = {
    competitor2: { aggression: 0.12, jumpin: 0.08, ranged: -0.1 },
    competitor3: { ranged: 0.3, aggression: -0.08 },
  };

  const STAGES = [
    { name: 'Main Street at Sundown', kind: 'street' },
    { name: 'Red Rock Canyon', kind: 'canyon' },
    { name: 'Boot Hill at Midnight', kind: 'graveyard' },
    // generated backdrops (assets/stages/<img>.jpg); `kind` is the painted fallback
    { name: 'Frozen Pass', kind: 'graveyard', img: 'frozen' },
    { name: 'Lantern-lit Silver Mine', kind: 'canyon', img: 'mine' },
    { name: 'Mission Ruins at Dawn', kind: 'street', img: 'mission' },
  ];

  // the desktop keys are the player's own choice: see BIND_ACTIONS in game.js
  window.GAME_DATA = { CHARACTERS, GAUNTLET_ORDER, AI_LEVELS, AI_STYLE, AI_GOON, STAGES, QUALIFY };
})();
