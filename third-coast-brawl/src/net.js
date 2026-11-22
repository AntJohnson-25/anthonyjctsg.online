// Racing friends through a link, peer to peer, with GameDB (G:\ICM Workspace\01-Projects\gamedb).
// There is no game server. Whoever opens the room is the host: their browser holds the room and
// passes messages between the riders; friends connect straight to it over WebRTC. The handshake
// goes through free public meeting points, sealed with the room code (see src/net/gamedb-p2p.js).
//
// What travels (main.js decides what the messages mean):
//   RR.Net.send(data)        to everyone else in the room
//   RR.Net.send(data, id)    to one player
//   RR.Net.on.msg(data, fromPlayerId)
// Each rider is run by the screen that owns it (yours, or the host's for the bots); the others
// draw it from those messages. RR.Net.now() is the host's clock, so countdowns and finish times agree.
//
// Copies of the GameDB files live in src/net/ (re-copy them after GameDB changes).
(function (RR) {
  "use strict";
  const APP = "third-coast-brawl";
  const MODES = { race: { minPlayers: 1, maxPlayers: 4 } };
  const N = RR.Net = {
    lib: null, kit: null, host: null, client: null, session: null, room: null, code: "", offset: 0,
    on: {},   // joined(), left(reason), room(room), msg(data, from), error(message), dropped(), back(), slow(), host()
    enabled: typeof RTCPeerConnection !== "undefined" && typeof location !== "undefined" && /^https?:$/.test(location.protocol),
    // ?p=2 is a second player on the same computer (trying it in two tabs)
    profile: typeof location === "undefined" ? "" : (new URLSearchParams(location.search).get("p") || ""),
    slowSaid: false
  };
  function emit(name, a, b) { if (N.on[name]) { try { N.on[name](a, b); } catch (e) { console.error(e); } } }
  function say(e, fallback) { return e && e.name === "GameClientError" && e.message ? e.message.charAt(0).toUpperCase() + e.message.slice(1) : fallback; }

  async function lib() {
    if (!N.lib) {
      const at = function (f) { return new URL("src/net/" + f, document.baseURI).href; };
      const m = await Promise.all([import(at("gamedb.js")), import(at("gamedb-kit.js")), import(at("gamedb-p2p.js"))]);
      N.lib = { GameDB: m[0].GameDB, GameKit: m[1].GameKit, hostRoom: m[2].hostRoom, joinRoom: m[2].joinRoom, deviceIdentity: m[2].deviceIdentity };
    }
    return N.lib;
  }
  // The room lives in memory: a race keeps nothing between visits.
  function openKit(L) { if (!N.kit) N.kit = new L.GameKit(L.GameDB.open({ name: "tcb" })); return N.kit; }
  function handoffFor(L) { return function () { const kit = openKit(L); return { db: kit.db, kit: kit, modes: MODES, log: function () {}, maxMessagesPerSecond: 90 }; }; }
  function ident(L) { return N.ident || (N.ident = L.deviceIdentity(undefined, N.profile)); }
  function common(L, name) { return { app: APP, name: name || null, profile: N.profile, identity: ident(L) }; }

  function setRoom(room) { N.room = room; N.code = room.code; emit("room", room); }
  async function timeTo(client) {
    if (N.host) { N.offset = 0; return; }
    try {
      // the best of three round trips
      let best = 1e9;
      for (let i = 0; i < 3; i++) {
        const t0 = Date.now(), ts = await client.time(), t1 = Date.now();
        if (N.client !== client) return;
        if (t1 - t0 < best) { best = t1 - t0; N.offset = ts - (t0 + t1) / 2; }
      }
    } catch (e) { /* keep the old offset */ }
  }
  async function adopt(client, room, host) {
    N.client = client; N.host = host || null; N.session = client.me; N.offset = 0;
    let away = false;
    client.on("room", function (e) { if (N.client === client && N.room && e.room.code === N.room.code) setRoom(e.room); });
    client.on("relay", function (m) { if (N.client === client && m.data && typeof m.data === "object") emit("msg", m.data, m.from); });
    client.on("close", function () { if (N.client === client && !N.host) { away = true; emit("dropped"); } });
    // the host left and this device took the room over
    client.on("host", function (h) { if (N.client === client) { N.host = h; N.offset = 0; emit("host"); } });
    client.on("open", function (s) {
      if (N.client !== client) return;
      N.session = s;
      const back = function (r) { if (N.client !== client) return; setRoom(r); timeTo(client); if (away) { away = false; emit("back"); } slowNote(client); };
      if (N.code && s.room && s.room.code === N.code) back(s.room);
      else if (N.code) client.joinRoom(N.code).then(back, function () { if (N.client === client) exit("The room is no longer open."); });
    });
    client.on("lost", function () { if (N.client === client) exit("Lost the connection to the room."); });
    client.on("kicked", function () { if (N.client === client) exit("You joined this room from another tab."); });
    if (!host) { await timeTo(client); if (N.client !== client) return false; }
    setRoom(room);
    emit("joined");
    slowNote(client);
    return true;
  }
  function slowNote(client) { if (client.lane === "relay" && !N.slowSaid) { N.slowSaid = true; emit("slow"); } }
  function exit(reason) {
    const c = N.client, h = N.host;
    N.client = null; N.host = null; N.session = null; N.room = null; N.code = ""; N.slowSaid = false;
    if (h) h.close({ handoff: true }); else if (c) c.close();
    emit("left", reason || "");
  }
  async function go(fn) {
    if (!N.enabled) return false;
    try {
      const L = await lib();
      if (N.room) exit();
      return await fn(L);
    } catch (e) { console.error(e); emit("error", say(e, "Couldn't connect. Try again.")); return false; }
  }

  /** Open a room on this device. `code` is only for tests (a fixed room code). */
  N.create = function (name, code) {
    return go(async function (L) {
      const kit = openKit(L);
      const opts = Object.assign(common(L, name), { db: kit.db, kit: kit, modes: MODES, mode: "race", log: function () {}, maxMessagesPerSecond: 90 });
      if (code) opts.code = code;
      const host = await L.hostRoom(opts);
      return adopt(host.client, host.room, host);
    });
  };
  /** Join a friend's room by its code (the ?room= part of their link). */
  N.join = function (code, name) {
    return go(async function (L) {
      const r = await L.joinRoom(Object.assign(common(L, name), { code: String(code).toUpperCase(), handoff: handoffFor(L) }));
      return adopt(r.client, r.room, null);
    });
  };
  N.leave = function () { if (N.room) exit(); };
  N.inRoom = function () { return !!N.room; };
  N.myId = function () { return N.session ? N.session.playerId : null; };
  N.isHost = function () { return !!(N.room && N.session && N.room.host === N.session.playerId); };
  N.hostId = function () { return N.room ? N.room.host : null; };
  /** Players connected right now: [{ id, name }] in seat order. */
  N.players = function () { return N.room ? N.room.players.filter(function (p) { return p.connected !== false; }).map(function (p) { return { id: p.id, name: p.name || "RIDER" }; }) : []; };
  N.now = function () { return Date.now() + N.offset; };
  N.lane = function () { return N.client ? N.client.lane : null; };
  N.send = function (data, to) { if (N.client) N.client.relay(data, to).catch(function () { /* a lost update is replaced by the next one */ }); };
  N.link = function () { return N.code ? location.origin + location.pathname + "?room=" + N.code : ""; };
})(window.RR = window.RR || {});
