import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFileSnapshotStore, createUndoTool } from "../../../src/tools/builtin/file-snapshot.js";

const TEST_DIR = join(tmpdir(), `snapshot-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  try { rmSync(TEST_DIR, { recursive: true }); } catch { /* cleanup */ }
});

// ── Snapshot + Undo Lifecycle ───────────────────────────────────────────────

describe("file snapshot store — basic lifecycle", () => {
  it("snapshot before write, undo restores original content", () => {
    const store = createFileSnapshotStore();
    const file = join(TEST_DIR, "test.txt");

    writeFileSync(file, "original content");
    store.snapshot(file, "write");
    writeFileSync(file, "new content");

    expect(readFileSync(file, "utf8")).toBe("new content");

    const result = store.undoFile(file);
    expect(result).toContain("restored");
    expect(readFileSync(file, "utf8")).toBe("original content");
  });

  it("snapshot before creating a new file, undo deletes it", () => {
    const store = createFileSnapshotStore();
    const file = join(TEST_DIR, "new.txt");

    store.snapshot(file, "write"); // file doesn't exist yet
    writeFileSync(file, "created by agent");

    expect(existsSync(file)).toBe(true);

    const result = store.undoFile(file);
    expect(result).toContain("deleted");
    expect(existsSync(file)).toBe(false);
  });

  it("snapshot before delete, undo restores the file", () => {
    const store = createFileSnapshotStore();
    const file = join(TEST_DIR, "todelete.txt");

    writeFileSync(file, "important data");
    store.snapshot(file, "delete");
    rmSync(file);

    expect(existsSync(file)).toBe(false);

    const result = store.undoFile(file);
    expect(result).toContain("restored");
    expect(readFileSync(file, "utf8")).toBe("important data");
  });

  it("undoLast undoes the most recent snapshot", () => {
    const store = createFileSnapshotStore();
    const file1 = join(TEST_DIR, "a.txt");
    const file2 = join(TEST_DIR, "b.txt");

    writeFileSync(file1, "a-original");
    writeFileSync(file2, "b-original");

    store.snapshot(file1, "edit");
    writeFileSync(file1, "a-modified");

    store.snapshot(file2, "edit");
    writeFileSync(file2, "b-modified");

    // undoLast should undo file2 (most recent)
    store.undoLast();
    expect(readFileSync(file2, "utf8")).toBe("b-original");
    expect(readFileSync(file1, "utf8")).toBe("a-modified"); // file1 NOT undone yet
  });
});

// ── Edge Cases ──────────────────────────────────────────────────────────────

describe("file snapshot store — edge cases", () => {
  it("undo with no snapshots returns helpful message", () => {
    const store = createFileSnapshotStore();
    expect(store.undoLast()).toContain("Nothing to undo");
  });

  it("undoFile for unknown path returns helpful message", () => {
    const store = createFileSnapshotStore();
    expect(store.undoFile("/nonexistent")).toContain("No snapshot found");
  });

  it("snapshot consumes used entries", () => {
    const store = createFileSnapshotStore();
    const file = join(TEST_DIR, "x.txt");

    writeFileSync(file, "v1");
    store.snapshot(file, "write");
    writeFileSync(file, "v2");

    store.undoFile(file);
    expect(readFileSync(file, "utf8")).toBe("v1");

    // Second undo should have nothing left
    expect(store.undoFile(file)).toContain("No snapshot found");
  });

  it("respects 50-snapshot budget", () => {
    const store = createFileSnapshotStore();
    for (let i = 0; i < 60; i++) {
      const file = join(TEST_DIR, `file-${i}.txt`);
      writeFileSync(file, `content-${i}`);
      store.snapshot(file, "write");
    }
    expect(store.count).toBe(50);
  });

  it("stores binary files correctly", () => {
    const store = createFileSnapshotStore();
    const file = join(TEST_DIR, "binary.dat");

    const original = Buffer.from([0x00, 0xff, 0x42, 0x89]);
    writeFileSync(file, original);
    store.snapshot(file, "write");
    writeFileSync(file, Buffer.from([0x01, 0x02]));

    store.undoFile(file);
    expect(readFileSync(file)).toEqual(original);
  });
});

// ── List ────────────────────────────────────────────────────────────────────

describe("file snapshot store — list", () => {
  it("lists snapshots in reverse chronological order", () => {
    const store = createFileSnapshotStore();
    const file1 = join(TEST_DIR, "first.txt");
    const file2 = join(TEST_DIR, "second.txt");

    writeFileSync(file1, "a");
    writeFileSync(file2, "b");

    store.snapshot(file1, "write");
    store.snapshot(file2, "edit");

    const listed = store.list();
    expect(listed).toHaveLength(2);
    expect(listed[0].path).toBe(file2); // most recent first
    expect(listed[1].path).toBe(file1);
  });
});

// ── Undo Tool ───────────────────────────────────────────────────────────────

describe("undo tool", () => {
  it("undo_last restores most recent file modification", async () => {
    const store = createFileSnapshotStore();
    const tool = createUndoTool(store);
    const file = join(TEST_DIR, "tooltest.txt");

    writeFileSync(file, "before");
    store.snapshot(file, "write");
    writeFileSync(file, "after");

    const result = await tool.execute({ action: "undo_last" });
    expect(result).toContain("restored");
    expect(readFileSync(file, "utf8")).toBe("before");
  });

  it("list shows recent modifications", async () => {
    const store = createFileSnapshotStore();
    const tool = createUndoTool(store);
    const file = join(TEST_DIR, "listed.txt");

    writeFileSync(file, "content");
    store.snapshot(file, "edit");

    const result = await tool.execute({ action: "list" });
    expect(result).toContain("listed.txt");
    expect(result).toContain("edit");
    expect(result).toContain("1 snapshot(s)");
  });

  it("undo_file requires path", async () => {
    const store = createFileSnapshotStore();
    const tool = createUndoTool(store);
    const result = await tool.execute({ action: "undo_file" });
    expect(result).toContain("Error: path is required");
  });
});

// ── Wiring Verification ────────────────────────────────────────────────────

describe("file snapshots wired in bootstrap", () => {
  it("bootstrap.ts creates FileSnapshotStore and passes to write/edit/delete", () => {
    const { readFileSync: rfs } = require("node:fs");
    const { join: j } = require("node:path");
    const content = rfs(j(process.cwd(), "src", "telegram", "bootstrap.ts"), "utf8");
    expect(content).toContain("createFileSnapshotStore");
    expect(content).toContain("fileSnapshots");
    expect(content).toContain("createUndoTool(fileSnapshots,");
  });

  it("write.ts calls snapshotStore.snapshot before writing", () => {
    const { readFileSync: rfs } = require("node:fs");
    const { join: j } = require("node:path");
    const content = rfs(j(process.cwd(), "src", "tools", "builtin", "write.ts"), "utf8");
    expect(content).toContain("snapshotStore.snapshot");
  });

  it("edit.ts calls snapshotStore.snapshot before editing", () => {
    const { readFileSync: rfs } = require("node:fs");
    const { join: j } = require("node:path");
    const content = rfs(j(process.cwd(), "src", "tools", "builtin", "edit.ts"), "utf8");
    expect(content).toContain("snapshotStore.snapshot");
  });

  it("delete.ts calls snapshotStore.snapshot before deleting", () => {
    const { readFileSync: rfs } = require("node:fs");
    const { join: j } = require("node:path");
    const content = rfs(j(process.cwd(), "src", "tools", "builtin", "delete.ts"), "utf8");
    expect(content).toContain("snapshotStore.snapshot");
  });

  it("undo is in BUILTIN_TOOLS set", () => {
    const { readFileSync: rfs } = require("node:fs");
    const { join: j } = require("node:path");
    const content = rfs(j(process.cwd(), "src", "telegram", "bootstrap.ts"), "utf8");
    expect(content).toContain('"undo"');
  });
});
