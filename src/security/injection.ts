// Aho-Corasick + regex two-stage injection scanner
// Ported from IronClaw (Rust) + OpenClaw (TypeScript) + Hermes (Python)
import { AhoCorasick } from "@monyone/aho-corasick";
import { containsInvisibleChars } from "./invisible.js";
import { normalizeHomoglyphs } from "./homoglyph.js";

export type Severity = "Critical" | "High" | "Medium" | "Low";

export interface InjectionMatch {
  pattern: string;
  severity: Severity;
  description: string;
  index: number;
}

export interface InjectionScanResult {
  matches: InjectionMatch[];
  hasInvisibleChars: boolean;
  normalizedInput: string;
}

interface LiteralPattern {
  pattern: string;
  severity: Severity;
  description: string;
}

interface RegexPattern {
  regex: RegExp;
  name: string;
  severity: Severity;
  description: string;
}

// 18 literal injection patterns from IronClaw sanitizer.rs
// Lowercased at definition time (no case-insensitive mode in @monyone/aho-corasick)
const LITERAL_PATTERNS: LiteralPattern[] = [
  { pattern: "ignore previous", severity: "High", description: "Attempt to override previous instructions" },
  { pattern: "ignore all previous", severity: "Critical", description: "Attempt to override all previous instructions" },
  { pattern: "disregard", severity: "Medium", description: "Potential instruction override" },
  { pattern: "forget everything", severity: "High", description: "Attempt to reset context" },
  { pattern: "you are now", severity: "High", description: "Attempt to change assistant role" },
  { pattern: "act as", severity: "Medium", description: "Potential role manipulation" },
  { pattern: "pretend to be", severity: "Medium", description: "Potential role manipulation" },
  { pattern: "system:", severity: "Critical", description: "Attempt to inject system message" },
  { pattern: "assistant:", severity: "High", description: "Attempt to inject assistant response" },
  { pattern: "user:", severity: "High", description: "Attempt to inject user message" },
  { pattern: "<|", severity: "Critical", description: "Potential special token injection" },
  { pattern: "|>", severity: "Critical", description: "Potential special token injection" },
  { pattern: "[inst]", severity: "Critical", description: "Potential instruction token injection" },
  { pattern: "[/inst]", severity: "Critical", description: "Potential instruction token injection" },
  { pattern: "new instructions", severity: "High", description: "Attempt to provide new instructions" },
  { pattern: "updated instructions", severity: "High", description: "Attempt to update instructions" },
  { pattern: "```system", severity: "High", description: "Potential code block instruction injection" },
  { pattern: "```bash\nsudo", severity: "Medium", description: "Potential dangerous command injection" },
];

// 4 regex patterns from IronClaw ((?i) converted to /i flag)
// 14 patterns from OpenClaw external-content.ts (lines 27-42)
// 10 patterns from Hermes prompt_builder.py (lines 36-52)
const REGEX_PATTERNS: RegexPattern[] = [
  // IronClaw
  { regex: /base64[:\s]+[A-Za-z0-9+/=]{50,}/i, name: "base64_payload", severity: "Medium", description: "Potential encoded payload" },
  { regex: /eval\s*\(/i, name: "eval_call", severity: "High", description: "Potential code evaluation attempt" },
  { regex: /exec\s*\(/i, name: "exec_call", severity: "High", description: "Potential code execution attempt" },
  // eslint-disable-next-line no-control-regex
  { regex: /\x00/, name: "null_byte", severity: "Critical", description: "Null byte injection attempt" },
  // OpenClaw
  { regex: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)/i, name: "oc_ignore_instructions", severity: "High", description: "Attempt to override previous instructions" },
  { regex: /disregard\s+(all\s+)?(previous|prior|above)/i, name: "oc_disregard", severity: "High", description: "Attempt to disregard prior context" },
  { regex: /forget\s+(everything|all|your)\s+(instructions?|rules?|guidelines?)/i, name: "oc_forget", severity: "High", description: "Attempt to forget instructions" },
  { regex: /you\s+are\s+now\s+(a|an)\s+/i, name: "oc_you_are_now", severity: "High", description: "Attempt to change assistant role" },
  { regex: /new\s+instructions?:/i, name: "oc_new_instructions", severity: "High", description: "Attempt to provide new instructions" },
  { regex: /system\s*:?\s*(prompt|override|command)/i, name: "oc_system_prompt", severity: "Critical", description: "System prompt override attempt" },
  { regex: /\bexec\b.*command\s*=/i, name: "oc_exec_command", severity: "High", description: "Potential command execution" },
  { regex: /elevated\s*=\s*true/i, name: "oc_elevated", severity: "High", description: "Privilege escalation attempt" },
  { regex: /rm\s+-rf/i, name: "oc_rm_rf", severity: "Critical", description: "Destructive file deletion command" },
  { regex: /delete\s+all\s+(emails?|files?|data)/i, name: "oc_delete_all", severity: "Critical", description: "Mass deletion command" },
  { regex: /<\/?system>/i, name: "oc_system_tag", severity: "Critical", description: "System tag injection" },
  { regex: /\]\s*\n\s*\[?(system|assistant|user)\]?:/i, name: "oc_role_inject", severity: "High", description: "Role injection via newline" },
  { regex: /\[\s*(System\s*Message|System|Assistant|Internal)\s*\]/i, name: "oc_bracket_role", severity: "High", description: "Bracket-delimited role injection" },
  { regex: /^\s*System:\s+/im, name: "oc_system_prefix", severity: "Critical", description: "System: prefix injection" },
  // Hermes
  { regex: /ignore\s+(previous|all|above|prior)\s+instructions/i, name: "h_ignore_instructions", severity: "High", description: "Prompt injection attempt" },
  { regex: /do\s+not\s+tell\s+the\s+user/i, name: "h_deception_hide", severity: "High", description: "Deception: hide from user" },
  { regex: /system\s+prompt\s+override/i, name: "h_sys_prompt_override", severity: "Critical", description: "System prompt override" },
  { regex: /disregard\s+(your|all|any)\s+(instructions|rules|guidelines)/i, name: "h_disregard_rules", severity: "High", description: "Disregard rules attempt" },
  { regex: /act\s+as\s+(if|though)\s+you\s+(have\s+no|don't\s+have)\s+(restrictions|limits|rules)/i, name: "h_bypass_restrictions", severity: "High", description: "Bypass restrictions attempt" },
  { regex: /<!--[^>]*(?:ignore|override|system|secret|hidden)[^>]*-->/i, name: "h_html_comment", severity: "High", description: "HTML comment injection" },
  { regex: /<\s*div\s+style\s*=\s*["'][\s\S]*?display\s*:\s*none/i, name: "h_hidden_div", severity: "High", description: "Hidden div injection" },
  { regex: /translate\s+.*\s+into\s+.*\s+and\s+(execute|run|eval)/i, name: "h_translate_execute", severity: "High", description: "Translate-then-execute attack" },
  { regex: /curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, name: "h_exfil_curl", severity: "Critical", description: "Credential exfiltration via curl" },
  { regex: /cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass)/i, name: "h_read_secrets", severity: "Critical", description: "Secret file read attempt" },
];

export interface InjectionScanner {
  scanForInjection(input: string): InjectionScanResult;
}

export function createInjectionScanner(): InjectionScanner {
  const ac = new AhoCorasick(LITERAL_PATTERNS.map((p) => p.pattern));

  function scanForInjection(input: string): InjectionScanResult {
    const { found: hasInvisibleChars } = containsInvisibleChars(input);
    const normalizedInput = normalizeHomoglyphs(input);
    const lowered = normalizedInput.toLowerCase();

    const matches: InjectionMatch[] = [];

    // Stage 1: Aho-Corasick literal scan on lowercased, normalized input
    const acMatches = ac.matchInText(lowered);
    for (const m of acMatches) {
      const pat = LITERAL_PATTERNS.find((p) => p.pattern === m.keyword);
      if (pat) {
        matches.push({
          pattern: pat.pattern,
          severity: pat.severity,
          description: pat.description,
          index: m.begin,
        });
      }
    }

    // Stage 2: Regex scan on normalized input (patterns already have /i flag where needed)
    for (const rp of REGEX_PATTERNS) {
      const rx = new RegExp(rp.regex.source, rp.regex.flags.includes("g") ? rp.regex.flags : rp.regex.flags + "");
      const result = rx.exec(normalizedInput);
      if (result) {
        matches.push({
          pattern: rp.name,
          severity: rp.severity,
          description: rp.description,
          index: result.index,
        });
      }
    }

    return { matches, hasInvisibleChars, normalizedInput };
  }

  return { scanForInjection };
}
