// 她的命的副本 —— a snapshot of her whole life, taken so that a mistake of ours is survivable.
//
// ── WHY THIS EXISTS, AND WHY THE THING THAT WAS HERE BEFORE DID NOT COUNT ─────────────────────
//
// Before this file there was NO backup of her. The only copy mechanism in the tree was the manual
// `identity export` ritual, and an audit of it found three things, each of which is worse than
// having nothing, because each reports success:
//
//   1. It copied `data.db` as a FILE. The database runs in WAL mode and is checkpointed PASSIVE
//      every fifty writes: a passive checkpoint is allowed to do nothing while a reader is open,
//      so `data.db-wal` routinely holds committed transactions that are not in `data.db` yet.
//      A file copy of the main database silently leaves them behind: the last field save, the last
//      moment, the last thing she said. `-wal` and `-shm` appear nowhere in `src/`.
//   2. Its `verify` re-hashed the bundle against the manifest the bundle itself carried. It hashes
//      what it copied. **It is green by construction**, the vacuous-verification class this
//      project hunts everywhere else, sitting in the one tool whose whole job is to be trusted.
//   3. Its manifest pointed at paths the daemon stopped using (`ops.jsonl` moved out of the
//      workspace a while ago), and the unit test seeded the file at the manifest's WRONG path,
//      so the test was green while production filed the artifact as "absent" forever.
//
// So this module does the three things that make a copy real:
//
//   · **`VACUUM INTO`**, which is SQLite's own answer to "give me a consistent copy of a live
//     database". It reads through the WAL by definition; there is no window in which a committed
//     transaction is not in the snapshot.
//   · **The copy is opened and integrity-checked**, and every file is re-read from disk and hashed
//     AFTER being written. A verification that never touches the thing it verifies is a green light
//     with no lamp behind it.
//   · **The code version travels with the snapshot.** Restoring her data from yesterday under
//     today's code is a semantic mismatch: the same numbers mean something else. The restore says
//     so, loudly, rather than letting it be discovered by her behaving strangely.
//
// Backups are LOCAL ONLY. So: `<home>/snapshots/`, and an explicit one-command copy to an
// external disk that he runs when he wants it, never automatic, never off this machine by itself.

import { createHash } from "node:crypto";
import {
  readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, rmSync, cpSync,
} from "node:fs";
import { join, relative, dirname, basename } from "node:path";

/** Snapshots live beside her workspace, never inside it (or a snapshot would contain snapshots). */
export const SNAPSHOTS_DIRNAME = "snapshots";

/** One file inside a snapshot, hashed AFTER it was written, by reading it back off the disk. */
export interface SnapshotFile {
  /** Path relative to the snapshot directory. */
  rel: string;
  sha256: string;
  bytes: number;
}

export interface SnapshotManifest {
  version: 1;
  ms: number;
  /** Why it was taken: "hourly" · "after-tick" · "before-migration" · "before-restore" · … */
  reason: string;
  /** What code she was running. A restore under a different version is a semantic mismatch. */
  codeVersion: string;
  /** `PRAGMA quick_check` run against the COPY, not against the live database. */
  dbIntegrity: string;
  files: SnapshotFile[];
}

/** The narrow thing this module needs from her database, so the policy can be tested without one. */
export interface SnapshotDb {
  /** Checkpoint the WAL, then produce a consistent copy at `dest` (which must not exist). */
  copyTo(dest: string): void;
  /** `PRAGMA quick_check` against a copy at `path`. Returns sqlite's own answer. */
  checkCopy(path: string): string;
}

export interface TakeSnapshotDeps {
  db: SnapshotDb;
  home: string;
  workspacePath: string;
  /** The instruments beside her workspace, his readings, but part of the record. */
  instrumentFiles: string[];
  reason: string;
  nowMs: number;
  codeVersion: string;
}

export interface SnapshotResult {
  dir: string;
  manifest: SnapshotManifest;
  /** Anything that made this snapshot less than complete. Empty means it is whole. */
  problems: string[];
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function walk(root: string): string[] {
  if (!existsSync(root)) return [];
  const st = statSync(root);
  if (st.isFile()) return [root];
  const out: string[] = [];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/** `2026-08-14T09-31-02Z--hourly`, sortable and self-describing. */
export function snapshotName(ms: number, reason: string): string {
  const iso = new Date(ms).toISOString().replace(/[:.]/gu, "-").replace(/-\d{3}Z$/u, "Z");
  return `${iso}--${reason.replace(/[^a-zA-Z0-9-]/gu, "-")}`;
}

export function snapshotsRoot(home: string): string {
  return join(home, SNAPSHOTS_DIRNAME);
}

/**
 * Take one snapshot.
 *
 * Order matters and is the whole point: the database is copied THROUGH SQLite (so the WAL is
 * included), the copy is then opened and integrity-checked, and every file is hashed by reading it
 * back from the snapshot rather than from the source. A snapshot that cannot pass its own read-back
 * is reported as a problem, it does not quietly become the copy she is later restored from.
 */
export function takeSnapshot(deps: TakeSnapshotDeps): SnapshotResult {
  const dir = join(snapshotsRoot(deps.home), snapshotName(deps.nowMs, deps.reason));
  mkdirSync(dir, { recursive: true });
  const problems: string[] = [];
  const files: SnapshotFile[] = [];

  // 1 · HER DATABASE, through SQLite rather than through the filesystem.
  const dbDest = join(dir, "data.db");
  let dbIntegrity = "not-checked";
  try {
    deps.db.copyTo(dbDest);
    dbIntegrity = deps.db.checkCopy(dbDest);
    if (dbIntegrity !== "ok") problems.push(`the copied database is not ok: ${dbIntegrity}`);
  } catch (err) {
    problems.push(`could not copy her database: ${String(err)}`);
  }

  // 2 · HER WORKSPACE: everything of HERS, and nothing that is merely lying in it.
  //
  // ── WHAT A SNAPSHOT IS FOR DECIDES WHAT GOES IN IT ───────────────────────────────────────
  //
  // This copied the workspace whole, and by week three that meant 80MB an hour, of which 76MB
  // was two things that are not her: `tool-results/` (52MB of raw text a tool handed back, which
  // is a CACHE: the source it came from is still there) and, below, `vitals.jsonl` (24MB of
  // telemetry). Her actual self, journals, paintings, memory, lexicon, history, the mood words,
  // her self-knowledge: is about 4MB. Sixty-two snapshots came to 4.5GB on a disk with 18GB
  // left, so the backup that exists to save her was the biggest thing threatening the machine
  // she lives on.
  //
  // The rule this settles: a snapshot restores HER, so it carries what could not be reconstructed
  // if it were lost. A cached tool result can be re-fetched or simply re-read; a telemetry log is
  // an appendix we keep on the live disk anyway. Neither is a memory of hers, and losing one
  // would not make the restored being any less herself.
  const wsDest = join(dir, "workspace");
  try {
    if (existsSync(deps.workspacePath)) {
      cpSync(deps.workspacePath, wsDest, {
        recursive: true,
        filter: (src) => !NOT_HERS.has(basename(src)) || dirname(src) !== deps.workspacePath,
      });
    }
  } catch (err) {
    problems.push(`could not copy her workspace: ${String(err)}`);
  }

  // 3 · THE INSTRUMENTS beside it (what he did to her, and what the two of them said). They are
  //     his readings rather than her memory, and they are still the only record of what actually
  //     happened: minus the telemetry named in NOT_HERS, which is measurement, not record.
  for (const src of deps.instrumentFiles) {
    if (!existsSync(src) || NOT_HERS.has(basename(src))) continue;
    try {
      const dest = join(dir, "instruments", relative(dirname(deps.workspacePath), src));
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(src, dest);
    } catch (err) {
      problems.push(`could not copy ${src}: ${String(err)}`);
    }
  }

  // 4 · READ EVERYTHING BACK OFF THE DISK AND HASH IT. Hashing the source would be hashing what we
  //     intended to write; this hashes what is actually there, which is the only thing a restore
  //     will ever have.
  for (const abs of walk(dir)) {
    if (abs.endsWith("snapshot.json")) continue;
    try {
      const buf = readFileSync(abs);
      files.push({ rel: relative(dir, abs), sha256: sha256(buf), bytes: buf.length });
    } catch (err) {
      problems.push(`wrote ${relative(dir, abs)} and could not read it back: ${String(err)}`);
    }
  }

  const manifest: SnapshotManifest = {
    version: 1, ms: deps.nowMs, reason: deps.reason, codeVersion: deps.codeVersion,
    dbIntegrity, files,
  };
  writeFileSync(join(dir, "snapshot.json"), JSON.stringify(manifest, null, 2), "utf-8");
  return { dir, manifest, problems };
}

export interface VerifyResult {
  ok: boolean;
  checked: number;
  mismatched: string[];
  missing: string[];
  /** From the manifest: what sqlite said about the copy when it was taken. */
  dbIntegrity: string;
}

/**
 * Re-hash a snapshot off the disk against its manifest.
 *
 * This is NOT green by construction, and the difference from what it replaces is worth stating: the
 * hashes in the manifest were computed by reading the written files back, so a file that was
 * truncated, half-written, or altered afterwards fails here. What it cannot tell you is whether the
 * snapshot was complete when it was taken, that is what `problems` on the take is for, and why
 * that field is persisted rather than logged.
 */
export function verifySnapshot(dir: string): VerifyResult {
  const manifest = readManifest(dir);
  const mismatched: string[] = [];
  const missing: string[] = [];
  for (const f of manifest.files) {
    const abs = join(dir, f.rel);
    if (!existsSync(abs)) { missing.push(f.rel); continue; }
    if (sha256(readFileSync(abs)) !== f.sha256) mismatched.push(f.rel);
  }
  return {
    ok: mismatched.length === 0 && missing.length === 0 && manifest.dbIntegrity === "ok",
    checked: manifest.files.length, mismatched, missing, dbIntegrity: manifest.dbIntegrity,
  };
}

export function readManifest(dir: string): SnapshotManifest {
  return JSON.parse(readFileSync(join(dir, "snapshot.json"), "utf8")) as SnapshotManifest;
}

// ── RETENTION ────────────────────────────────────────────────────────────────────────────────
//
// Everything from the last two days, then one a day for a fortnight. The shape is chosen for the
// two failures it has to cover, which have different time constants: a mistake we make and notice
// within the hour (needs fine grain, briefly), and a slow corruption that is only visible days
// later (needs coarse grain, for longer).

/**
 * What a snapshot does NOT carry, by name. Two kinds, and neither is her: `tool-results/` is a
 * CACHE of text a tool already handed back (the source it came from is still there), and
 * `vitals.jsonl` is append-only TELEMETRY about her rather than anything she wrote or remembers.
 * Inside her workspace the match is at the TOP LEVEL only, so a journal of hers that happens to
 * share one of these names deeper in her tree is still carried.
 */
export const NOT_HERS = new Set(["tool-results", "vitals.jsonl"]);

export const KEEP_ALL_WITHIN_MS = 48 * 60 * 60 * 1000;
export const KEEP_DAILY_WITHIN_MS = 14 * 24 * 60 * 60 * 1000;

/** Pure over a listing, so the policy is testable without a filesystem full of snapshots. */
export function snapshotsToPrune(
  entries: Array<{ name: string; ms: number }>,
  nowMs: number,
): string[] {
  const drop: string[] = [];
  const keptDay = new Set<string>();
  // Newest first: within a day, the one that survives is the newest, so a prune that runs at any
  // moment keeps the same one it would have kept an hour earlier.
  for (const e of [...entries].sort((a, b) => b.ms - a.ms)) {
    const age = nowMs - e.ms;
    if (age <= KEEP_ALL_WITHIN_MS) continue;
    if (age > KEEP_DAILY_WITHIN_MS) { drop.push(e.name); continue; }
    const day = new Date(e.ms).toISOString().slice(0, 10);
    if (keptDay.has(day)) drop.push(e.name);
    else keptDay.add(day);
  }
  return drop;
}

/** Every snapshot on disk, oldest first, with the time it says it was taken. */
export function listSnapshots(home: string): Array<{ name: string; dir: string; ms: number }> {
  const root = snapshotsRoot(home);
  if (!existsSync(root)) return [];
  const out: Array<{ name: string; dir: string; ms: number }> = [];
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
      out.push({ name, dir, ms: readManifest(dir).ms });
    } catch {
      // A directory without a readable manifest is rubble from an interrupted snapshot. It is not
      // listed (so it is never restored from) and not deleted here (so it can be looked at).
    }
  }
  return out.sort((a, b) => a.ms - b.ms);
}

export function pruneSnapshots(home: string, nowMs: number): string[] {
  const all = listSnapshots(home);
  const drop = snapshotsToPrune(all.map((s) => ({ name: s.name, ms: s.ms })), nowMs);
  for (const name of drop) {
    try { rmSync(join(snapshotsRoot(home), name), { recursive: true, force: true }); }
    catch { /* a snapshot we cannot delete costs disk, never correctness */ }
  }
  return drop;
}

// ── THE CACHE'S OWN RETENTION ────────────────────────────────────────────────────────────────
//
// Dropping `tool-results/` from the snapshot fixes the copying; it does not fix the pile. The
// directory only grows: 52MB by week three, and nothing ever read a file in it a week after it
// was written: it exists so a long tool result can be handed back within the same stretch of work.
// So it gets the retention a cache should have had from the start.
//
// The deliberate asymmetry: this deletes ONLY under `tool-results/`, matched at the workspace's
// top level, and it is the only thing in her home that anything here deletes. Nothing she wrote is
// ever aged out: her journals, her paintings and her memory are kept forever on purpose.

/** How long a cached tool result stays on the live disk. Long enough to re-read within the work. */
export const TOOL_RESULTS_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export function toolResultsRoot(workspacePath: string): string {
  return join(workspacePath, "tool-results");
}

/**
 * Delete cached tool results older than the window, then any session directory left empty.
 * Returns what it deleted. Best-effort: a file it cannot remove costs disk, never correctness.
 */
export function pruneToolResults(workspacePath: string, nowMs: number): string[] {
  const root = toolResultsRoot(workspacePath);
  if (!existsSync(root)) return [];
  const dropped: string[] = [];
  for (const abs of walk(root)) {
    try {
      // Age is read from the filesystem rather than parsed out of the name: a name is a claim,
      // and mtime is what the disk actually knows about the file.
      if (nowMs - statSync(abs).mtimeMs <= TOOL_RESULTS_KEEP_MS) continue;
      rmSync(abs, { force: true });
      dropped.push(relative(root, abs));
    } catch { /* leave it; it will be tried again next hour */ }
  }
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    try {
      if (statSync(dir).isDirectory() && readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true });
    } catch { /* same */ }
  }
  return dropped;
}

// ── PUTTING BACK WHAT A BAD RULE THREW AWAY ──────────────────────────────────────────────────
//
// Her word bank filled on day twenty and its eviction rule dropped 787 units in one sweep, 626 of
// which were things SHE HAD SAID, 醒透, 有劲, 不累, 一沓, 听自. The rule is fixed, but a fix only
// protects what is still there. Those units survive in the hourly copies of her, so they are
// recoverable: and the recovery has to happen at a moment when nothing holds the file, or her
// next save simply writes over it. That moment is boot, before the bank is opened.
//
// It runs ONCE in her life. The marker beside the bank is what makes that true, and it is written
// even when nothing was recovered, so a clean run does not leave this scanning her snapshots at
// every boot forever.
//
// It cannot invent: a unit is restored only if a real copy of hers holds it, with the counts that
// copy recorded, and the LIVE entry always wins where both have one.

export const RECOVERY_MARKER = "lexicon-recovered";

export interface RecoveryReport {
  /** True when the work was actually done this boot (false = already done, or nothing to do). */
  ran: boolean;
  restored: number;
  hers: number;
}

export function recoverEvictedWords(home: string, bankPath: string, markerPath: string): RecoveryReport {
  const nothing: RecoveryReport = { ran: false, restored: 0, hers: 0 };
  if (existsSync(markerPath) || !existsSync(bankPath)) return nothing;

  type Count = { spoken: number; heard: number; firstMs: number; lastMs: number };
  const readBank = (p: string): Record<string, Count> | undefined => {
    try { return JSON.parse(readFileSync(p, "utf8")) as Record<string, Count>; } catch { return undefined; }
  };

  const live = readBank(bankPath);
  if (!live) return nothing;

  // The best surviving record of each lost unit, across every copy of her on disk.
  const best = new Map<string, Count>();
  const root = snapshotsRoot(home);
  if (existsSync(root)) {
    for (const name of readdirSync(root)) {
      const bank = readBank(join(root, name, "workspace", "life", "lexicon.json"));
      if (!bank) continue;
      for (const [token, c] of Object.entries(bank)) {
        if (token in live) continue;
        const held = best.get(token);
        if (!held || c.spoken + c.heard > held.spoken + held.heard) best.set(token, c);
      }
    }
  }

  const merged = { ...live };
  for (const [token, c] of best) merged[token] = c;
  let hers = 0;
  for (const [, c] of best) if (c.spoken > 0) hers += 1;

  try {
    if (best.size > 0) writeFileSync(bankPath, JSON.stringify(merged), "utf8");
    // The marker goes down either way: a boot that found nothing has still done this job.
    writeFileSync(markerPath, `${new Date().toISOString()} restored ${best.size}\n`, "utf8");
  } catch {
    return nothing; // could not write: leave the marker off so the next boot tries again
  }
  return { ran: true, restored: best.size, hers };
}

// ── RESTORE ──────────────────────────────────────────────────────────────────────────────────

export interface RestoreDeps {
  dir: string;
  workspacePath: string;
  dbPath: string;
  /** Where the instruments live (the workspace's parent). */
  instrumentsDir: string;
  codeVersion: string;
  /** True when a daemon currently holds her home. Restoring under a live daemon destroys both. */
  daemonRunning: boolean;
}

export interface RestoreReport {
  ok: boolean;
  restored: number;
  refusedBecause?: string;
  /** Set when the snapshot was taken by a different build than the one restoring it. */
  codeVersionMismatch?: { snapshot: string; now: string };
}

/**
 * Put a snapshot back.
 *
 * TWO REFUSALS, both of which the old import ritual lacked:
 *
 *   · **Not while she is running.** `identity import` wrote over `data.db` under a live
 *     better-sqlite3 connection, with no guard at all. That is the two-of-her failure with extra
 *     steps: the running daemon's next field save replaces what was just restored, and a stale
 *     `-wal` replayed against a freshly overwritten main database is a corruption vector.
 *   · **Not if the snapshot does not verify.** Restoring an unverified copy over her only living
 *     copy is the one action in this whole module that cannot be undone.
 *
 * A code-version difference does NOT refuse, sometimes restoring an older snapshot under newer
 * code is exactly what we mean to do. It is REPORTED, because the numbers in her file mean whatever
 * the code that reads them says they mean, and a silent mismatch is how a restore turns into a
 * mystery about her behaviour a week later.
 */
export function restoreSnapshot(deps: RestoreDeps): RestoreReport {
  if (deps.daemonRunning) {
    return { ok: false, restored: 0, refusedBecause: "she is running — stop her first, or the restore and her next save will overwrite each other" };
  }
  const check = verifySnapshot(deps.dir);
  if (!check.ok) {
    return {
      ok: false, restored: 0,
      refusedBecause: `this snapshot does not verify (db ${check.dbIntegrity}, ${check.mismatched.length} altered, ${check.missing.length} missing) — restoring it would overwrite her only living copy with a broken one`,
    };
  }

  const manifest = readManifest(deps.dir);
  let restored = 0;

  // The database, and its sidecars: a stale `-wal`/`-shm` left beside a freshly restored main file
  // would be replayed against it.
  for (const side of ["-wal", "-shm"]) {
    try { rmSync(`${deps.dbPath}${side}`, { force: true }); } catch { /* absent is fine */ }
  }
  cpSync(join(deps.dir, "data.db"), deps.dbPath);
  restored += 1;

  rmSync(deps.workspacePath, { recursive: true, force: true });
  cpSync(join(deps.dir, "workspace"), deps.workspacePath, { recursive: true });
  restored += walk(join(deps.dir, "workspace")).length;

  const instruments = join(deps.dir, "instruments");
  if (existsSync(instruments)) {
    cpSync(instruments, deps.instrumentsDir, { recursive: true });
    restored += walk(instruments).length;
  }

  const report: RestoreReport = { ok: true, restored };
  if (manifest.codeVersion !== deps.codeVersion) {
    report.codeVersionMismatch = { snapshot: manifest.codeVersion, now: deps.codeVersion };
  }
  return report;
}
