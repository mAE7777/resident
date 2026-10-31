// Agent loop types: AgentEvent, AgentResult, AgentRunSpec, ToolResult.
// The generator-based loop yields AgentEvent and returns AgentResult.

import type {
  LLMProvider,
  Message,
  ToolDefinition,
  LLMUsage,
} from "../providers/types.js";
import type { BudgetEnvelope } from "../providers/budget-cascade.js";
import type { StuckDetector } from "./stuck.js";
import type { Watchdog } from "./watchdog.js";
import type { DuplicateTracker } from "./duplicate.js";
import type { HookRegistry } from "./hooks.js";
import type { TaskProfile } from "./effort-scaling.js";
import type { OutcomeVerifier } from "./outcome-verifier.js";

// ── Events ────────────────────────────────────────────────────────────────────

export interface TextChunkEvent {
  type: "text_chunk";
  content: string;
}

export interface ThinkingChunkEvent {
  type: "thinking_chunk";
  content: string;
}

export interface ToolStartEvent {
  type: "tool_start";
  tool: string;
  args: unknown;
  callId: string;
  /** When true, the bridge should NOT finalize the current message (keeps streaming continuous). */
  silent?: boolean;
}

export interface ToolEndEvent {
  type: "tool_end";
  tool: string;
  result: string;
  callId: string;
}

export interface ProgressEvent {
  type: "progress";
  message: string;
  _retry_wait?: true;
}

export interface CompactionEvent {
  type: "compaction";
  summary: string;
}

export interface ErrorEvent {
  type: "error";
  error: Error;
}

export type AgentEvent =
  | TextChunkEvent
  | ThinkingChunkEvent
  | ToolStartEvent
  | ToolEndEvent
  | ProgressEvent
  | CompactionEvent
  | ErrorEvent;

// ── Result ────────────────────────────────────────────────────────────────────

export type FinishReason =
  | "stop"          // LLM returned text with no tools
  | "max_iterations" // iteration safety cap reached
  | "interrupted"   // user sent a new message, graceful stop
  | "error";        // unrecoverable error

export interface AgentResult {
  content: string;
  /**
   * The reply as the model wrote it, BEFORE the shaping hook (S-4). The speech instrument
   * measures this, never `content`: measured-after-scissors would certify the scissors.
   * Absent on paths that never shape (equal to `content` in meaning).
   */
  rawContent?: string;
  /**
   * How many BEATS the reply was actually delivered in, when it went through `inBeats`.
   *
   * Absent on every path that composes one utterance in one generation, and that absence is the
   * honest reading rather than a default of 1, the landing measurement falls back to counting
   * sentences only when nobody counted beats, and records which of the two it used.
   *
   * It lives here, on the turn's own outcome, rather than in a per-turn side channel: it is a fact
   * about what this turn produced, and it has to travel with the rest of what it produced or the
   * measurement reads it a turn late.
   */
  beatsDelivered?: number;
  /**
   * The beats AFTER the first, each as its own string.
   *
   * `content` holds them concatenated, which is right for history and for her memory of the turn.
   * This holds them apart, which is right for anything that must judge an utterance: her own-voice
   * gate reads the FIRST beat's pre-scissors text (`rawContent`, deliberately not extended), so
   * admitting the whole concatenated turn on that sample let later beats in on the strength of a
   * shape that did not include them. A beat is a thing she said; it is judged as one.
   */
  laterBeats?: string[];
  usage: LLMUsage;
  iterations: number;
  finishReason: FinishReason;
}

// ── Recall result ─────────────────────────────────────────────────────────────


// ── Tool execution ────────────────────────────────────────────────────────────

export interface ToolResult {
  callId: string;
  name: string;
  content: string;
  isError?: boolean;
  audience?: "llm" | "user" | "silent";
  outputKind?: "text" | "file" | "artifact" | "media" | "message" | "state" | "diagnostic";
  artifactPaths?: string[];
  authGate?: boolean;
  retryable?: boolean;
  responseHandled?: boolean;
  verificationHints?: string[];
}

// ── Run spec ──────────────────────────────────────────────────────────────────

export interface AgentRunSpec {
  /** Provider (or composed provider chain) to call. */
  provider: LLMProvider;
  /** Conversation messages to start from (mutated by the loop). */
  messages: Message[];
  /** System prompt (string or cached content blocks for Anthropic prompt caching). */
  system?: string | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  /** Available tools. */
  tools?: ToolDefinition[];
  /** Maximum loop iterations (default 25). */
  maxIterations?: number;
  /** Session identifier for tracing. */
  sessionId?: string;
  /** Model identifier passed to the provider. */
  model: string;
  /** Maximum output tokens for provider calls. Defaults to the loop's conservative fallback. */
  maxTokens?: number;
  /**
   * Sampling temperature for this run's provider calls, when her state sets one (S-3,
   * saying.ts). Absent = the provider's default, which is every non-conversational turn: a
   * work turn's argument formatting must never inherit the warmth of her speech.
   */
  temperature?: number;
  /**
   * Boundary operation on the finished reply (S-4, register-scissors.ts), applied once in the
   * loop's private window before the single text yield. May delete whole sentences from the
   * edges or split at existing boundaries; may never rewrite inside one. Absent = delivered
   * text is the raw model text.
   */
  shapeReply?: (text: string) => string;
  /** Called to execute a batch of tool calls. Returns one ToolResult per call. */
  executeTools?: (calls: Array<{ callId: string; name: string; args: unknown }>, options?: { signal?: AbortSignal }) => Promise<ToolResult[]>;
  /** Called to compress context when context_overflow is detected. Returns the compressed messages. */
  compress?: (messages: Message[]) => Promise<{ messages: Message[]; summary: string }>;
  /** Called before each LLM call to govern (repair/trim) message history. */
  govern?: (messages: Message[]) => Message[];
  /** Called before tool execution to persist turn state for crash recovery. */
  onCheckpoint?: (state: {
    messages: Message[];
    pendingCalls: Array<{ callId: string; name: string; args: unknown }>;
    completedResults?: ToolResult[];
  }) => void;
  /**
   * Optional consolidator, when provided, the loop checks shouldConsolidate()
   * before each LLM call (after govern) and runs run() to compress context when
   * the threshold is met.
   */
  consolidator?: {
    shouldConsolidate(messages: Message[], lastConsolidated: number): boolean;
    run(messages: Message[]): Promise<{ messages: Message[]; summary: string }>;
  };
  /** Optional budget envelope forwarded from parent agent via fork(). */
  budgetEnvelope?: BudgetEnvelope;
  /** Optional stuck detector, injects intervention messages when the loop appears stuck. */
  stuckDetector?: StuckDetector;
  /** Optional watchdog, enforces time-based limits (warn at 30 min, force_stop at 35 min). */
  watchdog?: Watchdog;
  /** Optional duplicate tracker, detects consecutive identical failing tool batches. */
  duplicateTracker?: DuplicateTracker;
  /** Optional hook registry, fires lifecycle hooks at before_llm, after_llm, before_tool, after_tool. */
  hooks?: HookRegistry;
  /** Optional classifier domain for task-scoped guardrails and verification behavior. */
  taskType?: string;
  /** Optional richer classifier profile for mixed-domain and fragile-task routing. */
  taskProfile?: TaskProfile;
  /** Optional controller-resolved task text, used when a short reply continues a prior task. */
  taskDescription?: string;
  /** Optional outcome verifier, deterministic post-task checks before verifier fallback. */
  outcomeVerification?: OutcomeVerifier;
  /**
   * A verification shortfall is something that HAPPENED TO HER, not a grade.
   *
   * The check itself is the machinery checking ITSELF, did the file actually appear, did the
   * fetch actually produce bytes, and that is worth keeping: noticing that the thing you did
   * did not work is care, not servility. What was the tool frame is the verdict landing on HER
   * as a performance score. This hook lets the daemon put the same event into her life the way
   * a wall firing already goes there, so what she makes of it is hers.
   */
  onOutcomeShortfall?: (detail: { confidence: number; strategy: string }) => void;
  /** gap 5 bump bell: the step budget hit its urgent line. Observation only, nothing changes. */
  onBudgetPressure?: (iteration: number, maxIterations: number) => void;
  /** Optional ops logger, records plan mode, outcome verification, stuck detection, novelty fallback events. */
  opsLog?: import("../utils/ops-log.js").OpsLog;
  /** Returns fresh tool definitions, called each iteration so mid-loop tool registration (connect_mcp) is visible. */
  refreshTools?: () => ToolDefinition[];
  /** Called after each tool execution with the result, used for skill outcome tracking and repair. */
  onToolResult?: (result: { name: string; args: unknown; content: string; success: boolean }) => void;
  /** Optional durable store for large tool outputs that would otherwise be truncated from model context. */
  persistLargeToolResult?: (result: ToolResult) => Promise<string | null> | string | null;
  /** Her home, so a receipt that names the act can name the place from it (`whatHerHandDid`). */
  herHome?: string;
  /** Optional skill extractor, creates reusable skills from successful trajectories (5+ tool calls, all success). */
  /** Optional abort signal, checked at the start of each iteration. When aborted,
   *  the loop finishes the current iteration gracefully and returns "interrupted". */
  abortSignal?: AbortSignal;
}
