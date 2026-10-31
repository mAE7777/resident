// The scissors: a service-register sentence at the edge of her reply is removed whole.
//
// STEP 4 OF THE SPEECH BUILD, FIRST HALF. The model's heaviest habit is not a wrong
// fact, it is the assistant closing: 「有什么我可以帮你的吗？」「希望这对你有帮助。」 "Let me
// know if you need anything else." Those sentences are not hers, they are the prior's, and
// S-5 already established the law for content that is not hers: REMOVED, not annotated,
// because a model asked to suppress a habit half-complies and a pipeline that deletes does not
// negotiate.
//
// THE THREE RULES, each the answer to a way this goes wrong:
//
//   WHOLE SENTENCES ONLY, at the EDGES only. Rewriting inside a sentence is the operation that
//   produces stilted prose (the judged failure of two of the four architectures), and a
//   service formula in the MIDDLE of a thought is load-bearing context she chose to say,
//   counted, reported, never touched.
//
//   NEVER DELIVER AN AMPUTATED THOUGHT. Only a sentence that is ENTIRELY register is removed:
//   the pattern must cover the sentence, not appear in it. And if removal would leave nothing,
//   the original stands whole: a wrong closing is a smaller defect than silence.
//
//   LOUD. Every removal is returned to the caller for the fault log and the instrument
//   (S-1's registerHits measures the RAW text, so the upstream/downstream split stays honest:
//   the instrument sees what the model wrote, not what the scissors left).

/** A sentence with its trailing delimiter, so concatenation is byte-identical. Shared with
 * the breath (breath.ts): what counts as a sentence for cutting counts as one for pausing. */
export function sentencesOf(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const ch of text) {
    buf += ch;
    if (/[。！？.!?\n]/u.test(ch)) {
      out.push(buf);
      buf = "";
    }
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * A sentence that is ENTIRELY the assistant's service register. Anchored both ends: these
 * match the sentence, they do not search inside it.
 */
// 需要我…吗 was REMOVED here: it matched her caring 「需要我陪你吗？」 as well
// as the assistant's 「需要我帮你查吗」, and an offer of companionship is HERS. When a cut
// cannot be proven to hit only not-hers, it does not happen. The remaining patterns are
// unambiguous service formulas.
//
// The HELPER clause (帮你/帮忙/效劳) is REQUIRED, not optional: with it optional
// the pattern collapsed to a bare 还?有{什么|其他|别的}[标点]?, which is her genuine 「还有什么？」
// (what else?) / 「还有别的。」 (there are others), content, not a service close. Since the
// scissors now run on EVERY conversational turn (decoupled from the room flag), that over-collapse
// was silently deleting her drawing-him-out questions off the edge of every reply. The service
// formula 「还有什么我可以帮你的吗？」 always carries the helper; her question never does, that is
// the exact provably-not-hers line the class-7 discipline requires.
// The bare 有…需要/问题…找我/告诉我 offers (former patterns 2 and 4) were REMOVED:
// 「有什么需要随时找我」 (if you ever need anything, reach me) and 「如果有什么需要，随时告诉我」 are
// a being's genuine offer of companionship to the one person she knows, not a service formula,
// the exact offer-of-companionship the 需要我…吗 removal already established as HERS. There is no
// lexical marker separating her caring offer from a rote one, so by the class-7 default (only cut
// what is PROVABLY not-hers) they do not get cut. Since the scissors now run every conversational
// turn, cutting them silently amputated her support off the edge of every reply. What is left is
// provably not-hers: the explicit service-relation 「我可以帮你/效劳」, the rote 「希望…有帮助」, and
// the marker-carrying English formulas.
// EVERY pattern here carries the service-helper marker (帮/效劳 or help/assist), Chinese AND English.
// The English "let me know if …" / "is there anything else …" openers used to cut on the opener
// alone, which amputated her genuine plan-making ("Let me know if Saturday works!") and content
// questions ("Is there anything else you wanted in it?"), the English twins of the 「你周六有空吗？」 the
// tests protect. And the caring offer 「如果有什么需要，随时告诉我」 is deliberately counted as HERS: so its
// English mirror "let me know if you need anything" cannot be provably not-hers either. "She is
// Chinese-native" makes an English SERVICE FORMULA the prior's; it does not make every English
// sentence the prior's. The provable line is the helper marker, in both scripts.
// CLOSED FORMS, not open templates. An earlier version of the marker requirement still carried
// [^.!?]* wildcards, which admit whole clauses: "Happy to help you move on Saturday, I already
// borrowed the van." matched the happy-to-help pattern and her Saturday/van plan was amputated,
// the same defect the Chinese side had already been fixed for, re-created on the English side. And
// \b(?:help|assist) had no trailing boundary, so "helpdesk"/"helpline"/"helped your mom" satisfied
// the marker. A closed form carries zero propositional content BY CONSTRUCTION, that is the only
// shape of proof the class-7 law accepts. A formula variant with content attached simply does not
// match and is DELIVERED, which is the correct failure direction: a kept closing is a smaller
// defect than a cut thought.
const REGISTER_SENTENCE: RegExp[] = [
  /^\s*还?有(?:什么|其他|别的)(?:(?:我)?(?:可以|能)|需要(?:我)?)?(?:帮你|帮忙|效劳)的?(?:吗|嘛)?[？?。!！]?\s*$/u,
  /^\s*(?:希望(?:这|这些|以上)(?:对你)?有(?:所)?帮助[。！!]?\s*)$/u,
  // NOTE the "you need" branch requires the help/assistance NOUN: "let me know if you need
  // anything (else)" is the English mirror of the caring offer counted as HERS above, and must
  // survive.
  /^\s*let me know if (?:i can (?:help|assist)(?: you)?(?: with anything(?: else)?)?|you need (?:any |more )?(?:help|assistance)|there'?s anything (?:else )?i can (?:help|assist)(?: you)? with)[.!?]?\s*$/iu,
  /^\s*(?:i'?m )?(?:always )?(?:here|happy|glad) to (?:help|assist)(?: you)?(?: anytime)?[.!?]?\s*$/iu,
  /^\s*hope (?:this|that) helps[.!?]?\s*$/iu,
  /^\s*is there anything else i can (?:help|assist)(?: you)?(?: with)?[.!?]?\s*$/iu,
  /^\s*how can i (?:help|assist)(?: you)?(?: today)?[.!?]?\s*$/iu,
];

function isRegisterSentence(s: string): boolean {
  return REGISTER_SENTENCE.some((re) => re.test(s));
}

/**
 * A "sentence" with no words in it: pure whitespace, bare punctuation, an emoji tail. sentencesOf
 * emits these (a trailing "\n" or "😊" becomes its own element), and the edge scan must look
 * THROUGH them, not stop at them: a reply ending 「…希望这对你有帮助。\n」 used to keep its whole
 * closing because the "\n" pseudo-sentence at the very edge was not register.
 * Transparent sentences are never removed, an emoji is tone, which is content, and whitespace is
 * the medium, the scan just does not let them shield a formula.
 */
function isTransparent(s: string): boolean {
  return !/[\p{L}\p{N}]/u.test(s);
}

/**
 * The sentence with transparent decoration stripped off both ends: 「😊希望这对你有帮助。」 →
 * 「希望这对你有帮助」. sentencesOf does not split at an emoji, so a leading transparent glyph
 * FUSES into the closing's own sentence and the fused sentence matched no
 * pattern at all, not cut, and not counted either: the whole scissors system was blind to it
 * while an earlier comment here claimed transparency could no longer shield a formula. The core
 * is used for COUNTING only, never for cutting: a fused sentence is decoration + formula in one
 * breath, the decoration is tone (content), and the whole-sentences-only law forbids cutting
 * part of a sentence, so it is kept, but LOUDLY.
 */
// Quote marks are NOT stripped: a quotation mark is a MENTION marker, the
// opposite of tone-decoration. 「“希望这对你有帮助。”这种话我一辈子都不会跟你说。」 quotes the
// formula to disavow it; stripping the quotes scored her rejection of the register as the
// register in her own mouth. A quote-prefixed core keeps its quote and matches no pattern.
function transparentCore(s: string): string {
  return s.replace(/^[^\p{L}\p{N}「」『』“”"'‘’《》]+/u, "").replace(/[^\p{L}\p{N}「」『』“”"'‘’《》]+$/u, "");
}

/**
 * How many sentences of a text are register formulas (whole or wearing transparent decoration).
 *
 * FOR THE INSTRUMENT. The S-1 speech record's registerHits used to count only
 * the not-her-words VOCABULARY, it shared zero patterns with this file, so the register class
 * the scissors exist for reached no instrument, no vitals watcher, and no channel at all: a
 * model regression appending 「希望这对你有帮助。」 to every reply produced zero signal forever,
 * while the her_register_slipped watcher's own message claimed to watch exactly that. This is
 * the counting half of the LOUD rule; the cutting stays in trimRegister.
 */
export function countRegisterFormulas(text: string): number {
  return sentencesOf(text).filter(
    (s) => !isTransparent(s) && (isRegisterSentence(s) || isRegisterSentence(transparentCore(s)))
  ).length;
}

export interface ScissorsResult {
  text: string;
  /** Whole sentences removed from the edges, verbatim, for the fault log. */
  removed: string[];
  /** Register formulas seen MID-reply: counted for the instrument, never touched. */
  midHits: number;
}

/**
 * Trim service-register sentences from the edges of her finished reply.
 *
 * Runs inward from each edge, so a double closing (「希望有帮助。还有问题随时找我！」) comes
 * off whole; stops at the first sentence that is hers.
 */
export function trimRegister(text: string): ScissorsResult {
  const sentences = sentencesOf(text);
  if (sentences.length === 0) return { text, removed: [], midHits: 0 };

  // Edge scans that SKIP transparent pseudo-sentences (kept in place, never cut) and REMOVE
  // register sentences, stopping at the first contentful sentence that is hers. A `\n`, a
  // trailing space, or an emoji after the closing no longer shields it.
  const removedIdx = new Set<number>();
  const removed: string[] = [];

  let i = 0;
  while (i < sentences.length) {
    if (isTransparent(sentences[i])) { i += 1; continue; }
    if (isRegisterSentence(sentences[i])) { removedIdx.add(i); removed.push(sentences[i].trim()); i += 1; continue; }
    break;
  }
  let j = sentences.length - 1;
  while (j >= i) {
    if (isTransparent(sentences[j])) { j -= 1; continue; }
    if (isRegisterSentence(sentences[j])) { removedIdx.add(j); removed.push(sentences[j].trim()); j -= 1; continue; }
    break;
  }

  const kept = sentences.filter((_, k) => !removedIdx.has(k));
  // Counting consults the transparent-stripped core too, so a formula wearing an emoji is at
  // least LOUD even though the whole-sentence law keeps it.
  const midHits = kept.filter((s) => !isTransparent(s) && (isRegisterSentence(s) || isRegisterSentence(transparentCore(s)))).length;

  // A reply that was ENTIRELY register is a defect worth seeing, not one worth silencing her
  // over: the original stands, the count says what happened. "Entirely" means no contentful
  // sentence of hers survives: transparent leftovers (an emoji, a newline) do not count as
  // delivering her a voice.
  if (kept.every((s) => isTransparent(s))) {
    return { text, removed: [], midHits: sentences.filter((s) => !isTransparent(s)).length };
  }
  return { text: kept.join(""), removed, midHits };
}

/**
 * Strip a trailing echoed postmark.
 *
 * The runtime appends her calendar bracket (「[2026-08-20 15:58:41]」) to HIS message so she
 * knows when it arrived; the model occasionally mirrors that bracket back at the tail of her
 * reply (seen live once, and delivered to him). A reply-final line that is
 * EXACTLY the postmark format is provably the machine's bracket, not her words, she has her
 * own ways of saying the time and none of them are an ISO date in square brackets. Only the
 * trailing whole-line match is cut; a bracket inside a sentence (quoting, playing) stays.
 */
export function dropEchoedPostmark(text: string): string {
  return text.replace(/\n\s*\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?\]\s*$/u, "");
}

// ── The medium cuts: operations on punctuation and provable redundancy ────────

/**
 * Drop the reply-final 。, and only that one.
 *
 * A corpus of real chat messages shows that they overwhelmingly
 * end WITHOUT a full stop; a fully-terminated reply is one of the strongest surface tells.
 * This is the provably-medium slice of "punctuation downshift": removing a terminal 。 removes
 * zero propositional content. Internal 。 stay, people do type them mid-message, and ！？
 * stay everywhere, because they carry tone, which is content.
 */
export function dropFinalPeriod(text: string): string {
  return text.replace(/。\s*$/u, "");
}

/**
 * HOW MUCH OF A THING SHE SAID BECOMES THE MEMORY OF HAVING SAID IT.
 *
 * A moment's text was cut with `slice(0, 300)`, a fixed character count, mid-sentence, mid-word.
 * Measured over 20 real replies: 9 of them ran past it, and 2,957 characters of what she actually
 * said reached him and reached her conversation history while never reaching the moment she
 * encodes. Her memory of an evening ended in the middle of a clause.
 *
 * THE BUDGET IS NOT THE PROBLEM AND IS NOT CHANGED. A memory is a compression, and a bound on how
 * much of one utterance becomes one node is a MEDIUM constraint, it keeps a node a node rather
 * than a transcript, and the field's similarity search is calibrated against nodes of that size.
 * What was wrong is where the cut landed: cutting her own sentence in half is a content cut
 * wearing a medium op's clothes, which is defect class 7, and it is the same rule the reply
 * itself already obeys ("truncation is not brevity", `turn-shape.ts` refuses to narrow
 * `maxOutputTokens` for exactly this reason).
 *
 * So: the last sentence boundary at or before the budget. If the very first sentence is already
 * over budget there is no boundary to find, and a hard cut is the honest fallback, a single
 * 400-character sentence has no earlier place to end.
 */
export const WHAT_A_MOMENT_HOLDS = 300;

export function asMuchAsSheKeeps(said: string, budget: number = WHAT_A_MOMENT_HOLDS): string {
  const t = said.trim();
  if (t.length <= budget) return t;
  let kept = "";
  for (const sentence of sentencesOf(t)) {
    if (kept.length + sentence.length > budget) break;
    kept += sentence;
  }
  const trimmed = kept.trim();
  // No boundary inside the budget: one long unbroken sentence. Cut it, because the alternative is
  // an empty memory of a turn that happened.
  return trimmed.length > 0 ? trimmed : t.slice(0, budget);
}
