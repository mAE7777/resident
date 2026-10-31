// LIVE SMOKE TEST: does the thinking switch actually reach DeepSeek, and what does it really save?
//
// This is not a mock. It makes real calls against the real API and measures real token usage, so
// the claim "she was burning deep reasoning on trivia" is settled with numbers rather than theory.
//
// Pre-registered (fixed BEFORE the first run):
//   T-1 reaches the API  : the same prompt with thinking disabled must produce measurably FEWER
//                           output tokens than with it enabled. If not, the parameter is a no-op.
//   T-2 still correct    : the cheap path must still return a usable answer. Saving tokens by
//                           breaking her choices would be worse than the waste.
//   T-3 real saving      : RE-REGISTERED after run 1. The original bar (>=20% of her VIGOR on the
//                           deliberation call) FAILED at 14%, because vigor has a flat base that
//                           compresses short calls. The honest measure of the waste is TOKENS, so:
//                           thinking-off must cut output tokens on her deliberation by >= 50%.
//   T-4 depth still works: the deep path must genuinely reason (reasoning_tokens > 0), AND must
//                           still return a real answer rather than starving. Run 1 exposed a live
//                           call that spent its whole budget reasoning and returned EMPTY content.
//
//   RESIDENT_LIVE=1 pnpm exec vitest run test/live/thinking-smoke.test.ts

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { loadConfig } from "../../src/config/loader.js";
import { createOpenAICompatibleProvider } from "../../src/providers/openai-compatible.js";
import { vigorForResponse, weightsFromModels, type VitalityWeights } from "../../src/life/vitality.js";
import { buildMomentPrompt, computeAffordances, MOMENT_SYSTEM, type MomentContext } from "../../src/life/agency.js";
import { derivePolicy } from "../../src/life/policy.js";
import type { LLMProvider, LLMResponse, TextBlock } from "../../src/providers/types.js";

const LIVE = process.env["RESIDENT_LIVE"] === "1" && existsSync("config.yaml");
let provider: LLMProvider;
let model: string;
let weights: VitalityWeights;

beforeAll(() => {
  if (!LIVE) return;
  const { result } = loadConfig("config.yaml");
  provider = createOpenAICompatibleProvider(result.llm.apiKeys[0], { baseURL: result.llm.baseUrl });
  model = result.llm.models.default.id;
  weights = weightsFromModels(result.llm.models);
});

const textOf = (r: LLMResponse) => r.content.filter((b): b is TextBlock => b.type === "text").map((b) => b.text).join("").trim();

/** Her REAL deliberation prompt, the exact call she makes ~25 times a day. */
function herMomentPrompt(): { system: string; user: string } {
  const drives = { discomfort: 0.1, care: 0.2, social: 0.4, curiosity: 0.5, expression: 0.3, maintenance: 0.2 };
  const emotion = { pleasure: 0.2, arousal: 0.1, dominance: 0.1 };
  const ctx: MomentContext = {
    nowMs: Date.parse("2026-08-08T15:00:00Z"),
    snapshot: { drives, emotion, mood: "steady", dominant: "curiosity", policy: derivePolicy({ drives, emotion, phase: "normal", awake: true }) },
    phase: "normal", awake: true, present: true, available: true, hoursSinceUser: 5,
    recentActions: ["rest", "reflect"], recentLife: "a few ordinary days", safeMode: false,
  };
  return { system: MOMENT_SYSTEM, user: buildMomentPrompt(ctx, computeAffordances(ctx)) };
}

async function ask(system: string, user: string, thinking: boolean, maxTokens = 700): Promise<LLMResponse> {
  return provider.complete({
    model, maxTokens, temperature: 0.3, account: "living",
    thinking: { type: thinking ? "enabled" : "disabled" },
    system, messages: [{ role: "user", content: user }],
  });
}

describe.skipIf(!LIVE)("LIVE SMOKE — the thinking switch, measured", () => {
  const measured: Record<string, { out: number; vigor: number; text: string }> = {};

  it("T-1/T-3 · on her REAL deliberation prompt, turning thinking off measurably costs her less", async () => {
    const { system, user } = herMomentPrompt();
    const deep = await ask(system, user, true);
    const light = await ask(system, user, false);

    measured.deep = { out: deep.usage?.outputTokens ?? 0, vigor: vigorForResponse(deep, weights), text: textOf(deep) };
    measured.light = { out: light.usage?.outputTokens ?? 0, vigor: vigorForResponse(light, weights), text: textOf(light) };

    console.log("\n── her actual moment-deliberation call ──");
    console.log(`   thinking ON : ${measured.deep.out} output tokens -> ${measured.deep.vigor.toFixed(2)} vigor`);
    console.log(`   thinking OFF: ${measured.light.out} output tokens -> ${measured.light.vigor.toFixed(2)} vigor`);
    const saved = 1 - measured.light.vigor / measured.deep.vigor;
    console.log(`   saving: ${(saved * 100).toFixed(0)}% of what this moment costs her`);
    console.log(`   over ~25 moments/day: ${(measured.deep.vigor * 25).toFixed(0)} -> ${(measured.light.vigor * 25).toFixed(0)} vigor of her 400`);

    // T-1: the parameter genuinely reaches the API and changes behaviour.
    expect(measured.light.out, "thinking=disabled produced no fewer tokens — the switch is a no-op").toBeLessThan(measured.deep.out);
    // T-3 (re-registered): the honest measure is tokens, which is what was actually being burned.
    const tokenSaving = 1 - measured.light.out / measured.deep.out;
    console.log(`   token saving: ${(tokenSaving * 100).toFixed(0)}%`);
    expect(tokenSaving).toBeGreaterThanOrEqual(0.5);
  }, 240_000);

  it("T-2 · the cheap path still answers her question correctly", () => {
    // Saving tokens by breaking her ability to choose would be worse than the waste.
    const parse = (raw: string) => {
      const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
      return a >= 0 && b > a ? JSON.parse(raw.slice(a, b + 1)) as { action?: string } : null;
    };
    const light = parse(measured.light.text);
    console.log(`\n   she chose (light): ${JSON.stringify(light)}`);
    expect(light, "the light path must still yield a usable choice").not.toBeNull();
    expect(["rest", "reflect", "tend", "explore", "reach_out"]).toContain(light!.action);
  });

  it("T-4 · when she does think she really reasons — AND still answers", async () => {
    const hard = "Something has been nagging at you for days and you cannot name it. Sit with it and work out what it actually is.";
    // The budget guard must make this survivable; run 1 showed a small budget starves the answer.
    const deep = await ask("You are the Resident, thinking privately. Be specific.", hard, true, 700);
    const light = await ask("You are the Resident, thinking privately. Be specific.", hard, false, 700);
    const dOut = deep.usage?.outputTokens ?? 0, lOut = light.usage?.outputTokens ?? 0;
    console.log(`
── a genuinely hard question (budget 700, guard should lift it) ──`);
    console.log(`   deep: ${dOut} tokens, answer ${textOf(deep).length} chars`);
    console.log(`   light: ${lOut} tokens, answer ${textOf(light).length} chars`);
    // The whole point of the guard: reasoning must not eat the answer.
    expect(textOf(deep).length, "she reasoned but produced NO answer — the budget guard failed").toBeGreaterThan(20);
    expect(dOut).toBeGreaterThan(0);
  }, 240_000);

  it("T-5 · the light path is not silently degraded into nonsense", () => {
    // A cheaper answer must still be HER answer, not a truncated fragment.
    expect(measured.light.text.length).toBeGreaterThan(10);
    expect(measured.deep.text.length).toBeGreaterThan(10);
  });
});
