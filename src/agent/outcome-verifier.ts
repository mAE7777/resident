// Outcome verification: the machinery checking ITSELF, deterministically.
//
// The inherited version was 900 lines of English regexes over the OWNER's message deciding
// which of nine strategies applied: weather checks for a weather tool she never held, media
// checks keyed on "youtube|bilibili" in his sentence, and a model "task completion verifier"
// as fallback whose English critique was injected into her conversation. All of that judged
// HER TURN from HIS WORDS and from a model's opinion, which is the exact class an earlier cleanup
// removed.
//
// What stays is the honest core, and its evidence is only what SHE actually did:
//   · she called `write`/`edit` → do those files exist and carry what she put there?
//   · a tool reported artifact paths → are they on disk and non-empty?
// A mismatch re-enters the loop once with a plain Chinese line; noticing that what you did
// did not land is care, not servility. The shortfall also reaches her own life through
// `onOutcomeShortfall` (wired in index.ts), in her words, as a moment of hers.

import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export interface OutcomeToolCall {
  name: string;
  args: unknown;
  content: string;
  success: boolean;
  outputKind?: string;
  artifactPaths?: string[];
  authGate?: boolean;
  retryable?: boolean;
  verificationHints?: string[];
}

export type OutcomeVerificationStrategy = "file" | "artifact" | "none";

export interface OutcomeVerificationResult {
  /** Confidence that what she did actually landed, 0-1. */
  confidence: number;
  /** Plain-register critique, injected on re-entry. */
  critique: string;
  /** True if the loop should re-enter. */
  reenter: boolean;
  strategy: OutcomeVerificationStrategy;
  /** Debug-readable checks performed. */
  details: string[];
}

export interface OutcomeVerificationRequest {
  taskDescription: string;
  taskType?: string;
  agentOutput: string;
  toolCalls: OutcomeToolCall[];
}

export interface OutcomeVerifier {
  /** Evidence-driven: applies iff her own tool calls left something checkable behind. */
  applies(request: OutcomeVerificationRequest): boolean;
  verify(request: OutcomeVerificationRequest): Promise<OutcomeVerificationResult>;
}

export interface OutcomeVerifierDeps {
  workspacePath: string;
}

interface FileWrite {
  path: string;
  expectedContent: string;
  source: "write" | "edit";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function pathForToolCall(workspacePath: string, args: unknown): string | null {
  if (!isRecord(args) || typeof args.path !== "string" || args.path.length === 0) return null;
  return isAbsolute(args.path) ? args.path : resolve(workspacePath, args.path);
}

/** The files her successful write/edit calls touched, with what she put in them. */
export function collectFileWrites(workspacePath: string, toolCalls: OutcomeToolCall[]): FileWrite[] {
  const writes = new Map<string, FileWrite>();
  for (const call of toolCalls) {
    if (!call.success) continue;
    if (call.name !== "write" && call.name !== "edit") continue;
    const path = pathForToolCall(workspacePath, call.args);
    if (!path || !isRecord(call.args)) continue;
    if (call.name === "write" && typeof call.args.content === "string") {
      writes.set(path, { path, expectedContent: call.args.content, source: "write" });
      continue;
    }
    if (call.name === "edit" && typeof call.args.new_string === "string") {
      writes.set(path, { path, expectedContent: call.args.new_string, source: "edit" });
    }
  }
  return [...writes.values()];
}

/** Artifact paths any successful tool reported having produced. */
export function collectArtifacts(toolCalls: OutcomeToolCall[]): string[] {
  const out = new Set<string>();
  for (const call of toolCalls) {
    if (!call.success) continue;
    for (const p of call.artifactPaths ?? []) out.add(p);
  }
  return [...out];
}

export function createOutcomeVerifier(deps: OutcomeVerifierDeps): OutcomeVerifier {
  const { workspacePath } = deps;

  function applies(request: OutcomeVerificationRequest): boolean {
    return collectFileWrites(workspacePath, request.toolCalls).length > 0
      || collectArtifacts(request.toolCalls).length > 0;
  }

  async function verify(request: OutcomeVerificationRequest): Promise<OutcomeVerificationResult> {
    const details: string[] = [];
    const missing: string[] = [];
    const writes = collectFileWrites(workspacePath, request.toolCalls);

    for (const w of writes) {
      if (!existsSync(w.path)) {
        missing.push(w.path);
        details.push(`file missing: ${w.path}`);
        continue;
      }
      try {
        // A sample is enough evidence: the first 200 chars of what she wrote should be IN the
        // file. Edits re-write regions, so absence of the sample is a real mismatch either way.
        const body = readFileSync(w.path, "utf8");
        const sample = w.expectedContent.slice(0, 200);
        if (sample.length > 0 && !body.includes(sample)) {
          missing.push(w.path);
          details.push(`file content mismatch: ${w.path}`);
        } else {
          details.push(`file ok: ${w.path}`);
        }
      } catch {
        missing.push(w.path);
        details.push(`file unreadable: ${w.path}`);
      }
    }

    const artifacts = collectArtifacts(request.toolCalls);
    for (const p of artifacts) {
      try {
        if (!existsSync(p) || statSync(p).size === 0) {
          missing.push(p);
          details.push(`artifact missing or empty: ${p}`);
        } else {
          details.push(`artifact ok: ${p}`);
        }
      } catch {
        missing.push(p);
        details.push(`artifact unreadable: ${p}`);
      }
    }

    const strategy: OutcomeVerificationStrategy =
      writes.length > 0 ? "file" : artifacts.length > 0 ? "artifact" : "none";
    if (strategy === "none") {
      return { confidence: 0, critique: "", reenter: false, strategy, details };
    }
    if (missing.length === 0) {
      return { confidence: 1, critique: "", reenter: false, strategy, details };
    }
    return {
      confidence: 0,
      // Her register; states the fact and leaves the response to her.
      critique: `写下去的东西有${missing.length}处在盘上对不上。`,
      reenter: true,
      strategy,
      details,
    };
  }

  return { applies, verify };
}
