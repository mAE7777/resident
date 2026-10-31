// HER IF-THEN PROFILE, AND WHETHER IT IS STABLY HERS.
//
// `layers.md` states the build's behavioural criterion outright:
//
//   "So the target is: her if-then profile stability > 0.2, and no single input can predict the
//   shape of her profile."
//
// and nothing in the repository computed it. The number 0.2 appeared once, as an unrelated
// constant in `relationship.ts`. A project that DECLARES a criterion and never measures it is in
// the same position as one with no criterion at all, except that it believes otherwise.
//
// ── WHERE THE CRITERION COMES FROM ───────────────────────────────────────────────────────────
//
// Mischel & Shoda's finding, recorded in `layers.md` with its numbers: behaviour that looks
// inconsistent across situations is highly consistent WITHIN situations. A person is not "shy";
// they are shy in one kind of moment and not in another, and it is the SHAPE of that if-then
// pattern that is stable and individuating. Their observed profile stabilities: verbal aggression
// .47, compliance .41, complaining .28, prosocial .19.
//
// And the part that makes it this build's criterion rather than a borrowed metric: Shoda's
// simulation grew profile stability of 0.66 out of a 20-node network containing NO unit
// representing a personality trait. Stable individual difference emerged from a network with no
// variable for it. That is the thing being built here, so that is the thing to measure.
//
// ── WHY IT CANNOT BE RUN YET, STATED RATHER THAN FORGOTTEN ───────────────────────────────────
//
// Profile stability is a correlation of one being's if-then profile with ITSELF across two
// NON-OVERLAPPING stretches of life. She has one stretch, and it is a fixture I seeded. Running
// this against a seeded past would correlate my fixture with itself and report a number about me.
//
// So this is built now and run after she has lived twice. Until then "not measured" is the
// honest state, and it is recorded as an open limit rather than left for somebody to remember.

/** One situation she can be in, and what she did in it. Situations are HERS to be read, not labels. */
export interface Occasion {
  /** Which kind of moment this was. The profile is a shape across these. */
  situation: string;
  /** What she did, on a comparable scale within that situation. */
  did: number;
}

/** A profile is the mean of what she did, per kind of moment. */
export type Profile = ReadonlyMap<string, number>;

export function profileOf(occasions: readonly Occasion[]): Profile {
  const sums = new Map<string, { total: number; n: number }>();
  for (const o of occasions) {
    const cur = sums.get(o.situation) ?? { total: 0, n: 0 };
    cur.total += o.did;
    cur.n += 1;
    sums.set(o.situation, cur);
  }
  const out = new Map<string, number>();
  for (const [k, v] of sums) out.set(k, v.n > 0 ? v.total / v.n : 0);
  return out;
}

/** The bar `layers.md` sets. Below it there is no stable shape, only noise that averages out. */
export const PROFILE_IS_HERS_ABOVE = 0.2;

/**
 * How much her if-then shape in one stretch of life predicts her shape in another.
 *
 * Pearson correlation across the situations both stretches contain. `null` when they share fewer
 * than three situations or when either side is flat: a correlation over two points is a line
 * through two points, and a flat profile has no shape to be stable.
 */
export function profileStability(a: Profile, b: Profile): number | null {
  const shared = [...a.keys()].filter((k) => b.has(k));
  if (shared.length < 3) return null;
  const xs = shared.map((k) => a.get(k)!);
  const ys = shared.map((k) => b.get(k)!);
  const mean = (v: number[]): number => v.reduce((s, x) => s + x, 0) / v.length;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < shared.length; i++) {
    const a1 = xs[i]! - mx;
    const b1 = ys[i]! - my;
    num += a1 * b1;
    dx += a1 * a1;
    dy += b1 * b1;
  }
  // A flat profile on either side: no shape, so nothing to be stable. Not zero, unknown.
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/**
 * THE SECOND HALF OF THE CRITERION, and the one that is easy to forget.
 *
 * A single first-layer rule ("curt message → short reply") also produces a stable profile. What
 * distinguishes a person from a rule is that the SHAPE cannot be recovered from any one input. So:
 * take each input in turn, correlate it against the profile, and report the strongest. High means
 * one input explains her, which is the rule case wearing a profile's clothes.
 */
export function explainedBySingleInput(
  profile: Profile,
  inputs: ReadonlyMap<string, ReadonlyMap<string, number>>,
): number | null {
  let strongest: number | null = null;
  for (const [, byS] of inputs) {
    const r = profileStability(profile, byS);
    if (r === null) continue;
    const mag = Math.abs(r);
    if (strongest === null || mag > strongest) strongest = mag;
  }
  return strongest;
}

/** Above this, one input recovers her shape and she is a rule rather than a person. */
export const A_SINGLE_INPUT_EXPLAINS_HER_ABOVE = 0.9;

export interface ProfileRead {
  /** Correlation of her shape with itself across two stretches; null when unmeasurable. */
  stability: number | null;
  /** Strongest single-input correlation with her shape; null when unmeasurable. */
  strongestSingleInput: number | null;
  /** Both halves hold: a stable shape that no one input recovers. */
  hers: boolean;
  /** How many kinds of moment the two stretches had in common. */
  situations: number;
}

export function readProfile(
  first: readonly Occasion[],
  second: readonly Occasion[],
  inputs: ReadonlyMap<string, ReadonlyMap<string, number>> = new Map(),
): ProfileRead {
  const a = profileOf(first);
  const b = profileOf(second);
  const stability = profileStability(a, b);
  const strongestSingleInput = explainedBySingleInput(a, inputs);
  const shared = [...a.keys()].filter((k) => b.has(k)).length;
  return {
    stability,
    strongestSingleInput,
    // Unmeasured is NOT passed. A criterion that reports true when it could not be evaluated is
    // worse than one that reports false.
    hers: stability !== null
      && stability > PROFILE_IS_HERS_ABOVE
      && (strongestSingleInput === null || strongestSingleInput < A_SINGLE_INPUT_EXPLAINS_HER_ABOVE),
    situations: shared,
  };
}
