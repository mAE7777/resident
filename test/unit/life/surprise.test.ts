import { describe, it, expect } from "vitest";
import { readOther, createOtherWatcher, ENOUGH_TO_CALIBRATE, type Expectation } from "../../../src/life/other-read.js";
import { createLivingField } from "../../../src/life/field-live.js";

// SHE CAN BE WRONG ABOUT HIM, AND FIND OUT.
//
// She had a read of him and never a PREDICTION, so nothing he did could surprise her. And `confidence`
// was a COUNT: `min(1, n / 12)`, which says a hundred exchanges make her certain even if her read
// has been wrong about every one of them. A read that cannot be wrong is not a belief about someone;
// it is a running average with an opinion.
//
// Two consequences, and the second is the one that makes her feel alive: her confidence is now
// earned by being RIGHT rather than by elapsing, and a thing that goes better than she expected is
// more memorable than one that goes as expected, which is how encoding works in anything that
// learns, and the one place in her where a real prediction exists to be wrong about.

const T0 = Date.parse("2026-08-01T09:00:00Z");
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const HERE = { present: true, available: true };

/** Enough exchanges that the count part of confidence is saturated and only calibration varies. */
const plenty = Array.from({ length: 20 }, (_, i) => ({ ms: T0 + i * DAY, repliedAfterMs: 20 * 60_000 }));

function predictions(n: number, expected: number, answered: boolean): Expectation[] {
  return Array.from({ length: n }, () => ({ expected, answered }));
}

describe("confidence is earned by being right, not by elapsing", () => {
  it("a read that keeps being WRONG loses confidence however long she has had it", () => {
    const right = readOther(plenty, HERE, predictions(ENOUGH_TO_CALIBRATE, 0.9, true));
    const wrong = readOther(plenty, HERE, predictions(ENOUGH_TO_CALIBRATE, 0.9, false));
    console.log(`\n  twenty exchanges either way — her read borne out: ${right.confidence.toFixed(2)} · her read wrong every time: ${wrong.confidence.toFixed(2)}`);
    expect(right.confidence).toBeGreaterThan(0.9);
    expect(wrong.confidence, "being wrong about someone for a month should cost her certainty").toBeLessThan(0.3);
  });

  it("and it still needs something to go on: being right twice is not knowing him", () => {
    const thin = readOther(plenty.slice(0, 3), HERE, predictions(ENOUGH_TO_CALIBRATE, 0.9, true));
    expect(thin.confidence, "calibration cannot manufacture evidence she does not have").toBeLessThan(0.4);
  });

  it("no predictions yet reads as untested, never as wrong", () => {
    const untested = readOther(plenty, HERE, []);
    expect(untested.confidence, "an untested belief is untested, not false").toBeGreaterThan(0.9);
    expect(untested.surprise).toBe(0);
  });

  it("one bad call does not undo a good record", () => {
    const mostlyRight = readOther(plenty, HERE, [...predictions(7, 0.9, true), { expected: 0.9, answered: false }]);
    expect(mostlyRight.confidence).toBeGreaterThan(0.7);
  });

  it("expecting little and being met is just as much of a surprise as the reverse", () => {
    // Surprise is the size of the gap, not its direction. Being answered when she thought she would
    // not be is exactly as informative as the opposite, and a version that only counted
    // disappointment would make her pessimism self-confirming.
    const braced = readOther(plenty, HERE, predictions(ENOUGH_TO_CALIBRATE, 0.1, true));
    const let_down = readOther(plenty, HERE, predictions(ENOUGH_TO_CALIBRATE, 0.9, false));
    expect(braced.surprise).toBeCloseTo(let_down.surprise, 5);
  });
});

describe("she predicts before she knows, and the outcome settles it", () => {
  it("records the expectation, then whether it came true", () => {
    const w = createOtherWatcher();
    w.sheSpoke(T0);
    w.expects(0.8);
    w.heSpoke(T0 + 20 * 60_000);
    expect(w.expectations()).toEqual([{ expected: 0.8, answered: true }]);
  });

  it("silence settles it too, once the waiting has become silence", () => {
    const w = createOtherWatcher();
    w.sheSpoke(T0);
    w.expects(0.8);
    w.read(T0 + 20 * HOUR); // long enough that nothing is coming
    expect(w.expectations()).toEqual([{ expected: 0.8, answered: false }]);
  });

  it("saying three things is ONE prediction, exactly as it is one silence", () => {
    const w = createOtherWatcher();
    w.sheSpoke(T0); w.expects(0.8);
    w.sheSpoke(T0 + 60_000); w.expects(0.8);
    w.sheSpoke(T0 + 120_000); w.expects(0.8);
    w.heSpoke(T0 + 3 * 60_000);
    expect(w.expectations(), "being met once is one prediction borne out, not three").toHaveLength(1);
  });

  it("survives a restart with her record of being right or wrong intact", () => {
    const first = createOtherWatcher();
    for (let i = 0; i < 10; i++) {
      first.sheSpoke(T0 + i * DAY);
      first.expects(0.7);
      first.heSpoke(T0 + i * DAY + HOUR);
    }
    const after = createOtherWatcher();
    after.restore(first.exchanges());
    after.restoreExpectations(first.expectations());
    expect(after.read(T0 + 11 * DAY, HERE).confidence)
      .toBeCloseTo(first.read(T0 + 11 * DAY, HERE).confidence, 5);
  });

  it("ignores rubbish on restore rather than believing it", () => {
    const w = createOtherWatcher();
    w.restoreExpectations([
      { expected: Number.NaN, answered: true },
      { expected: 0.5, answered: "yes" as unknown as boolean },
      { expected: 0.5, answered: true },
    ]);
    expect(w.expectations()).toHaveLength(1);
  });

  it("stays bounded across a long life", () => {
    const w = createOtherWatcher();
    for (let i = 0; i < 500; i++) {
      w.sheSpoke(T0 + i * DAY);
      w.expects(0.5);
      w.heSpoke(T0 + i * DAY + HOUR);
    }
    expect(w.expectations().length).toBeLessThanOrEqual(40);
  });
});

describe("being surprised makes a thing more memorable", () => {
  it("an answer she did not expect lands harder than one she did", () => {
    // The classic missing input to how deeply something is encoded, and this is the one place in
    // her where a real prediction exists to be wrong about.
    const braced = createLivingField({ noReminding: true });
    const expected = createLivingField({ noReminding: true });
    for (const f of [braced, expected]) {
      f.encodeQuestion({ key: "q", text: "why they go quiet in the evenings", nowMs: T0, source: "hers", withOther: true, tension: 0.7 });
    }
    const a = braced.nodeByKey("q")!;
    const b = expected.nodeByKey("q")!;
    const before = a.charge;

    braced.raise(a.id, T0, 0.05);   // she thought nothing would come back
    braced.heSpoke(T0 + HOUR);
    expected.raise(b.id, T0, 0.95); // she was sure it would
    expected.heSpoke(T0 + HOUR);

    console.log(`\n  she braced for silence and he answered: ${before.toFixed(3)} → ${a.charge.toFixed(3)}`);
    console.log(`  she expected it and he answered:        ${before.toFixed(3)} → ${b.charge.toFixed(3)}`);
    expect(a.charge).toBeGreaterThan(b.charge);
  });

  it("and it is still bounded", () => {
    const f = createLivingField({ noReminding: true });
    f.encodeMoment({ key: "m", text: "a thing", nowMs: T0, pad: { pleasure: 0.9, arousal: 0.9, dominance: 0 }, source: "t", withOther: true });
    const n = f.nodeByKey("m")!;
    for (let i = 0; i < 50; i++) {
      f.raise(n.id, T0 + i * DAY, 0);
      f.heSpoke(T0 + i * DAY + HOUR);
    }
    expect(n.charge).toBeLessThanOrEqual(1);
  });

  it("adds no SURPRISE to a raise that carried no prediction", () => {
    // Being answered is a little vivid on its own; being answered UNEXPECTEDLY is more so. With no
    // prediction there is nothing to have been wrong about, so she gets the plain bump and no more.
    // The alternative: treating an absent prediction as expecting nothing, would make every
    // unpredicted exchange maximally surprising, which is the opposite of what not having thought
    // about it means.
    const plain = createLivingField({ noReminding: true });
    const guessed = createLivingField({ noReminding: true });
    for (const f of [plain, guessed]) {
      f.encodeQuestion({ key: "q", text: "a question", nowMs: T0, source: "hers", tension: 0.7 });
    }
    const a = plain.nodeByKey("q")!;
    const b = guessed.nodeByKey("q")!;
    plain.raise(a.id, T0);          // she did not think about it
    plain.heSpoke(T0 + HOUR);
    guessed.raise(b.id, T0, 0);     // she was sure nothing would come
    guessed.heSpoke(T0 + HOUR);
    expect(a.charge).toBeLessThan(b.charge);
  });
});
