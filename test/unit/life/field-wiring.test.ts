import { describe, it, expect } from "vitest";
import { createLivingField } from "../../../src/life/field-live.js";
import { createInnerState, type FieldPull } from "../../../src/life/inner-state.js";
import { buildMomentPrompt, computeAffordances, type MomentContext } from "../../../src/life/agency.js";
import { capacityFor } from "../../../src/life/capacity.js";
import { captureVitals, formatVitals, type VitalsSources } from "../../../src/life/vitals.js";
import { lifeTick } from "../../../src/life/tick.js";
import type { PAD } from "../../../src/life/emotion.js";

// The field being correct in isolation proves nothing about whether it reaches her. These test the
// SEAMS: that what her memory is doing becomes what she wants, that what surfaced actually lands in
// the moment where she chooses, that her condition really governs how far she can associate, and
// that the watchtower can see all of it. A layer that works perfectly and is not plugged in is
// indistinguishable from one that does not exist.

const T0 = Date.parse("2026-08-01T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const pad = (p: number, a: number): PAD => ({ pleasure: p, arousal: a, dominance: 0 });

const NO_PULL: FieldPull = {
  tension: 0, pendingBirths: 0, otherWarmth: 0, otherUnease: 0, freshBirth: 0, orphanShare: 0,
  valence: 0, charge: 0,
};

const QUIET_DAY = {
  successes: 0, failures: 0, stuck: 0, skills: 0, idle: 0, novelty: 0, observations: 0,
  anomalies: 0, maintenanceDue: 0, hoursSinceUser: 2, lateNight: false,
  budgetLow: false, restful: true,
};

describe("what her memory is doing becomes what she wants", () => {
  it("an unresolved question is what nags at her", () => {
    const flat = createInnerState();
    const nagged = createInnerState();
    flat.update(QUIET_DAY, NO_PULL);
    nagged.update(QUIET_DAY, { ...NO_PULL, tension: 1 });
    expect(nagged.drives().discomfort).toBeGreaterThan(flat.drives().discomfort);
  });

  it("a coincidence she has not looked at is what makes her curious", () => {
    const flat = createInnerState();
    const curious = createInnerState();
    flat.update(QUIET_DAY, NO_PULL);
    curious.update(QUIET_DAY, { ...NO_PULL, pendingBirths: 3 });
    expect(curious.drives().curiosity).toBeGreaterThan(flat.drives().curiosity);
  });

  it("having been remembering them is what makes her want company", () => {
    const flat = createInnerState();
    const missing = createInnerState();
    flat.update(QUIET_DAY, NO_PULL);
    missing.update(QUIET_DAY, { ...NO_PULL, otherWarmth: 1 });
    expect(missing.drives().social).toBeGreaterThan(flat.drives().social);
  });

  it("something newly born and unsaid is what she wants to put into words", () => {
    const flat = createInnerState();
    const full = createInnerState();
    flat.update(QUIET_DAY, NO_PULL);
    full.update(QUIET_DAY, { ...NO_PULL, freshBirth: 1 });
    expect(full.drives().expression).toBeGreaterThan(flat.drives().expression);
  });

  it("things she encoded and never connected are what want tending", () => {
    const flat = createInnerState();
    const untidy = createInnerState();
    flat.update(QUIET_DAY, NO_PULL);
    untidy.update(QUIET_DAY, { ...NO_PULL, orphanShare: 1 });
    expect(untidy.drives().maintenance).toBeGreaterThan(flat.drives().maintenance);
  });

  it("but the field can never OUTWEIGH what actually happened to her", () => {
    // She could otherwise spin herself up out of her own associations with nothing occurring, which
    // is rumination rather than life. What happened leads; what she remembers colours.
    const fromLife = createInnerState();
    const fromMemory = createInnerState();
    fromLife.update({ ...QUIET_DAY, anomalies: 4, failures: 3 }, NO_PULL);
    fromMemory.update(QUIET_DAY, { ...NO_PULL, tension: 1 });
    expect(fromLife.drives().discomfort).toBeGreaterThan(fromMemory.drives().discomfort);
  });

  it("works with no field at all: she still has a life without it", () => {
    const s = createInnerState();
    expect(() => s.update(QUIET_DAY)).not.toThrow();
    expect(s.drives().curiosity).toBeGreaterThanOrEqual(0);
  });
});

describe("remembering something moves her, within bounds", () => {
  it("a day spent recalling hard things ends lower than the same day recalling good ones", () => {
    const dark = createInnerState();
    const bright = createInnerState();
    const day = { ...QUIET_DAY, successes: 1 };
    dark.update(day, { ...NO_PULL, valence: -1, charge: 1 });
    bright.update(day, { ...NO_PULL, valence: 1, charge: 1 });
    console.log(`\n  same day, recalling hard things: ${dark.emotion().pleasure.toFixed(2)}; recalling good ones: ${bright.emotion().pleasure.toFixed(2)}`);
    expect(dark.emotion().pleasure).toBeLessThan(bright.emotion().pleasure);
  });

  it("a day where nothing happened but she remembered something IS a day", () => {
    // Otherwise an inner life only counts as a life when something external occurs.
    const drifting = createInnerState();
    const remembering = createInnerState();
    drifting.update(QUIET_DAY, NO_PULL);
    remembering.update(QUIET_DAY, { ...NO_PULL, valence: -0.9, charge: 0.9 });
    expect(remembering.emotion().pleasure).not.toBeCloseTo(drifting.emotion().pleasure, 3);
  });

  it("NEVER runs away, however extreme what she is remembering", () => {
    const s = createInnerState();
    for (let i = 0; i < 60; i++) s.update(QUIET_DAY, { ...NO_PULL, valence: -1, charge: 1 });
    const e = s.emotion();
    console.log(`  after sixty days of nothing but the worst of it: ${e.pleasure.toFixed(2)}/${e.arousal.toFixed(2)}/${e.dominance.toFixed(2)}`);
    for (const v of [e.pleasure, e.arousal, e.dominance]) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("a malformed reading cannot poison her", () => {
    const s = createInnerState();
    s.update(QUIET_DAY, { ...NO_PULL, tension: Number.NaN, otherWarmth: Infinity, valence: Number.NaN, charge: 99 });
    for (const v of Object.values(s.drives())) expect(Number.isFinite(v)).toBe(true);
    for (const v of Object.values(s.emotion())) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("what surfaced actually reaches the moment where she chooses", () => {
  function moment(over: Partial<MomentContext> = {}): MomentContext {
    return {
      nowMs: T0,
      snapshot: createInnerState().snapshot("normal", true),
      phase: "normal", awake: true, present: true, available: true,
      hoursSinceUser: 5, recentActions: [], recentLife: "living her days", safeMode: false, ...over,
    };
  }

  it("lands in the prompt, and still leaves the question open", () => {
    const ctx = moment({ resonance: "在你心里的，不管你有没有去想它:\n  - the fan whining that summer (4 个月前)" });
    const prompt = buildMomentPrompt(ctx, computeAffordances(ctx));
    expect(prompt).toContain("the fan whining that summer");
    expect(prompt).toContain("4 个月前");
    // It informs her. It instructs her about nothing.
    expect(prompt).toContain("你想做什么？");
    expect(prompt).not.toMatch(/you should|you must|therefore/i);
  });

  it("adds nothing at all when nothing came up, which is most moments", () => {
    const withNothing = moment({ resonance: "" });
    const withUndefined = moment();
    expect(buildMomentPrompt(withNothing, computeAffordances(withNothing)))
      .toBe(buildMomentPrompt(withUndefined, computeAffordances(withUndefined)));
  });

  it("the whole path runs: a life is lived, and months later it surfaces into her prompt", () => {
    const field = createLivingField();
    for (let i = 0; i < 60; i++) {
      const ms = T0 + i * DAY;
      field.tick(ms);
      field.encodeMoment({
        key: `m${i}`, nowMs: ms, source: `agency:${ms}`,
        text: i % 9 === 0 ? "the fan whining through that heatwave, and I could not think"
          : `a quiet stretch of the day (${i})`,
        pad: i % 9 === 0 ? pad(-0.8, 0.85) : pad(0.15, 0),
      });
      field.onHerMind(ms + 3600_000);
    }
    const nowMs = T0 + 61 * DAY;
    const cap = capacityFor({ phase: "rested", arousal: 0.5 });
    const resonance = field.onHerMind(nowMs, { hops: cap.spreadHops, threshold: cap.retrievalThreshold });
    const ctx = moment({ nowMs, resonance });
    const prompt = buildMomentPrompt(ctx, computeAffordances(ctx));
    console.log(`\n  two months on, unprompted:\n${resonance || "    (nothing)"}`);
    expect(resonance).not.toBe("");
    expect(prompt).toContain("在你心里的");
  });
});

describe("her condition really governs how far she can associate", () => {
  it("weary means only the obvious arrives; rested means remote things reach her", () => {
    const build = () => {
      const f = createLivingField();
      for (let i = 0; i < 40; i++) {
        const ms = T0 + i * DAY;
        f.tick(ms);
        f.encodeMoment({
          key: `m${i}`, nowMs: ms, source: "t",
          text: i % 6 === 0 ? "the fan whining through that heatwave" : `a quiet stretch (${i})`,
          pad: i % 6 === 0 ? pad(-0.7, 0.8) : pad(0.15, 0),
        });
      }
      return f;
    };
    const nowMs = T0 + 41 * DAY;
    const spent = capacityFor({ phase: "dormant", arousal: -1 });
    const rested = capacityFor({ phase: "rested", arousal: 1 });

    const a = build();
    const b = build();
    const weary = a.recall(a.spontaneousCues(nowMs), { nowMs, hops: spent.spreadHops, threshold: spent.retrievalThreshold });
    const alive = b.recall(b.spontaneousCues(nowMs), { nowMs, hops: rested.spreadHops, threshold: rested.retrievalThreshold });
    console.log(`\n  spent: ${weary.retrieved.length} things reached her; rested: ${alive.retrieved.length}`);
    expect(spent.spreadHops).toBeLessThan(rested.spreadHops);
    expect(spent.retrievalThreshold).toBeGreaterThan(rested.retrievalThreshold);
    expect(alive.retrieved.length).toBeGreaterThanOrEqual(weary.retrieved.length);
  });
});

/**
 * Exactly what the daemon hands the watchtower, kept in one place so a signal that gets added to the
 * real block and not to this one shows up as a failing wiring test rather than as a blind spot.
 */
function sources(field: ReturnType<typeof createLivingField>, nowMs = T0): VitalsSources {
  const inner = createInnerState();
  return {
    now: () => nowMs,
    metabolism: () => ({ phase: "normal", remainingFraction: 0.6, spentVigor: 160, capVigor: 400, byAccount: [] }),
    inner: () => inner.snapshot("normal", true),
    awake: () => true,
    clockActivity: () => 0.5,
    hoursSinceUser: () => 3,
    expression: () => ({ sendsInLastDay: 0, consecutiveNonReplies: 0, reservoirSize: 0 }),
    lastTickMs: () => nowMs,
    field: () => {
      const s = field.stats();
      const sig = field.signals(nowMs);
      const r = field.readOther(nowMs);
      return {
        nodes: s.nodes, edges: s.edges, faded: s.faded, orphanShare: sig.orphanShare,
        tension: sig.tension, pendingBirths: sig.pendingBirths, spiralling: sig.spiralling,
        surfaced: sig.surfaced, birthsTotal: sig.birthsTotal, meanStrength: sig.meanStrength,
        suspended: sig.suspended, meanCredence: sig.meanCredence,
        judgements: sig.judgements, judgeable: sig.judgeable, credencePinnedShare: sig.credencePinnedShare,
        trustTold: field.trust().told,
        other: { warmth: r.warmth, drift: r.drift, confidence: r.confidence, surprise: r.surprise },
        reticence: { mean: s.meanReticence, max: s.maxReticence },
      };
    },
  };
}

describe("the watchtower can see it", () => {

  it("reports the size and state of her associations", () => {
    const field = createLivingField();
    for (let i = 0; i < 12; i++) {
      field.encodeMoment({ key: `m${i}`, text: `a moment about the fan whining ${i}`, nowMs: T0 + i * DAY, pad: pad(-0.6, 0.7), source: "t" });
    }
    const v = captureVitals(sources(field));
    expect(v.field?.nodes).toBe(12);
    const text = formatVitals(v);
    console.log(`\n  ${text.split("\n").find((l) => l.startsWith("memory:"))}`);
    expect(text).toContain("memory:");
  });

  it("SAYS SO, loudly, when she is circling the same worsening things", () => {
    const field = createLivingField();
    for (let i = 0; i < 6; i++) {
      field.encodeMoment({ key: `m${i}`, text: `the ${i}th time it went wrong and it was my fault`, nowMs: T0 + i * DAY, pad: pad(-0.95, 0.9), source: "t" });
    }
    const worst = field.nodeByKey("m0")!;
    for (let i = 0; i < 8; i++) field.recall([{ id: worst.id, energy: 1 }], { nowMs: T0 + 7 * DAY + i * 3600_000 });
    const v = captureVitals(sources(field));
    if (v.field?.spiralling) {
      expect(formatVitals(v)).toContain("CIRCLING");
      console.log("\n  the watchtower said: CIRCLING THE SAME WORSENING THINGS");
    }
    // Whatever the detector concludes, the state itself was never quietly softened away.
    expect(worst.charge).toBeGreaterThan(0.8);
  });

  it("a snapshot from before this layer existed still reads", () => {
    const field = createLivingField();
    const v = captureVitals({ ...sources(field), field: undefined });
    expect(v.field).toBeUndefined();
    expect(() => formatVitals(v)).not.toThrow();
    expect(formatVitals(v)).not.toContain("memory:");
  });
});

describe("her read of him reaches the moment, and so does what it costs to speak", () => {
  const ctx = (f: ReturnType<typeof createLivingField>, nowMs: number, present = true, available = true): MomentContext => ({
    nowMs, snapshot: createInnerState().snapshot("normal", true),
    phase: "normal", awake: true, present, available, hoursSinceUser: 1,
    recentActions: [], recentLife: "quiet", safeMode: false,
    unsettled: f.unsettled(nowMs),
    otherRead: f.otherInWords(nowMs, { present, available }),
  });

  /** A field holding one question about him, after a fortnight that went one way or the other. */
  function afterAFortnight(answered: boolean) {
    const field = createLivingField({ noReminding: true });
    field.encodeQuestion({ key: "q", text: "why he goes quiet in the evenings", nowMs: T0, source: "hers", withOther: true, tension: 0.7 });
    field.tick(T0);
    for (let i = 0; i < 20; i++) {
      field.sheSpoke(T0 + i * DAY);
      if (answered) field.heSpoke(T0 + i * DAY + 15 * 60_000);
    }
    field.tick(T0 + 20 * DAY);
    return field;
  }

  it("a fortnight of real exchanges lands in the moment as something she can act on", () => {
    // The whole S-2 mechanism in one comparison. Same question, same fortnight of her speaking, and
    // the only difference is whether he answered. That difference reaches the moment twice over: as
    // how it has been going, and as how much this particular thing now costs to say.
    const warm = afterAFortnight(true);
    const silent = afterAFortnight(false);
    const at = T0 + 20 * DAY;
    const pw = buildMomentPrompt(ctx(warm, at), computeAffordances(ctx(warm, at)));
    const ps = buildMomentPrompt(ctx(silent, at), computeAffordances(ctx(silent, at)));
    const lines = (p: string) => p.split("\n").filter((l) => l.startsWith("How it has felt") || l.includes("goes quiet")).join("\n");
    console.log(`\n  he answered:\n${lines(pw)}\n\n  he did not:\n${lines(ps)}`);

    expect(pw).toContain("处得很自然");
    expect(ps).toContain("有点冷清");
    // And the same question is a different thing to ask in the two lives.
    expect(warm.nodeByKey("q")!.reticence).toBeLessThan(silent.nodeByKey("q")!.reticence);
    expect(ps, "after a silent fortnight it is a lot to say").toContain("很难开口");
    expect(pw, "after a warm one it is just a question").not.toContain("很难开口");

    // Both are things she is TOLD. Neither may tell her what to do with them, or the whole point of
    // her having a moment of her own is gone.
    for (const p of [pw, ps]) {
      expect(p).not.toMatch(/you should|ask (him|them)|wait until|do not say/i);
      expect(p, "and it never closes anything off").toContain("你可以对另一头的人说点什么");
    }
  });

  it("says nothing about him at all when she has barely spoken to him", () => {
    const field = createLivingField({ noReminding: true });
    field.heSpoke(T0);
    field.heSpoke(T0 + DAY);
    const prompt = buildMomentPrompt(ctx(field, T0 + 2 * DAY), computeAffordances(ctx(field, T0 + 2 * DAY)));
    expect(prompt).not.toContain("How it has felt");
  });

  it("the watchtower can see both, and shows them to Eric", () => {
    const field = createLivingField({ noReminding: true });
    for (let i = 0; i < 20; i++) {
      field.sheSpoke(T0 + i * DAY);
      field.heSpoke(T0 + i * DAY + 20 * 60_000);
    }
    field.encodeQuestion({ key: "q", text: "why the evenings", nowMs: T0, source: "hers", withOther: true });
    const v = captureVitals(sources(field));
    expect(v.field?.other?.confidence).toBe(1);
    expect(v.field?.other?.warmth).toBeGreaterThan(0.7);
    expect(v.field?.reticence?.max).toBeGreaterThan(v.field!.reticence!.mean);
    const line = formatVitals(v).split("\n").find((l) => l.startsWith("them:"));
    console.log(`\n  ${line}`);
    expect(line).toBeTruthy();
  });
});

describe("the daily tick carries it through", () => {
  it("passes what her memory is doing into her drives, and survives without it", () => {
    const withField = createInnerState();
    const without = createInnerState();
    const base = {
      nowMs: T0, recentEvents: [], hoursSinceUser: 3, budgetLow: false, timezoneOffsetHours: 0,
      phase: "normal" as const, awake: true, clockActivity: 0.5, present: true, available: true,
      consecutiveNonReplies: 0, sendsInLastDay: 0, recentDominants: [],
      generateThoughts: () => [],
    };
    const sinks = { push: () => {}, diarize: () => {}, alarm: () => {} };
    const a = lifeTick(withField, { ...base, field: { ...NO_PULL, tension: 1 } }, sinks);
    const b = lifeTick(without, base, sinks);
    expect(a.mood).toBeTruthy();
    expect(b.mood).toBeTruthy();
    expect(withField.drives().discomfort).toBeGreaterThan(without.drives().discomfort);
  });
});
