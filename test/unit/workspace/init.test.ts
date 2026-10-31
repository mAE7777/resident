import { describe, it, expect, afterEach } from "vitest";
import { initWorkspace } from "../../../src/workspace/init.js";
import { createLogger } from "../../../src/utils/logger.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, readdirSync, rmSync } from "node:fs";

function tempWorkspacePath(): string {
  return join(
    tmpdir(),
    `god-agent-ws-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const p of cleanupPaths.splice(0)) {
    try {
      if (existsSync(p)) rmSync(p, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});

const logger = createLogger("test-workspace");

describe("initWorkspace", () => {
  it("creates .git directory after initialization", async () => {
    const wsPath = tempWorkspacePath();
    cleanupPaths.push(wsPath);

    const { result } = await initWorkspace(wsPath, logger);
    expect(result.initialized).toBe(true);
    expect(existsSync(join(wsPath, ".git"))).toBe(true);
  });

  it("creates template files plus .gitignore", async () => {
    const wsPath = tempWorkspacePath();
    cleanupPaths.push(wsPath);

    await initWorkspace(wsPath, logger);

    const expectedFiles = [
      "SOUL.md",
      "IDENTITY.md",
      "AGENT.md",
      "MEMORY.md",
      "心情的词.md",
      ".gitignore",
    ];
    for (const f of expectedFiles) {
      expect(existsSync(join(wsPath, f)), `${f} should exist`).toBe(true);
    }
  });

  it("a home from before her vocabulary moved in gets the seed once — and an edited file is never touched", async () => {
    const wsPath = tempWorkspacePath();
    cleanupPaths.push(wsPath);
    const { readFileSync, writeFileSync, rmSync: rm } = await import("node:fs");
    const wordsPath = join(wsPath, "心情的词.md");

    await initWorkspace(wsPath, logger);
    // Simulate the pre-organ home: initialized, no vocabulary file.
    rm(wordsPath);
    const second = await initWorkspace(wsPath, logger);
    expect(second.result.initialized).toBe(false);
    expect(existsSync(wordsPath), "the backfill must seed the missing file").toBe(true);

    // She edits it; a later boot must leave her words exactly as she wrote them.
    writeFileSync(wordsPath, readFileSync(wordsPath, "utf-8").replace("疲惫", "乏"), "utf-8");
    await initWorkspace(wsPath, logger);
    expect(readFileSync(wordsPath, "utf-8")).toContain("乏");
  });

  it("returns initialized: false when .git already exists", async () => {
    const wsPath = tempWorkspacePath();
    cleanupPaths.push(wsPath);

    await initWorkspace(wsPath, logger);
    const second = await initWorkspace(wsPath, logger);
    expect(second.result.initialized).toBe(false);
  });

  it("contains diagnostics describing the initialization steps", async () => {
    const wsPath = tempWorkspacePath();
    cleanupPaths.push(wsPath);

    const { diagnostics } = await initWorkspace(wsPath, logger);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.message.includes("git init"))).toBe(true);
    expect(diagnostics.some((d) => d.message.includes("initial commit"))).toBe(true);
  });

  it(".gitignore excludes sessions/, *.jsonl, *.db, .dream_cursor, .cursor (S-MEM-010)", async () => {
    const wsPath = tempWorkspacePath();
    cleanupPaths.push(wsPath);

    await initWorkspace(wsPath, logger);

    const { readFileSync } = await import("node:fs");
    const gitignore = readFileSync(join(wsPath, ".gitignore"), "utf-8");
    expect(gitignore).toContain("sessions/");
    expect(gitignore).toContain("*.jsonl");
    expect(gitignore).toContain("*.db");
    expect(gitignore).toContain(".dream_cursor");
    expect(gitignore).toContain(".cursor");
  });

  it("creates workspace directory if it does not exist", async () => {
    const wsPath = join(tempWorkspacePath(), "nested", "workspace");
    const topLevel = wsPath.split("/").slice(0, -2).join("/");
    cleanupPaths.push(join(tmpdir(), wsPath.split("/")[tmpdir().split("/").length] ?? ""));

    // Use the actual parent for cleanup
    const parentForCleanup = wsPath.split("/").slice(0, tmpdir().split("/").length + 1).join("/");
    cleanupPaths.push(parentForCleanup);

    expect(existsSync(wsPath)).toBe(false);
    const { result } = await initWorkspace(wsPath, logger);
    expect(result.initialized).toBe(true);
    expect(existsSync(wsPath)).toBe(true);
  });
});
