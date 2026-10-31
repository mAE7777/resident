// Short-term memory consolidator: token-budget-triggered summarization.
// When the estimated prompt token count approaches the context window limit,
// this module slices out the oldest un-consolidated messages and either
// LLM-summarizes them (via Haiku) or falls back to a raw archive.
//
// Output is appended to workspace/history.jsonl as either:
//   { type: "archive",     timestamp, content, cursor }
//   { type: "raw_archive", timestamp, messages, cursor }

import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { Message } from "../providers/types.js";
import { redact } from "../security/redact.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_CONSOLIDATION_ROUNDS = 5;
const MAX_CHUNK_MESSAGES = 60;
const SAFETY_BUFFER = 1024;

// ── Public types ──────────────────────────────────────────────────────────────

export interface ConsolidatorConfig {
  /** Total context window in tokens. */
  contextWindow: number;
  /** Maximum output tokens the model can produce. */
  maxOutput: number;
  /** Absolute path to workspace/history.jsonl. */
  historyPath: string;
}

export interface ConsolidationResult {
  /** Updated index into messages[], first un-consolidated position. */
  newLastConsolidated: number;
  /** Number of consolidation rounds performed. */
  rounds: number;
  /** Number of history.jsonl entries written (summaries + raw archives). */
  entriesArchived: number;
}

// history.jsonl entry shapes
export interface ArchiveEntry {
  type: "archive";
  timestamp: number;
  content: string;
  cursor: number;
  /** Which beat of her life wrote this line (`utils/beat.ts`), for the cross-section join. */
  beat?: string;
}

export interface RawArchiveEntry {
  type: "raw_archive";
  timestamp: number;
  messages: Message[];
  cursor: number;
}

export type HistoryEntry = ArchiveEntry | RawArchiveEntry;

export interface Consolidator {
  /**
   * Returns true when the estimated token count crosses the trigger threshold.
   * Trigger: estimatedTokens > contextWindow - maxOutput - SAFETY_BUFFER
   */
  shouldConsolidate(messages: Message[], lastConsolidated: number): boolean;

  /**
   * Run the consolidation loop (up to MAX_CONSOLIDATION_ROUNDS rounds).
   * Mutates nothing, callers are responsible for updating lastConsolidated.
   */
  consolidate(messages: Message[], lastConsolidated: number): Promise<ConsolidationResult>;

  /**
   * Estimate token count for a string.
   * English prose: chars / 4; code/structured: chars / 2.
   */
  estimateTokens(content: string): number;
}

// ── Token estimation ──────────────────────────────────────────────────────────

/** Heuristic: detect code/structured content by high density of non-alpha chars. */
function looksLikeCode(text: string): boolean {
  if (text.length === 0) return false;
  let special = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    // Count chars that are common in code but not English prose
    if (
      ch === 123 || // {
      ch === 125 || // }
      ch === 91 ||  // [
      ch === 93 ||  // ]
      ch === 40 ||  // (
      ch === 41 ||  // )
      ch === 60 ||  // <
      ch === 62 ||  // >
      ch === 59 ||  // ;
      ch === 58 ||  // :
      ch === 61 ||  // =
      ch === 124 || // |
      ch === 47 ||  // /
      ch === 92 ||  // backslash
      ch === 95 ||  // _
      ch === 64     // @
    ) {
      special++;
    }
  }
  return special / text.length > 0.08;
}

function estimateTokens(content: string): number {
  if (content.length === 0) return 0;
  return looksLikeCode(content)
    ? Math.ceil(content.length / 2)
    : Math.ceil(content.length / 4);
}

// ── Message token estimation ──────────────────────────────────────────────────

function estimateMessageTokens(message: Message): number {
  const contentStr =
    typeof message.content === "string"
      ? message.content
      : JSON.stringify(message.content);
  // Add a small fixed overhead per message (role header, framing)
  return estimateTokens(contentStr) + 4;
}

function estimateAllTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateMessageTokens(msg);
  }
  return total;
}

// ── Boundary finding ──────────────────────────────────────────────────────────

/**
 * Walk forward from lastConsolidated, accumulate token counts, and stop at the
 * first user-message boundary where we've removed enough tokens.
 * Returns the index (exclusive end) of the consolidation slice, or null.
 */
function pickConsolidationBoundary(
  messages: Message[],
  lastConsolidated: number,
  tokensToRemove: number
): number | null {
  let removedTokens = 0;
  let lastBoundaryIdx: number | null = null;

  for (let idx = lastConsolidated; idx < messages.length; idx++) {
    // A user turn marks a safe boundary (we only cut before user messages)
    if (idx > lastConsolidated && messages[idx].role === "user") {
      lastBoundaryIdx = idx;
      if (removedTokens >= tokensToRemove) {
        return lastBoundaryIdx;
      }
    }
    removedTokens += estimateMessageTokens(messages[idx]);
  }

  // Return the last boundary we found, even if we didn't hit the target
  return lastBoundaryIdx;
}

/**
 * Cap the boundary to at most MAX_CHUNK_MESSAGES messages from lastConsolidated.
 * Walks backwards from the cap to land on a user message boundary.
 * Returns null if no valid boundary can be found within the cap.
 */
function capConsolidationBoundary(
  messages: Message[],
  lastConsolidated: number,
  endIdx: number
): number | null {
  const chunkSize = endIdx - lastConsolidated;
  if (chunkSize <= MAX_CHUNK_MESSAGES) {
    return endIdx;
  }

  const cappedEnd = lastConsolidated + MAX_CHUNK_MESSAGES;
  // Walk backwards to find a user-message boundary
  for (let idx = cappedEnd; idx > lastConsolidated; idx--) {
    if (messages[idx] && messages[idx].role === "user") {
      return idx;
    }
  }
  return null;
}

// ── History JSONL I/O ─────────────────────────────────────────────────────────

function ensureHistoryDir(historyPath: string): void {
  const dir = dirname(historyPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function appendHistory(historyPath: string, entry: HistoryEntry): void {
  ensureHistoryDir(historyPath);
  appendFileSync(historyPath, JSON.stringify(entry) + "\n", "utf8");
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createConsolidator(config: ConsolidatorConfig): Consolidator {
  const { contextWindow, maxOutput, historyPath } = config;
  const triggerThreshold = contextWindow - maxOutput - SAFETY_BUFFER;

  function shouldConsolidate(messages: Message[], lastConsolidated: number): boolean {
    const estimated = estimateAllTokens(messages);
    // The lastConsolidated index tells us how far we've processed, but the
    // trigger check is over the full message array (all messages contribute to
    // prompt tokens regardless of consolidation status).
    void lastConsolidated;
    return estimated > triggerThreshold;
  }

  async function archive(
    chunk: Message[],
    cursor: number
  ): Promise<boolean> {
    // Verbatim only. This used to try a model summary first, an English
    // service prompt paraphrasing her conversation into "key decisions, actions taken" before
    // it entered her own archive. Her record keeps what was actually said, with secrets
    // redacted; a paraphrase of a life is not an archive of it.
    const redactedChunk = chunk.map((m) => ({
      ...m,
      content: typeof m.content === "string" ? redact(m.content) : m.content,
    }));
    const entry: RawArchiveEntry = {
      type: "raw_archive",
      timestamp: Date.now(),
      messages: redactedChunk,
      cursor,
    };
    appendHistory(historyPath, entry);
    return true;
  }

  async function consolidate(
    messages: Message[],
    lastConsolidated: number
  ): Promise<ConsolidationResult> {
    let currentLastConsolidated = lastConsolidated;
    let rounds = 0;
    let entriesArchived = 0;

    let estimated = estimateAllTokens(messages);
    const target = triggerThreshold / 2; // aim to free half the budget

    for (let round = 0; round < MAX_CONSOLIDATION_ROUNDS; round++) {
      if (estimated <= target) break;

      const tokensToRemove = Math.max(1, estimated - target);
      const boundary = pickConsolidationBoundary(
        messages,
        currentLastConsolidated,
        tokensToRemove
      );

      if (boundary === null) break;

      const cappedBoundary = capConsolidationBoundary(
        messages,
        currentLastConsolidated,
        boundary
      );

      if (cappedBoundary === null) break;

      const chunk = messages.slice(currentLastConsolidated, cappedBoundary);
      if (chunk.length === 0) break;

      await archive(chunk, cappedBoundary);
      entriesArchived++;
      currentLastConsolidated = cappedBoundary;
      rounds++;

      // Re-estimate using only unconsolidated messages to simulate freed context
      const remaining = messages.slice(currentLastConsolidated);
      estimated = estimateAllTokens(remaining);
    }

    return {
      newLastConsolidated: currentLastConsolidated,
      rounds,
      entriesArchived,
    };
  }

  return {
    shouldConsolidate,
    consolidate,
    estimateTokens,
  };
}
