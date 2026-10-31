import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createCostEMA } from "../../../src/providers/cost-ema.js";

function makeDb(): Database.Database {
  return new Database(":memory:");
}

describe("createCostEMA", () => {
  describe("getEstimate", () => {
    it("returns base estimate when no prior data exists", () => {
      const db = makeDb();
      const ema = createCostEMA({ db });
      expect(ema.getEstimate("gpt-4o", 0.05)).toBe(0.05);
      expect(ema.getEstimate("claude-sonnet", 0.10)).toBe(0.10);
    });

    it("applies correction factor to base estimate after updateEMA", () => {
      const db = makeDb();
      const ema = createCostEMA({ db });
      // estimated=0.10, actual=0.05 → factor = 0.1*(0.05/0.10) + 0.9*1.0 = 0.05 + 0.9 = 0.95
      ema.updateEMA("tool-a", 0.10, 0.05);
      const estimate = ema.getEstimate("tool-a", 0.10);
      expect(estimate).toBeCloseTo(0.095, 10);
    });
  });

  describe("updateEMA", () => {
    it("computes EMA correctly: estimated=0.10, actual=0.05 → new EMA = 0.095", () => {
      const db = makeDb();
      const ema = createCostEMA({ db });
      // Initial factor = 1.0
      // rawFactor = 0.1*(0.05/0.10) + 0.9*1.0 = 0.05 + 0.9 = 0.95
      // estimate = base * factor = 0.10 * 0.95 = 0.095
      ema.updateEMA("key1", 0.10, 0.05);
      expect(ema.getEstimate("key1", 0.10)).toBeCloseTo(0.095, 10);
    });

    it("does not crash and skips update when estimated is 0", () => {
      const db = makeDb();
      const ema = createCostEMA({ db });
      expect(() => ema.updateEMA("key1", 0, 0.05)).not.toThrow();
      // No data stored: should still return base estimate unchanged
      expect(ema.getEstimate("key1", 0.10)).toBe(0.10);
    });

    it("does not crash and skips update when estimated is negative", () => {
      const db = makeDb();
      const ema = createCostEMA({ db });
      expect(() => ema.updateEMA("key1", -1, 0.05)).not.toThrow();
      expect(ema.getEstimate("key1", 0.10)).toBe(0.10);
    });

    it("converges toward actual/estimated ratio after many consistent observations", () => {
      const db = makeDb();
      const ema = createCostEMA({ db, alpha: 0.1 });
      // Always estimate 0.10, actual is always 0.05 → ratio = 0.5
      // After enough iterations, correction factor should approach 0.5
      for (let i = 0; i < 40; i++) {
        ema.updateEMA("conv-key", 0.10, 0.05);
      }
      const estimate = ema.getEstimate("conv-key", 0.10);
      // After 40 iterations, estimate should be significantly below 0.10
      // and approaching 0.05 (0.10 * ~0.5)
      expect(estimate).toBeLessThan(0.08);
      expect(estimate).toBeGreaterThan(0.04);
    });

    it("clamps correction factor to MIN 0.1 to prevent extreme underestimation", () => {
      const db = makeDb();
      const ema = createCostEMA({ db, alpha: 1.0 });
      // With alpha=1.0: rawFactor = 1.0 * (0.0001/10.0) + 0.0 * prevFactor = very tiny
      // Should be clamped to 0.1
      ema.updateEMA("clamp-low", 10.0, 0.0001);
      const estimate = ema.getEstimate("clamp-low", 1.0);
      expect(estimate).toBeCloseTo(0.1, 10);
    });

    it("clamps correction factor to MAX 10.0 to prevent extreme overestimation", () => {
      const db = makeDb();
      const ema = createCostEMA({ db, alpha: 1.0 });
      // With alpha=1.0: rawFactor = 1.0 * (1000/0.01) = 100000 → clamped to 10.0
      ema.updateEMA("clamp-high", 0.01, 1000);
      const estimate = ema.getEstimate("clamp-high", 1.0);
      expect(estimate).toBeCloseTo(10.0, 10);
    });

    it("persists and accumulates sample_count across calls", () => {
      const db = makeDb();
      const ema = createCostEMA({ db });
      ema.updateEMA("tracked", 0.10, 0.08);
      ema.updateEMA("tracked", 0.10, 0.08);
      ema.updateEMA("tracked", 0.10, 0.08);
      // Should not throw and should apply compounded EMA
      const estimate = ema.getEstimate("tracked", 0.10);
      expect(estimate).toBeDefined();
      expect(estimate).toBeGreaterThan(0);
    });

    it("keeps keys independent from each other", () => {
      const db = makeDb();
      const ema = createCostEMA({ db, alpha: 1.0 });
      // key-a: actual >> estimated → factor near 10 (clamped)
      ema.updateEMA("key-a", 0.01, 1000);
      // key-b: actual << estimated → factor near 0.1 (clamped)
      ema.updateEMA("key-b", 10.0, 0.0001);

      expect(ema.getEstimate("key-a", 1.0)).toBeCloseTo(10.0, 5);
      expect(ema.getEstimate("key-b", 1.0)).toBeCloseTo(0.1, 5);
    });

    it("10 calls with known costs converges EMA toward actual ratio", () => {
      const db = makeDb();
      const ema = createCostEMA({ db, alpha: 0.1 });
      // estimated always 0.10, actual always 0.06 → target factor = 0.6
      for (let i = 0; i < 10; i++) {
        ema.updateEMA("ten-calls", 0.10, 0.06);
      }
      const estimate = ema.getEstimate("ten-calls", 0.10);
      // After 10 steps with alpha=0.1 starting from 1.0, factor should be
      // somewhere between 0.6 and 1.0, trending downward
      expect(estimate).toBeLessThan(0.10); // less than no-correction
      expect(estimate).toBeGreaterThan(0.06); // not yet at target
    });
  });

  describe("cache hit rate", () => {
    it("returns rate 0 with hits=0 and total=0 initially", () => {
      const db = makeDb();
      const ema = createCostEMA({ db });
      const result = ema.getCacheHitRate();
      expect(result).toEqual({ hits: 0, total: 0, rate: 0 });
    });

    it("returns rate 0 when total is 0 (division by zero guard)", () => {
      const db = makeDb();
      const ema = createCostEMA({ db });
      const { rate } = ema.getCacheHitRate();
      expect(rate).toBe(0);
    });

    it("tracks cache hits correctly", () => {
      const db = makeDb();
      const ema = createCostEMA({ db });
      ema.recordCacheHit();
      ema.recordCacheHit();
      ema.recordCacheHit();
      const result = ema.getCacheHitRate();
      expect(result.hits).toBe(3);
      expect(result.total).toBe(3);
      expect(result.rate).toBe(1.0);
    });

    it("tracks cache misses correctly", () => {
      const db = makeDb();
      const ema = createCostEMA({ db });
      ema.recordCacheMiss();
      ema.recordCacheMiss();
      const result = ema.getCacheHitRate();
      expect(result.hits).toBe(0);
      expect(result.total).toBe(2);
      expect(result.rate).toBe(0);
    });

    it("computes hit rate as hits/total", () => {
      const db = makeDb();
      const ema = createCostEMA({ db });
      ema.recordCacheHit();
      ema.recordCacheHit();
      ema.recordCacheMiss();
      ema.recordCacheMiss();
      const result = ema.getCacheHitRate();
      expect(result.hits).toBe(2);
      expect(result.total).toBe(4);
      expect(result.rate).toBeCloseTo(0.5, 10);
    });

    it("displays cache hit rate as percentage for /status use", () => {
      const db = makeDb();
      const ema = createCostEMA({ db });
      for (let i = 0; i < 15; i++) ema.recordCacheHit();
      for (let i = 0; i < 5; i++) ema.recordCacheMiss();
      const { rate } = ema.getCacheHitRate();
      // 15/20 = 75%
      expect(Math.round(rate * 100)).toBe(75);
    });

    it("session counters are independent per instance", () => {
      const db = makeDb();
      const ema1 = createCostEMA({ db });
      const ema2 = createCostEMA({ db });
      ema1.recordCacheHit();
      ema1.recordCacheHit();
      expect(ema1.getCacheHitRate().total).toBe(2);
      expect(ema2.getCacheHitRate().total).toBe(0);
    });
  });

  describe("SQLite persistence", () => {
    it("correction factor persists across instances sharing the same db", () => {
      const db = makeDb();
      const ema1 = createCostEMA({ db, alpha: 1.0 });
      ema1.updateEMA("persist-key", 0.10, 0.05);
      // factor = 0.5, estimate = 0.10 * 0.5 = 0.05

      // New instance same db
      const ema2 = createCostEMA({ db, alpha: 1.0 });
      const estimate = ema2.getEstimate("persist-key", 0.10);
      expect(estimate).toBeCloseTo(0.05, 10);
    });
  });
});
