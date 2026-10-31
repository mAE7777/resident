// Shared provider types: LLMRequest, LLMResponse, ContentBlock, ToolDefinition,
// ProviderLayer, and the LLMProvider interface.

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  signature?: string;
}

export interface RedactedThinkingBlock {
  type: "redacted_thinking";
  data: string;
}

/**
 * The result of a tool call, sent back up in a user-role message.
 *
 * Deliberately NOT part of `ContentBlock`: a block of this kind only ever travels in a message we
 * send, never in a response a model returns, and collapsing the two would oblige every piece of
 * response-handling code to consider a case that cannot reach it. It was previously redeclared
 * privately in three modules and cast in through `unknown` at each one, which meant nothing
 * anywhere actually checked the shape.
 */
export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: unknown;
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ThinkingBlock | RedactedThinkingBlock;

/** What a MESSAGE may carry. A response carries `ContentBlock` only. */
export type MessageContentBlock = ContentBlock | ToolResultBlock;

export interface Message {
  role: "user" | "assistant";
  content: string | MessageContentBlock[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface LLMRequest {
  model: string;
  messages: Message[];
  maxTokens: number;
  temperature?: number;
  stopSequences?: string[];
  tools?: ToolDefinition[];
  system?: string | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  thinking?: {
    type: "adaptive" | "enabled" | "disabled";
    budgetTokens?: number;
    display?: "summarized" | "omitted";
  };
  outputConfig?: {
    effort?: "low" | "medium" | "high" | "xhigh" | "max";
  };
  /**
   * Which metabolic account this call draws from ("work" serves the owner;
   * "curiosity"/"maintenance"/"expression" are the Resident's own life). The
   * cost-guard feeds the metabolism ledger by this tag. Defaults to "work".
   */
  account?: string;
  /** Free-text note on why this call was made, for the ops-log and diary. */
  purpose?: string;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMResponse {
  id: string;
  content: ContentBlock[];
  model: string;
  stopReason: string;
  usage: LLMUsage;
}

export interface LLMProvider {
  complete(request: LLMRequest): Promise<LLMResponse>;
}

export interface ProviderLayer {
  call(
    request: LLMRequest,
    next: (req: LLMRequest) => Promise<LLMResponse>
  ): Promise<LLMResponse>;
}
