// Layer 6: Cost guard, checkAllowed() before, recordAction() after.
// Daily budget in cents. Throws CostLimitExceeded if exceeded.
// Daily reset at UTC midnight.

import type { LLMRequest, LLMResponse, ProviderLayer } from "./types.js";
import type { CostEMA } from "./cost-ema.js";
import type { BudgetEnvelope } from "./budget-cascade.js";
import type { Metabolism } from "../life/metabolism.js";

export class CostLimitExceeded extends Error {
  constructor(
    public readonly spentCents: number,
    public readonly budgetCents: number,
    message?: string
  ) {
    super(
      message ??
        `Daily cost limit exceeded: spent ${spentCents} cents of ${budgetCents} cent budget`
    );
    this.name = "CostLimitExceeded";
  }
}

export interface CostGuardLayer extends ProviderLayer {
  getDailySpentCents(): number;
  resetDaily(): void;
}

export interface CostGuardOptions {
  dailyBudgetCents: number;
  // Cost per million tokens, in cents
  inputCentsPerMToken?: number;
  outputCentsPerMToken?: number;
  modelPricingCents?: Record<string, {
    inputCentsPerMToken: number;
    outputCentsPerMToken: number;
  }>;
  // Optional EMA for corrected cost estimates
  costEMA?: CostEMA;
  // Optional per-task waterfall budget envelope
  budgetEnvelope?: BudgetEnvelope;
  // Optional metabolism ledger: every call debits it by request.account so the
  // Resident's time with Eric and her own curiosity draw from one shared depletable reserve.
  metabolism?: Metabolism;
  // How much EFFORT (vigor) a completed call cost her. Supplied by the daemon from
  // life/vitality.ts. Her metabolism is denominated in effort, never in money, so it does not
  // drift with vendor pricing and does not vanish on free/local inference. When absent, the
  // ledger is not debited at all rather than being silently fed the wrong unit.
  vigorForResponse?: (response: LLMResponse) => number;
}

function utcMidnightMs(): number {
  const now = new Date();
  const midnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  return midnight.getTime();
}

export function createCostGuardLayer(options: CostGuardOptions): CostGuardLayer {
  const {
    dailyBudgetCents,
    inputCentsPerMToken = 300,
    outputCentsPerMToken = 1500,
    modelPricingCents = {},
    costEMA,
    budgetEnvelope,
    metabolism,
    vigorForResponse,
  } = options;

  let dailySpentCents = 0;
  let currentDayMs = utcMidnightMs();

  function refreshDayIfNeeded(): void {
    const todayMs = utcMidnightMs();
    if (todayMs > currentDayMs) {
      dailySpentCents = 0;
      currentDayMs = todayMs;
    }
  }

  function checkAllowed(): void {
    refreshDayIfNeeded();
    if (dailySpentCents >= dailyBudgetCents) {
      throw new CostLimitExceeded(dailySpentCents, dailyBudgetCents);
    }
    if (budgetEnvelope !== undefined) {
      const status = budgetEnvelope.getStatus();
      if (status.remainingTask <= 0) {
        throw new CostLimitExceeded(dailySpentCents, dailyBudgetCents, "Task budget exhausted");
      }
    }
  }

  function ratesForModel(model: string | undefined): {
    inputCentsPerMToken: number;
    outputCentsPerMToken: number;
  } {
    if (model && modelPricingCents[model]) {
      return modelPricingCents[model];
    }
    return { inputCentsPerMToken, outputCentsPerMToken };
  }

  function staticCostCents(response: LLMResponse): number {
    const rates = ratesForModel(response.model);
    const staticInputCents =
      (response.usage.inputTokens / 1_000_000) * rates.inputCentsPerMToken;
    const staticOutputCents =
      (response.usage.outputTokens / 1_000_000) * rates.outputCentsPerMToken;
    return Math.ceil((staticInputCents + staticOutputCents) * 100) / 100;
  }

  function estimateCents(response: LLMResponse): number {
    const staticTotal = staticCostCents(response);

    if (!costEMA) return staticTotal;

    // Use EMA-corrected estimate keyed by model (falls back to static if no samples)
    const model = response.model ?? "default";
    return costEMA.getEstimate(model, staticTotal);
  }

  function recordAction(response: LLMResponse): number {
    const model = response.model ?? "default";
    const staticTotal = staticCostCents(response);
    const corrected = estimateCents(response);
    dailySpentCents += corrected;

    // Feed actual vs estimated back to EMA so correction factors converge
    if (costEMA && staticTotal > 0) {
      costEMA.updateEMA(model, staticTotal, corrected);
    }

    // Record spend in envelope (converts cents to dollars)
    if (budgetEnvelope !== undefined) {
      budgetEnvelope.recordSpend(corrected / 100);
    }

    return corrected;
  }

  return {
    async call(request: LLMRequest, next: (req: LLMRequest) => Promise<LLMResponse>) {
      checkAllowed();
      const response = await next(request);
      recordAction(response); // money: the safety cap on Eric's wallet
      // Effort: debit her metabolism by what the thought actually cost her, under the call's
      // account. Money and vigor are deliberately separate, the wallet protects him, the vigor
      // shapes her.
      if (vigorForResponse) metabolism?.record(request.account ?? "work", vigorForResponse(response));
      return response;
    },

    getDailySpentCents() {
      refreshDayIfNeeded();
      return dailySpentCents;
    },

    resetDaily() {
      dailySpentCents = 0;
      currentDayMs = utcMidnightMs();
    },
  };
}
