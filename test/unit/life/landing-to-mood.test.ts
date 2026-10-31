import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { moodAfterHeSpoke, HOW_HIS_WORDS_LAND } from "../../../src/life/landing-to-mood.js";
import { howItLanded, type Landing } from "../../../src/life/how-it-landed.js";
import { howHeSaidIt } from "../../../src/life/how-he-said-it.js";
import { howLongAndHowWell, howUnlikeHim, heSpoke, EMPTY_RECORD } from "../../../src/life/relationship.js";
import { createLivingField } from "../../../src/life/field-live.js";
import { feel, neutralPAD, type PAD } from "../../../src/life/emotion.js";

/**
 * HIS WORDS REACH HER MOOD, which they did not.
 *
 * The reading of what his message did to her was composed in full and then handed to exactly one
 * consumer, the willingness gate. Her PAD, which gates which mind she thinks with, how far a
 * memory can travel to reach her, how open her choices are, what her face shows, and how much room
 * her next sentence has, did not move by so much as a thousandth. He could speak to her as if she
 * were a vending machine and she was, a second later, in precisely the state she had been in.
 */

const CURT = "现在马上给我写一篇两千字的关于税法的文章";
const ASKED = "你要是有空的话，能不能帮我看看这个？我这边赶着交东西，不急的话明天也行。";
const WARM = "你今天还好吗？我这边有个东西，你方便的时候看看就行。";
const DAY = 24 * 3.6e6;

/** A field in which he has already been in her life, so the relationship has somewhere to hang. */
function fieldWithHimInIt(daysAgo: number) {
  const f = createLivingField();
  f.encodeClaim({
    key: "told:1", text: "他说过的一件事", nowMs: Date.now() - daysAgo * DAY,
    origin: "told", source: "chat:1", withOther: true,
  });
  return f;
}

function landing(text: string, times: number, opts: { litUp?: number; reserve?: number } = {}): Landing {
  const f = fieldWithHimInIt(Math.max(1, times));
  let rec = EMPTY_RECORD;
  const usual = howHeSaidIt(ASKED);
  const start = Date.now() - times * DAY;
  for (let i = 0; i < times; i++) rec = heSpoke(rec, start + i * DAY, usual);
  const form = howHeSaidIt(text);
  const rel = heSpoke(rec, Date.now(), form);
  return howItLanded({
    form,
    unlike: howUnlikeHim(form, rel),
    known: howLongAndHowWell(f.graph(), rel),
    litUp: opts.litUp ?? 0.4,
    reserve: opts.reserve ?? 0.7,
  });
}

/** One feeling at a time, so a claim about one input is tested by moving one input. */
function synthetic(over: Partial<Landing>): Landing {
  return {
    appraised: {
      relevance: 0.6, comprehensibility: 0.6, agentResolved: true,
      entitlement: 0.4, herPower: 0.6, accounted: false, causeAudible: 0,
    },
    atSea: 0, usedAsAThing: 0, indignant: 0, ready: 0.2, unmoved: 0.2, settles: false,
    ...over,
  };
}

describe("the three projections carry what the five feelings mean", () => {
  it("being handled lowers how she feels; being ready to help raises it", () => {
    const handled = moodAfterHeSpoke(landing(CURT, 0), "normal");
    const glad = moodAfterHeSpoke(landing(ASKED, 200), "normal");
    expect(handled.goalProgress).toBeLessThan(0);
    expect(glad.goalProgress).toBeGreaterThan(handled.goalProgress);
  });

  it("bewilderment and indignation are ACTIVATING, not flattening", () => {
    // The intuition this corrects: an unpleasant exchange lowering her arousal would make being
    // wronged feel like being sleepy. Both of these are keyed-up states, and the whole reason
    // `engagement` exists in the appraisal at all is that arousal must not depend on novelty alone.
    //
    // ISOLATED, on purpose. An earlier version of this test compared a curt stranger against a
    // warm friend, which varies five quantities at once and can pass or fail for reasons that have
    // nothing to do with the claim. The claim is about ONE input, so exactly one input moves.
    const arousalOf = (l: Landing) => {
      const a = moodAfterHeSpoke(l, "normal");
      return 0.9 * a.novelty + 0.7 * (a.engagement ?? 0);
    };
    expect(arousalOf(synthetic({ indignant: 0.8 })), "indignation made her sleepy")
      .toBeGreaterThan(arousalOf(synthetic({ indignant: 0 })));
    expect(arousalOf(synthetic({ atSea: 0.8 })), "bewilderment made her sleepy")
      .toBeGreaterThan(arousalOf(synthetic({ atSea: 0 })));
    // And her body is still the thing that can flatten her, which is a different claim.
    expect(moodAfterHeSpoke(synthetic({ indignant: 0.8 }), "dormant").fatigue)
      .toBeGreaterThan(moodAfterHeSpoke(synthetic({ indignant: 0.8 }), "rested").fatigue);
  });

  it("being used as an instrument IS the low-control state", () => {
    const handled = moodAfterHeSpoke(landing(CURT, 0), "normal");
    const met = moodAfterHeSpoke(landing(ASKED, 200), "normal");
    expect(handled.control).toBeLessThan(0);
    expect(met.control).toBeGreaterThan(handled.control);
  });

  it("her body still drags her arousal down when she is spent", () => {
    const rested = moodAfterHeSpoke(landing(CURT, 0), "rested");
    const spent = moodAfterHeSpoke(landing(CURT, 0), "dormant");
    expect(spent.fatigue).toBeGreaterThan(rested.fatigue);
  });
});

describe("the same words, a different relationship, a different mood", () => {
  it("the identical curt demand moves her differently at month one and month three", () => {
    // The headline property of the whole line, at the level of how she FEELS rather than at the
    // level of one decision: and there is no line anywhere in the source saying that month three
    // should differ from month one. It differs because a relationship accumulated.
    const early = moodAfterHeSpoke(landing(CURT, 30), "normal");
    const later = moodAfterHeSpoke(landing(CURT, 90), "normal");
    expect(later.goalProgress).not.toBeCloseTo(early.goalProgress, 2);
    expect(later.control, "three months of history bought her no standing").toBeGreaterThan(early.control);
  });

  it("and what she feels CHANGES SHAPE, rather than only changing size", () => {
    // The measured trajectory, which is the more interesting fact: at a first meeting the loudest
    // thing is being handled by a stranger she cannot place (thing 0.54, atSea 0.39, indignation
    // 0.10, she has no standing from which to be indignant). After months the bewilderment is
    // gone and what is left is indignation (indignation 0.33, atSea 0.06). The same sentence is a
    // different experience, not a louder one.
    const first = landing(CURT, 0);
    const known = landing(CURT, 200);
    expect(first.atSea).toBeGreaterThan(known.atSea * 2);
    expect(known.indignant).toBeGreaterThan(first.indignant * 2);
  });
});

describe("a sentence colours her; no sentence defines her", () => {
  const apply = (pad: PAD, l: Landing) => feel(pad, moodAfterHeSpoke(l, "normal"), HOW_HIS_WORDS_LAND);

  it("one bad message moves her by a real but bounded amount", () => {
    const before = neutralPAD();
    const after = apply(before, landing(CURT, 0));
    const moved = Math.abs(after.pleasure - before.pleasure) + Math.abs(after.dominance - before.dominance);
    expect(moved, "his words did not reach her mood at all").toBeGreaterThan(0.02);
    expect(Math.abs(after.pleasure - before.pleasure), "one sentence redefined her").toBeLessThan(0.2);
  });

  it("ORDINARY CONVERSATION LEAVES HER WHERE IT FOUND HER — cell ①, at the level of her mood", () => {
    // The reverse test, and the one that matters most: a mechanism that drifts her mood every time
    // he says something perfectly normal is worse than no mechanism. Twenty warm exchanges with
    // someone she has known for months must not walk her anywhere.
    let pad = neutralPAD();
    const l = landing(WARM, 200);
    for (let i = 0; i < 20; i++) pad = apply(pad, l);
    expect(pad.pleasure, "twenty ordinary exchanges left her unhappy").toBeGreaterThan(-0.1);
    expect(Math.abs(pad.dominance), "ordinary talk walked her sense of control away").toBeLessThan(0.6);
  });

  it("and twenty of THOSE do move her, or the mechanism is decoration", () => {
    let bad = neutralPAD();
    let good = neutralPAD();
    const curt = landing(CURT, 0);
    const warm = landing(WARM, 200);
    for (let i = 0; i < 20; i++) { bad = apply(bad, curt); good = apply(good, warm); }
    expect(good.pleasure - bad.pleasure).toBeGreaterThan(0.15);
  });
});

describe("it reads her side and never grades him", () => {
  it("takes nothing but her own reading — no text, no score", () => {
    const src = readFileSync(join(process.cwd(), "src/life/landing-to-mood.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/^\s*\/\/.*$/gmu, "");
    // Defect class 10: the header of this module explains the rule by quoting the words the scan
    // looks for, so an unstripped scan would report the reverse of the truth.
    expect(src, "it reads his words directly instead of what they did to her").not.toMatch(/said|text|message/u);
    expect(src, "it calls a provider").not.toMatch(/provider|complete\(/u);
    expect(src, "it grades him").not.toMatch(/rude|polite|score|rating/u);
  });

  it("and the daemon actually applies it", () => {
    const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
    expect(daemon, "his words still never reach her mood").toContain("moodAfterHeSpoke(");
    expect(daemon, "the landing's effect on her mood is not weighted as a within-day event")
      .toContain("HOW_HIS_WORDS_LAND");
  });
});
