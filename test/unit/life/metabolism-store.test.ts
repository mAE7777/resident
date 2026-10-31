import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, type DatabaseWrapper } from "../../../src/db/sqlite.js";
import { createMetabolismStore } from "../../../src/life/metabolism-store.js";
import { createMetabolism } from "../../../src/life/metabolism.js";

let root: string;
let db: DatabaseWrapper;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "metabolism-store-test-"));
  db = createDatabase(join(root, "test.db")).result;
});

afterEach(() => {
  try { db.close(); } catch { /* best-effort */ }
  rmSync(root, { recursive: true, force: true });
});

const DAY = Date.UTC(2026, 7, 7);

describe("metabolism store", () => {
  it("round-trips a day's effort so a restart does not hand her a free day", () => {
    const store = createMetabolismStore(db);
    store.save({ dayStartMs: DAY, spent: { work: 12.5, curiosity: 7 } });
    expect(store.load()).toEqual({ dayStartMs: DAY, spent: { work: 12.5, curiosity: 7 } });
  });

  it("returns null when nothing has been stored yet", () => {
    expect(createMetabolismStore(db).load()).toBeNull();
  });

  it("discards a ledger written in the OLD money unit instead of misreading it as effort", () => {
    // A row as it was written before her metabolism moved from money to effort: a bare map of
    // CENTS with no unit marker. Read as vigor it would be a huge false debit.
    db.db.exec(`
      CREATE TABLE IF NOT EXISTS metabolism_state (
        id INTEGER PRIMARY KEY CHECK (id = 1), day_start_ms INTEGER NOT NULL, spent_json TEXT NOT NULL)
    `);
    db.db.prepare("INSERT OR REPLACE INTO metabolism_state (id, day_start_ms, spent_json) VALUES (1, ?, ?)")
      .run(DAY, JSON.stringify({ work: 450, curiosity: 300 }));

    const store = createMetabolismStore(db);
    expect(store.load()).toBeNull(); // refused, not misread

    // And the consequence that matters: she boots rested on a full reserve, not falsely spent.
    const m = createMetabolism({ dailyVigor: 400, store, now: () => DAY + 3_600_000 });
    expect(m.spentTotal()).toBe(0);
    expect(m.phase()).toBe("rested");
  });

  it("survives a corrupted row by starting the day fresh", () => {
    db.db.exec(`
      CREATE TABLE IF NOT EXISTS metabolism_state (
        id INTEGER PRIMARY KEY CHECK (id = 1), day_start_ms INTEGER NOT NULL, spent_json TEXT NOT NULL)
    `);
    db.db.prepare("INSERT OR REPLACE INTO metabolism_state (id, day_start_ms, spent_json) VALUES (1, ?, ?)")
      .run(DAY, "{not json");
    expect(createMetabolismStore(db).load()).toBeNull();
  });

  it("keeps her mid-day spend across a real restart", () => {
    const now = () => DAY + 6 * 3_600_000;
    const first = createMetabolism({ dailyVigor: 400, store: createMetabolismStore(db), now });
    first.record("work", 100);
    first.record("curiosity", 60);

    const revived = createMetabolism({ dailyVigor: 400, store: createMetabolismStore(db), now });
    expect(revived.spentTotal()).toBeCloseTo(160, 5);
    expect(revived.phase()).toBe("normal"); // 60% left, exactly where she left off
  });
});
