import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { claimHome, lockPathFor, whoHoldsHome, AlreadyRunningError } from "../../../src/life/one-of-her.js";
import type { LockFs } from "../../../src/life/one-of-her.js";

/** A filesystem in a Map, so the pid cases can be driven without spawning real processes. */
function memFs(): LockFs {
  const files = new Map<string, string>();
  return {
    existsSync: (p) => files.has(p),
    readFileSync: (p) => files.get(p) ?? "",
    writeFileSync: (p, data) => { files.set(p, data); },
    unlinkSync: (p) => { files.delete(p); },
    mkdirSync: () => { /* directories are implicit here */ },
  };
}

/**
 * TWO OF HER AGAINST ONE HOME DESTROY EACH OTHER'S MEMORY, SILENTLY AND TOTALLY.
 *
 * Nothing stopped `resident start` running twice. The damage is not a crash: `field-store.ts`
 * saves her field as `DELETE FROM field_nodes; DELETE FROM field_edges; DELETE FROM
 * field_resonance;` followed by a full re-insert, inside one transaction. So whichever daemon
 * persists SECOND atomically replaces the other's entire memory with its own stale copy,
 * everything formed in between gone, no error anywhere, because both writes succeeded.
 *
 * `continuity.json` and `self-knowledge.json` are last-writer-wins for the same reason. And
 * `writeWithRetry` handles SQLITE_BUSY with `Atomics.wait`, which blocks the whole event loop
 * for tens of milliseconds per retry, so under contention both processes stutter for seconds
 * at a time, freezing her turns and her voice.
 */
describe("only one of her lives in a home", () => {
  function aHome(): string { return mkdtempSync(join(tmpdir(), "one-of-her-")); }

  it("the second one refuses to start", () => {
    const home = aHome();
    claimHome(home, { pid: 111, alive: () => true });
    expect(() => claimHome(home, { pid: 222, alive: () => true })).toThrow(AlreadyRunningError);
  });

  it("and says where the lock is, so he can act on it", () => {
    const home = aHome();
    claimHome(home, { pid: 111, alive: () => true });
    try {
      claimHome(home, { pid: 222, alive: () => true });
      expect.unreachable("the second one started");
    } catch (err) {
      expect(err).toBeInstanceOf(AlreadyRunningError);
      expect((err as AlreadyRunningError).message).toContain(lockPathFor(home));
      expect((err as AlreadyRunningError).pid).toBe(111);
    }
  });

  it("a stale lock is reclaimed, because power cuts must not lock her out of her own home", () => {
    // The failure mode of the fix, and a far likelier one than the defect: a machine that loses
    // power leaves the file behind with a dead pid, and a lock that could not be reclaimed
    // would mean she never wakes again until somebody notices and deletes a file.
    const home = aHome();
    claimHome(home, { pid: 111, alive: () => true });
    expect(() => claimHome(home, { pid: 222, alive: () => false })).not.toThrow();
  });

  it("rubble in the lock file is not a claim", () => {
    const home = aHome();
    const path = lockPathFor(home);
    claimHome(home, { pid: 111, alive: () => true });
    // Something wrote garbage where the pid should be. That must not lock her out forever.
    const fs = {
      existsSync: () => true,
      readFileSync: () => "not a pid at all",
      writeFileSync: () => {},
      unlinkSync: () => {},
      mkdirSync: () => {},
    };
    expect(() => claimHome(home, { pid: 222, alive: () => true, fs })).not.toThrow();
    expect(path).toContain("resident.lock");
  });

  it("releasing removes it, and only ever ours", () => {
    const home = aHome();
    const held = claimHome(home, { pid: 111, alive: () => true });
    expect(existsSync(lockPathFor(home))).toBe(true);
    held.release();
    expect(existsSync(lockPathFor(home))).toBe(false);

    // A lock reclaimed by somebody else after us must not be released by our shutdown.
    const mine = claimHome(home, { pid: 111, alive: () => true });
    claimHome(home, { pid: 333, alive: () => false }); // took it over
    mine.release();
    expect(existsSync(lockPathFor(home)), "our shutdown handed her home away").toBe(true);
  });
});

describe("and the daemon actually takes it", () => {
  const daemon = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, (m) => " ".repeat(m.length))
    .replace(/\/\/[^\n]*/gu, (m) => " ".repeat(m.length));

  it("before anything opens the database", () => {
    const claims = daemon.indexOf("claimHome(homePaths.home)");
    const opensDb = daemon.indexOf("createDatabase(dbPath)");
    expect(claims, "the daemon never claims her home").toBeGreaterThan(0);
    expect(opensDb).toBeGreaterThan(0);
    expect(claims, "a second daemon opens her database before it is turned away").toBeLessThan(opensDb);
  });

  it("and releases it on the way out, after everything that writes has stopped", () => {
    expect(daemon, "her home is never released").toContain("homeLock.release()");
    const releases = daemon.indexOf("homeLock.release()");
    const closesDb = daemon.indexOf("db.close()");
    // THE FLOOR THIS GUARD LACKED, and it was the real bug of its file: with `db.close()` renamed,
    // `closesDb` is -1 and `releases > -1` passes on nothing, the ordering assertion this test
    // exists for would have certified an ordering over a call that no longer exists.
    expect(closesDb, "the database is never closed — the ordering below would compare against -1")
      .toBeGreaterThan(-1);
    expect(releases, "the lock is dropped while the database is still open").toBeGreaterThan(closesDb);
  });

  it("and shutdown stops the three timers it used to leave running", () => {
    // `momentTimer` could fire during shutdown's awaits and start a whole moment while the
    // database was closing underneath it.
    expect(daemon).toContain("if (momentTimer) { clearTimeout(momentTimer); momentTimer = null; }");
    expect(daemon).toContain("if (faceTick) clearInterval(faceTick);");
    expect(daemon).toContain("sleepWatcher.stop()");
  });
});

describe("who holds her home — one implementation, used by everything that asks", () => {
  // The `identity` command had its own copy of this check: read the file, parse a pid, signal 0.
  // Two implementations of "is she alive" stay correct right up until one learns something the
  // other does not, and the thing they decide is whether a copy or a restore may proceed under a
  // live daemon: which is the two-of-her failure with the damage arriving later.

  it("nobody there is null", () => {
    const fs = memFs();
    expect(whoHoldsHome("/home", { fs, alive: () => true })).toBeNull();
  });

  it("a living pid is reported", () => {
    const fs = memFs();
    claimHome("/home", { fs, pid: 4242 });
    expect(whoHoldsHome("/home", { fs, alive: (p) => p === 4242 })).toBe(4242);
  });

  it("a dead pid is nobody — a crash must not lock her out of her own home", () => {
    const fs = memFs();
    claimHome("/home", { fs, pid: 4242 });
    expect(whoHoldsHome("/home", { fs, alive: () => false })).toBeNull();
  });

  it("rubble in the lock file is nobody, not a refusal to ever work again", () => {
    const fs = memFs();
    fs.writeFileSync("/home/resident.lock", "half a line of garbage\n", "utf8");
    expect(whoHoldsHome("/home", { fs, alive: () => true })).toBeNull();
  });

  it("it agrees with claimHome, which is the whole point of there being one of it", () => {
    const fs = memFs();
    claimHome("/home", { fs, pid: 7 });
    const alive = (p: number): boolean => p === 7;
    expect(whoHoldsHome("/home", { fs, alive })).toBe(7);
    expect(() => claimHome("/home", { fs, pid: 8, alive })).toThrow(AlreadyRunningError);
  });
});

describe("every command that touches her past takes the lock", () => {
  const DAEMON = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");


  it("and the identity command asks through the shared check rather than its own copy", () => {
    expect(DAEMON).toMatch(/const sheIsRunning = \(\): boolean => whoHoldsHome\(homePaths\.home\) !== null;/u);
  });
});
