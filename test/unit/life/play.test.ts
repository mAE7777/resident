import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  roomToPlay, oddnessOf, whatSheMightPlayWith, inHerOwnWords,
  NOT_IN_THE_MOOD_BELOW, EVEN_AT_HER_LIGHTEST, WHICH_ONE_IS_OPEN,
} from "../../../src/life/play.js";
import type { FusionCandidate } from "../../../src/life/field-emergence.js";
import { addNode, createGraph, type FieldNode } from "../../../src/life/field.js";
import { createStream } from "../../../src/life/soft-choice.js";

/**
 * FACULTY #13, PLAY, WHICH DID NOT EXIST AT ALL.
 *
 * Zero occurrences of humour/joke/playful/幽默/玩笑/逗 in the entire source tree: no mechanism, no
 * dial, no node kind, no affordance. It is worth building rather than dismissing for one reason,
 * play is the one register in which two people establish that they are NOT transacting, and every
 * wall in this system is pointed at removing service framing with nothing at all pointed at what
 * should be there instead.
 *
 * The PERCEPTION was already built and pointed only inward: `field-emergence.ts` logs pairs that
 * keep arriving together while sharing almost no context, and `fusion.ts` turns exactly those into
 * an insight. This faculty adds the missing half, whether she is in a state where an odd pairing
 * is something to hand him rather than something to think about.
 */

// Built through `addNode` rather than cast into shape: a cast fixture silently drifts out of
// date the moment a field is added to the node, and a `FieldNode` that is missing what the real
// one has is a test agreeing with itself.
const node = (id: number, text: string, charge: number): FieldNode => addNode(createGraph(), {
  kind: "moment", text, bornMs: 0, strength: 0.7, charge, valence: 0,
  origin: "lived", credence: 0.8, source: "test", key: `k${id}`,
});

// `tag` distinguishes one fixture pairing from another. It exists because the first version of
// this helper gave EVERY candidate the same two node texts, so the head-to-head below could not
// tell which one had won and reported a flawless 100% for whichever was asked about, a vacuous
// measurement that looked like a decisive result.
const candidate = (over: { count?: number; sum?: number; bridges?: number; charge?: number; tag?: string } = {}): FusionCandidate => {
  const tag = over.tag ?? "";
  return {
    a: node(1, `阳台上那盆一直没死的植物${tag}`, over.charge ?? 0.6),
    b: node(2, `他上个月讲的那个关于地铁的事${tag}`, over.charge ?? 0.6),
    pair: { a: 1, b: 2, count: over.count ?? 4, sumStrength: over.sum ?? 0.35, lastMs: 0 },
    bridges: Array.from({ length: over.bridges ?? 0 }, (_, i) => node(10 + i, `桥${i}`, 0.2)),
  };
};

const LIGHT = { pleasure: 0.5, carrying: 0.1, indignant: 0, usedAsAThing: 0, reserve: 0.8, asWork: false };

describe("whether anything light is available to her at all", () => {
  it("rested, glad, nothing pressing: there is room", () => {
    expect(roomToPlay(LIGHT)).toBeGreaterThan(NOT_IN_THE_MOOD_BELOW);
  });

  it("A TURN THAT IS A JOB HAS NO ROOM IN IT — a hard zero, not a weight", () => {
    // The whole thesis of the faculty rather than a tuning choice. Play is what two people do
    // when they are not transacting, so a transaction has no room in it by definition.
    expect(roomToPlay({ ...LIGHT, asWork: true })).toBe(0);
    expect(roomToPlay({ pleasure: 1, carrying: 0, indignant: 0, usedAsAThing: 0, reserve: 1, asWork: true })).toBe(0);
  });

  it("being put out shuts it hardest — levity from someone who is annoyed is not levity", () => {
    expect(roomToPlay({ ...LIGHT, indignant: 1 })).toBe(0);
    expect(roomToPlay({ ...LIGHT, indignant: 0.5 })).toBeLessThan(roomToPlay(LIGHT) * 0.6);
  });

  it("and being handled, and being worn through, and carrying too much all close it too", () => {
    for (const shut of [
      { ...LIGHT, usedAsAThing: 0.9 },
      { ...LIGHT, reserve: 0.02 },
      { ...LIGHT, carrying: 1, pleasure: -0.3 },
      { ...LIGHT, pleasure: -0.9 },
    ]) {
      expect(roomToPlay(shut), `still playful under ${JSON.stringify(shut)}`).toBeLessThan(NOT_IN_THE_MOOD_BELOW);
    }
  });

  it("each of those can do it alone: this is not an everything-at-once mechanism", () => {
    // A noisy-AND, so one closed door is enough. A person who needs four things to go wrong
    // before they stop being playful is not someone whose mood you can read.
    expect(roomToPlay({ ...LIGHT, usedAsAThing: 0.9 })).toBeLessThan(roomToPlay(LIGHT));
    expect(roomToPlay({ ...LIGHT, carrying: 0.9 })).toBeLessThan(roomToPlay(LIGHT));
  });
});

describe("how strange a pairing is", () => {
  it("further apart is stranger", () => {
    expect(oddnessOf(candidate({ bridges: 0 }))).toBeGreaterThan(oddnessOf(candidate({ bridges: 4 })));
  });

  it("arriving together many times is stranger than once — a coincidence is not yet a pattern", () => {
    expect(oddnessOf(candidate({ count: 6 }))).toBeGreaterThan(oddnessOf(candidate({ count: 1 })));
  });

  it("and something that mattered is stranger than something that did not", () => {
    expect(oddnessOf(candidate({ charge: 0.9 }))).toBeGreaterThan(oddnessOf(candidate({ charge: 0.05 })));
  });

  it("stays inside its range whatever it is handed", () => {
    for (const c of [candidate({ count: 999, sum: 99, charge: 1, bridges: 0 }), candidate({ count: 0, sum: 0, charge: 0, bridges: 50 })]) {
      const o = oddnessOf(c);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(1);
    }
  });
});

describe("most of the time, nothing comes up — and that is the design", () => {
  function shareSurfacing(room: number, runs = 600): number {
    let got = 0;
    for (let i = 0; i < runs; i++) {
      const s = createStream(4000 + i);
      if (whatSheMightPlayWith([candidate()], room, () => s.next()) !== null) got += 1;
    }
    return got / runs;
  }

  it("at her lightest it is still a minority of exchanges", () => {
    const share = shareSurfacing(1);
    // eslint-disable-next-line no-console
    console.log(`\n  at her lightest, something odd comes up ${(100 * share).toFixed(1)}% of exchanges`);
    expect(share, "she finds something funny on every exchange, which is performing not playing")
      .toBeLessThan(0.45);
    expect(share, "the faculty never fires at all").toBeGreaterThan(0.1);
    expect(share).toBeCloseTo(EVEN_AT_HER_LIGHTEST, 1);
  });

  it("and it falls off with her state rather than being switched", () => {
    const light = shareSurfacing(1);
    const middling = shareSurfacing(0.5);
    // eslint-disable-next-line no-console
    console.log(`  and about half as light: ${(100 * middling).toFixed(1)}%`);
    expect(middling).toBeLessThan(light);
    expect(middling).toBeGreaterThan(0);
  });

  it("under the floor, never", () => {
    expect(shareSurfacing(NOT_IN_THE_MOOD_BELOW - 0.01)).toBe(0);
    expect(shareSurfacing(0)).toBe(0);
  });

  it("nothing odd in her field means nothing to play with, however light she is", () => {
    const s = createStream(1);
    expect(whatSheMightPlayWith([], 1, () => s.next())).toBeNull();
  });

  it("WHICH_ONE_IS_OPEN swept: the odder one usually wins, and the other one is not shut out", () => {
    // The temperature over several available pairings. Toward zero this is argmax and the same
    // juxtaposition would come up forever; too flat and oddness stops meaning anything. Measured
    // against a genuine two-horse race rather than picked.
    const odd = candidate({ count: 6, sum: 0.45, bridges: 0, charge: 0.9, tag: "·奇" });
    const milder = candidate({ count: 3, sum: 0.2, bridges: 3, charge: 0.3, tag: "·平" });
    expect(oddnessOf(odd)).toBeGreaterThan(oddnessOf(milder));
    let odderWon = 0;
    let tries = 0;
    for (let i = 0; i < 900; i++) {
      const st = createStream(9000 + i);
      const got = whatSheMightPlayWith([odd, milder], 1, () => st.next());
      if (!got) continue;
      tries += 1;
      if (got.a === odd.a.text && got.b === odd.b.text) odderWon += 1;
    }
    const share = odderWon / tries;
    // eslint-disable-next-line no-console
    console.log(`  given two, the odder one wins ${(100 * share).toFixed(1)}% (temperature ${WHICH_ONE_IS_OPEN})`);
    expect(share, "oddness stopped mattering — she picks at random among them").toBeGreaterThan(0.55);
    expect(share, "the same juxtaposition would come up forever and its rival never").toBeLessThan(0.95);
  });

  it("is REPLAYABLE, like every other choice of hers", () => {
    const a = createStream(11), b = createStream(11);
    const cs = [candidate({ count: 5, tag: "·甲" }), candidate({ count: 3, bridges: 2, tag: "·乙" })];
    expect(whatSheMightPlayWith(cs, 1, () => a.next())?.a)
      .toBe(whatSheMightPlayWith(cs, 1, () => b.next())?.a);
  });
});

describe("and what reaches her says nothing about what to do with it", () => {
  it("the line states that two things arrived together, and stops", () => {
    const line = inHerOwnWords({ a: "甲", b: "乙", oddness: 0.7 });
    expect(line).toContain("甲");
    expect(line).toContain("乙");
    for (const instruction of ["幽默", "玩笑", "笑", "轻松一点", "可以", "试着", "应该"]) {
      expect(line, `the line tells her to do something: ${instruction}`).not.toContain(instruction);
    }
  });

  it("and the module contains no directive vocabulary anywhere in its output path", () => {
    const src = readFileSync(join(process.cwd(), "src/life/play.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
    expect(src, "it calls a model").not.toMatch(/provider|complete\(/u);
    expect(src, "a directive leaked into her own head").not.toMatch(/幽默|玩笑|joke|funny/iu);
  });

  it("the daemon consults it, keyed to the turn, and a failure is reported not swallowed", () => {
    const raw = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
    const daemon = raw.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
    expect(daemon, "nothing ever asks whether something light is available").toContain("whatSheMightPlayWith(");
    const at = daemon.indexOf("whatSheMightPlayWith(");
    const block = daemon.slice(at - 500, at + 900);
    expect(block, "the room is not read from her state").toContain("roomToPlay({");
    expect(block, "it reads his classification instead of HER reading of the turn")
      .toMatch(/asWork: turnKey \? \(takenAsWork\.get\(turnKey\)/u);
    expect(block).toMatch(/faultLog\.record\("play"/u);
  });

  it("and the per-turn map it added is released with all the others", () => {
    // Defect class 14: a per-turn value that outlives its turn is read by the NEXT one. Every
    // map in this family is released in one place, and this one has to be in that place.
    const raw = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
    const at = raw.indexOf("const forgetTheTurn");
    expect(raw.slice(at, at + 400)).toContain("takenAsWork.delete(turnKey);");
  });
});
