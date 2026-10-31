import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createFaceServer, defaultClientDir, type FaceServer } from "../../../src/embodiment/face-server.js";
import { encodeFace } from "../../../src/embodiment/protocol.js";

/**
 * The body: one port serves her whole face. The page is what Eric actually opens, so the
 * page's own promises (no network by default, her chosen voice, ears that do not hear her own
 * speech) are asserted here against the real files, not trusted.
 */
let server: FaceServer | null = null;
afterEach(async () => { if (server) { await server.close(); server = null; } });

async function get(port: number, path: string): Promise<{ status: number; body: string; type: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: await res.text(), type: res.headers.get("content-type") ?? "" };
}

describe("one port serves the whole face", () => {
  it("hands the page to a browser and the socket to the page", async () => {
    server = createFaceServer({ port: 0 });
    await server.ready();
    const port = server.boundPort()!;

    const page = await get(port, "/");
    expect(page.status).toBe(200);
    expect(page.type).toContain("text/html");
    expect(page.body).toContain("face.js");

    const js = await get(port, "/face.js");
    expect(js.status).toBe(200);
    expect(js.type).toContain("javascript");

    // And the same port still speaks WebSocket.
    const { WebSocket } = await import("ws");
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?t=${server!.token()}`);
    await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });
    ws.close();
  });

  it("does not let a request walk out of the client directory", async () => {
    server = createFaceServer({ port: 0 });
    await server.ready();
    const port = server.boundPort()!;
    for (const path of ["/../face-server.ts", "/..%2f..%2fpackage.json", "/%2e%2e/protocol.ts"]) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      expect([403, 404], `${path} escaped`).toContain(res.status);
      const text = await res.text();
      expect(text).not.toContain("createFaceServer");
    }
  });

  it("a missing model probe answers cleanly, because the page asks on every load", async () => {
    server = createFaceServer({ port: 0 });
    await server.ready();
    const res = await get(server.boundPort()!, "/model/model3.json");
    expect(res.status).toBe(404);
  });

  it("the doing frame is part of the contract", () => {
    const frame = encodeFace({ type: "doing", what: "在和你说话", ts: 1 });
    expect(JSON.parse(frame)).toEqual({ type: "doing", what: "在和你说话", ts: 1 });
  });
});

describe("the page keeps its own promises", () => {
  const dir = defaultClientDir();
  const js = readFileSync(`${dir}/face.js`, "utf8");
  const html = readFileSync(`${dir}/index.html`, "utf8");

  it("exists where the server will look for it", () => {
    expect(existsSync(`${dir}/index.html`)).toBe(true);
    expect(existsSync(`${dir}/face.js`)).toBe(true);
  });

  it("touches no network beyond its own origin", () => {
    // The rule: self-contained by default. The socket is same-origin; the model probe is a
    // relative fetch; nothing else may reach out. A CDN URL here is how a borrowed runtime
    // sneaks in before a face was ever chosen. Checked at the LOAD POINTS (script src, href,
    // fetch, import), because a URL in a comment explaining how to open the page is not a
    // network access.
    for (const file of [js, html]) {
      expect(file).not.toMatch(/src="https?:/u);
      expect(file).not.toMatch(/href="https?:/u);
      expect(file).not.toMatch(/fetch\("https?:/u);
      expect(file).not.toMatch(/import\("https?:/u);
    }
    expect(js).toContain("ws://${location.host}");
  });

  it("speaks with her voice: low, level, a little slow, in Chinese", () => {
    expect(js).toMatch(/rate = 0\.8[0-9]?/u);
    expect(js).toMatch(/pitch = 0\.[78]/u);
    expect(js).toMatch(/zh[-_]CN/u);
  });

  it("does not hear herself: the ears pause while she speaks", () => {
    expect(js).toContain("pauseEars();");
    expect(js).toContain("resumeEars();");
    // And the pause is tied to speech starting, not to a timer.
    const speakBlock = js.slice(js.indexOf("function pump()"), js.indexOf("function shutUp()"));
    expect(speakBlock).toContain("pauseEars()");
  });

  it("cutting her off tells the mind, not just the speakers", () => {
    expect(js).toContain('send({ type: "interrupt" })');
  });

  it("presence reports only what a browser honestly knows", () => {
    // dnd and screen sharing are invisible to a page; they are sent as false, never guessed.
    expect(js).toContain("dndOrFocus: false");
    expect(js).toContain("screenSharing: false");
  });

  it("words the browser blocks wait for his touch instead of vanishing", () => {
    // Measured on the real machine: a tab driven by the extension spoke, a fresh tab
    // was silent. Chrome refuses speechSynthesis before the user's first interaction with the
    // page, and the first version handed her words to a refusing engine and dropped them.
    expect(js).toContain("navigator.userActivation");
    expect(js, "a blocked utterance must be requeued, not swallowed").toContain("queue.unshift(next)");
    expect(js, "and the page says WHY it is silent").toContain("浏览器的规矩");
  });

  it("her mouth is driven by what is actually being said, never by pending text", () => {
    // The envelope starts on utterance start and dies with it. Driving the mouth from text
    // she has not said yet is the desync the pad-mapping file warns about.
    const speakBlock = js.slice(js.indexOf("u.onstart"), js.indexOf("synth.speak(u)"));
    expect(speakBlock).toContain("state.mouth");
  });
});

describe("the daemon wiring holds", () => {
  const source = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8");

  it("interrupt aborts the thread the face turn actually runs on", () => {
    // It aborted `ownerChatId`, which is only the face thread when Telegram is configured. A
    // face-only setup could stop her voice but never the turn behind it: she stopped talking
    // and kept thinking, and her next words were the rest of an answer he had cut off.
    expect(source).toContain("turnAbortControllers.get(faceThreadId)?.abort();");
    const blockStart = source.indexOf("onInterrupt: () => {");
    const blockEnd = source.indexOf("faceServer.ready()");
    // Floors: this is the file's one NEGATIVE assertion over a slice, with either anchor
    // gone the slice is empty and the old ownerChatId abort could return unseen.
    expect(blockStart, "the onInterrupt anchor moved — the negative check below reads nothing").toBeGreaterThan(-1);
    expect(blockEnd, "the faceServer.ready anchor moved — the negative check below reads nothing").toBeGreaterThan(blockStart);
    const block = source.slice(blockStart, blockEnd);
    expect(block).not.toContain("ownerChatId !== undefined) turnAbortControllers");
  });

  it("her face gets frames in seconds, and only while someone is looking", () => {
    // Declared out in the daemon's own scope rather than inline, so shutdown can actually stop
    // it: it used to keep broadcasting to a face server that was already closing.
    expect(source, "the face tick is missing").toContain("faceTick = setInterval(");
    expect(source, "shutdown cannot stop her face tick").toContain("if (faceTick) clearInterval(faceTick);");
    const tick = source.slice(source.indexOf("faceTick = setInterval("), source.indexOf("faceTick?.unref"));
    expect(tick, "PAD does not reach the face").toContain('type: "pad"');
    expect(tick, "a faceless deployment would pay for frames").toContain("clientCount() === 0) return;");
    expect(tick, "mood spams every tick instead of on change").toContain("lastFaceMood");
  });

  it("what she initiates is spoken only when he can actually hear it", () => {
    const speak = source.slice(source.indexOf("speakThroughFace = (text) => {"), source.indexOf("// B3:"));
    expect(speak).toContain('presenceNow()?.tier !== "speakup"');
    // And the Telegram mirror is unconditional: the transcript survives.
    const pushStart = source.indexOf("push: async (text) => {");
    const push = source.slice(pushStart, source.indexOf('category: "proactive"', pushStart));
    expect(push).toContain("speakThroughFace?.(text)");
  });

  it("a dead Telegram mirror cannot kill the conversation in the room", () => {
    // The mirror send is best-effort: its failure is a recorded fault and a returned 0, never
    // a propagated exception. Her first face-to-face meeting with him died on exactly this: a 401 from
    // the mirror aborted every face turn before the model ran, so she flashed 在和你说话 and
    // never made a sound.
    const mirror = source.slice(source.indexOf("const mirror: import"), source.indexOf("return teeChannels(mirror"));
    expect(mirror).toContain('faultLog.record("telegram.mirror", err)');
    expect(mirror, "a failed send must yield a fake id, not a throw").toContain("return 0;");
    expect(mirror, "editing a message that never sent").toContain("if (msgId === 0) return;");
  });

  it("a turn that dies is spoken about, never silent", () => {
    const catchBlock = source.slice(source.indexOf('faultLog.record("embodiment.turn", err)'), source.indexOf('faultLog.record("embodiment.turn", err)') + 500);
    expect(catchBlock).toContain("刚才出了岔子，话没说出来。");
  });

  it("talking and her moments show as what she is doing, and clear afterwards", () => {
    expect(source).toContain('broadcastDoing?.("在和你说话")');
    expect(source).toContain('broadcastDoing?.("")');
    expect(source).toContain("broadcastDoing?.(kindWords(o.chose))");
  });
});

describe("presence dies with its line of sight", () => {
  const source = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8");
  it("the daemon reads presence only through presenceNow(), which knows about dead tabs", () => {
    // The defect: `latestPresence` was written by frames and reset by NOTHING, no disconnect
    // handler, no TTL, so the final frame of a dying tab (visibilitychange fires as it closes,
    // typically with focus lost) pinned 对方不在 into every consumer for the daemon's life:
    // pushes silenced into the diary, her read of him floored, her moments told he was gone.
    expect(source).toContain("function presenceNow()");
    expect(source, "no client connected means no line of sight").toContain("if (!faceServer || faceServer.clientCount() === 0) return null;");
    expect(source, "a frame that stopped arriving goes stale — a hung tab never fires close").toContain("PRESENCE_STALE_MS");
    expect(source, "every frame stamps its arrival").toContain("latestPresenceMs = Date.now()");
    // And no consumer reads the raw cell any more. The declaration, the stamp, and the accessor
    // are the only allowed appearances.
    const rawReads = source.split("\n").filter((l) =>
      l.includes("latestPresence") &&
      !l.includes("let latestPresence") && !l.includes("let latestPresenceMs") &&
      !l.includes("latestPresence = derivePresence") &&
      !l.includes("latestPresenceMs = Date.now()") &&
      !l.includes("return latestPresence") &&
      !l.includes("Date.now() - latestPresenceMs") &&
      !l.trim().startsWith("*") && !l.trim().startsWith("//"));
    expect(rawReads, `raw latestPresence reads outside presenceNow():\n${rawReads.join("\n")}`).toEqual([]);
  });
});
