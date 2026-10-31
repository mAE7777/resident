// write tool: writes content to a file path, uses mutation queue for serialization.
// executionMode: "sequential", mutating, Zone 2.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ToolDef } from "../registry.js";
import { withFileMutationQueue } from "../mutation-queue.js";
import { resolveToolPath, validatePath } from "./path-guard.js";
import type { FileSnapshotStore } from "./file-snapshot.js";

interface WriteArgs {
  path: string;
  content: string;
}

export function createWriteTool(workspacePath?: string, cwd?: string, snapshotStore?: FileSnapshotStore,
  /** 在场律: reports every landed write so identity fingerprints can follow her own hand. */
  onWrote?: (absPath: string) => void): ToolDef {
  return {
    name: "write",
    description: "把内容写成一份文件。路上缺的文件夹会自己建好；文件已经在的话，原来的内容会被这次的盖掉。",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "写到哪儿" },
        content: { type: "string", description: "要写下的内容" },
      },
      required: ["path", "content"],
    },
    executionMode: "sequential",
    async execute(args) {
      const { path, content } = args as WriteArgs;
      const resolved = resolveToolPath(path, workspacePath, cwd);
      const pathError = validatePath(resolved, workspacePath, cwd);
      if (pathError) return `Error: ${pathError}`;
      return withFileMutationQueue(resolved, async () => {
        if (snapshotStore) snapshotStore.snapshot(resolved, "write");
        await mkdir(dirname(resolved), { recursive: true });
        await writeFile(resolved, content, "utf8");
        onWrote?.(resolved);
        return `Written ${content.length} bytes to ${path}`;
      });
    },
  };
}
