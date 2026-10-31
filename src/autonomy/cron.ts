// Cron scheduler service: SQLite-backed, re-arming setTimeout pattern.
//
// Three schedule types:
//   { type: "cron", expression }  , standard 5-field cron (via cron-parser)
//   { type: "interval", seconds } , repeat every N seconds
//   { type: "once", at }          , fire once at unix timestamp ms
//
// Security: addJob() scans the message for prompt injection. Critical or High
// severity matches cause the job to be rejected before insertion.
//
// Timer loop: start() arms a single setTimeout. After each wake the service
// runs _tick() (execute due jobs), then immediately re-arms for the next
// wake. This ensures the timer never drifts into a single long sleep.
//
// History: each job keeps the last MAX_RUN_HISTORY=20 run records.

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { CronExpressionParser } from "cron-parser";
import type { InjectionScanner } from "../security/injection.js";
import { createLogger } from "../utils/logger.js";

// ── Constants ─────────────────────────────────────────────────────────────────

export const MAX_RUN_HISTORY = 20;
export const MAX_SLEEP_MS = 300_000; // 5 minutes

// ── Types ─────────────────────────────────────────────────────────────────────

export type CronSchedule =
  | { type: "cron"; expression: string }
  | { type: "interval"; seconds: number }
  | { type: "once"; at: number }; // unix timestamp ms

export interface CronJob {
  id: string;
  name: string;
  message: string;
  schedule: CronSchedule;
  enabled: boolean;
  createdAt: number;
  lastRun: number | null;
  nextRun: number;
}

export interface CronRunRecord {
  jobId: string;
  runAt: number;
  status: "success" | "error";
  durationMs: number;
  error?: string;
}

export interface CronServiceConfig {
  db: Database.Database;
  injectionScanner: InjectionScanner;
  onJob: (job: CronJob) => Promise<void>;
  maxSleepMs?: number;
}

export interface CronService {
  addJob(name: string, message: string, schedule: CronSchedule): CronJob;
  removeJob(id: string): boolean;
  enableJob(id: string): void;
  disableJob(id: string): void;
  listJobs(): CronJob[];
  getJob(id: string): CronJob | undefined;
  start(): void;
  stop(): void;
  hasDueJobs(): boolean;
}

// ── Schedule calculation ───────────────────────────────────────────────────────

/**
 * Compute next run time for a schedule, in milliseconds since epoch.
 * Returns null for a "once" schedule that is already in the past.
 */
export function computeNextRun(schedule: CronSchedule, fromMs: number): number | null {
  switch (schedule.type) {
    case "cron": {
      const interval = CronExpressionParser.parse(schedule.expression, {
        currentDate: new Date(fromMs),
      });
      return interval.next().getTime();
    }
    case "interval":
      return fromMs + schedule.seconds * 1000;
    case "once":
      return schedule.at > fromMs ? schedule.at : null;
  }
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

interface JobRow {
  id: string;
  name: string;
  message: string;
  schedule_json: string;
  enabled: number;
  created_at: number;
  last_run: number | null;
  next_run: number;
}

function rowToJob(row: JobRow): CronJob {
  return {
    id: row.id,
    name: row.name,
    message: row.message,
    schedule: JSON.parse(row.schedule_json) as CronSchedule,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    lastRun: row.last_run,
    nextRun: row.next_run,
  };
}

// ── Factory ────────────────────────────────────────────────────────────────────

export function createCronService(config: CronServiceConfig): CronService {
  const { db, injectionScanner, onJob, maxSleepMs = MAX_SLEEP_MS } = config;
  const logger = createLogger("cron");

  // ── Schema ───────────────────────────────────────────────────────────────────

  db.exec(`
    CREATE TABLE IF NOT EXISTS cron_jobs (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      message      TEXT NOT NULL,
      schedule_json TEXT NOT NULL,
      enabled      INTEGER NOT NULL DEFAULT 1,
      created_at   INTEGER NOT NULL,
      last_run     INTEGER,
      next_run     INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cron_run_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id      TEXT NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
      run_at      INTEGER NOT NULL,
      status      TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      error       TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run
      ON cron_jobs(enabled, next_run);

    CREATE INDEX IF NOT EXISTS idx_cron_run_history_job_id
      ON cron_run_history(job_id, run_at);
  `);

  // ── Prepared statements ───────────────────────────────────────────────────────

  const stmtInsertJob = db.prepare<[string, string, string, string, number | null, number, number]>(`
    INSERT INTO cron_jobs (id, name, message, schedule_json, enabled, last_run, next_run, created_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?)
  `);

  const stmtDeleteJob = db.prepare<[string]>(`
    DELETE FROM cron_jobs WHERE id = ?
  `);

  const stmtSetEnabled = db.prepare<[number, string]>(`
    UPDATE cron_jobs SET enabled = ? WHERE id = ?
  `);

  const stmtListJobs = db.prepare<[]>(`
    SELECT * FROM cron_jobs ORDER BY created_at ASC
  `);

  const stmtGetJob = db.prepare<[string]>(`
    SELECT * FROM cron_jobs WHERE id = ?
  `);

  const stmtGetDueJobs = db.prepare<[number]>(`
    SELECT * FROM cron_jobs WHERE enabled = 1 AND next_run <= ?
  `);

  const stmtUpdateAfterRun = db.prepare<[number | null, number, string]>(`
    UPDATE cron_jobs SET last_run = ?, next_run = ? WHERE id = ?
  `);

  const stmtInsertHistory = db.prepare<[string, number, string, number, string | null]>(`
    INSERT INTO cron_run_history (job_id, run_at, status, duration_ms, error)
    VALUES (?, ?, ?, ?, ?)
  `);

  const stmtCountHistory = db.prepare<[string]>(`
    SELECT COUNT(*) as cnt FROM cron_run_history WHERE job_id = ?
  `);

  const stmtPruneHistory = db.prepare<[string, string, number]>(`
    DELETE FROM cron_run_history
    WHERE job_id = ?
      AND id NOT IN (
        SELECT id FROM cron_run_history
        WHERE job_id = ?
        ORDER BY run_at DESC
        LIMIT ?
      )
  `);

  const stmtEarliestNext = db.prepare<[]>(`
    SELECT MIN(next_run) as earliest FROM cron_jobs WHERE enabled = 1
  `);

  const stmtHasDue = db.prepare<[number]>(`
    SELECT COUNT(*) as cnt FROM cron_jobs WHERE enabled = 1 AND next_run <= ?
  `);

  // ── Timer state ───────────────────────────────────────────────────────────────

  let _timer: ReturnType<typeof setTimeout> | null = null;
  let _running = false;

  // ── History pruning ───────────────────────────────────────────────────────────

  function pruneHistory(jobId: string): void {
    const { cnt } = stmtCountHistory.get(jobId) as { cnt: number };
    if (cnt > MAX_RUN_HISTORY) {
      stmtPruneHistory.run(jobId, jobId, MAX_RUN_HISTORY);
    }
  }

  // ── Tick ─────────────────────────────────────────────────────────────────────

  async function _tick(): Promise<void> {
    const now = Date.now();
    const dueJobs = (stmtGetDueJobs.all(now) as JobRow[]).map(rowToJob);

    for (const job of dueJobs) {
      const runAt = Date.now();
      let status: "success" | "error" = "success";
      let errorMsg: string | null = null;

      try {
        await onJob(job);
      } catch (err) {
        status = "error";
        errorMsg = err instanceof Error ? err.message : String(err);
      }

      const durationMs = Date.now() - runAt;

      // Record run
      stmtInsertHistory.run(job.id, runAt, status, durationMs, errorMsg);
      pruneHistory(job.id);

      // Compute next_run and update job
      const nextRun = computeNextRun(job.schedule, Date.now());
      if (nextRun === null) {
        // "once" job that has fired, disable it
        stmtSetEnabled.run(0, job.id);
      } else {
        stmtUpdateAfterRun.run(Date.now(), nextRun, job.id);
      }
    }

    // Re-arm for next cycle
    if (_running) {
      _scheduleNext();
    }
  }

  function _scheduleNext(): void {
    if (!_running) return;

    const row = stmtEarliestNext.get() as { earliest: number | null };
    const earliest = row.earliest;
    const now = Date.now();

    let sleepMs: number;
    if (earliest === null) {
      sleepMs = maxSleepMs;
    } else {
      sleepMs = Math.max(0, earliest - now);
    }
    sleepMs = Math.min(sleepMs, maxSleepMs);

    _timer = setTimeout(() => {
      try {
        _tick().catch((err) => {
          logger.error({ err }, "cron _tick() failed");
          if (_running) _scheduleNext();
        });
      } catch (err) {
        // Guard against synchronous throws from _tick(), .catch() only handles
        // async rejections. Without this, a sync throw kills the timer permanently.
        logger.error({ err }, "cron _tick() threw synchronously");
        if (_running) _scheduleNext();
      }
    }, sleepMs);
  }

  // ── Public API ─────────────────────────────────────────────────────────────────

  function addJob(name: string, message: string, schedule: CronSchedule): CronJob {
    // Security: scan both name and message for prompt injection.
    // Name appears in tool output shown to LLM; message becomes an agent prompt.
    const messageScan = injectionScanner.scanForInjection(message);
    const nameScan = injectionScanner.scanForInjection(name);

    // Reject on Critical, High, or Medium severity, cron prompts run in fresh
    // sessions with full tool access, so even medium-confidence patterns are risky.
    const isDangerous = (m: { severity: string }) =>
      m.severity === "Critical" || m.severity === "High" || m.severity === "Medium";
    const dangerous = [
      ...messageScan.matches.filter(isDangerous),
      ...nameScan.matches.filter(isDangerous),
    ];
    if (dangerous.length > 0 || messageScan.hasInvisibleChars || nameScan.hasInvisibleChars) {
      throw new Error("Cron job rejected: injection pattern detected");
    }

    const id = randomUUID();
    const now = Date.now();
    const nextRun = computeNextRun(schedule, now);
    if (nextRun === null) {
      throw new Error("Cron schedule is in the past and cannot be scheduled");
    }

    stmtInsertJob.run(id, name, message, JSON.stringify(schedule), null, nextRun, now);

    const job: CronJob = {
      id,
      name,
      message,
      schedule,
      enabled: true,
      createdAt: now,
      lastRun: null,
      nextRun,
    };

    // Wake the scheduler if a closer job was added
    if (_running && _timer !== null) {
      const row = stmtEarliestNext.get() as { earliest: number | null };
      if (row.earliest !== null && row.earliest < Date.now() + maxSleepMs) {
        clearTimeout(_timer);
        _timer = null;
        _scheduleNext();
      }
    }

    return job;
  }

  function removeJob(id: string): boolean {
    // Try exact ID match first
    stmtDeleteJob.run(id);
    const changes = (db.prepare("SELECT changes()").get() as Record<string, number>)["changes()"];
    if (changes > 0) return true;

    // Fallback: try matching by name (LLMs often pass names instead of UUIDs)
    const byName = db.prepare("SELECT id FROM cron_jobs WHERE name = ?").get(id) as { id: string } | undefined;
    if (byName) {
      stmtDeleteJob.run(byName.id);
      return true;
    }

    // Fallback: try prefix match on ID (list output may show truncated IDs)
    const byPrefix = db.prepare("SELECT id FROM cron_jobs WHERE id LIKE ? || '%'").get(id) as { id: string } | undefined;
    if (byPrefix) {
      stmtDeleteJob.run(byPrefix.id);
      return true;
    }

    return false;
  }

  function enableJob(id: string): void {
    // Recompute next_run from now so it doesn't fire immediately for old jobs
    const row = stmtGetJob.get(id) as JobRow | undefined;
    if (!row) return;
    const job = rowToJob(row);
    const nextRun = computeNextRun(job.schedule, Date.now()) ?? Date.now();
    db.prepare<[number, string]>(
      "UPDATE cron_jobs SET enabled = 1, next_run = ? WHERE id = ?"
    ).run(nextRun, id);
  }

  function disableJob(id: string): void {
    stmtSetEnabled.run(0, id);
  }

  function listJobs(): CronJob[] {
    return (stmtListJobs.all() as JobRow[]).map(rowToJob);
  }

  function getJob(id: string): CronJob | undefined {
    const row = stmtGetJob.get(id) as JobRow | undefined;
    return row ? rowToJob(row) : undefined;
  }

  function start(): void {
    if (_running) return;
    _running = true;
    _scheduleNext();
  }

  function stop(): void {
    _running = false;
    if (_timer !== null) {
      clearTimeout(_timer);
      _timer = null;
    }
  }

  function hasDueJobs(): boolean {
    const row = stmtHasDue.get(Date.now()) as { cnt: number };
    return row.cnt > 0;
  }

  return {
    addJob,
    removeJob,
    enableJob,
    disableJob,
    listJobs,
    getJob,
    start,
    stop,
    hasDueJobs,
  };
}
