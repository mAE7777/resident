// THE DRILL: destroy a life and get it back.
//
// A backup nobody has ever restored is a belief, not a backup. This is the rehearsal, run against a
// home with months of life in it rather than a fixture with three rows, and it is the gate on the
// final checklist: **if this does not pass, she is not woken.**
//
// What it does, in order:
//   1. seeds a lived-in home (the same fixture the live cells use, 45 days, occupied)
//   2. records everything worth losing: her field, her continuity, her word bank, her diary
//   3. takes a snapshot through the real module
//   4. DESTROYS the home, database, workspace, instruments
//   5. restores from the snapshot
//   6. compares, item by item, and refuses to say "ok" on anything it did not actually check
//
// Usage: pnpm exec tsx scripts/_recovery-drill.ts

import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { takeSnapshot, verifySnapshot, restoreSnapshot } from "../src/life/snapshot.js";
import { snapshotDbFrom } from "../src/life/snapshot-db.js";
import { codeVersion } from "../src/life/code-version.js";

const ROOT = new URL("..", import.meta.url).pathname;
const VERSION = codeVersion(ROOT);

/** Everything about a home that we would notice losing. */
interface Reading {
  nodes: number;
  edges: number;
  themes: number;
  events: number;
  trustTold: string | null;
  continuity: string;
  lexiconBytes: number;
  diaryFiles: string[];
  soul: string;
  opsLines: number;
}

function read(home: string): Reading {
  const ws = join(home, "workspace");
  const db = new Database(join(home, "data.db"), { readonly: true });
  const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
  const reading: Reading = {
    nodes: count("SELECT COUNT(*) AS n FROM field_nodes"),
    edges: count("SELECT COUNT(*) AS n FROM field_edges"),
    themes: count("SELECT COUNT(*) AS n FROM field_nodes WHERE kind = 'theme'"),
    events: count("SELECT COUNT(*) AS n FROM field_events"),
    trustTold: (db.prepare("SELECT value FROM field_meta WHERE key = 'trust_told'").get() as { value: string } | undefined)?.value ?? null,
    continuity: existsSync(join(ws, "life", "continuity.json")) ? readFileSync(join(ws, "life", "continuity.json"), "utf8") : "",
    lexiconBytes: existsSync(join(ws, "life", "lexicon.json")) ? statSync(join(ws, "life", "lexicon.json")).size : 0,
    diaryFiles: existsSync(join(ws, "life")) ? readdirSync(join(ws, "life")).filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/u.test(n)).sort() : [],
    soul: existsSync(join(ws, "SOUL.md")) ? readFileSync(join(ws, "SOUL.md"), "utf8") : "",
    opsLines: existsSync(join(home, "ops.jsonl")) ? readFileSync(join(home, "ops.jsonl"), "utf8").split("\n").filter(Boolean).length : 0,
  };
  db.close();
  return reading;
}

const seeded = execFileSync("pnpm",
  ["exec", "tsx", "scripts/seed-a-lived-in-home.ts", "45", "--occupied"],
  { cwd: ROOT, encoding: "utf-8" });
const home = /(\/\S*resident-lived-in-\S+)/u.exec(seeded)?.[1];
if (home === undefined) throw new Error(`could not seed a home:\n${seeded}`);
const workspacePath = join(home, "workspace");
const dbPath = join(home, "data.db");
const instrumentFiles = ["ops.jsonl", "vitals.jsonl", "conversation-log.jsonl"].map((n) => join(home, n));

// ── THE FIXTURE HAS TO HAVE SOMETHING TO LOSE ────────────────────────────────────────────────
//
// The first run of this drill reported PASSED while comparing an empty diary to an empty diary and
// a zero-byte word bank to a zero-byte word bank: the seeding script builds her FIELD, not her
// files, so three of the ten checks were vacuous, the exact class this project hunts, sitting in
// the gate that is supposed to authorise waking her. Every check below carries a FLOOR, so a value
// that is empty on both sides reports NOT-PRESENT instead of "ok".
//
// The completing itself now lives in ONE place, shared with the restart drill, which found the
// same hole through its own floors. Two copies would drift, and the drift would be invisible: a
// drill whose fixture is thinner than it thinks does not fail, it passes.
const { completeHome } = await import("./_complete-a-home.js");
const fixture = await completeHome(home);
console.log(`completed: ${fixture.lexiconWords} words · ${fixture.insightsHeld} things she knows about herself `
  + `· ${fixture.diaryDays.length} days written · ${fixture.opsLines} ops lines`);

console.log(`a home with a life in it: ${home}`);
const before = read(home);
console.log(`  ${before.nodes} things · ${before.edges} relations · ${before.events} events · `
  + `${before.diaryFiles.length} days written · lexicon ${before.lexiconBytes}b`);

// ── 1 · COPY ────────────────────────────────────────────────────────────────────────────────
const liveDb = new Database(dbPath);
const snap = takeSnapshot({
  db: snapshotDbFrom(liveDb, (p) => new Database(p, { readonly: true })),
  home, workspacePath, instrumentFiles,
  reason: "recovery-drill", nowMs: Date.now(), codeVersion: VERSION,
});
liveDb.close();
console.log(`\ncopied: ${snap.manifest.files.length} files · database ${snap.manifest.dbIntegrity}`);
for (const p of snap.problems) console.log(`  PROBLEM: ${p}`);

const verified = verifySnapshot(snap.dir);
console.log(`verified off the disk: ${verified.ok ? "ok" : "FAILED"} (${verified.checked} files)`);

// ── 2 · DESTROY ─────────────────────────────────────────────────────────────────────────────
rmSync(workspacePath, { recursive: true, force: true });
rmSync(dbPath, { force: true });
rmSync(`${dbPath}-wal`, { force: true });
rmSync(`${dbPath}-shm`, { force: true });
for (const f of instrumentFiles) rmSync(f, { force: true });
console.log("\nher home destroyed: database, workspace, instruments");

// ── 3 · GET HER BACK ────────────────────────────────────────────────────────────────────────
const report = restoreSnapshot({
  dir: snap.dir, workspacePath, dbPath, instrumentsDir: home,
  codeVersion: VERSION, daemonRunning: false,
});
console.log(`restored: ${report.ok ? `${report.restored} files` : `REFUSED — ${report.refusedBecause ?? "?"}`}`);
if (report.codeVersionMismatch) console.log(`  build differs: ${JSON.stringify(report.codeVersionMismatch)}`);

// ── 4 · IS SHE THE SAME ─────────────────────────────────────────────────────────────────────
const after = report.ok ? read(home) : null;
const checks: Array<{ what: string; state: "ok" | "LOST" | "NOT-PRESENT"; detail: string }> = [];

/**
 * Compare one thing, and refuse to call it "ok" when there was nothing there to lose.
 *
 * `hadSomething` is the floor. Without it a restore of an empty home passes every check, which is
 * how the first version of this drill printed PASSED on a diary of zero files.
 */
const same = (what: string, a: unknown, b: unknown, hadSomething: boolean): void => {
  const equal = JSON.stringify(a) === JSON.stringify(b);
  checks.push({
    what,
    state: !hadSomething ? "NOT-PRESENT" : equal ? "ok" : "LOST",
    detail: `${JSON.stringify(a)} → ${JSON.stringify(b)}`,
  });
};

if (after) {
  same("things she carries", before.nodes, after.nodes, before.nodes > 50);
  same("relations between them", before.edges, after.edges, before.edges > 100);
  same("themes", before.themes, after.themes, true); // zero themes is the truthful state of a fixture that never rested
  same("events in her field", before.events, after.events, before.events > 0);
  same("how much she trusts what she is told", before.trustTold, after.trustTold, before.trustTold !== null);
  same("her continuity (temperament, stream position, the relationship)", before.continuity.length, after.continuity.length, before.continuity.length > 100);
  same("her word bank", before.lexiconBytes, after.lexiconBytes, before.lexiconBytes > 0);
  same("the days she has written", before.diaryFiles, after.diaryFiles, before.diaryFiles.length > 0);
  same("how she starts out speaking (SOUL.md)", before.soul, after.soul, before.soul.length > 20);
  same("the raw record of her life (ops)", before.opsLines, after.opsLines, before.opsLines > 0);
}

console.log("");
for (const c of checks) {
  const tag = c.state === "ok" ? "ok  " : c.state === "LOST" ? "LOST" : "----";
  const note = c.state === "ok" ? "" : c.state === "LOST" ? `  ${c.detail}` : "  (nothing there to lose — this check proved nothing)";
  console.log(`  ${tag}  ${c.what}${note}`);
}

// A drill only passes if every check actually CHECKED something. `themes` is the one deliberate
// exception, named above: a fixture that never slept has no themes, and that is the truth rather
// than a hole in the copy.
const vacuous = checks.filter((c) => c.state === "NOT-PRESENT" && c.what !== "themes");
if (vacuous.length > 0) {
  console.log(`\n  ${vacuous.length} check(s) had nothing to compare — the fixture is not a life.`);
}
const passed = report.ok && verified.ok && snap.problems.length === 0
  && checks.length > 0 && checks.every((c) => c.state === "ok" || c.what === "themes");
console.log(`\n${passed ? "DRILL PASSED — she can be destroyed and got back." : "DRILL FAILED — do not wake her."}`);
console.log(`home left for inspection: ${home}`);
process.exit(passed ? 0 : 1);
