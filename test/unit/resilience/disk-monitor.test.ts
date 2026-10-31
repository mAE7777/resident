import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskMonitor } from "../../../src/resilience/disk-monitor.js";
import type { DiskMonitorConfig, SqliteDatabase } from "../../../src/resilience/disk-monitor.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const GB = 1024 * 1024 * 1024;

function makeStatfs(availableGb: number, totalGb = 100) {
  return async (_path: string) => ({
    bavail: Math.floor((availableGb * GB) / 4096),
    bsize: 4096,
    blocks: Math.floor((totalGb * GB) / 4096),
  });
}

function makePaths(tmpDir: string) {
  return {
    sessions: join(tmpDir, "sessions"),
    checkpoints: join(tmpDir, "checkpoints"),
    db: join(tmpDir, "db"),
  };
}

function makeMonitor(availableGb: number, overrides: Partial<DiskMonitorConfig> = {}, tmpDir?: string) {
  const dir = tmpDir ?? mkdtempSync(join(tmpdir(), "disk-monitor-test-"));
  return new DiskMonitor({
    statfs: makeStatfs(availableGb),
    clock: () => Date.now(),
    paths: makePaths(dir),
    ...overrides,
  });
}

// ── AC 1: getStatus() returns correct level ───────────────────────────────────

describe("DiskMonitor.getStatus()", () => {
  it("AC1: returns 'degrade' when 4GB free (below 5GB threshold)", async () => {
    const monitor = makeMonitor(4);
    const status = await monitor.getStatus();
    expect(status.level).toBe("degrade");
  });

  it("returns 'normal' when 20GB free (above 10GB warn threshold)", async () => {
    const monitor = makeMonitor(20);
    const status = await monitor.getStatus();
    expect(status.level).toBe("normal");
  });

  it("returns 'warn' when 7GB free (between 5 and 10GB)", async () => {
    const monitor = makeMonitor(7);
    const status = await monitor.getStatus();
    expect(status.level).toBe("warn");
  });

  it("returns 'hard_stop' when 1GB free (below 2GB threshold)", async () => {
    const monitor = makeMonitor(1);
    const status = await monitor.getStatus();
    expect(status.level).toBe("hard_stop");
  });

  it("returns 'warn' on statfs failure with zero bytes reported", async () => {
    const monitor = new DiskMonitor({
      statfs: async () => { throw new Error("statfs failed"); },
      clock: () => Date.now(),
      paths: makePaths(mkdtempSync(join(tmpdir(), "disk-monitor-test-"))),
    });
    const status = await monitor.getStatus();
    expect(status.level).toBe("warn");
    expect(status.availableBytes).toBe(0);
    expect(status.availableGb).toBe(0);
    // AND SAYS SO. The conservative stand-in is right for the write gates and WRONG for anything
    // that reports to a human: `warn` with zero bytes is a perfectly plausible reading, so without
    // this field a volume nobody can measure reaches him as a mild notice that space is tight.
    expect(status.reading, "a failed reading is indistinguishable from a real one").toBe("failed");
  });

  it("and a reading that really happened says THAT", async () => {
    expect((await makeMonitor(20).getStatus()).reading).toBe("measured");
    expect((await makeMonitor(1).getStatus()).reading).toBe("measured");
  });

  it("returns correct availableGb in the status object", async () => {
    const monitor = makeMonitor(4);
    const status = await monitor.getStatus();
    expect(status.availableGb).toBeGreaterThan(3.9);
    expect(status.availableGb).toBeLessThan(4.1);
  });
});

// ── AC 2: canWriteNonEssential() ─────────────────────────────────────────────

describe("DiskMonitor.canWriteNonEssential()", () => {
  it("AC2: returns false in degrade mode (4GB free)", async () => {
    const monitor = makeMonitor(4);
    const result = await monitor.canWriteNonEssential();
    expect(result).toBe(false);
  });

  it("returns false in hard_stop mode (1GB free)", async () => {
    const monitor = makeMonitor(1);
    const result = await monitor.canWriteNonEssential();
    expect(result).toBe(false);
  });

  it("returns true in warn mode (7GB free)", async () => {
    const monitor = makeMonitor(7);
    const result = await monitor.canWriteNonEssential();
    expect(result).toBe(true);
  });

  it("returns true in normal mode (20GB free)", async () => {
    const monitor = makeMonitor(20);
    const result = await monitor.canWriteNonEssential();
    expect(result).toBe(true);
  });
});

// ── checkBeforeWrite() ────────────────────────────────────────────────────────

describe("DiskMonitor.checkBeforeWrite()", () => {
  it("returns false in hard_stop mode", async () => {
    const monitor = makeMonitor(1);
    const result = await monitor.checkBeforeWrite();
    expect(result).toBe(false);
  });

  it("returns true in degrade mode (only hard_stop is blocked)", async () => {
    const monitor = makeMonitor(4);
    const result = await monitor.checkBeforeWrite();
    expect(result).toBe(true);
  });

  it("returns true in normal mode", async () => {
    const monitor = makeMonitor(20);
    const result = await monitor.checkBeforeWrite();
    expect(result).toBe(true);
  });
});

// ── AC 3: runAutoCleanup(), checkpoint pruning ───────────────────────────────

describe("DiskMonitor.runAutoCleanup() — checkpoints", () => {
  let tmpDir: string;
  let paths: ReturnType<typeof makePaths>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "disk-monitor-test-"));
    paths = makePaths(tmpDir);
    mkdirSync(paths.sessions, { recursive: true });
    mkdirSync(paths.checkpoints, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("AC3: prunes oldest 5 checkpoints when 15 exist (keeping MAX_CHECKPOINTS=10)", async () => {
    const now = Date.now();
    // Create 15 checkpoint files with staggered old mtimes
    for (let i = 0; i < 15; i++) {
      const filePath = join(paths.checkpoints, `checkpoint-${String(i).padStart(3, "0")}.json`);
      writeFileSync(filePath, JSON.stringify({ i }));
      // Backdate to be well outside safety window (> 60s ago)
      const oldTime = new Date(now - (200 + i) * 1000); // 200-214 seconds ago
      utimesSync(filePath, oldTime, oldTime);
    }

    const monitor = new DiskMonitor({
      statfs: makeStatfs(20),
      clock: () => now,
      paths,
    });

    const result = await monitor.runAutoCleanup();
    expect(result.deletedCheckpoints).toBe(5);
    expect(result.deletedSessions).toBe(0);

    // Verify checkpoints directory now has exactly 10 files
    const { readdirSync } = await import("node:fs");
    const remaining = readdirSync(paths.checkpoints).filter((f) => !f.startsWith("."));
    expect(remaining).toHaveLength(10);
  });

  it("does not prune when exactly MAX_CHECKPOINTS (10) exist", async () => {
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      const filePath = join(paths.checkpoints, `checkpoint-${i}.json`);
      writeFileSync(filePath, "{}");
      const oldTime = new Date(now - 200_000);
      utimesSync(filePath, oldTime, oldTime);
    }

    const monitor = new DiskMonitor({
      statfs: makeStatfs(20),
      clock: () => now,
      paths,
    });

    const result = await monitor.runAutoCleanup();
    expect(result.deletedCheckpoints).toBe(0);
  });

  it("negative: safety window skips recently-modified checkpoints (< 60s old)", async () => {
    // Use a fake clock set far in the future so that real file mtimes (~now)
    // appear to be within the safety window. With clock() returning far-future,
    // safetyThresholdMs = farFuture - 60_000. Any file whose mtime < farFuture - 60_000
    // is "old enough". Files modified at real now are < farFuture - 60_000 only if
    // farFuture - realNow > 60_000. So set farFuture = realNow + 120_000 (2 min ahead).
    // Then safetyThresholdMs = realNow + 120_000 - 60_000 = realNow + 60_000.
    // Any file with mtime <= realNow is < realNow + 60_000 → old enough → eligible.
    // That means all files would be eligible (safety doesn't trigger).
    //
    // Instead: use farFuture = realNow + 30_000. safetyThreshold = realNow + 30_000 - 60_000
    // = realNow - 30_000. Files with mtime > realNow - 30_000 are "recent" (within 60s of farFuture).
    // Files modified at realNow - 10_000 (10s ago from real now) would have mtime > realNow - 30_000,
    // so they are within the safety window relative to farFuture clock. Good.
    //
    // Setup: 15 files. The 5 "oldest" by mtime = files from 200s ago.
    //   But 10 of them (indices 5-14) have mtime from 200-340s ago (clearly old).
    //   5 more (indices 0-4) have mtime from 200-240s ago (also old by mtime, older than the 10).
    // Wait, that makes them also old. Let's use a simpler approach:
    //   farFuture clock = realNow + 30_000
    //   12 files: mtime = realNow - 200s (old, outside safety window relative to farFuture)
    //   3 files: mtime = realNow - 10s (recent, inside safety window relative to farFuture)
    //   Total = 15 files. 5 need to be deleted (keep 10).
    //   The 3 recent files are NOT the oldest 5, they are among the newest.
    //   After sort: oldest 5 are from the 12 "old" files. None are "recent".
    //   Safety window doesn't trigger. All 5 delete. Not a good negative test.
    //
    // Correct minimal scenario: 12 files where 2 are "oldest by mtime" but also "within safety window".
    // This requires: mtime is both smallest (to land in oldest slice) AND >= safetyThresholdMs.
    // Only possible if safetyThresholdMs <= those small mtimes.
    // safetyThresholdMs = clock() - 60_000. If clock() = 0, safetyThreshold = -60_000.
    // Any mtime > -60_000 passes safety. So with clock() = 0:
    //   mtime 1ms, 2ms, 3ms... all pass (> -60_000).
    //   No file can be within the safety window because safetyThreshold is negative.
    //
    // Real solution: set clock() to a large value. safetyThreshold = large - 60_000.
    // Make some "to-delete" files have mtime just above safetyThreshold.
    // E.g., clock() = 1_000_000_000_000 (year 2001).
    // safetyThreshold = 1_000_000_000_000 - 60_000 = 999_999_940_000.
    // Files with mtime = 999_999_950_000 (10s before clock) are within safety window.
    // Files with mtime = 999_999_000_000 (1000s before clock) are outside safety window.
    // Sort: smallest mtime first. The "safe" files (mtime 999_999_950_000) are NEWER.
    // So they won't be in the "oldest 5" slice. Still a contradiction!
    //
    // Conclusion: by design, a file can ONLY be in the "to-delete slice" (oldest mtime)
    // AND within safety window simultaneously if the safety window is wider than the
    // age spread of files. This would mean ALL 15 files were modified in the last 60s.
    //
    // That's the real test: create 15 checkpoints all with very recent mtimes.
    // safetyThreshold = now - 60_000. All files within last 10s → all skipped.
    const now = Date.now();
    for (let i = 0; i < 15; i++) {
      const filePath = join(paths.checkpoints, `checkpoint-${String(i).padStart(3, "0")}.json`);
      writeFileSync(filePath, "{}");
      // All files modified 5-15 seconds ago, within safety window (60s)
      const recentTime = new Date(now - (5_000 + i * 1_000));
      utimesSync(filePath, recentTime, recentTime);
    }

    const monitor = new DiskMonitor({
      statfs: makeStatfs(20),
      clock: () => now,
      paths,
    });

    const result = await monitor.runAutoCleanup();
    // All 15 are within the 60s safety window, none should be deleted
    expect(result.deletedCheckpoints).toBe(0);
  });

  it("ignores dot-files in checkpoints directory", async () => {
    const now = Date.now();
    // Create 10 real checkpoints + 1 dot file
    for (let i = 0; i < 10; i++) {
      const filePath = join(paths.checkpoints, `checkpoint-${i}.json`);
      writeFileSync(filePath, "{}");
      const oldTime = new Date(now - 200_000);
      utimesSync(filePath, oldTime, oldTime);
    }
    writeFileSync(join(paths.checkpoints, ".gitkeep"), "");

    const monitor = new DiskMonitor({
      statfs: makeStatfs(20),
      clock: () => now,
      paths,
    });

    const result = await monitor.runAutoCleanup();
    // Still exactly 10 non-dot files, no pruning needed
    expect(result.deletedCheckpoints).toBe(0);
  });

  it("handles missing checkpoints directory gracefully", async () => {
    const badPaths = { ...paths, checkpoints: join(tmpDir, "nonexistent-checkpoints") };
    const monitor = new DiskMonitor({
      statfs: makeStatfs(20),
      clock: () => Date.now(),
      paths: badPaths,
    });

    // Should not throw
    const result = await monitor.runAutoCleanup();
    expect(result.deletedCheckpoints).toBe(0);
  });
});

// ── runAutoCleanup(), session pruning ────────────────────────────────────────

describe("DiskMonitor.runAutoCleanup() — sessions", () => {
  let tmpDir: string;
  let paths: ReturnType<typeof makePaths>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "disk-monitor-test-"));
    paths = makePaths(tmpDir);
    mkdirSync(paths.sessions, { recursive: true });
    mkdirSync(paths.checkpoints, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("deletes old completed sessions past retention window", async () => {
    const now = Date.now();
    // Create an old session dir with completed marker
    const sessionPath = join(paths.sessions, "sess-old");
    mkdirSync(sessionPath);
    const markerPath = join(sessionPath, "completed");
    writeFileSync(markerPath, "");
    // Backdate both the marker and the dir to be > 180 days old
    const veryOld = new Date(now - 200 * 24 * 60 * 60 * 1000);
    utimesSync(markerPath, veryOld, veryOld);
    utimesSync(sessionPath, veryOld, veryOld);

    const monitor = new DiskMonitor({
      statfs: makeStatfs(20),
      clock: () => now,
      paths,
    });

    const result = await monitor.runAutoCleanup();
    expect(result.deletedSessions).toBe(1);
  });

  it("negative: skips sessions without a completed marker", async () => {
    const now = Date.now();
    // Create a session dir WITHOUT a completed marker
    const sessionPath = join(paths.sessions, "sess-no-marker");
    mkdirSync(sessionPath);
    const oldTime = new Date(now - 200 * 24 * 60 * 60 * 1000);
    utimesSync(sessionPath, oldTime, oldTime);

    const monitor = new DiskMonitor({
      statfs: makeStatfs(20),
      clock: () => now,
      paths,
    });

    const result = await monitor.runAutoCleanup();
    expect(result.deletedSessions).toBe(0);
  });

  it("negative: safety window — skips sessions modified within 60s", async () => {
    const now = Date.now();
    const sessionPath = join(paths.sessions, "sess-recent");
    mkdirSync(sessionPath);
    const markerPath = join(sessionPath, "completed");
    writeFileSync(markerPath, "");
    // Marker is old but dir was modified very recently
    const veryOld = new Date(now - 200 * 24 * 60 * 60 * 1000);
    const veryRecent = new Date(now - 10_000); // 10s ago
    utimesSync(markerPath, veryOld, veryOld);
    utimesSync(sessionPath, veryRecent, veryRecent);

    const monitor = new DiskMonitor({
      statfs: makeStatfs(20),
      clock: () => now,
      paths,
    });

    const result = await monitor.runAutoCleanup();
    expect(result.deletedSessions).toBe(0);
  });

  it("skips non-directory entries in sessions dir", async () => {
    const now = Date.now();
    // Create a plain file in sessions dir (not a dir)
    writeFileSync(join(paths.sessions, "not-a-dir.json"), "{}");

    const monitor = new DiskMonitor({
      statfs: makeStatfs(20),
      clock: () => now,
      paths,
    });

    const result = await monitor.runAutoCleanup();
    expect(result.deletedSessions).toBe(0);
  });
});

// ── AC 4: runSqliteMaintenance() ─────────────────────────────────────────────

describe("DiskMonitor.runSqliteMaintenance()", () => {
  it("AC4: calls wal_checkpoint(TRUNCATE), optimize, and journal_size_limit", () => {
    const monitor = makeMonitor(20);
    const pragmaCalls: string[] = [];
    const db: SqliteDatabase = {
      pragma: (sql) => { pragmaCalls.push(sql); return null; },
      exec: () => {},
    };

    monitor.runSqliteMaintenance(db);

    expect(pragmaCalls).toContain("wal_checkpoint(TRUNCATE)");
    expect(pragmaCalls).toContain("optimize");
    // Check journal_size_limit is set to 64MB
    const limitCall = pragmaCalls.find((s) => s.startsWith("journal_size_limit"));
    expect(limitCall).toBeDefined();
    expect(limitCall).toContain((64 * 1024 * 1024).toString());
  });

  it("survives a pragma that throws — does not propagate error", () => {
    const monitor = makeMonitor(20);
    const db: SqliteDatabase = {
      pragma: (sql) => { if (sql.includes("wal_checkpoint")) throw new Error("db error"); return null; },
      exec: () => {},
    };

    // Should not throw
    expect(() => monitor.runSqliteMaintenance(db)).not.toThrow();
  });
});

// ── runWeeklyVacuum() ─────────────────────────────────────────────────────────

describe("DiskMonitor.runWeeklyVacuum()", () => {
  it("calls VACUUM on the database", () => {
    const monitor = makeMonitor(20);
    const execCalls: string[] = [];
    const db: SqliteDatabase = {
      pragma: () => null,
      exec: (sql) => { execCalls.push(sql); },
    };

    monitor.runWeeklyVacuum(db);
    expect(execCalls).toContain("VACUUM");
  });

  it("survives exec throwing — does not propagate error", () => {
    const monitor = makeMonitor(20);
    const db: SqliteDatabase = {
      pragma: () => null,
      exec: () => { throw new Error("vacuum error"); },
    };
    expect(() => monitor.runWeeklyVacuum(db)).not.toThrow();
  });
});

// ── checkAndRunMaintenance() ──────────────────────────────────────────────────

describe("DiskMonitor.checkAndRunMaintenance()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "disk-monitor-maintenance-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("runs checkpoint and optimize when state file is missing (first run)", async () => {
    const pragmaCalls: string[] = [];
    const db: SqliteDatabase = {
      pragma: (sql) => { pragmaCalls.push(sql); return null; },
      exec: () => {},
    };

    const monitor = makeMonitor(20);
    await monitor.checkAndRunMaintenance({ configDir: tmpDir, db });

    expect(pragmaCalls).toContain("wal_checkpoint(TRUNCATE)");
    expect(pragmaCalls).toContain("optimize");
  });

  it("skips maintenance when state file shows recent operations", async () => {
    const now = Date.now();
    const recentState = {
      lastCheckpoint: now - 1000,  // 1 second ago: not stale
      lastOptimize: now - 1000,
      lastVacuum: now - 1000,
    };
    writeFileSync(join(tmpDir, "maintenance-state.json"), JSON.stringify(recentState));

    const pragmaCalls: string[] = [];
    const execCalls: string[] = [];
    const db: SqliteDatabase = {
      pragma: (sql) => { pragmaCalls.push(sql); return null; },
      exec: (sql) => { execCalls.push(sql); },
    };

    const monitor = new DiskMonitor({
      statfs: makeStatfs(20),
      clock: () => now,
      paths: makePaths(tmpDir),
    });
    await monitor.checkAndRunMaintenance({ configDir: tmpDir, db });

    expect(pragmaCalls).not.toContain("wal_checkpoint(TRUNCATE)");
    expect(execCalls).not.toContain("VACUUM");
  });

  it("writes updated maintenance state file after running", async () => {
    const { existsSync } = await import("node:fs");
    const db: SqliteDatabase = { pragma: () => null, exec: () => {} };
    const monitor = makeMonitor(20);
    await monitor.checkAndRunMaintenance({ configDir: tmpDir, db });

    expect(existsSync(join(tmpDir, "maintenance-state.json"))).toBe(true);
  });
});

// ── Exported constants ────────────────────────────────────────────────────────

describe("Exported constants", () => {
  it("PINO_ROLL_MAX_SIZE is 50MB", async () => {
    const { PINO_ROLL_MAX_SIZE } = await import("../../../src/resilience/disk-monitor.js");
    expect(PINO_ROLL_MAX_SIZE).toBe(50 * 1024 * 1024);
  });

  it("PINO_ROLL_MAX_FILES is 5", async () => {
    const { PINO_ROLL_MAX_FILES } = await import("../../../src/resilience/disk-monitor.js");
    expect(PINO_ROLL_MAX_FILES).toBe(5);
  });
});
