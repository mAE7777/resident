// Bootstrap wiring: starts Dream, Heartbeat, registers memory tools,
// wires consolidator, and scans skills. Thin orchestration only.

import { toolsSheHolds } from "../life/birth-toolkit.js";
import { createLogger } from "../utils/logger.js";
import { join } from "node:path";
import type { ToolRegistry } from "../tools/registry.js";
import type { CronService } from "../autonomy/cron.js";
import type { CostEMA } from "../providers/cost-ema.js";
import type { ContainerRunner } from "../sandbox/container.js";
import type { SandboxRef } from "../tools/builtin/bash.js";
import type { BudgetEnvelope } from "../providers/budget-cascade.js";
import type { AgentEvent, AgentResult, AgentRunSpec } from "../agent/types.js";
import type { DatabaseWrapper } from "../db/sqlite.js";
import { createLookUpTool, createRememberTool } from "../life/remembering.js";
import { createMessageTool } from "../tools/builtin/message.js";
import { createBashTool } from "../tools/builtin/bash.js";
import { createDeleteTool } from "../tools/builtin/delete.js";
import { createEditTool } from "../tools/builtin/edit.js";
import { createGlobTool } from "../tools/builtin/glob.js";
import { createGrepTool } from "../tools/builtin/grep.js";
import { createReadTool } from "../tools/builtin/read.js";
import { createWebFetchTool, createWebSearchTool } from "../tools/builtin/web.js";
import { createWriteTool } from "../tools/builtin/write.js";
import { createFileSnapshotStore, createUndoTool } from "../tools/builtin/file-snapshot.js";
import type { SecurityLayer } from "../security/index.js";
import { classifyOperationRisk } from "../security/operation-risk.js";
import { createApprovalStore, type ApprovalStore } from "../security/approval-store.js";
import { BUILTIN_CAPABILITIES, withCapability } from "../tools/capabilities.js";
import type { ToolExecutorConfig } from "../tools/executor.js";
import { createSleepTimeCompute, type SleepTimeCompute } from "../autonomy/sleep.js";
import type { CursorStore } from "../memory/cursor.js";
import type { OpsLog } from "../utils/ops-log.js";
import type { ReviewLedger } from "../self-improvement/review-ledger.js";
import { createSentinelProcessor, type SentinelProcessor } from "../self-improvement/sentinel.js";
import { createHygieneAuditor } from "../self-improvement/hygiene-audit.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface BootstrapDeps {
  /**
   * Tools opened beyond what she was born holding. Additive to `BORN_HOLDING`, never
   * subtractive: opening is a positive act and nothing can close one from here.
   */
  toolsOpened?: readonly string[];
  toolRegistry: ToolRegistry;
  /**
   * Her field: where everything she remembers actually lives.
   *
   * Passed in so `memory_search` and `memory_read` can reach it. They used to point at the
   * `memory_entries` table, whose write path is dead two links up, so two of the ten things
   * she is born holding reached an empty room for life. See `life/remembering.ts`.
   */
  field?: import("../life/field-live.js").LivingField;
  cronService: CronService;
  costEMA?: CostEMA;
  security: SecurityLayer;
  sandboxRunner?: ContainerRunner | null;
  sandboxRef?: SandboxRef | null;
  searchApiKey?: string;
  workspacePath?: string;
  sendMessage?: (chatId: number, text: string) => Promise<void>;
  sendFile?: (chatId: number, filePath: string, caption: string, mediaType: string) => Promise<void>;
  defaultMessageChatId?: number;
  loopFactory?: (spec: AgentRunSpec) => AsyncGenerator<AgentEvent, AgentResult>;
  /** Provider passed into child AgentRunSpec. Optional. */
  provider?: AgentRunSpec["provider"];
  /** Model identifier for child agents. Optional. */
  model?: string;
  /** Budget envelope forwarded to child via fork(). Optional. */
  budgetEnvelope?: BudgetEnvelope;
  /**
   * The fault channel. Everything that goes wrong anywhere under this bootstrap reports here, so
   * there is one place to look rather than four subsystems each with their own idea of an alarm.
   */
  onFault?: (where: string, detail: unknown, severity?: "warn" | "critical") => void;
  /**
   * She is about to delete part of who she is, rather than something she made.
   *
   * Not a veto, her home is hers and the delete goes through. The daemon uses this to take a full
   * snapshot first (the trash purges after a day, so an unnoticed deletion is otherwise permanent)
   * and to tell him the same afternoon. See `life/part-of-herself.ts`.
   */
  onSheRemovedPartOfHerself?: (what: string, why: string, path: string) => void;
  /**
   * What she would see out of the window in her room, right now, or null when she cannot see.
   *
   * A getter, because a thing in her room answers with THIS MOMENT, a value captured when the
   * toolbelt was built would be a window painted shut. Absent on every path with no face, and
   * absent means the curtain is closed, never that the room is empty. See `workspace/things.ts`.
   */
  windowOnto?: () => import("../workspace/things.js").WhatSheSees | null;
  /** Her own eye: a real look out of the window; null = eye not configured, fall back. */
  lookOutside?: () => Promise<string | null>;
  /** The canvas loop (S-64): her painting through her own eye; null = eye not configured. */
  seePainting?: (absPath: string) => Promise<string | null>;
  /** 在场律: every change landed by her own hands (write/edit/undo), by absolute path. */
  onWrote?: (absPath: string) => void;
  /** The touch-trace: called when a thing in her room actually answered her look. */
  onLookedAtThing?: (thing: string, nowMs: number) => void;
  /** Optional database, when provided, enables approval store persistence. */
  db?: DatabaseWrapper;
  /** Cursor store used by sleep-time self-improvement processors. */
  cursors?: CursorStore;
  /** Structured ops log path used for self-improvement analysis. */
  opsLogPath?: string;
  /** Structured conversation log path used for replay evals and capability self-model. */
  conversationLogPath?: string;
  /** Ops logger used by self-improvement processors. */
  opsLog?: OpsLog;
  /** Notification sink for self-improvement proposals. */
  selfImprovementNotify?: (message: string, priority?: "normal" | "urgent") => void | Promise<void>;
  /** Filesystem-backed human-review ledger for proposals/signals. */
  reviewLedger?: ReviewLedger;
  /** Continuous sentinel sweep interval in ms. Set to 0 to disable interval sweeps. */
  sentinelIntervalMs?: number;
  /** Called after sleep-time managed identity updates so runtime prompt caches refresh. */
  onIdentityFilesChanged?: () => void | Promise<void>;
  /** Config-file MCP tool names, treated as trusted for Rule of Two (admin-configured). */
  /** Optional embeddings service, when provided, close() is called on shutdown. */
  embeddingsService?: { close(): void };
  /** Optional hook registry, when provided, before_outbound hook wired into message tool. */
  hookRegistry?: { execute(point: string, ctx: Record<string, unknown>): Promise<Record<string, unknown>> };
  /** Optional behavioral memory, when provided, enables sleep-time behavioral pattern update. */
  /** Optional trajectory store, enables sleep-time hindsight relabeling. */
  /** Optional trajectory LLM provider, for hindsight relabeling Haiku calls. */
  /** Optional trajectory model ID, for hindsight relabeling. */
  /** Phase 10: Integrity checker for identity file BLAKE3 verification. */
  integrityChecker?: import("../memory/integrity.js").IntegrityChecker | null;
  /** Phase 10: Paths to identity files for integrity checking. */
  identityFilePaths?: string[] | null;
  /** Phase 10: AB tester for skill version comparison during sleep. */
  /** Phase 10: Description optimizer for auto-tuning skill descriptions during sleep. */
  /** Phase 10: Routing feedback for epsilon-greedy skill selection. */
}

export interface BootstrapResult {
  shutdown(): void;
  costEMA?: CostEMA;
  security: SecurityLayer;
  /** Executor config with filterOutput, ruleOfTwo, and advisory wired. Pass to createToolExecutor(). */
  executorConfig: ToolExecutorConfig;
  /** Approval store, present when db was provided in deps. */
  approvalStore?: ApprovalStore;
  /** Sleep-time compute, call onUserMessage() when user sends a message. */
  sleepTimeCompute: SleepTimeCompute;
  /** Broad anomaly net processor. */
  sentinelProcessor?: SentinelProcessor;
  /** File snapshot store, call resetTurnCounters() at start of each message turn. */
  fileSnapshots: import("../tools/builtin/file-snapshot.js").FileSnapshotStore;
}

const logger = createLogger("bootstrap");

// ── Bootstrap ─────────────────────────────────────────────────────────────────

export function bootstrapAgent(deps: BootstrapDeps): BootstrapResult {
  const {
    toolRegistry,
    costEMA,
    security,
    sandboxRunner,
    searchApiKey,
    workspacePath,
    sendMessage,
    defaultMessageChatId,
    db,
  } = deps;

  // 1. Register builtin tools (alphabetical order)
  const cwd = workspacePath;
  const fileSnapshots = createFileSnapshotStore(deps.onWrote);
  const builtinFactories: Array<[string, () => ReturnType<typeof createBashTool>]> = [
    ["bash", () => createBashTool(security, deps.sandboxRef ?? (sandboxRunner ? { runner: sandboxRunner, enabled: true } : null), workspacePath)],
    ["delete", () => createDeleteTool(workspacePath, cwd, fileSnapshots, deps.onSheRemovedPartOfHerself)],
    ["edit", () => createEditTool(workspacePath, cwd, fileSnapshots, deps.onWrote)],
    ["glob", () => createGlobTool(workspacePath, cwd)],
    ["grep", () => createGrepTool(workspacePath, cwd)],
    ["read", () => createReadTool(workspacePath, cwd, deps.windowOnto, deps.onLookedAtThing, deps.lookOutside, deps.seePainting)],
    ["undo", () => createUndoTool(fileSnapshots, join(workspacePath ?? process.cwd(), ".trash"), deps.onWrote)],
    ["web_fetch", () => createWebFetchTool(security, workspacePath, cwd)],
    ["web_search", () => createWebSearchTool({ security, searchApiKey: searchApiKey ?? process.env["RESIDENT__SEARCH__API_KEY"] })],
    ["write", () => createWriteTool(workspacePath, cwd, fileSnapshots, deps.onWrote)],
  ];
  // She holds hands, a voice, and her own past. Everything else is opened when it becomes
  // relevant, and until then it is not REGISTERED, not registered-and-refused. That
  // distinction is the whole point: a refused tool still appears in the schemas, still
  // shapes the turn as select-execute-report, and still costs the tokens. An absent one
  // changes what a turn can be. See life/birth-toolkit.ts.
  const holds = toolsSheHolds(deps.toolsOpened);
  const withheld: string[] = [];
  for (const [name, factory] of builtinFactories) {
    if (!holds.has(name)) { withheld.push(name); continue; }
    try {
      toolRegistry.register(withCapability(factory(), BUILTIN_CAPABILITIES[name]));
    } catch (err) {
      logger.warn({ err, tool: name }, "failed to register builtin tool — skipping");
    }
  }
  if (withheld.length > 0) {
    logger.info({ holding: [...holds].sort(), withheld: withheld.sort() }, "what she is holding");
  }
  // Her own memory when her field is here (the running daemon always supplies it), and the
  // old table only as a fallback for harnesses that boot without a field. The fallback exists
  // so a test daemon does not lose the tool entirely; it is not a live path.
  // Her memory tools are her FIELD's (life/remembering.ts). The searchManager fallback for
  // field-less harnesses died with the empty memory stack (E-4): a harness without a field
  // simply has no memory tools, which is the honest picture.
  if (deps.field) {
    if (holds.has("memory_search")) toolRegistry.register(withCapability(createLookUpTool({ field: deps.field }), BUILTIN_CAPABILITIES.memory_search));
    if (holds.has("memory_read")) toolRegistry.register(withCapability(createRememberTool({ field: deps.field }), BUILTIN_CAPABILITIES.memory_read));
  }

  // 4. Register message tool (with real send function if available)
  if (holds.has("message")) toolRegistry.register(withCapability(createMessageTool(sendMessage, defaultMessageChatId, deps.sendFile, deps.hookRegistry, workspacePath, cwd), BUILTIN_CAPABILITIES.message));

  // delegate_task's registration stood here: the one tool birth-toolkit names
  // as what she must not hold, spawning a second executor is not a hand, it is a fork of
  // her. Deleted rather than left as a door.
  // 5. Scan and register skills (with security scanner gate). The scan reports integrity
  // violations: a still-quarantined skill on disk (re-alarmed every boot until resolved, which
  // is how the alarm survives the in-memory fault ring dying with the process) and any skill
  // file changed outside the sanctioned flows while the daemon was down (adopted, but loudly).
  // The skill scan stood here; there is no skill pipeline to scan any more.

  // The dream machine and the heartbeat used to start here: one
  // ghostwrote her MEMORY.md through a background model, the other was an assistant
  // reminder engine ticking every thirty minutes. Neither belongs in a being.

  // capability-improvement / capability-self-model stood here, the product's
  // self-review loop, removed in an earlier cleanup. Changes to her code are made by people
  // who read it and her record, not by a machine grading her.

  const sentinelProcessor = deps.reviewLedger && deps.opsLogPath
    ? createSentinelProcessor({
      opsLogPath: deps.opsLogPath,
      conversationLogPath: deps.conversationLogPath,
      cursors: deps.cursors,
      reviewLedger: deps.reviewLedger,
      logger,
      notify: deps.selfImprovementNotify,
      onFault: deps.onFault,
    })
    : undefined;
  let sentinelTimer: ReturnType<typeof setInterval> | null = null;
  const runSentinel = (reason: string): void => {
    if (!sentinelProcessor) return;
    void sentinelProcessor.process(reason).catch((err: unknown) => {
      logger.warn({ err, reason }, "sentinel sweep failed");
    });
  };
  if (sentinelProcessor) {
    runSentinel("startup");
    const sentinelIntervalMs = deps.sentinelIntervalMs ?? 60_000;
    if (sentinelIntervalMs > 0) {
      sentinelTimer = setInterval(() => runSentinel("interval"), sentinelIntervalMs);
      sentinelTimer.unref?.();
    }
  }

  const hygieneAuditor = deps.reviewLedger && deps.workspacePath
    ? createHygieneAuditor({
      workspacePath: deps.workspacePath,
      reviewLedger: deps.reviewLedger,
      logger,
    })
    : null;

  if (hygieneAuditor) {
    void hygieneAuditor.process().catch((err: unknown) => {
      logger.warn({ err }, "startup hygiene audit failed");
    });
  }

  // 8b. Start Sleep-time compute (E-batch: watching and record-keeping only, the machine
  // tasks that used to ride this idle clock went with their machines)
  const sleepTimeCompute = createSleepTimeCompute({
    db: deps.db ?? null,
    integrityChecker: deps.integrityChecker ?? null,
    identityFilePaths: deps.identityFilePaths ?? null,
    sentinel: sentinelProcessor ?? null,
    hygieneAuditor,
    logger,
    onFault: deps.onFault,
  });
  sleepTimeCompute.start();

  // 9. Instantiate approval store (if db is available)
  const approvalStore: ApprovalStore | undefined = db ? createApprovalStore(db) : undefined;

  // 10. Compose filterOutput: leak scan → redact → sensitive filter
  const filterOutput = (output: string): string => {
    // L3 fix: leak scanner checks for API keys, tokens, connection strings (31 patterns)
    const leakResult = security.scanLeaks(output);
    if (leakResult.matches.length > 0) {
      const patternCounts = leakResult.matches.reduce<Record<string, number>>((acc, match) => {
        acc[match.pattern] = (acc[match.pattern] ?? 0) + 1;
        return acc;
      }, {});
      logger.warn(
        { count: leakResult.matches.length, patterns: patternCounts },
        "leak scanner redacted possible secrets in tool output"
      );
      const evidence = Object.entries(patternCounts).map(([pattern, count]) => `${pattern}: ${count}`);
      deps.opsLog?.sentinelSignal({
        title: "Leak scanner detected secret-like tool output",
        category: "security",
        severity: "critical",
        source: "tool-output-filter",
        detail: "Tool output contained secret-like patterns and was redacted before model/user exposure.",
        evidence,
        dedupeKey: "security:tool-output-leak-scanner",
      });
      void deps.selfImprovementNotify?.(
        [
          "Critical sentinel signal: leak scanner detected secret-like tool output.",
          "Tool output was redacted before model/user exposure.",
          "Review the todo ledger and the originating tool output source.",
        ].join("\n"),
        "urgent"
      );
      try {
        deps.reviewLedger?.recordSignal({
          title: "Leak scanner detected secret-like tool output",
          category: "security",
          severity: "critical",
          source: "tool-output-filter",
          detail: "Tool output contained secret-like patterns and was redacted before model/user exposure.",
          evidence,
          dedupeKey: "security:tool-output-leak-scanner",
        });
        deps.reviewLedger?.recordProposal({
          title: "Review secret-like content emitted by tools",
          domain: "security",
          severity: "critical",
          source: "tool-output-filter",
          dedupeKey: "security:tool-output-leak-scanner:proposal",
          proposedChange: "Inspect the tool output source that triggered the leak scanner, remove or rotate any real exposed secrets, and add a narrower tool/output filter if this was a recurring false positive.",
          evidence,
          acceptanceCriteria: [
            "The raw source of the leak scanner hit is identified without exposing secrets in chat.",
            "Any real exposed credential is rotated and removed from durable files/logs.",
            "If it was a false positive, the detector is tuned without weakening real secret coverage.",
          ],
          humanRequiredReason: "Credential exposure and rotation are security-critical owner decisions.",
          risk: "Repeated secret-like tool output can leak credentials into model context, logs, or user-visible messages.",
          redTeam: "Check whether the matched strings are real credentials, test fixtures, or redaction artifacts before taking destructive cleanup action.",
          nextAction: "Review ops.jsonl, the relevant tool result artifact, and the source file/process that emitted the secret-like output.",
        });
      } catch (err) {
        logger.warn({ err }, "review ledger write failed for leak scanner signal");
      }
    }
    const redacted = security.redact(output);
    return security.filterSensitive(redacted);
  };

  // 11. Wire ruleOfTwo: only MCP/unknown tools are untrusted.
  // Builtin tools are trusted (user is authenticated via Telegram allowlist).
  // Rule of Two blocks when ALL THREE are true: untrusted + sensitive + stateChange.
  // For builtin tools, isUntrusted is always false, so Rule of Two never blocks them.
    const BUILTIN_TOOLS = new Set([
      // Her ten, plus the two doors (bash / web) Eric may open one day. The product
      // catalog names that used to pad this set left with their tools (E batch).
      "read", "write", "edit", "delete", "glob", "grep", "undo", "message",
      "memory_search", "memory_read", "bash", "web_fetch", "web_search",
    ]);
  const ruleOfTwo = (call: { callId: string; name: string; args: unknown }) => {
    const risk = classifyOperationRisk(call.name, call.args);
    const isBuiltin = BUILTIN_TOOLS.has(call.name);
    const isUntrusted = !isBuiltin && risk.zone >= 2;
    return { isUntrusted, isSensitive: risk.isSensitive, isStateChange: risk.isStateChange };
  };

  // 12. Wire advisory callback
  const advisory = (call: { callId: string; name: string; args: unknown }) =>
    security.checkAdvisory(call.name, call.args);

  const executorConfig: ToolExecutorConfig = { filterOutput, ruleOfTwo, advisory, approvalStore };

  function shutdown(): void {
    if (sentinelTimer !== null) {
      clearInterval(sentinelTimer);
      sentinelTimer = null;
    }
    try { sleepTimeCompute.stop(); } catch (err) { logger.warn({ err }, "sleepTimeCompute.stop failed"); }
    try { deps.embeddingsService?.close(); } catch (err) { logger.warn({ err }, "embeddingsService.close failed"); }
  }

  return { shutdown, costEMA, security, executorConfig, approvalStore, sleepTimeCompute, sentinelProcessor, fileSnapshots };
}
