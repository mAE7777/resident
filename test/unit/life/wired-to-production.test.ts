import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * THE WIRING PROOF: a test is not a call site.
 *
 * ── THE FAILURE THIS EXISTS FOR, WHICH ALREADY HAPPENED ──────────────────────────────────────
 *
 * The disk guard had three functions, a full test suite, and NOT ONE CALLER anywhere in the
 * daemon. Everything was green for months while her disk filling up would have gone unnoticed and
 * unreported. `purgeTrash` was the same: it carried its own comment saying "call from the disk
 * monitor" and nothing ever did, so the delete tool's promise to her, restorable for 24 hours,
 * was false in both directions at once.
 *
 * `no-dead-parts.test.ts` cannot see this class, and deliberately so: it asks whether an export is
 * referenced ANYWHERE, and a test file counts. That is the right question for "is this a decoy".
 * It is the wrong question for "does her life ever execute this".
 *
 * So this asks the narrower one: an exported FUNCTION that no other source file calls, that its
 * own file never calls, and that a test or a probe DOES call, is a function only the tests run.
 *
 * ── WHY A LIST AND A RATCHET RATHER THAN ZERO ────────────────────────────────────────────────
 *
 * Measured under this file's own stripper: 58. Most are legitimate, a test-only faux provider, a cache
 * reset that exists for tests, a staged subsystem, a probe helper. Demanding zero would force
 * either a wave of deletions nobody has thought through or a wave of exemptions that mean nothing.
 *
 * So the number is pinned and may only FALL. The ratchet is the mechanism this project already
 * trusts for coverage, and it has the property that matters here: adding a new unreachable
 * function is a red test, and the entry it would need is a line a human has to write on purpose.
 */

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/**
 * Comments and strings removed.
 *
 * Both exclusions are load-bearing here, and the second was earned three times over in
 * `what-leaves-this-machine.test.ts`: a name appearing in a sentence ABOUT a function is not a
 * call, and counting it would let a doc comment keep a dead function looking alive forever.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/(^|[^:])\/\/[^\n]*/gu, "$1")
    .replace(/"(?:[^"\\\n]|\\.)*"/gu, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/gu, "''")
    .replace(/`(?:[^`\\]|\\.)*`/gu, "``");
}

const SRC_FILES = walk(SRC).map((p) => [p, codeOnly(readFileSync(p, "utf8"))] as const);
const OUTSIDE = [...walk(join(process.cwd(), "test")), ...walk(join(process.cwd(), "scripts"))]
  .map((p) => readFileSync(p, "utf8"));

/**
 * The declaration this scan hunts, at module scope so its planted-violation proof drives THIS
 * pattern and not a copy. A proof against a duplicate proves the duplicate.
 */
const EXPORTED_FUNCTION = /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gmu;

/** Exported functions that only a test or a probe ever calls. */
function onlyTestsCall(): string[] {
  const found: string[] = [];
  for (const [path, text] of SRC_FILES) {
    for (const m of text.matchAll(EXPORTED_FUNCTION)) {
      const name = m[1]!;
      const word = new RegExp(`\\b${name}\\b`, "u");
      if (SRC_FILES.some(([p, t]) => p !== path && word.test(t))) continue;
      // Used inside its own file is a real call site: the module's own code runs in production.
      if (((text.match(new RegExp(`\\b${name}\\b`, "gu")) ?? []).length - 1) > 0) continue;
      // Referenced NOWHERE at all is a decoy, and `no-dead-parts.test.ts` owns that case.
      if (!OUTSIDE.some((t) => word.test(t))) continue;
      found.push(`${path.split("/src/")[1]!} — ${name}()`);
    }
  }
  return found.sort();
}

/**
 * THE RATCHET. Measured 2026-08-15 at 58, immediately after it caught two functions written the
 * same hour: `socialWithTheRoom` (production duplicated its arithmetic inline, so the test
 * pinning "added, not multiplied" was pinning a function production did not call) and
 * `describeHowHeSounds` (a sentence for her to read that nothing ever gave her, deleted, see
 * the note in `how-he-sounds.ts` for why deleting beat wiring it).
 *
 * MAY FALL, NEVER RISE.
 */
const CEILING = 40; // 58 → 48: an earlier cleanup removed machine call sites AND their exports together

describe("a test is not a call site", () => {
  const offenders = onlyTestsCall();

  it("the count may fall and never rise", () => {
    if (offenders.length > CEILING) {
      // eslint-disable-next-line no-console
      console.log(`\n  only a test ever calls these:\n    ${offenders.join("\n    ")}`);
    }
    expect(
      offenders.length,
      "a new exported function is called only by its test. Wire it to the daemon, delete it, or "
      + "if it is genuinely a test-only helper, say so where it is declared — and lower this "
      + "ceiling when the count drops, never raise it.",
    ).toBeLessThanOrEqual(CEILING);
  });

  it("and the ceiling is not carrying slack", () => {
    // A ratchet whose ceiling sits far above the real number stops being a ratchet: it silently
    // absorbs the next several regressions. Kept within a couple of the measured value, so it
    // has to be edited deliberately as the number moves.
    expect(offenders.length, "the ceiling is stale — lower it to the measured value")
      .toBeGreaterThan(CEILING - 3);
  });

  it("the two the wiring proof caught on the day it was written are gone", () => {
    // Pinned by name rather than by count, because a count can be satisfied by any two deletions
    // and these two were specific defects: one duplicated arithmetic, one a sentence with no reader.
    expect(offenders).not.toContain("life/aware-of-him.ts — socialWithTheRoom()");
    expect(offenders).not.toContain("life/how-he-sounds.ts — describeHowHeSounds()");
  });
});

describe("THE INSTRUMENT'S OWN PROOF: it sees a function only a test calls", () => {
  // Planted rather than trusted. The whole value of this file is that it catches the disk-guard
  // shape, and a detector nobody has watched go red is a detector nobody can rely on.
  const nothingCallsIt = "export function neverCalledInProduction(): number {\n  return 1;\n}\n";

  it("recognises the declaration it hunts for", () => {
    expect([...codeOnly(nothingCallsIt).matchAll(EXPORTED_FUNCTION)].map((x) => x[1]))
      .toEqual(["neverCalledInProduction"]);
  });

  it("counts a use inside the same file as a real call site", () => {
    const usedAtHome = `${nothingCallsIt}const x = neverCalledInProduction();\n`;
    const text = codeOnly(usedAtHome);
    expect((text.match(/\bneverCalledInProduction\b/gu) ?? []).length - 1).toBe(1);
  });

  it("and does NOT count a mention in a comment or a string", () => {
    // The failure that would blind this: a doc comment naming the function keeps it looking alive
    // forever. Three separate scanners in this repo have been fooled by exactly this.
    const prose = `// neverCalledInProduction is described here\nconst s = "neverCalledInProduction";\n${nothingCallsIt}`;
    const text = codeOnly(prose);
    expect((text.match(/\bneverCalledInProduction\b/gu) ?? []).length - 1).toBe(0);
  });
});
