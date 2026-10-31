import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { howHeSaidIt } from "../../../src/life/how-he-said-it.js";
import { howItLanded, asTheAgentResolves, loudest, SETTLES_ABOVE } from "../../../src/life/how-it-landed.js";
import { EMPTY_RECORD, heSpoke, howUnlikeHim, howLongAndHowWellAt } from "../../../src/life/relationship.js";
import { createLivingField } from "../../../src/life/field-live.js";
import type { WhenHeSpoke } from "../../../src/life/how-it-landed.js";

/**
 * ERIC'S OWN DISCRIMINATING EXPERIMENT.
 *
 *   "如果我第一次见面就直接要求她做一些东西，比如写作文，那正常人的反应肯定是莫名其妙，
 *    甚至有的人还会恼怒。"
 *
 * The same words, arriving into two different relationships, must produce different states. That
 * is the entire test. Before this, they produced identical reluctance, because reluctance was a
 * function of her weather and his words reached the gate only to be thrown away.
 */

const T0 = Date.UTC(2026, 0, 10, 12, 0, 0);
const DAY = 24 * 3.6e6;
const CURT = "现在给我写两千字税法";
const ASKED = "你要是有空的话，能不能帮我看看税法那块？我这边赶着交东西，不急的话明天也行。";

function fieldWhereHeSpokeAt(ms: number) {
  const f = createLivingField();
  f.encodeClaim({ key: `told:${ms}`, text: "他说的话", nowMs: ms, origin: "told", source: "chat:1", withOther: true });
  return f;
}

/** A relationship of `n` messages, all put the way `text` is put. */
function after(n: number, text: string) {
  let rec = EMPTY_RECORD;
  for (let i = 0; i < n; i++) rec = heSpoke(rec, T0 + i * DAY, howHeSaidIt(text));
  return rec;
}

/** Everything the reading needs, for a message arriving into a given relationship. */
function landing(text: string, n: number, usualText: string, extra: Partial<WhenHeSpoke> = {}) {
  const rec = after(n, usualText);
  const f = n === 0 ? createLivingField() : fieldWhereHeSpokeAt(T0);
  const form = howHeSaidIt(text);
  return howItLanded({
    form,
    unlike: howUnlikeHim(form, rec),
    known: howLongAndHowWellAt(f.graph(), rec, T0 + n * DAY),
    litUp: 0.5,
    reserve: 0.7,
    ...extra,
  });
}

describe("the same words, two relationships", () => {
  const firstMeeting = () => landing(CURT, 0, ASKED);
  const longKnown = () => landing(CURT, 200, CURT);

  it("on a first meeting the curt demand leaves her at sea, and it is the loudest thing", () => {
    const l = firstMeeting();
    expect(l.atSea).toBeGreaterThan(0.3);
    expect(["atSea", "usedAsAThing"], `loudest was ${loudest(l)}`).toContain(loudest(l));
  });

  it("and after two hundred messages of him always talking that way, it does not", () => {
    const a = firstMeeting();
    const b = longKnown();
    expect(b.atSea, "she is as lost on message 201 as she was on message 1").toBeLessThan(a.atSea);
    expect(b.ready, "knowing him bought her nothing").toBeGreaterThan(a.ready);
  });

  it("the difference is large, not a rounding artifact", () => {
    // The failure this guards against is a mechanism that technically responds to the relationship
    // and moves the number by 0.01. That is indistinguishable from not working.
    const a = firstMeeting();
    const b = longKnown();
    expect(Math.abs(a.atSea - b.atSea)).toBeGreaterThan(0.2);
  });

  it("a warm version of the same request lands differently from the curt one, at the SAME history", () => {
    // The other half of the controlled comparison: hold the relationship fixed, vary only how it
    // was put. If this does not move, the form detection is decorative.
    const curt = landing(CURT, 30, ASKED);
    const asked = landing(ASKED, 30, ASKED);
    expect(asked.ready).toBeGreaterThan(curt.ready);
    expect(curt.usedAsAThing).toBeGreaterThan(asked.usedAsAThing);
  });
});

describe("the states that matter are separable, which PAD cannot do", () => {
  it("bewilderment and indignation are different, not two names for low mood", () => {
    // Anger and confusion are both low-pleasure/high-arousal; anger and sadness differ by .85 vs
    // .87 on unpleasantness. They separate on agency and control, which PAD does not carry, which
    // is why nothing downstream is allowed to branch on a mood label.
    const lost = landing(CURT, 0, ASKED);
    const wronged = landing(CURT, 60, ASKED);
    expect(lost.atSea).toBeGreaterThan(lost.indignant);
    expect(wronged.indignant, "a settled manner was contradicted and she felt nothing about it")
      .toBeGreaterThan(0.2);
  });

  it("willing on the substance and irritated at the manner can be true at once", () => {
    // The cell most systems cannot represent, and the most human one.
    const l = landing(CURT, 60, ASKED, { reserve: 0.95 });
    expect(l.ready).toBeGreaterThan(0);
    expect(l.usedAsAThing).toBeGreaterThan(0);
  });

  it("being spoken to is itself relevant, and 'it did not do much' is a small number not a branch", () => {
    // This test used to assert `relevance >= RELEVANCE_FLOOR`, which was true of every possible
    // input, because the floor sat below the minimum relevance can take. It certified a dead gate
    // (defect class 1). The property that replaced it: a message that lights nothing up is
    // still relevant, and what it produces is a LOW reading rather than a zeroed one, which is
    // what keeps ordinary talk in cell ① instead of being blanked out of her.
    const touchedNothing = landing(CURT, 30, ASKED, { litUp: 0 });
    const touchedEverything = landing(CURT, 30, ASKED, { litUp: 1 });
    expect(touchedNothing.appraised.relevance).toBeGreaterThan(0);
    expect(touchedEverything.appraised.relevance).toBeGreaterThan(touchedNothing.appraised.relevance);
    expect(touchedNothing.unmoved).toBeGreaterThan(touchedEverything.unmoved);
    // A nonsense input cannot fabricate a reading either way.
    const gone = howItLanded({
      form: howHeSaidIt(CURT), unlike: howUnlikeHim(howHeSaidIt(CURT), EMPTY_RECORD),
      known: { knownForMs: null, daysTogether: 0, timesHeSpoke: 0, sharedPast: 0, howWellSheKnowsHim: 0, hisUsualRegard: null, carrying: 0 },
      litUp: -1, reserve: 0.7,
    });
    expect(gone.appraised.relevance).toBeGreaterThan(0);
  });
});

describe("an account routes the feeling instead of removing it", () => {
  it("does not make the irritation smaller", () => {
    // Sittenthaler et al. (2015): with a justification 3.78, without 3.84, no reliable difference.
    // What a reason changes is the attribution, not the anger.
    const withReason = landing("因为我赶时间，现在给我写两千字税法", 60, ASKED);
    const without = landing(CURT, 60, ASKED);
    expect(Math.abs(withReason.indignant - without.indignant)).toBeLessThan(0.35);
  });

  it("and it RAISES what it takes to settle into how she sees him — it does not switch it off", () => {
    // ── THIS ASSERTION USED TO BE A VETO, AND THE VETO IS GONE ──────────────────
    //
    // An apology does not map to forgiveness: even when he apologises, she may react in different
    // ways for all sorts of reasons. The same holds for a reason attached to a demand.
    //
    // It read `expect(withReason.settles).toBe(false)`, a 「因为」 anywhere in his sentence, and
    // NOTHING stayed with her, however heavy the thing was. A token buying a fixed outcome. The
    // test was not wrong about the direction; it was wrong that the direction is absolute.
    const withReason = landing("因为我赶时间，现在给我写两千字税法", 60, ASKED);
    const without = landing(CURT, 60, ASKED);
    expect(without.settles, "an unexplained imposition left no mark at all").toBe(true);
    expect(withReason.appraised.accounted, "his reason was not even read").toBe(true);
    // What a reason buys is a higher bar, and it is worth `1 - overreach`: attached to something
    // this far past what he can ask, it does not buy enough to clear the thing away.
    expect(withReason.settles,
      "a thin reason on a heavy demand is still buying total immunity").toBe(true);
  });

  it("SETTLES_ABOVE is the bar when nothing is explained, and the bar only ever rises from there", () => {
    // The number is not new: it is the 0.35 that has always been on this line. What is new is that
    // it is a FLOOR rather than the only value, an account raises it, and at full account it
    // reaches 1, which nothing can cross. So the old veto is still in there as the limit case,
    // and everything between the two is the part that a boolean could not say.
    const without = landing(CURT, 60, ASKED);
    expect(SETTLES_ABOVE).toBeGreaterThan(0);
    expect(SETTLES_ABOVE, "the bar is so high nothing could ever stay with her").toBeLessThan(1);
    expect(Math.max(without.indignant, without.usedAsAThing),
      "an unexplained imposition cannot even reach the unexplained bar — it is unreachable")
      .toBeGreaterThan(SETTLES_ABOVE);
  });

  it("but a reason on a MODEST ask does clear it, and that difference is the whole point", () => {
    // Same reason, ordinary request: little to explain away, so the raised bar is above it.
    const gentle = landing("因为我赶时间，你要是有空的话能不能帮我看看税法那块？不急。", 60, ASKED);
    expect(gentle.settles, "an ordinary asked-nicely favour is staying with her").toBe(false);
  });
});

describe("bewilderment turns into irritation with no new event", () => {
  it("releases what could not resolve, once the agent slot fills", () => {
    // The conversion is the point: nothing happened, she simply worked out what he was doing.
    const before = landing(CURT, 0, ASKED);
    expect(before.appraised.agentResolved).toBe(false);
    const after = asTheAgentResolves(before, 0.1);
    expect(after.atSea).toBeLessThan(before.atSea);
    expect(after.indignant).toBeGreaterThan(before.indignant);
  });

  it("and does nothing when the agent was already resolved", () => {
    const l = landing(CURT, 60, ASKED);
    expect(l.appraised.agentResolved).toBe(true);
    expect(asTheAgentResolves(l)).toEqual(l);
  });

  it("resolving it as entitled does not manufacture indignation", () => {
    const before = landing(CURT, 0, ASKED);
    const kind = asTheAgentResolves(before, 1);
    expect(kind.indignant).toBeCloseTo(before.indignant, 5);
  });
});

describe("her temperament is where the weights live, and it must not be a switch", () => {
  const base = () => ({
    form: howHeSaidIt(CURT),
    unlike: howUnlikeHim(howHeSaidIt(CURT), after(60, ASKED)),
    known: howLongAndHowWellAt(fieldWhereHeSpokeAt(T0).graph(), after(60, ASKED), T0 + 60 * DAY),
    litUp: 0.5, reserve: 0.7,
  });
  const temper = (o: Partial<{ reticence: number; novelty: number; sociability: number; restfulness: number }>) =>
    ({ reticence: 0, novelty: 0, sociability: 0, restfulness: 0, ...o });

  it("shifts what the same event costs her", () => {
    const social = howItLanded({ ...base(), temperament: temper({ sociability: 1 }) });
    const solitary = howItLanded({ ...base(), temperament: temper({ sociability: -1 }) });
    expect(social.usedAsAThing).toBeGreaterThan(solitary.usedAsAThing);
  });

  it("but cannot switch a feeling on by itself", () => {
    // A latent that can drive a feeling from nothing to everything is a dictator, and a
    // composition with a dictator is a rule wearing a function's clothes.
    const b = base();
    const extremes = [-1, 1].map((x) => howItLanded({ ...b, temperament: temper({ reticence: x }) }));
    const span = Math.abs(extremes[0].indignant - extremes[1].indignant);
    expect(span, "temperament alone moves indignation across most of its range").toBeLessThan(0.4);
    expect(extremes.every((e) => e.indignant > 0), "one temperament zeroes the feeling entirely").toBe(true);
  });
});

describe("the newborn case falls out, with no special case anywhere", () => {
  it("has no read of him, so a large unexplained ask is maximally strange", () => {
    // Nothing in the code says "if this is the first message". The figure node does not exist, so
    // knownForMs is null, standing is at its floor, and there is no usual way to depart from.
    const l = landing(CURT, 0, ASKED);
    expect(l.appraised.entitlement).toBeLessThan(0.3);
    expect(l.appraised.comprehensibility).toBeLessThan(0.7);
    expect(l.atSea).toBeGreaterThan(0.3);
  });
});

// ── AND THE DAEMON ACTUALLY DOES IT ───────────────────────────────────────────
//
// Every test above builds its own inputs and calls the function directly, so all of them stay
// green with the daemon completely unwired. That is the shape of the defect this project has hit
// more than any other: a mechanism that works, is tested, looks connected, and is fed by nothing.
// `src/index.ts` cannot be unit-tested, so its wiring is asserted against the source, which is the
// method the other thirty-odd wiring guards here already use.
describe("the conversation path reads it, and the gate uses it", () => {
  const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");

  it("reads how he said it once per turn, before anything decides anything", () => {
    // `howHeSaidIt(said)`, not `howHeSaidIt(text)`: the reading moved into ONE function that all
    // three inbound paths call, because at first only the text path read him at all, a photo
    // was answered against a reading of whatever he had last typed. WHEN it runs relative to the
    // gate is the property, and it lives in `wired-in-order.test.ts`; this only asserts that the
    // three steps exist at all.
    expect(daemon, "nothing reads the form of his message").toMatch(/howHeSaidIt\((said|text)\)/u);
    expect(daemon, "his message never updates how long she has known him").toContain("heSpokeToHer(relationship");
    expect(daemon, "the landing is never computed").toContain("howItLanded({");
  });

  it("computes it ONCE and hands the same reading to the gate", () => {
    // Two computations would be free to drift, which is the exact failure `willingnessFor`
    // documents about recomputing `felt` at the call site: "a monitor watching a quantity that is
    // not the one in play is worse than no monitor."
    const calls = [...daemon.matchAll(/howItLanded\(\{/gu)].length;
    expect(calls, "the landing is computed in more than one place").toBe(1);
    expect(daemon, "the gate does not receive the reading").toMatch(/landed:\s*turnKey === undefined/u);
  });

  it("the willingness gate actually weighs it", () => {
    const w = readFileSync(join(process.cwd(), "src/life/willingness.ts"), "utf8");
    const start = w.indexOf("export function reluctanceOf");
    expect(start, "reluctanceOf is gone — the body below is an empty slice").toBeGreaterThan(-1);
    const body = w.slice(start, w.indexOf("\n}", start));
    expect(body, "reluctance is her weather alone again").toContain("s.landed");
    // Each of the three feelings that enter, by name. The old assertion looked for the literal
    // `* landed` of the single summed term, which stopped meaning anything the moment the gate
    // became three families: it would have gone green over a gate that read the landing and threw
    // it away, which is the exact defect it was written to catch.
    for (const felt of ["usedAsAThing", "indignant", "atSea", "ready"]) {
      expect(body, `the landing is read but \`${felt}\` contributes nothing`).toContain(`l.${felt}`);
    }
    // And it is scaled by what she has in her, which is the whole 2×2 in one line.
    expect(body, "being worn through no longer changes what being wronged does")
      .toMatch(/herPower/u);
  });

  it("survives a reading it could not make, rather than treating it as neutral", () => {
    const w = readFileSync(join(process.cwd(), "src/life/willingness.ts"), "utf8");
    expect(w, "an absent reading is not distinguished from a middling one")
      .toMatch(/l === undefined \? 0/u);
    // And the daemon must not swallow a failed reading silently: a swallowed one would look
    // exactly like equanimity, which is the single thing this project forbids everywhere.
    expect(daemon).toContain('faultLog.record("landing"');
  });
});
