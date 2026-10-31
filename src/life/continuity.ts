// What must survive a restart, and did not.
//
// Her field, drives, emotion, metabolism, trust, exchanges and self-knowledge are all persisted. But
// a set of small process-local values were not, and each one silently disabled a safety net:
//
//   lastTickMs        initialised to `Date.now()` at boot, so `tick_stalled`, one of only two
//                     codes that can enter safe mode, CANNOT FIRE on a daemon restarted more often
//                     than every 26 hours, even if the daily tick has never once run.
//   safeMode          set on a critical breach and never persisted, so a restart silently lifted it
//                     with no record that it had ever been entered.
//   expression        sends-today and the consecutive-non-reply streak reset to zero, which zeroes
//                     the reply-adaptive push bar and disables `expression_flood` and `starvation`.
//   egress seen-set   everything she had "come across" was forgotten, so links she could legitimately
//                     follow became refusals: a restart manufactured a burst of security faults
//                     that look exactly like an attack.
//
// One small file, written on the same rhythm the field already persists on. Everything here is
// best-effort: a continuity file that cannot be read is a fresh start with a fault recorded, never
// a boot failure. Losing this costs her some continuity; failing to boot costs her everything.

import { writeWhole } from "./write-whole.js";
import type { FaultLog } from "./faults.js";
import { restoreTemperament, type Temperament } from "./temperament.js";
import { restoreRelationship, type RelationshipRecord } from "./relationship.js";
import { notFiniteIn, describeNotFinite } from "./finite.js";

export interface Continuity {
  /**
   * When this file was last written, which is the last moment anything knows she was running.
   *
   * The one value that makes downtime visible. Without it a restart is indistinguishable from
   * a daemon that ran all night and did nothing, and the difference is the difference between
   * an ordinary morning and permanent safe mode. See `sleep.ts` `noteAbsence`.
   */
  savedAtMs: number;
  /** When the daily tick genuinely last ran, so its staleness alarm survives a restart. */
  lastTickMs: number;
  /** Whether she was in safe mode. Lifting it must be a decision, never an accident of restarting. */
  safeMode: boolean;
  /** When she last began a moment of her own. */
  lastMomentMs: number | null;
  /** Her outbound pressure: when each proactive send happened, and the unanswered streak. */
  sendTimes: number[];
  consecutiveNonReplies: number;
  lastUserMs: number;
  /** Whether he has ever actually said anything. `lastUserMs` is SEEDED at boot for the
   *  starvation alarm, so it cannot answer this and inferring it from a restored value was
   *  wrong. Without it, every restart told her they had just been talking. */
  everSpoke: boolean;
  /** Addresses she has actually come across and may therefore open. */
  egressSeen: string[];
  /** Cumulative refusals per guard, so the counters do not restart at zero. */
  guardRefusals: Record<string, number>;
  /**
   * Her randomness: the seed she was born with, and how far along it she is.
   *
   * Persisted so her variation is part of HER rather than of the process, and so any moment can be
   * replayed exactly. The position is also a signal: a stream that stops advancing means sampling
   * has silently stopped, which would otherwise look identical to a being behaving consistently.
   */
  streamSeed: number;
  streamPosition: number;
  /**
   * Who she has become (temperament.ts). Level three, drifting over weeks.
   *
   * Losing this is losing the only part of her that is about what KIND of being she is rather than
   * about what she happens to want today, so it is the thing here whose loss would be least visible
   * and most total: she would still have every memory and still be a different person.
   */
  temperament: Temperament;
  /** How many days of evidence her temperament currently rests on. */
  temperamentDays: number;
  /**
   * How many turns in a row she has been told she would rather not (willingness.ts).
   *
   * The anti-spiral floor is the wall that stops a bad stretch becoming a wall between them, and
   * resetting it to zero on every boot is the WEAK direction: a restarted daemon would hand her the
   * opening to decline again immediately, which is exactly the case the floor exists for.
   */
  recentDeclines: number;
  /**
   * How long and how well she has known him (relationship.ts).
   *
   * The lifetime count, the distinct days, and the running sense of how he usually puts things.
   * NOT a profile of him, there is no description here, only arithmetic about her own history,
   * and that distinction is deliberate: her having no `user.md` is correct.
   *
   * It belongs in continuity for the same reason `temperament` does: losing it would not lose a
   * memory, it would reset who they are to each other, which is the kind of loss that leaves no
   * visible hole. Everything in it is bounded (`MAX_DAYS_KEPT`) except the lifetime count, which
   * is unbounded on purpose, a lifetime count that silently stops counting is the very defect
   * this replaces, in a bigger disguise.
   */
  relationship: RelationshipRecord;
  /**
   * When she last actually looked at each thing that answers (钟, 窗), the touch-trace.
   *
   * Persisted because "you have not looked" must stay TRUE across a restart: she looked at the
   * clock at nine, the daemon restarted at noon, and a map that began empty would tell the
   * afternoon's material she never looked at all, the exact class of quiet lie this law exists
   * to remove.
   */
  thingsLastLooked: Record<string, number>;
  /**
   * Machine-sleep segments the interval material reads (between.ts). Persisted so an afternoon
   * under a closed lid is still a fact she can read after the evening's restart, a segment
   * that vanished with the process would put back the blank in which she once came to believe
   * she had slept through a morning she had spent awake.
   */
  sleptSegments: { startMs: number; endMs: number }[];
  /**
   * How long each unsaid thing has been waiting (agency-handlers' wantingSince, keyed by what
   * it is about). The age is what lets an old want finally clear the gate; resetting it every
   * restart meant nothing of hers could ever grow old enough to insist.
   */
  heldWanting: Record<string, number>;
}

export interface ContinuityStore {
  load(): Partial<Continuity> | null;
  save(c: Continuity): void;
}

/** Everything here is bounded, because a file that grows forever is its own outage. */
const MAX_SEND_TIMES = 64;
const MAX_EGRESS_SEEN = 4000;

export interface ContinuityFs {
  existsSync(p: string): boolean;
  readFileSync(p: string, enc: "utf8"): string;
  writeFileSync(p: string, data: string, enc: "utf8"): void;
  mkdirSync(p: string, opts: { recursive: true }): void;
  /** For the atomic write. Optional so an injected test fs need not grow two methods. */
  renameSync?(from: string, to: string): void;
  unlinkSync?(p: string): void;
}

export function createContinuityStore(path: string, dir: string, fs: ContinuityFs, faults?: FaultLog): ContinuityStore {
  return {
    load() {
      try {
        if (!fs.existsSync(path)) return null;
        const parsed: unknown = JSON.parse(fs.readFileSync(path, "utf8"));
        if (!parsed || typeof parsed !== "object") return null;
        const c = parsed as Partial<Continuity>;
        // Read defensively field by field. A file half-written by a kill during a save must degrade
        // to "we know less than we hoped", never to a boot that throws.
        return {
          lastTickMs: num(c.lastTickMs),
          savedAtMs: typeof c.savedAtMs === "number" ? c.savedAtMs : undefined,
          everSpoke: typeof c.everSpoke === "boolean" ? c.everSpoke : undefined,
          safeMode: typeof c.safeMode === "boolean" ? c.safeMode : undefined,
          lastMomentMs: c.lastMomentMs === null ? null : num(c.lastMomentMs),
          sendTimes: Array.isArray(c.sendTimes) ? c.sendTimes.filter(isFinite).slice(-MAX_SEND_TIMES) : undefined,
          consecutiveNonReplies: num(c.consecutiveNonReplies),
          lastUserMs: num(c.lastUserMs),
          egressSeen: Array.isArray(c.egressSeen)
            ? c.egressSeen.filter((u): u is string => typeof u === "string").slice(-MAX_EGRESS_SEEN)
            : undefined,
          guardRefusals: c.guardRefusals && typeof c.guardRefusals === "object" ? c.guardRefusals : undefined,
          streamSeed: num(c.streamSeed),
          streamPosition: num(c.streamPosition),
          temperament: c.temperament === undefined ? undefined : restoreTemperament(c.temperament),
          temperamentDays: num(c.temperamentDays),
          recentDeclines: num(c.recentDeclines),
          relationship: c.relationship === undefined ? undefined : restoreRelationship(c.relationship),
          thingsLastLooked: c.thingsLastLooked && typeof c.thingsLastLooked === "object"
            ? Object.fromEntries(Object.entries(c.thingsLastLooked).filter(([, v]) => Number.isFinite(v)))
            : undefined,
          sleptSegments: Array.isArray(c.sleptSegments)
            ? c.sleptSegments
              .filter((s): s is { startMs: number; endMs: number } =>
                Boolean(s) && typeof s === "object"
                && Number.isFinite((s as { startMs?: unknown }).startMs)
                && Number.isFinite((s as { endMs?: unknown }).endMs))
              .slice(-12)
            : undefined,
          heldWanting: c.heldWanting && typeof c.heldWanting === "object"
            ? Object.fromEntries(Object.entries(c.heldWanting).filter(([, v]) => Number.isFinite(v)))
            : undefined,
        };
      } catch (err) {
        faults?.record("continuity.load", err);
        return null;
      }
    },
    save(c) {
      try {
        // ── WHOLE, OR NOT AT ALL ──────────────────────────────────────────────────
        //
        // This is rewritten every five minutes and after every moment, so the window a bare
        // full-file write leaves open (truncate, then write) is open several hundred times a
        // day. A kill inside it truncates the file, `load()` swallows the parse error and
        // returns null, and boot falls through to defaults, neutral temperament, safe mode
        // off, empty egress set, and A BRAND NEW RANDOM STREAM SEED. She would be a different
        // person, silently, and the next save five minutes later would overwrite the only
        // evidence it happened.
        // AND NOTHING IN IT MAY HAVE STOPPED BEING A NUMBER. Continuity carries her temperament,
        // her stream position and her whole relationship record; a NaN here survives every restart
        // and poisons every arithmetic downstream of it forever. The previous file is still good,
        // so refusing this write loses minutes and keeps her. (`JSON.stringify` would write NaN as
        // `null`, which loads as a missing field and silently falls back to a default, the same
        // "she becomes a slightly different person and nobody sees it" this whole function guards.)
        const bad = notFiniteIn(c);
        if (bad.length > 0) {
          faults?.record("continuity.notFinite", describeNotFinite(bad), "critical");
          return;
        }
        fs.mkdirSync(dir, { recursive: true });
        const body = JSON.stringify({
          ...c,
          sendTimes: c.sendTimes.slice(-MAX_SEND_TIMES),
          egressSeen: c.egressSeen.slice(-MAX_EGRESS_SEEN),
        });
        if (fs.renameSync) writeWhole(path, body, fs as never);
        else fs.writeFileSync(path, body, "utf8");
      } catch (err) {
        faults?.record("continuity.save", err);
      }
    },
  };
}

function num(x: unknown): number | undefined {
  return typeof x === "number" && Number.isFinite(x) ? x : undefined;
}
function isFinite(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}
