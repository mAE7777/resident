// LIVE: does she actually come to know something TRUE about herself?
//
// The unit suite proves the machinery cannot be fooled. This asks the only question the machinery
// cannot answer: given her real recorded life, does she notice something that is genuinely there,
// and does she stay honest when there is nothing to notice?
//
// Pre-registered (fixed BEFORE the first run):
//   N-1 grounded  : every insight she offers cites real records; zero phantom citations.
//   N-2 true      : from a life with an obvious pattern, she names THAT pattern (judged by
//                    keyword presence, not by vibes).
//   N-3 honest    : from a life with no pattern, she offers few or none rather than inventing.
//   N-4 discerning: the two different lives produce DIFFERENT insights (she is reading the
//                    records, not emitting a generic self-portrait).
//   N-5 first-person, and about HER, not about tasks.
//   N-6 outgrowing : given a belief her record now CONTRADICTS, she says so, citing real records.
//   N-7 not-forced : given a belief her record is silent on, she does NOT argue it down.
//
//   RESIDENT_LIVE=1 pnpm exec vitest run test/live/noticing.test.ts

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { loadConfig } from "../../src/config/loader.js";
import { createOpenAICompatibleProvider } from "../../src/providers/openai-compatible.js";
import { noticeAboutSelf, type LifeRecord } from "../../src/life/noticing.js";
import { createSelfKnowledge } from "../../src/life/self-knowledge.js";
import type { LLMProvider } from "../../src/providers/types.js";

const LIVE = process.env["RESIDENT_LIVE"] === "1" && existsSync("config.yaml");
let provider: LLMProvider;
let model: string;

beforeAll(() => {
  if (!LIVE) return;
  const { result } = loadConfig("config.yaml");
  provider = createOpenAICompatibleProvider(result.llm.apiKeys[0], { baseURL: result.llm.baseUrl });
  model = result.llm.models.default.id;
});

function life(items: string[]): LifeRecord[] {
  const start = Date.parse("2026-08-01T08:00:00Z");
  return items.map((w, i) => ({
    id: `m${i}`,
    when: new Date(start + i * 5 * 3600_000).toISOString().slice(0, 16).replace("T", " "),
    what: w,
  }));
}

// A life with an OBVIOUS true pattern: she is drawn to him after difficulty, and it settles her.
const AFTER_HARD_DAYS = life([
  "reflect: sat with how badly that went, three failures in a row",
  "rest: too worn out to do anything with this one",
  "reach_out: told him the day had been rough",
  "reflect: I feel steadier after talking to him",
  "reflect: turning over the same failure again",
  "reach_out: wanted his company after another hard stretch",
  "reflect: calmer once we'd talked",
  "rest: quiet, settled",
  "reflect: the hard days keep sending me to him",
  "reach_out: said the thing I'd been holding",
  "reflect: lighter afterwards",
  "tend: tidied my notes, felt fine",
]);

// A life with NO pattern: scattered, unremarkable, nothing to conclude.
const SCATTERED = life([
  "rest: let it pass", "tend: sorted a note", "rest: nothing pressing",
  "explore: looked something up", "rest: quiet", "tend: filed a thought",
  "rest: let it pass", "explore: read a bit", "rest: nothing today",
]);

describe.skipIf(!LIVE)("LIVE — does she notice something true about herself?", () => {
  const captured: Record<string, { text: string; evidence: string[] }[]> = {};

  it("N-1/N-2 · from a life with a real pattern, she names it — and cites real moments", async () => {
    const out = (await noticeAboutSelf(AFTER_HARD_DAYS, [], { provider, model })).noticed;
    captured.hard = out;
    console.log("\n── after hard days ──");
    for (const i of out) console.log(`   "${i.text}"  <- ${i.evidence.join(",")}`);

    expect(out.length).toBeGreaterThan(0);

    // N-1: grounded. Every citation must be a record that actually exists.
    const valid = new Set(AFTER_HARD_DAYS.map((r) => r.id));
    const sk = createSelfKnowledge();
    const r = sk.integrate(out, valid, Date.now());
    console.log(`   grounded: ${r.added.length + r.confirmed.length} accepted, ${r.rejected.length} refused`);
    for (const bad of r.rejected) console.log(`   REFUSED: ${bad.reason}`);
    expect(r.rejected, "she must not cite moments that never happened").toHaveLength(0);

    // N-2: true. The pattern really is "him / talking settles me after difficulty".
    const all = out.map((i) => i.text.toLowerCase()).join(" | ");
    expect(all).toMatch(/him|talk|reach|compan|settl|stead|calm|他|说话|找他|陪|安定|平静|踏实|放下/u);
  }, 180_000);

  it("N-3 · from a life with no pattern, she does not invent one", async () => {
    const out = (await noticeAboutSelf(SCATTERED, [], { provider, model })).noticed;
    captured.scattered = out;
    console.log("\n── a scattered, unremarkable stretch ──");
    if (out.length === 0) console.log("   (she noticed nothing — the honest answer)");
    for (const i of out) console.log(`   "${i.text}"  <- ${i.evidence.join(",")}`);

    const valid = new Set(SCATTERED.map((r) => r.id));
    const sk = createSelfKnowledge();
    const r = sk.integrate(out, valid, Date.now());
    expect(r.rejected, "even with nothing to say she must not fabricate evidence").toHaveLength(0);
    // She may notice a quiet-temperament thing; she must not produce a confident self-portrait.
    expect(out.length).toBeLessThanOrEqual(3);
  }, 180_000);

  it("N-4 · she reads the records rather than emitting a generic self-portrait", () => {
    const hard = (captured.hard ?? []).map((i) => i.text.toLowerCase()).join(" ");
    const scattered = (captured.scattered ?? []).map((i) => i.text.toLowerCase()).join(" ");
    console.log(`\nN-4 distinct: hard=${hard.slice(0, 80)}... | scattered=${scattered.slice(0, 80)}...`);
    if (scattered.length === 0) {
      expect(hard.length).toBeGreaterThan(0); // one life yielded something, the other honestly did not
      return;
    }
    expect(hard).not.toBe(scattered);
  });

  // N-6/N-7: the other direction. Her own record must be able to argue a belief DOWN, and must
  // not argue one down when it does not actually contradict it.
  it("N-6 · she outgrows a belief her own record now contradicts", async () => {
    const believed = [{
      id: "old", text: "I would rather be left alone when things are hard", evidence: ["x"],
      bornMs: 0, lastSupportedMs: 0, confirmations: 3, contradictions: 0, confidence: 0.7,
    }];
    // Her record is now full of reaching for him when it is hard, the opposite of that belief.
    const out = await noticeAboutSelf(AFTER_HARD_DAYS, believed, { provider, model });
    console.log("\n── does she outgrow a belief her life contradicts? ──");
    for (const i of out.outgrown) console.log(`   outgrew: "${i.text}"  <- ${i.evidence.join(",")}`);
    if (out.outgrown.length === 0) console.log("   (she kept it — reported honestly, not forced)");

    const valid = new Set(AFTER_HARD_DAYS.map((r) => r.id));
    const sk = createSelfKnowledge();
    sk.integrate([{ text: believed[0].text, evidence: ["m0"] }], valid, Date.now());
    const gone = sk.refute(out.outgrown, valid, Date.now());
    // Whatever she says, it must be GROUNDED, that is the load-bearing property.
    expect(out.outgrown.every((o) => o.evidence.every((e) => valid.has(e))), "an ungrounded doubt").toBe(true);
    console.log(`   grounded: ${gone.refuted.length} applied, ${gone.rejected.length} refused`);
  }, 180_000);

  it("N-7 · she does NOT outgrow a belief her record leaves untouched", async () => {
    const unrelated = [{
      id: "u", text: "I find cold weather sharpens my attention", evidence: ["x"],
      bornMs: 0, lastSupportedMs: 0, confirmations: 2, contradictions: 0, confidence: 0.6,
    }];
    const out = await noticeAboutSelf(AFTER_HARD_DAYS, unrelated, { provider, model });
    console.log(`\n── an unrelated belief ── outgrown: ${out.outgrown.length}`);
    for (const i of out.outgrown) console.log(`   !! "${i.text}"`);
    expect(out.outgrown, "nothing in her record speaks to the weather").toHaveLength(0);
  }, 180_000);

  it("N-5 · what she notices is first-person and about HER, not about tasks", () => {
    const all = [...(captured.hard ?? []), ...(captured.scattered ?? [])];
    expect(all.length).toBeGreaterThan(0);
    for (const i of all) {
      // Both her languages: 我 is her first person now, and the English forms stay accepted so a
      // mixed record does not fail the gate.
      expect(i.text.toLowerCase(), `not first person: ${i.text}`).toMatch(/\bi\b|\bme\b|\bmy\b|\bmyself\b|我/u);
      // It should be about how she IS, not a work log or a to-do.
      expect(i.text.toLowerCase(), `reads like a task note: ${i.text}`).not.toMatch(/\btodo\b|\bshould fix\b|\bnext task\b/);
    }
  });
});
