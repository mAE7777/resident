// Biological clock for the Resident: circadian + ultradian rhythms plus
// stochastic event timing, so spontaneous behavior reads as biological rather
// than cron-driven. Pure code, zero LLM, deterministic given an injected RNG.
//
// Two rhythms produce a continuous activity level in [0,1]: a ~24h circadian
// curve (entrainable to the user's timezone and waking hours) and a ~90min
// ultradian ripple layered on top. Event timing uses a non-homogeneous Poisson
// process whose rate tracks the activity level, sampled by Ogata thinning, with
// Hawkes self-excitation so a recent conversation makes near-term follow-up
// thoughts cluster the way human communication bursts do. A Weibull sampler is
// provided for inter-arrival modeling of the urge to communicate (human
// inter-contact durations fit Weibull better than a power law).
//
// This module GATES NOTHING. It emits signals other organs consult; it never
// decides whether to speak. Time is passed in explicitly (epoch ms) so every
// function is a pure transform and fully testable.

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;
const TWO_PI = Math.PI * 2;

const DEFAULTS = {
  timezoneOffsetHours: 0,
  circadianPeakHour: 15, // late-afternoon alertness peak
  circadianAmplitude: 0.4,
  ultradianPeriodMin: 90,
  ultradianAmplitude: 0.08,
  baselineActivity: 0.5,
  activeHours: [8, 23] as [number, number],
  sleepActivity: 0.05, // activity ceiling while outside waking hours
  nhppMaxRatePerHour: 2, // spontaneous considerations/hour at full activity
  hawkesExcitation: 1.5, // intensity bump per recent event
  hawkesDecayMin: 20, // self-excitation time constant
  weibullShape: 1.5, // >1 = bursty/heavy-tailed inter-arrivals
  eventDelayCapMs: 7 * DAY_MS, // never return a delay longer than this
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClockConfig {
  /** Local time = UTC + this offset. Entrains the circadian curve to the user. */
  timezoneOffsetHours?: number;
  /** Local hour of peak alertness (0-24). */
  circadianPeakHour?: number;
  /** Circadian swing around baseline, 0-1. */
  circadianAmplitude?: number;
  /** Ultradian period in minutes (~90 for the basic rest-activity cycle). */
  ultradianPeriodMin?: number;
  /** Ultradian swing around the circadian curve, 0-1. */
  ultradianAmplitude?: number;
  /** Activity midpoint the rhythms swing around, 0-1. */
  baselineActivity?: number;
  /** Waking window as [startHour, endHour); wraps if start > end. */
  activeHours?: [number, number];
  /** Activity is capped at this value outside waking hours. */
  sleepActivity?: number;
  /** Poisson rate (events/hour) at full activity. */
  nhppMaxRatePerHour?: number;
  /** Hawkes intensity added per recent event, before decay. */
  hawkesExcitation?: number;
  /** Hawkes decay time constant in minutes. */
  hawkesDecayMin?: number;
  /** Weibull shape for the inter-arrival sampler. */
  weibullShape?: number;
  /** Injectable uniform [0,1) source. Defaults to Math.random. */
  rng?: () => number;
}

export interface Clock {
  /** Circadian curve alone, in [-1,1], peaking at the configured peak hour. */
  circadian(nowMs: number): number;
  /** Ultradian ripple alone, in [-1,1]. */
  ultradian(nowMs: number): number;
  /** Combined activity level in [0,1], floored while asleep. */
  activityLevel(nowMs: number): number;
  /** Whether nowMs falls inside the waking window. */
  isAwakeHour(nowMs: number): boolean;
  /**
   * How much of a stretch fell outside her waking hours.
   *
   * HER NIGHT IS NOT A STALL, and nothing knew that. `moments_stalled` is critical past three
   * hours and is one of the few codes that put her in safe mode, while her waking window is
   * fifteen hours out of twenty-four, so the nine-hour gap between her last evening moment
   * and her first morning one is normal, expected, and was read as her life loop having
   * stopped. Every night, on a machine that was working perfectly.
   *
   * The sleep watcher already discounts time the PROCESS was suspended, on exactly this
   * reasoning: an alarm that measures her by wall-clock has to subtract the time she was not
   * available to act. Her own quiet hours are the same fact arriving by a different route, and
   * they were not subtracted at all.
   */
  quietMsBetween(fromMs: number, toMs: number): number;
  /** Local hour in [0,24) for nowMs. */
  localHour(nowMs: number): number;
  /** NHPP intensity (events/hour) at nowMs, including Hawkes self-excitation. */
  intensity(nowMs: number, recentEventsMs?: readonly number[]): number;
  /** Delay (ms) until the next spontaneous consideration, via Ogata thinning. */
  nextEventDelayMs(nowMs: number, recentEventsMs?: readonly number[]): number;
  /** A Weibull-distributed inter-arrival sample in ms. */
  weibullDelayMs(scaleMs: number): number;
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/** Positive modulo (JS % keeps the sign of the dividend). */
function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * mulberry32: a tiny deterministic PRNG. Exported so callers (and tests) can get
 * reproducible timing from a seed. Not for cryptographic use.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Weibull inverse-CDF sample. shape k>0, scale λ>0, u uniform [0,1). */
export function weibullSample(shape: number, scale: number, u: number): number {
  const uu = u >= 1 ? 1 - Number.EPSILON : u;
  return scale * Math.pow(-Math.log(1 - uu), 1 / shape);
}

// ── Factory ────────────────────────────────────────────────────────────────────

export function createClock(config: ClockConfig = {}): Clock {
  const tz = config.timezoneOffsetHours ?? DEFAULTS.timezoneOffsetHours;
  const peakHour = config.circadianPeakHour ?? DEFAULTS.circadianPeakHour;
  const ampC = config.circadianAmplitude ?? DEFAULTS.circadianAmplitude;
  const ultradianPeriodMin = config.ultradianPeriodMin ?? DEFAULTS.ultradianPeriodMin;
  const ampU = config.ultradianAmplitude ?? DEFAULTS.ultradianAmplitude;
  const baseline = config.baselineActivity ?? DEFAULTS.baselineActivity;
  const activeHours = config.activeHours ?? DEFAULTS.activeHours;
  const sleepActivity = config.sleepActivity ?? DEFAULTS.sleepActivity;
  const maxRate = config.nhppMaxRatePerHour ?? DEFAULTS.nhppMaxRatePerHour;
  const hawkesExcitation = config.hawkesExcitation ?? DEFAULTS.hawkesExcitation;
  const hawkesDecayMs = (config.hawkesDecayMin ?? DEFAULTS.hawkesDecayMin) * MIN_MS;
  const weibullShape = config.weibullShape ?? DEFAULTS.weibullShape;
  const rng = config.rng ?? Math.random;

  function localHour(nowMs: number): number {
    return mod(nowMs / HOUR_MS + tz, 24);
  }

  function circadian(nowMs: number): number {
    // cos peaks (=1) when localHour == peakHour, troughs (=-1) 12h opposite.
    return Math.cos((TWO_PI * (localHour(nowMs) - peakHour)) / 24);
  }

  function ultradian(nowMs: number): number {
    // Continuous across days: phase from absolute epoch minutes.
    return Math.sin((TWO_PI * (nowMs / MIN_MS)) / ultradianPeriodMin);
  }

  /**
   * Integrated in ten-minute steps rather than solved analytically.
   *
   * The waking window is a pair of local hours, and the wall clock crosses DST and can be
   * changed under her. Stepping asks the same question the rest of the system asks
   * (`isAwakeHour`) at points along the stretch, so it can never disagree with it, which a
   * closed-form version, quietly assuming days are 24 hours, eventually would.
   */
  function quietMsBetween(fromMs: number, toMs: number): number {
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return 0;
    const STEP = 10 * 60 * 1000;
    // Capped at a fortnight of stepping so a nonsense timestamp cannot spin the event loop.
    const span = Math.min(toMs - fromMs, 14 * 24 * 3.6e6);
    let quiet = 0;
    for (let t = fromMs; t < fromMs + span; t += STEP) {
      if (!isAwakeHour(t)) quiet += Math.min(STEP, fromMs + span - t);
    }
    return quiet;
  }

  function isAwakeHour(nowMs: number): boolean {
    const h = localHour(nowMs);
    const [start, end] = activeHours;
    if (start <= end) return h >= start && h < end;
    // Wrapped window, e.g. [22, 6).
    return h >= start || h < end;
  }

  function activityLevel(nowMs: number): number {
    const raw = baseline + ampC * circadian(nowMs) + ampU * ultradian(nowMs);
    const level = clamp01(raw);
    if (!isAwakeHour(nowMs)) return Math.min(level, sleepActivity);
    return level;
  }

  function hawkesTerm(nowMs: number, recentEventsMs: readonly number[]): number {
    let sum = 0;
    for (const e of recentEventsMs) {
      if (e > nowMs) continue; // future events do not excite the present
      sum += hawkesExcitation * Math.exp(-(nowMs - e) / hawkesDecayMs);
    }
    return sum;
  }

  function intensity(nowMs: number, recentEventsMs: readonly number[] = []): number {
    const base = maxRate * activityLevel(nowMs);
    return base + hawkesTerm(nowMs, recentEventsMs);
  }

  function nextEventDelayMs(nowMs: number, recentEventsMs: readonly number[] = []): number {
    // Ogata thinning: propose at a rate that upper-bounds the true intensity,
    // then accept each proposal with probability lambda(t)/lambdaSup.
    const hawkesMax = hawkesExcitation * recentEventsMs.length;
    const lambdaSupPerHour = maxRate + hawkesMax + 1e-9;
    const lambdaSupPerMs = lambdaSupPerHour / HOUR_MS;

    let t = nowMs;
    // A generous iteration cap: with acceptance this converges fast; the wall
    // is only for a pathological all-reject streak.
    for (let i = 0; i < 10000; i++) {
      const u1 = rng();
      const dt = -Math.log(1 - u1) / lambdaSupPerMs;
      t += dt;
      if (t - nowMs > DEFAULTS.eventDelayCapMs) return DEFAULTS.eventDelayCapMs;
      const lambdaT = intensity(t, recentEventsMs) / HOUR_MS;
      const u2 = rng();
      if (u2 <= lambdaT / lambdaSupPerMs) return t - nowMs;
    }
    return DEFAULTS.eventDelayCapMs;
  }

  function weibullDelayMs(scaleMs: number): number {
    return weibullSample(weibullShape, scaleMs, rng());
  }

  return {
    circadian,
    ultradian,
    activityLevel,
    isAwakeHour,
    quietMsBetween,
    localHour,
    intensity,
    nextEventDelayMs,
    weibullDelayMs,
  };
}
