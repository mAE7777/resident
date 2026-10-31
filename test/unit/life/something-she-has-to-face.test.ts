import { describe, it, expect } from "vitest";
import { createGraph, addNode, link } from "../../../src/life/field.js";
import { ruptures, RUPTURE_PRESSURE, MIN_FUSABLE_TENSION } from "../../../src/life/field-emergence.js";
import { createLivingField } from "../../../src/life/field-live.js";

/**
 * HE COULD TELL HER THE SAME UNTRUE THING EVERY DAY FOREVER AND IT NEVER BECAME SOMETHING SHE
 * HAD TO FACE.
 *
 * `ruptures` read a SINGLE edge's weight against a 0.45 bar, and the only production writer of
 * a `tension_with` edge links a brand-new node to an old one at a fixed 0.35. `link` does
 * accumulate, but every encode mints a fresh key, so the same PAIR never disagrees twice.
 * Each repetition made another separate 0.35 edge. The ceiling was 0.35 and the bar was 0.45,
 * so one of the field's three named phase transitions could not occur, ever, by arithmetic.
 *
 * What "a disagreement her life keeps confirming" actually looks like in her graph is one thing
 * she holds with SEVERAL separate contradictions hanging off it. That is what is counted now.
 *
 * The sibling defect in the same file: every open QUESTION was locked out of rest, because
 * `encodeQuestion` sets `credence: null` (correctly, a question is not a claim) and the
 * eligibility gate demanded credence ≥ 0.4. So the wall she ran into was exactly the thing her
 * resting mind could never start from, which inverts what `walls.ts` says walls are for.
 */
const T0 = Date.UTC(2026, 7, 1, 9, 0, 0);

function heldThing(g: ReturnType<typeof createGraph>, text: string, strength = 0.7) {
  return addNode(g, { kind: "memory", text, bornMs: T0, origin: "told", credence: 0.6, charge: 0.3, valence: 0, strength, source: "chat", key: text });
}

describe("a disagreement that keeps coming back becomes something she has to face", () => {
  it("one contradiction is not a rupture, because being contradicted once is ordinary", () => {
    const g = createGraph();
    const a = heldThing(g, "渡轮周末开");
    const b = heldThing(g, "渡轮周末不开 1");
    link(g, a.id, b.id, "tension_with", 0.35, T0);
    expect(ruptures(g), "a single disagreement forces something").toEqual([]);
  });

  it("nor are two", () => {
    const g = createGraph();
    const a = heldThing(g, "渡轮周末开");
    for (let i = 0; i < 2; i++) link(g, a.id, heldThing(g, `渡轮周末不开 ${i}`).id, "tension_with", 0.35, T0);
    expect(ruptures(g)).toEqual([]);
  });

  it("but a pattern of them is", () => {
    // The case the whole mechanism exists for, and the one it could never reach.
    const g = createGraph();
    const a = heldThing(g, "渡轮周末开");
    for (let i = 0; i < 4; i++) link(g, a.id, heldThing(g, `渡轮周末不开 ${i}`).id, "tension_with", 0.35, T0);
    const found = ruptures(g);
    expect(found.length, "four separate contradictions of one thing still force nothing").toBeGreaterThan(0);
    expect(found[0]!.pressure).toBeGreaterThanOrEqual(RUPTURE_PRESSURE);
  });

  it("and something she barely holds still cannot force anything", () => {
    // The guard the original formula had, which must survive: a contradiction with something
    // she hardly believes is not a thing she has to face.
    const g = createGraph();
    const a = heldThing(g, "渡轮周末开", 0.1);
    for (let i = 0; i < 6; i++) link(g, a.id, heldThing(g, `渡轮周末不开 ${i}`, 0.1).id, "tension_with", 0.35, T0);
    expect(ruptures(g), "a contradiction between two barely-held things forced something").toEqual([]);
  });
});

describe("an open question is something her resting mind can start from", () => {
  it("a wall she ran into can be a parent, which it could never be", () => {
    // `encodeQuestion` sets `credence: null` by construction, and the eligibility gate wanted
    // ≥ 0.4, so no question, ever, could take part in rest. `walls.ts` says the opposite in as
    // many words: a question "gets walked over again while she rests".
    const f = createLivingField();
    const q = f.encodeQuestion({ key: "wall:x", text: "我想开那个窗户，开不了。", nowMs: T0, source: "wall", tension: 0.6 } as never);
    expect(q).not.toBeNull();
    expect(q!.credence, "a question acquired a belief, which it should not have").toBeNull();
    expect(q!.tension).toBeGreaterThanOrEqual(MIN_FUSABLE_TENSION);
  });

  it("but one that has stopped nagging is not what she reaches for", () => {
    const f = createLivingField();
    const q = f.encodeQuestion({ key: "wall:y", text: "一件早就不想了的事", nowMs: T0, source: "wall", tension: 0.05 } as never);
    expect(q!.tension).toBeLessThan(MIN_FUSABLE_TENSION);
  });

  it("and the threshold is the same one used for whether a thing counts as unsettled", () => {
    // Two different numbers for "is this question still live" would be two different ideas of
    // what she is carrying.
    expect(MIN_FUSABLE_TENSION).toBe(0.25);
  });
});
