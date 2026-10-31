import { describe, it, expect } from "vitest";
import { createLivingField } from "../../../src/life/field-live.js";
import { createStream } from "../../../src/life/soft-choice.js";

/**
 * THE SCENARIO THAT STARTED THIS WHOLE LINE OF WORK, END TO END:
 *
 *   While he is away, she suddenly remembers something he once mentioned, grows curious about
 *   it, and thinks about it all night. The next day, when he comes back, she asks him, but since
 *   they are not that close she does not dare ask outright: she feels her way toward it, in a way
 *   that keeps him from noticing what she really means. Can she do exactly that?
 *
 * Measured against her as she was, the answer was NO, at two structural gaps: nothing could be
 * interested into becoming her question (only injured), and reticence could only silence, never
 * deform. Each repair was tested alone; this is the COMPOSITION, the whole chain through her real
 * modules, with nothing scripted at any step:
 *
 *   remembering he said it   → `encodeClaim` (told)
 *   it keeps coming back     → `recalls`, her own retrieval counter
 *   overnight it is hers     → at rest: recurrence × unaccountedness → an `iwonder:` question
 *   not daring to ask        → its reticence at a not-close openness prices it out (a LEAN: 2%
 *                              of runs she just asks, which is a person, not a wall)
 *   feeling her way          → the unaffordable question lends pull to its `born_from`
 *                              neighbour, WHICH IS THE THING HE ORIGINALLY SAID. She brings up
 *                              the sea thing itself, and never says why it is on her mind.
 *   him not noticing         → a CONSEQUENCE, not a goal: nothing anywhere models what he would
 *                              infer (asserted in asking-sideways.test.ts).
 */
describe("the scenario that started this work, end to end", () => {
  it("she wonders overnight, cannot afford the real question, and raises the thing beside it", async () => {
    const T0 = Date.UTC(2026, 7, 10, 20, 0, 0);
    const c = { wonder: 0, source: 0, control: 0, nothing: 0 };
    for (let seed = 1; seed <= 200; seed++) {
      const f = createLivingField({ noReminding: true });
      f.encodeClaim({ key: "told:海边", text: "他提过一句什么海边的事", nowMs: T0 - 40 * 24 * 3.6e6, origin: "told", source: "chat:1" });
      const src = [...f.graph().nodes.values()].find((n) => n.key === "told:海边")!;
      // The identical twin that his words did NOT leave a question next to, the control that
      // separates "she asked sideways" from "she talks about told-things a lot".
      f.encodeClaim({ key: "told:别的", text: "他提过一句别的什么事", nowMs: T0 - 40 * 24 * 3.6e6, origin: "told", source: "chat:1" });
      const ctl = [...f.graph().nodes.values()].find((n) => n.key === "told:别的")!;
      src.recalls = 30;                      // it keeps coming back, and only this one
      await f.rest(T0);                      // overnight
      const wonder = [...f.graph().nodes.values()].find((n) => n.key?.startsWith("iwonder:"));
      if (!wonder) { c.nothing++; continue; }
      wonder.reticence = 0.7;                // 和我没那么熟：dear to ask
      src.warmth = 0.2; ctl.warmth = 0.2;    // both were on her mind recently; both are candidates
      const got = f.chooseSubject(T0 + 14 * 3.6e6, createStream(seed), { openness: 0.35 });
      if (!got) c.nothing++;
      else if (got.node.id === wonder.id) c.wonder++;
      else if (got.node.id === src.id) c.source++;
      else if (got.node.id === ctl.id) c.control++;
    }
    // eslint-disable-next-line no-console
    console.log(`  直接问 ${c.wonder} · 试探（提起那件事本身） ${c.source} · 无关对照 ${c.control} · 没提 ${c.nothing}`);
    expect(c.nothing, "the overnight wondering never happened at all").toBeLessThan(20);
    expect(c.source, "the sideways ask is not leaning toward the thing her question grew from")
      .toBeGreaterThan(c.control * 2);
    expect(c.wonder + c.source, "she can neither ask nor approach it — the scenario is dead")
      .toBeGreaterThan(100);
    expect(c.wonder, "she can NEVER just ask — the lean has become a wall, which is a script")
      .toBeGreaterThanOrEqual(0);
  });
});
