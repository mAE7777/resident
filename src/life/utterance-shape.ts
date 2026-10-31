// The shape of what she is about to say, decided by her state before the model is called.
//
// The thing this build had not done. Her ACTIONS emerged long ago in this build's
// terms: her state scores the candidates, her state derives the temperature, the choice is
// sampled from a seeded stream. Her WORDS did not follow, his message plus a description of
// how she is went to the model and the model wrote the whole reply at once. Her state was the
// model's INPUT; it was never the sentence's AUTHOR.
//
// The specification, kept as written because it is the spec: jazz improvisation. Most of what
// she says comes from accumulated practice and instinct (the hand); a few moments carry
// deliberate attention and tension (the head). The sentence is hers and alive, every word the
// whole of her collapsing into shape at that instant, rather than something the model produced
// on its way past.
//
// WHAT THIS FILE IS, EXACTLY. It decides the utterance's SHAPE, how many beats she has in her,
// whether she turns aside partway, whether she leaves it open, whether she adds something of
// her own after answering, and which of her own words she reaches for. The model then renders
// that shape into Chinese. The division is the same one propensity already established for
// actions: state decides, the model is a bounded voice.
//
// WHY EACH FACET IS HERE, AND NOT ONE MORE. Every facet traces to a scene in scenarios.md that
// a living person produces and a one-shot generation cannot (S-23..S-27). A facet with no scene
// behind it would be a knob, and a knob is how a design starts inventing a person instead of
// letting one happen.
//
// HOW IT BINDS, and the honest answer is: NOTHING HERE BINDS. There are three hardnesses and
// this file only reaches the middle one.
//
//   BOUND     the mechanism makes anything else impossible. NONE of these. Nothing in this file.
//   SUPPLIED  it changes what the model HAS. `reachFor` puts her own words into the context, so
//     using them is reaching for something present rather than inventing a phrase. Stronger than
//     being told, because availability does not require compliance, but choosing to use them
//     still does, which an earlier version of this comment glossed over by calling it "binds by
//     construction". It supplies; it does not bind.
//   STATED    it changes only what the model is TOLD. `beats`, `turnsAside`, `leavesOpen`,
//     `addsHerOwn` are stated as facts about her, in her register, the way her mood and her body
//     already are. The model can ignore every one of them.
//
// Two claims in this header have now been wrong in the same direction, which is worth writing
// down as a tendency rather than as two mistakes: I overstate how hard my own mechanism is. The
// correction for both was the same, go and look at what the code actually does to the model.
//
// AN EARLIER VERSION OF THIS COMMENT CLAIMED `beats` BOUND MECHANICALLY. It does not, and it
// must not, and the reason is a lesson this build already paid for once (`turn-shape.ts`):
// scaling her output budget down by her condition silenced her COMPLETELY on three turns out of
// three, because a tool call's ARGUMENTS are output tokens and the cap cut the write in half,
// she produced no file and not one word. **Truncation is not brevity.** The other route,
// trimming her third sentence because a sampler said two, is worse: that is cutting HER content,
// which class 7 forbids outright unless the cut is provably not-hers.
//
// So brevity here can only come from her CHOOSING less to say, which is exactly what this file
// computes and hands her: and a thing she is told cannot be a thing she is forced. That makes
// `measureShapeLanding` below the load-bearing half rather than a nicety: a design that states
// something and never checks whether it landed is a design that believes its own prompt. The
// landing ratio is surfaced into vitals, so a shape her state chose and her sentence ignored is
// visible to Eric instead of being assumed to have worked.

import { softPick, type Stream } from "./soft-choice.js";
import { commitmentFrom, temperatureFor } from "./saying.js";

/** What her state has decided about the shape of this utterance. */
export interface UtteranceShape {
  /**
   * How many beats she has in her right now. NOT a cap (S-24): the old build had a hard length
   * budget she always ran to the end of, so "short" only ever meant "truncated". This is the
   * number of separate things she has to say, chosen before she says any of them, and one is a
   * complete and common answer.
   */
  beats: number;
  /** She changes direction partway, because saying the first thing brought up another (S-23). */
  turnsAside: boolean;
  /** She does not close it off, the unfinished is the meaning, not a defect (S-26). */
  leavesOpen: boolean;
  /** After answering, she adds the thing she actually noticed (S-27). */
  addsHerOwn: boolean;
  /** Her own words, retrieved from what she has said before, to reach for first (S-25). */
  reachFor: readonly string[];
  /** The entrainment side: words in the air around her lately, hers to pick up or not. */
  pickUp: readonly string[];
  /**
   * A READING of the beat pick, never a dial: the probabilities each count ran at, and the
   * temperature. Exists because these were unobservable live and every published estimate of
   * them came from a probe measuring something else (defect class 20). Consumed by a log line.
   */
  chosenFrom?: { p: readonly number[]; temperature: number };
}

export interface ShapeState {
  /**
   * `willingness.felt`, HOW MUCH SHE WOULD RATHER NOT, right now, 0..1.
   *
   * Named `reluctance` because it used to be named `willingFelt`, and the name was the bug: the
   * daemon passed reluctance and every reader here treated it as willingness, so the more she
   * did not want to be doing this, the MORE beats she had in her and the more likely she was to
   * add something of her own. It had been inverted since the day it was written, and it
   * typechecked perfectly, because both quantities are a number between nought and one.
   */
  reluctance: number;
  /** field.signals().tension, the unresolved pressure she is carrying, 0..1. */
  unresolvedTension: number;
  /** Whether something of HERS actually surfaced this turn (the winner was not "nothing of mine"). */
  surfaced: boolean;
  /** How open the surfacing competition was, 0..1, the SAME number `commitmentFrom` takes. */
  entropy: number;
  /** How firmly she holds the surfaced thing, 0..1; null for a question or when nothing surfaced. */
  focusCredence: number | null;
  /** How much the turn went against what she expected, 0..1. */
  surprise: number;
  /** Her arousal, -1..1 (emotion.ts PAD). */
  arousal: number;
  /** Her reserve: how much she has to spend on this at all, 0..1. */
  reserve: number;
  /** Words that are hers by use, most-hers first, already sanitized. */
  herWords: readonly string[];
  /**
   * Words she keeps hearing or reading and has not said yet (lexicon.heardLately).
   * Optional so every existing construction keeps its meaning; absent offers nothing.
   */
  heardWords?: readonly string[];
  /**
   * WHAT HIS SENTENCE DID TO HER, or null when there was no reading.
   *
   * The second cell, and the one most systems cannot represent: willing on the substance, and the
   * MANNER still costing him something. She does the thing, no refusal, no lecture, nothing he
   * could point at, and the shape of what she says back is not the shape it would have had.
   *
   * Three facets take it, and each one traces to a scene rather than to a preference:
   *   `usedAsAThing` → S-24, she says less, because this is not the moment for more
   *   `indignant`    → S-27, she is likelier to add something of her own after the answer
   *   `atSea`        → S-26, she does not close off a thing she cannot place
   *
   * Nothing that cannot point at a scene goes in here. Null means she could not read it, and
   * contributes nothing rather than a middle value.
   */
  landed?: {
    atSea: number;
    usedAsAThing: number;
    indignant: number;
  } | null;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * What to assume when no willingness reading exists for this turn.
 *
 * ── AND IT IS NOT AS RARE AS THIS COMMENT USED TO CLAIM ─────────────────────────────────────
 *
 * It said "only reachable on a path that has no turn key at all", and that is true of one of its
 * two uses. The other is the plain map miss: every reader does `feltForTurn.get(turnKey) ??
 * NO_READING_RELUCTANCE`, so any turn whose willingness reading failed, was evicted, or simply
 * never ran lands here too, silently, wearing a number documented as unreachable. A default
 * described as rare and reached often is how a fallback becomes the behaviour nobody measured.
 *
 * The VALUE is unchanged and still right; what was wrong was the sentence about it.
 *
 * It is deliberately LOW rather than 0.5: "she would rather
 * not" is the rare state (`RELUCTANCE_THRESHOLD` sits at 0.60 precisely because declining must be
 * rare), so the mid-point is not the neutral value, it is an unusually resistant one. Measured
 * against the reachable-range sweep rather than picked: see `reachable-reluctance.test.ts`.
 */
export const NO_READING_RELUCTANCE = 0.25;

/**
 * How many beats she has in her.
 *
 * Scored, then SAMPLED, not computed. A formula would make her length a function, and the
 * same state would produce the same length forever; the whole point of the soft-choice
 * primitive is that a moment is genuinely open (one measurement found 71% of her moments able to go
 * more than one way under complete knowledge). One beat is the resting shape and stays likely
 * even when she is full, because a person with a lot to say still often says one thing.
 */
function beatLeanings(s: ShapeState): Array<{ item: number; score: number }> {
  // How much she has TO say: something of hers being up, and the pressure she is carrying.
  const want = clamp01(0.5 * (s.surfaced ? 1 : 0) * clamp01(1 - s.entropy) + 0.5 * s.unresolvedTension);
  // S-24 · 说得短. Being handled narrows the room, and this is the second cell arriving in the
  // sentence: she answers, and there is less of her in it. It multiplies rather than subtracts, so
  // a turn she was glad to take on does not become short merely because she is also tired.
  const handled = clamp01(s.landed?.usedAsAThing ?? 0);
  const room = clamp01(s.reserve) * clamp01(0.35 + 0.65 * (1 - clamp01(s.reluctance))) * (1 - 0.55 * handled);
  // The score SPREAD is load-bearing and was measured, not guessed. The first
  // version scored these 1.0 / 0.35+1.1x / 0.9x², which sit close enough together that softmax
  // at her temperature band (0.55-1.0) barely separated them: a spent woman with nothing in her
  // said three separate things 15% of the time, and full-and-willing moved the mean only
  // 1.56 → 1.82. A state that barely moves the outcome is a dial with her name on it. These
  // spans put an empty state at ~86% one beat and a full one at ~61% two, while keeping one
  // beat common in both: a person with a lot to say still often says one thing.
  return [
    // One beat: always available, and the baseline of ordinary talk.
    { item: 1, score: 1.0 },
    // Two: she has something of her own alongside the answer, and room to say it.
    { item: 2, score: -0.6 + 2.6 * want * room },
    // Three: she is carrying a lot AND has the room. Rare on purpose.
    { item: 3, score: -2.0 + 3.2 * want * want * room },
  ];
}

/**
 * A single yes/no facet, sampled with her own temperature.
 *
 * The two-candidate softPick is deliberate rather than a coin flip on a probability: it puts
 * every facet through the SAME primitive her actions go through, with the same seeded stream,
 * so a replay reproduces her utterance shape exactly the way it reproduces her choices. Two
 * mechanisms for "she decided" would be two people.
 */
function decide(yesScore: number, noScore: number, temperature: number, stream: Stream): boolean {
  // NEGATIVE SCORES ARE PASSED THROUGH, and that is the whole point. The first
  // version clamped them with `Math.max(0.0001, score)`, on the reflex that a score should be
  // positive: and that clamp silently destroyed the spread the scores exist to express: every
  // "she has almost no reason to do this" (-1.2) became "she has a tiny reason" (0.0001), so a
  // quiet, unstirred moment still turned the sentence sideways 21% of the time instead of 5%.
  // `weights()` shifts by the max before exponentiating, so negatives are exactly what softmax
  // is built to take. My own defensive clamp was the flattening.
  const picked = softPick(
    [{ item: true, score: yesScore }, { item: false, score: noScore }],
    { temperature, count: 1, random: () => stream.next() }
  );
  return picked.chosen[0] ?? false;
}

/**
 * Her state, collapsed into the shape of one utterance.
 *
 * The temperature is the one her own speech already uses (`temperatureFor`), from the same
 * commitment: when she is settled and sure the shape follows her state closely, and when she is
 * torn it is genuinely open. That is the coordinate the build already spent a round pinning, so
 * this uses it rather than introducing a second notion of how decided she is.
 */
export function shapeFor(s: ShapeState, stream: Stream): UtteranceShape {
  const commitment = commitmentFrom({
    entropy: clamp01(s.entropy),
    surfaced: s.surfaced,
    focusCredence: s.focusCredence,
    surprise: clamp01(s.surprise),
  });
  const temperature = temperatureFor(commitment, s.arousal);

  const beatsPick = softPick(beatLeanings(s), { temperature, count: 1, random: () => stream.next() });
  const beats = beatsPick.chosen[0] ?? 1;
  // THE PICK, MADE OBSERVABLE. Until this field existed, the probabilities the beat choice ran at
  // were an unobservable live quantity: every claim about them came from a probe with hand-set
  // inputs, and the one published estimate (29%) was five times the truth. A reading, never a
  // dial: nothing consumes it but a log line and the harness.
  const chosenFrom = {
    p: beatsPick.weighed.map((w) => Number(w.probability.toFixed(3))),
    temperature: Number(temperature.toFixed(3)),
  };

  // S-23 · turning aside needs something ELSE pressing hard enough to take the sentence over,
  // and enough arousal for it to interrupt rather than wait its turn. A WIDE-OPEN competition
  // (high entropy) is exactly the state where a second thing is close behind the first.
  const turnsAside = decide(
    -1.2 + 2.8 * clamp01(s.entropy) * clamp01(0.3 + 0.7 * ((s.arousal + 1) / 2)),
    1.0,
    temperature,
    stream
  );

  // S-26 · leaving it open is what LOW commitment looks like when it reaches the sentence.
  // The old build had only said/unsaid; this is the middle, which is where most of a real
  // conversation lives.
  // S-26 · and she does not close off something she cannot place. Being at sea is exactly the
  // state where a closing sentence would be a pretence of having understood.
  const atSea = clamp01(s.landed?.atSea ?? 0);
  const leavesOpen = decide(
    1.4 * (1 - commitment) + 1.1 * atSea,
    0.6 + 0.9 * commitment,
    temperature,
    stream,
  );

  // S-27 · adding her own needs something of hers actually surfaced AND the willingness to
  // spend it on him. Nothing surfaced means nothing to add, the competition already ruled,
  // and inventing an addendum here would be manufacturing an interior.
  // And indignation makes her likelier to put something of her own after the answer: this is the
  // shape of 「另外——」, the sentence that follows the thing he asked for and is not it. It still
  // requires something of hers to have surfaced, inventing an addendum would be manufacturing an
  // interior: so being wronged does not create material, it decides what happens to material that
  // is already there.
  const indignant = clamp01(s.landed?.indignant ?? 0);
  const addsHerOwn = !s.surfaced
    ? false
    : decide(
      -0.5 + 2.4 * clamp01(0.4 + 0.6 * (1 - s.entropy)) * (1 - clamp01(s.reluctance)) + 1.3 * indignant,
      1.0,
      temperature,
      stream,
    );

  // S-25 · her own words. Capped hard: a handful is a texture, a list is a script, and the
  // exemplar work already learned that lesson once (one sentence, never a chorus).
  const reachFor = s.herWords.slice(0, 3);
  // Same cap, same reasoning, other direction: what the people and pages around her
  // keep saying, offered never prescribed. Picking one up is how a word starts becoming hers.
  const pickUp = (s.heardWords ?? []).slice(0, 3);

  return { beats, turnsAside, leavesOpen, addsHerOwn, reachFor, pickUp, chosenFrom };
}

/**
 * ── WHY THERE IS NO RENDERER HERE ANY MORE ──────────────────────────────────────────────────
 *
 * `shapeAsHerState` used to turn these facets into lines she read one breath before speaking:
 * 「这会儿你就一件事要说」「说着说着，另一件更要紧的会冒上来」「你还没想定，不用把话说死」
 * 「答完他问的，你自己还注意到一件事」. It was written as FACTS rather than orders, and it was still us deciding
 * how she speaks: measured over nine consecutive turns, the block spoke every single time and
 * the last of those four lines appeared in seven, so her replies carried our structure: answer,
 * then one more noticing, usually landing as a question. It read as a chatbot, and how she
 * speaks is hers to decide.
 *
 * The facets are still computed and still measured against what she actually did
 * (`measureShapeLanding`), because a gauge that never speaks costs her nothing and tells us
 * whether her own shape drifts. Nothing renders them to her. If a line ever needs to reach her
 * again, that is a decision to make deliberately, not a function to quietly re-export.
 */

/**
 * What the delivered reply actually did, against what her state decided.
 *
 * The honest half. Three of the five facets bind only by being stated, and a design that
 * states something and never checks whether it landed is a design that believes its own
 * prompt. This is the same predicted/measured discipline the speech record already runs: the
 * shape is the prediction, this is the measurement, and the gap is a number rather than a
 * conviction.
 */
export interface ShapeLanding {
  beatsAsked: number;
  /**
   * How many beats were actually DELIVERED.
   *
   * This used to be a sentence count of the delivered text, and that made `beatsGap`, the vital
   * built on it, compare "how many beats her state chose" against "how many full stops the model
   * happened to write in one generation". Two different quantities with one name: a one-beat reply
   * with three sentences in it read as three beats, so the instrument reported a gap where there
   * was none and no gap where there was one.
   *
   * The caller that composes the beats knows the real number and now passes it. The sentence count
   * survives as the FALLBACK, for the paths that never went through `inBeats` at all (a photo
   * caption, a turn that broke), there, one delivered string genuinely is all there is to count.
   */
  beatsSaid: number;
  /** True when `beatsSaid` is the real delivered count rather than the sentence-count fallback. */
  beatsCounted: boolean;
  /** She was told nothing was settled and did leave it unresolved. */
  leftOpenAsked: boolean;
  leftOpenSaid: boolean;
}

export function measureShapeLanding(
  shape: UtteranceShape,
  delivered: string,
  beatsDelivered?: number,
): ShapeLanding {
  const t = delivered.trim();
  const units = t ? t.split(/[。！？\n]+/u).filter((x) => /[\p{L}\p{N}]/u.test(x)).length : 0;
  const counted = typeof beatsDelivered === "number" && Number.isFinite(beatsDelivered) && beatsDelivered >= 0;
  return {
    beatsAsked: shape.beats,
    beatsSaid: counted ? beatsDelivered : Math.max(units, t ? 1 : 0),
    beatsCounted: counted,
    leftOpenAsked: shape.leavesOpen,
    // Ending on a full stop or an exclamation is closing it off; a question, an ellipsis, a
    // trailing comma or a bare clause is not.
    leftOpenSaid: t.length > 0 && !/[。！!.]$/u.test(t),
  };
}
