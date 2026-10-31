// Provider chain: 7-layer decorator chain around the Anthropic base provider.
//
// Layer order (outermost → innermost → base provider):
//   1. Input validation   , rejects malformed requests immediately
//   2. Retry              , exponential backoff, Retry-After header, 3 attempts
//   3. Key rotation       , round-robin API keys, per-key rate-limit cooldown
//   4. Circuit breaker    , 5 failures → open 30s → half-open → 2 probes → closed
//   5. Cache              , SHA-256 key, LRU 1000, 1hr TTL, never caches tool_use
//   6. Cost guard         , daily budget check before, record after
//   7. Recording          , dev-only JSON trace files
//      └── base provider  : actual Anthropic SDK call

import type { Diagnostic, DiagnosticResult } from "../types/diagnostic.js";
import type { LLMProvider, LLMRequest, LLMResponse, ProviderLayer } from "./types.js";
import { classifyError } from "./errors.js";
import { createCacheLayer } from "./cache.js";
import { createCostGuardLayer } from "./cost-guard.js";
export { CostLimitExceeded } from "./cost-guard.js";
import { createRecorderLayer } from "./recorder.js";
import { defaultTracesDir } from "../config/home.js";

// ── Custom errors ─────────────────────────────────────────────────────────────

export class CircuitBreakerOpen extends Error {
  constructor(public readonly openUntilMs: number) {
    super(`Circuit breaker is open until ${new Date(openUntilMs).toISOString()}`);
    this.name = "CircuitBreakerOpen";
  }
}

export class AllKeysRateLimited extends Error {
  constructor() {
    super("All API keys are rate-limited");
    this.name = "AllKeysRateLimited";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// CostLimitExceeded re-exported from import section above

// ── Config ────────────────────────────────────────────────────────────────────

export interface ProviderChainConfig {
  apiKeys: string[];
  env?: string;
  tracesDir?: string;
  dailyBudgetCents?: number;
  rateLimitRpm?: number;
  inputCentsPerMToken?: number;
  outputCentsPerMToken?: number;
  modelPricingCents?: Record<string, {
    inputCentsPerMToken: number;
    outputCentsPerMToken: number;
  }>;
  costEMA?: import("./cost-ema.js").CostEMA;
  budgetEnvelope?: import("./budget-cascade.js").BudgetEnvelope;
  metabolism?: import("../life/metabolism.js").Metabolism;
  /** Effort (vigor) a completed call cost her. Her metabolism is denominated in effort, not money. */
  vigorForResponse?: (response: import("./types.js").LLMResponse) => number;
}

export function createRateLimitLayer(rpm: number): ProviderLayer {
  const timestamps: number[] = [];
  const windowMs = 60_000;

  return {
    async call(request, next) {
      const now = Date.now();
      while (timestamps.length > 0 && now - timestamps[0] >= windowMs) {
        timestamps.shift();
      }
      if (timestamps.length >= rpm) {
        const waitMs = windowMs - (now - timestamps[0]);
        await new Promise((resolve) => setTimeout(resolve, Math.max(1, waitMs)));
      }
      timestamps.push(Date.now());
      return next(request);
    },
  };
}

// ── Layer 1: Input validation ─────────────────────────────────────────────────

export function createValidationLayer(): ProviderLayer {
  return {
    async call(request, next) {
      if (!request.model || request.model.trim() === "") {
        throw new ValidationError("model is required");
      }
      if (!Array.isArray(request.messages) || request.messages.length === 0) {
        throw new ValidationError("messages array must be non-empty");
      }
      if (!Number.isInteger(request.maxTokens) || request.maxTokens <= 0) {
        throw new ValidationError("maxTokens must be a positive integer");
      }
      return next(request);
    },
  };
}

// ── Layer 2: Retry with exponential backoff ───────────────────────────────────
// Delays: [1s, 2s, 4s], ±25% jitter, 3 max attempts.
// Respects Retry-After header value (via classifyError, already in ms).

const RETRY_BASE_MS = 1000;
const RETRY_MULTIPLIER = 2;
const RETRY_JITTER = 0.25;
const MAX_ATTEMPTS = 3;

export function retryDelayMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    return retryAfterMs;
  }
  const base = RETRY_BASE_MS * Math.pow(RETRY_MULTIPLIER, attempt);
  const jitter = base * RETRY_JITTER * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

export interface RetryLayer extends ProviderLayer {
  _sleep?: (ms: number) => Promise<void>;
}

export function createRetryLayer(): RetryLayer {
  const layer: RetryLayer = {
    async call(request, next) {
      const sleep =
        layer._sleep ??
        ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
      let lastError: unknown;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          return await next(request);
        } catch (err) {
          const classified = classifyError(err);
          lastError = err;

          // Context/payload errors need the agent loop's task-aware compression
          // path, not generic provider retries against the same oversized request.
          if (classified.shouldCompress) {
            throw err;
          }

          if (!classified.retryable) {
            throw err;
          }

          if (attempt < MAX_ATTEMPTS - 1) {
            const delay = retryDelayMs(attempt, classified.retryAfter);
            await sleep(delay);
          }
        }
      }

      throw lastError;
    },
  };
  return layer;
}

// ── Layer 3: Key rotation ────────────────────────────────────────────────────
// Round-robin through apiKeys. Per-key cooldown on rate_limit after retry exhaustion.
// Non-retriable errors (format_error, context_overflow, auth_permanent) abort immediately.

const NON_RETRIABLE_ABORT_REASONS = new Set([
  "format_error",
  "context_overflow",
  "auth_permanent",
]);

export interface KeyRotationLayer {
  // Calls innerChain(request, provider) using the selected key's provider.
  // On rate_limit, sets cooldown and tries next key.
  route(
    request: LLMRequest,
    innerChain: (req: LLMRequest, provider: LLMProvider) => Promise<LLMResponse>
  ): Promise<LLMResponse>;
  currentKeyIndex(): number;
  setCooldown(index: number, untilMs: number): void;
}

export function createKeyRotationLayer(
  apiKeys: string[],
  providerFactory: (apiKey: string) => LLMProvider
): KeyRotationLayer {
  const cooldowns = new Map<number, number>();
  let currentIndex = 0;

  function nextAvailableIndex(startFrom: number): number | null {
    const now = Date.now();
    const n = apiKeys.length;
    for (let i = 0; i < n; i++) {
      const idx = (startFrom + i) % n;
      const cooldownUntil = cooldowns.get(idx) ?? 0;
      if (now >= cooldownUntil) {
        return idx;
      }
    }
    return null;
  }

  return {
    async route(request, innerChain) {
      const idx = nextAvailableIndex(currentIndex);
      if (idx === null) {
        throw new AllKeysRateLimited();
      }

      currentIndex = idx;
      const provider = providerFactory(apiKeys[idx]);

      try {
        return await innerChain(request, provider);
      } catch (err) {
        const classified = classifyError(err);

        if (NON_RETRIABLE_ABORT_REASONS.has(classified.reason)) {
          throw err;
        }

        if (classified.reason === "rate_limit") {
          const cooldown = classified.retryAfter ?? 60_000;
          cooldowns.set(currentIndex, Date.now() + cooldown);

          const nextIdx = nextAvailableIndex(currentIndex + 1);
          if (nextIdx === null) {
            throw new AllKeysRateLimited();
          }
          currentIndex = nextIdx;
          const nextProvider = providerFactory(apiKeys[nextIdx]);
          return innerChain(request, nextProvider);
        }

        throw err;
      }
    },

    currentKeyIndex() {
      return currentIndex;
    },

    setCooldown(index, untilMs) {
      cooldowns.set(index, untilMs);
    },
  };
}

// ── Layer 4: Circuit breaker ─────────────────────────────────────────────────
// Closed → Open (5 transient failures) → HalfOpen (30s) → Closed (2 probes).
// Only errors with tripBreaker=true increment failure count.

const FAILURE_THRESHOLD = 5;
const OPEN_DURATION_MS = 30_000;
const PROBE_SUCCESS_THRESHOLD = 2;

type BreakerState = "closed" | "open" | "half-open";

export interface CircuitBreakerLayer extends ProviderLayer {
  getState(): BreakerState;
  getFailureCount(): number;
}

export function createCircuitBreakerLayer(): CircuitBreakerLayer {
  let state: BreakerState = "closed";
  let failureCount = 0;
  let openUntilMs = 0;
  let probeSuccessCount = 0;

  function trip(): void {
    state = "open";
    openUntilMs = Date.now() + OPEN_DURATION_MS;
    failureCount = 0;
    probeSuccessCount = 0;
  }

  function reset(): void {
    state = "closed";
    failureCount = 0;
    openUntilMs = 0;
    probeSuccessCount = 0;
  }

  return {
    async call(request, next) {
      const now = Date.now();

      if (state === "open") {
        if (now < openUntilMs) {
          throw new CircuitBreakerOpen(openUntilMs);
        }
        // Timeout expired: transition to half-open for probe
        state = "half-open";
        probeSuccessCount = 0;
      }

      try {
        const response = await next(request);

        if (state === "half-open") {
          probeSuccessCount++;
          if (probeSuccessCount >= PROBE_SUCCESS_THRESHOLD) {
            reset();
          }
        } else {
          failureCount = 0;
        }

        return response;
      } catch (err) {
        const classified = classifyError(err);

        if (classified.tripBreaker) {
          if (state === "half-open") {
            trip();
          } else {
            failureCount++;
            if (failureCount >= FAILURE_THRESHOLD) {
              trip();
            }
          }
        }

        throw err;
      }
    },

    getState() {
      return state;
    },

    getFailureCount() {
      return failureCount;
    },
  };
}

// ── Chain builder ─────────────────────────────────────────────────────────────

export interface BuiltChain {
  provider: LLMProvider;
  circuitBreaker: CircuitBreakerLayer;
  retryLayer: RetryLayer;
  keyRotation: KeyRotationLayer;
  costGuard: { getDailySpentCents(): number };
}

export function buildProviderChain(
  config: ProviderChainConfig,
  providerFactory: (apiKey: string) => LLMProvider
): DiagnosticResult<BuiltChain> {
  const diagnostics: Diagnostic[] = [];

  if (config.apiKeys.length === 0) {
    diagnostics.push({
      level: "warning",
      message: "no API keys configured — provider chain will fail on use",
      source: "providers",
    });
  }

  const validationLayer = createValidationLayer();
  const retryLayer = createRetryLayer();
  const rateLimitLayer = createRateLimitLayer(config.rateLimitRpm ?? 60);
  const keyRotationLayer = createKeyRotationLayer(config.apiKeys, providerFactory);
  const circuitBreakerLayer = createCircuitBreakerLayer();
  const cacheLayer = createCacheLayer();
  const costGuardLayer = createCostGuardLayer({
    dailyBudgetCents: config.dailyBudgetCents ?? 1000,
    inputCentsPerMToken: config.inputCentsPerMToken,
    outputCentsPerMToken: config.outputCentsPerMToken,
      modelPricingCents: config.modelPricingCents,
      costEMA: config.costEMA,
      budgetEnvelope: config.budgetEnvelope,
      metabolism: config.metabolism,
      vigorForResponse: config.vigorForResponse,
    });
  const recorderLayer = createRecorderLayer({
    tracesDir: config.tracesDir ?? defaultTracesDir(),
    env: config.env ?? "development",
  });

  // Inner chain: circuit-breaker → cache → cost-guard → recorder → provider
  function runInnerChain(
    request: LLMRequest,
    base: LLMProvider
  ): Promise<LLMResponse> {
    return circuitBreakerLayer.call(request, (req) =>
      cacheLayer.call(req, (req2) =>
        costGuardLayer.call(req2, (req3) =>
          recorderLayer.call(req3, (req4) => base.complete(req4))
        )
      )
    );
  }

  const provider: LLMProvider = {
    complete(request) {
      return validationLayer.call(request, (req) =>
        rateLimitLayer.call(req, (req1) =>
          retryLayer.call(req1, (req2) =>
            keyRotationLayer.route(req2, (req3, base) =>
              runInnerChain(req3, base)
            )
          )
        )
      );
    },
  };

  diagnostics.push({
    level: "info",
    message: `provider chain initialized: ${config.apiKeys.length} key(s), budget ${config.dailyBudgetCents ?? 1000} cents/day`,
    source: "providers",
  });

  return {
    result: {
      provider,
      circuitBreaker: circuitBreakerLayer,
      retryLayer,
      keyRotation: keyRotationLayer,
      costGuard: costGuardLayer,
    },
    diagnostics,
  };
}

// Re-export layer factories and types for direct use in tests
export { createCacheLayer } from "./cache.js";
export { createCostGuardLayer } from "./cost-guard.js";
export { createRecorderLayer } from "./recorder.js";
