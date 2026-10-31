import { describe, it, expect } from "vitest";
import { createInnerState, type DaySummary, type InnerStateStore } from "../../../src/life/inner-state.js";

function day(p: Partial<DaySummary>): DaySummary {
  return {
    successes: 0, failures: 0, stuck: 0, skills: 0, idle: 0, novelty: 0, observations: 0,
    anomalies: 0, maintenanceDue: 0, hoursSinceUser: 0, lateNight: false, budgetLow: false, restful: false,
    ...p,
  };
}

describe("inner-state", () => {
  it("a hard day raises discomfort and lowers pleasure", () => {
    const s = createInnerState();
    const before = s.snapshot("normal", true);
    s.update(day({ failures: 3, stuck: 2, anomalies: 2, lateNight: true }));
    const after = s.snapshot("normal", true);
    expect(after.drives.discomfort).toBeGreaterThan(before.drives.discomfort);
    expect(after.emotion.pleasure).toBeLessThan(before.emotion.pleasure);
  });

  it("a curious day raises curiosity", () => {
    const s = createInnerState();
    const before = s.drives().curiosity;
    s.update(day({ novelty: 1, idle: 2 }));
    expect(s.drives().curiosity).toBeGreaterThan(before);
  });

  it("discomfort keeps building across a run of hard days (momentum)", () => {
    const s = createInnerState();
    const hard = day({ failures: 2, stuck: 1, anomalies: 1 });
    s.update(hard);
    const d1 = s.drives().discomfort;
    s.update(hard);
    const d2 = s.drives().discomfort;
    expect(d2).toBeGreaterThan(d1);
  });

  it("snapshot exposes mood, dominant drive, and a policy", () => {
    const s = createInnerState();
    s.update(day({ successes: 2, novelty: 0.5 }));
    const snap = s.snapshot("dormant", true);
    expect(typeof snap.mood).toBe("string");
    expect(snap.dominant).toBeDefined();
    expect(snap.policy.tierCeiling).toBe("tier0"); // dormant floor flows through
  });

  it("persists and restores drives + emotion", () => {
    let saved: { drives: unknown; emotion: unknown } | null = null;
    const store: InnerStateStore = {
      load: () => saved as never,
      save: (x) => { saved = x; },
    };
    const s1 = createInnerState({ store });
    s1.update(day({ successes: 3, novelty: 0.8 }));
    const snap1 = s1.snapshot("normal", true);

    const s2 = createInnerState({ store }); // fresh instance, same store
    expect(s2.drives()).toEqual(snap1.drives);
    expect(s2.emotion()).toEqual(snap1.emotion);
  });

  it("fires onUpdate with the fresh snapshot", () => {
    const seen: string[] = [];
    const s = createInnerState({ onUpdate: (u) => seen.push(u.mood) });
    s.update(day({ successes: 1 }));
    expect(seen.length).toBe(1);
  });
});
