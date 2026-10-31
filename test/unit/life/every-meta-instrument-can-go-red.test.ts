import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * THE META-INSTRUMENTS' META-PROOF.
 *
 * ── WHY THIS LAYER EXISTS AT ALL ─────────────────────────────────────────────────────────────
 *
 * A handful of tests in this repo are not tests of her, they are MECHANICAL ENUMERATIONS over
 * the source tree: every door that can reach the network, every export nothing calls, every
 * number that decides something, every writer into her memory, the software half of two standing
 * rules (he does not read her diary, and her no is never retried). They are the thing that
 * catches the defect class this project keeps paying for: built, tested, and unreachable.
 *
 * And they share a failure mode nothing else has. An ordinary test fails when the code is wrong.
 * A SCANNER can silently stop finding things, the pattern narrows, the walk misses a directory,
 * a stripper eats too much, and it goes on passing, greener than ever, while the thing it exists
 * to catch walks past. Today alone:
 *
 *   · the outbound inventory walked `.ts` only, so her whole browser client, including a
 *     microphone that uploads his voice, was outside its field of view from the day it was built;
 *   · four separate scanners read a description of what they hunt as a sighting of it (a comment
 *     quoting broken code, a tool description containing "fetch", a detector's own regex, and a
 *     comment explaining a cast that had just been removed);
 *   · this file's own first probe reported five instruments as having no proof, because an
 *     apostrophe inside a double-quoted title truncated its capture.
 *
 * So: EVERY MECHANICAL ENUMERATION MUST CARRY A PLANTED VIOLATION THAT DRIVES ITS OWN MACHINERY.
 * Not a sentence in a header saying it was once proven red by hand, the person who did that is
 * not in the room, and the claim outlives the proof.
 *
 * ── AND THE LIST IS DISCOVERED, NOT WRITTEN ──────────────────────────────────────────────────
 *
 * A hand-written roster of "the meta-instruments" is a second copy of the truth and goes stale
 * first, the same defect as a count in prose beside a list. So the roster is COMPUTED: a test
 * file that walks the tree with `readdirSync` and reads the source is one of these, by
 * construction, and a new one added tomorrow is in scope the moment it exists.
 */

const UNIT = join(process.cwd(), "test", "unit");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

/**
 * A test that ENUMERATES the tree rather than exercising a module.
 *
 * Both halves are needed: `readdirSync` alone catches tests that walk her workspace (which is
 * ordinary filesystem behaviour), and a source path alone catches the many tests that read one
 * named file to assert an ordering. It is the combination, a recursive walk over the code, that
 * makes something a scanner with a scope that can narrow.
 */
function isMetaInstrument(text: string): boolean {
  return /readdirSync/u.test(text)
    && /cwd\(\), "(?:src|test|docs|scripts)"|SRC = join|LIFE = join/u.test(text);
}

/** Titles that announce a self-proof. */
const ANNOUNCES_A_PROOF = /own proof|goes red|planted|self-?test|proven red|种植/iu;

/**
 * Every `describe`/`it` title in a file.
 *
 * QUOTE-AWARE, and that is not a detail: the first version used `["'`]` for both delimiters, so
 * `"THE INSTRUMENT'S OWN PROOF"` captured only `THE INSTRUMENT` and this instrument reported five
 * healthy files as unproven. A detector wrong in the alarming direction, the ninth time in this
 * project that the instrument was broken before the finding meant anything.
 */
function titles(text: string): Array<{ title: string; at: number }> {
  return [...text.matchAll(/^\s*(?:describe|it)\(\s*(["'`])((?:(?!\1).)*)\1/gmu)]
    .map((m) => ({ title: m[2]!, at: m.index! }));
}

/** Names this file itself declares, the machinery a real proof has to drive. */
function ownIdentifiers(text: string): string[] {
  return [...text.matchAll(/^(?:export\s+)?(?:const|function)\s+([A-Za-z_$][\w$]*)/gmu)].map((m) => m[1]!);
}

interface Verdict { file: string; proven: boolean; why: string }

function audit(): Verdict[] {
  const out: Verdict[] = [];
  for (const file of walk(UNIT)) {
    const text = readFileSync(file, "utf8");
    if (!isMetaInstrument(text)) continue;
    const rel = file.split("/test/unit/")[1]!;
    const proofs = titles(text).filter((t) => ANNOUNCES_A_PROOF.test(t.title));
    if (proofs.length === 0) { out.push({ file: rel, proven: false, why: "no block announces a proof" }); continue; }
    // A proof has to DRIVE the file's own machinery. A block that merely asserts something true
    // about the world, under a title with the word "planted" in it, proves nothing about whether
    // this scanner can still see.
    const mine = ownIdentifiers(text);
    const drives = proofs.some(({ at }) => {
      const body = text.slice(at, at + 2500);
      // FLOOR ON THE ANCHOR. `indexOf` returning -1 does not throw, `slice(-1)` hands back the
      // LAST CHARACTER, and this check would then quietly inspect one character and answer "no
      // machinery here" forever. The floorless-guard lint pointed at this file for a different
      // reason (an example string of its own) and was right about the shape anyway.
      const arrow = body.indexOf("=>");
      if (arrow < 0) return false;
      const afterArrow = body.slice(arrow);
      // TWO conditions, and the second was earned by planting a violation that PASSED. The first
      // plant was titled "a planted scanner with no proof of its own", the word `planted` in the
      // title satisfied the title check, and its body mentioned a module-level `SRC`, which
      // satisfied a bare name check. So a file with NO proof read as proven, and the gate would
      // have gone on nodding at it forever.
      //
      // A proof must therefore ASSERT SOMETHING ABOUT the file's own machinery: the identifier has
      // to appear inside an `expect(...)`, not merely somewhere in the block.
      const asserted = [...afterArrow.matchAll(/expect\(([\s\S]{0,200}?)\)/gu)].map((m) => m[1]!);
      return mine.some((n) => asserted.some((arg) => new RegExp(`\\b${n}\\b`, "u").test(arg)));
    });
    out.push({
      file: rel,
      proven: drives,
      why: drives ? "drives its own machinery" : "has a proof-shaped title that exercises nothing of its own",
    });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

describe("every mechanical enumeration can be shown to go red", () => {
  const verdicts = audit();

  it("finds the scanners at all — an empty roster would pass every check below", () => {
    // The way this file fails silently: the detector stops recognising meta-instruments and
    // reports a clean sweep of nothing. A floor, not a formality.
    expect(verdicts.length, "the roster is empty or nearly so; `isMetaInstrument` has narrowed")
      .toBeGreaterThanOrEqual(6);
  });

  it("and every one of them carries a planted violation that drives its own machinery", () => {
    const unproven = verdicts.filter((v) => !v.proven);
    if (unproven.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`\n  scanners with no standing proof:\n    ${unproven.map((v) => `${v.file} — ${v.why}`).join("\n    ")}`);
    }
    expect(
      unproven.map((v) => v.file),
      "a scanner over the source tree has no test that shows it still sees. Plant a violation it "
      + "must catch, and a healthy shape it must not flag — both, because a scanner that has only "
      + "ever been narrowed is one drifting toward silence.",
    ).toEqual([]);
  });

  it("the named ones are all present, so the roster cannot quietly shrink", () => {
    // The roster is computed, which is right, and a computed roster can go to zero without
    // anyone noticing. These five are the load-bearing scanners; naming them means the walk
    // losing any of them is a red test rather than a smaller number.
    const files = verdicts.map((v) => v.file);
    for (const must of [
      "security/what-leaves-this-machine.test.ts",   // what can leave this machine
      "life/no-dead-parts.test.ts",                  // exports nothing calls
      "life/wired-to-production.test.ts",            // functions only a test calls
      "life/fixtures-match-production.test.ts",      // casts that switch the checker off
      "life/his-two-rulings.test.ts",                // the software half of two standing rules
    ]) {
      expect(files, `${must} is no longer recognised as a scanner`).toContain(must);
    }
  });
});

describe("THE META-INSTRUMENT'S OWN PROOF", () => {
  // It hunts for proofs, so it needs one: the same rule, applied to itself.
  it("a title with an apostrophe inside double quotes is captured whole", () => {
    // The exact bug this file shipped with for ten minutes. `"THE INSTRUMENT'S OWN PROOF"` came
    // back as `THE INSTRUMENT`, which does not match, so five proven files read as unproven.
    const src = `describe("THE INSTRUMENT'S OWN PROOF: it goes red", () => {});`;
    const t = titles(src);
    expect(t).toHaveLength(1);
    expect(t[0]!.title).toBe("THE INSTRUMENT'S OWN PROOF: it goes red");
    expect(ANNOUNCES_A_PROOF.test(t[0]!.title)).toBe(true);
  });

  it("recognises a tree-walking scanner and not an ordinary test", () => {
    expect(isMetaInstrument('readdirSync(x); const SRC = join(process.cwd(), "src");')).toBe(true);
    expect(isMetaInstrument('const s = readFileSync(join(process.cwd(), "src/index.ts"));'),
      "reading one named file was called a scanner").toBe(false);
    expect(isMetaInstrument('readdirSync(herWorkspace)'),
      "walking her workspace was called a scanner").toBe(false);
  });

  it("and a proof-shaped title that drives nothing does not count as proven", () => {
    // The way this gate would become a formality: a `describe("planted", …)` containing an
    // assertion about arithmetic, satisfying the title check while exercising no scanner.
    const hollow = [
      'const SRC = join(process.cwd(), "src");',
      "function detector(s) { return /x/.test(s); }",
      "readdirSync(SRC);",
      'describe("planted violation", () => { it("x", () => { expect(1 + 1).toBe(2); }); });',
    ].join("\n");
    const proofs = titles(hollow).filter((t) => ANNOUNCES_A_PROOF.test(t.title));
    expect(proofs).toHaveLength(1);
    const body = hollow.slice(proofs[0]!.at);
    const arrow = body.indexOf("=>");
    expect(arrow, "the worked example has no arrow function to inspect").toBeGreaterThan(-1);
    const afterArrow = body.slice(arrow);
    const drives = ownIdentifiers(hollow).some((n) => new RegExp(`\\b${n}\\b`, "u").test(afterArrow));
    expect(drives, "a hollow proof would have counted").toBe(false);
  });
});
