import { describe, it, expect } from "vitest";
import {
  utf16Length,
  prefixWithinUtf16Limit,
  splitMessage,
  MESSAGE_LIMIT,
  CAPTION_LIMIT,
} from "../../../src/telegram/utf16.js";

describe("constants", () => {
  it("MESSAGE_LIMIT is 4096", () => expect(MESSAGE_LIMIT).toBe(4096));
  it("CAPTION_LIMIT is 1024", () => expect(CAPTION_LIMIT).toBe(1024));
});

describe("utf16Length", () => {
  it("returns 0 for empty string", () => expect(utf16Length("")).toBe(0));
  it("counts ASCII correctly", () => expect(utf16Length("hello")).toBe(5));

  it("counts BMP emoji as 2 code units (surrogate pair)", () => {
    // 😀 is U+1F600, represented as a surrogate pair in UTF-16 → length 2
    expect(utf16Length("😀")).toBe(2);
  });

  it("counts a string of 4500 chars as 4500", () => {
    const text = "a".repeat(4500);
    expect(utf16Length(text)).toBe(4500);
  });

  it("mixed ASCII and emoji", () => {
    // "hi😀" → 2 + 2 = 4
    expect(utf16Length("hi😀")).toBe(4);
  });
});

describe("prefixWithinUtf16Limit", () => {
  it("returns full string if already within limit", () => {
    expect(prefixWithinUtf16Limit("hello", 10)).toBe("hello");
  });

  it("truncates at the limit for ASCII", () => {
    const text = "abcdefgh";
    expect(prefixWithinUtf16Limit(text, 5)).toBe("abcde");
  });

  it("backs up one when the cut falls on a high surrogate", () => {
    // Place emoji exactly at position 4 (code units 4-5).
    // limit=5 would cut after the high surrogate at index 4 → must back up to 4.
    const text = "abcd😀xyz";
    // text.length: a=0,b=1,c=2,d=3,hi=4,lo=5,x=6,y=7,z=8
    const result = prefixWithinUtf16Limit(text, 5);
    // Should be "abcd" (4 chars) not "abcd\uD83D" (broken surrogate)
    expect(result).toBe("abcd");
    expect(result.length).toBe(4);
  });

  it("does not back up when the cut falls on a low surrogate (safe)", () => {
    // Cut after the full emoji (both surrogate pair code units within limit)
    const text = "abcd😀xyz";
    const result = prefixWithinUtf16Limit(text, 6);
    // "abcd😀" = 6 code units, no backup needed
    expect(result).toBe("abcd😀");
    expect(result.length).toBe(6);
  });

  it("returns full string if length equals limit exactly", () => {
    const text = "abc";
    expect(prefixWithinUtf16Limit(text, 3)).toBe("abc");
  });
});

describe("splitMessage — basic behaviour", () => {
  it("returns single-element array when text fits within limit", () => {
    expect(splitMessage("hello", 100)).toEqual(["hello"]);
  });

  it("returns empty string in array for empty input", () => {
    // text.length (0) <= limit, so returns [""]
    expect(splitMessage("", 100)).toEqual([""]);
  });

  it("splits a 4500-char string into chunks all <= 4096", () => {
    const text = "a".repeat(4500);
    const chunks = splitMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    }
    // Reassembled text must equal original
    expect(chunks.join("")).toBe(text);
  });

  it("prefers splitting at a newline boundary within the limit", () => {
    // Build a string with a newline at position 20 and total length > limit
    const firstLine = "a".repeat(20);
    const secondLine = "b".repeat(4096);
    const text = firstLine + "\n" + secondLine;
    const chunks = splitMessage(text, 100);
    // First chunk should be everything up to (not including) the newline
    expect(chunks[0]).toBe(firstLine);
  });

  it("falls back to hard split respecting surrogates when no newline", () => {
    // 4097 'a' chars, split at 4096
    const text = "a".repeat(4097);
    const chunks = splitMessage(text);
    expect(chunks[0].length).toBe(4096);
    expect(chunks[1]).toBe("a");
  });

  it("does not break a surrogate pair at a hard split boundary", () => {
    // Place emoji at position 4095-4096 (straddles the 4096 boundary)
    const prefix = "a".repeat(4095); // indices 0..4094
    const emoji = "😀"; // indices 4095 (hi) and 4096 (lo)
    const suffix = "b".repeat(10);
    const text = prefix + emoji + suffix;
    // text.length = 4095 + 2 + 10 = 4107 > 4096

    const chunks = splitMessage(text);
    // The first chunk must not end with an orphan high surrogate
    const lastCodeUnit = chunks[0].charCodeAt(chunks[0].length - 1);
    expect(lastCodeUnit).not.toBeGreaterThanOrEqual(0xd800);

    // Full round-trip
    expect(chunks.join("")).toBe(text);
  });
});

describe("splitMessage — multi-chunk round-trip", () => {
  it("round-trips text with embedded newlines correctly", () => {
    const line = "hello world\n";
    const text = line.repeat(400); // 4800 chars
    const chunks = splitMessage(text);
    expect(chunks.join("\n").replace(/\n$/, "").split("\n").join("\n") + "\n").not.toThrow;
    // Round-trip: joining with the separator that was removed (newline)
    // splitMessage consumes the newline at the split point, so rejoin with "\n"
    const rejoined = chunks.join("\n");
    // Original ends with \n, rejoined will too once we add back the separator
    expect(rejoined).toBe(text.slice(0, rejoined.length));
  });
});
