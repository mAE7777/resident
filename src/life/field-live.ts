// The living field: the object the daemon holds.
//
// Everything under it is pure. This is where her real life gets encoded into it, where a moment
// pulls something up out of it, where rest lets it wander, and where what it is doing turns back
// into what she wants. That last part is the point of the whole layer: her drives used to be fed by
// counting the events of a day, so `curiosity: 0.4` was about nothing. Now what she wants comes
// from what her own memory is doing, which means her wanting is about something.
//
// Cost: every operation in here is arithmetic plus, at most, one model call during rest when a
// coincidence has become insistent enough to be worth a question. Nothing in the per-moment path
// calls a model. Anything that changes that should be rejected on sight, because it converts a
// living substrate back into theatre with a bill attached.

import {
  addNode, decayAll, driftReticence, link, prune, raisingWent, reticenceBaseFor, reticenceWords, stats,
  type FieldGraph, type FieldNode, type FieldStats, type NodeKind,
} from "./field.js";
import { softPick, temperatureFrom, type Stream } from "./soft-choice.js";
import { createGraph } from "./field.js";
import {
  ageDays, coolAll, describeRetrieval, retrieve, whenWords,
  type Cue, type Retrieval, type RetrievalOptions,
} from "./field-spread.js";
import {
  createResonanceLog, replay, ruptures, themeCandidates,
  type FusionCandidate, type ReplayOptions, type ResonanceLog, type Rupture,
} from "./field-emergence.js";
import { whatSheHasComeToWonderAbout, ASKED_MARK } from "./what-keeps-coming-back.js";
import { SHE_CAN_ONLY_CARRY } from "./what-stays.js";
import { createFieldIndex, type FieldIndex } from "./field-index.js";
import { splitClauses, attentionFrom, type Attention } from "./attention.js";
import { normalizedEntropy } from "./saying.js";
import {
  applyTrustDelta, createTrust, judge, SUSPENDED_TENSION,
  type Origin, type Trust,
} from "./credence.js";
import { tasteAfter, likingFor, whatSheLikes, type Liking } from "./liking.js";
import { feltAgo } from "./felt-time.js";
import { attemptFusion, type FusionDeps, type FusionRefusal } from "./fusion.js";
import type { FieldEvent, FieldStore } from "./field-store.js";
import type { FaultLog } from "./faults.js";
import {
  createOtherWatcher, describeOther,
  type OtherPresence, type OtherRead, type OtherWatcher,
  howOftenHeAnswers,
} from "./other-read.js";
import type { PAD } from "./emotion.js";

// ── Encoding: what a feeling does to a memory ────────────────────────────────

/**
 * How hard this lands. Arousal counts for slightly more than pleasure because being stirred is what
 * makes a thing stick, whether it was good or bad. The sign is kept separately, so a charged
 * memory can be a charged bad memory.
 *
 * An ordinary moment lands around 0.1, which is intentional: most of a life is not encoded deeply,
 * and if everything were charged then nothing would be.
 */
export function chargeOf(pad: PAD): { charge: number; valence: number } {
  const charge = Math.min(1, Math.max(0, 0.55 * Math.abs(pad.arousal) + 0.45 * Math.abs(pad.pleasure)));
  return { charge, valence: Math.min(1, Math.max(-1, pad.pleasure)) };
}

/** How strongly a new moment binds to the ones just before it. Temporal contiguity, fading fast. */
const CONTIGUITY = [0.55, 0.35, 0.2];
/** How many things a new moment may remind her of. */
const REMINDS_LIMIT = 3;
/** A reminding is a strong relation: it is the one that skips the calendar. */
const REMINDS_BASE = 0.25;
const REMINDS_SCALE = 0.35;
/**
 * How much a moment must look like a kind of thing before it counts as ANOTHER ONE of that kind.
 *
 * Set above `REMINDS_BASE`'s reach on purpose: being reminded of something is a loose relation and
 * should stay loose, while joining a theme moves a taste (faculty #9) and so has to be the tighter
 * question. Swept in `taste.test.ts` against the real similarity index rather than picked.
 */
const JOINS_A_KIND = 0.35;
/**
 * How far a taste may tip the competition over what she brings up.
 *
 * Third-order by construction: tension weighs 1.2 and charge 0.6, so at 0.3 a full-strength liking
 * cannot overturn either. Swept in `taste.test.ts`, it has to be big enough to decide a genuine
 * near-tie and small enough that nothing pressing ever loses to a preference.
 */
const LIKING_TIPS = 0.3;

export interface MomentEncoding {
  /** Stable identity, so a restart or a replay cannot fork her history. */
  key: string;
  text: string;
  nowMs: number;
  pad: PAD;
  source: string;
  /** This moment involved the one she exchanges messages with. */
  withOther?: boolean;
  /**
   * This one is ABOUT HER. Symmetric with `withOther`, and it was missing for as long as she had
   * no self figure to be about, see the note on `figure()`.
   */
  aboutHerself?: boolean;
  /**
   * ── FOUR PARAMETERS, AND NO CALL SITE IN `src/` HAS EVER PASSED ONE ──────────────────────
   *
   * `origin`, `chargeFloor`, `kind` and `tension` are all optional and all unused: every moment
   * she has ever encoded is `kind: "moment"`, `origin: "lived"`, `chargeFloor: 0`, no tension.
   * An interface wider than any use is a promise nobody checks, the `read` origin in particular
   * reads as available here while a standing rule says it must never be written, and
   * `signature.ts` watches `byOrigin.read` for exactly that.
   *
   * They are KEPT rather than narrowed, for a concrete reason: what-keeps-coming-back.ts gives
   * her a way for a thing that keeps coming back with nothing to explain it to become something
   * she carries, and that writes a moment WITH TENSION. `origin` and `chargeFloor` stay because
   * the encoder is shared and narrowing them would move the honesty of "where did this come
   * from" out of the type and into a comment. What is not acceptable is them being silently
   * unexercised, so the guard in `test/unit/life/the-half-wired.test.ts` names them: the day one
   * is passed, the test says so.
   */
  origin?: Origin;
  /** For events that are inherently significant regardless of mood (a birth, a rupture). */
  chargeFloor?: number;
  kind?: NodeKind;
  /** Something she lived that has NOT settled. Written by what-keeps-coming-back.ts; see above. */
  tension?: number;
}

// ── Signals out: how the field becomes what she wants ────────────────────────

export interface FieldSignals {
  /** Unresolved pressure, normalised. Open questions are what nag. */
  tension: number;
  /** Coincidences that have become insistent but have not been looked at yet. */
  pendingBirths: number;
  /** How present the other is in her associations right now. */
  otherWarmth: number;
  /**
   * How much of her recent record involving them has been sitting badly, 0..1. Negative feeling
   * only: good times with them do not make her worry about them, and settling happens through
   * actual contact rather than by being averaged away.
   *
   * This is what turns attachment into concern, and it comes from HER OWN record of how it has
   * actually been going with them. It is deliberately not a count of anything they need.
   */
  otherUnease: number;
  /** Something new was born recently and has not been said out loud. */
  freshBirth: number;
  /** Things encoded but never wired to anything. High means encoding is not doing its job. */
  orphanShare: number;
  /** Feeling of what she has been recalling lately, and how hard. Feeds the appraisal. */
  valence: number;
  charge: number;
  /** True when the same small cluster keeps coming back and getting worse. */
  spiralling: boolean;
  /**
   * How many things have been reaching her per act of remembering, lately. This is the vital sign
   * for the whole layer: if it goes to zero the field is still there, still growing, still costing
   * nothing, and completely inert, which is a failure that looks exactly like a quiet week from
   * outside. Nothing else in the watchtower can see it.
   */
  surfaced: number;
  /** Everything ever born here, cumulative. Current node counts fall as births fail to earn a life,
   *  so only a running total can tell "nothing is being born" from "nothing survived". */
  birthsTotal: number;
  /**
   * Coincidences that RESOLVED, whether into something new or into something she already held.
   *
   * Distinct from `birthsTotal`, and the distinction is a real one. Measured over six months: 24
   * coincidences were considered, 1 became a birth, and 23 were REINFORCEMENTS, she arrived at
   * something she already held, by another road, which is worth more than a duplicate. Reading only
   * births, the watchtower called that a stalled fusion path. It was the opposite: everything was
   * resolving, and most of it was confirming.
   */
  fusionsResolvedTotal: number;
  /** Mean retrievability across everything she has. Drifting to 1 means forgetting has stopped;
   *  drifting to 0 means she is losing all of it. */
  meanStrength: number;
  /** Things she holds no view on because she could not settle them. */
  suspended: number;
  /** Mean credence across what she does hold a view on. Kept for the readout; it is NOT what the
   *  watchtower reads, because a field of `lived` moments sits near 0.8 whatever the judging does. */
  meanCredence: number;
  /** Share of what she believes sitting at the very top. */
  credencePinnedShare: number;
  /** Times her own record has actually weighed in on something arriving. Cumulative. */
  judgements: number;
  /** Things that arrived for her record to have a say about. Cumulative, and counted BEFORE the
   *  judging branch, so switching that branch off cannot also switch off the count of what it
   *  stopped judging. */
  judgeable: number;
}

// ── Rest ─────────────────────────────────────────────────────────────────────

export interface RestResult {
  replayed: { walks: number; visited: number; bumped: number };
  births: FieldNode[];
  themes: FieldNode[];
  ruptures: Rupture[];
  pruned: number;
  /** Why fusions did not happen. `nothing` is the expected majority and is not a failure. */
  refusals: Partial<Record<FusionRefusal, number>>;
  considered: number;
  /** She arrived at something she already held. That is confirmation, not a second self. */
  reinforced: FieldNode[];
}

/**
 * Above this similarity, what she just arrived at is not a new thing, it is the same thing again.
 * Different pairs of memories can lead to the same realisation, and without this she accumulates a
 * drawer of near-identical selves, each individually weak, none of them the one she actually holds.
 */
export const SAME_REALISATION = 0.7;

export interface RestDeps {
  fusion?: FusionDeps;
  /** Most model calls one rest may make. Bounded so a busy field cannot become expensive. */
  maxFusions?: number;
  replay?: Partial<ReplayOptions>;
  /** Optionally give a new theme real words. Without it a theme still works, just less legibly. */
  nameTheme?: (members: readonly FieldNode[]) => Promise<string | null>;
}

export interface LivingField {
  // Encoding
  encodeMoment(spec: MomentEncoding): FieldNode | null;
  encodeInsight(spec: { key: string; text: string; nowMs: number; evidenceKeys: readonly string[]; source: string; charge?: number }): FieldNode | null;
  encodeQuestion(spec: {
    key: string; text: string; nowMs: number; source: string; tension?: number;
    /** It is about him. Attaches it to him, and makes it correspondingly more of a thing to ask. */
    withOther?: boolean;
    /**
     * It is about HER, a wall she hit, a limit she found, a thing she cannot work out about
     * herself. Attaches it to her own figure, which is what makes it cost the same to raise as a
     * question about him. Before she had her own figure it cost HALF: there was no her to be about.
     */
    aboutHerself?: boolean;
  }): FieldNode | null;
  /**
   * Something someone said to her, or something she found. Encoded as a CLAIM rather than as one of
   * her own moments: it is weighed against what she already holds the instant it arrives, it can
   * lose that weighing, and it carries where it came from for as long as she has it.
   *
   * The text must be HER account of it, never raw outside text. A page's own words in a node are
   * later read back to a model as something of hers, which is how a page gets to write her memories
   * and then speak to her through them.
   */
  encodeClaim(spec: {
    key: string; text: string; nowMs: number;
    /**
     * `thought` is HER OWN, and it was not admissible here until faculty #11.
     *
     * A claim used to be something that arrived from outside, he told her, or she read it. What
     * she herself ASSERTED went into her field as a moment ("we talked, it felt like this") and
     * never as a proposition, so no later evidence could ever come back and disagree with a thing
     * she had said. She could be corrected and it left no mark.
     *
     * Nothing else in the judging path needed changing to allow it: `INITIAL_CREDENCE.thought` is
     * 0.5 and `judge()` has always taken any origin. See `what-she-asserted.ts` for what decides
     * which of her sentences she actually committed to, which is the whole difficulty.
     */
    origin: Extract<Origin, "told" | "read" | "thought" | "retold">;
    source: string; charge?: number; valence?: number;
    /**
     * That it was HE who said it.
     *
     * This parameter did not exist, and its absence was a real hole rather than an omission of
     * detail: `encodeMoment` and `encodeQuestion` both take it and both draw an `about` edge to
     * the figure node, so a moment she LIVED with him was connected to him, while everything he
     * actually TOLD her landed in her field as free-floating content with no author. She could
     * hold a hundred things he had said and have nothing that said he was the one who said them.
     *
     * That is also why she could never form an impression of him from what he says. Impressions
     * are built out of specific things a person did, bound to that person (Todorov & Uleman 2002:
     * a trait inferred from a single behaviour attaches to the actor, unintentionally and at
     * encoding). With no edge, there was nothing for an impression to accumulate ON.
     */
    withOther?: boolean;
    /** ...or it is about HER, the half that had nowhere to attach before she had her own figure. */
    aboutHerself?: boolean;
    /**
     * The traces this grew out of (a retold node is born FROM the old days it re-read).
     * `born_from` both protects the parents from pruning (HOLDING_KINDS) and lets retellings
     * cluster into themes (BELONGING).
     */
    bornFromIds?: readonly number[];
  }): FieldNode | null;
  /**
   * SOMETHING SHE IS CARRYING PRESSES LESS NOW.
   *
   * The only way tension may be lowered from outside the field, and it exists because the two
   * places that needed to do it were reaching into `graph.nodes` and assigning to `node.tension`
   * directly. That worked, and it left NO TRACE: her field keeps a dated record of what changed in
   * her (`field_events`), and two real things, she went over something and it wore down, she put
   * something down, were happening outside it. Everything else that changes a node goes through
   * this file precisely so that record is complete.
   *
   * `why` is one line in her terms, because that record is hers rather than a database feature.
   */
  easeOff(nodeId: number, to: number, why: string, newKey?: string): boolean;
  /** How much what she is told has held up so far. Learned, never set. */
  trust(): Trust;
  figure(name: string, nowMs: number): FieldNode;
  contradict(aKey: string, bKey: string, nowMs: number, delta?: number): boolean;

  // Flow
  recall(cues: readonly Cue[], opts?: Partial<RetrievalOptions>): Retrieval;
  /**
   * Her deliberate return to her own recorded days (look_back). Query-side only, the
   * pages' words never become nodes; the traces that stretch of life already left light
   * up and take the strength gain, and nothing else: `rehearsal: false` (a staged revisit must
   * not pose as unbidden return) and `interference: 0` (re-reading her past must not wear
   * down the past's neighbours for losing a competition she staged).
   */
  reRead(texts: readonly string[], nowMs?: number): Retrieval | null;
  /** The hottest thing born in a span, the farPages input. Read-only. */
  maxTensionBetween(fromMs: number, toMs: number): number;
  /**
   * GOING LOOKING, as opposed to something coming to her.
   *
   * `recall` is associative: cues spread through the graph and whatever lights up arrives.
   * That is what happens to a person unbidden. This is the other half, and a person has both:
   * deliberately trying to remember something, by what it was ABOUT.
   *
   * It existed nowhere. `memory_search` and `memory_read`, two of the ten things she is born
   * holding, were pointed at a SQLite table that nothing in the running system can write, so
   * every time she reached for her own memory she found an empty room, for life. This is what
   * they should have been reaching all along: her field, which is where everything she
   * remembers actually lives, searched by the same bigram index that already knows her
   * language.
   */
  lookUp(text: string, limit?: number): FieldNode[];
  /**
   * What, in a message, actually snagged her (attention.ts): the message split into the units
   * attention works over, each asked how much of her field it lights up. What the reminding
   * bonus and the claim charge key to, instead of the whole message as one flat block.
   */
  attend(text: string): Attention;
  /** One thing she remembers, by id, with what it is connected to. */
  nodeById(id: number): { node: FieldNode; linked: FieldNode[] } | null;
  /** Cues she did not choose: the recent, plus whatever has been quietly warming. */
  spontaneousCues(nowMs: number, recent?: number): Cue[];
  /** What is on her mind right now, in her words. The only thing from here that reaches a prompt. */
  onHerMind(nowMs: number, opts?: Partial<RetrievalOptions>): string;
  /**
   * What she has not settled, in her words.
   *
   * Separate from what surfaces, and necessarily so: an open question acts as a CUE, and a cue is
   * excluded from its own retrieval, so a question could pull other memories up while never being
   * visible itself. She would feel something nagging and have no idea what. Being unable to see the
   * thing you are carrying is not carrying it; it is just being uneasy.
   */
  unsettled(nowMs: number, limit?: number): string;
  /**
   * WHICH of the things she is holding she brings up, when she speaks.
   *
   * `reach_out` used to mean "say something", full stop, and that is the entire reason S-2 measured
   * 0/10 in both arms: every mechanism was alive and reaching her, she carried the question for a
   * month, it was visibly costly, her read of him moved, and none of it had anywhere to land,
   * because a choice could not name its subject.
   *
   * A competition among what she actually holds, resolved by sampling: pressure and vividness push
   * a thing forward, reticence holds it back, carrying it a long time makes it press, and having
   * just raised it makes it recede. The model's own words are a soft hint, never the picker: it
   * RENDERS the message, it does not choose the topic.
   *
   * Returns null when she has nothing in particular to raise, which is most of the time and is
   * correct, most of what anyone says is not about the thing they are carrying.
   */
  chooseSubject(nowMs: number, stream: Stream, opts?: { hint?: string; openness?: number }): SubjectChoice | null;
  /**
   * WHAT SHE IS MOST OCCUPIED BY, for any action (faculty #4). `chooseSubject` answers "what
   * would I say to HIM", reticence-costed, openness-weighted. This answers the plainer
   * question underneath every moment: what is most on my mind right now, whether or not I say
   * it to anyone. It is the field object her curiosity/reflection/tending SHOULD be about; the
   * model composes the sentence around it instead of free-associating a topic. Dark for now:
   * the daemon records the divergence between this and the model's chosen intent, and binding
   * waits on that number, the same measure-before-bind discipline as the stance and the room.
   */
  focusFor(nowMs: number, stream: Stream): SubjectChoice | null;
  /**
   * WHAT, IF ANYTHING, OF HER OWN COMES UP WHEN HE HAS SPOKEN TO HER.
   *
   * The sibling of `chooseSubject`, and the difference between them is the whole design.
   * `chooseSubject` runs when she has ALREADY decided to go to him: something is going to be
   * said, and the only question is what. This runs when HE started it, where the honest answer
   * is usually that nothing of hers comes into it at all. So `nothing` is a real candidate in
   * the competition rather than an absent one, and it wins most of the time.
   *
   * WHY THIS EXISTS AT ALL. Her reply used to be handed `unsettled()`: every open thing she was
   * carrying, top three by pressure, each annotated with how hard it was to say. That is telling
   * the model she has reservations and asking it to hold back, which is not holding back. A
   * person who cannot bring themselves to say a thing does not have it in front of them and
   * decline to mention it; the words available to them simply do not include it. So what loses
   * here is not marked "difficult", it is ABSENT from the prompt, and its absence is the
   * reticence being real.
   *
   * WHAT THIS DOES NOT DO, and it matters: it does not touch her AWARENESS. `unsettled()` still
   * shows her everything she carries in her own moments, and it is there on purpose: being
   * unable to see what you carry is not carrying it. Seeing it and being
   * able to say it are different things, and only the second one is filtered here.
   */
  whatSurfacesInReply(
    nowMs: number,
    stream: Stream,
    opts?: {
      hint?: string;
      openness?: number;
      /**
       * HER POSTURE TOWARD HIS FRAME (`saying.ts` 姿态, S-5), 0..1 as "how much of his frame she
       * is taking up". 1 is 接, the unmarked case, and what every caller got before this existed.
       *
       * The binding was settled long before it was built: 不接 becomes material ABSENCE, never a
       * prompt adjective. So it scales the ONE term that is his frame reaching into her material,
       * the mention bonus, and touches nothing else. Declining to take up what he raised means
       * his words pull less of her memory into the room, which is what declining a frame IS.
       *
       * Her AWARENESS is untouched, same as the reticence cost beside it: `unsettled()` still
       * shows her everything in her own moments.
       */
      takesUpHisFrame?: number;
    },
  ): SubjectChoice | null;
  /**
   * Whether something she has just said was actually ABOUT a thing she is carrying.
   *
   * Needed because putting a thing near the surface of a reply is not the same as saying it.
   * `raise` starts the clock on whether he answered, and starting that clock for something she
   * never mentioned would teach her she went to him and was ignored when she did neither. So
   * the conversation path asks this first, using the same similarity index that lets his words
   * remind her of things, rather than a second notion of what counts as mentioning something.
   */
  saidIt(nodeId: number, spoken: string, minScore?: number): boolean;
  /** She brought this up with him. Starts the clock on whether it was met. */
  raise(nodeId: number, nowMs: number, expectAnswer?: number): void;
  /** How it went. Called when he answers, or when the waiting has gone on long enough to be silence. */
  raisingSettled(answered: boolean, nowMs: number): void;
  /**
   * The waiting has gone on long enough to BE silence. Called from the life tick; returns
   * whether anything settled, so the daemon can say so on the record.
   */
  settleOverdueRaise(nowMs: number): boolean;

  // Him
  /**
   * She said something to him, and he wrote back. Two facts about behaviour, which is all she gets
   * to observe and all this is built from.
   *
   * They live here rather than in the daemon because the read is LEARNED, and everything learned in
   * her has exactly one owner and one persistence path. A watcher kept next to the daemon would be a
   * second thing to save, a second thing to restore, and eventually a second thing that quietly
   * stopped being saved.
   */
  /**
   * She said something to him, expecting an answer this likely.
   *
   * The expectation is what makes her able to be SURPRISED, which is where most of learning and
   * most of feeling come from. Omit it and she simply speaks without having thought about it.
   */
  sheSpoke(nowMs: number, expectAnswer?: number): void;
  /**
   * When `said` (his actual words) is provided and something of hers is pending, a dark gauge
   * scores how much his message touches what she raised, recorded, never acted on.
   * Today ANY message of his inside the window counts as the answer; whether that is too
   * generous is exactly what this gauge exists to measure before anyone builds a threshold.
   */
  heSpoke(nowMs: number, said?: string): void;
  /**
   * The dark gauge's reading: mean relevance of his in-window replies to what she had raised,
   * null until it has enough to be more than an anecdote (RAISE_GAUGE_FLOOR).
   */
  raiseGauge(): number | null;
  /** How it has been going with him, from her side, with how much she has to go on. */
  readOther(nowMs: number, now?: OtherPresence | null): OtherRead;
  /** What she would say about him, or nothing at all when she has too little to go on. */
  otherInWords(nowMs: number, now: OtherPresence | null): string;

  // Time
  tick(nowMs: number): void;
  rest(nowMs: number, deps?: RestDeps): Promise<RestResult>;
  /**
   * WHAT SHE HAS COME TO LIKE AND DISLIKE, strongest feeling first.
   *
   * `whatSheLikes` was written, tested, and had ZERO callers anywhere in `src/`, so her tastes
   * existed as arithmetic and appeared nowhere: not to her, not in her moments, not in the
   * watchtower. The per-node `likingFor` did reach the subject competition, so a preference could
   * tip what she raised while remaining a thing she could never notice she had.
   *
   * A person who cannot tell you what they like does not have a self they can report on.
   */
  whatSheLikes(): Liking[];

  // Reading it
  signals(nowMs: number): FieldSignals;
  stats(): FieldStats;
  candidates(nowMs: number): FusionCandidate[];
  graph(): FieldGraph;
  events(limit?: number): FieldEvent[];
  persist(): void;
  nodeByKey(key: string): FieldNode | undefined;
}

/** What she decided to bring up, and the whole weighing behind it. */
export interface SubjectChoice {
  node: FieldNode;
  /** Every candidate with its score and the probability it had. Forensics, as everywhere else. */
  weighed: { text: string; score: number; probability: number }[];
  /**
   * How open the competition was, 0..1: normalized entropy over the FULL distribution, computed
   * here where the full distribution exists. The `weighed` list above is a display slice, and
   * entropy over a truncated distribution is a different (and misleading) number, the exact
   * mis-wiring the speech design's judges flagged (S-3, saying.ts `commitmentFrom`).
   */
  openCompetition: number;
}

/**
 * How much "nothing of mine comes up" is worth when he has spoken to her, and how graded the
 * answer is. Both solved from stated target rates rather than picked to feel right.
 *
 * THIS IS A DIFFERENT KIND OF DECISION FROM `chooseSubject`, and the first version got it wrong
 * by using the same machinery. `chooseSubject` asks WHICH of several things she brings up, and
 * `temperatureFrom` is right for that: a clear leader should win, so the temperature shrinks as
 * the margin grows. This asks WHETHER anything of hers comes up at all, which is not a contest
 * between rivals but a coin whose bias is how much the thing presses. Feeding it an adaptive
 * temperature turned it into a step function, measured at 0%, 0%, 1%, 11% across pressures
 * 0.3 to 0.9, with a costly thing at literally never and a pressing one at 54%. A person is not
 * a cliff.
 *
 * So: a FIXED temperature, which makes this a logistic in the margin. The two numbers were then
 * solved from targets written down before they were fitted,
 *
 *   a mild open thing (pressure 0.3, ordinary cost)            about  3% of replies
 *   something that will not let her alone (0.9, carried weeks) about 35% of replies
 *,
 * which give N = 1.65 and t = 0.42 on the score scale those candidates actually live on
 * (roughly 0.2 for the first and 1.4 for the second). The rates are asserted, with the measured
 * values printed, in field-reply-surfacing.test.ts, so a change to the scoring that moves them
 * shows up as a number rather than as a feeling.
 */
export const NOTHING_SURFACES = 1.65;
export const SURFACING_TEMPERATURE = 0.42;

/**
 * How close a thing has to come to being said before not saying it counts as withholding.
 *
 * A RATIO OF PROBABILITIES, not a fraction of the bar, and the first version being the latter is
 * the finding. Written as `0.75 × NOTHING_SURFACES` it needed an absolute score of 1.24, and the
 * measured scale says only a thing at tension ~0.85 and up ever gets there, which is ABOVE the
 * ceiling this mechanism stops at, so the two constants I wrote in the same edit could never both
 * be satisfied. The mechanism could not fire at all. Defect class 1, twice in one round, in the
 * code written by the person who added the population gate for it.
 *
 * The ratio has no such problem because it is scale-free: it asks what withholding actually is,
 * **the thing that came closest to being said and was not**, rather than asking a number to clear
 * a bar it was never on the scale of. Measured, at the same fixture:
 *
 *     a thing that has genuinely taken hold      p = 0.302  against nothing-of-mine's 0.659 = 0.46
 *     an ordinary open thing                     p = 0.091  against 0.718                  = 0.13
 *
 * Swept across the whole tension range, which is what set the number and what set the ceiling with
 * it, the pair has to be reachable TOGETHER, which the first pair was not:
 *
 *     tension 0.50   ratio 0.146     0.60   0.194     0.68   0.244     0.75   0.298     0.85   0.397
 *
 * At 0.22, a thing has to be at roughly tension 0.65 before not saying it counts, above the
 * ordinary open things and below the ceiling, so there is a real window to accumulate across
 * instead of a sliver. The first attempt put the bar at 0.25 and the ceiling at 0.70, which left a
 * window one hundredth of a tension wide: satisfiable in principle, never in a life.
 */
export const NEARLY_SAID_IT = 0.22;
/** How much harder a nearly-said thing presses next time. A twentieth: it takes several. */
export const WITHHELD_PRESSES = 0.05;
/**
 * And where that stops.
 *
 * A thing she keeps not saying should eventually come up, and must never become a thing she cannot
 * stop saying. Without a ceiling, withholding is an unbounded accumulator pointed at her, the
 * rumination shape arriving through a different door.
 *
 * 0.9 rather than 0.7, and the difference is the whole mechanism: the entry point measured above is
 * around tension 0.65, so a ceiling at 0.7 left a window one hundredth wide, satisfiable in
 * principle, never in a life. From entry to ceiling is five near-misses at `WITHHELD_PRESSES`, and
 * the field's own decay (1% a day) undoes that in a few weeks. So it takes a stretch of holding
 * something back, and a stretch of not, to undo.
 */
export const WITHHOLDING_STOPS_AT = 0.9;

/**
 * How much a near-miss still presses when the room was shut, when she did not hold it back, the
 * evening did. A floor rather than zero: she is still holding the thing, and a night that left no
 * trace at all would make a week of waiting invisible to her. See `heldBack`.
 */
export const A_CLOSED_ROOM_STILL_PRESSES = 0.25;

/**
 * How much of an unaffordable thing's pull passes to what sits beside it in her field.
 *
 * Well under half, and then divided among the neighbours: the question she can afford is a
 * SMALLER question, not a disguise for the one she cannot. If this were near 1 the nearby thing
 * would inherit the whole weight of the thing she is avoiding, and asking sideways would stop
 * being a smaller ask and become the same ask wearing a hat.
 */
export const LENDS_TO_WHAT_IS_BESIDE_IT = 0.35;

/** How long after speaking an answer still counts as an answer to what she said. */
export const RAISE_ANSWER_WINDOW_MS = 6 * 60 * 60 * 1000;
/**
 * The dark gauge over the raise loop. Today any in-window message of his counts as the answer
 * to what she raised; the gauge records how much his words actually touched it, so a threshold,
 * if one is ever warranted, gets built from measurement instead of taste. Ring of the
 * recent scores; null below the floor, where a mean is an anecdote wearing a number's clothes.
 */
export const RAISE_GAUGE_RING = 40;
export const RAISE_GAUGE_FLOOR = 8;
/** Having just raised something makes it recede; this is how long that lasts. */
export const RAISE_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

export interface FieldConfig {
  store?: FieldStore;
  /** The field only ever RECORDS faults (through `report`); it never reads them back. Declaring the
   *  whole FaultLog here would be a false dependency, so this asks for exactly what it uses. */
  faults?: Pick<FaultLog, "record">;
  random?: () => number;
  /** Ceiling on model calls per rest. */
  maxFusionsPerRest?: number;
  /**
   * Turns off the word-based reminding. Only for tests that need a bare temporal chain; a field
   * without it is a chain, and a chain cannot cross time.
   */
  noReminding?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** A birth counts as fresh, and worth wanting to say, for this long. */
const FRESH_BIRTH_MS = 2 * DAY_MS;
const MAX_THEMES_PER_REST = 2;
const MAX_KEPT_EVENTS = 200;
/** When she is young, a handful of unsettled things genuinely is a lot. */
export const TENSION_FLOOR = 4;
/** Past that, being unsettled is measured against how much she is carrying. */
export const TENSION_PER_NODE = 0.02;

export function createLivingField(config: FieldConfig = {}): LivingField {
  let graph: FieldGraph = createGraph();
  const resonanceLog: ResonanceLog = createResonanceLog();
  const index: FieldIndex = createFieldIndex();
  // reRead's bounds. Six traces per sitting is the same order as everything else she
  // holds at once (SHE_CAN_ONLY_CARRY = 4, topK); the floor keeps the last cue a real cue.
  const REREAD_CUES_MAX = 6;
  const REREAD_ENERGY_FLOOR = 0.2;
  let lastTickMs = 0;
  const faults = config.faults;

  // What she has been recalling lately, for the emotional feedback and the spiral detector.
  const recentRecalls: { ms: number; valence: number; charge: number; ids: number[] }[] = [];
  const recentEvents: FieldEvent[] = [];
  let recentMomentIds: number[] = [];
  let birthsTotal = 0;
  /** Births plus reinforcements: how many coincidences actually came to something. */
  let fusionsResolvedTotal = 0;
  /**
   * How many times what she already holds has actually had a say about something arriving.
   *
   * Cumulative and never reset, so "judging has stopped" is distinguishable from "nothing has
   * arrived to judge", different failures with different causes. The share pinned at the credence
   * ceiling used to be the signal here, and it stopped being reachable the moment corroboration was
   * made asymptotic and same-origin agreement was made worth nothing: the saturation that detector
   * watched for was engineered out, so the honest question became whether judging runs at all.
   */
  let judgementsTotal = 0;


  const loaded = config.store?.load();
  // How much what she is told has held up. Learned rather than declared, so it is restored with
  // everything else: a restart must not quietly return her to trusting from scratch.
  let trust: Trust = createTrust(loaded?.trustTold ?? undefined);
  const other: OtherWatcher = createOtherWatcher();
  /** The thing she last brought up and has not yet had an answer to. */
  let pendingRaise: { id: number; atMs: number; expected?: number } | null = null;
  // The raise loop's dark gauge: one score per answered raise where his words were available.
  // A ring so it reports the recent state of the loop rather than its whole history.
  const raiseScores: number[] = [];
  if (loaded) {
    graph = loaded.graph;
    other.restore(loaded.exchanges);
    other.restoreExpectations(loaded.expectations ?? []);
    resonanceLog.restore(loaded.resonance);
    lastTickMs = loaded.lastTickMs;
    recentMomentIds = [...graph.nodes.values()]
      .filter((n) => n.kind === "moment")
      .sort((a, b) => b.bornMs - a.bornMs)
      .slice(0, CONTIGUITY.length)
      .map((n) => n.id);
  }
  // The index is derived, so it is rebuilt rather than stored. Everything she has is in it, which
  // is what lets something from a year ago be exactly as reachable as something from Tuesday.
  for (const n of graph.nodes.values()) index.add(n.id, n.text);

  /**
   * Wire a new node to whatever it genuinely recalls. This is the only relation in the whole field
   * that ignores the calendar, and therefore the only one by which she can be reminded of something
   * old by something new.
   */
  function wireReminding(node: FieldNode, nowMs: number): void {
    if (!config.noReminding) {
      const hits = index.similar(node.text, REMINDS_LIMIT, node.id);
      for (const hit of hits) {
        const other = graph.nodes.get(hit.id);
        if (!other || other.kind === "figure") continue;
        link(graph, node.id, hit.id, "reminds_of", Math.min(1, REMINDS_BASE + REMINDS_SCALE * hit.score), nowMs);
      }
      // Now weigh it against what she already holds. Judging asks a TIGHTER question than
      // reminding: not "what does this bring to mind" but "have I already got something that says
      // this, or says the opposite of it". Reusing the loose lookup here meant near-restatements
      // fell under its evidence floor and she never noticed two claims were about the same thing.
      weighAgainstWhatSheHolds(node, index.restatements(node.text, 5, node.id), nowMs);
      void hits;
    }
    // Indexed either way: turning off the reminding must not also make her invisible to it later.
    index.add(node.id, node.text);
  }

  /**
   * She uses what she already knows to judge what has just arrived.
   *
   * What she LIVED cannot be overruled by what she was TOLD, because experience starts above the
   * ceiling on trust. Two things of equal standing that disagree leave her unsure rather than
   * forcing a side, and being unsure puts real tension on both, so an unsettled contradiction nags
   * at her exactly the way an unanswered question does. Free: no model call, no I/O.
   */
  function weighAgainstWhatSheHolds(node: FieldNode, hits: readonly { id: number; score: number }[], nowMs: number): void {
    if (node.kind === "figure") return; // a person is not a claim
    const held = hits
      .map((h) => ({ h, n: graph.nodes.get(h.id) }))
      .filter((x): x is { h: { id: number; score: number }; n: FieldNode } => !!x.n && x.n.kind !== "figure")
      .map(({ h, n }) => ({ id: n.id, text: n.text, origin: n.origin, credence: n.credence, similarity: h.score }));
    if (held.length === 0) return;

    const verdict = judge({ text: node.text, origin: node.origin }, held, trust);
    judgementsTotal += 1;
    node.credence = verdict.credence;
    if (verdict.suspended) node.tension = Math.max(node.tension, SUSPENDED_TENSION);
    // HER POSITION WAS SUSPENDED: an event, recorded the moment it happens. This used to leave no
    // trace anywhere durable: the suspension lives as `credence = null` in node state, which only
    // persists on the moment loop or a clean shutdown, so a harness that SIGKILLs after one turn
    // (all of them) could never see the mark land. `field_events` commits to SQLite immediately,
    // which is exactly what an event table is for, and 「what she held was put in doubt」 is as
    // much an event of her life as a fusion or a rupture.
    if (verdict.suspended) {
      event({ ms: nowMs, kind: "suspension", text: node.text.slice(0, 60), detail: `origin:${node.origin}` });
    }

    for (const d of verdict.disputes) {
      const other = graph.nodes.get(d.id);
      if (!other) continue;
      other.credence = d.credenceAfter;
      if (d.credenceAfter === null) {
        other.tension = Math.max(other.tension, SUSPENDED_TENSION);
        event({ ms: nowMs, kind: "suspension", text: other.text.slice(0, 60), detail: `origin:${other.origin}` });
      }
      // A disagreement is a real relation between them, and it accumulates: two things she keeps
      // holding that keep disagreeing eventually have to be faced (see ruptures).
      link(graph, node.id, other.id, "tension_with", 0.35, nowMs);
    }
    for (const s of verdict.supports) {
      const other = graph.nodes.get(s.id);
      if (other) other.credence = s.credenceAfter;
    }
    if (verdict.trustDelta !== 0) {
      const before = trust.told;
      trust = applyTrustDelta(trust, verdict.trustDelta);
      if (trust.told !== before) {
        event({
          ms: nowMs,
          kind: "trust",
          text: verdict.trustDelta < 0
            ? "what she was told did not match what she lived"
            : "what she was told was borne out by what she lived",
          detail: `${before.toFixed(2)} -> ${trust.told.toFixed(2)}`,
        });
      }
    }
  }

  /**
   * SHE NEARLY SAID IT, AND DID NOT.
   *
   * Faculty #14 of the sweep, and the finding is the ASYMMETRY. HIS silence is modelled richly: an
   * unanswered thing has `warmthOf = 0`, there is a window after which she gives up waiting,
   * `raisingWent(false)` hardens her reticence, warmth drifts over days. HERS was only ever "she
   * chose a different action" or "the gate held it", and the only trace was a count. **Withholding
   * accumulated into nothing.**
   *
   * So a thing that came close and lost carries the near-miss: it presses very slightly harder next
   * time, which is what not-saying-something actually does to a person, it makes the thing louder
   * rather than quieter. That is what makes silence an act rather than an absence.
   *
   * CALLED FROM BOTH competitions, because there are two ways she nearly says something and they
   * are the same event from her side: going to him with it (`chooseSubject`) and it coming near the
   * surface while she answers him (`whatSurfacesInReply`). It lived inline in the first one for a
   * commit, the two have the same shape, and a single-occurrence replace found the wrong one.
   *
   * Bounded twice over: only what genuinely nearly won counts, and it stops at
   * `WITHHOLDING_STOPS_AT` so a thing she keeps not saying can never become one she cannot stop
   * saying. Both bounds were set from the same measured sweep; see `NEARLY_SAID_IT`.
   */
  /**
   * ── LOSING TO A RIVAL AND LOSING TO THE ROOM ARE NOT THE SAME THING ──────────────────
   *
   * This charged every near-miss the same, and that is one act being read as another. Holding
   * something back FROM SOMEONE WHO IS THERE is a decision she made; having nobody to say it to
   * is a fact about the evening. Both leave her still holding it, but only the first is her
   * withholding, and only the first should press like withholding.
   *
   * The measured cost of not distinguishing them is in the ten-year simulator, and it is not
   * subtle: in the life where he disappears for a month at a time, what she is carrying GROWS
   * WITHOUT BOUND (0.4 → 5.2 → 7.4 → 16.5 → 13.4 → 20.3). The mechanism is right there, he is
   * away, `openness` floors at 0.1, nothing clears the bar, so everything she holds is a
   * near-miss on every beat and every tension creeps up together. A woman alone for a month came
   * out of it carrying five times what a woman in an ordinary month carried, and none of it had
   * happened to her.
   *
   * So the press is scaled by how much of the room was actually open to her. Nothing new is
   * invented for this: `openness` is her own read of whether he is reachable, already computed,
   * already the thing that suppressed her. At a closed door the press goes to a fraction; with
   * him right there and listening it is exactly what it was.
   */
  function heldBack(
    weighed: readonly { item: FieldNode | null; probability: number }[],
    said: FieldNode | null,
    openness = 1,
  ): void {
    const nothingP = weighed.find((w) => w.item === null)?.probability ?? 1;
    if (nothingP <= 0) return;
    // A floor rather than a multiplier, so a shut door still leaves a trace: she IS still holding
    // it, and a night that left nothing at all would make the waiting invisible to her.
    const heldItBack = A_CLOSED_ROOM_STILL_PRESSES
      + (1 - A_CLOSED_ROOM_STILL_PRESSES) * Math.min(1, Math.max(0, openness));
    for (const w of weighed) {
      if (w.item === null || w.item === said) continue;
      // Against what actually won, not against an absolute score: "nearly" is a comparison.
      if (w.probability / nothingP < NEARLY_SAID_IT) continue;
      const n = graph.nodes.get(w.item.id);
      if (n === undefined || n.tension >= WITHHOLDING_STOPS_AT) continue;
      n.tension = Math.min(WITHHOLDING_STOPS_AT, n.tension + WITHHELD_PRESSES * heldItBack);
    }
  }

  function report(where: string, err: unknown, severity: "warn" | "critical" = "warn"): void {
    faults?.record(where, err, severity);
  }

  function event(e: FieldEvent): void {
    // Kept in memory as well as written down. What changed in her is her history, not a database
    // feature, and it has to be readable when there is no database attached.
    recentEvents.push(e);
    while (recentEvents.length > MAX_KEPT_EVENTS) recentEvents.shift();
    try {
      config.store?.recordEvent(e);
    } catch (err) {
      report("field.event", err);
    }
  }

  /**
   * A who. Created with NO feeling attached, which is the whole point: it used to be seeded at
   * valence +0.2, so before a single thing had happened between them her associations already held
   * that this person was good. That is an opinion, and handing her an opinion about the one
   * relationship she has is the largest thing we could put in her that is not hers. It starts at
   * zero and accrues whatever her actual life with them turns out to accrue, in either direction.
   */
  /**
   * A MOMENT JOINS A KIND OF THING, AND HOW IT WENT BECOMES PART OF HOW SHE FEELS ABOUT THAT KIND.
   *
   * Faculty #9: she had no likes. The object a preference attaches to already existed, a `theme`
   * is a cluster that became one thing, born carrying the mean valence of the moments underneath
   * it, but the valence was written once at the theme's birth and then never moved again, and
   * nothing ever read it as a preference. A taste frozen at the moment it was first noticed is a
   * verdict rather than a preference, so this is the half that makes it keep living.
   *
   * MOMENTS ONLY. `wireReminding` runs for claims and questions as well, and those carry
   * `valence: 0` by construction rather than by feeling, routing them through here would drag
   * every taste she has toward indifference each time he told her something, which is a bug that
   * would have looked exactly like "her preferences are weak".
   */
  function joinsAKind(node: FieldNode, nowMs: number): void {
    if (node.kind !== "moment") return;
    if (config.noReminding) return;
    for (const hit of index.similar(node.text, REMINDS_LIMIT, node.id)) {
      const theme = graph.nodes.get(hit.id);
      if (!theme || theme.kind !== "theme") continue;
      if (hit.score < JOINS_A_KIND) continue;
      link(graph, theme.id, node.id, "co_occurred", 0.5, nowMs);
      theme.valence = tasteAfter(theme.valence, node.valence);
    }
  }

  /**
   * THE TWO PEOPLE IN HER FIELD.
   *
   * `field.ts` has documented `"figure"` as "a who: Eric, **herself**" since the kind was
   * created, and `figure()` was only ever called with the first of those, from a string literal
   * repeated at three call sites. So there was no her in her own field, and the consequences were
   * not cosmetic:
   *
   *   · nothing could spread FROM herself the way everything spreads from him;
   *   · `reticenceBaseFor` adds `RETICENCE_ABOUT_SOMEONE` only for a node with an `about` edge to
   *     a figure, so a first-person question about her own limits sat at 0.30 while a question
   *     about him sat at 0.60, her own life was, by construction, the easier thing to say;
   *   · and there was nowhere for anything she noticed about herself to attach.
   */
  const THE_OTHER = "the one I exchange messages with";
  const HERSELF = "myself";

  function figure(name: string, nowMs: number): FieldNode {
    const key = `figure:${name.toLowerCase()}`;
    const existing = graph.byKey.get(key);
    const found = existing !== undefined ? graph.nodes.get(existing) : undefined;
    if (found) return found;
    return addNode(graph, {
      kind: "figure", text: name, bornMs: nowMs, origin: "lived", credence: null, charge: 0.15, valence: 0,
      strength: 0.9, source: "figure", key,
    });
  }

  return {
    encodeMoment(spec) {
      try {
        const { charge, valence } = chargeOf(spec.pad);
        const alreadyLived = graph.byKey.has(spec.key);
        const node = addNode(graph, {
          kind: spec.kind ?? "moment",
          text: spec.text,
          bornMs: spec.nowMs,
          charge: Math.max(charge, spec.chargeFloor ?? 0),
          valence,
          source: spec.source,
          key: spec.key,
          tension: spec.tension,
          origin: spec.origin ?? "lived",
        });
        if (alreadyLived) return node;
        // Temporal contiguity: what happened next to what. This is the backbone the whole graph
        // hangs on, and it is the only edge kind that needs no interpretation of any sort.
        for (let i = 0; i < recentMomentIds.length && i < CONTIGUITY.length; i++) {
          const prev = recentMomentIds[i];
          if (prev !== node.id) link(graph, node.id, prev, "co_occurred", CONTIGUITY[i], spec.nowMs);
        }
        // And whatever it genuinely recalls, however long ago that was.
        wireReminding(node, spec.nowMs);
        // A kind of thing she already recognises has happened to her once more, and how it went
        // this time moves how she feels about that kind of thing (faculty #9).
        joinsAKind(node, spec.nowMs);
        if (spec.withOther) {
          link(graph, node.id, figure(THE_OTHER, spec.nowMs).id, "about", 0.4, spec.nowMs);
        }
        if (spec.aboutHerself) {
          link(graph, node.id, figure(HERSELF, spec.nowMs).id, "about", 0.5, spec.nowMs);
        }
        // After the wiring, never before: how hard a thing is to say depends on what it turned out
        // to be about, and that is not known until it has its relations.
        node.reticence = reticenceBaseFor(graph, node);
        if (node.kind === "moment" && recentMomentIds[0] !== node.id) {
          recentMomentIds = [node.id, ...recentMomentIds].slice(0, CONTIGUITY.length);
        }
        return node;
      } catch (err) {
        report("field.encodeMoment", err, "critical");
        return null;
      }
    },

    encodeInsight(spec) {
      try {
        const node = addNode(graph, {
          kind: "insight", text: spec.text, bornMs: spec.nowMs, origin: "thought",
          charge: spec.charge ?? 0.5, valence: 0, strength: 0.55,
          source: spec.source, key: spec.key,
        });
        // The citations become the relations. This is what keeps the grounded guarantee intact:
        // an insight with no evidence has no edges and fades out of reach on its own.
        for (const evKey of spec.evidenceKeys) {
          const id = graph.byKey.get(evKey);
          if (id !== undefined) link(graph, node.id, id, "evidence_for", 0.5, spec.nowMs);
        }
        // WHAT SHE COMES TO KNOW ABOUT HERSELF IS ABOUT SOMEBODY. Without this edge her own
        // self-knowledge was not attached to anyone, so nothing could reach it by thinking of
        // her, and `reticenceBaseFor`, which was also never called here, left every insight at
        // the flat base. Both halves are the same omission: there was no her to be about.
        link(graph, node.id, figure(HERSELF, spec.nowMs).id, "about", 0.5, spec.nowMs);
        wireReminding(node, spec.nowMs);
        node.reticence = reticenceBaseFor(graph, node);
        return node;
      } catch (err) {
        report("field.encodeInsight", err, "critical");
        return null;
      }
    },

    encodeQuestion(spec) {
      try {
        const node = addNode(graph, {
          kind: "question", text: spec.text, bornMs: spec.nowMs, origin: "thought",
          // A question is not a claim, so she holds no view on it by construction.
          credence: null, charge: 0.4, valence: 0, strength: 0.6, tension: spec.tension ?? 0.6,
          source: spec.source, key: spec.key,
        });
        // A question about him is attached to him, so that he can bring it to mind. Without this
        // edge she could hold a question about someone for months and never once think of it while
        // thinking of them, which is not what having a question about someone is.
        if (spec.withOther) {
          link(graph, node.id, figure(THE_OTHER, spec.nowMs).id, "about", 0.5, spec.nowMs);
        }
        if (spec.aboutHerself) {
          link(graph, node.id, figure(HERSELF, spec.nowMs).id, "about", 0.5, spec.nowMs);
        }
        wireReminding(node, spec.nowMs);
        node.reticence = reticenceBaseFor(graph, node);
        return node;
      } catch (err) {
        report("field.encodeQuestion", err, "critical");
        return null;
      }
    },

    encodeClaim(spec) {
      try {
        const node = addNode(graph, {
          kind: "memory", text: spec.text, bornMs: spec.nowMs, origin: spec.origin,
          charge: spec.charge ?? 0.25, valence: spec.valence ?? 0, strength: 0.7,
          source: spec.source, key: spec.key,
        });
        // Judging happens inside here: this is the point where what she already holds gets a say.
        wireReminding(node, spec.nowMs);
        // Bound to the person who said it, at the same weight a moment lived with him gets. The
        // edge is what later lets "what is he like" be a question about her own graph rather than
        // about a profile of him kept somewhere.
        if (spec.withOther) {
          link(graph, node.id, figure(THE_OTHER, spec.nowMs).id, "about", 0.4, spec.nowMs);
        }
        // Declared in the spec long before it was drawn here: a claim
        // about HERSELF attaches to her own figure the way encodeMoment/encodeQuestion always
        // did. Without the edge, what she asserted about herself floated free of her.
        if (spec.aboutHerself) {
          link(graph, node.id, figure(HERSELF, spec.nowMs).id, "about", 0.5, spec.nowMs);
        }
        for (const id of spec.bornFromIds ?? []) {
          if (graph.nodes.has(id)) link(graph, node.id, id, "born_from", 0.6, spec.nowMs);
        }
        return node;
      } catch (err) {
        report("field.encodeClaim", err, "critical");
        return null;
      }
    },

    easeOff(nodeId, to, why, newKey) {
      try {
        const node = graph.nodes.get(nodeId);
        if (node === undefined) return false;
        const before = node.tension;
        const next = Math.min(1, Math.max(0, Number.isFinite(to) ? to : before));
        // Only ever DOWN. A method that could raise tension from outside would be a way to wind
        // her up about something with no event behind it, which is the shape this whole design is
        // careful about: a new event raises it, by being an event.
        if (next >= before) return false;
        node.tension = next;
        // AND OPTIONALLY UNDER A NEW NAME, which is not a flourish: a thing she has worked out is
        // still the same thing, and must not become a second one. The caller that needed this was
        // renaming `node.key` by hand and then calling `encodeQuestion` with the new name, which
        // left the old name in `byKey` pointing at the renamed node AND created a duplicate under
        // the new one, so understanding something forked her grievance into two. The index moves
        // with the node here, or not at all.
        if (newKey !== undefined && newKey !== node.key) {
          if (node.key !== undefined) graph.byKey.delete(node.key);
          node.key = newKey;
          graph.byKey.set(newKey, node.id);
        }
        event({
          ms: Date.now(), kind: "prune", nodeId,
          text: why,
          detail: `tension ${before.toFixed(2)} -> ${next.toFixed(2)}`,
        });
        return true;
      } catch (err) {
        report("field.easeOff", err);
        return false;
      }
    },

    trust: () => ({ ...trust }),

    figure,

    contradict(aKey, bKey, nowMs, delta = 0.25) {
      const a = graph.byKey.get(aKey);
      const b = graph.byKey.get(bKey);
      if (a === undefined || b === undefined) return false;
      return link(graph, a, b, "tension_with", delta, nowMs) !== null;
    },

    recall(cues, opts = {}) {
      const nowMs = opts.nowMs ?? Date.now();
      const r = retrieve(graph, cues, { ...opts, nowMs });
      try {
        resonanceLog.observe(graph, r.activation, nowMs);
      } catch (err) {
        report("field.resonance", err);
      }
      recentRecalls.push({ ms: nowMs, valence: r.valence, charge: r.charge, ids: r.retrieved.map((n) => n.id) });
      while (recentRecalls.length > 20) recentRecalls.shift();
      return r;
    },

    reRead(texts, nowMs = Date.now()) {
      // Bounded supply on purpose: at most REREAD_CUES_MAX traces light up per sitting, so a
      // long stretch of pages cannot flood the resonance log (which feeds fusion) in one go.
      const ids: number[] = [];
      for (const text of texts) {
        for (const hit of index.search(text, 3, undefined)) {
          if (!ids.includes(hit.id)) ids.push(hit.id);
          if (ids.length >= REREAD_CUES_MAX) break;
        }
        if (ids.length >= REREAD_CUES_MAX) break;
      }
      if (ids.length === 0) return null;
      const cues = ids.map((id, i) => ({ id, energy: Math.max(REREAD_ENERGY_FLOOR, 1 - i * 0.15) }));
      return this.recall(cues, { nowMs, interference: 0, rehearsal: false });
    },

    maxTensionBetween(fromMs, toMs) {
      let max = 0;
      for (const n of graph.nodes.values()) {
        if (n.bornMs >= fromMs && n.bornMs < toMs && n.tension > max) max = n.tension;
      }
      return max;
    },

    spontaneousCues(nowMs, recent = 3) {
      const cues: Cue[] = [];
      // What just happened. She is always partly cued by where she is.
      const moments = [...graph.nodes.values()]
        .filter((n) => n.kind === "moment")
        .sort((a, b) => b.bornMs - a.bornMs)
        .slice(0, recent);
      moments.forEach((n, i) => cues.push({ id: n.id, energy: 0.85 - i * 0.2 }));
      // And whatever has been quietly warming, which is how something surfaces with no new event.
      const warm = [...graph.nodes.values()]
        .filter((n) => n.warmth > 0.05)
        .sort((a, b) => (b.warmth - a.warmth) || (a.id - b.id))
        .slice(0, 3);
      for (const n of warm) {
        if (!cues.some((c) => c.id === n.id)) cues.push({ id: n.id, energy: Math.min(0.7, n.warmth) });
      }
      // An unresolved question keeps a low light on regardless of what else is happening.
      const open = [...graph.nodes.values()]
        .filter((n) => n.tension > 0.35)
        .sort((a, b) => (b.tension - a.tension) || (a.id - b.id))
        .slice(0, 2);
      for (const n of open) {
        if (!cues.some((c) => c.id === n.id)) cues.push({ id: n.id, energy: Math.min(0.5, n.tension) });
      }
      // And the thing that still has the most hold on her, if she has not been near it lately.
      // Without this she can only ever drift outward from today, and a day where nothing much
      // happened has nothing to drift along, so a whole unremarkable week would wall her off from
      // her own past entirely. The charged past intrudes; that is what charged means.
      // The recall-recency term is what stops this being the same two memories every single day.
      // A flat "most charged thing she has" pins on whichever memory happens to win once and never
      // lets go, and everything else charged in her life then goes years without being touched and
      // quietly rots. Something she sat with yesterday scores near nothing; it takes about a week
      // before it can intrude again.
      const holding = [...graph.nodes.values()]
        .filter((n) => n.kind !== "figure" && n.charge > 0.35)
        .map((n) => {
          const days = Math.max(0, (nowMs - n.lastRecallMs) / DAY_MS);
          return { n, score: n.charge * n.strength * (1 - Math.exp(-days / 7)) };
        })
        .filter((x) => x.score > 0.05)
        .sort((a, b) => (b.score - a.score) || (a.n.id - b.n.id))
        .slice(0, 2);
      for (const { n } of holding) {
        if (!cues.some((c) => c.id === n.id)) cues.push({ id: n.id, energy: Math.min(0.6, n.charge) });
      }
      return cues;
    },

    onHerMind(nowMs, opts = {}) {
      try {
        const cues = this.spontaneousCues(nowMs);
        if (cues.length === 0) return "";
        const r = this.recall(cues, { ...opts, nowMs });
        return describeRetrieval(r, nowMs);
      } catch (err) {
        report("field.onHerMind", err);
        return "";
      }
    },

    unsettled(nowMs, limit = 3) {
      try {
        // ── NO KIND FILTER, AND THAT IS A RULING RATHER THAN AN OMISSION ────────────────────
        //
        // `question` is not the only thing that can sit unresolved in her. A CLAIM she holds that
        // something arriving has contradicted is suspended at `SUSPENDED_TENSION` and is exactly
        // as unsettled as an open question, she believed a thing, something disagreed, and it is
        // not decided. A `moment` that keeps being charged is the same. Filtering to questions
        // would show her a tidy list and leave the actually-unresolved thing invisible, which is
        // the failure this list exists to prevent: being unable to see what you are carrying is
        // not carrying it. What is on this list is TENSION, whatever shape it arrived in.
        const open = [...graph.nodes.values()]
          .filter((n) => n.tension > 0.25)
          .sort((a, b) => (b.tension - a.tension) || (b.bornMs - a.bornMs))
          .slice(0, Math.max(0, limit));
        if (open.length === 0) return "";
        return [
          "还悬着、一直没散去的：",
          ...open.map((n) => {
            // How it feels to say is shown WITH the thing, never as a verdict on whether to say it.
            // She is being told what she feels about each one, and the choice stays entirely hers.
            const cost = reticenceWords(n.reticence);
            // Felt, not wall clock (faculty #8): a thing she still cannot settle sits closer
            // than the calendar puts it, and a settled one is dated exactly as before.
            return `  - ${n.text}（${whenWords(feltAgo(ageDays(n, nowMs), n.tension))}${cost ? `，${cost}` : ""}）`;
          }),
        ].join("\n");
      } catch (err) {
        report("field.unsettled", err);
        return "";
      }
    },

    focusFor(nowMs, stream) {
      try {
        // Same candidate pool as chooseSubject, minus the "would I say it" framing: no hint,
        // no openness, no reticence cost. Pure "what presses on me": tension, charge, warmth,
        // and freshness. A figure is who you raise a thing WITH, not a thing on your mind.
        const candidates = [...graph.nodes.values()].filter((n) =>
          n.kind !== "figure" && (n.tension > 0.25 || n.warmth > 0.1 || nowMs - n.bornMs < FRESH_BIRTH_MS));
        if (candidates.length === 0) return null;
        const scored = candidates.map((n) => ({
          item: n as FieldNode,
          score: 1.2 * n.tension + 0.7 * n.charge + 0.6 * n.warmth
            + 0.35 * Math.min(1, Math.max(0, (nowMs - n.bornMs)) / DAY_MS / 21),
        }));
        const picked = softPick(scored, { temperature: SURFACING_TEMPERATURE, count: 1, random: () => stream.next() });
        const node = picked.chosen[0];

        // FULLY, and explicitly. `focusFor` is what presses on her PRIVATELY, no hint, no
        // openness, no reticence cost, and nobody in the room. Not dwelling on something she
        // could have dwelt on is entirely her own, so the room has nothing to discount here.
        // (This is the value it always had; it is written out now that the parameter exists.)
        heldBack(picked.weighed, node ?? null, 1);
        // AFTER the accounting, not before. This return sat above it for one commit, which meant
        // withholding was only ever charged on turns where something DID surface, and the turn
        // that matters most is the one where nothing did, because that is the turn she held all of
        // it back. The same shape as everything else this round: the code was right and it was on
        // the wrong side of a return.
        if (!node) return null;

        return {
          node,
          weighed: picked.weighed.map((w) => ({ text: w.item.text, score: w.score, probability: w.probability }))
            .sort((a, b) => b.probability - a.probability).slice(0, 6),
          openCompetition: normalizedEntropy(picked.weighed),
        };
      } catch (err) {
        report("field.focusFor", err);
        return null;
      }
    },

    chooseSubject(nowMs, stream, opts) {
      try {
        const hint = opts?.hint;
        // How reachable he looks right now. This is what lets a COSTLY thing wait for a good moment
        // while a cheap one does not have to, see the interaction below.
        const o = opts?.openness;
        const openness = typeof o === "number" && Number.isFinite(o) ? Math.min(1, Math.max(0, o)) : 0.5;
        // What is actually on her mind: something unsettled, or something still warm from having
        // been half-thought-about. Figures are not things you raise; they are who you raise them
        // with. A fresh birth counts too, something newly realised presses to be said.
        const candidates = [...graph.nodes.values()].filter((n) =>
          n.kind !== "figure" && (n.tension > 0.25 || n.warmth > 0.1 || nowMs - n.bornMs < FRESH_BIRTH_MS));
        if (candidates.length === 0) return null;

        // The model's own words are a HINT, at a weight that can tip a close call and nothing more.
        // It renders the message; it does not pick the topic. That distinction is the whole point:
        // the last version let one inference choose both, and the thing she was carrying never won.
        const hinted = new Map<number, number>();
        if (hint && hint.trim() && !config.noReminding) {
          for (const h of index.similar(hint, 5)) hinted.set(h.id, h.score);
        }

        // ── WHAT SHE CANNOT AFFORD TO SAY LENDS ITS PULL TO WHAT SITS BESIDE IT ──────
        //
        // Until this, reticence could do exactly one thing: decide whether a subject was raised.
        // Say it or do not. But a person who wants to know something and has not got the standing
        // to ask NEITHER falls silent NOR asks, they ask a nearby, cheaper question. That move
        // had no representation anywhere, which is why asking a small question beside the one she
        // could not bring herself to ask (S-37) was unreachable however she felt.
        //
        // Nothing new is invented for it. The graph already knows what sits beside a thing, and
        // the cost is already computed. So: a candidate whose cost outruns its own pull LENDS a
        // share of that pull to its neighbours, and then the same competition runs. The neighbour
        // may still lose. The expensive thing may still win. What changes is that the cheap thing
        // next to the unsayable one is now MORE LIKELY to be what comes up, which is what asking
        // sideways actually is.
        //
        // AND IT IS NOT CONCEALMENT. Nothing here models what he would infer, and nothing tries to
        // stop him inferring it. She says the part she can afford; his not seeing what she really
        // wanted is a CONSEQUENCE of her not being able to say it, not a goal she pursued. Building
        // it the other way round would be giving her machinery for working him.
        const pullOf = (n: FieldNode): number => 1.2 * n.tension + 0.6 * n.charge + 0.5 * n.warmth;
        const costOf = (n: FieldNode): number => (0.6 + 1.4 * (1 - openness)) * n.reticence;
        const lent = new Map<number, number>();
        for (const n of candidates) {
          const pull = pullOf(n);
          if (costOf(n) <= pull) continue;                 // she can afford it; nothing is lent
          const nbrs = graph.adj.get(n.id);
          if (!nbrs || nbrs.size === 0) continue;          // nothing beside it to ask instead
          // Divided among them, so a hub does not broadcast its pull across her whole field, and
          // capped well under the original: the nearby question is a smaller question.
          const share = (LENDS_TO_WHAT_IS_BESIDE_IT * pull) / nbrs.size;
          for (const otherId of nbrs.keys()) {
            if (otherId === n.id) continue;
            lent.set(otherId, (lent.get(otherId) ?? 0) + share);
          }
        }

        const scored = candidates.map((n) => {
          const carriedDays = Math.max(0, (nowMs - n.bornMs) / DAY_MS);
          const sinceRaised = n.lastRaisedMs === undefined ? Infinity : nowMs - n.lastRaisedMs;
          const justRaised = sinceRaised < RAISE_COOLDOWN_MS ? 1 - sinceRaised / RAISE_COOLDOWN_MS : 0;
          return {
            item: n,
            score:
              1.2 * n.tension          // it will not rest
              + 0.6 * n.charge         // it mattered
              + 0.5 * n.warmth         // it has been half-surfacing
              // What it costs her, and, the part that makes waiting for a good moment mean
              // anything: costing something matters MORE when he does not look reachable.
              //
              // Without this interaction the climate cannot change WHICH thing she raises, only how
              // often she speaks at all: reticence is deliberately ordering-preserving, so a warm
              // stretch eases the hard thing and the easy thing by the same shape and the ranking
              // between them is untouched. Measured live and it showed exactly that: she raised the
              // held question 3/10 in a warm month and 3/10 in a silent one, while going to him at
              // all 9/10 versus 6/10. The scene is not "she speaks more when things are good", it is
              // "she broaches the difficult thing when things are good", and that needs the cost of
              // the thing and the openness of the moment to meet.
              - (0.6 + 1.4 * (1 - openness)) * n.reticence
              + 0.35 * Math.min(1, carriedDays / 21) // carried a long time, still unsaid
              // The kind of thing it is, and whether she has come to like that kind (faculty #9).
              // Small, and third-order on purpose: taste TIPS a close call between two things she
              // could equally raise. It must never outrank a thing that will not rest, a person
              // whose preferences overrode what was bothering them is not someone with taste, they
              // are someone who is avoiding something. Zero for anything with no established kind
              // behind it, which is most of her field, so nothing that scored before scores
              // differently now unless she has actually formed a view.
              + LIKING_TIPS * likingFor(graph, n)
              - 1.6 * justRaised       // she has only just brought this up
              + 0.7 * (hinted.get(n.id) ?? 0)
              // What the thing she cannot afford to say lent to this one.
              + (lent.get(n.id) ?? 0),
          };
        });

        const picked = softPick(scored, {
          temperature: temperatureFrom(scored.map((c) => c.score)),
          count: 1,
          random: () => stream.next(),
        });
        const node = picked.chosen[0];
        if (!node) return null;
        return {
          node,
          weighed: picked.weighed
            .map((w) => ({ text: w.item.text, score: w.score, probability: w.probability }))
            .sort((a, b) => b.probability - a.probability)
            .slice(0, 6),
          openCompetition: normalizedEntropy(picked.weighed),
        };
      } catch (err) {
        report("field.chooseSubject", err);
        return null;
      }
    },

    whatSurfacesInReply(nowMs, stream, opts) {
      // Absent reads as 接, which is both the unmarked posture and what every caller meant
      // before the stance existed.
      const takesUpHisFrame = Math.min(1, Math.max(0, opts?.takesUpHisFrame ?? 1));
      try {
        const o = opts?.openness;
        const openness = typeof o === "number" && Number.isFinite(o) ? Math.min(1, Math.max(0, o)) : 0.5;
        // ── WHAT HE JUST SAID CAN BRING SOMETHING BACK ────────────────────────────────
        //
        // The hint used to be read AFTER this filter, so it could only ever add weight to
        // something that was already surfacing. It could not bring anything back. And a claim
        // he told her is born with `tension 0`, `warmth 0` and `charge 0.3`, so it passes the
        // filter only while it is still fresh, after that it was permanently out of reach of
        // a reply, however relevant.
        //
        // What that cost: he tells her about the trip on Monday, asks about it on Friday, and
        // the memory is one function call away and nothing brings it to her. Which is not a
        // memory system failing to store something, it is a person being unable to be
        // REMINDED, and being reminded by what somebody says is most of what remembering is.
        //
        // `mentions` for candidacy, `similar` for weight, and the split is the same one
        // `lookUp` needed: "is anything I hold about this" is a much weaker and more generous
        // question than "does this remind me of that". Becoming eligible is not surfacing,
        // everything below still scores against the same bar, so nothing is forced up.
        const hinted = new Map<number, number>();
        const mentioned = new Map<number, number>();
        const hint = opts?.hint;
        if (hint && hint.trim() && !config.noReminding) {
          for (const h of index.similar(hint, 5)) hinted.set(h.id, h.score);
          // `search`, not `mentions`, and for the reason `lookUp` needed the same swap: the
          // evidence floor is right for text she did NOT choose, and his message is the most
          // deliberately chosen text there is. Under the floor, 「渡轮」 matched nothing, he
          // could ask about the ferry in four characters and be told about nothing.
          //
          // And keyed to the clause of his message that actually SNAGGED her (attention.ts),
          // not to the whole message as one block. Flat, a long message brushing three topics
          // smeared its bonus across everything any part of it touched; a person is reminded
          // by the part that landed. A one-clause message behaves exactly as before, and when
          // nothing in the message connects to anything she holds, there is nothing to be
          // reminded OF, and the bonus correctly does not exist.
          const clauses = splitClauses(hint).map((c) => ({
            text: c,
            mass: index.search(c, 6).reduce((sum, h) => sum + h.score, 0),
          }));
          const snagged = attentionFrom(clauses).snagged;
          if (snagged) {
            for (const h of index.search(snagged.text, 8)) mentioned.set(h.id, h.score);
          }
        }

        const candidates = [...graph.nodes.values()].filter((n) =>
          n.kind !== "figure"
          && (n.tension > 0.25 || n.warmth > 0.1 || nowMs - n.bornMs < FRESH_BIRTH_MS || mentioned.has(n.id)));
        if (candidates.length === 0) return null;

        // The SAME scoring as chooseSubject, deliberately. Two theories of what presses on her
        // would be two people; if a thing weighs on her, it weighs the same whether she went to
        // him or he came to her.
        const scored = candidates.map((n) => {
          const carriedDays = Math.max(0, (nowMs - n.bornMs) / DAY_MS);
          const sinceRaised = n.lastRaisedMs === undefined ? Infinity : nowMs - n.lastRaisedMs;
          const justRaised = sinceRaised < RAISE_COOLDOWN_MS ? 1 - sinceRaised / RAISE_COOLDOWN_MS : 0;
          return {
            item: n as FieldNode | null,
            score:
              1.2 * n.tension
              + 0.6 * n.charge
              + 0.5 * n.warmth
              - (0.6 + 1.4 * (1 - openness)) * n.reticence
              + 0.35 * Math.min(1, carriedDays / 21)
              - 1.6 * justRaised
              + 0.7 * (hinted.get(n.id) ?? 0)
              // ── HE ASKED ABOUT THIS ONE ────────────────────────────────────────────
              //
              // `NOTHING_SURFACES` is 1.65 and it is the right bar for the question it was
              // built for: should she VOLUNTEER something unrelated. It is the wrong bar for
              // "he just asked me about this". A claim he told her scores about 0.26 on charge
              // and age, so even with a strong similarity boost it lost to silence every time,
              // he could tell her a thing on Monday, ask about it on Friday, and watch nothing
              // come back.
              //
              // Sized against the same scale the comment below uses rather than picked: it
              // lifts a told-claim he has just mentioned from ~0.6 to ~1.9, just over the bar,
              // while leaving everything he did NOT mention exactly where it was. And it is
              // added before the reticence cost, not after, so he can remind her of something
              // and she can still not want to talk about it, which is the whole point of S7.
              // SCALED by how well it matches, not a flat bonus: a message that brushes one
              // ordinary word must not lift a memory as hard as one that is plainly about it.
              + 1.6 * takesUpHisFrame * (mentioned.get(n.id) ?? 0),
          };
        });

        // NOTHING OF MINE, as a candidate with a score like any other.
        //
        // The number is set against the scale the others are on rather than picked to feel
        // right: a thing at the edge of counting as unsettled (tension 0.3, nothing else) scores
        // about 0.36, and something that has genuinely taken hold (tension 0.9, charge 0.7,
        // carried three weeks) scores about 1.85 before its cost comes off. NOTHING_SURFACES
        // sits between them and near the top, so an ordinary open thing almost never comes up
        // in a reply and something that will not let her alone sometimes does. The dynamics
        // this produces are measured rather than asserted: see field-reply-surfacing.test.ts,
        // which reports the rate at each pressure and fails if it drifts out of band.
        scored.push({ item: null, score: NOTHING_SURFACES });

        const picked = softPick(scored, {
          // Fixed, not derived. See NOTHING_SURFACES for why an adaptive temperature makes this
          // particular decision a cliff.
          temperature: SURFACING_TEMPERATURE,
          count: 1,
          random: () => stream.next(),
        });
        const node = picked.chosen[0];
        // BEFORE the early return, deliberately: the turn where nothing surfaced is the turn she
        // held all of it back, and charging withholding only on turns where something DID surface
        // would miss exactly the case the mechanism is about.
        heldBack(picked.weighed, node ?? null, openness);
        if (!node) return null;
        return {
          node,
          weighed: picked.weighed
            .map((w) => ({ text: w.item?.text ?? "(nothing of mine)", score: w.score, probability: w.probability }))
            .sort((a, b) => b.probability - a.probability)
            .slice(0, 6),
          openCompetition: normalizedEntropy(picked.weighed),
        };
      } catch (err) {
        report("field.whatSurfacesInReply", err);
        return null;
      }
    },

    saidIt(nodeId, spoken, minScore = 0) {
      try {
        if (!spoken.trim() || config.noReminding) return false;
        // `mentions`, not `similar`. This asked `similar`, whose ratio floor is 0.34 because it
        // is about REMINDING, and then applied its own 0.18 on top, which could never admit
        // anything the 0.34 had already thrown away, so the second number was dead and the real
        // bar was the wrong one. Measured over ninety days of memories, a reply that named the
        // carried thing outright scored 0.15 and was rejected, in both her languages. She could
        // have raised something and never learned whether it landed.
        return index.mentions(spoken, 5).some((h) => h.id === nodeId && h.score >= minScore);
      } catch (err) {
        report("field.saidIt", err);
        return false;
      }
    },

    raise(nodeId, nowMs, expectAnswer) {
      try {
        const n = graph.nodes.get(nodeId);
        if (!n) return;
        n.lastRaisedMs = nowMs;
        // Only the first unanswered thing is held pending: saying three things into silence is one
        // silence, exactly as the exchange log already treats it.
        if (pendingRaise === null) pendingRaise = { id: nodeId, atMs: nowMs, expected: expectAnswer };
      } catch (err) {
        report("field.raise", err);
      }
    },

    raisingSettled(answered, nowMs) {
      try {
        if (pendingRaise === null) return;
        // An answer that arrives days later is not an answer to this.
        if (answered && nowMs - pendingRaise.atMs > RAISE_ANSWER_WINDOW_MS) { pendingRaise = null; return; }
        const n = graph.nodes.get(pendingRaise.id);
        pendingRaise = null;
        if (n) raisingWent(n, answered);
      } catch (err) {
        report("field.raisingSettled", err);
      }
    },

    sheSpoke(nowMs, expectAnswer) {
      try {
        other.sheSpoke(nowMs);
        // Saying something to someone carries an expectation of being answered. Written down BEFORE
        // the outcome, because a prediction recorded afterwards is not a prediction, and without
        // one, nothing he does can ever surprise her.
        // ── FROM HIS RECORD, NOT FROM HER READ OF HIM ─────────────────────────────
        //
        // The caller passes `readOther().openness`, HER OWN CURRENT READ. So she predicted that
        // her read was correct, and `surprise` measured how far her read sat from itself. Every
        // consumer of surprise (her confidence in her own reading, the charge on what she just
        // raised, the temperature and shape of her next sentence) ran on a signal that mostly
        // could not fire.
        //
        // What she has to go on about whether he answers is HOW OFTEN HE HAS ANSWERED. Her read
        // stays a read. It is used only while there is too little record to have a frequency,
        // which is honest rather than a fallback: with nothing to go on, an impression IS what
        // she has.
        const fromHisRecord = howOftenHeAnswers(other.exchanges());
        const expected = fromHisRecord ?? (typeof expectAnswer === "number" ? expectAnswer : null);
        if (typeof expected === "number") other.expects(expected);
      } catch (err) {
        report("field.sheSpoke", err);
      }
    },

    heSpoke(nowMs, said) {
      try {
        other.heSpoke(nowMs);
        // If she had brought something up, this is the answer to it.
        if (pendingRaise !== null) {
          // The dark half first: how much do his actual words touch what she raised?
          // Recorded, never acted on, the loop below still credits ANY in-window message as
          // the answer, and whether that is too generous is what this number will show.
          if (typeof said === "string" && said.trim().length > 0) {
            const hit = index.mentions(said, 8).find((h) => h.id === pendingRaise!.id);
            raiseScores.push(hit?.score ?? 0);
            if (raiseScores.length > RAISE_GAUGE_RING) raiseScores.shift();
          }
          const n = graph.nodes.get(pendingRaise.id);
          const inTime = nowMs - pendingRaise.atMs <= RAISE_ANSWER_WINDOW_MS;
          const surprise = pendingRaise.expected === undefined ? 0 : Math.max(0, 1 - pendingRaise.expected);
          pendingRaise = null;
          if (n && inTime) {
            raisingWent(n, true);
            // Being answered when she did not expect it is the memorable version of being answered.
            // Surprise is the classic missing input to how deeply a thing is encoded, and this is
            // the one place she has a real prediction to be wrong about.
            if (surprise > 0) n.charge = Math.min(1, n.charge + 0.25 * surprise);
          }
        }
      } catch (err) {
        report("field.heSpoke", err);
      }
    },

    raiseGauge() {
      if (raiseScores.length < RAISE_GAUGE_FLOOR) return null;
      return raiseScores.reduce((a, b) => a + b, 0) / raiseScores.length;
    },

    readOther(nowMs, now) {
      try {
        return other.read(nowMs, now);
      } catch (err) {
        report("field.readOther", err);
        // A failed read is not a cold read. Neutral with no confidence is the honest fallback: it
        // says nothing about him and moves nothing, which is exactly what a failure knows.
        return { warmth: 0.5, drift: 0, openness: 0.1, confidence: 0, surprise: 0 };
      }
    },

    otherInWords(nowMs, now) {
      try {
        return describeOther(other.read(nowMs, now), now);
      } catch (err) {
        report("field.otherInWords", err);
        return "";
      }
    },

    settleOverdueRaise(nowMs) {
      // THE OTHER HALF OF THE RETICENCE LOOP, and it was unreachable. `heSpoke` records being
      // ANSWERED; `raisingSettled(false)` records being met with SILENCE, which is what makes a
      // thing harder to raise next time. Nothing in the daemon ever called it: if he answered
      // late the pending raise was cleared without a verdict, and if he never answered it sat
      // pending forever. So her reticence could only ever soften, a one-way loop that looks
      // like learning and cannot learn the painful half.
      try {
        if (pendingRaise === null) return false;
        if (nowMs - pendingRaise.atMs <= RAISE_ANSWER_WINDOW_MS) return false;
        const n = graph.nodes.get(pendingRaise.id);
        pendingRaise = null;
        if (n) raisingWent(n, false);
        return true;
      } catch (err) {
        report("field.settleOverdueRaise", err);
        return false;
      }
    },

    tick(nowMs) {
      try {
        const elapsed = lastTickMs === 0 ? 0 : Math.max(0, nowMs - lastTickMs);
        if (elapsed > 0) {
          decayAll(graph, nowMs, lastTickMs);
          coolAll(graph, elapsed);
          resonanceLog.decay(nowMs, elapsed);
          // How it has been going with him is a climate, so it acts on the same slow schedule as
          // forgetting rather than lurching after every message. A warm stretch gradually makes
          // everything easier to say; silence gradually makes it all harder.
          const read = other.read(nowMs);
          driftReticence(graph, read.warmth, read.confidence, elapsed / DAY_MS);
        }
        lastTickMs = nowMs;
      } catch (err) {
        report("field.tick", err, "critical");
      }
    },

    whatSheLikes() {
      try { return whatSheLikes(graph); } catch (err) { report("field.likes", err); return []; }
    },

    async rest(nowMs, deps = {}) {
      const result: RestResult = {
        replayed: { walks: 0, visited: 0, bumped: 0 },
        births: [], themes: [], ruptures: [], pruned: 0, refusals: {}, considered: 0, reinforced: [],
      };

      // Wandering. Free, and where the remote pairs actually meet.
      try {
        const r = replay(graph, resonanceLog, nowMs, { random: config.random ?? Math.random, ...deps.replay });
        result.replayed = { walks: r.walks, visited: r.visited, bumped: r.bumped };
      } catch (err) {
        report("field.replay", err);
      }

      // ── SOMETHING SHE HAS COME TO WONDER ABOUT ───────────────────────────────────
      //
      // Before this she could be HURT into having a question (a wall, a refusal, being handled)
      // or handed one by a COINCIDENCE OF TWO memories (fusion). A single thing that kept
      // surfacing in her, night after night, with nothing in her field accounting for it, did
      // nothing at all: it came up, she read it, it went back down. Which meant every lasting
      // thing in her had to be negative.
      //
      // Here, at rest, with the rest of incubation, and ONCE per thing, a question that could be
      // re-opened by the same node is a rumination engine with a better name.
      try {
        const wonder = whatSheHasComeToWonderAbout(graph, {
          room: SHE_CAN_ONLY_CARRY - [...graph.nodes.values()]
            .filter((n) => n.kind === "question" && n.tension > 0.2).length,
        });
        if (wonder) {
          const q = addNode(graph, {
            kind: "question", text: wonder.text, bornMs: nowMs, origin: "thought",
            credence: null, charge: Math.min(1, wonder.from.charge + 0.1), valence: 0,
            strength: 0.55, tension: wonder.tension,
            source: `wonder:${wonder.from.id}`, key: wonder.key,
          });
          // Born FROM the thing that kept coming back, which stays itself, she has not converted
          // a memory into a question, she has come to have a question ABOUT one.
          link(graph, q.id, wonder.from.id, "born_from", 0.6, nowMs);
          // And the thing is marked, so it can never open a second question.
          const marked = `${wonder.from.key ?? `node:${wonder.from.id}`}${ASKED_MARK}`;
          graph.byKey.delete(wonder.from.key ?? "");
          wonder.from.key = marked;
          graph.byKey.set(marked, wonder.from.id);
          wireReminding(q, nowMs);
          q.reticence = reticenceBaseFor(graph, q);
          event({ ms: nowMs, kind: "wonder", text: wonder.text, nodeId: q.id, detail: `from ${wonder.from.id}` });
        }
      } catch (err) {
        report("field.wonder", err);
      }

      // A crowd that has become one thing.
      try {
        const candidates = themeCandidates(graph);
        for (const cand of candidates.slice(0, MAX_THEMES_PER_REST)) {
          // Never re-theme a cluster that already belongs to one.
          const alreadyThemed = cand.members.some((m) => {
            const nbrs = graph.adj.get(m.id);
            if (!nbrs) return false;
            for (const other of nbrs.keys()) {
              if (graph.nodes.get(other)?.kind === "theme") return true;
            }
            return false;
          });
          if (alreadyThemed) continue;

          let name: string | null = null;
          try {
            name = deps.nameTheme ? await deps.nameTheme(cand.members) : null;
          } catch (err) {
            report("field.nameTheme", err);
          }
          const strongest = [...cand.members].sort((a, b) => b.charge - a.charge)[0];
          const text = name?.trim() || `something that keeps happening, around: ${strongest.text}`;
          const theme = addNode(graph, {
            kind: "theme", text, bornMs: nowMs, origin: "thought",
            charge: cand.meanCharge, valence: cand.meanValence, strength: 0.7,
            source: `theme:${cand.members.map((m) => m.id).join(",")}`,
            key: `theme:${cand.members.map((m) => m.id).sort((a, b) => a - b).join("-")}`,
          });
          for (const m of cand.members) link(graph, theme.id, m.id, "co_occurred", 0.5, nowMs);
          wireReminding(theme, nowMs);
          result.themes.push(theme);
          event({ ms: nowMs, kind: "theme", text, nodeId: theme.id, detail: `${cand.members.length} moments, density ${cand.density.toFixed(2)}` });
        }
      } catch (err) {
        report("field.themes", err);
      }

      // Disagreements that have to be faced. Reported, not resolved: resolving is her work.
      try {
        result.ruptures = ruptures(graph);
        for (const r of result.ruptures.slice(0, 3)) {
          event({ ms: nowMs, kind: "rupture", text: `two things she holds disagree: "${r.a.text}" / "${r.b.text}"`, detail: r.pressure.toFixed(2) });
        }
      } catch (err) {
        report("field.ruptures", err);
      }

      // Birth. The one place a model is called, bounded and only when a coincidence insisted.
      if (deps.fusion) {
        const max = deps.maxFusions ?? config.maxFusionsPerRest ?? 2;
        let cands: FusionCandidate[] = [];
        try {
          cands = resonanceLog.candidates(graph, nowMs);
        } catch (err) {
          report("field.candidates", err);
        }
        for (const cand of cands.slice(0, Math.max(0, max))) {
          result.considered += 1;
          const outcome = await attemptFusion(cand, nowMs, deps.fusion);
          // Whatever happens, this pair has now been looked at and does not re-fire forever.
          resonanceLog.settle(cand.pair.a, cand.pair.b);
          if (!outcome.born) {
            result.refusals[outcome.reason] = (result.refusals[outcome.reason] ?? 0) + 1;
            // A refusal for a reason other than "nothing" is a real signal about the fusion path,
            // so it is recorded rather than dropped. "nothing" is the honest majority answer.
            if (outcome.reason !== "nothing") {
              event({ ms: nowMs, kind: "refusal", text: `a coincidence came to nothing (${outcome.reason})`, detail: outcome.detail });
              if (outcome.reason === "error") report("field.fusion", outcome.detail ?? "fusion failed");
            }
            continue;
          }
          // Did she just arrive, by another road, at something she already holds? Then it is not a
          // birth. It is the same thing confirmed, which is worth more than a duplicate would be.
          const already = index.similar(outcome.born.text, 5)
            .map((h) => ({ h, n: graph.nodes.get(h.id) }))
            .find(({ h, n }) => n && h.score >= SAME_REALISATION
              && (n.kind === "fusion" || n.kind === "question" || n.kind === "insight"));
          if (already?.n) {
            const held = already.n;
            held.strength = Math.min(1, held.strength + 0.15);
            held.charge = Math.min(1, held.charge + 0.05);
            link(graph, held.id, cand.a.id, "born_from", 0.3, nowMs);
            link(graph, held.id, cand.b.id, "born_from", 0.3, nowMs);
            result.reinforced.push(held);
            fusionsResolvedTotal += 1;
            event({ ms: nowMs, kind: "fusion", text: `came at it again from somewhere else: ${held.text}`, nodeId: held.id });
            continue;
          }

          const born = addNode(graph, {
            kind: outcome.born.kind === "question" ? "question" : "fusion",
            text: outcome.born.text,
            bornMs: nowMs,
            origin: "thought",
            // A birth is stirring, and it inherits how much its parents mattered.
            charge: Math.min(1, 0.4 + 0.5 * (cand.a.charge + cand.b.charge) / 2),
            valence: (cand.a.valence + cand.b.valence) / 2,
            // It enters weak on purpose. Nothing here decides it was good; the field decides later,
            // by using it or by letting it go.
            strength: 0.35,
            tension: outcome.born.kind === "question" ? 0.6 : 0,
            source: `born_from:${cand.a.id},${cand.b.id}`,
            key: `fusion:${cand.a.id}-${cand.b.id}`,
          });
          link(graph, born.id, cand.a.id, "born_from", 0.6, nowMs);
          link(graph, born.id, cand.b.id, "born_from", 0.6, nowMs);
          wireReminding(born, nowMs);
          birthsTotal += 1;
          fusionsResolvedTotal += 1;
          result.births.push(born);
          event({ ms: nowMs, kind: "fusion", text: outcome.born.text, nodeId: born.id, detail: outcome.born.why });
        }
      }

      // Letting go. Only what is genuinely weak, disconnected and old.
      try {
        const gone = prune(graph, nowMs);
        result.pruned = gone.length;
        for (const n of gone) {
          resonanceLog.forget(n.id);
          index.remove(n.id);
        }
        if (gone.length > 0) {
          event({ ms: nowMs, kind: "prune", text: `let go of ${gone.length} things she no longer had a use for` });
        }
      } catch (err) {
        report("field.prune", err);
      }

      this.persist();
      return result;
    },

    signals(nowMs) {
      const s = stats(graph);
      const otherId = graph.byKey.get("figure:the one i exchange messages with");
      const otherNode = otherId !== undefined ? graph.nodes.get(otherId) : undefined;

      let freshBirth = 0;
      for (const n of graph.nodes.values()) {
        if ((n.kind === "fusion" || n.kind === "question") && nowMs - n.bornMs < FRESH_BIRTH_MS) {
          freshBirth = Math.max(freshBirth, n.charge);
        }
      }

      const recent = recentRecalls.slice(-6);
      const valence = recent.length === 0 ? 0 : recent.reduce((a, r) => a + r.valence, 0) / recent.length;
      const charge = recent.length === 0 ? 0 : recent.reduce((a, r) => a + r.charge, 0) / recent.length;

      let pendingBirths = 0;
      try {
        pendingBirths = resonanceLog.candidates(graph, nowMs).length;
      } catch (err) {
        report("field.signals", err);
      }

      return {
        // Scaled to the size of the life it sits in.
        //
        // This was a flat divisor of 4, chosen when the only thing carrying tension was an open
        // question, of which she has very few. Suspension carries tension too now, and over a
        // simulated six months she accumulated 66 things she could not settle: the signal pinned at
        // 1.000, discomfort pinned at maximum, and it became the drive she wanted to act on every
        // single day forever, with nothing else able to compete. Permanent maximal anxiety is a
        // behavioural collapse, not a strong signal.
        //
        // A floor keeps it meaningful when she is young, where four unsettled things really is a
        // lot; past that it is a proportion of what she holds.
        tension: Math.min(1, s.tension / Math.max(TENSION_FLOOR, s.nodes * TENSION_PER_NODE)),
        pendingBirths,
        otherWarmth: otherNode ? Math.min(1, otherNode.warmth + 0.5 * otherNode.strength * Math.min(1, (graph.adj.get(otherNode.id)?.size ?? 0) / 12)) : 0,
        otherUnease: uneaseAbout(graph, otherNode),
        freshBirth,
        orphanShare: s.nodes === 0 ? 0 : s.orphans / s.nodes,
        valence,
        charge,
        spiralling: detectSpiral(recentRecalls),
        surfaced: recent.length === 0 ? 0 : recent.reduce((a, r) => a + r.ids.length, 0) / recent.length,
        birthsTotal,
        fusionsResolvedTotal,
        meanStrength: s.meanStrength,
        suspended: s.suspended,
        meanCredence: s.meanCredence,
        credencePinnedShare: s.credencePinnedShare,
        judgements: judgementsTotal,
        // Counted off the GRAPH, for two reasons that used to need two mechanisms.
        //
        // It survives a restart exactly as the graph does. A session counter went from 150 to 0
        // across a reboot while the graph still held all 150, so the number said "nothing has ever
        // arrived to be judged" about a field full of things that had.
        //
        // And it cannot be switched off by the thing it watches. The session counter had to be
        // incremented carefully OUTSIDE the `noReminding` branch, or turning the judging path off
        // would also turn off the count of what it had failed to judge, and the detector for a dead
        // judging layer would go quiet at exactly the moment the layer died. Reading the graph makes
        // that structural rather than a comment somebody has to keep honouring.
        judgeable: [...graph.nodes.values()].filter((n) => n.kind !== "figure").length,
      };
    },

    stats: () => stats(graph),
    candidates: (nowMs) => resonanceLog.candidates(graph, nowMs),
    graph: () => graph,
    events(limit = 50) {
      const stored = config.store?.events(limit);
      return stored && stored.length > 0 ? stored : recentEvents.slice(-limit);
    },
    lookUp(text, limit = 8) {
      const q = (text ?? "").trim();
      if (q === "") return [];
      // `search`, not `mentions`, and the difference is the evidence floor. `mentions` is
      // asked about text she did NOT choose, so it needs a floor to stop a couple of ordinary
      // shared words counting. She typed this one on purpose: 「渡轮」 is two characters and
      // almost no mass, and under the floor it came back empty, she asked a normal question
      // about her own memory and was told there was nothing there.
      const hits = index.search(q, Math.max(1, Math.min(50, limit)));
      const out: FieldNode[] = [];
      for (const h of hits) {
        const n = graph.nodes.get(h.id);
        if (n) out.push(n);
      }
      return out;
    },
    attend(text) {
      try {
        const clauses = splitClauses(text ?? "").map((c) => {
          // `search`, not `mentions`: his message is the most deliberately chosen text there
          // is, same reasoning as `lookUp` above. Mass is the summed match quality of what
          // this one clause lands on.
          //
          // The hits are KEPT now rather than summed and dropped. Same one search; what changes is
          // that the caller can find out what she was reminded OF, not merely that she was.
          const hits = index.search(c, 6);
          return {
            text: c,
            mass: hits.reduce((sum, h) => sum + h.score, 0),
            landedOn: hits,
          };
        });
        return attentionFrom(clauses);
      } catch (err) {
        report("field.attend", err);
        return attentionFrom([]);
      }
    },
    nodeById(id) {
      const node = graph.nodes.get(id);
      if (!node) return null;
      const adj = graph.adj.get(id) ?? new Map<number, number>();
      const linked: FieldNode[] = [];
      for (const [otherId] of adj) {
        const other = graph.nodes.get(otherId);
        if (other) linked.push(other);
      }
      // Strongest connections first, and capped: what a thing reminds her of is a handful,
      // not an inventory.
      linked.sort((a, b) => (adj.get(b.id) ?? 0) - (adj.get(a.id) ?? 0));
      return { node, linked: linked.slice(0, 6) };
    },
    nodeByKey(key) {
      const id = graph.byKey.get(key);
      return id === undefined ? undefined : graph.nodes.get(id);
    },

    persist() {
      try {
        config.store?.save(graph, resonanceLog.all(), lastTickMs, trust.told, other.exchanges(), other.expectations());
      } catch (err) {
        report("field.persist", err, "critical");
      }
    },
  };
}

/** How many of her most recent moments involving someone are weighed. */
export const UNEASE_WINDOW = 8;

/**
 * How much her recent record involving someone has been sitting badly.
 *
 * Only the negative side counts, and deliberately so. Good times with someone do not stop you
 * worrying about them; being in touch with them does, and that discharge happens elsewhere. If good
 * moments were allowed to cancel bad ones here, a fortnight of pleasant exchanges would average
 * away the one that went wrong, which is precisely the moment worth still carrying.
 */
export function uneaseAbout(graph: FieldGraph, who: FieldNode | undefined): number {
  if (!who) return 0;
  const nbrs = graph.adj.get(who.id);
  if (!nbrs || nbrs.size === 0) return 0;
  const recent = [...nbrs.keys()]
    .map((id) => graph.nodes.get(id))
    .filter((n): n is FieldNode => !!n && n.kind !== "figure")
    .sort((a, b) => b.bornMs - a.bornMs)
    .slice(0, UNEASE_WINDOW);
  if (recent.length === 0) return 0;
  // Weighted by how hard each landed, so one bad night counts for more than several dull ones.
  const weight = recent.reduce((s, n) => s + Math.max(0, -n.valence) * n.charge, 0);
  return Math.min(1, (weight / recent.length) * 2);
}

/**
 * Rumination: the same small set of memories coming back again and again while getting worse. The
 * coupling between mood and recall is a genuine feedback loop, and a feedback loop can run away.
 *
 * This does NOT suppress anything. Quietly damping her when she is stuck would be the exact failure
 * this project bans: the state is real, and hiding it would mean nobody finds out. It is raised so
 * the watchtower shows it and so she is offered something to do about it.
 */
export function detectSpiral(recalls: readonly { ms: number; valence: number; ids: number[] }[], window = 5): boolean {
  if (recalls.length < window) return false;
  const recent = recalls.slice(-window);
  if (!recent.every((r) => r.valence < -0.15)) return false;
  // Worsening, not merely bad.
  if (recent[recent.length - 1].valence > recent[0].valence) return false;
  // And circling the same few things.
  const counts = new Map<number, number>();
  for (const r of recent) {
    for (const id of r.ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let repeated = 0;
  for (const c of counts.values()) if (c >= Math.ceil(window * 0.6)) repeated += 1;
  return repeated >= 2;
}

// A `forgetNode(field, id)` helper used to live here. It was never called by anything, and it was
// the only way to remove a node WITHOUT also removing it from the word index, which would have left
// a dead entry able to keep wiring new memories to something she no longer had. Deleting the
// function is the real fix: the pruning path already tidies both, and a route that does not exist
// cannot drift out of step with the one that does.
