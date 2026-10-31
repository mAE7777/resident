// Duplicate tool call tracker: detects consecutive identical failing tool
// calls and escalates to warn / force_text mode.
//
// Adapted from IronClaw (nearai/ironclaw, src/agent/agentic_loop.rs; MIT OR Apache-2.0).
// See THIRD_PARTY_NOTICES.md.
// Fingerprint: hash(tool_name + JSON.stringify(canonicalArgs)) for each call,
// sorted so order within a batch doesn't matter.
//
// Escalation:
//   3 consecutive identical failing calls → 'warn'
//   5 consecutive identical failing calls → 'force_text'
//
// Reset conditions:
//   different tool/args fingerprint called
//   any tool succeeded (allFailed=false)
//   LLM responds with text (caller invokes reset())

import { fingerprint } from "./fingerprint.js";

export type DuplicateCheckResult = "ok" | "warn" | "force_text";

export interface DuplicateTracker {
  /**
   * Check the current batch of tool calls.
   *
   * @param calls     - The tool calls attempted this turn.
   * @param allFailed - True when every call in the batch resulted in an error.
   *
   * If the fingerprint matches the previous batch AND allFailed is true,
   * the consecutive counter is incremented. Otherwise it is reset.
   *
   * Returns:
   *   'ok'        , count < 3
   *   'warn'      , count >= 3 and < 5
   *   'force_text', count >= 5
   */
  check(calls: Array<{ name: string; args: unknown }>, allFailed: boolean): DuplicateCheckResult;

  /**
   * Explicitly reset the tracker (call when the LLM responds with text-only).
   */
  reset(): void;

  /**
   * Returns the current number of fingerprints in the bounded cache.
   */
  getCacheSize(): number;
}

const MAX_CACHE_SIZE = 50;
const EVICTION_COUNT = 10;

/**
 * Create a duplicate tool call tracker.
 * Each call returns an independent tracker instance.
 */
export function createDuplicateTracker(): DuplicateTracker {
  let lastFingerprint: string | null = null;
  let consecutiveCount = 0;
  const cache = new Map<string, number>();

  function check(
    calls: Array<{ name: string; args: unknown }>,
    allFailed: boolean
  ): DuplicateCheckResult {
    if (calls.length === 0) return "ok";

    const fp = fingerprint(calls);

    // Add to bounded fingerprint cache.
    cache.set(fp, Date.now());
    if (cache.size > MAX_CACHE_SIZE) {
      // Evict the oldest EVICTION_COUNT entries (Map preserves insertion order).
      let evicted = 0;
      for (const key of cache.keys()) {
        if (evicted >= EVICTION_COUNT) break;
        cache.delete(key);
        evicted++;
      }
    }

    if (fp === lastFingerprint && allFailed) {
      consecutiveCount++;
    } else {
      // Different fingerprint or a success: reset
      lastFingerprint = fp;
      consecutiveCount = allFailed ? 1 : 0;
    }

    if (consecutiveCount >= 5) return "force_text";
    if (consecutiveCount >= 3) return "warn";
    return "ok";
  }

  function reset(): void {
    lastFingerprint = null;
    consecutiveCount = 0;
    cache.clear();
  }

  function getCacheSize(): number {
    return cache.size;
  }

  return { check, reset, getCacheSize };
}
