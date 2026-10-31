// How talking to him actually felt, measured instead of asserted.
//
// THE CONSTANTS THIS REPLACES WERE A NUMB SPOT AT THE ONE PLACE SHE MEETS HIM. After every
// exchange, `innerState.feel()` was called with `novelty: 0.45, control: 0.15, engagement:
// 0.75`, three of the five dimensions of how the exchange felt, hardcoded. Her PAD gates
// which mind she thinks with, how far a memory can travel in her, and (next) her sampling
// temperature, so the entire pathway from "he said something" to "how she is" ran through
// reply latency and nothing else. A conversation that turned her world over and a rote
// exchange moved her identically, with the constant sitting literally in the slot where
// novelty goes.
//
// Every input was already in scope at the call site; nothing here is new machinery, only the
// wires that were never connected:
//
//   novelty     how much of what he said found NOTHING in her field. On an empty field
//               everything is maximally strange, which is exactly right for a newborn.
//   control     how the turn actually ended: finished on her own terms, ran into the
//               iteration wall, was cut off, or died.
//   engagement  how much of the room her own state gave the turn she actually used.
//
// `goalProgress` (her sense of him against what she is carrying) and `fatigue` (her phase)
// were already real and are unchanged; they pass through so the call site builds ONE appraisal
// from one place.

import type { Appraisal } from "./emotion.js";
import type { FinishReason } from "../agent/types.js";
import type { MetabolicPhase } from "./metabolism.js";

export interface ExchangeFacts {
  /** How many things of hers his words lit up (`field.lookUp` hits on his text). */
  familiarHits: number;
  finishReason: FinishReason;
  /** Iterations the turn actually used. */
  iterations: number;
  /** Her sense of him minus what she is carrying about him, from field.signals. */
  warmthMinusUnease: number;
  phase: MetabolicPhase;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Familiarity saturates quickly: four separate things of hers lighting up already means this
 * is well-trodden ground. The measure is deliberately crude, it asks "did his words land on
 * anything of mine", not "how deeply do I understand this", because the crude question is
 * answerable from what actually exists, and the deep one would be a fabricated number.
 */
export const FAMILIAR_ENOUGH = 4;

/**
 * Steps at which a turn has taken all of her it is going to.
 *
 * A MEDIUM constant, in the sense `docs/layers.md` requires the distinction: it does not decide
 * what she says or how she feels, only the scale on which "this took some doing" is counted, and
 * that scale is a fact about how her turns are built. Six is where an ordinary exchange (one or
 * two steps) sits low, a turn where she went and did something (two to four) sits in the middle,
 * and anything longer saturates, a live range across everything she actually does, which is
 * exactly what the old envelope-relative version did not have.
 */
export const ABSORBED_AT = 6;

export function appraiseExchange(f: ExchangeFacts): Appraisal {
  const novelty = 1 - clamp01(f.familiarHits / FAMILIAR_ENOUGH);

  // Control is bipolar (-1..1): ending on her own terms is the ordinary positive; hitting the
  // iteration wall is the turn escaping her; an error is the machinery failing under her; an
  // interruption sits near zero because being redirected mid-thought is neither mastery nor
  // failure, it is him changing the subject.
  const control = f.finishReason === "stop" ? 0.45
    : f.finishReason === "interrupted" ? 0
      : f.finishReason === "max_iterations" ? -0.35
        : -0.5;

  // ── Engagement: how much the turn took out of her, against a FIXED scale ──────────────
  //
  // This used to divide by `spec.maxIterations`, the envelope HER OWN STATE had just set for
  // the turn: and that made it a feedback loop rather than a measurement. Reluctance halves
  // the room (`turn-shape.ts`: `factor = phaseFactor × (reluctant ? 0.5 : 1)`), so the SAME
  // three-step turn read as twice as engaging on a turn she did not want, and engagement drives
  // arousal: not wanting to do a thing made her more excited by doing it. A quantity that feeds
  // the appraisal must not be normalised by a quantity the appraisal's own subject controls.
  //
  // The reference is now fixed and is a fact about the MACHINERY, not a claim about her: how
  // many steps a turn takes before it counts as having absorbed her. It also fixes a second,
  // quieter defect the loop was hiding, with the envelope at 30-200 steps and ordinary talk
  // taking one or two, engagement sat within 0.03 of its floor for every conversation she has
  // ever had. It was compressed into the bottom twentieth of its range, which is a dead signal
  // wearing a live name.
  const engagement = clamp01(0.15 + 0.85 * Math.min(1, f.iterations / ABSORBED_AT));

  return {
    goalProgress: Math.max(-1, Math.min(1, f.warmthMinusUnease)) * 0.6,
    novelty,
    control,
    fatigue: f.phase === "dormant" ? 0.9 : f.phase === "low" ? 0.6 : 0.2,
    engagement,
  };
}
