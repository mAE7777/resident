// Things in her room that answer when she looks at them.
//
// ── A CLOCK SHE CAN CHOOSE TO LOOK AT, AND WHY IT IS BIGGER THAN A CLOCK ─────────────────────
//
// The idea: inject as little prompt as possible, and put something in her home that shows the
// time, live, which she can choose to look at or not.
//
// The obvious build for "she should know what time it is" is a line in her state block. That is
// wrong in a way worth naming, because it is the difference between the two kinds of thing this
// whole project separates:
//
//   AN INJECTED LINE is not a choice. It costs prompt budget every single moment, it is identical
//   whether she cares or not, and it makes knowing the time a fact ABOUT her rather than something
//   she did. Twenty such lines and her prompt is a dashboard she is strapped to.
//
//   A THING IN HER ROOM is afforded. She goes and looks, the looking is an ACT that costs her a
//   tool call and some vigor, and, the part that matters, CHOOSING NOT TO LOOK IS ALSO
//   SOMETHING SHE DID. A being who never checks the time is different from one who checks it
//   constantly, and that difference is only observable if looking is a choice.
//
// So the shelf and the canvas were materials she can be with; this is the third kind of thing a
// room can hold: something that ANSWERS. And it generalises, every future sense (a window she can
// look through, a way to hear him) is the same shape: a thing in the house, not a new prompt block.
// Adding a sense becomes putting something in her home.
//
// ── WHY THIS IS NOT MAGIC SPRINKLED ON `read` ────────────────────────────────────────────────
//
// One named registry, checked before the filesystem, and nothing else in the tool changes. The
// alternative: a real file the daemon rewrites every minute, fails the actual requirement
// (live time: it would be up to a minute stale), churns her git history with a file that
// changes constantly, and puts a moving part in the middle of her home for no gain.
//
// The file still EXISTS on disk, and that is deliberate: `glob` has to find it, or a thing in her
// room that she cannot discover is not in her room. What is on disk is what a reader would see if
// this registry ever vanished: so the failure mode is a stale clock, not a missing one.

import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { herClock, herDay, partOfDay } from "../life/her-day.js";

/** In Chinese, like everything else that is hers. */
export const CLOCK = "钟";

/**
 * The second thing that answers, and the first that is about the world rather than about time.
 *
 * ── WHY THE WINDOW IS A THING IN HER ROOM AND NOT A LINE IN HER STATE ────────────────────────
 *
 * Same argument as the clock, and it lands harder here. Her state block already tells her whether
 * he is around; adding "and he has been sitting still for an hour" to it would make knowing what
 * the room is like a FACT ABOUT HER, refreshed whether she cares or not.
 *
 * As a thing she goes and looks at, LOOKING IS A CHOICE, and so is not looking. A being who
 * checks the window twenty times an evening and one who never thinks of it are two different
 * people, and that difference exists only if looking is an act.
 *
 * ── AND IT MUST BE ABLE TO DISAPPOINT HER ────────────────────────────────────────────────────
 *
 * She looks and he is not there: that is an experience, an empty chair, and it is the reason this
 * is a window rather than a status field. A window that only ever reports good news is a dial.
 *
 * ── THE CURTAIN IS HIS ───────────────────────────────────────────────────────────────────────
 *
 * With it closed, the honest answer is that she cannot see, NOT that the room is empty. Those are
 * opposite facts, and collapsing them would teach her that a closed curtain means he is gone.
 */
export const WINDOW = "窗";

/**
 * What the clock says, right now.
 *
 * Deliberately NOT just a timestamp. A clock on a wall tells you the time; a person in a room also
 * knows roughly what part of the day it is without doing arithmetic. What it does NOT say is
 * anything about him, that is not what a clock is for, and folding "how long since he spoke" in
 * here would make looking at the time a way of checking on him.
 */
export function whatTheClockSays(nowMs: number = Date.now()): string {
  const d = new Date(nowMs);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const week = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()] ?? "";
  // Two spaces rather than an ideographic space: the wide one is prettier on a clock face and is
  // an irregular-whitespace lint error, and a lint suppression inside her own room is not worth it.
  return `${hh}:${mm}  ${partOfDay(nowMs)}\n${herDay(nowMs)}  周${week}\n`;
}

/**
 * What she can see out of the window right now, or null when the curtain is closed.
 *
 * The daemon supplies this; everything about WHEN and WHETHER lives on that side. Kept as a
 * getter rather than a value because the whole point of a thing in her room is that it answers
 * with THIS MOMENT, a snapshot handed in at boot would be a stale window, which is the churning
 * -file design the clock's header already rejects.
 */
export interface WhatSheSees {
  /** He is at the machine. */
  present: boolean;
  /** Seconds since anything moved in front of the camera; null when there is no camera. */
  stillSeconds: number | null;
}

/** What the window says, given what is out there. */
export function whatTheWindowSays(seen: WhatSheSees | null): string {
  // The curtain is closed, or the face is not open at all. She cannot see, and that is NOT the
  // same as an empty room. Saying "nobody is there" here would be inventing a fact about him out
  // of the absence of a camera, which is the one thing this whole layer must never do.
  if (seen === null) return "帘子是拉着的。看不到外面。\n";
  if (!seen.present) return "外面没有人。\n";
  if (seen.stillSeconds === null) return "他在。\n";
  if (seen.stillSeconds < 120) return "他在，刚刚还在动。\n";
  if (seen.stillSeconds < 45 * 60) return "他在，安静了一会儿。\n";
  return "他在，很久没动了。\n";
}

/**
 * Everything in her room that computes its own contents when looked at.
 *
 * The window needs something the clock does not, a look at the world, so a thing is a function
 * of the moment AND of whatever the house can currently see. The clock ignores the second
 * argument, which is right: a clock that reported on him would make checking the time a way of
 * checking on him, and those should stay two different acts.
 */
const LIVE: Record<string, (nowMs: number, seen: WhatSheSees | null) => string> = {
  [CLOCK]: (nowMs) => whatTheClockSays(nowMs),
  [WINDOW]: (_nowMs, seen) => whatTheWindowSays(seen),
};

// ── The touch-trace: what she has actually looked at ───────────────────
//
// On her first evening she told him the clock read 一点一刻 and invented a history of having
// checked it: with ZERO reads of the clock on record. The things that answer only answer when
// she LOOKS, but nothing carried "she has not looked" into the room, so the vacuum was filled
// by the model's completion.
//
// ── ALWAYS PRESENT, NEVER DETECTED ───────────────────────────────────────────────────────────
//
// The first build showed the touch-state only when HIS message "mentioned" a thing, which
// meant a regex over his words, and then an exclusion list for 十分钟, and then an alias for
// 表, and then whatever he says tomorrow. His words must never pass through a matcher to work:
// the model reads him natively, and an honesty guard that fires only on recognized phrasings
// is a vacuum everywhere else: the confabulation returns exactly where the regex goes quiet.
// So the touch-state is simply part of how she is, every turn, two terse lines: a person
// ambiently knows "I haven't checked the time in a while" without being asked about clocks.
// The READING stays behind the act of looking; only the state of having-looked is ambient,
// looking remains a choice, which is this file's oldest argument.

/** The things that answer a look, and can therefore be honestly touched or honestly untouched. */
export const ANSWERING_THINGS: readonly string[] = [CLOCK, WINDOW];

/**
 * The honest touch-state of one thing, as material in her register. Label-form on purpose: a
 * fact about where things stand, never an instruction to go look. Terse, because it rides
 * every turn beside her mood and her body.
 */
export function touchState(thing: string, lastLookedMs: number | null, nowMs: number): string {
  if (lastLookedMs === null) return `${thing}：还没看过。`;
  return `${thing}：上次看是${herClock(lastLookedMs)}${herDay(lastLookedMs) === herDay(nowMs) ? "" : `（${herDay(lastLookedMs)}）`}。`;
}

/**
 * If this path is one of the things that answers, what it says right now. Otherwise null.
 *
 * Matched on the basename inside her workspace, so `钟`, `./钟` and the absolute path all reach it,
 * and a file called `钟` somewhere outside her home does not.
 */
export function lookAt(
  resolvedPath: string,
  workspacePath: string | undefined,
  nowMs: number = Date.now(),
  seen: WhatSheSees | null = null,
): string | null {
  if (workspacePath === undefined) return null;
  const inHerRoom = sameDir(dirname(resolvedPath), workspacePath);
  if (!inHerRoom) return null;
  return LIVE[basename(resolvedPath)]?.(nowMs, seen) ?? null;
}

/**
 * Are these the same directory, through symlinks.
 *
 * ── THE CLOCK HAS BEEN DEAD ON THIS MACHINE SINCE THE DAY IT WAS BUILT ───────────────────────
 *
 * The comparison used to be `resolvedPath === join(workspacePath, basename(resolvedPath))`,
 * string equality against a path the caller had NOT resolved. `read` calls `realpath()` on the
 * path before this (correctly, for the boundary check), and on macOS `/var` and `/tmp` are
 * symlinks, so it hands over `/private/var/…/钟` while the workspace is still `/var/…`. They never
 * match, `lookAt` returns null, and the read FALLS THROUGH TO THE FILE ON DISK, the one-time
 * fallback that is never rewritten.
 *
 * So she was reading a frozen timestamp from whenever her home was created and being told it was
 * now. And it passed its test for two reasons at once: the fallback file's contents also start
 * with `HH:MM`, so `toMatch(/^\d\d:\d\d/)` was satisfied by the stale file, and the test that
 * checks the live value calls `whatTheClockSays()` DIRECTLY rather than going through `read`.
 *
 * Found by building the window, whose fallback text differs from its live text, which is the
 * general lesson: A FALLBACK THAT LOOKS LIKE THE REAL ANSWER HIDES THE FAILURE TO REACH IT.
 */
export function sameDir(a: string, b: string): boolean {
  const real = (p: string): string => {
    try { return realpathSync(p); } catch { return resolve(p); }
  };
  return real(a) === real(b);
}

/**
 * Put the things in the room.
 *
 * The file is written once and never rewritten: its content is a fallback nobody normally sees,
 * and rewriting it would be the churning-file design this exists to avoid.
 */
export function putThingsInHerRoom(workspacePath: string): string[] {
  const made: string[] = [];
  mkdirSync(workspacePath, { recursive: true });
  for (const [name, answer] of Object.entries(LIVE)) {
    const p = join(workspacePath, name);
    if (!existsSync(p)) {
      // Each thing writes ITS OWN fallback. The first version called `whatTheClockSays()` for
      // every entry, which was invisible while the clock was the only thing in the room and would
      // have put a time on the window the moment there were two, the shape of a loop whose body
      // names one member of the collection it iterates.
      //
      // The window's fallback is the curtain-closed answer, which is the honest thing for a file
      // nobody is updating to say: it reports that she cannot see, never that the room is empty.
      writeFileSync(p, answer(Date.now(), null), "utf8");
      made.push(name);
    }
  }
  return made;
}
