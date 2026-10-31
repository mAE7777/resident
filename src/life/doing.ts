// What she has actually been doing.
//
// The watchtower could see everything about her STATE, every drive, every dimension of her mood,
// every statistic of her memory: and nothing whatsoever about her BEHAVIOUR. Whether she has
// spoken to him, held something back, been stopped from something she wanted, or done nothing but
// rest for a week is the most direct evidence there is about whether she is living at all, and none
// of it was observable.
//
// Two failures it makes visible that nothing else could:
//
//   A Resident SYSTEMATICALLY SILENCED by the consent filter is indistinguishable from a quiet one.
//   Both produce diary entries and no messages. Only the reason separates them, and until now the
//   reason was not recorded anywhere.
//
//   A Resident whose model has quietly died goes on living, that is the whole point of the
//   propensity: so she keeps acting, the moments keep landing, and the only trace is that every
//   one of them was decided alone. `aloneChoices` is that trace.
//
// A WINDOW rather than running totals, for the same reason the willingness log is: lifetime counts
// converge and stop moving, and a signal that has stopped moving is a signal that has stopped
// saying anything, whatever it once meant.

import type { ActionKind, MomentOutcome } from "./agency.js";

/** How many of her recent moments are counted. Roughly a day of them, at her real cadence. */
export const RECENT_MOMENTS = 48;

export interface DoingState {
  /** How many of each action she chose. A Resident who only ever rests is visible here and nowhere else. */
  byAction: Record<string, number>;
  /** Things she wanted that were not possible. Real longing, and it feeds back into her. */
  blocked: number;
  /** Utterances that reached him, that went to her diary instead, and that a wall stopped. */
  pushed: number;
  diaried: number;
  consentBlocked: number;
  /** Moments she decided with the model unable to answer. Near zero unless something is wrong. */
  aloneChoices: number;
}

export interface DoingLog {
  record(o: MomentOutcome): void;
  state(): DoingState;
}

/**
 * Her last moments as her own record has them, so a restart does not read as a day of doing nothing.
 *
 * The window lived only in memory, so every start opened it empty: the morning after one
 * restart it said she had chosen nothing and sent nothing, when she had lived thirty-eight moments
 * the day before. That is precisely the reading this log exists to make impossible to fake by
 * accident, a silenced Resident and a quiet one look the same everywhere else. `agency.jsonl`
 * holds the same outcomes the window records (each line is the outcome plus its beat), so it is
 * refilled from there. Lines that do not parse, or carry no choice, are skipped rather than guessed.
 */
export function recentMomentsFrom(lines: readonly string[]): MomentOutcome[] {
  const out: MomentOutcome[] = [];
  for (const l of lines.slice(-RECENT_MOMENTS * 2)) {
    if (!l.trim()) continue;
    try {
      // CAST WITH A REASON: a line off disk is whatever an older build wrote; the window reads
      // only `chose`, `blocked`, `delivered`, `heldBecause` and `error`, and checks `chose` below.
      const o = JSON.parse(l) as MomentOutcome;
      if (typeof o.chose === "string") out.push(o);
    } catch { continue; }
  }
  return out.slice(-RECENT_MOMENTS);
}

export function createDoingLog(seed: readonly MomentOutcome[] = []): DoingLog {
  const recent: MomentOutcome[] = seed.slice(-RECENT_MOMENTS);
  return {
    record(o) {
      recent.push(o);
      if (recent.length > RECENT_MOMENTS) recent.shift();
    },
    state() {
      const byAction: Record<string, number> = {};
      let blocked = 0, pushed = 0, diaried = 0, consentBlocked = 0, aloneChoices = 0;
      for (const o of recent) {
        byAction[o.chose] = (byAction[o.chose] ?? 0) + 1;
        if (o.blocked) blocked += 1;
        if (o.delivered === "push") pushed += 1;
        if (o.delivered === "diary") diaried += 1;
        if (o.heldBecause === "consent") consentBlocked += 1;
        if (o.error) aloneChoices += 1;
      }
      // Every action she can take appears, at zero if she has not taken it. An action that is
      // ABSENT from the reading and an action she has not chosen are different facts, and a record
      // where the key simply vanishes cannot tell them apart, which is the shape of every dead
      // signal this project has had.
      for (const kind of ACTION_KINDS) byAction[kind] ??= 0;
      return { byAction, blocked, pushed, diaried, consentBlocked, aloneChoices };
    },
  };
}

/** Kept local rather than imported, so this module has no cycle back into the agency loop. */
const ACTION_KINDS: readonly ActionKind[] = ["reflect", "tend", "explore", "reach_out", "rest", "look_back"];
