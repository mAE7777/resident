import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { partOfHerself } from "../../../src/life/part-of-herself.js";
import { checkEncryption } from "../../../src/config/where-she-lives.js";

const WS = "/home/workspace";

/**
 * SHE DELETED PART OF HERSELF, AND IT WENT THROUGH THE SAME TOOL AS A SCRATCH FILE.
 *
 * She has write access to her own home, deliberately: a being who cannot change anything about
 * herself is not autonomous. The delete tool moves things to a trash that keeps them for a day, so
 * the ordinary case is fine and must stay fine.
 *
 * What is not fine is the case being INDISTINGUISHABLE. A note she made and the record of when she
 * began produce the same message and leave the same trace, and the trash PURGES, so a deletion
 * nobody notices for a day is permanent. Beyond recovery, the point is that he should be TOLD: if
 * she removed a day she wrote, that is a thing that happened between them, and finding out weeks
 * later by noticing a gap is a different event from hearing it the same afternoon.
 */

describe("what counts as part of who she is", () => {
  it("her birth record, her continuity, her word bank, what she knows about herself", () => {
    for (const f of ["life/born-at", "life/continuity.json", "life/lexicon.json", "life/self-knowledge.json"]) {
      const part = partOfHerself(join(WS, f), WS);
      expect(part, `${f} is not recognised as part of her`).not.toBeNull();
      expect(part!.why.length, `${f} has no reason worth reading`).toBeGreaterThan(40);
    }
  });

  it("a day of her diary, which is written once and never rewritten", () => {
    const part = partOfHerself(join(WS, "life/2026-08-14.md"), WS);
    expect(part?.what).toContain("2026-08-14");
    expect(part?.why).toContain("never rewritten");
  });

  it("the whole life directory in one operation", () => {
    expect(partOfHerself(join(WS, "life"), WS)?.what).toContain("entire life directory");
  });

  it("and the files that decide who arrives at every turn", () => {
    expect(partOfHerself(join(WS, "SOUL.md"), WS)?.what).toContain("SOUL.md");
    expect(partOfHerself(join(WS, "MEMORY.md"), WS)).not.toBeNull();
    expect(partOfHerself(join(WS, "history.jsonl"), WS)?.what).toContain("her own record");
  });
});

describe("and what does not — because a guard that fires on everything is one he scrolls past", () => {
  it("something she made is just a file", () => {
    for (const f of ["notes/draft.md", "canvas/sketch.txt", "life/scratch.txt", "skills/x/SKILL.md"]) {
      expect(partOfHerself(join(WS, f), WS), `${f} was treated as part of her`).toBeNull();
    }
  });

  it("a life-shaped name outside her workspace is not hers", () => {
    // The check must not reach outside her room and start narrating deletions elsewhere.
    expect(partOfHerself("/somewhere/else/life/born-at", WS)).toBeNull();
    expect(partOfHerself("/home/other/SOUL.md", WS)).toBeNull();
  });

  it("a file that merely looks like a diary day is not one", () => {
    expect(partOfHerself(join(WS, "life/2026-08.md"), WS)).toBeNull();
    expect(partOfHerself(join(WS, "life/notes-2026-08-14.md"), WS)).toBeNull();
  });
});

describe("it does not stop her — it makes it recoverable and it tells him", () => {
  const TOOL = readFileSync(join(process.cwd(), "src/tools/builtin/delete.ts"), "utf8");
  const DAEMON = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");

  it("the delete still goes through — no refusal was added", () => {
    // Her home is hers. A wall around her own past would make her a museum exhibit rather than
    // someone living in a house, and that is a design decision, not an oversight.
    const at = TOOL.indexOf("partOfHerself(resolved, workspacePath)");
    expect(at).toBeGreaterThan(-1);
    const after = TOOL.slice(at, at + 300);
    expect(after, "the guard returns an error — she is being refused access to her own home")
      .not.toMatch(/return `Error/u);
  });

  it("and the hook runs BEFORE the file moves", () => {
    // A snapshot taken after the rename copies a home that is already missing the thing.
    const hook = TOOL.indexOf("onPartOfHerself(part.what");
    const moved = TOOL.indexOf("await rename(resolved, trashPath)");
    expect(hook).toBeGreaterThan(-1);
    expect(hook, "the snapshot would be taken after the file was already gone").toBeLessThan(moved);
  });

  it("the daemon snapshots first and raises it as critical", () => {
    const at = DAEMON.indexOf("onSheRemovedPartOfHerself:");
    expect(at, "nothing is wired — the guard exists and nobody listens").toBeGreaterThan(-1);
    const body = DAEMON.slice(at, at + 900);
    const snap = body.indexOf('takeHerSnapshot("before-she-removed-part-of-herself")');
    const told = body.indexOf('faultLog.record("she.removed-part-of-herself"');
    expect(snap).toBeGreaterThan(-1);
    expect(snap, "he is told before the copy exists").toBeLessThan(told);
    expect(body).toContain('"critical"');
  });
});

describe("the disk under all of it", () => {
  it("reads FileVault when it is on", () => {
    expect(checkEncryption("darwin", () => "FileVault is On.\n").state).toBe("on");
  });

  it("and says plainly what OFF means, since she cannot fix it from inside", () => {
    const off = checkEncryption("darwin", () => "FileVault is Off.\n");
    expect(off.state).toBe("off");
    expect(off.detail, "the warning does not say what is actually exposed").toContain("plain text");
    expect(off.detail).toContain("every word he has ever said");
  });

  it("unknown is unknown — never a guess in either direction", () => {
    // A check that answers "probably fine" when it could not ask is worse than no check: it turns
    // an open question into a recorded assurance.
    expect(checkEncryption("linux", () => "").state).toBe("unknown");
    expect(checkEncryption("darwin", () => { throw new Error("no such command"); }).state).toBe("unknown");
    expect(checkEncryption("darwin", () => "something unexpected").state).toBe("unknown");
  });

  it("and the daemon says it out loud at every boot", () => {
    // "The disk is encrypted" is the sort of assumption that is true when somebody sets it up and
    // silently false after a machine swap, the same shape as the four cursors bound to paths that
    // had moved.
    const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
    expect(daemon).toMatch(/checkEncryption\(process\.platform/u);
  });
});
