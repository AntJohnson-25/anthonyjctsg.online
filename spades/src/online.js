// Playing with friends, peer to peer, through GameDB (G:\ICM Workspace\01-Projects\gamedb).
// There is no game server. The player who creates the room is the host: their browser holds
// the GameDB database (accounts, the room, results, the wins board) and friends connect
// straight to it. See src/gamedb-p2p.js for how two browsers find each other:
//   - a room code (one click; the handshake goes through free public relays), or
//   - an invite text passed by hand (depends on nothing; for when the code will not connect).
//
// net.js already knows how to run a table for several people: it was written for a
// "lobby" object (HopLobby) that passes messages between players and says who is host.
// This file gives it that same object, built on a GameDB room:
//   - HS.Online.create() / join(code) put you in a room and set globalThis.HopLobby;
//   - HopLobby.send(data, to) goes through the room's relay (to one player, or everyone);
//   - the room's host is the lobby host. If the host leaves, the room closes (their browser
//     was the database) and everyone carries on solo.
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const APP = "villa-spades";
  const O = {
    lib: null, kit: null, host: null, client: null, session: null,
    room: null, code: "", lobby: null, offset: 0, table: -1, hostTable: -1, pendingInvite: null,
    p2p: null,      // test hook: extra options for hostRoom / joinRoom (a stand-in network)
    storage: null,  // test hook: where the host's database is kept
    on: {}          // joined(ctx), left(reason), room(room), table(k), error(message), dropped()
  };
  O.enabled = typeof RTCPeerConnection !== "undefined";
  // ?p=2 in the address is a second player on the same computer (for trying it out in two tabs).
  O.profile = typeof location === "undefined" ? "" : (new URLSearchParams(location.search).get("p") || "");
  function emit(name, a) { if (O.on[name]) { try { O.on[name](a); } catch (e) { console.error(e); } } }
  function say(e, fallback) { return e && e.name === "GameClientError" && e.message ? e.message.charAt(0).toUpperCase() + e.message.slice(1) : fallback; }

  async function lib() {
    if (!O.lib) {
      const at = function (f) { return new URL("src/" + f, document.baseURI).href; };
      const m = await Promise.all([import(at("gamedb.js")), import(at("gamedb-kit.js")), import(at("gamedb-p2p.js"))]);
      O.lib = { GameDB: m[0].GameDB, GameDBError: m[0].GameDBError, localStorageStorage: m[0].localStorageStorage, GameKit: m[1].GameKit, hostRoom: m[2].hostRoom, joinRoom: m[2].joinRoom, answerInvite: m[2].answerInvite };
    }
    return O.lib;
  }
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
    L.players = room.players.map(function (p) { return { id: p.id, name: p.name || "Player", isHost: p.id === room.host }; });
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
    emit("joined", O.lobby.context);
  }
  // Out of the room, back to the solo game. `reason` is shown to the player when it was not their choice.
  function exit(reason) {
    const c = O.client, h = O.host;
    O.client = null; O.host = null; O.session = null;
    O.room = null; O.code = ""; O.lobby = null; O.table = -1; O.hostTable = -1;
    delete globalThis.HopLobby;
    if (h) h.close(); else if (c) c.close();
    emit("left", reason || "");
  }
  // Take a connected client (ours as host, or one that reached a friend's room) and step into the room.
  async function adopt(client, room, host) {
    O.client = client; O.host = host || null; O.session = client.me; O.offset = 0;
    client.on("room", function (e) { if (O.client === client && O.room && e.room.code === O.room.code) setRoom(e.room); });
    client.on("relay", function (m) { if (O.client === client) onRelay(m); });
    client.on("close", function () { if (O.client === client && !host) emit("dropped"); });
    client.on("open", function (s) {
      if (O.client !== client) return;
      O.session = s;
      // Back after a dropped connection: the host freed our seat, so take one again.
      if (O.code && !s.room) client.joinRoom(O.code).then(function (r) { if (O.client !== client) return; setRoom(r); if (O.lobby) O.lobby._fire("relay", "open"); }, function () { if (O.client === client) exit("The room is no longer open."); });
    });
    client.on("lost", function () { if (O.client === client) exit("The host left, so the room has closed."); });
    client.on("kicked", function () { if (O.client === client) exit("You joined this room from another tab."); });
    if (!host) {
      // Everyone times the table by the host's clock.
      try { const t0 = Date.now(), ts = await client.time(); O.offset = ts - (t0 + Date.now()) / 2; } catch (e) { O.offset = 0; }
      if (O.client !== client) return false;
    }
    enter(room);
    return true;
  }

  O.isHost = function () { return !!(O.room && O.session && O.room.host === O.session.playerId); };
  O.inRoom = function () { return !!O.room; };
  /** A link friends can open to land in this room. */
  O.link = function () { return typeof location === "undefined" || !O.code ? "" : location.origin + location.pathname + "?room=" + O.code; };

  function common(name) { return Object.assign({ app: APP, name: name || null, store: O.store, profile: O.profile || "" }, O.p2p || {}); }
  async function go(fn) {
    if (!O.enabled) return false;
    try {
      const L = await lib();
      O.cancelInvite();
      if (O.room) exit();
      return await fn(L);
    } catch (e) { emit("error", say(e, "That didn't work. Try again.")); return false; }
  }
  /** Open a room on this device. Share O.code (or O.link()) with friends. */
  O.create = function (name) {
    return go(async function (L) {
      const kit = openKit(L);
      const host = await L.hostRoom(Object.assign(common(name), { db: kit.db, kit: kit, modes: { spades: { minPlayers: 1, maxPlayers: 4 } }, actions: ACTIONS, mode: "spades", log: function () {}, maxMessagesPerSecond: O.maxRate || 60 }));
      return adopt(host.client, host.room, host);
    });
  };
  /** Join a friend's room by its code. */
  O.join = function (code, name) {
    return go(async function (L) {
      const r = await L.joinRoom(Object.assign(common(name), { code: code, maxRetries: 2 }));
      return adopt(r.client, r.room, null);
    });
  };
  /** Leave the room (back to the solo game). The host leaving closes the room for everyone. */
  O.leave = function () { if (O.room) exit(); };

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
