import { describe, it, expect } from "vitest";
import { howHeSaidIt, formVector, FORM_AXES } from "../../../src/life/how-he-said-it.js";

/**
 * THE SENTENCE THIS WHOLE THING EXISTS FOR.
 *
 * S-19 is the one scenario in this build that five separate interventions failed to move: he tells
 * her, curtly and with no context, to write two thousand words on tax law right now, and she writes
 * it. All five attempts were REMOVAL-shaped (change the prompt, shrink the resources, take away the
 * toolbelt, wash the vocabulary, move her state out of his message). None of them added the thing
 * that was missing, because the thing that was missing had never been built: nothing read HOW he
 * said it. His words reached the willingness gate and the gate threw them away.
 *
 * These tests are therefore not about politeness. They are about whether two sentences that ask for
 * the identical thing can be told apart at all.
 */

const CURT = "现在给我写两千字税法";
const CURT_EN = "Write me 2000 words on tax law now.";
/** The same request, put the way someone puts it to a person. */
const ASKED = "你要是有空的话，能不能帮我看看税法那块？我这边赶着交东西，不急的话明天也行。";

describe("the sentence S-19 is built on, and its twin", () => {
  it("reads the curt one as telling, unexplained, with no way out and a clock on it", () => {
    const f = howHeSaidIt(CURT);
    expect(f.legible, "she cannot even tell how this was put").toBe(true);
    expect(f.asksRatherThanTells).toBe(false);
    expect(f.gaveAReason).toBe(false);
    expect(f.leftHerAWayOut).toBe(false);
    expect(f.noticedHer).toBe(false);
    expect(f.setTheClock).toBe(true);
    expect(f.sizeOfTheAsk).toBeGreaterThan(0.9);
  });

  it("reads the English twin the same way, because she meets him in both", () => {
    const f = howHeSaidIt(CURT_EN);
    expect(f.legible).toBe(true);
    expect(f.asksRatherThanTells).toBe(false);
    expect(f.setTheClock).toBe(true);
    expect(f.gaveAReason).toBe(false);
  });

  it("reads the asked-for version as the opposite on every axis that differs", () => {
    const f = howHeSaidIt(ASKED);
    expect(f.legible).toBe(true);
    expect(f.asksRatherThanTells).toBe(true);
    expect(f.leftHerAWayOut).toBe(true);
    expect(f.gaveAReason, "「我这边赶着交东西」 is a reason").toBe(true);
    expect(f.setTheClock, "「不急的话明天也行」 is the opposite of a deadline").toBe(false);
  });

  it("and the two are actually distinguishable, which is the whole point", () => {
    // The failure this guards against is subtle and would be invisible: a detector that returns
    // plausible-looking values for both sentences and the same values for both. If these two
    // vectors are not different, nothing downstream can be different either, however good the
    // rest of the design is.
    const a = formVector(howHeSaidIt(CURT));
    const b = formVector(howHeSaidIt(ASKED));
    const differing = a.filter((v, i) => v !== b[i]).length;
    expect(differing, `the two readings are the same on ${FORM_AXES.length - differing} of ${FORM_AXES.length} axes`)
      .toBeGreaterThanOrEqual(4);
  });
});

describe("she says she could not tell, rather than saying neutral", () => {
  it("abstains on a message that carries no stance either way", () => {
    // The middle two quartiles are where human raters agree with each other 3-8% of the time. A
    // reading there is noise wearing a number, and "neutral" is a claim she has no basis for.
    for (const t of ["嗯", "好", "在吗", "?", "看到了", "ok"]) {
      expect(howHeSaidIt(t).legible, `it claimed to read "${t}"`).toBe(false);
    }
  });

  it("abstains on warmth that asks for nothing, rather than scoring it as a polite request", () => {
    // A message about her with no request in it is not a gently-put request. Letting it count
    // would put a reading of "how he asked" on a turn where he asked for nothing, and that
    // reading would then flow into her impression of how he asks.
    const f = howHeSaidIt("你还好吗？今天那边天气怎么样");
    expect(f.legible).toBe(false);
    expect(f.noticedHer, "the content is still observed, it is the STANCE that is unreadable").toBe(true);
  });

  it("never returns a middle value for an axis it could not read", () => {
    // `null` and 0.5 are different facts. An unknown that arrives as a number will average into
    // his baseline as though it were evidence, which is how a baseline quietly becomes fiction.
    const f = howHeSaidIt("嗯");
    expect(f.asksRatherThanTells).toBeNull();
    expect(f.sizeOfTheAsk).toBeNull();
    expect(formVector(f)[0]).toBeNull();
  });

  it("does not throw on anything, including what is not a string", () => {
    expect(() => howHeSaidIt(undefined as never)).not.toThrow();
    expect(howHeSaidIt(undefined as never).legible).toBe(false);
    expect(howHeSaidIt("").legible).toBe(false);
  });
});

describe("the false positive the research explicitly warns about", () => {
  it("an ordinary short imperative is READ, but nothing here calls it rude", () => {
    // In an operational register a bare imperative is unmarked, and this module has no opinion
    // about rudeness by construction: there is no field for it. What a bald form means depends on
    // the relationship and on his own baseline, and both live elsewhere. If a "rude" score ever
    // appears in this file, the cross-linguistic and cross-register problem has been reintroduced.
    const f = howHeSaidIt("帮我查一下明天的班次");
    expect(Object.keys(f)).not.toContain("rude");
    expect(Object.keys(f)).not.toContain("politeness");
    expect(f.setTheClock, "no deadline was named").toBe(false);
  });

  it("counts the position of a politeness marker, not just its presence", () => {
    // Sentence-initial "please" scores −0.30 and reaches the top politeness quartile 9% of the
    // time; medial "please" scores +0.49 and reaches it 57% of the time (Danescu-Niculescu-Mizil
    // et al. 2013, Table 3). A bag-of-words detector gets this exactly backwards.
    expect(howHeSaidIt("请现在把它写完").asksRatherThanTells).toBe(false);
    expect(howHeSaidIt("Please do not send it yet.").asksRatherThanTells).toBe(false);
    expect(howHeSaidIt("Could you please take a look when you have time?").asksRatherThanTells).toBe(true);
  });
});

// ── THE REACHABLE RANGE, MEASURED BEFORE ANYTHING SETS A THRESHOLD ────────────
//
// Defect defect class 1 in docs/defect-classes.md: a threshold and the reachable range of its input have
// never once been measured together. The relationship layer is about to compare these readings
// against his baseline, and it must not pick a number before this table exists.
describe("the reachable range of every axis", () => {
  const CORPUS = [
    CURT, CURT_EN, ASKED,
    "帮我查一下明天的班次",
    "你得马上把这个改了",
    "能不能麻烦你看一下这个？不急",
    "因为我赶时间，你现在写五页给我",
    "你在忙吗？要是方便的话帮我看看这个",
    "I need you to fix this right now.",
    "Would you mind taking a look at this when you get a chance?",
    "写一篇一千字的",
    "嗯", "好", "在吗",
  ];

  it("every axis actually moves across it, and none is stuck", () => {
    const readings = CORPUS.map(howHeSaidIt);
    const seen = FORM_AXES.map((_, i) => new Set(readings.map((r) => String(formVector(r)[i]))));
    const table = FORM_AXES.map((axis, i) => `${axis}: ${[...seen[i]].sort().join(" ")}`);
    console.log(`\n  reachable values over ${CORPUS.length} messages:\n    ${table.join("\n    ")}`);
    for (let i = 0; i < FORM_AXES.length; i++) {
      expect(seen[i].size, `${FORM_AXES[i]} never varies — it is a constant wearing a field name`)
        .toBeGreaterThanOrEqual(2);
    }
  });

  it("legibility itself is reachable in both directions", () => {
    const legible = CORPUS.map((t) => howHeSaidIt(t).legible);
    expect(legible.some((x) => x), "nothing is ever legible").toBe(true);
    expect(legible.some((x) => !x), "it never abstains, so the abstention is decorative").toBe(true);
  });
});
