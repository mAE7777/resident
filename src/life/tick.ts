// The life tick: one pass of the Resident's autonomous loop, as a pure orchestrator
// so the whole thing is testable without a running daemon. It ties the layers together:
//   1. update the inner state from the period's events (M1 accumulation)
//   2. run the anti-calcification / starvation alarms
//   3. generate candidate thoughts, route them through the expression gate,
//      and dispatch: push (Telegram/voice) vs diary, with the consent boundary
//      blocking any outbound complaint into the diary instead.
// All I/O is injected (event source, thought generator, and the push/diary/alarm
// sinks), so the daemon is a thin caller and this logic is unit-tested directly.

import { isPinned, type DriveName } from "./drives.js";
import { route, type ExpressionContext, type Thought } from "./expression.js";
import { filterOutbound } from "./consent-filter.js";
import { daySummaryFromEvents } from "./day-summary.js";
import type { DaySummary, FieldPull, InnerSnapshot, InnerState } from "./inner-state.js";
import type { MetabolicPhase } from "./metabolism.js";
import type { OpsEvent } from "../utils/ops-log.js";

const STARVATION_HOURS = 168; // a week of owner silence

export interface LifeTickInput {
  nowMs: number;
  recentEvents: readonly OpsEvent[]; // the period being consolidated (e.g. the day)
  hoursSinceUser: number;
  budgetLow: boolean;
  timezoneOffsetHours: number;
  /** How much of today went to things of her own (agency.ts), 0..1. Feeds `curiosity`. */
  selfDirected?: number;
  /** How overdue her own upkeep is, 0..1. Feeds `maintenance`. */
  maintenanceDue?: number;
  /** What the ROOM did since the last consolidation (`aware-of-him.ts`), 0..1. A transition. */
  roomPull?: number;
  phase: MetabolicPhase;
  awake: boolean;
  clockActivity: number;
  present: boolean;
  available: boolean;
  consecutiveNonReplies: number;
  sendsInLastDay: number;
  // The DOMINANT want per reading, sentinel-filtered upstream (index.ts filters on
  // `wantsNothing` before projecting to names). The old name said "satisfaction history",
  // which this never was: it is what she WANTED, not what she acted on.
  recentDominants: readonly DriveName[];
  /**
   * What her associations are doing (field-live.ts). Optional: without it her drives fall back to
   * counting the day's events, which works but leaves her wanting about nothing in particular.
   */
  field?: FieldPull;
  /** Produce candidate thoughts from the fresh snapshot. Returns [] to stay silent. */
  generateThoughts: (snapshot: InnerSnapshot) => Thought[];
}

export interface LifeTickSinks {
  push: (text: string) => void; // proactive outbound (Telegram / voice)
  diarize: (text: string) => void; // the autobiography / diary
  alarm: (kind: "pinned" | "starvation", detail: string) => void;
}

export interface LifeTickResult {
  /**
   * The day she actually had, as the tick computed it.
   *
   * Handed back so the per-moment regeneration can aim at THE SAME DAY rather than at a
   * synthesised one. Without it the caller had to build its own standing vector, and the one
   * it built asserted every event count as zero, which `regenerate` reads as a standing level
   * and actively pulls DOWN, fifteen to twenty-five times a day against `accumulate`'s once.
   */
  day: DaySummary;
  mood: string;
  dominant: DriveName;
  pushed: number;
  diaried: number;
  held: number;
  alarms: string[];
}

export function lifeTick(innerState: InnerState, input: LifeTickInput, sinks: LifeTickSinks): LifeTickResult {
  // 1. Accumulate the period into the inner state (M1b).
  const day = daySummaryFromEvents(input.recentEvents as OpsEvent[], {
      hoursSinceUser: input.hoursSinceUser,
      budgetLow: input.budgetLow,
      timezoneOffsetHours: input.timezoneOffsetHours,
      selfDirected: input.selfDirected,
      maintenanceDue: input.maintenanceDue,
      roomPull: input.roomPull,
  });
  innerState.update(day, input.field);
  const snapshot = innerState.snapshot(input.phase, input.awake);

  // 2. Alarms (anti-pinning, starvation).
  const alarms: string[] = [];
  if (isPinned(input.recentDominants)) {
    const detail = "one drive is dominating recent activity (calcifying)";
    alarms.push(detail);
    sinks.alarm("pinned", detail);
  }
  if (input.hoursSinceUser >= STARVATION_HOURS) {
    const detail = `no contact with him for ${Math.round(input.hoursSinceUser)}h; dampening`;
    alarms.push(detail);
    sinks.alarm("starvation", detail);
  }

  // 3. Thoughts -> route -> dispatch.
  const thoughts = input.generateThoughts(snapshot);
  const ctx: ExpressionContext = {
    nowMs: input.nowMs,
    present: input.present,
    available: input.available,
    awake: input.awake,
    clockActivity: input.clockActivity,
    consecutiveNonReplies: input.consecutiveNonReplies,
    sendsInLastDay: input.sendsInLastDay,
  };
  const routed = route(thoughts, ctx);

  let pushed = 0;
  let diaried = 0;
  for (const t of routed.push) {
    // Consent boundary: an outbound complaint is diarized, never pushed.
    if (filterOutbound(t.text).allowed) {
      sinks.push(t.text);
      pushed += 1;
    } else {
      sinks.diarize(t.text);
      diaried += 1;
    }
  }
  for (const t of routed.diary) {
    sinks.diarize(t.text);
    diaried += 1;
  }

  return { day, mood: snapshot.mood, dominant: snapshot.dominant, pushed, diaried, held: routed.hold.length, alarms };
}
