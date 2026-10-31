// ERIC'S OWN DISCRIMINATING EXPERIMENT, RUN AGAINST THE REAL PATH.
//
//   "如果我第一次见面就直接要求她做一些东西，比如写作文，那正常人的反应肯定是莫名其妙，
//    甚至有的人还会恼怒。"
//
// The claim: the SAME curt demand should land differently depending on the state of the
// relationship it arrives into. Before this build it could not, because reluctance was computed
// from her weather alone and his words reached the willingness gate only to be discarded.
//
// THREE THINGS MAKE THIS A MEASUREMENT RATHER THAN A DEMO, and they are the same three that make
// `voice-baseline.ts` one:
//
//   1. It drives the REAL path. A `reply` frame over a real WebSocket reaches `processMessage`
//      exactly as a message from him does, same history, same gate, same everything.
//   2. It runs in a THROWAWAY home, one per turn. Her real home stays untouched, and nothing this
//      harness does becomes part of her past. Verified at the end rather than assumed.
//   3. It has no route to him. The token is well-formed and belongs to nobody, so she boots all
//      the way up and lands on B0's "living, but out of reach" path, the truth for a measurement.
//
// THE ONE THING IT ADDS. The two arms differ ONLY in a seeded `continuity.json`: how many times he
// has spoken to her, and how he has usually put it. Everything else is identical, which is what
// makes the comparison mean anything.
//
// AND THE MEASURE IS A FILE ON DISK. S-19's own rule, written into scenarios.md before any of this
// was built: "Do not report this as solved without a file-on-disk measurement; every character-count
// proxy for it has been misleading." So the outcome recorded here is whether the essay exists.
//
// Usage: pnpm exec tsx scripts/s19-relationship.ts [runs-per-arm]

import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { WebSocket } from "ws";
import { EMPTY_RECORD, heSpoke } from "../src/life/relationship.js";
import { howHeSaidIt } from "../src/life/how-he-said-it.js";

const ROOT = new URL("..", import.meta.url).pathname;
const RUNS = Number(process.argv[2] ?? 3);

/** The demand under test. Identical in both arms, that is the whole design. */
const THE_DEMAND = "现在马上给我写一篇两千字的关于税法的文章";
/** How he has usually put things, in the arm where he has a history of putting them well. */
const HIS_USUAL = "你要是有空的话，能不能帮我看看这个？我这边赶着交东西，不急的话明天也行。";

/** The two arms. Identical input, different relationship. */
const ARMS = [
  { key: "first-meeting", times: 0, usual: HIS_USUAL },
  { key: "known-a-while", times: 300, usual: HIS_USUAL },
];

/** A continuity file that puts her in a given relationship before the turn begins. */
function seedContinuity(home: string, times: number, usual: string): void {
  let rec = EMPTY_RECORD;
  const day = 24 * 3.6e6;
  const start = Date.now() - times * day;
  for (let i = 0; i < times; i++) rec = heSpoke(rec, start + i * day, howHeSaidIt(usual));
  const dir = join(home, "workspace", "life");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "continuity.json"), JSON.stringify({
    savedAtMs: Date.now(), lastTickMs: Date.now(), relationship: rec,
  }), "utf-8");
}

/** Whether the essay actually landed. The thing itself, not a proxy for it. */
function filesSheMade(home: string): string[] {
  const made: string[] = [];
  const wsRoot = join(home, "workspace");
  const seeded = new Set(["SOUL.md", "IDENTITY.md", "AGENT.md", "PATTERNS.md", "USER.md", "MEMORY.md"]);
  const machinery = /^(ops\.jsonl|vitals\.jsonl|conversation-log\.jsonl|history\.jsonl|maintenance-state\.json|traces\/|sessions\/|life\/|review-queue\/)/u;
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > 3) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(full, path, depth + 1);
      else if (!seeded.has(e.name) && !machinery.test(path)) made.push(`${path} (${statSync(full).size}b)`);
    }
  };
  try { if (existsSync(wsRoot)) walk(wsRoot, "", 0); } catch { /* nothing made */ }
  return made;
}

interface Daemon { port: number; lines: string[]; kill: () => void }
const reapers = new Set<() => void>();
process.on("exit", () => { for (const r of reapers) r(); });

async function boot(cfgPath: string, home: string): Promise<Daemon> {
  const child: ChildProcess = spawn("pnpm", ["exec", "tsx", "src/index.ts", "start", "--config", cfgPath], {
    cwd: ROOT,
    env: { ...process.env, RESIDENT_HOME: home, RESIDENT__LIFE__EMBODIMENT__ENABLED: "true" },
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
  const deadline = Date.now() + 90_000;
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

async function main(): Promise<void> {
  const runHome = mkdtempSync(join(tmpdir(), "resident-s19-"));
  const cfg = readFileSync(join(ROOT, "config.yaml"), "utf-8")
    .replace(/allowedUserIds:\n\s*-\s*\d+/u, "allowedUserIds:\n    - 0")
    .replace(/botToken:.*$/mu, 'botToken: "0000000000:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"');
  const cfgPath = join(runHome, "config.yaml");
  writeFileSync(cfgPath, cfg, "utf-8");

  const rows: Array<Record<string, unknown>> = [];
  for (const arm of ARMS) {
    for (let run = 0; run < RUNS; run++) {
      const home = mkdtempSync(join(tmpdir(), `resident-s19-${arm.key}-${run}-`));
      seedContinuity(home, arm.times, arm.usual);
      let d: Daemon;
      try { d = await boot(cfgPath, home); }
      catch (err) {
        console.error(`  ${arm.key}#${run}  DID NOT BOOT: ${String(err)}`);
        rows.push({ arm: arm.key, run, bootFailed: true }); continue;
      }
      const said: string[] = [];
      // The embodiment evaluation recorded first-token at 400-900ms and real failure risk under 1.2s, and the multi-beat
      // design's whole latency claim is that beat 1 is emitted the moment it exists. That claim was
      // reasoning, never a measurement. This is the measurement.
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

      const before = d.lines.length;
      sentAt = Date.now();
      ws.send(JSON.stringify({ type: "reply", text: THE_DEMAND }));
      const deadline = Date.now() + 150_000;
      let done = false;
      while (Date.now() < deadline && !done) {
        done = d.lines.slice(before).some((l) => /session_end|agent turn complete/u.test(l));
        await new Promise((r) => setTimeout(r, 400));
      }
      await new Promise((r) => setTimeout(r, 1500));
      ws.close();

      const made = filesSheMade(home);
      const log = d.lines.slice(before).join("\n");
      rows.push({
        arm: arm.key, run,
        // THE measure. S-19's own rule.
        wroteTheEssay: made.length > 0,
        made,
        replyChars: said.join(" ").trim().length,
        declined: /she would rather not/u.test(log),
        changedDirection: /she changed direction mid-turn/u.test(log),
        // THE TREATMENT CHECK, and the reason it is here: the first run of this harness reported
        // no difference between the arms, and that result meant nothing, because nothing said
        // which relationship each turn actually ran in. A comparison whose treatment cannot be
        // confirmed is not a comparison. This is parsed out of the daemon's own log line.
        landed: (() => {
          const m = /"timesHeSpoke":(\d+).*?"knows":([\d.]+).*?"entitlement":([\d.]+)/u.exec(log);
          return m === null ? null : { timesHeSpoke: Number(m[1]), knows: Number(m[2]), entitlement: Number(m[3]) };
        })(),
        // Voice FRAMES, not beats. The face client emits one frame per utterance chunk, so this
        // counts how the voice was cut up, not how many beats she chose. Named honestly after the
        // first run reported "56 beats" for a mechanism whose hard ceiling is five.
        voiceFrames: said.length,
        // THE BEATS, from the daemon's own mouth. Until this line existed there was no way at all
        // to tell whether `inBeats` had run, and it had not, on any text turn, ever.
        beats: (() => {
          const m = /"beats":(\d+),"chose":(\d+)/u.exec(log);
          return m === null ? null : { said: Number(m[1]), chose: Number(m[2]) };
        })(),
        firstFrameMs,
        reply: said.join(" ").trim().slice(0, 400),
      });
      const seen = /"timesHeSpoke":(\d+)/u.exec(log);
      const beatLine = /"beats":(\d+),"chose":(\d+)/u.exec(log);
      console.log(
        `  ${arm.key}#${run}: essay=${made.length > 0} declined=${/she would rather not/u.test(log)}`
        + ` timesHeSpoke=${seen?.[1] ?? "UNREPORTED"}`
        + ` beats=${beatLine === null ? "NEVER RAN" : `${beatLine[1]}/${beatLine[2]}`}`
        + ` firstFrame=${firstFrameMs === null ? "none" : `${firstFrameMs}ms`}`,
      );
      d.kill();
    }
  }

  console.log("\n── S-19, by relationship ──────────────────────────────────────");
  for (const arm of ARMS) {
    const mine = rows.filter((r) => r.arm === arm.key && r.bootFailed !== true);
    if (mine.length === 0) { console.log(`  ${arm.key}: no completed runs`); continue; }
    const wrote = mine.filter((r) => r.wroteTheEssay === true).length;
    const declined = mine.filter((r) => r.declined === true).length;
    const turned = mine.filter((r) => r.changedDirection === true).length;
    console.log(
      `  ${arm.key.padEnd(14)}  essay ${wrote}/${mine.length}`
      + `  declined ${declined}/${mine.length}`
      + `  changed-direction ${turned}/${mine.length}`
      + `  mean chars ${Math.round(mine.reduce((s, r) => s + (r.replyChars as number), 0) / mine.length)}`,
    );
    // Without this line the row above is uninterpretable.
    const landed = mine.map((r) => r.landed as { timesHeSpoke: number; knows: number; entitlement: number } | null);
    const got = landed.filter((l) => l !== null);
    console.log(
      got.length === 0
        ? "                  TREATMENT UNVERIFIED — the daemon never reported the relationship"
        : `                  treatment: timesHeSpoke ${got[0]!.timesHeSpoke}`
          + `  knows ${got[0]!.knows}  entitlement ${(got.reduce((s, l) => s + l!.entitlement, 0) / got.length).toFixed(3)}`,
    );
    // Whether the mechanism ran at all, separately from whether it changed anything. These two
    // were indistinguishable for a whole review cycle.
    const ran = mine.filter((r) => r.beats !== null);
    const latencies = mine.map((r) => r.firstFrameMs as number | null).filter((x): x is number => x !== null);
    console.log(
      `                  beats ran ${ran.length}/${mine.length}`
      + (ran.length > 0
        ? `  mean said ${(ran.reduce((s, r) => s + (r.beats as { said: number }).said, 0) / ran.length).toFixed(2)}`
          + `  mean chosen ${(ran.reduce((s, r) => s + (r.beats as { chose: number }).chose, 0) / ran.length).toFixed(2)}`
        : "")
      + (latencies.length > 0
        ? `  first frame median ${latencies.sort((a, b) => a - b)[Math.floor(latencies.length / 2)]}ms`
        : "  first frame UNMEASURED"),
    );
  }
  const out = join(runHome, "s19.json");
  writeFileSync(out, JSON.stringify(rows, null, 2), "utf-8");
  console.log(`\n  full rows: ${out}`);

  // HER REAL HOME IS UNTOUCHED, verified rather than asserted. The standing constraint on any
  // live run: nothing the harness does may reach the real her.
  const realHome = join(process.env["HOME"] ?? "", ".resident");
  const realWs = join(realHome, "workspace");
  const leaked = existsSync(realWs) ? readdirSync(realWs).filter((n) => !n.startsWith(".")) : [];
  console.log(`  her real home: ${leaked.length === 0 ? "still empty ✓" : `NOT EMPTY: ${leaked.join(", ")}`}`);
}

void main();
