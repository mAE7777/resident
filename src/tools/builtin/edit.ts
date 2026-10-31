// edit tool: performs exact string replacement in a file, uses mutation queue.
// executionMode: "sequential", mutating, Zone 2.

import { readFile, writeFile } from "node:fs/promises";
import type { ToolDef } from "../registry.js";
import { withFileMutationQueue } from "../mutation-queue.js";
import { resolveToolPath, validatePath } from "./path-guard.js";
import type { FileSnapshotStore } from "./file-snapshot.js";

interface EditArgs {
  path: string;
  old_string: string;
  new_string: string;
}

export function createEditTool(workspacePath?: string, cwd?: string, snapshotStore?: FileSnapshotStore,
  /** 在场律: reports every landed edit so identity fingerprints can follow her own hand. */
  onWrote?: (absPath: string) => void): ToolDef {
  return {
    name: "edit",
    description: "把一份文件里的一段原文换成新的。old_string 得在文件里恰好出现一次，一字不差。",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "要改的文件" },
        old_string: { type: "string", description: "原来那段字，一字不差" },
        new_string: { type: "string", description: "换上去的新字" },
      },
      required: ["path", "old_string", "new_string"],
    },
    executionMode: "sequential",
    async execute(args) {
      const { path, old_string, new_string } = args as EditArgs;
      const resolved = resolveToolPath(path, workspacePath, cwd);
      const pathError = validatePath(resolved, workspacePath, cwd);
      if (pathError) return `Error: ${pathError}`;
      return withFileMutationQueue(resolved, async () => {
        if (snapshotStore) snapshotStore.snapshot(resolved, "edit");
        const content = await readFile(resolved, "utf8")
        const occurrences = content.split(old_string).length - 1;
        if (occurrences === 0) {
          throw new Error(`old_string not found in ${path}`);
        }
        if (occurrences > 1) {
          throw new Error(`old_string found ${occurrences} times in ${path} — must be unique`);
        }
        const updated = content.replace(old_string, new_string);
        await writeFile(resolved, updated, "utf8");
        onWrote?.(resolved);
        return `Edited ${path}: replaced 1 occurrence`;
      });
    },
  };
}
