import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * A CONFIG KEY THAT NOTHING READS IS A SWITCH THAT DOES NOTHING AND SAYS NOTHING.
 *
 * Three of them were live when this was written. `supportsExtendedThinking` and
 * `supportsAdaptiveThinking` were declared in the schema, defaulted for all three models, AND SET
 * IN `config.yaml`, the real deployment file, not the example, and read by nothing anywhere in
 * the tree. `consolidationThreshold` outlived its constant: `CONSOLIDATION_THRESHOLD` was deleted
 * as dead code, and the key it came from stayed.
 *
 * A dead constant is harmless; the compiler and the linter both watch for it. A dead config key is
 * worse than dead code, because it is the surface ERIC touches: he would set it, nothing would
 * happen, and nothing would tell him. And zod's default is to strip unknown keys rather than
 * complain, so the failure is silent from both ends.
 *
 * So: every key the schema declares must be read somewhere outside the schema, or be named below
 * with a reason. The exemption list is a RATCHET, it may shrink, never grow.
 */

const ROOT = process.cwd();
const SCHEMA = readFileSync(join(ROOT, "src/config/schema.ts"), "utf8");

/** Everything outside the schema that could be reading a key. */
const CORPUS = (() => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); }
      else if (/\.(ts|js|mjs|cjs)$/u.test(e.name) && !p.endsWith("config/schema.ts")) {
        out.push(readFileSync(p, "utf8"));
      }
    }
  };
  for (const d of ["src", "test", "scripts"]) walk(join(ROOT, d));
  return out.join("\n");
})();

/**
 * Every leaf key the schema declares: `name: z.something`. Nested object schemas are declared the
 * same way, so this catches the whole tree of them rather than only the top level.
 */
function declaredKeys(): string[] {
  return [...new Set([...SCHEMA.matchAll(/^\s{2,}(\w+):\s*z\./gmu)].map((m) => m[1]!))];
}

/**
 * Keys that are declared without being read, each with why that is right. RATCHET: never grows.
 * Empty today, and it should take an argument to make it not empty.
 */
const DECLARED_ONLY: Record<string, string> = {};

describe("the config has no switch that does nothing", () => {
  it("the schema's keys are found at all", () => {
    // Vacuously green against an empty extraction, which is what every broken instrument in this
    // repository has looked like from the outside.
    expect(declaredKeys().length, "the schema stopped parsing").toBeGreaterThan(35);
  });

  it("EVERY DECLARED KEY IS READ SOMEWHERE", () => {
    const dead = declaredKeys().filter((k) => !DECLARED_ONLY[k] && !CORPUS.includes(k));
    if (dead.length > 0) console.log(`\n  declared and never read:\n    ${dead.join("\n    ")}`);
    expect(dead, "wire it up, delete it, or record below why it is declarative only. A key Eric "
      + "can set that changes nothing is worse than no key.").toEqual([]);
  });

  it("and the three that were dead are gone from the files he edits, not just from the schema", () => {
    // Deleting the schema field alone would have been the WORSE outcome: zod strips unknown keys
    // silently, so `supportsExtendedThinking: false` would still sit in `config.yaml` looking
    // exactly as authoritative as the lines around it.
    //
    // `config.yaml` is the owner's local file and is never committed, so a fresh clone has none.
    // It is checked whenever it exists; the two committed files are always checked.
    const files = ["config.example.yaml", "src/config/schema.ts"];
    if (existsSync(join(ROOT, "config.yaml"))) files.unshift("config.yaml");
    for (const f of files) {
      const text = readFileSync(join(ROOT, f), "utf8");
      const live = text.split("\n").filter((l) => !l.trimStart().startsWith("//")
        && !l.trimStart().startsWith("#") && !l.trimStart().startsWith("*"));
      for (const k of ["supportsExtendedThinking", "supportsAdaptiveThinking", "consolidationThreshold"]) {
        expect(live.join("\n"), `${k} is back in ${f}`).not.toContain(k);
      }
    }
  });

  it("an exemption carries a real reason", () => {
    for (const [k, why] of Object.entries(DECLARED_ONLY)) {
      expect(why.length, `${k} needs a reason, not a shrug`).toBeGreaterThan(60);
    }
    expect(Object.keys(DECLARED_ONLY).length, "dead switches are accumulating").toBe(0);
  });
});
