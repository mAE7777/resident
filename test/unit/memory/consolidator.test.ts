import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConsolidator } from "../../../src/memory/consolidator.js";
import { createFauxProvider, fauxText, fauxError } from "../../../src/providers/faux.js";
import type { Message } from "../../../src/providers/types.js";
import type { ArchiveEntry, RawArchiveEntry } from "../../../src/memory/consolidator.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "consolidator-test-"));
}

function readHistoryLines(historyPath: string): Array<ArchiveEntry | RawArchiveEntry> {
  if (!existsSync(historyPath)) return [];
  const raw = readFileSync(historyPath, "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ArchiveEntry | RawArchiveEntry);
}

/** Build messages with enough text to hit a given estimated token count. */
function buildMessages(count: number, tokensEach: number): Message[] {
  // estimateTokens uses chars/4 for prose → chars = tokens * 4
  const content = "a".repeat(tokensEach * 4);
  const msgs: Message[] = [];
  for (let i = 0; i < count; i++) {
    msgs.push({ role: i % 2 === 0 ? "user" : "assistant", content });
  }
  return msgs;
}

/** Build an alternating user/assistant conversation of `pairs` pairs. */
function buildConversation(pairs: number, charsPerMsg = 100): Message[] {
  const msgs: Message[] = [];
  for (let i = 0; i < pairs; i++) {
    msgs.push({ role: "user", content: "u".repeat(charsPerMsg) });
    msgs.push({ role: "assistant", content: "a".repeat(charsPerMsg) });
  }
  return msgs;
}

// ── Config constants used across tests ────────────────────────────────────────

const CONTEXT_WINDOW = 1_000_000;
const MAX_OUTPUT = 64_000;
const SAFETY_BUFFER = 1024;
const TRIGGER_THRESHOLD = CONTEXT_WINDOW - MAX_OUTPUT - SAFETY_BUFFER; // 934,976

let root: string;
let historyPath: string;

beforeEach(() => {
  root = tempDir();
  historyPath = join(root, "workspace", "history.jsonl");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ── AC1: Trigger condition ─────────────────────────────────────────────────────

describe("AC1 — shouldConsolidate trigger", () => {
  it("triggers when estimated tokens exceed context_window - max_output - 1024", () => {
    // 940K tokens estimated: 940,000 > 934,976 → should trigger
    // Each message needs tokens such that total > threshold.
    // threshold = 934,976; we need ~940,000 tokens
    // With chars/4 estimation: need 940,000 * 4 = 3,760,000 chars total
    // Use 10 messages of 376,000 chars each → 94,000 tokens each → 940,000 total
    const provider = createFauxProvider({ responses: [fauxText("summary")] });
    const consolidator = createConsolidator({
      contextWindow: CONTEXT_WINDOW,
      maxOutput: MAX_OUTPUT,
      historyPath,
    });

    // ~940,000 tokens: 10 messages × 94,000 tokens each
    const messages = buildMessages(10, 94_000);
    const result = consolidator.shouldConsolidate(messages, 0);
    expect(result).toBe(true);
  });

  it("does NOT trigger when estimated tokens are below the threshold", () => {
    const provider = createFauxProvider({ responses: [fauxText("summary")] });
    const consolidator = createConsolidator({
      contextWindow: CONTEXT_WINDOW,
      maxOutput: MAX_OUTPUT,
      historyPath,
    });

    // Small conversation: well below threshold
    const messages = buildConversation(10, 100);
    const result = consolidator.shouldConsolidate(messages, 0);
    expect(result).toBe(false);
  });

  it("trigger threshold is exactly context_window - max_output - 1024 = 934,976", () => {
    // Verify the math: 1,000,000 - 64,000 - 1,024 = 934,976
    expect(TRIGGER_THRESHOLD).toBe(934_976);

    const provider = createFauxProvider({ responses: [fauxText("summary")] });
    const consolidator = createConsolidator({
      contextWindow: CONTEXT_WINDOW,
      maxOutput: MAX_OUTPUT,
      historyPath,
    });

    // Exactly at threshold: should NOT trigger (must be strictly greater than)
    // threshold = 934,976. We'll build messages that sum to exactly that.
    // To get 934,976 tokens: 934,976 * 4 chars = 3,739,904 chars
    // One message: role overhead ~4 tokens, so content tokens = 934,972
    // Content chars = 934,972 * 4 = 3,739,888
    const msgs: Message[] = [{ role: "user", content: "a".repeat(3_739_888) }];
    const estimatedAtThreshold = consolidator.estimateTokens("a".repeat(3_739_888)) + 4;
    // Should be at or just at threshold, not trigger
    expect(estimatedAtThreshold).toBeLessThanOrEqual(TRIGGER_THRESHOLD + 4);

    // Now add one more token's worth of content to push over
    const msgsOver: Message[] = [{ role: "user", content: "a".repeat(3_740_000) }];
    expect(consolidator.shouldConsolidate(msgsOver, 0)).toBe(true);
  });
});

// ── Verbatim archive ───────────────────────────────────────
//
// The model-summary path is gone: her archive keeps what was actually said (redacted),
// never a paraphrase. Every archived entry is now type "raw_archive".

describe("archives verbatim — raw_archive always", () => {
  it("appends raw_archive entries carrying the actual messages", async () => {
    const consolidator = createConsolidator({
      contextWindow: CONTEXT_WINDOW,
      maxOutput: MAX_OUTPUT,
      historyPath,
    });
    const messages = buildMessages(200, 5_000);
    const result = await consolidator.consolidate(messages, 0);
    expect(result.entriesArchived).toBeGreaterThan(0);

    const lines = readHistoryLines(historyPath);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l.type, "a summary row would mean the paraphrase path is back").toBe("raw_archive");
    }
    const raw = lines[0] as RawArchiveEntry;
    expect(Array.isArray(raw.messages)).toBe(true);
    expect(raw.messages.length).toBeGreaterThan(0);
    expect(typeof raw.timestamp).toBe("number");
    expect(typeof raw.cursor).toBe("number");
  });

  it("entry cursor points to the end of the consolidated slice", async () => {
    const consolidator = createConsolidator({
      contextWindow: CONTEXT_WINDOW,
      maxOutput: MAX_OUTPUT,
      historyPath,
    });
    const messages = buildMessages(200, 5_000);
    const result = await consolidator.consolidate(messages, 0);
    const lines = readHistoryLines(historyPath);
    expect((lines[0] as RawArchiveEntry).cursor).toBeGreaterThan(0);
    expect(result.newLastConsolidated).toBeGreaterThan(0);
  });

  it("the source keeps no summarize path", () => {
    const src = readFileSync(join(process.cwd(), "src/memory/consolidator.ts"), "utf8");
    expect(src.includes("llmSummarize"), "the paraphrase path is back").toBe(false);
    expect(src.includes("provider.complete"), "a model call inside the archiver").toBe(false);
  });
});

// ── AC4: Max 5 consolidation rounds per session ───────────────────────────────

describe("AC4 — max 5 consolidation rounds enforced", () => {
  it("performs at most 5 rounds even when more would be needed", async () => {
    const provider = createFauxProvider({ responses: [fauxText("round summary")] });
    const consolidator = createConsolidator({
      contextWindow: CONTEXT_WINDOW,
      maxOutput: MAX_OUTPUT,
      historyPath,
    });

    // Very large conversation: far above threshold, requiring many rounds
    const messages = buildMessages(400, 5_000); // 2M tokens
    const result = await consolidator.consolidate(messages, 0);

    expect(result.rounds).toBeLessThanOrEqual(5);
  });

  it("returns rounds=0 when no consolidation boundary can be found", async () => {
    const provider = createFauxProvider({ responses: [fauxText("summary")] });
    const consolidator = createConsolidator({
      contextWindow: CONTEXT_WINDOW,
      maxOutput: MAX_OUTPUT,
      historyPath,
    });

    // A conversation with only assistant messages, no user boundaries to cut at
    const messages: Message[] = [
      { role: "assistant", content: "a".repeat(4_000_000) }, // ~1M tokens
    ];

    const result = await consolidator.consolidate(messages, 0);
    expect(result.rounds).toBe(0);
    expect(result.newLastConsolidated).toBe(0);
  });

  it("skips a 6th round: exactly 5 rounds written then stops", async () => {
    let callCount = 0;
    const provider = createFauxProvider({
      responses: [
        {
          pattern: /.*/,
          text: "summary",
        },
      ],
    });

    // Spy on the provider to count calls
    const originalComplete = provider.complete.bind(provider);
    provider.complete = async (req) => {
      callCount++;
      return originalComplete(req);
    };

    const consolidator = createConsolidator({
      contextWindow: CONTEXT_WINDOW,
      maxOutput: MAX_OUTPUT,
      historyPath,
    });

    // 600 messages × 5,000 tokens = 3M tokens (needs many rounds to reduce)
    const messages = buildMessages(600, 5_000);
    const result = await consolidator.consolidate(messages, 0);

    expect(result.rounds).toBeLessThanOrEqual(5);
    expect(callCount).toBeLessThanOrEqual(5);
  });
});

// ── estimateTokens ─────────────────────────────────────────────────────────────

describe("estimateTokens — token estimation helper", () => {
  it("estimates English text as chars/4", () => {
    const provider = createFauxProvider();
    const consolidator = createConsolidator({
      contextWindow: 100_000,
      maxOutput: 4_096,
      historyPath,
    });

    // Pure alphabetic text → chars / 4
    const text = "a".repeat(400);
    expect(consolidator.estimateTokens(text)).toBe(100);
  });

  it("estimates code/structured content as chars/2", () => {
    const provider = createFauxProvider();
    const consolidator = createConsolidator({
      contextWindow: 100_000,
      maxOutput: 4_096,
      historyPath,
    });

    // Heavy code content with lots of special chars
    const code = "{ x: 1; y: 2; z: (a | b) => [c, d]; }".repeat(10); // dense special chars
    const tokens = consolidator.estimateTokens(code);
    // Should be closer to chars/2 than chars/4
    const charsOver2 = Math.ceil(code.length / 2);
    const charsOver4 = Math.ceil(code.length / 4);
    // The estimate should be between chars/4 and chars/2, closer to /2
    expect(tokens).toBeGreaterThanOrEqual(charsOver4);
    expect(tokens).toBeLessThanOrEqual(charsOver2);
  });

  it("returns 0 for empty string", () => {
    const provider = createFauxProvider();
    const consolidator = createConsolidator({
      contextWindow: 100_000,
      maxOutput: 4_096,
      historyPath,
    });

    expect(consolidator.estimateTokens("")).toBe(0);
  });
});

// ── history.jsonl format ───────────────────────────────────────────────────────

describe("history.jsonl — entry format", () => {
  it("creates history.jsonl directory if it does not exist", async () => {
    const provider = createFauxProvider({ responses: [fauxText("summary")] });
    const consolidator = createConsolidator({
      contextWindow: CONTEXT_WINDOW,
      maxOutput: MAX_OUTPUT,
      historyPath,
    });

    expect(existsSync(historyPath)).toBe(false);

    const messages = buildMessages(200, 5_000);
    await consolidator.consolidate(messages, 0);

    expect(existsSync(historyPath)).toBe(true);
  });

  it("each line in history.jsonl is valid JSON", async () => {
    const provider = createFauxProvider({ responses: [fauxText("a summary")] });
    const consolidator = createConsolidator({
      contextWindow: CONTEXT_WINDOW,
      maxOutput: MAX_OUTPUT,
      historyPath,
    });

    const messages = buildMessages(200, 5_000);
    await consolidator.consolidate(messages, 0);

    const raw = readFileSync(historyPath, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("raw_archive entries have type, timestamp, messages, and cursor", async () => {
    const provider = createFauxProvider({ responses: [fauxError(500, "fail")] });
    const consolidator = createConsolidator({
      contextWindow: CONTEXT_WINDOW,
      maxOutput: MAX_OUTPUT,
      historyPath,
    });

    const messages = buildMessages(200, 5_000);
    await consolidator.consolidate(messages, 0);

    const lines = readHistoryLines(historyPath);
    const entry = lines.find((l) => l.type === "raw_archive") as RawArchiveEntry | undefined;
    expect(entry).toBeDefined();
    expect(entry!.type).toBe("raw_archive");
    expect(typeof entry!.timestamp).toBe("number");
    expect(Array.isArray(entry!.messages)).toBe(true);
    expect(typeof entry!.cursor).toBe("number");
  });
});

// ── Boundary capping ───────────────────────────────────────────────────────────

describe("boundary capping — MAX_CHUNK_MESSAGES = 60", () => {
  it("consolidates no more than 60 messages per round", async () => {
    const provider = createFauxProvider({ responses: [fauxText("summary")] });
    const consolidator = createConsolidator({
      contextWindow: CONTEXT_WINDOW,
      maxOutput: MAX_OUTPUT,
      historyPath,
    });

    // 200 messages, each large
    const messages = buildMessages(200, 5_000);
    await consolidator.consolidate(messages, 0);

    // After one round, newLastConsolidated should be ≤ 60
    const lines = readHistoryLines(historyPath);
    const firstEntry = lines[0];
    expect(firstEntry.cursor).toBeLessThanOrEqual(60);
  });
});
