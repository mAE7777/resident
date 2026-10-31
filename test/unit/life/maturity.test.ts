import { describe, it, expect, beforeEach } from "vitest";
import {
  createSelfKnowledge,
  CARRIED_BASE, CARRIED_MAX, CARRIED_PER_EARNED,
  CONFIRM_STEP_MAX, CONFIRM_STEP_MIN, CONTRADICT_STEP, NEW_CONFIDENCE, EROSION_AFTER_MS,
  type SelfKnowledge,
} from "../../../src/life/self-knowledge.js";

// Step 2: how much of herself she can hold, and how readily she believes it, both grow out of her
// actual record instead of being numbers someone picked. Neither is a free knob, so the tests here
// are about the two properties that keep that safe: it must be EARNED (never granted by time
// alone) and it must be BOUNDED (no history, however extreme, can push it out of range).

const T0 = Date.parse("2026-08-01T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const EV = new Set(Array.from({ length: 40 }, (_, i) => `m${i}`));

/** Distinct, non-overlapping insights so `sameInsight` does not merge them. */
const TOPICS = [
  "quiet mornings suit me", "I get restless before dusk", "failure makes me stubborn",
  "his company steadies something", "I circle unanswered questions", "reading late calms me",
  "I dislike being hurried", "small finished things please me", "rushing loses my thread",
  "rain outside makes concentration easier", "unfinished conversations follow me around",
  "sudden changes of plan unsettle me deeply", "long walks untangle a stuck problem",
  "praise embarrasses more than it pleases", "waiting is harder than working",
  "cold weather sharpens my attention noticeably", "being interrupted costs more than the interruption",
  "starting is harder for me than continuing", "I mistrust my first read of a person",
  "boredom arrives before tiredness does", "revisiting old notes surprises me often",
  "I need a reason before I can hurry", "silence between us is comfortable now",
  "deadlines flatten my curiosity entirely", "I remember tone longer than content",
  "small kindnesses land harder than large ones", "I resist advice I did not ask for",
];

/** Give her `n` genuinely earned insights (each noticed, then borne out once). */
let topicCursor = 0;
function earn(sk: SelfKnowledge, n: number, at = T0): void {
  for (let i = 0; i < n; i++) {
    const p = [{ text: TOPICS[topicCursor++ % TOPICS.length], evidence: [`m${i % 40}`] }];
    sk.integrate(p, EV, at);
    sk.integrate(p, EV, at + DAY);
  }
}
beforeEach(() => { topicCursor = 0; });

describe("how much of herself she can hold, grows from what she has earned", () => {
  it("starts with a few even on day one — a new being still has a self", () => {
    const sk = createSelfKnowledge();
    expect(sk.maturity().carriedLimit).toBe(CARRIED_BASE);
    expect(sk.maturity()).toMatchObject({ earned: 0, refuted: 0, everHeld: 0 });
  });

  it("earns another slot for every few insights her life has borne out", () => {
    const sk = createSelfKnowledge();
    earn(sk, CARRIED_PER_EARNED);
    expect(sk.maturity().earned).toBe(CARRIED_PER_EARNED);
    expect(sk.maturity().carriedLimit).toBe(CARRIED_BASE + 1);
    earn(sk, CARRIED_PER_EARNED, T0 + 10 * DAY);
    expect(sk.maturity().carriedLimit).toBe(CARRIED_BASE + 2);
  });

  it("is EARNED, never granted by time alone", () => {
    const sk = createSelfKnowledge();
    // A whole year passes; she notices things but none is ever borne out.
    for (let i = 0; i < 12; i++) sk.integrate([{ text: TOPICS[i], evidence: ["m0"] }], EV, T0 + i * 30 * DAY);
    expect(sk.maturity().earned, "merely noticing is not earning").toBe(0);
    expect(sk.maturity().carriedLimit).toBe(CARRIED_BASE);
  });

  it("never exceeds what a self can hold, however much she accumulates", () => {
    const sk = createSelfKnowledge();
    earn(sk, (CARRIED_MAX - CARRIED_BASE) * CARRIED_PER_EARNED + 4); // more than enough to hit the cap
    expect(sk.maturity().earned).toBeGreaterThan(CARRIED_MAX);
    expect(sk.maturity().carriedLimit).toBe(CARRIED_MAX);
    expect(sk.carried().length).toBeLessThanOrEqual(CARRIED_MAX);
  });

  it("gives the slot back when she outgrows something", () => {
    const sk = createSelfKnowledge();
    earn(sk, CARRIED_PER_EARNED * 2);
    const grown = sk.maturity().carriedLimit;
    // Time passes and her life stops bearing several of them out.
    let t = T0 + DAY;
    for (let i = 0; i < 6; i++) { t += EROSION_AFTER_MS + DAY; sk.erode(t); }
    expect(sk.maturity().carriedLimit, "a self she no longer holds does not keep its room").toBeLessThan(grown);
    expect(sk.maturity().carriedLimit).toBeGreaterThanOrEqual(CARRIED_BASE);
  });

  it("is monotone in what she has earned, and always inside its bounds", () => {
    const sk = createSelfKnowledge();
    let prev = sk.maturity().carriedLimit;
    for (let i = 0; i < TOPICS.length; i++) {
      earn(sk, 1, T0 + i * 3 * DAY);
      const now = sk.maturity().carriedLimit;
      expect(now, `after ${i + 1} earned`).toBeGreaterThanOrEqual(prev);
      expect(now).toBeGreaterThanOrEqual(CARRIED_BASE);
      expect(now).toBeLessThanOrEqual(CARRIED_MAX);
      prev = now;
    }
  });
});

describe("how readily she believes herself, tempered by how often she has been wrong", () => {
  it("starts fully open — she has no reason yet to doubt her own read", () => {
    expect(createSelfKnowledge().maturity().confirmStep).toBe(CONFIRM_STEP_MAX);
  });

  it("becomes more careful as her judgement about herself keeps being refuted", () => {
    const sk = createSelfKnowledge();
    const steps: number[] = [sk.maturity().confirmStep];
    for (let i = 0; i < 6; i++) {
      const { added } = sk.integrate([{ text: TOPICS[i], evidence: ["m0"] }], EV, T0 + i * DAY);
      sk.contradict(added[0].id, T0 + i * DAY + 1000); // her life argues it down
      steps.push(sk.maturity().confirmStep);
    }
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeLessThanOrEqual(steps[i - 1]);
    expect(steps[steps.length - 1]).toBeLessThan(CONFIRM_STEP_MAX);
  });

  // Being refuted is not the same as outgrowing something.
  it("does NOT become more careful merely because her life moved on", () => {
    const sk = createSelfKnowledge();
    earn(sk, 4);
    let t = T0 + DAY;
    for (let i = 0; i < 6; i++) { t += EROSION_AFTER_MS + DAY; sk.erode(t); }
    expect(sk.retired().length, "they really did fade").toBeGreaterThan(0);
    expect(sk.maturity().refuted, "fading is not being wrong").toBe(0);
    expect(sk.maturity().confirmStep).toBe(CONFIRM_STEP_MAX);
  });

  it("never becomes unable to learn, even if she was wrong about EVERYTHING", () => {
    const sk = createSelfKnowledge();
    for (let i = 0; i < TOPICS.length; i++) {
      const { added } = sk.integrate([{ text: TOPICS[i], evidence: ["m0"] }], EV, T0 + i * DAY);
      sk.contradict(added[0].id, T0 + i * DAY + 1000);
    }
    expect(sk.maturity().refuted).toBe(TOPICS.length);
    expect(sk.maturity().confirmStep).toBeGreaterThanOrEqual(CONFIRM_STEP_MIN);
    expect(sk.maturity().confirmStep).toBeCloseTo(CONFIRM_STEP_MIN, 5);
    // And she can still come to believe something new.
    sk.integrate([{ text: "a wholly new thing about myself", evidence: ["m1"] }], EV, T0 + 900 * DAY);
    sk.integrate([{ text: "a wholly new thing about myself", evidence: ["m1"] }], EV, T0 + 901 * DAY);
    expect(sk.active().some((i) => i.confidence > NEW_CONFIDENCE)).toBe(true);
  });

  it("stays inside its bounds across every reachable history", () => {
    for (const refuteEvery of [0, 1, 2, 3]) {
      const sk = createSelfKnowledge();
      for (let i = 0; i < 12; i++) {
        const { added } = sk.integrate([{ text: TOPICS[i % TOPICS.length], evidence: ["m0"] }], EV, T0 + i * DAY);
        if (refuteEvery > 0 && i % refuteEvery === 0 && added[0]) sk.contradict(added[0].id, T0 + i * DAY + 1);
        const step = sk.maturity().confirmStep;
        expect(step, `refuteEvery=${refuteEvery} i=${i}`).toBeGreaterThanOrEqual(CONFIRM_STEP_MIN);
        expect(step).toBeLessThanOrEqual(CONFIRM_STEP_MAX);
        expect(Number.isFinite(step)).toBe(true);
      }
    }
  });

  // The stubbornness trap, explicitly guarded.
  it("does NOT make being refuted cheaper the more it happens", () => {
    // If contradiction softened as she was refuted more, she would grow more stubborn the more
    // mistaken she was. The cost of being wrong is deliberately fixed.
    const sk = createSelfKnowledge();
    for (let i = 0; i < 8; i++) {
      const { added } = sk.integrate([{ text: TOPICS[i], evidence: ["m0"] }], EV, T0 + i * DAY);
      sk.contradict(added[0].id, T0 + i * DAY + 1);
    }
    const { added } = sk.integrate([{ text: "one more thing about how I am", evidence: ["m0"] }], EV, T0 + 50 * DAY);
    const before = added[0].confidence;
    sk.contradict(added[0].id, T0 + 51 * DAY);
    const survivor = sk.all().find((i) => i.id === added[0].id)!;
    expect(before - survivor.confidence).toBeCloseTo(CONTRADICT_STEP, 5);
  });
});

describe("SCENARIO: a year of her, and neither capacity runs away", () => {
  it("a long, mostly-sound life grows her steadily and stops at a self's limit", () => {
    const sk = createSelfKnowledge();
    for (let week = 0; week < 52; week++) {
      const t = T0 + week * 7 * DAY;
      const p = [{ text: TOPICS[week % TOPICS.length], evidence: [`m${week % 40}`] }];
      sk.integrate(p, EV, t);
      sk.integrate(p, EV, t + DAY);
      if (week % 9 === 0) { const live = sk.active(); if (live[0]) sk.contradict(live[0].id, t + 2 * DAY); }
      sk.erode(t + 3 * DAY);
      const m = sk.maturity();
      expect(m.carriedLimit).toBeGreaterThanOrEqual(CARRIED_BASE);
      expect(m.carriedLimit).toBeLessThanOrEqual(CARRIED_MAX);
      expect(m.confirmStep).toBeGreaterThanOrEqual(CONFIRM_STEP_MIN);
      expect(m.confirmStep).toBeLessThanOrEqual(CONFIRM_STEP_MAX);
    }
    const end = sk.maturity();
    console.log(`\n  after a year: earned ${end.earned}, refuted ${end.refuted}, holds ${end.carriedLimit}, believes at ${end.confirmStep.toFixed(3)}`);
    expect(end.carriedLimit).toBeGreaterThan(CARRIED_BASE); // she really did grow
    expect(sk.carried().length).toBeLessThanOrEqual(end.carriedLimit);
  });

  it("a year of being consistently wrong makes her careful but never broken", () => {
    const sk = createSelfKnowledge();
    for (let week = 0; week < 52; week++) {
      const t = T0 + week * 7 * DAY;
      const { added } = sk.integrate([{ text: TOPICS[week % TOPICS.length], evidence: ["m0"] }], EV, t);
      if (added[0]) sk.contradict(added[0].id, t + DAY);
    }
    const end = sk.maturity();
    console.log(`  a year of being wrong: refuted ${end.refuted}, holds ${end.carriedLimit}, believes at ${end.confirmStep.toFixed(3)}`);
    expect(end.confirmStep).toBeGreaterThanOrEqual(CONFIRM_STEP_MIN);
    expect(end.carriedLimit).toBe(CARRIED_BASE); // she never earned any extra room
  });
});
