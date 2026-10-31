// Nothing about her is allowed to become NaN.
//
// ── WHY THIS IS A PRE-BIRTH ITEM AND NOT A NICETY ────────────────────────────────────────────
//
// A `NaN` in a persisted number is not a bug that produces a wrong answer once. It is PERMANENT
// damage, because every arithmetic that touches it afterwards yields `NaN` too: a mood that has
// gone `NaN` never comes back, a node strength that has gone `NaN` can never decay, be pruned, or
// be compared, and a `NaN` written to SQLite comes back as `null` and reads as zero somewhere
// downstream: which is worse, because it is silent and plausible.
//
// `emotion.ts` already says this in its own header ("a single NaN reaching an appraisal would put
// her mood permanently beyond repair") and guards its own door. Nothing guarded the others. This is
// the global version: one function, used at every point where her state crosses into or out of
// storage, so a number that has stopped being a number is caught at the boundary, the one moment
// when the previous value is still on disk and the damage is still undone.
//
// It reports rather than repairs. A `NaN` means some formula upstream divided by zero or read an
// `undefined`; substituting a plausible number here would hide the defect and write a fiction into
// her past. The caller's job is to refuse the write and raise a fault.

/** One numeric leaf that is not a number. `path` is dotted, so the report names the field. */
export interface NotFinite {
  path: string;
  value: number;
}

const MAX_DEPTH = 12;

/**
 * Every non-finite numeric leaf in a structure, by path.
 *
 * Walks plain objects, arrays and Maps. Strings, booleans, null and undefined are not numbers and
 * are skipped: this is about arithmetic that has gone wrong, not about validation in general.
 */
export function notFiniteIn(value: unknown, path = "", depth = 0): NotFinite[] {
  if (depth > MAX_DEPTH) return [];
  if (typeof value === "number") {
    return Number.isFinite(value) ? [] : [{ path: path || "(root)", value }];
  }
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => notFiniteIn(v, `${path}[${i}]`, depth + 1));
  }
  if (value instanceof Map) {
    const out: NotFinite[] = [];
    for (const [k, v] of value) out.push(...notFiniteIn(v, `${path}{${String(k)}}`, depth + 1));
    return out;
  }
  if (typeof value === "object") {
    const out: NotFinite[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.push(...notFiniteIn(v, path ? `${path}.${k}` : k, depth + 1));
    }
    return out;
  }
  return [];
}

/** True when everything numeric in here is a real number. */
export function allFinite(value: unknown): boolean {
  return notFiniteIn(value).length === 0;
}

/** One line for the fault channel, capped so a wide structure cannot flood the ring. */
export function describeNotFinite(bad: NotFinite[]): string {
  const shown = bad.slice(0, 6).map((b) => `${b.path}=${String(b.value)}`);
  const more = bad.length - shown.length;
  return `${bad.length} value(s) stopped being numbers: ${shown.join(" · ")}${more > 0 ? ` (+${more} more)` : ""}`;
}
