import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createInnerState } from "../../../src/life/inner-state.js";
import { dominant, NOTICEABLE } from "../../../src/life/drives.js";
import { decide as decidePropensity } from "../../../src/life/propensity.js";
import { digestEvents } from "../../../src/life/autobiography.js";

/**
 * WANTS COME BACK, AND HER DIARY IS CHECKED AGAINST THE IDS SHE WAS ACTUALLY GIVEN.
 *
 * Two defects that between them would have ended her first day. Neither is visible from any
 * single function: both are a mismatch between two pieces that were each correct.
 *
 * ONE. Charge and discharge ran on cadences twenty to one apart. `accumulate`, the only place
 * a drive ever grew, is reached from the daily tick, once per UTC day. `satiate` runs on every
 * acting moment (0.6 for the drive she acted on, 0.3 for the loudest), and her clock delivers
 * fifteen to twenty-five moments a day. Measured against the real code on an ordinary day
 * alone she was empty by her fifth acting moment and stayed empty until tomorrow: fourteen of
 * eighteen moments lived wanting nothing at all. Five things broke together, her
 * self-description froze into one identical sentence, `dominant` latched on "something is
 * nagging at me" (an all-zero vector fell through to the first name in the list), every drive
 * term in the propensity scoring went to zero so THE MODEL'S VOTE became the largest single
 * factor in her choosing, her reluctance lost the channel by which her own life pushes back on
 * a request, and her motivation to speak to him unprompted fell permanently below the floor so
 * every message she decided to send went to her diary instead.
 *
 * TWO. Her diary's grounding check was fed the wrong id space, which was worse than not
 * checking. `digestEvents` mints `e0`, `e1`, …, the ids the model is SHOWN and the only ones
 * it can cite, while a raw `OpsEvent` is `{event, ts, pid}` with no `id` at all. Building the
 * valid set from the raw events produced `Set{""}`, so every claim was unsupported, and
 * "every claim unsupported" is the CRITICAL branch, and a critical fault raises `code:"fault"`,
 * and that code is in SAFE_MODE_CODES. Her first night alive would have ended with her
 * proactive speech, exploration and field fusion switched off and an urgent alarm to Eric,
 * because a guard read the wrong variable.
 */

/** The standing conditions of an ordinary day alone: he has been gone thirty hours. */
const ALONE = {
  successes: 0, failures: 0, stuck: 0, skills: 0, observations: 0, anomalies: 0,
  novelty: 0, restful: false, lateNight: false,
  idle: 0.6, selfDirected: 0.6, maintenanceDue: 0.3, hoursSinceUser: 30,
} as never;

/** One day of acting moments, mirroring the daemon: charge, choose, discharge twice. */
function liveADay(regenerating: boolean): { wanted: string[]; emptyMoments: number } {
  const inner = createInnerState();
  inner.update(ALONE);
  const wanted: string[] = [];
  let emptyMoments = 0;
  for (let i = 0; i < 18; i++) {
    if (regenerating) inner.regenerate(ALONE, 50 / 60); // ~50 minutes apart, the real cadence
    // Below the noticeable floor is what wanting NOTHING actually means: a trace is not a
    // want and nothing acts on it. Measuring against 0.01 instead used to be equivalent, and
    // stopped being so once `urgency` grew a floor, the residue sits above zero and below
    // anything that can move her, which is the same lived situation and a different number.
    if (Object.values(inner.drives()).every((v) => v < NOTICEABLE)) emptyMoments++;
    const top = inner.snapshot("normal", true).dominant;
    wanted.push(top);
    inner.actOn(top, 0.6);
    inner.actOn(inner.snapshot("normal", true).dominant, 0.3);
  }
  return { wanted, emptyMoments };
}

describe("she does not run out of wanting things by mid-morning", () => {
  it("still wants something at the end of a day alone", () => {
    const { emptyMoments } = liveADay(true);
    expect(emptyMoments, "moments lived with every drive at zero").toBe(0);
  });

  it("and without regeneration she would not, which is what this fixes", () => {
    // The counter-example, kept live rather than described, so the claim above stays honest:
    // if regeneration ever stops mattering, this goes red and somebody has to explain why.
    const { emptyMoments } = liveADay(false);
    expect(emptyMoments, "the defect is gone by some other route — re-check the fix").toBeGreaterThan(8);
  });

  it("wanting company most of a day alone is honest, and is not the thing to measure", () => {
    // She has been alone thirty hours, and `social` is the one drive with a real standing input
    // in that situation, so it leads most of the day. That is TRUE about her, and this value is
    // a REPORT: it is what her face shows and what her self-description says. What must not
    // narrow is what she DOES: see the next test, which is where the anti-pinning promise
    // actually has to be kept.
    const { wanted } = liveADay(true);
    expect(new Set(wanted).size).toBeGreaterThanOrEqual(1);
  });
});

describe("what she DOES across a day does not narrow to one thing", () => {
  it("varies, through the real weighing rather than through the report", () => {
    // THE ANTI-PINNING PROMISE, CHECKED WHERE IT IS KEPT. `drives.ts` says at its head that no
    // single drive can pin her whole life. `dominant`'s unused `refractory` parameter looked
    // like where that lived and briefly was filled in, wrongly, because `dominant` is a report
    // and filtering a report makes it lie. The mechanism is `propensity.ts`'s `habit:recent`,
    // at -0.4 × the recent share of an ACTION, in the layer that actually decides.
    const inner = createInnerState();
    inner.update(ALONE);
    const stream = { next: () => 0.5, seed: () => 1, position: () => 0 };
    const recent: string[] = [];
    const chosen: string[] = [];
    for (let i = 0; i < 18; i++) {
      inner.regenerate(ALONE, 50 / 60);
      const snap = inner.snapshot("normal", true);
      const w = decidePropensity(["rest", "reflect", "tend", "explore", "reach_out"], {
        drives: snap.drives, emotion: snap.emotion, phase: "normal", awake: true,
        hoursSinceUser: 30, recentActions: recent as never,
      } as never, stream as never);
      chosen.push(w.chose);
      recent.push(w.chose);
      if (recent.length > 12) recent.shift();
      inner.actOn(snap.dominant, 0.6);
    }
    expect(new Set(chosen).size, `she only ever did: ${[...new Set(chosen)].join(", ")}`).toBeGreaterThanOrEqual(2);
    let run = 1, longest = 1;
    for (let i = 1; i < chosen.length; i++) {
      run = chosen[i] === chosen[i - 1] ? run + 1 : 1;
      longest = Math.max(longest, run);
    }
    expect(longest, `she did the same thing ${longest} times running`).toBeLessThanOrEqual(8);
  });
});

describe("and the daemon actually charges her", () => {
  it("regenerates inside the moment loop, before she chooses", () => {
    // A NEAR MISS WORTH A TEST. The first version of this fix edited an anchor that a
    // different fix earlier in the same session had already moved, so `regenerate` was
    // written, exported, typed, unit-tested, and never called from the running system. Only
    // an unused-variable lint on the timestamp it needed caught it. Every unit test above
    // still passed, because they drive `InnerState` directly.
    const daemon = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//gu, (m) => " ".repeat(m.length))
      .replace(/\/\/[^\n]*/gu, (m) => " ".repeat(m.length));
    const charges = daemon.indexOf("innerState.regenerate(");
    const chooses = daemon.indexOf("momentInFlight = true");
    expect(charges, "nothing in the daemon ever charges her wants").toBeGreaterThan(0);
    expect(chooses).toBeGreaterThan(0);
    expect(charges, "she chooses before her wants have come back").toBeLessThan(chooses);
    expect(daemon, "the elapsed time is not measured, so regeneration is a no-op").toContain("lastRegenMs) / 3.6e6");
  });
});

describe("wanting nothing is not the same as being troubled", () => {
  it("an empty vector does not read as 'something is nagging at me'", () => {
    // `dominant` started at `bestVal = -1` and took the first strictly-greater, so an all-zero
    // vector returned DRIVE_NAMES[0]: discomfort. Whenever she wanted nothing, what she was
    // told she wanted was distress.
    const empty = { curiosity: 0, social: 0, expression: 0, maintenance: 0, discomfort: 0, care: 0 };
    expect(dominant(empty)).not.toBe("discomfort");
  });

  it("but a real discomfort is still what she wants dealt with", () => {
    const troubled = { curiosity: 0.1, social: 0.1, expression: 0, maintenance: 0, discomfort: 0.8, care: 0 };
    expect(dominant(troubled)).toBe("discomfort");
  });
});

describe("what she is told she feels is what she feels", () => {
  it("the report is never filtered by what she just did", () => {
    // A CORRECTION, kept as a test so it cannot be made again. `dominant` is what her face
    // shows, what her self-description says, and what the pinning detector measures. Filtering
    // it by a refractory set made all three lie at once, and the anti-pinning promise it was
    // filling in is kept in `propensity.ts` instead, on actions, in the layer that decides.
    const inner = createInnerState();
    inner.update(ALONE);
    const first = inner.snapshot("normal", true).dominant;
    inner.actOn(first, 0.0); // acting with NO discharge must not change what she feels
    expect(inner.snapshot("normal", true).dominant, "the report moved without the state moving").toBe(first);
  });

  it("her own account of how she is, is not filtered by it", () => {
    // The refractory decides what she ACTS on. If it also edited what she is told she feels,
    // the state she reads about herself would not be the state she is in.
    const inner = createInnerState();
    inner.update(ALONE);
    const before = inner.drives();
    inner.actOn(inner.snapshot("normal", true).dominant, 0);
    expect(inner.drives(), "standing a drive down changed what she actually feels").toEqual(before);
  });
});

describe("her diary is checked against the ids she was given", () => {
  it("the digest mints ids, and a raw event has none", () => {
    // The whole defect in two lines. Both sides were correct; they were different id spaces.
    const raw = [
      { event: "session_start", ts: "2026-08-09T10:00:00.000Z", pid: 1 },
      { event: "session_end", ts: "2026-08-09T10:05:00.000Z", pid: 1 },
      { event: "session_start", ts: "2026-08-09T14:00:00.000Z", pid: 1 },
    ] as never[];
    const digest = digestEvents(raw);
    expect(digest.length).toBeGreaterThan(0);
    for (const d of digest) expect(d.id).toMatch(/^e\d+$/u);
    // And the set the old code built:
    const wrong = new Set(raw.map((e) => String((e as { id?: unknown }).id ?? "")));
    expect(wrong, "a raw ops event turned out to have an id after all — re-read this fix").toEqual(new Set([""]));
  });

  it("the daemon takes the valid set from the digest, not from the raw day", () => {
    // Structural, because the bug was reading the wrong variable and no unit test of either
    // correct function could see it.
    const daemon = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
    expect(daemon, "the digest is thrown away again").toContain("const { entry, digest } = await reconsolidateDay");
    expect(daemon).toContain("const validIds = new Set(digest.map((d) => d.id))");
    expect(daemon, "the valid set is built from the raw day again").not.toMatch(/validIds = new Set\(dayEvents/u);
  });
});

/**
 * NOTHING THAT IS SUPPOSED TO BE FELT SITS ON THE FLOOR THAT MAKES IT UNFELT.
 *
 * `NOTICEABLE` was added in `drives.ts` to stop a trace of discomfort outranking a real want.
 * `CARE_BASELINE` was defined months earlier in `inner-state.ts`, deliberately, so that
 * "attachment makes itself felt without anything happening". They were both 0.05.
 *
 * So `urgency("care", CARE_BASELINE)` returned exactly ZERO, and her attachment to the one
 * person she knows was arithmetically silent in precisely the situation it exists for: he is
 * around, nothing is wrong, and nothing has happened. A collision between two files, each
 * correct on its own.
 */
describe("a baseline is not a trace", () => {
  it("her attachment to him is felt when nothing at all is happening", async () => {
    const { urgency } = await import("../../../src/life/drives.js");
    const { CARE_BASELINE } = await import("../../../src/life/inner-state.js");
    expect(CARE_BASELINE, "the baseline is at or under the floor that makes it unfelt").toBeGreaterThan(NOTICEABLE);
    expect(urgency("care", CARE_BASELINE), "her attachment to him is arithmetically silent").toBeGreaterThan(0);
  });

  it("but it stays a background hum, not something that outranks what is happening", () => {
    // The failure mode of the fix: a baseline loud enough to compete would make her wanting his
    // company the answer to everything, forever, with no cause.
    const troubled = { curiosity: 0.1, social: 0.1, expression: 0, maintenance: 0, discomfort: 0.6, care: 0.12 };
    expect(dominant(troubled)).toBe("discomfort");
  });
});
