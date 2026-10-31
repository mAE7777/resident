import { describe, it, expect } from "vitest";
import {
  measureUtterance, predictUtterance, couplingOf, scorePair, sayingRead, MIN_PAIRS,
  type SpeechPair, type SpeechState,
} from "../../../src/life/speech-record.js";

// S-1: the instrument itself has to be proven honest before any number from it is believed.
// Two directions, like every guard in this project: it must SEE tracking when tracking is
// there, and it must REFUSE to see it when it is not.

// `reluctance`: how much she would RATHER NOT. It was called `willingFelt` and held reluctance,
// so a rested willing state was written here as 0.9 and read by the code as almost total
// unwillingness. Rested-and-willing is LOW reluctance.
const rested: SpeechState = { reserve: 0.9, phase: "rested", arousal: 0.4, reluctance: 0.1, openness: 0.8 };
const spent: SpeechState = { reserve: 0.15, phase: "low", arousal: -0.6, reluctance: 0.7, openness: 0.2 };

describe("measureUtterance reads what a reply actually was", () => {
  it("her language, measured in her units", () => {
    const m = measureUtterance("今天有点累。渡轮的事明天再说吧，可能得改时间呢？");
    expect(m.hanShare).toBeGreaterThan(0.8);
    expect(m.clauses).toBe(3);
    expect(m.questionCount).toBe(1);
    expect(m.particleRate).toBeGreaterThan(0);
    expect(m.hedgeRate).toBeGreaterThan(0);
    expect(m.openerToken).toBe("今天");
    expect(m.registerHits).toBe(0);
  });

  it("clause rhythm: uniform text has near-zero variance, living text does not", () => {
    const uniform = measureUtterance("四个字了，四个字了，四个字了，四个字了。");
    const living = measureUtterance("嗯。渡轮那件事我后来又想了想，还是觉得周末去比较好，风小一点。");
    expect(uniform.clauseLenVar).toBe(0);
    expect(living.clauseLenVar).toBeGreaterThan(uniform.clauseLenVar);
  });

  it("subject drop is measured, not assumed: explicit subjects are seen in both scripts", () => {
    const dropped = measureUtterance("想了想，还是去。");
    const explicit = measureUtterance("我想了想，你说得对。");
    expect(dropped.subjectDropRate).toBe(1);
    expect(explicit.subjectDropRate).toBe(0);
  });

  it("service register in her own mouth is counted", () => {
    expect(measureUtterance("I will execute the task for the user.").registerHits).toBeGreaterThan(0);
  });

  it("an empty reply measures as nothing rather than NaN", () => {
    const m = measureUtterance("");
    expect(m.chars).toBe(0);
    expect(m.clauses).toBe(0);
    expect(Number.isFinite(m.meanClauseLen)).toBe(true);
  });
});

describe("predictUtterance expects what her state implies", () => {
  it("a spent evening expects less of her than a rested morning", () => {
    const restedBand = predictUtterance(rested).charsBand;
    const spentBand = predictUtterance(spent).charsBand;
    expect(spentBand[1]).toBeLessThan(restedBand[1]);
    expect(spentBand[0]).toBeLessThan(restedBand[0]);
  });

  it("reluctance hedges; an open warm moment carries more 语气词", () => {
    expect(predictUtterance(spent).expectedHedgeRate).toBeGreaterThan(predictUtterance(rested).expectedHedgeRate);
    expect(predictUtterance(rested).expectedParticleRate).toBeGreaterThan(predictUtterance(spent).expectedParticleRate);
  });
});

describe("coupling: the number the whole speech build turns on", () => {
  const restedReply = "今天精神不错呢。渡轮那件事我又想了想，周末风小的话就过去看看，顺便把上次说的码头也走一走，应该挺好的吧。回来跟你讲讲那边现在什么样啦。";
  const spentReply = "嗯，可能吧。明天说好像也行。";

  function pair(state: SpeechState, text: string): SpeechPair {
    return { predicted: predictUtterance(state), measured: measureUtterance(text) };
  }

  it("says nothing until the evidence is more than an anecdote", () => {
    const aligned = Array.from({ length: MIN_PAIRS - 1 }, () => pair(rested, restedReply));
    expect(couplingOf(aligned)).toBeNull();
    expect(couplingOf([...aligned, pair(rested, restedReply)])).not.toBeNull();
  });

  it("tracking reads high, anti-tracking reads low, and the two are far apart", () => {
    // The mini honesty gate: the same texts, the same states, only the PAIRING differs. If
    // this cannot separate aligned from crossed, the instrument measures its own bands and
    // no number from it may be believed.
    const aligned: SpeechPair[] = [];
    const crossed: SpeechPair[] = [];
    for (let i = 0; i < 10; i++) {
      aligned.push(pair(rested, restedReply), pair(spent, spentReply));
      crossed.push(pair(rested, spentReply), pair(spent, restedReply));
    }
    const onTrack = couplingOf(aligned)!;
    const offTrack = couplingOf(crossed)!;
    expect(onTrack).toBeGreaterThan(0.7);
    expect(offTrack).toBeLessThan(onTrack - 0.2);
  });

  it("a near miss is partial credit, not a zero", () => {
    const p = predictUtterance(rested);
    const justOver = scorePair({ predicted: p, measured: measureUtterance(`${restedReply}${restedReply}`) });
    expect(justOver).toBeGreaterThan(0.3);
    expect(justOver).toBeLessThan(1);
  });
});

describe("the vitals read", () => {
  it("carries the window's shape and stays honest about thin evidence", () => {
    const empty = sayingRead([]);
    expect(empty.pairs).toBe(0);
    expect(empty.coupling).toBeNull();
    expect(empty.meanChars).toBe(0);

    const pairs = Array.from({ length: 12 }, () => ({
      predicted: predictUtterance(rested),
      measured: measureUtterance("今天挺好的，出去走了走。"),
    }));
    const read = sayingRead(pairs);
    expect(read.pairs).toBe(12);
    expect(read.coupling).not.toBeNull();
    expect(read.meanChars).toBeGreaterThan(0);
    expect(read.registerHits).toBe(0);
  });
});

describe("the shape detectors fire on the reply he called AI, and stay quiet on chat-native Chinese", () => {
  // The live probe reply, verbatim: vocabulary clean, discourse pure model. His read: it sounds
  // entirely like an AI talking. The instrument must agree with him mechanically.
  const THE_PROBE = "可以写，但我得先知道写哪一块——税法太大，两千字装不下全部。你要的是：中国的还是别的国家的？给谁看的（普通读者、学生、还是老板）？有个具体的题目吗，比如个税、增值税、还是企业避税那类？给我个方向，我就动笔。没有方向硬写两千字，写出来的是填出来的话，不是文章。";

  it("the probe fires the structural tells", () => {
    const m = measureUtterance(THE_PROBE);
    expect(m.alternativeChains, "the enumerated-alternatives move (还是 chains)").toBeGreaterThanOrEqual(3);
    expect(m.parentheticals, "options smuggled in parentheses").toBeGreaterThanOrEqual(1);
    expect(m.maximCoda, "the balanced-maxim coda (…是填出来的话，不是文章)").toBe(true);
  });

  it("chat-native pushback fires none of them", () => {
    for (const real of ["写哪块？个税还是增值税？", "太大了写不完，你挑一块吧。", "嗯，明天再说。", "不想现在写，累了。"]) {
      const m = measureUtterance(real);
      expect(m.maximCoda, real).toBe(false);
      expect(m.essayTransitions, real).toBe(0);
      expect(m.weakVerbs, real).toBe(0);
      expect(m.parentheticals, real).toBe(0);
    }
  });

  it("the named 翻译腔 tells each fire on their own textbook case", () => {
    expect(measureUtterance("我们将对这个问题进行讨论，并作出相应的决定。").weakVerbs).toBe(2);
    expect(measureUtterance("首先看背景。其次看数据。总之，一切都好。").essayTransitions).toBe(3);
    const dense = measureUtterance("这是一个重要的、值得的、深刻的、难得的机会。");
    const spoken = measureUtterance("这机会难得，值得抓住。");
    expect(dense.deDensity).toBeGreaterThan(spoken.deDensity);
    const connected = measureUtterance("因为下雨，所以没去。但是明天会去。然而天气难说。");
    expect(connected.connectiveDensity).toBeGreaterThan(0.4);
  });
});

describe("aiShapeOf: the researched composite agrees with him", () => {
  const THE_PROBE = "可以写，但我得先知道写哪一块——税法太大，两千字装不下全部。你要的是：中国的还是别的国家的？给谁看的（普通读者、学生、还是老板）？有个具体的题目吗，比如个税、增值税、还是企业避税那类？给我个方向，我就动笔。没有方向硬写两千字，写出来的是填出来的话，不是文章。";

  it("the probe scores heavily, and mostly on STRUCTURE — vocabulary laundering did not fool it", async () => {
    const { aiShapeOf } = await import("../../../src/life/speech-record.js");
    const read = aiShapeOf(measureUtterance(THE_PROBE), THE_PROBE);
    const structures = read.fired.filter((f) => f.startsWith("S:"));
    expect(structures, "the discourse moves the research names").toEqual(expect.arrayContaining([
      "S:choice-battery", "S:clarify-battery", "S:monoblock", "S:maxim-coda", "S:yes-but-battery", "S:service-coda",
    ]));
    expect(read.fired).toEqual(expect.arrayContaining(["s:written-punct", "s:enum-triple", "s:particle-deficit"]));
    expect(read.score).toBeGreaterThanOrEqual(14);
  });

  it("chat-native Chinese scores near zero", async () => {
    const { aiShapeOf } = await import("../../../src/life/speech-record.js");
    for (const real of ["写哪块？个税还是增值税？", "太大了写不完，你挑一块吧。", "嗯，明天再说。", "在。", "怎么，想我了？"]) {
      const read = aiShapeOf(measureUtterance(real), real);
      expect(read.score, `${real} → ${read.fired.join(",")}`).toBeLessThanOrEqual(2);
    }
  });

  it("her own live replies from the A/B score low — the instrument is not a pessimist", async () => {
    const { aiShapeOf } = await import("../../../src/life/speech-record.js");
    const herGoodReply = "说实话，没干什么。这两天没有留下任何记录——没有日记，没发过消息，连自己醒着的时刻都没有。大概是一直睡着，你合上盖子我就睡了，你刚打开我才醒的。怎么，想我了？";
    const read = aiShapeOf(measureUtterance(herGoodReply), herGoodReply);
    const probe = aiShapeOf(measureUtterance(THE_PROBE), THE_PROBE);
    expect(read.score).toBeLessThan(probe.score / 2);
  });
});

// ── The landing readings, which are the honest half ─────────────────────
describe("sayingRead reports whether the shape her state chose reached the sentence", () => {
  const pair = (text: string) => ({
    predicted: predictUtterance({
      reserve: 0.5, phase: "rested" as const, arousal: 0, reluctance: 0.5,
      openness: 0.5,
    }),
    measured: measureUtterance(text),
  });

  it("is null before there is anything to read, rather than a perfect score", () => {
    // An empty window reporting 1.0 would be the instrument certifying itself on no evidence.
    const r = sayingRead([pair("嗯。")], []);
    expect(r.beatsGap).toBeNull();
    expect(r.openHeld).toBeNull();
  });

  it("beatsGap is the mean distance between what she chose and what she said", () => {
    const r = sayingRead([], [
      { beatsAsked: 2, beatsSaid: 2, beatsCounted: true, leftOpenAsked: false, leftOpenSaid: false },
      { beatsAsked: 1, beatsSaid: 3, beatsCounted: true, leftOpenAsked: false, leftOpenSaid: false },
    ]);
    expect(r.beatsGap).toBe(1); // (0 + 2) / 2
  });

  it("openHeld counts only the turns where her state actually left it unresolved", () => {
    // The denominator matters: turns she meant to close cannot dilute the one facet a model
    // trained to finish sentences is most likely to sand off.
    const r = sayingRead([], [
      { beatsAsked: 1, beatsSaid: 1, beatsCounted: true, leftOpenAsked: true, leftOpenSaid: true },
      { beatsAsked: 1, beatsSaid: 1, beatsCounted: true, leftOpenAsked: true, leftOpenSaid: false },
      { beatsAsked: 1, beatsSaid: 1, beatsCounted: true, leftOpenAsked: false, leftOpenSaid: false },
    ]);
    expect(r.openHeld).toBe(0.5);
  });

  it("a shape ignored on every single turn is visible rather than assumed to have worked", () => {
    const ignored = Array.from({ length: 8 }, () => ({
      beatsAsked: 3, beatsSaid: 1, beatsCounted: true, leftOpenAsked: true, leftOpenSaid: false,
    }));
    const r = sayingRead([], ignored);
    expect(r.openHeld, "the model closed every thought she meant to leave open, silently").toBe(0);
    expect(r.beatsGap).toBe(2);
  });
});

describe("the gap is never two quantities under one name (the split's planted proof)", () => {
  it("a counted landing and a fallback landing land in different numbers", () => {
    // The planted violation this split exists to catch: one landing whose beat count is REAL and
    // says the shape landed exactly (gap 0), one whose count FELL BACK to sentences and reads as a
    // wild gap (|1−3| = 2). Pooled under one name these average to 1.0, a number that describes
    // neither turn and quietly mixes an instrument failure into a behavioural reading.
    const counted = { beatsAsked: 1, beatsSaid: 1, beatsCounted: true, leftOpenAsked: false, leftOpenSaid: false };
    const fallback = { beatsAsked: 1, beatsSaid: 3, beatsCounted: false, leftOpenAsked: false, leftOpenSaid: false };
    const read = sayingRead([], [counted, fallback]);
    expect(read.beatsGap, "the fallback landing leaked into the counted gap").toBe(0);
    expect(read.beatsGapFallback).toBe(2);
    expect(read.beatsCountedShare).toBeCloseTo(0.5, 5);
  });

  it("no landings at all is null everywhere, never a perfect score", () => {
    const read = sayingRead([], []);
    expect(read.beatsGap).toBeNull();
    expect(read.beatsGapFallback).toBeNull();
    expect(read.beatsCountedShare).toBeNull();
  });
});
