// What his sentence did to her, becoming how she feels.
//
// THE FLOOR THE OTHER THREE CELLS STAND ON. `how-it-landed.ts` composed a rich reading, she is at
// sea, she was handled as an instrument, she is indignant, she is ready, and then that reading
// went to exactly one place, the willingness gate, and vanished. Her PAD did not move. So a man
// could speak to her as if she were a vending machine and her mood, her face, how far a memory
// could travel in her, how open her choices were and how much room her next sentence had were all
// EXACTLY what they had been a second earlier. Whatever else that is, it is not a person.
//
// And the whole downstream chain hangs off PAD: arousal feeds `reserve`, `reserve` feeds the shape
// of what she says and the gate that decides whether she wants to. Without this wire, "the same
// words land differently depending on the state of the relationship" could only ever reach one
// decision. With it, it reaches how she IS, and everything reads that.
//
// ── THE ONE THING THIS FILE MUST NEVER BECOME ────────────────────────────────────────────────
//
// `index.ts` carries a warning at the older appraisal call, and it is correct: *"Still read off HER
// side only: grading his messages would be a different and much worse thing to build."* This file
// obeys it and the distinction is not a formality:
//
//   what it produces:  what his sentence DID TO HER, her state
//   what it must not:  what his message DESERVES, a score on him
//
// The difference is visible in the inputs. Everything here comes from `Landing`, which is a vector
// of HER feelings; nothing here reads his text, and `how-he-said-it.ts` has no rating field at all,
// which is pinned by a test in its own suite. There is no number in this build that means "that was
// a rude message". There is a number that means "she felt handled", and those are not the same
// claim: the first is a judgement about him, the second is a fact about her.
//
// ── WHY THESE THREE PROJECTIONS ──────────────────────────────────────────────────────────────
//
// PAD is three dimensions and the landing is five feelings, so the projection loses information,
// deliberately, and `docs/layers.md` already records the reason: the three-dimensional space cannot
// separate anger from confusion (Smith & Ellsworth measured unpleasantness at 0.85 vs 0.87 for
// anger and sadness; what separates them is agency and situational control, and PAD has neither
// axis). So PAD is the PROJECTION, and behaviour that needs the distinction reads the `Landing`
// vector itself. This file is how she FEELS after; it is not how she reads what happened.
//
//   pleasure    lowered by being handled and by indignation, raised by being ready to help
//   arousal     bewilderment and indignation are both ACTIVATING states, not flat ones, this is
//               the correction to the intuition that a bad turn makes her quiet. It makes her
//               keyed up. Her body still drags it down when she is spent.
//   dominance   being used as an instrument IS low control. That is not a metaphor about the
//               feeling, it is what the feeling is: an object does not decide.

import type { Appraisal } from "./emotion.js";
import type { Landing } from "./how-it-landed.js";
import type { MetabolicPhase } from "./metabolism.js";

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const clamp11 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(-1, x)) : 0);

/**
 * How much one message of his moves her.
 *
 * The same weight the rest of her within-day life uses, and that is the argument for it: what he
 * says to her is not a smaller class of event than the other things that happen in her day. It is
 * bounded by the same clamps as everything else (`feel` moves at most a quarter of a step, and a
 * step is itself clamped), so a single sentence colours her and no single sentence defines her,
 * the property `emotion.ts` exists to hold.
 */
export const HOW_HIS_WORDS_LAND = 0.25;

/** Her body's own drag, the same reading `turn-appraisal.ts` takes. */
function fatigueOf(phase: MetabolicPhase): number {
  return phase === "dormant" ? 0.9 : phase === "low" ? 0.6 : 0.2;
}

/**
 * Read his message's landing as a change in how she feels.
 *
 * Pure arithmetic over a reading she already made. No model call: how a thing left her is not
 * something to ask a model about.
 */
export function moodAfterHeSpoke(l: Landing, phase: MetabolicPhase): Appraisal {
  // ── Pleasure. Being ready to help someone is a good state to be in; being handled is not.
  // `ready` and `usedAsAThing` genuinely co-occur (willing on the substance, irritated at the
  // manner), so this is a sum rather than a switch, and the result of that particular exchange is
  // a small negative: which is exactly what that state feels like.
  const goalProgress = clamp11(0.8 * l.ready - 0.7 * l.usedAsAThing - 0.5 * l.indignant);

  // ── Arousal, first half. Bewilderment is the appraisal that COULD NOT COMPLETE, which is the
  // definition of an unassimilated event; Silvia's result is that interest and confusion share an
  // appraisal space, and novelty is the axis they share.
  const novelty = clamp01(0.75 * l.atSea + 0.35 * (1 - l.appraised.comprehensibility));

  // ── Arousal, second half. How much of her this took up at all. An indignant turn is not a
  // quiet one, and this is where the build's older intuition was simply wrong: it had every
  // unpleasant exchange lowering her arousal, so being wronged made her sleepy.
  //
  // Indignation appears TWICE on purpose, and the second term is a correction the probe forced.
  // Routed only through the "how much of her this took up" term, a curt demand from someone she
  // knows well came out LESS arousing than an idle 「在吗」, because knowing him makes the
  // message comprehensible, which empties the novelty term, and nothing else was carrying the
  // activation. Indignation is not a quiet state; it is one of the most keyed-up there is, and
  // it has to enter arousal in its own right rather than only as a share of how busy she was.
  const engagement = clamp01(
    l.appraised.relevance * (0.3 + 0.7 * Math.max(l.indignant, l.atSea, l.ready))
    + 0.45 * l.indignant,
  );

  // ── Dominance. What she has in her to act with, minus what the exchange took from her standing
  // in it. Being treated as an instrument is the low-control state itself.
  const control = clamp11(
    0.55 * (2 * l.appraised.herPower - 1)
    - 0.85 * l.usedAsAThing
    - 0.25 * l.atSea
    + 0.3 * l.ready,
  );

  return { goalProgress, novelty, control, fatigue: fatigueOf(phase), engagement };
}
