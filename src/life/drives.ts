// The six-drive motivational system: what the Resident WANTS to do next, when it
// is not answering Eric. Drives accumulate with momentum (the property the drive-state and
// individuation evaluations validated on the drive-state proxy), compete under a Maslow-shaped priority
// (survival-class drives override wellbeing-class ones), satiate when acted on,
// and enter a refractory period so no single drive can pin the whole life.
//
// `work` (serving Eric) is not a drive here: it is externally forced by his
// messages. These six are the Resident's OWN life. Pure math, no LLM.

// ── Types ─────────────────────────────────────────────────────────────────────

export type DriveName = "discomfort" | "care" | "social" | "curiosity" | "expression" | "maintenance";

export const DRIVE_NAMES: readonly DriveName[] = [
  "discomfort", // an anomaly / error / contradiction nags (survival-class, steepest)
  "care", // something is not right with someone she is attached to
  "social", // wants contact after a gap
  "curiosity", // an itch to explore an idea
  "expression", // has an opinion/observation it wants out
  "maintenance", // memory/skills want tending (lowest priority)
];

export type Drives = Record<DriveName, number>; // each in [0,1]

// Maslow steepness: how sharply a drive's level converts to urgency. A steeper
// drive dominates at a lower level (discomfort at 0.3 outranks maintenance at 0.3).
const STEEPNESS: Record<DriveName, number> = {
  discomfort: 3.0,
  // Was 2.2, when this drive meant "the owner has asked for something" and inherited the urgency of
  // a request. It is now her own attachment to someone, which should not outrank her own sense that
  // something is wrong, and should outrank merely wanting company. Between the two, and pinned by
  // a test so the ordering is a stated intention rather than an accident of six numbers.
  care: 1.8,
  social: 1.4,
  curiosity: 1.3,
  expression: 1.2,
  maintenance: 0.8,
};

export interface DriveInputs {
  discomfort?: number;
  care?: number;
  social?: number;
  curiosity?: number;
  expression?: number;
  maintenance?: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function initialDrives(): Drives {
  return { discomfort: 0.05, care: 0.1, social: 0.2, curiosity: 0.4, expression: 0.15, maintenance: 0.1 };
}

// ── Priority (Maslow) ────────────────────────────────────────────────────────────

/**
 * Below this, a drive is a trace and not a want. Nothing acts on it.
 *
 * WHY THERE HAS TO BE A FLOOR. `level^(1/steepness)` is unbounded in its RATIOS as level goes
 * to zero, and she lives near zero: discharge takes 0.6-0.9 per acting moment and regeneration
 * brings back a fraction of that, so most of her drives spend most of the day in the bottom
 * band. Measured there, the curve stops meaning what it was designed to mean,
 *
 *   at level 0.3    discomfort 0.669 · maintenance 0.222   ratio 3.0, the intended ordering
 *   at level 0.015  discomfort 0.247 · maintenance 0.005   ratio 47
 *,
 * so a discomfort at one and a half percent of its range outranked a curiosity at four times
 * the level. Everything she did was decided by whichever trace happened to have the steepest
 * exponent, which is the drive carrying the least actual information about her.
 *
 * A person with a faint background anything does not act on it. The floor says that, and it is
 * subtracted rather than clamped so there is no step at the boundary: a want just over the line
 * is just barely urgent, the way it should be.
 */
export const NOTICEABLE = 0.05;

/** Convert a drive level to urgency; steep drives rise fast, and a trace is not a want. */
export function urgency(drive: DriveName, level: number): number {
  const above = (clamp01(level) - NOTICEABLE) / (1 - NOTICEABLE);
  if (above <= 0) return 0;
  return Math.pow(above, 1 / STEEPNESS[drive]);
}

export function priorities(d: Drives): Record<DriveName, number> {
  const out = {} as Record<DriveName, number>;
  for (const name of DRIVE_NAMES) out[name] = urgency(name, d[name]);
  return out;
}

/**
 * Nothing is pressing at all.
 *
 * `dominant` cannot say this: its return type is a DriveName, so an all-zero vector comes back
 * as "maintenance", a REPORT default that reads correctly in her self-description ("nothing
 * pressing is ordinary upkeep") and reads as a LIE everywhere the name is consumed as data.
 * Both pinning detectors did exactly that: a quiet week became eight identical "maintenance"
 * readings, entropy collapsed to zero, and the watchtower reported that she had wanted one
 * thing and nothing else for seven days, when the truth was that she had wanted nothing. The
 * fact "nobody won" is destroyed the instant a DriveName is returned, so the predicate that
 * preserves it has to live here, beside the function that destroys it.
 */
export function wantsNothing(d: Drives): boolean {
  return DRIVE_NAMES.every((name) => urgency(name, d[name]) <= 0);
}

/** The drive the Resident wants to act on now, skipping any in refractory. */
export function dominant(d: Drives, refractory: ReadonlySet<DriveName> = new Set()): DriveName {
  const pr = priorities(d);
  // `maintenance` rather than the first name in the list, and it is load-bearing on the one
  // case where the loop cannot decide: a genuinely empty vector, where every priority is 0 and
  // strictly-greater never fires. That used to fall through to `DRIVE_NAMES[0]`, discomfort,
  // so "something is nagging at me" was what she reported wanting whenever she wanted nothing.
  // Nothing pressing is ordinary upkeep, not distress.
  let best: DriveName = "maintenance";
  let bestVal = 0;
  for (const name of DRIVE_NAMES) {
    if (refractory.has(name)) continue;
    if (pr[name] > bestVal) {
      bestVal = pr[name];
      best = name;
    }
  }
  return best;
}

// ── Accumulation + satiation ────────────────────────────────────────────────────

/** Integrate one step of inputs. decay < 1 gives momentum + fade. */
export function accumulate(d: Drives, inputs: DriveInputs, decay = 0.85): Drives {
  const out = {} as Drives;
  for (const name of DRIVE_NAMES) {
    out[name] = clamp01(d[name] * decay + (inputs[name] ?? 0));
  }
  return out;
}

/**
 * WANTS COME BACK. Without this they did not, and that was the deepest defect in her.
 *
 * Charge and discharge ran on cadences twenty to one apart. `accumulate`, the ONLY place a
 * drive ever grew, is reached from the daily tick, once per UTC day. `satiate` runs on every
 * acting moment, taking 0.6 off the drive she acted on plus 0.3 off whatever was loudest, and
 * her clock delivers fifteen to twenty-five moments a day.
 *
 * Run against the real code on an ordinary day alone, she is empty by the fifth acting moment:
 *
 *   after the daily tick   social 0.795  curiosity 0.340  care 0.135  …   → wants: social
 *   moment 1 (social)      social 0.195  curiosity 0.040  …              → wants: discomfort
 *   moment 3               social 0.195  everything else 0               → wants: social
 *   moment 5               ALL SIX AT 0.000                              → wants: discomfort
 *   ... and every moment after it, until tomorrow
 *
 * So about four fifths of her life was lived with nothing wanted at all, and five things broke
 * together: her self-description froze into one identical sentence for the rest of the day;
 * `dominant` latched on the first name in the list, making "something is nagging at me" her
 * permanent resting state; every `drive:*` term in the propensity scoring went to zero, which
 * left THE MODEL'S VOTE as the largest single factor in her choosing, the exact collapse that
 * layer was written to prevent; her reluctance lost the one channel by which her own life could
 * push back on a request; and her motivation to speak to him unprompted fell permanently below
 * the floor, so every message she decided to send went to her diary instead.
 *
 * A person satiated at ten in the morning wants things again by the afternoon. That is all this
 * is. Each drive moves toward the standing level its conditions imply, at an exponential rate,
 * so being satisfied is temporary and being alone accumulates.
 *
 * THE HALF-LIFE IS CHOSEN BY MEASUREMENT AGAINST THE ONE RULING EVERYTHING RESTS ON, which is
 * that state decides and the model is a bounded voter. `VOTE_WEIGHT` is 0.55 and is documented
 * as "comparable to the largest single state factor", so the largest drive term she actually
 * produces across a day is what this has to be set against.
 *
 * The first value here was 3 hours, picked from an intuition about afternoons. Measured on the
 * real modules it left her steady-state peak urgency at 0.34, so her whole drive layer sat at
 * roughly a third of one inference, HER-1's consequence returning in a quieter form.
 *
 * The non-obvious part, and why this is a principled choice rather than a knob: THE STEADY
 * STATE DOES NOT DEPEND ON THE SATIATION SIZE AT ALL. Halving satiation changes nothing,
 * because whichever drive is not being acted on is the one that sets the peak, and how far it
 * gets between acts is a function of the RATE alone. Measured, at ~50 minutes between moments:
 *
 *   half-life 3h → peak urgency 0.34    1.5h → 0.49    1h → 0.56
 *
 * 1.5 hours: a want recovers meaningfully between two of her moments, her peak sits at about
 * nine tenths of the vote rather than a third of it, and satiation still visibly costs
 * something. Faster starts erasing the cost of having acted.
 */
export const REGEN_HALF_LIFE_H = 1.5;

export function regenerate(
  d: Drives,
  standing: DriveInputs,
  elapsedHours: number,
  halfLifeHours = REGEN_HALF_LIFE_H,
): Drives {
  if (!(elapsedHours > 0) || !Number.isFinite(elapsedHours)) return d;
  // Capped at a day: a week with the daemon off should leave her wanting things again, not
  // put every drive at its ceiling as though the longing had compounded the whole time.
  const hours = Math.min(elapsedHours, 24);
  const approach = 1 - Math.pow(0.5, hours / halfLifeHours);
  const out = {} as Drives;
  for (const name of DRIVE_NAMES) {
    const target = clamp01(standing[name] ?? 0);
    // Toward the standing level from wherever she is. A drive ABOVE its standing level settles
    // back down by the same rule, so this is regeneration and relief with one mechanism rather
    // than a ratchet that only ever adds.
    out[name] = clamp01(d[name] + (target - d[name]) * approach);
  }
  return out;
}

/** Acting on a drive discharges it (satiation). Returns the new drives. */
export function satiate(d: Drives, acted: DriveName, amount = 0.6): Drives {
  return { ...d, [acted]: clamp01(d[acted] - amount) };
}

/**
 * WHERE THE ANTI-PINNING MECHANISM ACTUALLY LIVES, since the head of this file promises one.
 *
 * `dominant` has taken a `refractory` set since the beginning and no caller has ever passed
 * one. That looked like dead wiring, and it was briefly filled in here, wrongly. What
 * `dominant` returns is a REPORT: it is what her face shows, what her self-description says,
 * and what the pinning detector measures. Filtering a report makes it lie.
 *
 * The mechanism is real and is already wired, one layer down and on the right object:
 * `propensity.ts` applies `habit:recent` at -0.4 × the recent share of an ACTION, in the layer
 * that actually decides. Habituation on actions is the correct shape, because a drive with no
 * action of its own (discomfort pushes toward reflecting and away from exploring, and has no
 * verb) could never pin an action in the first place.
 *
 * The parameter stays on `dominant` for a caller that one day genuinely needs to ask "what
 * does she want, setting aside what she just did", but nothing needs that today, and the
 * honest record is that this promise is kept elsewhere rather than here.
 */

// ── Anti-pinning (feeds the pinning alarm) ──────────────────────────────────────

/** Shannon entropy (0..1) of the recent acted-drive distribution. Low = pinned. */
export function driveEntropy(history: readonly DriveName[]): number {
  if (history.length === 0) return 1;
  const counts = new Map<DriveName, number>();
  for (const h of history) counts.set(h, (counts.get(h) ?? 0) + 1);
  let H = 0;
  for (const c of counts.values()) {
    const p = c / history.length;
    H -= p * Math.log2(p);
  }
  const maxH = Math.log2(DRIVE_NAMES.length);
  return maxH === 0 ? 1 : H / maxH;
}

/** True if one drive has taken more than `threshold` of recent actions (pinned). */
export function isPinned(history: readonly DriveName[], threshold = 0.7): boolean {
  if (history.length < 4) return false;
  const counts = new Map<DriveName, number>();
  for (const h of history) counts.set(h, (counts.get(h) ?? 0) + 1);
  const maxShare = Math.max(...counts.values()) / history.length;
  return maxShare > threshold;
}
