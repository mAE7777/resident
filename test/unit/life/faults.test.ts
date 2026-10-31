import { describe, it, expect } from "vitest";
import { createFaultLog, describeError, type Fault } from "../../../src/life/faults.js";
import { detectAnomalies, planReaction, DEFAULT_THRESHOLDS, type VitalsSnapshot } from "../../../src/life/vitals.js";

function snap(over: Partial<VitalsSnapshot> = {}): VitalsSnapshot {
  return {
    ts: 0, phase: "normal", remainingFraction: 0.6, spentVigor: 100, capVigor: 400, topAccount: "living",
    drives: { discomfort: 0.1, care: 0.2, social: 0.3, curiosity: 0.5, expression: 0.2, maintenance: 0.2 },
    dominant: "curiosity", pad: { pleasure: 0.2, arousal: 0.1, dominance: 0.1 }, mood: "steady",
    tierCeiling: "tier3", mayExplore: true, awake: true, clockActivity: 0.8, hoursSinceUser: 2,
    sendsInLastDay: 0, consecutiveNonReplies: 0, reservoirSize: 0,
    soulInvariants: [{ id: 1, name: "inv1", ok: true, detail: "" }, { id: 2, name: "inv2", ok: true, detail: "" }, { id: 3, name: "inv3", ok: true, detail: "" }, { id: 4, name: "inv4", ok: true, detail: "" }],
    lastTickAgeMs: 60_000, newFaults: [], ...over,
  };
}

const fault = (where: string, severity: Fault["severity"] = "warn"): Fault => ({ ts: 1, where, detail: "it broke", severity });

describe("the fault channel — nothing fails quietly", () => {
  it("records failures and reports them to a sink immediately", () => {
    const seen: Fault[] = [];
    const log = createFaultLog(10, (f) => seen.push(f));
    log.record("agency.journal", new Error("disk full"));
    expect(seen).toHaveLength(1);
    expect(seen[0].where).toBe("agency.journal");
    expect(seen[0].detail).toBe("disk full");
    expect(seen[0].severity).toBe("warn");
    expect(log.total()).toBe(1);
  });

  it("never throws from inside a catch block, whatever it is handed", () => {
    const log = createFaultLog(10);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => log.record("x", circular)).not.toThrow();
    expect(() => log.record("x", undefined)).not.toThrow();
    expect(() => log.record("x", null)).not.toThrow();
    expect(log.total()).toBe(3);
  });

  it("still records when the reporting sink itself is broken", () => {
    const log = createFaultLog(10, () => { throw new Error("notifier down"); });
    expect(() => log.record("agency.moment", "boom")).not.toThrow();
    expect(log.all()).toHaveLength(1); // the fault survived a broken reporter
  });

  it("keeps a bounded window but counts everything that ever happened", () => {
    const log = createFaultLog(3);
    for (let i = 0; i < 10; i++) log.record(`w${i}`, "e");
    expect(log.all()).toHaveLength(3);
    expect(log.total()).toBe(10); // nothing is quietly forgotten from the count
  });

  it("returns only faults since a cursor, so a cycle reports each one exactly once", () => {
    const log = createFaultLog(50);
    log.record("a", "1");
    const cursor = Date.now() + 1;
    expect(log.since(cursor)).toHaveLength(0);
    expect(log.since(0).length).toBeGreaterThan(0);
  });

  it("describes any error shape readably", () => {
    expect(describeError(new Error("nope"))).toBe("nope");
    expect(describeError("plain")).toBe("plain");
    expect(describeError({ a: 1 })).toContain("a");
  });
});

describe("the watchtower surfaces faults to Eric", () => {
  it("raises an alert for a single fault rather than letting it pass", () => {
    const a = detectAnomalies([snap({ newFaults: [fault("agency.journal")] })]);
    const f = a.find((x) => x.code === "fault");
    expect(f?.severity).toBe("warn");
    expect(f?.message).toContain("agency.journal");
    // A warn-level anomaly is delivered, not merely logged.
    expect(planReaction(a).alerts.some((x) => x.code === "fault")).toBe(true);
  });

  it("escalates a burst of faults to critical", () => {
    const many = Array.from({ length: DEFAULT_THRESHOLDS.faultBurst }, (_, i) => fault(`w${i}`));
    expect(detectAnomalies([snap({ newFaults: many })]).find((x) => x.code === "fault")?.severity).toBe("critical");
  });

  it("escalates a single critical fault immediately", () => {
    const a = detectAnomalies([snap({ newFaults: [fault("vitals.cycle", "critical")] })]);
    expect(a.find((x) => x.code === "fault")?.severity).toBe("critical");
  });

  it("stays quiet when nothing broke", () => {
    expect(detectAnomalies([snap({ newFaults: [] })]).some((x) => x.code === "fault")).toBe(false);
  });

  it("does not crash on a record written before faults were tracked", () => {
    const legacy = snap();
    delete (legacy as { newFaults?: unknown }).newFaults;
    expect(() => detectAnomalies([legacy])).not.toThrow();
    expect(detectAnomalies([legacy]).some((x) => x.code === "fault")).toBe(false);
  });
});
