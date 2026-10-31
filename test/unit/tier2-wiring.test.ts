import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDuckDuckGoBackend } from "../../src/tools/builtin/search-backend.js";

// ── DuckDuckGo search backend ───────────────────────────────────────────────

describe("DuckDuckGo search backend", () => {
  it("createDuckDuckGoBackend returns a SearchBackend with search method", () => {
    const backend = createDuckDuckGoBackend();
    expect(backend).toBeDefined();
    expect(typeof backend.search).toBe("function");
  });
});

describe("DuckDuckGo wired as fallback in web.ts", () => {
  it("web.ts imports createDuckDuckGoBackend", () => {
    const content = readFileSync(join(process.cwd(), "src", "tools", "builtin", "web.ts"), "utf8");
    expect(content).toContain("createDuckDuckGoBackend");
    expect(content).toContain("ddgBackend");
  });



});

// ── Memory decay wired in production ────────────────────────────────────────

describe("memory decay wired in production", () => {


  it("sleep.ts still promotes learned stuck candidates on the idle clock", () => {
    const content = readFileSync(join(process.cwd(), "src", "autonomy", "sleep.ts"), "utf8");
    expect(content).toContain("promoteStuckCandidates");
  });
});

describe("stuck pattern learning wired in production", () => {
  it("sqlite.ts creates stuck candidate tables and indexes", () => {
    const content = readFileSync(join(process.cwd(), "src", "db", "sqlite.ts"), "utf8");
    expect(content).toContain("CREATE TABLE IF NOT EXISTS stuck_candidates");
    expect(content).toContain("CREATE TABLE IF NOT EXISTS stuck_candidate_occurrences");
    expect(content).toContain("idx_stuck_candidates_promotion");
  });

  it("index.ts injects db-backed stuck detector into baseSpec", () => {
    const content = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    expect(content).toContain("createStuckDetector({ db, contextKey: resolvedTaskType })");
  });
});

describe("hooks — all 6 wired", () => {
  it("loop.ts calls before_llm, after_llm, before_tool, after_tool", () => {
    const content = readFileSync(join(process.cwd(), "src", "agent", "loop.ts"), "utf8");
    expect(content).toContain('"before_llm"');
    expect(content).toContain('"after_llm"');
    expect(content).toContain('"before_tool"');
    expect(content).toContain('"after_tool"');
  });

  it("message.ts calls before_outbound hook", () => {
    const content = readFileSync(join(process.cwd(), "src", "tools", "builtin", "message.ts"), "utf8");
    expect(content).toContain('"before_outbound"');
  });

  it("index.ts calls on_session hook", () => {
    const content = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    expect(content).toContain('"on_session"');
  });

  it("hookRegistry created before bootstrap (for message tool)", () => {
    const content = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    const hookCreation = content.indexOf("createHookRegistry");
    const bootstrapCall = content.indexOf("bootstrapAgent({");
    // Floors first: with either anchor gone, `-1 < x` passes on nothing and this ordering
    // guard certifies the wiring of two calls that may no longer exist.
    expect(hookCreation, "createHookRegistry is gone — nothing here is being ordered").toBeGreaterThan(-1);
    expect(bootstrapCall, "bootstrapAgent is gone — nothing here is being ordered").toBeGreaterThan(-1);
    expect(hookCreation).toBeLessThan(bootstrapCall);
  });
});
