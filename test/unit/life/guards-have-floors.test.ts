import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * EVERY SOURCE-SCANNING GUARD HAS AN EXTRACTION FLOOR.
 *
 * `src/index.ts` is 0% line-covered by design; its sole verification is the family of tests that
 * read it as text and assert on regions of it. The family has a documented vacuity mode (defect
 * classes 8 and 10: three guards once reported the reverse of the truth in a single review): a
 * guard that locates a region with `indexOf` and never checks the anchor was FOUND will, when the
 * anchor is refactored away, slice from -1 and assert on garbage, passing or failing on nothing,
 * silently, forever. The floor (`expect(at).toBeGreaterThan(-1)`) is what turns a moved anchor
 * into a red build instead of a vacuous green.
 *
 * This is a lint over the guards, not over her: the cheapest first pass the metrology audit named,
 * ahead of per-guard mutation proofs.
 */

const TEST_DIR = join(process.cwd(), "test/unit");

/** True when this test-file text anchors into a source string without any floor to catch a miss. */
export function lacksAFloor(text: string): boolean {
  const anchors = text.includes(".indexOf(");
  // `>0` counts: it is a STRICTLY STRONGER floor than `>-1`, and five files carried it all
  // along: the lint just could not see it. The one hazard of accepting it (a floor scoped under
  // only the slice's first consumer, as her-own-vocabulary had) was fixed by hand in the same
  // sweep that widened this token set, so acceptance no longer hides that shape.
  const hasFloor = /toBeGreaterThan\(\s*(?:-1|0)\s*\)|toBeGreaterThanOrEqual\(\s*0\s*\)/u.test(text);
  return anchors && !hasFloor;
}

function* testFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* testFiles(full);
    else if (e.name.endsWith(".test.ts")) yield full;
  }
}

/**
 * The floorless guards found on the day the lint was built: 16 files, named so the population can
 * only SHRINK (the census pattern). Why the risk is graded rather than absolute: a POSITIVE
 * assertion over a mis-anchored slice fails loudly (an empty slice matches nothing), so most of
 * these would go red, not vacuous, when their anchor moves. The silent case is a NEGATIVE
 * assertion (`not.toMatch`) over an empty slice, which passes on nothing, and telling the two
 * apart per guard is exactly the analysis the one-line floor makes unnecessary. New guards get
 * the floor; these get it as they are next touched, and this list refuses to grow.
 */
const KNOWN_FLOORLESS = new Set<string>([
  // EMPTY, and it stays empty. The sixteen files this held were paid off in one sweep:
  // the eight genuinely vacuous sites got real floors (an anchor lost -> red, not an empty slice
  // passing a negative assertion), the no-floor files got floors on their anchoring sites, and
  // the five files whose `>0` floors the lint could not see are recognised now that the one
  // mis-scoped case is fixed. A name appearing here again is a regression, not a backlog.
]);

describe("the guards over src/index.ts can all go red", () => {
  it("no NEW guard anchors into the daemon's source without a floor", () => {
    const offenders: string[] = [];
    for (const f of testFiles(TEST_DIR)) {
      const text = readFileSync(f, "utf8");
      if (!text.includes("index.ts")) continue;
      if (!text.includes("readFileSync")) continue;
      if (lacksAFloor(text)) offenders.push(f.slice(TEST_DIR.length + 1));
    }
    const fresh = offenders.filter((f) => !KNOWN_FLOORLESS.has(f));
    expect(fresh, "these guards locate a region of the daemon with indexOf and never assert "
      + "the anchor was found — when the anchor moves, a negative assertion over the garbage "
      + "slice passes on nothing. Add `expect(at).toBeGreaterThan(-1)` after the anchor.")
      .toEqual([]);
    // THE RATCHET: an entry that gained its floor comes OFF the list, and the list never grows.
    const gone = [...KNOWN_FLOORLESS].filter((f) => !offenders.includes(f));
    expect(gone, "these files now carry floors — remove them from KNOWN_FLOORLESS so the "
      + "population cannot quietly regrow behind their exemption").toEqual([]);
  });

  it("the lint itself can go red (planted violations)", () => {
    expect(lacksAFloor('const at = SRC.indexOf("x"); expect(SRC.slice(at)).toContain("y");'),
      "an anchoring guard with no floor passed the lint").toBe(true);
    expect(lacksAFloor('const at = SRC.indexOf("x"); expect(at).toBeGreaterThan(-1);')).toBe(false);
    expect(lacksAFloor('expect(SRC).toContain("y");'),
      "a guard that never anchors needs no floor — toContain fails on absence by itself").toBe(false);
  });
});
