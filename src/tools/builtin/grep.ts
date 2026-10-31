// grep tool: searches file content with regex, optionally recursive.
// executionMode: "parallel", read-only, Zone 1.

import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { ToolDef } from "../registry.js";
import { resolveToolPath, validatePath, isHousePlumbing } from "./path-guard.js";
import { machineRecordAt, recordLinesInHerWords, recordSearchLines, isMachineStateAt } from "../../workspace/records.js";

interface GrepArgs {
  pattern: string;
  path: string;
  recursive?: boolean;
  context?: number;
}

interface Match {
  file: string;
  line: number;
  text: string;
}

/**
 * A file's lines as she sees them: the machine's records of her life in her words
 * (workspace/records.ts), anything else as it is. The search runs over what she sees, so she finds
 * her words by her words and never a line by the machine's field names.
 */
function linesAsShown(content: string, filePath: string, workspacePath: string | undefined): { shown: string[]; searched: string[] } {
  const record = machineRecordAt(filePath, workspacePath);
  if (!record) {
    const lines = content.split("\n");
    return { shown: lines, searched: lines };
  }
  // A record is matched on what she sees, or on that with its date in her diary's form in front
  // (records.ts), and shown as she sees it. Either, so a pattern anchored at the start of what she
  // sees (「^9月24日」) still finds it.
  return { shown: recordLinesInHerWords(record, content), searched: recordSearchLines(record, content) };
}

async function searchFile(filePath: string, regex: RegExp, contextLines: number, workspacePath: string | undefined): Promise<string[]> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    return [];
  }

  const { shown: lines, searched } = linesAsShown(content, filePath, workspacePath);
  const results: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i]) || regex.test(searched[i] ?? "")) {
      const start = Math.max(0, i - contextLines);
      const end = Math.min(lines.length - 1, i + contextLines);
      for (let j = start; j <= end; j++) {
        const prefix = j === i ? ">" : " ";
        results.push(`${prefix} ${j + 1}: ${lines[j]}`);
      }
      if (contextLines > 0 && end < lines.length - 1) results.push("--");
    }
  }

  return results;
}

async function grepDir(dir: string, base: string, regex: RegExp, contextLines: number, matches: Match[], workspacePath: string | undefined): Promise<void> {
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
    if (entry.isDirectory()) {
      await grepDir(fullPath, base, regex, contextLines, matches, workspacePath);
    } else {
      let content: string;
      try {
        content = await readFile(fullPath, "utf8");
      } catch {
        continue;
      }
      const { shown: lines, searched } = linesAsShown(content, fullPath, workspacePath);
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i]) || regex.test(searched[i] ?? "")) {
          matches.push({ file: relative(base, fullPath), line: i + 1, text: lines[i] });
        }
      }
    }
  }
}

export function createGrepTool(workspacePath?: string, cwd?: string): ToolDef {
  return {
    name: "grep",
    description: "在文件里找带某个字样的行（可用正则）。recursive 填 true 就连文件夹一层层找。",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "要找的字样（可用正则）" },
        path: { type: "string", description: "在哪份文件或哪个文件夹里找" },
        recursive: { type: "boolean", description: "连文件夹一起一层层找（默认只看给的那一个）" },
        context: { type: "number", description: "每处找到的前后多带几行（默认不带）" },
      },
      required: ["pattern", "path"],
    },
    executionMode: "parallel",
    async execute(args) {
      const { pattern, path, recursive = false, context = 0 } = args as GrepArgs;
      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch {
        return `Error: Invalid regex pattern: ${pattern}`;
      }

      if (recursive) {
        const resolved = resolveToolPath(path, workspacePath, cwd);
        const pathError = validatePath(resolved, workspacePath, cwd);
        if (pathError) return `Error: ${pathError}`;
        const matches: Match[] = [];
        await grepDir(resolved, resolved, regex, 0, matches, workspacePath);
        if (matches.length === 0) return "No matches found";
        return matches.map((m) => `${m.file}:${m.line}: ${m.text}`).join("\n");
      }

      const resolved = resolveToolPath(path, workspacePath, cwd);
      const pathError = validatePath(resolved, workspacePath, cwd);
      if (pathError) return `Error: ${pathError}`;
      // A folder searched as if it were one file used to read as nothing found: once she
      // searched her chat folder that way, got 「没找到」, and decided her way of searching was
      // broken and a line he really said could not be shown to exist. A folder is said to be one,
      // the same way her read tool already says it (receipts.ts turns this into her words).
      if ((await stat(resolved).catch(() => null))?.isDirectory()) {
        throw new Error("EISDIR: illegal operation on a directory, grep");
      }
      const lines = await searchFile(resolved, regex, context, workspacePath);
      if (lines.length === 0) return "No matches found";
      return lines.join("\n");
    },
  };
}
