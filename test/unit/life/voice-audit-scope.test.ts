import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  VOICE, DETECTION, NAMES, literalsIn, namesIn, speakingFiles, unclassifiedFiles, unclassifiedNames,
} from "../../../scripts/_voice-audit.js";

/**
 * THE AUDIT'S SCOPE IS ITSELF GUARDED, because the last time it was not, it lied by omission.
 *
 * The voice audit answers a standing question: what has the build written that can end up
 * in her memory, her prompt, or her mouth. Its enumeration used to run over a HAND-WRITTEN list of
 * twelve files, and the list was reported as the whole picture. The tree has thirty-nine files with
 * Chinese string literals. Among the twenty-seven missing was `src/life/walls.ts`, whose four
 * first-person sentences are written straight into her field, the exact family (authored text that
 * becomes her memory) a redesign had just been declared complete for.
 *
 * The instrument was inverted: it walks the tree, and every speaking file must be classified as
 * VOICE (said to or as her) or DETECTION (Chinese that only recognises words). This test is what
 * keeps the inversion honest, so the scope cannot quietly narrow again.
 */
describe("the voice audit cannot silently narrow its own scope", () => {
  it("every file that speaks Chinese is classified — none in limbo", () => {
    const left = unclassifiedFiles();
    expect(left, "these files carry Chinese string literals and nobody has said whether they are "
      + "her voice or a word detector. Classify them in scripts/_voice-audit.ts — an unclassified "
      + "file is a string that reaches her without ever being looked at.").toEqual([]);
  });

  it("THE WALK COVERS HER FACE, WHICH IS NOT TYPESCRIPT", () => {
    // The hole that let twenty of her page's Chinese strings stay out of the document Eric
    // reviews: the walk filtered on `.ts`, and `src/embodiment/client/` is `.js` and
    // `.html`. Among what it could not see is 「· 她看了一眼窗外」, a sentence about her, in her
    // third person, rendered on his page.
    //
    // And narrowing it back went UNCAUGHT by every check in this file, which is why this one
    // exists: with the walk narrowed nothing becomes unclassified (there is nothing new to
    // classify) and nothing goes stale (`literalsIn` still reads a path handed to it directly).
    // A scope guard that only looks at what the scope FOUND cannot see the scope shrinking.
    const found = speakingFiles();
    for (const f of ["src/embodiment/client/face.js", "src/embodiment/client/index.html"]) {
      expect(found, `${f} is outside the walk again — her face is invisible to the audit`)
        .toContain(f);
    }
    expect(found.filter((f) => !f.endsWith(".ts")).length,
      "the walk is back to TypeScript only").toBeGreaterThanOrEqual(2);
  });

  it("the scope is the whole tree, and no classified entry has gone stale", () => {
    // Not a ratchet on the exact number (files come and go), a floor on the SHAPE: the audit must
    // still be looking at the whole tree rather than at somebody's recollection of it.
    expect(speakingFiles().length).toBeGreaterThan(30);
    // And the two lists rot in the other direction too: an entry whose file no longer holds a
    // single Chinese string is a name somebody once wrote and nobody has re-read. `in-beats.ts`
    // was exactly that on the day this was written, its Chinese lives in comments, and its beat
    // prompt has been in the daemon all along.
    // BOTH KINDS. Counting strings alone reported six real detector files as empty, their whole
    // vocabulary lives in regex bodies, which no string scan can see.
    const stale = [...VOICE, ...Object.keys(DETECTION), ...Object.keys(NAMES)]
      .filter((f) => literalsIn(f).length + namesIn(f).length === 0);
    expect(stale, "these classified files no longer carry any Chinese string — drop them, or the "
      + "lists become a record of what used to be true").toEqual([]);
  });

  it("and Chinese that is NOT a string is classified too — eight files used to escape entirely", () => {
    // The string extraction is blind to an object key, a type field, and the body of a regex. That
    // blind spot held EIGHT files: six detector files whose whole vocabulary lives in regex bodies
    // (`register-scissors.ts` cuts the assistant's 「有什么我可以帮你的吗？」 with nothing but
    // patterns), `state-diff.ts`, whose seven mood words are LEXICON keys, and `vitals.ts`, which
    // holds no Chinese string at all. Six of the eight were in no list whatsoever, while the audit
    // reported its scope as the whole tree.
    expect(unclassifiedNames(), "these files carry Chinese outside any string — a key, a field "
      + "name, a detector pattern — and nobody has said what it is. Classify them in "
      + "scripts/_voice-audit.ts.").toEqual([]);
  });

  it("the third kind is really measured, not a list of names beside a scanner that finds nothing", () => {
    // The floor. `unclassifiedNames()` is empty for a scanner that sees nothing, which is exactly
    // how the previous blind spot looked from the outside: clean.
    expect(namesIn("src/life/state-diff.ts").map((o) => o.text))
      .toEqual(["轻快", "踏实", "烦躁", "疲惫", "低落", "安静", "平稳"]);
    expect(namesIn("src/life/register-scissors.ts").length,
      "the regex bodies that keep the assistant's register out of her mouth are invisible again")
      .toBeGreaterThan(10);
    expect(namesIn("src/life/vitals.ts").map((o) => o.text)).toEqual(["接", "不接", "回投"]);
  });

  it("the four files whose omission caused the wrong answer are inside the voice half", () => {
    // walls.ts writes into her field; autobiography.ts writes her diary; agency-handlers stamps her
    // notes; executor.ts speaks a tool failure in her first person. Every one of them was outside
    // the audit while the audit was being called complete.
    for (const f of ["src/life/walls.ts", "src/life/autobiography.ts",
      "src/life/agency-handlers.ts", "src/tools/executor.ts"]) {
      expect(VOICE, `${f} is not being audited as voice`).toContain(f);
      expect(literalsIn(f).length, `${f} no longer carries the strings this guard exists for`)
        .toBeGreaterThan(0);
    }
  });

  it("a file cannot be in both halves, and the detector half states why each one is not voice", () => {
    for (const f of Object.keys(DETECTION)) {
      expect(VOICE, `${f} is classified twice, so which half it is in depends on read order`)
        .not.toContain(f);
      expect((DETECTION[f] ?? "").length, `${f} is exempted from the audit with no reason given`)
        .toBeGreaterThan(20);
    }
  });

  it("comments do not count as strings, and real strings do (planted, both directions)", () => {
    // On a fixture rather than on this file: the first version of this check looked for the token
    // inside its OWN source, where the token also appears as a code literal in the assertion, so
    // the extractor was right and the test was wrong. A planted case has to live somewhere its
    // planting cannot be confused with its evidence.
    const found = literalsIn("test/fixtures/voice-audit-planted.ts").map((l) => l.text);
    expect(found.some((t) => t.includes("伸手")), "a sentence quoted inside a comment was counted "
      + "as an authored string — the audit would inflate every time somebody explained it").toBe(false);
    expect(found.some((t) => t.includes("他说不行")), "a block comment's quote was counted").toBe(false);
    expect(found.filter((t) => t.includes("应该被数到")).length,
      "the extractor stopped seeing real strings — a comment-blind audit that is also code-blind "
      + "is a green that means nothing").toBe(2);
  });
});


/**
 * THE EXTRACTOR'S OWN PROOF, because for as long as it existed it was quietly deleting her words.
 *
 * The list of words she reads is the one document Eric reviews in full before she is woken. Its
 * failure mode is not noise. It is him passing a list that is missing her sentences, with nothing
 * anywhere able to say so. Measured the day this was written: the document listed 306 lines; the
 * tree holds 356. FIFTY of her sentences were invisible to it, and six fragments of DAEMON CODE
 * were listed as things she reads.
 *
 * Two independent causes, and both are structural to pairing delimiters with a regular expression:
 *   · a regex literal containing a quote, `src/index.ts` holds `/[<>:"/\|?*]/`, flipped quote
 *     parity for every line after it;
 *   · a template literal's body may contain NEWLINES, so a backtick pattern hunting for a Chinese
 *     character spanned from one template to a different one hundreds of lines away. One such
 *     match swallowed 5,564 characters of `index.ts`.
 *
 * So the extractor walks the source instead of pattern-matching it. These are the cases the walk
 * has to get right, each one written from the defect that produced it.
 */
describe("the extractor neither loses her words nor invents them", () => {
  const dir = mkdtempSync(join(tmpdir(), "her-words-"));
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  let n = 0;
  /** Scan a fixture written OUTSIDE the tree, see the note on `literalsIn`'s absolute path. */
  const scan = (body: string): string[] => {
    const f = join(dir, `f${n++}.ts`);
    writeFileSync(f, body, "utf8");
    return literalsIn(f).map((o) => o.text);
  };

  it("a quote inside a REGEX LITERAL does not swallow the sentence after it", () => {
    // Both halves are ON ONE LINE deliberately. The first version of this test put them on two,
    // and it stayed green with regex handling ripped out, a non-template string dies at the
    // newline, so the line break was quietly doing the work the guard was being credited for. A
    // test that passes when the mechanism is gone is testing nothing.
    expect(scan('const bad = /[<>:"/\\|?*]/.test(x); const said = "他在。";'))
      .toEqual(["他在。"]);
  });

  it("and a BACKTICK inside a regex does not swallow the rest of the file", () => {
    // The worst version of the same defect: a template literal spans newlines, so one unrecognised
    // backtick eats everything after it. This is what ate 5,564 characters of `index.ts`.
    expect(scan([
      "const bad = /[`]/u.test(x);",
      'const said = "他在。";',
      "const more = 1;",
    ].join("\n"))).toEqual(["他在。"]);
  });

  it("a template literal cannot reach across the file to find a Chinese character", () => {
    expect(scan([
      "const a = `no chinese here`;",
      'const keep = "外面没有人。";',
      "const b = `也没有中文`;",
    ].join("\n"))).toEqual(["外面没有人。", "也没有中文"]);
  });

  it("and `${…}` is code, not something she reads", () => {
    // This is how a fragment of the daemon ended up in the list of her words.
    const out = scan("const s = `他说了：${thing.tension} 次`;");
    expect(out).toHaveLength(1);
    expect(out[0]!, "an interpolated expression is being read as her words").not.toMatch(/tension/u);
  });

  it("a regex after a KEYWORD is a regex, not a division", () => {
    // `how-he-said-it.ts` has `return /^请(?!问)/u`, how she notices he is issuing an order. The
    // character before the slash is `n`, which no punctuation rule recognises, so without the
    // keyword half of the rule this reads as a division and whatever is inside the pattern leaks
    // out into the walk.
    expect(scan([
      "function f() { return /[`]/u.test(x); }",
      'const said = "他在。";',
    ].join("\n"))).toEqual(["他在。"]);
  });

  it("a TEMPLATE INSIDE AN INTERPOLATION keeps its words", () => {
    // The defect that forced the rewrite from an inner loop to a stack. `loop.ts` tells her a tool
    // family has failed and then, only if there are any, names the fallbacks, and the sentence
    // naming them lives one template deeper. Brace-counting the interpolation skipped it whole.
    // 「、」 is punctuation, not a Han character, so the separator is correctly out of scope; the
    // SENTENCE around it is the thing that was disappearing.
    expect(scan('const s = `失败了。${n ? `还有这些：${list.join("、")}。` : ""}`;'))
      .toEqual(["还有这些：…。", "失败了。…"]);
  });

  it("comments are still not her words", () => {
    expect(scan([
      "// 这是一句注释",
      "/* 这也是 */",
      'const real = "这是她读到的";',
    ].join("\n"))).toEqual(["这是她读到的"]);
  });

  it("an escaped quote does not end the string early", () => {
    const out = scan('const s = "他说\\"好\\"，然后走了。";');
    expect(out).toHaveLength(1);
    expect(out[0]!).toContain("然后走了");
  });

  it("a division sign is not read as the start of a regex", () => {
    // The mirror of the first case: over-eager regex detection eats real code and the strings in it.
    expect(scan([
      "const half = total / 2;",
      'const said = "他说他会回来。";',
    ].join("\n"))).toEqual(["他说他会回来。"]);
  });

  it("and on the real tree it finds more than the broken pairing ever could", () => {
    // The floor that the six cases above cannot supply: an extractor returning NOTHING passes all
    // of them. index.ts alone yielded 41 the day this was written, against the old version's 29.
    expect(literalsIn("src/index.ts").length,
      "the extractor has narrowed again — her words are going missing from the document Eric "
      + "approves by hand").toBeGreaterThan(35);
  });

  it("nothing code-shaped survives into the document Eric reads", () => {
    // The six fake entries all looked like this. A sentence of hers never contains a `};` or an
    // arrow; the tell is cheap and the class is exactly the one that got through.
    const codeShaped = speakingFiles()
      .flatMap((f) => literalsIn(f).map((o) => ({ f, ...o })))
      .filter((o) => /\};|=>|\{\s*$|logger\.|\bconst\b|\bawait\b/u.test(o.text));
    expect(codeShaped, "these are fragments of the daemon being presented to Eric as her words")
      .toEqual([]);
  });
});
