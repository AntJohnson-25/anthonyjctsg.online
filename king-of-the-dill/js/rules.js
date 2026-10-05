// Singles pickleball rules: a pure state machine, no DOM, no physics.
//
// Sides are "p" (the human, z > 0) and "c" (the computer, z < 0).
// Side-out scoring: only the server scores; losing a rally as server passes the
// serve over. Games to 11, win by 2. The server serves from their right-hand
// court on an even score, from the left on an odd one, diagonally across.
import { COURT, inBounds } from "./physics.js";

export const other = (s) => (s === "p" ? "c" : "p");
export const sideOfZ = (z) => (z > 0 ? "p" : "c");
// World x sign of a player's right hand: the human faces -z (right = +x),
// the computer faces +z (right = -x).
export const rightX = (s) => (s === "p" ? 1 : -1);

export class Rules {
  constructor(firstServer = "p", target = 11) {
    this.server = firstServer;
    this.score = { p: 0, c: 0 };
    this.target = target;
    this.winner = null;
    this.startRally();
  }

  // World x sign of the half the server serves from.
  serveXSign() {
    const even = this.score[this.server] % 2 === 0;
    return (even ? 1 : -1) * rightX(this.server);
  }

  call() {
    return this.score[this.server] + "-" + this.score[other(this.server)];
  }

  startRally() {
    this.shots = 0;            // hits so far this rally (the serve is the first)
    this.lastHitter = null;
    this.bounces = { p: 0, c: 0 };   // bounces on each side since the last hit
    this.over = null;          // { loser, reason } once decided
  }

  // A volley (no bounce since the last hit) is not allowed on the return of
  // serve or the third shot, or from inside the kitchen.
  mustBounce() {
    return this.shots < 3;
  }

  // who hits the ball. volley: it has not bounced on their side. standZ: where they stand.
  // Returns null, or { loser, reason } if the hit is a fault.
  hit(who, volley, standZ) {
    if (this.over) return this.over;
    if (this.shots > 0 && volley) {
      if (this.mustBounce()) return this.end(who, "two-bounce rule");
      if (Math.abs(standZ) < COURT.kitchen) return this.end(who, "kitchen volley");
    }
    this.shots++;
    this.lastHitter = who;
    this.bounces.p = 0;
    this.bounces.c = 0;
    return null;
  }

  // The ball touched the ground at (x, z).
  bounce(x, z) {
    if (this.over) return this.over;
    if (!this.lastHitter) return null;
    const side = sideOfZ(z);
    const hitter = this.lastHitter;
    if (side === hitter) return this.end(hitter, this.shots === 1 ? "serve into the net" : "into the net");
    if (this.shots === 1 && this.bounces[side] === 0) {
      // The serve must land in the diagonal service court, past the kitchen line.
      const sx = this.serveXSign();
      const ok = inBounds(x, z) && Math.abs(z) > COURT.kitchen && x * sx <= 0.02;
      if (!ok) return this.end(hitter, Math.abs(z) <= COURT.kitchen ? "serve in the kitchen" : "serve out");
    } else if (this.bounces[side] === 0 && !inBounds(x, z)) {
      return this.end(hitter, "out");
    }
    this.bounces[side]++;
    if (this.bounces[side] >= 2) return this.end(side, "two bounces");
    return null;
  }

  end(loser, reason) {
    this.over = { loser, winner: other(loser), reason };
    return this.over;
  }

  // Apply the decided rally to the score. Returns { scored, sideOut, gameOver }.
  award() {
    const r = this.over;
    if (!r) throw new Error("rally not over");
    let scored = false, sideOut = false;
    if (r.winner === this.server) {
      this.score[this.server]++;
      scored = true;
    } else {
      this.server = r.winner;
      sideOut = true;
    }
    const a = this.score.p, b = this.score.c;
    if ((a >= this.target || b >= this.target) && Math.abs(a - b) >= 2) this.winner = a > b ? "p" : "c";
    return { scored, sideOut, gameOver: !!this.winner, winner: r.winner, reason: r.reason };
  }
}
