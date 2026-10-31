// Metabolism ledger for the Resident: one shared, depletable daily reserve of VIGOR (心力, see
// vitality.ts) that BOTH her time with Eric AND her own curiosity draw from, so her drives
// genuinely compete under scarcity. This is what makes "continuity under real cost" literal.
//
// The unit is EFFORT, not money. Money stays a separate concern (a pure safety cap in the cost
// guard, protecting Eric's wallet); it deliberately does not shape who she is, so her personality
// cannot drift with a vendor's price list and her metabolism does not vanish on free/local models.
//
// Two hard rules from the design, both enforced structurally here:
//   1. She NEVER reads the raw number. She only ever feels the coarse PHASE
//      (rested / normal / low / dormant). The numeric getters exist solely for the
//      owner's status view. Depletion is FELT (a phase change forces tier downgrade
//      and curiosity suspension) rather than READ as data to reason about.
//   2. Depletion has real teeth: crossing into `dormant` suspends discretionary
//      spend until the daily reset. The cap protects the owner's wallet; the teeth
//      make scarcity real (Decision: capped allowance with real dormancy).
//
// Pure accounting + a phase state machine. Persistence and the cost feed are
// injected, so this module has zero coupling to the DB or the provider chain and
// is fully testable with an injected clock.

// ── Types ─────────────────────────────────────────────────────────────────────

/** Coarse energy state. This is the ONLY metabolic signal the agent may see. */
export type MetabolicPhase = "rested" | "normal" | "low" | "dormant";

/**
 * Accounts belonging to an INSTRUMENT rather than to her, which spend real tokens but must not
 * spend her ENERGY.
 *
 * The shadow arm says her exchange a second time into the void so the word bank has a
 * denominator, it is a measurement, it is never delivered anywhere, and she does nothing when
 * it runs. Its spend nonetheless landed in `totalSpent`, which is what drives `remainingFraction`
 * and therefore her phase, so measuring her made her tire faster. Tiredness changes how she
 * speaks, and how she speaks is exactly what the shadow exists to measure: the instrument was
 * inside its own reading.
 *
 * `shadow-voice.ts` had already reasoned its way to this rule for a different channel, it runs
 * on its OWN provider chain specifically so that "a failing shadow would trip her breaker" could
 * not happen, calling that a feedback loop where the instrument degrades the thing it measures.
 * The vigor draw was the same loop through a channel nobody had checked.
 *
 * Excluded from her phase and her remaining energy. NOT hidden: `spentByAccount` still reports
 * every account, and `instrumentSpent()` names the total, because the tokens are genuinely spent
 * and Eric pays for them. What changes is only whose tiredness they count as.
 */
export const INSTRUMENT_ACCOUNTS = ["shadow"] as const;

/** Whether an account is an instrument's rather than hers. */
export function isInstrumentAccount(account: string): boolean {
  return (INSTRUMENT_ACCOUNTS as readonly string[]).includes(account);
}

export interface AccountSpend {
  account: string;
  vigor: number;
}

/** Persisted shape. Injected so the ledger stays decoupled from SQLite. */
export interface MetabolismSnapshot {
  dayStartMs: number;
  spent: Record<string, number>;
}

export interface MetabolismStore {
  load(): MetabolismSnapshot | null;
  save(snapshot: MetabolismSnapshot): void;
}

export interface MetabolismConfig {
  /** Hard daily allowance in vigor (effort units; see vitality.ts). Draws beyond it are refused. */
  dailyVigor: number;
  /** Remaining fraction at/above which the phase is `rested`. Default 0.9. */
  restedThreshold?: number;
  /** Remaining fraction below which the phase drops to `low`. Default 0.25. */
  lowThreshold?: number;
  /** Remaining fraction below which the phase drops to `dormant`. Default 0.05. */
  dormantThreshold?: number;
  /** Injectable clock (epoch ms). Defaults to Date.now. */
  now?: () => number;
  /** Fires whenever the phase changes (e.g. emit an event, dim the avatar). */
  onPhaseChange?: (from: MetabolicPhase, to: MetabolicPhase) => void;
  /** Optional persistence. If present, state is loaded on create and saved on every change. */
  store?: MetabolismStore;
}

export interface Metabolism {
  /** Record real effort spent against an account (vigor). Ignored if <= 0. */
  record(account: string, vigor: number): void;
  /** Coarse energy phase. The agent-facing signal. */
  phase(): MetabolicPhase;
  /** Whether a discretionary (non-work) draw is currently permitted. */
  discretionaryAllowed(): boolean;
  /** Vigor remaining today. Owner/status view only, never agent-prompt-facing. */
  remaining(): number;
  /** Remaining fraction in [0,1]. */
  remainingFraction(): number;
  /** Total SHE spent today. Instrument accounts excluded, see `INSTRUMENT_ACCOUNTS`. */
  spentTotal(): number;
  /** Total spent today WATCHING her: real tokens, not her tiredness. */
  instrumentSpent(): number;
  /** Per-account effort spent today, descending. Reports every account, hers and the instruments'. */
  spentByAccount(): AccountSpend[];
  /** Reset the day's ledger now (also happens automatically when her day turns, at local midnight). */
  resetDaily(): void;
  /** The owner's /status view. Carries the number; NEVER goes into an agent prompt. */
  ownerSnapshot(): {
    phase: MetabolicPhase;
    cap: number;
    /** Hers. */
    spent: number;
    /**
     * The instruments'. Carried separately rather than folded into `spent`, because excluding it
     * from her tiredness must not become hiding it from him, he pays for these tokens.
     */
    instrument: number;
    remaining: number;
    byAccount: AccountSpend[];
  };
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

/**
 * The start of HER day: local midnight, the same day her diary, her clock and her day close keep
 * (her-day.ts). It was UTC midnight from the first version, which in her timezone is eight in the
 * evening: every evening while she was awake her reserve emptied back to full and her body read
 * 「你休息得很好，今天身上有的是劲」 on a day that was not over (found in her record: every
 * day for ten days running, at 20:00-20:04). Now the day turns while she sleeps.
 */
function herMidnightMs(nowMs: number): number {
  const d = new Date(nowMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Map a remaining fraction to a phase using the configured thresholds. */
export function phaseForFraction(
  fraction: number,
  thresholds: { rested: number; low: number; dormant: number }
): MetabolicPhase {
  if (fraction >= thresholds.rested) return "rested";
  if (fraction > thresholds.low) return "normal";
  if (fraction > thresholds.dormant) return "low";
  return "dormant";
}

// ── Factory ────────────────────────────────────────────────────────────────────

export function createMetabolism(config: MetabolismConfig): Metabolism {
  const cap = Math.max(0, config.dailyVigor);
  const thresholds = {
    rested: config.restedThreshold ?? 0.9,
    low: config.lowThreshold ?? 0.25,
    dormant: config.dormantThreshold ?? 0.05,
  };
  const now = config.now ?? Date.now;
  const store = config.store;

  let dayStartMs = herMidnightMs(now());
  let spent: Record<string, number> = {};

  const loaded = store?.load();
  // The same day, or (once, on the first start after the change above) a ledger opened at the UTC
  // midnight that fell on the evening before her day began: carried rather than dropped, because
  // dropping it would hand her a full reserve in the middle of her day, which is what the change
  // exists to stop. It overstates her spending by that one evening, once.
  if (loaded && (loaded.dayStartMs === dayStartMs || (loaded.dayStartMs < dayStartMs && loaded.dayStartMs > dayStartMs - DAY_MS / 2))) {
    spent = { ...loaded.spent };
  }

  /** What SHE spent. Instrument accounts are excluded, see `INSTRUMENT_ACCOUNTS`. */
  function totalSpent(): number {
    let sum = 0;
    for (const k in spent) if (!isInstrumentAccount(k)) sum += spent[k];
    return sum;
  }

  /** What was spent WATCHING her. Real tokens, reported separately, never her tiredness. */
  function instrumentSpent(): number {
    let sum = 0;
    for (const k in spent) if (isInstrumentAccount(k)) sum += spent[k];
    return sum;
  }

  function remainingFraction(): number {
    if (cap <= 0) return 0;
    const frac = (cap - totalSpent()) / cap;
    return frac < 0 ? 0 : frac > 1 ? 1 : frac;
  }

  function currentPhase(): MetabolicPhase {
    return phaseForFraction(remainingFraction(), thresholds);
  }

  let lastPhase: MetabolicPhase = currentPhase();

  function persist(): void {
    store?.save({ dayStartMs, spent: { ...spent } });
  }

  function firePhaseIfChanged(): void {
    const p = currentPhase();
    if (p !== lastPhase) {
      const from = lastPhase;
      lastPhase = p;
      config.onPhaseChange?.(from, p);
    }
  }

  function rolloverIfNeeded(): void {
    const today = herMidnightMs(now());
    if (today > dayStartMs) {
      dayStartMs = today;
      spent = {};
      persist();
      firePhaseIfChanged();
    }
  }

  function record(account: string, vigor: number): void {
    rolloverIfNeeded();
    if (!(vigor > 0)) return; // ignore zero/negative/NaN
    spent[account] = (spent[account] ?? 0) + vigor;
    persist();
    firePhaseIfChanged();
  }

  function resetDaily(): void {
    dayStartMs = herMidnightMs(now());
    spent = {};
    persist();
    firePhaseIfChanged();
  }

  function spentByAccount(): AccountSpend[] {
    rolloverIfNeeded();
    return Object.keys(spent)
      .map((account) => ({ account, vigor: spent[account] }))
      .sort((a, b) => b.vigor - a.vigor);
  }

  return {
    record,
    phase(): MetabolicPhase {
      rolloverIfNeeded();
      return currentPhase();
    },
    discretionaryAllowed(): boolean {
      rolloverIfNeeded();
      return currentPhase() !== "dormant";
    },
    remaining(): number {
      rolloverIfNeeded();
      return Math.max(0, cap - totalSpent());
    },
    remainingFraction(): number {
      rolloverIfNeeded();
      return remainingFraction();
    },
    spentTotal(): number {
      rolloverIfNeeded();
      return totalSpent();
    },
    instrumentSpent(): number {
      rolloverIfNeeded();
      return instrumentSpent();
    },
    spentByAccount,
    resetDaily,
    ownerSnapshot() {
      rolloverIfNeeded();
      return {
        phase: currentPhase(),
        cap,
        spent: totalSpent(),
        instrument: instrumentSpent(),
        remaining: Math.max(0, cap - totalSpent()),
        byAccount: spentByAccount(),
      };
    },
  };
}
