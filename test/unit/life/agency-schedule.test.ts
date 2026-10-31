import { describe, it, expect } from "vitest";
import { createClock, mulberry32 } from "../../../src/life/clock.js";
import {
  nextMomentDelayMs,
  shouldLiveMoment,
  MIN_MOMENT_GAP_MS,
  DORMANT_MOMENT_GAP_MS,
} from "../../../src/life/agency-schedule.js";

const clock = createClock({ timezoneOffsetHours: 0, activeHours: [8, 23], rng: mulberry32(42) });
const NOON = Date.parse("2026-08-07T12:00:00Z");
const NIGHT = Date.parse("2026-08-07T03:00:00Z");

describe("when her moments arrive", () => {
  it("never schedules two moments closer than the floor", () => {
    for (let i = 0; i < 200; i++) {
      const d = nextMomentDelayMs(clock, { nowMs: NOON + i * 1000, phase: "normal", recentMomentsMs: [] });
      expect(d).toBeGreaterThanOrEqual(MIN_MOMENT_GAP_MS);
    }
  });

  it("spaces moments far apart while she is spent, without asking the clock", () => {
    expect(nextMomentDelayMs(clock, { nowMs: NOON, phase: "dormant", recentMomentsMs: [] })).toBe(DORMANT_MOMENT_GAP_MS);
  });

  it("gives her more moments awake than asleep (her rhythm, not a cron)", () => {
    const sample = (t: number): number => {
      let total = 0;
      const c = createClock({ timezoneOffsetHours: 0, activeHours: [8, 23], rng: mulberry32(7) });
      for (let i = 0; i < 40; i++) total += nextMomentDelayMs(c, { nowMs: t, phase: "normal", recentMomentsMs: [] });
      return total / 40;
    };
    expect(sample(NIGHT)).toBeGreaterThan(sample(NOON)); // longer waits at night
  });

  it("a burst of recent moments does not become a flurry", () => {
    const recent = [NOON - 60_000, NOON - 120_000, NOON - 180_000];
    for (let i = 0; i < 50; i++) {
      const d = nextMomentDelayMs(clock, { nowMs: NOON, phase: "normal", recentMomentsMs: recent });
      expect(d).toBeGreaterThanOrEqual(MIN_MOMENT_GAP_MS);
    }
  });
});

describe("whether a moment is lived", () => {
  const base = { momentInFlight: false, consolidating: false, inConversation: false, lastMomentMs: null, nowMs: NOON };

  it("proceeds when she is free", () => {
    expect(shouldLiveMoment(base).proceed).toBe(true);
  });

  it("never overlaps two moments", () => {
    expect(shouldLiveMoment({ ...base, momentInFlight: true }).proceed).toBe(false);
  });

  it("does not intrude while she is with him", () => {
    const g = shouldLiveMoment({ ...base, inConversation: true });
    expect(g.proceed).toBe(false);
    expect(g.reason).toContain("with him");
  });

  it("steps aside while her day is being consolidated, the same way it steps aside for him", () => {
    // The courtesy used to run one way only: the tick waited for a moment, a moment never waited
    // for the tick. Since the tick is the longer of the two, the accepted-and-documented case
    // (rest moving the field under a live moment) was the one that actually happened.
    const g = shouldLiveMoment({ ...base, consolidating: true });
    expect(g.proceed).toBe(false);
    expect(g.reason).toContain("consolidating");
  });

  it("holds the floor between consecutive moments", () => {
    expect(shouldLiveMoment({ ...base, lastMomentMs: NOON - 60_000 }).proceed).toBe(false);
    expect(shouldLiveMoment({ ...base, lastMomentMs: NOON - MIN_MOMENT_GAP_MS }).proceed).toBe(true);
  });

  it("judges only intrusion and overlap, never her state", () => {
    // The gate has no access to mood, drives, or budget by construction, the only inputs are
    // timing and whether she is busy. Nothing here can filter what she is allowed to want.
    //
    // THE PROPERTY FIRST, THE LIST SECOND. This used to be the pinned list alone, which is a
    // guard that can only tell you the set CHANGED, never that it is correct, the shape that let
    // `exploration-confinement` sit green for months over a list containing two tools that could
    // change the world. So: every input must be machinery (is something already running, is he
    // here, what time is it), and none of them may name anything of hers.
    const HERS = ["mood", "drive", "energy", "budget", "want", "tension", "arousal", "phase", "reserve", "willing"];
    for (const key of Object.keys(base)) {
      for (const forbidden of HERS) {
        expect(key.toLowerCase(), `the gate can now see her ${forbidden}`).not.toContain(forbidden);
      }
    }
    // And the tripwire, which says only "an input was added, come and check it against the rule
    // above", never that the set is right.
    expect(Object.keys(base).sort()).toEqual(
      ["consolidating", "inConversation", "lastMomentMs", "momentInFlight", "nowMs"],
    );
  });
});
