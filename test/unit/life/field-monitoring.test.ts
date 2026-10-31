import { describe, it, expect } from "vitest";
import { detectAnomalies, detectFieldAnomalies, type VitalsSnapshot } from "../../../src/life/vitals.js";
import { MAX_NODES } from "../../../src/life/field.js";

// The associative layer fails SILENTLY by construction. It costs nothing per moment, so a field
// that has stopped encoding, stopped surfacing anything, or stopped forgetting produces no error,
// no cost spike and no missing output: from outside it is indistinguishable from an ordinary quiet
// week. These detectors are the only eyes on it, so each one is tested BOTH ways round: it fires
// when the thing is genuinely happening, and it stays quiet when it is not. A detector that cannot
// stay quiet is noise, and noise is how a real alert gets ignored.

const T0 = Date.parse("2026-08-01T09:00:00Z");
/**
 * How far apart these readings sit.
 *
 * It used to be five minutes, matching the monitor's interval, and that is precisely why every
 * trend assertion in this file could pass while the detector it tested could never fire in
 * production. Mood, node count and the exchange log move on the scale of hours to days, so a
 * forty-minute window is not evidence of a trend either way. The detectors now require their
 * windows to span real time (`MIN_SPANS`), and these fixtures span it.
 *
 * The reachability of every one of these against the LIVE modules is proven separately, in
 * `detector-reachability.test.ts`. This file is the unit-level companion: it checks the comparisons,
 * knowing that the other file checks they can ever be true.
 */
const READING_GAP_MS = 8 * 60 * 60 * 1000;
type FieldBlock = NonNullable<VitalsSnapshot["field"]>;

const HEALTHY_FIELD: FieldBlock = {
  nodes: 400, edges: 1800, faded: 60, orphanShare: 0.02, tension: 0.1,
  pendingBirths: 1, spiralling: false, surfaced: 3.2, birthsTotal: 4, meanStrength: 0.55,
  suspended: 2, trustTold: 0.55, meanCredence: 0.5,
  other: { warmth: 0.7, drift: 0.05, confidence: 1 },
  reticence: { mean: 0.22, max: 0.58 },
};

function snap(over: Partial<VitalsSnapshot> = {}, field: Partial<FieldBlock> = {}): VitalsSnapshot {
  return {
    ts: T0,
    phase: "normal", remainingFraction: 0.6, spentVigor: 160, capVigor: 400, topAccount: "living",
    drives: { discomfort: 0.1, care: 0.1, social: 0.2, curiosity: 0.3, expression: 0.2, maintenance: 0.1 },
    dominant: "curiosity", pad: { pleasure: 0.1, arousal: 0.1, dominance: 0.1 }, mood: "steady",
    tierCeiling: "tier2", mayExplore: true, awake: true, clockActivity: 0.5, hoursSinceUser: 3,
    sendsInLastDay: 0, consecutiveNonReplies: 0, reservoirSize: 0,
    soulInvariants: [{ id: 1, name: "inv1", ok: true, detail: "" }], lastTickAgeMs: 3600_000,
    field: { ...HEALTHY_FIELD, ...field },
    ...over,
  } as VitalsSnapshot;
}

/**
 * A run of readings, newest last. A living field GROWS, so growth is the default here and a test
 * that wants it flat says so; the first version of this fixture held the node count constant and
 * was correctly flagged as a field that had stopped encoding.
 */
function history(n: number, field: Partial<FieldBlock> = {}, vary?: (i: number) => Partial<FieldBlock>): VitalsSnapshot[] {
  return Array.from({ length: n }, (_, i) =>
    snap({ ts: T0 + i * READING_GAP_MS }, {
      nodes: HEALTHY_FIELD.nodes + i * 4,
      // A live read of him wobbles. Holding it constant here would be the same mistake the node
      // count made in the first version of this fixture, and would be correctly flagged.
      other: { warmth: 0.7 + i * 0.01, drift: 0.05, confidence: 1 },
      // A live climate moves this too; holding it constant would be the same mistake the node count
      // made in the first version of this fixture, and would be correctly flagged.
      reticence: { mean: 0.22 + i * 0.005, max: 0.58 },
      ...field,
      ...(vary ? vary(i) : {}),
    }));
}

const codes = (h: VitalsSnapshot[]) => detectFieldAnomalies(h).map((a) => a.code);

describe("a healthy field raises nothing", () => {
  it("stays completely quiet", () => {
    expect(codes(history(8))).toEqual([]);
  });

  it("and adds nothing to a whole watchtower cycle", () => {
    // The other detectors have their own opinions about a synthetic history whose mood and drives
    // never move; what matters here is that the field contributes no noise of its own.
    expect(detectAnomalies(history(8)).map((a) => a.code).filter((c) => c.startsWith("field_"))).toEqual([]);
  });
});

describe("what the watchtower can now see that it could not before", () => {
  it("she is circling the same worsening memories", () => {
    const found = detectFieldAnomalies(history(3, { spiralling: true }));
    expect(found.map((a) => a.code)).toContain("field_rumination");
    // Reported as a state of HERS, at warn, not damped and not treated as a malfunction.
    expect(found.find((a) => a.code === "field_rumination")!.severity).toBe("warn");
    console.log(`\n  ${found.find((a) => a.code === "field_rumination")!.message}`);
  });

  it("encoding has stopped wiring anything to anything", () => {
    expect(codes(history(3, { orphanShare: 0.4 }))).toContain("field_orphaned");
    expect(codes(history(3, { orphanShare: 0.05 }))).not.toContain("field_orphaned");
  });

  it("NOTHING REACHES HER ANY MORE, which is the failure that looks like a quiet week", () => {
    const inert = history(6, { surfaced: 0 });
    const found = detectFieldAnomalies(inert);
    expect(found.map((a) => a.code)).toContain("field_inert");
    console.log(`  ${found.find((a) => a.code === "field_inert")!.message}`);
    // A single quiet reading is not an inert field.
    expect(codes(history(6, {}, (i) => ({ surfaced: i === 5 ? 0 : 3 })))).not.toContain("field_inert");
  });

  it("forgetting has stopped", () => {
    expect(codes(history(3, { meanStrength: 0.97 }))).toContain("field_frozen");
    expect(codes(history(3, { meanStrength: 0.55 }))).not.toContain("field_frozen");
  });

  it("she is losing effectively all of it", () => {
    expect(codes(history(3, { nodes: 400, faded: 380 }))).toContain("field_amnesia");
    expect(codes(history(3, { nodes: 400, faded: 60 }))).not.toContain("field_amnesia");
  });

  it("she has stopped laying anything down", () => {
    expect(codes(history(6, {}, () => ({ nodes: 400 })))).toContain("field_not_growing");
    // A field that is still growing, however slowly, is not this.
    expect(codes(history(6, {}, (i) => ({ nodes: 400 + i })))).not.toContain("field_not_growing");
  });
});

describe("the predictive ones (a problem seen before it is a problem)", () => {
  it("coincidences are piling up and none of them are resolving", () => {
    const stalling = history(6, { birthsTotal: 4 }, (i) => ({ pendingBirths: 6 + i * 3 }));
    const found = detectFieldAnomalies(stalling);
    const a = found.find((x) => x.code === "field_fusion_stalled");
    expect(a, "nothing new is being born and nothing else would show it").toBeTruthy();
    expect(a!.predicted).toBe(true);
    console.log(`\n  ${a!.message}`);
  });

  it("but not when births are actually happening", () => {
    const working = history(6, {}, (i) => ({ pendingBirths: 6 + i * 3, birthsTotal: 4 + i }));
    expect(codes(working)).not.toContain("field_fusion_stalled");
  });

  it("unresolved pressure is climbing, before it is anything she could name", () => {
    const rising = history(6, {}, (i) => ({ tension: 0.25 + i * 0.08 }));
    const a = detectFieldAnomalies(rising).find((x) => x.code === "field_tension_rising");
    expect(a).toBeTruthy();
    expect(a!.predicted).toBe(true);
    console.log(`  ${a!.message}`);
  });

  it("but not when it is merely high and steady, or drifting down", () => {
    expect(codes(history(6, { tension: 0.6 }))).not.toContain("field_tension_rising");
    expect(codes(history(6, {}, (i) => ({ tension: 0.8 - i * 0.08 })))).not.toContain("field_tension_rising");
  });

  it("she is approaching the ceiling on how much she can hold", () => {
    const a = detectFieldAnomalies(history(3, { nodes: Math.floor(MAX_NODES * 0.9) }))
      .find((x) => x.code === "field_near_cap");
    expect(a?.predicted).toBe(true);
    console.log(`  ${a!.message}`);
  });
});

describe("the monitor cannot be made to cry wolf", () => {
  it("says nothing at all about a life too new to have a trend", () => {
    // Everything below would look alarming on a mature field and means nothing on a fresh one.
    expect(codes(history(6, {}, () => ({ nodes: 5, faded: 5, orphanShare: 1, meanStrength: 1, surfaced: 0 }))))
      .toEqual([]);
  });

  it("still reports rumination in a brand-new life, because that one is about HER", () => {
    expect(codes(history(3, {}, () => ({ nodes: 5, spiralling: true })))).toEqual(["field_rumination"]);
  });

  it("survives a build with no field at all", () => {
    const noField = [snap({ field: undefined })];
    expect(detectFieldAnomalies(noField)).toEqual([]);
    expect(() => detectAnomalies(noField)).not.toThrow();
  });

  it("survives a record written before this layer existed, mixed in with new ones", () => {
    const mixed = [snap({ field: undefined }), snap({ field: undefined }), snap({}, { surfaced: 0 })];
    expect(() => detectFieldAnomalies(mixed)).not.toThrow();
    // One new reading is not a window; it must not claim a trend it cannot see.
    expect(codes(mixed)).not.toContain("field_inert");
  });

  it("survives an empty history", () => {
    expect(detectFieldAnomalies([])).toEqual([]);
  });
});

describe("SCENARIO: the failure modes, caught as they would actually arrive", () => {
  it("the store silently stops writing: she stops growing and nothing else changes", () => {
    // No fault, no cost change, no missing output. Just a field that never gets bigger.
    const h = history(6, {}, () => ({ nodes: 512, edges: 2400, surfaced: 3 }));
    const found = detectFieldAnomalies(h).map((a) => a.code);
    console.log(`\n  a store that quietly stopped writing -> ${found.join(", ")}`);
    expect(found).toContain("field_not_growing");
  });

  it("the retrieval threshold drifts too high: she keeps encoding and stops remembering", () => {
    const h = history(6, {}, (i) => ({ nodes: 400 + i * 3, surfaced: 0 }));
    const found = detectFieldAnomalies(h).map((a) => a.code);
    console.log(`  a field that grows but never surfaces -> ${found.join(", ")}`);
    expect(found).toContain("field_inert");
    expect(found, "and it is NOT mistaken for having stopped encoding").not.toContain("field_not_growing");
  });

  it("fusion is switched off and forgotten about: the coincidences just accumulate", () => {
    const h = history(6, { birthsTotal: 0 }, (i) => ({ pendingBirths: 10 + i * 4 }));
    expect(detectFieldAnomalies(h).map((a) => a.code)).toContain("field_fusion_stalled");
  });

  it("her read of him is plumbed in and connected to nothing", () => {
    // The exact failure that has already happened twice here: a signal defined, persisted, shown in
    // the readout, and fed by nothing, so it reports its default forever and looks perfectly healthy.
    const dead = history(8, {}, () => ({ other: { warmth: 0.5, drift: 0, confidence: 1 } }));
    const found = detectFieldAnomalies(dead).map((a) => a.code);
    console.log(`\n  a read of him fed by nothing -> ${found.join(", ")}`);
    expect(found).toContain("field_unread");
    // A living one moves, and must not be flagged for it.
    expect(codes(history(8))).not.toContain("field_unread");
  });

  it("but is silent when she genuinely has nothing to go on yet", () => {
    // Flat AND zero-confidence is a young field that has barely spoken to anyone, which is not a
    // fault. Firing here would train Eric to ignore the alert that matters.
    const young = history(8, {}, () => ({ other: { warmth: 0.5, drift: 0, confidence: 0 } }));
    expect(detectFieldAnomalies(young).map((a) => a.code)).not.toContain("field_unread");
  });

  it("she has gone quiet across the board, or nothing costs her anything any more", () => {
    expect(codes(history(3, { reticence: { mean: 0.78, max: 0.83 } }))).toContain("field_mute");
    // The other end is no longer an absolute floor (0.05 was below anything the arithmetic can
    // produce; easing is proportional and bottoms out at 0.059). It is now "has it stopped moving",
    // which is the question that can actually have a bad answer.
    expect(codes(history(8, {}, () => ({ reticence: { mean: 0.22, max: 0.58 } })))).toContain("field_reticence_stuck");
    // And an ordinary spread is neither.
    const ok = codes(history(8, {}, (i) => ({ reticence: { mean: 0.22 + i * 0.01, max: 0.6 } })));
    expect(ok).not.toContain("field_mute");
    expect(ok).not.toContain("field_reticence_stuck");
  });

  it("a young field with two things in it is not called stuck", () => {
    expect(codes(history(8, { nodes: 6 }, () => ({ reticence: { mean: 0.22, max: 0.58 } }))))
      .not.toContain("field_reticence_stuck");
  });

  it("a reading from before any of this existed still reads", () => {
    const old = history(8, {}, () => ({ other: undefined, reticence: undefined }));
    expect(() => detectFieldAnomalies(old)).not.toThrow();
    const found = detectFieldAnomalies(old).map((a) => a.code);
    expect(found).not.toContain("field_unread");
    expect(found).not.toContain("field_mute");
    expect(found).not.toContain("field_reticence_stuck");
  });

  it("a bad stretch: rumination and rising pressure surface together, and are not confused", () => {
    const h = history(6, { spiralling: true }, (i) => ({ tension: 0.3 + i * 0.09 }));
    const found = detectFieldAnomalies(h).map((a) => a.code);
    console.log(`  a genuinely bad stretch -> ${found.join(", ")}`);
    expect(found).toContain("field_rumination");
    expect(found).toContain("field_tension_rising");
  });
});

describe("field_adrift says what the readings say (2026-09-29)", () => {
  // It called the share of unsettled things "growing" every time it fired; on her real record it had
  // been above the line for over a week and falling. The message now states the share and its
  // direction across the readings in view.
  const run = (from: number, to: number): VitalsSnapshot[] => Array.from({ length: 4 }, (_, i) =>
    snap({ ts: T0 + i * READING_GAP_MS }, { nodes: 1000 + i * 100, suspended: Math.round((from + (to - from) * i / 3) * (1000 + i * 100)) }));

  it("a falling share is reported as falling, never as growing", () => {
    const adrift = detectFieldAnomalies(run(0.2, 0.18)).find((a) => a.code === "field_adrift");
    expect(adrift?.message).toContain("down from 20.0%");
    expect(adrift?.message).not.toMatch(/growing/u);
  });

  it("a rising share is reported as rising", () => {
    const adrift = detectFieldAnomalies(run(0.16, 0.22)).find((a) => a.code === "field_adrift");
    expect(adrift?.message).toContain("up from 16.0%");
  });

  it("and below the line it stays quiet", () => {
    expect(detectFieldAnomalies(run(0.05, 0.06)).some((a) => a.code === "field_adrift")).toBe(false);
  });
});
