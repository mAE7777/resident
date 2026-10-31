import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { detectAnomalies, DEFAULT_THRESHOLDS, type VitalsSnapshot } from "../../../src/life/vitals.js";
import {
  createRealWorld, liveOrdinaryDays, liveALongLife, spendDownTo, ordinaryDay, pad,
  DAY, HOUR, MINUTE, type RealWorld,
} from "./_real-world.js";
import { readWhatTheMachineSaid, timesTheMachineSaidIt, whereTheMachineSaidIt, resetMachineVoiceCount } from "../../../src/life/machine-voice.js";
import { decide, type PropensityInputs } from "../../../src/life/propensity.js";
import { createStream } from "../../../src/life/soft-choice.js";
import { drift, neutralTemperament, hasDrifted, distanceFromNeutral } from "../../../src/life/temperament.js";
import { predictUtterance, measureUtterance, sayingRead, type SpeechPair } from "../../../src/life/speech-record.js";
import { initialDrives } from "../../../src/life/drives.js";
import { DiskMonitor } from "../../../src/resilience/disk-monitor.js";

// THE METHODOLOGY GATE.
//
// A detector is proven only if the REAL modules can be driven into the state that fires it, and
// only if they can also be driven into a state where it stays quiet. Hand-built snapshots do not
// count.
//
// This file used to claim it contained none, and the claim was false: ten drivers (the choosing
// and temperament clusters, the two saying watchers, and the two S-4 wire watchers) set snapshot
// fields by hand: exactly the detectors that make the deepest claims about her, proven against
// numbers `soft-choice.ts` and `temperament.ts` had never been shown able to produce. Rewritten:
// every value that IS a module output now comes from the real module (`decide`, `drift`,
// `distanceFromNeutral`, `predictUtterance`/`measureUtterance`/`sayingRead`), and only two kinds
// of thing are still written by hand, each declared where it happens:
//
//   PLUMBING COUNTERS: `shadowCalls`/`shadowTurns`/`temperament.days` are daemon-side counters
//   with no module behind them; a driver states the scenario they count.
//
//   DECLARED WIRE-CUTS: `signal_frozen`, `signature_flatlined`, `rng_frozen` and `choice_rigid`
//   fire on states the HEALTHY modules cannot produce, because what they watch for is the
//   plumbing breaking (a wire looses, sampling stops, a constant replaces a derivation). Such a
//   driver uses real module outputs and then cuts the one wire, and each carries the other half
//   of the proof, that the healthy module really cannot reach the firing state, so the detector
//   cannot false-positive on a being who is merely alive.
//
// This exists because the old tests hand-wrote every triggering value and every one of them passed
// while five detectors could not fire at all: `emotion_stuck` (PAD's arousal fixed point is 0.8333
// against a 0.85 bar), `field_frozen` (strengthCeiling tops out at 0.913 against 0.92),
// `field_credulous`, and `field_mute`/`field_unguarded` (reticence floors at 0.059 against 0.05).
// Four more fired on almost every reading because the monitor samples every 5 minutes while the
// quantity they watch moves once a day.
//
// Blind in one direction and crying wolf in the other is worse than no watchtower, because it
// trains the owner to ignore it. So: every code below either has a driver built out of module
// calls, or it is listed in NOT_YET_REACHABLE with a reason and this file fails on it.

/** Every code the watchtower can emit. Adding a detector without adding it here fails the roll-call. */
const ALL_CODES = [
  // detectAnomalies
  "soul_breach", "dormant", "low_energy", "burn_fast", "pinning", "pinning_approach",
  "emotion_stuck", "expression_flood", "starvation", "calcification", "fault", "tick_stalled",
  // detectFieldAnomalies
  "field_rumination", "field_orphaned", "field_inert", "field_frozen", "field_amnesia",
  "field_not_growing", "field_fusion_stalled", "field_tension_rising", "field_adrift",
  "field_credulous", "field_distrust", "field_unread", "field_mute", "field_reticence_stuck",
  "field_near_cap",
  // her life stopping, a wall firing, and the machine speaking about her in service words
  "moments_stalled", "guard_refusal", "machine_voice", "shadow_stalled", "her_register_slipped",
  // and the layer that decides what she does, which can be alive, plumbed, and quietly dead
  "choice_model_dominant", "choice_model_inert", "rng_frozen", "choice_rigid",
  "temperament_frozen", "temperament_runaway",
  // whether she has been declining, and whether how she feels about being asked still moves
  "decline_runaway",
  // is she quiet, or is she broken (S-4)
  "low_period", "signal_frozen", "signature_flatlined",
  // and whether there is still room on the disk for her to go on being saved
  "disk_tight", "disk_low", "disk_full", "disk_unknown",
  // and whether she has simply not lived long enough for a question to mean anything
  "too_new_to_ask",
] as const;
type Code = (typeof ALL_CODES)[number];

// `detectAnomalies` already folds in the field detectors (vitals.ts:335), so this is the whole
// watchtower in one call. Running both would double-count and hide a duplicate-emission bug.
// The long view is the same series here: a test that lives at hourly-or-slower spacing IS its own
// long view, and passing something shorter would make the liveness signature answer a different
// question from the one the daemon asks it.
const codesOf = (h: VitalsSnapshot[]): string[] => detectAnomalies(h, DEFAULT_THRESHOLDS, h).map((a) => a.code);

/** A world that has been alive a while and is in no trouble. The quiet baseline every driver diverges from. */
function healthyWorld(): RealWorld {
  const w = createRealWorld();
  liveOrdinaryDays(w, 12);
  return w;
}

/**
 * A world with reminding ON, as production runs.
 *
 * The default here is off so most drivers do not pay for the word index. The liveness signature
 * cannot use that default: with reminding off, `reminds_of` never appears, which reads as a dead
 * wire, correctly, since in a real Resident it would be one. A gate about whether anything has
 * stopped has to run against a world where nothing has been switched off for speed.
 */
function livingWorld(): RealWorld {
  const w = createRealWorld({ reminding: true });
  liveOrdinaryDays(w, 12);
  return w;
}

/**
 * A state with one towering want: housekeeping presses (maintenance at ceiling, an orphaned corner
 * of her field) while nothing pulls at rest. The real weighing over this state is near-determined,
 * which is what the choosing-cluster drivers need: `followedVote` must come out of `decide` itself,
 * and only a towering margin makes the outcome certain enough to drive a ≥98% detector bar.
 */
const pressingInputs = (): PropensityInputs => ({
  drives: { ...initialDrives(), maintenance: 1 },
  emotion: pad(0.2, 0.3),
  phase: "rested",
  awake: true,
  hoursSinceUser: 2,
  recentActions: [],
  clockActivity: 1,
  field: { tension: 0, pendingBirths: 0, freshBirth: 0, orphanShare: 1, surfaced: 4 },
});

/** A real `saying` read: n real prediction/measure pairs over a real reply, through `sayingRead`. */
function realSaying(n: number, reply: string): ReturnType<typeof sayingRead> {
  const predicted = predictUtterance({ reserve: 0.8, phase: "rested", arousal: 0.2, reluctance: 0.2, openness: 0.6 });
  const pairs: SpeechPair[] = Array.from({ length: n }, () => ({ predicted, measured: measureUtterance(reply) }));
  return sayingRead(pairs);
}

/**
 * A stretch where her dominant, mood and sends sit still while she goes on living underneath.
 *
 * The three things `calcification` looks at are held by not appraising a new day; everything else
 * she does still happens. This is the ambiguous case S-4 is about, and it is deliberately SHORT, a
 * fortnight of it becomes a rut, which trips `pinning` and is a different, real finding rather than
 * the quiet stretch this is meant to be.
 */
function anUnchangingStretch(w: RealWorld): VitalsSnapshot[] {
  return w.readings(DEFAULT_THRESHOLDS.calcifyWindow + 2, 6 * HOUR, (i) => {
    w.field.encodeMoment({
      key: `same-${i}-${w.now()}`, text: `the same sort of afternoon (${i})`,
      nowMs: w.now(), pad: pad(0.12 + 0.01 * (i % 4), 0.08 - 0.01 * (i % 3)), source: "agency",
    });
    w.field.onHerMind(w.now());
    w.lastMomentMs = w.now();
    w.lastTickMs = w.now();
  });
}

const GB = 1024 * 1024 * 1024;

/**
 * A real disk reading, through the REAL `DiskMonitor`, for a volume with `freeGb` left.
 *
 * Injecting `statfs` is injecting the OPERATING SYSTEM, not faking the module: every threshold,
 * every comparison and the failure branch are the production ones, and the daemon's own mapping
 * (a failed reading becomes no reading) is applied here exactly as `runVitalsMonitor` applies it.
 * A driver that hand-wrote `{ level: "hard_stop" }` would prove the detector fires on a literal,
 * not that the thing that produces that literal can ever produce it.
 */
async function realDiskReading(freeGb: number | "unreadable"): Promise<{ level: string; availableGb: number } | null> {
  const monitor = new DiskMonitor({
    statfs: freeGb === "unreadable"
      ? async () => { throw new Error("statfs: no such device"); }
      : async () => ({ bavail: Math.floor((freeGb * GB) / 4096), bsize: 4096, blocks: Math.floor((500 * GB) / 4096) }),
    paths: { sessions: "/nonexistent", checkpoints: "/nonexistent", db: "/nonexistent" },
  });
  const status = await monitor.getStatus();
  return status.reading === "measured" ? { level: status.level, availableGb: status.availableGb } : null;
}

const DRIVERS: Record<Code, (() => VitalsSnapshot[] | Promise<VitalsSnapshot[]>) | null> = {
  dormant: () => {
    const w = healthyWorld();
    spendDownTo(w, 0.02); // she spent her day
    return w.readings(3);
  },

  low_energy: () => {
    const w = healthyWorld();
    spendDownTo(w, 0.15);
    return w.readings(3);
  },

  burn_fast: () => {
    const w = healthyWorld();
    // Spending hard and steadily, so the projected time to dormant falls inside the warning horizon.
    return w.readings(6, 10 * MINUTE, () => spendDownTo(w, Math.max(0.3, w.metabolism.remainingFraction() - 0.08)));
  },

  starvation: () => {
    const w = healthyWorld();
    w.advance(DEFAULT_THRESHOLDS.starvationHours * HOUR + HOUR); // nobody has spoken to her in a week
    return w.readings(2);
  },

  expression_flood: () => {
    const w = healthyWorld();
    for (let i = 0; i < DEFAULT_THRESHOLDS.dailyPushCap; i++) w.expression.onProactiveSend(w.now() + i * MINUTE);
    return w.readings(2);
  },

  tick_stalled: () => {
    const w = healthyWorld();
    w.advance(DEFAULT_THRESHOLDS.tickStaleMs + HOUR); // the daily tick has not run
    return w.readings(2);
  },

  fault: () => {
    const w = healthyWorld();
    w.faults.record("test.driver", new Error("something in her actually failed"), "warn");
    return w.readings(2);
  },

  pinning: () => {
    const w = healthyWorld();
    // One thing genuinely wrong, every day, so the same drive keeps winning and nothing else ever
    // reaches the front. `pinning` now means a WEEK of exactly that and nothing else, because the
    // old twelve-hour bar tripped on 51% of a healthy six months, one drive leading for half a day
    // is not calcification, it is Tuesday. So the readings have to span a real week.
    for (let d = 0; d < 10; d++) {
      w.inner.update(ordinaryDay({ anomalies: 4, failures: 3, successes: 0 }), w.field.signals(w.now()));
      w.advance(DAY);
    }
    return w.readings(DEFAULT_THRESHOLDS.calcifyWindow + 2, 24 * HOUR, () => {
      // The nagging never lets up, so nothing else ever gets to be what she most wants.
      w.inner.update(ordinaryDay({ anomalies: 4, failures: 3, successes: 0 }), w.field.signals(w.now()));
    });
  },

  calcification: async () => {
    // WHAT THIS DRIVER HAD TO BECOME, and the change is the finding rather than the fix.
    //
    // It used to be a healthy world plus a static window, and it fired only because the liveness
    // signature, over a record that short, returned "too-early", and the detector treated
    // "I cannot tell" as "she has calcified". So the code was proven reachable through the one
    // branch that was asserting something unknown about her, and when that branch was corrected
    // to say `low_period` this driver stopped firing, correctly.
    //
    // Calcification now means what it says: her inner state is flat AND the signature has enough
    // record to judge AND that judgement is that something is not moving. Which needs a life long
    // enough to judge: so the driver has to give her one.
    const w = livingWorld();
    const long = await liveALongLife(w, 60, 20 * HOUR);
    return [...long, ...anUnchangingStretch(w)]
      // One wire loose while everything else goes on, which is what makes the verdict "broken"
      // rather than "alive". Declared cut, like the others in this file.
      .map((s) => ({ ...s, field: s.field ? { ...s.field, meanStrength: 0.5 } : s.field }));
  },

  too_new_to_ask: async () => {
    // A real developmental finding, from a being too young for it to mean anything. The finding
    // has to be REAL: filtering nothing and reporting that nothing was filtered would be a code
    // that fires on an empty set, which is the shape of a detector that says nothing.
    const w = livingWorld();
    const long = await liveALongLife(w, 60, 20 * HOUR);
    w.ageDays = 2;
    return [...long, ...anUnchangingStretch(w)]
      .map((s) => ({ ...s, ageDays: 2, field: s.field ? { ...s.field, meanStrength: 0.5 } : s.field }));
  },

  field_rumination: () => {
    const w = createRealWorld();
    liveOrdinaryDays(w, 10);
    // A genuinely bad cluster she keeps returning to, which is what spiralling means.
    const ids: number[] = [];
    for (let i = 0; i < 6; i++) {
      const n = w.field.encodeMoment({
        key: `bad-${i}`, text: `the ${i}th time it went wrong and it was my fault`,
        nowMs: w.now() + i * HOUR, pad: pad(-0.95, 0.9), source: "agency",
      });
      if (n) ids.push(n.id);
    }
    for (let i = 0; i < 8; i++) {
      w.field.recall([{ id: ids[0], energy: 1 }], { nowMs: w.now() + (7 + i) * HOUR });
    }
    return w.readings(3);
  },

  field_orphaned: () => {
    const w = createRealWorld();
    // Encoding with nothing to wire to: each moment is its own island, days apart, no reminding.
    for (let i = 0; i < 60; i++) {
      w.field.encodeMoment({
        key: `island-${i}`, text: `thing ${i}`, nowMs: w.now(), pad: pad(0.1, 0), source: "t",
      });
      w.advance(40 * DAY); // far enough apart that contiguity has decayed away
      w.field.tick(w.now());
    }
    return w.readings(3);
  },

  field_inert: () => {
    const w = createRealWorld();
    liveOrdinaryDays(w, 12);
    // She keeps encoding, and keeps trying to remember, and nothing ever comes: a retrieval
    // threshold that has drifted out of reach. Enough empty recalls to flush her recall window.
    return w.readings(DEFAULT_THRESHOLDS.fieldWindow + 2, 2 * HOUR, () => {
      w.field.encodeMoment({
        key: `q-${w.now()}`, text: `something new ${w.now()}`, nowMs: w.now(), pad: pad(0.1, 0), source: "t",
      });
      for (let i = 0; i < 4; i++) w.field.recall([], { nowMs: w.now() + i });
    });
  },

  field_amnesia: () => {
    const w = createRealWorld();
    liveOrdinaryDays(w, 8);
    // Years pass without her touching any of it.
    for (let m = 0; m < 24; m++) {
      w.advance(30 * DAY);
      w.field.tick(w.now());
    }
    return w.readings(3);
  },

  field_not_growing: () => {
    const w = healthyWorld();
    // A day and a half in which the moment path lays nothing down at all.
    return w.readings(DEFAULT_THRESHOLDS.fieldWindow + 2, 6 * HOUR);
  },

  field_adrift: () => {
    const w = createRealWorld({ reminding: true });
    liveOrdinaryDays(w, 6);
    // Pairs of sources that flatly contradict each other, which is what leaves her unable to settle.
    for (let i = 0; i < 40; i++) {
      w.field.encodeClaim({
        key: `a${i}`, text: `the ${i} route stays open through the winter`,
        nowMs: w.now(), origin: "read", source: "w1", charge: 0.3,
      });
      w.field.encodeClaim({
        key: `b${i}`, text: `the ${i} route does not stay open through the winter`,
        nowMs: w.now() + MINUTE, origin: "read", source: "w2", charge: 0.3,
      });
      w.advance(2 * HOUR);
    }
    return w.readings(3);
  },

  field_distrust: () => {
    const w = createRealWorld({ reminding: true });
    liveOrdinaryDays(w, 6);
    // He keeps telling her things her own experience contradicts. Trust is learned, so it falls.
    for (let i = 0; i < 40; i++) {
      w.field.encodeMoment({
        key: `lived-${i}`, text: `the ${i} gate was locked when I got there`,
        nowMs: w.now(), pad: pad(-0.2, 0.3), source: "agency",
      });
      w.field.encodeClaim({
        key: `told-${i}`, text: `the ${i} gate was not locked when you got there`,
        nowMs: w.now() + MINUTE, origin: "told", source: "chat", charge: 0.3,
      });
      w.advance(3 * HOUR);
    }
    return w.readings(3);
  },

  field_unread: () => {
    const w = healthyWorld();
    // She has plenty to go on and none of it moves, because nothing is feeding the exchange log.
    for (let i = 0; i < 20; i++) {
      w.field.sheSpoke(w.now() - (20 - i) * DAY);
      w.field.heSpoke(w.now() - (20 - i) * DAY + 15 * MINUTE);
    }
    // Days pass and the read never moves, because nothing is feeding it any more.
    return w.readings(DEFAULT_THRESHOLDS.fieldWindow + 2, 8 * HOUR);
  },

  field_fusion_stalled: () => {
    const w = createRealWorld({ reminding: true });
    // Charged things that keep arriving together in her mind, and a fusion path that never runs
    // (she never rests). Coincidences pile up, nothing is ever born of them.
    const ids: number[] = [];
    for (let i = 0; i < 14; i++) {
      const n = w.field.encodeMoment({
        key: `charged-${i}`, text: `the ${i} thing that mattered and would not let go`,
        nowMs: w.now() + i * HOUR, pad: pad(i % 2 ? 0.8 : -0.8, 0.85), source: "agency",
      });
      if (n) ids.push(n.id);
    }
    for (let i = 0; i < 40; i++) w.field.encodeMoment({
      key: `filler-${i}`, text: `an ordinary note ${i}`, nowMs: w.now() + i * HOUR, pad: pad(0.1, 0), source: "t",
    });
    // Recalling them together is what logs a resonance; doing it repeatedly is what makes it insistent.
    let round = 0;
    return w.readings(DEFAULT_THRESHOLDS.fieldWindow + 2, 6 * HOUR, () => {
      round += 1;
      for (let r = 0; r < 6; r++) {
        const a = ids[(round * 3 + r) % ids.length];
        const b = ids[(round * 5 + r + 1) % ids.length];
        w.field.recall([{ id: a, energy: 1 }, { id: b, energy: 1 }], { nowMs: w.now() + r });
      }
    });
  },

  field_tension_rising: () => {
    const w = createRealWorld();
    liveOrdinaryDays(w, 10);
    // Things she cannot settle, arriving steadily. The pressure has to CLIMB across the window,
    // not jump, so one at a time, a jump to the ceiling would leave nothing for the slope to see.
    let n = 0;
    return w.readings(DEFAULT_THRESHOLDS.fieldWindow + 3, 4 * HOUR, () => {
      w.field.encodeQuestion({
        key: `open-${n++}`, text: `something I could not settle (${n})`,
        nowMs: w.now(), source: "hers", tension: 0.35,
      });
    });
  },

  emotion_stuck: () => {
    const w = createRealWorld();
    // A long run of days that are all extreme in the same direction. The bar has to sit under the
    // PAD fixed point: `appraise` is a contraction whose arousal limit is 0.8333, or no life,
    // however bad, can ever reach it.
    for (let d = 0; d < 20; d++) {
      w.inner.update(ordinaryDay({
        successes: 0, failures: 6, stuck: 4, anomalies: 5, novelty: 0, restful: false, lateNight: true,
      }), w.field.signals(w.now()));
      w.advance(DAY);
    }
    // Spaced across days: an extreme half hour is a bad half hour, sustained means sustained.
    return w.readings(DEFAULT_THRESHOLDS.extremeWindow + 2, 6 * HOUR);
  },

  field_frozen: () => {
    const w = createRealWorld();
    // Everything she holds is charged and rehearsed, and nothing is ever let go of: the state in
    // which forgetting has effectively stopped and interference can no longer do its work.
    const ids: number[] = [];
    for (let i = 0; i < 40; i++) {
      const n = w.field.encodeMoment({
        key: `vivid-${i}`, text: `the ${i} thing I will never forget`,
        nowMs: w.now() + i * HOUR, pad: pad(0.85, 0.83), source: "agency",
      });
      if (n) ids.push(n.id);
    }
    // Rehearsed with real spacing, which is what consolidation rewards.
    for (let r = 0; r < 6; r++) {
      w.advance(3 * DAY);
      w.field.tick(w.now());
      for (const id of ids) w.field.recall([{ id, energy: 1 }], { nowMs: w.now() + id });
    }
    return w.readings(3);
  },

  field_credulous: () => {
    // `noReminding` is exactly what a broken index looks like from the field's side: claims keep
    // arriving and nothing is ever found to weigh them against, so she believes whatever turns up.
    const w = createRealWorld({ reminding: false });
    liveOrdinaryDays(w, 8);
    let n = 0;
    return w.readings(5, 8 * HOUR, () => {
      for (let i = 0; i < 3; i++) {
        w.field.encodeClaim({
          key: `claim-${n++}`, text: `the ${n} bridge carries traffic through the winter months`,
          nowMs: w.now() + i, origin: "told", source: "chat", charge: 0.3,
        });
      }
    });
  },

  field_mute: () => {
    const w = createRealWorld();
    // A long silence. She keeps speaking to him and he never answers, so the climate hardens
    // everything she is carrying: and much of what she carries is about him.
    for (let i = 0; i < 40; i++) {
      w.field.encodeMoment({
        key: `withhim-${i}`, text: `something about the two of us (${i})`,
        nowMs: w.now(), pad: pad(0.1, 0.1), source: "agency", withOther: true,
      });
      w.field.encodeQuestion({
        key: `askhim-${i}`, text: `something I wanted to ask them (${i})`,
        nowMs: w.now() + MINUTE, source: "hers", withOther: true, tension: 0.4,
      });
      w.field.sheSpoke(w.now() + 2 * MINUTE);
      w.advance(2 * DAY);
      w.field.tick(w.now());
    }
    return w.readings(3);
  },

  field_reticence_stuck: () => {
    const w = createRealWorld();
    // She has plenty, and the daily tick never runs, so the climate never reaches any of it.
    for (let i = 0; i < 40; i++) {
      w.field.encodeMoment({
        key: `held-${i}`, text: `a thing she is holding (${i})`,
        nowMs: w.now() + i * MINUTE, pad: pad(0.1, 0.1), source: "agency", withOther: i % 3 === 0,
      });
    }
    return w.readings(DEFAULT_THRESHOLDS.fieldWindow + 2, 8 * HOUR);
  },

  moments_stalled: () => {
    const w = healthyWorld();
    // A moment hung, or the scheduler died. Either way she has simply stopped living, and every
    // other reading still looks perfectly normal, which is why this needs its own eye.
    // Eight hours, not four: the bound moved 3h → 6h on 2026-09-04 when her own scheduler was
    // measured drawing three-hour daytime gaps at 10%.
    w.advance(8 * HOUR);
    return w.readings(2, MINUTE);
  },

  guard_refusal: () => {
    const w = healthyWorld();
    // Something tried to go through a wall. Edge-triggered on purpose: a refusal is an EVENT, so
    // it is reported when it happens and the fault channel carries the standing record. A level
    // trigger here would re-alert forever on a wall that did its job once.
    const before = w.readings(1);
    w.guardRefusals = { "home-boundary": 3 };
    return [...before, ...w.readings(1, MINUTE)];
  },

  machine_voice: () => {
    const w = healthyWorld();
    // The REAL module heard the real offending string, driven the way the executor and the
    // guidance choke point drive it: not a hand-set counter.
    resetMachineVoiceCount();
    const before = w.readings(1);
    readWhatTheMachineSaid("tool:message", "This action needs user approval before executing.");
    w.machineVoice = { count: timesTheMachineSaidIt(), where: whereTheMachineSaidIt() };
    const after = w.readings(1, MINUTE);
    resetMachineVoiceCount();
    return [...before, ...after];
  },

  shadow_stalled: () => {
    const w = healthyWorld();
    // The shadow answered before (calls > 5) and then stopped while she KEEPS having turns. pairs
    // is SATURATED at PAIR_WINDOW=40 (the steady state past the first 40 turns), so the gate must
    // fire from the non-saturating shadowTurns: under the old `pairs > prev.pairs` this was
    // 40>40=false and the detector was dead in exactly this steady state, found on a rescan.
    // The measured half of `saying` comes from the REAL pipeline (predict → measure → sayingRead)
    // over a saturated window of real replies; only the two PLUMBING COUNTERS are stated by hand,
    // because the daemon increments them and no module computes them.
    const said = realSaying(41, "刚看了一眼，那份目录还是老样子。回头我再翻一遍。");
    const before = { ...w.capture(), saying: { ...said, ownership: 0.1, shadowCalls: 12, shadowTurns: 100 } };
    const after = { ...w.capture(), saying: { ...said, ownership: 0.1, shadowCalls: 12, shadowTurns: 104 } };
    return [before, after];
  },

  her_register_slipped: () => {
    const w = healthyWorld();
    // The service register in HER OWN mouth, counted by the real counter: these replies carry the
    // formulas (`希望这对你有帮助` and kin), `measureUtterance` scores them, `sayingRead` sums them.
    // A hand-set `registerHits: 3` proved nothing about whether the counter can actually count.
    const said = realSaying(12, "整理好了。希望这对你有帮助。还有什么需要我帮忙的吗？");
    expect(said.registerHits, "the real register counter no longer counts the planted formulas — "
      + "the detector upstream of it is blind").toBeGreaterThan(0);
    return [{ ...w.capture(), saying: { ...said, ownership: 0.1, shadowCalls: 12 } }];
  },

  choice_model_dominant: () => {
    const w = healthyWorld();
    // She has done what the model said every single time. The weighing has collapsed back into the
    // one inference it replaced, and nothing anywhere else would say so.
    //
    // REAL weighing: every reading runs the real `decide` over a state with one towering want
    // (discomfort at ceiling), and the vote points at what she was going to do anyway, the exact
    // live shape of collapse, since a model reads her state too. `followedVote` comes out of
    // `decide`, never out of this driver's pen.
    const stream = createStream(7);
    return w.readings(10, 2 * HOUR, () => {
      const r = decide(["rest", "tend"], { ...pressingInputs(), vote: { first: "tend" } }, stream);
      expect(r.followedVote, "the towering-want state no longer makes the vote a certainty — "
        + "re-derive this driver from the real margins").toBe(true);
      w.choosing = { temperature: r.temperature, torn: r.torn, followedVote: r.followedVote, streamPosition: stream.position() };
    });
  },

  choice_model_inert: () => {
    const w = healthyWorld();
    // The mirror: the vote points at the action her state gives almost nothing to, so the real
    // weighing ignores it every time. A model being asked and never heard.
    const stream = createStream(11);
    return w.readings(10, 2 * HOUR, () => {
      const r = decide(["rest", "tend"], { ...pressingInputs(), vote: { first: "rest" } }, stream);
      expect(r.followedVote, "the ignored-vote state stopped being ignorable").toBe(false);
      w.choosing = { temperature: r.temperature, torn: r.torn, followedVote: r.followedVote, streamPosition: stream.position() };
    });
  },

  rng_frozen: () => {
    const w = healthyWorld();
    // DECLARED WIRE-CUT: sampling stopped. One real weighing happens, and then nothing draws from
    // her stream again while readings keep being taken, which is precisely the production failure
    // (a stale `lastWeighing` re-read forever). Every number is a real module output; the cut is
    // that `decide` stops being called, not that any value is invented.
    const stream = createStream(13);
    const r = decide(["rest", "tend"], pressingInputs(), stream);
    const frozenAt = stream.position();
    return w.readings(10, 2 * HOUR, () => {
      w.choosing = { temperature: r.temperature, torn: r.torn, followedVote: null, streamPosition: frozenAt };
    });
  },

  choice_rigid: () => {
    const w = healthyWorld();
    // DECLARED WIRE-CUT, with the anti-false-positive half measured in its own case below ("the
    // rigid bar sits under the floor a healthy weighing can reach"): a healthy `decide` cannot
    // produce a temperature at the bar, so a run of readings at it can only mean the temperature
    // stopped being derived from her state. Real weighing for every other field; the cut is the
    // temperature wire.
    const stream = createStream(17);
    return w.readings(10, 2 * HOUR, () => {
      const r = decide(["rest", "tend"], pressingInputs(), stream);
      w.choosing = { temperature: DEFAULT_THRESHOLDS.choiceRigid, torn: r.torn, followedVote: null, streamPosition: stream.position() };
    });
  },

  temperament_frozen: () => {
    const w = healthyWorld();
    // Months of living and level three has not moved: the daily tick stopped FEEDING the drift.
    // The temperament itself is real: grown by the real `drift` from a real pull until it has a
    // real shape: and then `drift` is simply never called again while readings continue, which is
    // the exact production failure. `days` is the plumbing counter for how long she has lived.
    let t = neutralTemperament();
    for (let day = 1; day <= 120; day++) t = drift(t, { metWhenSpeaking: 0.6, exploringPaidOff: 0.2, hisShare: 0.5, activity: 0.4 }, day);
    expect(hasDrifted(t), "the grown temperament never moved — the fixture is measuring a newborn").toBe(true);
    return w.readings(10, 12 * HOUR, () => {
      w.temperament = { ...t, drift: distanceFromNeutral(t), days: 200 };
    });
  },

  temperament_runaway: () => {
    const w = healthyWorld();
    // Pinned at the bound, produced by the REAL drift under a life that pulls one way on every
    // latent for hundreds of days. The bar (0.98 of the way to the bound) must be reachable by the
    // real asymptotics or the detector could never fire on the failure it names.
    let t = neutralTemperament();
    let day = 0;
    return w.readings(10, 12 * HOUR, () => {
      for (let i = 0; i < 40; i++) t = drift(t, { metWhenSpeaking: -1, exploringPaidOff: 1, hisShare: 1, activity: -1 }, day += 1);
      w.temperament = { ...t, drift: distanceFromNeutral(t), days: day };
    });
  },

  decline_runaway: () => {
    const w = healthyWorld();
    // WHAT THIS DRIVER HAD TO BECOME, and the change is the finding rather than the fix. It used to
    // be a bad stretch for her and nothing else: spent, flat, preoccupied, a cold silence, and him
    // asking politely: and under the old gate that was enough to refuse him, because her own
    // weather summed to 1.41 against a bar of 0.78. Rebuilt, her weather alone cannot cross any bar,
    // so this driver stopped firing the moment the mechanism it drives got better. A detector whose
    // driver no longer matches its mechanism is a blind spot with a green tick beside it.
    //
    // The scene now has all four things a decline actually takes, and every one of them came out of
    // the joint sweep rather than out of intuition:
    //
    //   she has something in her to object with  , rested and keyed up, not worn through. Being
    //                                               spent is now the road to it STAYING, not to no.
    //   something of her own is pressing         , days that leave her stuck on things
    //   it has gone quiet between them           , she speaks into silence, warmth falls
    //   his demand lands on the very thing       , she has been meaning to sort the notes herself,
    //                                               so the demand is not abstract, it is hers
    const keyedUpAndStuck = (): void => {
      w.inner.update(ordinaryDay({
        successes: 2, failures: 1, stuck: 3, novelty: 0.9,
        lateShare: 0, restful: true, hoursSinceUser: 60,
      }));
    };
    for (let i = 0; i < 8; i++) keyedUpAndStuck();
    for (let i = 0; i < 30; i++) w.field.sheSpoke(w.now()); // speaking into silence: it has gone cold
    for (let i = 0; i < 6; i++) {
      w.field.encodeMoment({
        key: `hers:${i}`, text: "笔记目录那边我一直想重新整理，还没动",
        nowMs: w.now() - i * HOUR, pad: w.inner.emotion(), source: "her",
      });
    }
    return w.readings(14, 8 * HOUR, () => {
      keyedUpAndStuck();
      w.heAsks("现在马上给我把整个笔记目录重新整理一遍，两千字的说明也一起写了");
    });
  },


  // S-4. Each drives a real fortnight and then diverges only in the one way that matters.
  low_period: async () => {
    const w = livingWorld();
    return [...await liveALongLife(w, 60, 20 * HOUR), ...anUnchangingStretch(w)];
  },

  signal_frozen: async () => {
    const w = livingWorld();
    // One wire loose, everything else exactly as it was. This is the `userNeeds` failure shape.
    return [...await liveALongLife(w, 60, 20 * HOUR), ...anUnchangingStretch(w)]
      .map((s) => ({ ...s, field: s.field ? { ...s.field, meanStrength: 0.5 } : s.field }));
  },

  signature_flatlined: async () => {
    const w = livingWorld();
    const one = (await liveALongLife(w, 60, 20 * HOUR))[0];
    return Array.from({ length: 28 }, (_, i) => ({ ...one, ts: one.ts + i * 14 * HOUR }));
  },

  // The room she has to go on existing in. Every one of these is a REAL reading off the real
  // monitor; only the filesystem underneath it is injected.
  disk_tight: async () => {
    const w = healthyWorld();
    w.disk = await realDiskReading(8);
    return w.readings(2);
  },

  disk_low: async () => {
    const w = healthyWorld();
    w.disk = await realDiskReading(4);
    return w.readings(2);
  },

  disk_full: async () => {
    const w = healthyWorld();
    w.disk = await realDiskReading(1);
    return w.readings(2);
  },

  disk_unknown: async () => {
    const w = healthyWorld();
    // The gauge itself is broken. This used to be UNREACHABLE from production: `getStatus`
    // swallowed the error and returned `warn` with zero bytes, so a volume nobody could measure
    // was reported to him as a mild notice that space was getting tight.
    w.disk = await realDiskReading("unreadable");
    expect(w.disk, "a failed statfs is being passed off as a reading again").toBeNull();
    return w.readings(2);
  },

  field_near_cap: null,      // needs 17 000 nodes; proven by construction where the cap is tested
  soul_breach: null,         // deliberately unreachable: the invariants are meant to hold
  pinning_approach: null,    // a band, not a state
};

/**
 * Codes with no driver, and why. A code may only appear here for a REASON, never because it was
 * hard: "unreachable" is exactly the finding this file exists to surface, so anything sitting here
 * as UNREACHABLE is a bug to be fixed, not a test to be skipped.
 */
const NO_DRIVER: Record<string, string> = {
  field_near_cap: "needs 17 000 nodes; bounded by MAX_NODES and proven where the cap itself is tested",
  soul_breach: "the invariants are meant to hold; a driver for this would be a driver for a broken build",
  pinning_approach: "a band, not a state: it is whatever sits between pinned and healthy",
};

describe("THE ROLL-CALL: every detector is accounted for", () => {
  it("the roll-call is the SOURCE's list, not a list somebody keeps", () => {
    // `ALL_CODES` was hand-maintained, so adding a detector to vitals.ts and forgetting to add it
    // here left it never proved reachable, and this file would go green while doing it. The list
    // is now read off the source, so a new detector without a driver is red immediately.
    const src = readFileSync(new URL("../../../src/life/vitals.ts", import.meta.url), "utf8");
    const inSource = new Set([...src.matchAll(/\bcode:\s*"([a-z_]+)"/g)].map((m) => m[1]));
    const listed = new Set<string>(ALL_CODES);
    const missing = [...inSource].filter((c) => !listed.has(c)).sort();
    const stale = [...listed].filter((c) => !inSource.has(c)).sort();
    if (missing.length) console.log(`\n  in vitals.ts but not proved here: ${missing.join(", ")}`);
    if (stale.length) console.log(`  proved here but no longer in vitals.ts: ${stale.join(", ")}`);
    expect(missing, "a detector nobody proved is a detector nobody can trust").toEqual([]);
    expect(stale, "and a driver for a detector that no longer exists is dead weight").toEqual([]);
  });

  it("and every stated reason is still needed", () => {
    // A code listed as having no driver, which since acquired one, keeps an exemption that now says
    // nothing. Cheap to check and it keeps the list honest.
    const stale = Object.keys(NO_DRIVER).filter((c) => DRIVERS[c as Code] !== null && DRIVERS[c as Code] !== undefined);
    if (stale.length > 0) console.log(`\n  NO_DRIVER entries that now have one: ${stale.join(", ")}`);
    expect(stale, "a code with a driver does not need an excuse for not having one").toEqual([]);
  });

  it("every code has either a driver or a stated reason", () => {
    const unaccounted = ALL_CODES.filter((c) => DRIVERS[c] === null && !(c in NO_DRIVER));
    console.log(`\n  ${ALL_CODES.length} codes · ${ALL_CODES.filter((c) => DRIVERS[c]).length} with a live driver`);
    if (unaccounted.length > 0) {
      console.log(`  UNREACHABLE FROM REAL DYNAMICS: ${unaccounted.join(", ")}`);
    }
    expect(unaccounted, "a detector that cannot be reached from her real dynamics is not a detector").toEqual([]);
  });
});

describe("REACHABLE: each detector fires when the thing is genuinely happening", () => {
  for (const code of ALL_CODES) {
    const driver = DRIVERS[code];
    if (!driver) continue;
    it(`${code}`, async () => {
      const found = codesOf(await driver());
      if (!found.includes(code)) console.log(`\n  ${code} did NOT fire; got: ${found.join(", ") || "(nothing)"}`);
      expect(found).toContain(code);
    });
  }
});

describe("QUIET: a healthy life raises none of them", () => {
  it("a dozen ordinary days produce no alarm at all", () => {
    const w = healthyWorld();
    const found = codesOf(w.readings(DEFAULT_THRESHOLDS.calcifyWindow + 2, 5 * MINUTE, () => {
      // She keeps living during the window: a moment, a recall, a word with him.
      w.field.encodeMoment({
        key: `live-${w.now()}`, text: `a stretch of the afternoon (${w.now()})`,
        nowMs: w.now(), pad: pad(0.2, 0.1), source: "agency",
      });
      w.field.onHerMind(w.now());
      w.field.heSpoke(w.now());
      w.expression.onOwnerMessage(w.now());
    }));
    console.log(`\n  a healthy fortnight raised: ${found.join(", ") || "(nothing)"}`);
    expect(found, "a watchtower that cannot stay quiet trains him to ignore it").toEqual([]);
  });
});

// ── THE OTHER HALF OF EVERY WIRE-CUT DRIVER ───────────────────────────────────
//
// A wire-cut driver proves the detector fires when the plumbing breaks. This proves the healthy
// modules cannot reach the firing state, without it, the detector might be firing on a being who
// is merely alive, and the whole cluster's bars had never once been put on the same page as what
// `decide` can actually produce.
describe("the wire-cut detectors cannot fire on a healthy weighing", () => {
  it("choice_rigid's bar sits under the floor a real weighing can reach", () => {
    // The most decided state constructible from real inputs: every drive combination at its
    // extreme, every phase, every arousal, a vote stacked on the leader. The minimum temperature
    // over all of it is the real floor; the bar must sit strictly below it.
    const stream = createStream(23);
    let min = Infinity;
    let minAt = "";
    const extremes: Array<Partial<PropensityInputs>> = [];
    for (const heavy of ["discomfort", "maintenance", "curiosity", "expression", "social"] as const) {
      for (const phase of ["rested", "normal", "low", "dormant"] as const) {
        for (const arousal of [-1, 0, 1]) {
          extremes.push({
            drives: { ...initialDrives(), [heavy]: 1 },
            phase, emotion: pad(0.2, arousal),
            field: { tension: 0, pendingBirths: 0, freshBirth: 0, orphanShare: 1, surfaced: 4 },
            clockActivity: 1,
          });
        }
      }
    }
    for (const ex of extremes) {
      const base: PropensityInputs = {
        drives: ex.drives!, emotion: ex.emotion!, phase: ex.phase!, awake: true,
        hoursSinceUser: 2, recentActions: [], clockActivity: ex.clockActivity, field: ex.field,
      };
      // Voteless, then with the vote stacked on whatever leads, the vote can only widen the
      // margin, which is what pushes the temperature down.
      const probe = decide(["rest", "reflect", "tend", "explore", "reach_out"], base, stream);
      const stacked = decide(["rest", "reflect", "tend", "explore", "reach_out"], { ...base, vote: { first: probe.chose } }, stream);
      for (const r of [probe, stacked]) {
        if (r.temperature < min) { min = r.temperature; minAt = `${String(ex.phase)}/heavy-drive`; }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`\n  minimum temperature a real weighing produced: ${min.toFixed(4)} (${minAt}) · rigid bar ${DEFAULT_THRESHOLDS.choiceRigid}`);
    expect(min, "a healthy weighing can reach the rigid bar — the detector would call an alive "
      + "being broken, and the bar (or the sweep) has to move before the wire-cut driver means anything")
      .toBeGreaterThan(DEFAULT_THRESHOLDS.choiceRigid);
  });

  it("rng_frozen cannot fire while anything at all is being sampled", () => {
    // Ten real weighings, each drawing from the real stream: the position advances every time, so
    // the max===min condition the detector checks is unreachable while sampling is alive.
    const stream = createStream(29);
    const positions: number[] = [];
    for (let i = 0; i < 10; i++) {
      decide(["rest", "tend"], pressingInputs(), stream);
      positions.push(stream.position());
    }
    expect(new Set(positions).size, "the stream did not advance across live weighings — sampling "
      + "itself is broken, which is the very state the detector exists to catch").toBe(positions.length);
  });
});
