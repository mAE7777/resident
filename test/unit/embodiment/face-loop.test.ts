// The loop that was open at both ends.
//
// Before this, the face-server's `onReply` was `logger.info(...)` and `onInterrupt` was
// `logger.info(...)`, and the `speak` frame defined in the protocol was sent from nowhere in
// the entire codebase. She could be seen, and she could sense him at the machine; she could
// not hear him and could not say anything back.
//
// This drives the real modules over a real WebSocket: a real `createFaceServer`, a real
// `createVoiceStream`, a real `teeChannels`, and a real agent event sequence. What it does
// not run is the model, which is why the assertions are about the SHAPE of the loop rather
// than about what she says.

import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { createFaceServer, type FaceServer } from "../../../src/embodiment/face-server.js";
import { createVoiceStream } from "../../../src/embodiment/voice-stream.js";
import { teeChannels, noticeOn, type TurnChannel } from "../../../src/agent/turn-channel.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createThinkFilter } from "../../../src/telegram/think-filter.js";
import type { AgentEvent } from "../../../src/agent/types.js";
import type { FaceMessage } from "../../../src/embodiment/protocol.js";

let server: FaceServer | null = null;
let client: WebSocket | null = null;

afterEach(async () => {
  client?.close();
  client = null;
  await server?.close();
  server = null;
});

/** A face client that really connects, and collects the frames it is sent. */
async function connect(s: FaceServer): Promise<{ ws: WebSocket; frames: FaceMessage[] }> {
  const frames: FaceMessage[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${s.boundPort()}/?t=${s.token()}`);
  ws.on("message", (d: Buffer) => frames.push(JSON.parse(d.toString("utf8")) as FaceMessage));
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return { ws, frames };
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

describe("the mind<->face loop, over a real socket", () => {
  it("carries what he said into a real turn, and her words back out", async () => {
    const heard: string[] = [];
    const mirrored: string[] = [];
    let seq = 0;

    server = createFaceServer({
      port: 0,
      onReply: (text) => {
        heard.push(text);
        // This is what the daemon does: build the channel, run the turn, speak the result.
        const voice = createVoiceStream({
          speak: (t, id) => server?.broadcast({ type: "speak", text: t, utteranceId: id, ts: 1 }),
          newUtteranceId: () => `u${++seq}`,
          thinkFilter: createThinkFilter(),
        });
        const mirror: TurnChannel = {
          async send(t: string): Promise<number> {
            mirrored.push(t);
            return mirrored.length;
          },
          async edit(_id: number, t: string): Promise<void> {
            mirrored[mirrored.length - 1] = t;
          },
        };
        const channel = teeChannels(mirror, {
          send: mirror.send,
          edit: mirror.edit,
          observe: (e) => voice.onEvent(e),
          done: () => voice.finalize(),
        });
        // A turn's worth of events, as the agent loop would emit them.
        const events: AgentEvent[] = [
          { type: "text_chunk", content: "I had a look at it, " },
          { type: "text_chunk", content: "and it is fine." },
        ];
        for (const e of events) channel.observe?.(e);
        channel.done?.();
      },
    });
    await server.ready();

    const c = await connect(server);
    client = c.ws;
    c.ws.send(JSON.stringify({ type: "reply", text: "did you look at that thing?" }));
    await settle();

    // He was heard.
    expect(heard).toEqual(["did you look at that thing?"]);

    // She spoke, in order, and the first utterance opened on a clause rather than waiting
    // for the whole sentence: that early opening is the entire latency argument.
    const spoken = c.frames.filter((f): f is Extract<FaceMessage, { type: "speak" }> => f.type === "speak");
    expect(spoken.length).toBeGreaterThanOrEqual(1);
    expect(spoken[0]!.text).toContain("I had a look at it");
    expect(spoken.map((s) => s.text).join(" ")).toContain("it is fine");

    // Every utterance is separately addressable, which is what `cancel` needs.
    expect(new Set(spoken.map((s) => s.utteranceId)).size).toBe(spoken.length);
  });

  it("mirrors the transcript to the other window", async () => {
    const mirrored: string[] = [];
    server = createFaceServer({
      port: 0,
      onReply: () => {
        const voice = createVoiceStream({
          speak: (t, id) => server?.broadcast({ type: "speak", text: t, utteranceId: id, ts: 1 }),
          newUtteranceId: () => "u1",
        });
        const mirror: TurnChannel = {
          async send(t: string): Promise<number> { mirrored.push(t); return 1; },
          async edit(_id: number, t: string): Promise<void> { mirrored[mirrored.length - 1] = t; },
        };
        const channel = teeChannels(mirror, {
          send: mirror.send, edit: mirror.edit,
          observe: (e) => voice.onEvent(e), done: () => voice.finalize(),
        });
        void channel.send("Yes, I did.");
        channel.observe?.({ type: "text_chunk", content: "Yes, I did." });
        channel.done?.();
      },
    });
    await server.ready();
    const c = await connect(server);
    client = c.ws;
    c.ws.send(JSON.stringify({ type: "reply", text: "hi" }));
    await settle();

    // The same words reached both: spoken here, readable there.
    expect(mirrored.join(" ")).toContain("Yes, I did.");
    const spoken = c.frames.filter((f) => f.type === "speak");
    expect(spoken.length).toBeGreaterThanOrEqual(1);
  });

  it("stops on barge-in, and the unsaid stays unsaid", async () => {
    let voice: ReturnType<typeof createVoiceStream> | null = null;
    const spokenTexts: string[] = [];
    server = createFaceServer({
      port: 0,
      onReply: () => {
        voice = createVoiceStream({
          speak: (t, id) => {
            spokenTexts.push(t);
            server?.broadcast({ type: "speak", text: t, utteranceId: id, ts: 1 });
          },
          newUtteranceId: () => `u${spokenTexts.length}`,
        });
        voice.onEvent({ type: "text_chunk", content: "I was going to say something," });
        voice.onEvent({ type: "text_chunk", content: " and then the rest of it" });
      },
      onInterrupt: () => {
        voice?.reset();
        server?.broadcast({ type: "cancel", utteranceId: "u1" });
      },
    });
    await server.ready();
    const c = await connect(server);
    client = c.ws;

    c.ws.send(JSON.stringify({ type: "reply", text: "go on" }));
    await settle();
    const before = spokenTexts.length;
    expect(before).toBe(1); // the clause she reached; the rest is still buffered

    c.ws.send(JSON.stringify({ type: "interrupt" }));
    await settle();

    expect(c.frames.some((f) => f.type === "cancel")).toBe(true);
    expect(spokenTexts.length).toBe(before);
    expect(spokenTexts.join(" ")).not.toContain("the rest of it");
  });

  it("carries presence up, which is the half that already worked", async () => {
    const seen: number[] = [];
    server = createFaceServer({ port: 0, onPresence: (s) => seen.push(s.idleSeconds) });
    await server.ready();
    const c = await connect(server);
    client = c.ws;
    c.ws.send(JSON.stringify({ type: "presence", signals: { idleSeconds: 4, frontAppFocused: true } }));
    await settle();
    expect(seen).toEqual([4]);
  });

  it("drops a malformed frame instead of trusting it", async () => {
    const heard: string[] = [];
    server = createFaceServer({ port: 0, onReply: (t) => heard.push(t) });
    await server.ready();
    const c = await connect(server);
    client = c.ws;
    c.ws.send("not json at all");
    c.ws.send(JSON.stringify({ type: "reply" })); // no text
    c.ws.send(JSON.stringify({ type: "nonsense" }));
    await settle();
    expect(heard).toEqual([]);
  });

  it("has no way to send audio, in either direction", async () => {
    // Audio never crosses: synthesis happens on the machine with the
    // speakers. `broadcastAudio` and the protocol's binary channel contradicted that and are
    // gone, so this is now a property of the code rather than a promise about it.
    server = createFaceServer({ port: 0 });
    await server.ready();
    expect((server as unknown as Record<string, unknown>)["broadcastAudio"]).toBeUndefined();

    // An inbound binary frame is ignored rather than parsed.
    const heard: string[] = [];
    await server.close();
    server = createFaceServer({ port: 0, onReply: (t) => heard.push(t) });
    await server.ready();
    const c = await connect(server);
    client = c.ws;
    c.ws.send(Buffer.from([0x00, 0x01, 0x02, 0x03]));
    await settle();
    expect(heard).toEqual([]);
  });
});

describe("a machine line in the room", () => {
  // When a turn breaks, the machine says so, never her. In the room the line is shown on the page
  // on a line of its own, never spoken; the mirror gets it as an ordinary message.
  it("reaches the page as a notice and the mirror as text, and nothing is spoken", async () => {
    const mirrored: string[] = [];
    server = createFaceServer({ port: 0, onReply: () => {} });
    await server.ready();
    const c = await connect(server);
    client = c.ws;

    const mirror: TurnChannel = {
      async send(t: string): Promise<number> { mirrored.push(t); return mirrored.length; },
      async edit(): Promise<void> {},
    };
    const channel = teeChannels(mirror, {
      send: async () => 0,
      edit: async () => {},
      notice: async (text) => { server?.broadcast({ type: "notice", text, ts: 1 }); },
    });
    await noticeOn(channel, "[system · turn] 这一回合断了（出错了），她没能回你。");
    await settle();

    const notices = c.frames.filter((f) => f.type === "notice");
    expect(notices).toEqual([{ type: "notice", text: "[system · turn] 这一回合断了（出错了），她没能回你。", ts: 1 }]);
    expect(c.frames.some((f) => f.type === "speak"), "the machine's line came out of her mouth").toBe(false);
    expect(mirrored).toEqual(["[system · turn] 这一回合断了（出错了），她没能回你。"]);
  });

  it("a channel with no notice of its own still delivers the line, by send", async () => {
    const sent: string[] = [];
    await noticeOn({ async send(t) { sent.push(t); return 1; }, async edit() {} }, "[system · turn] x");
    expect(sent).toEqual(["[system · turn] x"]);
  });

  it("the page shows it on its own line and keeps it until she speaks or he says something new", () => {
    const face = readFileSync(join(process.cwd(), "src/embodiment/client/face.js"), "utf8");
    const page = readFileSync(join(process.cwd(), "src/embodiment/client/index.html"), "utf8");
    expect(page).toContain('<div id="notice"></div>');
    expect(face).toContain('case "notice": showNotice(m.text); break;');
    expect(face).toContain('case "speak": clearNotice(); speak(m.text, m.utteranceId); break;');
    // Her caption changing is not the end of it: a moment of hers starting seconds after a broken
    // turn must not wipe the line before he has looked (the page would read as her ignoring him).
    expect(face).toContain('case "doing": document.getElementById("doing").textContent = m.what || ""; break;');
    // He says something new, typed or spoken: that is when the old line is over.
    expect(face.match(/send\((?:voice \? )?\{ type: "reply"[^\n]*\n\s*clearNotice\(\);/gu)?.length).toBe(2);
    // Exactly those three call sites (speak, typed, spoken), and nothing else ever clears it.
    expect(face.match(/clearNotice\(\);/gu)?.length).toBe(3);
    // Written as text, never as markup.
    expect(face).toContain("noticeEl.textContent = text");
    // And the daemon's room crash path no longer speaks a line in her voice.
    const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
    expect(daemon).not.toMatch(/broadcast\(\{ type: "speak", text: "刚才出了岔子/u);
    expect(daemon).toContain('noticeOn(roomChannel, machineNotice("出错了"))');
    // And the room's mouth really has the notice: without it the tee falls back to `send`, which
    // the mouth swallows, and the line would reach only his phone while the room stayed silent.
    expect(daemon).toContain('notice: async (text) => { faceServer?.broadcast({ type: "notice", text, ts: Date.now() }); },');
  });
});
