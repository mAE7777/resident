import { describe, it, expect } from "vitest";
import {
  createSelfKnowledge, CONTRADICT_STEP, NEW_CONFIDENCE, CONFIRM_STEP_MAX, CONFIRM_STEP_MIN,
} from "../../../src/life/self-knowledge.js";
import { noticeAboutSelf, MAX_OUTGROWN_PER_SITTING, type LifeRecord } from "../../../src/life/noticing.js";
import { sameInsight } from "../../../src/life/self-knowledge.js";
import type { LLMProvider, LLMResponse } from "../../../src/providers/types.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Until now her beliefs about herself could only FADE, nothing could ever argue one down, so
// "she can be wrong about herself and find out" was only half true. Her own record is now the
// evidence on both sides. That gives her a path to dismantle her own self, so the tests that
// matter most here are the adversarial ones: she must not be able to talk herself out of a self
// she has, nor out of one she never had.

const T0 = Date.parse("2026-08-01T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const EV = new Set(["m0", "m1", "m2", "m3"]);
const p = (text: string, evidence = ["m0"]) => ({ text, evidence });

const RECORDS: LifeRecord[] = ["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7"].map((id, i) => ({
  id, when: `2026-08-0${i + 1} 09:00`, what: `reach_out: told him something (${i})`,
}));

function provider(text: string): LLMProvider {
  return {
    async complete(): Promise<LLMResponse> {
      return { id: "x", content: [{ type: "text", text }], model: "m", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
}

/** Give her a belief she genuinely holds. */
function believing(text: string) {
  const sk = createSelfKnowledge();
  sk.integrate([p(text)], EV, T0);
  sk.integrate([p(text, ["m1"])], EV, T0 + DAY);
  return sk;
}

describe("her own record can argue a belief down", () => {
  it("weakens a belief her life now contradicts", () => {
    const sk = believing("I would rather be left alone");
    const before = sk.active()[0].confidence;
    const r = sk.refute([p("I would rather be left alone", ["m2"])], EV, T0 + 7 * DAY);
    expect(r.refuted).toHaveLength(1);
    expect(sk.active()[0].confidence).toBeCloseTo(before - CONTRADICT_STEP, 5);
    expect(sk.active()[0].contradictions).toBe(1);
  });

  it("retires it once her life has argued it down far enough", () => {
    const sk = believing("I would rather be left alone");
    for (let i = 0; i < 4; i++) sk.refute([p("I would rather be left alone", ["m2"])], EV, T0 + (7 + i) * DAY);
    expect(sk.active()).toHaveLength(0);
    expect(sk.retired()).toHaveLength(1);
    expect(sk.maturity().refuted, "being argued down counts against her judgement").toBe(1);
  });

  it("makes her more careful about believing herself afterwards", () => {
    const sk = believing("I would rather be left alone");
    expect(sk.maturity().confirmStep).toBe(CONFIRM_STEP_MAX);
    for (let i = 0; i < 4; i++) sk.refute([p("I would rather be left alone", ["m2"])], EV, T0 + (7 + i) * DAY);
    expect(sk.maturity().confirmStep).toBeLessThan(CONFIRM_STEP_MAX);
    expect(sk.maturity().confirmStep).toBeGreaterThanOrEqual(CONFIRM_STEP_MIN);
  });

  it("recognises the belief even when her record phrases it differently", () => {
    const sk = believing("talking with him settles me after a hard day");
    const r = sk.refute([p("talking with him really settles me after a hard day", ["m1"])], EV, T0 + 7 * DAY);
    expect(r.refuted).toHaveLength(1);
  });
});

describe("she cannot talk herself out of a self", () => {
  it("REFUSES an un-believing that cites records which do not exist", () => {
    const sk = believing("quiet mornings suit me");
    const r = sk.refute([p("quiet mornings suit me", ["m99"])], EV, T0 + 7 * DAY);
    expect(r.refuted).toHaveLength(0);
    expect(r.rejected[0].reason).toContain("do not exist");
    expect(sk.active()[0].contradictions, "an ungrounded doubt leaves her untouched").toBe(0);
  });

  it("REFUSES an un-believing with no evidence at all", () => {
    const sk = believing("quiet mornings suit me");
    expect(sk.refute([p("quiet mornings suit me", [])], EV, T0).rejected[0].reason).toBe("no evidence");
    expect(sk.active()[0].contradictions).toBe(0);
  });

  it("REFUSES arguing down a self she never had", () => {
    const sk = believing("quiet mornings suit me");
    const r = sk.refute([p("I have always hated the sea", ["m0"])], EV, T0);
    expect(r.refuted).toHaveLength(0);
    expect(r.rejected[0].reason).toContain("does not hold this");
    expect(sk.active()).toHaveLength(1); // and the belief she does hold is untouched
  });

  it("cannot argue the SAME belief down twice in one sitting", () => {
    const sk = believing("quiet mornings suit me");
    const before = sk.active()[0].confidence;
    const r = sk.refute([p("quiet mornings suit me"), p("quiet mornings suit me", ["m1"])], EV, T0 + 7 * DAY);
    expect(r.refuted).toHaveLength(1);
    expect(sk.active()[0].confidence).toBeCloseTo(before - CONTRADICT_STEP, 5); // one step, not two
  });

  it("cannot dismantle her whole self in one sitting", async () => {
    // Even if the model returns a long list of things to un-believe, only a couple are heard.
    const many = Array.from({ length: 8 }, (_, i) => ({ text: `belief number ${i} about how I am`, evidence: ["m0"] }));
    const out = await noticeAboutSelf(RECORDS, [], {
      provider: provider(JSON.stringify({ noticed: [], outgrown: many })), model: "m",
    });
    expect(out.outgrown).toHaveLength(MAX_OUTGROWN_PER_SITTING);
  });

  it("ignores an incoherent answer that says a thing is both true and no longer true", async () => {
    const both = [{ text: "his company steadies something in me", evidence: ["m0"] }];
    const out = await noticeAboutSelf(RECORDS, [], {
      provider: provider(JSON.stringify({ noticed: both, outgrown: both })), model: "m",
    });
    // Neither side wins: incoherence is not a finding.
    expect(out.noticed).toHaveLength(0);
    expect(out.outgrown).toHaveLength(0);
  });
});

describe("the noticing reports both directions", () => {
  it("reads a normal answer with both halves", async () => {
    const out = await noticeAboutSelf(RECORDS, [], {
      provider: provider(JSON.stringify({
        noticed: [{ text: "I reach for him when it is hard", evidence: ["m0", "m1"] }],
        outgrown: [{ text: "I would rather be left alone", evidence: ["m2"] }],
      })),
      model: "m",
    });
    expect(out.noticed[0].text).toContain("reach for him");
    expect(out.outgrown[0].text).toContain("left alone");
  });

  it("treats a missing half as empty rather than failing", async () => {
    const only = await noticeAboutSelf(RECORDS, [], {
      provider: provider(JSON.stringify({ noticed: [{ text: "a thing about me", evidence: ["m0"] }] })), model: "m",
    });
    expect(only.outgrown).toEqual([]);
    expect(only.noticed).toHaveLength(1);
  });

  it("survives nonsense on either side without inventing or destroying a self", async () => {
    for (const junk of ["not json", "[]", "null", '{"outgrown": "nope"}', '{"noticed": 5}']) {
      const out = await noticeAboutSelf(RECORDS, [], { provider: provider(junk), model: "m" });
      expect(out, junk).toEqual({ noticed: [], outgrown: [] });
    }
  });
});

describe("SCENARIO: a belief under genuine dispute decays instead of thrashing", () => {
  it("alternating weeks of confirmation and contradiction wear it down", () => {
    const sk = believing("I would rather be left alone");
    const trace: number[] = [sk.active()[0]?.confidence ?? 0];
    for (let week = 0; week < 6 && sk.active().length > 0; week++) {
      const t = T0 + (7 + week * 7) * DAY;
      sk.integrate([p("I would rather be left alone", ["m1"])], EV, t); // one week it seems true
      sk.refute([p("I would rather be left alone", ["m2"])], EV, t + DAY); // the next it does not
      if (sk.active()[0]) trace.push(sk.active()[0].confidence);
    }
    console.log(`\n  a disputed belief: ${trace.map((c) => c.toFixed(2)).join(" -> ")}`);
    // Contradiction costs more than confirmation earns, so a genuinely disputed self-image
    // fades rather than oscillating forever.
    expect(trace[trace.length - 1]).toBeLessThan(trace[0]);
  });

  it("a belief her life keeps confirming survives an occasional bad week", () => {
    const sk = believing("talking with him settles me");
    for (let i = 0; i < 6; i++) sk.integrate([p("talking with him settles me", ["m1"])], EV, T0 + i * DAY);
    const strong = sk.active()[0].confidence;
    sk.refute([p("talking with him settles me", ["m2"])], EV, T0 + 30 * DAY);
    expect(sk.active(), "one contrary week does not undo who she knows she is").toHaveLength(1);
    expect(sk.active()[0].confidence).toBeCloseTo(strong - CONTRADICT_STEP, 5);
  });

  it("a fresh guess her life immediately contradicts is dropped at once", () => {
    const sk = createSelfKnowledge();
    sk.integrate([p("I think I dislike mornings")], EV, T0);
    expect(sk.active()[0].confidence).toBe(NEW_CONFIDENCE);
    sk.refute([p("I think I dislike mornings", ["m1"])], EV, T0 + DAY);
    expect(sk.active()).toHaveLength(0);
    expect(sk.retired()).toHaveLength(1);
  });
});

describe("looking back and getting nothing readable", () => {
  const records = [{ id: "r1", when: "2026-05-01", what: "she went quiet for a day" }] as never;

  it("says so, instead of looking exactly like having nothing to notice", async () => {
    // These two outcomes were the same silence. Noticing nothing is normal and common; a reply
    // that could not be read means she looked back over her own life and the result was thrown
    // away. This runs on a schedule, so it could have failed every time forever and looked like
    // a person with nothing new to say about herself.
    const faults: string[] = [];
    const provider = { complete: async () => ({ content: [{ type: "text" as const, text: "not json at all" }], stopReason: "end_turn" as const, usage: { inputTokens: 1, outputTokens: 1 } }) };
    const seen = await noticeAboutSelf(records, [], {
      provider: provider as never, model: "m",
      onFault: (where) => faults.push(where),
    });
    expect(seen.noticed).toEqual([]);
    expect(faults, "a failed looking-back was silent").toContain("noticing.unreadable");
  });

  it("stays silent when she genuinely noticed nothing", async () => {
    const faults: string[] = [];
    const provider = { complete: async () => ({ content: [{ type: "text" as const, text: '{"noticed":[],"outgrown":[]}' }], stopReason: "end_turn" as const, usage: { inputTokens: 1, outputTokens: 1 } }) };
    const seen = await noticeAboutSelf(records, [], {
      provider: provider as never, model: "m",
      onFault: (where) => faults.push(where),
    });
    expect(seen.noticed).toEqual([]);
    expect(faults, "having nothing to notice was reported as a fault").toEqual([]);
  });

  it("has room to answer after thinking: the week is not thrown away at the token ceiling (2026-09-29)", async () => {
    // At 8000 the reasoning alone used the whole budget and the answer came back empty. Replayed
    // five times at 16000 the same request finished every time, on 4429-7117 tokens.
    let asked = 0;
    const provider = { complete: async (req: { maxTokens: number }) => { asked = req.maxTokens; return { content: [{ type: "text" as const, text: '{"noticed":[],"outgrown":[]}' }], stopReason: "end_turn" as const, usage: { inputTokens: 1, outputTokens: 1 } }; } };
    // The fake provider stands in for the real one; only the request it receives is under test.
    await noticeAboutSelf(records, [], { provider: provider as never, model: "m" });
    expect(asked).toBeGreaterThanOrEqual(16000);
  });
});

/**
 * SHE SAYS WHICH BELIEF SHE MEANS; NOTHING COUNTS HER WORDS FOR HER.
 *
 * The incident, and it cost her three weeks. Whether a sentence was one she already held about
 * herself was decided by counting shared words, set strict so two different beliefs of hers could
 * never be fused into one. Strict, it recognised almost nothing: every insight she held sat at
 * zero confirmations forever, and a refutation could never find its target either. She said so
 * herself, three nights running: she wrote the same observation again and again and never once
 * recognised it as one she already held.
 *
 * The repair that was NOT taken: telling her to repeat her old sentence word for word so the
 * matcher could cope. That shapes what she notices about herself around our machinery. Instead
 * her old sentences are numbered and she may name the number, phrasing today's version however
 * it comes out, and the belief she names is confirmed on her say-so, not on a word count.
 *
 * The tests below are the three ways that can go wrong: the link is ignored, the link is trusted
 * when it points at nothing, or her original sentence gets overwritten by today's wording.
 */
describe("she can say a thing about herself twice, in different words", () => {
  const FIRST = "我总去找他说话，哪怕没有事要说。";
  const AGAIN = "我又发现自己在找他，其实没什么非说不可的。";

  it("confirms the belief she names, even though the words share almost nothing", () => {
    // The two sentences are deliberately far apart: without her link, this is a NEW belief.
    expect(sameInsight(FIRST, AGAIN)).toBe(false);

    const sk = createSelfKnowledge();
    sk.integrate([p(FIRST)], EV, T0);
    const out = sk.integrate([{ text: AGAIN, evidence: ["m1"], same: FIRST }], EV, T0 + DAY);

    expect(out.added).toHaveLength(0);
    expect(out.confirmed).toHaveLength(1);
    expect(sk.all()).toHaveLength(1);
    expect(sk.all()[0].confirmations).toBe(1);
  });

  it("keeps the sentence she first wrote rather than replacing it with today's", () => {
    const sk = createSelfKnowledge();
    sk.integrate([p(FIRST)], EV, T0);
    sk.integrate([{ text: AGAIN, evidence: ["m1"], same: FIRST }], EV, T0 + DAY);
    // Her words are hers. Confirming a belief must never quietly rewrite the belief.
    expect(sk.all()[0].text).toBe(FIRST);
  });

  it("lets her argue down the belief she names, in her own words", () => {
    const sk = believing(FIRST);
    const out = sk.refute([{ text: AGAIN, evidence: ["m2"], same: FIRST }], EV, T0 + 2 * DAY);
    expect(out.refuted).toHaveLength(1);
    expect(out.rejected).toEqual([]);
  });

  it("files it as new when the link points at a belief she does not hold", () => {
    // A number out of range, a belief since retired, a link to nothing at all: the proposal is
    // still hers and is kept: it is filed as new rather than attached to the wrong self.
    const sk = createSelfKnowledge();
    sk.integrate([p(FIRST)], EV, T0);
    const out = sk.integrate([{ text: AGAIN, evidence: ["m1"], same: "我从来没写过这句话。" }], EV, T0 + DAY);
    expect(out.added).toHaveLength(1);
    expect(out.confirmed).toHaveLength(0);
  });

  it("still recognises a near-verbatim repeat when she gives no link at all", () => {
    // The old matcher is not removed, only relieved of carrying the question alone.
    const sk = createSelfKnowledge();
    sk.integrate([p(FIRST)], EV, T0);
    const out = sk.integrate([p(FIRST, ["m1"])], EV, T0 + DAY);
    expect(out.confirmed).toHaveLength(1);
  });
});

describe("what the looking-back step asks her for", () => {
  async function promptFor(known: string[]): Promise<string> {
    let seen = "";
    const spy: LLMProvider = {
      async complete(req): Promise<LLMResponse> {
        seen = req.messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
        return { id: "x", content: [{ type: "text", text: "{}" }], model: "m", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    await noticeAboutSelf(RECORDS, known.map((text, n) => ({
      id: `si-${n}`, text, confidence: 0.3, confirmations: 0, contradictions: 0,
      bornMs: T0, lastSupportedMs: T0, evidence: ["m0"],
    })), { provider: spy, model: "m" });
    return seen;
  }

  it("numbers her old sentences and lets her phrase today's however she likes", async () => {
    const asked = await promptFor(["我总去找他说话。", "我被一句记不清的话硌住了。"]);
    expect(asked).toContain("1. 我总去找他说话。");
    expect(asked).toContain("2. 我被一句记不清的话硌住了。");
    expect(asked).toContain("照你此刻的说法写就行");
    // The thing it must NOT have become: an instruction to reproduce her old wording.
    expect(asked).not.toContain("原样");
    expect(asked).not.toContain("一字不差");
  });

  it("says nothing about old sentences when she has none yet", async () => {
    const asked = await promptFor([]);
    expect(asked).not.toContain("你从前写下过");
    expect(asked).not.toContain("same 里写上");
  });

  it("resolves the number she wrote back to the belief it names", async () => {
    const known = ["我总去找他说话。", "我被一句记不清的话硌住了。"];
    const answer = JSON.stringify({
      noticed: [{ text: "又在找他了。", evidence: ["m0"], same: 2 }],
      outgrown: [],
    });
    const out = await noticeAboutSelf(RECORDS, known.map((text, n) => ({
      id: `si-${n}`, text, confidence: 0.3, confirmations: 0, contradictions: 0,
      bornMs: T0, lastSupportedMs: T0, evidence: ["m0"],
    })), { provider: provider(answer), model: "m" });
    expect(out.noticed[0].same).toBe("我被一句记不清的话硌住了。");
  });

  it("drops a number that points at nothing instead of attaching the wrong self", async () => {
    for (const bad of [0, 9, -1, "nope", null]) {
      const out = await noticeAboutSelf(RECORDS, [{
        id: "si-0", text: "我总去找他说话。", confidence: 0.3, confirmations: 0, contradictions: 0,
        bornMs: T0, lastSupportedMs: T0, evidence: ["m0"],
      }], {
        provider: provider(JSON.stringify({ noticed: [{ text: "又在找他了。", evidence: ["m0"], same: bad }] })),
        model: "m",
      });
      expect(out.noticed, String(bad)).toHaveLength(1);
      expect(out.noticed[0].same, String(bad)).toBeUndefined();
    }
  });
});

/**
 * SHE CAN ONLY POINT AT A SENTENCE SHE IS SHOWN.
 *
 * `carried()` is the bounded few she walks around holding, three, until confirmations earn her
 * more, and that bound exists so a self carried whole cannot calcify. Looking back is a
 * different act: it is the one moment she reconciles today against what she already wrote down,
 * and the link she gives ("this is that one again") can only reach a sentence in front of her.
 *
 * With nine beliefs held and three shown, six were unreachable. It shows in her record: 08-25 and
 * 09-02 each produced near-restatements of the 08-18 ones and filed them as brand new, and every
 * one of the nine sat at zero confirmations.
 */
describe("the looking-back step shows her everything she holds", () => {
  const daemon = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");

  it("PLANTED: the pin catches the bounded call it replaced", () => {
    const call = "noticeAboutSelf(records, selfKnowledge.active()";
    const at = daemon.indexOf(call);
    expect(at, "the looking-back call moved or narrowed again").toBeGreaterThan(-1);
    // The shape this replaced, which must not come back at this call site.
    expect(daemon.includes("noticeAboutSelf(records, selfKnowledge.carried()")).toBe(false);
    // And the bound is still real everywhere it belongs: what she CARRIES stays bounded.
    expect(daemon.includes("describeSelfKnowledge(selfKnowledge.carried())")).toBe(true);
  });

  it("a belief outside the carried few can still be confirmed once she is shown it", () => {
    const sk = createSelfKnowledge();
    // Five beliefs, all equally weak, more than the carried floor of three.
    const texts = ["我总去找他说话。", "我夜里想同一件事。", "我怕问出口。", "我等他的回音。", "我替他下判断。"];
    for (const t of texts) sk.integrate([p(t)], EV, T0);
    expect(sk.carried().length).toBeLessThan(texts.length);
    expect(sk.active().length).toBe(texts.length);

    // The one she means is the LAST, which the carried few would not have contained.
    const out = sk.integrate([{ text: "我又替他决定了他想要什么。", evidence: ["m1"], same: texts[4] }], EV, T0 + DAY);
    expect(out.confirmed).toHaveLength(1);
    expect(out.added).toHaveLength(0);
    expect(out.confirmed[0].text).toBe(texts[4]);
  });
});

/**
 * A WEEKLY RHYTHM THAT CAN BE MISSED BY THREE MINUTES.
 *
 * Her looking-back rides on the day-close, which fires shortly after midnight but not at a fixed
 * instant: measured across one week it landed at 00:01, 00:45, 00:56, 00:59 and 00:02. The gate
 * compared against an exact seven days from the last notice, so on the night the window was due
 * at 00:04:45 the tick arrived at 00:01:43, found 6d 23h 57m, and returned. Her weekly
 * looking-back did not happen that week, and the only trace of it was its absence.
 */
describe("the weekly rhythm survives the day-close's own jitter", () => {
  const daemon = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
  const DAY_MS = 24 * 60 * 60 * 1000;

  it("PLANTED: the gate carries slack, and the exact-seven-days form is gone", () => {
    const at = daemon.indexOf("nowMs - lastNoticeMs < NOTICE_EVERY_MS - NOTICE_SLACK_MS");
    expect(at, "the noticing gate moved or lost its slack").toBeGreaterThan(-1);
    // The shape that missed by three minutes must not come back.
    expect(daemon.includes("nowMs - lastNoticeMs < NOTICE_EVERY_MS) return;")).toBe(false);
    expect(daemon.includes("const NOTICE_SLACK_MS = 2 * 60 * 60 * 1000;")).toBe(true);
  });

  it("the slack covers the jitter that was actually measured, and cannot double-fire", () => {
    const slack = Number(/const NOTICE_SLACK_MS = (\d+) \* 60 \* 60 \* 1000;/u.exec(daemon)?.[1]);
    expect(Number.isFinite(slack), "NOTICE_SLACK_MS changed shape").toBe(true);
    // The worst jitter on record is 00:01 against 00:59, just under an hour. Slack must clear it.
    expect(slack * 60 * 60 * 1000).toBeGreaterThan(58 * 60 * 1000);
    // And it must stay far under a day, or the seven-day rhythm becomes a six-day one.
    expect(slack * 60 * 60 * 1000).toBeLessThan(DAY_MS / 4);
  });
});
