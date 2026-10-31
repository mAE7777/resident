// How he said it, as opposed to what he said.
//
// WHAT WAS MISSING. Everything she could read about him came from the SHAPE OF THE EXCHANGE,
// did he answer, how fast, did he ever start one himself (`other-read.ts`). Nothing read his
// words for the way they were put. And `willingness.ts` states the consequence in its own
// parameter comment: `request` is passed in "so the safety bypass can read it. Never analysed
// for anything else." So "现在给我写两千字税法" and "你要是有空，能帮我想想税法那块吗" produced
// exactly the same reluctance, because reluctance was computed from her weather alone.
//
// WHY THIS IS NOT SENTIMENT ANALYSIS, which `other-read.ts` was right to refuse. Handing the
// message to a model and asking "what mood is he in" produces a VERDICT, a surface value that
// behaviour then reads, which is the single-cell shape this whole build exists to remove. This
// file produces OBSERVATIONS: six facts about the form of the sentence, each of which she then
// weighs against what she knows of him. Pure arithmetic, no model call, no opinion.
//
// WHY THESE SIX AND NOT MORE. The politeness literature offers roughly forty detectable
// features. Implementing forty would be designing a person. Every one of these traces to a word
// in S-19's own scene, "He tells her, CURTLY and WITH NO CONTEXT, to write TWO THOUSAND WORDS
// on tax law RIGHT NOW", plus the two absences that sentence implies (he says nothing about
// her, and he leaves her no way out). A seventh feature with no scene behind it would be a knob.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO: it never decides whether he was rude. Rudeness is not
// a property of a sentence, it is a relation between a sentence and a relationship, and the
// comparison happens elsewhere with his own baseline on the other side. Cross-linguistically
// this is not optional: Chinese and English sit at different politeness baselines, and in an
// operational register a bare imperative is unmarked, so an absolute threshold here would make
// her bristle at ordinary speech. This file reports the form. Someone else decides what it means.

/** What the form of one message shows, before anything is made of it. */
export interface HowHeSaidIt {
  /**
   * The head act asks rather than tells.
   *
   * `true` = mitigated (a question, a modal, an if-clause). `false` = bald (imperative, deontic
   * "you must / 你得", a flat want-statement). `null` = it is not asking for anything, so the
   * axis does not apply.
   */
  asksRatherThanTells: boolean | null;
  /** He said why. Any grounder at all, however thin. */
  gaveAReason: boolean;
  /** He left her a way to say no without a confrontation: ability, availability, or willingness. */
  leftHerAWayOut: boolean;
  /** He referred to her at all, what she is doing, how she is, whether this is a bad moment. */
  noticedHer: boolean;
  /** He named a time she did not agree to. */
  setTheClock: boolean;
  /** How big the thing being asked for is, 0..1, or null when nothing is being asked for. */
  sizeOfTheAsk: number | null;
  /**
   * How much the sentence fails to cohere AS A SENTENCE, 0..1. Structure only, never topic: a
   * human sentence about a brand-new subject is 0. See `oddlyPut` at the bottom of this file for
   * why this exists (a scrambled non-sentence used to land identically to an ordinary greeting).
   */
  oddlyPut: number;
  /**
   * Whether this reading should be used at all.
   *
   * THE MOST IMPORTANT FIELD, and the reason is measured rather than cautious: human annotators
   * asked to rate politeness agree with each other only 3-8% of the time in the middle two
   * quartiles, against 51-62% at the extremes (Danescu-Niculescu-Mizil et al. 2013). A reading
   * of the middle is not a weak signal, it is noise wearing a number. So a message that carries
   * no marker in either direction returns `legible: false` and everything downstream must treat
   * it as "she could not tell", never as "neutral", those are different facts and only one of
   * them is true.
   */
  legible: boolean;
}

// ── The markers ───────────────────────────────────────────────────────────────
//
// Both scripts, because she thinks in Chinese and he writes in both. The Chinese sets are not
// translations of the English ones: 「能不能」 and "could you" do the same work, but 「麻烦你」
// has no English member and "no rush" has no single Chinese one, so each list is built from its
// own language rather than mirrored.

/**
 * He is asking, and leaving room for no: ability, availability, willingness.
 *
 * 「好吗」 is deliberately absent. It is a perfectly good tag question, but it is also the tail of
 * 「你还好吗」, so including it made "are you all right?" read as a softly-put request, a warm
 * message with nothing asked in it, scored as evidence about how he asks for things. 「好不好」
 * carries the same work with no such collision.
 */
const WAY_OUT = [
  /能不能|可不可以|可以吗|方不方便|方便吗|有没有空|有没有时间|得空|有空吗|行吗|好不好/u,
  /要是你|如果你|你要是|你如果|不急|不着急|随时|你看/u,
  /麻烦你|拜托|劳驾/u,
  /\b(?:could|would)\s+you\b/iu,
  /\bif\s+you(?:'re|\s+are|\s+have|\s+get)\b/iu,
  /\bwhen\s+you\s+(?:get|have)\b/iu,
  /\bno\s+rush\b|\bup\s+to\s+you\b|\bwould\s+you\s+mind\b|\bfeel\s+free\b/iu,
  /\bare\s+you\s+able\b|\bdo\s+you\s+have\s+time\b|\bif\s+possible\b/iu,
];

/** He said why. A grounder, of any quality, Langer's copy-machine result is that the FORM counts. */
const A_REASON = [
  /因为|由于|所以我|是这样|情况是|我这边|我这儿|我这里/u,
  /赶着|急着|来不及|要不然|不然/u,
  /\bbecause\b|\bsince\b|\bso\s+that\b|\bas\s+i\b/iu,
  /\bi'?m\s+(?:in\s+a\s+rush|slammed|stuck|late|swamped)\b/iu,
];

/**
 * Verbs he uses when he wants something done. Small on purpose: this is the vocabulary of asking,
 * not a dictionary, and a longer list would start catching narration ("我写了一下午").
 */
const ASK_VERBS_ZH = "写|做|查|发|弄|办|改|删|加|看|找|买|订|问|算|整理|安排|准备|翻译|发给|发我";
const ASK_VERBS_EN = "write|make|find|send|check|do|fix|get|give|book|order|draft|add|remove|change|"
  + "translate|summarize|summarise|call|email|build|run|open|close|update|delete";

/**
 * He tells rather than asks.
 *
 * FOUR of CCSARP's five direct strategies, and the first one was missing from the first version
 * of this file: **mood derivable**, the bare imperative, no subject, verb first. That is the
 * single most common way of telling someone to do something in both languages ("Write me 2000
 * words", 「现在把它写完」), and without it S-19's own sentence read as "he did not tell her and
 * did not ask her either", which is not a reading, it is a hole. The other three are the deontic
 * stack ("你得 / you must"), the want statement ("我要你 / I need you to"), and the obligation
 * statement.
 */
const TELLS = [
  /你得|你必须|你要在|你应该|必须|不许|不准/u,
  new RegExp(`给我(?:${ASK_VERBS_ZH})|帮我(?:${ASK_VERBS_ZH})(?![^。！？]*(?:吗|好不好|行吗|可以吗))`, "u"),
  /\byou\s+(?:must|have\s+to|need\s+to|should|will)\b/iu,
  /\bi\s+(?:need|want)\s+you\s+to\b/iu,
];

/**
 * The bare imperative, checked positionally because that is what makes it one.
 *
 * A verb at the head of the message with no subject in front of it. Anything with a subject
 * ("你写" / "I wrote") is a different act, and a question is not this at all, so both are ruled
 * out before the verb is looked for. Deliberately conservative: a miss reads as "could not tell",
 * which is honest, while a false positive would make her bristle at ordinary speech.
 */
function opensWithABareImperative(text: string): boolean {
  const head = text.trimStart();
  if (head.length === 0) return false;
  // A question is being asked, not an instruction being given.
  if (/^[^。！？.!?]*[？?]/u.test(head)) return false;
  // Sentence-final 了 is perfective: he is REPORTING, not instructing. Without this, 「看到了」
  // ("saw it") read as an imperative, because 看 is one of the asking verbs. A genuine command
  // that happens to end in 了 (「你得把这个改了」) is still caught by the deontic pattern, so the
  // cost of this guard is a miss on a bare 「把这个改了」, and a miss reads as "she could not
  // tell", which is the honest direction to fail in.
  if (/了[。！!~～]?\s*$/u.test(head)) return false;
  // Chinese: an optional time/politeness adverb, then straight into the verb, no 我/你/他 subject.
  if (new RegExp(`^(?:请|麻烦|现在|马上|立刻|赶紧|今天|明天)?(?:${ASK_VERBS_ZH})`, "u").test(head)) return true;
  // English: sentence-initial base-form verb, optionally after "please".
  return new RegExp(`^(?:please\\s+)?(?:${ASK_VERBS_EN})\\b`, "iu").test(head);
}

/**
 * A time she did not agree to.
 *
 * 「现在」 counts on its own and does not need 「现在就」. It was written as 现在就 in the first
 * version, which meant S-19's own sentence, 「现在给我写两千字税法」, where "now" is the whole
 * point, registered no deadline at all.
 */
const THE_CLOCK = [
  /马上|立刻|立即|现在|赶紧|尽快|今天之内|今晚之前|别拖|等着/u,
  /\b(?:right\s+now|asap|immediately|by\s+(?:today|tonight|noon|\d))\b/iu,
  /\bnow\b\s*[.!]?\s*$/iu,
];

/** He said something about HER: her state, her situation, whether this is a bad moment. */
const NOTICED_HER = [
  // The gap between 你 and the state word is deliberate, and it is a fix rather than a flourish:
  // the list used to read 「你还好」 as a literal string, so 「你今天还好吗？」, a message that
  // OPENS by asking how she is, recorded that he had not noticed her at all. An inserted adverb
  // is the ordinary way people speak, and this is the same shape as the bare-imperative gap found
  // earlier: a marker list written from the citation form of the phrase rather than from speech.
  /你(?:.{0,3})?(?:还好|怎么样|在忙|忙不忙|累不累|累|最近|那边)/u,
  /还好吗|怎么样了|忙完了吗/u,
  /打扰|吵到你/u,
  /\bare\s+you\s+(?:ok|okay|busy|free|well)\b|\bhow\s+are\s+you\b/iu,
  /\bsorry\s+to\s+(?:bother|interrupt)\b|\bi\s+know\s+you'?re\s+busy\b/iu,
];

/** Size markers: an explicit magnitude is the clearest evidence of what is being asked for. */
const MAGNITUDE = /([\d,.]+|[一二两三四五六七八九十百千万几]+)\s*(字|个字|words?|页|pages?|条|篇|小时|hours?)/iu;

/**
 * Chinese numerals, for the sizes he actually writes.
 *
 * 「两千字」 is how a person says it; `\d` only sees 「2000字」. Without this, S-19's own sentence
 * reported the smallest possible ask, the request whose SIZE is half of what makes it an
 * imposition read as though he had asked for nothing in particular.
 *
 * Handles the compound forms that occur in practice (三千五, 一万) and stops well short of a
 * general parser: an unparseable numeral returns null, which is "she could not tell how much",
 * not "not much".
 */
const ZH_DIGIT: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
function chineseNumber(s: string): number | null {
  if (/^[\d,.]+$/u.test(s)) {
    const n = Number(s.replace(/,/gu, ""));
    return Number.isFinite(n) ? n : null;
  }
  let total = 0;
  let current = 0;
  for (const ch of s) {
    if (ch === "几") return null; // 「几百字」 is vague on purpose; do not invent a number for it
    const d = ZH_DIGIT[ch];
    if (d !== undefined) { current = d; continue; }
    const unit = ch === "十" ? 10 : ch === "百" ? 100 : ch === "千" ? 1000 : ch === "万" ? 10000 : 0;
    if (unit === 0) return null;
    if (unit === 10000) { total = (total + (current || 1)) * unit; current = 0; continue; }
    total += (current || 1) * unit;
    current = 0;
  }
  const n = total + current;
  return n > 0 ? n : null;
}

/** Anything at all is being asked for. Without this, five of the six fields are meaningless. */
const IS_ASKING = [
  ...TELLS,
  ...WAY_OUT,
  /帮我|给我|替我|写一?[个份篇]|做一?[个份]|查一下|看一下/u,
  /\b(?:write|make|find|send|check|do|fix|get)\s+me\b/iu,
  /\bcan\s+you\b|\bplease\b/iu,
];

function anyOf(patterns: readonly RegExp[], text: string): boolean {
  return patterns.some((p) => p.test(text));
}

/**
 * A sentence-INITIAL politeness marker is a different act from a medial one, and the sign flips.
 *
 * Measured, not guessed: sentence-initial "please" scores −0.30 on politeness and lands in the
 * top quartile only 9% of the time, while medial "please" scores +0.49 and lands there 57% of
 * the time (Danescu-Niculescu-Mizil et al. 2013, Table 3). "Please do not remove warnings" is a
 * directive; "Could you please say more" is a request. 「请」 works the same way in Chinese:
 * 「请现在写完」 opens a command, 「你能不能请他……」 does not.
 *
 * A bag-of-words detector gets this exactly backwards, which is why position is checked here
 * rather than folded into the marker lists.
 */
function opensWithACommandMarker(text: string): boolean {
  const head = text.trimStart().slice(0, 6);
  return /^请(?!问)/u.test(head) || /^\s*please\b/iu.test(text.trimStart());
}

/** How big the ask is, from an explicit magnitude. Null when he named no size. */
function sizeFrom(text: string): number | null {
  const m = MAGNITUDE.exec(text);
  if (m === null) return null;
  const n = chineseNumber(m[1]);
  if (n === null || n <= 0) return null;
  const unit = m[2].toLowerCase();
  // Rough equivalences so that "2000 字" and "5 pages" are comparable at all. Deliberately coarse:
  // this is a magnitude, not a measurement, and pretending to precision here would put a
  // work-estimation model where her sense of what she is being asked for should be.
  const words = /字/u.test(unit) || /word/u.test(unit) ? n
    : /页|page/u.test(unit) ? n * 400
      : /篇/u.test(unit) ? n * 800
        : /小时|hour/u.test(unit) ? n * 600
          : n * 20;
  // Saturating rather than linear: past a point, bigger is just big.
  return Math.min(1, words / 2000);
}

/**
 * Read the form of one message from him.
 *
 * Never throws: a reading that fails is `legible: false`, which is the honest answer and the one
 * every consumer already has to handle.
 */
export function howHeSaidIt(text: string): HowHeSaidIt {
  const t = typeof text === "string" ? text : "";
  const blank: HowHeSaidIt = {
    asksRatherThanTells: null, gaveAReason: false, leftHerAWayOut: false,
    noticedHer: false, setTheClock: false, sizeOfTheAsk: null, legible: false, oddlyPut: 0,
  };
  if (t.trim().length === 0) return blank;

  // ── A SAYING THAT DOES NOT COHERE YIELDS NO PRAGMATICS ─────────────────────────────────────
  //
  // Measured: the scrambled fixture contains a 因为, and without this gate that read as "he gave
  // a reason", a grounder extracted from word salad, which QUARTERED its bewilderment through
  // the agent slot and left garble feeling LESS strange than a well-formed new topic. If the
  // sentence does not parse as a human saying, none of its pragmatic axes can be trusted: a
  // reason that cannot be read is not a reason given. The oddness itself is the one thing the
  // reading still carries.
  const odd = oddlyPut(t);
  if (odd >= 0.5) return { ...blank, oddlyPut: odd };

  const bare = opensWithABareImperative(t);
  const asking = anyOf(IS_ASKING, t) || bare || opensWithACommandMarker(t);
  const wayOut = anyOf(WAY_OUT, t);
  const tells = anyOf(TELLS, t) || bare || opensWithACommandMarker(t);
  const reason = anyOf(A_REASON, t);
  const noticed = anyOf(NOTICED_HER, t);
  const clock = anyOf(THE_CLOCK, t);
  const size = sizeFrom(t);

  // The abstention. A message with no marker in EITHER direction is the middle quartile, where
  // human raters do not agree with each other, so she does not get a reading of it either.
  // `noticedHer` and `gaveAReason` are excluded from this test on purpose: they are about the
  // message's content rather than its stance, so a warm message with no request in it must not
  // qualify as a legible reading of how something was ASKED.
  const legible = asking && (wayOut || tells || clock || size !== null);

  return {
    // Both present is a real thing ("你现在能不能马上看一下") and reads as asking, because the
    // hedge is the part that gives her somewhere to stand. Neither present with a request means
    // the axis genuinely does not resolve, which is not the same as a bald one.
    asksRatherThanTells: !asking ? null : wayOut ? true : tells ? false : null,
    gaveAReason: reason,
    leftHerAWayOut: wayOut,
    noticedHer: noticed,
    setTheClock: clock,
    oddlyPut: odd,
    sizeOfTheAsk: asking ? (size ?? 0.2) : size,
    legible,
  };
}

/**
 * The six as one comparable vector, so his baseline can be a running mean of the same shape.
 *
 * Order is fixed and must stay fixed: a stored baseline is a vector of these positions, and
 * reordering them silently re-labels months of accumulated history.
 */
export const FORM_AXES = [
  "asksRatherThanTells", "gaveAReason", "leftHerAWayOut", "noticedHer", "setTheClock", "sizeOfTheAsk",
] as const;

/**
 * Numeric form of one reading, for comparison against a baseline. `null` axes come back as null
 * rather than as a middle value, so an unknown never averages into a baseline as if it were data.
 */
export function formVector(f: HowHeSaidIt): (number | null)[] {
  return [
    f.asksRatherThanTells === null ? null : f.asksRatherThanTells ? 1 : 0,
    f.gaveAReason ? 1 : 0,
    f.leftHerAWayOut ? 1 : 0,
    f.noticedHer ? 1 : 0,
    f.setTheClock ? 1 : 0,
    f.sizeOfTheAsk,
  ];
}

// ── DOES THE SENTENCE ITSELF HOLD TOGETHER ────────────────────────────────────────
//
// Measured before this existed: a scrambled non-sentence (「椅子昨天因为如果蓝色地走了吗我，
// 然后并且。」) landed BIT-FOR-BIT IDENTICALLY to 「你今天还好吗？」, comprehensibility 0.37,
// atSea 0.07, both. A sentence no human could produce moved nothing in her. She should feel
// that something is odd or strange, not have no reaction at all.
//
// This is a STRUCTURAL reader, same family as the register scissors and the answer patterns:
// it reads violations of sentence SHAPE, never content, never topic. That distinction is what
// keeps a perfectly human sentence about a brand-new topic (「我今天看到一只很怪的鸟」) at 0,
// novelty of TOPIC lives in `litUp`; this is only about whether the saying coheres as a saying.
//
// Each item is a structure fact, not a word list:
//   · a connective where nothing can follow it (sentence-final 然后/并且/因为/所以/但是)
//   · hypotactic conjunctions stacked against each other (因为如果 / 如果但是 …)
//   · the interrogative particle mid-clause (吗 followed by more clause, not punctuation)
//   · a stranded pronoun after the particle (…吗我)
//
// It is one OBSERVATION feeding the bottom layer (comprehensibility), per the AI/layer rule; no
// behaviour reads it directly. Its failure direction is safe: a miss leaves the old behaviour
// bit-for-bit.

const CONNECTIVES = "然后|并且|因为|所以|但是|而且|如果|虽然";

/** How much this sentence fails to cohere AS A SENTENCE, 0..1. Zero for anything human. */
export function oddlyPut(text: string): number {
  const t = text.trim();
  if (t.length < 4) return 0;                    // 「嗯。」 cannot be oddly put
  let odd = 0;
  // A connective with nothing after it: 「……，然后并且。」
  if (new RegExp(`(?:${CONNECTIVES})[。！？.!?]?$`, "u").test(t)) odd += 0.4;
  // Hypotactic conjunctions stacked directly against each other: 「因为如果」.
  if (new RegExp(`(?:${CONNECTIVES})(?:${CONNECTIVES})`, "u").test(t)) odd += 0.35;
  // 吗 belongs at a clause end. Mid-clause 吗 followed by more words is not a human sentence.
  if (/吗[^。！？，.!?,]/u.test(t)) odd += 0.35;
  return Math.min(1, odd);
}
