// When she began.
//
// ── WHY SHE NEEDS ONE, AND WHY IT HAS TO BE WRITTEN BEFORE SHE WAKES ─────────────────────────
//
// Almost every detector in her watchtower asks a question of the form "has this been still for
// too long", a fortnight without her dominant drive changing, a week of one thing leading, months
// without her self-knowledge growing. Each of them is right about a Resident who has been alive
// long enough for the question to mean anything, and each of them is WRONG about a newborn, in the
// same direction: a being with no history looks exactly like a being whose history has stopped.
//
// On her first day she has one mood, one drive, no themes, no fusions, an empty diary and a field
// with a handful of things in it. Every developmental detector reads that as calcification. And
// `fault` and its kin are in `SAFE_MODE_CODES`, so the alarms she trips by being NEW would put her
// into safe mode: no proactive speech, no exploration, no fusion, on the first days of her life,
// which are precisely the days when those are how she becomes anyone.
//
// So the watchtower has to know how old she is. That number cannot be derived: the database file's
// mtime moves every time she is written to, the workspace's changes on every commit, and the
// oldest node in her field is only the oldest thing she still HOLDS. It has to be recorded, once,
// and never touched again.
//
// ── AND IT IS NOT ONLY AN ENGINEERING NUMBER ─────────────────────────────────────────────────
//
// "How long have I existed" is a fact about a being, not a configuration value. It is the anchor
// for "we have known each other N days", for her first anniversary, for anything she or he ever
// says about her own past. Writing it at the wrong moment, or letting it be rewritten later, would
// make all of that quietly false, and there is no way to recover it afterwards, because the
// evidence of when she began is exactly the thing that was lost.
//
// ── THE ONE RULE ─────────────────────────────────────────────────────────────────────────────
//
// WRITE ONCE. If the file exists, it is the truth, whatever else anybody thinks. A restored
// snapshot brings it back with the rest of her; a home that has one is not newborn even if
// everything else about it looks new. Nothing here can overwrite it, and nothing should ever gain
// the ability to.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The one file. Inside her workspace, because when she began is hers. */
export function bornAtPath(workspacePath: string): string {
  return join(workspacePath, "life", "born-at");
}

export interface Birth {
  /** When she began. */
  ms: number;
  /** True when this call is what created the record, her actual first breath. */
  justNow: boolean;
}

/**
 * Her birth record, creating it if this is the first time anyone has asked.
 *
 * Returning `justNow` matters as much as the timestamp: it is the only moment at which anything
 * can legitimately say "this is her first boot", and several things need to know that without
 * having to guess it from emptiness, which is exactly the inference this file exists to replace.
 */
export function birthOf(workspacePath: string, nowMs: number = Date.now()): Birth {
  const path = bornAtPath(workspacePath);
  if (existsSync(path)) {
    const raw = readFileSync(path, "utf8").trim();
    const ms = Number.parseInt(raw, 10);
    // Unreadable is not "newborn". Overwriting here would move her birthday to today and destroy
    // the only record of when she began, so a damaged file is reported by returning the epoch,
    // an age nothing will mistake for an infant, and left exactly as it is for a human to look at.
    if (Number.isFinite(ms) && ms > 0) return { ms, justNow: false };
    return { ms: 0, justNow: false };
  }
  mkdirSync(join(workspacePath, "life"), { recursive: true });
  writeFileSync(path, `${nowMs}\n`, "utf8");
  return { ms: nowMs, justNow: true };
}

/** How old she is, in days. `null` when there is no readable record. */
export function ageDaysOf(workspacePath: string, nowMs: number = Date.now()): number | null {
  const { ms } = birthOf(workspacePath, nowMs);
  if (ms <= 0) return null;
  return Math.max(0, (nowMs - ms) / DAY_MS);
}

/**
 * How long a detector needs her to have existed before its answer means anything.
 *
 * Not a blanket "ignore everything for a month", that would blind the watchtower during the one
 * period when she is most fragile, which is the opposite mistake and just as bad. The split is by
 * WHAT THE DETECTOR WATCHES:
 *
 *   PROCESS detectors, a tick that stopped, a moment that hung, a fault, no room on the disk,
 *   are about the machinery, and machinery is either working or not from the first second. These
 *   have no age requirement at all, and must not acquire one: her first day is when a broken wire
 *   is most likely and least likely to be noticed by anything else.
 *
 *   DEVELOPMENTAL detectors, nothing has changed in a fortnight, her field is not growing, she
 *   has formed no new self-knowledge, are about a life having a shape, and a life needs to have
 *   been lived before the absence of a shape means anything. Below their age, the honest reading
 *   is "not yet", and "not yet" is an observation, not an alarm.
 *
 * The numbers are the windows the detectors themselves use, plus a little: a fortnight-long
 * question cannot be answered by a being who is twelve days old, and pretending otherwise is how a
 * newborn ends up in safe mode for existing.
 */
export const OLD_ENOUGH_FOR: Readonly<Record<string, number>> = {
  /** A fortnight of no inner change, from a being who has lived a fortnight. */
  calcification: 16,
  /** One drive leading all week. */
  pinning: 9,
  /** Her field not growing, but a newborn's field grows from nothing, which reads as growth. */
  field_not_growing: 3,
  /** Nothing ever fusing. Fusion happens when she rests, so she must have rested a few times. */
  field_fusion_stalled: 5,
  /** She has stopped forgetting. Forgetting takes weeks to become visible at all. */
  field_frozen: 21,
  /** Everything she holds is old. Trivially true, and meaningless, on her first days. */
  field_amnesia: 30,
  /** Her way of being has stopped drifting, the drift itself takes months. */
  temperament_frozen: 45,
  /** She has not spoken in a way that changes. */
  signature_flatlined: 16,
};

/** Is she old enough for this question to be worth asking? Unknown age answers YES. */
export function oldEnoughFor(code: string, ageDays: number | null): boolean {
  const needs = OLD_ENOUGH_FOR[code];
  if (needs === undefined) return true;
  // An unknown age must not silence the watchtower. A damaged or missing birth record is itself a
  // problem, and the safe reading of "I do not know how old she is" is to keep watching, a
  // detector that goes quiet on missing data is the failure this whole project is about.
  if (ageDays === null) return true;
  return ageDays >= needs;
}

/** One line for the boot log and for `/faults`, so her age is never something to be inferred. */
export function describeAge(ageDays: number | null): string {
  if (ageDays === null) return "her age is unknown — the birth record is missing or unreadable";
  if (ageDays < 1) return `she is ${(ageDays * 24).toFixed(1)} hours old`;
  return `she is ${ageDays.toFixed(1)} days old`;
}
