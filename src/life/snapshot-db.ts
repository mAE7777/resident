// The two database operations a snapshot needs, and the reason they are not a file copy.
//
// `VACUUM INTO` is SQLite's own "give me a consistent copy of this live database". It reads the
// database through the connection, so the write-ahead log is included BY DEFINITION, there is no
// window in which a committed transaction sits in `data.db-wal` and misses the copy. That window is
// exactly what the previous export ritual fell into: it copied `data.db` as bytes, `-wal` appears
// nowhere in `src/`, and the checkpoint that would have folded the WAL in is PASSIVE and every
// fifty writes, which is allowed to do nothing at all while a reader is open.
//
// The TRUNCATE checkpoint before it is belt and braces rather than the mechanism: it keeps the WAL
// from growing without bound over a long uptime, and it makes the snapshot's own read cheaper.
// If it cannot run (a reader is busy), the vacuum is still correct.

import type Database from "better-sqlite3";
import type { SnapshotDb } from "./snapshot.js";
import { existsSync, rmSync } from "node:fs";

export function snapshotDbFrom(db: Database.Database, openCopy: (path: string) => Database.Database): SnapshotDb {
  return {
    copyTo(dest: string): void {
      // VACUUM INTO refuses to overwrite. A leftover from an interrupted snapshot must not turn
      // into "the copy silently did not happen".
      if (existsSync(dest)) rmSync(dest, { force: true });
      try {
        db.pragma("wal_checkpoint(TRUNCATE)");
      } catch {
        // A checkpoint that cannot run does not make the copy wrong, VACUUM INTO reads through
        // the WAL either way. Swallowed on purpose, and only here.
      }
      db.prepare("VACUUM INTO ?").run(dest);
    },

    checkCopy(path: string): string {
      // Opened as a SEPARATE connection against the copy. Checking the live database would answer
      // a different question: whether the thing we are copying FROM is healthy, not whether the
      // thing we would restore FROM is.
      const copy = openCopy(path);
      try {
        const rows = copy.pragma("quick_check") as Array<{ quick_check: string }>;
        return rows[0]?.quick_check ?? "no answer";
      } finally {
        try { copy.close(); } catch { /* best-effort */ }
      }
    },
  };
}
