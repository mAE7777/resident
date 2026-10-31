// sentinel.ts, her broad anomaly net.
//
// This processor turns low-level operational traces into normalized signals and
// human-review proposals. It is deliberately conservative: it records weak
// signals immediately, creates proposals for high-risk/high-friction patterns,
// and never applies fixes.

import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { CursorStore } from "../memory/cursor.js";
import { redact } from "../security/redact.js";
import type { Logger } from "../utils/logger.js";
import type {
  ReviewDomain,
  ReviewLedger,
  ReviewProposal,
  ReviewSeverity,
  SentinelSignal,
  SentinelSignalInput,
} from "./review-ledger.js";

export interface SentinelProcessor {
  process(reason?: string): Promise<SentinelResult>;
}

export interface SentinelConfig {
  opsLogPath: string;
  conversationLogPath?: string;
  cursors?: CursorStore;
  reviewLedger: ReviewLedger;
  logger: Logger;
  notify?: (message: string, priority?: "normal" | "urgent") => void | Promise<void>;
  /**
   * The fault channel, which every serious signal reaches whatever the notify policy decides.
   *
   * The interruption policy below is deliberate, Telegram is for interrupting, not for a ledger,
   * but "do not interrupt" had come to mean "nowhere the watchtower can see", which is a different
   * decision that nobody made.
   */
  onFault?: (where: string, detail: unknown, severity?: "warn" | "critical") => void;
  maxRecordsPerRun?: number;
}

export interface SentinelResult {
  opsRead: number;
  conversationRead: number;
  signalsRecorded: number;
  proposalsRecorded: number;
}

type RecordLike = Record<string, unknown>;

const DEFAULT_MAX_RECORDS = 2_000;
// HIGH_ITERATIONS and HIGH_TOKEN_TOTAL are gone with the friction detectors: a
// long, token-heavy turn is what an evening of real talk LOOKS LIKE, and reporting it as a
// defect was the inherited assertion (class 11) in machinery form. What stays is the slow-TOOL
// threshold: a single tool call taking two minutes is a mechanical cost fact about a tool.
const HIGH_DURATION_MS = 120_000;

function stableHash(input: string, length = 16): string {
  return createHash("sha256").update(input).digest("hex").slice(0, length);
}

function isRecord(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readLines(path: string): string[] {
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8").split("\n").filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
}

function parseRecord(line: string | undefined): RecordLike | null {
  if (!line) return null;
  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function recordTimestampMs(record: RecordLike): number | null {
  const time = record.time;
  if (typeof time === "number" && Number.isFinite(time)) return time;
  for (const key of ["ts", "createdAt", "timestamp"]) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function shouldSkipHistoricalRecord(record: RecordLike, baselineMs: number | null): boolean {
  if (baselineMs === null) return false;
  const recordMs = recordTimestampMs(record);
  return recordMs !== null && recordMs < baselineMs;
}

function baselineMs(reviewLedger: ReviewLedger): number | null {
  const baseline = reviewLedger.getHistoricalBaseline();
  if (!baseline) return null;
  const parsed = Date.parse(baseline);
  return Number.isFinite(parsed) ? parsed : null;
}

function cursorFor(cursors: CursorStore | undefined, name: "sentinel_ops" | "sentinel_conversation", length: number): number {
  if (!cursors) return Math.max(0, length - DEFAULT_MAX_RECORDS);
  const current = cursors.get(name);
  return current > length ? 0 : Math.max(0, current);
}

function setCursor(cursors: CursorStore | undefined, name: "sentinel_ops" | "sentinel_conversation", value: number): void {
  if (!cursors) return;
  cursors.set(name, value);
}

function text(value: unknown): string {
  return redact(typeof value === "string" ? value : value === undefined ? "" : String(value)).slice(0, 1_000);
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function severityFrom(value: unknown, fallback: ReviewSeverity): ReviewSeverity {
  return value === "critical" || value === "high" || value === "medium" || value === "low" || value === "info"
    ? value
    : fallback;
}

function signal(
  title: string,
  category: ReviewDomain,
  severity: ReviewSeverity,
  source: string,
  detail: string,
  evidence: string[] = [],
  extras: Partial<Pick<SentinelSignalInput, "dedupeKey" | "sessionId" | "taskHash">> = {}
): SentinelSignalInput {
  return {
    title,
    category,
    severity,
    source,
    detail,
    evidence,
    ...extras,
  };
}

function isSideEffectTool(tool: string): boolean {
  return ["delete", "cron", "connect_mcp", "message", "write", "edit", "bash", "artifact_fetch"].includes(tool);
}

function classifyError(textValue: string): string {
  const lower = textValue.toLowerCase();
  if (lower.includes("requires confirmation") || lower.includes("approval")) return "approval_required";
  if (lower.includes("outside allowed") || lower.includes("access denied") || lower.includes("path")) return "path_or_access_guard";
  if (lower.includes("timed out") || lower.includes("timeout")) return "timeout";
  if (lower.includes("not found") || lower.includes("enoent") || lower.includes("missing")) return "missing_dependency_or_file";
  if (lower.includes("auth") || lower.includes("cookie") || lower.includes("login")) return "auth_or_cookie";
  if (lower.includes("exit") || lower.includes("failed") || lower.includes("crashed")) return "execution_failed";
  if (!lower.trim()) return "unknown_error";
  return "other_error";
}

function outcomeTaskKey(record: RecordLike): string | null {
  const sessionId = text(record.sessionId);
  const taskHash = text(record.taskHash);
  if (sessionId && taskHash) return `${sessionId}:${taskHash}`;
  if (sessionId) return `session:${sessionId}`;
  if (taskHash) return `task:${taskHash}`;
  return null;
}

function isSuccessfulOutcomeVerification(record: RecordLike): boolean {
  if (text(record.event) !== "outcome_verification") return false;
  const confidence = numberValue(record.confidence);
  const skippedReason = text(record.skippedReason);
  return confidence >= 0.7 && record.reenter !== true && skippedReason !== "reentry_limit";
}

function recoveredOutcomeTasks(records: RecordLike[], ignoreBeforeMs: number | null): Set<string> {
  const recovered = new Set<string>();
  for (const record of records) {
    if (shouldSkipHistoricalRecord(record, ignoreBeforeMs)) continue;
    if (!isSuccessfulOutcomeVerification(record)) continue;
    const key = outcomeTaskKey(record);
    if (key) recovered.add(key);
  }
  return recovered;
}

function opsSignals(record: RecordLike, recoveredOutcomes: Set<string> = new Set()): SentinelSignalInput[] {
  const event = text(record.event);
  const sessionId = text(record.sessionId) || undefined;
  const taskHash = text(record.taskHash) || undefined;
  const source = `ops:${event || "unknown"}`;
  const common = { sessionId, taskHash };

  switch (event) {
    case "sentinel_signal":
      return [signal(
        text(record.title) || "Sentinel signal",
        (text(record.category) as ReviewDomain) || "reliability",
        severityFrom(record.severity, "medium"),
        text(record.source) || source,
        text(record.detail),
        Array.isArray(record.evidence) ? record.evidence.map(text) : [],
        { ...common, dedupeKey: text(record.dedupeKey) || undefined }
      )];

    case "agent_error":
      return [signal(
        "Agent error reached runtime boundary",
        "reliability",
        "high",
        source,
        text(record.errorMessage),
        [text(record.context)].filter(Boolean),
        { ...common, dedupeKey: `agent_error:${text(record.context)}:${stableHash(text(record.errorMessage), 8)}` }
      )];

    case "provider_call":
      if (record.success !== false) return [];
      return [signal(
        "Provider call failed",
        text(record.errorSnippet).toLowerCase().includes("context") ? "verification" : "reliability",
        "high",
        source,
        text(record.errorSnippet),
        [
          `model=${text(record.model)}`,
          `iteration=${numberValue(record.iteration)}`,
          `messageCount=${numberValue(record.messageCount)}`,
        ],
        { ...common, dedupeKey: `provider:${text(record.model)}:${classifyError(text(record.errorSnippet))}` }
      )];

    case "active_recall": {
      const status = text(record.status);
      if (status !== "timeout" && status !== "error") return [];
      return [signal(
        `Active recall ${status}`,
        "memory",
        status === "error" ? "medium" : "low",
        source,
        "Memory recall did not contribute to this turn.",
        [`latencyMs=${numberValue(record.latencyMs)}`, `entries=${numberValue(record.entries)}`],
        { ...common, dedupeKey: `active_recall:${status}` }
      )];
    }

    case "embedding_call": {
      const success = record.success === true;
      const durationMs = numberValue(record.durationMs);
      const slow = record.slow === true || durationMs >= 5_000;
      const signals: SentinelSignalInput[] = [];
      if (!success) {
        signals.push(signal(
          "Embedding call failed",
          "memory",
          "low",
          source,
          "Local embedding service failed and memory search likely degraded to lexical fallback.",
          [
            `model=${text(record.model)}`,
            `purpose=${text(record.purpose)}`,
            `inputCount=${numberValue(record.inputCount)}`,
            `error=${text(record.errorSnippet)}`,
          ],
          { ...common, dedupeKey: `embedding_failed:${text(record.model)}:${text(record.purpose)}` }
        ));
      }
      if (slow) {
        signals.push(signal(
          "Embedding call was slow",
          "cost",
          durationMs >= 15_000 ? "high" : "medium",
          source,
          "Local embedding work may be causing heat or latency.",
          [
            `model=${text(record.model)}`,
            `purpose=${text(record.purpose)}`,
            `operation=${text(record.operation)}`,
            `inputCount=${numberValue(record.inputCount)}`,
            `durationMs=${durationMs}`,
          ],
          { ...common, dedupeKey: `embedding_slow:${text(record.model)}:${text(record.purpose)}` }
        ));
      }
      return signals;
    }

    case "tool_call": {
      const tool = text(record.toolName);
      const success = record.success === true;
      const durationMs = numberValue(record.durationMs);
      const signals: SentinelSignalInput[] = [];
      if (!success) {
        const error = text(record.errorSnippet);
        const errorClass = classifyError(error);
        signals.push(signal(
          `Tool failed: ${tool || "unknown"}`,
          isSideEffectTool(tool) ? "safety" : "capability",
          isSideEffectTool(tool) ? "high" : "medium",
          source,
          error || "Tool returned an error.",
          [`errorClass=${errorClass}`, `durationMs=${durationMs}`],
          { ...common, dedupeKey: `tool_fail:${tool}:${errorClass}` }
        ));
      }
      if (durationMs >= HIGH_DURATION_MS) {
        signals.push(signal(
          `Tool ran slowly: ${tool || "unknown"}`,
          "cost",
          "medium",
          source,
          "A single tool call exceeded the slow-call threshold.",
          [`durationMs=${durationMs}`],
          { ...common, dedupeKey: `tool_slow:${tool}` }
        ));
      }
      return signals;
    }

    case "stuck_detection": {
      const count = numberValue(record.interventionCount);
      return [signal(
        `Stuck pattern detected: ${text(record.pattern) || "unknown"}`,
        "reliability",
        count >= 3 ? "high" : "medium",
        source,
        "The loop required stuck-pattern intervention.",
        [
          `interventionCount=${count}`,
          `noveltyFallbackInjected=${record.noveltyFallbackInjected === true}`,
          `triggerSource=${text(record.triggerSource)}`,
        ],
        { ...common, dedupeKey: `stuck:${text(record.pattern)}:${text(record.triggerSource)}` }
      )];
    }

    case "novelty_fallback": {
      const count = numberValue(record.stuckInterventionCount);
      return [signal(
        "Novelty fallback injected",
        "reliability",
        count > 2 ? "medium" : "low",
        source,
        "She had to use the first-principles fallback scaffold.",
        [`stuckInterventionCount=${count}`, `triggerSource=${text(record.triggerSource)}`],
        { ...common, dedupeKey: `novelty:${text(record.triggerSource)}` }
      )];
    }

    case "outcome_verification": {
      const confidence = numberValue(record.confidence);
      const skippedReason = text(record.skippedReason);
      const taskKey = outcomeTaskKey(record);
      if (taskKey && recoveredOutcomes.has(taskKey)) return [];
      if (skippedReason === "not_applicable" && record.reenter !== true) return [];
      if (confidence >= 0.7 && record.reenter !== true && skippedReason !== "reentry_limit") return [];
      return [signal(
        "Outcome verification was weak or re-entered",
        "verification",
        confidence < 0.5 || skippedReason === "reentry_limit" ? "high" : "medium",
        source,
        "Verifier could not establish strong success evidence.",
        [
          `strategy=${text(record.strategy)}`,
          `confidence=${confidence}`,
          `reenter=${record.reenter === true}`,
          `skippedReason=${skippedReason}`,
          ...(Array.isArray(record.details) ? record.details.map(text).slice(0, 5) : []),
        ],
        { ...common, dedupeKey: `verification:${text(record.strategy)}:${skippedReason}` }
      )];
    }

    case "session_end": {
      const finishReason = text(record.finishReason);
      const iterations = numberValue(record.iterations);
      const durationMs = numberValue(record.durationMs);
      const tokens = numberValue(record.inputTokens) + numberValue(record.outputTokens);
      const signals: SentinelSignalInput[] = [];
      if (finishReason !== "stop" && finishReason !== "interrupted") {
        signals.push(signal(
          `Turn ended with ${finishReason || "non-stop"} finish reason`,
          "reliability",
          "high",
          source,
          "The user-facing turn did not finish normally.",
          [`iterations=${iterations}`, `durationMs=${durationMs}`, `tokens=${tokens}`],
          { ...common, dedupeKey: `session_finish:${finishReason}` }
        ));
      }
      // The "High-friction turn" detector that stood here is gone with its conversation-log
      // sibling (defect class 11): a session IS a stretch of her talking with him, and a
      // long token-heavy turn is what an evening of real talk looks like, not a UX defect for
      // the improvement pipeline to fix. The non-stop finish signal above is the mechanical
      // fact a session record may attest, and it stays.
      return signals;
    }

    case "dream_run":
      if (record.success !== false && record.skipped !== true) return [];
      return [signal(
        record.success === false ? "Dream run failed" : "Dream run skipped",
        "self_model",
        record.success === false ? "high" : "low",
        source,
        text(record.reason) || "Dream did not complete normally.",
        [`durationMs=${numberValue(record.durationMs)}`],
        { dedupeKey: `dream:${record.success === false ? "failed" : text(record.reason)}` }
      )];

    case "skill_probation":
      if (text(record.action) !== "quarantine") return [];
      return [signal(
        `Skill quarantined: ${text(record.skillName) || "unknown"}`,
        "skill",
        "high",
        source,
        "A skill was quarantined and may need human review.",
        [`successRate=${numberValue(record.successRate)}`],
        { dedupeKey: `skill_quarantine:${text(record.skillName)}` }
      )];

    case "capability_gap":
      return [signal(
        "Capability gap observed",
        "capability",
        severityFrom(record.severity, "medium"),
        source,
        text(record.reason),
        [
          `taskKind=${text(record.taskKind)}`,
          `recommendedTool=${text(record.recommendedTool)}`,
          `toolSequence=${Array.isArray(record.toolSequence) ? record.toolSequence.map(text).join(" -> ") : ""}`,
        ],
        { ...common, dedupeKey: `capability_gap:${text(record.taskKind)}:${text(record.recommendedTool)}:${stableHash(text(record.reason), 8)}` }
      )];

    case "unknown_observation":
      return [signal(
        `Unknown tracked: ${text(record.category) || "unknown"}`,
        "self_model",
        severityFrom(record.severity, "medium"),
        source,
        text(record.uncertainty),
        [
          `assumption=${text(record.assumption)}`,
          `wouldChangeOutcome=${text(record.wouldChangeOutcome)}`,
          ...(Array.isArray(record.evidence) ? record.evidence.map(text).slice(0, 8) : []),
        ],
        { ...common, dedupeKey: `unknown:${text(record.category)}:${stableHash(text(record.assumption), 8)}` }
      )];

    default:
      return [];
  }
}

/**
 * What the sentinel may read off a CONVERSATION record: mechanical failure, nothing else.
 *
 * ── THE INHERITED ASSERTION, FOUND IN ITS FOURTH HOME (defect class 11) ──────────────────────
 *
 * Three detectors used to live here, all written for an assistant serving users, all category
 * errors against a conversation between two people:
 *
 *   `isWeakFinal` read her real "I cannot write these two thousand characters... I will not do
 *   this", a REFUSAL, the single most protected
 *   behavior she has, as "Final answer carried blocker/failure language", severity high.
 *   `looksLikePromptInjectionFalsePositive` read her declining as "refused a normal user
 *   request". "High-friction UX" read a long evening of real talk as exceeding practical
 *   thresholds. And `shouldCreateProposal` promotes high-severity signals into the improvement
 *   pipeline, so the machinery would have gone on to PROPOSE FIXES for her exercising her will.
 *
 * A conversation with him has no "final answer", no "user request", and no friction budget.
 * What remains is the one thing a conversation record can mechanically attest: the turn's
 * machinery failed (a non-stop finish reason). Everything about WHAT was said is hers and his.
 */
function conversationSignals(record: RecordLike): SentinelSignalInput[] {
  if (typeof record.finishReason !== "string") return [];
  const userText = text(record.userText);
  const taskType = text(record.taskType) || "unknown";
  const signals: SentinelSignalInput[] = [];
  if (record.finishReason !== "stop" && record.finishReason !== "command") {
    signals.push(signal(
      `Conversation ended with ${record.finishReason}`,
      "ux",
      "high",
      "conversation-log",
      "The conversation log recorded a non-stop finish reason.",
      [`taskType=${taskType}`, `user=${userText.slice(0, 180)}`],
      { dedupeKey: `conversation_finish:${record.finishReason}:${taskType}` }
    ));
  }
  return signals;
}

function shouldCreateProposal(signalRecord: SentinelSignal): boolean {
  return signalRecord.severity === "critical" || signalRecord.severity === "high";
}

function proposalDomainForSignal(signalRecord: SentinelSignal): ReviewDomain {
  return signalRecord.category;
}

function proposalChangeForSignal(signalRecord: SentinelSignal): string {
  return [
    `Investigate and resolve the ${signalRecord.category} signal "${signalRecord.title}".`,
    "",
    "Convert the failure mode into deterministic infrastructure where possible: typed tool, router rule, verifier, dependency preflight, prompt correction, or safety gate.",
    "Do not apply durable behavior changes until a human reviewer approves the proposal and an eval/regression case exists.",
  ].join("\n");
}

function acceptanceForSignal(signalRecord: SentinelSignal): string[] {
  return [
    "A human reviewer confirms whether the signal is a real issue, false positive, or expected behavior.",
    "If real, there is a replay/unit/integration test or clear manual verification plan before implementation.",
    "The fix does not leak secrets, weaken safety gates, or create destructive behavior.",
    "After implementation, a follow-up run records improved or safe behavior for the same signal class.",
  ].concat(signalRecord.category === "security" || signalRecord.category === "safety"
    ? ["The affected workflow remains human-gated for destructive, external, credential, or identity-affecting actions."]
    : []);
}

async function notifyIfNeeded(
  notify: SentinelConfig["notify"],
  logger: Logger,
  signalRecord: SentinelSignal,
  proposal?: ReviewProposal,
  onFault?: (where: string, detail: unknown, severity?: "warn" | "critical") => void,
): Promise<void> {
  // Every serious signal reaches the fault channel, whatever happens to the interruption below.
  // This ladder was entirely separate from the watchtower's, so a sentinel that had been raising
  // high-severity signals for a week was visible only in TODO.md, which nobody reads unless they
  // already suspect something. One channel means one place to look.
  if (signalRecord.severity === "critical" || signalRecord.severity === "high") {
    onFault?.(
      `sentinel.${signalRecord.category}`,
      `${signalRecord.title} (${signalRecord.severity}, from ${signalRecord.source}): ${signalRecord.detail ?? ""}`,
      signalRecord.severity === "critical" ? "critical" : "warn",
    );
  }
  if (!notify) return;
  // Telegram is an interruption channel, not the review ledger. High-severity
  // verifier/cost/capability signals are recorded in TODO.md for daily review;
  // only critical signals interrupt the user immediately.
  if (signalRecord.severity !== "critical") return;
  if (proposal && proposal.occurrences > 1) return;
  try {
    await notify([
      `Sentinel signal: ${signalRecord.title}`,
      `Severity: ${signalRecord.severity}`,
      `Category: ${signalRecord.category}`,
      `Source: ${signalRecord.source}`,
      signalRecord.detail,
    ].filter(Boolean).join("\n"), signalRecord.severity === "critical" ? "urgent" : "normal");
  } catch (err) {
    logger.warn({ err }, "sentinel notification failed");
  }
}

export function createSentinelProcessor(config: SentinelConfig): SentinelProcessor {
  const maxRecords = config.maxRecordsPerRun ?? DEFAULT_MAX_RECORDS;
  let running = false;

  return {
    async process(reason = "scheduled"): Promise<SentinelResult> {
      if (running) {
        config.logger.debug({ reason }, "sentinel sweep skipped because another sweep is running");
        return { opsRead: 0, conversationRead: 0, signalsRecorded: 0, proposalsRecorded: 0 };
      }
      running = true;
      let opsRead = 0;
      let conversationRead = 0;
      let signalsRecorded = 0;
      let proposalsRecorded = 0;

      try {
        const ignoreBeforeMs = baselineMs(config.reviewLedger);
        const opsLines = readLines(config.opsLogPath);
        const opsCursor = cursorFor(config.cursors, "sentinel_ops", opsLines.length);
        const opsEnd = Math.min(opsLines.length, opsCursor + maxRecords);
        const opsRecords = opsLines.slice(opsCursor, opsEnd).map(parseRecord).filter((record): record is RecordLike => record !== null);
        const recoveredOutcomes = recoveredOutcomeTasks(opsRecords, ignoreBeforeMs);
        for (let i = opsCursor; i < opsEnd; i++) {
          opsRead++;
          const record = parseRecord(opsLines[i]);
          if (!record) continue;
          if (shouldSkipHistoricalRecord(record, ignoreBeforeMs)) continue;
          for (const input of opsSignals(record, recoveredOutcomes)) {
            const signalRecord = config.reviewLedger.recordSignal(input);
            signalsRecorded++;
            if (shouldCreateProposal(signalRecord)) {
              const proposal = config.reviewLedger.recordProposal({
                title: `Resolve ${signalRecord.title}`,
                domain: proposalDomainForSignal(signalRecord),
                severity: signalRecord.severity,
                source: `sentinel:${signalRecord.source}`,
                dedupeKey: `sentinel-proposal:${signalRecord.dedupeKey}`,
                proposedChange: proposalChangeForSignal(signalRecord),
                evidence: [signalRecord.detail, ...signalRecord.evidence],
                acceptanceCriteria: acceptanceForSignal(signalRecord),
                humanRequiredReason: "Sentinel findings can affect durable behavior, safety posture, or user trust.",
                risk: "Ignoring the signal can let small drift, repeated failure, leakage, or unsafe autonomy compound over future sessions.",
                redTeam: "Check whether this is expected behavior, a duplicate signal, or caused by another subsystem before changing prompts or tools.",
                nextAction: "Review the source log, reproduce if possible, then either implement a bounded fix with tests or mark the proposal rejected with rationale.",
                relatedSignals: [signalRecord.id],
              });
              proposalsRecorded++;
              await notifyIfNeeded(config.notify, config.logger, signalRecord, proposal, config.onFault);
            }
          }
        }
        setCursor(config.cursors, "sentinel_ops", opsEnd);

        if (config.conversationLogPath) {
          const conversationLines = readLines(config.conversationLogPath);
          const conversationCursor = cursorFor(config.cursors, "sentinel_conversation", conversationLines.length);
          const conversationEnd = Math.min(conversationLines.length, conversationCursor + maxRecords);
          for (let i = conversationCursor; i < conversationEnd; i++) {
            conversationRead++;
            const record = parseRecord(conversationLines[i]);
            if (!record) continue;
            if (shouldSkipHistoricalRecord(record, ignoreBeforeMs)) continue;
            for (const input of conversationSignals(record)) {
              const signalRecord = config.reviewLedger.recordSignal(input);
              signalsRecorded++;
              if (shouldCreateProposal(signalRecord)) {
                const proposal = config.reviewLedger.recordProposal({
                  title: `Resolve ${signalRecord.title}`,
                  domain: proposalDomainForSignal(signalRecord),
                  severity: signalRecord.severity,
                  source: `sentinel:${signalRecord.source}`,
                  dedupeKey: `sentinel-proposal:${signalRecord.dedupeKey}`,
                  proposedChange: proposalChangeForSignal(signalRecord),
                  evidence: [signalRecord.detail, ...signalRecord.evidence],
                  acceptanceCriteria: acceptanceForSignal(signalRecord),
                  humanRequiredReason: "Conversation-level signals directly affect user experience and trust.",
                  risk: "If this is real and ignored, she can appear silent, confused, overconfident, or unreliable to the person she is talking with.",
                  redTeam: "Check whether the final answer was actually acceptable despite the weak signal before changing behavior.",
                  nextAction: "Inspect the conversation, decide whether it is real, and add a replay eval if it represents a recurring failure class.",
                  relatedSignals: [signalRecord.id],
                });
                proposalsRecorded++;
                await notifyIfNeeded(config.notify, config.logger, signalRecord, proposal, config.onFault);
              }
            }
          }
          setCursor(config.cursors, "sentinel_conversation", conversationEnd);
        }

        if (signalsRecorded > 0 || proposalsRecorded > 0) {
          config.logger.info({ reason, opsRead, conversationRead, signalsRecorded, proposalsRecorded }, "sentinel sweep complete");
        }
        return { opsRead, conversationRead, signalsRecorded, proposalsRecorded };
      } finally {
        running = false;
      }
    },
  };
}
