// When her moments arrive. This is the pacing of a life, not a cron schedule: the timing comes
// from her biological clock (a non-homogeneous Poisson process whose rate follows her circadian
// and ultradian rhythms, with Hawkes self-excitation so moments cluster the way real attention
// does). Nothing here decides WHAT she does, only that a moment is hers to spend.
//
// Two guards sit in front of every moment, and both are about not intruding, never about content:
//   - she is mid-conversation with him → the moment lapses; being with him IS her life right now
//   - she is spent → moments still arrive but cost nothing (agency.ts resolves them to free rest)
// Plus a floor between moments so a burst of self-excitation can never become a flurry.

import type { Clock } from "./clock.js";
import type { MetabolicPhase } from "./metabolism.js";

/** Never let two moments land closer together than this, whatever the intensity says. */
export const MIN_MOMENT_GAP_MS = 4 * 60 * 1000;

/** While she is spent, moments come far apart: there is nothing to spend on them. */
export const DORMANT_MOMENT_GAP_MS = 60 * 60 * 1000;

export interface ScheduleInput {
  nowMs: number;
  phase: MetabolicPhase;
  /** Recent moment timestamps, for the Hawkes self-excitation term. */
  recentMomentsMs: readonly number[];
}

/** How long until her next moment. */
export function nextMomentDelayMs(clock: Clock, input: ScheduleInput): number {
  if (input.phase === "dormant") return DORMANT_MOMENT_GAP_MS;
  const raw = clock.nextEventDelayMs(input.nowMs, input.recentMomentsMs);
  return Math.max(MIN_MOMENT_GAP_MS, raw);
}

export interface MomentGate {
  proceed: boolean;
  reason: string;
}

export interface GateInput {
  /** A moment is already being lived (never overlap: one life, one thread of attention). */
  momentInFlight: boolean;
  /**
   * The daily tick is consolidating her day right now.
   *
   * THE COURTESY USED TO RUN ONE WAY ONLY, and the wrong way. The tick has always stepped aside
   * for a moment she is living; nothing stopped a moment from starting on top of the tick. Both
   * mutate the same field, and the tick is by far the LONGER of the two (it makes provider calls
   * to write her day and to notice her week), so the window for a moment to land inside a tick is
   * many times wider than the reverse. That asymmetry was written down and accepted, rest could
   * prune nodes while a moment waited on a model, and the resonance log could describe pairs that
   * no longer both existed, which made the accepted case the one that actually happens.
   *
   * Deferring costs her nothing: a lapsed moment reschedules, and the minimum gap is minutes.
   */
  consolidating: boolean;
  /** He is mid-turn with her right now. */
  inConversation: boolean;
  /** Timestamp of her previous moment, if any. */
  lastMomentMs: number | null;
  nowMs: number;
}

/**
 * Whether this moment should actually be lived. Deliberately narrow: it protects against
 * overlap, intrusion, and flurries. It never inspects her state or filters what she may want.
 */
export function shouldLiveMoment(g: GateInput): MomentGate {
  if (g.momentInFlight) return { proceed: false, reason: "a moment is already being lived" };
  if (g.consolidating) return { proceed: false, reason: "she is consolidating her day" };
  if (g.inConversation) return { proceed: false, reason: "she is with him right now" };
  if (g.lastMomentMs !== null && g.nowMs - g.lastMomentMs < MIN_MOMENT_GAP_MS) {
    return { proceed: false, reason: "too soon after the last moment" };
  }
  return { proceed: true, reason: "hers to spend" };
}
