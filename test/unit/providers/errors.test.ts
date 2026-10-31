import { describe, it, expect } from "vitest";
import { classifyError, unwrapError } from "../../../src/providers/errors.js";

// Helper: build a minimal error-like object with status code
function httpErr(status: number, message = "", body?: unknown): Error & Record<string, unknown> {
  const err = new Error(message) as Error & Record<string, unknown>;
  err.status = status;
  if (body !== undefined) err.body = body;
  return err;
}

// Helper: build an error with a message only (no status)
function msgErr(message: string): Error {
  return new Error(message);
}

describe("classifyError — acceptance criteria", () => {
  // AC1: 429 → rate_limit, retryable: true, tripBreaker: true
  it("classifies 429 as rate_limit with tripBreaker=true", () => {
    const result = classifyError(httpErr(429));
    expect(result.reason).toBe("rate_limit");
    expect(result.retryable).toBe(true);
    expect(result.tripBreaker).toBe(true);
  });

  // AC2: 402 + "insufficient_quota" → billing, retryable: false
  it("classifies 402 with insufficient_quota body as billing", () => {
    const err = httpErr(402, "insufficient_quota", {
      error: { message: "insufficient_quota", code: "billing_error" },
    });
    const result = classifyError(err);
    expect(result.reason).toBe("billing");
    expect(result.retryable).toBe(false);
  });

  // AC3: 402 + body containing "rate" and "limit" → rate_limit, retryable: true
  it("classifies 402 with rate limit body as rate_limit", () => {
    const err = httpErr(402, "rate limit exceeded", {
      error: { message: "rate limit exceeded" },
    });
    const result = classifyError(err);
    expect(result.reason).toBe("rate_limit");
    expect(result.retryable).toBe(true);
  });

  // AC4: 400 with context > 40% of 1M limit → context_overflow
  it("classifies 400 as context_overflow when tokens > 40% of context window", () => {
    const result = classifyError(httpErr(400, "Bad Request"), {
      approxTokens: 500000,
      contextLength: 1000000,
    });
    expect(result.reason).toBe("context_overflow");
  });

  // AC5: 401 → auth, retryable: false, tripBreaker: false
  it("classifies 401 as auth with retryable=false and tripBreaker=false", () => {
    const result = classifyError(httpErr(401));
    expect(result.reason).toBe("auth");
    expect(result.retryable).toBe(false);
    expect(result.tripBreaker).toBe(false);
  });

  // AC6: thinking block signature message → thinking_signature, retryable: false
  it("classifies thinking block signature error as thinking_signature", () => {
    const result = classifyError(
      msgErr("Invalid thinking block signature in the request")
    );
    expect(result.reason).toBe("thinking_signature");
    expect(result.retryable).toBe(false);
  });
});

describe("classifyError — status code coverage", () => {
  it("classifies 403 as auth_permanent", () => {
    const result = classifyError(httpErr(403));
    expect(result.reason).toBe("auth_permanent");
    expect(result.retryable).toBe(false);
    expect(result.tripBreaker).toBe(false);
  });

  it("classifies 404 as model_not_found", () => {
    const result = classifyError(httpErr(404));
    expect(result.reason).toBe("model_not_found");
    expect(result.retryable).toBe(false);
  });

  it("classifies 408 as timeout", () => {
    const result = classifyError(httpErr(408));
    expect(result.reason).toBe("timeout");
    expect(result.retryable).toBe(true);
    expect(result.tripBreaker).toBe(true);
  });

  it("classifies 413 as payload_too_large", () => {
    const result = classifyError(httpErr(413));
    expect(result.reason).toBe("payload_too_large");
    expect(result.retryable).toBe(true);
    expect(result.shouldCompress).toBe(true);
  });

  it("classifies 500 as server_error with tripBreaker=true", () => {
    const result = classifyError(httpErr(500));
    expect(result.reason).toBe("server_error");
    expect(result.retryable).toBe(true);
    expect(result.tripBreaker).toBe(true);
  });

  it("classifies 502 as server_error", () => {
    const result = classifyError(httpErr(502));
    expect(result.reason).toBe("server_error");
    expect(result.retryable).toBe(true);
  });

  it("classifies 503 as overloaded", () => {
    const result = classifyError(httpErr(503));
    expect(result.reason).toBe("overloaded");
    expect(result.retryable).toBe(true);
    expect(result.tripBreaker).toBe(true);
  });

  it("classifies 504 as timeout", () => {
    const result = classifyError(httpErr(504));
    expect(result.reason).toBe("timeout");
    expect(result.retryable).toBe(true);
  });

  it("classifies 529 as overloaded", () => {
    const result = classifyError(httpErr(529));
    expect(result.reason).toBe("overloaded");
    expect(result.retryable).toBe(true);
  });
});

describe("classifyError — 402 disambiguation", () => {
  it("402 with insufficient_quota → billing", () => {
    const result = classifyError(httpErr(402, "insufficient_quota"));
    expect(result.reason).toBe("billing");
    expect(result.retryable).toBe(false);
  });

  it("402 with billing keyword → billing", () => {
    const result = classifyError(httpErr(402, "billing limit reached"));
    expect(result.reason).toBe("billing");
    expect(result.retryable).toBe(false);
  });

  it("402 with payment keyword → billing", () => {
    const result = classifyError(httpErr(402, "payment required"));
    expect(result.reason).toBe("billing");
    expect(result.retryable).toBe(false);
  });

  it("402 with rate+limit keywords → rate_limit", () => {
    const result = classifyError(httpErr(402, "rate limit exceeded"));
    expect(result.reason).toBe("rate_limit");
    expect(result.retryable).toBe(true);
  });

  it("402 with usage keyword → rate_limit", () => {
    const result = classifyError(httpErr(402, "usage limit exceeded, try again"));
    expect(result.reason).toBe("rate_limit");
    expect(result.retryable).toBe(true);
  });

  it("402 ambiguous (no clear signal) → billing", () => {
    // No rate/limit/usage keywords, no billing keywords, ambiguous → billing
    const result = classifyError(httpErr(402, "payment failed"));
    expect(result.reason).toBe("billing");
    expect(result.retryable).toBe(false);
  });
});

describe("classifyError — message pattern matching (stage 4)", () => {
  it("detects rate_limit from message", () => {
    const result = classifyError(msgErr("rate limit exceeded, please wait"));
    expect(result.reason).toBe("rate_limit");
    expect(result.retryable).toBe(true);
  });

  it("detects overloaded from message", () => {
    const result = classifyError(msgErr("server overloaded, try again later"));
    expect(result.reason).toBe("overloaded");
    expect(result.retryable).toBe(true);
  });

  it("detects timeout from message", () => {
    const result = classifyError(msgErr("connection timed out"));
    expect(result.reason).toBe("timeout");
    expect(result.retryable).toBe(true);
  });

  it("detects billing from message", () => {
    const result = classifyError(msgErr("insufficient credits in your account"));
    expect(result.reason).toBe("billing");
    expect(result.retryable).toBe(false);
  });

  it("detects context_overflow from message", () => {
    const result = classifyError(msgErr("context length exceeded the maximum"));
    expect(result.reason).toBe("context_overflow");
    expect(result.retryable).toBe(true);
    expect(result.shouldCompress).toBe(true);
  });

  it("detects auth from message", () => {
    const result = classifyError(msgErr("invalid api key provided"));
    expect(result.reason).toBe("auth");
    expect(result.retryable).toBe(false);
  });

  it("detects model_not_found from message", () => {
    const result = classifyError(msgErr("model not found: gpt-9000"));
    expect(result.reason).toBe("model_not_found");
    expect(result.retryable).toBe(false);
  });

  it("falls back to unknown for unclassifiable errors", () => {
    const result = classifyError(msgErr("some unexpected error occurred XYZ123"));
    expect(result.reason).toBe("unknown");
    expect(result.retryable).toBe(true);
  });
});

describe("classifyError — stage 3: error code field", () => {
  it("classifies by error code resource_exhausted → rate_limit", () => {
    const err = httpErr(200, "");
    err.body = { error: { code: "resource_exhausted", message: "quota used" } };
    const result = classifyError(err);
    expect(result.reason).toBe("rate_limit");
  });

  it("classifies by error code insufficient_quota → billing", () => {
    const err = httpErr(200, "");
    err.body = { error: { code: "insufficient_quota", message: "billing" } };
    const result = classifyError(err);
    expect(result.reason).toBe("billing");
  });

  it("classifies by error code context_length_exceeded → context_overflow", () => {
    const err = httpErr(200, "");
    err.body = { error: { code: "context_length_exceeded", message: "too long" } };
    const result = classifyError(err);
    expect(result.reason).toBe("context_overflow");
  });
});

describe("classifyError — circuit breaker behavior", () => {
  it("only transient reasons trip breaker", () => {
    const nonBreakerStatuses = [
      { status: 401, reason: "auth" },
      { status: 403, reason: "auth_permanent" },
      { status: 404, reason: "model_not_found" },
    ];

    for (const { status, reason } of nonBreakerStatuses) {
      const result = classifyError(httpErr(status));
      expect(result.reason).toBe(reason);
      expect(result.tripBreaker).toBe(false);
    }

    // Each of the four transient reasons, produced from a real input. The old loop fed
    // httpErr(429) four times, so three of the four were never checked at all.
    const transientProducers = [
      { reason: "rate_limit", err: httpErr(429) },
      { reason: "server_error", err: httpErr(500) },
      { reason: "overloaded", err: httpErr(529) },
      { reason: "timeout", err: httpErr(408) },
    ] as const;
    for (const { reason, err } of transientProducers) {
      const result = classifyError(err);
      expect(result.reason).toBe(reason);
      expect(result.tripBreaker, `${reason} must trip the breaker`).toBe(true);
    }
  });

  it("billing has tripBreaker=false", () => {
    const result = classifyError(httpErr(402, "insufficient_quota"));
    expect(result.tripBreaker).toBe(false);
  });

  it("thinking_signature has tripBreaker=false", () => {
    const result = classifyError(msgErr("thinking block signature invalid"));
    expect(result.tripBreaker).toBe(false);
  });
});

describe("classifyError — 400 context overflow heuristic", () => {
  it("400 with tokens at exactly 40% boundary → no context_overflow", () => {
    // 40% of 1M is 400K; tokens=400000 is NOT greater than 400K, so format_error
    const result = classifyError(httpErr(400, "Bad Request"), {
      approxTokens: 400000,
      contextLength: 1000000,
    });
    // 400000 is not > 400000 (strict >)
    expect(result.reason).toBe("format_error");
  });

  it("400 with tokens above 40% boundary → context_overflow", () => {
    const result = classifyError(httpErr(400, "Bad Request"), {
      approxTokens: 400001,
      contextLength: 1000000,
    });
    expect(result.reason).toBe("context_overflow");
  });

  it("400 without token context → format_error", () => {
    const result = classifyError(httpErr(400, "Bad Request"));
    expect(result.reason).toBe("format_error");
  });
});

describe("unwrapError — nested error shapes", () => {
  it("extracts status from .status field (Anthropic SDK)", () => {
    const err = httpErr(429, "rate limited");
    const result = unwrapError(err);
    expect(result.statusCode).toBe(429);
    expect(result.message).toBe("rate limited");
  });

  it("extracts status from nested error.cause", () => {
    const cause = httpErr(503, "overloaded");
    const outer = new Error("outer error") as Error & Record<string, unknown>;
    outer.cause = cause;
    const result = unwrapError(outer);
    expect(result.statusCode).toBe(503);
  });

  it("extracts Retry-After header in ms", () => {
    const err = httpErr(429, "rate limit");
    err.response = {
      headers: { "retry-after": "30" },
    };
    const result = unwrapError(err);
    // retry-after in seconds → converted to ms
    expect(result.retryAfter).toBe(30000);
  });

  it("extracts retry-after-ms header directly", () => {
    const err = httpErr(429, "rate limit");
    err.response = {
      headers: { "retry-after-ms": "5000" },
    };
    const result = unwrapError(err);
    expect(result.retryAfter).toBe(5000);
  });

  it("extracts message from structured body", () => {
    const err = new Error("SDK wrapper") as Error & Record<string, unknown>;
    err.status = 400;
    err.body = { error: { message: "context length exceeded" } };
    const result = unwrapError(err);
    expect(result.message).toBe("context length exceeded");
  });

  it("extracts error code from body.error.code", () => {
    const err = new Error("error") as Error & Record<string, unknown>;
    err.status = 400;
    err.body = { error: { code: "model_not_found", message: "no model" } };
    const result = unwrapError(err);
    expect(result.code).toBe("model_not_found");
  });

  it("handles null/undefined error gracefully", () => {
    const result = unwrapError(null);
    expect(result.message).toBe("unknown error");
  });

  it("handles plain string error", () => {
    const result = unwrapError("connection failed");
    expect(result.message).toBe("connection failed");
  });
});
