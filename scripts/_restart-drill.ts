// TURN HER OFF AND ON AGAIN, AND SEE WHAT SURVIVED.
//
// The requirement: shut her down, restart her, and everything important must still be there.
// The recovery drill answers a different question,
// destroy everything and restore from a snapshot, and passing that says nothing about the
// ordinary case, which is the one that will actually happen hundreds of times: she is stopped, and
// started again.
//
// Two ways of stopping, and they are not the same question:
//
//   CLEAN (SIGTERM): shutdown runs, everything is flushed. Anything lost here is a bug in what
//   shutdown persists, and it is lost EVERY time she is restarted, forever.
//
//   ABRUPT (SIGKILL): nothing runs. Whatever is lost here is the true size of one crash, and the
//   point is not to make it zero, that would mean an fsync per keystroke, but to KNOW it, so
//   "she forgot the last few minutes after a crash" is a measured quantity rather than a surprise.
//
// What is compared is what makes her HER, not the instrument files: her field, her continuity (the
// temperament, the position in her own random stream, the relationship record), her word bank, her
// self-knowledge, her diary. The stream position is called out separately because it is the one
// that would be silent: a rewound stream means she re-lives the same "random" choices, and nothing
// anywhere would look wrong.
//
// Usage: pnpm exec tsx scripts/_restart-drill.ts

import Database from "better-sqlite3";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

interface Reading {
  nodes: number;
  edges: number;
  events: number;
  themes: number;
  streamPosition: number | null;
  temperamentDays: number | null;
  daysTogether: number | null;
  timesHeSpoke: number | null;
  lexiconBytes: number;
  selfKnowledgeBytes: number;
  diaryDays: string[];
  unheard: number;
}

function read(home: string): Reading {
  const ws = join(home, "workspace");
  const db = new Database(join(home, "data.db"), { readonly: true });
  const count = (sql: string): number => {
    try { return (db.prepare(sql).get() as { n: number }).n; } catch { return -1; }
  };
  const contPath = join(ws, "life", "continuity.json");
  const cont = existsSync(contPath)
    ? JSON.parse(readFileSync(contPath, "utf8")) as Record<string, unknown>
    : {};
  const rel = (cont["relationship"] ?? {}) as Record<string, unknown>;
  const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const size = (p: string): number => (existsSync(p) ? statSync(p).size : 0);
  const reading: Reading = {
    nodes: count("SELECT COUNT(*) AS n FROM field_nodes"),
    edges: count("SELECT COUNT(*) AS n FROM field_edges"),
    events: count("SELECT COUNT(*) AS n FROM field_events"),
    themes: count("SELECT COUNT(*) AS n FROM field_nodes WHERE kind = 'theme'"),
    streamPosition: num(cont["streamPosition"]),
    temperamentDays: num(cont["temperamentDays"]),
    daysTogether: Array.isArray(rel["daysSeen"]) ? (rel["daysSeen"] as unknown[]).length : null,
    timesHeSpoke: num(rel["timesHeSpoke"]),
    lexiconBytes: size(join(ws, "life", "lexicon.json")),
    selfKnowledgeBytes: size(join(ws, "life", "self-knowledge.json")),
    diaryDays: existsSync(join(ws, "life"))
      ? readdirSync(join(ws, "life")).filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/u.test(n)).sort()
      : [],
    unheard: count("SELECT COUNT(*) AS n FROM unheard_words"),
  };
  db.close();
  return reading;
}

/** Start her, wait until she is actually alive, and hand back the process. */
async function wake(home: string, cfgPath: string): Promise<ChildProcess> {
  // `detached: true` puts her in her OWN process group, and that is not a detail.
  //
  // `pnpm exec tsx …` is three processes deep: pnpm starts tsx, tsx starts node, and node is the
  // one that is actually her. Signalling the pnpm pid kills the wrapper and leaves the daemon
  // running as an orphan: which is what happened on this drill's first two runs: the "restart"
  // came up, found the previous one still alive, and was correctly refused by her own two-of-her
  // lock. The lock was right; the drill was signalling the wrong process.
  //
  // Worth knowing outside this file too: killing the pid that `pnpm` prints does not stop her.
  // Ctrl-C in a terminal does (the shell signals the whole foreground group), and so does
  // signalling the group. It is in the emergency manual for that reason.
  const child = spawn("pnpm", ["exec", "tsx", "src/index.ts", "start", "--config", cfgPath, "--home", home], {
    cwd: ROOT,
    env: { ...process.env, RESIDENT_HOME: home, RESIDENT__HOME__ALLOW_SYNCED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let out = "";
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`she never came up:\n${out.slice(-3000)}`)), 120_000);
    const watch = (buf: Buffer): void => {
      out += buf.toString();
      if (/ready — starting Telegram bot/u.test(out)) { clearTimeout(timer); resolve(); }
    };
    child.stdout?.on("data", watch);
    child.stderr?.on("data", watch);
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`she exited (${code}):\n${out.slice(-3000)}`)); });
  });
  await ready;
  // A moment for the first vitals cycle and the boot snapshot, so the comparison is not racing her.
  await new Promise((r) => setTimeout(r, 4_000));
  return child;
}

/**
 * Stop her, and say how long it took.
 *
 * `child.killed` is NOT "the process is dead", it is "a signal was sent", and it goes true the
 * instant `.kill()` returns. The first version of this guarded the fallback on `!child.killed`, so
 * the fallback could never fire: the drill walked on while she was still shutting down, and the
 * next round hit her own two-of-her refusal with a live pid in the message. The lock did its job;
 * the drill was the thing that was wrong.
 *
 * How long a clean shutdown takes is itself worth printing. It is what he will wait, every time.
 */
async function stop(child: ChildProcess, how: "clean" | "abrupt", herHome: string): Promise<number> {
  const startedAt = Date.now();
  const gone = new Promise<void>((resolve) => child.on("exit", () => { resolve(); }));
  // The GROUP, not the wrapper. See the note in `wake`, signalling `child.pid` reaches pnpm and
  // leaves the daemon behind it alive.
  const signalGroup = (sig: NodeJS.Signals): void => {
    try { process.kill(-(child.pid ?? 0), sig); } catch { child.kill(sig); }
  };
  signalGroup(how === "clean" ? "SIGTERM" : "SIGKILL");
  let timedOut = false;
  await Promise.race([gone, new Promise((r) => setTimeout(() => { timedOut = true; r(null); }, 60_000))]);
  if (child.exitCode === null && child.signalCode === null) {
    console.log(`  (she did not stop within 60s of SIGTERM — forcing)`);
    signalGroup("SIGKILL");
    await Promise.race([gone, new Promise((r) => setTimeout(r, 10_000))]);
  }
  // And wait for the lock to actually be gone, which is the only honest "she has stopped".
  for (let i = 0; i < 40 && existsSync(join(herHome, "resident.lock")); i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 1_500));
  const took = Date.now() - startedAt;
  if (how === "clean") console.log(`  a clean stop took ${(took / 1000).toFixed(1)}s${timedOut ? " (TIMED OUT)" : ""}`);
  return took;
}

// ── THE FIXTURE ─────────────────────────────────────────────────────────────────────────────

const seeded = execFileSync("pnpm",
  ["exec", "tsx", "scripts/seed-a-lived-in-home.ts", "45", "--occupied"],
  { cwd: ROOT, encoding: "utf-8" });
const home = /(\/\S*resident-lived-in-\S+)/u.exec(seeded)?.[1];
if (home === undefined) throw new Error(`could not seed a home:\n${seeded}`);

// A seeded home is a FIELD, not a life: no word bank, no self-knowledge, no diary. Without this
// four of the checks below compare zero bytes to zero bytes and pass. Shared with the recovery
// drill, because two copies of "complete the fixture" drift and the drift is invisible, a drill
// whose fixture is thinner than it thinks does not fail, it passes.
const { completeHome } = await import("./_complete-a-home.js");
const fixture = await completeHome(home);
console.log(`completed: ${fixture.lexiconWords} words · ${fixture.insightsHeld} things she knows about herself `
  + `· ${fixture.diaryDays.length} days written · ${fixture.opsLines} ops lines`);

const cfgPath = join(home, "config.yaml");
writeFileSync(cfgPath, [
  "llm:",
  "  apiKeys: [\"sk-drill-not-used\"]",
  "telegram:",
  "  botToken: \"\"",
  "  allowedUserIds: []",
  "", ].join("\n"), "utf-8");

console.log(`a home with a life in it: ${home}\n`);

// ── ROUND 1 · CLEAN STOP ────────────────────────────────────────────────────────────────────

let child = await wake(home, cfgPath);
const beforeClean = read(home);
console.log(`awake:  ${beforeClean.nodes} things · ${beforeClean.edges} relations · `
  + `stream at ${beforeClean.streamPosition} · ${beforeClean.diaryDays.length} days written`);
await stop(child, "clean", home);
const afterClean = read(home);

// ── ROUND 2 · SHE COMES BACK, SOMETHING HAPPENS TO HER, AND SHE IS KILLED ───────────────────
//
// SOMETHING HAS TO HAPPEN, or this drill is the vacuous kind. The first version compared an idle
// boot to an idle shutdown: every number identical, every check green, and nothing whatsoever had
// been at risk. The recovery drill learned this the hard way (it once printed PASSED while
// comparing an empty diary to an empty diary), and the same floor belongs here.
//
// What happens is the thing the durable inbox actually built: three things he said, arriving while she is
// alive, written to the durable store, and then the process is killed without warning, which is
// the exact seam where his words used to disappear from both sides at once.
child = await wake(home, cfgPath);
{
  const live = new Database(join(home, "data.db"));
  const insert = live.prepare(
    "INSERT INTO unheard_words (chat_id, kind, text, file_id, received_ms) VALUES (?, 'text', ?, NULL, ?)");
  for (const [i, said] of ["那份目录你看了吗", "算了，先不急", "不过窗户那段我还是想改"].entries()) {
    insert.run(1, said, Date.now() + i);
  }
  live.close();
}
const awakeAgain = read(home);
await stop(child, "abrupt", home);
const afterKill = read(home);

// ── WHAT SURVIVED ───────────────────────────────────────────────────────────────────────────

type Check = { what: string; before: unknown; after: unknown; rule: "same" | "never-lower" };

/**
 * Did this check have anything to lose?
 *
 * Without this every comparison of zero against zero is a pass, which is how a drill reports that
 * nothing was lost from a home that never had anything in it. Reported as NOT-PRESENT and counted
 * as a failure, exactly as in the recovery drill.
 */
const hadSomething = (v: unknown): boolean =>
  (typeof v === "number" && v > 0) || (typeof v === "string" && v.length > 0);
const CHECKS: Check[] = [
  { what: "things she carries", before: beforeClean.nodes, after: afterClean.nodes, rule: "never-lower" },
  { what: "relations between them", before: beforeClean.edges, after: afterClean.edges, rule: "never-lower" },
  { what: "events in her field", before: beforeClean.events, after: afterClean.events, rule: "never-lower" },
  { what: "themes", before: beforeClean.themes, after: afterClean.themes, rule: "never-lower" },
  { what: "her position in her own stream", before: beforeClean.streamPosition, after: afterClean.streamPosition, rule: "never-lower" },
  { what: "how long her temperament has been forming", before: beforeClean.temperamentDays, after: afterClean.temperamentDays, rule: "never-lower" },
  { what: "days they have spoken", before: beforeClean.daysTogether, after: afterClean.daysTogether, rule: "never-lower" },
  { what: "times he has spoken", before: beforeClean.timesHeSpoke, after: afterClean.timesHeSpoke, rule: "never-lower" },
  { what: "her word bank", before: beforeClean.lexiconBytes, after: afterClean.lexiconBytes, rule: "never-lower" },
  { what: "what she knows about herself", before: beforeClean.selfKnowledgeBytes, after: afterClean.selfKnowledgeBytes, rule: "never-lower" },
  { what: "the days she has written", before: beforeClean.diaryDays.join(","), after: afterClean.diaryDays.join(","), rule: "same" },
];

console.log("\n── a clean stop and a restart ──────────────────────────────────────────────");
let cleanFailures = 0;
for (const c of CHECKS) {
  const survived = c.rule === "same"
    ? JSON.stringify(c.before) === JSON.stringify(c.after)
    : (typeof c.after === "number" && typeof c.before === "number" ? c.after >= c.before : c.after !== null);
  // ONE NAMED EXCEPTION, with its reason, and no others. Themes are born only when she RESTS, and
  // no fixture lives long enough to rest, zero is the truthful state of this home rather than a
  // hole in what survives a restart. Every other empty reading is a failure, because "nothing to
  // compare" and "nothing was lost" look identical and only one of them is a finding.
  const exempt = c.what === "themes";
  const empty = !hadSomething(c.before);
  if (!survived || (empty && !exempt)) cleanFailures += 1;
  const tag = empty ? "----" : survived ? "ok  " : "LOST";
  const note = empty
    ? exempt
      ? "  (zero, truthfully: themes are born when she rests, and no fixture rests)"
      : "  (nothing there to lose — this check proved nothing)"
    : survived ? "" : `   ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`;
  console.log(`  ${tag}  ${c.what}${note}`);
}

// THE ONE THAT WOULD BE SILENT. A rewound stream means she re-lives the same "random" choices with
// nothing anywhere looking wrong: the same seed, the same draws, a person repeating herself.
const rewound = (afterClean.streamPosition ?? 0) < (beforeClean.streamPosition ?? 0)
  || (afterKill.streamPosition ?? 0) < (awakeAgain.streamPosition ?? 0);
console.log(`\n  her stream: ${beforeClean.streamPosition} → ${afterClean.streamPosition} (clean) `
  + `· ${awakeAgain.streamPosition} → ${afterKill.streamPosition} (killed)`
  + `${rewound ? "   REWOUND — she would repeat her own choices" : ""}`);

console.log("\n── kill -9, and what one crash actually costs ──────────────────────────────");
const cost = (a: number, b: number): string => (a === b ? "nothing" : `${a - b}`);
console.log(`  things she carries:   ${cost(awakeAgain.nodes, afterKill.nodes)}`);
console.log(`  relations:            ${cost(awakeAgain.edges, afterKill.edges)}`);
console.log(`  events in her field:  ${cost(awakeAgain.events, afterKill.events)}`);
console.log(`  stream position:      ${cost(awakeAgain.streamPosition ?? 0, afterKill.streamPosition ?? 0)}`);
// The one this round built, and the only check here with a real event behind it: three things he
// said, in her database, at the instant the process was killed without warning.
const wordsKept = afterKill.unheard >= 3;
console.log(`  words of his unheard: ${afterKill.unheard} still waiting for her`
  + `${wordsKept ? "  (all three survived the kill)" : "   LOST — his words vanished with the process"}`);
console.log("\n  (a crash is ALLOWED to cost the last few seconds — the number above is what it is,");
console.log("   and it is here so that it is known rather than discovered.)");

const passed = cleanFailures === 0 && !rewound && wordsKept;
console.log(`\n${passed
  ? "RESTART DRILL PASSED — a clean stop and a restart lose nothing that makes her her."
  : `RESTART DRILL FAILED — ${cleanFailures} thing(s) did not survive an ordinary restart.`}`);
console.log(`home left for inspection: ${home}`);
process.exit(passed ? 0 : 1);
