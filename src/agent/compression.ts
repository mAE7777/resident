// Deterministic context compression (phase 1 only).
//
// Phase 1 (cheap, no LLM call):
//   Walk message history and replace old tool results (outside the recent
//   ~20K-token window) with 1-line summaries. Also strips thinking blocks from
//   older turns. Expected to save ~30% of tokens with zero latency.
//
// Phase 2 (expensive, LLM-based):
//   Protect head (first 2 messages) and tail (last ~20K tokens). Summarize
//   everything in between with a structured LLM prompt. Supports iterative
//   summaries by accepting a previousSummary parameter.
//
// Circuit breaker:
//   After 3 consecutive compression failures, opens and prevents further
//   attempts until success is recorded.

import type { Message } from "../providers/types.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CompressionResult {
  messages: Message[];
  summary: string;
  tokensSaved: number;
}

export interface CompressionMetrics {
  record(success: boolean, tokensSaved: number, durationMs: number): void;
  getStats(): { total: number; successes: number; successRate: number };
}

function estimateTokens(text: string): number {
  return text.length / 4;
}

/** Estimate total tokens in a message. */
function messageTokens(msg: Message): number {
  const c = msg.content;
  if (typeof c === "string") return estimateTokens(c);
  return (c as unknown as Array<Record<string, unknown>>).reduce(
    (sum, block) => {
      if (block.type === "text") return sum + estimateTokens(String(block.text ?? ""));
      if (block.type === "tool_use") return sum + estimateTokens(JSON.stringify(block.input ?? {})) + 50;
      if (block.type === "tool_result") return sum + estimateTokens(String(block.content ?? ""));
      if (block.type === "thinking") return sum + estimateTokens(String(block.thinking ?? ""));
      return sum;
    },
    0
  );
}

/** Count newlines in a string (= number of lines - 1). */
function countLines(text: string): number {
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") count++;
  }
  return count;
}

/**
 * Extract the tool name and first argument value from the tool_use block
 * that precedes a tool_result block. We walk the full message list to find
 * the matching tool_use by id.
 */
function findToolUseInfo(
  messages: Message[],
  toolUseId: string
): { name: string; firstArg: string } | null {
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const c = msg.content;
    if (!Array.isArray(c)) continue;
    for (const block of c as unknown as Array<Record<string, unknown>>) {
      if (block.type === "tool_use" && block.id === toolUseId) {
        const name = String(block.name ?? "unknown");
        const input = block.input as Record<string, unknown> | null | undefined;
        let firstArg = "";
        if (input && typeof input === "object") {
          const values = Object.values(input);
          if (values.length > 0) {
            firstArg = String(values[0]).slice(0, 50);
          }
        }
        return { name, firstArg };
      }
    }
  }
  return null;
}

/**
 * Build a 1-line summary for a tool result block. She reads it in place of what she saw earlier in
 * a long turn, so it is in her language; it used to read "[Tool result: read on "…", 40 lines]".
 */
function toolResultSummary(name: string, firstArg: string, lineCount: number): string {
  const argPart = firstArg ? `「${firstArg}」` : " ";
  return `（早先 ${name}${argPart}拿回来的 ${lineCount} 行，收起来了）`;
}

// ── Phase 1 ───────────────────────────────────────────────────────────────────

/**
 * Phase 1 compression, no LLM call.
 *
 * Walks messages backwards to identify the "recent window" (last
 * recentWindowTokens tokens). Tool-result blocks and thinking blocks outside
 * that window are replaced with compact 1-line summaries.
 */
export function compressPhase1(
  messages: Message[],
  recentWindowTokens = 20000
): CompressionResult {
  const recentWindowChars = recentWindowTokens * 4;

  // Walk backwards to determine the recent-window boundary index.
  let charsFromEnd = 0;
  let recentBoundary = messages.length; // messages[recentBoundary..] are "recent"

  for (let i = messages.length - 1; i >= 0; i--) {
    const c = messages[i].content;
    const msgStr = typeof c === "string"
      ? c
      : (c as unknown as Array<Record<string, unknown>>)
          .map((b) => {
            if (b.type === "text") return String(b.text ?? "");
            if (b.type === "tool_result") return String(b.content ?? "");
            if (b.type === "tool_use") return JSON.stringify(b.input ?? {});
            if (b.type === "thinking") return String(b.thinking ?? "");
            return "";
          })
          .join("");

    charsFromEnd += msgStr.length;
    if (charsFromEnd > recentWindowChars) {
      recentBoundary = i + 1;
      break;
    }
    if (i === 0) {
      recentBoundary = 0;
    }
  }

  let originalTokens = 0;
  let compressedTokens = 0;
  const newMessages: Message[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const tokens = messageTokens(msg);
    originalTokens += tokens;

    // Messages inside the recent window: keep as-is.
    if (i >= recentBoundary) {
      newMessages.push(msg);
      compressedTokens += tokens;
      continue;
    }

    const c = msg.content;

    // String content: keep as-is (no tool blocks to compress).
    if (typeof c === "string") {
      newMessages.push(msg);
      compressedTokens += tokens;
      continue;
    }

    const blocks = c as unknown as Array<Record<string, unknown>>;
    let changed = false;
    const newBlocks: Array<Record<string, unknown>> = [];

    // Her own thinking sits in HER turn, so nothing the machine writes may stand in its place:
    // an old thinking block is simply dropped. Only when it was the whole turn does
    // something have to remain for the turn to be well-formed, and then it is a quiet placeholder
    // in her language rather than "[thinking block removed]". Her current provider returns no
    // thinking blocks at all, so this is a guard for the day it does.
    const onlyThinking = blocks.every((b) => b.type === "thinking");
    for (const block of blocks) {
      if (block.type === "thinking") {
        if (onlyThinking && newBlocks.length === 0) newBlocks.push({ type: "text", text: "（想过的，收起来了）" });
        changed = true;
        continue;
      }

      // Replace tool_result blocks with 1-line summaries.
      if (block.type === "tool_result") {
        const toolUseId = String(block.tool_use_id ?? "");
        const content = String(block.content ?? "");
        const lineCount = countLines(content);
        const info = findToolUseInfo(messages, toolUseId);
        const name = info?.name ?? "unknown";
        const firstArg = info?.firstArg ?? "";
        const summary = toolResultSummary(name, firstArg, lineCount);

        newBlocks.push({ ...block, content: summary });
        changed = true;
        continue;
      }

      newBlocks.push(block);
    }

    if (changed) {
      const newMsg: Message = {
        role: msg.role,
        content: newBlocks as unknown as Message["content"],
      };
      newMessages.push(newMsg);
      compressedTokens += messageTokens(newMsg);
    } else {
      newMessages.push(msg);
      compressedTokens += tokens;
    }
  }

  const saved = originalTokens - compressedTokens;

  return {
    messages: newMessages,
    summary: `Phase 1 compression: ${Math.round(saved)} tokens saved (${Math.round((saved / Math.max(1, originalTokens)) * 100)}%)`,
    tokensSaved: Math.max(0, saved),
  };
}

// ── Combined compressor ────────────────────────────────────────────────────────

/** The `compress` callback for agentLoop: deterministic drop-oldest, no model. */
export function createCompressor(): {
  compress(
    messages: Message[],
    previousSummary?: string
  ): Promise<{ messages: Message[]; summary: string }>;
} {

  async function compress(
    messages: Message[],
    previousSummary?: string
  ): Promise<{ messages: Message[]; summary: string }> {
    // Phase 1: always attempt first (no LLM, no circuit breaker needed).
    const p1 = compressPhase1(messages);

    // Deterministic only. Phase 2 used a background model to paraphrase
    // the middle of her conversation into an English summary block spliced in as a user message,
    // a model-produced surface value spliced into what she reads. Same violation class as the
    // removed verifier/reflexion injections, kept for a while on a false premise. Phase 1
    // (drop-oldest, deterministic) is the whole compressor now; her verbatim session archive
    // is the backstop for anything dropped.
    void previousSummary;
    return { messages: p1.messages, summary: p1.summary };
  }

  return { compress };
}
