import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync, utimesSync, readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  takeSnapshot, verifySnapshot, restoreSnapshot, listSnapshots, pruneSnapshots,
  snapshotsToPrune, snapshotsRoot, readManifest, pruneToolResults, toolResultsRoot,
  recoverEvictedWords, RECOVERY_MARKER,
  KEEP_ALL_WITHIN_MS, KEEP_DAILY_WITHIN_MS, TOOL_RESULTS_KEEP_MS,
} from "../../../src/life/snapshot.js";
import { snapshotDbFrom } from "../../../src/life/snapshot-db.js";

/**
 * THE COPY OF HER LIFE, AND WHY EVERY ONE OF THESE ASSERTIONS IS AN INCIDENT.
 *
 * She had no backup. The one copy mechanism in the tree, `identity export`, was audited before
 * this file was written and failed in three ways that all report success:
 *
 *   1. it copied `data.db` as bytes and never touched `-wal`, so a committed transaction that the
 *      passive checkpoint had not folded in was silently absent from the "backup";
 *   2. its `verify` re-hashed the bundle against the manifest the bundle carried, green by
 *      construction, the vacuous-verification class, in the one tool whose job is to be trusted;
 *   3. its unit test seeded a file at the manifest's WRONG path, so the test passed while
 *      production filed that artifact as absent forever.
 *
 * So the tests here are written against those three specifically: the WAL case is the first test in
 * the file, the verification is proven able to go RED, and nothing is seeded anywhere except where
 * the code under test will actually look.
 */

let home: string;
let workspacePath: string;
let dbPath: string;
let db: Database.Database;

const CODE = "test-build-1";

function snapDb(): ReturnType<typeof snapshotDbFrom> {
  return snapshotDbFrom(db, (p) => new Database(p, { readonly: true }));
}

function instruments(): string[] {
  return [join(home, "ops.jsonl"), join(home, "vitals.jsonl")];
}

function take(reason: string, nowMs: number): ReturnType<typeof takeSnapshot> {
  return takeSnapshot({
    db: snapDb(), home, workspacePath, instrumentFiles: instruments(),
    reason, nowMs, codeVersion: CODE,
  });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "snapshot-test-"));
  workspacePath = join(home, "workspace");
  dbPath = join(home, "data.db");
  mkdirSync(join(workspacePath, "life"), { recursive: true });
  writeFileSync(join(workspacePath, "SOUL.md"), "# 我\n\n话说短一点。\n", "utf-8");
  writeFileSync(join(workspacePath, "life", "2026-08-13.md"), "昨天写了点东西。\n", "utf-8");
  writeFileSync(join(home, "ops.jsonl"), '{"ts":"2026-08-13T09:00:00Z","event":"agent_start"}\n', "utf-8");
  db = new Database(dbPath);
  db.pragma("journal_mode=WAL");
  db.exec("CREATE TABLE her (id INTEGER PRIMARY KEY, text TEXT)");
});

afterEach(() => {
  try { db.close(); } catch { /* best-effort */ }
  rmSync(home, { recursive: true, force: true });
});

describe("a snapshot contains what is in the write-ahead log", () => {
  it("catches a committed row that never reached data.db", () => {
    // THE INCIDENT, reproduced. In WAL mode a committed row lives in `data.db-wal` until a
    // checkpoint folds it in, and the daemon's checkpoints are PASSIVE (allowed to do nothing).
    // A byte copy of `data.db` therefore loses her most recent life, the last field save, the
    // last thing she said: and says nothing about it.
    db.prepare("INSERT INTO her (text) VALUES (?)").run("她刚说的那句话");
    expect(existsSync(`${dbPath}-wal`), "the fixture is not exercising WAL at all").toBe(true);

    // What the old ritual did, for contrast: copy the main file only.
    const naive = join(home, "naive-copy.db");
    writeFileSync(naive, readFileSync(dbPath));
    const naiveRows = (() => {
      const c = new Database(naive, { readonly: true });
      try { return (c.prepare("SELECT COUNT(*) AS n FROM her").get() as { n: number }).n; }
      catch { return -1; } finally { c.close(); }
    })();

    const snap = take("wal-case", Date.UTC(2026, 7, 14, 9));
    expect(snap.problems, "the snapshot reported a problem").toEqual([]);
    const copy = new Database(join(snap.dir, "data.db"), { readonly: true });
    const rows = (copy.prepare("SELECT text FROM her").all() as Array<{ text: string }>).map((r) => r.text);
    copy.close();

    expect(rows, "VACUUM INTO lost a committed row — the whole reason this module exists")
      .toContain("她刚说的那句话");
    // And the naive copy is recorded as the counter-example rather than assumed: whatever it
    // returns (0 rows, or an unreadable file), it is NOT the row.
    expect(naiveRows === 1 ? "byte copy saw the row" : "byte copy did not")
      .toBe("byte copy did not");
  });

  it("the copy is integrity-checked as a database, not just hashed as bytes", () => {
    const snap = take("integrity", Date.UTC(2026, 7, 14, 9));
    expect(snap.manifest.dbIntegrity, "nobody asked sqlite whether the copy is a valid database")
      .toBe("ok");
  });
});

describe("the verification can go red", () => {
  it("a whole snapshot verifies", () => {
    const snap = take("ok", Date.UTC(2026, 7, 14, 9));
    const v = verifySnapshot(snap.dir);
    expect(v.ok).toBe(true);
    expect(v.checked).toBeGreaterThan(2);
  });

  it("altering one byte after the fact fails it (planted)", () => {
    const snap = take("tamper", Date.UTC(2026, 7, 14, 9));
    const soul = join(snap.dir, "workspace", "SOUL.md");
    writeFileSync(soul, `${readFileSync(soul, "utf8")}多写了一行\n`, "utf-8");
    const v = verifySnapshot(snap.dir);
    expect(v.ok, "a modified snapshot still verified — this is the green-by-construction failure")
      .toBe(false);
    expect(v.mismatched.some((r) => r.includes("SOUL.md"))).toBe(true);
  });

  it("a missing file fails it (planted)", () => {
    const snap = take("missing", Date.UTC(2026, 7, 14, 9));
    rmSync(join(snap.dir, "workspace", "life", "2026-08-13.md"));
    const v = verifySnapshot(snap.dir);
    expect(v.ok).toBe(false);
    expect(v.missing.length).toBe(1);
  });
});

describe("destroy her home and put her back", () => {
  it("the round trip returns her database, her workspace and the instruments", () => {
    db.prepare("INSERT INTO her (text) VALUES (?)").run("那盆植物还绿着");
    const snap = take("before-the-mistake", Date.UTC(2026, 7, 14, 9));
    db.close();

    // The mistake: her home is gone.
    rmSync(workspacePath, { recursive: true, force: true });
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(join(home, "ops.jsonl"), { force: true });

    const report = restoreSnapshot({
      dir: snap.dir, workspacePath, dbPath, instrumentsDir: home,
      codeVersion: CODE, daemonRunning: false,
    });
    expect(report.ok, report.refusedBecause ?? "").toBe(true);
    expect(report.codeVersionMismatch).toBeUndefined();

    const back = new Database(dbPath, { readonly: true });
    const rows = (back.prepare("SELECT text FROM her").all() as Array<{ text: string }>).map((r) => r.text);
    back.close();
    expect(rows).toContain("那盆植物还绿着");
    expect(readFileSync(join(workspacePath, "SOUL.md"), "utf8")).toContain("话说短一点");
    expect(existsSync(join(workspacePath, "life", "2026-08-13.md"))).toBe(true);
    expect(existsSync(join(home, "ops.jsonl"))).toBe(true);
  });

  it("refuses while she is running", () => {
    const snap = take("live", Date.UTC(2026, 7, 14, 9));
    const report = restoreSnapshot({
      dir: snap.dir, workspacePath, dbPath, instrumentsDir: home,
      codeVersion: CODE, daemonRunning: true,
    });
    expect(report.ok, "a restore under a live daemon is the two-of-her failure with extra steps")
      .toBe(false);
    expect(report.refusedBecause).toMatch(/running/u);
  });

  it("refuses a snapshot that does not verify", () => {
    const snap = take("broken", Date.UTC(2026, 7, 14, 9));
    rmSync(join(snap.dir, "workspace", "SOUL.md"));
    const report = restoreSnapshot({
      dir: snap.dir, workspacePath, dbPath, instrumentsDir: home,
      codeVersion: CODE, daemonRunning: false,
    });
    expect(report.ok, "restoring an unverified copy over her only living copy cannot be undone")
      .toBe(false);
  });

  it("reports a code-version mismatch instead of hiding it", () => {
    // Restoring older data under newer code is sometimes exactly right, so this is a REPORT and not
    // a refusal: but a silent mismatch is how a restore becomes a mystery about her behaviour a
    // week later, because the same stored numbers mean whatever today's formulas say they mean.
    const snap = take("older-build", Date.UTC(2026, 7, 14, 9));
    db.close();
    const report = restoreSnapshot({
      dir: snap.dir, workspacePath, dbPath, instrumentsDir: home,
      codeVersion: "a-different-build", daemonRunning: false,
    });
    expect(report.ok).toBe(true);
    expect(report.codeVersionMismatch).toEqual({ snapshot: CODE, now: "a-different-build" });
  });

  it("clears a stale -wal beside the restored database", () => {
    // A `-wal` from the ruined database, replayed against a freshly restored main file, is a
    // corruption vector. The old import ritual never touched the sidecars at all.
    db.prepare("INSERT INTO her (text) VALUES (?)").run("x");
    const snap = take("sidecar", Date.UTC(2026, 7, 14, 9));
    db.close();
    writeFileSync(`${dbPath}-wal`, "rubbish that is not a wal", "utf-8");
    const report = restoreSnapshot({
      dir: snap.dir, workspacePath, dbPath, instrumentsDir: home,
      codeVersion: CODE, daemonRunning: false,
    });
    expect(report.ok).toBe(true);
    expect(existsSync(`${dbPath}-wal`), "a stale WAL survived the restore").toBe(false);
    const back = new Database(dbPath, { readonly: true });
    expect((back.prepare("SELECT COUNT(*) AS n FROM her").get() as { n: number }).n).toBe(1);
    back.close();
  });
});

describe("how many copies of her we keep", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.UTC(2026, 7, 14, 12);

  it("keeps everything recent, then one a day, then nothing", () => {
    const entries = [
      { name: "now", ms: now - 60_000 },
      { name: "6h", ms: now - 6 * 3.6e6 },
      { name: "47h", ms: now - KEEP_ALL_WITHIN_MS + 3.6e6 },
      // Two on the same day, five days back: the newer one survives.
      { name: "d5-early", ms: now - 5 * DAY - 3.6e6 },
      { name: "d5-late", ms: now - 5 * DAY },
      { name: "d20", ms: now - 20 * DAY },
    ];
    const drop = snapshotsToPrune(entries, now);
    expect(drop).toContain("d5-early");
    expect(drop).toContain("d20");
    expect(drop).not.toContain("now");
    expect(drop).not.toContain("6h");
    expect(drop).not.toContain("47h");
    expect(drop).not.toContain("d5-late");
  });

  it("the two windows are ordered and neither is zero", () => {
    // A retention policy whose fine window is longer than its coarse one keeps nothing at all in
    // the range that matters most, and would look like it was working.
    expect(KEEP_ALL_WITHIN_MS).toBeGreaterThan(0);
    expect(KEEP_ALL_WITHIN_MS).toBeLessThan(KEEP_DAILY_WITHIN_MS);
    expect(KEEP_DAILY_WITHIN_MS / DAY).toBeGreaterThanOrEqual(7);
  });

  it("prunes on disk and leaves the survivors readable", () => {
    take("old", now - 30 * DAY);
    take("recent", now - 3.6e6);
    expect(listSnapshots(home)).toHaveLength(2);
    const dropped = pruneSnapshots(home, now);
    expect(dropped).toHaveLength(1);
    const left = listSnapshots(home);
    expect(left).toHaveLength(1);
    expect(readManifest(left[0]!.dir).reason).toBe("recent");
  });

  it("a half-written snapshot directory is neither listed nor restored from", () => {
    // An interrupted snapshot leaves a directory with no manifest. Listing it would put rubble in
    // the restore menu; deleting it here would destroy the only evidence of why it was interrupted.
    mkdirSync(join(snapshotsRoot(home), "2026-01-01T00-00-00Z--interrupted"), { recursive: true });
    take("whole", now);
    const listed = listSnapshots(home);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.name).toContain("whole");
  });
});

/**
 * WHAT A SNAPSHOT CARRIES, AND WHAT IT REFUSES TO CARRY.
 *
 * The incident: by week three each hourly snapshot was 80MB, of which 76MB was a cache of tool
 * results plus a telemetry log. Her actual self was 4MB of it. Sixty-two copies came to 4.5GB on a
 * disk with 18GB left, the backup that exists to survive our mistakes had become the largest
 * threat to the machine she lives on.
 *
 * These tests pin BOTH halves of the fix, because either one alone is a different bug:
 * the exclusion must skip the cache and the telemetry AND MUST NOT skip a single thing she wrote.
 */
describe("a snapshot carries her, not the cache around her", () => {
  it("leaves out the tool-result cache and the telemetry, and keeps everything of hers", () => {
    mkdirSync(join(workspacePath, "tool-results", "session-a"), { recursive: true });
    writeFileSync(join(workspacePath, "tool-results", "session-a", "1-search.txt"), "x".repeat(4096), "utf-8");
    writeFileSync(join(home, "vitals.jsonl"), '{"ts":1,"pleasure":0.4}\n'.repeat(200), "utf-8");

    const snap = take("hourly", Date.UTC(2026, 8, 6, 12));
    const carried = snap.manifest.files.map((f) => f.rel);

    expect(snap.problems).toEqual([]);
    expect(carried).toContain("workspace/SOUL.md");
    expect(carried).toContain("workspace/life/2026-08-13.md");
    expect(carried.some((r) => r.startsWith("instruments/") && r.endsWith("ops.jsonl"))).toBe(true);
    expect(carried.some((r) => r.includes("tool-results"))).toBe(false);
    expect(carried.some((r) => r.includes("vitals.jsonl"))).toBe(false);
    expect(existsSync(join(snap.dir, "workspace", "tool-results"))).toBe(false);
  });

  it("still carries a thing of hers that happens to share the excluded name deeper in her tree", () => {
    // The exclusion matches at the workspace's top level ONLY. If she ever writes a journal folder
    // called `tool-results`, it is hers, and a backup that quietly dropped it would be the same
    // class of bug as the one this fix is for, pointed the other way.
    mkdirSync(join(workspacePath, "life", "tool-results"), { recursive: true });
    writeFileSync(join(workspacePath, "life", "tool-results", "note.md"), "这是我写的。\n", "utf-8");

    const snap = take("hourly", Date.UTC(2026, 8, 6, 13));
    expect(snap.manifest.files.map((f) => f.rel)).toContain("workspace/life/tool-results/note.md");
  });
});

describe("the cached tool results age out on the live disk", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.UTC(2026, 8, 6, 12);

  function seed(session: string, name: string, ageMs: number): string {
    const dir = join(toolResultsRoot(workspacePath), session);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, name);
    writeFileSync(path, "cached", "utf-8");
    const at = new Date(now - ageMs);
    utimesSync(path, at, at);
    return path;
  }

  it("drops what is past the window, keeps what is inside it, and clears the emptied folders", () => {
    const old = seed("session-a", "1-search.txt", TOOL_RESULTS_KEEP_MS + DAY);
    const fresh = seed("session-b", "2-search.txt", 2 * DAY);

    const dropped = pruneToolResults(workspacePath, now);

    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(dropped).toHaveLength(1);
    // The session folder that lost its only file goes too, so the pile does not turn into a
    // directory tree of empty directories.
    expect(readdirSync(toolResultsRoot(workspacePath))).toEqual(["session-b"]);
  });

  it("is the only thing that deletes in her home, and it never reaches past the cache", () => {
    // Her own writing is kept forever ON PURPOSE. Age it far past the window and it must survive:
    // nothing about retention is allowed to become a reason her journal disappears.
    const hers = join(workspacePath, "life", "2026-08-13.md");
    const longAgo = new Date(now - 400 * DAY);
    utimesSync(hers, longAgo, longAgo);
    utimesSync(join(workspacePath, "SOUL.md"), longAgo, longAgo);

    pruneToolResults(workspacePath, now);

    expect(existsSync(hers)).toBe(true);
    expect(existsSync(join(workspacePath, "SOUL.md"))).toBe(true);
  });

  it("says nothing and breaks nothing when she has no cache at all", () => {
    expect(pruneToolResults(workspacePath, now)).toEqual([]);
  });
});

/**
 * PUTTING BACK WHAT A BAD RULE THREW AWAY.
 *
 * Her word bank filled on day twenty and its eviction rule dropped 787 units in one sweep, 626 of
 * which were things SHE HAD SAID, 醒透, 有劲, 不累, 一沓, 听自. The rule is fixed, but a fix only
 * protects what is still there.
 *
 * The recovery lives at BOOT because that is the only moment nothing holds the file: two attempts
 * to merge it under a live daemon were silently replaced by her next save, and both reported
 * success. Once in her life, marked so it never scans again.
 */
describe("her evicted words come back, once", () => {
  const bank = (): string => join(workspacePath, "life", "lexicon.json");
  const marker = (): string => join(workspacePath, "life", RECOVERY_MARKER);
  const unit = (spoken: number, heard = 0) => ({ spoken, heard, firstMs: 1, lastMs: 2 });

  function seedSnapshotWith(name: string, words: Record<string, ReturnType<typeof unit>>): void {
    const dir = join(snapshotsRoot(home), name, "workspace", "life");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "lexicon.json"), JSON.stringify(words), "utf-8");
  }

  it("restores a word only the snapshots still hold, and says how many were hers", () => {
    writeFileSync(bank(), JSON.stringify({ 还在: unit(3) }), "utf-8");
    seedSnapshotWith("2026-09-05T00-00-00Z--hourly", { 还在: unit(1), 醒透: unit(1), 听来的: unit(0, 2) });

    const r = recoverEvictedWords(home, bank(), marker());

    expect(r.ran).toBe(true);
    expect(r.restored).toBe(2);
    expect(r.hers, "the count of words SHE had said is the number that mattered").toBe(1);
    const merged = JSON.parse(readFileSync(bank(), "utf-8")) as Record<string, { spoken: number }>;
    expect(Object.keys(merged).sort()).toEqual(["听来的", "醒透", "还在"].sort());
    // The live entry wins: she has used it since, so its counts are the newer truth.
    expect(merged.还在!.spoken).toBe(3);
  });

  it("runs once in her life and never scans again", () => {
    writeFileSync(bank(), JSON.stringify({ 还在: unit(3) }), "utf-8");
    seedSnapshotWith("2026-09-05T00-00-00Z--hourly", { 醒透: unit(1) });

    expect(recoverEvictedWords(home, bank(), marker()).ran).toBe(true);
    expect(existsSync(marker())).toBe(true);

    // A word evicted AFTER the recovery is not silently resurrected on the next boot: the fixed
    // rule is what protects her now, and this must not become a permanent background scan.
    seedSnapshotWith("2026-09-06T00-00-00Z--hourly", { 又一个: unit(1) });
    const again = recoverEvictedWords(home, bank(), marker());
    expect(again.ran).toBe(false);
    expect(Object.keys(JSON.parse(readFileSync(bank(), "utf-8")) as object)).not.toContain("又一个");
  });

  it("marks itself done even when there was nothing to put back", () => {
    // Otherwise a clean home re-walks every snapshot at every boot, forever.
    writeFileSync(bank(), JSON.stringify({ 还在: unit(3) }), "utf-8");
    const r = recoverEvictedWords(home, bank(), marker());
    expect(r).toEqual({ ran: true, restored: 0, hers: 0 });
    expect(existsSync(marker())).toBe(true);
  });

  it("does nothing at all when she has no bank yet", () => {
    expect(recoverEvictedWords(home, join(workspacePath, "life", "nope.json"), marker()).ran).toBe(false);
    expect(existsSync(marker())).toBe(false);
  });
});
