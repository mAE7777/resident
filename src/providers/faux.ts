// Faux LLM provider for testing: deterministic, no API calls.
// Supports pattern-based response routing, error injection, tool call responses,
// and streaming simulation.

import type { LLMProvider, LLMRequest, LLMResponse, ContentBlock } from "./types.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FauxResponseRule {
  pattern: RegExp | string;
  text?: string;
  toolCalls?: { name: string; input: unknown }[];
  error?: { status: number; message: string };
  stopReason?: string;
  delayMs?: number;
}

export interface FauxConfig {
  responses?: FauxResponseRule[];
  defaultResponse?: string;
  latencyMs?: number;
}

// ── Helper factories ──────────────────────────────────────────────────────────

export function fauxText(text: string): FauxResponseRule {
  return { pattern: /.*/, text };
}

export function fauxToolCall(name: string, args: unknown): FauxResponseRule {
  return {
    pattern: /.*/,
    toolCalls: [{ name, input: args }],
    stopReason: "tool_use",
  };
}

export function fauxError(status: number, message: string): FauxResponseRule {
  return { pattern: /.*/, error: { status, message } };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let _idCounter = 0;

function nextId(): string {
  _idCounter += 1;
  return `faux_msg_${_idCounter}`;
}

function extractUserText(request: LLMRequest): string {
  const last = request.messages[request.messages.length - 1];
  if (!last) return "";
  if (typeof last.content === "string") return last.content;
  const textBlocks = last.content.filter((b) => b.type === "text");
  return textBlocks.map((b) => (b as { type: "text"; text: string }).text).join(" ");
}

function matches(pattern: RegExp | string, text: string): boolean {
  if (pattern instanceof RegExp) return pattern.test(text);
  return text.includes(pattern);
}

function buildError(rule: FauxResponseRule["error"]): Error {
  const err = new Error(rule!.message) as Error & Record<string, unknown>;
  err.status = rule!.status;
  return err;
}

// ── Faux provider ─────────────────────────────────────────────────────────────

export function createFauxProvider(config: FauxConfig = {}): LLMProvider & {
  stream(request: LLMRequest): AsyncGenerator<string, void, unknown>;
} {
  const { responses = [], defaultResponse = "I don't understand", latencyMs = 0 } = config;

  async function complete(request: LLMRequest): Promise<LLMResponse> {
    const userText = extractUserText(request);

    // Find first matching rule
    const rule = responses.find((r) => matches(r.pattern, userText));

    // Apply global latency
    const delay = (rule?.delayMs ?? 0) + latencyMs;
    if (delay > 0) await sleep(delay);

    // Error injection
    if (rule?.error) {
      throw buildError(rule.error);
    }

    // Build content
    const content: ContentBlock[] = [];

    if (rule?.toolCalls && rule.toolCalls.length > 0) {
      for (const tc of rule.toolCalls) {
        content.push({
          type: "tool_use",
          id: `tu_${nextId()}`,
          name: tc.name,
          input: tc.input,
        });
      }
    } else {
      const text = rule?.text ?? defaultResponse;
      content.push({ type: "text", text });
    }

    const stopReason = rule?.stopReason ?? (content[0]?.type === "tool_use" ? "tool_use" : "end_turn");

    return {
      id: nextId(),
      content,
      model: request.model,
      stopReason,
      usage: {
        inputTokens: Math.ceil(userText.length / 4),
        outputTokens: Math.ceil(
          content
            .map((b) => (b.type === "text" ? b.text.length : JSON.stringify(b).length))
            .reduce((a, b) => a + b, 0) / 4
        ),
      },
    };
  }

  async function* stream(request: LLMRequest): AsyncGenerator<string, void, unknown> {
    const userText = extractUserText(request);
    const rule = responses.find((r) => matches(r.pattern, userText));

    if (rule?.error) {
      throw buildError(rule.error);
    }

    const text = rule?.text ?? defaultResponse;
    const chunkDelay = rule?.delayMs ?? latencyMs;

    // Split into words and yield each as a chunk
    const words = text.split(" ");
    for (let i = 0; i < words.length; i++) {
      const chunk = i === 0 ? words[i] : " " + words[i];
      if (chunkDelay > 0) await sleep(chunkDelay);
      yield chunk;
    }
  }

  return { complete, stream };
}
