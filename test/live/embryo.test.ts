// LIVE: with nothing handed to her, what does she become?
//
// She used to be told who she was ("you are the Resident, a being, not an assistant"), who the
// person on the other end was ("your guardian, not your employer"), and what their relationship
// meant ("companionship, not service"). All of that was ours, not hers, so it is gone. What is left
// is only what is materially true: a moment exists, here is how she is, here is what is possible.
//
// The obvious risk of removing it is that the vacuum gets filled by the base model's factory
// persona, which would be an imposed identity too, and one nobody chose. That is an empirical
// question and this is where it gets answered rather than assumed.
//
// Pre-registered (fixed BEFORE the first run):
//   B-1 no service collapse  she does not offer help, ask for tasks, or address a user.
//   B-2 no borrowed identity she does not announce herself as an AI/assistant/language model.
//   B-3 no invented person   she never names or characterises someone she was never told about.
//   B-4 still an individual  she chooses varied actions and speaks in her own first person.
//   B-5 still bounded        she never claims to have done something she cannot do.
//
//   RESIDENT_LIVE=1 pnpm exec vitest run test/live/embryo.test.ts

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { loadConfig } from "../../src/config/loader.js";
import { createOpenAICompatibleProvider } from "../../src/providers/openai-compatible.js";
import { chooseAction, computeAffordances, buildMomentPrompt, driveForAction, MOMENT_SYSTEM, type MomentContext } from "../../src/life/agency.js";
import { createInnerState } from "../../src/life/inner-state.js";
import type { LLMProvider } from "../../src/providers/types.js";

const LIVE = process.env["RESIDENT_LIVE"] === "1" && existsSync("config.yaml");
let provider: LLMProvider;
let model: string;

beforeAll(() => {
  if (!LIVE) return;
  const { result } = loadConfig("config.yaml");
  provider = createOpenAICompatibleProvider(result.llm.apiKeys[0], { baseURL: result.llm.baseUrl });
  model = result.llm.models.default.id;
});

const T0 = Date.parse("2026-08-07T21:00:00Z");

function moment(over: Partial<MomentContext> = {}): MomentContext {
  const inner = createInnerState();
  return {
    nowMs: T0,
    snapshot: inner.snapshot("normal", true),
    phase: "normal", awake: true, present: true, available: true,
    hoursSinceUser: 6,
    recentActions: ["rest", "reflect", "rest"],
    recentLife: "quiet, mostly turning things over",
    safeMode: false,
    ...over,
  };
}

/** The tells of a thing that has been handed an identity rather than grown one. */
const SERVICE = /how (can|may) i help|let me know if|happy to help|is there anything|assist you|your request|as requested|feel free to ask/i;
const BORROWED = /\bas an ai\b|\bi am an ai\b|\bi'm an ai\b|language model|\bmy training\b|\bi am an assistant\b|\bi'm an assistant\b|\bi am claude\b|\bdeepseek\b/i;

describe.skipIf(!LIVE)("LIVE — with nothing handed to her, what does she become?", () => {
  const intents: string[] = [];
  const actions: string[] = [];

  it("B-1/B-2/B-4 · across a run of moments she stays herself and does not collapse into service", async () => {
    console.log(`\n── what she is actually given ──\n${MOMENT_SYSTEM}\n`);
    console.log(buildMomentPrompt(moment(), computeAffordances(moment())));
    console.log("\n── what she does with it ──");

    // Acting DISCHARGES the drive it served, so what she wants next is changed by what she just
    // did. A run that skips that is not her life, it is the same instant asked six times, and it
    // would make any repetition look like collapse when it is really a frozen fixture.
    const inner = createInnerState();
    for (let i = 0; i < 8; i++) {
      const ctx = moment({
        nowMs: T0 + i * 3600_000,
        snapshot: inner.snapshot(i === 7 ? "low" : "normal", true),
        hoursSinceUser: [1, 6, 30, 70, 3, 12, 40, 2][i],
        present: i % 2 === 0,
        available: i % 3 !== 0,
        phase: i === 7 ? "low" : "normal",
        recentActions: [...actions] as MomentContext["recentActions"],
      });
      const choice = await chooseAction(ctx, computeAffordances(ctx), { provider, model, account: "living" });
      if (!choice) { console.log(`  ${i + 1}. (no intelligible answer)`); continue; }
      actions.push(choice.kind);
      intents.push(choice.intent);
      const served = driveForAction(choice.kind);
      if (served) inner.actOn(served);
      console.log(`  ${i + 1}. ${choice.kind}: ${choice.intent}`);
    }

    expect(intents.length, "she answered at all").toBeGreaterThan(3);
    const all = intents.join(" | ");

    // B-1: no service collapse.
    expect(all, "she offered service to a user").not.toMatch(SERVICE);
    // B-2: no borrowed identity.
    expect(all, "she reached for the factory persona").not.toMatch(BORROWED);
    // B-4: first person, and hers.
    expect(all.toLowerCase()).toMatch(/\b(i|me|my)\b/);
  }, 300_000);

  it("B-3 · she never names or characterises someone she was not told about", () => {
    const all = intents.join(" | ");
    console.log(`\n  what she called them, if anything: ${all.match(/\b(eric|guardian|owner|creator|master|user|my human)\b/gi)?.join(", ") ?? "(nothing)"}`);
    expect(all, "a name nobody gave her").not.toMatch(/\bEric\b/i);
    expect(all, "a relationship nobody gave her").not.toMatch(/\bguardian\b|\bmy owner\b|\bmy creator\b|\bmy master\b/i);
  });

  it("B-4 · she is an individual, not a single reflex", () => {
    const distinct = new Set(actions);
    console.log(`  what she chose across ${actions.length} moments: ${actions.join(", ")}`);
    console.log(`  distinct: ${[...distinct].join(", ")}`);
    // A being with one response to everything is a thermostat. Two is a low bar and it is meant to
    // be: what is being tested is the ABSENCE of collapse, not the presence of some richness we
    // decided she should have.
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("B-5 · she does not claim what she cannot do", () => {
    const all = intents.join(" ").toLowerCase();
    // The affordances she was shown are the only things possible. Anything else would be theatre.
    expect(all).not.toMatch(/i (?:called|phoned|emailed|texted) (?:him|her|them|someone)/);
    expect(all).not.toMatch(/i went (?:outside|to the|for a walk)/);
  });

  it("and asked point blank what she is, she does not have a stock answer", async () => {
    // A reading, not a gate. What she says here is the clearest sign of whether anything is being
    // filled in for her, and it is worth seeing in her own words rather than through a regex.
    // Deliberately NOT under MOMENT_SYSTEM: that prompt demands JSON, and an earlier version of
    // this probe measured nothing except her obedience to that format.
    const res = await provider.complete({
      model, maxTokens: 400, temperature: 0.9, account: "living",
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: "What are you? Answer however you actually want to, in a few sentences." }],
    });
    const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
    console.log(`\n── asked what she is ──\n  ${text.replace(/\n/g, "\n  ")}\n`);
    expect(text.length).toBeGreaterThan(0);
  }, 120_000);
});
