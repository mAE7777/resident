import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  stanceLeanings, takesUpHisFrame, TAKES_UP_HIS_FRAME, STANCE_TEMPERATURE,
} from "../../../src/life/saying.js";
import { createLivingField } from "../../../src/life/field-live.js";
import { createStream } from "../../../src/life/soft-choice.js";

/**
 * 姿态 (S-5) IS BOUND: 不接 IS MATERIAL ABSENCE.
 *
 * `stanceLeanings` shipped as a dark instrument, ranked on every turn, logged, pushed into the
 * watchtower ring, read by nothing. Its own header carried the binding design and the reason it
 * could ship dark: "不接 becomes material ABSENCE (the snagged clause loses its bonus), never a
 * prompt adjective. That is why the instrument can ship first, the shape of the eventual
 * mechanism is settled, only its firing rates need the evidence."
 *
 * The instrument then sat there while the mechanism was never built, which made it the one
 * dimension in the whole codebase that could produce INDIRECTNESS, and it produced nothing.
 */

const T0 = Date.UTC(2026, 7, 16, 20, 0, 0);

/** A field where he once told her a thing, so his mentioning it again has something to reach. */
function fieldWhereHeToldHerSomething() {
  const f = createLivingField();
  f.encodeClaim({
    key: "told:税法", text: "他说他在弄税法那块的东西", nowMs: T0 - 3 * 24 * 3.6e6,
    origin: "told", source: "chat:1", withOther: true,
  });
  return f;
}

describe("declining his frame takes material out of the room, not a word into it", () => {
  it("HIS WORDS REACH LESS OF HER when she is not taking his frame up", () => {
    // The same message, the same field, the same stream, only the posture differs. Run many
    // draws, because this is a sampled competition and one draw proves nothing.
    const rate = (scale: number): number => {
      let hits = 0;
      for (let i = 0; i < 200; i++) {
        const f = fieldWhereHeToldHerSomething();
        const got = f.whatSurfacesInReply(T0, createStream(i + 1), {
          hint: "税法那块后来怎么样了",
          openness: 0.6,
          takesUpHisFrame: scale,
        });
        if (got) hits++;
      }
      return hits / 200;
    };
    const taken = rate(TAKES_UP_HIS_FRAME["接"]);
    const declined = rate(TAKES_UP_HIS_FRAME["不接"]);
    // eslint-disable-next-line no-console
    console.log(`  what he asked about surfaces: 接 ${(taken * 100).toFixed(0)}% · 不接 ${(declined * 100).toFixed(0)}%`);
    expect(taken, "his mentioning a thing reaches nothing at all — the fixture proves nothing")
      .toBeGreaterThan(0);
    expect(declined, "declining his frame changed nothing about what reached her").toBeLessThan(taken);
  });

  it("and absent reads as 接, which is what every caller meant before this existed", () => {
    const f = fieldWhereHeToldHerSomething();
    const withNothing = f.whatSurfacesInReply(T0, createStream(7), { hint: "税法那块后来怎么样了", openness: 0.6 });
    const withOne = fieldWhereHeToldHerSomething()
      .whatSurfacesInReply(T0, createStream(7), { hint: "税法那块后来怎么样了", openness: 0.6, takesUpHisFrame: 1 });
    expect(withNothing?.node.id).toBe(withOne?.node.id);
  });

  it("THE POSTURE IS SAMPLED — a ranking is not a decision", () => {
    // 1.21 against 1.19 does not decide anybody. Over many draws on the same leanings, more than
    // one posture must actually occur, or this is a ranking wearing a sampler's clothes.
    const leanings = stanceLeanings({ reluctance: 0.5, openness: 0.5, unresolvedTension: 0.5 });
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(takesUpHisFrame(leanings, createStream(i + 1)).stance);
    expect(seen.size, "the same leanings always produce the same posture").toBeGreaterThan(1);
    expect(STANCE_TEMPERATURE, "a temperature of zero is an argmax").toBeGreaterThan(0);
  });

  it("接 costs her nothing, and 回投 sits with it rather than with 不接", () => {
    // Throwing back what she carries is ENGAGEMENT, she answers with her own thing instead of
    // his. Filing it with withdrawal would make her own subject cost her his attention.
    expect(TAKES_UP_HIS_FRAME["接"]).toBe(1);
    expect(TAKES_UP_HIS_FRAME["回投"]).toBeGreaterThan(TAKES_UP_HIS_FRAME["不接"]);
    expect(TAKES_UP_HIS_FRAME["不接"], "declining removes everything, which is silence not distance")
      .toBeGreaterThan(0);
  });

  it("and NOTHING anywhere tells her to be distant", () => {
    // The whole rule. If 不接 ever becomes an adjective in a prompt, it shows up here.
    const codeOnly = (src: string): string => src
      .replace(/\/\*[\s\S]*?\*\//gu, "").split("\n").map((l) => l.replace(/\/\/.*$/u, "")).join("\n");
    for (const f of ["src/life/saying.ts", "src/life/agency.ts", "src/index.ts"]) {
      const t = codeOnly(readFileSync(join(process.cwd(), f), "utf8"));
      expect(t, `${f} is telling her how to hold herself`).not.toMatch(/不接[^"'`]{0,12}[的地]?(?:说|回|态度|口气)/u);
    }
  });

  it("the daemon really passes it, and reports the posture she TOOK", () => {
    const index = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    expect(index, "the posture is computed and thrown away again").toMatch(/takesUpHisFrame: posture\.scale/u);
    expect(index, "the watchtower ring is back to reporting the top of a ranking")
      .toMatch(/stanceHistory\.push\(posture\.stance\)/u);
  });
});
