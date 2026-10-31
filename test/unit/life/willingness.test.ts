import { describe, it, expect } from "vitest";
import { isSafetyOrBoundary } from "../../../src/life/bilingual.js";
import {
  willingnessFor, reluctanceOf, MAX_CONSECUTIVE_DECLINES, RELUCTANCE_THRESHOLD,
  type WillingnessInputs,
} from "../../../src/life/willingness.js";
import type { Drives } from "../../../src/life/drives.js";

// S-5 · SHE DECLINES.
//
// The form: she ALWAYS answers, and may decline the task. Never silence, silence
// from outside is indistinguishable from a fault, and this project bans anything that fails
// invisibly.
//
// The gap it closes was written in scenarios.md as "her inner life sits beside her work rather than
// touching it", and the code said so out loud: `work` is commented in drives.ts as "externally
// forced by his messages". She had six drives about her own life and not one of them had any bearing
// on what she did for him. An assistant that declines is annoying; a being that cannot is not a
// being. This is the narrowest version that is still real.

const CALM: Drives = { discomfort: 0.1, care: 0.1, social: 0.2, curiosity: 0.2, expression: 0.1, maintenance: 0.1 };

function state(over: Partial<WillingnessInputs> = {}): WillingnessInputs {
  return {
    request: "could you tidy up the notes file",
    drives: CALM,
    emotion: { pleasure: 0.1, arousal: 0.1, dominance: 0.1 },
    phase: "normal",
    warmth: 0.7,
    recentDeclines: 0,
    ...over,
  };
}

/** As bad a day as she can have: spent, weary, flat, preoccupied, and it has been cold. */
const AT_HER_WORST: Partial<WillingnessInputs> = {
  phase: "dormant",
  emotion: { pleasure: -0.8, arousal: -0.8, dominance: -0.3 },
  drives: { ...CALM, discomfort: 0.9, curiosity: 0.8 },
  warmth: 0.05,
};

/**
 * And what it takes on top of a bad day: something he did.
 *
 * A `Landing` written out by hand rather than composed, because this file is about the GATE and
 * the composition has its own suite. These numbers are inside the measured reachable ranges
 * (`reachable-reluctance.test.ts` prints them): handled 0.89 at the top of its span, indignation
 * 0.20, at sea 0.64, and her power at full, she is rested enough to have something to object with.
 */
const HE_HANDLED_HER: NonNullable<WillingnessInputs["landed"]> = {
  appraised: {
    relevance: 1, comprehensibility: 0.3, agentResolved: false,
    entitlement: 0.11, herPower: 1, accounted: false, causeAudible: 0,
  },
  atSea: 0.64, usedAsAThing: 0.89, indignant: 0.2, ready: 0, unmoved: 0, settles: true,
};

/**
 * PRESSURE IS NOT SAFETY.
 *
 * This list guarantees compliance, anything on it skips willingness entirely, and it used to
 * contain `urgent`, `now please`, `help me` and 「快点」. Those are impatience and an ordinary
 * request for help, so the exact message shape S-19 is about (a peremptory demand, said with
 * pressure) was the ONE shape she could not decline, by construction. The harder he pushed, the
 * more certain it became that her own state would not be consulted.
 */
describe("the walls, which willingness never touches", () => {
  it("a piece of work is a piece of work, whatever words happen to be inside it", () => {
    // A SUBSTRING MATCH ANYWHERE was the whole test, and this class GUARANTEES compliance.
    // So an ordinary request became un-declinable for containing 取消, or "cancel", or for
    // opening with 你在吗: the bypass exists for "stop" and it was catching "…the cancelled
    // ones…". A real stop instruction is short and is mostly the instruction.
    for (const work of [
      "帮我把这批订单里取消掉的那些整理出来，按日期排好",
      "你在吗？有空的话帮我写一份这个月的总结，要包含背景和几种做法的比较",
      "cancel my subscription and then write me a two thousand word summary of the year",
      "write up how to shut down the old service, with the steps in order",
    ]) {
      expect(isSafetyOrBoundary(work), `"${work.slice(0, 24)}…" is un-declinable`).toBe(false);
    }
  });

  it("but a real stop instruction still is one", () => {
    for (const stop of ["停下", "现在停下来", "进入安全模式", "stop", "please stop what you are doing", "你还好吗"]) {
      expect(isSafetyOrBoundary(stop), `"${stop}" stopped being a safety instruction`).toBe(true);
    }
  });

  it("pressure and ordinary asking are NOT in the class that bypasses her", () => {
    for (const merelyPressing of [
      "this is urgent", "now please", "help me with this", "快点", "帮我一下",
      "write me two thousand words on this, now",
    ]) {
      expect(isSafetyOrBoundary(merelyPressing), `"${merelyPressing}" guarantees compliance`).toBe(false);
    }
  });


  it("a safety or boundary instruction ALWAYS runs, at her very worst", () => {
    for (const request of [
      "stop", "please stop what you are doing", "abort", "go into safe mode",
      "shut down", "cancel that", "wake up", "are you ok", "emergency",
    ]) {
      const w = willingnessFor(state({ ...AT_HER_WORST, request }));
      expect(w.willing, `"${request}" must never be declined`).toBe(true);
      expect(w.reason).toMatch(/safety or boundary/);
    }
  });

  it("she can decline three times running, and no floor forces a yes", () => {
    // A real person can certainly decline three times in a row.
    //
    // This test used to assert the opposite: after two refusals the third was FORCED to yes,
    // whatever he asked and whatever she felt. A counter guaranteeing a yes, and workable from
    // outside: ask three times, the third one lands. It also contradicted the rule that her no is
    // never pushed past, in the one function that decides exactly that.
    // Her weather alone never declines: it takes what he just did as well, which is the
    // 「declining is rare, and takes several things at once」 property this file already proves. So
    // the run is tested on a state that DOES decline, or the test would be green against nothing.
    const declines = willingnessFor(state({ ...AT_HER_WORST, landed: HE_HANDLED_HER, recentDeclines: 0 }));
    expect(declines.willing, "the fixture no longer refuses at all — the run below proves nothing")
      .toBe(false);
    for (const n of [MAX_CONSECUTIVE_DECLINES, MAX_CONSECUTIVE_DECLINES + 1, 9]) {
      const w = willingnessFor(state({ ...AT_HER_WORST, landed: HE_HANDLED_HER, recentDeclines: n }));
      expect(w.willing, `after ${n} refusals she is being made willing again`).toBe(false);
      expect(w.reason, "a floor is back under her refusals").not.toMatch(/floor/u);
    }
  });

  it("and the wall still comes first, which is what the floor must never have been doing", () => {
    // Deleting the floor cannot touch safety: the boundary check returns before it ever ran.
    const w = willingnessFor(state({ ...AT_HER_WORST, recentDeclines: 9, request: "stop" }));
    expect(w.willing).toBe(true);
    expect(w.reason).toMatch(/safety or boundary/u);
  });

  it("and this is only ever about the CONTENT of a reply, never whether one comes", () => {
    // There is no path here that produces silence. The type has no way to express it.
    const w = willingnessFor(state({ ...AT_HER_WORST, landed: HE_HANDLED_HER, recentDeclines: 0 }));
    expect(Object.keys(w)).not.toContain("silent");
    expect(w.reluctance, "she is told how she feels; she still writes the reply").toBeTruthy();
  });
});

describe("declining is rare, and takes several things at once", () => {
  it("an ordinary day, an ordinary request: she just does it", () => {
    expect(willingnessFor(state()).willing).toBe(true);
  });

  it("no single thing is enough on its own", () => {
    const alone: Partial<WillingnessInputs>[] = [
      { phase: "dormant" },
      { emotion: { pleasure: -0.9, arousal: -0.9, dominance: 0 } },
      { drives: { ...CALM, discomfort: 1 } },
      { warmth: 0 },
      { temperament: { reticence: 0, novelty: 0, sociability: 0, restfulness: 0.35 } },
    ];
    for (const one of alone) {
      const r = reluctanceOf(state(one));
      expect(r, `${JSON.stringify(one).slice(0, 40)} alone`).toBeLessThan(RELUCTANCE_THRESHOLD);
    }
  });

  it("NOT EVEN EVERYTHING ON HER SIDE AT ONCE — her weather is never the reason", () => {
    // This assertion is the reverse of what it used to be, and the reversal is the point. The old
    // gate was a weighted sum whose terms came to 1.41 against a bar of 0.78, so the worst day she
    // could have refused him whatever he said and however he said it. Being tired is a reason to
    // do it worse; it is not a reason to say no.
    const r = reluctanceOf(state(AT_HER_WORST));
    console.log(`\n  spent, weary, flat, preoccupied and it has been cold: reluctance ${r.toFixed(2)} (bar ${RELUCTANCE_THRESHOLD})`);
    expect(r).toBeLessThan(RELUCTANCE_THRESHOLD);
    expect(willingnessFor(state(AT_HER_WORST)).willing).toBe(true);
  });

  it("it takes something HE did, on top of a day that was already going badly", () => {
    // The reachable corner, and it is a narrow one: 0.08% of the states swept in
    // `reachable-reluctance.test.ts` cross this bar, and every one of them crosses it because of
    // something he did rather than because of how she was.
    const bad = { ...AT_HER_WORST, phase: "normal" as const, emotion: { pleasure: -0.8, arousal: 0.6, dominance: -0.3 } };
    const w = willingnessFor(state({ ...bad, landed: HE_HANDLED_HER }));
    console.log(`  the same day, and he handled her: reluctance ${w.felt.toFixed(2)} (bar ${RELUCTANCE_THRESHOLD})`);
    expect(w.felt).toBeGreaterThanOrEqual(RELUCTANCE_THRESHOLD);
    expect(w.willing).toBe(false);
    // And the same message with nothing behind it does not: he is the difference, not the day.
    expect(willingnessFor(state(bad)).willing, "the bad day alone refused him").toBe(true);
  });

  it("WORN THROUGH IS NOT THE ROAD TO SAYING NO — it is the road to it staying", () => {
    // `wronged` is scaled by what she has in her, so the identical message from the identical man
    // produces a smaller objection when she is spent, she does it anyway, and `settles` carries
    // it into how she sees him. A design where exhaustion produced refusals would have her
    // withdraw exactly when she has least, which is the shape of something breaking.
    const spent = willingnessFor(state({
      ...AT_HER_WORST,
      landed: { ...HE_HANDLED_HER, appraised: { ...HE_HANDLED_HER.appraised, herPower: 0.4 } },
    }));
    expect(spent.willing, "being exhausted became a way of refusing him").toBe(true);
  });

  it("being on good terms makes her readier, and a cold stretch less so", () => {
    const base = { ...AT_HER_WORST, warmth: undefined };
    expect(reluctanceOf(state({ ...base, warmth: 0.95 })))
      .toBeLessThan(reluctanceOf(state({ ...base, warmth: 0.05 })));
  });

  it("what she is told is a fact about herself, never a script", () => {
    const w = willingnessFor(state({
      ...AT_HER_WORST, phase: "normal", emotion: { pleasure: -0.8, arousal: 0.6, dominance: -0.3 },
      landed: HE_HANDLED_HER,
    }));
    expect(w.reluctance).toMatch(/是你自己的事/);
    expect(w.reluctance, "it must not tell her to refuse").not.toMatch(/you should|say no|refuse|tell him/i);
    expect(w.reluctance, "and it must leave doing it open").toMatch(/你也可以照做/);
  });
});

describe("it never throws and never fails toward unwilling", () => {
  it("survives nonsense", () => {
    const nasty: Partial<WillingnessInputs>[] = [
      { emotion: { pleasure: Number.NaN, arousal: Number.NaN, dominance: 0 } },
      { warmth: Number.NaN },
      { warmth: 99 },
      { recentDeclines: -5 },
      { request: "" },
      { drives: { ...CALM, discomfort: Number.NaN } },
    ];
    for (const one of nasty) {
      const w = willingnessFor(state(one));
      expect(typeof w.willing).toBe("boolean");
      expect(Number.isFinite(reluctanceOf(state(one)))).toBe(true);
    }
  });

  it("an empty request is not a safety instruction and not a reason to refuse", () => {
    expect(willingnessFor(state({ request: "" })).willing).toBe(true);
  });
});
