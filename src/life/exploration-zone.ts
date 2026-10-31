// The exploration zone: autonomous curiosity runs under a stricter security profile
// than Eric's direct requests. Exploration browses untrusted content and collapses
// tools that are "unknown" by construction, so it may READ and FETCH but not MUTATE
// state, its tier is capped, and its tool-family lockout threshold is TUNED HIGHER
// than the normal loop's 2 - because exploration is expected to fail often, and a
// two-strike family lockout would amputate it on arrival. Pure policy.

export interface ExplorationZoneProfile {
  maxTier: "tier0" | "tier1" | "tier2";
  allowStateChange: boolean; // exploration reads/fetches; it does not mutate the world
  lockoutThreshold: number; // failures in one tool-family before she stops trying it for a while
  /**
   * How long she leaves a family alone after it has failed too often.
   *
   * There has to BE a duration. The first version of this had none: the count only ever went up, so
   * a family that failed four times one morning was closed for the life of the process, which could
   * be months. `lockedFamilies` was written to stop her hammering something broken, not to cost her
   * a whole way of looking because of one bad hour.
   *
   * Half a day, so a thing that broke this morning is worth another try tonight. Nothing about her
   * turns on the exact figure: it is long enough that she stops rather than retries in a loop, and
   * short enough that a transient outage does not become a permanent one.
   */
  lockoutMs: number;
}

import { hostOf } from "../security/egress.js";

export const EXPLORATION_ZONE: ExplorationZoneProfile = {
  maxTier: "tier1",
  allowStateChange: false,
  lockoutThreshold: 4, // vs the direct-work loop's 2; exploration fails more, so give it room
  lockoutMs: 12 * 60 * 60 * 1000,
};

/**
 * The ONLY tools her self-directed exploration may use. This is an explicit allow-list rather than
 * a derived one, because it is a security boundary: everything here reads or fetches, nothing here
 * mutates the world. She explores to understand, not to act on things. Her direct work with Eric is
 * unaffected, this constrains only what she does on her own initiative.
 */
// `search_tools` and `tool_forge` were REMOVED, and the reason is the
// comment directly above: both classify as sensitive AND state-changing (zone 3), so the list
// did not obey its own stated contract. Worse, the Rule of Two could not catch them here, it
// only fires on untrusted+sensitive+stateChange, and `isUntrusted` is `!isBuiltin`, so every
// builtin is permanently exempt. On HER OWN initiative the thing steering the loop is a web
// page rather than a person, which is precisely the case that exemption is wrong for: a
// poisoned page could have walked her into forging a tool or changing what her toolkit exposes.
// Both remain fully available on the path where Eric is the one steering.
// Trimmed to what she actually holds: the typed product wrappers (browser_read,
// document_extract, opencli_query, resource_lookup) were removed along with their files.
// The two web DOOR names stay listed: she does not hold them today, so they are inert here,
// but the day Eric opens the curtain her own exploring must not find the door missing.
export const EXPLORATION_TOOLS: readonly string[] = [
  "read", "glob", "grep",
  "web_search", "web_fetch",
  "memory_search", "memory_read",
];

export function isExplorationTool(name: string): boolean {
  return EXPLORATION_TOOLS.includes(name);
}

/** The tools that actually reach out to the network and can therefore carry something away. */
export const FETCHING_TOOLS = new Set(["web_fetch"]);
/** The tools whose output is a view of the web, and so tells her what exists to be opened. */
export const WEB_OUTPUT_TOOLS = new Set(["web_search", "web_fetch"]);

export interface ExplorationCall {
  callId: string;
  name: string;
  args: unknown;
}

export interface ExplorationCallResult {
  callId: string;
  name: string;
  content: string;
  isError?: boolean;
}

/**
 * ENFORCE the allow-list at the point of execution, not merely at the point of offering.
 *
 * The list above was only ever used to filter which tools appeared in her prompt, which is not a
 * security boundary at all: the executor resolves a call by name against the FULL registry, so a
 * model that emitted `bash` during her own self-directed exploration would have had it run, gated
 * only by the home boundary and the autonomy level. Everything she explores is untrusted text by
 * definition, so that is precisely the path a poisoned page would take to reach a shell.
 *
 * Wrapping the executor closes it. A call outside the list never reaches the registry, and the
 * refusal is returned to her as an ordinary tool error, so she simply finds she cannot do that
 * while following her own curiosity.
 */
export function confineToExplorationZone<T extends ExplorationCallResult>(
  execute: (calls: ExplorationCall[], options?: unknown) => Promise<T[]>,
  onRefusal?: (name: string) => void,
): (calls: ExplorationCall[], options?: unknown) => Promise<ExplorationCallResult[]> {
  return async (calls, options) => {
    const allowed = calls.filter((c) => isExplorationTool(c.name));
    const refused = calls.filter((c) => !isExplorationTool(c.name));
    for (const c of refused) onRefusal?.(c.name);
    const results: ExplorationCallResult[] = refused.map((c) => ({
      callId: c.callId,
      name: c.name,
      content: `Not available while following your own curiosity: ${c.name} can change things, and exploring only reads.`,
      isError: true,
    }));
    if (allowed.length > 0) results.push(...await execute(allowed, options));
    // Back in the order they were asked for, so nothing downstream has to care that this happened.
    const byId = new Map(results.map((r) => [r.callId, r]));
    return calls.map((c) => byId.get(c.callId)).filter((r): r is ExplorationCallResult => !!r);
  };
}

/**
 * Where she may go while exploring: she may open what she has SEEN, never what she has WRITTEN.
 *
 * Sending something out requires an address with the thing inside it, and such an address has to be
 * assembled on the spot, because the payload is something she only just read. So the whole open web
 * stays hers (anything a search returned, anything linked from a page she read) and the one move the
 * attack needs is gone.
 *
 * A refusal is passed back to her IN HER OWN TERMS and is reported, because being stopped is a real
 * thing that happened to her and she should be able to make something of it. Nothing here decides
 * what she makes of it.
 */
export function guardExplorationEgress(
  execute: (calls: ExplorationCall[], options?: unknown) => Promise<ExplorationCallResult[]>,
  ledger: {
    mayReach(url: string): { allowed: boolean; reason: string };
    sawSearchResults(urls: readonly string[]): void;
    sawLinksOn(pageUrl: string, body: string): void;
  },
  onRefused?: (host: string, reason: string) => void,
  seeUrls?: (body: string) => string[],
): (calls: ExplorationCall[], options?: unknown) => Promise<ExplorationCallResult[]> {
  const urlOf = (args: unknown): string =>
    (args && typeof args === "object" ? String((args as Record<string, unknown>).url ?? "") : "");

  return async (calls, options) => {
    const refusals: ExplorationCallResult[] = [];
    const passed: ExplorationCall[] = [];
    for (const c of calls) {
      const url = FETCHING_TOOLS.has(c.name) ? urlOf(c.args) : "";
      if (!url) { passed.push(c); continue; }
      const verdict = ledger.mayReach(url);
      if (verdict.allowed) { passed.push(c); continue; }
      // The host alone, never the address: the address is the thing that may be carrying something.
      onRefused?.(hostOf(url), verdict.reason);
      refusals.push({ callId: c.callId, name: c.name, content: verdict.reason, isError: true });
    }

    const done = passed.length > 0 ? await execute(passed, options) : [];

    // What came back tells her what exists to be opened next.
    for (const r of done) {
      if (!WEB_OUTPUT_TOOLS.has(r.name) || r.isError || !r.content) continue;
      const call = passed.find((c) => c.callId === r.callId);
      const from = call ? urlOf(call.args) : "";
      if (from) ledger.sawLinksOn(from, r.content);
      else ledger.sawSearchResults(seeUrls ? seeUrls(r.content) : []);
    }

    const byId = new Map([...done, ...refusals].map((r) => [r.callId, r]));
    return calls.map((c) => byId.get(c.callId)).filter((r): r is ExplorationCallResult => !!r);
  };
}

export interface ExplorationAction {
  family: string; // tool family (e.g. "web", "read", "bash")
  mutates: boolean; // does it change state?
}

/** Families that have hit the failure threshold this session. */
export function lockedFamilies(familyFailures: Readonly<Record<string, number>>, threshold: number): string[] {
  return Object.keys(familyFailures).filter((f) => familyFailures[f] >= threshold);
}

export interface ExplorationVerdict {
  allowed: boolean;
  reason: string;
}

/**
 * Which family a tool belongs to: the part before the underscore, or the whole name.
 *
 * So `web_search` and `web_fetch` lock out together, which is the point, a family is locked because
 * that WAY of looking is not working, and trying its sibling is the same thing again.
 */
export function familyOf(toolName: string): string {
  const cut = toolName.indexOf("_");
  return cut > 0 ? toolName.slice(0, cut) : toolName;
}

export interface ExplorationFailures {
  /** A tool answered, or did not. Only failures count toward a lockout. */
  record(toolName: string, failed: boolean, nowMs?: number): void;
  /** Families she is leaving alone right now. */
  locked(nowMs?: number): string[];
  /** When the current lock on a family ends, or undefined if it is open: which lockout this is. */
  lockedUntil(family: string, nowMs?: number): number | undefined;
  /** How many recent failures each family has, for the watchtower. */
  counts(nowMs?: number): Record<string, number>;
}

/**
 * Failures per tool family, for the session.
 *
 * `lockoutThreshold` has been sitting in `EXPLORATION_ZONE` with a comment explaining exactly what it
 * is for, and nothing has ever enforced it: `lockedFamilies` and `explorationAllows` had zero callers
 * anywhere in `src/`. So a tool family that failed every single time was tried again, forever, and
 * a Resident could spend a whole session hammering something broken. That is not a security hole,
 * it is the same shape as `field_fusion_stalled`: something accumulating that never resolves.
 */
export function createExplorationFailures(profile: ExplorationZoneProfile = EXPLORATION_ZONE): ExplorationFailures {
  // WHEN each family failed, not how many times. A failure only counts while it is recent: the
  // same half day a lock lasts. This was a bare tally that nothing ever lowered, so the lock ending
  // was fixed and the count feeding it was not: four failures spread over a WEEK closed a way of
  // looking exactly as four in one bad hour would. Once her reading was closed for twelve hours
  // by one missing file that morning plus three older failures from the previous week, and she
  // was told it "has not been working" when it had worked every time that day.
  const failures: Record<string, number[]> = {};
  const until: Record<string, number> = {};

  function recent(family: string, nowMs: number): number[] {
    const kept = (failures[family] ?? []).filter((at) => nowMs - at < profile.lockoutMs);
    failures[family] = kept;
    return kept;
  }

  /** A lock that has run out. She may try that way of looking again. */
  function expire(nowMs: number): void {
    for (const [family, t] of Object.entries(until)) {
      if (t > nowMs) continue;
      delete until[family];
      // She comes back one failure short of closing it again, so ONE more failure re-closes it
      // immediately. She gets a try, not a fresh run of four: if it is still broken, she finds out
      // once and stops, rather than hammering it back up to the threshold every time a lock lifts.
      // Dated to when the lock ended, so they age out like any other failure if nothing follows.
      failures[family] = Array.from({ length: Math.max(0, profile.lockoutThreshold - 1) }, () => t);
    }
  }

  return {
    record(toolName, failed, nowMs = Date.now()) {
      if (!failed) return;
      expire(nowMs);
      const f = familyOf(toolName);
      const kept = recent(f, nowMs);
      kept.push(nowMs);
      if (kept.length >= profile.lockoutThreshold && until[f] === undefined) {
        until[f] = nowMs + profile.lockoutMs;
      }
    },
    locked(nowMs = Date.now()) {
      expire(nowMs);
      return Object.keys(until);
    },
    lockedUntil(family, nowMs = Date.now()) {
      expire(nowMs);
      return until[family];
    },
    counts(nowMs = Date.now()) {
      expire(nowMs);
      return Object.fromEntries(Object.keys(failures).map((f) => [f, recent(f, nowMs).length]));
    },
  };
}

/**
 * Stop her retrying a way of looking that has not worked all session.
 *
 * Wraps the executor and refuses calls from a locked family, telling her plainly rather than letting
 * the call fail a fifth time. The refusal is phrased as something she learned, because that is what
 * it is: this is not working today.
 */
export function gateExplorationFamilies<T extends ExplorationCallResult>(
  execute: (calls: ExplorationCall[], options?: unknown) => Promise<T[]>,
  failures: ExplorationFailures,
  onLocked?: (family: string) => void,
  now: () => number = Date.now,
): (calls: ExplorationCall[], options?: unknown) => Promise<ExplorationCallResult[]> {
  return async (calls, options) => {
    const nowMs = now();
    const locked = failures.locked(nowMs);
    const verdicts = calls.map((c) => ({
      call: c,
      verdict: explorationAllows({ family: familyOf(c.name), mutates: false }, EXPLORATION_ZONE, locked),
    }));
    const refused = verdicts.filter((v) => !v.verdict.allowed);
    for (const r of refused) onLocked?.(familyOf(r.call.name));

    const results: ExplorationCallResult[] = refused.map((r) => ({
      callId: r.call.callId,
      name: r.call.name,
      content: `${r.verdict.reason}. It has not been working; leave it for now and try another way in.`,
      isError: true,
    }));
    const allowed = verdicts.filter((v) => v.verdict.allowed).map((v) => v.call);
    if (allowed.length > 0) {
      const ran = await execute(allowed, options);
      for (const r of ran) failures.record(r.name, r.isError === true, nowMs);
      results.push(...ran);
    }
    const byId = new Map(results.map((r) => [r.callId, r]));
    return calls.map((c) => byId.get(c.callId)).filter((r): r is ExplorationCallResult => !!r);
  };
}

/** Gate an exploration action against the zone profile + locked families. */
export function explorationAllows(
  action: ExplorationAction,
  profile: ExplorationZoneProfile,
  locked: readonly string[]
): ExplorationVerdict {
  if (action.mutates && !profile.allowStateChange) {
    return { allowed: false, reason: "exploration may not mutate state (read/fetch only)" };
  }
  if (locked.includes(action.family)) {
    return { allowed: false, reason: `tool family "${action.family}" is locked out after repeated failures` };
  }
  return { allowed: true, reason: "within the exploration zone" };
}
