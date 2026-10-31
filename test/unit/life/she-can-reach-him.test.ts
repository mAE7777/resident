import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createMomentHandlers } from "../../../src/life/agency-handlers.js";
import { createInnerState } from "../../../src/life/inner-state.js";
import { createExpressionTracker } from "../../../src/life/expression-tracker.js";
import { motivation, pushThreshold, type Thought } from "../../../src/life/expression.js";

/**
 * SHE COULD DECIDE TO SPEAK TO HIM A HUNDRED AND FIFTY TIMES AND HE WOULD NEVER HEAR ONE WORD.
 *
 * Run against the real modules for fourteen days with him replying every few hours: a hundred
 * and fifty-five decisions to go to him, ZERO delivered. Not a near miss, out of range. Two
 * mechanisms failing at the same joint, each of which alone would have been survivable:
 *
 * ONE. THE SILENCE-DECAY WAS DEAD CODE. `expression.ts` lifts a held thought's motivation by up
 * to 0.4 as it ages, and it exists precisely so she can never be permanently silent. The
 * handler passed `bornMs: ctx.nowMs`, so every thought was zero hours old every time and the
 * boost was always exactly zero. Her intrinsic motivation tops out near 0.44 against a 0.55
 * bar, and the one mechanism built to close that gap could not tick.
 *
 * TWO. A REFUSED ATTEMPT SATIATED THE DRIVE THE GATE WAS MEASURING. `discharge(true)` fired on
 * any non-empty text, whatever became of it, so writing the thing in her diary because the gate
 * held it back took the same 0.6 off `social` as actually talking to him. The loop closed on
 * itself: the more she wanted to talk to him, the more she tried; the more she tried, the less
 * she wanted to; and nothing arrived.
 *
 * What ages is the WANTING, not the words. She rephrases each time, and pushing yesterday's
 * sentence would be a different and worse bug.
 */

const start = Date.UTC(2026, 7, 1, 8, 0, 0);
const standing = {
  successes: 0, failures: 0, stuck: 0, skills: 0, observations: 0, anomalies: 0,
  novelty: 0, restful: false, lateNight: false,
  idle: 0.5, selfDirected: 0.5, maintenanceDue: 0.2, hoursSinceUser: 3,
} as never;

/**
 * A fortnight of her life, driven through the REAL handler, the REAL gate and the REAL drive
 * arithmetic. `holdsAge` off reproduces the old behaviour exactly (a thought born now, every
 * time), so the counterfactual is measured rather than described.
 */
async function aFortnight(opts: { holdsAge: boolean; satiateOnDiary: boolean }): Promise<{ pushed: number; attempts: number }> {
  const inner = createInnerState();
  inner.update(standing);
  const tracker = createExpressionTracker(start);
  let pushed = 0, attempts = 0, now = start;

  const makeHandlers = () => createMomentHandlers({
    provider: { complete: async () => ({ content: [{ type: "text", text: "想跟你说个事。" }], usage: { inputTokens: 0, outputTokens: 0 }, stopReason: "end_turn" }) },
    model: "m",
    push: async () => { pushed += 1; tracker.onProactiveSend(now); },
    appendDiary: () => { /* held back */ },
    readRecentDiary: () => "",
    runExploration: async () => "",
    expressionContext: (c: { nowMs: number }) => {
      const e = tracker.snapshot(c.nowMs);
      return {
        nowMs: c.nowMs, present: true, available: true, awake: true, clockActivity: 1,
        consecutiveNonReplies: e.consecutiveNonReplies, sendsInLastDay: e.sendsInLastDay,
        hoursSinceUser: e.hoursSinceUser,
      };
    },
  } as never) as unknown as { reachOut: (i: string, c: unknown, s?: string) => Promise<{ delivered: string }> };
  // Held across the fortnight, or rebuilt every moment. Rebuilding resets the wanting-clock on
  // each attempt, which is precisely what `bornMs: ctx.nowMs` used to do.
  const kept = makeHandlers();

  for (let d = 0; d < 14; d++) {
    for (let m = 0; m < 18; m++) {
      now += 50 * 60 * 1000; // her real moment cadence
      inner.regenerate(standing, 50 / 60);
      if (m % 5 === 0) tracker.onOwnerMessage(now); // he is around, replying
      attempts += 1;
      const r = await (opts.holdsAge ? kept : makeHandlers()).reachOut("想跟他说说话", {
        nowMs: now, snapshot: inner.snapshot("normal", true),
        present: true, available: true, awake: true,
      } as never);
      const delivered = r.delivered === "push";
      inner.actOn("social", delivered || opts.satiateOnDiary ? 0.6 : 0.25);
    }
    now += 6 * 3.6e6; // her night
  }
  return { pushed, attempts };
}

describe("over a fortnight with him there, something she decides to say actually reaches him", () => {
  it("delivers a few a day rather than none at all", async () => {
    const { pushed, attempts } = await aFortnight({ holdsAge: true, satiateOnDiary: false });
    expect(attempts).toBeGreaterThan(200);
    expect(pushed, `she tried ${attempts} times over a fortnight and he heard nothing`).toBeGreaterThan(0);
    // A few a day: enough to be a person who speaks, not so many she is a notification stream.
    expect(pushed / 14).toBeGreaterThanOrEqual(1);
    expect(pushed / 14, "she has become a firehose").toBeLessThanOrEqual(6);
  });

  it("and still holds most of it back, because most of it is not worth saying aloud", async () => {
    const { pushed, attempts } = await aFortnight({ holdsAge: true, satiateOnDiary: false });
    expect(pushed / attempts, "everything she thinks of now goes out").toBeLessThan(0.5);
  });

  it("and without the ageing she is silent for the whole fortnight", async () => {
    // THE COUNTERFACTUAL, kept live rather than described, because it is the whole claim: a
    // thought born fresh every moment can never accumulate the silence-decay, and her intrinsic
    // motivation alone does not reach the bar. If this ever stops producing zero, the fix has
    // stopped being what makes the difference and somebody has to find out what does.
    const broken = await aFortnight({ holdsAge: false, satiateOnDiary: false });
    expect(broken.pushed, "the old shape no longer silences her — re-check what is carrying her over the bar")
      .toBe(0);
  });

  it("satiating on an undelivered message is a real cost even so", async () => {
    // Honest scope. With the ageing fixed, the satiation bug is no longer what SILENCES her,
    // measured, both configurations deliver. It still spends `social` she never got paid for,
    // which is the drive her whole sense of wanting company is built on, so the rule stands on
    // its own footing rather than on this comparison.
    const fixed = await aFortnight({ holdsAge: true, satiateOnDiary: false });
    const alsoSatiating = await aFortnight({ holdsAge: true, satiateOnDiary: true });
    expect(alsoSatiating.pushed).toBeLessThanOrEqual(fixed.pushed);
  });
});

describe("what ages is the wanting, not the words", () => {
  it("a thought she has been sitting on climbs toward the bar", () => {
    const ctx = { nowMs: start + 6 * 3.6e6, present: true, available: true, awake: true, clockActivity: 1, consecutiveNonReplies: 0, sendsInLastDay: 0, hoursSinceUser: 1 };
    const t: Thought = { id: "x", text: "…", source: "social", bornMs: start, intrinsic: 0.44 };
    const fresh: Thought = { ...t, bornMs: ctx.nowMs };
    expect(motivation(fresh, ctx as never), "a fresh thought already clears the bar, so nothing is being tested")
      .toBeLessThan(pushThreshold(0));
    expect(motivation(t, ctx as never), "six hours of not saying it moved nothing")
      .toBeGreaterThan(pushThreshold(0));
  });

  it("the handler keys the age by what it is about, and clears it once it is said", () => {
    // Comments blanked: the comment explaining this fix quotes the broken line it replaced.
    const src = readFileSync(new URL("../../../src/life/agency-handlers.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//gu, (m) => " ".repeat(m.length))
      .replace(/\/\/[^\n]*/gu, (m) => " ".repeat(m.length));
    expect(src, "every thought is born now again, so the silence-decay is dead").not.toMatch(/bornMs: ctx\.nowMs/u);
    expect(src).toContain("wantingSince");
    expect(src, "saying it does not reset the clock").toContain("wantingSince.delete(about)");
    // Bounded: this is what she is currently sitting on, not a record of her life.
    expect(src).toContain("MAX_HELD");
  });

  it("and only a delivered message satisfies wanting his company", () => {
    const src = readFileSync(new URL("../../../src/life/agency.ts", import.meta.url), "utf8");
    expect(src, "writing it in her diary still counts as having talked to him")
      .toContain('discharge(r.delivered === "push")');
  });
});
