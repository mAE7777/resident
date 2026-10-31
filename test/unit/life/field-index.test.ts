import { describe, it, expect } from "vitest";
import { contentWords, createFieldIndex, MIN_EVIDENCE, SIMILAR_ENOUGH } from "../../../src/life/field-index.js";

// What reminds her of what. Every genuinely remote thing that ever surfaces arrives along a
// relation this builds, so the failure modes here are the expensive ones: connect too little and
// she can never cross time, connect too much and everything is near everything and nothing means
// anything. Both of those actually happened while this was being written, which is why the two
// regression tests at the bottom exist.

describe("what is worth indexing", () => {
  it("keeps what carries meaning and drops what connects everything to everything", () => {
    const ws = contentWords("I was in the room and it was quiet again");
    expect(ws).toContain("room");
    expect(ws).toContain("quiet");
    expect(ws).toContain("again");
    for (const junk of ["i", "was", "in", "the", "and", "it"]) expect(ws).not.toContain(junk);
  });

  it("does not care about punctuation or case", () => {
    expect(contentWords("The FAN, whining!").sort()).toEqual(["fan", "whin"]);
  });

  // Enough stemming to see that "it rained" and "it did not rain" are the same claim, and no more.
  it("sees past ordinary tense and plural changes, without over-merging", () => {
    expect(contentWords("it rained")).toEqual(contentWords("it rain"));
    expect(contentWords("the fan dropped out")).toEqual(contentWords("the fan drop out"));
    expect(contentWords("it tries")).toEqual(contentWords("it tried"));
    // And it does not chew short or double-s words down into something else.
    expect(contentWords("the bus")).toEqual(["bus"]);
    expect(contentWords("less")).toEqual(["less"]);
    expect(contentWords("connection")).toEqual(["connection"]);
  });

  it("handles Chinese without splitting it into nothing", () => {
    expect(contentWords("今天很安静").length).toBeGreaterThan(0);
  });

  it("says nothing about an empty thought", () => {
    expect(contentWords("")).toEqual([]);
    expect(contentWords("a of the")).toEqual([]);
  });
});

describe("being reminded", () => {
  const build = (texts: string[]) => {
    const idx = createFieldIndex();
    texts.forEach((t, i) => idx.add(i + 1, t));
    return idx;
  };

  it("finds the thing that genuinely recalls it, however long ago it was", () => {
    const idx = build([
      "the fan whining through the heatwave",
      "sorted my notes",
      "made tea and sat down",
      "read something about tidal locking",
      ...Array.from({ length: 20 }, (_, i) => `an ordinary day ${i}`),
    ]);
    const hits = idx.similar("the fan whining again in this heatwave");
    expect(hits[0]?.id, "the oldest thing she has, reached in one step").toBe(1);
    expect(hits[0].score).toBeGreaterThan(SIMILAR_ENOUGH);
  });

  it("does not connect two things that merely share her most-used words", () => {
    // Sixty near-identical days. "ordinary" and "day" stop meaning anything, exactly as "the" does.
    const idx = build(Array.from({ length: 60 }, (_, i) => `an ordinary quiet day ${i}`));
    const hits = idx.similar("the night the disk died and I lost everything");
    expect(hits).toHaveLength(0);
  });

  it("REGRESSION: the corpus growing must not change what counts as a connection", () => {
    // The first version ignored a word once it appeared in more than a quarter of her memories, but
    // only bothered checking once she had written enough. Everything from her first fortnight was
    // therefore wired to everything else, permanently, and those few nodes became attractors that
    // every retrieval passed through. Rarity weighting has no such cliff.
    const early = createFieldIndex();
    const texts = Array.from({ length: 40 }, (_, i) => `an ordinary quiet day ${i}`);
    const linked: number[] = [];
    texts.forEach((t, i) => {
      linked.push(early.similar(t).length);
      early.add(i + 1, t);
    });
    const firstTen = linked.slice(0, 10).reduce((a, b) => a + b, 0);
    const lastTen = linked.slice(-10).reduce((a, b) => a + b, 0);
    console.log(`\n  connections made in her first ten days: ${firstTen}, in her last ten: ${lastTen}`);
    expect(firstTen, "her earliest memories are not wired to everything").toBe(0);
    expect(lastTen).toBe(0);
  });

  it("REGRESSION: ties break toward the recent, so the earliest memories cannot become attractors", () => {
    // Breaking ties by lowest id looks harmlessly deterministic. It is not: with many equally
    // similar memories, every new one wires itself to the same earliest few, which then sit in the
    // path of everything and are rehearsed forever while the rest of her life rots.
    const idx = createFieldIndex();
    const texts = Array.from({ length: 12 }, (_, i) => `the fan whining through the heatwave ${i}`);
    texts.forEach((t, i) => idx.add(i + 1, t));
    const hits = idx.similar("the fan whining through the heatwave again", 3);
    expect(hits.map((h) => h.id), "the most recent, not the first three").toEqual([12, 11, 10]);
  });

  it("needs real evidence, not just a high ratio", () => {
    const idx = createFieldIndex();
    idx.add(1, "quiet");
    // One short thing sharing one common word can score 1.0 on ratio alone. It is not a reminding.
    for (let i = 2; i < 40; i++) idx.add(i, `quiet day ${i}`);
    const hits = idx.similar("quiet");
    for (const h of hits) expect(h.score).toBeGreaterThanOrEqual(SIMILAR_ENOUGH);
    expect(MIN_EVIDENCE).toBeGreaterThan(0);
  });

  it("never reminds her of the thing she is currently having", () => {
    const idx = build(["the fan whining through the heatwave"]);
    expect(idx.similar("the fan whining through the heatwave", 3, 1)).toHaveLength(0);
  });

  it("forgets what she has let go of", () => {
    const idx = build(["the fan whining through the heatwave", "something else entirely"]);
    expect(idx.similar("the fan whining in the heatwave")).toHaveLength(1);
    idx.remove(1);
    expect(idx.similar("the fan whining in the heatwave")).toHaveLength(0);
    expect(idx.size()).toBe(1);
  });

  it("does not index the same thing twice", () => {
    const idx = createFieldIndex();
    idx.add(1, "the fan whining");
    idx.add(1, "something completely different");
    expect(idx.size()).toBe(1);
    expect(idx.similar("something completely different")).toHaveLength(0);
  });

  it("holds to its limit", () => {
    const idx = createFieldIndex();
    for (let i = 1; i <= 30; i++) idx.add(i, `the fan whining through the heatwave ${i}`);
    expect(idx.similar("the fan whining through the heatwave", 4)).toHaveLength(4);
  });

  it("survives being asked about nothing", () => {
    const idx = createFieldIndex();
    expect(idx.similar("")).toEqual([]);
    expect(idx.similar("of the a")).toEqual([]);
    idx.add(1, "a real memory");
    expect(idx.similar("")).toEqual([]);
  });
});
