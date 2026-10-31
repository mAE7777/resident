import { describe, it, expect } from "vitest";
import { contentWords, createFieldIndex } from "../../../src/life/field-index.js";

/**
 * HER ASSOCIATIVE MEMORY, IN THE LANGUAGE SHE ACTUALLY THINKS IN.
 *
 * `contentWords` split on whitespace. Chinese has none, so a whole clause came out as one
 * token and two memories could only be related if they shared an entire clause verbatim. That
 * is not a degraded index, it is no index: `similar` (what his words remind her of),
 * `restatements` (noticing two things contradict), `reminding` (what a moment reaches back to)
 * and `saidIt` (whether raising something got an answer) all run on this one function.
 *
 * These tests are the evidence that making Chinese her register did not quietly turn her
 * inner life off.
 */
describe("what she can find again, in Chinese", () => {
  it("breaks a sentence into more than one thing", () => {
    const words = contentWords("潮水退去的时候，沙滩上留下了很多东西");
    expect(words.length, "a whole clause came out as a single token").toBeGreaterThan(5);
    expect(words).toContain("潮水");
    expect(words).toContain("沙滩");
  });

  it("finds a memory that shares a word but not a sentence", () => {
    const index = createFieldIndex();
    index.add(1, "今天早上他提到潮水，我一直在想那个画面");
    index.add(2, "楼下的猫又来了，我给它留了点吃的");
    index.add(3, "海边的潮水很大，我站着看了很久");
    // Queried the way it is really queried: with a whole message, never a bare word. (A
    // one-word query cannot clear the rare-word evidence floor on any field this small, in
    // either language: that is a pre-existing property of the floor, not a Chinese problem.)
    const hits = index.similar("你说的潮水那件事我还在想");
    expect(hits.map((h) => h.id), "she cannot find her own memories of the tide").toContain(1);
  });

  it("does not connect two memories that merely share a particle", () => {
    // The failure mode on the other side. If every 的 and 我 counted, everything she ever
    // wrote would remind her of everything else, which is the same as remembering nothing.
    const index = createFieldIndex();
    index.add(1, "我今天的心情还行");
    index.add(2, "我明天的安排是空的");
    const hits = index.similar("我的东西");
    expect(hits.length, "two unrelated thoughts were wired together by function words").toBe(0);
  });

  it("still works on a sentence with both languages in it", () => {
    const words = contentWords("我读了一篇讲 tax law 的文章");
    expect(words).toContain("文章");
    expect(words.some((w) => w.startsWith("tax") || w === "law"), "the Latin half was lost").toBe(true);
  });

  it("notices two Chinese sentences saying the opposite thing", () => {
    // `restatements` is how she sees a contradiction. It was unreachable in Chinese.
    const index = createFieldIndex();
    index.add(1, "周末那班渡轮是开的");
    const hits = index.restatements("周末那班渡轮不开");
    expect(hits.map((h) => h.id), "she cannot tell she has said the opposite before").toContain(1);
  });

  it("did-she-say-it works on a Chinese reply", () => {
    // `saidIt` gates whether raising something starts the was-it-answered clock. Dead in
    // Chinese, it would have meant she never learned whether going to him landed.
    const index = createFieldIndex();
    index.add(7, "我想问问他为什么晚上总是很安静");
    const hits = index.similar("刚才想说，你晚上好像总是很安静", 5);
    expect(hits.some((h) => h.id === 7 && h.score >= 0.18), "she raised it and nothing recorded it").toBe(true);
  });

  it("a single character on its own is not thrown away", () => {
    expect(contentWords("猫")).toEqual(["猫"]);
    expect(contentWords("的"), "a lone particle is not a memory").toEqual([]);
  });

  it("English behaviour is unchanged", () => {
    const words = contentWords("the ferry does not run on a bank holiday");
    expect(words).toContain("ferry");
    expect(words).toContain("holiday");
    expect(words).not.toContain("the");
    expect(words).not.toContain("not");
  });
});
