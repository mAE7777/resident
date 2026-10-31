// Two-stage leak detector: Aho-Corasick prefix scan + confirmation regex
// Ported design from Hermes (Python) security layer
import { AhoCorasick } from "@monyone/aho-corasick";

export type LeakAction = "block" | "redact" | "warn";

export interface LeakPattern {
  prefix: string;
  confirmRegex: RegExp;
  description: string;
  action: LeakAction;
}

export interface LeakMatch {
  pattern: string;
  action: LeakAction;
  description: string;
  index: number;
  sample: string;
}

export interface LeakScanResult {
  matches: LeakMatch[];
}

// 31 leak detection patterns organized by provider
// Prefixes are lowercased at definition time; input is lowercased before AC scan
// NOTE: More-specific prefixes must appear BEFORE their less-specific siblings
// (e.g. "sk-ant-" before "sk-") so that deduplication by longest-prefix wins.
const LEAK_PATTERNS: LeakPattern[] = [
  // 2. Anthropic, more specific than OpenAI's "sk-", must come first
  {
    prefix: "sk-ant-",
    confirmRegex: /sk-ant-[A-Za-z0-9_-]{20,}/,
    description: "Anthropic",
    action: "block",
  },
  // 1. OpenAI
  {
    prefix: "sk-",
    confirmRegex: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/,
    description: "OpenAI",
    action: "block",
  },
  // 3. AWS
  {
    prefix: "akia",
    confirmRegex: /AKIA[A-Z0-9]{16}/,
    description: "AWS Access Key ID",
    action: "block",
  },
  // 4. GitHub PAT classic
  {
    prefix: "ghp_",
    confirmRegex: /ghp_[A-Za-z0-9]{36,}/,
    description: "GitHub PAT (classic)",
    action: "block",
  },
  // 5. GitHub PAT fine-grained
  {
    prefix: "github_pat_",
    confirmRegex: /github_pat_[A-Za-z0-9_]{36,}/,
    description: "GitHub PAT (fine-grained)",
    action: "block",
  },
  // 6. GitHub OAuth
  {
    prefix: "gho_",
    confirmRegex: /gho_[A-Za-z0-9]{36,}/,
    description: "GitHub OAuth token",
    action: "block",
  },
  // 7. GitHub user-to-server
  {
    prefix: "ghu_",
    confirmRegex: /ghu_[A-Za-z0-9]{36,}/,
    description: "GitHub user-to-server token",
    action: "block",
  },
  // 8. GitHub server-to-server
  {
    prefix: "ghs_",
    confirmRegex: /ghs_[A-Za-z0-9]{36,}/,
    description: "GitHub server-to-server token",
    action: "block",
  },
  // 9. GitHub refresh
  {
    prefix: "ghr_",
    confirmRegex: /ghr_[A-Za-z0-9]{36,}/,
    description: "GitHub refresh token",
    action: "block",
  },
  // 10. Slack
  {
    prefix: "xox",
    confirmRegex: /xox[baprs]-[A-Za-z0-9-]{10,}/,
    description: "Slack token",
    action: "block",
  },
  // 11. Stripe live
  {
    prefix: "sk_live_",
    confirmRegex: /sk_live_[A-Za-z0-9]{20,}/,
    description: "Stripe secret key (live)",
    action: "block",
  },
  // 12. Stripe test
  {
    prefix: "sk_test_",
    confirmRegex: /sk_test_[A-Za-z0-9]{20,}/,
    description: "Stripe secret key (test)",
    action: "block",
  },
  // 13. Stripe restricted
  {
    prefix: "rk_live_",
    confirmRegex: /rk_live_[A-Za-z0-9]{20,}/,
    description: "Stripe restricted key",
    action: "block",
  },
  // 14. SendGrid
  {
    prefix: "sg.",
    confirmRegex: /SG\.[A-Za-z0-9_-]{22,}/,
    description: "SendGrid API key",
    action: "block",
  },
  // 15. Google API
  {
    prefix: "aiza",
    confirmRegex: /AIza[A-Za-z0-9_-]{35}/,
    description: "Google API key",
    action: "block",
  },
  // 16. Bearer tokens
  {
    prefix: "bearer",
    confirmRegex: /Bearer\s+[A-Za-z0-9_-]{20,}/,
    description: "Bearer token",
    action: "redact",
  },
  // 17. Private key
  {
    prefix: "-----begin",
    confirmRegex: /-----BEGIN[A-Z ]*PRIVATE KEY-----/,
    description: "Private key block",
    action: "block",
  },
  // 18. PostgreSQL
  {
    prefix: "postgres://",
    confirmRegex: /postgres(?:ql)?:\/\/[^:]+:[^@]+@/,
    description: "PostgreSQL connection string",
    action: "redact",
  },
  // 19. MySQL
  {
    prefix: "mysql://",
    confirmRegex: /mysql:\/\/[^:]+:[^@]+@/,
    description: "MySQL connection string",
    action: "redact",
  },
  // 20. MongoDB
  {
    prefix: "mongodb",
    confirmRegex: /mongodb(?:\+srv)?:\/\/[^:]+:[^@]+@/,
    description: "MongoDB connection string",
    action: "redact",
  },
  // 21. Redis
  {
    prefix: "redis://",
    confirmRegex: /redis:\/\/[^:]+:[^@]+@/,
    description: "Redis connection string",
    action: "redact",
  },
  // 22. JWT
  {
    prefix: "eyj",
    confirmRegex: /eyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_=-]{4,}){0,2}/,
    description: "JWT token",
    action: "redact",
  },
  // 23. npm
  {
    prefix: "npm_",
    confirmRegex: /npm_[A-Za-z0-9]{10,}/,
    description: "npm access token",
    action: "block",
  },
  // 24. PyPI
  {
    prefix: "pypi-",
    confirmRegex: /pypi-[A-Za-z0-9_-]{10,}/,
    description: "PyPI API token",
    action: "block",
  },
  // 25. HuggingFace
  {
    prefix: "hf_",
    confirmRegex: /hf_[A-Za-z0-9]{10,}/,
    description: "HuggingFace token",
    action: "block",
  },
  // 26. Replicate
  {
    prefix: "r8_",
    confirmRegex: /r8_[A-Za-z0-9]{10,}/,
    description: "Replicate API token",
    action: "block",
  },
  // 27. DigitalOcean PAT
  {
    prefix: "dop_v1_",
    confirmRegex: /dop_v1_[A-Za-z0-9]{10,}/,
    description: "DigitalOcean PAT",
    action: "block",
  },
  // 28. DigitalOcean OAuth
  {
    prefix: "doo_v1_",
    confirmRegex: /doo_v1_[A-Za-z0-9]{10,}/,
    description: "DigitalOcean OAuth token",
    action: "block",
  },
  // 29. Perplexity
  {
    prefix: "pplx-",
    confirmRegex: /pplx-[A-Za-z0-9]{10,}/,
    description: "Perplexity API key",
    action: "block",
  },
  // 30. Groq
  {
    prefix: "gsk_",
    confirmRegex: /gsk_[A-Za-z0-9]{10,}/,
    description: "Groq API key",
    action: "block",
  },
  // 31. Telegram bot
  {
    prefix: "bot",
    confirmRegex: /(?:bot)?\d{8,}:[-A-Za-z0-9_]{30,}/,
    description: "Telegram bot token",
    action: "block",
  },
];

export interface LeakScanner {
  scanForLeaks(output: string): LeakScanResult;
}

export function createLeakScanner(): LeakScanner {
  // Extract minimum 3-char prefix from each pattern (already lowercased)
  const prefixes = LEAK_PATTERNS.map((p) => p.prefix);
  const ac = new AhoCorasick(prefixes);

  function scanForLeaks(output: string): LeakScanResult {
    const lowered = output.toLowerCase();
    // Map from confirmed match start index → { match, prefixLen }, most specific prefix wins
    const byIndex = new Map<number, { match: LeakMatch; prefixLen: number }>();

    // Stage 1: O(n) Aho-Corasick scan for prefix candidates on lowercased text
    const candidates = ac.matchInText(lowered);

    for (const candidate of candidates) {
      // candidate.begin is 0-based, end is inclusive
      const position = candidate.begin;

      // Find the pattern(s) whose prefix matched
      const matchedPatterns = LEAK_PATTERNS.filter((p) => p.prefix === candidate.keyword);

      for (const pat of matchedPatterns) {
        // Stage 2: Extract ~128 chars around the candidate and run confirmation regex
        const windowStart = Math.max(0, position - 10);
        const windowEnd = Math.min(output.length, position + 128);
        const window = output.slice(windowStart, windowEnd);

        const confirmed = pat.confirmRegex.exec(window);
        if (confirmed) {
          const absoluteIndex = windowStart + confirmed.index;
          const existing = byIndex.get(absoluteIndex);
          // Keep more specific match (longer prefix wins) at the same confirmed start index
          if (!existing || pat.prefix.length > existing.prefixLen) {
            byIndex.set(absoluteIndex, {
              match: {
                pattern: pat.description,
                action: pat.action,
                description: pat.description,
                index: absoluteIndex,
                sample: confirmed[0].slice(0, 20),
              },
              prefixLen: pat.prefix.length,
            });
          }
        }
      }
    }

    return { matches: Array.from(byIndex.values()).map((e) => e.match) };
  }

  return { scanForLeaks };
}
