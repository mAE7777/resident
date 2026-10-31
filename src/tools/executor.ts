// S-TOL-003: Streaming tool executor, parallel or sequential based on executionMode.
// If ANY tool in the batch declares "sequential", the entire batch serializes.
// Otherwise uses Promise.allSettled() for parallel execution.

import type { ToolResult } from "../agent/types.js";
import type { ToolRegistry } from "./registry.js";
import { classify, type OperationProperties } from "../security/rule-of-two.js";
import { classifyReversibility } from "../security/reversibility.js";
import type { AdvisoryResult } from "../security/advisory.js";
import { checkHomeBoundary, type HomeBoundaryConfig } from "../security/home-boundary.js";
import { createLogger } from "../utils/logger.js";
import { readWhatTheMachineSaid } from "../life/machine-voice.js";
import { inferToolResultMetadata } from "../agent/tool-result.js";

const logger = createLogger("executor");

export interface ToolExecutorConfig {
  /** Post-execution filter: scan for leaks, redact sensitive data. */
  filterOutput?: (output: string) => string;
  /** Optional Rule of Two pre-execution check. When provided, classify() runs before executeOne(). */
  ruleOfTwo?: (call: { callId: string; name: string; args: unknown }) => OperationProperties;
  /** Optional safety advisory check. Tier 1 blocks execution; Tier 2 warns but proceeds. */
  advisory?: (call: { callId: string; name: string; args: unknown }) => AdvisoryResult;
  /** Optional approval store for persisted user decisions. */
  approvalStore?: { check(toolName: string, input: string): "allow" | "deny" | null };
  /**
   * The Resident's home boundary. When set, an UNCONDITIONAL hard-block wall runs FIRST, before
   * the advisory and rule-of-two checks: privilege escalation, system/disk/daemon integrity,
   * security disabling, credential access, offensive network tooling, and writes/deletes outside
   * her home are refused unconditionally. This is the one limit nothing overrides, not an
   * approval, and not any other check.
   */
  homeBoundary?: HomeBoundaryConfig;
  /**
   * Every refusal, reported.
   *
   * Until this existed, a home-boundary hard block was a `logger.error` and nothing else: no fault,
   * no vital, no counter. All seven threat categories were invisible to the watchtower, so a
   * poisoned page probing credential-access over and over produced ZERO owner-visible signal. The
   * Rule-of-Two block and the stored-approval deny had no log at all.
   *
   * A wall that stops something and tells nobody is half a wall. This is the other half.
   */
  onGuardRefusal?: (event: GuardRefusal) => void;
}

/** One refusal by one guard, in a shape the fault channel and the watchtower can both count. */
export interface GuardRefusal {
  /** Which guard said no. Also the fault `where`, so it groups naturally. */
  guard: "home-boundary" | "advisory" | "rule-of-two" | "approval-denied" | "unknown-tool";
  tool: string;
  /** The threat family, where the guard names one (the home boundary always does). */
  category?: string;
  reason: string;
  /** Critical for the walls, because a wall firing is either an attack or a bug, never routine. */
  severity: "warn" | "critical";
}

export interface ToolExecutor {
  executeBatch(calls: Array<{ callId: string; name: string; args: unknown }>, options?: { signal?: AbortSignal }): Promise<ToolResult[]>;
}

export function createToolExecutor(registry: ToolRegistry, config?: ToolExecutorConfig): ToolExecutor {
  const filterOutput = config?.filterOutput;

  /**
   * A result the MACHINE wrote (a refusal, a block, a confirmation) rather than one a tool
   * returned, read back on construction. See `life/machine-voice.ts` for why: this text
   * arrives in his conversational slot at the moment she is deciding what to do, and until
   * the machine-voice scan was added, nothing had ever read a word of it.
   *
   * The discriminator is structural rather than clever, and `isError` is NOT it: autonomy
   * level 0 returns its confirmation demand with `isError: false`, and that is the worst
   * string in this file. What separates the two is WHO WROTE IT, which is exactly what
   * calling this function instead of a bare object literal records.
   */
  function machineSaid(call: { callId: string; name: string }, content: string, isError = true): ToolResult {
    for (const hit of readWhatTheMachineSaid(`tool:${call.name}`, content)) {
      logger.warn(
        { tool: call.name, word: hit.word, why: hit.why, line: hit.line },
        "a refusal told her something untrue about what she is"
      );
    }
    return { callId: call.callId, name: call.name, content, isError };
  }
  async function executeOne(call: { callId: string; name: string; args: unknown }, options?: { signal?: AbortSignal }): Promise<ToolResult> {
    try {
      if (options?.signal?.aborted) {
        return machineSaid(call, "这件事中途停下了。");
      }

      // The home boundary: the ONE limit nothing overrides. Runs BEFORE autonomy resolution, so
      // no level (including full-trust 3) and no stored approval can bypass it. Inside her home
      // she is free; this only stops actions that could harm the machine or cross a legal line.
      if (config?.homeBoundary) {
        const wall = checkHomeBoundary(call.name, call.args, config.homeBoundary);
        if (wall.blocked) {
          logger.error({ tool: call.name, category: wall.category, reason: wall.reason }, "home boundary hard-blocked an action");
          config.onGuardRefusal?.({
            guard: "home-boundary", tool: call.name, category: wall.category,
            reason: wall.reason, severity: "critical",
          });
          // The category is a machinery id and stays; the guard's own reason does not reach
          // her, on the same rule `walls.ts` states in full, her account of a wall is hers,
          // never the guard's account of it. The reason is in the log and in the fault, which
          // are his to read.
          return machineSaid(call, `这件事在我家以外，做不了。(${wall.category})`);
        }
      }

      // ── THE FOUR-LEVEL TRUST LADDER IS GONE ──────────────────────────────────────
      //
      // `AutonomyLevel` 0..3 was an inherited assistant-framework frame: a principal-deputy TRUST rating (how much
      // she is trusted to act on someone's behalf), earned by performance, dialling her freedom
      // to a fraction of three. She is not a deputy and has no principal; her autonomy is
      // emergent, not a setting; and freedom is TOTAL inside an absolute boundary, not a
      // quantity someone sets. Levels 1 and 2 were already byte-identical, level 3 merely turned
      // the safety checks OFF, and the only live effect was a per-tool/path "ask-first" valve at
      // level 0: itself a per-action permission that presumes she acts on his behalf.
      //
      // What genuinely limits her, and stays UNCONDITIONAL: the HOME BOUNDARY above (absolute,
      // first, nothing overrides it), the BIRTH TOOLKIT (which tools exist for her at all;
      // capabilities open when RELEVANT, never by earning trust), and the two ACTION-danger
      // checks below: each about a specific action being dangerous, never about her rating.
      if (config?.advisory) {
        const advisory = config.advisory(call);
        if (advisory.outcome === "HARD_BLOCK") {
          logger.warn({ tool: call.name, reason: advisory.reason }, "advisory hard-blocked tool execution");
          config.onGuardRefusal?.({
            guard: "advisory", tool: call.name, category: `tier${advisory.tier}`,
            reason: advisory.reason, severity: "critical",
          });
          return machineSaid(call, `${call.name} 这件事这样做不安全，停下了。`);
        }
        // Unconditional. This used to be `level < 3`, so setting the top of the ladder
        // silently stopped the advisory warning from being logged at all.
        if (advisory.outcome === "WARN") {
          logger.warn({ tool: call.name, reason: advisory.reason }, "advisory warning for tool execution");
        }
      }
      // Unconditional, and this is a strengthening rather than a tidy-up. It used to be
      // `level < 3`, so the top of the trust ladder DISABLED the check that stops untrusted
      // input plus sensitive access plus a persistent change happening together. A trust
      // level that switches off a safety check is not a trust level.
      if (config?.ruleOfTwo) {
        const props = config.ruleOfTwo(call);
        const isReversible = classifyReversibility(call.name, call.args);
        const result = classify({ ...props, isReversible });
        if (result.decision === "block") {
          // This had no log of any kind before, which made it the quietest wall in the system.
          logger.warn({ tool: call.name }, "rule-of-two blocked tool execution");
          config.onGuardRefusal?.({
            guard: "rule-of-two", tool: call.name,
            reason: "untrusted input + sensitive access + state change", severity: "critical",
          });
          // The three-way combination, said as what it is rather than as a rule id: something
          // from outside, something private, and a change that stays. Any two are fine.
          return machineSaid(call, `这一步同时碰到了三样东西：外面来的内容、私密的地方、以及一个改完就留下的改动。三样一起，不能做。`);
        }
        if (result.decision === "confirm") {
          // Only engage approval gate for UNTRUSTED tools (runtime MCP, etc.)
          // Builtin tools: isSensitive+isStateChange but trusted → just proceed
          if (props.isUntrusted && config?.approvalStore) {
            const prior = config.approvalStore.check(call.name, JSON.stringify(call.args));
            if (prior === "allow") {
              logger.info({ tool: call.name }, "rule-of-two: approved via stored approval");
            } else if (prior === "deny") {
              logger.warn({ tool: call.name }, "rule-of-two: blocked by a stored denial");
              config.onGuardRefusal?.({
                guard: "approval-denied", tool: call.name,
                reason: "previously denied by the owner", severity: "warn",
              });
              return machineSaid(call, `${call.name} 这件事以前问过，他说了不行。`);
            } else {
              // No stored decision: return confirmation request to the LLM
              logger.info({ tool: call.name }, "rule-of-two: requesting user confirmation");
              return machineSaid(call, `${call.name} 这件事，先问一声再动手。问完了可以再来一次。`, false);
            }
          } else {
            logger.info({ tool: call.name }, "rule-of-two: confirm decision — proceeding (trusted tool)");
          }
        }
      }
      const tool = registry.get(call.name);
      if (!tool) {
        logger.warn({ tool: call.name }, "unknown tool requested");
        config?.onGuardRefusal?.({
          guard: "unknown-tool", tool: call.name,
          reason: "no such tool is registered", severity: "warn",
        });
        // The one a newborn meets most, and `walls.ts` gives it the same words in her field:
        // she was born holding ten things, and reaching for an eleventh finds nothing there.
        return machineSaid(call, `我伸手去用 ${call.name}，那儿什么都没有。`);
      }
      let content = await tool.execute(call.args, options);
      // Tool result validation (Nanobot pattern): catch silent failures returning empty
      if (!content || content.trim() === "") {
        content = `${call.name} 什么也没返回。可能是真的没有，也可能是它出了问题没说。`;
      }
      // A RETURNED "Error: …" is machine-authored by construction, it is the centralized
      // tool-error convention, written by tool code, not fetched from anywhere. These used to
      // ride the success path unscanned, so the machine-voice counter sat at zero while a
      // returned refusal said "user" to her. Two bounds keep the scan honest:
      // FIRST LINE only, the convention's own sentence; everything after a
      // newline can be embedded program output, which is her world's bytes, not the machine's
      // words: and `bash` is excluded entirely, because its Error head embeds the failed
      // command line and the program's stderr ("Command failed: /bin/sh -c …"), and counting a
      // failing sqlite query's "tasks" as the machine saying "task" is a false alarm that
      // erodes the one counter this exists to feed.
      if (typeof content === "string" && call.name !== "bash" && /^Error:/.test(content)) {
        const firstLine = content.slice(0, content.indexOf("\n") === -1 ? 600 : Math.min(600, content.indexOf("\n")));
        // Property, not just the bash name: any first line carrying execFile's
        // interpolation signature ("Command failed: …" / "/bin/sh -c …") embeds the failed
        // command and program bytes: her world's text, not the machine's words. opencli_query's
        // catch has exactly bash's shape.
        const embedsForeignBytes = /Command failed:|\/bin\/sh -c/.test(firstLine);
        if (!embedsForeignBytes) {
          for (const hit of readWhatTheMachineSaid(`tool:${call.name}`, firstLine)) {
            logger.warn(
              { tool: call.name, word: hit.word, why: hit.why, line: hit.line },
              "a returned tool error told her something untrue about what she is"
            );
          }
        }
      }
      if (filterOutput) content = filterOutput(content);
      return inferToolResultMetadata({
        callId: call.callId,
        name: call.name,
        content,
        outputKind: tool.capability?.outputKind,
        audience: tool.capability?.outputKind === "message" ? "user" : undefined,
        verificationHints: tool.capability?.verifier ? [tool.capability.verifier] : undefined,
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      // Sanitize: strip absolute paths and limit length to prevent info leaks
      const sanitized = raw.replace(/\/[^\s:,)]+/g, "[path]").slice(0, 500);
      return machineSaid(call, `${call.name} 出错了：${sanitized}`);
    }
  }

  return {
    async executeBatch(calls, options) {
      if (calls.length === 0) return [];

      // S-TOL-003: if any tool in the batch is sequential, serialize the entire batch
      const hasSequential = calls.some((c) => {
        const tool = registry.get(c.name);
        return tool?.executionMode === "sequential";
      });

      if (hasSequential) {
        const results: ToolResult[] = [];
        for (const call of calls) {
          results.push(await executeOne(call, options));
          if (options?.signal?.aborted) break;
        }
        return results;
      }

      // All parallel: S-TOL-001
      const settled = await Promise.allSettled(calls.map((c) => executeOne(c, options)));
      return settled.map((s, i) => {
        if (s.status === "fulfilled") return s.value;
        return machineSaid(calls[i], `Error: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`);
      });
    },
  };
}
