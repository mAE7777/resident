import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SSRFError, isPrivateIP, safeFetch, validatePublicHttpUrl } from "../../../src/security/ssrf.js";

// ---------------------------------------------------------------------------
// Mock dns.promises, must be top-level before any imports that use it
// ---------------------------------------------------------------------------

vi.mock("node:dns", async () => {
  const actual = await vi.importActual<typeof import("node:dns")>("node:dns");
  return {
    ...actual,
    promises: {
      ...actual.promises,
      resolve4: vi.fn(),
      resolve6: vi.fn(),
    },
  };
});

import * as dns from "node:dns";

const mockResolve4 = vi.mocked(dns.promises.resolve4);
const mockResolve6 = vi.mocked(dns.promises.resolve6);

function setupDNS(ipv4: string[], ipv6: string[] = []): void {
  if (ipv4.length > 0) {
    mockResolve4.mockResolvedValue(ipv4 as dns.RecordWithTtl[] & string[]);
  } else {
    mockResolve4.mockRejectedValue(new Error("ENOTFOUND"));
  }
  if (ipv6.length > 0) {
    mockResolve6.mockResolvedValue(ipv6 as dns.RecordWithTtl[] & string[]);
  } else {
    mockResolve6.mockRejectedValue(new Error("ENOTFOUND"));
  }
}

// ---------------------------------------------------------------------------
// isPrivateIP: unit tests for CIDR logic
// ---------------------------------------------------------------------------

describe("isPrivateIP — IPv4 private ranges", () => {
  it("192.168.1.1 is private (192.168.0.0/16)", () => {
    expect(isPrivateIP("192.168.1.1")).toBe(true);
  });

  it("10.0.0.1 is private (10.0.0.0/8)", () => {
    expect(isPrivateIP("10.0.0.1")).toBe(true);
  });

  it("10.255.255.255 is private (10.0.0.0/8 boundary)", () => {
    expect(isPrivateIP("10.255.255.255")).toBe(true);
  });

  it("127.0.0.1 is private (loopback 127.0.0.0/8)", () => {
    expect(isPrivateIP("127.0.0.1")).toBe(true);
  });

  it("127.255.255.255 is private (loopback boundary)", () => {
    expect(isPrivateIP("127.255.255.255")).toBe(true);
  });

  it("169.254.0.1 is private (link-local 169.254.0.0/16)", () => {
    expect(isPrivateIP("169.254.0.1")).toBe(true);
  });

  it("172.16.0.1 is private (172.16.0.0/12)", () => {
    expect(isPrivateIP("172.16.0.1")).toBe(true);
  });

  it("172.31.255.255 is private (172.16.0.0/12 boundary)", () => {
    expect(isPrivateIP("172.31.255.255")).toBe(true);
  });

  it("0.0.0.1 is private (0.0.0.0/8)", () => {
    expect(isPrivateIP("0.0.0.1")).toBe(true);
  });

  it("100.64.0.1 is private (CGNAT 100.64.0.0/10)", () => {
    expect(isPrivateIP("100.64.0.1")).toBe(true);
  });

  it("100.127.255.255 is private (CGNAT 100.64.0.0/10 boundary)", () => {
    expect(isPrivateIP("100.127.255.255")).toBe(true);
  });

  it("8.8.8.8 is public", () => {
    expect(isPrivateIP("8.8.8.8")).toBe(false);
  });

  it("1.1.1.1 is public", () => {
    expect(isPrivateIP("1.1.1.1")).toBe(false);
  });

  it("172.32.0.1 is public (just outside 172.16.0.0/12)", () => {
    expect(isPrivateIP("172.32.0.1")).toBe(false);
  });

  it("100.128.0.1 is public (just outside CGNAT range)", () => {
    expect(isPrivateIP("100.128.0.1")).toBe(false);
  });
});

describe("isPrivateIP — IPv6 private ranges", () => {
  it("::1 is private (IPv6 loopback)", () => {
    expect(isPrivateIP("::1")).toBe(true);
  });

  it("fc00::1 is private (unique local fc00::/7)", () => {
    expect(isPrivateIP("fc00::1")).toBe(true);
  });

  it("fd00::1 is private (unique local fd prefix)", () => {
    expect(isPrivateIP("fd00::1")).toBe(true);
  });

  it("fe80::1 is private (link-local fe80::/10)", () => {
    expect(isPrivateIP("fe80::1")).toBe(true);
  });

  it("::ffff:192.168.1.1 is private (IPv4-mapped)", () => {
    expect(isPrivateIP("::ffff:192.168.1.1")).toBe(true);
  });

  it("::ffff:10.0.0.1 is private (IPv4-mapped private)", () => {
    expect(isPrivateIP("::ffff:10.0.0.1")).toBe(true);
  });

  it("::ffff:8.8.8.8 is NOT private (IPv4-mapped public)", () => {
    expect(isPrivateIP("::ffff:8.8.8.8")).toBe(false);
  });

  it("2001:db8::1 is NOT private (documentation range, not blocked)", () => {
    expect(isPrivateIP("2001:db8::1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// safeFetch: SSRF blocking (AC: DNS resolves to private IP → SSRFError)
// ---------------------------------------------------------------------------

describe("safeFetch — SSRF protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("AC1: throws SSRFError when URL resolves to 192.168.1.1", async () => {
    setupDNS(["192.168.1.1"]);
    await expect(safeFetch("http://internal.example.com/path")).rejects.toThrow(SSRFError);
    await expect(safeFetch("http://internal.example.com/path")).rejects.toThrow(
      /resolves to private IP/
    );
  });

  it("AC2: throws SSRFError when URL resolves to 10.0.0.1", async () => {
    setupDNS(["10.0.0.1"]);
    await expect(safeFetch("http://internal.example.com/")).rejects.toThrow(SSRFError);
  });

  it("blocks 127.0.0.1 (loopback)", async () => {
    setupDNS(["127.0.0.1"]);
    await expect(safeFetch("http://example.com/")).rejects.toThrow(SSRFError);
  });

  it("validatePublicHttpUrl blocks hostname resolving to private IP before transport", async () => {
    setupDNS(["127.0.0.1"]);
    await expect(validatePublicHttpUrl("http://internal.example.com/mcp")).rejects.toThrow(SSRFError);
  });

  it("blocks 172.16.0.5 (RFC 1918 172.16/12)", async () => {
    setupDNS(["172.16.0.5"]);
    await expect(safeFetch("http://example.com/")).rejects.toThrow(SSRFError);
  });

  it("blocks 169.254.1.1 (link-local)", async () => {
    setupDNS(["169.254.1.1"]);
    await expect(safeFetch("http://example.com/")).rejects.toThrow(SSRFError);
  });

  it("blocks 100.64.1.1 (CGNAT)", async () => {
    setupDNS(["100.64.1.1"]);
    await expect(safeFetch("http://example.com/")).rejects.toThrow(SSRFError);
  });

  it("blocks ::1 (IPv6 loopback)", async () => {
    setupDNS([], ["::1"]);
    await expect(safeFetch("http://example.com/")).rejects.toThrow(SSRFError);
  });

  it("blocks ::ffff:192.168.1.1 (IPv4-mapped IPv6)", async () => {
    setupDNS([], ["::ffff:192.168.1.1"]);
    await expect(safeFetch("http://example.com/")).rejects.toThrow(SSRFError);
  });

  it("blocks when IPv4 resolves public but IPv6 resolves private", async () => {
    setupDNS(["8.8.8.8"], ["fc00::1"]);
    await expect(safeFetch("http://example.com/")).rejects.toThrow(SSRFError);
  });

  it("SSRFError has correct name", async () => {
    setupDNS(["192.168.1.1"]);
    try {
      await safeFetch("http://internal.example.com/");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SSRFError);
      expect((err as SSRFError).name).toBe("SSRFError");
    }
  });

  it("rejects non-http/https protocol", async () => {
    await expect(safeFetch("ftp://example.com/")).rejects.toThrow(SSRFError);
  });
});

// ---------------------------------------------------------------------------
// integrity.ts, BLAKE3 skill integrity
// ---------------------------------------------------------------------------

