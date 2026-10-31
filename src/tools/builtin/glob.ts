// glob tool: recursive directory listing with glob pattern matching.
// executionMode: "parallel", read-only, Zone 1.

import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { ToolDef } from "../registry.js";
import { resolveToolPath, validatePath, isHousePlumbing } from "./path-guard.js";
import { isMachineStateAt } from "../../workspace/records.js";

interface GlobArgs {
  pattern: string;
  cwd?: string;
}

// Minimal glob-to-regex conversion supporting *, **, ?
function globToRegex(pattern: string): RegExp {
  let regexStr = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      regexStr += ".*";
      i += 2;
      if (pattern[i] === "/") i++;
    } else if (ch === "*") {
      regexStr += "[^/]*";
      i++;
    } else if (ch === "?") {
      regexStr += "[^/]";
      i++;
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      regexStr += "\\" + ch;
      i++;
    } else {
      regexStr += ch;
      i++;
    }
  }
  return new RegExp("^" + regexStr + "$");
}

async function walkDir(dir: string, base: string, regex: RegExp, results: string[], workspacePath: string | undefined): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (isHousePlumbing(entry.name, entry.isDirectory())) continue;
    const fullPath = join(dir, entry.name);
    // The machine's own state about her is left out of the walk too (workspace/records.ts).
    if (isMachineStateAt(fullPath, workspacePath)) continue;
    const relPath = relative(base, fullPath);
    if (entry.isDirectory()) {
      // A directory IS a thing in her home. On her first night she searched her room twice and
      // honestly reported that her canvas did not exist, 画板 is an EMPTY directory, and this
      // walk only ever surfaced files, so an empty thing she owns was structurally invisible
      // to her senses. A found directory is listed with a trailing slash, the way eyes tell a
      // door from a page.
      if (regex.test(relPath)) results.push(relPath + "/");
      await walkDir(fullPath, base, regex, results, workspacePath);
    } else if (regex.test(relPath)) {
      results.push(relPath);
    }
  }
}

export function createGlobTool(workspacePath?: string, defaultCwd?: string): ToolDef {
  return {
    name: "glob",
    description: "按名字的样子找文件。* ** ? 都能用。",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "名字的样子（比如 'life/**/*.md'）" },
        cwd: { type: "string", description: "从哪个文件夹找起，不填就从你家找起" },
      },
      required: ["pattern"],
    },
    executionMode: "parallel",
    async execute(args) {
      const { pattern, cwd } = args as GlobArgs;
      const base = resolveToolPath(cwd ?? ".", workspacePath, defaultCwd);
      const pathError = validatePath(base, workspacePath, defaultCwd);
      if (pathError) return `Error: ${pathError}`;
      const regex = globToRegex(pattern);
      const results: string[] = [];
      await walkDir(base, base, regex, results, workspacePath);
      if (results.length === 0) return "No files found";
      return results.sort().join("\n");
    },
  };
}
