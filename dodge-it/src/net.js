// The relay protocol, shared by the game (main.js) and the Node test (tools/sim-test.js).
// Times: the sim counts seconds from its own start (E = the shared clock, HopLobby.now(), at that start, in ms);
// on the wire every "t" / "t0" is shared-clock milliseconds, so screens that started at different moments agree.
// The relay is unchecked, so each message is only taken from the screen that has the right to send it:
// poses, throws and hit/catch claims from the player's own screen (the host for bots), the rest from the host.
globalThis.SB = globalThis.SB || {};
(function (SB) {
  "use strict";
  const N = {};
  function conv(o, f) {
    if (Array.isArray(o)) return o.map((x) => conv(x, f));
    if (o && typeof o === "object") {
      const r = {};
      for (const k in o) r[k] = (k === "t" || k === "t0") && typeof o[k] === "number" ? f(o[k]) : conv(o[k], f);
      return r;
    }
    return o;
  }
  N.toWire = (m, E) => conv(m, (t) => Math.round((E + t * 1000) * 10) / 10);
  N.fromWire = (m, E) => conv(m, (t) => (t - E) / 1000);
  const num = (v) => typeof v === "number" && isFinite(v);
  const inGym = (m) => Math.abs(m.x) < 12 && Math.abs(m.z) < 17 && m.y > -0.5 && m.y < 12;

  // env: { E, hostId(): lobby id of the host, ownerOf(i): lobby id of the human playing index i (null for bots) }
  // Returns the message (on our clock) for the caller's own bookkeeping, or null if it was refused.
  N.handle = function (sim, raw, from, env) {
    if (!sim || !raw || typeof raw !== "object" || typeof raw.k !== "string") return null;
    const m = N.fromWire(raw, env.E);
    const fromHost = from === env.hostId();
    const owns = function (i) {
      const p = sim.players[i | 0];
      if (!p || sim.owns(p)) return false;
      return p.bot ? fromHost : env.ownerOf(i | 0) === from;
    };
    const host = fromHost && !sim.isHost;
    switch (m.k) {
      case "P":
        if (!num(m.t) || !Array.isArray(m.a)) return null;
        m.a.forEach(function (a) { if (Array.isArray(a) && a.length >= 15 && owns(a[0]) && a.slice(1, 6).every(num)) sim.setRemote(a, m.t); });
        return m;
      case "th":
        if (!owns(m.i) || !["x", "y", "z", "vx", "vy", "vz", "t0"].every((k) => num(m[k])) || !inGym(m)) return null;
        if (Math.hypot(m.vx, m.vy, m.vz) > 40 || !sim.balls[m.b | 0]) return null;
        sim.fireRemote(m);
        return m;
      case "grab": if (!owns(m.i)) return null; sim.hostGrab(m); return m;
      case "hit": case "catch": case "blk":
        if (!owns(m.i) || !sim.balls[m.b | 0]) return null;
        sim.hostClaim(m);
        return m;
      case "b": if (!host) return null; sim.applyBall(m); return m;
      case "out": if (!host) return null; sim.applyOut(m); return m;
      case "rej": if (!host) return null; sim.applyRej(m); return m;
      case "phase": if (!host) return null; sim.applyPhase(m); return m;
      case "snap": if (!host) return null; sim.applySnap(m.s); return m;
    }
    return m;   // others (hello etc.) are the caller's
  };
  SB.Net = N;
})(globalThis.SB);
