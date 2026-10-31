// StuckDetector: deterministic pattern-matching detection of stuck agent loops.
// Runs after each agent turn (after tool execution, before the next LLM call).
// Maintains a sliding window of the last 10 actions and detects six patterns:
//
//   1. Repeat action-observation , same tool+args 3× consecutive
//   2. Repeat action-error       , same error message 3× consecutive
//   3. Monologue                 , 5 consecutive turns with no tool calls
//   4. Ping-pong A/B             , ABAB alternation in last 4 tool names
//   5. Context overflow          , compaction triggered 2× in session
//   6. Learned pattern           , promoted failure sequence from prior runs
//
// Detection is deterministic: no LLM involvement. Learned patterns are backed
// by SQLite when a database is injected; without a database the detector remains
// pure/in-memory and only uses the fixed patterns.
// Intervention messages are returned for injection as system-level instructions.

import { createHash } from "node:crypto";
import { fingerprintSingle } from "./fingerprint.js";
import type { DatabaseWrapper } from "../db/sqlite.js";

// ── Constants ──────────────────────────────────────────────────────────────

const WINDOW_SIZE = 10;
const LEARNED_PATTERN_MIN_LENGTH = 2;
const LEARNED_PATTERN_MAX_LENGTH = 8;
const LEARNED_PATTERN_PROMOTION_THRESHOLD = 3;
const LEARNED_PATTERN_WINDOW_DAYS = 30;
const SECONDS_PER_DAY = 86_400;

const REPEAT_ACTION_THRESHOLD = 3;
const REPEAT_ERROR_THRESHOLD = 3;
const MONOLOGUE_THRESHOLD = 5;
const PINGPONG_LENGTH = 4;
const CONTEXT_OVERFLOW_THRESHOLD = 2;

// SHE READS THESE MID-TURN, so they are hers: her language, and observations about what is
// happening rather than orders about what to be. "Take action, don't just discuss" was the
// delivery contract S1 removed from her identity, surviving as an intervention; and
// MSG_DIVERSE_FAILURE named web_search and package installs, tools she does not hold, which is
// the same lie as telling her to use bash.
const MSG_REPEAT_ACTION =
  "同一个动作你已经做了三遍了。";
const MSG_REPEAT_ERROR =
  "这条路一直撞在同一个错误上。";
// Three of these were narrowed to the observation alone: the old 「还没动手」 measured talking
// against doing (the delivery contract again), 「这件事一次做完」 framed her turn as a job to finish,
// and the diverse-failure line went on to advise her to step back. What she makes of it is hers.
const MSG_MONOLOGUE =
  "已经说了好一会儿了。";
const MSG_PINGPONG =
  "你在两件事之间来回打转。";
const MSG_CONTEXT_OVERFLOW =
  "一次装进来的东西太多了。";
const DIVERSE_FAILURE_THRESHOLD = 4;
const MSG_DIVERSE_FAILURE =
  "好几种不同的办法都没成。";
const MSG_LEARNED_PATTERN =
  "这一串做法以前也反复失败过。";

// ── Types ──────────────────────────────────────────────────────────────────

export type StuckPattern =
  | "repeat_action"
  | "repeat_error"
  | "diverse_failure"
  | "monologue"
  | "ping_pong"
  | "context_overflow"
  | "learned_pattern";

export interface StuckDetection {
  pattern: StuckPattern;
  message: string;
}

export interface StuckCandidateRecord {
  patternHash: string;
  toolSequence: string[];
  occurrences: number;
  promoted: boolean;
}

export interface StuckCandidatePromotionResult {
  promoted: number;
  prunedCandidates: number;
  prunedOccurrences: number;
}

/** A single recorded action in the sliding window. */
export interface ActionRecord {
  /** Tool name, or null for a text-only turn. */
  toolName: string | null;
  /** Fingerprint of tool name + args, or null for text-only turns. */
  fingerprint: string | null;
  /** Error message if the tool call produced an error, otherwise null. */
  errorMessage: string | null;
}

export interface StuckDetector {
  /**
   * Record a tool-call turn. Call once per tool execution result.
   * Returns a detection if a stuck pattern is found, otherwise null.
   */
  recordToolCall(
    toolName: string,
    args: unknown,
    errorMessage: string | null
  ): StuckDetection | null;

  /**
   * Record a text-only turn (LLM responded without tool calls).
   * Returns a detection if the monologue threshold is reached, otherwise null.
   */
  recordTextTurn(): StuckDetection | null;

  /**
   * Increment the compaction counter (call when context compression fires).
   * Returns a detection if the overflow threshold is reached, otherwise null.
   */
  recordCompaction(): StuckDetection | null;

  /**
   * Record an unmatched failure/max-iteration tool sequence as a candidate
   * learned stuck pattern. Returns null when no DB is configured or the
   * sequence is too short to learn safely.
   */
  recordCandidatePattern(toolCalls: string[], contextKey?: string): StuckCandidateRecord | null;

  /** Promote repeated candidates and prune old unpromoted candidate data. */
  checkCandidatePromotion(): StuckCandidatePromotionResult;

  /** Reset all state (use between independent tasks/sessions). */
  reset(): void;
}

export interface StuckDetectorOptions {
  db?: DatabaseWrapper | null;
  contextKey?: string;
}

// ── Implementation ─────────────────────────────────────────────────────────

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function cutoffSeconds(now: number): number {
  return now - LEARNED_PATTERN_WINDOW_DAYS * SECONDS_PER_DAY;
}

function normalizeToolSequence(toolCalls: string[]): string[] {
  return toolCalls
    .filter((name) => name.trim() !== "")
    .slice(-LEARNED_PATTERN_MAX_LENGTH);
}

function hashToolSequence(toolSequence: string[], contextKey = "global"): string {
  return createHash("sha256").update(JSON.stringify({ contextKey, toolSequence })).digest("hex");
}

function parseStoredPattern(value: string): { contextKey: string; toolSequence: string[] } {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return { contextKey: "global", toolSequence: parsed };
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.contextKey === "string" &&
      Array.isArray(parsed.toolSequence) &&
      parsed.toolSequence.every((item: unknown) => typeof item === "string")
    ) {
      return { contextKey: parsed.contextKey, toolSequence: parsed.toolSequence };
    }
  } catch {
    // Fall through to empty sequence.
  }
  return { contextKey: "global", toolSequence: [] };
}

export function recordStuckCandidatePattern(
  db: DatabaseWrapper,
  toolCalls: string[],
  contextKey = "global",
): StuckCandidateRecord | null {
  const toolSequence = normalizeToolSequence(toolCalls);
  if (toolSequence.length < LEARNED_PATTERN_MIN_LENGTH) return null;

  const patternHash = hashToolSequence(toolSequence, contextKey);
  const storedPattern = JSON.stringify({ contextKey, toolSequence });
  const now = nowSeconds();
  const cutoff = cutoffSeconds(now);

  const recentCountStmt = db.db.prepare<[string, number], { n: number }>(`
    SELECT COUNT(*) AS n
    FROM stuck_candidate_occurrences
    WHERE pattern_hash = ? AND seen_at >= ?
  `);

  db.writeWithRetry(() => {
    db.db.prepare(`
      INSERT INTO stuck_candidates (
        pattern_hash, tool_sequence, occurrences, first_seen, last_seen, promoted
      ) VALUES (?, ?, 0, ?, ?, 0)
      ON CONFLICT(pattern_hash) DO UPDATE SET
        tool_sequence = excluded.tool_sequence,
        last_seen = excluded.last_seen
    `).run(patternHash, storedPattern, now, now);

    db.db.prepare(`
      INSERT INTO stuck_candidate_occurrences (pattern_hash, seen_at)
      VALUES (?, ?)
    `).run(patternHash, now);

    db.db.prepare(`
      DELETE FROM stuck_candidate_occurrences
      WHERE pattern_hash = ? AND seen_at < ?
    `).run(patternHash, cutoff);

    const occurrences = recentCountStmt.get(patternHash, cutoff)?.n ?? 0;
    db.db.prepare(`
      UPDATE stuck_candidates
      SET occurrences = ?, first_seen = COALESCE((
        SELECT MIN(seen_at) FROM stuck_candidate_occurrences
        WHERE pattern_hash = stuck_candidates.pattern_hash
      ), ?)
      WHERE pattern_hash = ?
    `).run(occurrences, now, patternHash);
  });

  const row = db.db.prepare<[string], { occurrences: number; promoted: number }>(`
    SELECT occurrences, promoted
    FROM stuck_candidates
    WHERE pattern_hash = ?
  `).get(patternHash);

  return {
    patternHash,
    toolSequence,
    occurrences: row?.occurrences ?? 1,
    promoted: row?.promoted === 1,
  };
}

export function promoteStuckCandidates(db: DatabaseWrapper): StuckCandidatePromotionResult {
  const now = nowSeconds();
  const cutoff = cutoffSeconds(now);
  let promoted = 0;
  let prunedCandidates = 0;
  let prunedOccurrences = 0;

  db.writeWithRetry(() => {
    prunedOccurrences = db.db.prepare<[number]>(`
      DELETE FROM stuck_candidate_occurrences
      WHERE seen_at < ?
    `).run(cutoff).changes;

    db.db.prepare(`
      UPDATE stuck_candidates
      SET occurrences = (
        SELECT COUNT(*)
        FROM stuck_candidate_occurrences
        WHERE pattern_hash = stuck_candidates.pattern_hash
      )
    `).run();

    const result = db.db.prepare<[number, number]>(`
      UPDATE stuck_candidates
      SET promoted = 1, promoted_at = ?
      WHERE promoted = 0 AND occurrences >= ?
    `).run(now, LEARNED_PATTERN_PROMOTION_THRESHOLD);
    promoted = result.changes;

    prunedCandidates = db.db.prepare(`
      DELETE FROM stuck_candidates
      WHERE promoted = 0 AND occurrences = 0
    `).run().changes;
  });

  return { promoted, prunedCandidates, prunedOccurrences };
}

export function createStuckDetector(options: StuckDetectorOptions = {}): StuckDetector {
  const db = options.db ?? null;
  const contextKey = options.contextKey ?? "global";
  const window: ActionRecord[] = [];
  const toolNameWindow: string[] = [];
  let monologueCount = 0;
  let compactionCount = 0;

  function pushWindow(record: ActionRecord): void {
    window.push(record);
    if (window.length > WINDOW_SIZE) {
      window.shift();
    }
  }

  function pushToolName(toolName: string): void {
    toolNameWindow.push(toolName);
    if (toolNameWindow.length > LEARNED_PATTERN_MAX_LENGTH) {
      toolNameWindow.shift();
    }
  }

  function checkLearnedPattern(): StuckDetection | null {
    if (db === null || toolNameWindow.length < LEARNED_PATTERN_MIN_LENGTH) return null;

    const rows = db.db.prepare<[], { tool_sequence: string }>(`
      SELECT tool_sequence
      FROM stuck_candidates
      WHERE promoted = 1
      ORDER BY promoted_at DESC, last_seen DESC
      LIMIT 100
    `).all();

    for (const row of rows) {
      const stored = parseStoredPattern(row.tool_sequence);
      if (stored.contextKey !== "global" && stored.contextKey !== contextKey) continue;
      const sequence = stored.toolSequence;
      if (sequence.length < LEARNED_PATTERN_MIN_LENGTH) continue;
      if (sequence.length > toolNameWindow.length) continue;
      const suffix = toolNameWindow.slice(-sequence.length);
      if (sequence.every((name, idx) => name === suffix[idx])) {
        return { pattern: "learned_pattern", message: MSG_LEARNED_PATTERN };
      }
    }

    return null;
  }

  function checkRepeatAction(): StuckDetection | null {
    if (window.length < REPEAT_ACTION_THRESHOLD) return null;

    const last = window[window.length - 1];
    if (last.fingerprint === null) return null;

    let count = 0;
    for (let i = window.length - 1; i >= 0; i--) {
      if (window[i].fingerprint === last.fingerprint) {
        count++;
        if (count >= REPEAT_ACTION_THRESHOLD) {
          return { pattern: "repeat_action", message: MSG_REPEAT_ACTION };
        }
      } else {
        break;
      }
    }
    return null;
  }

  function checkRepeatError(): StuckDetection | null {
    if (window.length < REPEAT_ERROR_THRESHOLD) return null;

    const last = window[window.length - 1];
    if (last.errorMessage === null) return null;

    let count = 0;
    for (let i = window.length - 1; i >= 0; i--) {
      if (window[i].errorMessage === last.errorMessage) {
        count++;
        if (count >= REPEAT_ERROR_THRESHOLD) {
          return { pattern: "repeat_error", message: MSG_REPEAT_ERROR };
        }
      } else {
        break;
      }
    }
    return null;
  }

  function checkPingPong(): StuckDetection | null {
    // Collect the last PINGPONG_LENGTH tool calls (skip text-only turns). Compared by
    // FINGERPRINT (name + arguments), never by name alone: `read a, grep x, read b, grep y`
    // is how a person reads a room, and by name it is ABAB. Her explorations tripped this on
    // exactly that shape (9 of the 11 detections she has ever had were this one, 10 of them
    // inside her own moments), and each trip both spoke the machine's voice into the middle of
    // her looking and counted as a `stuck` day-event against her discomfort at the day-close.
    // Going back and forth is doing the SAME two things again, so that is what is matched.
    const calls: string[] = [];
    for (let i = window.length - 1; i >= 0 && calls.length < PINGPONG_LENGTH; i--) {
      const r = window[i];
      if (r.fingerprint !== null) {
        calls.unshift(r.fingerprint);
      }
    }

    if (calls.length < PINGPONG_LENGTH) return null;

    // ABAB: positions 0,2 equal and positions 1,3 equal and A !== B
    const a = calls[0];
    const b = calls[1];
    if (
      a !== b &&
      calls[2] === a &&
      calls[3] === b
    ) {
      return { pattern: "ping_pong", message: MSG_PINGPONG };
    }
    return null;
  }

  function checkDiverseFailure(): StuckDetection | null {
    // Count errors in the window with DIFFERENT error messages
    const errors = window.filter(r => r.errorMessage !== null);
    if (errors.length < DIVERSE_FAILURE_THRESHOLD) return null;
    // Check that at least 2 distinct error messages exist (creative, not repeated)
    const uniqueErrors = new Set(errors.map(e => e.errorMessage));
    if (uniqueErrors.size >= 2 && errors.length >= DIVERSE_FAILURE_THRESHOLD) {
      return { pattern: "diverse_failure", message: MSG_DIVERSE_FAILURE };
    }
    return null;
  }

  function recordToolCall(
    toolName: string,
    args: unknown,
    errorMessage: string | null
  ): StuckDetection | null {
    monologueCount = 0; // reset monologue streak on any tool use
    pushToolName(toolName);

    const fp = fingerprintSingle(toolName, args);
    pushWindow({ toolName, fingerprint: fp, errorMessage });

    if (errorMessage !== null) {
      // error counted (window-based tracking in checkDiverseFailure)

      // Check identical error pattern
      const repeatError = checkRepeatError();
      if (repeatError) return repeatError;

      // Check diverse failure pattern (creative agent trying different things that all fail)
      const diverseFailure = checkDiverseFailure();
      if (diverseFailure) return diverseFailure;
    } else {
      const repeatAction = checkRepeatAction();
      if (repeatAction) return repeatAction;
    }

    const pingPong = checkPingPong();
    if (pingPong) return pingPong;

    const learnedPattern = checkLearnedPattern();
    if (learnedPattern) return learnedPattern;

    return null;
  }

  function recordTextTurn(): StuckDetection | null {
    pushWindow({ toolName: null, fingerprint: null, errorMessage: null });
    monologueCount++;

    if (monologueCount >= MONOLOGUE_THRESHOLD) {
      return { pattern: "monologue", message: MSG_MONOLOGUE };
    }
    return null;
  }

  function recordCompaction(): StuckDetection | null {
    compactionCount++;

    if (compactionCount >= CONTEXT_OVERFLOW_THRESHOLD) {
      return { pattern: "context_overflow", message: MSG_CONTEXT_OVERFLOW };
    }
    return null;
  }

  function reset(): void {
    window.length = 0;
    toolNameWindow.length = 0;
    monologueCount = 0;
    compactionCount = 0;
  }

  function recordCandidatePattern(toolCalls: string[], candidateContextKey = contextKey): StuckCandidateRecord | null {
    if (db === null) return null;
    return recordStuckCandidatePattern(db, toolCalls, candidateContextKey);
  }

  function checkCandidatePromotion(): StuckCandidatePromotionResult {
    if (db === null) return { promoted: 0, prunedCandidates: 0, prunedOccurrences: 0 };
    return promoteStuckCandidates(db);
  }

  return {
    recordToolCall,
    recordTextTurn,
    recordCompaction,
    recordCandidatePattern,
    checkCandidatePromotion,
    reset,
  };
}
