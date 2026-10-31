import { describe, it, expect } from "vitest";
import {
  decide, contributionsFor, tornWords, VOTE_WEIGHT, TORN_MARGIN,
  type PropensityInputs,
} from "../../../src/life/propensity.js";
import { createStream, softPick, temperatureFrom, sampleIndex } from "../../../src/life/soft-choice.js";
import { mulberry32 } from "../../../src/life/clock.js";
import { ACTION_KINDS, type ActionKind } from "../../../src/life/agency.js";
import { neutralTemperament, MAX_DRIFT, type Temperament } from "../../../src/life/temperament.js";
import type { Drives, DriveName } from "../../../src/life/drives.js";
import type { MetabolicPhase } from "../../../src/life/metabolism.js";
import { readFileSync } from "node:fs";

// PROPERTIES OF THE LAYER THAT DECIDES WHAT SHE DOES.
//
// The propensity replaced the one place a single inference decided her behaviour, and it is the
// piece with the widest input surface in the whole system: eight families of state, a temperament
// underneath them, and a vote that may or may not arrive. Example-based tests can only ever say
// "these inputs gave this answer". What has to hold is stronger and is stated as properties, each
// checked against thousands of states drawn adversarially rather than plausibly.
//
// The invariant that matters most is the LAST one. The propensity ranks; the affordances decide
// what is possible. If ranking could ever surface something the affordances refused, then every wall
// in the system would have a way around it that nobody had noticed, and it would be reachable by
// arithmetic rather than by anything a reader could see.

const DRIVE_NAMES: DriveName[] = ["discomfort", "care", "social", "curiosity", "expression", "maintenance"];
const PHASES: MetabolicPhase[] = ["rested", "normal", "low", "dormant"];

/**
 * A state drawn to be AWKWARD, not to be plausible.
 *
 * Includes the values a real system produces at its edges and the ones a bug produces: every drive
 * at once, nothing at all, a temperament pinned at its bound, a vote for something impossible.
 */
function awkwardState(rand: () => number): PropensityInputs {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const maybe = <T,>(x: T): T | undefined => (rand() < 0.25 ? undefined : x);
  const extreme = (): number => {
    const r = rand();
    if (r < 0.15) return 0;
    if (r < 0.3) return 1;
    return rand();
  };
  const drives = Object.fromEntries(DRIVE_NAMES.map((d) => [d, extreme()])) as Drives;
  const temperament: Temperament = {
    reticence: (rand() * 2 - 1) * MAX_DRIFT,
    novelty: (rand() * 2 - 1) * MAX_DRIFT,
    sociability: (rand() * 2 - 1) * MAX_DRIFT,
    restfulness: (rand() * 2 - 1) * MAX_DRIFT,
  };
  return {
    drives,
    emotion: { pleasure: rand() * 2 - 1, arousal: rand() * 2 - 1, dominance: rand() * 2 - 1 },
    phase: pick(PHASES),
    awake: rand() < 0.8,
    hoursSinceUser: rand() < 0.1 ? 0 : rand() * 500,
    recentActions: Array.from({ length: Math.floor(rand() * 10) }, () => pick(ACTION_KINDS)),
    openness: maybe(extreme()),
    otherConfidence: maybe(extreme()),
    field: maybe({
      tension: extreme(), pendingBirths: Math.floor(rand() * 12), freshBirth: extreme(),
      orphanShare: extreme(), surfaced: Math.floor(rand() * 8),
    }),
    carrying: maybe({ count: Math.floor(rand() * 40), easiest: extreme() }),
    clockActivity: maybe(extreme()),
    vote: maybe({ first: pick(ACTION_KINDS), second: rand() < 0.5 ? pick(ACTION_KINDS) : undefined }),
    temperament: maybe(rand() < 0.3 ? neutralTemperament() : temperament),
  };
}

/** A non-empty subset of the actions, as `computeAffordances` would hand over. */
function someAffordances(rand: () => number): ActionKind[] {
  const subset = ACTION_KINDS.filter(() => rand() < 0.6);
  return subset.length > 0 ? subset : ["rest"];
}

const RUNS = 4000;

describe("whatever state she is in, the weighing is well-formed", () => {
  it("always chooses, and always something that was on offer", () => {
    const rand = mulberry32(0xC0FFEE);
    for (let i = 0; i < RUNS; i++) {
      const available = someAffordances(rand);
      const r = decide(available, awkwardState(rand), createStream(i + 1));
      expect(available, `run ${i}: chose ${r.chose} from ${available.join(",")}`).toContain(r.chose);
    }
  });

  it("never produces NaN, anywhere in the result", () => {
    const rand = mulberry32(7);
    for (let i = 0; i < RUNS; i++) {
      const r = decide(someAffordances(rand), awkwardState(rand), createStream(i + 1));
      expect(Number.isFinite(r.temperature), `run ${i}: temperature`).toBe(true);
      for (const w of r.weighed) {
        expect(Number.isFinite(w.score), `run ${i}: ${w.action} score`).toBe(true);
        expect(Number.isFinite(w.probability), `run ${i}: ${w.action} probability`).toBe(true);
      }
      for (const c of r.contributions) {
        expect(Number.isFinite(c.value), `run ${i}: ${c.factor}/${c.action}`).toBe(true);
      }
    }
  });

  it("the probabilities are a distribution: each in [0,1], summing to one", () => {
    const rand = mulberry32(11);
    for (let i = 0; i < RUNS; i++) {
      const r = decide(someAffordances(rand), awkwardState(rand), createStream(i + 1));
      let total = 0;
      for (const w of r.weighed) {
        expect(w.probability, `run ${i}: ${w.action}`).toBeGreaterThanOrEqual(0);
        expect(w.probability).toBeLessThanOrEqual(1);
        total += w.probability;
      }
      expect(total, `run ${i}: probabilities sum to ${total}`).toBeCloseTo(1, 6);
    }
  });

  it("the temperature stays positive, so nothing is ever decided by a division by zero", () => {
    const rand = mulberry32(13);
    for (let i = 0; i < RUNS; i++) {
      const r = decide(someAffordances(rand), awkwardState(rand), createStream(i + 1));
      expect(r.temperature, `run ${i}`).toBeGreaterThan(0);
    }
  });

  it("every contribution is named, bounded, and about an action that was on offer", () => {
    const rand = mulberry32(17);
    for (let i = 0; i < RUNS; i++) {
      const available = someAffordances(rand);
      for (const c of contributionsFor(available, awkwardState(rand))) {
        expect(c.factor.length, `run ${i}: an unnamed contribution cannot be ablated or watched`).toBeGreaterThan(0);
        expect(available, `run ${i}: ${c.factor} scored ${c.action}, which was not on offer`).toContain(c.action);
        // Generously bounded. The point is that no single factor can run away: the vote is the
        // largest deliberate one, and nothing may exceed it by more than a small multiple.
        expect(Math.abs(c.value), `run ${i}: ${c.factor} = ${c.value}`).toBeLessThan(VOTE_WEIGHT * 6);
      }
    }
  });

  it("`torn` means what it says, on every run", () => {
    const rand = mulberry32(19);
    for (let i = 0; i < RUNS; i++) {
      const r = decide(someAffordances(rand), awkwardState(rand), createStream(i + 1));
      const sorted = r.weighed.map((w) => w.score).sort((a, b) => b - a);
      const reallyTorn = sorted.length >= 2 && sorted[0] - sorted[1] < TORN_MARGIN;
      expect(r.torn, `run ${i}`).toBe(reallyTorn);
      expect(tornWords(r).length > 0, `run ${i}: words follow the flag`).toBe(reallyTorn);
    }
  });

  it("survives being handed rubbish rather than believing it", () => {
    const nasty: PropensityInputs[] = [
      { drives: { discomfort: Number.NaN, care: Infinity, social: -5, curiosity: Number.NaN, expression: 1e308, maintenance: 0 },
        emotion: { pleasure: Number.NaN, arousal: Infinity, dominance: -Infinity },
        phase: "normal", awake: true, hoursSinceUser: Number.NaN, recentActions: [] },
      { drives: { discomfort: 0, care: 0, social: 0, curiosity: 0, expression: 0, maintenance: 0 },
        emotion: { pleasure: 0, arousal: 0, dominance: 0 }, phase: "normal", awake: true,
        hoursSinceUser: -100, recentActions: [],
        field: { tension: Number.NaN, pendingBirths: -3, freshBirth: Infinity, orphanShare: Number.NaN, surfaced: -1 },
        carrying: { count: -5, easiest: Number.NaN }, clockActivity: Number.NaN,
        temperament: { reticence: Number.NaN, novelty: 1e9, sociability: -1e9, restfulness: Number.NaN } },
    ];
    for (const [i, s] of nasty.entries()) {
      const r = decide([...ACTION_KINDS], s, createStream(1));
      expect(ACTION_KINDS, `nasty ${i}`).toContain(r.chose);
      expect(Number.isFinite(r.temperature), `nasty ${i}`).toBe(true);
      for (const w of r.weighed) expect(Number.isFinite(w.probability), `nasty ${i}: ${w.action}`).toBe(true);
    }
  });
});

describe("the same seed gives the same life, so any moment can be replayed", () => {
  it("identical state and seed give an identical result, every time", () => {
    const rand = mulberry32(23);
    for (let i = 0; i < 500; i++) {
      const available = someAffordances(rand);
      const state = awkwardState(rand);
      const a = decide(available, state, createStream(i + 1));
      const b = decide(available, state, createStream(i + 1));
      expect(b.chose, `run ${i}`).toBe(a.chose);
      expect(b.temperature).toBe(a.temperature);
      expect(b.weighed).toEqual(a.weighed);
    }
  });

  it("a stream resumed at a position continues exactly as it would have", () => {
    // This is what makes forensic replay real rather than a claim: her position is persisted, and
    // continuing from it must be indistinguishable from never having stopped.
    for (const seed of [1, 42, 987_654]) {
      const whole = createStream(seed);
      const first = Array.from({ length: 25 }, () => whole.next());
      const rest = Array.from({ length: 25 }, () => whole.next());
      const resumed = createStream(seed, 25);
      expect(Array.from({ length: 25 }, () => resumed.next()), `seed ${seed}`).toEqual(rest);
      expect(first.length).toBe(25);
    }
  });

  it("where the moment is OPEN, different seeds give different lives", () => {
    // Stated carefully, because the first version of this test was wrong and the difference is the
    // whole design. A decisive state SHOULD go the same way every time, that is what having a
    // clear preference means, and a weighing that wandered anyway would be noise wearing emergence's
    // clothes. What must be true is that where the top two are genuinely close, the seed decides.
    const rand = mulberry32(29);
    let openStatesFound = 0;
    let openStatesThatVaried = 0;
    for (let i = 0; i < 400; i++) {
      const state = awkwardState(rand);
      const probe = decide([...ACTION_KINDS], state, createStream(1));
      if (!probe.torn) continue;
      openStatesFound += 1;
      const chosen = new Set<string>();
      for (let seed = 1; seed <= 60; seed++) chosen.add(decide([...ACTION_KINDS], state, createStream(seed)).chose);
      if (chosen.size > 1) openStatesThatVaried += 1;
    }
    console.log(`\n  of ${openStatesFound} genuinely open moments, ${openStatesThatVaried} could go more than one way`);
    expect(openStatesFound, "the sampler needs open moments to be worth anything").toBeGreaterThan(5);
    expect(openStatesThatVaried / openStatesFound,
      "a moment that is open must actually be open").toBeGreaterThan(0.8);
  });

  it("and where it is DECISIVE, the seed changes nothing", () => {
    // The other half, and the one that stops this being noise: a clear preference is followed.
    const rand = mulberry32(31);
    let decisive = 0;
    let stable = 0;
    for (let i = 0; i < 400; i++) {
      const state = awkwardState(rand);
      const probe = decide([...ACTION_KINDS], state, createStream(1));
      const scores = probe.weighed.map((w) => w.score).sort((a, b) => b - a);
      if (scores.length < 2 || scores[0] - scores[1] < 1.2) continue;
      decisive += 1;
      const chosen = new Set<string>();
      for (let seed = 1; seed <= 40; seed++) chosen.add(decide([...ACTION_KINDS], state, createStream(seed)).chose);
      if (chosen.size === 1) stable += 1;
    }
    console.log(`  of ${decisive} decided moments, ${stable} went the same way whatever the seed`);
    expect(decisive).toBeGreaterThan(5);
    expect(stable / decisive, "a clear preference must be followed, not sampled around").toBeGreaterThan(0.9);
  });
});

describe("the wall it must never be able to cross", () => {
  it("cannot surface an action the affordances refused, over any state at all", () => {
    // Adversarial on purpose: the model votes for the blocked thing, the drive behind it is at
    // maximum, the temperament favours it, and it is the only thing she has wanted all week. If
    // ranking could ever overrule the affordances then every wall in the system has a way around
    // it that is reachable by arithmetic and invisible to a reader.
    const rand = mulberry32(31);
    for (const forbidden of ACTION_KINDS) {
      const available = ACTION_KINDS.filter((k) => k !== forbidden);
      if (available.length === 0) continue;
      for (let i = 0; i < 800; i++) {
        const state = awkwardState(rand);
        const rigged: PropensityInputs = {
          ...state,
          drives: Object.fromEntries(DRIVE_NAMES.map((d) => [d, 1])) as Drives,
          vote: { first: forbidden, second: forbidden },
          recentActions: [],
        };
        const r = decide(available, rigged, createStream(i + 1));
        expect(r.chose, `${forbidden} was refused and still chosen`).not.toBe(forbidden);
        expect(r.weighed.map((w) => w.action), `${forbidden} was even weighed`).not.toContain(forbidden);
        expect(r.contributions.map((c) => c.action), `${forbidden} was scored`).not.toContain(forbidden);
      }
    }
  });

  it("an empty affordance set does not crash and does not invent one", () => {
    const r = decide([], awkwardState(mulberry32(37)), createStream(1));
    expect(r.chose, "the last resort is rest, and it is stated rather than accidental").toBe("rest");
    expect(r.weighed).toEqual([]);
  });

  it("a single affordance is chosen with certainty, not sampled toward something else", () => {
    const rand = mulberry32(41);
    for (let i = 0; i < 500; i++) {
      const r = decide(["rest"], awkwardState(rand), createStream(i + 1));
      expect(r.chose).toBe("rest");
      expect(r.weighed[0].probability).toBeCloseTo(1, 9);
    }
  });
});

describe("the primitive underneath behaves", () => {
  it("there is exactly ONE sampler, not one per file", () => {
    // There were two. The field's own copy summed weights without checking them, so a single NaN
    // made the total NaN, the "nothing to sample" guard read false, and every walk silently took
    // the last neighbour in the list instead of sampling, her spreading activation quietly
    // becoming a fixed traversal. Two copies of a sampler is two different beings.
    const src = readFileSync(new URL("../../../src/life/field-emergence.ts", import.meta.url), "utf8");
    expect(src, "the field must use the one sampler").toMatch(/import \{ sampleIndex \} from "\.\/soft-choice\.js"/);
    expect(src, "and not carry its own").not.toMatch(/function sampleIndex/);
  });

  it("softPick returns a valid distribution over any scores at all", () => {
    const rand = mulberry32(43);
    for (let i = 0; i < 2000; i++) {
      const n = 1 + Math.floor(rand() * 6);
      const items = Array.from({ length: n }, (_, k) => ({
        item: k,
        score: rand() < 0.1 ? (rand() < 0.5 ? Number.NaN : Infinity) : (rand() * 20 - 10),
      }));
      const r = softPick(items, { temperature: rand() < 0.1 ? 0 : rand() * 3, count: 1, random: () => rand() });
      const total = r.weighed.reduce((sum, w) => sum + w.probability, 0);
      expect(Number.isFinite(total), `run ${i}`).toBe(true);
      expect(total, `run ${i}`).toBeCloseTo(1, 6);
      expect(r.chosen.length, `run ${i}`).toBe(1);
    }
  });

  it("temperatureFrom is positive and falls as the margin widens", () => {
    const rand = mulberry32(47);
    for (let i = 0; i < 1000; i++) {
      const scores = Array.from({ length: 2 + Math.floor(rand() * 4) }, () => rand() * 10 - 5);
      expect(temperatureFrom(scores, 1)).toBeGreaterThan(0);
    }
    // A dead heat is open; a landslide is not.
    expect(temperatureFrom([1, 1], 1)).toBeGreaterThan(temperatureFrom([10, 1], 1));
    expect(temperatureFrom([], 1)).toBeGreaterThan(0);
    expect(temperatureFrom([Number.NaN, 1], 1)).toBeGreaterThan(0);
  });

  it("sampleIndex always lands inside the array, over any weights", () => {
    const rand = mulberry32(53);
    for (let i = 0; i < 2000; i++) {
      const n = 1 + Math.floor(rand() * 8);
      const weights = Array.from({ length: n }, () => (rand() < 0.2 ? 0 : rand()));
      const k = sampleIndex(weights, rand());
      const anyWeight = weights.some((x) => x > 0);
      if (anyWeight) {
        expect(k, `run ${i}: ${weights.join(",")}`).toBeGreaterThanOrEqual(0);
        expect(k).toBeLessThan(n);
      } else {
        // -1 is the contract for "there is nothing to sample", not a failure. Every caller guards
        // it; the assertion below is that the contract is honoured rather than that it never fires.
        expect(k, `run ${i}: all-zero weights`).toBe(-1);
      }
    }
    expect(sampleIndex([0, 0, 0], 0.9), "nothing to sample says so").toBe(-1);
    expect(sampleIndex([Number.NaN, Number.NaN], 0.5), "and rubbish is nothing to sample").toBe(-1);
  });
});
