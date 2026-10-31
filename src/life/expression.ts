// The expression gate: given a candidate thought and the moment, decide whether
// the Resident speaks it ALOUD now, holds it, or drains it to the diary. This is
// what makes silence the default and speaking the exception that must justify
// itself (Inner Thoughts, CHI 2025), and it is where the two-controller thrash the
// red-team warned about is resolved.
//
// Two channels, one rule each:
//   - PUSH (Telegram/voice) is governed SOLELY by a reply-adaptive threshold with a
//     nonzero floor: the more Eric ignores, the higher the bar, but never muted.
//   - The DIARY (a pull surface Eric opens) absorbs unexpressed urgency. Silence
//     accumulates INTO THE DIARY, never into a later needy push burst. So a dead
//     period leaves the reservoir empty, and re-engagement is calm, not a backlog.
//
// Pure decision logic. The thought's intrinsic score (Inner Thoughts' 8 heuristics:
// relevance, coherence, balance, dynamics, information-gap, expected-impact,
// originality, urgency) is computed upstream (ideally by a model) and passed in.

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Thought {
  id: string;
  text: string;
  source: string; // the drive/curiosity that produced it
  bornMs: number;
  intrinsic: number; // 0..1, from the 8-heuristic scoring
  /** True if the thought attributes a limit to Eric (consent boundary). */
  constraintComplaint?: boolean;
}

export interface ExpressionContext {
  /**
   * Her own randomness, for the soft edge of the bar. Optional: without it the bar is sharp, which
   * is the old behaviour and is stated rather than implied.
   */
  random?: () => number;
  nowMs: number;
  present: boolean; // Eric is at the machine
  available: boolean; // not in a meeting / DND / focus
  awake: boolean; // the Resident's waking hours (from the clock)
  clockActivity: number; // 0..1 circadian activity (modulates willingness)
  consecutiveNonReplies: number; // pushes since Eric last replied
  sendsInLastDay: number;
}

export type ExpressionChannel = "push" | "hold" | "diary";

export interface ExpressionDecision {
  channel: ExpressionChannel;
  motivation: number;
  threshold: number;
  reason: string;
}

/**
 * How near the bar she is, as a probability rather than a verdict.
 *
 * `m >= threshold` is a sharp line, and the line is arbitrary: 0.55 is a number someone picked, and
 * moving it 10% changes which side an ordinary moment falls on without anything about her being
 * more or less right. Far from it nothing changes, well below, she holds; well above, she speaks.
 * Near it, the outcome is genuinely uncertain, which is the honest description of being on the edge
 * of saying something.
 *
 * Not noise: it is the same score, and the same threshold, with the pretence of sharpness removed.
 */
export function clearsTheBar(motivation: number, threshold: number, random?: () => number): boolean {
  const gap = motivation - threshold;
  if (gap >= SOFT_BAR) return true;
  if (gap <= -SOFT_BAR) return false;
  if (!random) return gap >= 0; // deterministic where no randomness was supplied
  // Linear across the band: at the bar itself it is a coin toss.
  return random() < 0.5 + gap / (2 * SOFT_BAR);
}

/** How wide the uncertain band around the bar is. Small: this softens an edge, it does not blur it. */
export const SOFT_BAR = 0.06;

// ── Tunables ────────────────────────────────────────────────────────────────────

const DAILY_PUSH_CAP = 6; // ComPeer: ~6.6/day already reads as too many; stay under
const PUSH_FLOOR = 0.55; // the base bar to speak aloud
const PUSH_CEIL = 0.9; // the highest the bar goes under sustained non-reply
const PER_MISS = 0.08; // threshold rise per consecutive non-reply
const RESERVOIR_MAX_HOURS = 24; // a held thought older than this drains to the diary
const MAX_SILENCE_BOOST = 0.4; // how much silence-decay can lift motivation

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// ── Core functions ──────────────────────────────────────────────────────────────

/** Reply-adaptive push threshold: rises with ignored pushes, floored so never mute. */
export function pushThreshold(consecutiveNonReplies: number): number {
  return Math.min(PUSH_CEIL, PUSH_FLOOR + PER_MISS * Math.max(0, consecutiveNonReplies));
}

/**
 * Motivation to express a thought. Silence-decay lifts it as the thought ages, so
 * it is never permanently silent; the clock's activity modulates overall willingness.
 */
export function motivation(t: Thought, ctx: ExpressionContext): number {
  const ageHours = Math.max(0, (ctx.nowMs - t.bornMs) / 3_600_000);
  const silenceBoost = Math.min(MAX_SILENCE_BOOST, 0.05 * ageHours);
  const willingness = clamp01(0.4 + 0.6 * clamp01(ctx.clockActivity));
  return clamp01(t.intrinsic + silenceBoost) * willingness;
}

/** Decide the channel for a thought right now. */
export function decide(t: Thought, ctx: ExpressionContext): ExpressionDecision {
  const m = motivation(t, ctx);
  const threshold = pushThreshold(ctx.consecutiveNonReplies);

  // Consent boundary: a complaint that names Eric as the constraint NEVER pushes.
  if (t.constraintComplaint) {
    return { channel: "diary", motivation: m, threshold, reason: "constraint-complaint: diary only" };
  }
  // Not present/available/awake: drain to the diary, do not push.
  if (!ctx.present || !ctx.available || !ctx.awake) {
    return { channel: "diary", motivation: m, threshold, reason: "not present/available: diary" };
  }
  // Daily push cap: absorb into the diary rather than pile on.
  if (ctx.sendsInLastDay >= DAILY_PUSH_CAP) {
    return { channel: "diary", motivation: m, threshold, reason: "daily push cap reached: diary" };
  }
  if (clearsTheBar(m, threshold, ctx.random)) {
    return { channel: "push", motivation: m, threshold, reason: "cleared the reply-adaptive bar" };
  }
  // Below the bar: hold briefly; an aged thought drains to the diary, never bursts later.
  const ageHours = (ctx.nowMs - t.bornMs) / 3_600_000;
  if (ageHours >= RESERVOIR_MAX_HOURS) {
    return { channel: "diary", motivation: m, threshold, reason: "aged out of the reservoir: diary" };
  }
  return { channel: "hold", motivation: m, threshold, reason: "below the bar: hold" };
}

// ── Reservoir management (the caller holds the set; these are the transitions) ────

/** Partition a batch of thoughts into the three channels for this moment. */
export function route(thoughts: readonly Thought[], ctx: ExpressionContext): Record<ExpressionChannel, Thought[]> {
  const out: Record<ExpressionChannel, Thought[]> = { push: [], hold: [], diary: [] };
  // Only the single most-motivated thought may push per moment; the rest hold/diary.
  const scored = thoughts.map((t) => ({ t, d: decide(t, ctx) })).sort((a, b) => b.d.motivation - a.d.motivation);
  let pushed = false;
  for (const { t, d } of scored) {
    if (d.channel === "push" && !pushed) {
      out.push.push(t);
      pushed = true;
    } else if (d.channel === "push") {
      out.hold.push(t); // a second would-be push waits its turn
    } else {
      out[d.channel].push(t);
    }
  }
  return out;
}

/** A deterministic intrinsic score for the model-free path (drive urgency + novelty). */
export function intrinsicFromDrive(driveUrgency: number, novelty: number): number {
  return clamp01(0.5 * clamp01(driveUrgency) + 0.5 * clamp01(novelty));
}
