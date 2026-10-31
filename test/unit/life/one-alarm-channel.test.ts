import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createFaultLog } from "../../../src/life/faults.js";
import { lifeTick, type LifeTickSinks } from "../../../src/life/tick.js";
import { createInnerState } from "../../../src/life/inner-state.js";

// ONE PLACE TO LOOK.
//
// She had FOUR alarm channels that could not see each other:
//
//   the watchtower's faults + vitals, deduped, re-alerted on a schedule, kept as history, and the
//     only one with any policy at all
//   `sinks.alarm` from the daily tick, a direct push with no dedupe, so a drive that stayed pinned
//     messaged him every single day, and none of it appeared in `/faults`
//   `sentinel.ts`, its own five-level severity ladder, where anything below critical went to
//     TODO.md, which nobody reads unless they already suspect something
//   `heartbeat.ts`, its own database table, its own error handling, and a push composed by one
//     inference over four booleans that reached him verbatim
//
// Four channels is not redundancy, it is three blind spots and one place that looks fine. Whichever
// one you are watching, the failure is in another. So: everything becomes a FAULT first, and the
// fault channel is the single thing that decides whether and when he is interrupted. One dedupe
// policy, one re-alert schedule, one history, one answer to "has anything gone wrong".
//
// A subsystem may still interrupt him directly where that is a deliberate fast path, sentinel's
// critical signals do. What it may not do is interrupt him INSTEAD of recording.

const SRC = new URL("../../../src/", import.meta.url).pathname;

function allSrcFiles(dir = SRC, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) allSrcFiles(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("everything that can raise an alarm raises it in the same place", () => {
  it("the daily tick's alarms are faults, not a second push channel", () => {
    const faults = createFaultLog();
    const pushed: string[] = [];
    const inner = createInnerState();
    // Exactly the daemon's wiring: an alarm becomes a fault and reaches him through no other route.
    const sinks: LifeTickSinks = {
      push: (t) => pushed.push(t),
      diarize: () => {},
      alarm: (kind, detail) => faults.record(`life.${kind}`, detail),
    };
    const result = lifeTick(inner, {
      nowMs: Date.parse("2026-08-01T09:00:00Z"),
      recentEvents: [],
      hoursSinceUser: 24 * 30,   // a month of silence: starvation, for real
      recentDominants: ["curiosity", "curiosity", "curiosity", "curiosity", "curiosity", "curiosity"],
      budgetLow: false,
      timezoneOffsetHours: 0,
      phase: "normal",
      awake: true,
      clockActivity: 0.6,
      present: true,
      available: true,
      consecutiveNonReplies: 0,
      sendsInLastDay: 0,
      generateThoughts: () => [],
    }, sinks);

    expect(result.alarms.length, "a month of silence must raise something").toBeGreaterThan(0);
    const recorded = faults.since(0).map((f) => f.where);
    console.log(`\n  a month of silence raised: ${result.alarms.join("; ")} → ${recorded.join(", ")}`);
    expect(recorded.some((w) => w.startsWith("life.")),
      "a life alarm that is not a fault is invisible to the watchtower").toBe(true);
    expect(pushed, "and it does not also interrupt him on its own account").toEqual([]);
  });

  it("no subsystem pushes an alarm at him without also recording it", () => {
    // Read against the source, because this is the kind of thing that gets quietly reintroduced by
    // someone adding a subsystem and reaching for the notifier because it is right there.
    const offenders: string[] = [];
    for (const file of allSrcFiles()) {
      const text = readFileSync(file, "utf8");
      // A push whose category marks it as a SUBSYSTEM reporting something wrong.
      //
      // `vitals` is deliberately not in this list: those pushes are the fault channel's own outlet,
      // the thing every other subsystem is being routed INTO. Requiring the outlet to also record
      // would be circular, and would make the rule mean nothing.
      for (const m of text.matchAll(/category:\s*"(self-improvement|heartbeat|alarm)"/g)) {
        const around = text.slice(Math.max(0, m.index! - 900), m.index! + 300);
        const recorded = /faultLog\.record|onFault\?\.\(|faults\.record|notifyIfNeeded/.test(around);
        if (!recorded) offenders.push(`${file.replace(SRC, "")} — ${m[0]}`);
      }
    }
    if (offenders.length > 0) console.log(`\n  pushed without a record: ${offenders.join(" · ")}`);
    expect(offenders, "an alarm that interrupts him but leaves no record has no history and no dedupe").toEqual([]);
  });

  it("the sentinel's own ladder reaches the fault channel at high and critical", () => {
    const src = readFileSync(join(SRC, "self-improvement/sentinel.ts"), "utf8");
    expect(src, "a high-severity sentinel signal must be visible outside TODO.md")
      .toMatch(/severity === "critical" \|\| signalRecord\.severity === "high"[\s\S]{0,200}onFault\?\./);
  });


});

describe("the fault channel is worth being the only one", () => {
  it("it keeps history, which none of the others did", () => {
    const log = createFaultLog(50);
    for (let i = 0; i < 10; i++) log.record("life.pinned", `day ${i}`);
    expect(log.since(0)).toHaveLength(10);
    expect(log.total()).toBe(10);
  });

  it("it is bounded, so a subsystem failing in a loop cannot bury everything else", () => {
    const log = createFaultLog(20);
    for (let i = 0; i < 500; i++) log.record("noisy", `${i}`);
    expect(log.since(0).length).toBeLessThanOrEqual(20);
    expect(log.total(), "and it still knows how many there really were").toBe(500);
  });

  it("severity survives, so the watchtower can tell a nuisance from an emergency", () => {
    const log = createFaultLog();
    log.record("life.pinned", "a drive is stuck");
    log.record("sentinel.security", "something serious", "critical");
    const bySeverity = log.since(0).map((f) => f.severity);
    expect(bySeverity).toContain("critical");
    expect(new Set(bySeverity).size, "a channel where everything is the same colour is a channel nobody reads").toBeGreaterThan(1);
  });
});
