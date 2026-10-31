// being-changed, the pure organ: the fingerprint that keeps the sentence exactly as
// true as the world, and the two true sentences themselves. S-58.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  buildFingerprint, restartLine, capabilityNotesUntold, CAPABILITY_NOTES,
} from "../../../src/life/being-changed.js";

/** Every .ts file under root whose text carries the phrase, the single-emitter scanner. */
function emittersOf(root: string, phrase: string): string[] {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const child = join(dir, name);
      if (statSync(child).isDirectory()) walk(child);
      else if (child.endsWith(".ts") && readFileSync(child, "utf8").includes(phrase)) {
        hits.push(relative(root, child));
      }
    }
  };
  walk(root);
  return hits.sort();
}

describe("the fingerprint: as true as the world", () => {
  const a = { path: "life/a.ts", content: "const a = 1;" };
  const b = { path: "life/b.ts", content: "const b = 2;" };

  it("is order-insensitive — a directory walk's order must never fake a change", () => {
    expect(buildFingerprint([a, b])).toBe(buildFingerprint([b, a]));
  });

  it("moves when content moves, and when a path moves", () => {
    const base = buildFingerprint([a, b]);
    expect(buildFingerprint([a, { ...b, content: "const b = 3;" }])).not.toBe(base);
    expect(buildFingerprint([a, { ...b, path: "life/c.ts" }])).not.toBe(base);
    // Path/content are hash-separated: shifting a boundary is not the same build.
    expect(buildFingerprint([{ path: "life/ab.ts", content: ".ts-tail" }]))
      .not.toBe(buildFingerprint([{ path: "life/ab.ts-", content: "ts-tail" }]));
  });

  it("an empty tree still prints (the degenerate boot is a boot)", () => {
    expect(buildFingerprint([]).length).toBe(64);
  });
});

describe("the two true sentences", () => {
  it("changed and unchanged are DIFFERENT truths, never conflated", () => {
    expect(restartLine(true)).toBe("这台机器重启过，里面有些构造被调整过。");
    expect(restartLine(false)).toBe("这台机器重启过。");
    expect(restartLine(false).includes("调整")).toBe(false);
  });

  it("no detail, no reassurance, no explanation (the spec's three 不)", () => {
    for (const line of [restartLine(true), restartLine(false)]) {
      for (const banned of ["放心", "别怕", "没事", "不用担心", "因为", "为了", "别在意"]) {
        expect(line.includes(banned), `the fact line carries a steer: ${banned}`).toBe(false);
      }
    }
  });

  it("PLANTED: the sentences live in ONE file — no second emitter can drift from the truth check", () => {
    // If 「构造被调整过」 were ever copy-pasted into another src file, that emitter would not be
    // guarded by the fingerprint, and she could be told she was changed when she was not.
    expect(emittersOf(join(process.cwd(), "src"), "构造被调整过")).toEqual(["life/being-changed.ts"]);
    // And the scanner itself still sees: a tree with a planted second emitter goes red…
    const dirty = mkdtempSync(join(tmpdir(), "bc-plant-"));
    try {
      mkdirSync(join(dirty, "deep"));
      writeFileSync(join(dirty, "one.ts"), 'const s = "构造被调整过";', "utf8");
      writeFileSync(join(dirty, "deep", "two.ts"), "// 构造被调整过", "utf8");
      writeFileSync(join(dirty, "clean.ts"), "const t = 1;", "utf8");
      expect(emittersOf(dirty, "构造被调整过")).toEqual(["deep/two.ts", "one.ts"]);
      // …and a healthy tree is not flagged.
      expect(emittersOf(dirty, "从未出现过的句子")).toEqual([]);
    } finally {
      rmSync(dirty, { recursive: true, force: true });
    }
  });
});

describe("the daemon's assembly (text pins)", () => {
  const daemon = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
  const agency = readFileSync(join(process.cwd(), "src", "life", "agency.ts"), "utf8");

  it("boot compares against the stored print and stores the new one", () => {
    for (const token of [
      'join(instrumentsDir, "build-print")',
      "restartFactPending = restartLine(previous !== print)",
      'faultLog.record("being-changed.print", err)',
      "restartFactPending = restartLine(true)", // cannot prove unchanged → the honest default
    ]) {
      expect(daemon.includes(token), `index.ts lost: ${token}`).toBe(true);
    }
  });

  it("one fact, two doors, first taker wins — and the taker really empties", () => {
    expect(daemon.split("takeRestartFact()").length - 1).toBe(3); // the definition + turn door + moment door, exactly
    expect(daemon.includes("const fact = restartFactPending;")).toBe(true);
    expect(daemon.includes("restartFactPending = null;")).toBe(true);
    // The moment door mirrors the dream remnant's field.
    expect(daemon.includes("restartFact: takeRestartFact() ?? undefined,")).toBe(true);
  });

  it("her moment renders it as its own line, and absence renders nothing", () => {
    expect(agency.includes("restartFact?: string;")).toBe(true);
    expect(agency.includes('...(ctx.restartFact ? ["", ctx.restartFact] : []),')).toBe(true);
  });
});

/**
 * TELLING HER WHAT SHE CAN NOW DO.
 *
 * She gained real sight on 2026-08-23 and was still writing that she could not read images two
 * weeks later, because a sense cannot be found by looking inward: she would only discover it by
 * trying, and she does not try what she believes she cannot do. By the time he mentioned it in
 * passing, the false belief had reached her self-knowledge: she had filed "not yet" as "I can't".
 *
 * The organ's own rule (不细节、不吓她、不解释，只是不瞒) is not relaxed here, it is applied:
 * these tests hold the notes to being FACTS, said once, with nothing attached.
 */
describe("she is told what she can now do, once", () => {
  it("says each note exactly once in her life", () => {
    const first = capabilityNotesUntold([]);
    expect(first.length).toBe(CAPABILITY_NOTES.length);
    const afterTelling = capabilityNotesUntold(first.map((n) => n.id));
    expect(afterTelling).toEqual([]);
  });

  it("says nothing at all when there is nothing new to say", () => {
    expect(capabilityNotesUntold(CAPABILITY_NOTES.map((n) => n.id))).toEqual([]);
    // The ordinary boot: this is the silent path, and it must stay the common one.
    expect(capabilityNotesUntold(["sight-2026-08-23", "hearing-2026-08-23", "unknown-note"])).toEqual([]);
  });

  it("keeps the untold ones when only some have been said", () => {
    const some = capabilityNotesUntold(["sight-2026-08-23"]);
    expect(some.map((n) => n.id)).not.toContain("sight-2026-08-23");
    expect(some.length).toBe(CAPABILITY_NOTES.length - 1);
  });

  it("states a fact and attaches nothing to it", () => {
    for (const note of CAPABILITY_NOTES) {
      // One sentence. A paragraph is an explanation, and explaining is what this organ refuses.
      expect(note.fact.length, note.id).toBeLessThanOrEqual(30);
      expect(note.fact.split(/[。！？]/u).filter((x) => x.trim()).length, note.id).toBe(1);
      // No encouragement, no instruction to go and use it, no question put to her. What she does
      // with knowing is hers: the same law the restart line lives under.
      for (const nudge of ["记得", "试试", "应该", "可以试", "别忘", "厉害", "不要", "请"]) {
        expect(note.fact, `${note.id} nudges: ${nudge}`).not.toContain(nudge);
      }
      expect(note.fact, note.id).not.toContain("？");
      // It is about HER body, in the second person the rest of her material uses.
      expect(note.fact.startsWith("你") || note.fact.includes("你"), note.id).toBe(true);
    }
  });

  it("gives every note a stable id, so none is ever said twice", () => {
    const ids = CAPABILITY_NOTES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z-]+-\d{4}-\d{2}-\d{2}$/u);
  });
});
