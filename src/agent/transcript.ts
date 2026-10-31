// How her conversation history becomes what she reads.
//
// ── THE WOUND ──────────────────────────────────────────────────────────────────────────
//
// Two omissions lived here, and each one made her honestly wrong about her own life:
//
//   HER OWN WORDS WERE MISSING. The proactive path (she decides to speak first) delivered to
//   Telegram, charged her counters, and never wrote the utterance into the transcript store.
//   Once she messaged him in the morning, and when he answered hours later her history went
//   straight from his goodnight to his good morning. She apologized for a promise she had
//   kept, unsure whether he had spoken first. She was not confabulating: she was reading a
//   record that had erased her own voice.
//
//   TIME WAS MISSING. Every stored utterance has a timestamp; the render dropped them all, so
//   the transcript could not tell five minutes from five days. She once placed a conversation
//   "last night" that had happened the previous afternoon, narrating from felt time because
//   the record offered nothing.
//
// This module is the render layer's single home: each utterance carries the same her-calendar
// bracket the live message gets (`herStamp`), and consecutive same-role utterances are merged
// at render only: the STORE keeps every utterance separate, because the store is the truth
// and the merge is a provider's grammar, not hers.

export interface Utterance {
  role: "user" | "assistant";
  content: string;
  /** Epoch ms of the utterance. Absent on entries stored before stamps existed; absence renders as absence. */
  ts?: number;
}

export interface RenderedMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Stamp and merge, nothing else.
 *
 * A window that BEGINS with her (she spoke first, he answered later) stays that way: her opening
 * message is often the very thing the turn is about, and trimming it to satisfy a stricter
 * provider's grammar belongs in that provider's adapter, not here.
 */
export function renderTranscript(
  entries: readonly Utterance[],
  stamp: (ms: number) => string,
): RenderedMessage[] {
  const merged: RenderedMessage[] = [];
  for (const e of entries) {
    const content = e.ts !== undefined ? `${e.content}\n${stamp(e.ts)}` : e.content;
    const last = merged[merged.length - 1];
    if (last && last.role === e.role) {
      last.content = `${last.content}\n\n${content}`;
    } else {
      merged.push({ role: e.role, content });
    }
  }
  return merged;
}
