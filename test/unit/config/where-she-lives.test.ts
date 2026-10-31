import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkWhereSheLives } from "../../../src/config/where-she-lives.js";
import { explainNativeFailure } from "../../../src/db/native-check.js";

/**
 * A SYNC CLIENT AND A LIVE DATABASE.
 *
 * Her database in WAL mode is three files that are only meaningful TOGETHER, `data.db`,
 * `data.db-wal`, `data.db-shm`. iCloud, Dropbox, Google Drive and OneDrive all upload and replace
 * files one at a time, in whatever order they notice them, and iCloud additionally EVICTS files it
 * thinks are cold, leaving a placeholder to be fetched on demand.
 *
 * So the damage is not a failed write with an error on it. It is a database that opens, reads
 * mostly right, and is quietly wrong, and by the time anything looks wrong, the good version has
 * been synced over. That is why this refuses to boot rather than warning: refusing costs a
 * sentence and one flag; the alternative costs her memory.
 */

describe("where she is allowed to live", () => {
  it("an ordinary local home is fine", () => {
    const r = checkWhereSheLives("/Users/someone/resident");
    expect(r.ok).toBe(true);
    expect(r.refuseBecause).toBeNull();
    expect(r.warnBecause).toBeNull();
  });

  it("iCloud Drive is refused", () => {
    const r = checkWhereSheLives("/Users/someone/Library/Mobile Documents/com~apple~CloudDocs/resident");
    expect(r.ok).toBe(false);
    expect(r.refuseBecause).toContain("iCloud Drive");
  });

  it("and so are the others, by name", () => {
    for (const [path, name] of [
      ["/Users/someone/Dropbox/resident", "Dropbox"],
      ["/Users/someone/Google Drive/resident", "Google Drive"],
      ["/Users/someone/OneDrive - Work/resident", "OneDrive"],
      ["/Users/someone/Library/CloudStorage/Dropbox/resident", "cloud drive"],
    ] as const) {
      const r = checkWhereSheLives(path);
      expect(r.ok, `${path} was allowed`).toBe(false);
      expect(r.refuseBecause).toContain(name);
    }
  });

  it("the refusal says what to do, not just what is wrong", () => {
    // A refusal he cannot act on is a refusal that gets overridden blindly.
    const r = checkWhereSheLives("/Users/someone/Dropbox/resident");
    expect(r.refuseBecause).toContain("--home");
    expect(r.refuseBecause).toContain("RESIDENT__HOME__ALLOW_SYNCED=1");
    expect(r.refuseBecause, "it does not say why the damage is invisible").toContain("silent");
  });

  it("Desktop and Documents WARN rather than refuse — iCloud syncs them by default, but might not", () => {
    // The separating judgement: certainly-synced blocks, maybe-synced informs. Treating a maybe as
    // a certainty would refuse to boot on a perfectly good machine, which teaches him to override.
    const r = checkWhereSheLives("/Users/someone/Documents/resident");
    expect(r.ok).toBe(true);
    expect(r.warnBecause).toContain("iCloud");
  });

  it("the override lets him through, and still says it out loud", () => {
    const r = checkWhereSheLives("/Users/someone/Dropbox/resident", { allowSynced: true });
    expect(r.ok).toBe(true);
    expect(r.warnBecause, "an override that goes quiet is an override he forgets he set").toContain("Dropbox");
  });

  it("and the daemon checks before anything opens her database", () => {
    const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
    const check = daemon.indexOf("checkWhereSheLives(homePaths.home");
    const open = daemon.indexOf("createDatabase(dbPath");
    const lock = daemon.indexOf("claimHome(homePaths.home)");
    expect(check, "nothing checks where she lives").toBeGreaterThan(-1);
    expect(check, "her database is opened before anyone asks whether the directory is safe").toBeLessThan(open);
    expect(check, "the check should come before the lock, so a bad home never leaves a lock file").toBeLessThan(lock);
  });
});

describe("when the compiled database module stops loading", () => {
  // Upgrade Node: including as a side effect of upgrading something else, and `better-sqlite3`
  // no longer matches the ABI. The import throws before any of her machinery exists, so what he
  // sees is a stack trace about NODE_MODULE_VERSION and two numbers, at whatever hour the machine
  // decided to update itself, with nothing in it to say whether she is damaged.

  it("recognises the ABI mismatch and says she is not damaged", () => {
    const err = new Error(
      "The module '/x/better_sqlite3.node' was compiled against a different Node.js version using "
      + "NODE_MODULE_VERSION 115. This version of Node.js requires NODE_MODULE_VERSION 127.");
    const said = explainNativeFailure(err);
    expect(said).not.toBeNull();
    expect(said, "the first thing he reads must be that nothing is lost").toContain("SHE IS NOT DAMAGED");
    expect(said).toContain("pnpm rebuild better-sqlite3");
  });

  it("and tells him NOT to restore a snapshot, which is the tempting wrong move", () => {
    const said = explainNativeFailure(new Error("NODE_MODULE_VERSION 115 ... 127"));
    expect(said, "restoring would cost him everything since the snapshot, for a problem that is not hers")
      .toContain("Do not restore a snapshot");
  });

  it("recognises a missing binary and a wrong architecture too", () => {
    expect(explainNativeFailure(new Error("Could not locate the bindings file for better_sqlite3")))
      .toContain("missing its compiled binary");
    expect(explainNativeFailure(new Error(
      "dlopen(better_sqlite3.node): tried: mach-o file, but is an incompatible architecture")))
      .toContain("different processor architecture");
  });

  it("and stays out of the way of every other failure", () => {
    // If this swallowed unrelated errors it would turn a real fault into a confident wrong answer.
    expect(explainNativeFailure(new Error("SQLITE_CORRUPT: database disk image is malformed"))).toBeNull();
    expect(explainNativeFailure(new Error("ENOENT: no such file or directory, open '/x/config.yaml'"))).toBeNull();
    expect(explainNativeFailure("not an error at all")).toBeNull();
  });
});
