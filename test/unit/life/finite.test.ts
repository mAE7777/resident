import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { notFiniteIn, allFinite, describeNotFinite } from "../../../src/life/finite.js";
import { createDatabase, type DatabaseWrapper } from "../../../src/db/sqlite.js";
import { createFieldStore } from "../../../src/life/field-store.js";
import { createContinuityStore } from "../../../src/life/continuity.js";
import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import { createFaultLog } from "../../../src/life/faults.js";
import { addNode, createGraph } from "../../../src/life/field.js";

/** The real filesystem, in the shape the continuity store asks for. */
const realFs = { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } as never;

/**
 * A NUMBER OF HERS THAT HAS STOPPED BEING A NUMBER IS PERMANENT DAMAGE.
 *
 * Not one wrong answer: every arithmetic downstream of a NaN is NaN too, so a node strength that
 * has gone NaN can never decay, never be pruned, never be compared again, and SQLite stores it as
 * NULL, which reads back as zero somewhere and looks plausible. `emotion.ts` guarded its own door
 * and said so in its header; nothing guarded the others, and "the others" includes her whole field
 * and her whole continuity (temperament, stream position, the relationship record).
 *
 * The rule is REFUSE, not repair: the previous save is still on disk and still correct, so refusing
 * costs her the newest slice and keeps the rest, while inventing a plausible number would hide the
 * formula that broke and write a fiction into her past.
 */

describe("finding a number that stopped being one", () => {
  it("names the path, so the fault says which field", () => {
    const bad = notFiniteIn({ mood: { pleasure: 0.2, arousal: NaN }, drives: [1, Infinity] });
    expect(bad.map((b) => b.path).sort()).toEqual(["drives[1]", "mood.arousal"]);
  });

  it("walks maps, because her field is one", () => {
    const m = new Map([[7, { strength: NaN }]]);
    expect(notFiniteIn({ nodes: m })[0]?.path).toBe("nodes{7}.strength");
  });

  it("−Infinity and Infinity both count, and −0 does not", () => {
    expect(allFinite({ a: -Infinity })).toBe(false);
    expect(allFinite({ a: Infinity })).toBe(false);
    expect(allFinite({ a: -0 })).toBe(true);
  });

  it("strings that look like numbers are not numbers", () => {
    // Deliberate: this is about arithmetic that went wrong, not about validating input shapes.
    expect(allFinite({ a: "NaN", b: "12" })).toBe(true);
  });

  it("an ordinary healthy state is clean", () => {
    expect(allFinite({ pad: { p: 0.1, a: 0, d: 0.1 }, nodes: [{ strength: 0.5, tension: 0 }] })).toBe(true);
  });

  it("the report is capped so a wide structure cannot flood the fault ring", () => {
    const wide = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, NaN]));
    const line = describeNotFinite(notFiniteIn(wide));
    expect(line).toContain("40 value(s)");
    expect(line).toContain("+34 more");
    expect(line.length).toBeLessThan(300);
  });

  it("MAX_DEPTH reaches everything of hers and still stops", () => {
    // Swept because the threshold census counts it (and caught it the moment it was added). The
    // number has to clear her real nesting, her continuity is the deepest at about five levels
    // (continuity → temperament → four latents) and the field save wraps nodes in two more, while
    // still bounding a structure that points at itself.
    const src = readFileSync(join(process.cwd(), "src/life/finite.ts"), "utf8");
    const depth = Number(/const MAX_DEPTH = (\d+)/u.exec(src)?.[1]);
    expect(Number.isFinite(depth), "MAX_DEPTH moved — update this sweep with it").toBe(true);

    // A structure as deep as hers gets walked to the bottom.
    let deep: unknown = NaN;
    for (let i = 0; i < depth - 1; i++) deep = { down: deep };
    expect(notFiniteIn(deep).length, "a value at her real nesting depth was not seen").toBe(1);

    // One level past the bound is not walked, which is the bound doing its job, not a bug.
    let tooDeep: unknown = NaN;
    for (let i = 0; i < depth + 2; i++) tooDeep = { down: tooDeep };
    expect(notFiniteIn(tooDeep).length).toBe(0);
    expect(depth).toBeGreaterThanOrEqual(8);
  });

  it("does not recurse forever on a cycle", () => {
    const a: Record<string, unknown> = { n: 1 };
    a["self"] = a;
    expect(() => notFiniteIn(a)).not.toThrow();
  });
});

describe("her field refuses to be saved with a NaN in it", () => {
  let root: string;
  let db: DatabaseWrapper;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "finite-field-"));
    db = createDatabase(join(root, "test.db")).result;
  });
  afterEach(() => {
    try { db.close(); } catch { /* best-effort */ }
    rmSync(root, { recursive: true, force: true });
  });

  it("saves a healthy field, and keeps the healthy one when the next is poisoned", () => {
    const faults = createFaultLog();
    const store = createFieldStore(db, faults);

    const good = createGraph();
    addNode(good, { kind: "moment", text: "早上开窗，风比昨天冷", bornMs: 1, charge: 0.5, source: "s", key: "k1" });
    store.save(good, [], 1, 0.55, [], []);
    expect(store.load()?.graph.nodes.size).toBe(1);

    // Now the poisoned one: one node's strength has stopped being a number.
    const poisoned = createGraph();
    const n = addNode(poisoned, { kind: "moment", text: "第二件事", bornMs: 2, charge: 0.5, source: "s", key: "k2" });
    n.strength = NaN;
    addNode(poisoned, { kind: "moment", text: "第三件事", bornMs: 3, charge: 0.5, source: "s", key: "k3" });
    store.save(poisoned, [], 2, 0.55, [], []);

    const after = store.load();
    expect(after?.graph.nodes.size, "the poisoned field overwrote the good one").toBe(1);
    expect([...after!.graph.nodes.values()][0]!.text).toContain("早上开窗");
    const recorded = faults.all().filter((f) => f.where === "field.store.notFinite");
    expect(recorded.length, "the refusal was silent — she would stop being saved with nobody told").toBe(1);
    expect(recorded[0]!.severity).toBe("critical");
    expect(recorded[0]!.detail).toContain("strength");
  });
});

describe("one unreadable row costs one row, not her whole past", () => {
  let root: string;
  let db: DatabaseWrapper;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "finite-partial-"));
    db = createDatabase(join(root, "test.db")).result;
  });
  afterEach(() => {
    try { db.close(); } catch { /* best-effort */ }
    rmSync(root, { recursive: true, force: true });
  });

  it("a corrupt node is skipped, the rest come back, and the loss is critical rather than silent", () => {
    // The failure being closed: `load()` is wrapped in a try that returns null on any throw, and
    // null means "she has no past", boot proceeds as a newborn and the next save writes that
    // emptiness over the file that still held her life. A single corrupt byte was total loss.
    const faults = createFaultLog();
    const store = createFieldStore(db, faults);
    const g = createGraph();
    for (const [i, text] of ["渡轮那天风一直没定", "文章开头改了第七遍", "那盆植物还绿着"].entries()) {
      addNode(g, { kind: "moment", text, bornMs: 100 + i, charge: 0.5, source: "s", key: `k${i}` });
    }
    store.save(g, [], 1, 0.55, [], []);

    // Corrupt exactly one row. NOT NULL already stops a null (a defence worth knowing about), so
    // this writes a value that is not a number at all, which SQLite's dynamic typing permits, and
    // which is what a partially-migrated column or a damaged page actually looks like on read.
    db.db.prepare("UPDATE field_nodes SET strength = 'broken' WHERE node_key = 'k1'").run();

    const back = store.load();
    expect(back, "one bad row returned null — her whole past would be gone").not.toBeNull();
    expect(back!.graph.nodes.size).toBe(2);
    const texts = [...back!.graph.nodes.values()].map((n) => n.text);
    expect(texts).toContain("渡轮那天风一直没定");
    expect(texts).toContain("那盆植物还绿着");

    const loud = faults.all().find((f) => f.where === "field.store.load.incomplete");
    expect(loud, "she came back smaller and nobody was told").toBeDefined();
    expect(loud!.severity).toBe("critical");
    expect(loud!.detail).toContain("1 of 3");
  });

  it("a healthy field reports no loss at all", () => {
    const faults = createFaultLog();
    const store = createFieldStore(db, faults);
    const g = createGraph();
    addNode(g, { kind: "moment", text: "普通的一天", bornMs: 1, charge: 0.4, source: "s", key: "ok" });
    store.save(g, [], 1, 0.55, [], []);
    expect(store.load()!.graph.nodes.size).toBe(1);
    expect(faults.all().filter((f) => f.where.startsWith("field.store.load"))).toEqual([]);
  });
});

describe("her continuity refuses too", () => {
  let root: string;

  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "finite-cont-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  const storeAt = (r: string): ReturnType<typeof createContinuityStore> => {
    const dir = join(r, "life");
    return createContinuityStore(join(dir, "continuity.json"), dir, realFs, createFaultLog());
  };

  it("a NaN in her temperament does not overwrite the last good file", () => {
    const faults = createFaultLog();
    const dir = join(root, "life");
    const store = createContinuityStore(join(dir, "continuity.json"), dir, realFs, faults);
    const base = {
      savedAtMs: 1, lastTickMs: 1, safeMode: false, lastMomentMs: 0,
      sendTimes: [], consecutiveNonReplies: 0, everSpoke: true, lastUserMs: 1,
      streamSeed: 42, streamPosition: 7, temperament: { warmth: 0.1, guard: 0, drive: 0, openness: 0 },
      temperamentDays: 3, egressSeen: [],
    } as unknown as Parameters<typeof store.save>[0];

    store.save(base);
    const good = readFileSync(join(root, "life", "continuity.json"), "utf8");

    const poisoned = { ...(base as unknown as Record<string, unknown>), streamPosition: NaN } as unknown as Parameters<typeof store.save>[0];
    store.save(poisoned);

    expect(readFileSync(join(root, "life", "continuity.json"), "utf8"),
      "a NaN stream position was written — she would resume from a position that is not a place")
      .toBe(good);
    expect(faults.all().some((f) => f.where === "continuity.notFinite" && f.severity === "critical")).toBe(true);
  });

  it("and a refusal on the very first save leaves no file at all (it is not a delete either)", () => {
    const store = storeAt(root);
    const bad = { savedAtMs: NaN } as unknown as Parameters<typeof store.save>[0];
    store.save(bad);
    expect(existsSync(join(root, "life", "continuity.json"))).toBe(false);
  });
});
