// E2E full-flow integration tests: exercises the agent loop end-to-end
// with real modules. No real API calls; uses faux provider exclusively.

import { describe, it, expect } from "vitest";
import { agentLoop } from "../../src/agent/loop.js";
import type { AgentRunSpec, AgentEvent, AgentResult } from "../../src/agent/types.js";
import { createFauxProvider, fauxText, fauxToolCall } from "../../src/providers/faux.js";
import type { Message, ToolDefinition } from "../../src/providers/types.js";
import { governMessages } from "../../src/agent/governance.js";
import { createCostGuardLayer } from "../../src/providers/cost-guard.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function collectAll(
  gen: AsyncGenerator<AgentEvent, AgentResult>
): Promise<{ events: AgentEvent[]; result: AgentResult }> {
  const events: AgentEvent[] = [];
  let next = await gen.next();
  while (!next.done) {
    events.push(next.value as AgentEvent);
    next = await gen.next();
  }
  return { events, result: next.value as AgentResult };
}

function makeMessages(text: string): Message[] {
  return [{ role: "user", content: text }];
}

const ECHO_TOOL: ToolDefinition = {
  name: "echo",
  description: "Echoes a message",
  input_schema: { type: "object", properties: { msg: { type: "string" } } },
};

// ── AC1: Simple chat, faux provider delivers a response ──────────────────────

describe("full-flow: simple chat", () => {
  it("a mock message 'What is 2+2?' gets a text response through the pipeline", async () => {
    const provider = createFauxProvider({
      responses: [
        { pattern: "What is 2+2", text: "The answer is 4." },
      ],
      defaultResponse: "I don't know",
    });

    const spec: AgentRunSpec = {
      provider,
      messages: makeMessages("What is 2+2?"),
      model: "faux-claude",
    };

    const { events, result } = await collectAll(agentLoop(spec));

    const textChunks = events.filter((e) => e.type === "text_chunk");
    expect(textChunks.length).toBeGreaterThan(0);

    const firstChunk = textChunks[0] as { type: "text_chunk"; content: string };
    expect(firstChunk.content).toContain("4");

    expect(result.finishReason).toBe("stop");
    expect(result.content).toContain("4");
    expect(result.iterations).toBe(1);
  });

  it("response is delivered with correct content and not empty", async () => {
    const provider = createFauxProvider({
      responses: [
        { pattern: "hello", text: "Hello there, how can I help?" },
      ],
    });

    const { result } = await collectAll(
      agentLoop({
        provider,
        messages: makeMessages("hello"),
        model: "faux-claude",
      })
    );

    expect(result.content).toBe("Hello there, how can I help?");
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });
});

// ── AC2: Multi-step tool usage ────────────────────────────────────────────────

describe("full-flow: multi-step tool usage", () => {
  it("tool call followed by text response produces correct event sequence", async () => {
    let callCount = 0;
    const provider = {
      async complete(req: import("../../src/providers/types.js").LLMRequest) {
        callCount++;
        if (callCount === 1) {
          return createFauxProvider({
            responses: [fauxToolCall("echo", { msg: "step 1" })],
          }).complete(req);
        }
        return createFauxProvider({
          responses: [fauxText("All steps complete.")],
        }).complete(req);
      },
    };

    const results: string[] = [];
    const spec: AgentRunSpec = {
      provider,
      messages: makeMessages("run a multi-step task"),
      model: "faux-claude",
      tools: [ECHO_TOOL],
      executeTools: async (calls) => {
        return calls.map((c) => {
          results.push((c.args as { msg: string }).msg);
          return { callId: c.callId, name: c.name, content: `echoed: ${(c.args as { msg: string }).msg}` };
        });
      },
    };

    const { events, result } = await collectAll(agentLoop(spec));

    expect(events.some((e) => e.type === "tool_start")).toBe(true);
    expect(events.some((e) => e.type === "tool_end")).toBe(true);
    expect(events.some((e) => e.type === "text_chunk")).toBe(true);
    expect(result.content).toBe("All steps complete.");
    expect(results).toContain("step 1");
  });

  it("tool_end event carries the tool execution result", async () => {
    let callCount = 0;
    const provider = {
      async complete(req: import("../../src/providers/types.js").LLMRequest) {
        callCount++;
        if (callCount === 1) {
          return createFauxProvider({
            responses: [fauxToolCall("echo", { msg: "hello" })],
          }).complete(req);
        }
        return createFauxProvider({ responses: [fauxText("done")] }).complete(req);
      },
    };

    const { events } = await collectAll(
      agentLoop({
        provider,
        messages: makeMessages("run tool"),
        model: "faux-claude",
        tools: [ECHO_TOOL],
        executeTools: async (calls) =>
          calls.map((c) => ({ callId: c.callId, name: c.name, content: "tool-result-content" })),
      })
    );

    const toolEnd = events.find((e) => e.type === "tool_end") as
      | { type: "tool_end"; tool: string; result: string; callId: string }
      | undefined;

    expect(toolEnd).toBeDefined();
    expect(toolEnd!.result).toBe("tool-result-content");
    expect(toolEnd!.tool).toBe("echo");
  });
});

// ── AC3: Model switch via command ─────────────────────────────────────────────

describe("full-flow: model switch", () => {
  it("model switch logic forwards correct model to provider after /opus command", async () => {
    // Simulate a Telegram /opus command: switch the model string and confirm
    let usedModel: string | undefined;

    const provider = {
      async complete(req: import("../../src/providers/types.js").LLMRequest) {
        usedModel = req.model;
        return createFauxProvider({
          responses: [fauxText("Switched to opus. I'll use the more capable model now.")],
        }).complete(req);
      },
    };

    // Simulate the model switch: caller picks a new model name based on /opus command
    const selectedModel = "claude-opus-4-5-20251001";

    const spec: AgentRunSpec = {
      provider,
      messages: makeMessages("Use opus to help me"),
      model: selectedModel,
    };

    const { result } = await collectAll(agentLoop(spec));

    expect(usedModel).toBe("claude-opus-4-5-20251001");
    expect(result.content).toContain("opus");
    expect(result.finishReason).toBe("stop");
  });

  it("switching from default model to sonnet changes model field in request", async () => {
    const capturedModels: string[] = [];

    const provider = {
      async complete(req: import("../../src/providers/types.js").LLMRequest) {
        capturedModels.push(req.model);
        return createFauxProvider({ responses: [fauxText("Confirmed.")]}).complete(req);
      },
    };

    await collectAll(
      agentLoop({
        provider,
        messages: makeMessages("hello"),
        model: "claude-sonnet-4-5-20251001",
      })
    );

    expect(capturedModels[0]).toBe("claude-sonnet-4-5-20251001");
  });
});

// ── AC4: What reaches him at the step wall ───────────────────────────────────

describe("full-flow: the step wall adds nothing in her voice, and her last step is hers to speak", () => {
  // Until 2026-09-28 the wall appended a first-person progress report to whatever she had said,
  // and a turn that said nothing got a backstop line under her name. Now the last step is
  // hands-free (no tools offered, and she is told so as a fact), what she says there goes out,
  // and when nothing of hers comes back the content is empty for the daemon's machine notice.
  function wallRun(opts: { taskType?: string; wordsBesideCalls?: boolean; lastStepWords?: string } = {}) {
    let iteration = 0;
    const requests: Array<import("../../src/providers/types.js").LLMRequest> = [];
    const bumps: Array<[number, number]> = [];
    const provider = {
      async complete(req: import("../../src/providers/types.js").LLMRequest) {
        iteration++;
        // A copy: the loop keeps appending to the same array after the call returns.
        requests.push({ ...req, messages: [...req.messages] });
        if (!req.tools && opts.lastStepWords) {
          return createFauxProvider({ responses: [fauxText(opts.lastStepWords)] }).complete(req);
        }
        const response = await createFauxProvider({ responses: [fauxToolCall("echo", { step: iteration })] }).complete(req);
        return opts.wordsBesideCalls
          ? { ...response, content: [{ type: "text" as const, text: "我翻到第三页了。" }, ...response.content] }
          : response;
      },
    };
    return collectAll(
      agentLoop({
        provider,
        messages: makeMessages("run 10 tasks"),
        model: "faux-claude",
        tools: [ECHO_TOOL],
        maxIterations: 8,
        onBudgetPressure: (iteration: number, max: number) => { bumps.push([iteration, max]); },
        ...(opts.taskType ? { taskType: opts.taskType } : {}),
        executeTools: async (calls) =>
          calls.map((c) => ({ callId: c.callId, name: c.name, content: "ok" })),
      })
    ).then((r) => ({ ...r, requests, bumps }));
  }

  it("the last step offers no tools and tells her so, as a fact", async () => {
    const { requests, result } = await wallRun({ lastStepWords: "今天就看到这儿。" });
    expect(result.finishReason).toBe("max_iterations");
    expect(requests).toHaveLength(8);
    expect(requests.slice(0, 7).every((r) => Array.isArray(r.tools) && r.tools.length > 0)).toBe(true);
    expect(requests[7]!.tools).toBeUndefined();
    const lastMsg = requests[7]!.messages[requests[7]!.messages.length - 1]!;
    expect(typeof lastMsg.content === "string" && lastMsg.content).toContain("这是这一轮的最后一步，手够不着东西了。");
    expect(String(lastMsg.content).startsWith("<<<这是机器的话，不是他说的>>>")).toBe(true);
    // Her last words are what goes out, with nothing appended.
    expect(result.content).toBe("今天就看到这儿。");
  });

  it("reaching the hands-free step still counts as reaching the wall for the weekly census", async () => {
    const { bumps } = await wallRun({ lastStepWords: "今天就看到这儿。" });
    expect(bumps).toContainEqual([8, 8]);
  });

  it("a turn with him that said nothing leaves the content empty: no line in her voice", async () => {
    const { result } = await wallRun();
    expect(result.finishReason).toBe("max_iterations");
    expect(result.content).toBe("");
  });

  it("her own exploration that said nothing keeps the nothing", async () => {
    const { result } = await wallRun({ taskType: "exploration" });
    expect(result.finishReason).toBe("max_iterations");
    expect(result.content).toBe("");
  });

  it("what she did say goes out exactly, with nothing appended", async () => {
    const { result } = await wallRun({ wordsBesideCalls: true });
    expect(result.finishReason).toBe("max_iterations");
    expect(result.content).toBe("我翻到第三页了。");
  });
});

// ── AC5: Governance wires into loop ──────────────────────────────────────────

describe("full-flow: governance pipeline integration", () => {
  it("govern() is called before each LLM call and may trim messages", async () => {
    let governCallCount = 0;
    const provider = createFauxProvider({
      responses: [fauxText("Governance applied.")],
    });

    const { result } = await collectAll(
      agentLoop({
        provider,
        messages: makeMessages("test governance"),
        model: "faux-claude",
        govern(msgs) {
          governCallCount++;
          return msgs;
        },
      })
    );

    expect(governCallCount).toBeGreaterThan(0);
    expect(result.finishReason).toBe("stop");
  });

  it("governMessages pipeline composes all steps without throwing on clean input", () => {
    const messages: Message[] = [
      { role: "user", content: "tell me something" },
      { role: "assistant", content: "Here is a thing." },
      { role: "user", content: "and more" },
    ];

    const governed = governMessages(messages);
    expect(governed.length).toBeGreaterThan(0);
    expect(governed[governed.length - 1].role).toBe("user");
  });
});

// ── AC6: Cost guard integration through CostGuardLayer ───────────────────────

describe("full-flow: cost guard integration", () => {
  it("cost guard layer wraps provider and accumulates spent cents", async () => {
    const costGuard = createCostGuardLayer({ dailyBudgetCents: 1000 });

    const fauxProvider = createFauxProvider({
      responses: [fauxText("response from behind cost guard")],
    });

    // Use cost guard layer directly
    let callCount = 0;
    const response = await costGuard.call(
      { model: "faux-claude", messages: [{ role: "user", content: "hello" }], maxTokens: 100 },
      async (req) => {
        callCount++;
        return fauxProvider.complete(req);
      }
    );

    expect(callCount).toBe(1);
    expect(response.content[0]).toBeDefined();
    expect(costGuard.getDailySpentCents()).toBeGreaterThanOrEqual(0);
  });

  it("cost guard throws CostLimitExceeded when budget is zero and spending occurs", async () => {
    const { CostLimitExceeded } = await import("../../src/providers/cost-guard.js");

    const costGuard = createCostGuardLayer({ dailyBudgetCents: 0 });

    const fauxProvider = createFauxProvider({
      responses: [fauxText("should not reach")],
    });

    await expect(
      costGuard.call(
        { model: "faux-claude", messages: [{ role: "user", content: "hello" }], maxTokens: 100 },
        async (req) => fauxProvider.complete(req)
      )
    ).rejects.toBeInstanceOf(CostLimitExceeded);
  });
});

// ── AC7: Max iterations returns correct finish reason ─────────────────────────

describe("full-flow: max iterations boundary", () => {
  it("agentLoop returns max_iterations when tool calls exhaust the iteration budget", async () => {
    const provider = {
      async complete(req: import("../../src/providers/types.js").LLMRequest) {
        return createFauxProvider({
          responses: [fauxToolCall("echo", { n: 1 })],
        }).complete(req);
      },
    };

    const { result } = await collectAll(
      agentLoop({
        provider,
        messages: makeMessages("run forever"),
        model: "faux-claude",
        tools: [ECHO_TOOL],
        maxIterations: 5,
        executeTools: async (calls) =>
          calls.map((c) => ({ callId: c.callId, name: c.name, content: "ok" })),
      })
    );

    expect(result.finishReason).toBe("max_iterations");
    expect(result.iterations).toBe(5);
  });
});
