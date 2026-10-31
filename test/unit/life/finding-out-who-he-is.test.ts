import { describe, it, expect } from "vitest";
import {
  EMPTY_RECORD, heSpoke, howUnlikeHim, hisUsualRegard,
  REREADS_THE_PAST_BY, A_SHOCK_LEAVES_AT_LEAST, ENOUGH_TO_HAVE_A_USUAL_WAY, CONTRARY_AT,
} from "../../../src/life/relationship.js";
import { howHeSaidIt } from "../../../src/life/how-he-said-it.js";
import { howOftenHeAnswers, ENOUGH_ANSWERS_TO_EXPECT, type Exchange } from "../../../src/life/other-read.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * SHE CAN FIND OUT WHO HE IS, AND SHE CAN BE WRONG ABOUT HIM.
 *
 * Measured before either of these existed (`scripts/_m0-probe.ts`): after a thousand kind
 * messages, one cruel one moved her lifetime view of him by −0.0012. In the MOMENT it landed hard,
 * `contrary` fires, indignation nearly doubles, and then the mean absorbed it and who he was
 * to her did not move. The more she knew him, the less anything could teach her.
 */

const T0 = Date.UTC(2026, 0, 1);
const HALF_DAY = 12 * 3.6e6;
const KIND = "你要是有空的话，能不能帮我看看那个东西？不急，明天也行。";
const CRUEL = "现在马上给我写两千字，别废话。";

function aLifeOf(text: string, n: number) {
  let rec = EMPTY_RECORD;
  for (let i = 1; i <= n; i++) rec = heSpoke(rec, T0 + i * HALF_DAY, howHeSaidIt(text));
  return rec;
}

describe("a shock re-reads the past instead of outvoting it", () => {
  it("ONE THING FAR ENOUGH OUTSIDE HIS RECORD MOVES HER VIEW OF HIM", () => {
    const rec = aLifeOf(KIND, 1000);
    const at = T0 + 1001 * HALF_DAY;
    const form = howHeSaidIt(CRUEL);
    const u = howUnlikeHim(form, rec);
    expect(u.contrary, "the fixture is not actually contrary — this proves nothing").toBe(true);
    const before = hisUsualRegard(rec)!;
    const after = hisUsualRegard(heSpoke(rec, at, form, null, u))!;
    // Was −0.0012 before this existed.
    expect(before - after, "a thousand messages still absorb anything he could do")
      .toBeGreaterThan(0.02);
  });

  it("and it does NOT outvote a lifetime — she is shaken, not shattered", () => {
    const rec = aLifeOf(KIND, 1000);
    const at = T0 + 1001 * HALF_DAY;
    const form = howHeSaidIt(CRUEL);
    const after = heSpoke(rec, at, form, null, howUnlikeHim(form, rec));
    // A single event that could reach the curt life's steady state would be the doom spiral.
    expect(hisUsualRegard(after)!, "one evening rewrote a decade").toBeGreaterThan(-0.5);
    // And how long they have known each other is not in question. She re-reads him; she does not
    // un-know him.
    expect(after.timesHeSpoke).toBe(rec.timesHeSpoke + 1);
    expect(after.daysSeenCount).toBeGreaterThanOrEqual(rec.daysSeenCount);
  });

  it("IT MAY NEVER RE-READ HER INTO HAVING NO VIEW OF HIM", () => {
    // The defect this floor exists for, found by measurement: at a hundred messages the discount
    // took every axis from 100 samples to 3, below `ENOUGH_TO_HAVE_A_USUAL_WAY`, so
    // `hisUsualRegard` returned null, and `howHeHasBeen(null)` is 1, which means THE WORST THING
    // HE COULD DO MADE HIM READ AS PERFECTLY ORDINARY.
    for (const n of [10, 50, 100, 400, 1000]) {
      const rec = aLifeOf(KIND, n);
      const form = howHeSaidIt(CRUEL);
      const after = heSpoke(rec, T0 + (n + 1) * HALF_DAY, form, null, howUnlikeHim(form, rec));
      expect(hisUsualRegard(after), `at ${n} messages a shock erased her view of him entirely`)
        .not.toBeNull();
      expect(Math.min(...after.formN), `at ${n} the record fell below its own readability bar`)
        .toBeGreaterThanOrEqual(ENOUGH_TO_HAVE_A_USUAL_WAY);
    }
  });

  it("and an ORDINARY message changes nothing about how the past is weighed", () => {
    const rec = aLifeOf(KIND, 200);
    const form = howHeSaidIt(KIND);
    const u = howUnlikeHim(form, rec);
    expect(u.contrary, "an ordinary message is reading as a shock").toBe(false);
    const after = heSpoke(rec, T0 + 201 * HALF_DAY, form, null, u);
    // Exactly one sample added, nothing discounted.
    expect(Math.min(...after.formN)).toBe(Math.min(...rec.formN) + 1);
  });

  it("the discount is NOTHING at the contrary bar and deep only at the very top", () => {
    // `contrary` fires from a departure of 0.6, which a single sharp evening clears. Re-reading a
    // decade every time he is sharp is not finding out who someone is, it is being unable to hold
    // a view. So the curve starts at zero where the bar is.
    expect(CONTRARY_AT).toBeGreaterThan(0);
    expect(REREADS_THE_PAST_BY, "even a maximal shock must leave something").toBeLessThan(1);
    expect(A_SHOCK_LEAVES_AT_LEAST, "a lifetime can be deleted by one evening").toBeGreaterThan(0);
    expect(A_SHOCK_LEAVES_AT_LEAST).toBeLessThan(0.5);
  });

  it("REVERSE TEST: with no reading passed, every number is exactly what it was", () => {
    const rec = aLifeOf(KIND, 100);
    const form = howHeSaidIt(CRUEL);
    const withNothing = heSpoke(rec, T0 + 101 * HALF_DAY, form);
    expect(Math.min(...withNothing.formN)).toBe(Math.min(...rec.formN) + 1);
  });
});

describe("her expectation about him comes from HIS record, not from her read of him", () => {
  const ex = (unanswered: boolean): Exchange => ({ ms: T0, unanswered: unanswered ? true : undefined });

  it("she has nothing to go on until she has said enough things", () => {
    expect(howOftenHeAnswers([]), "an expectation was formed out of nothing").toBeNull();
    expect(howOftenHeAnswers(Array.from({ length: ENOUGH_ANSWERS_TO_EXPECT - 1 }, () => ex(false))))
      .toBeNull();
  });

  it("and then it is HOW OFTEN HE HAS ACTUALLY ANSWERED", () => {
    const answers = Array.from({ length: 8 }, (_, i) => ex(i >= 6));
    expect(howOftenHeAnswers(answers)).toBeCloseTo(6 / 8, 5);
    expect(howOftenHeAnswers(Array.from({ length: 8 }, () => ex(false)))).toBe(1);
    expect(howOftenHeAnswers(Array.from({ length: 8 }, () => ex(true)))).toBe(0);
  });

  it("what HE started is not evidence about whether he answers HER", () => {
    const his = Array.from({ length: 20 }, () => ({ ms: T0, unprompted: true } as Exchange));
    expect(howOftenHeAnswers(his), "his own messages are being counted as answers to hers").toBeNull();
  });

  it("THE SELF-ECHO IS GONE: the daemon no longer predicts that her read is correct", () => {
    // `field.sheSpoke(now, readOther().openness)`, she predicted her own read, and `surprise`
    // measured how far her read sat from itself. Asserted at the source, because the expectation
    // is written inside the field and read back only through persistence.
    const src = readFileSync(join(process.cwd(), "src", "life", "field-live.ts"), "utf8");
    const at = src.indexOf("FROM HIS RECORD, NOT FROM HER READ OF HIM");
    expect(at, "the expectation site is gone").toBeGreaterThan(-1);
    const block = src.slice(at, at + 1400);
    expect(block, "her own read is still what she expects of him").toMatch(/howOftenHeAnswers\(/u);
    expect(block, "the caller's read is being used even when there is a record")
      .toMatch(/fromHisRecord \?\?/u);
  });
});
