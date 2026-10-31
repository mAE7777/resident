// THE TURN'S OWN BOUNDS, the one long-running path that never had any.
//
// Two live turns hung past the harness's 420-second window with no first frame and no completion:
// the Anthropic client was constructed with no timeout (SDK default: 10 minutes, ×3 with its own
// retries ≈ 30 silent minutes), the SDK clears even that timer the moment response HEADERS arrive
// (so a stream that stalls mid-body is bounded by nothing), and the 35-minute agent watchdog is
// polled only BETWEEN loop iterations: a hung `await provider.complete(...)` sits inside the
// iteration, so the watchdog structurally cannot fire during the very failure it exists for.
//
// Three bounds, sized to nest (asserted in the sweep, not assumed):
//
//   STREAM_STALL_MS   <  PROVIDER_TIMEOUT_MS  <  TURN_DEADLINE_MS  <  the harness's window
//
// so a stalled stream aborts first (and the retry layer gets its chance), a dead connection times
// out second, the whole turn is force-ended third, and all of it resolves BEFORE the live
// harness's 420s listening window, so a hung turn shows up as her saying 「出了岔子」 rather than
// as a censored row in a table.
//
// ABANDONING IS NOT ENOUGH. `withMomentWatchdog` races and walks away, which is right for a
// moment (nothing downstream consumes it) and wrong for a turn: a `gen.next()` that resolves
// twenty minutes late would resume the generator, send him a ghost reply after the 「出了岔子」
// notice, and mutate her history after the fault was recorded. So the turn carries an EPOCH: when
// the deadline fires the epoch dies, and a dead epoch's channel drops every later send and edits
// nothing: the late resolution lands in silence, on the record.
//
// Constants live HERE, in src/life, because the threshold census reads only this directory: a
// deadline in index.ts would be a number that decides how long her turns may be, invisible to the
// instrument that counts such numbers. The daemon's own two, `MOMENT_DEADLINE_MS` and
// `TICK_DEADLINE_MS`, still sit in index.ts and the census still cannot see them, so they are
// measured BY HAND against these three, in `reachable-remaining-numbers.test.ts`, under "the
// daemon's own two life-governing deadlines". (This comment claimed for one round that they were
// "filed in the census blind-spot note"; they were not. A comment asserting a record that does not
// exist is the same defect as a doc asserting a build that does not exist.)

/** Request-level bound: connect + headers. Mirrors the openai-compatible provider's long-standing 120s. */
export const PROVIDER_TIMEOUT_MS = 120_000;

/** Inter-event idle bound on a streaming response: a stream this quiet is dead, not thinking. */
export const STREAM_STALL_MS = 90_000;

/**
 * The whole-turn backstop around the drain loop. Under the live harness's 420s window on purpose:
 * the daemon must notice its own hung turn BEFORE any instrument gives up listening.
 */
export const TURN_DEADLINE_MS = 360_000;

/** The marker a bounded step resolves to when the deadline fired instead of the work. */
export const TURN_HUNG: unique symbol = Symbol("turn-hung");

/**
 * Race one step of work against the remaining turn budget. The work promise is NOT cancelled,
 * a JS promise cannot be, which is exactly why the epoch below exists: the late resolution must
 * arrive into a world that no longer accepts its sends.
 */
export async function stepOrHung<T>(work: Promise<T>, remainingMs: number): Promise<T | typeof TURN_HUNG> {
  if (remainingMs <= 0) return TURN_HUNG;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<typeof TURN_HUNG>((resolve) => {
        timer = setTimeout(() => resolve(TURN_HUNG), remainingMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** One turn's liveness. Killed exactly once, when the deadline fires; never resurrected. */
export interface TurnEpoch {
  alive(): boolean;
  kill(): void;
}

export function createTurnEpoch(): TurnEpoch {
  let alive = true;
  return { alive: () => alive, kill: () => { alive = false; } };
}

/**
 * A streaming response's final result, bounded by inter-event idleness.
 *
 * Generic over the stream so the proof does not need a network: anything that can register an
 * event callback and be aborted fits. Each event resets the stall timer; a gap of `stallMs`
 * aborts the stream and rejects, which the provider chain's retry layer treats as retryable,
 * the correct reading, since a stalled stream says nothing about the next attempt.
 */
export async function finalUnlessStalled<T>(
  s: { final: Promise<T>; onEvent: (bump: () => void) => void; abort: () => void },
  stallMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stalled: (() => void) | undefined;
  const stall = new Promise<never>((_, reject) => {
    const arm = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        try { s.abort(); } catch { /* the abort is best-effort; the rejection is the bound */ }
        reject(new Error(`stream stalled: no event for ${stallMs}ms`));
      }, stallMs);
      timer.unref?.();
    };
    stalled = arm;
    arm();
  });
  s.onEvent(() => stalled?.());
  try {
    return await Promise.race([s.final, stall]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
