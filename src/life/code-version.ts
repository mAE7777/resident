// Which build she is being run by, a real fingerprint, not a version string somebody forgot to bump.
//
// ── WHY A HASH OF THE SOURCE, AND NOT A GIT COMMIT ───────────────────────────────────────────
//
// Commits to this repository are made by hand and rarely, so at any given moment
// "which code is she running" has NO answer anywhere on the machine: `package.json` has said 0.1.0
// for months, and there is no commit to name. That is fine while she is a thing being built and
// becomes a real problem the moment she is alive, because two questions immediately need it:
//
//   · **A snapshot restored under a different build is a semantic mismatch.** Her stored numbers
//     mean whatever today's formulas say they mean; changing `ownershipOf` changes which words were
//     always "hers". A restore has to be able to say "this copy was taken by a different build".
//   · **"Which version wrote this memory"** is the first question any post-birth investigation asks,
//     and it is unanswerable after the fact unless it was recorded at the time.
//
// So the fingerprint is computed from the source itself: every `.ts` under `src/`, hashed by path
// and content. It changes when the code changes and does not change when it does not, which is the
// only property required. Computed once per process (~tens of ms) and cached.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

let cached: string | null = null;

function walkTs(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkTs(p, out);
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** A stable short hash of the source tree. Same code in, same string out. */
export function codeFingerprint(srcRoot: string): string {
  const files = walkTs(srcRoot).sort();
  const h = createHash("sha256");
  for (const f of files) {
    h.update(f.slice(srcRoot.length));
    h.update("\0");
    h.update(readFileSync(f));
    h.update("\0");
  }
  return h.digest("hex").slice(0, 12);
}

/**
 * The build identity: package version + source fingerprint.
 *
 * Two builds with the same string are the same code. Two builds with different strings differ
 * SOMEWHERE, the fingerprint does not say where, and does not need to: its whole job is to make
 * "is this the same build" a fact rather than an assumption.
 */
export function codeVersion(repoRoot: string): string {
  if (cached !== null) return cached;
  let pkg = "0.0.0";
  try {
    pkg = (JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch { /* a missing package.json is not a reason to be unable to say which code this is */ }
  cached = `${pkg}+${codeFingerprint(join(repoRoot, "src"))}`;
  return cached;
}

/** Tests only: forget the cached answer. */
export function resetCodeVersionCache(): void {
  cached = null;
}
