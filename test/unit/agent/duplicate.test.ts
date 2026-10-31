import { describe, it, expect } from "vitest";
import { createDuplicateTracker } from "../../../src/agent/duplicate.js";

const readMissing = [{ name: "read_file", args: { path: "/missing.ts" } }];

describe("createDuplicateTracker — fingerprint cache", () => {
  it("getCacheSize() starts at 0", () => {
    const t = createDuplicateTracker();
    expect(t.getCacheSize()).toBe(0);
  });

  it("getCacheSize() grows as unique calls are checked", () => {
    const t = createDuplicateTracker();
    t.check([{ name: "tool_a", args: {} }], true);
    t.check([{ name: "tool_b", args: {} }], true);
    t.check([{ name: "tool_c", args: {} }], true);
    expect(t.getCacheSize()).toBe(3);
  });

  it("same fingerprint does not grow cache beyond 1 entry for that fingerprint", () => {
    const t = createDuplicateTracker();
    t.check(readMissing, true);
    t.check(readMissing, true);
    t.check(readMissing, true);
    // All same fingerprint: only 1 entry in cache
    expect(t.getCacheSize()).toBe(1);
  });

  it("evicts oldest 10 when cache exceeds MAX_CACHE_SIZE (50)", () => {
    const t = createDuplicateTracker();
    // Add 60 unique fingerprints
    for (let i = 0; i < 60; i++) {
      t.check([{ name: `tool_${i}`, args: { id: i } }], true);
    }
    // After adding the 61st unique fingerprint, cache should have been evicted to 50
    expect(t.getCacheSize()).toBe(50);
  });

  it("eviction does not affect lastFingerprint streak counting", () => {
    const t = createDuplicateTracker();
    // Start a streak with readMissing
    t.check(readMissing, true); // count=1
    t.check(readMissing, true); // count=2

    // Flood 59 unique calls (only 50 fit, so eviction happens)
    for (let i = 0; i < 59; i++) {
      t.check([{ name: `flood_${i}`, args: {} }], false);
    }
    // Now continue the original streak: should continue independently
    // After 59 different-fingerprint calls, streak was reset on the first different one
    // (that is correct existing behavior). This test verifies that eviction itself
    // does not corrupt the streak counter.
    const result = t.check(readMissing, true); // fresh streak, count=1
    expect(result).toBe("ok");
  });
});

describe("createDuplicateTracker", () => {
  // AC4: 3 identical failing calls → 'warn' on 3rd
  it("AC4: returns 'warn' after 3 consecutive identical failing calls", () => {
    const t = createDuplicateTracker();
    expect(t.check(readMissing, true)).toBe("ok");  // 1st
    expect(t.check(readMissing, true)).toBe("ok");  // 2nd
    expect(t.check(readMissing, true)).toBe("warn"); // 3rd
  });

  // AC5: 5 identical failing calls → 'force_text' on 5th (and beyond)
  it("AC5: returns 'force_text' after 5 consecutive identical failing calls", () => {
    const t = createDuplicateTracker();
    t.check(readMissing, true); // 1
    t.check(readMissing, true); // 2
    t.check(readMissing, true); // 3
    t.check(readMissing, true); // 4
    expect(t.check(readMissing, true)).toBe("force_text"); // 5
  });

  it("stays at force_text beyond count 5", () => {
    const t = createDuplicateTracker();
    for (let i = 0; i < 5; i++) t.check(readMissing, true);
    expect(t.check(readMissing, true)).toBe("force_text");
    expect(t.check(readMissing, true)).toBe("force_text");
  });

  it("resets on success (allFailed=false)", () => {
    const t = createDuplicateTracker();
    t.check(readMissing, true);
    t.check(readMissing, true);
    // Successful call resets
    t.check(readMissing, false);
    // Counter restarted: next failures should start from 0
    expect(t.check(readMissing, true)).toBe("ok");
  });

  it("resets on different tool/args", () => {
    const t = createDuplicateTracker();
    t.check(readMissing, true);
    t.check(readMissing, true);
    // Different args: reset
    t.check([{ name: "read_file", args: { path: "/other.ts" } }], true);
    // Counter is 1 now (fresh consecutive run)
    expect(t.check([{ name: "read_file", args: { path: "/other.ts" } }], true)).toBe("ok"); // 2nd
  });

  it("explicit reset() clears state", () => {
    const t = createDuplicateTracker();
    t.check(readMissing, true);
    t.check(readMissing, true);
    t.check(readMissing, true); // warn
    t.reset();
    // Fresh start
    expect(t.check(readMissing, true)).toBe("ok");
  });

  it("returns ok for empty calls array", () => {
    const t = createDuplicateTracker();
    expect(t.check([], true)).toBe("ok");
  });

  it("fingerprint is order-independent within a batch", () => {
    const t = createDuplicateTracker();
    const batchA = [
      { name: "read_file", args: { path: "/a.ts" } },
      { name: "write_file", args: { path: "/b.ts" } },
    ];
    const batchB = [
      { name: "write_file", args: { path: "/b.ts" } },
      { name: "read_file", args: { path: "/a.ts" } },
    ];
    // Both batches should have the same fingerprint
    expect(t.check(batchA, true)).toBe("ok"); // 1
    expect(t.check(batchB, true)).toBe("ok"); // 2 (same fp)
    expect(t.check(batchA, true)).toBe("warn"); // 3 → warn
  });

  it("canonical JSON treats object args with different key order as identical", () => {
    const t = createDuplicateTracker();
    const call1 = [{ name: "tool", args: { b: 2, a: 1 } }];
    const call2 = [{ name: "tool", args: { a: 1, b: 2 } }];
    t.check(call1, true); // 1
    t.check(call2, true); // 2: same canonical fingerprint
    expect(t.check(call1, true)).toBe("warn"); // 3
  });
});
