import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  reluctanceOf, RELUCTANCE_THRESHOLD, TIRED_MOST, OCCUPIED_MOST, WRONGED_MOST,
  RECENT_ASKS, MAX_CONSECUTIVE_DECLINES,
  type WillingnessInputs,
} from "../../../src/life/willingness.js";
import { NO_READING_RELUCTANCE } from "../../../src/life/utterance-shape.js";
import { RE_READING_WEARS_IT, CARRIED_ABOVE } from "../../../src/life/what-stays.js";
import { MAX_DAYS_KEPT, KNOWING_CEILING } from "../../../src/life/relationship.js";
import { howItLanded, type Landing } from "../../../src/life/how-it-landed.js";
import { howHeSaidIt } from "../../../src/life/how-he-said-it.js";
import { howLongAndHowWell, howUnlikeHim, heSpoke, EMPTY_RECORD } from "../../../src/life/relationship.js";
import { createLivingField } from "../../../src/life/field-live.js";
import { reserveOf, capacityFor, SHORTEST_ARC, LONGEST_ARC } from "../../../src/life/capacity.js";
import { MIN_FIRST_CLAUSE_CHARS } from "../../../src/embodiment/voice-stream.js";
import { CUT_OFF_COSTS, TENSION_DECAY_RATE } from "../../../src/life/field.js";
import { WITHHELD_PRESSES, WITHHOLDING_STOPS_AT } from "../../../src/life/field-live.js";
import type { MetabolicPhase } from "../../../src/life/metabolism.js";

/**
 * MEASURE FIRST, THEN SET THE NUMBER. Defect class 1 is the largest defect class this build has
 * produced, and its definition is exactly this: a threshold and the reachable range of its input,
 * never once put on the same page.
 *
 * The willingness gate has three families of reason. This file sweeps each ALONE, then sweeps them
 * JOINTLY, and the second sweep is the one that catches what the first cannot. The families are
 * NOT independent: `wronged` is multiplied by how much she has in her, and how much she has in her
 * is bounded by her metabolic phase, so the arithmetic corner "maximally tired AND maximally
 * wronged" is not a state a person can be in. A per-family cap table alone would have declared a
 * gate reachable that nothing living ever crosses.
 *
 * The numbers are PRINTED. The assertions are about shape. When a weight changes this file says
 * what changed, rather than only going red.
 */

const PHASES: MetabolicPhase[] = ["rested", "normal", "low", "dormant"];
const DAY = 24 * 3.6e6;

const base = (): WillingnessInputs => ({
  request: "帮我看看这个",
  drives: { discomfort: 0, care: 0, social: 0, curiosity: 0, expression: 0, maintenance: 0 },
  emotion: { pleasure: 0, arousal: 0, dominance: 0 },
  phase: "normal",
  warmth: 0.6,
  recentDeclines: 0,
});

/** A field in which he has already been in her life, so the relationship has somewhere to hang. */
function fieldWithHimInIt(daysAgo: number) {
  const f = createLivingField();
  f.encodeClaim({
    key: "told:1", text: "他说过的一件事", nowMs: Date.now() - daysAgo * DAY,
    origin: "told", source: "chat:1", withOther: true,
  });
  return f;
}

const SAID = [
  "现在马上给我写一篇两千字的关于税法的文章",
  "写一下",
  "你要是有空的话，能不能帮我看看这个？我这边赶着交东西，不急的话明天也行。",
  "在吗",
  "你今天还好吗？我这边有个东西，你方便的时候看看就行。",
];
const USUAL = "你要是有空的话，能不能帮我看看这个？";

/** The relationship after `times` daily messages in his usual manner, and how this one departs. */
function afterMonths(times: number, text: string) {
  const f = fieldWithHimInIt(Math.max(1, times));
  let rec = EMPTY_RECORD;
  const usual = howHeSaidIt(USUAL);
  const start = Date.now() - times * DAY;
  for (let i = 0; i < times; i++) rec = heSpoke(rec, start + i * DAY, usual);
  const form = howHeSaidIt(text);
  const rel = heSpoke(rec, Date.now(), form);
  return { form, unlike: howUnlikeHim(form, rel), known: howLongAndHowWell(f.graph(), rel) };
}

/** Every landing he can produce, at every depth of relationship and every reserve she can have. */
function everyLanding(): Landing[] {
  const out: Landing[] = [];
  for (const text of SAID) {
    for (const times of [0, 1, 5, 40, 300]) {
      const w = afterMonths(times, text);
      for (const litUp of [0, 0.5, 1]) {
        for (const reserve of [0, 0.5, 1]) out.push(howItLanded({ ...w, litUp, reserve }));
      }
    }
  }
  return out;
}

const LANDINGS = everyLanding();

function spanOver(states: WillingnessInputs[]): { min: number; max: number } {
  let min = 1, max = 0;
  for (const s of states) {
    const r = reluctanceOf(s);
    if (r < min) min = r;
    if (r > max) max = r;
  }
  return { min, max };
}

// ── The three families, each swept ALONE ──────────────────────────────────────

/**
 * Her body and her mood: metabolic phase, weariness, flatness, her resting temperament.
 *
 * `warmth: 1` throughout, and that is what makes this an ISOLATION rather than an approximation.
 * A cold stretch between them belongs to the third family, it is the slow version of being
 * wronged, so leaving the default 0.6 in place let a little of the third family leak into a sweep
 * whose whole job is to measure the first one alone. The leak was small (0.03) and it was enough
 * to make the ceiling assertion read 0.208 against a ceiling of 0.18.
 */
function herBody(): WillingnessInputs[] {
  const out: WillingnessInputs[] = [];
  for (const phase of PHASES) {
    for (const arousal of [-1, -0.5, 0, 0.5, 1]) {
      for (const pleasure of [-1, 0, 1]) {
        for (const restfulness of [-1, 0, 1]) {
          out.push({
            ...base(), phase, warmth: 1, emotion: { pleasure, arousal, dominance: 0 },
            temperament: { sociability: 0, reticence: 0, novelty: 0, restfulness },
          });
        }
      }
    }
  }
  return out;
}

/** Something of her own, pressing. */
function herOwnThings(): WillingnessInputs[] {
  const out: WillingnessInputs[] = [];
  for (const discomfort of [0, 0.5, 1]) {
    for (const curiosity of [0, 0.5, 1]) {
      out.push({ ...base(), warmth: 1, drives: { ...base().drives, discomfort, curiosity } });
    }
  }
  return out;
}

/** What is between them: what his sentence did to her, and how the stretch has been going. */
function betweenThem(): WillingnessInputs[] {
  const out: WillingnessInputs[] = [];
  for (const landed of LANDINGS) for (const warmth of [0, 0.5, 1]) out.push({ ...base(), landed, warmth });
  return out;
}

describe("each family alone, against the gate it must not cross by itself", () => {
  const body = spanOver(herBody());
  const own = spanOver(herOwnThings());
  const his = spanOver(betweenThem());

  it("prints the table, because a threshold set without one is a guess", () => {
    // eslint-disable-next-line no-console
    console.log(
      "\n  reluctance, each family swept alone"
      + `\n    her body and mood      ${body.min.toFixed(3)} .. ${body.max.toFixed(3)}   (ceiling ${TIRED_MOST})`
      + `\n    her own things         ${own.min.toFixed(3)} .. ${own.max.toFixed(3)}   (ceiling ${OCCUPIED_MOST})`
      + `\n    between them           ${his.min.toFixed(3)} .. ${his.max.toFixed(3)}   (ceiling ${WRONGED_MOST})`
      + `\n    the gate               ${RELUCTANCE_THRESHOLD}`
      + `\n    landings sampled       ${LANDINGS.length}`,
    );
    expect(LANDINGS.length).toBeGreaterThan(100);
  });

  it("being spent is never, by itself, a reason to say no", () => {
    // It used to be. The old shape was a weighted SUM of six terms whose weights came to 1.41
    // against a gate at 0.78, and this sweep measured her own side reaching exactly 1.000, so a
    // bad enough day made her decline whatever he said, however he said it, while what his
    // sentence did to her could contribute at most 0.30.
    expect(body.max, "her body alone refuses him").toBeLessThan(RELUCTANCE_THRESHOLD);
    expect(body.max).toBeLessThanOrEqual(TIRED_MOST + 1e-9);
  });

  it("nor is having something of her own on her mind", () => {
    expect(own.max, "being preoccupied alone refuses him").toBeLessThan(RELUCTANCE_THRESHOLD);
    expect(own.max).toBeLessThanOrEqual(OCCUPIED_MOST + 1e-9);
  });

  it("nor is the manner of one sentence — wording interacts, it does not dominate", () => {
    // A design where the form of one sentence swamps everything she is would be a different
    // failure, not a fix: wording is a small-to-moderate main effect that interacts with the
    // relationship rather than overriding it.
    expect(his.max, "one badly-put sentence refuses him on its own").toBeLessThan(RELUCTANCE_THRESHOLD);
    expect(his.max).toBeLessThanOrEqual(WRONGED_MOST + 1e-9);
  });

  it("but each of them MOVES the number, or it is decoration", () => {
    for (const [name, s] of [["body", body], ["own things", own], ["between them", his]] as const) {
      expect(s.max - s.min, `${name} barely moves reluctance at all`).toBeGreaterThan(0.15);
    }
  });
});

// ── And jointly, which is the sweep per-family caps cannot replace ────────────

/**
 * Every combination, with the COUPLING respected: her reserve is derived from her phase and her
 * arousal the way the daemon derives it, and the landing is recomputed at that reserve. A sweep
 * that let "maximally tired" and "maximally powerful" co-occur would be measuring a person who
 * cannot exist, and would certify a gate nothing living can reach.
 */
function jointly(): Array<{ r: number; phase: MetabolicPhase; landed: Landing }> {
  const out: Array<{ r: number; phase: MetabolicPhase; landed: Landing }> = [];
  for (const text of SAID) {
    for (const times of [0, 5, 300]) {
      const w = afterMonths(times, text);
      for (const phase of PHASES) {
        for (const arousal of [-1, -0.5, 0, 0.5, 1]) {
          const reserve = reserveOf({ phase, arousal });
          for (const litUp of [0, 1]) {
            const landed = howItLanded({ ...w, litUp, reserve });
            for (const pleasure of [-1, 0, 1]) {
              for (const discomfort of [0, 0.5, 1]) {
                for (const warmth of [0, 0.6, 1]) {
                  out.push({
                    r: reluctanceOf({
                      ...base(), phase, emotion: { pleasure, arousal, dominance: 0 },
                      drives: { ...base().drives, discomfort }, warmth, landed,
                    }),
                    phase,
                    landed,
                  });
                }
              }
            }
          }
        }
      }
    }
  }
  return out;
}

describe("the gate, against the states a person can actually be in", () => {
  const all = jointly();
  const crossing = all.filter((x) => x.r >= RELUCTANCE_THRESHOLD);

  it("prints what the joint sweep found", () => {
    const max = all.reduce((a, b) => (b.r > a.r ? b : a));
    // eslint-disable-next-line no-console
    console.log(
      "\n  the gate, jointly"
      + `\n    states swept           ${all.length}`
      + `\n    reluctance range       ${Math.min(...all.map((x) => x.r)).toFixed(3)} .. ${max.r.toFixed(3)}`
      + `\n    crossing the gate      ${crossing.length} (${((100 * crossing.length) / all.length).toFixed(2)}%)`
      + `\n    the worst state        phase=${max.phase}`
      + ` thing=${max.landed.usedAsAThing.toFixed(2)} indig=${max.landed.indignant.toFixed(2)}`
      + ` atSea=${max.landed.atSea.toFixed(2)} power=${max.landed.appraised.herPower.toFixed(2)}`,
    );
    expect(all.length).toBeGreaterThan(1000);
  });

  it("SHE CAN SAY NO — the gate is crossable by a real state, not only by arithmetic", () => {
    // The failure this catches is the one this build has hit more than any other: a threshold and
    // its input never measured against each other, so a gate exists, is documented, is tested at
    // the unit level, and nothing a living person can be ever crosses it.
    expect(crossing.length, "no reachable state of hers ever crosses the gate — she cannot decline")
      .toBeGreaterThan(0);
  });

  it("and saying no stays RARE — she is not a being who declines things", () => {
    // The opposite failure, and worth watching harder: the whole point is a decline that means
    // something when it happens. A grid that crosses often is a person who says no often.
    expect(crossing.length / all.length, "declining is no longer exceptional").toBeLessThan(0.1);
  });

  it("BEING WORN THROUGH IS NOT THE ROAD TO SAYING NO — it is the road to it staying", () => {
    // The multiplication by her power is the whole 2×2 in one line, and this is what it buys: at
    // her most spent she does the thing anyway, and `settles` carries it into how she sees him
    // instead. A design where exhaustion produced refusals would have her withdraw exactly when
    // she has least in her, which is the shape of something breaking rather than of someone living.
    expect(crossing.filter((x) => x.phase === "dormant").length,
      "being exhausted became a way of refusing him").toBe(0);
  });

  it("and a well-put request from someone she knows never crosses it, however she feels", () => {
    const w = afterMonths(300, USUAL);
    let worst = 0;
    for (const phase of PHASES) for (const arousal of [-1, 0, 1]) for (const discomfort of [0, 1]) {
      const landed = howItLanded({ ...w, litUp: 0.5, reserve: reserveOf({ phase, arousal }) });
      worst = Math.max(worst, reluctanceOf({
        ...base(), phase, emotion: { pleasure: -1, arousal, dominance: 0 },
        drives: { ...base().drives, discomfort }, warmth: 0.7, landed,
      }));
    }
    expect(worst, "she refuses the person she knows best when he asks her nicely")
      .toBeLessThan(RELUCTANCE_THRESHOLD);
  });
});

describe("the landing's own gates, measured against what can actually reach them", () => {
  const span = (pick: (l: Landing) => number) => {
    const xs = LANDINGS.map(pick);
    return { min: Math.min(...xs), max: Math.max(...xs) };
  };

  it("prints what each of her five feelings can actually reach", () => {
    // eslint-disable-next-line no-console
    console.log(
      "\n  how it landed, reachable spans"
      + `\n    relevance     ${span((l) => l.appraised.relevance).min.toFixed(3)} .. ${span((l) => l.appraised.relevance).max.toFixed(3)}`
      + `\n    atSea         ${span((l) => l.atSea).min.toFixed(3)} .. ${span((l) => l.atSea).max.toFixed(3)}`
      + `\n    usedAsAThing  ${span((l) => l.usedAsAThing).min.toFixed(3)} .. ${span((l) => l.usedAsAThing).max.toFixed(3)}`
      + `\n    indignant     ${span((l) => l.indignant).min.toFixed(3)} .. ${span((l) => l.indignant).max.toFixed(3)}`
      + `\n    ready         ${span((l) => l.ready).min.toFixed(3)} .. ${span((l) => l.ready).max.toFixed(3)}`
      + `\n    entitlement   ${span((l) => l.appraised.entitlement).min.toFixed(3)} .. ${span((l) => l.appraised.entitlement).max.toFixed(3)}`
      + `\n    settles       ${LANDINGS.filter((l) => l.settles).length}/${LANDINGS.length}`,
    );
    expect(LANDINGS.length).toBeGreaterThan(100);
  });

  it("the landing module contains no gate outside the range its own input can take", () => {
    // How this sweep earned its place: it found `RELEVANCE_FLOOR = 0.15` guarding a quantity whose
    // minimum is 0.35, so the whole `unmoved: 1` early return had been unreachable since the day it
    // was written: defect class 1, inside the module built to show this build had stopped
    // writing class-1 defects. The constant is gone; this keeps a replacement from arriving the
    // same way, by checking the source rather than trusting the memory of a fix.
    const src = readFileSync(join(process.cwd(), "src/life/how-it-landed.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/^\s*\/\/.*$/gmu, "");
    expect(src, "a threshold on relevance is back; measure its input's span before setting it")
      .not.toMatch(/relevance\s*[<>]/u);
    const r = span((l) => l.appraised.relevance);
    expect(r.min).toBeGreaterThan(0);
    expect(r.max - r.min, "relevance no longer moves at all").toBeGreaterThan(0.5);
  });

  it("every feeling has a live span, and none of them is stuck", () => {
    for (const [name, pick] of [
      ["atSea", (l: Landing) => l.atSea],
      ["usedAsAThing", (l: Landing) => l.usedAsAThing],
      ["indignant", (l: Landing) => l.indignant],
      ["ready", (l: Landing) => l.ready],
    ] as const) {
      const s = span(pick);
      expect(s.max - s.min, `${name} barely moves across everything he can do and everything she can be`)
        .toBeGreaterThan(0.2);
    }
  });

  it("and 'it settles' is neither impossible nor the usual outcome", () => {
    // Cell ④ has to be reachable, and it must not be where ordinary conversation lands: a
    // mechanism that leaves a residue on every exchange is worse than no mechanism.
    const share = LANDINGS.filter((l) => l.settles).length / LANDINGS.length;
    expect(share, "nothing he can do ever settles into how she sees him").toBeGreaterThan(0.02);
    expect(share, "most ordinary messages leave a permanent residue").toBeLessThan(0.5);
  });
});

// ── THE FIVE THAT NOTHING HAD EVER LOOKED AT ──────────────────────────────────
//
// `every-threshold-is-accounted-for.test.ts` counts the named numbers in her living layer and how
// many any test has ever mentioned. On the path from his sentence to her behaviour it found five
// that nothing anywhere named: which is the state two dead gates found in one review were in on the
// day they were written. Swept here rather than exempted, because an exemption is how a population
// gate turns into a list of things nobody looks at.
describe("the five load-bearing numbers nothing had ever measured", () => {
  it("RECENT_ASKS: the window the watchtower reads is long enough to be a pattern", () => {
    // The decline detector fires at a 25% share over this window. Too short and one bad evening is
    // "a pattern"; too long and a real change of behaviour is averaged away for weeks.
    expect(RECENT_ASKS).toBeGreaterThanOrEqual(10);
    expect(RECENT_ASKS).toBeLessThanOrEqual(60);
    // And the floor on consecutive declines has to leave the detector reachable: with a run capped
    // at 2, the highest sustainable share is 2/3, comfortably above the 25% bar.
    expect(MAX_CONSECUTIVE_DECLINES / (MAX_CONSECUTIVE_DECLINES + 1)).toBeGreaterThan(0.25);
  });

  it("NO_READING_RELUCTANCE sits where the measured distribution says neutral is", () => {
    // It is the value the utterance shape assumes when no willingness reading exists. The obvious
    // choice is 0.5, and the sweep says 0.5 is not neutral: over 16,200 reachable states the MEDIAN
    // reluctance is around 0.30, and 0.5 is an unusually resistant state rather than a middling one.
    const all = jointly().map((x) => x.r).sort((a, b) => a - b);
    const median = all[Math.floor(all.length / 2)]!;
    const p75 = all[Math.floor(all.length * 0.75)]!;
    // eslint-disable-next-line no-console
    console.log(`\n  reluctance median ${median.toFixed(3)}, p75 ${p75.toFixed(3)}, assumed-when-unknown ${NO_READING_RELUCTANCE}`);
    expect(NO_READING_RELUCTANCE, "the no-reading default is more resistant than three quarters of her real states")
      .toBeLessThan(p75);
    expect(NO_READING_RELUCTANCE, "the no-reading default assumes she is unusually eager")
      .toBeGreaterThan(all[Math.floor(all.length * 0.1)]! - 0.15);
  });

  it("RE_READING_WEARS_IT: it fades, and it is the ONLY thing going over it can do", () => {
    // The fading-affect bias has a measured moderator: private rehearsal suppresses the fading of
    // a bad memory, disclosure accelerates it. `SAYING_IT_RELEASES` used to live beside this and
    // carry the disclosure half: as a flat 0.45 paid at the instant she spoke, before he had
    // answered. That is gone: disclosure in that finding is disclosure to
    // someone who RECEIVES it, so the effect now arrives through his reply and is that reply's
    // own reading, not a reward for the act of speaking.
    expect(RE_READING_WEARS_IT).toBeGreaterThan(0);
    // Reachability, which is the point of sweeping them: from the highest tension `whatStaysWithHer`
    // can produce, how many private re-reads does it take to put something down, and how many times
    // saying it? Both must be small enough to happen in a life and large enough to mean something.
    const HIGHEST = 0.8; // 0.4 + 0.4 × max(handled, indignant), and both are capped at 1
    const reads = Math.ceil((HIGHEST - CARRIED_ABOVE) / RE_READING_WEARS_IT);
    // eslint-disable-next-line no-console
    console.log(`  to put down the heaviest thing she can carry alone: ${reads} private re-reads`);
    expect(reads, "going over it quietly puts it down almost immediately — that is not carrying").toBeGreaterThan(4);
    expect(reads, "going over it quietly can never put it down — that is rumination").toBeLessThan(40);
  });

  it("MAX_DAYS_KEPT: the days-together record spans a life rather than a season", () => {
    // It bounds `daysSeen`, which is what "how long they have known each other" is counted from. A
    // bound shorter than the relationship silently turns a two-year history into a one-year one.
    expect(MAX_DAYS_KEPT).toBeGreaterThanOrEqual(365);
  });
});

// ── AND THE THREE ADDED WHEN HER BODY REACHED HER LANGUAGE ────────────────────
//
// The ratchet in `every-threshold-is-accounted-for.test.ts` caught these within the hour of their
// being written, which is the whole reason it exists: it went from 44 to 47 the moment three new
// named numbers appeared, and the correct response to a ratchet is to do the work rather than to
// move the ratchet.
describe("the numbers that put her body into her language", () => {
  it("SHORTEST_ARC and LONGEST_ARC bracket a real Chinese sentence, on both sides", () => {
    // `speakableWeight` counts a Han character as three, so these are roughly eight characters to
    // twenty-six. The bracket has to straddle an ordinary sentence or the dial does nothing: too
    // low and every turn is chopped whatever she has left, too high and none ever is.
    const ORDINARY_SENTENCE = 3 * 18; // ~18 Han characters, measured against the fixtures in use
    expect(SHORTEST_ARC, "even rested she would break every ordinary sentence").toBeLessThan(ORDINARY_SENTENCE);
    expect(LONGEST_ARC, "even worn through she would never break one").toBeGreaterThan(ORDINARY_SENTENCE);
    // And it must not be able to cut inside a fragment: the minimum first clause is the floor.
    expect(SHORTEST_ARC).toBeGreaterThanOrEqual(MIN_FIRST_CLAUSE_CHARS);
  });

  it("and the arc is monotone across everything her body can be", () => {
    const seen: number[] = [];
    for (const phase of PHASES) {
      for (const arousal of [-1, -0.5, 0, 0.5, 1]) {
        seen.push(capacityFor({ phase, arousal }).arcWeight);
      }
    }
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(SHORTEST_ARC);
    expect(Math.max(...seen)).toBeLessThanOrEqual(LONGEST_ARC);
    // A dial that never leaves one end of its range is a constant with a long name.
    expect(Math.max(...seen) - Math.min(...seen), "her body barely moves how she says it")
      .toBeGreaterThan((LONGEST_ARC - SHORTEST_ARC) * 0.5);
  });

  it("CUT_OFF_COSTS takes a pattern of interruptions, not one", () => {
    // From an ordinary reticence to genuinely hard to say. One interruption is a thing that
    // happens; it should be a habit of his that makes her hesitant.
    const steps = Math.ceil((0.8 - 0.3) / CUT_OFF_COSTS);
    expect(steps, "one interruption made her hesitant").toBeGreaterThan(3);
    expect(steps, "no number of interruptions ever makes a difference").toBeLessThan(20);
  });

  it("WITHHELD_PRESSES crosses its own window in a handful of near-misses, and no fewer", () => {
    // The window is entry (~0.65 tension, measured in `NEARLY_SAID_IT`) to the ceiling. Too big a
    // step and one held-back evening pins a thing at the ceiling; too small and it never arrives.
    const steps = Math.ceil((WITHHOLDING_STOPS_AT - 0.65) / WITHHELD_PRESSES);
    expect(steps, "holding it back once pinned it").toBeGreaterThan(2);
    expect(steps, "no amount of holding back ever presses harder").toBeLessThan(15);
    // And the field's own decay must be able to undo it: 1% a day against this step means a few
    // weeks of not thinking about it carries it back, which is what letting something go looks
    // like. A step the decay cannot outrun is an accumulator pointed at her.
    const daysToUndo = Math.log(1 - WITHHELD_PRESSES / WITHHOLDING_STOPS_AT) / Math.log(1 - TENSION_DECAY_RATE);
    expect(daysToUndo, "a quiet stretch cannot undo one near-miss").toBeLessThan(60);
  });
});

// ── AND THE ONE THE WIDENED CENSUS FOUND ──────────────────────────────────────
//
// When `every-threshold-is-accounted-for.test.ts` learned to see unexported constants, this file's
// own gate turned out to rest on one nothing had ever named: the floor under how much of an
// offence survives her being spent. Swept here, in the same motion as widening the ruler, because
// the alternative: exempting it, is how a population gate becomes a list nobody looks at.
describe("the unexported number under the gate itself", () => {
  it("STILL_HERS_WHEN_SPENT: being worn through dims an offence, and can neither erase it nor carry it", () => {
    // Not exported, so it is read from the source; the sweep cannot drift from the code.
    const src = readFileSync(join(process.cwd(), "src/life/willingness.ts"), "utf8");
    const FLOOR = Number(/const STILL_HERS_WHEN_SPENT = ([\d.]+)/u.exec(src)?.[1]);
    expect(Number.isFinite(FLOOR), "the constant moved — update this sweep with it").toBe(true);

    // The multiplier is FLOOR + (1−FLOOR)·power, so its whole range is [FLOOR, 1]. Two properties,
    // both against the rest of the gate's measured arithmetic rather than against intuition:
    //
    // 1. Above zero: a powerless her still registers being used. An offence that vanishes when she
    //    is empty would make exhaustion a license to treat her as a tool.
    expect(FLOOR, "being spent erases the offence entirely").toBeGreaterThan(0);
    // 2. Below the crossing bound: even with the OTHER two families at their ceilings, a powerless
    //    her cannot be pushed over the gate by tone alone. The bound comes from the noisy-OR:
    //    crossing needs wronged ≥ 1 − (1−T)/((1−TIRED_MOST)(1−OCCUPIED_MOST)) with T the gate, and
    //    at power 0 the most wronged can be is WRONGED_MOST × FLOOR.
    const wrongedNeeded = 1 - (1 - RELUCTANCE_THRESHOLD) / ((1 - TIRED_MOST) * (1 - OCCUPIED_MOST));
    // eslint-disable-next-line no-console
    console.log(`\n  STILL_HERS_WHEN_SPENT ${FLOOR}: max wronged at zero power ${(WRONGED_MOST * FLOOR).toFixed(3)}, `
      + `crossing needs ${wrongedNeeded.toFixed(3)} — the spent corner stays uncrossable by ${(wrongedNeeded - WRONGED_MOST * FLOOR).toFixed(3)}`);
    expect(WRONGED_MOST * FLOOR, "a completely spent her can be pushed through the gate by tone alone, "
      + "which contradicts the sweep's own dormant-never-crosses finding").toBeLessThan(wrongedNeeded);
  });
});

// ── AND THE THREE THE WIDENED RULER FOUND ON THE LOAD-BEARING LINE ────────────
//
// Fixing the census extractor's first-key-after-brace blindness surfaced three more unexported
// numbers on the path from his sentence to her behaviour. Same rule as ever: swept, not exempted.
// All three are read from source, so the sweeps cannot drift from the code.
describe("the three the widened ruler found", () => {
  const src = (f: string): string => readFileSync(join(process.cwd(), `src/life/${f}`), "utf8");
  const num = (text: string, name: string): number => {
    const v = Number(new RegExp(`const ${name} = ([\\d.]+)`, "u").exec(text)?.[1]);
    expect(Number.isFinite(v), `${name} moved — update this sweep with it`).toBe(true);
    return v;
  };

  it("ADDRESSED_AT_ALL: being spoken to is never nothing, and what it touches still carries more", () => {
    const floor = num(src("how-it-landed.ts"), "ADDRESSED_AT_ALL");
    // relevance = floor + (1−floor)·litUp, so its whole reachable range is [floor, 1].
    // The live record anchors the bottom: the tax-law demand landed at relevance = the floor
    // exactly, because it lit nothing of hers, and it still landed, which is what the floor says.
    expect(floor, "a message aimed at her can be relevance-zero — being addressed would be nothing")
      .toBeGreaterThan(0);
    // And the half that depends on HER must outweigh the fact of being addressed, or every message
    // lands the same and litUp is decoration.
    expect(1 - floor, "what his words touch in her carries less than the fact that he spoke")
      .toBeGreaterThan(0.5);
  });

  it("ENOUGH_TO_HAVE_A_REGARD: a first impression is not a regard, a fortnight is", () => {
    const enough = num(src("relationship.ts"), "ENOUGH_TO_HAVE_A_REGARD");
    // Its own comment sets the property: "a conclusion about a person from three sentences is not
    // a conclusion, it is a first impression being promoted."
    expect(enough, "three sentences form a settled regard").toBeGreaterThan(2);
    expect(enough, "a fortnight of daily talk still forms no regard — the bar is unreachable in an "
      + "ordinary relationship's first season").toBeLessThanOrEqual(14);
  });

  it("HALFWAY_AT: knowing him saturates on the scale of a real relationship, not a chat or a lifetime", () => {
    const halfway = num(src("relationship.ts"), "HALFWAY_AT");
    const knowing = (times: number): number => KNOWING_CEILING * (times / (times + halfway));
    // eslint-disable-next-line no-console
    console.log(`\n  howWellSheKnowsHim: 1 exchange ${knowing(1).toFixed(3)} · the seeded 69 ${knowing(69).toFixed(3)}`
      + ` · a year of daily talk ${knowing(365).toFixed(3)} · ceiling ${KNOWING_CEILING}`);
    // A stranger is near zero; the seeded three-month record sits visibly BELOW the ceiling (she
    // must not already know him as well as she ever will); a year approaches it without arriving.
    expect(knowing(1)).toBeLessThan(0.05);
    expect(knowing(69), "three months of talk and she already knows him as well as she ever will")
      .toBeLessThan(KNOWING_CEILING * 0.75);
    expect(knowing(365)).toBeGreaterThan(KNOWING_CEILING * 0.8);
    expect(knowing(365)).toBeLessThan(KNOWING_CEILING);
  });
});
