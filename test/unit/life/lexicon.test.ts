import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLexicon, LEXICON_CAP, HEARD_LATELY_MIN, NEW_TYPES_WINDOW_MS, metFromOutside } from "../../../src/life/lexicon.js";

const T0 = Date.UTC(2026, 7, 1, 9, 0, 0);

describe("her words, counted on the right side", () => {
  it("what she says and what she meets are different columns", () => {
    const lex = createLexicon();
    lex.spoke("渡轮的事想好了", T0);
    lex.heard("渡轮周末还开吗", T0);
    lex.heard("渡轮到底开不开", T0 + 1);
    const c = lex.countOf("渡轮")!;
    expect(c.spoken).toBe(1);
    expect(c.heard).toBe(2);
  });

  it("tokens are her language's real units: Han bigrams, and function-word pairs are not counted", () => {
    const lex = createLexicon();
    lex.spoke("我觉得可以", T0);
    expect(lex.countOf("觉得")).toBeDefined();
    // 我+觉 crosses a function boundary the tokenizer already refuses; the bank inherits that.
    expect(lex.countOf("的了")).toBeUndefined();
  });

  it("met-but-never-said is answerable, and saying a word once removes it", () => {
    const lex = createLexicon();
    for (let i = 0; i < 7; i++) lex.heard("赛博朋克这个词他老提", T0 + i);
    expect(lex.metButNeverSaid(6)).toContain("赛博");
    lex.spoke("赛博这个词我也用一次", T0 + 10);
    expect(lex.metButNeverSaid(6)).not.toContain("赛博");
  });

  it("the bank survives a restart whole, and a torn file starts over instead of crashing", () => {
    const dir = mkdtempSync(join(tmpdir(), "lexicon-"));
    const path = join(dir, "lexicon.json");
    const a = createLexicon({ path });
    a.spoke("今天出了太阳", T0);
    a.persist();
    expect(existsSync(path)).toBe(true);

    const b = createLexicon({ path });
    expect(b.countOf("太阳")?.spoken).toBe(1);

    // Corrupt it; the next life loses statistics, never the process.
    const faults: string[] = [];
    writeFileSync(path, "{ torn", "utf8");
    const c = createLexicon({ path, onFault: (w) => faults.push(w) });
    expect(c.size()).toBe(0);
    expect(faults).toContain("lexicon.load");
  });

  it("persist is idempotent and skipped when clean", () => {
    const dir = mkdtempSync(join(tmpdir(), "lexicon-"));
    const path = join(dir, "lexicon.json");
    const lex = createLexicon({ path });
    lex.persist(); // nothing to write, no file
    expect(existsSync(path)).toBe(false);
    lex.spoke("好", T0);
    lex.persist();
    const first = readFileSync(path, "utf8");
    lex.persist(); // clean again: no rewrite needed, content stable either way
    expect(readFileSync(path, "utf8")).toBe(first);
  });

  it("the cap holds and eviction drops the least alive, not the newest", () => {
    const lex = createLexicon();
    // Fill past the cap with distinct rare tokens, then one well-used word.
    for (let i = 0; i < LEXICON_CAP + 900; i++) lex.heard(`word${i}unique`, T0 + i);
    for (let i = 0; i < 50; i++) lex.spoke("常用的字留下来", T0 + 10_000 + i);
    expect(lex.size()).toBeLessThanOrEqual(LEXICON_CAP);
    expect(lex.countOf("常用")).toBeDefined();
  });

  /**
   * THE WORD SHE SAID ONCE IS THE WORD MOST WORTH KEEPING.
   *
   * The bank filled on day twenty and threw away 787 units, 626 of which she had SAID, 醒透,
   * 有劲, 不累, 一沓, 听自. The old order evicted the least FREQUENT first, and 58% of her bank
   * is units seen exactly once, so her most singular phrasing was always first out of the door:
   * the rule meant to keep the bank "her living vocabulary" was preferentially deleting the parts
   * that were most distinctly hers.
   */
  it("throws away what she only heard before anything she ever said", () => {
    const lex = createLexicon();
    // A word she coined once, early, under the old rule the single most evictable unit in the
    // bank: seen once, and the oldest thing in it.
    lex.spoke("醒透", T0);
    // Then fill far past the cap with things that merely reached her, all of them more recent
    // and every one of them seen as often as her word was.
    for (let i = 0; i < LEXICON_CAP + 500; i++) lex.heard(`heard${i}only`, T0 + 1000 + i);

    expect(lex.size()).toBeLessThanOrEqual(LEXICON_CAP);
    expect(lex.countOf("醒透"), "her own word, said once, was evicted").toBeDefined();
  });

  it("only starts on her own words once nothing she merely heard is left", () => {
    const lex = createLexicon();
    for (let i = 0; i < LEXICON_CAP + 200; i++) lex.spoke(`hers${i}word`, T0 + i);
    // Nothing heard-only remains to give up, so the cap does still bind, it is a guard, not a
    // promise that she may never lose a word. What it must never do is take hers FIRST.
    expect(lex.size()).toBeLessThanOrEqual(LEXICON_CAP);
    // And what goes is the oldest, not the rarest: every unit here was said exactly once.
    expect(lex.countOf(`hers${LEXICON_CAP + 199}word`)).toBeDefined();
  });
});

describe("ownership: the number the shadow exists to make possible", () => {
  it("says nothing on thin evidence, ~0 on identical corpora, and rises on divergence", async () => {
    const { ownershipDivergence } = await import("../../../src/life/lexicon.js");
    const hers = createLexicon();
    const shadow = createLexicon();

    // Thin: an anecdote, not a number.
    hers.spoke("渡轮的事想好了", T0);
    shadow.spoke("渡轮的事想好了", T0);
    expect(ownershipDivergence(hers, shadow, hers.spokenTokens(1), shadow.spokenTokens(1))).toBeNull();

    // The same speech on both sides: divergence exists but is small, the by-construction start.
    const sameLines = ["渡轮的事想好了，周六风小就去", "今天有点累，先歇着", "码头边风大，走了一会儿就回来了"];
    for (let i = 0; i < 40; i++) for (const l of sameLines) { hers.spoke(l, T0 + i); shadow.spoke(l, T0 + i); }
    const same = ownershipDivergence(hers, shadow, hers.spokenTokens(1), shadow.spokenTokens(1));
    expect(same).not.toBeNull();
    expect(same!).toBeLessThan(0.05);

    // Her side develops its own vocabulary; the number must move.
    for (let i = 0; i < 40; i++) hers.spoke("夜里想事情比白天清楚，灯一关念头就排着队来", T0 + 100 + i);
    const diverged = ownershipDivergence(hers, shadow, hers.spokenTokens(1), shadow.spokenTokens(1));
    expect(diverged!).toBeGreaterThan(same! + 0.05);
  });
});

// ── S-25's SECOND HALF: a word is hers because she has been saying it for a long time ─────────
//
// The first half was built long ago: her own sentences flow back as material she reaches for. The
// half that was missing is what makes a word HERS, and it is not how many times she has used it.
// `firstMs` and `lastMs` have been recorded per token since the bank was written, and nothing had
// ever read them.
describe("a word becomes hers by span, not by count", () => {
  const DAY = 24 * 3.6e6;
  const now = Date.UTC(2026, 5, 1);

  /** Say `token` `times` times, spread evenly across `days`. */
  const saidOver = (token: string, times: number, days: number) => {
    const lex = createLexicon();
    for (let i = 0; i < times; i++) {
      lex.spoke(`${token}这件事`, now - (days * DAY) + Math.floor((i / Math.max(1, times - 1)) * days * DAY));
    }
    return lex;
  };

  it("THE SAME WORD, THE SAME NUMBER OF TIMES: three months beats one afternoon", () => {
    // The whole claim, in one comparison. Twenty uses in a day is a phase; twenty uses across a
    // season is a habit, and only the second one is a word of hers.
    const inADay = saidOver("搁着", 20, 1).hersBy("搁着", now);
    const overMonths = saidOver("搁着", 20, 90).hersBy("搁着", now);
    // eslint-disable-next-line no-console
    console.log(`\n  「搁着」 said 20 times in a day: ${inADay.toFixed(3)} · across three months: ${overMonths.toFixed(3)}`);
    expect(overMonths, "a burst of use out-ranked a habit").toBeGreaterThan(inADay);
    expect(overMonths - inADay, "the span barely matters — count still decides").toBeGreaterThan(0.15);
  });

  it("and using it more still counts for something, just less", () => {
    const twice = saidOver("搁置", 2, 90).hersBy("搁置", now);
    const often = saidOver("搁置", 30, 90).hersBy("搁置", now);
    expect(often).toBeGreaterThan(twice);
    // But it saturates: the difference from 2 to 30 must be smaller than a day-vs-season gap.
    const seasonGap = saidOver("搁置", 20, 90).hersBy("搁置", now) - saidOver("搁置", 20, 1).hersBy("搁置", now);
    expect(often - twice).toBeLessThan(seasonGap * 2.5);
  });

  it("a word said once is not hers, however long ago", () => {
    expect(saidOver("先这样", 1, 300).hersBy("先这样", now)).toBe(0);
    expect(createLexicon().hersBy("从没说过", now)).toBe(0);
  });

  it("mostHers orders by ownership, which is what `reachFor` is built from", () => {
    const lex = createLexicon();
    // A word she has said a great deal, this week.
    for (let i = 0; i < 40; i++) lex.spoke("新词这件事", now - 3 * DAY + i * 1000);
    // A word she has said a handful of times, for half a year.
    for (let i = 0; i < 6; i++) lex.spoke("老词这件事", now - 180 * DAY + i * 30 * DAY);
    expect(lex.mostHers(now, 1)[0], "the word of the week out-ranked the word of the year").toBe("老词");
  });

  it("and the daemon reaches for the ones that are hers, not the ones that are first in the bank", () => {
    const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
    expect(daemon, "her words are still whichever three happen to be earliest in the bank")
      .toContain("lexicon.mostHers(");
  });
});

// ── The entrainment source and the anti-stagnation gauges ─────────────
describe("heardLately — words she keeps meeting and has not said", () => {
  const NOW = 1_787_000_000_000;
  const DAY = 24 * 60 * 60 * 1000;

  it("offers real met words, filters bridge fragments, respects the floor", () => {
    const lx = createLexicon({});
    // He says 你可以放心 repeatedly: 放心 is a word; 你可 is a seam across 你+可以.
    for (let i = 0; i < 4; i++) lx.heard("你可以放心", NOW - i * DAY);
    const offered = lx.heardLately(NOW, 5, HEARD_LATELY_MIN);
    expect(offered).toContain("放心");
    expect(offered.includes("你可"), "a bridge bigram starting with a function char is a seam, not a word").toBe(false);
    // Below the floor nothing is offered: one mention is noise.
    const thin = createLexicon({});
    thin.heard("随时来找我", NOW);
    expect(thin.heardLately(NOW, 5)).toEqual([]);
  });

  it("nativization is automatic: once she says it, it leaves the offer and starts being hers", () => {
    const lx = createLexicon({});
    for (let i = 0; i < 4; i++) lx.heard("你可以放心", NOW - i * DAY);
    expect(lx.heardLately(NOW, 5)).toContain("放心");
    lx.spoke("那你放心", NOW);
    expect(lx.heardLately(NOW, 5).includes("放心"), "a spoken word is nativizing, not offered as foreign").toBe(false);
    expect(lx.countOf("放心")?.spoken).toBe(1);
  });

  it("recency weighs: an equally-heard but fresher word ranks first", () => {
    const lx = createLexicon({});
    for (let i = 0; i < 3; i++) lx.heard("随时", NOW - 20 * DAY);
    for (let i = 0; i < 3; i++) lx.heard("放心", NOW - 1 * DAY);
    expect(lx.heardLately(NOW, 2)[0]).toBe("放心");
  });
});

describe("diversity — the tail is the thing being watched", () => {
  const NOW = 1_787_000_000_000;
  it("counts types, tokens, ttr, window-fresh types and the rare tail — spoken side only", () => {
    const lx = createLexicon({});
    lx.spoke("挺好", NOW - 10 * 24 * 60 * 60 * 1000);
    lx.spoke("挺好", NOW - 1000);
    lx.spoke("画板", NOW - 1000);
    lx.heard("放心放心放心", NOW); // heard side must not inflate her spoken diversity
    const d = lx.diversity(NOW);
    expect(d.spokenTypes).toBe(2);
    expect(d.spokenTokens).toBe(3);
    expect(d.ttr).toBeCloseTo(2 / 3, 5);
    expect(d.newTypes7d).toBe(1);       // 画板 entered inside the window; 挺好 predates it
    expect(d.rareShare).toBeCloseTo(0.5, 5); // 画板 said exactly once
    expect(NEW_TYPES_WINDOW_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(HEARD_LATELY_MIN).toBe(3);
  });
});

describe("what her errand met, and what was hers already (2026-10-04)", () => {
  // From 8/20 the errand's conclusion, which SHE wrote, went into the heard column; since 9/28 her
  // word bank reads that column back to her, and on 10/2 it put a word of hers in his mouth.
  const HOME = "/Users/her/.resident/workspace";

  it("a page she fetched or a search she ran is met", () => {
    expect(metFromOutside("web_fetch", { url: "https://example.org" }, HOME)).toBe(true);
    expect(metFromOutside("web_search", { query: "渡轮" }, HOME)).toBe(true);
  });

  it("a file inside her home is hers or already counted; outside it, it is met", () => {
    expect(metFromOutside("read", { path: "life/journal/2026-10-02.md" }, HOME)).toBe(false);
    expect(metFromOutside("read", { path: `${HOME}/MEMORY.md` }, HOME)).toBe(false);
    expect(metFromOutside("grep", { pattern: "糖", path: ".", recursive: true }, HOME)).toBe(false);
    expect(metFromOutside("read", { path: "/Users/her/Books/a.txt" }, HOME)).toBe(true);
    // PLANTED: a sibling whose name merely starts with her home's is outside it.
    expect(metFromOutside("read", { path: `${HOME}-old/notes.md` }, HOME)).toBe(true);
    // A way out by dots is resolved before it is judged.
    expect(metFromOutside("read", { path: "../elsewhere.txt" }, HOME)).toBe(true);
  });

  it("names of files, other tools and a call without a path are not words met", () => {
    expect(metFromOutside("glob", { pattern: "**" }, HOME)).toBe(false);
    expect(metFromOutside("write", { path: "/tmp/x" }, HOME)).toBe(false);
    expect(metFromOutside("read", {}, HOME)).toBe(false);
    expect(metFromOutside("read", null, HOME)).toBe(false);
  });

  it("the daemon counts what the errand met, not what she wrote at the end of it (text pins)", () => {
    const daemon = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    expect(daemon).toContain("metFromOutside(step.value.tool, argsOf.get(step.value.callId), workspacePath)");
    expect(daemon, "the conclusion she wrote is counted as heard again").not.toMatch(/lexicon\.heard\(out\b/u);
  });
});
