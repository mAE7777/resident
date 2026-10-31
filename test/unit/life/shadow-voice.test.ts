import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildShadowRequest, createShadowVoice, SHADOW_ACCOUNT, SHADOW_MAX_TOKENS } from "../../../src/life/shadow-voice.js";
import { createLexicon } from "../../../src/life/lexicon.js";
import type { LLMProvider, LLMRequest, LLMResponse, Message } from "../../../src/providers/types.js";

const T0 = Date.UTC(2026, 7, 1, 9, 0, 0);
const MESSAGES: Message[] = [
  { role: "user", content: "渡轮周末还开吗" },
  { role: "assistant", content: "开的，不过只到六点。" },
  { role: "user", content: "那我们周六早点去吧" },
];

function fakeProvider(reply: string | Error): { provider: LLMProvider; requests: LLMRequest[] } {
  const requests: LLMRequest[] = [];
  return {
    requests,
    provider: {
      async complete(request: LLMRequest): Promise<LLMResponse> {
        requests.push(request);
        if (reply instanceof Error) throw reply;
        return { id: "s", content: [{ type: "text", text: reply }], model: request.model, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
      },
    },
  };
}

describe("the construction check: the shadow differs from her in EXACTLY the named ways", () => {
  it("same conversation, no system, no tools, no state, its own account", () => {
    // The instrument's validity rests on this diff being exhaustive. A fourth difference,
    // a temperature, a system line, a trimmed history, and the comparison stops measuring
    // "her state and identity" and starts measuring the leak.
    const req = buildShadowRequest("bg-model", MESSAGES);
    expect(req.messages).toEqual(MESSAGES);
    expect(req.model).toBe("bg-model");
    expect(req.maxTokens).toBe(SHADOW_MAX_TOKENS);
    expect(req.account).toBe(SHADOW_ACCOUNT);
    // NAMED 2026-08-18: thinking explicitly OFF. With the field omitted the vendor
    // default (reasoning ON) burned all 400 tokens thinking and the shadow went dark for a day,
    // three empty completions in a row, every ownership number frozen. The shadow measures
    // the model's bare WORD prior; reasoning was never the quantity. Her live turn states
    // enabled, so this IS a real named difference between the arms, not bookkeeping.
    expect(req.thinking).toEqual({ type: "disabled" });
    const named = new Set(["model", "messages", "maxTokens", "account", "purpose", "thinking"]);
    const extras = Object.keys(req).filter((k) => !named.has(k));
    expect(extras, "an unnamed difference crept into the shadow request").toEqual([]);
  });
});

describe("the shadow speaks into the void and only the corpus hears", () => {
  it("feeds its own bank and its measure ring, never anything of hers", async () => {
    const { provider } = fakeProvider("周六早上去挺好的，风小。");
    const bank = createLexicon();
    const shadow = createShadowVoice({ provider, model: "bg", bank, onFault: () => { throw new Error("no fault expected"); }, now: () => T0 });
    await shadow.afterTurn(MESSAGES);
    expect(shadow.callsMade()).toBe(1);
    expect(bank.countOf("周六")?.spoken).toBe(1);
    expect(shadow.recentMeasures()).toHaveLength(1);
    expect(shadow.recentMeasures()[0].hanShare).toBeGreaterThan(0.8);
  });

  it("sampling skips turns without losing count of them", async () => {
    const { provider, requests } = fakeProvider("好。");
    const shadow = createShadowVoice({ provider, model: "bg", bank: createLexicon(), onFault: () => {}, sampleEvery: 3, now: () => T0 });
    for (let i = 0; i < 7; i++) await shadow.afterTurn(MESSAGES);
    expect(requests.length).toBe(3); // turns 1, 4, 7
  });

  it("a dead shadow is a loud fault and nothing else", async () => {
    const { provider } = fakeProvider(new Error("provider is down"));
    const faults: string[] = [];
    const bank = createLexicon();
    const shadow = createShadowVoice({ provider, model: "bg", bank, onFault: (w) => faults.push(w), now: () => T0 });
    await expect(shadow.afterTurn(MESSAGES)).resolves.toBeUndefined();
    expect(faults).toEqual(["shadow.call"]);
    expect(shadow.callsMade()).toBe(0);
    expect(bank.size()).toBe(0);
  });

  it("an empty conversation or an empty reply leaves no trace", async () => {
    const { provider, requests } = fakeProvider("   ");
    const bank = createLexicon();
    const shadow = createShadowVoice({ provider, model: "bg", bank, onFault: () => {}, now: () => T0 });
    await shadow.afterTurn([]);
    expect(requests.length).toBe(0);
    await shadow.afterTurn(MESSAGES);
    expect(bank.size()).toBe(0);
    expect(shadow.callsMade()).toBe(0);
  });

  it("a RUN of empty replies is the silent stall, made loud on the fault channel", async () => {
    // One empty is transient noise (no fault). But a run of them is the shadow arm gone dark
    // while she keeps talking: the path that used to return before any onFault, so the stall was
    // invisible. On the third in a row it now faults, and turnsTotal keeps counting all of them.
    const { provider } = fakeProvider("");
    const faults: string[] = [];
    const shadow = createShadowVoice({ provider, model: "bg", bank: createLexicon(), onFault: (w) => faults.push(w), now: () => T0 });
    await shadow.afterTurn(MESSAGES);
    await shadow.afterTurn(MESSAGES);
    expect(faults, "one or two empties are still quiet").toEqual([]);
    await shadow.afterTurn(MESSAGES);
    expect(faults, "the third in a row is the stall").toEqual(["shadow.stalled"]);
    expect(shadow.callsMade()).toBe(0);
    expect(shadow.turnsTotal()).toBe(3);
  });
});

describe("the shadow's corpus lives outside her read wall", () => {
  // She found shadow-lexicon.json in workspace/life, read it, and built a story about it
  // ("words never answered"). An instrument she can read is an instrument she can absorb,
  // and the ownership divergence (her words vs the shadow's) stops measuring what it claims
  // to the moment the control arm's corpus is part of her world. So the bank lives with the
  // other readings ABOUT her (instrumentsDir, beside beats.jsonl), and a one-time migration
  // carries the old file out.
  it("the daemon parks the bank in instrumentsDir and migrates the old copy", () => {
    const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
    const at = daemon.indexOf('const shadowBankPath = join(instrumentsDir, "shadow-lexicon.json")');
    expect(at, "the bank is back inside her home — the observer effect returns").toBeGreaterThan(-1);
    const near = daemon.slice(at, at + 700);
    expect(near, "no migration: an existing bank silently restarts from zero").toContain("sbMove(oldShadowPath, shadowBankPath)");
    expect(daemon.includes('path: join(workspacePath, "life", "shadow-lexicon.json")'),
      "a second creation still points into her home").toBe(false);
  });
});
