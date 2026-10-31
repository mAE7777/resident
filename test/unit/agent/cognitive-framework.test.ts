import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { NOVELTY_FALLBACK, getNoveltyFallback } from "../../../src/agent/cognitive-framework.js";

/**
 * This file used to hold forty tests over a thinking manual (BASE_DIRECTIVES, nine postures,
 * a per-task classifier). The manual is GONE, by the embryo principle: a seed-person does
 * not arrive with a mental operations manual, and innate methodology was itself the born-with-
 * vast-context tell. What these tests now guard is that it STAYS gone from her prompt path,
 * and that the one surviving rescue mechanism keeps its narrow shape.
 */
describe("the thinking manual stays deleted", () => {
  const framework = readFileSync(new URL("../../../src/agent/cognitive-framework.ts", import.meta.url), "utf8");
  const index = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8");

  it("exports no methodology and no postures", () => {
    for (const gone of ["BASE_DIRECTIVES", "POSTURE_MAP", "getCognitivePosture", "buildCognitivePrompt", "WHEN_SHE_CAN_GO_AND_LOOK"]) {
      expect(framework, `${gone} came back`).not.toContain(`export const ${gone}`);
      expect(framework, `${gone} came back`).not.toContain(`export function ${gone}`);
    }
  });

  it("her prompt assembly no longer reaches for one", () => {
    expect(index).not.toContain("buildCognitivePrompt");
    expect(index).not.toContain("cognitivePrompt");
  });
});

describe("the stuck rescue that remains", () => {
  it("exists, is reachable, and is injected only on failure states", () => {
    expect(getNoveltyFallback()).toBe(NOVELTY_FALLBACK);
    const loop = readFileSync(new URL("../../../src/agent/loop.ts", import.meta.url), "utf8");
    expect(loop, "the fallback lost its wiring").toContain("getNoveltyFallback");
  });

  it("is a rescue, not a standing identity: never in the system prompt path", () => {
    const context = readFileSync(new URL("../../../src/agent/context.ts", import.meta.url), "utf8");
    expect(context).not.toContain("NOVELTY_FALLBACK");
    expect(context).not.toContain("getNoveltyFallback");
  });
});
