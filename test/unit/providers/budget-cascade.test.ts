import { describe, it, expect } from "vitest";
import {
  createBudgetEnvelope,
  DEFAULT_TASK_BUDGET,
  DEFAULT_SESSION_BUDGET,
  DEFAULT_DAY_BUDGET,
  CACHE_READ_DISCOUNT,
  CACHE_WRITE_MULTIPLIER,
} from "../../../src/providers/budget-cascade.js";

// ── AC1: remainingBudget() returns task-level minimum ─────────────────────────

describe("AC1 — remainingBudget() returns task-level minimum", () => {
  it("returns remaining task budget when task is the binding constraint", () => {
    // task $1.00, session $5.00
    const env = createBudgetEnvelope({ taskBudget: 1.0, sessionBudget: 5.0, dayBudget: 100.0 });
    env.recordSpend(0.80);
    // remaining task = 0.20, remaining session = 4.20 → min is 0.20
    expect(env.remainingBudget()).toBeCloseTo(0.20, 10);
  });

  it("remainingBudget() returns Math.min across all three levels", () => {
    const env = createBudgetEnvelope({ taskBudget: 1.0, sessionBudget: 2.0, dayBudget: 3.0 });
    env.recordSpend(0.5);
    // remaining: task=0.5, session=1.5, day=2.5 → min is 0.5
    expect(env.remainingBudget()).toBeCloseTo(0.5, 10);
  });

  it("session becomes binding when session is lower", () => {
    const env = createBudgetEnvelope({ taskBudget: 10.0, sessionBudget: 0.3, dayBudget: 100.0 });
    env.recordSpend(0.2);
    // remaining: task=9.8, session=0.1, day=99.8 → min is 0.1
    expect(env.remainingBudget()).toBeCloseTo(0.1, 10);
  });

  it("never returns negative", () => {
    const env = createBudgetEnvelope({ taskBudget: 1.0, sessionBudget: 5.0, dayBudget: 100.0 });
    env.recordSpend(2.0); // overspend
    expect(env.remainingBudget()).toBe(0);
  });
});

// ── AC2: task budget exhausted → cost guard rejects ───────────────────────────

describe("AC2 — task budget exhausted triggers rejection", () => {
  it("checkBudget returns allowed=false when task is exhausted", () => {
    const env = createBudgetEnvelope({ taskBudget: 1.0, sessionBudget: 5.0, dayBudget: 100.0 });
    env.recordSpend(1.0);
    const result = env.checkBudget(0.01);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Task budget exhausted/);
  });

  it("checkBudget reason contains 'Task budget exhausted' when task level blocks", () => {
    const env = createBudgetEnvelope({ taskBudget: 0.5, sessionBudget: 5.0, dayBudget: 100.0 });
    env.recordSpend(0.5);
    const result = env.checkBudget(0.001);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Task budget exhausted/);
  });

  it("allows calls when budget is not exhausted", () => {
    const env = createBudgetEnvelope({ taskBudget: 1.0, sessionBudget: 5.0, dayBudget: 100.0 });
    env.recordSpend(0.5);
    const result = env.checkBudget(0.3);
    expect(result.allowed).toBe(true);
  });

  it("getStatus.remainingTask reaches 0 when task budget consumed", () => {
    const env = createBudgetEnvelope({ taskBudget: 1.0, sessionBudget: 5.0, dayBudget: 100.0 });
    env.recordSpend(1.0);
    const status = env.getStatus();
    expect(status.remainingTask).toBe(0);
  });
});

// ── AC3: fork() creates child with ceiling = min(childTaskBudget, parent remaining) ──

describe("AC3 — fork() creates child BudgetEnvelope with correct ceiling", () => {
  it("fork() passes parent remaining as child ceiling when no childTaskBudget given", () => {
    const parent = createBudgetEnvelope({ taskBudget: 2.0, sessionBudget: 10.0, dayBudget: 50.0 });
    const child = parent.fork();
    // Parent remaining = min(2.0, 10.0, 50.0) = 2.0
    expect(child.remainingBudget()).toBeCloseTo(2.0, 10);
  });

  it("fork() with childTaskBudget uses min(childTaskBudget, parent remaining)", () => {
    const parent = createBudgetEnvelope({ taskBudget: 2.0, sessionBudget: 10.0, dayBudget: 50.0 });
    // parent remaining = 2.0, childTaskBudget = 1.5 → child ceiling = 1.5
    const child = parent.fork(1.5);
    expect(child.remainingBudget()).toBeCloseTo(1.5, 10);
  });

  it("fork() does not give child more than parent has remaining", () => {
    const parent = createBudgetEnvelope({ taskBudget: 2.0, sessionBudget: 10.0, dayBudget: 50.0 });
    parent.recordSpend(1.5); // parent remaining = 0.5
    // childTaskBudget=5.0 but parent only has 0.5 → child ceiling = 0.5
    const child = parent.fork(5.0);
    expect(child.remainingBudget()).toBeCloseTo(0.5, 10);
  });

  it("child envelope is independent — spending in child does not affect parent", () => {
    const parent = createBudgetEnvelope({ taskBudget: 2.0, sessionBudget: 10.0, dayBudget: 50.0 });
    const child = parent.fork(1.0);
    child.recordSpend(0.5);
    // Parent should still have its original remaining
    expect(parent.remainingBudget()).toBeCloseTo(2.0, 10);
  });

  it("AC3 from spec: parent $2.00 remaining → child gets $2.00 ceiling", () => {
    const parent = createBudgetEnvelope({ taskBudget: 2.0, sessionBudget: 5.0, dayBudget: 50.0 });
    const child = parent.fork();
    // parent remaining = min(2.0, 5.0, 50.0) = 2.0
    expect(child.remainingBudget()).toBeCloseTo(2.0, 10);
  });
});

// ── AC4: cache-aware pricing ──────────────────────────────────────────────────

describe("AC4 — cache-aware pricing applies cache_read_discount", () => {
  it("uncached tokens cost inputRate * tokens", () => {
    const env = createBudgetEnvelope({ taskBudget: 10.0, sessionBudget: 50.0, dayBudget: 200.0 });
    // 1M uncached input tokens at default rate $3/Mtok = $0.000003/tok → 1M tokens = $3
    // But we use per-token rate so: 1_000_000 * (3/1_000_000) = 3 dollars
    const cost = env.recordCacheAwareSpend({
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      inputRatePerToken: 3 / 1_000_000,
      outputRatePerToken: 15 / 1_000_000,
    });
    expect(cost).toBeCloseTo(3.0, 6);
  });

  it("cache reads cost inputRate / cache_read_discount", () => {
    const env = createBudgetEnvelope({ taskBudget: 100.0, sessionBudget: 500.0, dayBudget: 2000.0 });
    // 1M cache read tokens at inputRate $3/Mtok with discount 10 → $0.30
    const cost = env.recordCacheAwareSpend({
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
      inputRatePerToken: 3 / 1_000_000,
      outputRatePerToken: 15 / 1_000_000,
      cacheReadDiscount: CACHE_READ_DISCOUNT,
    });
    // uncachedInput = 1M - 1M = 0 → no base cost
    // cacheReadCost = (3/1M) * 1M / 10 = 0.30
    expect(cost).toBeCloseTo(0.30, 6);
  });

  it("cache writes cost inputRate * cacheWriteMultiplier", () => {
    const env = createBudgetEnvelope({ taskBudget: 100.0, sessionBudget: 500.0, dayBudget: 2000.0 });
    // 1M cache write tokens at inputRate $3/Mtok with multiplier 1.25 → $3.75
    const cost = env.recordCacheAwareSpend({
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 1_000_000,
      inputRatePerToken: 3 / 1_000_000,
      outputRatePerToken: 15 / 1_000_000,
      cacheWriteMultiplier: CACHE_WRITE_MULTIPLIER,
    });
    // uncachedInput = 1M - 1M = 0
    // cacheWriteCost = (3/1M) * 1M * 1.25 = 3.75
    expect(cost).toBeCloseTo(3.75, 6);
  });

  it("full formula: uncached + cache_read + cache_write + output", () => {
    const env = createBudgetEnvelope({ taskBudget: 100.0, sessionBudget: 500.0, dayBudget: 2000.0 });
    const inputRate = 3 / 1_000_000;
    const outputRate = 15 / 1_000_000;
    // 2M input total: 500k cache reads, 500k cache writes, 1M uncached
    const cost = env.recordCacheAwareSpend({
      inputTokens: 2_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 500_000,
      cacheWriteTokens: 500_000,
      inputRatePerToken: inputRate,
      outputRatePerToken: outputRate,
      cacheReadDiscount: CACHE_READ_DISCOUNT,
      cacheWriteMultiplier: CACHE_WRITE_MULTIPLIER,
    });
    const expectedUncached = inputRate * 1_000_000;          // $3.00
    const expectedRead = inputRate * 500_000 / CACHE_READ_DISCOUNT; // $0.15
    const expectedWrite = inputRate * 500_000 * CACHE_WRITE_MULTIPLIER; // $1.875
    const expectedOutput = outputRate * 1_000_000;            // $15.00
    const expected = expectedUncached + expectedRead + expectedWrite + expectedOutput;
    expect(cost).toBeCloseTo(expected, 6);
  });

  it("recordCacheAwareSpend deducts cost from all three levels", () => {
    const env = createBudgetEnvelope({ taskBudget: 10.0, sessionBudget: 10.0, dayBudget: 10.0 });
    env.recordCacheAwareSpend({
      inputTokens: 1_000_000,
      outputTokens: 0,
      inputRatePerToken: 3 / 1_000_000,
      outputRatePerToken: 15 / 1_000_000,
    });
    const status = env.getStatus();
    expect(status.taskSpent).toBeCloseTo(3.0, 6);
    expect(status.sessionSpent).toBeCloseTo(3.0, 6);
    expect(status.daySpent).toBeCloseTo(3.0, 6);
  });
});

// ── startNewTask / startNewSession ────────────────────────────────────────────

describe("startNewTask / startNewSession lifecycle", () => {
  it("startNewTask resets taskSpent to 0", () => {
    const env = createBudgetEnvelope({ taskBudget: 1.0, sessionBudget: 5.0, dayBudget: 50.0 });
    env.recordSpend(0.8);
    env.startNewTask();
    const status = env.getStatus();
    expect(status.taskSpent).toBe(0);
    expect(status.sessionSpent).toBeCloseTo(0.8, 10); // session not reset
  });

  it("startNewSession resets both task and session spent", () => {
    const env = createBudgetEnvelope({ taskBudget: 1.0, sessionBudget: 5.0, dayBudget: 50.0 });
    env.recordSpend(0.8);
    env.startNewSession();
    const status = env.getStatus();
    expect(status.taskSpent).toBe(0);
    expect(status.sessionSpent).toBe(0);
    expect(status.daySpent).toBeCloseTo(0.8, 10); // day not reset
  });
});

// ── Constants ─────────────────────────────────────────────────────────────────

describe("exported constants", () => {
  it("DEFAULT_TASK_BUDGET is 2.0", () => expect(DEFAULT_TASK_BUDGET).toBe(2.0));
  it("DEFAULT_SESSION_BUDGET is 20.0", () => expect(DEFAULT_SESSION_BUDGET).toBe(20.0));
  it("DEFAULT_DAY_BUDGET is 50.0", () => expect(DEFAULT_DAY_BUDGET).toBe(50.0));
  it("CACHE_READ_DISCOUNT is 10", () => expect(CACHE_READ_DISCOUNT).toBe(10.0));
  it("CACHE_WRITE_MULTIPLIER is 1.25", () => expect(CACHE_WRITE_MULTIPLIER).toBe(1.25));
});

// ── getStatus ─────────────────────────────────────────────────────────────────

describe("getStatus()", () => {
  it("returns all six counters and budgets", () => {
    const env = createBudgetEnvelope({ taskBudget: 1.0, sessionBudget: 5.0, dayBudget: 50.0 });
    env.recordSpend(0.3);
    const s = env.getStatus();
    expect(s.taskBudget).toBe(1.0);
    expect(s.sessionBudget).toBe(5.0);
    expect(s.dayBudget).toBe(50.0);
    expect(s.taskSpent).toBeCloseTo(0.3, 10);
    expect(s.sessionSpent).toBeCloseTo(0.3, 10);
    expect(s.daySpent).toBeCloseTo(0.3, 10);
    expect(s.remainingTask).toBeCloseTo(0.7, 10);
    expect(s.remainingSession).toBeCloseTo(4.7, 10);
    expect(s.remainingDay).toBeCloseTo(49.7, 10);
  });
});
