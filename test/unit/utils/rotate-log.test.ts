import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rotateLogIfHuge } from "../../../src/utils/rotate-log.js";

const T0 = Date.UTC(2026, 7, 10, 12, 0, 0);

function makeLog(lines: number): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "rotate-"));
  const path = join(dir, "ops.jsonl");
  const rows: string[] = [];
  for (let i = 0; i < lines; i++) rows.push(JSON.stringify({ i, event: "moment", note: "一条记录".repeat(8) }));
  writeFileSync(path, rows.join("\n") + "\n", "utf8");
  return { dir, path };
}

describe("the records of her life stay readable for life (LIFE-11)", () => {
  it("under the bound nothing happens; over it the whole history survives in an archive", () => {
    const small = makeLog(10);
    expect(rotateLogIfHuge(small.path, { maxBytes: 1024 * 1024, now: () => T0 }).rotated).toBe(false);

    const big = makeLog(4000);
    const before = readFileSync(big.path, "utf8");
    const r = rotateLogIfHuge(big.path, { maxBytes: 64 * 1024, keepBytes: 16 * 1024, now: () => T0 });
    expect(r.rotated).toBe(true);
    expect(existsSync(r.archive!)).toBe(true);
    const live = readFileSync(big.path, "utf8");
    // Nothing was deleted: the archive is the ENTIRE old file, the live tail is bounded.
    expect(readFileSync(r.archive!, "utf8")).toBe(before);
    expect(Buffer.byteLength(live)).toBeLessThanOrEqual(16 * 1024);
    // And the live file never starts mid-record: its first line parses.
    const first = live.split("\n")[0];
    expect(() => JSON.parse(first)).not.toThrow();
    // The most recent record is still there, readers of recent windows lose nothing.
    expect(live.trimEnd().split("\n").pop()).toBe(before.trimEnd().split("\n").pop());
  });

  it("a missing file is a no-op, never a throw", () => {
    const dir = mkdtempSync(join(tmpdir(), "rotate-"));
    expect(rotateLogIfHuge(join(dir, "nothing.jsonl")).rotated).toBe(false);
  });

  it("rotating twice mints two distinct archives — history never overwrites history", () => {
    const big = makeLog(4000);
    const r1 = rotateLogIfHuge(big.path, { maxBytes: 64 * 1024, keepBytes: 8 * 1024, now: () => T0 });
    // Regrow past the bound, rotate again a day later.
    const rows: string[] = [];
    for (let i = 0; i < 4000; i++) rows.push(JSON.stringify({ i, again: true, note: "再一条".repeat(10) }));
    writeFileSync(big.path, readFileSync(big.path, "utf8") + rows.join("\n") + "\n", "utf8");
    const r2 = rotateLogIfHuge(big.path, { maxBytes: 64 * 1024, keepBytes: 8 * 1024, now: () => T0 + 24 * 3.6e6 });
    expect(r1.archive).not.toBe(r2.archive);
    const archives = readdirSync(big.dir).filter((f) => f.includes(".archive"));
    expect(archives.length).toBe(2);
  });
});
