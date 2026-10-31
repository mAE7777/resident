import { describe, it, expect } from "vitest";
import {
  EXPLORATION_ZONE, lockedFamilies, explorationAllows,
  createExplorationFailures, gateExplorationFamilies,
  EXPLORATION_TOOLS, isExplorationTool,
} from "../../../src/life/exploration-zone.js";

describe("exploration zone", () => {
  it("blocks state-mutating actions during exploration", () => {
    const v = explorationAllows({ family: "bash", mutates: true }, EXPLORATION_ZONE, []);
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain("mutate");
  });

  it("allows read/fetch actions", () => {
    expect(explorationAllows({ family: "web", mutates: false }, EXPLORATION_ZONE, []).allowed).toBe(true);
  });

  it("blocks a locked-out family", () => {
    expect(explorationAllows({ family: "web", mutates: false }, EXPLORATION_ZONE, ["web"]).allowed).toBe(false);
  });

  it("locks a family only at the failure threshold, tuned above the loop's two", () => {
    expect(EXPLORATION_ZONE.lockoutThreshold).toBeGreaterThan(2);
    const failures = { web: 4, read: 1 };
    expect(lockedFamilies(failures, EXPLORATION_ZONE.lockoutThreshold)).toEqual(["web"]);
  });
});

// A LOCKOUT HAS TO END.
//
// `lockedFamilies` and `explorationAllows` had no callers at all, so a tool family that failed every
// time was tried again forever. Wiring them introduced the opposite fault in the same afternoon: the
// count only ever went up, so four failures one morning closed a way of looking for the LIFE OF THE
// PROCESS, which could be months. `EXPLORATION_ZONE`'s own comment said "locked for the session" and
// never meant "until somebody restarts her".
//
// Everything else in her comes back: reticence eases, credence recovers, warmth drifts, memory
// fades. This does too.

describe("she stops trying a broken way of looking, and comes back to it", () => {
  const T = Date.parse("2026-08-08T09:00:00Z");
  const HOUR = 3_600_000;

  it("four failures close it, and fewer do not", () => {
    const f = createExplorationFailures();
    for (let i = 0; i < EXPLORATION_ZONE.lockoutThreshold - 1; i++) f.record("web_search", true, T);
    expect(f.locked(T), "three failures is a bad morning, not a verdict").toEqual([]);
    f.record("web_fetch", true, T);
    expect(f.locked(T), "and the family closes, not just the one tool").toEqual(["web"]);
  });

  it("a success never counts toward closing anything", () => {
    const f = createExplorationFailures();
    for (let i = 0; i < 20; i++) f.record("web_search", false, T);
    expect(f.locked(T)).toEqual([]);
  });

  it("and it opens again", () => {
    const f = createExplorationFailures();
    for (let i = 0; i < 4; i++) f.record("web_search", true, T);
    expect(f.locked(T)).toEqual(["web"]);
    expect(f.locked(T + EXPLORATION_ZONE.lockoutMs - 1), "still leaving it alone").toEqual(["web"]);
    expect(f.locked(T + EXPLORATION_ZONE.lockoutMs), "and now she may try again").toEqual([]);
  });

  it("she gets ONE try back, not a fresh run of four", () => {
    // If a lock lifting reset the count to zero, a family that is genuinely down would be hammered
    // back up to the threshold every single time, four more failures, every twelve hours, forever.
    const f = createExplorationFailures();
    for (let i = 0; i < 4; i++) f.record("web_search", true, T);
    const after = T + EXPLORATION_ZONE.lockoutMs;
    expect(f.locked(after)).toEqual([]);
    f.record("web_search", true, after);
    expect(f.locked(after), "still broken, so she stops again after one look").toEqual(["web"]);
  });

  it("failures a week apart never add up to a lock (2026-09-23)", () => {
    // Her real reading failures since the 9/15 start, every one a file that was not there. The old
    // tally reached four at the last one and closed her reading for twelve hours.
    const f = createExplorationFailures();
    for (const at of [
      "2026-09-17T00:06:07Z", "2026-09-20T00:28:45Z", "2026-09-21T18:40:26Z",
      "2026-09-21T18:45:04Z", "2026-09-23T12:24:39Z",
    ]) f.record("read", true, Date.parse(at));
    expect(f.locked(Date.parse("2026-09-23T12:24:40Z")), "one bad file this morning is not a broken way of looking").toEqual([]);
    expect(f.counts(Date.parse("2026-09-23T12:24:40Z")).read, "only this morning's counts").toBe(1);
  });

  it("but four inside half a day still close it", () => {
    const f = createExplorationFailures();
    for (let i = 0; i < 4; i++) f.record("read", true, T + i * 3 * HOUR);
    expect(f.locked(T + 9 * HOUR)).toEqual(["read"]);
  });

  it("each lockout can be told apart from the last one (2026-09-24)", () => {
    // Her reading closed a second time and the fault ring never heard of it, because the record
    // was kept once per family for the life of the process.
    const f = createExplorationFailures();
    for (let i = 0; i < 4; i++) f.record("read", true, T);
    const first = f.lockedUntil("read", T);
    expect(first).toBe(T + EXPLORATION_ZONE.lockoutMs);
    const after = T + EXPLORATION_ZONE.lockoutMs;
    expect(f.lockedUntil("read", after), "open again").toBeUndefined();
    f.record("read", true, after);
    const second = f.lockedUntil("read", after);
    expect(second, "closed again, and it is a different lockout").toBeGreaterThan(first!);
  });

  it("and the daemon records every lockout, not only the first one", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(`${process.cwd()}/src/index.ts`, "utf8");
    const at = src.indexOf('faultLog.record("exploration.locked"');
    expect(at, "the lockout fault moved; this guard's anchor is stale").toBeGreaterThan(-1);
    const guard = src.slice(Math.max(0, at - 700), at);
    expect(guard, "the once-only check is keyed by the family alone again").toMatch(/lockedUntil\(family\)/u);
  });

  it("one family closing leaves the others open", () => {
    const f = createExplorationFailures();
    for (let i = 0; i < 4; i++) f.record("web_search", true, T);
    expect(f.locked(T)).toEqual(["web"]);
    expect(explorationAllows({ family: "read", mutates: false }, EXPLORATION_ZONE, f.locked(T)).allowed).toBe(true);
    expect(explorationAllows({ family: "web", mutates: false }, EXPLORATION_ZONE, f.locked(T)).allowed).toBe(false);
  });

  it("the gate refuses a closed family and lets the rest through", async () => {
    const f = createExplorationFailures();
    for (let i = 0; i < 4; i++) f.record("web_search", true, T);
    const seen: string[] = [];
    const gated = gateExplorationFamilies(
      async (calls) => calls.map((c) => ({ callId: c.callId, name: c.name, content: "ok" })),
      f,
      (family) => seen.push(family),
      () => T,
    );
    const out = await gated([
      { callId: "1", name: "web_fetch", args: {} },
      { callId: "2", name: "read", args: {} },
    ]);
    expect(out.find((r) => r.callId === "1")?.isError, "the closed one is refused").toBe(true);
    expect(out.find((r) => r.callId === "2")?.isError, "the open one runs").toBeUndefined();
    expect(seen).toEqual(["web"]);
    // In the order they were asked for, so nothing downstream has to know this happened.
    expect(out.map((r) => r.callId)).toEqual(["1", "2"]);
  });

  it("and results running through the gate feed the count themselves", async () => {
    const f = createExplorationFailures();
    const gated = gateExplorationFamilies(
      async (calls) => calls.map((c) => ({ callId: c.callId, name: c.name, content: "no", isError: true })),
      f, undefined, () => T,
    );
    for (let i = 0; i < 4; i++) await gated([{ callId: `${i}`, name: "web_fetch", args: {} }]);
    expect(f.locked(T), "she learns it is not working from the failures themselves").toEqual(["web"]);
  });
});

// ── The zone must obey its own stated contract ──────────────────────────
describe("nothing she can reach on her own initiative changes the world", () => {
  it("every tool in the zone is non-state-changing, and the check is per entry", async () => {
    // The module's own comment says "everything here reads or fetches, nothing here mutates",
    // and for a long time that sentence was false: `search_tools` and `tool_forge` both classify
    // sensitive AND state-changing. The Rule of Two could not catch them either, it fires only
    // on untrusted+sensitive+stateChange and `isUntrusted` is `!isBuiltin`, so every builtin is
    // permanently exempt. On her own initiative the thing steering the loop is a WEB PAGE, which
    // is exactly the case that exemption is wrong for.
    //
    // Per entry rather than as a snapshot of the list, so adding a mutating tool goes red on the
    // PROPERTY rather than on the membership.
    const { classifyOperationRisk } = await import("../../../src/security/operation-risk.js");
    for (const name of EXPLORATION_TOOLS) {
      const risk = classifyOperationRisk(name, {});
      expect(risk.isStateChange, `${name} can change the world while a web page is steering her`).toBe(false);
    }
  });

  it("and the two that were removed are still hers when HE is steering", async () => {
    // The fix is about who is driving, not about taking things away from her: both tools stay
    // fully available on the conversational path.
    const { BORN_HOLDING } = await import("../../../src/life/birth-toolkit.js");
    expect(isExplorationTool("tool_forge")).toBe(false);
    expect(isExplorationTool("search_tools")).toBe(false);
    // (They are openable tools, not birth ones, asserted here only so the removal is not read
    // as a claim that she never had them.)
    expect(BORN_HOLDING.includes("tool_forge")).toBe(false);
  });
});
