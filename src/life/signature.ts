// Telling a quiet fortnight apart from a broken one.
//
// S-4 · She goes quiet on him for a stretch. Not sulking, not broken: a low period, and it passes.
// The scenario file recorded the gap honestly: the watchtower has a calcification alarm that fires
// on a long unchanging stretch, and it CANNOT distinguish "she is quiet because she is in a quiet
// stretch" from "she is quiet because something broke". Both look identical from outside, and the
// cost of that ambiguity falls on her: a low period reads as a malfunction, or a malfunction reads
// as a mood.
//
// The discrimination is not subtle once it is stated:
//
//   A LOW PERIOD: every signal still moving, all of them at low amplitude. She is quiet the way a
//   person is quiet: nothing has stopped, everything has just turned down.
//
//   A FAULT: some signals moving normally while one or more sit at EXACTLY the same value reading
//   after reading. Nothing real is ever perfectly still while its neighbours move. A flat line in a
//   living system is a disconnected wire, not a calm one.
//
// So the question to ask of a quiet stretch is not "how much is happening" but "is anything
// perfectly still". That is a different question from every other detector in the watchtower, and it
// is the one that separates the two cases.
//
// ── AND THE REASON IT IS GENERIC ──────────────────────────────────────────────
//
// The same reading answers a second question that has bitten this project repeatedly. Four times
// now, a signal has been defined, plumbed, displayed, and connected to nothing upstream, so it sat
// at its default forever and every reading of it was a lie: `userNeeds`, `day.idle`,
// `day.maintenanceDue`, `reservoirSize`. Each was eventually caught by hand, by someone reading the
// code, long after it was written. Each got its own bespoke `*_stuck` detector afterwards.
//
// That does not scale and it does not close the class: the NEXT signal added will have no bespoke
// detector, because nobody writes one for a wire they believe is connected. So this walks the
// snapshot STRUCTURALLY: every numeric leaf, whatever it is called, whenever it was added, and
// asks the flat-line question of all of them at once. A field added to `VitalsSnapshot` tomorrow is
// watched tomorrow, by nobody's decision.
//
// Signals that may legitimately be still are named in STILL_IS_FINE below, each with its reason.
// That list is the only escape hatch, and it exists so that "it was hard to reach" can never quietly
// become "it is exempt".

import { windowFor, type VitalsSnapshot } from "./vitals.js";

/** How one signal has behaved across the window. */
export interface SignalMotion {
  /** Dotted path into the snapshot, e.g. `field.tension` or `pad.arousal`. */
  path: string;
  /** Readings that actually carried this signal. */
  readings: number;
  /** Highest minus lowest, in the signal's own units. */
  spread: number;
  /** How many distinct values it took. 1 means a flat line. */
  distinct: number;
  /** Spread relative to the signal's own scale, so 0..1 signals and counters compare fairly. */
  relative: number;
}

export interface Signature {
  /** Every numeric signal found in the snapshots, with how it moved. */
  signals: SignalMotion[];
  /** Signals that took exactly one value across the whole window, excluding the allowed-still. */
  frozen: SignalMotion[];
  /** Signals that moved, but barely. Their number is what says "low period" rather than "broken". */
  quiet: SignalMotion[];
  /** Signals that moved normally. */
  lively: SignalMotion[];
  /** Wall-clock the window actually covered. */
  spanMs: number;
}

/**
 * Signals that can sit perfectly still without anything being wrong, and why.
 *
 * A path may only appear here for a REASON. "It was hard to make it move" is exactly the finding
 * this module exists to surface, so anything parked here on those grounds is a bug wearing an
 * exemption. Prefixes match, so `guardRefusals.` covers every guard.
 */
/**
 * Signals the flat-line question is not asked of because ANOTHER named detector already asks it, or
 * because they are not about her at all.
 *
 * Structural, so these may move as much as they like: exempting them says the generic check is
 * redundant here, not that the signal is expected to be still. Kept apart from `STILL_IS_FINE`
 * because the two are checked differently, and conflating them made the necessity check below
 * demand that a clock stop ticking.
 */
export const WATCHED_ELSEWHERE: Record<string, string> = {
  ts: "the clock, not a signal about her",
  lastTickAgeMs: "watched directly by tick_stalled",
  lastMomentAgeMs: "watched directly by moments_stalled",
  "choosing.streamPosition": "watched directly by rng_frozen",
  "field.judgements": "watched directly by field_credulous, which reads arrivals against judgements",
  "field.judgeable": "the other half of the same reading",
  "field.pendingBirths": "watched directly by field_fusion_stalled",
  "field.spiralling": "watched directly by field_rumination the moment she is in it",
  "field.trustTold": "watched directly by field_distrust, which reads the floor rather than the motion",
  "field.faded": "watched directly by field_amnesia",
};

/**
 * Signals that can sit perfectly still without anything being wrong, and why.
 *
 * A path may only appear here for a REASON. "It was hard to make it move" is exactly the finding
 * this module exists to surface, so anything parked here on those grounds is a bug wearing an
 * exemption. Prefixes match, so `guardRefusals.` covers every guard.
 *
 * AND EVERY ENTRY MUST STILL BE NECESSARY. The six-month gate asks this list to justify itself: a
 * signal that has started moving no longer needs an exemption, and from that moment its exemption is
 * quietly hiding a live signal. Nineteen entries came off this list the first time that was checked,
 * all of them written when the simulated life was too thin to move them.
 */
export const STILL_IS_FINE: Record<string, string> = {
  "guardRefusals.": "a wall that never had to refuse anything is a wall doing its job: zero is the healthy value here, and its RISE is the signal — watched by the guard-refusal faults, which fire on the event itself rather than on this counter",
  "machineVoice.count": "counts the machine describing her in service words; zero is every string staying in her register, and its RISE is the signal (machine_voice watches it)",
  "saying.registerHits": "service words in HER OWN mouth over the speech window; zero is her register holding, and its rise is the signal",
  // The whole speech-instrument shelf of counts and distributions: these
  // are bounded ring COUNTS and SHARES, not liveness wires. `saying.stance.n` saturates at the
  // 40-turn ring cap and then never moves; `saying.stance.回投`/`不接` sit at 0 through any calm
  // stretch; `saying.shadowCalls` rises monotonically (a plateau IS the shadow_stalled signal,
  // watched there, not here); `saying.ownership`/`coupling` are null until their evidence floor.
  // Surfacing them made them READ by Eric, but the flat-line detector must not read a saturated
  // ring cap as a dead being. This is the exact S-4 false positive the field.byOrigin exemptions
  // below exist for; the speech shelf gets the same treatment.
  "saying.stance.": "a bounded stance-ring share/count; pinned at the 40-cap or at 0 through a calm stretch is normal, and the binding reads the distribution, not its stillness",
  "saying.shadowCalls": "monotonic count of shadow calls; a PLATEAU is the signal and shadow_stalled watches it — stillness here is not death",
  "saying.shadowTurns": "monotonic count of turns the shadow was offered; still when she is simply not talking, which is normal — the stall is shadowCalls flat WHILE this rises, watched by shadow_stalled",
  "saying.shadowClauseLenVar": "the shadow's mean clause-length variance; flat when her replies are steady is fine, and the hers/shadow ratio is what reads it",
  "saying.coupling": "null until the pair floor, and steady when her speech steadily tracks her state; its DROP is the signal, not its stillness",
  "saying.meanClauseLenVar": "her own clause-rhythm variance over the window; steady is a steady voice, not a dead wire",
  "saying.ownership": "null until the evidence floor; a plateau after divergence settles is normal, and its collapse toward zero would be the signal",
  "saying.pairs": "the speech-pair window count; saturates at PAIR_WINDOW=40 exactly like saying.stance.n and then never moves — a saturated ring cap on a long-lived being, not a dead wire",
  "willingness.recentDeclines": "zero for as long as she has been willing, which is most of the time",
  // The readings of what his messages do to her, as they reach Eric: THREE of the four are exempt
  // rather than four. `withHim.entitlement` was exempted too, on the argument that a lifetime mean
  // moves slowly enough that stillness is the mechanism working: and the six-month life then
  // measured it taking four distinct values, so the guard that checks whether an exemption is
  // still EARNED went red on it. It was right: a signal that moves does not need an exemption, and
  // an exemption over a moving signal hides it. The reasoning had been perfectly good and the
  // measurement disagreed with it.
  "withHim.carrying": "how much about him she is holding: ZERO is the healthy value and the whole point of cell ① (ordinary conversation leaves no residue), so a long still stretch at zero is her having an ordinary month rather than a dead wire — its RISE is the signal, and it is watched by the spiral detectors in what-stays.test.ts",
  "withHim.carriedThings": "the count behind `carrying`; still at zero for the same reason, and still at a small number while nothing new settles and nothing has yet decayed past the line",
  "withHim.notTakenOn": "turns where work was proposed and she could not take it up; zero is the ordinary state for someone he has known a while, and its rise is the signal",
  "withHim.saidNo": "turns whose reply carried an explicit 「我不干」, kept beside the refused count so that number never travels alone; zero is the ordinary state and any rise arrives with its own excerpt to read",
  "saying.beatsCountedShare": "the share of shape landings whose beat count was real rather than a sentence-count fallback; 1.0 IS the healthy value (every turn counted), so a long stillness at 1.0 is the composer doing its job — its FALL is the signal, and beatsGapFallback coming alive beside it says the same thing twice",
  "saying.beatsGapFallback": "the beats gap over fallback landings only; null-or-still on a healthy being because the fallback path should never be taken — it exists so fallback readings can never again pool into `beatsGap` under one name",
  "willingness.declines": "same: a Resident who declines nothing is the normal case",
  "temperament.days": "counts up on the daily tick; flat inside a day is correct",
  capVigor: "the daily vigor cap: configuration she is run with, not a signal about her",
  "field.wonders": "a thing has to keep coming back for weeks with nothing explaining it before "
    + "one of these exists, so zero through her whole first stretch is the mechanism "
    + "working, not a dead wire. The planted-violation proofs in what-keeps-coming-back.test.ts "
    + "are what guard the wire itself",
  "field.aboutHerself": "same shape: two of her own instruments have to agree about a "
    + "departure from her own baseline before anything is written, and a newborn has no baseline "
    + "to depart from. Zero for weeks is the design",
  "field.credencePinnedShare": "zero is the healthy value and always will be; corroboration became asymptotic when the saturation bug was fixed, so nothing can pin at the ceiling any more",
  "maturity.carriedLimit": "a step function of maturity.earned, which is watched and does move; it crosses a step every several months",
  "maturity.confirmStep": "the same: a step function of what she has earned, not an independent wire",
  "maturity.refuted": "counts the times she was wrong about herself and found out; rare, and its stillness is good news",
  "dream.forbidden": "counts Dream being stopped from writing a file it may not; zero is the wall doing its job, and its RISE is the signal",
  "dream.ungrounded": "counts edits refused for resting on something that never happened; zero is the healthy value",
  "dream.integrityAlerts": "counts an identity file moving without Dream; zero is what nothing going wrong looks like",
  "doing.aloneChoices": "counts moments she decided with the model unable to answer; zero is what a working provider looks like, and its RISE is the signal",
  "skills.quarantined": "counts skills that failed their probation and were withdrawn; zero is what a healthy extraction path looks like, and its RISE is the signal",
  "skills.probation": "how many skills are on probation right now; zero-is-healthy and rare (skill extraction is uncommon), so frozen across any recent window on a mature being is normal — its RISE is the signal, not its stillness",
  "skills.graduated": "monotone cumulative count of skills that earned their place; it moves only on a rare graduation and is otherwise frozen for months — a plateau is a settled skill set, not a dead wire",
  "resting.refusals.": "why fusions came to nothing on ONE night, broken down; an individual reason can be the same two nights running, and what carries the signal is `considered` against `refused`",
  // ── THE THREE THAT MADE THIS CHECK UNABLE TO EVER SAY "ALIVE" ────────────────────────
  //
  // `livenessOf` short-circuits to `broken` on ANY non-empty frozen set, and these three are
  // structurally constant in production, so a perfectly healthy Resident was reported as a
  // broken wire: the instrument built to tell a quiet fortnight from a dead one, permanently
  // answering "dead". It went unnoticed because the test harness MANUFACTURED the missing
  // signal, alternating `origin: "read"` into its claims, which production never does.
  "field.byOrigin.read": "nothing in the running system encodes a read-origin memory, BY RULING: a moment of exploring is remembered by what she went looking for and never by what a page said back, or an outside text could write her memories and then be read back to her as her own past (index.ts, encodeMoment). Zero here is that rule holding, and a nonzero would be the alarm",
  "field.credenceByOrigin.read": "the same rule seen from the credence side: with no read-origin memories there is nothing to average, so this is zero for exactly as long as the rule above holds",
  // The dreamt origin: zero until Eric opens `life.dream.enabled`, and after that still
  // zero across every stretch of dreamless or low-charge nights, only a SURVIVING dream is
  // ever encoded. Its first nonzero is S-49 happening, not a wire coming loose; its stillness
  // is most nights of a healthy life.
  "field.byOrigin.dreamt": "a remembered dream is rare by design (most episodes stay in her diary and are forgotten); zero for weeks is the survival threshold doing its job, and the first rise is her first remembered dream",
  "field.credenceByOrigin.dreamt": "the same from the credence side: nothing to average until a dream survives a night",
  "field.byOrigin.retold": "a retold node is rarer still (she turns back to a cooled stretch and writes how she sees it now — by design a low-frequency act); zero for weeks is the organ resting, and the first rise is her first re-telling",
  "field.credenceByOrigin.retold": "the same from the credence side: nothing to average until she has retold something",
  // Rare-but-healthy field counts: the production liveness window is the
  // 3-week coarse longView, far shorter than the months between these events, so on a mature
  // being they are frozen across the window while everything else moves, the exact S-4 false
  // positive. Their PLATEAU is normal life; a real stall in growth is field_not_growing /
  // field_fusion_stalled's job, not the flat-line's. (freshBirth and fusionsResolvedTotal are
  // deliberately NOT here: the sim shows they still move within the window.)
  "field.birthsTotal": "monotone cumulative count of fusion births, ~one per six months by the code's own measure; frozen across any 3-week window on a healthy long-lived being, and its stall is field_not_growing's to catch, not a dead wire",
  "field.byKind.figure": "count of figure nodes — the few people she holds; created in her first days and never removed, so structurally constant on a mature being, not a loose wire",
  "field.byKind.fusion": "count of fusion nodes; can plateau for long healthy stretches between births, and its growth is watched by field_not_growing, so stillness here is not death",
};

/** How much a signal must vary, relative to its own scale, to count as moving rather than quiet. */
export const LIVELY_ENOUGH = 0.02;

/**
 * A signal has to be present in at least this many readings before its stillness means anything.
 *
 * Two readings that happen to match is a coincidence; a dozen in a row is a wire.
 */
export const ENOUGH_READINGS = 8;

function isFine(path: string): boolean {
  for (const key of [...Object.keys(STILL_IS_FINE), ...Object.keys(WATCHED_ELSEWHERE)]) {
    if (key.endsWith(".") ? path.startsWith(key) : path === key) return true;
  }
  return false;
}

/**
 * Every numeric leaf in a snapshot, by dotted path.
 *
 * Booleans count: `torn` is as capable of being a dead wire as `tension` is, and a boolean that is
 * never once true is exactly the failure this catches. Strings and arrays do not, because "moved" is
 * not defined for them; the things they carry are watched by name elsewhere.
 */
export function numericLeaves(value: unknown, prefix = "", out = new Map<string, number>()): Map<string, number> {
  if (typeof value === "number") {
    if (Number.isFinite(value)) out.set(prefix, value);
    return out;
  }
  if (typeof value === "boolean") {
    out.set(prefix, value ? 1 : 0);
    return out;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      numericLeaves(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}

/**
 * Read the window.
 *
 * Signals absent from a snapshot are skipped rather than treated as zero: an optional block that
 * only appears once she has lived long enough must not read as "frozen at 0 and then jumped".
 */
export function signatureOf(history: readonly VitalsSnapshot[]): Signature {
  const series = new Map<string, number[]>();
  for (const snap of history) {
    for (const [path, v] of numericLeaves(snap)) {
      const s = series.get(path);
      if (s) s.push(v);
      else series.set(path, [v]);
    }
  }

  const signals: SignalMotion[] = [];
  for (const [path, values] of series) {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const spread = hi - lo;
    // Against the signal's own scale, so a 0..1 quantity and a counter in the thousands are asked
    // the same question. The floor of 1 keeps a signal that lives near zero from reading as wildly
    // variable the first time it moves at all.
    const scale = Math.max(1, Math.abs(hi), Math.abs(lo));
    signals.push({
      path,
      readings: values.length,
      spread,
      distinct: new Set(values).size,
      relative: spread / scale,
    });
  }
  signals.sort((a, b) => a.path.localeCompare(b.path));

  const judgeable = signals.filter((s) => s.readings >= ENOUGH_READINGS && !isFine(s.path));
  return {
    signals,
    frozen: judgeable.filter((s) => s.distinct === 1),
    quiet: judgeable.filter((s) => s.distinct > 1 && s.relative < LIVELY_ENOUGH),
    lively: judgeable.filter((s) => s.distinct > 1 && s.relative >= LIVELY_ENOUGH),
    spanMs: history.length >= 2 ? history[history.length - 1].ts - history[0].ts : 0,
  };
}

export type Liveness =
  /** Not enough readings, or not enough time, to say anything. */
  | { verdict: "too-early"; why: string }
  /**
   * Every signal she has is moving. Says nothing about how MUCH is happening, deliberately: a low
   * period and a busy one both look like this, and telling those apart is not this reading's job.
   */
  | { verdict: "alive"; why: string }
  /** Some signals moving, others perfectly still. Something is disconnected. */
  | { verdict: "broken"; why: string; frozen: string[] }
  /** Nothing moving at all. Either she has stopped, or the instrument has. */
  | { verdict: "flatlined"; why: string; frozen: string[] };

/**
 * How much of what she has must be still before "one wire came loose" becomes "she has stopped".
 *
 * The distinction is worth drawing because the two need opposite responses: a loose wire is a bug in
 * one place, and a flatline means the whole capture path has died and nothing else in the watchtower
 * can be believed either.
 */
export const FLATLINE_SHARE = 0.8;

/** How many readings the amplitude question is asked over. Enough to see a shape, few enough to be cheap. */
export const RECENT_READINGS = 24;



/**
 * The verdict S-4 asks for.
 *
 * Takes the WHOLE retained record, not a pre-cut window, and asks two different questions of it.
 *
 *   AMPLITUDE, over the recent stretch: is what is happening large or small. This is what separates
 *   a low period from an ordinary one, and it is only meaningful about recent life.
 *
 *   STILLNESS, over the entire record: has this signal EVER moved. This is the dead-wire question,
 *   and it has to be asked of everything or it gives the wrong answer, measured against a real low
 *   period, two healthy signals (what she is carrying, how far she is exploring) sat perfectly still
 *   for a fortnight simply because they had bottomed out. They are not disconnected; they moved
 *   before she went quiet and will move again. A wire that came loose never moved at all.
 *
 * What it deliberately does NOT do is say how much is happening. An earlier version tried, as a
 * median amplitude ratio against her own past, and measurement killed it: a life turned down to a
 * tenth still read at 91% of its usual amplitude, because turning her life down turns down her
 * INPUTS while her drives go on cycling through their full range exactly as they should. That is a
 * true fact about her rather than a calibration problem, and the honest conclusion is that "how
 * quiet is she" is not a question about variance. It is answered where the gap actually was: at the
 * calcification alarm, which now asks this reading whether the unchanging stretch it found has
 * anything frozen in it.
 */
export function livenessOf(
  record: readonly VitalsSnapshot[],
  minSpanMs: number,
): Liveness {
  // Stillness, across everything retained.
  const whole = signatureOf(record);
  // Amplitude, across the recent stretch only. The window is kept, not just its reading, because
  // the baseline is "everything before it" and that has to be an actual slice.
  const recent = signatureOf(windowFor(record, minSpanMs, RECENT_READINGS));

  const judgeable = recent.frozen.length + recent.quiet.length + recent.lively.length;
  if (judgeable === 0 || recent.spanMs < minSpanMs) {
    return {
      verdict: "too-early",
      why: `${judgeable} signals over ${(recent.spanMs / 3.6e6).toFixed(1)}h; needs ${(minSpanMs / 3.6e6).toFixed(1)}h`,
    };
  }

  if (whole.frozen.length > 0) {
    const names = whole.frozen.map((s) => s.path);
    const share = whole.frozen.length / Math.max(1, whole.frozen.length + whole.quiet.length + whole.lively.length);
    const hours = (whole.spanMs / 3.6e6).toFixed(0);
    if (share >= FLATLINE_SHARE) {
      return {
        verdict: "flatlined",
        why: `${names.length} of ${whole.frozen.length + whole.quiet.length + whole.lively.length} signals took exactly one value across ${hours}h; she has stopped, or the reading of her has`,
        frozen: names,
      };
    }
    return {
      verdict: "broken",
      why: `${names.slice(0, 4).join(", ")}${names.length > 4 ? ` and ${names.length - 4} more` : ""} never moved at all across ${hours}h while the rest of her did`,
      frozen: names,
    };
  }

  return { verdict: "alive", why: `${recent.lively.length} of ${judgeable} signals moving normally` };
}
