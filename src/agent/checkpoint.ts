// Checkpoint recovery: persist turn state before tool execution,
// restore on restart with synthetic error results for pending calls.

import { writeFileSync, readFileSync, renameSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Message } from "../providers/types.js";
import type { ToolResult } from "./types.js";

export interface Checkpoint {
  sessionId: string;
  assistantMessage: Message;
  completedResults: ToolResult[];
  pendingCalls: Array<{ callId: string; name: string; args: unknown }>;
  timestamp: number;
}

export interface CheckpointManager {
  save(checkpoint: Checkpoint): void;
  /** Restore checkpoint and inject synthetic error results for any pending calls. */
  restore(): Checkpoint | null;
  clear(): void;
}

const SYNTHETIC_ERROR = "Error: Tool execution interrupted — process restarted before result was received.";

export function createCheckpointManager(filePath: string): CheckpointManager {
  const tmpPath = filePath + ".tmp";

  return {
    save(checkpoint: Checkpoint): void {
      const json = JSON.stringify(checkpoint);
      // HER FIRST TOOL USE EVER HAPPENS IN A DIRECTORY THAT DOES NOT EXIST YET.
      //
      // This assumed `sessions/` was already there. On a fresh home it is not: it gets created
      // as a side effect of persisting conversation history, which happens AFTER a turn, so the
      // very first turn that calls a tool threw ENOENT and died. Her whole first exchange, on
      // the one day her home is genuinely new, and then never again.
      //
      // It went unseen because the measurement harness reused one home for a whole run, so by
      // the time any tool-using turn came round an earlier turn had made the directory. Found
      // only after giving every measured turn its own life, which is also the only
      // configuration that resembles her actual birth.
      mkdirSync(dirname(tmpPath), { recursive: true });
      // Atomic write: write to temp file then rename
      writeFileSync(tmpPath, json, "utf8");
      renameSync(tmpPath, filePath);
    },

    restore(): Checkpoint | null {
      if (!existsSync(filePath)) return null;

      let data: string;
      try {
        data = readFileSync(filePath, "utf8");
      } catch {
        return null;
      }

      let checkpoint: Checkpoint;
      try {
        checkpoint = JSON.parse(data) as Checkpoint;
      } catch {
        return null;
      }

      // Inject synthetic error results for any calls that were still pending
      if (checkpoint.pendingCalls && checkpoint.pendingCalls.length > 0) {
        const syntheticResults: ToolResult[] = checkpoint.pendingCalls.map((call) => ({
          callId: call.callId,
          name: call.name,
          content: SYNTHETIC_ERROR,
          isError: true,
        }));

        checkpoint = {
          ...checkpoint,
          completedResults: [...checkpoint.completedResults, ...syntheticResults],
          pendingCalls: [],
        };
      }

      return checkpoint;
    },

    clear(): void {
      try {
        if (existsSync(filePath)) unlinkSync(filePath);
      } catch {
        // Ignore errors on clear
      }
      try {
        if (existsSync(tmpPath)) unlinkSync(tmpPath);
      } catch {
        // Ignore errors on clear
      }
    },
  };
}
