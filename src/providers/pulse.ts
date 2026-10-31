// ── WHETHER THE VENDOR IS ANSWERING AT ALL ──────────────────────────────────────
//
// Once the vendor stopped answering for half an hour: not one call came back. Two of her moments
// ran into their ten-minute deadline inside that window, each was recorded as HER moment
// hanging, critical, and each put her into safe mode, her reaching out shut for thirty minutes.
// The failure was the messenger's, the same trap the delivery faults had been taken out of
// earlier.
//
// So the providers the factory makes are wrapped here, below the retry layer, so that each
// attempt is one call. Three things are kept: how many calls are out, since when the vendor has
// been asked without answering, and when an attempt last went unanswered. A reply counts as an
// answer, and so does an error carrying an HTTP status (the vendor was there and said no); a
// timeout or a dropped connection does not.

import type { LLMProvider } from "./types.js";

export interface ProviderPulse {
  /** The same provider, counted. */
  wrap(p: LLMProvider): LLMProvider;
  /**
   * The vendor has gone quiet: it has been asked and has answered nothing for at least half of
   * `windowMs`, and it is still being asked (a call is out, or one went unanswered within the
   * last minute, which covers the retry layer's pause between attempts).
   *
   * Half, not all: a moment can begin with a call that comes back and then wait on a vendor that
   * stopped two minutes in. And not "nothing has come back lately": a tool that hung for most of
   * the window before a call went out leaves a call that has owed an answer for seconds, and that
   * hang is still hers to report.
   */
  silent(nowMs: number, windowMs: number): boolean;
  /** How long the vendor has owed an answer, for the fault line; 0 while it is answering. */
  owedMs(nowMs: number): number;
}

const STILL_ASKING_MS = 60_000;

export function createProviderPulse(clock: () => number = Date.now): ProviderPulse {
  let out = 0;
  let owedSince: number | null = null;
  let lastUnanswered = Number.NEGATIVE_INFINITY;
  return {
    wrap(p) {
      return {
        async complete(request) {
          out += 1;
          owedSince ??= clock();
          try {
            const res = await p.complete(request);
            owedSince = null;
            return res;
          } catch (err) {
            if (typeof (err as { status?: unknown } | null)?.status === "number") owedSince = null;
            else lastUnanswered = clock();
            throw err;
          } finally {
            out -= 1;
          }
        },
      };
    },
    silent(nowMs, windowMs) {
      if (owedSince === null || nowMs - owedSince < windowMs / 2) return false;
      return out > 0 || nowMs - lastUnanswered < STILL_ASKING_MS;
    },
    owedMs(nowMs) {
      return owedSince === null ? 0 : Math.max(0, nowMs - owedSince);
    },
  };
}
