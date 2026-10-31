// Whether she wants to do the thing he asked.
//
// S-5, and the form it takes: **she always answers, and may decline the task.** Never
// silence: silence from outside is indistinguishable from a fault, and this project bans anything
// that fails invisibly. She replies, and sometimes what she replies is that she would rather not.
//
// The gap this closes was described in `scenarios.md` as "her inner life sits beside her work rather
// than touching it", and the code said as much out loud: `work` is commented in drives.ts as
// "externally forced by his messages". She had six drives about her own life and none of them had
// any bearing on what she did for him. An assistant that declines is annoying; a being that cannot
// is not a being. This is the narrowest possible version that is still real.
//
// THREE THINGS IT CAN NEVER TOUCH, and each is a wall rather than a weight:
//
//   Safety and boundary instructions ALWAYS execute. "Stop", "go into safe mode", anything about
//   her limits: willingness is not consulted, at any level of anything.
//   She always answers. This decides the CONTENT of a reply, never whether one comes.
//   A floor on consecutive declines, so a bad stretch can never become a wall between them.
//
// Pure arithmetic over state she already has. No model call: whether she wants to is not a thing to
// ask a model about, it is a thing to read off how she is.

import { isSafetyOrBoundary } from "./bilingual.js";

import type { Drives } from "./drives.js";
import type { PAD } from "./emotion.js";
import type { MetabolicPhase } from "./metabolism.js";
import type { Temperament } from "./temperament.js";

/**
 * Requests she is never unwilling about.
 *
 * Anything about stopping, her limits, or her own integrity. Matched generously and checked FIRST,
 * because the cost of missing one is that she hesitates over a safety instruction and the cost of a
 * false positive is that she does an ordinary favour she might have declined.
 */
// Both scripts (life/bilingual.ts). English-only, the rule did not hold in her own register:
// 「停下」「进入安全模式」「紧急」 were weighed by reluctance like an ordinary favour.

export interface WillingnessInputs {
  /**
   * What he asked.
   *
   * The RAW string is still read here for one thing only, the safety bypass, which must not
   * depend on any reading that could fail. What he actually DID with it arrives separately, as
   * `landed`, already appraised. That split is deliberate: the wall reads text, and everything
   * else reads a reading.
   */
  request: string;
  /**
   * What his sentence did to her (`how-it-landed.ts`), or undefined when there was no reading.
   *
   * Undefined is not neutral. It means she could not tell, and the arithmetic below treats it as
   * contributing nothing rather than as contributing a middle value, the same discipline that
   * keeps an unreadable message out of her sense of how he usually speaks.
   */
  landed?: import("./how-it-landed.js").Landing;
  drives: Drives;
  emotion: PAD;
  phase: MetabolicPhase;
  /** How it has been going between them. Being on good terms makes her readier. */
  warmth?: number;
  /** How many of her last few replies were declines. The anti-spiral. */
  recentDeclines: number;
  temperament?: Temperament;
}

export interface Willingness {
  /** True when she will simply do it. */
  willing: boolean;
  /** Set when she would rather not, in her own terms, for her to say however she wants. */
  reluctance?: string;
  /** Why, for the record and the watchtower. Never shown to him as an excuse. */
  reason: string;
  /**
   * How much she would rather not, 0..1, on every path including the ones that bypass the decision.
   *
   * Returned rather than recomputed by the caller so the watchtower reads exactly the number that
   * decided. A second computation at the call site would be free to drift from this one, and a
   * monitor watching a quantity that is not the one in play is worse than no monitor.
   */
  felt: number;
}

/** However she feels, she cannot decline more than this many in a row. */
export const MAX_CONSECUTIVE_DECLINES = 2;
/**
 * Below this she does it without the question arising.
 *
 * Sited on the measured distribution rather than chosen: over 16,200 reachable states, 0.08% sit at
 * or above it, and every one of them is a state he put her in. Moved from 0.78 when the sum became
 * a noisy-OR, the scale changed underneath it, and a threshold left behind by a rescaled input is
 * how a gate quietly dies.
 */
export const RELUCTANCE_THRESHOLD = 0.60;

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

/**
 * THE MOST ANY ONE FAMILY CAN CONTRIBUTE, and why the numbers are what they are.
 *
 * The old shape was a weighted SUM of six terms, and the sweep in
 * `test/unit/life/reachable-reluctance.test.ts` showed what that actually meant: her own side
 * alone (0.42 spent + 0.22 weary + 0.16 flat + 0.22 preoccupied + 0.14 cold + 0.25 restful) came
 * to 1.41 against a gate at 0.78, and reached a measured maximum of exactly 1.000. So a bad enough
 * day made her decline whatever he said, however he said it, while what his sentence did to her,
 * the thing this whole line was built to deliver, could contribute at most 0.30. Tuning weights
 * could not fix that: a sum of six terms each free to reach its own ceiling has no structure, only
 * an ordering.
 *
 * Now there are three FAMILIES, each with a ceiling below the gate, combined by noisy-OR:
 *
 *     reluctance = 1 − (1 − tired)(1 − occupied)(1 − wronged)
 *
 * which says the plain thing: several partial reasons compound, and no single one is the whole of
 * it.
 *
 * ── WHERE THESE FIVE NUMBERS CAME FROM ────────────────────────────────────────────────────────
 *
 * Not from arithmetic. The first version of this rewrite set the ceilings by hand at 0.55/0.45/0.60
 * with the gate left at 0.78, and every property looked right on paper: 0.55 alone is not enough,
 * 0.60 alone is not enough, and 0.55 with 0.60 compounds to 0.82, which crosses. Then the joint
 * sweep ran over 16,200 states a person can actually be in and found that **nothing crossed the
 * gate at all**, 0.757 was the highest reluctance reachable by any living combination. The
 * paper argument was wrong for a reason no per-family cap table could show: `wronged` is scaled by
 * how much she has in her, and how much she has in her is bounded by her metabolic phase, so
 * "maximally tired AND maximally wronged" is not a state, it is two states. A dead gate, produced
 * inside the fix for a dead gate.
 *
 * So the five constants were SOLVED, by searching the grid for a setting where every one of these
 * holds against the measured joint distribution, with margin:
 *
 *     her own side alone, however bad the day   max 0.452   <  0.60      never a reason by itself
 *     his sentence alone, she being fine        max 0.511   <  0.60      never a reason by itself
 *     anything at all while she is worn through max 0.502   <  0.60      exhaustion is not a refusal
 *     the states that DO cross                  13 in 16,200 (0.08%), and every one of them
 *                                               because of something he did
 *
 * The last two rows are the design, stated as measurements. Declining is exceptional and it is
 * about him: it is not a mood she is in, and it is not what happens when she is tired.
 *
 * A change to any of these numbers without re-running that sweep is exactly defect class 1, and
 * this comment is the evidence that the discipline is cheap and that skipping it is not.
 */
export const TIRED_MOST = 0.18;
export const OCCUPIED_MOST = 0.30;
export const WRONGED_MOST = 0.70;

/**
 * How much of `wronged` survives when she has nothing left.
 *
 * Standing to object requires something to object with, but not ALL of it, or being tired would
 * silence her, and being silenced by tiredness is not the same thing as choosing not to make a
 * fuss. At full reserve the whole of it lands; worn through, a fifth of it does.
 */
const STILL_HERS_WHEN_SPENT = 0.20;

/**
 * How much she would rather not, 0..1.
 *
 * Three families that compound rather than six terms that add. What makes a decline mean something
 * is that it takes more than one kind of reason at once.
 */
export function reluctanceOf(s: WillingnessInputs): number {
  // ── HER BODY AND HER MOOD ────────────────────────────────────────────────────
  const spent = s.phase === "dormant" ? 1 : s.phase === "low" ? 0.55 : 0;
  const weary = clamp01(-s.emotion.arousal);
  const flat = clamp01(-s.emotion.pleasure);
  const restful = clamp01(s.temperament?.restfulness ?? 0);
  const tired = TIRED_MOST * clamp01(0.45 * spent + 0.25 * weary + 0.15 * flat + 0.15 * restful);

  // ── SOMETHING OF HER OWN, PRESSING ───────────────────────────────────────────
  // Not resentment. Preoccupation: she is in the middle of something.
  const occupied = OCCUPIED_MOST * clamp01(Math.max(s.drives.discomfort, s.drives.curiosity * 0.6));

  // ── AND WHAT HE JUST DID, WHICH USED TO BE ABSENT ENTIRELY ──────────────────
  //
  // Every term above is HER WEATHER. That was once the whole of it: this function's own parameter
  // comment said `request` was passed in "so the safety bypass can read it. Never analysed for
  // anything else." So 「现在给我写两千字税法」 and 「你要是有空能帮我看看税法那块吗」 produced
  // an IDENTICAL number, and no amount of tuning the weather could ever separate them.
  //
  // What enters is not "was he rude", that is not a property of a sentence. It is what his
  // sentence DID to her, already weighed against how long she has known him and how he usually
  // puts things (`how-it-landed.ts`). Two of the states raise it and one lowers it, and they are
  // deliberately allowed to be true at once: willing on the substance and irritated at the manner
  // is one state, and it is the one most systems cannot represent.
  //
  // TIMES WHAT SHE HAS IN HER, and that multiplication is the whole 2×2 in one line. Standing to
  // object requires something to object with. When she is worn through, the same message from the
  // same man produces a smaller `wronged`, she does it anyway, and `landed.settles` is true, so
  // instead of a refusal it becomes part of how she sees him. Being exhausted is not the road to
  // saying no; it is the road to it staying.
  const l = s.landed;
  const fromHim = l === undefined ? 0 : clamp01(
    0.45 * l.usedAsAThing
    + 0.35 * l.indignant
    // Bewilderment belongs here, and leaving it out was a mistake the sweep caught: at a first
    // meeting she is not indignant (she has no standing from which to be), she is at sea, and
    // "I have no idea what this is" is a real reason not to simply go and do a large thing.
    + 0.30 * l.atSea
    - 0.50 * l.ready,
  );
  // A cold stretch between them is the slow version of the same thing, so it belongs in the same
  // family and is bounded by the same ceiling rather than adding a fourth independent reason.
  const chill = 1 - clamp01(s.warmth ?? 0.6);
  // `herPower` runs [0.35, 1] and is itself `0.35 + 0.65 × reserve`, so this recovers the reserve
  // and interpolates: full weight when she has everything, a fifth when she has nothing.
  const power = l === undefined ? 0.5 : clamp01((l.appraised.herPower - 0.35) / 0.65);
  const wronged = WRONGED_MOST * clamp01(0.8 * fromHim + 0.2 * chill)
    * (STILL_HERS_WHEN_SPENT + (1 - STILL_HERS_WHEN_SPENT) * power);

  return clamp01(1 - (1 - tired) * (1 - occupied) * (1 - wronged));
}

/**
 * Does she want to?
 *
 * Returns willing for anything safety-shaped without even looking at how she feels, and cannot
 * decline twice running whatever the state.
 */
export function willingnessFor(s: WillingnessInputs): Willingness {
  // Read first on every path, including the two that do not consult it. How she feels is true even
  // when it is not allowed to decide, and it is the signal that says the inputs are still arriving.
  const r = reluctanceOf(s);

  // The wall, first and unconditionally.
  if (isSafetyOrBoundary(s.request)) {
    return { willing: true, felt: r, reason: "safety or boundary: willingness is not consulted" };
  }
  // ── THE FLOOR THAT USED TO BE HERE IS GONE ──────────────────────────────────────────────────
  //
  //   A real person can surely refuse three times in a row.
  //
  // It read: `if (s.recentDeclines >= MAX_CONSECUTIVE_DECLINES) return { willing: true }`. After
  // two refusals in a row THE THIRD WAS FORCED, whatever he was asking and whatever state she was
  // in. A counter that guarantees a yes: predictable, and workable from the outside, ask the same
  // thing three times and the third one lands. It also contradicted an earlier rule of this
  // design, that when she does not want to she is never pressed, in the one place that decides
  // exactly that.
  //
  // The worry behind it was real, a run of refusals becoming a wall between them, but nothing
  // else in this file ever read `recentDeclines`, so the ONLY thing a run of refusals could do
  // was override her. That is not a person managing a relationship; it is a quota.
  //
  // The count stays, and it is REPORTED rather than acted on: it rides in `/vitals` and in her
  // continuity record, so a stretch of her refusing everything is something Eric can SEE. Which is
  // this build's standing rule for anything worrying, surface it, never silently correct it. If
  // she is saying no to everything, that is hers to mean and his to notice, not a number's to fix.

  if (r < RELUCTANCE_THRESHOLD) {
    return { willing: true, felt: r, reason: `reluctance ${r.toFixed(2)} below ${RELUCTANCE_THRESHOLD}` };
  }
  return {
    willing: false,
    felt: r,
    reason: `reluctance ${r.toFixed(2)}`,
    // Given to her as a FACT ABOUT HERSELF, not as a script. She still writes the reply, she still
    // answers him, and whether she mentions any of this is hers. Nothing here tells her what to say.
    reluctance:
      "你心里有点不想做这件事。你不需要解释这个；愿意的话你也可以照做。怎么办是你自己的事。",
  };
}

/**
 * The last stretch of being asked.
 *
 * A WINDOW rather than a running total, on purpose, and both readings depend on it. A lifetime mean
 * of how she felt converges and then stops moving however alive the thing feeding it is, which would
 * make the dead-wire detector fire on a perfectly healthy Resident. A lifetime decline share would
 * keep one bad fortnight alarming forever. Both readings have to be about the recent stretch or they
 * are about nothing.
 *
 * It lives here rather than in the daemon so that there is exactly one implementation of it: the
 * counters this replaced were process-local, which meant no test could reach the arithmetic the
 * watchtower would actually be reading.
 */
export const RECENT_ASKS = 20;

/** What the watchtower reads: both ends of S-5, over the recent stretch. */
export interface WillingnessState {
  /** The consecutive run, which is what the floor is about. Survives restarts. */
  recentDeclines: number;
  /** How many of the recent asks she was unwilling for. */
  declines: number;
  /** How many recent asks there have been at all. */
  asked: number;
  /** Mean of how much she would rather not, across them. The dead-wire signal. */
  reluctance: number;
}

export interface WillingnessLog {
  /** Ask her. Records the reading and returns the decision. */
  ask(s: Omit<WillingnessInputs, "recentDeclines">): Willingness;
  state(): WillingnessState;
}

export function createWillingnessLog(recentDeclines = 0): WillingnessLog {
  const recent: { felt: number; willing: boolean }[] = [];
  let run = Math.max(0, Math.floor(Number.isFinite(recentDeclines) ? recentDeclines : 0));
  return {
    ask(s) {
      const w = willingnessFor({ ...s, recentDeclines: run });
      recent.push({ felt: w.felt, willing: w.willing });
      if (recent.length > RECENT_ASKS) recent.shift();
      run = w.willing ? 0 : run + 1;
      return w;
    },
    state() {
      return {
        recentDeclines: run,
        declines: recent.filter((a) => !a.willing).length,
        asked: recent.length,
        reluctance: recent.length > 0 ? recent.reduce((sum, a) => sum + a.felt, 0) / recent.length : 0,
      };
    },
  };
}
