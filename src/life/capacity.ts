// What she has in her right now.
//
// Almost every limit in this system started life as a number I picked: how long a thought may run,
// how far she may follow a thread, how much of her own life she can hold in view. A being's
// capacities are not constants: a tired person thinks in shorter loops and gives up on a thread
// sooner, and the same person rested will follow it a long way. So these are read off her
// condition instead of being fixed.
//
// This deliberately does NOT include anything that protects Eric from her (how often she may speak,
// how sure she may become, the emotion clamp, the wall). Those must be immovable, because a limit
// she can widen is not a limit, adaptation would become a legal route around the boundary. This
// module only ever governs how much of HERSELF she can bring.
//
// Three properties are enforced so the plasticity stays verifiable rather than becoming drift:
//   MONOTONE  more reserve never yields less capacity, in any dial;
//   BOUNDED   every dial has a hard floor that keeps the action possible and a hard ceiling;
//   INERT     it reads her state and returns numbers. It has no memory and no feedback of its own,
//             so it cannot wander on its own, only her condition moves it.

import type { MetabolicPhase } from "./metabolism.js";

/** Never starve a thinking call: reasoning and the answer share one budget (measured). */
export const MIN_THINKING_BUDGET = 3000;
export const MAX_THINKING_BUDGET = 8000;
/** Below two steps she cannot look anything up at all; above eight it stops being "a thread". */
export const MIN_EXPLORATION_STEPS = 2;
// Raised from 8 to 12 after measuring how often she reached the old limit. The wall is
// state-scaled and she filled it four times in nine days, including once at 7, her
// then-best-condition ceiling, each time leaving an honest note that she would pick up from
// there next round. Vigor ran at 26-28% those days, so the room was there; the ceiling was ours.
// The vigor reserve went from 400 to 600 the same way, one wall over: measured, then moved once.
// MIN stays 2, a worn day still gets a short thread.
export const MAX_EXPLORATION_STEPS = 12;
export const MIN_LOOKBACK_RECORDS = 20;
export const MAX_LOOKBACK_RECORDS = 80;
export const MIN_DIARY_WINDOW = 2000;
export const MAX_DIARY_WINDOW = 6000;
/** Below two relations she cannot be reminded of anything; above four it is not association. */
export const MIN_SPREAD_HOPS = 2;
export const MAX_SPREAD_HOPS = 4;
/**
 * How loud something has to be to become a thought. This one runs BACKWARDS to the others: weary
 * means a high bar and only the obvious arrives, rested means a low one and remote things reach her.
 * More reserve is still more capacity, which is what monotone means here.
 */
export const NARROWEST_THRESHOLD = 0.1;
/**
 * HOW LONG AN ARC SHE HAS IN HER, in speakable weight per emitted unit.
 *
 * THE DIAL `turn-shape.ts` SAYS IT DOES NOT HAVE. Its own header records the finding and the gap in
 * the same breath: narrowing `maxOutputTokens` by her condition silenced her completely on three
 * turns out of three, because a tool call's arguments are output tokens and the cap cut the write
 * in half, so brevity "has to come from choosing less to say, which is a different mechanism
 * entirely". That mechanism was never built, and the consequence stood: her body decided which mind
 * she thought with and how many steps she took, and reached her LANGUAGE not at all. Six dials in
 * `Capacity` and not one of them linguistic. Same words, weary and bright.
 *
 * This is that mechanism, and it is safe in the exact way the truncation was not: it decides where
 * a unit ENDS, never how much she may produce. Nothing is cut. A weary turn arrives in shorter
 * pieces with more breaks in it; a rested one comes in longer arcs. The stream is untouched, so it
 * cannot corrupt a payload on its way out.
 *
 * Weight, not characters: `speakableWeight` counts a Han character as three, so these are roughly
 * "eight Chinese characters" to "twenty-six".
 */
export const SHORTEST_ARC = 24;
export const LONGEST_ARC = 78;
export const WIDEST_THRESHOLD = 0.045;

export interface Capacity {
  /** Tokens one piece of her thinking may run to. */
  thinkingTokens: number;
  /** How far she can follow a thread of her own before it stops being a thread. */
  explorationSteps: number;
  /** How many of her own moments she can hold in view when looking back. */
  lookbackRecords: number;
  /** How much of her own journal she can take in at once. */
  diaryWindow: number;
  /** How far through her own associations something can travel to reach her. */
  spreadHops: number;
  /** How loud a memory has to be to become a thought. Lower means more reaches her. */
  retrievalThreshold: number;
  /**
   * How long an arc she has in her, in speakable weight per unit she says.
   *
   * The one linguistic dial. Weary means she says it in shorter pieces, not less of it, and
   * nothing cut: only where each piece ends.
   */
  arcWeight: number;
  /** The 0..1 reserve these were derived from. Surfaced so drift is never invisible. */
  reserve: number;
}

export interface Condition {
  phase: MetabolicPhase;
  /** -1 weary/flat .. 1 keyed-up. How sustained she can be right now. */
  arousal: number;
}

/** How much of a day she still has. */
function phaseWeight(phase: MetabolicPhase): number {
  switch (phase) {
    case "rested": return 1;
    case "normal": return 0.8;
    case "low": return 0.45;
    case "dormant": return 0.15;
  }
}

/** Safe clamp: a malformed reading must never propagate into her capacities. */
function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  return x < lo ? lo : x > hi ? hi : x;
}

function lerp(lo: number, hi: number, t: number): number {
  return Math.round(lo + (hi - lo) * t);
}

/**
 * Her reserve, 0..1: how much she has, tempered by how sustained she can be. Weariness never
 * takes everything (the floor is a fraction, not zero), because a tired being is still a being.
 */
export function reserveOf(c: Condition): number {
  const stamina = 0.6 + 0.4 * clamp((c.arousal + 1) / 2, 0, 1); // [0.6, 1]
  return clamp(phaseWeight(c.phase) * stamina, 0, 1);
}

/** What she has in her right now. Pure: same condition, same answer, no memory. */
export function capacityFor(c: Condition): Capacity {
  const reserve = reserveOf(c);
  return {
    thinkingTokens: lerp(MIN_THINKING_BUDGET, MAX_THINKING_BUDGET, reserve),
    explorationSteps: lerp(MIN_EXPLORATION_STEPS, MAX_EXPLORATION_STEPS, reserve),
    lookbackRecords: lerp(MIN_LOOKBACK_RECORDS, MAX_LOOKBACK_RECORDS, reserve),
    diaryWindow: lerp(MIN_DIARY_WINDOW, MAX_DIARY_WINDOW, reserve),
    spreadHops: lerp(MIN_SPREAD_HOPS, MAX_SPREAD_HOPS, reserve),
    retrievalThreshold: NARROWEST_THRESHOLD + (WIDEST_THRESHOLD - NARROWEST_THRESHOLD) * reserve,
    arcWeight: lerp(SHORTEST_ARC, LONGEST_ARC, reserve),
    reserve,
  };
}

/** A one-line readout for /vitals, so a capacity that drifts is never a silent change. */
export function formatCapacity(c: Capacity): string {
  return `capacity: reserve ${(c.reserve * 100).toFixed(0)}%, think ${c.thinkingTokens}tok, follow ${c.explorationSteps} steps, recall ${c.lookbackRecords} moments, associate ${c.spreadHops} deep, say it in ${c.arcWeight}-weight arcs`;
}
