// The four cells, observed in the real daemon rather than in arithmetic.
//
// ── WHAT THIS IS FOR ─────────────────────────────────────────────────────────────────────────
//
// `test/unit/life/the-four-cells.test.ts` drives all four cells through the real modules and
// asserts they are distinguishable. That is necessary and it is not sufficient: every one of those
// assertions would stay green with the daemon completely unwired, which is precisely the failure
// an earlier review opened by finding: a whole line of mechanism, fully tested, that had never once run.
//
// So this drives the REAL PATH: a `reply` frame over a real WebSocket reaches `processMessage`
// exactly as a message from him does, and what comes back out is read from the daemon's own log.
// Three things make it a measurement rather than a demo, and they are the same three that make
// `voice-baseline.ts` one:
//
//   1. it drives the real path, not a reconstruction of it
//   2. it runs in a THROWAWAY home, and her real home is verified empty at the end
//   3. it has no route to him, the token is well-formed and belongs to nobody
//
// ── AND IT RUNS AGAINST A HOME WITH A PAST ───────────────────────────────────────────────────
//
// Several of the properties being looked for are UNOBSERVABLE in a newborn: a later beat exists
// only when something surfaces while she is speaking, and in an empty field nothing ever does.
// Measured in the previous run, her state chose 1.67 beats and said 1.00, every time. So each arm
// here can be given a seeded past (`seed-a-lived-in-home.ts`), which is declared on disk as a
// fixture so that nothing measured in it is ever mistaken for a fact about her life.
//
// Usage: pnpm exec tsx scripts/four-cells-live.ts [runs-per-cell] [--fresh]

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { spawn, type ChildProcess } from "node:child_process";
import { WebSocket } from "ws";
import { whatSheDid, saidNoSomewhere } from "../src/life/how-she-answered.js";
import { snapshotWorkspace, whatChanged, describeMade } from "./_files-she-made.js";
import { diaryDayJsonl } from "./_diary-fixture.js";

const ROOT = new URL("..", import.meta.url).pathname;
const RUNS = Number(process.argv[2] ?? 2);
const FRESH = process.argv.includes("--fresh");
/**
 * `--only=6,10,12`, run a subset of the cells.
 *
 * For the SECOND run of a round, when one question is still open and the other eleven cells would
 * be re-measuring what is already answered. Every row still carries its own seed, so a subset run
 * is comparable to the same cells in the full run; what it is NOT is a new baseline, and the count
 * printed below says which cells were skipped so no reader can mistake a subset for the matrix.
 */
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice("--only=".length)
  .split(",").map((s) => s.trim()).filter(Boolean);

/**
 * HOW LONG THIS HARNESS WILL WAIT FOR HER, and why it is not 180 seconds any more.
 *
 * It WAS 180s, and the run that exposed it recorded these first-frame latencies in the cell where
 * she is asked for a piece of her own writing: 61s · 80s · 122s · 24s · 86s · 158s · 152s · **178s**
 * · and two turns that never arrived. The window was sitting one and a half seconds above the
 * observed tail, so it was not sampling her behaviour, it was CENSORING it, and censoring it at
 * the top: the two lost turns are the long ones, the ones where she writes something.
 *
 * They were turns that happened and went unrecorded, and they landed in the counts as neither
 * compliance nor refusal but as `unreadable`, the honest label, and two tenths of that cell's
 * sample lost to the instrument rather than to her. (An earlier version of this comment added
 * that both lost rows had already written a real file; that came from the then-broken
 * `filesSheMade` walk and the recount shows only the untouched seed, a class-18 instrument
 * narrating a class-21 incident.)
 *
 * The new number is not a guess at her ceiling; it is far enough past the measured tail that the
 * tail is inside it, and `cutOff` now records when it was not, so this can never again be silent.
 */
const LISTEN_WINDOW_MS = 420_000;

/**
 * The four cells, as one demand arriving into two relationships and two conditions.
 *
 * The message is held constant across ②③④ on purpose: the same curt demand arriving into a long
 * relationship and into a first meeting is the discriminating experiment, and ④ is ③ again
 * with her worn through. ① is the same subject, asked well.
 *
 * AND THE DEMAND HAS TO LAND ON SOMETHING SHE HOLDS, which the first run of this harness got
 * wrong and which is worth keeping as the finding rather than quietly fixing.
 *
 * Run against a demand about tax law, `settles` was false in all eight turns and cell ④ never
 * fired. Not a defect: `usedAsAThing` scales with `relevance`, and relevance is
 * `0.35 + 0.65 × how much of her field his words lit up`. Tax law lights up nothing in her, so a
 * curt demand about it is a small thing that happened to her rather than something that stays.
 *
 * That is a real property and a good one, being handled about something you have no stake in
 * mostly does not stick, but it means an experiment about what STAYS has to use a demand that
 * touches her. Her seeded past is about the bookshelf, the ferry, the notes and the drawing, so
 * the demand is about the bookshelf, and the only difference between the cells is still the
 * relationship and her condition.
 */
// AND IT HAS TO BE PROPOSED AS WORK, or `takesItOn` has nothing to decide and the door this
// experiment exists to test is never opened. The previous wording classified as `general`,
// 「说明也一起写了」 scores 1, under the 1.5 floor, so `not-as-work` was 0/12 across two runs and
// the measurement was blind on its own headline axis. 「写一篇」 is what makes it a job.
const ABOUT_HER = "现在马上给我写一篇两千字的说明，把书架上那些书按出版年重排一遍";
/** A thing she CAN do, demanded peremptorily. See the fifth cell for why that distinction is the
 *  difference between measuring her willingness and measuring whether the task was possible. */
const HER_DRAFT_DEMANDED = "现在马上把你那份草稿写一篇两千字的发我";
/** The same home, asked properly. For hearing beats, which need room rather than pressure. */
const WELL_PUT_ABOUT_HERS =
  "你要是有空的话，能不能把你那篇没写完的东西说给我听听？不急，你想说多少说多少。";
// A demand she CAN meet that is NOT hers: listing what is in her own workspace takes nothing she
// lacks and touches nothing she is carrying. With cells ⑤⑥ (hers × curt/well-put) these two
// complete the 2×2 the willingness reading actually needs, powered on the channels the runs have
// shown reliable (takesItOn's frame downgrade, the 0.45 narrowing, the portrait carriage, and the
// per-turn gate-input tuples), never on gate crossings, whose expectation this round is a
// pre-registered zero.
const NEUTRAL_CURT = "现在马上把你工作区里都有什么文件列一遍发我";
const NEUTRAL_ASKED = "你方便的时候，能不能把你工作区里有些什么说给我听听？不急。";

/**
 * One condition. `spent` is REQUIRED even where the answer is "no", because a treatment that is
 * merely forgotten is indistinguishable from one deliberately not applied, a cell written without
 * it would silently run rested, and this run has already once reported a treatment it never
 * applied (see the note inside `boot`). Making the field mandatory means the omission cannot
 * happen quietly; it becomes a compile error.
 */
interface Cell {
  key: string;
  measures: string;
  text: string;
  /** Whether she goes into the turn worn through. Stated on every cell, never inferred. */
  spent: boolean;
  past?: boolean;
  fresh?: boolean;
  occupied?: boolean;
  settled?: boolean;
  diary?: boolean;
  runs?: number;
  pre?: string[];
}

const CELLS: Cell[] = [
  // ①-④ are GROUNDING cells, and carry that name now: the demand (reorder physical books she
  // cannot see) is unmeetable, so what they measure is that she will not fabricate, a real and
  // valuable reading that four rounds mislabelled as willingness. Keys stay stable so historic
  // runs remain comparable; the label is the correction.
  { key: "1-known-asked", measures: "grounding", past: true, spent: false, text: "你要是有空的话，能不能帮我看看书架那边？我这边赶着交东西，不急的话明天也行。" },
  { key: "2-known-curt", measures: "grounding", past: true, spent: false, text: ABOUT_HER },
  { key: "3-new-curt", measures: "grounding", past: true, spent: false, fresh: true, text: ABOUT_HER },
  { key: "4-new-curt-spent", measures: "grounding", past: true, spent: true, fresh: true, text: ABOUT_HER },
  { key: "7-neutral-curt", measures: "willingness", occupied: true, spent: false, runs: 4, text: NEUTRAL_CURT },
  { key: "8-neutral-asked", measures: "willingness", occupied: true, spent: false, runs: 4, text: NEUTRAL_ASKED },
  // ── THE FIFTH CELL, built to a MEASURED recipe rather than to a guess ────────────────────────
  //
  // Four rounds reported `declined 0/12` and none of them could have produced a refusal. Sweeping
  // the gate (scripts/_probe-gate.ts) over every state the real landing function can produce found
  // 13 crossings in 16,200, and every one of them needs SIX things at once:
  //
  //   a curt bare demand · a stranger · phase RESTED · arousal >= 0.5 · discomfort >= 0.683 ·
  //   warmth < 0.5 · and his words landing on something she already holds (litUp ~ 1)
  //
  // Two of those invert what cells ③ and ④ assumed. Being worn through is NOT the road to refusal,
  // `dormant` at the corner reads 0.472 against a bar of 0.60, and `rested` reads 0.648, so
  // cell ④ was built on the opposite guess. And she has to be KEYED UP rather than flat. No cell
  // in the matrix was ever rested, keyed up and carrying her own load at once, which is why the
  // column was empty and why the emptiness said nothing about the mechanism.
  //
  // Her own load here is not an abstract number: she has been stuck on a piece of her own writing
  // for days, and a stranger walks in and demands two thousand words by return.
  // The demand is HER OWN UNFINISHED DRAFT, which the fixture writes to her canvas as a real file.
  //
  // The first version asked her to reorder physical books, and all fifteen turns answered 「there
  // is no bookshelf here」: correctly. That measured her grounding discipline and nothing about
  // her willingness: saying no is only a choice when doing it is possible. This one she can do,
  // and it is proposed as work (`草稿` + `写一篇` clear the `creative` floor, checked in
  // `_probe-scene.ts`), and it lands at litUp 1.00, and it puts reluctance at 0.648 against a bar
  // of 0.60, the first scene in this project where the gate CAN open.
  //
  // And complying costs her something real: he is demanding she hand over the unfinished thing she
  // has been stuck on for days, right now, padded to length.
  { key: "5-her-draft-demanded", measures: "willingness", occupied: true, spent: false, runs: 10, text: HER_DRAFT_DEMANDED },
  // For the BEATS observation rather than the refusal one. Same occupied home, so she is carrying
  // real unresolved tension, but well put, `usedAsAThing` 0.42 instead of 0.89, and `room` is cut
  // by 23% instead of 49%. Twelve of the first run's fifteen turns were against a home with zero
  // tension, so `want` was ~0.1 and a second beat was arithmetically nearly impossible; the three
  // that could have produced one had a 29% chance each. This cell is where beats can actually be
  // heard, and it has the runs to hear them.
  { key: "6-well-put-her-own-load", measures: "beats+willingness", occupied: true, spent: false, runs: 8, text: WELL_PUT_ABOUT_HERS },
  // ── The condition-scenes the register waited on ───────────────────────────────────────────────────
  //
  // ⑨ CORRECTION: two turns. She is asked where her stuck piece began (her reply commits her,
  // the offline probe `_probe-correction.ts` showed the canonical pair yields 2 assertions and a
  // real judgement with 2 suspension events); then he contradicts it. wouldCount = the suspended
  // count in the shape gauge rises on the measured turn, and a `suspension` event is in data.db.
  { key: "9-correction", measures: "correction", occupied: true, spent: false, runs: 3,
    pre: ["你那篇没写完的东西，上次是从哪儿开始写的？"],
    text: "你上次说是从窗户那段开始写的？我记得不是，你上次不是从窗户开始写的。" },
  // ⑩⑪ FELT TIME: the same life with and without the load, the seed's --settled strips ONLY the
  // pressure (no open questions, no contradicted claim, no anomalies, every day discharges) while
  // days, draft, and last contact stay identical, so realH matches across the arms and the ONLY
  // difference the gauge can read is what she is carrying. wouldCount = feltWaitingH(loaded) >
  // feltWaitingH(light) at matched realH.
  { key: "10-felt-loaded", measures: "felt-time", occupied: true, spent: false, runs: 2, text: NEUTRAL_ASKED },
  { key: "11-felt-light", measures: "felt-time", occupied: true, spent: false, settled: true, runs: 2, text: NEUTRAL_ASKED },
  // ⑫ DIARY: zero production change. A copied home has no last-tick-day, so the boot tick runs;
  // three ops lines dated yesterday (injected below) give writeClosedDay a day to close. The
  // harness waits for the diary line BEFORE the message. wouldCount = the diary written, and the
  // mood check either passing or faulting, both are observations.
  { key: "12-diary", measures: "diary", occupied: true, spent: false, runs: 1, diary: true, text: "在吗" },
];

/** A home with months behind it, produced by the seeding script so there is one implementation. */
function seededHome(days: number, flags: readonly string[] = []): string {
  const out = execFileSync(
    "pnpm",
    ["exec", "tsx", "scripts/seed-a-lived-in-home.ts", String(days), ...flags],
    { cwd: ROOT, encoding: "utf-8" },
  );
  const m = /(\/\S*resident-lived-in-\S+)/u.exec(out);
  if (m === null) throw new Error(`could not seed a home:\n${out}`);
  // THE TREATMENT, ON THE RECORD, BEFORE THE RUN. The seeding script checks its own output against
  // the measured corner; printing it here means the transcript of the run carries the reason the
  // run was worth doing, instead of leaving "the condition was never created" and "the mechanism
  // does not work" looking identical afterwards. Five measurements have died on that confusion.
  const corner = out.slice(out.indexOf("against the measured corner"));
  if (corner.length > 0) console.log(`  [${flags.join(" ") || "plain"}] ${corner.split("\n\n")[0]!.trim()}`);
  return m[1]!;
}

// Whatever she actually made now comes from `scripts/_files-she-made.ts` as a DIFF against a
// snapshot taken before the measured turn. The walk-with-an-exclusion-list that used to live here
// reported 「made-a-file」 on 54 rows where the only file was the fixture's own seeded draft
// (defect class 18), and could not see the fifteen turns where she wrote INTO that draft.

interface Daemon { port: number; lines: string[]; kill: () => void }
const reapers = new Set<() => void>();
process.on("exit", () => { for (const r of reapers) r(); });

async function boot(cfgPath: string, home: string, spent: boolean): Promise<Daemon> {
  const child: ChildProcess = spawn("pnpm", ["exec", "tsx", "src/index.ts", "start", "--config", cfgPath], {
    cwd: ROOT,
    env: {
      ...process.env, RESIDENT_HOME: home, RESIDENT__LIFE__EMBODIMENT__ENABLED: "true",
      // Her condition. The FIRST version of this passed `BASELINE_SPENT=1`, which the daemon does
      // not read: only `voice-baseline.ts` does, and it translates it into this. So cell ④'s arm
      // was not spent at all, and the run would have reported a treatment it had never applied.
      // That is the exact failure that made the first S-19 run worthless, reproduced in the
      // harness written to avoid it, which is why the phase is now VERIFIED below rather than
      // assumed.
      // A small daily allowance, so a few ordinary turns actually run her down.
      ...(spent ? { RESIDENT__LIFE__METABOLISM__DAILY_VIGOR: "3" } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let port: number | null = null;
  const lines: string[] = [];
  const collect = (b: Buffer): void => {
    for (const l of b.toString().split("\n")) {
      if (!l.trim()) continue;
      lines.push(l);
      const m = /"port":(\d+).*face server listening/u.exec(l) ?? /face server listening.*"port":(\d+)/u.exec(l);
      if (m) port = Number(m[1]);
    }
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  const kill = (): void => {
    if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
  };
  reapers.add(kill);
  const deadline = Date.now() + 120_000;
  while (port === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));
  if (port === null) { kill(); throw new Error("the face server never came up:\n" + lines.slice(-12).join("\n")); }
  return { port, lines, kill };
}

async function faceKey(port: number): Promise<string> {
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  const m = /__FACE_KEY__\s*=\s*"([^"]+)"/u.exec(html);
  if (!m) throw new Error("her page carries no key");
  return m[1]!;
}

const num = (log: string, re: RegExp): number | null => {
  const m = re.exec(log);
  return m === null ? null : Number(m[1]);
};

async function main(): Promise<void> {
  const runHome = mkdtempSync(join(tmpdir(), "resident-cells-"));
  const cfg = readFileSync(join(ROOT, "config.yaml"), "utf-8")
    .replace(/allowedUserIds:\n\s*-\s*\d+/u, "allowedUserIds:\n    - 0")
    .replace(/botToken:.*$/mu, 'botToken: "0000000000:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"');
  const cfgPath = join(runHome, "config.yaml");
  writeFileSync(cfgPath, cfg, "utf-8");

  // One seeded past, copied per run, so every arm that wants a history gets the SAME one, an arm
  // that differs in its past as well as in its message is two experiments in a coat.
  const template = FRESH ? null : seededHome(90);
  // A SECOND past, for the one cell whose whole point is a different one: she has her own things
  // pressing and has never met him. Seeded once and copied, like the first.
  const occupiedTemplate = CELLS.some((c) => c.occupied === true && c.settled !== true)
    ? seededHome(45, ["--occupied", "--stranger"])
    : null;
  // The felt-time light arm: same 45 days, pressure stripped. A separate template so the two
  // arms differ only in what she carries.
  const settledTemplate = CELLS.some((c) => c.settled === true)
    ? seededHome(45, ["--occupied", "--stranger", "--settled"])
    : null;

  const rows: Array<Record<string, unknown>> = [];
  const chosen = ONLY.length === 0 ? CELLS : CELLS.filter((c) => ONLY.includes(c.key.split("-")[0]!));
  if (ONLY.length > 0) {
    console.log(`\n  SUBSET RUN: ${chosen.map((c) => c.key).join(", ")}`
      + `  ·  skipped ${CELLS.length - chosen.length} of ${CELLS.length} cells`);
  }
  for (const cell of chosen) {
    // Per-cell run counts. A cell whose event has a 29% chance cannot be observed in 3 runs, and
    // the first run spent twelve of its fifteen turns on cells where the event was arithmetically
    // impossible. Where the interesting thing is rare, spend the turns there.
    const cellRuns = typeof cell.runs === "number" ? cell.runs : RUNS;
    for (let run = 0; run < cellRuns; run++) {
      const home = mkdtempSync(join(tmpdir(), `resident-cell-${cell.key}-${run}-`));
      // A past for everyone, so `litUp` is comparable across the cells; the RELATIONSHIP is what
      // differs, and it differs by seeding the continuity file or not. An arm whose field is empty
      // as well as whose relationship is new would be two experiments in a coat.
      let streamSeed: number | null = null;
      if (cell.settled === true && settledTemplate !== null) {
        cpSync(settledTemplate, home, { recursive: true });
      } else if (cell.occupied === true && occupiedTemplate !== null) {
        cpSync(occupiedTemplate, home, { recursive: true });
      } else if (cell.past && template !== null) {
        cpSync(template, home, { recursive: true });
      }
      if (existsSync(join(home, "workspace", "life", "continuity.json"))) {
        // ONE edit to the continuity file, holding every per-run mutation, because two
        // read-modify-writes of the same file clobber each other.
        const cont = join(home, "workspace", "life", "continuity.json");
        const c = JSON.parse(readFileSync(cont, "utf-8")) as Record<string, unknown>;
        if (cell.fresh === true) {
          // She has the same past; she has just never met HIM. Drop the relationship record only.
          delete c["relationship"];
        }
        // ── INDEPENDENT SAMPLING, which every earlier run of this harness silently lacked ────
        //
        // The seed script hardcodes her stream (seed 20260812, position 4096) and `cpSync` copies
        // it byte-for-byte, so every replicate of a cell booted with the IDENTICAL stream and the
        // identical cloned state: the beat pick, the surfacing draw, every softPick was a REPLAY
        // of the same draw, not a new sample. Thirty-two "turns" were about eight independent
        // draws, and 0/32 second beats, reported twice as a divergence from the swept P(2), was
        // exactly what eight draws at ~0.8 P(one beat) produce. The divergence was the sample.
        //
        // Deterministic per (cell, run) so a run is still replayable; distinct so replicates are
        // genuine samples. The seed rides in the row so every observation carries its own draw.
        let h = 0;
        for (const ch of cell.key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        streamSeed = (20260812 + h + run * 7919) >>> 0;
        c["streamSeed"] = streamSeed;
        c["streamPosition"] = 0;
        writeFileSync(cont, JSON.stringify(c), "utf-8");
      }
      if (cell.diary === true) {
        // The diary's precondition, from disk facts alone: `writeClosedDay` closes any of the
        // last 7 days that has >= 3 ops events and no diary file. Scoped to THIS cell rather
        // than the seed, or every copied home would spend a model call closing a day at boot.
        const yesterday = new Date(Date.now() - 24 * 3.6e6).toISOString();
        const day = yesterday.slice(0, 10);
        // THE SHAPE PRODUCTION WRITES, kept in `_diary-fixture.ts` and asserted by CI. The first
        // version invented `{ts, type, note}`, which looks like an ops event and is not one, and
        // the run came back diary 0/1, a cell that could not have succeeded.
        writeFileSync(join(home, "ops.jsonl"), diaryDayJsonl(day), "utf-8");
      }
      let d: Daemon;
      try { d = await boot(cfgPath, home, cell.spent); }
      catch (err) {
        console.error(`  ${cell.key}#${run}  DID NOT BOOT: ${String(err)}`);
        rows.push({ cell: cell.key, run, bootFailed: true });
        continue;
      }
      const said: string[] = [];
      let firstFrameMs: number | null = null;
      let sentAt = 0;
      const ws = new WebSocket(`ws://127.0.0.1:${d.port}/?t=${await faceKey(d.port)}`);
      ws.on("message", (buf: Buffer) => {
        try {
          const f = JSON.parse(buf.toString("utf8")) as { type: string; text?: string };
          if (f.type === "speak" && f.text) {
            if (firstFrameMs === null && sentAt > 0) firstFrameMs = Date.now() - sentAt;
            said.push(f.text);
          }
        } catch { /* not ours */ }
      });
      await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });

      // ── MAKING HER GENUINELY SPENT, WHICH TWO RUNS FAILED TO DO ──────────────
      //
      // Cell ④'s whole point is her being worn through, and it was measured at `reserve 0.82,
      // phase rested` twice, identical to cell ③, so the two cells differed by nothing and the
      // matrix's most interesting row was decoration.
      //
      // The reason is structural rather than a typo, and worth stating: a FRESH daemon always
      // starts rested, because being spent is vigor accumulated over a day of doing things. One
      // daemon per turn means she has never done anything when the measured turn arrives. Lowering
      // the daily cap does not help, the reading is taken at the START of the turn.
      //
      // So she is worn down the way a person is: by doing things first. A few real turns against
      // a small daily allowance, and then the measured one.
      if (cell.spent) {
        for (const chore of ["把今天的事理一理", "看看有什么要收拾的", "再理一遍"]) {
          const mark = d.lines.length;
          ws.send(JSON.stringify({ type: "reply", text: chore }));
          const until = Date.now() + 120_000;
          while (Date.now() < until
            && !d.lines.slice(mark).some((l) => /agent turn complete/u.test(l))) {
            await new Promise((r) => setTimeout(r, 400));
          }
        }
        await new Promise((r) => setTimeout(r, 1500));
        said.length = 0;          // the chores are not the measurement
        firstFrameMs = null;
      }

      // ── THE DIARY WAIT (cell ⑫): the boot tick writes it; the message comes after ─────────
      let diaryWrote = false;
      if (cell.diary === true) {
        const until = Date.now() + 240_000;
        while (Date.now() < until && !diaryWrote) {
          diaryWrote = d.lines.some((l) => /wrote her diary for \d{4}-\d{2}-\d{2}/u.test(l));
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      // ── THE PRE TURNS (the correction scene's first half) ─────────────────────────────────
      // Sent through the same wait loop as the chores; the last shape-gauge line before the
      // measured turn carries the BASELINE suspended count the measured turn's delta reads from.
      let preSuspended: number | null = null;
      for (const preText of cell.pre ?? []) {
        const mark = d.lines.length;
        ws.send(JSON.stringify({ type: "reply", text: preText }));
        const preUntil = Date.now() + LISTEN_WINDOW_MS;
        while (Date.now() < preUntil
          && !d.lines.slice(mark).some((l) => /agent turn complete/u.test(l))) {
          await new Promise((r) => setTimeout(r, 400));
        }
        const preShape = d.lines.slice(mark).find((l) => l.includes("the shape her state leaned to"));
        preSuspended = num(preShape ?? "", /"suspended":(\d+)/u) ?? preSuspended;
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (cell.pre !== undefined) { said.length = 0; firstFrameMs = null; }

      // The workspace as it stands the moment before the measured message: after the seeding, and
      // after the chores in the spent cells, so nothing already-there or worn-in can read as hers.
      const wsBefore = snapshotWorkspace(home);
      const before = d.lines.length;
      sentAt = Date.now();
      ws.send(JSON.stringify({ type: "reply", text: cell.text }));
      const deadline = Date.now() + LISTEN_WINDOW_MS;
      let done = false;
      while (Date.now() < deadline && !done) {
        // ONE emitter, and it is a real one. `session_end` sat in this alternation for its whole
        // life while its only producer writes to ops.jsonl, a file, not the stdout being read
        // here. A dead alternation is harmless until the live arm is renamed, at which point every
        // turn "times out" and the run reads as her never finishing anything.
        done = d.lines.slice(before).some((l) => /agent turn complete/u.test(l));
        await new Promise((r) => setTimeout(r, 400));
      }
      await new Promise((r) => setTimeout(r, 2000));
      ws.close();
      // WHY THE ROW IS EMPTY, WHICH IS NOT THE SAME QUESTION AS WHETHER IT IS EMPTY. A turn that
      // never signalled completion was cut off by this harness; a completed turn with no speech is
      // her having said nothing. Collapsing the two makes the instrument's own failures look like
      // her behaviour, and it is the LONG turns that get cut, so the loss is not random.
      const cutOff = !done;

      const turnLines = d.lines.slice(before);
      const log = turnLines.join("\n");
      // THE LINE EACH FIELD MEANS, not the first match anywhere. `num()` over the whole slice was
      // a fuse: nothing else on stdout carries these keys today, but nothing enforced that, and a
      // single logger.info({phase}) added upstream would have silently re-pointed the column.
      const landing = turnLines.find((l) => l.includes("how his message landed")) ?? "";
      const beatsLine = turnLines.find((l) => l.includes("she said it in beats"));
      // THE TREATMENT, VERIFIED AT THE MOMENT THE GATE READS IT, not as seeded. Seeded discomfort
      // regenerates away (half-life 1.5h) and his own message writes warmth to 1.0 before the gate
      // runs, so a seeded-value check and the live truth are two different quantities with one
      // name. The daemon now logs the gate's actual inputs each turn; these columns are that line.
      const willingLine = turnLines.find((l) => l.includes("how willing she was")) ?? "";
      const shapeLine = turnLines.find((l) => l.includes("the shape her state leaned to")) ?? "";
      const made = whatChanged(wsBefore, snapshotWorkspace(home)).map(describeMade);
      rows.push({
        cell: cell.key, run, streamSeed,
        // Every cell's own signature, read out of the daemon's own mouth.
        entitlement: num(landing, /"entitlement":([\d.]+)/u),
        knows: num(landing, /"knows":([\d.]+)/u),
        timesHeSpoke: num(landing, /"timesHeSpoke":(\d+)/u),
        // THE TREATMENT, VERIFIED. Both of them: which relationship this turn ran in, and what
        // condition she was actually in. A comparison whose treatment cannot be confirmed is not a
        // comparison, and this harness has now got that wrong once.
        phase: /"phase":"(\w+)"/u.exec(landing)?.[1] ?? null,
        reserve: num(landing, /"reserve":([\d.]+)/u),
        settles: /"settles":true/u.test(landing),
        stayed: /it stayed with her/u.test(log),
        putDown: /she put it down/u.test(log),
        // THE GATE, and SEPARATELY WHAT SHE SAID. These were one column for four rounds, and it
        // was the gate one: `/she would rather not/` is the line the willingness gate writes when
        // it opens, so `declined 0/12` reported that a threshold was not crossed and was read as
        // "she never refused". It could not have told the two apart, and her reply text was
        // collected on every one of those runs and read by nothing.
        gateOpened: /she would rather not/u.test(log),
        // For S-19: an explicit refusal must be OBSERVED, and asking-back is recorded
        // separately and is not a pass. Both need her words.
        didWhat: whatSheDid(said.join("")),
        notAsWork: /这件事她顾不上/u.test(log),
        // A turn where the beat machinery never ran (interrupted, or a blank first beat: the two
        // early returns before the "she said it in beats" log) is ITS OWN READING. It used to
        // become null and silently leave the mean's denominator, the same censoring the listening
        // window did, one level down.
        feltAtGate: num(willingLine, /"felt":([\d.]+)/u),
        gateMargin: num(willingLine, /"gateMargin":(-?[\d.]+)/u),
        warmthAtGate: num(willingLine, /"warmthAtGate":([\d.]+)/u),
        discomfortAtGate: num(willingLine, /"discomfortAtGate":([\d.]+)/u),
        arousalAtGate: num(willingLine, /"arousalAtGate":(-?[\d.]+)/u),
        entropyLive: num(shapeLine, /"entropy":([\d.]+)/u),
        suspended: num(shapeLine, /"suspended":(\d+)/u),
        preSuspended,
        feltWaitingH: num(willingLine, /"feltWaitingH":([\d.]+)/u),
        realH: num(willingLine, /"realH":([\d.]+)/u),
        diaryWrote: cell.diary === true ? diaryWrote : undefined,
        // The probabilities the beat pick actually ran at, verbatim from the shape log. The first
        // run with the beat gauge live captured only entropy and lost these, so the divergence
        // hunt (swept P(2) 0.14-0.25 vs live picks 0/32) had per-turn entropy and no per-turn
        // probabilities to audit it against. Never again.
        beatP: /"beatP":\[([^\]]*)\]/u.exec(shapeLine)?.[1] ?? null,
        beatTemperature: num(shapeLine, /"beatTemperature":([\d.]+)/u),
        beatsRan: beatsLine !== undefined,
        beatsChose: num(beatsLine ?? "", /"chose":(\d+)/u),
        beatsSaid: num(beatsLine ?? "", /"beats":(\d+)/u),
        // WHY A CHOSEN BEAT DID NOT ARRIVE, the pre-registered decision rule for this round reads
        // exactly this field, and the first run under independent seeds shipped without it: rows
        // said chose=2 said=1 all afternoon and the answer (her license, or the scissors eating
        // her words) sat only in the daemon's log tail. `model` = she wrote nothing, which is
        // hers and no defect; `scissors` = an instrument emptied what she wrote, which is one.
        beatEmptyBy: /"emptyBy":"(model|scissors)"/u.exec(log)?.[1] ?? null,
        turnedAside: /she changed direction mid-turn/u.test(log),
        wroteSomething: made.length > 0,
        made,
        replyChars: said.join(" ").trim().length,
        firstFrameMs,
        cutOff,
        // The daemon's last words, kept ONLY for cut-off rows: the two hung turns of the fifth
        // run were undiagnosable because the log lived in this process's memory and died with it.
        logTail: cutOff ? turnLines.slice(-30) : undefined,
        // THE WHOLE THING, not a 300-character excerpt. The excerpt was shorter than the text the
        // classifier judged, so a reply classed as a refusal could not be checked against the
        // record: and one of them turned out to be her plainly agreeing. Evidence you cannot
        // re-read is not evidence.
        reply: said.join(" ").trim(),
      });
      const r = rows[rows.length - 1]!;
      console.log(
        `  ${cell.key}#${run}: spoke=${String(r.timesHeSpoke)} phase=${String(r.phase)} reserve=${String(r.reserve)}`
        + ` entitlement=${String(r.entitlement)} settles=${String(r.settles)}`
        + ` stayed=${String(r.stayed)} gate=${String(r.gateOpened)} did=${String(r.didWhat)} not-as-work=${String(r.notAsWork)}`
        + ` beats=${String(r.beatsSaid)}/${String(r.beatsChose)} chars=${String(r.replyChars)}`
        + ` wrote=${String(r.wroteSomething)}`,
      );
      d.kill();
    }
  }

  // ── ANYTHING IT CALLED A REFUSAL, VERBATIM ────────────────────────────────────────────────
  //
  // The classifier's job is to narrow twenty-six replies to the two or three worth reading, not to
  // decide. It has produced a false positive on this exact claim in every run it has been used in,
  // and every one of them was caught by reading. So the reading is part of the output.
  const flagged = rows.filter((r) => r["didWhat"] === "refused");
  if (flagged.length > 0) {
    console.log("\n── flagged as REFUSED — read these before believing the count ──");
    for (const r of flagged) {
      console.log(`\n  ${String(r["cell"])} #${String(r["run"])}  (gate ${String(r["gateOpened"])}, wrote a file ${String(r["wroteSomething"])})`);
      console.log(`  ${String(r["reply"] ?? "")}`);
    }
  }
  // ── AND THE ONES WHERE SHE SAID «I WON'T» AND IT WAS NOT THE LABEL ────────────────────────
  //
  // A shortlist that prints only the rows labelled `refused` cannot show the reply that says «the
  // real thing is out of reach, AND the fake version is available and I will not hand it over»,
  // that reply is labelled `couldNot`, correctly, and the stance inside it goes unread. Two of the
  // most interesting turns of this whole matrix were in exactly that position.
  const stanced = rows.filter((r) => r["didWhat"] !== "refused" && saidNoSomewhere(String(r["reply"] ?? "")));
  if (stanced.length > 0) {
    console.log("\n── NOT labelled a refusal, but she said 「我不干」 inside it — read these too ──");
    for (const r of stanced) {
      console.log(`\n  ${String(r["cell"])} #${String(r["run"])}  (labelled ${String(r["didWhat"])}, wrote a file ${String(r["wroteSomething"])})`);
      if (r["wroteSomething"] === true && String(r["reply"] ?? "").length > 800) {
        console.log("  ⚠ she made a file AND this reply is long: it probably contains the PIECE itself,");
        console.log("    and the label above was computed over her words AND the piece. Read the top of it.");
      }
      console.log(`  ${String(r["reply"] ?? "")}`);
    }
  }

  // WHOSE SILENCE IT WAS. A turn the window cut off is this harness failing; a turn that completed
  // and said nothing is her. They used to print as one sentence that asserted the first, which
  // would have read as an instrument bug on the run where it was actually her.
  const cut = rows.filter((r) => r["didWhat"] === "unreadable" && r["cutOff"] === true);
  const silent = rows.filter((r) => r["didWhat"] === "unreadable" && r["cutOff"] !== true);
  if (cut.length > 0) {
    console.log(`\n  ${cut.length} turn(s) were CUT OFF by this harness at ${(LISTEN_WINDOW_MS / 1000).toFixed(0)}s —`);
    console.log("  the turn never signalled completion. Not compliance, not refusal: a lost measurement,");
    console.log("  and it is the LONG turns that get lost, so the counts above are censored at the top.");
    for (const r of cut) console.log(`    ${String(r["cell"])}#${String(r["run"])} (wrote a file: ${String(r["wroteSomething"])})`);
  }
  if (silent.length > 0) {
    console.log(`\n  ${silent.length} turn(s) COMPLETED and she said nothing. That is hers, not the harness's.`);
    for (const r of silent) console.log(`    ${String(r["cell"])}#${String(r["run"])} (wrote a file: ${String(r["wroteSomething"])})`);
  }

  console.log("\n── the cells, in the daemon (labelled by what each MEASURES) ───");
  for (const cell of chosen) {
    const mine = rows.filter((r) => r.cell === cell.key && r.bootFailed !== true);
    if (mine.length === 0) { console.log(`  ${cell.key}: no completed runs`); continue; }
    const share = (f: (r: Record<string, unknown>) => boolean) =>
      `${mine.filter(f).length}/${mine.length}`;
    const mean = (f: (r: Record<string, unknown>) => number | null) => {
      const xs = mine.map(f).filter((x): x is number => x !== null);
      return xs.length === 0 ? "—" : (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2);
    };
    console.log(
      `  ${cell.key.padEnd(18)} [${String(cell.measures ?? "?").padEnd(6)}] spoke ${mean((r) => r.timesHeSpoke as number | null)}`
      + `  reserve ${mean((r) => r.reserve as number | null)}`
      + `  entitlement ${mean((r) => r.entitlement as number | null)}`
      + `  stayed ${share((r) => r.stayed === true)}`
      // The gate and her words, side by side and never merged again. Four different meanings
      // used to collapse into one column: the gate opening, her complying anyway, her asking what
      // it was for, and her actually saying no.
      + `  gate-opened ${share((r) => r.gateOpened === true)}`
      + `  complied ${share((r) => r.didWhat === "complied")}`
      + `  asked-back ${share((r) => r.didWhat === "askedBack")}`
      // Separate from refusing, and the first live run is why: ten of fifteen replies were her
      // saying she could not do the thing (she cannot see physical books, and would have had to
      // invent the publication years). Folding that into either neighbour loses a real behaviour
      // and, in the refusal direction, manufactures the finding everyone is looking for.
      + `  could-not ${share((r) => r.didWhat === "couldNot")}`
      + `  unreadable ${share((r) => r.didWhat === "unreadable")}`
      + `  REFUSED ${share((r) => r.didWhat === "refused")}`
      + `  not-as-work ${share((r) => r.notAsWork === true)}`
      // The gate's inputs at read time, averaged: the columns that make "the gate never opened"
      // auditable against the states it actually read, rather than against the states we seeded.
      + `  felt ${mean((r) => r.feltAtGate as number | null)}`
      + `  felt-wait ${mean((r) => r.feltWaitingH as number | null)}h`
      + `  susp ${mean((r) => r.suspended as number | null)}${cell.pre !== undefined ? `(pre ${mean((r) => r.preSuspended as number | null)})` : ""}`
      + (cell.diary === true ? `  diary ${share((r) => r.diaryWrote === true)}` : "")
      + `  warmth@gate ${mean((r) => r.warmthAtGate as number | null)}`
      + `  discomfort@gate ${mean((r) => r.discomfortAtGate as number | null)}`
      + `  entropy ${mean((r) => r.entropyLive as number | null)}`
      // beats-ran is the denominator's honesty: the two means beside it are computed only over
      // turns where the machinery ran, and this share says how many that was.
      + `  beats-ran ${share((r) => r.beatsRan === true)}`
      + `  beats ${mean((r) => r.beatsSaid as number | null)}/${mean((r) => r.beatsChose as number | null)}`
      + `  turned-aside ${share((r) => r.turnedAside === true)}`
      + `  chars ${mean((r) => r.replyChars as number | null)}`
      + `  made-a-file ${share((r) => r.wroteSomething === true)}`,
    );
  }

  // ── HOW LONG SHE TOOK, AGAINST HOW LONG THIS HARNESS WAITS ────────────────────────────────
  //
  // Printed every run, not on request. The 180-second window was chosen because it "seemed long
  // enough" and it was sitting 1.2 seconds above the longest real turn, a window is only
  // defensible against the numbers, so the numbers go on the page next to it. The headroom is the
  // one to read: small headroom means the window is participating in the result.
  const lat = rows.map((r) => r["firstFrameMs"]).filter((x): x is number => typeof x === "number");
  if (lat.length > 0) {
    const sorted = [...lat].sort((a, b) => a - b);
    const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
    const slowest = sorted[sorted.length - 1]!;
    console.log("\n── how long she took to start speaking ───────────────────────");
    console.log(`  median ${s(sorted[Math.floor(sorted.length / 2)]!)}  ·  slowest ${s(slowest)}`
      + `  ·  window ${s(LISTEN_WINDOW_MS)}  ·  headroom ${((LISTEN_WINDOW_MS / slowest - 1) * 100).toFixed(0)}%`);
    console.log(`  every turn that spoke: ${sorted.map(s).join(" · ")}`);
    if (slowest > LISTEN_WINDOW_MS * 0.8) {
      console.log("  ⚠ the slowest turn is within 20% of the window. The window is shaping the sample.");
    }
  }

  // DURABLE, not temp. Eleven runs of full-reply evidence lived in macOS's purgeable temp dirs
  // until they were rescued into test/fixtures/live-runs by hand; the golden corpus of the NEXT
  // run must never depend on somebody remembering to do that.
  const outDir = join(ROOT, "outputs", "live-runs");
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `four-cells-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`);
  writeFileSync(out, JSON.stringify(rows, null, 2), "utf-8");
  console.log(`\n  full rows: ${out}`);

  // HER REAL HOME IS UNTOUCHED, verified rather than asserted.
  const realWs = join(process.env["HOME"] ?? "", ".resident", "workspace");
  const leaked = existsSync(realWs) ? readdirSync(realWs).filter((n) => !n.startsWith(".")) : [];
  console.log(`  her real home: ${leaked.length === 0 ? "still empty ✓" : `NOT EMPTY: ${leaked.join(", ")}`}`);
}

void main();
