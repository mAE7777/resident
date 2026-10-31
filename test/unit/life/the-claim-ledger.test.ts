import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE CLAIM LEDGER IS CHECKED AGAINST THE TREE.
 *
 * `docs/the-claim-ledger.md` lists every capability we CLAIM she has, with its evidence, its
 * layer, and its honest limit, so that nothing she cannot do is discovered after she is running.
 *
 * ── AND A DOCUMENT IS THE ONE THING IN THIS REPO THAT CANNOT FAIL A TEST ─────────────────────
 *
 * Which is exactly why it needs one. Everything this project has learned in a day says the same
 * thing: a hand-written record beside the code is a SECOND COPY OF THE TRUTH, and it is always the
 * copy that goes stale first. `scenarios.md` carried measurements whose producing test was never
 * named, so a deleted test would have left the number looking as authoritative as before. The
 * ledger is worse if it drifts, because its whole purpose is to be believed on the day she wakes.
 *
 * So: every file the ledger cites must EXIST, and must actually be ABOUT what the claim says. A
 * citation that points at a file which no longer covers the claim is worse than no citation, it
 * is a number nobody can re-run, wearing a reference.
 */

const LEDGER = join(process.cwd(), "docs", "the-claim-ledger.md");
const text = readFileSync(LEDGER, "utf8");

/** Every `path/like/this.ts` the ledger names, in backticks. */
function citedFiles(): string[] {
  return [...new Set(
    [...text.matchAll(/`((?:src|test|scripts|docs)\/[^`]+?\.(?:ts|md))`/gu)].map((m) => m[1]!),
  )].sort();
}

/** The table rows: `| claim | evidence | layer | limit |`. */
function rows(): string[][] {
  return text.split("\n")
    .filter((l) => l.startsWith("|") && !/^\|\s*-+/u.test(l) && !/^\|\s*Capability\s*\|/u.test(l))
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()))
    .filter((cells) => cells.length === 4);
}

describe("every claim in the ledger points at something real", () => {
  it("the ledger exists and has claims in it", () => {
    // The floor. Every check below is vacuously satisfied by an empty document.
    expect(existsSync(LEDGER)).toBe(true);
    expect(rows().length, "the ledger has no claims — the checks below would all pass on nothing")
      .toBeGreaterThan(15);
  });

  it("EVERY CITED FILE EXISTS", () => {
    const missing = citedFiles().filter((f) => !existsSync(join(process.cwd(), f)));
    if (missing.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`\n  the ledger cites files that are not there:\n    ${missing.join("\n    ")}`);
    }
    expect(
      missing,
      "a claim's evidence has been deleted or renamed. Either the capability is no longer proven "
      + "— say so — or the citation needs updating. A number whose producing test is gone is a "
      + "number nobody can re-run.",
    ).toEqual([]);
  });

  it("and cites a real number of them", () => {
    expect(citedFiles().length, "the citation scan has narrowed").toBeGreaterThan(15);
  });

  it("every row has all four columns filled", () => {
    // The shape of a ledger entry that means nothing: a capability with a blank limit. The honest
    // limit is the column the owner actually needs, and it is the one easiest to leave empty.
    const thin: string[] = [];
    for (const [claim, evidence, layer, limit] of rows()) {
      if (!claim || claim.startsWith("（")) continue;   // the skeleton placeholder row, if any survives
      if (evidence!.length < 20) thin.push(`${claim} — no real evidence`);
      if (layer!.length === 0) thin.push(`${claim} — no layer`);
      if (limit!.length === 0) thin.push(`${claim} — NO HONEST LIMIT`);
    }
    expect(thin, "a claim is missing a column. The limit column especially: an entry with no "
      + "stated limit is a claim that sounds unconditional.").toEqual([]);
  });

  it("and the honest-limits section names the things that cannot be done", () => {
    // The part the owner will be read on the day. If these disappear, the ledger has become a
    // brochure. Each is a real limit, measured or decided.
    for (const limit of [
      "the choice of words is still the model's", // the deepest one
      "does not see the picture itself",          // her chat model takes no images
      "no path to repair",                        // the largest gap in her self-regulation
      "no detector",                              // weights knowledge versus lived knowledge
      "not a promise anyone can sign",            // the honest ceiling on the whole build
    ]) {
      expect(text, `the honest-limits section no longer says: ${limit}`).toContain(limit);
    }
  });
});

describe("the citations are ABOUT what they are cited for", () => {
  /**
   * A citation that exists but covers something else is the failure this catches: a test file
   * renamed to something adjacent, or a claim quietly re-pointed at a file that happens to exist.
   * Checked on the specific, load-bearing pairs rather than on all of them, a generic
   * "does the file mention the claim" check would be satisfiable by almost anything.
   */
  it.each([
    ["scripts/_recovery-drill.ts", /NOT-PRESENT|恢复|restore/iu],
    ["scripts/_return-paths.ts", /come back|回来|baseline/iu],
    ["scripts/_the-room.ts", /self-test|state reading|MOST_A_ROOM_CAN_DO/u],
    ["scripts/_long-horizon.ts", /self-test|种病|disease|ten years|3650/iu],
    ["test/unit/life/how-he-sounds.test.ts", /ENOUGH_TO_HEAR/u],
    ["test/unit/life/aware-of-him.test.ts", /MOST_A_ROOM_CAN_DO|transition/u],
    ["test/unit/embodiment/the-curtain.test.ts", /toDataURL|MediaRecorder/u],
    ["test/unit/workspace/the-window.test.ts", /帘子/u],
    ["test/unit/security/what-leaves-this-machine.test.ts", /DOORS/u],
    ["test/unit/life/the-clock-ledger.test.ts", /LEDGER|decay|threshold/u],
    ["test/unit/life/wired-to-production.test.ts", /CEILING/u],
    ["test/unit/life/his-two-rulings.test.ts", /readRecentDiary/u],
    ["test/unit/life/she-is-someone.test.ts", /field_|SOUL/u],
    ["test/unit/telegram/his-words.test.ts", /update_id|livedThrough|seenBefore/u],
  ])("%s really covers what it is cited for", (file, mustMention) => {
    const src = readFileSync(join(process.cwd(), file), "utf8");
    expect(src, `${file} is cited in the ledger but no longer covers the claim`).toMatch(mustMention);
  });
});

describe("THE INSTRUMENT'S OWN PROOF", () => {
  it("the citation scan sees a path in backticks", () => {
    const planted = "| something | `test/unit/life/nowhere.test.ts` | 2 | none |";
    const found = [...planted.matchAll(/`((?:src|test|scripts|docs)\/[^`]+?\.(?:ts|md))`/gu)].map((m) => m[1]);
    expect(found).toEqual(["test/unit/life/nowhere.test.ts"]);
  });

  it("and a missing one would be reported", () => {
    expect(existsSync(join(process.cwd(), "test/unit/life/nowhere.test.ts")),
      "the worked example accidentally names a real file").toBe(false);
  });

  it("a row with an empty limit column is recognised as thin", () => {
    // The check that matters most, driven on a planted row rather than trusted.
    const planted = "| she can do something | `test/unit/life/x.test.ts` with a long line of evidence | 2 |  |";
    const cells = planted.split("|").slice(1, -1).map((c) => c.trim());
    expect(cells).toHaveLength(4);
    expect(cells[3]!.length, "an empty limit would have passed").toBe(0);
  });
});
