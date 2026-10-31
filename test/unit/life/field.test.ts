import { describe, it, expect } from "vitest";
import {
  addNode, consolidate, createGraph, decayAll, decayRateFor, edgesOf, link, neighbours,
  overlap, prune, pruningCandidates, removeNode, stats, unlinkAll,
  BASE_DECAY_RATE, MAX_EDGES_PER_NODE, PRUNE_MIN_AGE_MS, PRUNE_STRENGTH,
  type FieldGraph,
} from "../../../src/life/field.js";

// The substrate. Everything else in the layer rests on these properties, so they are tested for
// what they GUARANTEE rather than for what they currently compute: that her history cannot fork,
// that nothing grows without bound, that no node can become a hub, and above all that fading is
// not the same as being deleted.

const T0 = Date.parse("2026-08-01T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function moment(g: FieldGraph, text: string, over: Partial<{ charge: number; valence: number; strength: number; bornMs: number; key: string; tension: number }> = {}) {
  return addNode(g, {
    kind: "moment", text, bornMs: over.bornMs ?? T0,
    charge: over.charge ?? 0.2, valence: over.valence ?? 0,
    strength: over.strength, key: over.key, tension: over.tension, source: "test",
  });
}

describe("encoding", () => {
  it("gives every node a real record to point at", () => {
    const g = createGraph();
    const n = addNode(g, { kind: "moment", text: "sat with it", bornMs: T0, source: "ops:123" });
    expect(n.source).toBe("ops:123");
    expect(g.nodes.size).toBe(1);
  });

  it("cannot fork her history: the same key encoded twice is one node, slightly rehearsed", () => {
    const g = createGraph();
    const a = moment(g, "the same evening", { key: "m1", strength: 0.5 });
    const b = moment(g, "the same evening", { key: "m1" });
    expect(b.id).toBe(a.id);
    expect(g.nodes.size).toBe(1);
    expect(b.strength).toBeGreaterThan(0.5); // living it again is rehearsal
  });

  it("clamps a malformed reading instead of letting it propagate", () => {
    const g = createGraph();
    const n = addNode(g, { kind: "moment", text: "x", bornMs: T0, charge: Number.NaN, valence: 99, strength: -5 });
    expect(n.charge).toBe(0);
    expect(n.valence).toBe(1);
    expect(n.strength).toBe(0);
  });

  it("caps her words so a runaway generation cannot become an unbounded node", () => {
    const g = createGraph();
    const n = addNode(g, { kind: "moment", text: "x".repeat(5000), bornMs: T0 });
    expect(n.text.length).toBeLessThanOrEqual(400);
  });
});

describe("relations", () => {
  it("strengthens with repetition and stops at one", () => {
    const g = createGraph();
    const a = moment(g, "a"), b = moment(g, "b");
    link(g, a.id, b.id, "co_occurred", 0.4, T0);
    link(g, a.id, b.id, "co_occurred", 0.4, T0);
    link(g, a.id, b.id, "co_occurred", 0.9, T0);
    expect(g.edges.get(`${a.id}:${b.id}:co_occurred`)?.weight).toBe(1);
  });

  it("is symmetric: remembering works in both directions", () => {
    const g = createGraph();
    const a = moment(g, "a"), b = moment(g, "b");
    link(g, a.id, b.id, "co_occurred", 0.5, T0);
    expect(neighbours(g, a.id).get(b.id)).toBeCloseTo(0.5, 5);
    expect(neighbours(g, b.id).get(a.id)).toBeCloseTo(0.5, 5);
  });

  it("combines different kinds of relation, weighted by how well each carries", () => {
    const g = createGraph();
    const a = moment(g, "a"), b = moment(g, "b");
    link(g, a.id, b.id, "co_occurred", 0.3, T0); // conductance 1.0
    link(g, a.id, b.id, "tension_with", 0.4, T0); // conductance 0.7
    expect(neighbours(g, a.id).get(b.id)).toBeCloseTo(0.3 * 1.0 + 0.4 * 0.7, 5);
  });

  it("refuses to relate a node to itself or to something that is not there", () => {
    const g = createGraph();
    const a = moment(g, "a");
    expect(link(g, a.id, a.id, "co_occurred", 0.5, T0)).toBeNull();
    expect(link(g, a.id, 9999, "co_occurred", 0.5, T0)).toBeNull();
  });

  it("THE HUB GUARD: no node can relate to everything", () => {
    // Without this, "Eric" or "myself" accretes an edge to every memory she has, activation reaches
    // the whole graph from anywhere, and retrieval stops meaning anything.
    const g = createGraph();
    const hub = moment(g, "Eric");
    for (let i = 0; i < MAX_EDGES_PER_NODE + 25; i++) {
      const other = moment(g, `moment ${i}`);
      link(g, hub.id, other.id, "about", 0.1 + i * 0.01, T0);
    }
    expect(neighbours(g, hub.id).size).toBe(MAX_EDGES_PER_NODE);
    // And it kept the strongest, not an arbitrary window.
    const kept = [...neighbours(g, hub.id).values()];
    expect(Math.min(...kept)).toBeGreaterThan(0.1);
  });

  it("dropping a relation leaves no dangling half", () => {
    const g = createGraph();
    const a = moment(g, "a"), b = moment(g, "b");
    link(g, a.id, b.id, "co_occurred", 0.5, T0);
    unlinkAll(g, a.id);
    expect(neighbours(g, a.id).size).toBe(0);
    expect(neighbours(g, b.id).size).toBe(0);
    expect(edgesOf(g, b.id)).toHaveLength(0);
  });

  it("removing a node removes it from her keys as well, so it cannot be resurrected by key", () => {
    const g = createGraph();
    const a = moment(g, "a", { key: "m1" });
    removeNode(g, a.id);
    expect(g.byKey.has("m1")).toBe(false);
    const again = moment(g, "a", { key: "m1" });
    expect(again.id).not.toBe(a.id);
  });
});

describe("structural similarity (what makes routine days blur)", () => {
  it("two ordinary evenings that share their context overlap; a singular day does not", () => {
    const g = createGraph();
    const eric = moment(g, "Eric");
    const home = moment(g, "the usual evening shape");
    const ordinaryA = moment(g, "an ordinary evening");
    const ordinaryB = moment(g, "another ordinary evening");
    const singular = moment(g, "the night the disk died");
    for (const n of [ordinaryA, ordinaryB]) {
      link(g, n.id, eric.id, "about", 0.5, T0);
      link(g, n.id, home.id, "co_occurred", 0.5, T0);
    }
    const alone = moment(g, "nothing else like it");
    link(g, singular.id, alone.id, "co_occurred", 0.5, T0);

    expect(overlap(g, ordinaryA.id, ordinaryB.id)).toBeGreaterThan(0.5);
    expect(overlap(g, ordinaryA.id, singular.id)).toBe(0);
  });

  it("is zero for anything unconnected", () => {
    const g = createGraph();
    const a = moment(g, "a"), b = moment(g, "b");
    expect(overlap(g, a.id, b.id)).toBe(0);
  });
});

describe("forgetting", () => {
  it("charge slows it, and every rehearsal slows it further", () => {
    const plain = { charge: 0, recalls: 0 } as never;
    const charged = { charge: 0.8, recalls: 0 } as never;
    const rehearsed = { charge: 0, recalls: 4 } as never;
    expect(decayRateFor(plain)).toBeCloseTo(BASE_DECAY_RATE, 5);
    expect(decayRateFor(charged)).toBeLessThan(decayRateFor(plain));
    expect(decayRateFor(rehearsed)).toBeLessThan(decayRateFor(plain));
  });

  it("an ordinary moment fades out of easy reach in a few weeks", () => {
    const g = createGraph();
    const n = moment(g, "an ordinary tuesday", { charge: 0.05, strength: 0.5 });
    decayAll(g, T0 + 28 * DAY, T0);
    expect(n.strength).toBeLessThan(0.12); // below a normal retrieval threshold
    expect(n.strength).toBeGreaterThan(0); // but still there
  });

  it("a charged one survives the same stretch", () => {
    const g = createGraph();
    const ordinary = moment(g, "an ordinary tuesday", { charge: 0.05, strength: 0.5 });
    const charged = moment(g, "the night it all went wrong", { charge: 0.85, strength: 0.5 });
    decayAll(g, T0 + 28 * DAY, T0);
    expect(charged.strength).toBeGreaterThan(ordinary.strength * 2);
  });

  it("FADED IS NOT GONE: decay never deletes, however long it runs", () => {
    // This is the property the old memory layer did not have. A retired belief could never come
    // back; here nothing is unreachable in principle, only unreachable by a weak cue.
    const g = createGraph();
    const n = moment(g, "something from a long time ago", { charge: 0, strength: 0.5 });
    decayAll(g, T0 + 3650 * DAY, T0);
    expect(g.nodes.has(n.id)).toBe(true);
    expect(n.strength).toBeGreaterThanOrEqual(0);
  });

  it("time going backwards changes nothing (a clock jump is not a memory event)", () => {
    const g = createGraph();
    const n = moment(g, "a", { strength: 0.5 });
    decayAll(g, T0 - 5 * DAY, T0);
    expect(n.strength).toBe(0.5);
  });

  it("a question keeps its pressure far longer than a memory keeps its detail", () => {
    const g = createGraph();
    const q = addNode(g, { kind: "question", text: "why does that keep happening", bornMs: T0, tension: 0.8, strength: 0.6 });
    decayAll(g, T0 + 30 * DAY, T0);
    expect(q.tension).toBeGreaterThan(0.5);
  });
});

describe("rehearsal (the spacing effect)", () => {
  it("recalling something you nearly lost teaches more than recalling what you just recalled", () => {
    const g = createGraph();
    const fresh = moment(g, "a", { strength: 0.3 });
    const distant = moment(g, "b", { strength: 0.3 });
    consolidate(fresh, T0 + 60 * 1000); // a minute later
    consolidate(distant, T0 + 21 * DAY); // three weeks later
    expect(distant.strength).toBeGreaterThan(fresh.strength);
  });

  it("counts the rehearsal, which is what makes something permanent", () => {
    const g = createGraph();
    const n = moment(g, "a", { strength: 0.3 });
    const before = decayRateFor(n);
    for (let i = 1; i <= 4; i++) consolidate(n, T0 + i * 5 * DAY);
    expect(n.recalls).toBe(4);
    expect(decayRateFor(n)).toBeLessThan(before / 2);
  });
});

describe("letting go", () => {
  it("needs weak AND disconnected AND old, all three", () => {
    const g = createGraph();
    const late = T0 + PRUNE_MIN_AGE_MS + DAY;

    const weakOnly = moment(g, "weak but new", { strength: 0.001, bornMs: late - 60_000 });
    const oldOnly = moment(g, "old but held", { strength: 0.5, bornMs: T0 });
    const connected = moment(g, "weak, old, but still attached", { strength: 0.001 });
    const anchor = moment(g, "what it is attached to", { strength: 0.9 });
    // A relation that means it is still HELD. Temporal adjacency deliberately does not count.
    link(g, connected.id, anchor.id, "reminds_of", 0.9, T0);
    const gone = moment(g, "weak, old, alone", { strength: 0.001 });

    const candidates = new Set(pruningCandidates(g, late));
    expect(candidates.has(weakOnly.id), "too new to be gone").toBe(false);
    expect(candidates.has(oldOnly.id), "still strong").toBe(false);
    expect(candidates.has(connected.id), "still held by something").toBe(false);
    expect(candidates.has(gone.id)).toBe(true);
  });

  it("HAPPENING ON A TUESDAY is not a reason to keep something", () => {
    // Every moment is tied to the days either side of it, so counting temporal adjacency as
    // "something still holds this" made the condition impossible and pruning never once ran.
    const g = createGraph();
    const late = T0 + PRUNE_MIN_AGE_MS + DAY;
    const faded = moment(g, "a forgettable tuesday", { strength: 0.001 });
    const before = moment(g, "the day before", { strength: 0.9 });
    const after = moment(g, "the day after", { strength: 0.9 });
    link(g, faded.id, before.id, "co_occurred", 0.55, T0);
    link(g, faded.id, after.id, "co_occurred", 0.55, T0);
    expect(pruningCandidates(g, late), "adjacency alone does not keep it").toContain(faded.id);

    // And letting it go does not sever the days either side of it from each other.
    prune(g, late);
    expect(g.nodes.has(faded.id)).toBe(false);
    expect(neighbours(g, before.id).has(after.id), "the run of her days stays continuous").toBe(true);
  });

  it("never lets go of a figure, a theme, or an open question", () => {
    const g = createGraph();
    const late = T0 + PRUNE_MIN_AGE_MS + DAY;
    const eric = addNode(g, { kind: "figure", text: "Eric", bornMs: T0, strength: 0.001 });
    const theme = addNode(g, { kind: "theme", text: "how evenings go", bornMs: T0, strength: 0.001 });
    const open = addNode(g, { kind: "question", text: "why", bornMs: T0, strength: 0.001, tension: 0.5 });
    prune(g, late);
    expect(g.nodes.has(eric.id)).toBe(true);
    expect(g.nodes.has(theme.id)).toBe(true);
    expect(g.nodes.has(open.id)).toBe(true);
  });

  it("reports what it let go, so a loss is never silent", () => {
    const g = createGraph();
    const late = T0 + PRUNE_MIN_AGE_MS + DAY;
    moment(g, "gone", { strength: PRUNE_STRENGTH / 2 });
    const gone = prune(g, late);
    expect(gone).toHaveLength(1);
    expect(gone[0].text).toBe("gone");
  });
});

describe("reading it back", () => {
  it("counts what she has, and how much of it is out of easy reach", () => {
    const g = createGraph();
    moment(g, "vivid", { strength: 0.8, charge: 0.9 });
    moment(g, "faded", { strength: 0.05 });
    addNode(g, { kind: "insight", text: "something about me", bornMs: T0, strength: 0.6 });
    const s = stats(g);
    expect(s.nodes).toBe(3);
    expect(s.byKind.moment).toBe(2);
    expect(s.byKind.insight).toBe(1);
    expect(s.faded).toBe(1);
    expect(s.orphans).toBe(3);
  });

  it("counts unresolved pressure, which is what turns into something nagging at her", () => {
    const g = createGraph();
    addNode(g, { kind: "question", text: "q1", bornMs: T0, tension: 0.7 });
    addNode(g, { kind: "question", text: "q2", bornMs: T0, tension: 0.5 });
    expect(stats(g).tension).toBeCloseTo(1.2, 5);
  });
});
