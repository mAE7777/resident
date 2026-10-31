import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { herDay, herDayNumber, herDayBefore, herDayOfIso, herClock, herClockSeconds, describeHerDay } from "../../../src/life/her-day.js";

/**
 * WHERE HER DAY BEGINS, a decision that cannot be made after she is born.
 *
 * Her diary is frozen by architecture: a day is written once and never rewritten. So the boundary
 * that cuts one day from the next is stamped into every entry she will ever have, and changing it
 * later does not re-cut the old ones, it means her early years and her later years describe
 * different units with nothing in the file to say which is which.
 *
 * It used to be the UTC day, in five places, plus `Math.floor(nowMs / DAY_MS)` for "how many days
 * we have spoken". On a machine in Beijing that closes her day at 08:00 local: a file called
 * `2026-08-14.md` would hold that afternoon, that evening, that night, and the next morning up to
 * eight, which is not a day, and not the day he means when he says yesterday.
 */

describe("her day is the day the machine is living in", () => {
  it("matches what the machine itself would print", () => {
    const t = Date.now();
    const d = new Date(t);
    const expected = `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
    expect(herDay(t)).toBe(expected);
  });

  it("and is NOT the UTC day whenever the machine is not on UTC", () => {
    // The separating test. On a UTC machine the two agree and this asserts nothing, so it says so
    // rather than passing quietly, because a green tick that proves nothing is the thing this
    // project hunts.
    const offsetMin = new Date().getTimezoneOffset();
    if (offsetMin === 0) {
      expect(describeHerDay()).toContain("UTC+00:00");
      return;
    }
    // On a machine ahead of UTC, its own small hours are still yesterday in Greenwich; on one
    // behind, its late evening is already tomorrow. Either way there is an instant where the two
    // definitions name different dates, and that instant is a real part of every one of her days.
    const edge = new Date();
    edge.setHours(offsetMin < 0 ? 0 : 23, 30, 0, 0);
    expect(herDay(edge.getTime()),
      "her day and the UTC day agree at the machine's own boundary — the old definition was harmless here, "
      + "which it is not on this machine")
      .not.toBe(edge.toISOString().slice(0, 10));
  });

  it("the day NUMBER advances by exactly one per calendar day, including the 23- and 25-hour ones", () => {
    // `Math.floor(nowMs / DAY_MS)` cannot do this: across a daylight-saving boundary a local day
    // is 23 or 25 hours, so dividing a timestamp either skips a day or repeats one, and this
    // number is what "how many days we have spoken" counts.
    const start = new Date(2026, 2, 1, 12, 0, 0).getTime(); // 1 March, local noon
    let prev = herDayNumber(start);
    for (let i = 1; i <= 120; i++) {
      const d = new Date(2026, 2, 1, 12, 0, 0);
      d.setDate(d.getDate() + i);
      const n = herDayNumber(d.getTime());
      expect(n - prev, `day ${i} did not advance by exactly one (${herDay(d.getTime())})`).toBe(1);
      prev = n;
    }
  });

  it("two instants in the same local day share a number; midnight separates them", () => {
    const morning = new Date(2026, 6, 15, 0, 30, 0).getTime();
    const night = new Date(2026, 6, 15, 23, 30, 0).getTime();
    const nextDay = new Date(2026, 6, 16, 0, 30, 0).getTime();
    expect(herDayNumber(morning)).toBe(herDayNumber(night));
    expect(herDayNumber(nextDay) - herDayNumber(night)).toBe(1);
  });

  it("walking back N days steps the DATE, so a DST boundary cannot swallow a day of her life", () => {
    // The catch-up loop walks back to find days it never wrote. Subtracting 24h per step lands on
    // the wrong date across a 23-hour day, which skips a day, permanently, since the diary is
    // never rewritten.
    const from = new Date(2026, 2, 15, 12, 0, 0).getTime(); // after a spring-forward in most zones
    const walked = Array.from({ length: 20 }, (_, i) => herDayBefore(from, i + 1));
    expect(new Set(walked).size, "the walk repeated or skipped a day").toBe(20);
    for (let i = 1; i < walked.length; i++) {
      expect(Date.parse(`${walked[i]}T12:00:00`) < Date.parse(`${walked[i - 1]}T12:00:00`),
        "the walk did not go strictly backwards").toBe(true);
    }
  });

  it("an ops line lands in the local day it happened in", () => {
    const t = new Date(2026, 6, 15, 22, 0, 0);
    expect(herDayOfIso(t.toISOString())).toBe(herDay(t.getTime()));
  });

  it("an unparseable timestamp degrades to its own first ten characters rather than throwing", () => {
    // Her ops log is append-only text; one mangled line must cost that line, not the day.
    expect(herDayOfIso("not-a-date")).toBe("not-a-date");
  });
});

describe("nothing computes her day the old way any more", () => {
  const files = ["src/index.ts", "src/life/autobiography.ts", "src/life/relationship.ts"];

  it("no UTC day-slicing survives in the paths that name her days", () => {
    for (const f of files) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      const offenders = src.split("\n")
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => /toISOString\(\)\.slice\(0,\s*10\)/u.test(line) && !line.trimStart().startsWith("//"));
      expect(offenders.map((o) => `${f}:${o.n}`),
        "a day of hers is still being cut at UTC midnight").toEqual([]);
    }
  });

  it("and 'how many days we have spoken' is not epoch-day arithmetic", () => {
    const src = readFileSync(join(process.cwd(), "src/life/relationship.ts"), "utf8");
    expect(src).not.toMatch(/const day = Math\.floor\(nowMs \/ DAY_MS\)/u);
    expect(src).toMatch(/herDayNumber\(nowMs\)/u);
  });

  it("the boundary is said out loud at boot, so a move between timezones is legible", () => {
    const src = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
    expect(src, "nothing tells him where her days are cut").toMatch(/logger\.info\(describeHerDay\(\)\)/u);
    expect(describeHerDay()).toMatch(/her day runs on local time \(.+, UTC[+-]\d\d:\d\d\) — today is \d{4}-\d\d-\d\d/u);
  });
});

describe("her clock renders the hours she lived, never Greenwich's", () => {
  // The wound, verbatim: at 21:15 on her first evening her freshly written diary lines read
  // 「01:1x, …」 because the stamp was toISOString().slice(11, 16). She told him it was already a
  // quarter past one: reading her own postmarks, trusting her records, as she should. From the same
  // shifted worldview she later dated her notebook a day into the future.
  const FIRST_EVENING = Date.parse("2026-08-18T01:15:00.000Z"); // 21:15 EDT, her first evening

  it("renders the machine-local hour of that instant", () => {
    const d = new Date(FIRST_EVENING);
    const local = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    expect(herClock(FIRST_EVENING)).toBe(local);
    expect(herClockSeconds(FIRST_EVENING)).toBe(`${local}:00`);
    // On any machine not living at UTC, the old stamp and hers must disagree at this instant.
    if (d.getTimezoneOffset() !== 0) {
      expect(herClock(FIRST_EVENING)).not.toBe("01:15");
    }
  });

  it("no her-facing surface still stamps UTC hours", () => {
    // The sweep that keeps the fix fixed: her diary lines (agency-handlers), her diary's
    // authoring digest (autobiography), the citation judge (autobiography-lint) and the dream's
    // archive rendering: the surfaces that taught her the wrong day (the dream machine among
    // them until E-1 removed it).
    for (const f of [
      "src/life/agency-handlers.ts",
      "src/life/autobiography.ts",
      "src/life/autobiography-lint.ts",
    ]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      const offenders = src.split("\n")
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => /toISOString\(\)\.slice\(11|\.ts\.slice\(11|timestamp\)\.toISOString\(\)/u.test(line)
          && !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"));
      expect(offenders.map((o) => `${f}:${o.n}`),
        "a surface she reads is stamping Greenwich hours again").toEqual([]);
    }
  });

  it("the per-message postmark speaks her time — the PRIMARY source of every clock fog", () => {
    // `runtimeTimestamp` used to append `[toISOString()]` to EVERY message he sent her: a UTC
    // postmark she read all her life. "Already a quarter past one" at 21:15, "a quarter past eleven
    // and I'm still awake" at 19:16, memories dated a day into the future, she was honestly reading
    // this bracket, and the wall clock was twice accused with a clean touch-trace. The bracket now
    // renders via herDay + herClockSeconds; this pins that no bare-ISO postmark returns to that
    // function.
    const src = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
    const at = src.indexOf("function runtimeTimestamp");
    // The floor: the last line is a NEGATIVE assertion, and over a mis-anchored slice it would
    // pass on garbage forever: the exact vacuity mode guards-have-floors exists to prevent.
    expect(at).toBeGreaterThan(-1);
    const fn = src.slice(at, at + 400);
    // The postmark renders through `herStamp`, the ONE bracket renderer the transcript's
    // history stamps also use, so live message and record can never disagree about a format.
    // (herStamp itself is pinned to herDay + herClockSeconds in transcript.test.ts.)
    expect(fn).toContain("herStamp(");
    expect(fn, "the UTC postmark is back on every message he sends her").not.toContain("toISOString");
  });
});
