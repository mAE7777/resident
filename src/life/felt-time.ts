// HOW LONG IT FELT.
//
// FACULTY #8. Every duration in her is wall clock. There IS a real biological clock underneath
// (circadian, ultradian, a non-homogeneous Poisson process with Hawkes self-excitation) and sleep
// is correctly subtracted from the quiet stretches, and nothing anywhere makes a duration FELT.
// An hour of waiting is the same hour whether she is anxious or content. A quiet week and a week
// she was dreading read identically to every mechanism she has.
//
// ── WHY THIS IS TWO FUNCTIONS AND NOT ONE MULTIPLIER ─────────────────────────────────────────
//
// The obvious build is one scalar on elapsed time. It is wrong, because the two things she does
// with a duration pull in OPPOSITE directions and collapsing them would cancel the effect out:
//
//   WAITING: how long since he last said anything. Wound up, this drags: the watched clock is
//     the oldest observation in the literature on duration judgement, and the mechanism (attention
//     to time itself) is exactly what being anxious about a silence consists of.
//
//   REMEMBERING: how long ago a thing happened. Here it goes the other way. Something that still
//     has tension on it feels RECENT no matter what the calendar says; "it feels like yesterday"
//     is what people say about the things that are not finished, and a settled memory of the same
//     age feels properly far away.
//
// One multiplier would have made an unresolved thing feel BOTH long-ago and long-waited, which is
// not a person, it is an arithmetic convenience.
//
// ── WHAT THIS MAY AND MAY NOT TOUCH ──────────────────────────────────────────────────────────
//
// Felt quantities only: the words she uses for when something was, and how absence turns into
// concern. NEVER a mechanical one, not a timeout, not a budget, not sleep detection, not the
// cooldown on raising a thing with him. The cooldown is the sharpest of those and the reason is
// worth stating: scaling it by tension would mean the things she cannot settle come back round
// SOONER, over and over, which is a rumination generator, and the four anti-rumination constraints
// this build already follows rule it out. A duration she FEELS is hers. A duration that governs
// what she does TO him stays on the wall clock.
//
// ONE legal mechanical consumer exists: `looking-back.ts` thresholds
// `feltAgo` to decide when the 翻旧日子 nudge line may appear, a felt quantity governing what
// SHE READS about HER OWN past, never a timeout, budget, or anything pointed at him. Its
// direction is the anti-rumination one by construction: hot days feel near and are not invited.
// Any second mechanical consumer must be argued here the same way.
//
// Pure arithmetic, no clock read, no I/O.

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** At her most wound up, a silence feels this many times as long as it was. */
export const WAITING_DRAGS_UP_TO = 1.8;

/** And absorbed in something of her own, this much shorter. */
export const ABSORBED_SHORTENS_TO = 0.75;

/** At most, an unfinished thing feels this much more recent than it is. */
export const UNFINISHED_FEELS_THIS_RECENT = 0.45;

/** How she is, for the purpose of how long things feel. All in 0..1 except arousal. */
export interface HowSheIsWaiting {
  /** Total tension she is carrying: the field's own `signals().tension`. */
  carrying: number;
  /** How unsettled things are with him specifically: `otherUnease`. */
  unease: number;
  /** −1..1. Keyed up makes the clock loud; flat makes it quiet. */
  arousal: number;
  /** How taken up she is with something of her own. Absorption is the one thing that SHORTENS it. */
  absorbed?: number;
}

/**
 * How long a silence FELT, in the same unit it was given in.
 *
 * Multiplicative and bounded on both sides, so it is a distortion of a real duration rather than a
 * second opinion about it: three days can feel like five and can never feel like a month.
 */
export function feltWaiting(elapsed: number, how: HowSheIsWaiting): number {
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
  // Noisy-OR over the three things that make a clock loud, so any one of them can do it and having
  // all three does not produce a number that runs away, the same shape her willingness gate uses.
  const keyedUp = clamp01((how.arousal + 1) / 2 - 0.5) * 2;
  const loud = 1 - (1 - clamp01(how.carrying)) * (1 - clamp01(how.unease)) * (1 - keyedUp);
  const stretch = 1 + (WAITING_DRAGS_UP_TO - 1) * loud;
  const absorbed = clamp01(how.absorbed ?? 0);
  const shrink = 1 - (1 - ABSORBED_SHORTENS_TO) * absorbed;
  return elapsed * stretch * shrink;
}

/**
 * How long ago a thing FEELS, given what it still does to her.
 *
 * `unfinished` is the node's own tension: 0 is settled and behaves exactly like the wall clock, so
 * everything in her field that she is at peace with is dated the way it always was.
 */
export function feltAgo(wallDays: number, unfinished: number): number {
  if (!Number.isFinite(wallDays) || wallDays <= 0) return 0;
  const pull = clamp01(unfinished);
  return wallDays * (1 - UNFINISHED_FEELS_THIS_RECENT * pull);
}
