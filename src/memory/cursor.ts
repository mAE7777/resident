// Cursor store: tracks per-consumer read positions in the session JSONL log.
// Each consumer (consolidator, sentinel) maintains an independent
// cursor in SQLite so they can process entries at different rates.

import type { DatabaseWrapper } from "../db/sqlite.js";

export type CursorName =
  | "consolidator"
  | "sentinel_ops"
  | "sentinel_conversation";

/**
 * Cursors whose consumers were removed in an earlier cleanup: the dream machine, the
 * empty search indexer, and the capability-improvement pipeline. Their rows must LEAVE the
 * store, not merely stop advancing, a frozen cursor over a rotating log is a per-boot
 * critical fault (cursor.drift) waiting for the first rotation.
 */
export const RETIRED_CURSORS = [
  "dream",
  "search_indexer",
  "capability_improvement",
  "capability_improvement_conversation",
] as const;

export interface CursorStore {
  /** Returns the current cursor position for the given consumer (0 if never set). */
  get(name: CursorName): number;
  /** Advance the cursor to the given position. Position is the last-processed entry id. */
  set(name: CursorName, position: number): void;
  /** One-time migration: delete rows for consumers that no longer exist. Idempotent. */
  retireDeadCursors(): number;
}

export function createCursorStore(db: DatabaseWrapper): CursorStore {
  db.db.exec(
    `CREATE TABLE IF NOT EXISTS cursors (
      name     TEXT PRIMARY KEY,
      position INTEGER NOT NULL DEFAULT 0
    )`
  );

  const stmtGet = db.db.prepare<[string], { position: number }>(
    `SELECT position FROM cursors WHERE name = ?`
  );

  const stmtUpsert = db.db.prepare<[string, number]>(
    `INSERT INTO cursors (name, position) VALUES (?, ?)
     ON CONFLICT(name) DO UPDATE SET position = excluded.position`
  );

  return {
    get(name: CursorName): number {
      const row = stmtGet.get(name);
      return row ? row.position : 0;
    },

    set(name: CursorName, position: number): void {
      db.writeWithRetry(() => stmtUpsert.run(name, position));
    },

    retireDeadCursors(): number {
      let removed = 0;
      for (const name of RETIRED_CURSORS) {
        db.writeWithRetry(() => {
          removed += db.db.prepare(`DELETE FROM cursors WHERE name = ?`).run(name).changes;
        });
      }
      return removed;
    },
  };
}
