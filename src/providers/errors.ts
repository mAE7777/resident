// Error taxonomy and 7-stage classification pipeline for API failures.
// Drives retry, circuit-breaker, and credential rotation decisions.
// Ported from Hermes error_classifier.py + PicoClaw error_classifier.go.

export type FailureReason =
  | "auth"
  | "auth_permanent"
  | "billing"
  | "rate_limit"
  | "overloaded"
  | "server_error"
  | "timeout"
  | "context_overflow"
  | "payload_too_large"
  | "model_not_found"
  | "format_error"
  | "thinking_signature"
  | "unknown";

export interface ClassifiedError {
  reason: FailureReason;
  retryable: boolean;
  tripBreaker: boolean;
  shouldCompress: boolean;
  retryAfter?: number;
}

// Only transient errors trip the circuit breaker.
const BREAKER_REASONS = new Set<FailureReason>([
  "rate_limit",
  "overloaded",
  "server_error",
  "timeout",
]);

function classified(
  reason: FailureReason,
  retryable: boolean,
  extras: Partial<Omit<ClassifiedError, "reason" | "retryable" | "tripBreaker">> = {}
): ClassifiedError {
  return {
    reason,
    retryable,
    tripBreaker: BREAKER_REASONS.has(reason),
    shouldCompress: extras.shouldCompress ?? false,
    ...(extras.retryAfter !== undefined ? { retryAfter: extras.retryAfter } : {}),
  };
}

// ── Pattern sets (from PicoClaw error_classifier.go) ─────────────────────

const rateLimitPatterns = [
  "rate limit",
  "rate_limit",
  "too many requests",
  "429",
  "exceeded your current quota",
  "exceeded quota",
  "resource_exhausted",
  "resource has been exhausted",
  "rate-limited",
  "ratelimit",
  "quota exceeded",
  "usage limit",
  "throttled",
  "requests per minute",
  "tokens per minute",
  "requests per day",
  "try again in",
  "please retry after",
  "rate increased too quickly",
  "throttlingexception",
  "too many concurrent requests",
  "servicequotaexceededexception",
];

const overloadedPatterns = [
  "overloaded_error",
  "server_overloaded",
  "overloaded",
  "503",
];

const timeoutPatterns = [
  "timeout",
  "timed out",
  "deadline exceeded",
  "context deadline exceeded",
];

const billingPatterns = [
  "insufficient credits",
  "insufficient_quota",
  "credit balance",
  "credits have been exhausted",
  "top up your credits",
  "payment required",
  "billing hard limit",
  "exceeded your current quota",
  "account is deactivated",
  "plan does not include",
  "billing",
  "payment",
  "insufficient funds",
  "plans & billing",
  "insufficient balance",
];

const authPatterns = [
  "invalid api key",
  "invalid_api_key",
  "incorrect api key",
  "invalid token",
  "authentication",
  "re-authenticate",
  "oauth token refresh failed",
  "unauthorized",
  "forbidden",
  "access denied",
  "expired",
  "token has expired",
  "no credentials found",
  "no api key found",
  "token expired",
  "token revoked",
  "permission denied",
  "not authorized",
];

const formatPatterns = [
  "string should match pattern",
  "tool_use.id",
  "tool_use_id",
  "messages.1.content.1.tool_use.id",
  "invalid request format",
  "invalid json",
  "json parse",
  "malformed",
  "invalid request",
  "bad request",
];

const contextOverflowPatterns = [
  "context length",
  "context_length",
  "maximum context",
  "token limit",
  "too many tokens",
  "prompt is too long",
  "request too large",
  "context size",
  "reduce the length",
  "exceeds the limit",
  "context window",
  "prompt exceeds max length",
  "max_tokens",
  "maximum number of tokens",
  "exceeds the max_model_len",
  "max_model_len",
  "prompt length",
  "input is too long",
  "maximum model length",
  "context length exceeded",
  "slot context",
  "n_ctx_slot",
  "context_length_exceeded",
  "input too long",
];

const modelNotFoundPatterns = [
  "is not a valid model",
  "invalid model",
  "model not found",
  "model_not_found",
  "does not exist",
  "no such model",
  "unknown model",
  "unsupported model",
];

const usageLimitPatterns = [
  "usage limit",
  "quota",
  "limit exceeded",
  "key limit exceeded",
];

const usageLimitTransientSignals = [
  "try again",
  "retry",
  "resets at",
  "reset in",
  "wait",
  "requests remaining",
  "periodic",
  "window",
];

function matchesAny(msg: string, patterns: string[]): boolean {
  for (const p of patterns) {
    if (msg.includes(p)) return true;
  }
  return false;
}

// ── unwrapError: extract structured fields from nested error shapes ───────

export interface UnwrappedError {
  message: string;
  statusCode?: number;
  code?: string;
  headers?: Record<string, string>;
  retryAfter?: number;
  body?: unknown;
}

export function unwrapError(err: unknown): UnwrappedError {
  if (err == null) {
    return { message: "unknown error" };
  }

  // Walk up to 5 levels of cause chain
  const candidates: unknown[] = [err];
  let current: unknown = err;
  for (let i = 0; i < 5; i++) {
    const cause =
      (current as Record<string, unknown>)?.cause ??
      (current as Record<string, unknown>)?.error;
    if (cause == null || cause === current) break;
    candidates.push(cause);
    current = cause;
  }

  let statusCode: number | undefined;
  let code: string | undefined;
  let headers: Record<string, string> | undefined;
  let retryAfter: number | undefined;
  let body: unknown;
  let message = "";

  for (const candidate of candidates) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const c = candidate as Record<string, unknown>;

    // Status code: Anthropic SDK uses .status, others use .status_code or .statusCode
    if (statusCode === undefined) {
      const sc = c.status ?? c.status_code ?? c.statusCode;
      if (typeof sc === "number" && sc >= 100 && sc < 600) {
        statusCode = sc;
      }
    }

    // Error code from body
    if (code === undefined) {
      const rawBody = c.body ?? c.response;
      if (typeof rawBody === "object" && rawBody !== null) {
        const b = rawBody as Record<string, unknown>;
        body = body ?? rawBody;
        const errObj = b.error;
        if (typeof errObj === "object" && errObj !== null) {
          const e = errObj as Record<string, unknown>;
          const c2 = e.code ?? e.type;
          if (typeof c2 === "string" && c2.trim()) code = c2.trim();
        }
        if (!code) {
          const c3 = b.code ?? b.error_code;
          if (typeof c3 === "string" && c3.trim()) code = c3.trim();
        }
      }
    }

    // Headers: Anthropic SDK exposes response.headers
    if (headers === undefined) {
      const resp = c.response ?? c.headers;
      if (typeof resp === "object" && resp !== null) {
        const maybeHeaders =
          (resp as Record<string, unknown>).headers ?? resp;
        if (typeof maybeHeaders === "object" && maybeHeaders !== null) {
          const h = maybeHeaders as Record<string, unknown>;
          const raw: Record<string, string> = {};
          for (const [k, v] of Object.entries(h)) {
            if (typeof v === "string") raw[k.toLowerCase()] = v;
          }
          if (Object.keys(raw).length > 0) {
            headers = raw;
            // Extract Retry-After or retry-after-ms
            const raMs = raw["retry-after-ms"];
            const ra = raw["retry-after"];
            if (raMs !== undefined) {
              retryAfter = parseFloat(raMs);
            } else if (ra !== undefined) {
              retryAfter = parseFloat(ra) * 1000;
            }
          }
        }
      }
    }

    // Message: prefer structured body message
    if (!message) {
      const rawBody = c.body;
      if (typeof rawBody === "object" && rawBody !== null) {
        const b = rawBody as Record<string, unknown>;
        const errObj = b.error;
        if (typeof errObj === "object" && errObj !== null) {
          const e = errObj as Record<string, unknown>;
          const m = e.message;
          if (typeof m === "string" && m.trim()) message = m.trim().slice(0, 500);
        }
        if (!message) {
          const m = b.message;
          if (typeof m === "string" && m.trim()) message = m.trim().slice(0, 500);
        }
      }
    }
  }

  // Fallback message to string representation
  if (!message) {
    if (err instanceof Error) {
      message = err.message.slice(0, 500);
    } else {
      message = String(err).slice(0, 500);
    }
  }

  return {
    message,
    ...(statusCode !== undefined ? { statusCode } : {}),
    ...(code ? { code } : {}),
    ...(headers ? { headers } : {}),
    ...(retryAfter !== undefined ? { retryAfter } : {}),
    ...(body !== undefined ? { body } : {}),
  };
}

// ── 402 disambiguation ────────────────────────────────────────────────────

function classify402(msg: string, retryAfter?: number): ClassifiedError {
  // Check for transient usage-limit signals (usage limit + retry signal → rate_limit)
  const hasUsageLimit = matchesAny(msg, usageLimitPatterns);
  const hasTransient = matchesAny(msg, usageLimitTransientSignals);
  if (hasUsageLimit && hasTransient) {
    return classified("rate_limit", true, { retryAfter });
  }

  // Explicit rate signals: "rate" or "limit" or "usage" in the message
  if (
    msg.includes("rate") ||
    msg.includes("limit") ||
    msg.includes("usage")
  ) {
    // Only if NOT clearly billing
    if (
      !msg.includes("insufficient_quota") &&
      !msg.includes("billing") &&
      !msg.includes("payment")
    ) {
      return classified("rate_limit", true, { retryAfter });
    }
  }

  // Ambiguous → billing
  return classified("billing", false, { retryAfter });
}

// ── 400 classification ────────────────────────────────────────────────────

function classify400(
  msg: string,
  approxTokens: number,
  contextLength: number
): ClassifiedError {
  // Context overflow from explicit patterns
  if (matchesAny(msg, contextOverflowPatterns)) {
    return classified("context_overflow", true, { shouldCompress: true });
  }

  // Model not found sometimes comes as 400
  if (matchesAny(msg, modelNotFoundPatterns)) {
    return classified("model_not_found", false);
  }

  // Rate limit patterns embedded in 400
  if (matchesAny(msg, rateLimitPatterns)) {
    return classified("rate_limit", true);
  }

  // Billing patterns embedded in 400
  if (matchesAny(msg, billingPatterns)) {
    return classified("billing", false);
  }

  // Large-session heuristic: generic 400 + context > 40% of window → context_overflow
  if (approxTokens > 0 && contextLength > 0) {
    const threshold = contextLength * 0.4;
    if (approxTokens > threshold) {
      return classified("context_overflow", true, { shouldCompress: true });
    }
  }

  return classified("format_error", false);
}

// ── Main 7-stage classifier ───────────────────────────────────────────────

export interface ClassifyOptions {
  approxTokens?: number;
  contextLength?: number;
}

export function classifyError(
  err: unknown,
  options: ClassifyOptions = {}
): ClassifiedError {
  const { approxTokens = 0, contextLength = 200000 } = options;
  const unwrapped = unwrapError(err);
  const { statusCode, code, retryAfter } = unwrapped;

  // Normalize message for pattern matching
  const rawMsg = unwrapped.message.toLowerCase();

  // Also extract body message separately for 402/400 disambiguation
  let bodyMsg = "";
  if (
    unwrapped.body != null &&
    typeof unwrapped.body === "object"
  ) {
    const b = unwrapped.body as Record<string, unknown>;
    const errObj = b.error;
    if (typeof errObj === "object" && errObj !== null) {
      const e = errObj as Record<string, unknown>;
      const m = e.message;
      if (typeof m === "string") bodyMsg = m.toLowerCase();
    }
    if (!bodyMsg) {
      const m = b.message;
      if (typeof m === "string") bodyMsg = m.toLowerCase();
    }
  }

  // Combined message for pattern matching
  const msg = bodyMsg && !rawMsg.includes(bodyMsg) ? `${rawMsg} ${bodyMsg}` : rawMsg;

  // ── Stage 1: SDK error type match (Anthropic APIError shape) ─────────
  // Check for APIError-like shapes via status + type fields
  // The Anthropic SDK wraps errors with a .status property and structured body
  // This is handled by unwrapError; status-based classification happens in stage 2

  // ── Stage 2a: Provider-specific patterns (thinking signature) ─────────
  // Must come before generic 400 handling.
  // "signature" + "thinking" → thinking_signature (unique enough pattern, per Hermes)
  if (msg.includes("signature") && msg.includes("thinking")) {
    return classified("thinking_signature", false);
  }

  // ── Stage 2: HTTP status code ─────────────────────────────────────────

  if (statusCode !== undefined) {
    switch (statusCode) {
      case 401:
        return classified("auth", false);

      case 402:
        return classify402(msg, retryAfter);

      case 403:
        // OpenRouter "key limit exceeded" is billing
        if (msg.includes("key limit exceeded") || msg.includes("spending limit")) {
          return classified("billing", false);
        }
        return classified("auth_permanent", false);

      case 404:
        return classified("model_not_found", false);

      case 408:
        return classified("timeout", true, { retryAfter });

      case 413:
        return classified("payload_too_large", true, { shouldCompress: true });

      case 429:
        return classified("rate_limit", true, { retryAfter });

      case 400:
        return classify400(msg, approxTokens, contextLength);

      case 500:
      case 502:
        return classified("server_error", true, { retryAfter });

      case 503:
      case 529:
        return classified("overloaded", true, { retryAfter });

      case 504:
        return classified("timeout", true, { retryAfter });
    }

    // Other 4xx → format error
    if (statusCode >= 400 && statusCode < 500) {
      return classified("format_error", false);
    }

    // Other 5xx → server error
    if (statusCode >= 500 && statusCode < 600) {
      return classified("server_error", true, { retryAfter });
    }
  }

  // ── Stage 3: Error code field match ──────────────────────────────────

  if (code) {
    const codeLower = code.toLowerCase();
    if (
      codeLower === "resource_exhausted" ||
      codeLower === "throttled" ||
      codeLower === "rate_limit_exceeded"
    ) {
      return classified("rate_limit", true, { retryAfter });
    }
    if (
      codeLower === "insufficient_quota" ||
      codeLower === "billing_not_active" ||
      codeLower === "payment_required"
    ) {
      return classified("billing", false);
    }
    if (
      codeLower === "model_not_found" ||
      codeLower === "model_not_available" ||
      codeLower === "invalid_model"
    ) {
      return classified("model_not_found", false);
    }
    if (
      codeLower === "context_length_exceeded" ||
      codeLower === "max_tokens_exceeded"
    ) {
      return classified("context_overflow", true, { shouldCompress: true });
    }
  }

  // ── Stage 4: Message pattern matching ─────────────────────────────────

  // Rate limit
  if (matchesAny(msg, rateLimitPatterns)) {
    return classified("rate_limit", true, { retryAfter });
  }

  // Overloaded
  if (matchesAny(msg, overloadedPatterns)) {
    return classified("overloaded", true, { retryAfter });
  }

  // Usage-limit disambiguation (billing vs rate_limit from message alone)
  const hasUsageLimit = matchesAny(msg, usageLimitPatterns);
  if (hasUsageLimit) {
    const hasTransient = matchesAny(msg, usageLimitTransientSignals);
    if (hasTransient) {
      return classified("rate_limit", true, { retryAfter });
    }
    return classified("billing", false);
  }

  // Billing
  if (matchesAny(msg, billingPatterns)) {
    return classified("billing", false);
  }

  // Context overflow
  if (matchesAny(msg, contextOverflowPatterns)) {
    return classified("context_overflow", true, { shouldCompress: true });
  }

  // Auth
  if (matchesAny(msg, authPatterns)) {
    return classified("auth", false);
  }

  // Model not found
  if (matchesAny(msg, modelNotFoundPatterns)) {
    return classified("model_not_found", false);
  }

  // Timeout
  if (matchesAny(msg, timeoutPatterns)) {
    return classified("timeout", true, { retryAfter });
  }

  // Format error
  if (matchesAny(msg, formatPatterns)) {
    return classified("format_error", false);
  }

  // ── Stage 5: Heuristics ───────────────────────────────────────────────
  // Large-session 400 already handled inside classify400.
  // Thinking signature already handled above.

  // ── Stage 6: Recovery action already assigned by classified() ─────────

  // ── Stage 7: Fallback ─────────────────────────────────────────────────

  return classified("unknown", true, { retryAfter });
}
