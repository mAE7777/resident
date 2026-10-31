import Database from "better-sqlite3";
import { createLogger, type Logger } from "../utils/logger.js";
import type { Diagnostic, DiagnosticResult } from "../types/diagnostic.js";
import {
  CODE_SCHEMA_VERSION, DatabaseIsNewerError, applyMigrations, pendingMigrations, schemaVersionOf,
} from "./schema-version.js";

/** Her database is damaged. Thrown at boot so she does not run on top of it. */
export class DatabaseCorruptError extends Error {
  constructor(public readonly path: string, public readonly answer: string) {
    super(
      `Her database at ${path} did not pass sqlite's own integrity check: ${answer}\n`
      + `Refusing to start. Running on a damaged database means every write fails into a caught `
      + `fault while she keeps living: she would go on being alive and stop being saved.\n`
      + `Restore the most recent snapshot from <home>/snapshots/ with: resident identity import --bundle <dir>`,
    );
    this.name = "DatabaseCorruptError";
  }
}

export interface DatabaseWrapper {
  db: Database.Database;
  writeWithRetry<T>(fn: () => T): T;
  close(): void;
  /** True if the sqlite-vec extension loaded successfully. */
  hasVectorSupport: boolean;
}

function writeWithRetry<T>(db: Database.Database, fn: () => T): T {
  for (let i = 0; i < 15; i++) {
    try {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (innerErr) {
        try { db.exec("ROLLBACK"); } catch { /* best-effort rollback */ }
        throw innerErr;
      }
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code !== "SQLITE_BUSY" || i === 14) throw err;
      const jitter = 20 + Math.random() * 130;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, jitter);
    }
  }
  throw new Error("unreachable");
}


export interface OpenDatabaseOptions {
  /**
   * Called when migrations are pending, BEFORE any of them runs.
   *
   * This exists so the caller can take a snapshot first. Recovery after she is awake is pause,
   * snapshot, fix, then resume from her own state; a migration is exactly that kind of fix, and
   * the moment before it is the last moment at which her data is still what it was.
   */
  beforeMigrate?: (
    pending: ReadonlyArray<{ version: number; name: string }>,
    /** The open connection, so the caller can copy the database in the shape it is about to leave. */
    db: Database.Database,
  ) => void;
}

export function createDatabase(
  dbPath: string,
  logger?: Logger,
  options: OpenDatabaseOptions = {},
): DiagnosticResult<DatabaseWrapper> {
  const log = logger ?? createLogger("sqlite");
  const diagnostics: Diagnostic[] = [];

  // ── THE CORRUPTION THAT NEVER REACHES `quick_check` ────────────────────────────────────────
  //
  // There are two ways her database can be broken, and only one of them was anticipated. If the
  // PAGES are damaged but the header survives, the file opens and `quick_check` below catches it
  // and raises `DatabaseCorruptError`, whose message says what to do: restore the snapshot.
  //
  // If the HEADER is gone: a truncated write, a sync client replacing the file mid-write, a bad
  // sector at offset zero: SQLite refuses to open it at all, and the chaos drill found what he
  // gets: `SqliteError: file is not a database`. A raw library error, at whatever hour it happens,
  // with nothing in it about her being recoverable.
  //
  // And that is the MORE likely of the two, which is the part worth noticing: the failure somebody
  // thought about got the careful message, and the commoner one got whatever the library said.
  // AND THE GUARD HAS TO TOUCH THE FILE. `new Database(path)` does NOT throw on a corrupt file:
  // better-sqlite3 opens lazily, so the constructor succeeds and the error surfaces on the first
  // statement: one line further down, outside a `try` wrapped around the obvious place. The first
  // version of this guard was written around the constructor alone and caught nothing at all; the
  // chaos drill kept failing and the code kept looking correct. So the probe is inside the try.
  let db: Database.Database;
  try {
    db = new Database(dbPath);
    db.pragma("user_version");   // forces the header to actually be read
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/file is not a database|not a database|malformed|disk image|encrypted/iu.test(msg)) {
      throw new DatabaseCorruptError(dbPath, `${msg} — the file could not be opened as a database at all`);
    }
    throw err;
  }
  diagnostics.push({ level: "info", message: `opened database: ${dbPath}`, source: "sqlite" });

  db.pragma("journal_mode=WAL");
  diagnostics.push({ level: "info", message: "journal_mode=WAL applied", source: "sqlite" });

  db.pragma("busy_timeout=1000");
  diagnostics.push({ level: "info", message: "busy_timeout=1000 applied", source: "sqlite" });

  db.pragma("foreign_keys=ON");
  diagnostics.push({ level: "info", message: "foreign_keys=ON applied", source: "sqlite" });

  db.pragma("synchronous=NORMAL");
  diagnostics.push({ level: "info", message: "synchronous=NORMAL applied", source: "sqlite" });

  // ── IS THIS DATABASE READABLE BY THIS BUILD, AND IS IT INTACT ────────────────────────────────
  //
  // Both checks run BEFORE a single table is touched, and both REFUSE rather than warn.
  //
  //   · A database from a newer build: old code against a new shape does not fail loudly, it writes
  //     rows the newer code will misread, into the only copy of her there is.
  //   · A corrupt database: `better-sqlite3`'s constructor reads no pages, so corruption does not
  //     surface here by itself; the first real query throws somewhere downstream, where it is caught
  //     into a fault and she carries on with every write failing. Asking sqlite directly, once, at
  //     the one moment when refusing to start is still cheap, is the difference between a recoverable
  //     morning and a day of her living without being saved.
  //
  // Refusing to start is recoverable. Starting on a database we cannot honestly read is not.
  {
    const at = schemaVersionOf(db);
    if (at > CODE_SCHEMA_VERSION) {
      db.close();
      throw new DatabaseIsNewerError(at, CODE_SCHEMA_VERSION);
    }
    const quick = (db.pragma("quick_check") as Array<{ quick_check: string }>)[0]?.quick_check ?? "no answer";
    if (quick !== "ok") {
      db.close();
      throw new DatabaseCorruptError(dbPath, quick);
    }
    diagnostics.push({ level: "info", message: `quick_check ok · schema v${at}`, source: "sqlite" });
  }

  // The DDL for memory_fts / pending_notifications / trajectories / episodic_critiques stood
  // here. Their writers left in an earlier cleanup: the empty search index, the
  // heartbeat's notification queue, the trajectory scoreboard and reflexion's critiques.
  // Existing rows in an older home are left untouched on disk; no new home mints the tables.

  db.exec(`
    CREATE TABLE IF NOT EXISTS stuck_candidates (
      pattern_hash TEXT PRIMARY KEY,
      tool_sequence TEXT NOT NULL,
      occurrences INTEGER NOT NULL DEFAULT 1,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      promoted INTEGER NOT NULL DEFAULT 0 CHECK(promoted IN (0, 1)),
      promoted_at INTEGER
    )
  `);
  diagnostics.push({ level: "info", message: "stuck_candidates table ensured", source: "sqlite" });
  db.exec(`
    CREATE TABLE IF NOT EXISTS stuck_candidate_occurrences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern_hash TEXT NOT NULL,
      seen_at INTEGER NOT NULL,
      FOREIGN KEY(pattern_hash) REFERENCES stuck_candidates(pattern_hash) ON DELETE CASCADE
    )
  `);
  diagnostics.push({ level: "info", message: "stuck_candidate_occurrences table ensured", source: "sqlite" });
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stuck_candidates_promotion ON stuck_candidates(promoted, occurrences, last_seen)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_stuck_candidate_occurrences_seen ON stuck_candidate_occurrences(pattern_hash, seen_at)`);

  // sqlite-vec loading left with the empty vector index (E-4).
  const hasVectorSupport = false;

  // ── MIGRATIONS, on top of the shape the block above just ensured ────────────────────────────
  //
  // The `CREATE TABLE IF NOT EXISTS` block above IS schema version 1: it is what both a fresh
  // database and every database that predates versioning already look like. Everything after that
  // is an ordered migration, applied here, each in its own transaction, each stamping its own
  // version. The caller snapshots first (`pendingMigrations` is exported so it can ask).
  {
    const pending = pendingMigrations(db);
    if (pending.length > 0 && options.beforeMigrate) {
      // A snapshot that fails must not stop her from starting, but it must be loud: it means the
      // next step changes her data with no way back to what it was a second ago.
      try {
        options.beforeMigrate(pending.map((m) => ({ version: m.version, name: m.name })), db);
      } catch (err) {
        diagnostics.push({
          level: "warning",
          message: `could not snapshot before migrating (${String(err)}) — migrating anyway, with no copy of the previous shape`,
          source: "sqlite",
        });
      }
    }
    const report = applyMigrations(db);
    if (report.applied.length > 0) {
      diagnostics.push({
        level: "info",
        message: `schema ${report.from} → ${report.to}: ${report.applied.map((m) => m.name).join(" · ")}`,
        source: "sqlite",
      });
    }
  }

  let writeCount = 0;

  const wrapper: DatabaseWrapper = {
    db,
    hasVectorSupport,

    writeWithRetry<T>(fn: () => T): T {
      const result = writeWithRetry(db, fn);
      writeCount++;
      if (writeCount % 50 === 0) {
        try {
          db.pragma("wal_checkpoint(PASSIVE)");
          log.debug({ writeCount }, "WAL checkpoint triggered");
        } catch (err) {
          log.warn({ err }, "WAL checkpoint failed");
        }
      }
      return result;
    },

    close(): void {
      try {
        db.pragma("wal_checkpoint(PASSIVE)");
      } catch {
        // best-effort on close
      }
      db.close();
      diagnostics.push({ level: "info", message: "database closed", source: "sqlite" });
    },
  };

  return { result: wrapper, diagnostics };
}
