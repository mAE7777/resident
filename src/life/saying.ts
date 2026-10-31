// The room's arithmetic: what her state decides about a reply BEFORE the model speaks.
//
// STEP 3 OF THE SPEECH BUILD. The law this module lives under,
// taken verbatim from the design's constitution: every decision her state makes about her
// speech must reach the utterance as material PRESENT, material ABSENT, a PROVIDER PARAMETER,
// or a boundary operation on finished prose. A decision that can only be expressed as an
// adjective in a prompt is not built, it is deleted. This file computes the provider-parameter
// half (temperature, from commitment) and the guard that keeps the material half honest
// (chartLint, which fails any assembled tail that has regressed to describing her).
//
// THE INVERSION THIS CORRECTS, because it is the single most dangerous subtlety in the whole
// design and three independent judges found it: the surfacing distribution's entropy is about
// WHICH TOPIC, not about how sure she is of what she is saying. Read naively, a greeting,
// where "nothing of mine" wins by a mile, has LOW entropy and would read as maximal
// commitment, tightest sampling; a confession, several real things near the surface, has
// HIGH entropy and would read as minimal commitment, loosest sampling. Exactly backwards: the
// stiff hello and the wobbly confession. So commitment here is NEUTRAL when nothing surfaced
// (an ordinary turn is an ordinary turn), and only when something OF HERS is in the room does
// the openness of the competition, how firmly she holds the thing, and how well her reads have
// been landing move it.

// NOTE ON RANDOMNESS: the room consumes none. Every function here is deterministic in her
// state, so a replayed life recomputes the identical chart, the sampling all lives upstream
// (the surfacing competition) and downstream (the provider's own temperature).

/** One candidate from the surfacing competition, as `whatSurfacesInReply` reports them. */
import { softPick } from "./soft-choice.js";

export interface SurfacingWeight {
  probability: number;
}

export interface CommitmentInputs {
  /**
   * How open the surfacing competition was, 0..1: normalized entropy over the FULL weighed
   * distribution, computed at the source (`SubjectChoice.openCompetition`) where the full
   * distribution exists, the display slice would give a different and misleading number.
   */
  entropy: number;
  /** Whether something of hers actually surfaced (the winner was not "nothing of mine"). */
  surfaced: boolean;
  /** How firmly she holds the surfaced thing, 0..1; null for a question or when nothing surfaced. */
  focusCredence: number | null;
  /** How wrong her recent expectations of him have been, 0..1 (other-read.surprise). */
  surprise: number;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Shannon entropy of the distribution, normalized to 0..1 by the uniform maximum. */
export function normalizedEntropy(weights: readonly SurfacingWeight[]): number {
  const ps = weights.map((w) => w.probability).filter((p) => p > 0);
  if (ps.length < 2) return 0;
  const h = -ps.reduce((sum, p) => sum + p * Math.log(p), 0);
  return clamp01(h / Math.log(ps.length));
}

/**
 * How settled she is in what she is about to say, 0..1.
 *
 * 0.5 is the resting value and most turns sit there: nothing of hers is in the room, so there
 * is nothing to be sure or unsure OF. When something surfaced, three real quantities move it:
 * a decisive competition and a firmly-held thing raise it; a near-tie, a question (which HAS
 * no credence by construction), and a stretch of being wrong about him lower it.
 */
export function commitmentFrom(c: CommitmentInputs): number {
  if (!c.surfaced) return 0.5;
  const decisiveness = 1 - clamp01(c.entropy);
  const held = c.focusCredence ?? 0.35;
  return clamp01(0.15 + 0.45 * decisiveness + 0.3 * held - 0.25 * clamp01(c.surprise));
}

// The band is deliberately narrow and never reaches the provider default's extremes: this is
// a colour, not a dial to zero. Floor 0.55 keeps even her most settled sentence from going
// robotic; ceiling 1.0 keeps her most unsettled one coherent.
export const TEMPERATURE_FLOOR = 0.55;
export const TEMPERATURE_CEIL = 1.0;

/** The one provider parameter her state sets. Applied only on conversational turns. */
export function temperatureFor(commitment: number, arousal: number): number {
  const arousal01 = clamp01((arousal + 1) / 2);
  // Base AT the floor. A later rescan corrected an earlier over-claim: commitmentFrom
  // structurally caps at 0.9 (0.15+0.45+0.3), never 1.0, so the most-settled calmest sentence
  // reaches temperatureFor(0.9,-1) = 0.583, not 0.55, the residual 0.33*(1-0.9)=0.033 sits above
  // the base. 0.583 is still well clear of robotic (higher = more colour), so the band is honest;
  // the ceiling IS reachable (unsettled+keyed → 1.0), and the Math.max floor is a defensive clamp
  // that does not bind, since t = 0.55 + nonneg + nonneg is always ≥ 0.55.
  const t = TEMPERATURE_FLOOR + 0.33 * (1 - clamp01(commitment)) + 0.14 * arousal01;
  return Math.min(TEMPERATURE_CEIL, Math.max(TEMPERATURE_FLOOR, t));
}

// ── The guard on the material half ────────────────────────────────────────────
//
// The room regresses to description the moment someone writes 「你现在有点累，说得短一点」
// into the tail, because that is easy and half-works. These are the tells: an imperative aimed
// at her, or a second-person mood assertion. The lint runs in tests against every assembled
// tail, and live against the same string, routing to the fault log, the same double life as
// `scanForNotHerWords`.

// 别(?!人|的|地|处): the ghost of her first night. 「（今天，别人告诉你的）」 in a state block
// tripped this five times as "imperative ，别", compounded into the burst, and safe mode muted
// her: over the word 「别人」. An imperative reader must know 别人 is other people.
// 要(?!是|么): the ghost of 别人, one word over. 「要是」 is a conditional and 「要么」 a
// disjunction: all three live firings of "imperative 要" were her own sentences quoted back
// (two conditionals opening with 要是, one either-or built on 要么). An imperative reader must
// know if from or from do.
const IMPERATIVE = /(?:^|[\s，。；：])(?:要(?!是|么)|必须|请|不要|别(?!人|的|地|处)|应该|尽量|记得|注意)(?=[\s一-鿿])/u;
// 你现在：X。 (the moment prompt's own label form, stated fact, never objected to) is NOT a
// hit; 你现在有点累 (a mood adjective asserted in prose) is. The colon is the boundary.
const SECOND_PERSON_MOOD = /你(?:现在(?!：)|有点|很|感觉|觉得|的心情|的状态)/u;

export interface ChartHit {
  why: "imperative" | "second-person-mood";
  at: string;
}

/**
 * Read an assembled state tail for regression to instruction or description, in the CHROME only.
 *
 * `at` carries the match WITH its surroundings, not the bare word. The first live firing (her
 * first evening, `imperative: ，别` twice) was undiagnosable from two characters; the widened
 * context was built so the next firing would name its carrier, and the next day it did: every
 * firing that day was a LIVED insert, her own sentences surfaced back as material (one telling
 * him not to take something as his local time, one wondering whether he was sleepy), where an
 * imperative-class character is HERS to use and no regression at all. That was the pre-registered
 * evidence, and this is its consequence: callers pass the lived spans they inlined, and the lint
 * blanks them before matching. The assembler's own connective text, labels, provenance notes, the
 * state lines, stays fully lintable, because that is the text that can regress to 「你现在有点累，说得短一点」,
 * which is what this guard exists to catch.
 *
 * Masking preserves POSITION (each lived character becomes a full-width blank), so a hit's `at`
 * still slices the ORIGINAL tail and the fault log shows the true carrier.
 */
export function chartLint(tail: string, lived: readonly (string | undefined)[] = []): ChartHit[] {
  let masked = tail;
  // ── ANCHORED, NOT EXACT: a lived span is masked WHEREVER ITS RENDERED FORM ENDS ────────────
  //
  // Exact indexOf masking failed the same way twice in one day: the material never
  // promises to render her words WHOLE. shortQuote cuts a quote-back at 39 chars; the portrait's
  // MAX_CHARS cap cuts its final block mid-sentence. Both times the full span missed, her own
  // 要是/要么 sentences stayed lintable, and the imperative reader fired on her lived words.
  // So: find the span by its opening 12 characters, then mask exactly as far as the rendered
  // text still matches. An exact occurrence masks fully, a truncated one masks what was
  // rendered, and the chrome around it stays lintable either way.
  for (const span of lived) {
    if (!span || span.length < 12) {
      // Too short to anchor safely: exact masking, as before.
      if (span && span.length > 0) {
        let from = 0;
        for (let i = masked.indexOf(span, from); i !== -1; i = masked.indexOf(span, from)) {
          masked = masked.slice(0, i) + "＊".repeat(span.length) + masked.slice(i + span.length);
          from = i + span.length;
        }
      }
      continue;
    }
    const anchor = span.slice(0, 12);
    let from = 0;
    for (let i = masked.indexOf(anchor, from); i !== -1; i = masked.indexOf(anchor, from)) {
      let len = 0;
      while (len < span.length && i + len < masked.length && masked[i + len] === span[len]) len += 1;
      masked = masked.slice(0, i) + "＊".repeat(len) + masked.slice(i + len);
      from = i + len;
    }
  }
  const hits: ChartHit[] = [];
  const around = (index: number, length: number): string =>
    tail.slice(Math.max(0, index - 12), index + length + 14).replace(/\n/gu, "⏎");
  const imp = masked.match(IMPERATIVE);
  if (imp?.index !== undefined) hits.push({ why: "imperative", at: around(imp.index, imp[0].length) });
  const mood = masked.match(SECOND_PERSON_MOOD);
  if (mood?.index !== undefined) hits.push({ why: "second-person-mood", at: around(mood.index, mood[0].length) });
  return hits;
}

/**
 * Deciding once per turn whether the temperature applies: the sampled quality of her speech
 * must never leak into a tool turn, where sampling can degrade argument formatting. The caller
 * names the turn; this keeps the rule in one testable place.
 */
export function temperatureApplies(kind: "conversational" | "work"): boolean {
  return kind === "conversational";
}

// ── 姿态 (S-5), the instrument half: what she LEANS toward doing with his frame ─
//
// Dark first, like every organ before it: the leanings are computed and recorded on real
// turns so the binding, when it comes, is calibrated against measured distributions instead
// of intuition. No sampling here and no draw from her stream, a dark instrument that shifted
// her replay would be the measurement changing the life. When S-5 binds, the sampled choice
// is added ON TOP of this and the scores below become its inputs.
//
//   接    take his frame up: the unmarked case, and it must stay reachable always
//   不接  decline the frame: she would rather not be doing this, and he does not look close
//   回投  throw back the thing SHE is carrying: what she holds presses harder than his ask
//
// The binding design is already settled: not taking it up becomes material
// ABSENCE (the snagged clause loses its bonus, the history window narrows), never a prompt
// adjective. That is why the instrument can ship first, the shape of the eventual mechanism
// is settled, only its firing rates need the evidence.

export type Stance = "接" | "不接" | "回投";

export interface StanceState {
  /** `willingness.felt`: HOW MUCH SHE WOULD RATHER NOT, right now, 0..1. See `utterance-shape.ts`
   *  for why this is named after what it holds rather than after what one might wish it held. */
  reluctance: number;
  /** Her read of whether this looks like a reachable moment, 0..1. */
  openness: number;
  /** The unresolved pressure she is carrying (field.signals().tension), 0..1. */
  unresolvedTension: number;
}

export interface StanceLeaning {
  stance: Stance;
  score: number;
}

/**
 * HOW MUCH OF HIS FRAME SHE TAKES UP, 0..1, the binding half of 姿态 (S-5).
 *
 * The design was settled before the instrument shipped: **不接 becomes material ABSENCE**, never a
 * prompt adjective. So this returns a number that scales the one term by which his words reach
 * into her memory (the mention bonus in `whatSurfacesInReply`) and touches nothing else. There is
 * no branch anywhere that tells her to be distant; declining a frame simply means his sentence
 * pulls less of her into the room, which is what declining a frame IS between people.
 *
 * SAMPLED, from her stream, because a ranking is not a posture: the leanings can sit at 1.21 and
 * 1.19 and a person is not thereby decided. The unmarked case (接) returns 1, which is exactly
 * what every caller had before this existed.
 *
 * 回投 sits with 接 rather than with 不接: throwing back what she carries is engagement, not
 * withdrawal, she is answering with her own thing instead of his, and her own thing is already
 * favoured by the tension term next door.
 */
export const TAKES_UP_HIS_FRAME: Record<Stance, number> = { 接: 1, 回投: 0.85, 不接: 0.35 };

export function takesUpHisFrame(leanings: readonly StanceLeaning[], stream: { next: () => number }): {
  stance: Stance; scale: number;
} {
  const picked = softPick(
    leanings.map((l) => ({ item: l.stance, score: l.score })),
    { temperature: STANCE_TEMPERATURE, count: 1, random: () => stream.next() },
  );
  const stance: Stance = picked.chosen[0] ?? "接";
  return { stance, scale: TAKES_UP_HIS_FRAME[stance] };
}

/**
 * Warm enough that a close second really does happen, cool enough that the leader usually leads.
 * Matched to `SURFACING_TEMPERATURE`, which is the same kind of decision one layer over.
 */
export const STANCE_TEMPERATURE = 0.45;

export function stanceLeanings(s: StanceState): StanceLeaning[] {
  const willing = 1 - clamp01(s.reluctance);
  const open = clamp01(s.openness);
  const tension = clamp01(s.unresolvedTension);
  const leanings: StanceLeaning[] = [
    // Taking it up is the resting posture of talking to someone at all; willingness colours
    // it rather than creating it.
    { stance: "接", score: 0.7 + 0.5 * willing },
    // Declining the frame grows out of not wanting to and him not looking reachable, the
    // same two quantities that already gate her own expression.
    { stance: "不接", score: 1.1 * (1 - willing) + 0.25 * (1 - open) },
    // Throwing back what she carries needs both the carrying and an open enough moment to
    // spend it on: pressing a hot thing into a closed door is not a stance, it is a waste.
    { stance: "回投", score: 0.9 * tension * (0.4 + 0.6 * open) },
  ];
  return leanings.sort((a, b) => b.score - a.score);
}
