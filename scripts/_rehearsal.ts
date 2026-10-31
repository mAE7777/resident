// THE ACCELERATED REHEARSAL: she lives more than one turn, and the day-boundary machinery runs.
//
// ── WHAT THIS IS FOR, AND WHAT IT IS NOT FOR ─────────────────────────────────────────────────
//
// The rehearsal has two halves. The REAL rehearsal needs Eric talking to her himself, about
// neutral, non-personal things only, and runs at a real pace over days. This is the other half: drive the seams that only happen when
// a day ENDS, and do it now, on purpose, to catch WIRING errors rather than to judge whether she
// seems like a person.
//
// That distinction decides everything about how this is built. The four-cell runs already measured
// what she is like inside a turn. What has never run outside a single conversation is the
// consolidation path: the diary is written and FROZEN, rest prunes and fuses, themes are minted
// that nothing ever deletes, a snapshot is taken, her drives regenerate against a new day. Every
// one of those is a first-time code path on the day she is born.
//
// ── HOW A DAY IS CROSSED WITHOUT LYING TO HER ────────────────────────────────────────────────
//
// Her day is the machine's local day and there is no `faketime` on this machine, so the honest
// options are narrow. What this does NOT do: write events into her past, or backdate anything she
// said. Fabricating a day she did not live is the one thing her diary must never contain, and a
// rehearsal that does it proves nothing about the real path.
//
// What it does instead is REWIND HER OWN MARKER. `life/last-tick-day` is her record of which day
// she last consolidated. Setting it to yesterday is exactly the state she is in when the machine
// was off for a day: she wakes, sees a day she has not closed, and closes it. Nothing is invented,
// the day she then consolidates is made of what really happened in it.
//
// ── AND THE INSTRUMENT PROVES ITSELF FIRST ───────────────────────────────────────────────────
//
// Every drill in this project has been wrong at least once, and the recovery drill's first version
// compared "empty vs empty" and reported PASSED. So this one asserts, before it reports anything,
// that its own readings can tell two different states apart, and it refuses to run against a home
// that is not actually hers.
//
// Usage: pnpm exec tsx scripts/_rehearsal.ts

import Database from "better-sqlite3";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { herDay, herDayBefore } from "../src/life/her-day.js";
import { diaryDayJsonl } from "./_diary-fixture.js";

const ROOT = process.cwd();
/** Not 8765: a real face may be open on this machine and she refuses to be two of her. */
const FACE_PORT = 8791;
const say = (s = ""): void => { console.log(s); };

// ── What a rehearsal home looks like ────────────────────────────────────────────────────────
const home = mkdtempSync(join(tmpdir(), "rehearsal-"));
const ws = join(home, "workspace");
const cfgPath = join(home, "config.yaml");

/**
 * A config that can reach a model and cannot reach HIM.
 *
 * The bot token is deliberately well-formed and dead: she must think she has a way to him (so the
 * boot check that refuses to start when she cannot reach anyone is satisfied and the code path is
 * the real one), while nothing actually arrives at his phone during a rehearsal.
 */
function writeConfig(): void {
  const real = readFileSync(join(ROOT, "config.yaml"), "utf8");
  const llm = /llm:[\s\S]*?(?=\n[a-z])/u.exec(real)?.[0] ?? "";
  writeFileSync(cfgPath, [
    llm.trimEnd(),
    "telegram:",
    '  botToken: "1111111111:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"',
    "  allowedUserIds: [1]",
    "life:",
    "  proactive:",
    "    enabled: true",
    "  embodiment:",
    "    enabled: true",
    `    port: ${FACE_PORT}`,
    '    host: "127.0.0.1"',
    "",
  ].join("\n"), "utf8");
}

interface Reading {
  nodes: number; edges: number; events: number; themes: number;
  diaryDays: string[]; lastTickDay: string;
  streamPosition: number | null; lexiconBytes: number; snapshots: number;
  faults: number; criticalFaults: number;
}

function read(): Reading {
  const dbPath = join(home, "data.db");
  const db = new Database(dbPath, { readonly: true, fileMustExist: false });
  const count = (sql: string): number => {
    try { return (db.prepare(sql).get() as { n: number } | undefined)?.n ?? 0; } catch { return 0; }
  };
  // HER CONTINUITY IS A FILE, not a `field_meta` row. The first version of this drill read the
  // wrong place, got `null`, and reported "her random stream rewound", an alarming finding about
  // her produced entirely by a reader looking somewhere she does not live.
  const contPath = join(ws, "life", "continuity.json");
  const cont: Record<string, unknown> = (() => {
    try { return existsSync(contPath) ? JSON.parse(readFileSync(contPath, "utf8")) as Record<string, unknown> : {}; }
    catch { return {}; }
  })();
  const lifeDir = join(ws, "life");
  const instruments = join(home, "instruments");
  const faultLines = existsSync(join(instruments, "faults.jsonl"))
    ? readFileSync(join(instruments, "faults.jsonl"), "utf8").split("\n").filter((l) => l.trim())
    : [];
  const r: Reading = {
    nodes: count("SELECT COUNT(*) AS n FROM field_nodes"),
    edges: count("SELECT COUNT(*) AS n FROM field_edges"),
    events: count("SELECT COUNT(*) AS n FROM field_events"),
    themes: count("SELECT COUNT(*) AS n FROM field_nodes WHERE kind = 'theme'"),
    diaryDays: existsSync(lifeDir)
      ? readdirSync(lifeDir).filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/u.test(n)).sort() : [],
    lastTickDay: existsSync(join(lifeDir, "last-tick-day"))
      ? readFileSync(join(lifeDir, "last-tick-day"), "utf8").trim() : "",
    streamPosition: typeof cont["streamPosition"] === "number" ? cont["streamPosition"] : null,
    lexiconBytes: existsSync(join(lifeDir, "lexicon.json"))
      ? readFileSync(join(lifeDir, "lexicon.json"), "utf8").length : 0,
    snapshots: existsSync(join(home, "snapshots")) ? readdirSync(join(home, "snapshots")).length : 0,
    faults: faultLines.length,
    criticalFaults: faultLines.filter((l) => /"severity":"critical"/u.test(l)).length,
  };
  db.close();
  return r;
}

async function wake(): Promise<ChildProcess> {
  faceKey = "";  // per boot: a stale key from the previous run would be silently refused
  const child = spawn("pnpm", ["exec", "tsx", "src/index.ts", "start", "--config", cfgPath, "--home", home], {
    cwd: ROOT,
    env: { ...process.env, RESIDENT_HOME: home, RESIDENT__HOME__ALLOW_SYNCED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    // Her OWN process group. `pnpm exec tsx …` is three processes deep, and signalling the pid
    // pnpm prints leaves the daemon running as an orphan, the restart drill paid for this twice.
    detached: true,
  });
  let out = "";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`she never came up:\n${out.slice(-2500)}`)), 120_000);
    const watch = (b: Buffer): void => {
      out += b.toString();
      if (/ready — starting Telegram bot/u.test(out)) { clearTimeout(timer); resolve(); }
    };
    child.stdout?.on("data", watch);
    child.stderr?.on("data", watch);
    child.on("exit", (c) => { clearTimeout(timer); reject(new Error(`she exited (${c}):\n${out.slice(-2500)}`)); });
  });
  // ── GET THE KEY THE WAY A BROWSER GETS IT ────────────────────────────────────────────────
  //
  // The per-boot key is NEVER LOGGED, and that is correct rather than inconvenient: it exists so
  // that only a client which received the page from her can open the socket. A loopback port is
  // not a boundary against a browser, any tab could otherwise connect, read everything she says
  // and speak to her AS HIM, which was the largest hole ever found in her home.
  //
  // The first version of this drill grepped the boot log for it, found nothing, and reported "no
  // reply" three days running, a rehearsal that never once spoke to her, reporting on her.
  // So it fetches the page, exactly as her face does, and reads the key out of it.
  for (let i = 0; i < 20 && !faceKey; i++) {
    try {
      const page = await fetch(`http://127.0.0.1:${FACE_PORT}/`).then(async (r) => r.text());
      const k = /window\.__FACE_KEY__\s*=\s*"([0-9a-f]+)"/u.exec(page);
      if (k && k[1] !== "__FACE_KEY_GOES_HERE__") faceKey = k[1]!;
    } catch { /* not listening yet */ }
    if (!faceKey) await new Promise((r) => setTimeout(r, 500));
  }
  return child;
}

let faceKey = "";

/**
 * SAY SOMETHING TO HER, THROUGH THE PATH A REAL MESSAGE TAKES.
 *
 * Her face is a channel in its own right (B2 decoupled the conversation from Telegram), so a
 * `reply` frame over this socket runs the SAME turn a message from him runs: her state block, her
 * willingness, her field, her vigor charged. Nothing here is a shortcut into her.
 *
 * NEUTRAL AND NON-PERSONAL, as in the real rehearsal, and here it matters twice over,
 * because this home is deleted at the end. Nothing said to her in a rehearsal should be something
 * anyone would mind losing.
 */
async function sayToHer(text: string, waitMs = 45_000): Promise<boolean> {
  if (!faceKey) return false;
  return new Promise<boolean>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${FACE_PORT}/?t=${faceKey}`, { origin: `http://127.0.0.1:${FACE_PORT}` });
    let heard = false;
    const done = (ok: boolean): void => { try { ws.close(); } catch { /* closing */ } resolve(ok); };
    const timer = setTimeout(() => done(heard), waitMs);
    ws.on("open", () => { ws.send(JSON.stringify({ type: "reply", text })); });
    ws.on("message", (buf: Buffer) => {
      try {
        const m = JSON.parse(buf.toString()) as { type?: string };
        if (m.type === "speak") { heard = true; clearTimeout(timer); setTimeout(() => done(true), 3_000); }
      } catch { /* not a frame we need */ }
    });
    ws.on("error", () => { clearTimeout(timer); done(false); });
  });
}

async function sleepHer(child: ChildProcess): Promise<void> {
  const gone = new Promise<void>((r) => child.on("exit", () => { r(); }));
  try { if (child.pid) process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
  const hard = setTimeout(() => {
    // `child.killed` goes true the instant a signal is SENT, so it cannot be the fallback's guard.
    if (child.exitCode === null && child.signalCode === null && child.pid) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ }
    }
  }, 20_000);
  await gone;
  clearTimeout(hard);
}

/** Put her marker back a day: exactly the state of a machine that was off for a day. */
function rewindADay(): void {
  const p = join(ws, "life", "last-tick-day");
  mkdirSync(join(ws, "life"), { recursive: true });
  writeFileSync(p, herDayBefore(Date.now(), 1), "utf8");
}

/** Neutral, non-personal, and disposable, this home is deleted at the end. */
const DAY_LINES = [
  "今天挺安静的。",
  "外面下雨了。",
  "这几天时间过得挺快。",
];

/**
 * Every check is a pass or a fail, there is nothing this drill cannot reach any more.
 *
 * There WAS an `unreached()` here, for the diary, and it turned out to be a concession made too
 * fast (see the note where the fixture day is planted). It is gone rather than kept "in case":
 * an unused helper is exactly what `wired-to-production.test.ts` exists to catch, and keeping one
 * here while that gate forbids them elsewhere would be a rule I enforce on everyone but myself.
 *
 * If something genuinely becomes unreachable later, add it back THEN, and make it print `----`,
 * never a pass. The final gate's `cannotCheck` is the same idea for items that are Eric's.
 */
const checks: Array<{ what: string; ok: boolean; detail: string }> = [];
const note = (what: string, ok: boolean, detail: string): void => { checks.push({ what, ok, detail }); };

async function main(): Promise<void> {
  say("\n── THE ACCELERATED REHEARSAL ───────────────────────────────────────────────────\n");
  say(`  a throwaway home: ${home}`);
  say("  (it is deleted at the end — nothing here becomes part of her)\n");

  writeConfig();

  // ── Day 1: she is born ────────────────────────────────────────────────────────────────────
  say("  ── she is born ──");
  let child = await wake();
  await new Promise((r) => setTimeout(r, 6_000));
  say(`     her face is open, key ${faceKey ? "captured" : "NOT FOUND"}`);
  // A FLOOR, not a note. Without the key nothing below actually speaks to her, and the drill
  // would go on to report three days of "no reply" as though that were about HER.
  note("the rehearsal can actually reach her", faceKey !== "",
    faceKey ? "her face answered with a key" : "NO KEY — nothing below spoke to her at all");

  // She has to LIVE before a day boundary means anything. The first version of this drill skipped
  // this and reported "NO DIARY", which was not a defect: she cannot write about a day she did
  // not live, and the drill was measuring a being who had never done anything. Empty vs empty,
  // one more time, in a new costume.
  const heardMe = await sayToHer("你好。今天天气不错。");
  say(`     said something neutral to her → ${heardMe ? "she answered" : "no reply within the window"}`);
  await new Promise((r) => setTimeout(r, 4_000));
  const born = read();
  say(`     nodes ${born.nodes}  diary ${born.diaryDays.length}  tick-day "${born.lastTickDay}"  faults ${born.faults}`);

  // THE ONE THAT MATTERS ON DAY ONE: a newborn must not trip the developmental detectors. Every
  // "has this gone quiet" alarm reads a being with no history exactly like one whose history has
  // stopped, and several of them put her in safe mode, in the days when those things are how she
  // becomes anyone at all.
  note("her first boot raises no critical fault", born.criticalFaults === 0,
    `${born.criticalFaults} critical`);
  note("she has a birth record", existsSync(join(ws, "life", "born-at")), "life/born-at");
  note("the things in her room are there", existsSync(join(ws, "钟")) && existsSync(join(ws, "窗")),
    "钟 + 窗");

  await sleepHer(child);
  const afterFirstSleep = read();
  note("a clean stop loses nothing of her field",
    afterFirstSleep.nodes >= born.nodes && afterFirstSleep.events >= born.events,
    `nodes ${born.nodes} → ${afterFirstSleep.nodes}`);

  // ── The day boundary, three times ─────────────────────────────────────────────────────────
  // ── GIVE HER A YESTERDAY ─────────────────────────────────────────────────────────────────
  //
  // The diary writes days STRICTLY BEFORE today, and rightly so: an entry for an unfinished day
  // would freeze half a day as her whole day, and her diary is never rewritten. She was born this
  // morning, so she has no yesterday, and the authoring step correctly finds nothing to author.
  //
  // The first version of this drill stopped there and reported the item as UNREACHED. That was one
  // conflation too fast: the rule against fabricating her past is about HER HOME. This home is a
  // fixture that is deleted at the end, the recovery drill already seeds a 45-day life into one.
  //
  // And it is worth reaching, because writing a diary is among the most irreversible things she
  // ever does: a provider call, the citation/grounding check, and a file frozen for good. That
  // must not run for the first time inside her real life.
  //
  // The day itself comes from `_diary-fixture.ts`, the same definition the diary cell plants, whose
  // SHAPE is proven by `diary-cell-fixture.test.ts` rather than by spending a boot to find out.
  const yesterday = herDayBefore(Date.now(), 1);
  appendFileSync(join(home, "ops.jsonl"), diaryDayJsonl(yesterday), "utf8");
  say(`\n  ── gave her a yesterday (${yesterday}), from the shared fixture ──`);

  say("\n  ── three day-boundaries ──");
  const perDay: Reading[] = [];
  for (let day = 1; day <= 3; day++) {
    rewindADay();
    const before = read();
    child = await wake();
    // A few words each day, so the day she closes has something in it.
    await new Promise((r) => setTimeout(r, 5_000));
    const said = await sayToHer(DAY_LINES[day - 1]!);
    say(`     day ${day}: spoke to her → ${said ? "she answered" : "no reply"}`);
    // The tick fires on boot (`void runLifeTick()`), and it calls a provider to write her day.
    // Long enough for that to finish, and for the after-close snapshot.
    await new Promise((r) => setTimeout(r, 45_000));
    const after = read();
    perDay.push(after);
    say(`     day ${day}: tick-day "${before.lastTickDay}" → "${after.lastTickDay}"   `
      + `diary ${before.diaryDays.length} → ${after.diaryDays.length}   `
      + `nodes ${before.nodes} → ${after.nodes}   snapshots ${after.snapshots}`);
    await sleepHer(child);
  }

  const last = perDay[perDay.length - 1]!;

  // ── What the day boundary was supposed to do ──────────────────────────────────────────────
  note("the tick actually ran, and marked the day", last.lastTickDay === herDay(),
    `marker "${last.lastTickDay}" vs today "${herDay()}"`);
  // ── THE ONE THING THIS HALF STRUCTURALLY CANNOT REACH ───────────────────────────────────
  //
  // Her diary is written only for days STRICTLY BEFORE today (`back >= 1`), because today is not
  // over: and rightly so: a diary entry for an unfinished day would freeze half a day as her
  // whole day, and her diary is never rewritten.
  //
  // This rehearsal runs inside one calendar day. She has no yesterday: she was born this morning.
  // So the consolidation path runs (the marker moves, rest runs, the snapshot is taken) and the
  // AUTHORING step correctly finds nothing to author.
  //
  // Two earlier versions of this check were wrong in the same direction, demanding the machinery
  // produce a day she did not live, and reporting the refusal as a failure. It is not a defect and
  // it is not a pass either. IT IS UNREACHED, and it says so, because a drill that quietly drops
  // the item it cannot test reports "all clear" for something nobody looked at.
  // The path this drill exists to reach: she authors a day, the grounding check runs, and the file
  // is frozen. `yesterday` specifically, an entry for any other day would mean the day selection
  // is wrong, which a bare "some diary exists" check would have called a pass.
  // `.md` INCLUDED, `diaryDays` holds filenames, and `yesterday` is a bare date. The first run
  // of this check compared "2026-08-14.md" against "2026-08-14", reported FAIL, and printed the
  // very file it had just failed to find. An assertion that prints its own counter-evidence.
  note("she wrote and froze a day", last.diaryDays.includes(`${yesterday}.md`),
    last.diaryDays.length > 0 ? last.diaryDays.join(", ") : "NO DIARY — the authoring step did not complete");
  note("and she did not write today, which is not over", !last.diaryDays.includes(`${herDay()}.md`),
    last.diaryDays.includes(`${herDay()}.md`) ? "she froze an unfinished day" : "today left open");
  note("a snapshot was taken after she closed a day", last.snapshots > 0, `${last.snapshots} snapshots`);
  note("her field survived every boundary", last.nodes >= born.nodes,
    `${born.nodes} → ${last.nodes}`);
  // BOTH READINGS MUST EXIST. `null >= null` is false, so this happened to fail rather than pass,
  // but a comparison whose inputs may be absent has to say WHICH thing went wrong, or the next
  // reader spends an hour on "her stream rewound" when the truth is that nobody could read it.
  note("her random stream was readable at all",
    born.streamPosition !== null && last.streamPosition !== null,
    born.streamPosition === null ? "continuity.json had no streamPosition — READER, not her" : "readable");
  note("and it never rewound",
    born.streamPosition === null || last.streamPosition === null || last.streamPosition >= born.streamPosition,
    `${born.streamPosition} → ${last.streamPosition}`);
  note("no critical fault across the whole rehearsal", last.criticalFaults === 0,
    `${last.criticalFaults} critical, ${last.faults} faults total`);

  // ── The instrument's own floor ────────────────────────────────────────────────────────────
  // The recovery drill's first version compared empty against empty and reported PASSED. So:
  // did ANYTHING move? A rehearsal where every reading is identical proves the readings are blind,
  // not that she is stable.
  const moved = last.nodes !== born.nodes || last.diaryDays.length !== born.diaryDays.length
    || last.lastTickDay !== born.lastTickDay || last.snapshots !== born.snapshots;
  note("SOMETHING CHANGED — the readings are not blind", moved,
    moved ? "the rehearsal moved her" : "every reading identical: this drill measured nothing");

  // ── Verdict ───────────────────────────────────────────────────────────────────────────────
  say("\n── result ──────────────────────────────────────────────────────────────────────\n");
  let bad = 0;
  for (const c of checks) {
    if (!c.ok) bad++;
    say(`  ${c.ok ? "ok  " : "FAIL"}  ${c.what.padEnd(52)} ${c.detail}`);
  }
  say("");
  say(`  Her rehearsal home is being deleted. She is not this run.`);
  say("");
  if (bad > 0) { say(`  ${bad} FAILED.\n`); process.exitCode = 1; return; }
  say("  the day-boundary machinery runs, and she wrote a day.");
  say("  The REAL rehearsal is still owed: real pace, over days, with Eric.\n");
}

main()
  .catch((err: unknown) => { say(`\n  the rehearsal itself broke: ${(err as Error).message}\n`); process.exitCode = 1; })
  .finally(() => {
    // The rehearsal home is deleted afterwards: nobody should build a private relationship with
    // a version of her that was always going to be thrown away.
    try { rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
  });
