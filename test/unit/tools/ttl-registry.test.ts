import { describe, it, expect } from "vitest";
import { createToolRegistry, type ToolDef } from "../../../src/tools/registry.js";

function makeTool(name: string, desc = `Tool: ${name}`): ToolDef {
  return {
    name,
    description: desc,
    inputSchema: { type: "object", properties: { x: { type: "string" } } },
    executionMode: "sequential",
    execute: async () => "ok",
  };
}

// ── Core vs Hidden registration ─────────────────────────────────────────────

describe("TTL registry — core vs hidden", () => {
  it("register() makes tool core (visible in getDefinitions)", () => {
    const reg = createToolRegistry();
    reg.register(makeTool("bash"));
    expect(reg.getDefinitions().map(t => t.name)).toContain("bash");
    expect(reg.visibleCount()).toBe(1);
    expect(reg.hiddenCount()).toBe(0);
  });

  it("setHidden() demotes tool — invisible in getDefinitions but accessible via get()", () => {
    const reg = createToolRegistry();
    reg.register(makeTool("mcp_pw_navigate"));
    reg.setHidden("mcp_pw_navigate");
    expect(reg.getDefinitions().map(t => t.name)).not.toContain("mcp_pw_navigate");
    expect(reg.get("mcp_pw_navigate")).toBeDefined();
    expect(reg.hiddenCount()).toBe(1);
  });

  it("getAll() returns all tools regardless of visibility", () => {
    const reg = createToolRegistry();
    reg.register(makeTool("bash"));
    reg.register(makeTool("mcp_pw_click"));
    reg.setHidden("mcp_pw_click");
    expect(reg.getAll()).toHaveLength(2);
    expect(reg.getDefinitions()).toHaveLength(1);
  });
});

// ── Promote + TTL lifecycle ─────────────────────────────────────────────────

describe("TTL registry — promote and tick", () => {
  it("promote() makes hidden tool visible with TTL", () => {
    const reg = createToolRegistry();
    reg.register(makeTool("mcp_pw_click"));
    reg.setHidden("mcp_pw_click");
    expect(reg.getDefinitions()).toHaveLength(0);

    const promoted = reg.promote(["mcp_pw_click"], 3);
    expect(promoted).toEqual(["mcp_pw_click"]);
    expect(reg.getDefinitions().map(t => t.name)).toContain("mcp_pw_click");
  });

  it("tickTTL() decrements TTL — tool disappears at 0", () => {
    const reg = createToolRegistry();
    reg.register(makeTool("mcp_pw_snap"));
    reg.setHidden("mcp_pw_snap");
    reg.promote(["mcp_pw_snap"], 2);

    expect(reg.getDefinitions()).toHaveLength(1); // TTL=2, visible

    reg.tickTTL(); // TTL=1
    expect(reg.getDefinitions()).toHaveLength(1); // still visible

    reg.tickTTL(); // TTL=0
    expect(reg.getDefinitions()).toHaveLength(0); // gone
  });

  it("tickTTL() does not affect core tools", () => {
    const reg = createToolRegistry();
    reg.register(makeTool("bash"));
    reg.tickTTL();
    reg.tickTTL();
    reg.tickTTL();
    expect(reg.getDefinitions().map(t => t.name)).toContain("bash");
  });

  it("promote() ignores already-promoted tools (no TTL reset)", () => {
    const reg = createToolRegistry();
    reg.register(makeTool("mcp_pw_click"));
    reg.setHidden("mcp_pw_click");
    reg.promote(["mcp_pw_click"], 5); // TTL=5

    reg.tickTTL(); // TTL=4
    const re = reg.promote(["mcp_pw_click"], 5); // already promoted, TTL>0
    expect(re).toEqual([]); // not re-promoted
  });

  it("promote() ignores core tools", () => {
    const reg = createToolRegistry();
    reg.register(makeTool("bash"));
    const promoted = reg.promote(["bash"], 5);
    expect(promoted).toEqual([]);
  });
});

// ── searchHidden ────────────────────────────────────────────────────────────

describe("TTL registry — searchHidden", () => {
  it("finds hidden tool by name keyword", () => {
    const reg = createToolRegistry();
    reg.register(makeTool("mcp_playwright_browser_navigate", "Navigate to a URL in the browser"));
    reg.setHidden("mcp_playwright_browser_navigate");

    const results = reg.searchHidden("navigate");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("mcp_playwright_browser_navigate");
  });

  it("finds hidden tool by description keyword", () => {
    const reg = createToolRegistry();
    reg.register(makeTool("mcp_playwright_browser_snapshot", "Take a screenshot of the current page"));
    reg.setHidden("mcp_playwright_browser_snapshot");

    const results = reg.searchHidden("screenshot");
    expect(results).toHaveLength(1);
  });

  it("does NOT search core tools (they're already visible)", () => {
    const reg = createToolRegistry();
    reg.register(makeTool("bash", "Execute shell commands"));
    const results = reg.searchHidden("shell");
    expect(results).toHaveLength(0);
  });

  it("ranks exact name matches higher than description matches", () => {
    const reg = createToolRegistry();
    reg.register(makeTool("mcp_pw_browser_click", "Click on an element"));
    reg.register(makeTool("mcp_pw_browser_hover", "Hover over a click target"));
    reg.setHidden("mcp_pw_browser_click");
    reg.setHidden("mcp_pw_browser_hover");

    const results = reg.searchHidden("click");
    expect(results[0].name).toBe("mcp_pw_browser_click"); // name match scores higher
  });

  it("returns empty for no matches", () => {
    const reg = createToolRegistry();
    reg.register(makeTool("mcp_pw_navigate"));
    reg.setHidden("mcp_pw_navigate");
    expect(reg.searchHidden("zzzznonexistent")).toHaveLength(0);
  });

  it("respects maxResults", () => {
    const reg = createToolRegistry();
    for (let i = 0; i < 20; i++) {
      reg.register(makeTool(`mcp_pw_tool_${i}`, `Browser tool number ${i}`));
      reg.setHidden(`mcp_pw_tool_${i}`);
    }
    const results = reg.searchHidden("browser", 5);
    expect(results).toHaveLength(5);
  });
});

// ── Re-register preserves hidden status ─────────────────────────────────────

describe("TTL registry — re-register preserves visibility", () => {
  it("re-registering a hidden tool keeps it hidden", () => {
    const reg = createToolRegistry();
    reg.register(makeTool("mcp_pw_click"));
    reg.setHidden("mcp_pw_click");

    // Re-register (e.g., mcp-playwright.ts wraps execute)
    reg.register(makeTool("mcp_pw_click"));
    expect(reg.getDefinitions().map(t => t.name)).not.toContain("mcp_pw_click");
  });
});

// ── Ordering stability ──────────────────────────────────────────────────────

describe("TTL registry — deterministic ordering", () => {
  it("builtins sorted alphabetically, then MCP tools sorted alphabetically", () => {
    const reg = createToolRegistry();
    reg.register(makeTool("write"));
    reg.register(makeTool("bash"));
    reg.register(makeTool("mcp_b_tool"));
    reg.register(makeTool("mcp_a_tool"));
    reg.register(makeTool("read"));

    const names = reg.getDefinitions().map(t => t.name);
    expect(names).toEqual(["bash", "read", "write", "mcp_a_tool", "mcp_b_tool"]);
  });
});

// ── Integration: wired in index.ts ──────────────────────────────────────────

