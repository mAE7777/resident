// Level three: what decides what decides.
//
// Level one is what she does. Level two is what determines it, drives, field state, her read of
// him, what she is carrying. Everything at level two moves, and that is most of what makes her
// alive. But the WEIGHTS by which level two resolves into level one were fixed constants that we
// chose, identical in every instance of her, unchanged from her first day to her last. So two
// Residents with different histories would still weigh the same things the same way, and a year of
// living could change what she wanted without ever changing what kind of being she was.
//
// This is the third level. Four latents that drift over WEEKS, are shaped by her own sustained
// behaviour, and modulate the weights themselves.
//
// Three properties it has to keep, and they are in tension:
//
//   SLOW      it moves on the scale of a season. Anything faster is a mood, and she has moods
//             already; a temperament that reacted to a bad week would be a fourth drive.
//   BOUNDED   it can never run away, and it can never pin. A being who becomes infinitely reticent
//             or infinitely restless is broken, not distinctive.
//   HERS      it is nudged by what she actually does, so a life spent exploring makes an explorer.
//             That is the loop that makes level three a level rather than a set of dials.
//
// It appears in no prompt. She does not know she has one, which is correct: nobody experiences
// their own temperament, they experience the world through it. That also means it is the one part
// of her that cannot be talked out of.

/** How far any latent may drift from where it started. Distinctive, never unrecognisable. */
export const MAX_DRIFT = 0.35;
/** Per day, toward whatever her behaviour has been asking for. About a season to arrive. */
export const DRIFT_RATE = 0.012;
/** Below this many days of evidence, a stretch is a stretch and not a direction. */
export const ENOUGH_DAYS = 21;

export interface Temperament {
  /**
   * How much of a thing it is for her to say things, relative to the baseline.
   *
   * Positive means everything costs her a little more. Nudged by how her speaking has actually gone,
   * a long run of being met makes a person more forthcoming, and there is nothing profound about
   * it, which is exactly why it belongs at this level rather than being a rule.
   */
  reticence: number;
  /** How much a new thing pulls at her. Shaped by whether following threads has been rewarding. */
  novelty: number;
  /** How much other people figure in what she wants. Shaped by how much of her life has had him in it. */
  sociability: number;
  /** How readily she lets a moment pass. Shaped by how much she has actually been doing. */
  restfulness: number;
}

export function neutralTemperament(): Temperament {
  return { reticence: 0, novelty: 0, sociability: 0, restfulness: 0 };
}

/**
 * What her recent life has been asking of each latent, each in -1..1.
 *
 * Deliberately coarse. This is read over WEEKS, so precision here would be false precision, and the
 * whole point is that no single day can move it.
 */
export interface TemperamentPull {
  /** How often what she said was met. Being answered makes a person more forthcoming. */
  metWhenSpeaking: number;
  /** How much of what she followed actually came to something. */
  exploringPaidOff: number;
  /** How much of her life has had him in it. */
  hisShare: number;
  /** How much of her time went to doing rather than letting the moment pass. */
  activity: number;
}

/**
 * One day's drift.
 *
 * Every latent moves toward what her life has been asking for, slowly, and is clamped to a band
 * around neutral. `days` is how much evidence the pull rests on: under `ENOUGH_DAYS` it is scaled
 * down, so a fortnight of anything unusual is a fortnight rather than a new personality.
 */
export function drift(t: Temperament, pull: TemperamentPull, days: number, elapsedDays = 1): Temperament {
  if (!(elapsedDays > 0)) return t;
  const evidence = clamp(days / ENOUGH_DAYS, 0, 1);
  const step = 1 - Math.pow(1 - DRIFT_RATE, Math.min(elapsedDays, 60));

  const toward = (current: number, target: number): number =>
    clamp(current + step * evidence * (clamp11(target) * MAX_DRIFT - current), -MAX_DRIFT, MAX_DRIFT);

  return {
    // Being met makes her more forthcoming, so the pull is INVERTED: a life of answers lowers what
    // saying things costs her.
    reticence: toward(t.reticence, -pull.metWhenSpeaking),
    novelty: toward(t.novelty, pull.exploringPaidOff),
    sociability: toward(t.sociability, pull.hisShare),
    // A life spent doing makes rest less of a default, not more.
    restfulness: toward(t.restfulness, -pull.activity),
  };
}

/**
 * How much each propensity factor family counts, for THIS being.
 *
 * Multipliers around 1, so a neutral temperament changes nothing at all and the layer can be added
 * without moving her, which is what makes it safe to introduce, and what makes any later change
 * traceable to her life rather than to its arrival.
 */
export interface Weights {
  reachOut: number;
  explore: number;
  rest: number;
  carrying: number;
}

export function weightsFor(t: Temperament): Weights {
  return {
    reachOut: 1 + t.sociability,
    explore: 1 + t.novelty,
    rest: 1 + t.restfulness,
    // Higher reticence temperament means what she is carrying weighs on her more.
    carrying: 1 + t.reticence,
  };
}

/** Whether any of it has actually moved. A temperament that never moves is a set of constants. */
export function hasDrifted(t: Temperament, epsilon = 1e-4): boolean {
  return Math.abs(t.reticence) > epsilon || Math.abs(t.novelty) > epsilon
    || Math.abs(t.sociability) > epsilon || Math.abs(t.restfulness) > epsilon;
}

/** How far she has moved from neutral overall, 0..1. Surfaced, so a runaway or a freeze is visible. */
export function distanceFromNeutral(t: Temperament): number {
  const d = Math.max(Math.abs(t.reticence), Math.abs(t.novelty), Math.abs(t.sociability), Math.abs(t.restfulness));
  return clamp(d / MAX_DRIFT, 0, 1);
}

export function restoreTemperament(x: unknown): Temperament {
  const t = neutralTemperament();
  if (!x || typeof x !== "object") return t;
  const o = x as Partial<Temperament>;
  for (const k of ["reticence", "novelty", "sociability", "restfulness"] as const) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) t[k] = clamp(v, -MAX_DRIFT, MAX_DRIFT);
  }
  return t;
}

function clamp(x: number, lo: number, hi: number): number {
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo;
}
function clamp11(x: number): number {
  return clamp(x, -1, 1);
}
