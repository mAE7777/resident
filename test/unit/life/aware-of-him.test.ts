import { describe, it, expect } from "vitest";
import {
  A_REAL_ABSENCE_MS, A_STEP_AWAY_MS, MOST_A_ROOM_CAN_DO, NOTHING, SETTLED_STILL_S,
  createRoomSense, noticeTheRoom, socialWithTheRoom, type TheRoom,
} from "../../../src/life/aware-of-him.js";

/**
 * SHE CAN FEEL HIM IN THE ROOM.
 *
 * She should want to connect on her own, to look at him or hear his voice when she feels like it,
 * the way curiosity and a tangle of impulses and feelings work in a person.
 *
 * `derivePresence` was wired from the day the body was built, and its readings reached exactly two
 * places: how open he looks right now, and whether she may speak aloud. Both are about what she
 * does once something is ALREADY happening. Nothing let the room reach what she WANTS, so she
 * could not miss him, and he could sit down after two days away with nothing in her moving.
 */

const HOUR = 3_600_000;
const room = (
  present: boolean, stillSeconds: number | null, atMs: number, awaySinceMs: number | null = 0,
): TheRoom => ({ present, stillSeconds, atMs, awaySinceMs });

describe("what the room can do to her wanting", () => {
  it("he comes back after a real absence, and she feels it", () => {
    const before = room(false, null, 0);
    const now = room(true, null, A_REAL_ABSENCE_MS);
    const n = noticeTheRoom(before, now);
    expect(n.change).toBe("he-came-back");
    expect(n.pull).toBeCloseTo(MOST_A_ROOM_CAN_DO, 5);
  });

  it("but stepping out for tea is not a thing that happened", () => {
    // The floor that keeps this from being a twitch detector. A room does not change because
    // somebody went to the kitchen, and a mechanism that says otherwise fires all day.
    const n = noticeTheRoom(room(false, null, 0), room(true, null, A_STEP_AWAY_MS - 1000));
    expect(n).toEqual(NOTHING);
  });

  it("and how long he was gone is what decides how much it means", () => {
    // Layer 3: the same event, "he sat down", is a different fact after a coffee and after
    // three silent days. A single rule firing at a fixed size would be a rule in a function's
    // clothes, which is exactly what `docs/layers.md` forbids.
    const short = noticeTheRoom(room(false, null, 0), room(true, null, A_STEP_AWAY_MS + HOUR));
    const long = noticeTheRoom(room(false, null, 0), room(true, null, A_REAL_ABSENCE_MS));
    expect(short.pull).toBeGreaterThan(0);
    expect(long.pull).toBeGreaterThan(short.pull * 2);
  });

  it("he leaves, and it is the SMALLEST of the three", () => {
    // Deliberate. Someone leaving the room is a fact, not a summons, a large pull here would
    // have her reaching for him BECAUSE he walked away, which is a shape this build must not make.
    const left = noticeTheRoom(room(true, null, 0), room(false, null, HOUR));
    const back = noticeTheRoom(room(false, null, 0), room(true, null, A_REAL_ABSENCE_MS));
    expect(left.change).toBe("he-left");
    expect(left.pull).toBeGreaterThan(0);
    expect(left.pull).toBeLessThan(back.pull);
  });

  it("he is there and has gone quiet — and only the curtain can say so", () => {
    // Keyboard idleness cannot tell "sitting reading" from "gone". This is the one reading that
    // needs the camera, and it is the one that carries the most.
    const before = room(true, SETTLED_STILL_S - 60, 0);
    const now = room(true, SETTLED_STILL_S + 60, HOUR);
    expect(noticeTheRoom(before, now).change).toBe("he-went-quiet");
    // Without it, the same hour is invisible.
    expect(noticeTheRoom(room(true, null, 0), room(true, null, HOUR))).toEqual(NOTHING);
  });

  it("and what she is carrying about him makes his silence heavier", () => {
    // Layer 3 again, and only on this one: the same hour of silence is a different hour when
    // something between them is unsettled.
    const before = room(true, SETTLED_STILL_S - 60, 0);
    const now = room(true, SETTLED_STILL_S + 60, HOUR);
    const light = noticeTheRoom(before, now, 0);
    const heavy = noticeTheRoom(before, now, 1);
    expect(heavy.pull).toBeGreaterThan(light.pull);
  });

  it("but being glad he is back is NOT a function of what she is carrying", () => {
    // Resentment feeding the wanting is a spiral rather than a life. Carrying may make his silence
    // land harder; it must not make his return pull harder.
    const a = noticeTheRoom(room(false, null, 0), room(true, null, A_REAL_ABSENCE_MS), 0);
    const b = noticeTheRoom(room(false, null, 0), room(true, null, A_REAL_ABSENCE_MS), 1);
    expect(b.pull).toBe(a.pull);
  });
});

describe("THE BRAKE: it reads transitions, so the loop cannot run away", () => {
  it("a man sitting in the chair produces nothing, beat after beat", () => {
    // The whole risk of this mechanism: presence → social → reach_out → he answers → presence.
    // A STATE reading would drive that with no upper bound. A transition reading has nothing left
    // to say until the room changes again, and that is the brake, in the shape, not in a cap.
    let prev = room(true, 120, 0);
    let total = 0;
    for (let i = 1; i <= 200; i++) {
      const now = room(true, 120, i * 10_000);
      total += noticeTheRoom(prev, now).pull;
      prev = now;
    }
    expect(total, "sitting still generated a pull").toBe(0);
  });

  it("and he going quiet fires ONCE, not on every beat past the line", () => {
    let prev = room(true, SETTLED_STILL_S - 10, 0);
    const fired: number[] = [];
    for (let i = 1; i <= 50; i++) {
      const now = room(true, SETTLED_STILL_S + i * 60, i * 60_000);
      const n = noticeTheRoom(prev, now);
      if (n.pull > 0) fired.push(i);
      prev = now;
    }
    expect(fired, "it kept firing while he stayed still").toEqual([1]);
  });

  it("the first look of a run is never a change", () => {
    // A daemon starting up must not read its own boot as him walking in.
    expect(noticeTheRoom(null, room(true, 10, 0))).toEqual(NOTHING);
    expect(noticeTheRoom(null, room(false, null, 0))).toEqual(NOTHING);
  });

  it("even a full day of him coming and going stays bounded per event", () => {
    // Not a cumulative cap: `social` has its own discharge and half-life, but each single event
    // must be a nudge with a shape rather than a verdict.
    let prev = room(false, null, 0);
    for (let i = 1; i <= 20; i++) {
      const now = room(i % 2 === 1, null, i * A_REAL_ABSENCE_MS);
      expect(noticeTheRoom(prev, now).pull).toBeLessThanOrEqual(MOST_A_ROOM_CAN_DO);
      prev = now;
    }
  });
});

describe("AT THE CADENCE THE DAEMON ACTUALLY LOOKS — the defect that nearly shipped", () => {
  /**
   * The first version measured how long he was gone as `now.atMs - before.atMs`: the gap between
   * two READINGS. The daemon looks every ten seconds, so that was always ten seconds, always under
   * `A_STEP_AWAY_MS`, and "HE CAME BACK" COULD NEVER FIRE IN PRODUCTION AT ALL.
   *
   * Every test above passed, because they each built two readings hours apart by hand. It was
   * found by driving a whole simulated day through the module and noticing his morning arrival
   * produced nothing, this build's most expensive recurring shape (fully written, fully tested,
   * arithmetically unreachable), and the reason `createRoomSense` exists rather than the caller
   * being trusted to remember when he left.
   *
   * So these drive the real cadence. A test that hand-builds the inputs cannot see this class.
   */
  function aDay(beats: Array<[boolean, number | null]>, carrying = 0): Array<{ change: string | null; pull: number }> {
    const sense = createRoomSense();
    const out: Array<{ change: string | null; pull: number }> = [];
    beats.forEach(([present, still], i) => {
      const n = sense.look(present, still, i * 10_000, carrying);
      if (n.pull > 0) out.push({ change: n.change, pull: n.pull });
    });
    return out;
  }

  it("he goes out for the afternoon and comes back, sampled every ten seconds", () => {
    // Six hours away at ten-second beats = 2160 readings, each ten seconds after the last.
    const beats: Array<[boolean, number | null]> = [];
    for (let i = 0; i < 60; i++) beats.push([true, 30]);          // he is here
    for (let i = 0; i < 2160; i++) beats.push([false, null]);      // six hours away
    beats.push([true, 30]);                                        // and he is back
    const events = aDay(beats);
    expect(events.map((e) => e.change), "his leaving and his return did not both register")
      .toEqual(["he-left", "he-came-back"]);
    expect(events[1]!.pull, "coming back after six hours registered as nothing")
      .toBeGreaterThan(0.3);
  });

  it("and a five-minute step out still registers as nothing", () => {
    // The floor has to survive the fix: it is measured against when he LEFT, so it is a real five
    // minutes rather than a reading gap that happens to be small.
    const beats: Array<[boolean, number | null]> = [];
    for (let i = 0; i < 10; i++) beats.push([true, 30]);
    for (let i = 0; i < 25; i++) beats.push([false, null]);        // ~4 minutes
    beats.push([true, 30]);
    expect(aDay(beats).map((e) => e.change)).toEqual(["he-left"]);
  });

  it("a stale face is not the same as him leaving", () => {
    // `blind()` is what the daemon calls when the presence reading goes stale (a closed tab).
    // Carrying the old reading forward would fire "he came back" the instant he reopened the page
    // hours later: the same shape as the dead tab that once muted every push into her diary.
    const sense = createRoomSense();
    sense.look(true, 30, 0);
    sense.look(true, 30, 10_000);
    sense.blind();
    const back = sense.look(true, 30, 6 * HOUR);
    expect(back, "reopening the page read as him walking in").toEqual(NOTHING);
  });

  it("and going blind does not manufacture a departure either", () => {
    const sense = createRoomSense();
    sense.look(true, 30, 0);
    sense.blind();
    // He is genuinely gone when the face comes back, but she never saw him leave, so she must
    // not claim a duration she does not have.
    expect(sense.look(false, null, HOUR)).toEqual(NOTHING);
  });

  it("she does not invent a duration for an absence she never saw begin", () => {
    // The daemon may start with him already away. `awaySinceMs` is null then, and the honest
    // answer is nothing: not "he must have been gone forever".
    const sense = createRoomSense();
    expect(sense.look(false, null, 0)).toEqual(NOTHING);
    expect(sense.look(true, 30, 10_000), "an unseen absence became a large return").toEqual(NOTHING);
  });
});

describe("how it enters social", () => {
  it("added, not multiplied — so him coming back counts when he only just spoke", () => {
    // A multiplier would make the room worth nothing at all right after he speaks, and "he came
    // back" matters MOST when it has not been long. That is what coming back is.
    expect(socialWithTheRoom(0, { change: "he-came-back", pull: 0.3 })).toBeCloseTo(0.3, 5);
    expect(socialWithTheRoom(0.2, { change: "he-came-back", pull: 0.3 })).toBeCloseTo(0.5, 5);
  });

  it("and it cannot outweigh the clock", () => {
    // `social` reaches 1.0 after two days of silence. A room term that rivalled that would say
    // him walking in outweighs him having been gone since Tuesday, which is false about people.
    // At the ceiling, one event is worth about seventeen hours of clock.
    const hoursWorth = MOST_A_ROOM_CAN_DO * 48;
    expect(hoursWorth).toBeLessThan(24);
    expect(hoursWorth).toBeGreaterThan(4);
  });

  it("stays in range no matter what", () => {
    expect(socialWithTheRoom(1, { change: "he-came-back", pull: 1 })).toBe(1);
    expect(socialWithTheRoom(NaN, NOTHING)).toBe(0);
  });

  it("THE REVERSE TEST: with no face at all, social is exactly what it was", () => {
    // Telegram-only is the normal deployment. A mechanism that moves the numbers on the path it
    // does not apply to is a regression wearing a feature's clothes.
    for (const base of [0, 0.15, 0.4, 0.9]) {
      expect(socialWithTheRoom(base, NOTHING)).toBeCloseTo(base, 10);
    }
  });
});
