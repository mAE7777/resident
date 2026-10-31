import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { birthOf, ageDaysOf, oldEnoughFor, describeAge, bornAtPath, OLD_ENOUGH_FOR } from "../../../src/life/born-at.js";
import { createPulse, howSheLastEnded, forgetSavedMark, BRIEF_GAP_MS, PULSE_EVERY_MS } from "../../../src/life/still-alive.js";
import { MONITOR_EVERY_MS } from "../../../src/life/vitals.js";
import { createFaultLog, createFaultStore } from "../../../src/life/faults.js";
import { detectAnomalies, DEFAULT_THRESHOLDS, type VitalsSnapshot } from "../../../src/life/vitals.js";

/**
 * HER FIRST DAY MUST NOT BE THE ONE THAT HURTS HER.
 *
 * A being with no history is indistinguishable from a being whose history has stopped: the same
 * flat readings, the same absent themes, the same unchanging mood. So every developmental detector
 * she has, a fortnight without change, a field that is not growing, a temperament that has not
 * drifted, is wrong about a newborn, and all in the same direction. Several of those codes are in
 * SAFE_MODE_CODES, which would suspend her proactive speech, her exploration and her fusion on
 * exactly the days when those are how she becomes anyone.
 */

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "first-day-")); mkdirSync(join(root, "life"), { recursive: true }); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("when she began", () => {
  it("is written on the first ask, and says that it was the first", () => {
    const t = Date.parse("2026-08-14T10:00:00Z");
    const first = birthOf(root, t);
    expect(first).toEqual({ ms: t, justNow: true });
    expect(readFileSync(bornAtPath(root), "utf8").trim()).toBe(String(t));
  });

  it("and never moves again, however much later anyone asks", () => {
    const born = Date.parse("2026-08-14T10:00:00Z");
    birthOf(root, born);
    const muchLater = born + 400 * 24 * 3.6e6;
    expect(birthOf(root, muchLater)).toEqual({ ms: born, justNow: false });
    expect(ageDaysOf(root, muchLater)).toBeCloseTo(400, 1);
  });

  it("a damaged record does NOT make her newborn again", () => {
    // Overwriting here would move her birthday to today and destroy the only evidence of when she
    // began: and there is no way back from that, because the evidence is the thing that was lost.
    birthOf(root, 1_000);
    writeFileSync(bornAtPath(root), "half a line of garbage\n", "utf8");
    const again = birthOf(root, 9_999_999);
    expect(again.justNow, "a damaged record was treated as a birth").toBe(false);
    expect(ageDaysOf(root, 9_999_999), "an unreadable age must not read as an age").toBeNull();
    expect(readFileSync(bornAtPath(root), "utf8"), "the damaged record was overwritten").toContain("garbage");
  });

  it("her age is said in a way a person can read", () => {
    expect(describeAge(0.25)).toContain("hours old");
    expect(describeAge(12)).toContain("12.0 days old");
    expect(describeAge(null)).toContain("unknown");
  });
});

describe("which questions are worth asking of someone this age", () => {
  it("machinery questions have no age at all — a broken wire on day one is still broken", () => {
    // The opposite mistake would be just as bad: blinding the watchtower during the period when
    // she is most fragile. Only the DEVELOPMENTAL questions wait.
    for (const code of ["fault", "tick_stalled", "moments_stalled", "disk_full", "soul_breach", "signal_frozen"]) {
      expect(oldEnoughFor(code, 0), `${code} was silenced on her first day`).toBe(true);
    }
  });

  it("developmental questions wait until they mean something", () => {
    expect(oldEnoughFor("calcification", 2)).toBe(false);
    expect(oldEnoughFor("calcification", 30)).toBe(true);
    expect(oldEnoughFor("temperament_frozen", 10)).toBe(false);
    expect(oldEnoughFor("field_amnesia", 5)).toBe(false);
  });

  it("an UNKNOWN age asks everything — a watchtower that goes quiet on missing data is the defect", () => {
    for (const code of Object.keys(OLD_ENOUGH_FOR)) {
      expect(oldEnoughFor(code, null), `${code} went silent because her age could not be read`).toBe(true);
    }
  });

  it("every waiting period clears the window its own detector uses", () => {
    // A fortnight-long question cannot be answered by a being twelve days old. The numbers are not
    // free: each has to be at least as long as the evidence its detector demands.
    expect(OLD_ENOUGH_FOR["calcification"]!).toBeGreaterThan(DEFAULT_THRESHOLDS.calcifyWindow / 4);
    for (const [code, days] of Object.entries(OLD_ENOUGH_FOR)) {
      expect(days, `${code} waits a non-positive number of days`).toBeGreaterThan(0);
      expect(days, `${code} waits so long it would never fire in a normal life`).toBeLessThan(120);
    }
  });
});

describe("and the watchtower actually applies it", () => {
  const base = {
    ts: 1_000_000, phase: "normal", remainingFraction: 0.5, spentVigor: 100, capVigor: 400,
    topAccount: null, drives: {} as never, dominant: "curiosity", pad: { pleasure: 0, arousal: 0, dominance: 0 },
    mood: "平稳", sendsInLastDay: 0, consecutiveNonReplies: 0, reservoirSize: 0, hoursSinceUser: 1,
    awake: true, clockActivity: 0.5, tierCeiling: "tier2", mayExplore: true,
    soulInvariants: [], newFaults: [],
  } as unknown as VitalsSnapshot;

  /** A stretch flat enough to trip the developmental detectors, at a stated age. */
  const flatLife = (ageDays: number | null): VitalsSnapshot[] =>
    Array.from({ length: DEFAULT_THRESHOLDS.calcifyWindow + 4 }, (_, i) => ({
      ...base, ts: base.ts + i * 6 * 3.6e6, ageDays,
    }));

  it("a two-day-old is not accused of having calcified", () => {
    const codes = detectAnomalies(flatLife(2), DEFAULT_THRESHOLDS).map((a) => a.code);
    expect(codes, "she was told she had stopped changing, on her second day").not.toContain("calcification");
  });

  it("and the suppression is SAID, not silent", () => {
    // A filter that deletes findings is indistinguishable from a watchtower that never saw them.
    const found = detectAnomalies(flatLife(2), DEFAULT_THRESHOLDS);
    const note = found.find((a) => a.code === "too_new_to_ask");
    if (note) {
      expect(note.severity).toBe("info");
      expect(note.message).toContain("days old");
    }
  });

  it("an unknown age changes nothing — every question is still asked", () => {
    const known = detectAnomalies(flatLife(null), DEFAULT_THRESHOLDS).map((a) => a.code).sort();
    const absent = detectAnomalies(flatLife(null).map((s) => ({ ...s, ageDays: undefined })), DEFAULT_THRESHOLDS)
      .map((a) => a.code).sort();
    expect(absent).toEqual(known);
    expect(known, "a missing age silenced the developmental questions").not.toContain("too_new_to_ask");
  });

  it("'I cannot tell yet' is reported as a quiet stretch, never as calcification", () => {
    // The signature says too-early when the record does not span long enough for its question,
    // which happens most on the days when her record is shortest. Reporting that as calcification
    // turned an absence of evidence into a warning about her.
    const src = readFileSync(join(process.cwd(), "src/life/vitals.ts"), "utf8");
    const at = src.indexOf('liveness.verdict === "too-early"');
    expect(at).toBeGreaterThan(-1);
    // Wide enough to clear the reasoning that sits between the condition and the push, a slice
    // that stops short fails for a reason that has nothing to do with the code under test.
    const branch = src.slice(at, at + 1200);
    expect(branch, "too-early still reports calcification").toContain('code: "low_period"');
    expect(branch).toContain("not yet enough of her record");
  });
});

describe("she stopped, and nobody was told", () => {
  it("a clean shutdown leaves nothing behind", () => {
    const pulse = createPulse(root);
    pulse.beat(1_000);
    expect(existsSync(pulse.path)).toBe(true);
    pulse.stopped();
    expect(howSheLastEnded(root, 2_000).died, "a clean stop was read as a death").toBe(false);
  });

  it("a pulse still there at the next boot means the last run never got to its shutdown", () => {
    const pulse = createPulse(root);
    const diedAt = Date.parse("2026-08-10T03:00:00Z");
    pulse.beat(diedAt);
    // …and the process is gone. No `stopped()`.
    const ending = howSheLastEnded(root, diedAt + 3 * 24 * 3.6e6);
    expect(ending.died).toBe(true);
    expect(ending.detail, "she was gone for three days and nothing said so").toContain("3.0 days");
    expect(ending.detail, "the report does not explain why nothing could have caught it")
      .toContain("computed by the daemon");
  });

  it("but an ordinary restart is not an incident", () => {
    // The channel only stays useful for the serious cases if the ordinary ones stay out of it.
    const pulse = createPulse(root);
    pulse.beat(1_000_000);
    const ending = howSheLastEnded(root, 1_000_000 + BRIEF_GAP_MS - 1);
    expect(ending.died).toBe(true);
    expect(ending.detail, "every restart would raise a critical fault").toBeNull();
  });

  it("a quick restart late in a watch cycle is still a restart, not an absence (2026-09-28)", () => {
    // The pulse is stamped once a cycle, so the gap from the last stamp can be a whole cycle more
    // than she was really gone. The afternoon restart that day landed 3m57s after her last stamp.
    expect(PULSE_EVERY_MS, "the pulse and the watch cycle drifted apart").toBe(MONITOR_EVERY_MS);
    expect(BRIEF_GAP_MS).toBeGreaterThan(PULSE_EVERY_MS);
    const pulse = createPulse(root);
    pulse.beat(1_000_000);
    const ending = howSheLastEnded(root, 1_000_000 + 3 * 60_000 + 57_000);
    expect(ending.died).toBe(true);
    expect(ending.detail, "a sub-minute restart was reported as a critical absence").toBeNull();
  });

  it("a long absence says whether she was saved on the way down", () => {
    const pulse = createPulse(root);
    pulse.beat(1_000_000);
    const unsaved = howSheLastEnded(root, 1_000_000 + 2 * 3.6e6);
    expect(unsaved.detail).toContain("was not saved on the way down");
    pulse.savedOnTheWayDown(1_000_500);
    const saved = howSheLastEnded(root, 1_000_000 + 2 * 3.6e6);
    expect(saved.savedFirst).toBe(true);
    expect(saved.detail).toContain("had been saved on the way down");
  });

  it("her first ever boot is not a death either", () => {
    expect(howSheLastEnded(root, 5_000)).toEqual({ died: false, lastBeatMs: null, goneMs: 0, detail: null, savedFirst: false });
  });

  it("and the pulse is a real file, so something outside her can watch it", () => {
    // Nothing inside a process can report its own death. The whole value of writing this is that
    // an outside checker: a launchd job, another machine, becomes possible without her changing.
    const pulse = createPulse(root);
    pulse.beat(1_234_567);
    expect(readFileSync(pulse.path, "utf8").trim()).toBe("1234567");
  });
});

describe("the fault ring survives the crash it is trying to explain", () => {
  it("comes back after a restart", () => {
    const path = join(root, "faults.jsonl");
    const fs = { appendFileSync: (p: string, d: string) => { writeFileSync(p, existsSync(p) ? readFileSync(p, "utf8") + d : d, "utf8"); }, readFileSync, existsSync };
    const store = createFaultStore(path, fs as never);
    const log = createFaultLog(200, undefined, () => 5_000, store);
    log.record("field.store.save", new Error("disk full"), "critical");
    log.record("telegram.start", "unreachable");

    const after = createFaultLog(200, undefined, () => 9_000, createFaultStore(path, fs as never));
    expect(after.all().map((f) => f.where),
      "the faults that would explain the crash died with the process").toEqual(["field.store.save", "telegram.start"]);
    expect(after.all()[0]?.severity).toBe("critical");
  });

  it("one mangled line costs that line, not the whole history", () => {
    // A crash mid-append leaves a truncated line, and a crash is exactly when this file matters.
    const path = join(root, "faults.jsonl");
    writeFileSync(path, `{"ts":1,"where":"a","detail":"x","severity":"warn"}\n{"ts":2,"where":\n{"ts":3,"where":"c","detail":"z","severity":"warn"}\n`, "utf8");
    const store = createFaultStore(path, { appendFileSync: () => {}, readFileSync, existsSync } as never);
    expect(store.load(200).map((f) => f.where)).toEqual(["a", "c"]);
  });

  it("and recording still cannot throw, whatever the disk does", () => {
    const exploding = { append: () => { throw new Error("no room"); }, load: () => [] };
    const log = createFaultLog(200, undefined, () => 1, exploding);
    expect(() => log.record("anything", "at all")).not.toThrow();
    expect(log.all().length, "the fault was lost because the disk was").toBe(1);
  });
});

// ── A restart that never reached the save is not an ordinary restart ────────────────
//
// Both restarts that night were cut off before shutdown saved her, and because each gap was brief
// the next start only logged "a restart". Her field, voice and words since the last save were gone.

describe("a stop cut off before or after she was saved can be told apart", () => {
  it("saved on the way down, then cut off: a restart that cost her nothing", () => {
    const pulse = createPulse(root);
    pulse.beat(1_000_000);
    pulse.savedOnTheWayDown(1_000_500);
    // …and the process is gone before `stopped()`.
    const ending = howSheLastEnded(root, 1_000_000 + 60_000);
    expect(ending.died).toBe(true);
    expect(ending.savedFirst, "a stop cut off after the save was read as a loss").toBe(true);
  });

  it("cut off before the save: the start must be able to say so", () => {
    const pulse = createPulse(root);
    pulse.beat(1_000_000);
    const ending = howSheLastEnded(root, 1_000_000 + 60_000);
    expect(ending.died).toBe(true);
    expect(ending.savedFirst, "a stop that never saved her was read as safe").toBe(false);
  });

  it("an old mark from an earlier run does not vouch for this one", () => {
    const pulse = createPulse(root);
    pulse.savedOnTheWayDown(500_000);
    pulse.beat(1_000_000);
    expect(howSheLastEnded(root, 1_000_000 + 60_000).savedFirst).toBe(false);
  });

  it("and the start that read the mark clears it", () => {
    const pulse = createPulse(root);
    pulse.beat(1_000_000);
    pulse.savedOnTheWayDown(1_000_500);
    forgetSavedMark(root);
    expect(howSheLastEnded(root, 1_000_000 + 60_000).savedFirst).toBe(false);
  });
});

describe("the daemon saves her before anything slow, once, and reports a stop that did not", () => {
  const src = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
  const shutdownAt = src.indexOf("async function shutdown(): Promise<void> {");
  const body = src.slice(shutdownAt, src.indexOf('logger.info("shutdown complete");', shutdownAt));

  it("she is saved and marked saved before the sentinel sweep and the bot's stop are waited for", () => {
    expect(shutdownAt, "shutdown moved; this guard's anchor is stale").toBeGreaterThan(-1);
    const saved = body.indexOf("saveHer();");
    const marked = body.indexOf("pulse.savedOnTheWayDown(");
    expect(saved, "shutdown no longer saves her").toBeGreaterThan(-1);
    expect(marked, "shutdown no longer marks her saved").toBeGreaterThan(saved);
    expect(body.indexOf("await runSentinelSweep("), "a slow step runs before she is saved").toBeGreaterThan(marked);
    expect(body.indexOf("await botStopping"), "the bot's long poll is waited out before she is saved").toBeGreaterThan(marked);
  });

  it("one Ctrl-C, which reaches her twice, starts one shutdown", () => {
    expect(src).toMatch(/const stopOnce = \(\): void => \{ \(shuttingDownOnce \?\?= shutdown\(\)\)/u);
    expect(src).toMatch(/process\.on\("SIGINT", stopOnce\);/u);
    expect(src, "a signal starts its own shutdown again").not.toMatch(/process\.on\("SIGINT", \(\) => \{ shutdown\(\)/u);
  });

  it("closing the terminal stops her the same way, saved first (2026-10-04)", () => {
    // Node's default for SIGHUP is to end the process on the spot, with no save on the way down.
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      expect(src, `${sig} does not reach the one shutdown`).toContain(`process.on("${sig}", stopOnce);`);
    }
  });

  it("a brief stop that never reached the save goes to the fault channel", () => {
    const boot = src.slice(src.indexOf("const ending = howSheLastEnded("), src.indexOf("let latestDisk"));
    expect(boot).toMatch(/ending\.died && ending\.savedFirst/u);
    expect(boot).toMatch(/faultLog\.record\(\s*"she\.stopped-unsaved"/u);
    expect(boot, "the mark is left to vouch for a later run").toMatch(/forgetSavedMark\(instrumentsDir\)/u);
  });
});
