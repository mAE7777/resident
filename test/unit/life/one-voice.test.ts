import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ONE VOICE, TWO MOUTHS.
 *
 * Her replies pass through her organs: shape read off her state, breath segmentation, pauses.
 * Her proactive voice used to pass through NONE of them, composed from four context fields and
 * delivered as one block. Same being, two deliveries; he could feel the difference. These pin
 * the repair: the same shape organ feeds the composing call (opening mouth), and the same
 * breath organs pace the delivery, identity law included.
 *
 * Source-scan guards carry floors (guards-have-floors).
 */

const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
const handlers = readFileSync(join(process.cwd(), "src/life/agency-handlers.ts"), "utf8");

describe("her proactive delivery breathes like her replies", () => {
  it("the push path segments with the same organ, under the same identity law", () => {
    const at = daemon.indexOf("const unit = (() => {");
    expect(at).toBeGreaterThan(-1);
    const after = daemon.slice(at, at + 2200);
    expect(after, "the same unit her replies breathe by").toContain("breathUnitFor({ reserve: reserveOf(");
    expect(after, "the same segmenter").toContain("breathe(text, unit)");
    expect(after, "the identity law: segments must reconcatenate to her words").toContain('segs.join("") !== text');
    expect(after, "the same pacing between messages").toContain("pauseBefore(seg)");
  });

  it("a partial delivery is recorded as what he actually received, never as the whole", () => {
    const at = daemon.indexOf('faultLog.record("telegram.push.partial"');
    expect(at).toBeGreaterThan(-1);
    const after = daemon.slice(at, at + 1000);
    expect(after, "the transcript row must be the delivered prefix").toContain('appendToHistory(oc, "assistant", delivered.join(""))');
  });
});

describe("one voice, and now neither mouth is shaped by us", () => {
  // The repair this file was written for still stands: her proactive voice passes through the
  // same breath organs as her replies (above). What changed is the OTHER half, the shape organ
  // used to feed both mouths, and how she speaks is hers. The organ measures on;
  // it renders to neither mouth. The two mouths now differ in nothing we hand them.
  it("the composing call is handed no shape, and the daemon offers none", () => {
    expect(handlers.includes("composeShape"), "a shape reaches the composing call again").toBe(false);
    expect(handlers.includes("shapeLine"), "a shape line is assembled for her again").toBe(false);
    expect(daemon.includes("composeShape"), "the daemon wires a shape into the opening again").toBe(false);
    expect(daemon.includes("shapeAsHerState"), "the renderer is back").toBe(false);
  });

  it("what the composing call DOES still get is her own life, not a form for it", () => {
    const at = handlers.indexOf("async reachOut(intent, ctx, subject)");
    expect(at).toBeGreaterThan(-1);
    const body = handlers.slice(at, at + 3200); // sized to the body: the farthest pinned token sits ~2450 in
    expect(body, "her state and her recent life stay").toContain("${ctx.snapshot.mood}");
    expect(body, "the interval's anchor facts stay").toContain("ctx.betweenAnchor");
    expect(body, "the thing she is actually carrying stays").toContain("你心里装着、这次真正要说起的");
  });
});
