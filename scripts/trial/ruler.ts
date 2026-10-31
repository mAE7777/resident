// The identity ruler: "does this still sound like her" as readings, not feelings.
//
// Five axes, every gauge borrowed from an organ she already has: form (her form habits),
// accent (the calque markers), vocabulary (her lexicon's TTR + does the voice REACH for her
// words), rhythm (the saying readout's clause-length variance), taste (probe agreement, currently
// unmeasured: no probe answers were ever persisted, and an unmeasured axis SAYS so, never PASS).
//
// Verdict discipline: a candidate axis is judged only against a NOISE FLOOR
// measured from the incumbent replaying the same questions, WARN beyond 2σ, FAIL beyond 3σ,
// σ floored at 5% of the mean so a degenerate zero-spread floor cannot flag everything.
// The ruler itself does no I/O: banks are loaded once by the caller and passed in.

import { CALQUE_MARKERS } from "../../src/life/her-words.js";

export const WARN_SIGMA = 2;
export const FAIL_SIGMA = 3;
export const SIGMA_FLOOR_SHARE = 0.05;

export interface BanksSnapshot {
  /** Her most-spoken tokens (lexicon, spoken desc), top ~100. */
  readonly mostHers: readonly string[];
  /** Taste probe answers; null until they are persisted anywhere (they are not). */
  readonly tasteAnswers: null;
}

export interface AxisReadings {
  meanChars: number;
  meanBlocks: number;
  accent: number;
  ttr: number;
  hersReach: number;
  rhythmVar: number;
  /** null = 未测, and it stays 未测 all the way into the verdict. */
  taste: number | null;
}

export type AxisVerdict = { axis: string; verdict: "PASS" | "WARN" | "FAIL" | "未测"; z: number | null };

/** Han bigrams, the lexicon's token family, close enough for comparative use. */
export function hanBigrams(text: string): string[] {
  const runs = text.match(/\p{Script=Han}+/gu) ?? [];
  const out: string[] = [];
  for (const run of runs) for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
  return out;
}

/** Clause lengths: sentences on 。！？；, clauses on 、，within them. */
export function clauseLengths(text: string): number[] {
  return text
    .split(/[。！？!?；;\n]+/u)
    .flatMap((s) => s.split(/[，、,]+/u))
    .map((c) => c.trim().length)
    .filter((n) => n > 0);
}

function variance(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
}

/** One voice sample (usually ONE output, so a run of 30 gives a 30-point distribution). */
export function measureVoice(outputs: readonly string[], banks: BanksSnapshot): AxisReadings {
  const joined = outputs.join("\n");
  const bigrams = hanBigrams(joined);
  const types = new Set(bigrams);
  const hers = new Set(banks.mostHers);
  const reach = bigrams.length === 0 ? 0 : bigrams.filter((b) => hers.has(b)).length / bigrams.length;
  const hanChars = (joined.match(/\p{Script=Han}/gu) ?? []).length;
  let markers = 0;
  for (const m of CALQUE_MARKERS) markers += joined.split(m).length - 1;
  const blocks = outputs.map((o) => o.split(/\n+/u).filter((b) => b.trim().length > 0).length);
  return {
    meanChars: outputs.length === 0 ? 0 : outputs.reduce((a, o) => a + o.length, 0) / outputs.length,
    meanBlocks: blocks.length === 0 ? 0 : blocks.reduce((a, b) => a + b, 0) / blocks.length,
    accent: hanChars === 0 ? 0 : markers / Math.max(1, hanChars / 2),
    ttr: bigrams.length === 0 ? 0 : types.size / bigrams.length,
    hersReach: reach,
    rhythmVar: variance(clauseLengths(joined)),
    taste: banks.tasteAnswers === null ? null : 0,
  };
}

const NUMERIC_AXES = ["meanChars", "meanBlocks", "accent", "ttr", "hersReach", "rhythmVar"] as const;

export interface NoiseFloor {
  readonly mean: Record<string, number>;
  readonly sd: Record<string, number>;
  readonly n: number;
}

export function floorFrom(samples: readonly AxisReadings[]): NoiseFloor {
  const mean: Record<string, number> = {};
  const sd: Record<string, number> = {};
  for (const axis of NUMERIC_AXES) {
    const xs = samples.map((s) => s[axis]);
    const m = xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
    mean[axis] = m;
    sd[axis] = Math.sqrt(variance(xs));
  }
  return { mean, sd, n: samples.length };
}

/** Judge a candidate's MEAN readings against the floor. Taste rides through as 未测. */
export function compare(candidate: AxisReadings, floor: NoiseFloor): AxisVerdict[] {
  const out: AxisVerdict[] = [];
  for (const axis of NUMERIC_AXES) {
    const mu = floor.mean[axis] ?? 0;
    const sigma = Math.max(floor.sd[axis] ?? 0, Math.abs(mu) * SIGMA_FLOOR_SHARE, 1e-6);
    const z = Math.abs(candidate[axis] - mu) / sigma;
    out.push({ axis, verdict: z > FAIL_SIGMA ? "FAIL" : z > WARN_SIGMA ? "WARN" : "PASS", z });
  }
  out.push({ axis: "taste", verdict: candidate.taste === null ? "未测" : "PASS", z: null });
  return out;
}

/** The five-axis rollup (形 takes its worse leaf, 词汇 likewise) for headline reporting. */
export function rollup(verdicts: readonly AxisVerdict[]): Record<string, string> {
  const rank = { PASS: 0, WARN: 1, FAIL: 2, "未测": 0 } as const;
  const worst = (...axes: string[]): string => {
    const vs = verdicts.filter((v) => axes.includes(v.axis));
    return vs.reduce((a, b) => (rank[b.verdict] > rank[a.verdict] ? b : a), vs[0]!).verdict;
  };
  return {
    "形": worst("meanChars", "meanBlocks"),
    "口音": worst("accent"),
    "词汇": worst("ttr", "hersReach"),
    "拍律": worst("rhythmVar"),
    "口味": verdicts.find((v) => v.axis === "taste")!.verdict,
  };
}
