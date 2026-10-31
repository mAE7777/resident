import { describe, it, expect } from "vitest";
import {
  isErrorMessage,
  markErrorResult,
  preserveErrors,
} from "../../../src/agent/error-preserve.js";
import type { Message, ContentBlock, MessageContentBlock, ToolResultBlock } from "../../../src/providers/types.js";

/**
 * The blocks of a message, as blocks. `MessageContentBlock` is a discriminated union that already
 * names `tool_result`, so a `Record<string, unknown>` cast is no longer needed anywhere: checking
 * `b.type === "tool_result"` narrows to the real shape and a typo in a field name is now an error.
 */
function blocksOf(msg: Message): MessageContentBlock[] {
  return typeof msg.content === "string" ? [] : msg.content;
}

/** The tool_result blocks of a message. */
function toolResults(msg: Message): ToolResultBlock[] {
  return blocksOf(msg).filter((b): b is ToolResultBlock => b.type === "tool_result");
}


// ── Helpers ───────────────────────────────────────────────────────────────────

function userMsg(text: string): Message {
  return { role: "user", content: text };
}

function assistantMsg(text: string): Message {
  return { role: "assistant", content: text };
}

function toolResultMsg(
  tool_use_id: string,
  content = "result",
  is_error?: boolean
): Message {
  const block: Record<string, unknown> = { type: "tool_result", tool_use_id, content };
  if (is_error !== undefined) block.is_error = is_error;
  return {
    role: "user",
    content: [block] as unknown as ContentBlock[],
  };
}

// ── isErrorMessage ────────────────────────────────────────────────────────────

describe("isErrorMessage", () => {
  it("returns true for a user message with is_error: true tool_result", () => {
    const msg = toolResultMsg("toolu_001", "something failed", true);
    expect(isErrorMessage(msg)).toBe(true);
  });

  it("returns false for a tool_result without is_error", () => {
    const msg = toolResultMsg("toolu_001", "ok result");
    expect(isErrorMessage(msg)).toBe(false);
  });

  it("returns false for an assistant message with is_error block", () => {
    const msg: Message = {
      role: "assistant",
      content: [
        { type: "text", text: "done" },
      ] as ContentBlock[],
    };
    expect(isErrorMessage(msg)).toBe(false);
  });

  it("returns false for a plain user string message", () => {
    expect(isErrorMessage(userMsg("hello"))).toBe(false);
  });

  it("returns false when is_error is false", () => {
    const msg = toolResultMsg("toolu_001", "ok", false);
    expect(isErrorMessage(msg)).toBe(false);
  });
});

// ── markErrorResult ───────────────────────────────────────────────────────────

describe("markErrorResult", () => {
  it("returns a new block with is_error: true", () => {
    const block = { type: "tool_result" as const, tool_use_id: "toolu_001", content: "err" };
    const marked = markErrorResult(block);
    expect(marked.is_error).toBe(true);
    expect(marked.tool_use_id).toBe("toolu_001");
    expect(marked.content).toBe("err");
  });

  it("does not mutate the original block", () => {
    const block = { type: "tool_result" as const, tool_use_id: "toolu_001", content: "err" };
    markErrorResult(block);
    expect((block as Record<string, unknown>).is_error).toBeUndefined();
  });
});

// ── preserveErrors: AC1 + AC2 ───────────────────────────────────────────────

describe("preserveErrors", () => {
  // AC1: Given a tool call that returned an error, when governance runs,
  // then the error result is preserved (not pruned).
  it("AC1: error messages are moved out of the old section before snipHistory runs", () => {
    // Build messages where the error message is in the old (prunable) section.
    // Use a small recentWindowChars so a lot falls outside the window.
    const filler = "x".repeat(1000);
    const messages: Message[] = [
      userMsg(filler),          // old: non-error
      assistantMsg(filler),     // old: non-error
      toolResultMsg("toolu_err", "Permission denied", true), // old: ERROR
      userMsg(filler),          // old: non-error
      assistantMsg(filler),     // old: non-error
      userMsg("recent"),        // recent (within small window)
      assistantMsg("ok"),       // recent
    ];

    // Recent window = only last 2 messages (each is tiny)
    const recentWindowChars = 20; // only "recent" + "ok" fit
    const result = preserveErrors(messages, recentWindowChars);

    // The error message must still be present
    const hasError = result.some((m) => isErrorMessage(m));
    expect(hasError).toBe(true);

    // The error message must appear AFTER the non-error old messages
    const errorIdx = result.findIndex((m) => isErrorMessage(m));
    const recentStartIdx = result.findIndex((m) => m.content === "recent");
    expect(errorIdx).toBeGreaterThan(-1);
    // Error must appear before the recent section (or at its boundary)
    if (recentStartIdx !== -1) {
      expect(errorIdx).toBeLessThanOrEqual(recentStartIdx);
    }
  });

  it("returns messages unchanged when no error messages in old section", () => {
    const messages: Message[] = [
      userMsg("a"),
      assistantMsg("b"),
      userMsg("c"),
    ];
    const result = preserveErrors(messages, 5);
    expect(result).toHaveLength(messages.length);
    expect(result[0].content).toBe("a");
  });

  it("returns messages unchanged when everything is within the recent window", () => {
    const messages: Message[] = [
      toolResultMsg("toolu_err", "err", true),
      assistantMsg("ok"),
    ];
    // Large window: everything fits
    const result = preserveErrors(messages, 100000);
    expect(result).toHaveLength(2);
  });

  it("handles empty array", () => {
    expect(preserveErrors([])).toEqual([]);
  });

  it("preserves multiple error messages from old section", () => {
    const filler = "x".repeat(1000);
    const messages: Message[] = [
      toolResultMsg("toolu_err1", "err one", true),
      userMsg(filler),
      toolResultMsg("toolu_err2", "err two", true),
      userMsg("recent"),
      assistantMsg("ok"),
    ];
    const result = preserveErrors(messages, 20);

    const errorCount = result.filter((m) => isErrorMessage(m)).length;
    expect(errorCount).toBe(2);
  });

  // AC2: Given trajectory reduction runs, when it encounters an error step,
  // then the error is preserved (never pruned).
  // This AC is validated by trajectory.ts line 56 (already implemented).
  // The test below confirms our preserveErrors step doesn't accidentally strip
  // error messages from the message array either.
  it("AC2: error messages survive after reordering", () => {
    const filler = "x".repeat(500);
    const messages: Message[] = [
      userMsg(filler),
      assistantMsg(filler),
      toolResultMsg("toolu_fail", "Tool execution failed", true),
      userMsg("last"),
      assistantMsg("done"),
    ];
    const result = preserveErrors(messages, 20);

    const ids = result
      .filter((m) => isErrorMessage(m))
      .flatMap((m) =>
        toolResults(m).map((b) => b.tool_use_id)
      );
    expect(ids).toContain("toolu_fail");
  });
});

// ── preserveErrors keeps every call next to its answer ──────────

function callMsg(...ids: string[]): Message {
  return {
    role: "assistant",
    content: ids.map((id): MessageContentBlock => ({ type: "tool_use", id, name: "read", input: {} })),
  };
}

function resultsMsg(results: Array<[id: string, content: string, is_error?: boolean]>): Message {
  return {
    role: "user",
    content: results.map(([tool_use_id, content, is_error]): ToolResultBlock =>
      is_error ? { type: "tool_result", tool_use_id, content, is_error } : { type: "tool_result", tool_use_id, content },
    ),
  };
}

/** The ids of calls that the very next message does not answer. Both APIs refuse any of these. */
function unansweredCalls(messages: Message[]): string[] {
  const out: string[] = [];
  messages.forEach((m, i) => {
    if (m.role !== "assistant") return;
    const next = messages[i + 1];
    const answered = new Set(next ? toolResults(next).map((b) => b.tool_use_id) : []);
    for (const b of blocksOf(m)) if (b.type === "tool_use" && !answered.has(b.id)) out.push(b.id);
  });
  return out;
}

describe("preserveErrors — a call and its answer travel together", () => {
  // The shape of her 18:40 exploration: a read of a missing file several steps back, then more
  // looking. The old step moved the error result alone past the later steps.
  const big = "x".repeat(4000);
  const exploration: Message[] = [
    userMsg("跟着好奇心去看看"),
    callMsg("a1", "a2"),
    resultsMsg([["a1", big], ["a2", big]]),
    callMsg("b1", "b2", "b3"),
    resultsMsg([["b1", "ok"], ["b2", "ENOENT: no such file", true], ["b3", big]]),
    callMsg("c1", "c2"),
    resultsMsg([["c1", big], ["c2", "ok"]]),
    // A long argument (a grep pattern) so a window can end exactly on this call.
    {
      role: "assistant",
      content: [
        { type: "tool_use", id: "d1", name: "grep", input: { pattern: "y".repeat(1000) } },
        { type: "tool_use", id: "d2", name: "read", input: {} },
      ],
    },
    resultsMsg([["d1", big], ["d2", big]]),
  ];

  it("moves the error result together with the call that asked for it", () => {
    // A window that holds only the last two steps puts the error two steps into the old section.
    const result = preserveErrors(exploration, 12000);
    expect(unansweredCalls(result)).toEqual([]);
    expect(result).toHaveLength(exploration.length);
    expect(result.filter((m) => isErrorMessage(m))).toHaveLength(1);
  });

  it("never draws the boundary between a call and its answer", () => {
    // d's results fill 8000 chars and its call pushes past 8500, so the window's edge falls
    // between d's call and d's results, and the moved error would be inserted between them.
    const result = preserveErrors(exploration, 8500);
    expect(unansweredCalls(result)).toEqual([]);
  });
});
