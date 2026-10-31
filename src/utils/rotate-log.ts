// Rotation for the append-only records of her life (LIFE-11).
//
// `ops.jsonl` and `agency.jsonl` grow forever and are read WHOLE, at boot, hourly (the life
// tick), weekly (her self-noticing). That is O(entire history) per read, for life; and past
// V8's string ceiling `readFileSync(path, "utf8")` THROWS, which via the tick's catch becomes
// a fault every hour and, one layer further, her consolidation quietly ending for good. A
// record of a life that eventually kills the living of it.
//
// The rotation keeps the LIVE file bounded and loses nothing: when it outgrows `maxBytes`,
// the whole file is renamed to a dated archive beside it, and a tail of recent lines (cut at
// a line boundary) is written back as the new live file. Every reader wants a recent window,
// 36 hours for the tick, a fortnight for noticing, and `keepBytes` is sized far above all of
// them. The archives are her history; nothing ever deletes them.
//
// CRASH WINDOWS, NAMED: the tail is read BEFORE the rename, so a crash between rename and
// write-back loses only the live file, which appenders recreate on the next event, and the
// archive holds everything. The tail read uses a bounded pread at an offset, rotating a file
// too big to read must never itself read the whole file, or the cure inherits the disease.

import { openSync, readSync, closeSync, statSync, renameSync, writeFileSync, existsSync } from "node:fs";

/** Past this the live file rotates. Months of ordinary living at current event rates. */
export const ROTATE_AT_BYTES = 24 * 1024 * 1024;
/** What the new live file keeps. Weeks, far above every reader's window. */
export const ROTATE_KEEP_BYTES = 4 * 1024 * 1024;

export interface RotateResult {
  rotated: boolean;
  archive?: string;
  keptBytes?: number;
}

export function rotateLogIfHuge(
  path: string,
  opts: { maxBytes?: number; keepBytes?: number; now?: () => number } = {},
): RotateResult {
  const maxBytes = opts.maxBytes ?? ROTATE_AT_BYTES;
  const keepBytes = opts.keepBytes ?? ROTATE_KEEP_BYTES;
  const now = opts.now ?? Date.now;
  if (!existsSync(path)) return { rotated: false };
  const size = statSync(path).size;
  if (size <= maxBytes) return { rotated: false };

  // Bounded tail read at an offset: never the whole file.
  const fd = openSync(path, "r");
  let tail: string;
  try {
    const want = Math.min(keepBytes, size);
    const buf = Buffer.alloc(want);
    const read = readSync(fd, buf, 0, want, size - want);
    tail = buf.subarray(0, read).toString("utf8");
  } finally {
    closeSync(fd);
  }
  // Cut at the first newline so the live file never starts mid-record. (A multi-byte
  // character split at the offset lands before this newline and is cut with it.)
  const firstBreak = tail.indexOf("\n");
  if (firstBreak >= 0) tail = tail.slice(firstBreak + 1);

  const stamp = new Date(now()).toISOString().slice(0, 19).replace(/[:T]/gu, "-");
  const archive = `${path}.${stamp}.archive`;
  renameSync(path, archive);
  writeFileSync(path, tail, "utf8");
  return { rotated: true, archive, keptBytes: Buffer.byteLength(tail) };
}
