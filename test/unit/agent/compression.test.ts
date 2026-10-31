import { describe, it, expect } from "vitest";
import { compressPhase1, createCompressor } from "../../../src/agent/compression.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(process.cwd(), "src/agent/compression.ts"), "utf8");
import type { Message, ContentBlock } from "../../../src/providers/types.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function userMsg(text: string): Message {
  return { role: "user", content: text };
}

function assistantMsg(text: string): Message {
  return { role: "assistant", content: text };
}

function toolUseMsg(id: string, name: string, input: Record<string, unknown> = {}): Message {
  return {
    role: "assistant",
    content: [{ type: "tool_use", id, name, input }] as ContentBlock[],
  };
}

function toolResultMsg(tool_use_id: string, content: string): Message {
  return {
    role: "user",
    content: [
      { type: "tool_result", tool_use_id, content } as unknown as ContentBlock,
    ],
  };
}

/** Build a string of approx `chars` characters. */
function bigContent(chars: number): string {
  return "x".repeat(chars);
}


// ── AC1: Phase 1 replaces old tool results with 1-line summaries (~30% savings) ─

describe("compressPhase1 — AC1: old tool results replaced, ~30% savings", () => {
  it("replaces tool results outside the recent window with 1-line summaries", () => {
    // Build messages with large tool results that sit outside the recent window.
    // Recent window = 20000 tokens = 80000 chars.
    // The tail must exceed 80000 chars to push earlier messages out of the window.
    const bigResult = "line content\n".repeat(244); // 245 lines
    const recentTail = bigContent(85000); // 85000 chars > 80000 threshold
    const messages: Message[] = [
      userMsg("hello"),
      toolUseMsg("tu1", "read_file", { path: "/src/app.ts" }),
      toolResultMsg("tu1", bigResult),
      userMsg("what about this"),
      toolUseMsg("tu2", "bash", { command: "npm test" }),
      toolResultMsg("tu2", "exit 0\n".repeat(47)), // 47 lines
      // recent tail: large enough to push earlier messages out of the window
      userMsg(recentTail),
      assistantMsg("ok"),
    ];

    const result = compressPhase1(messages, 20000);

    // Tool results outside recent window should be summarized.
    const r1 = result.messages[2];
    expect(r1.role).toBe("user");
    const blocks1 = r1.content as unknown as Array<Record<string, unknown>>;
    expect(typeof blocks1[0].content).toBe("string");
    expect(String(blocks1[0].content)).toMatch(/^（早先 read_file「\/src\/app\.ts」拿回来的 \d+ 行，收起来了）$/);

    const r2 = result.messages[5];
    const blocks2 = r2.content as unknown as Array<Record<string, unknown>>;
    expect(String(blocks2[0].content)).toMatch(/^（早先 bash「npm test」拿回来的 \d+ 行，收起来了）$/);

    // Tokens saved: the old tool results were replaced with short summaries.
    expect(result.tokensSaved).toBeGreaterThan(0);
  });

  it("achieves ~30% savings when old tool results dominate the conversation", () => {
    // Simulate a conversation where old tool results make up the bulk of tokens.
    // Total ≈ 200K tokens:
    //   old tool results: ~50K tokens = 200K chars (6 results × ~33K chars each)
    //   recent tail: ~20K tokens = 80001 chars (just over the window)
    //   rest: negligible
    const oldResult = bigContent(33000) + "\n".repeat(99); // 100 lines, 33100 chars
    const recentTail = bigContent(80001); // forces earlier messages outside window

    const messages: Message[] = [
      userMsg("start"),
      ...Array.from({ length: 6 }, (_, i) => [
        toolUseMsg(`tu${i}`, "read_file", { path: `/file${i}.ts` }),
        toolResultMsg(`tu${i}`, oldResult),
      ]).flat(),
      userMsg(recentTail),
      assistantMsg("done"),
    ];

    const result = compressPhase1(messages, 20000);

    // All 6 old tool results should be summarized.
    let summarizedCount = 0;
    for (const msg of result.messages) {
      if (msg.role !== "user") continue;
      const c = msg.content;
      if (!Array.isArray(c)) continue;
      for (const block of c as unknown as Array<Record<string, unknown>>) {
        if (block.type === "tool_result" && String(block.content).startsWith("（早先 ")) {
          summarizedCount++;
        }
      }
    }
    expect(summarizedCount).toBe(6);

    // ~30% of total tokens should be saved.
    const totalOriginalChars =
      33100 * 6 + // 6 old tool results
      80001 +     // recent tail
      100; // overhead estimate
    const totalOriginalTokens = totalOriginalChars / 4;
    const savingsRatio = result.tokensSaved / totalOriginalTokens;
    expect(savingsRatio).toBeGreaterThanOrEqual(0.3);
  });

  it("keeps tool results inside the recent window intact", () => {
    const recentResult = "recent content\nline2";
    // Only a few messages: all within recent window.
    const messages: Message[] = [
      userMsg("hello"),
      toolUseMsg("tu1", "read_file", { path: "/src/main.ts" }),
      toolResultMsg("tu1", recentResult),
    ];

    const result = compressPhase1(messages, 20000);

    const resultMsg = result.messages[2];
    const blocks = resultMsg.content as unknown as Array<Record<string, unknown>>;
    expect(String(blocks[0].content)).toBe(recentResult);
    expect(result.tokensSaved).toBe(0);
  });

  it("removes thinking blocks from older turns", () => {
    const thinkingBlock = { type: "thinking", thinking: "secret thoughts" };
    const messages: Message[] = [
      {
        role: "assistant",
        content: [thinkingBlock, { type: "text", text: "hello" }] as unknown as ContentBlock[],
      },
      // Add enough tail content to push the thinking message outside recent window.
      userMsg(bigContent(80001)),
    ];

    const result = compressPhase1(messages, 20000);

    // The thinking block is dropped, and nothing the machine writes stands in its place in HER
    // turn: her own words are all that remain.
    const firstMsg = result.messages[0];
    const blocks = firstMsg.content as unknown as Array<Record<string, unknown>>;
    expect(blocks.some((b) => b.type === "thinking")).toBe(false);
    expect(blocks).toEqual([{ type: "text", text: "hello" }]);
  });

  it("a turn that was only thinking keeps a quiet placeholder in her language, never English", () => {
    // Both casts: a thinking block is a runtime shape the compile-time ContentBlock union does not
    // name, and the compressed content is read back structurally.
    const messages: Message[] = [
      { role: "assistant", content: [{ type: "thinking", thinking: "…" }] as unknown as ContentBlock[] },
      userMsg(bigContent(80001)),
    ];
    const blocks = compressPhase1(messages, 20000).messages[0].content as unknown as Array<Record<string, unknown>>;
    expect(blocks).toEqual([{ type: "text", text: "（想过的，收起来了）" }]);
  });

  it("never calls any LLM — is a pure synchronous function", () => {
    // compressPhase1 returns CompressionResult (not a Promise)
    const result = compressPhase1([userMsg("hi")]);
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.messages).toBeInstanceOf(Array);
  });
});

// ── AC2: Phase 2 preserves head+tail, LLM-summarizes middle ──────────────────

describe("createCompressor — deterministic only (E-1)", () => {
  it("never calls the model, whatever the savings ratio", async () => {
    // Phase 2 used to paraphrase the middle of her conversation through a background model
    // and splice the English summary back in as a user message. That was removed; the
    // compressor is now pure arithmetic, and a message set that used to force phase 2
    // (no tool results, tiny phase-1 savings) simply comes back phase-1-compressed.
    const { compress } = createCompressor();
    const messages: Message[] = [
      userMsg("head"),
      assistantMsg("head reply"),
      ...Array.from({ length: 6 }, (_, i) => [userMsg(`q${i}`), assistantMsg(`a${i}`)]).flat(),
      userMsg(bigContent(85000)),
      assistantMsg("tail"),
    ];
    const result = await compress(messages);
    expect(result.summary).toContain("Phase 1 compression");
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it("uses phase 1's replacement of old tool results when they dominate", async () => {
    const bigResult = bigContent(50000);
    const recentTail = bigContent(85000);
    const messages: Message[] = [
      userMsg("start"),
      toolUseMsg("tu1", "read_file", { path: "/big.ts" }),
      toolResultMsg("tu1", bigResult),
      userMsg(recentTail),
      assistantMsg("done"),
    ];
    const { compress } = createCompressor();
    const result = await compress(messages);
    expect(result.summary).toContain("Phase 1 compression");
  });

  it("the source keeps no summarizer and no provider path", () => {
    expect(SRC.includes("SUMMARIZER_SYSTEM"), "the conversation compactor persona is back").toBe(false);
    expect(SRC.includes("Compaction summary"), "the English splice marker is back").toBe(false);
    expect(SRC.includes("provider.complete"), "a model call inside the compressor").toBe(false);
  });
});
