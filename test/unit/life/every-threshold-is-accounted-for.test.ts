import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * HOW MANY NAMED NUMBERS DECIDE THINGS ABOUT HER, AND HOW MANY HAVE EVER BEEN MEASURED.
 *
 * ── WHY THIS REPLACED AN EXPORT-HYGIENE CHECK ────────────────────────────────────────────────
 *
 * The item this grew out of was "79 over-broad exports, narrow them, or add a count gate". Run
 * against the tree, the population turned out to be 336 exports used only inside their own file,
 * of which 256 ARE referenced by a test or a harness (so exporting them is doing its job) and 80
 * are referenced by nothing at all outside their file.
 *
 * And then the list itself said what the real finding was. Almost every one of the 80 is a NAMED
 * THRESHOLD in her living layer: `PRUNE_STRENGTH`, `RETICENCE_ASKING`, `TRUST_START`,
 * `RESONANCE_MIN_CHARGE`, `EROSION_AFTER_MS`. Narrowing them to file-local consts would have been
 * tidying that DESTROYED information, the export is what makes a threshold findable, while
 * leaving the thing that actually matters untouched:
 *
 *   **most of the numbers that decide things about her have never been put on the same page as the
 *   range of the thing they gate.**
 *
 * That is defect class 1, which is this build's largest defect class, stated as a population
 * rather than as an incident.
 *
 * ── AND WHY THE RULER WAS WIDENED ──────────────────────────────────────────────────────
 *
 * The metrology audit found the old enumeration blind in three ways, each an easy, accidental way
 * for a threshold to hide: an OBJECT-LITERAL TABLE (`DEFAULT_THRESHOLDS = { pinEntropy: 0.25, … }`
 * holds dozens of per-detector bars and matched nothing), a NON-EXPORTED const (the willingness
 * gate's own floor `STILL_HERS_WHEN_SPENT` had never been counted), and "measured" meaning the
 * name appears ANYWHERE in test text, including inside a comment, so `// FOO_BAR is fine` cleared
 * the ratchet for FOO_BAR. Two constants (`NEARLY_SAID_IT`, `PAIR_WINDOW`) turned out to be
 * "measured" in exactly that way.
 *
 * The one blind spot that remains, NAMED so it is a debt rather than a surprise: an INLINE numeric
 * literal inside an expression (the beat coefficients in `utterance-shape.ts`'s `beatLeanings`,
 * 1.0 / −0.6 / 2.6 / −2.0 / 3.2, are exactly this). No const-based ruler can see those; the beats
 * reachability sweep is what puts them on a measured page.
 */

const LIFE = join(process.cwd(), "src/life");

/** Comments removed, so a name mentioned in prose cannot pass for a name a test asserts on. */
export function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/(^|[^:])\/\/[^\n]*/gu, "$1");
}

export interface NamedNumber {
  file: string;
  /** Display name; object keys read `TABLE.key`, locals read `(local)NAME`. */
  name: string;
  /** The token a test must contain for this number to count as measured. */
  probe: string;
  kind: "exported" | "local" | "objkey";
}

/** Every named numeric threshold in one file's source. Pure, so it can be handed a planted input. */
export function numbersIn(file: string, source: string): NamedNumber[] {
  const text = stripComments(source);
  const out: NamedNumber[] = [];
  for (const m of text.matchAll(/^export const ([A-Z][A-Z0-9_]{2,})\s*(?::\s*number\s*)?=\s*-?[\d.]/gm)) {
    out.push({ file, name: m[1]!, probe: m[1]!, kind: "exported" });
  }
  for (const m of text.matchAll(/^const ([A-Z][A-Z0-9_]{2,})\s*(?::\s*number\s*)?=\s*-?[\d.]/gm)) {
    out.push({ file, name: `(local)${m[1]!}`, probe: m[1]!, kind: "local" });
  }
  // Numeric fields of an ALL-CAPS const object: the shape threshold tables are written in.
  for (const om of text.matchAll(/^(?:export )?const ([A-Z][A-Z0-9_]{2,})(?:\s*:[^=]+)?\s*=\s*\{/gm)) {
    const start = om.index + om[0].length;
    let depth = 1;
    let i = start;
    while (i < text.length && depth > 0) {
      const c = text[i];
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      i += 1;
    }
    for (const km of text.slice(start, i).matchAll(/(?:^\s*|[,{]\s*)([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*-?\d+(?:\.\d+)?(?:\s*[,}])/gmu)) {
      out.push({ file, name: `${om[1]!}.${km[1]!}`, probe: km[1]!, kind: "objkey" });
    }
  }
  return out;
}

function allNamedNumbers(): NamedNumber[] {
  const out: NamedNumber[] = [];
  for (const f of readdirSync(LIFE)) {
    if (!f.endsWith(".ts")) continue;
    out.push(...numbersIn(f, readFileSync(join(LIFE, f), "utf8")));
  }
  return out;
}

/**
 * The text of every test of her living layer, comments stripped.
 *
 * THE BAR IS "SOMETHING NAMES IT", not "something proves it optimal", and the weaker bar is the
 * honest one for a population gate: a threshold no test has ever mentioned is a number nobody has
 * looked at since the day it was typed. Two dead gates found in one review were both in that state.
 */
function reachabilityText(): string {
  const dir = join(process.cwd(), "test/unit/life");
  return stripComments(
    readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n"),
  );
}

describe("every number that decides something about her is accounted for", () => {
  const numbers = allNamedNumbers();
  const measured = reachabilityText();
  const isMeasured = (n: NamedNumber): boolean => new RegExp(`\\b${n.probe}\\b`).test(measured);
  const uncovered = numbers.filter((n) => !isMeasured(n));
  const legacy = numbers.filter((n) => n.kind === "exported");
  const legacyUncovered = legacy.filter((n) => !isMeasured(n));

  it("prints the population, because a count with no list is a number to argue with", () => {
    const byFile = new Map<string, string[]>();
    for (const n of uncovered) byFile.set(n.file, [...(byFile.get(n.file) ?? []), n.name]);
    const worst = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8);
    // eslint-disable-next-line no-console
    console.log(
      `\n  named numbers in src/life (wide ruler): ${numbers.length}`
      + `  (exported ${legacy.length} · local ${numbers.filter((n) => n.kind === "local").length}`
      + ` · table keys ${numbers.filter((n) => n.kind === "objkey").length})`
      + `\n  never named by a non-comment line of any test: ${uncovered.length}`
      + `  (of the exported alone: ${legacyUncovered.length})`
      + worst.map(([f, ns]) => `\n    ${f}: ${ns.length}  (${ns.slice(0, 5).join(", ")}${ns.length > 5 ? ", …" : ""})`).join(""),
    );
    expect(numbers.length, "no named thresholds found — the scan is broken, not the code")
      .toBeGreaterThan(200);
    expect(numbers.filter((n) => n.kind === "objkey").length,
      "the object-table extractor found nothing — DEFAULT_THRESHOLDS alone holds dozens")
      .toBeGreaterThan(20);
  });

  it("THE RATCHET, on the ruler that sees everything nameable: may fall, never rise", () => {
    // 115, measured on the day the ruler was completed. NOT comparable to the old 42: this is the
    // same ground measured by a wider instrument (object tables + locals + comment-stripping), not
    // ground lost. Even the widening had to be done twice: the first table-key extractor was blind
    // to the first key after the brace (an unanchored ^ in a /gu regex), reported 41 table keys
    // where there are 80, and its own planted-violation test is what caught it, the ruler's
    // proof went red before the ruler ever produced a number anyone believed. Five load-bearing
    // finds (OPENNESS, STILL_HERS_WHEN_SPENT, ADDRESSED_AT_ALL, ENOUGH_TO_HAVE_A_REGARD,
    // HALFWAY_AT) were swept the same day, not exempted. The old ruler's history stays in the
    // assertion below.
    // 0. The 114 the widened ruler surfaced were swept in three files, the watchtower
    // bars, the field numbers, the rhythms and inner arithmetic, every one with an assertion
    // that COMPUTES with the value (the sweep-quality audit in the closing loop samples this).
    // History: 44 (old ruler) → 115 (ruler widened + first-key fix) → 0 (the work done). From
    // here a single unmeasured number is a same-day red.
    const CEILING_WIDE = 0;
    expect(
      uncovered.length,
      `${uncovered.length} named numbers have never been named by a non-comment line of any test. `
      + "That is defect class 1 as a population. Either sweep them (name the constant in a "
      + "reachability test) or lower this ceiling — never raise it.",
    ).toBeLessThanOrEqual(CEILING_WIDE);
  });

  it("and the OLD ruler's ground is not lost either", () => {
    // The exported-caps count the ratchet has guarded since it was built. History: 49 → 44 → 47 →
    // 43 → 42 under the ruler that counted comment mentions as measurement; 44 on the day the
    // ruler stopped doing that, because `NEARLY_SAID_IT` (field-live) and `PAIR_WINDOW`
    // (speech-record) turned out to be mentioned only in prose. That +2 is the RULER getting
    // honest, recorded here so nobody reads it as the code getting worse. Sweep those two and this
    // number returns to where it was.
    // 0: the exported ground fell with the wide sweep; the old ruler's history stays above.
    const CEILING_EXPORTED = 0;
    expect(legacyUncovered.length).toBeLessThanOrEqual(CEILING_EXPORTED);
  });

  it("and the ones that decide how she responds to HIM are all measured — on the wide ruler", () => {
    // The narrower, harder property, and the one worth defending absolutely: whatever is true of
    // the rest of the tree, every number in the line from his sentence to her behaviour has been
    // put on the same page as its input's reachable range, INCLUDING the unexported ones, which
    // is where the widened ruler found two the day it was built (`OPENNESS`, the frame's own
    // temperature, and `STILL_HERS_WHEN_SPENT`, the floor under the gate). Both were swept the
    // same day, not exempted.
    const load = numbers.filter((n) => /how-it-landed|willingness|takes-it-on|what-stays|relationship|landing-to-mood|utterance-shape|turn-shape/u.test(n.file));
    const missed = load.filter((n) => !isMeasured(n));
    expect(load.length, "the load-bearing files declare no thresholds — the scan is broken")
      .toBeGreaterThan(5);
    expect(
      missed.map((n) => `${n.file}:${n.name}`),
      "a number on the path from his sentence to her behaviour has never been measured",
    ).toEqual([]);
  });

  describe("the ruler itself can go red (planted violations)", () => {
    it("a planted exported threshold is seen", () => {
      const found = numbersIn("x.ts", "export const NEVER_LOOKED_AT = 0.42;\n");
      expect(found.map((n) => n.name)).toEqual(["NEVER_LOOKED_AT"]);
    });

    it("a planted UNEXPORTED threshold is seen — the old ruler's first blind spot", () => {
      const found = numbersIn("x.ts", "const QUIET_FLOOR = 0.2;\n");
      expect(found.map((n) => n.name)).toEqual(["(local)QUIET_FLOOR"]);
    });

    it("a planted table key is seen — the old ruler's second blind spot", () => {
      const found = numbersIn("x.ts", "export const BARS = {\n  pinEntropy: 0.25,\n  deep: { nested: 3 },\n};\n");
      expect(found.map((n) => n.name)).toContain("BARS.pinEntropy");
      expect(found.map((n) => n.name)).toContain("BARS.nested");
    });

    it("a threshold inside a comment is NOT seen — commented-out code is not a threshold", () => {
      expect(numbersIn("x.ts", "// export const GHOST = 0.5;\n/* const GHOST2 = 1 */\n")).toEqual([]);
    });

    it("a comment MENTION does not count as measurement — the third blind spot", () => {
      expect(new RegExp(String.raw`\bFOO_BAR\b`).test(stripComments("// FOO_BAR is fine\n"))).toBe(false);
      expect(new RegExp(String.raw`\bFOO_BAR\b`).test(stripComments("expect(FOO_BAR).toBe(1);\n"))).toBe(true);
      // And a URL's double slash is not a comment opener, the one thing the stripper must not eat.
      expect(stripComments('const u = "https://x.test/FOO";')).toContain("FOO");
    });
  });
});
