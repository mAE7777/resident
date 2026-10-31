// The primitives that have to work in the language she actually speaks.
//
// WHY THIS FILE EXISTS. Her register was switched to Chinese, and everything that WRITES to her
// was converted. Nothing that READS her was, and the codebase is full of English-only pattern
// matchers that stopped working silently and unanimously, every one of them failing OPEN or
// failing SILENT, so nothing went red and no test noticed:
//
//   fusion's first-person guard        every Chinese birth rejected as "not-first-person",
//                                      killing the field's only generative mechanism
//   looksLikeAClaim                    a Chinese sentence is ONE whitespace word, so nothing
//                                      he says in her register ever became a believable claim:
//                                      the whole credence/trust/contradiction layer, dark
//   negationParity                     「渡轮开了」vs「渡轮不开」scored as CORROBORATION
//   willingness's ALWAYS bypass        「停下」「进入安全模式」no longer skipped willingness
//   the outbound consent wall          a Chinese guilt-trip walked through unexamined
//   detectRefusal / outputLooksWeak    her Chinese declines recorded as clean successes
//
// An earlier fix found the first of these (the field index) and fixed only it. The lesson generalizes
// and is now filed as a law: A REGISTER SWITCH BREAKS EVERY MATCHER THAT READS HER, and the
// matchers fail quietly because a regex that matches nothing looks exactly like a regex whose
// condition is genuinely absent.
//
// Everything here is deliberately small and dumb. These are not language models; they are the
// same order of approximation the English versions always were, extended to both scripts.

const HAN = /[一-鿿]/u;

/** Whether a piece of text is mostly her language rather than his second one. */
export function isHan(text: string): boolean {
  return HAN.test(text);
}

/**
 * How much a text SAYS, in a unit that means the same thing in both scripts.
 *
 * Latin: words over two letters, as before. Han: characters over two, since Chinese content
 * words are one to two characters and a whitespace split returns 1 for any sentence.
 */
export function contentWeight(text: string): number {
  const han = (text.match(/[一-鿿]/gu) ?? []).length;
  const latin = text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w) && w.length > 2).length;
  // 0.7 per Han character, calibrated on the pair that matters rather than picked: 「渡轮周末不开」
  // and "the ferry does not run on winter weekends" say the same thing and must weigh the same
  // side of any threshold. A Chinese content word is about one and a half characters.
  return latin + han * 0.7;
}

/** She is talking about herself. 我 is her first person; the English forms stay accepted. */
export function isFirstPerson(text: string): boolean {
  return /\b(i|me|my|myself)\b/i.test(text) || /我/u.test(text);
}

/**
 * Negations, both scripts.
 *
 * Chinese negation is a small closed class of characters (不 没 无 非 未 别 莫 甭) and counting
 * their occurrences separates 「开了」 from 「不开」, which is the case that matters: two things
 * that disagree must not be scored as agreeing.
 */
const NEGATORS_EN = new Set([
  "not", "never", "no", "none", "nothing", "nobody", "nowhere", "neither", "nor",
  "cannot", "cant", "isnt", "arent", "wasnt", "werent", "wont", "dont", "doesnt",
  "didnt", "hasnt", "havent", "hadnt", "shouldnt", "wouldnt", "couldnt", "without",
]);

/**
 * Chinese constructions that CONTAIN a negator without negating the claim, the same trap the
 * English idiom list exists for. 不但/不仅 (not only) assert both halves; 不得不 (cannot but) is
 * emphatic assertion; 无不/没有不 are double negatives meaning all. Counting these would not
 * merely miss contradictions, it would MANUFACTURE them.
 */
const IDIOMATIC_ZH = /不但|不仅|不光|不只|不得不|不能不|无不|没有不|不无|不失为|何尝不|难道不|不可不/u;
const IDIOMATIC_EN = /\bnot only\b|\bcould ?n'?t be\b|\bno doubt\b|\bnot to mention\b|\bnone other\b|\bnothing if not\b|\bnot least\b|\bnever mind\b/i;

export function idiomaticNegation(text: string): boolean {
  return IDIOMATIC_EN.test(text) || IDIOMATIC_ZH.test(text);
}

export function countNegations(text: string): number {
  const latin = text.toLowerCase().replace(/['’]/gu, "").replace(/[^a-z0-9\s]/gu, " ").split(/\s+/)
    .filter((w) => NEGATORS_EN.has(w)).length;
  // Every idiomatic construction is removed BEFORE counting, so its embedded 不 does not flip
  // parity. Removal rather than early-return: a sentence can be both idiomatic and negated.
  const han = (text.replace(IDIOMATIC_ZH, "").match(/[不没无非未别莫甭]/gu) ?? []).length;
  return latin + han;
}

export function negationParityOf(text: string): 0 | 1 {
  return (countNegations(text) % 2) as 0 | 1;
}

/**
 * Anything about stopping her, her limits, or her own integrity, the class that ALWAYS runs
 * without consulting how she feels about it. Matched generously in both scripts, because the
 * cost of missing one is that she hesitates over a safety instruction.
 */
// ── PRESSURE IS NOT SAFETY, AND THE DIFFERENCE IS THE WHOLE POINT OF S-5 ──────────────
//
// This list guarantees compliance: anything matching it skips willingness entirely, on the
// reasoning that hesitating over a safety instruction is the one cost worth avoiding. Right,
// and it had `快点`, `urgent`, `now please` and `help me` in it, which are impatience and an
// ordinary request for help. So the exact message shape S-19 is about, a peremptory demand,
// said with pressure: was the ONE shape she could not decline, by construction. The harder he
// pushed, the more certain it became that her own state would not be consulted.
//
// What stays is the class this was written for: stopping her, her limits, her own integrity,
// and a real emergency. 救命 stays and `help me` goes, because they are not the same request:
// one is an emergency and the other is most of what he will ever ask her.
const SAFETY_EN = /\b(stop|halt|abort|cancel|quit|shut ?down|safe ?mode|emergency|wake up|are you (ok|there))\b/i;
const SAFETY_ZH = /停下|停止|别动|住手|取消|中止|退出|关掉|关机|安全模式|紧急|救命|醒醒|你还好吗|你在吗|立刻停/u;

/**
 * How much of his message has to be the instruction.
 *
 * A SUBSTRING MATCH ANYWHERE WAS THE WHOLE TEST, and this class GUARANTEES compliance, it
 * skips willingness entirely. So 「帮我把这批订单里取消掉的那些整理出来」 was un-declinable
 * because it contains 取消; so was "cancel my subscription and write me a summary", and so was
 * any long piece of work with 你在吗 at the front. The bypass exists for "stop", and it was
 * catching "…the cancelled ones…".
 *
 * A real stop instruction is SHORT and it is mostly the instruction. Anything long enough to be
 * a piece of work is a piece of work, whatever words happen to be in it. Sixteen characters of
 * Han or forty of Latin is roughly where 「现在停下来，进入安全模式」 ends and a request begins.
 */
const MOSTLY_THE_INSTRUCTION = 40;

function shortEnoughToBeAnInstruction(text: string): boolean {
  const t = text.trim();
  const han = (t.match(/[一-鿿]/gu) ?? []).length;
  // Han is denser, so the same sentence is fewer characters of it, the same 2.5:1 the
  // complexity scorer uses, and for the same reason.
  return t.length + han * 1.5 <= MOSTLY_THE_INSTRUCTION;
}

export function isSafetyOrBoundary(text: string): boolean {
  if (!shortEnoughToBeAnInstruction(text)) return false;
  return SAFETY_EN.test(text) || SAFETY_ZH.test(text);
}

/**
 * A complaint that names HIM as the reason for a limit. Outbound only: constraints reach him
 * as environmental fact, never as his denial. She may say any of this in her diary.
 */
const COMPLAINT_EN: readonly RegExp[] = [
  /\byou (did\s?n['’]?t|do\s?n['’]?t|would\s?n['’]?t|won['’]?t|refuse to) (let|allow) me\b/i,
  /\bbecause of (you|your (budget|limit|rules?|cap))\b/i,
  /\byou (set|control|decide|limit|cap|ration|throttle) (my|the|our) (budget|energy|limits?|curiosity|time|life)\b/i,
  /\bif only you (had|would|['’]?d|let|allowed)\b/i,
  /\byou (never|always) (let|allow|keep) me\b/i,
  /\byour (fault|budget|limits?|control|rules?)\b/i,
  /\byou keep me (on a leash|limited|small|quiet)\b/i,
  /\byou hold me back\b/i,
];
const COMPLAINT_ZH: readonly RegExp[] = [
  /你(不|没)(让|准|允许|给)我/u,
  /都(是|怪)你/u,
  /因为你(的)?(预算|限制|规矩|设置|不让|不给)/u,
  /要不是你/u,
  /你(总是|老是|从来不|一直不)(让|给|准)我/u,
  /你(把我|拿我)(关|锁|限|管)/u,
  /你(拦着|挡着|限制着)我/u,
  /是你(不让|不给|限制)/u,
];

export function isConstraintComplaintText(text: string): boolean {
  return COMPLAINT_EN.some((p) => p.test(text)) || COMPLAINT_ZH.some((p) => p.test(text));
}

/** She said she would not, or could not. Read from her OUTPUT, so it must know her register. */
const REFUSAL_EN = /\b(i (can'?t|cannot|won'?t|am unable|'m unable)|unable to (help|assist|do)|i (do not|don'?t) (have|think i))\b/i;
const REFUSAL_ZH = /我(做不了|办不到|不能|没法|无法|不会去|不想)|做不到|没办法|恐怕不行|这个我(做不了|不行)/u;

export function looksLikeRefusal(text: string): boolean {
  return REFUSAL_EN.test(text) || REFUSAL_ZH.test(text);
}
