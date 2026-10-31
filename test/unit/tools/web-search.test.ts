import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWebSearchTool } from "../../../src/tools/builtin/web.js";
import type { SecurityLayer } from "../../../src/security/index.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSecurityLayer(): SecurityLayer {
  return {
    scanInjection: vi.fn().mockReturnValue({ hasInjection: false, findings: [] }),
    scanLeaks: vi.fn().mockReturnValue({ hasLeaks: false, findings: [] }),
    redact: vi.fn((t: string) => t),
    scanCommand: vi.fn().mockReturnValue(null),
    classifyZone: vi.fn().mockReturnValue(1),
    shouldExecuteTools: vi.fn().mockReturnValue({ execute: true, reason: "ok" }),
    checkAdvisory: vi.fn().mockReturnValue({ tier: 1, outcome: "allow", reason: "ok" }),
    filterSensitive: vi.fn((t: string) => t),
    scanSkill: vi.fn().mockReturnValue({ safe: true, findings: [] }),
    wrapExternal: vi.fn((content: string, source: string) => `[WRAPPED:${source}] ${content}`),
    filterToolsForTrust: vi.fn((tools: unknown[]) => tools),
    checkSelfAccess: vi.fn().mockReturnValue({ decision: "ALLOW", reason: "ok" }),
  } as unknown as SecurityLayer;
}

// ── No API key configured ────────────────────────────────────────────────────

describe("web_search — no API key (DDG fallback)", () => {
  it("falls back to DuckDuckGo when no API key is set", async () => {
    const security = makeSecurityLayer();
    const tool = createWebSearchTool({ security });

    const result = await tool.execute({ query: "TypeScript async patterns" });
    // Without Brave API key, DDG fallback is tried. Result is either DDG results,
    // "No results found", or "Web search failed", but NOT "not configured"
    expect(result).not.toContain("not configured");
  });

  it("falls back to DuckDuckGo when API key is empty string", async () => {
    const security = makeSecurityLayer();
    const tool = createWebSearchTool({ security, searchApiKey: "" });

    const result = await tool.execute({ query: "anything" });
    expect(result).not.toContain("not configured");
  });
});

// ── Brave API success ────────────────────────────────────────────────────────

describe("web_search — successful search", () => {
  const mockBraveResponse = {
    web: {
      results: [
        { title: "Async Patterns in TS", url: "https://example.com/async", description: "Learn async/await patterns." },
        { title: "TypeScript Handbook", url: "https://typescriptlang.org", description: "Official TS docs." },
        { title: "Advanced Async", url: "https://example.com/advanced", description: "Deep dive into async." },
      ],
    },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns up to 5 results with title, url, and snippet", async () => {
    const security = makeSecurityLayer();

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockBraveResponse), { status: 200, headers: { "Content-Type": "application/json" } })
    );

    const tool = createWebSearchTool({ security, searchApiKey: "test-key-123" });
    const result = await tool.execute({ query: "TypeScript async patterns" });

    expect(result).toContain("Async Patterns in TS");
    expect(result).toContain("https://example.com/async");
    expect(result).toContain("Learn async/await patterns.");
    expect(result).toContain("TypeScript Handbook");
    expect(result).toContain("Advanced Async");
  });

  it("wraps results with wrapExternal using 'web_search' source", async () => {
    const security = makeSecurityLayer();

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockBraveResponse), { status: 200, headers: { "Content-Type": "application/json" } })
    );

    const tool = createWebSearchTool({ security, searchApiKey: "test-key-123" });
    const result = await tool.execute({ query: "TypeScript async patterns" });

    expect(security.wrapExternal).toHaveBeenCalledWith(expect.any(String), "web_search");
    expect(result).toContain("[WRAPPED:web_search]");
  });

  it("sends correct headers and query to Brave API", async () => {
    const security = makeSecurityLayer();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockBraveResponse), { status: 200, headers: { "Content-Type": "application/json" } })
    );

    const tool = createWebSearchTool({ security, searchApiKey: "my-brave-key" });
    await tool.execute({ query: "test query" });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("https://api.search.brave.com/res/v1/web/search");
    expect(url).toContain("q=test+query");
    expect(url).toContain("count=5");
    expect(options.headers).toHaveProperty("X-Subscription-Token", "my-brave-key");
  });

  it("handles empty results gracefully", async () => {
    const security = makeSecurityLayer();

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ web: { results: [] } }), { status: 200, headers: { "Content-Type": "application/json" } })
      )
      .mockResolvedValueOnce(
        new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } })
      );

    const tool = createWebSearchTool({ security, searchApiKey: "test-key" });
    const result = await tool.execute({ query: "impossible query xyz" });

    expect(result).toContain("No results found for: impossible query xyz");
    expect(security.wrapExternal).toHaveBeenCalledWith(expect.stringContaining("No results"), "web_search");
  });
});

// ── Brave API errors ─────────────────────────────────────────────────────────

describe("web_search — error handling", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to DDG when Brave returns non-OK status", async () => {
    const security = makeSecurityLayer();

    // Brave fails (429), DDG also returns nothing useful in test
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } }));

    const tool = createWebSearchTool({ security, searchApiKey: "test-key" });
    const result = await tool.execute({ query: "test" });

    // DDG was tried as fallback: result is either "No results" or DDG results, not Brave error
    expect(result).not.toContain("Rate limited");
  });

  it("returns failure message when both Brave and DDG network fail", async () => {
    const security = makeSecurityLayer();

    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const tool = createWebSearchTool({ security, searchApiKey: "test-key" });
    const result = await tool.execute({ query: "test" });

    expect(result).toContain("Web search failed");
  });

  it("falls back to DDG when Brave response is malformed JSON", async () => {
    const security = makeSecurityLayer();

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("not json", { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } }));

    const tool = createWebSearchTool({ security, searchApiKey: "test-key" });
    const result = await tool.execute({ query: "test" });

    // DDG fallback tried: result is not a raw Brave error
    expect(result).not.toContain("not json");
  });

  it("does not expose raw network errors when both backends fail", async () => {
    const security = makeSecurityLayer();

    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED 192.168.1.1:443"))
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED 192.168.1.1:443"));

    const tool = createWebSearchTool({ security, searchApiKey: "test-key" });
    const result = await tool.execute({ query: "test" });

    expect(result).not.toContain("ECONNREFUSED");
    expect(result).not.toContain("192.168.1.1");
    expect(result).toContain("Web search failed");
  });
});

// ── Tool metadata ────────────────────────────────────────────────────────────

describe("web_search — tool definition", () => {
  it("has correct name and execution mode", () => {
    const security = makeSecurityLayer();
    const tool = createWebSearchTool({ security });

    expect(tool.name).toBe("web_search");
    expect(tool.executionMode).toBe("sequential");
  });

  it("requires query in input schema", () => {
    const security = makeSecurityLayer();
    const tool = createWebSearchTool({ security });

    expect(tool.inputSchema.required).toContain("query");
  });
});
