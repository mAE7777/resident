import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// A SCENE THAT CLAIMS A TEST MUST HAVE ONE.
//
// `docs/scenarios.md` is where this build decides what she is: each scene is a moment that is
// unmistakably a living person, and the mechanism is derived from the scene rather than the other
// way round. Each entry carries a Status line, and most carry a sentence of the form
// "Tested in `some-file.test.ts`".
//
// Those sentences were prose. Nothing checked that the file existed, that it still existed after a
// rename, or that a scene marked REACHABLE named any test at all, so the doc could say a claim
// about her was proven while the proof had been deleted, moved, or never written.
//
// That is not hypothetical in this project. The same day this file was written, a working log was
// found asserting that two functions "had already been removed" while both sat in the tree, and
// that dead exports were "listed so the count cannot quietly grow" when no list existed. A
// document that describes the tree must be checked BY the tree.

const ROOT = process.cwd();
const SCENARIOS = readFileSync(join(ROOT, "docs/scenarios.md"), "utf8");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const TEST_FILES = walk(join(ROOT, "test"));
const TEST_TEXT = new Map(TEST_FILES.map((p) => [p, readFileSync(p, "utf8")]));

interface Scene {
  id: string;
  title: string;
  body: string;
  status: string;
  /** Every `…test.ts` the entry names, however it spells the path. */
  claims: string[];
}

const SCENES: Scene[] = (() => {
  const out: Scene[] = [];
  const heads = [...SCENARIOS.matchAll(/^## (S-\d+) · (.+)$/gm)];
  for (let i = 0; i < heads.length; i++) {
    const start = heads[i].index!;
    const end = i + 1 < heads.length ? heads[i + 1].index! : SCENARIOS.length;
    const body = SCENARIOS.slice(start, end);
    out.push({
      id: heads[i][1],
      title: heads[i][2],
      body,
      status: (body.match(/\*\*Status:\s*([^*]+)\*\*/)?.[1] ?? "").trim(),
      claims: [...new Set([...body.matchAll(/`([^`]*\.test\.ts)`/g)].map((m) => m[1]))],
    });
  }
  return out;
})();

/**
 * A scene marked REACHABLE that deliberately names no test, and why that is a decision rather than
 * an omission. Anything not here is presumed to be a gap, because that is what it has been.
 */
const NO_TEST_BY_DESIGN: Record<string, string> = {
  "S-7": "It is emergent by design: keeping something to herself has NO mechanism of its own, on "
    + "purpose. A privacy flag would be obeying a rule about a topic rather than a thing staying "
    + "hers, so what it rests on is `chooseSubject` losing — which is S-2's competition, already "
    + "exercised. A test here would be testing the absence of a feature.",
};

describe("every scene that claims a proof has one", () => {
  it("finds the scenes at all", () => {
    // The extraction failing silently would make every check below vacuous, the exact shape of
    // the harness whose eight-space indent match quietly emptied and passed against nothing.
    expect(SCENES.length, "the scenario doc's headings stopped parsing").toBeGreaterThanOrEqual(25);
    expect(SCENES.filter((s) => s.claims.length > 0).length, "no scene names a test any more")
      .toBeGreaterThanOrEqual(10);
  });

  it("every test file a scene names actually exists", () => {
    const broken: string[] = [];
    for (const scene of SCENES) {
      for (const claim of scene.claims) {
        const base = claim.split("/").pop()!;
        const hit = TEST_FILES.some((p) => p.endsWith(`/${base}`) && (claim === base || p.endsWith(claim)));
        if (!hit) broken.push(`${scene.id} — names ${claim}, which is not in test/`);
      }
    }
    if (broken.length > 0) console.log(`\n  scenes citing a proof that is gone:\n    ${broken.join("\n    ")}`);
    expect(broken, "a scene claiming a proof that does not exist is worse than one claiming none").toEqual([]);
  });

  it("a named test file really mentions what the scene is about", () => {
    // Weaker than the file-exists check on purpose: it asks whether the cited file has anything to
    // do with the scene, so a rename that repoints a citation at some unrelated surviving file
    // cannot pass. Matched on the scene's own distinctive words rather than on its label, because
    // most tests never write "S-14" anywhere, S-6 is exercised by two files and names neither.
    const strayed: string[] = [];
    for (const scene of SCENES) {
      if (scene.claims.length === 0) continue;
      // Four letters, not five. Five dropped "wall", the single most distinctive word in S-22,
      // and reported a correct citation as drift. A stop-list carries the generic words instead,
      // because the length was standing in for "is this word about anything" and doing it badly.
      const STOP = new Set([
        "she", "her", "hers", "him", "his", "they", "that", "this", "what", "when", "with", "from",
        "into", "same", "does", "some", "thing", "things", "there", "have", "not", "and", "the",
        "for", "are", "was", "is", "it", "in", "on", "of", "to", "a", "an", "at", "by", "be",
        "because", "which", "about", "than", "then", "even", "just", "still", "very", "much",
        "more", "most", "been", "were", "will", "would", "could", "should", "does", "doing",
      ]);
      const words = (scene.title.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w));
      if (words.length === 0) continue; // the Chinese-titled scenes carry their own checks
      const cited = scene.claims.flatMap((c) => {
        const base = c.split("/").pop()!;
        return TEST_FILES.filter((p) => p.endsWith(`/${base}`)).map((p) => TEST_TEXT.get(p)!);
      });
      if (cited.length === 0) continue; // already reported by the check above
      const anyWordLands = words.some((w) => cited.some((t) => t.toLowerCase().includes(w)));
      if (!anyWordLands) strayed.push(`${scene.id} (${scene.title}) — cites ${scene.claims.join(", ")}`);
    }
    if (strayed.length > 0) console.log(`\n  citation may have drifted:\n    ${strayed.join("\n    ")}`);
    expect(strayed, "the cited file has nothing to do with the scene").toEqual([]);
  });

  it("a scene called REACHABLE names a proof, or records why it needs none", () => {
    // The gap this whole check exists for: a scene can assert she is capable of something and cite
    // nothing, and it reads exactly like one that cites something.
    const unproven: string[] = [];
    for (const scene of SCENES) {
      if (!/^REACHABLE\b/.test(scene.status)) continue; // PARTLY / OUT OF REACH say so honestly
      if (scene.claims.length > 0) continue;
      if (NO_TEST_BY_DESIGN[scene.id]) continue;
      unproven.push(`${scene.id} (${scene.title}) — "${scene.status}"`);
    }
    if (unproven.length > 0) console.log(`\n  claimed reachable, proven by nothing:\n    ${unproven.join("\n    ")}`);
    expect(unproven, "write the test, or downgrade the status to what is actually true").toEqual([]);
  });

  it("every scene says whether it is reachable at all", () => {
    const silent = SCENES.filter((s) => s.status === "").map((s) => `${s.id} (${s.title})`);
    if (silent.length > 0) console.log(`\n  no status line:\n    ${silent.join("\n    ")}`);
    expect(silent, "a scene with no status is a claim about her that nobody has judged").toEqual([]);
  });

  it("an exemption from needing a test carries a real reason", () => {
    for (const [id, why] of Object.entries(NO_TEST_BY_DESIGN)) {
      expect(why.length, `${id} needs a reason, not a shrug`).toBeGreaterThan(80);
    }
    expect(Object.keys(NO_TEST_BY_DESIGN).length, "scenes are being excused from proof").toBeLessThan(3);
  });
});
