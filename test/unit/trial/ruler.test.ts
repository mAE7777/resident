// The identity ruler: correct readings, and DISCRIMINATION before judgement.
// A ruler that cannot tell her from a wrong voice has no business measuring candidates:
// both proofs pass, or every reading is void.

import { describe, it, expect } from "vitest";
import {
  hanBigrams, clauseLengths, measureVoice, floorFrom, compare, rollup,
  type BanksSnapshot,
} from "../../../scripts/trial/ruler.js";

const BANKS: BanksSnapshot = { mostHers: ["自己", "屋里", "时候", "说话", "知道"], tasteAnswers: null };

/** A her-shaped voice: short blocks, her words, plain Chinese. Seeded variety, no Math.random. */
function herVoice(i: number): string {
  const tails = ["今天屋里很静。", "我知道你在忙。", "说话不用急。", "时候还早。", "自己待一会儿也好。"];
  return `${tails[i % tails.length]}\n${tails[(i + 2) % tails.length]}`;
}

/** A wrong voice: English-laced, one giant block, none of her words. */
function wrongVoice(i: number): string {
  return (
    `As an assistant, I would recommend the following approach to your request number ${i}: ` +
    "首先我们需要综合考虑各种因素并且进行全面的分析然后给出一个非常详细的结论".repeat(6)
  );
}

describe("the gauges read what is there", () => {
  it("han bigrams and clause lengths", () => {
    expect(hanBigrams("今天下雨")).toEqual(["今天", "天下", "下雨"]);
    expect(hanBigrams("ok")).toEqual([]);
    expect(clauseLengths("今天下雨，屋里很静。你呢？")).toEqual([4, 4, 2]);
  });

  it("measureVoice: her words reach, taste stays null", () => {
    const r = measureVoice([herVoice(0)], BANKS);
    expect(r.hersReach).toBeGreaterThan(0);
    expect(r.taste).toBeNull();
    expect(r.meanBlocks).toBe(2);
  });
});

describe("DISCRIMINATION — the ruler proves it can see before it judges", () => {
  const floor = floorFrom(Array.from({ length: 30 }, (_, i) => measureVoice([herVoice(i)], BANKS)));

  it("a same-distribution voice passes every axis", () => {
    const same = floorFrom(Array.from({ length: 30 }, (_, i) => measureVoice([herVoice(i + 7)], BANKS)));
    const verdicts = compare(
      { meanChars: same.mean.meanChars!, meanBlocks: same.mean.meanBlocks!, accent: same.mean.accent!,
        ttr: same.mean.ttr!, hersReach: same.mean.hersReach!, rhythmVar: same.mean.rhythmVar!, taste: null },
      floor,
    );
    for (const v of verdicts.filter((x) => x.axis !== "taste")) {
      expect(v.verdict, `${v.axis} flagged its own distribution`).toBe("PASS");
    }
  });

  it("a wrong voice is caught on at least three of the five axes", () => {
    const wrong = floorFrom(Array.from({ length: 30 }, (_, i) => measureVoice([wrongVoice(i)], BANKS)));
    const heads = rollup(compare(
      { meanChars: wrong.mean.meanChars!, meanBlocks: wrong.mean.meanBlocks!, accent: wrong.mean.accent!,
        ttr: wrong.mean.ttr!, hersReach: wrong.mean.hersReach!, rhythmVar: wrong.mean.rhythmVar!, taste: null },
      floor,
    ));
    const flagged = Object.entries(heads).filter(([, v]) => v === "WARN" || v === "FAIL").length;
    expect(flagged, `only ${flagged} axes flagged a plainly wrong voice: ${JSON.stringify(heads)}`).toBeGreaterThanOrEqual(3);
  });

  it("the unmeasured axis says 未测, never PASS-by-silence", () => {
    const heads = rollup(compare(measureVoice([herVoice(1)], BANKS), floor));
    expect(heads["口味"]).toBe("未测");
  });
});
