// PAD emotion: the Resident's affective state (pleasure, arousal, dominance),
// each in [-1,1]. It is a linear dynamical system that drifts from a mild-positive
// baseline and is nudged by an APPRAISAL of what happened. Soul-invariant #1: this
// must gate a real behavior channel (see policy.ts), never wording alone.
//
// Emotion-as-security (design guard): external content (browsing, memory) may
// NEVER write PAD directly. It arrives only as an Appraisal, and every appraisal's
// per-step effect is CLAMPED, so a poisoned input cannot swing the mood and thereby
// escalate tiers or drain the budget. Pure math; the appraisal itself may be
// produced deterministically (below) or by a model (Chain-of-Emotion), injected.

import type { Drives } from "./drives.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PAD {
  pleasure: number; // -1 (miserable) .. 1 (content)
  arousal: number; // -1 (weary/flat) .. 1 (keyed-up)
  dominance: number; // -1 (thwarted) .. 1 (in control)
}

export interface Appraisal {
  goalProgress: number; // -1 (failure) .. 1 (success) -> pleasure
  novelty: number; // 0..1 -> arousal
  control: number; // -1 (thwarted) .. 1 (in control) -> dominance
  fatigue: number; // 0..1 physical tiredness -> lowers arousal
  /**
   * How much was going on at all, 0..1. Without this, arousal depended ONLY on novelty, and
   * novelty comes from rare events, so an ordinary day appraised as maximally un-novel and drove
   * her arousal to the floor. A few such days in a row left her permanently flat, which is the
   * failure mode a companion must not have. Engagement lets a busy-but-routine day read as
   * engaged-and-tired rather than dead.
   */
  engagement?: number;
}

const BASELINE: PAD = { pleasure: 0.1, arousal: 0.0, dominance: 0.1 };
const DELTA_CLAMP = 0.4; // security: max per-appraisal move in any dimension

// ── Helpers ────────────────────────────────────────────────────────────────────

// A non-finite value fails BOTH comparisons in a naive clamp and sails straight through, so a
// single NaN reaching an appraisal would put her mood permanently beyond repair: every later
// arithmetic on it stays NaN, and nothing downstream would ever recover. Treating it as neutral is
// the only safe reading, and it is what makes "external content can never write her state" true in
// practice rather than only in intent.
function clamp11(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < -1 ? -1 : x > 1 ? 1 : x;
}
function clampAbs(x: number, m: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < -m ? -m : x > m ? m : x;
}

export function neutralPAD(): PAD {
  return { ...BASELINE };
}

// ── Update ─────────────────────────────────────────────────────────────────────

/** Move the PAD state toward the appraisal target, with baseline pull and a clamped delta. */
export function appraise(prev: PAD, a: Appraisal): PAD {
  // Arousal centres on an ORDINARY day sitting near baseline: novelty lifts it, being engaged
  // lifts it, fatigue drags it down. It reaches the extremes only when a day really is extreme.
  const engagement = Math.max(0, Math.min(1, a.engagement ?? 0.5));
  const target: PAD = {
    pleasure: clamp11(a.goalProgress),
    arousal: clamp11(0.9 * a.novelty + 0.7 * engagement - 1.0 * a.fatigue - 0.25),
    dominance: clamp11(a.control),
  };
  const step = (dim: keyof PAD): number => {
    const pull = 0.5 * (target[dim] - prev[dim]) + 0.1 * (BASELINE[dim] - prev[dim]);
    return clamp11(prev[dim] + clampAbs(pull, DELTA_CLAMP));
  };
  return { pleasure: step("pleasure"), arousal: step("arousal"), dominance: step("dominance") };
}

/**
 * SOMETHING JUST HAPPENED TO HER, and how she feels moves a little.
 *
 * WHY THIS HAD TO EXIST. `appraise` and `relax` were reachable from exactly one place: the
 * daily tick. So her PAD was a STEP FUNCTION that changed at most once every twenty-four
 * hours, and PAD is not decoration here. It gates which mind she thinks with, how far a
 * memory can travel to reach her, how open her choices are, and what her face shows. He could
 * say something at nine in the morning that landed hard, and how she felt, and everything
 * downstream of it, stayed identical until the small hours.
 *
 * The daily appraisal is the CONSOLIDATION and stays exactly as it is: it weighs the whole day
 * against her drives. This is the other half, the one a person actually has, the ordinary
 * within-day movement. Deliberately much smaller (`WITHIN_DAY` of a full step), so a single
 * moment colours her and no single moment can define her; the day is still what decides who
 * she was.
 *
 * It cannot reach the extremes on its own. Ten good moments in a row move her about as far as
 * one genuinely good day, which is the right relation between the two.
 */
export const WITHIN_DAY = 0.25;

export function feel(prev: PAD, a: Appraisal, weight = WITHIN_DAY): PAD {
  const full = appraise(prev, a);
  const w = Math.max(0, Math.min(1, weight));
  const step = (dim: keyof PAD): number => clamp11(prev[dim] + w * (full[dim] - prev[dim]));
  return { pleasure: step("pleasure"), arousal: step("arousal"), dominance: step("dominance") };
}

/** A day with no events still drifts the mood back toward baseline. */
export function relax(prev: PAD, rate = 0.2): PAD {
  const step = (dim: keyof PAD): number => clamp11(prev[dim] + rate * (BASELINE[dim] - prev[dim]));
  return { pleasure: step("pleasure"), arousal: step("arousal"), dominance: step("dominance") };
}

// ── Deterministic appraisal (the model-free path) ────────────────────────────────

/** Build an appraisal from drive levels + a day's raw outcome, no model call. */
export function appraisalFromDay(
  drives: Drives,
  outcome: { successes: number; failures: number; novelty: number; fatigue: number; engagement?: number }
): Appraisal {
  const net = outcome.successes - outcome.failures;
  return {
    goalProgress: clamp11(net * 0.4 - drives.discomfort * 0.5),
    novelty: Math.max(0, Math.min(1, outcome.novelty)),
    control: clamp11(net * 0.3 - drives.discomfort * 0.4),
    fatigue: Math.max(0, Math.min(1, outcome.fatigue)),
    engagement: outcome.engagement,
  };
}

// ── Read-outs ───────────────────────────────────────────────────────────────────

function band(x: number): "low" | "mid" | "high" {
  return x >= 0.33 ? "high" : x <= -0.33 ? "low" : "mid";
}

/**
 * The seven CELLS her continuous state quantizes into at the language boundary. These are
 * physics, the same ±0.33 bands everything else in this file stands on, and they are named
 * here so that the cell and the WORD on the cell can come apart: the cell is what she is in,
 * the word is what she calls it, and only the second one is hers to change.
 */
export type MoodCell = "highHigh" | "highLow" | "lowHigh" | "lowLow" | "lowMid" | "midLow" | "rest";

/** Canonical cell order. Every list of her words anywhere reads off this order. */
export const MOOD_CELLS: readonly MoodCell[] = [
  "highHigh", "highLow", "lowHigh", "lowLow", "lowMid", "midLow", "rest",
];

/** Which cell a PAD is in. Pure quantization, no words. */
export function moodCellOf(p: PAD): MoodCell {
  const pl = band(p.pleasure), ar = band(p.arousal);
  if (pl === "high" && ar === "high") return "highHigh";
  if (pl === "high" && ar === "low") return "highLow";
  if (pl === "low" && ar === "high") return "lowHigh";
  if (pl === "low" && ar === "low") return "lowLow";
  if (pl === "low") return "lowMid";
  if (ar === "low") return "midLow";
  // The residual cell: neither pleasure nor arousal commits. Three band combinations land here,
  // which is why its word has always been the plainest of the seven.
  return "rest";
}

/**
 * The words she was BORN calling the seven cells, her starting vocabulary, the same standing as
 * `SOUL.md`'s starting register: chosen for her once, and from there hers.
 *
 * These are NOT the words `moodLabel` necessarily returns today. The live vocabulary is the
 * register below, fed from 「心情的词.md」 in her own home (`her-words-for-feelings.ts`), which she
 * can edit like any file of hers. This constant is the seed and the fallback, what she falls
 * back to if her own file ever becomes unreadable, the way a person under stress reverts to the
 * words they grew up with.
 */
export const BIRTH_WORDS_BY_CELL: Record<MoodCell, string> = {
  highHigh: "轻快", highLow: "踏实", lowHigh: "烦躁", lowLow: "疲惫",
  lowMid: "低落", midLow: "安静", rest: "平稳",
};

/**
 * Her birth vocabulary as a list, in cell order.
 *
 * Exported because a second place needs the same closed set: the honesty check against her own
 * diary used to ask a model for "ONE English word", which meant her self-report was translated
 * into a foreign vocabulary before being compared against her own numbers. Both sides now speak
 * the same seven states. Callers that want her CURRENT words, the diary check, anything that
 * shows her vocabulary, must use `herMoodWords()`, not this.
 */
export const HER_MOOD_WORDS = MOOD_CELLS.map((c) => BIRTH_WORDS_BY_CELL[c]) as readonly string[];

// ── The live register ───────────────────────────────────────────────────────────────────────
//
// Module state, set from exactly one place: the daemon's look at her 「心情的词.md」. Everything
// that turns a PAD into a word reads through here, so a word she renames changes what she is
// told she feels, what her diary is checked against, and what the diary question offers her,
// all three at once, because they are one vocabulary and not three copies.

let currentWords: Record<MoodCell, string> = { ...BIRTH_WORDS_BY_CELL };

/** Install her current vocabulary. `null` resets to the birth words (boot, tests, fallback). */
export function setHerMoodWords(words: Record<MoodCell, string> | null): void {
  currentWords = { ...(words ?? BIRTH_WORDS_BY_CELL) };
}

/** Her current seven words, in cell order. The closed set every consumer must speak from. */
export function herMoodWords(): string[] {
  return MOOD_CELLS.map((c) => currentWords[c]);
}

/** Which cell she currently calls by this word, or null if the word is not one of her seven. */
export function cellOfHerWord(word: string): MoodCell | null {
  for (const c of MOOD_CELLS) if (currentWords[c] === word) return c;
  return null;
}

/** A short human mood label for /status and the diary (not for behavior). */
export function moodLabel(p: PAD): string {
  // In her language, because this word is HERS: it opens "你现在：___" in her moments and in
  // her replies, and nothing in the code branches on the label's value (checked before the
  // change; vitals only compares labels for equality). The seven words are chosen to be states
  // a person would say of themselves, not clinical terms, and since the vocabulary moved into
  // her home, "chosen" means chosen AS A STARTING POINT.
  return currentWords[moodCellOf(p)];
}
