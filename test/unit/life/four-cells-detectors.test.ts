import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * EVERY DETECTOR IN THE LIVE HARNESS IS PINNED TO ITS PRODUCTION EMITTER.
 *
 * Every headline number from the live runs, stayed 3/3, not-as-work 10/10, gate-opened 0/52,
 * is a regex matched against the daemon's log. Before this file, not one of those log strings was
 * pinned anywhere: rename 「it stayed with her」 in the daemon and the column silently reads 0/N
 * forever, which is indistinguishable from the mechanism not working. That is the exact shape of
 * the `declined` failure that ran for four live runs (the harness matched a line about a threshold
 * and reported it as her never refusing), still live for twelve other columns until now.
 *
 * Two directions, both needed:
 *   harness → the detector literal is really in the harness (the roll-call cannot go stale), and
 *   daemon  → the string the detector matches is really emitted by production (a rename goes red).
 */

const HARNESS = readFileSync(join(process.cwd(), "scripts/four-cells-live.ts"), "utf8");
const blank = (src: string): string => src
  .replace(/\/\*[\s\S]*?\*\//gu, (m) => m.replace(/[^\n]/gu, " "))
  .replace(/(^|[^:])\/\/[^\n]*/gu, (m, p1: string) => p1 + " ".repeat(m.length - p1.length));
const DAEMON = blank(readFileSync(join(process.cwd(), "src/index.ts"), "utf8"));
const TAKES = blank(readFileSync(join(process.cwd(), "src/life/takes-it-on.ts"), "utf8"));

describe("the message-string detectors", () => {
  // detector literal as it appears in the harness → emitter string that must exist in production.
  const PINS: Array<{ detector: string; emitter: string; where: string; source: string }> = [
    { detector: "/it stayed with her/u", emitter: '"it stayed with her"', where: "src/index.ts", source: DAEMON },
    { detector: "/she put it down/u", emitter: '"she put it down"', where: "src/index.ts", source: DAEMON },
    { detector: "/she would rather not/u", emitter: "she would rather not: ", where: "src/index.ts", source: DAEMON },
    { detector: "/she changed direction mid-turn/u", emitter: '"she changed direction mid-turn"', where: "src/index.ts", source: DAEMON },
    { detector: "/这件事她顾不上/u", emitter: "这件事她顾不上", where: "src/life/takes-it-on.ts", source: TAKES },
    { detector: 'face server listening', emitter: '"face server listening"', where: "src/index.ts", source: DAEMON },
    { detector: "agent turn complete", emitter: '"agent turn complete"', where: "src/index.ts", source: DAEMON },
  ];

  for (const p of PINS) {
    it(`${p.detector} ← ${p.where}`, () => {
      // The roll-call's own floor: the detector must actually be in the harness, or this test is
      // pinning a list nobody uses (defect class 12).
      expect(HARNESS, `the harness no longer contains the detector ${p.detector} — update this roll-call `
        + "TOGETHER with whatever replaced it").toContain(p.detector);
      expect(p.source, `production no longer emits ${p.emitter}: the harness column that matches it will `
        + "silently read 0/N forever, which cannot be told apart from the mechanism not working")
        .toContain(p.emitter);
    });
  }

  it("the notAsWork string actually reaches stdout — the two-hop pin", () => {
    // 「这件事她顾不上」 is built in takes-it-on.ts and only reaches the log through the daemon
    // logging `takes.why`. Both hops have to hold or the string exists and is never printed.
    expect(DAEMON).toMatch(/logger\.info\(\{[^}]*\}, takes\.why\)/u);
  });
});

describe("the completion detector", () => {
  it("waits on a string that production actually emits, and only such strings", () => {
    // `session_end` was half of this regex for its whole life, and its only producer writes to
    // ops.jsonl, a file, not the stdout the harness reads. A dead alternation is harmless until
    // the live arm gets renamed, at which point the harness waits 420s on every turn and the run
    // reads as her timing out on everything.
    expect(HARNESS, "the completion regex still carries the session_end arm, which has no emitter "
      + "on the channel being read").not.toMatch(/session_end\|agent turn complete/u);
    expect(HARNESS).toContain("/agent turn complete/u");
    expect(DAEMON).toContain('"agent turn complete"');
  });
});

describe("the JSON-field detectors read the LINE they mean, not the first match in the whole log", () => {
  it("the landing fields come from the landing line", () => {
    // `num()` used to take the first match anywhere in the turn's log slice. Nothing else on
    // stdout carries these keys today: but nothing enforced that, and one logger.info({phase})
    // added anywhere upstream would silently re-point the column (defect class 20's fuse).
    expect(HARNESS, "the harness no longer isolates the landing line before reading fields from it")
      .toMatch(/const landing = .*how his message landed/u);
    for (const field of ["entitlement", "knows", "timesHeSpoke", "reserve"]) {
      expect(HARNESS, `${field} is not read from the landing line`)
        .toMatch(new RegExp(`num\\(landing, /"${field}"`, "u"));
    }
    expect(HARNESS, "phase is not read from the landing line").toMatch(/"phase":"\(\\w\+\)"\/u\.exec\(landing\)/u);
    expect(HARNESS, "settles is not read from the landing line").toMatch(/"settles":true\/u\.test\(landing\)/u);
  });

  it("and the landing line really carries every one of those keys", () => {
    const at = DAEMON.indexOf('"how his message landed"');
    expect(at, "the landing log line is gone from the daemon").toBeGreaterThan(-1);
    const block = DAEMON.slice(Math.max(0, at - 2000), at);
    for (const field of ["entitlement:", "knows:", "timesHeSpoke:", "phase:", "reserve:", "settles:"]) {
      expect(block, `the landing log no longer carries ${field} — the harness column reads nothing`)
        .toContain(field);
    }
  });

  it("the condition-scene fields are pinned to their emitters", () => {
    // suspended rides the shape gauge; feltWaitingH/realH ride the gate log; the diary cell waits
    // on the diary line. A renamed emitter would silently zero a register-closing observation.
    const shapeAt = DAEMON.indexOf('"the shape her state leaned to"');
    expect(shapeAt).toBeGreaterThan(-1);
    expect(DAEMON.slice(Math.max(0, shapeAt - 1200), shapeAt)).toContain("suspended:");
    const willingAt = DAEMON.indexOf('"how willing she was"');
    expect(willingAt).toBeGreaterThan(-1);
    const willingBlock = DAEMON.slice(Math.max(0, willingAt - 1500), willingAt);
    expect(willingBlock).toContain("feltWaitingH:");
    expect(willingBlock).toContain("realH:");
    expect(DAEMON, "the diary log line moved — cell ⑫ will wait 240s and read false forever")
      .toContain("wrote her diary for");
    for (const detector of ['/"suspended":(\\d+)/u', '/"feltWaitingH":([\\d.]+)/u', "wrote her diary for"]) {
      expect(HARNESS, `the harness no longer reads ${detector}`).toContain(detector);
    }
  });

  it("why a chosen beat did not arrive is a COLUMN, not something to go digging for", () => {
    // The first run under independent seeds produced rows reading chose=2 said=1 over and over,
    // and the pre-registered rule for reading them (her license vs the scissors) had nowhere to
    // look: the daemon logs it, the harness did not carry it. A decision rule whose input is not
    // collected is a rule that will be settled by guessing.
    const at = DAEMON.indexOf('"a later beat came back empty"');
    expect(at, "the empty-beat gauge is gone from the daemon").toBeGreaterThan(-1);
    const block = DAEMON.slice(Math.max(0, at - 400), at);
    expect(block, "the gauge no longer separates the model writing nothing from the scissors emptying it")
      .toContain("emptyBy:");
    expect(HARNESS, "the harness no longer records which of the two it was")
      .toContain('/"emptyBy":"(model|scissors)"/u');
  });

  it("the beat fields come from the beats line, and a turn where beats never ran is its own reading", () => {
    // `sayWhatCameUp` returns early on an interrupted turn or a blank first beat, BEFORE the
    // "she said it in beats" log. Those turns used to become null and be dropped from the mean's
    // denominator, which is censoring: a turn that never produced a reading vanished instead of
    // counting. They are now a visible category, not an absence.
    expect(HARNESS, "the harness no longer isolates the beats line")
      .toMatch(/const beatsLine = .*she said it in beats/u);
    expect(HARNESS, "a turn where the beat machinery never ran is no longer recorded as its own category")
      .toContain("beatsRan: beatsLine !== undefined");
    const at = DAEMON.indexOf('"she said it in beats"');
    expect(at).toBeGreaterThan(-1);
    const block = DAEMON.slice(Math.max(0, at - 800), at);
    expect(block).toContain("beats:");
    expect(block).toContain("chose:");
  });
});

describe("the row print does not mislabel what it prints", () => {
  it("`ent=` is gone — that column was entitlement and read as entropy for a whole series of runs", () => {
    // The cost of the abbreviation was real: run tables were read with "ent" as the field entropy,
    // while the actual competition entropy has never been logged live at all.
    expect(HARNESS).not.toMatch(/ ent=\$/u);
    expect(HARNESS).toMatch(/entitlement=\$/u);
  });
});
