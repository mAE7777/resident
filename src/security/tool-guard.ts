// Tool execution guard: tools execute ONLY when stop_reason is 'tool_use' or 'end_turn'
// AND there are tool calls present. All other stop reasons are rejected.
// Mirrors the should_execute_tools property from the nanobot base.py concept,
// adapted for the Anthropic SDK stop_reason field (not OpenAI finish_reason).

// Valid stop reasons that permit tool execution
const VALID_EXECUTION_REASONS = new Set(["tool_use", "end_turn"]);

export interface ToolExecutionContext {
  stop_reason: string | null;
  toolCallCount: number;
}

export interface ToolExecutionDecision {
  execute: boolean;
  reason: string;
}

export function shouldExecuteTools(ctx: ToolExecutionContext): ToolExecutionDecision {
  const { stop_reason, toolCallCount } = ctx;

  if (stop_reason === null || stop_reason === "") {
    return { execute: false, reason: "stop_reason is absent or empty" };
  }

  if (!VALID_EXECUTION_REASONS.has(stop_reason)) {
    return { execute: false, reason: `stop_reason '${stop_reason}' does not permit tool execution` };
  }

  if (toolCallCount <= 0) {
    return { execute: false, reason: "no tool calls present" };
  }

  return { execute: true, reason: "ok" };
}
