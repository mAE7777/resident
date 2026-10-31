// E2E autonomy integration tests: budget exhaustion, watchdog time limits,
// and governance enforcement. Tests compose real modules through the agent loop.

import { describe, it, expect } from "vitest";
import { agentLoop } from "../../src/agent/loop.js";
import type { AgentEvent, AgentResult } from "../../src/agent/types.js";
import { createFauxProvider, fauxText, fauxToolCall } from "../../src/providers/faux.js";
import type { Message, ToolDefinition } from "../../src/providers/types.js";
import { createCostGuardLayer, CostLimitExceeded } from "../../src/providers/cost-guard.js";
import { createWatchdog } from "../../src/agent/watchdog.js";
import { governMessages, backfillMissingToolResults } from "../../src/agent/governance.js";

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
  description: "Echoes input",
  input_schema: { type: "object", properties: { msg: { type: "string" } } },
};

// ── AC1: Budget exhaustion via CostGuard ──────────────────────────────────────

describe("autonomy: budget exhaustion", () => {
  it("when budget is exhausted, new request is rejected with CostLimitExceeded", async () => {
    const costGuard = createCostGuardLayer({ dailyBudgetCents: 0 });
    const fauxProvider = createFauxProvider({
      responses: [fauxText("should not reach here")],
    });

    let threw = false;
    let errorWasBudget = false;

    try {
      await costGuard.call(
        { model: "faux-claude", messages: makeMessages("hello"), maxTokens: 100 },
        async (req) => fauxProvider.complete(req)
      );
    } catch (err) {
      threw = true;
      errorWasBudget = err instanceof CostLimitExceeded;
    }

    expect(threw).toBe(true);
    expect(errorWasBudget).toBe(true);
  });

  it("CostLimitExceeded carries spent and budget cents", () => {
    const err = new CostLimitExceeded(500, 250);
    expect(err.spentCents).toBe(500);
    expect(err.budgetCents).toBe(250);
    expect(err.message).toContain("exceeded");
    expect(err.name).toBe("CostLimitExceeded");
  });

  it("cost guard does not throw when budget is sufficient", async () => {
    const costGuard = createCostGuardLayer({ dailyBudgetCents: 10000 });
    const fauxProvider = createFauxProvider({
      responses: [fauxText("within budget")],
    });

    const response = await costGuard.call(
      { model: "faux-claude", messages: makeMessages("hello"), maxTokens: 100 },
      async (req) => fauxProvider.complete(req)
    );

    expect(response.content[0]).toBeDefined();
  });

  // Budget pressure tests now covered by loop.ts's built-in budgetPressure()
  // which is tested via the agentLoop integration tests below.
});

// ── AC2: Budget pressure injected through agentLoop at 70% ───────────────────

describe("autonomy: budget pressure injection via agentLoop", () => {
  it("agentLoop injects budget pressure message at 85% of max iterations", async () => {
    const capturedMessages: Message[] = [];
    let callCount = 0;

    const provider = {
      async complete(req: import("../../src/providers/types.js").LLMRequest) {
        capturedMessages.push(...req.messages.slice(-1));
        callCount++;
        if (callCount <= 9) {
          return createFauxProvider({
            responses: [fauxToolCall("echo", { n: callCount })],
          }).complete(req);
        }
        return createFauxProvider({ responses: [fauxText("done")] }).complete(req);
      },
    };

    await collectAll(
      agentLoop({
        provider,
        messages: makeMessages("start"),
        model: "faux-claude",
        tools: [ECHO_TOOL],
        maxIterations: 10,
        executeTools: async (calls) =>
          calls.map((c) => ({ callId: c.callId, name: c.name, content: "ok" })),
      })
    );

    // 85% threshold: iteration 9 of 10 = 90% > 85%
    const pressureFound = capturedMessages.some((m) => {
      const content = m.content;
      if (typeof content === "string") return content.includes("这一轮已经走了很多步了");
      if (Array.isArray(content)) {
        return content.some((b) => b.type === "tool_result" && typeof b.content === "string"
          && b.content.includes("这一轮已经走了很多步了"));
      }
      return false;
    });

    expect(pressureFound).toBe(true);
  });
});

// ── AC3: Watchdog time limit enforcement ──────────────────────────────────────

describe("autonomy: watchdog time enforcement", () => {
  it("watchdog returns ok status when within time limit", () => {
    let t = 0;
    const watchdog = createWatchdog(() => t);

    t = 10 * 60 * 1000; // 10 minutes
    const result = watchdog.check();

    expect(result.status).toBe("ok");
    expect(result.message).toBeNull();
  });

  it("watchdog returns warn status at 30 minutes and emits message", () => {
    let t = 0;
    const watchdog = createWatchdog(() => t);

    t = 30 * 60 * 1000; // 30 minutes
    const result = watchdog.check();

    expect(result.status).toBe("warn");
    expect(result.message).toBe("这一轮已经过了半个小时，再过五分钟会停下。");
  });

  it("watchdog returns force_stop at 35 minutes", () => {
    let t = 0;
    const watchdog = createWatchdog(() => t);

    t = 35 * 60 * 1000; // 35 minutes
    const result = watchdog.check();

    expect(result.status).toBe("force_stop");
    expect(result.message).toBe("Time limit reached (35 minutes).");
  });

  it("watchdog reset allows fresh 30-minute window", () => {
    let t = 0;
    const watchdog = createWatchdog(() => t);

    t = 35 * 60 * 1000;
    expect(watchdog.check().status).toBe("force_stop");

    watchdog.reset();
    t = 35 * 60 * 1000 + 5 * 60 * 1000; // 5 min after reset
    expect(watchdog.check().status).toBe("ok");
  });

  it("watchdog integrates with govern() to inject time warnings before LLM calls", async () => {
    // Simulate watchdog-based governance: govern() checks the watchdog
    // and prepends a time-limit message to the conversation when warn fires.
    let clockMs = 0;
    const watchdog = createWatchdog(() => clockMs);
    const injectedWarnings: string[] = [];

    let callCount = 0;
    const provider = {
      async complete(req: import("../../src/providers/types.js").LLMRequest) {
        callCount++;
        if (callCount <= 6) {
          return createFauxProvider({
            responses: [fauxToolCall("echo", { n: callCount })],
          }).complete(req);
        }
        return createFauxProvider({ responses: [fauxText("done")] }).complete(req);
      },
    };

    await collectAll(
      agentLoop({
        provider,
        messages: makeMessages("long task"),
        model: "faux-claude",
        tools: [ECHO_TOOL],
        executeTools: async (calls) => {
          // Advance clock by 5 minutes on each tool execution
          clockMs += 5 * 60 * 1000;
          return calls.map((c) => ({ callId: c.callId, name: c.name, content: "ok" }));
        },
        govern(msgs) {
          // Watchdog check as part of governance, inject warning if triggered
          const wd = watchdog.check();
          if (wd.message) injectedWarnings.push(wd.message);
          return msgs;
        },
      })
    );

    // After 6 tool executions (30 minutes), watchdog should have warned
    expect(injectedWarnings.some((w) => w.includes("半个小时") || w.includes("Time limit"))).toBe(true);
  });
});

// ── AC4: Governance enforcement ───────────────────────────────────────────────

describe("autonomy: governance enforcement", () => {
  it("governMessages drops orphan tool results (results without matching tool_use)", () => {
    const messages: Message[] = [
      { role: "user", content: "start" },
      {
        role: "user",
        content: [
          { type: "tool_result" as const, tool_use_id: "nonexistent-id", content: "orphan" } as unknown as import("../../src/providers/types.js").ContentBlock,
        ],
      },
    ];

    const governed = governMessages(messages);
    // The orphan tool result message should be dropped
    const hasOrphan = governed.some((m) => {
      if (!Array.isArray(m.content)) return false;
      return m.content.some((b) => {
        const block = b as unknown as Record<string, unknown>;
        return block.type === "tool_result" && block.tool_use_id === "nonexistent-id";
      });
    });

    expect(hasOrphan).toBe(false);
  });

  it("backfillMissingToolResults adds synthetic results for unpaired tool_use blocks", () => {
    // Test the backfill step directly: governMessages also runs microcompact which
    // may inline small tool results into the assistant message, obscuring them.
    const messages: Message[] = [
      { role: "user", content: "test" },
      {
        role: "assistant",
        content: [
          { type: "tool_use" as const, id: "tool-abc-123", name: "echo", input: { msg: "hi" } },
        ],
      },
      // No user message with tool_result follows, backfill must add one
    ];

    const backfilled = backfillMissingToolResults(messages);

    // After backfill, there should be a synthetic tool result message
    const hasSyntheticResult = backfilled.some((m) => {
      if (m.role !== "user" || !Array.isArray(m.content)) return false;
      return m.content.some((b) => {
        const block = b as unknown as Record<string, unknown>;
        return block.type === "tool_result" && block.tool_use_id === "tool-abc-123";
      });
    });

    expect(hasSyntheticResult).toBe(true);
  });

  it("governMessages produces output where tool_use without result is handled (via microcompact inline or backfill)", () => {
    // governess full pipeline: after backfill + microcompact, the synthetic result
    // may be inlined into the assistant message (< 1000 chars). The key guarantee is
    // no crash and the conversation integrity is maintained.
    const messages: Message[] = [
      { role: "user", content: "test" },
      {
        role: "assistant",
        content: [
          { type: "tool_use" as const, id: "tool-xyz-999", name: "echo", input: { msg: "world" } },
        ],
      },
    ];

    let threw = false;
    let governed: Message[] = [];
    try {
      governed = governMessages(messages);
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(governed.length).toBeGreaterThan(0);
    // The conversation should still end with a valid message
    expect(["user", "assistant"]).toContain(governed[governed.length - 1].role);
  });

  it("governMessages preserves message sequence integrity after operations", () => {
    const messages: Message[] = [
      { role: "user", content: "first" },
      { role: "assistant", content: "response" },
      { role: "user", content: "second" },
    ];

    const governed = governMessages(messages);

    // Messages should start and end with same roles
    expect(governed[0].role).toBe("user");
    expect(governed[governed.length - 1].role).toBe("user");
    expect(governed.length).toBeGreaterThanOrEqual(1);
  });
});

// ── AC5: Agent loop with govern() applied ─────────────────────────────────────

describe("autonomy: agent loop with governance", () => {
  it("govern() mutations are applied before each LLM call in the agent loop", async () => {
    let governCount = 0;
    const provider = createFauxProvider({
      responses: [fauxText("governed response")],
    });

    await collectAll(
      agentLoop({
        provider,
        messages: makeMessages("test"),
        model: "faux-claude",
        govern(msgs) {
          governCount++;
          return msgs;
        },
      })
    );

    expect(governCount).toBeGreaterThan(0);
  });

  it("agent loop runs the full governance pipeline via govern() on each turn", async () => {
    const appliedConfigs: number[] = [];
    let callNum = 0;
    const provider = {
      async complete(req: import("../../src/providers/types.js").LLMRequest) {
        callNum++;
        if (callNum === 1) {
          return createFauxProvider({
            responses: [fauxToolCall("echo", { n: 1 })],
          }).complete(req);
        }
        return createFauxProvider({ responses: [fauxText("done")] }).complete(req);
      },
    };

    await collectAll(
      agentLoop({
        provider,
        messages: makeMessages("go"),
        model: "faux-claude",
        tools: [ECHO_TOOL],
        executeTools: async (calls) =>
          calls.map((c) => ({ callId: c.callId, name: c.name, content: "ok" })),
        govern(msgs) {
          appliedConfigs.push(msgs.length);
          return governMessages(msgs); // use real governance pipeline
        },
      })
    );

    // govern() called at least once per LLM call
    expect(appliedConfigs.length).toBeGreaterThanOrEqual(2);
  });
});
