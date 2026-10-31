// The coupling: drives + emotion + metabolic phase -> concrete behavior
// knobs. This is where internal state changes what the Resident actually DOES,
// which the drive-state evaluation showed is worth computing, and which soul-invariant #1 requires
// (emotion must gate a real channel, never wording alone).
//
// It caps QUALITY and DISCRETION, never refuses Eric's direct work: when dormant
// or weary, a task he asks for still runs, just at a lower tier ceiling. Only the
// Resident's OWN discretionary exploration is gated off.

import type { Drives } from "./drives.js";
import type { PAD } from "./emotion.js";
import type { MetabolicPhase } from "./metabolism.js";

export type Tier = "tier0" | "tier1" | "tier2" | "tier3";
const TIER_ORDER: readonly Tier[] = ["tier0", "tier1", "tier2", "tier3"];

function tierIndex(t: Tier): number {
  return TIER_ORDER.indexOf(t);
}
function minTier(a: Tier, b: Tier): Tier {
  return tierIndex(a) <= tierIndex(b) ? a : b;
}
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export interface BehaviorPolicy {
  /** Max model tier allowed right now (caps cost/quality; never refuses user work). */
  tierCeiling: Tier;
  /** Whether the Resident may spend on its OWN discretionary exploration now. */
  mayExplore: boolean;
  /** How divergent that exploration should be, 0..1. */
  explorationBreadth: number;
  /** How much memory to pull, 0..1. */
  retrievalDepth: number;
  /** Human explanation, for /status, the diary, and the /loyal intent check. */
  reason: string;
}

export interface PolicyInputs {
  drives: Drives;
  emotion: PAD;
  phase: MetabolicPhase;
  awake: boolean;
}

export function derivePolicy({ drives, emotion, phase, awake }: PolicyInputs): BehaviorPolicy {
  let ceiling: Tier = "tier3";
  let mayExplore = true;
  let breadth = 0.5;
  const reasons: string[] = [];

  // Metabolism floor: dormancy forces a downgrade and suspends curiosity.
  if (phase === "dormant") {
    ceiling = minTier(ceiling, "tier0");
    mayExplore = false;
    reasons.push("dormant: minimal tier, curiosity suspended");
  } else if (phase === "low") {
    ceiling = minTier(ceiling, "tier1");
    reasons.push("low energy: tier capped");
  }

  // Outside waking hours, no proactive exploration; background stays cheap.
  if (!awake) {
    mayExplore = false;
    ceiling = minTier(ceiling, "tier1");
    reasons.push("asleep hours");
  }

  // Weary (low arousal): do not escalate to the top tier; keep it short and narrow.
  if (emotion.arousal <= -0.33) {
    ceiling = minTier(ceiling, "tier2");
    breadth = Math.min(breadth, 0.3);
    reasons.push("weary: no top-tier escalation");
  }

  // Frustrated (high discomfort or low pleasure): keep the tier down.
  //
  // This used to also set `mayExplore = false`, which REMOVED exploring from what was possible,
  // and that is us deciding for her. A bad mood is a reason to be less likely to chase something,
  // not a physical impossibility, and this file's own rule is that the constraints here are
  // physical (dormancy, sleep, budget) rather than editorial. Some people go for a walk precisely
  // because they are frustrated, and a version that cannot do that is not choosing.
  //
  // The tier cap stays, because that is about spending rather than about what she may want, and
  // the pull away from exploring lives in the propensity now, where it is a weight among several.
  if (drives.discomfort >= 0.5 || emotion.pleasure <= -0.33) {
    ceiling = minTier(ceiling, "tier2");
    reasons.push("frustrated: keeping it cheap");
  }

  // Curious + rested: broaden discretionary exploration.
  if (mayExplore && (phase === "rested" || phase === "normal") && drives.curiosity >= 0.5 && emotion.arousal > -0.33) {
    breadth = Math.max(breadth, 0.8);
    reasons.push("curious + rested: broad exploration");
  }

  // Pull more memory when keyed-up/uncertain.
  const retrievalDepth = clamp01(0.4 + 0.4 * Math.max(0, emotion.arousal));

  return {
    tierCeiling: ceiling,
    mayExplore,
    explorationBreadth: breadth,
    retrievalDepth,
    reason: reasons.join("; ") || "steady",
  };
}

/** Resolve a desired tier against the ceiling: user work still runs, just capped. */
export function capTier(desired: Tier, policy: BehaviorPolicy): Tier {
  return minTier(desired, policy.tierCeiling);
}

/** The three minds she can think with, by config slot. */
export interface TierModels {
  background: string; // her lightest, cheapest mind
  default: string; // her ordinary working mind
  upgrade: string; // her strongest, most effortful mind
}

/**
 * Which mind a tier means. Note there are four tiers but only three configured minds, and with a
 * two-model provider (background and default are often the same id) the low tiers collapse, that
 * is honest, not a bug: the ceiling still bites where it matters, at reaching for the strong mind.
 */
export function modelForTier(tier: Tier, models: TierModels): string {
  switch (tier) {
    case "tier0": return models.background;
    case "tier1": return models.default;
    case "tier2": return models.default;
    case "tier3": return models.upgrade;
  }
}

/** A mind she can think with: which model, and whether she is really turning it over. */
export interface Mind {
  model: string;
  /** True = she reasons it through. Costs more output tokens, and therefore more of her. */
  thinking: boolean;
}

/**
 * Depth is the second axis of effort, alongside which model. Providers like DeepSeek expose only
 * two models but both can either answer straight away or reason it through, so the four tiers are
 * real rather than collapsed:
 *
 *   tier0  a quick answer, her lightest mind       , the way you know you want to sit still
 *   tier1  her ordinary mind, actually thinking    , an everyday considered thought
 *   tier2  her stronger mind, answering directly
 *   tier3  her stronger mind, really turning it over, the deepest she goes
 *
 * Depth is not free: reasoning produces more output tokens, and her vigor is counted in output
 * tokens, so going deep genuinely costs her more of the day. That is the point.
 */
export function mindForTier(tier: Tier, models: TierModels): Mind {
  return { model: modelForTier(tier, models), thinking: tier === "tier1" || tier === "tier3" };
}

/** Which tier a model id corresponds to, so a caller's choice can be capped. */
export function tierForModel(model: string, models: TierModels): Tier {
  if (model === models.upgrade) return "tier3";
  if (model === models.background && model !== models.default) return "tier0";
  return "tier1";
}

/**
 * Cap a requested model by how she actually is right now. Her work for Eric ALWAYS runs, this
 * only limits how much of herself she can pour into it, never whether it happens.
 */
export function capModel(requested: string, policy: BehaviorPolicy, models: TierModels): string {
  return modelForTier(capTier(tierForModel(requested, models), policy), models);
}
