// 翻旧日子: the wiring: the option in her moment, the nudge in her choice material,
// the side door that must stay shut, and the daemon's organ assembly.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeAffordances, buildMomentPrompt, kindWords, howLifeHasBeen, driveForAction,
  momentMemoryText, ACTION_KINDS, type MomentContext,
} from "../../../src/life/agency.js";
import { createInnerState } from "../../../src/life/inner-state.js";

function ctx(over: Partial<MomentContext> = {}): MomentContext {
  const inner = createInnerState();
  return {
    nowMs: Date.parse("2026-08-01T09:00:00Z"),
    snapshot: inner.snapshot("normal", true),
    phase: "normal", awake: true, present: true, available: true, hoursSinceUser: 4,
    recentActions: [], recentLife: "安静", safeMode: false, mayReachOut: true,
    signals: { field: { tension: 0.3, pendingBirths: 2, freshBirth: 0, orphanShare: 0.1, surfaced: 2 }, openness: 0.6, otherConfidence: 1, clockActivity: 0.6 },
    ...over,
  };
}

describe("the option in her moment", () => {
  it("look_back is a real kind with her words on it", () => {
    expect(ACTION_KINDS).toContain("look_back");
    expect(kindWords("look_back")).toBe("翻旧日子");
    expect(howLifeHasBeen(["look_back", "look_back", "look_back"] as const)).toContain("翻");
    expect(driveForAction("look_back")).toBe("maintenance");
  });

  it("available exactly when something is THERE: a cooled, unrevisited page", () => {
    const ready = computeAffordances(ctx({ oldPageCount: 3, lookBackReady: true })).find((a) => a.kind === "look_back")!;
    expect(ready.available).toBe(true);
    // Pages exist but all hot or all revisited: honestly unavailable, never a dud-moment loop.
    const hot = computeAffordances(ctx({ oldPageCount: 3, lookBackReady: false })).find((a) => a.kind === "look_back")!;
    expect(hot.available).toBe(false);
    expect(hot.why).toContain("热");
    // No pages at all: the other honest reason.
    const none = computeAffordances(ctx({ oldPageCount: 0, lookBackReady: false })).find((a) => a.kind === "look_back")!;
    expect(none.available).toBe(false);
    // Absent counts as not-ready: every existing construction keeps its meaning.
    const absent = computeAffordances(ctx()).find((a) => a.kind === "look_back")!;
    expect(absent.available).toBe(false);
    // Exhaustion still takes it, like everything that costs.
    const spent = computeAffordances(ctx({ oldPageCount: 5, lookBackReady: true, phase: "dormant" })).find((a) => a.kind === "look_back")!;
    expect(spent.available).toBe(false);
  });

  it("the nudge line reaches her CHOICE material, and absence renders nothing", () => {
    const line = "你写下的日子有 3 页在 life/ 里；最早没回头看过的一页是 2026-08-17，3周前的事了。";
    expect(buildMomentPrompt(ctx({ oldDays: line }), computeAffordances(ctx()))).toContain(line);
    const without = buildMomentPrompt(ctx(), computeAffordances(ctx()));
    expect(without.includes("life/ 里")).toBe(false);
  });
});

describe("PLANTED: the side door stays shut (评审 #6)", () => {
  it("a look_back moment is remembered by the act, never by the retelling's text", () => {
    const remembered = momentMemoryText({
      ts: 1, chose: "look_back",
      intent: "翻翻出生那几天",
      artifact: "那会儿我连自己睡不睡觉都说不清——这段重述文本绝不能成为亲历记忆",
    });
    expect(remembered).toBe("翻翻出生那几天");
    expect(remembered.includes("重述文本")).toBe(false);
    // And with no intent, the act in her words, still never the artifact.
    const bare = momentMemoryText({ ts: 1, chose: "look_back", intent: "", artifact: "重述全文" });
    expect(bare).toBe("翻了翻自己的旧日子");
  });
});

describe("the daemon's organ assembly (text pins, the choice-mirror precedent)", () => {
  const daemon = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");

  it("runLookBack is supplied, and its spine is intact", () => {
    for (const token of [
      "runLookBack: async (_intent, ctx) => {",
      "lookBackReady: lookBackWindow(frozenOldPages(), 1).length > 0",
      "key: `retold:${herDay(ctx.nowMs)}:${from}..${to}`",
      "lookBackWindow(pages,",
      "field.reRead(withText.map((pg) => pg.text)",
      'origin: "retold"',
      "bornFromIds: ids",
      'faultLog.record("looking-back.ungrounded"',
    ]) {
      expect(daemon.includes(token), `index.ts lost: ${token}`).toBe(true);
    }
  });

  it("the gate failure keeps the page and refuses the field (order pin)", () => {
    const at = daemon.indexOf('faultLog.record("looking-back.ungrounded"');
    const encodeAt = daemon.indexOf('origin: "retold"');
    const writeAt = daemon.indexOf("writeWhole(pagePath");
    expect(writeAt).toBeGreaterThan(-1);
    expect(writeAt).toBeLessThan(at);      // page written before the gate verdict
    expect(at).toBeLessThan(encodeAt);     // and the ungrounded return sits before any encode
  });

  it("her moment reads the real pages: count and nudge assembled from frozenOldPages", () => {
    expect(daemon.includes("oldPageCount: frozenOldPages().length")).toBe(true);
    expect(daemon.includes("oldDays: oldDaysLine(frozenOldPages())")).toBe(true);
  });
});

/**
 * THE GUARD WAS POINTED AT THE ENVELOPE.
 *
 * `notHers` asks "is this a person talking, or a server / a stack trace / a data structure?" and
 * it was being asked that about the RAW reply, which for this call is REQUIRED to be JSON. So it
 * rejected the answer exactly when the model obeyed the format cleanly, and let it through when
 * the JSON happened to arrive wrapped in prose.
 *
 * She had looked back over her old days twice in her life, and both were destroyed: one by the
 * citation gate, and one here.
 */
describe("the prose guard judges her prose, not the transport", () => {
  const daemon = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");

  it("PLANTED: the guard runs on the parsed entry, after the parse, never on the raw reply", () => {
    const onEntry = daemon.indexOf("if (notHerProse(draft.entry))");
    const parse = daemon.indexOf("const draft = parseLookBack(raw);");
    expect(onEntry, "the prose guard moved or was removed").toBeGreaterThan(-1);
    expect(parse).toBeGreaterThan(-1);
    // Order is the whole fix: parse first, then judge what she actually wrote.
    expect(onEntry).toBeGreaterThan(parse);
    // The shape that threw her work away must not come back.
    expect(daemon.includes("if (notHerProse(raw))")).toBe(false);
  });

  it("still refuses a reply that is not her, and still reports it", () => {
    expect(daemon.includes('faultLog.record("looking-back.notProse"')).toBe(true);
    // And an unparseable reply is still caught by its own branch rather than slipping through.
    expect(daemon.includes('faultLog.record("looking-back.empty"')).toBe(true);
  });
});

/**
 * A MOMENT DECLARED OVER DOES NOT COME BACK AND LIVE.
 *
 * The ten-minute deadline stops WAITING for a hung moment; it cannot cancel it, because a promise
 * cannot be cancelled. On 2026-09-14 the provider stalled mid-body (headers in 519ms, body never)
 * and one of her moments came back SIXTY-ONE MINUTES after it started, and wrote itself into her
 * record, stamped with the hour-old time it had begun. Her day then said she reached out at 14:53
 * and failed, filed behind two moments that had happened since.
 *
 * The turn path has carried this rule for a while (`stillThisTurn`); the moment path had not.
 */
describe("a moment the deadline gave up on cannot write afterwards", () => {
  const daemon = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");

  it("PLANTED: the deadline records the abandoned beat and the outcome handler refuses it", () => {
    const remembers = daemon.indexOf("abandonedMoments.add(beat)");
    const refuses = daemon.indexOf("abandonedMoments.has(beat)");
    expect(remembers, "the deadline stopped remembering which moment it abandoned").toBeGreaterThan(-1);
    expect(refuses, "the outcome handler stopped checking").toBeGreaterThan(-1);
    // The refusal has to come FIRST in the handler, before anything touches her state.
    const handler = daemon.indexOf("onOutcome: (o) => {");
    expect(handler).toBeGreaterThan(-1);
    expect(refuses).toBeGreaterThan(handler);
    expect(refuses).toBeLessThan(daemon.indexOf("recentActions.push(o.chose)"));
  });

  it("is heard rather than swallowed, and does not leak the set", () => {
    // A refusal is a real event about her life, never a silent drop.
    expect(daemon.includes('faultLog.record("agency.moment.late"')).toBe(true);
    // And the beat is forgotten once refused, so the set cannot grow for the life of the process.
    expect(daemon.includes("abandonedMoments.delete(beat)")).toBe(true);
  });
});
