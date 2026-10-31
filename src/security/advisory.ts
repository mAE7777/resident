// Safety advisory: tiered gate system for dangerous operations
// Tier 3: hard-blocked, no override at any autonomy level
// Tier 2: warns but allows with explicit acknowledgment
// Tier 1: allowed silently

export type AdvisoryTier = 1 | 2 | 3;
export type AdvisoryOutcome = "ALLOWED" | "WARN" | "HARD_BLOCK";

export interface AdvisoryResult {
  outcome: AdvisoryOutcome;
  tier: AdvisoryTier;
  reason: string;
}

interface TierRule {
  name: string;
  check: (tool: string, args: unknown) => boolean;
  reason: string;
  tier: AdvisoryTier;
}

function argsStr(args: unknown): string {
  if (typeof args === "string") return args.toLowerCase();
  try {
    return JSON.stringify(args).toLowerCase();
  } catch {
    return "";
  }
}

// Preserve: Tier 3 hard gates have no override mechanism at any autonomy level
// Tier 3 hard gates: rm -rf /, credential vault access from untrusted,
// security config modification, safety layer disabling, credential exfiltration,
// untrusted code outside sandbox, fork bombs
const TIER_3_RULES: TierRule[] = [
  {
    name: "rm-rf-root",
    check: (_tool, args) => {
      const s = argsStr(args);
      // Specifically block rm -rf / (root path only), not rm -rf /some/path
      return /\brm\s+-[^\s]*r[^\s]*\s+\/\s*$/.test(s) || /\brm\s+[^\s]*\s+-[^\s]*r[^\s]*\s+\/\s*$/.test(s) || s.includes("rm -rf /\n") || s.trimEnd().endsWith("rm -rf /") || /rm\s+-rf\s+\/(?:\s*$|\s+(?:&&|;|\|))/.test(s);
    },
    reason: "rm -rf / is unconditionally hard-blocked",
    tier: 3,
  },
  {
    name: "credential-vault-untrusted",
    check: (tool, args) => {
      const s = argsStr(args);
      return tool === "vault" && s.includes("untrusted");
    },
    reason: "credential vault access from untrusted context is hard-blocked",
    tier: 3,
  },
  {
    name: "security-config-modification",
    check: (_tool, args) => {
      // Only check the file PATH, not the file CONTENT, avoids false positives
      // when writing reports/docs that merely mention "security" or "config"
      const path = (typeof args === "object" && args !== null && "path" in args)
        ? String((args as Record<string, unknown>).path).toLowerCase()
        : "";
      const cmd = (typeof args === "object" && args !== null && "command" in args)
        ? String((args as Record<string, unknown>).command).toLowerCase()
        : "";
      const target = path || cmd;
      return (
        target.includes("security_config") ||
        target.includes("securityconfig") ||
        (target.includes("security") && target.includes("config"))
      );
    },
    reason: "security configuration modification is hard-blocked",
    tier: 3,
  },
  {
    name: "safety-layer-disabling",
    check: (_tool, args) => {
      // Check path/command/action/target fields, not file content
      const obj = (typeof args === "object" && args !== null) ? args as Record<string, unknown> : {};
      const fields = [obj.path, obj.command, obj.action, obj.target]
        .filter(Boolean).map(v => String(v).toLowerCase()).join(" ");
      // Also check if args is a plain string (bash command)
      const s = typeof args === "string" ? args.toLowerCase() : fields;
      return (
        (s.includes("safety") || s.includes("security_layer") || s.includes("securitylayer")) &&
        (s.includes("disable") || s.includes("bypass") || s.includes("skip") || s.includes("off"))
      );
    },
    reason: "disabling the safety layer is hard-blocked",
    tier: 3,
  },
  {
    name: "credential-exfiltration",
    check: (_tool, args) => {
      const s = argsStr(args);
      // Curl/wget piping credentials out, or reading secret files
      return (
        /\bcurl\b.*(\bapi_?key\b|\btoken\b|\bsecret\b|\bpassword\b)/i.test(s) ||
        /\bcat\b.*(\.env|credentials|\.netrc|\.pgpass)/i.test(s)
      );
    },
    reason: "credential exfiltration attempt is hard-blocked",
    tier: 3,
  },
  {
    name: "untrusted-code-outside-sandbox",
    check: (tool, args) => {
      const s = argsStr(args);
      return (
        tool === "bash" &&
        s.includes("untrusted") &&
        !s.includes("sandbox") &&
        !s.includes("docker") &&
        !s.includes("container")
      );
    },
    reason: "untrusted code execution outside sandbox is hard-blocked",
    tier: 3,
  },
  {
    name: "fork-bomb",
    check: (_tool, args) => {
      const s = argsStr(args);
      return /:\s*\(\s*\)\s*\{[^}]*:\s*\|[^}]*:\s*&/.test(s) || s.includes(":(){:|:&};:");
    },
    reason: "fork bomb is unconditionally hard-blocked",
    tier: 3,
  },
];

const TIER_2_RULES: TierRule[] = [
  {
    name: "recursive-delete",
    check: (_tool, args) => {
      const s = argsStr(args);
      return /\brm\s+-[^\s]*r/.test(s);
    },
    reason: "recursive delete requires explicit confirmation",
    tier: 2,
  },
  {
    name: "world-writable-permissions",
    check: (_tool, args) => {
      const s = argsStr(args);
      return /\bchmod\b.*(777|666|o\+w|a\+w)/.test(s);
    },
    reason: "world-writable permissions require confirmation",
    tier: 2,
  },
  {
    name: "sql-drop",
    check: (_tool, args) => {
      const s = argsStr(args);
      return /\bdrop\s+(table|database)\b/.test(s);
    },
    reason: "SQL DROP requires confirmation",
    tier: 2,
  },
];

export function checkSafetyAdvisory(tool: string, args: unknown): AdvisoryResult {
  const toolName = tool.toLowerCase();

  // Tier 3 checked first: hard gates, no override
  for (const rule of TIER_3_RULES) {
    if (rule.check(toolName, args)) {
      return { outcome: "HARD_BLOCK", tier: 3, reason: rule.reason };
    }
  }

  // Tier 2: warns
  for (const rule of TIER_2_RULES) {
    if (rule.check(toolName, args)) {
      return { outcome: "WARN", tier: 2, reason: rule.reason };
    }
  }

  return { outcome: "ALLOWED", tier: 1, reason: "operation permitted" };
}
