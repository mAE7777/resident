import { describe, it, expect } from "vitest";
import { classify, describeDecision, type OperationProperties } from "../../../src/security/rule-of-two.js";

// ---------------------------------------------------------------------------
// classify(), all 8 combinations of (isUntrusted, isSensitive, isStateChange)
// ---------------------------------------------------------------------------

describe("rule-of-two — classify() all 8 combinations", () => {
  // All three true → block
  it("AC: isUntrusted=true, isSensitive=true, isStateChange=true → block", () => {
    const result = classify({ isUntrusted: true, isSensitive: true, isStateChange: true });
    expect(result.decision).toBe("block");
  });

  // Two of three: sensitive + stateChange → confirm (even if untrusted=false)
  it("AC: isUntrusted=false, isSensitive=true, isStateChange=true → confirm", () => {
    const result = classify({ isUntrusted: false, isSensitive: true, isStateChange: true });
    expect(result.decision).toBe("confirm");
  });

  // Two of three: untrusted + sensitive → auto
  it("AC: isUntrusted=true, isSensitive=true, isStateChange=false → auto", () => {
    const result = classify({ isUntrusted: true, isSensitive: true, isStateChange: false });
    expect(result.decision).toBe("auto");
  });

  // Two of three: untrusted + stateChange → auto
  it("isUntrusted=true, isSensitive=false, isStateChange=true → auto", () => {
    const result = classify({ isUntrusted: true, isSensitive: false, isStateChange: true });
    expect(result.decision).toBe("auto");
  });

  // One: untrusted only → auto
  it("isUntrusted=true, isSensitive=false, isStateChange=false → auto", () => {
    const result = classify({ isUntrusted: true, isSensitive: false, isStateChange: false });
    expect(result.decision).toBe("auto");
  });

  // One: sensitive only → auto
  it("isUntrusted=false, isSensitive=true, isStateChange=false → auto", () => {
    const result = classify({ isUntrusted: false, isSensitive: true, isStateChange: false });
    expect(result.decision).toBe("auto");
  });

  // One: stateChange only → auto
  it("isUntrusted=false, isSensitive=false, isStateChange=true → auto", () => {
    const result = classify({ isUntrusted: false, isSensitive: false, isStateChange: true });
    expect(result.decision).toBe("auto");
  });

  // None → auto
  it("isUntrusted=false, isSensitive=false, isStateChange=false → auto", () => {
    const result = classify({ isUntrusted: false, isSensitive: false, isStateChange: false });
    expect(result.decision).toBe("auto");
  });
});

// ---------------------------------------------------------------------------
// classify(), result shape
// ---------------------------------------------------------------------------

describe("rule-of-two — classify() result shape", () => {
  it("result includes properties tuple matching input flags", () => {
    const op: OperationProperties = { isUntrusted: true, isSensitive: false, isStateChange: true };
    const result = classify(op);
    expect(result.properties).toEqual([true, false, true, true]);
  });

  it("blocked result includes a reason string", () => {
    const result = classify({ isUntrusted: true, isSensitive: true, isStateChange: true });
    expect(typeof result.reason).toBe("string");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("confirm result includes a reason string", () => {
    const result = classify({ isUntrusted: false, isSensitive: true, isStateChange: true });
    expect(typeof result.reason).toBe("string");
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// describeDecision(), AC: blocked operation
// ---------------------------------------------------------------------------

describe("rule-of-two — describeDecision()", () => {
  it("AC: blocked operation → description mentions block and risk flags", () => {
    const result = classify({ isUntrusted: true, isSensitive: true, isStateChange: true });
    const description = describeDecision(result);
    expect(description).toContain("block");
    expect(description).toContain("untrusted");
    expect(description).toContain("sensitive");
    expect(description).toContain("state-change");
  });

  it("confirm operation → description mentions confirm", () => {
    const result = classify({ isUntrusted: false, isSensitive: true, isStateChange: true });
    const description = describeDecision(result);
    expect(description).toContain("confirm");
  });

  it("auto operation → description mentions auto", () => {
    const result = classify({ isUntrusted: true, isSensitive: false, isStateChange: false });
    const description = describeDecision(result);
    expect(description).toContain("auto");
  });

  it("no-risk operation → flags show none", () => {
    const result = classify({ isUntrusted: false, isSensitive: false, isStateChange: false });
    const description = describeDecision(result);
    expect(description).toContain("none");
  });

  it("returns a string", () => {
    const result = classify({ isUntrusted: true, isSensitive: true, isStateChange: true });
    expect(typeof describeDecision(result)).toBe("string");
  });
});
