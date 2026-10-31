import { describe, it, expect } from "vitest";
import {
  pushThreshold,
  motivation,
  decide,
  route,
  intrinsicFromDrive,
  type Thought,
  type ExpressionContext,
} from "../../../src/life/expression.js";

const HOUR = 3_600_000;
function thought(id: string, bornMs: number, intrinsic: number, complaint = false): Thought {
  return { id, text: id, source: "curiosity", bornMs, intrinsic, constraintComplaint: complaint };
}
function ctx(p: Partial<ExpressionContext>): ExpressionContext {
  return { nowMs: 0, present: true, available: true, awake: true, clockActivity: 0.8, consecutiveNonReplies: 0, sendsInLastDay: 0, ...p };
}

describe("expression gate", () => {
  it("push threshold rises with ignored pushes but stays floored and capped", () => {
    expect(pushThreshold(0)).toBeCloseTo(0.55, 5);
    expect(pushThreshold(3)).toBeGreaterThan(pushThreshold(0));
    expect(pushThreshold(100)).toBeLessThanOrEqual(0.9);
    expect(pushThreshold(0)).toBeGreaterThan(0); // never fully mute
  });

  it("silence-decay lifts motivation as a thought ages", () => {
    const c = ctx({ nowMs: 10 * HOUR });
    const fresh = motivation(thought("a", 10 * HOUR, 0.4), c);
    const old = motivation(thought("b", 0, 0.4), c);
    expect(old).toBeGreaterThan(fresh);
  });

  it("pushes a motivated thought when Eric is present and available", () => {
    const d = decide(thought("a", 0, 0.8), ctx({ nowMs: HOUR }));
    expect(d.channel).toBe("push");
  });

  it("drains to the diary (never pushes) when Eric is absent", () => {
    expect(decide(thought("a", 0, 0.9), ctx({ present: false })).channel).toBe("diary");
  });

  it("never pushes a constraint-complaint; it goes to the diary", () => {
    const d = decide(thought("a", 0, 0.95, true), ctx({}));
    expect(d.channel).toBe("diary");
    expect(d.reason).toContain("constraint-complaint");
  });

  it("holds a below-bar thought, then drains it to the diary once aged", () => {
    const weak = thought("a", 0, 0.2);
    expect(decide(weak, ctx({ nowMs: HOUR })).channel).toBe("hold");
    expect(decide(weak, ctx({ nowMs: 30 * HOUR })).channel).toBe("diary"); // aged out
  });

  it("routes at most one push per moment", () => {
    const thoughts = [thought("a", 0, 0.9), thought("b", 0, 0.85), thought("c", 0, 0.8)];
    const r = route(thoughts, ctx({ nowMs: HOUR }));
    expect(r.push.length).toBe(1);
  });

  it("intrinsicFromDrive combines urgency and novelty in range", () => {
    expect(intrinsicFromDrive(1, 1)).toBeCloseTo(1, 5);
    expect(intrinsicFromDrive(0, 0)).toBe(0);
  });
});

// ── Deterministic simulation of the expression gate over time ────────────────────

interface SimResult { pushes: number; diaried: number; maxReservoir: number; pushesFirstReturnTick: number }

function simulate(ticks: number, opts: { present: (t: number) => boolean; nonReplies: (t: number) => number; returnTick?: number }): SimResult {
  let reservoir: Thought[] = [];
  let pushes = 0, diaried = 0, maxReservoir = 0, pushesFirstReturnTick = 0;
  const pushTimes: number[] = [];
  for (let t = 0; t < ticks; t++) {
    const nowMs = t * HOUR;
    reservoir.push(thought(`t${t}`, nowMs, 0.7)); // a fresh, decently-interesting thought each hour
    const sendsInLastDay = pushTimes.filter((p) => nowMs - p < 24 * HOUR).length;
    const c = ctx({ nowMs, present: opts.present(t), consecutiveNonReplies: opts.nonReplies(t), sendsInLastDay });
    const r = route(reservoir, c);
    pushes += r.push.length;
    diaried += r.diary.length;
    for (let i = 0; i < r.push.length; i++) pushTimes.push(nowMs);
    reservoir = r.hold;
    maxReservoir = Math.max(maxReservoir, reservoir.length);
    if (opts.returnTick !== undefined && t === opts.returnTick) pushesFirstReturnTick = r.push.length;
  }
  return { pushes, diaried, maxReservoir, pushesFirstReturnTick };
}

describe("proactive non-annoyance + recovery", () => {
  it("pushes far less when Eric stops replying (reply-adaptive)", () => {
    const engaged = simulate(48, { present: () => true, nonReplies: () => 0 });
    const ignored = simulate(48, { present: () => true, nonReplies: (t) => t });
    expect(ignored.pushes).toBeLessThan(engaged.pushes);
  });

  it("recovers calmly after a dead period: no backlog burst", () => {
    // 72h dead (Eric absent), then he returns at tick 72 (present, non-replies reset).
    const res = simulate(80, {
      present: (t) => t >= 72,
      nonReplies: () => 0,
      returnTick: 72,
    });
    // During absence everything drained to the diary, so the reservoir never piled up...
    expect(res.maxReservoir).toBeLessThanOrEqual(2);
    // ...and the first moment back is not a flood.
    expect(res.pushesFirstReturnTick).toBeLessThanOrEqual(1);
  });
});

describe("starvation (owner silence)", () => {
  it("stays quiet and does not spiral over a week of silence", () => {
    const res = simulate(168, { present: () => false, nonReplies: () => 0 });
    expect(res.pushes).toBe(0); // absent Eric is never pushed to
    expect(res.maxReservoir).toBeLessThanOrEqual(2); // no unbounded backlog building for a later dump
  });
});
