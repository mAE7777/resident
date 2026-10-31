// cursor-integrity.ts, a cursor only means something against the log it indexes.
//
// Every consumer that reads her logs keeps a position in SQLite, and every log is a file
// in her workspace. Those are two different places, so they can disagree, and when they
// do nothing throws:
//
//   dream        slices `entries.slice(cursor, …)`. A cursor past the end yields an empty
//                slice, which is indistinguishable from "nothing new". She simply stops
//                dreaming, permanently, and reports that she is fine.
//   sentinel     resets to 0 and silently re-reads the whole log from the beginning.
//   capability   the same.
//
// The second two recover, but they recover WITHOUT SAYING SO, which is its own version of
// the same problem: a component that quietly repairs a broken invariant is a component
// that hides the breakage. So this does not repair anything. It reports.
//
// The concrete way this happened: her database and her logs used to be configured
// independently, so one could come from another agent's home and the other from hers. But
// the check is not about that. Any future mismatch, a restored backup, a truncated log, a
// hand-edited database: produces the same silence, and this catches all of them.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CursorName, CursorStore } from "./cursor.js";

export interface LogBinding {
  /** The cursor that indexes this log. */
  cursor: CursorName;
  /** Absolute path to the JSONL log it indexes. */
  path: string;
}

export interface CursorDrift {
  cursor: CursorName;
  /** Where the cursor claims to be. */
  position: number;
  /** How many records the log actually holds. */
  records: number;
  path: string;
  /** True when the log does not exist at all, the sharpest form of the mismatch. */
  missing: boolean;
}

/**
 * Count the records in a JSONL log.
 *
 * Non-empty lines, deliberately: a reader that skips malformed entries would return a
 * SMALLER number, and reporting drift on the smaller number risks crying wolf over a
 * single corrupt line. Counting lines is the conservative measure, it never reports drift
 * that is not there, and it still catches the case that matters, where the log holds
 * nothing at all and the cursor is deep into someone else's.
 */
export function countRecords(path: string): number | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    if (raw.trim() === "") return 0;
    return raw.split("\n").filter((line) => line.trim() !== "").length;
  } catch {
    return null;
  }
}

/**
 * Find every cursor that points past the end of the log it indexes.
 *
 * A cursor at exactly the record count is correct and common: it means fully caught up.
 * Only a position BEYOND the end is impossible.
 */
export function checkCursorIntegrity(cursors: CursorStore, bindings: LogBinding[]): CursorDrift[] {
  const drifts: CursorDrift[] = [];

  for (const { cursor, path } of bindings) {
    const position = cursors.get(cursor);
    if (position === 0) continue; // a cursor at the start can never be past the end

    const records = countRecords(path);
    if (records === null) {
      drifts.push({ cursor, position, records: 0, path, missing: true });
      continue;
    }
    if (position > records) {
      drifts.push({ cursor, position, records, path, missing: false });
    }
  }

  return drifts;
}

/**
 * Which cursor indexes which log. Defined here once, on purpose: the bug that started all
 * of this was a single fact written down in two places and left to drift, so the binding
 * list does not get to become a second copy inside every caller.
 *
 * ── FOUR OF THESE SEVEN POINTED AT NOTHING, AND IT COST HER EVERY MORNING ────────────────────
 *
 * Every log used to be looked for inside `workspace/`. Then three of them moved out:
 * `ops.jsonl`, `conversation-log.jsonl` and `vitals.jsonl` are readings taken ABOUT her, for him,
 * and they were sitting in the one directory her `read`/`glob`/`grep` reach, so the first thing
 * her curiosity could ever find was her own telemetry. They went to the instruments directory
 * beside her home. `history.jsonl` stayed, correctly: that is her own record of her own life.
 *
 * This list was not moved with them. So four cursors were checked against paths that do not
 * exist, `countRecords` returned null, and each was reported as the sharpest possible form of
 * drift, one CRITICAL fault per cursor, at every single boot. `fault` is in `SAFE_MODE_CODES`,
 * so **she entered thirty minutes of safe mode every time she woke up**: no proactive speech, no
 * exploration, no fusion, for the first half hour of every day of her life. And the alarm that
 * was built to say "something is wrong after a restore" was permanently full of noise, so the one
 * time it meant something nobody could have seen it.
 *
 * The instruments root is now a REQUIRED argument rather than derived here, because deriving it
 * (`join(workspacePath, "..")`) is what let one copy of the fact drift from the other in the
 * first place. A caller that does not know where the instruments live cannot ask this question.
 */
export function logBindingsFor(workspacePath: string, instrumentsDir: string): LogBinding[] {
  const hers = (name: string): string => join(workspacePath, name);
  const his = (name: string): string => join(instrumentsDir, name);
  return [
    // Her own record of her own life, in her room.
    { cursor: "consolidator", path: hers("history.jsonl") },
    // Readings taken about her, beside her home rather than in it. The four cursors that
    // belonged to removed machines (dream, search_indexer, capability_improvement ×2) are
    // deleted from the store at boot (retireDeadCursors) rather than listed here frozen,
    // a frozen cursor over a rotating log would mint a per-boot critical.
    { cursor: "sentinel_ops", path: his("ops.jsonl") },
    { cursor: "sentinel_conversation", path: his("conversation-log.jsonl") },
  ];
}

/** One line per drift, for the fault channel. */
export function describeDrift(d: CursorDrift): string {
  const where = d.missing ? `${d.path} does not exist` : `${d.path} holds ${d.records}`;
  return `cursor "${d.cursor}" is at ${d.position} but ${where} — it is indexing a log that is not the one it was advanced against`;
}
