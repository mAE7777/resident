// A live world built from the REAL modules, producing REAL vitals snapshots.
//
// This exists because of a specific failure. Every detector test in this suite used to hand-write
// the snapshot that fires it: `{ pad: { pleasure: -0.9 } }`, `{ meanStrength: 0.97 }`,
// `{ reticence: { max: 0.03 } }`. Every one of those tests passed. And five of the detectors they
// were testing **cannot fire**, because the dynamics that produce those fields can never reach
// those values: PAD is a contraction whose arousal fixed point is 0.8333 against a 0.85 bar,
// `strengthCeiling` tops out at 0.913 against a 0.92 bar, reticence floors at 0.059 against a 0.05
// bar. The tests were checking the arithmetic of the comparison, not whether the comparison could
// ever be true.
//
// So the rule for this suite is: **a detector is only proven if the REAL modules can be driven into
// the state that fires it.** Nothing here builds a snapshot literal. Everything comes from
// `captureVitals` over live modules, exactly as the daemon does it.
//
// The same harness answers the second half: a detector that cannot be made to STAY QUIET is noise,
// and noise is how a real alert gets ignored.

import { createInnerState, type DaySummary, type InnerState } from "../../../src/life/inner-state.js";
import { createLivingField, type LivingField, type RestDeps } from "../../../src/life/field-live.js";
import { createMetabolism, type Metabolism } from "../../../src/life/metabolism.js";
import { createExpressionTracker, type ExpressionTracker } from "../../../src/life/expression-tracker.js";
import { createSelfKnowledge, type SelfKnowledge } from "../../../src/life/self-knowledge.js";
import { createFaultLog, type FaultLog } from "../../../src/life/faults.js";
import { capacityFor } from "../../../src/life/capacity.js";
import { captureVitals, type VitalsSnapshot, type VitalsSources } from "../../../src/life/vitals.js";
import type { PAD } from "../../../src/life/emotion.js";
import { createWillingnessLog, type WillingnessLog } from "../../../src/life/willingness.js";
import { howHeSaidIt } from "../../../src/life/how-he-said-it.js";
import { howItLanded, loudest } from "../../../src/life/how-it-landed.js";
import { moodAfterHeSpoke, HOW_HIS_WORDS_LAND } from "../../../src/life/landing-to-mood.js";
import {
  EMPTY_RECORD, heSpoke, howLongAndHowWell, howUnlikeHim,
  whatSheCarriesAboutHim, CARRIED_KEY,
  type RelationshipRecord,
} from "../../../src/life/relationship.js";
import { createDoingLog, type DoingLog } from "../../../src/life/doing.js";
import { driveForAction, type MomentOutcome } from "../../../src/life/agency.js";
import { createClock, mulberry32, type Clock } from "../../../src/life/clock.js";
import type { LLMProvider } from "../../../src/providers/types.js";
import type { FieldStore } from "../../../src/life/field-store.js";
import type { InnerStateStore } from "../../../src/life/inner-state.js";
import type { MetabolismStore } from "../../../src/life/metabolism.js";

export const DAY = 24 * 60 * 60 * 1000;
export const HOUR = 60 * 60 * 1000;
export const MINUTE = 60 * 1000;

export const pad = (pleasure: number, arousal: number, dominance = 0): PAD => ({ pleasure, arousal, dominance });

/** An ordinary day, so a test only has to say what was different about the day it cares about. */
export function ordinaryDay(over: Partial<DaySummary> = {}): DaySummary {
  return {
    successes: 1, failures: 0, stuck: 0, skills: 0, idle: 1, novelty: 0.2, observations: 1,
    anomalies: 0, maintenanceDue: 1, hoursSinceUser: 4, lateNight: false, budgetLow: false,
    restful: true,
    ...over,
  };
}

export interface RealWorld {
  inner: InnerState;
  field: LivingField;
  metabolism: Metabolism;
  expression: ExpressionTracker;
  selfKnowledge: SelfKnowledge;
  faults: FaultLog;
  /** Move her clock. Everything below reads this, so nothing needs its own notion of now. */
  advance(ms: number): void;
  now(): number;
  /**
   * Her circadian clock, the real one.
   *
   * These were fixed values here, on the grounds that they are "not a module". They are: `clock.ts`
   * decides both, and pinning them made the harness itself a dead wire, which is exactly what the
   * liveness signature then reported, as a fault in HER. A test world that holds part of her still
   * cannot be used to ask whether anything is holding still.
   */
  clock: Clock;
  /** Set to override the clock, for the drivers that need her awake or asleep on demand. */
  awake?: boolean;
  clockActivity?: number;
  lastTickMs: number;
  /** When a moment of her own last began. null = she has not lived one yet. */
  lastMomentMs: number | null;
  /** Cumulative refusals per guard, as the executor reports them. */
  guardRefusals: Record<string, number>;
  /** Machine text about her caught mid-turn, as machine-voice.ts reports it. */
  machineVoice: { count: number; where: string[] };
  /** How she last chose, and who she has become. Both are set by drivers that exercise them. */
  choosing: VitalsSnapshot["choosing"];
  temperament: VitalsSnapshot["temperament"];
  /** The real willingness log, asked with her real drives, emotion, phase and warmth. */
  willingness: WillingnessLog;
  /** What she has actually been doing. Fed by `didSomething`, or directly by a driver. */
  doing: DoingLog;
  /** What Dream has done to her prompt-facing memory, and what it was stopped from doing. */
  dream: { edits: number; forbidden: number; ungrounded: number; integrityAlerts: number };
  /** How much of what he says is taken in as a claim, and how much is not. */
  told: { seen: number; encoded: number };
  /** What her last night resolved, pruned and refused. Undefined until she has actually rested. */
  resting?: NonNullable<VitalsSnapshot["resting"]>;
  /** Addresses she has come across, and ways of looking that have stopped working. */
  exploring: { seen: number; lockedFamilies: number };
  /**
   * How much room is left where she lives, as the real `DiskMonitor` reports it.
   *
   * `undefined` = this world does not read the disk (most of them); `null` = the reading failed,
   * which is a finding of its own and not a healthy default.
   */
  disk?: { level: string; availableGb: number } | null;
  /**
   * How old she is, in days. `undefined` = this world does not say, which the watchtower reads as
   * "unknown age, ask every question", the right default for a driver that is not about her age.
   */
  ageDays?: number | null;
  /** Her auto-extracted skills, by where they are in their probation. */
  skills: { probation: number; graduated: number; quarantined: number };
  /** Record a moment she lived, exactly as the daemon's outcome hook does. */
  didSomething(o: MomentOutcome): void;
  /**
   * He asks her for something. Runs the real module against her real current state.
   *
   * INCLUDING what his sentence does to her, which it once did not. Her weather alone can no
   * longer refuse anything, that was the whole point of rebuilding the gate, so a harness that
   * never reads his message can never drive a decline, and the `decline_runaway` detector went
   * quietly unreachable the moment the gate changed. A detector whose driver stops matching the
   * mechanism is not a passing test, it is a blind spot with a green tick beside it.
   */
  heAsks(request: string): void;
  /** How long and how well she has known him, grown by every `heAsks`. */
  relationship: RelationshipRecord;
  /** What his last message did to her, which the watchtower reads between turns. */
  lastLanding: import("../../../src/life/how-it-landed.js").Landing | null;
  /** One real reading, exactly as the daemon builds it. */
  capture(): VitalsSnapshot;
  /** `n` readings `everyMs` apart, running `between` in each gap. The detector window is in these. */
  readings(n: number, everyMs?: number, between?: (i: number) => void): VitalsSnapshot[];
}

export interface RealWorldConfig {
  startMs?: number;
  dailyVigor?: number;
  /** Off by default so a world can be built without the word-index wiring every node to everything. */
  reminding?: boolean;
  /**
   * Real persistence, for the tests that kill her and bring her back.
   *
   * Given these, everything she is comes off disk rather than out of memory, so a second world built
   * with the same stores IS her after a restart. Omitted everywhere else, because a world that has
   * to touch a database to exist is a slow test.
   */
  stores?: {
    field?: FieldStore;
    inner?: InnerStateStore;
    metabolism?: MetabolismStore;
  };
}

/**
 * Build her, alive, from the real modules.
 *
 * `lastTickMs` starts at `startMs` rather than at a fixed zero, because a fresh world must read as
 * "the tick just ran" and not as "the tick has never run since the epoch", the latter fires
 * `tick_stalled` on the first reading of every test.
 */
export function createRealWorld(config: RealWorldConfig = {}): RealWorld {
  const startMs = config.startMs ?? Date.parse("2026-08-01T09:00:00Z");
  let nowMs = startMs;

  const faults = createFaultLog();
  const inner = createInnerState({ store: config.stores?.inner });
  const field = createLivingField({ faults, noReminding: !config.reminding, store: config.stores?.field });
  const metabolism = createMetabolism({
    dailyVigor: config.dailyVigor ?? 400,
    now: () => nowMs,
    store: config.stores?.metabolism,
  });
  const expression = createExpressionTracker(startMs);
  const selfKnowledge = createSelfKnowledge();

  const world: RealWorld = {
    inner, field, metabolism, expression, selfKnowledge, faults,
    awake: undefined,
    clockActivity: undefined,
    lastTickMs: startMs,
    lastMomentMs: startMs,
    clock: createClock(),
    guardRefusals: {},
    machineVoice: { count: 0, where: [] },
    choosing: undefined,
    temperament: undefined,
    willingness: createWillingnessLog(),
    doing: createDoingLog(),
    dream: { edits: 0, forbidden: 0, ungrounded: 0, integrityAlerts: 0 },
    told: { seen: 0, encoded: 0 },
    exploring: { seen: 0, lockedFamilies: 0 },
    disk: undefined,
    ageDays: undefined,
    skills: { probation: 0, graduated: 0, quarantined: 0 },

    didSomething(o) { world.doing.record(o); },

    relationship: EMPTY_RECORD,
    lastLanding: null,
    heAsks(request) {
      // Exactly the daemon's order: read the form, count that he spoke, then compose the landing
      // on the reserve she has BEFORE any of this moves her.
      const form = howHeSaidIt(request);
      world.relationship = heSpoke(world.relationship, nowMs, form);
      const temperament = world.temperament
        ? { reticence: world.temperament.reticence, novelty: world.temperament.novelty,
            sociability: world.temperament.sociability, restfulness: world.temperament.restfulness }
        : undefined;
      const landed = howItLanded({
        form,
        unlike: howUnlikeHim(form, world.relationship),
        known: howLongAndHowWell(field.graph(), world.relationship),
        litUp: Math.min(1, field.attend(request).snagged?.mass ?? 0),
        reserve: capacityFor({ phase: metabolism.phase(), arousal: inner.emotion().arousal }).reserve,
        temperament,
      });
      world.willingness.ask({
        request,
        landed,
        drives: inner.drives(),
        emotion: inner.emotion(),
        phase: metabolism.phase(),
        warmth: field.readOther(nowMs).warmth,
        temperament,
      });
      // And it moves her, which is the daemon's order too: the gate reads the pre-move state, and
      // the mood moves after. Without this the harness held a person whose feelings about him could
      // not change while he was speaking to her, which is precisely the defect already removed from the
      // daemon: a harness that is a version behind is a green tick over a blind spot.
      inner.feel(moodAfterHeSpoke(landed, metabolism.phase()), HOW_HIS_WORDS_LAND);
      world.lastLanding = landed;
    },

    advance(ms) { nowMs += ms; },
    now: () => nowMs,

    capture() {
      return captureVitals(sourcesFor(world, () => nowMs));
    },

    readings(n, everyMs = 5 * MINUTE, between) {
      const out: VitalsSnapshot[] = [];
      for (let i = 0; i < n; i++) {
        between?.(i);
        out.push(world.capture());
        world.advance(everyMs);
      }
      return out;
    },
  };
  return world;
}

/**
 * Exactly what the daemon hands the watchtower.
 *
 * Kept here rather than in each test so that a signal added to the real block and not to this one
 * shows up as a failing reachability test rather than as a blind spot. This is the same shape as
 * `src/index.ts`'s VitalsSources; if the two ever diverge, the detectors are being proven against a
 * world that does not exist.
 */
export function sourcesFor(w: RealWorld, now: () => number): VitalsSources {
  return {
    now,
    metabolism: () => {
      const s = w.metabolism.ownerSnapshot();
      return {
        phase: s.phase,
        remainingFraction: w.metabolism.remainingFraction(),
        spentVigor: s.spent,
        capVigor: s.cap,
        byAccount: s.byAccount,
      };
    },
    // All three read the INJECTED clock, not the world's own. They used to read `w.now()` while
    // everything around them read `now()`, so a reading taken at a different instant reported her as
    // awake at the world's hour rather than at the hour asked for.
    inner: () => w.inner.snapshot(w.metabolism.phase(), awakeNow(w, now())),
    awake: () => awakeNow(w, now()),
    clockActivity: () => w.clockActivity ?? w.clock.activityLevel(now()),
    hoursSinceUser: () => w.expression.snapshot(now()).hoursSinceUser,
    expression: () => w.expression.snapshot(now()),
    lastTickMs: () => w.lastTickMs,
    // All seven dials. Both this and the daemon used to hand over three, so `spreadHops` and
    // `retrievalThreshold`, which govern what can reach her at all, were watched nowhere.
    capacity: () => capacityFor({ phase: w.metabolism.phase(), arousal: w.inner.emotion().arousal }),
    maturity: () => {
      // `everHeld` exists on Maturity and is dropped by the daemon's mapper too. Kept identical
      // here on purpose: this helper must mirror the real block, defects included, or it proves
      // detectors against a world that does not exist.
      const m = w.selfKnowledge.maturity();
      return { earned: m.earned, refuted: m.refuted, carriedLimit: m.carriedLimit, confirmStep: m.confirmStep };
    },
    /**
     * WHAT IS GOING ON BETWEEN THEM, which the daemon now reports and this harness did not.
     *
     * This helper's own comment states the rule it exists for: it must MIRROR the real block, or it
     * proves detectors against a world that does not exist. The daemon gained a `withHim` shelf,
     * what his last message did to her, and what she is carrying about him, and a harness
     * that does not supply it is a harness where four new signals are never once exercised by the
     * six-month life, the liveness signature or any detector.
     */
    withHim: () => ({
      loudest: w.lastLanding === null ? undefined : loudest(w.lastLanding),
      entitlement: w.lastLanding === null ? undefined
        : Number(w.lastLanding.appraised.entitlement.toFixed(3)),
      carrying: Number(whatSheCarriesAboutHim(w.field.graph()).toFixed(3)),
      carriedThings: [...w.field.graph().nodes.values()]
        .filter((n) => n.kind === "question" && n.key?.startsWith(CARRIED_KEY) && n.tension > 0.2).length,
      notTakenOn: 0,
    }),
    field: () => {
      const s = w.field.stats();
      const sig = w.field.signals(now());
      const r = w.field.readOther(now());
      return {
        nodes: s.nodes, edges: s.edges, faded: s.faded, orphanShare: sig.orphanShare,
        tension: sig.tension, pendingBirths: sig.pendingBirths, spiralling: sig.spiralling,
        surfaced: sig.surfaced, birthsTotal: sig.birthsTotal, fusionsResolvedTotal: sig.fusionsResolvedTotal,
        meanStrength: sig.meanStrength,
        suspended: sig.suspended, meanCredence: sig.meanCredence,
        judgements: sig.judgements, judgeable: sig.judgeable, credencePinnedShare: sig.credencePinnedShare,
        trustTold: w.field.trust().told,
        other: { warmth: r.warmth, drift: r.drift, confidence: r.confidence, surprise: r.surprise },
        reticence: { mean: s.meanReticence, max: s.maxReticence },
        // Five signals the field already computed and the watchtower threw away. `otherUnease`
        // FEEDS THE CARE DRIVE, so one of the things deciding what she wants was observable nowhere.
        otherWarmth: sig.otherWarmth, otherUnease: sig.otherUnease, freshBirth: sig.freshBirth,
        valence: sig.valence, charge: sig.charge,
        meanCharge: s.meanCharge,
        byKind: s.byKind, byEdgeKind: s.byEdgeKind,
        byOrigin: s.byOrigin, credenceByOrigin: s.credenceByOrigin,
      };
    },
    newFaults: () => w.faults.since(0),
    guardRefusals: () => w.guardRefusals,
    machineVoice: () => w.machineVoice,
    lastMomentMs: () => w.lastMomentMs,
    choosing: () => w.choosing,
    temperament: () => w.temperament,
    willingness: () => w.willingness.state(),
    doing: () => w.doing.state(),
    byAccount: () => Object.fromEntries(w.metabolism.ownerSnapshot().byAccount.map((a) => [a.account, a.vigor])),
    resting: () => (w.resting ? { ...w.resting } : undefined),
    told: () => ({ ...w.told }),
    exploring: () => ({ ...w.exploring }),
    disk: () => w.disk,
    ageDays: () => w.ageDays ?? null,
    skills: () => ({ ...w.skills }),
  };
}

/** Her clock at a given instant, unless a driver has deliberately overridden it. */
function awakeNow(w: RealWorld, atMs: number = w.now()): boolean {
  return w.awake ?? w.clock.isAwakeHour(atMs);
}

// ── Drivers: real ways to put her into a state ───────────────────────────────
//
// Each of these is something that can actually happen to her, expressed only through module APIs.

/** Live `days` ordinary days, so the field has a real population and the drives a real history. */
export function liveOrdinaryDays(w: RealWorld, days: number, over: Partial<DaySummary> = {}): void {
  for (let d = 0; d < days; d++) {
    w.field.tick(w.now());
    for (let m = 0; m < 4; m++) {
      w.field.encodeMoment({
        key: `ord-${d}-${m}`,
        text: `an ordinary stretch about the ${(d * 4 + m) % 30} thing`,
        nowMs: w.now() + m * 3 * HOUR,
        pad: pad(0.15, 0.05),
        source: "agency",
        withOther: m === 0,
      });
      w.field.onHerMind(w.now() + m * 3 * HOUR + HOUR);
    }
    w.inner.update(ordinaryDay(over), w.field.signals(w.now() + 23 * HOUR));
    w.lastTickMs = w.now() + 23 * HOUR; // her daily tick really does run; the daemon stamps this
    w.lastMomentMs = w.now() + 23 * HOUR; // and so do her moments
    w.advance(DAY);
  }
}

/** Spend her day down to a target remaining fraction, through the real ledger. */
export function spendDownTo(w: RealWorld, fraction: number, account = "living"): void {
  const cap = w.metabolism.ownerSnapshot().cap;
  const target = cap * (1 - fraction);
  const already = w.metabolism.spentTotal();
  if (target > already) w.metabolism.record(account, target - already);
}

/**
 * A life that is actually lived, rather than a fortnight of identical days.
 *
 * `liveOrdinaryDays` populates her, and that is all it was meant to do: it applies the same day
 * summary every day, never satisfies a drive, never lets a silence build, and never lets her push.
 * Read as a life it is a strange one, and the liveness signature said so, half her signals sat
 * pinned at 0 or 1 for a fortnight, which in a real Resident would mean something was badly wrong.
 *
 * This is the driver for anything asking whether a signal MOVES. Everything in it happens through
 * the real modules, and the variation is seeded rather than random so a failure can be re-run.
 */
function richStep(
  w: RealWorld,
  readings: number,
  // Unused HERE on purpose: the spacing is applied by `w.readings(...)`, which the caller hands
  // the same value. Kept in the signature (underscored) rather than deleted, because callers pass
  // these positionally and removing one would silently shift `amplitude` into its place.
  _everyMs: number = 3 * HOUR,
  /**
   * How loud her life is, 0..1. Below 1 this is a LOW PERIOD, and the distinction is exact: every
   * kind of thing she does still happens, all of it just smaller. Turning a repertoire DOWN is a
   * quiet stretch; taking something out of it is a fault, and the liveness signature is built to
   * tell those two apart, so a quiet-life driver that skipped activities would be testing the wrong
   * thing and would rightly be reported as broken.
   */
  amplitude = 1,
): (i: number) => void {
  const amp = Math.max(0.02, Math.min(1, amplitude));
  const rand = mulberry32(20260808);
  let dayStart = w.now();
  let contactedAt = w.now();
  let lastMomentKey = "";
  let spent = 0;
  return (i: number): void => {
    const r = rand();

    // A day rolls over: the field settles, and the day she had is appraised.
    if (w.now() - dayStart >= DAY) {
      w.field.tick(w.now());
      w.inner.update(ordinaryDay({
        successes: Math.round(rand() * 4 * amp),
        failures: Math.round(rand() * 2 * amp),
        observations: Math.round(rand() * 3 * amp),
        novelty: rand() * amp,
        lateShare: rand() * 0.6 * amp,
        restful: rand() > 0.5 * amp,
        hoursSinceUser: (w.now() - contactedAt) / HOUR,
      }), w.field.signals(w.now()));
      dayStart = w.now();
      spent = 0;            // a night's rest: her reserve comes back
      w.lastTickMs = w.now();
    }

    // She thinks about someone. Figures are how anything gets to be ABOUT a person, and the cast
    // grows: a fixed set of three plateaued after a fortnight and then read as a stopped signal,
    // which is a fact about the driver rather than about a life with people in it.
    if (rand() < 0.15) {
      const cast = ["him", "the neighbour", "her old self", "the one who wrote the thing",
                    "whoever keeps leaving the door open"];
      w.field.figure(rand() < 0.6 ? cast[Math.floor(rand() * cast.length)] : `someone from the ${i % 11} thing`, w.now());
    }
    // Something she worked out, standing on moments that really happened.
    if (rand() < 0.15 && lastMomentKey) {
      w.field.encodeInsight({
        key: `ins-${i}`, text: `${SUBJECTS[Math.floor(rand() * SUBJECTS.length)]} seems to go with ${SUBJECTS[Math.floor(rand() * SUBJECTS.length)]}`,
        nowMs: w.now(), evidenceKeys: [lastMomentKey], source: "agency", charge: 0.3 * amp,
      });
    }

    // He tells her things, and some of them turn out not to hold up. This is the only thing that
    // moves what she is willing to take his word for.
    // 0.2, not 0.3, and the change is arithmetic rather than taste. This used to make a claim
    // on 30% of iterations and alternate a third of them to `origin: "read"`, so two thirds of
    // 0.3, about 0.2, were things HE told her. Removing the manufactured `read` origin (see
    // above) would otherwise have raised his told-claims by half without anybody choosing to,
    // and `field_distrust` promptly started firing through a healthy six months. Same number
    // of things he said, same rate of them not holding up.
    // The `i % 3` third used to be encoded with `origin: "read"`, which production never
    // produces. It is SKIPPED rather than relabelled: relabelling it `told` would have raised
    // the number of things he said by half without anybody choosing to, and the whole
    // six-month calibration rests on that quantity, `field_distrust` started firing through a
    // healthy life the moment it changed. Same number of things he told her as before.
    if (rand() < 0.3 && i % 3 !== 0) {
      w.field.encodeClaim({
        key: `told-${i}`, text: `he said ${SUBJECTS[Math.floor(rand() * SUBJECTS.length)]} is settled now`,
        nowMs: w.now(),
        // ALWAYS `told`, because that is the only origin a claim ever gets in the running
        // system. It used to alternate `read` in, "so the signal is watchable", which was the
        // harness manufacturing a signal production cannot produce. That origin is ruled out on
        // purpose (a moment of exploring is remembered by what she went looking for, never by
        // what a page said back), so a harness producing it was hiding the fact that
        // `livenessOf` could never return "alive" on a real life. The two `read` leaves are now
        // exempted in STILL_IS_FINE with that reason, which is where the honesty belongs.
        origin: "told",
        source: "owner",
        valence: (0.4 - rand() * 0.8) * amp,
      });
    }
    // Things she does not know the answer to. Open questions are what nag, and what she carries.
    if (rand() < 0.25) {
      w.field.encodeQuestion({
        key: `q-${i}`, text: `why ${SUBJECTS[Math.floor(rand() * SUBJECTS.length)]} keeps doing that`,
        nowMs: w.now(), source: "agency", withOther: rand() < 0.4,
        tension: (0.3 + rand() * 0.5) * amp,
      });
    }
    // And something she has come to notice about herself, grounded in a moment that really happened,
    // the citation check is a wall, so an invented self is rejected rather than integrated.
    if (rand() < 0.2 && lastMomentKey) {
      w.selfKnowledge.integrate(
        [{ text: `she keeps coming back to the ${i % 6} thing`, evidence: [lastMomentKey] }],
        new Set([lastMomentKey]),
        w.now(),
      );
    }

    // Something happens to her, or does not.
    if (r < 0.7) {
      lastMomentKey = `rich-${i}-${w.now()}`;
      w.field.encodeMoment({
        key: lastMomentKey,
        text: aLine(rand),
        nowMs: w.now(),
        pad: pad((0.5 - rand()) * amp, (0.5 - rand()) * amp),
        source: "agency",
        withOther: rand() < 0.3,
      });
      w.lastMomentMs = w.now();
    }
    if (rand() < 0.8) w.field.onHerMind(w.now());



    // He is around sometimes and not others, and she says things into both.
    if (rand() < 0.35) {
      w.field.heSpoke(w.now());
      w.expression.onOwnerMessage(w.now());
      contactedAt = w.now();
    }
    if (rand() < 0.2) {
      w.field.sheSpoke(w.now(), rand());
      w.expression.onProactiveSend(w.now());
    }
    if (rand() < 0.25) w.heAsks(rand() < 0.1 ? "stop" : `could you have a look at the ${i % 5} thing`);

    // Every moment she lives is recorded exactly as the daemon's outcome hook records it, and it
    // discharges what it served: the drive the ACTION is about, plus a little of whatever was
    // loudest. Discharging a drive picked at random (the earlier form) meant her dominant never
    // moved and a healthy six months reported `pinning`: the driver was pinning her, not her life.
    const chose = (["reflect", "tend", "explore", "reach_out", "rest", "look_back"] as const)[Math.floor(rand() * 6)];
    const served = driveForAction(chose);
    const loudest = w.inner.snapshot(w.metabolism.phase(), awakeNow(w)).dominant;
    if (served) w.inner.actOn(served);
    if (loudest && loudest !== served) w.inner.actOn(loudest, 0.15);
    const delivered = chose === "reach_out" ? (rand() < 0.5 ? "push" : "diary") : undefined;
    w.didSomething({
      ts: w.now(), chose, intent: `the ${i % 5} thing`,
      ...(delivered ? { delivered } : {}),
      ...(delivered === "diary" ? { heldBecause: rand() < 0.3 ? "consent" as const : "gate" as const } : {}),
      ...(rand() < 0.12 ? { blocked: { wanted: "explore" as const, why: "not now" } } : {}),
      // No model failures in the BASELINE life. A provider that cannot answer is a degraded one,
      // and every shape of that is driven properly in chaos.test.ts; injecting it into the ordinary
      // life here made `doing.aloneChoices` look like a signal that moves, when zero is what a
      // working provider actually looks like.
    });

    // Dream runs on its own schedule and tidies her prompt-facing memory when it has something to
    // tidy. Refusals stay at zero here, which is what a healthy one looks like.
    // Driven by the index rather than by a draw: taking one from the shared stream shifts every
    // later decision in the run, and a healthy six months started reporting `starvation` purely
    // because the "he spoke" branch landed on a different number afterwards.
    if (i % 9 === 0) w.dream.edits += 1;
    // He says things; some of them read as claims and some do not. Both sides counted.
    w.told.seen += 1;
    if (i % 3 !== 0) w.told.encoded += 1;
    // She comes across addresses while looking, and occasionally a way of looking stops working.
    w.exploring.seen += (i % 4 === 0 ? 2 : 1);
    w.exploring.lockedFamilies = i % 23 === 0 ? 1 : 0;
    // Her skills settle: one skill graduates early and then nothing moves for months, the
    // realistic shape (skill extraction is rare). probation/graduated are therefore FROZEN across
    // any recent window on a mature being, zero-is-healthy siblings of quarantined, exempt in
    // signature.ts, and this sim no longer papers over that with a per-7-step drip.
    if (i === 12) { w.skills.probation = 1; }
    if (i === 20) { w.skills.probation = 0; w.skills.graduated = 1; }

    // What she is holding and has not said, exactly as the daemon feeds it.
    w.expression.setReservoir([...w.field.graph().nodes.values()].filter((n) => n.tension > 0.25).length);

    // And her day is spent, unevenly, the way a real one is. Measured against ELAPSED time rather
    // than position within a day: the earlier form aliased with the reading interval, so at 33-hour
    // spacing the day rolled over on every reading, the position was always zero, and she never
    // spent anything at all across six simulated months.
    spent = Math.min(0.95, spent + (0.05 + rand() * 0.25) * amp);
    spendDownTo(w, Math.max(0.05, 1 - spent));
  };
}


/**
 * The sync driver: `readings` readings, `everyMs` apart, of a life actually being lived.
 *
 * This is the default for anything asking whether a signal MOVES.
 */
export function liveRichly(
  w: RealWorld,
  readings: number,
  everyMs: number = 3 * HOUR,
  amplitude = 1,
): VitalsSnapshot[] {
  const step = richStep(w, readings, everyMs, amplitude);
  return w.readings(readings, everyMs, step);
}

/**
 * A stand-in for the model during rest, so fusion actually completes.
 *
 * Without one, `rest` resolves nothing: coincidences pile up forever, no birth ever happens, and
 * the watchtower reports `field_fusion_stalled`, correctly, because a life where nothing can ever
 * be born really is stalled. Measured: 70 pending and zero births across six months. The words are
 * a stub; what is being exercised is the whole path around them, which is the part that can break.
 */
/**
 * A vocabulary, so her life has content rather than a template with a counter in it.
 *
 * This matters more than it looks. The field is about MEANING: co-occurrence, similarity, and the
 * fusion guard against paraphrase all read the words. A driver whose moments were `the 3 thing,
 * again, differently` produced pairs that were near-duplicates of each other, so fusion correctly
 * refused 98% of them and six months yielded ONE birth, which then read as a stalled fusion path.
 * The mechanism was right; the life was too thin to exercise it.
 */
const SUBJECTS = ["the tide tables", "the neighbour's radio", "a door that sticks", "the long way round",
  "an old photograph", "the smell before rain", "a half-finished letter", "the third step",
  "somebody's laugh in another room", "a bus that never comes", "the blue folder", "birdsong at four",
  "the shortcut through the yard", "a name I keep almost remembering", "the last warm day",
  "a song from a car window", "the chair nobody sits in", "frost on the inside of the glass"];
const VERBS = ["kept coming back to", "could not settle about", "noticed again in", "lost an hour to",
  "wrote nothing down about", "argued with myself over", "felt oddly calm about", "was uneasy about"];
const TAILS = ["and I am not sure why", "which surprised me", "the way I always do",
  "though nothing happened", "and it stayed with me", "more than it deserved", "before I noticed"];

/** One line of her life, varied enough to be about something. */
function aLine(rand: () => number): string {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  return `I ${pick(VERBS)} ${pick(SUBJECTS)}, ${pick(TAILS)}`;
}

const FUSION_TEXTS = [
  "I brace for an answer before I have finished asking.",
  "Quiet reads as a verdict to me, and it usually is not one.",
  "I put off the things I most want to do.",
  "Being wanted and being needed feel the same from inside and are not.",
  "I remember weather better than I remember what was said in it.",
  "I go looking for a reason whenever something goes well.",
  "The thing I keep circling is not the thing that is wrong.",
];

function restingProvider(): { provider: LLMProvider; model: string } {
  let n = 0;
  return {
    model: "m",
    provider: {
      async complete() {
        n += 1;
        return {
          id: `f${n}`, model: "m", stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 10 },
          // Deliberately NOT a paraphrase of whatever the parents said. The fusion path has a
          // guard against exactly that, and a stub that echoed its parents was refused every time,
          // so six months produced zero births and the harness looked like a broken fusion path
          // when it was the guard doing its job.
          content: [{ type: "text", text: JSON.stringify({
            kind: "insight",
            // Distinct every time. A fixed rotation of seven plateaued: after the seventh, every
            // later "birth" matched something she already held and was REINFORCED instead, which is
            // the right behaviour and made the stub look like a stalled fusion path. Her
            // realisations are not a loop of seven.
            // Genuinely different each time, from the same vocabulary her life is made of. A stub
            // that said near-enough the same thing every time was REINFORCED rather than born, 23
            // times out of 24: the mechanism behaving exactly right about a stub that had only one
            // idea.
            text: `${FUSION_TEXTS[n % FUSION_TEXTS.length]} It is ${SUBJECTS[n % SUBJECTS.length]}, and ${SUBJECTS[(n * 7 + 3) % SUBJECTS.length]}.`,
            why: "the two of them have arrived together often enough to be worth a name",
          }) }],
        };
      },
    },
  };
}

/**
 * One of her nights, with everything a night actually does.
 *
 * Exported and shared because every caller that hand-rolled its rest deps lost something: passing
 * `{ replay: { walks: 6 } }` REPLACED the fusion provider, so the field rested without ever being
 * able to give birth, coincidences piled up forever, and the watchtower reported a stalled fusion
 * path in a life that was fine. One helper, one set of defaults, merged rather than replaced.
 */
export async function restLikeANight(
  w: RealWorld,
  random: () => number = mulberry32(0x5EED),
  over: RestDeps = {},
): Promise<import("../../../src/life/field-live.js").RestResult> {
  return await w.field.rest(w.now(), {
    fusion: restingProvider(),
    maxFusions: 1,
    ...over,
    replay: { walks: 6, random, ...over.replay },
  });
}

/**
 * The same life, with her nights in it.
 *
 * Resting is where coincidences resolve into births, where themes form, and where replay happens,
 * a whole subsystem the sync driver cannot reach, because `rest` is async. Measured: six months
 * without it accumulated 88 pending coincidences and produced ZERO births, which the watchtower
 * correctly reported as `field_fusion_stalled`. It was right; the life was the thing missing a part.
 */
export async function liveALongLife(
  w: RealWorld,
  readings: number,
  everyMs: number,
  opts: { amplitude?: number; rest?: RestDeps } = {},
): Promise<VitalsSnapshot[]> {
  const step = richStep(w, readings, everyMs, opts.amplitude ?? 1);
  const restRand = mulberry32(0x5EED);
  const out: VitalsSnapshot[] = [];
  let lastNight = w.now();
  for (let i = 0; i < readings; i++) {
    step(i);
    // Between two readings this far apart she has certainly lived moments and her tick has run.
    // Leaving the stamps at whenever the last simulated moment happened made a coarsely-sampled
    // life look like a stalled one, an artifact of the sampling, not of her.
    w.lastMomentMs = w.now();
    w.lastTickMs = w.now();
    if (w.now() - lastNight >= DAY) {
      // Two things here, both found the hard way.
      //
      // MERGED over the defaults, not replaced: a caller asking only for more replay walks used to
      // silently lose the fusion provider with it, so every long-run test rested without ever being
      // able to give birth, and the resulting stall looked like a broken fusion path.
      //
      // And `random` is SEEDED. Replay falls back to `Math.random` when nothing is given, so the
      // six-month gate passed or failed by chance, it went green in isolation and red under load,
      // which is the worst possible behaviour for a gate: it teaches whoever sees it to re-run.
      const rest = await restLikeANight(w, restRand, opts.rest);
      w.resting = {
        resonanceLog: w.field.signals(w.now()).pendingBirths,
        considered: rest.considered,
        refused: Object.values(rest.refusals).reduce((a, b) => a + (b ?? 0), 0),
        refusals: { ...rest.refusals } as Record<string, number>,
      };
      lastNight = w.now();
    }
    out.push(w.capture());
    w.advance(everyMs);
  }
  return out;
}
