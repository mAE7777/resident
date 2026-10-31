import { describe, expect, it, vi, beforeEach } from "vitest";

const createMock = vi.fn();
const streamMock = vi.fn();
const constructorMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = { create: createMock, stream: streamMock };
    constructor(opts: unknown) {
      constructorMock(opts);
    }
  }
  return { default: MockAnthropic };
});

import { createAnthropicProvider } from "../../../src/providers/anthropic.js";

beforeEach(() => {
  createMock.mockReset();
  streamMock.mockReset();
  constructorMock.mockReset();
  createMock.mockResolvedValue({
    id: "msg_1",
    content: [{ type: "text", text: "ok", citations: null }],
    model: "claude-opus-4-7",
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 2 },
  });
  streamMock.mockReturnValue({
    // The stall guard subscribes and may abort; a fake stream without these is a stream from
    // before the guard existed.
    on: vi.fn(),
    abort: vi.fn(),
    finalMessage: vi.fn().mockResolvedValue({
      id: "msg_stream",
      content: [{ type: "text", text: "streamed", citations: null }],
      model: "claude-sonnet-4-6",
      stop_reason: "end_turn",
      usage: { input_tokens: 3, output_tokens: 4 },
    }),
  });
});

describe("createAnthropicProvider", () => {
  it("passes custom baseURL into SDK constructor", async () => {
    const provider = createAnthropicProvider("key", { baseURL: "https://proxy.example.com" });
    await provider.complete({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 100,
    });

    expect(constructorMock).toHaveBeenCalledWith({
      apiKey: "key", baseURL: "https://proxy.example.com",
      // Bounded, finally: explicit timeout, and the SDK's own retries off because
      // the chain's retry layer owns retries and the two multiplied into ~30 silent minutes.
      timeout: 120_000, maxRetries: 0,
    });
  });

  it("enables adaptive thinking and omits temperature for Opus 4.7", async () => {
    const provider = createAnthropicProvider("key");
    await provider.complete({
      model: "claude-opus-4-7",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 1000,
      temperature: 0.2,
    });

    const params = createMock.mock.calls[0][0];
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.output_config).toEqual({ effort: "high" });
    expect(params.temperature).toBeUndefined();
  });

  it("does not serialize thinking blocks as user-facing JSON text", async () => {
    createMock.mockResolvedValue({
      id: "msg_2",
      content: [{ type: "thinking", thinking: "private reasoning", signature: "sig" }],
      model: "claude-opus-4-7",
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 2 },
    });
    const provider = createAnthropicProvider("key");

    const response = await provider.complete({
      model: "claude-opus-4-7",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 1000,
    });

    expect(response.content[0]).toEqual({
      type: "thinking",
      thinking: "private reasoning",
      signature: "sig",
    });
  });

  it("uses streaming internally for high-token requests to avoid long-request SDK failures", async () => {
    const provider = createAnthropicProvider("key");

    const response = await provider.complete({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "write a long report" }],
      maxTokens: 64_000,
    });

    expect(createMock).not.toHaveBeenCalled();
    expect(streamMock).toHaveBeenCalledWith(expect.objectContaining({
      model: "claude-sonnet-4-6",
      max_tokens: 64_000,
    }));
    expect(response.content[0]).toEqual({ type: "text", text: "streamed" });
    expect(response.usage).toEqual({ inputTokens: 3, outputTokens: 4 });
  });

  it("counts system and tool payload size when deciding to stream", async () => {
    const provider = createAnthropicProvider("key");

    await provider.complete({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "use the available tools" }],
      maxTokens: 4096,
      system: "x".repeat(51_000),
      tools: [
        {
          name: "large_tool",
          description: "large schema",
          input_schema: { type: "object", properties: { value: { type: "string" } } },
        },
      ],
    });

    expect(createMock).not.toHaveBeenCalled();
    expect(streamMock).toHaveBeenCalled();
  });
});
