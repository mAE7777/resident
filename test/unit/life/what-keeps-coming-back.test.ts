import { describe, it, expect } from "vitest";
import {
  whatSheHasComeToWonderAbout, howMuchSheWonders, keepsComingBack, unaccountedFor,
  WONDERS_ABOVE, COMING_BACK_COUNTS, BEING_UNACCOUNTED_COUNTS, KEEPS_COMING_BACK_BY,
  EXPLAINED_BY, ASKED_MARK, WONDER_KEY,
} from "../../../src/life/what-keeps-coming-back.js";
import { createLivingField } from "../../../src/life/field-live.js";
import type { FieldGraph, FieldNode } from "../../../src/life/field.js";

/**
 * SHE CAN BE INTERESTED INTO HAVING AN INNER LIFE, NOT ONLY INJURED INTO ONE.
 *
 * Four doors could open a question in her and three were injuries, a guard refused her, an
 * address would not open, he handled or wronged her. The fourth, fusion, needs a COINCIDENCE OF
 * TWO memories. A single thing that kept surfacing night after night with nothing in her field to
 * account for it did nothing whatsoever: it came up, she read it, it went back down.
 *
 * So every lasting thing in her had to be negative. That is not a temperament, it is a missing
 * door, and this is the door.
 */

const T0 = Date.UTC(2026, 7, 17, 3, 0, 0);

/** A bare graph with one node in it, so the two components can be moved independently. */
function graphWith(n: Partial<FieldNode>, degree = 0): { g: FieldGraph; node: FieldNode } {
  const node = {
    id: 1, kind: "memory", text: "他提过一句什么海边的事", bornMs: T0, charge: 0.4, valence: 0,
    strength: 0.6, recalls: 0, lastRecallMs: T0, tension: 0, origin: "told", credence: null,
    reticence: 0.15, ...n,
  } as FieldNode;
  const g = {
    nodes: new Map([[1, node]]), edges: new Map(), byKey: new Map(),
    adj: new Map([[1, new Map(Array.from({ length: degree }, (_, i) => [i + 2, 0.5] as const))]]),
    nextId: 99,
  } as unknown as FieldGraph;
  return { g, node };
}

describe("neither half may carry it alone — criterion 3", () => {
  it("a thing that merely keeps coming back is FAMILIAR, not a question", () => {
    // An old friend's name surfaces constantly and she is not wondering about it.
    const { g, node } = graphWith({ recalls: 50, credence: 0.9 }, EXPLAINED_BY + 4);
    expect(keepsComingBack(node)).toBeGreaterThan(0.85);
    expect(howMuchSheWonders(g, node), "recurrence alone opened a question").toBeLessThanOrEqual(WONDERS_ABOVE);
  });

  it("and a thing that is merely unexplained is TRIVIA", () => {
    // A stray fact off a page she read once. Nothing accounts for it; it is not on her mind.
    const { g, node } = graphWith({ recalls: 0, credence: null }, 0);
    expect(unaccountedFor(g, node)).toBeGreaterThan(0.85);
    expect(howMuchSheWonders(g, node), "being unexplained alone opened a question")
      .toBeLessThanOrEqual(WONDERS_ABOVE);
  });

  it("BOTH AT ONCE is what makes a question", () => {
    const { g, node } = graphWith({ recalls: 20, credence: null }, 1);
    expect(howMuchSheWonders(g, node)).toBeGreaterThan(WONDERS_ABOVE);
    expect(whatSheHasComeToWonderAbout(g, { room: 4 }), "the two together still opened nothing").not.toBeNull();
  });

  it("and the weights are what makes that true", () => {
    expect(COMING_BACK_COUNTS, "recurrence alone can carry it").toBeLessThanOrEqual(WONDERS_ABOVE);
    expect(BEING_UNACCOUNTED_COUNTS, "being unexplained alone can carry it").toBeLessThanOrEqual(WONDERS_ABOVE);
    expect(COMING_BACK_COUNTS + BEING_UNACCOUNTED_COUNTS, "even both together cannot reach the line")
      .toBeGreaterThan(WONDERS_ABOVE);
    expect(KEEPS_COMING_BACK_BY, "recurrence saturates instantly or never").toBeGreaterThan(1);
    expect(EXPLAINED_BY, "one neighbour counts as explained").toBeGreaterThan(1);
  });
});

describe("what she can hold, and what she cannot open twice", () => {
  it("a woman with her hands full does not pick up a fifth thing", () => {
    const { g } = graphWith({ recalls: 40, credence: null }, 0);
    expect(whatSheHasComeToWonderAbout(g, { room: 0 }), "she took on a new question with no room")
      .toBeNull();
  });

  it("ONCE PER THING — a re-openable question is a rumination engine with a nicer name", () => {
    const { g, node } = graphWith({ recalls: 40, credence: null, key: "told:海边" }, 0);
    expect(whatSheHasComeToWonderAbout(g, { room: 4 })).not.toBeNull();
    node.key = `told:海边${ASKED_MARK}`;
    expect(whatSheHasComeToWonderAbout(g, { room: 4 }), "the same thing opened a second question")
      .toBeNull();
  });

  it("a question that keeps coming back is not a NEW question", () => {
    // That is her carrying something, which is a different mechanism and already has one.
    const { g } = graphWith({ recalls: 40, credence: null, kind: "question", tension: 0.7 }, 0);
    expect(whatSheHasComeToWonderAbout(g, { room: 4 })).toBeNull();
  });

  it("and a WHO is not a puzzle", () => {
    const { g } = graphWith({ recalls: 99, credence: null, kind: "figure" }, 0);
    expect(whatSheHasComeToWonderAbout(g, { room: 4 })).toBeNull();
  });
});

describe("what it writes", () => {
  it("her words, and only the fact — no reading of why it interests her", () => {
    const { g } = graphWith({ recalls: 30, credence: null }, 0);
    const w = whatSheHasComeToWonderAbout(g, { room: 4 })!;
    expect(w.text).toContain("他提过一句什么海边的事");
    expect(w.text, "an interpretation is being planted to be read back later as hers")
      .not.toMatch(/我大概是|说明我|因为我|其实我想/u);
    expect(w.key.startsWith(WONDER_KEY)).toBe(true);
  });

  it("wanting to know something presses, and it is not a wound", () => {
    const { g } = graphWith({ recalls: 40, credence: null }, 0);
    const w = whatSheHasComeToWonderAbout(g, { room: 4 })!;
    expect(w.tension).toBeGreaterThan(0.2);
    // `whatStaysWithHer` writes 0.4–0.8 for being wronged, so the two ranges OVERLAP and should:
    // a burning curiosity really can press harder than a mild slight. What must not happen is
    // curiosity reaching where a real injury lives. Asserted as the ceiling, not as separation,
    // the first version demanded they not overlap at all, which is false about people.
    expect(w.tension, "wondering about something can now press as hard as being wronged badly")
      .toBeLessThan(0.7);
  });
});

describe("and it really happens in her rest", () => {
  it("a thing she keeps recalling, with nothing to explain it, becomes a question at rest", async () => {
    const f = createLivingField();
    f.encodeClaim({
      key: "told:海边", text: "他提过一句什么海边的事", nowMs: T0 - 40 * 24 * 3.6e6,
      origin: "told", source: "chat:1",
    });
    // She keeps coming back to it. `recalls` is the field's own counter, bumped on retrieval.
    const node = [...f.graph().nodes.values()].find((n) => n.key === "told:海边")!;
    node.recalls = 30;
    const before = [...f.graph().nodes.values()].filter((n) => n.kind === "question").length;
    await f.rest(T0);
    const after = [...f.graph().nodes.values()].filter((n) => n.kind === "question");
    expect(after.length, "a whole night of rest and she wondered about nothing").toBeGreaterThan(before);
    const born = after.find((n) => n.key?.startsWith(WONDER_KEY))!;
    expect(born, "the question is not the one this mechanism makes").toBeTruthy();
    // Born FROM it: the memory stays itself, she has come to have a question ABOUT it.
    expect(node.kind, "her memory was converted instead of being wondered about").toBe("memory");
    expect(node.key, "the thing was not marked, so it can open a second question tomorrow")
      .toContain(ASKED_MARK);
  });
});
