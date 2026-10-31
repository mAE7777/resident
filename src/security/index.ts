// SecurityLayer composition: wires all sub-modules into a single facade
// createSecurityLayer(config, db) → DiagnosticResult<SecurityLayer>

import type { DatabaseWrapper } from "../db/sqlite.js";
import type { Diagnostic, DiagnosticResult } from "../types/diagnostic.js";

import { createInjectionScanner } from "./injection.js";
import { createLeakScanner } from "./leak.js";
import { redact } from "./redact.js";
import { createCommandScanner } from "./commands.js";
import { classifyTool, type Zone } from "./zones.js";
import { shouldExecuteTools, type ToolExecutionContext, type ToolExecutionDecision } from "./tool-guard.js";
import { checkSafetyAdvisory, type AdvisoryResult } from "./advisory.js";
import { createSensitiveFilter, type SensitiveFilter } from "./sensitive.js";
import { createSkillScanner, type SkillScanResult } from "./skill-scanner.js";
import { filterToolsForTrust, type TrustLevel, type ToolDefinition } from "./trust.js";
import { checkSelfAccess, type SelfAccessResult } from "./self-acl.js";
import { wrapExternalContent, type ExternalContentSource } from "./boundary.js";

import type { InjectionScanResult } from "./injection.js";
import type { LeakScanResult } from "./leak.js";
import type { CommandScanResult } from "./commands.js";

export interface SecurityConfig {
  secrets?: Map<string, string>;
}

export interface SecurityLayer {
  // Injection scanning
  scanInjection(input: string): InjectionScanResult;
  // Leak detection
  scanLeaks(output: string): LeakScanResult;
  // Redaction (prefix/pattern-based)
  redact(text: string): string;
  // Command safety scanning
  scanCommand(command: string): CommandScanResult | null;
  // Zone classification
  classifyZone(toolName: string): Zone;
  // Tool execution gate
  shouldExecuteTools(ctx: ToolExecutionContext): ToolExecutionDecision;
  // Safety advisory
  checkAdvisory(tool: string, args: unknown): AdvisoryResult;
  // Sensitive filter (config-secrets-aware)
  filterSensitive(content: string): string;
  // Skill static analysis
  scanSkill(path: string, source: string, mtime: number): SkillScanResult;
  // External content wrapping
  wrapExternal(content: string, source: string): string;
  // Tool schema filtering by trust level
  filterToolsForTrust(allTools: ToolDefinition[], trust: TrustLevel): ToolDefinition[];
  // SelfTool ACL
  checkSelfAccess(path: string, operation: "read" | "write"): SelfAccessResult;
}

export function createSecurityLayer(
  config: SecurityConfig,
  _db: DatabaseWrapper
): DiagnosticResult<SecurityLayer> {
  const diagnostics: Diagnostic[] = [];

  const injectionScanner = createInjectionScanner();
  diagnostics.push({ level: "info", message: "injection scanner ready", source: "security" });

  const leakScanner = createLeakScanner();
  diagnostics.push({ level: "info", message: "leak scanner ready", source: "security" });

  const commandScanner = createCommandScanner();
  diagnostics.push({ level: "info", message: "command scanner ready", source: "security" });

  const sensitiveFilter: SensitiveFilter = createSensitiveFilter(config.secrets ?? new Map());
  diagnostics.push({ level: "info", message: "sensitive filter ready", source: "security" });

  const skillScanner = createSkillScanner();
  diagnostics.push({ level: "info", message: "skill scanner ready", source: "security" });

  diagnostics.push({ level: "info", message: "security layer initialized (12 sub-modules)", source: "security" });

  const layer: SecurityLayer = {
    scanInjection(input) {
      return injectionScanner.scanForInjection(input);
    },

    scanLeaks(output) {
      return leakScanner.scanForLeaks(output);
    },

    redact(text) {
      return redact(text);
    },

    scanCommand(command) {
      return commandScanner.scanCommand(command);
    },

    classifyZone(toolName) {
      return classifyTool(toolName);
    },

    shouldExecuteTools(ctx) {
      return shouldExecuteTools(ctx);
    },

    checkAdvisory(tool, args) {
      return checkSafetyAdvisory(tool, args);
    },

    filterSensitive(content) {
      return sensitiveFilter.filter(content);
    },

    scanSkill(path, source, mtime) {
      return skillScanner.scan(path, source, mtime);
    },

    wrapExternal(content, source) {
      const valid: Set<string> = new Set(["web_fetch", "web_search", "video_extract", "browser", "api", "file_read", "mcp_result", "email", "unknown"]);
      const safeSource: ExternalContentSource = valid.has(source) ? source as ExternalContentSource : "unknown";
      return wrapExternalContent(content, safeSource);
    },

    filterToolsForTrust(allTools, trust) {
      return filterToolsForTrust(allTools, trust);
    },

    checkSelfAccess(path, operation) {
      return checkSelfAccess(path, operation);
    },
  };

  return { result: layer, diagnostics };
}

// Re-export sub-module types and functions for convenience
export type { TrustLevel, ToolDefinition } from "./trust.js";
export type { ToolCapabilities } from "./capabilities.js";
export { parseCapabilities, enforceCapabilities } from "./capabilities.js";
export type { SensitiveFilter } from "./sensitive.js";
export { createSensitiveFilter } from "./sensitive.js";
export type { SelfAccessDecision, SelfAccessResult } from "./self-acl.js";
export { checkSelfAccess } from "./self-acl.js";
export type { AdvisoryTier, AdvisoryOutcome, AdvisoryResult } from "./advisory.js";
export { checkSafetyAdvisory } from "./advisory.js";
export type { SkillFinding, SkillFindingSeverity, SkillScanResult } from "./skill-scanner.js";
export { createSkillScanner } from "./skill-scanner.js";
export { filterToolsForTrust } from "./trust.js";
export type { Zone } from "./zones.js";
// `shouldAutoApprove` is gone with the four-level permission ladder; see zones.ts for what
// replaced it and why. `classifyTool` stays: its one remaining job is telling the Rule-of-Two
// check whether a tool is untrusted, which is a fact about a TOOL rather than a rating of her.
export { classifyTool, registerZoneOverride, clearZoneOverrides } from "./zones.js";
