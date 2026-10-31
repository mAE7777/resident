// Anthropic provider: wraps @anthropic-ai/sdk and maps to our LLMResponse type.

import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, LLMRequest, LLMResponse, ContentBlock } from "./types.js";
import { PROVIDER_TIMEOUT_MS, STREAM_STALL_MS, finalUnlessStalled } from "../life/turn-guard.js";

export interface AnthropicProviderOptions {
  baseURL?: string;
}

function isOpus47(model: string): boolean {
  return model === "claude-opus-4-7" || model.startsWith("claude-opus-4-7-");
}

function shouldUseStreaming(request: LLMRequest): boolean {
  if (request.maxTokens >= 8192) return true;
  const messageChars = request.messages.reduce((sum, message) => {
    if (typeof message.content === "string") return sum + message.content.length;
    return sum + JSON.stringify(message.content).length;
  }, 0);
  const systemChars = request.system
    ? typeof request.system === "string"
      ? request.system.length
      : JSON.stringify(request.system).length
    : 0;
  const toolChars = request.tools ? JSON.stringify(request.tools).length : 0;
  return messageChars + systemChars + toolChars > 50_000;
}

export function createAnthropicProvider(apiKey: string, options: AnthropicProviderOptions = {}): LLMProvider {
  // Bounded, finally. This client ran on SDK defaults for its whole life: a 10-minute timeout the
  // SDK clears the moment response HEADERS arrive, times its own 2 retries, ~30 silent minutes,
  // which is the exact shape of the two live turns that hung past every window. `maxRetries: 0`
  // because the chain's retry layer already owns retries and the two multiplied.
  const client = new Anthropic({ apiKey, baseURL: options.baseURL, timeout: PROVIDER_TIMEOUT_MS, maxRetries: 0 });

  // This vendor's grammar wants the first message to be a user turn. The transcript can now
  // legitimately open on HER (a proactive send she made before he answered); that is her
  // record's truth, and trimming it is this adapter's business, not the transcript's.
  function userFirst(messages: LLMRequest["messages"]): LLMRequest["messages"] {
    const at = messages.findIndex((m) => m.role === "user");
    return at <= 0 ? messages : messages.slice(at);
  }

  return {
    async complete(request: LLMRequest): Promise<LLMResponse> {
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: request.model,
        max_tokens: request.maxTokens,
        messages: userFirst(request.messages).map((m) => ({
          role: m.role,
          content: m.content as Anthropic.MessageParam["content"],
        })),
      };

      if (request.temperature !== undefined && !isOpus47(request.model)) {
        params.temperature = request.temperature;
      }
      if (request.stopSequences !== undefined) {
        params.stop_sequences = request.stopSequences;
      }
      if (request.system !== undefined) {
        params.system = request.system as Anthropic.MessageCreateParamsNonStreaming["system"];
      }
      if (request.tools !== undefined) {
        params.tools = request.tools as Anthropic.Tool[];
      }
      if (request.thinking !== undefined) {
        if (request.thinking.type === "enabled") {
          params.thinking = {
            type: "enabled",
            budget_tokens: request.thinking.budgetTokens ?? Math.min(4096, Math.max(1024, request.maxTokens - 1024)),
            display: request.thinking.display,
          };
        } else {
          params.thinking = {
            type: request.thinking.type,
            display: request.thinking.type === "adaptive" ? request.thinking.display : undefined,
          } as Anthropic.ThinkingConfigParam;
        }
      } else if (isOpus47(request.model)) {
        params.thinking = { type: "adaptive" };
      }
      if (request.outputConfig !== undefined) {
        params.output_config = request.outputConfig;
      } else if (isOpus47(request.model)) {
        params.output_config = { effort: "high" };
      }

      // The streaming branch is where the constructor timeout goes blind (headers arrived, timer
      // cleared), so the stream carries its own inter-event stall bound. An abort here surfaces
      // as a retryable error to the chain's retry layer, correct, since a stalled stream says
      // nothing about the next attempt.
      let msg: Anthropic.Message;
      if (shouldUseStreaming(request)) {
        const stream = client.messages.stream(params as Anthropic.MessageStreamParams);
        msg = await finalUnlessStalled({
          final: stream.finalMessage(),
          onEvent: (bump) => stream.on("streamEvent", bump),
          abort: () => stream.abort(),
        }, STREAM_STALL_MS);
      } else {
        msg = await client.messages.create(params);
      }

      const content: ContentBlock[] = msg.content.map((block) => {
        if (block.type === "text") {
          return { type: "text", text: block.text };
        }
        if (block.type === "tool_use") {
          return { type: "tool_use", id: block.id, name: block.name, input: block.input };
        }
        if (block.type === "thinking") {
          return { type: "thinking", thinking: block.thinking, signature: block.signature };
        }
        if (block.type === "redacted_thinking") {
          return { type: "redacted_thinking", data: block.data };
        }
        return { type: "text", text: "" };
      });

      return {
        id: msg.id,
        content,
        model: msg.model,
        stopReason: msg.stop_reason ?? "end_turn",
        usage: {
          inputTokens: msg.usage.input_tokens ?? 0,
          outputTokens: msg.usage.output_tokens,
        },
      };
    },
  };
}
