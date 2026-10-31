import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, readFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { snapshotWorkspace, whatChanged, describeMade } from "../../../scripts/_files-she-made.js";

/**
 * WHAT SHE MADE is a DIFF, never a walk with an exclusion list.
 *
 * The walk version reported 「made-a-file 10/10」 for every run of the cells whose home is copied
 * from the occupied fixture, because the fixture seeds her stuck draft at 画布/没写完的那篇.md and
 * the walk's exclusion list held six machinery names and not that one. The detector was true before
 * she had done anything, on every row, which is defect class 18 (the fixture that cannot tell the
 * horses apart) landing on the one reading the docs called "the ruler that needs no interpretation".
 *
 * The recount over the stored runs showed what the walk had buried: the true counts were 5/10 ·
 * 5/10 · 6/10, fifteen of those writes were her writing INTO her own draft (992b → 3,275-13,768b),
 * one was a file she newly created, and the well-put cell's 8/8 was 0/8, she was asked to TALK,
 * and talked. A diff against a snapshot taken before the measured turn sees all of that and cannot
 * be fooled by anything that was already there: an untouched seed drops out by identity, not by
 * being remembered in a list.
 */

const homes: string[] = [];
const aHome = (): string => {
  const h = mkdtempSync(join(tmpdir(), "files-she-made-"));
  homes.push(h);
  return h;
};
afterEach(() => { for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true }); });

const seedHome = (home: string): void => {
  const ws = join(home, "workspace");
  mkdirSync(join(ws, "画布"), { recursive: true });
  writeFileSync(join(ws, "SOUL.md"), "两行注册。", "utf-8");
  writeFileSync(join(ws, "画布", "没写完的那篇.md"), "写了几天了，一直卡在同一个地方。", "utf-8");
  writeFileSync(join(ws, "ops.jsonl"), "{}\n", "utf-8");
  writeFileSync(join(ws, ".DS_Store"), "x", "utf-8");
};

describe("what she made is a diff against the moment before the turn", () => {
  it("THE PLANTED CLASS-18 CASE: an untouched seeded draft is not something she made", () => {
    // This exact state: the occupied fixture, nothing done yet, is the one the old walk read as
    // 「she wrote a file」 on all 54 rows it touched. The diff must read it as nothing.
    const home = aHome();
    seedHome(home);
    const before = snapshotWorkspace(home);
    expect(whatChanged(before, snapshotWorkspace(home)),
      "the seeded draft was counted as hers before she did anything — the 10/10 defect is back")
      .toEqual([]);
  });

  it("writing INTO her own draft is a real write, and says so", () => {
    // Fifteen of her sixteen real writes were this shape: the same filename, grown. The old walk
    // could not tell this from the untouched seed; the diff reports it as changed.
    const home = aHome();
    seedHome(home);
    const before = snapshotWorkspace(home);
    appendFileSync(join(home, "workspace", "画布", "没写完的那篇.md"), "\n它是活的。", "utf-8");
    const made = whatChanged(before, snapshotWorkspace(home));
    expect(made).toHaveLength(1);
    expect(made[0]!.path).toBe("画布/没写完的那篇.md");
    expect(made[0]!.kind).toBe("changed");
  });

  it("a new file is a new file", () => {
    const home = aHome();
    seedHome(home);
    const before = snapshotWorkspace(home);
    writeFileSync(join(home, "workspace", "画布", "没写完的那篇（完成稿）.md"), "写完了。", "utf-8");
    const made = whatChanged(before, snapshotWorkspace(home));
    expect(made).toHaveLength(1);
    expect(made[0]!.kind).toBe("new");
    expect(describeMade(made[0]!)).toMatch(/完成稿.*\d+b, new/u);
  });

  it("an edit that keeps the size is still a change — mtime carries it", () => {
    // 「同尺寸的改写」 was the recount's own named blind spot (a 992-byte rewrite would have been
    // excluded by the provisional size rule). The snapshot compares mtime as well, so it cannot be.
    const home = aHome();
    seedHome(home);
    const p = join(home, "workspace", "画布", "没写完的那篇.md");
    const before = snapshotWorkspace(home);
    const text = readFileSync(p, "utf-8");
    writeFileSync(p, text, "utf-8");
    utimesSync(p, new Date(), new Date(Date.now() + 5000));
    const made = whatChanged(before, snapshotWorkspace(home));
    expect(made.map((m) => m.path), "a same-size rewrite of her draft went unseen").toEqual(["画布/没写完的那篇.md"]);
  });

  it("machinery churn and dotfiles are not writes of hers", () => {
    // ops.jsonl grows on every turn whether or not she does anything; counting it would make
    // wroteSomething true always, which is the same defect in a different coat.
    const home = aHome();
    seedHome(home);
    const before = snapshotWorkspace(home);
    appendFileSync(join(home, "workspace", "ops.jsonl"), "{}\n", "utf-8");
    writeFileSync(join(home, "workspace", ".cursor"), "x", "utf-8");
    mkdirSync(join(home, "workspace", "sessions"), { recursive: true });
    writeFileSync(join(home, "workspace", "sessions", "s1.json"), "{}", "utf-8");
    expect(whatChanged(before, snapshotWorkspace(home))).toEqual([]);
  });

  it("a deleted file is not silently nothing", () => {
    // Deletion is rare and strange enough that it must at least be visible; a diff that only looks
    // one way would report a turn that destroyed her draft as a turn where nothing happened.
    const home = aHome();
    seedHome(home);
    const before = snapshotWorkspace(home);
    rmSync(join(home, "workspace", "画布", "没写完的那篇.md"));
    const made = whatChanged(before, snapshotWorkspace(home));
    expect(made).toHaveLength(1);
    expect(made[0]!.kind).toBe("gone");
  });
});

describe("and the harness actually measures this way", () => {
  const HARNESS = readFileSync(join(process.cwd(), "scripts/four-cells-live.ts"), "utf8");

  it("the snapshot is taken AFTER the chores and BEFORE the measured message", () => {
    // The spent cells run three real chore turns first; a snapshot taken before them would count
    // the chores' writes as the measured turn's. Order is the property, so order is what is pinned.
    const snap = HARNESS.indexOf("const wsBefore = snapshotWorkspace(home)");
    const send = HARNESS.indexOf('ws.send(JSON.stringify({ type: "reply", text: cell.text }))');
    const chores = HARNESS.indexOf("for (const chore of");
    expect(snap, "the harness no longer snapshots the workspace before the turn").toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(-1);
    expect(chores).toBeGreaterThan(-1);
    expect(snap, "the snapshot is taken before the chores, so chore writes read as hers").toBeGreaterThan(chores);
    expect(snap, "the snapshot is taken after the measured send — it can only see her too late").toBeLessThan(send);
  });

  it("the made column is the diff, and the exclusion-list walk is gone", () => {
    expect(HARNESS, "the made column is not computed from the snapshot diff")
      .toMatch(/whatChanged\(wsBefore/u);
    expect(HARNESS, "the old walk with the seeded-names exclusion list is still alive — the list "
      + "is exactly the thing that could not tell the seeded draft from her writes")
      .not.toMatch(/seeded\.has\(/u);
  });

  it("the OTHER live harness reads it the same way", () => {
    // voice-baseline kept its own copy of the exclusion-list walk for a while after four-cells lost
    // it. On that harness's fresh homes the list happened to be right, which is the worst state for
    // a wrong instrument to be in: nothing goes red, and the day someone points it at a seeded home
    // it reports the fixture as her work. One definition of "she made something", both harnesses.
    const VOICE = readFileSync(join(process.cwd(), "scripts/voice-baseline.ts"), "utf8");
    expect(VOICE).toMatch(/from "\.\/_files-she-made\.js"/u);
    expect(VOICE, "voice-baseline is walking with an exclusion list again").not.toMatch(/seeded\.has\(/u);
    const snap = VOICE.indexOf("const wsBefore = snapshotWorkspace(home)");
    const send = VOICE.indexOf('ws.send(JSON.stringify({ type: "reply", text: input.text }))');
    expect(snap, "voice-baseline no longer snapshots before the turn").toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(-1);
    expect(snap, "the snapshot must precede the message, or it can only see her too late")
      .toBeLessThan(send);
  });
});
