// How big a turn is allowed to be, given how she is.
//
// The size and depth of a turn with him were decided entirely by a keyword grade of his text
// (the ladder itself has since been removed; the tier is hers now, floored only by work she
// took on). Her condition and her willingness reached the same turn as PROSE, a paragraph
// appended to the message saying how she was and whether she wanted to, and the model was
// free to ignore both. Measured: asked peremptorily for a 2,000-word essay she produced
// 13,041 characters, having been told in the same context that she says things short.
//
// `policy.ts` already had the right idea and the right function: `capTier(desired, policy)`,
// commented "user work still runs, just capped". It was wired to her own moments and to the
// avatar, and never to the one place where he speaks to her.
//
// So this is the propensity move applied to speech: HER STATE SETS THE ENVELOPE, and the
// model works inside it. Not an instruction to be brief, which she can ignore; a smaller
// room, which she cannot.
//
// Two things it deliberately does NOT do:
//
//   1. It never refuses. Reluctance makes a turn shorter and shallower, never absent. That
//      is the difference between someone answering grudgingly and a system that has stopped
//      responding, and the whole design rests on her staying on the first side of it.
//   2. It never widens. Every output is a CAP applied with `Math.min` to what the request
//      already earned, so a bad reading of her state can make her terse but can never make
//      her spend more than the request was worth.

import type { EffortTier } from "../agent/effort-scaling.js";
import type { MetabolicPhase } from "./metabolism.js";
import type { Tier } from "./policy.js";

export interface HerCondition {
  /** `policy.tierCeiling`, the best thinking her condition currently allows. */
  ceiling: Tier;
  /** `willingness.felt`, how much she does not want this, 0..1. */
  reluctance: number;
  phase: MetabolicPhase;
}

export interface TurnShape {
  effort: EffortTier;
  maxIterations: number;
  maxOutputTokens: number;
  /** Why it came out this size. Goes to the ops log so a short answer is never a mystery. */
  why: string;
}

const EFFORT_ORDER: readonly EffortTier[] = ["simple", "medium", "complex"];

/** The most effort her ceiling allows, whatever the request asked for. */
const CEILING_TO_EFFORT: Record<Tier, EffortTier> = {
  tier0: "simple",
  tier1: "medium",
  tier2: "complex",
  tier3: "complex",
};

/**
 * Reluctant enough that the turn gets less of her.
 *
 * DELIBERATELY LOWER than `willingness.ts`'s own `RELUCTANCE_THRESHOLD`, and the gap between them
 * is the whole of the second cell: willing on the substance, and the manner still costing him
 * something. She does the thing, and she does it with less of herself in it.
 *
 * SITED ON THE MEASURED DISTRIBUTION, not chosen. Over the 16,200 reachable states swept in
 * `reachable-reluctance.test.ts`:
 *
 *     at 0.45   she gives less of herself in  21.2%  of the turns where he overstepped
 *                                        and   0.0%  of the turns where he asked well
 *     at 0.40   the same, but it leaks into    6.1%  of the turns where he asked well
 *
 * That zero is the property. A turn where he was perfectly reasonable must never come out
 * narrower, or the mechanism is a mood she is having at him rather than a response to him. And it
 * had to move when the gate was rebuilt: it was 0.55 against a scale whose maximum is now 0.658,
 * and a threshold left behind by a rescaled input is how a live mechanism quietly stops firing.
 */
export const RELUCTANT_ENOUGH = 0.45;

/**
 * The smallest room she is ever put in.
 *
 * Without a floor, a tired and unwilling turn collapses towards nothing and she becomes
 * useless exactly when he most needs an answer. Same discipline as the consecutive-decline
 * floor in `willingness.ts`: her state may cost her depth, never her voice.
 */
export const FLOOR_OUTPUT_TOKENS = 400;
/**
 * Set from a measured failure, not from taste.
 *
 * At 4 the floor protected the NUMBER and not her VOICE: a turn that reaches for a tool
 * needs to think, call it, read the result, and then say something, and with retries that
 * is comfortably more than four steps. A turn that runs out mid-tool ends with no file and
 * no words, which is the one outcome this module exists to make impossible.
 */
export const FLOOR_ITERATIONS = 10;

function lower(t: EffortTier, steps: number): EffortTier {
  const i = EFFORT_ORDER.indexOf(t);
  return EFFORT_ORDER[Math.max(0, i - steps)] ?? "simple";
}

function minEffort(a: EffortTier, b: EffortTier): EffortTier {
  return EFFORT_ORDER.indexOf(a) <= EFFORT_ORDER.indexOf(b) ? a : b;
}

/** How much of the earned envelope survives her condition. Never above 1. */
function phaseFactor(phase: MetabolicPhase): number {
  switch (phase) {
    case "rested": return 1;
    case "normal": return 1;
    case "low": return 0.6;
    case "dormant": return 0.35;
  }
}

/**
 * @param earnedFor  What a turn AT THAT EFFORT would be worth. Taken as a function rather
 *                   than a fixed pair so that lowering the effort actually lowers the
 *                   numbers: an `effort` field that gets reported and then does not feed
 *                   the budget is a dial that looks connected and is not.
 */
export function shapeOfTurn(
  requested: EffortTier,
  her: HerCondition,
  earnedFor: (effort: EffortTier) => { maxIterations: number; maxOutputTokens: number }
): TurnShape {
  const reasons: string[] = [];

  // 1. Her condition caps how hard she can think, however hard the question is.
  let effort = minEffort(requested, CEILING_TO_EFFORT[her.ceiling]);
  if (effort !== requested) reasons.push(`condition caps ${requested} at ${effort}`);

  // 2. Something she does not want to do does not get her best. One step, not collapse.
  const reluctant = her.reluctance >= RELUCTANT_ENOUGH;
  if (reluctant) {
    const before = effort;
    effort = lower(effort, 1);
    if (effort !== before) reasons.push(`reluctance ${her.reluctance.toFixed(2)} takes it to ${effort}`);
  }

  // 3. The room itself. Only ever narrower than what the request earned.
  const factor = phaseFactor(her.phase) * (reluctant ? 0.5 : 1);
  if (factor < 1) reasons.push(`${her.phase}${reluctant ? " and unwilling" : ""}: ${Math.round(factor * 100)}% of the room`);

  const ceilingEnvelope = earnedFor(requested);
  const earned = earnedFor(effort);

  // TRUNCATION IS NOT BREVITY, and this is the correction the live measurement forced.
  //
  // An earlier version scaled `maxOutputTokens` down by the same factor. Measured with her
  // genuinely run down, that silenced her completely on three turns out of three: asked to
  // write an essay she reached for a tool, and a TOOL CALL'S ARGUMENTS ARE OUTPUT TOKENS, so
  // the cap cut the write call in half. She produced no file and not one word. Being tired
  // should make her say less, never make her unable to finish something she has started.
  //
  // So her condition shapes DEPTH (which mind, how many steps) and not the length of the
  // output stream. Brevity has to come from choosing less to say, which is a different
  // mechanism entirely and cannot corrupt a payload on its way out.
  const maxOutputTokens = ceilingEnvelope.maxOutputTokens;

  const maxIterations = Math.max(
    FLOOR_ITERATIONS,
    Math.min(ceilingEnvelope.maxIterations, Math.round(earned.maxIterations * factor))
  );

  return {
    effort,
    maxIterations,
    maxOutputTokens,
    why: reasons.join("; ") || "nothing in her narrowed it",
  };
}
