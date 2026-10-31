import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("disk-monitor");

// ── Constants ─────────────────────────────────────────────────────────────────

const WARN_THRESHOLD_GB = 10;
const DEGRADE_THRESHOLD_GB = 5;
const HARD_STOP_THRESHOLD_GB = 2;
const DEFAULT_SESSION_RETENTION_DAYS = 180;
const MAX_CHECKPOINTS = 10;
const SAFETY_SKIP_MS = 60_000; // skip files modified in last 60s
const CHECKPOINT_OPTIMIZE_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const VACUUM_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;         // 7 days
const WAL_SIZE_LIMIT_BYTES = 64 * 1024 * 1024;               // 64MB
const GB = 1024 * 1024 * 1024;
const MAINTENANCE_STATE_FILE = "maintenance-state.json";

// ── Exported constants for pino-roll ─────────────────────────────────────────

export const PINO_ROLL_MAX_SIZE = 50 * 1024 * 1024; // 50MB
export const PINO_ROLL_MAX_FILES = 5;

// ── Types ─────────────────────────────────────────────────────────────────────

export type DiskLevel = "normal" | "warn" | "degrade" | "hard_stop";

export type DiskStatus = {
  level: DiskLevel;
  availableBytes: number;
  availableGb: number;
  totalBytes: number;
  /**
   * Whether these numbers came off the filesystem or are the conservative stand-in used when the
   * call failed.
   *
   * This field exists because the failure branch returns `warn` with zero bytes, which is a
   * perfectly plausible reading, a caller that only looks at `level` cannot tell "the volume is
   * getting tight" from "I have no idea how much room she has". The write gates want the
   * conservative stand-in and are right to; the watchtower wants the truth, because "the gauge is
   * broken" is a finding of its own and must never be reported to him as a mild disk notice.
   */
  reading: "measured" | "failed";
};

export type DiskMonitorConfig = {
  statfs?: (path: string) => Promise<{ bavail: number; bsize: number; blocks: number }>;
  clock?: () => number;
  paths: {
    sessions: string;
    checkpoints: string;
    db: string;
  };
  warnThresholdGb?: number;
  degradeThresholdGb?: number;
  hardStopThresholdGb?: number;
  sessionRetentionDays?: number;
};

type MaintenanceState = {
  lastCheckpoint: number;
  lastOptimize: number;
  lastVacuum: number;
};

export type SqliteDatabase = {
  pragma: (sql: string) => unknown;
  exec: (sql: string) => void;
};

// ── DiskMonitor ───────────────────────────────────────────────────────────────

export class DiskMonitor {
  private readonly statfsFn: (path: string) => Promise<{ bavail: number; bsize: number; blocks: number }>;
  private readonly checkPath: string;
  private readonly warnThresholdGb: number;
  private readonly degradeThresholdGb: number;
  private readonly hardStopThresholdGb: number;
  private readonly sessionRetentionDays: number;
  private readonly now: () => number;
  private readonly paths: { sessions: string; checkpoints: string; db: string };

  constructor(config: DiskMonitorConfig) {
    this.statfsFn = config.statfs ?? ((p) => nodeFs.promises.statfs(p) as Promise<{ bavail: number; bsize: number; blocks: number }>);
    this.checkPath = config.paths.db;
    this.warnThresholdGb = config.warnThresholdGb ?? WARN_THRESHOLD_GB;
    this.degradeThresholdGb = config.degradeThresholdGb ?? DEGRADE_THRESHOLD_GB;
    this.hardStopThresholdGb = config.hardStopThresholdGb ?? HARD_STOP_THRESHOLD_GB;
    this.sessionRetentionDays = config.sessionRetentionDays ?? DEFAULT_SESSION_RETENTION_DAYS;
    this.now = config.clock ?? Date.now;
    this.paths = config.paths;
  }

  private classifyLevel(availableGb: number): DiskLevel {
    if (availableGb < this.hardStopThresholdGb) return "hard_stop";
    if (availableGb < this.degradeThresholdGb)  return "degrade";
    if (availableGb < this.warnThresholdGb)     return "warn";
    return "normal";
  }

  async getStatus(): Promise<DiskStatus> {
    try {
      const stats = await this.statfsFn(this.checkPath);
      const availableBytes = stats.bavail * stats.bsize;
      const totalBytes = stats.blocks * stats.bsize;
      const availableGb = availableBytes / GB;
      const level = this.classifyLevel(availableGb);
      logger.debug({ level, availableGb: availableGb.toFixed(2), path: this.checkPath }, "disk-monitor: status check");
      return { level, availableBytes, availableGb, totalBytes, reading: "measured" };
    } catch (err) {
      logger.warn({ err, path: this.checkPath }, "disk-monitor: statfs failed, defaulting to warn");
      return { level: "warn", availableBytes: 0, availableGb: 0, totalBytes: 0, reading: "failed" };
    }
  }

  async checkBeforeWrite(): Promise<boolean> {
    const status = await this.getStatus();
    if (status.level === "hard_stop") {
      logger.error({ availableGb: status.availableGb.toFixed(2) }, "disk-monitor: hard stop — write blocked");
      return false;
    }
    return true;
  }

  async canWriteNonEssential(): Promise<boolean> {
    const status = await this.getStatus();
    const allowed = status.level !== "degrade" && status.level !== "hard_stop";
    if (!allowed) {
      logger.warn({ level: status.level, availableGb: status.availableGb.toFixed(2) }, "disk-monitor: non-essential write suppressed");
    }
    return allowed;
  }

  async runAutoCleanup(): Promise<{ deletedSessions: number; deletedCheckpoints: number }> {
    const sessionsDir = this.paths.sessions;
    const checkpointsDir = this.paths.checkpoints;
    const cutoffMs = this.now() - this.sessionRetentionDays * 24 * 60 * 60 * 1000;
    const safetyThresholdMs = this.now() - SAFETY_SKIP_MS;
    let deletedSessions = 0;
    let deletedCheckpoints = 0;

    try {
      const entries = await nodeFs.promises.readdir(sessionsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const sessionPath = nodePath.join(sessionsDir, entry.name);
        const markerPath = nodePath.join(sessionPath, "completed");
        try {
          const markerStat = await nodeFs.promises.stat(markerPath);
          const dirStat = await nodeFs.promises.stat(sessionPath);
          if (dirStat.mtimeMs >= safetyThresholdMs) continue;
          if (markerStat.mtimeMs < cutoffMs) {
            await nodeFs.promises.rm(sessionPath, { recursive: true, force: true });
            deletedSessions++;
            logger.debug({ session: entry.name }, "disk-monitor: deleted old session");
          }
        } catch {
          // No completion marker: skip
        }
      }
    } catch (err) {
      logger.warn({ err, sessionsDir }, "disk-monitor: could not read sessions directory");
    }

    try {
      const files = await nodeFs.promises.readdir(checkpointsDir);
      const checkpoints = files.filter((f) => !f.startsWith("."));
      if (checkpoints.length > MAX_CHECKPOINTS) {
        const withStats = await Promise.all(
          checkpoints.map(async (f) => {
            const p = nodePath.join(checkpointsDir, f);
            const s = await nodeFs.promises.stat(p);
            return { name: f, path: p, mtimeMs: s.mtimeMs };
          }),
        );
        withStats.sort((a, b) => a.mtimeMs - b.mtimeMs);
        const toDelete = withStats.slice(0, withStats.length - MAX_CHECKPOINTS);
        for (const entry of toDelete) {
          if (entry.mtimeMs >= safetyThresholdMs) continue;
          try {
            await nodeFs.promises.unlink(entry.path);
            deletedCheckpoints++;
            logger.debug({ checkpoint: entry.name }, "disk-monitor: pruned old checkpoint");
          } catch (err) {
            logger.warn({ err, path: entry.path }, "disk-monitor: could not delete checkpoint");
          }
        }
      }
    } catch (err) {
      logger.warn({ err, checkpointsDir }, "disk-monitor: could not read checkpoints directory");
    }

    if (deletedSessions > 0 || deletedCheckpoints > 0) {
      logger.info({ deletedSessions, deletedCheckpoints }, "disk-monitor: auto-cleanup complete");
    }
    return { deletedSessions, deletedCheckpoints };
  }

  runSqliteMaintenance(db: SqliteDatabase): void {
    try { db.pragma("wal_checkpoint(TRUNCATE)"); logger.debug("disk-monitor: WAL checkpoint(TRUNCATE) complete"); } catch (err) { logger.warn({ err }, "disk-monitor: WAL checkpoint failed"); }
    try { db.pragma("optimize"); logger.debug("disk-monitor: PRAGMA optimize complete"); } catch (err) { logger.warn({ err }, "disk-monitor: PRAGMA optimize failed"); }
    try { db.pragma(`journal_size_limit = ${WAL_SIZE_LIMIT_BYTES}`); logger.debug({ limitBytes: WAL_SIZE_LIMIT_BYTES }, "disk-monitor: journal_size_limit set"); } catch (err) { logger.warn({ err }, "disk-monitor: journal_size_limit failed"); }
  }

  runWeeklyVacuum(db: SqliteDatabase): void {
    try { db.exec("VACUUM"); logger.info("disk-monitor: VACUUM complete"); } catch (err) { logger.warn({ err }, "disk-monitor: VACUUM failed"); }
  }

  async checkAndRunMaintenance(opts: { configDir: string; db: SqliteDatabase }): Promise<void> {
    const { configDir, db } = opts;
    const stateFile = nodePath.join(configDir, MAINTENANCE_STATE_FILE);
    const now = this.now();
    let state: MaintenanceState;
    let fileExists = false;
    try {
      const raw = await nodeFs.promises.readFile(stateFile, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.lastCheckpoint === "number" && typeof parsed.lastOptimize === "number" && typeof parsed.lastVacuum === "number") {
        state = parsed as unknown as MaintenanceState;
      } else {
        state = { lastCheckpoint: 0, lastOptimize: 0, lastVacuum: 0 };
      }
      fileExists = true;
    } catch {
      state = { lastCheckpoint: 0, lastOptimize: 0, lastVacuum: 0 };
    }

    const checkpointStale = now - state.lastCheckpoint >= CHECKPOINT_OPTIMIZE_INTERVAL_MS;
    const optimizeStale   = now - state.lastOptimize   >= CHECKPOINT_OPTIMIZE_INTERVAL_MS;
    const vacuumStale     = now - state.lastVacuum     >= VACUUM_INTERVAL_MS;

    if (checkpointStale) {
      try { db.pragma("wal_checkpoint(TRUNCATE)"); state.lastCheckpoint = now; logger.debug("disk-monitor: scheduled checkpoint complete"); } catch (err) { logger.warn({ err }, "disk-monitor: scheduled checkpoint failed"); }
    }
    if (optimizeStale) {
      try { db.pragma("optimize"); db.pragma(`journal_size_limit = ${WAL_SIZE_LIMIT_BYTES}`); state.lastOptimize = now; logger.debug("disk-monitor: scheduled optimize complete"); } catch (err) { logger.warn({ err }, "disk-monitor: scheduled optimize failed"); }
    }
    if (vacuumStale) {
      try { db.exec("VACUUM"); state.lastVacuum = now; logger.info("disk-monitor: scheduled vacuum complete"); } catch (err) { logger.warn({ err }, "disk-monitor: scheduled vacuum failed"); }
    }

    try {
      if (!fileExists) { await nodeFs.promises.mkdir(configDir, { recursive: true }); }
      await nodeFs.promises.writeFile(stateFile, JSON.stringify(state, null, 2), "utf8");
    } catch (err) {
      logger.warn({ err, stateFile }, "disk-monitor: could not write maintenance state");
    }
  }
}
