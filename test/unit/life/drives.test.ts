import { describe, it, expect } from "vitest";
import {
  initialDrives,
  urgency,
  dominant,
  accumulate,
  satiate,
  driveEntropy,
  isPinned,
  DRIVE_NAMES,
  type DriveName,
} from "../../../src/life/drives.js";

describe("drives", () => {
  it("starts with all drives in range", () => {
    for (const v of Object.values(initialDrives())) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("steep (survival) drives outrank shallow ones at the same level", () => {
    expect(urgency("discomfort", 0.3)).toBeGreaterThan(urgency("maintenance", 0.3));
    expect(urgency("care", 0.3)).toBeGreaterThan(urgency("curiosity", 0.3));
  });

  // The whole ordering, pinned. Six steepness numbers quietly encode what matters more than what
  // when everything is equally strong, and that is a claim about her, not a tuning detail. Spot
  // checks let it drift; this makes a reordering an explicit decision someone has to make.
  it("has ONE stated priority order, and it is this one", () => {
    const order: DriveName[] = ["discomfort", "care", "social", "curiosity", "expression", "maintenance"];
    const atSameLevel = order.map((d) => urgency(d, 0.3));
    console.log(`\n  at equal strength: ${order.map((d, i) => `${d} ${atSameLevel[i].toFixed(3)}`).join(" > ")}`);
    for (let i = 1; i < order.length; i++) {
      expect(atSameLevel[i - 1], `${order[i - 1]} must outrank ${order[i]}`).toBeGreaterThan(atSameLevel[i]);
    }
    // Something being wrong still leads, and caring about someone sits between that and wanting
    // company for her own sake. Concern is not loneliness and should not be ranked as it.
    expect(order.indexOf("care")).toBe(1);
    expect(order.indexOf("care")).toBeLessThan(order.indexOf("social"));
  });

  it("dominant picks the most urgent drive", () => {
    const d = { ...initialDrives(), curiosity: 0.9, maintenance: 0.2 };
    expect(dominant(d)).toBe("curiosity");
  });

  it("dominant skips a drive in refractory", () => {
    const d = { ...initialDrives(), discomfort: 0.9, curiosity: 0.5 };
    expect(dominant(d)).toBe("discomfort");
    expect(dominant(d, new Set(["discomfort"]))).not.toBe("discomfort");
  });

  it("accumulates with momentum across steps", () => {
    const s1 = accumulate(initialDrives(), { curiosity: 0.3 });
    const s2 = accumulate(s1, { curiosity: 0.3 });
    expect(s2.curiosity).toBeGreaterThan(s1.curiosity);
  });

  it("satiate discharges the acted drive", () => {
    const d = { ...initialDrives(), curiosity: 0.8 };
    expect(satiate(d, "curiosity").curiosity).toBeLessThan(0.8);
  });

  it("entropy is ~1 for a uniform history and ~0 for a single-drive history", () => {
    expect(driveEntropy([...DRIVE_NAMES])).toBeCloseTo(1, 1);
    expect(driveEntropy(["curiosity", "curiosity", "curiosity", "curiosity"])).toBeCloseTo(0, 5);
  });

  it("isPinned flags one drive dominating recent actions", () => {
    expect(isPinned(["curiosity", "curiosity", "curiosity", "social"])).toBe(true);
    expect(isPinned(["curiosity", "social", "maintenance", "expression"])).toBe(false);
  });
});
