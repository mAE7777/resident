import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── rotateTraces (isolated unit test via real filesystem) ─────────────────────

describe("rotateTraces — AC: 150 files → delete oldest 50 (keep 100)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "recorder-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("AC: given 150 trace files, deletes oldest 50 to keep 100", async () => {
    // Create 150 .json files with ISO-timestamp-style names (sortable)
    for (let i = 0; i < 150; i++) {
      const pad = String(i).padStart(4, "0");
      writeFileSync(join(tmpDir, `2026-04-25T09-${pad}.json`), "{}");
    }

    let files = readdirSync(tmpDir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(150);

    // Exercise createRecorderLayer by creating a mock LLM interaction
    // The recorder runs fire-and-forget, so we wait for it
    const { createRecorderLayer } = await import("../../../src/providers/recorder.js");
    const layer = createRecorderLayer({ tracesDir: tmpDir, env: "development" });

    const request = {
      model: "test-model",
      messages: [{ role: "user" as const, content: "hello" }],
      maxTokens: 100,
    };
    const response = {
      id: "msg_test",
      content: [{ type: "text" as const, text: "hi" }],
      model: "test-model",
      stopReason: "end_turn" as const,
      usage: { inputTokens: 5, outputTokens: 5 },
    };

    const next = vi.fn().mockResolvedValue(response);
    await layer.call(request, next);

    // Give the fire-and-forget chain time to complete
    await new Promise((resolve) => setTimeout(resolve, 200));

    files = readdirSync(tmpDir).filter((f) => f.endsWith(".json"));
    // 150 original + 1 new trace written, rotation ran after mkdir keeping <=100,
    // then writeFile added 1 more → total should be <=101
    // The rotation sees 150 files and deletes 50, leaving 100, then writes 1 more = 101
    expect(files.length).toBeLessThanOrEqual(101);
    expect(files.length).toBeGreaterThanOrEqual(100);
  }, 10000);

  it("does not delete files when count is at MAX_TRACE_FILES (100)", async () => {
    for (let i = 0; i < 100; i++) {
      const pad = String(i).padStart(4, "0");
      writeFileSync(join(tmpDir, `2026-04-25T09-${pad}.json`), "{}");
    }

    const { createRecorderLayer } = await import("../../../src/providers/recorder.js");
    const layer = createRecorderLayer({ tracesDir: tmpDir, env: "development" });

    const request = {
      model: "test-model",
      messages: [{ role: "user" as const, content: "hello" }],
      maxTokens: 100,
    };
    const response = {
      id: "msg_test2",
      content: [{ type: "text" as const, text: "hi" }],
      model: "test-model",
      stopReason: "end_turn" as const,
      usage: { inputTokens: 5, outputTokens: 5 },
    };

    const next = vi.fn().mockResolvedValue(response);
    await layer.call(request, next);
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Rotation: 100 files seen → no excess → 100 kept + 1 written = 101
    const files = readdirSync(tmpDir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(101);
  }, 10000);

  it("skips recording when env !== 'development'", async () => {
    const { createRecorderLayer } = await import("../../../src/providers/recorder.js");
    const layer = createRecorderLayer({ tracesDir: tmpDir, env: "production" });

    const request = {
      model: "test-model",
      messages: [{ role: "user" as const, content: "hello" }],
      maxTokens: 100,
    };
    const response = {
      id: "msg_prod",
      content: [{ type: "text" as const, text: "hi" }],
      model: "test-model",
      stopReason: "end_turn" as const,
      usage: { inputTokens: 5, outputTokens: 5 },
    };

    const next = vi.fn().mockResolvedValue(response);
    const result = await layer.call(request, next);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // No files should be written
    const files = readdirSync(tmpDir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(0);
    expect(result).toBe(response);
  }, 5000);

  it("redacts secrets from recorded responses as well as requests", async () => {
    const { createRecorderLayer } = await import("../../../src/providers/recorder.js");
    const layer = createRecorderLayer({ tracesDir: tmpDir, env: "development" });

    const request = {
      model: "test-model",
      messages: [{ role: "user" as const, content: "token sk-test-request" }],
      maxTokens: 100,
    };
    const response = {
      id: "msg_secret",
      content: [{ type: "text" as const, text: "token sk-test-response" }],
      model: "test-model",
      stopReason: "end_turn" as const,
      usage: { inputTokens: 5, outputTokens: 5 },
    };

    await layer.call(request, vi.fn().mockResolvedValue(response));
    await new Promise((resolve) => setTimeout(resolve, 200));

    const files = readdirSync(tmpDir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(1);
    const trace = readFileSync(join(tmpDir, files[0]!), "utf8");
    expect(trace).not.toContain("sk-test-request");
    expect(trace).not.toContain("sk-test-response");
    expect(trace).toContain("***");
  }, 5000);

  it("returns the response even when trace writing fails", async () => {
    const { createRecorderLayer } = await import("../../../src/providers/recorder.js");
    // Use a non-writable path to trigger I/O failure
    const layer = createRecorderLayer({ tracesDir: "/nonexistent/deep/path", env: "development" });

    const request = {
      model: "test-model",
      messages: [{ role: "user" as const, content: "hello" }],
      maxTokens: 100,
    };
    const response = {
      id: "msg_nonfatal",
      content: [{ type: "text" as const, text: "hi" }],
      model: "test-model",
      stopReason: "end_turn" as const,
      usage: { inputTokens: 5, outputTokens: 5 },
    };

    const next = vi.fn().mockResolvedValue(response);
    // Must not throw even though the write will fail
    const result = await layer.call(request, next);
    expect(result).toBe(response);
  });
});
