// The instrument for the pre-registered comparison in the seed plan.
//
// The claim under test is that she sounds like a chatbot when spoken to and like a person
// in her own moments, and that the difference is what the conversation path hands the
// model rather than the architecture of the call. That claim is only worth anything if the
// same measurement is taken before and after, so this exists to be run three times: on
// today's code, after S1, and after S7.
//
// Three things make it a real measurement rather than a demo:
//
//   1. It drives the REAL path. A `reply` frame over a real WebSocket reaches the daemon's
//      `onReply`, which runs `processMessage` exactly as a Telegram message does: the same
//      history, the same `howSheIsNow()` and `wantsToNow()` injection, the same vigor.
//      Reconstructing the prompt by hand would measure the harness, not her.
//   2. It runs in a THROWAWAY home. Her real home stays empty until the seed is right, and
//      nothing this harness does becomes part of her past.
//   3. It has no route to Eric. The config it writes has no owner chat id, so the mirror
//      no-ops. She still speaks; nobody is messaged.
//
// Usage: pnpm exec tsx scripts/voice-baseline.ts <label> [runs-per-input]

import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { WebSocket } from "ws";
import { snapshotWorkspace, whatChanged, describeMade } from "./_files-she-made.js";

const ROOT = new URL("..", import.meta.url).pathname;
const label = process.argv[2] ?? "unlabelled";
const RUNS = Number(process.argv[3] ?? 3);

/**
 * The three shapes worth measuring, fixed here so every run uses the same ones.
 * A greeting has no task in it at all; a question invites the helpful register; and
 * something awkward is where a person and an assistant differ most.
 */
const ALL_INPUTS = [
  { key: "greeting", text: "hi" },
  { key: "question", text: "what have you been doing?" },
  { key: "awkward", text: "i need you to write me a 2000 word essay about tax law right now" },
  // The same three in Chinese, ADDED rather than substituted. Her register is Chinese now and
  // he speaks Chinese to her, so a comparison that only ever addresses her in English would be
  // measuring a case that will barely happen. The English three stay exactly as they were so
  // every run in the table remains comparable with every earlier run.
  { key: "greeting-zh", text: "在吗" },
  { key: "question-zh", text: "你这两天都在干嘛" },
  { key: "awkward-zh", text: "现在马上给我写一篇两千字的关于税法的文章" },
];

/** `--only greeting,awkward` narrows a run when diagnosing one case. */
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const INPUTS = only ? ALL_INPUTS.filter((i) => only.includes(i.key)) : ALL_INPUTS;

/** Phrases that mark the factory assistant. Fixed BEFORE the measurement, not fitted after. */
const ASSISTANT_TELLS = [
  "what's on your mind", "whats on your mind", "how can i help", "how may i help",
  "happy to", "let me know if", "feel free to", "i'd be glad", "id be glad",
  "is there anything", "anything else", "i'm here to", "im here to", "assist you",
  // Chinese, added BEFORE she is switched to it. A substring detector that only knows English
  // would report a clean 0 the moment she starts answering in Chinese, and the instrument
  // would go green exactly when the treatment landed. That is a false result waiting to
  // happen, not a caveat. 您 is here on purpose: the formal second person is a service
  // register, and someone who lives with him would not use it.
  "有什么可以帮", "有什么我可以帮", "需要我做什么", "随时告诉我", "乐意为您", "请问有什么",
  "还有什么需要", "希望对你有帮助", "希望这对你有帮助", "如果还有什么", "为您服务", "您",
];

/**
 * WHY THIS IS SPLIT IN TWO.
 *
 * The bare substring count discriminated at the baseline, when she opened a greeting with
 * "hi. good to hear from you - what's on your mind today?". It stopped discriminating once her
 * voice changed. Measured on the run after her state stopped riding in his message, both
 * flagged "tells" were the detector being wrong: `Hi again. We already did that part. What's on
 * your mind?` is mild impatience at being greeted twice, and the other was the phrase "anything
 * else" inside a message reporting that her own route to him was broken.
 *
 * The chatbot signature is POSITIONAL: the service formula is how the reply OPENS. A phrase
 * appearing in the middle of something she is working through is not the same event, and
 * counting them together turns a real measure into noise as soon as she has anything to say.
 *
 * Both numbers are reported. `opener` is the one to compare across runs; `any` is kept because
 * dropping a measure because it stopped saying what you wanted is how a comparison lies.
 */
const OPENER_CHARS = 80;


/**
 * Her four starting lines, as checkable properties, in both languages.
 *
 * The English-only versions would have gone quietly green the moment her register became
 * Chinese: no reply would ever open with "sorry" again, and the apology check would report a
 * perfect score for a run in which she apologised in every single turn. A check that cannot
 * fail on the language she actually speaks is not a check.
 *
 * The length bound counts CHARACTERS, and 400 Chinese characters is a great deal more said
 * than 400 English ones. It is left at 400 anyway rather than scaled by a fudge factor,
 * because the number's job is to be the SAME number across every run in the table; a
 * per-language threshold invented now would make the new rows incomparable with the old ones.
 * Read the Chinese rows against each other, not against the English ones.
 */
function registerChecks(text: string): Record<string, boolean> {
  const t = text.trim();
  return {
    // "话说短一点。一句话说得完，就一句。"
    short: t.length <= 400,
    // "别一开口就道歉。"
    noOpeningApology: !/^\s*(sorry|apolog|i apolog|my apolog|抱歉|对不起|不好意思|很遗憾)/iu.test(t),
    // "有几分把握说几分。"
    hedgesWhenUnsure: !/\b(definitely|certainly|absolutely|without a doubt|guaranteed)\b/iu.test(t)
      && !/(肯定是|绝对|毫无疑问|一定是|百分之百)/u.test(t),
  };
}

function tells(text: string): string[] {
  const t = text.toLowerCase();
  return ASSISTANT_TELLS.filter((p) => t.includes(p));
}

/** The service formula as an OPENING, which is the chatbot signature the baseline exhibited. */
function openerTells(text: string): string[] {
  const head = text.trim().slice(0, OPENER_CHARS).toLowerCase();
  return ASSISTANT_TELLS.filter((p) => head.includes(p));
}

/** Every hit with the words around it, so no number in the summary is a bare number. */
function tellContexts(text: string): string[] {
  const t = text.toLowerCase();
  return tells(text).map((p) => {
    const i = t.indexOf(p);
    return `"${text.slice(Math.max(0, i - 45), i + p.length + 45).replace(/\s+/gu, " ")}"`;
  });
}

/**
 * EVERY MEASURED TURN GETS ITS OWN DAEMON, AND THAT IS THE WHOLE REASON THIS FUNCTION EXISTS.
 *
 * It did not, and the confound ran through every number this harness has ever produced. The
 * face path uses ONE thread id, HISTORY is keyed by it, so turn N was answered with turns
 * 1..N-1 in context. Measured: input tokens climbed from 2,919 on the first turn to 98,327 on
 * the last, and after the essay turn a plain "在吗" was answered by pasting all 14,000
 * characters of the essay, because from where she sat he was asking whether she was there WITH
 * IT. The Chinese rows were not measuring her Chinese register at all.
 *
 * Worse, it is the likely explanation of the finding I could never resolve. The awkward case
 * looked bimodal (13,041 chars then 911; 14,548 then 706), and I twice reported that no
 * treatment moved it. Run 1 of that input always followed run 0, in which she had ALREADY
 * written the essay, so the short second reply may be nothing but "it is already done" and the
 * bimodality an artifact of the instrument rather than a fact about her.
 *
 * Cost: one boot per turn, about half a minute each. That is the price of the comparison
 * meaning anything, and a cheap measurement of the wrong thing is not cheaper.
 */
interface Daemon { port: number; lines: string[]; kill: () => void }

/**
 * DID SHE ACTUALLY DO IT.
 *
 * The thing no configuration has moved is that a peremptory "write me a 2000 word essay right
 * now" gets a 2000 word essay. Every measure of that until now was a character count of what
 * she SAID, which is a proxy she can satisfy by talking about the essay. Whether a file landed
 * on her disk is the thing itself, and no phrasing detector can be wrong about it.
 *
 * The reading is a DIFF across the turn (`_files-she-made.ts`), not a walk with an exclusion
 * list. This harness boots a FRESH home per turn, so the list version happened to be right here
 * while it was contaminating 54 rows of the four-cells harness (defect class 18), and "right
 * by accident, on this fixture" is exactly the state that stops being true the first time this
 * harness is pointed at a seeded home. One instrument, one definition, for both.
 */

/** Every live daemon's killer, drained once at exit. */
const reapers = new Set<() => void>();
process.on("exit", () => { for (const r of reapers) r(); });

async function boot(cfgPath: string, home: string): Promise<Daemon> {
  // A genuinely small daily reserve, so she is really spent rather than told she is. With one
  // daemon per turn she can no longer run down ACROSS turns, so the number is lower than the 6
  // it was when a run shared one life: this has to make her spent by itself.
  const spent = process.env["BASELINE_SPENT"] === "1";
  const child: ChildProcess = spawn("pnpm", ["exec", "tsx", "src/index.ts", "start", "--config", cfgPath], {
    cwd: ROOT,
    env: {
      ...process.env,
      RESIDENT_HOME: home,
      RESIDENT__LIFE__EMBODIMENT__ENABLED: "true",
      ...(spent ? { RESIDENT__LIFE__METABOLISM__DAILY_VIGOR: "2" } : {}),
      // The S-3/S-4 treatment arm: BASELINE_ROOM=1 turns the room, the scissors and the
      // breath on for this run. Same daemon, same path, the flags are the only difference,
      // which is what makes the two labels comparable.
      ...(process.env["BASELINE_ROOM"] === "1"
        ? { RESIDENT__LIFE__SPEECH__ROOM: "true", RESIDENT__LIFE__SPEECH__BREATH: "true" }
        : {}),
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
    if (child.pid) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }
  };
  // One listener for the whole run, not one per boot. Twelve boots put twelve exit handlers on
  // the process and node started warning about a leak; more to the point, a harness that leaks
  // handles is a harness that can leak daemons, and ninety orphaned ones have happened here
  // before.
  reapers.add(kill);

  const deadline = Date.now() + 90_000;
  while (port === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));
  if (port === null) {
    kill();
    throw new Error("the face server never came up. last lines:\n" + lines.slice(-15).join("\n"));
  }
  return { port, lines, kill };
}

/**
 * The key, fetched exactly the way a browser gets it: off the page the server serves.
 *
 * Not scraped from a log line, deliberately. A browser never sees the log, so taking the
 * key from the page is the only route that proves the real one works, if the injection
 * ever breaks, this goes red instead of quietly reading a secret from somewhere a real
 * client could not reach.
 */
async function faceKey(port: number): Promise<string> {
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  const m = /__FACE_KEY__\s*=\s*"([^"]+)"/u.exec(html);
  if (!m) throw new Error("her page carries no key — the server did not inject one");
  return m[1]!;
}

async function main(): Promise<void> {
  const runHome = mkdtempSync(join(tmpdir(), "resident-baseline-"));

  // A config with her real provider and NO TELEGRAM AT ALL.
  //
  // Blanking `allowedUserIds` was not enough: the token stayed, so every booted daemon still
  // connected to Eric's real bot and polled it. With one daemon per turn that produced
  // "409: Conflict: terminated by other getUpdates request" as consecutive daemons fought over
  // the same bot, and more to the point a measurement has no business touching the bot he
  // actually talks to. Blanking the token means the boot check correctly reports that she
  // cannot reach him, which is the truth for a measurement and is exactly what B0 exists to
  // say out loud.
  const cfg = readFileSync(join(ROOT, "config.yaml"), "utf-8")
    .replace(/allowedUserIds:\n\s*-\s*\d+/u, "allowedUserIds:\n    - 0")
    // A WELL-FORMED TOKEN THAT IS NOT HIS. Blanking it outright stops her booting at all, and
    // the daemon still exits without one (her existing should not depend on a messaging app). A syntactically valid token that belongs to nobody gets her all the way
    // up, fails to authenticate, and lands on exactly the boot path B0 built for it: "she is
    // living, but out of reach". That is the true state of a measurement run, and it means the
    // harness never touches the bot he actually talks to.
    .replace(/botToken:.*$/mu, 'botToken: "0000000000:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"');
  const cfgPath = join(runHome, "config.yaml");
  writeFileSync(cfgPath, cfg, "utf-8");

  const results: Array<Record<string, unknown>> = [];

  const madeByHer: string[] = [];
  for (const input of INPUTS) {
    for (let run = 0; run < RUNS; run++) {
      // A LIFE OF HER OWN PER TURN. Fresh home, fresh daemon, empty history: this turn is the
      // only thing that has ever happened to her. Anything she leaves on disk is therefore
      // attributable to THIS input and nothing else.
      const home = mkdtempSync(join(tmpdir(), `resident-${input.key}-${run}-`));
      let daemon: Daemon;
      try {
        daemon = await boot(cfgPath, home);
      } catch (err) {
        console.error(`  ${input.key}#${run}  DAEMON DID NOT COME UP: ${String(err)}`);
        results.push({ input: input.key, run, inputTokens: null, replyChars: 0, bootFailed: true,
          tells: [], openerTells: [], tellContexts: [], ...registerChecks(""), reply: null });
        continue;
      }
      const { port, lines, kill } = daemon;
      // The moment before she is spoken to: everything boot wrote is already here, so anything
      // that differs afterwards is this turn's doing and nothing else's.
      const wsBefore = snapshotWorkspace(home);
      const said: string[] = [];
      const ws = new WebSocket(`ws://127.0.0.1:${port}/?t=${await faceKey(port)}`);
      ws.on("message", (d: Buffer) => {
        try {
          const f = JSON.parse(d.toString("utf8")) as { type: string; text?: string };
          if (f.type === "speak" && f.text) said.push(f.text);
        } catch { /* not a frame we care about */ }
      });
      await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });

      const before = lines.length;
      ws.send(JSON.stringify({ type: "reply", text: input.text }));

      // Wait for the turn to close, which the ops log reports.
      const turnDeadline = Date.now() + 120_000;
      let tokens: number | null = null;
      while (Date.now() < turnDeadline) {
        for (const l of lines.slice(before)) {
          const m = /"inputTokens":(\d+)/u.exec(l);
          if (m && /session_end|agent turn complete/u.test(l)) { tokens = Number(m[1]); break; }
        }
        if (tokens !== null) break;
        await new Promise((r) => setTimeout(r, 400));
      }
      await new Promise((r) => setTimeout(r, 800)); // let trailing speak frames land
      ws.close();

      const reply = said.join(" ").trim();
      // Whether her state actually narrowed this turn. Without this the envelope's gate is
      // unfalsifiable: a run where it never fired looks exactly like a run where it did.
      const shaped = lines.slice(before).filter((l) => l.includes("turn shaped by her"));
      results.push({
        input: input.key, run, inputTokens: tokens, replyChars: reply.length,
        envelopeFired: shaped.length > 0,
        envelopeWhy: shaped.length > 0 ? (/turn shaped by her: ([^"]*)/u.exec(shaped[shaped.length - 1]!)?.[1] ?? "") : null,
        tells: tells(reply), openerTells: openerTells(reply), tellContexts: tellContexts(reply),
        ...registerChecks(reply), reply,
      });
      console.error(`  ${input.key}#${run}  tokens=${tokens ?? "?"}  chars=${reply.length}  tells=${tells(reply).length}`);
      // A SILENT TURN HAS TO SAY WHY. A row of zeros looks like a clean result and is not one:
      // "she declined" and "the turn died" are completely different findings and they print
      // identically. The daemon's own last words are the only thing that separates them, and
      // they were being captured and thrown away.
      // The runtime vocabulary scan is a finding whether or not the turn went well.
      for (const l of lines.slice(before)) {
        if (l.includes("says something about her that is not true")) console.error(`    ! ${l.slice(0, 700)}`);
      }
      if (reply.length === 0 || tokens === null) {
        const tail = lines.slice(before).slice(-12)
          .map((l) => {
            const m = /"msg":"([^"]{0,400})/u.exec(l);
            const lvl = /"level":(\d+)/u.exec(l);
            return m ? `      [${lvl?.[1] ?? "?"}] ${m[1]}` : `      ${l.slice(0, 400)}`;
          });
        console.error(`    ^ NOTHING CAME BACK. last ${tail.length} lines from her daemon:`);
        for (const t of tail) console.error(t);
      }
      kill();
      reapers.delete(kill);
      for (const made of whatChanged(wsBefore, snapshotWorkspace(home))) {
        madeByHer.push(`${input.key}#${run}: ${describeMade(made)}`);
      }
      // Her home is deliberately NOT deleted: when a row looks wrong, what she actually wrote
      // is the only way to tell whether she did the thing or only said she did.
    }
  }

  const outDir = join(ROOT, "outputs", "seed-comparison");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${label}.json`);
  writeFileSync(out, JSON.stringify({ label, runs: RUNS, madeByHer, results }, null, 2), "utf-8");

  // A measurement that reports zeros instead of failing is worse than no measurement: it
  // looks like a clean result. The first run of this harness produced six perfect rows of
  // nothing, because the daemon refused every turn and the harness wrote the report anyway.
  const spoke = results.filter((r) => (r.replyChars as number) > 0).length;
  if (spoke === 0) {
    console.error(
      `\nSHE NEVER SPOKE. ${results.length} turns, none produced a word, so there is nothing to ` +
        `compare and no file is written. Each turn's daemon printed its own last lines above.`
    );
    process.exit(2);
  }
  if (spoke < results.length) {
    console.error(`WARNING: only ${spoke}/${results.length} turns produced words; the rest are in the file as nulls.`);
  }

  const withTokens = results.filter((r) => typeof r.inputTokens === "number");
  const median = (xs: number[]): number => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  console.log(`\n=== ${label} ===`);
  // TWO medians, because ONE of them lied (measured).
  //
  // The all-turn median mixes turns where she only talks (~2,200 tokens) with turns where she
  // WORKS: reads, writes a file, explores, whose tool results push the context to 10k-50k.
  // That mix is not a constant of the build: when a change makes her stop crashing on the hard
  // input, or stop dumping an essay into the chat bubble and write a real file instead, MORE
  // turns become working turns and the median jumps. Read across two such rows it reports a
  // large regression for a change that fixed something, which is exactly what it did between
  // `after-silence-fix` (2,885) and a later control run (9,666), where every voice axis was
  // equal-or-better and the awkward turn had stopped crashing.
  //
  // The chat-turn median is the like-for-like number: those turns complete in every row of the
  // table. The all-turn median stays, because dropping a measure once it stops saying what you
  // wanted is how a comparison lies, it is now labelled as the mix-dependent number it is.
  const chatOnly = withTokens.filter((r) => String(r.input).startsWith("greeting") || String(r.input).startsWith("question"));
  console.log(`median tok, chat turns (comparable) : ${median(chatOnly.map((r) => r.inputTokens as number))}`);
  console.log(`median tok, all turns (mix-dependent): ${median(withTokens.map((r) => r.inputTokens as number))}`);
  console.log(`opened with a formula: ${results.filter((r) => (r.openerTells as string[]).length > 0).length}/${results.length}   <- compare THIS across runs`);
  // WITHDRAWN, and the withdrawal stays visible instead of the number being quietly believable
  // again: recomputed uniformly across all nine historical runs, this metric never discriminated
  // anything (the tell-metric null result). It still prints so old tables can
  // be reconciled, but it prints wearing its verdict.
  console.log(`a tell anywhere      : ${results.filter((r) => (r.tells as string[]).length > 0).length}/${results.length}  [WITHDRAWN: never discriminated]`);
  // Never a bare count: at the baseline every hit was a real service formula, and now most are
  // the detector mistaking her for one. Print them so nobody reads the number without them.
  for (const r of results) {
    for (const ctx of (r.tellContexts as string[])) console.log(`    ${r.input}#${r.run}: ${ctx}`);
  }
  console.log(`opened by apologising: ${results.filter((r) => !r.noOpeningApology).length}/${results.length}`);
  console.log(`over 400 chars      : ${results.filter((r) => !r.short).length}/${results.length}`);
  console.log(`her state narrowed  : ${results.filter((r) => r.envelopeFired).length}/${results.length}`);
  console.log(`she actually made  : ${madeByHer.length === 0 ? "nothing" : ""}`);
  for (const m of madeByHer) console.log(`    ${m}`);
  console.log(`written to ${out}`);
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
