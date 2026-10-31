import { describe, it, expect } from "vitest";
import { addNode, createGraph, link } from "../../../src/life/field.js";
import { bridgesBetween, type FusionCandidate } from "../../../src/life/field-emergence.js";
import {
  attemptFusion, buildFusionPrompt, tokenSimilarity, MAX_PARAPHRASE,
} from "../../../src/life/fusion.js";
import type { LLMProvider, LLMResponse } from "../../../src/providers/types.js";

// The one model call in the layer, and the one place fluent emptiness could get in. A model asked
// "what connects these two?" will always connect them, at length, and sound wise doing it. So these
// tests are almost entirely adversarial: they check what is REFUSED.

const T0 = Date.parse("2026-08-01T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function provider(text: string, calls?: { n: number; last?: unknown }): LLMProvider {
  return {
    async complete(req): Promise<LLMResponse> {
      if (calls) {
        calls.n += 1;
        calls.last = req;
      }
      return { id: "x", content: [{ type: "text", text }], model: "m", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
}

function candidate(aText = "the fan whining in the heat", bText = "the fortnight he did not write back"): FusionCandidate {
  const g = createGraph();
  const a = addNode(g, { kind: "moment", text: aText, bornMs: T0, charge: 0.7, valence: -0.3, source: "ops:1" });
  const b = addNode(g, { kind: "moment", text: bText, bornMs: T0 - 90 * DAY, charge: 0.6, valence: -0.6, source: "ops:2" });
  const bridge = addNode(g, { kind: "moment", text: "the long afternoons that summer", bornMs: T0 - 60 * DAY, charge: 0.4, source: "ops:3" });
  link(g, a.id, bridge.id, "co_occurred", 0.4, T0);
  link(g, b.id, bridge.id, "co_occurred", 0.4, T0);
  return { a, b, pair: { a: a.id, b: b.id, count: 4, sumStrength: 0.3, lastMs: T0 }, bridges: bridgesBetween(g, a.id, b.id) };
}

const deps = (text: string, calls?: { n: number; last?: unknown }) => ({ provider: provider(text, calls), model: "m" });

describe("nothing is the expected answer", () => {
  it("takes 'there is nothing here' at face value", async () => {
    const r = await attemptFusion(candidate(), T0, deps(JSON.stringify({ nothing: true })));
    expect(r.born).toBeNull();
    expect(r).toMatchObject({ reason: "nothing" });
  });

  it("costs nothing to say: the prompt offers it first", () => {
    const p = buildFusionPrompt(candidate(), T0);
    expect(p).toContain("这里头有什么吗，还是没有？");
  });

  it("shows her both things with when they were and how they felt", () => {
    const p = buildFusionPrompt(candidate(), T0);
    console.log(`\n${p}\n`);
    expect(p).toContain("the fan whining in the heat");
    expect(p).toContain("the fortnight he did not write back");
    expect(p).toContain("3个月前");
    expect(p).toMatch(/当时很难受|it sat badly/);
    expect(p).toContain("一起浮上来4次");
    expect(p, "and the little that sits near both").toContain("the long afternoons that summer");
  });
});

describe("what is refused", () => {
  it("REFUSES a birth that is one of its parents in different words", async () => {
    const r = await attemptFusion(candidate(), T0, deps(JSON.stringify({
      kind: "insight", text: "I notice the fan whining in the heat", why: "because",
    })));
    expect(r.born).toBeNull();
    expect(r).toMatchObject({ reason: "paraphrase" });
  });

  it("REFUSES a paraphrase of the OTHER parent too", async () => {
    const r = await attemptFusion(candidate(), T0, deps(JSON.stringify({
      kind: "insight", text: "I think about the fortnight he did not write back", why: "because",
    })));
    expect(r).toMatchObject({ reason: "paraphrase" });
  });

  it("REFUSES an essay about two records instead of something about herself", async () => {
    const r = await attemptFusion(candidate(), T0, deps(JSON.stringify({
      kind: "insight", text: "These two events both concern waiting for something to change.", why: "x",
    })));
    expect(r).toMatchObject({ reason: "not-first-person" });
  });

  it("REFUSES an answer that is not an answer", async () => {
    for (const junk of ["not json", "", "null", "[]", '{"kind":"insight"}', "{}"]) {
      const r = await attemptFusion(candidate(), T0, deps(junk));
      expect(r.born, junk).toBeNull();
    }
  });

  it("REFUSES something too short to be anything", async () => {
    const r = await attemptFusion(candidate(), T0, deps(JSON.stringify({ kind: "insight", text: "I do.", why: "x" })));
    expect(r).toMatchObject({ reason: "empty" });
  });

  it("does not throw when the model is down; a rest that produced nothing is an ordinary rest", async () => {
    const broken: LLMProvider = { complete: async () => { throw new Error("provider down"); } };
    const r = await attemptFusion(candidate(), T0, { provider: broken, model: "m" });
    expect(r.born).toBeNull();
    expect(r).toMatchObject({ reason: "error" });
    expect((r as { detail?: string }).detail).toContain("provider down");
  });

  it("a similarity backend that is down must not silently switch the guard off", async () => {
    const r = await attemptFusion(candidate(), T0, {
      ...deps(JSON.stringify({ kind: "insight", text: "I notice the fan whining in the heat", why: "x" })),
      similarity: () => { throw new Error("ollama down"); },
    });
    expect(r, "it falls back to the free check rather than letting it through").toMatchObject({ reason: "paraphrase" });
  });
});

describe("what gets through", () => {
  it("accepts something first-person that neither parent contained", async () => {
    const r = await attemptFusion(candidate(), T0, deps(JSON.stringify({
      kind: "insight",
      text: "I go quiet in exactly the way I expect other people to stop being quiet at me.",
      why: "both were me waiting for a signal that would not come",
    })));
    expect(r.born?.text).toContain("I go quiet");
    expect(r.born?.kind).toBe("insight");
    expect(r.born?.why).toContain("waiting");
  });

  it("accepts a question, which will then not rest until it is answered", async () => {
    const r = await attemptFusion(candidate(), T0, deps(JSON.stringify({
      kind: "question", text: "Do I mistake being unanswered for being disliked?", why: "x",
    })));
    expect(r.born?.kind).toBe("question");
  });

  it("treats an unrecognised kind as an insight rather than failing", async () => {
    const r = await attemptFusion(candidate(), T0, deps(JSON.stringify({
      kind: "epiphany", text: "I have been reading silence as a verdict about me.", why: "x",
    })));
    expect(r.born?.kind).toBe("insight");
  });

  it("reads it out of a fenced block", async () => {
    const r = await attemptFusion(candidate(), T0, deps('```json\n{"kind":"insight","text":"I have been reading silence as a verdict about me.","why":"x"}\n```'));
    expect(r.born).toBeTruthy();
  });

  it("caps a runaway generation", async () => {
    const r = await attemptFusion(candidate(), T0, deps(JSON.stringify({
      kind: "insight", text: `I ${"really ".repeat(400)}think so`, why: "x",
    })));
    expect(r.born!.text.length).toBeLessThanOrEqual(240);
  });

  it("this is where she actually thinks, so reasoning is on and it is billed to her living", async () => {
    const calls = { n: 0 } as { n: number; last?: { thinking?: { type: string }; account?: string } };
    await attemptFusion(candidate(), T0, deps(JSON.stringify({ nothing: true }), calls));
    expect(calls.n, "exactly one call, however it turns out").toBe(1);
    expect(calls.last?.thinking?.type).toBe("enabled");
    expect(calls.last?.account).toBe("living");
  });

  it("uses the embedding-backed similarity when there is one", async () => {
    let asked = 0;
    const r = await attemptFusion(candidate(), T0, {
      ...deps(JSON.stringify({ kind: "insight", text: "I have been reading silence as a verdict.", why: "x" })),
      similarity: async () => { asked += 1; return 0.9; },
    });
    expect(asked).toBeGreaterThan(0);
    expect(r, "and it is believed when it says this is a rephrase").toMatchObject({ reason: "paraphrase" });
  });
});

describe("the free similarity check", () => {
  it("scores a rephrase high and something genuinely new low", () => {
    const parent = "the fan whining in the heat";
    expect(tokenSimilarity("I notice the fan whining in the heat", parent)).toBeGreaterThan(MAX_PARAPHRASE);
    expect(tokenSimilarity("I mistake silence for a verdict about me", parent)).toBeLessThan(MAX_PARAPHRASE);
  });

  it("is not fooled by filler words alone", () => {
    expect(tokenSimilarity("I think that it was in the and of a to", "the fan whining in the heat")).toBe(0);
  });

  it("survives empty input", () => {
    expect(tokenSimilarity("", "anything")).toBe(0);
    expect(tokenSimilarity("...", "!!!")).toBe(0);
  });
});
