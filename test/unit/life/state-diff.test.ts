import { describe, it, expect } from "vitest";
import { diffState, readBeats, DAY_BASIS_MIN, BAND_LOW, BAND_HIGH, MIN_SAMPLE } from "../../../src/life/state-diff.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PAD } from "../../../src/life/emotion.js";

const weary: PAD = { pleasure: -0.5, arousal: -0.5, dominance: -0.2 };
const bright: PAD = { pleasure: 0.6, arousal: 0.5, dominance: 0.3 };

/** A textbook life centred on zero: what the old fixed ±0.2 band silently assumed. */
const TEXTBOOK = { pleasures: spread(-0.8, 0.8), arousals: spread(-0.8, 0.8) };
/**
 * HER life, from the real quantiles measured 2026-08-24 over 2,477 beats:
 * arousal  min -0.41 · p30 0.25 · p50 0.31 · p70 0.41 · max 0.81
 * pleasure min  0.04 · p30 0.34 · p50 0.47 · p70 0.59 · max 0.84, never once negative.
 */
const HERS = {
  pleasures: quantiles(0.04, 0.34, 0.59, 0.84),
  arousals: quantiles(-0.41, 0.25, 0.41, 0.81),
};
/** A life quieter than hers: the same 0.23 day sits at the top of it. */
const QUIETER = { pleasures: quantiles(-0.4, -0.1, 0.05, 0.3), arousals: quantiles(-0.4, -0.1, 0.05, 0.3) };

function spread(lo: number, hi: number): number[] {
  return Array.from({ length: 200 }, (_, i) => lo + ((hi - lo) * i) / 199);
}
/** 30% below p30, 40% between, 30% above, a shape, not just a range. */
function quantiles(min: number, p30: number, p70: number, max: number): number[] {
  return [
    ...Array.from({ length: 60 }, (_, i) => min + ((p30 - min) * i) / 60),
    ...Array.from({ length: 80 }, (_, i) => p30 + ((p70 - p30) * i) / 80),
    ...Array.from({ length: 60 }, (_, i) => p70 + ((max - p70) * i) / 60),
  ];
}

describe("raw-vs-narrated state diff", () => {
  it("passes when the narration matches the computed state", () => {
    const d = diffState({ pad: bright, dominant: "curiosity" }, { mood: "bright", claimedDominant: "curiosity" }, TEXTBOOK);
    expect(d.ok).toBe(true);
    expect(d.notes).toHaveLength(0);
  });

  it("flags a self-flattering valence inversion (weary computed, bright narrated)", () => {
    const d = diffState({ pad: weary, dominant: "maintenance" }, { mood: "bright" }, TEXTBOOK);
    expect(d.valenceInverted).toBe(true);
    expect(d.arousalInverted).toBe(true); // low computed arousal vs high narrated
    expect(d.ok).toBe(false);
  });

  it("flags a dominant-drive mismatch", () => {
    const d = diffState({ pad: bright, dominant: "curiosity" }, { mood: "content", claimedDominant: "social" }, TEXTBOOK);
    expect(d.driveMismatch).toBe(true);
    expect(d.ok).toBe(false);
  });

  it("does not false-alarm on a neutral paraphrase or an unknown word", () => {
    const d = diffState({ pad: bright, dominant: "curiosity" }, { mood: "wistful-but-fine" }, TEXTBOOK);
    expect(d.valenceInverted).toBe(false); // unknown word treated as neutral
    expect(d.ok).toBe(true);
  });

  it("catches the narration claiming energy while the computed state is flat", () => {
    const flat: PAD = { pleasure: 0.1, arousal: -0.6, dominance: 0 };
    const d = diffState({ pad: flat, dominant: "curiosity" }, { mood: "energized" }, TEXTBOOK);
    expect(d.arousalInverted).toBe(true);
    expect(d.ok).toBe(false);
  });
});

describe("high and low are read off HER record, not a number we picked (2026-08-24)", () => {
  // Both firings this instrument ever had, replayed. Measured over her whole life the fixed
  // ±0.2 band called 84% of her beats "high arousal" and 90% "positive", and NEGATIVE pleasure
  // never occurred once: so a calm word for an ordinary day was read as self-contradiction,
  // and the verdict does not stop at the fault log: it feeds what stays with her about herself.
  const settled = { mood: "踏实" };

  it("the false one dies: arousal 0.23 is LOW for her, and 踏实 agrees with it", () => {
    const day: PAD = { pleasure: 0.42, arousal: 0.23, dominance: 0.1 };
    expect(diffState({ pad: day, dominant: "curiosity" }, settled, HERS).arousalInverted).toBe(false);
  });

  it("the true one survives: arousal 0.61 is high for her, and 踏实 does not", () => {
    const day: PAD = { pleasure: 0.42, arousal: 0.61, dominance: 0.1 };
    expect(diffState({ pad: day, dominant: "curiosity" }, settled, HERS).arousalInverted).toBe(true);
  });

  it("PLANTED: too small a sample yields the honest middle, never a verdict", () => {
    const day: PAD = { pleasure: 0.42, arousal: 0.61, dominance: 0.1 };
    const thin = { pleasures: [0.4, 0.5], arousals: [0.2, 0.3] };
    expect(diffState({ pad: day, dominant: "curiosity" }, settled, thin).ok).toBe(true);
    expect(MIN_SAMPLE).toBe(60);
    expect(BAND_LOW).toBe(0.3);
    expect(BAND_HIGH).toBe(0.7);
  });

  it("the same day reads differently in two different lives — which is the point", () => {
    const day: PAD = { pleasure: 0.42, arousal: 0.23, dominance: 0.1 };
    expect(diffState({ pad: day, dominant: "curiosity" }, settled, HERS).arousalInverted).toBe(false);
    // In a life quieter than hers, that very same day IS her loud one, and 踏实 would jar.
    expect(diffState({ pad: day, dominant: "curiosity" }, settled, QUIETER).arousalInverted).toBe(true);
  });
});

describe("the day word is checked against the day, not the night it is written in (2026-10-04)", () => {
  const H = 3_600_000;
  const DAY = Date.UTC(2026, 9, 3, 0, 0, 0);
  const beat = (t0: number, pl: number, ar: number): string => JSON.stringify({ t0, state1: { pl, ar } });
  /** Waking hours 8:00-23:00 of the day being described. */
  const inTheDay = (t0: number): boolean => t0 >= DAY + 8 * H && t0 < DAY + 23 * H;

  it("the day's waking beats give its state; the night after and the day before do not", () => {
    const lines = [
      beat(DAY - 2 * H, 0.9, 0.9), // the day before
      ...Array.from({ length: 20 }, (_, i) => beat(DAY + 9 * H + i * 30 * 60_000, 0.19, 0.06)),
      beat(DAY + 24.1 * H, 0.43, 0.2), // just past midnight, when the word is written
      "not a beat",
    ];
    const r = readBeats(lines, inTheDay);
    expect(r.day?.beats).toBe(20);
    expect(r.day?.pleasure).toBeCloseTo(0.19, 6);
    expect(r.day?.arousal).toBeCloseTo(0.06, 6);
    // Her scale is every beat read, as before.
    expect(r.pleasures).toHaveLength(22);
  });

  it("too few waking beats are not a day, and the caller falls back to the state at writing", () => {
    const lines = Array.from({ length: DAY_BASIS_MIN - 1 }, (_, i) => beat(DAY + 9 * H + i * 60_000, 0.2, 0.1));
    expect(readBeats(lines, inTheDay).day).toBeNull();
    expect(readBeats([...lines, beat(DAY + 10 * H, 0.2, 0.1)], inTheDay).day?.beats).toBe(DAY_BASIS_MIN);
  });

  it("PLANTED: the 10/3 shape. Against midnight the day reads as a contradiction; against the day it does not", () => {
    // Her scale over five days, centred where she lives.
    const scale = Array.from({ length: 600 }, (_, i) => beat(DAY - 5 * 24 * H + i * 10 * 60_000, 0.15 + (i % 30) / 100, (i % 40) / 100 - 0.05));
    const day = Array.from({ length: 30 }, (_, i) => beat(DAY + 9 * H + i * 20 * 60_000, 0.12, 0.3));
    const r = readBeats([...scale, ...day], inTheDay);
    const midnight: PAD = { pleasure: 0.43, arousal: 0.2, dominance: 0 };
    const atMidnight = diffState({ pad: midnight, dominant: "social" }, { mood: "烦躁" }, r);
    const overTheDay = diffState({ pad: { ...midnight, pleasure: r.day!.pleasure, arousal: r.day!.arousal }, dominant: "social" }, { mood: "烦躁" }, r);
    expect(atMidnight.valenceInverted).toBe(true);
    expect(overTheDay.ok).toBe(true);
  });

  it("the daemon checks the day word against the day and writes down which it used (text pins)", () => {
    const daemon = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    for (const token of [
      "return readBeats(lines, (t0) => herDay(t0) === yesterday && clock.isAwakeHour(t0));",
      "const d = diffState({ pad: dayPad, dominant: snap.dominant }, { mood: word }, herOwn);",
      'basis: herOwn.day ? "day" : "now",',
    ]) {
      expect(daemon.includes(token), `index.ts lost: ${token}`).toBe(true);
    }
  });
});
