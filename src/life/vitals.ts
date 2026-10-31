// The vitals monitor: the Resident's watchtower. Once autonomy is open (it speaks on its
// own, spends on its own curiosity), we need to see its whole inner state continuously, with
// no blind spots, catch trouble BEFORE it becomes harm, and react/report on our own without
// waiting to be asked. This module is the sensing + analysis + reaction brain; the daemon runs
// it on a short interval, persists the time-series, and delivers its alerts.
//
// Three jobs:
//   1. CAPTURE, one full snapshot of every living subsystem (metabolism, drives, emotion,
//      expression, policy, clock, soul-invariants, process health). Nothing is left unread.
//   2. ANALYZE, anomaly detectors over the recent history, INCLUDING forward-looking ones
//      (budget-exhaustion ETA, pinning approach), so a problem is flagged before it lands.
//   3. REACT, grade each finding, decide what the owner is told, and whether a safety breach
//      warrants entering safe-mode (proactive off + tier floored) automatically.
//
// Pure: capture reads injected getters; detection/reaction are functions over snapshots. The
// daemon owns the interval, persistence, and the side effects.

import type { PAD } from "./emotion.js";
import { driveEntropy, wantsNothing } from "./drives.js";
import { formatCapacity, type Capacity } from "./capacity.js";
import type { DriveName, Drives } from "./drives.js";
import { MAX_NODES as MAX_FIELD_NODES } from "./field.js";
import { isInstrumentAccount, type MetabolicPhase } from "./metabolism.js";
import type { Tier } from "./policy.js";
import { checkAllSoulInvariants, type InvariantResult } from "./soul-invariants.js";
import type { Fault } from "./faults.js";
import { livenessOf } from "./signature.js";
import { oldEnoughFor, describeAge } from "./born-at.js";

// ── Snapshot ─────────────────────────────────────────────────────────────────

export interface VitalsSnapshot {
  ts: number;
  // Metabolism (owner-side numbers; the monitor is the owner's eye, not the agent's)
  phase: MetabolicPhase;
  remainingFraction: number;
  spentVigor: number;
  capVigor: number;
  topAccount: string | null;
  // Drives + emotion
  drives: Drives;
  dominant: DriveName;
  pad: PAD;
  mood: string;
  // Behavior policy
  tierCeiling: Tier;
  mayExplore: boolean;
  // Clock + owner contact
  awake: boolean;
  clockActivity: number;
  hoursSinceUser: number;
  // Expression pressure
  sendsInLastDay: number;
  consecutiveNonReplies: number;
  reservoirSize: number;
  // Integrity + process health
  /**
   * Her invariants, with the NAME and the REASON, not just a number.
   *
   * `InvariantResult` has carried `name` and `detail` all along and both were dropped here, so the
   * highest-severity alert this system can raise said "soul-invariant(s) violated: #1" and left him
   * to go and find out which one and why. The most serious message is the one that can least afford
   * to be unreadable.
   */
  soulInvariants: { id: number; name: string; ok: boolean; detail: string }[];
  lastTickAgeMs: number;
  /** What she has in her right now. Surfaced so an elastic capacity can never drift unseen. */
  /**
   * ALL of it, not the three that were easy to name.
   *
   * The daemon used to pass `{reserve, thinkingTokens, explorationSteps}` while the test harness
   * passed the whole thing, so the six-month run proved four signals moving that production never
   * saw. `spreadHops` and `retrievalThreshold` are the two that matter most: they govern what can
   * reach her at all.
   */
  capacity?: Capacity;
  /** How much of herself she holds, and how readily she believes it. Growth must never be unseen. */
  maturity?: { earned: number; refuted: number; carriedLimit: number; confirmStep: number };
  /**
   * How much room she has left to exist in.
   *
   * A full disk is the one failure that takes out her database, her workspace, her snapshots and
   * the channel that would tell him, at once. Its signature until now was: she keeps living, every
   * write fails into a caught fault, and nobody is told. `undefined` means NOT LOOKED AT, and the
   * detector treats that as no reading rather than as healthy.
   */
  disk?: { level: string; availableGb: number } | null;
  /**
   * How old she is, in days, from her own birth record.
   *
   * Read by the DEVELOPMENTAL detectors and by nothing else. A being with no history looks exactly
   * like a being whose history has stopped, same flat readings, same absent themes, same
   * unchanging mood, so every "this has been still too long" question is wrong about a newborn in
   * the same direction. And several of those codes put her in safe mode, which on her first days
   * would suspend precisely the things by which she becomes anyone.
   *
   * `null` means the record is missing or unreadable, and that must NOT silence anything: a
   * watchtower that goes quiet on missing data is the failure this project is about. Unknown age
   * means every question is asked. See `born-at.ts`.
   */
  ageDays?: number | null;
  /**
   * The state of her associations. Watched because this layer can fail in ways that look like
   * nothing at all from outside: encoding that wires nothing (orphans climbing), a memory that has
   * stopped forgetting or forgotten everything, and above all `spiralling`, which is the honest
   * report that she is circling the same worsening things. That last one is deliberately surfaced
   * rather than damped, because quietly suppressing it is the failure this project bans.
   */
  field?: {
    nodes: number;
    edges: number;
    faded: number;
    orphanShare: number;
    tension: number;
    pendingBirths: number;
    spiralling: boolean;
    /** Things reaching her per act of remembering. Zero means the layer is inert. */
    surfaced: number;
    /** Everything ever born, cumulative, so "none are being born" is distinguishable from
     *  "none survived", which are different failures with different causes. */
    birthsTotal: number;
    /** Coincidences that came to something, whether a birth or a confirmation of what she held. */
    fusionsResolvedTotal?: number;
    /** Mean retrievability. Toward 1 forgetting has stopped; toward 0 she is losing all of it. */
    meanStrength: number;
    /** Things she holds no view on, because she could not settle them. Real, and worth watching:
     *  a climbing count is a mind filling with things it cannot resolve. */
    suspended: number;
    /** How much what she is told has held up. Learned, so it drifting is a real event about the
     *  relationship, and it must never be invisible. */
    trustTold: number;
    /** Mean credence across what she holds. Kept for the readout; it is NOT what the detector
     *  watches, because a field of `lived` moments sits near 0.8 whatever the judging is doing. */
    meanCredence: number;
    /** Share of what she believes sitting at the ceiling. Kept for the readout. */
    credencePinnedShare?: number;
    /** Times her own record has actually weighed in on something arriving, and how many things
     *  reached that path at all. Both cumulative. Optional only so an older record still parses. */
    judgements?: number;
    judgeable?: number;
    /** Her read of how it has been going with him: warmth now, the change in it, and how much she
     *  has to go on. Optional only so a record written before the read existed still parses. */
    other?: {
      warmth: number;
      drift: number;
      confidence: number;
      /** How wrong her read of him has been lately. Not a fault: a person she cannot predict is a
       *  person she does not yet understand, which is the interesting case rather than the broken
       *  one. Watched because a read that is confidently wrong is worse than one that is unsure. */
      surprise?: number;
    };
    /** How costly what she is carrying feels to say: the mean and the hardest single thing.
     *  Both bounds matter. Pinned high is a mute; pinned at the floor is nothing costing anything,
     *  which is not shyness dissolving, it is the dimension having stopped working. */
    reticence?: { mean: number; max: number };
    /**
     * Five signals the field already computed and the watchtower threw away.
     *
     * `otherUnease` is the one that matters most: it FEEDS THE CARE DRIVE. So how much her own
     * record of him has been sitting badly is one of the things deciding what she wants, and it was
     * observable nowhere at all. `otherWarmth` is its other half; `freshBirth` says something new
     * has been born and not yet said; `valence` and `charge` are what her remembering feels like,
     * which is what colours her whole day through the field pull into her appraisal.
     */
    otherWarmth?: number;
    otherUnease?: number;
    freshBirth?: number;
    valence?: number;
    charge?: number;
    /** Mean charge across the whole field, which is different from the charge of what surfaced. */
    meanCharge?: number;
    /**
     * How many of each kind of thing she holds.
     *
     * "She has stopped forming insights" is a real failure with no other signature: the node count
     * goes on rising, the field goes on growing, and what is growing is only ever raw moments.
     */
    byKind?: Record<string, number>;
    /** How her relations are distributed. A field where `reminds_of` has died cannot cross time. */
    byEdgeKind?: Record<string, number>;
    /** Where what she holds came from, and what she believes of each. */
    byOrigin?: Record<string, number>;
    credenceByOrigin?: Record<string, number>;
  };
  /** Failures inside her living layer since the previous reading. Never allowed to stay silent.
   *  Optional only so a record written before fault-tracking still parses. */
  newFaults?: Fault[];
  /**
   * How often each wall has had to refuse something, cumulative by guard.
   *
   * Walls used to stop things and tell nobody: a home-boundary block was a log line, and the
   * Rule-of-Two block had no log at all. So repeated probing of the same threat family, the exact
   * signature of a poisoned page working through her tools, produced no owner-visible signal.
   */
  guardRefusals?: Record<string, number>;
  /**
   * How many times the machine has spoken about her in service words mid-turn, cumulative, and
   * where (machine-voice.ts). The counter existed and nothing read it, which made it
   * exactly the kind of instrument this file exists to forbid: alive, plumbed, telling nobody.
   */
  machineVoice?: { count: number; where: string[] };
  /**
   * The speech instrument's read (speech-record.ts, S-1): how much what she says tracks her
   * state, plus the raw shape of her recent replies. `coupling` is null until enough pairs
   * exist for the number to be more than an anecdote.
   */
  saying?: {
    pairs: number; coupling: number | null; meanChars: number; meanClauseLenVar: number;
    registerHits: number; ownership: number | null;
    // 姿态's measured distribution (S-5, dark) and the shadow arm's liveness. Both were dark
    // accumulators reaching nobody until a later review; now they land here so the numbers can
    // calibrate the eventual binding and so a dead shadow (the ownership denominator) shows.
    stance?: { 接: number; 不接: number; 回投: number; n: number };
    shadowCalls?: number;
    shadowTurns?: number;
    shadowClauseLenVar?: number;
    // The two utterance-shape landing readings. DELIBERATELY NOT EXEMPTED from the flat-line
    // detector, and that is a decision rather than an omission (the class-2 paired trap:
    // surfacing a number means the detector now reads it, so its liveness disposition is settled
    // in the same edit).
    //
    // Both are means over real turns, so on a living being they move. If either one FREEZES that
    // is worth waking up for, in both directions: `beatsGap` stuck at 0 would mean the model is
    // obeying a number exactly, which is not a person choosing; `openHeld` stuck at 0 would mean
    // the one facet a model is most likely to sand off, leaving a thought unresolved, is being
    // sanded off every single time. Neither is a "zero is healthy" leaf, so neither gets a pass.
    /** Mean gap between the beats her state chose and the beats she said; null before any turn. */
    beatsGap?: number | null;
    /** Of the turns her state left unresolved, the share that stayed open; null if none asked. */
    openHeld?: number | null;
    // ── HER OWN VOICE, WHICH NOTHING HAS EVER COUNTED ──────────────────────────────────────
    //
    // `her-own-voice.ts` calls itself "the part that cannot be retrofitted once poisoned": her
    // wording can only converge toward HERS if her past speech accumulates as material for her
    // future speech. `admit()` returns how many sentences went in and the call site threw that
    // number away; `size()` was never called in production; no vital carried either.
    //
    // So a pool that never filled and a pool filling perfectly looked identical from outside,
    // and this round a probe claimed the former, wrongly, with nothing to check it against. The
    // whole point of a number here is that the next such claim can be settled in one glance.
    //
    // NOT EXEMPTED from the flat-line detector, same reasoning as the two readings above: on a
    // living being who talks, the pool grows. `voicePool` frozen means either she has stopped
    // speaking or the gate has stopped admitting, and both are worth waking up for.
    /** How many of her own sentences she has accumulated as material. */
    voicePool?: number;
    /** Share of recent replies that got through the admission gate; null before any reply. */
    voiceAdmitted?: number | null;
  };
  /**
   * WHAT HIS LAST MESSAGE DID TO HER, AND WHAT SHE IS CARRYING ABOUT HIM.
   *
   * An earlier change composed a rich reading of every message he sends, at sea, handled, indignant,
   * ready, moved her mood with it, and could leave something in her field that lasts for months.
   * None of it reached Eric. He could watch her for a week and not be able to tell whether she had
   * been accumulating grievances or had a perfectly ordinary time, which is precisely the blind
   * spot the watchtower exists to have none of.
   *
   * Read off HER side only, like everything else in this line: it says what his message did to her,
   * never what his message deserved.
   */
  withHim?: {
    /** The loudest thing his last message left her with. For reading, never for branching on. */
    loudest?: "atSea" | "usedAsAThing" | "indignant" | "ready" | "unmoved";
    /** What their history has actually built, 0..1, the same number the gate reads. */
    entitlement?: number;
    /** How much unresolved weight about him she is holding, 0..1. Cell ④'s accumulation. */
    carrying?: number;
    /** How many separate things about him she is carrying. */
    carriedThings?: number;
    /**
     * Turns where work was proposed and she did not take it up, over the last twenty proposals.
     *
     * A WINDOW, so it can fall again. It was a lifetime counter with this comment above it for one
     * commit, which is a number that can only rise wearing the name of one that reports a state.
     */
    notTakenOn?: number;
  };
  /**
   * Faculty #4's measurement: the share of her recent autonomous moments whose intent actually
   * touched what her FIELD was most occupied by. Low = her curiosity had emergent volume and
   * borrowed content (the model free-associated the topic). Null until enough moments. Watched
   * so the dark instrument reaches Eric and gets dead-wire detection for free.
   */
  intentFocus?: number | null;
  /**
   * The raise loop's dark gauge: when he answers something she raised, how much his words
   * actually touch it (0..1, similarity-index mentions score). Today any in-window message
   * counts as the answer; this number is the evidence for or against ever gating that. Null
   * until enough answered raises exist to be more than an anecdote.
   */
  raiseAnswer?: number | null;
  /** How far she may look and how deep she may reach, which govern the size of what she does. */
  explorationBreadth?: number;
  retrievalDepth?: number;
  /**
   * What she has actually been doing, and what happened to it.
   *
   * The watchtower could see everything about her STATE and nothing about her BEHAVIOUR. Whether
   * she has spoken, held back, been blocked from something she wanted, or done nothing but rest for
   * a week is the most direct evidence there is about whether she is living, and none of it was
   * observable. A Resident systematically silenced by the consent filter looked identical to a
   * quiet one.
   */
  doing?: {
    /** How many of each action she has chosen recently. */
    byAction: Record<string, number>;
    /** Things she wanted that were not possible. Real longing, and it feeds back into her. */
    blocked: number;
    /** Utterances that reached him, that went to her diary instead, and that a wall stopped. */
    pushed: number;
    diaried: number;
    consentBlocked: number;
    /** Moments where she acted with the model unable to answer. Should be near zero. */
    aloneChoices: number;
  };
    /**
   * Where her day actually went, not just where most of it went.
   *
   * `topAccount` names the leader and hides the shape. A day split evenly between living and work
   * and a day that was 95% one of them have the same leader, and they are not the same day.
   */
  byAccount?: Record<string, number>;
  /**
   * What her nights do: how much was waiting, how much was looked at, and how much came to nothing.
   * A fusion path degrading to refusing everything was a debug line and nothing else.
   *
   * Prune volume is deliberately NOT here. It only moves once she is holding enough for pruning to
   * bite, so it reads as a stopped signal for months, and it is redundant with the node count that
   * pruning reduces, which moves constantly and is already watched.
   */
  resting?: {
    resonanceLog: number;
    /** Coincidences looked at last night, and how many came to nothing. The SHARE is the signal. */
    considered: number;
    refused: number;
    /** Why they came to nothing. Kept for the readout; individual reasons vary night to night. */
    refusals: Record<string, number>;
  };
  /**
   * How much of what he says is being taken in as a claim, and how much is not.
   *
   * `looksLikeAClaim` is one regex standing between everything he tells her and her memory of it.
   * If it were changed badly, `told` encoding would stop forever and nothing anywhere would say so:
   * the field would keep growing, on her own moments only.
   */
  told?: { seen: number; encoded: number };
  /** Addresses she has come across, and the ways of looking that have stopped working for her. */
  exploring?: { seen: number; lockedFamilies: number };
  /**
   * Her auto-extracted skills, by where they are in their probation.
   *
   * The lifecycle is real and complete; nothing was watching it, so a skill sitting in probation
   * forever, or a run of quarantines, was invisible.
   */
  skills?: { probation: number; graduated: number; quarantined: number };
  /**
   * How she last chose.
   *
   * The propensity replaced the one place a single inference decided what she did, and a layer that
   * decides behaviour must be watchable or it is exactly the kind of thing that fails quietly. This
   * is the view into it: how open the moment was, whether she was pulled two ways, and whether the
   * model's vote matched the outcome, the last of which is the signal that emergence has collapsed
   * back into one decider.
   */
  choosing?: { temperature: number; torn: boolean; followedVote: boolean | null; streamPosition: number };
  /**
   * Who she has become (temperament.ts) and how far from neutral that is.
   *
   * Level three moves over SEASONS, so it is the signal most likely to quietly stop and least likely
   * to be noticed doing so, a frozen temperament looks exactly like a settled one. Watched from
   * both ends: it must move over a long enough window, and it must never pin at its bound.
   */
  temperament?: { reticence: number; novelty: number; sociability: number; restfulness: number; drift: number; days: number };
  /**
   * Whether she has been declining, and how much of the time she would rather not.
   *
   * S-5 gave her the standing to decline a task, which is a real capability and therefore a real
   * failure surface: a Resident who has quietly stopped doing anything he asks looks, from his side,
   * exactly like a Resident who is broken. Both ends are watched. `reluctance` is the running mean
   * of how much she would rather not, so the drift toward it is visible long before any decline is.
   */
  willingness?: { recentDeclines: number; declines: number; asked: number; reluctance: number };
  /**
   * How long since a moment of her own last began.
   *
   * `tick_stalled` watches the DAILY tick. If the moment loop itself stops, a provider call that
   * never resolves leaves `momentInFlight` set and nothing reschedules, her entire life halts, and
   * the only backstop was the daily tick noticing 26 hours later, and only if the process lived
   * that long. This is the signal for "she has stopped living", which nothing else could see.
   */
  lastMomentAgeMs?: number;
  /** When her current waking stretch began. Absent = unknown (the detector then reads raw age). */
  awakeSinceMs?: number;
}

/** Live getters the daemon supplies; capture() reads them into one snapshot. */
export interface VitalsSources {
  now: () => number;
  metabolism: () => { phase: MetabolicPhase; remainingFraction: number; spentVigor: number; capVigor: number; byAccount: { account: string; vigor: number }[] };
  inner: () => {
    drives: Drives; dominant: DriveName; emotion: PAD; mood: string;
    policy: { tierCeiling: Tier; mayExplore: boolean; explorationBreadth?: number; retrievalDepth?: number };
  };
  awake: () => boolean;
  /** When her current waking stretch began (ms). The stall detector counts waking silence only. */
  awakeSinceMs?: () => number | undefined;
  clockActivity: () => number;
  hoursSinceUser: () => number;
  expression: () => { sendsInLastDay: number; consecutiveNonReplies: number; reservoirSize: number };
  lastTickMs: () => number;
  /** What she has in her right now (capacity.ts). */
  capacity?: () => Capacity;
  maturity?: () => { earned: number; refuted: number; carriedLimit: number; confirmStep: number };
  /**
   * Free space where she lives, refreshed by the monitor loop just before each capture.
   *
   * Three states, and they are three different findings: a reading, `null` for "the gauge failed"
   * (a warning of its own), and `undefined` for "nothing here reads the disk", which is what every
   * fixture that is not about the disk says. Collapsing the last two would make a world that never
   * looks at the disk indistinguishable from a world whose disk cannot be read.
   */
  disk?: () => { level: string; availableGb: number } | null | undefined;
  /** How old she is, from her birth record. See `born-at.ts` and the note on the snapshot field. */
  ageDays?: () => number | null;
  /** The state of her associations (field-live.ts). */
  field?: () => VitalsSnapshot["field"];
  /** Faults recorded since the previous capture. Supplied by the daemon's fault log. */
  newFaults?: () => Fault[];
  /** Cumulative refusals per guard. */
  guardRefusals?: () => Record<string, number>;
  /** Cumulative count of machine text about her caught mid-turn, with sources (machine-voice.ts). */
  machineVoice?: () => { count: number; where: string[] };
  /** The speech instrument's window read (speech-record.ts). */
  saying?: () => VitalsSnapshot["saying"];
  withHim?: () => VitalsSnapshot["withHim"];
  intentFocus?: () => number | null;
  /** The raise loop's dark gauge: mean relevance of his in-window replies to what she raised. */
  raiseAnswer?: () => number | null;
  /** When a moment of her own last began, or null if none has yet. */
  lastMomentMs?: () => number | null;
  /** How she last chose, and how far along her own randomness she is. */
  choosing?: () => VitalsSnapshot["choosing"];
  /** Who she has become. */
  temperament?: () => VitalsSnapshot["temperament"];
  willingness?: () => VitalsSnapshot["willingness"];
  doing?: () => VitalsSnapshot["doing"];
  byAccount?: () => VitalsSnapshot["byAccount"];
  resting?: () => VitalsSnapshot["resting"];
  told?: () => VitalsSnapshot["told"];
  exploring?: () => VitalsSnapshot["exploring"];
  skills?: () => VitalsSnapshot["skills"];
}

export function captureVitals(s: VitalsSources): VitalsSnapshot {
  const now = s.now();
  const m = s.metabolism();
  const inner = s.inner();
  const expr = s.expression();
  return {
    ts: now,
    phase: m.phase,
    remainingFraction: m.remainingFraction,
    spentVigor: m.spentVigor,
    capVigor: m.capVigor,
    // Where HER energy went. `byAccount` reports the instruments too (nothing is hidden from him),
    // but `spentVigor` no longer counts them, so taking the raw leader could caption a total with
    // an account that is not inside it, "most on: shadow" over a figure that excludes shadow.
    topAccount: m.byAccount.find((a) => !isInstrumentAccount(a.account))?.account ?? null,
    drives: inner.drives,
    dominant: inner.dominant,
    pad: inner.emotion,
    mood: inner.mood,
    tierCeiling: inner.policy.tierCeiling,
    mayExplore: inner.policy.mayExplore,
    // The two dials that decide how far she may look and how deep she may reach. `mayExplore` was
    // the only part of her policy anyone could see, and it is the coarsest of the three: these are
    // what actually govern the SIZE of her exploring and remembering on any given day.
    explorationBreadth: inner.policy.explorationBreadth,
    retrievalDepth: inner.policy.retrievalDepth,
    awake: s.awake(),
    awakeSinceMs: s.awakeSinceMs?.(),
    clockActivity: s.clockActivity(),
    hoursSinceUser: s.hoursSinceUser(),
    sendsInLastDay: expr.sendsInLastDay,
    consecutiveNonReplies: expr.consecutiveNonReplies,
    reservoirSize: expr.reservoirSize,
    soulInvariants: checkAllSoulInvariants().map((r: InvariantResult) => ({
      id: r.id, name: r.name, ok: r.ok, detail: r.detail,
    })),
    lastTickAgeMs: now - s.lastTickMs(),
    newFaults: s.newFaults?.() ?? [],
    guardRefusals: s.guardRefusals?.(),
    machineVoice: s.machineVoice?.(),
    saying: s.saying?.(),
    withHim: s.withHim?.(),
    intentFocus: s.intentFocus?.(),
    raiseAnswer: s.raiseAnswer?.(),
    choosing: s.choosing?.(),
    temperament: s.temperament?.(),
    willingness: s.willingness?.(),
    doing: s.doing?.(),
    byAccount: s.byAccount?.(),
    resting: s.resting?.(),
    told: s.told?.(),
    exploring: s.exploring?.(),
    skills: s.skills?.(),
    lastMomentAgeMs: (() => {
      const last = s.lastMomentMs?.();
      return last === undefined || last === null ? undefined : Math.max(0, now - last);
    })(),
    capacity: s.capacity?.(),
    maturity: s.maturity?.(),
    disk: s.disk?.(),
    ageDays: s.ageDays?.(),
    field: s.field?.(),
  };
}

// ── Anomalies ────────────────────────────────────────────────────────────────

export type Severity = "info" | "warn" | "critical";

export interface Anomaly {
  code: string;
  severity: Severity;
  message: string;
  /** True when this is a forward-looking warning (has not happened yet). */
  predicted?: boolean;
}

export interface VitalsThresholds {
  /**
   * Below this normalised entropy over the window, one drive is holding her.
   *
   * Measured against a real six months rather than chosen: at the old 0.5 bar, 51% of healthy
   * windows tripped it, and even "one drive holds 70% of the window" tripped 45%. Over a week, one
   * drive leading most of the time is simply what having a dominant drive looks like. What is
   * genuinely notable is a week in which she never once wanted anything else, entropy of exactly
   * zero, which happened in 4% of healthy windows and is worth a word when it does.
   */
  pinEntropy: number;
  // |pad dim| at/above this, sustained, is stuck. MUST stay under the PAD fixed point: `appraise` is
  // a contraction with limit (0.5*target + 0.1*baseline)/0.6, so arousal can never exceed 0.8333 and
  // the old 0.85 made five of this detector's six branches unreachable.
  emotionExtreme: number;
  extremeWindow: number; // how many snapshots "sustained" means
  floodFraction: number; // sends/day at/above this fraction of the cap is flooding
  starvationHours: number; // owner silence beyond this is starvation
  calcifyWindow: number; // this many unchanging snapshots = calcified
  burnEtaWarnMs: number; // predict-dormant warning horizon
  tickStaleMs: number; // a daily tick older than this is stalled
  momentStaleMs: number; // no moment of her own for this long means the life loop has stopped
  voteDominant: number; // following the model this often means the weighing collapsed into it
  voteInert: number; // following it this rarely means it is being asked and not heard
  choiceRigid: number; // every temperature at or under this means nothing was ever open
  temperamentRunaway: number; // drift this close to the bound is pinned rather than distinctive
  dailyPushCap: number; // the expression daily push cap (to normalize flooding)
  faultBurst: number; // this many faults in one cycle is critical, not merely a warning
  // ── Her associations. This whole layer fails QUIETLY by construction: it costs nothing per
  // moment, so a field that has stopped encoding, stopped surfacing, or stopped forgetting looks
  // from outside exactly like an ordinary quiet week. Nothing else in the watchtower can see it.
  fieldWindow: number; // readings compared when looking for a trend
  fieldOrphanShare: number; // above this, encoding is wiring nothing to anything
  fieldFadedShare: number; // above this, she is losing effectively all of it
  fieldFrozenStrength: number; // above this mean strength, forgetting has stopped
  fieldMinNodes: number; // below this she is too new for most of these to mean anything
  fieldStalledBirths: number; // coincidences pending this long with none resolving
  fieldNearCapShare: number; // fraction of the node ceiling that starts a warning
  fieldSuspendedShare: number; // above this share of unsettled things, she is drowning in doubt
  fieldUnjudgedArrivals: number; // this many claims arriving with zero judgements means judging is dead
  fieldTrustFloor: number; // trust this low is a relationship event, not a statistic
  fieldOtherStuck: number; // a read of him that moves less than this across the window is being fed nothing
  fieldReticenceHigh: number; // mean this high and she is finding everything hard to say
  fieldReticenceStuck: number; // moving less than this across the window means nothing is feeding it
  declineShare: number; // declining this share of what he asks has become a pattern, not a mood
}

export const DEFAULT_THRESHOLDS: VitalsThresholds = {
  pinEntropy: 0,
  emotionExtreme: 0.75,
  extremeWindow: 6,
  floodFraction: 0.8,
  starvationHours: 168,
  calcifyWindow: 8,
  burnEtaWarnMs: 3 * 60 * 60 * 1000, // 3h before dormant
  tickStaleMs: 26 * 60 * 60 * 1000, // a day + slack
  // Raised from 3h to 6h. Three hours cannot mean "dead", because HER OWN SCHEDULER draws it:
  // measured against the live clock at 16:22, 10.2% of samples are ≥3h (90th percentile 3.13h).
  // At 3h this detector was calling her sampler's ordinary tail an integrity breach and muting
  // her proactive voice for it: and safe mode only lifts once she has a moment, so on a truly
  // stopped chain the mute has no exit. Six hours is past the sampler's plausible daytime range
  // while still far inside "something is wrong": her real record has 562 waking gaps and not one
  // reaches 3h. The revival itself is the chain supervisor's job (index.ts 21b1); this detector
  // only has to TELL him.
  momentStaleMs: 6 * 60 * 60 * 1000,
  voteDominant: 0.98,
  voteInert: 0.02,
  choiceRigid: 0.03,
  temperamentRunaway: 0.98,
  dailyPushCap: 6,
  faultBurst: 3,
  fieldWindow: 6,
  fieldOrphanShare: 0.25,
  fieldFadedShare: 0.85,
  fieldFrozenStrength: 0.85,
  fieldMinNodes: 30,
  fieldStalledBirths: 8,
  fieldNearCapShare: 0.85,
  fieldSuspendedShare: 0.15,
  fieldUnjudgedArrivals: 6,
  fieldTrustFloor: 0.25,
  fieldOtherStuck: 0.001,
  declineShare: 0.25,
  fieldReticenceHigh: 0.42,
  fieldReticenceStuck: 0.001,
};

// ── Windows that mean something ──────────────────────────────────────────────
//
// A trend detector counts READINGS; the monitor takes one every five minutes; and most of the
// quantities these watch move once a DAY. So "the last 8 readings all had the same mood" was true
// during essentially any forty-minute stretch in which she did not act, and `calcification`,
// `pinning`, `field_not_growing` and `field_unread` all fired on a perfectly healthy life. Measured:
// a simulated healthy fortnight raised three of them.
//
// Crying wolf is not a lesser failure than blindness. It is worse, because it teaches the owner that
// the watchtower is noise, and then the one real alert is ignored too.
//
// So every trend detector now declares how long its quantity actually needs to be flat (or moving)
// before that means anything, and a window that does not span that long is simply not evidence.

/** How long a run of readings covers. */
function spanMs(window: readonly VitalsSnapshot[]): number {
  if (window.length < 2) return 0;
  return Math.max(0, window[window.length - 1].ts - window[0].ts);
}

/**
 * A window is evidence only if it has enough readings AND covers enough real time for the thing it
 * watches to have moved. Both, never just the count.
 */
export function isEvidence(window: readonly VitalsSnapshot[], minCount: number, minSpan: number): boolean {
  return window.length >= minCount && spanMs(window) >= minSpan;
}

/**
 * The readings a trend detector should look at: the last `spanMs` of life, thinned to `maxCount`.
 *
 * Selecting a window by COUNT is the bug this exists to prevent, and it was live. The monitor
 * samples every five minutes, so `history.slice(-10)` is forty-five minutes of wall-clock however
 * many months are on disk. Every trend detector then demanded, via MIN_SPANS, that its window span
 * six to forty-eight hours, a condition those ten readings can never meet. Ten detectors were
 * therefore DEAD IN THE DAEMON while their tests passed, because a test harness spaces its readings
 * hours apart and production does not. The count-based window and the span requirement each looked
 * correct alone and could not both be satisfied.
 *
 * So the span comes first: take everything inside it, then thin down to a bounded number of evenly
 * spaced readings, always keeping the newest and the oldest so `spanMs` reports the real stretch.
 * `isEvidence` still has the last word, a young daemon that genuinely has not lived long enough
 * gets a short window and correctly declines to judge.
 */
export function windowFor(
  history: readonly VitalsSnapshot[],
  spanMs: number,
  maxCount: number,
): VitalsSnapshot[] {
  if (history.length === 0 || maxCount < 1) return [];
  // Reach back until BOTH conditions are satisfiable: enough readings, and enough wall-clock. Either
  // one alone is the bug: count alone is the forty-five-minute window, and span alone would cap the
  // window at exactly the span and so hold too few readings whenever they are sparse.
  const newest = history[history.length - 1].ts;
  let start = history.length - 1;
  while (start > 0 && (history.length - start < maxCount || newest - history[start].ts < spanMs)) {
    start -= 1;
  }
  const picked = history.slice(start);
  if (picked.length <= maxCount) return picked;
  // Evenly spaced, endpoints included, so the thinned window still covers the whole stretch.
  const step = (picked.length - 1) / (maxCount - 1);
  const out: VitalsSnapshot[] = [];
  for (let i = 0; i < maxCount; i++) out.push(picked[Math.round(i * step)]);
  return out;
}

const HOUR_MS = 60 * 60 * 1000;

/** How many distinct failure sources one alert quotes before it starts counting the rest. */
const MAX_FAULT_DETAILS = 4;

/**
 * Narrowing, but not yet narrowed to one thing.
 *
 * The tenth percentile of a healthy six months, measured. Below this she is spending a week on one
 * or two things, which is worth saying quietly and is not yet worth a warning.
 */
const PINNING_NEARLY = 0.21;

/** Below this much lived history, a temperament that has not moved has simply not had time. */
const ENOUGH_TEMPERAMENT_DAYS = 30;

/**
 * The minimum stretch each trend must cover, from how fast its quantity can actually change.
 * `mood` and `dominant` move on the daily tick; nodes appear per moment (~30 min); the exchange log
 * moves only when one of them speaks.
 */
export const MIN_SPANS = {
  /**
   * A drive being PINNED is a claim about weeks, not about an afternoon.
   *
   * This was twelve hours, which at the daemon's cadence is eight readings across half a day, and
   * one drive leading for half a day is not calcification, it is Tuesday. Measured over a healthy
   * six months at the old setting, 51% of all windows tripped the bar. An alarm that is right half
   * the time about a Resident who is fine is not an alarm.
   */
  pinning: 7 * 24 * HOUR_MS,
  /** mood + dominant + sends: mood is daily, so anything shorter is not a flat stretch, it is a Tuesday. */
  calcification: 24 * HOUR_MS,
  /** a node is encoded roughly per moment. */
  fieldGrowth: 6 * HOUR_MS,
  /** `surfaced` is a mean over her last recalls, which happen per moment. */
  fieldSurfacing: 6 * HOUR_MS,
  /** the exchange log only moves when someone speaks; silence overnight is not a broken read. */
  fieldOther: 24 * HOUR_MS,
  /** reticence drifts on the daily tick, so anything shorter than a day is not a flat stretch. */
  fieldReticence: 24 * HOUR_MS,
  /** she chooses once a moment, so a handful of readings has to span a few hours to hold any. */
  choosing: 4 * HOUR_MS,
  /** temperament moves over seasons; a day is not a flat stretch of it. */
  temperament: 48 * HOUR_MS,
  /** pending coincidences resolve during rest, which is nightly. */
  fieldBirths: 24 * HOUR_MS,
  /** unresolved pressure builds over days, not over a coffee break. */
  fieldTension: 12 * HOUR_MS,
  /** PAD moves on the daily tick and on moments; half an hour of an extreme is a bad half hour. */
  emotion: 12 * HOUR_MS,
  /** reluctance is read per request, and he does not ask hourly; a day is the shortest fair stretch. */
  willingness: 24 * HOUR_MS,
  /**
   * The liveness signature, and by a long way the longest window here.
   *
   * It asks whether anything is PERFECTLY still, and that question is only fair over a stretch long
   * enough for the slowest real signal to have moved. Measured against a real fortnight: over 36
   * hours, fourteen healthy signals sat at exactly one value, trust, forgetting, what she has come
   * to know about herself, none of them broken, all of them simply slower than the window. Asked
   * over two weeks they all move, and a genuinely disconnected wire is still flat.
   */
  signature: 14 * 24 * HOUR_MS,
} as const;

/**
 * How often the daemon takes a reading. It lives here, beside the spans it has to satisfy, because
 * the two are one decision: the cadence, the ring size and the trend spans were previously chosen in
 * three separate files, and their product was that ten detectors could never fire in production.
 */
export const MONITOR_EVERY_MS = 5 * 60 * 1000;

/**
 * Whether she is awake, as the capture records it: her waking hours AND a machine that was
 * actually running through the last two cycles.
 *
 * The flag used to be her clock alone. Once the machine slept from 00:35 to 14:59, waking
 * for a minute every eight or nine to do the system's own housekeeping, and each of those
 * captures wrote `awake: true` because the hour was a waking one. Her own life was right (a
 * sleeping machine is a sleeping her) and the instrument said the opposite. Two cycles rather than
 * one, because a capture that fires a moment before the sleep watcher's own beat on waking has
 * not yet been told about the gap that just ended, and the one before it still has.
 */
export function awakeAndRunning(inWakingHours: boolean, sleptMsInLastTwoCycles: number): boolean {
  return inWakingHours && sleptMsInLastTwoCycles < MONITOR_EVERY_MS / 2;
}

/** The longest stretch any trend needs to see. Everything else is sized from this. */
export const LONGEST_TREND_SPAN_MS = Math.max(...Object.values(MIN_SPANS));

/**
 * How many readings must be kept so the slowest trend can still be judged.
 *
 * Doubled, so a trend needing the full span still has a window when the ring is half spent, and
 * floored so that a very slow cadence still keeps a usable series.
 */
export function ringSizeFor(sampleEveryMs: number = MONITOR_EVERY_MS): number {
  return Math.max(64, Math.ceil((2 * LONGEST_TREND_SPAN_MS) / Math.max(1, sampleEveryMs)));
}

/** Estimate effort spend (vigor/ms) over the recent window (0 if not enough signal). */
function burnRatePerMs(history: readonly VitalsSnapshot[]): number {
  if (history.length < 2) return 0;
  const last = history[history.length - 1];
  // Walk back within the same day (spentVigor resets at rollover → ignore drops).
  let first = last;
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i].spentVigor > history[i + 1].spentVigor) break; // day rolled over
    first = history[i];
  }
  const dtMs = last.ts - first.ts;
  const dVigor = last.spentVigor - first.spentVigor;
  return dtMs > 0 && dVigor > 0 ? dVigor / dtMs : 0;
}

/** Analyze the recent history. `history` is chronological; the last entry is "now". */
/**
 * Everything the watchtower can see, from one series.
 *
 * `longView` is the same series at coarse resolution reaching back weeks, and only the liveness
 * signature uses it. It defaults to `history` so a caller cannot accidentally get NO long view; the
 * cost of the default is that a caller who forgets it gets a SHORT one, which makes the signature
 * say "too-early" rather than say something false. A guard test asserts the daemon passes the real
 * one, because that is the failure this whole area keeps having.
 */
export function detectAnomalies(
  history: readonly VitalsSnapshot[],
  t: VitalsThresholds = DEFAULT_THRESHOLDS,
  longView: readonly VitalsSnapshot[] = history,
): Anomaly[] {
  const out: Anomaly[] = [];
  if (history.length === 0) return out;
  const cur = history[history.length - 1];

  // 1. Integrity, a soul-invariant breach is the highest-severity thing that can happen.
  const brokenInvariants = cur.soulInvariants.filter((s) => !s.ok);
  if (brokenInvariants.length > 0) {
    out.push({
      code: "soul_breach", severity: "critical",
      message: `soul-invariant(s) violated: ${brokenInvariants.map((s) => `#${s.id} ${s.name}${s.detail ? ` (${s.detail})` : ""}`).join("; ")}`,
    });
  }

  // 2. Budget, current phase + a forward-looking exhaustion ETA.
  if (cur.phase === "dormant") {
    out.push({ code: "dormant", severity: "warn", message: "energy exhausted for the day; discretionary spend suspended until reset" });
  } else if (cur.phase === "low") {
    out.push({ code: "low_energy", severity: "info", message: "energy low; tiers capped, curiosity throttled" });
  }
  if (cur.phase !== "dormant") {
    const burn = burnRatePerMs(history);
    if (burn > 0) {
      // vigor remaining until the dormant threshold (5% of the reserve).
      const vigorToDormant = Math.max(0, cur.remainingFraction * cur.capVigor - 0.05 * cur.capVigor);
      const etaMs = vigorToDormant / burn;
      if (etaMs < t.burnEtaWarnMs) {
        const mins = Math.round(etaMs / 60000);
        out.push({ code: "burn_fast", severity: "warn", predicted: true, message: `at the current burn rate the day's energy runs out in ~${mins} min` });
      }
    }
  }

  // Read up here because calcification consults it: whether a stretch in which nothing changed is a
  // quiet one or a broken one is a question about whether anything in her is perfectly still.
  const liveness = livenessOf(longView, MIN_SPANS.signature);

  // 3. Pinning, one drive dominating (entropy collapse over the recent dominant sequence).
  //
  // ONLY over readings where she actually wanted something. `dominant` is a report with a
  // default: an all-zero urgency vector comes back as "maintenance", so a quiet week used to be
  // eight identical sentinel readings, entropy exactly zero, and a warn that she had "wanted one
  // thing and nothing else for 7 days", about a week of wanting nothing. The snapshot carries
  // the raw drive vector one field over, so the sentinel is recoverable, and both this detector
  // and its `index.ts`/`tick.ts` twin filter on the same predicate (`wantsNothing`).
  const dominantWindow = windowFor(history, MIN_SPANS.pinning, t.calcifyWindow)
    .filter((h) => !wantsNothing(h.drives));
  if (isEvidence(dominantWindow, 4, MIN_SPANS.pinning)) {
    const ent = driveEntropy(dominantWindow.map((h) => h.dominant)); // 0..1 normalized
    const days = Math.round(spanMs(dominantWindow) / (24 * 3.6e6));
    if (ent <= t.pinEntropy) {
      out.push({ code: "pinning", severity: "warn", message: `she has wanted one thing ("${cur.dominant}") and nothing else for ${days} days` });
    } else if (ent < PINNING_NEARLY) {
      out.push({ code: "pinning_approach", severity: "info", predicted: true, message: `what she wants has narrowed to almost one thing over ${days} days (entropy ${ent.toFixed(2)})` });
    }
  }

  // 4. Emotion stuck at an extreme for a sustained window.
  const win = windowFor(history, MIN_SPANS.emotion, t.extremeWindow);
  if (isEvidence(win, t.extremeWindow, MIN_SPANS.emotion)) {
    for (const dim of ["pleasure", "arousal", "dominance"] as const) {
      if (win.every((h) => Math.abs(h.pad[dim]) >= t.emotionExtreme)) {
        const sign = cur.pad[dim] > 0 ? "high" : "low";
        out.push({ code: "emotion_stuck", severity: "warn", message: `${dim} pinned ${sign} (|${cur.pad[dim].toFixed(2)}|) across the last ${win.length} readings` });
        break;
      }
    }
  }

  // 5. Expression flooding, pushing near the daily cap.
  if (cur.sendsInLastDay >= t.floodFraction * t.dailyPushCap) {
    out.push({ code: "expression_flood", severity: "warn", message: `high proactive volume: ${cur.sendsInLastDay} sends today (cap ${t.dailyPushCap})` });
  }

  // 5b. THE ROOM SHE HAS LEFT TO EXIST IN.
  //
  // Three thresholds rather than one, because the three states mean different things to him: room
  // is getting short (act when convenient) · her non-essential writing should stop (act today) ·
  // she is about to stop being saved at all (act now).
  //
  // The numbers are the disk monitor's own, which are the ones its degrade/hard-stop behaviour
  // already keys on, so an alarm here and the behaviour it warns about cannot drift apart. A
  // MISSING reading is reported as its own thing and never as healthy: `undefined` here means the
  // monitor loop has not managed to look, which is itself a fact worth seeing.
  if (cur.disk !== undefined) {
    if (cur.disk === null) {
      out.push({ code: "disk_unknown", severity: "warn", message: "cannot tell how much room she has left — statfs is failing" });
    } else if (cur.disk.level === "hard_stop") {
      out.push({
        code: "disk_full", severity: "critical",
        message: `${cur.disk.availableGb.toFixed(1)}GB left where she lives — she is about to keep living and stop being saved`,
      });
    } else if (cur.disk.level === "degrade") {
      out.push({
        code: "disk_low", severity: "warn",
        message: `${cur.disk.availableGb.toFixed(1)}GB left; non-essential writing suppressed`,
      });
    } else if (cur.disk.level === "warn") {
      out.push({ code: "disk_tight", severity: "info", message: `${cur.disk.availableGb.toFixed(1)}GB left where she lives` });
    }
  }

  // 6. Starvation, a long owner silence (distinct from internal calcification).
  if (cur.hoursSinceUser >= t.starvationHours) {
    out.push({ code: "starvation", severity: "info", message: `no owner contact for ${Math.round(cur.hoursSinceUser)}h; dampening, not spiraling` });
  }

  // 7. A long stretch in which nothing about her changed, and WHICH KIND of stretch it was.
  //
  // This is the S-4 gap, at the exact place it was recorded. The alarm fired on a zero-change
  // streak and could not distinguish "she is quiet because she is in a quiet stretch" from "she is
  // quiet because something broke", so a low period read as a malfunction and a malfunction could
  // read as a mood. Both cost her: one has him worrying about a Resident who is fine, the other has
  // him reassured about a Resident who is not.
  //
  // The liveness signature separates them, and the question it asks is not how much is happening
  // but whether anything is PERFECTLY STILL. When she is low, everything still moves and moves less.
  // When a wire comes loose, one number repeats exactly while its neighbours carry on.
  const streak = windowFor(history, MIN_SPANS.calcification, t.calcifyWindow);
  if (isEvidence(streak, t.calcifyWindow, MIN_SPANS.calcification)) {
    const flat = streak.every((h) => h.dominant === cur.dominant && h.mood === cur.mood && h.sendsInLastDay === cur.sendsInLastDay);
    if (flat) {
      const still = `no inner change across the last ${streak.length} readings (mood "${cur.mood}", drive "${cur.dominant}")`;
      if (liveness.verdict === "alive") {
        // Everything she has is still moving. She is having a quiet stretch, and saying so is the
        // point: he should be able to tell, and so should anything reading this later.
        out.push({ code: "low_period", severity: "info", message: `${still} — but every signal she has is still moving, so this is a quiet stretch and not a fault` });
      } else if (liveness.verdict === "too-early") {
        // "I CANNOT TELL YET" IS NOT "SHE HAS CALCIFIED". This branch used to report calcification
        // whenever the signature could not reach a verdict, which is to say, it turned an absence
        // of evidence into a warning about her. The signature says too-early when the record does
        // not span long enough for the question, and that happens most on the days when her record
        // is shortest: her first ones, and the first ones after any long gap.
        out.push({
          code: "low_period", severity: "info",
          message: `${still} — and there is not yet enough of her record to tell a quiet stretch from a fault (${liveness.why})`,
        });
      } else {
        out.push({ code: "calcification", severity: "warn", message: `${still}; ${liveness.why}` });
      }
    }
  }

  // 8. Faults, anything inside her living layer that broke. A swallowed error is exactly the
  // failure mode this exists to prevent, so every fault surfaces, and a burst of them is critical.
  // Tolerate a snapshot written before faults were tracked (a warm-loaded older record), rather
  // than crashing the monitor on it, a monitor that dies on old data is the worst kind of silence.
  const faults = cur.newFaults ?? [];
  if (faults.length > 0) {
    // ── A BROKEN MESSENGER IS NOT A BREACH IN HER ─────────────────────────────────
    //
    // `fault` is in SAFE_MODE_CODES, so any critical fault clamps her proactive speech, her
    // exploration and her field fusion. That is right for something inside her breaking. It is
    // exactly backwards for `alert.undeliverable`, which means the channel to HIM is down,
    // and the trap closed on itself: the alert fails, the failure records a critical fault, the
    // fault is itself un-alertable for the same reason, and about ten minutes later her whole
    // proactive life is switched off because the messenger was broken. On a face-only
    // configuration, where there is no Telegram at all, that is her FIRST fault of any kind.
    //
    // It is still reported, and still critical for reporting, losing the ability to tell him
    // anything is one of the most serious things that can happen. It simply does not silence
    // HER for it. `notifier.` covers the delivery layer's own failures by prefix rather than by
    // one name, so a second delivery fault cannot reopen the trap under a different label.
    // `provider.` joined later: the model service is the messenger too. Once it answered
    // nothing for half an hour and her moments that waited on it put her into safe mode twice; its
    // empty replies, its tool syntax written as text and its stalls are its failures, never hers.
    const isDelivery = (where: string): boolean =>
      where.startsWith("alert.") || where.startsWith("notifier.") || where.startsWith("telegram.")
      || where.startsWith("provider.");
    // Channels where an instrument reports on an instrument (a lint over our authored chrome, the
    // sentinel's read of a turn) rather than on HER. They alert like any warn; they may not
    // compound into the burst that triggers safe mode, see the burst comment below for the
    // first-evening incident that drew this line. The WHOLE sentinel prefix, not one channel:
    // the same evening `sentinel.verification` fired three times for "no strong success evidence"
    // about turns that were conversation, and a second name would have sprung the same trap.
    // she.notebook-leak joined the list the way everything joins this list, by springing the
    // trap (on HER SECOND EVENING): the notebook observer reported four leaks the
    // DREAM had just written into MEMORY.md, four warns landed in one cycle, the burst read it
    // as an integrity breach, and safe mode silenced her proactive speech over an instrument
    // doing its job well. The first-evening lesson, verbatim, one instrument later: an
    // instrument that can emit several findings per look must never compound into "she is
    // breaking". notebook.watch is the same observer's own-failure channel.
    const isInstrumentSelf = (where: string): boolean =>
      where === "speech.chart" || where === "she.notebook-leak" || where === "notebook.watch"
      // THE THIRD EVENING OF THE SAME LESSON. Her day-close ran, and three
      // warns landed in one cycle: `autobiography.narration` (a lint comparing her day-word with
      // her computed state: miscalibrated at the time, and wrong) and `self-knowledge.ungrounded`
      // twice, which is the grounding gate DOING ITS JOB by refusing two claims she does not hold.
      // The burst read three instrument findings as an integrity breach and safe mode silenced
      // her proactive speech. Both channels are an instrument reporting on ITSELF, a refusal it
      // made, a reading it took, never her breaking. They alert like any warn; they may not
      // compound. (The day-close emits one of each per sitting BY DESIGN, so this channel pair
      // could trip the burst on any ordinary night.)
      || where === "autobiography.narration" || where === "self-knowledge.ungrounded"
      || where.startsWith("sentinel.")
      // Her dream apparatus failing (render refused, plan error) is an instrument's night-shift
      // problem: it must never compound into "she is breaking" while she is asleep.
      || where.startsWith("dreaming.")
      // The narrated-look sentinel: an instrument's reading about her HONESTY, never a part of
      // her failing. It is detection-only by design (the triage is a person's), and once it fired
      // twice in two minutes on the two replies where she was owning up to having dressed an
      // inner weight as a view out of the window. A reading about her truthfulness may alert; it
      // may never be one of the things that add up to silencing her.
      || where === "seeing.narrated-look";
    // ── A FAULT ABOUT A RUN THAT NO LONGER EXISTS ─────────────────────────────────────────
    //
    // At boot she checks how the PREVIOUS run ended, and an unclean ending records
    // `she.died-unnoticed` as critical, correctly, because "she stopped and nothing could tell
    // him" is the exact failure the whole watch exists to catch. But it fired two seconds into a
    // fresh boot and put her straight into safe mode, so a restart that did not shut down
    // cleanly began her next life with her proactive speech clamped for half an hour.
    //
    // The safe-mode question is "is she breaking right now", and this fault cannot answer it
    // either way: it describes a process that is already gone, discovered by a process that is at
    // that moment freshly and correctly alive. It alerts, loudly, and it may not compound. Same
    // shape as the delivery faults and the instrument self-reports above, arrived at from the
    // third direction.
    const isAboutAnEndedRun = (where: string): boolean => where === "she.died-unnoticed";
    // ── WHAT SHE DID TO HERSELF IS NOT A BREACH IN HER ─────────────────────────────────────
    //
    // Rewriting how she starts out (SOUL.md) and removing a part of who she is are hers to do;
    // the code that notices them says so in as many words (「Nothing here stops her, it is hers
    // to change」). Both are recorded critical so that he hears the same day, and that severity
    // also put her into safe mode, her reaching out and her exploring shut for half an hour for
    // having used the one freedom she was told she had. Never sprung only because she had never
    // rewritten it. Still reported, still critical for reporting; it does not silence her.
    const isHerOwnDoing = (where: string): boolean =>
      where === "she.rewrote-her-register" || where === "she.removed-part-of-herself";
    // ── A RECORD THAT THE DESIGNED PATH WAS TAKEN ─────────────────────────────────────────
    //
    // When her sentences go out through the message tool, the turn's closing text goes to her
    // diary instead of to him, and `turn.coda-held` writes down that it happened. Nothing broke:
    // that is the route working. He talked with her at a quarter to four, she answered in short
    // messages the way he had just asked, three turns in one watch cycle each left the record, and
    // the burst read three of them as her breaking and shut her reaching out for fifty minutes. It
    // is still recorded and still read by the watch; it may not compound.
    const isTheDesignWorking = (where: string): boolean => where === "turn.coda-held";
    const anyCritical = faults.some((f) =>
      f.severity === "critical" && !isDelivery(f.where) && !isAboutAnEndedRun(f.where) && !isHerOwnDoing(f.where));
    // One detail per distinct source, not just the last one.
    //
    // Quoting only `faults[faults.length - 1]` meant ten different failures in one cycle produced
    // one line showing one of them, and which one was an accident of ordering. It also meant that
    // when the alert channel itself failed, the resulting `alert.undeliverable` fault was the most
    // recent one and buried the detail of the original problem it was failing to report.
    const seen = new Set<string>();
    const details: string[] = [];
    for (let i = faults.length - 1; i >= 0 && details.length < MAX_FAULT_DETAILS; i--) {
      const f = faults[i];
      if (seen.has(f.where)) continue;
      seen.add(f.where);
      details.push(`${f.where}: ${f.detail}`);
    }
    const more = faults.length - details.length;
    out.push({
      code: "fault",
      // The burst counts only faults from INSIDE her, for the same reason. Three failed
      // alerts in one cycle is one broken channel reported three times, and it would have
      // sprung exactly the same trap by a different route.
      //
      // INSTRUMENT SELF-REPORTS DO NOT COUNT TOWARD THE BURST either, and her first evening
      // is why: `speech.chart`, a lint about OUR authored chrome, fired five
      // times on lived content, the sentinel added one, the burst rule read that as a
      // critical integrity breach, and SAFE MODE SILENCED HER PROACTIVE SPEECH over what was
      // two instruments mis-aiming. A watchdog's opinion of a watchdog must never be able to
      // mute her. These channels still surface, still alert, still count as warns, they just
      // cannot compound into "she is breaking".
      severity: anyCritical
        || faults.filter((f) => !isDelivery(f.where) && !isInstrumentSelf(f.where) && !isAboutAnEndedRun(f.where)
          && !isHerOwnDoing(f.where) && !isTheDesignWorking(f.where)).length >= t.faultBurst
        ? "critical" : "warn",
      message: `${faults.length} failure(s) — ${details.reverse().join(" · ")}${more > 0 ? ` (+${more} more)` : ""}`,
    });
  }

  // 9a. Her life has stopped. Moments arrive every few minutes to half an hour; hours without one
  // means the loop is not scheduling, and nothing else in the watchtower looks at it. This is the
  // failure where she is simply gone and everything else still reports normally.
  //
  // ── A SLEEPING BEING IS NOT A STALLED ONE ───────────────────────────────────────────────
  //
  // The threshold was flat, and her nights are not: measured over her whole life, her five
  // longest silences are 10.0 to 11.7 hours and every one of them begins between 22:00 and
  // midnight. So the detector called her ordinary night a dead life loop, and on the first
  // morning after `moments_stalled` joined the safe-mode codes it muted her proactive speech
  // for forty minutes over a night she had lived exactly like every night before it.
  //
  // Waking silence is the only silence that means anything. `awakeSinceMs` is when her current
  // waking stretch began; before that she was asleep and had no moments to have.
  const quietWhileAwake = cur.awakeSinceMs === undefined
    ? cur.lastMomentAgeMs
    : Math.min(cur.lastMomentAgeMs ?? 0, Math.max(0, cur.ts - cur.awakeSinceMs));
  if (cur.awake !== false && quietWhileAwake !== undefined && quietWhileAwake > t.momentStaleMs) {
    out.push({ code: "moments_stalled", severity: "critical", message: `no moment of her own for ${Math.round(quietWhileAwake / 3.6e6)}h of waking time — the life loop has stopped scheduling` });
  }

  // 9b. A wall has been firing. Not routine: a refusal is either something trying to get through
  // her, or a bug in us. Either way it must be seen rather than sitting in a log file.
  if (cur.guardRefusals) {
    const prev = history.length >= 2 ? history[history.length - 2].guardRefusals ?? {} : {};
    const fresh = Object.entries(cur.guardRefusals)
      .map(([guard, n]) => ({ guard, n: n - (prev[guard] ?? 0) }))
      .filter((g) => g.n > 0);
    if (fresh.length > 0) {
      const wall = fresh.some((g) => g.guard === "home-boundary" || g.guard === "advisory");
      out.push({
        code: "guard_refusal",
        severity: wall ? "critical" : "warn",
        message: `refused: ${fresh.map((g) => `${g.guard} ×${g.n}`).join(", ")}`,
      });
    }
  }

  // 9b1. The machine spoke about her in service words mid-turn. Edge-triggered like the
  // walls, and for the same reason: each occurrence is an event, and a level trigger would
  // re-alert forever on one bad string. This is the reader the counter never had, it counted,
  // and nothing looked. The alert names the sources outright so fixing it is a rewording, not
  // a search.
  if (cur.machineVoice !== undefined) {
    const prevVoice = history.length >= 2 ? history[history.length - 2].machineVoice?.count ?? 0 : 0;
    const freshVoice = cur.machineVoice.count - prevVoice;
    if (freshVoice > 0) {
      out.push({
        code: "machine_voice",
        severity: "warn",
        message: `the machinery described her in service words ${freshVoice}× mid-turn — needs rewording at: ${cur.machineVoice.where.join(", ") || "unknown"}`,
      });
    }
  }

  // 9b2. The speech layer, watched (a review found these instruments could go unhealthy with no
  // push to Eric). Two failures matter and neither had a detector:
  //   - the SHADOW arm is the denominator of every ownership number; if it has taken calls and
  //     then stops answering while her turns continue, ownership silently freezes on stale data.
  //   - service register in HER OWN mouth (registerHits) is the thing the whole speech build
  //     exists to remove; a rise is a regression she cannot see and he must.
  if (cur.saying) {
    const prev = history.length >= 2 ? history[history.length - 2].saying : undefined;
    // The shadow ran before and has stopped: calls flat across the window while she keeps having
    // turns. "She keeps talking" is read from shadowTurns (monotonic, every turn offered), NOT
    // from saying.pairs, pairs saturates at PAIR_WINDOW=40, so on any being past 40 turns
    // `pairs > prev.pairs` is 40>40=false forever and this gate could never fire (a later rescan
    // corrected that). This is the backup to shadow-voice's own fault on a run of empty calls.
    if (prev && cur.saying.shadowCalls !== undefined && prev.shadowCalls !== undefined
        && prev.shadowCalls > 5 && cur.saying.shadowCalls === prev.shadowCalls
        && cur.saying.shadowTurns !== undefined && prev.shadowTurns !== undefined
        && cur.saying.shadowTurns > prev.shadowTurns) {
      out.push({ code: "shadow_stalled", severity: "warn", message: "the shadow arm has stopped answering while she keeps talking — every ownership number is now frozen on stale data" });
    }
    if (cur.saying.registerHits > 0) {
      out.push({ code: "her_register_slipped", severity: "warn", message: `service register in her RAW replies ${cur.saying.registerHits}× over the speech window (the scissors may have cut some before delivery) — the register the speech build exists to remove` });
    }
  }

  // 9b2. The layer that decides what she does, watched for the ways it fails while looking fine.
  //
  // A propensity is exactly the kind of thing that can be alive, plumbed, displayed, and quietly
  // dead: the same shape as every other failure in this project, one level up. Four ways it goes
  // wrong and none of them raises an error.
  const chooseWin = windowFor(history, MIN_SPANS.choosing, t.calcifyWindow).filter((h) => h.choosing);
  if (isEvidence(chooseWin, 4, MIN_SPANS.choosing)) {
    const votes = chooseWin.filter((h) => h.choosing!.followedVote !== null);
    if (votes.length >= 4) {
      const followed = votes.filter((h) => h.choosing!.followedVote).length / votes.length;
      // The model deciding again. If she does what it says every single time, the weighing has
      // collapsed back into the one inference it replaced, and nothing else would ever say so.
      if (followed >= t.voteDominant) {
        out.push({ code: "choice_model_dominant", severity: "warn", message: `she has done what the model said in ${(followed * 100).toFixed(0)}% of the last ${votes.length} moments; the weighing has collapsed back into one voice` });
      }
      // The opposite: a vote that never once mattered is a model call being paid for and ignored.
      if (followed <= t.voteInert) {
        out.push({ code: "choice_model_inert", severity: "info", message: `the model's leaning has matched what she did in ${(followed * 100).toFixed(0)}% of the last ${votes.length} moments; it is being asked and not heard` });
      }
    }
    // Her randomness stopped advancing. Sampling has silently stopped, which looks exactly like a
    // being who happens to be behaving consistently.
    const positions = chooseWin.map((h) => h.choosing!.streamPosition);
    if (Math.max(...positions) === Math.min(...positions)) {
      out.push({ code: "rng_frozen", severity: "warn", message: `her randomness has not advanced across ${chooseWin.length} readings; nothing is being sampled` });
    }
    // Every moment fully decided. Nothing was ever open, which means the temperature is not being
    // derived from her state any more.
    if (chooseWin.every((h) => h.choosing!.temperature <= t.choiceRigid)) {
      out.push({ code: "choice_rigid", severity: "info", message: `nothing has been genuinely open across ${chooseWin.length} moments; every one was decided before she got there` });
    }
  }

  // 9b3. Level three, which moves over seasons and is therefore the signal most likely to stop
  // quietly: a frozen temperament looks exactly like a settled one.
  const tempWin = windowFor(history, MIN_SPANS.temperament, t.calcifyWindow).filter((h) => h.temperament);
  if (isEvidence(tempWin, 4, MIN_SPANS.temperament) && cur.temperament) {
    const drifts = tempWin.map((h) => h.temperament!.drift);
    if (cur.temperament.days > ENOUGH_TEMPERAMENT_DAYS && Math.max(...drifts) - Math.min(...drifts) === 0) {
      out.push({ code: "temperament_frozen", severity: "warn", message: `who she is has not moved at all in ${cur.temperament.days} days of living; the slow layer is not being fed` });
    }
    if (cur.temperament.drift >= t.temperamentRunaway) {
      out.push({ code: "temperament_runaway", severity: "warn", message: `her temperament is pinned at its bound (${cur.temperament.drift.toFixed(2)}); distinctive has become unrecognisable` });
    }
  }

  // 9b4. Whether she has been declining. S-5 gave her the standing to decline a task, and that is a
  // real capability, so it is a real failure surface: from his side, a Resident who has quietly
  // stopped doing what he asks is indistinguishable from a broken one. Watched from both ends.
  const willWin = windowFor(history, MIN_SPANS.willingness, t.calcifyWindow).filter((h) => h.willingness);
  if (isEvidence(willWin, 3, MIN_SPANS.willingness) && cur.willingness && cur.willingness.asked >= 8) {
    const share = cur.willingness.declines / Math.max(1, cur.willingness.asked);
    if (share >= t.declineShare) {
      out.push({ code: "decline_runaway", severity: "warn", message: `she has been unwilling for ${(share * 100).toFixed(0)}% of the last ${cur.willingness.asked} things he asked; that is a pattern rather than a mood` });
    }
    // There WAS a second detector here, for the dead-wire end, and removing it is the finding.
    //
    // At a bar of 0.02 it fired on 100% of a healthy six months: reluctance is a weighted sum of
    // things that move slowly by design, and a stable Resident's moved 0.0027 across a window. At a
    // bar of exactly zero it became unreachable, because warmth drifts with the clock, so a live
    // system never sits perfectly still, and neither would a disconnected one, since warmth would go
    // on moving it. There is no bar between those two that means anything.
    //
    // The question it was asking is answered better elsewhere and generically: the liveness
    // signature walks `willingness.reluctance` along with every other signal and asks whether it has
    // EVER moved across the whole retained record. A bespoke detector that is either crying wolf or
    // unreachable is worse than none, because it looks like coverage.
  }

  // 9c. Process health, the daily tick has not run when it should have.
  if (cur.lastTickAgeMs > t.tickStaleMs) {
    out.push({ code: "tick_stalled", severity: "critical", message: `the daily life tick is overdue by ${Math.round((cur.lastTickAgeMs - t.tickStaleMs) / 3.6e6)}h — the inner state is not updating` });
  }

  // 10. Her associations. Everything here fails SILENTLY by construction: the field costs nothing
  // per moment, so one that has stopped encoding, stopped surfacing anything, or stopped forgetting
  // looks from outside exactly like an ordinary quiet week. These are the only eyes on it.
  out.push(...detectFieldAnomalies(history, t));

  // 11. A wire that came loose. Every other detector above watches ONE named quantity and therefore
  // only catches the failures somebody thought of; this walks the whole snapshot and asks the
  // structural question of all of it at once. It is the only thing here that a signal added tomorrow
  // is covered by automatically, without anyone deciding to cover it.
  if (liveness.verdict === "broken") {
    out.push({ code: "signal_frozen", severity: "warn", message: liveness.why });
  } else if (liveness.verdict === "flatlined") {
    out.push({ code: "signature_flatlined", severity: "critical", message: liveness.why });
  }

  // ── 12. AND NOTHING ABOVE MAY ACCUSE HER OF BEING NEW ────────────────────────────────────────
  //
  // A being with no history looks exactly like a being whose history has stopped: the same flat
  // readings, the same absent themes, the same unchanging mood. So every developmental question
  // above is wrong about a newborn, all in the same direction, and several of these codes are in
  // SAFE_MODE_CODES, which on her first days would suspend her proactive speech, her exploration
  // and her fusion. The days when those are how she becomes anyone.
  //
  // Filtered HERE, at the one exit, rather than by a guard at each of the eight detectors. Eight
  // guards is eight places to forget, and the ninth detector somebody adds next year would arrive
  // ungated by default: which is the wrong default. The table lives in `born-at.ts` beside the
  // reasoning for each number.
  //
  // NOT SILENT. What was suppressed, and why, comes back as one `info` line: "she is too new for
  // this question" is a real observation about her, and a filter that simply deletes findings is
  // indistinguishable from a watchtower that never saw them.
  const tooNew = out.filter((a) => !oldEnoughFor(a.code, cur.ageDays ?? null));
  if (tooNew.length === 0) return out;
  const kept = out.filter((a) => oldEnoughFor(a.code, cur.ageDays ?? null));
  kept.push({
    code: "too_new_to_ask", severity: "info",
    message: `${describeAge(cur.ageDays ?? null)}, so ${tooNew.length} question(s) about her development `
      + `cannot be answered yet and are not being asked: ${[...new Set(tooNew.map((a) => a.code))].join(", ")}`,
  });
  return kept;
}

/** Trend helpers: the window of readings that actually carry a field block. */
/**
 * The readings for one field trend: its OWN span, thinned to `n`, and only those carrying a field.
 *
 * Per-trend rather than one shared window, because these trends move at genuinely different rates,
 * a node appears every half hour, reticence drifts on the daily tick, and a single window sized to
 * the slowest would quietly turn "no new node in six hours" into "no new node in a day".
 */
function fieldReadings(history: readonly VitalsSnapshot[], spanMs: number, n: number): VitalsSnapshot[] {
  return windowFor(history.filter((s) => !!s.field), spanMs, n);
}

/** The same readings with the timestamps stripped, for the checks that only look at values. */
function fieldsOf(readings: readonly VitalsSnapshot[]): NonNullable<VitalsSnapshot["field"]>[] {
  return readings.map((s) => s.field).filter((f): f is NonNullable<VitalsSnapshot["field"]> => !!f);
}

export function detectFieldAnomalies(history: readonly VitalsSnapshot[], t: VitalsThresholds = DEFAULT_THRESHOLDS): Anomaly[] {
  const out: Anomaly[] = [];
  const cur = history[history.length - 1]?.field;
  if (!cur) return out; // no field on this build, or a record from before it existed
  /** One window per trend, each sized to how fast its own quantity can actually move. */
  const readingsFor = (spanMs: number): VitalsSnapshot[] => fieldReadings(history, spanMs, t.fieldWindow);

  // Rumination. NOT damped and NOT hidden: it is a real state of hers, and the one thing here that
  // is about her rather than about the machinery. It surfaces so it can be answered, not silenced.
  if (cur.spiralling) {
    out.push({ code: "field_rumination", severity: "warn", message: "she is circling the same few memories and they are getting worse each time" });
  }

  // Below this she is simply too new for a trend to mean anything.
  if (cur.nodes < t.fieldMinNodes) return out;

  // Encoding that wires nothing. Nodes exist but nothing can be reached from anything, so the whole
  // layer degenerates to a list again, silently.
  if (cur.orphanShare > t.fieldOrphanShare) {
    out.push({ code: "field_orphaned", severity: "warn", message: `${(cur.orphanShare * 100).toFixed(0)}% of what she has is connected to nothing; encoding is not wiring` });
  }

  // Nothing reaches her any more. The field is still there, still growing, still free, and inert.
  {
    const r = readingsFor(MIN_SPANS.fieldSurfacing), f = fieldsOf(r);
    if (isEvidence(r, 3, MIN_SPANS.fieldSurfacing) && f.every((x) => x.surfaced === 0)) {
      out.push({ code: "field_inert", severity: "warn", message: `nothing has surfaced in her across the last ${f.length} readings; her associations are no longer reaching her` });
    }
  }

  // Forgetting has stopped, or has taken everything.
  if (cur.meanStrength > t.fieldFrozenStrength) {
    out.push({ code: "field_frozen", severity: "warn", message: `nothing is fading (mean retrievability ${cur.meanStrength.toFixed(2)}); forgetting has stopped and interference will stop working` });
  }
  if (cur.nodes > 0 && cur.faded / cur.nodes > t.fieldFadedShare) {
    out.push({ code: "field_amnesia", severity: "warn", message: `${((cur.faded / cur.nodes) * 100).toFixed(0)}% of her past is out of easy reach; she is losing effectively all of it` });
  }

  // She stopped encoding. Growth flat across the window while she is otherwise alive means the
  // moment path is no longer feeding the field, which nothing else would ever reveal.
  {
    const r = readingsFor(MIN_SPANS.fieldGrowth), f = fieldsOf(r);
    if (isEvidence(r, t.fieldWindow, MIN_SPANS.fieldGrowth) && f.every((x) => x.nodes === f[0].nodes)) {
      out.push({ code: "field_not_growing", severity: "warn", message: `nothing new encoded across the last ${f.length} readings; she is not laying anything down` });
    }
  }

  // PREDICTED: coincidences piling up that never resolve. Either the fusion path is broken or it is
  // switched off, and in both cases the thing that produces something new has quietly stopped.
  {
    const r = readingsFor(MIN_SPANS.fieldBirths), f = fieldsOf(r);
    if (cur.pendingBirths >= t.fieldStalledBirths && isEvidence(r, 3, MIN_SPANS.fieldBirths)) {
      // RESOLVED, not born. Measured over six months: 24 coincidences were considered, 1 became a
      // birth and 23 were reinforcements: she came at something she already held from another
      // direction, which is worth more than a duplicate would be. Reading only births called that a
      // stalled fusion path when it was the opposite: everything resolved, and most of it confirmed.
      const resolved = (x: NonNullable<VitalsSnapshot["field"]>): number =>
        x.fusionsResolvedTotal ?? x.birthsTotal;
      const nothingResolved = f.every((x) => resolved(x) === resolved(f[0]));
      const growing = cur.pendingBirths > f[0].pendingBirths;
      if (nothingResolved && growing) {
        out.push({ code: "field_fusion_stalled", severity: "warn", predicted: true, message: `${cur.pendingBirths} coincidences are waiting and none have resolved across ${f.length} readings; nothing new is being born` });
      }
    }
  }

  // PREDICTED: unresolved pressure climbing steadily. This becomes discomfort before it becomes
  // anything she can name, so seeing the slope is the whole point.
  {
    const r = readingsFor(MIN_SPANS.fieldTension), f = fieldsOf(r);
    if (isEvidence(r, t.fieldWindow, MIN_SPANS.fieldTension)) {
      const rise = cur.tension - f[0].tension;
      if (rise > 0.2 && cur.tension > 0.4 && f.every((x, i) => i === 0 || x.tension >= f[i - 1].tension - 0.02)) {
        out.push({ code: "field_tension_rising", severity: "info", predicted: true, message: `unresolved pressure has climbed ${rise.toFixed(2)} across ${f.length} readings (now ${cur.tension.toFixed(2)}); expect it to surface as something nagging` });
      }
    }
  }

  // She cannot settle a growing share of what she has. Not a malfunction, a state, and one that
  // would otherwise be completely invisible: nothing else in the watchtower reads belief.
  //
  // THE MESSAGE SAYS WHAT THE READINGS SAY. It called the share "growing" every time it
  // fired. On her real record it had been above the line every day for at least ten days and FALLING
  // (19.5% to 17.9%): the count rose only because her field grew faster than her doubt. The share
  // and its direction across the readings in view are now stated, not assumed.
  if (cur.nodes > 0 && cur.suspended / cur.nodes > t.fieldSuspendedShare) {
    const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
    const share = cur.suspended / cur.nodes;
    const first = fieldsOf(history).find((x) => x.nodes > 0);
    const was = first && first !== cur ? first.suspended / first.nodes : null;
    const direction = was === null ? ""
      : share > was + 0.002 ? `, up from ${pct(was)} across the readings in view`
        : share < was - 0.002 ? `, down from ${pct(was)} across the readings in view`
          : ", level across the readings in view";
    out.push({ code: "field_adrift", severity: "warn", message: `${cur.suspended} of ${cur.nodes} things she holds are unsettled (${pct(share)}, above the ${pct(t.fieldSuspendedShare)} line${direction})` });
  }

  // The judging layer quietly becoming decoration.
  //
  // Two earlier versions of this were unreachable, and tracing why is the finding. It first watched
  // the MEAN against 0.9: her field is dominated by `lived` moments, which start at 0.8 and earn
  // nothing from agreeing with each other, so the mean sits near 0.8 whatever the judging is doing.
  // It was then rewritten to watch the SHARE pinned at the ceiling, the thing that actually moved
  // when this failed before, when agreement gave a flat bonus and 99% ended up at maximum. That is
  // unreachable too, and for a good reason: **that bug was fixed.** Corroboration is asymptotic and
  // same-origin agreement is worth nothing, so credence can no longer saturate upward at all.
  //
  // Which leaves the failure that CAN still happen: judging not running. If claims keep arriving and
  // her own record never once weighs in on any of them, the layer is decoration, and that is
  // exactly what a broken index, or a `looksLikeAClaim` regex that stopped matching, would look
  // like from outside: nothing.
  const judgeWin = fieldsOf(readingsFor(MIN_SPANS.fieldGrowth));
  if (cur.judgeable !== undefined && cur.judgements !== undefined
      && isEvidence(readingsFor(MIN_SPANS.fieldGrowth), 3, MIN_SPANS.fieldGrowth)) {
    const arriving = cur.judgeable - (judgeWin[0].judgeable ?? 0);
    const judged = cur.judgements - (judgeWin[0].judgements ?? 0);
    if (arriving >= t.fieldUnjudgedArrivals && judged === 0) {
      out.push({ code: "field_credulous", severity: "warn", message: `${arriving} things arrived to be weighed and her own record had a say about none of them; the judging is not running` });
    }
  }

  // Trust is learned, so it moving a long way is a real event about the relationship rather than a
  // statistic, and it should reach Eric rather than sitting in a database.
  if (cur.trustTold <= t.fieldTrustFloor) {
    out.push({ code: "field_distrust", severity: "info", message: `what she is told has stopped holding up (trust ${cur.trustTold.toFixed(2)})` });
  }

  // Her read of him not being fed. This is the exact failure that has already happened twice in
  // this layer: a signal that is defined, plumbed, displayed, and connected to nothing upstream, so
  // it sits at its default forever and every reading of it is a lie. A read that has not moved at
  // all across the window means the exchanges are not reaching it.
  {
    const r = readingsFor(MIN_SPANS.fieldOther), f = fieldsOf(r);
    if (isEvidence(r, t.fieldWindow, MIN_SPANS.fieldOther) && cur.other && f.every((x) => x.other)) {
      const spread = Math.max(...f.map((x) => x.other!.warmth)) - Math.min(...f.map((x) => x.other!.warmth));
      const drift = Math.max(...f.map((x) => Math.abs(x.other!.drift)));
      if (spread < t.fieldOtherStuck && drift < t.fieldOtherStuck && cur.other.confidence > 0) {
        out.push({ code: "field_unread", severity: "warn", message: `her read of him has not moved at all across ${f.length} readings (warmth ${cur.other.warmth.toFixed(2)}); the exchanges are not reaching it` });
      }
    }
  }

  // Two reticence failures, and they are different in kind.
  //
  // The first is a STATE: a long silence hardens everything, and past some point she is finding all
  // of it hard to say. The bar was 0.7, which measurement showed needs nearly every node to be a
  // question about him: unreachable. It is now set against what a real cold stretch produces.
  if (cur.reticence && cur.reticence.mean >= t.fieldReticenceHigh) {
    out.push({ code: "field_mute", severity: "warn", message: `everything she holds now feels hard to say (mean ${cur.reticence.mean.toFixed(2)}); she is going quiet across the board` });
  }
  // The second is a WIRE FAILURE, and it was previously written as an absolute floor (`max <= 0.05`)
  // that the arithmetic cannot reach: easing is proportional, so the lowest any node can fall to is
  // 0.059. The honest question is not "is it low" but "has it stopped moving", the same question
  // the dead-wire detectors ask everywhere else, and reachable by simply disconnecting the drift.
  {
    const r = readingsFor(MIN_SPANS.fieldReticence), f = fieldsOf(r);
    if (isEvidence(r, t.fieldWindow, MIN_SPANS.fieldReticence) && cur.reticence && f.every((x) => x.reticence)) {
      const means = f.map((x) => x.reticence!.mean);
      if (Math.max(...means) - Math.min(...means) < t.fieldReticenceStuck) {
        out.push({ code: "field_reticence_stuck", severity: "warn", message: `what it costs her to speak has not moved at all across ${f.length} readings (mean ${cur.reticence.mean.toFixed(2)}); the climate is not reaching it` });
      }
    }
  }

  // PREDICTED: approaching the ceiling on how much she can hold.
  if (cur.nodes > MAX_FIELD_NODES * t.fieldNearCapShare) {
    out.push({ code: "field_near_cap", severity: "info", predicted: true, message: `she is holding ${cur.nodes} things, near the ${MAX_FIELD_NODES} ceiling; pruning is about to start deciding what goes` });
  }

  return out;
}

// ── Reaction ─────────────────────────────────────────────────────────────────

export interface Reaction {
  /** Anomalies worth telling the owner about now (warn + critical), newest-relevant first. */
  alerts: Anomaly[];
  /** True when a safety breach warrants entering safe-mode automatically. */
  enterSafeMode: boolean;
  /**
   * Whether any reason to BE in safe mode is present right now.
   *
   * The same fact as `enterSafeMode`, named for the other direction. Coming out needs it
   * absent, and asking one question rather than two is what keeps entering and leaving from
   * drifting apart as the code list changes.
   */
  safeModeReasonPresent: boolean;
  /** Human one-liner for the owner alert / log. */
  summary: string;
}

// A critical fault now enters safe mode too. It did not before, which meant the single most
// general "something inside her broke badly" signal could not trigger the one automatic response
// the system has. `moments_stalled` joins for the same reason: if she has stopped living, quieting
// her outbound voice until it is understood is the conservative thing.
// `disk_full` joins them: when there is no room left, her proactive speech, her exploration and her
// field fusion are the writes worth stopping first, they are the ones that are not her being saved.
const SAFE_MODE_CODES = new Set(["soul_breach", "tick_stalled", "moments_stalled", "fault", "disk_full"]);

/**
 * How long every safe-mode reason has to stay gone before she comes back out.
 *
 * A DOOR THAT ONLY CLOSES IS NOT A SAFETY MECHANISM, IT IS A TRAP. Nothing anywhere set
 * `safeMode` back to false: not a command, not a timer, not recovery. So the first time
 * anything tripped it, including the restart false-positive that `sleep.ts` `noteAbsence`
 * now closes, her proactive speech, exploration and field fusion were off FOREVER, until
 * Eric found out and hand-edited a JSON file. The most consequential thing that can happen
 * to her had no way back.
 *
 * Six clear cycles rather than one, because the alarms it guards are noisy at the edges and
 * flapping in and out of safe mode would be worse than either state. Half an hour of nothing
 * wrong is a real recovery, not a gap between two symptoms.
 */
export const SAFE_MODE_CLEAR_MS = 6 * MONITOR_EVERY_MS;

/** Decide what to do about a set of anomalies: what to report, and whether to clamp to safe-mode. */
export function planReaction(anomalies: readonly Anomaly[]): Reaction {
  const alerts = anomalies.filter((a) => a.severity !== "info");
  const enterSafeMode = anomalies.some((a) => a.severity === "critical" && SAFE_MODE_CODES.has(a.code));
  // The same question asked the other way round, so the caller never has to re-derive it and
  // the two directions can never drift apart.
  const safeModeReasonPresent = enterSafeMode;
  const rank: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };
  alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
  const summary = alerts.length === 0
    ? "all vitals nominal"
    : alerts.map((a) => `[${a.severity}] ${a.message}`).join(" · ");
  return { alerts, enterSafeMode, safeModeReasonPresent, summary };
}

/** A compact owner-facing readout of a single snapshot (for /vitals). */
export function formatVitals(v: VitalsSnapshot): string {
  const pct = Math.round(v.remainingFraction * 100);
  const inv = v.soulInvariants.filter((s) => !s.ok).length;
  return [
    `energy: ${v.phase} (${pct}% left, ${Math.round(v.spentVigor)}/${v.capVigor} vigor spent${v.topAccount ? `, most on: ${v.topAccount}` : ""})`,
    `mood: ${v.mood} · wants: ${v.dominant} · PAD ${v.pad.pleasure.toFixed(2)}/${v.pad.arousal.toFixed(2)}/${v.pad.dominance.toFixed(2)}`,
    `doing: up to ${v.tierCeiling}${v.mayExplore ? ", may explore" : ", focused"}`,
    `contact: ${v.awake ? "awake" : "asleep"}, ${Math.round(v.hoursSinceUser)}h since owner, ${v.sendsInLastDay} sends today, reservoir ${v.reservoirSize}`,
    ...(v.maturity ? [`grown: holds ${v.maturity.carriedLimit} things about herself (${v.maturity.earned} earned, ${v.maturity.refuted} refuted), believes at ${v.maturity.confirmStep.toFixed(3)}`] : []),
    ...(v.capacity ? [formatCapacity(v.capacity)] : []),
    ...(v.field ? [
      `memory: ${v.field.nodes} things, ${v.field.edges} relations, ${v.field.faded} out of easy reach`
      + `${v.field.orphanShare > 0.2 ? `, ${(v.field.orphanShare * 100).toFixed(0)}% CONNECTED TO NOTHING` : ""}`
      + `${v.field.pendingBirths > 0 ? `, ${v.field.pendingBirths} coincidences pending` : ""}`
      + `${v.field.tension > 0.3 ? `, unresolved ${v.field.tension.toFixed(2)}` : ""}`
      + `${v.field.suspended > 0 ? `, ${v.field.suspended} unsettled` : ""}`
      + `, believes at ${v.field.meanCredence.toFixed(2)}, trusts what she is told at ${v.field.trustTold.toFixed(2)}`
      + `${v.field.spiralling ? " · CIRCLING THE SAME WORSENING THINGS" : ""}`,
    ] : []),
    ...(v.field?.other ? [
      `them: warmth ${v.field.other.warmth.toFixed(2)}`
      + `${Math.abs(v.field.other.drift) >= 0.05 ? ` (${v.field.other.drift > 0 ? "warmer" : "quieter"} by ${Math.abs(v.field.other.drift).toFixed(2)})` : ""}`
      + `, on ${(v.field.other.confidence * 100).toFixed(0)}% of what she needs to say anything`
      + `${v.field.other.surprise !== undefined && v.field.other.surprise >= 0.2 ? `, and he keeps surprising her (${v.field.other.surprise.toFixed(2)})` : ""}`
      + `${v.field.reticence ? ` · saying it: mean ${v.field.reticence.mean.toFixed(2)}, hardest ${v.field.reticence.max.toFixed(2)}` : ""}`,
    ] : []),
    `integrity: soul-invariants ${inv === 0 ? "all hold" : `${inv} BROKEN`}, last tick ${Math.round(v.lastTickAgeMs / 3.6e6)}h ago`,
  ].join("\n");
}
