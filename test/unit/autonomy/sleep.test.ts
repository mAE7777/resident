// Sleep-time compute: the idle scheduler, in its E-batch shape.
//
// Twelve of the sixteen inherited tasks left with their machines (dream consolidator, skill
// pipeline, empty memory stack, behavioral profiling, trajectory relabeling, capability
// self-review). What remains on the idle clock is watching and record-keeping: stuck-candidate
// promotion, the sentinel sweep, the read-only hygiene audit, and the identity integrity check.
// These tests pin (1) the idle gates, (2) that the kept tasks actually run, (3) that abort
// between tasks is honored, and (4) that NOTHING on this clock writes into her world.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createSleepTimeCompute,
  IDLE_THRESHOLD_MS,
  CHECK_INTERVAL_MS,
} from "../../../src/autonomy/sleep.js";
import type { Logger } from "../../../src/utils/logger.js";

const silentLogger = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
  child: () => silentLogger,
} as unknown as Logger;

function deps(over: Record<string, unknown> = {}) {
  return { db: null, integrityChecker: null, identityFilePaths: null, sentinel: null, hygieneAuditor: null, logger: silentLogger, ...over };
}

describe("idle gates", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("does not run before the idle threshold", async () => {
    const sentinel = { process: vi.fn(async () => ({})) };
    const s = createSleepTimeCompute(deps({ sentinel }));
    s.start();
    await vi.advanceTimersByTimeAsync(IDLE_THRESHOLD_MS - CHECK_INTERVAL_MS);
    expect(sentinel.process).not.toHaveBeenCalled();
    s.stop();
  });

  it("runs once per idle cycle and re-arms on a user message", async () => {
    const sentinel = { process: vi.fn(async () => ({})) };
    const s = createSleepTimeCompute(deps({ sentinel }));
    s.start();
    await vi.advanceTimersByTimeAsync(IDLE_THRESHOLD_MS + 2 * CHECK_INTERVAL_MS);
    const after = sentinel.process.mock.calls.length;
    expect(after).toBe(1);
    await vi.advanceTimersByTimeAsync(10 * CHECK_INTERVAL_MS);
    expect(sentinel.process.mock.calls.length, "one idle stretch = one run").toBe(after);
    s.onUserMessage();
    await vi.advanceTimersByTimeAsync(IDLE_THRESHOLD_MS + 2 * CHECK_INTERVAL_MS);
    expect(sentinel.process.mock.calls.length).toBe(after + 1);
    s.stop();
  });
});

describe("the kept tasks", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("sentinel and hygiene both run in an idle cycle", async () => {
    const sentinel = { process: vi.fn(async () => ({})) };
    const hygieneAuditor = { process: vi.fn(async () => ({})) };
    const s = createSleepTimeCompute(deps({ sentinel, hygieneAuditor }));
    s.start();
    await vi.advanceTimersByTimeAsync(IDLE_THRESHOLD_MS + 2 * CHECK_INTERVAL_MS);
    expect(sentinel.process).toHaveBeenCalledWith("sleep-time");
    expect(hygieneAuditor.process).toHaveBeenCalled();
    s.stop();
  });

  it("integrity check runs over the named identity files", async () => {
    const verified: string[] = [];
    const integrityChecker = {
      verifyWithSidecar: vi.fn((p: string) => { verified.push(p); return null; }),
      writeChecksum: vi.fn(),
    };
    const s = createSleepTimeCompute(deps({ integrityChecker, identityFilePaths: ["/a/SOUL.md", "/a/MEMORY.md"] }));
    s.start();
    await vi.advanceTimersByTimeAsync(IDLE_THRESHOLD_MS + 2 * CHECK_INTERVAL_MS);
    expect(verified).toEqual(["/a/SOUL.md", "/a/MEMORY.md"]);
    s.stop();
  });

  it("a missing sidecar is seeded, not swallowed", async () => {
    const integrityChecker = {
      verifyWithSidecar: vi.fn(() => { throw new Error("no sidecar"); }),
      writeChecksum: vi.fn(),
    };
    const s = createSleepTimeCompute(deps({ integrityChecker, identityFilePaths: ["/a/SOUL.md"] }));
    s.start();
    await vi.advanceTimersByTimeAsync(IDLE_THRESHOLD_MS + 2 * CHECK_INTERVAL_MS);
    expect(integrityChecker.writeChecksum, "first pass records a baseline instead of shrugging").toHaveBeenCalledWith("/a/SOUL.md");
    s.stop();
  });

  it("abort between tasks is honored", async () => {
    const hygieneAuditor = { process: vi.fn(async () => ({})) };
    const sentinel = {
      process: vi.fn(async () => { s.onUserMessage(); return {}; }),
    };
    const s = createSleepTimeCompute(deps({ sentinel, hygieneAuditor }));
    s.start();
    await vi.advanceTimersByTimeAsync(IDLE_THRESHOLD_MS + 2 * CHECK_INTERVAL_MS);
    expect(sentinel.process).toHaveBeenCalled();
    expect(hygieneAuditor.process, "the abort fired mid-run must stop later tasks").not.toHaveBeenCalled();
    s.stop();
  });
});

describe("nothing on the idle clock writes into her world", () => {
  it("the source has no machine tasks left and no path into her workspace", () => {
    const src = readFileSync(join(process.cwd(), "src/autonomy/sleep.ts"), "utf8");
    for (const gone of [
      "dream.run", "runSkillQualityAudit", "flagUnderDocumentedTopics", "runBehavioralUpdate",
      "runHindsightRelabeling", "abTester", "descriptionOptimizer", "capabilityImprovement",
      "capabilitySelfModel", "insertEntryWithEmbedding", "refreshConfidence", "evaluateDreamUtility",
    ]) {
      expect(src.includes(gone), `${gone} is back on her idle clock`).toBe(false);
    }
    expect(src.includes("writeFile"), "the idle clock must not write files").toBe(false);
  });
});

describe("the tamper alarm reaches the channel someone actually reads", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  /** A checker that says the file was changed by someone other than her. */
  function checkerSaying(alert: unknown, throws = false) {
    return {
      verifyWithSidecar: () => { if (throws) throw new Error("no sidecar"); return alert; },
      writeChecksum: vi.fn(),
      computeChecksum: () => "x", verifyChecksum: () => true,
      getInitialConfidence: () => 0.6,
    };
  }

  it("PLANTED: a mismatch is a critical fault, not just a line in a console nobody reads", async () => {
    const onFault = vi.fn();
    const alert = { type: "checksum_mismatch", filePath: "/w/MEMORY.md", expected: "a", actual: "b" };
    const s = createSleepTimeCompute(deps({
      integrityChecker: checkerSaying(alert), identityFilePaths: ["/w/MEMORY.md"], onFault,
    }));
    s.start();
    await vi.advanceTimersByTimeAsync(IDLE_THRESHOLD_MS + 2 * CHECK_INTERVAL_MS);
    s.stop();
    expect(onFault).toHaveBeenCalledTimes(1);
    expect(onFault.mock.calls[0]![0]).toBe("integrity.tampered");
    expect(String(onFault.mock.calls[0]![1])).toContain("/w/MEMORY.md");
    expect(onFault.mock.calls[0]![2]).toBe("critical");
  });

  it("a clean file says nothing, and an alarm that cannot arm says so once", async () => {
    const quiet = vi.fn();
    const clean = createSleepTimeCompute(deps({
      integrityChecker: checkerSaying(null), identityFilePaths: ["/w/SOUL.md"], onFault: quiet,
    }));
    clean.start();
    await vi.advanceTimersByTimeAsync(IDLE_THRESHOLD_MS + 2 * CHECK_INTERVAL_MS);
    clean.stop();
    expect(quiet).not.toHaveBeenCalled();

    const onFault = vi.fn();
    const checker = checkerSaying(null, true);
    checker.writeChecksum = vi.fn(() => { throw new Error("disk refused"); });
    const armless = createSleepTimeCompute(deps({
      integrityChecker: checker, identityFilePaths: ["/w/AGENT.md"], onFault,
    }));
    armless.start();
    await vi.advanceTimersByTimeAsync(IDLE_THRESHOLD_MS + 2 * CHECK_INTERVAL_MS);
    armless.stop();
    expect(onFault.mock.calls.map((c) => c[0])).toContain("integrity.alarm-off");
  });
});
