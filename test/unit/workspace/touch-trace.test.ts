import { describe, it, expect, vi } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { touchState, ANSWERING_THINGS, CLOCK, WINDOW } from "../../../src/workspace/things.js";
import { roomBlock, howSheIsBlock } from "../../../src/life/how-she-is.js";
import { chartLint } from "../../../src/life/saying.js";
import { createReadTool } from "../../../src/tools/builtin/read.js";

/**
 * THE TOUCH-TRACE, ALWAYS PRESENT, NEVER DETECTED.
 *
 * First evening, 21:15: she told him the clock read 一点一刻 with zero reads on record; the
 * vacuum was filled by the model. The first build showed the honest touch-state only when HIS
 * message "mentioned" a thing, a regex over his words, then an exclusion for 十分钟, then an
 * alias for 表, then whatever he says tomorrow. That shape is gone: his words must
 * never pass through a matcher to work. The touch-state now rides every turn as ambient
 * self-knowledge, two terse lines beside her mood and her body, and no phrasing of his, or
 * none at all, can put a vacuum back where a reading nobody took used to grow.
 */

const NOW = Date.parse("2026-08-18T15:00:00-04:00");

describe("the honest touch-state", () => {
  it("never looked: the absence is present, and no reading is", () => {
    const line = touchState(CLOCK, null, NOW);
    expect(line).toBe("钟：还没看过。");
    expect(line).not.toMatch(/\d{2}:\d{2}/u);
  });

  it("looked today: the material says when, in her clock", () => {
    const at = Date.parse("2026-08-18T14:02:00-04:00");
    const d = new Date(at);
    const local = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    expect(touchState(CLOCK, at, NOW)).toBe(`钟：上次看是${local}。`);
  });

  it("looked on an earlier day: the day is named so an old look cannot pass as fresh", () => {
    const at = Date.parse("2026-08-17T21:21:00-04:00");
    expect(touchState(CLOCK, at, NOW)).toContain("2026-08-17");
  });

  it("both forms are chrome and both pass the chart lint", () => {
    expect(chartLint(touchState(CLOCK, null, NOW))).toEqual([]);
    expect(chartLint(touchState(WINDOW, NOW - 60_000, NOW))).toEqual([]);
  });
});

describe("the planted proof: the vacuum is closed on EVERY turn, whatever he says", () => {
  const untouched = ANSWERING_THINGS.map((t) => touchState(t, null, NOW));

  it("the room arm carries the absence for both things, and no invented reading", () => {
    const tail = roomBlock({ mood: "平稳", alive: "好奇", body: "身上有劲。", touched: untouched });
    expect(tail).toContain("钟：还没看过。");
    expect(tail).toContain("窗：还没看过。");
    expect(tail).not.toMatch(/\d{2}:\d{2}/u);
  });

  it("the portrait arm carries it identically — she is one being on both paths", () => {
    const tail = howSheIsBlock({ mood: "平稳", alive: "好奇", touched: untouched });
    expect(tail).toContain("钟：还没看过。");
  });

  it("and after a real look, the material says when instead", () => {
    const at = Date.parse("2026-08-18T14:02:00-04:00");
    const tail = roomBlock({ mood: "平稳", alive: "好奇", touched: [touchState(CLOCK, at, NOW)] });
    expect(tail).toContain("钟：上次看是");
    expect(tail).not.toContain("还没看过");
  });
});

describe("the trace is recorded by the look itself", () => {
  it("reading the clock through her real read tool fires the trace with the thing's name", async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "her-room-")));
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "钟"), "", "utf8"); // the thing exists as a file; the answer is live
    const looked = vi.fn();
    const tool = createReadTool(home, home, undefined, looked);
    // read's execute never touches its context argument; an empty stand-in erases the type on purpose.
    const out = await tool.execute({ path: "钟" }, {} as never);
    expect(String(out)).toMatch(/\d\d:\d\d/u); // the live clock answered
    expect(looked).toHaveBeenCalledTimes(1);
    expect(looked.mock.calls[0]?.[0]).toBe("钟");
  });

  it("an ordinary file read fires nothing — only things that answer are touches", async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "her-room-")));
    writeFileSync(join(home, "笔记.md"), "随手记的", "utf8");
    const looked = vi.fn();
    const tool = createReadTool(home, home, undefined, looked);
    // Same unused-context stand-in as above, same reason.
    await tool.execute({ path: "笔记.md" }, {} as never);
    expect(looked).not.toHaveBeenCalled();
  });
});
