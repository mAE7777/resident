// SelfTool ACL: 5-layer access control for self-inspection paths
// Prevents agent from reading infrastructure internals via the self tool

export type SelfAccessDecision = "ALLOWED" | "READ_ONLY" | "BLOCKED";

export interface SelfAccessResult {
  decision: SelfAccessDecision;
  reason: string;
}

// Layer 1: Fully blocked infrastructure objects, no access at any autonomy level
const BLOCKED_PATHS = new Set([
  "bus",
  "provider",
  "runner",
  "sessions",
  "config._raw",
  "db",
]);

// Layer 2: Read-only objects, never writable via self tool
const READ_ONLY_PATHS = new Set([
  "subagents",
  "iteration",
  "taskcount",
]);

// Layer 3: Denied attribute names, prototype pollution / introspection vectors
const DENIED_ATTRS = new Set([
  "__class__",
  "__dict__",
  "__proto__",
  "constructor",
  "prototype",
]);

// Layer 4: Sensitive name fragments, split path by . and _ to find these
const SENSITIVE_NAME_FRAGMENTS = new Set([
  "api_key",
  "apikey",
  "secret",
  "password",
  "token",
  "credential",
]);

export function checkSelfAccess(path: string, operation: "read" | "write"): SelfAccessResult {
  const normalizedPath = path.toLowerCase().trim();

  // Layer 1: BLOCKED paths, full match or starts-with check for nested access
  for (const blocked of BLOCKED_PATHS) {
    if (normalizedPath === blocked || normalizedPath.startsWith(blocked + ".")) {
      return { decision: "BLOCKED", reason: `'${blocked}' is an infrastructure object` };
    }
  }

  // Layer 3: Denied attribute names, check each path segment
  const segments = normalizedPath.split(".");
  for (const seg of segments) {
    if (DENIED_ATTRS.has(seg)) {
      return { decision: "BLOCKED", reason: `attribute '${seg}' is denied (prototype/introspection vector)` };
    }
  }

  // Layer 4: Sensitive name fragments, split each segment further by underscore
  for (const seg of segments) {
    const parts = seg.split("_");
    for (const part of parts) {
      if (SENSITIVE_NAME_FRAGMENTS.has(part)) {
        return { decision: "BLOCKED", reason: `path contains sensitive name fragment '${part}'` };
      }
    }
    // Also check compound keys without underscore splitting (e.g. "apikey" as whole segment)
    if (SENSITIVE_NAME_FRAGMENTS.has(seg)) {
      return { decision: "BLOCKED", reason: `path contains sensitive name '${seg}'` };
    }
  }

  // Layer 2: READ_ONLY paths
  for (const ro of READ_ONLY_PATHS) {
    if (normalizedPath === ro || normalizedPath.startsWith(ro + ".")) {
      if (operation === "write") {
        return { decision: "BLOCKED", reason: `'${ro}' is read-only via self tool` };
      }
      return { decision: "READ_ONLY", reason: `'${ro}' is read-only` };
    }
  }

  return { decision: "ALLOWED", reason: "access permitted" };
}
