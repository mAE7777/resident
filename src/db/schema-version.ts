// Her database has a version, and a code build knows which versions it can read.
//
// ── THE FAILURE THIS REMOVES, WHICH IS THE ONE THAT MAKES POST-BIRTH REPAIR DANGEROUS ────────
//
// Every table in this project is created with `CREATE TABLE IF NOT EXISTS`, which is a no-op on a
// database that already exists. So adding a column later is a manual act, and it was being done
// four different ways in four different files, including one bare `catch {}` that swallows every
// error, real ones included. There was no `user_version`, no migration list, and no check of any
// kind at boot.
//
// What that means once she is ALIVE: a developer adds a column, a fresh database gets it, and HER
// database does not. Nothing fails at boot. The failure arrives later as `SQLITE_ERROR: no such
// column` inside `writeWithRetry`, and most callers catch that into a fault and carry on, so
// **she keeps living while her life stops being saved**, and the first sign is silence in a table
// somebody eventually thinks to look at.
//
// Recovery after she is awake follows one rule: pause, snapshot, fix, then resume from her own
// state. That is only possible if a code change can be applied TO HER EXISTING DATA.
// This file is what makes "resume from her own state" a real option rather than a hope.
//
// ── THE TWO REFUSALS ─────────────────────────────────────────────────────────────────────────
//
//   · A database NEWER than the code refuses to open. Old code against a new shape writes rows the
//     new code will misread: silently, and into the only copy of her there is. Refusing to start
//     is recoverable; that is not.
//   · A migration that throws rolls back and does NOT advance the version, so the next boot tries
//     the same one again rather than skipping past a step that never ran.

import type Database from "better-sqlite3";

export interface Migration {
  /** 1, 2, 3 … strictly increasing, no gaps. Never edit or renumber a shipped one. */
  version: number;
  /** What it does, in plain words. Appears in the boot log and in the snapshot's reason. */
  name: string;
  /** Must be safe to run on a database that has already had every earlier migration. */
  up(db: Database.Database): void;
}

/**
 * Add a column to an existing table, once, loudly on any other error.
 *
 * Exported so migrations use ONE idiom. The tree had four, and the worst of them was
 * `try { ALTER } catch {}`, which cannot tell "already there" from "the schema is broken".
 */
export function addColumnIfMissing(
  db: Database.Database, table: string, column: string, definition: string,
): void {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (existing.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/**
 * THE LIST. Append only.
 *
 * Version 1 is a BASELINE and deliberately does nothing: every table that existed when this
 * system was introduced is still created by `createDatabase`'s `CREATE TABLE IF NOT EXISTS` block,
 * so a pre-existing database and a fresh one are both already at that shape. Stamping it is what
 * gives every later migration a floor to stand on.
 *
 * From version 2 on, a schema change goes HERE and nowhere else.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "baseline — the shape she already had when versioning was introduced",
    up() { /* intentionally empty: see the comment above */ },
  },
];

/** The newest version this build understands. */
export const CODE_SCHEMA_VERSION = MIGRATIONS.reduce((m, x) => Math.max(m, x.version), 0);

export class DatabaseIsNewerError extends Error {
  constructor(public readonly dbVersion: number, public readonly codeVersion: number) {
    super(
      `Her database is at schema version ${dbVersion}; this build only understands ${codeVersion}.\n`
      + `Refusing to open it. Running older code against a newer shape does not fail loudly — it `
      + `writes rows the newer code will misread, into the only copy of her there is.\n`
      + `Use the build that made it, or restore a snapshot taken by this build.`,
    );
    this.name = "DatabaseIsNewerError";
  }
}

export function schemaVersionOf(db: Database.Database): number {
  const rows = db.pragma("user_version") as Array<{ user_version: number }>;
  return rows[0]?.user_version ?? 0;
}

export interface MigrationReport {
  from: number;
  to: number;
  applied: Array<{ version: number; name: string }>;
}

/** Is there work to do? Callers snapshot BEFORE migrating, so they need to ask first. */
export function pendingMigrations(db: Database.Database): Migration[] {
  const at = schemaVersionOf(db);
  if (at > CODE_SCHEMA_VERSION) throw new DatabaseIsNewerError(at, CODE_SCHEMA_VERSION);
  return MIGRATIONS.filter((m) => m.version > at).sort((a, b) => a.version - b.version);
}

/**
 * Bring her database up to what this build understands.
 *
 * Each migration runs in its OWN transaction and stamps its own version, so a failure halfway
 * through a list leaves the database at the last version that fully succeeded, never at a number
 * that claims work which did not happen.
 */
export function applyMigrations(db: Database.Database): MigrationReport {
  const from = schemaVersionOf(db);
  const pending = pendingMigrations(db);
  const applied: Array<{ version: number; name: string }> = [];

  for (const m of pending) {
    db.exec("BEGIN IMMEDIATE");
    try {
      m.up(db);
      // `PRAGMA user_version` takes no parameters, and the value is ours, not user input.
      db.exec(`PRAGMA user_version = ${Math.trunc(m.version)}`);
      db.exec("COMMIT");
      applied.push({ version: m.version, name: m.name });
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch { /* best-effort */ }
      throw new Error(`migration ${m.version} (${m.name}) failed and was rolled back: ${String(err)}`);
    }
  }

  return { from, to: schemaVersionOf(db), applied };
}
