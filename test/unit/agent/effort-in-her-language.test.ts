// The standing language guard over the ONE matcher that still reads his words: the task-type
// signal table (`classifyTaskProfile`, the observation takes-it-on competes against).
//
// The file this used to test is gone: `assessComplexity` graded his sentence into a tier
// with ~40 regexes, five of its six scorers were structurally blind to Chinese, and the
// whole ladder plus its bilingual repair left in an earlier cleanup. Depth is not a
// reading of his words at all anymore (`depthFromHer` sees only her state and the work
// floor), so "does her language land the same tier" is no longer a question the code can
// even ask. What CAN still rot is the surviving observation table drifting English-only,
// which would make Chinese work invisible to the takes-it-on competition. Pinned here.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { classifyTaskProfile, depthFromHer } from "../../../src/agent/effort-scaling.js";
import { createStream } from "../../../src/life/soft-choice.js";

const SRC = readFileSync(new URL("../../../src/agent/effort-scaling.ts", import.meta.url), "utf8");

describe("the same work proposes the same shape in either language", () => {
  const pairs: Array<[string, string, string]> = [
    ["debug this function, it throws on empty input", "这个函数一传空值就报错，帮我调试一下", "code"],
    ["download the subtitles from this video", "帮我把这个视频的字幕转写出来", "media"],
    ["schedule a daily reminder to drink water", "每天都提醒我喝水", "automation"],
  ];
  for (const [en, zh, domain] of pairs) {
    it(`${domain}: both scripts classify alike`, () => {
      expect(classifyTaskProfile(en).primary, en).toBe(domain);
      expect(classifyTaskProfile(zh).primary, zh).toBe(domain);
    });
  }

  it("ordinary Chinese conversation is not a work proposal", () => {
    for (const t of ["在吗", "今天有点累", "早", "陪我聊聊天吧"]) {
      expect(classifyTaskProfile(t).primary, t).toBe("general");
    }
  });
});

describe("the rule, structurally", () => {
  it("every task-type signal row carries a Chinese side (or is script-neutral like a URL)", () => {
    // The English-only failure mode was never a wrong answer; it was a table that could not SEE her.
    // `\b` is ASCII-only in JS, so a ZH side must live outside the \b groups as a bare
    // substring alternative. A row whose pattern contains neither a CJK character nor a
    // script-neutral anchor (URL/domain/file-extension syntax) has gone English-only again.
    const tableStart = SRC.indexOf("const TASK_TYPE_SIGNALS");
    const tableEnd = SRC.indexOf("];", tableStart);
    expect(tableStart).toBeGreaterThan(-1);
    const rows = [...SRC.slice(tableStart, tableEnd).matchAll(/pattern: \/(.+?)\/[a-z]*\s*\}/gu)];
    expect(rows.length).toBeGreaterThan(10);
    // Loanwords count as neutral: she says git/CI/docker in Latin script exactly as he does.
    const scriptNeutral = /https?|youtube|bilibili|b23|\\\.\w|github|git|\bci\b|docker|npm|pnpm|localhost/iu;
    for (const m of rows) {
      const body = m[1] ?? "";
      const hasCjk = /[一-鿿]/u.test(body);
      expect(hasCjk || scriptNeutral.test(body), `English-only signal row: /${body.slice(0, 60)}/`).toBe(true);
    }
  });

  it("depth cannot read his words in any language: depthFromHer takes no text at all", () => {
    // The structural end of the English-only class for effort: a matcher cannot be biased against her
    // language if the depth decision has no message parameter to match on.
    const sig = SRC.slice(SRC.indexOf("export function depthFromHer"), SRC.indexOf("{", SRC.indexOf("export function depthFromHer")));
    expect(sig.includes("message")).toBe(false);
    expect(sig.includes("string")).toBe(false);
    // And behaviorally: identical state, identical stream, any language around it, same depth.
    const s1 = createStream(7);
    const s2 = createStream(7);
    const her = { stirred: true, reserve: 0.8, aliveness: 0.6 };
    expect(depthFromHer(her, "simple", () => s1.next())).toBe(depthFromHer(her, "simple", () => s2.next()));
  });
});
