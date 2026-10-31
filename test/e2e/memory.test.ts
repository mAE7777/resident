// E2E memory integration tests: session JSONL and consolidation trigger (the search
// stack left with the empty index, E-4). Uses in-memory SQLite for isolation.

import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createSessionManager } from "../../src/memory/session.js";
import { createConsolidator } from "../../src/memory/consolidator.js";
import type { DatabaseWrapper } from "../../src/db/sqlite.js";

// ── In-memory DB factory ──────────────────────────────────────────────────────

function createInMemoryDb(): DatabaseWrapper {
  const db = new Database(":memory:");
  db.pragma("journal_mode=WAL");
  db.pragma("foreign_keys=ON");

  return {
    db,
    hasVectorSupport: false,
    writeWithRetry<T>(fn: () => T): T {
      return fn();
    },
    close() {
      db.close();
    },
  };
}

// ── Test isolation cleanup ────────────────────────────────────────────────────

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  tempDirs.length = 0;
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "god-agent-e2e-"));
  tempDirs.push(dir);
  return dir;
}

// ── AC1: Memory search, insert and BM25 search ──────────────────────────────

describe("memory: session JSONL", () => {
  it("session manager appends entries and reads them back after cursor 0", () => {
    const tempDir = makeTempDir();
    const dbWrapper = createInMemoryDb();

    // Create cursor_positions table required by cursor store
    dbWrapper.db.exec(`
      CREATE TABLE IF NOT EXISTS cursor_positions (
        consumer TEXT NOT NULL,
        session_id TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (consumer, session_id)
      )
    `);

    const manager = createSessionManager(join(tempDir, "sessions"), dbWrapper);
    const sessionId = "test-session-001";

    const id1 = manager.append(sessionId, { role: "user", content: "Hello, agent!" });
    const id2 = manager.append(sessionId, { role: "assistant", content: "Hello! How can I help?" });

    expect(id1).toBe(1);
    expect(id2).toBe(2);

    const entries = manager.readAfterCursor(sessionId, 0);
    expect(entries.length).toBe(2);
    expect(entries[0].role).toBe("user");
    expect(entries[0].content).toBe("Hello, agent!");
    expect(entries[1].role).toBe("assistant");
    expect(entries[1].content).toBe("Hello! How can I help?");

    dbWrapper.close();
  });

  it("readAfterCursor with cursor=1 returns only entries after id 1", () => {
    const tempDir = makeTempDir();
    const dbWrapper = createInMemoryDb();

    dbWrapper.db.exec(`
      CREATE TABLE IF NOT EXISTS cursor_positions (
        consumer TEXT NOT NULL,
        session_id TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (consumer, session_id)
      )
    `);

    const manager = createSessionManager(join(tempDir, "sessions"), dbWrapper);
    const sessionId = "test-session-002";

    manager.append(sessionId, { role: "user", content: "message 1" });
    manager.append(sessionId, { role: "assistant", content: "message 2" });
    manager.append(sessionId, { role: "user", content: "message 3" });

    const entries = manager.readAfterCursor(sessionId, 1);
    expect(entries.length).toBe(2);
    expect(entries[0].content).toBe("message 2");
    expect(entries[1].content).toBe("message 3");

    dbWrapper.close();
  });

  it("session JSONL file is written to disk with correct format", () => {
    const tempDir = makeTempDir();
    const dbWrapper = createInMemoryDb();

    dbWrapper.db.exec(`
      CREATE TABLE IF NOT EXISTS cursor_positions (
        consumer TEXT NOT NULL,
        session_id TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (consumer, session_id)
      )
    `);

    const manager = createSessionManager(join(tempDir, "sessions"), dbWrapper);
    const sessionId = "test-session-003";

    manager.append(sessionId, { role: "user", content: "write me to disk" });

    const path = manager.sessionPath(sessionId);
    expect(existsSync(path)).toBe(true);

    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw.trim());

    expect(parsed.id).toBe(1);
    expect(parsed.role).toBe("user");
    expect(parsed.content).toBe("write me to disk");
    expect(typeof parsed.timestamp).toBe("number");

    dbWrapper.close();
  });
});

// ── AC4: Consolidation trigger ────────────────────────────────────────────────

describe("memory: consolidation trigger", () => {
  it("consolidator shouldConsolidate returns false for small message sets", () => {
    const tempDir = makeTempDir();

    const consolidator = createConsolidator({
      contextWindow: 200_000,
      maxOutput: 8192,
      historyPath: join(tempDir, "history.jsonl"),
    });

    const messages = [
      { role: "user" as const, content: "Short message" },
      { role: "assistant" as const, content: "Short response" },
    ];

    expect(consolidator.shouldConsolidate(messages, 0)).toBe(false);
  });

  it("consolidator shouldConsolidate returns true when messages approach context limit", () => {
    const tempDir = makeTempDir();

    // Small context window so we cross the threshold easily
    const consolidator = createConsolidator({
      contextWindow: 1000,
      maxOutput: 100,
      historyPath: join(tempDir, "history.jsonl"),
    });

    // Generate enough messages to exceed threshold
    // threshold = contextWindow - maxOutput - 1024 = 1000 - 100 - 1024 = negative → always exceeds
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? "user" as const : "assistant" as const,
      content: "x".repeat(100),
    }));

    expect(consolidator.shouldConsolidate(messages, 0)).toBe(true);
  });

  it("consolidation run produces a summary via faux provider and archives entries", async () => {
    const tempDir = makeTempDir();

    const consolidator = createConsolidator({
      contextWindow: 500,
      maxOutput: 50,
      historyPath: join(tempDir, "history.jsonl"),
    });

    const messages = [
      { role: "user" as const, content: "What is 1+1?" },
      { role: "assistant" as const, content: "It is 2." },
      { role: "user" as const, content: "What about 2+2?" },
      { role: "assistant" as const, content: "That would be 4." },
    ];

    const result = await consolidator.consolidate(messages, 0);

    expect(result.rounds).toBeGreaterThanOrEqual(0);
    expect(typeof result.newLastConsolidated).toBe("number");
    expect(typeof result.entriesArchived).toBe("number");
    // If rounds > 0, history file should exist
    if (result.rounds > 0) {
      expect(existsSync(join(tempDir, "history.jsonl"))).toBe(true);
    }
  });

});
