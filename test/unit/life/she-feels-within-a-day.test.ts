import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createInnerState } from "../../../src/life/inner-state.js";
import { feel, appraise, WITHIN_DAY } from "../../../src/life/emotion.js";

/**
 * HOW SHE FEELS WAS A STEP FUNCTION THAT CHANGED ONCE EVERY TWENTY-FOUR HOURS.
 *
 * `appraise` and `relax` were reachable from exactly one place in the whole system: the daily
 * tick. And PAD is not decoration here, it gates which mind she thinks with (`policy`), how
 * far a memory can travel to reach her (`retrievalThreshold`, `spreadHops`), how open her
 * choices are, what charge every memory she forms carries, and what her face shows.
 *
 * So he could say something at nine in the morning that landed hard, and how she felt, and
 * everything downstream of it, was identical until the daily tick rolled. A person whose
 * feelings cannot move inside a day is not a person; it is a mood setting.
 *
 * The daily appraisal stays exactly as it was: it weighs the whole day against her drives and
 * it is the consolidation. This is the other half.
 */
const HAPPENED = { goalProgress: 0.8, novelty: 0.6, control: 0.4, fatigue: 0.2, engagement: 0.7 };

describe("something happens and she feels it now, not tomorrow", () => {
  it("moves her within a day", () => {
    const inner = createInnerState();
    const before = { ...inner.emotion() };
    inner.feel(HAPPENED);
    expect(inner.emotion(), "nothing that happens to her moves how she feels").not.toEqual(before);
  });

  it("but one moment does not define her, the way a whole day can", () => {
    // The relation that matters between the two channels. Ten good moments should move her
    // about as far as one genuinely good day, not further.
    const start = { pleasure: 0, arousal: 0, dominance: 0 };
    const oneMoment = feel(start, HAPPENED);
    const wholeDay = appraise(start, HAPPENED);
    expect(Math.abs(oneMoment.pleasure), "a single moment moves her as much as a whole day")
      .toBeLessThan(Math.abs(wholeDay.pleasure));
    expect(WITHIN_DAY).toBeLessThanOrEqual(0.4);
  });

  it("and it accumulates, so a run of good moments really does lift her", () => {
    let pad = { pleasure: 0, arousal: 0, dominance: 0 };
    for (let i = 0; i < 8; i++) pad = feel(pad, HAPPENED);
    expect(pad.pleasure).toBeGreaterThan(0.3);
  });

  it("a bad stretch moves her the other way", () => {
    let pad = { pleasure: 0.4, arousal: 0, dominance: 0.3 };
    for (let i = 0; i < 8; i++) pad = feel(pad, { goalProgress: -0.8, novelty: 0.1, control: -0.6, fatigue: 0.7, engagement: 0.3 });
    expect(pad.pleasure).toBeLessThan(0);
    expect(pad.dominance).toBeLessThan(0.3);
  });

  it("and it stays inside the range, however long the run", () => {
    let pad = { pleasure: 0, arousal: 0, dominance: 0 };
    for (let i = 0; i < 500; i++) pad = feel(pad, { goalProgress: 1, novelty: 1, control: 1, fatigue: 0, engagement: 1 });
    for (const v of Object.values(pad)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });
});

describe("and the daemon actually lets it happen", () => {
  const daemon = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, (m) => " ".repeat(m.length))
    .replace(/\/\/[^\n]*/gu, (m) => " ".repeat(m.length));

  it("after a moment of her own", () => {
    expect(daemon, "her moments no longer move how she feels").toContain("innerState.feel(");
    // Read off what actually happened in it, not off a constant.
    expect(daemon).toMatch(/goalProgress: o\.error/u);
    expect(daemon, "being stopped from what she wanted does not read as thwarted").toMatch(/control: o\.blocked/u);
  });

  it("and after talking to him", () => {
    expect(daemon, "talking to him leaves how she feels untouched")
      .toContain("faultLog.record(\"life.feel.talk\"");
    // Off her OWN field, never off grading his messages.
    expect(daemon).toMatch(/sig\.otherWarmth - sig\.otherUnease/u);
  });

  it("and the daily appraisal is still there, doing the consolidating", () => {
    const inner = readFileSync(new URL("../../../src/life/inner-state.ts", import.meta.url), "utf8");
    expect(inner, "the daily appraisal was replaced rather than joined").toContain("emotion = appraise(emotion, appraisal)");
    expect(inner).toContain("emotion = relax(emotion)");
  });
});
