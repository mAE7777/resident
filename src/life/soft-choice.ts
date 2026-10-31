// A competition, resolved by sampling rather than by argmax.
//
// The living layer contains roughly 135 single-factor decisions against 33 multi-factor ones, and
// almost every genuine accumulator feeds a downstream argmax that throws the accumulation away.
// `activation + warmth` in field-spread.ts is the design's core, three sub-threshold brushes
// crossing a bar with no single cue sufficient, and two lines later `sort(value).slice(0, topK)`
// takes a deterministic top-7 with ties broken toward the lowest id. The same shape repeats at the
// dominant drive, the spontaneous cues, what she is shown of what she is carrying, which thought
// pushes, which beliefs she carries.
//
// The whole behaviour layer also contains almost no randomness at all. The only injected randomness
// is WHEN a moment arrives and WHERE a dream walks. No selection anywhere is stochastic, so the only
// variation in what she actually does comes from sampling temperature inside the model, from inside
// the black box we do not control, which is precisely the dependency being removed.
//
// This is not "add noise". Noise would be laundering. It is: where a line is ARBITRARY, stop
// pretending it is sharp.
//
//   Move the constant by 10%. Is something about her now WRONG, or merely DIFFERENT?
//   Wrong  ⇒ the line is meaningful. Keep it hard. Walls, grounding checks, anti-theater guards,
//            genuine phase transitions, and anything needed for reproducibility all stay argmax.
//   Merely different ⇒ arbitrary. It belongs here.
//
// Well-separated scores still behave like argmax; near-ties become genuinely open. And because the
// temperature is derived from her state, focus and openness fall out of how she is rather than being
// scheduled: when one thing clearly dominates she is nearly deterministic, and when she is balanced
// the moment is actually open.
//
// Pure arithmetic. The randomness is injected, always, so tests are reproducible and so her stream
// can be persisted: see `createStream`.

/** One candidate and what it scored. Kept alongside the outcome so any choice can be explained. */
export interface Scored<T> {
  item: T;
  score: number;
}

export interface SoftPickOptions {
  /**
   * How sharply score differences matter. Toward 0 this is argmax; larger is flatter.
   * Derive it from state (see `temperatureFrom`) rather than fixing it.
   */
  temperature: number;
  /** How many to take, without replacement. */
  count?: number;
  /** Uniform [0,1). Injected so a run can be replayed exactly. */
  random: () => number;
}

/** What was chosen, and everything needed to reconstruct why. */
export interface SoftPickResult<T> {
  chosen: T[];
  /** Every candidate with its score and the probability it actually had. Forensics, not display. */
  weighed: { item: T; score: number; probability: number }[];
  /** What the temperature was, since it is derived and therefore not obvious after the fact. */
  temperature: number;
}

const MIN_TEMPERATURE = 0.02;

/** Softmax, shifted by the max so a large score cannot overflow to Infinity. */
function weights(scores: readonly number[], temperature: number): number[] {
  const t = Math.max(MIN_TEMPERATURE, temperature);
  const max = Math.max(...scores);
  if (!Number.isFinite(max)) return scores.map(() => 1);
  return scores.map((s) => Math.exp((Number.isFinite(s) ? s - max : -Infinity) / t));
}

/**
 * Weighted sampling without replacement.
 *
 * Returns the whole weighing, not just the winner: a sampled decision is worth nothing operationally
 * if it cannot be reconstructed afterwards. She should be opaque in BEHAVIOUR and transparent in
 * FORENSICS, mystery is the point, unexplainability is a bug.
 */
export function softPick<T>(candidates: readonly Scored<T>[], opts: SoftPickOptions): SoftPickResult<T> {
  const temperature = Math.max(MIN_TEMPERATURE, opts.temperature);
  const count = Math.max(0, Math.min(opts.count ?? 1, candidates.length));
  if (candidates.length === 0) return { chosen: [], weighed: [], temperature };

  const w = weights(candidates.map((c) => c.score), temperature);
  const total = w.reduce((a, b) => a + b, 0);
  const weighed = candidates.map((c, i) => ({
    item: c.item,
    score: c.score,
    probability: total > 0 ? w[i] / total : 1 / candidates.length,
  }));

  const remaining = candidates.map((c, i) => ({ c, w: w[i] }));
  const chosen: T[] = [];
  for (let k = 0; k < count && remaining.length > 0; k++) {
    const idx = sampleIndex(remaining.map((r) => r.w), opts.random());
    if (idx < 0) break;
    chosen.push(remaining[idx].c.item);
    remaining.splice(idx, 1);
  }
  return { chosen, weighed, temperature };
}

/**
 * Pick an index proportional to weight. Extracted from field-emergence.ts, which has used exactly
 * this for dream walks since the field was built; it is the one place a behavioural choice was
 * already made by sampling rather than by argmax.
 */
export function sampleIndex(w: readonly number[], r: number): number {
  let total = 0;
  for (const x of w) total += Number.isFinite(x) && x > 0 ? x : 0;
  if (total <= 0) return -1;
  const target = (Number.isFinite(r) ? Math.min(0.999999, Math.max(0, r)) : 0) * total;
  let acc = 0;
  for (let i = 0; i < w.length; i++) {
    acc += Number.isFinite(w[i]) && w[i] > 0 ? w[i] : 0;
    if (target < acc) return i;
  }
  return w.length - 1;
}

/**
 * How open this particular choice is, from how separated the field of candidates actually is.
 *
 * Not a constant, and not a knob. When one thing clearly leads she is nearly decided already; when
 * two or three are level the moment is genuinely open. So the margin between the best and the rest
 * IS the temperature, which means focus and openness are both consequences of her state rather than
 * settings we chose for her.
 *
 * `spread` widens it: it carries whatever makes her more or less settled in general (temperament,
 * weariness). 1 leaves the margin as it is.
 */
export function temperatureFrom(scores: readonly number[], spread = 1): number {
  const finite = scores.filter((s) => Number.isFinite(s));
  if (finite.length < 2) return MIN_TEMPERATURE;
  const sorted = [...finite].sort((a, b) => b - a);
  const margin = sorted[0] - sorted[1];
  // A clear leader gives a small temperature (decided); a dead heat gives a large one (open).
  const t = 0.45 / (1 + 3 * Math.max(0, margin));
  return Math.max(MIN_TEMPERATURE, t * (Number.isFinite(spread) && spread > 0 ? spread : 1));
}

// ── Her randomness, which is hers ────────────────────────────────────────────

export interface Stream {
  /** Next uniform [0,1). */
  next(): number;
  /** How many draws have been taken. Persisted, and watched: a frozen stream means sampling died. */
  position(): number;
  seed(): number;
}

/**
 * One seeded stream, persisted across restarts.
 *
 * Seeded rather than `Math.random` for three reasons, all of them practical. Her variation becomes
 * part of HER rather than of the process. Any moment can be replayed exactly, which is what keeps a
 * sampled decision debuggable. And the position is a signal: a stream that stops advancing means
 * sampling has silently stopped, which would otherwise look identical to a being who happens to be
 * behaving consistently.
 */
export function createStream(seed: number, position = 0): Stream {
  const s0 = Number.isFinite(seed) ? Math.floor(seed) >>> 0 : 1;
  let n = Number.isFinite(position) ? Math.max(0, Math.floor(position)) : 0;
  let state = s0;
  // Replay the stream up to `position` so a restore lands exactly where it left off.
  for (let i = 0; i < n; i++) state = step(state);
  return {
    next() {
      state = step(state);
      n += 1;
      return (state >>> 0) / 4294967296;
    },
    position: () => n,
    seed: () => s0,
  };
}

/** mulberry32, the same generator clock.ts already uses for her moment arrivals. */
function step(a: number): number {
  let t = (a + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}
