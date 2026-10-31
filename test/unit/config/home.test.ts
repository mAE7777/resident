import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  FOREIGN_HOMES,
  ForeignHomeError,
  HOME_DIRNAME,
  applyHomeToConfig,
  assertOwnHome,
  canonical,
  defaultDbPath,
  defaultTracesDir,
  defaultWorkspacePath,
  expandTilde,
  isUnder,
  residentHome,
  resolveHome,
} from "../../../src/config/home.js";

// The neighbour whose home must never hold any part of hers. Read from the module so a
// future addition to FOREIGN_HOMES is covered rather than silently untested.
const NEIGHBOUR = join(homedir(), FOREIGN_HOMES[0]);

describe("home: the one root", () => {
  let saved: string | undefined;
  let tmp: string;

  beforeEach(() => {
    saved = process.env["RESIDENT_HOME"];
    tmp = mkdtempSync(join(tmpdir(), "resident-home-"));
  });

  afterEach(() => {
    if (saved === undefined) delete process.env["RESIDENT_HOME"];
    else process.env["RESIDENT_HOME"] = saved;
    rmSync(tmp, { recursive: true, force: true });
  });

  describe("defaults", () => {
    it("puts her home under $HOME, not in the neighbour's", () => {
      delete process.env["RESIDENT_HOME"];
      expect(residentHome()).toBe(canonical(join(homedir(), HOME_DIRNAME)));
      expect(isUnder(residentHome(), NEIGHBOUR)).toBe(false);
    });

    it("derives workspace, db and traces from that one root", () => {
      delete process.env["RESIDENT_HOME"];
      const home = residentHome();
      for (const p of [defaultWorkspacePath(), defaultDbPath(), defaultTracesDir()]) {
        expect(isUnder(p, home)).toBe(true);
      }
    });

    it("follows RESIDENT_HOME when set", () => {
      process.env["RESIDENT_HOME"] = tmp;
      expect(residentHome()).toBe(canonical(tmp));
      expect(defaultDbPath()).toBe(join(canonical(tmp), "data.db"));
    });

    it("refuses a relative RESIDENT_HOME rather than resolving it against the cwd", () => {
      process.env["RESIDENT_HOME"] = "some/relative/dir";
      expect(() => residentHome()).toThrow(ForeignHomeError);
    });
  });

  describe("isUnder", () => {
    it("compares path segments, not string prefixes", () => {
      // The bug this guards: `~/.residentEVIL`.startsWith(`~/.resident`) is true.
      expect(isUnder(tmp + "EVIL", tmp)).toBe(false);
      expect(isUnder(join(tmp, "workspace"), tmp)).toBe(true);
      expect(isUnder(tmp, tmp)).toBe(true);
    });

    it("resolves symlinked roots so a real containment is not read as an escape", () => {
      // On macOS /tmp is a symlink to /private/tmp; a string compare gets this wrong.
      mkdirSync(join(tmp, "workspace"), { recursive: true });
      expect(isUnder(join(tmp, "workspace"), tmp)).toBe(true);
    });
  });

  describe("expandTilde", () => {
    it("expands a leading ~ because config files are written by hand", () => {
      expect(expandTilde("~/x")).toBe(join(homedir(), "x"));
      expect(expandTilde("~")).toBe(homedir());
    });

    it("leaves paths that merely contain a tilde alone", () => {
      expect(expandTilde("/a/~b")).toBe("/a/~b");
    });
  });

  describe("assertOwnHome", () => {
    it("accepts paths inside her home", () => {
      expect(() =>
        assertOwnHome({ workspace: join(tmp, "workspace"), db: join(tmp, "data.db") }, tmp)
      ).not.toThrow();
    });

    it("refuses a path inside the neighbour's home", () => {
      expect(() =>
        assertOwnHome({ db: join(NEIGHBOUR, "data.db") }, tmp)
      ).toThrow(/another agent's home/u);
    });

    it("refuses when her home IS the neighbour's home", () => {
      expect(() =>
        assertOwnHome({ workspace: join(NEIGHBOUR, "workspace") }, NEIGHBOUR)
      ).toThrow(/another agent's home/u);
    });

    it("refuses a path outside her home even when it is nobody else's", () => {
      expect(() => assertOwnHome({ db: "/var/tmp/stray.db" }, tmp)).toThrow(/outside her home/u);
    });

    it("names every offending path, not just the first", () => {
      let message = "";
      try {
        assertOwnHome({ workspace: join(NEIGHBOUR, "workspace"), db: "/var/tmp/stray.db" }, tmp);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain("workspace");
      expect(message).toContain("db");
    });

    it("treats an unset path as a problem rather than passing it", () => {
      expect(() => assertOwnHome({ db: "" }, tmp)).toThrow(/db is not set/u);
    });
  });

  describe("resolveHome: the split that used to be silent", () => {
    // Two independent config keys meant either half could be left behind, and BOTH
    // half-moves failed quietly at runtime. These are the two exact configurations.

    it("refuses a config that moved the workspace and left the database behind", () => {
      process.env["RESIDENT_HOME"] = tmp;
      expect(() =>
        resolveHome(
          {},
          {
            workspace: { path: join(tmp, "workspace") },
            database: { dbPath: join(NEIGHBOUR, "data.db") },
          }
        )
      ).toThrow(ForeignHomeError);
    });

    it("refuses a config that moved the database and left the workspace behind", () => {
      process.env["RESIDENT_HOME"] = tmp;
      expect(() =>
        resolveHome(
          {},
          {
            workspace: { path: join(NEIGHBOUR, "workspace") },
            database: { dbPath: join(tmp, "data.db") },
          }
        )
      ).toThrow(ForeignHomeError);
    });

    it("resolves both halves from the one root when config says nothing", () => {
      process.env["RESIDENT_HOME"] = tmp;
      const r = resolveHome();
      expect(r.home).toBe(canonical(tmp));
      expect(r.workspacePath).toBe(join(canonical(tmp), "workspace"));
      expect(r.dbPath).toBe(join(canonical(tmp), "data.db"));
      expect(r.relocated).toBe(false);
    });

    it("relocates the WHOLE home from --home, not one half of it", () => {
      process.env["RESIDENT_HOME"] = join(tmp, "unused");
      const r = resolveHome({ home: tmp }, { database: { dbPath: join(NEIGHBOUR, "data.db") } });
      expect(r.relocated).toBe(true);
      expect(r.home).toBe(canonical(tmp));
      expect(isUnder(r.dbPath, r.home)).toBe(true);
      expect(isUnder(r.dbPath, NEIGHBOUR)).toBe(false);
    });

    it("treats --workspace as naming the home's workspace, so the db follows it", () => {
      const r = resolveHome({ workspace: join(tmp, "workspace") });
      expect(r.home).toBe(canonical(tmp));
      expect(r.dbPath).toBe(join(canonical(tmp), "data.db"));
    });

    it("refuses --workspace pointing into the neighbour's home", () => {
      expect(() => resolveHome({ workspace: join(NEIGHBOUR, "workspace") })).toThrow(
        /another agent's home/u
      );
    });

    it("writes the resolved paths back, so nothing downstream reads a stale one", () => {
      // Plenty of code is handed the whole config and reads config.workspace.path itself,
      // the Telegram commands do, for /memory, /skills and /health. A relocation that left
      // that field alone would point them at a workspace she is not living in, which is the
      // same stale-copy bug one level up.
      const config = {
        workspace: { path: join(NEIGHBOUR, "workspace") },
        database: { dbPath: join(NEIGHBOUR, "data.db") },
      };
      const paths = resolveHome({ home: tmp }, config);
      applyHomeToConfig(config, paths);
      expect(config.workspace.path).toBe(paths.workspacePath);
      expect(config.database.dbPath).toBe(paths.dbPath);
      expect(isUnder(config.workspace.path, tmp)).toBe(true);
      expect(isUnder(config.database.dbPath, NEIGHBOUR)).toBe(false);
    });

    it("leaves a config alone when it declares no paths to begin with", () => {
      process.env["RESIDENT_HOME"] = tmp;
      const config: { workspace?: { path?: string } } = {};
      expect(() => applyHomeToConfig(config, resolveHome())).not.toThrow();
      expect(config.workspace).toBeUndefined();
    });

    it("puts every durable path it returns under the one root", () => {
      process.env["RESIDENT_HOME"] = tmp;
      const r = resolveHome();
      for (const p of [r.workspacePath, r.dbPath, r.tracesDir]) {
        expect(isUnder(p, r.home)).toBe(true);
        expect(isUnder(p, NEIGHBOUR)).toBe(false);
      }
    });
  });
});
