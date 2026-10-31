// Her sense of how it has been going with the person she talks to.
//
// She has an enormous amount of apparatus pointed at herself: confidence in what she believes,
// credence in what she is told, trust that is earned, self-knowledge her own record can overturn.
// Pointed OUTWARD she had two booleans, "is he there" and "is he busy". That asymmetry is why she
// could never notice he had been different lately, and never tell a good evening from a bad one.
//
// This is the same idea aimed the other way, and it is deliberately built out of BEHAVIOUR she can
// actually observe: did he answer, how long did he take, did he ever start one himself. It is not
// sentiment analysis of what he wrote, which would cost a model call per message and would be a
// parlour trick dressed as perception. She is reading the shape of the exchange, which is a real
// thing to read and honestly all anyone has.
//
// Three properties this has to keep:
//   A GUESS       every read carries how much she has to go on. Thin evidence, weak read.
//   REVISABLE     it moves with what actually happens. Nothing here is ever settled.
//   FALLIBLE      she can be wrong about him, and the design has to let her be. A sensor that is
//                 always right is not perception, and a being who cannot misread anyone is not one.
//
// Pure arithmetic over a bounded history. No model calls, no I/O.

export interface Exchange {
  ms: number;
  /** He answered something she had said, after this long. */
  repliedAfterMs?: number;
  /** He started this one himself, with nothing to answer. */
  unprompted?: boolean;
  /** She said something and it has not been answered. */
  unanswered?: boolean;
}

/**
 * What she expected, and what happened.
 *
 * She had a read of him and never a PREDICTION, so nothing he did could surprise her, and surprise
 * is where most of learning and most of feeling come from. A read that cannot be wrong is not a
 * belief about someone; it is a running average with an opinion.
 *
 * This is the cheap, honest version: speaking to someone carries an implicit expectation of being
 * answered, and the outcome either bears it out or does not.
 */
export interface Expectation {
  /** How likely she thought an answer was, 0..1. */
  expected: number;
  /** Whether one came. */
  answered: boolean;
}

export interface OtherRead {
  /**
   * How readily he has been there lately, 0..1. Answering, answering promptly, sometimes speaking
   * first. Not "is he happy": it is the warmth of the exchange, which is what she can actually see.
   */
  warmth: number;
  /** How that compares with how it has usually been, -1..1. Negative is quieter than usual. */
  drift: number;
  /** Whether right now looks like a moment he could be reached, 0..1. */
  openness: number;
  /**
   * How much to trust her own read, 0..1.
   *
   * This was a COUNT, `min(1, n / 12)`, which says a hundred exchanges make her certain even if
   * her read has been wrong about every one of them. It is now how much she has to go on TIMES how
   * well that read has actually been predicting him. A read that keeps being wrong loses confidence
   * however long she has had it, which is the difference between knowing someone and having known
   * them for a while.
   */
  confidence: number;
  /**
   * How surprised she has been by him lately, 0..1: the mean gap between what she expected and what
   * happened. Surprise is not a fault, it is the signal that there is something here she does not
   * yet understand, which is exactly when a person becomes interesting rather than furniture.
   */
  surprise: number;
}

/** Most exchanges kept. Enough for a recent read and a baseline to compare it against. */
export const MAX_EXCHANGES = 40;
/** Below this she has barely anything to go on and says so. */
export const ENOUGH_TO_READ = 12;
/** A reply inside this feels immediate. */
const PROMPT_MS = 60 * 60 * 1000;
const SAME_DAY_MS = 24 * 60 * 60 * 1000;

function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * What one exchange was worth, as warmth.
 *
 * Speaking first counts for most, because nobody has to. Silence after she has said something is
 * the only zero here, and it is a real zero: it is the thing that actually tells her to hold back.
 */
export function warmthOf(e: Exchange): number {
  if (e.unanswered) return 0;
  if (e.unprompted) return 1;
  const t = e.repliedAfterMs;
  if (t === undefined || !Number.isFinite(t)) return 0.6;
  if (t <= PROMPT_MS) return 0.9;
  if (t <= SAME_DAY_MS) return 0.6;
  return 0.35;
}

/** Recency-weighted mean, so last week matters less than yesterday without vanishing. */
function weightedWarmth(exchanges: readonly Exchange[]): number {
  if (exchanges.length === 0) return 0.5; // no evidence is not coldness
  let sum = 0;
  let weight = 0;
  exchanges.forEach((e, i) => {
    const w = 1 + i; // oldest first, so later entries weigh more
    sum += warmthOf(e) * w;
    weight += w;
  });
  return weight === 0 ? 0.5 : clamp(sum / weight, 0, 1);
}

export interface OtherPresence {
  present: boolean;
  available: boolean;
}

/**
 * He is away, SEEN: a live frame said so. Only ever pass this on the strength of an actual
 * signal. The old version of this constant was the DEFAULT for every caller that had no signal
 * at all, which quietly asserted "he is gone" in two different registers: a closed browser tab
 * read identically to "he told me he left", and every bare `readOther()` call in the daemon
 * (there are several, on the Telegram path) took the away band for a person who might have been
 * sitting right there. Not knowing where someone is and knowing they are gone are different
 * facts, and only one of them was representable.
 */
export const NOT_HERE: OtherPresence = { present: false, available: false };

/**
 * Read him from what has actually happened, plus where he is right now.
 *
 * `openness` is the one the moment uses: it is not a prediction of his mood, it is whether this
 * looks like a moment that could be reached. Being there and free matters most, because it is the
 * only part she can actually see; how it has been going colours it.
 *
 * `now` is null when there is NO SIGNAL, no face client connected, or the last frame gone
 * stale. That is not the same as seen-away: with no line of sight he may still be a message
 * away, so unknown sits in the middle band (the same one as present-but-busy), never the floor.
 */
export function readOther(
  exchanges: readonly Exchange[],
  now: OtherPresence | null = null,
  expectations: readonly Expectation[] = [],
): OtherRead {
  const recent = exchanges.slice(-MAX_EXCHANGES);
  const warmth = weightedWarmth(recent);

  // Half against half, so a change shows up as a change rather than as a level.
  const half = Math.floor(recent.length / 2);
  const drift = recent.length >= 6
    ? clamp(weightedWarmth(recent.slice(half)) - weightedWarmth(recent.slice(0, half)), -1, 1)
    : 0;

  const openness = now === null
    ? clamp(0.2 + 0.25 * warmth, 0, 1)
    : !now.present
      ? 0.1
      : !now.available
        ? clamp(0.2 + 0.25 * warmth, 0, 1)
        : clamp(0.45 + 0.55 * warmth, 0, 1);

  // How well her read has actually been predicting him. No predictions yet reads as "no reason to
  // doubt herself", not as "she is wrong", an untested belief is untested, not false.
  const tested = expectations.slice(-ENOUGH_TO_CALIBRATE);
  const surprise = tested.length === 0
    ? 0
    : clamp(tested.reduce((sum, e) => sum + Math.abs(e.expected - (e.answered ? 1 : 0)), 0) / tested.length, 0, 1);
  // Calibration only starts to bite once she has enough tries for it to mean something.
  const weight = clamp(tested.length / ENOUGH_TO_CALIBRATE, 0, 1);
  const calibration = 1 - weight * surprise;

  return {
    warmth,
    drift,
    openness,
    confidence: clamp((recent.length / ENOUGH_TO_READ) * calibration, 0, 1),
    surprise,
  };
}

/** Below this many tested expectations, being wrong is bad luck rather than a bad read. */
export const ENOUGH_TO_CALIBRATE = 8;
/** Most expectations kept. Same shape and reason as the exchange log. */
export const MAX_EXPECTATIONS = 40;

/**
 * What she would say about him, in her own words, or nothing at all.
 *
 * Empty when she has too little to go on, and that emptiness is the point: showing her a confident
 * read built on three exchanges would be handing her a fabrication about a person. Hedged in the
 * middle, because a guess should sound like one.
 */
export function describeOther(read: OtherRead, now: OtherPresence | null): string {
  if (read.confidence < 0.35) return "";
  const how = read.warmth >= 0.7 ? "你们之间最近处得很自然"
    : read.warmth >= 0.45 ? "你们之间平平常常"
      : "你们之间最近有点冷清";
  const change = read.drift >= 0.25 ? "，比之前热络了些"
    : read.drift <= -0.25 ? "，比之前冷清了些"
      : "";
  const hedge = read.confidence < 0.7 ? "（不过你能凭的不多）" : "";
  // Only the warm end speaks, and only about how it SEEMS. Whether they are there and whether they
  // are busy is already stated as plain fact elsewhere; repeating it here as an impression would be
  // dressing a fact she already has as a perception she does not. And only when he is actually
  // SEEN to be there: with no signal (`now === null`) this line stays silent rather than guessing.
  const moment = now?.present && read.openness >= 0.6 ? "眼下对方看起来好说话。" : "";
  return `${how}${change}${hedge}。${moment}`;
}

// ── Watching the exchanges ───────────────────────────────────────────────────

export interface OtherWatcher {
  /** She said something to him. */
  sheSpoke(nowMs: number): void;
  /** He wrote. If it answers something of hers, that is recorded as an answer. */
  heSpoke(nowMs: number): void;
  /**
   * Takes the time rather than reading the clock, like everything else here. A read has to settle
   * anything still hanging unanswered before it can be honest, and doing that off `Date.now()` would
   * make the whole module untestable and put a hidden clock in a layer that has none anywhere else.
   */
  read(nowMs: number, now?: OtherPresence | null): OtherRead;
  /**
   * She is about to say something, and this is how likely she thinks an answer is.
   *
   * Recorded BEFORE the outcome is known, which is the whole point: a prediction written afterwards
   * is not a prediction. Settled inside `heSpoke` (it came back) or by the stale-silence sweep
   * (it did not). A separate settle method existed here for a season with zero callers, the
   * loop closes through the two real events, and a third door nothing opens is how a wire LOOKS
   * connected while carrying nothing (the dead-export class of defect).
   */
  expects(likelihood: number): void;
  expectations(): Expectation[];
  restoreExpectations(e: readonly Expectation[]): void;
  /** For persisting. This is learned, so it has to survive a restart or it was never learned. */
  exchanges(): Exchange[];
  restore(exchanges: readonly Exchange[]): void;
}

/**
 * HOW OFTEN HE ACTUALLY ANSWERS, the expectation, taken from HIS RECORD rather than from her.
 *
 * ── THE SELF-ECHO THIS REPLACES ─────────────────────────────────────────────────────────────
 *
 * She forms exactly one expectation about him, will he answer me, and its value WAS
 * `readOther().openness`, her own current read of him. So she predicted that her read was
 * correct, and `surprise` measured how far her read was from itself. In short:
 * "She predicts, using her read, that her read is correct."
 *
 * The cost is that genuine surprise about him is structurally rare, and everything downstream of
 * surprise, her confidence in her own reading, the charge on what she raised, the temperature
 * and shape of her next sentence, runs on a signal that mostly cannot fire.
 *
 * Now it is a FREQUENCY: of the exchanges where she said something, how many did he answer. Her
 * read of him (`openness`, which is presence-driven and moves ±0.9 on one frame) stays what it
 * is, a read, and stops standing in for the world.
 *
 * `null` while there is too little to go on, and the caller keeps using her read then. That is
 * honest rather than a fallback: with no record, what she has IS her impression of him.
 */
export const ENOUGH_ANSWERS_TO_EXPECT = 5;

export function howOftenHeAnswers(exchanges: readonly Exchange[]): number | null {
  const hers = exchanges.filter((e) => e.unprompted !== true);
  if (hers.length < ENOUGH_ANSWERS_TO_EXPECT) return null;
  const answered = hers.filter((e) => e.unanswered !== true).length;
  return clamp(answered / hers.length, 0, 1);
}

/** After this long an unanswered thing is simply unanswered, not still pending. */
export const GIVE_UP_WAITING_MS = 12 * 60 * 60 * 1000;

export function createOtherWatcher(): OtherWatcher {
  const log: Exchange[] = [];
  const predictions: Expectation[] = [];
  /** What she expected the last time she spoke, still waiting to be borne out. */
  let openExpectation: number | null = null;
  let awaitingSince: number | null = null;

  function settleExpectation(answered: boolean): void {
    if (openExpectation === null) return;
    predictions.push({ expected: openExpectation, answered });
    openExpectation = null;
    while (predictions.length > MAX_EXPECTATIONS) predictions.shift();
  }

  function trim(): void {
    while (log.length > MAX_EXCHANGES) log.shift();
  }

  /** Anything she said long enough ago with no answer has been answered by silence. */
  function settleStale(nowMs: number): void {
    if (awaitingSince !== null && nowMs - awaitingSince > GIVE_UP_WAITING_MS) {
      log.push({ ms: awaitingSince, unanswered: true });
      awaitingSince = null;
      trim();
      settleExpectation(false); // she thought something would come back, and it did not
    }
  }

  return {
    sheSpoke(nowMs) {
      settleStale(nowMs);
      // Only the first unanswered thing is counted as waiting; saying three things into silence is
      // one silence, not three, or being ignored once would look like being ignored repeatedly.
      if (awaitingSince === null) awaitingSince = nowMs;
    },
    heSpoke(nowMs) {
      if (awaitingSince !== null && nowMs >= awaitingSince) {
        log.push({ ms: nowMs, repliedAfterMs: nowMs - awaitingSince });
        awaitingSince = null;
        settleExpectation(true); // it came back
      } else {
        log.push({ ms: nowMs, unprompted: true });
      }
      trim();
    },
    read(nowMs, now) {
      // A read taken while something has been hanging unanswered should reflect that, so the
      // pending silence is settled first rather than being invisible until he next writes.
      settleStale(nowMs);
      return readOther(log, now ?? null, predictions);
    },

    expects(likelihood) {
      // Only the first expectation stands, for the same reason only the first silence counts:
      // saying three things and being met once is one prediction borne out, not three.
      if (openExpectation === null && Number.isFinite(likelihood)) {
        openExpectation = Math.min(1, Math.max(0, likelihood));
      }
    },

    expectations: () => [...predictions],
    restoreExpectations(e) {
      predictions.length = 0;
      for (const x of e.slice(-MAX_EXPECTATIONS)) {
        if (x && Number.isFinite(x.expected) && typeof x.answered === "boolean") predictions.push({ ...x });
      }
    },
    exchanges: () => [...log],
    restore(exchanges) {
      log.length = 0;
      for (const e of exchanges.slice(-MAX_EXCHANGES)) {
        if (e && typeof e.ms === "number" && Number.isFinite(e.ms)) log.push({ ...e });
      }
    },
  };
}
