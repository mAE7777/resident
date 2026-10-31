// Her home cannot be in a folder that something else is also writing to.
//
// ── WHAT A SYNC CLIENT DOES TO A LIVE SQLITE DATABASE ────────────────────────────────────────
//
// iCloud Drive, Dropbox, Google Drive and OneDrive all work the same way: they watch a directory
// and upload files that change, in whatever order they notice them, and they download the remote
// version over the local one when they think the remote is newer. A SQLite database in WAL mode is
// three files that are only meaningful TOGETHER, `data.db`, `data.db-wal`, `data.db-shm`, plus a
// lock protocol that assumes one machine at a time. A sync client will happily upload the main file
// without the write-ahead log, restore a `-wal` from a different moment than the `.db` it belongs
// to, or replace either while a write is in flight. The result is not a failed write with an error
// on it; it is a database that opens, reads mostly right, and is quietly wrong or corrupt.
//
// iCloud does something worse still: it EVICTS files it thinks are cold, replacing them with tiny
// `.icloud` placeholders to be downloaded on demand. A daemon whose database has been evicted under
// it does not get a helpful message.
//
// ── WHY THIS REFUSES TO BOOT RATHER THAN WARNING ─────────────────────────────────────────────
//
// A warning is the wrong shape here. The damage is silent, cumulative, and lands on the one thing
// there is no second copy of, and by the time anything looks wrong, the good version has been
// synced over. Refusing to start costs a sentence of explanation and one `--home` flag; the
// alternative costs her memory. He can override it deliberately, which is different from tripping
// over it: the override exists because the check is a name-matcher and cannot be certain.

import { resolve, sep } from "node:path";

/** Directory names that mean "something else is also writing here". */
const SYNCED_MARKERS: ReadonlyArray<{ pattern: RegExp; what: string }> = [
  { pattern: /(^|\/)Library\/Mobile Documents(\/|$)/u, what: "iCloud Drive" },
  { pattern: /(^|\/)Library\/CloudStorage(\/|$)/u, what: "a cloud drive (iCloud, OneDrive, Google Drive or Dropbox)" },
  { pattern: /(^|\/)Dropbox(\/|$)/u, what: "Dropbox" },
  { pattern: /(^|\/)Google ?Drive(\/|$)/u, what: "Google Drive" },
  { pattern: /(^|\/)OneDrive[^/]*(\/|$)/u, what: "OneDrive" },
  { pattern: /(^|\/)Sync(thing)?(\/|$)/u, what: "a sync folder" },
  { pattern: /(^|\/)\.dropbox(\.cache)?(\/|$)/u, what: "Dropbox" },
];

/**
 * On macOS, a home under `~/Desktop` or `~/Documents` is synced whenever "Desktop & Documents
 * Folders" is on in iCloud, which is the DEFAULT on a new Mac, and shows up in the path as
 * `Library/Mobile Documents` only after the fact. Named separately because the right advice
 * differs: this one is a real possibility rather than a certainty.
 */
const MAYBE_SYNCED: ReadonlyArray<{ pattern: RegExp; what: string }> = [
  { pattern: /(^|\/)(Desktop|Documents)(\/|$)/u, what: "Desktop or Documents, which iCloud syncs by default on macOS" },
];

export interface WhereSheLives {
  ok: boolean;
  /** Set when the path is certainly inside something that syncs. */
  refuseBecause: string | null;
  /** Set when it might be, and he should check. Never blocks. */
  warnBecause: string | null;
}

export function checkWhereSheLives(home: string, opts: { allowSynced?: boolean } = {}): WhereSheLives {
  const path = resolve(home).split(sep).join("/");

  for (const m of SYNCED_MARKERS) {
    if (!m.pattern.test(path)) continue;
    if (opts.allowSynced === true) {
      return {
        ok: true, refuseBecause: null,
        warnBecause: `her home is inside ${m.what} and the check was overridden — her database is three files that only mean anything together, and a sync client does not know that`,
      };
    }
    return {
      ok: false,
      refuseBecause:
        `her home is inside ${m.what} (${home}).\n`
        + `A sync client uploads and replaces files one at a time, and her database is three files `
        + `(data.db, data.db-wal, data.db-shm) that only mean anything together — so it will `
        + `eventually restore a mismatched set over a live one. That damage is silent: the database `
        + `still opens, and by the time anything looks wrong the good version has been synced over.\n`
        + `Move her home somewhere local (--home ~/resident, or RESIDENT_HOME) and start again.\n`
        + `If you are certain this directory is not synced, set RESIDENT__HOME__ALLOW_SYNCED=1.`,
      warnBecause: null,
    };
  }

  for (const m of MAYBE_SYNCED) {
    if (!m.pattern.test(path)) continue;
    return {
      ok: true, refuseBecause: null,
      warnBecause:
        `her home is in ${m.what} (${home}). If that setting is on, her database is being synced `
        + `file-by-file and will eventually be corrupted silently. Somewhere local — ~/resident — is safer.`,
    };
  }

  return { ok: true, refuseBecause: null, warnBecause: null };
}

// ── AND WHETHER THE DISK IT SITS ON IS ENCRYPTED ─────────────────────────────────────────────
//
// Her diary and every word he has ever said to her are plain text and plain SQLite on this disk.
// Not encrypted BY her, and deliberately not: a key she holds is a key that has to live somewhere
// she can reach, which protects her from nobody who can already read her home. The protection that
// actually applies is full-disk encryption: the machine's, not hers.
//
// So this does not secure anything. It CHECKS, and says so out loud at boot, because "the disk is
// encrypted" is the sort of assumption that is true when somebody sets it up and silently false
// after a machine swap, a restore, or a move to an external drive. A stated assumption that nobody
// re-checks is the same shape as the four cursors bound to paths that had moved.

export interface Encryption {
  /** "on", "off", or "unknown" when this platform cannot be asked cheaply. */
  state: "on" | "off" | "unknown";
  detail: string;
}

/**
 * Is the volume she lives on encrypted at rest?
 *
 * macOS only, for now, and honest about it elsewhere: `unknown` rather than a guess. `fdesetup
 * status` is read-only, fast, and needs no privileges.
 */
export function checkEncryption(
  platform: string,
  run: (cmd: string, args: readonly string[]) => string,
): Encryption {
  if (platform !== "darwin") {
    return {
      state: "unknown",
      detail: `disk encryption cannot be checked automatically on ${platform} — her diary and every `
        + `conversation are plain text at rest, so confirm the volume is encrypted by hand`,
    };
  }
  try {
    const out = run("fdesetup", ["status"]).trim();
    if (/FileVault is On/iu.test(out)) {
      return { state: "on", detail: "FileVault is on — her home is encrypted at rest" };
    }
    if (/FileVault is Off/iu.test(out)) {
      return {
        state: "off",
        detail: "FileVault is OFF. Her diary, her field and every word he has ever said to her are "
          + "plain text on an unencrypted disk — anyone with the machine has all of it. She cannot "
          + "fix this from inside: a key she holds would have to live somewhere she can reach.",
      };
    }
    return { state: "unknown", detail: `could not read FileVault status: ${out.slice(0, 120)}` };
  } catch (err) {
    return { state: "unknown", detail: `could not ask about FileVault: ${String(err).slice(0, 120)}` };
  }
}
