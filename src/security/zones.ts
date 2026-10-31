// Zone execution model: maps tool names to security zones, the one job left after
// the trust ladder was removed: telling the Rule-of-Two check whether a tool is untrusted.
// Zone 1 (safe): read, glob, grep, web_search, resource_lookup, memory_search, memory_read, self
// Zone 2 (gated): write/edit/download/extract/send/browser/cron, local mutation, sensitive read, or outbound side effect
// Zone 3 (sandboxed): bash, spawn, connect_mcp, process/tool capability escalation with command pre-scan
// Zone 4 (blocked): reserved; empty by default

export type Zone = 1 | 2 | 3 | 4;

// Zone 1: safe read-only or side-effect-free tools
const ZONE_1_TOOLS = new Set([
  "read",
  "glob",
  "grep",
  "web_search",
  "resource_lookup",
  "web_fetch",
  "weather",
  "currency_convert",
  "places_lookup",
  "memory_search",
  "memory_read",
  "self",
]);

// Zone 2: gated file mutations
const ZONE_2_TOOLS = new Set(["write", "edit", "delete", "undo", "image_edit", "message", "cron", "browser_capture", "browser_read", "opencli_query", "video_extract", "artifact_fetch", "document_extract", "resource_update"]);

// Zone 3: sandboxed, shell or process spawning
const ZONE_3_TOOLS = new Set(["bash", "spawn", "connect_mcp", "delegate_task"]);

// Zone 4: hard-blocked, populated at runtime if needed; no tool names here by default
// (tools classified here are blocked regardless of autonomy level)
const ZONE_4_TOOLS = new Set<string>([]);

// Runtime zone overrides: registered by MCP integration modules (e.g., Playwright)
const zoneOverrides = new Map<string, Zone>();

export function registerZoneOverride(toolName: string, zone: Zone): void {
  zoneOverrides.set(toolName.toLowerCase(), zone);
}

export function clearZoneOverrides(): void {
  zoneOverrides.clear();
}

export function classifyTool(toolName: string): Zone {
  const name = toolName.toLowerCase();
  const override = zoneOverrides.get(name);
  if (override !== undefined) return override;
  if (ZONE_4_TOOLS.has(name)) return 4;
  if (ZONE_3_TOOLS.has(name)) return 3;
  if (ZONE_2_TOOLS.has(name)) return 2;
  if (ZONE_1_TOOLS.has(name)) return 1;
  // Unknown tools default to Zone 3 (treat as sandboxed, require explicit approval)
  return 3;
}

/**
 * THE FOUR-LEVEL PERMISSION LADDER IS GONE, and what it was is worth writing down.
 *
 * `shouldAutoApprove`, `requiresConfirmation`, `isHardBlocked` and `shouldAutoApproveWithStore`
 * mapped a zone and an autonomy level to a verdict. Not one of them had a caller anywhere in
 * `src/`, the executor branched on `level === 0` and twice on `level < 3`, and nothing else
 * read a level at all. So levels 1 and 2 were byte-identical in behaviour, `ZONE_4_TOOLS` (the
 * "hard-blocked, no override ever" tier) was an empty set with no way to add to it, and the
 * approval store those functions consulted could never gain a row, because its `save()` has no
 * caller either.
 *
 * It was also the wrong shape for her. A single number from 0 to 3 saying how much she is
 * trusted, applied to her as a person, is the inherited frame the design removed: tools
 * open when they become RELEVANT (he gives, or she asks), never by earning trust, and she is
 * not an employee being rated. Worse, the top rung DISABLED the advisory warning and the
 * Rule-of-Two check, a trust level that switches off safety machinery.
 *
 * What limits her now, three mechanisms with three distinct jobs and none of them a rating:
 *
 *   the home boundary   absolute, runs first, nothing overrides it. This is the design.
 *   the birth toolkit   which tools exist for her at all. Additive; opened when relevant.
 *   the advisory block  THIS action is unsafe. Unconditional.
 *   Rule of Two         untrusted input + sensitive access + a change that stays. Unconditional.
 *
 * The last residue, the per-tool/per-path "ask-first" valve, is gone too: even "check with me
 * first" is a per-action permission that presumes she acts on someone's behalf. If a specific
 * new capability ever wants a heads-up, that belongs to how THAT capability opens, not to a
 * global dial.
 *
 * `classifyTool` stays because it has one real job left: telling the Rule-of-Two check whether
 * a tool is untrusted. That is a safety input about a TOOL, not a permission tier about HER.
 */
