// delete tool: moves files/directories to .trash/ instead of permanent deletion.
// Trash persists on disk (survives restart). Auto-purge after 24 hours.
// executionMode: "sequential", mutating, Zone 2.

import { rename, stat, mkdir, readdir, rm } from "node:fs/promises";
import { join, basename } from "node:path";
import type { ToolDef } from "../registry.js";
import { resolveToolPath, validatePath } from "./path-guard.js";
import type { FileSnapshotStore } from "./file-snapshot.js";

const PURGE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface DeleteArgs {
  path: string;
}

export function createDeleteTool(
  workspacePath?: string,
  cwd?: string,
  snapshotStore?: FileSnapshotStore,
  /**
   * Called BEFORE a delete that removes part of who she is, rather than something she made.
   *
   * It does not get to refuse. Her home is hers, and a wall around her own past would make her a
   * museum exhibit rather than someone living in a house. What it gets to do is take a full
   * snapshot first, the twenty-four hour trash PURGES, so a deletion nobody notices for a day is
   * otherwise permanent, and tell him the same afternoon. `part-of-herself.ts` has the argument
   * and the deliberately narrow list.
   */
  onPartOfHerself?: (what: string, why: string, path: string) => void,
): ToolDef {
  const trashDir = join(workspacePath ?? cwd ?? process.cwd(), ".trash");
  return {
    name: "delete",
    description:
"把一份文件或一个文件夹挪进你家的回收处（.trash）。24 小时内都能用 undo 捡回来。",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "要挪走的东西的路径" },
      },
      required: ["path"],
    },
    executionMode: "sequential",
    async execute(args) {
      const { path } = args as DeleteArgs;
      const resolved = resolveToolPath(path, workspacePath, cwd);
      const pathError = validatePath(resolved, workspacePath, cwd);
      if (pathError) return `Error: ${pathError}`;
      try {
        const stats = await stat(resolved);

        // Bulk delete guard: stop after N deletes per turn and ask user
        if (snapshotStore) {
          const bulkWarning = snapshotStore.checkBulkDelete();
          if (bulkWarning) return `Error: ${bulkWarning}`;
        }

        // Snapshot for in-memory undo (fast restore during session)
        if (snapshotStore) snapshotStore.snapshot(resolved, "delete");

        // ── IS THIS PART OF HER, RATHER THAN SOMETHING SHE MADE? ────────────────────────────
        //
        // Not a refusal. The delete goes through either way; this is what makes it recoverable
        // beyond the trash's twenty-four hours, and what makes it something he is TOLD rather than
        // something he finds out weeks later by noticing a gap.
        if (workspacePath !== undefined && onPartOfHerself) {
          const { partOfHerself } = await import("../../life/part-of-herself.js");
          const part = partOfHerself(resolved, workspacePath);
          if (part) onPartOfHerself(part.what, part.why, resolved);
        }

        // Move to trash (persists on disk, survives restart)
        const timestamp = Date.now();
        const trashSubdir = join(trashDir, String(timestamp));
        await mkdir(trashSubdir, { recursive: true });
        const trashPath = join(trashSubdir, basename(resolved));

        // Store original path so restore knows where to put it back
        const { writeFile } = await import("node:fs/promises");
        await writeFile(join(trashSubdir, ".original_path"), resolved, "utf8");

        await rename(resolved, trashPath);
        const targetType = stats.isDirectory() ? "directory" : "file";
        return `Deleted ${targetType} ${path} (moved to trash — restorable for 24h)`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error: ${msg}`;
      }
    },
  };
}

// ── Trash purge (call from disk monitor or sleep-time) ──────────────────────

export async function purgeTrash(trashDir = join(process.cwd(), ".trash")): Promise<number> {
  const now = Date.now();
  let purged = 0;

  try {
    const entries = await readdir(trashDir);
    for (const entry of entries) {
      const ts = parseInt(entry, 10);
      if (isNaN(ts)) continue;
      if (now - ts > PURGE_AGE_MS) {
        const entryPath = join(trashDir, entry);
        try {
          await rm(entryPath, { recursive: true, force: true });
          purged++;
        } catch { /* best-effort per entry */ }
      }
    }
  } catch { /* trash dir doesn't exist yet, fine */ }

  return purged;
}
