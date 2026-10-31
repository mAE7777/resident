// Tool registry: register/unregister tools, TTL-based visibility for token optimization.
//
// Two visibility modes:
//   CORE: always included in getDefinitions(), builtins, runtime-connected MCP
//   HIDDEN: excluded from getDefinitions() until promoted with TTL, config MCP, plugins
//
// TTL lifecycle: promote(names, ttl) → visible for N ticks → tickTTL() decrements →
//   TTL=0 → invisible again. Core tools ignore TTL (always visible).
//
// Execution: get() and getAll() return ALL tools regardless of visibility.
//   Hidden tools can still be executed if the LLM discovers them via search_tools.
//
// Ordering: builtins sorted alphabetically, then MCP tools (name starts with "mcp_").
//   Deterministic ordering preserves Anthropic prompt cache prefix stability.

import { capabilitySearchText, type CapabilityManifest, type CapabilitySummary } from "./capabilities.js";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
  executionMode: "sequential" | "parallel";
  capability?: CapabilityManifest;
  execute: (args: unknown, context?: { signal?: AbortSignal }) => Promise<string>;
}

export interface ToolDefinitionView {
  name: string;
  description: string;
  input_schema: ToolDef["inputSchema"];
}

export interface ToolRegistry {
  /** Register a tool as CORE (always visible in definitions). */
  register(tool: ToolDef): void;
  /** Remove a tool from the registry entirely. */
  unregister(name: string): void;
  /** Get a tool by name (returns ALL tools, including hidden, for execution). */
  get(name: string): ToolDef | undefined;
  /** Get visible tool definitions (core + promoted hidden). Sent to LLM. */
  getDefinitions(): ToolDefinitionView[];
  /** Get ALL tools regardless of visibility (for executor, delegate, bootstrap). */
  getAll(): ToolDef[];
  /** Get manifests for all registered tools that declare a capability contract. */
  getCapabilityManifests(): CapabilitySummary[];

  // ── TTL visibility methods ──────────────────────────────────────────────

  /** Demote a tool to HIDDEN (invisible until promoted). */
  setHidden(name: string): void;
  /** Promote hidden tools: set TTL so they appear in getDefinitions(). Returns actually promoted names. */
  promote(names: string[], ttl?: number): string[];
  /** Decrement all hidden tool TTLs by 1. Tools reaching 0 become invisible. */
  tickTTL(): void;
  /** Search hidden tools by capability-aware keyword matching. Returns matches (does NOT promote). */
  searchHidden(query: string, maxResults?: number): ToolDefinitionView[];
  /** Search all registered capabilities, including visible tools. */
  searchCapabilities(query: string, maxResults?: number): CapabilitySummary[];
  /** Monotonic version that changes when visible tool definitions can change. */
  getVisibilityVersion(): number;
  /** Get count of currently visible tools (for logging/status). */
  visibleCount(): number;
  /** Get count of hidden tools with TTL=0 (for logging/status). */
  hiddenCount(): number;
}

const DEFAULT_PROMOTE_TTL = 8;

// The synonym table that used to sit here expanded HIS words toward product tools she
// never held (weather, currency, places…). Search is now literal: the words he used.
function queryWords(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/\s+/).filter((w) => w.length >= 2))];
}

interface ToolEntry {
  tool: ToolDef;
  core: boolean;
  ttl: number; // only meaningful when core=false; 0 = invisible
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, ToolEntry>();
  let definitionsCache: ToolDefinitionView[] | null = null;
  let visibilityVersion = 0;

  function invalidateCache(): void {
    definitionsCache = null;
  }

  function invalidateVisibility(): void {
    visibilityVersion++;
    invalidateCache();
  }

  function buildDefinitions(): ToolDefinitionView[] {
    const builtins: ToolEntry[] = [];
    const mcpTools: ToolEntry[] = [];

    for (const entry of tools.values()) {
      // Skip hidden tools with expired TTL
      if (!entry.core && entry.ttl <= 0) continue;

      if (entry.tool.name.startsWith("mcp_")) {
        mcpTools.push(entry);
      } else {
        builtins.push(entry);
      }
    }

    builtins.sort((a, b) => a.tool.name.localeCompare(b.tool.name));
    mcpTools.sort((a, b) => a.tool.name.localeCompare(b.tool.name));

    return [...builtins, ...mcpTools].map((e) => ({
      name: e.tool.name,
      description: e.tool.description,
      input_schema: e.tool.inputSchema,
    }));
  }

  function scoreTool(tool: ToolDef, query: string): number {
    const qWords = queryWords(query);
    if (qWords.length === 0) return 0;

    const name = tool.name.toLowerCase();
    const desc = tool.description.toLowerCase();
    const nameWords = name.replace(/^mcp_[^_]+_/, "").split("_");
    const manifest = tool.capability;
    const aliasText = (manifest?.aliases ?? []).join(" ").toLowerCase();
    const domainText = (manifest?.domains ?? []).join(" ").toLowerCase();
    const fallbackText = (manifest?.fallbackTools ?? []).join(" ").toLowerCase();
    const capabilityText = capabilitySearchText(tool).toLowerCase();

    let score = 0;
    for (const qw of qWords) {
      if (nameWords.includes(qw)) score += 12;
      else if (name.includes(qw)) score += 6;
      if (aliasText.split(/\s+/).includes(qw)) score += 10;
      else if (aliasText.includes(qw)) score += 6;
      if (domainText.split(/\s+/).includes(qw)) score += 8;
      else if (domainText.includes(qw)) score += 4;
      if (fallbackText.includes(qw)) score += 3;
      if (desc.includes(qw)) score += 3;
      else if (capabilityText.includes(qw)) score += 1;
    }
    return score;
  }

  function toSummary(entry: ToolEntry): CapabilitySummary | null {
    if (!entry.tool.capability) return null;
    return {
      tool: entry.tool.name,
      description: entry.tool.description,
      manifest: entry.tool.capability,
    };
  }

  return {
    register(tool) {
      const existing = tools.get(tool.name);
      tools.set(tool.name, {
        tool,
        core: existing ? existing.core : true, // preserve hidden status on re-register
        ttl: existing ? existing.ttl : 0,
      });
      invalidateVisibility();
    },

    unregister(name) {
      if (tools.delete(name)) {
        invalidateVisibility();
      }
    },

    get(name) {
      return tools.get(name)?.tool;
    },

    getDefinitions() {
      if (definitionsCache === null) {
        definitionsCache = buildDefinitions();
      }
      return definitionsCache;
    },

    getAll() {
      return Array.from(tools.values()).map((e) => e.tool);
    },

    getCapabilityManifests() {
      return Array.from(tools.values())
        .map(toSummary)
        .filter((summary): summary is CapabilitySummary => summary !== null)
        .sort((a, b) => a.tool.localeCompare(b.tool));
    },

    setHidden(name) {
      const entry = tools.get(name);
      if (entry) {
        entry.core = false;
        entry.ttl = 0;
        invalidateVisibility();
      }
    },

    promote(names, ttl = DEFAULT_PROMOTE_TTL) {
      const promoted: string[] = [];
      for (const name of names) {
        const entry = tools.get(name);
        if (entry && !entry.core && entry.ttl <= 0) {
          entry.ttl = ttl;
          promoted.push(name);
        }
      }
      if (promoted.length > 0) invalidateVisibility();
      return promoted;
    },

    tickTTL() {
      let changed = false;
      for (const entry of tools.values()) {
        if (!entry.core && entry.ttl > 0) {
          entry.ttl -= 1;
          if (entry.ttl <= 0) changed = true;
        }
      }
      if (changed) invalidateVisibility();
    },

    searchHidden(query, maxResults = 10) {
      const scored: Array<{ entry: ToolEntry; score: number }> = [];

      for (const entry of tools.values()) {
        // Only search hidden tools (core tools are already visible)
        if (entry.core) continue;
        const score = scoreTool(entry.tool, query);

        if (score > 0) scored.push({ entry, score });
      }

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, maxResults).map((s) => ({
        name: s.entry.tool.name,
        description: s.entry.tool.description,
        input_schema: s.entry.tool.inputSchema,
      }));
    },

    searchCapabilities(query, maxResults = 10) {
      const scored: Array<{ entry: ToolEntry; score: number }> = [];
      for (const entry of tools.values()) {
        if (!entry.tool.capability) continue;
        const score = scoreTool(entry.tool, query);
        if (score > 0) scored.push({ entry, score });
      }

      scored.sort((a, b) => b.score - a.score || a.entry.tool.name.localeCompare(b.entry.tool.name));
      return scored
        .slice(0, maxResults)
        .map((item) => toSummary(item.entry))
        .filter((summary): summary is CapabilitySummary => summary !== null);
    },

    getVisibilityVersion() {
      return visibilityVersion;
    },

    visibleCount() {
      let count = 0;
      for (const entry of tools.values()) {
        if (entry.core || entry.ttl > 0) count++;
      }
      return count;
    },

    hiddenCount() {
      let count = 0;
      for (const entry of tools.values()) {
        if (!entry.core && entry.ttl <= 0) count++;
      }
      return count;
    },
  };
}
