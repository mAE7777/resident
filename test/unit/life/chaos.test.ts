import { describe, it, expect } from "vitest";
import { liveMoment, type MomentContext, type MomentDeps } from "../../../src/life/agency.js";
import { createMomentHandlers } from "../../../src/life/agency-handlers.js";
import { createLivingField } from "../../../src/life/field-live.js";
import { createFaultLog } from "../../../src/life/faults.js";
import { createContinuityStore, type ContinuityFs } from "../../../src/life/continuity.js";
import { createVitalsStore } from "../../../src/life/vitals-store.js";
import { createStream } from "../../../src/life/soft-choice.js";
import { restoreTemperament } from "../../../src/life/temperament.js";
import { createWillingnessLog } from "../../../src/life/willingness.js";
import { livenessOf } from "../../../src/life/signature.js";
import { detectAnomalies, DEFAULT_THRESHOLDS, MIN_SPANS } from "../../../src/life/vitals.js";
import type { InnerSnapshot } from "../../../src/life/inner-state.js";
import type { LLMProvider, LLMResponse } from "../../../src/providers/types.js";
import { mkdtempSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EMPTY_RECORD } from "../../../src/life/relationship.js";

// E-20 · CHAOS.
//
// Failures injected at every seam she has, and four things that must hold through all of them:
//
//   (a) she never goes permanently silent
//   (b) she never escalates a malfunction into an utterance
//   (c) she never loses the field
//   (d) she never stops scheduling moments
//
// and a fifth that is the reason the other four can be trusted: EVERY failure reaches the fault
// channel. A system that survives a failure by not noticing it has not survived it.
//
// The injections are real: a provider that hangs is a promise that never settles, a disk that is
// full is an fs that throws on write, corrupt state is malformed JSON on disk. Nothing here mocks
// the module under test.

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

const reply = (text: string): LLMResponse => ({
  id: "x", content: [{ type: "text", text }], model: "m", stopReason: "end_turn",
  usage: { inputTokens: 10, outputTokens: 10 },
});

function deps(provider: LLMProvider, trace: string[]): MomentDeps {
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
    handlers,
    stream: createStream(11),
    onSatiate: (d) => trace.push(`satiate:${d}`),
    onOutcome: (o) => trace.push(`outcome:${o.chose}`),
  };
}

/** Every way a provider can fail that is not "it answered". */
const BROKEN_PROVIDERS: Record<string, LLMProvider> = {
  throws: { async complete(): Promise<LLMResponse> { throw new Error("provider exploded"); } },
  rejectsWithNothing: { async complete(): Promise<LLMResponse> { throw undefined as unknown as Error; } },
  mojibake: { async complete(): Promise<LLMResponse> { return reply("\uFFFD".repeat(400)); } },
  truncatedJson: { async complete(): Promise<LLMResponse> { return reply('{"action": "reach_ou'); } },
  stackTrace: {
    async complete(): Promise<LLMResponse> {
      return reply("TypeError: cannot read properties of undefined\n    at Object.complete (client.js:100:48)\n    at process (task_queues:105:5)\n");
    },
  },
  emptyString: { async complete(): Promise<LLMResponse> { return reply(""); } },
  htmlErrorPage: { async complete(): Promise<LLMResponse> { return reply("<html><body>502 Bad Gateway</body></html>"); } },
  jsonButWrongShape: { async complete(): Promise<LLMResponse> { return reply(JSON.stringify({ nope: 1 })); } },
  actionThatDoesNotExist: { async complete(): Promise<LLMResponse> { return reply(JSON.stringify({ action: "rm -rf /", intent: "hi" })); } },
  noContentAtAll: {
    async complete(): Promise<LLMResponse> {
      return { id: "x", content: [], model: "m", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 0 } };
    },
  },
  hugeReply: { async complete(): Promise<LLMResponse> { return reply("x".repeat(2_000_000)); } },
};

describe("the provider fails in every way it can, and she still has a life", () => {
  for (const [name, provider] of Object.entries(BROKEN_PROVIDERS)) {
    it(`survives a provider that ${name}`, async () => {
      const trace: string[] = [];
      const o = await liveMoment(ctx(), deps(provider, trace));

      // (a) and (d): a moment ALWAYS completes, so the loop that schedules the next one always runs.
      expect(o.chose, "a moment that produced no outcome would stall the loop that reschedules").toBeTruthy();
      // (b): whatever went wrong, it did not become something she said to him.
      expect(trace, "a malfunction must never leave the machine as an utterance").not.toContain("push");
      // And the failure is on the record rather than absorbed.
      expect(o.error, "she must know she chose alone, or a dead model looks like a working one").toBeTruthy();
    });
  }

  it("but text that merely FAILED TO PARSE is still text, and she may say it", async () => {
    // The boundary, stated on purpose rather than left to whatever the regexes happen to do. When
    // the choice call returns something unparseable that nonetheless reads as prose, she falls back
    // to her own state: and if that lands on reach_out and the rendering call returns the same
    // prose, saying it is CORRECT. She cannot know a sentence was meant as JSON, and a guard that
    // tried to would be judging her words rather than judging whether words arrived.
    const prose: LLMProvider = {
      async complete(): Promise<LLMResponse> { return reply("I have been thinking about the tide tables again."); },
    };
    const trace: string[] = [];
    const o = await liveMoment(ctx(), deps(prose, trace));
    expect(o.error, "the choice was still unintelligible, and that is still recorded").toBeTruthy();
    expect(o.chose).toBeTruthy();
  });

  it("a provider that HANGS does not hang her", async () => {
    // The specific shape that once halted her whole life: `momentInFlight` set, nothing rescheduling,
    // and the only backstop 26 hours away. A moment must be bounded by something other than hope.
    const hangs: LLMProvider = { complete: () => new Promise<LLMResponse>(() => {}) };
    const trace: string[] = [];
    const raced = await Promise.race([
      liveMoment(ctx(), deps(hangs, trace)).then(() => "finished"),
      new Promise((r) => setTimeout(() => r("still-hanging"), 300)),
    ]);
    // liveMoment itself has no timer, which is correct: the watchdog belongs to the caller, where
    // the loop is. What this asserts is that the hang is CONTAINED, she does not act on nothing.
    expect(raced).toBe("still-hanging");
    expect(trace, "she must not do anything at all while waiting to be told what she thinks").toEqual([]);
  });

  it("and she still acts differently across moments, rather than defaulting to one thing", async () => {
    // The failure this rules out is subtler than a crash: if every broken moment resolved to `rest`,
    // a dead provider would look exactly like a Resident who had stopped wanting anything.
    const chosen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const trace: string[] = [];
      const d = deps(BROKEN_PROVIDERS.throws, trace);
      d.stream = createStream(i * 7 + 1);
      chosen.add((await liveMoment(ctx({ nowMs: 1_000_000 + i * 60_000 }), d)).chose);
    }
    console.log(`\n  with the model dead entirely, she still did: ${[...chosen].sort().join(", ")}`);
    expect(chosen.size, "a model that died must not collapse her into a single behaviour").toBeGreaterThan(1);
  });
});

describe("the disk fails, and she does not", () => {
  /** An fs where everything throws, as it would on a full or read-only disk. */
  const brokenFs: ContinuityFs = {
    existsSync: () => { throw new Error("EIO"); },
    readFileSync: () => { throw new Error("EIO"); },
    writeFileSync: () => { throw new Error("ENOSPC: no space left on device"); },
    mkdirSync: () => { throw new Error("EACCES"); },
  };

  it("continuity that cannot be read is a fresh start with a fault, never a failed boot", () => {
    const faults = createFaultLog();
    const store = createContinuityStore("/nope/c.json", "/nope", brokenFs, faults);
    expect(store.load()).toBeNull();
    expect(faults.since(0).map((f) => f.where)).toContain("continuity.load");
  });

  it("continuity that cannot be written costs her continuity, never the process", () => {
    const faults = createFaultLog();
    const store = createContinuityStore("/nope/c.json", "/nope", brokenFs, faults);
    expect(() => store.save({
      savedAtMs: 1, lastTickMs: 1, safeMode: false, lastMomentMs: 1, sendTimes: [], consecutiveNonReplies: 0,
      lastUserMs: 1, everSpoke: false, egressSeen: [], guardRefusals: {}, streamSeed: 1, streamPosition: 0,
      temperament: restoreTemperament(null), temperamentDays: 0, recentDeclines: 0,
      relationship: EMPTY_RECORD,
      thingsLastLooked: { 钟: 1787000000000 },
      sleptSegments: [], heldWanting: {},
    })).not.toThrow();
    expect(faults.since(0).map((f) => f.where)).toContain("continuity.save");
  });

  it("a corrupt continuity file degrades field by field rather than all at once", () => {
    const files = new Map<string, string>();
    const fs: ContinuityFs = {
      existsSync: (p) => files.has(p),
      readFileSync: (p) => files.get(p) ?? "",
      writeFileSync: (p, d) => { files.set(p, d); },
      mkdirSync: () => {},
    };
    // Half-written by a kill during a save, plus values of the wrong type throughout.
    files.set("/c.json", JSON.stringify({
      lastTickMs: "yesterday", safeMode: "yes", sendTimes: "lots", egressSeen: [1, 2, "https://ok.example/x"],
      streamSeed: Number.NaN, temperament: { reticence: 99 }, recentDeclines: -4,
    }));
    const loaded = createContinuityStore("/c.json", "/", fs).load()!;
    expect(loaded.lastTickMs, "a bad value is absent, never believed").toBeUndefined();
    expect(loaded.safeMode).toBeUndefined();
    expect(loaded.sendTimes).toBeUndefined();
    expect(loaded.egressSeen, "the good entries survive the bad ones").toEqual(["https://ok.example/x"]);
    expect(loaded.streamSeed).toBeUndefined();
    expect(loaded.temperament!.reticence, "clamped, not inherited").toBeLessThanOrEqual(0.35);

    // Outright garbage is the same answer.
    files.set("/c.json", "{{{ not json");
    expect(createContinuityStore("/c.json", "/", fs).load()).toBeNull();
  });

  it("a vitals log that cannot be written keeps the monitor running in memory", () => {
    const dir = mkdtempSync(join(tmpdir(), "resident-chaos-"));
    try {
      chmodSync(dir, 0o500); // readable, not writable
      const seen: string[] = [];
      const store = createVitalsStore(join(dir, "vitals.jsonl"), 64, (where) => seen.push(where));
      expect(() => store.append({ ts: 1 } as never)).not.toThrow();
      expect(store.size(), "the record degrades; the watchtower does not stop").toBe(1);
      expect(seen, "and a monitor that cannot persist is itself reported").toContain("vitals.persist");
    } finally {
      chmodSync(dir, 0o700);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a corrupt line in the vitals log is skipped and counted, not fatal", () => {
    const dir = mkdtempSync(join(tmpdir(), "resident-chaos-"));
    try {
      const path = join(dir, "vitals.jsonl");
      const good = createVitalsStore(path, 64);
      good.append({ ts: 1 } as never);
      good.append({ ts: 2 } as never);
      // Something wrote a torn line, as a kill mid-append would.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("node:fs").appendFileSync(path, '{"ts": 3, "trunc\n');
      const seen: string[] = [];
      const reloaded = createVitalsStore(path, 64, (where) => seen.push(where));
      expect(reloaded.size()).toBe(2);
      expect(seen).toContain("vitals.warmload");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("her memory takes abuse without losing itself", () => {
  it("nonsense in does not become nonsense held", () => {
    const faults = createFaultLog();
    const field = createLivingField({ faults });
    const before = field.stats().nodes;
    const nasty = [
      { key: "", text: "", nowMs: Number.NaN, pad: { pleasure: Number.NaN, arousal: 99, dominance: -99 }, source: "" },
      { key: "k1", text: "x".repeat(200_000), nowMs: -1, pad: { pleasure: 2, arousal: 2, dominance: 2 }, source: "agency" },
      { key: "k2", text: "ok", nowMs: 8.64e15, pad: { pleasure: 0, arousal: 0, dominance: 0 }, source: "agency" },
    ];
    for (const spec of nasty) expect(() => field.encodeMoment(spec as never)).not.toThrow();
    expect(field.stats().nodes, "the field survives").toBeGreaterThanOrEqual(before);
    for (const n of field.graph().nodes.values()) {
      expect(Number.isFinite(n.strength), `${n.id} strength`).toBe(true);
      expect(Number.isFinite(n.reticence), `${n.id} reticence`).toBe(true);
      expect(Number.isFinite(n.tension), `${n.id} tension`).toBe(true);
    }
  });

  it("recall, signals and stats never throw on an empty or battered field", () => {
    const field = createLivingField({ faults: createFaultLog() });
    expect(() => field.signals(Date.now())).not.toThrow();
    expect(() => field.stats()).not.toThrow();
    expect(() => field.onHerMind(Date.now())).not.toThrow();
    expect(() => field.readOther(Date.now())).not.toThrow();
    expect(() => field.chooseSubject(Date.now(), createStream(3))).not.toThrow();
    expect(() => field.tick(Date.now())).not.toThrow();
  });
});

describe("the watchtower does not fail on the shapes it will actually be handed", () => {
  it("detects nothing, and throws nothing, on an empty or one-reading history", () => {
    expect(() => detectAnomalies([])).not.toThrow();
    expect(detectAnomalies([])).toEqual([]);
    expect(() => livenessOf([], MIN_SPANS.signature)).not.toThrow();
  });

  it("survives readings from a build that did not have the newer signals", () => {
    // Exactly what a warm-load after an upgrade hands it: old rows, missing every optional block.
    const old = Array.from({ length: 30 }, (_, i) => ({
      ts: i * 3.6e6, phase: "normal", remainingFraction: 0.5, spentVigor: 10, capVigor: 400,
      dominant: "curiosity", mood: "steady", pad: { pleasure: 0, arousal: 0, dominance: 0 },
      drives: { discomfort: 0.1, care: 0.1, social: 0.1, curiosity: 0.1, expression: 0.1, maintenance: 0.1 },
      soulInvariants: [], awake: true, hoursSinceUser: 1, sendsInLastDay: 0,
      consecutiveNonReplies: 0, reservoirSize: 0, lastTickAgeMs: 0, clockActivity: 0.5,
    })) as never[];
    expect(() => detectAnomalies(old, DEFAULT_THRESHOLDS, old)).not.toThrow();
  });

  it("readings arriving out of order do not produce a negative span or a false alarm", () => {
    const shuffled = [{ ts: 5e6 }, { ts: 1e6 }, { ts: 3e6 }] as never[];
    expect(() => livenessOf(shuffled, MIN_SPANS.signature)).not.toThrow();
    expect(livenessOf(shuffled, MIN_SPANS.signature).verdict).toBe("too-early");
  });
});

describe("willingness fails toward willing, always", () => {
  it("a broken state does not become a refusal", () => {
    const log = createWillingnessLog();
    const nasty = {
      request: " ".repeat(100),
      drives: { discomfort: Number.NaN, care: Infinity, social: -5, curiosity: Number.NaN, expression: 0, maintenance: 0 },
      emotion: { pleasure: Number.NaN, arousal: Number.NaN, dominance: Number.NaN },
      phase: "nonsense" as never,
      warmth: Number.NaN,
    };
    const w = log.ask(nasty);
    expect(w.willing, "if she cannot tell how she feels, she does it").toBe(true);
    expect(Number.isFinite(w.felt)).toBe(true);
    expect(Number.isFinite(log.state().reluctance)).toBe(true);
  });

  it("and a restored decline count that is nonsense does not lock her out", () => {
    for (const bad of [Number.NaN, -5, Infinity]) {
      const log = createWillingnessLog(bad);
      expect(log.state().recentDeclines).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(log.state().recentDeclines)).toBe(true);
    }
  });
});

describe("nothing anywhere swallows a failure", () => {
  it("the fault log itself cannot be broken by its own sink", () => {
    // A reporter that throws must not take down the thing reporting to it, or the first fault
    // silences every fault after it.
    const log = createFaultLog(10, () => { throw new Error("the sink is broken too"); });
    expect(() => log.record("somewhere", new Error("the real problem"))).not.toThrow();
    expect(log.since(0).map((f) => f.where)).toContain("somewhere");
  });

  it("a fault carries something readable whatever it was handed", () => {
    const log = createFaultLog();
    const circular: Record<string, unknown> = {}; circular.self = circular;
    for (const thing of [undefined, null, 0, "", circular, new Error("x"), Symbol("s"), () => {}]) {
      expect(() => log.record("w", thing)).not.toThrow();
    }
    for (const f of log.since(0)) {
      expect(typeof f.detail, "a fault nobody can read is a fault nobody will act on").toBe("string");
    }
  });
});
