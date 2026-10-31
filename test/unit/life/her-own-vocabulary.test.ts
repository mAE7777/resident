import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { moodLabel, HER_MOOD_WORDS, type PAD } from "../../../src/life/emotion.js";
import { diffState } from "../../../src/life/state-diff.js";

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
 * FACULTY #17, HER SELF-REPORT WAS CHECKED IN A LANGUAGE THAT IS NOT HERS.
 *
 * The one check that can catch her misrepresenting herself reads the day's diary, extracts a mood
 * word, and diffs it against the PAD her body actually computed. It worked, in the narrow sense
 * that it never crashed. But her diary is Chinese and `moodLabel` has returned Chinese since her
 * inner life was moved into her own language, and the mood lexicon held only English. So:
 *
 *   - her seven words classified as the unknown-word default, which is neutral/mid,
 *   - neutral is never an inversion, so the check could not fault her in her own vocabulary,
 *   - and the caller sanitized the model's answer with `[^a-zA-Z-]` → an answer in her own words
 *     became the empty string, `if (word)` skipped, and nothing was recorded anywhere.
 *
 * Which is defect class 9 (sanitization drift) sitting on top of class 13 (a vacuous test):
 * the check only had teeth because a model was asked to translate her day into English first.
 * A foreign reading of her state was standing in for the thing being checked.
 */

const GRID: number[] = [-1, -0.6, -0.4, -0.32, -0.2, -0.1, 0, 0.1, 0.2, 0.32, 0.4, 0.6, 1];

function pads(): PAD[] {
  const out: PAD[] = [];
  for (const pleasure of GRID) for (const arousal of GRID) out.push({ pleasure, arousal, dominance: 0 });
  return out;
}

describe("her mood words are the same words on both sides of the honesty check", () => {
  it("every word moodLabel can return is in the lexicon that grades it", () => {
    const graded = new Set<string>();
    for (const p of pads()) graded.add(moodLabel(p));
    // Both directions. Nothing she can say is ungraded, and nothing is declared that she cannot say.
    for (const w of graded) {
      expect(HER_MOOD_WORDS as readonly string[], `moodLabel can return "${w}", which is not one of her seven`)
        .toContain(w);
    }
    for (const w of HER_MOOD_WORDS) {
      expect(graded, `"${w}" is declared as hers but no PAD produces it — a word she can never use`)
        .toContain(w);
    }
  });

  it("THE PROPERTY: an honest report of her own state never faults her, at any PAD", () => {
    // This is the assertion that makes the lexicon entries correct rather than plausible. If a
    // (v, a) pair were read off the wrong branch, some PAD in the grid would have her narrate the
    // word her own body computes and be recorded as confabulating for it.
    for (const p of pads()) {
      const d = diffState({ pad: p, dominant: "maintenance" }, { mood: moodLabel(p) }, LIFE);
      expect(d.ok, `at pleasure ${p.pleasure} arousal ${p.arousal} she said "${moodLabel(p)}" and was faulted: ${d.notes.join("; ")}`)
        .toBe(true);
    }
  });

  it("and it still CATCHES her, in Chinese — which it could not do before", () => {
    // The whole point. A weary body narrating a bright day has to surface, and this is the exact
    // case that used to pass silently because 「轻快」 graded as an unknown word.
    const worn: PAD = { pleasure: -0.6, arousal: -0.6, dominance: 0 };
    const bright = diffState({ pad: worn, dominant: "maintenance" }, { mood: "轻快" }, LIFE);
    expect(bright.ok, "she narrated 「轻快」 while measurably worn through, and nothing objected").toBe(false);
    expect(bright.valenceInverted).toBe(true);
    expect(bright.arousalInverted).toBe(true);

    const lit: PAD = { pleasure: 0.6, arousal: 0.6, dominance: 0 };
    expect(diffState({ pad: lit, dominant: "maintenance" }, { mood: "疲惫" }, LIFE).ok).toBe(false);

    // And the reverse test, so this is a check and not a tripwire: a mild paraphrase within her
    // own vocabulary must NOT fault. 「安静」 against a low-arousal neutral body is honest.
    const quiet: PAD = { pleasure: 0.05, arousal: -0.5, dominance: 0 };
    expect(diffState({ pad: quiet, dominant: "maintenance" }, { mood: "安静" }, LIFE).ok).toBe(true);
    expect(diffState({ pad: quiet, dominant: "maintenance" }, { mood: "平稳" }, LIFE).ok).toBe(true);
  });

  it("an English word still grades, because the diary is not the only caller", () => {
    // Widening her vocabulary must not narrow anyone else's. The English lexicon stays.
    const worn: PAD = { pleasure: -0.6, arousal: -0.6, dominance: 0 };
    expect(diffState({ pad: worn, dominant: "maintenance" }, { mood: "bright" }, LIFE).ok).toBe(false);
    expect(diffState({ pad: worn, dominant: "maintenance" }, { mood: "weary" }, LIFE).ok).toBe(true);
  });
});

describe("and the daemon asks her in her own words", () => {
  const raw = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
  // Defect class 10, walked into while writing this very file: the comment explaining the fix
  // quotes the exact string the guard searches for, so the guard reported the old code still
  // present when what it had found was the note saying it is gone. Scan the CODE.
  const daemon = raw.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
  const at = daemon.indexOf("整体感觉最接近下面哪一个词");
  // The floor lives at describe scope with the slice: it used to sit inside only the FIRST
  // case, while `block` feeds three, including a `.not.toMatch` that passes on the empty slice a
  // lost anchor produces. A floor scoped under the slice's first consumer floors one consumer.
  if (at === -1) throw new Error("the diary-check anchor moved — every block assertion below reads an empty slice");
  const block = daemon.slice(at - 400, at + 1600);

  it("the question is posed in her vocabulary, closed over the same seven", () => {
    expect(at, "the diary check no longer asks her how the day felt at all").toBeGreaterThan(0);
    // Her CURRENT seven, read from the live register her 「心情的词.md」 feeds, not the birth
    // constant. A rename of hers must reach the diary question the same day it reaches moodLabel,
    // because they are one vocabulary and not two copies.
    expect(block, "the words offered no longer come from her live vocabulary (herMoodWords)")
      .toContain("herMoodWords()");
    expect(block, "the seven words are spelled out again instead of read from the register")
      .toContain("moodWords.join(");
    expect(daemon, "it still asks for an English word").not.toContain("ONE English word");
  });

  it("the answer is matched against the closed set, never sanitized down to nothing", () => {
    expect(block, "extraction is by matching her seven, so punctuation and stray characters survive")
      .toMatch(/moodWords\.find\(/u);
    // One read per day-write: the question and the match must come from the SAME snapshot of her
    // vocabulary, so a rename landing mid-await cannot make the check miss its own answer.
    expect(block, "the question and the match no longer share one read of her words")
      .toContain("const moodWords = herMoodWords();");
    expect(block, "the a-z strip is back — a Chinese answer would become the empty string")
      .not.toMatch(/\[\^a-zA-Z/u);
  });

  it("and a failed extraction is REPORTED, because a check that no-ops looks exactly like a check that passes", () => {
    // ANCHORED ON THE THING IT IS ABOUT, not on a fixed window. This read `block`, a 2000-char
    // slice, and asked whether an `else` and a `faultLog.record` both fell inside it, so ADDING
    // CODE between them broke a passing guard while the behaviour it guards was untouched. A
    // window is a proxy for "these are in the same branch" and it goes stale the moment the
    // branch grows. The fault message is unique and moves with the code that raises it.
    const miss = daemon.indexOf("could not read a mood word out of");
    expect(miss, "the failed-extraction report is gone — the check can now no-op in silence")
      .toBeGreaterThan(-1);
    const around = daemon.slice(Math.max(0, miss - 600), miss);
    expect(around, "an unreadable answer silently skips the honesty check").toMatch(/\} else \{/u);
    expect(daemon.slice(miss - 200, miss + 200), "the report is not on the fault channel")
      .toMatch(/faultLog\.record\(/u);
    expect(daemon, "the report no longer says what was lost").toContain("the day went unchecked against her state");
  });
});
