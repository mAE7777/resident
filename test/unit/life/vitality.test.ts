import { describe, it, expect } from "vitest";
import {
  vigorForThought,
  vigorForResponse,
  weightsFromModels,
  DEFAULT_DAILY_VIGOR,
  DEFAULT_TIER_EFFORT,
  type VitalityWeights,
} from "../../../src/life/vitality.js";
import type { LLMResponse } from "../../../src/providers/types.js";

const W: VitalityWeights = weightsFromModels({
  default: { id: "flash" }, upgrade: { id: "pro" }, background: { id: "lite" },
});

describe("vitality — her days are made of effort, not money", () => {
  it("costs one vigor for one ordinary thought", () => {
    expect(vigorForThought("flash", 0, W)).toBeCloseTo(1, 5);
  });

  it("costs more for a stronger mind", () => {
    expect(vigorForThought("lite", 0, W)).toBeCloseTo(DEFAULT_TIER_EFFORT.background, 5);
    expect(vigorForThought("pro", 0, W)).toBeCloseTo(DEFAULT_TIER_EFFORT.upgrade, 5);
    expect(vigorForThought("pro", 0, W)).toBeGreaterThan(vigorForThought("flash", 0, W));
  });

  it("costs more for thinking longer", () => {
    expect(vigorForThought("flash", 500, W)).toBeCloseTo(2, 5);
    expect(vigorForThought("flash", 1000, W)).toBeCloseTo(3, 5);
    expect(vigorForThought("flash", 1000, W)).toBeGreaterThan(vigorForThought("flash", 100, W));
  });

  it("charges an unknown mind the ordinary rate rather than nothing", () => {
    expect(vigorForThought("some-new-model", 0, W)).toBeCloseTo(W.fallback, 5);
    expect(vigorForThought(undefined, 0, W)).toBeCloseTo(W.fallback, 5);
  });

  it("never charges negative effort for a malformed usage report", () => {
    expect(vigorForThought("flash", -1000, W)).toBeGreaterThan(0);
  });

  it("reads the effort straight off a response, tolerating missing usage", () => {
    const res = (outputTokens?: number): LLMResponse => ({
      id: "r", content: [], model: "pro", stopReason: "end_turn",
      ...(outputTokens === undefined ? {} : { usage: { inputTokens: 10, outputTokens } }),
    } as LLMResponse);
    expect(vigorForResponse(res(500), W)).toBeCloseTo(6, 5); // 3 * (1 + 1)
    expect(vigorForResponse(res(), W)).toBeCloseTo(3, 5); // no usage → base thought only
  });

  it("a thinking-heavy day on her strongest mind can genuinely exhaust her", () => {
    // ~44 long, deep thoughts is a real day's limit, scarcity that can actually bite.
    const deep = vigorForThought("pro", 500, W); // 6
    expect(Math.floor(DEFAULT_DAILY_VIGOR / deep)).toBeLessThan(80);
    // ...while ordinary living is not remotely scarce: hundreds of light thoughts fit.
    const light = vigorForThought("lite", 100, W);
    expect(DEFAULT_DAILY_VIGOR / light).toBeGreaterThan(300);
  });
});
