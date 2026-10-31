// Environment scrubbing: build a clean env for subprocess spawning.
// Never mutates process.env.

import { join } from "node:path";

const SAFE_VARS = new Set([
  "HOME",
  "USER",
  "SHELL",
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "EDITOR",
  "VISUAL",
  "PAGER",
  "TMPDIR",
  "TMP",
  "TEMP",
  "NODE_ENV",
  "NODE_PATH",
  "NODE_OPTIONS",
  "NPM_CONFIG_PREFIX",
  "GOPATH",
  "CARGO_HOME",
  // SSH_AUTH_SOCK was here and is gone ON PURPOSE: it is a live handle on Eric's SSH
  // agent, every scrubbed subprocess received it, and she has no use for his keys, nothing
  // she is born holding pushes over ssh, and the day something of hers genuinely needs git is
  // a decision for Eric, not a default. Credentials never ride the common env.
]);

// Explicit overrides: these vars are allowed even if they match a dangerous suffix.
//
// EMPTY, and kept as a structure so the next entry has to be argued here (the other half of
// the SSH_AUTH_SOCK removal above). GEMINI_API_KEY lived in this set, which handed it to EVERY subprocess, a shell she
// grows into, a skill runner, anything, when exactly one tool (video-extract's vidistill
// runner) needs it. The key now travels at that one call site, per-spawn, and nowhere else.
const DANGEROUS_SUFFIX_OVERRIDES = new Set<string>([]);

// Dynamic prefixes: XDG_* and LC_* are all safe
const SAFE_PREFIXES = ["XDG_", "LC_"];

// Dangerous suffixes: vars whose names end with these are scrubbed regardless of prefix
const DANGEROUS_SUFFIXES = [
  "_KEY",
  "_TOKEN",
  "_SECRET",
  "_PASSWORD",
  "_PASSWD",
  "_CREDENTIAL",
  "_AUTH",
];

function isSafe(name: string): boolean {
  // Explicit overrides take priority over everything
  if (DANGEROUS_SUFFIX_OVERRIDES.has(name)) return true;
  // Check dangerous suffixes: overrides prefix/set membership
  for (const suffix of DANGEROUS_SUFFIXES) {
    if (name.endsWith(suffix)) return false;
  }
  if (SAFE_VARS.has(name)) return true;
  for (const prefix of SAFE_PREFIXES) {
    if (name.startsWith(prefix)) return true;
  }
  return false;
}

export function buildSafeEnv(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>
): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && isSafe(key)) {
      safe[key] = value;
    }
  }
  return safe;
}

export interface ToolEnvOptions {
  /**
   * Workspace root used for temp files and, for highly isolated shells, HOME.
   */
  workspacePath?: string;
  cwd?: string;
  /**
   * Preserve the real HOME from process.env/buildSafeEnv. Use this for typed
   * wrappers whose runtimes keep non-secret caches under HOME, such as
   * Playwright browser binaries or OpenCLI daemon state.
   */
  preserveHome?: boolean;
  /**
   * Put temp files under the workspace so subprocess scratch state cannot spill
   * into arbitrary host temp locations. Defaults to true when a workspace exists.
   */
  workspaceTmp?: boolean;
  extra?: Record<string, string | undefined>;
}

export function buildToolEnv(options: ToolEnvOptions = {}): Record<string, string> {
  const env = buildSafeEnv();
  const workspace = options.workspacePath ?? options.cwd;

  if (workspace && options.preserveHome !== true) {
    env.HOME = workspace;
  }

  if (workspace && options.workspaceTmp !== false) {
    const tmp = join(workspace, ".tmp");
    env.TMPDIR = tmp;
    env.TMP = tmp;
    env.TEMP = tmp;
  }

  if (options.extra) {
    for (const [key, value] of Object.entries(options.extra)) {
      if (value !== undefined) env[key] = value;
    }
  }

  return env;
}
