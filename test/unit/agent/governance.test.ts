import { describe, it, expect } from "vitest";
import {
  dropOrphanToolResults,
  backfillMissingToolResults,
  microcompact,
  applyToolResultBudget,
  snipHistory,
  governMessages,
} from "../../../src/agent/governance.js";
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

function toolUseMsg(id: string, name = "read"): Message {
  return {
    role: "assistant",
    content: [{ type: "tool_use", id, name, input: {} }] as ContentBlock[],
  };
}

function toolResultMsg(tool_use_id: string, content = "result content"): Message {
  return {
    role: "user",
    content: [
      { type: "tool_result", tool_use_id, content } as unknown as ContentBlock,
    ],
  };
}

function assistantWithTool(text: string, id: string, name = "read"): Message {
  return {
    role: "assistant",
    content: [
      { type: "text", text },
      { type: "tool_use", id, name, input: {} },
    ] as ContentBlock[],
  };
}

// ── AC1: orphan tool results are dropped ──────────────────────────────────────

describe("dropOrphanToolResults — AC1", () => {
  it("drops a tool_result whose tool_use_id has no matching tool_use", () => {
    const messages: Message[] = [
      userMsg("hello"),
      toolResultMsg("toolu_missing", "orphan result"),
    ];

    const result = dropOrphanToolResults(messages);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(userMsg("hello"));
  });

  it("keeps a tool_result that matches a valid tool_use", () => {
    const messages: Message[] = [
      userMsg("hello"),
      toolUseMsg("toolu_001"),
      toolResultMsg("toolu_001", "valid result"),
    ];

    const result = dropOrphanToolResults(messages);

    expect(result).toHaveLength(3);
  });

  it("drops orphan but keeps valid result when both present", () => {
    const messages: Message[] = [
      userMsg("hello"),
      toolUseMsg("toolu_001"),
      toolResultMsg("toolu_001", "valid"),
      toolResultMsg("toolu_ghost", "orphan"),
    ];

    const result = dropOrphanToolResults(messages);

    expect(result).toHaveLength(3);
    const ids = result
      .filter((m) => Array.isArray(m.content))
      .flatMap((m) =>
        toolResults(m).map((b) => b.tool_use_id)
      );
    expect(ids).toContain("toolu_001");
    expect(ids).not.toContain("toolu_ghost");
  });

  it("does not mutate input array", () => {
    const messages: Message[] = [
      userMsg("hello"),
      toolResultMsg("toolu_missing"),
    ];
    const original = [...messages];
    dropOrphanToolResults(messages);
    expect(messages).toEqual(original);
  });
});

// ── AC2: missing tool results are backfilled ──────────────────────────────────

describe("backfillMissingToolResults — AC2", () => {
  it("injects synthetic error result for tool_use with no matching result", () => {
    const messages: Message[] = [
      userMsg("go"),
      toolUseMsg("toolu_001"),
      // no tool_result follows
    ];

    const result = backfillMissingToolResults(messages);

    expect(result).toHaveLength(3);
    const injected = result[2];
    expect(injected.role).toBe("user");
    expect(Array.isArray(injected.content)).toBe(true);
    expect(blocksOf(injected)[0].type).toBe("tool_result");
    const blocks = toolResults(injected);
    expect(blocks[0].tool_use_id).toBe("toolu_001");
    // In her language: she reads it in place of the result.
    expect(String(blocks[0].content)).toBe("这一下拿回来的东西已经收起来了，看不到了。");
  });

  it("does not inject when result already present", () => {
    const messages: Message[] = [
      userMsg("go"),
      toolUseMsg("toolu_001"),
      toolResultMsg("toolu_001", "ok"),
    ];

    const result = backfillMissingToolResults(messages);

    expect(result).toHaveLength(3);
  });

  it("handles multiple tool_use in one assistant message", () => {
    const messages: Message[] = [
      userMsg("go"),
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "toolu_A", name: "read", input: {} },
          { type: "tool_use", id: "toolu_B", name: "write", input: {} },
        ] as ContentBlock[],
      },
      // neither result present
    ];

    const result = backfillMissingToolResults(messages);

    // Should inject a synthetic message with blocks for both A and B
    expect(result).toHaveLength(3);
    const injected = result[2];
    const blocks = toolResults(injected);
    expect(blocks.length).toBe(2);
    const ids = blocks.map((b) => b.tool_use_id);
    expect(ids).toContain("toolu_A");
    expect(ids).toContain("toolu_B");
  });

  it("does not mutate input array", () => {
    const messages: Message[] = [
      userMsg("go"),
      toolUseMsg("toolu_001"),
    ];
    const original = messages.length;
    backfillMissingToolResults(messages);
    expect(messages).toHaveLength(original);
  });
});

// ── AC3: consecutive same-role messages are merged ────────────────────────────

describe("microcompact — AC3: merge consecutive same-role messages", () => {
  it("merges two consecutive assistant messages into one", () => {
    const messages: Message[] = [
      userMsg("hello"),
      assistantMsg("part one"),
      assistantMsg("part two"),
    ];

    const result = microcompact(messages);

    expect(result).toHaveLength(2);
    expect(result[1].role).toBe("assistant");
    const content = result[1].content;
    const text = typeof content === "string"
      ? content
      : (content as ContentBlock[]).map((b) => (b as { text?: string }).text ?? "").join("");
    expect(text).toContain("part one");
    expect(text).toContain("part two");
  });

  it("merges two consecutive user messages into one", () => {
    const messages: Message[] = [
      userMsg("first"),
      userMsg("second"),
      assistantMsg("response"),
    ];

    const result = microcompact(messages);

    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("user");
  });

  it("does not merge messages of different roles", () => {
    const messages: Message[] = [
      userMsg("question"),
      assistantMsg("answer"),
      userMsg("follow-up"),
    ];

    const result = microcompact(messages);
    expect(result).toHaveLength(3);
  });

  it("does not mutate input array", () => {
    const messages: Message[] = [
      assistantMsg("a"),
      assistantMsg("b"),
    ];
    const original = messages.length;
    microcompact(messages);
    expect(messages).toHaveLength(original);
  });
});

// ── AC4: old large tool results are truncated ─────────────────────────────────

describe("applyToolResultBudget — AC4", () => {
  it("truncates a tool result of 20000 chars older than the recent window to 16000 chars", () => {
    const largeContent = "x".repeat(20000);

    // Place a large old result followed by enough recent content to push it outside the window
    const recentWindowTokens = 20000; // 80000 chars of recent content
    const recentFiller = "r".repeat(80001); // just over the window

    const messages: Message[] = [
      userMsg("start"),
      toolUseMsg("toolu_old"),
      toolResultMsg("toolu_old", largeContent),
      // Large recent content to push old messages outside window
      assistantMsg(recentFiller),
    ];

    const result = applyToolResultBudget(messages, { maxChars: 16000, recentWindowTokens });

    const toolResult = result.find(
      (m) =>
        Array.isArray(m.content) &&
        blocksOf(m).some(
          (b) => b.type === "tool_result" && b.tool_use_id === "toolu_old"
        )
    );

    expect(toolResult).toBeDefined();
    const block = toolResults(toolResult!).find((b) => b.tool_use_id === "toolu_old");
    expect(String(block!.content).length).toBeLessThanOrEqual(16000 + "…[truncated]".length);
    expect(String(block!.content)).toContain("[truncated]");
  });

  it("does not truncate a tool result inside the recent window", () => {
    const content = "x".repeat(20000);
    const messages: Message[] = [
      userMsg("start"),
      toolUseMsg("toolu_recent"),
      toolResultMsg("toolu_recent", content),
    ];

    const result = applyToolResultBudget(messages, { maxChars: 16000, recentWindowTokens: 20000 });

    expect(String(toolResults(result[2])[0].content)).toBe(content); // not truncated
  });

  it("does not mutate input", () => {
    const content = "x".repeat(20000);
    const recentFiller = "r".repeat(80001);
    const messages: Message[] = [
      toolUseMsg("toolu_old"),
      toolResultMsg("toolu_old", content),
      assistantMsg(recentFiller),
    ];
    const originalContent = String(toolResults(messages[1])[0].content);
    applyToolResultBudget(messages, { maxChars: 16000, recentWindowTokens: 20000 });
    expect(
      String(toolResults(messages[1])[0].content)
    ).toBe(originalContent);
  });
});

// ── AC5: snipHistory removes oldest messages in pairs ─────────────────────────

describe("snipHistory — AC5", () => {
  it("removes oldest user+assistant pairs when over budget", () => {
    // Each message is ~400 chars → ~100 tokens
    const filler = "w".repeat(400);
    const messages: Message[] = [
      { role: "user", content: filler },       // ~100 tokens
      { role: "assistant", content: filler },   // ~100 tokens
      { role: "user", content: filler },        // ~100 tokens
      { role: "assistant", content: filler },   // ~100 tokens
      { role: "user", content: filler },        // ~100 tokens
      { role: "assistant", content: filler },   // ~100 tokens
    ];
    // Total ~600 tokens. Budget = 300 → remove first pair (200 tokens) → 400 still over →
    // remove second pair (200 tokens) → 200 tokens under budget

    const result = snipHistory(messages, 300);

    // Should have removed at least the first pair
    expect(result.length).toBeLessThan(messages.length);
    // Remaining messages must start with a user message
    expect(result[0].role).toBe("user");
  });

  it("never removes a user message without its paired assistant response", () => {
    const filler = "x".repeat(2000); // 500 tokens each
    const messages: Message[] = [
      { role: "user", content: filler },      // 500 tokens: oldest pair
      { role: "assistant", content: filler }, // 500 tokens
      { role: "user", content: filler },      // 500 tokens: second pair
      { role: "assistant", content: filler }, // 500 tokens
    ];
    // Total 2000 tokens. Remove first pair (1000 tokens) → 1000 tokens.
    // Budget 1200 → after removing first pair, 1000 <= 1200, stop.

    const result = snipHistory(messages, 1200);

    // We removed the first pair, kept second pair
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
  });

  it("does not remove anything if already under budget", () => {
    const messages: Message[] = [
      userMsg("short"),
      assistantMsg("reply"),
    ];

    const result = snipHistory(messages, 200000);
    expect(result).toHaveLength(2);
  });

  it("does not remove a lone user message at end with no paired assistant", () => {
    const filler = "x".repeat(2000); // 500 tokens each
    const messages: Message[] = [
      { role: "user", content: filler },
      { role: "assistant", content: filler },
      { role: "user", content: filler }, // no paired assistant
    ];
    // Total 1500 tokens. Budget 600.
    // Can remove first pair (1000 tokens) → 500 tokens under budget.
    // Should NOT remove last lone user message.

    const result = snipHistory(messages, 600);

    expect(result[result.length - 1].role).toBe("user");
    // The last user message must still be present
    const lastContent =
      typeof messages[2].content === "string"
        ? messages[2].content
        : "";
    expect(result.some((m) => m.content === lastContent)).toBe(true);
  });

  it("does not mutate input", () => {
    const filler = "x".repeat(2000);
    const messages: Message[] = [
      { role: "user", content: filler },
      { role: "assistant", content: filler },
      { role: "user", content: filler },
      { role: "assistant", content: filler },
    ];
    const original = messages.length;
    snipHistory(messages, 300);
    expect(messages).toHaveLength(original);
  });
});

// ── governMessages: full pipeline ─────────────────────────────────────────────

describe("governMessages — full pipeline", () => {
  it("runs all 5 steps in order", () => {
    // Message with orphan result AND a tool_use with no result
    const messages: Message[] = [
      userMsg("start"),
      toolUseMsg("toolu_valid"),
      toolResultMsg("toolu_valid", "ok"),
      toolResultMsg("toolu_orphan", "orphan"), // orphan: should be dropped
    ];

    const result = governMessages(messages);

    // Orphan dropped
    const orphanPresent = result.some((m) =>
      Array.isArray(m.content) &&
      toolResults(m).some((b) => b.tool_use_id === "toolu_orphan")
    );
    expect(orphanPresent).toBe(false);
  });

  it("accepts optional config", () => {
    const messages: Message[] = [userMsg("hello"), assistantMsg("world")];
    const result = governMessages(messages, { tokenBudget: 1000000 });
    expect(result).toHaveLength(2);
  });
});

// ── governMessages leaves her order alone when nothing will be cut ─

describe("governMessages — errors are moved only when a snip is coming", () => {
  const big = "x".repeat(6000);
  const errorResult = (id: string): Message => ({
    role: "user",
    content: [{ type: "tool_result", tool_use_id: id, content: "ENOENT", is_error: true }],
  });
  const exploration: Message[] = [
    userMsg("跟着好奇心去看看"),
    toolUseMsg("a"),
    toolResultMsg("a", big),
    toolUseMsg("b"),
    errorResult("b"),
    toolUseMsg("c"),
    toolResultMsg("c", big),
    toolUseMsg("d"),
    toolResultMsg("d", big),
    toolUseMsg("e"),
    toolResultMsg("e", big),
    toolUseMsg("f"),
    toolResultMsg("f", big),
    toolUseMsg("g"),
    toolResultMsg("g", big),
    toolUseMsg("h"),
    toolResultMsg("h", big),
  ];

  it("keeps the order she did things in when the whole conversation fits the budget", () => {
    const result = governMessages(exploration);
    const ids = (ms: Message[]) =>
      ms.flatMap((m) => blocksOf(m).map((b) => (b.type === "tool_use" ? `call:${b.id}` : b.type === "tool_result" ? `res:${b.tool_use_id}` : b.type)));
    expect(ids(result)).toEqual(ids(exploration));
  });

  it("when a snip does happen, the error survives it with its call still answered", () => {
    // The old step moved the result alone; the snip then took its call, and the post-snip
    // orphan cleanup threw the result away too, so the error it was protecting was lost.
    const result = governMessages(exploration, { tokenBudget: 6000, recentWindowTokens: 3000 });
    expect(result.length).toBeLessThan(exploration.length);
    expect(result.some((m) => toolResults(m).some((b) => b.tool_use_id === "b"))).toBe(true);
    result.forEach((m, i) => {
      const calls = blocksOf(m).filter((b) => b.type === "tool_use");
      if (calls.length === 0) return;
      const answered = new Set(toolResults(result[i + 1] ?? userMsg("")).map((b) => b.tool_use_id));
      for (const c of calls) if (c.type === "tool_use") expect(answered.has(c.id)).toBe(true);
    });
  });
});
