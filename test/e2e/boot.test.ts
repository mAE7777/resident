import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// DOES SHE ACTUALLY START.
//
// Everything else in this suite imports modules. Nothing imported `src/index.ts` and ran it, and the
// failures that live there are exactly the ones no unit test can see:
//
//   `(critical ? logger.error : logger.warn)(line)`, pino throws on a detached `this`, so the
//   monitor cycle crashed every five minutes, forever. Every unit test passed.
//
//   `await telegramBot.start()` as the last statement of the run. A Telegram that was unreachable at
//   boot rejected out of the whole command and killed the process, AFTER every part of her had been
//   built and started. A network hiccup at the wrong moment cost her the day rather than a channel.
//
//   Any use-before-declaration, any circular import, any missing await in the wiring.
//
// Both of the above were found by booting her by hand. That is not a gate, so this is: she is
// started for real, in a scratch workspace, against a Telegram that CANNOT work, which is also the
// adversarial case, because the thing she must do is live anyway.

const ROOT = new URL("../..", import.meta.url).pathname;
const READY = "ready — starting Telegram bot";

let child: ChildProcess | null = null;
let workspace = "";

afterEach(() => {
  // Kill the GROUP, not the child. `spawn("pnpm", ["exec", "tsx", …])` puts two processes
  // between this handle and the daemon, and SIGKILL to the wrapper leaves the daemon
  // orphaned and running. Every run of this file used to leak one, and each leaked daemon
  // held a database open and kept writing to it, which is how ninety of them ended up
  // living in another agent's home at once.
  if (child?.pid) {
    try {
      process.kill(-child.pid, "SIGKILL"); // negative pid = the whole process group
    } catch {
      child.kill("SIGKILL"); // already gone, or no group (spawn failed)
    }
  }
  child = null;
  if (workspace && existsSync(workspace)) rmSync(workspace, { recursive: true, force: true });
});

interface BootResult {
  reachedReady: boolean;
  aliveAfter: boolean;
  lines: string[];
}

/**
 * Start her for real, watch for `ms`, and report what happened.
 *
 * `extraEnv` lets a test CREATE the condition it is testing. These used to lean on the
 * checked-in config carrying a placeholder bot token, so the moment a real token was
 * configured the "she says so when her voice fails" test started passing for the wrong
 * reason and then failing outright. A test that depends on the repository being
 * misconfigured is asserting about a machine, not about code.
 */
async function boot(ms: number, extraEnv: Record<string, string> = {}): Promise<BootResult> {
  workspace = mkdtempSync(join(tmpdir(), "resident-boot-"));
  const lines: string[] = [];
  child = spawn("pnpm", ["exec", "tsx", "src/index.ts", "start"], {
    cwd: ROOT,
    env: {
      ...process.env,
      // The WHOLE home, not just the workspace. Overriding workspace.path alone used to be
      // how this test ran, and it is exactly the half-move the boot assertion now refuses:
      // her files would land here while her database stayed in the real home.
      RESIDENT_HOME: workspace,
      // The avatar socket would bind a fixed port and collide with a real daemon on this machine.
      RESIDENT__LIFE__EMBODIMENT__ENABLED: "false",
      // NEVER the real token, by default. Two of these boots inherited config.yaml's live bot
      // token and long-polled Telegram as a second instance for 30-50s each, which is what
      // Telegram's 409 ("make sure that only one bot instance is running") had been saying all
      // along: every full-suite run produced exactly two 409 ladders on the real daemon, one
      // per unoverridden boot. A test may still override this explicitly; none needs to.
      RESIDENT__TELEGRAM__BOT_TOKEN: "0:not-a-real-token",
      // NEVER a real model key either. A fresh clone has no config.yaml, and a machine that has one
      // must not spend real money on a boot test. A syntactically valid key is enough to boot.
      RESIDENT__LLM__API_KEYS: '["sk-boot-test-syntactically-valid-never-a-real-key"]',
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // its own process group, so afterEach can kill the daemon and not just the wrapper
  });
  const collect = (b: Buffer): void => { lines.push(...b.toString().split("\n").filter(Boolean)); };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);

  let exited = false;
  child.on("exit", () => { exited = true; });

  const started = Date.now();
  while (Date.now() - started < ms) {
    await new Promise((r) => setTimeout(r, 250));
    if (exited) break;
  }
  return {
    reachedReady: lines.some((l) => l.includes(READY)),
    aliveAfter: !exited,
    lines,
  };
}

/** Every line pino wrote at error level or worse, as `{level, msg}`. */
function errorsIn(lines: string[]): { level: number; msg: string }[] {
  const out: { level: number; msg: string }[] = [];
  for (const line of lines) {
    try {
      const o = JSON.parse(line) as { level?: number; msg?: string };
      if (typeof o.level === "number" && o.level >= 50) out.push({ level: o.level, msg: o.msg ?? "" });
    } catch { /* grammy and node write plain text; those are checked separately */ }
  }
  return out;
}

describe("she boots, and keeps living when her voice does not", () => {
  it("reaches ready and is still alive a minute later", async () => {
    const r = await boot(50_000);
    const errs = errorsIn(r.lines);
    console.log(`\n  reached ready: ${r.reachedReady} · still alive: ${r.aliveAfter}`);
    console.log(`  errors: ${[...new Set(errs.map((e) => e.msg))].join(" | ") || "(none)"}`);

    expect(r.reachedReady, "she never finished starting").toBe(true);
    expect(r.aliveAfter, "she must survive her own startup").toBe(true);
  }, 90_000);

  it("keeps living when her voice cannot start", async () => {
    // Forced, not inherited: a token that cannot possibly connect. Her inner life must not
    // depend on her outer one, and an unreachable Telegram used to kill the process.
    const r = await boot(50_000, { RESIDENT__TELEGRAM__BOT_TOKEN: "0:not-a-real-token" });
    expect(r.reachedReady, "she never finished starting").toBe(true);
    expect(r.aliveAfter, "an unreachable Telegram must cost her a channel, never the day").toBe(true);
  }, 90_000);

  it("says so, in the fault channel, rather than failing quietly", async () => {
    const r = await boot(30_000, { RESIDENT__TELEGRAM__BOT_TOKEN: "0:not-a-real-token" });
    const msgs = errorsIn(r.lines).map((e) => e.msg);
    expect(msgs.some((m) => m.includes("telegram could not start")), "she must report being out of reach").toBe(true);
    expect(msgs.some((m) => m.includes("fault [telegram.start]")), "and it must be a FAULT, not just a log line").toBe(true);
  }, 60_000);

  it("nothing crashes the monitor, which runs on its own timer", async () => {
    // The pino `this`-detachment bug made this cycle throw every five minutes forever, and the only
    // symptom was an exception nobody was reading. Anything unhandled reaching stdout now names it.
    const r = await boot(30_000);
    const unhandled = r.lines.filter((l) =>
      l.includes("unhandledRejection") || l.includes("uncaughtException")
      || /TypeError|ReferenceError|is not a function|Cannot read/.test(l));
    if (unhandled.length > 0) console.log(`\n  unhandled: ${unhandled.slice(0, 3).join(" | ")}`);
    expect(unhandled, "a daemon that throws into its own timers dies slowly and silently").toEqual([]);
  }, 60_000);
});
