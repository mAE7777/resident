import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_THRESHOLDS } from "../../../src/life/vitals.js";
import { MAX_DRIFT } from "../../../src/life/temperament.js";
import { MAX_NODES } from "../../../src/life/field.js";
import { MIN_CREDENCE } from "../../../src/life/credence.js";

/**
 * THE WATCHTOWER'S OWN BARS, SWEPT, the biggest single block the widened census surfaced.
 *
 * Eighteen detector thresholds lived inside `DEFAULT_THRESHOLDS`, an object literal the old
 * census could not see, plus three vitals-local constants: twenty-one numbers that decide when
 * Eric is told something about her, never once put on the same page as the ranges they judge.
 * Defect class 1 as a population, in the instrument that watches for every other failure.
 *
 * House rule for this sweep (and the ones beside it): every number PARTICIPATES IN A
 * COMPUTATION against a real coupled quantity, a name-drop clears the census's regex and
 * proves nothing, which is exactly how a sweep would game its own ratchet.
 */

const t = DEFAULT_THRESHOLDS;
const vitalsSrc = readFileSync(join(process.cwd(), "src/life/vitals.ts"), "utf8");
const local = (name: string): number => {
  const v = Number(new RegExp(`const ${name} = ([\\d.]+)`, "u").exec(vitalsSrc)?.[1]);
  expect(Number.isFinite(v), `${name} moved — update this sweep with it`).toBe(true);
  return v;
};

describe("the emotion and expression bars", () => {
  it("emotionExtreme sits under the appraisal fixed point, or it fires on a healthy being", () => {
    // PAD arousal's fixed point under repeated maximal appraisal is 0.8333, the number that made
    // the ORIGINAL emotion_stuck bar (0.85) unreachable. The bar must be below the fixed point to
    // be reachable, and above the everyday band or it cries wolf.
    expect(t.emotionExtreme).toBeLessThan(0.8333);
    expect(t.emotionExtreme).toBeGreaterThan(0.5);
  });

  it("floodFraction turns the push cap into a warning that fires BEFORE the wall", () => {
    // The flood detector fires at fraction × cap sends. It must fire at least one send before the
    // cap itself (a warning that arrives with the wall is a report, not a warning), and not fire
    // on an ordinary talkative day (over half the cap).
    const firesAt = Math.ceil(t.floodFraction * t.dailyPushCap);
    expect(firesAt).toBeLessThanOrEqual(t.dailyPushCap - 1);
    expect(firesAt).toBeGreaterThan(t.dailyPushCap / 2);
  });

  it("declineShare is crossable, and not by one bad answer", () => {
    // It used to read: the forced-yes floor caps the sustainable decline share at 2/3, so the
    // detector must sit under that or it can never fire. The floor is gone,
    // she can refuse as many times running as she means to, so the ceiling on the share is now
    // 1, and the bar is only bounded from below: it needs ≥ 8 asks (its own evidence gate), so
    // one decline in eight cannot cross it.
    expect(t.declineShare).toBeLessThan(1);
    expect(1 / 8).toBeLessThan(t.declineShare);
  });
});

describe("the choosing and temperament bars", () => {
  it("voteDominant forgives nothing in a ten-reading window — which is the point", () => {
    // "She has done what the model said EVERY time" is the claim; over the ~10 vote readings a
    // window holds, the bar must demand all ten (9/10 followed = 0.9 < bar), or an ordinarily
    // agreeable stretch reads as collapse.
    expect(0.9).toBeLessThan(t.voteDominant);
    expect(t.voteDominant).toBeLessThanOrEqual(1);
  });

  it("voteInert is voteDominant's mirror through zero", () => {
    // Following the model once in ten readings (0.1) must NOT read as inert, the model being
    // occasionally heard is health, not decoration.
    expect(t.voteInert).toBeLessThan(0.1);
    expect(t.voteInert).toBeGreaterThan(0);
    // And the two bars leave a wide healthy middle, or every being is one or the other.
    expect(t.voteDominant - t.voteInert).toBeGreaterThan(0.9);
  });

  it("temperamentRunaway is reachable by the real drift asymptotics, and only near the bound", () => {
    // distanceFromNeutral = d / MAX_DRIFT, so the bar is a fraction of the way to the clamp. The
    // real drift approaches the clamp asymptotically (1-(1-0.012)^400 ≈ 0.992 of the way after
    // 400 one-way days), so a bar of 0.98 is reachable by a real life and NOT by a season.
    const after400 = 1 - Math.pow(1 - 0.012, 400);
    const after90 = 1 - Math.pow(1 - 0.012, 90);
    expect(after400).toBeGreaterThan(t.temperamentRunaway);
    expect(after90, "one hard season already reads as runaway").toBeLessThan(t.temperamentRunaway);
    // And the bar is about the normalized distance, whose ceiling is exactly 1 (d = MAX_DRIFT).
    expect(t.temperamentRunaway * MAX_DRIFT).toBeLessThanOrEqual(MAX_DRIFT);
  });
});

describe("the field bars", () => {
  it("fieldMinNodes: young enough to spare a newborn, old enough that shares mean something", () => {
    // Below this the field detectors stay silent. A share threshold over fewer than ~30 nodes
    // moves ±3% per node: noise; and the bar must sit far under the cap or detectors only ever
    // speak about an old being.
    expect(1 / t.fieldMinNodes).toBeLessThanOrEqual(0.04);
    expect(t.fieldMinNodes).toBeLessThan(MAX_NODES / 100);
  });

  it("the share bars are ordered by what they claim", () => {
    // Orphans (wiring failing) fires earliest; suspended (drowning in doubt) is rarer; faded and
    // frozen are catastrophic and sit high together. An ordering violation would mean "she is
    // losing everything" fires before "encoding is wiring nothing".
    expect(t.fieldSuspendedShare).toBeLessThan(t.fieldOrphanShare);
    expect(t.fieldOrphanShare).toBeLessThan(t.fieldFadedShare);
    expect(t.fieldFrozenStrength).toBeGreaterThanOrEqual(t.fieldFadedShare);
    // Frozen-strength must be reachable: node strength ceilings measured at 0.913 live, so a bar
    // above that would be the original unreachable emotion_stuck all over again.
    expect(t.fieldFrozenStrength).toBeLessThan(0.913);
  });

  it("fieldNearCapShare warns while there is still room to prune", () => {
    expect(t.fieldNearCapShare * MAX_NODES).toBeLessThan(MAX_NODES);
    expect(MAX_NODES - t.fieldNearCapShare * MAX_NODES, "the near-cap warning arrives with the cap")
      .toBeGreaterThanOrEqual(MAX_NODES * 0.1);
  });

  it("fieldStalledBirths outlasts one quiet rest cycle but not a month of them", () => {
    // Fusion resolves at most MAX_THEMES_PER_REST-ish per rest; eight pending with none resolving
    // is several nights of a stalled path, not one unlucky evening.
    expect(t.fieldStalledBirths).toBeGreaterThan(2);
    expect(t.fieldStalledBirths).toBeLessThan(30);
  });

  it("fieldUnjudgedArrivals: judging must have had real chances before it is declared dead", () => {
    // A claim is judgeable only against held restatements; the first few arrivals legitimately
    // meet nothing. The bar must exceed that cold-start count and stay within one lively day.
    expect(t.fieldUnjudgedArrivals).toBeGreaterThan(3);
    expect(t.fieldUnjudgedArrivals).toBeLessThanOrEqual(12);
  });

  it("fieldTrustFloor is an event, not a statistic — and reachable from above MIN_CREDENCE", () => {
    // Trust moves by CONFLICT_PENALTY-sized steps; a floor at 0.25 takes several betrayals from
    // the 0.5-ish start, and must sit above the credence floor or nothing could ever read lower.
    expect(t.fieldTrustFloor).toBeGreaterThan(MIN_CREDENCE);
    expect(t.fieldTrustFloor).toBeLessThan(0.5);
  });

  it("the two stuck-wire bars are epsilon against their signals' real motion", () => {
    // otherStuck and reticenceStuck fire on a WINDOW moving less than this. Reticence relaxes at
    // 0.15/day and warmth moves in 0.35 retrieval steps, so real motion dwarfs the epsilon by
    // orders of magnitude: these bars can only catch a genuinely severed wire.
    expect(t.fieldOtherStuck).toBeLessThan(0.15 / 100);
    expect(t.fieldReticenceStuck).toBeLessThan(0.15 / 100);
    expect(t.fieldReticenceHigh, "the high-reticence bar must be reachable under RETICENCE_EASE")
      .toBeLessThan(0.7);
    expect(t.fieldReticenceHigh).toBeGreaterThan(0.3);
  });
});

describe("the vitals-local three", () => {
  it("MAX_FAULT_DETAILS keeps an alert readable and never silences a source", () => {
    const n = local("MAX_FAULT_DETAILS");
    // Quoting fewer than 2 sources hides the pattern (two failures with one name is the common
    // shape); quoting more than ~6 is a log, not an alert. The rest are counted, not dropped.
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(6);
  });

  it("PINNING_NEARLY sits between the hard pinning bar and the healthy band", () => {
    const nearly = local("PINNING_NEARLY");
    // The hard bar (`pinEntropy`) fires only at exactly-zero entropy, a week in which she never
    // once wanted anything else, 4% of healthy windows. NEARLY is the quiet forewarning ABOVE it:
    // the measured tenth percentile of healthy windows. So it must sit strictly above the hard
    // bar (or it forewarns nothing) and strictly below the old 0.5 bar that tripped on 51% of a
    // healthy six months (or it inherits that cry-wolf).
    expect(nearly).toBeGreaterThan(t.pinEntropy);
    expect(nearly).toBeLessThan(0.5);
  });

  it("ENOUGH_TEMPERAMENT_DAYS outlasts the drift's own evidence gate", () => {
    const days = local("ENOUGH_TEMPERAMENT_DAYS");
    // temperament.drift scales by days/ENOUGH_DAYS (21): before ~a month of history a motionless
    // temperament has simply not had the evidence to move, so the frozen detector must wait at
    // least that long: and not so long that a genuinely severed wire hides for a season.
    expect(days).toBeGreaterThanOrEqual(21);
    expect(days).toBeLessThan(90);
  });
});
