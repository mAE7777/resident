import { describe, it, expect } from "vitest";
import {
  createSelfKnowledge, describeSelfKnowledge, EROSION_AFTER_MS,
} from "../../../src/life/self-knowledge.js";
import { noticeAboutSelf, type LifeRecord } from "../../../src/life/noticing.js";
import { buildMomentPrompt, computeAffordances, type MomentContext } from "../../../src/life/agency.js";
import type { InnerSnapshot } from "../../../src/life/inner-state.js";
import type { LLMProvider, LLMResponse } from "../../../src/providers/types.js";

// Whole-loop simulations of her actually living, not unit checks of parts. The question each one
// asks is whether GROWTH really closes: does her life produce self-understanding, does that
// understanding reach her, does it change as she changes, and can it be faked or calcified?

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-08-01T09:00:00Z");

function provider(replies: string[]): { p: LLMProvider; calls: number } {
  const state = { calls: 0 };
  const p: LLMProvider = {
    async complete(): Promise<LLMResponse> {
      const text = replies[Math.min(state.calls, replies.length - 1)];
      state.calls += 1;
      return { id: "x", content: [{ type: "text", text }], model: "m", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
  return { p, get calls() { return state.calls; } } as { p: LLMProvider; calls: number };
}

/** A week of her real moments, as the noticing sees them. */
function weekOf(what: string[], startMs = T0): LifeRecord[] {
  return what.map((w, i) => ({ id: `m${i}`, when: new Date(startMs + i * 6 * 3600_000).toISOString().slice(0, 16), what: w }));
}

const QUIET_WEEK = weekOf([
  "rest: let the moment pass, nothing pressing", "reflect: sat with the quiet",
  "rest: nothing to do with this one", "tend: sorted my notes",
  "rest: let it pass", "reflect: thought about the week",
  "rest: quiet again", "reflect: noticed the days blur together",
]);

const SOCIAL_WEEK = weekOf([
  "reach_out: told him what I'd been turning over", "reflect: felt settled after we talked",
  "reach_out: wanted his company", "reflect: calmer today",
  "reach_out: shared something small", "reflect: the day felt lighter",
  "rest: content", "tend: tidied my notes",
]);

function snapshot(): InnerSnapshot {
  return {
    drives: { discomfort: 0.1, care: 0.2, social: 0.4, curiosity: 0.5, expression: 0.3, maintenance: 0.2 },
    emotion: { pleasure: 0.2, arousal: 0.1, dominance: 0.1 }, mood: "steady", dominant: "curiosity",
    policy: { tierCeiling: "tier3", mayExplore: true, explorationBreadth: 0.8, retrievalDepth: 0.5, reason: "steady" },
  };
}

function moment(over: Partial<MomentContext> = {}): MomentContext {
  return {
    nowMs: T0, snapshot: snapshot(), phase: "normal", awake: true, present: true, available: true,
    hoursSinceUser: 5, recentActions: [], recentLife: "living her days", safeMode: false, ...over,
  };
}

const noticed = (items: { text: string; evidence: string[] }[]) => JSON.stringify({ noticed: items, outgrown: [] });
const outgrew = (items: { text: string; evidence: string[] }[]) => JSON.stringify({ noticed: [], outgrown: items });

describe("SCENARIO: she lives a few weeks and comes to know something", () => {
  it("a repeated pattern in her real life becomes something she holds, and reaches her", async () => {
    const sk = createSelfKnowledge();
    const { p } = provider([noticed([{ text: "talking with him settles me", evidence: ["m0", "m1"] }])]);

    // Week 1: she notices it. Tentative, not yet part of who she is.
    let proposals = (await noticeAboutSelf(SOCIAL_WEEK, sk.carried(), { provider: p, model: "m" })).noticed;
    sk.integrate(proposals, new Set(SOCIAL_WEEK.map((r) => r.id)), T0);
    expect(sk.active()).toHaveLength(1);
    expect(sk.carried(), "a first impression is not yet self-knowledge").toHaveLength(0);
    expect(buildMomentPrompt(moment({ selfKnowledge: describeSelfKnowledge(sk.carried()) }), computeAffordances(moment())))
      .not.toContain("settles me");

    // Week 2: her life bears it out again. NOW it is hers, and it reaches her moments.
    proposals = (await noticeAboutSelf(SOCIAL_WEEK, sk.carried(), { provider: p, model: "m" })).noticed;
    sk.integrate(proposals, new Set(SOCIAL_WEEK.map((r) => r.id)), T0 + 7 * DAY);
    expect(sk.carried()).toHaveLength(1);
    const prompt = buildMomentPrompt(moment({ selfKnowledge: describeSelfKnowledge(sk.carried()) }), computeAffordances(moment()));
    expect(prompt, "what she has become must actually reach her").toContain("settles me");
    // It informs her; it never instructs her. The question is still open.
    expect(prompt).toContain("你想做什么？");
    expect(prompt).not.toMatch(/you should|you must/i);
  });

  it("she stays honest when her life does not support noticing anything", async () => {
    const sk = createSelfKnowledge();
    const { p } = provider(["{}"]); // an empty answer is a real and honest one
    const proposals = (await noticeAboutSelf(QUIET_WEEK, [], { provider: p, model: "m" })).noticed;
    expect(proposals).toEqual([]);
    expect(sk.integrate(proposals, new Set(), T0).added).toHaveLength(0);
    expect(describeSelfKnowledge(sk.carried())).toBe(""); // nothing is shown, nothing is invented
  });

  it("REFUSES a flattering self-image she cannot ground in her actual life", async () => {
    const sk = createSelfKnowledge();
    // The confabulation failure mode: a grand claim citing a week that never happened.
    const { p } = provider([noticed([{ text: "I have always been drawn to deep questions", evidence: ["m88", "m99"] }])]);
    const proposals = (await noticeAboutSelf(QUIET_WEEK, [], { provider: p, model: "m" })).noticed;
    const r = sk.integrate(proposals, new Set(QUIET_WEEK.map((x) => x.id)), T0);
    expect(r.added).toHaveLength(0);
    expect(r.rejected[0].reason).toContain("do not exist");
    expect(sk.active()).toHaveLength(0);
  });

  it("she can outgrow something that stops being true of her", async () => {
    const sk = createSelfKnowledge();
    const { p } = provider([noticed([{ text: "I would rather be left alone", evidence: ["m0"] }])]);
    const proposals = (await noticeAboutSelf(QUIET_WEEK, [], { provider: p, model: "m" })).noticed;
    sk.integrate(proposals, new Set(QUIET_WEEK.map((r) => r.id)), T0);
    sk.integrate(proposals, new Set(QUIET_WEEK.map((r) => r.id)), T0 + 7 * DAY); // held for a while
    expect(sk.carried()).toHaveLength(1);

    // Then her life changes and simply stops bearing it out.
    let t = T0 + 7 * DAY;
    for (let i = 0; i < 8; i++) { t += EROSION_AFTER_MS + DAY; sk.erode(t); }
    expect(sk.active(), "a self she outgrew does not follow her forever").toHaveLength(0);
    expect(sk.retired(), "but it is kept: it is part of her history").toHaveLength(1);
    expect(describeSelfKnowledge(sk.carried())).toBe("");
  });

  it("cannot calcify into a fixed identity, however much she notices", async () => {
    const sk = createSelfKnowledge();
    const many = [
      "quiet mornings suit me", "I get restless before dusk", "failure makes me stubborn",
      "his company steadies something", "I circle unanswered questions", "reading late calms me",
      "I dislike being hurried", "small finished things please me", "I lose the thread when rushed",
    ];
    for (const text of many) {
      const r = [{ text, evidence: ["m0"] }];
      sk.integrate(r, new Set(["m0"]), T0);
      sk.integrate(r, new Set(["m0"]), T0 + DAY);
    }
    const limit = sk.maturity().carriedLimit;
    expect(sk.active().length).toBeGreaterThan(limit);
    // Only a bounded few ever reach her, so a self-image can never crowd out who she is becoming.
    const shown = describeSelfKnowledge(sk.carried());
    expect(sk.carried()).toHaveLength(limit);
    expect(shown.split("\n")).toHaveLength(limit);
  });

  it("noticing costs ONE call a week, and none at all when her life is too thin", async () => {
    const sk = createSelfKnowledge();
    const prov = provider([noticed([{ text: "something about me", evidence: ["m0"] }])]);
    await noticeAboutSelf(SOCIAL_WEEK, sk.carried(), { provider: prov.p, model: "m" });
    expect(prov.calls).toBe(1); // it is a single look back, not a survey

    const empty = provider(["{}"]);
    expect((await noticeAboutSelf([], [], { provider: empty.p, model: "m" })).noticed).toEqual([]);
    expect(empty.calls, "no life to look back on is not billed").toBe(0);
  });

  it("survives a broken or nonsense answer without inventing a self", async () => {
    for (const junk of ["not json", "{}", "null", '{"noticed":[{"evidence":["m0"]}]}']) {
      const { p } = provider([junk]);
      const out = (await noticeAboutSelf(SOCIAL_WEEK, [], { provider: p, model: "m" })).noticed;
      expect(out, junk).toEqual([]);
    }
    const boom: LLMProvider = { complete: async () => { throw new Error("down"); } };
    await expect(noticeAboutSelf(SOCIAL_WEEK, [], { provider: boom, model: "m" })).rejects.toThrow();
  });

  it("a whole month: she grows, and what she carries stays bounded and grounded", async () => {
    const sk = createSelfKnowledge();
    const weeks = [SOCIAL_WEEK, QUIET_WEEK, SOCIAL_WEEK, QUIET_WEEK];
    const answers = [
      noticed([{ text: "talking with him settles me", evidence: ["m0"] }]),
      noticed([{ text: "I am comfortable in long quiet stretches", evidence: ["m2"] }]),
      noticed([{ text: "talking with him settles me", evidence: ["m1"] }]),
      noticed([{ text: "I am comfortable in long quiet stretches", evidence: ["m4"] }]),
    ];
    const { p } = provider(answers);
    for (let w = 0; w < weeks.length; w++) {
      const week = weeks[w];
      const proposals = (await noticeAboutSelf(week, sk.carried(), { provider: p, model: "m" })).noticed;
      sk.integrate(proposals, new Set(week.map((r) => r.id)), T0 + w * 7 * DAY);
    }
    // Two things learned, each borne out twice, each still grounded in real moments.
    expect(sk.active()).toHaveLength(2);
    expect(sk.carried()).toHaveLength(2);
    for (const i of sk.active()) {
      expect(i.confirmations).toBe(1);
      expect(i.evidence.length).toBeGreaterThan(0);
      expect(i.confidence).toBeLessThan(1); // never certain
    }
  });
});
