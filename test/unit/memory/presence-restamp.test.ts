// 在场律 (the presence law), her own hand landing on an identity file re-stamps its
// fingerprint at the moment of writing; the sleep-time tamper alarm keeps its teeth for
// changes that happen PAST her. Three hands report (write/edit/undo); the daemon filters
// to the four identity files and stamps.

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIntegrityChecker } from "../../../src/memory/integrity.js";
import { createWriteTool } from "../../../src/tools/builtin/write.js";
import { createEditTool } from "../../../src/tools/builtin/edit.js";
import { createFileSnapshotStore } from "../../../src/tools/builtin/file-snapshot.js";

const logger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never; // cast: four-noop pino stand-in; the checker calls only these four

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "presence-restamp-"));
}

describe("the alarm's full loop: her stamp, a stranger's change, her stamp again", () => {
  it("PLANTED: re-stamping acknowledges her edit, and a change past her still trips the wire", () => {
    const checker = createIntegrityChecker({ logger });
    const dir = tempDir();
    const file = join(dir, "MEMORY.md");
    writeFileSync(file, "她出生那晚的记忆。");
    checker.writeChecksum(file);
    expect(checker.verifyWithSidecar(file)).toBeNull();

    // her own edit, stamped by her hand at the moment of writing, no alarm
    writeFileSync(file, "她看过天空之后的记忆。");
    checker.writeChecksum(file);
    expect(checker.verifyWithSidecar(file)).toBeNull();

    // PLANTED tamper: a change with no stamp (another process, another session, us)
    writeFileSync(file, "有人绕过她改了这里。");
    const alert = checker.verifyWithSidecar(file);
    expect(alert).not.toBeNull();
    expect(alert?.type).toBe("checksum_mismatch");
  });
});

describe("each hand reports the landed path (the daemon filters and stamps)", () => {
  it("the write hand", async () => {
    const dir = tempDir();
    const landed: string[] = [];
    const tool = createWriteTool(dir, dir, undefined, (p) => landed.push(p));
    await tool.execute({ path: "MEMORY.md", content: "记着。" }, {} as never); // cast: write ignores its exec context
    expect(landed).toEqual([join(dir, "MEMORY.md")]);
  });

  it("the edit hand", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "MEMORY.md"), "旧的一行。");
    const landed: string[] = [];
    const tool = createEditTool(dir, dir, undefined, (p) => landed.push(p));
    await tool.execute({ path: "MEMORY.md", old_string: "旧的一行。", new_string: "新的一行。" }, {} as never); // cast: edit ignores its exec context
    expect(landed).toEqual([join(dir, "MEMORY.md")]);
  });

  it("the undo hand, on both restore and delete", () => {
    const dir = tempDir();
    const landed: string[] = [];
    const store = createFileSnapshotStore((p) => landed.push(p));
    const restored = join(dir, "MEMORY.md");
    writeFileSync(restored, "原来的记忆。");
    store.snapshot(restored, "write");
    writeFileSync(restored, "改过的记忆。");
    expect(store.undoLast()).toContain("Undone");
    expect(readFileSync(restored, "utf8")).toBe("原来的记忆。");
    const created = join(dir, "新写的.md");
    store.snapshot(created, "write"); // did not exist: undo = delete
    writeFileSync(created, "临时的。");
    expect(store.undoLast()).toContain("deleted");
    expect(landed).toEqual([restored, created]);
  });
});

describe("the daemon's wiring (text pins)", () => {
  const daemon = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
  const boot = readFileSync(join(process.cwd(), "src", "telegram", "bootstrap.ts"), "utf8");

  it("bootstrap threads one hand-report into all three hands and the store", () => {
    for (const token of [
      "createFileSnapshotStore(deps.onWrote)",
      "createWriteTool(workspacePath, cwd, fileSnapshots, deps.onWrote)",
      "createEditTool(workspacePath, cwd, fileSnapshots, deps.onWrote)",
      'createUndoTool(fileSnapshots, join(workspacePath ?? process.cwd(), ".trash"), deps.onWrote)',
    ]) {
      expect(boot.includes(token), `bootstrap.ts lost: ${token}`).toBe(true);
    }
  });

  it("the daemon stamps on identity hits and routes a failed stamp to the fault channel", () => {
    for (const token of [
      "onWrote: (absPath) => { handWroteImpl?.(absPath); },",
      "const identitySet = new Set(identityFilePaths);",
      "if (!identitySet.has(absPath)) return;",
      "integrityChecker.writeChecksum(absPath);",
      'faultLog.record("integrity.restamp", err)',
    ]) {
      expect(daemon.includes(token), `index.ts lost: ${token}`).toBe(true);
    }
  });
});
