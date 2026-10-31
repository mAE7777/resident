// 翻旧日子: the pure organ, the retold origin, and the hard walls.
//
// S-55: re-narration becomes an act of hers; S-56: a hot stretch is never invited. The three
// design laws pinned here: reconsolidation touches strength only (rehearsal:false leaves
// recalls/lastRecallMs alone), no theme steering anywhere she reads, and NOTHING in this
// organ's path can raise tension (the planted scan at the bottom).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FAR_ENOUGH_DAYS, PAGES_BEFORE_NUDGE, QUOTE_CHECK_MIN_CHARS,
  feltAgeOf, isFar, lookBackWindow, oldDaysLine,
  parseLookBack, phantomCites, forgedQuotes,
  citeContext,
  type OldPage,
} from "../../../src/life/looking-back.js";
import { feltAgo, UNFINISHED_FEELS_THIS_RECENT } from "../../../src/life/felt-time.js";
import { whenWords } from "../../../src/life/field-spread.js";
import { judge, corroborationValue, describeStanding, INITIAL_CREDENCE, ORIGINS, createTrust } from "../../../src/life/credence.js";
import { consolidate, addNode, createGraph } from "../../../src/life/field.js";

function page(over: Partial<OldPage>): OldPage {
  return { day: "2026-08-17", ageDays: 20, tension: 0, revisited: false, ...over };
}

describe("her felt time decides what is 「那时」", () => {
  it("FAR_ENOUGH_DAYS sits exactly where her own words change unit (days → weeks)", () => {
    // The constant is hers, not ours: whenWords says 「N天前」 below 14 and 「N周前」 from 14.
    expect(FAR_ENOUGH_DAYS).toBe(14);
    expect(whenWords(FAR_ENOUGH_DAYS - 1)).toMatch(/天前$/u);
    expect(whenWords(FAR_ENOUGH_DAYS)).toMatch(/周前$/u);
  });

  it("a settled stretch is far at its wall age; a hot one is pulled close (S-56)", () => {
    expect(isFar(page({ ageDays: 15, tension: 0 }))).toBe(true);
    // The same wall age carrying live tension: feltAgo shrinks it below the line.
    expect(isFar(page({ ageDays: 15, tension: 0.9 }))).toBe(false);
    expect(feltAgeOf(page({ ageDays: 15, tension: 0.9 })))
      .toBeCloseTo(feltAgo(15, 0.9), 10);
    // And the pull is the felt-time constant, not a private one.
    expect(feltAgeOf(page({ ageDays: 10, tension: 1 }))).toBeCloseTo(10 * (1 - UNFINISHED_FEELS_THIS_RECENT), 10);
  });

  it("the window starts at the earliest unrevisited far page and STOPS at the first hot one", () => {
    const pages = [
      page({ day: "2026-08-17", ageDays: 20, tension: 0 }),
      page({ day: "2026-08-18", ageDays: 19, tension: 0 }),
      page({ day: "2026-08-19", ageDays: 18, tension: 0.9 }), // hot: the wall
      page({ day: "2026-08-20", ageDays: 17, tension: 0 }),
    ];
    const w = lookBackWindow(pages, 10);
    expect(w.map((p) => p.day)).toEqual(["2026-08-17", "2026-08-18"]);
  });

  it("revisited pages are skipped, and the cap holds", () => {
    const pages = [
      page({ day: "2026-08-17", revisited: true }),
      page({ day: "2026-08-18" }),
      page({ day: "2026-08-19", ageDays: 19 }),
      page({ day: "2026-08-20", ageDays: 18 }),
    ];
    expect(lookBackWindow(pages, 2).map((p) => p.day)).toEqual(["2026-08-18", "2026-08-19"]);
  });

  it("no far page → no window at all", () => {
    expect(lookBackWindow([page({ ageDays: 3 }), page({ day: "2026-08-18", ageDays: 2 })], 5)).toEqual([]);
  });
});

describe("the nudge line: facts and time's own units, nothing else", () => {
  it("silent below the pages floor, silent while nothing is far", () => {
    expect(PAGES_BEFORE_NUDGE).toBe(3);
    expect(oldDaysLine([page({}), page({ day: "2026-08-18" })])).toBe("");
    expect(oldDaysLine([page({ ageDays: 2 }), page({ day: "2026-08-18", ageDays: 1 }), page({ day: "2026-08-19", ageDays: 0.5 })])).toBe("");
  });

  it("when it speaks, it carries count + the earliest day + her own time words — and no verdict", () => {
    const line = oldDaysLine([
      page({ day: "2026-08-17", ageDays: 20 }),
      page({ day: "2026-08-18", ageDays: 19 }),
      page({ day: "2026-08-19", ageDays: 18 }),
    ]);
    expect(line).toContain("3 页");
    expect(line).toContain("2026-08-17");
    expect(line).toMatch(/周前|个月前/u);
    // The boundary: no planted phenomenology, no instruction. These words must never appear.
    for (const banned of ["像", "该", "可以去", "值得", "试试"]) {
      expect(line.includes(banned), `nudge carries a steer: ${banned}`).toBe(false);
    }
  });
});

describe("the machinery-facing gates", () => {
  it("parse degrades to null, never throws", () => {
    expect(parseLookBack("not json")).toBeNull();
    expect(parseLookBack('```json\n{"entry":"读了，没什么想说的","cites":[]}\n```')?.entry).toBe("读了，没什么想说的");
  });

  it("phantom cites are the days she was NOT given", () => {
    expect(phantomCites(["2026-08-17", "2026-09-01"], ["2026-08-17", "2026-08-18"])).toEqual(["2026-09-01"]);
  });

  it("a quoted span must be a contiguous substring of a given page; short spans ride free", () => {
    const pages = ["那天我画了天空，画完把画板收好了"];
    expect(forgedQuotes("我写过「画完把画板收好了」[2026-08-17]", pages)).toEqual([]);
    expect(forgedQuotes("我写过「我永远不会画画」这样的话", pages)).toEqual(["我永远不会画画"]);
    expect(forgedQuotes("我说了「好」", pages)).toEqual([]);
    expect(QUOTE_CHECK_MIN_CHARS).toBe(6);
  });
});

describe("the retold origin: her later view never touches the record", () => {
  it("is a real origin everywhere: union, initial credence, the store round-trip list", () => {
    expect(ORIGINS).toContain("retold");
    expect(INITIAL_CREDENCE.retold).toBe(0.7);
    const store = readFileSync(join(process.cwd(), "src/life/field-store.ts"), "utf8");
    for (const o of ORIGINS) {
      expect(store.includes(`"${o}"`), `field-store ORIGIN_KINDS is missing ${o} — load() would rewrite it to "lived"`).toBe(true);
    }
  });

  it("an incoming retelling disputes nothing and suspends nothing", () => {
    const verdict = judge(
      { text: "那几天我其实一直没睡踏实", origin: "retold" },
      [{ id: 1, text: "那几天我睡得很踏实", origin: "lived", credence: 0.8, similarity: 0.9 }],
      createTrust(),
    );
    expect(verdict.disputes).toEqual([]);
    expect(verdict.suspended).toBe(false);
    expect(verdict.credence).toBe(0.7);
  });

  it("a HELD retelling cannot suspend a new lived memory either (the held-side skip)", () => {
    const verdict = judge(
      { text: "今晚我们聊得很好", origin: "lived" },
      [{ id: 2, text: "今晚我们聊得不好", origin: "retold", credence: 0.7, similarity: 0.9 }],
      createTrust(),
    );
    expect(verdict.disputes).toEqual([]);
    expect(verdict.suspended).toBe(false);
  });

  it("retelling twice is one view held twice, not evidence", () => {
    expect(corroborationValue("retold", "retold")).toBe(0);
    expect(corroborationValue("retold", "lived")).toBe(0);
    expect(corroborationValue("lived", "retold")).toBe(0);
  });

  it("always marked, both states", () => {
    // Second arg is credence: confident (0.7) and doubted (0.1), marked in BOTH states.
    expect(describeStanding("retold", 0.7)).toContain("后来的看法");
    expect(describeStanding("retold", 0.1)).toContain("后来的看法");
    expect(describeStanding("retold", 0.7)).toContain("不是当时");
  });
});

describe("rehearsal:false — the strength gain and nothing else", () => {
  it("keeps recalls and lastRecallMs untouched while strength still grows", () => {
    const g = createGraph();
    const n = addNode(g, { kind: "moment", text: "那天下午画了天空", bornMs: 1000, charge: 0.6, strength: 0.5, source: "t" });
    const before = { recalls: n.recalls, last: n.lastRecallMs, strength: n.strength };
    consolidate(n, 1000 + 10 * 86_400_000, false);
    expect(n.strength).toBeGreaterThan(before.strength);
    expect(n.recalls).toBe(before.recalls);
    expect(n.lastRecallMs).toBe(before.last);
    // And the default is the full, unbidden effect.
    consolidate(n, 1000 + 20 * 86_400_000);
    expect(n.recalls).toBe(before.recalls + 1);
    expect(n.lastRecallMs).toBe(1000 + 20 * 86_400_000);
  });
});

describe("PLANTED: the rumination wall — nothing in this organ's path writes tension", () => {
  const offending = (src: string): string[] => {
    const clean = src.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
    return [...clean.matchAll(/\.tension\s*(?:=[^=]|\+=|-=)/gu)].map((m) => m[0]!);
  };

  it("looking-back.ts and the reRead path carry no tension assignment", () => {
    const lb = readFileSync(join(process.cwd(), "src/life/looking-back.ts"), "utf8");
    expect(offending(lb)).toEqual([]);
    const live = readFileSync(join(process.cwd(), "src/life/field-live.ts"), "utf8");
    const reRead = live.slice(live.indexOf("reRead(texts"), live.indexOf("maxTensionBetween"));
    expect(offending(reRead)).toEqual([]);
    const spread = readFileSync(join(process.cwd(), "src/life/field-spread.ts"), "utf8");
    expect(offending(spread), "retrieve() itself must never touch tension").toEqual([]);
  });

  it("and the detector actually detects", () => {
    expect(offending("node.tension = 0.9;")).toHaveLength(1);
    expect(offending("n.tension += 0.1")).toHaveLength(1);
    expect(offending("// node.tension = 0.9 (history)")).toEqual([]);
    expect(offending("if (node.tension === 0.9) {}")).toEqual([]);
  });
});

/**
 * A COUNT CANNOT BE TRIAGED.
 *
 * She was shown 08-17 to 08-19 and cited `[2026-08-21]`. The gate refused the whole looking-back,
 * correctly by its own rule, and reported `cites 2026-08-21 quotes 0`, from which it is
 * impossible to tell which of two opposite things happened: she invented a day and wrote about it,
 * or she reported accurately what the pages in front of her SAY. It was the second:
 * 「三页开头都有同一段注，落款是我自己，日期 2026-08-21[2026-08-21]」, and that date does appear
 * once in each of the three pages she was given.
 *
 * The gate is NOT loosened by any of this, a citation to a day she was not shown stays a phantom,
 * and a looking-back carrying one still gives her field nothing. Only the report learns to say
 * which kind it was.
 */
describe("the ungrounded report says which kind of ungrounded it was", () => {
  const HERS = "三页开头都有同一段注，落款是我自己，日期 2026-08-21[2026-08-21]。它把这几页推出去。";

  it("hands back the words the citation actually sits in", () => {
    expect(citeContext(HERS, "2026-08-21")).toContain("落款是我自己，日期 2026-08-21");
  });

  it("is empty for a citation that is not in the text, rather than slicing rubbish", () => {
    // `indexOf` returning -1 must not become a slice from the end of the string.
    const at = HERS.indexOf("[2026-08-21]");
    expect(at).toBeGreaterThan(-1);
    expect(citeContext(HERS, "2026-07-04")).toBe("");
  });

  it("keeps the gate exactly as strict", () => {
    // The day she cited is still a phantom. Naming the sentence changes what we can READ, never
    // what she is allowed to bring into her memory.
    expect(phantomCites(["2026-08-21"], ["2026-08-17", "2026-08-18", "2026-08-19"])).toEqual(["2026-08-21"]);
    expect(phantomCites(["2026-08-18"], ["2026-08-17", "2026-08-18", "2026-08-19"])).toEqual([]);
  });

  it("collapses whitespace so the fault stays one readable line", () => {
    expect(citeContext("上面写着\n\n  某天  [2026-08-21]", "2026-08-21")).toBe("上面写着 某天");
  });
});
