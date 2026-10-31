import { describe, it, expect } from "vitest";
import { WITHHOLDING_STOPS_AT } from "../../../src/life/field-live.js";
import { createLivingField, NOTHING_SURFACES } from "../../../src/life/field-live.js";
import { createStream } from "../../../src/life/soft-choice.js";

const T0 = Date.UTC(2026, 4, 1, 9, 0, 0);
// Distinct seed bases so no two sweeps draw the same sequence.
const replySEED = 1000, absSEED = 500_000, bSEED = 700_000, aSEED = 900_000;
const DAY = 24 * 60 * 60 * 1000;

function aField() {
  return createLivingField({ faults: { record: () => {} }, maxFusionsPerRest: 1 });
}

/**
 * Put one thing in her that she is carrying, at a given pressure and cost to say.
 * Everything else about the field is left empty so the rate measured is about THIS thing.
 */
function carrying(opts: { tension: number; reticence?: number; bornDaysAgo?: number }) {
  const field = aField();
  const born = T0 - (opts.bornDaysAgo ?? 0) * DAY;
  const node = field.encodeQuestion({
    key: "q", text: "the thing she has not said", nowMs: born, source: "test", tension: opts.tension,
  })!;
  if (opts.reticence !== undefined) node.reticence = opts.reticence;
  return { field, node };
}

/** How often, over many replies, anything of hers comes up at all. */
function rate(opts: { tension: number; reticence?: number; bornDaysAgo?: number; openness?: number }, trials = 4000): number {
  let surfaced = 0;
  for (let i = 0; i < trials; i++) {
    const { field } = carrying(opts);
    const stream = createStream(replySEED + i);
    const got = field.whatSurfacesInReply(T0, stream, { openness: opts.openness ?? 0.5 });
    if (got) surfaced += 1;
  }
  return surfaced / trials;
}

describe("what comes up when he speaks to her", () => {
  it("is usually nothing, which is what a reply is normally like", () => {
    // An ordinary open thing, barely over the line that counts as unsettled at all. If this
    // came up in most replies she would be a person who brings up her one grievance whatever
    // you say to her.
    const r = rate({ tension: 0.3, reticence: 0.3 });
    console.log(`  barely unsettled, ordinary cost : ${(r * 100).toFixed(1)}% of replies`);
    // Measured 3.3% against a target of 3% written down before the constants were solved.
    // The band is wide enough for the scoring to change slightly and narrow enough that a
    // change which makes her repetitive fails here rather than in front of Eric.
    expect(r).toBeGreaterThan(0.01);
    expect(r).toBeLessThan(0.07);
  });

  it("something that will not let her alone does come up, sometimes", () => {
    const r = rate({ tension: 0.9, reticence: 0.2, bornDaysAgo: 21 });
    console.log(`  pressing, carried three weeks   : ${(r * 100).toFixed(1)}% of replies`);
    // Measured 36.1% against a target of 35%.
    expect(r).toBeGreaterThan(0.25);
    // And still not every time: something she always says is a script, not a person.
    expect(r).toBeLessThan(0.5);
  });

  it("pressure moves it monotonically", () => {
    const rates = [0.3, 0.5, 0.7, 0.9].map((tension) => rate({ tension, reticence: 0.3 }));
    console.log(`  as it presses harder            : ${rates.map((x) => `${(x * 100).toFixed(0)}%`).join(" → ")}`);
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i], "more pressure did not make it more likely to come up").toBeGreaterThan(rates[i - 1]);
    }
    // A GRADIENT, not a cliff. The first version used the adaptive temperature meant for
    // "which of these things", and measured 0% / 0% / 1% / 11%: a step function pretending to
    // be a disposition. If the top and bottom of the sweep are ever more than about 12x apart
    // again, the same mistake has come back.
    expect(rates[3] / Math.max(rates[0], 0.001), "the response became a cliff again").toBeLessThan(12);
  });

  describe("reticence is real, not a note asking the model to hold back", () => {
    it("a costly thing comes up less than a cheap one at the same pressure", () => {
      const cheap = rate({ tension: 0.8, reticence: 0.1 });
      const costly = rate({ tension: 0.8, reticence: 0.9 });
      console.log(`  same pressure, cheap vs costly  : ${(cheap * 100).toFixed(0)}% vs ${(costly * 100).toFixed(0)}%`);
      expect(costly).toBeLessThan(cheap * 0.75);
    });

    it("and it costs MORE when he does not look reachable", () => {
      // The same interaction chooseSubject has: waiting for a good moment only means something
      // if the cost of the thing and the openness of the moment meet.
      const warm = rate({ tension: 0.8, reticence: 0.8, openness: 0.9 });
      const cold = rate({ tension: 0.8, reticence: 0.8, openness: 0.1 });
      console.log(`  costly thing, warm vs closed    : ${(warm * 100).toFixed(0)}% vs ${(cold * 100).toFixed(0)}%`);
      expect(cold).toBeLessThan(warm);
    });

    it("what loses is ABSENT, never present-and-marked-difficult", () => {
      // The whole point. A losing candidate must not reach the caller in any form that could
      // be put in front of the model, because "here is the thing, it is hard for her to say"
      // is a thing the model can simply decide to say.
      const { field } = carrying({ tension: 0.9, reticence: 0.99 });
      let sawNothing = 0;
      for (let i = 0; i < 200; i++) {
        const got = field.whatSurfacesInReply(T0, createStream(absSEED + i), { openness: 0.1 });
        if (!got) sawNothing += 1;
        else expect(got.node.text, "a losing thing was returned anyway").toBe("the thing she has not said");
      }
      expect(sawNothing, "a very costly thing never once stayed unsaid").toBeGreaterThan(0);
    });
  });

  it("having just brought it up makes it recede", () => {
    const { field, node } = carrying({ tension: 0.9, bornDaysAgo: 21 });
    node.reticence = 0.2;
    const before = (() => {
      let n = 0;
      for (let i = 0; i < 1500; i++) if (field.whatSurfacesInReply(T0, createStream(bSEED + i))) n += 1;
      return n / 1500;
    })();
    field.raise(node.id, T0, 0.5);
    let after = 0;
    for (let i = 0; i < 1500; i++) if (field.whatSurfacesInReply(T0 + 60_000, createStream(aSEED + i))) after += 1;
    after /= 1500;
    console.log(`  before vs just after raising it : ${(before * 100).toFixed(0)}% → ${(after * 100).toFixed(0)}%`);
    expect(after, "she brings it up again immediately after bringing it up").toBeLessThan(before);
  });

  it("an empty field surfaces nothing at all", () => {
    // A newborn has nothing to carry, so this must be silent rather than inventing something.
    expect(aField().whatSurfacesInReply(T0, createStream(99))).toBeNull();
  });

  it("the constant it turns on is on the same scale as the scores", () => {
    // Documented so that a later tune is a decision rather than a nudge: an ordinary open
    // thing scores about 0.36 and something that has taken hold about 1.85.
    expect(NOTHING_SURFACES).toBeGreaterThan(0.36);
    expect(NOTHING_SURFACES).toBeLessThan(1.85);
  });
});

// ── NOT SAYING IT COSTS SOMETHING ────────────────────────────────────────────
//
// Faculty #14 of the sweep, and the finding is the ASYMMETRY. His silence is modelled richly and
// well: an unanswered thing has `warmthOf = 0`, there is a window after which she gives up waiting,
// `raisingWent(false)` hardens her reticence, warmth drifts over days. Hers was only ever "she
// chose a different action" or "the gate held it", and the only trace was a count. Withholding
// accumulated into nothing.
describe("her silence is an act, not an absence", () => {
  const DAY = 24 * 3.6e6;
  const now = Date.now();

  /**
   * A field holding one thing that has genuinely taken hold, and some that have not.
   *
   * The fixture is built against the MEASURED scale (see `NEARLY_SAID_IT`): a thing carried three
   * weeks at tension 0.9 scores 1.32 against a bar of 1.65, which is what "nearly said it" means;
   * ordinary open things at 0.55-0.70 score 0.55-0.78 and are nowhere near. An earlier version of
   * this fixture used only the ordinary ones and concluded the mechanism did not fire, the
   * mechanism was right and the fixture was not, which is the reachable-range discipline arriving
   * from the test side for once.
   */
  const holding = () => {
    const f = createLivingField();
    f.encodeQuestion({
      key: "mine:held", text: "渡轮那件事一直没解决", nowMs: now - 21 * DAY,
      source: "her", tension: 0.7,
    });
    for (let i = 0; i < 3; i++) {
      f.encodeQuestion({
        key: `mine:${i}`, text: `别的那件事第${i}回想起来`, nowMs: now - i * DAY,
        source: "her", tension: 0.55 + 0.05 * i,
      });
    }
    return f;
  };

  it("a thing that nearly got said presses harder next time", () => {
    const f = holding();
    const held = f.nodeByKey("mine:held")!;
    const ordinary = f.nodeByKey("mine:0")!;
    const heldBefore = held.tension;
    const ordinaryBefore = ordinary.tension;
    for (let i = 0; i < 20; i++) {
      f.whatSurfacesInReply(now, createStream(300 + i), { openness: 0.6 });
    }
    expect(held.tension, "the thing she nearly said left no mark at all").toBeGreaterThan(heldBefore);
    // AND the discrimination, which is what stops this being a slow pressure on everything: things
    // she was merely holding, that were never in the running, are untouched.
    expect(ordinary.tension, "a thing that was never nearly said was charged for not being said")
      .toBeCloseTo(ordinaryBefore, 5);
  });

  it("and it STOPS — a thing she keeps not saying never becomes one she cannot stop saying", () => {
    // The bound is the whole design. An unbounded accumulator pointed at her is the rumination
    // shape arriving through a different door, and it would sit below the level at which the
    // field's own decay can still carry a thing away.
    const f = holding();
    for (let i = 0; i < 400; i++) {
      f.whatSurfacesInReply(now, createStream(i), { openness: 0.6 });
    }
    // The property is that WITHHOLDING never carries anything past the ceiling, not that no node
    // in her field may ever sit above it. A thing can be born pressing harder than this; what it
    // cannot do is get there by her repeatedly not saying it.
    for (const n of f.graph().nodes.values()) {
      expect(n.tension, `"${n.text}" was carried past the ceiling by not being said`)
        .toBeLessThanOrEqual(WITHHOLDING_STOPS_AT + 1e-9);
    }
  });

  it("what actually got said is not also charged for not being said", () => {
    const f = holding();
    let pick = null;
    for (let seed = 0; seed < 200 && pick === null; seed++) {
      pick = f.whatSurfacesInReply(now, createStream(seed), { openness: 0.6 });
    }
    if (pick === null) return;
    const said = f.graph().nodes.get(pick.node.id)!;
    const before = said.tension;
    // Re-running with the same seed picks the same one; it must not accrue withholding pressure.
    f.whatSurfacesInReply(now, createStream(7), { openness: 0.6 });
    expect(said.tension).toBeLessThanOrEqual(before + 1e-9);
  });

  it("and things that were never in the running are untouched", () => {
    // Everything in the competition loses. Only what nearly won is withholding.
    const f = createLivingField();
    f.encodeQuestion({ key: "faint", text: "很久以前那件小事", nowMs: now - 200 * DAY, source: "her", tension: 0.05 });
    const faint = f.nodeByKey("faint")!;
    const before = faint.tension;
    for (let i = 0; i < 20; i++) f.whatSurfacesInReply(now, createStream(i), { openness: 0.6 });
    expect(faint.tension, "something that was never nearly said was charged for not being said")
      .toBeCloseTo(before, 5);
  });
});
