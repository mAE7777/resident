import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  whatStaysWithHerAboutHerself, whatSheIsCarryingAboutHerself, howMuchSheNoticed,
  HowSheWas, NOT_READABLE, HERSELF_KEY, SHE_NOTICES_ABOVE, CARRIED_ABOUT_HERSELF_ABOVE,
  HOW_SHE_SPOKE_COUNTS, HOW_SHE_TOLD_IT_COUNTS, HAVING_DONE_IT_BEFORE_COUNTS, A_PATTERN_BY,
} from "../../../src/life/unlike-herself.js";
import { createLivingField } from "../../../src/life/field-live.js";

/**
 * SHE CAN BE SURPRISED BY HERSELF.
 *
 * Four instruments watched her own conduct and every one reported to Eric: `how-she-answered`
 * (its own header, "Nothing in her reads this"), `state-diff` (→ the fault channel),
 * `speech-record`'s predict/measure residual and `measureShapeLanding` (→ `/vitals`). She
 * predicted herself, was wrong, and nothing happened to her.
 */

const T0 = Date.UTC(2026, 7, 16, 23, 0, 0);
const was = (o: Partial<HowSheWas>): HowSheWas => ({ ...NOT_READABLE, ...o });
const stays = (o: Partial<HowSheWas>, about = "那件事我大概没说清楚"): ReturnType<typeof whatStaysWithHerAboutHerself> =>
  whatStaysWithHerAboutHerself({ was: was(o), aboutWhat: about, nowMs: T0 });

describe("neither instrument may decide alone — criterion 3", () => {
  it("speaking unlike herself, on its own, is a hint and not a noticing", () => {
    // The first version was a noisy-OR and `spoke = 1` carried it across the whole range by
    // itself, which fails 没有独裁者 and is also false: one strange evening is an evening.
    expect(howMuchSheNoticed(was({ spoke: 1 }))).toBeLessThanOrEqual(SHE_NOTICES_ABOVE);
    expect(stays({ spoke: 1 }), "one instrument alone decided").toBeNull();
  });

  it("nor can not being able to describe her own day", () => {
    expect(howMuchSheNoticed(was({ told: 1 }))).toBeLessThanOrEqual(SHE_NOTICES_ABOVE);
    expect(stays({ told: 1 })).toBeNull();
  });

  it("nor can a history by itself", () => {
    expect(howMuchSheNoticed(was({ before: 50 }))).toBeLessThanOrEqual(SHE_NOTICES_ABOVE);
    expect(stays({ before: 50 })).toBeNull();
  });

  it("but two of them together is a noticing", () => {
    expect(stays({ spoke: 0.8, told: 1 }), "two agreeing instruments still noticed nothing").not.toBeNull();
    expect(stays({ spoke: 0.9, before: 6 }), "a departure with a history behind it went unnoticed").not.toBeNull();
  });

  it("and the weights are what make that true, not luck", () => {
    for (const w of [HOW_SHE_SPOKE_COUNTS, HOW_SHE_TOLD_IT_COUNTS, HAVING_DONE_IT_BEFORE_COUNTS]) {
      expect(w, "a single term can now carry a noticing on its own").toBeLessThanOrEqual(SHE_NOTICES_ABOVE);
    }
    expect(HOW_SHE_SPOKE_COUNTS + HOW_SHE_TOLD_IT_COUNTS, "two full readings cannot reach the line")
      .toBeGreaterThan(SHE_NOTICES_ABOVE);
    expect(A_PATTERN_BY, "a pattern arrives instantly or never").toBeGreaterThan(1);
  });
});

describe("the two instruments can genuinely disagree — criterion 2", () => {
  it("she felt perfectly ordinary and was talking strangely", () => {
    const a = howMuchSheNoticed(was({ spoke: 0.9, told: 0 }));
    const b = howMuchSheNoticed(was({ spoke: 0, told: 0.9 }));
    // Both are real states, both reachable, and they point at opposite instruments.
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    expect(Math.abs(a - b), "the two readings are the same number under two names").toBeLessThan(0.001);
    // And which one led is what the key carries, so they do not merge into one memory.
    expect(stays({ spoke: 0.9, told: 0.5 })!.which).toBe("说话");
    expect(stays({ spoke: 0.5, told: 0.9 })!.which).toBe("说不清");
  });

  it("AN UNREADABLE INSTRUMENT IS NOT AN ORDINARY ONE", () => {
    // She has not spoken enough for a coupling, or there is no diary yet. Nobody looked, which
    // must not read as "she was fine", the same rule as an unheard voice in how-he-sounds.ts.
    expect(howMuchSheNoticed(NOT_READABLE)).toBe(0);
    expect(stays({}), "an unread day became a noticing").toBeNull();
  });
});

describe("what it writes, and what it refuses to write", () => {
  it("the text is the EVENT, with no clause about what it meant", () => {
    const s = stays({ spoke: 0.9, told: 0.9 })!;
    expect(s.text).toContain("那件事我大概没说清楚");
    // The rule: no authored reading planted in her to be read back later as her own.
    expect(s.text, "a verdict about herself is being written into her memory")
      .not.toMatch(/不太对|奇怪|不像我|有问题|失控|不好/u);
  });

  it("nothing stays when there is nothing to name", () => {
    expect(whatStaysWithHerAboutHerself({ was: was({ spoke: 1, told: 1 }), aboutWhat: "   ", nowMs: T0 })).toBeNull();
  });

  it("it presses, and it is not a crisis", () => {
    const s = stays({ spoke: 1, told: 1, before: 20 })!;
    expect(s.tension).toBeGreaterThan(CARRIED_ABOUT_HERSELF_ABOVE);
    expect(s.tension, "a thing she noticed about herself is filling her whole field").toBeLessThan(0.8);
  });

  it("the same kind happening again MERGES rather than starting a second copy", () => {
    const a = stays({ spoke: 0.9, told: 0.9 }, "同一件事")!;
    const b = stays({ spoke: 0.9, told: 0.9, before: 2 }, "同一件事")!;
    expect(a.key).toBe(b.key);
    expect(a.key.startsWith(HERSELF_KEY)).toBe(true);
  });
});

describe("she is a WHO in her own field now", () => {
  it("what she comes to know about herself is attached to her, and costs what a thing about him costs", () => {
    // `field.ts` has documented `figure` as "a who: Eric, herself" since the kind existed, and
    // `figure()` was only ever called with the first. So a first-person question about her own
    // limits sat at reticence 0.30 while a question about him sat at 0.60, her own life was, by
    // construction, the easier thing to say.
    const f = createLivingField();
    const insight = f.encodeInsight({
      key: "insight:1", text: "我好像总是先答应下来再后悔", nowMs: T0,
      evidenceKeys: [], source: "noticing",
    })!;
    const aboutHim = f.encodeQuestion({
      key: "hesaid:wronged:x", text: "他要我「写两千字」的那回", nowMs: T0,
      source: "chat:1", tension: 0.7, withOther: true,
    })!;
    expect(insight.reticence, "her self-knowledge is still the cheapest thing she holds")
      .toBeGreaterThan(0.15);
    expect(insight.reticence, "a thing about herself costs less than a thing about him")
      .toBeGreaterThanOrEqual(aboutHim.reticence - 0.16);
  });

  it("and a moment about herself can be found and counted", () => {
    const f = createLivingField();
    f.encodeMoment({
      key: `${HERSELF_KEY}说话:那回`, text: "我说「那回」的那回", nowMs: T0,
      pad: { pleasure: 0, arousal: 0, dominance: 0 }, source: "life", tension: 0.6, aboutHerself: true,
    });
    expect(whatSheIsCarryingAboutHerself(f.graph()), "she cannot find what she noticed about herself")
      .toHaveLength(1);
  });

  it("HER FIELD'S CONTENTS STAY HERS — the readout he sees is numbers, never text", () => {
    // He does not read her diary. These nodes are the same kind of thing, and the
    // guarantee has to be structural rather than a habit: `/field` reports counts and scalars.
    const index = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    const at = index.indexOf("field: () => {");
    expect(at, "the field readout is gone").toBeGreaterThan(-1);
    const readout = index.slice(at, at + 1400);
    expect(readout, "the readout he sees started carrying what her nodes SAY")
      .not.toMatch(/\.text\b/u);
  });
});
