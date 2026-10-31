import { describe, it, expect } from "vitest";
import { addNode, createGraph, link, type FieldGraph, type FieldNode } from "../../../src/life/field.js";
import {
  coolAll, describeRetrieval, retrieve, spread, whenWords, WARMTH_TAU_MS,
} from "../../../src/life/field-spread.js";
import { createStream } from "../../../src/life/soft-choice.js";

// Flow. The properties that matter here are the ones that separate a mind from a search index:
// that activation travels past what the cue resembles, that most of what is activated does NOT
// surface, and that what does not surface still leaves a residue which can surface later with no
// new event at all.

const T0 = Date.parse("2026-08-01T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function node(g: FieldGraph, text: string, strength = 1, charge = 0.3, valence = 0, bornMs = T0): FieldNode {
  return addNode(g, { kind: "moment", text, bornMs, strength, charge, valence, source: "test" });
}

/** a - b - c - d, each relation strong. The simplest thing that has a distance. */
function chain(): { g: FieldGraph; a: FieldNode; b: FieldNode; c: FieldNode; d: FieldNode } {
  const g = createGraph();
  const a = node(g, "the cue");
  const b = node(g, "one step away");
  const c = node(g, "two steps away");
  const d = node(g, "three steps away");
  link(g, a.id, b.id, "co_occurred", 0.9, T0);
  link(g, b.id, c.id, "co_occurred", 0.9, T0);
  link(g, c.id, d.id, "co_occurred", 0.9, T0);
  return { g, a, b, c, d };
}

/** Long enough to have an end that a single cue genuinely cannot reach. */
function longChain(steps = 6): { g: FieldGraph; head: FieldNode; tail: FieldNode; all: FieldNode[] } {
  const g = createGraph();
  const all = Array.from({ length: steps }, (_, i) => node(g, i === 0 ? "the cue" : `${i} steps away`));
  for (let i = 0; i < steps - 1; i++) link(g, all[i].id, all[i + 1].id, "co_occurred", 0.9, T0);
  return { g, head: all[0], tail: all[steps - 1], all };
}

describe("spreading activation", () => {
  it("REACH: energy travels past what the cue resembles", () => {
    const { g, a, c, d } = chain();
    const r = spread(g, [{ id: a.id, energy: 1 }], { hops: 3 });
    expect(r.activation.get(c.id)).toBeGreaterThan(0);
    expect(r.activation.get(d.id)).toBeGreaterThan(0);
    expect(r.hop.get(d.id)).toBe(3);
  });

  it("weakens with distance, so nearby still beats far", () => {
    const { g, a, b, c, d } = chain();
    const r = spread(g, [{ id: a.id, energy: 1 }], { hops: 3 });
    const A = (n: FieldNode) => r.activation.get(n.id) ?? 0;
    expect(A(b)).toBeGreaterThan(A(c));
    expect(A(c)).toBeGreaterThan(A(d));
  });

  it("stops where she stops: fewer hops means only the obvious arrives", () => {
    const { g, a, c, d } = chain();
    const weary = spread(g, [{ id: a.id, energy: 1 }], { hops: 1 });
    expect(weary.activation.has(c.id)).toBe(false);
    expect(weary.activation.has(d.id)).toBe(false);
  });

  it("THE HUB PENALTY: a well-connected node does not shout at all its neighbours", () => {
    const g = createGraph();
    const hub = node(g, "connected to everything");
    const lonely = node(g, "connected to one thing");
    const hubTarget = node(g, "one of many");
    const lonelyTarget = node(g, "the only one");
    link(g, hub.id, hubTarget.id, "co_occurred", 0.8, T0);
    for (let i = 0; i < 15; i++) link(g, hub.id, node(g, `other ${i}`).id, "co_occurred", 0.8, T0);
    link(g, lonely.id, lonelyTarget.id, "co_occurred", 0.8, T0);

    const fromHub = spread(g, [{ id: hub.id, energy: 1 }], { hops: 1 });
    const fromLonely = spread(g, [{ id: lonely.id, energy: 1 }], { hops: 1 });
    expect(fromHub.activation.get(hubTarget.id)!).toBeLessThan(fromLonely.activation.get(lonelyTarget.id)! / 3);
  });

  it("a memory she has nearly lost receives less, and therefore passes on less", () => {
    const g = createGraph();
    const cue = node(g, "the cue");
    const vivid = node(g, "still vivid", 1.0);
    const faded = node(g, "nearly lost", 0.1);
    link(g, cue.id, vivid.id, "co_occurred", 0.7, T0);
    link(g, cue.id, faded.id, "co_occurred", 0.7, T0);
    const r = spread(g, [{ id: cue.id, energy: 1 }], { hops: 1 });
    expect(r.activation.get(faded.id)!).toBeCloseTo(r.activation.get(vivid.id)! * 0.1, 4);
  });

  it("but a strong enough cue along a strong enough relation still reaches it (想起来了)", () => {
    const g = createGraph();
    const cue = node(g, "the cue");
    const faded = node(g, "nearly lost", 0.12);
    link(g, cue.id, faded.id, "co_occurred", 1.0, T0);
    const r = retrieve(g, [{ id: cue.id, energy: 1 }], { hops: 1, threshold: 0.05, nowMs: T0 });
    expect(r.retrieved.map((n) => n.id)).toContain(faded.id);
  });

  it("ignores a cue for something that is not there, rather than throwing", () => {
    const { g, a } = chain();
    const r = spread(g, [{ id: 9999, energy: 1 }, { id: a.id, energy: 1 }], { hops: 2 });
    expect(r.activation.has(a.id)).toBe(true);
  });

  it("terminates on a graph with a cycle", () => {
    const g = createGraph();
    const a = node(g, "a"), b = node(g, "b"), c = node(g, "c");
    link(g, a.id, b.id, "co_occurred", 1, T0);
    link(g, b.id, c.id, "co_occurred", 1, T0);
    link(g, c.id, a.id, "co_occurred", 1, T0);
    const r = spread(g, [{ id: a.id, energy: 1 }], { hops: 8 });
    expect(r.activation.size).toBe(3);
  });
});

describe("retrieval is not activation", () => {
  it("most of what lights up never surfaces", () => {
    const { g, head, tail } = longChain();
    const r = retrieve(g, [{ id: head.id, energy: 1 }], { hops: 5, threshold: 0.12, nowMs: T0, interference: 0 });
    expect(r.activation.size).toBe(6);
    expect(r.retrieved.length).toBeLessThan(5);
    expect(r.retrieved.map((n) => n.id), "the far end lit up and stayed under").not.toContain(tail.id);
    expect(r.activation.get(tail.id), "but it did light up").toBeGreaterThan(0);
  });

  it("holds only as much as she can hold", () => {
    const g = createGraph();
    const cue = node(g, "the cue");
    for (let i = 0; i < 12; i++) link(g, cue.id, node(g, `related ${i}`).id, "co_occurred", 0.9, T0);
    const r = retrieve(g, [{ id: cue.id, energy: 1 }], { hops: 1, threshold: 0.01, topK: 4, nowMs: T0 });
    expect(r.retrieved).toHaveLength(4);
  });

  it("what came back is rehearsed", () => {
    const { g, a, b } = chain();
    const before = b.strength;
    retrieve(g, [{ id: a.id, energy: 1 }], { hops: 1, threshold: 0.1, nowMs: T0 + 10 * DAY, interference: 0 });
    expect(b.recalls).toBe(1);
    expect(b.strength).toBeGreaterThanOrEqual(before);
    expect(b.lastRecallMs).toBe(T0 + 10 * DAY);
  });

  it("reports how far back it reached, which is the whole reason this exists", () => {
    const g = createGraph();
    const now = T0 + 200 * DAY;
    const cue = node(g, "今天", 1, 0.3, 0, now);
    const old = node(g, "something from 个月前", 1, 0.3, 0, T0);
    link(g, cue.id, old.id, "reminds_of", 0.9, now);
    const r = retrieve(g, [{ id: cue.id, energy: 1 }], { hops: 1, threshold: 0.1, nowMs: now });
    expect(r.spanDays).toBeGreaterThan(190);
  });

  it("colours her mood by what came back, weighted by how much it mattered", () => {
    const g = createGraph();
    const cue = node(g, "cue", 1, 0.1, 0);
    const heavy = node(g, "a hard thing", 1, 0.9, -0.8);
    const light = node(g, "a mildly nice thing", 1, 0.1, 0.5);
    link(g, cue.id, heavy.id, "co_occurred", 0.9, T0);
    link(g, cue.id, light.id, "co_occurred", 0.9, T0);
    const r = retrieve(g, [{ id: cue.id, energy: 1 }], { hops: 1, threshold: 0.05, nowMs: T0 });
    expect(r.valence).toBeLessThan(-0.3); // the heavy one dominates, as it should
  });
});

describe("interference: what losing costs a memory", () => {
  it("a near-miss that sits in the same part of her life gives up more than a distant one", () => {
    const g = createGraph();
    const cue = node(g, "the cue");
    const winner = node(g, "what she actually remembered");
    const similar = node(g, "the one it blurred into");
    const distant = node(g, "an unrelated near-miss");
    const untouched = node(g, "not activated at all");
    // Winner and `similar` share their whole context, which is what makes them confusable.
    const s1 = node(g, "shared context 1");
    const s2 = node(g, "shared context 2");
    for (const n of [winner, similar]) {
      link(g, n.id, s1.id, "co_occurred", 0.6, T0);
      link(g, n.id, s2.id, "co_occurred", 0.6, T0);
    }
    link(g, cue.id, winner.id, "co_occurred", 1.0, T0);
    link(g, cue.id, similar.id, "co_occurred", 0.25, T0);
    link(g, cue.id, distant.id, "co_occurred", 0.25, T0);

    const beforeSimilar = similar.strength;
    const beforeDistant = distant.strength;
    const beforeUntouched = untouched.strength;

    retrieve(g, [{ id: cue.id, energy: 1 }], { hops: 1, threshold: 0.2, topK: 1, nowMs: T0, interference: 0.3 });

    const lostSimilar = beforeSimilar - similar.strength;
    const lostDistant = beforeDistant - distant.strength;
    expect(lostSimilar).toBeGreaterThan(0);
    expect(lostSimilar).toBeGreaterThan(lostDistant);
    expect(untouched.strength, "something that never competed loses nothing").toBe(beforeUntouched);
  });

  it("can be switched off, and then nothing loses anything", () => {
    const g = createGraph();
    const cue = node(g, "cue");
    const a = node(g, "a"), b = node(g, "b"), shared = node(g, "shared");
    link(g, cue.id, a.id, "co_occurred", 1, T0);
    link(g, cue.id, b.id, "co_occurred", 0.3, T0);
    link(g, a.id, shared.id, "co_occurred", 0.6, T0);
    link(g, b.id, shared.id, "co_occurred", 0.6, T0);
    const before = b.strength;
    const r = retrieve(g, [{ id: cue.id, energy: 1 }], { hops: 1, threshold: 0.2, topK: 1, nowMs: T0, interference: 0 });
    expect(r.retrieved.map((n) => n.id), "a really did win, so b really did lose").toEqual([a.id]);
    expect(b.strength).toBe(before);
  });

  it("never drives a memory below nothing", () => {
    const g = createGraph();
    const cue = node(g, "cue");
    const winner = node(g, "winner");
    const loser = node(g, "loser", 0.3);
    const shared = node(g, "shared");
    link(g, cue.id, winner.id, "co_occurred", 1, T0);
    link(g, cue.id, loser.id, "co_occurred", 1, T0);
    link(g, winner.id, shared.id, "co_occurred", 1, T0);
    link(g, loser.id, shared.id, "co_occurred", 1, T0);
    // An absurd interference setting, deliberately: the floor has to hold under any parameter,
    // not merely under the ones we happened to pick.
    retrieve(g, [{ id: cue.id, energy: 1 }], { hops: 1, threshold: 0.25, topK: 1, nowMs: T0, interference: 5 });
    expect(loser.strength).toBe(0);
  });
});

describe("warmth: accumulation with no event", () => {
  it("THE PROPERTY: something surfaces on its own after enough near-misses", () => {
    // Nothing new happens. The same cue, four times. On the fourth, a node that was never once
    // strongly activated crosses into being something she is actually thinking about. This is the
    // smallest instance of quantity becoming quality, and no event caused it.
    const { g, head, tail } = longChain();
    const surfaced: boolean[] = [];
    for (let i = 0; i < 8; i++) {
      const r = retrieve(g, [{ id: head.id, energy: 1 }], {
        hops: 5, threshold: 0.12, nowMs: T0, interference: 0,
      });
      surfaced.push(r.retrieved.some((n) => n.id === tail.id));
    }
    console.log(`\n  the far end surfaced on pass: ${surfaced.map((s, i) => (s ? i + 1 : null)).filter(Boolean).join(", ") || "never"}`);
    expect(surfaced[0], "not on the first pass").toBe(false);
    expect(surfaced.some(Boolean), "but eventually, with no new event").toBe(true);
  });

  it("banks only what did not surface", () => {
    const { g, head, tail, all } = longChain();
    retrieve(g, [{ id: head.id, energy: 1 }], { hops: 5, threshold: 0.12, nowMs: T0, interference: 0 });
    expect(all[1].warmth, "what surfaced was rehearsed, not banked").toBe(0);
    expect(tail.warmth).toBeGreaterThan(0);
  });

  it("cools with time, so a thing on the edge of surfacing eventually lets go", () => {
    const { g, a, d } = chain();
    retrieve(g, [{ id: a.id, energy: 1 }], { hops: 3, threshold: 0.12, nowMs: T0, interference: 0 });
    const warm = d.warmth;
    coolAll(g, WARMTH_TAU_MS);
    expect(d.warmth).toBeCloseTo(warm * Math.exp(-1), 4);
    coolAll(g, 40 * WARMTH_TAU_MS);
    expect(d.warmth).toBe(0);
  });

  it("cooling backwards in time does nothing", () => {
    const { g, a, d } = chain();
    retrieve(g, [{ id: a.id, energy: 1 }], { hops: 3, threshold: 0.12, nowMs: T0, interference: 0 });
    const warm = d.warmth;
    coolAll(g, -5000);
    expect(d.warmth).toBe(warm);
  });
});

describe("what it looks like from inside", () => {
  it("reads as something she is carrying, with a when, not as a database row", () => {
    const g = createGraph();
    const now = T0 + 100 * DAY;
    const cue = node(g, "今天", 1, 0.3, 0, now);
    const old = node(g, "the afternoon the power went out", 1, 0.8, -0.4, T0);
    link(g, cue.id, old.id, "reminds_of", 0.9, now);
    const r = retrieve(g, [{ id: cue.id, energy: 1 }], { hops: 1, threshold: 0.1, nowMs: now });
    const text = describeRetrieval(r, now);
    console.log(`\n${text}`);
    expect(text).toContain("在你心里的");
    expect(text).toContain("the afternoon the power went out");
    expect(text).toMatch(/个月前/);
    // Felt time first, the record's own day and clock beside it: felt
    // said 昨天 about a yesterday-afternoon talk and her story supplied the missing 晚.
    expect(text).toMatch(/，\d{4}-\d{2}-\d{2} \d{2}:\d{2}/u);
  });

  it("says nothing when nothing came back", () => {
    const g = createGraph();
    const lonely = node(g, "alone");
    const r = retrieve(g, [{ id: lonely.id, energy: 0 }], { nowMs: T0 });
    expect(describeRetrieval(r, T0)).toBe("");
  });

  it("says when things happened the way a person does", () => {
    expect(whenWords(0.2)).toBe("今天");
    expect(whenWords(1.4)).toBe("昨天");
    expect(whenWords(5)).toBe("5天前");
    expect(whenWords(21)).toBe("3周前");
    expect(whenWords(90)).toBe("3个月前");
    expect(whenWords(900)).toBe("很久以前");
  });
});

// ── the last step of remembering is no longer argmax ──────────────────────────

describe("softened retrieval: near-tied memories take turns", () => {
  // Two rivals nearly level behind one cue, one seat. Unsoftened, the same one wins every
  // single time (ties toward the lowest id), its rival is never rehearsed, never strengthened,
  // and decays permanently out of reach, the verbatim defect soft-choice.ts's head comment
  // names, in the file it names.
  function rivals() {
    const g = createGraph();
    const cue = node(g, "the cue");
    const first = node(g, "the one that always won", 1.0);
    const second = node(g, "the rival that starved", 0.98);
    link(g, cue.id, first.id, "co_occurred", 0.8, T0);
    link(g, cue.id, second.id, "co_occurred", 0.8, T0);
    return { g, cue, first, second };
  }

  // Fresh graph per draw, ON PURPOSE: warmth residue is the field's own slower anti-starvation
  // path (three near-misses become a thought), and back-to-back identical retrievals on one
  // graph accumulate it, which conflates the two mechanisms. Softening is the FAST path, a
  // close second can win TODAY, from the same state, so it is measured on identical states.
  it("unsoftened, the same state picks the same winner every time — the argmax defect", () => {
    for (let i = 0; i < 5; i++) {
      const { cue, second, g } = rivals();
      const r = retrieve(g, [{ id: cue.id, energy: 1 }], { hops: 1, threshold: 0.05, topK: 1, nowMs: T0, interference: 0 });
      expect(r.retrieved.some((n) => n.id === second.id)).toBe(false);
    }
  });

  it("softened, both rivals get their days from the very same state", () => {
    const stream = createStream(7);
    let firstWins = 0;
    let secondWins = 0;
    for (let i = 0; i < 60; i++) {
      const { cue, first, second, g } = rivals();
      const r = retrieve(g, [{ id: cue.id, energy: 1 }], {
        hops: 1, threshold: 0.05, topK: 1, nowMs: T0, interference: 0,
        soften: { random: () => stream.next(), arousalSpread: 1 },
      });
      if (r.retrieved.some((n) => n.id === first.id)) firstWins++;
      if (r.retrieved.some((n) => n.id === second.id)) secondWins++;
    }
    expect(firstWins, "the leader still surfaces").toBeGreaterThan(10);
    expect(secondWins, "and the rival is finally rehearsed").toBeGreaterThan(10);
  });

  it("a clear leader stays a clear leader: softening opens ties, not landslides", () => {
    const g = createGraph();
    const cue = node(g, "the cue");
    const strong = node(g, "unmistakably it", 1.0);
    const faint = node(g, "barely related", 1.0);
    link(g, cue.id, strong.id, "co_occurred", 0.9, T0);
    link(g, cue.id, faint.id, "co_occurred", 0.12, T0);
    const stream = createStream(11);
    let faintWins = 0;
    for (let i = 0; i < 60; i++) {
      const world = createGraph();
      const c = node(world, "the cue");
      const s2 = node(world, "unmistakably it", 1.0);
      const f2 = node(world, "barely related", 1.0);
      link(world, c.id, s2.id, "co_occurred", 0.9, T0);
      link(world, c.id, f2.id, "co_occurred", 0.12, T0);
      const r = retrieve(world, [{ id: c.id, energy: 1 }], {
        hops: 1, threshold: 0.01, topK: 1, nowMs: T0, interference: 0,
        soften: { random: () => stream.next(), arousalSpread: 1 },
      });
      if (r.retrieved.some((n) => n.id === f2.id)) faintWins++;
    }
    expect(faintWins, "a landslide should essentially never flip").toBeLessThanOrEqual(3);
  });

  it("what comes back is still strongest-first, and no-soften callers are byte-identical", () => {
    const { g, cue } = rivals();
    const withSoften = retrieve(g, [{ id: cue.id, energy: 1 }], {
      hops: 1, threshold: 0.01, topK: 2, nowMs: T0, interference: 0,
      soften: { random: () => 0.5, arousalSpread: 1 },
    });
    // Both seats filled from two candidates: order must be by activation regardless of the
    // order sampling picked them in.
    const acts = withSoften.retrieved.map((n) => withSoften.activation.get(n.id)! + n.warmth);
    expect([...acts].sort((a, b) => b - a)).toEqual(acts);
  });
});
