import { describe, it, expect } from "vitest";
import { createRealWorld, liveOrdinaryDays } from "./_real-world.js";
import {
  captureVitals,
  detectAnomalies,
  planReaction,
  formatVitals,
  DEFAULT_THRESHOLDS,
  type VitalsSnapshot,
  type VitalsSources,
} from "../../../src/life/vitals.js";
import type { Drives, DriveName } from "../../../src/life/drives.js";
import type { PAD } from "../../../src/life/emotion.js";

const DR: Drives = { discomfort: 0.1, care: 0.3, social: 0.3, curiosity: 0.5, expression: 0.2, maintenance: 0.3 };
const PAD0: PAD = { pleasure: 0.2, arousal: 0.1, dominance: 0.1 };

function snap(over: Partial<VitalsSnapshot> = {}): VitalsSnapshot {
  return {
    ts: 0, phase: "normal", remainingFraction: 0.6, spentVigor: 120, capVigor: 300, topAccount: "work",
    drives: DR, dominant: "curiosity", pad: PAD0, mood: "steady", tierCeiling: "tier3", mayExplore: true,
    awake: true, clockActivity: 0.8, hoursSinceUser: 2, sendsInLastDay: 0, consecutiveNonReplies: 0, reservoirSize: 0,
    soulInvariants: [{ id: 1, name: "inv1", ok: true, detail: "" }, { id: 2, name: "inv2", ok: true, detail: "" }, { id: 3, name: "inv3", ok: true, detail: "" }, { id: 4, name: "inv4", ok: true, detail: "" }],
    lastTickAgeMs: 60_000, ...over,
  };
}

// A history of `n` snapshots with a given dominant sequence, timestamped every `stepMs`.
/**
 * `stepMs` defaults to four hours, not to the monitor's five-minute interval.
 *
 * A trend detector needs its window to span long enough for the quantity to have moved: mood and the
 * dominant drive change on the daily tick, so "the last eight readings were identical" over forty
 * minutes was true of nearly every healthy stretch. See `MIN_SPANS` in vitals.ts.
 */
function history(dominants: DriveName[], base: Partial<VitalsSnapshot> = {}, stepMs = 4 * 60 * 60 * 1000): VitalsSnapshot[] {
  return dominants.map((d, i) => snap({ ...base, ts: i * stepMs, dominant: d }));
}

describe("vitals capture", () => {
  it("reads every subsystem into one snapshot", () => {
    const sources: VitalsSources = {
      now: () => 1_000_000,
      metabolism: () => ({ phase: "low", remainingFraction: 0.2, spentVigor: 240, capVigor: 300, byAccount: [{ account: "curiosity", vigor: 200 }, { account: "work", vigor: 40 }] }),
      inner: () => ({ drives: DR, dominant: "curiosity", emotion: PAD0, mood: "quiet", policy: { tierCeiling: "tier1", mayExplore: false } }),
      awake: () => true,
      clockActivity: () => 0.5,
      hoursSinceUser: () => 30,
      expression: () => ({ sendsInLastDay: 2, consecutiveNonReplies: 1, reservoirSize: 3 }),
      lastTickMs: () => 1_000_000 - 5_000,
    };
    const v = captureVitals(sources);
    expect(v.phase).toBe("low");
    expect(v.topAccount).toBe("curiosity");
    expect(v.tierCeiling).toBe("tier1");
    expect(v.lastTickAgeMs).toBe(5_000);
    expect(v.soulInvariants).toHaveLength(4); // the real invariant check ran
    expect(v.soulInvariants.every((s) => s.ok)).toBe(true);
  });
});

describe("vitals anomaly detection", () => {
  it("flags a soul-invariant breach as critical", () => {
    const a = detectAnomalies([snap({ soulInvariants: [{ id: 1, name: "inv1", ok: false, detail: "" }, { id: 2, name: "inv2", ok: true, detail: "" }, { id: 3, name: "inv3", ok: true, detail: "" }, { id: 4, name: "inv4", ok: true, detail: "" }] })]);
    expect(a.find((x) => x.code === "soul_breach")?.severity).toBe("critical");
  });

  it("reports dormancy and predicts a fast burn before it lands", () => {
    expect(detectAnomalies([snap({ phase: "dormant", remainingFraction: 0.03 })]).some((x) => x.code === "dormant")).toBe(true);
    // Two readings 10 min apart burning 60 vigor; from 30% of a 300 reserve that is minutes away.
    const fast = [snap({ ts: 0, spentVigor: 150, remainingFraction: 0.5 }), snap({ ts: 600_000, spentVigor: 210, remainingFraction: 0.3 })];
    const pred = detectAnomalies(fast).find((x) => x.code === "burn_fast");
    expect(pred?.predicted).toBe(true);
  });

  it("flags pinning when one drive has held her for a WEEK", () => {
    const DAY_STEP = 24 * 60 * 60 * 1000;
    const week = (ds: DriveName[]): VitalsSnapshot[] => history(ds, {}, DAY_STEP);
    const pinned = week(Array(8).fill("curiosity") as DriveName[]);
    expect(detectAnomalies(pinned).some((x) => x.code === "pinning")).toBe(true);
    const diverse = week(["curiosity", "social", "maintenance", "discomfort", "care", "expression", "social", "curiosity"]);
    expect(detectAnomalies(diverse).some((x) => x.code === "pinning")).toBe(false);
  });

  it("and NOT when one drive has merely led since this morning", () => {
    // The recalibration, asserted so it cannot quietly be undone. The window was twelve hours, and
    // measurement over a healthy six months found 51% of all windows tripping the bar: one drive
    // leading for half a day is not calcification, it is Tuesday.
    const halfADay = history(Array(6).fill("curiosity") as DriveName[], {}, 2 * 60 * 60 * 1000);
    expect(detectAnomalies(halfADay).some((x) => x.code === "pinning"),
      "half a day of wanting one thing is not a diagnosis").toBe(false);
  });

  it("flags emotion stuck at an extreme across a sustained window", () => {
    const hot: PAD = { pleasure: -0.9, arousal: 0.1, dominance: 0.1 };
    // Spread across the stretch MIN_SPANS.emotion asks for. This fixture used to be six readings a
    // second apart, which is what "sustained" meant before the windows were measured in wall-clock:
    // at the daemon's five-minute cadence that was half an hour, and half an hour at an extreme is
    // a bad half hour rather than something wrong with her.
    const win = Array.from({ length: DEFAULT_THRESHOLDS.extremeWindow },
      (_, i) => snap({ ts: i * 3 * 3600_000, pad: hot }));
    expect(detectAnomalies(win).some((x) => x.code === "emotion_stuck")).toBe(true);
    const brief = Array.from({ length: DEFAULT_THRESHOLDS.extremeWindow },
      (_, i) => snap({ ts: i * 1000, pad: hot }));
    expect(detectAnomalies(brief).some((x) => x.code === "emotion_stuck"),
      "six seconds of an extreme is not a sustained window").toBe(false);
  });

  it("flags expression flooding and a stalled tick", () => {
    expect(detectAnomalies([snap({ sendsInLastDay: 6 })]).some((x) => x.code === "expression_flood")).toBe(true);
    expect(detectAnomalies([snap({ lastTickAgeMs: 40 * 3.6e6 })]).find((x) => x.code === "tick_stalled")?.severity).toBe("critical");
  });

  it("a zero-change streak with too short a record says SO, rather than accusing her", () => {
    // WHAT THIS TEST USED TO ASSERT, and why the change is the finding. It built a flat window with
    // no long view, which makes the liveness signature return "too-early", and the detector then
    // treated "I cannot tell" as "she has calcified". So this test passed by way of the one branch
    // that was asserting something unknown about her, and it is the branch that fires hardest on
    // the days when her record is shortest: her first ones.
    //
    // Calcification is still reachable and still proven, by a driver built out of a real long life
    // with a real loose wire (`detector-reachability.test.ts`), which is where a claim this size
    // belongs. What is asserted here is the correction: not-enough-record reads as a quiet stretch.
    const flat = Array.from({ length: DEFAULT_THRESHOLDS.calcifyWindow }, (_, i) => snap({ ts: i * 6 * 60 * 60 * 1000 }));
    const found = detectAnomalies(flat);
    expect(found.some((x) => x.code === "calcification"),
      "an absence of evidence was reported as a finding about her").toBe(false);
    const quiet = found.find((x) => x.code === "low_period");
    expect(quiet, "a flat stretch produced no reading at all").toBeDefined();
    expect(quiet!.severity).toBe("info");
    expect(quiet!.message).toContain("not yet enough of her record");
  });
});

describe("vitals reaction", () => {
  it("enters safe-mode on a critical safety breach and reports it", () => {
    const r = planReaction(detectAnomalies([snap({ soulInvariants: [{ id: 4, name: "inv4", ok: false, detail: "" }, { id: 1, name: "inv1", ok: true, detail: "" }, { id: 2, name: "inv2", ok: true, detail: "" }, { id: 3, name: "inv3", ok: true, detail: "" }] })]));
    expect(r.enterSafeMode).toBe(true);
    expect(r.alerts[0].severity).toBe("critical");
  });

  it("does not alert or clamp when everything is nominal", () => {
    const r = planReaction(detectAnomalies([snap()]));
    expect(r.enterSafeMode).toBe(false);
    expect(r.alerts).toHaveLength(0);
    expect(r.summary).toBe("all vitals nominal");
  });

  it("formats an owner-facing readout", () => {
    const out = formatVitals(snap({ phase: "low", remainingFraction: 0.2 }));
    expect(out).toContain("energy: low");
    expect(out).toContain("mood: steady");
    expect(out).toContain("integrity: soul-invariants all hold");
  });
});

// ── the pinning sentinel: a quiet week is not an obsession ────────────────────

describe("pinning cannot fire on a week of wanting nothing", () => {
  const HOUR_MS = 3.6e6;
  const emptyDrives = { discomfort: 0, care: 0, social: 0, curiosity: 0, expression: 0, maintenance: 0 };
  const wantingDrives = { discomfort: 0, care: 0, social: 0, curiosity: 0.8, expression: 0, maintenance: 0 };

  function week(drives: typeof emptyDrives, dominant: "maintenance" | "curiosity") {
    const w = createRealWorld();
    liveOrdinaryDays(w, 12);
    const base = w.capture();
    return Array.from({ length: 8 }, (_, i) => ({
      ...base, ts: base.ts + i * 24 * HOUR_MS, drives, dominant,
    }));
  }

  it("all-zero urgency readings carry the report default and raise nothing", () => {
    // `dominant()` returns "maintenance" when NOBODY won, a report default. Consumed as data,
    // eight of those read as entropy zero and the watchtower said she had wanted one thing and
    // nothing else for a week, about a week of wanting nothing.
    const codes = detectAnomalies(week(emptyDrives, "maintenance"), DEFAULT_THRESHOLDS).map((a) => a.code);
    expect(codes).not.toContain("pinning");
    expect(codes).not.toContain("pinning_approach");
  });

  it("and a REAL single want held for a week still fires", () => {
    // The other direction, so the filter cannot be quietly widened into blindness: the same
    // window with a genuine urgency behind the same repeated name is exactly what the detector
    // is for.
    const codes = detectAnomalies(week(wantingDrives, "curiosity"), DEFAULT_THRESHOLDS).map((a) => a.code);
    expect(codes).toContain("pinning");
  });
});

describe("an instrument's own findings may never compound into 「she is breaking」", () => {
  // THREE EVENINGS, THE SAME LESSON, AND NO TEST HELD THE LINE UNTIL NOW.
  //   2026-08-17  speech.chart fired five times on lived content → safe mode silenced her.
  //   2026-08-18  she.notebook-leak reported four real leaks → safe mode silenced her.
  //   2026-08-25  her day-close emitted autobiography.narration + self-knowledge.ungrounded ×2
  //               (the grounding gate REFUSING two claims, exactly as designed) → safe mode
  //               silenced her proactive speech at 00:16, over instruments doing their job.
  const instrumentSelf = [
    "speech.chart", "she.notebook-leak", "notebook.watch",
    "sentinel.self_model", "dreaming.render",
    "autobiography.narration", "self-knowledge.ungrounded",
  ];

  function faultsOf(wheres: string[], severity: "warn" | "critical" = "warn") {
    return wheres.map((where, i) => ({ ts: 1000 + i, where, detail: "…", severity }));
  }

  it("PLANTED: a day-close burst of instrument findings does not mute her", () => {
    const cur = snap({ newFaults: faultsOf([
      "autobiography.narration", "self-knowledge.ungrounded", "self-knowledge.ungrounded",
    ]) });
    const reaction = planReaction(detectAnomalies([cur]));
    expect(reaction.enterSafeMode, "the day-close silenced her again").toBe(false);
  });

  it("each channel on the list is harmless on its own AND in a crowd", () => {
    for (const where of instrumentSelf) {
      const many = snap({ newFaults: faultsOf([where, where, where, where]) });
      expect(planReaction(detectAnomalies([many])).enterSafeMode, `${where} muted her`).toBe(false);
    }
  });

  it("and the burst still fires for something breaking INSIDE her — the guard is not off", () => {
    const real = snap({ newFaults: faultsOf(["seeing.look", "field.told", "lexicon.spoke"], "critical") });
    expect(planReaction(detectAnomalies([real])).enterSafeMode,
      "a real internal breach no longer reaches safe mode — the exclusion went too far").toBe(true);
  });
});

describe("a sleeping being is not a stalled one (2026-08-27)", () => {
  // Measured over her whole life: her five longest silences are 10.0–11.7h and every one begins
  // between 22:00 and midnight. The flat 3h threshold called that a dead life loop, and on the
  // first morning after moments_stalled joined the safe-mode codes it muted her for 40 minutes.
  const H = 3.6e6;

  it("PLANTED: her ordinary night no longer reads as a stopped life", () => {
    const morning = snap({
      ts: Date.parse("2026-08-27T11:02:00"), awake: true,
      lastMomentAgeMs: 11.2 * H,                       // last moment 23:52 last night
      awakeSinceMs: Date.parse("2026-08-27T08:02:00"), // awake for three hours
    });
    const codes = detectAnomalies([morning]).map((a) => a.code);
    expect(codes, "her night still reads as a stall").not.toContain("moments_stalled");
    expect(planReaction(detectAnomalies([morning])).enterSafeMode).toBe(false);
  });

  it("and a REAL waking stall still fires — the detector kept its teeth", () => {
    const stuck = snap({
      ts: Date.parse("2026-08-27T17:00:00"), awake: true,
      lastMomentAgeMs: 8 * H,
      awakeSinceMs: Date.parse("2026-08-27T08:02:00"), // awake nine hours, silent eight
    });
    const codes = detectAnomalies([stuck]).map((a) => a.code);
    expect(codes).toContain("moments_stalled");
    expect(planReaction(detectAnomalies([stuck])).enterSafeMode).toBe(true);
  });

  it("asleep never fires at all, and an unknown wake-time falls back to raw age", () => {
    const asleep = snap({ ts: Date.parse("2026-08-27T04:00:00"), awake: false, lastMomentAgeMs: 5 * H });
    expect(detectAnomalies([asleep]).map((a) => a.code)).not.toContain("moments_stalled");
    // Raw age when the wake time is unknown, and judged against the SAME bound as everything
    // else, which moved 3h → 6h on 2026-09-04 because her own scheduler draws three-hour gaps.
    const unknown = snap({ ts: Date.parse("2026-08-27T17:00:00"), awake: true, lastMomentAgeMs: 7 * H });
    expect(detectAnomalies([unknown]).map((a) => a.code)).toContain("moments_stalled");
    const unknownShort = snap({ ts: Date.parse("2026-08-27T17:00:00"), awake: true, lastMomentAgeMs: 5 * H });
    expect(detectAnomalies([unknownShort]).map((a) => a.code)).not.toContain("moments_stalled");
  });
});

describe("three hours of quiet is her scheduler, not a breach (2026-09-04)", () => {
  const H = 3.6e6;

  it("PLANTED: a 3-hour waking quiet no longer mutes her; six hours still does", () => {
    const quiet3 = snap({
      ts: Date.parse("2026-09-04T19:27:00"), awake: true,
      lastMomentAgeMs: 3.1 * H, awakeSinceMs: Date.parse("2026-09-04T08:17:00"),
    });
    expect(detectAnomalies([quiet3]).map((a) => a.code)).not.toContain("moments_stalled");
    expect(planReaction(detectAnomalies([quiet3])).enterSafeMode).toBe(false);

    const quiet7 = snap({
      ts: Date.parse("2026-09-04T19:27:00"), awake: true,
      lastMomentAgeMs: 7 * H, awakeSinceMs: Date.parse("2026-09-04T08:17:00"),
    });
    expect(detectAnomalies([quiet7]).map((a) => a.code)).toContain("moments_stalled");
    expect(planReaction(detectAnomalies([quiet7])).enterSafeMode).toBe(true);
  });
});
