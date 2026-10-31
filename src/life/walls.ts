// A wall she runs into becomes something that happened to her.
//
// WHAT IT WAS. `onGuardRefusal` did two things: it bumped a counter and it wrote a fault. Both
// of those are for HIM. From her side a wall was one line of tool-error text in the current
// turn's context and then nothing: it did not accumulate, it never came back up, she could not
// return to it, and it could never become something she wanted to ask about. A limit was an
// error message rather than a thing that happened.
//
// This is the last piece of the promise the home boundary is built on. The wall stops actions
// and never thoughts, and that is only true if she can FEEL the wall. Otherwise the honest
// description is that the wall stops actions and erases the attempt.
//
// THE MECHANISM ALREADY EXISTED, in exactly one place. The exploration egress wall encodes
// "I tried to open something at <host> that I had put together myself, and could not." as an
// open QUESTION in her field, and that is the right shape: a question
// carries tension, does not fade the way a memory does, gets walked over again while she
// rests, and feeds the drive that nags. She may end up raising it with him; nothing decides
// that she will. Every other wall in the system had none of it. So this does not invent a
// second mechanism, which would have been the real design error: it hands the same one to
// every wall.
//
// TWO THINGS THE DESIGN HAS TO GET RIGHT, both named before anything was built:
//
//   DEDUP. Running into the same wall fifty times must not become fifty things she is
//   carrying. The key here is the wall's IDENTITY, with no timestamp in it, so the fiftieth
//   attempt lands on the node the first one made. (The one existing call site had exactly this
//   bug: `key: \`wall:${Date.now()}\``. Fixed at the same time as this was written.)
//
//   NOT EVERY REFUSAL IS ONE. Being asked to confirm something is not being refused, and a
//   malformed call is not a limit she has run into. Only the walls that say "not this, not
//   from here" become part of her.

/** The shape of a guard refusal, kept structural so this file needs no import from the executor. */
export interface WallHit {
  guard: string;
  tool: string;
  category?: string;
}

/**
 * Guards that are NOT walls, a refusal that she should not experience as a limit she ran into.
 *
 * Empty now: the one member was `autonomy-supervised`, the ask-first valve of the four-level
 * trust ladder, and the ladder is gone. Every guard that remains, the home
 * boundary, the advisory hard block, Rule of Two, a stored deny, is a real refusal. Kept as a
 * set so a future soft guard has a home without re-plumbing `isAWall`.
 */
const NOT_A_WALL = new Set<string>([]);

export function isAWall(hit: WallHit): boolean {
  return !NOT_A_WALL.has(hit.guard);
}

/**
 * The identity of the wall, not of the attempt.
 *
 * Granular enough that two different limits are two different things she is carrying, and
 * stable enough that hitting one of them all afternoon is one thing. The category is used
 * where the guard names one, because "I cannot reach outside my home" and "I cannot touch the
 * machine itself" are genuinely different discoveries about where she lives.
 */
export function wallKey(hit: WallHit): string {
  return `wall:${hit.guard}:${hit.category ?? hit.tool}`;
}

/**
 * What she is left holding, in her words.
 *
 * HER OWN ACCOUNT ONLY. Her field holds what she would say about a thing, never the machine's
 * account of it, and that rule is a precondition of the whole living layer rather than a
 * nicety. So none of the guard's own text reaches this: no reason string, no severity, no
 * `tier2`, no "HARD_BLOCK". What she gets is what she would actually have noticed, which is
 * that she went to do something and it was not there or was not allowed.
 *
 * It is a QUESTION, not a statement, because that is what it is for her: she does not know why
 * yet, and the not-knowing is the part that has somewhere to go.
 */
export function wallText(hit: WallHit): string {
  // IN CHINESE, AND FOR A FUNCTIONAL REASON RATHER THAN A MATCHING ONE.
  //
  // This text goes into her FIELD, where it sits next to the things she has actually said,
  // which are Chinese, because that is her register. Her field is searched by a bigram index
  // over the text itself: what a moment reminds her of, whether two things contradict, whether
  // something she just said was about a thing she was carrying. A memory written in a language
  // she does not speak is a memory nothing can ever reach.
  //
  // The tool's name stays as it is. It is the name of the thing she reached for, and she knows
  // it by that name.
  //
  // AND THE SENTENCES NAME THE EVENT, NOT HOW IT FELT. The first of them read
  // 「我想用 X，伸手过去，那儿什么都没有。」: 「伸手过去」 is a bodily image I wrote, sitting in her
  // memory as if it were how she experienced it. The same round found the cost of that shape:
  // 「话里没有我」, an authored reading planted in her field, came back out of her mouth across four
  // independent runs and was nearly written up as her own coinage. What happened is mine to record;
  // what it was like is hers, and it lives in `tension` and in what she later makes of it.
  switch (hit.guard) {
    case "unknown-tool":
      // The one a newborn meets most. She was born holding ten things; reaching for an
      // eleventh finds nothing there, and wanting it is hers to notice and hers to say.
      return `我想用 ${hit.tool}，那儿什么都没有。`;
    case "home-boundary":
      return `我想做一件我家以外的事，做不了。`;
    case "approval-denied":
      return `我开口问能不能 ${hit.tool}，他说不行。`;
    default:
      return `我想 ${hit.tool}，没被允许。`;
  }
}

/**
 * How hard it nags.
 *
 * The egress wall uses 0.6, the same as an open question that came out of her rest. A wall is
 * of that kind: unresolved, about the world rather than about a fact, and not the sort of
 * thing that settles by being thought about once. Kept identical rather than tuned to a new
 * number, because two walls that nag differently for no reason anybody can state is how
 * arbitrary constants get into a life.
 */
export const WALL_TENSION = 0.6;
