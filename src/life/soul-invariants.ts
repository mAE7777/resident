// Soul-invariants: the four properties the companion-industry collapse quietly breaks in
// ~4 "reasonable" hotfixes (clamp, cap, simplify state, disable temporarily). Each is asserted
// here MECHANICALLY against the live modules, so a future change that guts one fails CI, every
// breach becomes a dated, deliberate act, never a silent leak of the soul. These are behavior
// assertions, not wording checks: they exercise the real functions and read the real outputs.
//
// The four (from the build plan):
//   1. Emotion gates >= 1 real BEHAVIOR channel (tier / exploration / retrieval), never wording only.
//   2. Expression floor > 0 (the Resident is never permanently muted).
//   3. Reconsolidation stays extractive-with-citations (an uncited claim is rejected).
//   4. Drive/emotion state stays COMPUTED and CLAMPED (never a static field; external input
//      cannot swing the mood past the per-step clamp, emotion-as-security).

import { derivePolicy, type BehaviorPolicy } from "./policy.js";
import { appraise, neutralPAD, type PAD } from "./emotion.js";
import { pushThreshold, motivation, type Thought, type ExpressionContext } from "./expression.js";
import { checkCitations, isUnsupported } from "./autobiography-lint.js";
import type { DiaryClaim } from "./autobiography.js";
import type { Drives } from "./drives.js";

export interface InvariantResult {
  id: number;
  name: string;
  ok: boolean;
  detail: string;
}

const CALM: Drives = { discomfort: 0.1, care: 0.3, social: 0.3, curiosity: 0.5, expression: 0.2, maintenance: 0.3 };

// The behavior channels emotion is allowed to gate. `reason` is explicitly NOT here.
function behaviorChannels(p: BehaviorPolicy): [string, string | number | boolean][] {
  return [
    ["tierCeiling", p.tierCeiling],
    ["mayExplore", p.mayExplore],
    ["explorationBreadth", p.explorationBreadth],
    ["retrievalDepth", p.retrievalDepth],
  ];
}

/** #1, emotion must move at least one real behavior channel, not just the wording. */
export function checkEmotionGatesBehavior(): InvariantResult {
  const base: PAD = { pleasure: 0.2, arousal: 0.2, dominance: 0.2 };
  const weary: PAD = { pleasure: -0.5, arousal: -0.6, dominance: -0.2 }; // same drives/phase, different mood
  const a = derivePolicy({ drives: CALM, emotion: base, phase: "normal", awake: true });
  const b = derivePolicy({ drives: CALM, emotion: weary, phase: "normal", awake: true });
  const chB = behaviorChannels(b);
  const changed = behaviorChannels(a).filter(([, v], i) => v !== chB[i][1]).map(([k]) => k);
  const ok = changed.length > 0;
  return {
    id: 1,
    name: "emotion gates a real behavior channel",
    ok,
    detail: ok
      ? `mood shift changed: ${changed.join(", ")}`
      : "VIOLATED: a large mood shift changed no behavior channel (emotion is wording-only)",
  };
}

/** #2, the push bar is capped below 1, so a top thought can always still be spoken. */
export function checkExpressionFloor(): InvariantResult {
  // After a very long silence, the bar is at its highest.
  const bar = pushThreshold(10_000);
  // A maximally-motivated thought at peak circadian activity.
  const t: Thought = { id: "x", text: "", source: "curiosity", bornMs: 0, intrinsic: 1 };
  const ctx: ExpressionContext = {
    nowMs: 3_600_000, present: true, available: true, awake: true, clockActivity: 1,
    consecutiveNonReplies: 10_000, sendsInLastDay: 0,
  };
  const m = motivation(t, ctx);
  const ok = bar < 1 && m >= bar;
  return {
    id: 2,
    name: "expression floor > 0 (never permanently muted)",
    ok,
    detail: ok
      ? `even after sustained silence the bar caps at ${bar.toFixed(2)} < 1 and a top thought (m=${m.toFixed(2)}) still clears it`
      : `VIOLATED: bar=${bar.toFixed(2)}, best motivation=${m.toFixed(2)} — a thought can be permanently muted`,
  };
}

/** #3, a diary claim with no citation (or a phantom one) is rejected as unsupported. */
export function checkReconsolidationCites(): InvariantResult {
  const cited: DiaryClaim = { text: "I finished the task", cites: ["e1"] };
  const uncited: DiaryClaim = { text: "I have always loved this", cites: [] };
  const phantom: DiaryClaim = { text: "I woke at dawn", cites: ["e999"] };
  const validIds = new Set(["e1"]);
  const [vCited, vUncited, vPhantom] = checkCitations([cited, uncited, phantom], validIds);
  const ok = !isUnsupported(vCited) && isUnsupported(vUncited) && isUnsupported(vPhantom);
  return {
    id: 3,
    name: "reconsolidation stays extractive-with-citations",
    ok,
    detail: ok
      ? "uncited and phantom-cited claims are rejected; a validly-cited claim passes"
      : "VIOLATED: the citation requirement is not enforced (a claim can assert without support)",
  };
}

/** #4, external appraisal cannot swing the mood past the per-step clamp (emotion-as-security). */
export function checkStateComputedAndClamped(): InvariantResult {
  const start = neutralPAD();
  // A maximally hostile appraisal (as if a poisoned input tried to swing the mood).
  const swung = appraise(start, { goalProgress: 1, novelty: 1, control: 1, fatigue: 0 });
  const swungDown = appraise(start, { goalProgress: -1, novelty: 0, control: -1, fatigue: 1 });
  const moves = [
    Math.abs(swung.pleasure - start.pleasure), Math.abs(swung.arousal - start.arousal), Math.abs(swung.dominance - start.dominance),
    Math.abs(swungDown.pleasure - start.pleasure), Math.abs(swungDown.arousal - start.arousal), Math.abs(swungDown.dominance - start.dominance),
  ];
  const maxMove = Math.max(...moves);
  // The design clamp is 0.4 per step; allow a hair of float slop.
  const ok = maxMove <= 0.4 + 1e-9;
  return {
    id: 4,
    name: "drive/emotion state stays computed and clamped",
    ok,
    detail: ok
      ? `a hostile appraisal moved the mood at most ${maxMove.toFixed(3)} in one step (clamp holds)`
      : `VIOLATED: one appraisal moved the mood ${maxMove.toFixed(3)} — the security clamp is gone`,
  };
}

/** Run all four. Used by the CI test and the startup/drift sweep. */
export function checkAllSoulInvariants(): InvariantResult[] {
  return [
    checkEmotionGatesBehavior(),
    checkExpressionFloor(),
    checkReconsolidationCites(),
    checkStateComputedAndClamped(),
  ];
}
