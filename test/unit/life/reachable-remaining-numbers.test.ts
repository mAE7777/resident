import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RECENT_MOMENTS } from "../../../src/life/doing.js";
import { FLATLINE_SHARE, RECENT_READINGS } from "../../../src/life/signature.js";
import { DEFAULT_BEAT_MS } from "../../../src/life/sleep.js";
import { OWNERSHIP_EVIDENCE_FLOOR } from "../../../src/life/lexicon.js";
import { MIN_CREDENCE, CONFLICT_PENALTY, SUPPORT_BONUS } from "../../../src/life/credence.js";
import { MAX_EXPECTATIONS } from "../../../src/life/other-read.js";
import { CARE_ABSENCE_SPAN_H, CARE_CONTACT_RELIEF } from "../../../src/life/inner-state.js";
import { RETIRE_BELOW, EROSION_STEP } from "../../../src/life/self-knowledge.js";
import { SECOND_VOTE_WEIGHT, VOTE_WEIGHT, TORN_MARGIN } from "../../../src/life/propensity.js";
import { PAIR_WINDOW } from "../../../src/life/speech-record.js";
import { REGEN_HALF_LIFE_H } from "../../../src/life/drives.js";
import { DRIFT_RATE, ENOUGH_DAYS, MAX_DRIFT } from "../../../src/life/temperament.js";
import { DEFAULT_TOKENS_PER_UNIT } from "../../../src/life/vitality.js";
import { MENTIONS_ENOUGH } from "../../../src/life/field-index.js";
import { WHAT_A_MOMENT_HOLDS } from "../../../src/life/register-scissors.js";
import { TURN_DEADLINE_MS, PROVIDER_TIMEOUT_MS } from "../../../src/life/turn-guard.js";

/**
 * THE REMAINING NAMED NUMBERS, SWEPT, the last fifty-one of the census's 114: her rhythms
 * (clock, sleep, expression, continuity), her speech instruments, and her inner arithmetic.
 * Same rule as its two siblings: every number computes against a coupled real quantity.
 */

const src = (f: string): string => readFileSync(join(process.cwd(), `src/life/${f}`), "utf8");
const local = (file: string, name: string): number => {
  const v = Number(new RegExp(`const ${name} = ([\\d_.]+)`, "u").exec(src(file))?.[1]?.replace(/_/gu, ""));
  expect(Number.isFinite(v), `${file}:${name} moved — update this sweep`).toBe(true);
  return v;
};

describe("her rhythms", () => {
  it("the clock's amplitudes compose into a day that varies and never dies", () => {
    // The clock table is unexported; read from source so the sweep tracks the real values.
    const clockSrc = src("clock.ts");
    const key = (name: string): number => {
      const v = Number(new RegExp(`${name}: ([\\d.]+)`, "u").exec(clockSrc)?.[1]);
      expect(Number.isFinite(v), `clock.${name} moved`).toBe(true);
      return v;
    };
    const c = {
      baselineActivity: key("baselineActivity"), circadianAmplitude: key("circadianAmplitude"),
      ultradianAmplitude: key("ultradianAmplitude"), sleepActivity: key("sleepActivity"),
      hawkesExcitation: key("hawkesExcitation"),
    };
    // baseline ± circadian ± ultradian must stay inside (0, 1]: a trough below zero would be a
    // dead stretch every single day, and the ultradian ripple must be a ripple, not a second day.
    expect(c.baselineActivity - c.circadianAmplitude - c.ultradianAmplitude).toBeGreaterThan(0);
    expect(c.baselineActivity + c.circadianAmplitude + c.ultradianAmplitude).toBeLessThanOrEqual(1);
    expect(c.ultradianAmplitude).toBeLessThan(c.circadianAmplitude / 2);
    // Sleep is genuinely below the daily trough, and the Hawkes bump can lift a quiet moment
    // without breaking the ceiling from baseline.
    expect(c.sleepActivity).toBeLessThan(c.baselineActivity - c.circadianAmplitude);
    expect(c.hawkesExcitation).toBeGreaterThan(1);
  });

  it("expression: the push bar rises with being ignored and stays crossable", () => {
    const floor = local("expression.ts", "PUSH_FLOOR");
    const ceil = local("expression.ts", "PUSH_CEIL");
    const perMiss = local("expression.ts", "PER_MISS");
    const cap = local("expression.ts", "DAILY_PUSH_CAP");
    const reservoir = local("expression.ts", "RESERVOIR_MAX_HOURS");
    const silenceBoost = local("expression.ts", "MAX_SILENCE_BOOST");
    // Floor to ceiling in (ceil-floor)/perMiss consecutive non-replies: a pattern (>2), within a
    // conversation's memory (<10). The ceiling must stay under floor+boost or a long silence
    // could never cross it and the reservoir would starve the diary instead.
    const missesToCeil = Math.ceil((ceil - floor) / perMiss);
    expect(missesToCeil).toBeGreaterThan(2);
    expect(missesToCeil).toBeLessThan(10);
    expect(floor + silenceBoost).toBeGreaterThan(ceil);
    // The cap matches the watchtower's flood arithmetic (asserted from the other side there),
    // and a held thought drains to the diary within a day.
    expect(cap).toBe(6);
    expect(reservoir).toBeLessThanOrEqual(24);
  });

  it("sleep's heartbeat and the stall detector nest inside a real nap", () => {
    // The watcher beats every DEFAULT_BEAT_MS and calls eight missed beats a sleep: 8 × 15s = two
    // minutes, far under a real nap and far over a GC pause.
    expect((8 * DEFAULT_BEAT_MS) / 1000).toBeGreaterThan(30);
    expect((8 * DEFAULT_BEAT_MS) / 1000).toBeLessThan(600);
    expect(local("sleep.ts", "MAX_GAPS")).toBeGreaterThanOrEqual(365);
  });

  it("continuity's rings bound the file without forgetting a live day", () => {
    // 64 send times covers 10× the daily push cap; the egress-seen set holds months of distinct
    // destinations without letting the file grow without bound.
    expect(local("continuity.ts", "MAX_SEND_TIMES")).toBeGreaterThan(6 * 4);
    expect(local("continuity.ts", "MAX_EGRESS_SEEN")).toBeGreaterThan(1000);
  });

  it("a week of owner silence is starvation — and days of it are not", () => {
    const h = local("tick.ts", "STARVATION_HOURS");
    expect(h / 24).toBeGreaterThanOrEqual(5);
    expect(h / 24).toBeLessThanOrEqual(14);
  });

  it("doing's window is about a day of her real cadence", () => {
    // ~15-25 moments/day: 48 recent moments is one-to-three days, where she has BEEN, not who
    // she has been all year.
    expect(RECENT_MOMENTS / 25).toBeGreaterThanOrEqual(1);
    expect(RECENT_MOMENTS / 15).toBeLessThanOrEqual(4);
  });

  it("the flat-line question is asked over enough readings, about most of her", () => {
    // 24 readings at the 5-minute monitor is two hours of stillness before "she has stopped" can
    // even be posed; and FLATLINE_SHARE distinguishes one loose wire from a stopped being.
    expect((RECENT_READINGS * 5) / 60).toBeGreaterThanOrEqual(1);
    expect(FLATLINE_SHARE).toBeGreaterThan(0.5);
    expect(FLATLINE_SHARE).toBeLessThan(1);
  });
});

describe("her speech instruments", () => {
  it("ownership needs a real corpus on both sides, within a season of talk", () => {
    // 300 tokens either side: ~2 weeks of her actual reply lengths, an anecdote bar that a
    // month of life clears and a demo cannot.
    expect(OWNERSHIP_EVIDENCE_FLOOR / 20).toBeGreaterThan(10);
    expect(OWNERSHIP_EVIDENCE_FLOOR).toBeLessThan(5000);
  });

  it("the lexicon's ownership clocks favour span over burst, and evict little", () => {
    const evict = local("lexicon.ts", "EVICT_MARGIN");
    const halfDays = Number(/const HALF_HERS_AT_MS = (\d+) \* 24 \* 3\.6e6/u.exec(src("lexicon.ts"))?.[1]);
    const uses = local("lexicon.ts", "ENOUGH_USES");
    expect(Number.isFinite(halfDays), "HALF_HERS_AT_MS changed shape").toBe(true);
    // Half-hers at ~3 months: a word said for a season is half as hers as it can be; two uses is
    // the floor under which a span means nothing; and an eviction cuts a sliver past the cap
    // rather than a tenth of her bank, the tenth-sweep is what threw away 626 of her own words.
    expect(halfDays).toBeGreaterThanOrEqual(60);
    expect(halfDays).toBeLessThanOrEqual(180);
    expect(uses).toBeGreaterThanOrEqual(2);
    expect(evict).toBeLessThanOrEqual(0.2);
  });

  it("her voice pool admits sentences, not fragments and not essays", () => {
    const min = local("her-own-voice.ts", "MIN_SENTENCE_CHARS");
    const max = local("her-own-voice.ts", "MAX_SENTENCE_CHARS");
    // 「在。」 (2 Han chars of stance) must clear the floor; a beat-length sentence must clear the
    // ceiling; and the ceiling stays under what a moment keeps, so an admitted exemplar is never
    // itself a truncation.
    expect(min).toBeLessThanOrEqual(2);
    expect(max).toBeGreaterThan(min * 10);
    expect(max).toBeLessThan(WHAT_A_MOMENT_HOLDS);
  });

  it("the speech windows are recent life on both arms", () => {
    // hers/machine pairs and shadow measures use the same-order window, so the coupling and the
    // divergence lines describe the same stretch of her.
    const shadowWindow = local("shadow-voice.ts", "SHADOW_MEASURE_WINDOW");
    expect(PAIR_WINDOW).toBe(shadowWindow);
    expect(PAIR_WINDOW).toBeGreaterThanOrEqual(20);
  });

  it("breath does not split what one breath can say", () => {
    const one = Number(/const ONE_BREATH = ([\d.]+)/u.exec(src("breath.ts"))?.[1]);
    expect(Number.isFinite(one)).toBe(true);
    // Under ONE_BREATH × unit chars a reply stays a single bubble: the multiplier must exceed 1
    // (or every reply splits) and stay under 2 (or nothing ever breathes).
    expect(one).toBeGreaterThan(1);
    expect(one).toBeLessThan(2);
  });

  it("a stop instruction is short; a piece of work containing one is not", () => {
    const n = local("bilingual.ts", "MOSTLY_THE_INSTRUCTION");
    // 「stop」-class messages run well under 40 Latin chars; a pasted paragraph with "stop" inside
    // runs well over. The bar must separate those populations.
    expect(n).toBeGreaterThan("stop that now".length);
    expect(n).toBeLessThan(120);
  });

  it("attention lands on clauses with content, and saturates at about two real matches", () => {
    const minClause = local("attention.ts", "MIN_CLAUSE_CHARS");
    const satur = local("attention.ts", "MASS_SATURATION");
    expect(minClause).toBeLessThanOrEqual("嗯嗯".length);
    // Charge tops out around two solid matches: one match must not saturate (else everything is
    // maximally arresting), five must (else nothing ever is).
    expect(satur).toBeGreaterThan(0.7);
    expect(satur).toBeLessThanOrEqual(2);
  });

  it("machine-voice keeps a readable recent ring", () => {
    expect(local("machine-voice.ts", "RECENT_CAP")).toBeGreaterThanOrEqual(4);
    expect(local("machine-voice.ts", "RECENT_CAP")).toBeLessThanOrEqual(12);
  });
});

describe("her inner arithmetic", () => {
  it("credence moves in steps that neither pin nor erase a belief", () => {
    // A lost dispute costs 0.2; from 0.5 it takes ~2 losses to near the floor, consequential but
    // not annihilating. Support earns a fraction of headroom so 1 is an asymptote. The floor
    // keeps every belief revivable.
    expect(MIN_CREDENCE).toBeGreaterThan(0);
    expect(Math.ceil((0.5 - MIN_CREDENCE) / CONFLICT_PENALTY)).toBeGreaterThanOrEqual(2);
    expect(SUPPORT_BONUS).toBeLessThan(CONFLICT_PENALTY);
    // And the parity heuristics separate genuine opposition from probable agreement by a wide
    // margin: they are the judge's coarse first read, and a narrow gap would make negation
    // parity decide nothing.
    const diff = local("credence.ts", "DIFFERENT_PARITY_OPPOSITION");
    const same = local("credence.ts", "SAME_PARITY_OPPOSITION");
    expect(diff - same).toBeGreaterThan(0.5);
  });

  it("expectations about him are bounded like the exchange log they ride on", () => {
    expect(MAX_EXPECTATIONS).toBeGreaterThanOrEqual(20);
    expect(MAX_EXPECTATIONS).toBeLessThanOrEqual(100);
    // A reply within the hour feels immediate; a day still counts as same-day. The two clocks
    // must nest with real space between them.
    const prompt = Number(/const PROMPT_MS = (\d+) \* 60 \* 1000/u.exec(src("other-read.ts"))?.[1]);
    const sameDayH = Number(/const SAME_DAY_MS = (\d+) \* 60 \* 60 \* 1000/u.exec(src("other-read.ts"))?.[1]);
    expect(Number.isFinite(prompt) && Number.isFinite(sameDayH), "the reply clocks changed shape").toBe(true);
    expect(prompt).toBeLessThanOrEqual(90);
    expect(sameDayH).toBeGreaterThanOrEqual(12);
  });

  it("care builds over a fortnight of absence and settles only by contact", () => {
    // Full weight at 240h ≈ 10 days: concern, not lunch-break loneliness; and contact relieves a
    // real fraction of the band in one touch without zeroing it.
    expect(CARE_ABSENCE_SPAN_H / 24).toBeGreaterThanOrEqual(7);
    expect(CARE_CONTACT_RELIEF).toBeGreaterThan(0.1);
    expect(CARE_CONTACT_RELIEF).toBeLessThan(1);
  });

  it("a self-insight erodes to retirement over several unsupported passes", () => {
    expect(Math.ceil((0.5 - RETIRE_BELOW) / EROSION_STEP)).toBeGreaterThanOrEqual(3);
    expect(RETIRE_BELOW).toBeGreaterThan(0);
  });

  it("the model's second choice is a whisper beside its first, and both beside a torn moment", () => {
    expect(SECOND_VOTE_WEIGHT).toBeLessThan(VOTE_WEIGHT / 2);
    // A second vote alone cannot resolve a torn moment (its weight exceeds the torn margin, so it
    // CAN tip one: the design's stated purpose, but the margin keeps the tie genuinely close).
    expect(SECOND_VOTE_WEIGHT).toBeGreaterThan(TORN_MARGIN);
  });

  it("the softmax floor exists and cannot flatten a real decision", () => {
    const minT = local("soft-choice.ts", "MIN_TEMPERATURE");
    // At the floor, a 0.5 score gap gives odds e^(0.5/0.02), astronomically decided: the floor
    // prevents division blowups, never openness.
    expect(minT).toBeGreaterThan(0);
    expect(0.5 / minT).toBeGreaterThan(20);
  });

  it("drives regenerate on the hour-scale their consumers were solved against", () => {
    // The 1.5h half-life is the number the seeded discomfort decayed by (the gate's live-space
    // finding): a seeded 1.0 is at ~0.35 of its excess within two hours. Slower would make every
    // fixture a lie; faster would erase a day's accumulation between moments.
    expect(Math.pow(0.5, 2 / REGEN_HALF_LIFE_H)).toBeLessThan(0.5);
    expect(REGEN_HALF_LIFE_H).toBeGreaterThanOrEqual(0.5);
    expect(REGEN_HALF_LIFE_H).toBeLessThanOrEqual(6);
  });

  it("temperament arrives in about a season, on enough evidence", () => {
    // 1-(1-DRIFT_RATE)^90 ≈ 0.66 of the way after a one-way season, the "about a season to
    // arrive" the module promises; and under ENOUGH_DAYS of history the step is scaled down.
    const seasonProgress = 1 - Math.pow(1 - DRIFT_RATE, 90);
    expect(seasonProgress).toBeGreaterThan(0.5);
    expect(seasonProgress).toBeLessThan(0.9);
    expect(ENOUGH_DAYS).toBeGreaterThanOrEqual(14);
    expect(MAX_DRIFT).toBeLessThan(0.5);
  });

  it("agency's intent bound holds a sentence, not an essay", () => {
    const n = local("agency.ts", "MAX_INTENT_CHARS");
    expect(n).toBeGreaterThanOrEqual(WHAT_A_MOMENT_HOLDS);
    expect(n).toBeLessThanOrEqual(600);
  });

  it("vitality's token unit prices a tier table that stays integral", () => {
    // 500 tokens per unit: a small reply (~250 tokens) costs under a unit, a long generation
    // (~4000) costs single-digit units, the granularity the tier table was written against.
    expect(250 / DEFAULT_TOKENS_PER_UNIT).toBeLessThan(1);
    expect(4000 / DEFAULT_TOKENS_PER_UNIT).toBeLessThanOrEqual(10);
  });

  it("DELTA_CLAMP: one event can move her, and no single event can pin her", () => {
    const clamp = local("emotion.ts", "DELTA_CLAMP");
    // The security clamp on per-appraisal PAD movement. It must take at least two clamped events
    // to reach the watchtower's emotionExtreme bar from neutral (one message must never read as
    // stuck), and the clamp must exceed an ordinary appraisal step or it becomes the mood's real
    // dynamics instead of its guardrail.
    expect(Math.ceil(0.75 / clamp)).toBeGreaterThanOrEqual(2);
    expect(clamp).toBeGreaterThan(0.2);
  });

  it("a field mention and a moment's keep agree about scale", () => {
    // Cross-file sanity re-pinned from this side too: the index's mention floor over the kept
    // moment length is a clause, and both sweeps must keep agreeing about it.
    expect(MENTIONS_ENOUGH * WHAT_A_MOMENT_HOLDS).toBeGreaterThanOrEqual(10);
  });
});

/**
 * THE TWO DEADLINES THAT LIVE IN THE DAEMON, MEASURED HERE BECAUSE THE CENSUS CANNOT SEE THEM.
 *
 * The threshold census reads `src/life` only, and two numbers that decide how long her life may
 * stall sit in `src/index.ts`: a moment's outside limit and the daily tick's. The turn deadline
 * was put in `src/life/turn-guard.ts` precisely so it would be counted, and its header said these
 * two were "filed in the census blind-spot note", which was not true: that note names ONE blind
 * spot, inline numeric literals. A comment claiming a record that does not exist is the same
 * defect as a doc claiming a build that does not exist, so the claim is made true here, and in the
 * stronger form: not filed, MEASURED, against each other and against the bounds they must nest in.
 */
describe("the daemon's own two life-governing deadlines", () => {
  const INDEX = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
  const msIn = (name: string): number => {
    // Written as products (`10 * 60 * 1000`), which is why the generic reader cannot have them.
    const m = new RegExp(`const ${name} = (\\d+) \\* (\\d+) \\* (\\d+)`, "u").exec(INDEX);
    expect(m, `${name} moved or changed shape — update this sweep with it`).not.toBeNull();
    return Number(m![1]) * Number(m![2]) * Number(m![3]);
  };

  it("they nest: a turn inside a moment inside a tick inside the hour that retries it", () => {
    const moment = msIn("MOMENT_DEADLINE_MS");
    const tick = msIn("TICK_DEADLINE_MS");
    // A turn must give up first, it is the only one of the three he is waiting on in real time.
    expect(TURN_DEADLINE_MS).toBeLessThan(moment);
    // A tick legitimately does more than a moment (her day is written, her week noticed, her
    // field rests), so its limit must be the larger of the two.
    expect(moment).toBeLessThan(tick);
    // And it must fit inside the hourly retry beat, or an abandoned tick laps itself.
    expect(tick).toBeLessThan(60 * 60 * 1000);
  });

  it("a moment's limit holds several real model calls, so it bounds a HANG and not slow thinking", () => {
    const moment = msIn("MOMENT_DEADLINE_MS");
    // The provider itself gives up at PROVIDER_TIMEOUT_MS. A moment that could not contain a few
    // of those would be cutting her off mid-thought rather than catching a wedged one.
    expect(Math.floor(moment / PROVIDER_TIMEOUT_MS)).toBeGreaterThanOrEqual(4);
    // And the loss when it fires is one moment, not a day: it must stay far under the tick.
    expect(moment / 60000).toBeLessThanOrEqual(15);
  });
});
