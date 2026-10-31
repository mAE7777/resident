import { describe, it, expect } from "vitest";
import { createWatchdog } from "../../../src/agent/watchdog.js";

const MIN = 60 * 1_000;

describe("createWatchdog", () => {
  // ── ok status ─────────────────────────────────────────────────────────────

  describe("status: ok", () => {
    it("returns ok when well within the window", () => {
      let t = 0;
      const w = createWatchdog(() => t);
      t = 29 * MIN;
      const result = w.check();
      expect(result.status).toBe("ok");
      expect(result.message).toBeNull();
    });

    it("returns ok at exactly 0 ms elapsed", () => {
      let t = 1_000;
      const w = createWatchdog(() => t);
      const result = w.check();
      expect(result.status).toBe("ok");
    });
  });

  // ── warn status (30 minutes) ───────────────────────────────────────────────

  describe("status: warn (30 min)", () => {
    it("AC1: returns warn at exactly 30 minutes", () => {
      let t = 0;
      const w = createWatchdog(() => t);
      t = 30 * MIN;
      const result = w.check();
      expect(result.status).toBe("warn");
      expect(result.message).toBe(
        "这一轮已经过了半个小时，再过五分钟会停下。"
      );
    });

    it("returns warn at 32 minutes (between warn and force_stop)", () => {
      let t = 0;
      const w = createWatchdog(() => t);
      t = 32 * MIN;
      const result = w.check();
      expect(result.status).toBe("warn");
    });
  });

  // ── force_stop status (35 minutes) ────────────────────────────────────────

  describe("status: force_stop (35 min)", () => {
    it("AC2: returns force_stop at exactly 35 minutes", () => {
      let t = 0;
      const w = createWatchdog(() => t);
      t = 35 * MIN;
      const result = w.check();
      expect(result.status).toBe("force_stop");
      expect(result.message).toBe(
        "Time limit reached (35 minutes)."
      );
    });

    it("returns force_stop at 60 minutes", () => {
      let t = 0;
      const w = createWatchdog(() => t);
      t = 60 * MIN;
      expect(w.check().status).toBe("force_stop");
    });
  });

  // ── reset ─────────────────────────────────────────────────────────────────

  describe("reset()", () => {
    it("resets the start time so elapsed is recalculated from current clock value", () => {
      let t = 0;
      const w = createWatchdog(() => t);
      t = 35 * MIN;
      expect(w.check().status).toBe("force_stop");

      // reset at t=35 min; advance only 1 min after reset
      w.reset();
      t = 36 * MIN;
      expect(w.check().status).toBe("ok");
    });

    it("after reset, 30-min warn fires relative to new start time", () => {
      let t = 0;
      const w = createWatchdog(() => t);
      t = 40 * MIN;
      w.reset(); // start over at t=40
      t = 70 * MIN; // 30 minutes after reset
      expect(w.check().status).toBe("warn");
    });
  });

  // ── default clock ─────────────────────────────────────────────────────────

  describe("default clock", () => {
    it("uses Date.now by default and returns ok immediately", () => {
      const w = createWatchdog();
      expect(w.check().status).toBe("ok");
    });
  });
});
