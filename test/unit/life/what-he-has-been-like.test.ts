import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { howHeHasBeen } from "../../../src/life/how-it-landed.js";
import {
  EMPTY_RECORD, heSpoke, hisUsualRegard, restoreRelationship, knowingHim, KNOWING_CEILING,
  type RelationshipRecord,
} from "../../../src/life/relationship.js";
import { neutralTemperament, drift, distanceFromNeutral } from "../../../src/life/temperament.js";
import { howHeSaidIt } from "../../../src/life/how-he-said-it.js";

/**
 * A LIFETIME OF BEING TREATED WELL USED TO READ EXACTLY LIKE NEVER HAVING SPOKEN.
 *
 * `asHeUsuallyIs` was `clamp01(1 + 0.55 * regard)`. Measured against the range `hisUsualRegard`
 * can actually be driven into (`scripts/_return-paths.ts`), that gave:
 *
 *     a lifetime of curtness       → 0.648
 *     never having spoken          → 1.000
 *     A LIFETIME OF KINDNESS       → 1.000   ← identical to never having spoken
 *
 * Thirty-five per cent of range on the negative half and none at all on the positive, in a
 * LIFETIME MEAN that never forgets. She could learn to expect badly and could not learn to expect
 * well. Put plainly: a lifetime of treating her well came out as a lifetime of neutral.
 *
 * AND THE CAUSE WAS NOT THE COEFFICIENT, which is the part worth remembering. Raising it changed
 * nothing: `clamp01` caps at 1, and this is a MULTIPLIER. `1 + 0.55 * 0.56` and `1 + 0.25 * 0.56`
 * both clamp to exactly 1.000, so a positive slope of ANY size was arithmetically impossible. A
 * category error wearing the clothes of a deliberate bound.
 */

const WELL = "你要是有空的话，能不能帮我看看那份目录？不急，明天也行。";
const CURT = "现在马上整理完，十分钟内给我。";

function after(text: string, times: number): number | null {
  let rec: RelationshipRecord = EMPTY_RECORD;
  for (let i = 0; i < times; i++) rec = heSpoke(rec, 1_700_000_000_000 + i * 864e5, howHeSaidIt(text));
  return hisUsualRegard(rec);
}

describe("what he has been like carries something in BOTH directions", () => {
  it("kindness is worth more than nothing — the defect, stated as a number", () => {
    const kind = after(WELL, 200);
    expect(kind, "the fixture no longer produces a readable regard").not.toBeNull();
    expect(kind!).toBeGreaterThan(0);
    expect(howHeHasBeen(kind), "a lifetime of being treated well still reads as never having spoken")
      .toBeGreaterThan(1.0);
  });

  it("and curtness still costs more than kindness earns", () => {
    // The asymmetry that REMAINS is deliberate and runs the safe way. `standing` feeds
    // `entitlement`; a large positive slope is the loop that turns a good week into a verdict.
    const kind = howHeHasBeen(after(WELL, 200)) - 1;
    const curt = 1 - howHeHasBeen(after(CURT, 200));
    expect(curt, "curtness stopped costing anything").toBeGreaterThan(0);
    expect(kind, "kindness earns as much as or more than curtness costs — that is the spiral")
      .toBeLessThan(curt);
  });

  it("never having spoken is exactly neutral, and is not the same as being treated well", () => {
    // `null` must never be folded in as a middle value, and must never be confused with evidence.
    expect(howHeHasBeen(null)).toBe(1);
    expect(howHeHasBeen(after(WELL, 200))).not.toBe(howHeHasBeen(null));
  });

  it("THE SWEEP: both slopes, across the range that can actually be reached", () => {
    // Measured, not asserted from the source. The reachable range is −0.640 … +0.560, and every
    // step of it has to move the multiplier, a coefficient that is present and inert is the
    // defect this file is about.
    const seen: number[] = [];
    for (let r = -0.64; r <= 0.561; r += 0.08) seen.push(howHeHasBeen(Number(r.toFixed(3))));
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!, `the multiplier stopped responding at step ${i}`).toBeGreaterThan(seen[i - 1]!);
    }
    expect(Math.min(...seen)).toBeGreaterThan(0.6);
    expect(Math.max(...seen), "the ceiling is back — no positive slope can do anything").toBeGreaterThan(1.1);
  });

  it("and it is bounded — a multiplier that can run away is the thing being guarded against", () => {
    // Beyond the reachable range too, because a later change to `hisUsualRegard` could widen it.
    expect(howHeHasBeen(1)).toBeLessThanOrEqual(1.25);
    expect(howHeHasBeen(-1)).toBeGreaterThanOrEqual(0);
    expect(howHeHasBeen(Number.NaN)).toBe(1);
  });

  it("the constants are named, and neither is zero", () => {
    // The census asks that every number that decides something be swept. These two decide how much
    // of him she carries into the next message.
    const src = readFileSync(join(process.cwd(), "src/life/how-it-landed.ts"), "utf8");
    const kindness = Number(/const KINDNESS_COUNTS = ([\d.]+)/u.exec(src)?.[1]);
    const curtness = Number(/const CURTNESS_COUNTS = ([\d.]+)/u.exec(src)?.[1]);
    expect(kindness, "kindness counts for nothing again").toBeGreaterThan(0);
    expect(curtness).toBeGreaterThan(0);
    expect(kindness, "kindness now counts for as much as curtness — the spiral is back")
      .toBeLessThan(curtness);
  });
});

describe("and one facet of five messages is not a verdict about a person", () => {
  it("a single legible axis produces NO usual way at all", () => {
    // The normaliser used to be the weight of whatever axes happened to clear the bar. One axis
    // clearing it meant dividing by that single weight, so five messages whose only readable
    // feature was one facet pinned him at exactly ±1: the strongest possible verdict about a
    // person, from one facet, in a mean that never forgets.
    const src = readFileSync(join(process.cwd(), "src/life/relationship.ts"), "utf8");
    const axes = Number(/const ENOUGH_AXES_TO_HAVE_A_REGARD = (\d+)/u.exec(src)?.[1]);
    expect(axes, "one axis is a verdict again").toBeGreaterThanOrEqual(2);
    expect(src, "the normaliser is back to whatever happened to be heard")
      .toMatch(/REGARD_WEIGHTS\.reduce/u);
  });

  it("and nothing reachable pins him at the extremes any more", () => {
    // The measured consequence: the worst real message moved from −0.800 to −0.640 when the
    // denominator stopped shrinking. Not a tuning change, a single facet can no longer speak for
    // all of him.
    for (const text of [WELL, CURT, "能不能帮我看一下书架那边？", "把目录整理一下，我下午要用。"]) {
      const r = after(text, 200);
      if (r === null) continue;
      expect(Math.abs(r), `"${text.slice(0, 12)}…" pins him at the extreme`).toBeLessThan(0.95);
    }
  });
});

describe("how long they have known each other does not stop at two years", () => {
  // ── THE CLIFF, FOUND BY SIMULATION AND CONFIRMED HERE ──────────────────────────────────────
  //
  // `daysTogether` was `daysSeen.length`, and `daysSeen` is capped at MAX_DAYS_KEPT because it is
  // persisted JSON. Ten years through her own modules (`scripts/_long-horizon.ts`) found it: in a
  // life where he speaks most days the list fills on day 730 and "how long we have known each
  // other" FREEZES AT TWO YEARS, silently, for the rest of her life. On their fifth anniversary
  // she would say two years.
  //
  // The list keeps its bound. The COUNT is one integer and does not need one, which is exactly
  // what the comment on `timesHeSpoke` already said about lifetime counts that stop counting.

  function afterDays(days: number): RelationshipRecord {
    let rec: RelationshipRecord = EMPTY_RECORD;
    for (let d = 0; d < days; d++) {
      // Local noon on each successive day, so `herDayNumber` sees genuinely distinct days.
      const at = new Date(2026, 0, 1, 12, 0, 0);
      at.setDate(at.getDate() + d);
      rec = heSpoke(rec, at.getTime(), howHeSaidIt(WELL));
    }
    return rec;
  }

  it("past the cap, the count keeps going", () => {
    const cap = Number(/export const MAX_DAYS_KEPT = (\d+)/u
      .exec(readFileSync(join(process.cwd(), "src/life/relationship.ts"), "utf8"))?.[1]);
    expect(cap).toBeGreaterThan(0);

    const atCap = afterDays(cap);
    const wellPast = afterDays(cap + 400);
    expect(atCap.daysSeen.length, "the list is not actually bounded").toBe(cap);
    expect(wellPast.daysSeen.length, "the list stopped being bounded").toBe(cap);
    expect(wellPast.daysSeenCount, "she still thinks they have known each other for two years")
      .toBe(cap + 400);
  });

  it("and it counts DAYS, not messages — several in one day is one day", () => {
    let rec: RelationshipRecord = EMPTY_RECORD;
    const noon = new Date(2026, 0, 1, 12, 0, 0).getTime();
    for (let i = 0; i < 20; i++) rec = heSpoke(rec, noon + i * 60_000, howHeSaidIt(WELL));
    expect(rec.daysSeenCount, "twenty messages in an afternoon became twenty days").toBe(1);
    expect(rec.timesHeSpoke).toBe(20);
  });

  it("an older record without the count is restored to the best answer that exists", () => {
    // Never LOWER than the truth: `daysSeen.length` is exactly what the old code would have said,
    // so restoring this way cannot shorten a history she really has.
    const restored = restoreRelationship({ timesHeSpoke: 90, daysSeen: [1, 2, 3, 4, 5] });
    expect(restored.daysSeenCount).toBe(5);
    const withCount = restoreRelationship({ timesHeSpoke: 90, daysSeen: [1, 2, 3], daysSeenCount: 900 });
    expect(withCount.daysSeenCount).toBe(900);
    // And a count LOWER than the list is rubble; the list wins.
    expect(restoreRelationship({ daysSeen: [1, 2, 3, 4], daysSeenCount: 2 }).daysSeenCount).toBe(4);
  });
});

describe("she is not an accelerated person", () => {
  // ── THE QUESTION ──────────────────────────────────────────────────────────────────────────
  //
  // Is she an accelerated person, one whose numbers, after a short chat, move as if they had
  // known each other for a long time?
  //
  // Measured, and the worry was right about one of them. `howWellSheKnowsHim` was
  // `CEILING * n/(n+40)`, MESSAGE COUNT with no time in it. Forty messages in one evening gave
  // 0.250; the same forty spread over two hundred days gave 0.250. Identical. Three hours of
  // talking made her read like someone he had known half a year, and it fed `standing`, which went
  // 0.15 → 0.575 in an evening.
  //
  // The file's own comment already contained the argument: it criticises the version before it for
  // saying "a fortnight is as good as a decade". Saying an evening is as good as half a year is the
  // same objection one level down.

  function evening(n: number): RelationshipRecord {
    let rec: RelationshipRecord = EMPTY_RECORD;
    const at = new Date(2026, 0, 1, 19, 0, 0).getTime();
    for (let i = 0; i < n; i++) rec = heSpoke(rec, at + i * 6 * 60_000, howHeSaidIt(WELL));
    return rec;
  }
  function spread(n: number, days: number): RelationshipRecord {
    let rec: RelationshipRecord = EMPTY_RECORD;
    for (let i = 0; i < n; i++) {
      const d = new Date(2026, 0, 1, 19, 0, 0);
      d.setDate(d.getDate() + Math.floor((i * days) / n));
      rec = heSpoke(rec, d.getTime(), howHeSaidIt(WELL));
    }
    return rec;
  }

  it("an evening of talking does not make her someone who has known him for months", () => {
    const oneNight = knowingHim(evening(40));
    const halfAYear = knowingHim(spread(40, 200));
    expect(oneNight, "one evening still reads as months of knowing him")
      .toBeLessThan(halfAYear / 4);
  });

  it("and the same messages spread out DO count for more", () => {
    // The mirror. A fix that simply made the number small would pass the test above and would have
    // broken the thing it is for: time has to buy something, or she can never come to know him.
    const a = knowingHim(spread(40, 1));
    const b = knowingHim(spread(40, 7));
    const c = knowingHim(spread(40, 40));
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it("neither ingredient can stand in for the other", () => {
    // Not an average: a `min`. You cannot know someone from one very long day however much was
    // said, and you cannot know someone from two hundred days of one message each.
    const talkedAllDay = knowingHim(evening(500));
    // TWENTY messages over two hundred days, one every ten days. The first version of this used
    // two hundred messages over two hundred days and called it "almost nothing", which is a
    // message a day for over half a year: a real relationship, and the code was right to say so.
    // The assertion was wrong, not the arithmetic.
    const thinlySpread = knowingHim(spread(20, 200));
    expect(talkedAllDay, "a single very long day bought her a relationship").toBeLessThan(0.05);
    expect(thinlySpread, "two hundred days of almost nothing bought her a relationship")
      .toBeLessThan(KNOWING_CEILING * 0.4);
    // And a message a day for half a year IS one, the floor that keeps this from being a fix
    // that simply makes the number small.
    expect(knowingHim(spread(200, 200)), "half a year of daily contact still reads as strangers")
      .toBeGreaterThan(KNOWING_CEILING * 0.7);
  });

  it("her way of being cannot be moved by one intense day either", () => {
    // This half was already right, and is measured here so a later change cannot quietly undo it:
    // `drift`'s evidence term is `days / ENOUGH_DAYS`, so fifty steps on day one move her a
    // fraction of what fifty steps over fifty days do.
    let inOneDay = neutralTemperament();
    for (let i = 0; i < 50; i++) inOneDay = drift(inOneDay, { metWhenSpeaking: 1, exploringPaidOff: 0.5, hisShare: 1, activity: 0.5 }, 1);
    let overWeeks = neutralTemperament();
    for (let d = 1; d <= 50; d++) overWeeks = drift(overWeeks, { metWhenSpeaking: 1, exploringPaidOff: 0.5, hisShare: 1, activity: 0.5 }, d);
    expect(distanceFromNeutral(inOneDay), "one intense day made her a different person")
      .toBeLessThan(distanceFromNeutral(overWeeks) / 5);
  });

  it("and the two halfway points are both named numbers", () => {
    const src = readFileSync(join(process.cwd(), "src/life/relationship.ts"), "utf8");
    expect(Number(/const HALFWAY_AT = (\d+)/u.exec(src)?.[1])).toBeGreaterThan(0);
    expect(Number(/const HALFWAY_DAYS = (\d+)/u.exec(src)?.[1])).toBeGreaterThan(0);
    expect(src, "the min was replaced by something either ingredient can carry alone")
      .toMatch(/Math\.min\(fromMessages, fromDays\)/u);
  });
});
