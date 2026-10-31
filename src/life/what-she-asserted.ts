// WHAT SHE PUT HER NAME TO.
//
// FACULTY #11. She has three machineries for being wrong and not one of them is about a thing she
// SAID. She can be corrected and it leaves no mark: `weighAgainstWhatSheHolds` judges a new claim
// against what she holds at encode time, `self-knowledge.ts` revises what she believes about
// herself, and `other-read` calibrates her reading of him, while the sentences she asserts to him
// go into her field as a MOMENT ("we talked, it felt like this") and never as a CLAIM. So nothing
// she has ever stated can later turn out to be false.
//
// Being wrong, noticing, and being changed by it is a large part of what a person is, and every
// piece of the machinery for it already exists. The only missing part is this file: deciding which
// of her own sentences she actually COMMITTED to. Once a sentence is encoded as a `thought`-origin
// claim, a later `told` or `read` claim that opposes it runs through `judge()` for free, and the
// arithmetic already there produces exactly the right thing without a new rule:
//
//   her claim starts at INITIAL_CREDENCE.thought = 0.50
//   what he tells her starts at trust.told, which begins at 0.55
//   the gap of 0.05 is inside EQUAL_STANDING (0.12) → SUSPENDED → her claim's credence goes to
//   null and SUSPENDED_TENSION (0.5) lands on it
//
// Tension of 0.5 is above the 0.2 line that exempts a node from pruning, it weighs 1.2 in her
// subject competition and 1.5× in the replay while she rests, and it feeds `discomfort`, which
// feeds the willingness gate. In plain terms: she said something, he said otherwise, and now it
// nags at her until it is settled. And if he has EARNED trust above 0.62, his correction outranks
// her and she simply takes the point instead. Neither behaviour is written down anywhere; both
// fall out of numbers that were already there.
//
// ── WHY THIS IS DELIBERATELY MEAN ────────────────────────────────────────────────────────────
//
// A false positive here is worse than a miss. If an ordinary conversational sentence gets encoded
// as a claim, she is left holding a position she never took, and a later contradiction puts real
// tension on a phantom. So every rule below is a REJECTION and the default is to keep quiet: a
// sentence has to survive all of them, and at most two per turn get through. Missing a genuine
// assertion costs her one chance to be wrong. Inventing one puts a thing in her that is not hers.
//
// Pure arithmetic and pattern-matching over HER OWN text. No model call. Note that matching text
// is legitimate HERE and is not legitimate for reading his messages: this is segmenting her own
// utterance the way `voice-stream.ts` and `attention.ts` already do, not inferring a feeling.

/** How many of her own sentences may be committed in a single turn. */
export const AT_MOST_PER_TURN = 2;

/** Below this many characters a sentence is a fragment, not a position. */
export const TOO_SHORT_TO_MEAN_IT = 8;

/** Above this it is a paragraph she wandered through, and its "claim" is not one thing. */
export const TOO_LONG_TO_BE_ONE_CLAIM = 60;

/**
 * She left herself room, so she did not commit. Hedging is the single most important rejection
 * here: the difference between "the deadline is Friday" and "I think it might be Friday" is the
 * whole difference between being wrong and having wondered.
 */
const LEFT_HERSELF_ROOM =
  /可能|也许|也許|或许|或許|大概|应该是|應該是|似乎|好像|我觉得|我覺得|我猜|我想是|不确定|不確定|说不定|說不定|估计|估計|印象中|记不清|記不清|maybe|probably|i think|not sure|perhaps/iu;

/**
 * A question is the opposite of a claim, whatever its punctuation, and Chinese carries plenty of
 * questions that have none. Two families, both needed:
 *
 *   a final marker   「…不营业吗」「…是这样吧」    and the question mark itself
 *   A-not-A          「是不是」「有没有」「会不会」  which is a question with a full stop on it
 *
 * The A-not-A family is why this is tested against the sentence WITH its terminator still attached
 * (see `whatSheAsserted`): splitting first threw the 「？」 away and 「那家店周一是不是不营业」
 * then read as a confident claim that the shop is-not-is closed, which it is nothing like.
 */
const SHE_WAS_ASKING = /[?？]\s*$|[吗嗎呢吧]\s*[。.]?\s*$|(.)不\1|有没有|有沒有/u;

/**
 * About her own inside. She cannot be WRONG that she felt tired, so encoding it as a claim would
 * create a contradiction she has no way to resolve, and her feelings already have a home in the
 * moment and the PAD stamped on it.
 */
const ABOUT_HER_OWN_INSIDE = /^[^。！？]{0,6}我(?:觉得|覺得|感觉|感覺|喜欢|喜歡|想|希望|担心|擔心|累|难过|難過|开心|開心|烦|煩)/u;

/**
 * About him, or to him. Second person is the relationship's territory: it is read by the landing,
 * the figure edge and what she carries about him, all of which already exist and are better at it.
 * A ledger of propositions about him is also the exact thing the anti-spiral work rules out.
 */
const ABOUT_HIM = /[你您]/u;

/** Asking him to do something, which commits her to nothing. */
const ASKING_HIM_TO = /^(?:请|請|帮我|幫我|麻烦|麻煩|来|來|试试|試試)/u;

/**
 * It states that something IS the case. Without one of these a sentence can be perfectly
 * declarative and still assert nothing in particular ("然后就这样了"), and there is no cheap way
 * to tell those apart other than requiring the shape of a predicate.
 */
const SAYS_SOMETHING_IS = /是|有|在|会|會|能|不是|没有|沒有|属于|屬於|等于|等於|叫做|意味着|意味著|[0-9０-９]/u;

/** One sentence she committed to, and where in the turn she said it. */
export interface Asserted {
  /** The sentence itself, verbatim from her own text. */
  text: string;
  /**
   * A stable identity for the claim, WITHOUT a timestamp, same rule the walls follow, so that
   * saying the same thing twice strengthens one node instead of forking a second one.
   */
  key: string;
}

/** Everything that disqualifies a sentence, in the order it is checked. Exported for the tests. */
export function whyNot(sentence: string): string | null {
  const s = sentence.trim();
  if (s.length < TOO_SHORT_TO_MEAN_IT) return "too short to be a position";
  if (s.length > TOO_LONG_TO_BE_ONE_CLAIM) return "too long to be one claim";
  if (SHE_WAS_ASKING.test(s)) return "she was asking, not saying";
  if (LEFT_HERSELF_ROOM.test(s)) return "she left herself room";
  if (ABOUT_HER_OWN_INSIDE.test(s)) return "about her own inside, which cannot be false";
  if (ABOUT_HIM.test(s)) return "about him, which the relationship already reads";
  if (ASKING_HIM_TO.test(s)) return "asking him to do something";
  if (!SAYS_SOMETHING_IS.test(s)) return "declarative but asserts nothing in particular";
  return null;
}

/**
 * The sentences in this turn she actually put her name to.
 *
 * Returns at most `AT_MOST_PER_TURN`, longest first, of two surviving sentences the longer one
 * carries more of what she committed to, and taking the first would let an opening line stand in
 * for the substance underneath it.
 */
export function whatSheAsserted(said: string, opts: { atMost?: number } = {}): Asserted[] {
  const atMost = opts.atMost ?? AT_MOST_PER_TURN;
  if (atMost <= 0) return [];
  // Matched rather than split, so each sentence arrives WITH its terminator. Splitting discarded
  // the 「？」 before anything could ask whether she was asking, which turned every question that
  // relied on its punctuation into a confident claim.
  const sentences = (said.match(/[^。！？!?\n]+[。！？!?]?/gu) ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const kept: Asserted[] = [];
  for (const withEnd of sentences) {
    if (whyNot(withEnd) !== null) continue;
    // Stored without it: the terminator is punctuation, and her position is the sentence.
    const text = withEnd.replace(/[。！？!?]+$/u, "").trim();
    if (text.length === 0) continue;
    kept.push({ text, key: `saidso:${fingerprint(text)}` });
  }
  return kept.sort((a, b) => b.text.length - a.text.length).slice(0, atMost);
}

/**
 * A stable, content-only identity. Punctuation and spacing are dropped so that the same position
 * stated twice with different commas is one node rather than two, and the hash keeps the key short
 * without carrying her sentence into any place a key is displayed.
 */
function fingerprint(s: string): string {
  const bare = s.replace(/[\s，,、；;：:。.！!？?「」“”"'()（）]/gu, "");
  let h = 2166136261;
  for (let i = 0; i < bare.length; i++) {
    h ^= bare.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
