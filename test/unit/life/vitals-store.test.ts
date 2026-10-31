import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVitalsStore } from "../../../src/life/vitals-store.js";
import type { VitalsSnapshot } from "../../../src/life/vitals.js";

let dir: string;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

function snap(ts: number): VitalsSnapshot {
  return {
    ts, phase: "normal", remainingFraction: 0.6, spentVigor: 100, capVigor: 300, topAccount: "work",
    drives: { discomfort: 0.1, care: 0.3, social: 0.3, curiosity: 0.5, expression: 0.2, maintenance: 0.3 },
    dominant: "curiosity", pad: { pleasure: 0.2, arousal: 0.1, dominance: 0.1 }, mood: "steady",
    tierCeiling: "tier3", mayExplore: true, awake: true, clockActivity: 0.8, hoursSinceUser: 2,
    sendsInLastDay: 0, consecutiveNonReplies: 0, reservoirSize: 0,
    soulInvariants: [{ id: 1, name: "inv1", ok: true, detail: "" }], lastTickAgeMs: 1000,
  };
}

describe("vitals store", () => {
  it("appends to the log and returns the recent ring", () => {
    dir = mkdtempSync(join(tmpdir(), "vitals-"));
    const path = join(dir, "vitals.jsonl");
    const store = createVitalsStore(path, 100);
    store.append(snap(1));
    store.append(snap(2));
    store.append(snap(3));
    expect(store.recent(2).map((s) => s.ts)).toEqual([2, 3]);
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(3);
  });

  it("bounds the ring while the log keeps everything", () => {
    dir = mkdtempSync(join(tmpdir(), "vitals-"));
    const path = join(dir, "vitals.jsonl");
    const store = createVitalsStore(path, 3);
    for (let i = 0; i < 10; i++) store.append(snap(i));
    expect(store.size()).toBe(3);
    expect(store.recent(10).map((s) => s.ts)).toEqual([7, 8, 9]);
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(10); // durable log is complete
  });

  it("warm-loads the tail of the log on restart", () => {
    dir = mkdtempSync(join(tmpdir(), "vitals-"));
    const path = join(dir, "vitals.jsonl");
    const first = createVitalsStore(path, 100);
    for (let i = 0; i < 5; i++) first.append(snap(i));
    const restarted = createVitalsStore(path, 100);
    expect(restarted.size()).toBe(5);
    expect(restarted.recent(2).map((s) => s.ts)).toEqual([3, 4]);
  });
});
