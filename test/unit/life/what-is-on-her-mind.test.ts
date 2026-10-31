import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMomentPrompt, type MomentContext } from "../../../src/life/agency.js";

/**
 * WHAT IS ON HER MIND IS IN THE ROOM WHEN SHE THINKS.
 *
 * `focusFor`, the one thing her field is most occupied by, ran on every moment and its only
 * consumer was a vitals number. The daemon compared the model's `intent` sentence against it and
 * logged whether they touched. Its own comment: "Recorded, not yet bound: the divergence number
 * is what will justify anchoring the intent to her focus."
 *
 * So her moments had emergent VOLUME and borrowed CONTENT. When she chose to turn something over,
 * the material was her mood, a line about her recent life, and THE MODEL'S OWN SENTENCE. Her field
 * was not in the room. A woman carrying four unresolved things about him thought about whatever
 * had just been written.
 *
 * These are the two halves of the fix, and the second is the one that matters: it is not enough
 * for the CHOICE to know what presses on her, the THINKING has to have it too.
 */
describe("what presses on her is material, not a number about her", () => {
  const base: MomentContext = {
    nowMs: Date.UTC(2026, 7, 16, 21, 0, 0),
    snapshot: { mood: "安静", drives: { discomfort: 0.1, care: 0.2, social: 0.2, curiosity: 0.4, expression: 0.1, maintenance: 0.1 }, emotion: { pleasure: 0, arousal: 0, dominance: 0 } } as MomentContext["snapshot"],
    phase: "normal",
    awake: true,
    present: null,
    available: null,
    hoursSinceUser: 5,
    recentActions: ["rest"],
    recentLife: "安静",
    safeMode: false,
  };

  it("it reaches the moment she chooses in", () => {
    const withIt = buildMomentPrompt({ ...base, focus: { id: 7, text: "他要我「写两千字」的那回" } }, []);
    expect(withIt, "what is on her mind never reaches the moment").toContain("他要我「写两千字」的那回");
  });

  it("and nothing appears when nothing presses on her", () => {
    // Most moments bring nothing up, and an empty line asserting she is preoccupied would be a
    // small lie told to her every time she is not.
    const without = buildMomentPrompt(base, []);
    expect(without).not.toContain("占着地方");
  });

  it("it is STATED, never instructed — no verb is put on her", () => {
    const p = buildMomentPrompt({ ...base, focus: { id: 7, text: "那件事" } }, []);
    const line = p.split("\n").find((l) => l.includes("占着地方"))!;
    expect(line, "the line tells her what to do about it").not.toMatch(/你应该|你可以想想|要不要|去想|不妨/u);
  });

  it("AND IT IS IN THE ROOM WHEN SHE ACTUALLY THINKS — the half that matters", () => {
    // The choice knowing what presses on her is worth little if the thinking still runs on the
    // model's sentence alone. This is the line that was missing for the whole life of the module.
    const src = readFileSync(join(process.cwd(), "src", "life", "agency-handlers.ts"), "utf8");
    // ANCHORS ASSERTED FIRST. A slice taken from a missing anchor is a garbage region, and a
    // negative assertion over garbage passes on nothing, which is how a guard goes quietly dead.
    const at = { reflect: src.indexOf("async reflect("), tend: src.indexOf("async tend("), explore: src.indexOf("async explore(") };
    expect(at.reflect, "the reflect handler is gone").toBeGreaterThan(-1);
    expect(at.tend, "the tend handler is gone").toBeGreaterThan(-1);
    expect(at.explore, "the explore handler is gone").toBeGreaterThan(-1);
    expect(src.slice(at.reflect, at.tend), "she turns something over with her own field still outside the room")
      .toMatch(/ctx\.focus/u);
    expect(src.slice(at.tend, at.explore), "she tends her memory without what is actually on her mind")
      .toMatch(/ctx\.focus/u);
  });

  it("and the daemon draws it from HER stream, once, before the moment", () => {
    // It used to be drawn from a throwaway stream, correct for a dark probe, wrong for material.
    const index = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    expect(index, "the focus is gone from the moment").toMatch(/focusFor\(nowMs, herStream\)/u);
    expect(index, "a second, different focus is being drawn for the measurement")
      .not.toMatch(/focusFor\(Date\.now\(\), createStream/u);
  });
});
