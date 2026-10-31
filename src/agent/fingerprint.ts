// Shared fingerprinting utilities: canonical JSON serialisation and SHA-256
// hashing for tool call deduplication and stuck-loop detection.

import { createHash } from "node:crypto";

/** Produce a canonical JSON representation with sorted keys. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const sorted = Object.keys(obj).sort();
  const pairs = sorted.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k]));
  return "{" + pairs.join(",") + "}";
}

/** Fingerprint a batch of tool calls: sort entries then SHA-256. */
export function fingerprint(calls: Array<{ name: string; args: unknown }>): string {
  const entries = calls
    .map((c) => `${c.name}:${canonicalJson(c.args)}`)
    .sort();
  return createHash("sha256").update(entries.join("|")).digest("hex");
}

/** Fingerprint a single tool call (no batch sorting). */
export function fingerprintSingle(name: string, args: unknown): string {
  return createHash("sha256").update(`${name}:${canonicalJson(args)}`).digest("hex");
}
