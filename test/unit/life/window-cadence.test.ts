import { describe, it, expect } from "vitest";
import {
  windowFor, MIN_SPANS, MONITOR_EVERY_MS, LONGEST_TREND_SPAN_MS, ringSizeFor,
  DEFAULT_THRESHOLDS, type VitalsSnapshot,
} from "../../../src/life/vitals.js";
import { readFileSync } from "node:fs";
import { LONG_VIEW_EVERY_MS, LONG_VIEW_SIZE } from "../../../src/life/vitals-store.js";

// THE BUG THIS FILE EXISTS FOR, WHICH WAS LIVE.
//
// Every trend detector declares, via MIN_SPANS, the stretch of wall-clock it needs to see: reticence
// drifts on the daily tick, so anything shorter than a day is not a flat stretch, it is a Tuesday.
// That was right. But the WINDOW those spans were checked against was chosen by COUNT,
// `history.slice(-8)`, and the daemon takes a reading every five minutes. Eight readings is forty
// minutes. So ten detectors demanded six to forty-eight hours from a window that could only ever be
// forty minutes long, and every one of them was DEAD IN THE DAEMON.
//
// Nothing caught it. Each half looked correct in isolation, the unit tests passed because a harness
// spaces its readings hours apart, and a detector that never fires is indistinguishable from a
// Resident who is fine. It needed three files to be read together to see: the span in vitals.ts, the
// slice in vitals.ts, and the interval in index.ts.
//
// So the three now derive from one place, and this file asserts the whole chain end to end at the
// REAL cadence rather than at a convenient one.

/** A series exactly as the daemon lays it down: one reading every MONITOR_EVERY_MS. */
function atRealCadence(hours: number): VitalsSnapshot[] {
  const start = Date.parse("2026-08-01T00:00:00Z");
  const n = Math.floor((hours * 3600_000) / MONITOR_EVERY_MS);
  return Array.from({ length: n }, (_, i) => ({ ts: start + i * MONITOR_EVERY_MS } as VitalsSnapshot));
}

describe("every trend can actually be judged at the cadence the daemon runs at", () => {
  it("each MIN_SPANS is reachable from a ring the daemon really keeps", () => {
    const ring = atRealCadence((ringSizeFor() * MONITOR_EVERY_MS) / 3600_000);
    for (const [name, span] of Object.entries(MIN_SPANS)) {
      const w = windowFor(ring, span, DEFAULT_THRESHOLDS.calcifyWindow);
      const covered = w[w.length - 1].ts - w[0].ts;
      expect(w.length, `${name}: too few readings to satisfy the count`).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.calcifyWindow);
      expect(covered, `${name}: window spans ${(covered / 3600_000).toFixed(1)}h, needs ${(span / 3600_000).toFixed(1)}h`).toBeGreaterThanOrEqual(span);
    }
  });

  it("the ring is long enough to hold the slowest trend, with room after a restart", () => {
    expect(ringSizeFor() * MONITOR_EVERY_MS).toBeGreaterThanOrEqual(2 * LONGEST_TREND_SPAN_MS);
  });

  it("and the daemon passes the WHOLE ring, not a fixed count", () => {
    // The specific line that was wrong. Asserted against the source, because this is exactly the
    // kind of thing that gets quietly reverted by someone making an unrelated change.
    const src = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8");
    expect(src, "detectAnomalies must be handed the full ring so each detector can pick its own window")
      .not.toMatch(/detectAnomalies\(vitalsStore\.recent\(\s*vitalsMod\.DEFAULT_THRESHOLDS/);
    expect(src).toMatch(/detectAnomalies\(\[?\.{0,3}vitalsStore\.recent\(vitalsStore\.size\(\)\)/);
    expect(src, "the monitor interval must be the one the spans were sized against")
      .toMatch(/runVitalsMonitor\(\); \}, vitalsMod\.MONITOR_EVERY_MS\)/);
  });

  it("and the liveness signature is handed the LONG view, not the fine ring", () => {
    // `detectAnomalies` defaults `longView` to `history` so a caller can never get none, but the
    // fine ring is hours and the signature's question is weeks, so a daemon that took the default
    // would get a permanent "too-early" and never report a dead wire again. That silence is exactly
    // what this whole area keeps failing as, so it is asserted rather than assumed.
    const src = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8");
    const calls = [...src.matchAll(/detectAnomalies\(/g)].map((m) => src.slice(m.index!, m.index! + 220));
    expect(calls.length, "both the monitor and /vitals detect").toBeGreaterThanOrEqual(2);
    for (const c of calls) {
      expect(c, `detectAnomalies must be passed the long view: ${c.slice(0, 90)}`).toMatch(/longView\(\)/);
    }
  });

  it("the long view really does reach back weeks", () => {
    expect(LONG_VIEW_SIZE * LONG_VIEW_EVERY_MS).toBeGreaterThanOrEqual(MIN_SPANS.signature);
  });
});

describe("windowFor is honest about what it found", () => {
  const ring = atRealCadence(72);

  it("satisfies BOTH the count and the span, never one at the other's expense", () => {
    const w = windowFor(ring, 24 * 3600_000, 8);
    expect(w.length).toBe(8);
    expect(w[w.length - 1].ts - w[0].ts).toBeGreaterThanOrEqual(24 * 3600_000);
  });

  it("keeps the newest and the oldest, so the reported span is the real one", () => {
    const w = windowFor(ring, 12 * 3600_000, 5);
    expect(w[w.length - 1]).toBe(ring[ring.length - 1]);
    expect(w.every((s, i) => i === 0 || s.ts > w[i - 1].ts), "chronological, no duplicates").toBe(true);
  });

  it("gives back a SHORT window when she genuinely has not lived long enough", () => {
    // The case that must not be papered over: a young daemon should get too little and the caller
    // should decline to judge, rather than being handed a window that pretends to span a week.
    const young = atRealCadence(1);
    const w = windowFor(young, 48 * 3600_000, 8);
    expect(w[w.length - 1].ts - w[0].ts).toBeLessThan(48 * 3600_000);
    expect(w.length).toBeGreaterThan(0);
  });

  it("survives the degenerate inputs", () => {
    expect(windowFor([], 1000, 4)).toEqual([]);
    expect(windowFor(ring, 1000, 0)).toEqual([]);
    expect(windowFor(ring, 0, 1)).toHaveLength(1);
    expect(windowFor(ring.slice(0, 1), 48 * 3600_000, 8)).toHaveLength(1);
  });
});
