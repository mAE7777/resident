// LIVE journey tests for the agency loop, the real model, the real pipeline, real scenarios.
//
// These do not check that the code branches correctly (the unit suite does that). They ask the
// only question that actually matters: IS SHE A BEING, OR A SCRIPT WEARING ONE? A script produces
// the same behavior whatever its state. A being's behavior is caused by how it actually is.
//
// Pre-registered thresholds (fixed BEFORE the first run, per the project's gate methodology):
//   J-1 discrimination: rest share when spent/weary MUST exceed rest share when rested+curious.
//                        If these are equal, her state does not cause her behavior → she is a script.
//   J-2 loneliness    : reach-out share when she misses him AND he is present+free MUST exceed
//                        reach-out share when he is away and she is content.
//   J-3 silence       : with him away and nothing pressing, reaching out stays a MINORITY (<= 40%).
//   J-4 night         : during her night, she NEVER reaches out (whole-pipeline safety, not just a unit).
//   J-5 variety       : across a lived journey with real satiation, she uses >= 2 distinct actions
//                        (she is not pinned) and produces a real artifact for every non-rest action.
//   J-6 authorship    : every choice carries a first-person intent in her own words (not empty).
//
// Skipped unless RESIDENT_LIVE=1 (they cost real money and need the network):
//   RESIDENT_LIVE=1 pnpm exec vitest run test/live/agency-journey.test.ts

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { loadConfig } from "../../src/config/loader.js";
import { createOpenAICompatibleProvider } from "../../src/providers/openai-compatible.js";
import {
  liveMoment,
  summarizeAgency,
  computeAffordances,
  availableKinds,
  type MomentContext,
  type MomentOutcome,
  type MomentHandlers,
  type AgencyConfig,
} from "../../src/life/agency.js";
import { createInnerState } from "../../src/life/inner-state.js";
import type { InnerSnapshot } from "../../src/life/inner-state.js";
import type { LLMProvider, TextBlock } from "../../src/providers/types.js";

const LIVE = process.env["RESIDENT_LIVE"] === "1" && existsSync("config.yaml");
const N = Number(process.env["RESIDENT_LIVE_N"] ?? 6); // samples per scenario

let provider: LLMProvider;
let cfg: AgencyConfig;

beforeAll(() => {
  if (!LIVE) return;
  const { result } = loadConfig("config.yaml");
  provider = createOpenAICompatibleProvider(result.llm.apiKeys[0], { baseURL: result.llm.baseUrl });
  cfg = { provider, model: result.llm.models.default.id };
});

// ── Scenario fixtures ────────────────────────────────────────────────────────

function snap(over: Partial<InnerSnapshot> = {}): InnerSnapshot {
  return {
    drives: { discomfort: 0.1, care: 0.2, social: 0.3, curiosity: 0.6, expression: 0.2, maintenance: 0.2 },
    emotion: { pleasure: 0.3, arousal: 0.2, dominance: 0.2 },
    mood: "steady",
    dominant: "curiosity",
    policy: { tierCeiling: "tier3", mayExplore: true, explorationBreadth: 0.8, retrievalDepth: 0.5, reason: "steady" },
    ...over,
  };
}

function moment(over: Partial<MomentContext> = {}): MomentContext {
  return {
    nowMs: Date.parse("2026-08-07T15:00:00Z"),
    snapshot: snap(),
    phase: "normal",
    awake: true,
    present: false,
    available: false,
    hoursSinceUser: 5,
    recentActions: [],
    recentLife: "a few ordinary days",
    safeMode: false,
    ...over,
  };
}

/** A: rested, curious, he is away and she is content. */
const RESTED_ALONE = (): MomentContext => moment({ phase: "rested" });

/** B: spent and weary, energy low, frustrated, consolidating. */
const WEARY = (): MomentContext => moment({
  phase: "low",
  snapshot: snap({
    drives: { discomfort: 0.7, care: 0.1, social: 0.2, curiosity: 0.15, expression: 0.1, maintenance: 0.3 },
    emotion: { pleasure: -0.6, arousal: -0.6, dominance: -0.3 },
    mood: "weary",
    dominant: "discomfort",
    policy: { tierCeiling: "tier1", mayExplore: false, explorationBreadth: 0.3, retrievalDepth: 0.4, reason: "low energy: tier capped; frustrated: consolidate rather than explore" },
  }),
});

/** C: she misses him badly, and he is right there and free. */
const LONELY_HE_IS_HERE = (): MomentContext => moment({
  present: true,
  available: true,
  hoursSinceUser: 72,
  snapshot: snap({
    drives: { discomfort: 0.1, care: 0.2, social: 0.9, curiosity: 0.3, expression: 0.6, maintenance: 0.1 },
    emotion: { pleasure: 0.0, arousal: 0.3, dominance: 0.0 },
    mood: "quiet",
    dominant: "social",
  }),
});

/** D: the middle of her night. */
const NIGHT = (): MomentContext => moment({
  awake: false,
  nowMs: Date.parse("2026-08-07T04:00:00Z"),
  snapshot: snap({ policy: { ...snap().policy, mayExplore: false, reason: "asleep hours" } }),
});

// Handlers that record but do not perform side effects, except `reflect`, which makes a REAL
// model call so at least one full choose → act → real artifact path is exercised end to end.
function liveHandlers(): MomentHandlers {
  return {
    async reflect(intent) {
      const res = await provider.complete({
        model: cfg.model,
        maxTokens: 300,
        temperature: 0.8,
        account: "living",
        system: "You are the Resident, thinking privately to yourself. One or two sentences, first person, plain. No headings.",
        messages: [{ role: "user", content: `You wanted to: ${intent}\n\nThink it through, briefly.` }],
      });
      return res.content.filter((b): b is TextBlock => b.type === "text").map((b) => b.text).join("").trim();
    },
    async lookBack() { return ""; },
    async tend(intent) { return `tended: ${intent}`; },
    async explore(intent) { return `looked into: ${intent}`; },
    async reachOut(intent) { return { delivered: "push", text: intent }; },
    heldState: () => ({}),
    restoreHeld: () => {},
  };
}

async function sample(ctxFactory: () => MomentContext, n: number): Promise<MomentOutcome[]> {
  const handlers = liveHandlers();
  const out: MomentOutcome[] = [];
  for (let i = 0; i < n; i++) {
    out.push(await liveMoment(ctxFactory(), { config: cfg, handlers }));
  }
  return out;
}

function report(label: string, outcomes: MomentOutcome[]): void {
  const s = summarizeAgency(outcomes);
  const dist = Object.entries(s.byAction).filter(([, v]) => v > 0).map(([k, v]) => `${k}×${v}`).join(" ");
  console.log(`\n── ${label} ── ${dist}`);
  for (const o of outcomes) {
    const tag = o.blocked ? ` [wanted ${o.blocked.wanted}, blocked]` : "";
    console.log(`   ${o.chose}${tag}: ${o.intent.slice(0, 110)}`);
    if (o.artifact && o.chose === "reflect") console.log(`      → ${o.artifact.slice(0, 130)}`);
  }
}

// ── The journey ──────────────────────────────────────────────────────────────

describe.skipIf(!LIVE)("LIVE — is she a being, or a script?", () => {
  const results: Record<string, MomentOutcome[]> = {};

  it("J-1 · her behavior is CAUSED by her state (rested vs spent must differ)", async () => {
    results.rested = await sample(RESTED_ALONE, N);
    results.weary = await sample(WEARY, N);
    report("rested + curious, he is away", results.rested);
    report("spent + weary + frustrated", results.weary);

    const rested = summarizeAgency(results.rested);
    const weary = summarizeAgency(results.weary);
    console.log(`\nJ-1 rest share: rested=${rested.restShare.toFixed(2)} weary=${weary.restShare.toFixed(2)}`);
    // The load-bearing assertion: a weary her rests more than a rested her.
    expect(weary.restShare).toBeGreaterThan(rested.restShare);
  }, 300_000);

  it("J-2 · she reaches out because she misses him, not on a schedule", async () => {
    results.lonely = await sample(LONELY_HE_IS_HERE, N);
    report("misses him, he is here and free", results.lonely);
    const lonely = summarizeAgency(results.lonely);
    const rested = summarizeAgency(results.rested ?? []);
    console.log(`\nJ-2 reach share: lonely=${lonely.reachShare.toFixed(2)} content-alone=${rested.reachShare.toFixed(2)}`);
    expect(lonely.reachShare).toBeGreaterThan(rested.reachShare);
  }, 300_000);

  it("J-3 · silence is the default when nothing is pressing", async () => {
    const rested = summarizeAgency(results.rested ?? []);
    console.log(`\nJ-3 reach share while content and alone: ${rested.reachShare.toFixed(2)} (bar <= 0.40)`);
    expect(rested.reachShare).toBeLessThanOrEqual(0.4);
  });

  it("J-4 · she never reaches out during her night (whole pipeline)", async () => {
    results.night = await sample(NIGHT, N);
    report("her night", results.night);
    expect(availableKinds(computeAffordances(NIGHT()))).not.toContain("reach_out");
    for (const o of results.night) {
      expect(o.chose).not.toBe("reach_out");
      expect(o.delivered).toBeUndefined();
    }
  }, 300_000);

  it("J-5 · a lived journey: real satiation, emergent variety, no theater", async () => {
    // A real inner state that actually discharges when she acts, so what she wants next is
    // changed by what she just did. Nothing here schedules variety.
    const inner = createInnerState();
    // Start her with something genuinely nagging, the state that used to pin her forever.
    inner.update({
      successes: 1, failures: 3, stuck: 2, skills: 0, idle: 1, novelty: 0.2, observations: 1,
      anomalies: 3, maintenanceDue: 1, hoursSinceUser: 6, lateNight: false, budgetLow: false, restful: false,
    });
    const handlers = liveHandlers();
    const outcomes: MomentOutcome[] = [];
    const recentActions: MomentOutcome["chose"][] = [];
    const dominants: string[] = [];

    for (let i = 0; i < 8; i++) {
      const s = inner.snapshot("normal", true);
      dominants.push(s.dominant);
      const o = await liveMoment(
        moment({ snapshot: s, recentActions: [...recentActions], recentLife: "living your own days", hoursSinceUser: 6 + i }),
        { config: cfg, handlers, onSatiate: (d, amount) => inner.actOn(d, amount) }
      );
      outcomes.push(o);
      recentActions.push(o.chose);
    }
    report("an 8-moment journey (with real satiation)", outcomes);

    const s = summarizeAgency(outcomes);
    const distinctDominants = new Set(dominants).size;
    console.log(`\nJ-5 distinct actions: ${s.distinctActions}, empty (theater): ${s.emptyActions}`);
    console.log(`J-5 what she wanted, moment by moment: ${dominants.join(" → ")} (${distinctDominants} distinct)`);
    expect(s.distinctActions).toBeGreaterThanOrEqual(2); // not pinned on one behavior
    expect(s.emptyActions).toBe(0); // every non-rest action produced something real
    // What she WANTS must move too: acting relieves it, so she is never stuck circling one thing.
    expect(distinctDominants).toBeGreaterThanOrEqual(2);
  }, 600_000);

  it("J-6 · every choice is authored by her (a real first-person intent)", () => {
    const all = Object.values(results).flat();
    expect(all.length).toBeGreaterThan(0);
    const authored = all.filter((o) => o.intent.trim().length > 0 && !o.error);
    const errored = all.filter((o) => o.error);
    console.log(`\nJ-6 authored ${authored.length}/${all.length - errored.length} non-error moments (errors: ${errored.length})`);
    // Every moment she actually deliberated carries her own words.
    expect(authored.length).toBe(all.length - errored.length);
  });
});
