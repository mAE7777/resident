// bash tool: runs normalized shell commands after scanner/env guards.
// Pipeline: command normalization → command scanner → zone check → env scrubbing → sandbox or /bin/sh -c → output capture.
// When a sandbox runner is provided, commands route through a Docker container instead.
// executionMode: "sequential", Zone 3 sandboxed.

import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { promisify } from "node:util";
import type { ToolDef } from "../registry.js";
import type { SecurityLayer } from "../../security/index.js";
import type { ContainerRunner } from "../../sandbox/container.js";
import { buildSafeEnv, buildToolEnv } from "../../security/env-scrub.js";
import { normalizeCommand } from "../../security/commands.js";

const execFileAsync = promisify(execFile);

interface BashArgs {
  command: string;
  timeout?: number;
}

const DEFAULT_BASH_TIMEOUT_MS = 30_000;
const MAX_BASH_TIMEOUT_MS = 60_000;

export interface SandboxRef {
  runner: ContainerRunner | null;
  enabled: boolean;
}

export interface BashToolDeps {
  security: SecurityLayer;
  sandboxRef?: SandboxRef | null;
  workspacePath?: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function workspaceGuardedCommand(command: string, workspacePath: string): string {
  const workspaceReal = realpathSync.native(workspacePath);
  const quotedWorkspace = shellQuote(workspaceReal);
  return [
    `WORKSPACE_ROOT=${quotedWorkspace}`,
    `cd "$WORKSPACE_ROOT" || exit 125`,
    `cd() { command cd "$@" || return; current_dir=$(pwd -P); case "$current_dir" in "$WORKSPACE_ROOT"|"$WORKSPACE_ROOT"/*) return 0 ;; *) echo "Error: cd outside workspace blocked: $current_dir"; command cd "$WORKSPACE_ROOT"; return 1 ;; esac; }`,
    command,
  ].join("\n");
}

export function createBashTool(security: SecurityLayer, sandboxRef?: SandboxRef | null, workspacePath?: string): ToolDef {
  return {
    name: "bash",
    description: "Run a shell command. Subject to security scanning — dangerous commands are blocked.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run" },
        timeout: { type: "number", description: "Timeout in milliseconds (default 30000, max 60000)" },
      },
      required: ["command"],
    },
    executionMode: "sequential",
      async execute(args, context) {
        const { command, timeout = DEFAULT_BASH_TIMEOUT_MS } = args as BashArgs;
        const effectiveTimeout = Math.max(1, Math.min(timeout, MAX_BASH_TIMEOUT_MS));
        if (context?.signal?.aborted) return "Error: command aborted";

      // Normalize before scanning
      const normalized = normalizeCommand(command);

      // Command scanner
      const scan = security.scanCommand(normalized);
      if (scan !== null) {
        if (scan.severity === "block") {
          return `Error: Command blocked by security scanner: ${scan.description}`;
        }
        // "confirm" severity, in autonomous mode we block too (no interactive session)
        return `Error: Command requires confirmation: ${scan.description}`;
      }

      // Route through sandbox container when enabled at runtime
        if (sandboxRef?.enabled && sandboxRef.runner && workspacePath) {
          try {
            if (context?.signal?.aborted) return "Error: command aborted";
            const result = await sandboxRef.runner.run(normalized, workspacePath, effectiveTimeout);
          const parts: string[] = [];
          if (result.stdout) parts.push(result.stdout);
          if (result.stderr) parts.push(result.stderr);
          if (result.timedOut) parts.push("(command timed out)");
          if (result.truncated) parts.push("(output truncated)");
          const output = parts.join("\n");
          if (result.exitCode !== 0) {
            return `Error (exit ${result.exitCode}): ${output || "(no output)"}`;
          }
          return output || "(no output)";
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return `Error: sandbox execution failed: ${message}`;
        }
      }

      // Build safe environment (strips secrets/tokens)
      const hostEnv = workspacePath
        ? buildToolEnv({ workspacePath })
        : buildSafeEnv();
      const hostCommand = workspacePath ? workspaceGuardedCommand(normalized, workspacePath) : normalized;
      if (workspacePath) {
        try {
          await mkdir(`${workspacePath}/.tmp`, { recursive: true });
        } catch {
          // The command itself will report failure if the workspace is unavailable.
        }
      }

      try {
          const { stdout, stderr } = await execFileAsync("/bin/sh", ["-c", hostCommand], {
            env: hostEnv,
            cwd: workspacePath,
            timeout: effectiveTimeout,
            signal: context?.signal,
            maxBuffer: 10 * 1024 * 1024, // 10 MB
          });
        const output = [stdout, stderr].filter(Boolean).join("\n");
        return output || "(no output)";
      } catch (err) {
        if (err instanceof Error) {
          // execFile throws on non-zero exit; include stdout/stderr if available
          const execErr = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
          const out = [execErr.stdout, execErr.stderr].filter(Boolean).join("\n");
          return `Error: ${err.message}${out ? `\n${out}` : ""}`;
        }
        return `Error: ${String(err)}`;
      }
    },
  };
}
