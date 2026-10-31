///SSRF protection with DNS-rebinding defense.
// Validates all resolved IPs against private ranges before making HTTP requests.
// Uses a custom http.Agent with lookup override to pin resolved IP (anti-rebinding).

import * as dns from "node:dns";
import * as http from "node:http";
import * as https from "node:https";

export class SSRFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SSRFError";
  }
}

// Private IP ranges to block:
// 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10 (CGNAT), 127.0.0.0/8,
// 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16
const PRIVATE_RANGES_V4: Array<{ base: number; mask: number }> = [
  { base: 0x00000000, mask: 0xff000000 },       // 0.0.0.0/8
  { base: 0x0a000000, mask: 0xff000000 },       // 10.0.0.0/8
  { base: 0x64400000, mask: 0xffc00000 },       // 100.64.0.0/10 (CGNAT)
  { base: 0x7f000000, mask: 0xff000000 },       // 127.0.0.0/8
  { base: 0xa9fe0000, mask: 0xffff0000 },       // 169.254.0.0/16
  { base: 0xac100000, mask: 0xfff00000 },       // 172.16.0.0/12
  { base: 0xc0a80000, mask: 0xffff0000 },       // 192.168.0.0/16
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".");
  if (parts.length !== 4) return -1;
  let n = 0;
  for (const part of parts) {
    const octet = parseInt(part, 10);
    if (isNaN(octet) || octet < 0 || octet > 255) return -1;
    n = (n << 8) | octet;
  }
  return n >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === -1) return false;
  for (const range of PRIVATE_RANGES_V4) {
    // Both sides must be unsigned: bitwise AND in JS returns signed int32
    if (((n & range.mask) >>> 0) === (range.base >>> 0)) return true;
  }
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();

  // IPv4-mapped IPv6: ::ffff:x.x.x.x
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    return isPrivateIPv4(mapped[1]);
  }

  // ::1 loopback
  if (lower === "::1") return true;

  // fc00::/7, unique local (fc00:: to fdff::)
  // First 7 bits must be 1111110x → starts with fc or fd
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;

  // fe80::/10, link-local
  // First 10 bits must be 1111111010 → fe80:: to febf::
  const fe80Match = lower.match(/^fe([89ab][0-9a-f])/);
  if (fe80Match) return true;

  return false;
}

export function isPrivateIP(ip: string): boolean {
  // Distinguish IPv6 from IPv4 by presence of ":"
  if (ip.includes(":")) {
    return isPrivateIPv6(ip);
  }
  return isPrivateIPv4(ip);
}

async function resolveAllIPs(hostname: string): Promise<string[]> {
  const results: string[] = [];
  const errors: unknown[] = [];

  try {
    const v4 = await dns.promises.resolve4(hostname);
    results.push(...v4);
  } catch (err) {
    errors.push(err);
  }

  try {
    const v6 = await dns.promises.resolve6(hostname);
    results.push(...v6);
  } catch (err) {
    errors.push(err);
  }

  if (results.length === 0) {
    // Both failed: re-throw the first DNS error
    throw errors[0] ?? new Error(`DNS resolution failed for ${hostname}`);
  }

  return results;
}

export async function validatePublicHttpUrl(urlString: string): Promise<void> {
  const url = new URL(urlString);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SSRFError(`Unsupported protocol: ${url.protocol}`);
  }

  if (url.hostname === "metadata.google.internal") {
    throw new SSRFError("SSRF blocked: metadata host is not allowed");
  }

  const resolvedIPs = await resolveAllIPs(url.hostname);
  for (const ip of resolvedIPs) {
    if (isPrivateIP(ip)) {
      throw new SSRFError(`SSRF blocked: ${url.hostname} resolves to private IP ${ip}`);
    }
  }
}

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
}

export interface SafeFetchResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  bodyBuffer: Buffer;
}

export async function safeFetch(
  urlString: string,
  options: SafeFetchOptions = {},
  redirectCount = 0,
): Promise<SafeFetchResponse> {
  const url = new URL(urlString);
  const isHttps = url.protocol === "https:";

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SSRFError(`Unsupported protocol: ${url.protocol}`);
  }

  const hostname = url.hostname;
  await validatePublicHttpUrl(urlString);
  const resolvedIPs = await resolveAllIPs(hostname);

  // THE PIN IS CHECKED, and until now it was not.
  //
  // `validatePublicHttpUrl` resolves the name, checks every answer, and throws the answers
  // away. This second query is what the connection actually uses, and its result had never
  // been through `isPrivateIP`. So the two DNS lookups could return different things, which
  // is not a hypothetical: it is precisely what an attacker-controlled authoritative server
  // answering with TTL 0 does. Public on the first query, private on the second.
  //
  // The pin was written to STOP rebinding and, unchecked, was the mechanism that performed
  // it: she would validate a public address and then connect to 127.0.0.1, where her own
  // face and her own model live. Checking what is actually pinned costs one loop.
  for (const ip of resolvedIPs) {
    if (isPrivateIP(ip)) {
      throw new SSRFError(`${hostname} resolves to a private address (${ip}) — refusing to connect`);
    }
  }
  const pinnedIP = resolvedIPs[0];
  const port = url.port
    ? parseInt(url.port, 10)
    : isHttps
    ? 443
    : 80;

    return new Promise((resolve, reject) => {
    const timeout = options.timeoutMs ?? 10_000;
    const maxBytes = options.maxBytes ?? 50 * 1024 * 1024;
    const maxRedirects = options.maxRedirects ?? 5;

    // Custom lookup that returns the pre-resolved IP, no second DNS query.
    // Node may call with (host, opts, cb) where opts.all=true expects array result.
    function pinnedLookup(
      _host: string,
      opts: unknown,
      callback: (err: NodeJS.ErrnoException | null, ...results: unknown[]) => void
    ): void {
      const family = pinnedIP.includes(":") ? 6 : 4;
      const allMode = typeof opts === "object" && opts !== null && (opts as Record<string, unknown>).all === true;
      if (allMode) {
        callback(null, [{ address: pinnedIP, family }]);
      } else {
        callback(null, pinnedIP, family);
      }
    }

    const agentOptions = { lookup: pinnedLookup };
    const agent = isHttps
      ? new https.Agent(agentOptions as https.AgentOptions)
      : new http.Agent(agentOptions as http.AgentOptions);

    const requestOptions: http.RequestOptions = {
      hostname,
      port,
      path: url.pathname + url.search,
      method: options.method ?? "GET",
      headers: {
        Host: hostname,
        ...(options.headers ?? {}),
      },
      agent,
    };

      const req = (isHttps ? https : http).request(requestOptions, (res) => {
      const status = res.statusCode ?? 0;
      const location = typeof res.headers.location === "string" ? res.headers.location : undefined;
      if (status >= 300 && status < 400 && location) {
        res.resume();
        if (redirectCount >= maxRedirects) {
          reject(new Error(`Too many redirects after ${maxRedirects}`));
          return;
        }
        let redirectedUrl: string;
        try {
          redirectedUrl = new URL(location, url).toString();
        } catch (err) {
          reject(err);
          return;
        }
        const redirectMethod = status === 303 ? "GET" : options.method;
        const redirectOptions: SafeFetchOptions = {
          ...options,
          method: redirectMethod,
          body: redirectMethod === "GET" ? undefined : options.body,
        };
        safeFetch(redirectedUrl, redirectOptions, redirectCount + 1).then(resolve, reject);
        return;
      }
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let overLimit = false;
      res.on("data", (chunk: Buffer) => {
        if (overLimit) return;
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          overLimit = true;
          req.destroy(new SSRFError(`Response too large: exceeded ${maxBytes} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        if (overLimit) return;
        const bodyBuffer = Buffer.concat(chunks);
        const body = bodyBuffer.toString("utf8");
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === "string") headers[k] = v;
          else if (Array.isArray(v)) headers[k] = v.join(", ");
        }
        resolve({ status: res.statusCode ?? 0, headers, body, bodyBuffer });
      });
      res.on("error", reject);
    });

      req.setTimeout(timeout, () => {
        req.destroy(new Error(`Request timed out after ${timeout}ms`));
      });
      if (options.signal) {
        if (options.signal.aborted) {
          req.destroy(new Error("Request aborted"));
        } else {
          options.signal.addEventListener("abort", () => {
            req.destroy(new Error("Request aborted"));
          }, { once: true });
        }
      }

    req.on("error", reject);

    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}
