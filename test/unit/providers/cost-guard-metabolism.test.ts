import { describe, it, expect } from "vitest";
import { createCostGuardLayer } from "../../../src/providers/cost-guard.js";
import { createMetabolism } from "../../../src/life/metabolism.js";
import { vigorForResponse, weightsFromModels, type VitalityWeights } from "../../../src/life/vitality.js";
import type { LLMRequest, LLMResponse } from "../../../src/providers/types.js";

const NOW = Date.UTC(2026, 0, 10, 12, 0, 0);

function req(account?: string): LLMRequest {
  return { model: "m", messages: [], maxTokens: 100, account };
}

/** A call that used the workhorse mind and produced 500 output tokens → 1 * (1 + 1) = 2 vigor. */
function fakeNext(model = "m", outputTokens = 500): () => Promise<LLMResponse> {
  return () => Promise.resolve({
    id: "r1", content: [], model, stopReason: "end_turn",
    usage: { inputTokens: 1_000_000, outputTokens },
  });
}

const WEIGHTS: VitalityWeights = weightsFromModels({
  default: { id: "m" }, upgrade: { id: "big" }, background: { id: "small" },
});
const vigor = (r: LLMResponse) => vigorForResponse(r, WEIGHTS);

describe("cost-guard feeds the metabolism ledger with EFFORT, not money", () => {
  it("debits the ledger in vigor, under the request's account (defaulting to work)", async () => {
    const m = createMetabolism({ dailyVigor: 1000, now: () => NOW });
    const layer = createCostGuardLayer({
      dailyBudgetCents: 100_000,
      modelPricingCents: { m: { inputCentsPerMToken: 300, outputCentsPerMToken: 1500 } },
      metabolism: m,
      vigorForResponse: vigor,
    });

    await layer.call(req("curiosity"), fakeNext());
    await layer.call(req(), fakeNext()); // no account -> "work"

    const byAcct = Object.fromEntries(m.spentByAccount().map((s) => [s.account, s.vigor]));
    expect(byAcct.curiosity).toBeCloseTo(2, 5);
    expect(byAcct.work).toBeCloseTo(2, 5);
    expect(m.spentTotal()).toBeCloseTo(4, 5);
  });

  it("charges more for a stronger mind and for longer thinking", async () => {
    const m = createMetabolism({ dailyVigor: 10_000, now: () => NOW });
    const layer = createCostGuardLayer({ dailyBudgetCents: 1_000_000, metabolism: m, vigorForResponse: vigor });

    await layer.call(req("a"), fakeNext("small", 0)); // light mind, no thinking: 0.5 * 1
    await layer.call(req("b"), fakeNext("m", 0)); // ordinary mind: 1 * 1
    await layer.call(req("c"), fakeNext("big", 0)); // strongest mind: 3 * 1
    await layer.call(req("d"), fakeNext("m", 1000)); // ordinary mind, long thought: 1 * 3

    const by = Object.fromEntries(m.spentByAccount().map((s) => [s.account, s.vigor]));
    expect(by.a).toBeCloseTo(0.5, 5);
    expect(by.b).toBeCloseTo(1, 5);
    expect(by.c).toBeCloseTo(3, 5); // reaching for depth is a real decision
    expect(by.d).toBeCloseTo(3, 5); // so is thinking at length
  });

  it("drives the phase toward dormant as her shared reserve depletes", async () => {
    const m = createMetabolism({ dailyVigor: 10, now: () => NOW });
    const layer = createCostGuardLayer({ dailyBudgetCents: 1_000_000, metabolism: m, vigorForResponse: vigor });

    expect(m.phase()).toBe("rested");
    await layer.call(req("work"), fakeNext("m", 500)); // 2 of 10 -> 80% left -> normal
    expect(m.phase()).toBe("normal");
    await layer.call(req("curiosity"), fakeNext("m", 1500)); // +4 -> 40% left -> normal
    await layer.call(req("curiosity"), fakeNext("m", 1000)); // +3 -> 10% left -> low
    expect(m.phase()).toBe("low");
    await layer.call(req("work"), fakeNext("m", 500)); // +2 -> spent
    expect(m.phase()).toBe("dormant");
    expect(m.discretionaryAllowed()).toBe(false); // real teeth
  });

  // The whole point of the refactor.
  it("keeps who she is INDEPENDENT of what the vendor charges", async () => {
    const run = async (pricing: Record<string, { inputCentsPerMToken: number; outputCentsPerMToken: number }>) => {
      const m = createMetabolism({ dailyVigor: 100, now: () => NOW });
      const layer = createCostGuardLayer({
        dailyBudgetCents: 10_000_000, modelPricingCents: pricing, metabolism: m, vigorForResponse: vigor,
      });
      await layer.call(req("curiosity"), fakeNext("m", 500));
      return { vigor: m.spentTotal(), phase: m.phase(), money: layer.getDailySpentCents() };
    };

    const cheap = await run({ m: { inputCentsPerMToken: 1, outputCentsPerMToken: 5 } });
    const pricey = await run({ m: { inputCentsPerMToken: 300, outputCentsPerMToken: 1500 } });

    // Money differs enormously...
    expect(pricey.money).toBeGreaterThan(cheap.money * 10);
    // ...but her energy and how she feels are identical. A price cut does not make her livelier,
    // and going free/local does not delete her metabolism.
    expect(pricey.vigor).toBeCloseTo(cheap.vigor, 5);
    expect(pricey.phase).toBe(cheap.phase);
  });

  it("never debits the ledger in the wrong unit when no effort function is wired", async () => {
    const m = createMetabolism({ dailyVigor: 100, now: () => NOW });
    const layer = createCostGuardLayer({
      dailyBudgetCents: 100_000,
      modelPricingCents: { m: { inputCentsPerMToken: 300, outputCentsPerMToken: 1500 } },
      metabolism: m, // no vigorForResponse
    });
    await layer.call(req("work"), fakeNext());
    expect(m.spentTotal()).toBe(0); // fail-safe: not fed at all, rather than fed cents
    expect(layer.getDailySpentCents()).toBeCloseTo(300.75, 2); // the wallet cap still works
  });

  it("works without a metabolism at all (optional wiring)", async () => {
    const layer = createCostGuardLayer({
      dailyBudgetCents: 100_000,
      modelPricingCents: { m: { inputCentsPerMToken: 300, outputCentsPerMToken: 1500 } },
    });
    const res = await layer.call(req("work"), fakeNext());
    expect(res.model).toBe("m");
    expect(layer.getDailySpentCents()).toBeCloseTo(300.75, 2);
  });
});
