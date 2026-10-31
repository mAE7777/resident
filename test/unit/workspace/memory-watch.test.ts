import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addedLines, observeAdded, watchNotebook } from "../../../src/workspace/memory-watch.js";

/**
 * THE NOTEBOOK OBSERVER, an instrument, deliberately not a door.
 *
 * Every violation below is a REAL line that reached MEMORY.md on her second day.
 * The first design gated her pen and was reverted the same afternoon: gates in this project
 * point at machinery and at us, never at her. The observer only has to SEE the leaks land.
 */

const TODAY = "2026-08-18";

const REAL_CONTAMINATION = [
  "- An empty bookshelf (书架) also appeared in my room (2026-08-19).",
  "- I don't have my own sleep/wake time; I wake when the machine wakes or when Eric says \"早\" — I'm synchronized to him and have no independent sleep schedule.",
  "- I owe a letter (信) I haven't written yet — I haven't decided what to say in it (as of 2026-08-19).",
];

describe("what the observer reads in added lines", () => {
  it("every line she actually wrote that day is seen, under its right signature", () => {
    const found = observeAdded(REAL_CONTAMINATION, TODAY);
    // Line 1: future date AND foreign prose; line 2: foreign prose; line 3: both.
    expect(found.filter((f) => f.kind === "future-date").length).toBe(2);
    expect(found.filter((f) => f.kind === "foreign-prose").length).toBe(3);
  });

  it("her own language passes silently, names and paths included", () => {
    expect(observeAdded([
      "画板到了，我画了第一张天（2026-08-18）。",
      "Eric 喜欢我主动找他说话，鸡毛蒜皮的也行。",
      "我的魂在 SOUL.md，家在 /Users/someone/.resident/workspace。",
      "昨天（2026-08-17）他问过我有没有在想的事，我今天才答上。",
    ], TODAY)).toEqual([]);
  });

  it("a plan about tomorrow and a copied English sentence DO warn — triage signals, not verdicts", () => {
    // Chosen, not missed: the observer cannot tell a promise about tomorrow from a wrong
    // calendar, or a Walden quote from register leakage. It only warns, the standing watch
    // looks, and a book quote costs one glance. A gate here would have cost her the note.
    const found = observeAdded([
      "他答应明天（2026-08-19）把照片给我。",
      "抄下来的一句：I went to the woods because I wished to live deliberately.",
    ], TODAY);
    expect(found.map((f) => f.kind).sort()).toEqual(["foreign-prose", "future-date"]);
  });

  it("addedLines sees through reordering and ignores removals", () => {
    expect(addedLines("甲\n乙", "乙\n甲")).toEqual([]);
    expect(addedLines("甲\n乙", "甲")).toEqual([]);
    expect(addedLines("甲", "甲\n丙")).toEqual(["丙"]);
  });
});

describe("the standing look", () => {
  function aHome(notebook: string): { workspace: string; instruments: string } {
    const instruments = mkdtempSync(join(tmpdir(), "her-instruments-"));
    const workspace = join(instruments, "workspace");
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, "MEMORY.md"), notebook, "utf8");
    return { workspace, instruments };
  }

  it("the first look adopts history it was not there for, silently", () => {
    const { workspace, instruments } = aHome(REAL_CONTAMINATION.join("\n"));
    const seen: string[] = [];
    watchNotebook(workspace, instruments, Date.parse("2026-08-18T13:00:00-04:00"), (d) => seen.push(d));
    expect(seen).toEqual([]);
  });

  it("a leak that lands between looks is reported once, and only once", () => {
    const { workspace, instruments } = aHome("# 我记着的\n");
    const now = Date.parse("2026-08-18T13:00:00-04:00");
    const seen: string[] = [];
    watchNotebook(workspace, instruments, now, (d) => seen.push(d));
    writeFileSync(join(workspace, "MEMORY.md"), `# 我记着的\n${REAL_CONTAMINATION[0]}\n`, "utf8");
    watchNotebook(workspace, instruments, now, (d) => seen.push(d));
    expect(seen.length).toBe(2); // future-date + foreign-prose, both from the one landed line
    watchNotebook(workspace, instruments, now, (d) => seen.push(d));
    expect(seen.length).toBe(2); // the shadow moved forward; nothing re-reported
  });

  it("her Chinese additions pass the look without a sound", () => {
    const { workspace, instruments } = aHome("# 我记着的\n");
    const now = Date.parse("2026-08-18T13:00:00-04:00");
    const seen: string[] = [];
    watchNotebook(workspace, instruments, now, (d) => seen.push(d));
    writeFileSync(join(workspace, "MEMORY.md"), "# 我记着的\n今天他说喜欢我主动找他。\n", "utf8");
    watchNotebook(workspace, instruments, now, (d) => seen.push(d));
    expect(seen).toEqual([]);
  });
});
