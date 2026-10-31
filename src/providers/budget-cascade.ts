// Per-task waterfall budget: three-level cascade: task → session → day.
// Factory function pattern. Adapted from budget.ts in the author's earlier Loom project, with
// IronClaw's cache pricing (see THIRD_PARTY_NOTICES.md).

// ── Constants ──────────────────────────────────────────────────────────────────

export const DEFAULT_TASK_BUDGET = 2.0;
export const DEFAULT_SESSION_BUDGET = 20.0;
export const DEFAULT_DAY_BUDGET = 50.0;

// IronClaw cache pricing constants
export const CACHE_READ_DISCOUNT = 10.0;   // Anthropic: cache reads cost input_rate / 10
export const CACHE_WRITE_MULTIPLIER = 1.25; // Anthropic: cache writes cost input_rate * 1.25

// ── Types ──────────────────────────────────────────────────────────────────────

export type BudgetConfig = {
  taskBudget?: number;
  sessionBudget?: number;
  dayBudget?: number;
  /** Ceiling imposed by parent, remainingBudget() will not exceed this. */
  ceiling?: number;
};

export type BudgetCheckResult = {
  allowed: boolean;
  remainingTask: number;
  remainingSession: number;
  remainingDay: number;
  reason?: string;
};

export type BudgetStatus = {
  taskBudget: number;
  sessionBudget: number;
  dayBudget: number;
  taskSpent: number;
  sessionSpent: number;
  daySpent: number;
  remainingTask: number;
  remainingSession: number;
  remainingDay: number;
  ceiling: number | undefined;
};

export type CacheAwareCostParams = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Cost per million input tokens in USD (default: 0.000003 = $3/Mtok). */
  inputRatePerToken?: number;
  /** Cost per million output tokens in USD (default: 0.000015 = $15/Mtok). */
  outputRatePerToken?: number;
  /** Divisor for cache-read cost (default: CACHE_READ_DISCOUNT). */
  cacheReadDiscount?: number;
  /** Multiplier for cache-write cost (default: CACHE_WRITE_MULTIPLIER). */
  cacheWriteMultiplier?: number;
};

export interface BudgetEnvelope {
  checkBudget(estimatedCost: number): BudgetCheckResult;
  recordSpend(actual: number): void;
  recordCacheAwareSpend(params: CacheAwareCostParams): number;
  startNewTask(): void;
  startNewSession(): void;
  remainingBudget(): number;
  fork(childTaskBudget?: number): BudgetEnvelope;
  getStatus(): BudgetStatus;
}

// ── Cache-aware cost formula (ported from IronClaw cost_guard.rs) ──────────────
// uncached_input = input - cache_reads - cache_writes
// cache_read_cost = input_rate * cache_reads / cache_read_discount
// cache_write_cost = input_rate * cache_writes * cache_write_multiplier
// total = input_rate * uncached_input + cache_read_cost + cache_write_cost
//         + output_rate * output_tokens

function computeCacheAwareCost(params: CacheAwareCostParams): number {
  const {
    inputTokens,
    outputTokens,
    cacheReadTokens = 0,
    cacheWriteTokens = 0,
    inputRatePerToken = 3 / 1_000_000,
    outputRatePerToken = 15 / 1_000_000,
    cacheReadDiscount = CACHE_READ_DISCOUNT,
    cacheWriteMultiplier = CACHE_WRITE_MULTIPLIER,
  } = params;

  const effectiveDiscount = cacheReadDiscount <= 0 ? 1 : cacheReadDiscount;
  const cachedTotal = cacheReadTokens + cacheWriteTokens;
  const uncachedInput = Math.max(0, inputTokens - cachedTotal);

  const cacheReadCost = inputRatePerToken * cacheReadTokens / effectiveDiscount;
  const cacheWriteCost = inputRatePerToken * cacheWriteTokens * cacheWriteMultiplier;
  const cost =
    inputRatePerToken * uncachedInput +
    cacheReadCost +
    cacheWriteCost +
    outputRatePerToken * outputTokens;

  return cost;
}

// ── Factory ────────────────────────────────────────────────────────────────────

export function createBudgetEnvelope(config: BudgetConfig = {}): BudgetEnvelope {
  const taskBudget = config.taskBudget ?? DEFAULT_TASK_BUDGET;
  const sessionBudget = config.sessionBudget ?? DEFAULT_SESSION_BUDGET;
  const dayBudget = config.dayBudget ?? DEFAULT_DAY_BUDGET;
  const ceiling = config.ceiling;

  let taskSpent = 0;
  let sessionSpent = 0;
  let daySpent = 0;

  function checkBudget(estimatedCost: number): BudgetCheckResult {
    const remainingDay = dayBudget - daySpent;
    const remainingSession = sessionBudget - sessionSpent;
    const remainingTask = taskBudget - taskSpent;

    if (!Number.isFinite(estimatedCost) || estimatedCost < 0) {
      return {
        allowed: false,
        remainingTask,
        remainingSession,
        remainingDay,
        reason: `invalid cost estimate: ${estimatedCost}`,
      };
    }

    if (estimatedCost > remainingDay) {
      return {
        allowed: false,
        remainingTask,
        remainingSession,
        remainingDay,
        reason: `day budget exhausted: need $${estimatedCost.toFixed(4)}, remaining $${remainingDay.toFixed(4)}`,
      };
    }

    if (estimatedCost > remainingSession) {
      return {
        allowed: false,
        remainingTask,
        remainingSession,
        remainingDay,
        reason: `session budget exhausted: need $${estimatedCost.toFixed(4)}, remaining $${remainingSession.toFixed(4)}`,
      };
    }

    if (estimatedCost > remainingTask) {
      return {
        allowed: false,
        remainingTask,
        remainingSession,
        remainingDay,
        reason: `Task budget exhausted: need $${estimatedCost.toFixed(4)}, remaining $${remainingTask.toFixed(4)}`,
      };
    }

    return { allowed: true, remainingTask, remainingSession, remainingDay };
  }

  function recordSpend(actual: number): void {
    if (!Number.isFinite(actual) || actual < 0) return;
    taskSpent += actual;
    sessionSpent += actual;
    daySpent += actual;
  }

  function recordCacheAwareSpend(params: CacheAwareCostParams): number {
    const cost = computeCacheAwareCost(params);
    recordSpend(cost);
    return cost;
  }

  function startNewTask(): void {
    taskSpent = 0;
  }

  function startNewSession(): void {
    sessionSpent = 0;
    startNewTask();
  }

  function remainingBudget(): number {
    const remainingTask = Math.max(0, taskBudget - taskSpent);
    const remainingSession = Math.max(0, sessionBudget - sessionSpent);
    const remainingDay = Math.max(0, dayBudget - daySpent);
    const levels = [remainingTask, remainingSession, remainingDay];
    if (ceiling !== undefined) levels.push(ceiling);
    return Math.min(...levels);
  }

  function fork(childTaskBudget?: number): BudgetEnvelope {
    const parentRemaining = remainingBudget();
    const childCeiling = childTaskBudget !== undefined
      ? Math.min(childTaskBudget, parentRemaining)
      : parentRemaining;
    return createBudgetEnvelope({
      taskBudget: childCeiling,
      sessionBudget,
      dayBudget,
      ceiling: childCeiling,
    });
  }

  function getStatus(): BudgetStatus {
    return {
      taskBudget,
      sessionBudget,
      dayBudget,
      taskSpent,
      sessionSpent,
      daySpent,
      remainingTask: Math.max(0, taskBudget - taskSpent),
      remainingSession: Math.max(0, sessionBudget - sessionSpent),
      remainingDay: Math.max(0, dayBudget - daySpent),
      ceiling,
    };
  }

  return {
    checkBudget,
    recordSpend,
    recordCacheAwareSpend,
    startNewTask,
    startNewSession,
    remainingBudget,
    fork,
    getStatus,
  };
}
