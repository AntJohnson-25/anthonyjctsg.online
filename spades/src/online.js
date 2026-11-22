// Playing with friends, peer to peer, through GameDB (G:\ICM Workspace\01-Projects\gamedb).
// There is no game server. The player who creates the room is the host: their browser holds
// the GameDB database (accounts, the room, results, the wins board) and friends connect
// straight to it. See src/gamedb-p2p.js for how two browsers find each other:
//   - a room code (one click; the handshake goes through free public meeting points),
//   - a friend code (call someone you have played with; only they get the seat), or
//   - an invite text passed by hand (depends on nothing; for when the code will not connect).
// GameDB keeps the link up by itself: it repairs a dropped link, and if two networks will not
// connect directly the game goes through the meeting points instead (slower, still private).
//
// net.js already knows how to run a table for several people: it was written for a
// "lobby" object (HopLobby) that passes messages between players and says who is host.
// This file gives it that same object, built on a GameDB room:
//   - HS.Online.create() / join(code) put you in a room and set globalThis.HopLobby;
//   - HopLobby.send(data, to) goes through the room's relay (to one player, or everyone);
//   - the room's host is the lobby host. If the host leaves, the next player in seat order
//     takes the room over on their own device, and net.js carries the game on there.
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const APP = "villa-spades";
  const O = {
    lib: null, kit: null, host: null, client: null, session: null,
    room: null, code: "", lobby: null, offset: 0, table: -1, hostTable: -1, pendingInvite: null,
    ident: null, ear: null, slowSaid: false,
    p2p: null,      // test hook: extra options for hostRoom / joinRoom / listen / callFriend (a stand-in network)
    storage: null,  // test hook: where the host's database is kept
    on: {}          // joined(ctx), left(reason), room(room), table(k), error(message), dropped(), back(), slow(),
                    // calling(friendCode), call({ name, known, accept(name), decline() })
  };
  const MODES = { spades: { minPlayers: 1, maxPlayers: 4 } };
  O.enabled = typeof RTCPeerConnection !== "undefined";
  // ?p=2 in the address is a second player on the same computer (for trying it out in two tabs).
  O.profile = typeof location === "undefined" ? "" : (new URLSearchParams(location.search).get("p") || "");
  function emit(name, a) { if (O.on[name]) { try { O.on[name](a); } catch (e) { console.error(e); } } }
  function say(e, fallback) { return e && e.name === "GameClientError" && e.message ? e.message.charAt(0).toUpperCase() + e.message.slice(1) : fallback; }

  async function lib() {
    if (!O.lib) {
      const at = function (f) { return new URL("src/" + f, document.baseURI).href; };
      const m = await Promise.all([import(at("gamedb.js")), import(at("gamedb-kit.js")), import(at("gamedb-p2p.js"))]);
      O.lib = { GameDB: m[0].GameDB, GameDBError: m[0].GameDBError, localStorageStorage: m[0].localStorageStorage, GameKit: m[1].GameKit, hostRoom: m[2].hostRoom, joinRoom: m[2].joinRoom, answerInvite: m[2].answerInvite,
        listen: m[2].listen, callFriend: m[2].callFriend, deviceIdentity: m[2].deviceIdentity, cleanFriendCode: m[2].cleanFriendCode };
    }
    return O.lib;
  }
  // This device's player (id, key, friend code, friends list): one for good, kept in the same storage.
  function me(L) { return O.ident || (O.ident = L.deviceIdentity(O.store || undefined, O.profile || "")); }
  // If the host leaves, this device may take the room over: with its own database and the same rules.
  function handoffFor(L) { return function () { const kit = openKit(L); return { db: kit.db, kit: kit, modes: MODES, actions: ACTIONS, log: function () {}, maxMessagesPerSecond: O.maxRate || 60 }; }; }
  // The host's database: kept on this device, so the wins board and match history build up over time.
  function openKit(L) {
    if (O.kit) return O.kit;
    let db = null;
    try {
      let storage = O.storage;
      if (!storage && typeof localStorage !== "undefined") { localStorage.setItem("villaspades.probe", "1"); localStorage.removeItem("villaspades.probe"); storage = L.localStorageStorage("villaspades.gamedb" + O.profile + ":"); }
      db = L.GameDB.open({ name: "spades", storage: storage || null });
    } catch (e) { db = L.GameDB.open({ name: "spades" }); }   // storage blocked or damaged: keep it in memory
    O.kit = new L.GameKit(db);
    O.kit.defineBoard("spades_wins");
    return O.kit;
  }
  // What friends may ask the host's database to do.
  const lastReport = {};
  const ACTIONS = {
    // The host reports a finished game: { winners: [player ids], losers: [player ids], scores: [us, them] }.
    spadesResult: function (ctx, a) {
      const db = ctx.db, kit = ctx.kit, winners = a.winners || [], losers = a.losers || [];
      const deny = function (m) { throw new O.lib.GameDBError("FORBIDDEN", m); };
      const rp = db.get("SELECT code FROM gk_room_players WHERE player_id = ?", [ctx.player]);
      const room = rp && db.get("SELECT code, mode, host FROM gk_rooms WHERE code = ?", [rp.code]);
      if (!room || room.host !== ctx.player) deny("only the host can report a result");
      const t = Date.now();
      if (t - (lastReport[room.code] || 0) < 60000) deny("a result was just recorded for this room");
      const members = new Set(db.query("SELECT player_id FROM gk_room_players WHERE code = ?", [room.code]).map(function (r) { return r.player_id; }));
      const ok = function (list) { return Array.isArray(list) && list.length <= 2 && list.every(function (id) { return members.has(id); }); };
      if (!ok(winners) || !ok(losers) || winners.some(function (id) { return losers.indexOf(id) >= 0; })) deny("winners and losers must be players in this room");
      lastReport[room.code] = t;
      return db.transaction(function () {
        const id = kit.recordMatch({ mode: "spades", data: { scores: a.scores || null }, players: winners.map(function (p) { return { id: p, result: "win" }; }).concat(losers.map(function (p) { return { id: p, result: "loss" }; })) });
        winners.forEach(function (p) {
          const wins = db.get("SELECT COUNT(*) AS n FROM gk_match_players mp JOIN gk_matches m ON m.id = mp.match_id WHERE mp.player_id = ? AND mp.result = 'win' AND m.mode = 'spades'", [p]).n;
          kit.submitScore("spades_wins", p, wins);
        });
        return id;
      });
    }
  };

  // The HopLobby-shaped object net.js talks to.
  function makeLobby() {
    const handlers = {};
    const L = {
      context: { playerId: O.session.playerId, hostId: O.room.host, standalone: false },
      players: [], me: { id: O.session.playerId, name: O.session.name || "Player" },
      now: function () { return Date.now() + O.offset; },
      send: function (d, to) { if (O.client) O.client.relay(d, to).catch(function () { /* a lost message heals: net.js resends */ }); },
      on: function (ev, fn) { handlers[ev] = fn; },
      _fire: function (ev, a, b) { if (handlers[ev]) handlers[ev](a, b); }
    };
    return L;
  }
  function setRoom(room) {
    O.room = room; O.code = room.code;
    const L = O.lobby;
    if (!L) return;
    // Only the players connected right now: a bot covers anyone who dropped until they are back
    // (GameDB keeps their seat in the room meanwhile, so they come back as themselves).
    L.players = room.players.filter(function (p) { return p.connected !== false; }).map(function (p) { return { id: p.id, name: p.name || "Player", isHost: p.id === room.host }; });
    const me = L.players.find(function (p) { return p.id === L.me.id; });
    if (me) L.me.name = me.name;
    L.context.hostId = room.host;
    L._fire("players", L.players, room.host);
    emit("room", room);
  }
  function onRelay(m) {
    const d = m.data, L = O.lobby;
    if (!L || !d || typeof d !== "object") return;
    // Which of the four tables the host sat at (not part of net.js's own messages).
    if (d.t === "tbl") { if (m.from === L.context.hostId && Number.isInteger(d.k) && d.k >= 0 && d.k < 4) { O.table = d.k; emit("table", d.k); } return; }
    if (d.t === "hi" && O.isHost() && O.hostTable >= 0) L.send({ t: "tbl", k: O.hostTable }, m.from);
    L._fire("message", d, m.from);
  }
  function enter(room) {
    O.room = room; O.code = room.code; O.table = -1; O.hostTable = -1;
    O.lobby = makeLobby();
    globalThis.HopLobby = O.lobby;
    setRoom(room);
    if (!O.answering) hangUpEar(); // in a room: friends' calls wait until we are out again
    emit("joined", O.lobby.context);
  }
  // Out of the room, back to the solo game. `reason` is shown to the player when it was not their choice.
  // A host who leaves hands the room on: the others keep playing, the next in seat order hosting.
  function exit(reason) {
    const c = O.client, h = O.host;
    O.client = null; O.host = null; O.session = null;
    O.room = null; O.code = ""; O.lobby = null; O.table = -1; O.hostTable = -1; O.slowSaid = false;
    delete globalThis.HopLobby;
    if (h) h.close({ handoff: true }); else if (c) c.close();
    emit("left", reason || "");
    O.listen();
  }
  // Re-time the table by the host's clock (after joining, and after a new host takes over).
  async function timeTo(client) {
    if (O.host) { O.offset = 0; return; }
    try { const t0 = Date.now(), ts = await client.time(); if (O.client === client) O.offset = ts - (t0 + Date.now()) / 2; } catch (e) { /* keep the old offset */ }
  }
  // Take a connected client (ours as host, or one that reached a friend's room) and step into the room.
  async function adopt(client, room, host) {
    O.client = client; O.host = host || null; O.session = client.me; O.offset = 0;
    let away = false;
    client.on("room", function (e) { if (O.client === client && O.room && e.room.code === O.room.code) setRoom(e.room); });
    client.on("relay", function (m) { if (O.client === client) onRelay(m); });
    client.on("close", function () { if (O.client === client && !O.host) { away = true; emit("dropped"); } });
    // The host left and this device took the room over (net.js sees us become host and carries on).
    client.on("host", function (h) { if (O.client === client) { O.host = h; O.offset = 0; } });
    client.on("open", function (s) {
      if (O.client !== client) return;
      O.session = s;
      const back = function (r) { if (O.client !== client) return; setRoom(r); timeTo(client); if (O.lobby) O.lobby._fire("relay", "open"); if (away) { away = false; emit("back"); } slowNote(client); };
      // Back after a dropped connection: still seated (same host, or the one who took over), or seat again if it was freed.
      if (O.code && s.room && s.room.code === O.code) back(s.room);
      else if (O.code) client.joinRoom(O.code).then(back, function () { if (O.client === client) exit("The room is no longer open."); });
    });
    client.on("lost", function () { if (O.client === client) exit("The host left, so the room has closed."); });
    client.on("kicked", function () { if (O.client === client) exit("You joined this room from another tab."); });
    // Everyone times the table by the host's clock.
    if (!host) { await timeTo(client); if (O.client !== client) return false; }
    enter(room);
    slowNote(client);
    return true;
  }
  // Say once per room when the game goes through the meeting points (the networks would not link directly).
  function slowNote(client) { if (client.lane === "relay" && !O.slowSaid) { O.slowSaid = true; emit("slow"); } }

  O.isHost = function () { return !!(O.room && O.session && O.room.host === O.session.playerId); };
  O.inRoom = function () { return !!O.room; };
  /** A link friends can open to land in this room. */
  O.link = function () { return typeof location === "undefined" || !O.code ? "" : location.origin + location.pathname + "?room=" + O.code; };

  function common(name) { const L = O.lib; return Object.assign({ app: APP, name: name || null, store: O.store, profile: O.profile || "", identity: L ? me(L) : null }, O.p2p || {}); }
  async function go(fn) {
    if (!O.enabled) return false;
    try {
      const L = await lib();
      O.cancelInvite();
      if (O.room) exit();
      return await fn(L);
    } catch (e) { emit("error", say(e, "That didn't work. Try again.")); return false; }
  }
  /** Open a room on this device. Share O.code (or O.link()) with friends. `allow`: only these players' keys may sit (a friend's call). */
  O.create = function (name, allow) {
    return go(async function (L) {
      const kit = openKit(L);
      const host = await L.hostRoom(Object.assign(common(name), { db: kit.db, kit: kit, modes: MODES, actions: ACTIONS, mode: "spades", log: function () {}, maxMessagesPerSecond: O.maxRate || 60 }, allow ? { allow: allow } : {}));
      return adopt(host.client, host.room, host);
    });
  };
  /** Join a friend's room by its room code, or call a friend by their friend code (they get asked; if they say yes, you're in). */
  O.join = function (code, name) {
    return go(async function (L) {
      let hostKey = null;
      const fc = L.cleanFriendCode(code);
      if (fc) {
        emit("calling", fc);
        const call = await L.callFriend(Object.assign(common(name), { friendCode: fc }));
        code = call.code; hostKey = call.hostKey;
      }
      const r = await L.joinRoom(Object.assign(common(name), { code: code, hostKey: hostKey, handoff: handoffFor(L) }));
      return adopt(r.client, r.room, null);
    });
  };
  /** Leave the room (back to the solo game). A host leaving hands the room to the next player. */
  O.leave = function () { if (O.room) exit(); };

  // ---- friends: call people you have played with by their friend code ----
  /** This device's friend code (a friend types it where a room code goes to call you). */
  O.friendCode = async function () { if (!O.enabled) return ""; return me(await lib()).friendCode; };
  /** People this device has played with: [{ friendCode, name, seen }], newest first. */
  O.friends = async function () { if (!O.enabled) return []; return me(await lib()).friends.list(); };
  /** Be reachable by friend code while not in a room (only once there is someone who might call). */
  O.listen = async function () {
    if (!O.enabled || O.ear || O.room) return;
    const L = await lib(), ident = me(L);
    if (O.ear || O.room || !ident.friends.list().length) return;
    O.ear = L.listen(Object.assign(common(null), { onCall: function (call) {
      if (O.room) { call.decline(); return; } // busy: already playing with someone
      emit("call", {
        name: call.from.name || "A friend", known: call.from.known,
        // Say yes: open a room only the caller can sit in, and tell them its code.
        accept: function (name) {
          O.answering = true;
          return O.create(name, [call.from.key]).then(function (ok) {
            O.answering = false;
            if (ok && O.code) call.accept(O.code); else call.decline();
            if (O.room) hangUpEar(); // (the answer still goes out in full)
            return ok;
          });
        },
        decline: function () { call.decline(); }
      });
    } }));
  };
  function hangUpEar() { const e = O.ear; O.ear = null; if (e) e.close(); }

  // ---- the by-hand handshake, for when a room code will not connect ----
  /** Host: how many public relays are carrying the room code (0 = friends need an invite text). */
  O.relays = function () { return O.host ? O.host.relaysUp() : 0; };
  /** Host: make an invite text for one friend. Resolves with the text, or null. */
  O.invite = async function () {
    if (!O.host) return null;
    try { return await O.host.invite(); } catch (e) { emit("error", say(e, "Couldn't make an invite.")); return null; }
  };
  /** Host: paste in the reply text the friend sent back. Resolves true when it was accepted. */
  O.acceptReply = async function (text) {
    if (!O.host) return false;
    try { return await O.host.accept(text); } catch (e) { emit("error", say(e, "That reply didn't work.")); return false; }
  };
  /** Friend: answer an invite text. Resolves with the reply text to send back (or null); joined() fires once the host pastes it in. */
  O.answer = function (invite, name) {
    return go(async function (L) {
      const g = await L.answerInvite(Object.assign(common(name), { invite: invite }));
      O.pendingInvite = g;
      g.connected.then(function (r) { if (O.pendingInvite !== g) return; O.pendingInvite = null; adopt(r.client, r.room, null); },
        function (e) { if (O.pendingInvite !== g) return; O.pendingInvite = null; emit("error", say(e, "The invite didn't connect.")); });
      return g.reply;
    }).then(function (r) { return r || null; });
  };
  O.cancelInvite = function () { const g = O.pendingInvite; O.pendingInvite = null; if (g) g.cancel(); };

  /** The host sat down at table k (or stood up: -1). Friends are told so they sit at the same one. */
  O.setTable = function (k) {
    O.hostTable = k;
    if (k >= 0 && O.lobby && O.isHost()) O.lobby.send({ t: "tbl", k: k });
  };
  /** The host reports a finished game for the wins board (kept in the host's database). */
  O.report = function (winners, losers, scores) {
    if (!O.client || !O.isHost()) return;
    O.client.action("spadesResult", { winners: winners, losers: losers, scores: scores }).catch(function () { /* not recorded; the game goes on */ });
  };
  /** The wins board as this room's host has it: [{ pos, name, score }] (null when not in a room). */
  O.wins = function (n) { return O.client ? O.client.top("spades_wins", n || 10).catch(function () { return null; }) : Promise.resolve(null); };
  HS.Online = O;
})(globalThis.HS);
