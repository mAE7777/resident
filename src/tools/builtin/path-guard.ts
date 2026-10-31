// path-guard.ts, validates file paths against workspace boundary and sensitive directories.
// Returns null if path is allowed, or an error message string if blocked.

import { isAbsolute, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { existsSync, realpathSync } from "node:fs";
import { FOREIGN_HOMES } from "../../config/home.js";

/**
 * The house's plumbing, left out when she walks her home with glob or grep.
 *
 * Once she listed her home nineteen times in a day and half of what came back was machinery: dozens of
 * `.git/` internals (hook samples, object files), the fingerprints of her identity files
 * (`*.blake3`), and `tool-results/…-grep-call_….txt`, the machine's dump of her earlier looks,
 * filed under the words "tool results". A recursive grep walked into all of it as well, compressed
 * git objects included. None of it is hers or about her; it is how the house is kept. It is only
 * skipped while walking: a path handed to her (the rest of a long result) still opens with read.
 */
export function isHousePlumbing(name: string, isDirectory: boolean): boolean {
  // `.gitignore` is plumbing too: the git that keeps her home's history is the house's, and
  // its ignore list sat at the top of her listing between AGENT.md and MEMORY.md.
  return isDirectory ? name === ".git" || name === "tool-results" : name.endsWith(".blake3") || name === ".gitignore";
}

// Sensitive directories that should never be accessed by the agent
const SENSITIVE_DIRS = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".kube",
  ".docker",
  ".config/gcloud",
  ".azure",
];

// Individual sensitive files (not directories) that should never be read/written
const SENSITIVE_FILES = [
  ".zshrc",
  ".bashrc",
  ".bash_profile",
  ".profile",
  ".zprofile",
  ".netrc",
  ".npmrc",
  ".pypirc",
  ".gitconfig",
];

function canonicalize(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

function canonicalizeForAccess(path: string): string {
  const resolved = resolve(path);
  if (existsSync(resolved)) return canonicalize(resolved);

  const missing: string[] = [];
  let cursor = resolved;

  while (!existsSync(cursor)) {
    const idx = cursor.lastIndexOf(sep);
    if (idx <= 0) return resolved;
    missing.unshift(cursor.slice(idx + 1));
    cursor = cursor.slice(0, idx) || sep;
  }

  return resolve(canonicalize(cursor), ...missing);
}

function pathVariants(path: string): string[] {
  const variants = new Set([path]);
  if (path.startsWith("/private/var/")) variants.add(path.replace(/^\/private\/var\//u, "/var/"));
  if (path.startsWith("/var/")) variants.add(path.replace(/^\/var\//u, "/private/var/"));
  return [...variants];
}

/**
 * Validate a resolved file path. Returns null if allowed, or an error string if blocked.
 *
 * Three checks:
 * 1. Paths inside known sensitive directories are always blocked.
 * 2. If workspacePath or cwd is set, the path must be within at least one of them.
 * 3. If neither is set, only sensitive directories are blocked (permissive mode).
 */
export function validatePath(
  resolvedPath: string,
  workspacePath?: string,
  cwd?: string
): string | null {
  const resolvedVariants = pathVariants(canonicalizeForAccess(resolvedPath));
  // Check sensitive directories (always, regardless of workspace)
  const home = homedir();
  for (const dir of SENSITIVE_DIRS) {
    const sensitiveAbs = resolve(home, dir);
    if (resolvedVariants.some((variant) => variant.startsWith(sensitiveAbs + sep) || variant === sensitiveAbs)) {
      return `Access denied: path is inside sensitive directory ~/${dir}`;
    }
  }

  // Another agent's home. Blocked here as well as at the wall so a typed file tool gets
  // the real reason, and so it still holds when no workspace is configured (permissive mode).
  for (const foreign of FOREIGN_HOMES) {
    const foreignAbs = resolve(home, foreign);
    if (resolvedVariants.some((v) => v === foreignAbs || v.startsWith(foreignAbs + sep))) {
      return `Access denied: ~/${foreign} is another agent's home — its records are not hers`;
    }
  }

  // Check sensitive individual files
  for (const file of SENSITIVE_FILES) {
    const sensitiveAbs = resolve(home, file);
    if (resolvedVariants.includes(sensitiveAbs)) {
      return `Access denied: ~/${file} contains credentials`;
    }
  }

  // Path must be inside workspace OR cwd (when either is configured)
  const allowedRoots: string[] = [];
  if (workspacePath) allowedRoots.push(...pathVariants(canonicalize(resolve(workspacePath))));
  if (cwd) allowedRoots.push(...pathVariants(canonicalize(resolve(cwd))));

  if (allowedRoots.length > 0) {
    const isAllowed = allowedRoots.some(
      (root) => resolvedVariants.some((variant) => variant.startsWith(root + sep) || variant === root)
    );
    if (!isAllowed) {
      return `Access denied: path is outside allowed directories`;
    }
  }

  return null;
}

/**
 * Resolve a user/tool path using the workspace as the default base.
 * This keeps daemon-relative paths inside the configured workspace instead of
 * leaking to the Node process cwd.
 */
export function resolveToolPath(path: string, workspacePath?: string, cwd?: string): string {
  if (isAbsolute(path)) return resolve(path);
  return resolve(workspacePath ?? cwd ?? process.cwd(), path);
}
