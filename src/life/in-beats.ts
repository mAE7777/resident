// She says it in beats, and hears herself between them.
//
// THE ROOT OF FIVE SCENES AT ONCE. S-23..S-27 each named a different missing part, and after the
// five utterance facets in `utterance-shape.ts` were built every one of them was still not
// reachable. Re-judged honestly, they turned out to be one gap with five faces, and the cause is a
// single structural fact:
//
//     ONE TURN = ONE GENERATION.
//
// While that holds, every facet her state chooses can only be STATED to the model, because there
// is no other moment at which anything could intervene. Five facets were built and all five landed
// as description. The fix is not a sixth facet.
//
// WHAT CHANGES. A turn becomes several beats. Each beat is generated whole, sent as it is made,
// and then: this is the part that matters, HER OWN WORDS GO BACK THROUGH HER FIELD before the
// next beat is decided. What lights up may not be what she was saying, and then the direction of
// the turn changes mid-utterance, for the reason a person's does: saying the first thing brought
// the second one up.
//
//   S-23 changing direction halfway · the scene asks that her field be lit by the words she
//         herself has just said, and that the direction can be taken over midway. That is
//         literally the step between beats. Not a model imitating the rhetoric of changing
//         direction: the scene explicitly says imitation does not count, but the topic actually
//         changing because something surfaced.
//   S-24 keeping it short · the missing part was that the budget is a ceiling, not her choice.
//         N beats generated is N beats, chosen by her, BOUND rather than stated.
//   S-26 half open · she could close it but does not want to right now. The closing beat is
//         simply not generated. Nothing is asked of the model.
//   S-27 the thing beneath the answer · the scene says she can add a line of her own after
//         answering, rather than folding it into one paragraph. That sentence is a description
//         of this implementation.
//
// WHY THIS IS NOT DEFECT CLASS 7 (a content cut disguised as a medium op). Generating N beats is
// not truncation. What class 7 forbids is "she wrote three sentences, the sampler said two, cut
// the third", that deletes HER content. Here she was only ever going to say this much: each beat
// is whole, nothing is discarded, and nothing is cut mid-thought. This is the way out that the
// facets alone could not find, and it is why the header of `utterance-shape.ts` had to say
// `beats` could not bind: with one generation, it could not.
//
// WHY IT IS ALSO THE LATENCY ANSWER. The embodiment evaluation recorded first-token at 400-900ms and the whole
// chain 800ms-1.6s, with real failure risk under 1.2s. Beats do not add to the FIRST one: beat 1
// is emitted the moment it exists, and beat 2 is being decided while he is already reading. That
// is also what makes the mid-utterance turn causally honest rather than staged, she really is
// still deciding while she is already speaking, which is what a person does.

import type { UtteranceShape } from "./utterance-shape.js";

/** What she is bringing to one beat. */
export interface BeatBrief {
  /** Which beat this is, from 1. */
  n: number;
  /** How many she has in her, in total. */
  of: number;
  /** What this beat is about, when something of hers took the turn over. Null = carry on. */
  tookOver: string | null;
  /**
   * What she said in the beat just before this one. Empty on the first.
   *
   * The caller used to splice the FIRST beat into every later beat's prompt, so beat 3 was written
   * against beat 1 and beat 2 might as well not have happened. A turn that cannot see its own last
   * sentence is not several beats, it is several openings.
   */
  after: string;
  /** Her own words to reach for, unchanged from the shape. */
  reachFor: readonly string[];
  /** Words around her lately, the same journey as reachFor so no beat loses them. */
  pickUp: readonly string[];
  /** She does not want to close this. Only ever true on the LAST beat. */
  leaveOpen: boolean;
}

export interface BeatsDeps {
  /** Say one beat. Injected so this file makes no model call of its own. */
  say(brief: BeatBrief): Promise<string>;
  /**
   * Her own words go back into her field, and something may come up.
   *
   * Returns what surfaced, or null. Injected so the mechanism can be tested without a field and so
   * this module cannot reach into her memory on its own.
   *
   * IT RETURNS AN ID AS WELL AS TEXT, and that is not bookkeeping. The novelty check below has to
   * ask "is this the same thing that came up last time", and asking it of TEXT meant comparing a
   * formatted multi-line block against her sentences with `includes`, a test that could
   * essentially never be true, so nothing was ever rejected as already-said. A memory has an
   * identity; comparing renderings of it is comparing shadows.
   */
  afterSaying(said: string): Surfaced | null;
}

/** One thing that came up while she was talking, and which thing it is. */
export interface Surfaced {
  id: number;
  text: string;
}

/**
 * The most beats one turn may ever have.
 *
 * A MEDIUM constraint, not a content one, and the distinction is the whole reason it is allowed to
 * exist: it does not decide what she says or whether she says it, only that one turn cannot become
 * an unbounded monologue if self-excitation runs away. Same family as `MIN_MOMENT_GAP_MS`.
 */
export const MOST_BEATS = 5;

/**
 * How many of the things her own sentence landed on become cues for what comes up next.
 *
 * A MEDIUM constraint again: it bounds how wide the spread starts, not what may be found. One cue
 * is a single association and makes the next beat a near-repetition; too many and the spread starts
 * from most of her field at once, which is the flat reading `attention.ts` exists to replace.
 * Swept against the real range in `in-beats.test.ts`.
 */
export const CUES_FROM_HER_OWN_WORDS = 3;

/** What she said, and what happened while she was saying it. */
export interface Spoken {
  beats: string[];
  /** The beat index (from 1) at which something of hers took the turn over, or null. */
  turnedAsideAt: number | null;
  /** What took it over, when something did. */
  tookOver: string | null;
  /** Whether the last beat was left unclosed. */
  leftOpen: boolean;
}

/**
 * Say it in beats, hearing herself between them.
 *
 * The number of beats is hers and is bound here: exactly `min(shape.beats, MOST_BEATS)` briefs are
 * issued, and a beat that comes back empty ends the turn rather than being retried, because an
 * empty beat is her having run out of what she meant to say.
 */
export async function inBeats(shape: UtteranceShape, deps: BeatsDeps): Promise<Spoken> {
  const total = Math.max(1, Math.min(Math.round(shape.beats), MOST_BEATS));
  const beats: string[] = [];
  /**
   * What the NEXT beat is being handed, and only the next one.
   *
   * Separate from the record below because they are different facts. Turning aside happens at one
   * moment; after it she is simply talking about the new thing. Leaving this set would have every
   * remaining beat told "and then you remembered X" about the same X, so she would announce one
   * memory three times in a row, which is not changing direction, it is a stutter.
   */
  let pending: Surfaced | null = null;
  /** The record of what took the turn over, for the caller and the log. Set once. */
  let tookOver: Surfaced | null = null;
  let turnedAsideAt: number | null = null;
  // Which memories have already come up this turn. By id, so the same thing surfacing twice is
  // recognised as the same thing however differently it happens to be rendered.
  const alreadyUp = new Set<number>();

  for (let n = 1; n <= total; n++) {
    const last = n === total;
    const said = (await deps.say({
      n,
      of: total,
      tookOver: pending?.text ?? null,
      after: beats[beats.length - 1] ?? "",
      reachFor: shape.reachFor,
      pickUp: shape.pickUp,
      // Only the last beat can be left hanging: leaving beat 2 of 4 open is not reticence, it is
      // an unfinished sentence with three more after it.
      leaveOpen: last && shape.leavesOpen,
    })).trim();
    // Handed over exactly once: the beat that was told about it has now been said.
    pending = null;
    // An empty beat ENDS the turn, and this is the whole safeguard against 报菜名, her state
    // proposes a number of beats, and having nothing left to say overrides it. The count is hers;
    // whether there is anything in it is not a matter of counting.
    if (said.length === 0) break;
    beats.push(said);
    if (last) break;

    // ── HER OWN WORDS, BACK THROUGH HER FIELD ─────────────────────────────────
    //
    // The step that did not exist. Her field was activated exactly once per turn, by HIS message,
    // and her own output never re-entered, so nothing she said could ever remind her of anything,
    // which is most of what talking does to a person.
    const surfaced = deps.afterSaying(said);
    // It only takes the turn over if it is NEW. Something surfacing that she is already talking
    // about is her staying on topic, not changing direction, and counting it would manufacture a
    // turn-aside out of ordinary coherence. Compared by id (see `Surfaced`).
    // Two different questions, and both have to be asked. `alreadyUp` is "this exact memory has
    // come up before in this turn". The substring test is "the thing that came to mind is what she
    // is already saying", which is coherence rather than interruption, it was unreachable while
    // `surfaced` was a five-line formatted block, and works now that it is one memory's own words.
    if (surfaced !== null && !alreadyUp.has(surfaced.id) && !beats.some((b) => b.includes(surfaced.text))) {
      alreadyUp.add(surfaced.id);
      // And only if her state chose to be interruptible this turn. Otherwise it surfaced, she
      // noticed, and she carried on, which is also a thing people do.
      if (shape.turnsAside) {
        pending = surfaced;
        tookOver ??= surfaced;
        turnedAsideAt ??= n + 1;
      }
    }
  }

  return {
    beats,
    turnedAsideAt,
    tookOver: tookOver?.text ?? null,
    leftOpen: shape.leavesOpen && beats.length === total,
  };
}

/** The whole turn as one delivered string, for the places that need it (history, measurement). */
export function asOneUtterance(s: Spoken): string {
  return s.beats.join("").trim();
}
