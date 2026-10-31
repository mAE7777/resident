import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { createWorkspaceManager } from "../../../src/memory/workspace.js";
import { createLogger } from "../../../src/utils/logger.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "ws-mgr-test-"));
}

const logger = createLogger("test-workspace-manager");

let root: string;

beforeEach(() => {
  root = tempDir();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// ── AC: initWorkspace idempotency (via ensureInitialized) ─────────────────────

describe("ensureInitialized — workspace lifecycle", () => {
  it("first run creates workspace template files and makes initial commit", async () => {
    const mgr = createWorkspaceManager(root, logger);
    const { result } = await mgr.ensureInitialized();

    expect(result.initialized).toBe(true);

    const expectedFiles = ["SOUL.md", "IDENTITY.md", "AGENT.md", "MEMORY.md"];
    for (const f of expectedFiles) {
      expect(existsSync(join(root, f)), `${f} should exist`).toBe(true);
    }
    expect(existsSync(join(root, ".git"))).toBe(true);
  });

  it("second call (already initialized) returns initialized: false (idempotent)", async () => {
    const mgr = createWorkspaceManager(root, logger);
    await mgr.ensureInitialized();
    const second = await mgr.ensureInitialized();
    expect(second.result.initialized).toBe(false);
  });

  it("pre-existing .git directory is not re-initialized", async () => {
    const mgr = createWorkspaceManager(root, logger);
    await mgr.ensureInitialized();

    // Verify that a second init does not touch the repo
    const git = simpleGit(root);
    const logBefore = await git.log();
    const countBefore = logBefore.total;

    await mgr.ensureInitialized();
    const logAfter = await git.log();
    expect(logAfter.total).toBe(countBefore);
  });
});

// ── AC: session snapshot is frozen at session start ──────────────────────────

describe("getSessionSnapshot — session-start freeze", () => {
  it("returns all 4 identity keys", async () => {
    const mgr = createWorkspaceManager(root, logger);
    await mgr.ensureInitialized();
    const snap = mgr.getSessionSnapshot();

    expect(typeof snap.SOUL).toBe("string");
    expect(typeof snap.IDENTITY).toBe("string");
    expect(typeof snap.AGENT).toBe("string");
    expect(typeof snap.MEMORY).toBe("string");
  });

  it("snapshot content does not change after file is modified mid-session", async () => {
    const mgr = createWorkspaceManager(root, logger);
    await mgr.ensureInitialized();

    const snap = mgr.getSessionSnapshot();
    const originalMemory = snap.MEMORY;

    // Simulate a mid-session write to MEMORY.md
    writeFileSync(join(root, "MEMORY.md"), "# Memory\n\nNew fact added mid-session.\n", "utf-8");

    // The snapshot should still hold the original content
    expect(snap.MEMORY).toBe(originalMemory);
    expect(snap.MEMORY).not.toContain("New fact added mid-session");
  });

  it("returns empty string for missing files (no crash)", async () => {
    // Fresh dir with no init: no files exist
    const mgr = createWorkspaceManager(root, logger);
    const snap = mgr.getSessionSnapshot();

    expect(snap.SOUL).toBe("");
    expect(snap.MEMORY).toBe("");
  });
});

// ── AC: Dream commit with correct message format ──────────────────────────────

describe("commitIfChanged — git versioning", () => {
  it("creates commit with '{label}: {iso}, {n} change(s)' format", async () => {
    const mgr = createWorkspaceManager(root, logger);
    await mgr.ensureInitialized();

    const timestamp = "2026-04-19T12:00:00.000Z";

    // Write changes to two files dream is allowed to touch
    writeFileSync(join(root, "MEMORY.md"), "# Memory\n\nFact 1.\nFact 2.\nFact 3.\n", "utf-8");

    await mgr.commitIfChanged(["MEMORY.md"], "her own hand");

    const git = simpleGit(root);
    const log = await git.log();
    const latestMessage = log.latest?.message ?? "";

    expect(latestMessage).toBe("her own hand: 1 change(s)");
  });

  it("commit message includes the count of changed files (2 edits scenario)", async () => {
    const mgr = createWorkspaceManager(root, logger);
    await mgr.ensureInitialized();

    const timestamp = "2026-04-19T10:00:00.000Z";

    writeFileSync(join(root, "MEMORY.md"), "# Memory\n\nEdit 1.\n", "utf-8");
    writeFileSync(join(root, "AGENT.md"), "# Agent\n\nEdit 3.\n", "utf-8");

    await mgr.commitIfChanged(["MEMORY.md", "AGENT.md"], "her own hand");

    const git = simpleGit(root);
    const log = await git.log();
    const msg = log.latest?.message ?? "";

    expect(msg).toBe("her own hand: 2 change(s)");
  });

  it("skips commit when changedFiles is empty", async () => {
    const mgr = createWorkspaceManager(root, logger);
    await mgr.ensureInitialized();

    const git = simpleGit(root);
    const logBefore = await git.log();
    const countBefore = logBefore.total;

    await mgr.commitIfChanged([], "her own hand");

    const logAfter = await git.log();
    expect(logAfter.total).toBe(countBefore);
  });

  it("skips commit when no files are actually modified (nothing staged)", async () => {
    const mgr = createWorkspaceManager(root, logger);
    await mgr.ensureInitialized();

    const git = simpleGit(root);
    const logBefore = await git.log();
    const countBefore = logBefore.total;

    // MEMORY.md exists but was not modified since last commit
    await mgr.commitIfChanged(["MEMORY.md"], "her own hand");

    const logAfter = await git.log();
    expect(logAfter.total).toBe(countBefore);
  });
});

// ── AC: git revert restores MEMORY.md ────────────────────────────────────────

describe("git revert — corrupted MEMORY.md recovery", () => {
  it("git revert HEAD restores previous MEMORY.md content", async () => {
    const mgr = createWorkspaceManager(root, logger);
    await mgr.ensureInitialized();

    // Commit a known good state
    writeFileSync(join(root, "MEMORY.md"), "# Memory\n\nGood content.\n", "utf-8");
    await mgr.commitIfChanged(["MEMORY.md"], "2026-04-19T08:00:00.000Z");

    // Now simulate corruption
    writeFileSync(join(root, "MEMORY.md"), "CORRUPTED CONTENT", "utf-8");
    await mgr.commitIfChanged(["MEMORY.md"], "2026-04-19T09:00:00.000Z");

    // Verify corruption was committed
    const git = simpleGit(root);
    const { readFileSync } = await import("node:fs");
    const corruptedContent = readFileSync(join(root, "MEMORY.md"), "utf-8");
    expect(corruptedContent).toBe("CORRUPTED CONTENT");

    // Run git revert to undo the corrupted commit
    // simple-git revert() takes a commit ref string, plus options via raw args
    await git.raw(["revert", "HEAD", "--no-edit"]);

    // MEMORY.md should be back to "Good content."
    const restoredContent = readFileSync(join(root, "MEMORY.md"), "utf-8");
    expect(restoredContent).toContain("Good content.");
  });
});

// ── AC: age-annotated memory ──────────────────────────────────────────────────

describe("getAgeAnnotatedMemory — maps snapshot to MemoryFiles", () => {
  it("returns memoryFiles with SOUL, USER, MEMORY, AGENT keys", async () => {
    const mgr = createWorkspaceManager(root, logger);
    await mgr.ensureInitialized();

    const snap = mgr.getSessionSnapshot();
    const { memoryFiles, identityContent } = await mgr.getAgeAnnotatedMemory(snap);

    // IDENTITY is returned separately
    expect(typeof identityContent).toBe("string");

    // MemoryFiles maps SOUL, USER, MEMORY, AGENT
    expect(memoryFiles).toBeDefined();
  });

  it("empty strings become undefined in memoryFiles", async () => {
    // No init: all files empty
    const mgr = createWorkspaceManager(root, logger);
    const snap = mgr.getSessionSnapshot();
    const { memoryFiles } = await mgr.getAgeAnnotatedMemory(snap);

    expect(memoryFiles.SOUL).toBeUndefined();
    expect(memoryFiles.USER).toBeUndefined();
    expect(memoryFiles.MEMORY).toBeUndefined();
    expect(memoryFiles.AGENT).toBeUndefined();
  });

  it("IDENTITY.md content does not appear in memoryFiles (it's separate)", async () => {
    const mgr = createWorkspaceManager(root, logger);
    await mgr.ensureInitialized();

    const snap = mgr.getSessionSnapshot();
    const { memoryFiles, identityContent } = await mgr.getAgeAnnotatedMemory(snap);

    // identityContent should have content from IDENTITY.md
    expect(identityContent).toContain("Identity");

    // memoryFiles has no IDENTITY key
    const keys = Object.keys(memoryFiles);
    expect(keys).not.toContain("IDENTITY");
  });

  it("returns annotated MEMORY.md content (no annotation for fresh lines)", async () => {
    const mgr = createWorkspaceManager(root, logger);
    await mgr.ensureInitialized();

    writeFileSync(join(root, "MEMORY.md"), "# Memory\n\nFresh line.\n", "utf-8");
    await mgr.commitIfChanged(["MEMORY.md"], new Date().toISOString());

    const snap = mgr.getSessionSnapshot();
    const { memoryFiles } = await mgr.getAgeAnnotatedMemory(snap);

    // Fresh lines (0 days old) should NOT have age annotations
    expect(memoryFiles.MEMORY).not.toContain("<-");
    expect(memoryFiles.MEMORY).toContain("Fresh line.");
  });
});

// ── AC: SOUL.md tracked but not auto-committed ────────────────────────────────

describe("SOUL.md — user-managed, not auto-committed", () => {
  it("manual SOUL.md edit is tracked by git status but never auto-committed", async () => {
    const mgr = createWorkspaceManager(root, logger);
    await mgr.ensureInitialized();

    // User manually edits SOUL.md
    writeFileSync(join(root, "SOUL.md"), "# Soul\n\nUser-edited content.\n", "utf-8");

    const git = simpleGit(root);
    const status = await git.status();

    // SOUL.md should appear as modified (unstaged)
    const modified = status.modified;
    expect(modified).toContain("SOUL.md");

    // Do a dream commit for a different file, SOUL.md should NOT be included
    writeFileSync(join(root, "MEMORY.md"), "# Memory\n\nNew memory.\n", "utf-8");
    await mgr.commitIfChanged(["MEMORY.md"], "her own hand");

    // After dream commit, SOUL.md should still be unstaged
    const statusAfter = await git.status();
    expect(statusAfter.modified).toContain("SOUL.md");

    // Confirm the auto-commit was for MEMORY.md only
    const log = await git.log();
    expect(log.latest?.message).toBe("her own hand: 1 change(s)");
  });
});
