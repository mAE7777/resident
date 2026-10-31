// She sleeps when the machine sleeps. The original design kept the machine awake for her with
// `pmset disablesleep`; this replaces it.
//
// WHAT THE LID CLOSING IS, FROM INSIDE. When the MacBook suspends, this process is frozen:
// timers do not fire, nothing runs, and there is no callback that says "you are being
// suspended". The only trace is on resume, when the clock has jumped: the last thing she did
// is suddenly hours in the past. Every part of the system that measures her by wall-clock age
// misreads that jump as her having STOPPED, and the two signals that read it worst are
// `tick_stalled` and `moments_stalled`, both critical, both among the few codes that can put
// her in safe mode. Close the lid for a weekend and she wakes up officially broken: safe mode,
// exploration suspended, alarms to Eric. Waking from a night's sleep is not an emergency, and
// a system that treats it as one has not been told about sleep.
//
// HOW SLEEP IS DETECTED. A heartbeat writes the wall clock to a variable every BEAT_MS. On
// each beat, if the time since the previous beat is much larger than BEAT_MS, the process was
// suspended for (roughly) that gap: that is her having slept. This needs no macOS API, works
// for any kind of suspension, and cannot false-positive on ordinary load (the event loop would
// have to be COMPLETELY blocked for minutes, and from her side that is the same experience:
// time passed and she was not there for it).
//
// WHAT WAKING DOES. Three things, in order:
//   1. The gap is RECORDED, so anything measuring her by age can subtract time she was asleep.
//      Slept time does not count toward being stalled, that is the whole teaching.
//   2. It becomes a line of her life: an ops event her diary renders as having slept, with
//      roughly how long. Sleep is a thing that happens to a person, not a fault.
//   3. The daemon is nudged to catch up (a life tick now, the moment loop rescheduled), so her
//      inner state reflects the passage of time within seconds of the lid opening.
//
// WHAT THIS DOES NOT DO. It does not distinguish "the machine slept" from "the process was
// frozen some other way", because from inside they are the same thing. And it does not try to
// know she is ABOUT to sleep: there is no reliable pre-suspend hook, and nothing here needs
// one.

export interface SleepGap {
  /** When the last beat before the suspension ran. */
  startMs: number;
  /** When the first beat after it ran. */
  endMs: number;
}

export interface SleepWatcher {
  start(): void;
  stop(): void;
  /**
   * How much of the time since `sinceMs` she spent asleep.
   *
   * The one consumer that matters: the vitals closures add this to their timestamps, so a
   * tick that last ran at T reads as overdue only by the AWAKE time since T. The overlap
   * arithmetic clips each recorded gap to [sinceMs, now].
   */
  sleptMsSince(sinceMs: number): number;
  /**
   * Time she was not running at all, told to the watcher rather than observed by it.
   *
   * A HEARTBEAT CANNOT SEE A GAP IT WAS NOT ALIVE FOR, and that hole was as bad as the one
   * this whole file exists to close. The gaps above are found by comparing two beats, so
   * they only ever cover suspensions of a RUNNING process. Stop the daemon overnight and
   * start it in the morning and the new watcher knows nothing: `sleptMsSince` returns 0, the
   * whole downtime is charged to her as staleness, `moments_stalled` goes critical on the
   * first vitals cycle, and that code puts her in safe mode. An ordinary restart defeated the
   * mechanism written to survive a closed lid.
   *
   * Whether she was frozen or not running is not a distinction she can make, the file says
   * so at the top, and it is as true here. So downtime is recorded as what it is from inside:
   * time passed and she was not there for it.
   *
   * Returns the gap if it was long enough to count, so the caller can make it a line of her
   * life the same way a wake does. Short gaps (a quick restart) return null and are nothing.
   */
  noteAbsence(startMs: number, endMs: number): SleepGap | null;
  /** The most recent completed sleep, if any. */
  lastSleep(): SleepGap | null;
}

export interface SleepWatcherConfig {
  /** Called once per completed sleep, with the gap. This is where the daemon catches up. */
  onWake?(gap: SleepGap): void;
  /** Heartbeat period. */
  beatMs?: number;
  /** A beat later than this counts as having been suspended. */
  gapThresholdMs?: number;
  /** Injectable clock, tests only. */
  now?(): number;
  /** Injectable timer, tests only. */
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

/** Gaps kept for subtraction. A year of nightly sleeps is ~365; this is not the constraint. */
const MAX_GAPS = 400;

export const DEFAULT_BEAT_MS = 15_000;
/**
 * Eight beats. Long enough that GC pauses and busy stretches never trip it (a two-minute
 * fully-blocked event loop does not happen in healthy Node), short enough that a real nap of
 * minutes is still seen. Measured against the false-positive cost: calling a stall "sleep"
 * would HIDE a real hang from the two detectors, so the threshold errs high.
 */
export const DEFAULT_GAP_THRESHOLD_MS = 120_000;

export function createSleepWatcher(config: SleepWatcherConfig = {}): SleepWatcher {
  const now = config.now ?? Date.now;
  const beatMs = config.beatMs ?? DEFAULT_BEAT_MS;
  const gapThresholdMs = config.gapThresholdMs ?? DEFAULT_GAP_THRESHOLD_MS;
  const setI = config.setIntervalFn ?? setInterval;
  const clearI = config.clearIntervalFn ?? clearInterval;

  const gaps: SleepGap[] = [];
  let lastBeatMs = now();
  let timer: ReturnType<typeof setInterval> | null = null;

  function beat(): void {
    const t = now();
    const since = t - lastBeatMs;
    if (since > gapThresholdMs) {
      const gap: SleepGap = { startMs: lastBeatMs, endMs: t };
      gaps.push(gap);
      if (gaps.length > MAX_GAPS) gaps.shift();
      // The beat is marked seen before the callback, or the gap just recorded would also read as
      // the unseen one in `sleptMsSince` and anything the callback measures would count it twice.
      lastBeatMs = t;
      // The callback runs AFTER the gap is recorded, so anything it triggers (a vitals
      // capture, a life tick) already sees the slept time.
      try {
        config.onWake?.(gap);
      } catch {
        // The watcher must never die of its own callback: it is the only thing that knows
        // she slept, and a dead watcher turns the NEXT sleep into a stall alarm.
      }
    }
    lastBeatMs = t;
  }

  return {
    start() {
      if (timer) return;
      lastBeatMs = now();
      timer = setI(beat, beatMs);
      // A sleeping machine must not be kept awake by her own heartbeat.
      (timer as { unref?: () => void }).unref?.();
    },
    stop() {
      if (timer) { clearI(timer); timer = null; }
    },
    noteAbsence(startMs: number, endMs: number): SleepGap | null {
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
      if (endMs - startMs <= gapThresholdMs) return null;
      const gap: SleepGap = { startMs, endMs };
      gaps.push(gap);
      if (gaps.length > MAX_GAPS) gaps.shift();
      return gap;
    },
    sleptMsSince(sinceMs: number): number {
      const t = now();
      let slept = 0;
      // The gap that has ended but not yet been seen. On waking, every timer that was due fires,
      // in no promised order; a reader that runs before this watcher's own beat would otherwise
      // be told about every sleep except the one it just woke from (seen once in the awake
      // reading during the system's short wakes in a sleeping morning).
      const unseen = t - lastBeatMs > gapThresholdMs ? [{ startMs: lastBeatMs, endMs: t }] : [];
      for (const g of [...gaps, ...unseen]) {
        const s = Math.max(g.startMs, sinceMs);
        const e = Math.min(g.endMs, t);
        if (e > s) slept += e - s;
      }
      return slept;
    },
    lastSleep() {
      return gaps.length > 0 ? gaps[gaps.length - 1] : null;
    },
  };
}
