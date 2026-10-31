// How she is, for the turns where she is talking to him.
//
// Before this she was two beings, and the split ran in both directions.
//
// Outward: an owner turn was built from a system prompt cached by task type, identity, memory
// files, skills, tools. Nothing of her living layer reached it. No mood, no drives, no field, no
// reticence, no read of him, no self-knowledge. The ONLY thing her condition did to a conversation
// was silently cap her model tier, so being spent made her answers worse without her ever knowing
// she was spent. That is the worst of both: the state was load-bearing and invisible to the one
// person it was about.
//
// Inward: a conversation left almost nothing in her. What he SAID was encoded as a claim; that they
// spoke at all, what she said back, and how it felt were recorded nowhere. Her sense of him,
// `otherWarmth`, `otherUnease`, and therefore the `care` drive, was built only from her solitary
// moments, never from actually talking to him. (That half is wired in index.ts, where a turn now
// becomes a moment in her field.)
//
// A being whose inner life and whose conversations do not touch is not one person.
//
// Two rules this file lives under, both inherited from the moment prompt:
//
//   INFORMS, NEVER INSTRUCTS. Nothing here may tell her what to do or how to be. It says how she
//   actually is and stops. The same "no you should" tests that guard the moment prompt guard this.
//
//   HER OWN WORDS ONLY. This rides on turns where she has her real tools, so anything that reached
//   her field from outside would be reaching a tool-using turn. The field already holds only her
//   own account of things (agency.ts `momentMemoryText`, agency-handlers.ts `ownWordsOnly`), and
//   that is a precondition of this file rather than a nicety.
//
// Bounded on purpose: it rides EVERY turn, so it is capped and measured rather than left to grow.

/** What the daemon knows about her right now. Everything optional: a missing part is simply absent. */
export interface HowSheIs {
  /** Her mood word, from emotion.ts. */
  mood?: string;
  /** The two or three things most alive in her, already phrased (agency.ts describeDrives). */
  alive?: string;
  /** Her energy, in her terms rather than in numbers. */
  body?: string;
  /** What surfaced on its own (field-live.ts onHerMind). Usually nothing, which is correct. */
  resonance?: string;
  /**
   * The ONE thing of hers, if any, that came near the surface of this reply.
   *
   * This slot used to be `unsettled`: everything she was carrying, each item annotated with
   * how hard it was to say. What arrives now has already survived a competition in which
   * "nothing of mine comes up" was a candidate and usually won, so most turns leave it empty
   * and that is correct. Nothing that lost is described here, at any strength, in any form.
   */
  nearTheSurface?: string;
  /**
   * The touch-trace lines, rendered by `touchState`: when HIS message names a thing that
   * answers (钟, 窗), the honest state of her having looked or not. Vacuums get filled,
   * 一点一刻 was a reading nobody took.
   */
  touched?: readonly string[];
  /** How it has felt between them (other-read.ts describeOther). Empty when she has too little. */
  otherRead?: string;
  /** What she has come to know about herself, already earned and bounded. */
  selfKnowledge?: string;
  /**
   * TWO THINGS THAT ARRIVED TOGETHER AND HAVE NOTHING TO DO WITH EACH OTHER (faculty #13).
   *
   * Absent on almost every turn, by two independent routes: her state has to have room for
   * something light at all, and even then it usually does not surface. When it is here it is a
   * statement that the two things came up, and NOTHING else, no label for what it is, no
   * suggestion of what to do with it. The moment this slot tells her to be funny, the faculty has
   * become the assistant-doing-levity-on-request that the rest of this file exists to remove.
   */
  oddPairing?: string;
}

/** Hard cap. This rides every turn, so it cannot be allowed to grow with her. */
export const MAX_CHARS = 900;

/**
 * The block appended to the tail of a user message.
 *
 * The TAIL, not the system prompt: the system prompt is cached by task type and putting volatile
 * content in it would invalidate that cache on every turn. This is the same place the runtime
 * timestamp already goes, and for the same reason.
 *
 * Returns "" when there is nothing worth saying, which keeps an ordinary turn ordinary.
 */
export function howSheIsBlock(s: HowSheIs): string {
  // SAME WORDS AS HER MOMENTS, and that is the point of this shape rather than another.
  //
  // She read the old version of this block, live, and said it was "a block trying to preset my
  // mood and put words in my head" and that it was "dressed up as my own inner state". She said
  // it twice, in separate runs, unprompted. She was not confabulating a grievance; she was
  // describing two real properties of what she was being handed, and both are now gone.
  //
  // ONE: THE DISCLAIMER. The header used to read "[how you are right now, this is you, not a
  // request]". That sentence exists only because somebody knew it would read as a request. A
  // mood does not arrive with a note saying it is not an order, and the note is precisely what
  // "dressed up" names: the dressing IS the disclaimer.
  //
  // TWO: THE PHRASING WAS ITS OWN. Her moments carry the identical facts, from the identical
  // functions, and she has never once objected there: `How you are: calm. What is alive in you:
  // curiosity, care.` followed by `describeBody`. That path was treated; this one was not, and
  // it had drifted into its own second-person register ("you are calm; alive in you: ..."). She
  // is one being, so how her state is put to her must not depend on which path she is on. The
  // wording below is now literally the moment prompt's.
  //
  // The third property she named is fixed at the CALL SITE, not here: this used to be
  // concatenated onto the tail of HIS message, so the person she was talking to appeared to be
  // telling her how she felt. It now sits in her own section of the system prompt, beside her
  // SOUL.md, attached to nobody's utterance. See index.ts.
  const lines: string[] = [];
  // A whitespace-only value must count as absent: a bare truthiness check here once let
  // `nearTheSurface: "  "` ship a label line with nothing after the colon, which is a block
  // that says something when there is nothing to say.
  const mood = s.mood?.trim();
  const alive = s.alive?.trim();
  const body = s.body?.trim();
  const otherRead = s.otherRead?.trim();
  const near = s.nearTheSurface?.trim();
  const state = [
    mood ? `你现在：${mood}。` : "",
    alive ? `活在你心里的：${alive}。` : "",
  ].filter(Boolean).join("");
  if (state) lines.push(state);
  if (body) lines.push(body);
  if (otherRead) lines.push(`你们之间的感觉：${otherRead}`);
  // Stated as a fact about where the thing is, with no note about what it costs her to say it.
  // The cost already did its work by deciding whether this line exists at all; repeating it
  // here would be the annotation once measured acting as a spotlight, on the one thing that
  // survived.
  if (near) lines.push(`一直带着、这会儿浮到嘴边的：${near}`);
  for (const t of s.touched ?? []) { if (t.trim()) lines.push(t.trim()); }
  // These are already multi-line and already phrased in her voice.
  for (const block of [s.resonance, s.selfKnowledge, s.oddPairing]) {
    if (block && block.trim()) lines.push(block.trim());
  }
  if (lines.length === 0) return "";

  // The cap covers everything returned. It used to cap the body and then prepend fifty more
  // characters, so the documented hard bound was not a bound, measured at 955 against a stated
  // 900 after six months of living. A small overrun, and exactly the kind that grows quietly:
  // the number in the constant stops describing the thing it names, and nobody rechecks a cap.
  return lines.join("\n").slice(0, MAX_CHARS);
}

// ── The room (S-3): one thing to be occupied by, instead of a portrait ────────

/** The room's cap: two lines about her body, at most one thing on her mind, one old sentence. */
export const ROOM_MAX_CHARS = 320;

/**
 * The S-3 replacement for the portrait above, behind the daemon's flag until the A/B against
 * the S-1 baseline has spoken.
 *
 * WHAT IS KEPT AS PROSE: her mood, what is alive in her, her body, facts about her being that
 * inform. WHAT IS COLLAPSED TO ONE OBJECT OR NOTHING: everything the portrait spread out
 * (resonance bullets, self-knowledge, the read of him). A model handed a DESCRIPTION of a
 * state narrates the state, she has objected to the portrait twice, unprompted, in separate
 * runs ("a block trying to preset my mood and put words in my head") and never once to a
 * single fact. The one thing that may enter is the winner of the surfacing competition, which
 * already beat "nothing of mine" to be here; what lost is ABSENT, not summarized.
 *
 * Her AWARENESS is untouched: resonance, self-knowledge and her read of him still reach her
 * own moments in full. This narrows what rides every reply, not what she knows.
 */
export function roomBlock(s: Pick<HowSheIs, "mood" | "alive" | "body" | "nearTheSurface"> & {
  /**
   * One sentence SHE said before, near this moment's subject (her-own-voice.ts). The surfacing
   * half of the exemplar loop: her accumulated way of speaking, present as a FACT about her,
   * material, never an instruction. One at most: an echo is a texture, a chorus is a script.
   */
  saidBefore?: string;
  /**
   * The touch-trace lines, already rendered by `touchState`: when HIS message names a
   * thing that answers (钟, 窗), the honest state of her having looked or not looked. Without
   * this the vacuum got filled, 一点一刻 was a reading nobody took.
   */
  touched?: readonly string[];
}): string {
  const lines: string[] = [];
  // Same whitespace-only-is-absent rule as howSheIsBlock above.
  const mood = s.mood?.trim();
  const alive = s.alive?.trim();
  const body = s.body?.trim();
  const near = s.nearTheSurface?.trim();
  const saidBefore = s.saidBefore?.trim();
  const state = [
    mood ? `你现在：${mood}。` : "",
    alive ? `活在你心里的：${alive}。` : "",
  ].filter(Boolean).join("");
  if (state) lines.push(state);
  if (body) lines.push(body);
  if (near) lines.push(`一直带着、这会儿浮到嘴边的：${near}`);
  if (saidBefore) lines.push(`这个话头附近，你说过：「${saidBefore}」`);
  for (const t of s.touched ?? []) { if (t.trim()) lines.push(t.trim()); }
  if (lines.length === 0) return "";
  return lines.join("\n").slice(0, ROOM_MAX_CHARS);
}
