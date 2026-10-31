import { describe, it, expect } from "vitest";
import { breathe, breathUnitFor, MAX_SEGMENTS } from "../../../src/life/breath.js";

const LONG = "第一件事想清楚了，周六去。第二件事还得等等，他那边没回话。第三件事其实最要紧，我想了一晚上，还是觉得应该先说清楚再动手。第四件事不急。第五件事你上次提过一嘴，我记着呢，等见面的时候聊。";

describe("the breath splits only where the text already breaks", () => {
  it("the law: concatenation is byte-identical, for planted replies of every shape", () => {
    const planted = [
      LONG,
      LONG.repeat(4),
      "两句话。就这样。",
      "一句没有结尾的话",
      "带换行的\n\n两段。各自成句。".repeat(20),
      "English sentences too. They break at the period. And keep every byte.".repeat(10),
    ];
    for (const text of planted) {
      for (const unit of [70, 120, 220]) {
        expect(breathe(text, unit).join(""), `unit ${unit}`).toBe(text);
      }
    }
  });

  it("a short reply is one breath — most replies are", () => {
    expect(breathe("好，那就周六。", 120)).toHaveLength(1);
    expect(breathe("嗯。", 70)).toHaveLength(1);
  });

  it("a long reply becomes at most three messages, none ending mid-sentence", () => {
    const segments = breathe(LONG.repeat(3), 120);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.length).toBeLessThanOrEqual(MAX_SEGMENTS);
    for (const seg of segments.slice(0, -1)) {
      expect(/[。！？.!?\n]$/u.test(seg), `segment ends mid-sentence: …${seg.slice(-12)}`).toBe(true);
    }
  });

  it("a reply that is one unbroken sentence never splits, however long", () => {
    const unbroken = "一直说下去没有标点也没有停顿的一句话".repeat(30);
    expect(breathe(unbroken, 70)).toHaveLength(1);
  });
});

describe("the unit is hers", () => {
  it("keyed up runs shorter than settled; weary shorter than rested; the band holds", () => {
    const settled = breathUnitFor({ reserve: 0.8, arousal: 0 });
    const keyedUp = breathUnitFor({ reserve: 0.8, arousal: 0.9 });
    const weary = breathUnitFor({ reserve: 0.15, arousal: -0.5 });
    expect(keyedUp).toBeLessThan(settled);
    expect(weary).toBeLessThan(settled);
    for (const u of [settled, keyedUp, weary]) {
      expect(u).toBeGreaterThanOrEqual(30);
      expect(u).toBeLessThanOrEqual(110);
    }
    // The corpus calibration: an ordinary settled evening bubbles at chat scale, not
    // essay scale: the old band's floor sat ABOVE where real bubbles live.
    expect(settled).toBeLessThanOrEqual(100);
  });
});

describe("the beat between messages", () => {
  it("longer thoughts take longer to arrive, inside honest bounds", async () => {
    const { pauseBefore } = await import("../../../src/life/breath.js");
    const short = pauseBefore("嗯，好。");
    const long = pauseBefore("这一段要说的东西比较多，得想一想再打出来，所以到得慢一些。");
    expect(long).toBeGreaterThan(short);
    expect(short).toBeGreaterThanOrEqual(250);
    expect(pauseBefore("很长".repeat(400))).toBeLessThanOrEqual(1_200);
  });
});
