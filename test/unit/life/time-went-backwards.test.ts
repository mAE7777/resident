import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clockWentBackwards, ROUTINE_CORRECTION_MS, SERIOUS_ROLLBACK_MS } from "../../../src/life/clock-sanity.js";
import { decayAll, createGraph, addNode } from "../../../src/life/field.js";

/**
 * THE CLOCK GOING THE OTHER WAY.
 *
 * Forward was handled, and handled well: `sleep.ts` sees the gap a closed lid leaves and teaches
 * the whole system to subtract it, so waking from a weekend is something that happened to her
 * rather than an emergency. Nothing watched backwards, and backwards has ordinary causes too: a
 * dead clock battery, a restored disk image, a resumed virtual machine, a first NTP sync after a
 * long time offline.
 *
 * What it does is put her own past in her future. This file pins three things: that it is SEEN,
 * that the routine sub-minute nudging is NOT reported (a channel that cries wolf is a channel he
 * stops reading), and, the one that would have been permanent, that her field cannot gain
 * strength from a negative elapsed time.
 */

describe("noticing that the clock went back", () => {
  const T = Date.parse("2026-08-14T12:00:00.000Z");

  it("a routine correction is not an incident", () => {
    expect(clockWentBackwards(T - 900, T)).toBeNull();
    expect(clockWentBackwards(T - ROUTINE_CORRECTION_MS, T)).toBeNull();
  });

  it("an hour back is a warning, with the number in it", () => {
    const slip = clockWentBackwards(T - 3_600_000, T);
    expect(slip?.severity).toBe("warn");
    expect(slip?.detail).toContain("1.0h");
    expect(slip?.byMs).toBe(3_600_000);
  });

  it("a day or more back is critical — her whole record is stamped ahead of her", () => {
    const slip = clockWentBackwards(T - SERIOUS_ROLLBACK_MS, T);
    expect(slip?.severity).toBe("critical");
    expect(clockWentBackwards(T - 30 * 24 * 3.6e6, T)?.detail).toContain("days");
  });

  it("a newborn with nothing written down is not a slip", () => {
    // The first boot has no previous timestamp at all. Reporting that as a clock failure would
    // put a critical fault in front of him on the one morning it means nothing.
    expect(clockWentBackwards(T, null)).toBeNull();
    expect(clockWentBackwards(T, Number.NaN)).toBeNull();
  });

  it("time moving forward is never a slip, however far", () => {
    expect(clockWentBackwards(T + 365 * 24 * 3.6e6, T)).toBeNull();
  });

  it("the report says what is and is not at risk, because half of it is fine", () => {
    // The value of this fault is that he can tell "something is wrong with the machine's clock"
    // from "she is damaged". If the message does not say that, he has to come and ask.
    const detail = clockWentBackwards(T - 2 * SERIOUS_ROLLBACK_MS, T)!.detail;
    expect(detail).toMatch(/never rewritten/u);
    expect(detail).toMatch(/clamp at zero/u);
  });
});

describe("the thing that would have been permanent, and is not", () => {
  it("a backward clock cannot make her memories STRONGER", () => {
    // Decay is exponential in elapsed days. A negative elapsed would be exp(+x): strength growing
    // past its ceiling, and nothing anywhere brings it back down, a memory that becomes
    // permanently more vivid than any real one, by arithmetic. Every decay site clamps; this is
    // the proof that the clamp is really there rather than believed to be.
    const g = createGraph();
    const n = addNode(g, {
      kind: "moment", text: "那天下午的光", bornMs: 1_000_000, charge: 0.5, source: "s", key: "k",
    });
    const before = n.strength;
    decayAll(g, 1_000_000 - 30 * 24 * 3.6e6, 1_000_000); // "now" a month BEFORE the last tick
    expect(n.strength, "a clock rollback made a memory stronger — that never comes back")
      .toBeLessThanOrEqual(before);
  });
});

describe("and it is wired, at boot and while she runs", () => {
  const DAEMON = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");

  it("checked at boot against the last thing she wrote down", () => {
    const at = DAEMON.indexOf("const bootSlip = clockWentBackwards(");
    expect(at, "a rollback that happened while she was off would go unnoticed").toBeGreaterThan(-1);
    expect(DAEMON.slice(at, at + 260)).toMatch(/faultLog\.record\("clock\.backwards"/u);
    // NOT the early buffer. That is drained once, a hundred lines above this point, so anything
    // pushed into it afterwards sits there forever, a fault about the clock, lost to a scoping
    // detail, which is the exact shape of failure this file closes.
    expect(DAEMON.slice(at, at + 260)).not.toMatch(/earlyFault\(/u);
  });

  it("and again on every monitor cycle, for a rollback that happens under her", () => {
    const at = DAEMON.indexOf("const cycleSlip = clockWentBackwards(");
    expect(at).toBeGreaterThan(-1);
    expect(DAEMON.slice(at, at + 300)).toMatch(/lastMonitorMs = Date\.now\(\)/u);
  });
});
