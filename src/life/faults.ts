// The fault channel: nothing about her life is allowed to fail quietly.
//
// A swallowed error is worse than a crash: the system keeps running while something inside it is
// broken, and nobody finds out until the damage is visible. Logging alone does not fix that,
// because nobody reads logs. So every failure in her living layer is RECORDED here, the watchtower
// reads this on every cycle, and a fault becomes an alert that actually reaches Eric.
//
// Deliberately tiny and near-dependency-free: it must never be the thing that throws. Recording a
// fault cannot fail, and it is safe to call from inside a catch block. The one import is the beat
// spine, itself dependency-free and throw-free, read only to stamp WHICH beat of her life the
// fault belongs to.

import { currentBeat } from "../utils/beat.js";

export type FaultSeverity = "warn" | "critical";

export interface Fault {
  ts: number;
  /** Where it broke, e.g. "agency.journal" or "vitals.persist". */
  where: string;
  detail: string;
  severity: FaultSeverity;
  /**
   * WHICH beat of her life it broke in (`beat.ts`), stamped automatically at record time.
   * Absent when the fault happened outside any beat, boot, shutdown, and absent is honest
   * there: those are the two moments of her day that genuinely are not beats.
   */
  beat?: string;
}

export interface FaultLog {
  /** Record a failure. Never throws. */
  record(where: string, detail: unknown, severity?: FaultSeverity): void;
  /** Faults recorded at or after `sinceMs`. */
  since(sinceMs: number): Fault[];
  /** Everything currently retained, newest last. */
  all(): Fault[];
  /** Total faults recorded since start (including any dropped from the ring). */
  total(): number;
}

export function describeError(detail: unknown): string {
  if (detail instanceof Error) return detail.message || detail.name;
  if (typeof detail === "string") return detail;
  try {
    // JSON.stringify returns undefined (not a string) for undefined and for functions, which would
    // then blow up downstream and lose the very fault we are trying to report.
    const json = JSON.stringify(detail);
    return typeof json === "string" ? json : String(detail);
  } catch {
    return String(detail);
  }
}

/**
 * `now` is injectable for the same reason it is everywhere else in this layer: the monitor cycle
 * compares its cursor against these timestamps, so a test that cannot control both clocks is not
 * testing the cursor at all, it is testing whichever of the two happened to run first. Defaults to
 * the real clock, so nothing at the call sites changes.
 */
export function createFaultLog(
  capacity = 200,
  onFault?: (f: Fault) => void,
  now: () => number = Date.now,
  /**
   * Where the ring is kept between runs.
   *
   * WITHOUT THIS THE RING DIES WITH THE PROCESS, and the faults it loses are exactly the ones that
   * explain why the process died. She crashes, comes back, and everything that went wrong in the
   * minutes before is gone, so the one investigation anybody would want to run is the one that is
   * never possible. The whole point of this channel is that nothing fails quietly, and a channel
   * that forgets on restart fails quietly about failure itself.
   *
   * Best-effort, and deliberately so: a fault log that can throw would take her down at the exact
   * moment something is already wrong.
   */
  store?: FaultStore,
): FaultLog {
  const ring: Fault[] = store?.load(capacity) ?? [];
  let total = ring.length;

  return {
    record(where, detail, severity = "warn") {
      try {
        // The beat stamp is what makes a fault LOCATABLE: same id in beats.jsonl, ops.jsonl and
        // the conversation log, so "what else was happening when this broke" is one grep, not a
        // time-window guess across interleaved beats.
        const beat = currentBeat()?.id;
        const fault: Fault = {
          ts: now(), where, detail: describeError(detail).slice(0, 500), severity,
          ...(beat === undefined ? {} : { beat }),
        };
        ring.push(fault);
        while (ring.length > capacity) ring.shift();
        total += 1;
        try { store?.append(fault); } catch { /* the fault is still in the ring above */ }
        // The sink is best-effort by construction: a broken reporter must not break the reporting.
        try { onFault?.(fault); } catch { /* the fault is still recorded above */ }
      } catch { /* recording a fault must never itself throw */ }
    },
    since: (sinceMs) => ring.filter((f) => f.ts >= sinceMs),
    all: () => [...ring],
    total: () => total,
  };
}

/** Somewhere the ring survives a restart. One line per fault, newest last. */
export interface FaultStore {
  append(f: Fault): void;
  /** The last `n` faults, oldest first. Never throws: a damaged file costs history, not her boot. */
  load(n: number): Fault[];
}

/**
 * A JSONL file beside her home, in the instruments directory.
 *
 * Not inside her workspace, for the same reason as `ops.jsonl` and `vitals.jsonl`: this is a
 * reading taken ABOUT her, for him, and her `read`/`glob`/`grep` reach her workspace. A list of
 * everything that has ever broken inside her is not something to hand her to browse.
 */
export function createFaultStore(
  path: string,
  fs: {
    appendFileSync(p: string, data: string, enc: "utf8"): void;
    readFileSync(p: string, enc: "utf8"): string;
    existsSync(p: string): boolean;
  },
): FaultStore {
  return {
    append(f) {
      fs.appendFileSync(path, `${JSON.stringify(f)}\n`, "utf8");
    },
    load(n) {
      try {
        if (!fs.existsSync(path)) return [];
        const lines = fs.readFileSync(path, "utf8").split("\n").filter((l) => l.trim() !== "");
        const out: Fault[] = [];
        for (const line of lines.slice(-n)) {
          try {
            const f = JSON.parse(line) as Fault;
            // One mangled line costs that line. A parse guard around the whole file would throw
            // away the entire history for a single truncated write, which is what a crash mid-append
            // leaves behind: and a crash is precisely when this file matters most.
            if (typeof f?.ts === "number" && typeof f?.where === "string") out.push(f);
          } catch { /* skip the line, keep the rest */ }
        }
        return out;
      } catch {
        return [];
      }
    },
  };
}
