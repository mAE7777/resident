import { describe, it, expect } from "vitest";
import {
  checkAllSoulInvariants,
  checkEmotionGatesBehavior,
  checkExpressionFloor,
  checkReconsolidationCites,
  checkStateComputedAndClamped,
} from "../../../src/life/soul-invariants.js";

// These are the CI-enforced soul-invariants: if a future change guts one, the check returns
// ok=false and this suite goes red, forcing the breach to be a deliberate, visible act.

describe("soul-invariants (CI-enforced)", () => {
  it("all four hold on the current code", () => {
    const results = checkAllSoulInvariants();
    expect(results).toHaveLength(4);
    for (const r of results) {
      expect(r, `invariant #${r.id} (${r.name}): ${r.detail}`).toMatchObject({ ok: true });
    }
  });

  it("#1 emotion gates a real behavior channel, not just wording", () => {
    expect(checkEmotionGatesBehavior().ok).toBe(true);
  });

  it("#2 the expression floor keeps the Resident speakable after any silence", () => {
    expect(checkExpressionFloor().ok).toBe(true);
  });

  it("#3 reconsolidation rejects an uncited or phantom-cited claim", () => {
    expect(checkReconsolidationCites().ok).toBe(true);
  });

  it("#4 a hostile appraisal cannot swing the mood past the security clamp", () => {
    expect(checkStateComputedAndClamped().ok).toBe(true);
  });
});
