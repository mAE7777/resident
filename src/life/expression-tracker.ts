// Live expression pressure tracker. The expression gate and the vitals monitor both need REAL
// numbers (how many proactive sends today, how many went unanswered, how long since the owner
// spoke, how full the hold-reservoir is), not the zeros the tick was stubbed with. This is the
// small stateful counter the daemon updates from the message/notifier hooks, so those inputs
// become live. Pure state + injected clock; no I/O.

export interface ExpressionVitals {
  sendsInLastDay: number;
  consecutiveNonReplies: number;
  reservoirSize: number;
  hoursSinceUser: number;
  /** False until he has actually said something. See `lastUserMs`'s seed. */
  everSpoke: boolean;
}

export interface ExpressionTracker {
  /** A proactive message was pushed to the owner. */
  onProactiveSend(nowMs: number): void;
  /** The owner sent us a message (resets the non-reply streak, marks contact). */
  onOwnerMessage(nowMs: number): void;
  /** Update the count of thoughts currently held in the reservoir. */
  setReservoir(n: number): void;
  /**
   * Her outbound pressure, for persisting.
   *
   * None of this survived a restart, and each loss disabled something: the sends-today count zeroed
   * `expression_flood`, the unanswered streak reset the reply-adaptive push bar to its floor, and
   * `lastUserMs` resetting to boot made `starvation` need seven days of unbroken uptime.
   */
  state(): { sendTimes: number[]; consecutiveNonReplies: number; lastUserMs: number; everSpoke: boolean };
  restore(s: Partial<{ sendTimes: number[]; consecutiveNonReplies: number; lastUserMs: number; everSpoke: boolean }>): void;
  /** Current pressure snapshot. */
  snapshot(nowMs: number): ExpressionVitals;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function createExpressionTracker(startMs: number): ExpressionTracker {
  let sendTimes: number[] = [];
  let consecutiveNonReplies = 0;
  // Seeded to boot so the starvation alarm does not false-fire on a fresh process. That seed
  // is an instrument's convenience and it is NOT a fact about her life, so it is tracked
  // separately: on her first ever boot she was being told 「你们刚刚还在说话」 about a
  // conversation that had never happened. See `contactLine`.
  let lastUserMs = startMs;
  let everSpoke = false;
  let reservoir = 0;

  function prune(nowMs: number): void {
    const cutoff = nowMs - DAY_MS;
    if (sendTimes.length && sendTimes[0] < cutoff) sendTimes = sendTimes.filter((t) => t >= cutoff);
  }

  return {
    onProactiveSend(nowMs) {
      sendTimes.push(nowMs);
      consecutiveNonReplies += 1; // a push not (yet) answered
      prune(nowMs);
    },
    onOwnerMessage(nowMs) {
      consecutiveNonReplies = 0;
      lastUserMs = nowMs;
      everSpoke = true;
    },
    setReservoir(n) {
      reservoir = Math.max(0, Math.floor(n));
    },
    state: () => ({ sendTimes: [...sendTimes], consecutiveNonReplies, lastUserMs, everSpoke }),
    restore(s) {
      if (Array.isArray(s.sendTimes)) sendTimes = s.sendTimes.filter((t) => Number.isFinite(t));
      if (typeof s.consecutiveNonReplies === "number" && Number.isFinite(s.consecutiveNonReplies)) {
        consecutiveNonReplies = Math.max(0, Math.floor(s.consecutiveNonReplies));
      }
      if (typeof s.lastUserMs === "number" && Number.isFinite(s.lastUserMs)) lastUserMs = s.lastUserMs;
      if (typeof s.everSpoke === "boolean") everSpoke = s.everSpoke;
    },
    snapshot(nowMs) {
      prune(nowMs);
      return {
        sendsInLastDay: sendTimes.length,
        consecutiveNonReplies,
        reservoirSize: reservoir,
        hoursSinceUser: Math.max(0, (nowMs - lastUserMs) / 3_600_000),
        everSpoke,
      };
    },
  };
}
