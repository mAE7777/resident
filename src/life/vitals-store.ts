// Persistence for the vitals time-series. Every monitor cycle appends one snapshot to a JSONL
// log AND keeps a bounded in-memory ring for trend analysis, so there is a durable, inspectable
// record with no gaps AND the detectors have fast access to the recent window. On construction it
// warm-loads the tail of the log so history survives a restart (a monitor that forgets on reboot
// has a blind spot exactly when one is most likely). Best-effort I/O: a write failure never throws
// into the monitor loop.

import { appendFileSync, readFileSync, existsSync } from "node:fs";
import type { VitalsSnapshot } from "./vitals.js";

export interface VitalsStore {
  /** Append a snapshot to the durable log and the ring. */
  append(v: VitalsSnapshot): void;
  /** The most recent `n` snapshots (chronological), from the ring. */
  recent(n: number): VitalsSnapshot[];
  /** Ring size currently held. */
  size(): number;
  /**
   * The same series at coarse resolution, reaching back WEEKS rather than hours.
   *
   * The liveness signature asks whether anything is perfectly still, and that question is only fair
   * over a stretch long enough for the slowest real signal to have moved: what she has come to know
   * about herself grows over months, and forgetting takes weeks to show. Asked over a day, half of
   * a perfectly healthy Resident looks frozen.
   *
   * Keeping the fine ring long enough for that would mean holding a fortnight at five-minute
   * resolution, four thousand snapshots, to answer a question that needs sixteen. So a second,
   * much sparser ring is kept alongside it, one entry an hour.
   */
  longView(): VitalsSnapshot[];
}

/** How far apart the coarse entries are, and how many of them are kept. */
export const LONG_VIEW_EVERY_MS = 60 * 60 * 1000;
export const LONG_VIEW_SIZE = 24 * 21; // three weeks, so a fortnight-long question has room

export function createVitalsStore(
  path: string,
  ringSize = 288,
  /** Where I/O failures are reported. Losing the record of her vitals must never be silent. */
  onFault?: (where: string, detail: unknown) => void,
): VitalsStore {
  const ring: VitalsSnapshot[] = [];
  const coarse: VitalsSnapshot[] = [];

  /** Keep one entry an hour, so a fortnight costs a few hundred snapshots rather than four thousand. */
  function maybeCoarse(v: VitalsSnapshot): void {
    const last = coarse[coarse.length - 1];
    if (last && v.ts - last.ts < LONG_VIEW_EVERY_MS) return;
    coarse.push(v);
    while (coarse.length > LONG_VIEW_SIZE) coarse.shift();
  }

  // Warm-load the tail of the log so trend detectors work right after a restart.
  if (existsSync(path)) {
    try {
      const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
      let corrupt = 0;
      // The long view is warm-loaded from further back than the fine ring, which is the whole
      // reason it exists: after a restart the slow question must still be answerable.
      for (const line of lines.slice(-(LONG_VIEW_SIZE * 12))) {
        try { maybeCoarse(JSON.parse(line) as VitalsSnapshot); } catch { /* counted below */ }
      }
      for (const line of lines.slice(-ringSize)) {
        try { ring.push(JSON.parse(line) as VitalsSnapshot); } catch { corrupt += 1; }
      }
      if (corrupt > 0) onFault?.("vitals.warmload", `${corrupt} corrupt line(s) skipped`);
    } catch (err) {
      onFault?.("vitals.warmload", err);
    }
  }

  return {
    append(v) {
      ring.push(v);
      maybeCoarse(v);
      while (ring.length > ringSize) ring.shift();
      // Keep the in-memory ring regardless, so a disk problem degrades the record but never stops
      // the monitor: and report it, because a monitor that cannot persist is itself a problem.
      try { appendFileSync(path, JSON.stringify(v) + "\n"); } catch (err) { onFault?.("vitals.persist", err); }
    },
    recent(n) {
      return n >= ring.length ? [...ring] : ring.slice(ring.length - n);
    },
    size: () => ring.length,
    longView: () => [...coarse],
  };
}
