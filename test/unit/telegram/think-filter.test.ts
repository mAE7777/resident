import { describe, it, expect } from "vitest";
import { createThinkFilter } from "../../../src/telegram/think-filter.js";

// ── basic pass-through ───────────────────────────────────────────────────────

describe("createThinkFilter — pass-through text", () => {
  it("short text (< MAX_TAG_LEN) is buffered and returned on flush", () => {
    const f = createThinkFilter();
    const out = f.process("hello");
    expect(out + f.flush()).toBe("hello");
  });

  it("longer text (> MAX_TAG_LEN) with no tags is emitted immediately", () => {
    const f = createThinkFilter();
    const text = "a".repeat(100);
    const out = f.process(text);
    expect(out + f.flush()).toBe(text);
  });

  it("empty chunk produces no output", () => {
    const f = createThinkFilter();
    expect(f.process("")).toBe("");
    expect(f.flush()).toBe("");
  });
});

// ── basic suppression ────────────────────────────────────────────────────────

describe("createThinkFilter — basic suppression of structural blocks", () => {
  it("suppresses a complete <think>…</think> block at text start", () => {
    const f = createThinkFilter();
    const out = f.process("<think>hidden</think> visible");
    expect(out + f.flush()).toBe(" visible");
  });

  it("suppresses block at start, passes trailing text", () => {
    const f = createThinkFilter();
    const out = f.process("<think>internal</think>answer");
    expect(out + f.flush()).toBe("answer");
  });

  it("suppresses block after a blank prefix (only whitespace/newlines before tag)", () => {
    const f = createThinkFilter();
    const out = f.process("\n<think>hidden</think>rest");
    expect(out + f.flush()).toBe("\nrest");
  });

  it("suppresses block after only-whitespace prefix (spaces + newlines)", () => {
    const f = createThinkFilter();
    const out = f.process("  \n  <think>hidden</think>rest");
    expect(out + f.flush()).toBe("  \n  rest");
  });
});

// ── block boundary detection: prose protection ──────────────────────────────

describe("createThinkFilter — block boundary detection", () => {
  it("prose <think> mid-sentence passes through verbatim", () => {
    const f = createThinkFilter();
    // AC: text discussing the <think> tag
    const text = "the <think> tag is used for...";
    const out = f.process(text);
    expect(out + f.flush()).toBe(text);
  });

  it("<think> after non-whitespace word is treated as prose", () => {
    const f = createThinkFilter();
    const text = "result <think>hidden</think> visible";
    const out = f.process(text);
    // "result " before tag is non-boundary → prose → passes through unchanged
    expect(out + f.flush()).toBe(text);
  });

  it("<think> after non-empty line content is prose", () => {
    const f = createThinkFilter();
    const text = "intro content <think>hidden</think>";
    const out = f.process(text);
    expect(out + f.flush()).toBe(text);
  });

  it("<think> at start of text (idx=0) is always structural", () => {
    const f = createThinkFilter();
    const out = f.process("<think>hidden</think>visible");
    expect(out + f.flush()).toBe("visible");
  });

  it("<think> at start of new block (after blank line) is structural", () => {
    const f = createThinkFilter();
    // pre = "\n\n" which trimEnd()s to "" → structural
    const out = f.process("\n\n<think>hidden</think>end");
    expect(out + f.flush()).toBe("\n\nend");
  });
});

// ── cross-chunk tag splitting ────────────────────────────────────────────────

describe("createThinkFilter — cross-chunk tag splitting", () => {
  it("handles <think> split across two chunks (structural — at text start)", () => {
    const f = createThinkFilter();
    const out1 = f.process("<thi");
    const out2 = f.process("nk>hidden</think> visible");
    expect(out1 + out2 + f.flush()).toBe(" visible");
  });

  it("handles </think> split across two chunks", () => {
    const f = createThinkFilter();
    const out1 = f.process("<think>hidden</thi");
    const out2 = f.process("nk> after");
    expect(out1 + out2 + f.flush()).toBe(" after");
  });

  it("handles tag split into three chunks", () => {
    const f = createThinkFilter();
    const out1 = f.process("<t");
    const out2 = f.process("hin");
    const out3 = f.process("k>secret</think>ok");
    expect(out1 + out2 + out3 + f.flush()).toBe("ok");
  });

  it("multiple chunks with think block suppressed across boundary", () => {
    const f = createThinkFilter();
    const out1 = f.process("<think>lots");
    const out2 = f.process(" of hidden");
    const out3 = f.process(" content</think>visible");
    expect(out1 + out2 + out3 + f.flush()).toBe("visible");
  });

  it("prose tag split across chunks still passes through", () => {
    const f = createThinkFilter();
    // "result <thi" → no full tag yet, buffer held
    // "nk>hidden</think> visible" → combined: "result <think>hidden</think> visible"
    // "result " is non-empty non-newline → prose → passes through
    const out1 = f.process("result <thi");
    const out2 = f.process("nk>hidden</think> visible");
    // Both chunks combined produce the full original text (passed through as prose)
    expect(out1 + out2 + f.flush()).toBe("result <think>hidden</think> visible");
  });
});

// ── flush() ──────────────────────────────────────────────────────────────────

describe("createThinkFilter — flush()", () => {
  it("flush returns empty string when stream ends inside a block", () => {
    const f = createThinkFilter();
    f.process("<think>never closed");
    expect(f.flush()).toBe("");
  });

  it("flush resets state so filter is usable after flush", () => {
    const f = createThinkFilter();
    f.process("<think>unclosed");
    f.flush();
    const out = f.process("fresh start text with more content");
    expect(out + f.flush()).toBe("fresh start text with more content");
  });

  it("flush on idle filter returns empty string", () => {
    const f = createThinkFilter();
    expect(f.flush()).toBe("");
  });

  it("flush releases held tail buffer that never became a tag", () => {
    const f = createThinkFilter();
    // "end" is 3 chars < MAX_TAG_LEN=16, so held in buffer
    const out = f.process("<think>hidden</think>end");
    // "end" was held, flush releases it
    expect(out + f.flush()).toBe("end");
  });
});

// ── edge cases ───────────────────────────────────────────────────────────────

describe("createThinkFilter — edge cases", () => {
  it("sequential blocks: second block after newline is also suppressed", () => {
    const f = createThinkFilter();
    // First block at start → structural. Second at idx > 0 but after newline.
    // After first block, text "\n" precedes second block.
    // pre of second = "\n" → trimEnd = "" → structural
    const out = f.process("<think>a</think>\n<think>b</think>end");
    expect(out + f.flush()).toBe("\nend");
  });

  it("multiple prose tags in one chunk all pass through", () => {
    const f = createThinkFilter();
    // Both <think> are prose (non-boundary)
    const text = "use <think> here and <think> there for reasoning";
    const out = f.process(text);
    expect(out + f.flush()).toBe(text);
  });

  it("structural block immediately followed by prose block", () => {
    const f = createThinkFilter();
    // Structural: at start. After it, text "see the <think> tag" is prose.
    const out = f.process("<think>hidden</think>see the <think> tag");
    expect(out + f.flush()).toBe("see the <think> tag");
  });

  it("does not double-emit text when close tag arrives late", () => {
    const f = createThinkFilter();
    f.process("<think>lots of hidden content here");
    const out = f.process("</think>visible");
    expect(out + f.flush()).toBe("visible");
  });
});
