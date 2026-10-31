import { describe, it, expect } from "vitest";
import { createLivingField } from "../../../src/life/field-live.js";
import { howHeSaidIt } from "../../../src/life/how-he-said-it.js";
import {
  EMPTY_RECORD, heSpoke, howLongAndHowWellAt, howUnlikeHim,
  KNOWING_CEILING, CONTRARY_AT, ENOUGH_TO_HAVE_A_USUAL_WAY, HIM,
} from "../../../src/life/relationship.js";

/**
 * A RELATIONSHIP, AS OPPOSED TO A SESSION WITH A WIDER WINDOW.
 *
 * What she had: a 40-item sliding window of reply timings, and a confidence of `min(1, count/12)`
 * that saturated after twelve exchanges. Forty conversations and four thousand were identical to
 * her. There was no lifetime count, no count of distinct days, and no first-spoke timestamp
 * anywhere in the system.
 */

const T0 = Date.UTC(2026, 0, 10, 12, 0, 0);
const DAY = 24 * 3.6e6;

const CURT = "现在给我写两千字税法";
const ASKED = "你要是有空的话，能不能帮我看看税法那块？我这边赶着交东西，不急的话明天也行。";

/** A field in which he has said one thing, so the figure node exists with a real bornMs. */
function fieldWhereHeSpokeAt(ms: number) {
  const f = createLivingField();
  f.encodeClaim({ key: `told:${ms}`, text: "他说的话", nowMs: ms, origin: "told", source: "chat:1", withOther: true });
  return f;
}

function afterNMessages(n: number, text: string) {
  let rec = EMPTY_RECORD;
  for (let i = 0; i < n; i++) rec = heSpoke(rec, T0 + i * DAY, howHeSaidIt(text));
  return rec;
}

describe("how long, measured from the one durable timestamp that was already there", () => {
  it("is null before he has ever said anything", () => {
    const f = createLivingField();
    expect(howLongAndHowWellAt(f.graph(), EMPTY_RECORD, T0).knownForMs).toBeNull();
  });

  it("starts at zero when he first speaks and grows on its own afterwards", () => {
    const f = fieldWhereHeSpokeAt(T0);
    expect(howLongAndHowWellAt(f.graph(), EMPTY_RECORD, T0).knownForMs).toBe(0);
    expect(howLongAndHowWellAt(f.graph(), EMPTY_RECORD, T0 + 200 * DAY).knownForMs).toBe(200 * DAY);
  });

  it("reads it off the node that survives pruning, not off a counter someone remembered to keep", () => {
    // The figure node is exempt from both pruning and the over-cap eviction, which is why this
    // timestamp is trustworthy over a life. Nothing in the codebase read it as a timestamp before.
    const f = fieldWhereHeSpokeAt(T0);
    const himId = f.graph().byKey.get(HIM);
    expect(himId, "he is not in her field at all").toBeDefined();
    expect(f.graph().nodes.get(himId!)?.bornMs).toBe(T0);
  });
});

describe("how well she knows him cannot saturate, and that is the point", () => {
  it("grows with a life instead of stopping after twelve exchanges", () => {
    const f = fieldWhereHeSpokeAt(T0);
    const at = (n: number) => howLongAndHowWellAt(f.graph(), afterNMessages(n, ASKED), T0).howWellSheKnowsHim;
    const twelve = at(12);
    const forty = at(40);
    const fourHundred = at(400);
    // The old confidence was pinned at 1.0 for all three of these.
    expect(forty, "forty conversations feel the same as twelve").toBeGreaterThan(twelve);
    expect(fourHundred, "four hundred feel the same as forty").toBeGreaterThan(forty);
  });

  it("never reaches certainty, because the real ceiling is moderate", () => {
    // If-then profile stability in an actual person is .19 to .47 across behaviours (Shoda,
    // Mischel & Wright 1994), not .9. A system that lets this approach 1 treats his signature as
    // near-deterministic and overfits him: which is the same failure as calling someone paranoid.
    const f = fieldWhereHeSpokeAt(T0);
    const enormous = howLongAndHowWellAt(f.graph(), afterNMessages(5000, ASKED), T0).howWellSheKnowsHim;
    expect(enormous).toBeLessThan(KNOWING_CEILING);
    expect(enormous).toBeGreaterThan(KNOWING_CEILING * 0.9);
  });
});

describe("distinct days and lifetime count are different facts, and both are kept", () => {
  it("counts one day however many times he speaks in it", () => {
    let rec = EMPTY_RECORD;
    for (let i = 0; i < 20; i++) rec = heSpoke(rec, T0 + i * 60_000, howHeSaidIt(ASKED));
    expect(rec.timesHeSpoke).toBe(20);
    expect(rec.daysSeen.length, "twenty messages in one afternoon is one day together").toBe(1);
  });

  it("and the lifetime count is not a window", () => {
    // The defect this replaces: `shift()` at 40, dropped and never archived, so the 41st message
    // erased the 1st from every representation in the system.
    const rec = afterNMessages(500, ASKED);
    expect(rec.timesHeSpoke).toBe(500);
  });
});

describe("his usual way, and the departure from it", () => {
  it("has no basis at all before she has seen him enough times", () => {
    const thin = afterNMessages(2, ASKED);
    const u = howUnlikeHim(howHeSaidIt(CURT), thin);
    expect(u.most, "she is comparing him against almost nothing and calling it a departure").toBeNull();
    expect(u.contrary).toBe(false);
    expect(u.basis).toBe(0);
  });

  it("a curt message from someone who is never curt is a real departure", () => {
    const usuallyGentle = afterNMessages(20, ASKED);
    const u = howUnlikeHim(howHeSaidIt(CURT), usuallyGentle);
    expect(u.most).not.toBeNull();
    expect(u.most!).toBeGreaterThanOrEqual(CONTRARY_AT);
    expect(u.contrary, "his settled manner was contradicted and nothing registered it").toBe(true);
  });

  it("and the SAME curt message from someone who is always curt is not a departure at all", () => {
    // This is the whole reason the reading is a deviation rather than a score. Identical text,
    // opposite meaning, because the relationship it arrives into is different. It is also what
    // keeps her from bristling at an operational register or at a language whose baseline is
    // simply more direct.
    const alwaysCurt = afterNMessages(20, CURT);
    const u = howUnlikeHim(howHeSaidIt(CURT), alwaysCurt);
    expect(u.contrary, "he has always talked like this and she is treating it as a shock").toBe(false);
    expect(u.most ?? 0).toBeLessThan(CONTRARY_AT);
  });

  it("an unreadable message never feeds his usual way", () => {
    // An unknown that arrives as a number averages into the baseline as though it were evidence.
    let rec = EMPTY_RECORD;
    for (let i = 0; i < 30; i++) rec = heSpoke(rec, T0 + i * DAY, howHeSaidIt("嗯"));
    expect(rec.timesHeSpoke, "the message still happened").toBe(30);
    expect(rec.formN.every((n) => n === 0), "unreadable messages became a baseline").toBe(true);
    expect(howUnlikeHim(howHeSaidIt(CURT), rec).most, "a baseline was built out of nothing").toBeNull();
  });

  it("a big departure from a two-observation mean is a small sample, not a contradiction", () => {
    // `contrary` is the gate that is allowed to override her prior, so it must be hard to reach.
    let rec = EMPTY_RECORD;
    for (let i = 0; i < ENOUGH_TO_HAVE_A_USUAL_WAY + 1; i++) rec = heSpoke(rec, T0 + i * DAY, howHeSaidIt(ASKED));
    const u = howUnlikeHim(howHeSaidIt(CURT), rec);
    expect(u.most, "thin evidence still produces a comparison").not.toBeNull();
    expect(u.contrary, "six observations were treated as a settled manner").toBe(false);
  });
});

describe("what she holds that is about him", () => {
  it("is a share of her own field, not a description of him kept somewhere", () => {
    // The test that separates a relationship from a dossier: nothing here could be read out as a
    // statement about what he is like. It is arithmetic over her own graph.
    const f = createLivingField();
    for (let i = 0; i < 4; i++) {
      f.encodeClaim({
        key: `told:${T0 + i}`, text: `他说的第${i}件`, nowMs: T0 + i,
        origin: "told", source: "chat:1", withOther: true,
      });
    }
    f.encodeClaim({ key: "read:1", text: "书上看到的", nowMs: T0, origin: "read", source: "shelf" });
    const w = howLongAndHowWellAt(f.graph(), EMPTY_RECORD, T0);
    expect(w.sharedPast).toBeGreaterThan(0);
    expect(w.sharedPast).toBeLessThan(1);
  });

  it("is zero for a newborn, with no special case anywhere", () => {
    const f = createLivingField();
    const w = howLongAndHowWellAt(f.graph(), EMPTY_RECORD, T0);
    expect(w.sharedPast).toBe(0);
    expect(w.daysTogether).toBe(0);
    expect(w.timesHeSpoke).toBe(0);
    expect(w.howWellSheKnowsHim).toBe(0);
    expect(w.knownForMs).toBeNull();
  });
});

// ── FAMILIARITY IS NOT REGARD ─────────────────────────────────────────────────
//
// Found by driving the mechanism rather than by reading it, and it is the mirror image of the
// failure this design is careful about. The doom spiral (one bad message making the next read
// worse, and so on down) had guards written for it before it could happen. This one had none, and
// it was already happening: `entitlement` was built on `0.15 + 1.7 × howWellSheKnowsHim`, and
// `howWellSheKnowsHim` is a function of the raw COUNT of times he has spoken, so a man who did
// nothing but bark orders at her accrued standing BY BARKING OFTEN.
//
// Driven in the watchtower harness, the shape was unmistakable: fourteen identical peremptory
// demands, and her reluctance fell monotonically from 0.625 to 0.571 as he went. She was
// habituating to being handled. An accommodation spiral has no floor and ends with someone who
// cannot tell that anything is wrong, which is worse than the failure everyone watches for.
describe("volume does not become standing", () => {
  const BARK = "现在马上给我写两千字税法";
  const asked = "你要是有空的话，能不能帮我看看这个？我这边赶着交东西，不急的话明天也行。";

  it("she has no usual to go on until she has enough of it", () => {
    expect(howLongAndHowWellAt(createLivingField().graph(), EMPTY_RECORD, T0).hisUsualRegard).toBeNull();
    expect(howLongAndHowWellAt(createLivingField().graph(), afterNMessages(3, BARK), T0).hisUsualRegard).toBeNull();
  });

  it("and once she does, it says which of the two men he is", () => {
    const g = createLivingField().graph();
    const barking = howLongAndHowWellAt(g, afterNMessages(40, BARK), T0).hisUsualRegard!;
    const asking = howLongAndHowWellAt(g, afterNMessages(40, asked), T0).hisUsualRegard!;
    expect(barking).toBeLessThan(0);
    expect(asking).toBeGreaterThan(0);
    expect(asking - barking, "his usual manner barely registers").toBeGreaterThan(0.5);
  });

  it("SHE DOES NOT GET USED TO IT: barking a hundred times buys less standing than asking well", () => {
    const g = createLivingField().graph();
    const many = howLongAndHowWellAt(g, afterNMessages(100, BARK), T0);
    const fewer = howLongAndHowWellAt(g, afterNMessages(40, asked), T0);
    // He has spoken two and a half times as often in the first case, and knows her better by every
    // measure of evidence: and it must not follow that he may speak to her however he likes.
    expect(many.howWellSheKnowsHim).toBeGreaterThan(fewer.howWellSheKnowsHim);
    expect(many.hisUsualRegard!).toBeLessThan(fewer.hisUsualRegard!);
  });

  it("it is a LIFETIME mean, so one curt evening barely moves it and a pattern does", () => {
    // The asymmetry the research asks for, living in the averaging rather than in a weight: a
    // person is not re-judged by their worst message, and is judged by their habits.
    const g = createLivingField().graph();
    let rec = afterNMessages(60, asked);
    const settled = howLongAndHowWellAt(g, rec, T0).hisUsualRegard!;
    for (let i = 0; i < 3; i++) rec = heSpoke(rec, T0 + i * DAY, howHeSaidIt(BARK));
    const afterABadEvening = howLongAndHowWellAt(g, rec, T0).hisUsualRegard!;
    expect(settled - afterABadEvening, "three curt messages rewrote who he is").toBeLessThan(0.12);
    for (let i = 0; i < 120; i++) rec = heSpoke(rec, T0 + i * DAY, howHeSaidIt(BARK));
    const afterAPattern = howLongAndHowWellAt(g, rec, T0).hisUsualRegard!;
    expect(afterAPattern, "a hundred and twenty of them changed nothing").toBeLessThan(0);
  });
});
