import { describe, it, expect, beforeEach } from "vitest";
import { createToolRegistry } from "../../../src/tools/registry.js";
import type { ToolDef } from "../../../src/tools/registry.js";

function makeToolDef(name: string, mode: "parallel" | "sequential" = "parallel"): ToolDef {
  return {
    name,
    description: `${name} tool`,
    inputSchema: { type: "object" },
    executionMode: mode,
    execute: async () => "ok",
  };
}

function makeCapabilityTool(name: string, aliases: string[]): ToolDef {
  return {
    ...makeToolDef(name),
    capability: {
      domains: ["media", "web"],
      aliases,
      access: "native",
      outputKind: "text",
      riskZone: 1,
    },
  };
}

describe("registry.ts — createToolRegistry", () => {
  it("registers a tool and retrieves it", () => {
    const registry = createToolRegistry();
    registry.register(makeToolDef("read"));
    expect(registry.get("read")).toBeDefined();
    expect(registry.get("read")!.name).toBe("read");
  });

  it("unregisters a tool", () => {
    const registry = createToolRegistry();
    registry.register(makeToolDef("read"));
    registry.unregister("read");
    expect(registry.get("read")).toBeUndefined();
  });

  it("returns undefined for unknown tool", () => {
    const registry = createToolRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("getAll() returns all registered tools", () => {
    const registry = createToolRegistry();
    registry.register(makeToolDef("read"));
    registry.register(makeToolDef("write"));
    expect(registry.getAll()).toHaveLength(2);
  });
});

// AC 8: builtins sorted alphabetically, then MCP tools sorted alphabetically
describe("registry.ts — AC8: getDefinitions() sort order", () => {
  it("sorts builtins alphabetically, then MCP tools alphabetically", () => {
    const registry = createToolRegistry();

    // Register in random order: builtins and MCP mixed
    registry.register(makeToolDef("write"));
    registry.register(makeToolDef("mcp_github"));
    registry.register(makeToolDef("read"));
    registry.register(makeToolDef("mcp_airtable"));
    registry.register(makeToolDef("bash"));
    registry.register(makeToolDef("mcp_zendesk"));

    const defs = registry.getDefinitions();
    const names = defs.map((d) => d.name);

    // Builtins first (alphabetical)
    expect(names.indexOf("bash")).toBeLessThan(names.indexOf("read"));
    expect(names.indexOf("read")).toBeLessThan(names.indexOf("write"));

    // All builtins before any MCP tool
    const firstMcp = names.findIndex((n) => n.startsWith("mcp_"));
    const lastBuiltin = Math.max(names.indexOf("bash"), names.indexOf("read"), names.indexOf("write"));
    expect(lastBuiltin).toBeLessThan(firstMcp);

    // MCP tools alphabetical among themselves
    expect(names.indexOf("mcp_airtable")).toBeLessThan(names.indexOf("mcp_github"));
    expect(names.indexOf("mcp_github")).toBeLessThan(names.indexOf("mcp_zendesk"));
  });

  it("returns definitions in provider-compatible shape (name, description, input_schema)", () => {
    const registry = createToolRegistry();
    registry.register(makeToolDef("read"));
    const defs = registry.getDefinitions();
    expect(defs[0]).toHaveProperty("name");
    expect(defs[0]).toHaveProperty("description");
    expect(defs[0]).toHaveProperty("input_schema");
  });

  it("cache invalidates when tool is registered", () => {
    const registry = createToolRegistry();
    registry.register(makeToolDef("write"));
    const first = registry.getDefinitions();

    registry.register(makeToolDef("apple"));
    const second = registry.getDefinitions();

    // apple should appear before write after re-sort
    const names = second.map((d) => d.name);
    expect(names.indexOf("apple")).toBeLessThan(names.indexOf("write"));
    expect(first).not.toBe(second); // different array reference (cache invalidated)
  });

  it("cache invalidates when tool is unregistered", () => {
    const registry = createToolRegistry();
    registry.register(makeToolDef("write"));
    registry.register(makeToolDef("read"));
    const first = registry.getDefinitions();

    registry.unregister("write");
    const second = registry.getDefinitions();

    expect(second.map((d) => d.name)).not.toContain("write");
    expect(first).not.toBe(second);
  });

  it("searches capabilities using aliases and domains, not only tool names", () => {
    const registry = createToolRegistry();
    registry.register(makeCapabilityTool("video_extract", ["youtube", "captions", "recipe video"]));
    registry.register(makeToolDef("plain_tool"));

    const matches = registry.searchCapabilities("extract youtube recipe", 5);

    expect(matches[0]?.tool).toBe("video_extract");
    expect(matches[0]?.manifest.aliases).toContain("youtube");
  });

  it("searchHidden uses capability aliases for promoted tool discovery", () => {
    const registry = createToolRegistry();
    registry.register(makeCapabilityTool("mcp_browser_read", ["rendered page", "javascript page"]));
    registry.setHidden("mcp_browser_read");

    const matches = registry.searchHidden("javascript page", 5);

    expect(matches.map((match) => match.name)).toContain("mcp_browser_read");
  });
});
