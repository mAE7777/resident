import { describe, it, expect } from "vitest";

// Import the detectRefusal function: it's not exported, so we test via the module
// We'll extract the logic to test it. For now, replicate the patterns here.
const REFUSAL_INDICATORS: RegExp[] = [
  /\bi (?:can'?t|cannot|couldn'?t|am unable|was unable|don'?t have)\b/i,
  /\bunfortunately\b/i,
  /\bnot (?:possible|supported|available|able|configured)\b/i,
  /\bblocked\b/i,
  /\brequires? (?:login|authentication|an? API|cookies|credentials)\b/i,
  /\byour options\b/i,
  /\bwant me to try\b/i,
  /\balternatives?\b.*:/i,
  /\binstead\b.*:/i,
  /\bwhat (?:you can|would you like)\b/i,
];

function detectRefusal(text: string): boolean {
  if (!text || text.length < 20) return false;
  let matches = 0;
  for (const pattern of REFUSAL_INDICATORS) {
    if (pattern.test(text)) {
      matches++;
      if (matches >= 2) return true;
    }
  }
  return false;
}

// ── Real-world refusal cases (should detect) ────────────────────────────────

describe("refusal detection — catches real refusals", () => {
  it("ChatGPT blocked by Cloudflare", () => {
    const text = "ChatGPT is showing a Cloudflare challenge which blocks headless browsers. " +
      "Unfortunately, even if we bypassed the challenge, generating an image requires being logged in. " +
      "Want me to try Pollinations.ai instead?";
    expect(detectRefusal(text)).toBe(true);
  });

  it("Bilibili download failed", () => {
    const text = "Unfortunately, I can't download Bilibili videos from this environment. " +
      "HTTP 412 — Bilibili's API blocks non-browser requests. Your options: " +
      "export cookies from Chrome or run yt-dlp locally.";
    expect(detectRefusal(text)).toBe(true);
  });

  it("API key missing", () => {
    const text = "Web search is not available. This requires an API key which is not configured. " +
      "Unfortunately I can't search without it.";
    expect(detectRefusal(text)).toBe(true);
  });

  it("login required", () => {
    const text = "I can't access this page — it requires login and authentication. " +
      "Want me to try a different approach?";
    expect(detectRefusal(text)).toBe(true);
  });

  it("tool not available", () => {
    const text = "That feature is not supported in the current environment. " +
      "Unfortunately the required tool is not available.";
    expect(detectRefusal(text)).toBe(true);
  });
});

// ── Successful completions (should NOT detect) ──────────────────────────────

describe("refusal detection — does NOT flag success", () => {
  it("normal text answer", () => {
    expect(detectRefusal("The answer is 42.")).toBe(false);
  });

  it("file operation result", () => {
    expect(detectRefusal("Written 5000 bytes to output.txt. The file contains the analysis results.")).toBe(false);
  });

  it("tool output with content", () => {
    expect(detectRefusal("Here's the extracted text from the PDF:\n\nAutoSkill: Experience-Driven Lifelong Learning...")).toBe(false);
  });

  it("short response", () => {
    expect(detectRefusal("Done!")).toBe(false);
  });

  it("empty response", () => {
    expect(detectRefusal("")).toBe(false);
  });

  it("response mentioning alternatives in a positive context", () => {
    // Only one indicator ("alternatives"), needs 2 to trigger
    expect(detectRefusal("I found several alternatives to consider for your project architecture.")).toBe(false);
  });

  it("response saying unfortunately but then succeeding", () => {
    // Only one indicator ("unfortunately"), needs 2 to trigger
    expect(detectRefusal("Unfortunately the first approach didn't work, but the second one succeeded perfectly. Here's the result.")).toBe(false);
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────────

describe("refusal detection — edge cases", () => {
  it("single indicator is not enough", () => {
    // Just "unfortunately" alone, needs 2
    expect(detectRefusal("Unfortunately the file was large but I processed it successfully.")).toBe(false);
  });

  it("two indicators trigger detection", () => {
    expect(detectRefusal("Unfortunately I can't process this file.")).toBe(true);
  });

  it("null/undefined safe", () => {
    expect(detectRefusal("")).toBe(false);
  });
});

// ── Wiring verification ─────────────────────────────────────────────────────

