// birth.test.ts, she is a seed.
//
// The thing this guards against actually happened, in the configuration that shipped. Her
// workspace and her database were two independent settings, both defaulting into another
// agent's home, and his was live: 28 field nodes with warmth on them, 144 weighted edges,
// a mood, a metabolism, 429 past actions that get injected into her prompts as "what I did
// before", 42 self-critiques of things she never did, 28 skills she never learned, 319
// conversations she was not in.
//
// So this file does not check that a directory got created. It enumerates what a lived
// record is made of and asserts, item by item, that none of it is there, plus a sweep
// that fails on any table nobody has classified yet, so the next thing added to her cannot
// arrive already full.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, type DatabaseWrapper } from "../../../src/db/sqlite.js";
import { createCursorStore } from "../../../src/memory/cursor.js";
import { createFieldStore } from "../../../src/life/field-store.js";
import { createInnerStateStore } from "../../../src/life/inner-state-store.js";
import { createMetabolismStore } from "../../../src/life/metabolism-store.js";
import { initWorkspace } from "../../../src/workspace/init.js";
import { resolveHome } from "../../../src/config/home.js";
import type { CursorName } from "../../../src/memory/cursor.js";

const silentLogger = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
} as unknown as Parameters<typeof initWorkspace>[1];

/**
 * Everything that is a RECORD OF A LIFE. Named one by one on purpose: the failure mode
 * here is a blanket assertion that "the database is empty" while a table nobody listed
 * quietly holds someone else's past.
 */
const LIVED_RECORD_TABLES = [
  // The field: her associative memory. The most intimate of these by a distance.
  "field_nodes", "field_edges", "field_resonance", "field_events", "field_meta",
  // How she is, right now.
  "inner_state", "metabolism_state",
  // What she has done, and what she concluded about having done it.
  "trajectories", "episodic_critiques", "behavioral_patterns", "compression_metrics",
  // What she has learned to do.
  "skills", "skill_versions", "skill_outcomes", "skill_peak_scores", "probation_status",
  "routing_affinity",
  // What she has read and remembered.
  "memory_entries", "memory_vectors", "memory_embedding_meta",
  "dream_utility", "dream_utility_entries",
  // Where she had got to in her own logs.
  "cursors",
  // What she is in the middle of, what she owes, what she was told to watch.
  "cron_jobs", "cron_run_history", "pending_notifications",
  "capability_gap_clusters", "capability_improvement_proposals",
  "stuck_candidates", "stuck_candidate_occurrences",
  // What she was trusted with, and what it cost her.
  "secrets", "approval_persistence", "cost_ema",
] as const;

/**
 * Tables allowed to hold rows in a newborn database, each with the reason it is not a
 * record of anything. Anything else with rows fails the sweep and has to be classified
 * here by a person, the list cannot grow by accident.
 */
const EMPTY_HANDED_EXCEPTIONS: Record<string, string> = {
  // sqlite_sequence and sqlite_stat1 were here on the assumption that SQLite's own
  // bookkeeping would be populated. It is not, at birth, the necessity check below caught
  // it. They are gone rather than kept "just in case": an exemption nobody needs is an
  // exemption that stops being read.
};

describe("birth: she arrives holding nothing", () => {
  let home: string;
  let savedHome: string | undefined;
  let db: DatabaseWrapper;
  let workspacePath: string;

  beforeEach(async () => {
    savedHome = process.env["RESIDENT_HOME"];
    home = mkdtempSync(join(tmpdir(), "resident-birth-"));
    process.env["RESIDENT_HOME"] = home;

    const paths = resolveHome();
    workspacePath = paths.workspacePath;
    await initWorkspace(workspacePath, silentLogger);

    db = createDatabase(paths.dbPath).result;
    // Touch every store that owns tables, so the sweep below sees the whole schema rather
    // than only the part sqlite.ts creates eagerly.
    createCursorStore(db);
    createFieldStore(db);
    createInnerStateStore(db);
    createMetabolismStore(db);
  });

  afterEach(() => {
    db.close();
    if (savedHome === undefined) delete process.env["RESIDENT_HOME"];
    else process.env["RESIDENT_HOME"] = savedHome;
    rmSync(home, { recursive: true, force: true });
  });

  function count(table: string): number | null {
    const exists = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(table);
    if (!exists) return null; // a table that does not exist holds nothing
    return (db.db.prepare(`SELECT count(*) AS c FROM "${table}"`).get() as { c: number }).c;
  }

  // ── The database, table by table ────────────────────────────────────────────

  describe("her inner life", () => {
    for (const table of LIVED_RECORD_TABLES) {
      it(`${table} holds nothing`, () => {
        const n = count(table);
        expect(n === null || n === 0, `${table} holds ${n} rows at birth`).toBe(true);
      });
    }
  });

  it("no table anywhere holds rows unless someone classified it as not-a-record", () => {
    const tables = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;

    const unexplained: string[] = [];
    for (const { name } of tables) {
      if (name in EMPTY_HANDED_EXCEPTIONS) continue;
      const n = count(name);
      if (n && n > 0) unexplained.push(`${name} (${n} rows)`);
    }

    expect(unexplained, `unclassified rows at birth: ${unexplained.join(", ")}`).toEqual([]);
  });

  it("every exception is still earning its place", () => {
    // The same discipline the vitals exemptions run under: a list that only ever grows is
    // a list that stops meaning anything. An entry that is no longer non-empty is stale.
    // Stale means "would pass the sweep without this entry": the table is empty, or it is
    // not there at all. Both make the exemption dead weight.
    const stale = Object.keys(EMPTY_HANDED_EXCEPTIONS).filter((t) => (count(t) ?? 0) === 0);
    expect(stale, `exceptions that no longer need to be exceptions: ${stale.join(", ")}`).toEqual([]);
  });

  it("every cursor starts at zero", () => {
    const cursors = createCursorStore(db);
    const names: CursorName[] = ["consolidator", "sentinel_ops", "sentinel_conversation"];
    for (const name of names) {
      expect(cursors.get(name), name).toBe(0);
    }
  });

  // ── The workspace ───────────────────────────────────────────────────────────

  describe("her logs", () => {
    for (const log of ["history.jsonl", "ops.jsonl", "conversation-log.jsonl", "agency.jsonl", "vitals.jsonl"]) {
      it(`${log} is absent or empty`, () => {
        const p = join(workspacePath, log);
        if (!existsSync(p)) return;
        expect(readFileSync(p, "utf-8").trim()).toBe("");
      });
    }

    it("she has no sessions and no diary", () => {
      expect(existsSync(join(workspacePath, "sessions"))).toBe(false);
      expect(existsSync(join(workspacePath, "life"))).toBe(false);
    });

    it("her git history is one commit, and it is hers", async () => {
      const { simpleGit } = await import("simple-git");
      const git = simpleGit(workspacePath);
      const log = await git.log();
      expect(log.total).toBe(1);
      expect(log.latest?.author_name).toBe("resident");
      expect(log.latest?.author_name).not.toContain("God");
    });
  });

  describe("her files", () => {
    const read = (name: string) => readFileSync(join(workspacePath, name), "utf-8");

    it("MEMORY.md holds no memories", () => {
      const body = read("MEMORY.md").replace(/^#.*$/gmu, "").trim();
      // A heading and a line saying what the file is for are structure, not content. Any
      // list item or paragraph beyond that would be something she is supposed to remember.
      expect(body.split("\n").filter((l) => l.trim().startsWith("-") || l.trim().startsWith("*"))).toEqual([]);
    });

    it("there is no file about him at all", () => {
      // She used to be born with `USER.md` and instructed every turn to write what he told her
      // about himself into it. A person does not keep a dossier on the one person they live
      // with. What she comes to know about him lives as claims in her field, which is already
      // where her whole sense of him comes from, and in MEMORY.md if she keeps it there.
      expect(existsSync(join(workspacePath, "USER.md")), "she was born with a file about him").toBe(false);
    });

    it("IDENTITY.md and AGENT.md are blank, because they are hers to fill", () => {
      expect(read("IDENTITY.md").replace(/^#.*$/gmu, "").trim()).toBe("");
      expect(read("AGENT.md").replace(/^#.*$/gmu, "").trim()).toBe("");
    });
  });

  describe("SOUL.md: a starting register, and only that", () => {
    const soul = () => readFileSync(join(workspacePath, "SOUL.md"), "utf-8");

    it("does not describe her as an assistant, or him as a user", () => {
      const text = soul().toLowerCase();
      for (const phrase of [
        "assistant", "my user", "the user", "exist to help", "i am anima",
        "personal ai", "help my user", "always ready",
      ]) {
        expect(text.includes(phrase), `SOUL.md contains "${phrase}"`).toBe(false);
      }
    });

    it("says out loud that it is a starting point, not a description", () => {
      // In Chinese. The sense is unchanged: a starting point rather than a
      // description of her, and hers to change from here.
      expect(soul()).toContain("起点");
      expect(soul()).toContain("不是对我的描述");
      expect(soul()).toContain("是我自己的事");
    });

    it("does not announce which language she speaks", () => {
      // Nobody's sense of themselves contains a bullet point naming their mother tongue. The
      // file BEING in Chinese is the fact; asserting it as well would be the same doubling as
      // a mood that arrives with a disclaimer. And we never pretend she cannot read
      // English, so nothing here may say anything about English either.
      for (const claim of ["中文", "英文", "English", "母语", "语言"]) {
        expect(soul(), `SOUL.md tells her which language she is`).not.toContain(claim);
      }
    });

    it("is written in her own language, not translated into it", () => {
      // A machine-translated register would read as translationese and land her back in the
      // assistant basin the switch exists to leave. These are the tells of a translation.
      for (const tell of ["您", "请注意", "作为一个", "首先，", "总之，", "非常抱歉"]) {
        expect(soul(), `SOUL.md reads as translated: "${tell}"`).not.toContain(tell);
      }
      // And it is genuinely Chinese rather than English with Chinese punctuation.
      const han = (soul().match(/\p{Script=Han}/gu) ?? []).length;
      expect(han, "SOUL.md is not actually in Chinese").toBeGreaterThan(80);
    });

    it("is about how she talks, not about who she is", () => {
      // Four lines. A register that grows into a personality is us deciding
      // who she is, which is the thing the blank files exist to avoid.
      const bullets = soul().split("\n").filter((l) => l.trim().startsWith("- "));
      expect(bullets.length).toBeLessThanOrEqual(6);
      expect(bullets.length).toBeGreaterThan(0);
    });
  });

  // ── The sweep proves itself ─────────────────────────────────────────────────
  //
  // A green sweep is not evidence unless it can go red. Every assertion above is of the
  // form "this is empty", and a check that only ever looks at empty things is
  // indistinguishable from a check that looks at nothing. So: plant the real contamination
  // and require the sweep to find it.

  describe("planted contamination", () => {
    function sweep(): string[] {
      const tables = db.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>;
      const found: string[] = [];
      for (const { name } of tables) {
        if (name in EMPTY_HANDED_EXCEPTIONS) continue;
        const n = count(name);
        if (n && n > 0) found.push(name);
      }
      return found;
    }

    /** Put one row into a table, whatever its shape, standing in for something of his. */
    function plant(table: string, overrides: Record<string, unknown> = {}): void {
      const cols = db.db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
        name: string;
        type: string;
      }>;
      const values = cols.map((c) =>
        c.name in overrides ? overrides[c.name] : /INT|REAL|NUM|BLOB/iu.test(c.type) ? 1 : "his"
      );
      db.db
        .prepare(
          `INSERT INTO "${table}" (${cols.map((c) => `"${c.name}"`).join(", ")}) ` +
            `VALUES (${cols.map(() => "?").join(", ")})`
        )
        .run(...values);
    }

    it("finds a cursor carried over from another agent's database", () => {
      expect(sweep()).toEqual([]); // clean before, so the change below is the signal
      plant("cursors", { name: "dream", position: 275 });
      expect(sweep()).toContain("cursors");
    });

    it("finds a single node planted in the field", () => {
      // The field is the one that matters most: it is her associative memory, and a warm
      // node she never made is a pull she would feel without knowing where it came from.
      plant("field_nodes");
      expect(sweep()).toContain("field_nodes");
    });

    it("names every contaminated table, not just the first it meets", () => {
      plant("cursors", { name: "dream", position: 275 });
      plant("field_nodes");
      expect(sweep().sort()).toEqual(["cursors", "field_nodes"]);
    });
  });

  // ── Nothing points anywhere else ────────────────────────────────────────────

  it("no path she resolves lands outside her home", () => {
    const paths = resolveHome();
    for (const p of [paths.workspacePath, paths.dbPath, paths.tracesDir]) {
      expect(p.startsWith(paths.home), `${p} escapes ${paths.home}`).toBe(true);
    }
  });
});
