// One question's attempt state machine and the saved progress.
//   editing (attempt 1) -wrong-> editing (attempt 2) -wrong-> clue shown, editing (attempt 3) -wrong-> revealed
//   any correct run -> solved. SQL errors don't use up an attempt.

export const MAX_ATTEMPTS = 3;
export const XP_SHARE = [1, 0.6, 0.3];

export class QuestionRun {
  constructor(question, tierXp, previous) {
    this.q = question;
    this.tierXp = tierXp;
    this.attempt = 1;
    this.state = "editing";
    this.clue = false;
    // A question already finished in an earlier session opens in free-practice mode.
    if (previous) this.state = previous === "revealed" ? "revealed" : "solved";
  }

  get finished() { return this.state !== "editing"; }

  // Returns what the UI should do next: { solved, xp } | { clue } | { revealed } | { retry }.
  record(correct) {
    if (this.finished) return { practice: true, correct };
    if (correct) {
      this.state = "solved";
      return { solved: true, attempt: this.attempt, xp: Math.round(this.tierXp * XP_SHARE[this.attempt - 1]) };
    }
    if (this.attempt >= MAX_ATTEMPTS) {
      this.state = "revealed";
      return { revealed: true };
    }
    this.attempt++;
    if (this.attempt === MAX_ATTEMPTS) { this.clue = true; return { clue: true }; }
    return { retry: true };
  }
}

const KEY = "sqlquest.v1";

export function loadProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || "null");
    // order = this run's shuffled question ids per tier (main.js syncOrder fills / reshuffles it)
    if (p && typeof p === "object") return { xp: p.xp | 0, done: p.done || {}, last: p.last || null, order: p.order || {} };
  } catch (e) { /* storage blocked or corrupt: start fresh */ }
  return { xp: 0, done: {}, last: null, order: {} };
}

export function saveProgress(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* private mode: progress lasts this visit only */ }
}
