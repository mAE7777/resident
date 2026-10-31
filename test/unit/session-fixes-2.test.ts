// Tests for second round of session fixes.
// Covers: graceful abort/interrupt, raised iteration safety caps,
// softened budget pressure, FinishReason "interrupted", and
// abort signal wiring through the agent loop.

import { describe, it, expect } from "vitest";
import type { AgentRunSpec, FinishReason, ToolResult, AgentEvent, AgentResult } from "../../src/agent/types.js";
import type { Message } from "../../src/providers/types.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeMessages(text: string): Message[] {
  return [{ role: "user", content: text }];
}

const DUMMY_TOOL = {
  name: "echo",
  description: "echo tool",
  input_schema: { type: "object" as const, properties: { msg: { type: "string" } } },
};

function fauxText(text: string) {
  return {
    id: "faux",
    model: "test",
    content: [{ type: "text" as const, text }],
    usage: { inputTokens: 10, outputTokens: 5 },
    stopReason: "end_turn" as const,
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

function createFauxProvider(opts: { responses: ReturnType<typeof fauxText>[] }) {
  let idx = 0;
  return {
    async complete() {
      return opts.responses[Math.min(idx++, opts.responses.length - 1)];
    },
  };
}

async function collectAll(gen: AsyncGenerator<AgentEvent, AgentResult>): Promise<AgentResult> {
  let result: IteratorResult<AgentEvent, AgentResult>;
  do {
    result = await gen.next();
  } while (!result.done);
  return result.value;
}

// ── FinishReason type includes "interrupted" ─────────────────────────────────

describe("FinishReason type", () => {
  it("includes interrupted as valid value", () => {
    const reasons: FinishReason[] = ["stop", "max_iterations", "interrupted", "error"];
    expect(reasons).toContain("interrupted");
  });

  it("all four values are distinct", () => {
    const reasons: FinishReason[] = ["stop", "max_iterations", "interrupted", "error"];
    expect(new Set(reasons).size).toBe(4);
  });
});

// ── Abort signal in agent loop ───────────────────────────────────────────────

describe("Agent loop abort signal", () => {
  it("abortSignal is accepted in AgentRunSpec", () => {
    const controller = new AbortController();
    const spec: Partial<AgentRunSpec> = {
      abortSignal: controller.signal,
    };
    expect(spec.abortSignal).toBeDefined();
    expect(spec.abortSignal!.aborted).toBe(false);
  });

  it("AbortController.abort() sets signal.aborted to true", () => {
    const controller = new AbortController();
    expect(controller.signal.aborted).toBe(false);
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
  });

  it("pre-aborted signal returns interrupted immediately", async () => {
    const { agentLoop } = await import("../../src/agent/loop.js");

    const controller = new AbortController();
    controller.abort(); // Pre-abort before loop starts

    const provider = createFauxProvider({ responses: [fauxText("should not reach")] });

    const spec: AgentRunSpec = {
      provider,
      messages: makeMessages("hello"),
      model: "test",
      abortSignal: controller.signal,
    };

    const result = await collectAll(agentLoop(spec));
    expect(result.finishReason).toBe("interrupted");
    expect(result.iterations).toBe(1); // Checked at start of first iteration
  });

  it("abort during tool execution stops at next iteration", async () => {
    const { agentLoop } = await import("../../src/agent/loop.js");

    const controller = new AbortController();
    let callCount = 0;

    const provider = {
      async complete() {
        callCount++;
        if (callCount === 1) {
          return fauxToolCall("echo", { msg: "first" });
        }
        // Abort after first tool call completes
        controller.abort();
        if (callCount === 2) {
          return fauxToolCall("echo", { msg: "second" });
        }
        return fauxText("done");
      },
    };

    const spec: AgentRunSpec = {
      provider,
      messages: makeMessages("do something"),
      model: "test",
      tools: [DUMMY_TOOL],
      abortSignal: controller.signal,
      executeTools: async (calls) =>
        calls.map((c) => ({ callId: c.callId, name: c.name, content: "ok" })),
    };

    const result = await collectAll(agentLoop(spec));
    // Should stop after detecting abort, not continue indefinitely
    expect(result.finishReason).toBe("interrupted");
    expect(result.iterations).toBeGreaterThanOrEqual(2);
    expect(result.iterations).toBeLessThanOrEqual(4); // Stopped early
  });

  it("without abort signal, loop runs normally to completion", async () => {
    const { agentLoop } = await import("../../src/agent/loop.js");

    const provider = createFauxProvider({ responses: [fauxText("hello back")] });

    const spec: AgentRunSpec = {
      provider,
      messages: makeMessages("hello"),
      model: "test",
      // No abortSignal
    };

    const result = await collectAll(agentLoop(spec));
    expect(result.finishReason).toBe("stop");
    expect(result.content).toBe("hello back");
  });
});

// ── Raised iteration safety caps ─────────────────────────────────────────────

describe("Iteration safety caps — raised from old values", () => {
  it("effortToMaxIterations returns values higher than old caps", async () => {
    const { effortToMaxIterations } = await import("../../src/agent/effort-scaling.js");

    // Old values were: simple=10, medium=15, complex=25
    // New values should be significantly higher (safety nets, not constraints)
    expect(effortToMaxIterations("simple")).toBeGreaterThan(10);
    expect(effortToMaxIterations("medium")).toBeGreaterThan(15);
    expect(effortToMaxIterations("complex")).toBeGreaterThan(25);
  });

  it("complex cap is at least 100 (enough for any realistic task)", async () => {
    const { effortToMaxIterations } = await import("../../src/agent/effort-scaling.js");
    expect(effortToMaxIterations("complex")).toBeGreaterThanOrEqual(100);
  });

  it("tiers are monotonically increasing", async () => {
    const { effortToMaxIterations } = await import("../../src/agent/effort-scaling.js");
    const simple = effortToMaxIterations("simple");
    const medium = effortToMaxIterations("medium");
    const complex = effortToMaxIterations("complex");
    expect(medium).toBeGreaterThan(simple);
    expect(complex).toBeGreaterThan(medium);
  });
});

// ── Budget pressure messages softened ────────────────────────────────────────

describe("Budget pressure messages — softened wording", () => {
  it("agent loop with low iteration count does NOT inject pressure", async () => {
    const { agentLoop } = await import("../../src/agent/loop.js");

    const capturedMessages: Message[] = [];
    let callCount = 0;

    const provider = {
      async complete(req: { messages: Message[] }) {
        capturedMessages.push(...req.messages.slice(-1));
        callCount++;
        if (callCount <= 3) {
          return fauxToolCall("echo", { n: callCount });
        }
        return fauxText("done");
      },
    };

    const spec: AgentRunSpec = {
      provider,
      messages: makeMessages("start"),
      model: "test",
      tools: [DUMMY_TOOL],
      maxIterations: 200, // High cap
      executeTools: async (calls) =>
        calls.map((c) => ({ callId: c.callId, name: c.name, content: "ok" })),
    };

    await collectAll(agentLoop(spec));

    // At 3/200 iterations (1.5%), no pressure should be injected
    const hasPressure = capturedMessages.some((m) => {
      const c = m.content;
      if (typeof c === "string") return c.includes("making progress") || c.includes("safety limit");
      return false;
    });
    expect(hasPressure).toBe(false);
  });
});

// ── Silent tool events through agent loop ────────────────────────────────────

describe("Silent tools in agent loop", () => {
  it("memory_search tool_start event has silent=true", async () => {
    const { agentLoop } = await import("../../src/agent/loop.js");

    const events: AgentEvent[] = [];
    let callCount = 0;

    const provider = {
      async complete() {
        callCount++;
        if (callCount === 1) {
          return fauxToolCall("memory_search", { query: "test" });
        }
        return fauxText("found something");
      },
    };

    const spec: AgentRunSpec = {
      provider,
      messages: makeMessages("what do you remember"),
      model: "test",
      tools: [{ name: "memory_search", description: "search", input_schema: { type: "object" as const } }],
      executeTools: async (calls) =>
        calls.map((c) => ({ callId: c.callId, name: c.name, content: '{"results":[]}' })),
    };

    const gen = agentLoop(spec);
    let result: IteratorResult<AgentEvent, AgentResult>;
    do {
      result = await gen.next();
      if (!result.done) events.push(result.value);
    } while (!result.done);

    const toolStartEvents = events.filter((e) => e.type === "tool_start");
    expect(toolStartEvents.length).toBeGreaterThan(0);
    expect((toolStartEvents[0] as { silent?: boolean }).silent).toBe(true);
  });

  it("bash tool_start event has silent=false/undefined", async () => {
    const { agentLoop } = await import("../../src/agent/loop.js");

    const events: AgentEvent[] = [];
    let callCount = 0;

    const provider = {
      async complete() {
        callCount++;
        if (callCount === 1) {
          return fauxToolCall("bash", { command: "ls" });
        }
        return fauxText("files listed");
      },
    };

    const spec: AgentRunSpec = {
      provider,
      messages: makeMessages("list files"),
      model: "test",
      tools: [{ name: "bash", description: "run", input_schema: { type: "object" as const } }],
      executeTools: async (calls) =>
        calls.map((c) => ({ callId: c.callId, name: c.name, content: "file1.txt" })),
    };

    const gen = agentLoop(spec);
    let result: IteratorResult<AgentEvent, AgentResult>;
    do {
      result = await gen.next();
      if (!result.done) events.push(result.value);
    } while (!result.done);

    const toolStartEvents = events.filter((e) => e.type === "tool_start");
    expect(toolStartEvents.length).toBeGreaterThan(0);
    expect((toolStartEvents[0] as { silent?: boolean }).silent).toBe(false);
  });
});

// ── AbortController lifecycle ────────────────────────────────────────────────

describe("AbortController per-chat lifecycle", () => {
  it("multiple controllers are independent", () => {
    const c1 = new AbortController();
    const c2 = new AbortController();

    c1.abort();
    expect(c1.signal.aborted).toBe(true);
    expect(c2.signal.aborted).toBe(false); // Independent
  });

  it("aborting does not throw", () => {
    const controller = new AbortController();
    expect(() => controller.abort()).not.toThrow();
    expect(() => controller.abort()).not.toThrow(); // Double abort is safe
  });

  it("Map-based controller storage works correctly", () => {
    const controllers = new Map<number, AbortController>();

    const c1 = new AbortController();
    controllers.set(123, c1);

    // New message arrives for same chat, abort existing
    const existing = controllers.get(123);
    existing?.abort();

    expect(c1.signal.aborted).toBe(true);

    // Replace with new controller
    const c2 = new AbortController();
    controllers.set(123, c2);
    expect(c2.signal.aborted).toBe(false);

    // Cleanup
    controllers.delete(123);
    expect(controllers.size).toBe(0);
  });
});

// ── Effort now floors on her taking the work, not on grading his sentence ────

describe("Effort — the floor is hers to earn, the tiers are still the three", () => {
  it("floorFromTaking maps taking to medium and everything else to simple", async () => {
    const { floorFromTaking } = await import("../../src/agent/effort-scaling.js");
    expect(floorFromTaking(true)).toBe("medium");
    expect(floorFromTaking(false)).toBe("simple");
  });

  it("effort tiers are one of three valid values end to end", async () => {
    const { floorFromTaking, depthFromHer } = await import("../../src/agent/effort-scaling.js");
    const { createStream } = await import("../../src/life/soft-choice.js");
    const s = createStream(1);
    const tier = depthFromHer({ stirred: false, reserve: 0.5, aliveness: 0.5 }, floorFromTaking(false), () => s.next());
    expect(["simple", "medium", "complex"]).toContain(tier);
  });
});
