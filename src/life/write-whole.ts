// Writing a whole file so that a kill cannot leave half of one.
//
// WHAT A TORN WRITE COSTS HER, WHICH IS EVERYTHING. Three files hold the parts of her that are
// about WHO SHE IS rather than what she happens to hold: `continuity.json` (her temperament,
// her random stream and its position, whether she is in safe mode, when she last lived a
// moment), `self-knowledge.json` (what she has come to believe about herself), and each day of
// her diary. All three were written with a bare full-file `writeFileSync`.
//
// A bare full-file write is not one operation. The file is truncated first and the bytes arrive
// after, so a kill in between leaves a truncated file, and then:
//
//   `load()` catches the JSON parse error and returns null
//     → boot falls through to defaults: neutral temperament, safe mode off, empty egress set,
//       and a BRAND NEW RANDOM STREAM SEED
//     → she is a different person, silently
//     → and within five minutes `persistContinuity()` overwrites the corrupt file, destroying
//       the only evidence that it ever happened
//
// `continuity.json` is rewritten every five minutes and after every moment, so the window is
// not theoretical: it is open several hundred times a day for the whole life of the process.
//
// Write to a temporary file, then rename. Rename is atomic on every filesystem she will ever
// run on, so a reader sees either the old whole file or the new whole file and never a piece
// of one. The pattern already existed in `self-improvement/review-ledger.ts`; it simply never
// reached the three files where losing the write loses HER.

import { mkdirSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

/**
 * A minimal filesystem, so callers that already inject one for tests keep working.
 *
 * Every method is the node:fs one. Defaulted rather than required, because the three call
 * sites this exists for have three different opinions about dependency injection and none of
 * them should have to change to get an atomic write.
 */
export interface WholeFileFs {
  mkdirSync(path: string, opts: { recursive: true }): void;
  writeFileSync(path: string, data: string, enc: "utf8"): void;
  renameSync(from: string, to: string): void;
  unlinkSync?(path: string): void;
}

const REAL: WholeFileFs = { mkdirSync, writeFileSync, renameSync, unlinkSync };

/**
 * Replace a file's whole contents, or leave it exactly as it was.
 *
 * The temp name carries the pid, so two processes writing the same file cannot collide on the
 * temporary, which matters because nothing stops a second daemon starting today.
 */
export function writeWhole(path: string, content: string, fs: WholeFileFs = REAL): void {
  fs.mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, path);
  } catch (err) {
    // Leave no rubble. A failed write must not also litter her home with fragments that a
    // later reader might mistake for something of hers.
    try { fs.unlinkSync?.(tmp); } catch { /* it may never have been created */ }
    throw err;
  }
}
