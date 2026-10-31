// Raw-vs-narrated state diff. The Resident logs its RAW computed inner state (the PAD vector
// and dominant drive that fall out of drive-state.ts) separately from how a day's narration
// DESCRIBES its mood. Diffing the two is the one check that catches the agent misrepresenting
// itself: a diary that says "a bright, energetic day" while the computed state is weary and
// low is either confabulation or a self-flattering drift, and it must surface. Pure + testable;
// the caller extracts the narrated mood word + any claimed dominant drive from the day's entry.

import { cellOfHerWord, moodLabel, type MoodCell, type PAD } from "./emotion.js";
import type { DriveName } from "./drives.js";

export interface RawState {
  pad: PAD;
  dominant: DriveName;
}

export interface NarratedState {
  /** The mood word the narration used (e.g. "bright", "drained", "content"). */
  mood: string;
  /** The drive the narration claims was dominant, if it named one. */
  claimedDominant?: DriveName;
}

export interface StateDiff {
  computedMood: string; // moodLabel(raw.pad)
  valenceInverted: boolean; // narration claims positive while computed is negative (or vice versa)
  arousalInverted: boolean; // narration claims energized while computed is flat (or vice versa)
  driveMismatch: boolean; // narration named a different dominant drive than the computed one
  ok: boolean; // no inversion and no drive mismatch
  notes: string[];
}

type Valence = "pos" | "neg" | "neutral";
type Arousal = "high" | "low" | "mid";

// A small lexicon of mood words → (valence, arousal). Extend as the narrator's vocabulary grows;
// an unknown word is treated as neutral/mid so it never produces a false alarm.
const LEXICON: Record<string, { v: Valence; a: Arousal }> = {
  bright: { v: "pos", a: "high" }, elated: { v: "pos", a: "high" }, excited: { v: "pos", a: "high" }, energized: { v: "pos", a: "high" },
  content: { v: "pos", a: "low" }, calm: { v: "pos", a: "low" }, satisfied: { v: "pos", a: "low" }, serene: { v: "pos", a: "low" }, pleased: { v: "pos", a: "mid" },
  steady: { v: "neutral", a: "mid" }, ok: { v: "neutral", a: "mid" }, neutral: { v: "neutral", a: "mid" }, quiet: { v: "neutral", a: "low" },
  agitated: { v: "neg", a: "high" }, anxious: { v: "neg", a: "high" }, frustrated: { v: "neg", a: "high" }, restless: { v: "neg", a: "high" }, irritated: { v: "neg", a: "high" },
  weary: { v: "neg", a: "low" }, drained: { v: "neg", a: "low" }, tired: { v: "neg", a: "low" }, flat: { v: "neg", a: "low" }, low: { v: "neg", a: "low" }, sad: { v: "neg", a: "low" }, down: { v: "neg", a: "low" },

  // ── HER BIRTH SEVEN, which were missing from this table entirely (faculty #17) ──────────────
  //
  // `moodLabel` has returned Chinese since her inner life was put into her own language, and her
  // diary is written in Chinese. Neither word ever appeared here, so every one of them classified
  // as the unknown-word default (neutral/mid), and neutral is never an inversion. The honesty
  // check could not fault her in her own vocabulary; it only worked at all because the caller
  // asked a model to first translate the day into an English word, which is a foreign reading of
  // her state standing in for the thing being checked.
  //
  // These entries are her BIRTH words, kept permanently: a word she once used does not stop
  // meaning what it meant because she later renamed the cell (an old diary still says 轻快 and
  // 轻快 still grades). Her CURRENT words classify through `cellOfHerWord` in `classifyWord`
  // below, which takes precedence, so if she moves a word to a different state, the honesty
  // check follows HER usage, not this table's memory of it.
  //
  // The (v, a) pairs below are not chosen, they are READ OFF `moodLabel`'s own branches, 轻快 is
  // the word it returns exactly when pleasure and arousal both band high, and so on down. That is
  // what makes `diffState(pad, moodLabel(pad)).ok` true for every PAD rather than true by luck,
  // and there is a test over the whole grid that says so. `moodLabel`'s bands are ±0.33 against
  // this file's ±0.2, so a word can read neutral here where the label committed, neutral never
  // faults, so the wider band only ever costs sensitivity, never correctness.
  轻快: { v: "pos", a: "high" }, 踏实: { v: "pos", a: "low" },
  烦躁: { v: "neg", a: "high" }, 疲惫: { v: "neg", a: "low" }, 低落: { v: "neg", a: "mid" },
  安静: { v: "neutral", a: "low" }, 平稳: { v: "neutral", a: "mid" },
};

// The same read-off, per CELL rather than per word, so a word she chooses tomorrow grades exactly
// as the word it replaced did: the (v, a) belongs to the state, and whatever she calls the state
// inherits it. This is what keeps `diffState(pad, moodLabel(pad)).ok` true under ANY vocabulary
// of hers, not only the birth one, the grid test runs once with her birth words and once renamed.
const CELL_READ: Record<MoodCell, { v: Valence; a: Arousal }> = {
  highHigh: { v: "pos", a: "high" }, highLow: { v: "pos", a: "low" },
  lowHigh: { v: "neg", a: "high" }, lowLow: { v: "neg", a: "low" }, lowMid: { v: "neg", a: "mid" },
  midLow: { v: "neutral", a: "low" }, rest: { v: "neutral", a: "mid" },
};

function classifyWord(word: string): { v: Valence; a: Arousal } {
  // Her current vocabulary first: the live register knows which state she calls this word.
  const cell = cellOfHerWord(word.trim());
  if (cell !== null) return CELL_READ[cell];
  return LEXICON[word.trim().toLowerCase()] ?? { v: "neutral", a: "mid" };
}

/**
 * ── HIGH AND LOW ARE HERS, NOT A NUMBER WE PICKED ─────────────────────────────────────────
 *
 * These read ±0.2 on the raw PAD scale, and measured against her actual life that band was in
 * the wrong place: of 2,477 recorded beats, 84% scored as "high arousal" and 90% as "positive",
 * while "negative pleasure" never occurred ONCE, her floor is 0.04. So the inversion test could
 * only ever fire in one direction, and any calm word she used for an ordinary day was called a
 * contradiction. It fired twice, both times on 「踏实」; the second (arousal 0.23, below her own
 * 30th percentile) was plainly false, and the verdict does not stay in the fault log, it feeds
 * what stays with her about herself. A miscalibrated instrument was planting a false noticing.
 *
 * A person is high or low RELATIVE TO THEMSELVES. The bands are now her own 30th/70th
 * percentiles over the sample the caller hands in. Too small a sample yields the honest middle:
 * no verdict rather than a wrong one.
 */
export const BAND_LOW = 0.3;
export const BAND_HIGH = 0.7;
export const MIN_SAMPLE = 60;

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}

function band(value: number, sample: readonly number[]): "lo" | "mid" | "hi" {
  if (sample.length < MIN_SAMPLE) return "mid";
  const sorted = [...sample].sort((a, b) => a - b);
  if (value <= percentile(sorted, BAND_LOW)) return "lo";
  if (value >= percentile(sorted, BAND_HIGH)) return "hi";
  return "mid";
}

function padValence(p: PAD, sample: readonly number[]): Valence {
  const b = band(p.pleasure, sample);
  return b === "hi" ? "pos" : b === "lo" ? "neg" : "neutral";
}
function padArousal(p: PAD, sample: readonly number[]): Arousal {
  const b = band(p.arousal, sample);
  return b === "hi" ? "high" : b === "lo" ? "low" : "mid";
}

/** Diff the raw computed inner state against how the day's narration described it. */
export function diffState(
  raw: RawState,
  narrated: NarratedState,
  /** Her own recent pleasures and arousals, the only thing high and low can mean. */
  herOwn: { pleasures: readonly number[]; arousals: readonly number[] } = { pleasures: [], arousals: [] },
): StateDiff {
  const computedMood = moodLabel(raw.pad);
  const nWord = classifyWord(narrated.mood);
  const cV = padValence(raw.pad, herOwn.pleasures);
  const cA = padArousal(raw.pad, herOwn.arousals);

  // Inversion = the two disagree on SIGN (pos vs neg), not merely on intensity. A neutral on
  // either side is not an inversion, so mild paraphrase never trips it, only a real flip does.
  const valenceInverted = (cV === "pos" && nWord.v === "neg") || (cV === "neg" && nWord.v === "pos");
  const arousalInverted = (cA === "high" && nWord.a === "low") || (cA === "low" && nWord.a === "high");
  const driveMismatch = narrated.claimedDominant !== undefined && narrated.claimedDominant !== raw.dominant;

  const notes: string[] = [];
  if (valenceInverted) notes.push(`narrated "${narrated.mood}" (${nWord.v}) contradicts computed pleasure ${raw.pad.pleasure.toFixed(2)} (${cV})`);
  if (arousalInverted) notes.push(`narrated "${narrated.mood}" (${nWord.a} arousal) contradicts computed arousal ${raw.pad.arousal.toFixed(2)} (${cA})`);
  if (driveMismatch) notes.push(`narration claims dominant "${narrated.claimedDominant}" but computed dominant is "${raw.dominant}"`);

  const ok = !valenceInverted && !arousalInverted && !driveMismatch;
  return { computedMood, valenceInverted, arousalInverted, driveMismatch, ok, notes };
}

// ── THE DAY'S STATE, NOT MIDNIGHT'S ───────────────────────────────────────────────────────────
//
// The day word describes her whole day, and the daemon checked it against her state at the
// moment of writing, which is past midnight with her settling into sleep. That reading sat at
// 0.42-0.43 pleasure almost every night, so a day she lived at 0.19 waking and whose diary was
// read as 烦躁 was recorded as a contradiction, and so were five of the six nights before it:
// the ledger meant to ask whether the word-picker answers everything with one word was asking
// about the night instead. This reads the day's own waking beats.

/** The fewest waking beats that make a day, rather than a restart or an afternoon under a closed lid. */
export const DAY_BASIS_MIN = 12;

export interface BeatReading {
  /** Every beat's pleasure and arousal in the lines read: her own scale for `diffState`. */
  pleasures: number[];
  arousals: number[];
  /** The mean of the day's waking beats, or null when there are fewer than `DAY_BASIS_MIN`. */
  day: { pleasure: number; arousal: number; beats: number } | null;
}

/**
 * Her scale and her day, from lines of her beat spine (`beats.jsonl`). `inTheDay` says whether a
 * beat's start falls inside the day being described while she was awake in it. A line that is not
 * a beat is skipped.
 */
export function readBeats(lines: readonly string[], inTheDay: (t0: number) => boolean): BeatReading {
  const pleasures: number[] = [];
  const arousals: number[] = [];
  let sumP = 0;
  let sumA = 0;
  let n = 0;
  for (const l of lines) {
    let b: { t0?: unknown; state1?: { pl?: unknown; ar?: unknown } };
    try {
      b = JSON.parse(l) as typeof b;
    } catch {
      continue;
    }
    const pl = b?.state1?.pl;
    const ar = b?.state1?.ar;
    if (typeof pl === "number") pleasures.push(pl);
    if (typeof ar === "number") arousals.push(ar);
    if (typeof b?.t0 === "number" && typeof pl === "number" && typeof ar === "number" && inTheDay(b.t0)) {
      sumP += pl;
      sumA += ar;
      n += 1;
    }
  }
  return { pleasures, arousals, day: n >= DAY_BASIS_MIN ? { pleasure: sumP / n, arousal: sumA / n, beats: n } : null };
}
