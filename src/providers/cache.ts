// Layer 5: Response cache, LRU 1000 entries, 1hr TTL.
// SHA-256 key from the full behavior-shaping request surface.
// NEVER caches responses containing tool_use content blocks.

import { createHash } from "node:crypto";
import type { LLMRequest, LLMResponse, ProviderLayer } from "./types.js";

const MAX_ENTRIES = 1000;
const TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  response: LLMResponse;
  expiresAt: number;
}

function cacheKey(request: LLMRequest): string {
  const payload = JSON.stringify({
    model: request.model,
    system: request.system,
    messages: request.messages,
    tools: request.tools,
    maxTokens: request.maxTokens,
    temperature: request.temperature,
    stopSequences: request.stopSequences,
    thinking: request.thinking,
    outputConfig: request.outputConfig,
  });
  return createHash("sha256").update(payload).digest("hex");
}

function hasToolUse(response: LLMResponse): boolean {
  return response.content.some((b) => b.type === "tool_use");
}

export interface CacheLayer extends ProviderLayer {
  size(): number;
  clear(): void;
}

export function createCacheLayer(): CacheLayer {
  // Map preserves insertion order: used for LRU eviction (delete oldest on overflow)
  const store = new Map<string, CacheEntry>();

  function evictExpiredAndOverflow(): void {
    const now = Date.now();
    // Remove expired entries first
    for (const [k, entry] of store) {
      if (entry.expiresAt <= now) {
        store.delete(k);
      }
    }
    // Enforce max size: evict oldest (first inserted)
    while (store.size > MAX_ENTRIES) {
      const firstKey = store.keys().next().value;
      if (firstKey !== undefined) {
        store.delete(firstKey);
      } else {
        break;
      }
    }
  }

  return {
    async call(request, next) {
      const key = cacheKey(request);
      const now = Date.now();

      const existing = store.get(key);
      if (existing !== undefined && existing.expiresAt > now) {
        // LRU: re-insert to make it "most recently used"
        store.delete(key);
        store.set(key, existing);
        return existing.response;
      }

      const response = await next(request);

      // Never cache tool_use responses
      if (!hasToolUse(response)) {
        store.set(key, { response, expiresAt: now + TTL_MS });
        evictExpiredAndOverflow();
      }

      return response;
    },

    size() {
      return store.size;
    },

    clear() {
      store.clear();
    },
  };
}
