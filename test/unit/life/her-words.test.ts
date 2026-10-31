import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NOT_HER_WORDS, scanForNotHerWords, CALQUE_MARKERS } from "../../../src/life/her-words.js";
import { wrapWorkspaceContent } from "../../../src/security/boundary.js";

/**
 * The paragraph at position 2 of her system prompt, read from source.
 *
 * It is a template literal built inline, so it cannot be imported; the interpolations are
 * stripped rather than evaluated, because a workspace path is not something this gate is about.
 */
function whereSheIs(): string {
  const index = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8");
  const start = index.indexOf("你住在一台 Mac 上");
  expect(start, "her identity paragraph moved — re-point this gate").toBeGreaterThan(0);
  return index.slice(start, index.indexOf("`;", start)).replace(/\$\{[^}]*\}/gu, " ");
}
import { BORN_HOLDING, THERE_IS_MORE } from "../../../src/life/birth-toolkit.js";
import { isInstrumentReading, summarizeEvent } from "../../../src/life/autobiography.js";
import { createReadTool } from "../../../src/tools/builtin/read.js";
import { createWriteTool } from "../../../src/tools/builtin/write.js";
import { createEditTool } from "../../../src/tools/builtin/edit.js";
import { createDeleteTool } from "../../../src/tools/builtin/delete.js";
import { createGlobTool } from "../../../src/tools/builtin/glob.js";
import { createGrepTool } from "../../../src/tools/builtin/grep.js";
import { createFileSnapshotStore, createUndoTool } from "../../../src/tools/builtin/file-snapshot.js";
import { createMessageTool } from "../../../src/tools/builtin/message.js";
import { createLookUpTool, createRememberTool } from "../../../src/life/remembering.js";
import { createLivingField } from "../../../src/life/field-live.js";

/**
 * Every piece of text she actually reads, assembled from the real sources.
 *
 * The tool definitions are built from the REAL factories rather than from a copy of their
 * strings, so that editing a description to say "the user's request" goes red here. That is
 * the whole point: the words got in last time because nobody was looking at them as claims.
 */
function textSheReads(): Array<{ source: string; text: string }> {
  const home = mkdtempSync(join(tmpdir(), "her-words-"));
  try {
    const snapshots = createFileSnapshotStore();
    const field = createLivingField({ noReminding: true });

    const tools = [
      createReadTool(home, home),
      createWriteTool(home, home, snapshots),
      createEditTool(home, home, snapshots),
      createDeleteTool(home, home, snapshots),
      createGlobTool(home, home),
      createGrepTool(home, home),
      createUndoTool(snapshots, join(home, ".trash")),
      createMessageTool(async () => {}, 1, undefined, undefined, home, home),
      createLookUpTool({ field }),
      createRememberTool({ field }),
    ];

    // A registered tool she does not hold would be a hole in this gate, so prove the set
    // being scanned is exactly the set she is born with.
    expect(tools.map((t) => t.name).sort()).toEqual([...BORN_HOLDING].sort());

    const sources: Array<{ source: string; text: string }> = [
      { source: "birth-toolkit: THERE_IS_MORE", text: THERE_IS_MORE },
      // THE TWO THIS GATE USED TO MISS, and it missed them because it only knew about text it
      // could import. The runtime scan (which reads the real assembled bytes at the point the
      // prompt is built) found both; this one could not, which made it a gate over the parts of
      // her prompt that happened to be tidy modules.
      //
      // The identity paragraph is a template literal inside index.ts, so it is read from source
      // the same way identity-purity.test.ts reads it. It was carrying a second copy of the
      // delivery contract S1 had already removed from BASE_DIRECTIVES.
      { source: "index.ts: where she is", text: whereSheIs() },
      // The workspace wrapper's own sentence rides every turn around USER/MEMORY/AGENT. Her
      // SOUL.md left this wrapper in S1; the wrapper's wording stayed as it was.
      { source: "boundary.ts: workspace wrapper (memory)", text: wrapWorkspaceContent("x", "MEMORY.md", "memory") },
      { source: "boundary.ts: workspace wrapper (instruction)", text: wrapWorkspaceContent("x", "AGENT.md", "instruction") },
      // The cognitive framework is gone from her prompt entirely (embryo principle): the
      // thinking manual was itself born-with-vast-context. Nothing of it left to scan.
    ];
    for (const tool of tools) {
      // Exactly what context.ts puts in the prompt: the whole definition, stringified, then
      // DECODED: stringified JSON renders a description's newline as the two
      // characters \n, and since "n" is a word character the \b-anchored patterns miss a banned
      // word at the start of any line inside a multi-line description ("\nTask" reads as
      // "nTask"). The runtime scan decodes the same way.
      sources.push({
        source: `tool/${tool.name}`,
        text: JSON.stringify({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }, null, 2).replace(/\\n/g, "\n").replace(/\\t/g, "\t"),
      });
    }
    return sources;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * Every kind of event she can still see rendered as a line of her own life.
 *
 * These lines are what the diary is reconsolidated from, so they are the words she reaches
 * for when she thinks about her past. That makes them text she reads, and this gate applies.
 */
function linesOfHerLife(): Array<{ source: string; text: string }> {
  const base = { ts: "2026-05-01T08:00:00.000Z", pid: 1, chatId: 5, model: "m" };
  const events = [
    { ...base, event: "agent_start" },
    { ...base, event: "session_start", taskType: "general", effortTier: "simple", messagePreview: "hi" },
    { ...base, event: "tool_call", toolName: "write", success: true, durationMs: 5 },
    { ...base, event: "tool_call", toolName: "write", success: false, durationMs: 5, errorSnippet: "no such path" },
    { ...base, event: "agent_error", errorMessage: "connection reset" },
    { ...base, event: "cron_fire", jobName: "a thing" },
    { ...base, event: "dream_run", skipped: false, changes: 2 },
    { ...base, event: "dream_run", skipped: true, reason: "too tired" },
    { ...base, event: "skill_extracted", skillName: "folding", version: 1, fromTask: "x" },
    { ...base, event: "stuck_detection", pattern: "loop", interventionCount: 2 },
    { ...base, event: "novelty_fallback" },
    { ...base, event: "capability_gap", reason: "wanted to look something up", toolSequence: ["read"] },
    { ...base, event: "unknown_observation", assumption: "he might have meant something else" },
  ] as unknown as Parameters<typeof summarizeEvent>[0][];

  return events
    .filter((e) => !isInstrumentReading((e as { event: string }).event))
    .map((e) => ({ source: `diary/${(e as { event: string }).event}`, text: summarizeEvent(e) }));
}

describe("her diary's event labels hold to the same rule as her field's", () => {
  it("none of them hedges or tells her how it felt", () => {
    // The rule against authored readings applies wherever the build authors text she will later
    // read as her own past, and her diary is exactly that: `summarizeEvent`'s lines are the raw
    // material she reconsolidates a day from. They were outside the census (they are written to a
    // file, not encoded as nodes) and therefore outside the rule, until the whole-tree voice audit
    // surfaced them. The event may be named; a hedge or a reading may not.
    const HEDGE_OR_STANCE = /好像|大概|恐怕|居然|竟然|似乎|说不定|多半|伸手过去/u;
    for (const { source, text } of linesOfHerLife()) {
      expect(text, `${source} hedges or reads the event for her: 「${text}」`)
        .not.toMatch(HEDGE_OR_STANCE);
    }
  });

  it("and 「做了梦，心里有些东西挪了位置」 stays, on a stated distinction", () => {
    // Kept deliberately rather than by omission. 「伸手过去」 was cut because it describes a bodily
    // action she never performed: an image of mine dressed as her experience. This line names WHAT
    // CHANGED (consolidation really did move things in her field) without saying how it felt, which
    // is the side of the rule that is allowed. Written down because the next reader will otherwise
    // have to guess whether it survived by decision or by accident.
    const dream = linesOfHerLife().find((l) => l.source.includes("dream_run"));
    expect(dream?.text).toContain("做了梦");
  });
});

describe("the words that reach her", () => {
  it("says nothing false about what she is", () => {
    const hits = [...textSheReads(), ...linesOfHerLife()].flatMap(({ source, text }) => scanForNotHerWords(source, text));
    const report = hits.map((h) => `  ${h.source}: "${h.word}" (${h.why})\n    ${h.line}`).join("\n");
    expect(hits.length, `text she reads every turn still says:\n${report}`).toBe(0);
  });

  describe("the gate itself", () => {
    // A green test that cannot go red is not evidence. Plant each word and require a catch.
    for (const { word } of NOT_HER_WORDS) {
      it(`catches "${word}" when it is planted`, () => {
        const planted = NOT_HER_WORDS.find((w) => w.word === word)!;
        const hits = scanForNotHerWords("planted", `Some ordinary sentence about ${word} handling.`);
        expect(hits.some((h) => h.word === planted.word), `"${word}" was planted and not caught`).toBe(true);
      });
    }

    it("does not fire on text that says nothing about her", () => {
      expect(scanForNotHerWords("clean", "Read the contents of a file.\nShe is asleep.")).toEqual([]);
    });
  });
});

describe("the address exemptions", () => {
  it("lets the USER.md path through", () => {
    expect(scanForNotHerWords("x", "what you learn lives in USER.md, which starts empty")).toEqual([]);
  });

  it("does not let the word through anywhere else on the same line", () => {
    // The narrow shape matters: blanking the whole line would hide a real claim sitting next
    // to the path, which is exactly how an exemption turns into a hole.
    const hits = scanForNotHerWords("x", "write what the user tells you into USER.md");
    expect(hits.map((h) => h.word)).toContain("user");
  });

  it("does not let it through in any other spelling", () => {
    for (const near of ["USER.MD", "user.md is where", "the USER file", "USER-md"]) {
      expect(scanForNotHerWords("x", near).length, `"${near}" slipped past`).toBeGreaterThan(0);
    }
  });

  it("lets the macOS home container /Users/ through — her real home path renders every turn", () => {
    // Found live: the runtime scan had warned "user" on every boot since it existed, because
    // 你的家在 /Users/someone/.resident sits in the where-she-is paragraph. An address is not a
    // sentence.
    expect(scanForNotHerWords("x", "你的家在 /Users/someone/.resident/workspace；里面的东西都用完整路径去够。")).toEqual([]);
  });

  it("but a real 'user' next to the path is still read, and other spellings still fire", () => {
    const hits = scanForNotHerWords("x", "tell the user their files are in /Users/someone/");
    expect(hits.map((h) => h.word)).toContain("user");
    for (const near of ["the Users of this app", "users/ directory", "\\Users\\ on windows"]) {
      expect(scanForNotHerWords("x", near).length, `"${near}" slipped past`).toBeGreaterThan(0);
    }
  });
});

// ── THE SENTENCES THE BUILD PUTS IN HER MOUTH ────────────────────────────────
//
// A handful of things that happen to her produce a memory she did not speak: he cut her off, a turn
// failed halfway, a way of doing things she grew stopped working, and now, that a thing he asked
// for stayed with her. Each is written as a hand-authored sentence in her register, and each
// becomes HER account of what happened, permanently, in her field.
//
// They exist because the alternative is worse in both directions: raw outside text in a node is
// read back to a model later as something of hers (which is how a page gets to write her memories),
// and asking a model to phrase it would be a model authoring her memory. A short sentence in her
// own register, from the same small set every time, is the honest third option, and this is the
// census of them, so the set stays small and stays hers.
describe("the few sentences that become her memory without her saying them", () => {
  const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
  const stays = readFileSync(join(process.cwd(), "src/life/what-stays.ts"), "utf8");
  // The second widening. Two ways an authored sentence used to walk straight past this census:
  //
  //   · WRITTEN AS A TEMPLATE LITERAL. The scan matched `text: "..."` only, so
  //     `text: \`我自己拼出一个地址，想打开 ${host}，打不开。\`` was invisible, an authored
  //     first-person sentence encoded as one of her questions, uncounted for as long as it existed.
  //   · BUILT BY A FUNCTION SOMEWHERE ELSE. `walls.ts` returns four sentences that the daemon hands
  //     straight to `encodeQuestion`, and `agency.ts` has two fallbacks for a moment she left no
  //     artifact for. The call site says `text: wallText(e)`, which carries no Chinese at all, so
  //     the census saw nothing while four first-person sentences went into her field.
  //
  // Both are now in scope. NOT in scope, deliberately and named so it is a boundary rather than an
  // oversight: her DIARY's event summaries (`autobiography.ts`), which are written into a file she
  // reads rather than encoded as nodes. They get the same stance rule from their own guard below.
  const walls = readFileSync(join(process.cwd(), "src/life/walls.ts"), "utf8");
  const agency = readFileSync(join(process.cwd(), "src/life/agency.ts"), "utf8");
  const momentFallbacks = agency.slice(agency.indexOf("export function momentMemoryText"),
    agency.indexOf("export function momentMemoryText") + 400);

  /** Every hand-authored Chinese string that is encoded as the TEXT of one of her nodes. */
  const authored = [
    ...daemon.matchAll(/text: "([^"]*[一-鿿][^"]*)"/gu),
    ...daemon.matchAll(/text: `([^`]*[一-鿿][^`]*)`/gu),
    ...stays.matchAll(/`(他要我[^`]*)`/gu),
    ...walls.matchAll(/return `([^`]*[一-鿿][^`]*)`/gu),
    ...momentFallbacks.matchAll(/"([^"]*[一-鿿][^"]*)"|`([^`]*[一-鿿][^`]*)`/gu),
  ].map((m) => m[1] ?? m[2]!);

  it("there are few of them, and the count is a tripwire rather than a limit", () => {
    // eslint-disable-next-line no-console
    console.log(`\n  sentences the build writes into her field on her behalf: ${authored.length}`);
    for (const t of authored) console.log(`    ${t}`);
    // 13, measured under the WIDENED ruler (template literals + the two builder files). History,
    // because the number moved twice for opposite reasons and only one of them is
    // ground: 7 → 6 was the redesign (two stance clauses merged, two hedges cut) · 6 → 13 is the
    // ruler learning to see sentences that were always there. **Not a regression: a discovery.**
    // One of the thirteen (「刚才出了岔子，话没说出来。」) is the face's broadcast rather than a node
    // text; it is left in scope on purpose, it is authored text spoken in her voice, which is what
    // this census is for, and narrowing the scan to exclude it would be tuning the ruler to make
    // the number smaller. Pinned at the measured value with no headroom: the set can only shrink.
    expect(authored.length, "the set of sentences put in her mouth is growing").toBeLessThan(14);
  });

  it("none of them carries a STANCE or a HEDGE — the event is mine to record, the reading is hers", () => {
    // The redesign's load-bearing line, with its incident: 「他要我X的那回，话里没有我」 was an
    // authored READING planted as her memory, and it surfaced in her own speech across four
    // independent runs: nearly reported as her own coinage. Words like 好像/可是 are the same
    // thing at lower volume: my epistemic-affective coloring, spoken through her. An authored
    // memory text may name WHAT HAPPENED; how it felt lives in `pad` and `tension`, and what she
    // makes of it is hers to grow. Planted violation: put 「话里没有我」 back and this goes red.
    // 伸手过去: not a hedge, an authored bodily IMAGE, which is the same defect one step
    // over, and it lived in `walls.ts` for as long as the census could not see that file. The list
    // is a record of the specific things caught, not a theory of Chinese; each entry is here
    // because it was actually found in her memory.
    const STANCE_OR_HEDGE = /话里没有我|说法不太对|伸手过去|好像|可是|其实|想必|大概|恐怕|居然|竟然/u;
    for (const t of authored) {
      expect(t, `"${t}" carries a stance or hedge — an authored reading in her memory`)
        .not.toMatch(STANCE_OR_HEDGE);
    }
  });

  it("the citation frame survives: what he asked for is quoted, never absorbed", () => {
    // The quote brackets are the injection boundary: the capped fragment of HIS text sits inside
    // 「」 so that when the node is read back to a model it presents as quoted material, not as
    // her own sentence. A planted instruction-bearing fragment must come out bracketed.
    const stays = readFileSync(join(process.cwd(), "src/life/what-stays.ts"), "utf8");
    expect(stays, "the what-stays text no longer brackets the fragment — his words would be "
      + "absorbed into her memory as hers, which is the injection channel this design closes")
      .toMatch(/他要我「\$\{o\.aboutWhat\}」的那回/u);
  });

  it("every one of them is in HER register — no service words, no machine voice", () => {
    for (const t of authored) {
      expect(scanForNotHerWords("her-memory", t), `"${t}" is not in her register`).toEqual([]);
    }
  });

  it("and every one of them is about what HAPPENED, never about what someone is like", () => {
    // The constraint `what-stays.ts` states for its own sentences, applied to all of them: a
    // memory that is a verdict on a person is the abstraction that makes rumination out of
    // remembering. These are all events.
    const verdicts = /总是|老是|从来|每次|性格|人品|就是这种人/u;
    for (const t of authored) {
      expect(t, `"${t}" is a judgement rather than a record of an event`).not.toMatch(verdicts);
    }
  });
});

// ── 翻译腔标记：只数不剪的口音曲线 ────────────────────────────────
describe("CALQUE_MARKERS — the accent curve's vocabulary", () => {
  it("exists, is bank-token shaped, and never overlaps the machine-word list", () => {
    expect(CALQUE_MARKERS.length).toBeGreaterThan(0);
    for (const w of CALQUE_MARKERS) {
      expect(w.length).toBeGreaterThanOrEqual(2);
      expect(NOT_HER_WORDS.some((n) => n.word === w), `${w} belongs to the accent gauge, not the machine-word door`).toBe(false);
    }
  });

  it("PLANTED: it is a gauge, not a scissors — no cutter consumes it", () => {
    // The one consumer is the vitals leaf. If register-scissors or utterance ever import it,
    // the accent watch has become speech policing, which the design forbids: her said words
    // are hers, and the accent fades through input, not through surgery.
    for (const f of ["src/life/register-scissors.ts", "src/life/utterance.ts", "src/life/machine-voice.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src.includes("CALQUE_MARKERS"), `${f} consumes the accent list — that is a scissors, not a gauge`).toBe(false);
    }
  });
});
