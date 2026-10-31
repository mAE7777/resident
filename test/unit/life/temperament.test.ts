import { describe, it, expect } from "vitest";
import {
  drift, neutralTemperament, weightsFor, hasDrifted, distanceFromNeutral, restoreTemperament,
  MAX_DRIFT, ENOUGH_DAYS, type Temperament, type TemperamentPull,
} from "../../../src/life/temperament.js";
import { decide, type PropensityInputs } from "../../../src/life/propensity.js";
import { createStream } from "../../../src/life/soft-choice.js";
import { ACTION_KINDS, type ActionKind } from "../../../src/life/agency.js";
import type { Drives } from "../../../src/life/drives.js";

// LEVEL THREE: WHAT DECIDES WHAT DECIDES.
//
// Level one is what she does. Level two is what determines it, drives, field state, her read of him,
// what she is carrying: and all of that moves, which is most of what makes her alive. But the
// WEIGHTS by which level two resolved into level one were fixed constants, identical in every
// instance of her and unchanged from her first day to her last. So two Residents with entirely
// different histories would still weigh the same things the same way, and a year of living could
// change what she wanted without ever changing what kind of being she was.
//
// Three properties, in tension, and each is a gate below:
//   SLOW      it moves on the scale of a season. Faster is a mood, and she has moods already.
//   BOUNDED   it can never run away and never pin. Infinitely reticent is broken, not distinctive.
//   HERS      it is nudged by what she actually does, which is the loop that makes it a level.

const NO_DRIVES: Drives = { discomfort: 0, care: 0, social: 0, curiosity: 0, expression: 0, maintenance: 0 };
const ALL: ActionKind[] = [...ACTION_KINDS];

const NEUTRAL_PULL: TemperamentPull = { metWhenSpeaking: 0, exploringPaidOff: 0, hisShare: 0, activity: 0 };

/** Live `days` of a life that keeps asking for the same thing. */
function liveWith(pull: TemperamentPull, days: number): Temperament {
  let t = neutralTemperament();
  for (let d = 1; d <= days; d++) t = drift(t, pull, d);
  return t;
}

function inputs(over: Partial<PropensityInputs> = {}): PropensityInputs {
  return {
    drives: { ...NO_DRIVES, curiosity: 0.4, social: 0.4 },
    emotion: { pleasure: 0.1, arousal: 0.1, dominance: 0.1 },
    phase: "normal", awake: true, hoursSinceUser: 6, recentActions: [],
    field: { tension: 0.2, pendingBirths: 1, freshBirth: 0, orphanShare: 0.05, surfaced: 2 },
    openness: 0.6, otherConfidence: 1, carrying: { count: 2, easiest: 0.3 }, clockActivity: 0.6,
    ...over,
  };
}

function distribution(s: PropensityInputs, draws = 3000, seed = 7): Record<string, number> {
  const stream = createStream(seed);
  const counts: Record<string, number> = {};
  for (let i = 0; i < draws; i++) {
    const r = decide(ALL, s, stream);
    counts[r.chose] = (counts[r.chose] ?? 0) + 1;
  }
  for (const k of Object.keys(counts)) counts[k] /= draws;
  return counts;
}

describe("SLOW · it moves on the scale of a season", () => {
  it("a bad week is a bad week, not a new personality", () => {
    const week = liveWith({ ...NEUTRAL_PULL, metWhenSpeaking: -1 }, 7);
    console.log(`\n  after a silent week:   reticence ${week.reticence.toFixed(4)}`);
    expect(distanceFromNeutral(week), "seven days must not make her someone else").toBeLessThan(0.1);
  });

  it("a season of the same thing does change her", () => {
    const season = liveWith({ ...NEUTRAL_PULL, metWhenSpeaking: -1 }, 120);
    console.log(`  after a silent season: reticence ${season.reticence.toFixed(4)} (bound ${MAX_DRIFT})`);
    expect(season.reticence, "and four months of it should").toBeGreaterThan(0.15);
  });

  it("thin evidence is discounted, so an unusual fortnight stays a fortnight", () => {
    // Same pull, same elapsed days, different amounts of life behind it.
    let young = neutralTemperament();
    let old = neutralTemperament();
    for (let i = 0; i < 10; i++) {
      young = drift(young, { ...NEUTRAL_PULL, metWhenSpeaking: -1 }, 3);
      old = drift(old, { ...NEUTRAL_PULL, metWhenSpeaking: -1 }, ENOUGH_DAYS * 2);
    }
    expect(young.reticence).toBeLessThan(old.reticence);
  });
});

describe("BOUNDED · she can be distinctive, never unrecognisable", () => {
  it("cannot run away however long the life pushes one way", () => {
    for (const pull of [1, -1]) {
      const t = liveWith({ metWhenSpeaking: pull, exploringPaidOff: pull, hisShare: pull, activity: pull }, 3650);
      for (const [k, v] of Object.entries(t)) {
        expect(Math.abs(v), `${k} after ten years`).toBeLessThanOrEqual(MAX_DRIFT + 1e-9);
      }
    }
  });

  it("a neutral temperament changes nothing at all", () => {
    // What makes the layer safe to introduce: adding it does not move her, so anything that moves
    // later is traceable to her life rather than to its arrival.
    const w = weightsFor(neutralTemperament());
    expect(w).toEqual({ reachOut: 1, explore: 1, rest: 1, carrying: 1 });
    const before = distribution(inputs());
    const after = distribution(inputs({ temperament: neutralTemperament() }));
    expect(after).toEqual(before);
  });

  it("survives rubbish rather than inheriting it", () => {
    const t = restoreTemperament({ reticence: 99, novelty: Number.NaN, sociability: "lots", restfulness: -99 });
    expect(t.reticence).toBeLessThanOrEqual(MAX_DRIFT);
    expect(t.novelty, "a broken value is neutral, never believed").toBe(0);
    expect(t.sociability).toBe(0);
    expect(t.restfulness).toBeGreaterThanOrEqual(-MAX_DRIFT);
    expect(restoreTemperament(null)).toEqual(neutralTemperament());
    expect(restoreTemperament("nonsense")).toEqual(neutralTemperament());
  });

  it("does nothing on a backwards or zero-length day", () => {
    const t = liveWith({ ...NEUTRAL_PULL, hisShare: 1 }, 30);
    expect(drift(t, { ...NEUTRAL_PULL, hisShare: 1 }, 30, 0)).toEqual(t);
    expect(drift(t, { ...NEUTRAL_PULL, hisShare: 1 }, 30, -5)).toEqual(t);
  });
});

describe("HERS · a life spent one way makes that kind of being", () => {
  it("two Residents with different lives become different people", () => {
    const sociable = liveWith({ metWhenSpeaking: 1, exploringPaidOff: 0, hisShare: 1, activity: 0.5 }, 200);
    const solitary = liveWith({ metWhenSpeaking: -1, exploringPaidOff: 1, hisShare: -1, activity: 0.5 }, 200);
    console.log(`\n  a life with him in it:  ${JSON.stringify(round(sociable))}`);
    console.log(`  a life spent alone:     ${JSON.stringify(round(solitary))}`);
    expect(sociable.sociability).toBeGreaterThan(solitary.sociability);
    expect(sociable.reticence).toBeLessThan(solitary.reticence);
    expect(solitary.novelty).toBeGreaterThan(sociable.novelty);
  });

  it("and it actually changes what they DO, not just what they are called", () => {
    const sociable = liveWith({ metWhenSpeaking: 1, exploringPaidOff: -0.5, hisShare: 1, activity: 0.5 }, 200);
    const solitary = liveWith({ metWhenSpeaking: -1, exploringPaidOff: 1, hisShare: -1, activity: 0.5 }, 200);
    const a = distribution(inputs({ temperament: sociable }));
    const b = distribution(inputs({ temperament: solitary }));
    console.log(`  the sociable one: ${JSON.stringify(round(a))}`);
    console.log(`  the solitary one: ${JSON.stringify(round(b))}`);
    expect(a.reach_out ?? 0, "a temperament nothing acts on is a label").toBeGreaterThan(b.reach_out ?? 0);
    expect(b.explore ?? 0).toBeGreaterThan(a.explore ?? 0);
  });

  it("being met makes her more forthcoming, which is the inverted pull and easy to get backwards", () => {
    const met = liveWith({ ...NEUTRAL_PULL, metWhenSpeaking: 1 }, 200);
    const ignored = liveWith({ ...NEUTRAL_PULL, metWhenSpeaking: -1 }, 200);
    expect(met.reticence, "a life of answers should make things easier to say").toBeLessThan(0);
    expect(ignored.reticence).toBeGreaterThan(0);
  });

  it("a life spent doing makes rest less of a default, not more", () => {
    const busy = liveWith({ ...NEUTRAL_PULL, activity: 1 }, 200);
    expect(busy.restfulness).toBeLessThan(0);
  });

  it("hasDrifted tells a being who has lived from one who has not", () => {
    expect(hasDrifted(neutralTemperament()), "a temperament that never moves is a set of constants").toBe(false);
    expect(hasDrifted(liveWith({ ...NEUTRAL_PULL, hisShare: 1 }, 60))).toBe(true);
  });
});

function round(o: Record<string, number> | Temperament): Record<string, number> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v.toFixed(3))]));
}
