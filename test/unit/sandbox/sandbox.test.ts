import { describe, it, expect, afterAll, afterEach, beforeEach } from "vitest";
import { createServer, request as httpRequest } from "node:http";
import type { Server, IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import {
  allowsWrites,
  hasFullNetwork,
  isSandboxed,
  createDomainAllowlist,
  defaultAllowlist,
  DEFAULT_RESOURCE_LIMITS,
  DEFAULT_SANDBOX_CONFIG,
  HOP_BY_HOP_HEADERS,
} from "../../../src/sandbox/policies.js";
import type {
  SandboxConfig,
  SandboxPolicy,
  CredentialMapping,
  CredentialResolver,
} from "../../../src/sandbox/policies.js";
import {
  buildContainerConfig,
  createNetworkProxy,
  createContainerRunner,
  detectDocker,
  connectDocker,
  SandboxError,
} from "../../../src/sandbox/container.js";
import type { NetworkProxy, DockerDetectionResult } from "../../../src/sandbox/container.js";

// ── SandboxPolicy helpers ──────────────────────────────────────────────────

describe("SandboxPolicy helpers", () => {
  it("readonly does not allow writes", () => {
    expect(allowsWrites("readonly")).toBe(false);
  });

  it("workspace-write allows writes", () => {
    expect(allowsWrites("workspace-write")).toBe(true);
  });

  it("full-access allows writes", () => {
    expect(allowsWrites("full-access")).toBe(true);
  });

  it("readonly is sandboxed", () => {
    expect(isSandboxed("readonly")).toBe(true);
  });

  it("workspace-write is sandboxed", () => {
    expect(isSandboxed("workspace-write")).toBe(true);
  });

  it("full-access is not sandboxed", () => {
    expect(isSandboxed("full-access")).toBe(false);
  });

  it("readonly does not have full network", () => {
    expect(hasFullNetwork("readonly")).toBe(false);
  });

  it("full-access has full network", () => {
    expect(hasFullNetwork("full-access")).toBe(true);
  });
});

// ── DomainAllowlist ────────────────────────────────────────────────────────

describe("DomainAllowlist", () => {
  it("matches exact domains", () => {
    const al = createDomainAllowlist(["github.com", "npmjs.com"]);
    expect(al.isAllowed("github.com")).toBe(true);
    expect(al.isAllowed("npmjs.com")).toBe(true);
    expect(al.isAllowed("evil.com")).toBe(false);
  });

  it("matches wildcard subdomains", () => {
    const al = createDomainAllowlist(["*.github.com"]);
    expect(al.isAllowed("api.github.com")).toBe(true);
    expect(al.isAllowed("raw.github.com")).toBe(true);
    // Wildcard *.x.com should NOT match x.com itself
    expect(al.isAllowed("github.com")).toBe(false);
  });

  it("is case-insensitive", () => {
    const al = createDomainAllowlist(["GitHub.Com"]);
    expect(al.isAllowed("github.com")).toBe(true);
    expect(al.isAllowed("GITHUB.COM")).toBe(true);
  });

  it("returns rules copy", () => {
    const patterns = ["github.com", "*.npmjs.com"];
    const al = createDomainAllowlist(patterns);
    expect(al.rules()).toEqual(patterns);
  });

  it("rejects domains not in list", () => {
    const al = createDomainAllowlist(defaultAllowlist());
    expect(al.isAllowed("evil.com")).toBe(false);
    expect(al.isAllowed("malware.io")).toBe(false);
    expect(al.isAllowed("github.com.evil.com")).toBe(false);
  });

  it("default allowlist includes expected domains", () => {
    const al = createDomainAllowlist(defaultAllowlist());
    expect(al.isAllowed("github.com")).toBe(true);
    expect(al.isAllowed("api.github.com")).toBe(true);
    expect(al.isAllowed("registry.npmjs.org")).toBe(true);
    expect(al.isAllowed("api.anthropic.com")).toBe(true);
    expect(al.isAllowed("api.ollama.local")).toBe(true);
  });
});

// ── AC1: ReadOnly policy, file readable ───────────────────────────────────

describe("AC1: ReadOnly policy — container config", () => {
  it("mounts workspace as read-only", () => {
    const config: SandboxConfig = {
      ...DEFAULT_SANDBOX_CONFIG,
      enabled: true,
      policy: "readonly",
    };
    const result = buildContainerConfig(config, "cat /workspace/file.txt", "/home/user/workspace", 8080);

    const hostConfig = result.HostConfig as Record<string, unknown>;
    const binds = hostConfig.Binds as string[];
    expect(binds).toHaveLength(1);
    expect(binds[0]).toBe("/home/user/workspace:/workspace:ro");
  });

  it("uses non-root user", () => {
    const config: SandboxConfig = {
      ...DEFAULT_SANDBOX_CONFIG,
      enabled: true,
      policy: "readonly",
    };
    const result = buildContainerConfig(config, "cat /workspace/file.txt", "/home/user/workspace", 8080);
    expect(result.User).toBe("1000:1000");
  });

  it("sets proxy environment variables", () => {
    const config: SandboxConfig = {
      ...DEFAULT_SANDBOX_CONFIG,
      enabled: true,
      policy: "readonly",
    };
    const result = buildContainerConfig(config, "cat /workspace/file.txt", "/home/user/workspace", 8080);
    const env = result.Env as string[];
    expect(env).toContain("http_proxy=http://host.docker.internal:8080");
    expect(env).toContain("https_proxy=http://host.docker.internal:8080");
  });
});

// ── AC2: ReadOnly policy, write fails ─────────────────────────────────────

describe("AC2: ReadOnly policy — write blocked by ro mount", () => {
  it("mounts workspace as ro so writes fail at filesystem level", () => {
    const config: SandboxConfig = {
      ...DEFAULT_SANDBOX_CONFIG,
      enabled: true,
      policy: "readonly",
    };
    const result = buildContainerConfig(config, "echo test > /workspace/new.txt", "/home/user/workspace", 8080);

    const hostConfig = result.HostConfig as Record<string, unknown>;
    const binds = hostConfig.Binds as string[];
    expect(binds[0]).toMatch(/:ro$/);
  });
});

// ── AC3: WorkspaceWrite policy, write succeeds ────────────────────────────

describe("AC3: WorkspaceWrite policy — write allowed", () => {
  it("mounts workspace as read-write", () => {
    const config: SandboxConfig = {
      ...DEFAULT_SANDBOX_CONFIG,
      enabled: true,
      policy: "workspace-write",
    };
    const result = buildContainerConfig(config, "echo test > /workspace/new.txt", "/home/user/workspace", 8080);

    const hostConfig = result.HostConfig as Record<string, unknown>;
    const binds = hostConfig.Binds as string[];
    expect(binds).toHaveLength(1);
    expect(binds[0]).toBe("/home/user/workspace:/workspace:rw");
  });

  it("still uses proxy (sandboxed network)", () => {
    const config: SandboxConfig = {
      ...DEFAULT_SANDBOX_CONFIG,
      enabled: true,
      policy: "workspace-write",
    };
    const result = buildContainerConfig(config, "echo test", "/home/user/workspace", 9090);
    const env = result.Env as string[];
    expect(env.some((e) => e.includes("9090"))).toBe(true);
  });
});

// ── AC4: Network allowlist blocks evil.com ──────────────────────────────────

describe("AC4: Network proxy blocks non-allowlisted domains", () => {
  let proxy: NetworkProxy;

  afterEach(async () => {
    if (proxy) await proxy.destroy();
  });

  /** Send an HTTP request through the proxy using proper HTTP proxy protocol (full URL as path). */
  function proxyRequest(proxyPort: number, targetUrl: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port: proxyPort,
          path: targetUrl, // HTTP proxy protocol: full URL as the request path
          method: "GET",
        },
        (res) => {
          let body = "";
          res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  it("blocks requests to evil.com", async () => {
    const allowlist = createDomainAllowlist(["github.com"]);
    proxy = await createNetworkProxy(allowlist, [], null);

    const response = await proxyRequest(proxy.port, "http://evil.com/malware");

    expect(response.status).toBe(403);
    expect(response.body).toContain("not in network allowlist");
  });

  it("allows requests to allowlisted domains", async () => {
    const backendServer = createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200);
      res.end("ok");
    });
    let backendPort = 0;
    await new Promise<void>((resolve) => {
      backendServer.listen(0, "127.0.0.1", () => {
        backendPort = (backendServer.address() as AddressInfo).port;
        resolve();
      });
    });

    try {
      const allowlist = createDomainAllowlist(["127.0.0.1"]);
      proxy = await createNetworkProxy(allowlist, [], null);

      const response = await proxyRequest(proxy.port, `http://127.0.0.1:${backendPort}/get`);
      expect(response.status).toBe(200);
      expect(response.body).toBe("ok");
    } finally {
      await new Promise<void>((resolve) => backendServer.close(() => resolve()));
    }
  });

  it("blocks CONNECT tunneling to non-allowlisted host", async () => {
    const allowlist = createDomainAllowlist(["github.com"]);
    proxy = await createNetworkProxy(allowlist, [], null);

    // CONNECT to evil.com:443 should be rejected
    const { connect: netConnect } = await import("node:net");
    const result = await new Promise<string>((resolve) => {
      const socket = netConnect(proxy.port, "127.0.0.1", () => {
        socket.write("CONNECT evil.com:443 HTTP/1.1\r\nHost: evil.com:443\r\n\r\n");
      });
      let data = "";
      socket.on("data", (chunk) => {
        data += chunk.toString();
        socket.end();
      });
      socket.on("end", () => resolve(data));
      socket.on("error", () => resolve("error"));
      setTimeout(() => {
        socket.destroy();
        resolve(data || "timeout");
      }, 2000);
    });

    expect(result).toContain("403 Forbidden");
  });
});

// ── FullAccess double opt-in guard ─────────────────────────────────────────

describe("FullAccess double opt-in guard", () => {
  it("throws when full-access requested without allowFullAccess", () => {
    const config: SandboxConfig = {
      ...DEFAULT_SANDBOX_CONFIG,
      enabled: true,
      policy: "full-access",
      allowFullAccess: false,
    };
    expect(() => createContainerRunner({ config })).toThrow(SandboxError);
    expect(() => createContainerRunner({ config })).toThrow(/allowFullAccess/);
  });

  it("throws with FULL_ACCESS_DENIED code", () => {
    const config: SandboxConfig = {
      ...DEFAULT_SANDBOX_CONFIG,
      enabled: true,
      policy: "full-access",
      allowFullAccess: false,
    };
    try {
      createContainerRunner({ config });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SandboxError);
      expect((err as SandboxError).code).toBe("FULL_ACCESS_DENIED");
    }
  });

  it("does not throw when full-access AND allowFullAccess are both set", () => {
    const config: SandboxConfig = {
      ...DEFAULT_SANDBOX_CONFIG,
      enabled: true,
      policy: "full-access",
      allowFullAccess: true,
    };
    // This should not throw (though run() would fail without Docker)
    const runner = createContainerRunner({ config });
    expect(runner).toBeDefined();
    // Clean up
    runner.destroy();
  });
});

// ── Container config security options ──────────────────────────────────────

describe("Container config security", () => {
  it("drops all capabilities and adds only CHOWN", () => {
    const config: SandboxConfig = { ...DEFAULT_SANDBOX_CONFIG, enabled: true };
    const result = buildContainerConfig(config, "echo hello", "/workspace", 8080);
    const hostConfig = result.HostConfig as Record<string, unknown>;
    expect(hostConfig.CapDrop).toEqual(["ALL"]);
    expect(hostConfig.CapAdd).toEqual(["CHOWN"]);
  });

  it("enables no-new-privileges", () => {
    const config: SandboxConfig = { ...DEFAULT_SANDBOX_CONFIG, enabled: true };
    const result = buildContainerConfig(config, "echo hello", "/workspace", 8080);
    const hostConfig = result.HostConfig as Record<string, unknown>;
    expect(hostConfig.SecurityOpt).toEqual(["no-new-privileges:true"]);
  });

  it("uses readonly rootfs", () => {
    const config: SandboxConfig = { ...DEFAULT_SANDBOX_CONFIG, enabled: true };
    const result = buildContainerConfig(config, "echo hello", "/workspace", 8080);
    const hostConfig = result.HostConfig as Record<string, unknown>;
    expect(hostConfig.ReadonlyRootfs).toBe(true);
  });

  it("sets memory limit to 2GB", () => {
    const config: SandboxConfig = { ...DEFAULT_SANDBOX_CONFIG, enabled: true };
    const result = buildContainerConfig(config, "echo hello", "/workspace", 8080);
    const hostConfig = result.HostConfig as Record<string, unknown>;
    expect(hostConfig.Memory).toBe(2 * 1024 * 1024 * 1024);
  });

  it("sets CPU shares to 1024", () => {
    const config: SandboxConfig = { ...DEFAULT_SANDBOX_CONFIG, enabled: true };
    const result = buildContainerConfig(config, "echo hello", "/workspace", 8080);
    const hostConfig = result.HostConfig as Record<string, unknown>;
    expect(hostConfig.CpuShares).toBe(1024);
  });

  it("disables AutoRemove (logs collected before manual removal)", () => {
    const config: SandboxConfig = { ...DEFAULT_SANDBOX_CONFIG, enabled: true };
    const result = buildContainerConfig(config, "echo hello", "/workspace", 8080);
    const hostConfig = result.HostConfig as Record<string, unknown>;
    expect(hostConfig.AutoRemove).toBe(false);
  });

  it("adds host.docker.internal ExtraHosts only on Linux", () => {
    const config: SandboxConfig = { ...DEFAULT_SANDBOX_CONFIG, enabled: true };
    const result = buildContainerConfig(config, "echo hello", "/workspace", 8080);
    const hostConfig = result.HostConfig as Record<string, unknown>;
    if (process.platform === "linux") {
      expect(hostConfig.ExtraHosts).toEqual(["host.docker.internal:host-gateway"]);
    } else {
      // macOS/Windows: Docker Desktop handles host.docker.internal natively
      expect(hostConfig.ExtraHosts).toBeUndefined();
    }
  });

  it("provides writable /tmp via tmpfs", () => {
    const config: SandboxConfig = { ...DEFAULT_SANDBOX_CONFIG, enabled: true };
    const result = buildContainerConfig(config, "echo hello", "/workspace", 8080);
    const hostConfig = result.HostConfig as Record<string, unknown>;
    expect(hostConfig.Tmpfs).toEqual({ "/tmp": "rw,noexec,nosuid,size=256m" });
  });

  it("uses sh -c to wrap the command", () => {
    const config: SandboxConfig = { ...DEFAULT_SANDBOX_CONFIG, enabled: true };
    const result = buildContainerConfig(config, "ls -la /workspace", "/workspace", 8080);
    expect(result.Cmd).toEqual(["sh", "-c", "ls -la /workspace"]);
  });

  it("sets working directory to /workspace", () => {
    const config: SandboxConfig = { ...DEFAULT_SANDBOX_CONFIG, enabled: true };
    const result = buildContainerConfig(config, "pwd", "/workspace", 8080);
    expect(result.WorkingDir).toBe("/workspace");
  });

  it("uses the configured image", () => {
    const config: SandboxConfig = { ...DEFAULT_SANDBOX_CONFIG, enabled: true, image: "alpine:3.19" };
    const result = buildContainerConfig(config, "echo hello", "/workspace", 8080);
    expect(result.Image).toBe("alpine:3.19");
  });
});

// ── Credential injection via proxy ─────────────────────────────────────────

describe("Credential injection via proxy", () => {
  let proxy: NetworkProxy;
  let backendServer: Server;
  let backendPort: number;
  const receivedHeaders: Record<string, string | string[] | undefined>[] = [];

  beforeEach(async () => {
    receivedHeaders.length = 0;
    // Stand up a simple backend that records received headers
    backendServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      receivedHeaders.push({ ...req.headers });
      res.writeHead(200);
      res.end("ok");
    });
    await new Promise<void>((resolve) => {
      backendServer.listen(0, "127.0.0.1", () => {
        backendPort = (backendServer.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (proxy) await proxy.destroy();
    await new Promise<void>((resolve) => backendServer.close(() => resolve()));
  });

  /** Send an HTTP request through the proxy using proper HTTP proxy protocol (full URL as path). */
  function proxyGet(proxyPort: number, targetUrl: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port: proxyPort,
          path: targetUrl, // HTTP proxy protocol: full URL as the request path
          method: "GET",
        },
        (res) => {
          let body = "";
          res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  it("injects Bearer token for matching domain", async () => {
    const allowlist = createDomainAllowlist(["127.0.0.1"]);
    const mappings: CredentialMapping[] = [
      {
        domainPattern: "127.0.0.1",
        method: { type: "bearer" },
        vaultKey: "test-api-key",
      },
    ];
    const resolver: CredentialResolver = {
      async resolve(key) {
        if (key === "test-api-key") return "secret-token-123";
        return null;
      },
    };

    proxy = await createNetworkProxy(allowlist, mappings, resolver);

    await proxyGet(proxy.port, `http://127.0.0.1:${backendPort}/test`);

    expect(receivedHeaders).toHaveLength(1);
    expect(receivedHeaders[0].authorization).toBe("Bearer secret-token-123");
  });

  it("injects custom header for matching domain", async () => {
    const allowlist = createDomainAllowlist(["127.0.0.1"]);
    const mappings: CredentialMapping[] = [
      {
        domainPattern: "127.0.0.1",
        method: { type: "header", name: "X-Api-Key" },
        vaultKey: "custom-key",
      },
    ];
    const resolver: CredentialResolver = {
      async resolve(key) {
        if (key === "custom-key") return "my-api-key-value";
        return null;
      },
    };

    proxy = await createNetworkProxy(allowlist, mappings, resolver);

    await proxyGet(proxy.port, `http://127.0.0.1:${backendPort}/test`);

    expect(receivedHeaders).toHaveLength(1);
    expect(receivedHeaders[0]["x-api-key"]).toBe("my-api-key-value");
  });

  it("does not inject credentials for non-matching domain", async () => {
    const allowlist = createDomainAllowlist(["127.0.0.1"]);
    const mappings: CredentialMapping[] = [
      {
        domainPattern: "api.github.com",
        method: { type: "bearer" },
        vaultKey: "github-token",
      },
    ];
    const resolver: CredentialResolver = {
      async resolve() {
        return "should-not-appear";
      },
    };

    proxy = await createNetworkProxy(allowlist, mappings, resolver);

    await proxyGet(proxy.port, `http://127.0.0.1:${backendPort}/test`);

    expect(receivedHeaders).toHaveLength(1);
    expect(receivedHeaders[0].authorization).toBeUndefined();
  });

  it("handles missing credentials gracefully (null from resolver)", async () => {
    const allowlist = createDomainAllowlist(["127.0.0.1"]);
    const mappings: CredentialMapping[] = [
      {
        domainPattern: "127.0.0.1",
        method: { type: "bearer" },
        vaultKey: "expired-key",
      },
    ];
    const resolver: CredentialResolver = {
      async resolve() {
        return null; // Simulates expired/missing credential
      },
    };

    proxy = await createNetworkProxy(allowlist, mappings, resolver);

    await proxyGet(proxy.port, `http://127.0.0.1:${backendPort}/test`);

    // No authorization header injected when resolver returns null
    expect(receivedHeaders).toHaveLength(1);
    expect(receivedHeaders[0].authorization).toBeUndefined();
  });
});

// ── Sensitivity HIGH: credential isolation ─────────────────────────────────

describe("HIGH sensitivity: credential isolation", () => {
  it("container env does not contain API keys, by name or by value", () => {
    // Plant a real-shaped secret in the host env under an innocuous NAME. The name-pattern
    // checks below would never see it, so if the builder ever starts forwarding the host
    // env, only the value check catches it.
    const planted = "sk-ant-api03-planted-value-for-this-test";
    process.env["INNOCUOUS_SETTING"] = planted;
    try {
      const config: SandboxConfig = { ...DEFAULT_SANDBOX_CONFIG, enabled: true };
      const result = buildContainerConfig(config, "echo hello", "/workspace", 8080);
      const env = result.Env as string[];

      // The floor: a sandboxed container carries the four proxy vars. With no length floor,
      // an empty Env made every check in the loop below vacuously true.
      expect(env.length, "the env came back empty, so nothing below is being checked")
        .toBeGreaterThanOrEqual(4);
      expect(env.some((e) => e.startsWith("http_proxy="))).toBe(true);
      expect(env.some((e) => e.startsWith("https_proxy="))).toBe(true);

      for (const e of env) {
        // By name...
        expect(e).not.toMatch(/api[_-]?key/i);
        expect(e).not.toMatch(/secret/i);
        expect(e).not.toMatch(/token/i);
        expect(e).not.toMatch(/password/i);
        expect(e).not.toMatch(/credential/i);
        // ...and by value: a bare key in an innocuously-named var must not pass.
        expect(e).not.toContain(planted);
        expect(e).not.toMatch(/sk-ant-|sk-proj-|ghp_|AKIA|xoxb-/);
      }
    } finally {
      delete process.env["INNOCUOUS_SETTING"];
    }
  });

  it("container env for full-access has no env vars (no proxy)", () => {
    const config: SandboxConfig = {
      ...DEFAULT_SANDBOX_CONFIG,
      enabled: true,
      policy: "full-access",
      allowFullAccess: true,
    };
    const result = buildContainerConfig(config, "echo hello", "/workspace", 8080);
    const env = result.Env as string[];
    expect(env).toHaveLength(0);
  });

  it("proxy strips hop-by-hop headers", () => {
    // Verify the set contains all expected headers
    expect(HOP_BY_HOP_HEADERS.has("proxy-authorization")).toBe(true);
    expect(HOP_BY_HOP_HEADERS.has("connection")).toBe(true);
    expect(HOP_BY_HOP_HEADERS.has("transfer-encoding")).toBe(true);
  });
});

// ── Resource limits ────────────────────────────────────────────────────────

describe("Resource limits defaults", () => {
  it("default memory is 2GB", () => {
    expect(DEFAULT_RESOURCE_LIMITS.memoryBytes).toBe(2 * 1024 * 1024 * 1024);
  });

  it("default CPU shares is 1024", () => {
    expect(DEFAULT_RESOURCE_LIMITS.cpuShares).toBe(1024);
  });

  it("default timeout is 120s", () => {
    expect(DEFAULT_RESOURCE_LIMITS.timeoutMs).toBe(120_000);
  });

  it("default max output is 64KB", () => {
    expect(DEFAULT_RESOURCE_LIMITS.maxOutputBytes).toBe(64 * 1024);
  });
});

// ── Default config ─────────────────────────────────────────────────────────

describe("Default sandbox config", () => {
  it("is disabled by default", () => {
    expect(DEFAULT_SANDBOX_CONFIG.enabled).toBe(false);
  });

  it("defaults to readonly policy", () => {
    expect(DEFAULT_SANDBOX_CONFIG.policy).toBe("readonly");
  });

  it("disallows full-access by default", () => {
    expect(DEFAULT_SANDBOX_CONFIG.allowFullAccess).toBe(false);
  });

  it("uses node:22-slim as default image", () => {
    expect(DEFAULT_SANDBOX_CONFIG.image).toBe("node:22-slim");
  });

  it("auto-ensures image by default", () => {
    expect(DEFAULT_SANDBOX_CONFIG.autoEnsureImage).toBe(true);
  });

  it("uses auto port (0) by default", () => {
    expect(DEFAULT_SANDBOX_CONFIG.proxyPort).toBe(0);
  });
});

// ── Docker detection (fast-fail, adapted from IronClaw) ───────────────────

describe("detectDocker — fast-fail detection", () => {
  const originalEnv = process.env["DOCKER_HOST"];

  afterEach(() => {
    // Restore DOCKER_HOST
    if (originalEnv !== undefined) {
      process.env["DOCKER_HOST"] = originalEnv;
    } else {
      delete process.env["DOCKER_HOST"];
    }
  });

  it("returns a DockerDetectionResult with available, method, and detail", () => {
    const result = detectDocker();
    expect(result).toHaveProperty("available");
    expect(result).toHaveProperty("method");
    expect(result).toHaveProperty("detail");
    expect(typeof result.available).toBe("boolean");
    expect(["socket", "env", "default", "none"]).toContain(result.method);
    expect(typeof result.detail).toBe("string");
  });

  it("detects DOCKER_HOST env var when set", () => {
    process.env["DOCKER_HOST"] = "tcp://localhost:2375";
    const result = detectDocker();
    expect(result.available).toBe(true);
    expect(result.method).toBe("env");
    expect(result.detail).toContain("tcp://localhost:2375");
  });

  it("returns method='none' and install hint when no Docker socket and no DOCKER_HOST", () => {
    delete process.env["DOCKER_HOST"];
    // On CI or machines without Docker, this should return none
    const result = detectDocker();
    // We can't guarantee Docker isn't installed on the test machine,
    // so we just verify the structure is correct
    if (!result.available) {
      expect(result.method).toBe("none");
      expect(result.detail).toContain("No Docker socket found");
      // Platform-specific install hint
      if (process.platform === "darwin") {
        expect(result.detail).toContain("Docker Desktop");
      } else if (process.platform === "linux") {
        expect(result.detail).toContain("Docker Engine");
      }
    }
  });

  it("when Docker IS available, method is 'socket' or 'env'", () => {
    const result = detectDocker();
    if (result.available) {
      expect(["socket", "env"]).toContain(result.method);
      expect(result.detail.length).toBeGreaterThan(0);
    }
  });
});

describe("connectDocker — uses detection result", () => {
  it("throws SandboxError with DOCKER_NOT_AVAILABLE when no Docker", () => {
    const detection = detectDocker();
    if (!detection.available) {
      expect(() => connectDocker()).toThrow(SandboxError);
      try {
        connectDocker();
      } catch (err) {
        expect((err as SandboxError).code).toBe("DOCKER_NOT_AVAILABLE");
      }
    }
  });

  it("returns a Docker instance when Docker is available", () => {
    const detection = detectDocker();
    if (detection.available) {
      const docker = connectDocker();
      expect(docker).toBeDefined();
      expect(typeof docker.ping).toBe("function");
    }
  });
});

// ── Platform-aware ExtraHosts ─────────────────────────────────────────────

describe("Platform-aware container config", () => {
  it("buildContainerConfig includes platform-appropriate ExtraHosts", () => {
    const config: SandboxConfig = { ...DEFAULT_SANDBOX_CONFIG, enabled: true };
    const result = buildContainerConfig(config, "echo test", "/workspace", 8080);
    const hostConfig = result.HostConfig as Record<string, unknown>;

    if (process.platform === "linux") {
      expect(hostConfig.ExtraHosts).toEqual(["host.docker.internal:host-gateway"]);
    } else {
      // macOS/Windows: Docker Desktop natively supports host.docker.internal
      expect(hostConfig.ExtraHosts).toBeUndefined();
    }
  });

  it("container config always has security hardening regardless of platform", () => {
    const config: SandboxConfig = { ...DEFAULT_SANDBOX_CONFIG, enabled: true };
    const result = buildContainerConfig(config, "echo test", "/workspace", 8080);
    const hostConfig = result.HostConfig as Record<string, unknown>;

    // These must be present on ALL platforms
    expect(hostConfig.CapDrop).toEqual(["ALL"]);
    expect(hostConfig.CapAdd).toEqual(["CHOWN"]);
    expect(hostConfig.SecurityOpt).toEqual(["no-new-privileges:true"]);
    expect(hostConfig.ReadonlyRootfs).toBe(true);
    expect(hostConfig.Tmpfs).toEqual({ "/tmp": "rw,noexec,nosuid,size=256m" });
    expect(result.User).toBe("1000:1000");
  });
});
