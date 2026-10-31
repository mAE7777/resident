import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { digestAgency, AGENCY_ROWS_PER_DAY, type AgencyDayRow } from "../../../src/life/autobiography.js";

/**
 * THE CHOICE MIRROR. Her frozen page could never say 「有句话到嘴边搁下了」 because the
 * digest read only ops.jsonl, her moments and their forks were invisible to her own
 * autobiography. digestAgency turns her day's agency records into citable a-rows, in her
 * words, id-stable, fork-capped. The page stays hers to write.
 */

function row(over: Partial<AgencyDayRow> = {}): AgencyDayRow {
  return { ts: 1000, chose: "reflect", ...over };
}

describe("digestAgency", () => {
  it("renders her moments in her words, with the fork visible", () => {
    const rows = digestAgency([
      row({ ts: 1, chose: "reach_out", delivered: "diary", heldBecause: "gate" }),
      row({ ts: 2, chose: "reach_out", delivered: "push" }),
      row({ ts: 3, chose: "tend", torn: true }),
      row({ ts: 4, chose: "rest", leanedToward: { kind: "reach_out" } }),
    ]);
    expect(rows[0]!.summary).toBe("想跟他说话，话到嘴边先搁下了");
    expect(rows[1]!.summary).toBe("想跟他说话，说了，送出去了");
    expect(rows[2]!.summary).toContain("（两头拉扯了一会）");
    expect(rows[3]!.summary).toContain("（本来想");
  });

  it("ids are minted from the RAW day order and survive the cap — the e-id law", () => {
    const many: AgencyDayRow[] = [];
    for (let i = 0; i < 20; i++) {
      // Every third row is a fork (held send); the rest are plain rests.
      many.push(i % 3 === 0
        ? row({ ts: i, chose: "reach_out", delivered: "diary", heldBecause: "gate" })
        : row({ ts: i, chose: "rest" }));
    }
    const kept = digestAgency(many);
    expect(kept.length).toBe(AGENCY_ROWS_PER_DAY);
    // The held sends (raw indices 0,3,6,...) must all survive under their original names.
    for (const i of [0, 3, 6, 9, 12, 15, 18]) {
      expect(kept.some((k) => k.id === `a${i}`), `a${i} (a fork) was dropped for a plain rest`).toBe(true);
    }
    // And the output is chronological regardless of fork-first selection.
    const ts = kept.map((k) => Date.parse(k.ts));
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });

  it("NOTHING can be invented: every row derives from a record handed in", () => {
    expect(digestAgency([])).toEqual([]);
    const one = digestAgency([row({ chose: "explore" })]);
    expect(one).toHaveLength(1);
    expect(one[0]!.summary).toBe("顺着一个念头去看了看");
  });
});

describe("the wiring, floored", () => {
  const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");

  it("the day-close reads her agency day and hands the a-rows to the digest", () => {
    const at = daemon.indexOf("const agencyRows = (() => {");
    expect(at).toBeGreaterThan(-1);
    const body = daemon.slice(at, at + 1600);
    expect(body).toContain("herDay(r.ts) === yesterday");
    expect(body, "the rows must reach reconsolidateDay or the mirror is glass with no silvering")
      .toContain("extraRows: digestAgency(agencyRows)");
  });

  it("the merge happens BEFORE the stride cap, chronologically", () => {
    const auto = readFileSync(join(process.cwd(), "src/life/autobiography.ts"), "utf8");
    const at = auto.indexOf("const ops = digestEvents(events)");
    expect(at).toBeGreaterThan(-1);
    const body = auto.slice(at, at + 600);
    expect(body).toContain("[...ops, ...opts.extraRows]");
    expect(body.indexOf("sort"), "merge-sort must precede the cap").toBeLessThan(body.indexOf("const cap"));
  });
});
