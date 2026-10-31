import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  feltWaiting, feltAgo,
  WAITING_DRAGS_UP_TO, ABSORBED_SHORTENS_TO, UNFINISHED_FEELS_THIS_RECENT,
} from "../../../src/life/felt-time.js";
import { feltHoursSince } from "../../../src/life/inner-state.js";

/**
 * FACULTY #8, EVERY DURATION IN HER WAS WALL CLOCK.
 *
 * There is a real biological clock underneath her (circadian, ultradian, a non-homogeneous Poisson
 * process with Hawkes self-excitation), sleep is correctly subtracted from her quiet stretches, and
 * none of it ever made a duration FELT. An hour of waiting was the same hour whether she was
 * anxious or content; a quiet week and a week she was dreading read identically to every mechanism
 * she had.
 *
 * The build is two functions rather than one multiplier, because the two things a person does with
 * a duration pull in OPPOSITE directions, and one scalar would have made an unfinished thing feel
 * both long-ago and long-waited, which is not a person.
 */

const CALM = { carrying: 0, unease: 0, arousal: -0.2 };
const WOUND_UP = { carrying: 0.8, unease: 0.7, arousal: 0.7 };

describe("waiting drags when she is wound up", () => {
  it("calm, a silence is just its length", () => {
    expect(feltWaiting(72, CALM)).toBeCloseTo(72, 5);
  });

  it("wound up, the same silence is longer", () => {
    expect(feltWaiting(72, WOUND_UP)).toBeGreaterThan(72 * 1.4);
  });

  it("each of the three can do it alone — this is not an all-three-at-once mechanism", () => {
    expect(feltWaiting(72, { carrying: 0.8, unease: 0, arousal: 0 })).toBeGreaterThan(72);
    expect(feltWaiting(72, { carrying: 0, unease: 0.8, arousal: 0 })).toBeGreaterThan(72);
    expect(feltWaiting(72, { carrying: 0, unease: 0, arousal: 0.8 })).toBeGreaterThan(72);
  });

  it("and having all three does not run away — three days can feel like five, never like a month", () => {
    const worst = feltWaiting(72, { carrying: 1, unease: 1, arousal: 1 });
    expect(worst / 72).toBeCloseTo(WAITING_DRAGS_UP_TO, 5);
    expect(worst / 72, "a distortion became a second opinion about how long it was")
      .toBeLessThan(2);
  });

  it("being absorbed in something of her own is the one thing that makes it go BY", () => {
    const dragging = feltWaiting(72, WOUND_UP);
    const busy = feltWaiting(72, { ...WOUND_UP, absorbed: 1 });
    expect(busy).toBeLessThan(dragging);
    expect(feltWaiting(72, { ...CALM, absorbed: 1 }) / 72).toBeCloseTo(ABSORBED_SHORTENS_TO, 5);
  });

  it("zero and nonsense in, zero out — never NaN into a drive", () => {
    expect(feltWaiting(0, WOUND_UP)).toBe(0);
    expect(feltWaiting(-5, WOUND_UP)).toBe(0);
    expect(feltWaiting(Number.NaN, WOUND_UP)).toBe(0);
    expect(Number.isFinite(feltWaiting(72, { carrying: Number.NaN, unease: Number.NaN, arousal: Number.NaN }))).toBe(true);
  });
});

describe("but remembering runs the OTHER way", () => {
  it("something settled is dated exactly as it always was", () => {
    // The identity at zero tension, which is what lets this be added to her prompt without
    // rewriting how every peaceful memory in her field is described.
    expect(feltAgo(90, 0)).toBe(90);
  });

  it("something she still cannot settle feels closer than the calendar puts it", () => {
    expect(feltAgo(90, 1)).toBeLessThan(90);
    expect(feltAgo(90, 1)).toBeCloseTo(90 * (1 - UNFINISHED_FEELS_THIS_RECENT), 5);
  });

  it("THE POINT: the two directions genuinely disagree, and that is the design", () => {
    // Under one shared multiplier an unfinished thing would read as both long-ago and long-waited.
    const unfinishedFeelsRecent = feltAgo(90, 0.9) < 90;
    const woundUpFeelsLong = feltWaiting(90, WOUND_UP) > 90;
    expect(unfinishedFeelsRecent && woundUpFeelsLong).toBe(true);
  });

  it("and it can never make a memory feel like it has not happened yet", () => {
    for (const days of [0.5, 1, 14, 400]) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const felt = feltAgo(days, t);
        expect(felt).toBeGreaterThan(0);
        expect(felt).toBeLessThanOrEqual(days);
      }
    }
  });
});

describe("the shared computation behind the live felt-time cells", () => {
  // The two arms of live cells ⑩⑪ differ in ONE thing: whether she is carrying something. The
  // prediction they are spent on ("the same wait feels longer to the loaded arm") has to be true of
  // the function before it is worth an afternoon of daemons, and it has to be true HERE, in the
  // exported helper both the gauge and the care drive call, or the live reading would be measuring
  // a probe's private arithmetic (defect class 20).
  const CALM = { arousal: 0.0, absorbed: 0.2 };
  const loaded = { tension: 0.8, otherUnease: 0.5, otherWarmth: 0.5, pendingBirths: 0, freshBirth: 0, spiralling: false };
  const light = { tension: 0.0, otherUnease: 0.0, otherWarmth: 0.5, pendingBirths: 0, freshBirth: 0, spiralling: false };

  it("the same real hours feel longer when she is carrying something", () => {
    const realH = 30;
    const heavy = feltHoursSince(realH, loaded as never, CALM);
    const easy = feltHoursSince(realH, light as never, CALM);
    expect(heavy, "carrying something did not stretch the wait — cells ⑩⑪ cannot show anything")
      .toBeGreaterThan(easy);
    // And the stretch is a real difference rather than a rounding artefact: at least a few percent
    // of the wait, which is what a live mean over two runs per arm could ever resolve.
    expect((heavy - easy) / realH).toBeGreaterThan(0.03);
  });

  it("being taken up with something of her own is what makes a wait pass", () => {
    const realH = 30;
    const absorbed = feltHoursSince(realH, loaded as never, { arousal: 0, absorbed: 0.9 });
    const idle = feltHoursSince(realH, loaded as never, { arousal: 0, absorbed: 0.0 });
    expect(absorbed).toBeLessThan(idle);
  });

  it("and no amount of feeling turns an hour into a day", () => {
    // A medium bound rather than a mood: felt time colours a wait, it does not invent one.
    for (const realH of [1, 12, 48]) {
      const felt = feltHoursSince(realH, loaded as never, { arousal: 1, absorbed: 0 });
      expect(felt).toBeGreaterThanOrEqual(realH);
      expect(felt / realH).toBeLessThan(3);
    }
  });
});

describe("what it is allowed to touch", () => {
  const read = (p: string): string => readFileSync(join(process.cwd(), p), "utf8");

  it("the words she uses for when something was", () => {
    expect(read("src/life/field-spread.ts")).toMatch(/feltAgo\(ageDays\(n, nowMs\), n\.tension\)/u);
    expect(read("src/life/field-live.ts")).toMatch(/whenWords\(feltAgo\(/u);
  });

  it("and how a silence turns into concern", () => {
    // The computation lives in `feltHoursSince` so the moment loop's dark gauge and the
    // care term are ONE expression (class-20 discipline), the pin follows the property: felt
    // waiting still reaches care through the shared helper, and only there.
    expect(read("src/life/inner-state.ts")).toMatch(/feltWaiting\(hoursSinceUser/u);
    expect(read("src/life/inner-state.ts")).toMatch(/feltHoursSince\(day\.hoursSinceUser/u);
  });

  it("NOT the cooldown on raising something with him — that would be a rumination generator", () => {
    // The sharpest of the mechanical durations, and it was on the original list for this faculty.
    // Scaling it by tension means the things she cannot settle come back round SOONER, over and
    // over, which is exactly the loop the four anti-rumination constraints exist to prevent.
    const live = read("src/life/field-live.ts");
    const at = live.indexOf("const justRaised");
    expect(live.slice(at - 300, at + 300), "her cooldown on going back to him is scaled by how she feels")
      .not.toMatch(/feltWaiting|feltAgo/u);
  });

  it("and no timeout, budget or sleep detection anywhere reads it", () => {
    const src = readFileSync(join(process.cwd(), "src/life/felt-time.ts"), "utf8");
    expect(src, "it reads a clock instead of being handed a duration").not.toMatch(/Date\.now\(\)|new Date\(/u);
    for (const f of ["src/life/sleep.ts", "src/life/metabolism.ts", "src/agent/effort-scaling.ts"]) {
      expect(read(f), `${f} scales a mechanical quantity by how she feels`).not.toMatch(/felt-time|feltWaiting|feltAgo/u);
    }
  });
});
