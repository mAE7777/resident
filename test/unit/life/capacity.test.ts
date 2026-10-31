import { describe, it, expect } from "vitest";
import {
  capacityFor, reserveOf, formatCapacity,
  MIN_THINKING_BUDGET, MAX_THINKING_BUDGET, MIN_EXPLORATION_STEPS, MAX_EXPLORATION_STEPS,
  MIN_LOOKBACK_RECORDS, MAX_LOOKBACK_RECORDS, MIN_DIARY_WINDOW, MAX_DIARY_WINDOW,
  MIN_SPREAD_HOPS, MAX_SPREAD_HOPS, NARROWEST_THRESHOLD, WIDEST_THRESHOLD,
  type Condition, type Capacity,
} from "../../../src/life/capacity.js";
import type { MetabolicPhase } from "../../../src/life/metabolism.js";

const PHASES: MetabolicPhase[] = ["dormant", "low", "normal", "rested"];
const DIALS: (keyof Capacity)[] = ["thinkingTokens", "explorationSteps", "lookbackRecords", "diaryWindow", "spreadHops"];
const c = (phase: MetabolicPhase, arousal = 0): Condition => ({ phase, arousal });

describe("what she has in her, read off her condition", () => {
  it("gives her most when she is rested and keyed-up, least when spent and weary", () => {
    const best = capacityFor(c("rested", 1));
    const worst = capacityFor(c("dormant", -1));
    for (const d of DIALS) expect(best[d], d).toBeGreaterThan(worst[d]);
    expect(best.reserve).toBe(1);
    expect(worst.reserve).toBeLessThan(0.2);
  });

  // How far she can be reached runs the other way round: weary means a high bar, so only the
  // obvious arrives. More reserve is still more of her, which is what monotone means here.
  it("widens what can reach her as she has more in her, and narrows it as she tires", () => {
    const best = capacityFor(c("rested", 1));
    const worst = capacityFor(c("dormant", -1));
    expect(best.retrievalThreshold).toBeLessThan(worst.retrievalThreshold);
    expect(best.retrievalThreshold).toBeCloseTo(WIDEST_THRESHOLD, 5);
    expect(worst.retrievalThreshold).toBeLessThanOrEqual(NARROWEST_THRESHOLD);
    for (const phase of PHASES) {
      let prev = capacityFor(c(phase, -1)).retrievalThreshold;
      for (let a = -0.9; a <= 1.0001; a += 0.1) {
        const cur = capacityFor(c(phase, a)).retrievalThreshold;
        expect(cur, `${phase} @ ${a.toFixed(1)}`).toBeLessThanOrEqual(prev + 1e-9);
        prev = cur;
      }
    }
  });

  it("keeps how far she can associate inside its bounds in any condition", () => {
    for (const phase of PHASES) {
      for (const arousal of [-1, -0.5, 0, 0.5, 1]) {
        const cap = capacityFor(c(phase, arousal));
        expect(cap.spreadHops).toBeGreaterThanOrEqual(MIN_SPREAD_HOPS);
        expect(cap.spreadHops).toBeLessThanOrEqual(MAX_SPREAD_HOPS);
        expect(cap.retrievalThreshold).toBeGreaterThanOrEqual(WIDEST_THRESHOLD);
        expect(cap.retrievalThreshold).toBeLessThanOrEqual(NARROWEST_THRESHOLD);
      }
    }
  });

  // MONOTONE: the property that makes plasticity verifiable rather than drift.
  it("is monotone in energy — more left never means less capacity", () => {
    for (let i = 1; i < PHASES.length; i++) {
      const lower = capacityFor(c(PHASES[i - 1])), higher = capacityFor(c(PHASES[i]));
      for (const d of DIALS) expect(higher[d], `${PHASES[i]} vs ${PHASES[i - 1]} / ${d}`).toBeGreaterThanOrEqual(lower[d]);
    }
  });

  it("is monotone in stamina, across the whole arousal range", () => {
    for (const phase of PHASES) {
      let prev = capacityFor(c(phase, -1));
      for (let a = -0.9; a <= 1.0001; a += 0.1) {
        const cur = capacityFor(c(phase, a));
        for (const d of DIALS) expect(cur[d], `${phase} @ ${a.toFixed(1)} / ${d}`).toBeGreaterThanOrEqual(prev[d]);
        prev = cur;
      }
    }
  });

  // BOUNDED: no state, however extreme, can push a dial out of its safe range.
  it("never leaves its bounds, in ANY reachable condition", () => {
    for (const phase of PHASES) {
      for (const arousal of [-1, -0.5, 0, 0.5, 1]) {
        const cap = capacityFor(c(phase, arousal));
        expect(cap.thinkingTokens).toBeGreaterThanOrEqual(MIN_THINKING_BUDGET);
        expect(cap.thinkingTokens).toBeLessThanOrEqual(MAX_THINKING_BUDGET);
        expect(cap.explorationSteps).toBeGreaterThanOrEqual(MIN_EXPLORATION_STEPS);
        expect(cap.explorationSteps).toBeLessThanOrEqual(MAX_EXPLORATION_STEPS);
        expect(cap.lookbackRecords).toBeGreaterThanOrEqual(MIN_LOOKBACK_RECORDS);
        expect(cap.lookbackRecords).toBeLessThanOrEqual(MAX_LOOKBACK_RECORDS);
        expect(cap.diaryWindow).toBeGreaterThanOrEqual(MIN_DIARY_WINDOW);
        expect(cap.diaryWindow).toBeLessThanOrEqual(MAX_DIARY_WINDOW);
        expect(cap.reserve).toBeGreaterThanOrEqual(0);
        expect(cap.reserve).toBeLessThanOrEqual(1);
      }
    }
  });

  it("NEVER starves a thought, even at her lowest — the floor is a substrate fact", () => {
    // Measured: reasoning and the answer share one budget, and too small a budget returns nothing.
    expect(capacityFor(c("dormant", -1)).thinkingTokens).toBeGreaterThanOrEqual(MIN_THINKING_BUDGET);
  });

  it("always leaves enough to actually do the thing — no dial can reach zero", () => {
    const worst = capacityFor(c("dormant", -1));
    expect(worst.explorationSteps).toBeGreaterThanOrEqual(2); // one step cannot look anything up
    expect(worst.lookbackRecords).toBeGreaterThan(0);
    expect(worst.diaryWindow).toBeGreaterThan(0);
  });

  // A malformed reading must never propagate into who she is.
  it("survives garbage readings by falling back to her lowest, never to nonsense", () => {
    for (const bad of [NaN, Infinity, -Infinity, 1e9, -1e9]) {
      const cap = capacityFor(c("normal", bad));
      for (const d of DIALS) {
        expect(Number.isFinite(cap[d] as number), `${bad} / ${d}`).toBe(true);
        expect(cap[d] as number, `${bad} / ${d}`).toBeGreaterThan(0);
      }
      expect(Number.isFinite(cap.reserve)).toBe(true);
    }
    expect(capacityFor(c("normal", NaN)).reserve).toBe(reserveOf(c("normal", -1))); // NaN → floor
  });

  it("is inert: same condition, same answer, no memory of its own", () => {
    const a = capacityFor(c("normal", 0.2));
    for (let i = 0; i < 50; i++) expect(capacityFor(c("normal", 0.2))).toEqual(a);
  });

  it("returns whole, usable numbers", () => {
    for (const phase of PHASES) {
      const cap = capacityFor(c(phase, 0.3));
      for (const d of DIALS) expect(Number.isInteger(cap[d] as number), `${phase}/${d}`).toBe(true);
    }
  });
});

describe("the loop it sits in is self-limiting, not runaway", () => {
  // Capacity → she spends more → energy falls → capacity falls. That is NEGATIVE feedback, so it
  // must settle rather than oscillate. Simulated over a full day of spending.
  it("converges downward instead of oscillating as she spends her day", () => {
    const cap = 400;
    let spent = 0;
    const phaseOf = (): MetabolicPhase => {
      const left = 1 - spent / cap;
      return left >= 0.9 ? "rested" : left > 0.25 ? "normal" : left > 0.05 ? "low" : "dormant";
    };
    const trace: number[] = [];
    for (let i = 0; i < 60; i++) {
      const k = capacityFor({ phase: phaseOf(), arousal: 0.2 });
      trace.push(k.explorationSteps);
      // Spending scales with what she brought, the feedback edge.
      spent += 1 + k.explorationSteps * 0.9;
      if (spent > cap) break;
    }
    // Never increases: a self-limiting loop, not an oscillator.
    for (let i = 1; i < trace.length; i++) expect(trace[i]).toBeLessThanOrEqual(trace[i - 1]);
    expect(trace[trace.length - 1]).toBeLessThan(trace[0]); // it really did wind down
    expect(trace[trace.length - 1]).toBeGreaterThanOrEqual(MIN_EXPLORATION_STEPS); // but never to nothing
  });

  it("cannot spend her day faster than a fixed high setting would", () => {
    // The safety question for making capacity elastic: does being generous when rested burn her
    // out sooner than the old constant? It must not.
    const run = (elastic: boolean): number => {
      const cap = 400; let spent = 0, moments = 0;
      while (spent < cap && moments < 500) {
        const left = 1 - spent / cap;
        const phase: MetabolicPhase = left >= 0.9 ? "rested" : left > 0.25 ? "normal" : left > 0.05 ? "low" : "dormant";
        const steps = elastic ? capacityFor({ phase, arousal: 0.2 }).explorationSteps : MAX_EXPLORATION_STEPS;
        spent += 1 + steps * 0.9;
        moments += 1;
      }
      return moments;
    };
    expect(run(true), "elastic must last at least as long as a fixed generous setting").toBeGreaterThanOrEqual(run(false));
  });
});

describe("her capacity is legible", () => {
  it("reads out in a line that shows the drift", () => {
    const out = formatCapacity(capacityFor(c("rested", 1)));
    expect(out).toContain("reserve 100%");
    expect(out).toMatch(/think \d+tok/);
    expect(out).toMatch(/follow \d+ steps/);
  });
});
