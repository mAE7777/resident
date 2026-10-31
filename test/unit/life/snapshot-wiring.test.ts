import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KEEP_ALL_WITHIN_MS, KEEP_DAILY_WITHIN_MS } from "../../../src/life/snapshot.js";

/**
 * THE COPY OF HER IS ACTUALLY TAKEN, ON A CLOCK, BY THE DAEMON.
 *
 * A backup module with tests and no production call site is precisely the shape of the disk-monitor
 * failure found earlier: three functions, fully tested, green forever, and never once called.
 * `snapshot.ts` being correct is worth nothing if nothing runs it, so the wiring is asserted here
 * rather than assumed, and asserted against the daemon's source, because `src/index.ts` is 0%
 * line-covered by design and source-scanning guards are the only witness it has.
 */

const DAEMON = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");

describe("her copies are scheduled by the daemon", () => {
  it("one on a clock, every hour", () => {
    const at = DAEMON.indexOf('takeHerSnapshot("hourly")');
    expect(at, "the hourly copy is gone — she would only ever be copied at boot").toBeGreaterThan(-1);
    expect(DAEMON.slice(at, at + 120)).toMatch(/60 \* 60 \* 1000/u);
  });

  it("one at boot, so a machine that is started rarely is still copied", () => {
    expect(DAEMON).toMatch(/takeHerSnapshot\("boot"\)/u);
  });

  it("one immediately after she closes a day", () => {
    // The daily tick is the largest single change her field undergoes in one step: the diary is
    // written and FROZEN (never rewritten, by architecture), rest prunes and fuses, and themes are
    // minted that nothing ever deletes. The state worth returning to is the one from a second
    // before that, not an hour before it.
    const at = DAEMON.indexOf("snapshotAfterDayClose?.()");
    expect(at, "nothing copies her around the day boundary").toBeGreaterThan(-1);
    const marker = DAEMON.indexOf("lastLifeTickDay = today;");
    expect(marker).toBeGreaterThan(-1);
    expect(at - marker, "the copy is not taken at the day close any more").toBeLessThan(600);
    expect(DAEMON).toMatch(/snapshotAfterDayClose = \(\) => \{ takeHerSnapshot\("after-day-close"\); \}/u);
  });

  it("one before any migration — the last moment her data is still what it was", () => {
    const at = DAEMON.indexOf("beforeMigrate:");
    expect(at, "a schema migration can now run with no copy of the previous shape").toBeGreaterThan(-1);
    expect(DAEMON.slice(at, at + 700)).toMatch(/reason: "before-migration"/u);
  });

  it("a failed copy is never silent", () => {
    // Best-effort by construction: a snapshot must never stop her living, but "best-effort" plus
    // "silent" is how a backup becomes a belief instead of a fact.
    const at = DAEMON.indexOf("function takeHerSnapshot");
    expect(at).toBeGreaterThan(-1);
    const body = DAEMON.slice(at, at + 1600);
    expect(body).toMatch(/faultLog\.record\("snapshot\.incomplete"[\s\S]*?"critical"\)/u);
    expect(body).toMatch(/faultLog\.record\("snapshot\.failed"[\s\S]*?"critical"\)/u);
  });

  it("and old ones are pruned, or her home grows without bound", () => {
    const at = DAEMON.indexOf("function takeHerSnapshot");
    expect(DAEMON.slice(at, at + 1600)).toMatch(/pruneSnapshots\(/u);
    // The two windows are ordered, so the coarse tier cannot be shorter than the fine one, which
    // would keep nothing at all in the range that matters and still look like it was working.
    expect(KEEP_ALL_WITHIN_MS).toBeLessThan(KEEP_DAILY_WITHIN_MS);
  });

  it("the copy is taken THROUGH sqlite, never as a file copy", () => {
    // The whole reason this module exists: a byte copy of a WAL database silently omits committed
    // transactions. If the daemon ever hands the snapshot a plain path instead of the connection,
    // that failure comes straight back.
    expect(DAEMON).toMatch(/snapshotDbFrom\(db\.db/u);
    expect(DAEMON).not.toMatch(/cpSync\([^)]*data\.db/u);
  });
});
