import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "../../../src/db/sqlite.js";
import { createSessionManager } from "../../../src/memory/session.js";
import type { DatabaseWrapper } from "../../../src/db/sqlite.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "session-test-"));
}

function tempDbPath(dir: string): string {
  return join(dir, "test.db");
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

let root: string;
let sessionsDir: string;
let db: DatabaseWrapper;

beforeEach(() => {
  root = tempDir();
  sessionsDir = join(root, "sessions");
  db = createDatabase(tempDbPath(root)).result;
});

afterEach(() => {
  try { db.close(); } catch { /* best-effort */ }
  rmSync(root, { recursive: true, force: true });
});

// ── AC1: 5 messages → 5 lines in JSONL ────────────────────────────────────────

describe("AC1 — append creates JSONL with one line per entry", () => {
  it("5 appended messages produce 5 JSONL lines", () => {
    const mgr = createSessionManager(sessionsDir, db);
    const sessionId = "00000000-0000-0000-0000-000000000001";

    for (let i = 1; i <= 5; i++) {
      mgr.append(sessionId, { role: "user", content: `message ${i}` });
    }

    const filePath = mgr.sessionPath(sessionId);
    expect(existsSync(filePath)).toBe(true);

    const raw = readFileSync(filePath, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim() !== "");
    expect(lines).toHaveLength(5);
  });

  it("each line is valid self-contained JSON", () => {
    const mgr = createSessionManager(sessionsDir, db);
    const sessionId = "00000000-0000-0000-0000-000000000002";

    mgr.append(sessionId, { role: "user", content: "hello" });
    mgr.append(sessionId, { role: "assistant", content: "world" });

    const raw = readFileSync(mgr.sessionPath(sessionId), "utf8");
    const lines = raw.split("\n").filter((l) => l.trim() !== "");

    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("entries have monotonically increasing ids starting at 1", () => {
    const mgr = createSessionManager(sessionsDir, db);
    const sessionId = "00000000-0000-0000-0000-000000000003";

    const ids = [1, 2, 3].map(() =>
      mgr.append(sessionId, { role: "user", content: "x" })
    );
    expect(ids).toEqual([1, 2, 3]);
  });

  it("continues ids after manager restart", () => {
    const sessionId = "00000000-0000-0000-0000-000000000004";
    const first = createSessionManager(sessionsDir, db);
    first.append(sessionId, { role: "user", content: "before restart" });

    const second = createSessionManager(sessionsDir, db);
    const id = second.append(sessionId, { role: "assistant", content: "after restart" });

    expect(id).toBe(2);
  });

  it("sessions dir is created lazily on first append", () => {
    // sessionsDir does not exist yet
    expect(existsSync(sessionsDir)).toBe(false);
    const mgr = createSessionManager(sessionsDir, db);
    mgr.append("lazy-session", { role: "user", content: "first" });
    expect(existsSync(sessionsDir)).toBe(true);
  });
});

// ── AC2: independent cursors ───────────────────────────────────────────────────

describe("AC2 — consumer cursors are independent", () => {
  it("consolidator advancing cursor does not affect dream or search_indexer", () => {
    const mgr = createSessionManager(sessionsDir, db);
    const sessionId = "00000000-0000-0000-0000-000000000010";

    // Append 10 entries
    for (let i = 0; i < 10; i++) {
      mgr.append(sessionId, { role: "user", content: `entry ${i + 1}` });
    }

    // Consolidator reads and advances to position 10
    mgr.cursors.set("consolidator", 10);

    // dream and search_indexer should still be at 0
    expect(mgr.cursors.get("sentinel_ops")).toBe(0);
    expect(mgr.cursors.get("sentinel_conversation")).toBe(0);
  });

  it("all three cursors can be at different positions simultaneously", () => {
    const mgr = createSessionManager(sessionsDir, db);

    mgr.cursors.set("consolidator", 10);
    mgr.cursors.set("sentinel_ops", 5);
    mgr.cursors.set("sentinel_conversation", 3);

    expect(mgr.cursors.get("consolidator")).toBe(10);
    expect(mgr.cursors.get("sentinel_ops")).toBe(5);
    expect(mgr.cursors.get("sentinel_conversation")).toBe(3);
  });

  it("cursor persists across manager instances (SQLite backed)", () => {
    const mgr1 = createSessionManager(sessionsDir, db);
    mgr1.cursors.set("consolidator", 42);
    // second instance on same db
    const mgr2 = createSessionManager(sessionsDir, db);
    expect(mgr2.cursors.get("consolidator")).toBe(42);
  });
});

// ── AC3: checkpoint path convention ───────────────────────────────────────────

describe("AC3 — checkpoint path follows workspace/sessions/{id}.checkpoint.json", () => {
  it("checkpointPath returns correct path alongside JSONL file", () => {
    const mgr = createSessionManager(sessionsDir, db);
    const sessionId = "aaaabbbb-cccc-dddd-eeee-ffffaaaabbbb";

    const cpPath = mgr.checkpointPath(sessionId);
    const expectedPath = join(sessionsDir, `${sessionId}.checkpoint.json`);
    expect(cpPath).toBe(expectedPath);
  });
});

// ── AC4: readAfterCursor returns only entries with id > cursorPosition ─────────

describe("AC4 — readAfterCursor filters by id", () => {
  it("cursor at 5 returns only entries with id > 5", () => {
    const mgr = createSessionManager(sessionsDir, db);
    const sessionId = "00000000-0000-0000-0000-000000000020";

    for (let i = 1; i <= 8; i++) {
      mgr.append(sessionId, { role: "user", content: `msg ${i}` });
    }

    const entries = mgr.readAfterCursor(sessionId, 5);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.id)).toEqual([6, 7, 8]);
  });

  it("cursor at 0 returns all entries", () => {
    const mgr = createSessionManager(sessionsDir, db);
    const sessionId = "00000000-0000-0000-0000-000000000021";

    for (let i = 0; i < 5; i++) {
      mgr.append(sessionId, { role: "assistant", content: `resp ${i}` });
    }

    const entries = mgr.readAfterCursor(sessionId, 0);
    expect(entries).toHaveLength(5);
  });

  it("cursor past all entries returns empty array", () => {
    const mgr = createSessionManager(sessionsDir, db);
    const sessionId = "00000000-0000-0000-0000-000000000022";

    mgr.append(sessionId, { role: "user", content: "only one" });

    const entries = mgr.readAfterCursor(sessionId, 100);
    expect(entries).toHaveLength(0);
  });

  it("returns empty array for nonexistent session", () => {
    const mgr = createSessionManager(sessionsDir, db);
    const entries = mgr.readAfterCursor("nonexistent-session-id", 0);
    expect(entries).toHaveLength(0);
  });

  it("entries are returned in insertion order", () => {
    const mgr = createSessionManager(sessionsDir, db);
    const sessionId = "00000000-0000-0000-0000-000000000023";

    mgr.append(sessionId, { role: "user", content: "first" });
    mgr.append(sessionId, { role: "assistant", content: "second" });
    mgr.append(sessionId, { role: "user", content: "third" });

    const entries = mgr.readAfterCursor(sessionId, 0);
    expect(entries[0].content).toBe("first");
    expect(entries[1].content).toBe("second");
    expect(entries[2].content).toBe("third");
  });
});

// ── Optional fields ───────────────────────────────────────────────────────────

describe("optional fields — tool_calls and tool_results", () => {
  it("appends entry with tool_calls and tool_results", () => {
    const mgr = createSessionManager(sessionsDir, db);
    const sessionId = "00000000-0000-0000-0000-000000000030";

    mgr.append(sessionId, {
      role: "assistant",
      content: "calling tool",
      tool_calls: [{ callId: "c1", name: "read_file", args: { path: "/foo" } }],
    });

    mgr.append(sessionId, {
      role: "tool",
      content: "file contents",
      tool_results: [{ callId: "c1", name: "read_file", content: "file contents" }],
    });

    const entries = mgr.readAfterCursor(sessionId, 0);
    expect(entries[0].tool_calls).toBeDefined();
    expect(entries[0].tool_calls![0].callId).toBe("c1");
    expect(entries[1].tool_results).toBeDefined();
    expect(entries[1].tool_results![0].isError).toBeUndefined();
  });
});

// ── Cursor store: get defaults to 0 ──────────────────────────────────────────

describe("CursorStore defaults", () => {
  it("unset cursor returns 0", () => {
    const mgr = createSessionManager(sessionsDir, db);
    expect(mgr.cursors.get("consolidator")).toBe(0);
    expect(mgr.cursors.get("sentinel_ops")).toBe(0);
    expect(mgr.cursors.get("sentinel_conversation")).toBe(0);
  });
});
