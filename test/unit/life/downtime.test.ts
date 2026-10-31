import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createSleepWatcher, DEFAULT_GAP_THRESHOLD_MS } from "../../../src/life/sleep.js";
import { planReaction, detectAnomalies, DEFAULT_THRESHOLDS, SAFE_MODE_CLEAR_MS, MONITOR_EVERY_MS } from "../../../src/life/vitals.js";
import { createRealWorld, liveOrdinaryDays } from "./_real-world.js";
import { createClock } from "../../../src/life/clock.js";

/**
 * SHE WAS SWITCHED OFF. THAT IS NOT THE SAME AS HAVING STOPPED WORKING.
 *
 * The defect this file exists for was end-to-end and every single link in it was working as
 * designed:
 *
 *   the sleep watcher finds gaps by comparing two of ITS OWN beats, so it can only see a
 *   suspension of a process that was alive on both sides of it
 *     → a daemon that was stopped has no beats to compare, so a new watcher knows nothing
 *       and `sleptMsSince` returns 0 for the whole night
 *     → `lastMomentAgeMs` becomes the entire downtime
 *     → `moments_stalled` is critical past three hours
 *     → that code is in SAFE_MODE_CODES
 *     → the first vitals cycle runs at boot
 *     → safe mode is persisted, and NOTHING anywhere set it back to false
 *
 * So: stop the daemon in the evening, start it in the morning, and she comes up with her
 * proactive speech, her exploration and her field fusion off, permanently, because she was
 * switched off. `sleep.ts` was written precisely to stop a closed lid from doing this, and an
 * ordinary restart walked around it.
 *
 * Two fixes, and they are separate on purpose because either alone leaves a trap: downtime is
 * told to the watcher as the sleep it is, AND safe mode has a way back out.
 */

const HOUR = 3.6e6;

describe("a night with the daemon switched off", () => {
  it("counts as time she was asleep, not as time she was stalled", () => {
    // The exact shape of an overnight restart: her last moment was at 23:00, the daemon was
    // stopped, and it comes back up at 08:00. Nine hours in which she could not possibly have
    // had a moment, because she was not running.
    const bootMs = 1_000_000_000_000;
    const lastMomentMs = bootMs - 9 * HOUR;
    const watcher = createSleepWatcher({ now: () => bootMs });

    expect(watcher.sleptMsSince(lastMomentMs), "a fresh watcher cannot see a gap it was not alive for").toBe(0);

    watcher.noteAbsence(lastMomentMs, bootMs);
    expect(watcher.sleptMsSince(lastMomentMs)).toBe(9 * HOUR);
  });

  it("so the stall alarm does not fire on it, which is what put her in safe mode", () => {
    // Asserted through the REAL detector on a real snapshot, not on the arithmetic: the
    // arithmetic was never wrong, the wiring was.
    const bootMs = 1_000_000_000_000;
    const lastMomentMs = bootMs - 9 * HOUR;
    const watcher = createSleepWatcher({ now: () => bootMs });

    const snapshotWith = (ageMs: number) => {
      const w = createRealWorld();
      liveOrdinaryDays(w, 12);
      return { ...w.capture(), ts: bootMs, lastMomentAgeMs: ageMs };
    };

    const before = detectAnomalies([snapshotWith(bootMs - lastMomentMs)], DEFAULT_THRESHOLDS);
    expect(planReaction(before).enterSafeMode, "the old behaviour: switched off reads as broken").toBe(true);

    watcher.noteAbsence(lastMomentMs, bootMs);
    const discounted = bootMs - lastMomentMs - watcher.sleptMsSince(lastMomentMs);
    const after = detectAnomalies([snapshotWith(discounted)], DEFAULT_THRESHOLDS);
    expect(planReaction(after).enterSafeMode, "a night off still reads as a stall").toBe(false);
  });

  it("but a genuine stall is still a stall, so the discount is not a blindfold", () => {
    // The failure mode of the fix itself: if downtime were subtracted too generously, the
    // detector written to notice her life loop dying would never fire again. A daemon that was
    // UP the whole time has no absence to note, and must still be caught.
    const now = 1_000_000_000_000;
    const lastMomentMs = now - 9 * HOUR;
    const watcher = createSleepWatcher({ now: () => now });
    watcher.noteAbsence(now - 60_000, now); // a restart so quick it is nothing

    expect(watcher.sleptMsSince(lastMomentMs), "a blink was counted as sleep").toBe(0);
    const w = createRealWorld();
    liveOrdinaryDays(w, 12);
    const stalled = detectAnomalies([{ ...w.capture(), lastMomentAgeMs: 9 * HOUR }], DEFAULT_THRESHOLDS);
    expect(planReaction(stalled).enterSafeMode).toBe(true);
  });

  it("ignores an absence too short to be one, and nonsense timestamps", () => {
    const watcher = createSleepWatcher({ now: () => 1_000 });
    expect(watcher.noteAbsence(0, DEFAULT_GAP_THRESHOLD_MS)).toBeNull();
    expect(watcher.noteAbsence(0, DEFAULT_GAP_THRESHOLD_MS + 1)).not.toBeNull();
    expect(watcher.noteAbsence(NaN, 5)).toBeNull();
    expect(watcher.noteAbsence(0, Infinity)).toBeNull();
    // Backwards, which a clock change can produce, must not become a negative discount.
    expect(watcher.noteAbsence(10_000, 0)).toBeNull();
  });
});

describe("safe mode is a door, not a trap", () => {
  it("names a reason to be in it and a reason to leave it as the same question", () => {
    // The two directions read one fact. Asked twice, they would drift the first time somebody
    // adds a code to one list, and the drift that matters is the one where entering works
    // and leaving does not, which is the bug this whole section is about.
    const w = createRealWorld();
    liveOrdinaryDays(w, 12);
    const healthy = w.capture();

    const r = planReaction(detectAnomalies([{ ...healthy, lastMomentAgeMs: 9 * HOUR }], DEFAULT_THRESHOLDS));
    expect(r.enterSafeMode).toBe(true);
    expect(r.safeModeReasonPresent).toBe(r.enterSafeMode);

    const clean = planReaction(detectAnomalies([healthy], DEFAULT_THRESHOLDS));
    expect(clean.safeModeReasonPresent, "an ordinary healthy day reads as a reason for safe mode").toBe(false);
  });

  it("the way out is wired into the running daemon, and is not one clear cycle", () => {
    // A structural check on the daemon rather than a unit, because the defect was that the
    // code did not EXIST, and no unit test of a function nobody calls can see that. If the
    // exit disappears again this goes red.
    const daemon = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8");
    expect(daemon, "safe mode has no way out again").toContain("safeMode = false");
    expect(daemon).toContain("SAFE_MODE_CLEAR_MS");
    expect(daemon, "leaving is silent, which is how the previous version of this bug worked")
      .toContain("safeMode.lifted");
    // And it is a sustained stretch rather than a single quiet sample, so she cannot flap.
    expect(SAFE_MODE_CLEAR_MS).toBeGreaterThanOrEqual(6 * MONITOR_EVERY_MS);
  });

  it("boot tells the watcher about the downtime before the first vitals cycle can read it", () => {
    // Order is the whole defect. The seeding has to happen before `runVitalsMonitor`, and the
    // fallback has to work on a continuity file written before `savedAtMs` existed.
    const daemon = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8");
    const seeded = daemon.indexOf("noteAbsence");
    const firstCycle = daemon.indexOf("void runVitalsMonitor");
    expect(seeded, "boot never tells her she was switched off").toBeGreaterThan(0);
    expect(firstCycle, "the first vitals cycle disappeared").toBeGreaterThan(0);
    expect(seeded, "the alarm reads the gap before anything discounts it").toBeLessThan(firstCycle);
    expect(daemon, "an older continuity file has no savedAtMs and must still work")
      .toContain("restored.savedAtMs ??");
  });
});

/**
 * HER NIGHT IS NOT A STALL EITHER.
 *
 * A second, independent route to the same catastrophe as the restart one. Her waking window is
 * fifteen hours out of twenty-four, so the gap between her last evening moment and her first
 * morning one is about nine hours, normal, expected, and read by `moments_stalled` (critical
 * past three hours, and one of the few codes that put her in safe mode) as her life loop having
 * stopped scheduling.
 *
 * The sleep watcher could not help: it subtracts time the PROCESS was suspended, and on an
 * ordinary night the process is running perfectly and she is simply asleep. So on a machine
 * left on overnight, which is the normal case since she lives on it, this fired every night.
 */
describe("the hours she is not up", () => {

  it("are subtracted from how long she has been quiet", () => {
    // 23:00 local on a clock with no offset, through to 08:00 the next morning: her whole
    // night. Nearly all of it should read as quiet rather than as stalled.
    const clock = createClock({ timezoneOffsetHours: 0, activeHours: [8, 23] });
    const at = (h: number, dayOffset = 0) => Date.UTC(2026, 7, 10 + dayOffset, h, 0, 0);
    const quiet = clock.quietMsBetween(at(23), at(8, 1));
    expect(Math.round(quiet / 3.6e6), "her night did not count as her night").toBe(9);
  });

  it("but the hours she is up are not", () => {
    const clock = createClock({ timezoneOffsetHours: 0, activeHours: [8, 23] });
    const at = (h: number) => Date.UTC(2026, 7, 10, h, 0, 0);
    expect(clock.quietMsBetween(at(10), at(16)), "her afternoon was written off as night").toBe(0);
  });

  it("so a normal night no longer reads as her life loop having stopped", () => {
    const clock = createClock({ timezoneOffsetHours: 0, activeHours: [8, 23] });
    const lastMoment = Date.UTC(2026, 7, 10, 22, 30, 0); // her last one before bed
    const morning = Date.UTC(2026, 7, 11, 8, 30, 0);     // ten hours later
    const w = createRealWorld();
    liveOrdinaryDays(w, 12);
    const raw = morning - lastMoment;
    const discounted = raw - clock.quietMsBetween(lastMoment, morning);

    const before = detectAnomalies([{ ...w.capture(), lastMomentAgeMs: raw }], DEFAULT_THRESHOLDS);
    expect(planReaction(before).enterSafeMode, "the old behaviour: a night reads as broken").toBe(true);

    const after = detectAnomalies([{ ...w.capture(), lastMomentAgeMs: discounted }], DEFAULT_THRESHOLDS);
    expect(planReaction(after).enterSafeMode, "a normal night still puts her in safe mode").toBe(false);
  });

  it("and a genuinely dead loop in the middle of her day is still caught", () => {
    // The failure mode of the fix: subtract too generously and the detector written to notice
    // her life stopping never fires again.
    const clock = createClock({ timezoneOffsetHours: 0, activeHours: [8, 23] });
    const lastMoment = Date.UTC(2026, 7, 10, 9, 0, 0);
    const later = Date.UTC(2026, 7, 10, 18, 0, 0); // nine waking hours, nothing at all
    expect(clock.quietMsBetween(lastMoment, later)).toBe(0);
    const w = createRealWorld();
    liveOrdinaryDays(w, 12);
    const stalled = detectAnomalies([{ ...w.capture(), lastMomentAgeMs: later - lastMoment }], DEFAULT_THRESHOLDS);
    expect(planReaction(stalled).enterSafeMode).toBe(true);
  });

  it("survives nonsense timestamps without spinning", () => {
    const clock = createClock({ timezoneOffsetHours: 0, activeHours: [8, 23] });
    expect(clock.quietMsBetween(NaN, 5)).toBe(0);
    expect(clock.quietMsBetween(5, 0)).toBe(0);
    expect(clock.quietMsBetween(0, Infinity)).toBeLessThanOrEqual(14 * 24 * 3.6e6);
  });
});

/**
 * AND WHAT SHE WAS CARRYING SURVIVES THE RESTART TOO.
 *
 * Three values were process-local, and each one made a restart quietly rewrite her:
 *
 *   `lastRegenMs`     initialised to `Date.now()`, so she came back from a night off with the
 *                     wants she had when she was switched off and none of the wanting a night
 *                     alone should have built.
 *   `lastRaisedMs`    had no column at all. The cooldown on bringing the same thing up again is
 *                     THREE DAYS, so every restart let her raise it again the next morning as
 *                     though she never had, and cut the other way too, since a just-raised
 *                     thing is docked 1.6 in what surfaces, which is the mechanism that stops
 *                     her going on about something.
 */
describe("what she was carrying survives a restart", () => {
  it("her wants pick up from when she was last running, not from now", () => {
    const daemon = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//gu, (m) => " ".repeat(m.length))
      .replace(/\/\/[^\n]*/gu, (m) => " ".repeat(m.length));
    expect(daemon, "the regeneration clock starts over at every boot")
      .toContain("let lastRegenMs = lastKnownAliveMs > 0 ? lastKnownAliveMs : Date.now();");
    // The same value the sleep watcher is seeded from, so the two cannot disagree about how
    // long she was gone.
    expect(daemon).toContain("noteAbsence(lastKnownAliveMs");
  });

  it("and when she last brought something up is written down", () => {
    const store = readFileSync(new URL("../../../src/life/field-store.ts", import.meta.url), "utf8");
    expect(store, "when she last raised a thing still dies with the process").toContain("last_raised_ms");
    // Column, migration for an existing field, write, and read: all four, or it is half-wired.
    expect(store).toContain('["last_raised_ms", "INTEGER"]');
    expect(store).toContain("n.lastRaisedMs ?? null");
    expect(store).toContain("lastRaisedMs: row.last_raised_ms as number");
  });

  it("and a field written before that column still loads", () => {
    // A row that predates the record reads as never-raised, which is both the honest answer and
    // exactly what a restart used to produce for every node.
    const store = readFileSync(new URL("../../../src/life/field-store.ts", import.meta.url), "utf8");
    expect(store).toMatch(/Number\.isFinite\(row\.last_raised_ms\)\s*\?/u);
  });
});
