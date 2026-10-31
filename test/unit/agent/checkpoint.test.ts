import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createCheckpointManager } from "../../../src/agent/checkpoint.js";
import type { Checkpoint } from "../../../src/agent/checkpoint.js";

// ── AC6: crash recovery, pending calls restored with synthetic error ─────────

describe("CheckpointManager — AC6: checkpoint restore injects synthetic errors", () => {
  let tmpDir: string;
  let checkpointPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "checkpoint-test-"));
    checkpointPath = join(tmpDir, "checkpoint.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no checkpoint file exists", () => {
    const mgr = createCheckpointManager(checkpointPath);
    expect(mgr.restore()).toBeNull();
  });

  it("restores a checkpoint with no pending calls unchanged", () => {
    const mgr = createCheckpointManager(checkpointPath);

    const checkpoint: Checkpoint = {
      sessionId: "sess_abc",
      assistantMessage: { role: "assistant", content: "I will read the file." },
      completedResults: [
        { callId: "call_1", name: "read_file", content: "file content" },
      ],
      pendingCalls: [],
      timestamp: Date.now(),
    };

    mgr.save(checkpoint);
    const restored = mgr.restore();

    expect(restored).not.toBeNull();
    expect(restored!.sessionId).toBe("sess_abc");
    expect(restored!.completedResults).toHaveLength(1);
    expect(restored!.pendingCalls).toHaveLength(0);
  });

  it("injects synthetic error results for pending calls on restore", () => {
    const mgr = createCheckpointManager(checkpointPath);

    const checkpoint: Checkpoint = {
      sessionId: "sess_xyz",
      assistantMessage: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "call_2", name: "write_file", input: { path: "/foo.ts" } },
          { type: "tool_use", id: "call_3", name: "run_command", input: { cmd: "npm test" } },
        ],
      },
      completedResults: [],
      pendingCalls: [
        { callId: "call_2", name: "write_file", args: { path: "/foo.ts" } },
        { callId: "call_3", name: "run_command", args: { cmd: "npm test" } },
      ],
      timestamp: Date.now(),
    };

    mgr.save(checkpoint);
    const restored = mgr.restore();

    expect(restored).not.toBeNull();
    // pendingCalls should be cleared
    expect(restored!.pendingCalls).toHaveLength(0);
    // synthetic errors injected into completedResults
    expect(restored!.completedResults).toHaveLength(2);

    const r1 = restored!.completedResults.find((r) => r.callId === "call_2");
    const r2 = restored!.completedResults.find((r) => r.callId === "call_3");

    expect(r1).toBeDefined();
    expect(r1!.isError).toBe(true);
    expect(r1!.content).toMatch(/interrupted|restarted/i);

    expect(r2).toBeDefined();
    expect(r2!.isError).toBe(true);
    expect(r2!.name).toBe("run_command");
  });

  it("merges synthetic errors with already-completed results", () => {
    const mgr = createCheckpointManager(checkpointPath);

    const checkpoint: Checkpoint = {
      sessionId: "sess_merge",
      assistantMessage: { role: "assistant", content: "doing work" },
      completedResults: [
        { callId: "call_a", name: "tool_a", content: "ok" },
      ],
      pendingCalls: [
        { callId: "call_b", name: "tool_b", args: {} },
      ],
      timestamp: Date.now(),
    };

    mgr.save(checkpoint);
    const restored = mgr.restore();

    expect(restored!.completedResults).toHaveLength(2);
    expect(restored!.completedResults[0].callId).toBe("call_a");
    expect(restored!.completedResults[0].isError).toBeFalsy();
    expect(restored!.completedResults[1].callId).toBe("call_b");
    expect(restored!.completedResults[1].isError).toBe(true);
  });

  it("clear removes the checkpoint file", () => {
    const mgr = createCheckpointManager(checkpointPath);

    const checkpoint: Checkpoint = {
      sessionId: "sess_clear",
      assistantMessage: { role: "assistant", content: "hi" },
      completedResults: [],
      pendingCalls: [],
      timestamp: Date.now(),
    };

    mgr.save(checkpoint);
    expect(mgr.restore()).not.toBeNull();

    mgr.clear();
    expect(mgr.restore()).toBeNull();
  });

  it("save is atomic (uses rename, no .tmp file left over)", () => {
    // We can't easily test atomicity directly, but we can verify
    // that no .tmp file is left after save
    const mgr = createCheckpointManager(checkpointPath);
    const checkpoint: Checkpoint = {
      sessionId: "sess_atomic",
      assistantMessage: { role: "assistant", content: "x" },
      completedResults: [],
      pendingCalls: [],
      timestamp: Date.now(),
    };

    mgr.save(checkpoint);

    expect(existsSync(checkpointPath)).toBe(true);
    expect(existsSync(checkpointPath + ".tmp")).toBe(false);
  });
});

describe("her first tool use, on a home that is genuinely new", () => {
  it("saves a checkpoint into a directory that does not exist yet", () => {
    // This threw ENOENT and killed the turn. `sessions/` is created as a side effect of
    // persisting conversation history, which happens AFTER a turn, so the very first turn that
    // called a tool died: on the one day her home is actually new, and then never again.
    //
    // It hid behind a measurement harness that reused one home for a whole run: by the time any
    // tool-using turn came round, an earlier turn had made the directory. Giving each measured
    // turn its own life is also the only configuration that resembles her birth, and it fell
    // over immediately.
    const root = mkdtempSync(join(tmpdir(), "first-tool-use-"));
    try {
      const neverMade = join(root, "sessions", "telegram--1.checkpoint.json");
      expect(existsSync(dirname(neverMade)), "the fixture is not testing what it claims").toBe(false);
      const mgr = createCheckpointManager(neverMade);
      expect(() => mgr.save({
        messages: [], completedResults: [], pendingCalls: [], sessionId: "s", timestamp: 1,
      } as never)).not.toThrow();
      expect(existsSync(neverMade)).toBe(true);
      expect(mgr.restore()).not.toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
