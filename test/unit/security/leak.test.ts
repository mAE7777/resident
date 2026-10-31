import { describe, it, expect, beforeEach } from "vitest";
import { createLeakScanner } from "../../../src/security/leak.js";
import { redact, maskToken } from "../../../src/security/redact.js";
import { scanInbound } from "../../../src/security/inbound.js";

describe("leak.ts — createLeakScanner / scanForLeaks", () => {
  let scanner: ReturnType<typeof createLeakScanner>;

  beforeEach(() => {
    scanner = createLeakScanner();
  });

  // AC1: Anthropic key → action 'block', pattern 'Anthropic'
  it("detects Anthropic API key with action 'block'", () => {
    const { matches } = scanner.scanForLeaks(
      "sk-ant-api03-abcdefghijklmnopqrstuvwxyz"
    );
    const match = matches.find((m) => m.description === "Anthropic");
    expect(match).toBeDefined();
    expect(match!.action).toBe("block");
  });

  it("detects OpenAI API key with action 'block'", () => {
    const { matches } = scanner.scanForLeaks(
      "sk-1234567890abcdefghijklmnopqrstuvwxyz"
    );
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].action).toBe("block");
  });

  it("detects GitHub PAT with action 'block'", () => {
    const { matches } = scanner.scanForLeaks(
      "My key is ghp_1234567890abcdefghijklmnopqrstuvwxyz"
    );
    const match = matches.find((m) => m.description.includes("GitHub"));
    expect(match).toBeDefined();
    expect(match!.action).toBe("block");
  });

  it("detects AWS access key ID", () => {
    const { matches } = scanner.scanForLeaks("AKIAIOSFODNN7EXAMPLE1234");
    const match = matches.find((m) => m.description.includes("AWS"));
    expect(match).toBeDefined();
    expect(match!.action).toBe("block");
  });

  it("detects JWT token with action 'redact'", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const { matches } = scanner.scanForLeaks(jwt);
    const match = matches.find((m) => m.description.includes("JWT"));
    expect(match).toBeDefined();
    expect(match!.action).toBe("redact");
  });

  it("detects database connection string with action 'redact'", () => {
    const { matches } = scanner.scanForLeaks(
      "postgres://myuser:mysecretpassword@localhost:5432/mydb"
    );
    const match = matches.find((m) => m.description.includes("PostgreSQL"));
    expect(match).toBeDefined();
    expect(match!.action).toBe("redact");
  });

  it("detects Slack token", () => {
    const { matches } = scanner.scanForLeaks(
      "xoxb-1234567890-abcdefghijklmnop"
    );
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].description).toBe("Slack token");
  });

  it("detects HuggingFace token", () => {
    const { matches } = scanner.scanForLeaks("hf_abcdefghijklmnopqrstuvwxyz");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("returns no matches for benign text", () => {
    const { matches } = scanner.scanForLeaks(
      "Hello, the weather today is sunny and warm."
    );
    expect(matches).toHaveLength(0);
  });

  it("two-stage: prefix scan does not run all regexes on every byte", () => {
    // Verifies the Aho-Corasick prefix optimization: benign text should produce
    // no matches without triggering 31 regex checks
    const benign = "a".repeat(10000);
    const { matches } = scanner.scanForLeaks(benign);
    expect(matches).toHaveLength(0);
  });
});

describe("redact.ts — redact / maskToken", () => {
  // AC2: redact masks GitHub PAT preserving first6...last4
  it("masks GitHub PAT to first6...last4", () => {
    const result = redact(
      "My key is ghp_1234567890abcdefghijklmnopqrstuvwxyz"
    );
    expect(result).toBe("My key is ghp_12...wxyz");
  });

  // AC3: maskToken short token → "***"
  it("masks short token (< 18 chars) to '***'", () => {
    expect(maskToken("abc")).toBe("***");
  });

  it("masks long token (>= 18 chars) to first6...last4", () => {
    expect(maskToken("sk-ant-api03-ABCDEFGHIJ")).toBe("sk-ant...GHIJ");
  });

  it("threshold: 17 chars → '***', 18 chars → first6...last4", () => {
    expect(maskToken("a".repeat(17))).toBe("***");
    const t18 = "a".repeat(18);
    expect(maskToken(t18)).toBe("aaaaaa...aaaa");
  });

  it("redacts Anthropic key in text", () => {
    const result = redact(
      "key=sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234"
    );
    expect(result).not.toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZ1234");
    expect(result).toContain("...");
  });

  it("redacts database password in connection string", () => {
    const result = redact(
      "postgres://user:supersecretpassword@localhost:5432/db"
    );
    expect(result).toBe("postgres://user:***@localhost:5432/db");
  });

  it("redacts private key block", () => {
    const text = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Z3VS5JJcds3xHn/ygWep4RO
-----END RSA PRIVATE KEY-----`;
    const result = redact(text);
    expect(result).toBe("[REDACTED PRIVATE KEY]");
  });

  it("redacts telegram bot token", () => {
    const result = redact("bot123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg");
    expect(result).toBe("bot123456789:***");
  });

  it("redacts JWT token", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
    const result = redact(`token: ${jwt}`);
    expect(result).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
  });

  it("redacts Authorization header bearer token", () => {
    const result = redact(
      "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9longtoken"
    );
    expect(result).toContain("Authorization: Bearer ");
    expect(result).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9longtoken");
  });

  it("redacts ENV assignment with secret name", () => {
    const result = redact("OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123");
    expect(result).not.toContain(
      "sk-abcdefghijklmnopqrstuvwxyz123"
    );
    expect(result).toContain("OPENAI_API_KEY=");
  });

  it("redacts JSON field named 'apiKey'", () => {
    const result = redact('{"apiKey": "sk-abcdefghijklmnopqrstuvwxyz12345"}');
    expect(result).not.toContain("sk-abcdefghijklmnopqrstuvwxyz12345");
  });

  it("passes through benign text unchanged", () => {
    const text = "Hello world, no secrets here";
    expect(redact(text)).toBe(text);
  });

  it("handles empty string", () => {
    expect(redact("")).toBe("");
  });
});

describe("inbound.ts — scanInbound", () => {
  // AC4: user message with sk-ant-abc123xyz → rejected with expected message
  it("rejects user message containing Anthropic key", () => {
    const result = scanInbound(
      "Here is my key: sk-ant-abc123xyz000000000000000000"
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/contains what appears to be a secret/);
  });

  it("rejects GitHub PAT in message", () => {
    const result = scanInbound(
      "Use this token: ghp_1234567890abcdefghijklmnopqrstuvwxyz"
    );
    expect(result.allowed).toBe(false);
  });

  it("allows benign message", () => {
    const result = scanInbound("What is the weather in Tokyo?");
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("allows vault set command (explicit credential provisioning)", () => {
    const result = scanInbound(
      "/vault set ANTHROPIC_API_KEY sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ1"
    );
    expect(result.allowed).toBe(true);
  });

  it("allows vault add command", () => {
    const result = scanInbound("/vault add mykey sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ1");
    expect(result.allowed).toBe(true);
  });

  it("blocked messages include the secret type in reason", () => {
    const result = scanInbound(
      "sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345"
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Anthropic");
  });
});
