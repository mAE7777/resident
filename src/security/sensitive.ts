// Sensitive filter: O(n+m) Aho-Corasick replacer built from config secrets
// Fast path: skip if content.length < minLength of all secrets
// Patterns are lowercased at definition time for case-insensitive matching

import { AhoCorasick } from "@monyone/aho-corasick";

export interface SensitiveFilter {
  filter(content: string): string;
  update(secrets: Map<string, string>): void;
}

function buildFilter(secrets: Map<string, string>): {
  ac: AhoCorasick | null;
  valueToName: Map<string, string>;
  minLength: number;
} {
  const valueToName = new Map<string, string>();

  for (const [name, value] of secrets) {
    if (value.length > 0) {
      // Store original value → name, but build AC on lowercased values
      valueToName.set(value.toLowerCase(), name);
    }
  }

  if (valueToName.size === 0) {
    return { ac: null, valueToName, minLength: Infinity };
  }

  const patterns = Array.from(valueToName.keys());
  const minLength = patterns.reduce((min, p) => Math.min(min, p.length), Infinity);
  const ac = new AhoCorasick(patterns);

  return { ac, valueToName, minLength };
}

export function createSensitiveFilter(initialSecrets: Map<string, string>): SensitiveFilter {
  let state = buildFilter(initialSecrets);

  function filter(content: string): string {
    // Fast path: no secrets or content too short to contain any
    if (!state.ac || content.length < state.minLength) {
      return content;
    }

    const lowered = content.toLowerCase();
    const matches = state.ac.matchInText(lowered);

    if (matches.length === 0) {
      return content;
    }

    // Sort by begin position, resolve overlaps by keeping longest match at each position
    const sorted = [...matches].sort((a, b) => a.begin - b.begin || b.keyword.length - a.keyword.length);

    let result = "";
    let pos = 0;

    for (const m of sorted) {
      if (m.begin < pos) {
        // Overlapping: skip (earlier/longer match already consumed this region)
        continue;
      }
      result += content.slice(pos, m.begin);
      result += "[REDACTED]";
      pos = m.begin + m.keyword.length;
    }

    result += content.slice(pos);
    return result;
  }

  function update(secrets: Map<string, string>): void {
    state = buildFilter(secrets);
  }

  return { filter, update };
}
