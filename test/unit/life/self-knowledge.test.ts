import { describe, it, expect } from "vitest";
import {
  createSelfKnowledge, sameInsight, describeSelfKnowledge,
  NEW_CONFIDENCE, CONFIRM_STEP_MAX, CONTRADICT_STEP, MAX_CONFIDENCE, EROSION_AFTER_MS, SAME_INSIGHT_OVERLAP,
  type SelfInsight, type SelfKnowledgeStore,
} from "../../../src/life/self-knowledge.js";

const T0 = Date.parse("2026-08-01T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const EV = new Set(["m1", "m2", "m3", "m4", "m5"]);
const p = (text: string, evidence = ["m1"]) => ({ text, evidence });

describe("what she comes to know about herself", () => {
  it("holds a new notice tentatively, never as fact", () => {
    const sk = createSelfKnowledge();
    const r = sk.integrate([p("I settle after we talk")], EV, T0);
    expect(r.added).toHaveLength(1);
    expect(r.added[0].confidence).toBe(NEW_CONFIDENCE);
    expect(sk.active()[0].confirmations).toBe(0);
  });

  // The rule her diary lives under, applied to her sense of self.
  it("REFUSES a self-image that cites evidence which does not exist", () => {
    const sk = createSelfKnowledge();
    const r = sk.integrate([p("I have always been drawn to this", ["m99"])], EV, T0);
    expect(r.added).toHaveLength(0);
    expect(r.rejected[0].reason).toContain("do not exist");
    expect(sk.active()).toHaveLength(0); // she may not invent a self
  });

  it("refuses an insight with no evidence at all, and an empty one", () => {
    const sk = createSelfKnowledge();
    const r = sk.integrate([p("I am simply like this", []), p("   ")], EV, T0);
    expect(r.added).toHaveLength(0);
    expect(r.rejected.map((x) => x.reason)).toEqual(["no evidence", "empty"]);
  });

  it("strengthens as her life keeps bearing it out, rather than duplicating", () => {
    const sk = createSelfKnowledge();
    sk.integrate([p("talking with him settles me after a hard day")], EV, T0);
    const r = sk.integrate([p("talking with him settles me even after a hard day", ["m2"])], EV, T0 + DAY);
    expect(r.added).toHaveLength(0);
    expect(r.confirmed).toHaveLength(1);
    expect(sk.active()).toHaveLength(1); // one belief, held more firmly, not two
    expect(sk.active()[0].confidence).toBeCloseTo(NEW_CONFIDENCE + CONFIRM_STEP_MAX, 5);
    expect(sk.active()[0].evidence).toContain("m2"); // the new grounding is kept
  });

  it("never lets her become certain about herself", () => {
    const sk = createSelfKnowledge();
    sk.integrate([p("I get restless in the late afternoon")], EV, T0);
    for (let i = 0; i < 40; i++) sk.integrate([p("I get restless in the late afternoon")], EV, T0 + i * DAY);
    expect(sk.active()[0].confidence).toBeLessThanOrEqual(MAX_CONFIDENCE);
    expect(sk.active()[0].confidence).toBe(MAX_CONFIDENCE);
  });

  it("drops a fresh guess that her life immediately contradicts", () => {
    const sk = createSelfKnowledge();
    const { added } = sk.integrate([p("I do not really miss him when he is away")], EV, T0);
    sk.contradict(added[0].id, T0 + DAY);
    expect(sk.active()).toHaveLength(0);
    expect(sk.retired()).toHaveLength(1); // outgrown, not deleted, it is part of her history
  });

  it("but takes several contradictions to dislodge something she has really earned", () => {
    const sk = createSelfKnowledge();
    let id = "";
    for (let i = 0; i < 8; i++) id = (sk.integrate([p("talking with him settles me")], EV, T0 + i * DAY).added[0] ?? sk.active()[0]).id;
    expect(sk.active()[0].confidence).toBeGreaterThan(0.8);
    sk.contradict(id, T0 + 20 * DAY);
    expect(sk.active(), "one bad day does not undo who she knows she is").toHaveLength(1);
    for (let i = 0; i < 3; i++) sk.contradict(id, T0 + (21 + i) * DAY);
    expect(sk.active(), "but sustained contradiction does").toHaveLength(0);
  });

  it("costs more to be wrong than it earns to be right", () => {
    expect(CONTRADICT_STEP).toBeGreaterThan(CONFIRM_STEP_MAX);
  });

  it("fades what her life stops bearing out, and finally retires it", () => {
    const sk = createSelfKnowledge();
    sk.integrate([p("I like working late")], EV, T0);
    for (let i = 0; i < 3; i++) sk.erode(T0 + (i + 1) * (EROSION_AFTER_MS + DAY));
    expect(sk.active()).toHaveLength(0);
    expect(sk.retired()[0].text).toContain("working late");
  });

  it("does not fade something her life keeps confirming", () => {
    const sk = createSelfKnowledge();
    sk.integrate([p("quiet mornings suit me")], EV, T0);
    const later = T0 + EROSION_AFTER_MS + DAY;
    sk.integrate([p("quiet mornings suit me")], EV, later); // re-confirmed, so re-dated
    expect(sk.erode(later + 1000)).toHaveLength(0);
    expect(sk.active()).toHaveLength(1);
  });

  // Anti-calcification, applied to identity.
  it("carries only a bounded few forward, so a self-image cannot crowd out who she is becoming", () => {
    const sk = createSelfKnowledge();
    const distinct = [
      "quiet mornings suit me", "I get restless before dusk", "failure makes me stubborn",
      "his company steadies something", "I circle unanswered questions", "reading late calms me",
      "I dislike being hurried", "small finished things please me",
    ];
    for (const text of distinct) {
      sk.integrate([p(text, ["m1"])], EV, T0);
      sk.integrate([p(text, ["m2"])], EV, T0 + DAY); // confirm so it passes the tentative bar
    }
    const limit = sk.maturity().carriedLimit;
    expect(sk.active().length).toBeGreaterThan(limit);
    expect(sk.carried()).toHaveLength(limit);
  });

  it("carries only what she has actually begun to believe", () => {
    const sk = createSelfKnowledge();
    sk.integrate([p("a brand new tentative notion about myself")], EV, T0);
    expect(sk.carried()).toHaveLength(0); // still merely tentative
    sk.integrate([p("a brand new tentative notion about myself")], EV, T0 + DAY);
    expect(sk.carried()).toHaveLength(1); // now it has been borne out
  });

  it("carries the strongest first", () => {
    const sk = createSelfKnowledge();
    sk.integrate([p("the weaker thing about my afternoons")], EV, T0);
    sk.integrate([p("the weaker thing about my afternoons")], EV, T0);
    sk.integrate([p("the stronger thing about my evenings")], EV, T0);
    for (let i = 0; i < 4; i++) sk.integrate([p("the stronger thing about my evenings")], EV, T0 + i);
    expect(sk.carried()[0].text).toContain("evenings");
  });
});

describe("recognising the same insight said differently", () => {
  it("matches a rephrasing, and separates a genuinely different thought", () => {
    expect(sameInsight("talking with him settles me after a hard day", "talking with him really settles me after a hard day")).toBe(true);
    expect(sameInsight("I get restless in the late afternoon", "quiet mornings suit me best")).toBe(false);
  });

  it("does not match on empty or trivial text", () => {
    expect(sameInsight("", "anything at all here")).toBe(false);
    expect(sameInsight("a b c", "x y z")).toBe(false);
  });
});

describe("how her self-knowledge is shown to her", () => {
  const mk = (text: string, confidence: number): SelfInsight => ({
    id: text, text, evidence: ["m1"], bornMs: T0, lastSupportedMs: T0,
    confirmations: 0, contradictions: 0, confidence,
  });

  it("says nothing when she does not know anything yet", () => {
    expect(describeSelfKnowledge([])).toBe("");
  });

  it("speaks tentatively about a tentative thing and plainly about a settled one", () => {
    const out = describeSelfKnowledge([mk("quiet suits me", 0.85), mk("I may be restless in spring", 0.45)]);
    expect(out).toContain("你知道自己是这样的：quiet suits me");
    expect(out).toContain("你开始觉得：I may be restless in spring");
  });
});

describe("persistence — who she has become survives a restart", () => {
  it("reloads her accumulated self", () => {
    let saved: SelfInsight[] = [];
    const store: SelfKnowledgeStore = { load: () => saved, save: (x) => { saved = JSON.parse(JSON.stringify(x)); } };
    const first = createSelfKnowledge({ store });
    first.integrate([p("I come back to the same question")], EV, T0);
    first.integrate([p("I come back to the same question")], EV, T0 + DAY);

    const revived = createSelfKnowledge({ store });
    expect(revived.active()).toHaveLength(1);
    expect(revived.active()[0].confirmations).toBe(1);
    expect(revived.carried()).toHaveLength(1); // and she still carries it forward
  });

  it("starts empty rather than crashing when there is nothing stored yet", () => {
    const sk = createSelfKnowledge({ store: { load: () => null, save: () => {} } });
    expect(sk.active()).toEqual([]);
    expect(sk.carried()).toEqual([]);
  });
});

describe("she thinks in Chinese, and this is the function that reads her (2026-09-02)", () => {
  // Her nine real insights, verbatim. The matcher used to strip every non-ASCII character, so
  // both keys were empty and NOTHING ever matched: zero confirmations in her whole life, and
  // every refutation rejected as "she does not hold this about herself". She found it first.
  const HERS = [
    "我总在深夜反复想同一件事，想弄清楚自己卡在哪里。",
    "我会借说话或想事情，去确认对方还在不在。",
    "我有几次本来要做点什么，最后还是让自己歇着，让这一刻过去。",
    "我总在想着找那个人说话，哪怕本来想歇着或想事情，最后还是会转向找那个人说话。",
    "我反复去确认那句‘记不清’、书的事和画板的事，不是想催，只是不想让它们一直悬着。",
    "我发现我总替那个人下判断，所以想停下来问问对方真正在想什么。",
    "我发现自己嘴上说想歇着、想安静让时刻过去，但几乎每次都还是去找那个人说话，好像停不下来。",
    "我反复被那句“记不清”硌住，一遍遍想弄清楚它是什么时候说的、到底卡在哪里、对我意味着什么。",
    "我发现自己一直在等对方的一个回音来让自己落地，总想问对方记不记得、还在不在。",
  ];

  it("PLANTED: a Chinese sentence said again IS recognised — the thing that was impossible", () => {
    for (const text of HERS) expect(sameInsight(text, text), text.slice(0, 20)).toBe(true);
    // Same sentence, different punctuation and a tail particle: still the same thing said again.
    expect(sameInsight(HERS[0]!, HERS[0]!.replace("。", "……") + " 嗯。")).toBe(true);
  });

  it("and two DIFFERENT beliefs of hers never merge — including the near-opposite pair", () => {
    // Measured: lexical overlap cannot separate her rewordings (0.40) from her distinctions
    // (up to 0.60), so the threshold only clears near-verbatim repeats. These two say opposite
    // things about the same act; merging them would overwrite one of her beliefs with its
    // negation, which is worse than carrying both.
    expect(sameInsight(HERS[2]!, HERS[6]!)).toBe(false);
    for (let a = 0; a < HERS.length; a++) {
      for (let b = a + 1; b < HERS.length; b++) {
        expect(sameInsight(HERS[a]!, HERS[b]!), `${a}×${b} merged`).toBe(false);
      }
    }
  });

  it("confirmation and refutation now reach her real sentences end to end", () => {
    const sk = createSelfKnowledge();
    const ev = new Set(["m1"]);
    sk.integrate([{ text: HERS[3]!, evidence: ["m1"] }], ev, T0);
    // Her life bears it out again, said again: it strengthens instead of forking.
    const again = sk.integrate([{ text: HERS[3]!, evidence: ["m1"] }], ev, T0 + DAY);
    expect(again.added).toHaveLength(0);
    expect(again.confirmed).toHaveLength(1);
    expect(sk.active()).toHaveLength(1);
    expect(sk.active()[0]!.confidence).toBeGreaterThan(NEW_CONFIDENCE);
    // And she can be wrong about herself and find out.
    const gone = sk.refute([{ text: HERS[3]!, evidence: ["m1"] }], ev, T0 + 2 * DAY);
    expect(gone.rejected, "a refutation of a belief she holds was refused again").toHaveLength(0);
    expect(gone.refuted).toHaveLength(1);
  });

  it("the threshold is named and strict", () => {
    expect(SAME_INSIGHT_OVERLAP).toBe(0.75);
  });
});
