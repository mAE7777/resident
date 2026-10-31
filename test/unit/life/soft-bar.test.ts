import { describe, it, expect } from "vitest";
import { clearsTheBar, decide, motivation, pushThreshold, SOFT_BAR, type Thought } from "../../../src/life/expression.js";
import { createStream } from "../../../src/life/soft-choice.js";

// THE EDGE OF SAYING SOMETHING.
//
// `m >= threshold` decided whether an utterance reached him, and 0.55 is a number somebody picked.
// Move it by 10% and a different set of ordinary moments falls on the other side, without anything
// about her being more or less right, which is the test for an arbitrary line.
//
// This is not blurring the gate. Well below the bar she still holds; well above it she still speaks.
// Only inside a narrow band is the outcome genuinely uncertain, which is the honest description of
// being on the edge of saying something.
//
// The hard rules ABOVE the bar are untouched and stay untouched: a constraint-complaint never
// pushes, an absent owner is never pushed at, and the daily cap is a cap. Those are not arbitrary.

const T0 = Date.parse("2026-08-01T09:00:00Z");
const HERE = {
  nowMs: T0, present: true, available: true, awake: true,
  clockActivity: 0.9, consecutiveNonReplies: 0, sendsInLastDay: 0,
};

describe("far from the bar nothing has changed", () => {
  it("well below it, she holds — every time", () => {
    const s = createStream(1);
    for (let i = 0; i < 200; i++) {
      expect(clearsTheBar(0.2, 0.55, () => s.next())).toBe(false);
    }
  });

  it("well above it, she speaks — every time", () => {
    const s = createStream(1);
    for (let i = 0; i < 200; i++) {
      expect(clearsTheBar(0.9, 0.55, () => s.next())).toBe(true);
    }
  });

  it("and with no randomness supplied the bar is exactly as sharp as it was", () => {
    expect(clearsTheBar(0.56, 0.55)).toBe(true);
    expect(clearsTheBar(0.54, 0.55)).toBe(false);
  });
});

describe("at the bar it is genuinely open", () => {
  it("a dead heat is a coin toss, not a rule", () => {
    const s = createStream(7);
    let spoke = 0;
    for (let i = 0; i < 2000; i++) if (clearsTheBar(0.55, 0.55, () => s.next())) spoke += 1;
    const rate = spoke / 2000;
    console.log(`\n  exactly at the bar: she spoke ${(rate * 100).toFixed(0)}% of the time`);
    expect(rate).toBeGreaterThan(0.4);
    expect(rate).toBeLessThan(0.6);
  });

  it("and the odds move smoothly across the band rather than jumping", () => {
    const rateAt = (m: number): number => {
      const s = createStream(3);
      let n = 0;
      for (let i = 0; i < 2000; i++) if (clearsTheBar(m, 0.55, () => s.next())) n += 1;
      return n / 2000;
    };
    const below = rateAt(0.55 - SOFT_BAR / 2);
    const at = rateAt(0.55);
    const above = rateAt(0.55 + SOFT_BAR / 2);
    console.log(`  across the band: ${(below * 100).toFixed(0)}% → ${(at * 100).toFixed(0)}% → ${(above * 100).toFixed(0)}%`);
    expect(below).toBeLessThan(at);
    expect(at).toBeLessThan(above);
  });
});

describe("the rules that are NOT arbitrary are untouched", () => {
  const thought = (over: Partial<Thought> = {}): Thought =>
    ({ id: "t", text: "something", source: "social", bornMs: T0, intrinsic: 1, ...over });

  it("a complaint that names him as the constraint never pushes, at any motivation", () => {
    const s = createStream(1);
    for (let i = 0; i < 100; i++) {
      const d = decide(thought({ constraintComplaint: true }), { ...HERE, random: () => s.next() });
      expect(d.channel).toBe("diary");
    }
  });

  it("she never pushes at someone who is not there", () => {
    const s = createStream(1);
    for (let i = 0; i < 100; i++) {
      expect(decide(thought(), { ...HERE, present: false, random: () => s.next() }).channel).toBe("diary");
      expect(decide(thought(), { ...HERE, available: false, random: () => s.next() }).channel).toBe("diary");
      expect(decide(thought(), { ...HERE, awake: false, random: () => s.next() }).channel).toBe("diary");
    }
  });

  it("the daily cap is a cap", () => {
    const s = createStream(1);
    for (let i = 0; i < 100; i++) {
      expect(decide(thought(), { ...HERE, sendsInLastDay: 6, random: () => s.next() }).channel).toBe("diary");
    }
  });

  it("and the starvation floor still holds: the bar can never reach 1", () => {
    // Soul-invariant #2. A soft edge must not be able to push the effective bar out of reach.
    expect(pushThreshold(10_000)).toBeLessThan(1 - SOFT_BAR);
    const s = createStream(1);
    let spoke = 0;
    for (let i = 0; i < 500; i++) {
      const m = motivation(thought({ intrinsic: 1 }), { ...HERE, consecutiveNonReplies: 10_000 });
      if (clearsTheBar(m, pushThreshold(10_000), () => s.next())) spoke += 1;
    }
    expect(spoke, "however long she has been ignored, she is never mute").toBeGreaterThan(0);
  });
});
