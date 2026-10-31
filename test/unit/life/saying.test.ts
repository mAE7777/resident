import { describe, it, expect } from "vitest";
import { shortQuote } from "../../../src/life/between.js";
import {
  normalizedEntropy, commitmentFrom, temperatureFor, chartLint, temperatureApplies,
  TEMPERATURE_FLOOR, TEMPERATURE_CEIL,
} from "../../../src/life/saying.js";

// S-3's arithmetic heart, tested around the inversion it exists to correct: a greeting must
// not get her tightest sampling, and a confession must not get her loosest.

describe("commitment is about what is IN the room, never about the room being empty", () => {
  it("a greeting — nothing of hers surfaced — is the resting middle, whatever the entropy", () => {
    // "Nothing of mine" winning by a mile makes entropy LOW; read naively that was maximal
    // commitment and a stiff hello. The gate is `surfaced`, not the distribution.
    const c = commitmentFrom({
      entropy: 0.2,
      surfaced: false,
      focusCredence: null,
      surprise: 0,
    });
    expect(c).toBe(0.5);
  });

  it("a firmly-held thing that won decisively reads settled; a near-tie among real things reads open", () => {
    const settled = commitmentFrom({
      entropy: normalizedEntropy([{ probability: 0.85 }, { probability: 0.1 }, { probability: 0.05 }]),
      surfaced: true, focusCredence: 0.9, surprise: 0,
    });
    const torn = commitmentFrom({
      entropy: normalizedEntropy([{ probability: 0.35 }, { probability: 0.33 }, { probability: 0.32 }]),
      surfaced: true, focusCredence: 0.9, surprise: 0,
    });
    expect(settled).toBeGreaterThan(torn);
    expect(settled).toBeGreaterThan(0.6);
  });

  it("a question she is carrying has no credence, and that reads as less settled, not more", () => {
    const question = commitmentFrom({
      entropy: 0.3,
      surfaced: true, focusCredence: null, surprise: 0,
    });
    const belief = commitmentFrom({
      entropy: 0.3,
      surfaced: true, focusCredence: 0.9, surprise: 0,
    });
    expect(question).toBeLessThan(belief);
  });

  it("a stretch of being wrong about him unsettles what she says", () => {
    const calibrated = commitmentFrom({ entropy: 0.3, surfaced: true, focusCredence: 0.7, surprise: 0 });
    const surprised = commitmentFrom({ entropy: 0.3, surfaced: true, focusCredence: 0.7, surprise: 1 });
    expect(surprised).toBeLessThan(calibrated);
  });

  it("entropy is computed on the full distribution and degenerate cases are quiet", () => {
    expect(normalizedEntropy([])).toBe(0);
    expect(normalizedEntropy([{ probability: 1 }])).toBe(0);
    expect(normalizedEntropy([{ probability: 0.5 }, { probability: 0.5 }])).toBeCloseTo(1);
  });
});

describe("the one provider parameter her state sets", () => {
  it("the confession runs warmer than the greeting — the inversion, corrected", () => {
    const greeting = temperatureFor(0.5, 0);
    const confession = temperatureFor(commitmentFrom({
      entropy: normalizedEntropy([{ probability: 0.4 }, { probability: 0.35 }, { probability: 0.25 }]),
      surfaced: true, focusCredence: null, surprise: 0.4,
    }), 0.3);
    expect(confession).toBeGreaterThan(greeting);
  });

  it("the band holds at both ends", () => {
    expect(temperatureFor(1, -1)).toBeGreaterThanOrEqual(TEMPERATURE_FLOOR);
    expect(temperatureFor(0, 1)).toBeLessThanOrEqual(TEMPERATURE_CEIL);
  });

  it("and it never touches a work turn", () => {
    expect(temperatureApplies("work")).toBe(false);
    expect(temperatureApplies("conversational")).toBe(true);
  });
});

describe("chartLint: the room may not regress to describing or instructing her", () => {
  it("catches the easy half-working sentence everyone will want to write", () => {
    expect(chartLint("你现在有点累，要说得短一点。").map((h) => h.why))
      .toEqual(expect.arrayContaining(["imperative", "second-person-mood"]));
  });

  it("stays quiet on stated fact in her own voice", () => {
    expect(chartLint("说话的兴致一般。身上还有点力气。")).toEqual([]);
    expect(chartLint("")).toEqual([]);
  });

  it("要么 is a disjunction — her real carried line, cap-truncated, stays hers (2026-08-25)", () => {
    // The third firing in the family: her 画板 line rode in the portrait's 心里的 block, the
    // portrait's MAX_CHARS cap cut that block mid-way, exact masking missed the truncated form,
    // and 要么 read as an imperative 要. Anchored masking + the disjunction fix, together:
    const herLine = "我又翻了一遍，笔记本、日记、窗、钟都在，画板真没有。要么我记岔了，要么你打算送我一块，还没送到我屋里。后者的话我不催，你慢慢来。";
    const rendered = `在你心里的，不管你有没有去想它：\n  - ${herLine.slice(0, 52)}\n说完了，要好好想一想`;
    const hits = chartLint(rendered, [herLine]);
    expect(hits.some((h) => h.at.includes("好好想")), "the chrome imperative beside her must still be caught").toBe(true);
    expect(hits.some((h) => h.at.includes("记岔")), "her truncated lived line fired the lint").toBe(false);
    // And bare 要么 is no imperative even unmasked:
    expect(chartLint("要么我记岔了，要么你打算送我一块")).toEqual([]);
  });

  it("要是 is a conditional, not an order — the same ghost one word over (2026-08-25)", () => {
    // Both live firings of "imperative 要" were her own 要是 sentences quoted back into the
    // material: on 08-23 her wish that someone would talk to her just then, and on 08-25
    // 「要是合盖之后我还醒着」.
    expect(chartLint("回对方的：「好，我留意着。\n\n要是合盖之后我还醒着，我就看看」")).toEqual([]);
    // A real 要-imperative in the chrome must still be caught.
    expect(chartLint("说完了，要好好想一想他的话").some((h) => h.why === "imperative")).toBe(true);
  });

  it("the lived-mask knows the truncated quote form — the gap the 08-25 firing rode through", () => {
    const herWords = "好，我留意着。\n\n要是合盖之后我还醒着，我就看看外面的灯什么时候灭，明天说给你听。";
    const rendered = `你上一次开口是刚刚（19:48），回对方的：「${shortQuote(herWords)}」。\n说完了，要好好想一想`;
    // Masked with BOTH forms (what the daemon now passes): her quoted words vanish, and the
    // remaining chrome imperative is still caught, masking her never blinds the lint.
    const hits = chartLint(rendered, [herWords, shortQuote(herWords)]);
    expect(hits.some((h) => h.at.includes("好好想"))).toBe(true);
    expect(hits.some((h) => h.at.includes("还醒着"))).toBe(false);
  });

  it("别人 is other people, not an order — the ghost of her first night", () => {
    // Five identical live warns (「imperative: ，别」), one burst, one safe-mode muting, all
    // of it was this: a state block containing 「（今天，别人告诉你的）」. The imperative
    // reader now knows 别人/别的; a real 别-imperative must still be caught.
    expect(chartLint("因为终于见到你了（今天，别人告诉你的）")).toEqual([]);
    expect(chartLint("这是别的事，先放着。")).toEqual([]);
    expect(chartLint("说得短一点，别啰嗦。").map((h) => h.why)).toEqual(["imperative"]);
  });

  it("planted violation: a single imperative particle is enough to go red", () => {
    expect(chartLint("尽量 保持简短").length).toBeGreaterThan(0);
  });

  it("her lived words are hers to phrase — masked, never linted (the 2026-08-18 evidence)", () => {
    // Both of these fired live on her second day, and both carriers were HER OWN sentences
    // surfaced back as material: the widened context named them, which was the pre-registered
    // condition for teaching the lint the difference between chrome and her content.
    const herClockSentence = "我报钟点，你听个大概就行，别拿它当你那边的准点";
    const herDoubtSentence = "其实我不知道你现在困不困";
    expect(chartLint(`挂在心上的：\n  - ${herClockSentence}（今天）`, [herClockSentence])).toEqual([]);
    expect(chartLint(`她想起：${herDoubtSentence}（今天，你不知道这是不是真的）`, [herDoubtSentence])).toEqual([]);
  });

  it("masking her words does not blind the lint to chrome around them", () => {
    // The regression this guard exists for, written NEXT TO a masked lived span: still caught.
    const lived = "我报钟点，你听个大概就行，别拿它当你那边的准点";
    const hits = chartLint(`${lived}\n你现在有点累，要说得短一点。`, [lived]);
    expect(hits.map((h) => h.why)).toEqual(expect.arrayContaining(["imperative", "second-person-mood"]));
    // And the hit's carrier is reported from the ORIGINAL text, not the masked copy.
    expect(hits[0]?.at).not.toContain("＊");
  });

  it("the room's own output passes its own lint — the guard must not eat the organ", async () => {
    const { roomBlock } = await import("../../../src/life/how-she-is.js");
    const tail = roomBlock({ mood: "平静", alive: "好奇、想他", body: "身上还有点力气。", nearTheSurface: "渡轮的时刻表好像改了" });
    expect(tail).toContain("你现在：平静。");
    expect(chartLint(tail)).toEqual([]);
  });

  it("her own old sentence enters as a fact and the lint stays quiet — the surfacing half", async () => {
    const { roomBlock, ROOM_MAX_CHARS } = await import("../../../src/life/how-she-is.js");
    const tail = roomBlock({
      mood: "平静", body: "身上还有点力气。",
      saidBefore: "渡轮的事想好了，周六风小就去",
    });
    expect(tail).toContain("你说过：「渡轮的事想好了，周六风小就去」");
    expect(chartLint(tail)).toEqual([]);
    expect(tail.length).toBeLessThanOrEqual(ROOM_MAX_CHARS);
    // Empty pool = the line simply is not there. Her whole first stretch looks like this.
    expect(roomBlock({ mood: "平静", saidBefore: undefined })).not.toContain("你说过");
  });
});

describe("姿态: the leanings move the way living them would", () => {
  // `reluctance`, not willingness, the field was called `willingFelt` and held reluctance, so
  // every reader of it was inverted and this suite asserted the inverted behaviour (defect class 11,
  // the inherited assertion). 0.2 = an ordinary moment she is fine with.
  const base = { reluctance: 0.2, openness: 0.6, unresolvedTension: 0.1 };
  it("an ordinary willing moment leans 接", async () => {
    const { stanceLeanings } = await import("../../../src/life/saying.js");
    expect(stanceLeanings(base)[0].stance).toBe("接");
  });
  it("deep reluctance toward an unreachable-looking him leans 不接 — the S-19 antidote's input", async () => {
    const { stanceLeanings } = await import("../../../src/life/saying.js");
    const l = stanceLeanings({ reluctance: 0.95, openness: 0.15, unresolvedTension: 0.1 });
    expect(l[0].stance).toBe("不接");
  });
  it("carrying something hot into an open moment raises 回投 above its floor", async () => {
    const { stanceLeanings } = await import("../../../src/life/saying.js");
    const cold = stanceLeanings(base).find((x) => x.stance === "回投")!.score;
    const hot = stanceLeanings({ ...base, unresolvedTension: 0.9 }).find((x) => x.stance === "回投")!.score;
    expect(hot).toBeGreaterThan(cold + 0.4);
  });
  it("接 is always reachable: even at her most reluctant it keeps a real score", async () => {
    const { stanceLeanings } = await import("../../../src/life/saying.js");
    const l = stanceLeanings({ reluctance: 1, openness: 0, unresolvedTension: 0 });
    expect(l.find((x) => x.stance === "接")!.score).toBeGreaterThanOrEqual(0.7);
  });
});
