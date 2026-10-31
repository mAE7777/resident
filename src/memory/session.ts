// Session memory: append-only JSONL log per session.
// Each line is self-contained JSON with role, content, timestamp, and
// optional tool_calls/tool_results fields. One file per session UUID.
//
// Checkpoint files live alongside JSONL files at:
//   workspace/sessions/{sessionId}.checkpoint.json
// The checkpoint system itself is managed by src/agent/checkpoint.ts.

import { appendFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseWrapper } from "../db/sqlite.js";
import { createCursorStore, type CursorStore } from "./cursor.js";

// ── Entry types ───────────────────────────────────────────────────────────────

export interface ToolCallRef {
  callId: string;
  name: string;
  args: unknown;
}

export interface ToolResultRef {
  callId: string;
  name: string;
  content: string;
  isError?: boolean;
}

export interface SessionEntry {
  /** Monotonically increasing id within the session, starting at 1. */
  id: number;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  tool_calls?: ToolCallRef[];
  tool_results?: ToolResultRef[];
}

// ── Manager interface ─────────────────────────────────────────────────────────

export interface SessionManager {
  /**
   * Append a new entry to the session log.
   * Returns the assigned entry id.
   */
  append(
    sessionId: string,
    entry: Omit<SessionEntry, "id" | "timestamp">
  ): number;

  /**
   * Read all entries from the session log that have id > cursorPosition.
   * Returns entries in insertion order.
   */
  readAfterCursor(sessionId: string, cursorPosition: number): SessionEntry[];

  /** Cursor store for per-consumer tracking. */
  readonly cursors: CursorStore;

  /** Path of the JSONL file for the given session. */
  sessionPath(sessionId: string): string;

  /** Path pattern for checkpoint files (same directory as JSONL). */
  checkpointPath(sessionId: string): string;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createSessionManager(
  sessionsDir: string,
  db: DatabaseWrapper
): SessionManager {
  const cursors = createCursorStore(db);

  // Per-session in-process sequence counter so appends are monotonically
  // increasing without re-scanning the file.
  const sequences = new Map<string, number>();

  function ensureSessionsDir(): void {
    if (!existsSync(sessionsDir)) {
      mkdirSync(sessionsDir, { recursive: true });
    }
  }

  function getSessionPath(sessionId: string): string {
    return join(sessionsDir, `${sessionId}.jsonl`);
  }

  function nextId(sessionId: string): number {
    let prev = sequences.get(sessionId);
    if (prev === undefined) {
      prev = 0;
      const path = getSessionPath(sessionId);
      if (existsSync(path)) {
        try {
          const raw = readFileSync(path, "utf8");
          for (const line of raw.split("\n")) {
            if (!line.trim()) continue;
            try {
              const entry = JSON.parse(line) as { id?: unknown };
              if (typeof entry.id === "number" && Number.isFinite(entry.id)) {
                prev = Math.max(prev, entry.id);
              }
            } catch {
              // Ignore malformed historical lines.
            }
          }
        } catch {
          prev = 0;
        }
      }
    }
    const next = prev + 1;
    sequences.set(sessionId, next);
    return next;
  }

  return {
    cursors,

    sessionPath(sessionId: string): string {
      return getSessionPath(sessionId);
    },

    checkpointPath(sessionId: string): string {
      return join(sessionsDir, `${sessionId}.checkpoint.json`);
    },

    append(
      sessionId: string,
      partial: Omit<SessionEntry, "id" | "timestamp">
    ): number {
      ensureSessionsDir();
      const id = nextId(sessionId);
      const entry: SessionEntry = {
        id,
        timestamp: Date.now(),
        ...partial,
      };
      appendFileSync(getSessionPath(sessionId), JSON.stringify(entry) + "\n", "utf8");
      return id;
    },

    readAfterCursor(sessionId: string, cursorPosition: number): SessionEntry[] {
      const path = getSessionPath(sessionId);
      if (!existsSync(path)) return [];

      const raw = readFileSync(path, "utf8");
      const results: SessionEntry[] = [];

      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let entry: SessionEntry;
        try {
          entry = JSON.parse(trimmed) as SessionEntry;
        } catch {
          continue;
        }
        if (entry.id > cursorPosition) {
          results.push(entry);
        }
      }

      return results;
    },
  };
}
