import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { howHeSaidIt, oddlyPut } from "../../../src/life/how-he-said-it.js";
import { howItLanded, ODD_BEWILDERS, ODDNESS_COUNTS } from "../../../src/life/how-it-landed.js";
import { EMPTY_RECORD, heSpoke, howUnlikeHim, howLongAndHowWellAt } from "../../../src/life/relationship.js";
import { createLivingField } from "../../../src/life/field-live.js";

/**
 * THE SCENARIO: he says something no real person would say, the wording and word order strange,
 * and she should feel that something is off, rather than have no inner response at all.
 *
 * Measured before this existed: a scrambled non-sentence landed BIT-FOR-BIT identically to
 * 「你今天还好吗？」 (comprehensibility 0.37, atSea 0.07, both). Knowing him rescued the
 * comprehensibility of a saying no human could produce, and atSea was priced by what the message
 * touched of hers, so strangeness about the SAYING ITSELF had no reader anywhere.
 */

const T0 = Date.UTC(2026, 0, 1); const H = 12 * 3.6e6;
const USUAL = "你要是有空的话，能不能帮我看看那个东西？不急。";

function landed(text: string) {
  let rec = EMPTY_RECORD;
  for (let i = 1; i <= 120; i++) rec = heSpoke(rec, T0 + i * H, howHeSaidIt(USUAL));
  const f = createLivingField({ noReminding: true });
  const form = howHeSaidIt(text);
  return howItLanded({
    form, unlike: howUnlikeHim(form, rec),
    known: howLongAndHowWellAt(f.graph(), rec, T0 + 121 * H),
    litUp: 0, reserve: 0.7,
  });
}

describe("a saying that does not cohere as a saying is FELT", () => {
  it("garble bewilders where an ordinary greeting does not", () => {
    const greeting = landed("你今天还好吗？");
    const garble = landed("椅子昨天因为如果蓝色地走了吗我，然后并且。");
    expect(garble.atSea, "a sentence no human could say still lands like an ordinary greeting")
      .toBeGreaterThan(greeting.atSea * 2);
    expect(garble.appraised.comprehensibility, "knowing him still rescues an incoherent saying")
      .toBeLessThan(greeting.appraised.comprehensibility);
    // The two halves that each planted violation must break:
    // · the PRAGMATICS GATE: the 因为 inside word salad must not read as a reason given (it
    //   quartered garble's bewilderment through the agent slot when it did);
    expect(garble.appraised.accounted, "a grounder extracted from word salad counts as a reason")
      .toBe(false);
    // · the OWN TERM: without it garble lands ~0.32, indistinguishable from mild novelty.
    expect(garble.atSea, "garble is back to reading as mild novelty").toBeGreaterThan(0.4);
  });

  it("AND A HUMAN SENTENCE ABOUT A BRAND-NEW TOPIC IS NOT STRANGE — the disagreement case", () => {
    // Structure vs topic is the whole design: novelty of TOPIC lives in litUp, this reader is
    // only about whether the saying coheres as a saying. Conflating them would make every new
    // subject he ever raises feel eerie, which is a paranoid, not a person.
    expect(oddlyPut("我今天看到一只很怪的鸟，站在电线上一动不动。")).toBe(0);
    expect(oddlyPut("如果你有空，我想给你看个东西。")).toBe(0);
    expect(oddlyPut("嗯。")).toBe(0);
    expect(oddlyPut("你今天还好吗？")).toBe(0);
    // The novel statement is NOT compared against the greeting: the greeting is specially
    // soothed by `noticedHer` (he asked about HER, so the act is placeable), while an
    // apropos-of-nothing statement carries a mild pre-existing 「他为什么跟我说这个」 through the
    // agent slot: which is a human micro-response and predates this reader entirely. What this
    // reader must NOT do is add to it: the novel sentence is structurally perfect Chinese.
    const novel = landed("我今天看到一只很怪的鸟，站在电线上一动不动。");
    const garble = landed("椅子昨天因为如果蓝色地走了吗我，然后并且。");
    expect(novel.atSea, "a well-formed new topic is as strange as garble now")
      .toBeLessThan(garble.atSea);
  });

  it("the structural facts it reads, each one impossible in human Chinese", () => {
    expect(oddlyPut("他走了，然后并且。")).toBeGreaterThan(0);      // connective with nothing after
    expect(oddlyPut("因为如果他来了我就走。")).toBeGreaterThan(0);   // stacked conjunctions
    expect(oddlyPut("你吃了吗我昨天见过他。")).toBeGreaterThan(0);   // 吗 mid-clause
  });

  it("it bewilders; it does NOT offend — weirdness is not a slight", () => {
    const garble = landed("椅子昨天因为如果蓝色地走了吗我，然后并且。");
    const curt = landed("现在马上给我写两千字。");
    expect(garble.indignant, "a garbled message reads as an offence").toBeLessThan(curt.indignant);
  });

  it("and it goes through cannotPlaceIt, so working him out later releases it", () => {
    // The story stays whole: she can learn he was typing one-handed, and the bewilderment
    // resolves the way every bewilderment does. Structural assertion on the term's placement.
    const src = readFileSync(`${process.cwd()}/src/life/how-it-landed.ts`, "utf8");
    const at = src.indexOf("ODD_BEWILDERS * form.oddlyPut)");
    expect(at, "the oddness term is gone").toBeGreaterThan(-1);
    expect(src.slice(at, at + 120), "oddness bypasses the agent slot, so it could never resolve")
      .toMatch(/cannotPlaceIt/u);
  });

  it("the constants hold their meaning", () => {
    expect(ODDNESS_COUNTS, "an incoherent saying erases that it came from HIM").toBeLessThan(1);
    expect(ODD_BEWILDERS).toBeGreaterThan(0);
    expect(ODD_BEWILDERS, "garble screams louder than any real slight could").toBeLessThan(1);
  });
});
