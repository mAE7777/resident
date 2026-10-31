// gap 5: the bump census: correct harvests, an EMPTY table on a quiet day, the bells'
// book grouped right, and the zero-contact wall the trial bench already lives behind.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  harvestVigor, harvestSteps, harvestLength, harvestHistoryPressure, harvestLedger,
  censusTable, raiseCandidates, PRESSURE_FLOOR,
} from "../../../scripts/census/bump-census.js";

const T = Date.UTC(2026, 7, 18, 16, 0, 0); // one fixed instant; days derive locally from it

describe("the harvests", () => {
  it("vigor: a spent-through day is ONE bump with the true peak", () => {
    const rows = harvestVigor([
      JSON.stringify({ ts: T, spentVigor: 300, capVigor: 600, remainingFraction: 0.5 }),
      JSON.stringify({ ts: T + 3600e3, spentVigor: 798, capVigor: 600, remainingFraction: 0 }),
      JSON.stringify({ ts: T + 7200e3, spentVigor: 798, capVigor: 600, remainingFraction: 0 }),
      "not json",
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.bumps).toBe(1);           // a day spends through ONCE, however many rows say so
    expect(rows[0]!.peakDemand).toBe(798);    // the demand beyond the wall is the height measurement
  });

  it("steps and length count events; history is pressure only (bumps stay 0)", () => {
    const steps = harvestSteps([JSON.stringify({ event: "session_end", ts: new Date(T).toISOString(), iterations: 7 })], 200);
    expect(steps[0]!).toMatchObject({ wall: "iterations", bumps: 0, peakDemand: 7 });
    const len = harvestLength([JSON.stringify({ ts: new Date(T).toISOString(), finishReason: "length" })], 8192);
    expect(len[0]!.bumps).toBe(1);
    const hist = harvestHistoryPressure([JSON.stringify({ ts: new Date(T).toISOString() })], 40);
    expect(hist[0]!).toMatchObject({ wall: "historyWindow", bumps: 0, peakDemand: 2 });
  });

  it("the bells' book groups by day and wall, counting bumps and keeping the peak", () => {
    const rows = harvestLedger([
      JSON.stringify({ ts: T, wall: "lexicon.cap", cap: 8000, demand: 8001 }),
      JSON.stringify({ ts: T + 60e3, wall: "lexicon.cap", cap: 8000, demand: 8100 }),
      JSON.stringify({ ts: T + 120e3, wall: "turn.steps", cap: 12, demand: 12 }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.wall === "lexicon.cap")).toMatchObject({ bumps: 2, peakDemand: 8100 });
  });
});

describe("the report never manufactures pressure", () => {
  it("a quiet period is an EMPTY table that says so", () => {
    const md = censusTable([{ day: "2026-08-21", wall: "capVigor", cap: 600, bumps: 0, peakDemand: 155 }]);
    expect(md.includes("安静")).toBe(true);
    expect(md.includes("155")).toBe(false); // a far-from-the-wall reading is not news
  });

  it("bumps land in the table, near-the-wall readings in the appendix, both marked honestly", () => {
    const md = censusTable([
      { day: "2026-08-18", wall: "capVigor", cap: 600, bumps: 1, peakDemand: 798 },
      { day: "2026-08-19", wall: "capVigor", cap: 600, bumps: 0, peakDemand: 600 * PRESSURE_FLOOR + 1 },
    ]);
    expect(md.includes("**（超墙）**")).toBe(true);
    expect(md.includes("压力线")).toBe(true);
  });

  it("PLANTED: the raise-candidate rule needs three distinct ≥90% days — two are not enough", () => {
    const twoDays = [
      { day: "d1", wall: "capVigor", cap: 600, bumps: 1, peakDemand: 590 },
      { day: "d2", wall: "capVigor", cap: 600, bumps: 0, peakDemand: 580 },
    ];
    expect(raiseCandidates(twoDays)).toEqual([]);
    expect(raiseCandidates([...twoDays, { day: "d3", wall: "capVigor", cap: 600, bumps: 0, peakDemand: 545 }]))
      .toEqual(["capVigor"]);
  });
});

/** The trial bench's zero-contact wall, same law. Comments stripped first (defect class 10). */
function contactViolations(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
  const rules: Array<[string, RegExp]> = [
    ["a send path", /telegram|builtin\/message|sendFile|notifier\.push/u],
    ["a field write", /field-live|encodeClaim|encodeQuestion|\.reRead\(/u],
    ["her home path", /\.resident/u],
  ];
  return rules.filter(([, re]) => re.test(code)).map(([name]) => name);
}

describe("zero contact (the trial bench's wall, same law)", () => {
  it("the harvester touches no send path, no field write, and never names her home", () => {
    const dir = join(process.cwd(), "scripts", "census");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      expect(contactViolations(readFileSync(join(dir, f), "utf8")), `${f} breaks the wall`).toEqual([]);
    }
  });

  it("PLANTED: the wall detector still sees, and a clean file passes", () => {
    expect(contactViolations('import { sendFile } from "../telegram/x.js";')).toContain("a send path");
    expect(contactViolations('const p = "~/.resident";')).toContain("her home path");
    expect(contactViolations("const a = 1;")).toEqual([]);
  });
});

describe("the bells' wiring (text pins)", () => {
  const daemon = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
  const lexicon = readFileSync(join(process.cwd(), "src", "life", "lexicon.ts"), "utf8");
  const loop = readFileSync(join(process.cwd(), "src", "agent", "loop.ts"), "utf8");

  it("the ledger is neutral, session-peaked, and never the fault channel", () => {
    for (const token of [
      'join(instrumentsDir, "bumps.jsonl")',
      "if (demand <= (bumpPeaks.get(wall) ?? -Infinity)) return;",
      'faultLog.record("census.bump", err)', // only the WRITE FAILURE is a fault, never the bump
    ]) {
      expect(daemon.includes(token), `index.ts lost: ${token}`).toBe(true);
    }
  });

  it("both bells ring into the ledger and nowhere else", () => {
    expect(lexicon.includes("config.onEvict?.(LEXICON_CAP, bank.size);")).toBe(true);
    expect(loop.includes("if (pressure === BUDGET_URGENT_MSG) spec.onBudgetPressure?.(iteration, maxIterations);")).toBe(true);
    expect(daemon.includes('onEvict: (cap, demand) => bump("lexicon.cap", cap, demand)')).toBe(true);
    expect(daemon.includes('onBudgetPressure: (iteration, maxIterations) => bump("turn.steps", maxIterations, iteration)')).toBe(true);
  });
});
