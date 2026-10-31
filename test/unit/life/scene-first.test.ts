import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";

/**
 * A MECHANISM ABOUT WHAT SHE IS LIKE MUST BE REACHED BY A SCENE.
 *
 * The method: write the moment that is unmistakably a living person FIRST, then work
 * backwards to what is missing. `docs/scenarios.md` is where that happens.
 *
 * The whole perception layer, his voice having a shape, the room, the window, was built the other
 * way round, from a design argument, and not one scene was written. THAT IS NOT A PAPERWORK
 * COMPLAINT: the moment where she goes to look and he is not there was designed and then not built,
 * and it went unnoticed for a day precisely because no scene existed to have an empty slot in it.
 * Writing S-30 would have found it the same afternoon.
 *
 * ── WHY A FROZEN EXCLUSION LIST AND NOT A COUNT ──────────────────────────────────────────────
 *
 * Measured the day this was written: 31 scenes cite 17 test files between them, and 75 modules
 * under `life/`, `embodiment/` and `workspace/` are reached by no scene at all. A gate demanding
 * every one of them be covered today would be met by back-filling 75 scenes in an afternoon,
 * which is the opposite of the method, the scene is supposed to come first and be believed.
 *
 * So the debt is FROZEN BY NAME below, and everything not on the list is checked. A module added
 * tomorrow is not on the list, so it must be reached by a scene. And the list can only SHRINK: a
 * name still on it after its module became scene-reached is a failure too, so writing the scene
 * is the only way to remove an entry. A count would have let a new mechanism slip in under cover
 * of a scene written for an old one; a set cannot.
 *
 * "Reached" means a scene names a test file that imports the module, not that a scene happens to
 * write the module's name. The first instrument here did the latter and reported `things.ts` as
 * uncovered while S-30, 「空椅子」, the scene about her window, is entirely about it.
 */

const ROOT = process.cwd();
const SCENARIOS = readFileSync(join(ROOT, "docs/scenarios.md"), "utf8");
const HER_LAYERS = ["src/life", "src/embodiment", "src/workspace"];

/** Modules that predate the rule. May shrink, never grow. Remove a line by writing its scene. */
const PREDATES_THE_RULE: string[] = [
  // agency-handlers.ts and expression.ts left on 2026-09-28: S-68 cites her-acts-are-not-shaped.test.ts,
  // which drives her acts (and the speaking gate they carry) through the real handlers.
  "src/life/agency-schedule.ts",
  "src/life/autobiography-lint.ts",
  "src/life/birth-toolkit.ts",
  "src/life/born-at.ts",
  "src/life/breath.ts",
  "src/life/capacity.ts",
  "src/life/clock-sanity.ts",
  "src/life/code-version.ts",
  "src/life/consent-filter.ts",
  "src/life/continuity.ts",
  "src/life/day-summary.ts",
  "src/life/doing.ts",
  "src/life/expression-tracker.ts",
  "src/life/faults.ts",
  "src/life/field-index.ts",
  "src/life/field-store.ts",
  "src/life/finite.ts",
  "src/life/fusion.ts",
  "src/life/her-own-voice.ts",
  "src/life/her-voice.ts",
  "src/life/how-she-answered.ts",
  "src/life/how-she-starts-out.ts",
  "src/life/if-then-profile.ts",
  "src/life/inner-state-store.ts",
  "src/life/landing-to-mood.ts",
  "src/life/liking.ts",
  "src/life/machine-voice.ts",
  "src/life/metabolism-store.ts",
  "src/life/metabolism.ts",
  "src/life/noticing.ts",
  "src/life/one-of-her.ts",
  "src/life/play.ts",
  // register-scissors.ts paid this debt with S-70: her proactive voice gets the same cut.
  "src/life/remembering.ts",
  // self-knowledge.ts came back onto this list on 2026-09-28. It had never been reached by a scene:
  // the only cited test that seemed to reach it names the data file `self-knowledge.json`, and the
  // match used to read that as an import of the module. The debt was always there, uncounted.
  "src/life/self-knowledge.ts",
  "src/life/self-knowledge-store.ts",
  "src/life/shadow-voice.ts",
  "src/life/sleep.ts",
  "src/life/snapshot-db.ts",
  "src/life/snapshot.ts",
  "src/life/soul-invariants.ts",
  "src/life/speech-record.ts",
  "src/life/still-alive.ts",
  "src/life/takes-it-on.ts",
  "src/life/tick.ts",
  "src/life/turn-appraisal.ts",
  // turn-guard.ts paid this debt with S-65: the turn that ends with nothing of hers.
  "src/life/turn-shape.ts",
  "src/life/utterance.ts",
  "src/life/vitality.ts",
  "src/life/vitals-store.ts",
  "src/life/what-she-asked-for.ts",
  "src/life/what-she-asserted.ts",
  "src/life/write-whole.ts",
  // face-server.ts and voice-stream.ts paid theirs with S-70: the machine line in the room.
  "src/embodiment/pad-mapping.ts",
  "src/workspace/init.ts",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const TESTS = walk(join(ROOT, "test")).map((p) => ({ base: basename(p), text: readFileSync(p, "utf8") }));
/** Every `…test.ts` any scene names, by basename, the scenes spell paths inconsistently. */
const CITED = new Set([...SCENARIOS.matchAll(/`([^`]*\.test\.ts)`/g)].map((m) => basename(m[1])));

/** Is any test file that imports this module named by a scene? */
function reachedByAScene(rel: string): boolean {
  const stem = basename(rel, ".ts");
  if (CITED.has(`${stem}.test.ts`)) return true;
  // An import of the module, and only that: `.js` ending the name. A plain substring
  // test counted `life/continuity.json`, a data file a test merely names, as an import of
  // `continuity.ts`, and credited a scene with a module it never touches.
  const imported = new RegExp(`[/"]${stem.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\.js(?![A-Za-z])`, "u");
  return TESTS.some((t) => CITED.has(t.base) && imported.test(t.text));
}

const MODULES = HER_LAYERS.flatMap((d) =>
  readdirSync(join(ROOT, d)).filter((f) => f.endsWith(".ts")).map((f) => `${d}/${f}`));

// attention.ts and in-beats.ts left this list on 2026-08-23: S-66 cites in-beats.test.ts, which
// covers both, so the debt is paid by a scene rather than forgiven by an edit.
describe("a mechanism about what she is like is reached by a scene", () => {
  it("the instrument finds the scenes and the citations at all", () => {
    // Every check below is vacuously green against an empty citation set, which is exactly how
    // the previous blind spots in this repository looked from the outside.
    // A LOOSE floor on purpose. It is here to catch the extraction breaking, not to ratchet the
    // citation count: the checks below do that properly. Set to 15 at first, which is two below
    // the real 17, so removing two citations failed HERE with the message "the doc's format
    // changed". A guard that fires with the wrong diagnosis sends the next reader down the wrong
    // path, which costs more than the guard saves.
    expect(CITED.size, "no scene names any test file — the doc's format changed")
      .toBeGreaterThanOrEqual(10);
    expect(MODULES.length, "her layers stopped being found").toBeGreaterThan(90);
    expect(MODULES.filter(reachedByAScene).length, "no module is reachable from any scene")
      .toBeGreaterThan(15);
  });

  it("anything not on the frozen list is reached by a scene", () => {
    const orphans = MODULES.filter((m) => !PREDATES_THE_RULE.includes(m) && !reachedByAScene(m));
    if (orphans.length > 0) console.log(`\n  built with no scene:\n    ${orphans.join("\n    ")}`);
    expect(orphans, "write the scene that this mechanism exists to make possible, and cite the "
      + "test in it — the scene is supposed to come first").toEqual([]);
  });

  it("and the frozen list only shrinks", () => {
    // 75 when the list was frozen; 74 after S-32/S-33 gave `what-stays.ts` its scenes; 71 after
    // S-42 (her words for her feelings) reached part-of-herself.ts and state-diff.ts. It comes
    // down as scenes get written and never goes up. The ceiling had drifted to 15 above the list
    // (56 names under a ceiling of 71) by 2026-09-28, when S-70 paid three more; it now sits on
    // the list itself, so a single name added back turns this red. The same evening it rose by
    // exactly one, and not for an excuse: self-knowledge.ts had been miscounted as paid by a match
    // that read a `.json` file name as an import (see reachedByAScene).
    expect(PREDATES_THE_RULE.length, "the debt list grew — a new module was excused instead of "
      + "given a scene").toBeLessThanOrEqual(54);
  });

  it("a name stays on the list only while it is still owed", () => {
    // Both directions of rot. A module that got its scene must LEAVE the list, or the list stops
    // being a debt register and becomes a place to hide; a name whose file is gone is a record of
    // something that used to be true, which is the failure mode this project keeps meeting.
    const paid = PREDATES_THE_RULE.filter(reachedByAScene);
    expect(paid, "these now have scenes — take them off the list so the debt is the real one")
      .toEqual([]);
    const vanished = PREDATES_THE_RULE.filter((m) => !MODULES.includes(m));
    expect(vanished, "these modules no longer exist").toEqual([]);
  });

  it("the perception layer, which is what this rule was written for, is covered", () => {
    // Named rather than counted, because this is the specific debt that produced the rule.
    for (const m of ["src/life/how-he-sounds.ts", "src/life/aware-of-him.ts", "src/workspace/things.ts"]) {
      expect(reachedByAScene(m), `${m} was built with no scene, again`).toBe(true);
    }
  });
});
