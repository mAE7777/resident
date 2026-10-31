// The body, end to end, the way Eric will actually meet it: boot her in a throwaway home,
// fetch the page a browser would load, connect as the page does, watch her face move, say
// something, hear her answer, cut her off. Exits non-zero if any limb is dead.
//
// Usage: pnpm exec tsx scripts/body-smoke.ts

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { WebSocket } from "ws";

const ROOT = new URL("..", import.meta.url).pathname;

function fail(msg: string): never {
  console.error(`\nBODY SMOKE FAILED: ${msg}`);
  process.exit(1);
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
  const home = mkdtempSync(join(tmpdir(), "resident-body-"));
  // The REAL allowedUserIds with a DEAD token, deliberately: that is the exact shape of the
  // preview Eric first met her through, and it is the shape that found the mirror-kills-the-
  // turn defect (a 401 on the Telegram mirror aborted every face turn before the model ran,
  // while the chatId-0 smoke sailed past on the no-route branch). The smoke must walk the
  // failing mirror path forever.
  const cfg = readFileSync(join(ROOT, "config.yaml"), "utf-8")
    .replace(/botToken:.*$/mu, 'botToken: "0000000000:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"');
  const cfgPath = join(home, "config.yaml");
  writeFileSync(cfgPath, cfg, "utf-8");

  const child: ChildProcess = spawn("pnpm", ["exec", "tsx", "src/index.ts", "start", "--config", cfgPath], {
    cwd: ROOT,
    env: { ...process.env, RESIDENT_HOME: home, RESIDENT__LIFE__EMBODIMENT__ENABLED: "true" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const kill = (): void => {
    if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
  };
  process.on("exit", kill);

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

  const bootDeadline = Date.now() + 90_000;
  while (port === null && Date.now() < bootDeadline) await new Promise((r) => setTimeout(r, 500));
  if (port === null) fail("she never opened her face port.\n" + lines.slice(-12).join("\n"));

  // 1. The page a browser would load.
  const page = await fetch(`http://127.0.0.1:${port}/`);
  if (page.status !== 200) fail(`the page answered ${page.status}`);
  const body = await page.text();
  if (!body.includes("face.js")) fail("the page does not carry her face script");
  const js = await fetch(`http://127.0.0.1:${port}/face.js`);
  if (js.status !== 200) fail("face.js is missing");
  console.log("  page      · served");

  // 2. Connect exactly as the page does.
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?t=${await faceKey(port)}`);
  await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });

  const seen = { pad: 0, doing: [] as string[], speak: [] as string[], status: 0, cancel: 0 };
  ws.on("message", (d: Buffer) => {
    try {
      const f = JSON.parse(d.toString("utf8")) as { type: string; what?: string; text?: string };
      if (f.type === "pad") seen.pad += 1;
      if (f.type === "status") seen.status += 1;
      if (f.type === "doing") seen.doing.push(f.what ?? "");
      if (f.type === "speak" && f.text) seen.speak.push(f.text);
      if (f.type === "cancel") seen.cancel += 1;
    } catch { /* not a frame */ }
  });

  // Presence: he is here and free, so her own voice is allowed too.
  ws.send(JSON.stringify({ type: "presence", signals: { idleSeconds: 3, frontAppFocused: true, dndOrFocus: false, screenSharing: false, micActive: false } }));

  // 3. Her face moves within seconds, not on the hour (B3).
  const padDeadline = Date.now() + 15_000;
  while (seen.pad < 2 && Date.now() < padDeadline) await new Promise((r) => setTimeout(r, 300));
  if (seen.pad < 2) fail(`her face did not move: ${seen.pad} pad frames in 15s (B3)`);
  console.log(`  face      · ${seen.pad} pad frames in seconds`);

  // 4. Say something; she shows "在和你说话" while it is true (B4) and answers aloud (B6 route).
  ws.send(JSON.stringify({ type: "reply", text: "在吗" }));
  const talkDeadline = Date.now() + 120_000;
  while (seen.speak.length === 0 && Date.now() < talkDeadline) await new Promise((r) => setTimeout(r, 400));
  if (seen.speak.length === 0) fail("she never spoke.\n" + lines.slice(-8).join("\n"));
  if (!seen.doing.includes("在和你说话")) fail(`the face never learned she was talking (B4). doing frames: ${JSON.stringify(seen.doing)}`);
  console.log(`  voice     · she said: ${seen.speak.join(" ").slice(0, 60)}`);
  console.log(`  doing     · ${JSON.stringify(seen.doing.filter(Boolean))}`);

  // 5. The turn clears the caption afterwards.
  const clearDeadline = Date.now() + 20_000;
  while (!seen.doing.includes("") && Date.now() < clearDeadline) await new Promise((r) => setTimeout(r, 300));
  if (!seen.doing.includes("")) fail("the caption never cleared after the turn (B4)");

  // 6. Cut her off mid-answer on a second, longer turn (B1: the interrupt reaches the TURN).
  seen.speak.length = 0;
  ws.send(JSON.stringify({ type: "reply", text: "给我慢慢讲一个很长的故事" }));
  const speakStart = Date.now() + 60_000;
  while (seen.speak.length === 0 && Date.now() < speakStart) await new Promise((r) => setTimeout(r, 300));
  ws.send(JSON.stringify({ type: "interrupt" }));
  const cancelDeadline = Date.now() + 5_000;
  while (seen.cancel === 0 && Date.now() < cancelDeadline) await new Promise((r) => setTimeout(r, 200));
  if (seen.cancel === 0) fail("the interrupt never came back as a cancel frame (B1)");
  console.log(`  interrupt · acknowledged with a cancel frame`);

  ws.close();
  kill();
  console.log("\nBODY SMOKE PASSED: page, face, doing, voice, interrupt all alive.");
  process.exit(0);
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
