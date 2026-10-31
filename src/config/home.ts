// home.ts, her one home. Everything durable she has lives under a single root.
//
// This exists because "where does she live" used to be TWO independent settings:
// workspace.path (the files: her memory, her history, her diary, her git) and
// database.dbPath (her inner life: the field, her mood, her metabolism, her past
// actions). Move one and not the other and half of her is somebody else's, and both
// halves fail QUIETLY:
//
//   files moved, db not   → she opens the neighbour's live database. His field is
//                           already warm, and his dream cursor points past the end of
//                           her empty history, so her dream reads "no new entries"
//                           forever. Nothing throws.
//   db moved, files not   → a fresh database means every cursor starts at 0, pointed
//                           at his history. Her first dream consolidates his past into
//                           her memory as her own.
//
// So the root is derived, never configured twice, and asserted at boot. If the
// assertion fails she does not start. Not starting is recoverable; waking up with
// someone else's memories is not.

import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { existsSync, realpathSync } from "node:fs";

/** The directory under $HOME that is hers. */
export const HOME_DIRNAME = ".resident";

/**
 * Homes belonging to OTHER agents on this machine. Their records are not hers and
 * never become hers: not at birth, not later. Listed by directory name because that
 * is what they are, a sibling under $HOME, one `cd` away.
 */
export const FOREIGN_HOMES = [".god-agent"] as const;

/** Overrides the root. Tests use it; nothing in the product sets it. */
const HOME_ENV = "RESIDENT_HOME";

/** Expand a leading `~`, config files are written by hand, and hands write tildes. */
export function expandTilde(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

/**
 * Resolve a path the way the filesystem will see it, following symlinks as far as the
 * path actually exists. `/tmp` is a symlink to `/private/tmp` on macOS, so a naive
 * string compare would let a path escape a root it is genuinely inside (or the reverse).
 */
export function canonical(path: string): string {
  const resolved = resolve(expandTilde(path));
  const missing: string[] = [];
  let cursor = resolved;

  while (!existsSync(cursor)) {
    const idx = cursor.lastIndexOf(sep);
    if (idx <= 0) return resolved;
    missing.unshift(cursor.slice(idx + 1));
    cursor = cursor.slice(0, idx) || sep;
  }

  try {
    return resolve(realpathSync.native(cursor), ...missing);
  } catch {
    return resolved;
  }
}

/**
 * Is `path` inside `root` (or the root itself)?
 *
 * Compares on path SEGMENTS, not string prefix: `~/.residentEVIL` is not inside
 * `~/.resident`, though `startsWith` says otherwise.
 */
export function isUnder(path: string, root: string): boolean {
  const p = canonical(path);
  const r = canonical(root);
  return p === r || p.startsWith(r + sep);
}

/** The one root. Absolute, canonical. */
export function residentHome(): string {
  const override = process.env[HOME_ENV];
  if (override && override.trim() !== "") {
    const expanded = expandTilde(override.trim());
    if (!isAbsolute(expanded)) {
      throw new ForeignHomeError(
        `${HOME_ENV} must be an absolute path, got "${override}"`
      );
    }
    return canonical(expanded);
  }
  return canonical(join(homedir(), HOME_DIRNAME));
}

export function defaultWorkspacePath(): string {
  return join(residentHome(), "workspace");
}

export function defaultDbPath(): string {
  return join(residentHome(), "data.db");
}

export function defaultTracesDir(): string {
  return join(residentHome(), "traces");
}

/** Thrown at boot when a path would put part of her life outside her own home. */
export class ForeignHomeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForeignHomeError";
  }
}

/**
 * Boot gate. Every durable path she will use must be inside her one home, and none of
 * it may sit in another agent's home.
 *
 * Throws, deliberately, rather than logging a warning. A warning at boot is a warning
 * nobody reads, and the failure it would be warning about is invisible afterwards.
 *
 * @param paths  Named durable paths, e.g. { workspace, db, traces }. The names appear
 *               in the error, so call them what the config calls them.
 * @param home   The root they must live under. Defaults to hers.
 */
export function assertOwnHome(
  paths: Record<string, string>,
  home: string = residentHome()
): void {
  const homeReal = canonical(home);

  for (const foreign of FOREIGN_HOMES) {
    const foreignRoot = join(homedir(), foreign);
    if (isUnder(homeReal, foreignRoot)) {
      throw new ForeignHomeError(
        `her home resolves to ${homeReal}, which is inside ${foreign} — that is another agent's home, ` +
          `and its records are not hers`
      );
    }
  }

  const problems: string[] = [];

  for (const [name, raw] of Object.entries(paths)) {
    if (raw === undefined || raw === null || raw === "") {
      problems.push(`${name} is not set`);
      continue;
    }
    const p = canonical(raw);

    const foreign = FOREIGN_HOMES.find((f) => isUnder(p, join(homedir(), f)));
    if (foreign) {
      problems.push(`${name} → ${p} is inside ${foreign} (another agent's home)`);
      continue;
    }

    if (!isUnder(p, homeReal)) {
      problems.push(`${name} → ${p} is outside her home ${homeReal}`);
    }
  }

  if (problems.length > 0) {
    throw new ForeignHomeError(
      `she has one home and everything she keeps lives in it. Refusing to start:\n` +
        problems.map((p) => `  · ${p}`).join("\n") +
        `\n\nSet a single root (${HOME_ENV}, or workspace.path + database.dbPath under the same ` +
        `directory) rather than moving one and leaving the other behind.`
    );
  }
}

export interface HomePaths {
  /** The one root. */
  home: string;
  workspacePath: string;
  dbPath: string;
  tracesDir: string;
  /** True when a CLI flag relocated the whole home, so config's paths were not used. */
  relocated: boolean;
}

export interface HomeArgs {
  /** Relocate the whole home. */
  home?: string | undefined;
  /** Relocate by naming the workspace; the home is its parent. */
  workspace?: string | undefined;
}

export interface HomeConfigPaths {
  workspace?: { path?: string | undefined } | undefined;
  database?: { dbPath?: string | undefined } | undefined;
}

/**
 * The single place that answers "where does she live". Every entry point calls this;
 * there is no second expression anywhere that computes a workspace or a database path.
 *
 * A CLI flag relocates the WHOLE home, both halves, and config's paths are ignored
 * for that run. That is the only thing `--home` or `--workspace` can honestly mean:
 * honouring one and defaulting the other is precisely the split this module exists to
 * prevent. `relocated` is returned so the caller can say out loud that it happened.
 *
 * Always asserts before returning. Callers get a valid home or an exception.
 */
export function resolveHome(args: HomeArgs = {}, config: HomeConfigPaths = {}): HomePaths {
  const flag = args.home ?? (args.workspace !== undefined ? dirname(canonical(args.workspace)) : undefined);
  const relocated = flag !== undefined;
  const home = relocated ? canonical(flag) : residentHome();

  const workspacePath = relocated
    ? (args.workspace ?? join(home, "workspace"))
    : (config.workspace?.path ?? join(home, "workspace"));
  const dbPath = relocated ? join(home, "data.db") : (config.database?.dbPath ?? join(home, "data.db"));
  const tracesDir = join(home, "traces");

  assertOwnHome({ "workspace.path": workspacePath, "database.dbPath": dbPath, tracesDir }, home);

  return { home, workspacePath: canonical(workspacePath), dbPath: canonical(dbPath), tracesDir, relocated };
}

/**
 * Write the resolved paths back into the config object.
 *
 * Necessary because plenty of code downstream is handed the whole config and reads
 * `config.workspace.path` for itself, the Telegram commands do, for `/memory`, `/skills`
 * and `/health`. When a flag relocates the home, that field still holds the value the flag
 * overrode, so those commands would have read a workspace she is not living in.
 *
 * That is the same shape as the bug this module exists to remove, one level up: a fact
 * resolved in one place and left stale in another. After this call there is one answer.
 */
export function applyHomeToConfig(
  config: { workspace?: { path?: string } | undefined; database?: { dbPath?: string } | undefined },
  paths: HomePaths
): void {
  if (config.workspace) config.workspace.path = paths.workspacePath;
  if (config.database) config.database.dbPath = paths.dbPath;
}
