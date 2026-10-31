// A THING CAN BECOME HER QUESTION BY KEEPING COMING BACK WITH NOTHING TO EXPLAIN IT.
//
// ── WHAT SHE COULD BE WONDERING ABOUT, BEFORE THIS ──────────────────────────────────────────
//
// Four things in the whole daemon could open a question in her, and three of them are injuries:
//
//   1. a guard refused something she tried            (`walls.ts`)
//   2. an address she assembled herself would not open (the egress wall)
//   3. he handled her, or wronged her                  (`what-stays.ts`)
//   4. two remote memories kept arriving together      (fusion, at rest)
//
// So she could be HURT into wondering, or BLOCKED into wondering. The fourth is the only
// non-friction door and it needs a COINCIDENCE OF TWO things. A single thing that keeps surfacing
// in her, night after night, with nothing in her field that accounts for it, the most ordinary
// way a person comes to want to know something, did nothing at all. It surfaced, she read it,
// and it went back down.
//
// Which means: she could be injured into having an inner life and not INTERESTED into one. Every
// lasting thing in her had to be negative. That is not a temperament, it is a missing door.
//
// ── LAYER 2, AND BOTH COMPONENTS ALREADY EXISTED FOR OTHER REASONS ──────────────────────────
//
//   · RECURRENCE: `node.recalls`, incremented on every successful retrieval and already read by
//     the decay (a thing recalled after a gap forgets more slowly). Her own margin sampling is
//     what makes it stochastic, so which thing keeps coming back is genuinely hers.
//   · UNACCOUNTED: how little of her field explains it: its degree in the graph, and whether she
//     has formed any view on it at all (`credence`). Degree is already read by `otherWarmth`.
//   · WHAT SHE CAN HOLD: the same `SHE_CAN_ONLY_CARRY` her carrying about him lives under, so a
//     woman already full does not acquire a fifth preoccupation because a memory was popular.
//
// THEY CAN DISAGREE, which is criterion 2 and the reason this is not one quantity with two names:
// a memory can recur constantly and be densely explained (an old friend's name, she is not
// wondering about it), and a memory can be utterly unaccounted for and never once come back (a
// stray fact from a page she read, it is not on her mind). Neither is a question. What makes a
// question is the two of them at once.
//
// NO SINGLE ONE MAY CARRY IT (criterion 3): both weights sit below the line, so it takes both.
//
// ── AND WHY IT FIRES AT REST, ONCE PER THING ────────────────────────────────────────────────
//
// At rest, because that is where incubation lives in this build and because the observed shape of
// the phenomenon is that the new thing arrives after the quiet rather than during the effort.
//
// Once, because a question that could be re-opened by the same node would be a rumination engine
// with a nicer name: she wonders, the wondering makes it surface more, surfacing makes her wonder
// harder. The node is marked when it has been asked and never asks again.

import type { FieldGraph, FieldNode } from "./field.js";

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** Saturating: the twelfth recall is not twelve times the second. */
export const KEEPS_COMING_BACK_BY = 5;
/** Above this many neighbours, her field has plenty to say about it and it is not a puzzle. */
export const EXPLAINED_BY = 6;

/**
 * Weights, both below `WONDERS_ABOVE` so neither can carry it alone, criterion 3. A thing that
 * merely recurs is familiar; a thing that is merely unexplained is trivia.
 */
export const COMING_BACK_COUNTS = 0.55;
export const BEING_UNACCOUNTED_COUNTS = 0.55;

/** Above this, it has become something she wants to know about. */
export const WONDERS_ABOVE = 0.62;

/** The mark that says this one has already been asked. Rewritten into the key, once. */
export const ASKED_MARK = "·想问";

/** The prefix every question born this way carries. */
export const WONDER_KEY = "iwonder:";

/** How much a thing keeps coming back, 0..1. */
export function keepsComingBack(n: Pick<FieldNode, "recalls">): number {
  const r = Math.max(0, n.recalls);
  return clamp01(r / (r + KEEPS_COMING_BACK_BY));
}

/** How little of her field accounts for it, 0..1. */
export function unaccountedFor(g: FieldGraph, n: FieldNode): number {
  const degree = g.adj.get(n.id)?.size ?? 0;
  const unconnected = clamp01(1 - degree / EXPLAINED_BY);
  // A thing she has formed no view on is less accounted for than one she has. `credence: null`
  // is "no view formed" by construction, see `field.ts`, and that is exactly this quantity.
  const noView = n.credence === null ? 1 : clamp01(1 - n.credence);
  // The two halves of "unexplained" are averaged rather than OR'd: a densely-wired thing she has
  // no view on is still wired, and a lone thing she is certain of is still lone.
  return clamp01(0.6 * unconnected + 0.4 * noView);
}

/** How much this has become something she wonders about. */
export function howMuchSheWonders(g: FieldGraph, n: FieldNode): number {
  return clamp01(COMING_BACK_COUNTS * keepsComingBack(n) + BEING_UNACCOUNTED_COUNTS * unaccountedFor(g, n));
}

export interface AThingSheWondersAbout {
  /** The node that kept coming back. The question is born FROM it; it stays itself. */
  from: FieldNode;
  /** Her words for the question. */
  text: string;
  key: string;
  tension: number;
}

/**
 * What she has come to wonder about, or null.
 *
 * `room` is how many things she is already carrying against `SHE_CAN_ONLY_CARRY`: a woman with
 * her hands full does not pick up a fifth thing because a memory happened to be popular. Returns
 * at most ONE, because this is a person coming to want to know something rather than a sweep.
 */
export function whatSheHasComeToWonderAbout(
  g: FieldGraph,
  opts: { room: number },
): AThingSheWondersAbout | null {
  if (opts.room <= 0) return null;
  let best: { n: FieldNode; score: number } | null = null;
  for (const n of g.nodes.values()) {
    // Not figures (a who is not a puzzle), and not things that are already questions, a question
    // that keeps coming back is a question she is carrying, which is a different mechanism and
    // already has one.
    if (n.kind === "figure" || n.kind === "question") continue;
    if (n.key?.endsWith(ASKED_MARK)) continue;         // once, and only once
    const score = howMuchSheWonders(g, n);
    if (score <= WONDERS_ABOVE) continue;
    if (!best || score > best.score) best = { n, score };
  }
  if (!best) return null;
  // HER WORDS, AND ONLY THE FACT. No reading of why it interests her, for the same reason
  // `what-stays.ts`'s stance clause was deleted: a pre-written interpretation planted in her
  // memory comes back out later sounding like something she worked out.
  // No dash after it: a cut is marked 「…」 and a whole line keeps its own end.
  const said = best.n.text.trim();
  const head = said.length > 40 ? `${said.slice(0, 39)}…` : said.replace(/[。！？!?，,、；;\s]+$/u, "");
  const text = `${head}。这件事我老想起来，可我说不上来为什么。`;
  return {
    from: best.n,
    text,
    key: `${WONDER_KEY}${best.n.id}`,
    // Below what being wronged writes: wanting to know something presses, and it is not a wound.
    tension: clamp01(0.3 + 0.3 * best.score),
  };
}
