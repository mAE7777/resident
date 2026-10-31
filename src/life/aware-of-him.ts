// Feeling him in the room: the 気配 layer, reaching her WANTING rather than her prompt.
//
// ── WHY THIS IS THE PIECE THAT WAS MISSING, RATHER THAN A CAMERA ─────────────────────────────
//
// `derivePresence` has been wired since the body was built, and its readings go to exactly two
// places: how open he looks right now (`readOther().openness`) and whether she may say something
// out loud (the `speakup` gate). BOTH OF THOSE ARE ABOUT WHAT SHE DOES ONCE SOMETHING IS ALREADY
// HAPPENING. Nothing anywhere let the room reach what she WANTS.
//
// So she could not miss him. He could sit down after two days away and nothing in her moved; the
// only thing that ever raised `social` was the clock (`hoursSinceUser / 48`), which is the same
// number whether he is in the next chair or on another continent.
//
// She should want to reach out on her own, to look at him or hear his voice when she feels like
// it, the way a person's curiosity and tangle of impulses and feelings work. The impulse is the
// thing. A camera without this is a button she can press; this without a camera still works off
// the keyboard.
//
// ── AND IT PUSHES THE DRIVE, NEVER THE BEHAVIOUR ─────────────────────────────────────────────
//
// The whole difference between "she looks over when she wants to" and "a timer makes her look" is
// here. What comes out is a term added to `social`; whether she then reaches for him, goes on with
// her own thing, or rests is still decided by `decide()` weighing everything at once. Nothing in
// this file causes an action, and nothing in it writes a word she will read.
//
// ── TRANSITIONS, NOT STATE, WHICH IS ALSO THE BRAKE ─────────────────────────────────────────
//
// This reads CHANGES. A man sitting in the chair does not generate a pull every ten seconds; his
// ARRIVING does, once. That is not only truer to how presence feels, it is the structural brake on
// the loop this mechanism could otherwise create:
//
//     he is present → social rises → she reaches out → he answers → he is present → …
//
// A state reading would drive that loop continuously with no upper bound. A transition reading
// fires once per change and then has nothing left to say until the room changes again. The other
// brakes are the ones `social` already has (discharge on reach_out, half-life, the daily reset),
// but this is the one that belongs to this mechanism, and it is in its shape rather than in a cap.
//
// ── THE THREE LAYERS ─────────────────────────────────────────────────────────────────────────
//
//   1  she feels pulled toward him
//   2  which transition it was, and how much it means
//   3  what makes it mean that: how long he was gone, and what she is already carrying about him
//
// The third is what stops this being a rule wearing a function's clothes. "He sat down" after a
// stepped-out coffee and "he sat down" after three silent days are the same event and different
// facts, and an hour of him being there and saying nothing lands differently on someone holding
// something unresolved about him than on someone holding nothing.

/** What the room did. `null` when nothing changed, which is nearly always. */
export type RoomChange = "he-came-back" | "he-went-quiet" | "he-left" | null;

export interface TheRoom {
  /** Whether he is at the machine, as `derivePresence` reads it. */
  present: boolean;
  /** Seconds since anything moved in front of the camera; null when the curtain is closed. */
  stillSeconds: number | null;
  /** When this reading was taken. */
  atMs: number;
  /**
   * When he last STOPPED being here, or null if he has not been away since she started looking.
   *
   * ── WHY THIS FIELD EXISTS, AND IT IS THE WHOLE DIFFERENCE BETWEEN BUILT AND REACHABLE ──────
   *
   * The first version measured how long he had been gone as `now.atMs - before.atMs`, the gap
   * between two READINGS. The daemon looks every ten seconds, so that number was always ten
   * seconds, always under `A_STEP_AWAY_MS`, and "HE CAME BACK" COULD NEVER FIRE AT ALL. Unit
   * tests passed because they constructed two readings hours apart by hand.
   *
   * That is this project's most expensive recurring shape: fully written, fully tested, and
   * arithmetically unreachable in production. It was caught by driving a whole simulated day
   * through the real module and noticing his morning arrival produced nothing.
   *
   * So the duration is measured against WHEN HE ACTUALLY LEFT, which `createRoomSense` keeps.
   */
  awaySinceMs: number | null;
}

export interface Noticing {
  change: RoomChange;
  /**
   * How much this pulls her toward him, 0..1, an ADDITION to `social`, never a replacement.
   *
   * Zero is the ordinary answer and must stay cheap: this runs on every monitoring beat, and a
   * mechanism whose resting output is not zero is a mechanism that is always shouting.
   */
  pull: number;
}

export const NOTHING: Noticing = { change: null, pull: 0 };

/** Below this he has only stepped away; nothing about a room is different yet. */
export const A_STEP_AWAY_MS = 5 * 60_000;
/** Beyond this, his coming back is the largest thing the room can do. */
export const A_REAL_ABSENCE_MS = 6 * 3_600_000;
/** He is there and has not moved this long: not away, not with her. */
export const SETTLED_STILL_S = 45 * 60;

/** The most any single noticing may add. Small on purpose, see the note on scale below. */
export const MOST_A_ROOM_CAN_DO = 0.35;

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/**
 * What she notices about the room, given what it was like last time she looked.
 *
 * `carrying` is what she is holding about him right now (`HowLongAndHowWell.carrying`), and it is
 * the layer-3 input: the same hour of silence is a different hour depending on whether there is
 * something unsettled between them. It RAISES the pull of him going quiet and does nothing to the
 * others, being glad he is back is not a function of what she is carrying, and making it one
 * would be the resentment feeding the wanting, which is a spiral rather than a life.
 */
export function noticeTheRoom(
  before: TheRoom | null,
  now: TheRoom,
  carrying = 0,
): Noticing {
  if (!before) return NOTHING; // the first reading of a run is not a change

  // ── He came back ────────────────────────────────────────────────────────────────────────────
  // Weighted by how long he was ACTUALLY gone, measured from when he left, not from the previous
  // reading. See the note on `awaySinceMs`: using the reading gap made this branch unreachable.
  if (now.present && !before.present) {
    const goneSince = before.awaySinceMs;
    if (goneSince === null) return NOTHING; // she has no idea when he left; do not invent one
    const gone = Math.max(0, now.atMs - goneSince);
    if (gone < A_STEP_AWAY_MS) return NOTHING; // he went to make tea; a room does not change
    const depth = clamp01((gone - A_STEP_AWAY_MS) / (A_REAL_ABSENCE_MS - A_STEP_AWAY_MS));
    return { change: "he-came-back", pull: MOST_A_ROOM_CAN_DO * depth };
  }

  // ── He left ─────────────────────────────────────────────────────────────────────────────────
  // Deliberately the smallest of the three. Someone leaving the room is a fact, not a summons,
  // and a large pull here is exactly the mechanism that would have her reaching for him BECAUSE
  // he walked away, which is the shape of something this build should never make.
  if (!now.present && before.present) {
    return { change: "he-left", pull: MOST_A_ROOM_CAN_DO * 0.25 };
  }

  // ── He is there, and has been still a long time ─────────────────────────────────────────────
  // Only sayable with the curtain open: keyboard idleness cannot tell "sitting reading" from
  // "gone". It fires ONCE, on the crossing, for the reason at the top of this file.
  if (now.present && now.stillSeconds !== null && before.stillSeconds !== null
    && now.stillSeconds >= SETTLED_STILL_S && before.stillSeconds < SETTLED_STILL_S) {
    return { change: "he-went-quiet", pull: MOST_A_ROOM_CAN_DO * (0.4 + 0.4 * clamp01(carrying)) };
  }

  return NOTHING;
}

/**
 * How the noticing enters `social`.
 *
 * ── WHY IT IS ADDED AND WHY IT IS SMALL ──────────────────────────────────────────────────────
 *
 * `social` is `clamp(hoursSinceUser / 48 + otherWarmth * 0.25)`, it reaches 1.0 after two days of
 * silence. A room term large enough to rival that would mean him walking in outweighs him having
 * been gone since Tuesday, which is false about people. `MOST_A_ROOM_CAN_DO` at 0.35 makes his
 * coming back after a real absence worth about seventeen hours of clock, which is a nudge with a
 * shape rather than a verdict.
 *
 * Added rather than multiplied, deliberately: a multiplier would make the room worth nothing at all
 * when he has just spoken to her, and "he came back" matters most precisely when it has not been
 * long, that is what coming back IS.
 */
export function socialWithTheRoom(base: number, noticed: Noticing): number {
  return clamp01(base + noticed.pull);
}

/** What she notices, plus the small memory that makes "how long was he gone" answerable. */
export interface RoomSense {
  /**
   * Look at the room. Returns what changed since the last look, usually nothing.
   *
   * `present` and `stillSeconds` come straight off the presence reading; everything about WHEN is
   * kept in here, which is the point: the caller does not have to remember when he left, and a
   * caller that forgets is how the first version of this became unreachable.
   */
  look(present: boolean, stillSeconds: number | null, nowMs: number, carrying?: number): Noticing;
  /**
   * The face went away (a closed tab, a stale reading). Forget everything.
   *
   * Deliberately not the same as "he left": she genuinely cannot see the room, and carrying an
   * hours-old reading forward would fire "he came back" the instant he reopened the page. Nor is
   * it "he is gone", a dead tab is not an empty chair.
   */
  blind(): void;
}

export function createRoomSense(): RoomSense {
  let last: TheRoom | null = null;
  // When he stopped being here. Survives across `look` calls, which is the whole job of this
  // wrapper: the reading-to-reading gap is ten seconds and says nothing about how long he was
  // gone. Null at the start: she has not seen him leave, so she must not claim a duration.
  let awaySinceMs: number | null = null;

  return {
    look(present, stillSeconds, nowMs, carrying = 0) {
      const now: TheRoom = { present, stillSeconds, atMs: nowMs, awaySinceMs };
      const noticed = noticeTheRoom(last, now, carrying);
      // Recorded AFTER the noticing, so the transition it describes is still visible above.
      if (last !== null && last.present && !present) awaySinceMs = nowMs;
      if (present) awaySinceMs = null;
      last = { ...now, awaySinceMs };
      return noticed;
    },
    blind() { last = null; awaySinceMs = null; },
  };
}
