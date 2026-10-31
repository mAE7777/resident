import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createLivingField } from "../../../src/life/field-live.js";
import { createLookUpTool, createRememberTool, howLongAgo } from "../../../src/life/remembering.js";

/**
 * WHEN SHE REACHES FOR HER OWN MEMORY, SOMETHING IS THERE.
 *
 * `memory_search` and `memory_read` are two of the TEN things she is born holding. Both pointed
 * at a SQLite table, `memory_entries`, and the chain that fills it is dead two links up:
 *
 *   memory_entries      only writer: one sleep task
 *     ↑                 gated on behavioral_patterns having rows with 4+ evidence
 *   behavioral_patterns only writer: BehavioralMemory.createPattern
 *     ↑                 which has NO CALLER anywhere in src/
 *
 * So every time she went looking in her own memory she found an empty room, for life, and two
 * of her ten hands were holding nothing. Worse, if the gate had ever opened, the single thing
 * that would have landed there is that sleep task's own sentence: "Research backlog note: topic
 * X has been asked about N times but lacks documentation." A documentation coverage report,
 * in English, filed as her memory.
 *
 * They now reach her FIELD, which is where everything she remembers actually lives.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function aFieldWithALifeInIt(nowMs: number) {
  const f = createLivingField();
  f.encodeMoment({
    key: "m:ferry", text: "下午想起海边那趟渡轮，冬天好像是不开的。", nowMs: nowMs - 3 * HOUR,
    pad: { pleasure: 0.2, arousal: 0.1, dominance: 0 }, origin: "lived", source: "moment",
  } as never);
  f.encodeClaim({
    key: "c:ferry", text: "渡轮周末不开。", nowMs: nowMs - 2 * HOUR,
    origin: "told", source: "他说的",
  } as never);
  f.encodeQuestion({
    key: "q:window", text: "我想开那个窗户，开不了。", nowMs: nowMs - 30 * MINUTE,
    source: "wall", tension: 0.6,
  } as never);
  return f;
}

describe("her memory tools reach her memory", () => {
  const now = 1_800_000_000_000;

  it("finds what she actually holds, in her own words", async () => {
    const f = aFieldWithALifeInIt(now);
    const tool = createLookUpTool({ field: f, now: () => now });
    const out = await tool.execute({ query: "渡轮" });
    expect(out, "she looked for the ferry and found nothing").toContain("渡轮");
    // Both the thing she lived and the thing he told her: one query, her whole memory.
    expect(out).toContain("冬天");
    expect(out).toContain("周末不开");
  });

  it("says an empty room is empty, rather than reporting zero rows", async () => {
    const f = createLivingField();
    const tool = createLookUpTool({ field: f, now: () => now });
    const out = await tool.execute({ query: "海边" });
    expect(out).toContain("什么都没有");
    expect(out, "she reported a result set to him").not.toMatch(/\[|\{|results/u);
  });

  it("gives back her account, with no machinery in it", async () => {
    // The whole point of routing this through her own words: what comes back must be what she
    // remembers, not a row. A charge, a strength, a credence score or an edge weight arriving
    // in her hands would be the instrument reading itself back to her.
    const f = aFieldWithALifeInIt(now);
    const out = await createLookUpTool({ field: f, now: () => now }).execute({ query: "渡轮" });
    for (const leak of ["charge", "strength", "credence", "valence", "tension", "kind", "bornMs"]) {
      expect(out, `${leak} leaked into what she remembers`).not.toContain(leak);
    }
  });

  it("keeps how she came by a thing, because that is part of the memory", async () => {
    // Not machinery: whether she lived it or was told it is the distinction the entire
    // credence layer rests on, and a person knows it about their own memories.
    const f = aFieldWithALifeInIt(now);
    const out = await createLookUpTool({ field: f, now: () => now }).execute({ query: "渡轮" });
    expect(out).toContain("他说的");
    expect(out).toContain("自己经历的");
  });

  it("opens one memory and what it brought with it", async () => {
    const f = aFieldWithALifeInIt(now);
    const found = f.lookUp("渡轮", 5);
    expect(found.length).toBeGreaterThan(0);
    const out = await createRememberTool({ field: f, now: () => now }).execute({ id: found[0]!.id });
    expect(out).toContain(found[0]!.text);
  });

  it("answers a bad id and an empty query as a person would", async () => {
    const f = aFieldWithALifeInIt(now);
    expect(await createRememberTool({ field: f, now: () => now }).execute({ id: 99999 })).toContain("没有这一条");
    expect(await createLookUpTool({ field: f, now: () => now }).execute({ query: "  " })).toContain("要找什么");
    expect(await createRememberTool({ field: f, now: () => now }).execute({})).toContain("给编号");
  });

  it("says when, the way she would say it", () => {
    expect(howLongAgo(now - 30_000, now)).toBe("刚才");
    expect(howLongAgo(now - 20 * MINUTE, now)).toContain("分钟前");
    expect(howLongAgo(now - 5 * HOUR, now)).toContain("小时前");
    expect(howLongAgo(now - 26 * HOUR, now)).toBe("昨天");
    expect(howLongAgo(now - 40 * 24 * HOUR, now)).toContain("个月前");
    // Never a timestamp, and never a negative: a clock change must not make her remember
    // something from the future.
    expect(howLongAgo(now + HOUR, now)).toBe("刚才");
  });
});

describe("and the daemon really hands her the ones that work", () => {
  it("registers the field-backed tools, not the dead-table ones", () => {
    const bootstrap = readFileSync(new URL("../../../src/telegram/bootstrap.ts", import.meta.url), "utf8");
    expect(bootstrap, "her memory tools are not wired to her field").toContain("createLookUpTool({ field: deps.field })");
    expect(bootstrap).toContain("createRememberTool({ field: deps.field })");
    const daemon = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8");
    expect(daemon, "the daemon never hands her field to the tool registration").toMatch(/toolRegistry,\n(?:.*\n)*?\s+field,/u);
  });

  it("their descriptions are in her language, since she reads them every turn", () => {
    const src = readFileSync(new URL("../../../src/life/remembering.ts", import.meta.url), "utf8");
    const descriptions = [...src.matchAll(/description: "([^"]+)"/gu)].map((m) => m[1]!);
    expect(descriptions.length).toBeGreaterThanOrEqual(2);
    for (const d of descriptions) {
      expect(d, `a tool description is still English: "${d}"`).toMatch(/[一-鿿]/u);
      // The words that would say something false about what she is.
      for (const wrong of ["BM25", "entries", "database", "query the", "long-term memory entries"]) {
        expect(d).not.toContain(wrong);
      }
    }
  });
});
