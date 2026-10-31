import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createHerForm, blendUnit,
  FORM_RING, FORM_EVIDENCE_FLOOR, FORM_EMA_ALPHA, OPENER_REPEAT_FLOOR,
  FORM_STATE_WEIGHT, FORM_HABIT_WEIGHT, FORM_UNIT_MIN, FORM_UNIT_MAX,
} from "../../../src/life/her-form.js";

/**
 * THE FORM MIRROR. Her words had a bank and her sentences a pool; the FORM of what she
 * sends had neither a mirror she could read nor a place in her rhythm. This file pins the bank's
 * arithmetic, the mirror law (给像不给判词, planted violation drives the literal scan), and the
 * no-dictator property of the state × habit blend.
 */

const BLOCK = "第一段说一件事。\n\n第二段说另一件。";
const LINE = "就一句。";

function fed(n: number, text = LINE): ReturnType<typeof createHerForm> {
  const f = createHerForm();
  for (let i = 0; i < n; i++) f.noted(text, "reply", 1000 + i);
  return f;
}

describe("the bank's arithmetic", () => {
  it("counts blocks the way a phone shows them, and sentences the way she breathes them", () => {
    const f = fed(FORM_EVIDENCE_FLOOR, BLOCK);
    expect(f.habitUnitChars(), "two blocks halve the per-bubble habit").toBeLessThan(20);
    const g = fed(FORM_EVIDENCE_FLOOR, "一句话六个字。");
    expect(g.habitUnitChars()).toBeGreaterThan(4);
  });

  it("the EMA moves at habit speed, not turn speed", () => {
    const f = fed(40, "四个字啊。");
    f.noted("这一条突然写得非常非常长，长到像换了一个人在说话，但一次不该改写她是谁。", "reply", 99);
    const habit = f.habitUnitChars()!;
    expect(habit, "one outlier must not drag the habit far").toBeLessThan(12);
  });

  it("the ring holds the recent window and the floor keeps silence honest", () => {
    expect(fed(FORM_EVIDENCE_FLOOR - 1).habitUnitChars()).toBeNull();
    expect(fed(FORM_EVIDENCE_FLOOR - 1).speakingLine()).toBe("");
    expect(fed(FORM_EVIDENCE_FLOOR - 1).mirrorLines()).toBe("");
    expect(FORM_RING).toBe(50);
    expect(FORM_EMA_ALPHA).toBeCloseTo(0.06, 5);
  });

  it("seeding equals having lived it: seed vs replay give the same habit", () => {
    const texts = Array.from({ length: 20 }, (_, i) => (i % 3 === 0 ? BLOCK : LINE));
    const seeded = createHerForm();
    seeded.seedFrom(texts.map((text, i) => ({ text, ms: i })));
    const lived = createHerForm();
    texts.forEach((t, i) => lived.noted(t, "reply", i));
    expect(seeded.habitUnitChars()).toBe(lived.habitUnitChars());
    expect(seeded.speakingLine()).toBe(lived.speakingLine());
    // And a bank that already holds anything refuses the seed, her record speaks for itself.
    seeded.seedFrom([{ text: "别的", ms: 1 }]);
    expect(seeded.size()).toBe(20);
  });
});

describe("the mirror law: 给像不给判词", () => {
  it("the speaking line is a fact of numbers and one fact-kind branch, nothing else", () => {
    const blocks = fed(FORM_EVIDENCE_FLOOR, BLOCK).speakingLine();
    expect(blocks).toContain("常分几段");
    const single = fed(FORM_EVIDENCE_FLOOR, "一口气说到底的一条稍微长一点的消息。").speakingLine();
    expect(single).toContain("多是一口气一条");
    for (const line of [blocks, single]) {
      expect(line.length).toBeLessThanOrEqual(40);
      expect(line).toMatch(/^你平时一条\d+字上下，/u);
    }
  });

  it("the fuller mirror shows repeated openers only past the repeat floor", () => {
    const f = createHerForm();
    for (let i = 0; i < FORM_EVIDENCE_FLOOR; i++) f.noted(i < OPENER_REPEAT_FLOOR ? "好的呀。" : `第${i}句不同开头。`, "reply", i);
    expect(f.mirrorLines()).toContain("开头常用「好的」");
    const varied = fed(FORM_EVIDENCE_FLOOR, LINE); // same opener every time: floor met
    expect(varied.mirrorLines().split("\n").length).toBeGreaterThanOrEqual(2);
  });

  it("PLANTED VIOLATION: an advising word in the module's literals goes red", () => {
    const src = readFileSync(join(process.cwd(), "src/life/her-form.ts"), "utf8");
    const code = src.replace(/\/\/[^\n]*/gu, "").replace(/\/\*[\s\S]*?\*\//gu, "");
    const literals = [...code.matchAll(/`([^`]*)`|"((?:[^"\\]|\\.)*)"/gu)].map((m) => m[1] ?? m[2] ?? "");
    const ADVISING = /应该|最好|试着|记得|别忘|不妨|建议|太长|太短|要更/u;
    for (const lit of literals) {
      expect(ADVISING.test(lit), `the mirror advised instead of showing: ${lit}`).toBe(false);
    }
    // The scan itself can go red:
    expect(ADVISING.test("你说话应该短一点")).toBe(true);
  });
});

describe("the blend: state × habit, neither a dictator", () => {
  it("no habit on record = the state stands alone", () => {
    expect(blendUnit(70, null)).toBe(70);
  });

  it("either input sweeping its range moves the blend by its weight and no more", () => {
    const stateSpan = Math.abs(blendUnit(110, 70) - blendUnit(30, 70));
    expect(stateSpan).toBeCloseTo(FORM_STATE_WEIGHT * 80, 0);
    const habitSpan = Math.abs(blendUnit(70, FORM_UNIT_MAX) - blendUnit(70, FORM_UNIT_MIN));
    expect(habitSpan).toBeCloseTo(FORM_HABIT_WEIGHT * (FORM_UNIT_MAX - FORM_UNIT_MIN), 0);
    // They can genuinely disagree, and the outcome is the disagreement's result:
    const tiredLongform = blendUnit(35, 130);
    expect(tiredLongform).toBeGreaterThan(35);
    expect(tiredLongform).toBeLessThan(130);
  });

  it("clamps hold at both ends", () => {
    expect(blendUnit(30, 5)).toBeGreaterThanOrEqual(FORM_UNIT_MIN);
    expect(blendUnit(110, 10_000)).toBeLessThanOrEqual(FORM_UNIT_MAX);
  });
});

describe("the loader lineage", () => {
  it("round-trips through disk and starts empty on corruption, never throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "her-form-"));
    const p = join(dir, "her-form.json");
    const a = createHerForm({ path: p });
    for (let i = 0; i < FORM_EVIDENCE_FLOOR; i++) a.noted(BLOCK, "tool", i);
    a.persist();
    const b = createHerForm({ path: p });
    expect(b.size()).toBe(a.size());
    expect(b.habitUnitChars()).toBe(a.habitUnitChars());
    writeFileSync(p, "not json{{{", "utf8");
    const faults: string[] = [];
    const c = createHerForm({ path: p, onFault: (w) => faults.push(w) });
    expect(c.size()).toBe(0);
    expect(faults).toEqual(["her-form.load"]);
  });
});

describe("the wiring, floored", () => {
  const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");

  it("all three mouths feed the bank, labelled", () => {
    const reply = daemon.indexOf('herForm.noted(saidSafe, viaTool ? "tool" : "reply"');
    expect(reply).toBeGreaterThan(-1);
    const pro = daemon.indexOf('herForm.noted(spoken, "proactive"');
    expect(pro).toBeGreaterThan(-1);
  });

  it("both delivery units blend state with her habit", () => {
    const hits = [...daemon.matchAll(/blendUnit\(breathUnitFor\(/gu)];
    expect(hits.length).toBe(2);
  });

  // A mirror of her own form belongs where she THINKS about herself; the same sentence one line
  // above the words she is about to write is us deciding how she speaks. It left both speaking
  // mouths and kept its home in her tending.
  it("the mirror reaches her tending, and NEITHER mouth is told how she usually writes", () => {
    expect(daemon.indexOf("formMirror: () =>")).toBeGreaterThan(-1);
    expect(daemon.includes("const formLine = herForm.speakingLine();")).toBe(false);
    expect(daemon.includes("const fl = herForm.speakingLine()")).toBe(false);
  });

  it("the seed runs once, from her real record, before anything else could write", () => {
    const at = daemon.indexOf("if (herForm.size() === 0) {");
    expect(at).toBeGreaterThan(-1);
    expect(daemon.slice(at, at + 700)).toContain("herForm.seedFrom(past)");
  });
});
