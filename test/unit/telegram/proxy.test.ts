import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock child_process ────────────────────────────────────────────────────────

const mockExecFileSync = vi.fn();

vi.mock("child_process", () => ({
  execFileSync: mockExecFileSync,
}));

// Import after mock is set up
const { resolveProxy } = await import("../../../src/telegram/proxy.js");

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Save and restore environment variables around each test. */
function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void
): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = vars[key];
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

const ALL_PROXY_VARS = [
  "TELEGRAM_PROXY_URL",
  "TELEGRAM_PROXY",
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "ALL_PROXY",
  "all_proxy",
];

function clearProxyEnv(): Record<string, string | undefined> {
  const cleared: Record<string, string | undefined> = {};
  for (const k of ALL_PROXY_VARS) cleared[k] = undefined;
  return cleared;
}

// ── Level 1: Telegram-specific env vars ──────────────────────────────────────

describe("resolveProxy — Level 1: TELEGRAM_PROXY_URL / TELEGRAM_PROXY", () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it("returns TELEGRAM_PROXY_URL when set", () => {
    withEnv(
      { ...clearProxyEnv(), TELEGRAM_PROXY_URL: "socks5://proxy:1080" },
      () => {
        expect(resolveProxy()).toBe("socks5://proxy:1080");
      }
    );
  });

  it("returns TELEGRAM_PROXY as fallback when TELEGRAM_PROXY_URL is absent", () => {
    withEnv(
      {
        ...clearProxyEnv(),
        TELEGRAM_PROXY_URL: undefined,
        TELEGRAM_PROXY: "http://tg-proxy:3128",
      },
      () => {
        expect(resolveProxy()).toBe("http://tg-proxy:3128");
      }
    );
  });

  it("TELEGRAM_PROXY_URL takes priority over standard proxy env vars", () => {
    withEnv(
      {
        ...clearProxyEnv(),
        TELEGRAM_PROXY_URL: "socks5://specific:1080",
        HTTPS_PROXY: "http://general:3128",
      },
      () => {
        expect(resolveProxy()).toBe("socks5://specific:1080");
      }
    );
  });

  it("does not call scutil when TELEGRAM_PROXY_URL is set", () => {
    withEnv({ ...clearProxyEnv(), TELEGRAM_PROXY_URL: "http://x:80" }, () => {
      resolveProxy();
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });
  });
});

// ── Level 2: Standard proxy env vars ─────────────────────────────────────────

describe("resolveProxy — Level 2: standard proxy env vars", () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it("returns HTTPS_PROXY when Telegram vars are absent", () => {
    withEnv(
      { ...clearProxyEnv(), HTTPS_PROXY: "http://https-proxy:3128" },
      () => {
        expect(resolveProxy()).toBe("http://https-proxy:3128");
      }
    );
  });

  it("returns lowercase https_proxy as fallback", () => {
    withEnv(
      {
        ...clearProxyEnv(),
        HTTPS_PROXY: undefined,
        https_proxy: "http://lower-https:3128",
      },
      () => {
        expect(resolveProxy()).toBe("http://lower-https:3128");
      }
    );
  });

  it("returns HTTP_PROXY when HTTPS vars are absent", () => {
    withEnv(
      {
        ...clearProxyEnv(),
        HTTPS_PROXY: undefined,
        https_proxy: undefined,
        HTTP_PROXY: "http://http-proxy:8080",
      },
      () => {
        expect(resolveProxy()).toBe("http://http-proxy:8080");
      }
    );
  });

  it("returns lowercase http_proxy as fallback", () => {
    withEnv(
      {
        ...clearProxyEnv(),
        HTTPS_PROXY: undefined,
        https_proxy: undefined,
        HTTP_PROXY: undefined,
        http_proxy: "http://lower-http:8080",
      },
      () => {
        expect(resolveProxy()).toBe("http://lower-http:8080");
      }
    );
  });

  it("returns ALL_PROXY when other vars are absent", () => {
    withEnv(
      {
        ...clearProxyEnv(),
        HTTPS_PROXY: undefined,
        https_proxy: undefined,
        HTTP_PROXY: undefined,
        http_proxy: undefined,
        ALL_PROXY: "socks5://all-proxy:1080",
      },
      () => {
        expect(resolveProxy()).toBe("socks5://all-proxy:1080");
      }
    );
  });

  it("returns lowercase all_proxy as last standard fallback", () => {
    withEnv(
      {
        ...clearProxyEnv(),
        HTTPS_PROXY: undefined,
        https_proxy: undefined,
        HTTP_PROXY: undefined,
        http_proxy: undefined,
        ALL_PROXY: undefined,
        all_proxy: "socks5://lower-all:1080",
      },
      () => {
        expect(resolveProxy()).toBe("socks5://lower-all:1080");
      }
    );
  });

  it("HTTPS_PROXY takes priority over HTTP_PROXY", () => {
    withEnv(
      {
        ...clearProxyEnv(),
        HTTPS_PROXY: "http://https:3128",
        HTTP_PROXY: "http://http:8080",
      },
      () => {
        expect(resolveProxy()).toBe("http://https:3128");
      }
    );
  });
});

// ── Level 3: macOS scutil parsing ─────────────────────────────────────────────

describe("resolveProxy — Level 3: macOS scutil proxy detection", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    mockExecFileSync.mockReset();
    // Force darwin platform for these tests
    Object.defineProperty(process, "platform", { value: "darwin" });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("calls scutil with array args (no shell injection)", () => {
    mockExecFileSync.mockReturnValue("");
    withEnv(clearProxyEnv(), () => {
      resolveProxy();
    });
    expect(mockExecFileSync).toHaveBeenCalledWith("scutil", ["--proxy"], {
      encoding: "utf8",
      timeout: 5000,
    });
  });

  it("parses HTTPS proxy from scutil output", () => {
    mockExecFileSync.mockReturnValue(`<dictionary> {
  HTTPSEnable : 1
  HTTPSProxy : proxy.example.com
  HTTPSPort : 8443
}`);
    withEnv(clearProxyEnv(), () => {
      expect(resolveProxy()).toBe("http://proxy.example.com:8443");
    });
  });

  it("parses HTTP proxy when HTTPS is not enabled", () => {
    mockExecFileSync.mockReturnValue(`<dictionary> {
  HTTPEnable : 1
  HTTPProxy : http-proxy.example.com
  HTTPPort : 3128
}`);
    withEnv(clearProxyEnv(), () => {
      expect(resolveProxy()).toBe("http://http-proxy.example.com:3128");
    });
  });

  it("parses SOCKS proxy and uses socks5:// scheme", () => {
    mockExecFileSync.mockReturnValue(`<dictionary> {
  SOCKSEnable : 1
  SOCKSProxy : socks.example.com
  SOCKSPort : 1080
}`);
    withEnv(clearProxyEnv(), () => {
      expect(resolveProxy()).toBe("socks5://socks.example.com:1080");
    });
  });

  it("HTTPS proxy takes priority over HTTP and SOCKS", () => {
    mockExecFileSync.mockReturnValue(`<dictionary> {
  HTTPSEnable : 1
  HTTPSProxy : https-proxy.example.com
  HTTPSPort : 443
  HTTPEnable : 1
  HTTPProxy : http-proxy.example.com
  HTTPPort : 80
  SOCKSEnable : 1
  SOCKSProxy : socks.example.com
  SOCKSPort : 1080
}`);
    withEnv(clearProxyEnv(), () => {
      expect(resolveProxy()).toBe("http://https-proxy.example.com:443");
    });
  });

  it("uses default ports when port is missing", () => {
    mockExecFileSync.mockReturnValue(`<dictionary> {
  HTTPEnable : 1
  HTTPProxy : proxy.example.com
}`);
    withEnv(clearProxyEnv(), () => {
      expect(resolveProxy()).toBe("http://proxy.example.com:80");
    });
  });

  it("returns undefined when scutil output has no enabled proxies", () => {
    mockExecFileSync.mockReturnValue(`<dictionary> {
  HTTPSEnable : 0
  HTTPEnable : 0
  SOCKSEnable : 0
}`);
    withEnv(clearProxyEnv(), () => {
      expect(resolveProxy()).toBeUndefined();
    });
  });

  it("returns undefined when scutil throws", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("command not found");
    });
    withEnv(clearProxyEnv(), () => {
      expect(resolveProxy()).toBeUndefined();
    });
  });

  it("returns undefined when HTTPSEnable=1 but host is empty", () => {
    mockExecFileSync.mockReturnValue(`<dictionary> {
  HTTPSEnable : 1
  HTTPSProxy :
  HTTPSPort : 443
}`);
    withEnv(clearProxyEnv(), () => {
      expect(resolveProxy()).toBeUndefined();
    });
  });
});

// ── Level 4: Direct connection ────────────────────────────────────────────────

describe("resolveProxy — Level 4: direct connection (no proxy)", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("returns undefined when no proxy is configured", () => {
    // Force non-darwin so scutil is never called
    Object.defineProperty(process, "platform", { value: "linux" });
    withEnv(clearProxyEnv(), () => {
      expect(resolveProxy()).toBeUndefined();
    });
  });

  it("does not call scutil on non-macOS platforms", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    withEnv(clearProxyEnv(), () => {
      resolveProxy();
    });
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });
});
