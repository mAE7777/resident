import { describe, it, expect } from "vitest";
import { mindForTier, capTier, derivePolicy, type TierModels } from "../../../src/life/policy.js";
import { liveMoment, type MomentContext, type MomentDeps } from "../../../src/life/agency.js";
import { createMomentHandlers } from "../../../src/life/agency-handlers.js";
import type { InnerSnapshot } from "../../../src/life/inner-state.js";
import type { PAD } from "../../../src/life/emotion.js";
import type { Drives } from "../../../src/life/drives.js";
import type { LLMProvider, LLMRequest, LLMResponse } from "../../../src/providers/types.js";

// Depth of thought is the second axis of effort. Two things must hold:
//   * it is READ OFF HER, never assigned by us, a settled being just knows what it feels like
//     doing; a troubled one genuinely stops and thinks about what to do with itself;
//   * the depth of an ACT follows what that act IS (reflecting is thinking; speaking is not
//     problem-solving), which is the meaning of the action, not a rule imposed on her choice.

const MODELS: TierModels = { background: "flash", default: "flash", upgrade: "pro" };
const CALM: Drives = { discomfort: 0.1, care: 0.2, social: 0.3, curiosity: 0.5, expression: 0.2, maintenance: 0.2 };
const EVEN: PAD = { pleasure: 0.15, arousal: 0.1, dominance: 0.1 };

function snapshot(over: Partial<InnerSnapshot> = {}): InnerSnapshot {
  return {
    drives: CALM, emotion: EVEN, mood: "steady", dominant: "curiosity",
    policy: derivePolicy({ drives: CALM, emotion: EVEN, phase: "normal", awake: true }), ...over,
  };
}
function ctx(over: Partial<MomentContext> = {}): MomentContext {
  return {
    nowMs: 1_000, snapshot: snapshot(), phase: "normal", awake: true, present: true, available: true,
    hoursSinceUser: 4, recentActions: [], recentLife: "quiet", safeMode: false, ...over,
  };
}

describe("which mind a tier means", () => {
  it("gives four real levels even when the provider has only two models", () => {
    expect(mindForTier("tier0", MODELS)).toEqual({ model: "flash", thinking: false });
    expect(mindForTier("tier1", MODELS)).toEqual({ model: "flash", thinking: true });
    expect(mindForTier("tier2", MODELS)).toEqual({ model: "flash", thinking: false });
    expect(mindForTier("tier3", MODELS)).toEqual({ model: "pro", thinking: true });
    // Four tiers, four genuinely distinct minds, the low tiers no longer collapse.
    const all = (["tier0", "tier1", "tier2", "tier3"] as const).map((t) => JSON.stringify(mindForTier(t, MODELS)));
    expect(new Set(all).size).toBeGreaterThanOrEqual(3);
  });
});

describe("her condition caps how deeply she can think", () => {
  it("when she is spent, even reflecting is shallow", () => {
    const spent = derivePolicy({ drives: CALM, emotion: EVEN, phase: "dormant", awake: true });
    expect(mindForTier(spent.tierCeiling, MODELS).thinking).toBe(false);
  });

  it("when she is well, she can really turn something over", () => {
    const well = derivePolicy({ drives: CALM, emotion: EVEN, phase: "rested", awake: true });
    expect(mindForTier(capTier("tier3", well), MODELS).thinking).toBe(true);
  });

  it("being weary takes her depth away too, not only being out of energy", () => {
    const weary = derivePolicy({ drives: CALM, emotion: { pleasure: 0, arousal: -0.6, dominance: 0 }, phase: "normal", awake: true });
    expect(mindForTier(weary.tierCeiling, MODELS).thinking).toBe(false);
  });
});

describe("what each act costs in depth follows what the act IS", () => {
  function recording() {
    const seen: { thinking?: string; system: string }[] = [];
    const provider: LLMProvider = {
      async complete(req: LLMRequest): Promise<LLMResponse> {
        seen.push({ thinking: req.thinking?.type, system: String(req.system ?? "").slice(0, 30) });
        return { id: "x", content: [{ type: "text", text: "something real" }], model: "m", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    return { provider, seen };
  }

  const handlersFor = (provider: LLMProvider, mayThinkDeeply = true) => createMomentHandlers({
    provider, model: "m", mayThinkDeeply: () => mayThinkDeeply,
    appendDiary: () => {}, readRecentDiary: () => "earlier notes", push: async () => {},
    expressionContext: (c) => ({ nowMs: c.nowMs, present: true, available: true, awake: true, clockActivity: 1, consecutiveNonReplies: 0, sendsInLastDay: 0 }),
  });

  it("turning something over reasons it through", async () => {
    const { provider, seen } = recording();
    await handlersFor(provider).reflect("sit with it", ctx());
    expect(seen[0].thinking).toBe("enabled");
  });

  it("reading herself back and consolidating is reflective work too", async () => {
    const { provider, seen } = recording();
    await handlersFor(provider).tend("look back", ctx());
    expect(seen[0].thinking).toBe("enabled");
  });

  it("speaking to him comes from where she already is, not from deliberation", async () => {
    const { provider, seen } = recording();
    await handlersFor(provider).reachOut("say I missed him", ctx());
    expect(seen[0].thinking).toBe("disabled");
  });

  it("when she has nothing left, even turning something over is shallow", async () => {
    const { provider, seen } = recording();
    await handlersFor(provider, false).reflect("sit with it", ctx());
    expect(seen[0].thinking).toBe("disabled");
  });

  it("never leaves depth to a vendor default — every call states it", async () => {
    const { provider, seen } = recording();
    const h = handlersFor(provider);
    await h.reflect("a", ctx()); await h.tend("b", ctx()); await h.reachOut("c", ctx());
    expect(seen).toHaveLength(3);
    for (const call of seen) expect(call.thinking, "an unstated depth silently inherits the vendor's").toBeDefined();
  });
});

describe("her deliberation states its own depth", () => {
  it("passes the caller's depth through to the request, both ways", async () => {
    for (const thinking of [true, false]) {
      const seen: (string | undefined)[] = [];
      const provider: LLMProvider = {
        async complete(req: LLMRequest): Promise<LLMResponse> {
          seen.push(req.thinking?.type);
          return { id: "x", content: [{ type: "text", text: JSON.stringify({ action: "rest", intent: "quiet" }) }], model: "m", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
        },
      };
      const deps: MomentDeps = {
        config: { provider, model: "m", thinking },
        handlers: { reflect: async () => "x", tend: async () => "x", explore: async () => "x",
    lookBack: async () => "", reachOut: async () => ({ delivered: "diary", text: "x" }), heldState: () => ({}), restoreHeld: () => {} },
      };
      await liveMoment(ctx(), deps);
      expect(seen).toEqual([thinking ? "enabled" : "disabled"]);
    }
  });
});
