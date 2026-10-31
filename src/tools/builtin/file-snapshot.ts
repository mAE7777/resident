// File snapshot store: captures file content before mutations (write, edit, delete).
// Enables undo: restore any file to its pre-modification state.
//
// Pattern: IronClaw file_history.rs (50-snapshot budget, raw bytes, per-tool tracking).
// Session-scoped: snapshots live in memory, cleared on restart.
// Large files (>10MB) are skipped to prevent memory exhaustion.
//
// Undo semantics:
//   - File existed before mutation → restore original content
//   - File did NOT exist before mutation (created by agent) → delete the file
//   - File was deleted by agent → restore content

import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve, join, basename } from "node:path";
import type { ToolDef } from "../registry.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("file-snapshot");

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_SNAPSHOTS = 50;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB: skip larger files

// ── Types ────────────────────────────────────────────────────────────────────

export interface FileSnapshot {
  id: number;
  path: string;
  /** Content before mutation. null = file did not exist (was created by the agent). */
  contentBefore: Buffer | null;
  toolName: string;
  timestamp: number;
}

// ── Store ────────────────────────────────────────────────────────────────────

export interface FileSnapshotStore {
  /** Capture current file content before a mutation. Call BEFORE write/edit/delete. */
  snapshot(path: string, toolName: string): void;
  /** Undo the most recent modification to a specific file. Returns description. */
  undoFile(path: string): string;
  /** Undo the most recent snapshot regardless of path. Returns description. */
  undoLast(): string;
  /** List recent snapshots (most recent first). */
  list(limit?: number): FileSnapshot[];
  /** Number of stored snapshots. */
  readonly count: number;
  /** Check if bulk delete threshold reached. Returns warning message or null. */
  checkBulkDelete(): string | null;
  /** Reset per-turn counters (call at start of each user message turn). */
  resetTurnCounters(): void;
}

const BULK_DELETE_THRESHOLD = 3;

export function createFileSnapshotStore(
  /** 在场律: reports every undo that lands (restore or delete), same hand, same law. */
  onWrote?: (absPath: string) => void): FileSnapshotStore {
  const snapshots: FileSnapshot[] = [];
  let nextId = 1;
  let turnDeleteCount = 0;

  function snapshot(path: string, toolName: string): void {
    let contentBefore: Buffer | null = null;

    try {
      if (existsSync(path)) {
        const fstat = statSync(path);
        if (fstat.size > MAX_FILE_SIZE) {
          logger.debug({ path, size: fstat.size }, "file too large for snapshot — skipping");
          return;
        }
        if (!fstat.isFile()) {
          // Don't snapshot directories
          return;
        }
        contentBefore = readFileSync(path);
      }
      // If file doesn't exist, contentBefore stays null (new file)
    } catch {
      // Can't read file, skip snapshot but don't block the operation
      logger.debug({ path }, "could not read file for snapshot — skipping");
      return;
    }

    snapshots.push({
      id: nextId++,
      path,
      contentBefore,
      toolName,
      timestamp: Date.now(),
    });

    // Evict oldest when over budget
    while (snapshots.length > MAX_SNAPSHOTS) {
      snapshots.shift();
    }

    if (toolName === "delete") turnDeleteCount++;

    logger.debug(
      { path, toolName, id: nextId - 1, existed: contentBefore !== null },
      "file snapshot captured"
    );
  }

  function undoFile(path: string): string {
    // Find most recent snapshot for this path
    for (let i = snapshots.length - 1; i >= 0; i--) {
      if (snapshots[i].path === path) {
        return applyUndo(i);
      }
    }
    return `No snapshot found for ${path}. Nothing to undo.`;
  }

  function undoLast(): string {
    if (snapshots.length === 0) {
      return "No snapshots available. Nothing to undo.";
    }
    return applyUndo(snapshots.length - 1);
  }

  function applyUndo(index: number): string {
    const snap = snapshots[index];
    snapshots.splice(index, 1); // Remove used snapshot

    try {
      if (snap.contentBefore === null) {
        // File didn't exist before, agent created it. Delete to undo.
        if (existsSync(snap.path)) {
          unlinkSync(snap.path);
          onWrote?.(snap.path);
          logger.info({ path: snap.path, toolName: snap.toolName }, "undo: deleted file (was created by agent)");
          return `Undone: deleted ${snap.path} (was created by ${snap.toolName})`;
        }
        return `File ${snap.path} already doesn't exist. Nothing to undo.`;
      }

      // File existed before: restore original content
      mkdirSync(dirname(snap.path), { recursive: true });
      writeFileSync(snap.path, snap.contentBefore);
      onWrote?.(snap.path);
      logger.info(
        { path: snap.path, toolName: snap.toolName, size: snap.contentBefore.length },
        "undo: restored file to pre-modification state"
      );
      return `Undone: restored ${snap.path} to state before ${snap.toolName} (${snap.contentBefore.length} bytes)`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, path: snap.path }, "undo failed");
      return `Undo failed for ${snap.path}: ${msg}`;
    }
  }

  function list(limit = 10): FileSnapshot[] {
    return snapshots.slice(-limit).reverse();
  }

  function checkBulkDelete(): string | null {
    if (turnDeleteCount >= BULK_DELETE_THRESHOLD) {
      // Her own files, in her own home. A plain fact she can notice, not an operator being told
      // to confirm with a user: the trash already makes every delete reversible.
      return `${turnDeleteCount} files deleted this turn. They are all in the trash and can be brought back.`;
    }
    return null;
  }

  function resetTurnCounters(): void {
    turnDeleteCount = 0;
  }

  return {
    snapshot,
    undoFile,
    undoLast,
    list,
    checkBulkDelete,
    resetTurnCounters,
    get count() {
      return snapshots.length;
    },
  };
}

// ── Undo Tool ────────────────────────────────────────────────────────────────

interface UndoArgs {
  action: "undo_last" | "undo_file" | "list" | "restore_from_trash";
  path?: string;
}

/** Search trash for a deleted file by original path and restore it. */
async function restoreFromTrash(originalPath: string, trashDir: string, onWrote?: (absPath: string) => void): Promise<string> {
  const { readdirSync, readFileSync: rfs, renameSync } = await import("node:fs");
  const resolved = resolve(originalPath);

  try {
    const entries = readdirSync(trashDir).sort().reverse(); // newest first
    for (const entry of entries) {
      const metaPath = join(trashDir, entry, ".original_path");
      try {
        const storedPath = rfs(metaPath, "utf8").trim();
        if (storedPath === resolved) {
          const trashedFile = join(trashDir, entry, basename(resolved));
          if (existsSync(trashedFile)) {
            mkdirSync(dirname(resolved), { recursive: true });
            renameSync(trashedFile, resolved);
            // Clean up trash entry
            try { unlinkSync(metaPath); } catch { /* ok */ }
            try { const { rmdirSync } = await import("node:fs"); rmdirSync(join(trashDir, entry)); } catch { /* ok */ }
            onWrote?.(resolved);
            return `Restored from trash: ${originalPath}`;
          }
        }
      } catch { /* skip unreadable entries */ }
    }
  } catch { /* trash dir doesn't exist */ }

  return `File not found in trash: ${originalPath}`;
}

export function createUndoTool(store: FileSnapshotStore, trashDir = join(process.cwd(), ".trash"), onWrote?: (absPath: string) => void): ToolDef {
  return {
    name: "undo",
    description:
"把最近的改动退回去（写、改、删都算）。undo_last 退最近一步；undo_file 退某一份文件；restore_from_trash 从回收处把删掉的捡回来（重启过也行）；list 看看最近改过什么。",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["undo_last", "undo_file", "restore_from_trash", "list"],
          description: "undo_last 退最近一步 / undo_file 退某份文件 / restore_from_trash 从回收处捡回 / list 看最近的改动",
        },
        path: {
          type: "string",
          description: "哪份文件（undo_file 和 restore_from_trash 要填）",
        },
      },
      required: ["action"],
    },
    executionMode: "sequential",
    async execute(args) {
      const { action, path } = args as UndoArgs;

      switch (action) {
        case "undo_last":
          return store.undoLast();

        case "undo_file": {
          if (!path) return "Error: path is required for undo_file";
          const result = store.undoFile(path);
          // If in-memory snapshot not found, try trash
          if (result.includes("No snapshot found")) {
            return restoreFromTrash(path, trashDir, onWrote);
          }
          return result;
        }

        case "restore_from_trash":
          if (!path) return "Error: path is required for restore_from_trash";
          return restoreFromTrash(path, trashDir, onWrote);

        case "list": {
          const recent = store.list(10);
          if (recent.length === 0) return "No file modifications to undo (in-memory). Deleted files may be in trash — use restore_from_trash with the file path.";
          const lines = recent.map((s) => {
            const existed = s.contentBefore !== null ? "modified" : "created";
            const age = Math.round((Date.now() - s.timestamp) / 1000);
            return `[${s.id}] ${s.path} — ${existed} by ${s.toolName} (${age}s ago)`;
          });
          return [`${store.count} snapshot(s) available:`, ...lines].join("\n");
        }

        default:
          return "Unknown action. Use: undo_last, undo_file, restore_from_trash, or list";
      }
    },
  };
}
