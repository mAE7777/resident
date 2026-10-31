// Her words, on the way to a mouth.
//
// The obvious way to build this is to hang it off the Telegram bridge, since that already
// turns the agent's event stream into text. It is the wrong way, and the reason is worth
// stating: the bridge writes her words and the interface's chrome down the SAME wire. It
// sends "Thinking…" to get a message id, it edits that message with tool labels like
// "Reading File" while she works, and it re-sends whole segments when a message gets too
// long for Telegram. On a screen all of that is fine. A mouth reading the same wire would
// announce the placeholder, narrate its own tool use, and repeat itself.
//
// So this is a SECOND renderer of the same `AgentEvent` stream, beside the bridge rather
// than behind it. The event stream already separates what she is saying (`text_chunk`) from
// what she is thinking (`thinking_chunk`) and from what the machinery is doing (`tool_*`),
// which is exactly the distinction a mouth needs and the bridge had already flattened away.
//
// Two rules it exists to enforce:
//
//   1. **A mouth cannot un-say.** Only text the model has actually emitted is spoken, and
//      only once. That is safe because a streamed completion is append-only: the bridge
//      "edits" because Telegram shows one message growing, not because the words change.
//   2. **Only prose.** Code fences, tables and markdown scaffolding reach him as text and
//      are never read aloud, for the same reason `notHers` exists: machine output arriving
//      in her voice is the thing that makes her sound like a system.

import type { AgentEvent } from "../agent/types.js";
import type { ThinkFilter } from "../telegram/think-filter.js";

export interface VoiceStreamDeps {
  /** Emit one utterance. The client synthesises and plays it; nothing audio crosses here. */
  speak: (text: string, utteranceId: string) => void;
  /** Ids let a `cancel` stop exactly the utterance that is playing. */
  newUtteranceId: () => string;
  /** The same `<think>` stripper the bridge uses, so both renderers agree on what she said. */
  thinkFilter?: ThinkFilter;
  /**
   * HOW LONG AN ARC SHE HAS IN HER, in speakable weight (`capacity.arcWeight`).
   *
   * The one place her BODY reaches her LANGUAGE. Every boundary this file finds is a mark the model
   * emitted, a full stop the provider chose, so where her sentences break has always been the
   * provider's prosody rather than hers. `turn-shape.ts` names this gap in its own header and
   * explains why the obvious fix is forbidden: narrowing her output budget by her condition
   * truncated a tool call and silenced her completely, three turns out of three.
   *
   * This does not narrow the budget. It decides, among the boundaries the text ALREADY has, which
   * ones she stops at: worn through, she stops at the first clause that carries enough weight;
   * rested, she runs on to the end of the sentence. Nothing is cut, nothing is withheld, and the
   * stream is untouched, the same words arrive, in her rhythm instead of the model's.
   *
   * Injected as a function because her condition moves between turns and this stream outlives one.
   * Absent (the older callers) means the previous behaviour exactly.
   */
  arcWeight?: () => number;
}

export interface VoiceStream {
  onEvent(event: AgentEvent): void;
  /** Speak whatever is left, including a final fragment with no terminator. */
  finalize(): void;
  /**
   * Drop everything unspoken, and stay dropped.
   *
   * LATCHING, and that is the whole fix rather than a detail. Clearing the buffer alone did
   * not stop her: the aborted turn still returns its content, `runAgentAndStream` still calls
   * `done()` → `finalize()`, and the silence backstop re-emits the WHOLE answer as one
   * `text_chunk` when nothing was spoken. So a barge-in that only emptied the buffer produced
   * the exact behaviour it exists to prevent, he cuts her off and she says the entire thing,
   * after the cancel frame, in one piece.
   *
   * After this, nothing more comes out of this stream. A stream is made per turn, so the
   * latch is over exactly as soon as the interrupted turn is.
   */
  reset(): void;
}

/**
 * How much text is worth opening on. Below this a "clause" is usually an interjection or a
 * stray token, and starting audio on it sounds like a stutter rather than a fast answer.
 */
export const MIN_FIRST_CLAUSE_CHARS = 12;

/**
 * Roughly how much there is to say, rather than how many characters there are.
 *
 * A raw character count gets this badly wrong across languages: `我看过了` is a complete
 * clause in four characters, and a character threshold tuned for English silently disabled
 * early opening for Chinese entirely, she would have waited for the whole answer before
 * making a sound. CJK carries far more per character, so each one counts for more.
 */
const DENSE_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u{3000}-\u{303F}\u{FF00}-\u{FFEF}]/u;

export function speakableWeight(s: string): number {
  let w = 0;
  for (const ch of s) {
    w += DENSE_SCRIPT.test(ch) ? 3 : 1;
  }
  return w;
}

/** Clause-level punctuation, Latin and CJK. Used only for the FIRST utterance of a turn. */
const CLAUSE_END = /[,;:，；：]|\s—\s/u;
/** Sentence-level punctuation. Used for everything after the first. */
const SENTENCE_END = /[.!?。！？…]/u;

/**
 * Strip what should not be read aloud.
 *
 * Fenced code is removed entirely: he gets it as text, where it is useful, and hearing it is
 * not. Emphasis markers, heading hashes and link syntax are unwrapped rather than dropped,
 * because the words inside them are hers.
 */
export function spokenForm(text: string): string {
  return text
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`([^`]*)`/gu, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/(\*\*|__|\*|_)/gu, "")
    .replace(/^\s*[-*+]\s+/gmu, "")
    .replace(/^\s*\|.*\|\s*$/gmu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Find where the first speakable unit ends, or -1.
 *
 * The first utterance of a turn ends at a CLAUSE, every later one at a SENTENCE. That split
 * is deliberate: the first one is the whole latency budget, and opening on "I had a look at
 * it," rather than waiting for the full sentence is the only way left to bring the first
 * audio forward without letting a different model speak for her. After that the pressure is
 * off and sentences read better.
 */
function boundary(buffer: string, isFirst: boolean, arc?: number): number {
  // A sentence end is ALWAYS a boundary, however short. "Yes, I did." is a whole thing to
  // say, and an earlier version that extended past it looking for more weight glued two
  // sentences into one utterance: the minimum length is about not stuttering on a fragment,
  // not about refusing to say something short.
  const s = SENTENCE_END.exec(buffer);
  const sentence = s ? s.index + s[0].length : -1;

  const c = CLAUSE_END.exec(buffer);
  const clause = c ? c.index + c[0].length : -1;
  const clauseComesFirst = clause !== -1 && (sentence === -1 || clause < sentence);

  if (isFirst) {
    // The first unit of a turn is the whole latency budget, and that is unchanged.
    if (clauseComesFirst && speakableWeight(buffer.slice(0, clause)) >= MIN_FIRST_CLAUSE_CHARS) {
      return clause;
    }
    return sentence;
  }

  // ── AND AFTER THAT, HER BODY DECIDES WHERE SHE STOPS ────────────────────────
  //
  // A later unit ended at the model's next full stop, always. Now: when the sentence that is
  // coming would run past the arc she has in her, she stops at the clause instead. Worn through,
  // that is often; rested, almost never, `arcWeight` runs 24 to 78, and an ordinary Chinese
  // sentence is 30 to 60. Nothing is cut: the rest is still in the buffer and still said next.
  if (arc !== undefined && clauseComesFirst
    && speakableWeight(buffer.slice(0, clause)) >= MIN_FIRST_CLAUSE_CHARS
    && (sentence === -1 || speakableWeight(buffer.slice(0, sentence)) > arc)) {
    return clause;
  }
  return sentence;
}

export function createVoiceStream(deps: VoiceStreamDeps): VoiceStream {
  let buffer = "";
  let spokenAnything = false;
  /** She was cut off. Nothing else from this turn is said. See `reset`. */
  let silenced = false;

  function drain(final: boolean): void {
    for (;;) {
      const at = boundary(buffer, !spokenAnything, deps.arcWeight?.());
      if (at === -1) break;
      const piece = buffer.slice(0, at);
      buffer = buffer.slice(at);
      emit(piece);
    }
    if (final && buffer.trim() !== "") {
      emit(buffer);
      buffer = "";
    }
  }

  function emit(raw: string): void {
    const text = spokenForm(raw);
    // A unit that is nothing but code or scaffolding leaves no prose behind. It reached him
    // as text; there is simply nothing here to say.
    if (text === "") return;
    deps.speak(text, deps.newUtteranceId());
    spokenAnything = true;
  }

  return {
    onEvent(event: AgentEvent): void {
      if (silenced) return;
      // `thinking_chunk`, `tool_start`, `tool_end`, `progress`, `compaction` and `error` are
      // all deliberately silent. None of them is her talking, and the bridge already shows
      // the ones he should see.
      if (event.type !== "text_chunk") return;
      const chunk = deps.thinkFilter ? deps.thinkFilter.process(event.content) : event.content;
      if (chunk === "") return;
      buffer += chunk;
      drain(false);
    },

    finalize(): void {
      if (silenced) return;
      if (deps.thinkFilter) buffer += deps.thinkFilter.flush();
      drain(true);
    },

    reset(): void {
      buffer = "";
      spokenAnything = false;
      silenced = true;
    },
  };
}
