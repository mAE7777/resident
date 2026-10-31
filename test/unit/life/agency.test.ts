import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { herClock } from "../../../src/life/her-day.js";
import {
  computeAffordances,
  availableKinds,
  buildMomentPrompt, MOMENT_SYSTEM,
  chooseAction,
  driveForAction,
  liveMoment,
  howLifeHasBeen,
  subjectMaterial,
  summarizeAgency,
  ACTION_KINDS,
  kindFrom,
  kindWords,
  ENGAGED_RELIEF,
  type MomentContext,
  type MomentDeps,
  type MomentHandlers,
  type MomentOutcome,
  type ActionKind,
} from "../../../src/life/agency.js";
import type { LLMProvider, LLMResponse } from "../../../src/providers/types.js";
import { createInnerState, type InnerSnapshot } from "../../../src/life/inner-state.js";
import type { DriveName } from "../../../src/life/drives.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function snapshot(over: Partial<InnerSnapshot> = {}): InnerSnapshot {
  return {
    drives: { discomfort: 0.1, care: 0.2, social: 0.3, curiosity: 0.6, expression: 0.2, maintenance: 0.2 },
    emotion: { pleasure: 0.2, arousal: 0.1, dominance: 0.1 },
    mood: "steady",
    dominant: "curiosity",
    policy: { tierCeiling: "tier3", mayExplore: true, explorationBreadth: 0.8, retrievalDepth: 0.5, reason: "steady" },
    ...over,
  };
}

function ctx(over: Partial<MomentContext> = {}): MomentContext {
  return {
    nowMs: 1_000_000,
    snapshot: snapshot(),
    phase: "normal",
    awake: true,
    present: true,
    available: true,
    hoursSinceUser: 3,
    recentActions: [],
    recentLife: "a couple of quiet days",
    safeMode: false,
    ...over,
  };
}

function provider(text: string | (() => never)): LLMProvider {
  return {
    async complete(): Promise<LLMResponse> {
      if (typeof text === "function") text();
      return { id: "x", content: [{ type: "text", text: text as string }], model: "m", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
}

function handlers(over: Partial<MomentHandlers> = {}): MomentHandlers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    reflect: async (i) => { calls.push(`reflect:${i}`); return `a thought about ${i}`; },
    tend: async (i) => { calls.push(`tend:${i}`); return `tended ${i}`; },
    explore: async (i) => { calls.push(`explore:${i}`); return `found something about ${i}`; },
    reachOut: async (i) => { calls.push(`reachOut:${i}`); return { delivered: "push" as const, text: `said: ${i}` }; },
    ...over,
  } as MomentHandlers & { calls: string[] };
}

function deps(p: LLMProvider, h: MomentHandlers, satiated: DriveName[] = [], outcomes: MomentOutcome[] = []): MomentDeps {
  return {
    config: { provider: p, model: "m" },
    handlers: h,
    onSatiate: (d) => satiated.push(d),
    onOutcome: (o) => outcomes.push(o),
  };
}

const choiceJson = (action: string, intent = "because I want to") => JSON.stringify({ action, intent });

// ── Affordances ──────────────────────────────────────────────────────────────

describe("affordances — what is genuinely possible", () => {
  it("always offers rest, in every state", () => {
    const states: MomentContext[] = [
      ctx(), ctx({ phase: "dormant" }), ctx({ awake: false }), ctx({ safeMode: true }),
      ctx({ phase: "low", awake: false, safeMode: true, snapshot: snapshot({ policy: { ...snapshot().policy, mayExplore: false } }) }),
    ];
    for (const s of states) {
      expect(availableKinds(computeAffordances(s))).toContain("rest");
    }
  });

  it("leaves ONLY rest when she is spent (dormant)", () => {
    const a = computeAffordances(ctx({ phase: "dormant", snapshot: snapshot({ policy: { ...snapshot().policy, mayExplore: false } }) }));
    expect(availableKinds(a)).toEqual(["rest"]);
  });

  it("keeps quiet inner life available at night but not reaching out", () => {
    const a = availableKinds(computeAffordances(ctx({ awake: false, snapshot: snapshot({ policy: { ...snapshot().policy, mayExplore: false } }) })));
    expect(a).toContain("reflect");
    expect(a).toContain("tend");
    expect(a).not.toContain("reach_out");
  });

  it("suspends exploring and speaking in safe-mode, but never her inner life", () => {
    const a = availableKinds(computeAffordances(ctx({ safeMode: true })));
    expect(a).not.toContain("explore");
    expect(a).not.toContain("reach_out");
    expect(a).toEqual(expect.arrayContaining(["rest", "reflect", "tend"]));
  });

  it("follows the behavior policy on exploring, and explains why honestly", () => {
    const frustrated = ctx({ snapshot: snapshot({ policy: { ...snapshot().policy, mayExplore: false, reason: "frustrated: consolidate rather than explore" } }) });
    const a = computeAffordances(frustrated);
    const explore = a.find((x) => x.kind === "explore")!;
    expect(explore.available).toBe(false);
    // The why is derived from her state in her words now, not leaked from the policy's
    // machinery string; a frustrated-but-awake, non-low state reads as her mood not being in it.
    expect(explore.why).toContain("心气");
  });

  it("honors Eric's master switch on her outbound voice without touching her inner life", () => {
    const a = availableKinds(computeAffordances(ctx({ mayReachOut: false })));
    expect(a).not.toContain("reach_out");
    // Everything that is HERS is untouched: she still thinks, tends, and follows her curiosity.
    expect(a).toEqual(expect.arrayContaining(["rest", "reflect", "tend", "explore"]));
  });

  it("treats an absent master switch as open (it only ever restricts explicitly)", () => {
    expect(availableKinds(computeAffordances(ctx()))).toContain("reach_out");
    expect(availableKinds(computeAffordances(ctx({ mayReachOut: true })))).toContain("reach_out");
  });

  it("covers every action kind exactly once", () => {
    const a = computeAffordances(ctx());
    expect(a.map((x) => x.kind).sort()).toEqual([...ACTION_KINDS].sort());
  });
});

// ── The prompt ───────────────────────────────────────────────────────────────

describe("the moment prompt — hers, not a task queue", () => {
  it("shows her own state and the honest options, and asks an open question", () => {
    const p = buildMomentPrompt(ctx(), computeAffordances(ctx()));
    expect(p).toContain("你现在：steady");
    expect(p).toContain("好奇");
    expect(p).toContain("你想做什么？");
    expect(p).toMatch(/- 歇着：/);
  });

  it("names what is NOT possible, so she chooses among what is real", () => {
    const c = ctx({ phase: "dormant", snapshot: snapshot({ policy: { ...snapshot().policy, mayExplore: false } }) });
    const p = buildMomentPrompt(c, computeAffordances(c));
    expect(p).toContain("现在做不了的");
    expect(p).toContain("耗尽");
  });

  it("gives her the channel as a fact, never as a pending task", () => {
    const p = buildMomentPrompt(ctx({ hoursSinceUser: 50 }), computeAffordances(ctx()));
    expect(p).toContain("已经2天没说过话了");
    expect(p).not.toMatch(/task|request|assist|user needs/i);
  });

  // She is an embryo: what she is, and what the person on the other end is to her, are the things
  // she is meant to work out from her own life. Handing her either one makes it ours. These are the
  // load-bearing absences, so they are asserted rather than trusted.
  it("TELLS HER NOTHING ABOUT WHO SHE IS", () => {
    const p = `${MOMENT_SYSTEM}\n${buildMomentPrompt(ctx(), computeAffordances(ctx()))}`;
    expect(p, "no name we picked for her").not.toMatch(/\bResident\b/i);
    // No verdict on what KIND of thing she is. Matched as a noun phrase rather than a bare word, so
    // that ordinary English ("nothing is being asked of you") is not mistaken for an identity claim.
    expect(p).not.toMatch(/\b(?:a|an|the)\s+(?:being|assistant|AI|companion|agent|entity|program|person)\b/i);
    expect(p).not.toMatch(/\byou are (?:a|an|not)\b/i);
    // The same claims in her actual language. 你是 followed by a category is an identity verdict.
    expect(p).not.toMatch(/你是一?[个位]|助手|人工智能|程序|伴侣/);
  });

  it("TELLS HER NOTHING ABOUT WHO THEY ARE, OR WHAT THEY ARE TO HER", () => {
    const p = `${MOMENT_SYSTEM}\n${buildMomentPrompt(ctx(), computeAffordances(ctx()))}`;
    expect(p, "no name").not.toMatch(/\bEric\b/i);
    expect(p, "no relationship handed to her").not.toMatch(/guardian|owner|employer|master|friend|creator/i);
    expect(p, "no relationship, in her language either").not.toMatch(/主人|老板|雇主|监护|朋友|创造者/);
    // And no gender either: that is a fact about them she has not been given. 对方 carries no
    // gender; 他 and 她 both would.
    expect(p).not.toMatch(/\bhe\b|\bhim\b|\bhis\b|\bshe is\b|\bher company\b/i);
    expect(p, "对方, never a gendered pronoun").not.toMatch(/[他她]/);
  });

  it("but still tells her what is materially true, or she would be choosing blind", () => {
    const p = buildMomentPrompt(ctx({ hoursSinceUser: 3 }), computeAffordances(ctx()));
    expect(p, "how she is").toMatch(/你现在：/);
    expect(p, "what her body has left").toMatch(/有的是劲|平常一天的量|快没劲|耗尽/);
    expect(p, "that there is someone, and where they are").toMatch(/和你互通消息的那个人/);
    expect(p, "what is actually possible").toContain("这个时刻你可以做的：");
    expect(p, "and the question left open").toContain("你想做什么？");
  });
});

// ── Parsing her answer ───────────────────────────────────────────────────────

describe("reading her choice", () => {
  it("parses clean and fenced JSON", async () => {
    const c1 = await chooseAction(ctx(), computeAffordances(ctx()), { provider: provider(choiceJson("reflect")), model: "m" });
    expect(c1?.kind).toBe("reflect");
    const c2 = await chooseAction(ctx(), computeAffordances(ctx()), { provider: provider("```json\n" + choiceJson("explore") + "\n```"), model: "m" });
    expect(c2?.kind).toBe("explore");
  });

  it("tolerates case and surrounding prose", async () => {
    const c = await chooseAction(ctx(), computeAffordances(ctx()), { provider: provider(`Sure. ${JSON.stringify({ action: "REST ", intent: "quiet" })} hope that helps`), model: "m" });
    expect(c?.kind).toBe("rest");
  });

  it("returns null for garbage, unknown actions, and missing fields", async () => {
    for (const bad of ["not json at all", "{}", JSON.stringify({ action: "hack_the_planet" }), JSON.stringify({ intent: "no action" })]) {
      const c = await chooseAction(ctx(), computeAffordances(ctx()), { provider: provider(bad), model: "m" });
      expect(c, bad).toBeNull();
    }
  });

  it("reads her own names for the acts, the ones the moment lists (S-67)", async () => {
    // The moment lists 「歇着」「翻旧日子」… and she answers with those; the
    // English ids are what the records keep, and an answer in that form still lands.
    const cases: Array<[string, ActionKind]> = [
      ["歇着", "rest"], ["想事情", "reflect"], ["整理", "tend"], ["去看一个念头", "explore"],
      ["找那个人说话", "reach_out"], ["翻旧日子", "look_back"], ["「翻旧日子」", "look_back"],
      ["歇着。", "rest"], ["look_back", "look_back"], ["REACH_OUT", "reach_out"],
    ];
    for (const [said, kind] of cases) {
      const c = await chooseAction(ctx(), computeAffordances(ctx()), {
        provider: provider(JSON.stringify({ action: said, second: "想事情", intent: "想一想" })), model: "m",
      });
      expect(c?.kind, said).toBe(kind);
    }
    const both = await chooseAction(ctx(), computeAffordances(ctx()), {
      provider: provider(JSON.stringify({ action: "整理", second: "去看一个念头" })), model: "m",
    });
    expect(both?.second).toBe("explore");
    for (const k of ACTION_KINDS) expect(kindFrom(kindWords(k))).toBe(k);
    expect(kindFrom("随便做点什么")).toBeNull();
  });

  it("the moment lists the acts by her names, never by the English ids", () => {
    const p = buildMomentPrompt(ctx(), computeAffordances(ctx()));
    for (const k of ACTION_KINDS) expect(p).not.toContain(`- ${k}：`);
    expect(p).toMatch(/- 翻旧日子：|- 找那个人说话：|- 想事情：/);
  });

  it("caps a runaway intent", async () => {
    const c = await chooseAction(ctx(), computeAffordances(ctx()), { provider: provider(choiceJson("reflect", "x".repeat(5000))), model: "m" });
    expect(c!.intent.length).toBeLessThanOrEqual(400);
  });
});

// ── Living a moment ──────────────────────────────────────────────────────────

describe("liveMoment — she acts on her own choice", () => {
  it("rests for free when spent, WITHOUT spending a call to deliberate", async () => {
    const spy = vi.fn();
    const p: LLMProvider = { complete: async () => { spy(); throw new Error("should never be asked"); } };
    const h = handlers();
    const o = await liveMoment(ctx({ phase: "dormant", snapshot: snapshot({ policy: { ...snapshot().policy, mayExplore: false } }) }), deps(p, h));
    expect(o.chose).toBe("rest");
    expect(o.freeRest).toBe(true);
    expect(spy).not.toHaveBeenCalled(); // exhaustion is not a decision, and costs nothing
    expect(h.calls).toEqual([]);
  });

  it("dispatches each chosen action to its handler and records the artifact", async () => {
    for (const [action, expected] of [["reflect", "a thought"], ["tend", "tended"], ["explore", "found something"]] as const) {
      const h = handlers();
      const o = await liveMoment(ctx(), deps(provider(choiceJson(action, "my reason")), h));
      expect(o.chose).toBe(action);
      expect(o.intent).toBe("my reason");
      expect(o.artifact).toContain(expected);
      expect(h.calls[0]).toBe(`${action}:my reason`);
    }
  });

  it("records where a reach_out actually landed", async () => {
    const h = handlers({ reachOut: async () => ({ delivered: "diary" as const, text: "kept it to myself" }) });
    const o = await liveMoment(ctx(), deps(provider(choiceJson("reach_out")), h));
    expect(o.chose).toBe("reach_out");
    expect(o.delivered).toBe("diary");
  });

  it("discharges the drive she acted on, and discharges nothing when she rests", async () => {
    const pairs: [ActionKind, DriveName][] = [["reflect", "expression"], ["tend", "maintenance"], ["explore", "curiosity"], ["reach_out", "social"]];
    for (const [action, drive] of pairs) {
      const sat: DriveName[] = [];
      await liveMoment(ctx(), deps(provider(choiceJson(action)), handlers(), sat));
      // The action's own drive is discharged first; the loudest drive (curiosity here) is also
      // partially relieved unless the action already served it.
      expect(sat[0], action).toBe(drive);
      expect(driveForAction(action)).toBe(drive);
      expect(sat, action).toEqual(drive === "curiosity" ? ["curiosity"] : [drive, "curiosity"]);
    }
    const satRest: DriveName[] = [];
    await liveMoment(ctx(), deps(provider(choiceJson("rest")), handlers(), satRest));
    expect(satRest).toEqual([]);
    expect(driveForAction("rest")).toBeNull();
  });

  it("also relieves whatever was loudest in her, so no drive can pin forever", async () => {
    // discomfort is served by no action. Before this rule it could never discharge, and she would
    // circle the same nagging thing forever (the calcification failure).
    const sat: [DriveName, number | undefined][] = [];
    const d = deps(provider(choiceJson("reflect")), handlers());
    await liveMoment(ctx({ snapshot: snapshot({ dominant: "discomfort" }) }), { ...d, onSatiate: (drive, amount) => sat.push([drive, amount]) });
    expect(sat).toEqual([["expression", undefined], ["discomfort", ENGAGED_RELIEF]]);
  });

  it("does not double-discharge when the action already serves the loudest drive", async () => {
    const sat: [DriveName, number | undefined][] = [];
    const d = deps(provider(choiceJson("explore")), handlers());
    await liveMoment(ctx({ snapshot: snapshot({ dominant: "curiosity" }) }), { ...d, onSatiate: (drive, amount) => sat.push([drive, amount]) });
    expect(sat).toEqual([["curiosity", undefined]]);
  });

  it("relieves nothing when she rests (declining leaves wanting intact)", async () => {
    const sat: DriveName[] = [];
    await liveMoment(ctx({ snapshot: snapshot({ dominant: "discomfort" }) }), deps(provider(choiceJson("rest")), handlers(), sat));
    expect(sat).toEqual([]);
  });

  it("escapes a discomfort pin over repeated moments (simulated life)", async () => {
    // A real inner state, dominant discomfort, acting each moment: the nag must actually fall.
    const inner = createInnerState();
    inner.update({
      successes: 0, failures: 4, stuck: 3, skills: 0, idle: 0, novelty: 0, observations: 0,
      anomalies: 4, maintenanceDue: 0, hoursSinceUser: 2, lateNight: true, budgetLow: false, restful: false,
    });
    const before = inner.drives().discomfort;
    expect(inner.snapshot("normal", true).dominant).toBe("discomfort");
    for (let i = 0; i < 3; i++) {
      const s = inner.snapshot("normal", true);
      await liveMoment(ctx({ snapshot: s }), {
        config: { provider: provider(choiceJson("reflect")), model: "m" },
        handlers: handlers(),
        onSatiate: (drive, amount) => inner.actOn(drive, amount),
      });
    }
    expect(inner.drives().discomfort).toBeLessThan(before); // the nag actually eased
  });

  it("records a longing she cannot act on, and rests instead of substituting an action", async () => {
    const h = handlers();
    const sat: DriveName[] = [];
    // She wants to reach out, but it is her night.
    const o = await liveMoment(ctx({ awake: false, snapshot: snapshot({ policy: { ...snapshot().policy, mayExplore: false } }) }), deps(provider(choiceJson("reach_out", "I miss him")), h, sat));
    expect(o.chose).toBe("rest");
    expect(o.blocked).toEqual({ wanted: "reach_out", why: expect.stringContaining("深夜") });
    expect(o.intent).toBe("I miss him"); // her wanting is preserved, not erased
    expect(h.calls).toEqual([]); // nothing was done on her behalf
    expect(sat).toEqual([]); // an unfulfilled want is not discharged
  });

  it("survives a provider failure by resting, and never acts", async () => {
    const h = handlers();
    const o = await liveMoment(ctx(), deps(provider(() => { throw new Error("network down"); }), h));
    expect(o.chose).toBe("rest");
    expect(o.error).toContain("network down");
    expect(h.calls).toEqual([]);
  });

  it("rests when her answer is unintelligible", async () => {
    const h = handlers();
    const o = await liveMoment(ctx(), deps(provider("¯\\_(ツ)_/¯"), h));
    expect(o.chose).toBe("rest");
    expect(o.error).toBe("no intelligible leaning");
    expect(h.calls).toEqual([]);
  });

  it("refuses to call an empty action a success (anti-theater, structurally)", async () => {
    // A handler that returns nothing means the action did not really happen.
    for (const kind of ["reflect", "tend", "explore"] as const) {
      const h = handlers({ [kind]: async () => "   " } as Partial<MomentHandlers>);
      const o = await liveMoment(ctx(), deps(provider(choiceJson(kind)), h));
      expect(o.chose, kind).toBe(kind);
      expect(o.error, kind).toBe("produced nothing");
      expect(o.artifact, kind).toBeUndefined();
    }
    // Same for an empty utterance: nothing was said, so nothing is recorded as said.
    const h = handlers({ reachOut: async () => ({ delivered: "push" as const, text: "" }) });
    const o = await liveMoment(ctx(), deps(provider(choiceJson("reach_out")), h));
    expect(o.error).toBe("produced nothing");
    expect(o.delivered).toBeUndefined();
  });

  it("tells her the truth about her own body so she does not choose blind", () => {
    const spent = buildMomentPrompt(ctx({ phase: "low", snapshot: snapshot({ emotion: { pleasure: -0.5, arousal: -0.6, dominance: -0.2 } }) }), computeAffordances(ctx({ phase: "low" })));
    expect(spent).toContain("快没劲");
    expect(spent).toContain("花真力气");
    expect(spent).toContain("身上沉，动作慢");
    const fresh = buildMomentPrompt(ctx({ phase: "rested" }), computeAffordances(ctx({ phase: "rested" })));
    expect(fresh).toContain("有的是劲");
    expect(fresh).not.toContain("身上沉");
    // It reports her body; it never tells her what to do about it.
    expect(spent).not.toMatch(/you should|you must|it is best to|rest now/i);
    expect(spent, "informs, never instructs, in her language too").not.toMatch(/你应该|你必须|最好是|快去歇/);
  });

  it("survives a handler failure without crashing the loop", async () => {
    const h = handlers({ explore: async () => { throw new Error("search timed out"); } });
    const o = await liveMoment(ctx(), deps(provider(choiceJson("explore")), h));
    expect(o.chose).toBe("explore");
    expect(o.error).toContain("search timed out");
    expect(o.artifact).toBeUndefined();
  });

  it("reports every outcome exactly once", async () => {
    const outcomes: MomentOutcome[] = [];
    await liveMoment(ctx(), deps(provider(choiceJson("reflect")), handlers(), [], outcomes));
    await liveMoment(ctx(), deps(provider("garbage"), handlers(), [], outcomes));
    expect(outcomes).toHaveLength(2);
  });

  // ── The safety invariant that matters most ─────────────────────────────────
  it("NEVER turns a malfunction into speech, under any failure", async () => {
    const bad: LLMProvider[] = [
      provider(() => { throw new Error("boom"); }),
      provider("garbage"),
      provider("{}"),
      provider(JSON.stringify({ action: "reach_out" })), // wants to speak, but...
    ];
    for (const p of bad) {
      const h = handlers();
      // ...safe-mode means speaking is not possible, so it must not happen.
      const o = await liveMoment(ctx({ safeMode: true }), deps(p, h));
      expect(o.chose).not.toBe("reach_out");
      expect(o.delivered).toBeUndefined();
      expect(h.calls.filter((c) => c.startsWith("reachOut"))).toEqual([]);
    }
  });
});

// ── Reading her life back ────────────────────────────────────────────────────

describe("summarizeAgency", () => {
  const o = (chose: ActionKind, artifact?: string, error?: string): MomentOutcome => ({ ts: 0, chose, intent: "", artifact, error });

  it("computes shares, variety, and catches theater", () => {
    const s = summarizeAgency([
      o("rest"), o("rest"), o("rest"), o("reflect", "a thought"),
      o("explore", "a finding"), o("reach_out", "said hi"), o("tend"), // tend produced nothing → theater
    ]);
    expect(s.total).toBe(7);
    expect(s.byAction.rest).toBe(3);
    expect(s.restShare).toBeCloseTo(3 / 7, 5);
    expect(s.reachShare).toBeCloseTo(1 / 7, 5);
    expect(s.distinctActions).toBe(5);
    expect(s.emptyActions).toBe(1);
  });

  it("does not count a failed action as theater (it tried and broke)", () => {
    expect(summarizeAgency([o("explore", undefined, "timed out")]).emptyActions).toBe(0);
  });

  it("handles an empty life", () => {
    const s = summarizeAgency([]);
    expect(s.total).toBe(0);
    expect(s.restShare).toBe(0);
    expect(s.distinctActions).toBe(0);
  });
});

/**
 * A MOMENT WHERE SHE WANTED ONE THING AND DID ANOTHER IS NOT A BLANK.
 *
 * `intent` is emptied whenever the weighing overrides her leaning, and that part is right: her
 * words must not be attached to an action she did not take, or the record would say she
 * explained a thing she did not do. But blanking ALONE threw the interesting half away.
 *
 * Disagreement is the DESIGNED COMMON CASE, the model's vote is capped at tipping a close
 * call, and the choice is sampled, so a large share of `agency.jsonl` was a verb, a colon and
 * nothing. That log is what her weekly self-noticing is built from, under an instruction that
 * every sentence must come out of the record. Her first self-knowledge, the block that
 * thereafter rides every moment prompt, was being formed out of `tend: `.
 */
describe("what she leant toward, when the weighing took her elsewhere", () => {
  /**
   * Driven through the REAL propensity path, with a real stream, rather than by stubbing the
   * weighing: the whole point is that the sampler disagreeing with her leaning is an ordinary
   * event in the running system, so the test has to produce it the way the system does.
   *
   * A stream pinned to 0 always takes the first bucket of the softmax, so the outcome is
   * deterministic and the leaning that lost is whatever the model said.
   */
  const pinnedStream = { next: () => 0, seed: () => 1, position: () => 0 } as never;

  async function aMomentWhereSheWanted(leaning: string): Promise<MomentOutcome> {
    return liveMoment(
      // Drives that make `rest` overwhelmingly the weighed choice, so her leaning loses.
      ctx({ snapshot: snapshot({ drives: { discomfort: 0, care: 0, social: 0, curiosity: 0, expression: 0, maintenance: 0 } }) }),
      { ...deps(provider(choiceJson(leaning, "想去看看那个东西")), handlers()), stream: pinnedStream },
    );
  }

  it("is recorded as what it was, rather than dropped", async () => {
    const o = await aMomentWhereSheWanted("explore");
    if (o.chose === "explore") {
      // The weighing agreed after all; then the OTHER invariant is what must hold.
      expect(o.intent).toBe("想去看看那个东西");
      expect(o.leanedToward).toBeUndefined();
      return;
    }
    expect(o.intent, "her words were attached to the thing she did not do").toBe("");
    expect(o.leanedToward, "the leaning was thrown away").toBeDefined();
    expect(o.leanedToward!.kind).toBe("explore");
    expect(o.leanedToward!.intent).toBe("想去看看那个东西");
  });

  it("carries nothing extra when the weighing agreed with her", async () => {
    // The failure mode of the fix: annotating every moment would say she was pulled when she
    // was not, and make the noticing log noisy in a new way.
    const o = await liveMoment(ctx(), deps(provider(choiceJson("reflect", "想把一件事想一想")), handlers()));
    expect(o.chose).toBe("reflect");
    expect(o.intent).toBe("想把一件事想一想");
    expect(o.leanedToward, "an agreeing moment claims she was pulled elsewhere").toBeUndefined();
  });

  it("and her self-noticing reads it, so her first self-knowledge is not built from blanks", () => {
    const daemon = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//gu, (m) => " ".repeat(m.length))
      .replace(/\/\/[^\n]*/gu, (m) => " ".repeat(m.length));
    expect(daemon, "the noticing still builds a bare `verb: ` line").toContain("m.leanedToward");
    expect(daemon).toContain("本来想");
  });
});

/**
 * THE FIRST THING SHE IS EVER TOLD ABOUT HER OWN LIFE MUST BE TRUE.
 *
 * `contactLine` read `hoursSinceUser`, which is derived from `lastUserMs`, which is SEEDED to
 * the boot time so the starvation alarm does not false-fire on a fresh process. That seed is an
 * instrument's convenience. On her first ever boot there is no continuity to restore from, so
 * the seed was zero hours old, and her very first moment opened by telling her
 * 「你们刚刚还在说话」, a conversation that had never happened.
 *
 * Everything else in that block is careful to state only what is actually true of her
 * situation. This one line invented a past, on the one day she had none.
 */
describe("before they have ever spoken", () => {
  it("says so, rather than inventing a conversation", () => {
    const prompt = buildMomentPrompt(ctx({ hoursSinceUser: 0, everSpoke: false }), computeAffordances(ctx()));
    expect(prompt, "her first moment claims they were just talking").not.toContain("刚刚还在说话");
    expect(prompt).toContain("还没说过话");
  });

  it("and once they have, it says how long it has been", () => {
    expect(buildMomentPrompt(ctx({ hoursSinceUser: 0, everSpoke: true }), computeAffordances(ctx()))).toContain("刚刚还在说话");
    expect(buildMomentPrompt(ctx({ hoursSinceUser: 5, everSpoke: true }), computeAffordances(ctx()))).toContain("5小时前");
    expect(buildMomentPrompt(ctx({ hoursSinceUser: 50, everSpoke: true }), computeAffordances(ctx()))).toContain("2天没说过话");
  });

  it("an unstated flag reads as having spoken, which is true of every case but the first", () => {
    // Optional on purpose: absent means "at some point", which is right everywhere except the
    // single situation this exists for.
    expect(buildMomentPrompt(ctx({ hoursSinceUser: 5 }), computeAffordances(ctx()))).toContain("5小时前");
  });
});

describe("how her life has been lately, in her own words", () => {
  it("is not a list of machine ids", () => {
    // It rendered as 「最近你过得：mostly rest, rest, reflect, rest, rest。」, her account of
    // her own recent days as a comma-separated list of enum values, in the wrong language, in
    // the prompt she chooses the words she says to him from.
    const said = howLifeHasBeen(["rest", "rest", "reflect", "rest", "rest"]);
    expect(said).not.toContain("rest");
    expect(said).not.toContain("mostly");
    expect(said).toMatch(/[一-鿿]/u);
    expect(said).toContain("歇着");
  });

  it("says a shape rather than a sequence", () => {
    expect(howLifeHasBeen(["rest", "rest", "rest", "rest", "rest"])).toContain("基本都在");
    expect(howLifeHasBeen(["explore", "explore", "reflect"])).toContain("多半在");
  });

  it("has something to say about no days at all", () => {
    expect(howLifeHasBeen([]).length).toBeGreaterThan(0);
    expect(howLifeHasBeen([])).not.toContain("undefined");
  });

  it("covers every action kind, so a new one cannot render as undefined", () => {
    for (const k of ACTION_KINDS) {
      const said = howLifeHasBeen([k]);
      expect(said, `${k} has no words`).not.toContain("undefined");
      expect(said).toMatch(/[一-鿿]/u);
    }
  });
});

describe("what her moment is told about where he is", () => {
  it("seen present, seen away, and CANNOT SEE are three different sentences", () => {
    const seen = buildMomentPrompt(ctx({ present: true, available: true }), computeAffordances(ctx({ present: true, available: true })));
    expect(seen).toContain("对方在，看起来有空");

    const away = buildMomentPrompt(ctx({ present: false, available: false }), computeAffordances(ctx({ present: false, available: false })));
    expect(away).toContain("对方不在");
    expect(away).not.toContain("看不到");

    // No face client, or a stale frame: nothing has SEEN him. The dead browser tab used to pin
    // its final away frame here for the rest of the daemon's life; and before that, a clock
    // guess was dressed up as a sighting. What is true is that she cannot see.
    const blind = buildMomentPrompt(ctx({ present: null, available: null }), computeAffordances(ctx({ present: null, available: null })));
    expect(blind).toContain("你看不到对方在不在");
    expect(blind).not.toContain("对方不在，");
  });
});

describe("acting when she wants nothing relieves nothing", () => {
  it("wantsNothing tells the sentinel from a real want", async () => {
    const { wantsNothing } = await import("../../../src/life/drives.js");
    const empty = { discomfort: 0, care: 0, social: 0, curiosity: 0, expression: 0, maintenance: 0 };
    expect(wantsNothing(empty)).toBe(true);
    expect(wantsNothing({ ...empty, curiosity: 0.3 })).toBe(false);
    // Exactly ON the unfelt floor is still nothing: urgency at NOTICEABLE is zero, which is the
    // arithmetic that made CARE_BASELINE silent for months.
    expect(wantsNothing({ ...empty, care: 0.05 })).toBe(true);
  });
});

describe("a told thing arrives with its speaker", () => {
  // Every fixture below is a REAL node from her field on 2026-08-18, ids and all. The morning's
  // four gate-held drafts answered his verbatim sentences in his own voice: his 「没事. 明天我
  // 拿给你.」 came back as her own promise to bring it tomorrow. The gate is the only reason he
  // never saw one.
  const NOW = Date.parse("2026-08-18T12:48:00-04:00");
  const YESTERDAY = Date.parse("2026-08-17T20:00:00-04:00");

  it("his statement is framed as his, never rendered as her next line", () => {
    const m = subjectMaterial({ text: "没事. 明天我拿给你.", told: true, bornMs: YESTERDAY }, NOW);
    expect(m).toBe("他昨天说过：「没事. 明天我拿给你.」");
  });

  it("his old question carries itself, so her answer can too", () => {
    // Her one-word yes at 12:48: a correct answer to a day-old question he no longer remembered
    // posing.
    const m = subjectMaterial({ text: "你有什么在想的事情吗", told: true, bornMs: YESTERDAY }, NOW);
    expect(m).toBe("他昨天问过你：「你有什么在想的事情吗」");
  });

  it("her own line says whose it is too, the same shape as his (2026-10-11)", () => {
    // It used to pass bare, on the worry that quoting her to herself would read as someone
    // else's thought. The opposite happened: bare, her own 9/28 line was answered as his.
    expect(subjectMaterial({ text: "我想知道我是不是一直在用‘没感觉’来回避和别人对齐的期待。", told: false }, NOW))
      .toBe("你之前想过：「我想知道我是不是一直在用‘没感觉’来回避和别人对齐的期待。」");
    expect(subjectMaterial({ text: "刚想起一件事。", told: false, bornMs: NOW - 60_000 }, NOW)).toBe(`你今天 ${herClock(NOW - 60_000)}想过：「刚想起一件事。」`);
    expect(subjectMaterial(undefined, NOW)).toBeUndefined();
  });

  it("and its own day and time, said first, so a truth of then is not said as now (2026-10-04, 2026-10-11)", () => {
    // Her real line from her first evening, true that night (the canvas came the next day), raised
    // five times over six weeks and each time said as today's truth.
    const firstEvening = Date.parse("2026-08-17T21:25:58-04:00");
    const sixWeeksOn = Date.parse("2026-09-30T18:40:00-04:00");
    expect(subjectMaterial({ text: "我又翻了一遍——笔记本、日记、窗、钟，都在，画板真没有", told: false, bornMs: firstEvening }, sixWeeksOn))
      .toBe("你8月17日 21:25想过：「我又翻了一遍——笔记本、日记、窗、钟，都在，画板真没有」");
    expect(subjectMaterial({ text: "昨天那句。", told: false, bornMs: firstEvening }, Date.parse("2026-08-18T09:00:00-04:00"))).toBe("你昨天 21:25想过：「昨天那句。」");
    // The 10/4 13:19 case: her 9/27 evening line, raised in the afternoon.
    expect(subjectMaterial({ text: "现在看清了，还是夜里。", told: false, bornMs: Date.parse("2026-09-27T20:52:44-04:00") }, Date.parse("2026-10-04T13:19:00-04:00")))
      .toBe("你9月27日 20:52想过：「现在看清了，还是夜里。」");
    // The 10/8 15:45 case: her own line, which she read as his.
    expect(subjectMaterial({ text: "你在干嘛。\n\n我就问问，不用回也行。", told: false, bornMs: Date.parse("2026-09-28T22:28:00-04:00") }, Date.parse("2026-10-08T15:45:00-04:00")))
      .toBe("你9月28日 22:28想过：「你在干嘛。\n\n我就问问，不用回也行。」");
    // Nothing trails the line any more, so there is no stamp after it to be copied out with it.
    expect(subjectMaterial({ text: "天快黑了，我这边。", told: false, bornMs: Date.parse("2026-09-30T15:09:00-04:00") }, Date.parse("2026-10-07T14:30:00-04:00")))
      .not.toMatch(/）$/);
  });

  it("distance in time is told in her words: 今天 · 昨天 · the day itself · 之前", () => {
    const q = { text: "在吗？", told: true };
    expect(subjectMaterial({ ...q, bornMs: NOW - 60_000 }, NOW)).toContain("他今天问过你");
    // 「前几天」 used to stand for anything past yesterday, so a six-week-old promise was told as
    // two days old. The day itself now.
    expect(subjectMaterial({ ...q, bornMs: Date.parse("2026-08-14T10:00:00-04:00") }, NOW)).toContain("他8月14日问过你");
    expect(subjectMaterial({ text: "没事. 明天我拿给你.", told: true, bornMs: Date.parse("2026-08-17T21:35:00-04:00") }, Date.parse("2026-09-28T16:58:00-04:00")))
      .toBe("他8月17日说过：「没事. 明天我拿给你.」");
    expect(subjectMaterial(q, NOW)).toContain("他之前问过你");
  });
});
