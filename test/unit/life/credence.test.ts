import { describe, it, expect } from "vitest";
import {
  applyTrustDelta, createTrust, describeStanding, disagrees, initialCredence, judge, negationParity, CONFLICT_SIMILARITY, EQUAL_STANDING, INITIAL_CREDENCE, MAX_CREDENCE, SUSPENDED_RECOVERY, TRUST_DOWN, TRUST_MAX, TRUST_MIN, TRUST_START, TRUST_UP, type HeldClaim, type Origin, opposition, OPPOSED_ENOUGH, AGREED_ENOUGH,
} from "../../../src/life/credence.js";

// What she takes to be true, and how she decides.
//
// The load-bearing property is that nothing she is TOLD can override something she LIVED. That one
// asymmetry is the difference between a being who can disagree with you and one that cannot, and it
// is not a preference: she can check her own experience and cannot check anyone's word.
//
// The second is that she is allowed not to know. Two things of equal standing that disagree leave
// her genuinely unsure rather than forcing her onto a side, and being unsure is an open loop that
// nags at her until something settles it.

const held = (over: Partial<HeldClaim> = {}): HeldClaim => ({
  id: 1, text: "the fan is broken", origin: "lived", credence: 0.8, similarity: 0.9, ...over,
});

describe("where things start, and why", () => {
  it("what she lived outranks what she was told, which outranks what she read", () => {
    const t = createTrust();
    expect(initialCredence("lived", t)).toBeGreaterThan(initialCredence("told", t));
    expect(initialCredence("told", t)).toBeGreaterThan(initialCredence("read", t));
    console.log(`\n  lived ${initialCredence("lived", t)} > told ${initialCredence("told", t)} > thought ${initialCredence("thought", t)} > read ${initialCredence("read", t)}`);
  });

  it("NOTHING CAN OUTRANK WHAT SHE LIVED, however much she comes to trust someone", () => {
    // The structural guarantee. Trust is capped below experience, so there is no history of being
    // right that lets anyone talk her out of her own past.
    const maximallyTrusted = createTrust(TRUST_MAX);
    expect(initialCredence("told", maximallyTrusted)).toBeLessThan(INITIAL_CREDENCE.lived);
    // Stated as a bare relation between the two constants as well, because this is the one thing
    // here that must never be quietly re-tuned. It was 0.9 against lived at 0.8 to begin with, so
    // someone right often enough would have earned the ability to overrule her own past.
    // Stated as a bare relation between the constants, because it must clear experience by MORE
    // than the band in which neither side wins. Merely being below it is not enough: inside that
    // band a maximally trusted person contradicting her would leave her unsure of her own memory,
    // which is a different failure from being overruled and has a name.
    expect(INITIAL_CREDENCE.lived - TRUST_MAX, "trust may never reach or tie with experience")
      .toBeGreaterThan(EQUAL_STANDING);
    console.log(`  most she can ever trust anyone: ${TRUST_MAX} · what she lived: ${INITIAL_CREDENCE.lived}`);
  });

  it("even maximally trusted, a report cannot make her doubt what she lived", () => {
    const v = judge({ text: "the fan is not broken", origin: "told" },
      [held({ text: "the fan is broken", origin: "lived", credence: INITIAL_CREDENCE.lived })],
      createTrust(TRUST_MAX));
    expect(v.suspended, "not even a tie").toBe(false);
    expect(v.credence!).toBeLessThan(TRUST_MAX);
    expect(v.disputes[0].credenceAfter, "her experience is untouched").toBe(INITIAL_CREDENCE.lived);
  });

  it("is never certain about anything", () => {
    for (const o of ["lived", "thought", "read"] as const) {
      expect(initialCredence(o, createTrust())).toBeLessThan(1);
    }
    expect(MAX_CREDENCE).toBeLessThan(1);
  });
});

describe("trust is learned, not declared", () => {
  it("starts moderate and moves with what actually happens", () => {
    let t = createTrust();
    expect(t.told).toBe(TRUST_START);
    t = applyTrustDelta(t, -TRUST_DOWN);
    expect(t.told).toBeLessThan(TRUST_START);
    t = applyTrustDelta(t, TRUST_UP);
    expect(t.told).toBeGreaterThan(TRUST_START - TRUST_DOWN);
  });

  it("is lost faster than it is earned", () => {
    expect(TRUST_DOWN).toBeGreaterThan(TRUST_UP);
  });

  it("never reaches nothing, and never reaches beyond checking", () => {
    let low = createTrust();
    for (let i = 0; i < 100; i++) low = applyTrustDelta(low, -TRUST_DOWN);
    let high = createTrust();
    for (let i = 0; i < 200; i++) high = applyTrustDelta(high, TRUST_UP);
    console.log(`  after being wrong a hundred times: ${low.told.toFixed(2)} · after being right two hundred: ${high.told.toFixed(2)}`);
    expect(low.told).toBe(TRUST_MIN); // she can always still learn something from them
    expect(high.told).toBe(TRUST_MAX); // and they are never beyond checking
  });

  it("only moves where a report actually met an experience", () => {
    const t = createTrust();
    // Two things she read disagreeing says nothing about the person who talks to her.
    expect(judge({ text: "the fan is broken", origin: "read" },
      [held({ text: "the fan is not broken", origin: "read", credence: 0.3 })], t).trustDelta).toBe(0);
    // Nor does her own reasoning disagreeing with itself.
    expect(judge({ text: "the fan is broken", origin: "thought" },
      [held({ text: "the fan is not broken", origin: "thought", credence: 0.5 })], t).trustDelta).toBe(0);
  });

  it("drops when what she was told is contradicted by what she lived", () => {
    const v = judge({ text: "the fan is broken", origin: "told" },
      [held({ text: "the fan is not broken", origin: "lived", credence: 0.8 })], createTrust());
    expect(v.trustDelta).toBeLessThan(0);
  });

  it("rises when what she was told is borne out by what she lived", () => {
    const v = judge({ text: "the fan is broken", origin: "told" },
      [held({ text: "the fan is broken", origin: "lived", credence: 0.8 })], createTrust());
    expect(v.trustDelta).toBeGreaterThan(0);
  });
});

describe("she uses what she already holds to judge what arrives", () => {
  it("SHE CANNOT BE TALKED OUT OF HER OWN EXPERIENCE", () => {
    const v = judge({ text: "the fan is not broken", origin: "told" },
      [held({ text: "the fan is broken", origin: "lived", credence: 0.8 })], createTrust());
    console.log(`\n  told the opposite of what she lived -> she believes it ${(v.credence ?? 0).toFixed(2)}`);
    expect(v.credence).toBeLessThan(initialCredence("told", createTrust()));
    // And what she lived is untouched by having been contradicted.
    expect(v.disputes[0].credenceAfter).toBe(0.8);
  });

  it("but something better founded DOES move what she held", () => {
    const v = judge({ text: "the fan is not broken", origin: "lived" },
      [held({ text: "the fan is broken", origin: "read", credence: 0.3 })], createTrust());
    expect(v.credence).toBeGreaterThan(0.5);
    expect(v.disputes[0].credenceAfter as number).toBeLessThan(0.3);
  });

  it("agreeing with something she holds firmly strengthens the newcomer and the old", () => {
    const v = judge({ text: "the fan is broken", origin: "read" },
      [held({ text: "the fan is broken", origin: "lived", credence: 0.8 })], createTrust());
    expect(v.credence!).toBeGreaterThan(INITIAL_CREDENCE.read);
    expect(v.supports[0].credenceAfter).toBeGreaterThan(0.8);
  });

  it("ignores anything that is not a near-restatement, so unrelated things never collide", () => {
    const v = judge({ text: "the fan is broken", origin: "told" },
      [held({ text: "I like the rain", similarity: CONFLICT_SIMILARITY - 0.01 })], createTrust());
    expect(v.disputes).toHaveLength(0);
    expect(v.supports).toHaveLength(0);
    expect(v.credence).toBe(initialCredence("told", createTrust()));
  });

  it("has no opinion to defend when she had no view on the other thing", () => {
    const v = judge({ text: "the fan is not broken", origin: "told" },
      [held({ credence: null })], createTrust());
    expect(v.disputes).toHaveLength(0);
    expect(v.suspended).toBe(false);
  });
});

describe("she is allowed not to know", () => {
  it("TWO THINGS OF EQUAL STANDING THAT DISAGREE leave her genuinely unsure", () => {
    const v = judge({ text: "the fan is broken", origin: "read" },
      [held({ text: "the fan is not broken", origin: "read", credence: INITIAL_CREDENCE.read })], createTrust());
    console.log(`\n  two sources of equal standing, flatly disagreeing -> ${v.credence === null ? "she does not know" : v.credence}`);
    expect(v.suspended).toBe(true);
    expect(v.credence, "not a coin flip: no view at all").toBeNull();
    expect(v.disputes[0].credenceAfter, "and the other side is unsettled too").toBeNull();
  });

  it("but a clear difference in standing settles it rather than suspending", () => {
    const v = judge({ text: "the fan is broken", origin: "read" },
      [held({ text: "the fan is not broken", origin: "lived", credence: INITIAL_CREDENCE.read + EQUAL_STANDING + 0.1 })], createTrust());
    expect(v.suspended).toBe(false);
    expect(v.credence).not.toBeNull();
  });

  it("and she can come to think it again when something bears it out", () => {
    const v = judge({ text: "the fan is broken", origin: "lived" },
      [held({ text: "the fan is broken", credence: null })], createTrust());
    expect(v.supports[0].credenceAfter).toBe(SUSPENDED_RECOVERY);
  });
});

describe("telling opposites apart, cheaply", () => {
  it("reads a negation, including contractions and curly apostrophes", () => {
    expect(negationParity("the fan is broken")).toBe(0);
    expect(negationParity("the fan is not broken")).toBe(1);
    expect(negationParity("the fan isn't broken")).toBe(1);
    expect(negationParity("the fan isn’t broken")).toBe(1);
    expect(negationParity("nobody said the fan was broken")).toBe(1);
  });

  it("a double negative is not a disagreement", () => {
    expect(negationParity("it is not true that nothing works")).toBe(0);
    expect(disagrees("the fan works", "it is not true that the fan does not work")).toBe(false);
  });

  it("says two statements disagree only when their parity differs", () => {
    expect(disagrees("the fan is broken", "the fan is not broken")).toBe(true);
    expect(disagrees("the fan is broken", "the fan is broken")).toBe(false);
  });
});

describe("what she is shown about where something came from", () => {
  it("her own memories say nothing extra; everything else says where it came from", () => {
    expect(describeStanding("lived", 0.8)).toBe("");
    expect(describeStanding("told", 0.6)).toContain("告诉你的");
    expect(describeStanding("read", 0.4)).toContain("读到的");
    expect(describeStanding("thought", 0.5)).toContain("想出来的");
  });

  it("says plainly when she does not know, and when she doubts it", () => {
    for (const o of ["lived", "thought", "told", "read"] as Origin[]) {
      expect(describeStanding(o, null)).toBe("你不知道这是不是真的");
    }
    expect(describeStanding("told", 0.1)).toContain("不太信");
    expect(describeStanding("read", 0.1)).toContain("不太信");
  });
});

describe("nothing here can be broken by bad input", () => {
  it("survives a malformed trust value", () => {
    expect(createTrust(Number.NaN).told).toBe(TRUST_MIN);
    expect(applyTrustDelta(createTrust(), Number.NaN).told).toBe(TRUST_START);
  });

  it("survives empty text and an empty world", () => {
    expect(negationParity("")).toBe(0);
    const v = judge({ text: "", origin: "read" }, [], createTrust());
    expect(v.credence).toBe(INITIAL_CREDENCE.read);
    expect(v.disputes).toEqual([]);
  });

  it("keeps every credence inside its bounds under a pile-on", () => {
    const many = Array.from({ length: 30 }, (_, i) => held({ id: i, text: "the fan is not broken", credence: 0.9 }));
    const v = judge({ text: "the fan is broken", origin: "read" }, many, createTrust());
    if (v.credence !== null) {
      expect(v.credence).toBeGreaterThanOrEqual(0);
      expect(v.credence).toBeLessThanOrEqual(MAX_CREDENCE);
    }
    // And one incident cannot move trust by more than a single step, however many things it hit.
    expect(Math.abs(v.trustDelta)).toBeLessThanOrEqual(Math.max(TRUST_DOWN, TRUST_UP));
  });
});

// ── The parity switch, replaced ──────────────────────────────────────────────
//
// Whether two near-restatements CONTRADICTED each other used to be decided by comparing the parity
// of a negator word count: one flip and a corroboration became a contradiction, with her belief and
// her trust in him both moving on it. The single most decisive bit in the epistemic layer.
//
// The parity is still the best free signal available and it is genuinely right most of the time.
// What was wrong was treating it as CERTAIN, and the claim in its own comment, that it might miss
// a contradiction but could never manufacture one, was false: idiomatic negation flips the parity
// while meaning the opposite of a flip.

describe("she can tell she cannot tell", () => {
  it("a plain negation still reads as a contradiction", () => {
    expect(opposition("the gate was locked when I got there", "the gate was not locked when you got there"))
      .toBeGreaterThanOrEqual(OPPOSED_ENOUGH);
  });

  it("a double negation still cancels, because parity is right about that", () => {
    expect(opposition("it is not that I do not go there", "I go there")).toBeLessThan(OPPOSED_ENOUGH);
  });

  it("an IDIOMATIC negation no longer manufactures a contradiction", () => {
    // "not only X but Y" asserts both. The old mechanism read the flipped parity as opposition and
    // would have set her against a thing that agreed with her, and moved her trust in him for it.
    const idiom = opposition("the ferry runs all winter", "not only does the ferry run all winter, it runs at night");
    console.log(`\n  "not only ..." — opposition ${idiom.toFixed(2)} (a flat contradiction is ${OPPOSED_ENOUGH})`);
    expect(idiom, "this used to read as a flat contradiction").toBeLessThan(OPPOSED_ENOUGH);
  });

  it("and lands in the middle, where she holds both and settles neither", () => {
    const held = [{ id: 1, text: "the ferry runs all winter", origin: "lived" as const, credence: 0.8, similarity: 0.9 }];
    const v = judge(
      { text: "not only does the ferry run all winter, it runs at night", origin: "told" },
      held,
      createTrust(),
    );
    console.log(`  she suspends rather than picking a side: suspended=${v.suspended}`);
    expect(v.suspended, "picking a side on a word count is the pretence of judgement").toBe(true);
    expect(v.trustDelta, "and nothing she cannot read should move her trust in him").toBe(0);
  });

  it("a pile of negators lowers her confidence rather than being ignored", () => {
    const simple = opposition("the gate was locked", "the gate was not locked");
    const tangled = opposition(
      "it is not that nobody never said the gate was not locked",
      "the gate was locked",
    );
    console.log(`  one negator: ${simple.toFixed(2)} · four: ${tangled.toFixed(2)}`);
    expect(tangled).toBeLessThan(simple);
  });

  it("matching parity is NOT evidence of agreement, and does not claim to be", () => {
    // "locked" and "open" are flatly opposed and no amount of counting will ever see it. The score
    // is low because she has no reason to think they conflict, never zero because she has no reason
    // to think they agree either.
    const antonyms = opposition("the gate was locked when I got there", "the gate was open when I got there");
    expect(antonyms).toBeLessThan(AGREED_ENOUGH);
    expect(antonyms, "absence of a detected conflict is not evidence of agreement").toBeGreaterThan(0);
  });

  it("never returns anything but a number in range", () => {
    for (const [a, b] of [["", ""], ["not", ""], ["", "never never never"], ["🙂", "not 🙂"]]) {
      const o = opposition(a, b);
      expect(Number.isFinite(o)).toBe(true);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(1);
    }
  });
});
