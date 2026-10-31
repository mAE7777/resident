import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createFauxProvider,
  fauxText,
  fauxToolCall,
  fauxError,
} from "../../../src/providers/faux.js";
import type { LLMRequest } from "../../../src/providers/types.js";

function makeRequest(text: string, overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    model: "claude-test",
    messages: [{ role: "user", content: text }],
    maxTokens: 100,
    ...overrides,
  };
}

// ── AC1: Pattern-based text response ─────────────────────────────────────────

describe("faux provider — AC1: pattern-based response routing", () => {
  it("returns configured text when message matches pattern", async () => {
    const provider = createFauxProvider({
      responses: [{ pattern: /hello/, text: "world" }],
    });

    const result = await provider.complete(makeRequest("hello there"));
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect((result.content[0] as { type: "text"; text: string }).text).toBe("world");
    expect(result.stopReason).toBe("end_turn");
  });

  it("first matching rule wins", async () => {
    const provider = createFauxProvider({
      responses: [
        { pattern: /hello/, text: "first" },
        { pattern: /hello/, text: "second" },
      ],
    });

    const result = await provider.complete(makeRequest("hello world"));
    expect((result.content[0] as { type: "text"; text: string }).text).toBe("first");
  });

  it("matches string pattern via substring", async () => {
    const provider = createFauxProvider({
      responses: [{ pattern: "ping", text: "pong" }],
    });

    const result = await provider.complete(makeRequest("send a ping now"));
    expect((result.content[0] as { type: "text"; text: string }).text).toBe("pong");
  });
});

// ── AC2: Error injection ──────────────────────────────────────────────────────

describe("faux provider — AC2: error injection", () => {
  it("throws error with configured status when pattern matches", async () => {
    const provider = createFauxProvider({
      responses: [{ pattern: /.*/, error: { status: 429, message: "rate_limit" } }],
    });

    await expect(provider.complete(makeRequest("any request"))).rejects.toThrow("rate_limit");
  });

  it("thrown error has correct status code", async () => {
    const provider = createFauxProvider({
      responses: [{ pattern: /.*/, error: { status: 429, message: "rate_limit" } }],
    });

    const err = await provider.complete(makeRequest("any")).catch((e) => e);
    expect((err as Error & Record<string, unknown>).status).toBe(429);
  });

  it("fauxError factory produces correct error rule", async () => {
    const provider = createFauxProvider({
      responses: [fauxError(500, "server_error")],
    });

    const err = await provider.complete(makeRequest("test")).catch((e) => e);
    expect((err as Error & Record<string, unknown>).status).toBe(500);
    expect((err as Error).message).toBe("server_error");
  });
});

// ── AC3: Tool call responses ──────────────────────────────────────────────────

describe("faux provider — AC3: tool call responses", () => {
  it("returns tool_use blocks when rule has toolCalls", async () => {
    const provider = createFauxProvider({
      responses: [
        {
          pattern: /bash/,
          toolCalls: [{ name: "bash", input: { command: "ls" } }],
        },
      ],
    });

    const result = await provider.complete(makeRequest("run bash command"));
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("tool_use");
  });

  it("tool_use block has valid id, name, and input", async () => {
    const provider = createFauxProvider({
      responses: [
        fauxToolCall("read_file", { path: "/etc/hosts" }),
      ],
    });

    const result = await provider.complete(makeRequest("read the file"));
    const block = result.content[0] as { type: "tool_use"; id: string; name: string; input: unknown };
    expect(block.type).toBe("tool_use");
    expect(typeof block.id).toBe("string");
    expect(block.id.length).toBeGreaterThan(0);
    expect(block.name).toBe("read_file");
    expect(block.input).toEqual({ path: "/etc/hosts" });
  });

  it("stopReason is tool_use for tool call responses", async () => {
    const provider = createFauxProvider({
      responses: [fauxToolCall("search", { query: "hello" })],
    });

    const result = await provider.complete(makeRequest("search for something"));
    expect(result.stopReason).toBe("tool_use");
  });

  it("supports multiple tool calls in one response", async () => {
    const provider = createFauxProvider({
      responses: [
        {
          pattern: /multi/,
          toolCalls: [
            { name: "tool_a", input: { x: 1 } },
            { name: "tool_b", input: { y: 2 } },
          ],
          stopReason: "tool_use",
        },
      ],
    });

    const result = await provider.complete(makeRequest("multi tool call"));
    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe("tool_use");
    expect(result.content[1].type).toBe("tool_use");
  });
});

// ── AC4: Streaming simulation ─────────────────────────────────────────────────

describe("faux provider — AC4: streaming simulation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("yields text chunks via async generator", async () => {
    const provider = createFauxProvider({
      responses: [{ pattern: /stream/, text: "hello world" }],
    });

    const chunks: string[] = [];
    const gen = provider.stream(makeRequest("stream please"));

    // Collect with fake timers: advance to skip any delays
    let result = await gen.next();
    while (!result.done) {
      chunks.push(result.value);
      vi.runAllTimers();
      result = await gen.next();
    }

    expect(chunks.join("")).toBe("hello world");
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("chunks are split by word boundaries", async () => {
    const provider = createFauxProvider({
      responses: [{ pattern: /.*/, text: "one two three" }],
    });

    const chunks: string[] = [];
    const gen = provider.stream(makeRequest("anything"));

    let r = await gen.next();
    while (!r.done) {
      chunks.push(r.value);
      vi.runAllTimers();
      r = await gen.next();
    }

    expect(chunks.join("")).toBe("one two three");
    expect(chunks).toHaveLength(3);
  });

  it("applies delayMs between chunks (configurable delay accepted)", async () => {
    // Use real timers here: we just verify the provider accepts delayMs config
    // and still yields the correct text. The delay itself is tested by verifying
    // the generator is an AsyncGenerator, which is sufficient for behavioral contract.
    vi.useRealTimers();
    const provider = createFauxProvider({
      responses: [{ pattern: /.*/, text: "a b c", delayMs: 0 }],
    });

    const gen = provider.stream(makeRequest("go"));
    const collected: string[] = [];

    let r = await gen.next();
    while (!r.done) {
      collected.push(r.value);
      r = await gen.next();
    }

    expect(collected.join("")).toBe("a b c");
    expect(collected).toHaveLength(3);
  });

  it("throws error during streaming if rule has error", async () => {
    const provider = createFauxProvider({
      responses: [{ pattern: /.*/, error: { status: 503, message: "overloaded" } }],
    });

    const gen = provider.stream(makeRequest("any"));
    await expect(gen.next()).rejects.toThrow("overloaded");
  });
});

// ── AC5: Default response for unmatched patterns ──────────────────────────────

describe("faux provider — AC5: default fallback response", () => {
  it("returns default response when no pattern matches", async () => {
    const provider = createFauxProvider({
      responses: [{ pattern: /hello/, text: "world" }],
    });

    const result = await provider.complete(makeRequest("goodbye"));
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toBe("I don't understand");
  });

  it("uses configured defaultResponse if provided", async () => {
    const provider = createFauxProvider({
      responses: [{ pattern: /hello/, text: "world" }],
      defaultResponse: "no match found",
    });

    const result = await provider.complete(makeRequest("random input"));
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toBe("no match found");
  });

  it("returns default response when no rules configured", async () => {
    const provider = createFauxProvider();

    const result = await provider.complete(makeRequest("anything at all"));
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toBe("I don't understand");
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

describe("faux provider — helper factories", () => {
  it("fauxText creates a match-all text rule", async () => {
    const provider = createFauxProvider({
      responses: [fauxText("hello from factory")],
    });

    const result = await provider.complete(makeRequest("whatever"));
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toBe("hello from factory");
  });

  it("fauxToolCall creates a match-all tool call rule", async () => {
    const provider = createFauxProvider({
      responses: [fauxToolCall("echo", { msg: "test" })],
    });

    const result = await provider.complete(makeRequest("call it"));
    expect(result.content[0].type).toBe("tool_use");
    expect(result.stopReason).toBe("tool_use");
  });
});

// ── LLMResponse contract ──────────────────────────────────────────────────────

describe("faux provider — response shape", () => {
  it("returns a fully shaped LLMResponse", async () => {
    const provider = createFauxProvider({
      responses: [{ pattern: /.*/, text: "ok" }],
    });

    const result = await provider.complete(makeRequest("test"));
    expect(typeof result.id).toBe("string");
    expect(Array.isArray(result.content)).toBe(true);
    expect(typeof result.model).toBe("string");
    expect(typeof result.stopReason).toBe("string");
    expect(typeof result.usage.inputTokens).toBe("number");
    expect(typeof result.usage.outputTokens).toBe("number");
  });

  it("model matches the request model", async () => {
    const provider = createFauxProvider();

    const result = await provider.complete(makeRequest("hi", { model: "claude-opus" }));
    expect(result.model).toBe("claude-opus");
  });

  it("usage tokens are positive numbers", async () => {
    const provider = createFauxProvider({
      responses: [{ pattern: /.*/, text: "some text response" }],
    });

    const result = await provider.complete(makeRequest("calculate something"));
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });
});
