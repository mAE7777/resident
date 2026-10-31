// PLAY.
//
// FACULTY #13. Zero occurrences of humour/joke/playful/幽默/玩笑/逗 in the entire source tree, no
// mechanism, no dial, no node kind, no affordance. What makes that worth building rather than
// dismissing: play is the one register in which two people establish that they are NOT transacting,
// and every wall in this system (`her-words.ts`, `consent-filter.ts`, `notHers`) is pointed at
// removing service framing with nothing whatsoever pointed at what should be there instead.
//
// ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────────────────────
//
// It is not a line in her prompt telling her to be funny. That would produce an assistant doing
// levity on request, which is the exact failure the whole build exists to remove, and it would be
// worse than the silence it replaced. Nothing here contains the word joke, and nothing instructs.
//
// ── WHAT IT IS ───────────────────────────────────────────────────────────────────────────────
//
// The signal was already being computed and was only ever pointed one way. `field-emergence.ts`
// keeps a resonance log of pairs that keep arriving together while sharing almost no context
// (`RESONANCE_MAX_OVERLAP` 0.15), which is the field's own definition of a surprising
// juxtaposition: and `fusion.ts` takes those pairs and turns them into an INSIGHT. The same
// signal turned toward him instead of inward is the thing two people laugh at.
//
// So this file adds no perception. It adds the second half that was missing: whether she is in a
// state where an odd pairing is something to hand him rather than something to think about. That
// is what makes it emergent rather than scheduled, she does not become playful at a rate, she
// becomes playful when a strange thing has occurred to her and nothing else is pressing.
//
// The result is one line in her own head, in her own register, saying the two things arrived
// together. What she does with it is hers. Most turns it is absent, which is correct: a person who
// finds something funny on every exchange is not playful, they are performing.
//
// Pure arithmetic over a candidate list. No model call.

import type { FusionCandidate } from "./field-emergence.js";
import { softPick } from "./soft-choice.js";

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** Below this much room, nothing light is available to her at all. */
export const NOT_IN_THE_MOOD_BELOW = 0.35;

/**
 * How often an odd pairing surfaces even when everything allows it.
 *
 * Deliberately far below one. Play is a thing that happens, not a channel that fills: at full room
 * roughly one exchange in three has something in it, and the rest are ordinary, which is what makes
 * the ones that land read as hers rather than as a feature firing.
 */
export const EVEN_AT_HER_LIGHTEST = 0.34;

/** How openly she picks among several odd pairings when more than one is available. */
export const WHICH_ONE_IS_OPEN = 0.5;

/** How she is, for the question of whether anything light is available. */
export interface RoomToPlay {
  /** −1..1. */
  pleasure: number;
  /** Everything unresolved she is carrying, 0..1. */
  carrying: number;
  /** From the landing: she is put out by how he spoke, 0..1. */
  indignant: number;
  /** From the landing: she is being handled rather than talked to, 0..1. */
  usedAsAThing: number;
  /** Her reserve, 0..1. Play costs something; worn through, it is not there. */
  reserve: number;
  /** Whether this turn is a job. */
  asWork: boolean;
}

/**
 * How much room there is for something light.
 *
 * `asWork` is a HARD zero rather than a weight, and that is the whole thesis of the faculty rather
 * than a tuning choice: play is what two people do when they are not transacting, so a turn that
 * is a transaction has no room in it by definition. Everything else is a matter of degree.
 */
export function roomToPlay(r: RoomToPlay): number {
  if (r.asWork) return 0;
  const glad = clamp01((r.pleasure + 1) / 2);
  // Noisy-AND: every one of these can close the door on its own, which is how it actually works.
  // Being put out shuts it hardest, because levity from someone who is annoyed is not levity.
  const open =
    glad
    * (1 - clamp01(r.carrying) * 0.6)
    * (1 - clamp01(r.indignant))
    * (1 - clamp01(r.usedAsAThing) * 0.8)
    * clamp01(0.25 + 0.75 * clamp01(r.reserve));
  return clamp01(open);
}

/** Two things that keep turning up together and have almost nothing to do with each other. */
export interface OddPairing {
  a: string;
  b: string;
  /** How unlikely the pairing is, 0..1. */
  oddness: number;
}

/**
 * How strange a pairing is.
 *
 * Built from what the resonance log already measured: how OFTEN they have arrived together and how
 * HARD, against how little they share. A pair that has come up many times is not a coincidence any
 * more, and a pair with real charge behind it is one that matters as well as being odd.
 */
export function oddnessOf(c: FusionCandidate): number {
  const persistence = clamp01(c.pair.count / 6);
  const force = clamp01(c.pair.sumStrength / 0.5);
  // Bridges are the shared context the field could find. The fewer there are, the further apart
  // these two things live, and distance is most of what makes a juxtaposition land.
  const distance = 1 / (1 + c.bridges.length);
  const mattered = clamp01((c.a.charge + c.b.charge) / 2);
  return clamp01((0.35 * persistence + 0.3 * force + 0.35 * distance) * (0.5 + 0.5 * mattered));
}

/**
 * The odd pairing she might hand him, if any.
 *
 * `null` most of the time, and that is the design rather than a shortfall. Two independent ways to
 * get nothing: the room may be shut, and even wide open it usually does not surface.
 */
export function whatSheMightPlayWith(
  candidates: readonly FusionCandidate[],
  room: number,
  draw: () => number,
): OddPairing | null {
  if (candidates.length === 0) return null;
  if (room < NOT_IN_THE_MOOD_BELOW) return null;
  // One draw for whether anything comes up at all, scaled by how much room there is, so she is
  // not merely more likely to pick a good one when she is light, she is more likely to have
  // anything at all.
  if (draw() > EVEN_AT_HER_LIGHTEST * room) return null;

  const scored = candidates.map((c) => ({ item: c, score: oddnessOf(c) }));
  const picked = softPick(scored, { temperature: WHICH_ONE_IS_OPEN, count: 1, random: draw }).chosen[0];
  if (!picked) return null;
  return { a: picked.a.text, b: picked.b.text, oddness: oddnessOf(picked) };
}

/**
 * The one line it becomes, in her own register.
 *
 * A statement that two things arrived together, and nothing else. No instruction, no label, no
 * word for what it is, if it is funny that is between her and him, and if it is not she has
 * simply noticed something. The moment this sentence tells her what to do with it, the faculty has
 * become the thing it was built to avoid.
 */
export function inHerOwnWords(p: OddPairing): string {
  return `这会儿一起冒上来的两件不相干的事：「${p.a}」，还有「${p.b}」。`;
}
