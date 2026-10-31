const MAX_TAG_LEN = 16;
const OPEN_TAG = "<think>";
const CLOSE_TAG = "</think>";

export interface ThinkFilter {
  process(chunk: string): string;
  flush(): string;
}

/**
 * Stateful think-block filter that suppresses <think>...</think> blocks in
 * streamed text. Buffers up to MAX_TAG_LEN characters to handle tags that
 * arrive split across chunk boundaries.
 *
 * Block-boundary detection: <think> is treated as a structural tag only when
 * it appears at the very start of text or after a newline (with optional
 * trailing whitespace before the tag). Tags embedded in prose text are passed
 * through verbatim.
 */
export function createThinkFilter(): ThinkFilter {
  let inBlock = false;
  let buffer = "";

  /**
   * How much of the tail could still turn into a tag, and therefore has to be held back.
   *
   * This used to hold the last MAX_TAG_LEN characters unconditionally. On a screen that is
   * invisible. On the way to a mouth it is not: the voice renderer reads the same filtered
   * stream, so every utterance was sixteen characters behind the model, which at streaming
   * speed is 150-300ms off the one budget (time to first audio) that has no slack in it.
   *
   * Only a suffix that begins at a `<` and is a proper prefix of `<think>` or `</think>`
   * can still become a tag. Everything else is prose and can go out now.
   */
  function holdFrom(buf: string): number {
    const start = Math.max(0, buf.length - MAX_TAG_LEN);
    for (let i = start; i < buf.length; i++) {
      if (buf[i] !== "<") continue;
      const tail = buf.slice(i);
      if (OPEN_TAG.startsWith(tail) || CLOSE_TAG.startsWith(tail)) return i;
    }
    return buf.length;
  }

  /**
   * Whether anything but whitespace has already left this filter.
   *
   * Needed because the boundary test used to lean on the buffer still holding the text that
   * came before the tag. Now that the tail is released as soon as it cannot be part of a
   * tag, a `<think>` arriving at the START of a later chunk looks like it is at the start of
   * the stream, and prose like `result <thi` + `nk>hidden</think>` would be swallowed as a
   * block. The filter has to remember, not re-read.
   */
  let emittedNonWs = false;

  function noteEmitted(s: string): void {
    if (!emittedNonWs && /\S/u.test(s)) emittedNonWs = true;
  }

  function isBlockBoundary(pre: string): boolean {
    // Preserves the existing rule exactly: a tag is structural only when nothing but
    // whitespace precedes it. (The old code also tested `stripped.endsWith("\n")`, which can
    // never be true after `trimEnd()`, a dead branch, left dead rather than quietly
    // changed, since making it live would alter which blocks get stripped.)
    return !emittedNonWs && pre.trim() === "";
  }

  return {
    process(chunk: string): string {
      buffer += chunk;
      let output = "";

      while (buffer.length > 0) {
        if (inBlock) {
          const closeIdx = buffer.indexOf(CLOSE_TAG);
          if (closeIdx >= 0) {
            inBlock = false;
            buffer = buffer.slice(closeIdx + CLOSE_TAG.length);
          } else {
            // Hold last MAX_TAG_LEN in case the close tag is split across chunks
            if (buffer.length > MAX_TAG_LEN) {
              buffer = buffer.slice(-MAX_TAG_LEN);
            }
            break;
          }
        } else {
          const openIdx = buffer.indexOf(OPEN_TAG);
          if (openIdx >= 0) {
            const pre = buffer.slice(0, openIdx);
            if (isBlockBoundary(pre)) {
              output += pre;
              noteEmitted(pre);
              inBlock = true;
              buffer = buffer.slice(openIdx + OPEN_TAG.length);
            } else {
              // Not a structural block: pass the tag through as prose
              { const seg = buffer.slice(0, openIdx + OPEN_TAG.length); output += seg; noteEmitted(seg); }
              buffer = buffer.slice(openIdx + OPEN_TAG.length);
            }
          } else {
            // No open tag found. Emit the safe prefix and hold the tail in
            // case a partial tag is split at the chunk boundary.
            const safeLen = holdFrom(buffer);
            if (safeLen > 0) {
              { const seg = buffer.slice(0, safeLen); output += seg; noteEmitted(seg); }
              buffer = buffer.slice(safeLen);
            }
            break;
          }
        }
      }

      return output;
    },

    flush(): string {
      const result = inBlock ? "" : buffer;
      buffer = "";
      inBlock = false;
      return result;
    },
  };
}
