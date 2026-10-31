import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createInnerState } from "../../../src/life/inner-state.js";
import { contributionsFor, VOTE_WEIGHT } from "../../../src/life/propensity.js";

/**
 * STATE DECIDES; THE MODEL IS A BOUNDED VOTER. THE ONE RULE EVERYTHING ELSE RESTS ON.
 *
 * `VOTE_WEIGHT` is 0.55 and is documented as "comparable to the largest single state factor".
 * That comparison is the whole design: her own life has to be able to outweigh one inference.
 * Nothing measured it, so it drifted twice, both times invisibly.
 *
 * The first drift: drives charged once a day and discharged once a moment, so by her
 * fifth acting moment every drive was zero and the vote was the only term left.
 *
 * THE SECOND DRIFT WAS THE FIX FOR THE FIRST, and it took a second-order sweep to see. The
 * per-moment regeneration was handed a synthesised standing vector with every event count at
 * ZERO, on the reasoning that what she wants now is a function of standing conditions rather
 * than of how many tool calls happened. But `regenerate` relaxes toward its target in BOTH
 * directions, so a zeroed component is not omitted: it is asserted as her standing level and
 * actively pulls the drive down. And it runs fifteen to twenty-five times a day against
 * `accumulate`'s once, so the zeroing won. Measured on the real modules, from her sixth moment
 * onward her largest drive term was eight to fifty times smaller than the vote.
 *
 * `inner-state.ts` had already written the contract down, the standing vector is "the same
 * `DriveInputs` the daily update uses, so there is one account of what she wants and not two
 * that can disagree", and the caller quietly built a second one.
 *
 * This file is the measurement that was missing. It drives the REAL modules through a real
 * day and asserts the comparison the rule depends on.
 */

/** A day in which things actually happened to her, which is the case that was being erased. */
const A_REAL_DAY = {
  successes: 3, failures: 2, stuck: 1, skills: 0, observations: 2, anomalies: 1,
  novelty: 0.4, restful: false, lateNight: false, idle: 0.5,
  selfDirected: 0.5, maintenanceDue: 0.3, hoursSinceUser: 5, budgetLow: false,
} as never;

/** The largest single drive contribution entering the weighing, this moment. */
function largestDriveTerm(inner: ReturnType<typeof createInnerState>): number {
  const snap = inner.snapshot("normal", true);
  const contributions = contributionsFor(["rest", "reflect", "tend", "explore", "reach_out"], {
    drives: snap.drives, emotion: snap.emotion, phase: "normal", awake: true,
    hoursSinceUser: 5, recentActions: [],
  } as never);
  return Math.max(0, ...contributions.filter((c) => c.factor.startsWith("drive:")).map((c) => Math.abs(c.value)));
}

describe("her own state can still outweigh one inference, across a whole day", () => {
  it("the largest drive term stays comparable to the vote, moment after moment", () => {
    const inner = createInnerState();
    inner.update(A_REAL_DAY);
    const terms: number[] = [];
    for (let m = 0; m < 18; m++) {
      inner.regenerate(A_REAL_DAY, 50 / 60);
      terms.push(largestDriveTerm(inner));
      const snap = inner.snapshot("normal", true);
      inner.actOn(snap.dominant, 0.6);
      inner.actOn(inner.snapshot("normal", true).dominant, 0.3);
    }
    // "Comparable to" is the documented claim. A third of the vote is the loosest reading of
    // it that is still a comparison rather than a rounding error.
    const floor = VOTE_WEIGHT / 3;
    const collapsed = terms.filter((t) => t < floor).length;
    expect(collapsed, `her state was dwarfed by the vote in ${collapsed} of 18 moments: ${terms.map((t) => t.toFixed(2)).join(" ")}`)
      .toBeLessThanOrEqual(4);
  });

  it("and a day with nothing in it is the only day her drives go quiet", () => {
    // The counter-example that keeps the claim honest: a genuinely empty day SHOULD leave her
    // with little pressing, and that is not the defect. The defect was an eventful day being
    // erased into an empty one within hours.
    const inner = createInnerState();
    const nothingHappened = { ...(A_REAL_DAY as object), successes: 0, failures: 0, stuck: 0, observations: 0, anomalies: 0, novelty: 0 } as never;
    inner.update(nothingHappened);
    for (let m = 0; m < 18; m++) { inner.regenerate(nothingHappened, 50 / 60); inner.actOn(inner.snapshot("normal", true).dominant, 0.6); }
    expect(largestDriveTerm(inner)).toBeLessThan(VOTE_WEIGHT);
  });

  it("the two accounts of what she wants are the same account", () => {
    // The contract `inner-state.ts` states and the caller broke: one standing vector, not two.
    const daemon = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//gu, (m) => " ".repeat(m.length))
      .replace(/\/\/[^\n]*/gu, (m) => " ".repeat(m.length));
    expect(daemon, "the daemon synthesises its own standing vector again")
      .toContain("...(lastConsolidatedDay ?? EMPTY_DAY)");
    expect(daemon, "the tick's real day is never kept").toContain("lastConsolidatedDay = result.day");
    // And the event counts are no longer hand-zeroed at the call site.
    expect(daemon).not.toMatch(/regenerate\([\s\S]{0,200}successes: 0, failures: 0, stuck: 0/u);
  });
});
