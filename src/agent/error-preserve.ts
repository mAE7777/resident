// Error preservation: ensures error tool results survive context governance.
// Integrates with the governance pipeline as a step inserted before snipHistory.

import type { Message, ContentBlock } from "../providers/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

// A tool result block extended with optional is_error flag (matches Anthropic API shape).
interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

function getBlocks(msg: Message): Array<Record<string, unknown>> {
  if (!Array.isArray(msg.content)) return [];
  return msg.content as unknown as Array<Record<string, unknown>>;
}

// ── isErrorMessage ────────────────────────────────────────────────────────────
// Returns true if the message is a user message containing at least one
// tool_result block with is_error: true.

export function isErrorMessage(msg: Message): boolean {
  if (msg.role !== "user") return false;
  const blocks = getBlocks(msg);
  if (blocks.length === 0) return false;
  return blocks.some(
    (b) => b.type === "tool_result" && b.is_error === true
  );
}

// ── markErrorResult ───────────────────────────────────────────────────────────
// Tags a tool result message block with is_error: true.
// Returns a new block: does not mutate input.

export function markErrorResult(result: ToolResultBlock): ToolResultBlock {
  return { ...result, is_error: true };
}

// ── preserveErrors ────────────────────────────────────────────────────────────
// Governance step that moves error messages out of the "old" section
// so snipHistory cannot remove them.
//
// snipHistory removes from the front of the array in user+assistant pairs.
// This step finds all error messages in the old section (before the recent
// boundary) and re-inserts them just before the recent boundary, so they
// survive when snipHistory prunes the front.
//
// The recent boundary is defined as the last N messages whose combined char
// count falls within recentWindowChars (default 80000 = 20000 tokens * 4).
//
// A tool result only means something right after the call that asked for it, and both APIs
// reject a call whose answer does not come next. So an error result moves TOGETHER with the
// assistant message that issued it, and the boundary is never drawn between a call and its
// answer. One of her explorations once had a read of a missing file four steps back;
// the result was moved on its own past two later steps, the call was left unanswered, and the
// provider refused the whole request (400, "insufficient tool messages") eight steps into her
// looking, so the moment ended with nothing.

function toolUseIds(msg: Message): Set<string> {
  const ids = new Set<string>();
  if (msg.role !== "assistant") return ids;
  for (const b of getBlocks(msg)) {
    if (b.type === "tool_use" && typeof b.id === "string") ids.add(b.id);
  }
  return ids;
}

function isToolResultMessage(msg: Message): boolean {
  const blocks = getBlocks(msg);
  return msg.role === "user" && blocks.length > 0 && blocks.every((b) => b.type === "tool_result");
}

/** True when every result in `answer` replies to a call made in `call`. */
function answers(answer: Message, call: Message): boolean {
  const ids = toolUseIds(call);
  if (ids.size === 0) return false;
  return getBlocks(answer)
    .filter((b) => b.type === "tool_result")
    .every((b) => typeof b.tool_use_id === "string" && ids.has(b.tool_use_id));
}

export function preserveErrors(
  messages: Message[],
  recentWindowChars = 80000
): Message[] {
  if (messages.length === 0) return messages;

  // Walk backwards to find the recent boundary index.
  let charsFromEnd = 0;
  let recentBoundary = messages.length;

  for (let i = messages.length - 1; i >= 0; i--) {
    const c = messages[i].content;
    const len = typeof c === "string"
      ? c.length
      : (c as ContentBlock[]).reduce((sum, b) => {
          const block = b as unknown as Record<string, unknown>;
          if (block.type === "text") return sum + String(block.text ?? "").length;
          if (block.type === "tool_result") return sum + String(block.content ?? "").length;
          if (block.type === "tool_use") return sum + JSON.stringify(block.input ?? {}).length;
          return sum;
        }, 0);
    charsFromEnd += len;
    if (charsFromEnd > recentWindowChars) {
      recentBoundary = i + 1;
      break;
    }
    if (i === 0) recentBoundary = 0;
  }

  // Never split a call from its answer: if the recent section opens on results, the call that
  // asked for them belongs to the recent section too.
  if (
    recentBoundary > 0 &&
    recentBoundary < messages.length &&
    isToolResultMessage(messages[recentBoundary]) &&
    answers(messages[recentBoundary], messages[recentBoundary - 1])
  ) {
    recentBoundary -= 1;
  }

  // Nothing in the old section: nothing to protect.
  if (recentBoundary === 0) return messages;

  // Partition old section into what stays and what moves (each error with its call).
  const oldSection = messages.slice(0, recentBoundary);
  const recentSection = messages.slice(recentBoundary);

  const moved: Message[] = [];
  const kept: Message[] = [];

  for (const msg of oldSection) {
    if (!isErrorMessage(msg)) {
      kept.push(msg);
      continue;
    }
    const call = kept[kept.length - 1];
    if (call !== undefined && answers(msg, call)) moved.push(kept.pop() as Message);
    moved.push(msg);
  }

  // If no error messages in old section, nothing to do.
  if (moved.length === 0) return messages;

  // Re-assemble: rest of the old section | errors with their calls | recent section.
  // They now sit at the boundary, snipHistory only prunes from the front, so these survive.
  return [...kept, ...moved, ...recentSection];
}
