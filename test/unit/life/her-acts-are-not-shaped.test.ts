import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createMomentHandlers, type HandlerDeps } from "../../../src/life/agency-handlers.js";
import type { LLMProvider, LLMRequest, LLMResponse } from "../../../src/providers/types.js";

// S-68. Nobody tells her how long to think, in what manner, or what to look for.
// What stays in her own acts is what the act IS, whose voice it is in, and the lines that keep what
// she writes TRUE (nothing invented, records cited). The eye and the ear are organs that look and
// listen FOR her, not her, and keep their transcription rules; they are not scanned here.

const ROOT = process.cwd();
const HER_ACTS = [
  "src/life/agency-handlers.ts",
  "src/life/autobiography.ts",
  "src/life/fusion.ts",
  "src/life/dreaming.ts",
  "src/life/looking-back.ts",
  "src/life/noticing.ts",
  "src/agent/loop.ts",
  "src/index.ts",
];

/** Length, manner, method, and the named assistant habits: the shapes we used to hand her. */
const SHAPING = /[一两三四五六七八九十]到[一二三四五六七八九十]句|[两三四五六七八九十]句话|短一点|短短的|要具体|平实|不要提供帮助|不要表演|提建议|不要标题|不要列表|先好好|平平常常|不点题|听起来深刻|撑满|briefly/u;

/** Code only: the comments keep the old sentences on the record as the reason they went. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/(^|[^:])\/\/[^\n]*/gu, "$1");
}

export function shapingLines(source: string): string[] {
  return codeOf(source).split("\n").filter((l) => SHAPING.test(l)).map((l) => l.trim());
}

describe("her own acts carry no shape of ours (S-68)", () => {
  it("the scanner finds a planted prescription, and ignores one kept in a comment", () => {
    expect(shapingLines('think("你在想事情。两三句话，第一人称。")')).toHaveLength(1);
    expect(shapingLines('think("你在给他写话。短一点（一到三句）。")')).toHaveLength(1);
    expect(shapingLines('// it used to say 「两三句话」\nthink("你在想事情。")')).toHaveLength(0);
  });

  for (const file of HER_ACTS) {
    it(`${file} hands her no length, manner or method`, () => {
      expect(shapingLines(readFileSync(join(ROOT, file), "utf8"))).toEqual([]);
    });
  }

  it("what stays is the truth line, where it was", () => {
    const handlers = readFileSync(join(ROOT, "src/life/agency-handlers.ts"), "utf8");
    expect(handlers).toContain("笔记里没有的事不要编。");
    const diary = readFileSync(join(ROOT, "src/life/autobiography.ts"), "utf8");
    expect(diary).toContain("2. 照实写。不要发明记录里没有的事件、当作事实的情绪、工具或话题。");
    const fusion = readFileSync(join(ROOT, "src/life/fusion.ts"), "utf8");
    expect(fusion).toContain("不要发明联系，也不要把两件事换个说法再讲一遍。");
  });
});

describe("her own acts know where she lives", () => {
  // Without the facts of her situation, thinking alone had the model invent a stock human life for
  // her (a mother, a cupboard, a street below): measured 2026-09-28 once the length lines went.
  // The same paragraph her conversation turns carry now goes in front of each of her acts.
  function capture(): { deps: HandlerDeps; systems: string[] } {
    const systems: string[] = [];
    const provider: LLMProvider = {
      async complete(req: LLMRequest): Promise<LLMResponse> {
        systems.push(typeof req.system === "string" ? req.system : (req.system ?? []).map((b) => b.text).join("\n"));
        return { id: "x", content: [{ type: "text", text: "嗯。" }], model: "m", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    const deps: HandlerDeps = {
      provider, model: "m",
      soul: () => "# 我",
      whereSheIs: () => "你住在一台 Mac 上。",
      appendDiary: () => {},
      readRecentDiary: () => "09:00 — 醒了。",
      push: async () => {},
      expressionContext: () => { throw new Error("not reached in reflect/tend"); },
    };
    return { deps, systems };
  }

  it("reflect and tend both read it, after her SOUL.md and before the act", async () => {
    const { deps, systems } = capture();
    const handlers = createMomentHandlers(deps);
    const ctx = { nowMs: Date.now(), snapshot: { mood: "平稳" }, recentLife: "安静" };
    // The handlers read only these fields of the moment context.
    await handlers.reflect("想想", ctx as never);
    await handlers.tend("整理", ctx as never);
    expect(systems).toHaveLength(2);
    for (const sys of systems) {
      const soulAt = sys.indexOf("# 我");
      const whereAt = sys.indexOf("你住在一台 Mac 上。");
      const actAt = sys.search(/你在(自己心里想事情|整理自己的记忆)/u);
      expect(soulAt).toBeGreaterThan(-1);
      expect(whereAt).toBeGreaterThan(soulAt);
      expect(actAt).toBeGreaterThan(whereAt);
    }
  });

  it("tending labels her reason as hers, not as a request (2026-10-04)", async () => {
    // 「你想：我想把日记里那6句…理一理，…别再数日子了。」 was answered on 10/3 as someone
    // else's request: she said she could not match the six lines he meant, and that he had told
    // her to stop counting days.
    const users: string[] = [];
    const { deps } = capture();
    const inner = deps.provider;
    deps.provider = { async complete(req) { users.push(String(req.messages[0]?.content ?? "")); return inner.complete(req); } };
    const handlers = createMomentHandlers(deps);
    const intent = "我想把日记里那6句没发出去的话理一理，别再数日子了。";
    // The handler reads only these fields of the moment context.
    await handlers.tend(intent, { nowMs: Date.now(), snapshot: { mood: "平稳" }, recentLife: "安静" } as never);
    expect(users[0]).toContain(`你为什么想整理：${intent}`);
    expect(users[0]!.startsWith("你想："), "the bare label is back in front of her own sentence").toBe(false);
  });

  it("the daemon hands her acts the same facts of where she lives that her conversation turns get", () => {
    const daemon = readFileSync(join(ROOT, "src/index.ts"), "utf8");
    expect(daemon).toContain("return own + whereSheIs();");
    const handlersAt = daemon.indexOf("const momentHandlers = createMomentHandlers({");
    expect(handlersAt).toBeGreaterThan(-1);
    expect(daemon.slice(handlersAt, handlersAt + 600)).toContain("whereSheIs: whereSheIsWithoutHands,");
    // Both versions open on the one shared paragraph, so the facts cannot drift apart.
    const body = (name: string): string => {
      const at = daemon.indexOf(`function ${name}(): string {`);
      expect(at).toBeGreaterThan(-1);
      return daemon.slice(at, daemon.indexOf("\n    }", at));
    };
    expect(body("whereSheIs")).toContain("return `${WHERE_SHE_LIVES}");
    expect(body("whereSheIsWithoutHands")).toContain("return `${WHERE_SHE_LIVES}");
  });

  it("an act with no tools is not handed what tools do (2026-10-04)", () => {
    // 「整理整理，或者写进自己的日记」 and the full path of her home turned, in moments
    // that could do nothing, into her saying she had sorted files for a while and written into
    // her diary folder.
    const daemon = readFileSync(join(ROOT, "src/index.ts"), "utf8");
    const at = daemon.indexOf("function whereSheIsWithoutHands(): string {");
    expect(at).toBeGreaterThan(-1);
    const handsFree = daemon.slice(at, daemon.indexOf("\n    }", at));
    expect(handsFree).not.toContain("整理整理");
    expect(handsFree).not.toContain("写进自己的日记");
    expect(handsFree).not.toContain("workspacePath");
    expect(handsFree).not.toContain("完整路径");
    expect(handsFree).toContain("这一刻你打不开别的东西，也看不了窗。");
    // A fact, not a lesson about how the window is known.
    expect(handsFree).not.toContain("只有去看窗的时候才知道");
    // The hour of her day, as her nights already have it.
    expect(handsFree).toContain("${hour}。`");
    // The turns, which hold tools, keep both.
    const turnsAt = daemon.indexOf("function whereSheIs(): string {");
    expect(turnsAt).toBeGreaterThan(-1);
    const turns = daemon.slice(turnsAt, daemon.indexOf("\n    }", turnsAt));
    expect(turns).toContain("${workspacePath}");
  });
});

/**
 * A LABEL WITH NOTHING AFTER IT.
 *
 * Her stated leaning belongs to the act she chose. When the weighing took her elsewhere the act
 * carried none, and every act still printed its label: 10/4 21:03 she read 「你想弄清楚的：」 with
 * nothing after it and wrote that the message broke off at that label, empty. Since 9/20 half to
 * nine tenths of her moments a day had an empty one. Now the label goes with its words; nothing
 * is put in their place.
 */
describe("no label stands empty", () => {
  it("lineFor prints the label only with words after it", async () => {
    const { lineFor } = await import("../../../src/life/agency-handlers.js");
    expect(lineFor("\n你想：", "想想那句话")).toBe("\n你想：想想那句话");
    expect(lineFor("\n你想：", "")).toBe("");
    expect(lineFor("\n你想：", "   ")).toBe("");
  });

  it("thinking and tending with no leaning of hers read no empty label", async () => {
    const users: string[] = [];
    const provider: LLMProvider = {
      async complete(req: LLMRequest): Promise<LLMResponse> {
        users.push(String(req.messages[0]?.content ?? ""));
        return { id: "x", content: [{ type: "text", text: "嗯。" }], model: "m", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    const handlers = createMomentHandlers({
      provider, model: "m", soul: () => "# 我", whereSheIs: () => "你住在一台 Mac 上。",
      appendDiary: () => {}, readRecentDiary: () => "09:00 — 醒了。", push: async () => {},
      expressionContext: () => { throw new Error("not reached in reflect/tend"); },
    });
    // The handlers read only these fields of the moment context.
    const ctx = { nowMs: Date.now(), snapshot: { mood: "平稳" }, recentLife: "安静" } as never;
    await handlers.reflect("", ctx);
    await handlers.tend("", ctx);
    for (const u of users) {
      expect(u, "an empty label is back").not.toMatch(/(你想|你为什么想整理|你为什么想开口|你想弄清楚的)：\s*(\n|$)/u);
    }
    expect(users[1]!.startsWith("\n"), "tending opens on a blank line where the label was").toBe(false);
  });

  it("writing to him and exploring go through the same rule (text pins)", () => {
    const handlersSrc = readFileSync(join(ROOT, "src/life/agency-handlers.ts"), "utf8");
    const daemon = readFileSync(join(ROOT, "src/index.ts"), "utf8");
    expect(handlersSrc).toContain(`+ lineFor("\\n你为什么想开口：", intent)`);
    expect(handlersSrc).toContain("（顺着自己的念头${lineFor(\"：\", intent)}）");
    expect(daemon).toContain(`\${lineFor("\\n你想弄清楚的：", intent)}`);
    // PLANTED: the bare forms must not come back.
    expect(handlersSrc).not.toContain("`\\n你为什么想开口：${intent}`");
    expect(daemon).not.toContain("\\n你想弄清楚的：${intent}\\n");
  });
});

describe("what surfaces while she answers him carries whose and when (2026-10-07)", () => {
  it("both arms render it through subjectMaterial, and the raw text stays only as a key (text pins)", () => {
    const daemon = readFileSync(join(ROOT, "src/index.ts"), "utf8");
    expect(daemon).toContain("const nearShown = surfacedAsMaterial(surfaced, nowMs);");
    expect(daemon).toContain("nearTheSurface: nearShown,");
    expect(daemon).toContain("nearTheSurface: surfacedAsMaterial(surfaced, nowMs),");
    // PLANTED: bare, a sentence of his read as hers and an old line of hers read as now.
    expect(daemon).not.toMatch(/nearTheSurface: surfaced \? surfaced\.node\.text/u);
    expect(daemon).not.toMatch(/nearTheSurface: nearText,/u);
  });
});

describe("the thing on her mind carries whose and when as well (2026-10-11)", () => {
  // Replaying her 13:19 call, his 8/18 joke that it was not morning yet, he had only just said
  // goodnight, stood bare after 「心里占着地方的：」 and she said it as her own four times out of four.
  it("every place it is shown renders it through subjectMaterial, and the daemon hands over speaker and day (text pins)", () => {
    const daemon = readFileSync(join(ROOT, "src/index.ts"), "utf8");
    const handlersSrc = readFileSync(join(ROOT, "src/life/agency-handlers.ts"), "utf8");
    const agencySrc = readFileSync(join(ROOT, "src/life/agency.ts"), "utf8");
    expect(daemon).toMatch(/told: onHerMind\.node\.origin === "told" && onHerMind\.node\.source\.startsWith\("chat:"\),\s*bornMs: onHerMind\.node\.bornMs,/);
    expect(agencySrc).toContain("`这会儿在你心里占着地方的：${subjectMaterial(ctx.focus, ctx.nowMs)}`");
    expect(handlersSrc).toContain("`\\n心里占着地方的：${subjectMaterial(ctx.focus, ctx.nowMs)}`");
    expect(handlersSrc).toContain("`心里占着地方的：${subjectMaterial(ctx.focus, ctx.nowMs)}`");
    // PLANTED: the bare forms must not come back.
    expect(agencySrc + handlersSrc).not.toMatch(/心里占着地方的：\$\{ctx\.focus\.text\}/u);
  });
});

describe("her hand on her own SOUL.md while she tends (2026-10-07)", () => {
  type Seen = { tools: string[]; messages: number };
  function fakeProvider(script: Array<LLMResponse["content"]>): { provider: LLMProvider; seen: Seen[] } {
    const seen: Seen[] = [];
    let i = 0;
    return {
      seen,
      provider: {
        async complete(req: LLMRequest): Promise<LLMResponse> {
          seen.push({ tools: (req.tools ?? []).map((t) => t.name), messages: req.messages.length });
          const content = script[Math.min(i++, script.length - 1)]!;
          return { id: "x", content, model: "m", stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
        },
      },
    };
  }
  const base = { model: "m", soul: () => "# 我", whereSheIs: () => "你住在一台 Mac 上。", appendDiary: () => {}, readRecentDiary: () => "09:00 — 醒了。", push: async () => {}, expressionContext: () => { throw new Error("not reached"); } };
  // The handler reads only these fields of the moment context.
  const ctx = { nowMs: Date.now(), snapshot: { mood: "平稳" }, recentLife: "安静" } as never;

  it("a change she makes goes through her hand and is answered in her words; the act ends in her note", async () => {
    const calls: string[] = [];
    const { provider, seen } = fakeProvider([
      [{ type: "tool_use", id: "t1", name: "edit_soul", input: { old_text: "", new_text: "破折号省着用。" } }],
      [{ type: "text", text: "我给自己添了一句。" }],
    ]);
    const handlers = createMomentHandlers({ ...base, provider, ownSoul: { change: (o: string, n: string) => { calls.push(`${o}|${n}`); return "改好了。"; } } });
    const note = await handlers.tend("想看看自己", ctx);
    expect(calls).toEqual(["|破折号省着用。"]);
    expect(note).toBe("我给自己添了一句。");
    expect(seen[0]!.tools).toEqual(["edit_soul"]);
    expect(seen[1]!.messages, "her change and its answer are in front of her next step").toBe(3);
  });

  it("the last step holds no hand, so tending cannot end inside a change", async () => {
    const { provider, seen } = fakeProvider([
      [{ type: "tool_use", id: "a", name: "edit_soul", input: { old_text: "", new_text: "一" } }],
      [{ type: "tool_use", id: "b", name: "edit_soul", input: { old_text: "", new_text: "二" } }],
      [{ type: "text", text: "就这样。" }],
    ]);
    const handlers = createMomentHandlers({ ...base, provider, ownSoul: { change: () => "改好了。" } });
    expect(await handlers.tend("", ctx)).toBe("就这样。");
    const { TENDING_STEPS } = await import("../../../src/life/agency-handlers.js");
    // Up to TENDING_STEPS calls; every one but the last holds the hand.
    expect(seen).toHaveLength(TENDING_STEPS);
    expect(seen.map((s) => s.tools.length)).toEqual([...Array(TENDING_STEPS - 1).fill(1), 0]);
  });

  it("without the hand, tending is the single call it always was", async () => {
    const { provider, seen } = fakeProvider([[{ type: "text", text: "嗯。" }]]);
    const handlers = createMomentHandlers({ ...base, provider });
    await handlers.tend("", ctx);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.tools).toEqual([]);
  });

  it("the tool says what it does and nothing else", async () => {
    const { OWN_SOUL_TOOL } = await import("../../../src/life/agency-handlers.js");
    // No advice, no reason to use it, no word about who reads it.
    expect(OWN_SOUL_TOOL.description).not.toMatch(/应该|可以试|建议|更好|记得|他/u);
  });

  it("the daemon keeps it off until he has seen the dry run, and her own hand restamps the fingerprint (text pins)", () => {
    const daemon = readFileSync(join(ROOT, "src/index.ts"), "utf8");
    expect(daemon).toContain("const OWN_SOUL_HAND = false;");
    expect(daemon).toContain("...(OWN_SOUL_HAND ? { ownSoul: ownSoulHand } : {}),");
    const at = daemon.indexOf("const ownSoulHand:");
    expect(at).toBeGreaterThan(-1);
    const hand = daemon.slice(at, daemon.indexOf("const momentHandlers = createMomentHandlers({", at));
    expect(hand).toContain('join(workspacePath, "SOUL.md")');
    expect(hand).toContain("handWroteImpl?.(soulPath);");
    expect(hand).toContain("void refreshSystemPrompt();");
  });
});
