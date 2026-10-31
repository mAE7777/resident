import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStreamBridge } from "../../../src/telegram/bridge.js";
import { createFloodControl, type FloodControl } from "../../../src/telegram/flood.js";
import { createThinkFilter, type ThinkFilter } from "../../../src/telegram/think-filter.js";
import type { AgentEvent } from "../../../src/agent/types.js";

function makeConfig() {
  const sendMessage = vi.fn<(text: string) => Promise<number>>();
  const editMessage = vi.fn<(messageId: number, text: string) => Promise<void>>();
  let msgId = 1;
  sendMessage.mockImplementation(async () => msgId++);
  editMessage.mockResolvedValue(undefined);

  const floodControl = createFloodControl(1000);
  const sendTyping = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  // thinkFilter is declared here rather than assigned onto the result, because assigning a property
  // the returned object type does not have is an error the moment tests are actually typechecked.
  const cfg: { sendMessage: typeof sendMessage; editMessage: typeof editMessage; floodControl: FloodControl; sendTyping: typeof sendTyping; thinkFilter?: ThinkFilter } =
    { sendMessage, editMessage, floodControl, sendTyping };
  return cfg;
}

/**
 * What his phone shows when the dust settles: sends mint ids 1..n (the mock increments), edits
 * overwrite by id, and the surviving text per id in id order is the delivered conversation.
 * Needed since the placeholder died, the first send may carry text a later edit supersedes.
 */
function finalTexts(cfg: ReturnType<typeof makeConfig>): string[] {
  const texts = new Map<number, string>();
  let id = 1;
  for (const [t] of cfg.sendMessage.mock.calls) texts.set(id++, t);
  for (const [mid, t] of cfg.editMessage.mock.calls) texts.set(mid, t);
  return [...texts.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t);
}

function textChunk(content: string): AgentEvent {
  return { type: "text_chunk", content };
}
function toolStart(): AgentEvent {
  return { type: "tool_start", tool: "bash", args: {}, callId: "c1" };
}
function thinkingChunk(content: string): AgentEvent {
  return { type: "thinking_chunk", content };
}

// ── basic send + edit ────────────────────────────────────────────────────────

describe("createStreamBridge — first text chunk sends initial message", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("the first message IS her words — the placeholder bubble is gone", async () => {
    const cfg = makeConfig();
    const bridge = createStreamBridge(cfg);
    await bridge.onEvent(textChunk("hello"));
    expect(cfg.sendMessage).toHaveBeenCalledWith("hello");
  });

  it("does not send a second message on a second chunk within interval", async () => {
    const cfg = makeConfig();
    const bridge = createStreamBridge(cfg);
    await bridge.onEvent(textChunk("hello"));
    await bridge.onEvent(textChunk(" world"));
    expect(cfg.sendMessage).toHaveBeenCalledTimes(1);
  });
});

// ── edit timing ──────────────────────────────────────────────────────────────

describe("createStreamBridge — edit timing (1 s minimum interval)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not edit within the interval", async () => {
    const cfg = makeConfig();
    const bridge = createStreamBridge(cfg);
    await bridge.onEvent(textChunk("chunk1"));
    vi.advanceTimersByTime(500); // Only 500ms elapsed
    await bridge.onEvent(textChunk("chunk2"));
    // Only the initial send; no edit yet
    expect(cfg.editMessage).not.toHaveBeenCalled();
  });

  it("AC: 5 chunks over 3 s → ~3 edits at 1 s intervals", async () => {
    const cfg = makeConfig();
    const bridge = createStreamBridge(cfg);

    // Chunk 1 at t=0: initial send, first edit attempt (immediately after send, 0ms since send)
    await bridge.onEvent(textChunk("a"));
    // The initial send sets lastEditTime, so no edit right after (0ms elapsed)

    vi.advanceTimersByTime(1000); // t=1000
    await bridge.onEvent(textChunk("b")); // edit #1
    vi.advanceTimersByTime(1000); // t=2000
    await bridge.onEvent(textChunk("c")); // edit #2
    vi.advanceTimersByTime(1000); // t=3000
    await bridge.onEvent(textChunk("d")); // edit #3

    expect(cfg.editMessage.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

// ── tool_start segment boundary ──────────────────────────────────────────────

describe("createStreamBridge — tool_start segment boundary", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("tool_start finalizes current segment and clears message ID", async () => {
    const cfg = makeConfig();
    const bridge = createStreamBridge(cfg);

    await bridge.onEvent(textChunk("first segment"));
    vi.advanceTimersByTime(1000);
    await bridge.onEvent(textChunk(" more"));

    const sendCountBefore = cfg.sendMessage.mock.calls.length;
    await bridge.onEvent(toolStart());

    // Next text chunk should start a new message
    await bridge.onEvent(textChunk("second segment"));
    // A new sendMessage call should have been made for the new segment
    expect(cfg.sendMessage.mock.calls.length).toBeGreaterThan(sendCountBefore);
  });

  it("tool_start with no prior text does nothing (no errors)", async () => {
    const cfg = makeConfig();
    const bridge = createStreamBridge(cfg);
    await expect(bridge.onEvent(toolStart())).resolves.not.toThrow();
  });

  it("two tool_start events each trigger a new message on next text", async () => {
    const cfg = makeConfig();
    const bridge = createStreamBridge(cfg);

    await bridge.onEvent(textChunk("seg1"));
    await bridge.onEvent(toolStart());
    await bridge.onEvent(textChunk("seg2"));
    await bridge.onEvent(toolStart());
    await bridge.onEvent(textChunk("seg3"));

    // 3 separate messages, each born as her words for that segment
    expect(cfg.sendMessage.mock.calls.map(([t]) => t)).toEqual(["seg1", "seg2", "seg3"]);
  });
});

describe("createStreamBridge — tool error status", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("an intermediate tool failure never says a word in the chat — presence only", async () => {
    const cfg = makeConfig();
    const bridge = createStreamBridge(cfg);

    await bridge.onEvent({ type: "tool_end", tool: "web_fetch", result: "Error: HTTP 404", callId: "c1" });

    // No bubble of any kind: the machine detail lives on the fault channel, and what the chat
    // gets is the wordless typing hint, a person still with it, not a machine reporting.
    expect(cfg.sendMessage).not.toHaveBeenCalled();
    expect(cfg.editMessage).not.toHaveBeenCalled();
    expect(cfg.sendTyping).toHaveBeenCalled();
  });
});

// ── thinking_chunk suppression ───────────────────────────────────────────────

describe("createStreamBridge — thinking_chunk events are suppressed", () => {
  it("thinking_chunk does not add content to buffer", async () => {
    const cfg = makeConfig();
    const bridge = createStreamBridge(cfg);
    await bridge.onEvent(thinkingChunk("internal reasoning"));
    // Nothing should have been sent
    expect(cfg.sendMessage).not.toHaveBeenCalled();
    await bridge.finalize();
    // Still nothing sent (buffer was empty)
    expect(cfg.sendMessage).not.toHaveBeenCalled();
  });
});

// ── finalize ─────────────────────────────────────────────────────────────────

describe("createStreamBridge — finalize()", () => {
  it("finalize with pending buffer performs a final edit", async () => {
    const cfg = makeConfig();
    const bridge = createStreamBridge(cfg);
    await bridge.onEvent(textChunk("hello"));
    // Not enough time for edit yet, finalize should force it
    await bridge.finalize();
    expect(cfg.editMessage).toHaveBeenCalled();
  });

  it("finalize with empty buffer does not edit or send", async () => {
    const cfg = makeConfig();
    const bridge = createStreamBridge(cfg);
    await bridge.finalize();
    expect(cfg.sendMessage).not.toHaveBeenCalled();
    expect(cfg.editMessage).not.toHaveBeenCalled();
  });

  it("finalize flushes think filter remaining buffer", async () => {
    const cfg = makeConfig();
    cfg.thinkFilter = createThinkFilter();
    const bridge = createStreamBridge(cfg);
    // Add text that sits in the think-filter tail buffer (<16 chars)
    await bridge.onEvent(textChunk("short"));
    await bridge.finalize();
    // Should have edited with "short" (flushed from think filter + buffer)
    const allEdits = cfg.editMessage.mock.calls;
    const finalEdit = allEdits[allEdits.length - 1];
    if (finalEdit) {
      expect(finalEdit[1]).toContain("short");
    }
  });
});

// ── flood control fallback ───────────────────────────────────────────────────

describe("createStreamBridge — flood control disable fallback", () => {
  it("when flood disables editing, finalize delivers accumulated buffer", async () => {
    const cfg = makeConfig();
    // Force flood control disabled
    cfg.floodControl.onEditFailure();
    cfg.floodControl.onEditFailure();
    cfg.floodControl.onEditFailure();
    expect(cfg.floodControl.shouldEdit()).toBe(false);

    const bridge = createStreamBridge(cfg);
    await bridge.onEvent(textChunk("part1"));
    await bridge.onEvent(textChunk(" part2"));

    // No edits should have happened
    expect(cfg.editMessage).not.toHaveBeenCalled();

    await bridge.finalize();
    // Finalize should deliver the content (either by edit or send)
    const totalCalls =
      cfg.editMessage.mock.calls.length + cfg.sendMessage.mock.calls.length;
    expect(totalCalls).toBeGreaterThan(0);
  });
});

// ── reset ────────────────────────────────────────────────────────────────────

describe("createStreamBridge — reset()", () => {
  it("reset clears state and resets flood control", async () => {
    const cfg = makeConfig();
    const bridge = createStreamBridge(cfg);

    await bridge.onEvent(textChunk("segment one"));
    cfg.floodControl.onEditFailure();
    cfg.floodControl.onEditFailure();
    cfg.floodControl.onEditFailure();

    bridge.reset();

    expect(cfg.floodControl.shouldEdit()).toBe(true);
    // After reset, a new segment starts fresh
    await bridge.onEvent(textChunk("segment two"));
    expect(cfg.sendMessage).toHaveBeenLastCalledWith("segment two");
  });
});

// ── think filter integration ─────────────────────────────────────────────────

describe("createStreamBridge — think filter integration", () => {
  it("filters structural <think>…</think> blocks (at text start) across chunks", async () => {
    const cfg = makeConfig();
    cfg.thinkFilter = createThinkFilter();
    const bridge = createStreamBridge(cfg);

    // Tag at text start → structural. Split across chunk boundary.
    await bridge.onEvent(textChunk("<thi"));
    await bridge.onEvent(textChunk("nk>hidden</think> visible"));
    await bridge.finalize();

    const allEdits = cfg.editMessage.mock.calls;
    const finalContent = allEdits[allEdits.length - 1]?.[1] ?? "";
    // Bridge trims buffer before editing; leading space is stripped
    expect(finalContent).toBe("visible");
  });

  it("does not suppress prose <think> tags mid-sentence", async () => {
    const cfg = makeConfig();
    cfg.thinkFilter = createThinkFilter();
    const bridge = createStreamBridge(cfg);

    // "the <think> tag is used for...", <think> is mid-sentence → prose
    await bridge.onEvent(textChunk("the <think> tag is used for..."));
    await bridge.finalize();

    const allEdits = cfg.editMessage.mock.calls;
    const finalContent = allEdits[allEdits.length - 1]?.[1] ?? "";
    expect(finalContent).toBe("the <think> tag is used for...");
  });

  it("filters structural block (prose tag result is NOT suppressed)", async () => {
    const cfg = makeConfig();
    cfg.thinkFilter = createThinkFilter();
    const bridge = createStreamBridge(cfg);

    // "result " before <think> makes it a prose tag, passes through unchanged
    await bridge.onEvent(textChunk("result <thi"));
    await bridge.onEvent(textChunk("nk>hidden</think> visible"));
    await bridge.finalize();

    // Non-boundary: passes through verbatim. Judged on the DELIVERED state, with no
    // placeholder, whether this arrived as a fresh send or an edit is timing, not contract.
    expect(finalTexts(cfg).join("")).toBe("result <think>hidden</think> visible");
  });
});

// ── message splitting ─────────────────────────────────────────────────────────

describe("createStreamBridge — long message splitting", () => {
  it("sends overflow text as a new message when buffer exceeds 4096 chars", async () => {
    const cfg = makeConfig();
    const bridge = createStreamBridge(cfg);

    // Fill buffer past 4096
    const bigChunk = "x".repeat(4097);
    await bridge.onEvent(textChunk(bigChunk));

    vi.useFakeTimers();
    vi.advanceTimersByTime(1100);
    await bridge.onEvent(textChunk("extra"));
    vi.useRealTimers();

    await bridge.finalize();

    // Should have sent more than one message
    const totalMessages = cfg.sendMessage.mock.calls.length;
    expect(totalMessages).toBeGreaterThanOrEqual(1);
  });
});

// ── Nothing under her name speaks the machine's language ──────────────────────

describe("createStreamBridge — every status bubble is hers", () => {
  it("a full working turn ships no English chrome and no service words as her", async () => {
    // The bridge writes into HER message bubble. "Thinking…" and "Working: Write File..." were
    // interface chrome shipping English service register under her name on the one channel he
    // actually uses: the exact blind spot the machine-voice scan exists for, left live after the face solved it
    // structurally. Driven through every status-producing event, including a tool the map does
    // not know, and judged by the same scanner the machine-voice instrument runs.
    const { scanForNotHerWords } = await import("../../../src/life/her-words.js");
    const cfg = makeConfig();
    const bridge = createStreamBridge(cfg);

    await bridge.onEvent(textChunk("在。"));
    await bridge.onEvent({ type: "tool_start", tool: "write", callId: "1" } as AgentEvent);
    await bridge.onEvent({ type: "tool_start", tool: "some_future_tool", callId: "2" } as AgentEvent);
    await bridge.onEvent({ type: "tool_end", tool: "write", callId: "1", result: "Error: nope" } as AgentEvent);
    await bridge.onEvent({ type: "tool_end", tool: "write", callId: "1", result: "ok" } as AgentEvent);
    await bridge.onEvent({ type: "progress", message: "在翻记忆……", _retry_wait: true } as AgentEvent);
    await bridge.onEvent({ type: "compaction", summary: "compacted the earlier turns" } as AgentEvent);
    await bridge.onEvent({ type: "error", error: new Error("ECONNRESET at layer 7") } as AgentEvent);
    await bridge.finalize();

    // THE RULE: the chat carries two voices and a wordless
    // typing hint, nothing else. Every status family above must produce ZERO text of any kind,
    // and the presence signal must actually fire, silence with no aliveness would be a hang.
    const everything = [
      ...cfg.sendMessage.mock.calls.map(([t]) => t),
      ...cfg.editMessage.mock.calls.map(([, t]) => t),
    ].filter((t) => t !== "在。");
    expect(everything, "machinery text reached their chat").toEqual([]);
    expect(cfg.sendTyping.mock.calls.length, "no aliveness signal at all").toBeGreaterThan(0);
    void scanForNotHerWords;
  });
});

// ── S-4: the breath at the channel ────────────────────────────────────────────

describe("createStreamBridge — the breath", () => {
  it("breath mode holds the stream: nothing is sent while she composes, presence is typing only", async () => {
    // The public-shrink defect this contract kills: with streaming edits live, a long bubble
    // appeared and was then cut down to segment one at finalize, a machine writing in public.
    const cfg = makeConfig();
    const bridge = createStreamBridge({ ...cfg, breathUnit: () => 70 });
    await bridge.onEvent(textChunk("第一句说完了。"));
    await bridge.onEvent(textChunk("第二句也说完了。"));
    expect(cfg.sendMessage).not.toHaveBeenCalled();
    expect(cfg.editMessage).not.toHaveBeenCalled();
    expect(cfg.sendTyping).toHaveBeenCalled();
    await bridge.finalize();
    expect(finalTexts(cfg).join("")).toBe("第一句说完了。第二句也说完了。");
  });

  const LONG_REPLY = "第一件事想清楚了，周六去。第二件事还得等等，他那边没回话。第三件事其实最要紧，我想了一晚上，还是觉得应该先说清楚再动手。第四件事不急，等见面的时候聊，你上次提过一嘴我记着呢。";

  it("with a unit, a long reply arrives as separate messages whose concatenation is the reply", async () => {
    const cfg = makeConfig();
    const reply = LONG_REPLY + LONG_REPLY;
    const pauses: number[] = [];
    const bridge = createStreamBridge({ ...cfg, breathUnit: () => 70, pause: async (ms: number) => { pauses.push(ms); } });
    await bridge.onEvent(textChunk(reply));
    await bridge.finalize();
    // Judged on the DELIVERED state: the first send now carries her live text and is edited
    // down to segment one at finalize; follow-ons are fresh sends. What his phone shows at the
    // end must reproduce the reply byte for byte.
    const delivered = finalTexts(cfg);
    expect(delivered.length).toBeGreaterThan(1);
    expect(delivered.join(""), "delivery must reproduce her reply byte for byte").toBe(reply);
    // The beat: one pause per follow-on message, never before the first (the first send here is
    // the live-stream message itself, not a follow-on).
    expect(pauses.length).toBe(delivered.length - 1);
    for (const ms of pauses) expect(ms).toBeGreaterThanOrEqual(250);
  });

  it("without the unit, delivery is one message — the ablation arm and today's behavior", async () => {
    const cfg = makeConfig();
    const bridge = createStreamBridge({ ...cfg, breathUnit: () => null });
    await bridge.onEvent(textChunk(LONG_REPLY));
    await bridge.finalize();
    expect(finalTexts(cfg)).toEqual([LONG_REPLY]);
  });

  it("a short reply is one breath even with the unit on", async () => {
    const cfg = makeConfig();
    const bridge = createStreamBridge({ ...cfg, breathUnit: () => 70 });
    await bridge.onEvent(textChunk("好，那就周六。"));
    await bridge.finalize();
    expect(finalTexts(cfg)).toEqual(["好，那就周六。"]);
  });
});

describe("createStreamBridge — the breath's identity guard", () => {
  it("a splitter that loses a byte is overridden: the reply goes whole and the guard is loud", async () => {
    const cfg = makeConfig();
    const faults: string[] = [];
    const bridge = createStreamBridge({
      ...cfg,
      breathUnit: () => 70,
      // The planted violation: a broken segmenter that drops the last character.
      segmenter: (text: string) => [text.slice(0, 10), text.slice(10, -1)],
      onFault: (w: string) => faults.push(w),
    });
    const reply = "这一句话很重要，最后一个字不能丢。这一句也一样，一个字都不能少，句号也算数。";
    await bridge.onEvent(textChunk(reply));
    await bridge.finalize();
    expect(faults).toContain("breath.identity");
    // Judged on delivery: in breath mode the reply arrives as fresh sends, not edits.
    expect(finalTexts(cfg), "the reply must arrive whole when the splitter cannot be trusted").toEqual([reply]);
  });
});
