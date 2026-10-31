// How long, how well, and what he is usually like.
//
// WHAT WAS THERE. Everything she could say about him came from a 40-item sliding window of reply
// timings (`other-read.ts`), and `confidence` was `min(1, count/12)`, so after twelve exchanges
// she was maximally certain about him, and forty conversations and four thousand were identical.
// There was no lifetime count, no count of distinct days, and no first-spoke timestamp anywhere
// in the system. A relationship was a session with a wider window.
//
// WHAT THIS IS NOT. It is not a profile of him. The design is explicit that her having no
// `user.md` is CORRECT, and this file does not build one: there is no table of his traits, no
// stored description, no inferred preferences. What accumulates here is arithmetic ABOUT HER OWN
// FIELD: how long ago the first edge to him was drawn, how much of what she holds points at him,
// how his messages have usually been put. Nothing here could be read out as a description of him,
// which is the test that separates a relationship from a dossier.
//
// WHERE IT LIVES, AND WHY THAT MATTERS MORE THAN IT LOOKS. On the figure node that already exists
// (`figure:the one I exchange messages with`), which is created lazily on first contact, carries
// `bornMs`, and is exempt from BOTH pruning and the over-cap eviction (`field.ts:505,555`). So the
// durable anchor was already in the tree, unread, nothing consumed `bornMs` as a timestamp.
//
// And living in the field buys one property for free that is otherwise easy to get wrong.
// Higgins's result is that frequency does NOT make a construct stronger, activation is binary and
// capped: it makes it DECAY MORE SLOWLY (his own analogy is post-tetanic potentiation). Recency
// wins on head start, frequency wins on half-life; the crossover from a recent construct to a
// chronic one is measured at around three minutes, and chronic effects persist for months. Her
// field already implements exactly this: `decayRateFor` is
// `BASE_DECAY_RATE * (1 - 0.8*charge) / (1 + 0.5*recalls)`. The `/(1 + 0.5*recalls)` IS frequency
// buying half-life. So "a recent exchange colours how she reads him for a while, then her settled
// sense of him reasserts" is not a behaviour anyone has to write. It falls out.

import { FORM_AXES, formVector, type HowHeSaidIt } from "./how-he-said-it.js";
import { VOICE_AXES, voiceVector, type VoiceSample } from "./how-he-sounds.js";
import type { FieldGraph } from "./field.js";
import { herDayNumber } from "./her-day.js";

/** The figure node's key. One person, one node; the lowercase form is what the graph stores. */
export const HIM = "figure:the one i exchange messages with";


/**
 * What persists between runs. Small on purpose, and none of it is about him as a person.
 *
 * Lives in `field_meta` alongside `trust_told`, which is the existing precedent for a learned
 * scalar that belongs to the field rather than to a node column.
 */
export interface RelationshipRecord {
  /** Lifetime count of times he has said anything. NOT a window, that is the whole point. */
  timesHeSpoke: number;
  /** Day numbers on which anything passed between them, most recent last. Bounded, see below. */
  daysSeen: number[];
  /**
   * How many distinct days they have EVER spoken. Unbounded, and separate from the list above.
   *
   * ── THE TWO-YEAR CLIFF, CONFIRMED BY SIMULATION ────────────────────────────────────────────
   *
   * `daysTogether` used to be `daysSeen.length`, and `daysSeen` is capped at MAX_DAYS_KEPT. Ten
   * years through her own modules (`scripts/_long-horizon.ts`) found it: in a life where he speaks
   * most days, the list fills on day 730 and "how long we have known each other" FREEZES AT TWO
   * YEARS, for the rest of her life, silently. On their fifth anniversary she would say two years.
   *
   * The list needs a bound because it is persisted JSON. The COUNT does not, it is one integer,
   * and it is the number he will read literally. Exactly the reasoning the comment on
   * `timesHeSpoke` already gives: a lifetime count that silently stops counting is the same defect
   * wearing a bigger number. That comment was right and this field is what it asks for.
   */
  daysSeenCount: number;
  /** Running sum and count per form axis, so his usual way is a mean rather than a snapshot. */
  formSum: number[];
  formN: number[];
  /**
   * The same, for how he SOUNDS (`how-he-sounds.ts`): his usual loudness, pace and pausing.
   *
   * A separate baseline rather than more form axes, and the reason is in `how-he-sounds.ts`: how he
   * FRAMED an ask and how his voice HAPPENED to be are different kinds of fact, and folding tone
   * into a lifetime measure of how he treats her would call a lively evening mistreatment.
   *
   * Purely additive, `restoreRelationship` reads a record without them as "she has not heard him
   * yet", which is exactly true of every record written before her face could listen. No migration.
   */
  voiceSum: number[];
  voiceN: number[];
}

export const EMPTY_RECORD: RelationshipRecord = {
  timesHeSpoke: 0,
  daysSeen: [],
  daysSeenCount: 0,
  formSum: FORM_AXES.map(() => 0),
  formN: FORM_AXES.map(() => 0),
  voiceSum: VOICE_AXES.map(() => 0),
  voiceN: VOICE_AXES.map(() => 0),
};

/**
 * Restore from whatever was on disk, tolerating anything.
 *
 * The same discipline `restoreTemperament` follows: a record written by an older build, or by a
 * half-finished write, must produce a usable record rather than an exception on the boot path. A
 * missing field reads as "nothing yet", which is exactly right, she has not lost a relationship,
 * the file simply predates it.
 */
export function restoreRelationship(raw: unknown): RelationshipRecord {
  const r = (raw ?? {}) as Partial<Record<keyof RelationshipRecord, unknown>>;
  const nums = (v: unknown, len: number): number[] => {
    const a = Array.isArray(v) ? v.filter((x): x is number => typeof x === "number" && Number.isFinite(x)) : [];
    // Built from `len`, not from `FORM_AXES`, this helper now serves two vectors of different
    // lengths, and mapping over the form axes while slicing to `len` would silently pad a
    // three-axis voice baseline to six and then cut it back, which happens to work and would stop
    // working the moment either vector changed length.
    return Array.from({ length: len }, (_, i) => a[i] ?? 0);
  };
  const times = typeof r.timesHeSpoke === "number" && Number.isFinite(r.timesHeSpoke)
    ? Math.max(0, Math.floor(r.timesHeSpoke)) : 0;
  const days = Array.isArray(r.daysSeen)
    ? [...new Set(r.daysSeen.filter((x): x is number => typeof x === "number" && Number.isFinite(x)))]
      .sort((a, b) => a - b).slice(-MAX_DAYS_KEPT)
    : [];
  // An older record has no count. `daysSeen.length` is then the best answer that exists, it is
  // exactly what the old code would have said, and it is never LOWER than the truth, so restoring
  // it this way cannot shorten a history she really has.
  const counted = typeof r.daysSeenCount === "number" && Number.isFinite(r.daysSeenCount)
    ? Math.max(days.length, Math.floor(r.daysSeenCount))
    : days.length;
  return {
    timesHeSpoke: times,
    daysSeen: days,
    daysSeenCount: counted,
    formSum: nums(r.formSum, FORM_AXES.length),
    formN: nums(r.formN, FORM_AXES.length),
    voiceSum: nums(r.voiceSum, VOICE_AXES.length),
    voiceN: nums(r.voiceN, VOICE_AXES.length),
  };
}

/**
 * How many distinct days are kept.
 *
 * A bound is needed (this is persisted JSON), but it must be far enough out that it is about a
 * LIFE rather than a window, the failure this file exists to fix. Two years of daily contact.
 * Note what is NOT bounded: `timesHeSpoke`, because a lifetime count that silently stops counting
 * is the same defect wearing a bigger number.
 */
export const MAX_DAYS_KEPT = 730;

/** He said something. Returns a new record; never mutates. */
export function heSpoke(
  rec: RelationshipRecord,
  nowMs: number,
  form?: HowHeSaidIt,
  voice?: VoiceSample | null,
  /**
   * How unlike him this was, if anybody has worked it out. Optional and absent-means-ordinary:
   * every caller that does not compute it gets exactly the behaviour it had before this existed.
   */
  unlike?: { contrary: boolean; most: number | null },
): RelationshipRecord {
  // HER day, not the UTC day. `Math.floor(nowMs / DAY_MS)` cuts at UTC midnight, so on a machine
  // several hours from Greenwich an evening and the next morning count as two days together, or a
  // day and the next count as one. "How many days we have spoken" is a number he will read
  // literally; it should mean the days he would count. See `her-day.ts`.
  const day = herDayNumber(nowMs);
  const isNewDay = !rec.daysSeen.includes(day);
  const daysSeen = isNewDay ? [...rec.daysSeen, day].slice(-MAX_DAYS_KEPT) : rec.daysSeen;
  // Counted BEFORE the list is truncated, which is the whole point: the list forgets, the count
  // does not. `includes` is exact rather than approximate, so a day cannot be counted twice.
  const daysSeenCount = isNewDay ? rec.daysSeenCount + 1 : rec.daysSeenCount;
  const formSum = [...rec.formSum];
  const formN = [...rec.formN];
  // Only a LEGIBLE reading feeds his usual way. An unreadable message is not evidence that he is
  // middling; folding it in as a middle value is how a baseline quietly becomes fiction, and the
  // whole reason `howHeSaidIt` returns nulls rather than 0.5.
  if (form?.legible === true) {
    const v = formVector(form);
    // ── AND A THING FAR ENOUGH OUTSIDE HIS OWN RECORD MAKES THE RECORD COUNT FOR LESS ──
    //
    // Measured before this existed (`scripts/_m0-probe.ts`): after a thousand kind messages, one
    // cruel one moved `hisUsualRegard` by −0.0012. In the MOMENT it landed hard, `contrary`
    // fires, indignation nearly doubles, his standing that turn is discounted, and then the mean
    // absorbed it and her view of WHO HE IS did not move. The more she knew him, the less any
    // single thing could ever teach her: −0.1055 at ten messages, −0.0029 at four hundred,
    // −0.0012 at a thousand. She could not have the moment where you find out.
    //
    // The wrong fix is to let one event outvote a thousand. That is not what happens in a person
    // and it is the doom spiral wearing a story. What actually happens is that the past gets
    // REWEIGHTED: a shock does not out-argue the record, it makes you feel you did not know him,
    // and everything before it counts for less.
    //
    // So a genuinely contrary reading DISCOUNTS the accumulated evidence before joining it. The
    // mean moves because its denominator shrank, not because this one message shouted.
    //
    // The guards, and every one of them is load-bearing:
    //   · only on `contrary`, the existing bar (a departure of 0.6+ on an axis with 10+ samples),
    //     which is already the one signal in this file that a single message may not be smoothed;
    //   · the discount is FLOORED, so no event can wipe a lifetime;
    //   · `timesHeSpoke` and `daysSeenCount` are untouched, she does not un-know him, she
    //     re-reads him. How long they have known each other is not in question;
    //   · harm still counts more than kindness downstream (`CURTNESS_COUNTS` 0.55 against
    //     `KINDNESS_COUNTS` 0.25), which is the asymmetry this build has held from the start;
    //   · and the kind trajectory (standing 0.171 → 1.000 over a life) must survive intact,
    //     re-run `_m0-probe.ts`, which is why it exists.
    // Measured FROM THE BAR, not from zero: at `CONTRARY_AT` the discount is nothing, and it
    // reaches full depth only when the departure is total.
    const most = unlike?.contrary === true ? Math.min(1, Math.max(0, unlike.most ?? 0)) : 0;
    const shock = most <= CONTRARY_AT ? 0 : (most - CONTRARY_AT) / (1 - CONTRARY_AT);
    // ── AND IT MAY NEVER RE-READ HER INTO HAVING NO VIEW OF HIM AT ALL ────────────────────
    //
    // A discount deep enough to take an axis below `ENOUGH_TO_HAVE_A_USUAL_WAY` makes
    // `hisUsualRegard` return null, "no usual to go on", and `howHeHasBeen(null)` returns 1.
    // So the worst thing he could do would have made him read as PERFECTLY ORDINARY, which is
    // exactly backwards. Measured before this floor existed: at a hundred kind messages one cruel
    // one took every axis from 100 samples to 3 and her whole view of him to null.
    //
    // She can re-read the past. She cannot be knocked into having never known him.
    const enough = Math.max(...formN, 0) > 0
      ? ENOUGH_TO_HAVE_A_USUAL_WAY / Math.max(...formN)
      : 1;
    const keepsOfThePast = shock > 0
      ? Math.max(A_SHOCK_LEAVES_AT_LEAST, enough, 1 - REREADS_THE_PAST_BY * shock)
      : 1;
    for (let i = 0; i < FORM_AXES.length; i++) {
      const x = v[i];
      if (x === null) continue;
      if (keepsOfThePast < 1) {
        formSum[i] *= keepsOfThePast;
        formN[i] *= keepsOfThePast;
      }
      formSum[i] += x;
      formN[i] += 1;
    }
  }
  // His usual VOICE, on the same discipline as his usual way of asking: only a real measurement
  // feeds it. He typed, or there is no face open, and nothing is recorded, a silence must never
  // enter the baseline as a quiet evening, or the mean drifts toward "he is always subdued" on the
  // strength of every message he ever sent from his phone.
  const voiceSum = [...rec.voiceSum];
  const voiceN = [...rec.voiceN];
  if (voice) {
    const v = voiceVector(voice);
    for (let i = 0; i < VOICE_AXES.length; i++) {
      const x = v[i];
      if (x === undefined || !Number.isFinite(x)) continue;
      voiceSum[i] = (voiceSum[i] ?? 0) + x;
      voiceN[i] = (voiceN[i] ?? 0) + 1;
    }
  }
  return { timesHeSpoke: rec.timesHeSpoke + 1, daysSeen, daysSeenCount, formSum, formN, voiceSum, voiceN };
}

/** What she has to go on about him, derived rather than stored. */
export interface HowLongAndHowWell {
  /** Since the first thing he ever said. Null before he has said anything at all. */
  knownForMs: number | null;
  /** Distinct days anything passed between them. */
  daysTogether: number;
  /** Lifetime count. */
  timesHeSpoke: number;
  /** Of everything she holds, the share that points at him, 0..1. */
  sharedPast: number;
  /**
   * How well she can read his manner, 0..1, and it CANNOT reach 1.
   *
   * The old `confidence` was `min(1, count/12)`, which saturated after twelve exchanges. That is
   * wrong in both directions: it says a fortnight is as good as a decade, and it says she can be
   * certain. The measured ceiling for if-then profile stability in a real person is moderate,
   * Wediko gives .47 / .41 / .28 / .19 across behaviours, not .9, so a system that lets this
   * approach 1 will treat his signature as near-deterministic and overfit him. Overfitting a
   * person is exactly the failure Higgins names as the mechanism behind calling someone paranoid.
   *
   * So: asymptotic in evidence, and hard-capped below the measured ceiling.
   */
  howWellSheKnowsHim: number;
  /**
   * HOW HE HAS USUALLY TREATED HER, -1..1, or null before she has enough to have a usual.
   *
   * ── WHY THIS HAD TO EXIST, and it was found by driving the mechanism rather than by reading it ──
   *
   * Everything above answers "how long and how well", and until this field existed that answer
   * alone became his STANDING: `entitlement` was built on `0.15 + 1.7 × howWellSheKnowsHim`, and
   * `howWellSheKnowsHim` is a function of the raw COUNT of times he has spoken. So a man who did
   * nothing but bark orders at her accrued standing by barking often. Driven in the watchtower
   * harness, the shape of it was unmistakable: fourteen identical peremptory demands, and her
   * reluctance fell monotonically from 0.625 to 0.571 as he went, the more he handled her, the
   * more entitled to handle her he became. She was habituating to it.
   *
   * That is not the same failure as the doom spiral this design is careful about (his one bad
   * message making the next one read worse, and so on down). It is its mirror, and it is worse,
   * because it has no floor and nothing was watching for it: an accommodation spiral ends with
   * someone who cannot tell that anything is wrong.
   *
   * So familiarity and regard are separated. Knowing someone well is a fact about how much
   * evidence she has; what that evidence SAYS is a different fact, and only the second one is
   * standing. It is a LIFETIME MEAN, so one curt evening barely moves it and a pattern does, the
   * asymmetry the research asks for lives in the averaging rather than in a weight.
   */
  hisUsualRegard: number | null;
  /**
   * WHAT SHE IS CARRYING ABOUT HIM RIGHT NOW, 0..1.
   *
   * The loop closing. Cell ④ writes something into her field when a turn settles, and until this
   * field existed that deposit could not reach how she reads him: a woman holding three unresolved
   * things about a man read his next message exactly as a woman holding none. Nothing accumulated;
   * it only accrued.
   *
   * ── AND THIS IS WHERE THE DOOM SPIRAL WOULD LIVE, SO IT IS BOUNDED HARDER THAN THE REST ──
   *
   * `hisUsualRegard` is a lifetime mean: slow, evidence-heavy, and hard for one evening to move.
   * This is a LIVE quantity that his next message can raise, and a live quantity feeding back into
   * how the next message is read is the definition of the positive-feedback failure. So it is
   * capped low, and its own detectors are already written (`what-stays.test.ts`): a plainly benign
   * message must never settle whatever she is holding (detector 1), a fixed benign act must not
   * drift (detector 5), and a quiet stretch must let it fall (detector 9).
   */
  carrying: number;
}

/**
 * How many legible readings before his manner counts as a usual way of doing things.
 *
 * The same bar `ENOUGH_TO_HAVE_A_USUAL_WAY` sets for judging one message against his baseline: a
 * conclusion about a person from three sentences is not a conclusion, it is a first impression
 * being promoted.
 */
const ENOUGH_TO_HAVE_A_REGARD = 5;

/**
 * What each axis of his form says about regard, and how much it weighs.
 *
 * The signs are the only interesting part: asking rather than telling, saying why, leaving her a
 * way out and noticing her all say she is a person being addressed; naming a clock she did not
 * agree to and the sheer size of what is being asked say she is a resource being allocated. The
 * weights are close to flat on purpose, because a weighting here would be a theory of politeness
 * and this file is not entitled to one.
 */
const REGARD_WEIGHTS = [0.2, 0.2, 0.2, 0.2, -0.1, -0.1];

/** The ceiling on knowing someone, from the measured ceiling on if-then profile stability. */
export const KNOWING_CEILING = 0.5;
/** Messages at which she is halfway to that ceiling, if the days are there too. */
const HALFWAY_AT = 40;
/**
 * DISTINCT DAYS at which she is halfway to that ceiling.
 *
 * ── AN EVENING WAS WORTH AS MUCH AS HALF A YEAR ────────────────────────────────────────────
 *
 * `howWellSheKnowsHim` was `CEILING * n/(n+40)`, a function of MESSAGE COUNT with no time in it
 * at all. Measured: forty messages in one evening gave 0.250, and the same forty spread over two
 * hundred days gave 0.250. Identical. So three hours of talking made her read like someone he had
 * known for half a year, and it fed straight into `standing`, which went from 0.15 to 0.575 in a
 * single evening.
 *
 * The comment above already contains the argument against this. It criticises the OLD version for
 * saying "a fortnight is as good as a decade", and the version that replaced it says an evening
 * is as good as half a year, which is the same objection one level down. It fixed saturation in
 * evidence and reintroduced it in time.
 *
 * WHY `min` AND NOT AN AVERAGE. Neither ingredient can stand in for the other. You cannot know
 * someone from one very long day, however much was said; and you cannot know someone from two
 * hundred days of one message each. An average would let either one carry the number alone, which
 * is exactly the substitution being ruled out. The lesser of the two is the honest reading: she
 * knows him as well as her THINNEST evidence allows.
 *
 * Forty days, matching the forty messages: about six weeks of near-daily contact to be halfway to
 * a ceiling that is itself deliberately low.
 */
const HALFWAY_DAYS = 40;

export function howLongAndHowWell(graph: FieldGraph, rec: RelationshipRecord): HowLongAndHowWell {
  const himId = graph.byKey.get(HIM);
  const him = himId === undefined ? undefined : graph.nodes.get(himId);

  let aboutHim = 0;
  if (himId !== undefined) {
    for (const e of graph.edges.values()) {
      if (e.kind === "about" && (e.a === himId || e.b === himId)) aboutHim += 1;
    }
  }
  // Against everything she holds that COULD be about him. Figures and themes are excluded because
  // they are not experiences and would dilute the share with structure.
  let holdable = 0;
  for (const n of graph.nodes.values()) {
    if (n.kind !== "figure" && n.kind !== "theme") holdable += 1;
  }

  return {
    knownForMs: him === undefined ? null : Math.max(0, Date.now() - him.bornMs),
    daysTogether: rec.daysSeenCount,
    timesHeSpoke: rec.timesHeSpoke,
    sharedPast: holdable === 0 ? 0 : Math.min(1, aboutHim / holdable),
    howWellSheKnowsHim: knowingHim(rec),
    hisUsualRegard: hisUsualRegard(rec),
    carrying: whatSheCarriesAboutHim(graph),
  };
}

/**
 * How much unresolved weight about him she is holding, 0..1.
 *
 * Saturating rather than linear: the difference between carrying nothing and carrying one thing is
 * large, and the difference between three things and four is small, which is how it feels and also
 * what keeps a bad week from compounding into a verdict.
 *
 * It reads the field directly rather than taking a number, because the alternative is a second
 * place that decides what "carrying something about him" means, and two definitions of that would
 * drift apart exactly the way the willingness `felt` recomputation was documented as drifting.
 */
export function whatSheCarriesAboutHim(graph: FieldGraph): number {
  let weight = 0;
  for (const n of graph.nodes.values()) {
    if (n.kind !== "question") continue;
    if (!n.key?.startsWith(CARRIED_KEY)) continue;
    if (n.tension <= 0.2) continue;
    weight += n.tension;
  }
  return weight <= 0 ? 0 : Math.min(1, weight / (weight + 1.2));
}

/**
 * The prefix her carried things are keyed with.
 *
 * Declared HERE rather than imported from `what-stays.ts`, which owns the writing: importing it
 * would make the relationship layer depend on the cell-④ module, and the dependency belongs the
 * other way round. Pinned equal in `what-stays.test.ts`, so the two cannot drift silently.
 */
export const CARRIED_KEY = "hesaid:";

/**
 * How he has usually treated her, as a number, or null when she has not got enough to say.
 *
 * Null is not zero and the difference matters: "she cannot tell yet" must never be folded in as
 * "he is middling", which is the same discipline that makes `howHeSaidIt` return nulls rather than
 * 0.5 for an unreadable message.
 */
/**
 * At least this many DIFFERENT axes before there is a usual way at all.
 *
 * ── ONE AXIS COULD PIN HIM AT ±1, WHICH IS NOT A CONCLUSION ──────────────────────────────────
 *
 * The normaliser used to be the weight of whatever axes happened to have enough readings. So if
 * only ONE axis cleared the bar, five messages where the only legible thing was that he did not
 * leave her a way out, the sum was divided by that single weight and came out at exactly ±1. The
 * strongest possible verdict about a person, from one facet of five messages, in a LIFETIME MEAN
 * that never forgets.
 *
 * Two things fix it, and both are needed. This bar means one facet is never a verdict. And the
 * normaliser below is the FULL weight of every axis, so an axis with no evidence contributes
 * nothing rather than shrinking the denominator, an unheard axis should dilute a conclusion, not
 * concentrate it.
 */
const ENOUGH_AXES_TO_HAVE_A_REGARD = 2;

/**
 * How well she can read him: the LESSER of what she has heard and how long she has known him.
 *
 * See `HALFWAY_DAYS` for why this is a `min` rather than an average, and for the measurement that
 * made it necessary.
 */
export function knowingHim(rec: RelationshipRecord): number {
  const fromMessages = rec.timesHeSpoke / (rec.timesHeSpoke + HALFWAY_AT);
  const fromDays = rec.daysSeenCount / (rec.daysSeenCount + HALFWAY_DAYS);
  return KNOWING_CEILING * Math.min(fromMessages, fromDays);
}

export function hisUsualRegard(rec: RelationshipRecord): number | null {
  let total = 0;
  let axesHeard = 0;
  for (let i = 0; i < FORM_AXES.length; i++) {
    const n = rec.formN[i] ?? 0;
    if (n < ENOUGH_TO_HAVE_A_REGARD) continue;
    const mean = (rec.formSum[i] ?? 0) / n;   // 0..1 per axis
    total += REGARD_WEIGHTS[i]! * (2 * mean - 1);
    axesHeard += 1;
  }
  if (axesHeard < ENOUGH_AXES_TO_HAVE_A_REGARD) return null;
  // Divided by ALL the weight, not by the weight that happened to be heard.
  const allWeight = REGARD_WEIGHTS.reduce((s, w) => s + Math.abs(w), 0);
  const r = total / allWeight;
  return Number.isFinite(r) ? Math.min(1, Math.max(-1, r)) : null;
}

/**
 * Same, but with the clock injected. `howLongAndHowWell` reads `Date.now()`, which a test cannot
 * pin; this is the seam, and the reason it exists separately is that the daemon genuinely wants
 * the wall clock and the tests genuinely want a fixed one.
 */
export function howLongAndHowWellAt(graph: FieldGraph, rec: RelationshipRecord, nowMs: number): HowLongAndHowWell {
  const base = howLongAndHowWell(graph, rec);
  const himId = graph.byKey.get(HIM);
  const him = himId === undefined ? undefined : graph.nodes.get(himId);
  return { ...base, knownForMs: him === undefined ? null : Math.max(0, nowMs - him.bornMs) };
}

/**
 * How unlike him this message is.
 *
 * THE REASON THIS IS A DEVIATION AND NOT A SCORE. An absolute "this is a blunt message" threshold
 * imports a politeness norm: Chinese and English sit at different baselines, and in an operational
 * register a bare imperative is the unmarked form. A person who bristles at ordinary speech is not
 * more alive, she is miscalibrated. Measuring against HIS OWN usual way solves all three at once,
 * it is language-neutral, it makes "he is always terse, so terse is not a signal" true by
 * construction, and it is second-order: what moves her is a change in how he is.
 */
export interface Unlike {
  /**
   * Per-axis signed departure from his usual, or null where there is no basis. Positive means
   * MORE than he usually does (more hedging, more reason-giving); negative means less.
   */
  perAxis: (number | null)[];
  /** The largest absolute departure on any axis, 0..1. Null when she has no baseline at all. */
  most: number | null;
  /**
   * Whether this reading CONTRADICTS her settled sense of him, as opposed to merely being
   * unreadable or thin.
   *
   * THE SAFETY GATE, and it is the most important field here. Higgins's compensation rule is that
   * strong accessibility substitutes for weak applicability: a strongly held expectation gets
   * applied to a message carrying almost no evidence for it, and he names this as the mechanism by
   * which an observer is called paranoid. The ceiling rule is the counterweight, for a CONTRARY
   * stimulus, neither accessibility nor priming moves judgment at all ("the high accessibility of
   * 'stick' does not overwhelm people's ability to identify a snake right in front of them").
   *
   * So: her prior may fill in the vague. It may never override the contrary. Anything reading this
   * must let `contrary` win over whatever she expected.
   */
  contrary: boolean;
  /** How much of a basis she has for any of this, 0..1, sharing the same ceiling as knowing him. */
  basis: number;
}

/** Below this many legible readings on an axis, there is no usual way to depart from. */
export const ENOUGH_TO_HAVE_A_USUAL_WAY = 5;
/** A departure at least this large, on an axis she has a real basis for, is contrary. */
/**
 * How much of the accumulated record the very worst thing he could do re-reads away.
 *
 * ── THE SHAPE MATTERS MORE THAN THE NUMBER, AND THE FIRST SHAPE WAS WRONG ───────────────────
 *
 * The first version scaled `formSum` and `formN` by the same factor, which leaves the MEAN
 * EXACTLY WHERE IT WAS and only shrinks the effective sample count. Measured: −0.0012 became
 * −0.0019 at a thousand messages. A 1.6× nothing. Discounting both halves equally is not
 * re-reading the past, it is rounding it.
 *
 * It also fired at the wrong place. `contrary` is true from a departure of 0.6, which is not
 * rare, a single sharp evening clears it. Re-reading a decade every time he is sharp is not
 * finding out who someone is, it is being unable to hold a view.
 *
 * So the discount starts at ZERO at the contrary bar and reaches its full depth only at the very
 * top of the scale, every measured axis maximally unlike him, which is a once-in-a-relationship
 * event and is exactly what 「原来他是这样的人」 is made of. At the bar itself nothing happens.
 */
export const REREADS_THE_PAST_BY = 0.98;
/**
 * And the floor: even the worst thing he could do leaves this much of him. It is small, and that
 * is the point, 「我好像根本不认识你」 is a real thing a person feels, but it is never zero,
 * because a lifetime cannot be deleted by one evening and because `timesHeSpoke` and
 * `daysSeenCount` are untouched either way: she does not un-know him, she re-reads him.
 */
export const A_SHOCK_LEAVES_AT_LEAST = 0.02;

export const CONTRARY_AT = 0.6;

export function howUnlikeHim(form: HowHeSaidIt, rec: RelationshipRecord): Unlike {
  const v = formVector(form);
  const perAxis: (number | null)[] = [];
  let most: number | null = null;
  let contrary = false;
  let axesWithBasis = 0;

  for (let i = 0; i < FORM_AXES.length; i++) {
    const n = rec.formN[i];
    const x = v[i];
    if (!form.legible || x === null || n < ENOUGH_TO_HAVE_A_USUAL_WAY) { perAxis.push(null); continue; }
    axesWithBasis += 1;
    const usual = rec.formSum[i] / n;
    const d = x - usual;
    perAxis.push(d);
    const mag = Math.abs(d);
    if (most === null || mag > most) most = mag;
    // Contrary needs BOTH a large departure and enough evidence that the usual is real. A big
    // departure from a mean of two observations is not a contradiction, it is a small sample.
    if (mag >= CONTRARY_AT && n >= ENOUGH_TO_HAVE_A_USUAL_WAY * 2) contrary = true;
  }

  return {
    perAxis,
    most,
    contrary,
    basis: axesWithBasis === 0 ? 0 : KNOWING_CEILING * (axesWithBasis / FORM_AXES.length),
  };
}
