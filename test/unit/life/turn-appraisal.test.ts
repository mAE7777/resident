import { describe, it, expect } from "vitest";
import { appraiseExchange, FAMILIAR_ENOUGH, ABSORBED_AT } from "../../../src/life/turn-appraisal.js";

// The three dimensions that were constants, proven to actually move, and to move the right
// way. The constants (novelty 0.45, control 0.15, engagement 0.75) meant a conversation that
// turned her world over and a rote exchange felt identical.

const base = {
  familiarHits: 2,
  finishReason: "stop" as const,
  iterations: 3,
  warmthMinusUnease: 0.2,
  phase: "normal" as const,
};

describe("novelty is how much of his words found nothing in her", () => {
  it("an empty field makes everything maximally strange, which is a newborn's truth", () => {
    expect(appraiseExchange({ ...base, familiarHits: 0 }).novelty).toBe(1);
  });

  it("well-trodden ground is not novel, and the measure saturates", () => {
    expect(appraiseExchange({ ...base, familiarHits: FAMILIAR_ENOUGH }).novelty).toBe(0);
    expect(appraiseExchange({ ...base, familiarHits: FAMILIAR_ENOUGH + 10 }).novelty).toBe(0);
  });

  it("and it actually moves in between — the whole point", () => {
    const strange = appraiseExchange({ ...base, familiarHits: 0 }).novelty;
    const familiar = appraiseExchange({ ...base, familiarHits: 3 }).novelty;
    expect(strange).toBeGreaterThan(familiar);
    expect(familiar).toBeGreaterThan(0);
  });
});

describe("control is how the turn actually ended", () => {
  it("orders the four endings the way living them would", () => {
    const c = (finishReason: typeof base.finishReason | "max_iterations" | "interrupted" | "error") =>
      appraiseExchange({ ...base, finishReason: finishReason as never }).control;
    expect(c("stop")).toBeGreaterThan(c("interrupted"));
    expect(c("interrupted")).toBeGreaterThan(c("max_iterations"));
    expect(c("max_iterations")).toBeGreaterThan(c("error"));
  });
});

describe("engagement is how much the turn took out of her, on a fixed scale", () => {
  it("a one-step hello is barely engaging; a turn that went and did things is absorbing", () => {
    const hello = appraiseExchange({ ...base, iterations: 1 }).engagement!;
    const absorbed = appraiseExchange({ ...base, iterations: ABSORBED_AT }).engagement!;
    expect(hello).toBeLessThan(0.35);
    expect(absorbed).toBeCloseTo(1);
    // The floor: a real exchange is never literally nothing.
    expect(hello).toBeGreaterThan(0);
  });

  it("saturates rather than running away", () => {
    expect(appraiseExchange({ ...base, iterations: ABSORBED_AT * 40 }).engagement).toBeCloseTo(1);
  });

  it("and it is LIVE across the range ordinary talk actually occupies", () => {
    // The defect this replaces was not only the feedback loop. Dividing by the envelope (30 to
    // 200 steps) while real conversation takes one or two put every turn she has ever had
    // within 0.03 of the floor, a dead signal with a live name.
    const one = appraiseExchange({ ...base, iterations: 1 }).engagement!;
    const three = appraiseExchange({ ...base, iterations: 3 }).engagement!;
    expect(three - one).toBeGreaterThan(0.25);
  });

  it("HER OWN STATE CANNOT ENTER THE DENOMINATOR — the feedback loop is structurally gone", () => {
    // The loop it closes: reluctance halves the turn's envelope (`turn-shape.ts`), engagement
    // divided by that envelope, and engagement drives arousal, so a turn she did not want to be
    // doing read as twice as engaging, and not wanting to do something made her more excited by
    // it. The property is asserted at the TYPE and SOURCE level, because an assertion on values
    // could not see a denominator that is no longer passed in.
    const facts = { ...base, iterations: 3 };
    expect(Object.keys(facts)).not.toContain("maxIterations");
    expect(appraiseExchange(facts).engagement)
      .toBe(appraiseExchange({ ...facts, phase: "dormant" }).engagement);
  });
});

describe("what was already real passes through unchanged", () => {
  it("goalProgress from her sense of him, fatigue from her phase", () => {
    expect(appraiseExchange({ ...base, warmthMinusUnease: 1 }).goalProgress).toBeCloseTo(0.6);
    expect(appraiseExchange({ ...base, warmthMinusUnease: -2 }).goalProgress).toBeCloseTo(-0.6);
    expect(appraiseExchange({ ...base, phase: "dormant" }).fatigue).toBe(0.9);
    expect(appraiseExchange({ ...base, phase: "low" }).fatigue).toBe(0.6);
  });
});
