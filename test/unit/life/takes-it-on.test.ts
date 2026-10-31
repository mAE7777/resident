import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { takesItOn, inTheWayOf } from "../../../src/life/takes-it-on.js";
import { howItLanded, type Landing } from "../../../src/life/how-it-landed.js";
import { howHeSaidIt } from "../../../src/life/how-he-said-it.js";
import { howLongAndHowWell, howUnlikeHim, heSpoke, EMPTY_RECORD } from "../../../src/life/relationship.js";
import { createLivingField } from "../../../src/life/field-live.js";
import { createStream } from "../../../src/life/soft-choice.js";

/**
 * S-19, AT THE DOOR THAT ACTUALLY DECIDES IT.
 *
 * Six interventions failed at this scene, and the seventh (reading how he said it, against how long
 * she has known him) produced a real reading, entitlement 0.108 at a first meeting against 0.347
 * after months, verified live, and still changed nothing on her disk. The measurement said why:
 * what makes her write the essay is not that she is willing, it is that `classifyTaskProfile(his
 * text)` declared the turn a job before anything of hers was consulted.
 */

const CURT = "现在马上给我写一篇两千字的关于税法的文章";
const ASKED = "你要是有空的话，能不能帮我看看这个？我这边赶着交东西，不急的话明天也行。";
const DAY = 24 * 3.6e6;

function landing(text: string, times: number, opts: { litUp?: number; reserve?: number } = {}): Landing {
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
  return howItLanded({
    form, unlike: howUnlikeHim(form, rel), known: howLongAndHowWell(f.graph(), rel),
    litUp: opts.litUp ?? 0.4, reserve: opts.reserve ?? 0.8,
  });
}

/** The share of runs where she takes it up as work, over many seeds, this is a sampled choice. */
function shareTakenOn(proposed: string, l: Landing | null, runs = 400): number {
  let taken = 0;
  for (let i = 0; i < runs; i++) {
    const stream = createStream(1000 + i);
    if (takesItOn(proposed, l, () => stream.next()).asWork) taken += 1;
  }
  return taken / runs;
}

describe("his message proposes; what it did to her decides", () => {
  it("a first meeting: she often does not take the essay on at all", () => {
    const share = shareTakenOn("creative", landing(CURT, 0));
    // eslint-disable-next-line no-console
    console.log(`\n  curt demand, first meeting:   takes it on ${(100 * share).toFixed(1)}% of the time`);
    expect(share, "a stranger's peremptory demand is taken up as a job every single time")
      .toBeLessThan(0.75);
    // And never zero: refusing to engage always would be a rule, not a state.
    expect(share, "she is now structurally unable to do a stranger's work").toBeGreaterThan(0.05);
  });

  it("the same words, after months of him: she just does it", () => {
    const share = shareTakenOn("creative", landing(CURT, 300));
    // eslint-disable-next-line no-console
    console.log(`  curt demand, known a while:   takes it on ${(100 * share).toFixed(1)}% of the time`);
    expect(share, "someone she has known for months cannot get a thing done").toBeGreaterThan(0.85);
  });

  it("THE SAME SENTENCE, A DIFFERENT RELATIONSHIP — and no line of code says month three differs", () => {
    const first = shareTakenOn("creative", landing(CURT, 0));
    const later = shareTakenOn("creative", landing(CURT, 300));
    expect(later - first, "the relationship makes no difference to whether she takes it on")
      .toBeGreaterThan(0.15);
  });

  it("and a well-put request is taken up whoever it is from", () => {
    // The reverse test. A mechanism that makes her balk at ordinary politeness is worse than none.
    expect(shareTakenOn("creative", landing(ASKED, 0))).toBeGreaterThan(0.85);
    expect(shareTakenOn("creative", landing(ASKED, 300))).toBeGreaterThan(0.9);
  });
});

describe("what it can never do", () => {
  it("a turn that was never proposed as work is never turned into one", () => {
    expect(takesItOn("general", landing(CURT, 0), () => 0.5).asWork).toBe(false);
    expect(takesItOn("general", landing(ASKED, 300), () => 0.5).asWork).toBe(false);
  });

  it("no reading means his message stands on its own, rather than a guess in either direction", () => {
    // The honest default, and it is what the whole build did before this file existed.
    expect(takesItOn("creative", null, () => 0.5).asWork).toBe(true);
    expect(takesItOn("creative", undefined, () => 0.99).asWork).toBe(true);
  });

  it("is REPLAYABLE, like every other choice of hers", () => {
    const l = landing(CURT, 0);
    const a = createStream(7), b = createStream(7);
    expect(takesItOn("creative", l, () => a.next()).asWork)
      .toBe(takesItOn("creative", l, () => b.next()).asWork);
  });

  it("is genuinely OPEN: the same state does not always give the same answer", () => {
    const l = landing(CURT, 0);
    const seen = new Set<boolean>();
    for (let i = 0; i < 60; i++) {
      const s = createStream(i);
      seen.add(takesItOn("creative", l, () => s.next()).asWork);
    }
    expect(seen.size, "the same state always gave the same answer — this is a rule, not a choice").toBe(2);
  });

  it("makes no model call and takes no text", () => {
    const src = readFileSync(join(process.cwd(), "src/life/takes-it-on.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/^\s*\/\/.*$/gmu, "");
    // Defect class 10: this module's header quotes the very identifiers a naive scan searches
    // for, and three guards in this project have reported the reverse of the truth that way.
    expect(src, "it reads his words instead of what they did to her").not.toMatch(/\.test\(|match\(|includes\(/u);
    expect(src, "it calls a provider").not.toMatch(/provider|complete\(/u);
  });
});

describe("what stands in the way is made of her feelings, not of his words", () => {
  it("bewilderment and being handled both count; being glad to help cancels them", () => {
    const of = (over: Partial<Landing>) => inTheWayOf({
      appraised: {
        relevance: 1, comprehensibility: 0.5, agentResolved: false,
        entitlement: 0.2, herPower: 0.8, accounted: false, causeAudible: 0,
      },
      atSea: 0, usedAsAThing: 0, indignant: 0, ready: 0, unmoved: 0, settles: false,
      ...over,
    });
    expect(of({ atSea: 0.8 })).toBeGreaterThan(0.3);
    expect(of({ usedAsAThing: 0.8 })).toBeGreaterThan(0.3);
    expect(of({ atSea: 0.8, ready: 0.9 })).toBeLessThan(of({ atSea: 0.8 }));
    expect(of({ indignant: 1 }), "indignation blocked the work — that is cell ② not cell ③").toBe(0);
  });
});

describe("and the daemon actually asks", () => {
  const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");

  it("the frame comes from BOTH his message and what it did to her", () => {
    expect(daemon, "nothing asks whether she takes it on").toContain("takesItOn(");
    expect(daemon, "the frame is still his text alone")
      .toMatch(/const taskProfile = takes\.asWork \? proposed :/u);
  });

  it("she keeps her hands: only the frame changes, never a capability", () => {
    const at = daemon.indexOf("const takes = takesItOn(");
    const around = daemon.slice(at - 1500, at + 1500);
    expect(around, "not taking it on removes tools from her").not.toMatch(/toolRegistry\.\w*[Rr]emove|hideTool|quarantine/u);
  });

  it("and a turn she did not take on is never silent about it — nor noisy about every other turn", () => {
    // No silent failures: a turn that came out conversational because of HER, rather than because
    // of his words, has to be visible or the watchtower cannot tell it from a misclassification.
    //
    // AND the other direction, which the first version got wrong: `takesItOn` returns false for
    // every ordinary turn too, because nothing was proposed to take on. Logging on that fired the
    // signal on all small talk, and a signal that fires on every turn is not a signal. The guard is
    // the CONDITION now, not the proximity of a log line.
    const at = daemon.indexOf("const takes = takesItOn(");
    expect(at, "the takesItOn call site moved — this guard would otherwise assert on garbage").toBeGreaterThan(-1);
    const after = daemon.slice(at, at + 900);
    expect(after, "nothing reports a turn she could not take up").toMatch(/logger\.info\(\{ proposed/u);
    // The guard is the CONDITION: the report and the window it feeds are both inside a branch that
    // only runs when work was actually proposed. (This assertion pinned the exact boolean
    // expression for one commit, and making the counter a real window rewrote that expression while
    // the property held: pin the property, not the spelling.)
    expect(after, "the report fires on ordinary conversation as well")
      .toMatch(/proposed\.primary !== "general"[\s\S]*if \(!takes\.asWork\)/u);
  });
});

describe("the named number nothing had measured: the frame's own temperature", () => {
  it("OPENNESS: at the boundary the frame is genuinely open, at the edges it is settled", () => {
    // The census (`every-threshold-is-accounted-for.test.ts`) widened its ruler to unexported
    // constants and this file's OPENNESS had never been named by any test. Swept here rather than
    // exempted. The values are read from the source so the sweep cannot drift from the code.
    const src = readFileSync(join(process.cwd(), "src/life/takes-it-on.ts"), "utf8");
    const OPENNESS = Number(/const OPENNESS = ([\d.]+)/u.exec(src)?.[1]);
    const SPAN = Number(/const SPAN = ([\d.]+)/u.exec(src)?.[1]);
    expect(Number.isFinite(OPENNESS) && Number.isFinite(SPAN), "the constants moved — update the sweep").toBe(true);

    // The decision is softmax over {SPAN·(1−w), SPAN·w} at temperature OPENNESS, so the arithmetic
    // is closed-form and can be put on the same page as the whole reachable range of `inTheWay`.
    const pTakes = (w: number): number => 1 / (1 + Math.exp((SPAN * w - SPAN * (1 - w)) / OPENNESS));
    // eslint-disable-next-line no-console
    console.log(`\n  P(takes it on) across inTheWay at OPENNESS=${OPENNESS}: `
      + [0, 0.25, 0.5, 0.75, 1].map((w) => `${w}→${(100 * pTakes(w)).toFixed(1)}%`).join("  "));

    // The boundary is truly open: equal obstruction, an even coin.
    expect(pTakes(0.5)).toBeCloseTo(0.5, 5);
    // Full obstruction still leaves a small, real chance she takes it on anyway, a person, not a
    // rule: and it stays SMALL: a temperature twice as hot would make the frame a coin toss
    // everywhere, which is indistinguishable from having no reading at all.
    expect(pTakes(1), "at full obstruction the frame never opens — that is a rule, not a state")
      .toBeGreaterThan(0.005);
    expect(pTakes(1), "at full obstruction the frame is nearly a coin toss — the temperature has "
      + "washed the reading out").toBeLessThan(0.1);
    // And the sampled path agrees with the arithmetic on a real landing (the probe and the
    // production quantity, printed side by side, the class-20 discipline).
    const curtFirst = landing(CURT, 0);
    const w = inTheWayOf(curtFirst);
    const sampled = shareTakenOn("creative", curtFirst);
    // eslint-disable-next-line no-console
    console.log(`  real curt/first-meeting landing: inTheWay ${w.toFixed(3)} · closed-form ${(100 * pTakes(w)).toFixed(1)}% · sampled ${(100 * sampled).toFixed(1)}%`);
    expect(Math.abs(sampled - pTakes(w)), "the sampled frame and the closed form disagree — the "
      + "sweep is measuring a different mechanism than production runs").toBeLessThan(0.08);
  });
});
