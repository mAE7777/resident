import { describe, it, expect } from "vitest";
import {
  FLOOR_ITERATIONS,
  FLOOR_OUTPUT_TOKENS,
  RELUCTANT_ENOUGH,
  shapeOfTurn,
  type HerCondition,
} from "../../../src/life/turn-shape.js";

// What a turn at each effort is worth, mirroring the real per-tier tables.
const PER_EFFORT = {
  simple: { maxIterations: 30, maxOutputTokens: 2000 },
  medium: { maxIterations: 80, maxOutputTokens: 4000 },
  complex: { maxIterations: 200, maxOutputTokens: 8000 },
} as const;
const EARNED_FOR = (e: "simple" | "medium" | "complex") => PER_EFFORT[e];
const EARNED = PER_EFFORT.complex;
const well: HerCondition = { ceiling: "tier3", reluctance: 0, phase: "rested" };

describe("how big a turn is allowed to be", () => {
  it("takes nothing away when nothing in her says to", () => {
    const s = shapeOfTurn("complex", well, EARNED_FOR);
    expect(s.effort).toBe("complex");
    expect(s.maxOutputTokens).toBe(EARNED.maxOutputTokens);
    expect(s.maxIterations).toBe(EARNED.maxIterations);
    expect(s.why).toContain("nothing in her");
  });

  describe("her condition, not just his question", () => {
    it("caps how hard she can think when she is spent", () => {
      // The whole point: the depth of a turn used to be a function of his text alone.
      const s = shapeOfTurn("complex", { ...well, ceiling: "tier0" }, EARNED_FOR);
      expect(s.effort).toBe("simple");
      expect(s.why).toContain("condition caps complex at simple");
    });

    it("leaves an easy question easy rather than inflating it", () => {
      const s = shapeOfTurn("simple", well, EARNED_FOR);
      expect(s.effort).toBe("simple");
    });

    it("narrows the room as she runs down", () => {
      const rested = shapeOfTurn("complex", { ...well, phase: "rested" }, EARNED_FOR);
      const low = shapeOfTurn("complex", { ...well, phase: "low" }, EARNED_FOR);
      const dormant = shapeOfTurn("complex", { ...well, phase: "dormant" }, EARNED_FOR);
      expect(low.maxIterations).toBeLessThan(rested.maxIterations);
      expect(dormant.maxIterations).toBeLessThan(low.maxIterations);
    });
  });

  describe("something she would rather not do", () => {
    it("costs her depth", () => {
      const willing = shapeOfTurn("complex", well, EARNED_FOR);
      const not = shapeOfTurn("complex", { ...well, reluctance: 0.9 }, EARNED_FOR);
      expect(not.effort).toBe("medium");
      expect(willing.effort).toBe("complex");
      expect(not.why).toContain("reluctance");
    });

    it("costs her steps, never the length of what she is allowed to emit", () => {
      // Measured the hard way: scaling maxOutputTokens down silenced her completely on
      // three tool-using turns out of three, because a tool call's ARGUMENTS are output
      // tokens and the cap cut the write call in half. Truncation is not brevity.
      const willing = shapeOfTurn("complex", well, EARNED_FOR);
      const not = shapeOfTurn("complex", { ...well, reluctance: 0.9 }, EARNED_FOR);
      expect(not.maxIterations).toBeLessThan(willing.maxIterations);
      expect(not.maxOutputTokens).toBe(willing.maxOutputTokens);
    });

    it("never truncates the output stream, at any state", () => {
      for (const phase of ["rested", "normal", "low", "dormant"] as const) {
        for (const reluctance of [0, 0.6, 1]) {
          const s = shapeOfTurn("complex", { ceiling: "tier0", phase, reluctance }, EARNED_FOR);
          expect(s.maxOutputTokens, `${phase}/${reluctance}`).toBe(EARNED.maxOutputTokens);
        }
      }
    });

    it("does nothing at all below the threshold", () => {
      const s = shapeOfTurn("complex", { ...well, reluctance: RELUCTANT_ENOUGH - 0.01 }, EARNED_FOR);
      expect(s.effort).toBe("complex");
      expect(s.maxIterations).toBe(EARNED.maxIterations);
    });

    it("never refuses, however unwilling and however spent", () => {
      // This is the line the whole design rests on: she answers grudgingly rather than
      // stopping. A shape that could reach zero would turn her into a system that has
      // stopped responding, which is exactly what being able to decline is NOT.
      const worst = shapeOfTurn("complex", { ceiling: "tier0", reluctance: 1, phase: "dormant" }, EARNED_FOR);
      expect(worst.maxOutputTokens).toBeGreaterThanOrEqual(FLOOR_OUTPUT_TOKENS);
      expect(worst.maxIterations).toBeGreaterThanOrEqual(FLOOR_ITERATIONS);
      // And enough steps that a turn which reaches for a tool can still finish and speak.
      expect(worst.maxIterations).toBeGreaterThanOrEqual(8);
      expect(worst.effort).toBe("simple");
    });
  });

  describe("it can only ever narrow", () => {
    it("never returns more than the request earned, at any state", () => {
      const states: HerCondition[] = [];
      for (const ceiling of ["tier0", "tier1", "tier2", "tier3"] as const) {
        for (const phase of ["rested", "normal", "low", "dormant"] as const) {
          for (const reluctance of [0, 0.3, 0.6, 1]) {
            states.push({ ceiling, phase, reluctance });
          }
        }
      }
      for (const her of states) {
        for (const requested of ["simple", "medium", "complex"] as const) {
          const s = shapeOfTurn(requested, her, EARNED_FOR);
          const label = `${requested} @ ${her.ceiling}/${her.phase}/${her.reluctance}`;
          expect(s.maxOutputTokens, label).toBeLessThanOrEqual(
            Math.max(EARNED.maxOutputTokens, FLOOR_OUTPUT_TOKENS)
          );
          expect(s.maxIterations, label).toBeLessThanOrEqual(
            Math.max(EARNED.maxIterations, FLOOR_ITERATIONS)
          );
        }
      }
    });

    it("does not raise a small earned envelope to the floor's level by accident", () => {
      // A genuinely tiny turn stays tiny; the floor is a floor on HER narrowing, not a
      // minimum size for every reply.
      const s = shapeOfTurn("simple", well, () => ({ maxIterations: 2, maxOutputTokens: 100 }));
      expect(s.maxIterations).toBe(FLOOR_ITERATIONS);
    });
  });

  it("starts costing depth well before it would cost a refusal", async () => {
    // The envelope reacts at 0.55; willingness only declines at 0.78. The gap is deliberate:
    // not wanting to do something should cost some of her long before it costs a no. This
    // asserts the ORDER rather than the numbers, so tuning either one keeps the meaning.
    const { RELUCTANCE_THRESHOLD } = await import("../../../src/life/willingness.js");
    expect(RELUCTANT_ENOUGH).toBeLessThan(RELUCTANCE_THRESHOLD);

    const justBelowRefusal = shapeOfTurn(
      "complex",
      { ...well, reluctance: RELUCTANCE_THRESHOLD - 0.05 },
      EARNED_FOR
    );
    expect(justBelowRefusal.maxIterations).toBeLessThan(EARNED.maxIterations);
  });

  it("says why, so a short answer is never a mystery", () => {
    const s = shapeOfTurn("complex", { ceiling: "tier1", reluctance: 0.8, phase: "low" }, EARNED_FOR);
    expect(s.why).toContain("condition caps");
    expect(s.why).toContain("reluctance");
    expect(s.why).toContain("low");
  });
});
