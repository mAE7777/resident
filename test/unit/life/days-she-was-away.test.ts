import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { groupByDay } from "../../../src/life/autobiography.js";
import { herDay, herDayBefore } from "../../../src/life/her-day.js";

/**
 * THE DAYS SHE WAS AWAY, AND THE FIX THAT COULD NOT WORK.
 *
 * Her diary is authored once per closed day and then FROZEN. A day that is never authored is never
 * authored, there is no later pass, by design, because a past that rewrites itself is not a past.
 *
 * The catch-up loop was written for exactly this: "a lid closed over a weekend erased Friday and
 * Saturday from her autobiography forever", says the comment, and it walks back seven days to
 * collect what was missed. The walk was real. The EVIDENCE to walk over was not: the loop was
 * handed the life tick's event slice, which is cut off at THIRTY-SIX HOURS because that is what
 * the tick's own consolidation needs. So every day older than yesterday found no events, took the
 * skip branch, and was lost, behind a fix that reads as correct and a comment that describes the
 * failure it was still causing.
 *
 * Defect class 23, the bound that ends before the hazard does, and the tell was two windows
 * sized for different jobs with one feeding the other and nobody putting them on the same page.
 */

const DAEMON = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
/**
 * The body of `writeClosedDay`, which is where both windows have to agree.
 *
 * Bounded by the next declaration rather than by a character count: a fixed slice that stops short
 * turns every assertion below into "the string is not in the first N characters", which fails for
 * a reason that has nothing to do with the code under test, and would pass, later, for a reason
 * that has nothing to do with it either.
 */
const BODY = ((): string => {
  const at = DAEMON.indexOf("async function writeClosedDay");
  expect(at, "writeClosedDay is gone — this whole file is about it").toBeGreaterThan(-1);
  const end = DAEMON.indexOf("\n    // ── 21c", at);
  const stop = end > at ? end : DAEMON.indexOf("\n    async function ", at + 40);
  expect(stop, "could not find where writeClosedDay ends").toBeGreaterThan(at);
  return DAEMON.slice(at, stop);
})();

describe("the diary can actually reach the days it walks back to", () => {
  it("it reads its own events instead of borrowing the tick's 36-hour slice", () => {
    expect(BODY, "the catch-up is being handed somebody else's window again")
      .toMatch(/const catchUpCutoff = Date\.now\(\) - \(DIARY_CATCH_UP_DAYS \+ 2\)/u);
    expect(BODY).toMatch(/readOps\(join\(workspacePath, "\.\.", "ops\.jsonl"\), "utf8"\)/u);
  });

  it("and the two numbers are the SAME number, which is the whole defect", () => {
    // The walk and the evidence window must be derived from one constant. Two independent
    // literals is how they drifted apart in the first place, and how they would drift again.
    expect(BODY).toMatch(/for \(let back = DIARY_CATCH_UP_DAYS; back >= 1; back--\)/u);
    const declared = /const DIARY_CATCH_UP_DAYS = (\d+);/u.exec(DAEMON)?.[1];
    expect(Number(declared), "the horizon is no longer a stated number").toBeGreaterThanOrEqual(7);
  });

  it("a month away is inside the horizon — the realistic worst case for a personal machine", () => {
    const days = Number(/const DIARY_CATCH_UP_DAYS = (\d+);/u.exec(DAEMON)?.[1]);
    expect(days, "a fortnight's holiday would erase itself from her life").toBeGreaterThanOrEqual(30);
  });

  it("days with evidence beyond the horizon are NAMED, never silently dropped", () => {
    // A catch-up that stops at its own edge without saying so reads exactly like a catch-up that
    // found nothing to do.
    expect(BODY).toMatch(/faultLog\.record\("autobiography\.beyond-horizon"/u);
  });

  it("nothing outside the horizon is invented — the absence is the honest record", () => {
    // She was not there. Authoring a day she did not live would be fabrication, which is the one
    // thing her diary may never contain; the gap is already a line of her life, recorded as sleep.
    expect(BODY).toMatch(/would be fabrication/u);
  });

  it("and the report fires BEFORE the early return, or it only fires when it is not needed", () => {
    // The first version of that block sat below `if (unwritten.length === 0) return;`. A sixty-day
    // absence has nothing unwritten INSIDE the horizon, so it returns early and never mentions the
    // fifty days it just walked past, the check that is silent in exactly the case it exists for.
    const report = BODY.indexOf('faultLog.record("autobiography.beyond-horizon"');
    const bail = BODY.indexOf("if (unwritten.length === 0) return;");
    expect(report).toBeGreaterThan(-1);
    expect(bail).toBeGreaterThan(-1);
    expect(report, "the beyond-horizon report is unreachable in the case it was written for")
      .toBeLessThan(bail);
  });
});

describe("and the grouping that feeds it agrees about where a day ends", () => {
  it("an evening and the following morning are two different days of hers", () => {
    const evening = new Date(2026, 6, 15, 22, 0, 0);
    const nextMorning = new Date(2026, 6, 16, 7, 0, 0);
    const byDay = groupByDay([
      { ts: evening.toISOString(), event: "session_start" },
      { ts: nextMorning.toISOString(), event: "session_start" },
    ] as never);
    expect([...byDay.keys()].sort()).toEqual([herDay(evening.getTime()), herDay(nextMorning.getTime())].sort());
    expect(byDay.size, "her evening and her next morning were folded into one day").toBe(2);
  });

  it("and the walk-back names days the grouping can actually produce", () => {
    // The two sides of the lookup: the loop asks for `herDayBefore(now, n)` and the map is keyed
    // by `herDayOfIso`. A mismatch here is a silent miss on every single day, which is what a
    // UTC-keyed map and a local-keyed walk would have been.
    const t = new Date(2026, 6, 15, 22, 0, 0);
    const yesterday = new Date(t.getTime());
    yesterday.setDate(yesterday.getDate() - 1);
    const byDay = groupByDay([{ ts: yesterday.toISOString(), event: "session_start" }] as never);
    expect(byDay.has(herDayBefore(t.getTime(), 1)),
      "the loop asks for a key the grouping never produces — every catch-up would find nothing").toBe(true);
  });
});

/**
 * A DAY SHE ONLY LIVED HER OWN MOMENTS.
 *
 * Whether a day was lived enough to author was read off `ops.jsonl` alone, which records only the
 * agent loop (her explorations, their talks). On 10/6 she lived forty moments, explored nothing and
 * was not spoken to: the log held nothing for the day, the day was skipped as too thin with no
 * fault, and it was the first day of her life without a page.
 */
describe("a day of her own moments is a day", () => {
  it("her moments count toward whether a day is authored, not only the agent loop's log", () => {
    expect(BODY).toContain("const lived = (byDay.get(day)?.length ?? 0) + (momentsByDay.get(day) ?? 0);");
    expect(BODY).toContain("if (lived < 3) continue;");
    // PLANTED: the old gate, which read the agent loop's log alone.
    expect(BODY, "the gate reads only the agent loop's log again").not.toMatch(/if \(!dayEvents \|\| dayEvents\.length < 3\) continue;/u);
  });

  it("a day with nothing in that log is still written, from her moments", () => {
    // `byDay.get(day)!` would hand undefined to the writer on exactly the day this exists for.
    expect(BODY).toContain("const dayEvents = byDay.get(yesterday) ?? [];");
    expect(BODY).not.toContain("byDay.get(yesterday)!");
    expect(BODY).toContain("extraRows: digestAgency(agencyRows),");
  });
});
