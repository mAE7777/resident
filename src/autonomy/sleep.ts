// Sleep-time compute: idle detector that runs background tasks when the user
// has been inactive for 30+ minutes.
//
// Gate-order pattern (cheapest check first):
//   1. Time elapsed >= IDLE_THRESHOLD_MS (free)
//   2. Not already sleeping (free boolean)
//   3. No lock/guard (free boolean)
//   Then run sleep tasks
//
// Sleep task queue (priority order). Twelve of the sixteen inherited tasks were removed in
// an earlier cleanup with the machines they served, the dream consolidator, the skill
// pipeline, the empty memory stack, behavioral profiling, trajectory relabeling and the
// capability self-review. What remains is watching and record-keeping, nothing that writes
// into her world:
//   1. Stuck candidate promotion
//   2. Sentinel anomaly sweep
//   3. Workspace hygiene audit (read-only)
//   4. Identity file integrity check
//
// AbortController: a fresh controller is created when entering sleep mode.
// onUserMessage() aborts the current controller, which causes runSleepTasks()
// to exit between tasks.
//
// Re-arming setTimeout pattern (same as cron.ts) prevents timer drift.

import type { Logger } from "../utils/logger.js";
import type { IntegrityChecker } from "../memory/integrity.js";
import type { SentinelProcessor } from "../self-improvement/sentinel.js";
import type { HygieneAuditor } from "../self-improvement/hygiene-audit.js";
import { promoteStuckCandidates } from "../agent/stuck.js";

// ── Constants ─────────────────────────────────────────────────────────────────

export const IDLE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
export const CHECK_INTERVAL_MS = 60_000; // 1 minute polling

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SleepTimeComputeDeps {
  db?: import("../db/sqlite.js").DatabaseWrapper | null;
  integrityChecker?: IntegrityChecker | null;
  identityFilePaths?: string[] | null;
  sentinel?: SentinelProcessor | null;
  hygieneAuditor?: HygieneAuditor | null;
  logger: Logger;
  /**
   * The tamper alarm's alert must REACH someone. An identity-file mismatch used to be a
   * `logger.warn` and nothing else: it fired every sleep cycle for four days into a console,
   * while the fault channel, the thing the watch actually reads, knew nothing. It was found
   * only because someone happened to look at the terminal. An alarm nobody is wired to hear
   * is not an alarm (no-silent-failures).
   */
  onFault?: (where: string, detail: unknown, severity?: "warn" | "critical") => void;
}

export interface SleepTimeCompute {
  /** Reset idle timer and abort any in-progress sleep tasks. */
  onUserMessage(): void;
  /** Start idle polling. checkIntervalMs defaults to CHECK_INTERVAL_MS. */
  start(checkIntervalMs?: number): void;
  /** Stop idle polling and clear timer. */
  stop(): void;
  /** True while sleep tasks are running. */
  readonly sleeping: boolean;
  /** Timestamp of the last user message (ms since epoch). */
  readonly lastUserMessageTime: number;
}

// ── Factory ────────────────────────────────────────────────────────────────────

export function createSleepTimeCompute(deps: SleepTimeComputeDeps): SleepTimeCompute {
  const {
    integrityChecker = null,
    identityFilePaths = null,
    logger,
  } = deps;
  const sentinel = deps.sentinel ?? null;
  const hygieneAuditor = deps.hygieneAuditor ?? null;

  let _sleeping = false;
  let _lastUserMessageTime = Date.now();
  let _timer: ReturnType<typeof setTimeout> | null = null;
  let _running = false;
  let _guard = false;
  let _hasSleptThisCycle = false; // true once sleep tasks ran; reset by onUserMessage
  let _abortController: AbortController | null = null;

  // ── Sleep task runner ──────────────────────────────────────────────────────

  const db = deps.db ?? null;

  async function runSleepTasks(signal: AbortSignal): Promise<void> {
    // Task 1: Stuck candidate promotion, teaches the detector new repeated failure sequences
    if (db !== null) {
      try {
        const result = promoteStuckCandidates(db);
        logger.info(result, "sleep-time: stuck candidates evaluated");
      } catch (err) { logger.warn({ err }, "sleep-time task failed"); }
    }

    // Task 2: Sentinel anomaly sweep, records broad weak signals and review proposals
    if (signal.aborted) return;
    if (sentinel !== null) {
      try {
        const result = await sentinel.process("sleep-time");
        logger.info(result, "sleep-time: sentinel anomaly sweep complete");
      } catch (err) { logger.warn({ err }, "sleep-time sentinel sweep failed"); }
    } else {
      logger.debug({}, "sleep-time: sentinel sweep skipped (missing deps)");
    }

    // Task 3: Workspace hygiene audit, proposes cleanup, never deletes
    if (signal.aborted) return;
    if (hygieneAuditor !== null) {
      try {
        const result = await hygieneAuditor.process();
        logger.info(result, "sleep-time: workspace hygiene audit complete");
      } catch (err) { logger.warn({ err }, "sleep-time hygiene audit failed"); }
    } else {
      logger.debug({}, "sleep-time: hygiene audit skipped (missing deps)");
    }

    // Task 4: Identity file integrity check
    if (signal.aborted) return;
    if (integrityChecker !== null && identityFilePaths !== null && identityFilePaths.length > 0) {
      /**
       * Give a file its first sidecar, so the alarm has a baseline to compare against.
       *
       * Only ever on the FIRST pass for a file: after that a missing sidecar means something
       * removed it, which is itself worth hearing about. Creating a baseline is not the same
       * as approving a change, it records what the file looks like now, from a daemon that
       * has just verified everything else about itself at boot.
       */
      const sidecarSeeded = new Set<string>();
      const ensureSidecar = (filePath: string, err: unknown): void => {
        if (sidecarSeeded.has(filePath)) {
          logger.warn({ filePath, err: err instanceof Error ? err.message : String(err) },
            "sleep-time: identity file has no checksum to compare against — the tamper alarm is off for it");
          deps.onFault?.("integrity.alarm-off", `这份身份文件没有指纹可比，警报对它是关着的：${filePath}`);
          return;
        }
        sidecarSeeded.add(filePath);
        try {
          integrityChecker.writeChecksum(filePath);
          logger.info({ filePath }, "sleep-time: recorded a first checksum for an identity file");
        } catch (writeErr) {
          logger.warn({ filePath, err: writeErr instanceof Error ? writeErr.message : String(writeErr) },
            "sleep-time: could not record a checksum — the tamper alarm stays off for this file");
          deps.onFault?.("integrity.alarm-off", `指纹盖不上，警报对它是关着的：${filePath}`);
        }
      };
      try {
        for (const filePath of identityFilePaths) {
          if (signal.aborted) break;
          try {
            const alert = integrityChecker.verifyWithSidecar(filePath);
            if (alert !== null) {
              logger.warn(
                { filePath: alert.filePath, expected: alert.expected, actual: alert.actual },
                "sleep-time: integrity alert — identity file checksum mismatch"
              );
              deps.onFault?.("integrity.tampered",
                `身份文件在她不在场时被改过：${alert.filePath}`, "critical");
            }
          } catch (err) {
            // ── A MISSING SIDECAR IS THE ALARM BEING OFF, NOT A NON-EVENT ────────────
            //
            // This was a bare `catch {}` reading "sidecar not present, file may not be
            // registered yet", and nothing ever registered three of the four. Sidecars were
            // written from exactly two places: Dream, for files it had CHANGED (and Dream may
            // only edit MEMORY.md), and the capability self-model, for its own file. So
            // SOUL.md, IDENTITY.md and AGENT.md never had one at all, `verifyWithSidecar`
            // threw on every one of them every night, and the throw was swallowed here.
            //
            // The one detector that would notice her identity moving without her was off for
            // three of the four files it names, and silent about being off. That is exactly
            // the silent-failure class this project rules out, sitting inside the integrity
            // check itself. It is now created if absent (below) and reported if it still is.
            ensureSidecar(filePath, err);
          }
        }
        logger.info({}, "sleep-time: identity file integrity check complete");
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, "sleep-time: integrity check failed");
      }
    } else {
      logger.debug({}, "sleep-time: integrity check skipped (missing deps)");
    }

  }

  // ── Tick ──────────────────────────────────────────────────────────────────

  async function tick(): Promise<void> {
    // Gate 1: time elapsed
    const elapsed = Date.now() - _lastUserMessageTime;
    if (elapsed < IDLE_THRESHOLD_MS) return;

    // Gate 2: not already sleeping
    if (_sleeping) return;

    // Gate 3: no lock/guard
    if (_guard) return;

    // Gate 4: already ran tasks for this idle cycle (reset only by onUserMessage)
    if (_hasSleptThisCycle) return;

    // Enter sleep mode
    _sleeping = true;
    _guard = true;
    _abortController = new AbortController();
    const { signal } = _abortController;

    logger.info({ elapsed }, "sleep-time: entering sleep mode, running background tasks");

    try {
      await runSleepTasks(signal);
    } catch { /* best-effort */ }

    _sleeping = false;
    _guard = false;
    _hasSleptThisCycle = true;
    _abortController = null;

    logger.debug({}, "sleep-time: sleep tasks complete");
  }

  // ── Re-arming timer ────────────────────────────────────────────────────────

  function scheduleNext(intervalMs: number): void {
    if (!_running) return;
    _timer = setTimeout(() => {
      tick().then(() => scheduleNext(intervalMs)).catch(() => scheduleNext(intervalMs));
    }, intervalMs);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function onUserMessage(): void {
    _lastUserMessageTime = Date.now();
    _sleeping = false;
    _hasSleptThisCycle = false;
    if (_abortController !== null) {
      _abortController.abort();
      _abortController = null;
    }
  }

  function start(checkIntervalMs: number = CHECK_INTERVAL_MS): void {
    if (_running) return;
    _running = true;
    scheduleNext(checkIntervalMs);
  }

  function stop(): void {
    _running = false;
    if (_timer !== null) {
      clearTimeout(_timer);
      _timer = null;
    }
  }

  return {
    onUserMessage,
    start,
    stop,
    get sleeping() {
      return _sleeping;
    },
    get lastUserMessageTime() {
      return _lastUserMessageTime;
    },
  };
}
