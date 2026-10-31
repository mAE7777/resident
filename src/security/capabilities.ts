// Sidecar capabilities: JSON descriptor + Zod validation + enforcement

import { z } from "zod";

// Preserve: Capabilities JSON: name, auth.type, http_allowlist, rate_limit.rpm, timeout_ms
export const CapabilitiesSchema = z.object({
  name: z.string().min(1),
  auth: z.object({
    type: z.enum(["none", "bearer", "api_key", "basic"]),
  }),
  http_allowlist: z.array(z.string()).default([]),
  rate_limit: z.object({
    rpm: z.number().int().positive(),
  }),
  timeout_ms: z.number().int().positive(),
});

export type ToolCapabilities = z.infer<typeof CapabilitiesSchema>;

export interface CapabilityEnforcementResult {
  allowed: boolean;
  reason?: string;
}

export function parseCapabilities(raw: unknown): ToolCapabilities {
  return CapabilitiesSchema.parse(raw);
}

export function enforceCapabilities(
  caps: ToolCapabilities,
  requestUrl: string
): CapabilityEnforcementResult {
  if (caps.http_allowlist.length > 0) {
    const allowed = caps.http_allowlist.some((pattern) => {
      try {
        const url = new URL(requestUrl);
        return url.hostname === pattern || url.hostname.endsWith(`.${pattern}`);
      } catch {
        return false;
      }
    });
    if (!allowed) {
      return {
        allowed: false,
        reason: `URL not in http_allowlist for capability '${caps.name}'`,
      };
    }
  }
  return { allowed: true };
}
