// Workspace identity manager: reads memory files from the workspace,
// provides session-start snapshots for stable system prompt injection,
// and commits Dream edits with git-versioned history.
//
// Five identity files live in the workspace root:
//   SOUL.md    , personality / values (user-editable, not auto-committed)
//   IDENTITY.md, name / version / purpose (managed manually)
//   AGENT.md   , capabilities / tools / instructions
//   MEMORY.md  , persistent facts index (updated by Dream, age-annotated)
//
// Invariant: the system prompt uses the session-start snapshot exclusively.
// Mid-session writes to memory files do NOT affect the running prompt.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import type { Logger } from "../utils/logger.js";
import { initWorkspace } from "../workspace/init.js";
import type { DiagnosticResult } from "../types/diagnostic.js";
import type { MemoryFiles } from "../agent/context.js";
import { createLeakScanner } from "../security/leak.js";

// ── Constants ──────────────────────────────────────────────────────────────────

/** Lines in MEMORY.md older than this many days get an age annotation. */
const STALE_THRESHOLD_DAYS = 14;

/** The identity files tracked by this manager. */
const IDENTITY_FILE_NAMES = ["SOUL.md", "IDENTITY.md", "AGENT.md", "MEMORY.md"] as const;
void IDENTITY_FILE_NAMES;

// ── Types ──────────────────────────────────────────────────────────────────────

export type IdentityFileName = (typeof IDENTITY_FILE_NAMES)[number];

/** Frozen snapshot of all identity files taken at session start. */
export interface IdentitySnapshot {
  SOUL: string;
  IDENTITY: string;
  AGENT: string;
  MEMORY: string;
}

/**
 * Subset of IdentitySnapshot that maps to the MemoryFiles interface
 * expected by the context builder (excludes IDENTITY).
 */
export interface MemorySnapshot {
  memoryFiles: MemoryFiles;
  /** Raw IDENTITY.md content for separate injection into the identity string. */
  identityContent: string;
}

export interface WorkspaceManager {
  /**
   * Ensure the workspace is initialised (delegates to initWorkspace).
   * Idempotent, safe to call on every startup.
   */
  ensureInitialized(): Promise<DiagnosticResult<{ initialized: boolean }>>;

  /**
   * Load all identity files and return a frozen snapshot.
   * Call once per session; store the result and never re-read within a session.
   */
  getSessionSnapshot(): IdentitySnapshot;

  /**
   * Returns a MemorySnapshot derived from an IdentitySnapshot.
   * Includes git-blame age annotations on MEMORY.md content.
   */
  getAgeAnnotatedMemory(snapshot: IdentitySnapshot): Promise<MemorySnapshot>;

  /**
   * Commit any unstaged changes to the named files, if there are any. Idempotent per cycle.
   *
   * The only caller used to be the memory/dream.ts ghostwriter, every commit in her home's
   * history except the first was a machine's. Since E-1 the only pen that moves
   * MEMORY.md is her own, and this folds her edits into git under her own label, so the
   * notebook's history stays attributable forever.
   *
   * @param changedFiles - list of filenames to check (e.g. ["MEMORY.md"])
   * @param label        - the author label for the commit message (e.g. "her own hand")
   */
  commitIfChanged(changedFiles: string[], label: string): Promise<void>;
}

// ── Blame parsing ──────────────────────────────────────────────────────────────

interface LineAge {
  /** Age in fractional days (floor before comparing to threshold). */
  ageDays: number;
}

/**
 * Parse `git blame --line-porcelain` output and return per-line ages.
 * Returns an empty array on any parse error.
 */
function parseBlamePorcelain(output: string): LineAge[] {
  const ages: LineAge[] = [];
  const nowSeconds = Date.now() / 1000;

  const lines = output.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line) { i++; continue; }

    // A blame block header looks like: "<40-char sha> <orig-line> <final-line> <num-lines>"
    if (/^[0-9a-f]{40} /.test(line)) {
      // Scan forward for `author-time`
      let authorTime: number | null = null;
      i++;
      while (i < lines.length && !(/^[0-9a-f]{40} /.test(lines[i] ?? ""))) {
        const current = lines[i] ?? "";
        if (current.startsWith("author-time ")) {
          authorTime = parseInt(current.slice("author-time ".length), 10);
        }
        // The tab-prefixed line is the actual source line, end of block
        if (current.startsWith("\t")) {
          i++;
          break;
        }
        i++;
      }
      if (authorTime !== null && !isNaN(authorTime)) {
        const ageDays = Math.floor((nowSeconds - authorTime) / 86400);
        ages.push({ ageDays });
      } else {
        ages.push({ ageDays: 0 });
      }
    } else {
      i++;
    }
  }

  return ages;
}

// ── Age annotation ─────────────────────────────────────────────────────────────

/**
 * Annotate each line of MEMORY.md content with its git age if older than
 * STALE_THRESHOLD_DAYS. Falls back to raw content on any error.
 */
async function annotateMemoryWithAges(
  workspacePath: string,
  content: string
): Promise<string> {
  try {
    const git = simpleGit(workspacePath);
    const blameOutput = await git.raw(["blame", "--line-porcelain", "MEMORY.md"]);
    const ages = parseBlamePorcelain(blameOutput);

    if (!ages.length) return content;

    const hadTrailing = content.endsWith("\n");
    const lines = content.split("\n");

    // Remove trailing empty string caused by trailing newline split
    const effectiveLines = hadTrailing && lines[lines.length - 1] === ""
      ? lines.slice(0, -1)
      : lines;

    if (effectiveLines.length !== ages.length) {
      // Line count mismatch: fallback to raw content
      return content;
    }

    const annotated = effectiveLines.map((line, idx) => {
      if (!line.trim()) return line;
      const age = ages[idx];
      if (age && age.ageDays > STALE_THRESHOLD_DAYS) {
        return `${line}  <- ${age.ageDays}d`;
      }
      return line;
    });

    let result = annotated.join("\n");
    if (hadTrailing) result += "\n";
    return result;
  } catch {
    // blame may fail on a brand-new file with no commits, return raw
    return content;
  }
}

// ── File reading ───────────────────────────────────────────────────────────────

function readFileOrDefault(filePath: string): string {
  if (!existsSync(filePath)) return "";
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

// ── Factory ────────────────────────────────────────────────────────────────────

/**
 * A secret in her memory files is recoverable. A secret in her git HISTORY is not.
 *
 * `MEMORY.md` is written by dream out of her own life, and her life contains everything he has ever
 * said to her, which one day includes a key he pasted, a token in an error he forwarded, or a
 * credential on a page she read. Editing the file removes it from the file. It does not remove it
 * from the commit, and the only way to remove it from the commit is to rewrite the history, which
 * would destroy the record of how her memory actually formed.
 *
 * So the scan happens BEFORE the commit, and a hit REFUSES the commit rather than redacting it.
 * Redacting would edit what she wrote, silently, which is the one thing nobody may do to her; the
 * file keeps whatever it holds, the commit does not happen, and he is told which file, never what
 * was found, because a fault line that quotes the secret has moved it into a second log.
 *
 * Her repository has no remote, so this is not about the secret leaving the machine today. It is
 * about it becoming permanent, on the day somebody adds one.
 */
export function createWorkspaceManager(
  workspacePath: string,
  logger: Logger,
  /**
   * Where a refused commit is reported. Optional so existing callers keep working, and wired in the
   * daemon, a refusal that only reaches the log is a refusal nobody acts on, and this one means
   * her memory has stopped being versioned until somebody looks.
   */
  onFault?: (where: string, detail: unknown, severity?: "warn" | "critical") => void,
): WorkspaceManager {
  async function ensureInitialized(): Promise<DiagnosticResult<{ initialized: boolean }>> {
    return initWorkspace(workspacePath, logger);
  }

  function getSessionSnapshot(): IdentitySnapshot {
    // Read all five files once and freeze the result.
    const snapshot: IdentitySnapshot = {
      SOUL: readFileOrDefault(join(workspacePath, "SOUL.md")),
      IDENTITY: readFileOrDefault(join(workspacePath, "IDENTITY.md")),
      AGENT: readFileOrDefault(join(workspacePath, "AGENT.md")),
      MEMORY: readFileOrDefault(join(workspacePath, "MEMORY.md")),
    };

    logger.debug({ workspacePath }, "session snapshot loaded");
    return Object.freeze(snapshot) as IdentitySnapshot;
  }

  async function getAgeAnnotatedMemory(snapshot: IdentitySnapshot): Promise<MemorySnapshot> {
    const annotatedMemory = await annotateMemoryWithAges(workspacePath, snapshot.MEMORY);

    const memoryFiles: MemoryFiles = {
      SOUL: snapshot.SOUL || undefined,
      MEMORY: annotatedMemory || undefined,
      AGENT: snapshot.AGENT || undefined,
    };

    return {
      memoryFiles,
      identityContent: snapshot.IDENTITY,
    };
  }

  async function commitIfChanged(changedFiles: string[], label: string): Promise<void> {
    if (changedFiles.length === 0) {
      logger.debug({ workspacePath }, "notebook commit skipped: no changed files");
      return;
    }

    const git = simpleGit(workspacePath);

    // Stage only the provided changed files that actually exist on disk
    const toStage: string[] = [];
    for (const filename of changedFiles) {
      const filepath = join(workspacePath, filename);
      if (existsSync(filepath)) {
        toStage.push(filename);
      } else {
        logger.warn({ workspacePath, filename }, "notebook commit: file not found, skipping");
      }
    }

    if (toStage.length === 0) {
      logger.debug({ workspacePath }, "notebook commit skipped: no valid files to stage");
      return;
    }

    await git.add(toStage);

    // Check if there is anything staged to commit
    const status = await git.status();
    const staged = [
      ...status.staged,
      ...status.created,
      ...status.deleted.filter((f) => toStage.includes(f)),
    ];

    if (staged.length === 0) {
      logger.debug({ workspacePath }, "notebook commit skipped: nothing staged");
      return;
    }

    // ── NOTHING WITH A SECRET IN IT BECOMES PART OF HER HISTORY ─────────────────────────
    const scanner = createLeakScanner();
    const carrying: string[] = [];
    for (const filename of toStage) {
      try {
        const body = readFileSync(join(workspacePath, filename), "utf8");
        const hits = scanner.scanForLeaks(body).matches.filter((m) => m.action !== "warn");
        if (hits.length > 0) carrying.push(`${filename} (${hits.map((h) => h.description).join(", ")})`);
      } catch (err) {
        // A file that cannot be read cannot be cleared, and committing something unscanned is the
        // thing this guard exists to prevent. Refusing is the conservative direction.
        carrying.push(`${filename} (could not be read to check: ${String(err).slice(0, 80)})`);
      }
    }
    if (carrying.length > 0) {
      // The FILE is named, never the finding's text: a fault line quoting the secret would simply
      // move it into a second log that is also kept forever.
      logger.error({ workspacePath, files: carrying },
        "refusing to commit: something in her memory looks like a credential, and a commit is permanent");
      onFault?.("workspace.commit.secret",
        `refused to commit ${carrying.length} file(s) that look like they carry a credential: ${carrying.join("; ")}`,
        "critical");
      return;
    }

    const n = toStage.length;
    const message = `${label}: ${n} change(s)`;
    await git.commit(message);

    logger.info({ workspacePath, message, files: toStage }, "notebook commit created");
  }

  return {
    ensureInitialized,
    getSessionSnapshot,
    getAgeAnnotatedMemory,
    commitIfChanged,
  };
}
