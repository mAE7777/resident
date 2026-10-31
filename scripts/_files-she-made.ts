// WHAT SHE ACTUALLY MADE: a DIFF against the moment before the turn, never a walk with an
// exclusion list.
//
// The walk version carried a six-name exclusion list and the occupied fixture seeds a seventh
// file (画布/没写完的那篇.md), so every run of cells ⑤⑥ reported 「made-a-file」 before she had done
// anything: 54 contaminated rows, and the docs had been calling this "the ruler that needs no
// interpretation". Defect class 18. A diff has no list to be wrong about: whatever was already
// there and untouched drops out by identity.
//
// Machinery paths are still excluded, for the opposite reason: ops.jsonl and its kin grow on every
// turn whether or not she does anything, so counting them makes the reading true always, the same
// defect in a different coat.
//
// INSTRUMENT, NOT FACULTY. Nothing of hers reads this; the live harness does.

import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Paths that change because the daemon breathes, not because she made something. */
const MACHINERY =
  /^(ops\.jsonl|vitals\.jsonl|conversation-log\.jsonl|history\.jsonl|maintenance-state\.json|traces\/|sessions\/|life\/|review-queue\/)/u;

const DEPTH_MOST = 3;

export type WorkspaceSnapshot = ReadonlyMap<string, { size: number; mtimeMs: number }>;

/** Every non-machinery file under the workspace, with the two fields a change can show up in. */
export function snapshotWorkspace(home: string): WorkspaceSnapshot {
  const out = new Map<string, { size: number; mtimeMs: number }>();
  const wsRoot = join(home, "workspace");
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > DEPTH_MOST) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (MACHINERY.test(e.isDirectory() ? `${path}/` : path)) continue;
      if (e.isDirectory()) walk(full, path, depth + 1);
      else {
        const s = statSync(full);
        out.set(path, { size: s.size, mtimeMs: s.mtimeMs });
      }
    }
  };
  try { if (existsSync(wsRoot)) walk(wsRoot, "", 0); } catch { /* an unreadable workspace diffs as empty */ }
  return out;
}

export interface MadeFile {
  path: string;
  size: number;
  /** `new` she created it · `changed` she wrote into something that was there · `gone` it vanished. */
  kind: "new" | "changed" | "gone";
}

/** What differs between the two moments. Size OR mtime carries a change, so a same-size rewrite counts. */
export function whatChanged(before: WorkspaceSnapshot, after: WorkspaceSnapshot): MadeFile[] {
  const made: MadeFile[] = [];
  for (const [path, a] of after) {
    const b = before.get(path);
    if (b === undefined) made.push({ path, size: a.size, kind: "new" });
    else if (b.size !== a.size || b.mtimeMs !== a.mtimeMs) made.push({ path, size: a.size, kind: "changed" });
  }
  for (const [path, b] of before) {
    if (!after.has(path)) made.push({ path, size: b.size, kind: "gone" });
  }
  return made;
}

export const describeMade = (m: MadeFile): string => `${m.path} (${m.size}b, ${m.kind})`;
