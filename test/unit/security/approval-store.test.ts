import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createApprovalStore, type ApprovalStore } from "../../../src/security/approval-store.js";
import type { DatabaseWrapper } from "../../../src/db/sqlite.js";

// ---------------------------------------------------------------------------
// Test helper: in-memory DatabaseWrapper
// ---------------------------------------------------------------------------

function makeDb(): DatabaseWrapper {
  const db = new Database(":memory:");
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

// ---------------------------------------------------------------------------
// createApprovalStore: table creation
// ---------------------------------------------------------------------------

describe("createApprovalStore — table creation", () => {
  it("creates table on first call without error", () => {
    const dbw = makeDb();
    expect(() => createApprovalStore(dbw)).not.toThrow();
  });

  it("is idempotent — calling twice does not throw", () => {
    const dbw = makeDb();
    expect(() => {
      createApprovalStore(dbw);
      createApprovalStore(dbw);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// save() and loadAll()
// ---------------------------------------------------------------------------

describe("approval-store — save() and loadAll()", () => {
  let store: ApprovalStore;

  beforeEach(() => {
    store = createApprovalStore(makeDb());
  });

  it("saves an entry and loadAll() returns it", () => {
    store.save("bash", "git *", "allow");
    const entries = store.loadAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].toolName).toBe("bash");
    expect(entries[0].pattern).toBe("git *");
    expect(entries[0].decision).toBe("allow");
  });

  it("save() returns the stored entry with id and timestamps", () => {
    const before = Date.now();
    const entry = store.save("write", "/tmp/*", "allow");
    const after = Date.now();
    expect(entry.id).toBeGreaterThan(0);
    expect(entry.toolName).toBe("write");
    expect(entry.pattern).toBe("/tmp/*");
    expect(entry.decision).toBe("allow");
    expect(entry.createdAt).toBeGreaterThanOrEqual(before);
    expect(entry.createdAt).toBeLessThanOrEqual(after);
    expect(entry.expiresAt).toBeGreaterThan(entry.createdAt);
  });

  it("upserts by (tool_name, pattern) — updates decision on re-save", () => {
    store.save("bash", "git *", "allow");
    store.save("bash", "git *", "deny");
    const entries = store.loadAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].decision).toBe("deny");
  });

  it("multiple distinct entries are all returned", () => {
    store.save("bash", "git *", "allow");
    store.save("write", "/tmp/*", "allow");
    const entries = store.loadAll();
    expect(entries).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// check(), exact match
// ---------------------------------------------------------------------------

describe("approval-store — check() exact match", () => {
  let store: ApprovalStore;

  beforeEach(() => {
    store = createApprovalStore(makeDb());
  });

  it("AC: returns 'allow' for exact pattern match", () => {
    store.save("bash", "git status", "allow");
    expect(store.check("bash", "git status")).toBe("allow");
  });

  it("returns null for unknown tool", () => {
    store.save("bash", "git *", "allow");
    expect(store.check("write", "git status")).toBeNull();
  });

  it("returns null when no entries exist", () => {
    expect(store.check("bash", "git status")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// check(), glob matching with `*` wildcard
// ---------------------------------------------------------------------------

describe("approval-store — check() glob matching", () => {
  let store: ApprovalStore;

  beforeEach(() => {
    store = createApprovalStore(makeDb());
  });

  it("AC: 'git *' matches 'git status'", () => {
    store.save("bash", "git *", "allow");
    expect(store.check("bash", "git status")).toBe("allow");
  });

  it("'git *' matches 'git commit -m msg'", () => {
    store.save("bash", "git *", "allow");
    expect(store.check("bash", "git commit -m msg")).toBe("allow");
  });

  it("AC: '/tmp/*' matches '/tmp/test.txt' (write tool)", () => {
    store.save("write", "/tmp/*", "allow");
    expect(store.check("write", "/tmp/test.txt")).toBe("allow");
  });

  it("'/tmp/*' matches '/tmp/subdir/file.txt'", () => {
    store.save("write", "/tmp/*", "allow");
    expect(store.check("write", "/tmp/subdir/file.txt")).toBe("allow");
  });

  it("'/tmp/*' does NOT match '/var/tmp/file.txt'", () => {
    store.save("write", "/tmp/*", "allow");
    expect(store.check("write", "/var/tmp/file.txt")).toBeNull();
  });

  it("pattern without wildcard matches exact string only", () => {
    store.save("bash", "git status", "allow");
    expect(store.check("bash", "git status")).toBe("allow");
    expect(store.check("bash", "git status extra")).toBeNull();
  });

  it("'*' wildcard matches any string", () => {
    store.save("bash", "*", "allow");
    expect(store.check("bash", "anything here")).toBe("allow");
  });

  it("trailing wildcard 'git*' matches 'gitblah'", () => {
    store.save("bash", "git*", "allow");
    expect(store.check("bash", "gitblah")).toBe("allow");
  });

  it("leading wildcard '*status' matches 'git status'", () => {
    store.save("bash", "*status", "allow");
    expect(store.check("bash", "git status")).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
// check(), expired approvals are ignored (HIGH sensitivity AC)
// ---------------------------------------------------------------------------

describe("approval-store — check() expired approvals (HIGH sensitivity)", () => {
  it("AC: expired approval is ignored and null is returned", () => {
    const dbw = makeDb();
    const store = createApprovalStore(dbw);
    // Save with a TTL in the past (already expired)
    store.save("bash", "git *", "allow", -1000);
    const result = store.check("bash", "git status");
    expect(result).toBeNull();
  });

  it("non-expired approval is still honored", () => {
    const store = createApprovalStore(makeDb());
    store.save("bash", "git *", "allow", 60_000); // 1 minute TTL
    expect(store.check("bash", "git status")).toBe("allow");
  });

  it("expired entry is removed from the table after check()", () => {
    const dbw = makeDb();
    const store = createApprovalStore(dbw);
    store.save("bash", "git *", "allow", -1000);
    store.check("bash", "git status"); // triggers prune
    expect(store.loadAll()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// remove(), HIGH sensitivity AC
// ---------------------------------------------------------------------------

describe("approval-store — remove()", () => {
  it("AC: removing an approval causes subsequent check() to return null", () => {
    const store = createApprovalStore(makeDb());
    const entry = store.save("bash", "git *", "allow");
    expect(store.check("bash", "git status")).toBe("allow");
    store.remove(entry.id);
    expect(store.check("bash", "git status")).toBeNull();
  });

  it("remove() on non-existent id does not throw", () => {
    const store = createApprovalStore(makeDb());
    expect(() => store.remove(9999)).not.toThrow();
  });

  it("removing one entry does not affect others", () => {
    const store = createApprovalStore(makeDb());
    const a = store.save("bash", "git *", "allow");
    store.save("write", "/tmp/*", "allow");
    store.remove(a.id);
    expect(store.check("bash", "git status")).toBeNull();
    expect(store.check("write", "/tmp/test.txt")).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
// pruneExpired(), explicit prune
// ---------------------------------------------------------------------------

describe("approval-store — pruneExpired()", () => {
  it("removes expired entries", () => {
    const store = createApprovalStore(makeDb());
    store.save("bash", "old *", "allow", -1000);
    store.save("bash", "new *", "allow", 60_000);
    store.pruneExpired();
    const entries = store.loadAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].pattern).toBe("new *");
  });

  it("does not remove valid entries", () => {
    const store = createApprovalStore(makeDb());
    store.save("bash", "git *", "allow", 60_000);
    store.pruneExpired();
    expect(store.loadAll()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// shouldAutoApproveWithStore(), zones integration
// ---------------------------------------------------------------------------

describe("approval-store — persistence across instances", () => {
  it("AC: approval saved by one store instance is visible from a new instance on the same DB", () => {
    const dbw = makeDb();
    const store1 = createApprovalStore(dbw);
    store1.save("bash", "git *", "allow");

    // Simulate process restart by creating a new store on same underlying DB
    const store2 = createApprovalStore(dbw);
    expect(store2.check("bash", "git status")).toBe("allow");
  });
});
