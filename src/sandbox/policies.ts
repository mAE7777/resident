// Sandbox policies: SandboxPolicy enum, domain allowlist, config types.
// Ported from IronClaw sandbox/config.rs. TypeScript adaptation uses
// string enums and plain objects instead of Rust enums + impl blocks.

// ── SandboxPolicy ──────────────────────────────────────────────────────────

export type SandboxPolicy = "readonly" | "workspace-write" | "full-access";

export function allowsWrites(policy: SandboxPolicy): boolean {
  return policy === "workspace-write" || policy === "full-access";
}

export function hasFullNetwork(policy: SandboxPolicy): boolean {
  return policy === "full-access";
}

export function isSandboxed(policy: SandboxPolicy): boolean {
  return policy !== "full-access";
}

// ── Resource limits ────────────────────────────────────────────────────────

export interface ResourceLimits {
  memoryBytes: number;
  cpuShares: number;
  timeoutMs: number;
  maxOutputBytes: number;
}

export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  memoryBytes: 2 * 1024 * 1024 * 1024, // 2 GB
  cpuShares: 1024,
  timeoutMs: 120_000, // 120 s
  maxOutputBytes: 64 * 1024, // 64 KB
};

// ── Sandbox config ─────────────────────────────────────────────────────────

export interface SandboxConfig {
  enabled: boolean;
  policy: SandboxPolicy;
  allowFullAccess: boolean;
  timeoutMs: number;
  memoryLimitMb: number;
  cpuShares: number;
  networkAllowlist: string[];
  image: string;
  autoEnsureImage: boolean;
  proxyPort: number; // 0 = auto-assign
}

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  enabled: false,
  policy: "readonly",
  allowFullAccess: false,
  timeoutMs: 120_000,
  memoryLimitMb: 2048,
  cpuShares: 1024,
  networkAllowlist: defaultAllowlist(),
  image: "node:22-slim",
  autoEnsureImage: true,
  proxyPort: 0,
};

// ── Network allowlist ──────────────────────────────────────────────────────

export function defaultAllowlist(): string[] {
  return [
    "npmjs.com",
    "*.npmjs.com",
    "registry.npmjs.org",
    "*.registry.npmjs.org",
    "github.com",
    "*.github.com",
    "api.github.com",
    "api.anthropic.com",
    "api.ollama.local",
  ];
}

export interface DomainAllowlist {
  /** Check if a hostname is allowed by the list. */
  isAllowed(hostname: string): boolean;
  /** Return a copy of the current rules. */
  rules(): string[];
}

/**
 * Create a domain allowlist from a list of domain patterns.
 * Supports exact match (e.g. "github.com") and wildcard subdomains
 * (e.g. "*.github.com" matches "api.github.com" but not "github.com" itself).
 */
export function createDomainAllowlist(patterns: string[]): DomainAllowlist {
  const exact = new Set<string>();
  const wildcards: string[] = [];

  for (const p of patterns) {
    const trimmed = p.trim().toLowerCase();
    if (trimmed.startsWith("*.")) {
      wildcards.push(trimmed.slice(1)); // "*.github.com" → ".github.com"
    } else {
      exact.add(trimmed);
    }
  }

  return {
    isAllowed(hostname: string): boolean {
      const h = hostname.trim().toLowerCase();
      if (exact.has(h)) return true;
      for (const suffix of wildcards) {
        if (h.endsWith(suffix)) return true;
      }
      return false;
    },
    rules(): string[] {
      return [...patterns];
    },
  };
}

// ── Credential injection types ─────────────────────────────────────────────

export type CredentialInjectionMethod =
  | { type: "bearer" }
  | { type: "header"; name: string }
  | { type: "query"; param: string };

export interface CredentialMapping {
  /** Domain pattern (exact or wildcard) this credential applies to. */
  domainPattern: string;
  /** How to inject the credential into the outgoing request. */
  method: CredentialInjectionMethod;
  /** Key name in the vault (looked up at injection time). */
  vaultKey: string;
}

export interface CredentialResolver {
  /** Resolve a vault key to the raw secret. Returns null if not found or expired. */
  resolve(vaultKey: string): Promise<string | null>;
}

// ── Hop-by-hop headers (stripped by proxy) ─────────────────────────────────

export const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);
