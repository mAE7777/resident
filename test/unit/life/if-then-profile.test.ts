import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  profileOf, profileStability, readProfile, explainedBySingleInput,
  PROFILE_IS_HERS_ABOVE, A_SINGLE_INPUT_EXPLAINS_HER_ABOVE,
} from "../../../src/life/if-then-profile.js";

/**
 * THE CRITERION THE BUILD DECLARED AND NEVER COMPUTED.
 *
 * `layers.md` states it outright, 「她的如果-那么剖面稳定性 > 0.2，而且剖面的形状不能由任何单一
 * 输入推出来」, and nothing in the repository calculated it. The number 0.2 appeared once in the
 * whole tree, as an unrelated constant in another file. A project that declares a behavioural
 * criterion and never measures it is exactly as well off as one with no criterion, except that it
 * believes otherwise.
 *
 * It cannot be RUN until she has lived two non-overlapping stretches, correlating a seeded
 * fixture with itself would produce a number about the fixture's author. Built now, run later,
 * and "not measured" stays recorded as an open limit.
 */

const occasions = (pairs: Array<[string, number]>) => pairs.map(([situation, did]) => ({ situation, did }));

describe("her if-then shape", () => {
  it("a profile is what she did, per kind of moment", () => {
    const p = profileOf(occasions([["被生硬地要求", 0.8], ["被生硬地要求", 0.6], ["被好好地问", 0.1]]));
    expect(p.get("被生硬地要求")).toBeCloseTo(0.7, 5);
    expect(p.get("被好好地问")).toBeCloseTo(0.1, 5);
  });

  it("the SAME shape across two stretches of life is high stability", () => {
    const first = occasions([["生硬", 0.9], ["好好问", 0.1], ["被打断", 0.7], ["闲聊", 0.2]]);
    const second = occasions([["生硬", 0.85], ["好好问", 0.15], ["被打断", 0.75], ["闲聊", 0.15]]);
    const r = profileStability(profileOf(first), profileOf(second));
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(PROFILE_IS_HERS_ABOVE);
    expect(r!).toBeGreaterThan(0.9);
  });

  it("and an INVERTED shape is negative, not merely low", () => {
    // The sign matters: a being whose pattern reversed between two stretches is not "unstable",
    // she is a different shape, and averaging that to ~0 would hide it.
    const first = occasions([["生硬", 0.9], ["好好问", 0.1], ["被打断", 0.7], ["闲聊", 0.2]]);
    const flipped = occasions([["生硬", 0.1], ["好好问", 0.9], ["被打断", 0.2], ["闲聊", 0.7]]);
    expect(profileStability(profileOf(first), profileOf(flipped))!).toBeLessThan(0);
  });

  it("noise across situations does not reach the bar", () => {
    const first = occasions([["a", 0.9], ["b", 0.1], ["c", 0.5], ["d", 0.3]]);
    const second = occasions([["a", 0.2], ["b", 0.8], ["c", 0.4], ["d", 0.6]]);
    const r = profileStability(profileOf(first), profileOf(second))!;
    expect(r).toBeLessThan(PROFILE_IS_HERS_ABOVE);
  });

  it("UNMEASURABLE returns null, and null is never a pass", () => {
    // Too few shared situations to correlate, and a flat profile which has no shape at all. Both
    // must be null rather than 0: a criterion that reports a number when it could not be evaluated
    // is worse than one that reports failure.
    expect(profileStability(profileOf(occasions([["a", 1], ["b", 0]])), profileOf(occasions([["a", 1], ["b", 0]])))).toBeNull();
    const flat = occasions([["a", 0.5], ["b", 0.5], ["c", 0.5], ["d", 0.5]]);
    expect(profileStability(profileOf(flat), profileOf(flat))).toBeNull();
    expect(readProfile(flat, flat).hers, "an unmeasurable profile was reported as hers").toBe(false);
  });
});

describe("the half that is easy to forget: a rule also has a stable profile", () => {
  it("a shape one input recovers is a rule wearing a person's clothes", () => {
    // This is criterion 3 at the behavioural level. "Curt message → short reply" produces a
    // perfectly stable profile, and it is not a person; what makes her one is that no single
    // input reconstructs the shape.
    const hers = profileOf(occasions([["生硬", 0.9], ["好好问", 0.1], ["被打断", 0.7], ["闲聊", 0.2]]));
    const oneInput = new Map([["他有多生硬", new Map([["生硬", 0.9], ["好好问", 0.1], ["被打断", 0.7], ["闲聊", 0.2]])]]);
    expect(explainedBySingleInput(hers, oneInput)!).toBeGreaterThan(A_SINGLE_INPUT_EXPLAINS_HER_ABOVE);
    expect(readProfile(
      occasions([["生硬", 0.9], ["好好问", 0.1], ["被打断", 0.7], ["闲聊", 0.2]]),
      occasions([["生硬", 0.88], ["好好问", 0.12], ["被打断", 0.72], ["闲聊", 0.18]]),
      oneInput,
    ).hers, "a single-input rule passed as a person").toBe(false);
  });

  it("but a shape no single input recovers, held across two lives, IS hers", () => {
    const first = occasions([["生硬", 0.9], ["好好问", 0.1], ["被打断", 0.7], ["闲聊", 0.2]]);
    const second = occasions([["生硬", 0.85], ["好好问", 0.15], ["被打断", 0.72], ["闲聊", 0.18]]);
    // Each input explains part and none explains the shape.
    const inputs = new Map([
      ["他有多生硬", new Map([["生硬", 0.9], ["好好问", 0.1], ["被打断", 0.2], ["闲聊", 0.8]])],
      ["她有多少余量", new Map([["生硬", 0.2], ["好好问", 0.8], ["被打断", 0.7], ["闲聊", 0.3]])],
    ]);
    const read = readProfile(first, second, inputs);
    expect(read.stability!).toBeGreaterThan(PROFILE_IS_HERS_ABOVE);
    expect(read.strongestSingleInput!).toBeLessThan(A_SINGLE_INPUT_EXPLAINS_HER_ABOVE);
    expect(read.hers).toBe(true);
    expect(read.situations).toBe(4);
  });
});

describe("and it is honest about not having been run", () => {
  it("the bar is the one the doc states, not one chosen here", () => {
    expect(PROFILE_IS_HERS_ABOVE).toBe(0.2);
    const layers = readFileSync(join(process.cwd(), "docs/layers.md"), "utf8");
    expect(layers, "the doc no longer states the criterion this file implements")
      .toContain("profile stability > 0.2");
  });

  it("the module makes no model call and reads no clock", () => {
    const src = readFileSync(join(process.cwd(), "src/life/if-then-profile.ts"), "utf8");
    expect(src).not.toMatch(/provider|complete\(|Date\.now\(\)/u);
  });
});
