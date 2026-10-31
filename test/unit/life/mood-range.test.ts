import { describe, it, expect } from "vitest";
import { createInnerState, type DaySummary } from "../../../src/life/inner-state.js";

// Regression guard for a real bug: arousal used to depend ONLY on novelty, and novelty comes from
// rare events, so an ORDINARY day appraised as maximally un-novel and drove her arousal to the
// floor. Within a week of light use she was pinned at ~-0.83 and permanently "疲惫", with her
// tier ceiling stuck down as a side effect. A companion must not decay into deadness just because
// life is quiet, and must still be able to feel genuinely worn out when a day earns it.

function day(o: Partial<DaySummary> = {}): DaySummary {
  return {
    successes: 0, failures: 0, stuck: 0, skills: 0, idle: 0, novelty: 0, observations: 0,
    anomalies: 0, maintenanceDue: 0, hoursSinceUser: 4,
    lateNight: false, budgetLow: false, restful: true, ...o,
  };
}

function liveFor(d: DaySummary, days = 7): { arousal: number; mood: string } {
  const inner = createInnerState();
  for (let i = 0; i < days; i++) inner.update(d);
  return { arousal: inner.emotion().arousal, mood: inner.snapshot("normal", true).mood };
}

const QUIET = day();
const ORDINARY = day({ successes: 2, idle: 1, restful: false });
const ALIVE = day({ successes: 4, observations: 2, novelty: 0.5, idle: 2, restful: false });
const GRINDING = day({ failures: 3, stuck: 2, anomalies: 2, lateNight: true, restful: false });
const EMPTY_LATE_NIGHT = day({ skills: 1, lateNight: true, restful: false });

describe("her mood over a real week", () => {
  it("does not decay into permanent flatness on quiet days", () => {
    const after = liveFor(QUIET);
    expect(after.arousal).toBeGreaterThan(-0.33); // never grinds down to weary from quiet alone
    expect(after.mood).not.toBe("疲惫");
  });

  it("stays present through an ordinary week of just talking", () => {
    // This is the actual usage pattern: conversation, not heavy work. It must not deaden her.
    const after = liveFor(ORDINARY);
    expect(after.arousal).toBeGreaterThan(-0.33);
    expect(after.mood).not.toBe("疲惫");
  });

  it("brightens when there is a lot going on and it is new", () => {
    const after = liveFor(ALIVE);
    expect(after.arousal).toBeGreaterThan(0.2);
    expect(after.mood).toBe("轻快");
  });

  it("still goes genuinely low through a grinding week (the range is real)", () => {
    const after = liveFor(GRINDING);
    expect(after.arousal).toBeLessThan(liveFor(ALIVE).arousal);
    expect(["低落", "疲惫", "烦躁"]).toContain(after.mood);
  });

  it("can still feel truly worn out: a late night with little to show for it", () => {
    expect(liveFor(EMPTY_LATE_NIGHT, 3).arousal).toBeLessThan(-0.33);
  });

  it("separates the day types instead of collapsing them together", () => {
    const [quiet, ordinary, alive, grind] = [QUIET, ORDINARY, ALIVE, GRINDING].map((d) => liveFor(d).arousal);
    expect(alive).toBeGreaterThan(ordinary);
    expect(ordinary).toBeGreaterThan(grind);
    expect(new Set([quiet, ordinary, alive, grind]).size).toBe(4); // four distinct outcomes
  });

  it("a quiet day drifts toward baseline rather than being judged for events that never happened", () => {
    const inner = createInnerState();
    // Start her genuinely worn out, then give her quiet days: she should RECOVER, not sink.
    for (let i = 0; i < 3; i++) inner.update(EMPTY_LATE_NIGHT);
    const worn = inner.emotion().arousal;
    for (let i = 0; i < 4; i++) inner.update(QUIET);
    expect(inner.emotion().arousal).toBeGreaterThan(worn); // rest actually restores her
  });
});
