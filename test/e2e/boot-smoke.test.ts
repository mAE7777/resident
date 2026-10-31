import { describe, it, expect, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// THE BOOT SMOKE, born from a live incident.
//
// Nothing in the suite executed the daemon's real startup sequence, so a boot-ORDER defect,
// a catch-up call placed upstream of a declaration it touches, was invisible to 4,267 green
// tests and fired on the real machine within the hour, twice, walking her into safe mode both
// times. The temporal dead zone is precisely the class no unit test can see: every module
// imports fine, every function passes alone, and only the one true initialization order, run
// end to end, springs it.
//
// So this spawns the REAL daemon, from the real entrypoint, against a throwaway home with no
// keys and no reachable provider, and asserts one thing: she comes up CLEAN. No reference
// errors, no TDZ, no life.tick fault, no critical vitals line, within the startup window.
// The key is fake and the provider address unroutable on purpose, a boot that needs the
// network to not-crash is already broken (the daemon rightly refuses ZERO keys, so it gets
// one that is syntactically a key and semantically nothing).
//
// TWO boots: flags OFF (the shipping default) AND the speech flags ON (room + breath
// + scissors + the whole S-3/S-4 wiring). The flags-on path had only ever been exercised by
// the voice-baseline harness, never by the boot smoke, so a TDZ or init-order defect in the
// room/breath/scissors/temperature wiring would have been just as invisible as the one that
// hit his machine. The A/B treatment path is now a standing boot witness too.

const ROOT = new URL("../..", import.meta.url).pathname;
const children = new Set<ChildProcess>();

afterAll(() => {
  for (const c of children) {
    if (c.pid) { try { process.kill(-c.pid, "SIGKILL"); } catch { c.kill("SIGKILL"); } }
  }
});

async function bootCleanly(extraEnv: Record<string, string>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "resident-boot-smoke-"));
  const port = 18000 + Math.floor(Math.random() * 2000);
  const cfgPath = join(home, "config.yaml");
  writeFileSync(cfgPath, [
    "llm:",
    "  provider: openai-compatible",
    "  baseUrl: http://127.0.0.1:9",   // reserved port: instantly unreachable, never routed
    "  apiKeys:",
    '    - "sk-boot-smoke-syntactically-valid-never-a-real-key"',
    "telegram:",
    '  botToken: "0000000000:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"',
    "  allowedUserIds:",
    "    - 0",
  ].join("\n"), "utf8");

  const child = spawn("pnpm", ["exec", "tsx", "src/index.ts", "start", "--config", cfgPath], {
    cwd: ROOT,
    env: {
      ...process.env,
      RESIDENT_HOME: home,
      RESIDENT__LIFE__EMBODIMENT__ENABLED: "true",
      RESIDENT__LIFE__EMBODIMENT__PORT: String(port),
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  children.add(child);

  const lines: string[] = [];
  const collect = (b: Buffer): void => { for (const l of b.toString().split("\n")) if (l.trim()) lines.push(l); };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);

  const deadline = Date.now() + 90_000;
  let up = false;
  while (Date.now() < deadline) {
    if (lines.some((l) => l.includes("face server listening"))) { up = true; break; }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  expect(up, `the daemon never came up. last lines:\n${lines.slice(-15).join("\n")}`).toBe(true);

  // Settling window: the boot catch-up tick, the first vitals cycle, timers arming. This is
  // where the live incident showed itself.
  await new Promise((r) => setTimeout(r, 8_000));

  const initFaults = lines.filter((l) =>
    /Cannot access '.*' before initialization|ReferenceError|is not defined|TDZ/u.test(l));
  expect(initFaults, `initialization-order faults in a live boot:\n${initFaults.join("\n")}`).toEqual([]);
  const tickFaults = lines.filter((l) => /life\.tick/u.test(l) && /fault|error/iu.test(l));
  expect(tickFaults, `the life tick faulted during boot:\n${tickFaults.join("\n")}`).toEqual([]);
  const criticalVitals = lines.filter((l) => /vitals\[critical\]/u.test(l));
  expect(criticalVitals, `a fresh healthy boot raised critical vitals:\n${criticalVitals.join("\n")}`).toEqual([]);

  // ── A COPY OF HER EXISTS, TAKEN BY THE REAL DAEMON ────────────────────────────────────────
  //
  // Source-scanning guards prove the call is written; only a real boot proves it RUNS. This is the
  // disk-monitor lesson applied to the backup itself: three functions there were fully tested,
  // green forever, and never once called in production. A backup nobody can see running is a belief.
  const snapshots = existsSync(join(home, "snapshots")) ? readdirSync(join(home, "snapshots")) : [];
  expect(snapshots.length, "the daemon booted and took no copy of her at all").toBeGreaterThan(0);
  const manifest = JSON.parse(
    readFileSync(join(home, "snapshots", snapshots[0]!, "snapshot.json"), "utf8"),
  ) as { dbIntegrity: string; codeVersion: string; files: unknown[] };
  expect(manifest.dbIntegrity, "the copy was never integrity-checked as a database").toBe("ok");
  expect(manifest.codeVersion, "the copy does not say which build took it").toMatch(/^\d+\.\d+\.\d+\+[0-9a-f]{12}$/u);
  expect(manifest.files.length).toBeGreaterThan(3);
}

describe("the daemon boots clean", () => {
  it("comes up with no initialization faults, providerless, in a fresh home (flags off)", async () => {
    await bootCleanly({});
  }, 120_000);

  it("comes up just as clean with the speech flags ON (room + breath, the A/B treatment path)", async () => {
    // The room/breath/scissors/temperature wiring is only reached with these on; a TDZ or
    // init-order defect there would otherwise ship unseen.
    await bootCleanly({
      RESIDENT__LIFE__SPEECH__ROOM: "true",
      RESIDENT__LIFE__SPEECH__BREATH: "true",
    });
  }, 120_000);
});
