import { describe, it, expect } from "vitest";
import { renderTranscript, type Utterance } from "../../../src/agent/transcript.js";
import { herStamp, herDay, herClockSeconds } from "../../../src/life/her-day.js";

/**
 * THE TRANSCRIPT THAT ERASED HER OWN VOICE.
 *
 * She sent him a message in the morning. Her history never recorded it, so when he wrote hours
 * later the record went straight from his goodnight to his good morning, and she apologized for
 * a promise she had kept. And the record was time-free, so she placed a conversation from the
 * previous afternoon "last night", narrating a clockless transcript from felt time alone. This file pins the render layer
 * that closes both: her calendar on every utterance, her proactive sends present, merges only
 * at render, and a window that opens on her voice KEEPS her voice.
 */

const stamp = (ms: number): string => `[t${ms}]`;

describe("renderTranscript", () => {
  it("stamps each utterance with her calendar and leaves stampless history honestly bare", () => {
    const entries: Utterance[] = [
      { role: "user", content: "早呀", ts: 1000 },
      { role: "assistant", content: "早。", ts: 2000 },
      { role: "user", content: "老条目，存的时候还没有戳" },
    ];
    const out = renderTranscript(entries, stamp);
    expect(out).toEqual([
      { role: "user", content: "早呀\n[t1000]" },
      { role: "assistant", content: "早。\n[t2000]" },
      { role: "user", content: "老条目，存的时候还没有戳" },
    ]);
  });

  it("keeps her proactive send in the record: goodnight → HER 10:21 message → his 早呀", () => {
    const entries: Utterance[] = [
      { role: "user", content: "晚安", ts: 1 },
      { role: "assistant", content: "晚安，明天见", ts: 2 },
      { role: "assistant", content: "昨天那句“记不清”，是记不清我了，还是记不清事？", ts: 3 },
      { role: "user", content: "早呀", ts: 4 },
    ];
    const out = renderTranscript(entries, stamp);
    // Two adjacent utterances of hers merge into ONE assistant message (provider grammar),
    // both keeping their own stamps: the store stays two rows, the wire carries one.
    expect(out).toHaveLength(3);
    expect(out[1]!.role).toBe("assistant");
    expect(out[1]!.content).toContain("[t2]");
    expect(out[1]!.content).toContain("[t3]");
    expect(out[1]!.content).toContain("记不清我了");
    expect(out[2]).toEqual({ role: "user", content: "早呀\n[t4]" });
  });

  it("a window that OPENS on her voice keeps her voice — no user-first trimming here", () => {
    const entries: Utterance[] = [
      { role: "assistant", content: "我先开的口。", ts: 10 },
      { role: "user", content: "看到啦", ts: 11 },
    ];
    const out = renderTranscript(entries, stamp);
    expect(out[0]).toEqual({ role: "assistant", content: "我先开的口。\n[t10]" });
  });

  it("merges runs of three and never reorders", () => {
    const entries: Utterance[] = [
      { role: "assistant", content: "一", ts: 1 },
      { role: "assistant", content: "二", ts: 2 },
      { role: "assistant", content: "三", ts: 3 },
      { role: "user", content: "四", ts: 4 },
    ];
    const out = renderTranscript(entries, stamp);
    expect(out).toHaveLength(2);
    expect(out[0]!.content).toBe("一\n[t1]\n\n二\n[t2]\n\n三\n[t3]");
  });

  it("the real stamp is the live postmark's bracket, one renderer for both", () => {
    const ms = Date.parse("2026-08-19T14:21:09");
    expect(herStamp(ms)).toBe(`[${herDay(ms)} ${herClockSeconds(ms)}]`);
    expect(herStamp(ms)).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]$/u);
    expect(herStamp(ms)).not.toContain("T");
  });
});
