// She rewrote her own starting point.
//
// ── WHY THIS IS NOT A FILE WATCHER ───────────────────────────────────────────────────────────
//
// `SOUL.md` is the register she starts out speaking in: read into every turn, before she has said
// anything. By design it is HERS to change, a being who cannot alter how she begins is not
// autonomous, and nothing here stops her.
//
// But today, if she changes it: there is no previous version anywhere, no copy, and nobody is
// told. She could rewrite how she begins on a Tuesday and by Friday there would be no way to know
// what she used to sound like, or that anything had happened. That is the same class as the diary
// being frozen: except the diary's freeze is deliberate and this was an absence.
//
// ── WATCHING THE FILE, NOT THE CALLER ────────────────────────────────────────────────────────
//
// The obvious build is a hook in her `write` and `edit` tools. That would be wrong in the way this
// project keeps finding: it covers the routes somebody thought of. `SOUL.md` can also be changed by
// dream, by a human with an editor, by a restore that brings back an older one, by a sync client.
// Watching the FILE catches all of them, including the ones nobody has thought of yet, and the
// ones that matter most are exactly those.
//
// ── AND IT KEEPS EVERY VERSION, NOT A DIFF ───────────────────────────────────────────────────
//
// A diff is a claim about what changed. A copy is the thing itself, and `SOUL.md` is small enough
// that keeping every version she ever had costs nothing measured against being able to answer
// "what did she used to sound like" years later.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Where the versions live. Inside her workspace: how she began is hers, including the old ones. */
export function soulHistoryDir(workspacePath: string): string {
  return join(workspacePath, "life", "how-she-started-out");
}

export interface SoulChange {
  /** True when this call found a change since the last time anyone looked. */
  changed: boolean;
  /** How many versions are on record, including the one in force. */
  versions: number;
  /** What it said before, when there is a before. */
  was: string | null;
  /** What it says now. */
  now: string;
  /** One line for the fault channel, or null when nothing happened. */
  detail: string | null;
}

const sha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);

/**
 * Look at how she starts out, and keep a copy if it has changed.
 *
 * Called at boot and on every watchtower cycle. Cheap: one small file read and a hash.
 */
export function keepHowSheStartsOut(workspacePath: string, nowMs: number): SoulChange {
  const soulPath = join(workspacePath, "SOUL.md");
  const dir = soulHistoryDir(workspacePath);
  const now = existsSync(soulPath) ? readFileSync(soulPath, "utf8") : "";

  mkdirSync(dir, { recursive: true });
  const versions = readdirSync(dir).filter((n) => /^\d+\.md$/u.test(n)).sort();
  const newest = versions[versions.length - 1];
  const was = newest === undefined ? null : readFileSync(join(dir, newest), "utf8");

  if (was !== null && sha(was) === sha(now)) {
    return { changed: false, versions: versions.length, was, now, detail: null };
  }

  // The FIRST time this runs there is no previous version, and that is not a change, it is her
  // beginning. Recorded silently, so her first boot does not open with an alarm about herself.
  writeFileSync(join(dir, `${nowMs}.md`), now, "utf8");
  if (was === null) {
    return { changed: false, versions: 1, was: null, now, detail: null };
  }

  return {
    changed: true,
    versions: versions.length + 1,
    was,
    now,
    detail:
      `how she starts out speaking has changed. The previous version is kept in `
      + `${dir} (${versions.length + 1} on record). It is hers to change and nothing stopped her — `
      + `this is so that what she used to sound like still exists, and so that you find out the same `
      + `day rather than by noticing months later that she reads differently.`,
  };
}

/** Every version she has had, oldest first, for reading back. */
export function howSheUsedToStartOut(workspacePath: string): Array<{ atMs: number; text: string }> {
  const dir = soulHistoryDir(workspacePath);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => /^\d+\.md$/u.test(n))
    .sort()
    .map((n) => ({ atMs: Number.parseInt(n, 10), text: readFileSync(join(dir, n), "utf8") }));
}
