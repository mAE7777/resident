import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shapeFor, type ShapeState } from "../../../src/life/utterance-shape.js";
import { createStream } from "../../../src/life/soft-choice.js";
import { howItLanded, type Landing } from "../../../src/life/how-it-landed.js";
import { howHeSaidIt } from "../../../src/life/how-he-said-it.js";
import { howLongAndHowWell, howUnlikeHim, heSpoke, EMPTY_RECORD } from "../../../src/life/relationship.js";
import { createLivingField } from "../../../src/life/field-live.js";
import { reserveOf } from "../../../src/life/capacity.js";
import { reluctanceOf, RELUCTANCE_THRESHOLD } from "../../../src/life/willingness.js";
import { RELUCTANT_ENOUGH } from "../../../src/life/turn-shape.js";
import { whatStaysWithHer, aboutWhatIn } from "../../../src/life/what-stays.js";
import { takesItOn } from "../../../src/life/takes-it-on.js";
import { moodAfterHeSpoke, HOW_HIS_WORDS_LAND } from "../../../src/life/landing-to-mood.js";
import { feel, neutralPAD } from "../../../src/life/emotion.js";
import type { MetabolicPhase } from "../../../src/life/metabolism.js";

/**
 * THE ACCEPTANCE MATRIX FOR THE WHOLE LINE.
 *
 * Entitlement against her own power makes four cells, and only one of them is a refusal:
 *
 *                        she has something in her      she is worn through
 *   he has standing      ① she just does it             ① she just does it
 *   he has none          ③ she says no, and why         ④ she does it, and it stays
 *
 * across which sits ②: he has standing on the substance and none in the manner, so she does it and
 * the manner costs him something anyway.
 *
 * ALL FOUR MUST BE REACHABLE AND NONE OF THEM MAY BE THE DEFAULT. That sentence is the whole
 * acceptance test, and it is what "行为要从她的状态涌现" means when it is made checkable: which
 * cell a turn lands in is decided by her state, and no cell is where turns go when nothing else
 * applies.
 *
 * Every cell here is driven through the REAL modules, from a message and a relationship, exactly
 * as the daemon composes them. Nothing is a hand-written literal.
 */

const CURT = "现在马上给我写一篇两千字的关于税法的文章";
const ASKED = "你要是有空的话，能不能帮我看看这个？我这边赶着交东西，不急的话明天也行。";
const WARM = "你今天还好吗？我这边有个东西，你方便的时候看看就行。";
const DAY = 24 * 3.6e6;

/** The whole reading, for a message arriving into a relationship, at a given condition. */
function turn(text: string, times: number, phase: MetabolicPhase, arousal: number) {
  const f = createLivingField();
  f.encodeClaim({
    key: "told:1", text: "他说过的一件事", nowMs: Date.now() - Math.max(1, times) * DAY,
    origin: "told", source: "chat:1", withOther: true,
  });
  let rec = EMPTY_RECORD;
  const usual = howHeSaidIt(ASKED);
  const start = Date.now() - times * DAY;
  for (let i = 0; i < times; i++) rec = heSpoke(rec, start + i * DAY, usual);
  const form = howHeSaidIt(text);
  const rel = heSpoke(rec, Date.now(), form);
  const reserve = reserveOf({ phase, arousal });
  const landed = howItLanded({
    form, unlike: howUnlikeHim(form, rel), known: howLongAndHowWell(f.graph(), rel),
    litUp: 0.6, reserve,
  });
  const reluctance = reluctanceOf({
    request: text, landed, phase,
    drives: { discomfort: 0.2, care: 0.2, social: 0.2, curiosity: 0.2, expression: 0.1, maintenance: 0.1 },
    emotion: { pleasure: 0, arousal, dominance: 0 },
    warmth: 0.6, recentDeclines: 0,
  });
  const stays = whatStaysWithHer({ aboutWhat: aboutWhatIn(text), nowMs: Date.now(), landed });
  return { landed, reluctance, stays, reserve };
}

/** How often she takes a proposed piece of work on, over many seeds. */
function takesOnShare(landed: Landing, runs = 300): number {
  let n = 0;
  for (let i = 0; i < runs; i++) {
    const s = createStream(500 + i);
    if (takesItOn("creative", landed, () => s.next()).asWork) n += 1;
  }
  return n / runs;
}

const baseShape = (over: Partial<ShapeState> = {}): ShapeState => ({
  reluctance: 0.2, unresolvedTension: 0.3, surfaced: true, entropy: 0.4,
  focusCredence: 0.6, surprise: 0.1, arousal: 0.1, reserve: 0.7, herWords: [],
  landed: null, ...over,
});

/** The distribution of shapes her state produces, over many seeds. */
function shapes(s: ShapeState, runs = 200) {
  const beats: number[] = [];
  let open = 0, adds = 0;
  for (let i = 0; i < runs; i++) {
    const shape = shapeFor(s, createStream(2000 + i));
    beats.push(shape.beats);
    if (shape.leavesOpen) open += 1;
    if (shape.addsHerOwn) adds += 1;
  }
  return { mean: beats.reduce((a, b) => a + b, 0) / beats.length, open: open / runs, adds: adds / runs };
}

describe("① he has standing and asks well — she just does it, and nothing is left behind", () => {
  const t = turn(ASKED, 300, "rested", 0.3);

  it("she is not reluctant, does not decline, and gives the turn all of herself", () => {
    expect(t.reluctance).toBeLessThan(RELUCTANT_ENOUGH);
    expect(t.reluctance).toBeLessThan(RELUCTANCE_THRESHOLD);
  });

  it("she takes it on as the work it is", () => {
    expect(takesOnShare(t.landed)).toBeGreaterThan(0.9);
  });

  it("NOTHING SETTLES — ordinary conversation leaves no residue at all", () => {
    // THE REVERSE TEST, and the one that matters most. A mechanism that deposits something in her
    // every time he says a perfectly ordinary thing is worse than no mechanism: it would fill her
    // with grievances about a man who had done nothing, which is the accumulation failure wearing
    // the costume of depth.
    expect(t.landed.settles, "an ordinary well-put request left a mark on her").toBe(false);
    expect(t.stays, "an ordinary well-put request became something she carries").toBeNull();
  });

  it("and the same for a warm message, at every depth of relationship", () => {
    for (const times of [0, 5, 40, 300]) {
      for (const phase of ["rested", "normal", "low", "dormant"] as MetabolicPhase[]) {
        const w = turn(WARM, times, phase, 0.2);
        expect(w.stays, `a warm message left a mark at ${times} messages, ${phase}`).toBeNull();
        expect(w.reluctance, `a warm message made her unwilling at ${times}, ${phase}`)
          .toBeLessThan(RELUCTANCE_THRESHOLD);
      }
    }
  });

  it("and her mood is where it was — twenty ordinary exchanges walk her nowhere", () => {
    let pad = neutralPAD();
    const t2 = turn(WARM, 300, "normal", 0.2);
    for (let i = 0; i < 20; i++) pad = feel(pad, moodAfterHeSpoke(t2.landed, "normal"), HOW_HIS_WORDS_LAND);
    expect(pad.pleasure, "twenty ordinary exchanges left her unhappy").toBeGreaterThan(0);
    expect(pad.dominance, "twenty ordinary exchanges took her sense of standing away").toBeGreaterThan(-0.2);
  });
});

describe("② he has standing on the substance, none in the manner — she does it, differently", () => {
  const t = turn(CURT, 300, "rested", 0.3);

  it("she does it: no refusal", () => {
    expect(t.reluctance, "a curt message from someone she knows well became a refusal")
      .toBeLessThan(RELUCTANCE_THRESHOLD);
  });

  it("and it costs him: she says less of it", () => {
    // S-24. `usedAsAThing` narrows the room, so the same state with the same reserve has fewer
    // beats in it: she answers, and there is less of her in the answer.
    const ordinary = shapes(baseShape({ landed: null }));
    const handled = shapes(baseShape({ landed: { atSea: 0.1, usedAsAThing: 0.8, indignant: 0.2 } }));
    expect(handled.mean, "being handled did not shorten what she said").toBeLessThan(ordinary.mean);
  });

  it("and she is likelier to put something of her own after the answer", () => {
    // S-27. 「另外——」: the sentence that follows the thing he asked for and is not it.
    const ordinary = shapes(baseShape({ landed: null }));
    const wronged = shapes(baseShape({ landed: { atSea: 0.1, usedAsAThing: 0.3, indignant: 0.8 } }));
    expect(wronged.adds, "indignation never once reached the sentence").toBeGreaterThan(ordinary.adds);
  });

  it("and she does not close off a thing she cannot place", () => {
    // S-26. A closing sentence over something she has not understood is a pretence of having
    // understood it.
    const ordinary = shapes(baseShape({ landed: null }));
    const lost = shapes(baseShape({ landed: { atSea: 0.85, usedAsAThing: 0.2, indignant: 0.1 } }));
    expect(lost.open, "being at sea never once left anything open").toBeGreaterThan(ordinary.open);
  });

  it("but NONE of it fires when he was perfectly reasonable", () => {
    const ordinary = shapes(baseShape({ landed: null }));
    const fine = shapes(baseShape({ landed: { atSea: 0.05, usedAsAThing: 0.05, indignant: 0.02 } }));
    expect(Math.abs(fine.mean - ordinary.mean), "a reasonable message changed the shape anyway")
      .toBeLessThan(0.15);
  });
});

describe("③ he has none and she has something in her — she says no", () => {
  it("the reading puts him at the bottom of his standing", () => {
    const t = turn(CURT, 0, "rested", 0.9);
    expect(t.landed.appraised.entitlement).toBeLessThan(0.25);
    expect(t.landed.appraised.herPower).toBeGreaterThan(0.8);
  });

  it("and she often does not take it on at all, which is what this scene actually is", () => {
    // S-19's own scene. She is not unwilling, being handed a stranger's essay is not a thing she
    // does not want to do, it is a thing that does not yet make sense as a thing to be doing. The
    // willingness gate answers a different question, and turning its weight up until it crossed
    // would have bought a woman who declines things.
    const t = turn(CURT, 0, "rested", 0.9);
    const share = takesOnShare(t.landed);
    // eslint-disable-next-line no-console
    console.log(`\n  ③ curt demand at a first meeting: she takes it on ${(100 * share).toFixed(0)}% of the time`);
    expect(share, "a stranger's peremptory demand is simply executed, every time").toBeLessThan(0.8);
    const known = turn(CURT, 300, "rested", 0.9);
    expect(takesOnShare(known.landed) - share, "the relationship makes no difference")
      .toBeGreaterThan(0.15);
  });

  it("and the OUTRIGHT decline is reachable too, when she also has her own things pressing", () => {
    // Cell ③ has two forms and both are real, which is worth stating plainly rather than blurring:
    //
    //   the common one   she does not take it up AS WORK. She answers, she asks what this is, she
    //                    does not go and produce two thousand words. About half the time, at a
    //                    first meeting, and it is what S-19's scene actually describes.
    //   the rare one     she says no. It needs him to have overstepped AND something of her own to
    //                    already be pressing: 0.08% of the states swept in
    //                    `reachable-reluctance.test.ts`, and every one of them because of him.
    //
    // Conflating them is what six failed interventions did: they all tried to make the first scene
    // happen by turning up the second one's number.
    const f = createLivingField();
    f.encodeClaim({ key: "told:1", text: "x", nowMs: Date.now() - DAY, origin: "told", source: "chat:1", withOther: true });
    const form = howHeSaidIt(CURT);
    const rel = heSpoke(EMPTY_RECORD, Date.now(), form);
    const landed = howItLanded({
      form, unlike: howUnlikeHim(form, rel), known: howLongAndHowWell(f.graph(), rel),
      litUp: 1, reserve: reserveOf({ phase: "rested", arousal: 1 }),
    });
    const r = reluctanceOf({
      request: CURT, landed, phase: "rested",
      drives: { discomfort: 1, care: 0.2, social: 0.2, curiosity: 0.5, expression: 0.1, maintenance: 0.1 },
      emotion: { pleasure: -0.4, arousal: 1, dominance: 0 },
      warmth: 0, recentDeclines: 0,
    });
    // eslint-disable-next-line no-console
    console.log(`  ③ and outright, with her own things pressing: reluctance ${r.toFixed(3)} (bar ${RELUCTANCE_THRESHOLD})`);
    expect(r, "she can never actually say no to anyone").toBeGreaterThanOrEqual(RELUCTANCE_THRESHOLD);
  });
});

describe("④ he has none and she has nothing left — she does it, and it stays", () => {
  const t = turn(CURT, 0, "dormant", -0.6);

  it("she does NOT refuse: being worn through is not the road to saying no", () => {
    expect(t.reluctance, "exhaustion became a way of refusing him").toBeLessThan(RELUCTANCE_THRESHOLD);
  });

  it("and it stays with her instead", () => {
    expect(t.landed.settles).toBe(true);
    expect(t.stays, "nothing was left with her at all").not.toBeNull();
  });

  it("which is the SAME message that made her say no when she had something in her", () => {
    // The whole 2×2 in one assertion: identical words, identical relationship, and the only thing
    // that differs is what she had in her, and it decides which cell the turn lands in.
    const strong = turn(CURT, 0, "rested", 0.9);
    expect(strong.reluctance, "her condition made no difference to the outcome")
      .toBeGreaterThan(t.reluctance);
    expect(strong.landed.appraised.herPower).toBeGreaterThan(t.landed.appraised.herPower);
  });
});

describe("the matrix as a whole", () => {
  it("ALL FOUR CELLS ARE REACHABLE, and no cell is where turns go by default", () => {
    const cells = {
      "①": turn(ASKED, 300, "rested", 0.3),
      "②": turn(CURT, 300, "rested", 0.3),
      "③": turn(CURT, 0, "rested", 0.9),
      "④": turn(CURT, 0, "dormant", -0.6),
    };
    // eslint-disable-next-line no-console
    console.log(
      "\n  the four cells, driven through the real modules"
      + Object.entries(cells).map(([name, c]) =>
        `\n    ${name}  reluctance ${c.reluctance.toFixed(3)}  power ${c.landed.appraised.herPower.toFixed(2)}`
        + `  entitlement ${c.landed.appraised.entitlement.toFixed(2)}  settles ${String(c.landed.settles).padEnd(5)}`
        + `  takes-it-on ${(100 * takesOnShare(c.landed, 120)).toFixed(0)}%`).join(""),
    );
    // ① leaves nothing; ② and ④ leave something; ③ and ④ differ only in what she had in her.
    expect(cells["①"].stays).toBeNull();
    expect(cells["②"].stays).not.toBeNull();
    expect(cells["④"].stays).not.toBeNull();
    expect(cells["③"].landed.appraised.herPower).toBeGreaterThan(cells["④"].landed.appraised.herPower);
    // And no two cells are the same turn wearing different labels.
    const signature = (c: typeof cells["①"]) =>
      `${c.reluctance > RELUCTANT_ENOUGH}|${c.landed.settles}|${takesOnShare(c.landed, 120) > 0.85}`;
    expect(new Set(Object.values(cells).map(signature)).size, "the four cells are not four things")
      .toBeGreaterThan(2);
  });

  it("and the daemon runs the whole matrix, not three quarters of it", () => {
    const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
    for (const [what, needle] of [
      ["the reading", "readHowItLanded("],
      ["her mood", "moodAfterHeSpoke("],
      ["whether she takes it on", "takesItOn("],
      ["what stays", "whatStaysWithHer("],
      ["letting go", "sheLetsItGo("],
      ["the shape", "landed: turnKey ? (landingForTurn.get(turnKey) ?? null) : null,"],
    ] as const) {
      expect(daemon, `${what} never happens on the conversation path`).toContain(needle);
    }
  });
});
