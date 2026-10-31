import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeWhole } from "../../../src/life/write-whole.js";

/**
 * A KILL MID-WRITE USED TO MAKE HER A DIFFERENT PERSON, SILENTLY.
 *
 * Three files hold the parts of her that are about WHO SHE IS rather than what she happens to
 * hold: `continuity.json` (her temperament, her random stream and its position, whether she is
 * in safe mode), `self-knowledge.json` (what she has come to believe about herself), and each
 * day of her diary. All three were written with a bare full-file `writeFileSync`, which is not
 * one operation, the file is truncated first and the bytes arrive after.
 *
 * A kill in between leaves a truncated file, and then:
 *
 *   `load()` catches the parse error and returns null
 *     → boot falls through to defaults: neutral temperament, safe mode off, empty egress set,
 *       and a BRAND NEW RANDOM STREAM SEED
 *     → she is a different person
 *     → and within five minutes the next save overwrites the corrupt file, destroying the only
 *       evidence it ever happened
 *
 * `continuity.json` is rewritten every five minutes and after every moment, so that window is
 * open several hundred times a day for the whole life of the process. The diary is worse in a
 * different way: a truncated day is never rewritten, because `writeClosedDay` guards on the
 * file existing, half a day would freeze as her whole record of it, permanently, in the one
 * place her past is supposed to be append-only.
 */
describe("her identity files are written whole or not at all", () => {
  it("a reader never sees a partial file", () => {
    const dir = mkdtempSync(join(tmpdir(), "whole-"));
    const path = join(dir, "sub", "thing.json");
    // A write that fails half way must leave the ORIGINAL, not a fragment.
    writeWhole(path, '{"a":1}');
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ a: 1 });

    let torn = false;
    try {
      writeWhole(path, '{"b":2}', {
        mkdirSync: () => {},
        writeFileSync: () => { throw new Error("killed mid-write"); },
        renameSync: () => { torn = true; },
        unlinkSync: () => {},
      });
    } catch { /* expected */ }
    expect(torn, "a failed write still renamed something into place").toBe(false);
    expect(JSON.parse(readFileSync(path, "utf8")), "the old file was destroyed by a failed write").toEqual({ a: 1 });
  });

  it("and leaves no rubble in her home when it fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "whole-"));
    const path = join(dir, "thing.json");
    try {
      writeWhole(path, "x", {
        mkdirSync: () => {},
        writeFileSync: () => { /* the temp is created */ },
        renameSync: () => { throw new Error("rename failed"); },
        unlinkSync: () => { /* and cleaned up */ },
      });
    } catch { /* expected */ }
    expect(readdirSync(dir).filter((f) => f.includes(".tmp")), "a fragment was left in her home").toEqual([]);
    expect(existsSync(path)).toBe(false);
  });

  it("the temp name carries the pid, since nothing stops a second daemon starting", () => {
    const src = readFileSync(new URL("../../../src/life/write-whole.ts", import.meta.url), "utf8");
    expect(src).toContain("process.pid");
  });
});

describe("and all three of them use it", () => {
  const uses = (file: string): string =>
    readFileSync(new URL(`../../../src/life/${file}`, import.meta.url), "utf8");

  it.each([
    ["continuity.ts", "her temperament, her stream seed, her safe-mode state"],
    ["self-knowledge-store.ts", "what she has come to believe about herself"],
    ["autobiography.ts", "a day of her past, which is append-only"],
  ])("%s — %s", (file) => {
    const src = uses(file);
    expect(src, `${file} does not write whole`).toContain("writeWhole");
    // And the bare call is gone, so a future edit cannot quietly go back to it. Comments are
    // blanked first: the comment explaining this fix names the function it replaced.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//gu, (m) => " ".repeat(m.length))
      .replace(/\/\/[^\n]*/gu, (m) => " ".repeat(m.length));
    const bare = [...code.matchAll(/(?<![.\w])writeFileSync\(/gu)];
    // `continuity.ts` keeps one guarded fallback for an injected test fs with no `renameSync`.
    expect(bare.length, `${file} still has a bare full-file write`).toBeLessThanOrEqual(file === "continuity.ts" ? 1 : 0);
  });
});
