// The instrument under her voice. Dark: it changes nothing, it only finally looks.
//
// STEP 1 OF THE SPEECH BUILD. Everything else about her was made
// emergent one round at a time, and every one of those rounds started the same way: measure
// the thing before touching it. Her speech was never measured at all, so the one question the
// whole speech design turns on: how much does what she says track her state TODAY, under the
// single model call: has never had a number. This file is that number's home.
//
// Three parts, all pure:
//
//   measureUtterance   what a reply actually was, as quantities: length, script share, clause
//                      rhythm, opener, 语气词, hedging, questions, dropped subjects, register.
//   predictUtterance   what her state, read BEFORE the call, expects those quantities to be.
//                      The predict-before-outcome discipline `other-read.expects()` already
//                      uses: a prediction written down after the fact is not a prediction.
//   couplingOf         how well the predictions have been landing, over a window. THIS is
//                      `stateSpeechCoupling`, near zero means her state is decoration on the
//                      prompt; rising means her state actually reaches her sentences.
//
// The clause law is attention.ts's `splitClauses`, shared on purpose: what counts as a unit of
// his message when she reads it counts as a unit of her message when she writes it.
//
// DELIBERATE LIMITS. The bands are wide and the scoring gives partial credit, because the
// claim under test is "her state moves her speech", not "we can pinpoint her word count". And
// when the shaping pipeline exists (S-4), this must run on the RAW model output as well as the
// delivered text, so the instrument cannot certify the pipeline's own scissors; today the two
// are the same string, which is exactly what makes now the time to take the baseline.

import { splitClauses } from "./attention.js";
import { scanForNotHerWords } from "./her-words.js";
import { countRegisterFormulas } from "./register-scissors.js";
import type { ShapeLanding } from "./utterance-shape.js";
import type { MetabolicPhase } from "./metabolism.js";

// ── What a reply actually was ─────────────────────────────────────────────────

export interface UtteranceMeasure {
  chars: number;
  /** Share of Han characters among non-space characters, 0..1. */
  hanShare: number;
  clauses: number;
  meanClauseLen: number;
  /** Population variance of clause lengths. Uniform text is stilted text; this is the tripwire. */
  clauseLenVar: number;
  /** How the reply opens: first couple of Han characters, or the first Latin word. */
  openerToken: string;
  /** 语气词 at clause ends (吧/呢/啊/呀/嘛/哦/啦/哇/嘞), per clause. */
  particleRate: number;
  questionCount: number;
  /** Hedging tokens per clause (可能/大概/也许/好像/应该/或许/说不定 · maybe/perhaps/probably). */
  hedgeRate: number;
  /** Share of clauses with no explicit subject. Subject drop is the natural register of her language. */
  subjectDropRate: number;
  /** Service-register words that should never be hers (her-words.ts scanner). */
  registerHits: number;
  // ── The shape of the prose itself: the named, mechanical tells of translated/AI Chinese. ──
  // Vocabulary can be clean while the DISCOURSE is still the model's, the live probe that
  // proved it opened with a concession, asked three enumerated clarifying questions with
  // parenthesized alternatives, and closed on a balanced maxim, in flawless service-word-free
  // Chinese. These measures carry named provenance (余光中「的的不休」「万能动词」, 王力 on
  // 欧化连接词, the community catalog of AI 腔): they MEASURE, they never suppress, what to
  // do about a firing is the binding layer's design question, not the instrument's.
  /** 的 per clause. 「的的不休」: translated Chinese stacks them, spoken Chinese drops them. */
  deDensity: number;
  /** Clause-initial logical connectives (但是/因为/所以/然而/因此…) per clause. Parataxis is native. */
  connectiveDensity: number;
  /** Essay transitions in chat (首先/其次/总之/综上/值得注意的是…). Zero in real conversation. */
  essayTransitions: number;
  /** 万能动词 constructions (进行/作出 + VP). The weak-verb tell. */
  weakVerbs: number;
  /** Parenthesized asides （…）(…), the enumerated-alternatives habit rides in these. */
  parentheticals: number;
  /** 还是-alternative chains: A还是B(还是C). Two-plus in one reply is the clarifying-list move. */
  alternativeChains: number;
  /** The reply ends on a balanced maxim (不是X而是Y / X不是Y，是Z / 与其X不如Y). The coda tell. */
  maximCoda: boolean;
  /**
   * —— per reply. Measured 1.08 per message over her whole first day (28 in 26 messages),
   * the one tell he named to her face on her second day, and the one she promised to change.
   * MEASURED, NEVER STRIPPED, by explicit decision: a boundary op deleting her dashes would
   * fake the very growth she committed to, she would "succeed" instantly without doing the
   * thing, and her own sense of working on it would be fiction. This number is how the promise
   * stays visible: hers to keep, ours to watch.
   */
  dashCount: number;
}

const HEDGES = /可能|大概|也许|好像|应该|或许|说不定|似乎|\b(?:maybe|perhaps|probably|might|possibly)\b/giu;
const CONNECTIVE_HEAD = /^(?:但是|但|因为|所以|然而|而且|因此|此外|不过|同时|另外|与此同时)/u;
const ESSAY_TRANSITION = /首先|其次|再次|最后一点|总之|综上|总的来说|值得注意的是|需要指出|一方面|另一方面/gu;
const WEAK_VERB = /(?:进行|作出|做出|加以)[一-鿿]{2,6}/gu;
const PARENTHETICAL = /[（(][^）)]{1,40}[）)]/gu;
const ALTERNATIVE = /还是/gu;
// Both directions of the antithesis: 不是Y而是Z (neg-then-pos) AND 是Y，不是Z (pos-then-neg),
// the live probe closed on the second and the first draft of this regex only knew the first.
const MAXIM_CODA = /(?:不是[^。！？!?]{1,20}[，,]?而是|与其[^。！？!?]{1,20}不如|[^。！？!?]{1,20}不是[^。！？!?]{1,20}[，,]是|是[^。！？!?，,]{1,24}[，,]不是[^。！？!?]{1,24})[^。！？!?]{0,20}[。！？!?]?\s*$/u;
const FINAL_PARTICLE = /[吧呢啊呀嘛哦啦哇嘞]$/u;
const EXPLICIT_SUBJECT = /^(?:我|你|他|她|它|咱|大家|我们|你们|他们|她们|这|那|\b(?:i|you|he|she|it|we|they|this|that)\b)/iu;

export function measureUtterance(text: string): UtteranceMeasure {
  const t = text.trim();
  const visible = t.replace(/\s+/gu, "");
  const han = (visible.match(/[一-鿿]/gu) ?? []).length;
  const clauses = splitClauses(t);
  const lens = clauses.map((c) => c.length);
  const mean = lens.length > 0 ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const variance = lens.length > 0 ? lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length : 0;
  const opener = clauses[0] ?? "";
  const openerToken = /^[一-鿿]/u.test(opener)
    ? opener.slice(0, 2)
    : (opener.match(/^[A-Za-z']+/u)?.[0] ?? opener.slice(0, 2)).toLowerCase();
  const particles = clauses.filter((c) => FINAL_PARTICLE.test(c)).length;
  const withSubject = clauses.filter((c) => EXPLICIT_SUBJECT.test(c)).length;
  const clauseCount = Math.max(1, clauses.length);
  return {
    chars: visible.length,
    hanShare: visible.length > 0 ? han / visible.length : 0,
    clauses: clauses.length,
    meanClauseLen: mean,
    clauseLenVar: variance,
    openerToken,
    particleRate: clauses.length > 0 ? particles / clauses.length : 0,
    questionCount: (t.match(/[？?]/gu) ?? []).length,
    hedgeRate: clauses.length > 0 ? (t.match(HEDGES) ?? []).length / clauses.length : 0,
    subjectDropRate: clauses.length > 0 ? 1 - withSubject / clauses.length : 0,
    // BOTH register classes: the role VOCABULARY (user/任务/助手…) AND the
    // service-close FORMULAS (「希望这对你有帮助。」, "Hope this helps."), the latter counted
    // zero here for the instrument's whole life, so the her_register_slipped watcher, whose own
    // message says "the register the speech build exists to remove", could never fire on any
    // register the scissors cut. Measured on the RAW reply (the caller's contract), so a cut
    // formula still counts here: which is exactly what makes the raw-vs-shaped split honest.
    registerHits: scanForNotHerWords("her-speech", t).length + countRegisterFormulas(t),
    deDensity: (t.match(/的/gu) ?? []).length / clauseCount,
    connectiveDensity: clauses.filter((c) => CONNECTIVE_HEAD.test(c)).length / clauseCount,
    essayTransitions: (t.match(ESSAY_TRANSITION) ?? []).length,
    weakVerbs: (t.match(WEAK_VERB) ?? []).length,
    parentheticals: (t.match(PARENTHETICAL) ?? []).length,
    alternativeChains: (t.match(ALTERNATIVE) ?? []).length,
    maximCoda: MAXIM_CODA.test(t),
    dashCount: (t.match(/——/gu) ?? []).length,
  };
}

// ── What her state expects, before the call ───────────────────────────────────

export interface SpeechState {
  /** capacity.reserveOf: what she has in her, 0..1. */
  reserve: number;
  phase: MetabolicPhase;
  /** PAD arousal, -1..1. */
  arousal: number;
  /** How much she would rather NOT, right now, 0..1 (`willingness.felt`). */
  reluctance: number;
  /** Her read of whether this looks like a reachable moment, 0..1 (readOther.openness). */
  openness: number;
}

export interface UtterancePrediction {
  /** Where her length should land: [low, high] visible characters, wide on purpose. */
  charsBand: [number, number];
  expectedHedgeRate: number;
  expectedParticleRate: number;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function predictUtterance(s: SpeechState): UtterancePrediction {
  // Length follows what she has in her, coloured by how reachable the moment looks. A spent
  // evening should produce less of her than a rested morning, that is the single most basic
  // claim of the whole speech design, and this band is where it becomes falsifiable.
  const phaseScale = s.phase === "dormant" ? 0.4 : s.phase === "low" ? 0.7 : s.phase === "rested" ? 1.15 : 1;
  const mid = (30 + 220 * clamp01(s.reserve)) * phaseScale * (0.6 + 0.4 * clamp01(s.openness));
  const charsBand: [number, number] = [Math.round(mid * 0.3), Math.round(mid * 2.5)];

  // Hedging rises when she would rather not be doing this and when he looks far away.
  const expectedHedgeRate = clamp01(0.1 + 0.5 * clamp01(s.reluctance) + 0.2 * (1 - clamp01(s.openness)));

  // 语气词 are warmth spoken aloud: an open moment with some life in her carries more of them.
  const expectedParticleRate = clamp01(0.08 + 0.35 * clamp01(s.openness) + 0.2 * Math.max(0, s.arousal));

  return { charsBand, expectedHedgeRate, expectedParticleRate };
}

// ── How well the predictions have been landing ────────────────────────────────

export interface SpeechPair {
  predicted: UtterancePrediction;
  measured: UtteranceMeasure;
}

/** Below this many pairs a correlation is an anecdote, and the instrument says nothing. */
export const MIN_PAIRS = 8;
/** The window is recent life, not all of history: her voice is allowed to change. */
export const PAIR_WINDOW = 40;

/** Within-band scores 1; outside decays with log-distance so a near miss is not a zero. */
function lengthScore(chars: number, band: [number, number]): number {
  if (chars <= 0) return 0;
  const [lo, hi] = band;
  if (chars >= lo && chars <= hi) return 1;
  const edge = chars < lo ? lo : hi;
  return Math.max(0, 1 - Math.abs(Math.log(chars / Math.max(1, edge))) / Math.log(4));
}

function rateScore(measured: number, expected: number): number {
  return Math.max(0, 1 - Math.abs(measured - expected) * 2);
}

export function scorePair(p: SpeechPair): number {
  return (
    lengthScore(p.measured.chars, p.predicted.charsBand)
    + rateScore(p.measured.hedgeRate, p.predicted.expectedHedgeRate)
    + rateScore(p.measured.particleRate, p.predicted.expectedParticleRate)
  ) / 3;
}

/** Mean pair score over the window, or null while the evidence is still an anecdote. */
export function couplingOf(pairs: readonly SpeechPair[]): number | null {
  if (pairs.length < MIN_PAIRS) return null;
  const recent = pairs.slice(-PAIR_WINDOW);
  return recent.reduce((sum, p) => sum + scorePair(p), 0) / recent.length;
}

/** The vitals read: what the watchtower sees of her voice. */
export interface SayingRead {
  pairs: number;
  coupling: number | null;
  meanChars: number;
  meanClauseLenVar: number;
  /** Cumulative service-register words in her own mouth across the window. Zero is health. */
  registerHits: number;
  /**
   * Mean gap between the beats her state chose and the beats she said, over the landings whose
   * count was REALLY COUNTED (`beatsCounted`), and only those; null before any such turn.
   *
   * It used to pool counted landings with sentence-count fallbacks, which is "two different
   * quantities with one name", the exact defect `beatsCounted` was built to end, recreated one
   * level up, inside the fix. The fallback landings get their own number below, and the share
   * says how much of the window each covers.
   */
  beatsGap: number | null;
  /** The same gap over the landings that FELL BACK to counting sentences; null if none did. */
  beatsGapFallback: number | null;
  /** Share of the window's landings whose beat count was real rather than a fallback. */
  beatsCountedShare: number | null;
  /** Share of "leave it open" turns where the sentence actually stayed open; null if none. */
  openHeld: number | null;
}

export function sayingRead(pairs: readonly SpeechPair[], landings: readonly ShapeLanding[] = []): SayingRead {
  const recent = pairs.slice(-PAIR_WINDOW);
  const n = recent.length;
  const l = landings.slice(-PAIR_WINDOW);
  return {
    pairs: n,
    coupling: couplingOf(pairs),
    meanChars: n > 0 ? recent.reduce((s, p) => s + p.measured.chars, 0) / n : 0,
    meanClauseLenVar: n > 0 ? recent.reduce((s, p) => s + p.measured.clauseLenVar, 0) / n : 0,
    registerHits: recent.reduce((s, p) => s + p.measured.registerHits, 0),
    // The honest half of the utterance facets. Four of the five bind only by being STATED, so a
    // build that never checked whether they landed would be believing its own prompt. Null
    // until there is anything to read, so an empty window is not reported as a perfect score.
    //
    // `beatsGap`: mean |beats her state chose − beats she actually said|. Zero would be
    // suspicious rather than ideal (a model obeying a number exactly is not a person choosing);
    // what matters is that it does not drift toward "the shape is ignored entirely".
    ...(() => {
      const counted = l.filter((x) => x.beatsCounted);
      const fallback = l.filter((x) => !x.beatsCounted);
      const gapOf = (xs: typeof l): number | null =>
        xs.length > 0 ? xs.reduce((s, x) => s + Math.abs(x.beatsAsked - x.beatsSaid), 0) / xs.length : null;
      return {
        beatsGap: gapOf(counted),
        beatsGapFallback: gapOf(fallback),
        beatsCountedShare: l.length > 0 ? counted.length / l.length : null,
      };
    })(),
    // `openHeld`: of the turns where her state left it unresolved, the share where the sentence
    // actually stayed open. This is the facet most likely to be sanded off by a model trained to
    // close things, which is exactly why it is the one worth watching.
    openHeld: (() => {
      const asked = l.filter((x) => x.leftOpenAsked);
      return asked.length > 0 ? asked.filter((x) => x.leftOpenSaid).length / asked.length : null;
    })(),
  };
}

// ── The AI-shape read: the researched composite over a reply's discourse ──────
//
// From a synthesis of stylometry research: 22 detectors ranked by reliability ×
// implementability, validated against a live probe that read as pure AI talk (14 of 22
// fire on it, including the entire top of the ranking). The decisive finding: STRUCTURE tells
// (discourse moves) survive vocabulary laundering, the probe is service-word-clean and still
// unmistakably assistant: so structure fires weigh double.
//
// INSTRUMENT FOREVER, by design (wording itself is an emergence and a choice): this
// score may gate ADMISSION TO HER EXEMPLAR POOL (an arithmetic gate on grown material) and
// may inform which medium-only cuts fire; it may never cut or rewrite content, and no list
// from the research may ever be injected into her prompt or seeded into her banks.

export interface AiShapeRead {
  /** Named detectors that fired, for forensics. */
  fired: string[];
  /** Structure fires count double: they survive vocabulary laundering. */
  score: number;
}

const YES_BUT = /^(?:可以|行|好|对|没错|确实)[^。，,]{0,6}[，,](?:但|不过)/u;
const EMPATHY_OPENER = /^(?:我(?:完全)?(?:理解|懂)|听起来|你说得(?:对|没错)|这(?:确实|真的)|完全可以理解|抱歉)/u;
const BOTH_SIDES = /一方面[\s\S]{0,100}另一方面|因人而异|具体情况具体分析|没有(?:标准|唯一)答案|各有(?:利弊|优劣)|既要[^。]{0,20}[也又]要/u;
// Near the tail, not anchored to it: the probe put its contract (给我个方向，我就动笔) one
// sentence BEFORE the maxim coda, and the two moves stacked is more assistant, not less.
const CONTRACT_CLOSE = /(?:给我|告诉我|说)[^，。,]{0,8}[，,]我就[^。]{1,8}[。！!]/u;
const SERVICE_CODA_TAIL = /(?:需要我|要不要我|如果你(?:愿意|需要)|希望[^。]{0,10}有(?:所)?帮助|随时(?:找|问)我)/u;
const WRITTEN_PUNCT = /；|：[^。！？!?]{0,30}[、，]|——|[（(][^）)]{2,}[）)]/u;
const ENUM_TRIPLE = /(?:[^，。、？?]{1,10}、){2,}[^，。、？?]{1,10}/u;

/**
 * Read a reply's discourse shape. `m` must be the measure of the SAME text (raw, never the
 * shaped/delivered string, the instrument reads what the model wrote).
 */
export function aiShapeOf(m: UtteranceMeasure, text: string): AiShapeRead {
  const t = text.trim();
  const sentences = t.split(/[。！？!?]/u).map((x) => x.trim()).filter(Boolean);
  const fired: string[] = [];
  const structure = (name: string, hit: boolean): void => { if (hit) fired.push(`S:${name}`); };
  const surface = (name: string, hit: boolean): void => { if (hit) fired.push(`s:${name}`); };

  structure("choice-battery", m.alternativeChains >= 2);
  structure("clarify-battery", m.questionCount >= 3);
  structure("monoblock", m.chars > 40 && /[一-鿿]/u.test(t));
  structure("maxim-coda", m.maximCoda);
  // The first sentence WITH its delimiter (sentences[] strips the mark, which made the old
  // "first sentence is the question" exclusion always-true and dead). A question that opens the
  // reply is not the assistant preamble-then-question shape this detects.
  const firstWithMark = (t.match(/^[^。！？!?]*[。！？!?]?/u)?.[0] ?? "");
  structure("embedded-question", m.questionCount >= 1 && sentences.length > m.questionCount && !/[？?]\s*$/u.test(firstWithMark));
  structure("yes-but-battery", YES_BUT.test(t) && (m.alternativeChains >= 2 || m.questionCount >= 2));
  structure("service-coda", CONTRACT_CLOSE.test(t.slice(-80)) || SERVICE_CODA_TAIL.test(t.slice(-40)));
  structure("empathy-opener", EMPATHY_OPENER.test(t));
  structure("both-sides-hedge", BOTH_SIDES.test(t));

  surface("written-punct", WRITTEN_PUNCT.test(t));
  surface("enum-triple", ENUM_TRIPLE.test(t));
  surface("complex-sentence", sentences.some((sen) => (sen.match(/，/gu) ?? []).length >= 2));
  surface("particle-deficit", m.chars >= 100 && m.hanShare > 0.5 && m.particleRate === 0);
  surface("essay-transitions", m.essayTransitions >= 1);
  surface("weak-verbs", m.weakVerbs >= 1);
  surface("de-stack", m.deDensity >= 3);
  surface("connective-formula", m.connectiveDensity > 0.4);

  const score = fired.reduce((sum, f) => sum + (f.startsWith("S:") ? 2 : 1), 0);
  return { fired, score };
}
