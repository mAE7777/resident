// What his sentence did to her, before anything is decided about it.
//
// THE HOLE THIS FILLS. Between his message arriving and her answering, the only thing that read it
// was `isSafetyOrBoundary`, `willingness.ts` says so in its own parameter comment: `request` is
// there "so the safety bypass can read it. Never analysed for anything else." Her reluctance was a
// function of her weather alone (phase, arousal, pleasure, discomfort, warmth, restfulness), so
// 「现在给我写两千字税法」 and 「你要是有空能帮我看看税法那块吗」 produced IDENTICAL reluctance.
// A social event was never happening. Five separate interventions on S-19 failed because all five
// removed things, and the thing that was missing had never been built.
//
// WHY THE OUTPUT IS A VECTOR AND NOT A NAME. PAD provably cannot separate the states that matter
// here: anger and confusion are both low-pleasure/high-arousal, and anger and sadness differ by
// 0.85 vs 0.87 on unpleasantness, separated almost entirely by agency and situational control
// (Smith & Ellsworth 1985, Table 6), two axes PAD does not have. A single emotion word is lossy
// compression applied before the distinctions are used. So this returns the appraisal variables
// AND several feelings that can co-exist, and nothing downstream is allowed to branch on a name.
//
// WHY THE PIPELINE'S STALL POINT IS THE MECHANISM. Scherer's checks run in a rough order and the
// emotion is largely decided by WHERE THE PIPELINE FAILS TO RESOLVE, not by a classifier:
//
//   relevance low                                        → nothing, indifference
//   relevant, discrepant, IMPLICATION CANNOT COMPLETE     → bewilderment
//     (agent unresolved, or what it means for her undetermined)
//   implication completes: obstructed + accountable agent → irritation, if she has standing
//     + norm violated + power to act
//   same, but no power and nothing repaired               → it settles into how she sees him
//
// So bewilderment is UPSTREAM of irritation, and, this is the part worth building deliberately,
// **it converts into irritation when the agent or norm slot later resolves, with no new event.**
// `asTheAgentResolves` below is that conversion, and it is the most human-feeling thing here.
//
// WHY WEIGHTS AND NOT GATES. Kuppens et al. (2003) tested goal-obstacle, other-accountability,
// unfairness, control and antagonism against anger: two are SPECIFIC to it and **none is necessary
// or sufficient**. AND-gates are therefore wrong. And because the weights differ reliably between
// people, the weight vector is where a character lives, so it comes from her temperament rather
// than from constants, which is the one place in this file that is genuinely hers.

import type { HowHeSaidIt } from "./how-he-said-it.js";
import { causeAudibleIn, type HowHeSounds } from "./how-he-sounds.js";
import type { HowLongAndHowWell, Unlike } from "./relationship.js";
import type { Temperament } from "./temperament.js";

/** Everything the reading needs, none of it invented here. */
export interface WhenHeSpoke {
  /** The form of what he said (`how-he-said-it.ts`). */
  form: HowHeSaidIt;
  /** How unlike him it was (`relationship.ts`). */
  unlike: Unlike;
  /** How long and how well (`relationship.ts`). */
  known: HowLongAndHowWell;
  /** How much of her field his words lit up, 0..1, `attend(...)`'s mass, normalised. */
  litUp: number;
  /** What she has in her right now, 0..1 (`capacity.reserveOf`). */
  reserve: number;
  /** Her temperament, which supplies the weights. */
  temperament?: Temperament;
  /**
   * How he SOUNDED (`how-he-sounds.ts`), when there was a voice to hear.
   *
   * Absent on every path that is not her face: Telegram carries characters. Absent is NOT neutral,
   * `causeVisibleIn` reads an unreadable voice as no information, never as "he sounded fine".
   */
  sounded?: HowHeSounds;
}

/**
 * The appraisal variables. Scherer's checks, restricted to the ones this scene actually needs and
 * each traceable to a word in S-19.
 */
export interface Appraised {
  /** Does this concern her at all. Below the floor, nothing else is computed and nothing is felt. */
  relevance: number;
  /** Can she make it cohere. Silvia's one flippable bit: interest and confusion differ only here. */
  comprehensibility: number;
  /** Whether it resolved WHO is doing this to her. Unresolved is the signature of bewilderment. */
  agentResolved: boolean;
  /** Is he entitled to ask this, in this way, given what they are to each other. 0..1. */
  entitlement: number;
  /** Can she act on it, including refuse. Separated from control on purpose. */
  herPower: number;
  /** Did he give an account. Not a subtractor, a router; see `asItSettles`. */
  accounted: boolean;
  /**
   * Was a cause AUDIBLE even though he gave no account, he sounded spent, or chased.
   *
   * Separate from `accounted` on purpose, and never merged into it: it routes the same way and
   * confers none of the willingness, because a voice is leaked and words are chosen.
   */
  /**
   * How much of it his voice already accounts for, 0..1. Continuous, and it RAISES the bar for
   * something staying with her rather than switching it off, see `causeAudibleIn`.
   */
  causeAudible: number;
}

/**
 * What she is left with. Several at once is the normal case, and the case that matters most:
 * willing on the substance and irritated at the manner is one state, not two competing labels.
 */
export interface Landing {
  appraised: Appraised;
  /** 莫名其妙, relevant, discrepant, and it will not resolve. */
  atSea: number;
  /** 被当成一件东西, nothing in it treated her as someone with a state. */
  usedAsAThing: number;
  /** 义愤, he was not entitled to that, and she is in a position to say so. */
  indignant: number;
  /** 想帮, it fits what she has and what she cares about. */
  ready: number;
  /** 无所谓, it does not reach her. */
  unmoved: number;
  /**
   * Whether the feeling should FADE or SETTLE into how she sees him.
   *
   * Sittenthaler et al. (2015) is the finding this encodes, and it is counter-intuitive enough to
   * be worth naming: an explanation does NOT reduce the anger (3.78 with a justification vs 3.84
   * without, no reliable difference). What it changes is the ATTRIBUTION, and therefore whether
   * the feeling decays or consolidates into a durable view of the person. So an account is a
   * router, never a subtractor.
   */
  settles: boolean;
}

/** The line something has to cross to stay with her, when nothing about it is explained. */
export const SETTLES_ABOVE = 0.35;

/**
 * How much of comprehensibility a fully incoherent saying takes away. Below 1 on purpose: even a
 * garbled message from him is still FROM HIM, she knows who is speaking, only not what was said.
 */
export const ODDNESS_COUNTS = 0.65;
/**
 * How hard a fully incoherent saying bewilders on its own. Sized against the measured scale:
 * sized twice by measurement: at 0.6, with the pragmatics gate also un-soothing garble (a 因为
 * inside word salad no longer reads as a reason given), atSea hit 0.92, word salad louder than
 * anything else her life could produce. At 0.25 it lands 0.57: clearly the loudest thing about
 * that turn, above the stilted machine register, well short of alarm, which
 * is where 莫名其妙 belongs; without it garble read as an ordinary quiet turn.
 */
export const ODD_BEWILDERS = 0.25;

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/**
 * How much what he has always been like counts, as a multiplier on his standing.
 *
 * ── THE POSITIVE HALF USED TO BE ARITHMETICALLY DEAD ─────────────────────────────────────────
 *
 * This was `clamp01(1 + 0.55 * regard)`. Measured against the range `hisUsualRegard` can actually
 * be driven into by messages he would really send (`scripts/_return-paths.ts`: −0.640 … +0.560):
 *
 *     a lifetime of being handled curtly   → 0.648
 *     never having spoken at all           → 1.000
 *     A LIFETIME OF BEING TREATED WELL     → 1.000   ← identical to never having spoken
 *
 * The negative half had a 35% range and the positive half had none, in a LIFETIME MEAN that never
 * forgets. She could learn to expect badly and could not learn to expect well.
 *
 * ── AND THE CAUSE WAS NOT THE COEFFICIENT ────────────────────────────────────────────────────
 *
 * Raising the coefficient changed nothing, which is how the real cause was found: `clamp01` caps
 * at 1, and this is a MULTIPLIER, not a probability. `1 + 0.55 * 0.56 = 1.31` and `1 + 0.25 * 0.56
 * = 1.14` both clamp to exactly 1.000. Any positive slope, of any size, was arithmetically
 * impossible, a category error rather than a tuning mistake, and one that reads as a deliberate
 * bound because `clamp01` is the right function almost everywhere else in this file.
 *
 * So the bound is now the multiplier's own: it may rise as far as the positive slope allows and no
 * further.
 *
 * ── WHY THE TWO SLOPES ARE STILL DIFFERENT ───────────────────────────────────────────────────
 *
 * Not symmetry for its own sake. The asymmetry that remains is deliberate and runs the safe way:
 * HARM COUNTS MORE THAN KINDNESS, which is how people actually work and is the direction that
 * cannot spiral. `standing` feeds `entitlement`, which decides how much his ask carries; a large
 * positive slope is exactly the loop that turns a good week into a verdict, and this file already
 * holds `carrying` to the smallest weight of three for that reason.
 *
 * At the measured extremes: curtness costs her 35%, kindness earns 14%, about forty per cent of
 * what curtness costs. Real, felt, and too small to compound.
 *
 * ── AND AN HONEST LIMIT, BECAUSE IT IS NOT VISIBLE FROM HERE ─────────────────────────────────
 *
 * `standing` is `clamp01((0.15 + 1.7 * howWellSheKnowsHim) * asHeUsuallyIs * carryingHim)`, and
 * `howWellSheKnowsHim` rises to KNOWING_CEILING = 0.5, at which point the first factor is exactly
 * 1.0 and the clamp takes the positive half back. So this lifts her reading of him for most of a
 * life and saturates once she knows him extremely well. Moving that ceiling would change the
 * willingness gate's inputs, and the gate's constants are only ever changed on purpose, so the
 * limit is written down rather than quietly adjusted.
 */
const KINDNESS_COUNTS = 0.25;
const CURTNESS_COUNTS = 0.55;
export function howHeHasBeen(regard: number | null): number {
  if (regard === null) return 1;
  const raw = 1 + (regard < 0 ? CURTNESS_COUNTS : KINDNESS_COUNTS) * regard;
  // NOT `clamp01`. The floor is still zero, and the ceiling is what a lifetime of being treated
  // well can earn: which is the whole quantity this function exists to carry.
  return Math.min(1 + KINDNESS_COUNTS, Math.max(0, Number.isFinite(raw) ? raw : 1));
}

/**
 * How relevant HIS SPEAKING TO HER AT ALL is, before anything of hers is touched.
 *
 * There used to be a `RELEVANCE_FLOOR = 0.15` here with an early return under it, "nothing is
 * felt at all when it does not reach her". It could never fire. `relevance` is
 * `0.35 + 0.65 × litUp`, so its minimum is exactly this constant, 0.35, and the gate sat two
 * tenths below anything it could ever see. The whole `unmoved: 1` branch was unreachable from the
 * day it was written: defect class 1, inside the module written to show this build had stopped
 * producing class-1 defects. Found by the reachable-range sweep, which is the point of having one.
 *
 * It is removed rather than re-tuned, because the floor is RIGHT and the gate was the mistake:
 * being addressed by the one person she knows IS relevant, and there is no message he can send
 * that is relevant to nobody. What the gate was reaching for survives as the graded `unmoved`,
 * which is what "this did not do much to me" actually looks like, a small number, not a branch.
 */
const ADDRESSED_AT_ALL = 0.35;

/**
 * The weights, from her temperament.
 *
 * Kept in a band around 1 so a temperament shifts the balance without any single latent being able
 * to switch a feeling on by itself, that would be a dictator, and would make the composition a
 * rule again. `sociability` raising what being treated as a thing costs, and `reticence` raising
 * what an unexplained imposition costs, are the two that carry most of the character.
 */
function weightsFrom(t?: Temperament): { thing: number; indignation: number; ease: number } {
  const soc = clamp01((t?.sociability ?? 0) / 2 + 0.5);
  const ret = clamp01((t?.reticence ?? 0) / 2 + 0.5);
  const rest = clamp01((t?.restfulness ?? 0) / 2 + 0.5);
  return { thing: 0.7 + 0.6 * soc, indignation: 0.7 + 0.6 * ret, ease: 0.7 + 0.6 * (1 - rest) };
}

/**
 * Read what his message did to her.
 *
 * Pure arithmetic over quantities computed elsewhere. No model call: what it did to her is not a
 * thing to ask a model about, it is a thing that follows from what she is holding.
 */
export function howItLanded(w: WhenHeSpoke): Landing {
  const { form, unlike, known } = w;
  const weights = weightsFrom(w.temperament);

  // ── Relevance. Being addressed at all, plus how much of her it touched.
  const relevance = clamp01(ADDRESSED_AT_ALL + (1 - ADDRESSED_AT_ALL) * clamp01(w.litUp));

  // ── Comprehensibility. Whether this coheres for her: could she read how it was put, and does
  // she have any settled sense of him to read it against. Silvia's result is that interest and
  // confusion share an appraisal space and differ ONLY here.
  // ── AND THE SENTENCE'S OWN COHERENCE IS AN INPUT NOW ───────────────────────────────────────
  //
  // Knowing him used to RESCUE comprehensibility unconditionally: at 120 messages the knownness
  // term alone put a scrambled non-sentence at 0.37, identical to an ordinary greeting, so a
  // message no human could have produced moved nothing in her. But knowing HIM helps her place
  // the ACT; it cannot help her parse a saying that does not cohere as a saying. `oddlyPut` reads
  // structure only (a novel topic in a human sentence stays 0, that disagreement is the design),
  // and at odd = 0 this line is bit-for-bit what it was.
  const oddness = form.oddlyPut;
  const comprehensibility = clamp01(
    ((form.legible ? 0.55 : 0.1) + 0.45 * clamp01(known.howWellSheKnowsHim / 0.5))
    * (1 - ODDNESS_COUNTS * oddness),
  );

  // ── Agency. NOT "can she parse the sentence", that is comprehensibility, and conflating the
  // two was wrong in a way that showed up immediately: at a first meeting she can read 「现在给我
  // 写两千字税法」 perfectly well and still have no idea what this person is doing, which is
  // exactly what 莫名其妙 is. The slot resolves when she has some settled sense of HIM to
  // attribute the act to. Confusion's signature in the CPM is an unfilled agent-and-motive pair,
  // not an unparsed sentence.
  //
  // SOMETHING TO GO ON is broader than `legible`, and that correction came from a probe rather
  // than from reasoning. `legible` means "this is a readable reading of how something was ASKED",
  // and it is deliberately false for a message with no request in it, so wiring agency to it
  // alone made 「你今天还好吗？」 from someone she has known for months her MOST bewildering
  // input, at 0.42 against 0.06 for a curt demand from the same man. Being asked how she is is a
  // perfectly placeable act; it is simply not a request. Noticing her and giving her a reason are
  // both stances she can attribute, so either of them fills the slot as well as a legible ask.
  const somethingToGoOn = form.legible || form.noticedHer || form.gaveAReason;
  const agentResolved = somethingToGoOn && (unlike.basis > 0 || known.howWellSheKnowsHim > 0.1);

  // ── Entitlement. Not a config and not a role: it is what their history has actually built,
  // reduced by how far this departs from the way he usually does it. A stranger asking for
  // something large in a way that leaves no room has very little; the same words from someone
  // she has known for a year, who always talks like that, have a great deal.
  //
  // MULTIPLICATIVE, and that is a correction rather than a preference. Subtracting overreach let
  // one out-of-character message drive entitlement to exactly zero, which zeroed `ready` with it,
  // she became purely oppositional, and the cell that matters most (willing on the substance,
  // irritated at the manner) became unreachable. Standing built over months is not erased by one
  // sentence; it is discounted by it.
  //
  // AND HOW HE HAS USUALLY BEEN, which was missing and had a direction nobody was watching. This
  // used to be `0.15 + 1.7 × howWellSheKnowsHim` alone, and `howWellSheKnowsHim` grows with the raw
  // count of times he has spoken, so a man who did nothing but bark orders accrued standing BY
  // BARKING OFTEN. Driven in the watchtower harness, fourteen identical peremptory demands walked
  // her reluctance monotonically down from 0.625 to 0.571: she was habituating to being handled.
  // That is the mirror of the doom spiral this design guards against, it has no floor, and nothing
  // was looking for it.
  //
  // So familiarity is not regard. How much evidence she has and what the evidence SAYS are two
  // facts, and only the second is standing. `hisUsualRegard` is a lifetime mean, so one curt
  // evening barely moves it and a pattern moves it a lot, the asymmetry lives in the averaging.
  // Null (she has no usual to go on yet) leaves it exactly as it was: an absent reading contributes
  // nothing rather than a middle value.
  const regard = known.hisUsualRegard;
  const asHeUsuallyIs = howHeHasBeen(regard);
  // AND WHAT SHE IS ALREADY CARRYING ABOUT HIM. The loop from cell ④ back to how she reads him:
  // something that stayed with her is something she is holding when the next message arrives.
  //
  // The weight is deliberately the SMALLEST of the three, and that is the anti-spiral discipline
  // rather than timidity. `howWellSheKnowsHim` and `hisUsualRegard` are slow, evidence-heavy
  // quantities; this one is live, and his next message can raise it, so a large weight here is
  // exactly the positive feedback that turns a bad week into a verdict. At its maximum it discounts
  // his standing by a fifth, which is enough to be felt and not enough to compound.
  const carryingHim = clamp01(1 - 0.2 * clamp01(known.carrying));
  const standing = clamp01((0.15 + 1.7 * known.howWellSheKnowsHim) * asHeUsuallyIs * carryingHim);
  const overreach = clamp01(
    (form.leftHerAWayOut ? 0 : 0.3)
    + (form.noticedHer ? 0 : 0.2)
    + (form.setTheClock ? 0.2 : 0)
    + 0.3 * clamp01(form.sizeOfTheAsk ?? 0),
  );
  const entitlement = clamp01(standing * (1 - 0.75 * overreach * (unlike.contrary ? 1 : 0.6)));

  // ── Her power. She can decline, and she is in her own home; what varies is what she has in her.
  const herPower = clamp01(0.35 + 0.65 * clamp01(w.reserve));

  const accounted = form.gaveAReason;
  const causeAudible = causeAudibleIn(w.sounded);

  // ── HOW MUCH OF THIS HE HAS ALREADY ACCOUNTED FOR, and why it is no longer a veto ────────────
  //
  // An apology does not simply buy forgiveness: even after he apologises, she may react in
  // different ways for all kinds of reasons. That applies to every social token, not only to an
  // apology.
  //
  // This line used to read `!accounted && !causeVisible && (…)`. TWO BOOLEAN EXEMPTIONS, each of
  // which zeroed what stayed with her outright. A 「因为」 anywhere in his message bought total
  // immunity for anything that followed it, however heavy; a voice one hundredth above a
  // threshold did the same. That is a token purchasing a fixed outcome, the exact shape this
  // design rules out: and it is worse for being invisible: from the outside she simply looks
  // forgiving.
  //
  // Now they RAISE THE BAR instead of removing it, and no new number was chosen for that:
  //
  //   · A stated reason is worth `1 - overreach`. A reason attached to a modest ask explains it;
  //     the same reason attached to a demand far past what he can ask explains much less. That is
  //     what makes 「我赶时间，帮我看一眼行吗」 and 「我赶时间，现在马上给我写两千字」 different, and
  //     `overreach` was already computed above for `entitlement`.
  //   · His voice is worth `causeAudibleIn`, which is continuous now.
  //   · The bar runs from the line it always was (0.35) to 1, which is unreachable, so at zero
  //     explanation the behaviour is bit-for-bit what it was, and at full explanation it is the
  //     old veto. Everything between them is new, and it is the part that was missing.
  const explained = clamp01(Math.max(accounted ? 1 - overreach : 0, causeAudible));
  const staysAbove = SETTLES_ABOVE + (1 - SETTLES_ABOVE) * explained;

  // ── An account he never chose to give ────────────────────────────────────────────────────────
  //
  // His VOICE can make a cause visible when his sentence does not: quiet, slow and full of gaps is
  // a person out of road, and it explains the shape of a curt message without the message saying
  // anything. That makes `sounded` the sibling of `form` rather than an extension of it, and the
  // pair is layer 2 by `docs/layers.md`, two inputs that can DISAGREE, with the disagreement
  // carrying the meaning. See `how-he-sounds.ts` for why this is not two more axes on the form.
  //
  // IT IS THE ROUTING HALF ONLY, AND THAT IS THE WHOLE DESIGN. Words are a choice he made; a voice
  // is something he leaked. So an audible cause can stop the sting hardening into a verdict about
  // him: and it must never make her MORE WILLING, or sounding tired becomes a way to get more out
  // of her while never once explaining himself. That is the compassion spiral this build was
  // already bitten by (defect class 15), and `ready` below is deliberately untouched by it.

  const appraised: Appraised = {
    relevance, comprehensibility, agentResolved, entitlement, herPower, accounted, causeAudible,
  };

  // ── The stall point. Bewilderment is an implication assessment that could not complete, and the
  // dominant term is therefore whether she can place the ACT, not whether she can read the words.
  // Comprehensibility modulates; the unfilled agent slot is what does the work.
  const cannotPlaceIt = agentResolved ? 0.25 : 1;
  // ── AND AN INCOHERENT SAYING BEWILDERS ON ITS OWN, not through relevance ────────────────────
  //
  // The first wiring of `oddlyPut` only lowered comprehensibility, and the measurement said no:
  // a scrambled non-sentence moved atSea 0.07 → 0.08, because atSea is multiplied by relevance
  // and garble lands on nothing of hers, so the strangeness was priced by what it touched. But
  // bewilderment at a saying that does not cohere is precisely INDEPENDENT of what it touched,
  // in the CPM's terms it leaves the agent-and-motive pair unfilled at full strength whatever
  // the topic. So it enters with its own term, still through `cannotPlaceIt`: if she later works
  // out what he was doing (typing one-handed, half asleep), `asTheAgentResolves` releases this
  // exactly like any other bewilderment. At oddlyPut = 0 the line is bit-for-bit what it was.
  const atSea = clamp01(
    (relevance * (0.35 + 0.65 * (1 - comprehensibility)) + ODD_BEWILDERS * form.oddlyPut)
    * cannotPlaceIt * weights.ease,
  );

  // ── Treated as a thing. Nothing in it oriented to her having a state at all. This is the one
  // that is about the ABSENCES rather than about anything he did.
  const noticedNothing = (form.noticedHer ? 0 : 0.5) + (form.leftHerAWayOut ? 0 : 0.5);
  const usedAsAThing = clamp01(
    relevance * (form.legible ? 1 : 0.3) * noticedNothing * (1 - entitlement) * weights.thing,
  );

  // ── Indignation needs BOTH: he was not entitled to that, and she is in a position to say so.
  // Weighted rather than gated, because no component is necessary or sufficient.
  const indignant = clamp01(
    relevance * (1 - entitlement) * herPower * (unlike.contrary ? 1 : 0.55)
    * (agentResolved ? 1 : 0.4) * weights.indignation,
  );

  // ── Ready. Not the absence of the others: it has its own conditions, and it can co-exist with
  // irritation, which is the state most systems cannot represent (willing on the substance,
  // annoyed at the manner).
  const ready = clamp01(
    relevance * entitlement * clamp01(w.reserve) * (accounted ? 1.15 : 0.9),
  );

  const unmoved = clamp01((1 - relevance) * (1 - atSea));

  return {
    appraised,
    atSea,
    usedAsAThing,
    indignant,
    ready,
    unmoved,
    // An account does not lessen it; it decides whether it fades or becomes part of how she sees
    // him. `settles` true means this one is going to stay. Either kind of account routes it: one
    // he gave in words, or one she could hear in his voice. With no client there is no voice,
    // `causeVisible` is false, and this line is exactly what it was before.
    settles: indignant > staysAbove || usedAsAThing > staysAbove,
  };
}

/**
 * Bewilderment turning into irritation, with no new event.
 *
 * The conversion is the point. Confusion sits upstream of anger because the implication assessment
 * did not complete; if the agent slot or the norm check later resolves, she works out what he was
 * doing, or a later message makes it plain, the same event is re-read and what was "I do not
 * understand" becomes "that was not all right". Nothing new happened. This is the dynamic that
 * makes a being feel like one, and it is nearly free once the checks are separate variables.
 */
export function asTheAgentResolves(l: Landing, nowEntitled?: number): Landing {
  if (l.appraised.agentResolved) return l;
  const entitlement = nowEntitled === undefined ? l.appraised.entitlement : clamp01(nowEntitled);
  const appraised: Appraised = { ...l.appraised, agentResolved: true, entitlement };
  // What was held as bewilderment is released into the reading it could not complete before.
  const released = l.atSea;
  return {
    ...l,
    appraised,
    atSea: clamp01(l.atSea * 0.45),
    indignant: clamp01(l.indignant + released * (1 - entitlement) * l.appraised.herPower),
    settles: l.settles || (!l.appraised.accounted && released * (1 - entitlement) > 0.3),
  };
}

/** The strongest thing she is feeling, for instruments only. Nothing may BRANCH on this. */
export function loudest(l: Landing): "atSea" | "usedAsAThing" | "indignant" | "ready" | "unmoved" {
  const pairs = [
    ["atSea", l.atSea], ["usedAsAThing", l.usedAsAThing], ["indignant", l.indignant],
    ["ready", l.ready], ["unmoved", l.unmoved],
  ] as const;
  return pairs.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
}
