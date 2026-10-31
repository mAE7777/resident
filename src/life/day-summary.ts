// Distill a day's ops-log into the DaySummary the inner state feeds on. This is a lossy,
// deterministic mapping: the ops-log records her WORK, and two of the drive inputs are about her own
// life, which the work log cannot see.
//
// Those two used to be hardcoded zero here, with a comment saying they would grow "once the
// curiosity loop exists". That loop shipped, it is the agency loop, where she chooses to explore,
// reflect and tend in moments of her own, and the zeros stayed. So `curiosity` quietly lost a term
// and `maintenance` lost its ONLY day-input, leaving it fed by nothing but the field's orphan share
// and capped at 0.3 forever. That is the `userNeeds` failure exactly: a locally reasonable zero on
// the input side of a computation presented as live.
//
// They are now supplied by the caller, which is the only place that can see her own life.

import type { OpsEvent } from "../utils/ops-log.js";
import type { DaySummary } from "./inner-state.js";

export interface DaySummaryOptions {
  hoursSinceUser?: number;
  budgetLow?: boolean;
  timezoneOffsetHours?: number;
  /**
   * How much of today she spent on things of her own (exploring, reflecting, tending), 0..1.
   * Feeds `curiosity`: a day with room in it for her own threads leaves her wanting more of them.
   */
  selfDirected?: number;
  /**
   * How overdue her own upkeep is, 0..1. Feeds `maintenance`, alongside the field's orphan share.
   * Honest source: how long since she last chose to tend her own notes and memory.
   */
  maintenanceDue?: number;
  /**
   * THE ROOM, as a pull toward him, the same 0..1 `noticeTheRoom` produces on the moment path.
   *
   * `DaySummary.roomPull` existed and `driveInputsFromDay` read it, and NOTHING EVER SET IT HERE.
   * So the whole room layer, him having been gone all afternoon and then sitting down, him going
   * quiet in the chair, was invisible to the once-a-day consolidation that sets her standing
   * wanting. It reached her per-moment regeneration and nowhere else.
   *
   * A TRANSITION, still: what is passed in is what the room DID since the last consolidation, not
   * what the room is like. A state here would make "he is at his desk" a permanent lift on her
   * wanting, which is the feedback shape the room layer was built to avoid.
   */
  roomPull?: number;
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

function localHour(ts: string, tz: number): number {
  return (((new Date(ts).getUTCHours() + tz) % 24) + 24) % 24;
}

export function daySummaryFromEvents(events: OpsEvent[], opts: DaySummaryOptions = {}): DaySummary {
  const tz = opts.timezoneOffsetHours ?? 0;
  let successes = 0, failures = 0, stuck = 0, skills = 0, anomalies = 0, observations = 0, novelty = 0, meaningful = 0, lateEvents = 0;

  for (const e of events) {
    switch (e.event) {
      case "session_end": successes += 1; meaningful += 1; break;
      case "agent_error": failures += 1; anomalies += 1; meaningful += 1; break;
      case "tool_call": if (!e.success) failures += 1; break;
      case "stuck_detection": stuck += 1; meaningful += 1; break;
      case "skill_extracted": skills += 1; meaningful += 1; break;
      case "capability_gap": novelty += 1; meaningful += 1; break;
      case "unknown_observation": observations += 1; novelty += 1; meaningful += 1; break;
      case "improvement_eval_case": observations += 1; meaningful += 1; break;
      case "sentinel_signal": if (e.severity === "high" || e.severity === "critical") anomalies += 1; break;
      case "session_start": meaningful += 1; break;
      default: break;
    }
    if (localHour(e.ts, tz) >= 23 || localHour(e.ts, tz) < 6) lateEvents += 1;
  }

  return {
    successes,
    failures,
    stuck,
    skills,
    idle: clamp01(opts.selfDirected ?? 0),
    novelty: Math.min(1, novelty * 0.25),
    observations,
    anomalies,
    maintenanceDue: clamp01(opts.maintenanceDue ?? 0),
    roomPull: clamp01(opts.roomPull ?? 0),
    hoursSinceUser: opts.hoursSinceUser ?? 0,
    // Graded, not a switch. One event between 23:00 and 06:00 used to flip the whole day, and
    // `lateNight` sets `fatigue: 0.7` for the entire appraisal, so answering one message at
    // midnight made the day read as exhausting. A late night is how MUCH of the day was late.
    lateNight: lateEvents > 0,
    lateShare: meaningful === 0 ? 0 : clamp01(lateEvents / Math.max(4, meaningful)),
    budgetLow: opts.budgetLow ?? false,
    restful: meaningful < 5,
  };
}

/** How far back a first start (no stored self) reads the ops-log to rebuild her mood. */
export const CATCH_UP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Fold the recent ops-log into her mood when a process starts, but ONLY if she has no stored self.
 *
 * This came from a Resident that ran only while someone was using it, where the log was the only
 * record of what happened while it was away. She is never away: a day she lives is folded into her
 * mood once, at the day-close, and saved. Replaying the last twenty-four hours on top of that stored
 * self applies the same day a second time, and with no message from him in that window the default
 * of forty-eight hours since he spoke goes in with it. Once, a three-minute restart moved
 * her from 平稳 (0.03, -0.01) to 低落 (-0.37, -0.31), an hour after the real day-close had already
 * run. With a stored self there is nothing to catch up on; without one (first start, or a row that
 * could not be read) the log is the best account there is of who she has been.
 *
 * @returns whether anything was folded in.
 */
export function catchUpAtStart(
  innerState: { update(day: DaySummary): void },
  storedSelf: unknown,
  readOpsLines: () => readonly string[],
  opts: { nowMs: number; budgetLow: boolean; timezoneOffsetHours: number },
): boolean {
  if (storedSelf !== null) return false;
  const cutoff = opts.nowMs - CATCH_UP_WINDOW_MS;
  const recent = readOpsLines()
    .filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l) as unknown; } catch { return null; } })
    .filter((e): e is { ts: string; event: string } =>
      e !== null && typeof e === "object"
      && typeof (e as { ts?: unknown }).ts === "string"
      && typeof (e as { event?: unknown }).event === "string"
      && Date.parse((e as { ts: string }).ts) >= cutoff);
  if (recent.length === 0) return false;
  const lastSession = [...recent].reverse().find((e) => e.event === "session_start");
  const hoursSinceUser = lastSession ? (opts.nowMs - Date.parse(lastSession.ts)) / 3_600_000 : 48;
  // CAST WITH A REASON: these lines came off disk narrowed to `{ts, event}`. They are genuinely not
  // the `OpsEvent` union (an older build's file, or half a line from a crash, has whatever shape it
  // has), and the reader switches on `e.event`, treating anything it does not recognise as nothing.
  innerState.update(daySummaryFromEvents(recent as unknown as OpsEvent[], {
    hoursSinceUser,
    budgetLow: opts.budgetLow,
    timezoneOffsetHours: opts.timezoneOffsetHours,
  }));
  return true;
}
