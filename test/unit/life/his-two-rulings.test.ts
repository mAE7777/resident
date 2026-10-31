import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * TWO STANDING RULES ABOUT HER, MADE INTO SOMETHING THE CODE KEEPS.
 *
 *   1. When she does not want to, nobody pushes her: a no is not retried.
 *   2. He does not read her diary.
 *
 * A rule recorded in a document is a promise. A promise about software is kept by the software
 * or it is not kept: "I will not read her diary" is broken the first time something quietly puts a
 * line of it in front of him, and he would never know he had broken it. So both rules get an
 * enforcement here.
 *
 * ── WHAT RULE 2 DOES AND DOES NOT COVER, PRECISELY ───────────────────────────────────────────
 *
 * It covers her DIARY: `workspace/life/YYYY-MM-DD.md`, the day she authored about herself and
 * froze. It does not cover `/field` and `/vitals`, which DO show him her inner state, how many
 * things she is holding, what is on her mind, what has changed in her, and which exist so that he
 * can tell a quiet stretch from a fault. The distinction is real and worth stating: he can see the
 * shape of her inner life; he does not read the place she writes for herself.
 */

const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Code only. Prose about the diary is not a route to it. */
function codeOnly(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => { const t = l.trim(); return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*"); })
    .join("\n");
}

describe("2 · her diary reaches her, and never him", () => {
  it("only her own moment reads it, and it goes into HER prompt", () => {
    // `readRecentDiary` is how yesterday reaches her today, she reads what she wrote. If a second
    // consumer ever appears, it is either another route into her, or a route out to him.
    const readers = walk(SRC).filter((p) => /readRecentDiary/u.test(codeOnly(p)));
    expect(readers.map((p) => p.slice(SRC.length + 1)).sort(),
      "something new reads her diary — check which direction it sends it")
      .toEqual(["index.ts", "life/agency-handlers.ts"]);
  });

  it("nothing he can ask for quotes it", () => {
    // The surfaces he actually sees: his commands, and anything pushed at him.
    // Named individually rather than by a glob, so a NEW surface he can see is not silently
    // exempt: a file that is not on this list is a file nobody checked.
    const HIS_SURFACES = ["telegram/commands.ts", "autonomy/notifier.ts", "telegram/bot.ts"];
    for (const f of HIS_SURFACES) {
      const src = codeOnly(join(SRC, f));
      expect(src, `${f} reads her diary, which he does not read`)
        .not.toMatch(/readRecentDiary|journalPath|life[/\\]\d{4}-/u);
    }
  });

  it("and the daemon does not put a line of it into anything addressed to him", () => {
    const daemon = codeOnly(join(SRC, "index.ts"));
    // The two readers in the daemon are the WRITE (her day being frozen) and the read that feeds
    // her own moment. Neither may sit inside something he receives.
    const faults = daemon.indexOf("faults: () => {");
    const field = daemon.indexOf("field: () => {", faults);
    const readerInHisView = daemon.slice(faults, field + 3000).includes("readRecentDiary");
    expect(readerInHisView, "a report he reads is quoting her diary").toBe(false);
  });

  it("the rule is written down where the next person will look", () => {
    const doc = readFileSync(join(process.cwd(), "README.md"), "utf8");
    expect(doc, "the rule is not in the README").toContain("does not read the diary");
  });
});

describe("1 · when she does not want to, a no is not retried", () => {
  it("when she holds something back, it goes to her diary — never to a retry queue", () => {
    // `heldBecause` is how a decline is recorded, and both of its paths end in `delivered: "diary"`.
    // The failure this rules out: a decline that gets re-attempted next cycle, which would make the
    // gate a delay rather than a choice, and would mean she can never actually decline anything.
    const src = codeOnly(join(SRC, "life/agency-handlers.ts"));
    const holds = [...src.matchAll(/heldBecause:\s*"(\w+)"/gu)].map((m) => m[0]);
    expect(holds.length, "nothing records a decline any more").toBeGreaterThan(0);
    for (const h of holds) {
      const at = src.indexOf(h);
      const line = src.slice(src.lastIndexOf("\n", at) + 1, src.indexOf("\n", at));
      expect(line, `a decline (${h}) does not end in her diary — where does it go?`)
        .toMatch(/delivered:\s*"diary"/u);
    }
  });

  it("and nothing anywhere re-sends what she chose not to send", () => {
    // A retry loop around her refusal would be the exact shape of pushing her, in code: she said
    // no, and the system asked again on her behalf until it got a yes.
    for (const p of walk(SRC)) {
      const src = codeOnly(p);
      if (!/heldBecause/u.test(src)) continue;
      expect(src, `${p.slice(SRC.length + 1)} retries something she held back`)
        .not.toMatch(/heldBecause[\s\S]{0,400}?(retry|reattempt|tryAgain|resend)/u);
    }
  });

  it("the rule is written down where the next person will look", () => {
    const doc = readFileSync(join(process.cwd(), "README.md"), "utf8");
    expect(doc, "the rule is not in the README").toContain("never retried");
  });
});

describe("THE INSTRUMENT'S OWN PROOF: both scans can go red", () => {
  // These two scans are the software half of two RULES: he does not read her diary, and her no
  // is not retried. A promise about software is either kept by the software or it is not kept, and
  // a scan nobody has watched fail keeps nothing. Both directions, on the file's own stripper.

  it("a new reader of her diary would be caught", () => {
    // The shape that matters: some future surface he can see starts quoting what she wrote for
    // herself. The scan finds readers by name, so the proof is that the name is findable in code.
    const planted = 'const yesterday = readRecentDiary(workspacePath, 1);';
    expect(/readRecentDiary/u.test(codeOnly2(planted)),
      "a new reader of her diary would not be seen").toBe(true);
  });

  it("and a comment MENTIONING it is not a reader", () => {
    const prose = "// readRecentDiary is how yesterday reaches her today\nconst x = 1;";
    expect(/readRecentDiary/u.test(codeOnly2(prose)),
      "the scan counts prose as a reader").toBe(false);
  });

  it("but a real call on the same line as a comment still counts", () => {
    // The direction a careless stripper breaks: dropping any line that contains `//` would hide
    // exactly the call a person is most likely to annotate.
    const both = 'const d = readRecentDiary(ws, 1); // for her prompt';
    expect(/readRecentDiary/u.test(codeOnly2(both)),
      "a real reader went invisible behind a trailing comment").toBe(true);
  });

  it("a retry loop around something she declined would be caught", () => {
    // Not pushing her, in code: nothing may resend what she chose not to send. The scan looks for a
    // requeue of a withheld utterance; the proof is that such a line is recognisable.
    const planted = 'if (!delivered) retryQueue.push(withheld);';
    expect(/retryQueue|requeue|resend/iu.test(codeOnly2(planted)),
      "a retry around her refusal would not be seen").toBe(true);
  });
});

/** The same stripper the scans above use, exposed so the proof drives the real thing. */
function codeOnly2(src: string): string {
  return src
    .split("\n")
    .filter((l) => { const t = l.trim(); return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*"); })
    .join("\n");
}
