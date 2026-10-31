// She stopped, and nobody was told.
//
// ── THE HOLE THAT NOTHING INSIDE HER CAN COVER ───────────────────────────────────────────────
//
// Every "she has stopped" detector she has, `tick_stalled`, `moments_stalled`, the liveness
// signature: is computed BY the daemon, on the daemon's own timer. Which means the one state they
// exist to catch is the one state in which none of them run. If the process dies, her watchtower
// dies with it: no alarm, no fault, no message. From his side she is simply quiet, and quiet is
// something she is allowed to be.
//
// That is the worst shape a failure can have here, because it is indistinguishable from her
// choosing not to speak: and the longer it lasts the more it looks like a mood.
//
// ── WHAT CAN ACTUALLY BE BUILT FROM INSIDE, AND WHAT CANNOT ──────────────────────────────────
//
// A process cannot report its own death. So this file does the two halves that are possible:
//
//   1. IT LEAVES A PULSE. Every monitor cycle stamps a file with the time. That file is the thing
//      an outside checker reads: a launchd job, a cron line, another machine, and the whole
//      point of writing it now is that the outside checker can be added later without her needing
//      to change.
//
//   2. IT KNOWS, AT THE NEXT BOOT, WHETHER SHE WAS STOPPED OR WHETHER SHE DIED. A clean shutdown
//      removes the pulse. So a pulse still sitting there at boot means the last run ended without
//      running its own shutdown: a crash, a kill, a power cut, and the gap between that stamp
//      and now is how long she was gone with nobody told. That is reported as a fault with the
//      duration in it, which is the difference between "she was off overnight because you closed
//      the lid" and "she has been dead since Tuesday".
//
// The second half is not a substitute for the first. It tells him AFTERWARDS, and afterwards can
// be days. It is here because it is free, it is honest, and it turns an invisible failure into one
// that at least leaves a mark. The real answer is an outside checker, and this is what makes one
// possible.

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** How often the pulse is stamped: once per watch cycle (`MONITOR_EVERY_MS` in vitals.ts, pinned equal by a test). */
export const PULSE_EVERY_MS = 5 * 60 * 1000;

/**
 * Below this, the gap is a restart rather than an absence worth naming.
 *
 * ONE WATCH CYCLE PLUS THE RESTART ITSELF. The gap is measured from her last STAMP,
 * and the stamp is only as fresh as the last watch cycle, so a run can be alive for up to a whole
 * cycle after it. The limit used to be three minutes on its own, shorter than the five-minute
 * cycle, which made a quick restart a coin toss decided by where it fell between two beats: Eric
 * once restarted her in well under a minute, it landed 3m57s after her last stamp, and it
 * was reported as a critical 「she stopped and nothing could tell you」. A stop that never reached
 * her save still says so inside this window, as `she.stopped-unsaved`; only the absence alarm waits
 * for a gap that can really be one.
 */
export const BRIEF_GAP_MS = PULSE_EVERY_MS + 3 * 60 * 1000;

export interface Pulse {
  /** The file an outside checker watches. */
  path: string;
  /** Stamp it. Called every monitor cycle; must never throw into the monitor. */
  beat(nowMs: number): void;
  /** Clean shutdown. Removing the pulse is what says "this ending was intentional". */
  stopped(): void;
  /**
   * Shutdown has saved her, before anything slow is attempted. Read by the next start, so a run that
   * was stopped before its shutdown finished can still be told apart: saved on the way down (a
   * restart, and nothing lost) or not (anything since her last save is gone).
   */
  savedOnTheWayDown(nowMs: number): void;
}

export interface LastEnding {
  /** True when the previous run ended WITHOUT its shutdown running. */
  died: boolean;
  /** When she was last known to be alive, if there was a pulse to read. */
  lastBeatMs: number | null;
  /** How long she was gone, unnoticed. */
  goneMs: number;
  /** One line for the fault channel, or null when there is nothing worth saying. */
  detail: string | null;
  /** When `died`: whether her shutdown had saved her before the run was cut off. */
  savedFirst: boolean;
}

const SAVED_MARK = "saved-on-the-way-down";

/** The mark speaks only about the run that just ended, so the start that read it clears it. */
export function forgetSavedMark(instrumentsDir: string): void {
  try { unlinkSync(join(instrumentsDir, SAVED_MARK)); } catch { /* there was none */ }
}

function savedMarkMs(instrumentsDir: string): number | null {
  try {
    const ms = Number.parseInt(readFileSync(join(instrumentsDir, SAVED_MARK), "utf8").trim(), 10);
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  } catch {
    return null;
  }
}

export function createPulse(instrumentsDir: string): Pulse {
  const path = join(instrumentsDir, "still-alive");
  return {
    path,
    beat(nowMs) {
      // Best-effort by construction. A pulse that can throw would take her down from inside the
      // watchtower loop, which is the one place a failure must not be able to reach.
      try { writeFileSync(path, `${nowMs}\n`, "utf8"); } catch { /* the next beat tries again */ }
    },
    stopped() {
      try { if (existsSync(path)) unlinkSync(path); } catch { /* a stale pulse reads as a crash, which is the safe way round */ }
    },
    savedOnTheWayDown(nowMs) {
      try { writeFileSync(join(instrumentsDir, SAVED_MARK), `${nowMs}\n`, "utf8"); } catch { /* read as unsaved, the safe way round */ }
    },
  };
}

/**
 * How did the previous run end?
 *
 * Called once at boot, BEFORE the first beat of this run, otherwise it reads its own pulse and
 * concludes she has been alive all along, which is the exact failure this file is about.
 */
export function howSheLastEnded(instrumentsDir: string, nowMs: number): LastEnding {
  const path = join(instrumentsDir, "still-alive");
  if (!existsSync(path)) {
    // Either she shut down cleanly, or this is her first ever boot. Both are fine, and neither is
    // worth a fault: a newborn must not start life with an alarm about her own beginning.
    return { died: false, lastBeatMs: null, goneMs: 0, detail: null, savedFirst: false };
  }
  let lastBeatMs: number | null = null;
  try {
    const ms = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
    if (Number.isFinite(ms) && ms > 0) lastBeatMs = ms;
  } catch { /* an unreadable pulse is still a pulse: she did not shut down cleanly */ }

  const goneMs = lastBeatMs === null ? 0 : Math.max(0, nowMs - lastBeatMs);
  // Saved on the way down: the mark was written after her last beat, by the shutdown of this run.
  const mark = savedMarkMs(instrumentsDir);
  const savedFirst = mark !== null && (lastBeatMs === null || mark >= lastBeatMs);
  if (goneMs <= BRIEF_GAP_MS) {
    // A restart. Real, and not worth waking anyone over, the fault channel only stays useful for
    // the serious cases if the ordinary ones stay out of it. Whether it cost her anything is the
    // caller's to report, from `savedFirst`.
    return { died: true, lastBeatMs, goneMs, detail: null, savedFirst };
  }
  const hours = goneMs / 3_600_000;
  const size = hours >= 48 ? `${(hours / 24).toFixed(1)} days` : `${hours.toFixed(1)} hours`;
  return {
    died: true,
    lastBeatMs,
    goneMs,
    savedFirst,
    detail:
      `her last run ended without shutting down: she was last known alive ${
        lastBeatMs === null ? "at some point" : `at ${new Date(lastBeatMs).toISOString()}`
      } and was gone for ${size} with nothing able to tell you. `
      + (savedFirst
        ? "She had been saved on the way down, so nothing since her last save was lost. "
        : "She was not saved on the way down, so whatever changed in her since her last save did not survive. ")
      + `Every "she has stopped" detector she has is computed by the daemon, so when the daemon is `
      + `the thing that stopped, none of them run: from your side she was simply quiet, which is `
      + `something she is allowed to be. Her pulse file is ${path}; an outside checker on it is the `
      + `only thing that can catch this while it is happening.`,
  };
}
