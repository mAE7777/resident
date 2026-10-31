// Cost EMA: exponential moving average for per-tool cost estimation and cache monitoring.
// Persists correction factors in SQLite. Session-scoped cache counters reset on restart.

import type { Database } from "better-sqlite3";

const DEFAULT_ALPHA = 0.1;
const MIN_FACTOR = 0.1;
const MAX_FACTOR = 10.0;

export interface CostEMAConfig {
  db: Database;
  alpha?: number; // default 0.1
}

export interface CostEMA {
  /** Get the EMA-corrected estimate for a tool/model. */
  getEstimate(key: string, baseEstimate: number): number;
  /** Update EMA with actual observed cost. */
  updateEMA(key: string, estimated: number, actual: number): void;
  /** Get cache hit rate for the current session. */
  getCacheHitRate(): { hits: number; total: number; rate: number };
  /** Record a cache hit. */
  recordCacheHit(): void;
  /** Record a cache miss. */
  recordCacheMiss(): void;
}

export function createCostEMA(config: CostEMAConfig): CostEMA {
  const alpha = config.alpha ?? DEFAULT_ALPHA;
  const db = config.db;

  db.exec(`
    CREATE TABLE IF NOT EXISTS cost_ema (
      key TEXT PRIMARY KEY,
      correction_factor REAL NOT NULL DEFAULT 1.0,
      sample_count INTEGER NOT NULL DEFAULT 0,
      last_updated INTEGER NOT NULL
    )
  `);

  // Session-scoped cache counters (reset on process restart)
  let cacheHits = 0;
  let cacheTotal = 0;

  const stmtGet = db.prepare(
    "SELECT correction_factor, sample_count FROM cost_ema WHERE key = ?"
  );
  const stmtUpsert = db.prepare(`
    INSERT INTO cost_ema (key, correction_factor, sample_count, last_updated)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      correction_factor = excluded.correction_factor,
      sample_count = excluded.sample_count,
      last_updated = excluded.last_updated
  `);

  return {
    getEstimate(key: string, baseEstimate: number): number {
      const row = stmtGet.get(key) as
        | { correction_factor: number; sample_count: number }
        | undefined;
      if (!row) return baseEstimate;
      return baseEstimate * row.correction_factor;
    },

    updateEMA(key: string, estimated: number, actual: number): void {
      if (estimated <= 0) return; // Guard: division by zero

      const row = stmtGet.get(key) as
        | { correction_factor: number; sample_count: number }
        | undefined;
      const currentFactor = row?.correction_factor ?? 1.0;
      const sampleCount = (row?.sample_count ?? 0) + 1;

      // EMA on the correction factor: how far off was the estimate?
      const rawFactor =
        alpha * (actual / estimated) + (1 - alpha) * currentFactor;
      // Clamp to prevent extreme drift
      const newFactor = Math.max(MIN_FACTOR, Math.min(MAX_FACTOR, rawFactor));

      stmtUpsert.run(key, newFactor, sampleCount, Date.now());
    },

    getCacheHitRate(): { hits: number; total: number; rate: number } {
      const rate = cacheTotal > 0 ? cacheHits / cacheTotal : 0;
      return { hits: cacheHits, total: cacheTotal, rate };
    },

    recordCacheHit(): void {
      cacheHits++;
      cacheTotal++;
    },

    recordCacheMiss(): void {
      cacheTotal++;
    },
  };
}
