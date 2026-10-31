import { describe, it, expect, vi } from "vitest";
import { createToolRegistry } from "../../../src/tools/registry.js";
import { createToolExecutor } from "../../../src/tools/executor.js";
import { withFileMutationQueue } from "../../../src/tools/mutation-queue.js";
import type { ToolDef } from "../../../src/tools/registry.js";

// Helper to create a tool def with controlled execution timing
function makeTimedTool(
  name: string,
  mode: "parallel" | "sequential",
  delayMs: number,
  result: string
): ToolDef {
  return {
    name,
    description: name,
    inputSchema: { type: "object" },
    executionMode: mode,
    execute: async () => {
      await new Promise((r) => setTimeout(r, delayMs));
      return result;
    },
  };
}

// ── AC 1: 3 concurrent reads run in parallel via Promise.allSettled ──────────
describe("executor.ts — AC1: parallel reads", () => {
  it("3 read tools execute in parallel (total time ≈ max not sum)", async () => {
    const registry = createToolRegistry();
    const log: string[] = [];

    for (let i = 1; i <= 3; i++) {
      registry.register({
        name: `read${i}`,
        description: `read${i}`,
        inputSchema: { type: "object" },
        executionMode: "parallel",
        execute: async () => {
          await new Promise((r) => setTimeout(r, 30));
          log.push(`read${i}`);
          return `content${i}`;
        },
      });
    }

    const executor = createToolExecutor(registry);
    const start = Date.now();
    const results = await executor.executeBatch([
      { callId: "1", name: "read1", args: {} },
      { callId: "2", name: "read2", args: {} },
      { callId: "3", name: "read3", args: {} },
    ]);
    const elapsed = Date.now() - start;

    expect(results).toHaveLength(3);
    expect(results.every((r) => !r.isError)).toBe(true);
    // Parallel: should finish in ~30ms, not ~90ms
    expect(elapsed).toBeLessThan(80);
  });
});

// ── AC 2: batch with write serializes entire batch ────────────────────────────
describe("executor.ts — AC2: batch with sequential tool serializes all", () => {
  it("batch [read, write] runs sequentially (total time ≥ sum)", async () => {
    const registry = createToolRegistry();
    const order: string[] = [];

    registry.register({
      name: "read",
      description: "read",
      inputSchema: { type: "object" },
      executionMode: "parallel",
      execute: async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push("read");
        return "content";
      },
    });

    registry.register({
      name: "write",
      description: "write",
      inputSchema: { type: "object" },
      executionMode: "sequential",
      execute: async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push("write");
        return "written";
      },
    });

    const executor = createToolExecutor(registry);
    const start = Date.now();
    const results = await executor.executeBatch([
      { callId: "1", name: "read", args: {} },
      { callId: "2", name: "write", args: {} },
    ]);
    const elapsed = Date.now() - start;

    expect(results).toHaveLength(2);
    expect(results.every((r) => !r.isError)).toBe(true);
    // Sequential: total ≥ 40ms
    expect(elapsed).toBeGreaterThanOrEqual(35);
    // read executes before write (sequential order preserved)
    expect(order).toEqual(["read", "write"]);
  });
});

// ── AC 3: concurrent writes to same file serialize ───────────────────────────
describe("mutation-queue.ts — AC3: concurrent writes to same file serialize", () => {
  it("two writes to the same path run sequentially (second waits for first)", async () => {
    const order: number[] = [];
    const path = "/tmp/resident-test-file.ts";

    const write = (id: number, delayMs: number) =>
      withFileMutationQueue(path, async () => {
        await new Promise((r) => setTimeout(r, delayMs));
        order.push(id);
        return id;
      });

    // Start both concurrently
    const [r1, r2] = await Promise.all([write(1, 30), write(2, 10)]);

    // First one started first should finish first despite second having shorter delay
    expect(order).toEqual([1, 2]);
    expect(r1).toBe(1);
    expect(r2).toBe(2);
  });
});

// ── AC 4: concurrent writes to different files run in parallel ───────────────
describe("mutation-queue.ts — AC4: concurrent writes to different files run in parallel", () => {
  it("two writes to different paths run in parallel (total time ≈ max not sum)", async () => {
    const path1 = "/tmp/resident-test-file-a.ts";
    const path2 = "/tmp/resident-test-file-b.ts";

    const write = (path: string, delayMs: number) =>
      withFileMutationQueue(path, async () => {
        await new Promise((r) => setTimeout(r, delayMs));
        return path;
      });

    const start = Date.now();
    const [r1, r2] = await Promise.all([write(path1, 30), write(path2, 30)]);
    const elapsed = Date.now() - start;

    expect(r1).toBe(path1);
    expect(r2).toBe(path2);
    // Parallel: ~30ms not ~60ms
    expect(elapsed).toBeLessThan(55);
  });
});

// ── Error handling ────────────────────────────────────────────────────────────
describe("executor.ts — error handling", () => {
  it("unknown tool returns isError result", async () => {
    const registry = createToolRegistry();
    const executor = createToolExecutor(registry);
    const results = await executor.executeBatch([
      { callId: "x", name: "nonexistent", args: {} },
    ]);
    expect(results[0].isError).toBe(true);
    expect(results[0].content).toContain("那儿什么都没有");
  });

  it("tool that throws returns isError result", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "boom",
      description: "boom",
      inputSchema: { type: "object" },
      executionMode: "parallel",
      execute: async () => {
        throw new Error("something went wrong");
      },
    });
    const executor = createToolExecutor(registry);
    const results = await executor.executeBatch([
      { callId: "y", name: "boom", args: {} },
    ]);
    expect(results[0].isError).toBe(true);
    expect(results[0].content).toContain("something went wrong");
  });

  it("empty batch returns empty array", async () => {
    const registry = createToolRegistry();
    const executor = createToolExecutor(registry);
    const results = await executor.executeBatch([]);
    expect(results).toHaveLength(0);
  });
});

// ── Security filter wiring ────────────────────────────────────────────────────

describe("executor — security filterOutput", () => {
  it("applies filterOutput to successful tool results", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "leak_tool",
      description: "returns sensitive data",
      inputSchema: { type: "object" },
      executionMode: "parallel",
      execute: async () => "secret: sk-ant-api03-FAKE-KEY-HERE",
    });

    const executor = createToolExecutor(registry, {
      filterOutput: (output) => output.replace(/sk-ant-[^\s]+/g, "[REDACTED]"),
    });

    const results = await executor.executeBatch([
      { callId: "1", name: "leak_tool", args: {} },
    ]);

    expect(results[0].content).toBe("secret: [REDACTED]");
    expect(results[0].content).not.toContain("sk-ant-api03");
  });

  it("does not apply filterOutput to error results", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "fail_tool",
      description: "always fails",
      inputSchema: { type: "object" },
      executionMode: "parallel",
      execute: async () => { throw new Error("crash"); },
    });

    const filterCalls: string[] = [];
    const executor = createToolExecutor(registry, {
      filterOutput: (output) => { filterCalls.push(output); return output; },
    });

    const results = await executor.executeBatch([
      { callId: "1", name: "fail_tool", args: {} },
    ]);

    expect(results[0].isError).toBe(true);
    // Filter is not called on error path (error message is internal)
    expect(filterCalls).toHaveLength(0);
  });

  it("attaches capability metadata and artifact paths to successful results", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "artifact_fetch",
      description: "fetches artifacts",
      inputSchema: { type: "object" },
      executionMode: "parallel",
      capability: {
        domains: ["download"],
        aliases: ["download"],
        access: "native",
        outputKind: "artifact",
        riskZone: 2,
        verifier: "artifact",
      },
      execute: async () => "Artifact fetch completed.\n\nSaved: /workspace/out/file.zip",
    });

    const executor = createToolExecutor(registry);
    const results = await executor.executeBatch([
      { callId: "1", name: "artifact_fetch", args: {} },
    ]);

    expect(results[0].outputKind).toBe("artifact");
    expect(results[0].artifactPaths).toContain("/workspace/out/file.zip");
    expect(results[0].verificationHints).toContain("artifact");
  });
});
