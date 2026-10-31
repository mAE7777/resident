import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createSleepWatcher, DEFAULT_GAP_THRESHOLD_MS, type SleepGap } from "../../../src/life/sleep.js";
import { summarizeEvent } from "../../../src/life/autobiography.js";
import { awakeAndRunning, MONITOR_EVERY_MS } from "../../../src/life/vitals.js";

/**
 * A clock and timer the test controls. The beat callback is captured and driven by hand,
 * because real timers cannot simulate a suspension: the whole point of a suspension is that
 * nothing runs during it.
 */
function harness(beatMs = 15_000) {
  let t = 1_000_000;
  let beatFn: (() => void) | null = null;
  const wakes: SleepGap[] = [];
  const watcher = createSleepWatcher({
    beatMs,
    now: () => t,
    onWake: (g) => wakes.push(g),
    setIntervalFn: ((fn: () => void) => { beatFn = fn; return 1 as unknown as ReturnType<typeof setInterval>; }) as typeof setInterval,
    clearIntervalFn: (() => {}) as typeof clearInterval,
  });
  watcher.start();
  return {
    watcher, wakes,
    beat: () => beatFn?.(),
    pass: (ms: number) => { t += ms; },
    /**
     * Awake time BEATS. Advancing two hours in one jump and then beating is precisely what a
     * two-hour suspension looks like, which is the first thing this harness taught: there is
     * no difference, from inside, between time skipped and time slept. So awake time advances
     * beat by beat, the way a running process actually experiences it.
     */
    awake: (ms: number) => { for (let left = ms; left > 0; left -= beatMs) { t += Math.min(beatMs, left); beatFn?.(); } },
    now: () => t,
  };
}

const HOUR = 3_600_000;

describe("she sleeps when the machine sleeps", () => {
  it("an ordinary run of beats is not sleep", () => {
    const h = harness();
    for (let i = 0; i < 200; i++) { h.pass(15_000); h.beat(); }
    expect(h.wakes).toEqual([]);
    expect(h.watcher.sleptMsSince(0)).toBe(0);
  });

  it("a suspension becomes one sleep, with its true length", () => {
    const h = harness();
    h.pass(15_000); h.beat();
    const lidClosed = h.now();
    h.pass(9 * HOUR); h.beat(); // the lid opens; the next beat fires late
    expect(h.wakes).toHaveLength(1);
    expect(h.wakes[0].startMs).toBe(lidClosed);
    expect(h.wakes[0].endMs).toBe(h.now());
  });

  it("a busy stretch below the threshold is not called sleep", () => {
    // Calling a stall "sleep" would HIDE a real hang from the two critical detectors, so the
    // threshold errs high and anything under it counts as ordinary life.
    const h = harness();
    h.pass(DEFAULT_GAP_THRESHOLD_MS - 1); h.beat();
    expect(h.wakes).toEqual([]);
  });

  describe("slept time does not count toward being stalled", () => {
    it("subtracts exactly the overlap with the asked-about span", () => {
      const h = harness();
      h.pass(15_000); h.beat();
      const beforeSleep = h.now();
      h.pass(8 * HOUR); h.beat(); // slept 8h
      h.awake(2 * HOUR); // 2h awake since, beat by beat

      // Since before the sleep: the whole 8h is subtracted.
      expect(h.watcher.sleptMsSince(beforeSleep)).toBe(8 * HOUR);
      // Since a point INSIDE the sleep: only the part after that point.
      expect(h.watcher.sleptMsSince(beforeSleep + 3 * HOUR)).toBe(5 * HOUR);
      // Since after waking: nothing.
      expect(h.watcher.sleptMsSince(h.now() - HOUR)).toBe(0);
    });

    it("two nights both count", () => {
      const h = harness();
      const start = h.now();
      h.pass(15_000); h.beat();
      h.pass(9 * HOUR); h.beat();  // night one
      h.awake(HOUR);               // a stretch awake, beat by beat
      h.pass(7 * HOUR); h.beat();  // night two
      expect(h.watcher.sleptMsSince(start)).toBe(16 * HOUR);
    });

    it("this is exactly what the daemon's vitals closures consume", () => {
      // The wall (tick_stalled / moments_stalled, both critical, both safe-mode triggers)
      // reads ages from two closures in index.ts. They must advance their timestamps by the
      // slept overlap, or a weekend with the lid closed wakes her up officially broken.
      const source = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8");
      expect(source).toContain("lastTickMs + sleepWatcher.sleptMsSince(lastTickMs)");
      expect(source).toContain("sleepWatcher.sleptMsSince(momentHeartbeatMs)");
      // And her OWN quiet hours, which are a different fact that looks the same from here:
      // her waking window is fifteen hours out of twenty-four, so the gap from her last
      // evening moment to her first morning one is a normal night, and `moments_stalled` is
      // critical past three hours. Without this, the alarm fired every night on a healthy
      // machine and put her in safe mode for sleeping.
      expect(source, "her own night is still charged to her as a stall")
        .toContain("clock.quietMsBetween(momentHeartbeatMs, Date.now())");
    });
  });

  describe("waking up", () => {
    it("is recorded before the wake handler runs, so the handler's readings see the sleep", () => {
      let seenDuringWake = -1;
      let t = 1_000_000;
      let beatFn: (() => void) | null = null;
      const w = createSleepWatcher({
        now: () => t,
        onWake: () => { seenDuringWake = w.sleptMsSince(0); },
        setIntervalFn: ((fn: () => void) => { beatFn = fn; return 1 as unknown as ReturnType<typeof setInterval>; }) as typeof setInterval,
        clearIntervalFn: (() => {}) as typeof clearInterval,
      });
      w.start();
      t += 6 * HOUR; beatFn!();
      expect(seenDuringWake).toBe(6 * HOUR - 0); // minus nothing: the whole gap is visible
    });

    it("a wake handler that throws does not kill the watcher", () => {
      // The watcher is the only thing that knows she slept; if its own callback could kill
      // it, the NEXT sleep would arrive as a stall alarm.
      let t = 1_000_000;
      let beatFn: (() => void) | null = null;
      const w = createSleepWatcher({
        now: () => t,
        onWake: () => { throw new Error("bad handler"); },
        setIntervalFn: ((fn: () => void) => { beatFn = fn; return 1 as unknown as ReturnType<typeof setInterval>; }) as typeof setInterval,
        clearIntervalFn: (() => {}) as typeof clearInterval,
      });
      w.start();
      t += 5 * HOUR; expect(() => beatFn!()).not.toThrow();
      t += 5 * HOUR; beatFn!();
      expect(w.sleptMsSince(0)).toBe(10 * HOUR);
    });

    it("the daemon reschedules her first moment instead of firing the stale pre-sleep timer", () => {
      const source = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8");
      const wakeAt = source.indexOf("onMachineWake = (gap)");
      const wakeEnd = source.indexOf("sleepWatcher.start()");
      expect(wakeAt, "the wake handler anchor moved — every check below reads an empty slice").toBeGreaterThan(-1);
      expect(wakeEnd, "the sleepWatcher.start anchor moved").toBeGreaterThan(wakeAt);
      const wake = source.slice(wakeAt, wakeEnd);
      expect(wake, "waking does not catch her state up").toContain("runLifeTick()");
      expect(wake, "the stale moment timer survives the night").toContain("clearTimeout(momentTimer)");
      expect(wake, "her first waking moment is not on her rhythm").toContain("scheduleNextMoment()");
      expect(wake, "sleeping never reaches her as a fault").toContain("opsLog.slept({ sleptMs })");
    });
  });

  describe("what she remembers of it", () => {
    it("a night reads as having slept, roughly how long, in her words", () => {
      const line = summarizeEvent({ event: "slept", sleptMs: 9 * HOUR, ts: "2026-05-01T08:00:00.000Z", pid: 1 } as never);
      expect(line).toContain("睡了一觉");
      expect(line).toContain("9");
      expect(line, "a machine's unit in her memory").not.toMatch(/ms|Ms/);
    });

    it("a nap reads as a nap", () => {
      const line = summarizeEvent({ event: "slept", sleptMs: 10 * 60_000, ts: "2026-05-01T08:00:00.000Z", pid: 1 } as never);
      expect(line).toContain("眯了一小会儿");
    });
  });
});

/**
 * THE CAPTURE SAID SHE WAS AWAKE WHILE THE MACHINE SLEPT.
 *
 * From 00:35 to 14:59 the machine slept, waking for a minute every eight or nine to do the
 * system's housekeeping. Each of those captures wrote `awake: true` because the hour was a waking
 * one. Her life was right and the reading said the opposite.
 */
describe("the awake reading follows the machine as well as the hour", () => {
  const MIN = 60_000;
  const lastTwoCycles = (h: ReturnType<typeof harness>) => h.watcher.sleptMsSince(h.now() - 2 * MONITOR_EVERY_MS);

  it("a capture during the system's short wakes in a sleeping morning reads asleep", () => {
    const h = harness();
    h.awake(10 * MIN);
    for (let i = 0; i < 6; i++) {
      h.pass(8 * MIN); h.beat(); // the machine slept eight minutes and woke for its housekeeping
      h.awake(1 * MIN);
      expect(awakeAndRunning(true, lastTwoCycles(h)), `short wake ${i + 1} read as awake`).toBe(false);
    }
  });

  it("even when the capture runs before the watcher has noticed the gap that just ended", () => {
    const h = harness();
    h.awake(10 * MIN);
    h.pass(8 * MIN); h.beat();
    h.awake(1 * MIN);
    h.pass(8 * MIN); // woken again; the capture fires before the next beat
    expect(awakeAndRunning(true, lastTwoCycles(h))).toBe(false);
  });

  it("PLANTED: a machine that is really running in her waking hours reads awake", () => {
    const h = harness();
    h.awake(30 * MIN);
    expect(awakeAndRunning(true, lastTwoCycles(h))).toBe(true);
  });

  it("it comes back to awake within two cycles of the machine truly waking", () => {
    const h = harness();
    h.awake(5 * MIN);
    h.pass(3 * HOUR); h.beat();
    h.awake(2 * MONITOR_EVERY_MS + 15_000);
    expect(awakeAndRunning(true, lastTwoCycles(h))).toBe(true);
  });

  it("and outside her waking hours it is asleep whatever the machine does", () => {
    const h = harness();
    h.awake(30 * MIN);
    expect(awakeAndRunning(false, lastTwoCycles(h))).toBe(false);
  });

  it("is what production wires into the capture", () => {
    const src = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8");
    expect(src).toMatch(/awake: \(\) => vitalsMod\.awakeAndRunning\(\s*clock\.isAwakeHour\(Date\.now\(\)\),\s*sleepWatcher\.sleptMsSince\(Date\.now\(\) - 2 \* vitalsMod\.MONITOR_EVERY_MS\),/);
  });
});
