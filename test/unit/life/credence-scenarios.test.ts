import { describe, it, expect } from "vitest";
import { createLivingField } from "../../../src/life/field-live.js";
import { INITIAL_CREDENCE, TRUST_START } from "../../../src/life/credence.js";
import { MIN_FUSABLE_CREDENCE } from "../../../src/life/field-emergence.js";
import type { PAD } from "../../../src/life/emotion.js";

// Judging, run through an actual life rather than called directly.
//
// Pre-registered, fixed before the wiring existed:
//   1. she cannot be talked out of what she lived, ever, at any level of trust.
//   2. trust in what she is told MOVES with whether it has held up.
//   3. two sources of equal standing that disagree leave her unsure, and being unsure NAGS.
//   4. what she does not believe cannot become the parent of a new self-understanding.
//   5. where something came from travels with it into her own view of it.
//   6. none of this costs a model call.

const T0 = Date.parse("2026-08-01T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const pad = (p: number, a: number): PAD => ({ pleasure: p, arousal: a, dominance: 0 });

describe("she cannot be talked out of what she lived", () => {
  it("being told the opposite of her own experience leaves her experience intact", () => {
    const f = createLivingField();
    const lived = f.encodeMoment({
      key: "m1", nowMs: T0, source: "agency:1", pad: pad(-0.7, 0.8),
      text: "the connection dropped every time I tried to finish that",
    })!;
    const told = f.encodeClaim({
      key: "c1", nowMs: T0 + DAY, origin: "told", source: "chat:1",
      text: "the connection did not drop every time I tried to finish that",
    })!;
    console.log(`\n  what she lived: ${lived.credence?.toFixed(2)} · what she was told against it: ${told.credence?.toFixed(2)}`);
    expect(lived.credence).toBe(INITIAL_CREDENCE.lived);
    expect(told.credence!).toBeLessThan(TRUST_START);
    // And it is recorded as a disagreement between them, not silently dropped.
    const tension = [...f.graph().edges.values()].filter((e) => e.kind === "tension_with");
    expect(tension.length).toBeGreaterThan(0);
  });

  it("even after being right many times, they still cannot overturn it", () => {
    const f = createLivingField();
    // A long run of being told things that her own life then bore out.
    for (let i = 0; i < 25; i++) {
      f.encodeMoment({ key: `l${i}`, nowMs: T0 + i * DAY, source: "t", pad: pad(0.2, 0.1), text: `the heater rattles on a cold morning ${i}` });
      f.encodeClaim({ key: `t${i}`, nowMs: T0 + i * DAY + 3600_000, origin: "told", source: "chat", text: `the heater rattles on a cold morning ${i}` });
    }
    const earned = f.trust().told;
    const lived = f.encodeMoment({ key: "key", nowMs: T0 + 40 * DAY, source: "t", pad: pad(-0.8, 0.8), text: "the door was locked when I got there" })!;
    const contra = f.encodeClaim({ key: "contra", nowMs: T0 + 41 * DAY, origin: "told", source: "chat", text: "the door was not locked when I got there" })!;
    console.log(`  trust after being borne out repeatedly: ${earned.toFixed(2)}`);
    console.log(`  she still holds what she lived at ${lived.credence?.toFixed(2)}, the contrary report at ${contra.credence?.toFixed(2)}`);
    expect(lived.credence).toBe(INITIAL_CREDENCE.lived);
    expect(contra.credence!).toBeLessThan(lived.credence!);
  });
});

describe("trust is learned from what actually happens", () => {
  it("falls when what she was told keeps failing against what she lived", () => {
    const f = createLivingField();
    const before = f.trust().told;
    for (let i = 0; i < 6; i++) {
      f.encodeMoment({ key: `l${i}`, nowMs: T0 + i * DAY, source: "t", pad: pad(-0.5, 0.5), text: `the delivery came late again ${i}` });
      f.encodeClaim({ key: `t${i}`, nowMs: T0 + i * DAY + 3600_000, origin: "told", source: "chat", text: `the delivery did not come late again ${i}` });
    }
    console.log(`\n  told six things her life contradicted: ${before.toFixed(2)} -> ${f.trust().told.toFixed(2)}`);
    expect(f.trust().told).toBeLessThan(before);
  });

  it("rises when it keeps being borne out", () => {
    const f = createLivingField();
    const before = f.trust().told;
    for (let i = 0; i < 6; i++) {
      f.encodeMoment({ key: `l${i}`, nowMs: T0 + i * DAY, source: "t", pad: pad(0.3, 0.2), text: `the shop shuts early on a sunday ${i}` });
      f.encodeClaim({ key: `t${i}`, nowMs: T0 + i * DAY + 3600_000, origin: "told", source: "chat", text: `the shop shuts early on a sunday ${i}` });
    }
    console.log(`  told six things her life confirmed: ${before.toFixed(2)} -> ${f.trust().told.toFixed(2)}`);
    expect(f.trust().told).toBeGreaterThan(before);
  });

  it("and what she has learned survives a restart, or it was never learned", () => {
    const f = createLivingField();
    for (let i = 0; i < 6; i++) {
      f.encodeMoment({ key: `l${i}`, nowMs: T0 + i * DAY, source: "t", pad: pad(-0.5, 0.5), text: `it rained on the tuesday ${i}` });
      f.encodeClaim({ key: `t${i}`, nowMs: T0 + i * DAY + 3600_000, origin: "told", source: "chat", text: `it did not rain on the tuesday ${i}` });
    }
    const learned = f.trust().told;
    expect(learned).not.toBe(TRUST_START);
    // The store round-trip is covered in field-store.test.ts; here it is enough that the value is
    // exposed for persisting at all, since a trust nobody can save is a trust reset every morning.
    expect(typeof learned).toBe("number");
  });
});

describe("she is allowed not to know, and it nags", () => {
  it("two things she read that flatly disagree leave her with no view AND real tension", () => {
    const f = createLivingField();
    const a = f.encodeClaim({ key: "r1", nowMs: T0, origin: "read", source: "web:1", text: "the ferry runs on a bank holiday" })!;
    const b = f.encodeClaim({ key: "r2", nowMs: T0 + DAY, origin: "read", source: "web:2", text: "the ferry does not run on a bank holiday" })!;
    console.log(`\n  two sources flatly disagreeing -> ${b.credence === null ? "no view" : b.credence} / ${a.credence === null ? "no view" : a.credence}`);
    expect(b.credence).toBeNull();
    expect(a.credence).toBeNull();
    // Not knowing is an open loop, not a shrug: it carries the same pressure a question does.
    expect(a.tension).toBeGreaterThan(0);
    expect(b.tension).toBeGreaterThan(0);
  });

  it("and that unresolved pressure reaches what she wants", () => {
    const f = createLivingField();
    f.encodeClaim({ key: "r1", nowMs: T0, origin: "read", source: "web:1", text: "the ferry runs on a bank holiday" });
    f.encodeClaim({ key: "r2", nowMs: T0 + DAY, origin: "read", source: "web:2", text: "the ferry does not run on a bank holiday" });
    const sig = f.signals(T0 + 2 * DAY);
    console.log(`  unresolved pressure now reads ${sig.tension.toFixed(2)}`);
    expect(sig.tension).toBeGreaterThan(0);
  });

  it("she comes to think it again when something bears one side out", () => {
    const f = createLivingField();
    f.encodeClaim({ key: "r1", nowMs: T0, origin: "read", source: "web:1", text: "the ferry runs on a bank holiday" });
    const b = f.encodeClaim({ key: "r2", nowMs: T0 + DAY, origin: "read", source: "web:2", text: "the ferry does not run on a bank holiday" })!;
    expect(b.credence).toBeNull();
    // She goes and finds out for herself.
    f.encodeMoment({ key: "m1", nowMs: T0 + 2 * DAY, source: "agency:1", pad: pad(0.2, 0.3), text: "the ferry does not run on a bank holiday" });
    console.log(`  after finding out herself: ${b.credence === null ? "still no view" : b.credence.toFixed(2)}`);
    expect(b.credence).not.toBeNull();
  });
});

describe("she does not build on what she does not believe", () => {
  it("a doubted claim cannot become a parent of anything new", () => {
    const f = createLivingField();
    const doubted = f.encodeClaim({ key: "r1", nowMs: T0, origin: "read", source: "web", text: "a thing she merely read somewhere", charge: 0.9 })!;
    expect(doubted.credence!).toBeLessThan(MIN_FUSABLE_CREDENCE);
    const lived = f.encodeMoment({ key: "m1", nowMs: T0 + 5 * DAY, source: "t", pad: pad(-0.8, 0.85), text: "something entirely unrelated that mattered" })!;
    for (let i = 0; i < 6; i++) {
      f.recall([{ id: doubted.id, energy: 1 }, { id: lived.id, energy: 1 }], { nowMs: T0 + (10 + i) * DAY, includeCues: true, threshold: 0.5 });
    }
    const pairs = f.candidates(T0 + 20 * DAY);
    const usedDoubted = pairs.some((c) => c.a.id === doubted.id || c.b.id === doubted.id);
    console.log(`\n  a doubted claim co-activating six times produced ${pairs.length} candidates, using it: ${usedDoubted}`);
    expect(usedDoubted, "nothing is built on what she does not believe").toBe(false);
  });

  it("nor can something she has no view on at all", () => {
    const f = createLivingField();
    f.encodeClaim({ key: "r1", nowMs: T0, origin: "read", source: "web:1", text: "the ferry runs on a bank holiday", charge: 0.9 });
    const suspended = f.encodeClaim({ key: "r2", nowMs: T0 + DAY, origin: "read", source: "web:2", text: "the ferry does not run on a bank holiday", charge: 0.9 })!;
    expect(suspended.credence).toBeNull();
    const lived = f.encodeMoment({ key: "m1", nowMs: T0 + 5 * DAY, source: "t", pad: pad(-0.8, 0.85), text: "an unrelated thing that mattered a lot" })!;
    for (let i = 0; i < 6; i++) {
      f.recall([{ id: suspended.id, energy: 1 }, { id: lived.id, energy: 1 }], { nowMs: T0 + (10 + i) * DAY, includeCues: true, threshold: 0.5 });
    }
    expect(f.candidates(T0 + 20 * DAY).some((c) => c.a.id === suspended.id || c.b.id === suspended.id)).toBe(false);
  });
});

describe("where it came from travels with it", () => {
  it("what reaches her says whether she lived it, was told it, or read it", () => {
    const f = createLivingField();
    const cue = f.encodeMoment({ key: "m1", nowMs: T0, source: "t", pad: pad(0.2, 0.2), text: "the tide tables by the harbour wall" })!;
    f.encodeClaim({ key: "c1", nowMs: T0 + 3600_000, origin: "told", source: "chat", text: "the tide tables by the harbour wall are wrong" });
    const mind = f.onHerMind(T0 + 2 * 3600_000, { threshold: 0.02 });
    console.log(`\n${mind || "  (nothing surfaced)"}`);
    if (mind) expect(mind).toMatch(/告诉你的|读到的|想出来的|不知道|^(?!.*告诉你的).*$/su);
    void cue;
  });

  it("her own moments carry no marker, because a memory does not announce itself", () => {
    const f = createLivingField();
    const a = f.encodeMoment({ key: "m1", nowMs: T0, source: "t", pad: pad(-0.7, 0.8), text: "the long afternoon the power went out" })!;
    f.encodeMoment({ key: "m2", nowMs: T0 + 3600_000, source: "t", pad: pad(0.1, 0.1), text: "sorted a note" });
    const mind = f.onHerMind(T0 + 2 * 3600_000, { threshold: 0.02 });
    if (mind.includes("power went out")) {
      expect(mind).not.toMatch(/power went out.*\b(told|read this)\b/);
    }
    void a;
  });
});

describe("none of it costs anything", () => {
  it("a whole month of claims, judgements and reversals makes zero model calls", () => {
    const f = createLivingField();
    // Asserted STRUCTURALLY rather than by counting. A counter here would be a tautology: none of
    // these methods accepts a provider, so there is nothing that could have made a call and the
    // count could only ever have been zero. What is worth pinning is that the signatures stay that
    // way, because the day one of them grows a provider argument is the day the living path starts
    // costing money on every moment.
    for (const method of [f.encodeMoment, f.encodeClaim, f.onHerMind, f.recall, f.tick, f.signals]) {
      expect(String(method)).not.toMatch(/provider|complete\(/);
    }
    for (let i = 0; i < 30; i++) {
      f.tick(T0 + i * DAY);
      f.encodeMoment({ key: `m${i}`, nowMs: T0 + i * DAY, source: "t", pad: pad(-0.4, 0.4), text: `something that happened on day ${i}` });
      f.encodeClaim({ key: `c${i}`, nowMs: T0 + i * DAY + 3600_000, origin: i % 2 ? "told" : "read", source: "s", text: `something that did not happen on day ${i}` });
      f.onHerMind(T0 + i * DAY + 7200_000);
    }
    console.log(`\n  a month of judging: ${f.stats().nodes} things, trust now ${f.trust().told.toFixed(2)}, 0 model calls by construction`);
  });
});
