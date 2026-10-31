// Watchdog: time-based guard that fires after each agent turn.
// Uses Date.now() comparison rather than setTimeout so it integrates with
// the turn loop without background timers.
//
// call check() after every agent turn:
//   "ok"        , still within the 30-minute window
//   "warn"      , past 30 minutes, injection message returned
//   "force_stop", past 35 minutes, injection message returned; caller must terminate

// ── Constants ──────────────────────────────────────────────────────────────

const WARN_MS = 30 * 60 * 1_000;       // 30 minutes
const FORCE_STOP_MS = 35 * 60 * 1_000; // 35 minutes

// MSG_WARN reaches her mid-turn (the loop hands it over as a machine note), so it is a fact in her
// language about the clock, not an order to wrap up. MSG_FORCE_STOP only reaches the
// logs; it used to say "Deliver what you have and suggest next steps", a worker's instruction.
const MSG_WARN =
  "这一轮已经过了半个小时，再过五分钟会停下。";
const MSG_FORCE_STOP =
  "Time limit reached (35 minutes).";

// ── Types ──────────────────────────────────────────────────────────────────

export type WatchdogStatus = "ok" | "warn" | "force_stop";

export interface WatchdogResult {
  status: WatchdogStatus;
  message: string | null;
}

export interface Watchdog {
  /**
   * Check elapsed time since the watchdog was created.
   * Returns "ok" (no action), "warn" (inject message), or "force_stop"
   * (inject message + caller must terminate the turn).
   */
  check(): WatchdogResult;

  /** Reset the start time to now (use when beginning a new turn/task). */
  reset(): void;
}

// ── Implementation ─────────────────────────────────────────────────────────

export function createWatchdog(clock: () => number = Date.now): Watchdog {
  let startMs = clock();

  function check(): WatchdogResult {
    const elapsed = clock() - startMs;

    if (elapsed >= FORCE_STOP_MS) {
      return { status: "force_stop", message: MSG_FORCE_STOP };
    }
    if (elapsed >= WARN_MS) {
      return { status: "warn", message: MSG_WARN };
    }
    return { status: "ok", message: null };
  }

  function reset(): void {
    startMs = clock();
  }

  return { check, reset };
}
