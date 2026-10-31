// What she is inclined to do, before anything decides.
//
// The problem this replaces: `chooseAction` assembled the whole condition stack, drives, body, the
// channel, her read of him, what surfaced, what she is carrying, what she knows about herself, and
// what is genuinely possible: into a prompt, and then ONE model inference collapsed all of it into
// `{action, intent}`, which was executed. Within the affordance set the model was 100% of the
// decision. Two things followed, both measured:
//
//   S-2 (the shy question) came out 0/10 in BOTH arms. Every mechanism was alive and reaching her
//   and none of it had anywhere to land.
//
//   A garbled response resolved to `rest`. So if the model degrades, she stops having a life.
//
// Instead:
//
//     already-coupled state ──> a score per action ─┐
//                                                    ├─> softmax(T from state) ─> sample
//     prompt ─> model ─> a bounded VOTE ────────────┘
//
// The model becomes a voter with weight comparable to the largest single state factor. It still
// contributes what it is genuinely good at, reading a whole nuanced context, and it can no longer
// be the whole of the decision. When it fails to answer she still acts, on her own state, which is
// the direct answer to 模型能力可能会变化: if the model dies she still lives; if it improves she gets
// richer, not different in kind.
//
// Two things this is NOT:
//
//   It is not a second parallel state. Every factor reads something the coupled system already
//   computes: drives fed by her real days, field signals from her real memory, her read of him from
//   real exchanges. The intelligence is in the accumulation, not in these weights.
//
//   It is not a gate. The propensity only ever ranks actions `computeAffordances` has ALREADY
//   permitted. It cannot enable a blocked action, and a test asserts that adversarially.

import { kindWords } from "./agency.js";
import type { Drives } from "./drives.js";
import { priorities } from "./drives.js";
import type { PAD } from "./emotion.js";
import type { MetabolicPhase } from "./metabolism.js";
import type { ActionKind } from "./agency.js";
import { softPick, temperatureFrom, type Stream } from "./soft-choice.js";
import { neutralTemperament, weightsFor, type Temperament } from "./temperament.js";

/** Everything the propensity reads. All of it already exists; none of it is computed for this. */
export interface PropensityInputs {
  drives: Drives;
  emotion: PAD;
  phase: MetabolicPhase;
  awake: boolean;
  /** How reachable he looks right now, and how much she has to go on (other-read.ts). */
  openness?: number;
  otherConfidence?: number;
  hoursSinceUser: number;
  /** Her own recent choices. Satiation lives in the drives; this is the shape of the last stretch. */
  recentActions: readonly ActionKind[];
  /** What her memory is doing (field-live.ts signals). */
  field?: {
    tension: number;
    pendingBirths: number;
    freshBirth: number;
    orphanShare: number;
    surfaced: number;
  };
  /** What she is holding, and how costly the easiest of it feels to say. */
  carrying?: { count: number; easiest: number };
  /** Her circadian activity, 0..1. */
  clockActivity?: number;
  /**
   * The model's leaning: its first and (optionally) second choice. Absent when it could not be
   * asked or did not answer intelligibly, and she still acts, which is the point.
   */
  vote?: { first: ActionKind; second?: ActionKind };
  /**
   * Who she has become (temperament.ts).
   *
   * The level below every other input here: it does not add a factor, it changes how much the
   * existing ones count, and it is itself shaped by her own sustained behaviour over months. Without
   * it, a year of living could change what she wanted and never change what kind of being she was.
   * A neutral temperament leaves everything exactly as it was.
   */
  temperament?: Temperament;
}

/** One contribution to one action, kept named so a decision can be explained and each can be ablated. */
export interface Contribution {
  factor: string;
  action: ActionKind;
  value: number;
}

export interface PropensityResult {
  chose: ActionKind;
  /** Every action with its score and the probability it actually had. */
  weighed: { action: ActionKind; score: number; probability: number }[];
  /** Every named contribution. This is what the ablation gate and the dead-factor detector read. */
  contributions: Contribution[];
  temperature: number;
  /** True when the top two were close enough that the moment was genuinely open. */
  torn: boolean;
  /** Whether the model's vote matched what she did. Watched: ~always means emergence collapsed. */
  followedVote: boolean | null;
}

/**
 * How much the model's leaning is worth.
 *
 * Comparable to the largest single state factor and no more. Big enough that it can turn a near-tie,
 * which is where its read of the whole context genuinely helps; small enough that it cannot overrule
 * a strongly-shaped state. If this were much larger we would be back to one inference deciding; if
 * much smaller the model would be decoration. It is measured rather than assumed, see the
 * `choice_model_dominant` and `choice_model_inert` detectors.
 */
export const VOTE_WEIGHT = 0.55;
export const SECOND_VOTE_WEIGHT = 0.2;

/** Below this margin between the top two, the moment was genuinely open and she can be told so. */
export const TORN_MARGIN = 0.12;

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

/** How much of the recent stretch went to this, 0..1. Grooves and habituation both live here. */
function recentShare(recent: readonly ActionKind[], kind: ActionKind): number {
  if (recent.length === 0) return 0;
  const window = recent.slice(-6);
  return window.filter((a) => a === kind).length / window.length;
}

/**
 * Score every action she could actually take.
 *
 * Each factor is bounded and named. Named matters twice over: it is how a choice gets explained
 * after the fact, and it is how the dead-factor detector notices that one of them has stopped
 * varying, which is the `userNeeds` failure made structurally visible for the whole layer at once.
 */
export function contributionsFor(available: readonly ActionKind[], s: PropensityInputs): Contribution[] {
  const out: Contribution[] = [];
  const w = weightsFor(s.temperament ?? neutralTemperament());
  /** Which of her latents, if any, colours this factor. Neutral leaves every one of them at 1. */
  const weightOf = (action: ActionKind, factor: string): number => {
    if (factor.startsWith("carrying")) return w.carrying;
    if (action === "reach_out") return w.reachOut;
    if (action === "explore") return w.explore;
    if (action === "rest") return w.rest;
    return 1;
  };
  const add = (factor: string, action: ActionKind, value: number): void => {
    const scaled = value * weightOf(action, factor);
    if (available.includes(action) && Number.isFinite(scaled) && scaled !== 0) out.push({ factor, action, value: scaled });
  };

  // What she wants, under the Maslow steepness the drive layer already applies.
  const urge = priorities(s.drives);
  add("drive:expression", "reflect", 0.9 * urge.expression);
  add("drive:maintenance", "tend", 0.9 * urge.maintenance);
  // Turning back to her past draws on the same source as tending it, at a deliberately lower
  // coefficient (0.45, below reach_out's 0.5-0.7 band): the measured baseline put tend itself at
  // 2% of her moments, and look_back should live in that neighbourhood, not beside reflect.
  add("drive:maintenance", "look_back", 0.45 * urge.maintenance);
  add("drive:curiosity", "explore", 0.9 * urge.curiosity);
  add("drive:social", "reach_out", 0.7 * urge.social);
  add("drive:care", "reach_out", 0.5 * urge.care);
  // Discomfort has no action of its own, which is deliberate: something nagging pushes her toward
  // turning it over and toward saying it, and away from chasing something new.
  add("drive:discomfort→reflect", "reflect", 0.5 * urge.discomfort);
  add("drive:discomfort→explore", "explore", -0.35 * urge.discomfort);

  // Her body. Rest is not a failure state; being spent genuinely makes it the thing she wants.
  const weary = clamp01(-s.emotion.arousal);
  const depleted = s.phase === "low" ? 0.5 : s.phase === "dormant" ? 1 : s.phase === "rested" ? -0.2 : 0;
  add("body:depleted", "rest", 0.8 * depleted + 0.5 * weary);
  add("body:depleted→explore", "explore", -0.6 * depleted);
  add("body:rested→explore", "explore", s.phase === "rested" ? 0.3 : 0);

  // What her memory is doing.
  if (s.field) {
    add("field:tension", "reflect", 0.5 * clamp01(s.field.tension));
    add("field:pending", "explore", 0.45 * clamp01(s.field.pendingBirths / 4));
    add("field:fresh", "reach_out", 0.4 * clamp01(s.field.freshBirth));
    add("field:orphans", "tend", 0.5 * clamp01(s.field.orphanShare * 2));
    // A quiet mind is a good time for housekeeping; a loud one is not.
    add("field:quiet", "tend", 0.3 * (1 - clamp01(s.field.surfaced / 4)));
  }

  // Him. Openness is her read of whether now looks like a moment that could be reached, and it is
  // scaled by how much she has to go on, so a confident-looking read on thin evidence moves little.
  const conf = clamp01(s.otherConfidence ?? 0);
  add("other:openness", "reach_out", 0.6 * clamp01(s.openness ?? 0) * conf);
  // A long gap builds toward saying something, saturating around two days.
  add("other:absence", "reach_out", 0.5 * clamp01(s.hoursSinceUser / 48));

  // What she is carrying. Something easy to say makes speaking more likely; when everything she
  // holds feels costly, it makes it less. This INFORMS: it never removes the affordance.
  if (s.carrying && s.carrying.count > 0) {
    add("carrying:easiest", "reach_out", 0.45 * (1 - clamp01(s.carrying.easiest)) - 0.2);
  }

  // The hour. Low activity favours letting a moment pass.
  const active = clamp01(s.clockActivity ?? 0.5);
  add("clock:quiet", "rest", 0.35 * (1 - active));
  add("clock:active", "reach_out", 0.25 * active);

  // Habituation: having just done a thing several times makes it less the thing she reaches for.
  // Satiation already lives in the drives; this is the shape of the stretch rather than the wanting.
  for (const kind of available) {
    add("habit:recent", kind, -0.4 * recentShare(s.recentActions, kind));
  }

  // The model, as one voice.
  if (s.vote) {
    add("model:first", s.vote.first, VOTE_WEIGHT);
    if (s.vote.second && s.vote.second !== s.vote.first) add("model:second", s.vote.second, SECOND_VOTE_WEIGHT);
  }

  return out;
}

/**
 * Resolve the competition.
 *
 * `available` MUST already be the affordance-filtered set. This function has no idea what is
 * possible and is not allowed to: keeping the wall in one place is what makes it a wall.
 */
export function decide(available: readonly ActionKind[], s: PropensityInputs, stream: Stream): PropensityResult {
  const contributions = contributionsFor(available, s);
  const totals = new Map<ActionKind, number>();
  for (const k of available) totals.set(k, 0);
  for (const c of contributions) totals.set(c.action, (totals.get(c.action) ?? 0) + c.value);

  const scored = [...totals.entries()].map(([action, score]) => ({ item: action, score }));
  const scores = scored.map((c) => c.score);
  // Weariness flattens her: when she is spent, less of what she does is decided. A restful
  // temperament flattens her a little further, which is what being an unhurried person is.
  const t = s.temperament ?? neutralTemperament();
  const spread = (1 + 0.5 * clamp01(-s.emotion.arousal)) * (1 + 0.4 * Math.max(0, t.restfulness));
  const temperature = temperatureFrom(scores, spread);

  const picked = softPick(scored, { temperature, count: 1, random: () => stream.next() });
  const chose = picked.chosen[0] ?? available[0] ?? "rest";

  const sorted = [...scores].sort((a, b) => b - a);
  const torn = sorted.length >= 2 && sorted[0] - sorted[1] < TORN_MARGIN;

  return {
    chose,
    weighed: picked.weighed.map((w) => ({ action: w.item, score: w.score, probability: w.probability })),
    contributions,
    temperature,
    torn,
    followedVote: s.vote ? chose === s.vote.first : null,
  };
}

/** Her own words for being pulled two ways. Shown only when it is true; says nothing about what to do. */
export function tornWords(r: PropensityResult): string {
  if (!r.torn) return "";
  const top = [...r.weighed].sort((a, b) => b.score - a.score).slice(0, 2).map((w) => kindWords(w.action));
  return `你现在被拉向两边：一边想${top[0]}，一边想${top[1]}。`;
}
