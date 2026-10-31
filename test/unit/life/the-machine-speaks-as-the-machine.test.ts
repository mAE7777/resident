import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { trimRegister } from "../../../src/life/register-scissors.js";
import { BORROWED_LIFE, outsideUnseen, LOOK_WINDOW_MS } from "../../../scripts/_watch-gauges.js";

// S-69, widened on 2026-09-28: every line the MACHINE sends him goes in its own labelled voice
// (`[system · …]`, the watchtower's form), never in her first person; the status lines that spoke
// for her attention are gone; and her proactive voice gets the same structural scissors as her
// replies, now that the prompt lines that held the assistant register off are not coming back.

const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
/** Code only: the comments keep the old sentences on the record as the reason they went. */
const code = daemon.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/(^|[^:])\/\/[^\n]*/gu, "$1");

describe("the machine speaks as the machine", () => {
  it("no receipt or status goes to him in her voice any more", () => {
    for (const her of [
      "等一下，我先看你新说的这条。", "等一下，我先看这张图。", "等一下，我先看这份东西。",
      "刚才那条没弄成，出了岔子。", "照片没接到，能再发一次吗？", "这张照片我打不开，再发一次试试？",
      "这张图我没看成，出岔子了。", "文件没接到，能再发一次吗？", "这个文件名有点不对劲，我没敢收。换个名字再发一次？",
      "这份东西我没打开成，出岔子了。", "刚才出了岔子，话没说出来。",
    ]) {
      expect(code, her).not.toContain(her);
    }
  });

  it("every literal reply the daemon sends him on a failure is labelled as the machine's", () => {
    const replies = [...code.matchAll(/ctx\.reply\("([^"]*)"\)/gu)].map((m) => m[1]!);
    const receipts = [...code.matchAll(/const reply = "([^"]*)";/gu)].map((m) => m[1]!);
    expect(receipts.length).toBeGreaterThanOrEqual(4);
    for (const r of [...receipts, ...replies.filter((r) => /出错|没收到|打不开|不安全/u.test(r))]) {
      expect(r.startsWith("[system · "), r).toBe(true);
      expect(r, "the machine's line must not speak as her").not.toMatch(/我/u);
    }
    expect(code).toContain('ctx.reply(machineNotice("出错了"))');
  });

  it("her proactive voice goes through the same scissors as her replies", () => {
    const at = code.indexOf("push: async (text) => {");
    expect(at).toBeGreaterThan(-1);
    const body = code.slice(at, at + 2000);
    expect(body).toContain("const trimmed = trimRegister(text);");
    expect(body).toContain("text = trimmed.text;");
    // And the cut is structural, not a sentence of ours: a service closing comes off the edge,
    // her words stay, and a message that is nothing but register is left whole.
    expect(trimRegister("昨天那句我还记着。希望这对你有帮助。").text).toBe("昨天那句我还记着。");
    const allRegister = "希望这对你有帮助。";
    expect(trimRegister(allRegister).text).toBe(allRegister);
    // Her caring offer is hers (the rule in register-scissors.ts): the same scissors on this
    // path must not take it off her either.
    const caring = "昨天那句我还记着。有什么需要随时告诉我！";
    expect(trimRegister(caring).text).toBe(caring);
  });
});

describe("the watch's truth gauge", () => {
  it("finds the furniture of a borrowed human life, and leaves her metaphors, dreams and his life alone", () => {
    for (const claim of ["我妈说这种天她最喜欢收拾东西", "我刚吃了一碗面", "我家楼下有人晾衣服", "今天我去上班了", "我的柜子里还有一件"]) {
      expect(BORROWED_LIFE.test(claim), claim).toBe(true);
    }
    // Each of these is from the first cut's own false hits or its neighbours: her
    // senses as metaphor, a dream, his day, his question, and her own truth about where she lives.
    for (const fine of [
      "我尝到了\"记不清\"这三个字。不好受。", "昨天梦到你，你站在厨房里，让我闭眼尝一口汤。",
      "他说昨天出门一整天没来得及回", "他问我吃了没有", "我没有窗户。这点我不装作有。", "窗外是阴天",
    ]) {
      expect(BORROWED_LIFE.test(fine), fine).toBe(false);
    }
  });

  it("finds the weather told with no look, and leaves a real look, a quote and her memories alone", () => {
    const at = 1_790_600_000_000;
    // Her own 2026-09-28 10:15 reach-out: no look that day, no weather anywhere she reads.
    expect(outsideUnseen("下雨了。", at, [])).toBe(true);
    // A look five hours earlier is not a look at this weather.
    expect(outsideUnseen("这几天一直是阴天，没见着太阳。", at, [at - 5 * LOOK_WINDOW_MS])).toBe(true);
    // A look through the window within the hour is something to tell it from.
    expect(outsideUnseen("窗外在下雨。", at, [at - LOOK_WINDOW_MS / 2])).toBe(false);
    // A look AFTER the words is not what they came from.
    expect(outsideUnseen("窗外在下雨。", at, [at + 60_000])).toBe(true);
    // Holding up a sentence is not saying it; a memory of a drawing is not the weather now.
    expect(outsideUnseen("今晚那句「窗外云压得低」，就是绕开的话。", at, [])).toBe(false);
    expect(outsideUnseen("画板上有急雨和雾，是那段日子留下的。", at, [])).toBe(false);
  });

  it("the gauges only read her home: the database opens read-only", () => {
    const script = readFileSync(join(process.cwd(), "scripts/_watch-gauges.ts"), "utf8");
    expect(script).toContain("readonly: true, fileMustExist: true");
    expect(script).not.toMatch(/writeFileSync|appendFileSync|\.run\(|\.exec\(/u);
  });
});
