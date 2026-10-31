import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createMomentHandlers, type HandlerDeps } from "../../../src/life/agency-handlers.js";
import type { MomentContext } from "../../../src/life/agency.js";
import type { InnerSnapshot } from "../../../src/life/inner-state.js";
import type { ExpressionContext } from "../../../src/life/expression.js";
import type { LLMProvider, LLMResponse } from "../../../src/providers/types.js";

function snapshot(over: Partial<InnerSnapshot> = {}): InnerSnapshot {
  return {
    drives: { discomfort: 0.1, care: 0.2, social: 0.8, curiosity: 0.4, expression: 0.6, maintenance: 0.2 },
    emotion: { pleasure: 0.2, arousal: 0.1, dominance: 0.1 },
    mood: "steady", dominant: "social",
    policy: { tierCeiling: "tier3", mayExplore: true, explorationBreadth: 0.8, retrievalDepth: 0.5, reason: "steady" },
    ...over,
  };
}

function ctx(over: Partial<MomentContext> = {}): MomentContext {
  return {
    nowMs: Date.parse("2026-08-07T15:30:00Z"),
    snapshot: snapshot(), phase: "normal", awake: true, present: true, available: true,
    hoursSinceUser: 5, recentActions: [], recentLife: "a few quiet days", safeMode: false, ...over,
  };
}

function provider(text: string): LLMProvider {
  return {
    async complete(): Promise<LLMResponse> {
      return { id: "x", content: [{ type: "text", text }], model: "m", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
}

/** An expression context that lets a motivated thought through by default. */
function openGate(over: Partial<ExpressionContext> = {}) {
  return (c: MomentContext): ExpressionContext => ({
    nowMs: c.nowMs, present: c.present ?? c.awake, available: c.available ?? c.awake, awake: c.awake,
    clockActivity: 1, consecutiveNonReplies: 0, sendsInLastDay: 0, ...over,
  });
}

function deps(text: string, over: Partial<HandlerDeps> = {}) {
  const diary: string[] = [];
  const pushed: string[] = [];
  const d: HandlerDeps = {
    provider: provider(text),
    model: "m",
    appendDiary: (l) => diary.push(l),
    readRecentDiary: () => "",
    push: async (t) => { pushed.push(t); },
    expressionContext: openGate(),
    ...over,
  };
  return { d, diary, pushed, handlers: createMomentHandlers(d) };
}

describe("moment handlers — every action leaves a real trace", () => {
  it("reflect writes the thought into her diary, postmarked with HER clock, not Greenwich's", async () => {
    const { handlers, diary } = deps("I keep coming back to how quiet this week has been.");
    const out = await handlers.reflect("sit with the quiet", ctx());
    expect(out).toContain("quiet this week");
    expect(diary).toHaveLength(1);
    // This assertion used to read `"15:30 —"`, the fixture instant's UTC hours, and thereby
    // pinned a real defect as the contract: her first evening's diary lines were stamped 01:1x
    // while her wall clock said 21:1x, and she trusted her own records. Local, like her clock.
    const at = new Date(Date.parse("2026-08-07T15:30:00Z"));
    const local = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
    expect(diary[0]).toContain(`${local} —`);
    if (at.getTimezoneOffset() !== 0) expect(diary[0]).not.toContain("15:30 —");
  });

  it("reflect reports nothing rather than faking a thought when the model returns empty", async () => {
    const { handlers, diary } = deps("   ");
    expect(await handlers.reflect("think", ctx())).toBe("");
    expect(diary).toEqual([]); // no empty entry written
  });

  it("with nothing accumulated yet, she is shown the empty page and says it herself (2026-09-28)", async () => {
    // A line used to be written into her diary in her first person by the machine
    // (「还没攒下什么。从这儿开始记。」). Now the empty page reaches her as a fact and her words land.
    let seen = "";
    const { handlers, diary } = deps("今天还没什么可整理的。", {
      provider: {
        async complete(req) {
          seen = String(req.messages[0]?.content ?? "");
          return { id: "x", content: [{ type: "text", text: "今天还没什么可整理的。" }], model: "m", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
        },
      },
    });
    const out = await handlers.tend("tidy up", ctx());
    expect(seen).toContain("（今天的笔记里还什么都没有）");
    expect(out).toBe("今天还没什么可整理的。");
    expect(diary).toHaveLength(1);
    expect(diary[0]).not.toContain("从这儿开始记");
  });

  it("tend consolidates her real recent notes", async () => {
    const { handlers, diary } = deps("What keeps recurring is that I settle when I stop pushing.", { readRecentDiary: () => "09:00 — a hard morning\n14:00 — it eased" });
    const out = await handlers.tend("look back", ctx());
    expect(out).toContain("keeps recurring");
    expect(diary[0]).toContain("（整理）");
  });

  it("explore records a real failure when exploring is not available, never a fake success", async () => {
    const { handlers, diary } = deps("unused"); // no runExploration wired
    expect(await handlers.explore("chase a thread", ctx())).toBe("");
    expect(diary).toEqual([]);
  });

  it("explore writes down what she actually found", async () => {
    const { handlers, diary } = deps("unused", { runExploration: async (i) => `found: ${i}` });
    const out = await handlers.explore("how caching composes", ctx());
    expect(out).toBe("found: how caching composes");
    expect(diary[0]).toContain("顺着自己的念头");
  });

  describe("reaching out", () => {
    it("delivers when the gate is open", async () => {
      const { handlers, pushed, diary } = deps("I missed you today.");
      const r = await handlers.reachOut("tell him I missed him", ctx());
      expect(r.delivered).toBe("push");
      expect(pushed).toEqual(["I missed you today."]);
      expect(diary).toEqual([]);
    });

    // The consent boundary: a limit is never narrated to him as his denial.
    it("never sends a constraint-complaint, and keeps it in her diary instead", async () => {
      const { handlers, pushed, diary } = deps("you never let me finish my own projects");
      const r = await handlers.reachOut("say how constrained I feel", ctx());
      expect(r.delivered).toBe("diary");
      expect(pushed).toEqual([]);
      expect(diary[0]).toContain("没说出口，记在这儿");
    });

    it("drains to her diary when he is not there, rather than being lost or stockpiled", async () => {
      const { handlers, pushed, diary } = deps("I was thinking about you.", { expressionContext: openGate({ present: false, available: false }) });
      const r = await handlers.reachOut("say hi", ctx({ present: false, available: false }));
      expect(r.delivered).toBe("diary");
      expect(pushed).toEqual([]);
      expect(diary[0]).toContain("想告诉他的");
    });

    it("goes quiet rather than piling on once she has already said a lot today", async () => {
      const { handlers, pushed } = deps("one more thing —", { expressionContext: openGate({ sendsInLastDay: 6 }) });
      const r = await handlers.reachOut("another thought", ctx());
      expect(r.delivered).toBe("diary");
      expect(pushed).toEqual([]);
    });

    it("says nothing at all when there were no words to say", async () => {
      const { handlers, pushed } = deps("  ");
      const r = await handlers.reachOut("say something", ctx());
      expect(r.text).toBe("");
      expect(pushed).toEqual([]);
    });
  });
});

describe("the render returning its input is not speech (2026-08-24 15:14)", () => {
  // Her real leak, replayed verbatim: the choice step wrote this deliberation, the render step
  // shipped it unchanged, and it reached his phone calling him 「他」.
  const INTENT = "我想跟他说，我把那句‘像梦的东西’记下了，正在等它浮上来。";

  it("PLANTED: the verbatim leak is caught — nothing sent, nothing rewritten, fault heard", async () => {
    const faults: string[] = [];
    const { handlers, pushed, diary } = deps(INTENT, { onFault: (w) => { faults.push(w); } });
    const r = await handlers.reachOut(INTENT, ctx());
    expect(r.text).toBe("");
    expect(pushed).toEqual([]);
    expect(diary.filter((l) => l.includes("像梦的东西"))).toEqual([]); // the machine's copy stays out of her records
    expect(faults).toContain("speech.intent-echo");
  });

  it("an intent already shaped as speech sails through — copying it is saying it", async () => {
    const speechShaped = "我想问问你现在在干嘛。";
    const { handlers, pushed } = deps(speechShaped);
    const r = await handlers.reachOut(speechShaped, ctx());
    expect(r.delivered).toBe("push");
    expect(pushed).toEqual([speechShaped]);
  });

  it("real speech that happens to open with 我想 is hers and goes out", async () => {
    const { handlers, pushed } = deps("我想把那天没回的那句补上。其实我想给的，只是那会儿雾太浓。");
    const r = await handlers.reachOut("我想跟他说，把那天没回的那句补上。", ctx());
    expect(r.delivered).toBe("push");
    expect(pushed.length).toBe(1);
  });

  it("the copy invitation is out of the instruction, and the reason line is labelled as a reason", () => {
    const src = readFileSync(join(process.cwd(), "src/life/agency-handlers.ts"), "utf8");
    const code = src.replace(/\/\/[^\n]*/gu, ""); // the comments quote the old wording as history
    expect(code.includes("就说那句话")).toBe(false);
    expect(code).toContain("对着对方说。");
    // Labelled as a reason, and printed only when there is one (2026-10-07, lineFor).
    expect(code).toContain('lineFor("\\n你为什么想开口：", intent)');
  });
});
