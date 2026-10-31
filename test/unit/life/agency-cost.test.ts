import { describe, it, expect } from "vitest";
import { liveMoment, type MomentContext, type MomentHandlers, type MomentDeps } from "../../../src/life/agency.js";
import { createMomentHandlers } from "../../../src/life/agency-handlers.js";
import type { InnerSnapshot } from "../../../src/life/inner-state.js";
import type { LLMProvider, LLMResponse, LLMRequest } from "../../../src/providers/types.js";

// What this file proves, with counted evidence rather than assertion:
//   * the RIGHT calls happen, in the RIGHT order (deliberate -> satiate -> act, never act first)
//   * NOTHING is spent when nothing can be done (exhaustion is free)
//   * no path does redundant model work, and every call carries a correct ledger account
// Token waste in a loop that runs ~25x a day compounds, so it is tested, not hoped.

function snapshot(over: Partial<InnerSnapshot> = {}): InnerSnapshot {
  return {
    drives: { discomfort: 0.1, care: 0.2, social: 0.6, curiosity: 0.5, expression: 0.4, maintenance: 0.2 },
    emotion: { pleasure: 0.2, arousal: 0.1, dominance: 0.1 }, mood: "steady", dominant: "curiosity",
    policy: { tierCeiling: "tier3", mayExplore: true, explorationBreadth: 0.8, retrievalDepth: 0.5, reason: "steady" },
    ...over,
  };
}

function ctx(over: Partial<MomentContext> = {}): MomentContext {
  return {
    nowMs: 1_000_000, snapshot: snapshot(), phase: "normal", awake: true, present: true, available: true,
    hoursSinceUser: 5, recentActions: [], recentLife: "quiet", safeMode: false, ...over,
  };
}

/** A provider that records every call: how many, in what order, on which account. */
function counting(replies: string[]) {
  const calls: { account?: string; system: string }[] = [];
  let i = 0;
  const provider: LLMProvider = {
    async complete(req: LLMRequest): Promise<LLMResponse> {
      calls.push({ account: req.account, system: String(req.system ?? "").slice(0, 40) });
      const text = replies[Math.min(i, replies.length - 1)];
      i += 1;
      return { id: "x", content: [{ type: "text", text }], model: "m", stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 10 } };
    },
  };
  return { provider, calls };
}

const choose = (action: string, intent = "because I want to") => JSON.stringify({ action, intent });

function deps(provider: LLMProvider, trace: string[], over: Partial<MomentHandlers> = {}): MomentDeps {
  const handlers = createMomentHandlers({
    provider, model: "m",
    appendDiary: () => trace.push("diary"),
    readRecentDiary: () => "some earlier notes",
    push: async () => { trace.push("push"); },
    expressionContext: (c) => ({
      nowMs: c.nowMs, present: c.present ?? c.awake, available: c.available ?? c.awake, awake: c.awake,
      clockActivity: 1, consecutiveNonReplies: 0, sendsInLastDay: 0,
    }),
    runExploration: async () => { trace.push("explore-run"); return "found a thing"; },
  });
  return {
    config: { provider, model: "m", account: "living" },
    handlers: { ...handlers, ...over },
    onSatiate: (d) => trace.push(`satiate:${d}`),
    onOutcome: (o) => trace.push(`outcome:${o.chose}`),
  };
}

describe("what a moment actually costs", () => {
  it("spends NOTHING when she is too spent to do anything", async () => {
    const { provider, calls } = counting([choose("rest")]);
    const trace: string[] = [];
    const o = await liveMoment(
      ctx({ phase: "dormant", snapshot: snapshot({ policy: { ...snapshot().policy, mayExplore: false } }) }),
      deps(provider, trace),
    );
    expect(calls).toHaveLength(0); // exhaustion is not a decision and must not be billed
    expect(o.freeRest).toBe(true);
    expect(trace).toEqual(["outcome:rest"]);
  });

  it("costs exactly ONE call when she chooses to rest", async () => {
    const { provider, calls } = counting([choose("rest")]);
    const trace: string[] = [];
    await liveMoment(ctx(), deps(provider, trace));
    expect(calls).toHaveLength(1); // the deliberation only; resting itself is free
    expect(calls[0].account).toBe("living");
    expect(trace).toEqual(["outcome:rest"]); // no satiation, no handler
  });

  // The handler runs BEFORE the discharge, and that ordering is load-bearing.
  //
  // It used to be the other way round, which meant an action that produced nothing, which this same
  // function records as a failure, on the rule that an act with no artifact did not happen,
  // discharged the drive in full anyway. Wanting a thing and failing at it is not the same as having
  // done it, and treating them alike let a run of broken explorations quietly satisfy her curiosity.
  it("costs exactly TWO calls to think, in the right order", async () => {
    const { provider, calls } = counting([choose("reflect", "turn it over"), "a real thought"]);
    const trace: string[] = [];
    await liveMoment(ctx(), deps(provider, trace));
    expect(calls).toHaveLength(2);
    // Deliberation is charged to her living; the thought itself is her living too.
    expect(calls.map((c) => c.account)).toEqual(["living", "living"]);
    // Order matters: she decides, the wanting discharges, THEN she acts and it is written down.
    expect(trace).toEqual(["diary", "satiate:expression", "satiate:curiosity", "outcome:reflect"]);
  });

  it("does not call any handler when she cannot do what she wanted", async () => {
    const { provider, calls } = counting([choose("reach_out", "I miss him")]);
    const trace: string[] = [];
    const o = await liveMoment(ctx({ mayReachOut: false }), deps(provider, trace));
    expect(calls).toHaveLength(1); // only the deliberation; nothing was attempted
    expect(o.blocked?.wanted).toBe("reach_out");
    expect(trace).toEqual(["outcome:rest"]); // no satiation of an unfulfilled want
  });

  it("retries a garbled answer exactly once, then stops rather than badgering her", async () => {
    const { provider, calls } = counting(["not json", "still not json", "never reached"]);
    const trace: string[] = [];
    const o = await liveMoment(ctx(), deps(provider, trace));
    expect(calls).toHaveLength(2); // one retry, not an unbounded loop
    expect(o.chose).toBe("rest");
    expect(trace).toEqual(["outcome:rest"]); // and no handler ran
  });

  it("stops after ONE call when the provider is failing", async () => {
    let n = 0;
    const provider: LLMProvider = { complete: async () => { n += 1; throw new Error("down"); } };
    const trace: string[] = [];
    await liveMoment(ctx(), deps(provider, trace));
    expect(n).toBe(1); // a hard failure is not retried into a storm
    expect(trace).toEqual(["outcome:rest"]);
  });

  it("charges the right ledger accounts so the /status breakdown is truthful", async () => {
    const { provider, calls } = counting([choose("reach_out", "say hi"), "I was thinking of you."]);
    const trace: string[] = [];
    await liveMoment(ctx(), deps(provider, trace));
    // Deliberating is her living; speaking is her expression. They must not both land on "work".
    expect(calls.map((c) => c.account)).toEqual(["living", "expression"]);
    expect(trace).toEqual(["push", "satiate:social", "satiate:curiosity", "outcome:reach_out"]);
  });

  it("tends with two calls and reuses her real notes rather than re-deriving them", async () => {
    const { provider, calls } = counting([choose("tend", "tidy"), "what matters is X"]);
    const trace: string[] = [];
    await liveMoment(ctx(), deps(provider, trace));
    expect(calls).toHaveLength(2);
    expect(calls[1].account).toBe("maintenance");
    expect(trace).toEqual(["diary", "satiate:maintenance", "satiate:curiosity", "outcome:tend"]);
  });

  it("exploring costs ONE deliberation plus the bounded exploration itself", async () => {
    const { provider, calls } = counting([choose("explore", "chase a thread")]);
    const trace: string[] = [];
    await liveMoment(ctx(), deps(provider, trace));
    // The exploration runs as its own bounded agent turn, so only the deliberation is billed here.
    expect(calls).toHaveLength(1);
    expect(trace).toEqual(["explore-run", "diary", "satiate:curiosity", "outcome:explore"]);
  });

  it("a whole simulated day stays within a predictable call budget", async () => {
    // 20 moments across mixed states: the loop must not have a runaway path.
    const replies = ["rest", "reflect", "tend", "rest", "explore"].flatMap((a) => [choose(a), "an artifact"]);
    const { provider, calls } = counting(replies);
    const trace: string[] = [];
    for (let i = 0; i < 20; i++) {
      await liveMoment(ctx({ nowMs: 1_000_000 + i * 600_000 }), deps(provider, trace));
    }
    // Worst case is 2 calls per moment (deliberate + act); nothing may exceed that.
    expect(calls.length).toBeLessThanOrEqual(40);
    expect(calls.length).toBeGreaterThan(20); // and she is genuinely acting, not just idling
  });
});
