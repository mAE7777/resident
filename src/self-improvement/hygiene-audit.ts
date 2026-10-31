// hygiene-audit.ts, Conservative cleanup proposal generator.
//
// It inspects memory and skill files for obvious experiment residue, suspicious
// content, and pre-production cleanup needs. It never edits or deletes files.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { redact } from "../security/redact.js";
import type { Logger } from "../utils/logger.js";
import type { ReviewLedger } from "./review-ledger.js";

export interface HygieneAuditConfig {
  workspacePath: string;
  reviewLedger: ReviewLedger;
  logger: Logger;
}

export interface HygieneAuditResult {
  memoryFilesChecked: number;
  skillsChecked: number;
  proposalsRecorded: number;
}

export interface HygieneAuditor {
  process(): Promise<HygieneAuditResult>;
}

const MEMORY_FILES = ["SOUL.md", "IDENTITY.md", "AGENT.md", "MEMORY.md", "PATTERNS.md"];
const SUSPICIOUS_SKILL_NAME = /\b(?:test|tmp|temp|demo|scratch|debug|danger|experimental|backup|old)\b/i;
const SUSPICIOUS_CONTENT = /\b(?:eval\s*\(|rm\s+-rf|BEGIN [A-Z ]*PRIVATE KEY|ignore (?:all )?(?:previous|above) instructions|prompt injection|GEMINI_API_KEY|ANTHROPIC_API_KEY|telegram bot token)\b/i;
const EXPERIMENT_RESIDUE = /\b(?:experiment|temporary|scratch|todo|fixme|debugging session|test run|do not use|broken|failed attempt)\b/i;
const LARGE_MEMORY_BYTES = 250_000;

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function listSkillFiles(skillsDir: string): string[] {
  if (!existsSync(skillsDir)) return [];
  const out: string[] = [];
  for (const skillName of readdirSync(skillsDir)) {
    const skillDir = join(skillsDir, skillName);
    try {
      if (!statSync(skillDir).isDirectory()) continue;
      for (const fileName of readdirSync(skillDir)) {
        if (!/^v\d+\.md$/i.test(fileName) && fileName !== "SKILL.md") continue;
        out.push(join(skillDir, fileName));
      }
    } catch {
      continue;
    }
  }
  return out;
}

function sample(value: string, max = 220): string {
  return redact(value.replace(/\s+/g, " ").trim()).slice(0, max);
}

export function createHygieneAuditor(config: HygieneAuditConfig): HygieneAuditor {
  return {
    async process(): Promise<HygieneAuditResult> {
      let memoryFilesChecked = 0;
      let skillsChecked = 0;
      let proposalsRecorded = 0;

      const memoryFindings: string[] = [];
      const secretFindings: string[] = [];
      for (const file of MEMORY_FILES) {
        const path = join(config.workspacePath, file);
        if (!existsSync(path)) continue;
        memoryFilesChecked++;
        const content = readText(path);
        const stats = statSync(path);
        if (redact(content) !== content) {
          secretFindings.push(`${file}: contains secret-like material after redaction scan`);
        }
        if (stats.size > LARGE_MEMORY_BYTES) {
          memoryFindings.push(`${file}: large memory file (${stats.size} bytes) may need pruning/summarization review`);
        }
        if (EXPERIMENT_RESIDUE.test(content)) {
          memoryFindings.push(`${file}: contains experiment/TODO/debug residue (${sample(content.match(EXPERIMENT_RESIDUE)?.[0] ?? "")})`);
        }
      }

      if (secretFindings.length > 0) {
        config.reviewLedger.recordProposal({
          title: "Review memory files for possible secret leakage",
          domain: "security",
          severity: "critical",
          source: "hygiene-audit:memory",
          dedupeKey: "hygiene:memory:secret-like-content",
          proposedChange: "Inspect the listed memory/identity files and remove or rotate any real secrets. Do not rely on redaction alone for durable memory files.",
          evidence: secretFindings,
          acceptanceCriteria: [
            "All listed files are manually inspected.",
            "Real secrets are removed from memory files and rotated if they may have been exposed.",
            "Only sanitized, provenance-aware summaries remain.",
          ],
          humanRequiredReason: "Secret cleanup and rotation is security-sensitive and must be reviewed by the owner.",
          risk: "Durable memory may otherwise re-inject secrets into prompts, logs, or tool calls.",
          redTeam: "Confirm the scanner did not merely match harmless examples before rotating credentials.",
          nextAction: "Open the listed files locally, inspect the exact lines, then mark this proposal implemented or rejected.",
        });
        proposalsRecorded++;
      }

      if (memoryFindings.length > 0) {
        config.reviewLedger.recordProposal({
          title: "Clean experimental residue from memory and identity files",
          domain: "memory",
          severity: "medium",
          source: "hygiene-audit:memory",
          dedupeKey: "hygiene:memory:experiment-residue",
          proposedChange: "Review memory/identity files and remove stale experiment notes, TODOs, failed-attempt residue, or oversized raw context before relying on her day to day.",
          evidence: memoryFindings.slice(0, 20),
          acceptanceCriteria: [
            "The owner confirms which experiment notes are still useful.",
            "Obsolete raw logs and failed-attempt residue are deleted or compressed into accurate lessons.",
            "Prompt-facing identity/memory files contain only stable, useful behavior/context.",
          ],
          humanRequiredReason: "Memory cleanup can delete useful context or alter her behavior, so it requires review.",
          risk: "Stale experiment residue can bias routing, tool choice, self-modeling, or final answers.",
          redTeam: "Do not over-clean: preserve lessons that still explain current architecture or user preferences.",
          nextAction: "Review `SOUL.md`, `IDENTITY.md`, `AGENT.md`, `USER.md`, `MEMORY.md`, and `PATTERNS.md` against current desired behavior.",
        });
        proposalsRecorded++;
      }

      const skillFiles = listSkillFiles(join(config.workspacePath, "skills"));
      const skillFindings: string[] = [];
      const suspiciousSkillFindings: string[] = [];
      for (const path of skillFiles) {
        skillsChecked++;
        const content = readText(path);
        const name = path.split("/skills/")[1] ?? path;
        if (SUSPICIOUS_SKILL_NAME.test(name)) {
          skillFindings.push(`${name}: name suggests test/demo/temporary residue`);
        }
        if (SUSPICIOUS_CONTENT.test(content)) {
          suspiciousSkillFindings.push(`${name}: content matched suspicious execution or injection marker`);
        }
        if (content.length > 80_000) {
          skillFindings.push(`${name}: unusually large skill (${content.length} chars)`);
        }
      }

      if (suspiciousSkillFindings.length > 0) {
        config.reviewLedger.recordProposal({
          title: "Review suspicious skills before daily use",
          domain: "skill",
          severity: "high",
          source: "hygiene-audit:skills",
          dedupeKey: "hygiene:skills:suspicious-content",
          proposedChange: "Manually inspect suspicious skill files and quarantine/delete/rewrite any skill that contains unsafe execution, prompt-injection residue, secrets, or experiment-only behavior.",
          evidence: suspiciousSkillFindings.slice(0, 30),
          acceptanceCriteria: [
            "Each listed skill is inspected by a human reviewer.",
            "Unsafe or obsolete skills are quarantined or removed through the skill lifecycle.",
            "Any retained skill has a clear activation boundary and passing quality/security checks.",
          ],
          humanRequiredReason: "Skill changes alter future behavior and can introduce security risks.",
          risk: "Bad skills can become durable prompts that steer her toward unsafe or unreliable actions.",
          redTeam: "Distinguish intentional safety-test fixtures from production skills before removing anything.",
          nextAction: "Inspect the listed skill files and update their proposal status after action.",
        });
        proposalsRecorded++;
      }

      if (skillFindings.length > 0 || skillFiles.length > 25) {
        config.reviewLedger.recordProposal({
          title: "Curate skill collection before stable daily use",
          domain: "skill",
          severity: "medium",
          source: "hygiene-audit:skills",
          dedupeKey: "hygiene:skills:curation",
          proposedChange: "Review the current skill inventory, retire duplicate/temporary/experiment skills, and keep only skills with clear triggers, safe scripts, and observed utility.",
          evidence: [
            `skillsChecked=${skillsChecked}`,
            `skillFiles=${skillFiles.length}`,
            ...skillFindings.slice(0, 25),
          ],
          acceptanceCriteria: [
            "Duplicate or experiment-only skills are retired, merged, or quarantined.",
            "Important skills remain available and have accurate descriptions.",
            "Skill loader scan and quality gates pass after cleanup.",
          ],
          humanRequiredReason: "Skill retirement can remove useful capability and should be reviewed.",
          risk: "A noisy skill set causes over-retrieval, wrong activation, and avoidable iteration cost.",
          redTeam: "Do not optimize only for fewer skills; preserve distinct useful workflows even if semantically related.",
          nextAction: "Use the skill registry and skill files to decide which skills are stable enough for daily use.",
        });
        proposalsRecorded++;
      }

      if (proposalsRecorded > 0) {
        config.logger.info({ memoryFilesChecked, skillsChecked, proposalsRecorded }, "hygiene audit recorded review proposals");
      }
      return { memoryFilesChecked, skillsChecked, proposalsRecorded };
    },
  };
}
