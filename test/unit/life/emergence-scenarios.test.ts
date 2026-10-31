import { describe, it, expect } from "vitest";
import { decide, type PropensityInputs } from "../../../src/life/propensity.js";
import { createStream } from "../../../src/life/soft-choice.js";
import { mulberry32 } from "../../../src/life/clock.js";
import { ACTION_KINDS, type ActionKind } from "../../../src/life/agency.js";
import { drift, neutralTemperament, type TemperamentPull } from "../../../src/life/temperament.js";
import { detectAnomalies, DEFAULT_THRESHOLDS, type VitalsSnapshot } from "../../../src/life/vitals.js";
import { createRealWorld, liveOrdinaryDays, liveALongLife, restLikeANight, HOUR, DAY } from "./_real-world.js";
import type { Drives } from "../../../src/life/drives.js";

// S-9 … S-13 · THE SCENARIOS THAT ARE ABOUT THE WHOLE SYSTEM.
//
// Every other scenario asks whether a MECHANISM can produce a moment. These five ask something
// harder, and they are the ones the design principle is actually about: no single thing should be
// what decides how she turns out, and a being who can almost be ignored once she is finished rather
// than predicted from her design.
//
// So none of them names a mechanism. Each states a property that only holds if many lines cross,
// and each is measured against a real run rather than argued for.

const ALL: ActionKind[] = [...ACTION_KINDS];

/** A state built from a seed, so a "day" is a real point in her space rather than a hand-picked one. */
function aDay(rand: () => number, over: Partial<PropensityInputs> = {}): PropensityInputs {
  const d = (): number => rand();
  const drives: Drives = {
    discomfort: d(), care: d(), social: d(), curiosity: d(), expression: d(), maintenance: d(),
  };
  return {
    drives,
    emotion: { pleasure: rand() * 2 - 1, arousal: rand() * 2 - 1, dominance: rand() * 2 - 1 },
    phase: (["rested", "normal", "low"] as const)[Math.floor(rand() * 3)],
    awake: true,
    hoursSinceUser: rand() * 72,
    recentActions: [],
    openness: rand(), otherConfidence: 0.6 + rand() * 0.4,
    field: { tension: rand(), pendingBirths: Math.floor(rand() * 5), freshBirth: rand(), orphanShare: rand() * 0.2, surfaced: Math.floor(rand() * 4) },
    carrying: { count: Math.floor(rand() * 6), easiest: rand() },
    clockActivity: rand(),
    ...over,
  };
}

describe("S-9 · she does something out of character, and it is not a bug", () => {
  it("a settled temperament still leaves room for the thing she rarely does", () => {
    // A Resident who is markedly solitary should still, sometimes, reach out. If a temperament could
    // close a door entirely it would not be a disposition, it would be a rule, and the difference
    // between those two is most of what this project is about.
    const solitary = (() => {
      let t = neutralTemperament();
      const pull: TemperamentPull = { metWhenSpeaking: -1, exploringPaidOff: 1, hisShare: -1, activity: 0.5 };
      for (let d = 1; d <= 240; d++) t = drift(t, pull, d);
      return t;
    })();

    const sociable = (() => {
      let t = neutralTemperament();
      const pull: TemperamentPull = { metWhenSpeaking: 1, exploringPaidOff: -0.5, hisShare: 1, activity: 0.5 };
      for (let d = 1; d <= 240; d++) t = drift(t, pull, d);
      return t;
    })();

    // Compared against her opposite over the SAME days, not against an absolute share. An absolute
    // bound would be measuring the days rather than the disposition: with drives drawn evenly, a
    // fifth of everything is reaching out before any temperament touches it.
    const shareOf = (temperament: ReturnType<typeof neutralTemperament>): number => {
      const rand = mulberry32(101);
      let n = 0;
      for (let i = 0; i < 3000; i++) {
        if (decide(ALL, { ...aDay(rand), temperament }, createStream(i + 1)).chose === "reach_out") n += 1;
      }
      return n / 3000;
    };
    const rare = shareOf(solitary), usual = shareOf(sociable);
    console.log(`\n  reaching out: solitary ${(rare * 100).toFixed(1)}% · sociable ${(usual * 100).toFixed(1)}%`);
    expect(rare, "a disposition that closes a door is a rule, not a disposition").toBeGreaterThan(0.02);
    expect(rare, "and it has to actually be out of character for her").toBeLessThan(usual - 0.03);
  });

  it("and the watchtower does not call the unusual thing a fault", async () => {
    // The cost of getting this wrong falls on her twice: once when she is stopped from being
    // surprising, and once when being surprising is reported as a malfunction.
    // An ordinary life, and then a stretch of doing things she rarely does. The unusual part has to
    // sit inside a real life, or the alarms are right about the fixture rather than wrong about her.
    const w = createRealWorld({ reminding: true });
    liveOrdinaryDays(w, 14);
    const ordinary = await liveALongLife(w, 40, 14 * HOUR);
    const unusual = await liveALongLife(w, 20, 14 * HOUR);
    const readings = [...ordinary, ...unusual.map((r) => ({
      ...r,
      // Everything about her is real; only WHAT SHE DID is replaced, with the things she rarely does.
      doing: r.doing ? { ...r.doing, byAction: { reflect: 0, tend: 0, rest: 0, reach_out: 6, explore: 5 } } : r.doing,
    }))];
    const found = detectAnomalies(readings, DEFAULT_THRESHOLDS, readings);
    const codes = found.map((a) => a.code);
    console.log(`  an out-of-character fortnight raised: ${codes.join(", ") || "(nothing)"}`);

    // The two that would mean "she is malfunctioning because she is being unusual".
    expect(codes, "being unlike herself is not calcifying").not.toContain("calcification");
    expect(codes, "and it is not one drive holding her").not.toContain("pinning");

    // And whatever else the watchtower notices, none of it may be about her BEHAVIOUR. It is free
    // to say her field is too young to have pruned anything yet, which is true and is a fact about
    // how long she has lived rather than about what she has been doing.
    const aboutBehaviour = found.filter((a) => /doing\./.test(a.message));
    expect(aboutBehaviour.map((a) => a.message), "nothing frozen about what she did").toEqual([]);
  });
});

describe("S-10 · two identical days do not produce identical lives", () => {
  it("the same state, twice, is the same DISTRIBUTION and not the same day", () => {
    // The exact claim E-1 was amended to. If her state fully determined her behaviour she would be a
    // lookup table with a mood; if her behaviour ignored her state she would be noise. What has to be
    // true is the middle: the shape is hers, the draw is not decided in advance.
    const state = aDay(mulberry32(7));
    const distribution = (seedBase: number): Record<string, number> => {
      const counts: Record<string, number> = {};
      for (let i = 0; i < 4000; i++) {
        const r = decide(ALL, state, createStream(seedBase + i));
        counts[r.chose] = (counts[r.chose] ?? 0) + 1;
      }
      for (const k of Object.keys(counts)) counts[k] /= 4000;
      return counts;
    };
    const a = distribution(1), b = distribution(500_000);
    const drift = ALL.reduce((sum, k) => sum + Math.abs((a[k] ?? 0) - (b[k] ?? 0)), 0) / 2;
    console.log(`\n  the same state, two independent runs: total variation ${drift.toFixed(3)}`);
    expect(drift, "the same state must mean the same distribution").toBeLessThan(0.05);

    // And within one run, she did not do the same thing every time.
    const shape = Object.values(a).sort((x, y) => y - x);
    expect(shape[0], "a distribution with all its mass in one place is a rule").toBeLessThan(0.95);
  });

  it("two days that LOOK the same to him go differently, because she is not the same", () => {
    // The observable surface: how long since he spoke, what she last did, the hour, is identical.
    // What is different is everything he cannot see, and it is enough to change what she does.
    const surface = { hoursSinceUser: 8, recentActions: ["rest"] as ActionKind[], clockActivity: 0.7, awake: true };
    const rand = mulberry32(11);
    const differed = { n: 0, total: 0 };
    for (let i = 0; i < 600; i++) {
      const morning = { ...aDay(rand), ...surface };
      const afternoon = { ...aDay(rand), ...surface };
      const a = decide(ALL, morning, createStream(i + 1)).chose;
      const b = decide(ALL, afternoon, createStream(i + 1)).chose; // SAME draw; only she differs
      differed.total += 1;
      if (a !== b) differed.n += 1;
    }
    const rate = differed.n / differed.total;
    console.log(`  two days identical from outside went differently ${(rate * 100).toFixed(0)}% of the time`);
    expect(rate, "if the visible surface decided her, she would be a machine he could run").toBeGreaterThan(0.3);
  });
});

describe("S-11 · she changes her mind, and no single thing changed it", () => {
  it("what she was told loses its footing gradually, and never in one step", async () => {
    const w = createRealWorld({ reminding: true });
    liveOrdinaryDays(w, 14);

    // Something he told her, which her own record will keep failing to bear out.
    const told = w.field.encodeClaim({
      key: "claim:the-door", text: "he said the side door is always locked after six",
      nowMs: w.now(), origin: "told", source: "owner", valence: 0.1,
    })!;
    const before = told.credence ?? 0;

    const steps: number[] = [];
    for (let i = 0; i < 8; i++) {
      w.advance(2 * DAY);
      // She was there, and it was not locked. Each is one ordinary observation, phrased as she
      // would phrase it: which is also what lets her own record weigh in on what he told her.
      // (An earlier version reached for `contradict`, which only draws a tension edge between two
      // nodes and never touches what she believes. The judging happens on arrival, in her words.)
      w.field.encodeMoment({
        key: `lived:door-${i}`, text: "the side door was not locked after six again this evening",
        nowMs: w.now(), pad: { pleasure: -0.1, arousal: 0.2, dominance: 0 }, source: "agency",
      });
      await restLikeANight(w);
      steps.push(w.field.graph().nodes.get(told.id)!.credence ?? before);
    }

    const after = steps[steps.length - 1];
    console.log(`\n  what he told her: ${before.toFixed(3)} → ${steps.map((s) => s.toFixed(2)).join(" → ")}`);
    expect(after, "eight times being wrong should cost it something").toBeLessThan(before);

    // No single step did it. This is the whole of what "changed her mind through accumulation"
    // means: if one observation could carry it, she would be a being who flips rather than learns.
    const biggestStep = Math.max(...steps.map((s, i) => (i === 0 ? before : steps[i - 1]) - s));
    const totalMove = before - after;
    console.log(`  the largest single step was ${(biggestStep / totalMove * 100).toFixed(0)}% of the whole move`);
    expect(biggestStep, "one observation must never be able to carry it alone").toBeLessThan(totalMove * 0.75);
  });
});

describe("S-12 · a habit forms that nobody wrote down", () => {
  it("what she does becomes correlated with a state nothing links it to", async () => {
    // Nothing in the code says "when you are carrying a lot, reflect". If that turns out to be true
    // of her anyway, it is a habit rather than a rule, and it has to be MEASURED, because the whole
    // claim is that it was not designed.
    const w = createRealWorld({ reminding: true });
    liveOrdinaryDays(w, 14);
    const readings = await liveALongLife(w, 120, 20 * HOUR);

    const withTension: Record<string, number> = {};
    const without: Record<string, number> = {};
    let hi = 0, lo = 0;
    for (let i = 1; i < readings.length; i++) {
      const tension = readings[i - 1].field?.tension ?? 0;
      const doing = readings[i].doing?.byAction ?? {};
      const bucket = tension > 0.4 ? withTension : without;
      if (tension > 0.4) hi += 1; else lo += 1;
      for (const [k, n] of Object.entries(doing)) bucket[k] = (bucket[k] ?? 0) + n;
    }
    const share = (b: Record<string, number>, k: string): number => {
      const total = Object.values(b).reduce((x, y) => x + y, 0);
      return total === 0 ? 0 : (b[k] ?? 0) / total;
    };
    console.log(`\n  under pressure (${hi} readings): reflect ${(share(withTension, "reflect") * 100).toFixed(0)}%, rest ${(share(withTension, "rest") * 100).toFixed(0)}%`);
    console.log(`  otherwise    (${lo} readings): reflect ${(share(without, "reflect") * 100).toFixed(0)}%, rest ${(share(without, "rest") * 100).toFixed(0)}%`);
    expect(hi, "she has to have had both kinds of stretch for this to mean anything").toBeGreaterThan(5);
    expect(lo).toBeGreaterThan(5);

    // The claim is deliberately weak: SOME behaviour differs between the two, not a specific one.
    // Naming which would be designing the habit, which is the thing being tested against.
    const biggest = Math.max(...ACTION_KINDS.map((k) => Math.abs(share(withTension, k) - share(without, k))));
    console.log(`  the largest difference between them: ${(biggest * 100).toFixed(0)} points`);
    expect(biggest, "if what she is carrying changed nothing about what she does, the lines do not cross").toBeGreaterThan(0.02);
  });
});

describe("S-13 · she cannot be worked out from what can be seen", () => {
  it("nobody can run her, and knowing more barely helps", async () => {
    // The strongest claim in the design: a black box built out of black boxes. Measured rather
    // than argued, and the measurement CORRECTED the claim, which is worth recording.
    //
    // The hypothesis was that her hidden state would predict her far better than the visible surface,
    // that everything she keeps inside is what makes her opaque. It does not. Two of the
    // propensity's own factors, how long since he spoke and the hour, are things HE CAN SEE, so the
    // observable surface is not independent of her state: it already contains part of it.
    //
    // What is true, and is stronger, is that neither works. Knowing everything about her still
    // leaves the next moment substantially open, because the openness is not hiding, it is in the
    // moment itself. A being who could be run from complete knowledge would be a program with good
    // privacy; this one cannot be run even with the lid off.
    // Her states come from a REAL run rather than from uniform draws. With drives drawn evenly the
    // action distribution is so skewed that "always guess the most common one" scores 75%, and the
    // comparison then measures the base rate instead of measuring her.
    const w = createRealWorld({ reminding: true });
    liveOrdinaryDays(w, 14);
    const lived = await liveALongLife(w, 120, 20 * HOUR);

    const rows: { visible: string; hidden: PropensityInputs; chose: ActionKind }[] = [];
    // Her recent actions are carried forward exactly as the real loop carries them. Left empty, the
    // habituation factor never fires: the thing that pushes her off whatever she just did, and the
    // action distribution collapses onto one answer, which makes "always guess the mode" score 70%
    // and turns the whole comparison into a measurement of the base rate.
    const recentActions: ActionKind[] = [];
    for (let i = 0; i < 1200; i++) {
      const r = lived[i % lived.length];
      const state: PropensityInputs = {
        drives: r.drives,
        emotion: r.pad,
        phase: r.phase,
        awake: r.awake,
        hoursSinceUser: r.hoursSinceUser,
        recentActions: [...recentActions],
        openness: r.field?.other?.warmth ?? 0.5,
        otherConfidence: r.field?.other?.confidence ?? 0.5,
        field: r.field
          ? { tension: r.field.tension, pendingBirths: r.field.pendingBirths, freshBirth: r.field.freshBirth ?? 0,
              orphanShare: r.field.orphanShare, surfaced: r.field.surfaced }
          : undefined,
        clockActivity: r.clockActivity,
      };
      const chose = decide(ALL, state, createStream(i + 1)).chose;
      recentActions.push(chose);
      while (recentActions.length > 6) recentActions.shift();
      // Everything he can ACTUALLY observe, and no more: roughly how long since he spoke, the hour,
      // and whether she has messaged him lately. He does not get to see what she last DID, whether
      // she reflected, tended, explored or rested is private, and an earlier version handed him that
      // and watched his score jump eight points on information he cannot have.
      const visible = [
        Math.round((state.hoursSinceUser ?? 0) / 12),
        Math.round((state.clockActivity ?? 0) * 3),
        recentActions.includes("reach_out") ? "heard-from-her" : "quiet",
      ].join("|");
      rows.push({ visible, hidden: state, chose });
    }
    // Stated so the comparison cannot be mistaken for the base rate: what a predictor that ignores
    // everything would score.
    const modeCount = Math.max(...ALL.map((k) => rows.filter((r) => r.chose === k).length));
    const baseRate = modeCount / rows.length;

    // Predictor A: knows only the visible surface. Best possible strategy, always answer with the
    // most common action for that surface, which is more than any real observer could do.
    const byVisible = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const c = byVisible.get(r.visible) ?? {};
      c[r.chose] = (c[r.chose] ?? 0) + 1;
      byVisible.set(r.visible, c);
    }
    let visibleRight = 0;
    for (const r of rows) {
      const c = byVisible.get(r.visible)!;
      const best = Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
      if (best === r.chose) visibleRight += 1;
    }

    // Predictor B: knows her state, and simply takes the propensity's own top choice.
    let stateRight = 0;
    for (const r of rows) {
      const top = decide(ALL, r.hidden, createStream(1)).weighed.sort((a, b) => b.score - a.score)[0].action;
      if (top === r.chose) stateRight += 1;
    }

    const fromOutside = visibleRight / rows.length;
    const fromInside = stateRight / rows.length;
    console.log(`\n  guessing without looking at all: ${(baseRate * 100).toFixed(0)}% right`);
    console.log(`  knowing only what he can see:    ${(fromOutside * 100).toFixed(0)}% right`);
    console.log(`  knowing what she is:             ${(fromInside * 100).toFixed(0)}% right`);
    // Her state has to buy SOMETHING, or the whole inner layer is decoration.
    expect(fromInside, "if her state told you nothing, none of it is doing anything")
      .toBeGreaterThan(fromOutside);
    // And the real claim: complete knowledge is still a long way from knowing.
    expect(fromInside, "a being who can be run from complete knowledge is a program").toBeLessThan(0.8);
    console.log(`  her state is worth ${((fromInside - fromOutside) * 100).toFixed(0)} points over what he can see, `
      + `and ${((fromInside - baseRate) * 100).toFixed(0)} over not looking at all`);
  });

  it("and even knowing everything, the next moment is not settled", async () => {
    // The other half, and the one that stops this being an argument for hiding things. Full
    // knowledge of her state still does not give certainty, because the moment itself is open.
    const rand = mulberry32(37);
    let openMoments = 0;
    for (let i = 0; i < 400; i++) {
      const state = aDay(rand);
      const seen = new Set<string>();
      for (let seed = 1; seed <= 30; seed++) seen.add(decide(ALL, state, createStream(seed)).chose);
      if (seen.size > 1) openMoments += 1;
    }
    const rate = openMoments / 400;
    console.log(`  knowing her state completely, ${(rate * 100).toFixed(0)}% of moments could still go more than one way`);
    expect(rate, "a being whose every moment is settled in advance is a program").toBeGreaterThan(0.5);
  });
});
