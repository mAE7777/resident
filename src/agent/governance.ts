// Context governance pipeline: message repair run before each LLM call.
// Each step is a pure function that returns a new array without mutating input.

import type { Message, MessageContentBlock, ToolResultBlock } from "../providers/types.js";
import { preserveErrors } from "./error-preserve.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GovernanceConfig {
  maxToolResultChars?: number;   // default 8000 (tightened from 16000, most useful output is first 4-8KB)
  tokenBudget?: number;          // default 200000 (tokens)
  recentWindowTokens?: number;   // default 8000 (tightened from 20000, last 3-4 turns untruncated)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function estimateTokens(msg: Message): number {
  const c = msg.content;
  if (typeof c === "string") return c.length / 4;
  return c.reduce((sum, block) => {
    const b = block as unknown as Record<string, unknown>;
    if (b.type === "text") return sum + String(b.text ?? "").length / 4;
    if (b.type === "tool_use") return sum + JSON.stringify(b.input ?? {}).length / 4 + 50;
    if (b.type === "tool_result") return sum + String(b.content ?? "").length / 4;
    return sum;
  }, 0);
}

/**
 * A predicate rather than a plain boolean, so the narrowing SURVIVES the call and every caller can
 * treat the content as blocks without re-asserting it. The previous version returned `boolean` and
 * every caller then cast back through `unknown`, which is how a shape nothing checks comes about.
 */
function isToolResultMessage(msg: Message): msg is Message & { content: ToolResultBlock[] } {
  if (msg.role !== "user") return false;
  const c = msg.content;
  if (!Array.isArray(c) || c.length === 0) return false;
  return c.every((b) => b.type === "tool_result");
}

function getToolUseIds(messages: Message[]): Set<string> {
  const ids = new Set<string>();
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const c = msg.content;
    if (!Array.isArray(c)) continue;
    for (const block of c) {
      if (block.type === "tool_use") ids.add(block.id);
    }
  }
  return ids;
}

function getToolResultIds(messages: Message[]): Set<string> {
  const ids = new Set<string>();
  for (const msg of messages) {
    if (!isToolResultMessage(msg)) continue;
    for (const block of msg.content as unknown as Array<Record<string, unknown>>) {
      if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
        ids.add(block.tool_use_id);
      }
    }
  }
  return ids;
}

function contentToString(content: string | MessageContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .map((b) => {
      const block = b as unknown as Record<string, unknown>;
      if (block.type === "text") return String(block.text ?? "");
      if (block.type === "tool_result") return String(block.content ?? "");
      return "";
    })
    .join("");
}

function mergeContent(
  a: string | MessageContentBlock[],
  b: string | MessageContentBlock[]
): string | MessageContentBlock[] {
  if (typeof a === "string" && typeof b === "string") {
    return a + "\n" + b;
  }
  const aArr: MessageContentBlock[] = typeof a === "string"
    ? [{ type: "text", text: a }]
    : a;
  const bArr: MessageContentBlock[] = typeof b === "string"
    ? [{ type: "text", text: b }]
    : b;
  return [...aArr, ...bArr];
}

// ── Step 1: dropOrphanToolResults ─────────────────────────────────────────────
// Remove user messages whose tool_result entries have no matching tool_use block.

export function dropOrphanToolResults(messages: Message[]): Message[] {
  const validIds = getToolUseIds(messages);
  if (validIds.size === 0) {
    // No tool_use blocks at all: drop all tool_result messages
    return messages.filter((msg) => !isToolResultMessage(msg));
  }

  return messages.filter((msg) => {
    if (!isToolResultMessage(msg)) return true;
    const blocks = msg.content as unknown as Array<Record<string, unknown>>;
    // Keep the message if ANY block matches a valid tool_use ID
    // (previously used .every which dropped messages if any block was unmatched)
    const hasValidResult = blocks.some(
      (b) =>
        b.type === "tool_result" &&
        typeof b.tool_use_id === "string" &&
        validIds.has(b.tool_use_id)
    );
    return hasValidResult;
  });
}

// ── Step 2: backfillMissingToolResults ────────────────────────────────────────
// For each tool_use in an assistant message that has no matching result, inject
// a synthetic error result as the next user message.

export function backfillMissingToolResults(messages: Message[]): Message[] {
  const resultIds = getToolResultIds(messages);
  const result: Message[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    result.push(msg);

    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;

    const missingIds: string[] = [];
    for (const block of msg.content) {
      if (block.type === "tool_use" && !resultIds.has(block.id)) {
        missingIds.push(block.id);
      }
    }

    if (missingIds.length === 0) continue;

    // Check if next message already covers some of these (shouldn't after dropOrphan,
    // but be defensive). Inject synthetic results only for truly missing ones.
    // She reads this in place of a result that was compacted away, so it is in her language;
    // it used to read "Error: Result unavailable (context compacted)".
    const syntheticBlocks: ToolResultBlock[] = missingIds.map((id) => ({
      type: "tool_result",
      tool_use_id: id,
      content: "这一下拿回来的东西已经收起来了，看不到了。",
    }));

    result.push({
      role: "user",
      content: syntheticBlocks,
    });
  }

  return result;
}

// ── Step 3: microcompact ──────────────────────────────────────────────────────
// Merge consecutive messages with the same role (except tool_result messages,
// which must remain as separate user messages to satisfy the Anthropic API's
// tool_use→tool_result pairing requirement).

export function microcompact(messages: Message[]): Message[] {
  const result: Message[] = [];
  for (const msg of messages) {
    const prev = result[result.length - 1];
    // Never merge tool_result messages with other user messages
    if (prev && prev.role === msg.role && !isToolResultMessage(msg) && !isToolResultMessage(prev)) {
      result[result.length - 1] = {
        role: prev.role,
        content: mergeContent(prev.content, msg.content),
      };
    } else {
      result.push({ role: msg.role, content: msg.content });
    }
  }
  return result;
}

// ── Step 4: applyToolResultBudget ─────────────────────────────────────────────
// Truncate tool results older than the recent window to maxChars (16000 default).

export function applyToolResultBudget(
  messages: Message[],
  config?: { maxChars?: number; recentWindowTokens?: number }
): Message[] {
  const maxChars = config?.maxChars ?? 16000;
  const recentWindowTokens = config?.recentWindowTokens ?? 20000;
  const recentWindowChars = recentWindowTokens * 4;

  // Walk backwards to find recent window boundary (in chars of content)
  let charsFromEnd = 0;
  let recentBoundary = messages.length; // index from which messages are "recent"

  for (let i = messages.length - 1; i >= 0; i--) {
    charsFromEnd += contentToString(messages[i].content).length;
    if (charsFromEnd > recentWindowChars) {
      recentBoundary = i + 1;
      break;
    }
    if (i === 0) recentBoundary = 0;
  }

  return messages.map((msg, idx) => {
    if (idx >= recentBoundary) return msg; // inside recent window, don't truncate
    if (!isToolResultMessage(msg)) return msg;

    const blocks = msg.content;
    const truncated: MessageContentBlock[] = blocks.map((block) => {
      if (block.type !== "tool_result") return block;
      const content = String(block.content ?? "");
      if (content.length <= maxChars) return block;
      return { ...block, content: content.slice(0, maxChars) + "…[truncated]" };
    });

    // Only return new object if something actually changed
    const changed = truncated.some((b, i) => b !== blocks[i]);
    if (!changed) return msg;

    return { role: msg.role, content: truncated };
  });
}

// ── Step 5: snipHistory ───────────────────────────────────────────────────────
// Remove oldest messages to fit within tokenBudget.
// Always removes in user+assistant pairs to preserve conversation integrity.
// Never removes a user message without its paired assistant response.

export function snipHistory(messages: Message[], tokenBudget: number): Message[] {
  const total = messages.reduce((sum, m) => sum + estimateTokens(m), 0);
  if (total <= tokenBudget) return messages;

  // Walk forward to find the snip point, remove from front in pairs.
  // Find pairs: a user message followed by an assistant message.
  let snipTo = 0; // we'll remove messages[0..snipTo)
  let remaining = total;

  while (remaining > tokenBudget && snipTo < messages.length) {
    // Find next user message at or after snipTo
    let userIdx = -1;
    for (let i = snipTo; i < messages.length; i++) {
      if (messages[i].role === "user") {
        userIdx = i;
        break;
      }
    }
    if (userIdx === -1) break; // no user message found

    // Find the paired assistant response
    let assistantIdx = -1;
    for (let i = userIdx + 1; i < messages.length; i++) {
      if (messages[i].role === "assistant") {
        assistantIdx = i;
        break;
      }
    }
    if (assistantIdx === -1) break; // no paired assistant: stop, can't safely remove

    // Remove everything from current snipTo up through assistantIdx
    const removedTokens = messages
      .slice(snipTo, assistantIdx + 1)
      .reduce((s, m) => s + estimateTokens(m), 0);

    remaining -= removedTokens;
    snipTo = assistantIdx + 1;

    // If we're under budget now, stop
    if (remaining <= tokenBudget) break;
  }

  return messages.slice(snipTo);
}

// ── Composed pipeline ─────────────────────────────────────────────────────────

export function governMessages(messages: Message[], config?: GovernanceConfig): Message[] {
  const maxToolResultChars = config?.maxToolResultChars ?? 8000;
  const tokenBudget = config?.tokenBudget ?? 200000;
  const recentWindowTokens = config?.recentWindowTokens ?? 8000;

  const steps = [
    dropOrphanToolResults,
    backfillMissingToolResults,
    microcompact,
    (msgs: Message[]) =>
      applyToolResultBudget(msgs, { maxChars: maxToolResultChars, recentWindowTokens }),
    // Moving errors only shields them from the snip below. When nothing is going to be snipped
    // (snipHistory's own test), moving them just rewrites the order she did things in.
    (msgs: Message[]) =>
      msgs.reduce((sum, m) => sum + estimateTokens(m), 0) > tokenBudget
        ? preserveErrors(msgs, recentWindowTokens * 4)
        : msgs,
    (msgs: Message[]) => snipHistory(msgs, tokenBudget),
    dropOrphanToolResults, // post-snip cleanup: snipping may create new orphans
  ];

  return steps.reduce((msgs, step) => step(msgs), messages);
}
