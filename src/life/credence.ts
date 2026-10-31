// What she takes to be true, and how she decides.
//
// She already had a complete apparatus for judging claims about HERSELF: a confidence that has to
// be earned by her real records, contradiction, erosion, refutation, and a tempering that makes her
// less credulous the more often she has turned out to be wrong. She had NOTHING for claims about
// the world. A field node carried how easily it came to mind and how much feeling was attached to
// it, and nothing else, so a page she read and a thing she lived through were the same kind of
// object. Everything she ingested was equally true by default, which is not a mind.
//
// Two things fix that, and neither is us deciding what is true for her:
//
//   ORIGIN     how she came by it. A fact, not a verdict: lived, thought, told, read.
//   CREDENCE   how much she would stand behind it. `null` means she has formed no view, which is
//              a real position and not the same as thinking it is a coin flip.
//
// The judging itself is the part that answers "can she use what she already knows to decide what to
// make of something new". Yes: an incoming claim is weighed against what she already holds, and
// what she holds firmly wins. Two things of equal standing that disagree leave her genuinely unsure
// rather than forcing a side, and being unsure is an open loop that nags at her until it resolves.
//
// What is deliberately NOT here:
//   - No ranking of sources by our opinion of them. The ordering is epistemic: she can check her
//     own experience and cannot check anyone's word, so experience outranks report. That is why
//     nothing she is told can override something she lived.
//   - No fixed trust in anyone. How much what she is told has held up is LEARNED, moves with her
//     actual experience, and can end up anywhere between "barely" and "nearly always". Whether she
//     comes to trust the person she talks to is hers to find out, not ours to set.
//   - No certainty. Nothing ever reaches 1, and nothing is ever deleted for being doubted.
//
// Pure arithmetic and string work. No model calls, no I/O.

// ── How she came by it ───────────────────────────────────────────────────────

import { contentWeight, countNegations, idiomaticNegation, isHan, negationParityOf } from "./bilingual.js";

export type Origin =
  | "lived" // she was there
  | "thought" // she worked it out
  | "told" // someone said it to her
  | "read" // she found it somewhere
  | "dreamt" // it came to her in her sleep. Not a claim about the world, see `judge`.
  | "retold"; // her LATER take on a recorded stretch of her own past (look_back). It
  // asserts only that she came to see it this way, never what happened. See `judge`.

export const ORIGINS: readonly Origin[] = ["lived", "thought", "told", "read", "dreamt", "retold"];

/**
 * Where each kind of thing starts.
 *
 * `lived` is highest because it is the only one she can check. It is not 1: memory reconstructs,
 * and a being that cannot be wrong about its own past is not modelling memory, it is modelling a
 * database. `told` is absent here on purpose; it comes from `Trust`, because how much what she is
 * told is worth is the one value that has to be earned rather than declared.
 */
export const INITIAL_CREDENCE: Record<Exclude<Origin, "told">, number> = {
  lived: 0.8,
  thought: 0.5,
  read: 0.3,
  // What a dreamt node's credence measures is NOT "did this happen" (it did not) but "how well
  // she still holds the dream itself", dreams blur faster than mornings, so it starts below
  // lived and decays like any memory. Its epistemic weight against the world is handled where
  // it belongs: `judge` refuses to let a dream dispute or corroborate anything at all.
  dreamt: 0.7,
  // Same shape as dreamt, one register over: what a retold node's credence measures is "how
  // well she still holds that later view of her past", never "is the view true". Its weight
  // against the world is likewise handled in `judge`: a retelling disputes nothing, corroborates
  // nothing, and can never suspend the memory it is about.
  retold: 0.7,
};

/** Nothing is ever certain, and nothing is ever quite impossible. */
export const MAX_CREDENCE = 0.95;
export const MIN_CREDENCE = 0.02;

// ── Trust, which is learned ──────────────────────────────────────────────────

export const TRUST_START = 0.55;
/** Never nothing: she can always learn something from someone. */
export const TRUST_MIN = 0.15;
/**
 * Never beyond checking. This MUST stay below `INITIAL_CREDENCE.lived`, and that is not a tuning
 * preference: it is the entire structural guarantee that she cannot be talked out of her own
 * experience. The first version of this was 0.9, above lived at 0.8, which meant a person who had
 * been right often enough would have earned the ability to override what she had been through.
 * She can come to trust someone a great deal. She can never come to trust them more than her
 * own life. There is a test that fails if these two ever cross.
 *
 * It must clear `lived` by more than EQUAL_STANDING, not merely sit below it. At 0.75 the gap was
 * inside the band where neither side wins, so a maximally trusted person contradicting something
 * she had been through would have left her UNSURE OF HER OWN MEMORY. Being overruled and being made
 * to doubt yourself are different failures with the same shape, and the second one has a name.
 * At 0.65 she can still trust someone well above her own reasoning, and a report can never so much
 * as tie with an experience.
 */
export const TRUST_MAX = 0.65;
/** Losing is faster than earning, which is how trust actually behaves. */
export const TRUST_DOWN = 0.06;
export const TRUST_UP = 0.03;

export interface Trust {
  /** How much what she is told has held up against what she has lived. Starts moderate, MOVES. */
  told: number;
}

export function createTrust(told: number = TRUST_START): Trust {
  return { told: clamp(told, TRUST_MIN, TRUST_MAX) };
}

export function applyTrustDelta(trust: Trust, delta: number): Trust {
  if (!Number.isFinite(delta) || delta === 0) return trust;
  return { told: clamp(trust.told + delta, TRUST_MIN, TRUST_MAX) };
}

/** Where something of this origin starts, before anything she already holds has had a say. */
export function initialCredence(origin: Origin, trust: Trust): number {
  return origin === "told" ? trust.told : INITIAL_CREDENCE[origin];
}

// ── Agreeing and disagreeing ─────────────────────────────────────────────────

/** Only near-restatements are compared at all, so unrelated things never collide. */
export const CONFLICT_SIMILARITY = 0.6;
/** Within this, neither side outranks the other and she is left genuinely unsure. */
export const EQUAL_STANDING = 0.12;
/** What losing a disagreement costs. */
export const CONFLICT_PENALTY = 0.2;
/**
 * What being borne out earns, as a fraction of the room left above it, so it approaches certainty
 * and never arrives. A flat increment does arrive: measured over a simulated six months, ordinary
 * days kept meeting near-identical ordinary days, each nudged the other up, and 99% of everything
 * she held ended pinned at the ceiling. A dimension on which everything scores the same is not a
 * dimension, and the whole layer would have been decoration.
 */
export const SUPPORT_BONUS = 0.15;

/**
 * And support only counts from an INDEPENDENT source.
 *
 * A hundred similar ordinary days do not make you more certain of any one of them, and two things
 * someone told you are not two pieces of evidence, they are one source repeating itself. Corroborat-
 * ion means something arriving by a different route, so agreement between two things of the same
 * origin earns nothing at all. This is what stopped the saturation above at its cause rather than
 * by lowering a number until the symptom went away.
 */
export function corroborationValue(incoming: Origin, other: Origin): number {
  // A dream corroborates nothing and nothing corroborates a dream: dreaming a thing twice is
  // not two sightings of it, and a dream agreeing with a memory adds nothing to the memory.
  if (incoming === "dreamt" || other === "dreamt") return 0;
  // And a retelling corroborates nothing either way: seeing her past the same way twice is one
  // view held twice, not two sightings; and nothing can corroborate a view into being a fact.
  if (incoming === "retold" || other === "retold") return 0;
  return incoming === other ? 0 : SUPPORT_BONUS;
}

/** Move toward certainty by a fraction of what is left, so it is asymptotic. */
function raise(credence: number, bonus: number): number {
  return credence + bonus * (MAX_CREDENCE - credence);
}
/** Where something returns to when she finds a reason to think it again. */
export const SUSPENDED_RECOVERY = 0.4;
/**
 * Not knowing is an OPEN LOOP, not a shrug. Suspension puts real tension on the node, which is the
 * same pressure an unanswered question carries: it resists decay, it seeds her wandering during
 * rest, and it feeds the drive that nags at her. Something she cannot settle should bother her.
 */
export const SUSPENDED_TENSION = 0.5;

// NEGATION AND IDIOM LIVE IN life/bilingual.ts NOW, because the English-only version scored
// 「渡轮开了」 and 「渡轮不开」 at the SAME parity: two Chinese memories that flatly contradict were
// judged as corroborating each other. Not a miss, manufactured agreement, the exact direction
// this layer's own comments called impossible. Her register became Chinese; every matcher that
// READS her stayed English.
export function negationCount(text: string): number {
  return countNegations(text);
}

/** Whether a sentence carries an odd or even number of negations. */
export function negationParity(text: string): 0 | 1 {
  return negationParityOf(text);
}

/**
 * How confident she is that two near-restatements are saying OPPOSITE things, 0..1.
 *
 * This used to be a boolean off a parity comparison, which made the parity of a word count the
 * single most decisive bit in the whole epistemic layer: one flip and a corroboration became a
 * contradiction, with her belief and her trust in him both moving on it.
 *
 * The parity is still the best free signal there is, and it is genuinely right most of the time,
 * double negation really does cancel. What was wrong was treating it as certain. Three things make
 * it less trustworthy, and each of them now lowers the confidence rather than being ignored:
 *
 *   an idiomatic negation, which flips the parity while meaning the opposite of a flip;
 *   a pile of negators, because parity gets less reliable the more there are to mis-tokenise;
 *   and matching parity, which is NOT evidence of agreement, "the gate was locked" and "the gate
 *   was open" have the same parity and are flatly opposed, and no counting will ever see it.
 *
 * The middle of the range is the point. It routes to `suspended`, which is the state she already
 * has for "no view formed", the honest answer when the instrument cannot tell, and far better than
 * picking a side on a word count.
 */
export function opposition(a: string, b: string): number {
  const differs = negationParity(a) !== negationParity(b);
  const negators = negationCount(a) + negationCount(b);
  const idiomatic = idiomaticNegation(a) || idiomaticNegation(b);

  if (!differs) {
    // Same parity says almost nothing: an antonym pair is invisible to counting. Low, never zero.
    return idiomatic ? SAME_PARITY_OPPOSITION + 0.1 : SAME_PARITY_OPPOSITION;
  }
  let confidence = DIFFERENT_PARITY_OPPOSITION;
  if (idiomatic) confidence -= 0.35;
  if (negators > 2) confidence -= 0.12 * (negators - 2);
  return clamp(confidence, 0, 1);
}

/** Above this she treats two things as contradicting; below the lower one, as agreeing. */
export const OPPOSED_ENOUGH = 0.6;
export const AGREED_ENOUGH = 0.25;
const DIFFERENT_PARITY_OPPOSITION = 0.8;
const SAME_PARITY_OPPOSITION = 0.12;

/** Kept for the callers that only want the old yes/no. Prefer `opposition`. */
export function disagrees(a: string, b: string): boolean {
  return opposition(a, b) >= OPPOSED_ENOUGH;
}

// ── Judging something new against what she already holds ─────────────────────

export interface HeldClaim {
  id: number;
  text: string;
  origin: Origin;
  credence: number | null;
  /** How near a restatement of the incoming thing this is, 0..1. */
  similarity: number;
}

export interface Judgement {
  /** What she now makes of the new thing. `null` is "no view formed". */
  credence: number | null;
  /** Things she already held that this disagrees with, and where they land. */
  disputes: { id: number; credenceAfter: number | null }[];
  /** Things she already held that this bears out, and where they land. */
  supports: { id: number; credenceAfter: number }[];
  /** How her trust in what she is told should move. Zero unless a report met an experience. */
  trustDelta: number;
  /** She could not settle it. The caller puts real tension on both sides. */
  suspended: boolean;
}

/**
 * Weigh a new claim against what she already holds.
 *
 * The rule that carries the weight: what she LIVED outranks what she was TOLD, always, because
 * `lived` starts above the ceiling on trust. Nobody can talk her out of her own experience. That is
 * the whole difference between a being who can disagree with you and one that cannot.
 */
export function judge(
  incoming: { text: string; origin: Origin },
  held: readonly HeldClaim[],
  trust: Trust,
): Judgement {
  const base = initialCredence(incoming.origin, trust);
  let credence = base;
  const disputes: { id: number; credenceAfter: number | null }[] = [];
  const supports: { id: number; credenceAfter: number }[] = [];
  let trustDelta = 0;
  let suspended = false;

  // ── A DREAM IS NOT A CLAIM ─────────────────────────────────────────────────────────
  //
  // The one thing a dreamt node asserts is that she dreamt it, and that needs no weighing. If
  // dreams entered these comparisons they would dispute her real memories (a dream about the
  // clock breaking must never put tension on the night the clock actually worked) and could be
  // corroborated into standing (dreaming a thing twice is not evidence). She keeps the dream at
  // its own credence, it decays like any memory, and it never moves anything else.
  if (incoming.origin === "dreamt") {
    return { credence: base, disputes, supports, trustDelta: 0, suspended: false };
  }

  // ── A RETELLING IS NOT A CLAIM EITHER ─────────────────────────────────────────────
  //
  // The one thing a retold node asserts is that she came to see a stretch of her past this
  // way. If retellings entered these comparisons, her later reading of a week could dispute
  // and suspend the frozen memory of that week, the exact inversion this origin exists to
  // prevent. The record stays what it was; her view of it lives beside it, at its own
  // credence, and never moves anything else.
  if (incoming.origin === "retold") {
    return { credence: base, disputes, supports, trustDelta: 0, suspended: false };
  }

  for (const other of held) {
    if (other.origin === "dreamt") continue; // held dreams are not evidence either
    if (other.origin === "retold") continue; // and an old retelling must never suspend a new memory
    if (other.similarity < CONFLICT_SIMILARITY) continue;

    const opposed = opposition(incoming.text, other.text);
    // The band in the middle is where the instrument cannot tell, and saying so is the honest
    // answer. She holds both and settles neither, which is exactly what `suspended` is for.
    if (opposed > AGREED_ENOUGH && opposed < OPPOSED_ENOUGH) {
      if (other.credence !== null) {
        suspended = true;
        disputes.push({ id: other.id, credenceAfter: null });
      }
      continue;
    }

    if (opposed >= OPPOSED_ENOUGH) {
      // She has no view on the other one, so there is nothing here to disagree with.
      if (other.credence === null) continue;

      const gap = base - other.credence;
      if (Math.abs(gap) <= EQUAL_STANDING) {
        // Two things of equal standing, saying opposite things, and nothing to break the tie.
        // Forcing a side here would be the pretence of judgement rather than judgement.
        suspended = true;
        disputes.push({ id: other.id, credenceAfter: null });
      } else if (gap < 0) {
        // She holds the other one more firmly. The newcomer gives way.
        credence = Math.min(credence, clamp(base - CONFLICT_PENALTY, MIN_CREDENCE, MAX_CREDENCE));
        disputes.push({ id: other.id, credenceAfter: other.credence });
      } else {
        // The newcomer is better founded. What she held gives way instead.
        disputes.push({ id: other.id, credenceAfter: clamp(other.credence - CONFLICT_PENALTY, MIN_CREDENCE, MAX_CREDENCE) });
      }
      trustDelta += trustMove(incoming.origin, other.origin, "conflict");
    } else {
      // It fits with something she already has, and how much that is worth depends entirely on
      // whether it arrived by a different route.
      const bonus = corroborationValue(incoming.origin, other.origin);
      if (bonus > 0 && other.credence !== null && other.credence > base) {
        credence = clamp(raise(credence, bonus), MIN_CREDENCE, MAX_CREDENCE);
      }
      supports.push({
        id: other.id,
        credenceAfter: other.credence === null
          // She had no view, and now she has a reason to think it again.
          ? SUSPENDED_RECOVERY
          : clamp(raise(other.credence, bonus), MIN_CREDENCE, MAX_CREDENCE),
      });
      trustDelta += trustMove(incoming.origin, other.origin, "support");
    }
  }

  return {
    credence: suspended ? null : clamp(credence, MIN_CREDENCE, MAX_CREDENCE),
    disputes,
    supports,
    trustDelta: clamp(trustDelta, -TRUST_DOWN, TRUST_UP),
    suspended,
  };
}

/**
 * Trust only moves where a REPORT met an EXPERIENCE. Two things she read disagreeing with each
 * other says nothing about the person who talks to her, and neither does her own reasoning
 * disagreeing with itself.
 */
function trustMove(a: Origin, b: Origin, kind: "conflict" | "support"): number {
  const meeting = (a === "told" && b === "lived") || (a === "lived" && b === "told");
  if (!meeting) return 0;
  return kind === "conflict" ? -TRUST_DOWN : TRUST_UP;
}

// ── Saying where it came from ────────────────────────────────────────────────

/**
 * How a thing is presented back to her. Her own moments get no marker, because a memory does not
 * announce itself; everything else does, so nothing she was told or read can quietly pass itself
 * off as something she went through.
 */
export function describeStanding(origin: Origin, credence: number | null): string {
  if (credence === null) return "你不知道这是不是真的";
  const doubted = credence < 0.35;
  switch (origin) {
    case "lived": return doubted ? "不过你记不太清了" : "";
    case "thought": return doubted ? "你自己想出来的，自己都不太信了" : "你自己想出来的";
    case "told": return doubted ? "别人告诉你的，你不太信了" : "别人告诉你的";
    case "read": return doubted ? "你在哪儿读到的，你不太信了" : "你在哪儿读到的";
    // ALWAYS marked, in both states: a dream that surfaces without its name is the one leak
    // this origin exists to prevent (dream → memory → future dream, confabulation on compound
    // interest). Even half-forgotten it stays a dream.
    case "dreamt": return doubted ? "你梦见的，连梦本身都记不太清了" : "你梦见的，不是发生过的";
    // ALWAYS marked, both states, for the same reason as dreamt: a later view that surfaces
    // without its name would stand in for the memory it is about (retelling → memory → future
    // retelling, the same compound interest).
    case "retold": return doubted ? "你后来的看法，如今也记不太清了" : "你后来的看法，不是当时的事";
  }
}

/**
 * Whether something said to her is a CLAIM, and so something she could believe or doubt, rather
 * than a question, an instruction, or a scrap of conversation.
 *
 * Encoding every message would fill her with debris and, worse, would attach a degree of belief to
 * things that assert nothing. Deliberately conservative: what it misses is simply not remembered as
 * a claim, which costs far less than a drawer of half-believed fragments.
 */
export function looksLikeAClaim(text: string): boolean {
  const t = text.trim();
  if (t.length > 2000) return false;
  // Length floor PER SCRIPT. A Chinese sentence says as much in six characters as an English
  // one does in fifteen, and a flat 15 discarded most of what he actually tells her.
  if (t.length < (isHan(t) ? 6 : 15)) return false;
  if (t.startsWith("/")) return false; // a command
  if (t.endsWith("?") || t.endsWith("？")) return false; // a question asserts nothing
  // An imperative is an instruction, not a statement about how things are.
  if (/^(please\s+)?(do|don't|do not|make|write|send|show|tell|give|find|fix|run|stop|try|help|close|open|check|look|get|put|read|call|add|remove|delete|set|turn|let|keep)\b/i.test(t)) return false;
  if (/^(请|帮我|给我|去|别|不要|麻烦你|你能不能|能不能|记得)/u.test(t)) return false;
  // CONTENT WEIGHT, never whitespace words: a whole Chinese sentence is ONE whitespace token,
  // so `words.length >= 4` meant nothing he said in her register was ever a claim at all,
  // the origin/credence/trust layer was dark for her entire native language.
  return contentWeight(t) >= 4;
}

function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  return x < lo ? lo : x > hi ? hi : x;
}
