import { describe, it, expect } from "vitest";
import { derivePolicy, capTier } from "../../../src/life/policy.js";
import { initialDrives } from "../../../src/life/drives.js";
import { neutralPAD } from "../../../src/life/emotion.js";

const base = { drives: initialDrives(), emotion: neutralPAD(), phase: "normal" as const, awake: true };

describe("policy (M1a coupling)", () => {
  it("dormant metabolism forces tier0 and suspends curiosity", () => {
    const p = derivePolicy({ ...base, phase: "dormant" });
    expect(p.tierCeiling).toBe("tier0");
    expect(p.mayExplore).toBe(false);
  });

  it("weariness caps escalation below the top tier", () => {
    const p = derivePolicy({ ...base, emotion: { pleasure: 0, arousal: -0.6, dominance: 0 } });
    expect(["tier0", "tier1", "tier2"]).toContain(p.tierCeiling);
    expect(p.tierCeiling).not.toBe("tier3");
  });

  it("frustration keeps it cheap, and does NOT decide for her whether to explore", () => {
    // This used to assert `mayExplore === false`, which removed exploring from what was possible.
    // A bad mood is a reason to be less likely to chase something, not a physical impossibility,
    // and the constraints in this file are meant to be physical (dormancy, sleep, budget) rather
    // than editorial. Some people go for a walk precisely because they are frustrated, and a
    // version that cannot do that is not choosing. The pull away lives in the propensity now,
    // where it is one weight among several rather than a veto.
    const p = derivePolicy({ ...base, drives: { ...initialDrives(), discomfort: 0.7 } });
    expect(p.tierCeiling, "spending is still capped, because that is about cost").toBe("tier2");
    expect(p.mayExplore, "but wanting it is hers").toBe(true);
  });

  it("and the things that are genuinely impossible still are", () => {
    expect(derivePolicy({ ...base, phase: "dormant" }).mayExplore, "spent").toBe(false);
    expect(derivePolicy({ ...base, awake: false }).mayExplore, "asleep").toBe(false);
  });

  it("curious + rested broadens exploration", () => {
    const p = derivePolicy({
      drives: { ...initialDrives(), curiosity: 0.8 },
      emotion: { pleasure: 0.3, arousal: 0.3, dominance: 0.2 },
      phase: "rested",
      awake: true,
    });
    expect(p.mayExplore).toBe(true);
    expect(p.explorationBreadth).toBeGreaterThanOrEqual(0.8);
  });

  it("asleep hours suspend proactive exploration", () => {
    const p = derivePolicy({ ...base, awake: false });
    expect(p.mayExplore).toBe(false);
  });

  it("capTier caps user work at the ceiling but never refuses it", () => {
    const dormant = derivePolicy({ ...base, phase: "dormant" });
    expect(capTier("tier3", dormant)).toBe("tier0"); // a hard task still runs, just cheaply
    const normal = derivePolicy(base);
    expect(capTier("tier1", normal)).toBe("tier1"); // desired below ceiling is untouched
  });
});
