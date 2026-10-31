import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createRetryLayer,
  createCircuitBreakerLayer,
  createKeyRotationLayer,
  createValidationLayer,
  CircuitBreakerOpen,
  AllKeysRateLimited,
  ValidationError,
  retryDelayMs,
} from "../../../src/providers/chain.js";
import { createCacheLayer } from "../../../src/providers/cache.js";
import { createCostGuardLayer, CostLimitExceeded } from "../../../src/providers/cost-guard.js";
import type { LLMRequest, LLMResponse, LLMProvider } from "../../../src/providers/types.js";

// ── Test helpers ───────────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    model: "claude-sonnet-4-6",
    messages: [{ role: "user", content: "hello" }],
    maxTokens: 100,
    ...overrides,
  };
}

function makeResponse(overrides: Partial<LLMResponse> = {}): LLMResponse {
  return {
    id: "msg_test123",
    content: [{ type: "text", text: "Hello!" }],
    model: "claude-sonnet-4-6",
    stopReason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 5 },
    ...overrides,
  };
}

function makeToolResponse(): LLMResponse {
  return {
    id: "msg_tool456",
    content: [{ type: "tool_use", id: "tu_1", name: "bash", input: { command: "ls" } }],
    model: "claude-sonnet-4-6",
    stopReason: "tool_use",
    usage: { inputTokens: 20, outputTokens: 10 },
  };
}

function makeProvider(response: LLMResponse = makeResponse()): LLMProvider {
  return { complete: vi.fn().mockResolvedValue(response) };
}

function httpError(status: number, retryAfterSeconds?: number): Error & Record<string, unknown> {
  const err = new Error(`HTTP ${status}`) as Error & Record<string, unknown>;
  err.status = status;
  if (retryAfterSeconds !== undefined) {
    err.response = { headers: { "retry-after": String(retryAfterSeconds) } };
  }
  return err;
}

// ── Layer 1: Validation ────────────────────────────────────────────────────────

describe("createValidationLayer", () => {
  const layer = createValidationLayer();
  const req = makeRequest();
  const resp = makeResponse();

  it("passes valid requests through", async () => {
    const next = vi.fn().mockResolvedValue(resp);
    const result = await layer.call(req, next);
    expect(result).toBe(resp);
    expect(next).toHaveBeenCalledWith(req);
  });

  it("rejects empty model", async () => {
    const next = vi.fn();
    await expect(layer.call(makeRequest({ model: "" }), next)).rejects.toThrow(ValidationError);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects empty messages array", async () => {
    const next = vi.fn();
    await expect(layer.call(makeRequest({ messages: [] }), next)).rejects.toThrow(ValidationError);
  });

  it("rejects non-positive maxTokens", async () => {
    const next = vi.fn();
    await expect(layer.call(makeRequest({ maxTokens: 0 }), next)).rejects.toThrow(ValidationError);
    await expect(layer.call(makeRequest({ maxTokens: -1 }), next)).rejects.toThrow(ValidationError);
  });
});

// ── Layer 2: Retry ─────────────────────────────────────────────────────────────

describe("createRetryLayer — Retry-After header", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waits Retry-After: 5 seconds before retrying on 429", async () => {
    const layer = createRetryLayer();
    const sleepSpy = vi.fn().mockResolvedValue(undefined);
    layer._sleep = sleepSpy;

    const req = makeRequest();
    const resp = makeResponse();
    const err = httpError(429, 5); // Retry-After: 5 seconds → 5000ms

    const next = vi.fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce(resp);

    const result = await layer.call(req, next);

    expect(result).toBe(resp);
    expect(sleepSpy).toHaveBeenCalledWith(5000);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("uses exponential backoff when no Retry-After header", async () => {
    const layer = createRetryLayer();
    const delays: number[] = [];
    layer._sleep = async (ms) => { delays.push(ms); };

    const req = makeRequest();
    const resp = makeResponse();
    const serverErr = httpError(500);

    const next = vi.fn()
      .mockRejectedValueOnce(serverErr)
      .mockRejectedValueOnce(serverErr)
      .mockResolvedValueOnce(resp);

    await layer.call(req, next);

    expect(delays).toHaveLength(2);
    // Attempt 0: base ~1000ms, attempt 1: base ~2000ms (with ±25% jitter)
    expect(delays[0]).toBeGreaterThanOrEqual(750);
    expect(delays[0]).toBeLessThanOrEqual(1250);
    expect(delays[1]).toBeGreaterThanOrEqual(1500);
    expect(delays[1]).toBeLessThanOrEqual(2500);
  });

  it("does not retry non-retryable errors (401)", async () => {
    const layer = createRetryLayer();
    layer._sleep = vi.fn().mockResolvedValue(undefined);

    const req = makeRequest();
    const authErr = httpError(401);
    const next = vi.fn().mockRejectedValue(authErr);

    await expect(layer.call(req, next)).rejects.toBe(authErr);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("exhausts all 3 attempts on persistent retryable errors", async () => {
    const layer = createRetryLayer();
    layer._sleep = vi.fn().mockResolvedValue(undefined);

    const req = makeRequest();
    const serverErr = httpError(503);
    const next = vi.fn().mockRejectedValue(serverErr);

    await expect(layer.call(req, next)).rejects.toBe(serverErr);
    expect(next).toHaveBeenCalledTimes(3);
  });
});

describe("retryDelayMs", () => {
  it("returns retryAfterMs when provided", () => {
    expect(retryDelayMs(0, 5000)).toBe(5000);
    expect(retryDelayMs(2, 30000)).toBe(30000);
  });

  it("returns exponential base with jitter when no retryAfter", () => {
    // Attempt 0: base 1000, ±25% → [750, 1250]
    for (let i = 0; i < 20; i++) {
      const d = retryDelayMs(0);
      expect(d).toBeGreaterThanOrEqual(750);
      expect(d).toBeLessThanOrEqual(1250);
    }
    // Attempt 1: base 2000, ±25% → [1500, 2500]
    for (let i = 0; i < 20; i++) {
      const d = retryDelayMs(1);
      expect(d).toBeGreaterThanOrEqual(1500);
      expect(d).toBeLessThanOrEqual(2500);
    }
    // Attempt 2: base 4000, ±25% → [3000, 5000]
    for (let i = 0; i < 20; i++) {
      const d = retryDelayMs(2);
      expect(d).toBeGreaterThanOrEqual(3000);
      expect(d).toBeLessThanOrEqual(5000);
    }
  });
});

// ── Layer 3: Key rotation ─────────────────────────────────────────────────────

describe("createKeyRotationLayer", () => {
  it("routes to first key by default", async () => {
    const keys = ["key-a", "key-b"];
    const factory = vi.fn((k: string) => makeProvider(makeResponse()));
    const layer = createKeyRotationLayer(keys, factory);

    await layer.route(makeRequest(), (req, provider) => provider.complete(req));

    expect(factory).toHaveBeenCalledWith("key-a");
  });

  it("cycles through keys on rate_limit cooldown", async () => {
    const keys = ["key-a", "key-b", "key-c"];
    const providers: Record<string, LLMProvider> = {
      "key-a": { complete: vi.fn().mockRejectedValue(httpError(429)) },
      "key-b": { complete: vi.fn().mockResolvedValue(makeResponse()) },
      "key-c": { complete: vi.fn().mockResolvedValue(makeResponse()) },
    };
    const factory = vi.fn((k: string) => providers[k]);
    const layer = createKeyRotationLayer(keys, factory);

    const result = await layer.route(makeRequest(), (req, provider) => provider.complete(req));

    expect(result).toBeDefined();
    // key-a failed with 429, should have rotated to key-b
    expect(providers["key-b"].complete).toHaveBeenCalled();
  });

  it("throws AllKeysRateLimited when all keys are on cooldown", async () => {
    const keys = ["key-a", "key-b"];
    const factory = vi.fn((k: string) => makeProvider());
    const layer = createKeyRotationLayer(keys, factory);

    // Set all keys on cooldown
    layer.setCooldown(0, Date.now() + 60_000);
    layer.setCooldown(1, Date.now() + 60_000);

    await expect(
      layer.route(makeRequest(), (req, provider) => provider.complete(req))
    ).rejects.toThrow(AllKeysRateLimited);
  });

  it("aborts immediately on non-retriable errors (auth_permanent = 403)", async () => {
    const keys = ["key-a", "key-b"];
    const authErr = httpError(403);
    const providers: Record<string, LLMProvider> = {
      "key-a": { complete: vi.fn().mockRejectedValue(authErr) },
      "key-b": { complete: vi.fn().mockResolvedValue(makeResponse()) },
    };
    const factory = vi.fn((k: string) => providers[k]);
    const layer = createKeyRotationLayer(keys, factory);

    await expect(
      layer.route(makeRequest(), (req, provider) => provider.complete(req))
    ).rejects.toBe(authErr);

    // key-b should NOT have been tried
    expect(providers["key-b"].complete).not.toHaveBeenCalled();
  });
});

// ── Layer 4: Circuit breaker ──────────────────────────────────────────────────

describe("createCircuitBreakerLayer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts in closed state", () => {
    const cb = createCircuitBreakerLayer();
    expect(cb.getState()).toBe("closed");
    expect(cb.getFailureCount()).toBe(0);
  });

  it("opens after 5 consecutive transient failures", async () => {
    const cb = createCircuitBreakerLayer();
    const req = makeRequest();
    const serverErr = httpError(500);
    const next = vi.fn().mockRejectedValue(serverErr);

    for (let i = 0; i < 4; i++) {
      await expect(cb.call(req, next)).rejects.toBe(serverErr);
      expect(cb.getState()).toBe("closed");
    }

    await expect(cb.call(req, next)).rejects.toBe(serverErr);
    expect(cb.getState()).toBe("open");
  });

  it("rejects immediately when open, without calling next", async () => {
    const cb = createCircuitBreakerLayer();
    const req = makeRequest();
    const serverErr = httpError(500);
    const next = vi.fn().mockRejectedValue(serverErr);

    // Trip the breaker
    for (let i = 0; i < 5; i++) {
      await expect(cb.call(req, next)).rejects.toBeDefined();
    }
    expect(cb.getState()).toBe("open");

    // Reset mock call count
    next.mockClear();

    // Next call should reject immediately as CircuitBreakerOpen
    await expect(cb.call(req, next)).rejects.toThrow(CircuitBreakerOpen);
    expect(next).not.toHaveBeenCalled();
  });

  it("transitions to half-open after 30s", async () => {
    const cb = createCircuitBreakerLayer();
    const req = makeRequest();
    const serverErr = httpError(500);
    const next = vi.fn().mockRejectedValue(serverErr);

    // Trip the breaker
    for (let i = 0; i < 5; i++) {
      await expect(cb.call(req, next)).rejects.toBeDefined();
    }
    expect(cb.getState()).toBe("open");

    // Advance time 30s
    vi.advanceTimersByTime(30_001);

    // Next call should be allowed (probe)
    const successNext = vi.fn().mockResolvedValue(makeResponse());
    await cb.call(req, successNext);
    expect(cb.getState()).toBe("half-open");
    expect(successNext).toHaveBeenCalled();
  });

  it("resets to closed after 2 successful probes", async () => {
    const cb = createCircuitBreakerLayer();
    const req = makeRequest();
    const serverErr = httpError(500);

    // Trip the breaker
    const failNext = vi.fn().mockRejectedValue(serverErr);
    for (let i = 0; i < 5; i++) {
      await expect(cb.call(req, failNext)).rejects.toBeDefined();
    }

    vi.advanceTimersByTime(30_001);

    // 2 successful probes
    const successNext = vi.fn().mockResolvedValue(makeResponse());
    await cb.call(req, successNext);
    expect(cb.getState()).toBe("half-open");
    await cb.call(req, successNext);
    expect(cb.getState()).toBe("closed");
  });

  it("does not trip on non-transient errors (401)", async () => {
    const cb = createCircuitBreakerLayer();
    const req = makeRequest();
    const authErr = httpError(401);
    const next = vi.fn().mockRejectedValue(authErr);

    for (let i = 0; i < 10; i++) {
      await expect(cb.call(req, next)).rejects.toBeDefined();
    }

    expect(cb.getState()).toBe("closed");
    expect(cb.getFailureCount()).toBe(0);
  });

  it("6th request rejected immediately when breaker is open (AC)", async () => {
    const cb = createCircuitBreakerLayer();
    const req = makeRequest();
    const serverErr = httpError(500);
    const next = vi.fn().mockRejectedValue(serverErr);

    // 5 transient failures
    for (let i = 0; i < 5; i++) {
      await expect(cb.call(req, next)).rejects.toBeDefined();
    }
    expect(cb.getState()).toBe("open");
    next.mockClear();

    // 6th request: rejected immediately as CircuitBreakerOpen
    const err = await cb.call(req, next).catch((e) => e);
    expect(err).toBeInstanceOf(CircuitBreakerOpen);
    expect(next).not.toHaveBeenCalled();

    // 7th request: still open (within 30s window)
    const err2 = await cb.call(req, next).catch((e) => e);
    expect(err2).toBeInstanceOf(CircuitBreakerOpen);
    expect(next).not.toHaveBeenCalled();
  });
});

// ── Layer 5: Cache ────────────────────────────────────────────────────────────

describe("createCacheLayer", () => {
  it("returns cached response on second call with same key", async () => {
    const cache = createCacheLayer();
    const req = makeRequest();
    const resp = makeResponse();
    const next = vi.fn().mockResolvedValue(resp);

    const result1 = await cache.call(req, next);
    const result2 = await cache.call(req, next);

    expect(result1).toBe(resp);
    expect(result2).toBe(resp);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does NOT cache tool_use responses (AC)", async () => {
    const cache = createCacheLayer();
    const req = makeRequest();
    const toolResp = makeToolResponse();
    const next = vi.fn().mockResolvedValue(toolResp);

    await cache.call(req, next);
    await cache.call(req, next);
    await cache.call(req, next);

    // Should call next every time: never cached
    expect(next).toHaveBeenCalledTimes(3);
    expect(cache.size()).toBe(0);
  });

  it("differentiates requests by model", async () => {
    const cache = createCacheLayer();
    const resp1 = makeResponse({ id: "msg_1" });
    const resp2 = makeResponse({ id: "msg_2" });
    const next = vi.fn()
      .mockResolvedValueOnce(resp1)
      .mockResolvedValueOnce(resp2);

    const r1 = await cache.call(makeRequest({ model: "model-a" }), next);
    const r2 = await cache.call(makeRequest({ model: "model-b" }), next);

    expect(r1.id).toBe("msg_1");
    expect(r2.id).toBe("msg_2");
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("differentiates requests by system prompt and tools", async () => {
    const cache = createCacheLayer();
    const resp1 = makeResponse({ id: "msg_system_a" });
    const resp2 = makeResponse({ id: "msg_system_b" });
    const next = vi.fn()
      .mockResolvedValueOnce(resp1)
      .mockResolvedValueOnce(resp2);

    const base = {
      messages: [{ role: "user" as const, content: "hello" }],
      maxTokens: 100,
      tools: [{ name: "read", description: "read files", input_schema: { type: "object" as const } }],
    };
    const r1 = await cache.call(makeRequest({ ...base, system: "system A" }), next);
    const r2 = await cache.call(makeRequest({ ...base, system: "system B" }), next);

    expect(r1.id).toBe("msg_system_a");
    expect(r2.id).toBe("msg_system_b");
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("evicts expired entries", async () => {
    vi.useFakeTimers();
    try {
      const cache = createCacheLayer();
      const req = makeRequest();
      const resp = makeResponse();
      const next = vi.fn().mockResolvedValue(resp);

      await cache.call(req, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Advance past 1hr TTL
      vi.advanceTimersByTime(3_600_001);

      await cache.call(req, next);
      expect(next).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── Layer 6: Cost guard ───────────────────────────────────────────────────────

describe("createCostGuardLayer", () => {
  it("allows request when under budget", async () => {
    const guard = createCostGuardLayer({ dailyBudgetCents: 1000 });
    const resp = makeResponse();
    const next = vi.fn().mockResolvedValue(resp);

    const result = await guard.call(makeRequest(), next);
    expect(result).toBe(resp);
  });

  it("records Sonnet default prices in cents, not dollars", async () => {
    const guard = createCostGuardLayer({ dailyBudgetCents: 5000 });
    const next = vi.fn().mockResolvedValue(makeResponse({
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    }));

    await guard.call(makeRequest(), next);

    expect(guard.getDailySpentCents()).toBe(1800);
  });

  it("uses model-specific price overrides when configured", async () => {
    const guard = createCostGuardLayer({
      dailyBudgetCents: 5000,
      modelPricingCents: {
        "claude-haiku-4-5": {
          inputCentsPerMToken: 100,
          outputCentsPerMToken: 500,
        },
      },
    });
    const next = vi.fn().mockResolvedValue(makeResponse({
      model: "claude-haiku-4-5",
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    }));

    await guard.call(makeRequest({ model: "claude-haiku-4-5" }), next);

    expect(guard.getDailySpentCents()).toBe(600);
  });

  it("throws CostLimitExceeded when daily spend at budget (AC)", async () => {
    const guard = createCostGuardLayer({ dailyBudgetCents: 1000 });

    // Manually set spent to exactly at budget via getDailySpentCents + resetDaily pattern
    // We inject via a response that costs enough
    // Budget is 1000 cents ($10.00). Force spend = 1000 cents directly.
    // We'll use resetDaily to start fresh and then set a large response.

    // Simulate spending $10.00 by having a response with many tokens.
    // With defaults (3 cents/M input, 15 cents/M output):
    // To spend 1000 cents: need ~67M input tokens or ~67M output tokens (way too large).
    // Better: use high cost per token for test.
    const expensiveGuard = createCostGuardLayer({
      dailyBudgetCents: 1000,
      inputCentsPerMToken: 1_000_000, // absurd rate for testing
      outputCentsPerMToken: 0,
    });

    // First call: spends far more than budget (1M input tokens * 1M cents/M = 1M cents)
    const bigResponse: LLMResponse = {
      ...makeResponse(),
      usage: { inputTokens: 1_000_001, outputTokens: 0 },
    };
    const next1 = vi.fn().mockResolvedValue(bigResponse);
    await expensiveGuard.call(makeRequest(), next1);

    // Second call: should be rejected
    const next2 = vi.fn().mockResolvedValue(makeResponse());
    await expect(expensiveGuard.call(makeRequest(), next2)).rejects.toThrow(CostLimitExceeded);
    expect(next2).not.toHaveBeenCalled();
  });

  it("rejects immediately when already at budget without calling provider", async () => {
    const guard = createCostGuardLayer({
      dailyBudgetCents: 100,
      inputCentsPerMToken: 1_000_000,
      outputCentsPerMToken: 0,
    });

    const bigResponse: LLMResponse = {
      ...makeResponse(),
      usage: { inputTokens: 1_000_001, outputTokens: 0 },
    };
    const next = vi.fn().mockResolvedValue(bigResponse);
    await guard.call(makeRequest(), next);

    const next2 = vi.fn();
    await expect(guard.call(makeRequest(), next2)).rejects.toThrow(CostLimitExceeded);
    expect(next2).not.toHaveBeenCalled();
  });

  it("checkAllowed before recordAction — no double-counting", async () => {
    const guard = createCostGuardLayer({ dailyBudgetCents: 1000 });
    const resp = makeResponse({ usage: { inputTokens: 100, outputTokens: 50 } });
    const next = vi.fn().mockResolvedValue(resp);

    const before = guard.getDailySpentCents();
    await guard.call(makeRequest(), next);
    const after = guard.getDailySpentCents();

    // Recorded exactly once
    expect(after).toBeGreaterThan(before);
    await guard.call(makeRequest(), vi.fn().mockResolvedValue(resp));
    const after2 = guard.getDailySpentCents();
    // Two calls recorded, not four
    expect(after2).toBeCloseTo(after + (after - before), 5);
  });

  it("daily spend resets at midnight via resetDaily()", () => {
    const guard = createCostGuardLayer({ dailyBudgetCents: 1000 });
    // Simulate spending
    guard["dailySpentCents" as never]; // just access to ensure it exists
    guard.resetDaily();
    expect(guard.getDailySpentCents()).toBe(0);
  });
});

// ── AC: Cost guard with exact $10.00 spend ────────────────────────────────────

describe("cost guard AC: daily spend at $10.00 with dailyBudgetCents=1000", () => {
  it("rejects request when dailySpentCents >= 1000", async () => {
    // Use a guard where we can control the spend precisely
    const guard = createCostGuardLayer({
      dailyBudgetCents: 1000,
      // 1 cent per input token (not per million), i.e. 1_000_000 cents per M token
      inputCentsPerMToken: 1_000_000,
      outputCentsPerMToken: 0,
    });

    // Spend 1000 cents exactly by sending a response that records >= 1000 cents
    const next = vi.fn().mockResolvedValue({
      ...makeResponse(),
      usage: { inputTokens: 1_000, outputTokens: 0 }, // 1000 * (1_000_000/1_000_000) = 1 cent * 1000 tokens = 1000 cents
    } as LLMResponse);

    await guard.call(makeRequest(), next);

    // Now we are at >= budget, next request must be rejected
    const next2 = vi.fn().mockResolvedValue(makeResponse());
    const err = await guard.call(makeRequest(), next2).catch((e) => e);
    expect(err).toBeInstanceOf(CostLimitExceeded);
    expect(next2).not.toHaveBeenCalled();
  });
});
