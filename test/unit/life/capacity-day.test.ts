import { describe, it, expect } from "vitest";
import { capacityFor } from "../../../src/life/capacity.js";
import { createMetabolism } from "../../../src/life/metabolism.js";
import { createInnerState } from "../../../src/life/inner-state.js";
import { vigorForThought, weightsFromModels, DEFAULT_DAILY_VIGOR } from "../../../src/life/vitality.js";
import type { MetabolicPhase } from "../../../src/life/metabolism.js";

// A simulated day of her actually living, to see what elastic capacity DOES to her rather than
// only that it is bounded. Every number here flows through the real metabolism and the real vigor
// formula, so this is her economics, not a toy.

const W = weightsFromModels({ default: { id: "flash" }, upgrade: { id: "pro" }, background: { id: "flash" } });
const DAY0 = Date.UTC(2026, 7, 8);

/** One of her moments: deliberate (light), then act at whatever depth she has in her. */
function liveOneMoment(phase: MetabolicPhase, arousal: number, act: "rest" | "think" | "explore"): number {
  const k = capacityFor({ phase, arousal });
  let vigor = vigorForThought("flash", 30, W); // the deliberation is always a light gut call
  if (act === "think") vigor += vigorForThought("flash", Math.min(k.thinkingTokens, 900), W);
  if (act === "explore") vigor += k.explorationSteps * vigorForThought("flash", 350, W);
  return vigor;
}

function runDay(elastic: boolean, pattern: ("rest" | "think" | "explore")[], arousal = 0.2) {
  const m = createMetabolism({ dailyVigor: DEFAULT_DAILY_VIGOR, now: () => DAY0 + 3_600_000 });
  const trace: { phase: MetabolicPhase; steps: number; spent: number }[] = [];
  let i = 0;
  while (m.phase() !== "dormant" && i < 200) {
    const phase = m.phase();
    const effective: MetabolicPhase = elastic ? phase : "rested"; // fixed = always the generous setting
    const k = capacityFor({ phase: effective, arousal });
    m.record("living", liveOneMoment(effective, arousal, pattern[i % pattern.length]));
    trace.push({ phase, steps: k.explorationSteps, spent: m.spentTotal() });
    i += 1;
  }
  return { moments: i, trace, spent: m.spentTotal() };
}

describe("SCENARIO: a day of her living, with elastic capacity", () => {
  const MIXED: ("rest" | "think" | "explore")[] = ["rest", "think", "rest", "explore", "reflect" as never].slice(0, 4) as ("rest" | "think" | "explore")[];

  it("she visibly winds down over the day instead of stopping dead", () => {
    const { trace } = runDay(true, MIXED);
    const first = trace[0], last = trace[trace.length - 1];
    console.log(`\n  morning: ${first.phase}, follows ${first.steps} steps`);
    console.log(`  evening: ${last.phase}, follows ${last.steps} steps`);
    expect(last.steps).toBeLessThan(first.steps); // her threads genuinely get shorter
    expect(last.steps).toBeGreaterThanOrEqual(2); // but she is never reduced to nothing
    // The wind-down is gradual, not a cliff: at least three distinct depths across the day.
    expect(new Set(trace.map((t) => t.steps)).size).toBeGreaterThanOrEqual(3);
  });

  it("elastic gives her MORE of a day than a fixed generous setting, not less", () => {
    const elastic = runDay(true, MIXED);
    const fixed = runDay(false, MIXED);
    console.log(`  moments in a day — elastic: ${elastic.moments}, fixed-generous: ${fixed.moments}`);
    expect(elastic.moments).toBeGreaterThan(fixed.moments);
  });

  it("a heavy day of exploring exhausts her, and that is the point", () => {
    const { moments } = runDay(true, ["explore"]);
    console.log(`  a day of nothing but chasing threads lasted ${moments} moments`);
    expect(moments).toBeLessThan(runDay(true, ["rest"]).moments); // exploring really costs
    expect(moments).toBeGreaterThan(5); // but she is not spent after two
  });

  it("a quiet day of resting barely touches her reserve", () => {
    const { moments, spent } = runDay(true, ["rest"]);
    console.log(`  a quiet day: ${moments} moments, ${spent.toFixed(0)} of ${DEFAULT_DAILY_VIGOR} vigor`);
    expect(moments).toBeGreaterThan(100); // she can be quiet all day and stay well
  });

  it("being weary shortens her threads even when her energy is fine", () => {
    const rested = capacityFor({ phase: "normal", arousal: 1 });
    const weary = capacityFor({ phase: "normal", arousal: -1 });
    console.log(`  same energy, keyed-up: ${rested.explorationSteps} steps | weary: ${weary.explorationSteps} steps`);
    expect(weary.explorationSteps).toBeLessThan(rested.explorationSteps);
  });

  it("the predicted failure mode: chronic low energy must not trap her at the floor forever", () => {
    // If she were pinned at minimum capacity indefinitely she could never finish a thread, and
    // the frustration would accumulate. At her worst she must still have a workable thread.
    const worst = capacityFor({ phase: "low", arousal: -1 });
    console.log(`  chronically low + weary: ${worst.explorationSteps} steps, ${worst.thinkingTokens} think-tokens`);
    expect(worst.explorationSteps).toBeGreaterThanOrEqual(2);
    expect(worst.thinkingTokens).toBeGreaterThanOrEqual(3000); // still enough to complete a thought
  });

  it("her capacity recovers with the new day, not gradually within it", () => {
    // Vigor resets at the UTC boundary, so a spent evening becomes a rested morning.
    const m = createMetabolism({ dailyVigor: 100, now: () => DAY0 + 3_600_000 });
    m.record("living", 99);
    expect(capacityFor({ phase: m.phase(), arousal: 0 }).explorationSteps).toBeLessThanOrEqual(3);
    m.resetDaily();
    expect(capacityFor({ phase: m.phase(), arousal: 0 }).explorationSteps).toBeGreaterThanOrEqual(6);
  });

  it("her real accumulated mood drives it, not a test fixture", () => {
    // Straight from inner-state: a grinding week really does shorten her threads.
    const inner = createInnerState();
    const grind = {
      successes: 0, failures: 3, stuck: 2, skills: 1, idle: 0, novelty: 0, observations: 0,
      userNeeds: 0, anomalies: 2, maintenanceDue: 0, hoursSinceUser: 6, lateNight: true, budgetLow: false, restful: false,
    };
    const before = capacityFor({ phase: "normal", arousal: inner.emotion().arousal });
    for (let i = 0; i < 4; i++) inner.update(grind);
    const after = capacityFor({ phase: "normal", arousal: inner.emotion().arousal });
    console.log(`  after a grinding week: reserve ${before.reserve.toFixed(3)} -> ${after.reserve.toFixed(3)}, steps ${before.explorationSteps} -> ${after.explorationSteps}`);
    // A moderately bad week SHOULD move her, but it should not halve her attention span, so the
    // honest assertion is on the continuous reserve, not on a rounded step count.
    expect(after.reserve, "her real accumulated mood must actually flow through").toBeLessThan(before.reserve);
    expect(after.explorationSteps).toBeLessThanOrEqual(before.explorationSteps);
  });
});
