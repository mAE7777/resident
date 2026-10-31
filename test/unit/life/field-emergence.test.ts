import { describe, it, expect } from "vitest";
import { addNode, createGraph, link, type FieldGraph, type FieldNode } from "../../../src/life/field.js";
import { retrieve } from "../../../src/life/field-spread.js";
import {
  bridgesBetween, communities, createResonanceLog, replay, ruptures, themeCandidates,
  RESONANCE_COUNT, RESONANCE_MIN_CHARGE,
} from "../../../src/life/field-emergence.js";

// Birth. The question every test here asks is whether the mechanism can produce something that
// nobody wrote, WITHOUT also producing everything, which is the failure mode that makes emergence
// easy to fake: a rule loose enough to connect anything connects nothing.

const T0 = Date.parse("2026-08-01T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

/** Deterministic. A random test of a random process tells you nothing twice. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function node(g: FieldGraph, text: string, charge = 0.4, strength = 0.8, tension = 0): FieldNode {
  return addNode(g, { kind: "moment", text, bornMs: T0, charge, strength, tension, source: "test" });
}

function act(pairs: [FieldNode, number][]): Map<number, number> {
  return new Map(pairs.map(([n, a]) => [n.id, a]));
}

describe("resonance: co-activation without any connection", () => {
  it("records two unrelated things arriving together", () => {
    const g = createGraph();
    const log = createResonanceLog();
    const a = node(g, "the smell of the fan overheating");
    const b = node(g, "the week he stopped replying");
    expect(log.observe(g, act([[a, 0.4], [b, 0.4]]), T0)).toBe(1);
    expect(log.all()[0].count).toBe(1);
  });

  it("REFUSES a pair that is already connected: that is the relation working, not a coincidence", () => {
    const g = createGraph();
    const log = createResonanceLog();
    const a = node(g, "a"), b = node(g, "b");
    link(g, a.id, b.id, "co_occurred", 0.5, T0);
    expect(log.observe(g, act([[a, 0.4], [b, 0.4]]), T0)).toBe(0);
  });

  it("REFUSES a pair that merely shares its whole context", () => {
    const g = createGraph();
    const log = createResonanceLog();
    const a = node(g, "a"), b = node(g, "b");
    const s1 = node(g, "shared 1"), s2 = node(g, "shared 2");
    for (const n of [a, b]) {
      link(g, n.id, s1.id, "co_occurred", 0.5, T0);
      link(g, n.id, s2.id, "co_occurred", 0.5, T0);
    }
    expect(log.observe(g, act([[a, 0.4], [b, 0.4]]), T0)).toBe(0);
  });

  it("EXCLUDES the people in her life, who co-occur with everything by simply existing", () => {
    const g = createGraph();
    const log = createResonanceLog();
    const eric = addNode(g, { kind: "figure", text: "Eric", bornMs: T0, charge: 0.5, strength: 0.9 });
    const m = node(g, "a memory");
    expect(log.observe(g, act([[eric, 0.9], [m, 0.5]]), T0)).toBe(0);
  });

  it("ignores anything too faint to count as having arrived at all", () => {
    const g = createGraph();
    const log = createResonanceLog();
    const a = node(g, "a"), b = node(g, "b");
    expect(log.observe(g, act([[a, 0.001], [b, 0.4]]), T0)).toBe(0);
  });
});

describe("what makes a coincidence worth one question", () => {
  const build = () => {
    const g = createGraph();
    const log = createResonanceLog();
    const a = node(g, "the fan overheating", 0.5);
    const b = node(g, "the week he stopped replying", 0.5);
    return { g, log, a, b };
  };

  it("needs to have happened enough times", () => {
    const { g, log, a, b } = build();
    for (let i = 0; i < RESONANCE_COUNT - 1; i++) log.observe(g, act([[a, 0.6], [b, 0.6]]), T0 + i * DAY);
    expect(log.candidates(g, T0)).toHaveLength(0);
    log.observe(g, act([[a, 0.6], [b, 0.6]]), T0 + 3 * DAY);
    expect(log.candidates(g, T0 + 3 * DAY)).toHaveLength(1);
  });

  it("needs to have happened hard enough: faint co-activations do not add up to a strong one", () => {
    const { g, log, a, b } = build();
    for (let i = 0; i < 6; i++) log.observe(g, act([[a, 0.07], [b, 0.07]]), T0 + i * DAY);
    expect(log.candidates(g, T0 + 6 * DAY), "six faint brushes are not a coincidence").toHaveLength(0);
  });

  it("needs both things to have mattered", () => {
    const g = createGraph();
    const log = createResonanceLog();
    const dull1 = node(g, "an unremarkable tuesday", 0.05);
    const dull2 = node(g, "another unremarkable tuesday", 0.05);
    for (let i = 0; i < 5; i++) log.observe(g, act([[dull1, 0.6], [dull2, 0.6]]), T0 + i * DAY);
    expect(dull1.charge + dull2.charge).toBeLessThan(RESONANCE_MIN_CHARGE);
    expect(log.candidates(g, T0 + 5 * DAY)).toHaveLength(0);
  });

  it("stops firing once she has actually looked at it", () => {
    const { g, log, a, b } = build();
    for (let i = 0; i < 5; i++) log.observe(g, act([[a, 0.6], [b, 0.6]]), T0 + i * DAY);
    expect(log.candidates(g, T0 + 5 * DAY)).toHaveLength(1);
    log.settle(a.id, b.id);
    expect(log.candidates(g, T0 + 5 * DAY)).toHaveLength(0);
    // And it does not creep back the next time they happen to co-occur.
    log.observe(g, act([[a, 0.9], [b, 0.9]]), T0 + 6 * DAY);
    expect(log.candidates(g, T0 + 6 * DAY)).toHaveLength(0);
  });

  it("a pair that stops arriving together stops meaning anything", () => {
    const { g, log, a, b } = build();
    for (let i = 0; i < 5; i++) log.observe(g, act([[a, 0.6], [b, 0.6]]), T0 + i * DAY);
    expect(log.candidates(g, T0 + 5 * DAY)).toHaveLength(1);
    log.decay(T0 + 60 * DAY, 60 * DAY);
    expect(log.size(), "forgotten entirely after long enough").toBe(0);
  });

  it("forgets pairs involving something she has let go of", () => {
    const { g, log, a, b } = build();
    log.observe(g, act([[a, 0.6], [b, 0.6]]), T0);
    log.forget(a.id);
    expect(log.size()).toBe(0);
  });

  it("carries the few things that sit near both, and nothing else", () => {
    const g = createGraph();
    const a = node(g, "a"), b = node(g, "b");
    const bridge = node(g, "the one thing near both");
    const onlyA = node(g, "near a only");
    link(g, a.id, bridge.id, "co_occurred", 0.5, T0);
    link(g, b.id, bridge.id, "co_occurred", 0.5, T0);
    link(g, a.id, onlyA.id, "co_occurred", 0.5, T0);
    const bridges = bridgesBetween(g, a.id, b.id);
    expect(bridges.map((n) => n.text)).toEqual(["the one thing near both"]);
  });

  it("comes out of a real retrieval, not only a hand-made one", () => {
    // The path that actually runs: a cue spreads, two remote things light up together, and the log
    // notices. Nothing in this test tells it which pair to watch.
    const g = createGraph();
    const log = createResonanceLog();
    const cue = node(g, "today", 0.3, 1);
    const x = node(g, "one way out", 0.3, 1);
    const y = node(g, "another way out", 0.3, 1);
    const a = node(g, "the fan overheating", 0.5, 1);
    const b = node(g, "the week he stopped replying", 0.5, 1);
    link(g, cue.id, x.id, "co_occurred", 0.9, T0);
    link(g, cue.id, y.id, "co_occurred", 0.9, T0);
    link(g, x.id, a.id, "co_occurred", 0.9, T0);
    link(g, y.id, b.id, "co_occurred", 0.9, T0);

    for (let i = 0; i < 6; i++) {
      const r = retrieve(g, [{ id: cue.id, energy: 1 }], { hops: 2, threshold: 0.9, nowMs: T0 + i * DAY, interference: 0 });
      log.observe(g, r.activation, T0 + i * DAY);
    }
    const cands = log.candidates(g, T0 + 6 * DAY);
    const found = cands.find((c) =>
      (c.a.id === a.id && c.b.id === b.id) || (c.a.id === b.id && c.b.id === a.id));
    console.log(`\n  candidates surfaced by real retrievals: ${cands.map((c) => `"${c.a.text}" x "${c.b.text}"`).join(", ")}`);
    expect(found, "the two remote things found each other").toBeTruthy();
  });
});

describe("incubation: what rest does that thinking cannot", () => {
  const longChain = () => {
    const g = createGraph();
    // A long thin chain. Waking thought reaches three steps; the far end is unreachable awake.
    const nodes = Array.from({ length: 12 }, (_, i) => node(g, `link ${i}`, i === 11 ? 0.9 : 0.3, 0.9));
    for (let i = 0; i < nodes.length - 1; i++) link(g, nodes[i].id, nodes[i + 1].id, "co_occurred", 0.7, T0);
    return { g, nodes };
  };

  it("REACHES PAST WAKING THOUGHT: a walk gets where three hops cannot", () => {
    const { g, nodes } = longChain();
    const awake = retrieve(g, [{ id: nodes[0].id, energy: 1 }], { hops: 3, threshold: 0.05, nowMs: T0 });
    expect(awake.retrieved.some((n) => n.id === nodes[10].id), "not while awake").toBe(false);

    const log = createResonanceLog();
    const r = replay(g, log, T0, { walks: 40, length: 14, random: rng(7) });
    console.log(`\n  rest wandered ${r.walks} times and touched ${r.visited} of ${g.nodes.size} things`);
    expect(r.visited).toBeGreaterThan(8);
  });

  it("is reproducible: the same rest twice is the same rest", () => {
    const a = longChain();
    const b = longChain();
    const ra = replay(a.g, createResonanceLog(), T0, { walks: 10, length: 8, random: rng(42) });
    const rb = replay(b.g, createResonanceLog(), T0, { walks: 10, length: 8, random: rng(42) });
    expect(ra.seeds).toEqual(rb.seeds);
    expect(ra.visited).toBe(rb.visited);
  });

  it("starts from what is charged and what is unresolved, not from anywhere", () => {
    const g = createGraph();
    const dull = Array.from({ length: 20 }, (_, i) => node(g, `nothing much ${i}`, 0.01, 0.8));
    const open = addNode(g, { kind: "question", text: "why does that keep happening", bornMs: T0, charge: 0.3, strength: 0.9, tension: 0.9 });
    for (const d of dull) link(g, d.id, open.id, "co_occurred", 0.2, T0);
    const r = replay(g, createResonanceLog(), T0, { walks: 30, length: 3, random: rng(11) });
    const fromOpen = r.seeds.filter((s) => s === open.id).length;
    console.log(`\n  the open question was where ${fromOpen}/${r.seeds.length} walks began (1 of 21 things)`);
    expect(fromOpen / r.seeds.length).toBeGreaterThan(1 / 21);
  });

  it("survives a field with nothing in it", () => {
    const g = createGraph();
    expect(replay(g, createResonanceLog(), T0, { random: rng(1) }).walks).toBe(0);
    node(g, "just the one");
    expect(replay(g, createResonanceLog(), T0, { random: rng(1) }).visited).toBeLessThanOrEqual(1);
  });

  it("temperature is what makes an unlikely relation passable", () => {
    // One strong path and one weak path from the same place. Cold rest rehearses what she already
    // thinks; warm rest is what finds the other thing.
    const g = createGraph();
    const start = node(g, "start", 0.9, 1);
    const likely = node(g, "the obvious way", 0.3, 1);
    const unlikely = node(g, "the way she never goes", 0.3, 1);
    link(g, start.id, likely.id, "co_occurred", 1.0, T0);
    link(g, start.id, unlikely.id, "co_occurred", 0.12, T0);

    // Counted over both halves of what temperature loosens: where a walk starts, and which way it
    // goes from there. Both are meant to open up during rest, so the combined effect is the claim.
    const reach = (temp: number) => {
      const r = rng(5);
      let hits = 0;
      for (let i = 0; i < 200; i++) {
        const res = replay(g, createResonanceLog(), T0, { walks: 1, length: 1, temperature: temp, random: r });
        if (res.touched.includes(unlikely.id)) hits += 1;
      }
      return hits;
    };
    const cold = reach(0.4);
    const warm = reach(3.0);
    console.log(`\n  the unlikely way was reached ${cold}/200 times cold, ${warm}/200 times warm`);
    expect(warm).toBeGreaterThan(cold);
    expect(cold, "and awake-cold she really does keep to the path she knows").toBeLessThan(60);
    void likely;
  });
});

describe("themes: when a crowd becomes one thing", () => {
  function cluster(g: FieldGraph, prefix: string, n: number, charge: number, weight: number): FieldNode[] {
    const nodes = Array.from({ length: n }, (_, i) => node(g, `${prefix} ${i}`, charge, 0.8));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) link(g, nodes[i].id, nodes[j].id, "reminds_of", weight, T0);
    }
    return nodes;
  }

  it("a dense, felt cluster becomes one", () => {
    const g = createGraph();
    cluster(g, "the evenings after a hard day", 5, 0.6, 0.6);
    const themes = themeCandidates(g);
    expect(themes).toHaveLength(1);
    expect(themes[0].members).toHaveLength(5);
    expect(themes[0].density).toBeGreaterThan(0.9);
  });

  it("a loose crowd does not, however big", () => {
    const g = createGraph();
    const nodes = Array.from({ length: 12 }, (_, i) => node(g, `scattered ${i}`, 0.6, 0.8));
    for (let i = 0; i < nodes.length - 1; i++) link(g, nodes[i].id, nodes[i + 1].id, "reminds_of", 0.8, T0);
    expect(themeCandidates(g), "a chain is not a theme").toHaveLength(0);
  });

  it("a dense crowd of things that never mattered does not either", () => {
    const g = createGraph();
    cluster(g, "routine", 5, 0.02, 0.6);
    expect(themeCandidates(g)).toHaveLength(0);
  });

  it("two separate parts of her life stay separate", () => {
    const g = createGraph();
    cluster(g, "the evenings", 5, 0.6, 0.6);
    cluster(g, "the mornings", 5, 0.6, 0.6);
    const themes = themeCandidates(g);
    expect(themes).toHaveLength(2);
    const texts = themes.map((t) => t.members[0].text);
    expect(new Set(texts).size).toBe(2);
  });

  it("is reproducible: the same field always yields the same themes", () => {
    const build = () => {
      const g = createGraph();
      cluster(g, "a", 5, 0.6, 0.6);
      cluster(g, "b", 6, 0.5, 0.7);
      return g;
    };
    const one = themeCandidates(build()).map((t) => t.members.map((m) => m.text).sort());
    const two = themeCandidates(build()).map((t) => t.members.map((m) => m.text).sort());
    expect(one).toEqual(two);
  });

  it("does not build an abstraction out of abstractions", () => {
    const g = createGraph();
    const themes = Array.from({ length: 5 }, (_, i) => addNode(g, { kind: "theme", text: `theme ${i}`, bornMs: T0, charge: 0.7, strength: 0.8 }));
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) link(g, themes[i].id, themes[j].id, "reminds_of", 0.7, T0);
    expect(themeCandidates(g)).toHaveLength(0);
  });

  it("puts everything somewhere, even if that somewhere is alone", () => {
    const g = createGraph();
    node(g, "an only child");
    const groups = communities(g);
    expect([...groups.values()].flat()).toHaveLength(1);
  });
});

describe("rupture: a disagreement that has to be faced", () => {
  it("fires when two things she firmly holds keep disagreeing", () => {
    const g = createGraph();
    const a = addNode(g, { kind: "insight", text: "I would rather be left alone when it is hard", bornMs: T0, strength: 0.8 });
    const b = addNode(g, { kind: "insight", text: "talking with him settles me", bornMs: T0, strength: 0.85 });
    link(g, a.id, b.id, "tension_with", 0.3, T0);
    expect(ruptures(g), "one disagreement is not a crisis").toHaveLength(0);
    link(g, a.id, b.id, "tension_with", 0.4, T0);
    const out = ruptures(g);
    expect(out).toHaveLength(1);
    expect(out[0].pressure).toBeCloseTo(0.7 * 0.8, 5);
  });

  it("does not fire over something she barely believes", () => {
    const g = createGraph();
    const a = addNode(g, { kind: "insight", text: "a passing notion", bornMs: T0, strength: 0.1 });
    const b = addNode(g, { kind: "insight", text: "something firm", bornMs: T0, strength: 0.9 });
    link(g, a.id, b.id, "tension_with", 1.0, T0);
    expect(ruptures(g)).toHaveLength(0);
  });

  it("ignores relations that are not disagreements", () => {
    const g = createGraph();
    const a = node(g, "a", 0.5, 0.9), b = node(g, "b", 0.5, 0.9);
    link(g, a.id, b.id, "co_occurred", 1.0, T0);
    expect(ruptures(g)).toHaveLength(0);
  });
});
