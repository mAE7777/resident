// Tool trust model: filters tool schemas for untrusted contexts
// Untrusted (external/MCP) callers have dangerous tools removed from the schema entirely.
// Trusted (workspace/skills) callers get the full tool set.

export type TrustLevel = "trusted" | "untrusted";

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
  zone?: string;
}

// Tools that are never visible to untrusted contexts.
// Removal is schema-level: the tool doesn't appear at all, not just permission-gated.
const UNTRUSTED_BLOCKED_TOOLS = new Set([
  "bash",
  "write",
  "edit",
  "spawn",
]);

export function filterToolsForTrust(
  allTools: ToolDefinition[],
  trust: TrustLevel
): ToolDefinition[] {
  if (trust === "trusted") {
    return allTools;
  }
  // untrusted: remove dangerous tools entirely from the schema
  return allTools.filter((tool) => !UNTRUSTED_BLOCKED_TOOLS.has(tool.name.toLowerCase()));
}
