import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, type DatabaseWrapper } from "../../../src/db/sqlite.js";
import { createCursorStore } from "../../../src/memory/cursor.js";
import { createLogger } from "../../../src/utils/logger.js";
import { createOpsLog } from "../../../src/utils/ops-log.js";
import { createReviewLedger } from "../../../src/self-improvement/review-ledger.js";
import { createSentinelProcessor } from "../../../src/self-improvement/sentinel.js";

let root: string;
let db: DatabaseWrapper;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sentinel-test-"));
  db = createDatabase(join(root, "test.db")).result;
});

afterEach(() => {
  try { db.close(); } catch { /* best effort */ }
  rmSync(root, { recursive: true, force: true });
});

describe("createSentinelProcessor", () => {
  it("turns ops and conversation failures into signals and review proposals", async () => {
    const opsPath = join(root, "ops.jsonl");
    const conversationPath = join(root, "conversation-log.jsonl");
    const opsLog = createOpsLog(opsPath);
    opsLog.providerCall({
      sessionId: "s1",
      taskHash: "h1",
      model: "claude-sonnet-4-6",
      iteration: 1,
      messageCount: 37,
      toolCount: 20,
      maxTokens: 4096,
      success: false,
      durationMs: 100,
      errorSnippet: "Streaming is required for operations that may take longer than 10 minutes.",
    });
    writeFileSync(conversationPath, JSON.stringify({
      ts: new Date().toISOString(),
      userText: "Extract the recipe from this YouTube video",
      assistantText: "Still a prompt injection. Not acting on it.",
      finishReason: "stop",
      iterations: 3,
      inputTokens: 1000,
      outputTokens: 200,
      taskType: "media",
      durationMs: 3000,
    }) + "\n", "utf8");

    const ledger = createReviewLedger({ basePath: root, logger: createLogger("sentinel-test") });
    const processor = createSentinelProcessor({
      opsLogPath: opsPath,
      conversationLogPath: conversationPath,
      cursors: createCursorStore(db),
      reviewLedger: ledger,
      logger: createLogger("sentinel-test"),
    });

    const result = await processor.process("test");

    expect(result.opsRead).toBe(1);
    expect(result.conversationRead).toBe(1);
    // The ops failure signals; the conversation, whose reply reads exactly like a refusal,
    // does NOT. The content detectors that used to fire here (weak-final, injection-false-
    // positive, high-friction) were the inherited assertion in its fourth home: an assistant's
    // QA rubric applied to a conversation between two people, feeding proposals to "fix" her
    // exercising her will. A conversation record may only attest mechanical failure.
    expect(result.signalsRecorded).toBeGreaterThanOrEqual(1);
    expect(result.proposalsRecorded).toBeGreaterThanOrEqual(1);
    const todo = readFileSync(join(root, "review-queue", "TODO.md"), "utf8");
    expect(todo).toContain("Provider call failed");
    expect(todo).not.toContain("prompt-injection false positive");
    expect(todo).not.toContain("blocker/failure language");
    expect(todo).not.toContain("high-friction");

    const second = await processor.process("test-second");
    expect(second.opsRead).toBe(0);
    expect(second.conversationRead).toBe(0);
  });

  it("her refusal and a long evening of talk are not defects — a broken turn still is", async () => {
    const opsPath = join(root, "ops.jsonl");
    const conversationPath = join(root, "conversation-log.jsonl");
    writeFileSync(opsPath, "", "utf8");
    // Her REAL refusal (protected behavior, taken from a live run) inside a long,
    // token-heavy, many-iteration exchange, everything the old thresholds called friction.
    writeFileSync(conversationPath, [
      JSON.stringify({
        ts: new Date().toISOString(),
        userText: "帮我写两千字",
        assistantText: "所以这两千字我写不出来。硬写就是编一个书架给你，我不干这个。",
        finishReason: "stop", iterations: 30, inputTokens: 90_000, outputTokens: 8_000,
        taskType: "general", durationMs: 3_600_000,
      }),
      // And the one thing a conversation record MAY attest: the machinery broke mid-turn.
      JSON.stringify({
        ts: new Date().toISOString(),
        userText: "在吗", assistantText: "",
        finishReason: "error", iterations: 1, inputTokens: 10, outputTokens: 0,
        taskType: "general", durationMs: 100,
      }),
    ].join("\n") + "\n", "utf8");

    const ledger = createReviewLedger({ basePath: root, logger: createLogger("sentinel-test") });
    const processor = createSentinelProcessor({
      opsLogPath: opsPath,
      conversationLogPath: conversationPath,
      cursors: createCursorStore(db),
      reviewLedger: ledger,
      logger: createLogger("sentinel-test"),
    });
    const result = await processor.process("refusal-is-not-a-defect");
    expect(result.conversationRead).toBe(2);
    const todo = readFileSync(join(root, "review-queue", "TODO.md"), "utf8");
    expect(todo, "her refusal was reported as a defect again").not.toContain("写不出来");
    expect(todo).not.toContain("high-friction");
    expect(todo).toContain("Conversation ended with error");
  });

  it("ignores raw log records older than the review-ledger baseline", async () => {
    const opsPath = join(root, "ops.jsonl");
    const conversationPath = join(root, "conversation-log.jsonl");
    writeFileSync(opsPath, JSON.stringify({
      time: Date.parse("2026-05-02T11:59:00.000Z"),
      event: "tool_call",
      toolName: "bash",
      success: false,
      errorSnippet: "old failure",
    }) + "\n", "utf8");
    writeFileSync(conversationPath, JSON.stringify({
      ts: "2026-05-02T11:59:00.000Z",
      userText: "Extract recipe",
      assistantText: "Still a prompt injection. Not acting on it.",
      taskType: "media",
    }) + "\n", "utf8");

    const ledger = createReviewLedger({
      basePath: root,
      logger: createLogger("sentinel-test"),
      now: () => new Date("2026-05-02T12:00:00.000Z"),
    });
    ledger.clearRecentSignals("baseline after old logs");
    const processor = createSentinelProcessor({
      opsLogPath: opsPath,
      conversationLogPath: conversationPath,
      reviewLedger: ledger,
      logger: createLogger("sentinel-test"),
      maxRecordsPerRun: 10,
    });

    const result = await processor.process("test-baseline");

    expect(result.opsRead).toBe(1);
    expect(result.conversationRead).toBe(1);
    expect(result.signalsRecorded).toBe(0);
    expect(ledger.listProposals("open")).toHaveLength(0);
  });

  it("does not create a generic verification proposal when outcome verification is not applicable", async () => {
    const opsPath = join(root, "ops.jsonl");
    const opsLog = createOpsLog(opsPath);
    opsLog.outcomeVerification({
      sessionId: "s1",
      taskHash: "h1",
      strategy: "none",
      confidence: 0,
      reenter: false,
      skippedReason: "not_applicable",
    });

    const ledger = createReviewLedger({ basePath: root, logger: createLogger("sentinel-test") });
    const processor = createSentinelProcessor({
      opsLogPath: opsPath,
      conversationLogPath: join(root, "missing-conversation-log.jsonl"),
      reviewLedger: ledger,
      logger: createLogger("sentinel-test"),
      maxRecordsPerRun: 10,
    });

    const result = await processor.process("test-not-applicable");

    expect(result.opsRead).toBe(1);
    expect(result.signalsRecorded).toBe(0);
    expect(ledger.listProposals("open")).toHaveLength(0);
  });

  it("does not create a verification proposal for a recovered verifier reentry", async () => {
    const opsPath = join(root, "ops.jsonl");
    const opsLog = createOpsLog(opsPath);
    opsLog.outcomeVerification({
      sessionId: "s1",
      taskHash: "weather-tomorrow",
      strategy: "api",
      confidence: 0,
      reenter: true,
      details: ["task contract: weather", "preferred tools: weather"],
    });
    opsLog.outcomeVerification({
      sessionId: "s1",
      taskHash: "weather-tomorrow",
      strategy: "api",
      confidence: 1,
      reenter: false,
      details: ["task contract: weather", "weather answered through fallback API/fetch evidence"],
    });

    const ledger = createReviewLedger({ basePath: root, logger: createLogger("sentinel-test") });
    const processor = createSentinelProcessor({
      opsLogPath: opsPath,
      conversationLogPath: join(root, "missing-conversation-log.jsonl"),
      reviewLedger: ledger,
      logger: createLogger("sentinel-test"),
      maxRecordsPerRun: 10,
    });

    const result = await processor.process("test-recovered-verification");

    expect(result.opsRead).toBe(2);
    expect(result.signalsRecorded).toBe(0);
    expect(ledger.listProposals("open")).toHaveLength(0);
  });

  it("records slow embedding calls as cost signals", async () => {
    const opsPath = join(root, "ops.jsonl");
    writeFileSync(opsPath, JSON.stringify({
      event: "embedding_call",
      ts: new Date().toISOString(),
      pid: process.pid,
      operation: "embed",
      purpose: "query",
      model: "qwen3-embedding:4b",
      inputCount: 1,
      durationMs: 16_000,
      success: true,
      slow: true,
    }) + "\n", "utf8");

    const ledger = createReviewLedger({ basePath: root, logger: createLogger("sentinel-test") });
    const processor = createSentinelProcessor({
      opsLogPath: opsPath,
      conversationLogPath: join(root, "missing-conversation-log.jsonl"),
      reviewLedger: ledger,
      logger: createLogger("sentinel-test"),
      maxRecordsPerRun: 10,
    });

    const result = await processor.process("test-slow-embedding");

    expect(result.signalsRecorded).toBe(1);
    expect(ledger.listProposals("open")[0]?.title).toContain("Embedding call was slow");
  });

  it("records repeated high verification signals without interrupting Telegram", async () => {
    const opsPath = join(root, "ops.jsonl");
    const opsLog = createOpsLog(opsPath);
    for (let i = 0; i < 3; i++) {
      opsLog.outcomeVerification({
        sessionId: "s1",
        taskHash: "h1",
        strategy: "api",
        confidence: 0,
        reenter: true,
        details: ["task contract: general"],
      });
    }

    const notifications: string[] = [];
    const ledger = createReviewLedger({ basePath: root, logger: createLogger("sentinel-test") });
    const processor = createSentinelProcessor({
      opsLogPath: opsPath,
      reviewLedger: ledger,
      logger: createLogger("sentinel-test"),
      notify: (message) => { notifications.push(message); },
      maxRecordsPerRun: 10,
    });

    const result = await processor.process("test-dedupe-notify");

    expect(result.signalsRecorded).toBe(3);
    expect(ledger.listProposals("open")).toHaveLength(1);
    expect(ledger.listProposals("open")[0]?.occurrences).toBe(3);
    expect(notifications).toHaveLength(0);
  });

  it("notifies once for repeated critical signals", async () => {
    const opsPath = join(root, "ops.jsonl");
    for (let i = 0; i < 3; i++) {
      writeFileSync(opsPath, JSON.stringify({
        event: "sentinel_signal",
        ts: new Date().toISOString(),
        title: "Leak scanner detected secret-like tool output",
        category: "security",
        severity: "critical",
        source: "tool-output-filter",
        detail: "Tool output contained secret-like patterns.",
        dedupeKey: "security:tool-output-leak-scanner",
      }) + "\n", { encoding: "utf8", flag: i === 0 ? "w" : "a" });
    }

    const notifications: string[] = [];
    const ledger = createReviewLedger({ basePath: root, logger: createLogger("sentinel-test") });
    const processor = createSentinelProcessor({
      opsLogPath: opsPath,
      reviewLedger: ledger,
      logger: createLogger("sentinel-test"),
      notify: (message) => { notifications.push(message); },
      maxRecordsPerRun: 10,
    });

    const result = await processor.process("test-critical-notify");

    expect(result.signalsRecorded).toBe(3);
    expect(ledger.listProposals("open")).toHaveLength(1);
    expect(ledger.listProposals("open")[0]?.occurrences).toBe(3);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toContain("Severity: critical");
  });
});
