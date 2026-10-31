import { describe, it, expect, vi } from "vitest";
import { createToolRegistry } from "../../../src/tools/registry.js";
import { createToolExecutor } from "../../../src/tools/executor.js";
import type { ToolDef } from "../../../src/tools/registry.js";
import { classifyOperationRisk } from "../../../src/security/operation-risk.js";

function makeEchoTool(name: string): ToolDef {
  return {
    name,
    description: name,
    inputSchema: { type: "object" },
    executionMode: "parallel" as const,
    execute: async () => `${name} executed`,
  };
}

// ── The four-level trust ladder is GONE ───────────────────────────────────────
// The former level-0 "ask-first" valve was the trust ladder's ONLY live effect. Removing it
// means a tool call is governed by the home wall + the two unconditional action-danger checks
// (advisory, rule-of-two), never by a trust rating. ToolExecutorConfig no longer carries a trust
// level at all; a call runs or is refused on danger alone, identically for every caller.
describe("executor — the trust ladder no longer intercepts", () => {
  it("a former level-0 config no longer turns every call into ask-first; the tool runs", async () => {
    const registry = createToolRegistry();
    const executeSpy = vi.fn(async () => "ran");
    registry.register({
      name: "read",
      description: "read",
      inputSchema: { type: "object" },
      executionMode: "parallel" as const,
      execute: executeSpy,
    });

    const executor = createToolExecutor(registry, {});
    const results = await executor.executeBatch([{ callId: "1", name: "read", args: {} }]);

    expect(results[0].content).not.toContain("先问一声");
    expect(executeSpy).toHaveBeenCalled();
  });
});

// ── Rule of Two: the unconditional block for untrusted + sensitive + state-change ─
describe("executor — rule of two, and trusted builtins that proceed", () => {
  it("R2 block fires when all three properties are true (untrusted+sensitive+stateChange)", async () => {
    const registry = createToolRegistry();
    registry.register(makeEchoTool("risky_tool"));

    const executor = createToolExecutor(registry, {
      ruleOfTwo: () => ({ isUntrusted: true, isSensitive: true, isStateChange: true }),
    });

    const results = await executor.executeBatch([
      { callId: "1", name: "risky_tool", args: {} },
    ]);

    expect(results[0].isError).toBe(true);
    expect(results[0].isError, "the guard did not refuse").toBe(true);
  });

  it("trusted tool with confirm decision proceeds without gate", async () => {
    const registry = createToolRegistry();
    registry.register(makeEchoTool("trusted_tool"));

    // isSensitive+isStateChange with isUntrusted=false → "confirm" decision, no approval gate
    const executor = createToolExecutor(registry, {
      ruleOfTwo: () => ({ isUntrusted: false, isSensitive: true, isStateChange: true }),
      approvalStore: { check: () => null },
    });

    const results = await executor.executeBatch([
      { callId: "1", name: "trusted_tool", args: {} },
    ]);

    expect(results[0].isError).toBeFalsy();
    expect(results[0].content).toBe("trusted_tool executed");
  });

  it("safe tool (auto decision) executes without approval", async () => {
    const registry = createToolRegistry();
    registry.register(makeEchoTool("safe_tool"));

    const executor = createToolExecutor(registry, {
      ruleOfTwo: () => ({ isUntrusted: false, isSensitive: false, isStateChange: false }),
    });

    const results = await executor.executeBatch([
      { callId: "1", name: "safe_tool", args: {} },
    ]);

    expect(results[0].isError).toBeFalsy();
    expect(results[0].content).toBe("safe_tool executed");
  });

  it("cron list stays read-only through Rule-of-Two", async () => {
    const registry = createToolRegistry();
    registry.register(makeEchoTool("cron"));

    const executor = createToolExecutor(registry, {
      ruleOfTwo: (call) => {
        const risk = classifyOperationRisk(call.name, call.args);
        return { isUntrusted: false, isSensitive: risk.isSensitive, isStateChange: risk.isStateChange };
      },
    });

    const results = await executor.executeBatch([
      { callId: "1", name: "cron", args: { action: "list" } },
    ]);

    expect(results[0].isError).toBeFalsy();
    expect(results[0].content).toBe("cron executed");
  });

  it("trusted artifact downloads proceed as ordinary workspace mutations", async () => {
    const registry = createToolRegistry();
    registry.register(makeEchoTool("artifact_fetch"));

    const executor = createToolExecutor(registry, {
      ruleOfTwo: (call) => {
        const risk = classifyOperationRisk(call.name, call.args);
        return { isUntrusted: false, isSensitive: risk.isSensitive, isStateChange: risk.isStateChange };
      },
    });

    const results = await executor.executeBatch([
      { callId: "1", name: "artifact_fetch", args: { source: "https://example.com/file.zip" } },
    ]);

    expect(results[0].isError).toBeFalsy();
    expect(results[0].content).toBe("artifact_fetch executed");
  });

  it("owner-bound messages are not hard-blocked as sensitive untrusted operations", async () => {
    const registry = createToolRegistry();
    registry.register(makeEchoTool("message"));

    const executor = createToolExecutor(registry, {
      ruleOfTwo: (call) => {
        const risk = classifyOperationRisk(call.name, call.args);
        return { isUntrusted: false, isSensitive: risk.isSensitive, isStateChange: risk.isStateChange };
      },
    });

    const results = await executor.executeBatch([
      { callId: "1", name: "message", args: { text: "done" } },
    ]);

    expect(results[0].isError).toBeFalsy();
    expect(results[0].content).toBe("message executed");
  });

  it("cron mutations ask for confirm internally but proceed for trusted builtins", async () => {
    const registry = createToolRegistry();
    registry.register(makeEchoTool("cron"));

    const executor = createToolExecutor(registry, {
      ruleOfTwo: (call) => {
        const risk = classifyOperationRisk(call.name, call.args);
        return { isUntrusted: false, isSensitive: risk.isSensitive, isStateChange: risk.isStateChange };
      },
    });

    const results = await executor.executeBatch([
      { callId: "1", name: "cron", args: { action: "add", name: "retry", message: "try again" } },
    ]);

    expect(results[0].isError).toBeFalsy();
    expect(results[0].content).toBe("cron executed");
  });

  it("connect_mcp proposal flow is not blocked before the tool can record a review item", async () => {
    const registry = createToolRegistry();
    registry.register(makeEchoTool("connect_mcp"));

    const executor = createToolExecutor(registry, {
      ruleOfTwo: (call) => {
        const risk = classifyOperationRisk(call.name, call.args);
        return { isUntrusted: false, isSensitive: risk.isSensitive, isStateChange: risk.isStateChange };
      },
    });

    const results = await executor.executeBatch([
      { callId: "1", name: "connect_mcp", args: { id: "browser", transport: "stdio", command: "npx", args: ["@example/mcp"] } },
    ]);

    expect(results[0].isError).toBeFalsy();
    expect(results[0].content).toBe("connect_mcp executed");
  });

  it("undo list stays read-only through Rule-of-Two", async () => {
    const registry = createToolRegistry();
    registry.register(makeEchoTool("undo"));

    const executor = createToolExecutor(registry, {
      ruleOfTwo: (call) => {
        const risk = classifyOperationRisk(call.name, call.args);
        return { isUntrusted: false, isSensitive: risk.isSensitive, isStateChange: risk.isStateChange };
      },
    });

    const results = await executor.executeBatch([
      { callId: "1", name: "undo", args: { action: "list" } },
    ]);

    expect(results[0].isError).toBeFalsy();
    expect(results[0].content).toBe("undo executed");
  });
});

// ── Untrusted side effects stay guarded regardless ────────────────────────────
describe("executor — untrusted side effects are never a free pass", () => {
  it("untrusted MCP tool is still blocked when all Rule-of-Two risks are true", async () => {
    const registry = createToolRegistry();
    registry.register(makeEchoTool("mcp_myserver_do_thing"));

    const approvalStore = { check: vi.fn(() => null as "allow" | "deny" | null) };

    const executor = createToolExecutor(registry, {
      ruleOfTwo: () => ({ isUntrusted: true, isSensitive: true, isStateChange: true }),
      approvalStore,
    });

    const results = await executor.executeBatch([
      { callId: "1", name: "mcp_myserver_do_thing", args: {} },
    ]);

    expect(results[0].isError).toBe(true);
    expect(results[0].isError, "the guard did not refuse").toBe(true);
    // Hard blocks do not consult approval store.
    expect(approvalStore.check).not.toHaveBeenCalled();
  });

  it("trusted risky tool proceeds under rule of two (confirm, not block)", async () => {
    const registry = createToolRegistry();
    registry.register(makeEchoTool("trusted_risky"));

    const executor = createToolExecutor(registry, {
      ruleOfTwo: () => ({ isUntrusted: false, isSensitive: true, isStateChange: true }),
    });

    // isSensitive+isStateChange, isUntrusted=false → "confirm" → proceeds (no gate since trusted)
    const results = await executor.executeBatch([
      { callId: "1", name: "trusted_risky", args: {} },
    ]);

    expect(results[0].isError).toBeFalsy();
    expect(results[0].content).toBe("trusted_risky executed");
  });

  it("advisory HARD_BLOCK refuses an untrusted call", async () => {
    const registry = createToolRegistry();
    registry.register(makeEchoTool("dangerous_tool"));

    const executor = createToolExecutor(registry, {
      advisory: () => ({ outcome: "HARD_BLOCK" as const, tier: 3 as const, reason: "explicitly blocked" }),
    });

    const results = await executor.executeBatch([
      { callId: "1", name: "dangerous_tool", args: {} },
    ]);

    expect(results[0].isError).toBe(true);
    expect(results[0].isError, "the guard did not refuse").toBe(true);
  });
});

// ── The safety checks do not have an off switch ───────────────────────────────
describe("executor — a trust level cannot disable a safety check", () => {
  it("still runs Rule of Two at the top of the old ladder", async () => {
    // THIS TEST USED TO ASSERT THE OPPOSITE, and it was right about the code: `level < 3`
    // meant the highest "trust" setting SKIPPED the check that stops untrusted input plus
    // sensitive access plus a persistent change from happening together. A trust level that
    // switches off a safety check is not a trust level, it is an off switch with a
    // flattering name: and it sat at the top of a four-level ladder whose meaning the design
    // had already removed (tools open when they become relevant, never by
    // earning trust; she is not an employee being rated).
    const registry = createToolRegistry();
    registry.register(makeEchoTool("any_tool"));

    const ruleOfTwoSpy = vi.fn(() => ({ isUntrusted: true, isSensitive: true, isStateChange: true }));

    const executor = createToolExecutor(registry, {
      ruleOfTwo: ruleOfTwoSpy,
    });

    const results = await executor.executeBatch([
      { callId: "1", name: "any_tool", args: {} },
    ]);

    expect(ruleOfTwoSpy, "the safety check can still be switched off").toHaveBeenCalled();
    expect(results[0].isError, "all three risks together and it ran anyway").toBe(true);
  });

  it("advisory HARD_BLOCK still applies with no level to escalate past", async () => {
    const registry = createToolRegistry();
    registry.register(makeEchoTool("blocked_tool"));

    const executor = createToolExecutor(registry, {
      advisory: () => ({ outcome: "HARD_BLOCK" as const, tier: 3 as const, reason: "hard blocked regardless" }),
    });

    const results = await executor.executeBatch([
      { callId: "1", name: "blocked_tool", args: {} },
    ]);

    expect(results[0].isError).toBe(true);
    expect(results[0].isError, "the guard did not refuse").toBe(true);
  });

  it("advisory WARN does not block (tool still executes)", async () => {
    const registry = createToolRegistry();
    registry.register(makeEchoTool("warned_tool"));

    const executor = createToolExecutor(registry, {
      advisory: () => ({ outcome: "WARN" as const, tier: 2 as const, reason: "this is just a warning" }),
    });

    const results = await executor.executeBatch([
      { callId: "1", name: "warned_tool", args: {} },
    ]);

    expect(results[0].isError).toBeFalsy();
    expect(results[0].content).toBe("warned_tool executed");
  });
});

// The former "dynamic level getter" block tested the ask-first valve at level 0 and per-path level
// overrides, the trust ladder's only live effects, now removed. ToolExecutorConfig
// carries no trust level; what governs a call is the wall plus the two unconditional action-danger
// checks, exercised by the blocks above.
