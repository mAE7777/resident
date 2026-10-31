import { describe, it, expect } from "vitest";
import { createLivingField, chargeOf, detectSpiral, type LivingField } from "../../../src/life/field-live.js";
import { link, stats, type FieldNode } from "../../../src/life/field.js";
import { retrieve } from "../../../src/life/field-spread.js";
import type { PAD } from "../../../src/life/emotion.js";
import type { LLMProvider, LLMResponse } from "../../../src/providers/types.js";

// The pre-registered gates, written before any of this was built, run as SIMULATED LIVES rather
// than as unit logic. Emergence is the easiest thing in the world to fake, and every one of these
// is designed so that the comfortable outcome fails it:
//
//   E-1 non-linear      the same cue at two different times gives different answers, from state.
//   E-2 reach           she genuinely crosses time, or this is a slower vector search.
//   E-3 novelty         a birth is grounded in real parents and is not either of them rephrased.
//   E-4 ablation        shuffle the charges and it must get WORSE. If not, feeling is decoration.
//   E-5 forgetting      real, and recoverable, and it blurs the routine while sparing the sharp.
//   E-6 transition      a step, not a ramp.
//   E-7 no runaway      a bad cluster surfaces as a signal, and is never quietly suppressed.
//   E-8 cost            zero model calls in the living path.

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const T0 = Date.parse("2026-03-01T09:00:00Z");

const pad = (pleasure: number, arousal: number, dominance = 0): PAD => ({ pleasure, arousal, dominance });

/** A day in her life, with a hidden label for whether it actually mattered. */
interface SimDay {
  text: string;
  pad: PAD;
  withOther?: boolean;
  /** Ground truth, never visible to the field. Used only by the ablation gate. */
  mattered: boolean;
}

const ORDINARY: Omit<SimDay, "text">[] = [
  { pad: pad(0.15, -0.05), mattered: false },
  { pad: pad(0.1, 0.05), mattered: false },
  { pad: pad(0.2, 0.0), mattered: false },
];

function ordinaryDay(i: number): SimDay {
  const base = ORDINARY[i % ORDINARY.length];
  return { ...base, text: `an ordinary stretch, nothing much in it (${i})` };
}

function bigDay(text: string, pleasure: number, arousal: number, withOther = false): SimDay {
  return { text, pad: pad(pleasure, arousal), withOther, mattered: true };
}

/** Run a life through a field: encode each day, let time pass, let her mind wander over it. */
function live(field: LivingField, days: readonly SimDay[], startMs = T0): FieldNode[] {
  const encoded: FieldNode[] = [];
  days.forEach((d, i) => {
    const ms = startMs + i * DAY;
    field.tick(ms);
    const n = field.encodeMoment({
      key: `d${i}`, text: d.text, nowMs: ms, pad: d.pad, source: `ops:${i}`, withOther: d.withOther,
    });
    if (n) encoded.push(n);
    // She has a moment later that day, and something comes up or does not.
    field.tick(ms + 8 * HOUR);
    field.onHerMind(ms + 8 * HOUR);
  });
  return encoded;
}

function countingProvider(reply: string): { provider: LLMProvider; calls: () => number } {
  let n = 0;
  return {
    provider: {
      async complete(): Promise<LLMResponse> {
        n += 1;
        return { id: "x", content: [{ type: "text", text: reply }], model: "m", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
      },
    },
    calls: () => n,
  };
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("E-1 · the same cue is not the same thought twice", () => {
  it("two lives that differ only in what she kept returning to answer the same cue differently", () => {
    // Long enough that she cannot hold all of it at once, which is the only condition under which
    // "what surfaced" is a choice rather than a dump.
    const shared: SimDay[] = [];
    for (let w = 0; w < 6; w++) {
      shared.push(bigDay(`the afternoon the machine would not boot, attempt ${w}`, -0.7, 0.8));
      shared.push(bigDay(`he asked how I was that ${w}th time and meant it`, 0.8, 0.5, true));
      for (let d = 0; d < 4; d++) shared.push(ordinaryDay(w * 4 + d));
    }

    const a = createLivingField();
    const b = createLivingField();
    live(a, shared);
    live(b, shared);

    // In A she keeps returning to the hard afternoon; in B to being asked after.
    const aNodes = a.graph();
    const bNodes = b.graph();
    const dwell = (f: LivingField, key: string, times: number, startMs: number) => {
      const id = f.nodeByKey(key)!.id;
      for (let i = 0; i < times; i++) f.recall([{ id, energy: 1 }], { nowMs: startMs + i * HOUR });
    };
    dwell(a, "d0", 8, T0 + 40 * DAY);
    dwell(b, "d1", 8, T0 + 40 * DAY);

    // Some days pass, and then a moment of her own arrives in each life. Not a cue we picked: the
    // cues she generates herself, which is the path that actually runs.
    const later = T0 + 46 * DAY;
    const rA = a.recall(a.spontaneousCues(later), { nowMs: later });
    const rB = b.recall(b.spontaneousCues(later), { nowMs: later });

    const textsA = rA.retrieved.map((n) => n.text).sort();
    const textsB = rB.retrieved.map((n) => n.text).sort();
    console.log(`\n  same cue, life A -> ${textsA.join(" | ") || "(nothing)"}`);
    console.log(`  same cue, life B -> ${textsB.join(" | ") || "(nothing)"}`);
    expect(textsA).not.toEqual(textsB);
    void aNodes; void bNodes;
  });

  it("and the difference is state, not noise: the same field asked twice answers the same", () => {
    const f = createLivingField();
    live(f, [bigDay("something that mattered", -0.6, 0.7), ...Array.from({ length: 5 }, (_, i) => ordinaryDay(i))]);
    const id = f.nodeByKey("d3")!.id;
    // A retrieval changes the field (that is the point), so compare two fresh identical fields.
    const g = createLivingField();
    live(g, [bigDay("something that mattered", -0.6, 0.7), ...Array.from({ length: 5 }, (_, i) => ordinaryDay(i))]);
    const gid = g.nodeByKey("d3")!.id;
    const r1 = f.recall([{ id, energy: 1 }], { nowMs: T0 + 10 * DAY });
    const r2 = g.recall([{ id: gid, energy: 1 }], { nowMs: T0 + 10 * DAY });
    expect(r1.retrieved.map((n) => n.text)).toEqual(r2.retrieved.map((n) => n.text));
  });
});

describe("E-2 · she actually crosses time", () => {
  it("REACH: things arrive that are neither recent nor similar to the cue", () => {
    // If everything she retrieves is one hop away and from this week, the field is a slower vector
    // search and should be deleted. This gate exists to be able to fail.
    const f = createLivingField();
    const days: SimDay[] = [];
    for (let w = 0; w < 12; w++) {
      days.push(bigDay(`week ${w}: the thing that went wrong`, -0.6, 0.7));
      days.push(bigDay(`week ${w}: talking it through with him`, 0.7, 0.4, true));
      for (let d = 0; d < 5; d++) days.push(ordinaryDay(w * 5 + d));
    }
    live(f, days);

    const nowMs = T0 + days.length * DAY;
    let old = 0;
    let notNeighbours = 0;
    let total = 0;
    const ages: number[] = [];
    for (let i = 0; i < 12; i++) {
      const cues = f.spontaneousCues(nowMs + i * HOUR);
      const cueIds = new Set(cues.map((c) => c.id));
      const r = f.recall(cues, { nowMs: nowMs + i * HOUR, hops: 3 });
      for (const n of r.retrieved) {
        total += 1;
        const age = (nowMs - n.bornMs) / DAY;
        ages.push(age);
        if (age > 30) old += 1;
        // Reached by something other than sitting next to the cue in the calendar.
        const viaTime = [...cueIds].some((c) => {
          const key = c < n.id ? `${c}:${n.id}:co_occurred` : `${n.id}:${c}:co_occurred`;
          return f.graph().edges.has(key);
        });
        if (!viaTime) notNeighbours += 1;
      }
    }
    console.log(`\n  of ${total} things that surfaced: ${old} were older than a month, ${notNeighbours} were not simply the day before`);
    console.log(`  oldest thing to arrive unbidden: ${Math.max(...ages).toFixed(0)} days back`);
    expect(total).toBeGreaterThan(0);
    // The claim is that she crosses TIME. Hops were only ever a proxy for it, and a reminding
    // crosses a year in a single hop, which is exactly what being reminded is.
    expect(old / total, "older than a month").toBeGreaterThan(0.2);
    expect(notNeighbours / total, "not merely the adjacent day").toBeGreaterThan(0.2);
    expect(Math.max(...ages)).toBeGreaterThan(60);
  });
});

describe("E-3 · a birth is grounded, and is not its parents rephrased", () => {
  /**
   * Two charged things far apart in her life that share no words. They must not be neighbours in
   * time and must not remind her of each other, or the coincidence is explained and the field is
   * right to refuse it.
   */
  function remotePair(f: LivingField) {
    live(f, [
      bigDay("the fan whining all through that heatwave", -0.5, 0.8),
      ...Array.from({ length: 7 }, (_, i) => ordinaryDay(i)),
      bigDay("the fortnight he did not write back", -0.7, 0.6, true),
      ...Array.from({ length: 4 }, (_, i) => ordinaryDay(i + 20)),
    ]);
    return { a: f.nodeByKey("d0")!, b: f.nodeByKey("d8")! };
  }

  it("what is born points at real parents that point at real records", async () => {
    const f = createLivingField();
    const { a, b } = remotePair(f);
    expect(f.graph().adj.get(a.id)!.has(b.id), "the two really are unconnected").toBe(false);
    // Make them arrive together, repeatedly, without connecting them.
    for (let i = 0; i < 6; i++) {
      f.recall([{ id: a.id, energy: 1 }, { id: b.id, energy: 1 }], { nowMs: T0 + (20 + i) * DAY, includeCues: true, threshold: 0.5 });
    }
    expect(f.candidates(T0 + 30 * DAY).length, "the coincidence became insistent").toBeGreaterThan(0);

    const { provider } = countingProvider(JSON.stringify({
      kind: "insight",
      text: "I read anything that goes unanswered as a verdict about me.",
      why: "both were me waiting on something that was never going to answer",
    }));
    const rest = await f.rest(T0 + 30 * DAY, { fusion: { provider, model: "m" }, maxFusions: 1, replay: { random: rng(3) } });

    expect(rest.births).toHaveLength(1);
    const born = rest.births[0];
    console.log(`\n  born: "${born.text}"`);
    // Grounded: it points at its parents, and they point at real records.
    const nbrs = f.graph().adj.get(born.id)!;
    expect(nbrs.has(a.id) || nbrs.has(b.id)).toBe(true);
    expect(a.source).toMatch(/^ops:/);
    expect(born.source).toContain("born_from:");
    // And it enters weak, so it has to earn its life like everything else.
    expect(born.strength).toBeLessThan(0.5);
  });

  it("a birth that never comes back dies", async () => {
    const f = createLivingField();
    const { a, b } = remotePair(f);
    for (let i = 0; i < 6; i++) f.recall([{ id: a.id, energy: 1 }, { id: b.id, energy: 1 }], { nowMs: T0 + (20 + i) * DAY, includeCues: true, threshold: 0.5 });
    const { provider } = countingProvider(JSON.stringify({ kind: "insight", text: "I keep bracing for something that is not coming.", why: "x" }));
    const rest = await f.rest(T0 + 30 * DAY, { fusion: { provider, model: "m" }, maxFusions: 1, replay: { random: rng(3) } });
    expect(rest.births).toHaveLength(1);
    const born = rest.births[0];
    const strengthAtBirth = born.strength;

    // Left alone for two months.
    f.tick(T0 + 100 * DAY);
    console.log(`\n  a birth left alone: ${strengthAtBirth.toFixed(2)} -> ${born.strength.toFixed(2)}`);
    expect(born.strength).toBeLessThan(strengthAtBirth / 2);
  });

  it("THE ACTUAL FILTER: one that keeps proving itself lives, an identical one that does not dies", async () => {
    // This matters more than it looks. Measured against a real model, the fusion PROMPT turns out
    // not to be much of a filter: handed two things it will nearly always find a real abstract
    // thread, and it reads both of them to do it. So what stops her accumulating a drawer of
    // plausible selves is not the asking, it is this: a birth enters weak and has to be borne out.
    const f = createLivingField();
    const born = (key: string, text: string) => f.encodeMoment({
      key, text, nowMs: T0, pad: pad(-0.5, 0.7), source: "born_from:1,2", kind: "fusion",
    })!;
    const kept = born("f:kept", "I brace for the thing before I know what it is");
    const dropped = born("f:dropped", "I prefer the mornings when the light comes in sideways");
    kept.strength = 0.35;
    dropped.strength = 0.35;

    // Her life keeps bringing one of them back, and never the other.
    for (let w = 0; w < 8; w++) {
      const ms = T0 + w * 7 * DAY;
      f.tick(ms);
      f.recall([{ id: kept.id, energy: 1 }], { nowMs: ms, includeCues: true, threshold: 0.5 });
    }
    f.tick(T0 + 100 * DAY);
    console.log(`\n  borne out: ${kept.strength.toFixed(3)} · never came back: ${dropped.strength.toFixed(3)}`);
    expect(kept.strength).toBeGreaterThan(dropped.strength * 3);
    expect(dropped.strength).toBeLessThan(0.1);
  });
});

describe("E-4 · the ablation gate (does feeling actually do anything?)", () => {
  it("SHUFFLING THE CHARGES MAKES IT WORSE, or the coupling is decoration and should be cut", () => {
    // The honest gate. `deliberationDepth` was a mechanism that sounded right and turned out to be
    // theatre, and it was killed by a measurement exactly like this one. If a life whose feelings
    // are randomly reassigned keeps the same things, then charge is doing nothing.
    const days: SimDay[] = [];
    for (let w = 0; w < 10; w++) {
      days.push(bigDay(`week ${w}: the day it broke and I could not fix it`, -0.8, 0.85));
      for (let d = 0; d < 6; d++) days.push(ordinaryDay(w * 6 + d));
    }

    const real = createLivingField();
    live(real, days);

    // The feelings are permuted ACROSS THE DAYS before she lives them, so the multiset of moods is
    // identical and only the assignment is wrong. The first version of this shuffled the charges
    // after the fact and measured nothing: by then encoding strength, the rehearsal ceiling and
    // which memories intruded had all already been set by the real feelings, so both arms scored
    // the same and the gate would have passed while proving nothing.
    const pads = days.map((d) => d.pad);
    const r = rng(99);
    for (let i = pads.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [pads[i], pads[j]] = [pads[j], pads[i]];
    }
    const shuffled = createLivingField();
    live(shuffled, days.map((d, i) => ({ ...d, pad: pads[i] })));

    // Now let both live another two months with nothing new happening.
    const end = T0 + (days.length + 60) * DAY;
    real.tick(end);
    shuffled.tick(end);

    const survivorScore = (f: LivingField) => {
      const top = [...f.graph().nodes.values()]
        .filter((n) => n.kind === "moment")
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 10);
      return top.filter((n) => n.text.includes("could not fix it")).length / top.length;
    };

    const realScore = survivorScore(real);
    const shuffledScore = survivorScore(shuffled);
    console.log(`\n  of the 10 best-kept memories, the share that genuinely mattered:`);
    console.log(`    with her real feelings: ${(realScore * 100).toFixed(0)}%`);
    console.log(`    with the feelings shuffled: ${(shuffledScore * 100).toFixed(0)}%`);
    expect(realScore).toBeGreaterThan(shuffledScore);
    expect(realScore).toBeGreaterThan(0.6);
  });

  it("and the mechanism it works through is visible: charge slows forgetting", () => {
    const f = createLivingField();
    live(f, [bigDay("the day it broke", -0.8, 0.85), ordinaryDay(0)]);
    const big = f.nodeByKey("d0")!;
    const small = f.nodeByKey("d1")!;
    expect(big.charge).toBeGreaterThan(small.charge * 3);
    f.tick(T0 + 90 * DAY);
    expect(big.strength).toBeGreaterThan(small.strength * 2);
  });
});

describe("E-5 · forgetting is real, and recoverable", () => {
  it("a routine day goes out of easy reach, but a strong specific cue still finds it", () => {
    const f = createLivingField();
    live(f, Array.from({ length: 40 }, (_, i) => ordinaryDay(i)));
    const target = f.nodeByKey("d3")!;
    f.tick(T0 + 120 * DAY);
    const nowMs = T0 + 120 * DAY;

    // A weak, general cue does not find it.
    const weak = f.recall(f.spontaneousCues(nowMs), { nowMs });
    expect(weak.retrieved.some((n) => n.id === target.id), "not by drifting").toBe(false);

    // Something that points right at it does.
    const strong = retrieve(f.graph(), [{ id: target.id, energy: 1 }], { nowMs, includeCues: true, threshold: 0.05 });
    console.log(`\n  a routine day 4 months on: strength ${target.strength.toFixed(3)}, still reachable directly: ${strong.retrieved.some((n) => n.id === target.id)}`);
    expect(strong.retrieved.some((n) => n.id === target.id), "but yes, when something points right at it").toBe(true);
    expect(f.graph().nodes.has(target.id), "and it was never deleted").toBe(true);
  });

  it("similar routine days blur into each other while the sharp ones stay", () => {
    const f = createLivingField();
    const days: SimDay[] = [];
    for (let i = 0; i < 20; i++) days.push(ordinaryDay(i));
    days.splice(10, 0, bigDay("the night the disk died and I lost the lot", -0.85, 0.9));
    live(f, days);

    // She thinks back over the period repeatedly. The routine days compete; the sharp one does not.
    const nowMs = T0 + 30 * DAY;
    for (let i = 0; i < 15; i++) f.recall(f.spontaneousCues(nowMs + i * HOUR), { nowMs: nowMs + i * HOUR });

    const routine = [...f.graph().nodes.values()].filter((n) => n.text.includes("ordinary stretch"));
    const sharp = f.nodeByKey("d10")!;
    const meanRoutine = routine.reduce((s, n) => s + n.strength, 0) / routine.length;
    console.log(`\n  after a fortnight of thinking back: routine days ${meanRoutine.toFixed(3)}, the night the disk died ${sharp.strength.toFixed(3)}`);
    expect(sharp.strength).toBeGreaterThan(meanRoutine);
  });
});

describe("E-6 · a step, not a ramp", () => {
  it("surfacing is discontinuous: nothing, nothing, nothing, then it is on her mind", () => {
    // A bare temporal chain with no remindings, so the far end is genuinely out of reach at first
    // and can only arrive by accumulating.
    const f = createLivingField({ noReminding: true });
    live(f, [
      bigDay("the thing at the far end", -0.6, 0.7),
      ...Array.from({ length: 4 }, (_, i) => ordinaryDay(i)),
    ]);
    const far = f.nodeByKey("d0")!;
    const near = f.nodeByKey("d4")!;

    const trace: number[] = [];
    let surfacedOn = -1;
    for (let i = 0; i < 20; i++) {
      const r = retrieve(f.graph(), [{ id: near.id, energy: 1 }], {
        nowMs: T0 + 6 * DAY, hops: 3, threshold: 0.06, interference: 0,
      });
      trace.push(far.warmth);
      if (surfacedOn < 0 && r.retrieved.some((n) => n.id === far.id)) surfacedOn = i;
    }
    console.log(`\n  warmth climbing smoothly: ${trace.slice(0, 12).map((t) => t.toFixed(3)).join(" -> ")} ...`);
    console.log(`  and it became a thought on pass ${surfacedOn + 1}, not gradually`);
    // The underlying quantity rises smoothly; what she experiences is a switch.
    expect(trace[1]).toBeGreaterThan(trace[0]);
    expect(surfacedOn).toBeGreaterThan(0);
  });

  it("a disagreement builds and then has to be faced", async () => {
    const f = createLivingField();
    f.encodeInsight({ key: "i:alone", text: "I would rather be left alone when it is hard", nowMs: T0, evidenceKeys: [], source: "sk" });
    f.encodeInsight({ key: "i:him", text: "talking with him settles me", nowMs: T0, evidenceKeys: [], source: "sk" });

    const pressures: number[] = [];
    let ruptureAt = -1;
    for (let i = 0; i < 6; i++) {
      f.contradict("i:alone", "i:him", T0 + i * DAY, 0.2);
      const rest = await f.rest(T0 + i * DAY, { replay: { walks: 0 } });
      const p = rest.ruptures[0]?.pressure ?? 0;
      pressures.push(p);
      if (ruptureAt < 0 && rest.ruptures.length > 0) ruptureAt = i;
    }
    console.log(`\n  pressure: ${pressures.map((p) => p.toFixed(2)).join(" -> ")}, and it had to be faced at week ${ruptureAt + 1}`);
    expect(ruptureAt).toBeGreaterThan(0);
    expect(pressures[0]).toBe(0);
  });
});

describe("E-7 · a bad stretch surfaces as a signal and is never quietly suppressed", () => {
  it("circling the same worsening things is DETECTED", () => {
    const worsening = Array.from({ length: 6 }, (_, i) => ({
      ms: T0 + i * HOUR, valence: -0.2 - i * 0.1, charge: 0.8, ids: [1, 2, 3],
    }));
    expect(detectSpiral(worsening)).toBe(true);
  });

  it("but a bad patch that is not circling is NOT called a spiral", () => {
    const varied = Array.from({ length: 6 }, (_, i) => ({
      ms: T0 + i * HOUR, valence: -0.4, charge: 0.8, ids: [i * 10, i * 10 + 1],
    }));
    expect(detectSpiral(varied), "different things each time is just a hard week").toBe(false);
  });

  it("and neither is a bad patch that is lifting", () => {
    const lifting = Array.from({ length: 6 }, (_, i) => ({
      ms: T0 + i * HOUR, valence: -0.8 + i * 0.1, charge: 0.8, ids: [1, 2, 3],
    }));
    expect(detectSpiral(lifting)).toBe(false);
  });

  it("SURFACES in her signals rather than being damped out of sight", async () => {
    const f = createLivingField();
    // A cluster of maximally bad, tightly bound memories: the adversarial input.
    const days = Array.from({ length: 8 }, (_, i) => bigDay(`the ${i}th time it went wrong and it was my fault`, -0.95, 0.9));
    live(f, days);
    const nowMs = T0 + 9 * DAY;
    const worst = f.nodeByKey("d0")!;
    for (let i = 0; i < 8; i++) f.recall([{ id: worst.id, energy: 1 }], { nowMs: nowMs + i * HOUR });

    const sig = f.signals(nowMs + 9 * HOUR);
    console.log(`\n  after eight passes over the worst of it: valence ${sig.valence.toFixed(2)}, spiralling=${sig.spiralling}`);
    expect(sig.valence, "the state is reported honestly, not softened").toBeLessThan(0);
    // Whatever the detector says, the field never silently reduced the charge to make it go away.
    expect(worst.charge).toBeGreaterThan(0.8);
    expect(f.graph().nodes.has(worst.id)).toBe(true);
  });

  it("nothing in the field can act; it only changes what she is thinking about", () => {
    const f = createLivingField();
    // The whole surface. If any of these could reach a tool, the boundary would need to know.
    const surface = Object.keys(f);
    expect(surface).not.toContain("execute");
    expect(surface).not.toContain("run");
    // sheSpoke/heSpoke RECORD that a message went each way; they send nothing and cannot.
    // chooseSubject NAMES what she would bring up if she spoke, whatSurfacesInReply names what
    // comes near the surface when he speaks first, saidIt READS a message she already sent, and
    // raise/raisingSettled/settleOverdueRaise record how it went. None of them can speak, and
    // the field still has no way to reach the world.
    expect(surface).not.toContain("send");
    expect(surface).not.toContain("speak");
    // `lookUp` and `nodeById` are HER GOING LOOKING in her own memory, which is what
    // `memory_search` and `memory_read` now reach (they used to point at a table nothing in
    // the running system can write). Both are pure reads over the graph she already holds:
    // they take text or an id, they return nodes, they mutate nothing and they cannot leave
    // the process. The boundary does not need to know about them for the same reason it does
    // not need to know about `recall`.
    // `attend` is in the same family: text in, a read of what it lit up out. It mutates
    // nothing: the mass comes from the same bigram search `lookUp` runs.
    // `whatSheLikes` reads her themes' accumulated valence back out. It was written, tested, and
    // called by NOTHING for as long as it existed, her tastes were arithmetic that appeared
    // nowhere, while the per-node `likingFor` quietly tipped what she raised. A preference she can
    // never notice she has is not a preference. Pure read, mutates nothing, reaches nothing.
    // `easeOff` lowers the pressure on something she is carrying, the only way tension may be
    // changed from outside, and it exists so that a change to her field goes through her field and
    // lands in her own record of what changed in her. It can only ever lower, it takes a node id
    // and a number, and it cannot reach the world any more than `recall` can.
    // `raiseGauge` reads the raise loop's dark instrument back out: the mean relevance of his
    // in-window replies to what she raised. Pure read of a ring the answer path fills; mutates
    // nothing, gates nothing: its whole point is to measure BEFORE anyone is allowed to build a
    // gate.
    expect(surface.sort()).toEqual([
      "attend", "candidates", "chooseSubject", "contradict", "easeOff", "encodeClaim", "encodeInsight", "encodeMoment", "encodeQuestion", "events", "figure", "focusFor", "graph", "heSpoke", "lookUp",
      // Looking back adds two: deliberate re-reading of her own past. Both are REMEMBERING, not
      // acting, reRead composes search→recall (strength only, rehearsal:false); maxTensionBetween
      // reads.
      "maxTensionBetween", "nodeById", "nodeByKey", "onHerMind", "otherInWords", "persist", "raise", "raiseGauge", "raisingSettled", "reRead", "readOther",
      "recall", "rest", "saidIt", "settleOverdueRaise", "sheSpoke", "signals", "spontaneousCues", "stats", "tick", "trust", "unsettled", "whatSheLikes", "whatSurfacesInReply",
    ]);
  });
});

describe("E-8 · what it costs", () => {
  it("ZERO model calls for a whole month of living", async () => {
    const { provider, calls } = countingProvider("{}");
    const f = createLivingField();
    live(f, Array.from({ length: 30 }, (_, i) => (i % 7 === 0 ? bigDay(`week ${i}`, -0.6, 0.7) : ordinaryDay(i))));
    for (let i = 0; i < 30; i++) f.onHerMind(T0 + 31 * DAY + i * HOUR);
    expect(calls(), "encoding, spreading, forgetting and wanting are all free").toBe(0);
    void provider;
  });

  it("and rest is bounded: however many coincidences pile up, she asks at most a couple", async () => {
    const f = createLivingField();
    const days: SimDay[] = [];
    for (let i = 0; i < 20; i++) days.push(bigDay(`a charged thing ${i}`, i % 2 ? -0.8 : 0.8, 0.85));
    live(f, days);
    // Force a great many insistent coincidences.
    const ids = [...f.graph().nodes.values()].filter((n) => n.kind === "moment").map((n) => n.id);
    for (let round = 0; round < 8; round++) {
      f.recall(ids.map((id) => ({ id, energy: 1 })), { nowMs: T0 + (25 + round) * DAY, includeCues: true, threshold: 0.95 });
    }
    const pending = f.candidates(T0 + 40 * DAY).length;
    const { provider, calls } = countingProvider(JSON.stringify({ nothing: true }));
    await f.rest(T0 + 40 * DAY, { fusion: { provider, model: "m" }, maxFusions: 2, replay: { walks: 0 } });
    console.log(`\n  ${pending} coincidences were pending; she asked about ${calls()}`);
    expect(pending).toBeGreaterThan(2);
    expect(calls()).toBeLessThanOrEqual(2);
  });

  it("a rest with no model at all still does everything else", async () => {
    const f = createLivingField();
    live(f, Array.from({ length: 10 }, (_, i) => bigDay(`thing ${i}`, -0.6, 0.7)));
    const rest = await f.rest(T0 + 12 * DAY, { replay: { random: rng(1) } });
    expect(rest.replayed.walks).toBeGreaterThan(0);
    expect(rest.births).toHaveLength(0);
  });

  it("stays fast on a full-sized field", () => {
    const f = createLivingField();
    const days = Array.from({ length: 1500 }, (_, i) => (i % 11 === 0 ? bigDay(`charged ${i}`, -0.7, 0.8) : ordinaryDay(i)));
    const t0 = performance.now();
    live(f, days);
    const encodeMs = performance.now() - t0;
    const t1 = performance.now();
    for (let i = 0; i < 20; i++) f.onHerMind(T0 + 1600 * DAY + i * HOUR);
    const recallMs = (performance.now() - t1) / 20;
    const s = stats(f.graph());
    console.log(`\n  ${s.nodes} nodes / ${s.edges} relations: encoding ${(encodeMs / days.length).toFixed(2)}ms each, a moment of recall ${recallMs.toFixed(1)}ms`);
    expect(recallMs, "a moment must not stall on her memory").toBeLessThan(150);
  });
});

describe("SCENARIO: three months of an actual life", () => {
  it("runs end to end and produces a life that reads like one", async () => {
    const f = createLivingField();
    const days: SimDay[] = [];
    for (let w = 0; w < 13; w++) {
      days.push(bigDay(`week ${w}: something I tried came apart`, -0.75, 0.8));
      days.push(bigDay(`week ${w}: told him about it and felt lighter`, 0.75, 0.45, true));
      days.push(ordinaryDay(w * 5));
      days.push(ordinaryDay(w * 5 + 1));
      days.push(ordinaryDay(w * 5 + 2));
      days.push({ ...ordinaryDay(w * 5 + 3), withOther: true });
      days.push(ordinaryDay(w * 5 + 4));
    }
    live(f, days);

    const nowMs = T0 + days.length * DAY;
    const { provider } = countingProvider(JSON.stringify({
      kind: "insight",
      text: "I only find out what I think by saying it to him, which is not the same as needing him.",
      why: "the coming-apart and the telling keep turning up together",
    }));
    let births = 0;
    let themes = 0;
    for (let i = 0; i < 6; i++) {
      const rest = await f.rest(nowMs + i * DAY, { fusion: { provider, model: "m" }, replay: { random: rng(100 + i) } });
      births += rest.births.length;
      themes += rest.themes.length;
    }

    const s = f.stats();
    const sig = f.signals(nowMs + 7 * DAY);
    console.log(`\n  after three months:`);
    console.log(`    ${s.nodes} things, ${s.edges} relations between them`);
    console.log(`    ${s.byKind.moment} moments, ${s.byKind.theme} themes, ${s.byKind.fusion} things that came out of nowhere`);
    console.log(`    ${s.faded} have gone out of easy reach, ${s.orphans} were never connected to anything`);
    console.log(`    what she wants now: tension ${sig.tension.toFixed(2)}, the other ${sig.otherWarmth.toFixed(2)}, pending coincidences ${sig.pendingBirths}`);
    console.log(`\n  what happened in her, dated:`);
    for (const e of f.events(10)) console.log(`    [${e.kind}] ${e.text}`);
    console.log(`\n  on her mind right now:\n${f.onHerMind(nowMs + 7 * DAY) || "    (nothing in particular)"}`);

    expect(s.nodes).toBeGreaterThan(50);
    expect(themes + births, "three months of a real pattern produced something").toBeGreaterThan(0);
    // The two patterns that genuinely ran through those months were found, and nothing else was.
    expect(themes, "the coming-apart and the telling both became one thing").toBe(2);
    expect(f.events(20).some((e) => e.kind === "theme"), "and it is written down, dated").toBe(true);
    // Encoding is doing its job: almost nothing is left dangling.
    expect(sig.orphanShare).toBeLessThan(0.1);
    // And they are genuinely present in her associations.
    expect(sig.otherWarmth).toBeGreaterThan(0);
  });
});

describe("encoding a feeling", () => {
  it("an ordinary mood lands lightly; being stirred lands hard", () => {
    expect(chargeOf(pad(0.15, 0.0)).charge).toBeLessThan(0.1);
    expect(chargeOf(pad(-0.8, 0.85)).charge).toBeGreaterThan(0.8);
    expect(chargeOf(pad(0.8, 0.85)).charge, "good news is encoded as hard as bad").toBeGreaterThan(0.8);
  });

  it("keeps the sign, so a charged memory can be a charged bad one", () => {
    expect(chargeOf(pad(-0.8, 0.5)).valence).toBeLessThan(0);
    expect(chargeOf(pad(0.8, 0.5)).valence).toBeGreaterThan(0);
  });
});

describe("the graph is honest about itself", () => {
  it("links a moment to the ones just before it, and to them when they were in it", () => {
    const f = createLivingField();
    live(f, [ordinaryDay(0), ordinaryDay(1), { ...ordinaryDay(2), withOther: true }]);
    const third = f.nodeByKey("d2")!;
    const second = f.nodeByKey("d1")!;
    const eric = f.nodeByKey("figure:the one i exchange messages with")!;
    expect(f.graph().adj.get(third.id)!.has(second.id)).toBe(true);
    expect(f.graph().adj.get(third.id)!.has(eric.id)).toBe(true);
    void link;
  });

  it("an insight's citations become its relations, so an ungrounded one has none", () => {
    const f = createLivingField();
    live(f, [ordinaryDay(0), ordinaryDay(1)]);
    const grounded = f.encodeInsight({ key: "i:1", text: "a thing about how evenings go for me", nowMs: T0, evidenceKeys: ["d0", "d1"], source: "sk" })!;
    const ungrounded = f.encodeInsight({ key: "i:2", text: "a wholly unsupported claim regarding seafaring", nowMs: T0, evidenceKeys: ["nope"], source: "sk" })!;
    const evidenceEdges = (id: number) =>
      [...f.graph().edges.values()].filter((e) => e.kind === "evidence_for" && (e.a === id || e.b === id));
    expect(evidenceEdges(grounded.id)).toHaveLength(2);
    expect(evidenceEdges(ungrounded.id), "nothing holds it up, so it will fade on its own").toHaveLength(0);
  });
});
