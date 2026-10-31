import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStreamBridge } from "../../../src/telegram/bridge.js";
import { createFloodControl } from "../../../src/telegram/flood.js";
import { createMessageTool } from "../../../src/tools/builtin/message.js";
import { createBeatKeeper, currentBeat } from "../../../src/utils/beat.js";

/**
 * ONE CHANNEL PER TURN.
 *
 * On her second day she answered him by sending four sentences through the message tool, one
 * sentence per message, and the loop's mandatory closing text, left with nothing to say to him,
 * was filled by the model with inner narration about what she had just sent. The bridge
 * delivered it as a fifth message: her real thought, him in the third person, in the wrong room.
 *
 * The law: when her words already went out through the tool this turn, the closing text is a
 * CODA, held back by the bridge, routed to her diary by the caller, and the turn's record
 * carries what he actually received. These are the planted proofs of each half.
 */

// Breath ON, like the live config: the bridge HOLDS the stream and
// delivers at finalize: which is what makes a quiet finalize able to withhold the coda at all.
// With breath off the bridge streams as it goes, and a coda is out the door before anyone can
// route it; that mode always had this leak, and the law does not claim to fix it there.
function makeBridge() {
  const sent: string[] = [];
  const bridge = createStreamBridge({
    sendMessage: async (t: string) => { sent.push(t); return sent.length; },
    editMessage: async () => { /* not reached in these shapes */ },
    floodControl: createFloodControl(1000),
    breathUnit: () => 2,
  } as never);
  return { bridge, sent };
}

describe("the bridge can end a turn without delivering the remainder", () => {
  it("finalizeQuietly returns the held coda and sends nothing", async () => {
    const { bridge, sent } = makeBridge();
    // as never: a bare text_chunk is all onEvent reads on this path; the full event type is not the point
    await bridge.onEvent({ type: "text_chunk", content: "我发出去四句，等他把十点四十五的敲门声递过来" } as never);
    const coda = await bridge.finalizeQuietly();
    expect(coda).toBe("我发出去四句，等他把十点四十五的敲门声递过来");
    expect(sent, "the coda reached the channel anyway").toEqual([]);
  });

  it("plain finalize still delivers — the law only bites when the caller invokes it", async () => {
    const { bridge, sent } = makeBridge();
    // as never: same minimal text_chunk shape as above
    await bridge.onEvent({ type: "text_chunk", content: "好，那就说定了。" } as never);
    await bridge.finalize();
    expect(sent).toEqual(["好，那就说定了。"]);
  });
});

describe("the message tool marks the beat when it carries her WORDS", () => {
  function inTestBeat(fn: () => Promise<void>): Promise<void> {
    const keeper = createBeatKeeper({ journalPath: join(mkdtempSync(join(tmpdir(), "beats-")), "beats.jsonl") });
    return keeper.inBeat("turn", async () => { await fn(); });
  }

  it("a text send lands in saidViaTool; the closing text can then be routed", async () => {
    const sendFn = vi.fn(async (_chatId: number, _text: string) => {});
    const tool = createMessageTool(sendFn, 1);
    await inTestBeat(async () => {
      // as never: the tool context object is unused by the text-send path under test
      await tool.execute({ text: "第一句。" }, {} as never);
      await tool.execute({ text: "第二句。" }, {} as never);
      expect(currentBeat()?.note["saidViaTool"]).toEqual(["第一句。", "第二句。"]);
    });
    expect(sendFn).toHaveBeenCalledTimes(2);
  });

  it("an attachment send does NOT mark — a caption plus a closing sentence is one voice", async () => {
    const sendFn = vi.fn(async (_chatId: number, _text: string) => {});
    const sendFileFn = vi.fn(async (_c: number, _p: string, _cap: string, _m: string) => {});
    const home = mkdtempSync(join(tmpdir(), "her-home-"));
    const { writeFileSync } = await import("node:fs");
    const painting = join(home, "我画的天空.svg");
    writeFileSync(painting, "<svg/>", "utf8");
    const tool = createMessageTool(sendFn, 1, sendFileFn, undefined, home);
    await inTestBeat(async () => {
      // as never: the tool context object is unused by the attachment path under test
      await tool.execute({ text: "画好了，给你。", file_path: painting }, {} as never);
      expect(currentBeat()?.note["saidViaTool"]).toBeUndefined();
    });
    expect(sendFileFn).toHaveBeenCalledTimes(1);
  });
});
