import { describe, it, expect } from "vitest";
import { derivePolicy, capModel, modelForTier, tierForModel, type TierModels } from "../../../src/life/policy.js";
import type { Drives } from "../../../src/life/drives.js";
import type { PAD } from "../../../src/life/emotion.js";

// Regression guard: `tierCeiling` used to be computed and DISPLAYED everywhere but enforced
// nowhere: capTier had zero production call sites. "She downgrades when she is spent" was
// therefore untrue. Her state must actually cap which mind she can reach for.

const MODELS: TierModels = { background: "flash-lite", default: "flash", upgrade: "pro" };
const CALM: Drives = { discomfort: 0.1, care: 0.2, social: 0.3, curiosity: 0.5, expression: 0.2, maintenance: 0.2 };
const OK: PAD = { pleasure: 0.2, arousal: 0.2, dominance: 0.2 };

const policy = (o: { drives?: Drives; emotion?: PAD; phase?: "rested" | "normal" | "low" | "dormant"; awake?: boolean } = {}) =>
  derivePolicy({ drives: o.drives ?? CALM, emotion: o.emotion ?? OK, phase: o.phase ?? "normal", awake: o.awake ?? true });

describe("the tier ceiling is actually enforced", () => {
  it("maps tiers to her three minds, and back", () => {
    expect(modelForTier("tier0", MODELS)).toBe("flash-lite");
    expect(modelForTier("tier1", MODELS)).toBe("flash");
    expect(modelForTier("tier3", MODELS)).toBe("pro");
    expect(tierForModel("pro", MODELS)).toBe("tier3");
    expect(tierForModel("flash", MODELS)).toBe("tier1");
    expect(tierForModel("some-unknown-model", MODELS)).toBe("tier1"); // unknown = ordinary, never strongest
  });

  it("lets her reach her strongest mind when she is well", () => {
    expect(capModel("pro", policy({ phase: "rested" }), MODELS)).toBe("pro");
  });

  it("takes the strongest mind away when she is spent", () => {
    expect(capModel("pro", policy({ phase: "dormant" }), MODELS)).toBe("flash-lite");
    expect(capModel("pro", policy({ phase: "low" }), MODELS)).toBe("flash");
  });

  it("takes it away when she is weary or consolidating, not only when out of energy", () => {
    const weary = policy({ emotion: { pleasure: 0, arousal: -0.6, dominance: 0 } });
    expect(capModel("pro", weary, MODELS)).not.toBe("pro");
    const frustrated = policy({ drives: { ...CALM, discomfort: 0.8 } });
    expect(capModel("pro", frustrated, MODELS)).not.toBe("pro");
  });

  it("NEVER refuses work — it only lowers quality", () => {
    // Whatever state she is in, a request always resolves to SOME usable mind.
    for (const phase of ["rested", "normal", "low", "dormant"] as const) {
      for (const req of ["pro", "flash", "flash-lite"]) {
        const got = capModel(req, policy({ phase }), MODELS);
        expect(Object.values(MODELS)).toContain(got);
      }
    }
  });

  it("leaves a modest request untouched (the cap is a ceiling, not a floor)", () => {
    expect(capModel("flash", policy({ phase: "rested" }), MODELS)).toBe("flash");
    expect(capModel("flash-lite", policy({ phase: "dormant" }), MODELS)).toBe("flash-lite");
  });

  it("degrades honestly when the provider only has two real minds", () => {
    // With DeepSeek, background and default are the same id: the low tiers collapse, but the
    // ceiling still bites exactly where it matters, reaching for the strong mind.
    const two: TierModels = { background: "flash", default: "flash", upgrade: "pro" };
    expect(capModel("pro", policy({ phase: "dormant" }), two)).toBe("flash");
    expect(capModel("pro", policy({ phase: "rested" }), two)).toBe("pro");
  });
});
