// SQLite-backed persistence for the metabolism ledger, so a restart mid-day does
// not wrongly reset the day's spend (which would hand the Resident free budget).
// A single-row table; the ledger stays decoupled via the MetabolismStore interface.

import type { DatabaseWrapper } from "../db/sqlite.js";
import type { MetabolismStore, MetabolismSnapshot } from "./metabolism.js";

/** The unit the persisted ledger is denominated in. Bump this if the unit ever changes again. */
const LEDGER_UNIT = "vigor";

export function createMetabolismStore(database: DatabaseWrapper): MetabolismStore {
  const db = database.db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS metabolism_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      day_start_ms INTEGER NOT NULL,
      spent_json TEXT NOT NULL
    )
  `);

  const selectStmt = db.prepare<[], { day_start_ms: number; spent_json: string }>(
    "SELECT day_start_ms, spent_json FROM metabolism_state WHERE id = 1"
  );
  const upsertStmt = db.prepare<[number, string]>(
    `INSERT INTO metabolism_state (id, day_start_ms, spent_json) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET day_start_ms = excluded.day_start_ms, spent_json = excluded.spent_json`
  );

  return {
    load(): MetabolismSnapshot | null {
      const row = selectStmt.get();
      if (!row) return null;
      try {
        const parsed = JSON.parse(row.spent_json) as unknown;
        // The stored ledger carries the UNIT it was written in. A row written before her
        // metabolism moved from money to effort holds cents, and reading those as vigor would
        // boot her straight into dormancy on a full reserve. An unmarked or foreign unit is
        // therefore discarded rather than misread: she starts the day fresh.
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        const env = parsed as { unit?: unknown; spent?: unknown };
        if (env.unit !== LEDGER_UNIT || !env.spent || typeof env.spent !== "object") return null;
        return { dayStartMs: row.day_start_ms, spent: env.spent as Record<string, number> };
      } catch {
        return null; // corrupted row: treat as a fresh day
      }
    },
    save(snapshot: MetabolismSnapshot): void {
      database.writeWithRetry(() => {
        upsertStmt.run(snapshot.dayStartMs, JSON.stringify({ unit: LEDGER_UNIT, spent: snapshot.spent }));
      });
    },
  };
}
