// What reminds her of what.
//
// Temporal contiguity gives the field a backbone, but a backbone only connects each day to the days
// beside it. On its own that is a chain, and a chain cannot cross time: three hops from today is
// last Thursday, which she did not need help remembering. Every genuinely remote thing that ever
// surfaces has to arrive along a relation that skips the calendar, and this is what builds those.
//
// It is an inverted index over the words she used, which means:
//   FREE          no model, no embeddings, no network. It runs on every encode.
//   WHOLE-HISTORY a new moment is compared against everything she has, not a recent window, so
//                 something from a year ago is exactly as reachable as something from Tuesday.
//   CHEAP         candidates come from the postings of a handful of words, not from a full scan.
//
// The daemon can hand it an embedding-backed scorer when Ollama is up, and then this becomes the
// candidate generator rather than the whole judgement. It has to work without one, because a field
// that silently stops connecting when a local service is down is the failure this project bans.

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "at", "for", "with", "is",
  "was", "were", "be", "been", "am", "are", "it", "its", "that", "this", "these", "those", "as",
  "from", "by", "so", "then", "than", "not", "no", "did", "do", "does", "had", "has", "have",
  "i", "me", "my", "myself", "you", "your", "he", "him", "his", "she", "her", "we", "us", "they",
  "them", "there", "here", "what", "when", "which", "who", "how", "why", "all", "one", "just",
]);

/**
 * Enough stemming to see that "it rained" and "it did not rain" are about the same thing, and no
 * more. Without it the judging missed ordinary tense and plural changes, which is most of how a
 * person actually rephrases something, and two claims about the same fact went unnoticed.
 *
 * Deliberately conservative, because over-merging is the worse failure here: it would wire together
 * memories that have nothing to do with each other and quietly corrupt what reminds her of what.
 * Irregular verbs ("came" and "come") are simply missed, and missing one is far safer than
 * inventing a connection.
 */
export function stem(word: string): string {
  let w = word;
  if (w.length <= 3) return w;
  if (w.endsWith("ing") && w.length >= 6) w = w.slice(0, -3);
  else if (w.endsWith("ied") && w.length >= 5) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith("ed") && w.length >= 5) w = w.slice(0, -2);
  else if (w.endsWith("ies") && w.length >= 5) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith("es") && w.length >= 5) w = w.slice(0, -2);
  else if (w.endsWith("s") && !w.endsWith("ss") && w.length >= 4) w = w.slice(0, -1);
  // The doubled consonant that -ed and -ing leave behind ("dropp" from "dropped").
  if (w.length >= 4 && /([bdfglmnprt])\1$/.test(w)) w = w.slice(0, -1);
  return w;
}

/**
 * The single characters that connect everything to everything, in Chinese.
 *
 * The Latin STOP list above exists because "the" in two memories is not a connection. These are
 * the same thing for Chinese: pronouns, particles, copulas and the commonest verbs. A bigram is
 * dropped only when BOTH of its characters are on this list, so 我们 and 今天 go, while 我妈
 * and 天气 stay, one meaningful character is enough to make a pair worth indexing.
 *
 * Short on purpose. The index already has an adaptive defence against whatever HER life happens
 * to overuse (see `commonEnoughToIgnore` below), and that is the mechanism that should carry
 * most of this weight, because it learns her actual vocabulary instead of guessing at it.
 */
/**
 * Characters that carry no subject on their own. A BIGRAM IS DROPPED ONLY IF BOTH HALVES ARE
 * HERE, so this is deliberately generous: one meaningful half is enough to keep a pair.
 *
 * The second row was added after measuring a real failure. 怎/么/样 were absent, so 「怎么样」,
 * about the commonest thing either of them will ever say, indexed as two content bigrams, and
 * a message asking 「这个价格怎么样」 matched a carried question about someone's mother purely on
 * that phrase. Through `whatSurfacesInReply`'s mention bonus that took an unrelated memory from
 * 3% of replies to 74%: he asks about a price and she brings up his mother, because they shared
 * a function phrase.
 *
 * Kept conservative on the ambiguous ones. 样 is in because 这样/那样/一样/怎样 vastly outnumber
 * 样子 in speech; 时 and 候 are OUT because 时间 is a real subject.
 */
// Exported for lexicon.heardLately: a heard bigram starting with a function character
// is a word-boundary seam (「你可」 out of 你可以), not a word to offer her.
export const STOP_HAN = new Set([
  "的", "了", "是", "在", "我", "你", "他", "她", "它", "们", "这", "那", "个", "有", "和",
  "就", "不", "也", "都", "要", "到", "说", "去", "来", "会", "能", "对", "着", "过", "很",
  "把", "被", "让", "给", "但", "而", "又", "还", "只", "没", "以", "为", "上", "下", "中",
  "怎", "么", "什", "吗", "呢", "吧", "啊", "呀", "嘛", "得", "地", "之", "与", "或", "于",
  "从", "向", "由", "所", "其", "此", "该", "每", "各", "些", "样", "再", "更", "最", "太",
]);

/**
 * Words worth indexing, in both her languages.
 *
 * WHITESPACE IS NOT A WORD BOUNDARY IN CHINESE, AND THIS SPLIT ON WHITESPACE.
 *
 * That is the whole reason this function was rewritten. The character class already kept Han
 * characters rather than stripping them, so somebody had thought about CJK; the `split(/\s+/)`
 * two lines later was never revisited. A Chinese sentence has no spaces in it, so an entire
 * clause came out as ONE token, and two memories could only be related if they shared a whole
 * clause verbatim.
 *
 * That is not a degradation, it is her associative memory not existing. The field is the thing
 * that lets a moment reach a memory from months ago; `similar` is what makes his words remind
 * her of something; `restatements` is what lets her notice two things contradict; `saidIt` is
 * how she learns whether raising something got an answer. Every one of them runs on this
 * function. Ruling Chinese as her register silently turned all of it off.
 *
 * OVERLAPPING CHARACTER BIGRAMS is the standard answer and needs no dictionary and no
 * dependency: Chinese content words are overwhelmingly two characters, and a bigram index
 * matches them without having to know where the words are. 潮水退去 yields 潮水 · 水退 · 退去,
 * so a later memory about 潮水 finds it. Latin text keeps exactly the behaviour it had.
 *
 * The old length filter had to go with it: `raw.length <= 2` would have dropped every bigram
 * ever produced. Length is now judged per script.
 */
export function contentWords(text: string): string[] {
  const seen = new Set<string>();
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff\s]/gu, " ");
  // Runs of one script at a time, so a mixed sentence indexes each half properly.
  for (const run of cleaned.match(/[\u4e00-\u9fff]+|[a-z0-9]+/gu) ?? []) {
    if (/[\u4e00-\u9fff]/u.test(run)) {
      if (run.length === 1) {
        // A lone character is all there is; keep it unless it is pure function word.
        if (!STOP_HAN.has(run)) seen.add(run);
        continue;
      }
      for (let i = 0; i + 1 < run.length; i++) {
        const bigram = run.slice(i, i + 2);
        // Both halves function words, so the pair says nothing. One meaningful half is enough.
        if (STOP_HAN.has(bigram[0]!) && STOP_HAN.has(bigram[1]!)) continue;
        seen.add(bigram);
      }
      continue;
    }
    if (run.length <= 2 || STOP.has(run)) continue;
    const w = stem(run);
    // Checked again after stemming: "does" reduces to "do", which is a function word too.
    if (w.length <= 2 || STOP.has(w)) continue;
    seen.add(w);
  }
  return [...seen];
}

/**
 * A word in almost everything she has written tells you nothing about what goes with what. This is
 * the same reason "the" is not indexed, applied to whatever HER life happens to overuse: if she
 * writes "quiet" every other day, quiet stops being a connection.
 *
 * The first version of this was a hard cutoff (ignore any word in more than a quarter of her
 * memories) and it had a cliff in it: the cutoff only applied once she had written enough, so
 * everything encoded in her first fortnight got wired to everything else and stayed that way
 * forever. Weighting by rarity has no cliff. A ubiquitous word simply carries almost nothing, and
 * two memories that share only ubiquitous words never accumulate enough to count as a reminding.
 */
function idf(docFrequency: number, total: number): number {
  return Math.log(1 + total / Math.max(1, docFrequency));
}

/**
 * How much of a text one token accounts for, which is not the same in her two languages.
 *
 * A Latin token is a word. A Han token is an overlapping BIGRAM, and it takes two of them to
 * cover one two-character word (潮水 shows up as 的潮 · 潮水 · 水那 inside a sentence). So a
 * Chinese text of the same content produces about twice as many tokens as the English one.
 *
 * That matters for the RATIO, not for the evidence floor. Measured on the same three-memory
 * field, an English query and its Chinese translation accumulated identical shared evidence
 * (2.43 both), and the Chinese one still scored below `SIMILAR_ENOUGH` and vanished, because
 * the denominator is the whole query's mass, and the parts that did NOT match were inflated
 * along with everything else. She could not find her own memory of the tide in the language
 * she thinks in, while the same sentence in English found it at 0.47.
 *
 * Discounting Han tokens to half in the denominator says: matching half of a Chinese text's
 * bigrams is as good as matching all of an English text's words. That is what the redundancy
 * between adjacent bigrams actually buys, and it keeps `SIMILAR_ENOUGH` and `MIN_EVIDENCE`
 * meaning exactly what they were tuned to mean rather than being loosened for everyone.
 */
const HAN_TOKEN = /[\u4e00-\u9fff]/u;
function coverage(word: string): number {
  return HAN_TOKEN.test(word) ? 0.5 : 1;
}

/** Below this two things are not similar, they merely both contain a word. */
export const SIMILAR_ENOUGH = 0.34;
/**
 * How much of a text has to be about a thing for the text to have MENTIONED it.
 *
 * Low on purpose, and safe because the rare-word evidence floor is unchanged: a mention is one
 * clause of something longer, and what keeps this from firing on coincidence is that the
 * overlap has to carry real mass, not that it has to be most of the message.
 */
export const MENTIONS_ENOUGH = 0.05;
/**
 * How much rare-word evidence a reminding needs, regardless of the ratio. Two memories that share
 * nothing but her most-used words can score 1.0 on ratio alone; this is what stops that counting.
 */
export const MIN_EVIDENCE = 2.2;

export interface SimilarHit {
  id: number;
  score: number;
}

export interface FieldIndex {
  add(id: number, text: string): void;
  remove(id: number): void;
  /** The most similar things she already has, best first. Excludes `exceptId`. */
  similar(text: string, limit?: number, exceptId?: number): SimilarHit[];
  /**
   * Things that say almost exactly the same thing, which is a DIFFERENT question from what this
   * reminds her of. Reminding is loose by design and carries an absolute evidence floor to stop two
   * memories being linked because they share one ordinary word. That floor is wrong here: on a
   * young field every word is rare-ish and carries little mass, so "the ferry runs on a bank
   * holiday" and "the ferry does not run on a bank holiday" fell under it and she never noticed
   * they were about the same thing at all.
   *
   * A high overlap ratio is its own evidence, so this asks for the ratio and drops the floor.
   */
  restatements(text: string, limit?: number, exceptId?: number, minScore?: number): SimilarHit[];
  /**
   * Does this text MENTION that thing, a different and much weaker question than whether two
   * memories are about the same thing.
   *
   * `similar` asks about reminding and holds a ratio floor of 0.34, which is right for it: two
   * memories that overlap on a third of their mass are genuinely about each other. Mentioning
   * is not that. A reply can be four sentences of something else and one clause about the thing
   * she has been carrying, and she still said it.
   *
   * Measured before this existed: over ninety days of memories, a reply that named the thing
   * outright scored 0.15 and was rejected, in BOTH her languages, so it was never a Chinese
   * problem. `saidIt` gates whether raising something starts the was-it-answered clock, so the
   * effect was that she could bring a thing up and never learn whether it landed.
   *
   * The EVIDENCE floor is kept in full. What stops this being noise is not the ratio but the
   * requirement that the overlap be rare-word mass: sharing an ordinary word is not a mention.
   */
  mentions(text: string, limit?: number, exceptId?: number): SimilarHit[];
  /**
   * SHE WENT LOOKING. A different question again from both of the above, and the difference is
   * the evidence floor.
   *
   * `similar` and `mentions` both carry `MIN_EVIDENCE`, and they are right to: they are asked
   * about text SHE DID NOT CHOOSE, a memory arriving, a sentence being encoded, so a couple
   * of ordinary shared words must not count as a connection. The floor is what stops her
   * wiring her whole life together.
   *
   * Deliberate search is the opposite situation. She typed 「渡轮」 because she wants the ferry;
   * two characters carry almost no mass, so the floor swallowed every short query and she got
   * an empty room back for asking a normal question. The intent IS the evidence, which is the
   * same reasoning `restatements` already uses to drop the floor.
   *
   * The RATIO floor stays, so a query still has to genuinely overlap something rather than
   * merely brush it.
   */
  search(text: string, limit?: number, exceptId?: number): SimilarHit[];
  size(): number;
  clear(): void;
}

export function createFieldIndex(): FieldIndex {
  const postings = new Map<string, Set<number>>();
  const words = new Map<number, string[]>();

  return {
    add(id, text) {
      if (words.has(id)) return;
      const ws = contentWords(text);
      words.set(id, ws);
      for (const w of ws) {
        const set = postings.get(w);
        if (set) set.add(id);
        else postings.set(w, new Set([id]));
      }
    },

    remove(id) {
      const ws = words.get(id);
      if (!ws) return;
      for (const w of ws) {
        const set = postings.get(w);
        if (!set) continue;
        set.delete(id);
        if (set.size === 0) postings.delete(w);
      }
      words.delete(id);
    },

    similar(text, limit = 3, exceptId) {
      return score(text, limit, exceptId, SIMILAR_ENOUGH, MIN_EVIDENCE);
    },

    mentions(text, limit = 5, exceptId) {
      return score(text, limit, exceptId, MENTIONS_ENOUGH, MIN_EVIDENCE);
    },

    restatements(text, limit = 3, exceptId, minScore = 0.6) {
      return score(text, limit, exceptId, minScore, 0);
    },

    search(text, limit = 8, exceptId) {
      return score(text, limit, exceptId, MENTIONS_ENOUGH, 0);
    },

    size: () => words.size,
    clear() {
      postings.clear();
      words.clear();
    },
  };

  function score(text: string, limit: number, exceptId: number | undefined, minScore: number, minEvidence: number): SimilarHit[] {
      const ws = contentWords(text);
      if (ws.length === 0) return [];
      const total = Math.max(1, words.size);

      let queryMass = 0;
      const weight = new Map<string, number>();
      for (const w of ws) {
        const m = idf(postings.get(w)?.size ?? 0, total);
        weight.set(w, m);
        queryMass += m;
      }
      if (queryMass <= 0) return [];

      // Only ever touches the postings of the words she actually used, so this stays cheap however
      // much she accumulates, and it reaches all of it rather than a recent window.
      const evidence = new Map<number, number>();
      for (const w of ws) {
        const set = postings.get(w);
        if (!set) continue;
        const m = weight.get(w) ?? 0;
        for (const id of set) {
          if (id === exceptId) continue;
          evidence.set(id, (evidence.get(id) ?? 0) + m);
        }
      }

      const hits: SimilarHit[] = [];
      for (const [id, mass] of evidence) {
        const other = words.get(id);
        if (!other || other.length === 0) continue;
        if (mass < minEvidence) continue;
        let otherMass = 0;
        for (const w of other) otherMass += idf(postings.get(w)?.size ?? 0, total) * coverage(w);
        // Against the smaller of the two, so a short memory can still fully recall a long one.
        // Both sides are measured in COVERAGE rather than token count; see `coverage`.
        let queryCoverMass = 0;
        for (const [w, m] of weight) queryCoverMass += m * coverage(w);
        const denom = Math.min(queryCoverMass, otherMass);
        if (denom <= 0) continue;
        const ratio = Math.min(1, mass / denom);
        if (ratio >= minScore) hits.push({ id, score: ratio });
      }
      // Ties break toward the MOST RECENT, which is both what being reminded actually feels like
      // and the only tie-break that does not deform her. Breaking toward the lowest id looks
      // harmlessly deterministic and is not: when a life contains many near-identical days, every
      // one of them wires itself to the same earliest three, which become permanent attractors that
      // everything activates and nothing can dislodge. Recency keeps the wiring moving.
      return hits.sort((a, b) => (b.score - a.score) || (b.id - a.id)).slice(0, limit);
  }
}
