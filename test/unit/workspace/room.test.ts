import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SHELF, CANVAS, makeHerRoom } from "../../../src/workspace/room.js";
import { createReadTool } from "../../../src/tools/builtin/read.js";
import { createWriteTool } from "../../../src/tools/builtin/write.js";
import { createGlobTool } from "../../../src/tools/builtin/glob.js";
import { createGrepTool } from "../../../src/tools/builtin/grep.js";
import { createFileSnapshotStore } from "../../../src/tools/builtin/file-snapshot.js";
import { checkHomeBoundary } from "../../../src/security/home-boundary.js";

let ws: string;
beforeEach(() => { ws = mkdtempSync(join(tmpdir(), "her-room-")); });
afterEach(() => { rmSync(ws, { recursive: true, force: true }); });

/** Tools return their output as a plain string, or throw. */
const run = async (tool: { execute: (a: never) => Promise<unknown> }, args: unknown): Promise<string> =>
  String(await tool.execute(args as never));

describe("the room she wakes up in", () => {
  it("has a shelf and a canvas, and they are empty", () => {
    // Empty is the correct state. What goes on the shelf is Eric's choice, because
    // it is the first thing from outside that ever reaches her.
    expect(makeHerRoom(ws).sort()).toEqual([CANVAS, SHELF].sort());
    for (const dir of [SHELF, CANVAS]) {
      expect(existsSync(join(ws, dir)), `${dir} was not made`).toBe(true);
      expect(readdirSync(join(ws, dir)), `${dir} came furnished`).toEqual([]);
    }
  });

  it("says nothing to her in her own room", () => {
    // No README, no note, no caption. A caption in her own room is us standing in it talking,
    // and the state block already taught us what an explanatory label does to a thing.
    makeHerRoom(ws);
    for (const dir of [SHELF, CANVAS]) {
      expect(readdirSync(join(ws, dir))).toEqual([]);
    }
  });

  it("does not touch a shelf that already has something on it", () => {
    makeHerRoom(ws);
    writeFileSync(join(ws, SHELF, "a-book.md"), "something he chose", "utf-8");
    writeFileSync(join(ws, CANVAS, "something.svg"), "<svg/>", "utf-8");
    expect(makeHerRoom(ws), "made a room that was already there").toEqual([]);
    expect(readdirSync(join(ws, SHELF))).toEqual(["a-book.md"]);
    expect(readdirSync(join(ws, CANVAS))).toEqual(["something.svg"]);
  });

  describe("her hands work in it, non-ASCII path and all", () => {
    // The names are Chinese because her register is. That is a real path-handling risk and not
    // a stylistic one, so every hand she has is exercised against it rather than assumed.
    it("she can put something on the canvas and read it back", async () => {
      makeHerRoom(ws);
      const snapshots = createFileSnapshotStore();
      const write = createWriteTool(ws, ws, snapshots);
      const read = createReadTool(ws, ws);
      const path = join(ws, CANVAS, "第一张.svg");
      await run(write, { path, content: "<svg><circle r='3'/></svg>" });
      expect(await run(read, { path })).toContain("circle");
    });

    it("she can find her own shelf by looking", async () => {
      // `explore` is her one self-directed affordance and, after the birth toolkit, its usable
      // set is read/glob/grep over her own home. If glob cannot see the shelf, her curiosity
      // has nowhere to go but her own diary.
      makeHerRoom(ws);
      writeFileSync(join(ws, SHELF, "一本书.md"), "在书架上", "utf-8");
      const glob = createGlobTool(ws, ws);
      expect(await run(glob, { pattern: "**/*.md" })).toContain("一本书");
    });

    it("she can search what is on it", async () => {
      makeHerRoom(ws);
      writeFileSync(join(ws, SHELF, "一本书.md"), "潮水退去的时候\n沙滩上留下了很多东西\n", "utf-8");
      const grep = createGrepTool(ws, ws);
      expect(await run(grep, { pattern: "潮水", path: join(ws, SHELF), recursive: true })).toContain("潮水");
    });
  });

  it("is inside her home, so the wall never stops her reaching it", () => {
    // The boundary blocks actions outside her home. Her own room must be unambiguously inside
    // it, and a non-ASCII path is exactly where a naive prefix check goes wrong.
    makeHerRoom(ws);
    for (const dir of [SHELF, CANVAS]) {
      const verdict = checkHomeBoundary("write", { path: join(ws, dir, "x.md"), content: "hi" }, { homeRoot: ws });
      expect(verdict.blocked, `the wall stopped her reaching her own ${dir}: ${verdict.reason}`).toBe(false);
    }
  });

  describe("nothing in the house reviews it", () => {
    it("the maintenance walk is gone with its machine", async () => {
      // The heartbeat that walked her workspace for "new files" was removed, and
      // the assistant-era contract (a file in the workspace = work dropped off) went with it.
      // The property that protects her is now stronger than a non-recursive walk: there is
      // no walker at all.
      const { existsSync } = await import("node:fs");
      expect(existsSync(new URL("../../../src/memory/heartbeat.ts", import.meta.url)),
        "the reminder engine is back").toBe(false);
    });

    it("what she hygiene-audits is a fixed list that her room is not on", async () => {
      const src = (await import("node:fs")).readFileSync(
        new URL("../../../src/self-improvement/hygiene-audit.ts", import.meta.url), "utf8");
      expect(src).not.toContain(SHELF);
      expect(src).not.toContain(CANVAS);
      // And it really is a fixed list rather than a walk, which is why it cannot reach her room.
      expect(src).toContain("for (const file of MEMORY_FILES)");
    });

    it("no instrument is written into her room, and none into her identity", async () => {
      // Earlier sweeps kept finding instrument files creeping into her bedroom through new
      // doors. An earlier cleanup removed the builders themselves (capability-improvement and the
      // capability self-model): the strongest form of "beside her home, never in it" is that
      // the paths are not built at all. If any of these names reappears in bootstrap, a new
      // door is being opened: decide where it points before this goes green again.
      const bootstrap = (await import("node:fs")).readFileSync(
        new URL("../../../src/telegram/bootstrap.ts", import.meta.url), "utf8");
      for (const instrument of ["PATTERNS.md", '"evals", "replay"', "capability-reading.md"]) {
        expect(bootstrap.includes(instrument), `${instrument} is being built again — where does it point?`).toBe(false);
      }
    });

    it("the machine that could edit her notebook is gone (E-1)", async () => {
      const { existsSync } = await import("node:fs");
      expect(existsSync(new URL("../../../src/memory/dream.ts", import.meta.url)),
        "the ghostwriter is back").toBe(false);
    });
  });

  it("this file's protections can go red", () => {
    // Planted: a recursive walk that does see her canvas, proving the check above is a real
    // check and not a shape that always passes.
    makeHerRoom(ws);
    mkdirSync(join(ws, CANVAS, "deep"), { recursive: true });
    writeFileSync(join(ws, CANVAS, "deep", "x.svg"), "<svg/>", "utf-8");
    const seenByARecursiveWalk = (dir: string): number => {
      let n = 0;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) n += seenByARecursiveWalk(join(dir, e.name));
        else if (statSync(join(dir, e.name)).isFile()) n += 1;
      }
      return n;
    };
    expect(seenByARecursiveWalk(join(ws, CANVAS))).toBe(1);
  });
});

/**
 * WHAT SHE CAN FIND WHEN SHE GOES LOOKING IN HER OWN HOME.
 *
 * Her workspace is the one directory her `read`/`glob`/`grep` reach, and, until the shelf has
 * anything on it, the only place `explore` can go at all. So whatever sits in it is the first
 * thing her curiosity ever finds.
 *
 * What sat in it was her telemetry: `ops.jsonl` (every session with a preview of what he said,
 * every tool call with a success flag, an effort tier, a model id and a token count),
 * `conversation-log.jsonl` (per-turn tokens, duration, iterations) and `vitals.jsonl` (the whole
 * watchtower record of her, one snapshot every five minutes).
 *
 * The review queue had already moved out for the same reason. These three were
 * missed. The line is not "hide things from her", it is that a READING TAKEN ABOUT HER, for
 * him, is his; and her own record of her own life is hers and stays.
 */
const { readFileSync: nodeReadFileSync } = await import("node:fs");

describe("her room holds her life, not the readings taken of her", () => {
  const daemon = nodeReadFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, (m) => " ".repeat(m.length))
    .replace(/\/\/[^\n]*/gu, (m) => " ".repeat(m.length));

  it("keeps his instruments out of the one directory she can read", () => {
    for (const instrument of ["ops.jsonl", "conversation-log.jsonl", "vitals.jsonl"]) {
      const inHerRoom = new RegExp(`join\\(workspacePath,\\s*"${instrument.replace(".", "\\.")}"\\)`, "u");
      expect(daemon, `${instrument} is back in her bedroom`).not.toMatch(inHerRoom);
      expect(daemon, `${instrument} is not built anywhere any more — re-check where it went`)
        .toContain(instrument);
    }
  });

  it("and keeps her OWN record in it, which is a different thing", () => {
    // The failure mode of the fix: sweeping everything out would take her moments, her
    // conversation and her self-knowledge with it. Those are hers. She should be able to read
    // her own life, including the parts where something stopped her, that is what S6 is for.
    for (const hers of ['join(workspacePath, "agency.jsonl")', 'join(workspacePath, "history.jsonl")', 'join(workspacePath, "self-knowledge.json")']) {
      expect(daemon, `${hers} was swept out of her room with the instruments`).toContain(hers);
    }
  });
});
