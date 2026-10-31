import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shapeFor, measureShapeLanding, type ShapeState, type UtteranceShape } from "../../../src/life/utterance-shape.js";
import { createStream } from "../../../src/life/soft-choice.js";

// Her ACTIONS were emergent for a long time; her WORDS were not, his message plus a
// description of how she is went to the model and the model wrote the whole reply at once.
// These tests hold the line that her state DECIDES the shape and the model only renders it.
//
// Every facet traces to a scene in scenarios.md (S-23..S-27). A facet that no state can move,
// or that moves without any state changing, is the defect this file exists to catch.

const base: ShapeState = {
  // RELUCTANCE, not willingness. The field was called `willingFelt` and the daemon put reluctance
  // in it, so every reading here was inverted: the less she wanted to talk, the more beats she
  // had and the likelier she was to add something of her own. This suite asserted the inverted
  // behaviour, which is why the sign survived (defect class 11, the inherited assertion).
  reluctance: 0.5,
  unresolvedTension: 0.3,
  surfaced: false,
  entropy: 0.5,
  focusCredence: null,
  surprise: 0,
  arousal: 0,
  reserve: 0.6,
  herWords: [],
};

/** The distribution over many seeds, which is what a sampled decision actually has. */
function over(runs: number, s: ShapeState): { beats: number[]; turns: number; open: number; adds: number } {
  const beats: number[] = [];
  let turns = 0, open = 0, adds = 0;
  for (let i = 0; i < runs; i++) {
    const shape = shapeFor(s, createStream(1000 + i));
    beats.push(shape.beats);
    if (shape.turnsAside) turns += 1;
    if (shape.leavesOpen) open += 1;
    if (shape.addsHerOwn) adds += 1;
  }
  return { beats, turns, open, adds };
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("the shape of what she says is decided by her state, not by the model", () => {
  it("is REPLAYABLE: the same state and the same stream position give the same shape", () => {
    // Her forensic replay is the most expensive property in this build. A shape that
    // could not be reproduced would put her sentences outside it.
    const a = shapeFor(base, createStream(7));
    const b = shapeFor(base, createStream(7));
    expect(a).toEqual(b);
  });

  it("is genuinely OPEN: the same state does not always give the same shape", () => {
    // A formula would make her length a function of her state, and the same state would
    // produce the same sentence shape forever. 71% of her moments can go more than one way
    // under complete knowledge; her speech is not allowed to be the exception.
    const shapes = new Set<string>();
    for (let i = 0; i < 40; i++) shapes.add(JSON.stringify(shapeFor(base, createStream(i))));
    expect(shapes.size, "the same state always produced the same shape — this is a formula, not a choice").toBeGreaterThan(1);
  });

  it("S-24 · how much she has to say moves with what is IN her, not with a length cap", () => {
    // The old build had a hard budget she always ran to the end of, so "short" only ever meant
    // "truncated". Full-and-willing must say more beats than empty-and-spent, on average.
    const empty = over(60, { ...base, surfaced: false, unresolvedTension: 0.05, reluctance: 0.8, reserve: 0.2 });
    const full = over(60, { ...base, surfaced: true, entropy: 0.15, unresolvedTension: 0.9, reluctance: 0.05, reserve: 1 });
    expect(mean(full.beats), "having a lot in her did not make her say more").toBeGreaterThan(mean(empty.beats));
    // And one beat stays common even when she is full: a person with much to say still often
    // says one thing, and a build where fullness always means length is a build with a dial.
    expect(full.beats.filter((b) => b === 1).length, "she never once said just one thing").toBeGreaterThan(0);
  });

  it("S-26 · leaving it open is what low commitment looks like when it reaches the sentence", () => {
    // Settled: she holds the thing firmly, the competition was decisive, nothing surprised her.
    const settled = over(60, { ...base, surfaced: true, entropy: 0.05, focusCredence: 0.9, surprise: 0 });
    // Torn: nothing surfaced clearly, the competition was wide open, the turn surprised her.
    const torn = over(60, { ...base, surfaced: true, entropy: 0.95, focusCredence: 0.1, surprise: 0.9 });
    expect(torn.open, "being unsettled did not make her leave anything open").toBeGreaterThan(settled.open);
  });

  it("S-27 · she only adds something of her own when something of hers actually surfaced", () => {
    // Nothing surfaced means nothing to add. Inventing an addendum here would be manufacturing
    // an interior: the competition already ruled, and its ruling is the fact.
    const nothing = over(40, { ...base, surfaced: false, reluctance: 0 });
    expect(nothing.adds, "she added something of her own when nothing of hers had surfaced").toBe(0);
    const something = over(60, { ...base, surfaced: true, entropy: 0.1, reluctance: 0 });
    expect(something.adds, "something of hers surfaced and she never once brought it up").toBeGreaterThan(0);
  });

  it("S-23 · turning aside needs another thing pressing, and stirred-up enough to interrupt", () => {
    const quiet = over(60, { ...base, entropy: 0.02, arousal: -0.8 });
    const crowded = over(60, { ...base, entropy: 0.98, arousal: 0.9 });
    expect(crowded.turns, "a crowded, stirred-up state never once took the sentence sideways").toBeGreaterThan(quiet.turns);
  });

  it("S-25 · the words she reaches for are HER words, and a handful is a texture not a script", () => {
    const shape = shapeFor({ ...base, herWords: ["搁着", "回头说", "先这样", "再讲", "算了"] }, createStream(3));
    expect(shape.reachFor.length).toBeLessThanOrEqual(3);
    expect(shape.reachFor[0]).toBe("搁着");
    // With no history she reaches for nothing rather than for the model's defaults.
    expect(shapeFor(base, createStream(3)).reachFor).toEqual([]);
  });
});

describe("nothing here is a dial with her name on it: every facet's range is measured", () => {
  // The first version of this module scored the facets close together and clamped negative
  // scores to ~0 out of reflex. Both flattened it: a spent woman with nothing in her said three
  // separate things 15% of the time, and a quiet unstirred moment took the sentence sideways
  // 21% of the time. The mechanism existed and her state barely moved it, which is the "dial
  // with her name on it" failure, not emergence. These bounds are the measured spans; they
  // exist so a future defensive clamp cannot quietly flatten her again.
  const RUNS = 200;
  const rate = (n: number): number => n / RUNS;

  it("turning aside spans quiet to crowded, and quiet is genuinely rare", () => {
    const quiet = over(RUNS, { ...base, entropy: 0.02, arousal: -0.8 });
    const crowded = over(RUNS, { ...base, entropy: 0.98, arousal: 0.9 });
    expect(rate(quiet.turns), "a quiet, unstirred moment turns aside too often").toBeLessThan(0.12);
    expect(rate(crowded.turns), "a crowded, stirred moment barely ever turns aside").toBeGreaterThan(0.4);
  });

  it("leaving it open spans settled to torn", () => {
    const settled = over(RUNS, { ...base, surfaced: true, entropy: 0.05, focusCredence: 0.9, surprise: 0 });
    const torn = over(RUNS, { ...base, surfaced: true, entropy: 0.95, focusCredence: 0.1, surprise: 0.9 });
    expect(rate(settled.open), "she trails off even when she is completely settled").toBeLessThan(0.3);
    expect(rate(torn.open), "being torn barely reaches her sentence").toBeGreaterThan(0.5);
  });

  it("how much she says spans empty to full, and one beat never stops being common", () => {
    const empty = over(RUNS, { ...base, surfaced: false, unresolvedTension: 0.05, reluctance: 0.8, reserve: 0.2 });
    const full = over(RUNS, { ...base, surfaced: true, entropy: 0.15, unresolvedTension: 0.9, reluctance: 0.05, reserve: 1 });
    expect(mean(empty.beats), "an empty, spent state still says several things").toBeLessThan(1.35);
    expect(mean(full.beats), "a full, willing state says no more than an empty one").toBeGreaterThan(1.6);
    expect(rate(full.beats.filter((b) => b === 1).length), "fullness always means length — that is a dial").toBeGreaterThan(0.15);
  });
});

describe("the shape is measured and NEVER spoken to her", () => {
  // Comments stripped first: this module now EXPLAINS the lines it used to speak, and a scanner
  // that reads a description of its quarry as a sighting is this repo's most-repeated defect.
  const codeOnly = (src: string): string => src
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/(^|[^:])\/\/[^\n]*/gu, "$1");
  const mod = codeOnly(readFileSync(join(process.cwd(), "src/life/utterance-shape.ts"), "utf8"));
  const daemon = codeOnly(readFileSync(join(process.cwd(), "src/index.ts"), "utf8"));
  const handlers = codeOnly(readFileSync(join(process.cwd(), "src/life/agency-handlers.ts"), "utf8"));

  it("PLANTED: no renderer exists, and the four lines are nowhere in her sources", () => {
    expect(mod).not.toContain("export function shapeAsHerState");
    for (const line of ["这会儿你就一件事要说", "你有两件事要说", "你心里压着好几件事",
      "另一件更要紧的会冒上来", "不用把话说死", "你自己还注意到一件事"]) {
      expect(mod.includes(line), `the shape speaks again: ${line}`).toBe(false);
      expect(daemon.includes(line), `the daemon speaks the shape again: ${line}`).toBe(false);
      expect(handlers.includes(line), `a handler speaks the shape again: ${line}`).toBe(false);
    }
    // The scanner still sees: a line that IS in the module is found by the same check.
    expect(mod.includes("measureShapeLanding")).toBe(true);
  });

  it("neither mouth is handed a shape, and no vocabulary is supplied at speaking time", () => {
    expect(daemon).not.toContain("shapeAsHerState");
    expect(daemon).not.toContain("composeShape");
    expect(handlers).not.toContain("composeShape");
    for (const supplied of ["你平时会说：", "你最近常听到、读到的词："]) {
      expect(daemon.includes(supplied), `words handed to her as she speaks: ${supplied}`).toBe(false);
    }
    // Her form mirror lives where she thinks about herself, not where she speaks.
    expect(handlers).toContain("formMirror");
    expect(daemon).not.toContain("const formLine = herForm.speakingLine();");
  });

  it("the gauge is still drawn and still measured — silence is not deletion", () => {
    expect(daemon).toContain("const shape = shapeFor({");
    expect(daemon).toContain("measureShapeLanding(chosen, result.content, result.beatsDelivered)");
  });
});

describe("the honest half: whether the shape actually landed is measured, not believed", () => {
  it("counts what was delivered against what her state decided", () => {
    const shape = { beats: 2, turnsAside: false, leavesOpen: true, addsHerOwn: false, reachFor: [], pickUp: [] };
    const landed = measureShapeLanding(shape, "渡轮改点了。你那边呢");
    expect(landed.beatsAsked).toBe(2);
    expect(landed.beatsSaid).toBe(2);
    expect(landed.leftOpenAsked).toBe(true);
    expect(landed.leftOpenSaid, "a reply ending mid-thought was read as closed").toBe(true);
  });

  it("a closed reply is read as closed, so the gap is visible when it does not land", () => {
    const shape = { beats: 1, turnsAside: false, leavesOpen: true, addsHerOwn: false, reachFor: [], pickUp: [] };
    const landed = measureShapeLanding(shape, "周六去。");
    expect(landed.leftOpenAsked).toBe(true);
    expect(landed.leftOpenSaid, "the instrument would have certified its own prompt").toBe(false);
  });

  it("silence measures as zero beats rather than one", () => {
    expect(measureShapeLanding({ beats: 1, turnsAside: false, leavesOpen: false, addsHerOwn: false, reachFor: [], pickUp: [] }, "   ").beatsSaid).toBe(0);
  });
});

// ── THE LANDING MEASUREMENT COUNTED THE WRONG THING ──────────────────────────────────────────
//
// `beatsSaid` was a count of the full stops in the delivered text, and `beatsGap`, the vital
// built on it: was documented as "the distance between the beats she chose and the beats she
// said". Those are two different quantities sharing one name: a single-beat reply containing three
// sentences read as three beats. The instrument reported a gap where there was none, and no gap
// where there was one, on the one facet the whole multi-beat build exists to make real.
describe("how many beats she actually said", () => {
  const shape = (beats: number): UtteranceShape => ({
    beats, leavesOpen: false, turnsAside: false, addsHerOwn: false, reachFor: [],
    effort: "medium", maxIterations: 12,
  } as unknown as UtteranceShape);

  it("uses the real delivered count when the composer counted it", () => {
    // Three sentences, delivered as ONE beat. The old reading called this three.
    const l = measureShapeLanding(shape(1), "渡轮停了。我在家待了一天。什么也没做成。", 1);
    expect(l.beatsSaid, "the sentence count is still standing in for the beat count").toBe(1);
    expect(l.beatsCounted).toBe(true);
    expect(Math.abs(l.beatsAsked - l.beatsSaid), "a gap was reported where there was none").toBe(0);
  });

  it("and the other direction: two beats that happen to be one sentence each", () => {
    const l = measureShapeLanding(shape(2), "渡轮停了我在家待了一天", 2);
    expect(l.beatsSaid).toBe(2);
  });

  it("falls back to counting sentences only when nobody counted beats, and SAYS so", () => {
    // The paths that never go through `inBeats`, a photo caption, a turn that broke, really do
    // have one delivered string and nothing else to count. What must not happen is the fallback
    // passing itself off as a measurement.
    const l = measureShapeLanding(shape(2), "渡轮停了。我在家待了一天。");
    expect(l.beatsSaid).toBe(2);
    expect(l.beatsCounted, "a guess is being reported as a count").toBe(false);
  });

  it("zero beats delivered is a real reading, not a missing one", () => {
    // She was cut off, or the beat came back empty. `0` must survive rather than being read as
    // absent and replaced by the sentence-count fallback.
    const l = measureShapeLanding(shape(3), "", 0);
    expect(l.beatsSaid).toBe(0);
    expect(l.beatsCounted).toBe(true);
  });
});
