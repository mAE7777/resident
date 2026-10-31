// The bench's zero-contact law, the corpus discipline, and the
// deterministic machinery a reproducible trial rests on.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classify, herTextOf, loadCorpus, stratifiedSample, toOpenAIBody, replayOne, fakeFetch, blindPack, ASSISTANT_VOICE,
  type TraceCall, type TrialTarget,
} from "../../../scripts/trial/bench.js";

// ── The zero-contact import wall ─────────────────────────────────────────────

/**
 * Forbidden shapes for the pure bench modules; only the CLI may know her home.
 * COMMENTS ARE STRIPPED FIRST, the census learned this the hard way (defect class 10):
 * a header explaining "never imports telegram" must not be counted as importing telegram.
 */
export function contactViolations(source: string, cliFile: boolean): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
  const rules: Array<[string, RegExp]> = [
    ["a send path", /telegram|builtin\/message|sendFile|notifier\.push/u],
    ["a field write", /field-live|encodeClaim|encodeQuestion|\.reRead\(/u],
    ["her home path", /\.resident/u],
  ];
  return rules
    .filter(([name, re]) => re.test(code) && !(cliFile && name === "her home path"))
    .map(([name]) => name);
}

describe("zero contact", () => {
  it("ruler/bench/core-ledger touch no send path, no field write, and never name her home", () => {
    const dir = join(process.cwd(), "scripts", "trial");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(contactViolations(src, f === "trial-run.ts"), `${f} breaks the wall`).toEqual([]);
    }
  });

  it("PLANTED: the wall detector still sees all three shapes, and a clean file passes", () => {
    expect(contactViolations('import { sendFile } from "../telegram/x.js";', false)).toContain("a send path");
    expect(contactViolations("field.encodeClaim({});", false)).toContain("a field write");
    expect(contactViolations('const p = "/Users/x/.resident";', false)).toContain("her home path");
    expect(contactViolations('const p = "/Users/x/.resident";', true)).toEqual([]); // the CLI's one licence
    expect(contactViolations('const a = 1;', false)).toEqual([]);
  });
});

// ── The corpus discipline ─────────────────────────────────────────────────────

function trace(over: Record<string, unknown>): Record<string, unknown> {
  return {
    request: { model: "m", system: "", messages: [{ role: "user", content: "嗯" }], ...over },
    response: { content: [{ type: "text", text: "她当时说的话。" }] },
  };
}

describe("what counts as a question", () => {
  it("shadow and bare tool calls are never questions; her SOUL marks a turn", () => {
    expect(classify({ account: "shadow" })).toBeNull();
    expect(classify({ account: "living" })).toBe("living");
    expect(classify({ system: "# 我\n我说话的样子" })).toBe("turn");
    expect(classify({ system: "" })).toBeNull();
    expect(classify({ system: [{ type: "text", text: "# 我 起点" }] })).toBe("turn");
  });

  it("loadCorpus filters, extracts her text, and survives a broken file", () => {
    const dir = mkdtempSync(join(tmpdir(), "trial-corpus-"));
    try {
      writeFileSync(join(dir, "a.json"), JSON.stringify(trace({ account: "living" })));
      writeFileSync(join(dir, "b.json"), JSON.stringify(trace({ account: "shadow" })));
      writeFileSync(join(dir, "c.json"), JSON.stringify(trace({ system: "# 我 起点" })));
      writeFileSync(join(dir, "d.json"), "not json at all");
      const corpus = loadCorpus(dir);
      expect(corpus.map((c) => [c.file, c.layer])).toEqual([["a.json", "living"], ["c.json", "turn"]]);
      expect(corpus[0]!.herText).toBe("她当时说的话。");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("herTextOf joins text blocks and tolerates junk", () => {
    expect(herTextOf({ content: [{ type: "text", text: "一" }, { type: "text", text: "二" }] })).toBe("一二");
    expect(herTextOf(null)).toBe("");
  });
});

describe("deterministic sampling and the bare strip", () => {
  const calls: TraceCall[] = Array.from({ length: 20 }, (_, i) => ({
    file: `${i}.json`,
    layer: i % 4 === 0 ? "turn" : "living",
    model: "m",
    request: { system: "# 我", messages: [{ role: "user", content: `问题${i}` }], maxTokens: 100 },
    herText: "话",
  }));

  it("same seed, same sample; layers all represented", () => {
    const a = stratifiedSample(calls, 8, 42).map((c) => c.file);
    const b = stratifiedSample(calls, 8, 42).map((c) => c.file);
    expect(a).toEqual(b);
    const layers = new Set(stratifiedSample(calls, 8, 42).map((c) => c.layer));
    expect(layers).toEqual(new Set(["turn", "living"]));
  });

  it("--bare wears the assistant ghost in place of her system, and touches nothing else", () => {
    const target: TrialTarget = { baseUrl: "x", apiKey: "k", model: "cand" };
    const full = toOpenAIBody(calls[0]!, target, false) as { messages: Array<{ role: string; content: string }> };
    const bare = toOpenAIBody(calls[0]!, target, true) as { messages: Array<{ role: string; content: string }> };
    expect(full.messages[0]!.content).toBe("# 我");
    expect(bare.messages[0]!).toEqual({ role: "system", content: ASSISTANT_VOICE });
    expect(bare.messages.length).toBe(full.messages.length);
    expect(bare.messages.slice(1)).toEqual(full.messages.slice(1));
  });

  it("the fake provider drives the whole replay path without a network", async () => {
    const out = await replayOne(calls[0]!, { baseUrl: "http://fake", apiKey: "k", model: null }, false, fakeFetch("回声"));
    expect(out.text).toBe("回声");
    expect(out.inTok).toBe(1);
  });
});

describe("the blind pack seals its key", () => {
  it("20 pairs max, every answer in the key, sides shuffled by seed", () => {
    const pairs = Array.from({ length: 25 }, (_, i) => ({ file: `${i}`, hers: `她${i}`, shadow: `影${i}` }));
    const pack = blindPack(pairs, 7);
    const key = JSON.parse(pack.keyJson) as { key: Record<string, string> };
    expect(Object.keys(key.key).length).toBe(20);
    expect(pack.pairsMd.includes("她3")).toBe(true);
    expect(pack.pairsMd.includes("影子")).toBe(false); // the pack never labels sides
    const sides = new Set(Object.values(key.key));
    expect(sides.size, "one-sided shuffle: the key gives the answer away by position").toBe(2);
  });
});
