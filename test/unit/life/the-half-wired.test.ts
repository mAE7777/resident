import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { daySummaryFromEvents } from "../../../src/life/day-summary.js";

/**
 * TWO THINGS THAT WERE BUILT AND THEN ONLY HALF-CONNECTED.
 *
 * Neither was a missing feature. Both were finished mechanisms with one end of the wire hanging,
 * and both are invisible from every direction except a sweep: the code reads correct, the tests
 * pass, and the thing simply never happens.
 */
describe("the room reaches the once-a-day consolidation, not only the moment beat", () => {
  it("a day summary can carry what the room did", () => {
    // `DaySummary.roomPull` was DECLARED, was READ by `driveInputsFromDay`, and was set by nothing
    // on this path. So him having been gone all afternoon and then sitting down was invisible to
    // the pass that sets her standing wanting, the whole `aware-of-him` layer reached her
    // per-moment regeneration and stopped there.
    expect(daySummaryFromEvents([], { roomPull: 0.3 }).roomPull).toBe(0.3);
    expect(daySummaryFromEvents([], {}).roomPull, "absent must read as nothing happened").toBe(0);
    expect(daySummaryFromEvents([], { roomPull: 9 }).roomPull, "unclamped").toBe(1);
  });

  it("and the daemon actually passes it", () => {
    const index = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    const at = index.indexOf("generateThoughts: () => []");
    expect(at, "the daily tick call is gone").toBeGreaterThan(-1);
    const call = index.slice(Math.max(0, at - 2500), at);
    expect(call, "the room is back to being invisible to her daily consolidation")
      .toMatch(/roomPull: noticeTheRoomNow\(nowMs\)/u);
  });
});

describe("an interface no wider than its use", () => {
  it("encodeMoment's four unused parameters are named, so the day one is passed is visible", () => {
    // `origin` / `chargeFloor` / `kind` / `tension` are optional and no call site in `src/` has
    // ever passed one. An interface wider than any use is a promise nobody checks, and `origin`
    // in particular reads as offering `read`, which a standing rule says must never be
    // written. They are kept for writing a moment WITH TENSION; this pins the state so
    // the first real use is a visible change rather than a silent one.
    const src = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    const passed = ["chargeFloor:", "kind: \"moment\"", "origin: \"lived\""]
      .filter((k) => src.includes(k));
    expect(passed, "a moment parameter started being used — say so here and drop it from the list")
      .toEqual([]);
    // And the rule the widest of them brushes against is still held elsewhere.
    expect(src, "a moment is being encoded as read-origin").not.toMatch(/encodeMoment\([^)]*origin: "read"/su);
  });
});

describe("silence can end on a day when the daily tick does not catch it", () => {
  it("her moments settle an overdue raise too", () => {
    // `settleOverdueRaise` is the half of the reticence loop that learns from SILENCE. Its only
    // caller was the once-a-day tick, so whether it ever fired depended on where that single tick
    // landed: a man who answers late every day never hardens her, because the tick arrives before
    // the six-hour window is up and his reply then clears the pending raise with NO VERDICT. The
    // easing half fires on every message. A loop that can only soften is not learning.
    const index = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    const calls = [...index.matchAll(/field\.settleOverdueRaise\(/gu)].length;
    expect(calls, "silence ends in only one place again — whichever place that is, it is one tick")
      .toBeGreaterThanOrEqual(2);
    // And specifically on the moment path, which runs many times a day.
    const moment = index.indexOf("WHAT IS ON HER MIND, resolved once");
    expect(moment, "the moment loop's anchor is gone").toBeGreaterThan(-1);
    expect(index.slice(Math.max(0, moment - 1400), moment),
      "the moment loop no longer lets silence end").toMatch(/settleOverdueRaise/u);
  });
});
