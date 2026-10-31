// Invisible Unicode character detection (10 codepoints)
// Codepoints from Hermes-agent _CONTEXT_INVISIBLE_CHARS:
// \u200b, \u200c, \u200d, \u2060, \ufeff, \u202a-\u202e
// eslint-disable-next-line no-misleading-character-class
const INVISIBLE_CHAR_REGEX = /[\u200b\u200c\u200d\u2060\ufeff\u202a\u202b\u202c\u202d\u202e]/g;

export interface InvisibleCharMatch {
  char: string;
  codePoint: number;
  index: number;
}

export function containsInvisibleChars(input: string): { found: boolean; positions: InvisibleCharMatch[] } {
  const positions: InvisibleCharMatch[] = [];
  let match: RegExpExecArray | null;
  // eslint-disable-next-line no-misleading-character-class
  const regex = new RegExp(INVISIBLE_CHAR_REGEX.source, "g");
  while ((match = regex.exec(input)) !== null) {
    positions.push({
      char: match[0],
      codePoint: match[0].charCodeAt(0),
      index: match.index,
    });
  }
  return { found: positions.length > 0, positions };
}

export function stripInvisibleChars(input: string): string {
  return input.replace(INVISIBLE_CHAR_REGEX, "");
}
