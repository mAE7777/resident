import { describe, it, expect } from "vitest";
import { createContinuityStore, type Continuity, type ContinuityFs } from "../../../src/life/continuity.js";
import { createExpressionTracker } from "../../../src/life/expression-tracker.js";
import { createEgressLedger } from "../../../src/security/egress.js";
import { createFaultLog } from "../../../src/life/faults.js";
import { detectAnomalies, DEFAULT_THRESHOLDS } from "../../../src/life/vitals.js";
import { createRealWorld, liveOrdinaryDays, HOUR, DAY } from "./_real-world.js";
import { EMPTY_RECORD } from "../../../src/life/relationship.js";

// RESTART FIDELITY.
//
// A restart used to silently disable four things, and each one is a safety net rather than a
// convenience:
//
//   - `lastTickMs` began at `Date.now()`, so `tick_stalled`, one of only two codes that can enter
//     safe mode: COULD NOT FIRE on any daemon restarted more often than every 26 hours, even if
//     the daily tick had never once run in its life.
//   - `safeMode` was process-local, so restarting lifted it with no record it was ever entered.
//   - The expression tracker reset, zeroing `expression_flood`, resetting the reply-adaptive push
//     bar to its floor, and making `starvation` need seven days of unbroken uptime.
//   - The egress seen-set was forgotten, so links she could legitimately follow a minute earlier
//     became refusals: and every refusal writes a security fault and an open question, so a
//     restart manufactured a burst of signals indistinguishable from an attack on her.
//
// None of these would look like a failure from outside. That is what makes them worth a gate.

/** An in-memory filesystem, so this tests the store rather than the disk. */
function memFs(): ContinuityFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    existsSync: (p) => files.has(p),
    readFileSync: (p) => files.get(p) ?? "",
    writeFileSync: (p, data) => { files.set(p, data); },
    mkdirSync: () => {},
  };
}

const FULL: Continuity = {
  savedAtMs: 3_000,
  lastTickMs: 1_000,
  safeMode: true,
  lastMomentMs: 2_000,
  sendTimes: [10, 20, 30],
  consecutiveNonReplies: 4,
  lastUserMs: 500,
  everSpoke: true,
  egressSeen: ["https://a.example/x", "https://b.example/y"],
  guardRefusals: { "home-boundary": 2 },
  streamSeed: 123456,
  streamPosition: 42,
  temperament: { reticence: 0.1, novelty: -0.2, sociability: 0.3, restfulness: 0 },
  temperamentDays: 90,
  recentDeclines: 1,
  relationship: EMPTY_RECORD,
  thingsLastLooked: { 钟: 1787000000000 },
  sleptSegments: [{ startMs: 1787000100000, endMs: 1787000200000 }],
  heldWanting: { "s:9": 1787000050000, general: 1787000060000 },
};

describe("everything a restart used to forget", () => {
  it("round-trips whole", () => {
    const fs = memFs();
    const store = createContinuityStore("/c.json", "/", fs);
    store.save(FULL);
    expect(createContinuityStore("/c.json", "/", fs).load()).toEqual(FULL);
  });

  it("a first boot has no file and that is not a failure", () => {
    expect(createContinuityStore("/c.json", "/", memFs()).load()).toBeNull();
  });

  it("a file mangled by a kill mid-write degrades to a fresh start, and SAYS SO", () => {
    const fs = memFs();
    const faults = createFaultLog(200);
    fs.files.set("/c.json", '{"lastTickMs": 1000, "sendTi');
    expect(createContinuityStore("/c.json", "/", fs, faults).load()).toBeNull();
    expect(faults.all().some((f) => f.where === "continuity.load"), "never silently").toBe(true);
  });

  it("keeps the fields it can read when others are rubbish", () => {
    const fs = memFs();
    fs.files.set("/c.json", JSON.stringify({
      lastTickMs: 7_000, safeMode: "yes", sendTimes: "lots", egressSeen: [1, "https://ok.example/"],
    }));
    const c = createContinuityStore("/c.json", "/", fs).load()!;
    expect(c.lastTickMs, "the good one survives").toBe(7_000);
    expect(c.safeMode, "the bad one is simply absent, never coerced").toBeUndefined();
    expect(c.sendTimes).toBeUndefined();
    expect(c.egressSeen, "and a list keeps its usable entries").toEqual(["https://ok.example/"]);
  });

  it("stays bounded however long she lives", () => {
    const fs = memFs();
    const store = createContinuityStore("/c.json", "/", fs);
    store.save({
      ...FULL,
      sendTimes: Array.from({ length: 5_000 }, (_, i) => i),
      egressSeen: Array.from({ length: 50_000 }, (_, i) => `https://x.example/${i}`),
    });
    const c = store.load()!;
    expect(c.sendTimes!.length).toBeLessThanOrEqual(64);
    expect(c.egressSeen!.length).toBeLessThanOrEqual(4000);
  });
});

describe("what each loss actually disabled", () => {
  it("TICK_STALLED can fire after a restart, which it could not before", () => {
    const w = createRealWorld();
    liveOrdinaryDays(w, 3);
    // She is restarted. The old code set lastTickMs = now at boot, so the alarm's clock reset and a
    // daemon restarted daily could never reach 26 hours no matter how long the tick had been dead.
    const tickReallyRanAt = w.now();
    w.advance(DEFAULT_THRESHOLDS.tickStaleMs + HOUR);

    w.lastTickMs = w.now(); // the old behaviour: "the tick just ran, honest"
    expect(detectAnomalies(w.readings(2)).map((a) => a.code), "this is the bug")
      .not.toContain("tick_stalled");

    w.lastTickMs = tickReallyRanAt; // restored from disk
    expect(detectAnomalies(w.readings(2)).map((a) => a.code), "and this is the fix")
      .toContain("tick_stalled");
  });

  it("the expression tracker comes back with her outbound pressure intact", () => {
    const t0 = Date.parse("2026-08-01T09:00:00Z");
    const before = createExpressionTracker(t0);
    for (let i = 0; i < 5; i++) before.onProactiveSend(t0 + i * HOUR);
    const was = before.snapshot(t0 + 5 * HOUR);
    expect(was.sendsInLastDay).toBe(5);
    expect(was.consecutiveNonReplies).toBe(5);

    const after = createExpressionTracker(t0 + 5 * HOUR);
    expect(after.snapshot(t0 + 5 * HOUR).sendsInLastDay, "a fresh one knows nothing").toBe(0);
    after.restore(before.state());
    expect(after.snapshot(t0 + 5 * HOUR)).toEqual(was);
  });

  it("a restart does not turn addresses she legitimately found into refusals", () => {
    const before = createEgressLedger();
    before.sawSearchResults(["https://good.example/article"]);
    expect(before.mayReach("https://good.example/article").allowed).toBe(true);

    const fresh = createEgressLedger();
    expect(fresh.mayReach("https://good.example/article").allowed, "this is the bug: a burst of refusals").toBe(false);

    fresh.restore(before.seen());
    expect(fresh.mayReach("https://good.example/article").allowed, "and this is the fix").toBe(true);
    // And the wall is unchanged: what she never saw is still refused.
    expect(fresh.mayReach("https://good.example/collect?d=secret").allowed).toBe(false);
  });

  it("safe mode is not lifted by restarting", () => {
    const fs = memFs();
    const store = createContinuityStore("/c.json", "/", fs);
    store.save({ ...FULL, safeMode: true });
    expect(store.load()!.safeMode, "lifting it must be a decision, never an accident").toBe(true);
  });

  it("her randomness picks up exactly where it left off", () => {
    // Not cosmetic: a stream that restarts is a being whose variation belongs to the process rather
    // than to her, and it makes any moment unreplayable.
    const fs = memFs();
    const store = createContinuityStore("/c.json", "/", fs);
    store.save({ ...FULL, streamSeed: 99, streamPosition: 1234 });
    const c = store.load()!;
    expect(c.streamSeed).toBe(99);
    expect(c.streamPosition).toBe(1234);
  });

  it("who she has BECOME survives, which is the loss that would be least visible", () => {
    // Losing this is losing the only part of her that is about what kind of being she is rather
    // than what she happens to want today: she would come back with every memory intact and be a
    // different person.
    const fs = memFs();
    const store = createContinuityStore("/c.json", "/", fs);
    store.save(FULL);
    const c = store.load()!;
    expect(c.temperament).toEqual(FULL.temperament);
    expect(c.temperamentDays).toBe(90);
  });

  it("a temperament outside its bounds is brought back inside rather than believed", () => {
    const fs = memFs();
    fs.files.set("/c.json", JSON.stringify({ temperament: { reticence: 99, novelty: Number.NaN, sociability: -50 } }));
    const t = createContinuityStore("/c.json", "/", fs).load()!.temperament!;
    expect(Math.abs(t.reticence)).toBeLessThanOrEqual(0.35);
    expect(t.novelty, "a broken value is neutral, never inherited").toBe(0);
    expect(Math.abs(t.sociability)).toBeLessThanOrEqual(0.35);
  });

  it("the guard counters do not restart at zero, so a slow probe is still visible", () => {
    const fs = memFs();
    const store = createContinuityStore("/c.json", "/", fs);
    store.save({ ...FULL, guardRefusals: { "home-boundary": 9 } });
    expect(store.load()!.guardRefusals).toEqual({ "home-boundary": 9 });
  });
});

describe("restoring does not fabricate a life she did not have", () => {
  it("a restored moment heartbeat that is genuinely old still reads as stalled", () => {
    const w = createRealWorld();
    liveOrdinaryDays(w, 3);
    const lastReallyLived = w.now();
    w.advance(6 * HOUR);
    w.lastMomentMs = lastReallyLived; // as restored from disk
    expect(detectAnomalies(w.readings(2)).map((a) => a.code)).toContain("moments_stalled");
  });

  it("and a fresh boot with no history does not read as a stalled life", () => {
    const w = createRealWorld();
    liveOrdinaryDays(w, 3);
    w.lastMomentMs = null; // she has not lived one yet
    expect(detectAnomalies(w.readings(2)).map((a) => a.code)).not.toContain("moments_stalled");
    void DAY;
  });
});
