import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// NOTHING IN HER IS WIRED TO A CONSTANT (the structural half).
//
// The single most repeated failure in this project is a thing that exists, is tested, looks wired,
// and is fed by nothing:
//
//   `userNeeds: 0`               a drive input hardcoded to zero, so the drive it fed had never
//                                once fired in the entire history of the system.
//   `day.idle: 0`                same shape, still live: `curiosity` loses a term.
//   `day.maintenanceDue: 0`      same, and it is `maintenance`'s ONLY day-input.
//   `generateThoughts: () => []` a callback wired to a no-op, which killed a whole branch.
//
// Every one of those passed review and passed CI, because each is locally reasonable, a zero is a
// perfectly good number and an empty array is a perfectly good array. What makes them bugs is that
// they are the INPUT SIDE of a computation that is presented as live.
//
// So the guard cannot be review; it has to be mechanical. Two checks, both narrow enough to be
// true: nothing in the living layer is a module only its own test imports, and no dependency the
// daemon injects is a frozen constant without a recorded reason.
//
// The runtime half of this lives in the long-run gate, where every signal must be shown to MOVE
// across a simulated life. Between them: a wire that is not connected, and a wire that is connected
// to something that never changes, are both findable without anyone noticing them.

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

const ALL_SRC = walk(SRC);
const SRC_TEXT = new Map(ALL_SRC.map((p) => [p, readFileSync(p, "utf8")]));

// ── 1. Modules nothing in src/ imports ───────────────────────────────────────

/** A module `src/` never imports, and why that is a decision rather than an oversight. */
const STAGED_MODULES: Record<string, string> = {
  "if-then-profile.ts":
    "staged: it computes the behavioural criterion `layers.md` has DECLARED since it was written "
    + "and nothing has ever calculated — profile stability > 0.2, with the shape not recoverable "
    + "from any single input. It cannot be run yet and that is structural, not a shortfall: "
    + "stability is a correlation of her if-then shape across two NON-OVERLAPPING stretches of "
    + "life, and she has one, which I seeded. Correlating a fixture with itself would report a "
    + "number about its author. "
    + "WHAT IS DELIBERATELY NOT BUILT WITH IT: the recorder that would accumulate occasions turn "
    + "by turn. Recording is the half that cannot be retrofitted (the same argument that keeps "
    + "the own-voice pool growing while its reader waits behind a flag), so the omission is a "
    + "real cost and is named here rather than hidden. It is omitted because an occasion needs a "
    + "definition of WHAT SHE DID that is comparable across situations, and inventing one at the "
    + "end of a long session is how a measurement gets a number it did not earn. The open "
    + "question is the occasion's definition, not the arithmetic.",

  "growth-gate.ts":
    "staged: the LoRA weight layer does not ship. Kept whole rather than half-deleted so that "
    + "building it is a decision about the weight layer, not an archaeology exercise.",
};

describe("every module in the living layer is reachable from the daemon", () => {
  it("no file in src/life is imported only by its own tests", () => {
    const orphans: string[] = [];
    for (const path of ALL_SRC.filter((p) => p.includes("/life/"))) {
      const base = path.split("/").pop()!;
      if (STAGED_MODULES[base]) continue;
      const stem = base.replace(/\.ts$/, "");
      const importedBy = ALL_SRC.filter((p) => p !== path && new RegExp(`["'./]${stem}\\.js["']`).test(SRC_TEXT.get(p)!));
      if (importedBy.length === 0) orphans.push(base);
    }
    if (orphans.length > 0) console.log(`\n  imported by nothing in src/: ${orphans.join(", ")}`);
    expect(orphans, "a module only its own test imports is a decoy: wire it, delete it, or stage it").toEqual([]);
  });

  it("a staged module carries a real reason", () => {
    for (const [k, why] of Object.entries(STAGED_MODULES)) {
      expect(why.length, `${k} needs a reason, not a shrug`).toBeGreaterThan(60);
    }
    expect(Object.keys(STAGED_MODULES).length, "if this grows, dead code is being normalised").toBeLessThan(4);
  });
});

// ── 2. Dependencies the daemon injects as a frozen constant ──────────────────

/**
 * A callback or field the daemon deliberately wires to a constant, and why.
 *
 * Anything NOT here is presumed to be an accident, because that is what it has been every time.
 */
const DELIBERATE_CONSTANTS: Record<string, string> = {
  "generateThoughts: () => []":
    "her voice comes from the agency loop, where she chooses reach_out in a moment of her own. "
    + "The tick's own expression branch is a working model-free fallback, deliberately not wired.",
};

/** The daemon's own wiring, where an injected dependency can be quietly frozen. */
const WIRING_FILES = ALL_SRC.filter((p) => p.endsWith("/index.ts") || p.includes("/telegram/bootstrap"));

describe("the propensity is fed the state it claims to weigh", () => {
  it("every factor family the daemon can supply is actually supplied", () => {
    // The propensity scores seven families. If the daemon hands it a bare context, five of them
    // read as zero and it degenerates into "drives, plus the model", which is most of the way back
    // to the single decider it replaced, while still looking like a weighted sum.
    const wiring = SRC_TEXT.get(ALL_SRC.find((p) => p.endsWith("/index.ts"))!)!;
    for (const fed of ["openness:", "otherConfidence:", "carrying:", "clockActivity:", "pendingBirths:", "orphanShare:", "temperament,"]) {
      expect(wiring, `the propensity's "${fed}" input is never supplied`).toContain(fed);
    }
  });

  it("the daemon's vitals block carries every signal the test harness does", () => {
    // The harness in _real-world.ts is what proves every detector reachable, so if the two blocks
    // drift the detectors are proven against a world that does not exist. That is not hypothetical:
    // `surprise` was added to the harness and to the readout and MISSED in the daemon, which would
    // have left the live one reporting undefined forever while every test passed.
    const wiring = SRC_TEXT.get(ALL_SRC.find((p) => p.endsWith("/index.ts"))!)!;
    const harness = readFileSync(join(process.cwd(), "test/unit/life/_real-world.ts"), "utf8");
    // Only `sourcesFor`, which is the block that mirrors the daemon. Scraping the whole file by
    // indentation swept up the drivers' own arguments and reported a life-simulation helper's day
    // summary as a missing production signal.
    const start = harness.indexOf("export function sourcesFor");
    expect(start, "the harness must still have a sourcesFor to compare against").toBeGreaterThan(-1);
    const end = harness.indexOf("\nexport ", start + 1);
    const sourcesFor = harness.slice(start, end === -1 ? undefined : end);
    // Any indentation. This used to demand exactly eight spaces, so an ordinary reformat of
    // the harness silently emptied the extraction and the comparison below passed against
    // nothing. Scoping to the sourcesFor slice is what keeps the drivers' own arguments out.
    const fieldKeys = [...sourcesFor.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
    expect(fieldKeys.length, "the signal extraction came back near-empty").toBeGreaterThanOrEqual(30);
    const missing = [...new Set(fieldKeys)].filter((k) => !wiring.includes(`${k}:`));
    if (missing.length > 0) console.log(`\n  in the harness but not the daemon: ${missing.join(", ")}`);
    expect(missing, "a signal proven in tests and absent in production is a blind spot").toEqual([]);
  });
});

describe("no dependency the daemon injects is frozen at a constant", () => {
  it("every no-op callback is a recorded decision", () => {
    const frozen: string[] = [];
    for (const path of WIRING_FILES) {
      const text = SRC_TEXT.get(path)!;
      // `name: () => []`, `() => 0`, `() => false`, `() => ""`, `() => null`, a supplied dependency
      // that can never return anything else.
      for (const m of text.matchAll(/(\w+):\s*\(\)\s*=>\s*(\[\]|0|false|""|''|null)\b/g)) {
        const sig = `${m[1]}: () => ${m[2]}`;
        if (!DELIBERATE_CONSTANTS[sig]) frozen.push(`${path.split("/").pop()} — ${sig}`);
      }
    }
    if (frozen.length > 0) console.log(`\n  injected and frozen:\n    ${frozen.join("\n    ")}`);
    expect(frozen, "this is the userNeeds failure: feed it, remove it, or record why it is frozen").toEqual([]);
  });

  it("a deliberate constant carries a real reason", () => {
    for (const [k, why] of Object.entries(DELIBERATE_CONSTANTS)) {
      expect(why.length, `${k} needs a reason`).toBeGreaterThan(60);
    }
  });
});

// ── 3. Exports nothing anywhere references ───────────────────────────────────
//
// A working note on this file said "listed so the count cannot quietly grow". There was no
// list and no count: the sentence WAS the mechanism, which is to say there was no mechanism.
// The same entry then recorded that two named functions "had already been removed in earlier
// rounds", and both were still in the tree, unreferenced, when someone finally ran a search. An
// entry written to record the lesson that an un-executed claim is a guess contained a fresh
// un-executed claim, twice.
//
// So the list is computed here, every run, from the tree itself.

/** A runtime export nothing references, and why it is still here. */
const KNOWN_DEAD_EXPORTS: Record<string, string> = {
  "previewGroundedRemForFile":
    "the whole of src/memory/evidence.ts is imported by TESTS ONLY — no production path reaches "
    + "it. Removing a 1000-line inherited subsystem is a decision about whether her memory ever "
    + "wants an evidence-grading layer, not a cleanup, so it goes to Eric intact rather than "
    + "being quietly deleted by the person who happened to be tidying.",
};

/**
 * The declaration pattern the decoy scan uses, at module scope so the planted-violation proof at
 * the bottom of this file drives THIS pattern rather than a copy of it. A proof against a
 * duplicate proves the duplicate works, which is the two-implementations defect in a proof's
 * clothes.
 *
 * `g` without `y`, and re-created per use via `matchAll`, so a shared `lastIndex` cannot make one
 * caller start where another left off.
 */
const DECLARES_A_RUNTIME_EXPORT = /^export\s+(?:async\s+)?(?:const|function|class)\s+([A-Za-z_$][\w$]*)/gm;

describe("nothing exported is referenced by nothing", () => {
  const OTHER_TEXT = [
    ...walk(join(process.cwd(), "test")),
    ...walk(join(process.cwd(), "scripts")),
  ].map((p) => readFileSync(p, "utf8"));

  it("every runtime export is reachable from somewhere, or recorded as not", () => {
    const dead: string[] = [];
    for (const [path, text] of SRC_TEXT) {
      for (const m of text.matchAll(DECLARES_A_RUNTIME_EXPORT)) {
        const name = m[1];
        const word = new RegExp(`\\b${name}\\b`);
        // Anywhere at all: another src file, a test, a harness script.
        const elsewhere = [...SRC_TEXT].some(([p, t]) => p !== path && word.test(t))
          || OTHER_TEXT.some((t) => word.test(t));
        if (elsewhere) continue;
        // Used inside its own file is merely an over-broad export, which is hygiene, not a decoy.
        const usesAtHome = (text.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length - 1;
        if (usesAtHome > 0) continue;
        if (KNOWN_DEAD_EXPORTS[name]) continue;
        dead.push(`${path.split("/src/")[1]} — ${name}`);
      }
    }
    if (dead.length > 0) console.log(`\n  exported and referenced nowhere:\n    ${dead.join("\n    ")}`);
    expect(dead, "wire it, delete it, or record why it stays").toEqual([]);
  });

  it("a known-dead export carries a real reason, and the list does not grow", () => {
    for (const [k, why] of Object.entries(KNOWN_DEAD_EXPORTS)) {
      expect(why.length, `${k} needs a reason, not a shrug`).toBeGreaterThan(60);
    }
    // The tripwire. Not a property check, it cannot tell you the entries are JUSTIFIED, only
    // that someone added one, which is exactly when a human should look (defect class 12).
    expect(Object.keys(KNOWN_DEAD_EXPORTS).length, "dead code is being normalised").toBeLessThan(3);
  });
});

describe("THE INSTRUMENT'S OWN PROOF: the decoy scan can go red", () => {
  // This file's header says it was "proven red by planting a dead export and watching it
  // name it", and that was a MANUAL plant, done once, by a person who is no longer in the room.
  // A proof that lives in a sentence is a claim; this is the standing version.
  //
  // It matters more here than almost anywhere: this scan is what stands between the tree and
  // another `gemini.ts`, a whole provider whose header claimed it served nine background jobs
  // while no file imported it.
  it("sees each of the three declaration forms it hunts", () => {
    const planted = [
      "export const aDecoyConst = 1;",
      "export function aDecoyFunction(): void {}",
      "export class ADecoyClass {}",
      "export async function anAsyncDecoy(): Promise<void> {}",
    ].join("\n");
    expect([...planted.matchAll(DECLARES_A_RUNTIME_EXPORT)].map((m) => m[1])).toEqual([
      "aDecoyConst", "aDecoyFunction", "ADecoyClass", "anAsyncDecoy",
    ]);
  });

  it("and the reachability question is answered by a WORD match, not a substring", () => {
    // The failure that would make this scan useless in the quiet direction: `\bfoo\b` must not be
    // satisfied by `fooBar`, or every short name looks reachable because some longer name
    // contains it. Two names one character apart is the realistic case.
    const word = new RegExp("\\baDecoy\\b");
    expect(word.test("const x = aDecoyThing;"), "a longer name satisfied a shorter one").toBe(false);
    expect(word.test("const x = aDecoy;")).toBe(true);
  });

  it("a known-dead entry needs a real reason, and a shrug is not one", () => {
    // The list is the escape hatch, so the escape hatch has its own floor: this is what stops
    // "wire it, delete it, or record why" collapsing into "add a line and move on".
    const shrug = "not used yet";
    expect(shrug.length > 60, "a placeholder reason would pass the known-dead check").toBe(false);
    for (const why of Object.values(KNOWN_DEAD_EXPORTS)) expect(why.length).toBeGreaterThan(60);
  });
});
