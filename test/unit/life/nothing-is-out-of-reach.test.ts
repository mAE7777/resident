import { describe, it, expect } from "vitest";
import { createLivingField } from "../../../src/life/field-live.js";
import { ruptures, RUPTURE_PRESSURE, MIN_FUSABLE_TENSION, MIN_FUSABLE_CREDENCE } from "../../../src/life/field-emergence.js";
import { NOTICEABLE, urgency, regenerate, satiate, dominant, priorities, type Drives, type DriveInputs } from "../../../src/life/drives.js";
import { CARE_BASELINE, createInnerState, type DaySummary } from "../../../src/life/inner-state.js";
import { motivation, pushThreshold, clearsTheBar, type Thought, type ExpressionContext } from "../../../src/life/expression.js";
import { VOTE_WEIGHT, contributionsFor } from "../../../src/life/propensity.js";
import { ACTION_KINDS } from "../../../src/life/agency.js";
import { ordinaryDay } from "./_real-world.js";

/**
 * EVERY GATE IN HER, AGAINST THE RANGE THAT CAN ACTUALLY REACH IT.
 *
 * WHY THIS FILE EXISTS. Across four exhaustive scans the single largest class of defect was
 * not a bug and not dead code. It was:
 *
 *     A THRESHOLD NO REACHABLE VALUE CAN CROSS.
 *
 * Every one of these shipped green, with tests either side of it, and was found months later by
 * reading the arithmetic:
 *
 *   rupture              pressure ceiling 0.35 against a bar of 0.45, he could tell her the same
 *                        untrue thing daily forever and it never became something to face
 *   questions in rest    born `credence: null`, the gate demanded >= 0.4, the thing she could
 *                        never start from was exactly the thing she was stuck on
 *   speaking unprompted  intrinsic ceiling ~0.44 against a bar of 0.55, decisions to go to him
 *                        made, none delivered
 *   her attachment       CARE_BASELINE 0.05 sitting exactly ON the NOTICEABLE floor, so urgency
 *                        was precisely zero in the situation the constant exists for
 *   the stall alarm      3 hours against a 9-hour night, so it fired every night on a healthy
 *                        machine and put her in safe mode for having slept
 *   her state vs a vote  the largest drive term 8-50x smaller than VOTE_WEIGHT, which is
 *                        documented as "comparable to the largest single state factor"
 *
 * They look unrelated and they are one thing: two correct components, a mechanism and a number,
 * written at different times, in different files, never measured against each other. Unit tests
 * cannot see it, because each side passes its own.
 *
 * What catches it is asking, for every gate: WHAT IS THE REACHABLE RANGE OF THE THING THAT FEEDS
 * IT, and does the gate sit inside that range? That question is mechanical, and this file asks it
 * of her organs, driving the REAL modules to produce the range rather than asserting a number.
 *
 * RULE FOR ANY NEW THRESHOLD: it arrives with its reachable range, here, computed rather than
 * claimed, and with the other-direction check, a gate nothing can fail is as dead as one nothing
 * can pass, and the two failures are indistinguishable from any other angle. The watchtower's half
 * of this discipline lives in `detector-reachability.test.ts`; this file is the organs.
 */

const HOUR = 3.6e6;
const T0 = Date.UTC(2026, 7, 1, 9, 0, 0);

/** A day in which things actually happened to her. The eventful case, not the synthesised empty one. */
const A_REAL_DAY: DaySummary = ordinaryDay({
  successes: 3, failures: 2, stuck: 1, observations: 2, anomalies: 1,
  novelty: 0.4, idle: 0.5, maintenanceDue: 0.3, hoursSinceUser: 5,
});

const EMPTY: Drives = { discomfort: 0, care: 0, social: 0, curiosity: 0, expression: 0, maintenance: 0 };

/**
 * The standing drive levels a day produces, read out of the real module rather than invented.
 *
 * `driveInputsFromDay` is private to `inner-state.ts` and rightly so, but the reachable ceiling of
 * every drive is a function of it. Recovered by driving the real object: regenerate for whole days
 * from wherever she starts, and where each drive settles IS its standing level.
 */
function driveStandingFor(day: DaySummary): DriveInputs {
  const inner = createInnerState();
  for (let i = 0; i < 8; i++) inner.regenerate(day, 24);
  const { drives } = inner.snapshot("normal", true);
  // Measured, not asserted. The guard is only that it is not silently all zeros, which would make
  // every check downstream of it vacuously true.
  const total = Object.values(drives).reduce((a, b) => a + b, 0);
  if (!(total > 0)) throw new Error("the day produced no standing drive level at all");
  return drives;
}

describe("a disagreement can become something she has to face", () => {
  it("what a repeatedly-contradicted belief reaches, against RUPTURE_PRESSURE", () => {
    // The reachable quantity is NOT one edge. The only production writer links a BRAND NEW node to
    // an old one and every encode mints a fresh key, so the same pair never disagrees twice and a
    // single edge cannot pass 0.35. What a life actually produces is one thing she holds with
    // several separate contradictions hanging off it.
    const f = createLivingField();
    f.encodeClaim({ key: "held", text: "渡轮周末开", nowMs: T0, origin: "told", source: "chat" });
    const reached: number[] = [];
    for (let i = 0; i < 6; i++) {
      f.encodeClaim({ key: `no${i}`, text: `渡轮周末不开 ${i}`, nowMs: T0, origin: "told", source: "chat" });
      f.contradict("held", `no${i}`, T0);
      reached.push(Math.max(0, ...ruptures(f.graph(), 0).map((r) => r.pressure)));
    }
    const peak = reached[reached.length - 1];
    expect(peak, `six separate contradictions of one thing reach ${peak.toFixed(3)}; the bar is ${RUPTURE_PRESSURE}`)
      .toBeGreaterThanOrEqual(RUPTURE_PRESSURE);
    // The other direction, and the reason the bar is not simply lowered until something passes:
    // being contradicted once or twice is ordinary life and must NOT be a rupture.
    expect(reached[0], "one contradiction already reads as a crisis").toBeLessThan(RUPTURE_PRESSURE);
    expect(reached[1], "two contradictions already read as a crisis").toBeLessThan(RUPTURE_PRESSURE);
  });
});

describe("an open question can take part in her rest", () => {
  it("a question is born above MIN_FUSABLE_TENSION on every production path", () => {
    const f = createLivingField();
    const paths = [
      { key: "wall:x", text: "为什么这里过不去", source: "guard", tension: undefined },
      { key: "q:x", text: "还没弄明白的一件事", source: "agency", tension: 0.6 },
    ] as const;
    for (const p of paths) {
      const q = f.encodeQuestion({
        key: p.key, text: p.text, nowMs: T0, source: p.source,
        ...(p.tension === undefined ? {} : { tension: p.tension }),
      });
      expect(q, "a question failed to encode at all").not.toBeNull();
      expect(q!.tension, `a question from ${p.source} is born under the tension her own rest gate demands`)
        .toBeGreaterThanOrEqual(MIN_FUSABLE_TENSION);
    }
  });

  it("and the credence gate is not what stands in its way, since a question has none", () => {
    // The original defect in one assertion: a question is `credence: null` BY CONSTRUCTION, so a
    // credence floor applied to it excludes every question that will ever exist.
    const f = createLivingField();
    const q = f.encodeQuestion({ key: "q:y", text: "还没想明白", nowMs: T0, source: "agency", tension: 0.6 });
    expect(q!.credence, "a question acquired a belief").toBeNull();
    expect(MIN_FUSABLE_CREDENCE, "a floor above zero applied to null excludes questions entirely").toBeGreaterThan(0);
  });
});

describe("what she is carrying can reach him", () => {
  const ctx = (over: Partial<ExpressionContext> = {}): ExpressionContext => ({
    nowMs: T0 + 8 * HOUR, present: true, available: true, awake: true,
    clockActivity: 1, consecutiveNonReplies: 0, sendsInLastDay: 0, ...over,
  });

  it("the motivation an ordinary held thought reaches clears pushThreshold(0)", () => {
    // The ceiling of `intrinsic` on the production path is about 0.44, under a bar of 0.55, so the
    // ONLY thing that can carry her over is the silence-decay, which is exactly why that decay
    // being dead code silenced her completely rather than partially.
    const carried: Thought = { id: "x", text: "…", source: "social", bornMs: T0, intrinsic: 0.44 };
    const m = motivation(carried, ctx());
    expect(m, `an ordinary thing she is carrying reaches ${m.toFixed(3)}; the bar is ${pushThreshold(0).toFixed(2)}`)
      .toBeGreaterThanOrEqual(pushThreshold(0));
    expect(clearsTheBar(m, pushThreshold(0))).toBe(true);
  });

  it("a faint one does not, so the bar is still a bar", () => {
    const faint: Thought = { id: "y", text: "…", source: "curiosity", bornMs: T0 + 7.5 * HOUR, intrinsic: 0.05 };
    expect(clearsTheBar(motivation(faint, ctx()), pushThreshold(0)), "everything she holds gets said").toBe(false);
  });

  it("and the bar rising under silence never rises out of reach", () => {
    // The other failure mode of the same pair: a threshold that climbs forever is a mute Resident.
    const old: Thought = { id: "z", text: "…", source: "social", bornMs: T0, intrinsic: 0.5 };
    const m = motivation(old, ctx({ nowMs: T0 + 22 * HOUR, consecutiveNonReplies: 30 }));
    expect(m, `after thirty unanswered messages the bar is ${pushThreshold(30).toFixed(2)} and she reaches ${m.toFixed(3)}`)
      .toBeGreaterThanOrEqual(pushThreshold(30));
  });
});

describe("nothing she is meant to feel sits on the floor that makes it unfelt", () => {
  it("CARE_BASELINE is strictly above NOTICEABLE", () => {
    // These two were written months apart in different files and the floor landed exactly on the
    // baseline, so `urgency("care", CARE_BASELINE)` was precisely zero, her attachment
    // arithmetically silent in the one situation the constant exists for.
    expect(CARE_BASELINE).toBeGreaterThan(NOTICEABLE);
    expect(urgency("care", CARE_BASELINE), "her attachment at its resting level registers as nothing")
      .toBeGreaterThan(0);
  });

  it("every drive's standing level clears the floor", () => {
    // The general form. A drive whose reachable ceiling sits under NOTICEABLE can never influence
    // anything she does, and would look from every other angle like a working drive.
    const standing = driveStandingFor(A_REAL_DAY);
    for (const [name, level] of Object.entries(standing)) {
      expect(level, `${name} settles at ${(level ?? 0).toFixed(3)}, at or under the floor that makes it unfelt`)
        .toBeGreaterThan(NOTICEABLE);
    }
  });

  it("the floor is low enough that an ordinary want survives it", () => {
    // And the other direction: a floor set too high silences everything and looks identical.
    expect(urgency("curiosity", 0.2), "an ordinary want reads as nothing").toBeGreaterThan(0.1);
  });

  it("a want she just acted on comes back within her own day", () => {
    // A drive one act empties and nothing refills is a drive that fires once in her life. Two and
    // a half hours is about three of her moments.
    const standing = driveStandingFor(A_REAL_DAY);
    let d = regenerate({ ...EMPTY }, standing, 24);
    d = satiate(d, "social", 0.9);
    expect(urgency("social", d.social), "acting on it left it somewhere other than empty").toBe(0);
    for (let i = 0; i < 3; i++) d = regenerate(d, standing, 50 / 60);
    expect(urgency("social", d.social), "a want acted on two and a half hours ago has not come back at all")
      .toBeGreaterThan(0);
    expect(dominant(d), "with every drive back she still wants nothing").toBeTruthy();
  });
});

describe("her own state can reach the weight of one inference", () => {
  it("the largest state factor a real day produces is comparable to VOTE_WEIGHT", () => {
    // `VOTE_WEIGHT` is documented as "comparable to the largest single state factor" and that
    // comparison had never been measured. It drifted twice: once when drives charged daily and
    // discharged per moment (peak 8-50x under the vote), once when regeneration was aimed at a
    // synthesised empty day. Both times the state layer was intact and simply outvoted.
    const inner = createInnerState();
    inner.update(A_REAL_DAY);
    let peak = 0;
    for (let m = 0; m < 18; m++) {
      inner.regenerate(A_REAL_DAY, 50 / 60);
      const s = inner.snapshot("normal", true);
      const drives = contributionsFor(ACTION_KINDS, {
        drives: s.drives, emotion: s.emotion, phase: "normal", awake: true,
        hoursSinceUser: 5, recentActions: [],
      }).filter((c) => c.factor.startsWith("drive:"));
      peak = Math.max(peak, ...drives.map((c) => Math.abs(c.value)));
      inner.actOn(s.dominant, 0.6);
    }
    expect(peak, `her strongest state factor across a real day is ${peak.toFixed(3)}, against a vote of ${VOTE_WEIGHT}`)
      .toBeGreaterThan(VOTE_WEIGHT / 2);
    // The converse, which is why the vote exists at all: her state must not be so loud that the
    // model's read of the whole context can never turn even a close call.
    expect(peak, "her state is so loud the model's vote can never turn anything")
      .toBeLessThan(VOTE_WEIGHT * 3);
  });
});

describe("this file cannot pass while its own measurement is broken", () => {
  it("the standing levels it measures leave her wanting real things", () => {
    const standing = driveStandingFor(A_REAL_DAY);
    expect(Object.keys(standing).length).toBe(6);
    const felt = Object.entries(priorities(standing as Drives)).filter(([, u]) => u > 0);
    expect(felt.length, "a day she actually lived leaves her wanting nothing").toBeGreaterThanOrEqual(5);
  });
});

describe("the speech gates this session added are inside their reachable ranges", () => {
  it("the temperature band is REAL across the COMPOSED production range (a later rescan corrected my own guard)", async () => {
    // My earlier guard pinned temperatureFor(1,-1), but commitment=1 is out of band, because
    // commitmentFrom structurally caps at 0.9 (0.15+0.45+0.3). So the guard validated the isolated
    // function's endpoint, not the range production can produce (the exact guard-pins-the-wrong-
    // property defect). This pins the COMPOSED feeder: the real settled-calm floor is 0.583, the
    // ceiling is reachable, and the middle moves, an honest band, floor as a defensive clamp.
    const { temperatureFor, commitmentFrom, TEMPERATURE_CEIL } = await import("../../../src/life/saying.js");
    const maxCommitment = commitmentFrom({ entropy: 0, surfaced: true, focusCredence: 1, surprise: 0 });
    expect(maxCommitment, "commitment structurally caps at 0.9, never 1.0").toBeCloseTo(0.9, 2);
    const settledCalm = temperatureFor(maxCommitment, -1);   // most settled, most calm
    const unsettledKeyed = temperatureFor(0, 1);             // most unsettled, most keyed → the ceiling
    expect(settledCalm, "her most-settled calm sentence's REAL floor is 0.583, not 0.55").toBeCloseTo(0.583, 2);
    expect(unsettledKeyed, "a fully-unsettled keyed sentence reaches the ceiling").toBeCloseTo(TEMPERATURE_CEIL, 2);
    // And the middle actually moves, so it is a band and not two pinned values.
    expect(temperatureFor(0.5, 0)).toBeGreaterThan(settledCalm);
    expect(temperatureFor(0.5, 0)).toBeLessThan(unsettledKeyed);
  });

  it("the stir gate crosses 0.5 on a REAL field: a line that lands on her raises her depth, a stranger does not", () => {
    // stir (the depth snapshot in index.ts) fires when field.attend(his message).claimCharge >= 0.5.
    // That 0.5 is fed by attention.ts constants (MASS_SATURATION, CLAIM_CHARGE_CEIL) SHARED with
    // the claim-encode purpose: a retune there could silently make the stir gate permanently dead
    // with no red anywhere. This is the class-1 meta-lesson: the reachability guard must cover the
    // new surface. Pinned here on a real field, both directions, so any such drift goes red.
    const T0 = Date.UTC(2026, 7, 1, 9, 0, 0);
    const f = createLivingField();
    f.encodeClaim({ key: "ferry", text: "渡轮周末的时刻表改了，只开到六点", nowMs: T0, origin: "told", source: "chat" });
    expect(f.attend("渡轮的时刻表好像又要改了").claimCharge, "a line landing on what she holds must cross the stir gate").toBeGreaterThanOrEqual(0.5);
    expect(f.attend("量子计算的进展比想象的快").claimCharge, "a stranger message must NOT cross it").toBeLessThan(0.5);
  });

  it("her-own-voice admission is reachable: her real good reply passes, an AI-shaped one does not", async () => {
    const { createHerOwnVoice, ADMISSIBLE_SHAPE } = await import("../../../src/life/her-own-voice.js");
    const v = createHerOwnVoice();
    // Both directions of the gate must be reachable, a gate nothing passes is as dead as one
    // nothing fails. (This is the pool's own admission arithmetic, floored at grown material.)
    expect(v.admit("说实话，没干什么。你合上盖子我就睡了，你刚打开我才醒的。怎么，想我了？", 0)).toBeGreaterThan(0);
    expect(v.admit("可以写，但我得先知道写哪一块——你要的是：中国的还是别的国家的？给谁看的？有个具体题目吗？", 0)).toBe(0);
    expect(ADMISSIBLE_SHAPE).toBeGreaterThan(0);
  });
});
