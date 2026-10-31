import { describe, it, expect, vi } from "vitest";
import { bootstrapAgent } from "../../../src/telegram/bootstrap.js";
import type { BootstrapDeps } from "../../../src/telegram/bootstrap.js";
import type { SecurityLayer } from "../../../src/security/index.js";
import { createToolRegistry } from "../../../src/tools/registry.js";

// ── Mock search module ────────────────────────────────────────────────────────
// We intercept createMemorySearchTool and createMemoryReadTool to avoid
// needing a real SQLite search manager in unit tests.

const mockSearchTool = { name: "memory_search", description: "search", inputSchema: { type: "object" as const, required: ["query"] }, executionMode: "parallel" as const, execute: vi.fn() };
const mockReadTool = { name: "memory_read", description: "read", inputSchema: { type: "object" as const, required: ["id"] }, executionMode: "parallel" as const, execute: vi.fn() };

const mockCronTool = { name: "cron", description: "cron", inputSchema: { type: "object" as const }, executionMode: "sequential" as const, execute: vi.fn() };
const mockMessageTool = { name: "message", description: "message", inputSchema: { type: "object" as const, required: ["text"] }, executionMode: "sequential" as const, execute: vi.fn() };

vi.mock("../../../src/memory/search.js", () => ({
  createMemorySearchTool: vi.fn(() => mockSearchTool),
  createMemoryReadTool: vi.fn(() => mockReadTool),
}));

vi.mock("../../../src/tools/builtin/cron.js", () => ({
  createCronTool: vi.fn(() => mockCronTool),
}));

vi.mock("../../../src/tools/builtin/message.js", () => ({
  createMessageTool: vi.fn(() => mockMessageTool),
}));

// ── Mock builtin tools that need no external deps ─────────────────────────────

const mockBashTool = { name: "bash", description: "bash", inputSchema: { type: "object" as const, required: ["command"] }, executionMode: "sequential" as const, execute: vi.fn() };
const mockArtifactFetchTool = { name: "artifact_fetch", description: "artifact_fetch", inputSchema: { type: "object" as const, required: ["source"] }, executionMode: "sequential" as const, execute: vi.fn() };
const mockEditTool = { name: "edit", description: "edit", inputSchema: { type: "object" as const }, executionMode: "sequential" as const, execute: vi.fn() };
const mockGlobTool = { name: "glob", description: "glob", inputSchema: { type: "object" as const }, executionMode: "parallel" as const, execute: vi.fn() };
const mockGrepTool = { name: "grep", description: "grep", inputSchema: { type: "object" as const }, executionMode: "parallel" as const, execute: vi.fn() };
const mockReadFileTool = { name: "read", description: "read", inputSchema: { type: "object" as const }, executionMode: "parallel" as const, execute: vi.fn() };
const mockSelfTool = { name: "self", description: "self", inputSchema: { type: "object" as const }, executionMode: "parallel" as const, execute: vi.fn() };
const mockVideoExtractTool = { name: "video_extract", description: "video_extract", inputSchema: { type: "object" as const }, executionMode: "sequential" as const, execute: vi.fn() };
const mockWebFetchTool = { name: "web_fetch", description: "web_fetch", inputSchema: { type: "object" as const }, executionMode: "sequential" as const, execute: vi.fn() };
const mockWebSearchTool = { name: "web_search", description: "web_search", inputSchema: { type: "object" as const }, executionMode: "sequential" as const, execute: vi.fn() };
const mockWriteTool = { name: "write", description: "write", inputSchema: { type: "object" as const }, executionMode: "sequential" as const, execute: vi.fn() };

vi.mock("../../../src/tools/builtin/bash.js", () => ({
  createBashTool: vi.fn(() => mockBashTool),
}));
vi.mock("../../../src/tools/builtin/artifact-fetch.js", () => ({
  createArtifactFetchTool: vi.fn(() => mockArtifactFetchTool),
}));
vi.mock("../../../src/tools/builtin/edit.js", () => ({
  createEditTool: vi.fn(() => mockEditTool),
}));
vi.mock("../../../src/tools/builtin/glob.js", () => ({
  createGlobTool: vi.fn(() => mockGlobTool),
}));
vi.mock("../../../src/tools/builtin/grep.js", () => ({
  createGrepTool: vi.fn(() => mockGrepTool),
}));
vi.mock("../../../src/tools/builtin/read.js", () => ({
  createReadTool: vi.fn(() => mockReadFileTool),
}));
vi.mock("../../../src/tools/builtin/self.js", () => ({
  createSelfTool: vi.fn(() => mockSelfTool),
  runtimeState: {},
}));
vi.mock("../../../src/tools/builtin/video-extract.js", () => ({
  createVideoExtractTool: vi.fn(() => mockVideoExtractTool),
}));
vi.mock("../../../src/tools/builtin/web.js", () => ({
  createWebFetchTool: vi.fn(() => mockWebFetchTool),
  createWebSearchTool: vi.fn(() => mockWebSearchTool),
}));
vi.mock("../../../src/tools/builtin/write.js", () => ({
  createWriteTool: vi.fn(() => mockWriteTool),
}));

// ── Minimal SecurityLayer stub ─────────────────────────────────────────────────

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
    wrapExternal: vi.fn((content: string) => content),
    filterToolsForTrust: vi.fn((tools: unknown[]) => tools),
    checkSelfAccess: vi.fn().mockReturnValue({ decision: "ALLOW", reason: "ok" }),
  } as unknown as SecurityLayer;
}

// ── Minimal deps factory ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<BootstrapDeps> = {}): BootstrapDeps {
  return {
    // Minimal living-field stand-in: the memory tools are field-backed since E-4.
    field: {
      lookUp: () => [],
      recall: () => [],
      nodeById: () => null,
    } as never,
    toolRegistry: {
      register: vi.fn(),
      unregister: vi.fn(),
      get: vi.fn(),
      getDefinitions: vi.fn().mockReturnValue([]),
      getAll: vi.fn().mockReturnValue([]),
      getCapabilityManifests: vi.fn().mockReturnValue([]),
      setHidden: vi.fn(),
      promote: vi.fn().mockReturnValue([]),
      tickTTL: vi.fn(),
      searchHidden: vi.fn().mockReturnValue([]),
      searchCapabilities: vi.fn().mockReturnValue([]),
      getVisibilityVersion: vi.fn().mockReturnValue(0),
      visibleCount: vi.fn().mockReturnValue(0),
      hiddenCount: vi.fn().mockReturnValue(0),
    },
    cronService: {
      addJob: vi.fn(),
      removeJob: vi.fn(),
      enableJob: vi.fn(),
      disableJob: vi.fn(),
      listJobs: vi.fn().mockReturnValue([]),
      getJob: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onComplete: vi.fn(), stats: () => ({ edits: 0, forbidden: 0, ungrounded: 0, integrityAlerts: 0 }),
      hasDueJobs: vi.fn().mockReturnValue(false),
    } as never,
    security: makeSecurityLayer(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("bootstrapAgent — service startup", () => {


  it("registers memory_search tool via toolRegistry.register()", () => {
    const deps = makeDeps();
    bootstrapAgent(deps);
    const registered = (deps.toolRegistry.register as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { name: string }).name
    );
    expect(registered).toContain("memory_search");
  });

  it("registers memory_read tool via toolRegistry.register()", () => {
    const deps = makeDeps();
    bootstrapAgent(deps);
    const registered = (deps.toolRegistry.register as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { name: string }).name
    );
    expect(registered).toContain("memory_read");
  });

  it("does not hand a newborn the ability to commit her own future", () => {
    // `cron` used to register unconditionally. She now gets it only once it is opened.
    const deps = makeDeps();
    bootstrapAgent(deps);
    const registered = (deps.toolRegistry.register as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { name: string }).name
    );
    expect(registered).not.toContain("cron");
  });

  it("registers a tool once it has been opened", () => {
    const deps = { ...makeDeps(), toolsOpened: ["web_search"] };
    bootstrapAgent(deps);
    const registered = (deps.toolRegistry.register as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { name: string }).name
    );
    // cron's tool file went with the product catalog (E batch); web stays as a door.
    expect(registered).toContain("web_search");
  });

  it("registers message tool via toolRegistry.register()", () => {
    const deps = makeDeps();
    bootstrapAgent(deps);
    const registered = (deps.toolRegistry.register as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { name: string }).name
    );
    expect(registered).toContain("message");
  });



  it("registers her hands, her voice, and her own past, and nothing else", () => {
    // She was born holding seventeen tools plus a routing policy: the kit of a senior
    // operator, handed to something that had not lived a day. Two reasons it changed, and
    // they are separate. The internet swamps an inner life designed to grow from her own
    // moments. And a toolbelt is a POSTURE: measured, prompt work did not move her stance,
    // and she wrote a 14,000-character essay on a peremptory demand because she was holding
    // `write` and a dispatch policy. See life/birth-toolkit.ts.
    const deps = makeDeps();
    bootstrapAgent(deps);
    const registered = (deps.toolRegistry.register as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { name: string }).name
    );
    for (const hand of ["read", "write", "edit", "delete", "glob", "grep", "undo", "message"]) {
      expect(registered, `she cannot ${hand}`).toContain(hand);
    }
    for (const withheld of [
      "bash", "web_search", "web_fetch", "browser_read", "browser_capture", "artifact_fetch",
      "video_extract", "document_extract", "opencli_query", "weather", "currency_convert",
      "places_lookup", "self", "cron", "search_tools", "resource_update",
    ]) {
      expect(registered, `a newborn was handed ${withheld}`).not.toContain(withheld);
    }
  });

  it("registers builtins before memory/cron/message tools (alphabetical first)", () => {
    const deps = makeDeps();
    bootstrapAgent(deps);
    const registered = (deps.toolRegistry.register as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { name: string }).name
    );
    // `bash` was the marker here and she no longer holds it; `read` is a hand she keeps.
    const readIdx = registered.indexOf("read");
    const memoryIdx = registered.indexOf("memory_search");
    expect(readIdx).toBeGreaterThanOrEqual(0);
    expect(memoryIdx).toBeGreaterThanOrEqual(0);
    expect(readIdx).toBeLessThan(memoryIdx);
  });

  it("returns security layer in BootstrapResult", () => {
    const security = makeSecurityLayer();
    const deps = makeDeps({ security });
    const result = bootstrapAgent(deps);
    expect(result.security).toBe(security);
  });
});

describe("bootstrapAgent — shutdown", () => {
  it("returns a shutdown function", () => {
    const deps = makeDeps();
    const result = bootstrapAgent(deps);
    expect(typeof result.shutdown).toBe("function");
  });



  it("AC — shutdown() calls embeddingsService.close() when provided", () => {
    const close = vi.fn();
    const deps = makeDeps({ embeddingsService: { close } });
    const { shutdown } = bootstrapAgent(deps);
    shutdown();
    expect(close).toHaveBeenCalledOnce();
  });

  it("AC — shutdown() does not throw when embeddingsService is absent (optional)", () => {
    const deps = makeDeps(); // no embeddingsService
    const { shutdown } = bootstrapAgent(deps);
    expect(() => shutdown()).not.toThrow();
  });

  it("shutdown() survives embeddingsService.close() throwing (fail-safe)", () => {
    const close = vi.fn().mockImplementation(() => { throw new Error("close failed"); });
    const deps = makeDeps({ embeddingsService: { close } });
    const { shutdown } = bootstrapAgent(deps);
    expect(() => shutdown()).not.toThrow();
    expect(close).toHaveBeenCalledOnce();
  });
});

// ── Delegate tool wiring ──────────────────────────────────────────────────────

/** A child loop that returns immediately. Shared so the three call sites cannot drift. */
// eslint-disable-next-line require-yield
const stubLoopFactory = async function* (_spec: unknown) {
  return { content: "", usage: { inputTokens: 0, outputTokens: 0 }, iterations: 0, finishReason: "stop" as const };
};

