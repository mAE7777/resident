import { describe, it, expect } from "vitest";
import { classifyTool } from "../../../src/security/zones.js";
import { shouldExecuteTools } from "../../../src/security/tool-guard.js";

// ---------------------------------------------------------------------------
// zones.ts, classifyTool
// ---------------------------------------------------------------------------

describe("zones.ts — classifyTool", () => {
  it("classifies 'read' as Zone 1", () => {
    expect(classifyTool("read")).toBe(1);
  });

  it("classifies 'glob' as Zone 1", () => {
    expect(classifyTool("glob")).toBe(1);
  });

  it("classifies 'grep' as Zone 1", () => {
    expect(classifyTool("grep")).toBe(1);
  });

  it("classifies 'web_search' as Zone 1", () => {
    expect(classifyTool("web_search")).toBe(1);
  });

  it("classifies 'resource_lookup' as Zone 1", () => {
    expect(classifyTool("resource_lookup")).toBe(1);
  });

  it("classifies 'web_fetch' as Zone 1", () => {
    expect(classifyTool("web_fetch")).toBe(1);
  });

  it("classifies deterministic public API utility tools as Zone 1", () => {
    expect(classifyTool("weather")).toBe(1);
    expect(classifyTool("currency_convert")).toBe(1);
    expect(classifyTool("places_lookup")).toBe(1);
  });

  it("classifies 'artifact_fetch' as Zone 2", () => {
    expect(classifyTool("artifact_fetch")).toBe(2);
  });

  it("classifies browser screenshot capture as Zone 2", () => {
    expect(classifyTool("browser_capture")).toBe(2);
  });

  it("classifies 'memory_search' as Zone 1", () => {
    expect(classifyTool("memory_search")).toBe(1);
  });

  it("classifies 'memory_read' as Zone 1", () => {
    expect(classifyTool("memory_read")).toBe(1);
  });

  it("classifies 'message' as Zone 2", () => {
    expect(classifyTool("message")).toBe(2);
  });

  it("classifies 'self' as Zone 1", () => {
    expect(classifyTool("self")).toBe(1);
  });

  it("classifies 'write' as Zone 2", () => {
    expect(classifyTool("write")).toBe(2);
  });

  it("classifies 'edit' as Zone 2", () => {
    expect(classifyTool("edit")).toBe(2);
  });

  it("classifies 'bash' as Zone 3", () => {
    expect(classifyTool("bash")).toBe(3);
  });

  it("classifies 'spawn' as Zone 3", () => {
    expect(classifyTool("spawn")).toBe(3);
  });

  it("classifies unknown tool as Zone 3 (safe default)", () => {
    expect(classifyTool("unknown_tool_xyz")).toBe(3);
  });

  it("classification is case-insensitive", () => {
    expect(classifyTool("READ")).toBe(1);
    expect(classifyTool("BASH")).toBe(3);
    expect(classifyTool("Write")).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// zones.ts, isHardBlocked
// ---------------------------------------------------------------------------

describe("tool-guard.ts — shouldExecuteTools", () => {
  // AC: stop_reason 'refusal' with tool_use blocks → returns false
  it("AC: stop_reason 'refusal' + toolCalls → does not execute", () => {
    const result = shouldExecuteTools({ stop_reason: "refusal", toolCallCount: 2 });
    expect(result.execute).toBe(false);
  });

  // Valid: stop_reason 'tool_use' with calls
  it("stop_reason 'tool_use' + toolCallCount > 0 → executes", () => {
    const result = shouldExecuteTools({ stop_reason: "tool_use", toolCallCount: 1 });
    expect(result.execute).toBe(true);
    expect(result.reason).toBe("ok");
  });

  // Valid: stop_reason 'end_turn' with calls
  it("stop_reason 'end_turn' + toolCallCount > 0 → executes", () => {
    const result = shouldExecuteTools({ stop_reason: "end_turn", toolCallCount: 3 });
    expect(result.execute).toBe(true);
    expect(result.reason).toBe("ok");
  });

  // No tool calls: even valid stop_reason should not execute
  it("stop_reason 'tool_use' + toolCallCount 0 → does not execute", () => {
    const result = shouldExecuteTools({ stop_reason: "tool_use", toolCallCount: 0 });
    expect(result.execute).toBe(false);
  });

  // null stop_reason
  it("stop_reason null → does not execute", () => {
    const result = shouldExecuteTools({ stop_reason: null, toolCallCount: 2 });
    expect(result.execute).toBe(false);
  });

  // empty string stop_reason
  it("stop_reason empty string → does not execute", () => {
    const result = shouldExecuteTools({ stop_reason: "", toolCallCount: 2 });
    expect(result.execute).toBe(false);
  });

  // Rejected: max_tokens
  it("stop_reason 'max_tokens' → does not execute", () => {
    const result = shouldExecuteTools({ stop_reason: "max_tokens", toolCallCount: 1 });
    expect(result.execute).toBe(false);
  });

  // Rejected: stop_sequence
  it("stop_reason 'stop_sequence' → does not execute", () => {
    const result = shouldExecuteTools({ stop_reason: "stop_sequence", toolCallCount: 1 });
    expect(result.execute).toBe(false);
  });

  // Rejected: content_filter
  it("stop_reason 'content_filter' → does not execute", () => {
    const result = shouldExecuteTools({ stop_reason: "content_filter", toolCallCount: 1 });
    expect(result.execute).toBe(false);
  });

  // Rejected: error
  it("stop_reason 'error' → does not execute", () => {
    const result = shouldExecuteTools({ stop_reason: "error", toolCallCount: 1 });
    expect(result.execute).toBe(false);
  });

  // Rejected: unknown value
  it("stop_reason 'unknown_value' → does not execute", () => {
    const result = shouldExecuteTools({ stop_reason: "unknown_value", toolCallCount: 5 });
    expect(result.execute).toBe(false);
  });

  // Rejected: pause_turn
  it("stop_reason 'pause_turn' → does not execute", () => {
    const result = shouldExecuteTools({ stop_reason: "pause_turn", toolCallCount: 1 });
    expect(result.execute).toBe(false);
  });

  // Reason message for refusal
  it("stop_reason 'refusal' reason message mentions stop_reason", () => {
    const result = shouldExecuteTools({ stop_reason: "refusal", toolCallCount: 1 });
    expect(result.reason).toContain("refusal");
  });
});
