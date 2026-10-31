import { describe, it, expect } from "vitest";
import { lifeTick, type LifeTickInput, type LifeTickSinks } from "../../../src/life/tick.js";
import { createInnerState } from "../../../src/life/inner-state.js";
import type { Thought } from "../../../src/life/expression.js";
import type { DriveName } from "../../../src/life/drives.js";

const HOUR = 3_600_000;

function thought(text: string, intrinsic: number, complaint = false): Thought {
  return { id: text, text, source: "curiosity", bornMs: 0, intrinsic, constraintComplaint: complaint };
}

function input(p: Partial<LifeTickInput>): LifeTickInput {
  return {
    nowMs: HOUR,
    recentEvents: [],
    hoursSinceUser: 2,
    budgetLow: false,
    timezoneOffsetHours: 0,
    phase: "normal",
    awake: true,
    clockActivity: 0.8,
    present: true,
    available: true,
    consecutiveNonReplies: 0,
    sendsInLastDay: 0,
    recentDominants: [],
    generateThoughts: () => [],
    ...p,
  };
}

function sinks(): LifeTickSinks & { pushes: string[]; diary: string[]; alarms: [string, string][] } {
  const pushes: string[] = [];
  const diary: string[] = [];
  const alarms: [string, string][] = [];
  return {
    pushes, diary, alarms,
    push: (t) => pushes.push(t),
    diarize: (t) => diary.push(t),
    alarm: (k, d) => alarms.push([k, d]),
  };
}

describe("life tick (autonomous loop)", () => {
  it("updates the inner state and returns mood + dominant drive", () => {
    const is = createInnerState();
    const s = sinks();
    const r = lifeTick(is, input({}), s);
    expect(typeof r.mood).toBe("string");
    expect(r.dominant).toBeDefined();
  });

  it("fires the pinning alarm when one drive dominates recent activity", () => {
    const is = createInnerState();
    const s = sinks();
    const pinned: DriveName[] = ["curiosity", "curiosity", "curiosity", "curiosity"];
    lifeTick(is, input({ recentDominants: pinned }), s);
    expect(s.alarms.some(([k]) => k === "pinned")).toBe(true);
  });

  it("fires the starvation alarm after a week of owner silence", () => {
    const is = createInnerState();
    const s = sinks();
    lifeTick(is, input({ hoursSinceUser: 200 }), s);
    expect(s.alarms.some(([k]) => k === "starvation")).toBe(true);
  });

  it("pushes a motivated, benign thought when Eric is present", () => {
    const is = createInnerState();
    const s = sinks();
    lifeTick(is, input({ generateThoughts: () => [thought("I found something interesting about caching", 0.9)] }), s);
    expect(s.pushes.length).toBe(1);
  });

  it("diarizes rather than pushes when Eric is absent", () => {
    const is = createInnerState();
    const s = sinks();
    lifeTick(is, input({ present: false, generateThoughts: () => [thought("a stray thought", 0.9)] }), s);
    expect(s.pushes.length).toBe(0);
    expect(s.diary.length).toBe(1);
  });

  it("blocks an outbound complaint even if it clears the gate (consent boundary)", () => {
    const is = createInnerState();
    const s = sinks();
    // A high-motivation thought whose TEXT is a complaint but the flag wasn't set.
    lifeTick(is, input({ generateThoughts: () => [thought("you never let me finish my own projects", 0.95, false)] }), s);
    expect(s.pushes.length).toBe(0); // blocked outbound
    expect(s.diary.length).toBe(1); // sent to the diary instead
  });
});
