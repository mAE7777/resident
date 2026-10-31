// Unicode homoglyph normalization (30 codepoints)
// Ported from OpenClaw src/security/external-content.ts (lines 115-174)

const FULLWIDTH_ASCII_OFFSET = 0xfee0;

// 15 angle-bracket pairs (30 codepoints) from OpenClaw's ANGLE_BRACKET_MAP
const ANGLE_BRACKET_MAP: Record<number, string> = {
  0xff1c: "<", 0xff1e: ">",
  0x2329: "<", 0x232a: ">",
  0x3008: "<", 0x3009: ">",
  0x2039: "<", 0x203a: ">",
  0x27e8: "<", 0x27e9: ">",
  0xfe64: "<", 0xfe65: ">",
  0x00ab: "<", 0x00bb: ">",
  0x300a: "<", 0x300b: ">",
  0x27ea: "<", 0x27eb: ">",
  0x27ec: "<", 0x27ed: ">",
  0x27ee: "<", 0x27ef: ">",
  0x276c: "<", 0x276d: ">",
  0x276e: "<", 0x276f: ">",
  0x02c2: "<", 0x02c3: ">",
};

function foldMarkerChar(char: string): string {
  const code = char.charCodeAt(0);
  if (code >= 0xff21 && code <= 0xff3a) return String.fromCharCode(code - FULLWIDTH_ASCII_OFFSET);
  if (code >= 0xff41 && code <= 0xff5a) return String.fromCharCode(code - FULLWIDTH_ASCII_OFFSET);
  const bracket = ANGLE_BRACKET_MAP[code];
  if (bracket) return bracket;
  return char;
}

function isMarkerIgnorableChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    code === 0x200b ||
    code === 0x200c ||
    code === 0x200d ||
    code === 0x2060 ||
    code === 0xfeff ||
    code === 0x00ad
  );
}

export function normalizeHomoglyphs(input: string): string {
  let result = "";
  for (const char of input) {
    if (isMarkerIgnorableChar(char)) continue;
    result += foldMarkerChar(char);
  }
  return result;
}
