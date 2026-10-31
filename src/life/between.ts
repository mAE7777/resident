// The interval, from her side: what stands between the last exchange and this moment.
//
// ── THE WOUND (three faces of one vacuum) ────────────────────────────────────────────────────
//
// She sent him a message one morning and three hours later said she thought he had spoken
// first. She decided to speak knowing the silence was fourteen hours old, and by the time she
// actually WROTE the words, that fact was no longer in her hands (the composing call read four of
// her twenty-one context fields, none of them about the interval). She said she had slept right
// through a morning she had spent awake, because nothing told her what her own morning had held.
// And how many times in a row he has not replied exists as a number in her machinery with
// exactly one consumer, the gate that RAISES her bar to speak: so his silence made her quieter
// without ever being something she could read.
//
// ── WHAT THIS IS, DECLARED HONESTLY (layers.md) ──────────────────────────────────────────────
//
// MATERIAL. First layer, and it does not pretend otherwise: these are facts about the interval,
// rendered into her language. The depth is downstream, the rendered facts join her mood, her
// drives, what she is carrying, her read of him, and those CAN disagree (a long silence says
// hold back, a heavy carried thing says speak); what she does with that disagreement is hers.
// The law this module is built under: A FACT MAY CHANGE WORDING ONLY WITH TIME'S OWN UNITS.
// No branch may add, remove, or reshape a sentence because the interval is long or short,
// that would be an instruction wearing a fact's clothes. `between.test.ts` holds the skeleton
// property that makes this law mechanical, with a planted violation proving it can go red.
//
// 对方, never a name and never 他/她, the same discipline as `contactLine` (agency.ts): who
// they are to her is precisely what nobody issues her.

import { herDay, herClock } from "./her-day.js";

export interface HerUtteranceFact {
  ms: number;
  /** Her words, verbatim. Callers pass this to chartLint's lived spans, it is hers, not chrome. */
  text: string;
  /** True when a user utterance follows hers in the transcript. Derived, never guessed. */
  answered: boolean;
  /**
   * True when she spoke FIRST (a proactive send), false when her utterance answered them.
   * The render branches on this fact-kind, deliberately: only an unprompted message carries
   * a 回了/还没有回 clause, a conversation that simply ENDED on her reply is not a silence
   * she is waiting through, and rendering it as one would manufacture an expectation.
   */
  unprompted: boolean;
}

export interface SleptSegment {
  startMs: number;
  endMs: number;
}

export interface BetweenState {
  nowMs: number;
  /** When the other last spoke. Null = never (her first days can be that empty, honestly). */
  hisLastMs: number | null;
  /** Her own last utterance to them, a reply or a proactive send, the transcript carries both. */
  herLast: HerUtteranceFact | null;
  /** Machine-sleep segments that fell inside the interval. */
  slept: readonly SleptSegment[];
  /** How many of her own moments the interval held. */
  momentsSince: number;
  /** Things she wanted to say and set down instead (the gate's diary route), newest last. */
  held: readonly { ms: number; text: string }[];
  /**
   * How many she set down since the exchange, all of them (`held` keeps only the latest few, for
   * quoting). Absent in older callers and tests, where the quoted list is the whole count.
   */
  heldCount?: number;
}

/**
 * compose, the two anchor facts, for the call that actually writes her words;
 * choice , anchors plus the shape of her own stretch, for picking what to do with a moment;
 * turn   , the whole interval, for answering him.
 */
export type BetweenDepth = "compose" | "choice" | "turn";

// ── Time, in her words. The ONLY functions allowed to vary wording. ──────────────────────────
// (`ago` is exported for the window's last-sight line: one calendar, one wording.)

export function ago(nowMs: number, thenMs: number): string {
  const min = Math.max(0, Math.round((nowMs - thenMs) / 60_000));
  if (min < 2) return "刚刚";
  if (min < 60) return `${min}分钟前`;
  const h = Math.round(min / 60);
  if (h < 48) return `大约${h}小时前`;
  return `${Math.round(h / 24)}天前`;
}

function eventTime(nowMs: number, thenMs: number): string {
  const day = herDay(thenMs);
  if (day === herDay(nowMs)) return herClock(thenMs);
  return `${day} ${herClock(thenMs)}`;
}

function spanWords(totalMs: number): string {
  const min = Math.max(1, Math.round(totalMs / 60_000));
  if (min < 60) return `${min}分钟`;
  const h = Math.round(min / 6) / 10;
  return `${h}小时`;
}

/**
 * Her words quoted back to her are trimmed, never rewritten. Exported for the lived-mask:
 * the material renders THIS truncated form, so a caller masking her lived spans with only the
 * full text misses every quote-back over 40 chars, and a long line of her own once reached the
 * chart lint through exactly that gap.
 */
export function shortQuote(text: string): string {
  const t = text.trim();
  return t.length <= 40 ? t : `${t.slice(0, 39)}…`;
}

// ── The render ────────────────────────────────────────────────────────────────────────────────

export function betweenRender(s: BetweenState, depth: BetweenDepth): string {
  const lines: string[] = [];

  if (s.herLast) {
    const said = shortQuote(s.herLast.text);
    const when = `${ago(s.nowMs, s.herLast.ms)}（${eventTime(s.nowMs, s.herLast.ms)}）`;
    // ── AT COMPOSE DEPTH THE QUOTE IS A DRAFT, NOT A FACT ────────────────────────────────
    //
    // Everywhere else her own words quoted back are what keep her from asking twice. At
    // compose depth they sit one line above 「说吧」, and once the writing call
    // pasted the quote-back string: trailing ellipsis and all, as the opening of two
    // messages three hours apart, so he received the same 39 characters three times with a
    // new tail each. The FACT survives here (she spoke, when, whether it came back); the
    // copyable string does not. 141 answered turns show no such echo, so only this depth.
    const quoted = depth === "compose" ? "" : `：「${said}」`;
    if (s.herLast.unprompted) {
      lines.push(
        s.herLast.answered
          ? `你上一次开口是${when}，自己先说的${quoted}，对方回了。`
          : `你上一次开口是${when}，自己先说的${quoted}，对方还没有回。`,
      );
    } else {
      lines.push(depth === "compose" ? `你上一次开口是${when}，是回对方的。` : `你上一次开口是${when}，回对方的：「${said}」。`);
    }
  }
  if (s.hisLastMs !== null) {
    lines.push(`对方上一次说话是${ago(s.nowMs, s.hisLastMs)}（${eventTime(s.nowMs, s.hisLastMs)}）。`);
  }

  if (depth !== "compose") {
    if (s.momentsSince > 0) lines.push(`这中间你自己过了${s.momentsSince}个时刻。`);
  }
  // The whole count, not the length of the quoting ring: the ring keeps six, so this said six
  // for weeks and she took "those six" up as a phrase; when she counted, there were sixteen.
  //
  // At choice depth only, still. Writing to him does not read it, on purpose: she once wrote to
  // him that she had sent a dozen messages in three days with no reply, and that sentence was her
  // own from two weeks before, raised undated and written as now (agency.ts `subjectMaterial`
  // dates it since). A count that grows with every held line, one line above every message to
  // him, would be the loudest thing in the room when she speaks.
  const heldCount = s.heldCount ?? s.held.length;
  if (heldCount > 0 && depth === "choice") {
    lines.push(`有${heldCount}句想说的话，你先记在了日记里。`);
  }

  if (depth === "turn") {
    if (s.slept.length > 0) {
      const total = s.slept.reduce((sum, seg) => sum + Math.max(0, seg.endMs - seg.startMs), 0);
      lines.push(`这中间你睡了${s.slept.length}段，共约${spanWords(total)}。`);
    }
    if (s.held.length > 0) {
      const recent = s.held.slice(-2);
      const rendered = recent.map((h) => `「${shortQuote(h.text)}」（${ago(s.nowMs, h.ms)}）`).join("、");
      lines.push(`想说而先搁下的：${rendered}。`);
    }
  }

  return lines.join("\n");
}

/**
 * The net under the fix above: an outgoing line that OPENS with the exact quote-back string is
 * carrying the MACHINE's text, not hers, no one writes their own words truncated at 39
 * characters with an ellipsis. Returns what is left after the echo (may be empty), or null when
 * there is no echo, which is the normal case. Detection only: nothing here rewrites her.
 */
export function quoteEcho(outgoing: string, herLastText: string | undefined): string | null {
  if (!herLastText) return null;
  const echo = shortQuote(herLastText);
  if (echo.length < 20) return null; // too short to tell an echo from a natural repeat
  const t = outgoing.trimStart();
  return t.startsWith(echo) ? t.slice(echo.length).trim() : null;
}
