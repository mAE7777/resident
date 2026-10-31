// There is one of her.
//
// WHAT TWO OF HER DO TO EACH OTHER. Nothing stopped `resident start` running twice against the
// same home, and the damage is not a crash, it is silent and total. `field-store.ts` saves her
// field as `DELETE FROM field_nodes; DELETE FROM field_edges; DELETE FROM field_resonance;`
// followed by a full re-insert, inside one transaction. So whichever daemon persists SECOND
// atomically replaces the other's entire memory with its own stale copy. Everything she formed
// in the meantime is gone, with no error anywhere, because both writes succeeded.
//
// `continuity.json` and `self-knowledge.json` are last-writer-wins for the same reason. The
// face server's second bind fails into a fault and the daemon keeps running. Telegram's second
// long-poller conflicts and retries forever. And `writeWithRetry` handles SQLITE_BUSY with
// `Atomics.wait`, which blocks the WHOLE event loop for tens of milliseconds per retry, so
// under contention both processes stutter for seconds at a time, freezing turns and her voice.
//
// A lock file with the holder's pid in it. Taken at boot, released at shutdown, and, the part
// that matters on a machine that loses power, reclaimed when the recorded pid is no longer
// alive, so a crash does not lock her out of her own home forever.

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export interface LockFs {
  existsSync(p: string): boolean;
  readFileSync(p: string, enc: "utf8"): string;
  writeFileSync(p: string, data: string, enc: "utf8"): void;
  unlinkSync(p: string): void;
  mkdirSync(p: string, opts: { recursive: true }): void;
}

const REAL: LockFs = { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync };

export interface OnlyOneDeps {
  fs?: LockFs;
  /** Whether a process is still alive. Signal 0 asks without sending anything. */
  alive?: (pid: number) => boolean;
  pid?: number;
}

export interface HeldLock {
  release(): void;
}

export class AlreadyRunningError extends Error {
  constructor(public readonly pid: number, public readonly path: string) {
    super(
      `Another resident is already living here (pid ${pid}).\n` +
      `Two of her against one home silently destroy each other's memory: the field is saved as a ` +
      `full delete-and-reinsert, so whichever writes second replaces everything the other formed.\n` +
      `If that process is gone, remove ${path} and start again.`,
    );
    this.name = "AlreadyRunningError";
  }
}

/** The one lock file, beside her home rather than in her room. */
export function lockPathFor(home: string): string {
  return join(home, "resident.lock");
}

/**
 * The pid living here right now, or `null` if nobody is.
 *
 * ONE IMPLEMENTATION, because two would drift. The `identity` command had its own copy of this
 * check, read the file, parse a pid, `kill(pid, 0)`, which is the sort of duplication that stays
 * correct right up until one side learns something the other does not (that unparseable rubble is
 * not a claim, say, or that our own pid does not count as somebody else). A copy or a restore taken
 * under a live daemon is the two-of-her failure with the damage arriving later, so the check that
 * decides it should be the same one that decides whether she may boot.
 */
export function whoHoldsHome(home: string, deps: OnlyOneDeps = {}): number | null {
  const fs = deps.fs ?? REAL;
  const isAlive = deps.alive ?? ((p: number): boolean => {
    try { process.kill(p, 0); return true; } catch { return false; }
  });
  const path = lockPathFor(home);
  if (!fs.existsSync(path)) return null;
  const held = Number.parseInt(fs.readFileSync(path, "utf8").trim(), 10);
  if (!Number.isFinite(held)) return null;
  return isAlive(held) ? held : null;
}

/**
 * Claim the home, or refuse to start.
 *
 * A STALE LOCK IS RECLAIMED, and that is not a convenience. A machine that loses power leaves
 * the file behind with a pid that no longer exists, and a lock that cannot be reclaimed would
 * mean she never wakes up again until somebody notices and deletes a file, which is a worse
 * failure than the one being prevented, and a far more likely one.
 */
export function claimHome(home: string, deps: OnlyOneDeps = {}): HeldLock {
  const fs = deps.fs ?? REAL;
  const pid = deps.pid ?? process.pid;
  const isAlive = deps.alive ?? ((p: number): boolean => {
    try { process.kill(p, 0); return true; } catch { return false; }
  });
  const path = lockPathFor(home);

  if (fs.existsSync(path)) {
    const held = Number.parseInt(fs.readFileSync(path, "utf8").trim(), 10);
    // A file we cannot read as a pid is rubble, not a claim: treat it as stale rather than
    // refusing to boot on it forever.
    if (Number.isFinite(held) && held !== pid && isAlive(held)) {
      throw new AlreadyRunningError(held, path);
    }
  }

  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, `${pid}\n`, "utf8");

  return {
    release(): void {
      try {
        // Only ever OUR lock. Releasing one taken by a process that reclaimed it after us
        // would hand her home to a third.
        if (!fs.existsSync(path)) return;
        const held = Number.parseInt(fs.readFileSync(path, "utf8").trim(), 10);
        if (held === pid) fs.unlinkSync(path);
      } catch {
        // A lock we cannot remove is reclaimed by the next boot on the liveness check, so
        // failing here costs nothing and must never be the thing that stops her shutting down.
      }
    },
  };
}
