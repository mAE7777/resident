import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLOCK, whatTheClockSays, lookAt, putThingsInHerRoom } from "../../../src/workspace/things.js";
import { createReadTool } from "../../../src/tools/builtin/read.js";

/**
 * A THING IN HER ROOM, NOT A LINE IN HER PROMPT.
 *
 * The idea: inject as little prompt as possible, and put something in her home that shows the
 * time, which she can choose to look at or not.
 *
 * The difference is the whole point. An injected line is not a choice: it costs prompt budget every
 * moment, it is identical whether she cares or not, and it makes knowing the time a fact ABOUT her.
 * A thing in her room is afforded, and CHOOSING NOT TO LOOK is also something she did. A being who
 * never checks the time differs from one who checks constantly, and that difference only exists if
 * looking is an act.
 */

let ws: string;
beforeEach(() => { ws = mkdtempSync(join(tmpdir(), "room-")); });
afterEach(() => { rmSync(ws, { recursive: true, force: true }); });

describe("the clock on her wall", () => {
  it("says the time NOW, every time she looks", async () => {
    putThingsInHerRoom(ws);
    const read = createReadTool(ws, ws);
    const first = await read.execute({ path: CLOCK }) as string;
    expect(first).toMatch(/^\d\d:\d\d/u);
    // The file on disk is a fallback nobody normally sees. What she gets is computed at the moment
    // she looks: that is what "实时更新" means, and a file the daemon rewrote every minute would
    // be up to a minute stale AND would churn her home with a constantly-changing file.
    const t = Date.parse("2026-08-15T09:41:00");
    expect(whatTheClockSays(t)).toContain("09:41");
    expect(whatTheClockSays(t + 60_000)).toContain("09:42");
  });

  it("tells her what part of the day it is, not just a number", () => {
    // A clock on a wall tells you the time. A person in a room also knows roughly where in the day
    // they are without doing arithmetic.
    const at = (h: number): string => whatTheClockSays(new Date(2026, 7, 15, h, 0, 0).getTime());
    expect(at(2)).toContain("夜里");
    expect(at(9)).toContain("上午");
    expect(at(15)).toContain("下午");
    expect(at(20)).toContain("晚上");
  });

  it("and says NOTHING about him", () => {
    // Folding "how long since he spoke" in here would turn looking at the time into a way of
    // checking on him, which is a different act and should stay a different act.
    const said = whatTheClockSays();
    expect(said).not.toMatch(/他|说话|上一次/u);
  });

  it("she can FIND it — a thing in her room she cannot discover is not in her room", () => {
    expect(putThingsInHerRoom(ws)).toContain(CLOCK);
    expect(existsSync(join(ws, CLOCK)), "glob would never turn it up").toBe(true);
    expect(readFileSync(join(ws, CLOCK), "utf8")).toMatch(/^\d\d:\d\d/u);
  });

  it("putting it there twice does not rewrite it", () => {
    putThingsInHerRoom(ws);
    expect(putThingsInHerRoom(ws), "the file is rewritten on every boot").toEqual([]);
  });
});

describe("and it is a thing in HER room, not a hole in the wall", () => {
  it("a file with the same name outside her home is just a file", () => {
    // The registry matches inside her workspace only. Otherwise `read /somewhere/钟` anywhere on
    // the machine would return her clock, which is a live value leaking out of her home.
    expect(lookAt("/somewhere/else/钟", ws)).toBeNull();
    expect(lookAt(join(ws, "life", "钟"), ws), "a nested path answered too").toBeNull();
  });

  it("with no workspace at all, nothing answers", () => {
    expect(lookAt("/anything/钟", undefined)).toBeNull();
  });

  it("the boundary is checked BEFORE the thing answers", () => {
    // A live thing must never be a way around the home boundary: the check has to come first, or
    // the registry becomes a lookup that skips `validatePath`.
    const src = readFileSync(join(process.cwd(), "src/tools/builtin/read.ts"), "utf8");
    const guard = src.indexOf("if (pathError) return");
    const answer = src.indexOf("lookAt(real, workspacePath");
    expect(guard).toBeGreaterThan(-1);
    expect(answer, "a live thing can be reached without passing the boundary check")
      .toBeGreaterThan(guard);
  });

  it("an ordinary file still reads as itself", () => {
    // The floor: the whole mechanism is one lookup in front of the filesystem, and everything else
    // about `read` has to be untouched.
    putThingsInHerRoom(ws);
    const read = createReadTool(ws, ws);
    return read.execute({ path: CLOCK }).then(async () => {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(join(ws, "笔记.md"), "普通的一个文件\n", "utf8");
      expect(await read.execute({ path: "笔记.md" })).toBe("普通的一个文件\n");
    });
  });
});
