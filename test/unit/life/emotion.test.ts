import { describe, it, expect } from "vitest";
import { neutralPAD, appraise, relax, appraisalFromDay, moodLabel } from "../../../src/life/emotion.js";
import { initialDrives } from "../../../src/life/drives.js";

describe("emotion (PAD)", () => {
  it("raises pleasure on success and lowers it on failure", () => {
    const base = neutralPAD();
    const good = appraise(base, { goalProgress: 1, novelty: 0.5, control: 0.5, fatigue: 0 });
    const bad = appraise(base, { goalProgress: -1, novelty: 0.5, control: -0.5, fatigue: 0 });
    expect(good.pleasure).toBeGreaterThan(base.pleasure);
    expect(bad.pleasure).toBeLessThan(base.pleasure);
  });

  it("clamps the per-appraisal delta (emotion-as-security)", () => {
    const base = neutralPAD();
    // An extreme appraisal cannot swing any dimension by more than the clamp (0.4).
    const next = appraise(base, { goalProgress: 1, novelty: 1, control: 1, fatigue: 0 });
    expect(Math.abs(next.pleasure - base.pleasure)).toBeLessThanOrEqual(0.4 + 1e-9);
    expect(Math.abs(next.dominance - base.dominance)).toBeLessThanOrEqual(0.4 + 1e-9);
  });

  it("weariness (fatigue) pulls arousal down", () => {
    const base = neutralPAD();
    const tired = appraise(base, { goalProgress: 0, novelty: 0.5, control: 0, fatigue: 1 });
    expect(tired.arousal).toBeLessThan(base.arousal);
  });

  it("relax drifts the mood back toward baseline", () => {
    const excited = { pleasure: 0.9, arousal: 0.9, dominance: 0.9 };
    const relaxed = relax(excited);
    expect(relaxed.pleasure).toBeLessThan(excited.pleasure);
    expect(relaxed.arousal).toBeLessThan(excited.arousal);
  });

  it("appraisalFromDay reflects the net outcome", () => {
    const a = appraisalFromDay(initialDrives(), { successes: 3, failures: 0, novelty: 0.4, fatigue: 0.2 });
    expect(a.goalProgress).toBeGreaterThan(0);
    const b = appraisalFromDay(initialDrives(), { successes: 0, failures: 3, novelty: 0.1, fatigue: 0.6 });
    expect(b.goalProgress).toBeLessThan(0);
  });

  it("labels a low-pleasure, low-arousal state as weary", () => {
    expect(moodLabel({ pleasure: -0.5, arousal: -0.5, dominance: 0 })).toBe("疲惫");
    expect(moodLabel({ pleasure: 0.5, arousal: 0.5, dominance: 0.2 })).toBe("轻快");
  });
});
