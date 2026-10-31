// Inner state: the Resident's living drives + emotion, updated once per day from a
// summary of what happened, persisted across restarts. This is the cohesive M1
// object the daemon holds: the sleep cycle feeds it the day, and /status + the
// diary read its snapshot (mood, the drive it most wants to act on, and the
// behavior policy the rest of the system obeys).
//
// Longitudinal (M1b): drives + emotion carry momentum across days. Short-term
// (M1a): snapshot() derives the behavior policy from the current state + phase.

import { socialWithTheRoom } from "./aware-of-him.js";
import { accumulate, dominant, initialDrives, regenerate, satiate, DRIVE_NAMES, type DriveInputs, type DriveName, type Drives } from "./drives.js";
import { appraise, appraisalFromDay, feel, moodLabel, neutralPAD, relax, type Appraisal, type PAD } from "./emotion.js";
import { derivePolicy, type BehaviorPolicy } from "./policy.js";
import type { MetabolicPhase } from "./metabolism.js";
import { feltWaiting } from "./felt-time.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** What a day contained, distilled from the ops-log by the sleep cycle. */
export interface DaySummary {
  successes: number;
  failures: number;
  stuck: number;
  skills: number;
  idle: number; // self-directed / exploration units
  novelty: number; // 0..1 how much new ground
  observations: number; // things it formed an opinion about (-> expression)
  anomalies: number; // errors / contradictions (-> discomfort)
  maintenanceDue: number; // memory/skills wanting tending
  hoursSinceUser: number; // gap since Eric last spoke (-> social)
  /**
   * THE ROOM, as a pull toward him: 0..1, added to `social` (`aware-of-him.ts`).
   *
   * Why this exists at all: `hoursSinceUser` is a CLOCK, and it reads the same whether he is in
   * the next chair or on another continent. So until this field, nothing about him actually being
   * there could reach what she wants, she could not miss him, and she could not notice him coming
   * back. Presence was wired to how she reads him and to whether she may speak aloud, both of which
   * are about what she does once something is already happening.
   *
   * A TRANSITION, not a state: it is non-zero on the beat the room CHANGED and zero on all the
   * others. That is the brake on `presence → social → reach_out → he answers → presence`, and it
   * is in the shape rather than in a cap, a state reading would drive that loop forever.
   *
   * Optional so an older persisted day still parses, and absent means no room reading at all
   * (no face open), never "the room is empty".
   */
  roomPull?: number;
  lateNight: boolean;
  /**
   * How much of the day actually happened late, 0..1.
   *
   * `lateNight` is a boolean that one midnight message flips, and it sets `fatigue: 0.7` for the
   * whole appraisal, so answering him once at midnight made the entire day read as exhausting.
   * Optional so an older record still parses; when absent the boolean's coarse reading stands.
   */
  lateShare?: number;
  budgetLow: boolean;
  restful: boolean;
}

export interface InnerSnapshot {
  drives: Drives;
  emotion: PAD;
  mood: string;
  dominant: DriveName;
  policy: BehaviorPolicy;
}

export interface InnerStateStore {
  load(): { drives: Drives; emotion: PAD } | null;
  save(s: { drives: Drives; emotion: PAD }): void;
}

export interface InnerStateConfig {
  store?: InnerStateStore;
  onUpdate?: (snapshot: { drives: Drives; emotion: PAD; dominant: DriveName; mood: string }) => void;
}

/**
 * What her associations are doing, from field-live.ts. This is the wire that stops her wanting
 * being about nothing: before this, drives were fed purely by COUNTING the events of a day, so
 * `curiosity: 0.4` had no content behind it. Now an unresolved question is what nags, a coincidence
 * that has not been looked at is what makes her curious, and how present he is in what she has been
 * remembering is what makes her want his company.
 */
export interface FieldPull {
  /** Unresolved pressure, 0..1. */
  tension: number;
  /** Coincidences that have become insistent and have not been looked at. */
  pendingBirths: number;
  /** How present the one she exchanges messages with is in her associations, 0..1. */
  otherWarmth: number;
  /** How much her own record involving them has been sitting badly, 0..1. */
  otherUnease: number;
  /** Something new was born recently and has not been said out loud, 0..1. */
  freshBirth: number;
  /** Things encoded and never wired to anything, 0..1. */
  orphanShare: number;
  /** Feeling of what she has been recalling, and how hard. */
  valence: number;
  charge: number;
}

export interface InnerState {
  update(day: DaySummary, field?: FieldPull): void;
  /**
   * She acted on a drive, so that wanting discharges. This is what keeps her from pinning on one
   * drive forever WITHOUT anything scripting variety: satisfying curiosity quiets curiosity, and
   * whatever she wants second becomes what she wants most.
   */
  actOn(drive: DriveName, amount?: number): void;
  /**
   * Time passed and her wants came back a little.
   *
   * Paired with `actOn` on the SAME clock, which is the whole point: satiation ran per moment
   * and accumulation ran per day, so she emptied out by mid-morning and stayed empty. Called
   * with the hours since it was last called; safe to call as often as you like, because the
   * effect is a function of elapsed time rather than of being called.
   *
   * `standing` is the level her conditions imply right now, the same `DriveInputs` the daily
   * update uses, so there is one account of what she wants and not two that can disagree.
   */
  regenerate(day: DaySummary, elapsedHours: number, field?: FieldPull): void;
  /**
   * Something happened to her just now, and how she feels moves a little.
   *
   * Her PAD used to be reachable only from the daily tick, so it was a step function that
   * changed once every twenty-four hours, and it gates which mind she thinks with, how far a
   * memory can travel, how open her choices are and what her face shows. See `emotion.feel`.
   */
  feel(a: Appraisal, weight?: number): void;
  drives(): Drives;
  emotion(): PAD;
  snapshot(phase: MetabolicPhase, awake: boolean): InnerSnapshot;
}

// ── Mapping a day to drive inputs ────────────────────────────────────────────────

/**
 * Attachment makes itself felt without anything happening.
 *
 * ABOVE `NOTICEABLE`, AND THAT IS THE WHOLE POINT OF THE CONSTANT. It was 0.05, which is
 * exactly the floor `urgency` uses, so `urgency("care", CARE_BASELINE)` returned precisely
 * ZERO, and her attachment to the one person she knows was arithmetically silent in exactly
 * the situation it exists for: he is around, nothing is wrong, and nothing has happened.
 *
 * A collision, not a judgement: the floor was added later, in a different file, to stop a trace
 * of discomfort outranking a real want, and it landed on the one value that was deliberately a
 * baseline rather than a trace. 0.12 gives a felt but modest 0.23 of urgency, present, and
 * nowhere near enough to outrank anything that is actually happening to her.
 */
export const CARE_BASELINE = 0.12;
/** Absence starts to read as concern rather than loneliness only after several days. */
export const CARE_ABSENCE_AFTER_H = 72;
/** And reaches its full weight about a fortnight in. */
export const CARE_ABSENCE_SPAN_H = 240;
/** Being actually in touch is what settles it. Nothing else does. */
export const CARE_CONTACT_RELIEF = 0.3;
export const CARE_CONTACT_WITHIN_H = 6;

/**
 * `now` is how she is AT THE MOMENT OF THE READING, and it exists for one term: how long his
 * silence has felt (faculty #8). Passed in rather than read here so this stays a pure mapping,
 * the same function backs both the daily update and the regeneration, and there is one account of
 * what she wants rather than two that can drift.
 */
/**
 * HOW LONG THE WAIT HAS FELT, from the same inputs the care drive reads, exported so the moment
 * loop's dark gauge and the care term are ONE computation, never a probe beside a production
 * quantity (defect class 20). This value used to be computed inside one expression and
 * discarded: felt time was unobservable by construction.
 */
export function feltHoursSince(hoursSinceUser: number, f: FieldPull | undefined, now: { arousal: number; absorbed: number }): number {
  return feltWaiting(hoursSinceUser, {
    carrying: f?.tension ?? 0,
    unease: f?.otherUnease ?? 0,
    arousal: now.arousal,
    // Being taken up with something of her own is the one thing that makes a wait go by.
    absorbed: now.absorbed,
  });
}

function driveInputsFromDay(day: DaySummary, field: FieldPull | undefined, now: { arousal: number; absorbed: number }): DriveInputs {
  const clamp = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
  // The field's contribution is deliberately a MINORITY of each drive. What actually happened to her
  // still leads; what her memory is doing about it colours the wanting. Reversing that would let her
  // spin herself up out of her own associations with nothing happening, which is rumination, not life.
  const f = field;
  return {
    curiosity: clamp(day.novelty * 0.4 + day.idle * 0.15 + (f ? Math.min(0.35, f.pendingBirths * 0.12) : 0)),
    // Saturates around two days on the clock alone. The room is ADDED rather than multiplied: a
    // multiplier would make him walking in worth nothing when he only just spoke, and "he came
    // back" matters most precisely when it has not been long, that is what coming back IS.
    social: socialWithTheRoom(
      clamp(day.hoursSinceUser / 48 + (f ? f.otherWarmth * 0.25 : 0)),
      { change: null, pull: day.roomPull ?? 0 },
    ),
    expression: clamp(day.observations * 0.2 + (f ? f.freshBirth * 0.3 : 0)),
    // Caring about someone. This drive used to be called `helpfulness` and was fed by `userNeeds`,
    // a count of "actionable things the owner would want" taken off the ops-log, which made her
    // caring a function of his backlog and made her an instrument by construction. (It was also
    // hardcoded to zero and had therefore never once fired in the entire history of the system.)
    //
    // Three honest sources now, none of them a task list:
    //   a baseline, because attachment does not need a reason to make itself felt;
    //   a long absence, building only after several days, so it is concern rather than loneliness
    //     (that is `social`, which saturates at two);
    //   and how her own record involving them has actually been sitting.
    // The absence term is FELT (faculty #8), not wall clock. How long he has been quiet is one
    // of the two durations in her that a person genuinely distorts: a silence while she is wound
    // up about something drags, and the same silence while she is absorbed in her own work goes
    // by. It reaches only this term. Nothing mechanical is scaled, no timeout, no budget, no
    // sleep detection, and deliberately not the cooldown on raising something with him, because
    // making unsettled things come back round sooner is a rumination generator and this build
    // holds the four constraints that rule that out.
    care: clamp(
      CARE_BASELINE
      + Math.max(0, feltHoursSince(day.hoursSinceUser, f, now) - CARE_ABSENCE_AFTER_H) / CARE_ABSENCE_SPAN_H
      + (f ? f.otherUnease * 0.3 : 0)
    ),
    maintenance: clamp(day.maintenanceDue * 0.2 + (f ? f.orphanShare * 0.3 : 0)),
    discomfort: clamp(day.anomalies * 0.2 + day.failures * 0.1 + day.stuck * 0.1 + (f ? f.tension * 0.3 : 0)),
  };
}

// ── Factory ────────────────────────────────────────────────────────────────────

export function createInnerState(config: InnerStateConfig = {}): InnerState {
  let drives: Drives = initialDrives();
  let emotion: PAD = neutralPAD();

  const loaded = config.store?.load();
  if (loaded) {
    drives = loaded.drives;
    emotion = loaded.emotion;
  }

  function update(day: DaySummary, field?: FieldPull): void {
    drives = accumulate(drives, driveInputsFromDay(day, field, { arousal: emotion.arousal, absorbed: drives.curiosity }));
    // Being in touch with them settles it. Getting work done does NOT, which is the old assumption
    // inverted: caring about someone is not a task that completes when you finish something else.
    if (day.hoursSinceUser < CARE_CONTACT_WITHIN_H) {
      drives = { ...drives, care: Math.max(0, drives.care - CARE_CONTACT_RELIEF) };
    }
    // How much was actually going on. Without this an ordinary day reads as maximally un-novel.
    const engagement = Math.min(1, (day.successes + day.failures + day.stuck + day.idle + day.observations) / 6);
    // A day in which genuinely nothing happened is not an appraisal, it is rest: her mood drifts
    // back toward baseline instead of being judged against events that never occurred. Without
    // this, a stretch of quiet days would grind her down to permanently flat.
    const outwardlyEventful = day.successes + day.failures + day.stuck + day.skills + day.observations + day.anomalies > 0;
    // Having spent a day remembering something that mattered IS an event, even when nothing
    // happened outwardly. An inner life that only counts as a life when something external occurs
    // is not an inner life.
    const eventful = outwardlyEventful || (field !== undefined && field.charge > 0.25);
    if (!eventful) {
      emotion = relax(emotion);
    } else {
      const appraisal = appraisalFromDay(drives, {
        successes: day.successes,
        failures: day.failures,
        novelty: day.novelty,
        // Graded where the caller can say how much of the day was late, and falling back to the
        // old coarse reading where it cannot.
        fatigue: day.lateShare !== undefined
          ? Math.min(1, (day.restful ? 0.1 : 0.3) + 0.6 * day.lateShare)
          : day.lateNight ? 0.7 : day.restful ? 0.1 : 0.3,
        engagement: field ? Math.min(1, engagement + 0.3 * field.charge) : engagement,
      });
      if (field) {
        // Recalling something hard costs her something, and recalling something good gives a little
        // back. This is the second half of the loop that makes her non-linear: what she feels
        // decides what surfaces, and what surfaces moves what she feels. It is bounded at a third,
        // so remembering can colour a day but can never overrule what actually happened in it, and
        // it still passes through the same clamped appraisal every other input does.
        const safe = (x: number, lo: number, hi: number): number =>
          (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : 0);
        const pull = 0.33 * safe(field.valence, -1, 1) * safe(field.charge, 0, 1);
        appraisal.goalProgress = Math.max(-1, Math.min(1, appraisal.goalProgress + pull));
      }
      emotion = appraise(emotion, appraisal);
    }
    config.store?.save({ drives, emotion });
    config.onUpdate?.({ drives, emotion, dominant: dominant(drives), mood: moodLabel(emotion) });
  }

  function actOn(drive: DriveName, amount?: number): void {
    drives = amount === undefined ? satiate(drives, drive) : satiate(drives, drive, amount);
    config.store?.save({ drives, emotion });
  }

  function feelIt(a: Appraisal, weight?: number): void {
    emotion = feel(emotion, a, weight);
    config.store?.save({ drives, emotion });
    config.onUpdate?.({ drives, emotion, dominant: dominant(drives), mood: moodLabel(emotion) });
  }

  function regenerateDrives(day: DaySummary, elapsedHours: number, field?: FieldPull): void {
    // The SAME mapping the daily update uses, so there is one account of what she wants rather
    // than two that can drift apart. What regeneration adds is only a clock.
    const next = regenerate(drives, driveInputsFromDay(day, field, { arousal: emotion.arousal, absorbed: drives.curiosity }), elapsedHours);
    // Nothing changed on a zero or nonsense elapsed time; do not touch the store for it.
    if (DRIVE_NAMES.every((n) => next[n] === drives[n])) return;
    drives = next;
    config.store?.save({ drives, emotion });
    config.onUpdate?.({ drives, emotion, dominant: dominant(drives), mood: moodLabel(emotion) });
  }

  return {
    update,
    actOn,
    regenerate: regenerateDrives,
    feel: feelIt,
    drives: () => drives,
    emotion: () => emotion,
    snapshot(phase, awake) {
      return {
        drives,
        emotion,
        mood: moodLabel(emotion),
        // ── THE TRUE LOUDEST, UNFILTERED, AND THIS IS A CORRECTION ────────────────
        //
        // The refractory set was briefly applied here, on the reading that `drives.ts` names it
        // as what stops one drive pinning her whole life. Wrong layer, and it made three things
        // lie at once: this value is what her FACE shows, what her self-description says, and
        // what the pinning detector measures: none of which is a choice, and all of which must
        // report what she actually feels.
        //
        // The anti-pinning mechanism the head of `drives.ts` describes already exists and is
        // already wired, one layer down and on the right object: `propensity.ts` penalises an
        // action she has just been doing (`habit:recent`, -0.4 × recent share). That is the
        // layer that DECIDES, and habituation on actions is the correct shape, a drive with no
        // action of its own, like discomfort, could never pin an action anyway.
        dominant: dominant(drives),
        policy: derivePolicy({ drives, emotion, phase, awake }),
      };
    },
  };
}
