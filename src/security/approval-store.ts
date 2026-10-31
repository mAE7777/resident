// Approval persistence: SQLite-backed store for "always allow" decisions.
// Upserts by (tool_name, pattern); glob matching supports `*` wildcard only.
// Expired approvals are pruned lazily on each check() call.

import type { DatabaseWrapper } from "../db/sqlite.js";

const DEFAULT_TTL_DAYS = 30;
const DEFAULT_TTL_MS = DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000;
const MAX_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export type ApprovalDecision = "allow" | "deny";

export interface ApprovalEntry {
  id: number;
  toolName: string;
  pattern: string;
  decision: ApprovalDecision;
  createdAt: number;
  expiresAt: number;
}

export interface ApprovalStore {
  save(toolName: string, pattern: string, decision: ApprovalDecision, ttlMs?: number): ApprovalEntry;
  check(toolName: string, input: string): ApprovalDecision | null;
  remove(id: number): void;
  loadAll(): ApprovalEntry[];
  pruneExpired(): void;
}

// matchGlob: pattern may contain `*` wildcards (any substring, zero or more chars).
// Split on `*` and verify all parts appear in order in the input.
function matchGlob(pattern: string, input: string): boolean {
  if (!pattern.includes("*")) {
    return pattern === input;
  }
  const parts = pattern.split("*");
  let pos = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === "") continue;
    const idx = input.indexOf(part, pos);
    if (idx === -1) return false;
    // First segment must start at the beginning (no leading wildcard)
    if (i === 0 && idx !== 0) return false;
    pos = idx + part.length;
  }
  // Last segment must end at the end of input (no trailing wildcard)
  const last = parts[parts.length - 1];
  if (last !== "" && !input.endsWith(last)) return false;
  return true;
}

function ensureTable(db: DatabaseWrapper): void {
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS approval_persistence (
      id         INTEGER PRIMARY KEY,
      tool_name  TEXT    NOT NULL,
      pattern    TEXT    NOT NULL,
      decision   TEXT    NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      UNIQUE (tool_name, pattern)
    )
  `);
}

function rowToEntry(row: Record<string, unknown>): ApprovalEntry {
  return {
    id: row["id"] as number,
    toolName: row["tool_name"] as string,
    pattern: row["pattern"] as string,
    decision: row["decision"] as ApprovalDecision,
    createdAt: row["created_at"] as number,
    expiresAt: row["expires_at"] as number,
  };
}

export function createApprovalStore(db: DatabaseWrapper): ApprovalStore {
  ensureTable(db);

  const saveStmt = db.db.prepare(`
    INSERT INTO approval_persistence (tool_name, pattern, decision, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (tool_name, pattern) DO UPDATE SET
      decision   = excluded.decision,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at
  `);

  const pruneStmt = db.db.prepare(
    `DELETE FROM approval_persistence WHERE expires_at <= ?`
  );

  const loadAllStmt = db.db.prepare(
    `SELECT id, tool_name, pattern, decision, created_at, expires_at FROM approval_persistence ORDER BY id ASC`
  );

  const removeStmt = db.db.prepare(
    `DELETE FROM approval_persistence WHERE id = ?`
  );

  return {
    save(toolName, pattern, decision, ttlMs = DEFAULT_TTL_MS): ApprovalEntry {
      const now = Date.now();
      const clampedTtl = Math.min(Math.max(0, ttlMs), MAX_TTL_MS);
      const expiresAt = now + clampedTtl;
      db.writeWithRetry(() => saveStmt.run(toolName, pattern, decision, now, expiresAt));
      const row = db.db
        .prepare(`SELECT id, tool_name, pattern, decision, created_at, expires_at FROM approval_persistence WHERE tool_name = ? AND pattern = ?`)
        .get(toolName, pattern) as Record<string, unknown>;
      return rowToEntry(row);
    },

    check(toolName, input): ApprovalDecision | null {
      // Lazy prune before matching
      const now = Date.now();
      db.writeWithRetry(() => pruneStmt.run(now));

      const rows = loadAllStmt.all() as Record<string, unknown>[];
      for (const row of rows) {
        const entry = rowToEntry(row);
        if (entry.toolName === toolName && matchGlob(entry.pattern, input)) {
          return entry.decision;
        }
      }
      return null;
    },

    remove(id): void {
      db.writeWithRetry(() => removeStmt.run(id));
    },

    loadAll(): ApprovalEntry[] {
      const rows = loadAllStmt.all() as Record<string, unknown>[];
      return rows.map(rowToEntry);
    },

    pruneExpired(): void {
      const now = Date.now();
      db.writeWithRetry(() => pruneStmt.run(now));
    },
  };
}
