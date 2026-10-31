// Container runner: Docker lifecycle and network proxy.
// Ported from IronClaw sandbox/container.rs + sandbox/proxy/.
// Uses dockerode for container management and http.createServer for proxy.

import { existsSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { createLogger } from "../utils/logger.js";
import { connect as netConnect } from "node:net";
import type { Server, IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { AddressInfo } from "node:net";
import Docker from "dockerode";
import type {
  SandboxConfig,
  SandboxPolicy,
  DomainAllowlist,
  CredentialMapping,
  CredentialResolver,
  ResourceLimits,
} from "./policies.js";
import {
  allowsWrites,
  hasFullNetwork,
  isSandboxed,
  createDomainAllowlist,
  DEFAULT_RESOURCE_LIMITS,
  HOP_BY_HOP_HEADERS,
} from "./policies.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ContainerRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  truncated: boolean;
}

export interface ContainerRunner {
  /** Execute a command inside a sandboxed container. */
  run(command: string, workspacePath: string, timeoutMs?: number): Promise<ContainerRunResult>;
  /** Shut down the proxy and clean up resources. */
  destroy(): Promise<void>;
}

export interface ContainerRunnerDeps {
  config: SandboxConfig;
  credentialMappings?: CredentialMapping[];
  credentialResolver?: CredentialResolver;
}

// ── Errors ─────────────────────────────────────────────────────────────────

export class SandboxError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "DOCKER_NOT_AVAILABLE"
      | "CONTAINER_CREATION_FAILED"
      | "CONTAINER_START_FAILED"
      | "FULL_ACCESS_DENIED"
      | "PROXY_FAILED"
      | "IMAGE_PULL_FAILED"
      | "TIMEOUT",
  ) {
    super(message);
    this.name = "SandboxError";
  }
}

function isTransientError(code: string): boolean {
  return (
    code === "DOCKER_NOT_AVAILABLE" ||
    code === "CONTAINER_CREATION_FAILED" ||
    code === "CONTAINER_START_FAILED"
  );
}

// ── Docker detection (fast-fail, adapted from IronClaw) ───────────────────

const DOCKER_SOCKET_PATHS: Record<string, string[]> = {
  darwin: [
    "/var/run/docker.sock",
    ...(process.env["HOME"] ? [`${process.env["HOME"]}/.docker/run/docker.sock`] : []),
  ],
  linux: ["/var/run/docker.sock", `/run/user/${process.getuid?.() ?? 1000}/docker.sock`],
  win32: ["\\\\.\\pipe\\docker_engine"],
};

export interface DockerDetectionResult {
  available: boolean;
  method: "socket" | "env" | "none";
  detail: string;
}

/**
 * Fast-fail Docker detection. Checks cheap filesystem signals before
 * attempting expensive daemon ping. Avoids the 120s timeout when Docker
 * is installed but the daemon isn't running.
 *
 * Resolution order (adapted from Hermes Agent and IronClaw):
 * 1. DOCKER_HOST env var, explicit override, trust it
 * 2. Platform-specific socket paths, fast stat() check
 * 3. dockerode default, last resort
 */
export function detectDocker(): DockerDetectionResult {
  // 1. Explicit DOCKER_HOST env var
  const dockerHost = process.env["DOCKER_HOST"];
  if (dockerHost) {
    return { available: true, method: "env", detail: `DOCKER_HOST=${dockerHost}` };
  }

  // 2. Platform-specific socket paths (fast filesystem check, no network)
  const platform = process.platform;
  const socketPaths = DOCKER_SOCKET_PATHS[platform] ?? DOCKER_SOCKET_PATHS["linux"]!;

  for (const socketPath of socketPaths) {
    if (!socketPath) continue;
    try {
      if (existsSync(socketPath)) {
        return { available: true, method: "socket", detail: socketPath };
      }
    } catch {
      // Permission denied or other error: skip
    }
  }

  // 3. No socket found, Docker likely not installed or not running
  const installHint = platform === "darwin"
    ? "Install Docker Desktop from docker.com or run: brew install --cask docker"
    : platform === "linux"
      ? "Install Docker Engine: https://docs.docker.com/engine/install/ — or start the daemon: sudo systemctl start docker"
      : "Install Docker Desktop from docker.com";

  return { available: false, method: "none", detail: `No Docker socket found. ${installHint}` };
}

export function connectDocker(): Docker {
  const detection = detectDocker();
  if (!detection.available) {
    throw new SandboxError(detection.detail, "DOCKER_NOT_AVAILABLE");
  }
  if (detection.method === "env") {
    return new Docker(); // dockerode reads DOCKER_HOST from env
  }
  // method === "socket"
  return new Docker({ socketPath: detection.detail });
}

// ── Image management ───────────────────────────────────────────────────────

export async function ensureImage(
  docker: Docker,
  image: string,
): Promise<void> {
  try {
    await docker.getImage(image).inspect();
  } catch {
    // Image not found locally: pull it
    const stream = await docker.pull(image);
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(
        stream,
        (err: Error | null) => {
          if (err) reject(new SandboxError(`Failed to pull image ${image}: ${err.message}`, "IMAGE_PULL_FAILED"));
          else resolve();
        },
      );
    });
  }
}

// ── Network proxy ──────────────────────────────────────────────────────────

export interface NetworkProxy {
  port: number;
  server: Server;
  destroy(): Promise<void>;
}

export function createNetworkProxy(
  allowlist: DomainAllowlist,
  credentialMappings: CredentialMapping[],
  credentialResolver: CredentialResolver | null,
): Promise<NetworkProxy> {
  const activeSockets = new Set<Socket>();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // HTTP proxy: forward non-CONNECT requests
    const targetUrl = req.url;
    if (!targetUrl) {
      res.writeHead(400);
      res.end("Bad Request: missing URL");
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      res.writeHead(400);
      res.end("Bad Request: invalid URL");
      return;
    }

    if (!allowlist.isAllowed(parsed.hostname)) {
      res.writeHead(403);
      res.end(`Forbidden: ${parsed.hostname} not in network allowlist`);
      return;
    }

    // Build outgoing headers: strip hop-by-hop
    const outHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
      if (key.toLowerCase() === "host") continue;
      if (typeof value === "string") outHeaders[key] = value;
    }

    // Credential injection
    await injectCredentials(parsed.hostname, outHeaders, credentialMappings, credentialResolver);

    let upstreamTimedOut = false;
    const proxyReq = httpRequest(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: req.method,
        headers: outHeaders,
      },
      (proxyRes) => {
        const resHeaders: Record<string, string | string[]> = {};
        for (const [key, value] of Object.entries(proxyRes.headers)) {
          if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
          if (value !== undefined) resHeaders[key] = value;
        }
        res.writeHead(proxyRes.statusCode ?? 502, resHeaders);
        proxyRes.pipe(res);
      },
    );

    proxyReq.on("error", () => {
      if (!res.headersSent) {
        res.writeHead(upstreamTimedOut ? 504 : 502);
        res.end(upstreamTimedOut ? "Gateway Timeout" : "Bad Gateway");
      }
    });
    proxyReq.setTimeout(10_000, () => {
      upstreamTimedOut = true;
      proxyReq.destroy();
    });

    req.pipe(proxyReq);
  });

  // CONNECT tunneling (HTTPS)
  server.on("connect", async (req: IncomingMessage, clientSocket: Socket, head: Buffer) => {
    activeSockets.add(clientSocket);
    clientSocket.on("close", () => activeSockets.delete(clientSocket));

    const hostPort = req.url ?? "";
    const [hostname, portStr] = hostPort.split(":");
    const port = parseInt(portStr, 10) || 443;

    if (!hostname || !allowlist.isAllowed(hostname)) {
      clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      clientSocket.end();
      return;
    }

    const serverSocket = netConnect(port, hostname, () => {
      activeSockets.add(serverSocket);
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on("close", () => activeSockets.delete(serverSocket));
    serverSocket.on("error", () => {
      clientSocket.end();
    });
    clientSocket.on("error", () => {
      serverSocket.end();
    });
  });

  return new Promise<NetworkProxy>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        port: addr.port,
        server,
        async destroy() {
          for (const sock of activeSockets) {
            sock.destroy();
          }
          activeSockets.clear();
          await new Promise<void>((res) => server.close(() => res()));
        },
      });
    });
    server.on("error", (err) => {
      reject(new SandboxError(`Proxy server failed: ${err.message}`, "PROXY_FAILED"));
    });
  });
}

async function injectCredentials(
  hostname: string,
  headers: Record<string, string>,
  mappings: CredentialMapping[],
  resolver: CredentialResolver | null,
): Promise<void> {
  if (!resolver || mappings.length === 0) return;

  for (const mapping of mappings) {
    const singleAllowlist = createDomainAllowlist([mapping.domainPattern]);
    if (!singleAllowlist.isAllowed(hostname)) continue;

    const secret = await resolver.resolve(mapping.vaultKey);
    if (!secret) continue;

    switch (mapping.method.type) {
      case "bearer":
        headers["authorization"] = `Bearer ${secret}`;
        break;
      case "header":
        headers[mapping.method.name.toLowerCase()] = secret;
        break;
      case "query":
        // Query param injection is handled at URL level, not header level.
        // For simplicity we skip it in the proxy header injection.
        // In a full implementation, the URL would be rewritten.
        break;
    }
  }
}

// ── Container runner ───────────────────────────────────────────────────────

const logger = createLogger("sandbox");

export function createContainerRunner(deps: ContainerRunnerDeps): ContainerRunner {
  const { config } = deps;
  let proxy: NetworkProxy | null = null;
  let docker: Docker | null = null;

  // FullAccess double opt-in guard
  if (config.policy === "full-access" && !config.allowFullAccess) {
    throw new SandboxError(
      "FullAccess policy requires explicit opt-in: set allowFullAccess=true in sandbox config. " +
        "This policy gives the container full host access — use with extreme caution.",
      "FULL_ACCESS_DENIED",
    );
  }

  const limits: ResourceLimits = {
    memoryBytes: config.memoryLimitMb * 1024 * 1024,
    cpuShares: config.cpuShares,
    timeoutMs: config.timeoutMs,
    maxOutputBytes: DEFAULT_RESOURCE_LIMITS.maxOutputBytes,
  };

  async function getDocker(): Promise<Docker> {
    if (docker) {
      // Health check: verify cached connection is still alive
      try {
        await Promise.race([
          docker.ping(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("ping timeout")), 5_000)),
        ]);
        return docker;
      } catch {
        // Docker daemon died since last use, reconnect
        docker = null;
      }
    }
    docker = connectDocker();
    // Verify connection with timeout (avoids 120s hang when daemon is unresponsive)
    try {
      await Promise.race([
        docker.ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Docker daemon not responding (5s timeout)")), 5_000)),
      ]);
    } catch (err) {
      docker = null;
      const msg = err instanceof Error ? err.message : String(err);
      throw new SandboxError(`Docker not available: ${msg}`, "DOCKER_NOT_AVAILABLE");
    }
    return docker;
  }

  async function getProxy(): Promise<NetworkProxy> {
    if (proxy) return proxy;
    const allowlist = createDomainAllowlist(config.networkAllowlist);
    proxy = await createNetworkProxy(
      allowlist,
      deps.credentialMappings ?? [],
      deps.credentialResolver ?? null,
    );
    return proxy;
  }

  function buildProxyEnv(proxyPort: number): string[] {
    // host.docker.internal works on macOS/Windows. On Linux, ExtraHosts maps it.
    const proxyUrl = `http://host.docker.internal:${proxyPort}`;
    return [
      `http_proxy=${proxyUrl}`,
      `https_proxy=${proxyUrl}`,
      `HTTP_PROXY=${proxyUrl}`,
      `HTTPS_PROXY=${proxyUrl}`,
    ];
  }

  function buildBinds(workspacePath: string, policy: SandboxPolicy): string[] {
    const mode = allowsWrites(policy) ? "rw" : "ro";
    return [`${workspacePath}:/workspace:${mode}`];
  }

  function truncateOutput(output: string): { text: string; truncated: boolean } {
    const bytes = Buffer.byteLength(output, "utf-8");
    if (bytes <= limits.maxOutputBytes) {
      return { text: output, truncated: false };
    }
    // Truncate to fit within byte limit
    const buf = Buffer.from(output, "utf-8");
    const sliced = buf.subarray(0, limits.maxOutputBytes);
    return {
      text: sliced.toString("utf-8") + "\n... (output truncated at 64 KB)",
      truncated: true,
    };
  }

  async function runOnce(
    command: string,
    workspacePath: string,
    timeoutMs = limits.timeoutMs,
  ): Promise<ContainerRunResult> {
    const d = await getDocker();

    if (config.autoEnsureImage) {
      await ensureImage(d, config.image);
    }

    // For sandboxed policies, start proxy; for full-access, skip
    let proxyPort = 0;
    let env: string[] = [];

    if (isSandboxed(config.policy)) {
      const p = await getProxy();
      proxyPort = p.port;
      env = buildProxyEnv(proxyPort);
    }

    const binds = hasFullNetwork(config.policy) ? [] : buildBinds(workspacePath, config.policy);

    const container = await d.createContainer({
      Image: config.image,
      Cmd: ["sh", "-c", command],
      WorkingDir: "/workspace",
      User: "1000:1000",
      Env: env,
      AttachStdout: true,
      AttachStderr: true,
      HostConfig: {
        Binds: binds,
        Memory: limits.memoryBytes,
        CpuShares: limits.cpuShares,
        AutoRemove: false,
        CapDrop: ["ALL"],
        CapAdd: ["CHOWN"],
        SecurityOpt: ["no-new-privileges:true"],
        ReadonlyRootfs: true,
        Tmpfs: { "/tmp": "rw,noexec,nosuid,size=256m" },
        // host.docker.internal is built-in on Docker Desktop (macOS/Windows).
        // On Linux, ExtraHosts maps it via host-gateway.
        ...(process.platform === "linux" ? { ExtraHosts: ["host.docker.internal:host-gateway"] } : {}),
      },
    });

    try {
      await container.start();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new SandboxError(`Container start failed: ${msg}`, "CONTAINER_START_FAILED");
    }

    // Wait with timeout
    let timedOut = false;
    const waitResult = await Promise.race([
      container.wait() as Promise<{ StatusCode: number }>,
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);

    if (waitResult === null) {
      timedOut = true;
      try {
        await container.kill();
      } catch {
        // Container may already be stopped
      }
    }

    // Collect logs before removing the container
    let stdout = "";
    let stderr = "";
    try {
      const logStream = await container.logs({
        stdout: true,
        stderr: true,
        follow: false,
      });
      // dockerode returns a Buffer or readable stream
      const raw = typeof logStream === "string" ? Buffer.from(logStream) : Buffer.from(logStream);
      // Docker multiplexed stream format: 8-byte header per frame.
      // Byte 0 = stream type (1=stdout, 2=stderr), bytes 4-7 = frame length (big-endian).
      const parsed = parseDemuxStream(raw);
      stdout = parsed.stdout;
      stderr = parsed.stderr;
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "container log collection failed — proceeding with empty output");
    }

    // Clean up container now that logs are collected
    try {
      await container.remove({ force: true });
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), containerId: container.id }, "container removal failed — orphaned container may need manual cleanup");
    }

    const exitCode = waitResult !== null ? (waitResult as { StatusCode: number }).StatusCode : 137;
    const { text: truncatedStdout, truncated } = truncateOutput(stdout);

    return {
      stdout: truncatedStdout,
      stderr,
      exitCode,
      timedOut,
      truncated,
    };
  }

  return {
    async run(command: string, workspacePath: string, timeoutMs?: number): Promise<ContainerRunResult> {
      // Retry transient errors up to 2 times with exponential backoff
      let lastError: SandboxError | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await runOnce(command, workspacePath, timeoutMs);
        } catch (err) {
          if (err instanceof SandboxError && isTransientError(err.code)) {
            lastError = err;
            if (attempt < 2) {
              const delay = 500 * Math.pow(2, attempt);
              await new Promise((resolve) => setTimeout(resolve, delay));
              continue;
            }
          }
          throw err;
        }
      }
      throw lastError!;
    },

    async destroy(): Promise<void> {
      if (proxy) {
        await proxy.destroy();
        proxy = null;
      }
      docker = null;
    },
  };
}

// ── Docker stream demux ───────────────────────────────────────────────────

/**
 * Parse Docker multiplexed stream into separate stdout/stderr.
 * Format: 8-byte header per frame.
 *   byte 0: stream type (1=stdout, 2=stderr)
 *   bytes 1-3: padding
 *   bytes 4-7: frame payload length (big-endian uint32)
 *   followed by `length` bytes of payload
 *
 * Falls back to treating entire buffer as stdout if headers don't parse
 * (e.g., when TTY mode produces raw output without framing).
 */
export function parseDemuxStream(buf: Buffer): { stdout: string; stderr: string } {
  const stdoutParts: Buffer[] = [];
  const stderrParts: Buffer[] = [];
  let offset = 0;

  while (offset + 8 <= buf.length) {
    const streamType = buf[offset]!;
    // Validate stream type (0=stdin, 1=stdout, 2=stderr)
    if (streamType > 2) {
      // Not a valid multiplexed stream: treat entire buffer as stdout
      return { stdout: buf.toString("utf-8"), stderr: "" };
    }
    const frameLen = buf.readUInt32BE(offset + 4);
    offset += 8;

    if (offset + frameLen > buf.length) {
      // Truncated frame: take what's available
      const chunk = buf.subarray(offset);
      if (streamType === 2) stderrParts.push(chunk);
      else stdoutParts.push(chunk);
      break;
    }

    const chunk = buf.subarray(offset, offset + frameLen);
    if (streamType === 2) {
      stderrParts.push(chunk);
    } else {
      stdoutParts.push(chunk);
    }
    offset += frameLen;
  }

  return {
    stdout: Buffer.concat(stdoutParts).toString("utf-8"),
    stderr: Buffer.concat(stderrParts).toString("utf-8"),
  };
}

// ── Exported for testing ───────────────────────────────────────────────────

/** Build container create options without actually creating a container. For testing. */
export function buildContainerConfig(
  config: SandboxConfig,
  command: string,
  workspacePath: string,
  proxyPort: number,
): Record<string, unknown> {
  const limits: ResourceLimits = {
    memoryBytes: config.memoryLimitMb * 1024 * 1024,
    cpuShares: config.cpuShares,
    timeoutMs: config.timeoutMs,
    maxOutputBytes: DEFAULT_RESOURCE_LIMITS.maxOutputBytes,
  };

  const env = isSandboxed(config.policy)
    ? [
        `http_proxy=http://host.docker.internal:${proxyPort}`,
        `https_proxy=http://host.docker.internal:${proxyPort}`,
        `HTTP_PROXY=http://host.docker.internal:${proxyPort}`,
        `HTTPS_PROXY=http://host.docker.internal:${proxyPort}`,
      ]
    : [];

  const mode = allowsWrites(config.policy) ? "rw" : "ro";
  const binds = hasFullNetwork(config.policy) ? [] : [`${workspacePath}:/workspace:${mode}`];

  return {
    Image: config.image,
    Cmd: ["sh", "-c", command],
    WorkingDir: "/workspace",
    User: "1000:1000",
    Env: env,
    HostConfig: {
      Binds: binds,
      Memory: limits.memoryBytes,
      CpuShares: limits.cpuShares,
      AutoRemove: false,
      CapDrop: ["ALL"],
      CapAdd: ["CHOWN"],
      SecurityOpt: ["no-new-privileges:true"],
      ReadonlyRootfs: true,
      Tmpfs: { "/tmp": "rw,noexec,nosuid,size=256m" },
      // host.docker.internal is built-in on Docker Desktop (macOS/Windows).
      // On Linux, ExtraHosts maps it via host-gateway.
      ...(process.platform === "linux" ? { ExtraHosts: ["host.docker.internal:host-gateway"] } : {}),
    },
  };
}
