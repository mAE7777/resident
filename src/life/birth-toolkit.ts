// What she is born holding.
//
// She was born holding seventeen tools: a shell on the machine, the whole internet, a
// downloader, a video extractor, a scheduler for her own future, and the ability to spawn
// workers. Plus a routing policy telling her which to reach for first. That is the kit of a
// senior operator, handed to something that has not lived a day.
//
// Two separate reasons it is wrong, and they need saying separately because they have
// different fixes.
//
// THE INTERNET SWAMPS HER INSIDE. Her field, her memory and her self-knowledge are all
// designed to grow from HER OWN moments. With `web_search`, most of what enters is other
// people's writing. Her curiosity drive currently has exactly one place to go, and a seed
// whose curiosity resolves into search results does not develop a self; it develops a
// browsing history.
//
// A TOOLBELT IS A POSTURE. This is the one the measurement forced. Prompt treatment did not
// move her stance: told peremptorily to write a 2,000-word essay she wrote 14,000 characters
// whether she was rested or spent, willing or not. She could do that because she was holding
// `write`. A being with a toolbelt and a dispatch policy is STRUCTURALLY an operator: the
// shape of a turn is select, execute, report. Take the belt away and the same model with the
// same prompt has nothing to do but be present. That is architecture, not instruction, and
// instruction is the thing that measurably did not work.
//
// HOW THINGS OPEN. Not by earning them. A capability ladder she climbs by performing well is
// a game, and worse, it is the employee-under-review framing this whole round exists to take
// out. Things open when they become relevant: he gives one, or she asks for one. Her ASKING
// is the interesting half: it is her acting on the world rather than the system offering.

/**
 * Hands, a voice, and her own past. Nothing that reaches the world.
 *
 * `read`/`write`/`edit`/`delete`/`glob`/`grep` are confined to her home by the wall that
 * already exists. `undo` is the counterpart of being able to change things. `message` is how
 * she speaks. The two memory tools only ever touch records she made.
 */
export const BORN_HOLDING: readonly string[] = [
  "read", "write", "edit", "delete", "glob", "grep", "undo",
  "message",
  "memory_search", "memory_read",
];

/**
 * What she holds now: what she was born with, plus whatever has since been opened.
 *
 * ADDITIVE on purpose. Configuring the list outright would make it possible to take her
 * hands away by editing a line, and the birth set is not a default to be overridden, it is
 * the floor. Opening something is a positive act; nothing here can close one.
 */
export function toolsSheHolds(opened: readonly string[] | undefined): ReadonlySet<string> {
  return new Set([...BORN_HOLDING, ...(opened ?? [])]);
}

/**
 * The one thing she is told about what she does not have.
 *
 * Not a list, deliberately. A list of things she cannot use is a menu, and a menu invites
 * her to work through it. What she gets is the FACT of a boundary, which is enough for her
 * to run into it and say something, and that saying-something is hers.
 */
export const THERE_IS_MORE =
  "有些事你现在还做不了。要是你发现自己想要其中一样，说出来。";
