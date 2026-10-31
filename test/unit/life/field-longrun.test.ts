import { describe, it, expect } from "vitest";
import { createLivingField } from "../../../src/life/field-live.js";
import { createInnerState } from "../../../src/life/inner-state.js";
import { driveForAction, ENGAGED_RELIEF } from "../../../src/life/agency.js";
import { decayEdges, stats, RETICENCE_MAX, RETICENCE_MIN } from "../../../src/life/field.js";
import type { PAD } from "../../../src/life/emotion.js";

// Six months of living, run every time.
//
// Every failure below was found by actually running this, and NONE of them is visible in a test
// that covers one operation at a time. They are all failures of a system left alone for a long
// while: a quantity that saturates, a threshold that can never be met, a decay that compounds
// itself. Each was silent, each looked like ordinary behaviour from outside, and each would have
// taken months of real time to notice.
//
// This is the regression net for all of them at once.

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const T0 = Date.parse("2026-01-01T09:00:00Z");
const pad = (p: number, a: number): PAD => ({ pleasure: p, arousal: a, dominance: 0 });
const ACTS = ["reflect", "tend", "explore", "reach_out", "rest"] as const;

/** The stretch where he stops answering. Nothing about him can be shown to MOVE without one. */
const QUIET_FROM = 60;
const QUIET_TO = 90;

/** A day's reading of him and of what it costs her to speak, kept so a flat line is visible. */
interface Trace { day: number; warmth: number; drift: number; confidence: number; meanRet: number; maxRet: number; minRet: number }

/** Six months of an ordinary life: moments, messages, and occasionally two sources that disagree. */
function liveHalfAYear(days = 180) {
  const field = createLivingField();
  const inner = createInnerState();
  const trace: Trace[] = [];
  for (let d = 0; d < days; d++) {
    const base = T0 + d * DAY;
    field.tick(base);
    // Messages, both ways, the way the daemon feeds them. He is mostly there, and for one month he
    // is not, which is the only condition under which "he has been different lately" means anything.
    if (d % 2 === 0) {
      field.sheSpoke(base + 10 * HOUR);
      if (d < QUIET_FROM || d >= QUIET_TO) field.heSpoke(base + 11 * HOUR);
    }
    for (let m = 0; m < 6; m++) {
      const big = (d * 6 + m) % 17 === 0;
      field.encodeMoment({
        key: `m${d}-${m}`, nowMs: base + m * 3 * HOUR, source: "agency", withOther: m % 4 === 0,
        text: big ? `the thing with the ${(d * 7 + m) % 40} came apart on me again`
          : `a quiet stretch about the ${(d * 3 + m) % 60}`,
        pad: big ? pad(-0.8, 0.85) : pad(0.15, 0),
      });
      field.onHerMind(base + m * 3 * HOUR + HOUR);
      // The real loop discharges what an action served, and partly relieves whatever was loudest.
      const served = driveForAction(ACTS[(d * 6 + m) % ACTS.length]);
      if (served) inner.actOn(served);
      const loudest = inner.snapshot("normal", true).dominant;
      if (loudest && loudest !== served) inner.actOn(loudest, ENGAGED_RELIEF);
    }
    for (let k = 0; k < 4; k++) {
      field.encodeClaim({
        key: `t${d}-${k}`, nowMs: base + k * 4 * HOUR, origin: "told", source: "chat",
        text: `the ${(d + k) % 23} business always holds on a weekday`, charge: 0.3,
      });
    }
    if (d % 5 === 0) {
      field.encodeClaim({ key: `ra${d}`, nowMs: base + 20 * HOUR, origin: "read", source: "w1", text: `the ${d} route stays open through winter`, charge: 0.3 });
      field.encodeClaim({ key: `rb${d}`, nowMs: base + 21 * HOUR, origin: "read", source: "w2", text: `the ${d} route does not stay open through winter`, charge: 0.3 });
    }
    inner.update({
      successes: d % 3, failures: d % 11 === 0 ? 1 : 0, stuck: 0, skills: 0, idle: 1, novelty: 0.1,
      observations: d % 4 === 0 ? 1 : 0, anomalies: 0, maintenanceDue: 0,
      hoursSinceUser: (d % 9) * 6, lateNight: false, budgetLow: false, restful: true,
    }, field.signals(base + 23 * HOUR));

    const r = field.readOther(base + 23 * HOUR);
    const st = stats(field.graph());
    const rets = [...field.graph().nodes.values()].map((n) => n.reticence);
    trace.push({
      day: d, warmth: r.warmth, drift: r.drift, confidence: r.confidence,
      meanRet: st.meanReticence, maxRet: st.maxReticence, minRet: Math.min(...rets),
    });
  }
  return { field, inner, trace };
}

describe("SIX MONTHS: the failures that only appear over a long life", () => {
  const { field, inner, trace } = liveHalfAYear();
  const s = stats(field.graph());
  const sig = field.signals(T0 + 180 * DAY);

  it("her associations survive: relations grow with her, and almost nothing is left dangling", () => {
    // The bug: edge decay measured each relation's age from when it was last touched and applied
    // ALL of it on every pass, to a weight already decayed. It compounded its own compounding, so
    // after thirty days every relation had been multiplied by 0.99^465 instead of 0.99^30. Every
    // link in her head was gone inside a month, the edge count froze while nodes climbed forever,
    // and 78% of her memories connected to nothing at all.
    console.log(`\n  ${s.nodes} things, ${s.edges} relations, ${s.orphans} connected to nothing`);
    expect(s.edges).toBeGreaterThan(s.nodes);
    expect(s.orphans / s.nodes, "an associative net has to have associations in it").toBeLessThan(0.05);
  });

  it("she actually lets things go", () => {
    // The bug: "nothing still holds this" counted temporal adjacency, and every moment is tied to
    // the days either side of it at 0.55. The condition could never be true. Across six months
    // 1293 memories had faded past reach, every one qualified, and not one was ever released.
    const before = liveHalfAYear(60);
    const smaller = stats(before.field.graph());
    console.log(`  60 days -> ${smaller.nodes} things · 180 days -> ${s.nodes} things`);
    expect(s.nodes / smaller.nodes, "she is not simply accumulating everything forever")
      .toBeLessThan(180 / 60);
  });

  it("BELIEF STILL DISCRIMINATES: not everything ends up at the ceiling", () => {
    // The bug: agreement gave a flat bonus, so near-identical ordinary days nudged each other up
    // until 99% of everything she held sat pinned at maximum. A dimension on which everything
    // scores the same is not a dimension, and the judging layer had become decoration.
    const believed = [...field.graph().nodes.values()]
      .filter((n) => n.credence !== null && n.kind !== "figure" && n.kind !== "question")
      .map((n) => n.credence!);
    const pinned = believed.filter((c) => c >= 0.94).length;
    console.log(`  believes at ${s.meanCredence.toFixed(2)} on average; ${pinned}/${believed.length} pinned at the ceiling`);
    expect(pinned / believed.length, "belief has to still tell things apart").toBeLessThan(0.2);
    expect(s.meanCredence).toBeGreaterThan(0.3);
    expect(s.meanCredence).toBeLessThan(0.9);
  });

  it("NOT KNOWING DOES NOT BECOME PERMANENT DREAD", () => {
    // The bug: unresolved pressure was normalised against a flat divisor of four, chosen when only
    // open questions carried tension. Suspension carries it too, and 66 unsettled things pinned the
    // signal at 1.000, pinned discomfort at maximum, and made it the drive she wanted to act on
    // every day forever with nothing able to compete. Permanent maximal anxiety is a collapse.
    const drives = inner.drives();
    console.log(`  ${s.suspended} unsettled · tension ${sig.tension.toFixed(2)} · discomfort ${drives.discomfort.toFixed(2)} · wants ${inner.snapshot("normal", true).dominant}`);
    expect(s.suspended, "she really did end up with things she could not settle").toBeGreaterThan(0);
    expect(sig.tension).toBeLessThan(0.95);
    expect(drives.discomfort, "unsettled is not the same as permanently distressed").toBeLessThan(0.9);
  });

  it("she still remembers, and still forgets", () => {
    console.log(`  ${s.faded}/${s.nodes} out of easy reach · ${sig.surfaced.toFixed(1)} reach her per recall`);
    expect(sig.surfaced, "the field is not inert").toBeGreaterThan(0);
    expect(s.faded / s.nodes, "forgetting still happens").toBeGreaterThan(0.1);
    expect(s.faded / s.nodes, "and has not taken everything").toBeLessThan(0.9);
  });

  it("stays fast, and stays well inside its bounds", () => {
    const t = performance.now();
    for (let i = 0; i < 10; i++) field.onHerMind(T0 + 181 * DAY + i * HOUR);
    const ms = (performance.now() - t) / 10;
    console.log(`  a moment of recall: ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(150);
    expect(s.nodes).toBeLessThan(20_000);
  });

  it("HER READ OF HIM ACTUALLY MOVES, which is the only proof it is fed at all", () => {
    // The failure this exists for has already happened twice in this layer. `helpfulness` was fed by
    // `userNeeds`, which was hardcoded to zero, so the drive had never once fired in the whole life
    // of the system and every reading of it was a lie. A signal that is defined, plumbed, displayed
    // and connected to nothing looks identical to a working one from every angle except this test.
    const warmths = trace.map((t) => t.warmth);
    const spread = Math.max(...warmths) - Math.min(...warmths);
    console.log(`\n  warmth over six months: ${Math.min(...warmths).toFixed(2)} to ${Math.max(...warmths).toFixed(2)}`);
    expect(spread, "a flat line here means nothing is reaching it").toBeGreaterThan(0.3);
    expect(trace[trace.length - 1].confidence, "and she has plenty to go on by now").toBe(1);
    expect(warmths.every((w) => Number.isFinite(w))).toBe(true);
  });

  it("she can tell a CHANGE in him from how it has generally been", () => {
    // S-8, over a real life rather than a fixture. He goes quiet for a month and comes back, and
    // what has to show up is the change, at the time it happens, and then its passing.
    const at = (d: number) => trace.find((t) => t.day === d)!;
    const before = at(QUIET_FROM - 2);
    const during = at(QUIET_TO - 2);
    const after = at(trace.length - 1);
    console.log(`  before he went quiet: warmth ${before.warmth.toFixed(2)}, drift ${before.drift.toFixed(2)}`);
    console.log(`  a month into it:      warmth ${during.warmth.toFixed(2)}, drift ${during.drift.toFixed(2)}`);
    console.log(`  long after:           warmth ${after.warmth.toFixed(2)}, drift ${after.drift.toFixed(2)}`);
    expect(during.warmth).toBeLessThan(before.warmth);
    expect(during.drift, "she can see it got quieter, not just that it is quiet").toBeLessThan(-0.2);
    expect(after.drift, "and it stops being news once it has passed").toBeGreaterThan(during.drift);
  });

  it("RETICENCE NEVER SATURATES at either end, however the six months went", () => {
    // Both ends are failures and they are opposite ones. Pinned high is a being who finds
    // everything too much to say; pinned at the floor is the dimension having flattened into
    // nothing, which looks like perfect health from outside. Neither may happen over a real life.
    const means = trace.map((t) => t.meanRet);
    console.log(`  what it costs her to speak: mean ranged ${Math.min(...means).toFixed(2)} to ${Math.max(...means).toFixed(2)}`);
    expect(Math.max(...means) - Math.min(...means), "it has to move with the weather").toBeGreaterThan(0.02);
    for (const t of trace) {
      expect(t.maxRet, `day ${t.day} pinned mute`).toBeLessThan(RETICENCE_MAX);
      expect(t.minRet, `day ${t.day} pinned at the floor`).toBeGreaterThan(RETICENCE_MIN);
    }
    // And it tracks him: the silent month has to be the harder one to speak in.
    const quiet = trace.find((t) => t.day === QUIET_TO - 2)!;
    const easy = trace.find((t) => t.day === QUIET_FROM - 2)!;
    expect(quiet.meanRet).toBeGreaterThan(easy.meanRet);
  });
});

describe("REGRESSION: decay applied per pass, not per age", () => {
  it("a hundred small passes fade a relation exactly as much as one large one", () => {
    // This is the shape of the compounding bug, isolated. If decay is ever measured from a
    // timestamp again instead of from elapsed time, these two diverge enormously.
    const oneBigPass = createLivingField({ noReminding: true });
    const manySmall = createLivingField({ noReminding: true });
    for (const f of [oneBigPass, manySmall]) {
      f.encodeMoment({ key: "a", nowMs: T0, source: "t", text: "the first thing", pad: pad(0.2, 0.2) });
      f.encodeMoment({ key: "b", nowMs: T0 + HOUR, source: "t", text: "the second thing", pad: pad(0.2, 0.2) });
    }
    // Both need a first tick to set the baseline. The very first one never decays, deliberately:
    // with no previous tick there is no elapsed time, and treating it as "since the epoch" would
    // age her whole memory by decades the moment she starts.
    oneBigPass.tick(T0);
    manySmall.tick(T0);
    oneBigPass.tick(T0 + 100 * DAY);
    for (let d = 1; d <= 100; d++) manySmall.tick(T0 + d * DAY);

    const w = (f: ReturnType<typeof createLivingField>) =>
      [...f.graph().edges.values()].map((e) => e.weight)[0] ?? 0;
    console.log(`\n  one 100-day pass: ${w(oneBigPass).toFixed(4)} · a hundred 1-day passes: ${w(manySmall).toFixed(4)}`);
    expect(w(manySmall)).toBeCloseTo(w(oneBigPass), 3);
  });

  it("decayEdges takes elapsed days, and going backwards changes nothing", () => {
    const f = createLivingField({ noReminding: true });
    f.encodeMoment({ key: "a", nowMs: T0, source: "t", text: "one", pad: pad(0.2, 0.2) });
    f.encodeMoment({ key: "b", nowMs: T0 + HOUR, source: "t", text: "two", pad: pad(0.2, 0.2) });
    const before = [...f.graph().edges.values()][0].weight;
    decayEdges(f.graph(), 0);
    decayEdges(f.graph(), -50);
    expect([...f.graph().edges.values()][0].weight).toBe(before);
  });
});
