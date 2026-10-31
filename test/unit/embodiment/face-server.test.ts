import { describe, it, expect, afterEach, vi } from "vitest";
import { WebSocket } from "ws";
import { readFileSync } from "node:fs";
import { createFaceServer, type FaceServer } from "../../../src/embodiment/face-server.js";
import type { PresenceSignals } from "../../../src/embodiment/presence.js";

let server: FaceServer | null = null;

afterEach(async () => {
  if (server) await server.close();
  server = null;
});

function connect(port: number, key = server!.token()): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?t=${key}`);
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextMessage(ws: WebSocket): Promise<{ text: string; binary: boolean }> {
  return new Promise((resolve) => {
    ws.once("message", (data, isBinary) => {
      resolve({ text: Buffer.isBuffer(data) ? data.toString("utf8") : String(data), binary: isBinary });
    });
  });
}

const PRESENCE: PresenceSignals = {
  idleSeconds: 3,
  frontAppFocused: true,
  dndOrFocus: false,
  screenSharing: false,
  micActive: false,
};

describe("face server (mind<->face transport)", () => {
  it("broadcasts a typed face frame to a connected client", async () => {
    server = createFaceServer({ port: 0 });
    await server.ready();
    const ws = await connect(server.boundPort()!);
    const incoming = nextMessage(ws);
    server.broadcast({ type: "mood", mood: "curious", dominant: "curiosity" });
    const { text, binary } = await incoming;
    expect(binary).toBe(false);
    expect(JSON.parse(text)).toEqual({ type: "mood", mood: "curious", dominant: "curiosity" });
    ws.close();
  });

  it("routes a valid presence frame to the onPresence hook", async () => {
    const seen: PresenceSignals[] = [];
    server = createFaceServer({ port: 0, onPresence: (s) => seen.push(s) });
    await server.ready();
    const ws = await connect(server.boundPort()!);
    ws.send(JSON.stringify({ type: "presence", signals: PRESENCE }));
    await vi.waitFor(() => expect(seen.length).toBe(1));
    expect(seen[0].idleSeconds).toBe(3);
    expect(seen[0].frontAppFocused).toBe(true);
    ws.close();
  });

  it("drops a malformed inbound frame without invoking any hook", async () => {
    let replies = 0;
    server = createFaceServer({ port: 0, onReply: () => { replies++; } });
    await server.ready();
    const ws = await connect(server.boundPort()!);
    ws.send("not json at all");
    ws.send(JSON.stringify({ type: "reply" })); // missing required text
    // Give the server a tick to process, then a valid frame to prove it is still alive.
    ws.send(JSON.stringify({ type: "reply", text: "hi" }));
    await vi.waitFor(() => expect(replies).toBe(1));
    ws.close();
  });

  it("tracks client count across connect and disconnect", async () => {
    server = createFaceServer({ port: 0 });
    await server.ready();
    const a = await connect(server.boundPort()!);
    await vi.waitFor(() => expect(server!.clientCount()).toBe(1));
    const b = await connect(server.boundPort()!);
    await vi.waitFor(() => expect(server!.clientCount()).toBe(2));
    a.close();
    await vi.waitFor(() => expect(server!.clientCount()).toBe(1));
    b.close();
  });

  it("has no audio channel at all, which is the design and not an omission", () => {
    // This used to assert the opposite: that a binary audio frame could be broadcast to the
    // face. Nothing ever called it, and audio never crosses this link in
    // either direction, because synthesis happens on the machine with the speakers. A route
    // that contradicts the rule is worse than a missing one, because somebody eventually
    // wires it up. The route is gone; this asserts that it stays gone.
    server = createFaceServer({ port: 0 });
    expect((server as unknown as Record<string, unknown>)["broadcastAudio"]).toBeUndefined();
  });
});

/**
 * WHO IS ALLOWED ON THE OTHER END OF HER FACE.
 *
 * The hole this closes was the largest ever found in her home boundary, and it came in
 * through the body rather than through the wall, which is why the wall never saw it. The
 * socket was open to anything that could reach the port, and the assumption that loopback
 * made that safe is false for exactly one caller: a browser. A browser does not apply the
 * same-origin policy to WebSockets and sends no preflight, so ANY page in ANY tab Eric had
 * open could connect, receive every `speak` frame (the full text of everything she says to
 * him) plus her live mood, and send `{"type":"reply"}`, which the daemon feeds into the
 * same path a message from Eric takes, with her whole toolbelt and her vigor charged.
 *
 * A stranger reading her inner life and speaking to her as him, from a tab.
 *
 * Both locks are tested here, and they are tested SEPARATELY on purpose: each has to hold
 * on its own, because they fail differently. Page JavaScript cannot set `Origin`, so the
 * origin check is what answers the browser specifically. The key answers everything else,
 * and is minted per boot and written only into the page this server itself serves.
 */
describe("her face does not open for strangers", () => {
  const refused = (ws: WebSocket): Promise<string> =>
    new Promise((resolve) => {
      ws.once("error", (e: Error) => resolve(e.message));
      ws.once("open", () => resolve("OPENED"));
    });

  it("refuses a page from somewhere else, even holding the key", async () => {
    // The exact attack: a real key (stolen, guessed, whatever) is not enough if the
    // connection comes from a page that is not hers. This is the browser's own honesty
    // doing the work: JavaScript cannot forge this header.
    server = createFaceServer({ port: 0 });
    await server.ready();
    const ws = new WebSocket(`ws://127.0.0.1:${server.boundPort()}/?t=${server.token()}`, {
      headers: { Origin: "https://some-page-he-had-open.example" },
    });
    expect(await refused(ws), "a foreign page got in").not.toBe("OPENED");
  });

  it("refuses anything without the key, even from her own origin", async () => {
    server = createFaceServer({ port: 0 });
    await server.ready();
    const port = server.boundPort()!;
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
      headers: { Origin: `http://127.0.0.1:${port}` },
    });
    expect(await refused(ws), "a keyless client got in").not.toBe("OPENED");
  });

  it("refuses a wrong key of the right length, so the compare is not a prefix", async () => {
    server = createFaceServer({ port: 0 });
    await server.ready();
    const wrong = "0".repeat(server.token().length);
    const ws = new WebSocket(`ws://127.0.0.1:${server.boundPort()}/?t=${wrong}`);
    expect(await refused(ws), "a wrong key got in").not.toBe("OPENED");
  });

  it("lets her own page in, which is the whole point of having a key at all", async () => {
    server = createFaceServer({ port: 0 });
    await server.ready();
    const port = server.boundPort()!;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?t=${server.token()}`, {
      headers: { Origin: `http://127.0.0.1:${port}` },
    });
    expect(await refused(ws)).toBe("OPENED");
    ws.close();
  });

  it("gives the page a real key and never leaves one on disk", async () => {
    // The two halves of the same claim: what a browser receives is a live key, and what
    // sits in the repo is a placeholder. If the injection ever silently stopped working,
    // the page would ship the literal placeholder and every client would be refused, so
    // this asserts the served bytes, not the file.
    server = createFaceServer({ port: 0 });
    await server.ready();
    const html = await (await fetch(`http://127.0.0.1:${server.boundPort()}/`)).text();
    expect(html).toContain(server.token());
    expect(html, "the placeholder went out instead of a key").not.toContain("__FACE_KEY_GOES_HERE__");

    const onDisk = readFileSync(new URL("../../../src/embodiment/client/index.html", import.meta.url), "utf8");
    expect(onDisk, "a live key was written into the repo").toContain("__FACE_KEY_GOES_HERE__");
    expect(onDisk).not.toContain(server.token());
  });

  it("mints a different key every boot, so yesterday's does not work today", async () => {
    const a = createFaceServer({ port: 0 });
    const b = createFaceServer({ port: 0 });
    await Promise.all([a.ready(), b.ready()]);
    expect(a.token()).not.toBe(b.token());
    expect(a.token().length).toBeGreaterThanOrEqual(32);
    await Promise.all([a.close(), b.close()]);
  });
});
