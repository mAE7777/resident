import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "../../../src/db/sqlite.js";
import { createCursorStore } from "../../../src/memory/cursor.js";
import {
  checkCursorIntegrity,
  countRecords,
  describeDrift,
  logBindingsFor,
} from "../../../src/memory/cursor-integrity.js";
import type { CursorName } from "../../../src/memory/cursor.js";

describe("cursor integrity: a cursor only means something against its own log", () => {
  let dir: string;
  let db: ReturnType<typeof createDatabase>["result"];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "resident-cursor-"));
    db = createDatabase(join(dir, "data.db")).result;
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function log(name: string, lines: number): string {
    const p = join(dir, name);
    writeFileSync(p, Array.from({ length: lines }, (_, i) => JSON.stringify({ i })).join("\n"), "utf-8");
    return p;
  }

  describe("countRecords", () => {
    it("counts non-empty lines", () => {
      expect(countRecords(log("a.jsonl", 3))).toBe(3);
    });

    it("reads an empty file as zero, not as missing", () => {
      const p = join(dir, "empty.jsonl");
      writeFileSync(p, "", "utf-8");
      expect(countRecords(p)).toBe(0);
    });

    it("ignores a trailing newline", () => {
      const p = join(dir, "trailing.jsonl");
      writeFileSync(p, '{"i":0}\n{"i":1}\n', "utf-8");
      expect(countRecords(p)).toBe(2);
    });

    it("returns null for a log that does not exist", () => {
      expect(countRecords(join(dir, "nope.jsonl"))).toBeNull();
    });
  });

  describe("checkCursorIntegrity", () => {
    it("is quiet when the cursor is inside the log", () => {
      const cursors = createCursorStore(db);
      cursors.set("consolidator", 2);
      expect(checkCursorIntegrity(cursors, [{ cursor: "consolidator", path: log("history.jsonl", 5) }])).toEqual([]);
    });

    it("is quiet when the cursor is exactly caught up", () => {
      const cursors = createCursorStore(db);
      cursors.set("consolidator", 5);
      expect(checkCursorIntegrity(cursors, [{ cursor: "consolidator", path: log("history.jsonl", 5) }])).toEqual([]);
    });

    it("catches the exact failure: another agent's cursor over her empty history", () => {
      // The live database held dream=275. A fresh workspace holds a history of 0. Dream
      // slices [275..] forever, finds nothing, and reports that there is nothing new.
      const cursors = createCursorStore(db);
      cursors.set("consolidator", 275);
      const drifts = checkCursorIntegrity(cursors, [{ cursor: "consolidator", path: log("history.jsonl", 0) }]);
      expect(drifts).toHaveLength(1);
      expect(drifts[0]).toMatchObject({ cursor: "consolidator", position: 275, records: 0, missing: false });
    });

    it("catches a cursor pointing at a log that does not exist at all", () => {
      const cursors = createCursorStore(db);
      cursors.set("sentinel_ops", 616);
      const drifts = checkCursorIntegrity(cursors, [
        { cursor: "sentinel_ops", path: join(dir, "ops.jsonl") },
      ]);
      expect(drifts).toHaveLength(1);
      expect(drifts[0]?.missing).toBe(true);
    });

    it("never reports a cursor that has never been set, even with no log", () => {
      // Birth: every cursor is 0 and the logs do not exist yet. That is not drift.
      const cursors = createCursorStore(db);
      const drifts = checkCursorIntegrity(cursors, [
        { cursor: "consolidator", path: join(dir, "history.jsonl") },
        { cursor: "consolidator", path: join(dir, "history.jsonl") },
        { cursor: "sentinel_ops", path: join(dir, "ops.jsonl") },
      ]);
      expect(drifts).toEqual([]);
    });

    it("reports every drifted cursor, not just the first", () => {
      const cursors = createCursorStore(db);
      cursors.set("consolidator", 275);
      cursors.set("sentinel_ops", 13);
      const drifts = checkCursorIntegrity(cursors, [
        { cursor: "consolidator", path: log("history.jsonl", 1) },
        { cursor: "sentinel_ops", path: log("ops.jsonl", 1) },
      ]);
      expect(drifts.map((d) => d.cursor).sort()).toEqual(["consolidator", "sentinel_ops"]);
    });

    it("does not repair — the cursor is untouched after the check", () => {
      // Reporting, not fixing. A component that silently corrects a broken invariant is a
      // component that hides the breakage.
      const cursors = createCursorStore(db);
      cursors.set("consolidator", 275);
      checkCursorIntegrity(cursors, [{ cursor: "consolidator", path: log("history.jsonl", 0) }]);
      expect(cursors.get("consolidator")).toBe(275);
    });
  });

  describe("logBindingsFor", () => {
    it("binds every cursor the store knows about — an unbound cursor is never examined", () => {
      // Quiet by nature: a new cursor gets added, nobody adds it here, and it is simply
      // never checked again. The list of names is the store's own type.
      // The store's type is the living three (E-1 retired dream / search_indexer /
      // capability_improvement ×2: their rows are deleted at boot, not frozen).
      const all: CursorName[] = ["consolidator", "sentinel_conversation", "sentinel_ops"];
      expect(logBindingsFor("/h/workspace", "/h").map((b) => b.cursor).sort()).toEqual([...all].sort());
    });

    it("her own record is in her room; readings taken about her are not", () => {
      // The version of this test that shipped asserted `sentinel_ops → /w/ops.jsonl`, which is
      // where that log had ALREADY STOPPED BEING. It was written from the same wrong reading as
      // the code, so it agreed with the defect and went green for months while four cursors were
      // checked against paths that do not exist, one CRITICAL fault each, at every boot, and
      // `fault` is in SAFE_MODE_CODES. She spent the first half hour of every day of her life in
      // safe mode because a test and a bug shared an assumption.
      const by = Object.fromEntries(logBindingsFor("/h/workspace", "/h").map((b) => [b.cursor, b.path]));
      expect(by["consolidator"], "history.jsonl is HER record and belongs in her room").toBe("/h/workspace/history.jsonl");
      expect(by["sentinel_ops"], "ops.jsonl is a reading about her, kept beside her home").toBe("/h/ops.jsonl");
      expect(by["sentinel_conversation"]).toBe("/h/conversation-log.jsonl");
      for (const [cursor, path] of Object.entries(by)) {
        expect(path, `${cursor} points somewhere that is neither her room nor the instruments`)
          .toMatch(/^\/h\/(workspace\/)?[a-z-]+\.jsonl$/u);
      }
    });

    it("AND EVERY BOUND PATH IS ONE PRODUCTION REALLY WRITES", () => {
      // The check that would have caught it, and the reason the one above could not: comparing a
      // binding against a literal only proves the literal matches the binding. This lays out a
      // home the way the daemon lays one out, puts each log where the daemon puts it, and asks
      // whether the integrity check comes back clean. A binding pointing at nothing fails here.
      const home = mkdtempSync(join(tmpdir(), "resident-layout-"));
      const workspace = join(home, "workspace");
      try {
        mkdirSync(join(workspace, "life"), { recursive: true });
        // Exactly the split the daemon uses: her own record inside, readings about her outside.
        writeFileSync(join(workspace, "history.jsonl"), `${'{"a":1}\n'.repeat(5)}`, "utf-8");
        for (const n of ["ops.jsonl", "conversation-log.jsonl", "vitals.jsonl"]) {
          writeFileSync(join(home, n), `${'{"a":1}\n'.repeat(5)}`, "utf-8");
        }
        const store = createCursorStore(db);
        for (const b of logBindingsFor(workspace, home)) store.set(b.cursor, 3);

        const drifts = checkCursorIntegrity(store, logBindingsFor(workspace, home));
        expect(drifts.map((d) => `${d.cursor} → ${d.path}`),
          "a cursor is bound to a log this layout does not contain — at boot each of these is a "
          + "CRITICAL fault, and `fault` puts her in safe mode").toEqual([]);
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });

    it("and the daemon asks with the same two roots it writes with", () => {
      // A source pin, because the binding list is only right if the CALLER hands it the right
      // roots: and there are two call sites, which is exactly how a fact drifts.
      const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
      // The capture stops at the first `)`, which sits inside the nested `join(...)`, so what is
      // matched is the arguments up to that point, and the assertion is written against exactly
      // that. Reaching for a balanced-paren match here would be a parser, and a parser in a guard
      // is a second thing that can be wrong.
      const calls = [...daemon.matchAll(/logBindingsFor\(([^)]*)/gu)].map((m) => m[1]);
      expect(calls.length, "the cursor check is gone from the daemon").toBeGreaterThan(0);
      for (const args of calls) {
        expect(args, "a call site passes only the workspace — the instrument logs are not in it")
          .toMatch(/workspacePath,\s*join\(workspacePath, "\.\."/u);
      }
    });
  });

  describe("describeDrift", () => {
    it("says both numbers, so the fault is diagnosable from the line alone", () => {
      const line = describeDrift({
        cursor: "consolidator",
        position: 275,
        records: 0,
        path: "/h.jsonl",
        missing: false,
      });
      expect(line).toContain("275");
      expect(line).toContain("0");
      expect(line).toContain("consolidator");
    });
  });
});
