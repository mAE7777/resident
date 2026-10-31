import { describe, it, expect } from "vitest";
import { createClock, mulberry32, weibullSample } from "../../../src/life/clock.js";

const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;
// A day boundary at tz=0 so localHour(DAY0 + h*HOUR_MS) === h.
const DAY0 = 20000 * DAY_MS;

function at(hour: number, minute = 0): number {
  return DAY0 + hour * HOUR_MS + minute * MIN_MS;
}

describe("biological clock", () => {
  describe("localHour", () => {
    it("maps epoch ms to local hour at tz=0", () => {
      const c = createClock();
      expect(c.localHour(at(0))).toBeCloseTo(0, 6);
      expect(c.localHour(at(15))).toBeCloseTo(15, 6);
      expect(c.localHour(at(23, 30))).toBeCloseTo(23.5, 6);
    });

    it("entrains to a timezone offset", () => {
      const c = createClock({ timezoneOffsetHours: 8 });
      expect(c.localHour(at(0))).toBeCloseTo(8, 6);
      // 20:00 UTC + 8 wraps past midnight to 04:00 local.
      expect(c.localHour(at(20))).toBeCloseTo(4, 6);
    });
  });

  describe("circadian + ultradian", () => {
    it("circadian peaks at the configured peak hour and troughs 12h opposite", () => {
      const c = createClock({ circadianPeakHour: 15 });
      expect(c.circadian(at(15))).toBeCloseTo(1, 6);
      expect(c.circadian(at(3))).toBeCloseTo(-1, 6);
      expect(c.circadian(at(9))).toBeCloseTo(0, 6);
    });

    it("circadian and ultradian both stay within [-1,1]", () => {
      const c = createClock();
      for (let m = 0; m < 24 * 60; m += 7) {
        const t = DAY0 + m * MIN_MS;
        expect(c.circadian(t)).toBeGreaterThanOrEqual(-1);
        expect(c.circadian(t)).toBeLessThanOrEqual(1);
        expect(c.ultradian(t)).toBeGreaterThanOrEqual(-1);
        expect(c.ultradian(t)).toBeLessThanOrEqual(1);
      }
    });

    it("ultradian ripples through a full swing within an hour", () => {
      const c = createClock({ ultradianPeriodMin: 90 });
      // Sweep an hour at fine resolution; a ~90min sine covers a peak and a
      // trough within 60min, so the peak-to-trough swing should be large.
      let min = Infinity;
      let max = -Infinity;
      for (let m = 0; m <= 60; m++) {
        const v = c.ultradian(at(12, m));
        if (v < min) min = v;
        if (v > max) max = v;
      }
      expect(max - min).toBeGreaterThan(1.0);
    });
  });

  describe("activityLevel", () => {
    it("always stays within [0,1] across a full day", () => {
      const c = createClock();
      for (let m = 0; m < 24 * 60; m += 5) {
        const level = c.activityLevel(DAY0 + m * MIN_MS);
        expect(level).toBeGreaterThanOrEqual(0);
        expect(level).toBeLessThanOrEqual(1);
      }
    });

    it("is high at the daytime peak and floored at the nighttime trough", () => {
      const c = createClock();
      const peak = c.activityLevel(at(15));
      const trough = c.activityLevel(at(3));
      expect(peak).toBeGreaterThan(0.7);
      expect(trough).toBeLessThanOrEqual(0.05); // asleep floor
      expect(peak).toBeGreaterThan(trough);
    });
  });

  describe("isAwakeHour", () => {
    it("respects a normal [start,end) window", () => {
      const c = createClock({ activeHours: [8, 23] });
      expect(c.isAwakeHour(at(7, 59))).toBe(false);
      expect(c.isAwakeHour(at(8))).toBe(true);
      expect(c.isAwakeHour(at(22, 30))).toBe(true);
      expect(c.isAwakeHour(at(23))).toBe(false);
    });

    it("handles a window that wraps past midnight", () => {
      const c = createClock({ activeHours: [22, 6] });
      expect(c.isAwakeHour(at(23))).toBe(true);
      expect(c.isAwakeHour(at(5, 30))).toBe(true);
      expect(c.isAwakeHour(at(6))).toBe(false);
      expect(c.isAwakeHour(at(12))).toBe(false);
    });
  });

  describe("intensity (Hawkes self-excitation)", () => {
    it("a recent event raises intensity above the baseline", () => {
      const c = createClock();
      const now = at(15);
      const base = c.intensity(now, []);
      const excited = c.intensity(now, [now - 1 * MIN_MS]);
      expect(excited).toBeGreaterThan(base);
    });

    it("excitation decays back toward baseline over time", () => {
      const c = createClock({ hawkesDecayMin: 20 });
      const eventTime = at(15);
      const soon = c.intensity(eventTime + 1 * MIN_MS, [eventTime]);
      const later = c.intensity(eventTime + 120 * MIN_MS, [eventTime]);
      const base = c.intensity(eventTime + 120 * MIN_MS, []);
      expect(soon).toBeGreaterThan(later);
      expect(later - base).toBeLessThan(soon - c.intensity(eventTime + 1 * MIN_MS, []) + 1e-9);
      expect(later).toBeCloseTo(base, 1); // essentially decayed after 6 time-constants
    });

    it("ignores events in the future", () => {
      const c = createClock();
      const now = at(15);
      expect(c.intensity(now, [now + 10 * MIN_MS])).toBeCloseTo(c.intensity(now, []), 9);
    });
  });

  describe("nextEventDelayMs (NHPP via thinning)", () => {
    it("is deterministic under a seeded RNG and returns a positive finite delay", () => {
      const a = createClock({ rng: mulberry32(42) }).nextEventDelayMs(at(15));
      const b = createClock({ rng: mulberry32(42) }).nextEventDelayMs(at(15));
      expect(a).toBe(b);
      expect(a).toBeGreaterThan(0);
      expect(Number.isFinite(a)).toBe(true);
    });

    it("fires sooner on average at the active peak than at the sleeping trough", () => {
      const N = 300;
      const peakClock = createClock({ rng: mulberry32(7) });
      const troughClock = createClock({ rng: mulberry32(7) });
      let peakSum = 0;
      let troughSum = 0;
      for (let i = 0; i < N; i++) {
        peakSum += peakClock.nextEventDelayMs(at(15));
        troughSum += troughClock.nextEventDelayMs(at(3));
      }
      expect(peakSum / N).toBeLessThan(troughSum / N);
    });

    it("never exceeds the 7-day cap", () => {
      const c = createClock({ rng: mulberry32(1), nhppMaxRatePerHour: 0.0001 });
      const d = c.nextEventDelayMs(at(3));
      expect(d).toBeLessThanOrEqual(7 * DAY_MS);
    });
  });

  describe("samplers", () => {
    it("mulberry32 is deterministic and stays in [0,1)", () => {
      const r1 = mulberry32(123);
      const r2 = mulberry32(123);
      for (let i = 0; i < 100; i++) {
        const v = r1();
        expect(v).toBe(r2());
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });

    it("weibullSample is non-negative and monotonic in u", () => {
      expect(weibullSample(1.5, 1000, 0.1)).toBeLessThan(weibullSample(1.5, 1000, 0.9));
      expect(weibullSample(1.5, 1000, 0)).toBeGreaterThanOrEqual(0);
    });

    it("weibullDelayMs draws from the configured shape/RNG", () => {
      const c = createClock({ rng: mulberry32(9), weibullShape: 1.5 });
      const d = c.weibullDelayMs(30 * MIN_MS);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(d)).toBe(true);
    });
  });
});
