// Every call that reasons must have room to answer after it has finished reasoning.
//
// ── THE INCIDENT ────────────────────────────────────────────────────────────────
//
// Three of her organs asked this model to reason and then handed it a few hundred tokens to do
// everything in. Measured against her real records, this model's reasoning alone runs 2200-5600
// tokens, so all three stopped at `max_tokens` with the reasoning unfinished and NO TEXT AT ALL
// produced:
//
//   · her weekly looking-back (900), the call came back empty or with the JSON cut mid-array,
//     which is why three weeks of insights sat at zero confirmations. At 6000 the identical call
//     completed and returned twelve proposals, five correctly pointing at the sentence of hers
//     they were repeating.
//   · the nightly promise scan (500), 3000 tokens spent, zero text, every night since it was
//     built. At 8000 it immediately found a real promise: she would find him a picture one day
//     if he wanted to see one.
//   · the autobiography lint (900), carrying a comment that asserted the budget was "enough for
//     a reasoning model to think AND emit the JSON verdict", which was an assumption, not a
//     measurement, and was false.
//
// What makes this class dangerous is not the failure, it is the SHAPE of the failure: a starved
// reasoning call returns empty, and empty is indistinguishable from "there was nothing to find".
// No fault, no red, nothing to notice. The same silent-third-state this project hunts everywhere.
//
// A cap is not a charge, only what the model actually produces is paid for, so there is no
// reason for any of these to be tight.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");

/** Measured floor: this model's reasoning alone ran 2236, 3000, and 5655 tokens on real material. */
export const REASONING_FLOOR = 4000;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const child = join(dir, name);
    if (statSync(child).isDirectory()) out.push(...walk(child));
    else if (child.endsWith(".ts")) out.push(child);
  }
  return out;
}

export interface Starved { file: string; line: number; budget: string }

/**
 * Every `thinking: { type: "enabled" }` whose call also pins a literal `maxTokens` below the
 * floor. A budget that is a variable (the agent loop's `requestMaxTokens`) is not judged here,
 * it is decided elsewhere and cannot be read off the text.
 */
export function starvedReasoners(files: readonly { path: string; text: string }[]): Starved[] {
  const out: Starved[] = [];
  for (const { path, text } of files) {
    for (const m of text.matchAll(/thinking:\s*\{\s*type:\s*"enabled"\s*\}/gu)) {
      // The call's own head: maxTokens is written above `thinking` in every site in this tree.
      const window = text.slice(Math.max(0, m.index - 700), m.index);
      const budgets = [...window.matchAll(/maxTokens:\s*([^,\n]+)/gu)];
      const last = budgets[budgets.length - 1];
      if (!last) continue;
      const raw = last[1]!.trim();
      // `cfg.maxTokens ?? 8000`, the fallback is the one this file can see and judge.
      const literal = /(\d{2,})\s*$/u.exec(raw);
      if (!literal) continue;
      if (Number(literal[1]) < REASONING_FLOOR) {
        out.push({ file: path, line: text.slice(0, m.index).split("\n").length, budget: raw });
      }
    }
  }
  return out;
}

describe("a call that reasons has room left to answer", () => {
  const files = walk(SRC).map((path) => ({ path: path.slice(SRC.length + 1), text: readFileSync(path, "utf8") }));

  it("finds the reasoning calls at all — an empty roster would pass the check below", () => {
    const reasoners = files.filter((f) => /thinking:\s*\{\s*type:\s*"enabled"\s*\}/u.test(f.text));
    expect(reasoners.length, "no reasoning calls found; the scanner has drifted").toBeGreaterThanOrEqual(3);
  });

  it("PLANTED: the scan catches a starved call and leaves a fed one alone", () => {
    const starved = [{ path: "x.ts", text: 'complete({\n  maxTokens: 500,\n  thinking: { type: "enabled" },\n})' }];
    expect(starvedReasoners(starved)).toHaveLength(1);
    expect(starvedReasoners(starved)[0]!.budget).toBe("500");

    const fed = [{ path: "y.ts", text: 'complete({\n  maxTokens: 8000,\n  thinking: { type: "enabled" },\n})' }];
    expect(starvedReasoners(fed)).toEqual([]);

    // The `?? N` form must be judged on its fallback, which is what actually runs.
    const fallback = [{ path: "z.ts", text: 'complete({\n  maxTokens: cfg.maxTokens ?? 900,\n  thinking: { type: "enabled" },\n})' }];
    expect(starvedReasoners(fallback)).toHaveLength(1);

    // A call that does NOT reason is none of this test's business, however small its budget.
    const quick = [{ path: "w.ts", text: 'complete({\n  maxTokens: 30,\n  thinking: { type: "disabled" },\n})' }];
    expect(starvedReasoners(quick)).toEqual([]);
  });

  it("no organ of hers reasons on a budget that cannot hold the answer", () => {
    const starved = starvedReasoners(files);
    expect(
      starved.map((s) => `${s.file}:${s.line} (maxTokens ${s.budget})`),
      "a reasoning call cannot finish and answer inside this budget. It will stop at `max_tokens` "
      + "with NO text — and empty is indistinguishable from 'there was nothing to find', so it "
      + "fails silently forever. A cap is not a charge; raise it.",
    ).toEqual([]);
  });
});
