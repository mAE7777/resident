// SQLite persistence for the inner state (drives + emotion), so the Resident's
// mood and motivations survive a restart. Single-row table; the inner state stays
// decoupled via the InnerStateStore interface.

import type { DatabaseWrapper } from "../db/sqlite.js";
import type { InnerStateStore } from "./inner-state.js";
import type { Drives } from "./drives.js";
import type { PAD } from "./emotion.js";

/**
 * @param onFault Told when a row cannot be read. NOT optional in spirit: a corrupted row makes
 *   her wake up with fresh drives and a neutral mood, which is a different person, and the old
 *   code returned null for it in silence. Losing who you were is not a thing that should have
 *   to be inferred from her seeming odd.
 */
export function createInnerStateStore(
  database: DatabaseWrapper,
  onFault?: (where: string, detail: unknown, severity?: "warn" | "critical") => void,
): InnerStateStore {
  const db = database.db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS inner_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      drives_json TEXT NOT NULL,
      emotion_json TEXT NOT NULL
    )
  `);
  const selectStmt = db.prepare<[], { drives_json: string; emotion_json: string }>(
    "SELECT drives_json, emotion_json FROM inner_state WHERE id = 1"
  );
  const upsertStmt = db.prepare<[string, string]>(
    `INSERT INTO inner_state (id, drives_json, emotion_json) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET drives_json = excluded.drives_json, emotion_json = excluded.emotion_json`
  );

  return {
    load(): { drives: Drives; emotion: PAD } | null {
      const row = selectStmt.get();
      if (!row) return null;
      try {
        return { drives: JSON.parse(row.drives_json) as Drives, emotion: JSON.parse(row.emotion_json) as PAD };
      } catch (err) {
        // She had a stored self and it could not be read. Whoever wakes up next is starting
        // from the default drives and a neutral mood, and nobody would have known.
        onFault?.("innerState.restore", err, "critical");
        return null;
      }
    },
    save(s: { drives: Drives; emotion: PAD }): void {
      database.writeWithRetry(() => {
        upsertStmt.run(JSON.stringify(s.drives), JSON.stringify(s.emotion));
      });
    },
  };
}
