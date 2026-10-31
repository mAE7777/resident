import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectAnomalies, DEFAULT_THRESHOLDS, type VitalsSnapshot } from "../../../src/life/vitals.js";

/**
 * A FULL DISK IS THE ONE FAILURE THAT TAKES OUT EVERYTHING AT ONCE.
 *
 * Her database, her workspace, her snapshots and the channel that would tell him all live on the
 * same volume. Its signature before this was: she keeps living, every write fails into a caught
 * fault, and nobody is told, for as long as it takes somebody to think of looking.
 *
 * And the protection was already written. `disk-monitor.ts` has `getStatus`, `checkBeforeWrite`,
 * `canWriteNonEssential` and `runAutoCleanup`; it has its own passing test file; and a grep for its
 * call sites across `src/` returned NOTHING. Three tested, green, never-called functions, the
 * "wire it or it is not real" class, in the module whose job is to stop her dying quietly.
 */

const BASE = {
  ts: 1_000_000, phase: "normal", remainingFraction: 0.5, spentVigor: 100, capVigor: 400,
  topAccount: null, drives: {} as never, dominant: "curiosity", pad: { pleasure: 0, arousal: 0, dominance: 0 },
  mood: "平稳", sendsInLastDay: 0, consecutiveNonReplies: 0, reservoirSize: 0, hoursSinceUser: 1,
  awake: true, clockActivity: 0.5, tierCeiling: "tier2", mayExplore: true,
  // Every detector that runs before the disk ones needs these to exist, and a fixture that omits
  // them would fail for a reason that has nothing to do with what is under test.
  soulInvariants: [], newFaults: [],
} as unknown as VitalsSnapshot;

const withDisk = (disk: VitalsSnapshot["disk"]): VitalsSnapshot[] => [{ ...BASE, disk }];

describe("she is told how much room she has left", () => {
  it("plenty of room raises nothing", () => {
    const codes = detectAnomalies(withDisk({ level: "normal", availableGb: 200 }), DEFAULT_THRESHOLDS).map((a) => a.code);
    expect(codes.filter((c) => c.startsWith("disk"))).toEqual([]);
  });

  it("getting tight is information, not an alarm", () => {
    const a = detectAnomalies(withDisk({ level: "warn", availableGb: 8 }), DEFAULT_THRESHOLDS).find((x) => x.code === "disk_tight");
    expect(a?.severity).toBe("info");
  });

  it("low enough to suppress her non-essential writing is a warning", () => {
    const a = detectAnomalies(withDisk({ level: "degrade", availableGb: 4 }), DEFAULT_THRESHOLDS).find((x) => x.code === "disk_low");
    expect(a?.severity).toBe("warn");
  });

  it("about to stop being saved is critical, and says exactly that", () => {
    const a = detectAnomalies(withDisk({ level: "hard_stop", availableGb: 1 }), DEFAULT_THRESHOLDS).find((x) => x.code === "disk_full");
    expect(a?.severity).toBe("critical");
    expect(a?.message, "the message does not say what is actually at stake")
      .toMatch(/stop being saved/u);
  });

  it("a reading that could not be taken is its own finding, never 'healthy'", () => {
    // `null` is "statfs is failing", `undefined` is "this build does not report disk at all".
    // Neither may read as room to spare, which is what a `?? 0` or a `?? Infinity` would have done.
    const failing = detectAnomalies(withDisk(null), DEFAULT_THRESHOLDS).map((a) => a.code);
    expect(failing).toContain("disk_unknown");
    const absent = detectAnomalies([{ ...BASE }], DEFAULT_THRESHOLDS).map((a) => a.code);
    expect(absent.filter((c) => c.startsWith("disk"))).toEqual([]);
  });

  it("no room left suspends her non-essential life, like the other criticals", () => {
    // Safe mode stops proactive speech, exploration and fusion, which is precisely the right set
    // to stop when the problem is that writing is about to fail: those are the writes that are not
    // her being saved.
    const src = readFileSync(join(process.cwd(), "src/life/vitals.ts"), "utf8");
    const at = src.indexOf("const SAFE_MODE_CODES");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 220)).toContain("disk_full");
  });
});

describe("the protection is actually wired, which was the whole defect", () => {
  const DAEMON = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");

  it("the daemon reads the disk on every monitor cycle", () => {
    const at = DAEMON.indexOf("async function runVitalsMonitor");
    expect(at).toBeGreaterThan(-1);
    const head = DAEMON.slice(at, at + 2600);
    expect(head, "the disk reading is not refreshed before capture — the vital would be stale or absent")
      .toMatch(/diskMonitor\.getStatus\(\)/u);
    // A failed statfs must become NO reading, never a plausible one. `getStatus` catches its own
    // errors and answers `warn` with zero bytes, so relying on the `catch` alone would let a
    // broken gauge reach him as a mild notice that space was getting tight.
    expect(head, "the failed-reading case is not distinguished from a real one")
      .toMatch(/status\.reading === "measured"/u);
    expect(head, "a failed statfs must record null, not a plausible number").toMatch(/latestDisk = null/u);
  });

  it("the vital reaches the snapshot", () => {
    expect(DAEMON).toMatch(/disk: \(\) => latestDisk/u);
  });

  it("maintenance runs on a clock, not only at boot", () => {
    // It was called exactly once, at startup: a daemon running for months never got a TRUNCATE
    // checkpoint, never ran optimize, never vacuumed.
    const at = DAEMON.indexOf("const maintenanceTimer = setInterval");
    expect(at, "maintenance is boot-only again").toBeGreaterThan(-1);
    expect(DAEMON.slice(at, at + 160)).toMatch(/4 \* 60 \* 60 \* 1000/u);
    expect(DAEMON).toMatch(/faultLog\.record\("disk\.maintenance"/u);
  });

  it("every append-only file of hers is rotated, not the two somebody remembered", () => {
    // `vitals.jsonl` is the sharpest: the store reads the WHOLE file at every boot to warm its
    // rings, so past V8's string ceiling she boots with no history, which silently disables every
    // trend detector in the watchtower.
    const at = DAEMON.indexOf("const { rotateLogIfHuge }");
    expect(at).toBeGreaterThan(-1);
    const block = DAEMON.slice(at, at + 1800);
    for (const f of ["ops.jsonl", "agencyLogPath", "vitals.jsonl", "conversation-log.jsonl", "history.jsonl"]) {
      expect(block, `${f} is not rotated — it grows until something that reads it whole dies`).toContain(f);
    }
  });
});
