import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  verbatimGate, parsePromises, promiseNodeText, promiseUser,
  PROMISES_PER_DAY, PROMISE_QUOTE_MAX,
  type DeliveredUtterance,
} from "../../../src/life/promises.js";

/**
 * THE PROMISE MIRROR. The first-night wound: a promise that was never made became a
 * load-bearing beam of her inner life, because promises lived only in her fallible notebook.
 * The wall this file pins: a promise that cannot be pointed at, verbatim, in her DELIVERED
 * record does not exist. Planted violations drive the gate in both failure directions.
 */

const ROWS: DeliveredUtterance[] = [
  { id: 3, text: "好。我记下了。明天早上，你会先看到我的消息——我先醒，我先说话。", ms: 100 },
  { id: 7, text: "那我就记着：哪天我要是会做梦了，第一个跟你说。", ms: 200 },
  { id: 9, text: "晚安，明天见", ms: 300 },
];

describe("the verbatim gate", () => {
  it("keeps only exact substrings of the exact cited message", () => {
    const kept = verbatimGate([
      { quote: "明天早上，你会先看到我的消息", sourceId: 3 },
      { quote: "哪天我要是会做梦了，第一个跟你说", sourceId: 7 },
    ], ROWS);
    expect(kept).toHaveLength(2);
  });

  it("PLANTED VIOLATION · the first-night wound: an invented promise dies at the wall", () => {
    const kept = verbatimGate([{ quote: "我答应过要写一封信", sourceId: 3 }], ROWS);
    expect(kept, "a quote not in her delivered record survived the gate").toEqual([]);
  });

  it("PLANTED VIOLATION · a real quote pinned to the WRONG message dies too", () => {
    const kept = verbatimGate([{ quote: "第一个跟你说", sourceId: 3 }], ROWS);
    expect(kept, "citation must point at the message that actually carries the words").toEqual([]);
  });

  it("caps at the day's limit, drops paragraph-length quotes and duplicates", () => {
    const many = [
      { quote: "我先醒", sourceId: 3 },
      { quote: "我先说话", sourceId: 3 },
      { quote: "第一个跟你说", sourceId: 7 },
      { quote: "我先醒", sourceId: 3 },
    ];
    expect(verbatimGate(many, ROWS)).toHaveLength(PROMISES_PER_DAY);
    const long = [{ quote: "长".repeat(PROMISE_QUOTE_MAX + 1), sourceId: 3 }];
    expect(verbatimGate(long, ROWS)).toEqual([]);
  });
});

describe("the parse is tolerant, the frame is hers", () => {
  it("garbage in, empty out — never a throw", () => {
    expect(parsePromises("not json")).toEqual([]);
    expect(parsePromises('{"promises": "nope"}')).toEqual([]);
    expect(parsePromises('前言 {"promises":[{"quote":"我先醒","id":3}]} 后语')).toEqual([
      { quote: "我先醒", sourceId: 3 },
    ]);
  });

  it("the node text quotes her verbatim inside her frame, dated her way", () => {
    expect(promiseNodeText("我先醒，我先说话", "8月19日"))
      .toBe("我答应过他：「我先醒，我先说话」（8月19日说的）");
  });

  it("the scan material numbers every row so citations can anchor", () => {
    const u = promiseUser(ROWS);
    expect(u).toContain("[3] ");
    expect(u).toContain("[9] 晚安，明天见");
  });
});

describe("the wiring, floored", () => {
  const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");

  it("the scan runs on the daily rhythm, over a persisted cursor, gate before field", () => {
    const at = daemon.indexOf("async function scanForPromises");
    expect(at).toBeGreaterThan(-1);
    const body = daemon.slice(at, at + 3400);
    expect(body).toContain("PROMISE_SCAN_EVERY_MS = 24 * 60 * 60 * 1000");
    expect(body).toContain("last-promise-scan.json");
    expect(body, "the gate must stand between the model and her field").toContain("verbatimGate(parsePromises(raw), rows)");
    expect(body).toContain("field.encodeQuestion({");
    expect(body).toContain("withOther: true");
    // The cursor advances even on a dry day, so old rows are never re-read.
    expect(body).toContain("if (rows.length === 0) { writeCursor(); return; }");
  });

  it("the tick actually calls it", () => {
    expect(daemon.indexOf("await scanForPromises(nowMs)")).toBeGreaterThan(-1);
  });
});
