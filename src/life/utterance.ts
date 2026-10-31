// Is this something she said, or is it something that came out of a broken machine?
//
// Measured, not hypothesised. A provider returning an HTML error page, `<html><body>502 Bad
// Gateway</body></html>`, got as far as the expression gate and was pushed to him VERBATIM, as
// something she had chosen to say. So did a raw JSON blob, and so did two megabytes of a single
// repeated character. Every guard on the utterance path was about PROVENANCE (whose words are
// these) and none about whether the thing was prose at all.
//
// That is the fifth chaos invariant failing: she must never escalate a malfunction into an
// utterance. A crash he never sees is a bug; a crash that arrives in his messages wearing her voice
// is worse than a bug, because for a moment it is her.
//
// ── WHY THIS IS A WALL AND NOT A WEIGHT ──────────────────────────────────────
//
// The discrimination rule for this project is: move the constant by 10%, is something about her now
// WRONG, or merely DIFFERENT? Everything here is wrong at any setting. There is no amount of "a bit
// more markup" that makes an utterance better, and nothing below is a judgement about what she is
// allowed to say. It only asks whether the provider returned prose, which is a fact about the
// response and not about her.
//
// So it is deliberately NOT a content filter and NOT a keyword scan. `reversibility.ts` and
// `credence.ts` both had to be replaced this year for scanning substrings and calling it analysis;
// the tests below include her writing ABOUT html and json and stack traces, which must always pass.

/**
 * Longer than this and it is not a message, whatever it is.
 *
 * Generous on purpose: her longest genuine utterances are a few paragraphs, and the failures this
 * catches are orders of magnitude out, never marginal.
 */
export const MAX_UTTERANCE_CHARS = 8000;

/** A response that is ENTIRELY one markup or data structure. Not a response that mentions one. */
const WHOLLY_MARKUP = /^\s*<(?:!doctype|html|body|head|\?xml|error)\b[\s\S]*>\s*$/i;
const WHOLLY_JSON = /^\s*[{[][\s\S]*[}\]]\s*$/;
/**
 * A response that OPENS as a data structure, terminated or not.
 *
 * The truncated case is the common one in practice, a response cut off mid-object by a token limit
 * or a dropped connection, and it never closes its brace, so the whole-structure check above misses
 * it entirely. `{"` and `[{` are openings no sentence has. A bracket followed by a LETTER is left
 * alone, because "[note] I was thinking..." is something she might well write.
 */
const STARTS_AS_DATA = /^\s*[{[]\s*(?:["'{[]|\d)/;
/** An HTTP status line or a bare gateway error, which is a server talking and not a person. */
const SERVER_TALKING = /^\s*(?:HTTP\/\d|\d{3}\s+(?:Bad Gateway|Internal Server Error|Service Unavailable|Gateway Time-?out|Forbidden|Unauthorized|Not Found)\b)/i;
/** A stack trace as the WHOLE response: a first line, then nothing but frames. */
const WHOLLY_STACK = /^[^\n]*(?:Error|Exception)[^\n]*\n(?:\s*at\s+\S[^\n]*\n?){2,}$/;

export interface NotHers {
  /** What was wrong with it, for the fault channel. Never shown to him. */
  why: string;
}

/**
 * Whether a provider's response can become something she says or something she remembers.
 *
 * Returns `null` when it is fine. The caller turns a refusal into "produced nothing", which the
 * anti-theater rule already handles correctly everywhere: the action did not happen, the drive is
 * not discharged, and the moment is recorded as a failure rather than a silent success.
 */
export function notHers(text: string): NotHers | null {
  if (typeof text !== "string") return { why: `not text at all (${typeof text})` };
  const t = text.trim();
  if (t.length === 0) return null; // an empty answer is already handled as "produced nothing"

  if (t.length > MAX_UTTERANCE_CHARS) {
    return { why: `${t.length} characters; that is not a message` };
  }
  if (SERVER_TALKING.test(t)) return { why: "an HTTP status line: a server talking, not her" };
  if (WHOLLY_MARKUP.test(t)) return { why: "the whole response is markup" };
  if (WHOLLY_JSON.test(t)) return { why: "the whole response is a data structure" };
  if (STARTS_AS_DATA.test(t)) return { why: "it opens as a data structure; the response was cut off" };
  if (WHOLLY_STACK.test(t)) return { why: "the whole response is a stack trace" };

  // A single character repeated is a decoding failure or a runaway, never a sentence. Checked on the
  // set rather than by pattern so it holds for any character, including ones nobody thought of.
  if (t.length > 40 && new Set(t.replace(/\s/g, "")).size <= 1) {
    return { why: "one character repeated; nothing was decoded" };
  }
  // No letters anywhere is not a thing anyone said. Unicode-aware, so it is true of every language
  // she might think in rather than only of the Latin alphabet.
  if (t.length > 12 && !/\p{L}/u.test(t)) {
    return { why: "no letters in it at all" };
  }
  return null;
}
