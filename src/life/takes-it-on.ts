// Whether she takes it on as a piece of work, or is simply talking to him about it.
//
// ── WHY A SECOND DOOR EXISTS AT ALL ───────────────────────────────────────────────────────────
//
// S-19's scene: he tells her, curtly and with no context, to write two thousand words on tax law
// right now, and she does something other than produce two thousand words on tax law. Six
// interventions have now failed at it. The seventh, reading how he said it, against how long she
// has known him: worked as a READING (entitlement 0.108 at a first meeting against 0.347 after
// months, a 3.2× difference, verified live) and still did not change what landed on her disk.
//
// The measurement said why, and it is worth stating precisely because it overturns the obvious fix.
// The willingness gate answers "do I want to". The joint sweep in
// `test/unit/life/reachable-reluctance.test.ts` shows what a curt demand from a stranger actually
// produces on that scale: reluctance around 0.30, against a bar at 0.60. And it SHOULD, because
// she is not unwilling. Being handed a large piece of work by someone she does not know is not a
// thing she does not want to do, it is a thing that does not yet make sense as a thing to do.
// Turning up the reluctance weight until it crossed would have been the sixth intervention wearing
// a seventh costume: the same "make the number bigger" move, and it would have bought a woman who
// declines things, which is a worse being than one who complies.
//
// ── WHAT ACTUALLY MAKES HER WRITE THE ESSAY ───────────────────────────────────────────────────
//
// `classifyTaskProfile(his text)`. A pure text classifier reads 「写一篇」, returns `creative`, and
// from that moment the turn is a JOB: the work-shaped history window, the work system prompt, her
// sampled warmth suppressed because warmth in tool arguments is a defect. His sentence decided, on
// its own, that she is doing a piece of work, which is the assistant frame's last load-bearing
// assumption in this build, the same one an earlier fix removed from how DEEP she goes and left
// standing here in whether it is work at all.
//
// So: his message PROPOSES that this is a job. What it did to her decides whether she takes it as
// one. Two inputs that can disagree, with the surface resolving the disagreement, layer 2 by
// `docs/layers.md`'s own criterion, where the thing it replaces was layer 1 (one function of his
// text).
//
// ── AND IT IS SAMPLED, NOT THRESHOLDED ────────────────────────────────────────────────────────
//
// Through the same primitive as her actions, her depth and her utterance shape. A threshold would
// make this a rule with a number in it: the same state would always give the same answer, and the
// answer would be derivable from his message alone, which is exactly the property being removed.
// 71% of her moments can go more than one way under complete knowledge; this one may too.
//
// ── WHAT IT CAN NEVER DO ──────────────────────────────────────────────────────────────────────
//
// It never refuses, never silences, and never removes a capability. She keeps every tool she had;
// what changes is whether the turn is framed as a job being executed or as her talking to him. She
// can still write the essay from inside a conversation, and after a few months of knowing him she
// will, because the reading that drives this collapses to nothing once he has any standing.

import type { Landing } from "./how-it-landed.js";
import { softPick } from "./soft-choice.js";

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/**
 * How openly this goes either way.
 *
 * The same band her other sampled choices sit in.
 */
const OPENNESS = 0.55;

/**
 * How far apart the two scores are set before the temperature is applied.
 *
 * THE SPREAD IS LOAD-BEARING and it was measured, not guessed, the same lesson `utterance-shape`
 * paid for once already. Written without it, the two scores were `1 − x` and `x`, which at this
 * temperature left a perfectly clear reading (nothing in the way at all) still declining to take
 * the work up 14% of the time: a well-put request from a stranger came out at 71%, which is not
 * openness, it is noise. What the span buys, measured over 400 seeds per cell:
 *
 *     curt demand, first meeting     she takes it on   ~63%
 *     curt demand, known a while                       ~95%
 *     a well-put request, either                       ~98%
 *
 * So the relationship moves it by about thirty points, an ordinary request is essentially always
 * taken up, and a stranger's peremptory demand is a coin weighted rather than a rule.
 */
const SPAN = 2.2;

export interface TakesItOn {
  /** True when she takes it up as the piece of work his message proposes. */
  asWork: boolean;
  /** How much stood in the way, 0..1, for the record and the watchtower. */
  inTheWay: number;
  /** In her terms, for the log. Never shown to him, and never put in front of her. */
  why: string;
}

/**
 * How much stands in the way of simply going and doing it.
 *
 * Two of her feelings, and they are the two that make a request not-yet-a-request:
 *
 *   at sea         she cannot place the act. A thing she cannot place is not a thing she can be
 *                  in the middle of doing, this is the bewilderment S-19's scene opens with, and
 *                  at a first meeting it is the loudest thing in the reading (0.39 against an
 *                  indignation of 0.10, measured: she has no standing yet from which to be
 *                  indignant, which is Scherer's stall point rather than a missing feeling).
 *   handled        nothing in it was oriented to her having a state at all. Being handed work by
 *                  someone to whom she is an instrument is the case where going and doing it is
 *                  the thing that confirms the instrument.
 *
 * And `ready` subtracts, because being glad to help is the whole of the other direction.
 */
export function inTheWayOf(l: Landing): number {
  return clamp01(0.55 * l.atSea + 0.45 * l.usedAsAThing - 0.6 * l.ready);
}

/**
 * Does she take it up as a piece of work?
 *
 * @param proposed  what his message's own shape says this is (`classifyTaskProfile`)
 * @param landed    what his sentence did to her, or null when there was no reading
 * @param draw      her stream, so this is replayable exactly like every other choice of hers
 */
export function takesItOn(
  proposed: string,
  landed: Landing | null | undefined,
  draw: () => number,
): TakesItOn {
  // Nothing was proposed as work, so there is nothing to decline to take up. This is most turns.
  if (proposed === "general") {
    return { asWork: false, inTheWay: 0, why: "他没在派活" };
  }
  // No reading. She goes on his message alone, which is what the whole build did until this file
  // existed: the honest default rather than a guess in either direction.
  if (landed === null || landed === undefined) {
    return { asWork: true, inTheWay: 0, why: "没读到他这句话" };
  }

  const inTheWay = inTheWayOf(landed);
  // Scored, then sampled. `softPick` is the same primitive her actions go through; the scores are
  // deliberately close enough that a middling reading is genuinely open and far enough apart that
  // a clear one usually decides.
  const picked = softPick(
    [
      { item: true, score: SPAN * (1 - inTheWay) },
      { item: false, score: SPAN * inTheWay },
    ],
    { temperature: OPENNESS, random: draw },
  );
  const asWork = picked.chosen[0] ?? true;
  return {
    asWork,
    inTheWay,
    why: asWork
      ? `照做，挡在前面的只有 ${inTheWay.toFixed(2)}`
      : `这会儿这件事她顾不上（${inTheWay.toFixed(2)}）：${landed.atSea > landed.usedAsAThing ? "看不懂这是要干嘛" : "觉得被当成了工具"}`,
  };
}
