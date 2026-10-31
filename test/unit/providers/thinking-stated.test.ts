import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * EVERY MODEL CALL STATES ITS THINKING, NONE INHERITS THE VENDOR DEFAULT.
 *
 * The provider's own doctrine ("we now always state it explicitly rather than inheriting a
 * vendor default") only ever held for requests that SET the field; a request that omitted it
 * inherited the vendor default after all, which for this vendor is reasoning ON. Every
 * small-budget call in the tree was therefore one bad day from burning its whole budget on
 * reasoning and returning empty, and that day came: the shadow arm (400 tokens,
 * field omitted) returned three empty completions in a row and froze every ownership number,
 * the integrity checker's 16-token call was structurally empty from birth, and her first diary
 * had already been lost to the same shape the night before.
 *
 * The rule this pins: a `provider.complete({...})` with an INLINE request object carries an
 * explicit `thinking:` field. A passthrough that spreads an existing request (`{ ...req }`)
 * forwards the caller's choice and is exempt.
 */

const ROOT = join(process.cwd(), "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** The scanner itself, over one file's lines, extracted so its own proof can drive it. */
export function offendersIn(lines: readonly string[]): number[] {
  const hits: number[] = [];
  lines.forEach((line, i) => {
    if (!/\.complete\(\{/u.test(line) || line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) return;
    const window = lines.slice(i, i + 16).join("\n");
    const stated = /thinking:/u.test(window);
    const passthrough = /\.\.\.\s*(req|request)\b/u.test(window);
    if (!stated && !passthrough) hits.push(i + 1);
  });
  return hits;
}

describe("no model call inherits the vendor's thinking default", () => {
  it("every inline provider.complete request in the tree states thinking", () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      for (const n of offendersIn(readFileSync(file, "utf8").split("\n"))) {
        offenders.push(`${file.slice(ROOT.length + 1)}:${n}`);
      }
    }
    expect(offenders, "these calls inherit the vendor's reasoning default — state thinking explicitly")
      .toEqual([]);
  });

  it("planted violation: the scanner still sees an omitting call, and stays quiet on the healthy shapes", () => {
    // The disease: an inline request with no thinking field, the exact shape that starved
    // the shadow arm.
    const omitting = [
      "const r = await provider.complete({",
      "  model,",
      "  messages,",
      "  maxTokens: 400,",
      "});",
    ];
    expect(offendersIn(omitting)).toEqual([1]);
    // Healthy twin one: the field is stated.
    const stated = [...omitting.slice(0, 4), '  thinking: { type: "disabled" },', "});"];
    expect(offendersIn(stated)).toEqual([]);
    // Healthy twin two: a passthrough spread forwards the caller's choice.
    const passthrough = ["const r = await provider.complete({ ...req, account: \"x\" });"];
    expect(offendersIn(passthrough)).toEqual([]);
    // Healthy twin three: a commented-out call is prose, not machinery.
    expect(offendersIn(["// provider.complete({ model })"])).toEqual([]);
  });
});
