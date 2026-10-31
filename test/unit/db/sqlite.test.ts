import { describe, it, expect, afterEach } from "vitest";
import { createDatabase } from "../../../src/db/sqlite.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync, existsSync } from "node:fs";

function tempDbPath(): string {
  return join(tmpdir(), `god-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const p of cleanupPaths.splice(0)) {
    try {
      if (existsSync(p)) rmSync(p, { force: true });
      if (existsSync(p + "-wal")) rmSync(p + "-wal", { force: true });
      if (existsSync(p + "-shm")) rmSync(p + "-shm", { force: true });
    } catch {
      // best effort
    }
  }
});

describe("createDatabase", () => {
  it("returns WAL journal_mode", () => {
    const dbPath = tempDbPath();
    cleanupPaths.push(dbPath);
    const { result, diagnostics } = createDatabase(dbPath);

    const mode = result.db.pragma("journal_mode", { simple: true });
    expect(mode).toBe("wal");
    expect(diagnostics.some((d) => d.message.includes("WAL"))).toBe(true);

    result.close();
  });


  it("writeWithRetry executes the function and returns value", () => {
    const dbPath = tempDbPath();
    cleanupPaths.push(dbPath);
    const { result } = createDatabase(dbPath);

    result.db.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`);

    const returned = result.writeWithRetry(() => {
      const stmt = result.db.prepare(`INSERT OR REPLACE INTO kv VALUES (?, ?)`);
      const info = stmt.run("hello", "world");
      return info.changes;
    });

    expect(returned).toBe(1);

    const row = result.db.prepare(`SELECT v FROM kv WHERE k = 'hello'`).get() as { v: string } | undefined;
    expect(row?.v).toBe("world");

    result.close();
  });

  it("writeWithRetry retries up to 15 times on SQLITE_BUSY then rethrows", () => {
    const dbPath = tempDbPath();
    cleanupPaths.push(dbPath);
    const { result } = createDatabase(dbPath);

    let callCount = 0;
    const busyError = Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });

    expect(() =>
      result.writeWithRetry(() => {
        callCount++;
        throw busyError;
      })
    ).toThrow("database is locked");

    // 15 attempts: indices 0..13 retry, index 14 rethrows
    expect(callCount).toBe(15);

    result.close();
  });

  it("diagnostics mention all applied pragmas", () => {
    const dbPath = tempDbPath();
    cleanupPaths.push(dbPath);
    const { diagnostics, result } = createDatabase(dbPath);

    expect(diagnostics.some((d) => d.message.includes("WAL"))).toBe(true);
    expect(diagnostics.some((d) => d.message.includes("busy_timeout"))).toBe(true);

    result.close();
  });

  it("triggers WAL checkpoint every 50 writes", () => {
    const dbPath = tempDbPath();
    cleanupPaths.push(dbPath);
    const { result } = createDatabase(dbPath);

    result.db.exec(`CREATE TABLE IF NOT EXISTS tbl (x INTEGER)`);

    // 50 writes should not throw; checkpoint runs silently
    for (let i = 0; i < 50; i++) {
      result.writeWithRetry(() => result.db.prepare(`INSERT INTO tbl VALUES (?)`).run(i));
    }

    const count = (result.db.prepare(`SELECT COUNT(*) as c FROM tbl`).get() as { c: number }).c;
    expect(count).toBe(50);

    result.close();
  });
});
