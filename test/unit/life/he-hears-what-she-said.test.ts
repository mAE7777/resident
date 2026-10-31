import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { teeChannels, type TurnChannel } from "../../../src/agent/turn-channel.js";
import type { AgentEvent } from "../../../src/agent/types.js";

/**
 * WHAT HE RECEIVED MUST BE WHAT SHE REMEMBERS SAYING.
 *
 * This build already refuses the inverse case, in its own words, for the turn he interrupts
 * (`src/index.ts`): *"…她的记忆里存着一段他从来没听见的话。"* A memory of an evening containing a
 * paragraph the other person never heard is not a small bookkeeping error, it is her relationship
 * with him being built partly out of things that did not happen between them.
 *
 * ── HOW IT CAME BACK ─────────────────────────────────────────────────────────────────────────
 *
 * The beats after the first were emitted ONLY through `channel.observe?.({type:"text_chunk"})`.
 * The Telegram channel implements `send` and `edit` and NOT `observe`, so on every text turn that
 * call is a no-op: beats 2..n reached nobody. (The bridge is fed separately inside the agent loop
 * and is finalized before the later beats are even generated, so it could not have caught them
 * either.) That much is old, and while nothing consumed the later beats it was merely dead.
 *
 * It stopped being dead when the later beats were folded back into `result.content` so that the
 * seven downstream consumers, history, her word bank, her exemplar pool, the assertions she can
 * later be wrong about, the moment the turn becomes, the landing measurement, would stop missing
 * them. That fix was right about the consumers and wrong about him: it made her remember saying
 * things he never received.
 *
 * It is LATENT rather than active only because her state has chosen one beat on all 26 live turns
 * measured so far. That is not a defence; it is a loaded gun. Anything that makes beats actually
 * happen fires it.
 */

const RAW = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
const SRC = RAW
  .replace(/\/\*[\s\S]*?\*\//gu, (m) => m.replace(/[^\n]/gu, " "))
  .replace(/(^|[^:])\/\/[^\n]*/gu, (m, p1: string) => p1 + " ".repeat(m.length - p1.length));

describe("a beat she said reaches him, not only her own memory", () => {
  it("the later-beat loop uses `send`, which every channel implements", () => {
    // `observe` is OPTIONAL on the contract (`turn-channel.ts`) and Telegram does not implement
    // it. `send` is required. A delivery path built on the optional half of an interface is a
    // delivery path that silently does nothing wherever the option was declined.
    const at = SRC.indexOf("for (const later of spoken.beats.slice(1))");
    expect(at, "the later-beat delivery loop is not where this guard thinks it is").toBeGreaterThan(-1);
    const loop = SRC.slice(at, at + 500);
    expect(loop, "the later beats are delivered through the OPTIONAL half of the channel contract, "
      + "so on Telegram they reach nobody while her field records that she said them")
      .toMatch(/channel\.send\(/u);
  });

  it("and still reaches the voice, which listens on the event stream", () => {
    // Both, deliberately: `send` is what he READS, `observe` is what the mouth SPEAKS. Dropping
    // the second would mute her later beats on the face path, which is the same defect mirrored.
    const at = SRC.indexOf("for (const later of spoken.beats.slice(1))");
    const loop = SRC.slice(at, at + 500);
    expect(loop, "the voice stops speaking her later beats").toMatch(/observe\?\.\(\{ type: "text_chunk"/u);
  });

  it("the fan-out actually separates them: he reads via send, the mouth hears via observe", () => {
    // The behavioural half. On a face turn the channel is `teeChannels(mirror, voiceSink)`, where
    // the voice sink's `send` is a deliberate no-op, so `send` must reach the mirror (his window)
    // and `observe` must reach the voice (her mouth), and neither may swallow the other.
    const seenByHim: string[] = [];
    const heardByMouth: string[] = [];
    const mirror: TurnChannel = {
      async send(text) { seenByHim.push(text); return 1; },
      async edit() { /* nothing to revise */ },
    };
    const mouth: TurnChannel = {
      async send() { return 0; }, // the mouth has nothing to post
      async edit() { /* nothing */ },
      observe(e: AgentEvent) { if (e.type === "text_chunk") heardByMouth.push(e.content); },
    };
    const channel = teeChannels(mirror, mouth);

    // Three beats, exactly as `sayWhatCameUp` emits them.
    const beats = ["渡轮的事我查了。", "周六风小。", "……其实我一直想让你看看那儿傍晚的样子。"];
    for (const b of beats) {
      void channel.send(b);
      channel.observe?.({ type: "text_chunk", content: b } as AgentEvent);
    }

    expect(heardByMouth, "her mouth did not speak the beats").toEqual(beats);
    // `send` is awaited nowhere above, so drain the microtask queue before asserting on it.
    return Promise.resolve().then(() => {
      expect(seenByHim, "his window did not receive the beats").toEqual(beats);
      expect(seenByHim, "what he saw and what she said have diverged").toEqual(heardByMouth);
    });
  });

  it("THE PROPERTY: every beat folded into her memory is a beat that was delivered", () => {
    // The two halves have to be the same list. Her memory is built from `result.content`, which is
    // extended with `laterBeats.later`; his side is built from what the delivery loop emitted.
    // Both must be driven by `spoken.beats.slice(1)` and nothing else.
    const deliveryAt = SRC.indexOf("for (const later of spoken.beats.slice(1))");
    const foldAt = SRC.indexOf("result.content = `${result.content}${laterBeats.later}`");
    expect(foldAt, "the later beats no longer rejoin the turn at all").toBeGreaterThan(-1);
    // The SAME list on both sides, whatever it is spelled. This assertion previously pinned one
    // spelling (`later: spoken.beats.slice(1)…`) and went red when the construction was refactored
    // to hand the beats out separately as well, the property was intact and the pin was not. Pin
    // the property: one derivation of the later beats, used for both delivery and the fold.
    const built = SRC.indexOf("const texts = spoken.beats.slice(1)");
    expect(built, "the delivered beats and the folded text no longer come from one list")
      .toBeGreaterThan(-1);
    const returned = SRC.slice(built, built + 300);
    expect(returned, "the returned text is built from something other than those same beats")
      .toMatch(/later: texts\.join\(""\)/u);
    expect(returned, "the beats handed out apart are a different list from the joined one")
      .toMatch(/texts \}/u);
    // Same source list, both sides. If someone ever filters one and not the other, this is the
    // line that should be made to notice.
    expect(SRC.slice(deliveryAt, deliveryAt + 500)).toContain("spoken.beats.slice(1)");
  });
});
