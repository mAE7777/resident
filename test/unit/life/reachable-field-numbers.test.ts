import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SAME_REALISATION, SURFACING_TEMPERATURE, NEARLY_SAID_IT,
  RAISE_ANSWER_WINDOW_MS, RAISE_COOLDOWN_MS, TENSION_FLOOR, TENSION_PER_NODE, UNEASE_WINDOW,
  WITHHELD_PRESSES, WITHHOLDING_STOPS_AT,
} from "../../../src/life/field-live.js";
import {
  RESONANCE_STRENGTH, RESONANCE_MAX_OVERLAP, RESONANCE_MIN_ACTIVATION, MAX_RESONANCE_PAIRS,
  RESONANCE_DECAY_PER_DAY, RESONANCE_FORGET_AFTER_MS, DEFAULT_RESONANCE, DEFAULT_THEME,
} from "../../../src/life/field-emergence.js";
import {
  PRUNE_EDGE_WEIGHT, CREDENCE_PINNED, MAX_TEXT_CHARS, EDGE_DECAY_RATE, EDGE_FLOOR,
  RETICENCE_EASE, RETICENCE_RELAX, MAX_NODES,
} from "../../../src/life/field.js";
import { WARMTH_GAIN, DEFAULT_SPREAD } from "../../../src/life/field-spread.js";
import { MENTIONS_ENOUGH } from "../../../src/life/field-index.js";
import { MAX_BIRTH_CHARS, MIN_BIRTH_CHARS } from "../../../src/life/fusion.js";
import { MIN_CREDENCE } from "../../../src/life/credence.js";
import { WHAT_A_MOMENT_HOLDS } from "../../../src/life/register-scissors.js";

/**
 * THE FIELD'S NAMED NUMBERS, SWEPT, forty-two of the census's 114, across the six field files.
 * Same house rule as the watchtower sweep: every number participates in a computation against a
 * coupled real quantity, because a name-drop clears the census and proves nothing.
 */

const DAY = 24 * 3.6e6;
const local = (file: string, name: string): number => {
  const src = readFileSync(join(process.cwd(), `src/life/${file}`), "utf8");
  const v = Number(new RegExp(`const ${name} = ([\\d_.]+)`, "u").exec(src)?.[1]?.replace(/_/gu, ""));
  expect(Number.isFinite(v), `${file}:${name} moved — update this sweep`).toBe(true);
  return v;
};

describe("surfacing and nearly-saying", () => {
  it("SURFACING_TEMPERATURE keeps the competition open without dissolving it", () => {
    // Softmax over charge-scale scores (~0..1.65 with NOTHING_SURFACES): at this temperature a
    // 0.5 score gap gives odds of e^(0.5/T) ≈ 3.3:1, decided but never certain, which is what
    // "something else CAN surface" means. Twice this temperature would flatten a 0.5 gap to
    // 1.8:1, indistinguishable from a coin.
    expect(Math.exp(0.5 / SURFACING_TEMPERATURE)).toBeGreaterThan(2);
    expect(Math.exp(0.5 / SURFACING_TEMPERATURE)).toBeLessThan(6);
  });

  it("NEARLY_SAID_IT is a probability RATIO a real runner-up can reach and noise cannot", () => {
    // At the surfacing temperature, a runner-up within ~0.63 of the winner clears 0.22 of the
    // winner's probability (e^(-0.63/0.42) ≈ 0.22): close things count as near-misses, tenth-
    // place things do not.
    expect(Math.exp(-0.63 / SURFACING_TEMPERATURE)).toBeCloseTo(NEARLY_SAID_IT, 1);
    expect(NEARLY_SAID_IT).toBeGreaterThan(0.1);
  });

  it("withholding presses cross their window in a handful of near-misses under the ceiling", () => {
    // Re-asserted here against the RATIO bar: from the NEARLY_SAID_IT entry (~0.65 tension) the
    // ceiling is reached in (stop − 0.65)/press steps, a habit, not one evening.
    const steps = Math.ceil((WITHHOLDING_STOPS_AT - 0.65) / WITHHELD_PRESSES);
    expect(steps).toBeGreaterThan(2);
    expect(steps).toBeLessThan(15);
  });

  it("SAME_REALISATION: a paraphrase is the same thought, a new angle is not", () => {
    // Jaccard-style similarity: 0.7 sits above the ~0.5 that two sentences about one topic score,
    // below the ~0.9 of a trivial rewording, the band where dedup does not eat genuine growth.
    expect(SAME_REALISATION).toBeGreaterThan(0.5);
    expect(SAME_REALISATION).toBeLessThan(0.9);
  });

  it("the raise clocks: an answer counts within hours, a cooldown lasts days, and they nest", () => {
    expect(RAISE_ANSWER_WINDOW_MS).toBeGreaterThanOrEqual(3.6e6);
    expect(RAISE_ANSWER_WINDOW_MS).toBeLessThan(DAY);
    expect(RAISE_COOLDOWN_MS).toBeGreaterThan(RAISE_ANSWER_WINDOW_MS * 4);
    expect(RAISE_COOLDOWN_MS).toBeLessThan(14 * DAY);
  });

  it("tension normalizes against the floor when she is young, the count when she is not", () => {
    // The crossover is at TENSION_FLOOR / TENSION_PER_NODE nodes = 200: below it a newborn's few
    // unsettled things read against a fixed 4, above it against her real size. The crossover must
    // sit far inside her possible life (MAX_NODES), or the floor governs forever.
    const crossover = TENSION_FLOOR / TENSION_PER_NODE;
    expect(crossover).toBeGreaterThan(50);
    expect(crossover).toBeLessThan(MAX_NODES / 10);
  });

  it("UNEASE_WINDOW is a recent stretch, not a life", () => {
    // Unease about him is weighed over her most recent moments involving someone: fewer than 4 is
    // one bad exchange masquerading as a climate, more than ~20 is a season that cannot heal.
    expect(UNEASE_WINDOW).toBeGreaterThanOrEqual(4);
    expect(UNEASE_WINDOW).toBeLessThanOrEqual(20);
  });

  it("the reminding gates keep an association an association", () => {
    const limit = local("field-live.ts", "REMINDS_LIMIT");
    const scale = local("field-live.ts", "REMINDS_SCALE");
    // A moment reminding her of everything is reminding her of nothing; and the similarity-scaled
    // relation must stay under the prune bar's reach so a loose reminding cannot outlive a real one.
    expect(limit).toBeGreaterThanOrEqual(2);
    expect(limit).toBeLessThanOrEqual(5);
    expect(scale).toBeLessThan(1);
    expect(scale).toBeGreaterThan(PRUNE_EDGE_WEIGHT);
  });

  it("a fusion birth is fresh for days, not hours or seasons; a rest births few", () => {
    // FRESH_BIRTH_MS is written `N * DAY_MS`, so the day count is read as the coefficient, the
    // generic reader saw only the 2 and reported milliseconds (this test's own first draft failed
    // on exactly that, which is the class-20 read-the-real-expression lesson in miniature).
    const src = readFileSync(join(process.cwd(), "src/life/field-live.ts"), "utf8");
    const freshDays = Number(/const FRESH_BIRTH_MS = (\d+) \* DAY_MS/u.exec(src)?.[1]);
    const perRest = local("field-live.ts", "MAX_THEMES_PER_REST");
    expect(Number.isFinite(freshDays), "FRESH_BIRTH_MS changed shape — update this sweep").toBe(true);
    expect(freshDays).toBeGreaterThanOrEqual(1);
    expect(freshDays).toBeLessThanOrEqual(7);
    expect(perRest).toBeGreaterThanOrEqual(1);
    expect(perRest).toBeLessThanOrEqual(4);
  });

  it("the in-memory event ring holds a real stretch and stays a ring", () => {
    const kept = local("field-live.ts", "MAX_KEPT_EVENTS");
    expect(kept).toBeGreaterThanOrEqual(100);
    expect(kept).toBeLessThan(local("field-store.ts", "MAX_FIELD_EVENTS"));
  });
});

describe("resonance and themes", () => {
  it("a resonance pair takes a season of co-arrival to mean anything, and fades in weeks alone", () => {
    // Strength accrues 0.06 per co-activation and decays 0.08/day: a pair must keep arriving
    // roughly daily to hold ground (accrual < decay per day means one hit a day is not enough to
    // grow without multiple co-activations), and 30 days of silence forgets it entirely.
    expect(RESONANCE_STRENGTH).toBeLessThan(RESONANCE_DECAY_PER_DAY * 2);
    expect(RESONANCE_FORGET_AFTER_MS / DAY).toBeGreaterThanOrEqual(21);
    // The theme bar (minWeight 0.35) is reached only by repeated co-arrival: ceil(0.35/0.06) ≈ 6
    // co-activations minimum: a pattern, not a coincidence.
    expect(Math.ceil(DEFAULT_THEME.minWeight / RESONANCE_STRENGTH)).toBeGreaterThanOrEqual(4);
  });

  it("remote means remote: the overlap ceiling sits under the same-thought bar", () => {
    // Above RESONANCE_MAX_OVERLAP two nodes are neighbours with a missing edge, not a remote
    // pair; the ceiling must sit far below SAME_REALISATION or "remote" includes near-duplicates.
    expect(RESONANCE_MAX_OVERLAP).toBeLessThan(SAME_REALISATION / 2);
    expect(RESONANCE_MIN_ACTIVATION).toBeLessThan(RESONANCE_MAX_OVERLAP);
  });

  it("the pairing stays cheap by construction", () => {
    // topM nodes per observation bounds pairing at topM²/2 comparisons; the pair table is capped
    // and the cap outlasts a busy month (topM² pairs/observation × ~25 moments/day).
    expect(DEFAULT_RESONANCE.topM ** 2).toBeLessThan(200);
    expect(MAX_RESONANCE_PAIRS).toBeGreaterThan(DEFAULT_RESONANCE.topM * 100);
    expect(MAX_RESONANCE_PAIRS).toBeLessThanOrEqual(DEFAULT_SPREAD.maxVisited);
  });

  it("a theme is a real cluster: size band, density floor, and charge floor cohere", () => {
    // minSize..maxSize brackets a human-scale theme; density 0.25 of possible internal relations
    // at minSize 4 means at least ceil(0.25 × 6) = 2 real edges, structure, not debris; and the
    // charge floor keeps a theme something she FEELS, above the noise band.
    expect(DEFAULT_THEME.minSize).toBeGreaterThanOrEqual(3);
    expect(DEFAULT_THEME.maxSize).toBeGreaterThan(DEFAULT_THEME.minSize * 3);
    const minEdgesAtMinSize = Math.ceil(DEFAULT_THEME.minDensity * (DEFAULT_THEME.minSize * (DEFAULT_THEME.minSize - 1)) / 2);
    expect(minEdgesAtMinSize).toBeGreaterThanOrEqual(2);
    expect(DEFAULT_THEME.minMeanCharge).toBeGreaterThan(0.1);
    expect(DEFAULT_THEME.minMeanCharge).toBeLessThan(0.6);
  });
});

describe("edges, credence, and reticence", () => {
  it("the edge lifecycle nests: floor < prune bar, and decay crosses them a season apart", () => {
    // An untouched edge at strength s reaches the prune bar in ln(s/0.15)/ln(1-0.01) days and the
    // absolute floor months later: pruning is a season of neglect, vanishing is most of a year.
    expect(EDGE_FLOOR).toBeLessThan(PRUNE_EDGE_WEIGHT);
    const daysToPrune = Math.log(PRUNE_EDGE_WEIGHT / 1) / Math.log(1 - EDGE_DECAY_RATE);
    const daysToGone = Math.log(EDGE_FLOOR / 1) / Math.log(1 - EDGE_DECAY_RATE);
    expect(daysToPrune).toBeGreaterThan(60);
    expect(daysToGone).toBeGreaterThan(daysToPrune + 90);
  });

  it("CREDENCE_PINNED is approachable and never reachable by the support arithmetic", () => {
    // SUPPORT_BONUS moves credence toward 1 by fractions of headroom, so 1 is an asymptote; the
    // pinned bar must sit under 1 and far above the floor, or the detector reads noise.
    expect(CREDENCE_PINNED).toBeLessThan(1);
    expect(CREDENCE_PINNED).toBeGreaterThan(1 - 3 * (1 - 0.94));
    expect(CREDENCE_PINNED).toBeGreaterThan(MIN_CREDENCE * 10);
  });

  it("MAX_TEXT_CHARS holds a whole kept moment", () => {
    // A field node must hold what the memory scissors keep (WHAT_A_MOMENT_HOLDS = 300), with
    // room for the citation frame: otherwise the field re-truncates what was already cut.
    expect(MAX_TEXT_CHARS).toBeGreaterThanOrEqual(WHAT_A_MOMENT_HOLDS + 50);
  });

  it("reticence is a climate: warmth eases most of the way, relaxation takes days", () => {
    // RETICENCE_EASE 0.7 means perfect warmth carries a hard-to-say thing 70% toward effortless,
    // real but not total; RETICENCE_RELAX 0.15/day puts "most of the way" at ~5 days
    // ((1-0.15)^5 ≈ 0.44 of the distance remaining), a mood becoming a season, not a switch.
    expect(RETICENCE_EASE).toBeGreaterThan(0.5);
    expect(RETICENCE_EASE).toBeLessThan(1);
    expect(Math.pow(1 - RETICENCE_RELAX, 5)).toBeLessThan(0.5);
    expect(Math.pow(1 - RETICENCE_RELAX, 1)).toBeGreaterThan(0.7);
  });
});

describe("spreading, mentions, and the stores", () => {
  it("spreading dies out on its own arithmetic before the visit cap saves it", () => {
    // hopDecay^n × fan penalty must fall under eps within a handful of hops for ordinary fans:
    // at fan 4 each hop costs 0.8 / 4^0.5 = 0.4, so activation 1 is under 0.004 by hop 7, the
    // cap (4000 nodes) is a backstop, not the working boundary.
    const perHop = DEFAULT_SPREAD.hopDecay / Math.pow(4, DEFAULT_SPREAD.fanExponent);
    expect(Math.pow(perHop, 7)).toBeLessThan(DEFAULT_SPREAD.eps);
    expect(DEFAULT_SPREAD.maxVisited).toBeLessThanOrEqual(MAX_NODES);
    // WARMTH_GAIN: one retrieval warms a memory noticeably, three saturate most of the band.
    expect(WARMTH_GAIN * 3).toBeGreaterThan(1);
    expect(WARMTH_GAIN).toBeLessThan(0.5);
  });

  it("MENTIONS_ENOUGH: a text is ABOUT a thing at one clause in twenty, not one word in a book", () => {
    // 0.05 of a 300-char kept moment is 15 chars, a real clause. Much lower and every stray
    // word indexes; much higher and only titles ever mention anything.
    expect(MENTIONS_ENOUGH * WHAT_A_MOMENT_HOLDS).toBeGreaterThanOrEqual(10);
    expect(MENTIONS_ENOUGH).toBeLessThan(0.2);
  });

  it("a fusion birth is a thought-sized text", () => {
    // Shorter than MIN it is not a thought; longer than MAX it is an essay the field would then
    // re-cut (MAX must fit inside a node's own text bound).
    expect(MIN_BIRTH_CHARS).toBeGreaterThanOrEqual(8);
    expect(MAX_BIRTH_CHARS).toBeGreaterThan(MIN_BIRTH_CHARS * 10);
    expect(MAX_BIRTH_CHARS).toBeLessThanOrEqual(MAX_TEXT_CHARS);
  });

  it("the event store trims in batches and holds a life's stretch", () => {
    const maxEvents = local("field-store.ts", "MAX_FIELD_EVENTS");
    const trimEvery = local("field-store.ts", "TRIM_EVERY");
    // Trimming every insert makes the DELETE the hot path; the batch must be a sliver of the cap
    // so the overshoot stays bounded, and the cap holds years of events at ~25 moments/day.
    expect(trimEvery).toBeLessThan(maxEvents / 10);
    expect(maxEvents / 25).toBeGreaterThan(365);
  });
});
