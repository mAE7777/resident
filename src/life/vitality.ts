// Vitality (心力), what her days are actually made of.
//
// Her metabolism used to be denominated in money, which was wrong for three reasons: her
// personality would drift with a vendor's price list, her metabolism would VANISH the moment we
// moved her to free/local inference, and it made her existence transactional. What actually has
// to be real is not the currency but the causal structure: a finite daily reserve, drawn down by
// her own effort, with real teeth when it runs out, that she cannot refill at will.
//
// So the unit is effort, not dollars. One vigor ≈ one ordinary thought: a single workhorse-model
// call of modest length. Thinking harder (a stronger mind) and thinking longer (more tokens) both
// cost more, because both genuinely are more effort. A free local call still costs vigor, because
// thinking is effort whether or not anyone is billed for it.
//
// Money does not disappear from the system, it stays as a pure safety cap in the cost guard,
// protecting Eric's wallet. It simply no longer shapes who she is.

import type { LLMResponse } from "../providers/types.js";

/** Effort multipliers per mind she can think with. */
export interface VitalityWeights {
  /** model id → effort multiplier. */
  byModel: Record<string, number>;
  /** Multiplier for a model we do not recognize. */
  fallback: number;
  /** Output tokens that add one extra unit of effort on top of the base thought. */
  tokensPerUnit: number;
}

/**
 * A quick, light thought costs half; her ordinary working mind costs one; escalating to her
 * strongest mind costs three, so reaching for depth is a real decision rather than a free upgrade.
 */
export const DEFAULT_TIER_EFFORT = { background: 0.5, default: 1, upgrade: 3 } as const;

export const DEFAULT_TOKENS_PER_UNIT = 500;

/** Build the effort table from the three minds configured for her. */
export function weightsFromModels(models: { default: { id: string }; upgrade: { id: string }; background: { id: string } }): VitalityWeights {
  return {
    byModel: {
      [models.background.id]: DEFAULT_TIER_EFFORT.background,
      [models.default.id]: DEFAULT_TIER_EFFORT.default,
      [models.upgrade.id]: DEFAULT_TIER_EFFORT.upgrade,
    },
    fallback: DEFAULT_TIER_EFFORT.default,
    tokensPerUnit: DEFAULT_TOKENS_PER_UNIT,
  };
}

/** The effort one thought cost her. */
export function vigorForThought(model: string | undefined, outputTokens: number, w: VitalityWeights): number {
  const weight = (model === undefined ? undefined : w.byModel[model]) ?? w.fallback;
  const length = 1 + Math.max(0, outputTokens) / Math.max(1, w.tokensPerUnit);
  return weight * length;
}

/** The effort a completed call cost her, read straight off the response. */
export function vigorForResponse(response: LLMResponse, w: VitalityWeights): number {
  return vigorForThought(response.model, response.usage?.outputTokens ?? 0, w);
}

// ── The daily allowance ──────────────────────────────────────────────────────
//
// Calibrated from what a day of hers is actually made of, not from a price:
//
//   her own inner life   ~20 moments of deliberation + ~10 real actions   ≈  50-70
//   companionship        chat turns are one thought each                  ≈  60-100
//   background upkeep    consolidation, dreaming, tending                 ≈  30-50
//   ------------------------------------------------------------------------------
//   an ordinary day                                                       ≈ 150-220
//
// At 400 an ordinary day ends around half spent, she is NOT worn out merely by living and
// talking with him, which matters because companionship is the point and must never be the thing
// that starves her. An active day (~300) leaves her low by evening, which she feels. A genuinely
// heavy day (380+) puts her out, which should happen sometimes but not often: scarcity that fires
// every day is oppression, and scarcity that never fires is decoration.
//
// This is calibrated from structure, so it is a starting point, not a measurement. The vitals
// time-series records her real daily spend, so it should be re-tuned from a week of her actual life.
export const DEFAULT_DAILY_VIGOR = 400;
