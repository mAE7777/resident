export const MESSAGE_LIMIT = 4096;
export const CAPTION_LIMIT = 1024;

/** Returns the number of UTF-16 code units in a string.
 *  JavaScript string.length already counts UTF-16 code units, so this is
 *  a direct pass-through, it matches Telegram's counting exactly. */
export function utf16Length(text: string): number {
  return text.length;
}

/** Returns the longest prefix of `text` whose UTF-16 length is <= `limit`,
 *  never breaking a surrogate pair at the cut point. */
export function prefixWithinUtf16Limit(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let end = limit;
  // If the char just before the cut is a high surrogate (0xD800–0xDBFF),
  // cutting there would leave an orphan surrogate, back up one.
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) {
    end--;
  }
  return text.slice(0, end);
}

/** Splits `text` into chunks each fitting within `limit` UTF-16 code units.
 *  Prefers splitting at newline boundaries; falls back to a hard split that
 *  respects surrogate pairs. */
export function splitMessage(text: string, limit = MESSAGE_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    // Try to split at the last newline within the limit.
    let splitAt = remaining.lastIndexOf("\n", limit - 1);

    if (splitAt <= 0) {
      // No usable newline: hard split at limit, respecting surrogates.
      splitAt = limit;
      const code = remaining.charCodeAt(splitAt - 1);
      if (code >= 0xd800 && code <= 0xdbff) {
        splitAt--;
      }
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt);
    } else {
      chunks.push(remaining.slice(0, splitAt));
      // Consume the newline itself so it doesn't appear at the start of the next chunk.
      remaining = remaining.slice(splitAt + 1);
    }
  }

  return chunks;
}
