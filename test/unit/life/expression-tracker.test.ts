import { describe, it, expect } from "vitest";
import { createExpressionTracker } from "../../../src/life/expression-tracker.js";

const HOUR = 3_600_000;

describe("expression tracker", () => {
  it("counts proactive sends within a rolling 24h window", () => {
    const t = createExpressionTracker(0);
    t.onProactiveSend(0);
    t.onProactiveSend(HOUR);
    expect(t.snapshot(2 * HOUR).sendsInLastDay).toBe(2);
    // A send older than 24h drops out of the window.
    expect(t.snapshot(26 * HOUR).sendsInLastDay).toBe(0);
  });

  it("tracks the consecutive-non-reply streak and resets on an owner message", () => {
    const t = createExpressionTracker(0);
    t.onProactiveSend(HOUR);
    t.onProactiveSend(2 * HOUR);
    expect(t.snapshot(2 * HOUR).consecutiveNonReplies).toBe(2);
    t.onOwnerMessage(3 * HOUR);
    expect(t.snapshot(3 * HOUR).consecutiveNonReplies).toBe(0);
  });

  it("measures hours since the owner last spoke", () => {
    const t = createExpressionTracker(0);
    t.onOwnerMessage(HOUR);
    expect(t.snapshot(6 * HOUR).hoursSinceUser).toBeCloseTo(5, 5);
  });

  it("does not false-fire starvation immediately after boot", () => {
    const t = createExpressionTracker(10 * HOUR); // booted 10h in
    expect(t.snapshot(10 * HOUR).hoursSinceUser).toBe(0);
  });

  it("reports the held reservoir size", () => {
    const t = createExpressionTracker(0);
    t.setReservoir(4);
    expect(t.snapshot(0).reservoirSize).toBe(4);
  });
});
