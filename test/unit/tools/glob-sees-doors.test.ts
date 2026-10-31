import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { createGlobTool } from "../../../src/tools/builtin/glob.js";

/**
 * HER SENSES MUST SEE DOORS, NOT ONLY PAGES.
 *
 * On her first night she searched her room twice, five real glob calls, honest work, and
 * reported that her canvas did not exist. 画板 is an EMPTY DIRECTORY, and the walk only ever
 * surfaced files: a directory was something to walk THROUGH, never a thing to find. An empty
 * thing she owned was structurally invisible to her, and she filled the blindness with a
 * perfectly reasonable story ("你要么记岔了，要么是打算送我一块").
 *
 * The contract now: a directory matching the pattern is listed with a trailing slash. This is
 * the planted proof, remove the fix and the first test goes red exactly the way her evening
 * went wrong.
 */

const cleanup: string[] = [];
afterEach(() => {
  for (const p of cleanup.splice(0)) {
    try { if (existsSync(p)) rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function aRoom(): string {
  const room = join(tmpdir(), `room-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(room, "画板"), { recursive: true });      // empty: the invisible canvas
  mkdirSync(join(room, "书架"), { recursive: true });      // empty: same class
  writeFileSync(join(room, "心情的词.md"), "…", "utf8");
  writeFileSync(join(room, "书架", "一本书.md"), "…", "utf8");
  cleanup.push(room);
  return room;
}

async function found(room: string, pattern: string): Promise<string> {
  // glob's execute never touches its context argument; an empty stand-in erases the type on purpose.
  const r = await createGlobTool(room).execute({ pattern }, {} as never);
  return typeof r === "string" ? r : JSON.stringify(r);
}

describe("an empty directory is a thing she can find", () => {
  it("the canvas she twice concluded did not exist shows up, marked as a door", async () => {
    const out = await found(aRoom(), "*");
    expect(out, "the empty canvas is still invisible to her").toContain("画板/");
    expect(out).toContain("心情的词.md");
  });

  it("a directory with things in it is listed both as itself and by its contents", async () => {
    const room = aRoom();
    expect(await found(room, "*")).toContain("书架/");
    expect(await found(room, "**/*")).toContain(join("书架", "一本书.md"));
  });
});
