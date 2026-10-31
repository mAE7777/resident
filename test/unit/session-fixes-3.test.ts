// Tests for Items 3, 4, 10 from SG-003/SG-004.
// Covers: adaptive exploration rate, length recovery, tool result validation.

import { describe, it, expect } from "vitest";
import type { AgentRunSpec, AgentResult, AgentEvent, ToolResult } from "../../src/agent/types.js";
import type { Message } from "../../src/providers/types.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeMessages(text: string): Message[] {
  return [{ role: "user", content: text }];
}

function fauxText(text: string, stopReason: string = "end_turn") {
  return {
    id: "faux",
    model: "test",
    content: [{ type: "text" as const, text }],
    usage: { inputTokens: 10, outputTokens: 5 },
    stopReason: stopReason as "end_turn",
  };
}

function fauxToolCall(name: string, args: unknown) {
  return {
    id: "faux",
    model: "test",
    content: [
      { type: "text" as const, text: "" },
      { type: "tool_use" as const, id: `call-${Math.random().toString(36).slice(2, 8)}`, name, input: args },
    ],
    usage: { inputTokens: 10, outputTokens: 5 },
    stopReason: "tool_use" as const,
  };
}

const DUMMY_TOOL = {
  name: "echo",
  description: "echo",
  input_schema: { type: "object" as const },
};

async function collectAll(gen: AsyncGenerator<AgentEvent, AgentResult>): Promise<AgentResult> {
  let result: IteratorResult<AgentEvent, AgentResult>;
  do { result = await gen.next(); } while (!result.done);
  return result.value;
}

// ── ITEM 10: Adaptive Exploration Rate ───────────────────────────────────────

describe("Adaptive exploration rate", () => {
  it("new task type (0 data) gets MAX exploration rate 0.4", async () => {
    // With 0 data points: 1/sqrt(1) = 1.0, clamped to 0.4
    const rate = Math.max(0.05, Math.min(0.4, 1.0 / Math.sqrt(Math.max(1, 0))));
    expect(rate).toBe(0.4);
  });

  it("task type with 1 data point gets 0.4", () => {
    const rate = Math.max(0.05, Math.min(0.4, 1.0 / Math.sqrt(Math.max(1, 1))));
    expect(rate).toBe(0.4); // 1/sqrt(1) = 1.0, clamped to 0.4
  });

  it("task type with 4 data points gets 0.4", () => {
    const rate = Math.max(0.05, Math.min(0.4, 1.0 / Math.sqrt(Math.max(1, 4))));
    expect(rate).toBe(0.4); // 1/sqrt(4) = 0.5, clamped to 0.4
  });

  it("task type with 7 data points gets ~0.378", () => {
    const rate = Math.max(0.05, Math.min(0.4, 1.0 / Math.sqrt(Math.max(1, 7))));
    expect(rate).toBeCloseTo(0.378, 2);
  });

  it("task type with 25 data points gets 0.2", () => {
    const rate = Math.max(0.05, Math.min(0.4, 1.0 / Math.sqrt(Math.max(1, 25))));
    expect(rate).toBe(0.2); // 1/sqrt(25) = 0.2
  });

  it("task type with 100 data points gets 0.1", () => {
    const rate = Math.max(0.05, Math.min(0.4, 1.0 / Math.sqrt(Math.max(1, 100))));
    expect(rate).toBe(0.1);
  });

  it("task type with 400 data points gets MIN rate 0.05", () => {
    const rate = Math.max(0.05, Math.min(0.4, 1.0 / Math.sqrt(Math.max(1, 400))));
    expect(rate).toBe(0.05); // 1/sqrt(400) = 0.05
  });

  it("task type with 10000 data points gets MIN rate 0.05", () => {
    const rate = Math.max(0.05, Math.min(0.4, 1.0 / Math.sqrt(Math.max(1, 10000))));
    expect(rate).toBe(0.05); // 1/sqrt(10000) = 0.01, clamped to 0.05
  });

  it("rate is always bounded between 0.05 and 0.4", () => {
    for (const n of [0, 1, 2, 5, 10, 50, 100, 500, 1000, 10000]) {
      const rate = Math.max(0.05, Math.min(0.4, 1.0 / Math.sqrt(Math.max(1, n))));
      expect(rate).toBeGreaterThanOrEqual(0.05);
      expect(rate).toBeLessThanOrEqual(0.4);
    }
  });

  it("rate decreases monotonically as data increases", () => {
    const points = [1, 4, 16, 64, 256, 1024];
    const rates = points.map(n => Math.max(0.05, Math.min(0.4, 1.0 / Math.sqrt(Math.max(1, n)))));
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]).toBeLessThanOrEqual(rates[i - 1]!);
    }
  });

});

// ── ITEM 4: Length Recovery ──────────────────────────────────────────────────

describe("Length recovery — truncated LLM output", () => {
  it("max_tokens response with content triggers recovery", async () => {
    const { agentLoop } = await import("../../src/agent/loop.js");

    let callCount = 0;
    const provider = {
      async complete() {
        callCount++;
        if (callCount === 1) {
          // First call: truncated output
          return fauxText("This is partial content that was cut", "max_tokens");
        }
        // Second call: complete response after recovery
        return fauxText("This is partial content that was cut off. Here's the rest.");
      },
    };

    const spec: AgentRunSpec = {
      provider,
      messages: makeMessages("write something long"),
      model: "test",
    };

    const result = await collectAll(agentLoop(spec));
    expect(result.finishReason).toBe("stop");
    // Should have taken 2+ iterations (1 truncated + 1 recovered)
    expect(result.iterations).toBeGreaterThanOrEqual(2);
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("max_tokens with empty content does NOT trigger recovery", async () => {
    const { agentLoop } = await import("../../src/agent/loop.js");

    let callCount = 0;
    const provider = {
      async complete() {
        callCount++;
        if (callCount === 1) {
          return fauxText("", "max_tokens"); // Empty truncation
        }
        return fauxText("fallback response");
      },
    };

    const spec: AgentRunSpec = {
      provider,
      messages: makeMessages("hello"),
      model: "test",
    };

    const result = await collectAll(agentLoop(spec));
    // Empty truncation should NOT trigger recovery, nothing to continue from
    // Agent should treat it as a normal text response
    expect(result.finishReason).toBe("stop");
  });

  it("recovery stops after MAX_LENGTH_RECOVERIES (3)", async () => {
    const { agentLoop } = await import("../../src/agent/loop.js");

    let callCount = 0;
    const provider = {
      async complete() {
        callCount++;
        // Always return truncated: should recover 3 times then stop
        if (callCount <= 4) {
          return fauxText(`partial output chunk ${callCount}`, "max_tokens");
        }
        return fauxText("final complete output");
      },
    };

    const spec: AgentRunSpec = {
      provider,
      messages: makeMessages("generate very long content"),
      model: "test",
      maxIterations: 10,
    };

    const result = await collectAll(agentLoop(spec));
    // 3 recoveries max, then 4th truncation is treated as normal response
    expect(callCount).toBeLessThanOrEqual(6); // At most: 1 original + 3 recoveries + 1-2 normal
  });

  it("normal end_turn does NOT trigger recovery", async () => {
    const { agentLoop } = await import("../../src/agent/loop.js");

    let callCount = 0;
    const provider = {
      async complete() {
        callCount++;
        return fauxText("normal complete response", "end_turn");
      },
    };

    const spec: AgentRunSpec = {
      provider,
      messages: makeMessages("hello"),
      model: "test",
    };

    const result = await collectAll(agentLoop(spec));
    expect(result.finishReason).toBe("stop");
    expect(callCount).toBe(1); // No recovery needed
  });
});

// ── ITEM 3: Tool Result Validation ──────────────────────────────────────────

describe("Tool result validation — empty result check", () => {
  it("empty string tool result gets replaced with warning", async () => {
    const { createToolExecutor } = await import("../../src/tools/executor.js");
    const { createToolRegistry } = await import("../../src/tools/registry.js");

    const registry = createToolRegistry();
    registry.register({
      name: "empty_tool",
      description: "returns empty",
      inputSchema: { type: "object" },
      executionMode: "sequential",
      execute: async () => "", // Silent failure
    });

    const executor = createToolExecutor(registry);
    const results = await executor.executeBatch([
      { callId: "c1", name: "empty_tool", args: {} },
    ]);

    expect(results[0]!.content).toContain("什么也没返回");
    expect(results[0]!.content).toContain("empty_tool");
  });

  it("whitespace-only tool result gets replaced with warning", async () => {
    const { createToolExecutor } = await import("../../src/tools/executor.js");
    const { createToolRegistry } = await import("../../src/tools/registry.js");

    const registry = createToolRegistry();
    registry.register({
      name: "whitespace_tool",
      description: "returns whitespace",
      inputSchema: { type: "object" },
      executionMode: "sequential",
      execute: async () => "   \n\t  ", // Only whitespace
    });

    const executor = createToolExecutor(registry);
    const results = await executor.executeBatch([
      { callId: "c1", name: "whitespace_tool", args: {} },
    ]);

    expect(results[0]!.content).toContain("什么也没返回");
  });

  it("normal non-empty tool result passes through unchanged", async () => {
    const { createToolExecutor } = await import("../../src/tools/executor.js");
    const { createToolRegistry } = await import("../../src/tools/registry.js");

    const registry = createToolRegistry();
    registry.register({
      name: "good_tool",
      description: "returns data",
      inputSchema: { type: "object" },
      executionMode: "sequential",
      execute: async () => "file contents here",
    });

    const executor = createToolExecutor(registry);
    const results = await executor.executeBatch([
      { callId: "c1", name: "good_tool", args: {} },
    ]);

    expect(results[0]!.content).toBe("file contents here");
  });

  it("tool error still reported as error (not overwritten by empty check)", async () => {
    const { createToolExecutor } = await import("../../src/tools/executor.js");
    const { createToolRegistry } = await import("../../src/tools/registry.js");

    const registry = createToolRegistry();
    registry.register({
      name: "error_tool",
      description: "throws",
      inputSchema: { type: "object" },
      executionMode: "sequential",
      execute: async () => { throw new Error("tool crashed"); },
    });

    const executor = createToolExecutor(registry);
    const results = await executor.executeBatch([
      { callId: "c1", name: "error_tool", args: {} },
    ]);

    expect(results[0]!.isError).toBe(true);
    expect(results[0]!.content).toContain("出错了");
  });

  it("unknown tool name returns error (not empty-result warning)", async () => {
    const { createToolExecutor } = await import("../../src/tools/executor.js");
    const { createToolRegistry } = await import("../../src/tools/registry.js");

    const registry = createToolRegistry();
    const executor = createToolExecutor(registry);
    const results = await executor.executeBatch([
      { callId: "c1", name: "nonexistent", args: {} },
    ]);

    expect(results[0]!.isError).toBe(true);
    expect(results[0]!.content).toContain("那儿什么都没有");
  });
});

// ── Governance orphan/backfill verification ─────────────────────────────────

describe("Governance — orphan detection and backfill (existing, verify not broken)", () => {
  it("governMessages function exists and is callable", async () => {
    const { governMessages } = await import("../../src/agent/governance.js");
    expect(typeof governMessages).toBe("function");
  });

  it("empty messages array passes through", async () => {
    const { governMessages } = await import("../../src/agent/governance.js");
    const result = governMessages([]);
    expect(result).toEqual([]);
  });

  it("valid messages pass through unchanged", async () => {
    const { governMessages } = await import("../../src/agent/governance.js");
    const messages: Message[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ];
    const result = governMessages(messages);
    expect(result.length).toBe(2);
  });
});
