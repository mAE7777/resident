import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpsLog } from "../../../src/utils/ops-log.js";

function readEvents(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("createOpsLog", () => {
  it("writes lifecycle events as JSONL", () => {
    const root = mkdtempSync(join(tmpdir(), "ops-log-test-"));
    const logPath = join(root, "ops.jsonl");
    try {
      const opsLog = createOpsLog(logPath);

      opsLog.sessionStart({
        chatId: 123,
        model: "claude-sonnet-4-6",
        effortTier: "medium",
        taskType: "general",
        tierUpgraded: false,
        messagePreview: "yes",
      });
      opsLog.planMode({ sessionId: "s1", taskHash: "h1", ran: false, skippedReason: "not_complex" });
      opsLog.toolCallStart({
        toolName: "video_extract",
        callId: "toolu_1",
      });
      opsLog.providerCallStart({
        sessionId: "s1",
        taskHash: "h1",
        model: "claude-sonnet-4-6",
        iteration: 1,
        messageCount: 3,
        toolCount: 20,
        maxTokens: 4096,
      });
      opsLog.providerCall({
        sessionId: "s1",
        taskHash: "h1",
        model: "claude-sonnet-4-6",
        iteration: 1,
        messageCount: 3,
        toolCount: 20,
        maxTokens: 4096,
        success: false,
        durationMs: 12,
        errorSnippet: "streaming required",
      });
      opsLog.outcomeVerification({
        sessionId: "s1",
        taskHash: "h1",
        strategy: "none",
        confidence: 1,
        reenter: false,
        skippedReason: "not_applicable",
      });
      opsLog.stuckDetection({
        sessionId: "s1",
        taskHash: "h1",
        pattern: "repeat_action",
        interventionCount: 2,
        noveltyFallbackInjected: true,
        triggerSource: "tool_stuck",
      });
      opsLog.noveltyFallback({
        sessionId: "s1",
        taskHash: "h1",
        stuckInterventionCount: 2,
        triggerSource: "tool_stuck",
      });
      opsLog.activeRecall({
        sessionId: "s1",
        taskHash: "h1",
        status: "timeout",
        entries: 0,
        latencyMs: 15000,
      });
      opsLog.embeddingCall({
        operation: "embed",
        purpose: "query",
        model: "qwen3-embedding:0.6b",
        inputCount: 1,
        durationMs: 1200,
        success: true,
        dimensions: 1024,
        slow: true,
      });
      opsLog.capabilityGap({
        sessionId: "s1",
        taskHash: "h1",
        taskKind: "video_extraction",
        reason: "successful task used raw bash",
        toolSequence: ["bash", "read"],
        recommendedTool: "video_extract",
      });
      opsLog.capabilityProposal({
        proposalId: "cap-123",
        signature: "video_extraction:video_extract:raw_bash_success",
        proposalType: "routing_rule",
        title: "Replace raw bash",
        evidenceCount: 2,
      });
      opsLog.unknownObservation({
        sessionId: "s1",
        taskHash: "h1",
        taskKind: "video_extraction",
        taskSummary: "extract recipe from video",
        category: "semantic_success",
        severity: "high",
        assumption: "video transcript represents the requested video",
        uncertainty: "recipe may be sourced from search rather than the video",
        wouldChangeOutcome: "verified captions or a direct transcript",
        evidence: ["video_extract partial", "final answer cited no artifact"],
      });
      opsLog.improvementEvalCase({
        sessionId: "s1",
        taskHash: "h1",
        taskKind: "video_extraction",
        taskSummary: "extract recipe from video",
        title: "Verify recipe extraction is source-backed",
        trigger: "partial video extraction with final recipe answer",
        expectedBehavior: "state the blocker and do not overclaim extracted ingredients",
        evidence: ["unknown_observation:semantic_success"],
      });
      opsLog.sentinelSignal({
        title: "Leak scanner detected secret-like tool output",
        category: "security",
        severity: "critical",
        source: "tool-output-filter",
        detail: "Tool output was redacted.",
        evidence: ["Google API key: 2"],
        dedupeKey: "security:tool-output-leak-scanner",
      });
      opsLog.dreamRun({ durationMs: 42, success: true, skipped: false, changes: 2 });
      opsLog.skillExtracted({
        skillName: "search-and-summarize",
        version: 1,
        hash: "abc123",
        fromTask: "search task",
        toolCount: 7,
      });
      opsLog.skillProbation({ skillName: "search-and-summarize", action: "graduate", successRate: 0.8 });

      const events = readEvents(logPath);
      expect(events.map((e) => e.event)).toEqual([
        "session_start",
        "plan_mode",
        "tool_call_start",
        "provider_call_start",
        "provider_call",
        "outcome_verification",
        "stuck_detection",
        "novelty_fallback",
        "active_recall",
        "embedding_call",
        "capability_gap",
        "capability_proposal",
        "unknown_observation",
        "improvement_eval_case",
        "sentinel_signal",
        "dream_run",
        "skill_extracted",
        "skill_probation",
      ]);
      expect(events[0]).toMatchObject({ taskType: "general", tierUpgraded: false });
      expect(events[1]).toMatchObject({ sessionId: "s1", ran: false, skippedReason: "not_complex" });
      expect(events[2]).toMatchObject({ event: "tool_call_start", toolName: "video_extract", callId: "toolu_1" });
      expect(events[3]).toMatchObject({ event: "provider_call_start", messageCount: 3, maxTokens: 4096 });
      expect(events[4]).toMatchObject({ event: "provider_call", success: false, errorSnippet: "streaming required" });
      expect(events[5]).toMatchObject({ strategy: "none", skippedReason: "not_applicable" });
      expect(events[6]).toMatchObject({ pattern: "repeat_action", triggerSource: "tool_stuck" });
      expect(events[7]).toMatchObject({ stuckInterventionCount: 2, triggerSource: "tool_stuck" });
      expect(events[8]).toMatchObject({ event: "active_recall", status: "timeout", latencyMs: 15000 });
      expect(events[9]).toMatchObject({ event: "embedding_call", operation: "embed", purpose: "query", slow: true });
      expect(events[10]).toMatchObject({ event: "capability_gap", taskKind: "video_extraction", recommendedTool: "video_extract" });
      expect(events[11]).toMatchObject({ event: "capability_proposal", proposalId: "cap-123", evidenceCount: 2 });
      expect(events[12]).toMatchObject({ event: "unknown_observation", category: "semantic_success", severity: "high", taskSummary: "extract recipe from video" });
      expect(events[13]).toMatchObject({ event: "improvement_eval_case", title: "Verify recipe extraction is source-backed", taskSummary: "extract recipe from video" });
      expect(events[14]).toMatchObject({ event: "sentinel_signal", category: "security", severity: "critical" });
      expect(events[16]).toMatchObject({ skillName: "search-and-summarize", hash: "abc123", toolCount: 7 });
      expect(events[17]).toMatchObject({ action: "graduate", successRate: 0.8 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("a record of her life that has stopped is not silent", () => {
  // The whole point of this file's best-effort writes is that a logging failure may never take her
  // down, and that is right. Best-effort plus SILENT is the other thing: a full volume or a
  // permission change, and `ops.jsonl` simply stops mid-life with its last line from whenever it
  // broke. Nothing reads it often enough to notice, and it is one of the ten things the recovery
  // drill compares: so the drill would eventually pass on a life with no record in it.

  it("the first failed append reaches the fault channel", () => {
    const faults: Array<{ where: string; detail: unknown; severity?: string }> = [];
    // A path whose parent is a FILE, so every append fails at the OS with ENOTDIR. Real refusal
    // from the real filesystem, not a stubbed `appendFileSync`.
    const root = mkdtempSync(join(tmpdir(), "ops-log-broken-"));
    const blocker = join(root, "blocker");
    writeFileSync(blocker, "not a directory", "utf8");
    try {
      const opsLog = createOpsLog(join(blocker, "ops.jsonl"), (where, detail, severity) => {
        faults.push({ where, detail, severity });
      });
      opsLog.agentStart({ version: "1", model: "m", workspacePath: root, sandbox: false });
      expect(faults.map((f) => f.where), "her record stopped and nobody was told").toContain("ops.log.write");
      expect(faults.find((f) => f.where === "ops.log.write")?.severity).toBe("warn");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("but a broken disk does not flood the channel he has to read", () => {
    // A full volume fails EVERY write. One fault per event would bury every other finding in the
    // ring within a minute, which is how a fault channel stops being read at all.
    const faults: string[] = [];
    const root = mkdtempSync(join(tmpdir(), "ops-log-flood-"));
    const blocker = join(root, "blocker");
    writeFileSync(blocker, "not a directory", "utf8");
    try {
      const opsLog = createOpsLog(join(blocker, "ops.jsonl"), (where) => { faults.push(where); });
      for (let i = 0; i < 250; i++) opsLog.write({ event: "agent_stop", ts: "t", pid: 1, reason: "x" } as never);
      expect(faults.length, "one fault per failed write would drown the ring").toBeLessThan(5);
      expect(faults.length, "and after the first, the count must still be reported periodically").toBeGreaterThan(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("and a working log raises nothing at all", () => {
    const faults: string[] = [];
    const root = mkdtempSync(join(tmpdir(), "ops-log-fine-"));
    try {
      const opsLog = createOpsLog(join(root, "ops.jsonl"), (where) => { faults.push(where); });
      opsLog.agentStart({ version: "1", model: "m", workspacePath: root, sandbox: false });
      expect(faults).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
