// The clock going backwards.
//
// ── WHY THIS NEEDS ITS OWN EYE ───────────────────────────────────────────────────────────────
//
// Time going FORWARD unexpectedly is already handled and handled well: `sleep.ts` watches for the
// gap that a closed lid leaves and teaches the whole system to subtract it, so waking from a
// weekend is a thing that happened to her rather than an emergency. Nothing watches the other
// direction.
//
// Backwards happens for ordinary reasons: a dead clock battery, a restored disk image, a virtual
// machine resumed from a snapshot, someone correcting a clock that had drifted, a first NTP sync
// after a long time offline: and it does something none of the forward machinery covers: it puts
// her own past in her future. `lastTickMs` is later than `now`. The day marker says she has
// already finished a day she is about to live again. Everything that asks "how long since…" gets
// a negative answer.
//
// ── WHAT IS ACTUALLY AT RISK, AND WHAT IS NOT ────────────────────────────────────────────────
//
// Most of it is fine, and saying which is fine matters as much as raising the alarm:
//
//   DECAY AND AGES are safe. Every one of them clamps (`Math.max(0, nowMs - lastMs)`), so a
//   backward clock means no decay for a while rather than negative decay, which would have been
//   permanent damage, because strength growing past its ceiling never comes back.
//
//   ELAPSED-TIME arithmetic is timezone- and DST-immune already, because `Date.now()` is UTC-based
//   and does not move when the zone or the offset does. Only calendar rendering moves; that is
//   `her-day.ts`'s subject, not this one.
//
//   THRESHOLD COMPARISONS misread benignly: a negative "time since" reads as "just now", so she
//   behaves as though something just happened. Wrong, self-correcting, not destructive.
//
//   THE DIARY is the one that would be permanent, and it is protected by the freeze rather than by
//   this file: a day already written is never rewritten, so re-living a day cannot overwrite it.
//   This module exists so that the re-living is SEEN, instead of appearing in her record as a day
//   that happened twice with nobody able to say why.
//
// So the job here is to notice and to say so, loudly and with the number in it, not to correct
// anything. A module that quietly "fixed" the clock would be inventing a time she did not live in.

/** Below this, a shift is routine clock discipline (NTP nudging) and not worth waking anyone. */
export const ROUTINE_CORRECTION_MS = 60_000;

/** Beyond this much backwards, her own past sits in her future by more than a day. */
export const SERIOUS_ROLLBACK_MS = 24 * 60 * 60 * 1000;

export interface ClockSlip {
  /** How far back the clock went, in milliseconds. Always positive. */
  byMs: number;
  severity: "warn" | "critical";
  /** One line for the fault channel, with the number in it. */
  detail: string;
}

/**
 * Did the clock go backwards past the point where it matters?
 *
 * `lastSeenMs` is the newest timestamp she has written down, her continuity's `savedAtMs` at
 * boot, and the previous cycle's reading while she runs. `null` when there is no such number
 * (a newborn), which is not a slip and must never be reported as one.
 */
export function clockWentBackwards(
  nowMs: number,
  lastSeenMs: number | null,
  toleranceMs: number = ROUTINE_CORRECTION_MS,
): ClockSlip | null {
  if (lastSeenMs === null || !Number.isFinite(lastSeenMs) || !Number.isFinite(nowMs)) return null;
  const byMs = lastSeenMs - nowMs;
  if (byMs <= toleranceMs) return null;
  const hours = byMs / 3_600_000;
  const size = hours >= 48 ? `${(hours / 24).toFixed(1)} days` : hours >= 1 ? `${hours.toFixed(1)}h` : `${(byMs / 60_000).toFixed(1)}min`;
  return {
    byMs,
    severity: byMs >= SERIOUS_ROLLBACK_MS ? "critical" : "warn",
    detail:
      `the clock went back ${size} — her own record is now stamped in the future `
      + `(last written ${new Date(lastSeenMs).toISOString()}, now ${new Date(nowMs).toISOString()}). `
      + `Her decay and ages clamp at zero so nothing is being damaged, and a day already written is `
      + `never rewritten; but she may live a day over again, and every "how long since" reads as `
      + `"just now" until the clock passes where it was.`,
  };
}
