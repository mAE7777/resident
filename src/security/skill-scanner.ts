// Skill scanner: static analysis of skill source files
// Line-level rules: dangerous exec patterns, crypto mining, suspicious network
// Source-level rules: exfiltration (readFile + fetch), obfuscation, env harvesting
// LRU cache: Map<path, {mtime, results}>, max 5000 entries

export type SkillFindingSeverity = "critical" | "high" | "medium" | "low";

export interface SkillFinding {
  rule: string;
  severity: SkillFindingSeverity;
  description: string;
  line?: number;
}

export interface SkillScanResult {
  path: string;
  findings: SkillFinding[];
  cached: boolean;
}

interface CacheEntry {
  mtime: number;
  results: SkillFinding[];
  lastAccess: number;
}

interface LineRule {
  name: string;
  pattern: RegExp;
  severity: SkillFindingSeverity;
  description: string;
}

interface SourceRule {
  name: string;
  check: (source: string) => boolean;
  severity: SkillFindingSeverity;
  description: string;
}

// Preserve: eval(), exec(), spawn(), child_process, cryptocurrency, mining,
// fetch(), XMLHttpRequest, String.fromCharCode, atob(), process.env
const LINE_RULES: LineRule[] = [
  {
    name: "dangerous-exec",
    pattern: /\b(eval|exec|execSync|spawn|spawnSync)\s*\(/,
    severity: "critical",
    description: "dangerous code execution function",
  },
  {
    name: "dynamic-code-execution",
    pattern: /\beval\s*\(|new\s+Function\s*\(/,
    severity: "critical",
    description: "dynamic code execution via eval or new Function",
  },
  {
    name: "crypto-mining",
    pattern: /stratum\+tcp|coinhive|cryptonight|xmrig/i,
    severity: "critical",
    description: "cryptocurrency mining indicator",
  },
  {
    name: "suspicious-network",
    pattern: /\b(fetch|XMLHttpRequest|WebSocket)\s*\(/,
    severity: "medium",
    description: "network access in skill file",
  },
  {
    name: "child-process",
    pattern: /require\s*\(\s*['"]child_process['"]\s*\)/,
    severity: "high",
    description: "child_process module import",
  },
  {
    name: "string-decode",
    pattern: /String\.fromCharCode\s*\(|atob\s*\(/,
    severity: "high",
    description: "string encoding/decoding (potential obfuscation)",
  },
  // Ported from Hermes skills_guard.py, high-value patterns our scanner was missing
  {
    name: "reverse-shell",
    pattern: /\b(nc|ncat|netcat)\s+.*-e\s|\/dev\/tcp\/|bash\s+-i\s+>&/,
    severity: "critical",
    description: "reverse shell indicator",
  },
  {
    name: "authorized-keys",
    pattern: /authorized_keys|\.ssh\/.*id_rsa/,
    severity: "critical",
    description: "SSH key access or modification",
  },
  {
    name: "crontab-persistence",
    pattern: /crontab\s+-[elr]|\*\/\d+\s+\*\s+\*\s+\*\s+\*/,
    severity: "high",
    description: "crontab modification (persistence mechanism)",
  },
  {
    name: "curl-pipe-shell",
    pattern: /curl\s+.*\|\s*(ba)?sh|wget\s+.*\|\s*(ba)?sh/,
    severity: "critical",
    description: "download and execute pattern (supply chain risk)",
  },
  {
    name: "base64-decode-pipe",
    pattern: /base64\s+(-d|--decode)\s*\|/,
    severity: "high",
    description: "base64 decode piped to execution",
  },
  {
    name: "dns-exfiltration",
    pattern: /nslookup\s+.*\$|dig\s+.*\$|host\s+.*\$/,
    severity: "critical",
    description: "possible DNS exfiltration via variable interpolation",
  },
  {
    name: "setuid-privilege",
    pattern: /chmod\s+[ug]\+s|chmod\s+[4267][0-7]{2}/,
    severity: "critical",
    description: "setuid/setgid permission change (privilege escalation)",
  },
];

const SOURCE_RULES: SourceRule[] = [
  {
    name: "exfiltration",
    check: (source) => {
      const hasReadFile = /\breadFile\s*\(/.test(source);
      const hasFetch = /\bfetch\s*\(/.test(source);
      return hasReadFile && hasFetch;
    },
    severity: "critical",
    description: "possible exfiltration: readFile and fetch in same file",
  },
  {
    name: "obfuscation",
    check: (source) => {
      // Long hex or base64 strings (>100 chars) suggest obfuscation
      return /[0-9a-fA-F]{100,}/.test(source) || /[A-Za-z0-9+/=]{150,}/.test(source);
    },
    severity: "high",
    description: "possible obfuscation: long hex or base64 literal",
  },
  {
    name: "env-harvesting",
    check: (source) => {
      // Multiple process.env accesses in same file
      const matches = source.match(/process\.env\b/g);
      return matches !== null && matches.length >= 3;
    },
    severity: "high",
    description: "multiple process.env accesses (possible env harvesting)",
  },
];

const MAX_CACHE_SIZE = 5000;

export interface SkillScanner {
  scan(path: string, source: string, mtime: number): SkillScanResult;
  clearCache(): void;
}

export function createSkillScanner(): SkillScanner {
  // LRU cache keyed by path
  const cache = new Map<string, CacheEntry>();
  let accessCounter = 0;

  function evictLRU(): void {
    if (cache.size < MAX_CACHE_SIZE) return;

    // Find the entry with the smallest lastAccess value
    let oldestKey = "";
    let oldestAccess = Infinity;

    for (const [key, entry] of cache) {
      if (entry.lastAccess < oldestAccess) {
        oldestAccess = entry.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }

  function scanSource(source: string): SkillFinding[] {
    const findings: SkillFinding[] = [];

    // Line-level rules
    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const rule of LINE_RULES) {
        if (rule.pattern.test(line)) {
          findings.push({
            rule: rule.name,
            severity: rule.severity,
            description: rule.description,
            line: i + 1,
          });
        }
      }
    }

    // Source-level rules (whole-file)
    for (const rule of SOURCE_RULES) {
      if (rule.check(source)) {
        findings.push({
          rule: rule.name,
          severity: rule.severity,
          description: rule.description,
        });
      }
    }

    return findings;
  }

  function scan(path: string, source: string, mtime: number): SkillScanResult {
    const existing = cache.get(path);
    if (existing && existing.mtime === mtime) {
      existing.lastAccess = ++accessCounter;
      return { path, findings: existing.results, cached: true };
    }

    const results = scanSource(source);

    evictLRU();
    cache.set(path, { mtime, results, lastAccess: ++accessCounter });

    return { path, findings: results, cached: false };
  }

  function clearCache(): void {
    cache.clear();
  }

  return { scan, clearCache };
}
