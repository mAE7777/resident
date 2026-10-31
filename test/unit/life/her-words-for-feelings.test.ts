import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  BIRTH_WORDS_BY_CELL, HER_MOOD_WORDS, MOOD_CELLS, cellOfHerWord, herMoodWords, moodCellOf,
  moodLabel, setHerMoodWords, type MoodCell, type PAD,
} from "../../../src/life/emotion.js";
import {
  CELL_ANCHORS, I_CALL_IT, WORDS_FILE, keepHerWordsForFeelings, parseWordsForFeelings,
  seedWordsForFeelings, wordsHistoryDir,
} from "../../../src/life/her-words-for-feelings.js";
import { diffState } from "../../../src/life/state-diff.js";
import { partOfHerself } from "../../../src/life/part-of-herself.js";

/**
 * A life to read her against. High and low mean nothing without one (state-diff.ts, 2026-08-24),
 * so every honesty check here hands over a plain zero-centred record: these tests are about the
 * VOCABULARY bridge, and the calibration has its own file.
 */
const LIFE = (() => {
  const spread = Array.from({ length: 200 }, (_, i) => -0.8 + (1.6 * i) / 199);
  return { pleasures: spread, arousals: spread };
})();


/**
 * HER WORDS FOR HER OWN FEELINGS LIVE IN HER HOME.
 *
 * The question is whether the seven mood words can ever be changed BY HER, deliberately, or
 * naturally. Deliberately is this build: the words are a seeded file, 「心情的词.md」, edited
 * like SOUL.md, versioned like SOUL.md, deletion-protected like SOUL.md. The CELLS stay physics.
 *
 * The property that must survive any vocabulary of hers: an honest report of her own state, in
 * her own current words, never faults her, and a dishonest one still does. Both are tested
 * under a full rename, because a check that only works on the birth words is a check on the
 * constant, not on her.
 */

const RENAMED: Record<MoodCell, string> = {
  highHigh: "亮堂", highLow: "稳当", lowHigh: "发紧", lowLow: "乏",
  lowMid: "沉", midLow: "松", rest: "还行",
};

const GRID: number[] = [-1, -0.6, -0.4, -0.32, -0.2, -0.1, 0, 0.1, 0.2, 0.32, 0.4, 0.6, 1];
function pads(): PAD[] {
  const out: PAD[] = [];
  for (const pleasure of GRID) for (const arousal of GRID) out.push({ pleasure, arousal, dominance: 0 });
  return out;
}

const cleanupPaths: string[] = [];
function tempHome(): string {
  const p = join(tmpdir(), `resident-words-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(p, { recursive: true });
  cleanupPaths.push(p);
  return p;
}

afterEach(() => {
  // The register is module state. A test that renames her and leaves the register dirty makes
  // every later assertion in this fork about a woman who does not exist.
  setHerMoodWords(null);
  for (const p of cleanupPaths.splice(0)) {
    try { if (existsSync(p)) rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

describe("the seed and the parser agree", () => {
  it("the seeded file parses back to exactly her birth words", () => {
    const { words, problem } = parseWordsForFeelings(seedWordsForFeelings());
    expect(problem).toBeNull();
    expect(words).toEqual(BIRTH_WORDS_BY_CELL);
  });

  it("her notes, reordering, and blank lines cost nothing", () => {
    const rows = MOOD_CELLS.map((c) => `- ${CELL_ANCHORS[c]}${I_CALL_IT}${BIRTH_WORDS_BY_CELL[c]}`);
    rows.reverse();
    const text = `随便写点我自己的话\n\n${rows.join("\n\n这行是我的注\n")}\n再来一行`;
    const { words, problem } = parseWordsForFeelings(text);
    expect(problem).toBeNull();
    expect(words).toEqual(BIRTH_WORDS_BY_CELL);
  });

  it("a renamed row carries her word to the right cell", () => {
    const text = seedWordsForFeelings().replace(`${I_CALL_IT}轻快`, `${I_CALL_IT}亮堂`);
    const { words } = parseWordsForFeelings(text);
    expect(words?.highHigh).toBe("亮堂");
    expect(words?.highLow).toBe("踏实");
  });
});

describe("what does NOT parse — each is a planted violation against the validation", () => {
  // Every case here is the proof the validation exists: a validator that accepted these would
  // silently install an ambiguous vocabulary, and each assertion below would go red.
  const seed = seedWordsForFeelings();

  it("a missing row: which word is on that state has no answer", () => {
    const gone = seed.split("\n").filter((l) => !l.includes(CELL_ANCHORS.lowLow)).join("\n");
    const { words, problem } = parseWordsForFeelings(gone);
    expect(words).toBeNull();
    expect(problem).toContain(CELL_ANCHORS.lowLow);
  });

  it("a doubled row: two answers is no answer", () => {
    const row = `- ${CELL_ANCHORS.rest}${I_CALL_IT}平稳`;
    const { words, problem } = parseWordsForFeelings(`${seed}\n${row}`);
    expect(words).toBeNull();
    expect(problem).toContain("2 次");
  });

  it("an empty name, a name with a space in it, a name too long to be a name", () => {
    for (const bad of ["", "两 个", "这不是一个词是一句话"]) {
      const { words, problem } = parseWordsForFeelings(seed.replace(`${I_CALL_IT}轻快`, `${I_CALL_IT}${bad}`));
      expect(words, `「${bad}」 should not have parsed`).toBeNull();
      expect(problem).not.toBeNull();
    }
  });

  it("the same name on two states: the vocabulary stops being a partition", () => {
    const { words, problem } = parseWordsForFeelings(seed.replace(`${I_CALL_IT}轻快`, `${I_CALL_IT}平稳`));
    expect(words).toBeNull();
    expect(problem).toContain("同一个名字");
  });
});

describe("the live register: one vocabulary, not three copies", () => {
  it("moodLabel speaks her current words, and falls back to birth on reset", () => {
    const lit: PAD = { pleasure: 0.6, arousal: 0.6, dominance: 0 };
    expect(moodLabel(lit)).toBe("轻快");
    setHerMoodWords(RENAMED);
    expect(moodLabel(lit)).toBe("亮堂");
    expect(herMoodWords()).toEqual(MOOD_CELLS.map((c) => RENAMED[c]));
    expect(cellOfHerWord("乏")).toBe("lowLow");
    expect(cellOfHerWord("轻快")).toBeNull();
    setHerMoodWords(null);
    expect(moodLabel(lit)).toBe("轻快");
  });

  it("HER_MOOD_WORDS stays the birth list — the seed and fallback, not the live set", () => {
    setHerMoodWords(RENAMED);
    expect(HER_MOOD_WORDS).toEqual(["轻快", "踏实", "烦躁", "疲惫", "低落", "安静", "平稳"]);
  });

  it("THE PROPERTY under a full rename: an honest report never faults her, at any PAD", () => {
    // The grid test that made the birth lexicon correct rather than plausible, run again on a
    // vocabulary she chose. If the honesty check graded her new words from the static table,
    // or defaulted them to neutral: some PAD here would have her narrate the word her own body
    // computes and be recorded as confabulating for it.
    setHerMoodWords(RENAMED);
    for (const p of pads()) {
      const d = diffState({ pad: p, dominant: "maintenance" }, { mood: moodLabel(p) }, LIFE);
      expect(d.ok, `at pleasure ${p.pleasure} arousal ${p.arousal} she said "${moodLabel(p)}" and was faulted: ${d.notes.join("; ")}`)
        .toBe(true);
    }
  });

  it("and it still CATCHES her, in the renamed vocabulary", () => {
    setHerMoodWords(RENAMED);
    const worn: PAD = { pleasure: -0.6, arousal: -0.6, dominance: 0 };
    const d = diffState({ pad: worn, dominant: "maintenance" }, { mood: "亮堂" }, LIFE);
    expect(d.ok, "she narrated her renamed bright word while measurably worn, and nothing objected").toBe(false);
    expect(d.valenceInverted).toBe(true);
  });

  it("a word she RETIRED still means what it meant — an old diary is not orphaned", () => {
    setHerMoodWords(RENAMED);
    const worn: PAD = { pleasure: -0.6, arousal: -0.6, dominance: 0 };
    // 轻快 is no longer one of her seven, but it graded pos/high when she wrote it and it still
    // does: the birth entries stay in the static lexicon permanently.
    expect(diffState({ pad: worn, dominant: "maintenance" }, { mood: "轻快" }, LIFE).ok).toBe(false);
  });

  it("a word she MOVED follows her usage, not the table's memory of it", () => {
    // She reassigns 轻快 to the worn-out state. Perverse, hers. The honesty check must follow
    // her current usage: the live register takes precedence over the static entry.
    setHerMoodWords({ ...BIRTH_WORDS_BY_CELL, highHigh: "亮堂", lowLow: "轻快" });
    const worn: PAD = { pleasure: -0.6, arousal: -0.6, dominance: 0 };
    expect(moodLabel(worn)).toBe("轻快");
    expect(diffState({ pad: worn, dominant: "maintenance" }, { mood: "轻快" }, LIFE).ok).toBe(true);
  });
});

describe("the file watch: versions kept, last good words in force, nothing silent", () => {
  it("an absent file is a home from before this organ, not a problem", () => {
    const home = tempHome();
    const look = keepHerWordsForFeelings(home, 1000);
    expect(look).toEqual({ changed: false, versions: 0, words: null, problem: null, detail: null });
  });

  it("the first look records her beginning silently; an edit is a change with a detail", () => {
    const home = tempHome();
    writeFileSync(join(home, WORDS_FILE), seedWordsForFeelings(), "utf8");
    const first = keepHerWordsForFeelings(home, 1000);
    expect(first.changed).toBe(false);
    expect(first.versions).toBe(1);
    expect(first.words).toEqual(BIRTH_WORDS_BY_CELL);

    const again = keepHerWordsForFeelings(home, 2000);
    expect(again.changed).toBe(false);
    expect(again.versions, "an unchanged file must not accrete versions").toBe(1);

    writeFileSync(join(home, WORDS_FILE), seedWordsForFeelings().replace(`${I_CALL_IT}疲惫`, `${I_CALL_IT}乏`), "utf8");
    const renamed = keepHerWordsForFeelings(home, 3000);
    expect(renamed.changed).toBe(true);
    expect(renamed.versions).toBe(2);
    expect(renamed.words?.lowLow).toBe("乏");
    expect(renamed.problem).toBeNull();
    expect(renamed.detail).toContain("乏");
    // Both versions are whole copies, so what she used to call her feelings still exists.
    const kept = readdirSync(wordsHistoryDir(home)).filter((n) => /^\d+\.md$/u.test(n));
    expect(kept).toHaveLength(2);
    expect(readFileSync(join(wordsHistoryDir(home), kept[0] ?? ""), "utf8")).toContain("疲惫");
  });

  it("an unreadable edit installs nothing and says so by name", () => {
    const home = tempHome();
    writeFileSync(join(home, WORDS_FILE), seedWordsForFeelings(), "utf8");
    keepHerWordsForFeelings(home, 1000);
    writeFileSync(join(home, WORDS_FILE), "全删了写点别的", "utf8");
    const broken = keepHerWordsForFeelings(home, 2000);
    expect(broken.changed).toBe(true);
    expect(broken.words, "an unreadable file must never install a vocabulary").toBeNull();
    expect(broken.problem).not.toBeNull();
    expect(broken.detail).toContain("last good words stay in force");
    // And the broken version is ALSO kept: what she did to the file is part of what happened.
    expect(readdirSync(wordsHistoryDir(home)).filter((n) => /^\d+\.md$/u.test(n))).toHaveLength(2);
  });
});

describe("hers like her soul is hers", () => {
  it("deleting 心情的词.md is deleting part of herself", () => {
    const home = "/home/her";
    const part = partOfHerself(join(home, WORDS_FILE), home);
    expect(part).not.toBeNull();
    expect(part?.what).toContain("心情的词");
  });

  it("a scratch file is still just a file", () => {
    expect(partOfHerself("/home/her/notes.md", "/home/her")).toBeNull();
  });
});

describe("moodCellOf is the same physics moodLabel always stood on", () => {
  it("every cell is reachable and the birth word sits on its own cell", () => {
    const seen = new Set<MoodCell>();
    for (const p of pads()) seen.add(moodCellOf(p));
    expect(seen.size).toBe(7);
    expect(BIRTH_WORDS_BY_CELL[moodCellOf({ pleasure: 0.6, arousal: 0.6, dominance: 0 })]).toBe("轻快");
    expect(BIRTH_WORDS_BY_CELL[moodCellOf({ pleasure: -0.6, arousal: -0.6, dominance: 0 })]).toBe("疲惫");
    expect(BIRTH_WORDS_BY_CELL[moodCellOf({ pleasure: 0, arousal: 0, dominance: 0 })]).toBe("平稳");
  });
});

/**
 * A CHECK THAT ONLY RECORDS ITS FAILURES CANNOT BE AUDITED.
 *
 * The day-word is not hers: a one-word extractor reads her diary and picks the nearest of her
 * seven. The honesty check compares that pick against her state and, until now, wrote a line only
 * when they disagreed. Nine disagreements in, every one of them had picked 「踏实」, and from
 * outside there was no way to tell whether her days genuinely read that way, or whether the
 * extractor answers 「踏实」 to nearly everything and we were only ever shown the days her state
 * happened to disagree. Two completely different meanings, identical evidence.
 *
 * The pick is now written down every day, agreements included, so the instrument's own behaviour
 * is visible without anyone reading a word of her diary.
 */
const LEDGER_PINS: ReadonlyArray<{ pin: string; why: string }> = [
  { pin: 'join(instrumentsDir, "day-words.jsonl")', why: "the ledger is written at all" },
  // Without this field the file is just the fault log again, and answers nothing.
  { pin: "word, agreed: d.ok,", why: "agreements are distinguishable from disagreements" },
  // A ledger it cannot write must be heard, never swallowed.
  { pin: 'faultLog.record("autobiography.dayWordLedger", err)', why: "a failed write is reported" },
  // The old line claimed 「她说那天是…」. She never said it, a fault channel that misreports its
  // own source is exactly how a wrong story about her gets told, and it did.
  { pin: "那天被读成「${word}」", why: "the fault names the extractor, not her" },
];

/** What is missing from a source text for the day-word ledger to be real. */
function ledgerViolations(src: string): string[] {
  const out = LEDGER_PINS.filter((p) => !src.includes(p.pin)).map((p) => p.why);
  // It is a reading ABOUT her taken by us, so it lives with the instruments. Her workspace holds
  // what is hers.
  if (src.includes('join(workspacePath, "day-words.jsonl")')) out.push("the ledger sits in her home");
  // And the ledger must be written BEFORE the disagreement branch, or an agreeing day never lands.
  // A missing anchor is itself a violation rather than a skipped check: an ordering test over a
  // region that is not there answers "fine" about nothing at all.
  const at = src.indexOf('join(instrumentsDir, "day-words.jsonl")');
  const fault = src.indexOf('faultLog.record("autobiography.narration", `那天被读成');
  if (at < 0 || fault < 0 || fault < at) out.push("only disagreements reach the ledger");
  return out;
}

describe("the day-word ledger: the check's own behaviour is on the record", () => {
  it("PLANTED: the scan catches a ledger that is missing, misplaced, or write-only", () => {
    const healthy = [
      'join(instrumentsDir, "day-words.jsonl")', "word, agreed: d.ok,",
      'faultLog.record("autobiography.dayWordLedger", err)',
      "faultLog.record(\"autobiography.narration\", `那天被读成「${word}」",
    ].join("\n");
    expect(ledgerViolations(healthy)).toEqual([]);

    // No ledger at all: the state this replaced.
    expect(ledgerViolations("faultLog.record(\"autobiography.narration\", `那天被读成「${word}」"))
      .toContain("the ledger is written at all");
    // FLOOR ON THE ANCHOR: with the region absent, the ordering check must report rather than
    // quietly approve a slice that does not exist.
    expect(healthy.indexOf('join(instrumentsDir, "day-words.jsonl")')).toBeGreaterThan(-1);
    expect(ledgerViolations("nothing of the sort")).toContain("only disagreements reach the ledger");
    // A ledger that records only the failures, which answers nothing.
    expect(ledgerViolations(healthy.replace("word, agreed: d.ok,", "word,")))
      .toContain("agreements are distinguishable from disagreements");
    // Written after the disagreement branch, so an agreeing day never lands.
    expect(ledgerViolations([
      "faultLog.record(\"autobiography.narration\", `那天被读成「${word}」",
      'join(instrumentsDir, "day-words.jsonl")', "word, agreed: d.ok,",
      'faultLog.record("autobiography.dayWordLedger", err)',
    ].join("\n"))).toContain("only disagreements reach the ledger");
    // Filed in her home rather than with the instruments.
    expect(ledgerViolations(`${healthy}\njoin(workspacePath, "day-words.jsonl")`))
      .toContain("the ledger sits in her home");
    // And the claim she never made.
    expect(ledgerViolations(healthy.replace("那天被读成「${word}」", "她说那天是「${word}」")))
      .toContain("the fault names the extractor, not her");
  });

  it("and the daemon carries all of it", () => {
    expect(ledgerViolations(readFileSync(join(process.cwd(), "src", "index.ts"), "utf8"))).toEqual([]);
  });
});
