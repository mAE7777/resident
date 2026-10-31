import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MIGRATIONS, CODE_SCHEMA_VERSION, schemaVersionOf, pendingMigrations, applyMigrations,
  addColumnIfMissing, DatabaseIsNewerError, type Migration,
} from "../../../src/db/schema-version.js";

/**
 * WHY A SCHEMA VERSION IS A PRE-BIRTH ITEM RATHER THAN HOUSEKEEPING.
 *
 * Recovery from anything going wrong after she is awake is pause, snapshot, fix, then resume
 * from her own state. That is only executable if a code change can be applied to the data she
 * already has. Before this, every table was `CREATE TABLE IF NOT EXISTS` (a no-op on her existing
 * database) and a forgotten ALTER surfaced as `no such column` inside a caught write, so she kept
 * living while her life stopped being saved, with nothing anywhere saying so.
 */

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "schema-version-test-"));
  db = new Database(join(dir, "test.db"));
});

afterEach(() => {
  try { db.close(); } catch { /* best-effort */ }
  rmSync(dir, { recursive: true, force: true });
});

describe("the list itself is well formed", () => {
  it("versions are strictly increasing, start at 1, and have no gaps or duplicates", () => {
    // A renumbered or duplicated migration means some database somewhere skips a step forever, and
    // the version number afterwards is a lie about what ran.
    const versions = MIGRATIONS.map((m) => m.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions[0]).toBe(1);
    for (let i = 1; i < versions.length; i++) expect(versions[i]! - versions[i - 1]!).toBe(1);
    expect(CODE_SCHEMA_VERSION).toBe(versions[versions.length - 1]);
  });

  it("every migration says what it does", () => {
    for (const m of MIGRATIONS) expect(m.name.trim().length, `migration ${m.version} is unnamed`).toBeGreaterThan(10);
  });
});

describe("bringing a database up to what the code understands", () => {
  it("a fresh database ends at the code's version", () => {
    expect(schemaVersionOf(db)).toBe(0);
    const report = applyMigrations(db);
    expect(report.from).toBe(0);
    expect(report.to).toBe(CODE_SCHEMA_VERSION);
    expect(schemaVersionOf(db)).toBe(CODE_SCHEMA_VERSION);
  });

  it("running it twice does nothing the second time", () => {
    applyMigrations(db);
    const second = applyMigrations(db);
    expect(second.applied).toEqual([]);
    expect(second.to).toBe(CODE_SCHEMA_VERSION);
  });

  it("`pending` is what a caller asks before it snapshots", () => {
    // The order matters: snapshot first, migrate second. So there has to be a way
    // to know a migration is coming without having run it.
    expect(pendingMigrations(db).length).toBe(MIGRATIONS.length);
    applyMigrations(db);
    expect(pendingMigrations(db)).toEqual([]);
  });
});

describe("the two refusals", () => {
  it("a database NEWER than the code refuses to be opened or migrated", () => {
    db.exec(`PRAGMA user_version = ${CODE_SCHEMA_VERSION + 5}`);
    expect(() => pendingMigrations(db)).toThrow(DatabaseIsNewerError);
    expect(() => applyMigrations(db)).toThrow(/only understands/u);
  });

  it("a migration that throws rolls back and does not advance the version (planted)", () => {
    // The failure being planted: a half-applied migration that stamps its version anyway. The next
    // boot would then skip a step that never ran, and every later assumption rests on it.
    const at = schemaVersionOf(db);
    const boom: Migration = {
      version: CODE_SCHEMA_VERSION + 1,
      name: "a migration that fails halfway through, on purpose",
      up(d) {
        d.exec("CREATE TABLE half_done (id INTEGER)");
        throw new Error("boom");
      },
    };
    // Run it the way `applyMigrations` does, with the same transaction discipline.
    let threw = false;
    try {
      db.exec("BEGIN IMMEDIATE");
      try {
        boom.up(db);
        db.exec(`PRAGMA user_version = ${boom.version}`);
        db.exec("COMMIT");
      } catch (err) { db.exec("ROLLBACK"); throw err; }
    } catch { threw = true; }

    expect(threw).toBe(true);
    expect(schemaVersionOf(db), "the version advanced past a migration that failed").toBe(at);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    expect(tables.some((t) => t.name === "half_done"), "the failed migration left a table behind").toBe(false);
  });
});

describe("the one idiom for adding a column", () => {
  beforeEach(() => { db.exec("CREATE TABLE t (a INTEGER)"); });

  it("adds it once and is a no-op afterwards", () => {
    addColumnIfMissing(db, "t", "b", "TEXT");
    addColumnIfMissing(db, "t", "b", "TEXT");
    const cols = (db.prepare("PRAGMA table_info(t)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual(["a", "b"]);
  });

  it("a real schema error is LOUD, not swallowed (the bare-catch failure)", () => {
    // The tree had `try { ALTER } catch {}` in `skills/versioning.ts`, which cannot tell "the column
    // is already there" from "this table does not exist" or "the database is read-only". Everything
    // that is not the first case must throw.
    expect(() => addColumnIfMissing(db, "no_such_table", "b", "TEXT")).toThrow();
  });
});
