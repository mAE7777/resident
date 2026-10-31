// ops-log.ts, Structured operational event log.
// Appends JSON lines to {workspacePath}/ops.jsonl for every significant
// agent operation: startup, session turns, tool calls, errors.
//
// Format: one JSON object per line, always includes { event, ts } fields.
// Never throws: all writes are best-effort and fail silently.

import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { currentBeat } from "./beat.js";

// ── Event types ────────────────────────────────────────────────────────────

export interface OpsEventBase {
  event: string;
  ts: string;           // ISO timestamp
  pid: number;
  /** Which beat of her life this happened in (`utils/beat.ts`), stamped centrally in `write`. */
  beat?: string;
}

export interface AgentStartEvent extends OpsEventBase {
  event: "agent_start";
  version: string;
  model: string;
  workspacePath: string;
  sandbox: boolean;
}

export interface SessionStartEvent extends OpsEventBase {
  event: "session_start";
  chatId: number;
  model: string;
  effortTier: string;
  taskType: string;         // classified domain (code, research, web, etc.)
  tierUpgraded?: boolean;   // true if context-aware upgrade from simple → medium
  messagePreview: string;   // first 80 chars of user message
}

export interface SessionEndEvent extends OpsEventBase {
  event: "session_end";
  chatId: number;
  model: string;
  finishReason: string;
  iterations: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface ToolCallEvent extends OpsEventBase {
  event: "tool_call";
  toolName: string;
  success: boolean;
  durationMs: number;
  errorSnippet?: string;    // first 120 chars of error if failed
}

export interface ToolCallStartEvent extends OpsEventBase {
  event: "tool_call_start";
  toolName: string;
  callId?: string;
}

export interface ProviderCallEvent extends OpsEventBase {
  event: "provider_call";
  sessionId?: string;
  taskHash?: string;
  model: string;
  iteration: number;
  messageCount: number;
  toolCount: number;
  maxTokens: number;
  success: boolean;
  durationMs: number;
  stopReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  errorSnippet?: string;
}

export interface ProviderCallStartEvent extends OpsEventBase {
  event: "provider_call_start";
  sessionId?: string;
  taskHash?: string;
  model: string;
  iteration: number;
  messageCount: number;
  toolCount: number;
  maxTokens: number;
}

export interface AgentErrorEvent extends OpsEventBase {
  event: "agent_error";
  chatId?: number;
  errorMessage: string;
  context?: string;
}

export interface SleptEvent extends OpsEventBase {
  event: "slept";
  /** Roughly how long the machine (and so she) was suspended. */
  sleptMs: number;
}

export interface CronFireEvent extends OpsEventBase {
  event: "cron_fire";
  jobId: string;
  jobName: string;
}

export interface DreamRunEvent extends OpsEventBase {
  event: "dream_run";
  durationMs: number;
  success: boolean;
  skipped?: boolean;
  changes?: number;
  reason?: string;
}

export interface SkillExtractedEvent extends OpsEventBase {
  event: "skill_extracted";
  skillName: string;
  version: number;
  hash: string;
  fromTask: string;
  toolCount: number;
}

export interface SkillProbationEvent extends OpsEventBase {
  event: "skill_probation";
  skillName: string;
  action: "start" | "graduate" | "quarantine";
  successRate?: number;
}

export interface PlanModeEvent extends OpsEventBase {
  event: "plan_mode";
  sessionId?: string;
  taskHash?: string;
  ran: boolean;
  iterations?: number;
  planLength?: number;      // chars of plan text
  skippedReason?: string;   // "not_complex" | "aborted" | "failed" | "empty_plan"
}

export interface OutcomeVerificationEvent extends OpsEventBase {
  event: "outcome_verification";
  sessionId?: string;
  taskHash?: string;
  strategy: string;         // code, file, research, api, calculation, fallback, none
  confidence: number;
  reenter: boolean;
  skippedReason?: string;   // "not_applicable" | "reentry_limit" | "failed"
  details?: string[];
}

export interface StuckDetectionEvent extends OpsEventBase {
  event: "stuck_detection";
  sessionId?: string;
  taskHash?: string;
  pattern: string;          // repeat_action, repeat_error, monologue, etc.
  interventionCount: number;
  noveltyFallbackInjected: boolean;
  triggerSource: string;    // "text_stuck" | "tool_stuck" | "compaction_stuck" | "plan_zero_critical_files"
}

export interface NoveltyFallbackEvent extends OpsEventBase {
  event: "novelty_fallback";
  sessionId?: string;
  taskHash?: string;
  stuckInterventionCount: number;
  triggerSource: string;    // "text_stuck" | "tool_stuck" | "compaction_stuck" | "plan_zero_critical_files"
}

export interface ActiveRecallEvent extends OpsEventBase {
  event: "active_recall";
  sessionId?: string;
  taskHash?: string;
  status: string;           // hit | miss | timeout | error | skipped | disabled
  entries?: number;
  latencyMs?: number;
  fromCache?: boolean;
}

export interface EmbeddingCallEvent extends OpsEventBase {
  event: "embedding_call";
  operation: "embed" | "embed_batch";
  purpose: string;
  model: string;
  inputCount: number;
  durationMs: number;
  success: boolean;
  dimensions?: number;
  slow?: boolean;
  errorSnippet?: string;
}

export interface CapabilityGapEvent extends OpsEventBase {
  event: "capability_gap";
  sessionId?: string;
  taskHash?: string;
  taskKind?: string;
  outcome?: "success" | "failure" | "max_iterations";
  severity?: "low" | "medium" | "high" | "critical";
  reason: string;
  toolSequence: string[];
  recommendedTool?: string;
  iterations?: number;
  toolCalls?: number;
}

export interface CapabilityProposalEvent extends OpsEventBase {
  event: "capability_proposal";
  proposalId: string;
  signature: string;
  proposalType: string;
  title: string;
  evidenceCount: number;
}

export interface UnknownObservationEvent extends OpsEventBase {
  event: "unknown_observation";
  sessionId?: string;
  taskHash?: string;
  taskKind?: string;
  taskSummary?: string;
  category:
    | "tool_usability"
    | "semantic_success"
    | "composite_workflow"
    | "fallback_shift"
    | "user_satisfaction"
    | "memory_validity"
    | "self_improvement_effect"
    | "resource_freshness"
    | "resource_cost"
    | "security_boundary";
  severity: "low" | "medium" | "high" | "critical";
  assumption: string;
  uncertainty: string;
  wouldChangeOutcome: string;
  evidence: string[];
}

export interface ImprovementEvalCaseEvent extends OpsEventBase {
  event: "improvement_eval_case";
  sessionId?: string;
  taskHash?: string;
  taskKind?: string;
  taskSummary?: string;
  title: string;
  trigger: string;
  expectedBehavior: string;
  evidence: string[];
}

export interface SentinelSignalEvent extends OpsEventBase {
  event: "sentinel_signal";
  signalId?: string;
  title: string;
  category: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  source: string;
  detail: string;
  evidence?: string[];
  dedupeKey?: string;
  sessionId?: string;
  taskHash?: string;
}

export type OpsEvent =
  | AgentStartEvent
  | SessionStartEvent
  | SessionEndEvent
  | ToolCallStartEvent
  | ToolCallEvent
  | ProviderCallStartEvent
  | ProviderCallEvent
  | AgentErrorEvent
  | SleptEvent
  | CronFireEvent
  | DreamRunEvent
  | SkillExtractedEvent
  | SkillProbationEvent
  | PlanModeEvent
  | OutcomeVerificationEvent
  | StuckDetectionEvent
  | NoveltyFallbackEvent
  | ActiveRecallEvent
  | EmbeddingCallEvent
  | CapabilityGapEvent
  | CapabilityProposalEvent
  | UnknownObservationEvent
  | ImprovementEvalCaseEvent
  | SentinelSignalEvent;

// ── OpsLog interface ────────────────────────────────────────────────────────

export interface OpsLog {
  write(event: OpsEvent): void;
  agentStart(opts: Omit<AgentStartEvent, "event" | "ts" | "pid">): void;
  sessionStart(opts: Omit<SessionStartEvent, "event" | "ts" | "pid">): void;
  sessionEnd(opts: Omit<SessionEndEvent, "event" | "ts" | "pid">): void;
  toolCallStart(opts: Omit<ToolCallStartEvent, "event" | "ts" | "pid">): void;
  toolCall(opts: Omit<ToolCallEvent, "event" | "ts" | "pid">): void;
  providerCallStart(opts: Omit<ProviderCallStartEvent, "event" | "ts" | "pid">): void;
  providerCall(opts: Omit<ProviderCallEvent, "event" | "ts" | "pid">): void;
  agentError(opts: Omit<AgentErrorEvent, "event" | "ts" | "pid">): void;
  slept(opts: Omit<SleptEvent, "event" | "ts" | "pid">): void;
  cronFire(opts: Omit<CronFireEvent, "event" | "ts" | "pid">): void;
  dreamRun(opts: Omit<DreamRunEvent, "event" | "ts" | "pid">): void;
  skillExtracted(opts: Omit<SkillExtractedEvent, "event" | "ts" | "pid">): void;
  skillProbation(opts: Omit<SkillProbationEvent, "event" | "ts" | "pid">): void;
  planMode(opts: Omit<PlanModeEvent, "event" | "ts" | "pid">): void;
  outcomeVerification(opts: Omit<OutcomeVerificationEvent, "event" | "ts" | "pid">): void;
  stuckDetection(opts: Omit<StuckDetectionEvent, "event" | "ts" | "pid">): void;
  noveltyFallback(opts: Omit<NoveltyFallbackEvent, "event" | "ts" | "pid">): void;
  activeRecall(opts: Omit<ActiveRecallEvent, "event" | "ts" | "pid">): void;
  embeddingCall(opts: Omit<EmbeddingCallEvent, "event" | "ts" | "pid">): void;
  capabilityGap(opts: Omit<CapabilityGapEvent, "event" | "ts" | "pid">): void;
  capabilityProposal(opts: Omit<CapabilityProposalEvent, "event" | "ts" | "pid">): void;
  unknownObservation(opts: Omit<UnknownObservationEvent, "event" | "ts" | "pid">): void;
  improvementEvalCase(opts: Omit<ImprovementEvalCaseEvent, "event" | "ts" | "pid">): void;
  sentinelSignal(opts: Omit<SentinelSignalEvent, "event" | "ts" | "pid">): void;
}

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Her raw record of her own life, one line per event.
 *
 * `onFault` is what makes a broken record audible. Every write here is best-effort by design and
 * must stay that way (a logging failure may never take her down), but best-effort plus SILENT is
 * how the record simply stops: a full volume, a permission change, a home moved out from under her,
 * and the file goes on existing with a last line from whenever it broke. Nothing else in the system
 * reads this file often enough to notice, and it is one of the four things the recovery drill
 * compares, so a silent stop means the drill would one day pass on a life with no record in it.
 *
 * Reported once at the first failure, then every 100th, because a full disk fails every write and
 * a fault channel that gets flooded is a fault channel he stops reading.
 */
export function createOpsLog(
  logPath: string,
  onFault?: (where: string, detail: unknown, severity?: "info" | "warn" | "critical") => void,
): OpsLog {
  // Ensure parent directory exists
  try {
    const dir = dirname(logPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  } catch (err) {
    onFault?.("ops.log.dir", err, "warn");
  }

  let writeFailures = 0;

  function write(event: OpsEvent): void {
    try {
      // The beat is stamped HERE, in the one place every event passes through, rather than at
      // each emit site: a correlation key that call sites must remember to attach is a key that
      // is missing exactly where it is needed most.
      if (event.beat === undefined) {
        const beat = currentBeat()?.id;
        if (beat !== undefined) event.beat = beat;
      }
      appendFileSync(logPath, JSON.stringify(event) + "\n", "utf8");
    } catch (err) {
      // Never crash the agent over logging, but never lose the fact that it stopped either.
      writeFailures += 1;
      if (writeFailures === 1 || writeFailures % 100 === 0) {
        onFault?.("ops.log.write", `${describeWriteFailure(err)} (${writeFailures} failed so far)`, "warn");
      }
    }
  }

  function describeWriteFailure(err: unknown): string {
    return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }

  function base(): Pick<OpsEventBase, "ts" | "pid"> {
    return { ts: new Date().toISOString(), pid: process.pid };
  }

  return {
    write,

    agentStart(opts) {
      write({ event: "agent_start", ...base(), ...opts });
    },

    sessionStart(opts) {
      write({ event: "session_start", ...base(), ...opts });
    },

    sessionEnd(opts) {
      write({ event: "session_end", ...base(), ...opts });
    },

    toolCallStart(opts) {
      write({ event: "tool_call_start", ...base(), ...opts });
    },

    toolCall(opts) {
      write({ event: "tool_call", ...base(), ...opts });
    },

    providerCallStart(opts) {
      write({ event: "provider_call_start", ...base(), ...opts });
    },

    providerCall(opts) {
      write({ event: "provider_call", ...base(), ...opts });
    },

    agentError(opts) {
      write({ event: "agent_error", ...base(), ...opts });
    },

    slept(opts) {
      write({ event: "slept", ...base(), ...opts });
    },
    cronFire(opts) {
      write({ event: "cron_fire", ...base(), ...opts });
    },

    dreamRun(opts) {
      write({ event: "dream_run", ...base(), ...opts });
    },

    skillExtracted(opts) {
      write({ event: "skill_extracted", ...base(), ...opts });
    },

    skillProbation(opts) {
      write({ event: "skill_probation", ...base(), ...opts });
    },

    planMode(opts) {
      write({ event: "plan_mode", ...base(), ...opts });
    },

    outcomeVerification(opts) {
      write({ event: "outcome_verification", ...base(), ...opts });
    },

    stuckDetection(opts) {
      write({ event: "stuck_detection", ...base(), ...opts });
    },

    noveltyFallback(opts) {
      write({ event: "novelty_fallback", ...base(), ...opts });
    },

    activeRecall(opts) {
      write({ event: "active_recall", ...base(), ...opts });
    },

    embeddingCall(opts) {
      write({ event: "embedding_call", ...base(), ...opts });
    },

    capabilityGap(opts) {
      write({ event: "capability_gap", ...base(), ...opts });
    },

    capabilityProposal(opts) {
      write({ event: "capability_proposal", ...base(), ...opts });
    },

    unknownObservation(opts) {
      write({ event: "unknown_observation", ...base(), ...opts });
    },

    improvementEvalCase(opts) {
      write({ event: "improvement_eval_case", ...base(), ...opts });
    },

    sentinelSignal(opts) {
      write({ event: "sentinel_signal", ...base(), ...opts });
    },
  };
}
