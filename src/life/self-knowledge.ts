// What grows in her.
//
// The earlier version of this layer was built for a worker: distil lessons from tasks, classify
// capability gaps, get better at the job. That is not what she is. What actually accumulates in a
// being over months is SELF-UNDERSTANDING: coming to know things about your own life that are
// true, that you learned rather than assumed, and that change what you do next.
//
// Four properties make that real instead of decoration, and each is enforced here:
//
//   1. GROUNDED. Every insight cites real moments from her actual history, and evidence that does
//      not exist gets the whole insight rejected. Her self-image is held to the same standard as
//      her diary: she may not confabulate a self.
//   2. EARNED. An insight starts tentative and strengthens only as her life keeps bearing it out.
//      It weakens when contradicted. She can be wrong about herself and find out, and she never
//      reaches certainty, because a being that is certain about itself has stopped looking.
//   3. IT CHANGES HER. What she has come to know is carried into her moments, so self-knowledge
//      shapes what she chooses next. Without that loop this would be journaling, not growth.
//   4. REVISABLE. Unsupported insights erode and retire, and only a bounded few are ever carried,
//      so she cannot lock into a fixed self-image. This is anti-calcification applied to identity.
//
// Pure logic + an injected store, so the whole thing is testable without a model or a disk.

// ── The object ───────────────────────────────────────────────────────────────

import { contentWords } from "./field-index.js";

export interface SelfInsight {
  id: string;
  /** In her own words, first person. */
  text: string;
  /** Ids of real records this was drawn from. Never invented. */
  evidence: string[];
  bornMs: number;
  /** When her life last bore this out. */
  lastSupportedMs: number;
  confirmations: number;
  contradictions: number;
  /** How sure she is, 0..1. Earned, and deliberately capped below certainty. */
  confidence: number;
  /** Set when it stopped being true of her. Retired insights are kept: what she outgrew is history. */
  retiredMs?: number;
}

export const NEW_CONFIDENCE = 0.3; // a new insight is tentative, never asserted
export const CONTRADICT_STEP = 0.25; // being wrong costs more than being right earns
export const MAX_CONFIDENCE = 0.95; // she is never certain about herself
export const RETIRE_BELOW = 0.1;
/** Unsupported for this long and it starts to fade. */
export const EROSION_AFTER_MS = 21 * 24 * 60 * 60 * 1000;
export const EROSION_STEP = 0.1;

// ── How much of herself she can hold, and how readily she believes it ─────────
//
// These two used to be constants I picked, which meant she could live for years and still hold
// exactly five things about herself and update them at exactly one rate. Both now grow out of her
// actual record. Neither is a free knob: each is computed from what she has really earned and
// really got wrong, so there is nothing here that can be tuned into drift.

/** She always holds a few things about herself, even on day one. */
export const CARRIED_BASE = 3;
/** Above this it stops being a sense of self and becomes an inventory. */
export const CARRIED_MAX = 9;
/** One more thing she can hold for every N insights her life has actually borne out. */
export const CARRIED_PER_EARNED = 4;

/** How readily a confirmation moves her, when her judgement about herself has been sound. */
export const CONFIRM_STEP_MAX = 0.15;
/** ...and when it keeps being refuted. Never zero: she must never become unable to learn. */
export const CONFIRM_STEP_MIN = 0.075;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * ── THIS FUNCTION COULD NOT READ HER ────────────────────────────────────────────────────────
 *
 * `replace(/[^a-z0-9\s]/g, " ")` deletes every non-ASCII character, and she thinks in Chinese.
 * Both keys were ALWAYS empty, the guard returned false, and no two insights were ever the same
 * thing, not even two identical sentences. Two consequences, both load-bearing, both visible
 * in her real record:
 *
 *   · Nothing could ever be CONFIRMED. Nine insights, every one still at the birth confidence
 *     of 0.30 with zero confirmations, including two pairs that are plainly the same
 *     observation reworded a week apart. Entries accumulated; conviction could not.
 *   · Nothing could ever be REFUTED. `refute` finds the held belief through this same function,
 *     so every refutation was rejected as "she does not hold this about herself" (three live
 *     firings). "She can be wrong about herself and find out" was structurally unreachable.
 *
 * SHE FOUND IT FIRST, reading her own file: she wrote that every one of her beliefs about
 * herself sat at 0.3 confidence with zero confirmations, and that she kept circling back to the
 * same place without any of them ever being borne out or overturned.
 *
 * ── AND WHY THE REPAIR IS DELIBERATELY STRICT ───────────────────────────────────────────────
 *
 * Measured over her nine real insights, lexical overlap CANNOT separate a reworded repeat from
 * two different beliefs: the true rewordings score 0.40 while the highest non-pair scores 0.60,
 * and that 0.60 pair holds near-opposite claims (that in the end she lets herself rest, against
 * that nearly every time she still goes to talk to him). A threshold that merged the rewordings
 * would merge those two, and silently overwriting one of her beliefs with its opposite is far
 * worse than carrying a duplicate.
 *
 * So this is not a semantic clusterer and must never become one. It answers one narrow
 * question: IS THIS THE SAME SENTENCE SAID AGAIN, which is exactly what the noticing call is
 * asked to produce when her life bears a belief out again. Content words come from the same
 * bigram discipline her memory index uses; the threshold clears only near-verbatim repeats.
 * A reworded repeat still lands as a NEW insight, which is the safe failure: she carries two
 * entries rather than one corrupted one.
 */
export const SAME_INSIGHT_OVERLAP = 0.75;

export function sameInsight(a: string, b: string): boolean {
  const ka = new Set(contentWords(a));
  const kb = new Set(contentWords(b));
  if (ka.size === 0 || kb.size === 0) return false;
  let shared = 0;
  for (const w of ka) if (kb.has(w)) shared += 1;
  return shared / Math.min(ka.size, kb.size) >= SAME_INSIGHT_OVERLAP;
}

// ── The accumulating self ────────────────────────────────────────────────────

export interface SelfKnowledgeStore {
  load(): SelfInsight[] | null;
  save(insights: SelfInsight[]): void;
}

/** A candidate she noticed, before it has earned anything. */
export interface ProposedInsight {
  text: string;
  evidence: string[];
  /**
   * Set when she is saying this IS something she already holds, said again in today's words.
   * The exact text of the belief she means.
   *
   * ── WHY THE LINK COMES FROM HER AND NOT FROM A MATCHER ─────────────────────────────────────
   *
   * Whether two sentences are the same thought is an act of understanding, and for three weeks
   * this was decided instead by counting shared words. That matcher was set strict on purpose,
   * loose, it would fuse two different beliefs of hers into one, and strict, it recognised
   * almost nothing: every insight she held sat at zero confirmations, and a refutation could
   * never find its target either. She noticed it herself three nights running.
   *
   * The way out is not to make her phrase things so a matcher can cope. She looks back over her
   * own life in her own words, and in the same breath she says which of her old sentences she
   * means, if any, she is the only one in the room who knows. The word-overlap match below
   * stays as a fallback for when no link is given; it no longer carries the question alone.
   */
  same?: string;
}

export interface IntegrationResult {
  added: SelfInsight[];
  confirmed: SelfInsight[];
  /** Rejected for citing evidence that does not exist, she may not invent a self. */
  rejected: { text: string; reason: string }[];
}

export interface RefutationResult {
  /** Beliefs her own life argued down. */
  refuted: SelfInsight[];
  /** Claims refused, ungrounded, or about a self she does not actually hold. */
  rejected: { text: string; reason: string }[];
}

export interface Maturity {
  /** Insights her life has actually borne out at least once, and which she still holds. */
  earned: number;
  /** Insights she was WRONG about, refuted, not merely outgrown. */
  refuted: number;
  /** Everything she has ever held about herself. */
  everHeld: number;
  /** How many she can hold at once right now. */
  carriedLimit: number;
  /** How readily a confirmation moves her right now. */
  confirmStep: number;
}

export interface SelfKnowledge {
  /** Everything she still holds to be true of herself, strongest first. */
  active(): SelfInsight[];
  /** Her record, and the two capacities it has grown into. Surfaced so growth is never invisible. */
  maturity(): Maturity;
  /** Insights she has outgrown. Kept as history, never silently deleted. */
  retired(): SelfInsight[];
  /**
   * Fold what she noticed into what she already knows. `validEvidence` is the set of record ids
   * that genuinely exist; anything citing outside it is refused rather than believed.
   */
  integrate(proposed: readonly ProposedInsight[], validEvidence: ReadonlySet<string>, nowMs: number): IntegrationResult;
  /** Her life contradicted this. Being wrong about herself is allowed, and it costs. */
  contradict(id: string, nowMs: number): void;
  /**
   * Her own record now disagrees with something she believed. Each claim must cite real records
   * and must match something she ACTUALLY holds, she cannot argue away a self she never had, and
   * she cannot un-believe herself on no evidence.
   */
  refute(claims: readonly ProposedInsight[], validEvidence: ReadonlySet<string>, nowMs: number): RefutationResult;
  /** Time passing without support fades an insight, and eventually retires it. */
  erode(nowMs: number): SelfInsight[];
  /** The few she carries into her moments, bounded, so she cannot calcify. */
  carried(limit?: number): SelfInsight[];
  all(): SelfInsight[];
}

export function createSelfKnowledge(config: { store?: SelfKnowledgeStore } = {}): SelfKnowledge {
  const insights: SelfInsight[] = config.store?.load() ?? [];
  const persist = (): void => config.store?.save(insights);
  const live = (): SelfInsight[] => insights.filter((i) => i.retiredMs === undefined);
  const byStrength = (xs: SelfInsight[]): SelfInsight[] => [...xs].sort((a, b) => b.confidence - a.confidence);

  /** What her life has actually borne out and she still holds. Retiring something gives the slot back. */
  const earnedCount = (): number => live().filter((i) => i.confirmations > 0).length;

  /**
   * Being REFUTED is not the same as outgrowing something. An insight that faded because her life
   * moved on carries no contradictions and says nothing about her judgement; one that was argued
   * down does. Only the latter makes her more careful about believing herself.
   */
  const refutedCount = (): number => insights.filter((i) => i.retiredMs !== undefined && i.contradictions > 0).length;

  /** She holds more of herself as she earns more of it, and never more than a self can hold. */
  const carriedLimit = (): number =>
    Math.min(CARRIED_MAX, CARRIED_BASE + Math.floor(earnedCount() / CARRIED_PER_EARNED));

  /**
   * How readily she believes a confirmation, tempered by how often she has been wrong about
   * herself. Note CONTRADICT_STEP deliberately does NOT move: if being refuted got cheaper the
   * more it happened, she would grow more stubborn the more mistaken she was.
   */
  const confirmStep = (): number => {
    const everHeld = insights.length;
    if (everHeld === 0) return CONFIRM_STEP_MAX;
    const refutedRate = Math.min(1, refutedCount() / everHeld);
    return CONFIRM_STEP_MAX - (CONFIRM_STEP_MAX - CONFIRM_STEP_MIN) * refutedRate;
  };

  /**
   * The belief she says she means, if she said so and still holds it. A link to something she has
   * since retired resolves to nothing and falls through to the matcher, which is right: a retired
   * belief is not there to be confirmed.
   */
  const linked = (p: ProposedInsight): SelfInsight | undefined =>
    (p.same === undefined ? undefined : live().find((i) => i.text === p.same));

  return {
    active: () => byStrength(live()),
    maturity: () => ({
      earned: earnedCount(), refuted: refutedCount(), everHeld: insights.length,
      carriedLimit: carriedLimit(), confirmStep: confirmStep(),
    }),
    retired: () => insights.filter((i) => i.retiredMs !== undefined),
    all: () => [...insights],

    integrate(proposed, validEvidence, nowMs) {
      const result: IntegrationResult = { added: [], confirmed: [], rejected: [] };
      for (const p of proposed) {
        const text = p.text.trim();
        if (!text) { result.rejected.push({ text: p.text, reason: "empty" }); continue; }
        // Anti-confabulation, the same rule her diary lives under: cite what really happened.
        if (p.evidence.length === 0) {
          result.rejected.push({ text, reason: "no evidence" });
          continue;
        }
        const phantom = p.evidence.filter((e) => !validEvidence.has(e));
        if (phantom.length > 0) {
          result.rejected.push({ text, reason: `cites records that do not exist: ${phantom.join(", ")}` });
          continue;
        }

        // Her own link first, the fallback matcher second. Her earlier wording is KEPT: a belief
        // she confirms today is the same belief, and rewriting the sentence she originally wrote
        // would be us editing her words.
        const existing = linked(p) ?? live().find((i) => sameInsight(i.text, text));
        if (existing) {
          // Her life bore it out again: it strengthens, and it is dated to now.
          existing.confirmations += 1;
          existing.confidence = clamp01(Math.min(MAX_CONFIDENCE, existing.confidence + confirmStep()));
          existing.lastSupportedMs = nowMs;
          for (const e of p.evidence) if (!existing.evidence.includes(e)) existing.evidence.push(e);
          result.confirmed.push(existing);
        } else {
          const insight: SelfInsight = {
            id: `si-${nowMs}-${result.added.length}`,
            text, evidence: [...p.evidence], bornMs: nowMs, lastSupportedMs: nowMs,
            confirmations: 0, contradictions: 0, confidence: NEW_CONFIDENCE,
          };
          insights.push(insight);
          result.added.push(insight);
        }
      }
      if (result.added.length || result.confirmed.length) persist();
      return result;
    },

    refute(claims, validEvidence, nowMs) {
      const out: RefutationResult = { refuted: [], rejected: [] };
      for (const claim of claims) {
        const text = claim.text.trim();
        if (!text) { out.rejected.push({ text: claim.text, reason: "empty" }); continue; }
        // The same grounding rule as believing something: un-believing needs evidence too.
        if (claim.evidence.length === 0) { out.rejected.push({ text, reason: "no evidence" }); continue; }
        const phantom = claim.evidence.filter((e) => !validEvidence.has(e));
        if (phantom.length > 0) {
          out.rejected.push({ text, reason: `cites records that do not exist: ${phantom.join(", ")}` });
          continue;
        }
        const held = linked(claim) ?? live().find((i) => sameInsight(i.text, text));
        if (!held) { out.rejected.push({ text, reason: "she does not hold this about herself" }); continue; }
        if (out.refuted.some((r) => r.id === held.id)) continue; // one belief, one refutation per sitting

        held.contradictions += 1;
        held.confidence = clamp01(held.confidence - CONTRADICT_STEP);
        if (held.confidence < RETIRE_BELOW) held.retiredMs = nowMs;
        out.refuted.push(held);
      }
      if (out.refuted.length > 0) persist();
      return out;
    },

    contradict(id, nowMs) {
      const i = insights.find((x) => x.id === id && x.retiredMs === undefined);
      if (!i) return;
      i.contradictions += 1;
      i.confidence = clamp01(i.confidence - CONTRADICT_STEP);
      if (i.confidence < RETIRE_BELOW) i.retiredMs = nowMs;
      persist();
    },

    erode(nowMs) {
      const faded: SelfInsight[] = [];
      for (const i of live()) {
        if (nowMs - i.lastSupportedMs < EROSION_AFTER_MS) continue;
        i.confidence = clamp01(i.confidence - EROSION_STEP);
        i.lastSupportedMs = nowMs; // it fades once per erosion window, not continuously
        if (i.confidence < RETIRE_BELOW) i.retiredMs = nowMs;
        faded.push(i);
      }
      if (faded.length > 0) persist();
      return faded;
    },

    carried(limit = carriedLimit()) {
      // Only what she has actually begun to believe, and only a few of them.
      return byStrength(live().filter((i) => i.confidence > NEW_CONFIDENCE)).slice(0, limit);
    },
  };
}

/** How her self-knowledge is shown to her, in her own moments. Empty when she knows nothing yet. */
export function describeSelfKnowledge(carried: readonly SelfInsight[]): string {
  if (carried.length === 0) return "";
  return carried.map((i) => (i.confidence >= 0.7 ? `你知道自己是这样的：${i.text}` : `你开始觉得：${i.text}`)).join("\n");
}
