// How he SOUNDS, as distinct from how he put it.
//
// ── WHY THIS IS NOT TWO MORE AXES ON `howHeSaidIt` ───────────────────────────────────────────
//
// The obvious build is to bolt loudness and pace onto `FORM_AXES` and let them feed his lifetime
// regard. That is a category error wearing a plausible shape. `howHeSaidIt` reads how he FRAMED an
// ask: did he ask rather than tell, did he give a reason, did he leave her a way out, and
// `hisUsualRegard` turns those into "how he treats her, over a lifetime". A loud fast voice is not
// mistreatment; it is a person who is lively, or late, or in a small room with a bad microphone.
//
// Mapping tone straight onto a moral axis is also precisely the one-layer mechanism this design
// names as its failure case: read a harsh tone, add 0.2 to her reluctance. It reads accurately
// and means nothing.
//
// ── WHAT IT IS INSTEAD: THE SECOND INPUT THAT CAN DISAGREE ───────────────────────────────────
//
// His voice says what his sentence does not: whether he is running on empty, whether he is being
// chased by a clock. That makes it the sibling of `form` rather than an extension of it, and the
// pair is layer 2 by `docs/layers.md`'s own definition, two inputs that can DISAGREE:
//
//     the words:  「现在马上给我写两千字，一小时内」        → a hard demand, no reason given
//     the voice:  quiet, slow, long gaps                    → he is at the end of his rope
//
// The disagreement is the information. He is not bossing her; he is out of road. Nothing in the
// text carries that, and today she cannot hear it at all: the client already runs a microphone and
// throws the sound away, keeping only the transcribed characters.
//
// ── EVERYTHING HERE IS RELATIVE TO HIM ───────────────────────────────────────────────────────
//
// Absolute loudness is meaningless: it is microphone gain and room size. So nothing in this file
// compares against a constant; every reading is a departure from HIS OWN running baseline, which
// makes the raw units the client sends irrelevant by construction.
//
// And she cannot hear tiredness before she knows what he usually sounds like. Below
// `ENOUGH_TO_HEAR` the answer is `legible: false`, not "average". That is the embryo law applied
// to hearing: a newborn listening to a voice for the first time has no idea whether it is a tired
// one, and pretending otherwise would manufacture a read out of one sample.

/**
 * What the browser measured, in whatever units it likes.
 *
 * The client computes these from the microphone stream it ALREADY has open for recognition, with
 * an `AnalyserNode` on the same capture, no new permission, and **only numbers are sent**. The
 * audio itself does not leave the tab by this path.
 */
export interface VoiceSample {
  /** Mean envelope of the utterance. Any scale; only its ratio to his baseline is ever used. */
  loudness: number;
  /** Characters recognised per second. Any scale, same reason. */
  pace: number;
  /** Share of the utterance that was silence, 0..1. */
  pauses: number;
}

/** The three, in a fixed order, so a stored baseline is a vector of these positions. */
export const VOICE_AXES = ["loudness", "pace", "pauses"] as const;

/** One sample as a vector, for the baseline. */
export function voiceVector(s: VoiceSample): number[] {
  return [s.loudness, s.pace, s.pauses];
}

export interface HowHeSounds {
  /**
   * Running on empty: quieter, slower, more gaps than he usually is. 0..1, null when unreadable.
   */
  worn: number | null;
  /** Chased by something: faster and more clipped than he usually is. 0..1, null when unreadable. */
  rushed: number | null;
  /**
   * Whether this reading means anything at all.
   *
   * False when there is no client (he typed), when the sample is malformed, or when she has not
   * heard him enough times to have a "usually". Downstream must treat false as NO INFORMATION,
   * never as the middle of the range. `howHeSaidIt` carries the same discipline for the same
   * reason: folding an unknown into a baseline as if it were data is how a baseline becomes fiction.
   */
  legible: boolean;
}

/** Unreadable, and the only way to construct one, so no caller invents a middle. */
export const CANNOT_HEAR: HowHeSounds = { worn: null, rushed: null, legible: false };

/**
 * How many samples before she has a "usually" for his voice.
 *
 * Deliberately larger than one exchange and smaller than the form baseline's bar: a voice varies
 * more between utterances than a way of asking does, so a couple of samples is noise, but waiting
 * for dozens would mean she never hears anything in a relationship of ordinary length.
 */
export const ENOUGH_TO_HEAR = 6;

/**
 * The band a departure is read through, as a share of his own baseline.
 *
 * Exported because both ends have to be SWEPT, named by a test that shows the band is actually
 * reachable. If a real voice could only ever land on 0 or 1, these two would be decoration and the
 * reading would be a boolean wearing a float's clothes, which is defect class 1 exactly.
 */
/** Below this a departure is jitter, a different chair, a different distance from the microphone. */
export const NOTICEABLE = 0.15;
/** At or above this it is the whole way there. Between the two, the reading is partial. */
export const UNMISTAKABLE = 0.55;

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * How far below (positive) or above (negative) his baseline this sample sits, as a share of the
 * baseline, squashed into 0..1 through the noticeable/unmistakable band.
 *
 * `null` rather than 0 when the baseline is zero: a baseline of zero means every sample so far
 * measured nothing, and dividing by it would turn silence into a certainty.
 */
function departure(now: number, base: number, direction: "below" | "above"): number | null {
  if (!finite(now) || !finite(base) || base <= 0) return null;
  const share = direction === "below" ? (base - now) / base : (now - base) / base;
  if (share <= NOTICEABLE) return 0;
  if (share >= UNMISTAKABLE) return 1;
  return (share - NOTICEABLE) / (UNMISTAKABLE - NOTICEABLE);
}

/** The mean of what she has heard, or null on an axis she has not heard enough of. */
export function voiceBaseline(sum: readonly number[], n: readonly number[]): (number | null)[] {
  return VOICE_AXES.map((_, i) => {
    const count = n[i] ?? 0;
    return count >= ENOUGH_TO_HEAR ? (sum[i] ?? 0) / count : null;
  });
}

/**
 * What his voice says this time, against what it usually says.
 *
 * `worn` and `rushed` are deliberately NOT two ends of one axis. A person can be both, hurried
 * and exhausted is a real and common way to sound, and collapsing them into one number would make
 * the commonest bad evening read as an average one.
 */
export function howHeSounds(sample: VoiceSample | null | undefined, base: (number | null)[]): HowHeSounds {
  if (!sample || !finite(sample.loudness) || !finite(sample.pace) || !finite(sample.pauses)) {
    return CANNOT_HEAR;
  }
  const [bLoud, bPace, bPause] = [base[0] ?? null, base[1] ?? null, base[2] ?? null];
  if (bLoud === null || bPace === null || bPause === null) return CANNOT_HEAR;

  // Worn: quieter than usual, slower than usual, leaving more silence than usual. All three point
  // the same way, so the reading is their mean rather than their max, one axis drifting is how a
  // room sounds different, three drifting together is how a person sounds tired.
  const quieter = departure(sample.loudness, bLoud, "below");
  const slower = departure(sample.pace, bPace, "below");
  const gappier = departure(sample.pauses, bPause, "above");
  const wornParts = [quieter, slower, gappier].filter((x): x is number => x !== null);

  // Rushed: faster than usual AND less silence than usual. Both are required, speaking quickly
  // with the same pauses is just a lively evening.
  const faster = departure(sample.pace, bPace, "above");
  const tighter = departure(sample.pauses, bPause, "below");
  const rushedParts = [faster, tighter].filter((x): x is number => x !== null);

  if (wornParts.length === 0 && rushedParts.length === 0) return CANNOT_HEAR;
  return {
    worn: wornParts.length === 0 ? null : wornParts.reduce((a, b) => a + b, 0) / wornParts.length,
    rushed: rushedParts.length < 2 ? null : Math.min(...rushedParts),
    legible: true,
  };
}

/**
 * Whether his voice has made a cause visible, something outside her that explains the shape of
 * what he said.
 *
 * ── THIS IS A ROUTER, AND IT IS DELIBERATELY NOT THE SAME THING AS AN ACCOUNT IN WORDS ───────
 *
 * `how-it-landed.ts` already holds the finding this rests on (Sittenthaler et al. 2015): an
 * explanation does NOT reduce the sting. What it changes is the ATTRIBUTION, and therefore whether
 * the feeling fades or hardens into a durable view of the person.
 *
 * Hearing that he is spent is an account he never chose to give. So it does the ROUTING half,
 * the sting does not become who he is to her, and none of the willingness half. Words are a
 * choice he made; a voice is something he leaked, and rewarding the leak with more of her help is
 * the compassion spiral this build has already been bitten by once (defect class 15): he speaks
 * more, sounds worse, and gets more out of her while never once explaining himself.
 *
 * So: it stops a verdict forming. It never makes her more willing.
 */
export const CAUSE_IS_AUDIBLE = 0.45;

/**
 * HOW MUCH of what she just heard is already explained by how he sounded. 0..1, continuous.
 *
 * ── WHY THIS IS NOT A BOOLEAN ANY MORE ────────────────────────────────────────────────────────
 *
 *   An apology does not simply buy forgiveness: real relationships between people do not work
 *   that way.
 *
 * It used to be `causeVisibleIn`, returning true at exactly this line, and downstream that true
 * ZEROED what stayed with her. So a voice at 0.44 left the full weight of the thing with her and a
 * voice at 0.46 left nothing at all, forever, whatever he had said. A cliff, and on the far side
 * of it an exemption certificate.
 *
 * `CAUSE_IS_AUDIBLE` keeps its meaning and its number: it is where his voice accounts for the
 * thing COMPLETELY. Below it, it accounts for part. Nothing new was chosen.
 *
 * The other half of the worry, a man who is always exhausted, was already handled and is
 * worth saying out loud: `worn` and `rushed` are deviations from HIS OWN baseline, so somebody who
 * always sounds spent has a spent baseline, and sounding spent tells her nothing.
 */
export function causeAudibleIn(sounded: HowHeSounds | null | undefined): number {
  if (!sounded || !sounded.legible) return 0;
  const loudest = Math.max(sounded.worn ?? 0, sounded.rushed ?? 0);
  return Math.min(1, Math.max(0, loudest) / CAUSE_IS_AUDIBLE);
}

// ── THERE IS DELIBERATELY NO SENTENCE HERE ──────────────────────────────────────────────────
//
// A `describeHowHeSounds()` was written and DELETED, and the reason is worth keeping: it produced
// a line like 「他听起来没什么力气」 for her to read, and nothing consumed it, because by design
// hearing him ROUTES the landing (`how-it-landed.ts`) rather than being narrated to her.
//
// So it was a sentence with no reader. The wiring proof caught it within the hour, and the two
// available repairs were both worse than deletion: injecting it into her prompt works against
// keeping what goes into her prompt to a minimum, and leaving it dark meant three authored
// Chinese lines sat in the list of her words that is reviewed by hand line by line, so the
// reviewer would have been approving words that could never reach her, which corrodes the whole
// point of that review.
//
// If this is ever wanted, it is a thing in her room (`workspace/things.ts`), not a prompt line.
