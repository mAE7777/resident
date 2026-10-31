import { describe, it, expect } from "vitest";
import { createFloodControl } from "../../../src/telegram/flood.js";

describe("createFloodControl — basic state", () => {
  it("starts with shouldEdit=true and baseInterval", () => {
    const fc = createFloodControl(1000);
    expect(fc.shouldEdit()).toBe(true);
    expect(fc.getCurrentInterval()).toBe(1000);
  });

  it("uses 1000ms as the default base interval", () => {
    const fc = createFloodControl();
    expect(fc.getCurrentInterval()).toBe(1000);
  });
});

describe("createFloodControl — failure progression", () => {
  it("1st failure doubles the interval (1000 → 2000)", () => {
    const fc = createFloodControl(1000);
    fc.onEditFailure();
    expect(fc.getCurrentInterval()).toBe(2000);
    expect(fc.shouldEdit()).toBe(true);
  });

  it("2nd consecutive failure doubles again (2000 → 4000)", () => {
    const fc = createFloodControl(1000);
    fc.onEditFailure();
    fc.onEditFailure();
    expect(fc.getCurrentInterval()).toBe(4000);
    expect(fc.shouldEdit()).toBe(true);
  });

  it("3rd consecutive failure disables live editing", () => {
    const fc = createFloodControl(1000);
    fc.onEditFailure();
    fc.onEditFailure();
    fc.onEditFailure();
    expect(fc.shouldEdit()).toBe(false);
  });

  it("interval does not double on the 3rd failure (editing disabled instead)", () => {
    const fc = createFloodControl(1000);
    fc.onEditFailure(); // → 2000
    fc.onEditFailure(); // → 4000
    const intervalBefore3rd = fc.getCurrentInterval();
    fc.onEditFailure(); // disable, no further doubling
    expect(fc.getCurrentInterval()).toBe(intervalBefore3rd);
  });

  it("4th failure keeps editing disabled", () => {
    const fc = createFloodControl(1000);
    fc.onEditFailure();
    fc.onEditFailure();
    fc.onEditFailure();
    fc.onEditFailure();
    expect(fc.shouldEdit()).toBe(false);
  });
});

describe("createFloodControl — success resets", () => {
  it("success after failures resets interval to base", () => {
    const fc = createFloodControl(1000);
    fc.onEditFailure();
    fc.onEditFailure();
    fc.onEditSuccess();
    expect(fc.getCurrentInterval()).toBe(1000);
  });

  it("success after 3 failures resets interval but does NOT re-enable editing (only resetForNewTurn does)", () => {
    // Hermes ref: onEditSuccess resets counter to 0 but does not clear _editing_disabled.
    // Editing stays disabled until the next turn begins.
    const fc = createFloodControl(1000);
    fc.onEditFailure();
    fc.onEditFailure();
    fc.onEditFailure();
    expect(fc.shouldEdit()).toBe(false);
    fc.onEditSuccess();
    // Editing is still disabled: must call resetForNewTurn to re-enable.
    expect(fc.shouldEdit()).toBe(false);
    fc.resetForNewTurn();
    expect(fc.shouldEdit()).toBe(true);
    expect(fc.getCurrentInterval()).toBe(1000);
  });

  it("success on clean state keeps interval at base", () => {
    const fc = createFloodControl(500);
    fc.onEditSuccess();
    expect(fc.getCurrentInterval()).toBe(500);
    expect(fc.shouldEdit()).toBe(true);
  });
});

describe("createFloodControl — resetForNewTurn", () => {
  it("resets all state including disabled flag", () => {
    const fc = createFloodControl(1000);
    fc.onEditFailure();
    fc.onEditFailure();
    fc.onEditFailure();
    expect(fc.shouldEdit()).toBe(false);
    fc.resetForNewTurn();
    expect(fc.shouldEdit()).toBe(true);
    expect(fc.getCurrentInterval()).toBe(1000);
  });

  it("after reset, failure progression starts fresh", () => {
    const fc = createFloodControl(1000);
    fc.onEditFailure();
    fc.onEditFailure();
    fc.onEditFailure();
    fc.resetForNewTurn();
    fc.onEditFailure();
    expect(fc.getCurrentInterval()).toBe(2000);
    expect(fc.shouldEdit()).toBe(true);
  });

  it("reset on clean state is a no-op", () => {
    const fc = createFloodControl(1000);
    fc.resetForNewTurn();
    expect(fc.shouldEdit()).toBe(true);
    expect(fc.getCurrentInterval()).toBe(1000);
  });
});
