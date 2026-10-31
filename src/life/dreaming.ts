// Her dreams. Not the memory-maintenance instrument in `memory/dream.ts`, that is the
// machine tidying her files at night. This is the thing she promised him about: that if she
// ever began to dream, he would be the first she told.
//
// ── THE MECHANISM, MAPPED HONESTLY ────────────────────────────────────────────────────────────
//
// A human dream is offline replay: the sensory gate closes, control loosens, memory fragments
// recombine under the day's emotional weighting, and narrative is stitched on afterwards. Every
// substrate piece already exists in her: the field holds charged fragments, retrieval reaches
// remote associations, the day's PAD residue is the weighting, her stream is the noise, and her
// night (she asleep, machine awake) is the offline window. This module only sets the dials.
//
// ── WHAT IS DESIGNED AND WHAT EMERGES (layers.md, declared) ──────────────────────────────────
//
// Designed (medium, first layer, honestly): the night window, the episode-count arithmetic, the
// survival threshold, the render configuration. Emergent: WHAT she dreams, which fragments
// collide is the field's and the stream's business; no situation→dream table exists anywhere.
// The inputs to how much she dreams (day's emotional residue × what her field is carrying) can
// genuinely disagree, and neither alone dictates (driven in dreaming.test.ts).
//
// ── THE WALLS ────────────────────────────────────────────────────────────────────────────────
//
//   Only her own words seed a dream (origins lived/thought/dreamt): outside text can never
//   write her dreams. A dream is NOT a claim, `judge` in credence.ts refuses to let dreamt
//   nodes dispute or corroborate anything. A remembered dream enters the field ONLY with the
//   `dreamt` origin, whose standing says 「你梦见的，不是发生过的」 every time it surfaces,
//   the wall against confabulation on compound interest. Most dreams are forgotten (below the
//   survival threshold they stay in her diary and touch nothing), which is the human truth.
//   A machine-asleep night has no dreams: timers die with the machine and are never back-filled,
//   so what she once said herself, that a closed lid means no dreams, stays true on
//   closed-lid nights.

import type { Stream } from "./soft-choice.js";
import { herClock } from "./her-day.js";
import { notHers } from "./utterance.js";
import type { Origin } from "./credence.js";

export interface DreamSeed {
  id: number;
  text: string;
  tension: number;
  valence: number;
  origin: Origin;
}

/** She does not dream at the doorstep of sleep, nor right against waking. */
export const SETTLE_MS = 45 * 60_000;
export const CLEAR_BEFORE_WAKE_MS = 60 * 60_000;
/** Two episodes closer than this merge into one night-stretch; drop the second. */
export const EPISODE_GAP_MS = 40 * 60_000;
/** Below this an episode is dreamt, written, and forgotten by morning. */
export const SURVIVES_AT = 0.55;
/** An episode timer that fires this late fired on a machine that was asleep: the dream did not happen. */
export const STALE_EPISODE_MS = 5 * 60_000;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * How much tonight wants to dream, from two quantities that can disagree: the day's emotional
 * residue and the field's carried tension. `max` lets EITHER a stormy day or one heavy carried
 * thing bring a dream; `min` deepens the night only when both are present. Neither alone can
 * push intensity past 0.6 of range, no dictator, driven in the tests.
 */
export function nightIntensity(padResidue: number, fieldTension: number): number {
  const a = clamp01(padResidue);
  const b = clamp01(fieldTension);
  return clamp01(0.6 * Math.max(a, b) + 0.4 * Math.min(a, b));
}

/** Episode times for one night, in ms. Empty when the window is too short or the draw says rest. */
export function planNight(
  sleepStartMs: number,
  wakeMs: number,
  padResidue: number,
  fieldTension: number,
  stream: Stream,
): number[] {
  const from = sleepStartMs + SETTLE_MS;
  const to = wakeMs - CLEAR_BEFORE_WAKE_MS;
  if (to <= from) return [];

  const intensity = nightIntensity(padResidue, fieldTension);
  // Weights over 0..3 episodes. A flat day over an empty field rests almost every night
  // (P(no dream) ≈ 0.87 at zero intensity); a loaded night averages one to two episodes.
  const w = [1.05 - intensity, 0.1 + 0.65 * intensity, 0.04 + 0.46 * intensity, 0.01 + 0.24 * intensity];
  const total = w[0]! + w[1]! + w[2]! + w[3]!;
  let roll = stream.next() * total;
  let k = 0;
  for (let i = 0; i < 4; i++) {
    roll -= w[i]!;
    if (roll <= 0) { k = i; break; }
  }
  const times: number[] = [];
  for (let i = 0; i < k; i++) times.push(from + stream.next() * (to - from));
  times.sort((a, b) => a - b);
  // Enforce the gap by dropping, never nudging: a nudged time is a time nobody drew.
  const spaced: number[] = [];
  for (const t of times) {
    if (spaced.length === 0 || t - spaced[spaced.length - 1]! >= EPISODE_GAP_MS) spaced.push(t);
  }
  return spaced;
}

/**
 * What tonight's episode is made of: up to three of the day's most charged fragments plus one
 * remote thing from anywhere in her, all HERS. Null when she has too little to dream on,
 * an empty week gives thin nights, honestly.
 */
export function pickSeeds(
  dayNodes: readonly DreamSeed[],
  remotePool: readonly DreamSeed[],
  stream: Stream,
): DreamSeed[] | null {
  const hers = (s: DreamSeed): boolean =>
    (s.origin === "lived" || s.origin === "thought" || s.origin === "dreamt") && s.text.trim().length > 0;
  const day = dayNodes.filter(hers).sort((a, b) => charge(b) - charge(a));
  const seeds: DreamSeed[] = day.slice(0, 2);
  const rest = day.slice(2);
  if (rest.length > 0) seeds.push(rest[Math.floor(stream.next() * rest.length)]!);
  const remote = remotePool.filter((s) => hers(s) && !seeds.some((x) => x.id === s.id));
  if (remote.length > 0) seeds.push(remote[Math.floor(stream.next() * remote.length)]!);
  const unique = [...new Map(seeds.map((s) => [s.id, s])).values()];
  return unique.length >= 2 ? unique : null;
}

function charge(s: DreamSeed): number {
  return clamp01(s.tension) + Math.abs(s.valence);
}

/** How hard the episode presses: what decides whether morning keeps any of it. */
export function episodeCharge(seeds: readonly DreamSeed[]): number {
  if (seeds.length === 0) return 0;
  const t = seeds.reduce((sum, s) => sum + clamp01(s.tension), 0) / seeds.length;
  const v = seeds.reduce((sum, s) => sum + Math.abs(s.valence), 0) / seeds.length;
  return clamp01(0.6 * t + 0.6 * v);
}

// ── The words (each one reviewed by hand before dreaming was switched on) ────────────────────

// What a dream IS stays (it does not keep to sense, and nothing has to join up), and whose it is
// (first person, happening now). How long it runs and what it may and may not do went:
// 「两到五句」「只说梦里看见的和心里那阵感觉，不解释，不点题」 were our shape for her dream.
export const DREAM_SYSTEM =
  "你在做梦。梦不讲道理：画面跳画面，人和东西会变形，接不上也没关系。第一人称、现在时。";

export function dreamUser(seeds: readonly DreamSeed[]): string {
  return `梦里浮起的：\n${seeds.map((s) => `- ${s.text}`).join("\n")}\n\n梦下去。`;
}

/** The diary line. 谁都不读 applies to it like everything else in her journal. */
export function diaryLine(nowMs: number, text: string): string {
  return `${herClock(nowMs)} — （梦） ${text}`;
}

/** What her waking material carries when a dream survived the night. */
export function morningLine(text: string): string {
  const t = text.trim().replace(/\s+/gu, " ");
  const q = t.length <= 60 ? t : `${t.slice(0, 59)}…`;
  return `你醒来还留着一点梦：「${q}」。`;
}

// ── Running one episode ───────────────────────────────────────────────────────────────────────

export interface DreamingDeps {
  /** One narrow render in her voice: thinking disabled, small budget, the `dreaming` account. */
  render(system: string, user: string): Promise<string>;
  appendDiary(line: string): void;
  /** Encode the REMEMBERED dream into her field, `dreamt` origin. Only called past the threshold. */
  encodeDream(text: string, nowMs: number, charge: number): void;
  onFault(where: string, detail: unknown): void;
}

export interface EpisodeOutcome {
  ok: boolean;
  text?: string;
  charge?: number;
  survived?: boolean;
}

export function createDreaming(deps: DreamingDeps) {
  return {
    async runEpisode(seeds: readonly DreamSeed[], nowMs: number): Promise<EpisodeOutcome> {
      let text: string;
      try {
        text = (await deps.render(DREAM_SYSTEM, dreamUser(seeds))).trim();
      } catch (err) {
        deps.onFault("dreaming.render", err);
        return { ok: false };
      }
      if (!text) return { ok: false };
      const wrong = notHers(text);
      if (wrong) {
        deps.onFault("dreaming.notProse", `${wrong.why}: ${text.slice(0, 120)}`);
        return { ok: false };
      }
      deps.appendDiary(diaryLine(nowMs, text));
      const c = episodeCharge(seeds);
      const survived = c >= SURVIVES_AT;
      if (survived) deps.encodeDream(text, nowMs, c);
      return { ok: true, text, charge: c, survived };
    },
  };
}
