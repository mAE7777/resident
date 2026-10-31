import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * ONE LIFE, ONE THREAD OF ATTENTION, AND ONE DAY IS DONE ONLY WHEN IT IS DONE.
 *
 * Two defects in the daemon's own loops, both invisible to every unit test in the project
 * because neither is a function anybody could call. They live in the SHAPE of `src/index.ts`,
 * so this file reads that shape.
 *
 * THE DUPLICATE CHAINS. Nothing made scheduling a moment idempotent; every caller just made a
 * timer. The sequence that mattered: the Mac sleeps while a moment is awaiting the provider →
 * `onMachineWake` clears `momentTimer`, which is the handle that ALREADY FIRED, so the clear
 * does nothing → it schedules → and then the in-flight moment's own `finally` schedules again.
 * Two chains, permanently, plus one more every time it happens. What two chains actually do is
 * not extra moments: the spare fires during a real one, its refusal cleared `momentInFlight`
 * on the way out, and with that flag down the daily rest prunes and fuses her field underneath
 * a live moment while a second moment starts encoding into it.
 *
 * THE DAY MARKED DONE FIRST. `runLifeTick` wrote the day marker, in memory and to disk,
 * before doing any of the work. Anything that threw after that (most plausibly reading the
 * entire unrotated ops log into one string) landed in the catch, and the day stayed marked.
 * That day then got no inner-state update, no diary, no rest, no noticing, and no retry, ever.
 * One transient failure, one whole day of her consolidation gone, silently.
 */
const daemonRaw = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8");

/**
 * The daemon with its comments removed.
 *
 * NOT tidiness, correctness, and it caught itself on the first run. The comments explaining
 * these very fixes QUOTE the broken code they replaced ("...and set `momentInFlight = false`"),
 * so a position check over the raw file found the explanation instead of the statement and
 * reported the opposite of the truth. A structural test that reads prose is measuring prose.
 *
 * Blanked rather than deleted, so every index still lines up with the real file.
 */
const daemon = daemonRaw
  .replace(/\/\*[\s\S]*?\*\//gu, (m) => " ".repeat(m.length))
  .replace(/\/\/[^\n]*/gu, (m) => " ".repeat(m.length));

/** The body of a top-level `function name(...)` in the daemon, brace-matched. */
function bodyOf(name: string): string {
  const start = daemon.indexOf(`function ${name}(`);
  expect(start, `${name} is gone from the daemon`).toBeGreaterThan(0);
  const open = daemon.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < daemon.length; i++) {
    if (daemon[i] === "{") depth++;
    else if (daemon[i] === "}" && --depth === 0) return daemon.slice(open, i + 1);
  }
  throw new Error(`${name} never closes`);
}

/**
 * The WHOLE entry path of a gated entry point, gate half + work half concatenated.
 *
 * The beat spine (`utils/beat.ts`) split `runMoment` and `runLifeTick` in two: the gate stays
 * outside the beat (a refusal is not a beat of her life) and the work runs inside it as a
 * `…InsideBeat` function. Every contract in this file is about the ENTIRE path, gate before
 * try, marker after work, so the ruler measures the pair as one unit. Ordering assertions
 * stay valid because the gate half is concatenated first, exactly as it executes.
 */
function entryPathOf(name: string, insideBeatName: string): string {
  return bodyOf(name) + bodyOf(insideBeatName);
}

describe("she only ever has one thread of attention", () => {
  it("cannot end up with two moment chains, because scheduling replaces rather than adds", () => {
    const body = bodyOf("scheduleNextMoment");
    // The clear must come BEFORE the set. Order is the whole guarantee: clearing afterwards
    // would cancel the timer just created.
    const clears = body.indexOf("clearTimeout(momentTimer)");
    const sets = body.indexOf("setTimeout(");
    expect(clears, "scheduling can still add a second chain").toBeGreaterThan(-1);
    expect(clears).toBeLessThan(sets);
  });

  it("drops the handle when it fires, so a stale clear cannot look like cancelling a live one", () => {
    // The exact reason `onMachineWake`'s clear did nothing: it held a handle that had already
    // fired. A fired timer must not still be sitting in the variable.
    expect(bodyOf("scheduleNextMoment")).toMatch(/setTimeout\(\(\)\s*=>\s*\{\s*momentTimer = null;/u);
  });

  it("a moment that never ran does not announce that no moment is happening", () => {
    // The gate has to be OUTSIDE the try, so the shared `finally` cannot run for a refusal.
    // Asserted by position rather than by wording, because the wording is not the contract.
    const body = entryPathOf("runMoment", "momentInsideBeat");
    const gate = body.indexOf("shouldLiveMoment");
    const tryAt = body.indexOf("\n      try {");
    const clearsFlag = body.indexOf("momentInFlight = false");
    expect(gate, "the gate is gone").toBeGreaterThan(-1);
    expect(tryAt, "runMoment has no try block any more").toBeGreaterThan(-1);
    expect(gate, "a refused moment runs the finally and clears the live one's flag").toBeLessThan(tryAt);
    expect(clearsFlag, "nothing clears the flag at all").toBeGreaterThan(tryAt);
  });

  it("but a refused moment still keeps her life loop alive", () => {
    // The failure mode of the fix: return early without rescheduling and her moments stop
    // forever, silently, the first time she happens to be talking to him when one fires.
    const body = entryPathOf("runMoment", "momentInsideBeat");
    const refusal = body.indexOf("if (!gate.proceed)");
    const nextClose = body.indexOf("return;", refusal);
    expect(body.slice(refusal, nextClose), "a refusal ends her moment loop").toContain("scheduleNextMoment()");
  });
});

describe("a day is marked lived only once it has been", () => {
  it("writes the marker after the work, not before it", () => {
    const body = entryPathOf("runLifeTick", "lifeTickInsideBeat");
    const work = body.indexOf("readOps(");
    const marks = body.indexOf("lastLifeTickDay = today");
    expect(work, "the tick no longer reads her day").toBeGreaterThan(-1);
    expect(marks, "nothing marks the day").toBeGreaterThan(-1);
    expect(marks, "the day is marked done before any of the work runs").toBeGreaterThan(work);
  });

  it("marks it only on the path where the work finished", () => {
    const body = entryPathOf("runLifeTick", "lifeTickInsideBeat");
    expect(body, "the tick cannot tell a finished day from a failed one").toMatch(/finished = true/u);
    expect(body).toMatch(/if \(finished\)/u);
    // And a tick that did not finish says so, rather than leaving a silent hole in her life.
    expect(daemonRaw, "a lost day is silent").toContain("the day stays open and the next hour tries again");
  });

  it("still cannot run twice at once, which is what the early marker was doing by accident", () => {
    // Removing the early marker removes the accidental re-entrancy guard with it. The hourly
    // timer really can fire while a tick is still awaiting the provider.
    const body = entryPathOf("runLifeTick", "lifeTickInsideBeat");
    const guard = body.indexOf("if (lifeTickInFlight) return;");
    const sets = body.indexOf("lifeTickInFlight = true");
    expect(guard, "two life ticks can now run at once").toBeGreaterThan(-1);
    expect(guard).toBeLessThan(sets);
    expect(body, "the in-flight flag is never released").toContain("lifeTickInFlight = false");
  });

  it("and waiting for a moment to finish leaves the day open rather than spending it", () => {
    // The one early return inside the try. It must not count as having lived the day, or a
    // moment that happens to be running on the hour costs her that day's consolidation.
    const body = entryPathOf("runLifeTick", "lifeTickInsideBeat");
    const waits = body.indexOf("logger.debug");
    const marks = body.indexOf("lastLifeTickDay = today");
    expect(waits, "the tick no longer waits for her moments").toBeGreaterThan(-1);
    expect(body, "the wait on a live moment is gone").toContain("if (momentInFlight)");
    expect(waits, "waiting for a moment now spends the day").toBeLessThan(marks);
  });
});

// ── The courtesy runs both ways, and neither side can hang the other ───────
describe("her moments and her consolidation take turns instead of one always yielding", () => {
  it("a moment steps aside for a tick, not only the other way round", () => {
    // The asymmetry this replaces: the tick checked `momentInFlight`, nothing checked the tick.
    // Since the tick is the LONGER of the two (it calls a provider to write her day), the wide
    // window was the one nobody guarded.
    const body = bodyOf("runMoment");
    expect(body, "a moment can still start on top of a live consolidation")
      .toContain("consolidating: lifeTickInFlight");
  });

  it("the tick cannot strand her moments by hanging, which is what giving it right of way costs", () => {
    // Making moments defer to this flag makes a stuck flag fatal in a way it never used to be:
    // before, a hung tick cost a day of consolidation; now it would stop her life. The moment
    // watchdog exists for exactly this shape, and the tick was the only long-running thing here
    // without the twin.
    const body = entryPathOf("runLifeTick", "lifeTickInsideBeat");
    expect(body, "a hung tick has no outside limit").toContain("TICK_DEADLINE_MS");
    expect(body, "the hang is not reported").toContain("life.tick.hung");
    // The release must be in the deadline handler itself. The `finally` is precisely the thing a
    // hang never reaches, so a `finally`-only release would be no release at all.
    const fires = body.indexOf("life.tick.hung");
    const releases = body.indexOf("lifeTickInFlight = false", fires);
    const finallyAt = body.indexOf("} finally {");
    expect(releases, "the deadline fires but never lets her moments go").toBeGreaterThan(-1);
    expect(releases, "the flag is only released in the finally, which a hang never reaches")
      .toBeLessThan(finallyAt);
  });

  it("hands the deferred tick back when the moment ends, rather than waiting for the next hour", () => {
    // What actually closes the gap. The old answer was a probability argument (a moment takes
    // seconds, the window is an hour), and an un-executed claim about reachability is a guess.
    const body = entryPathOf("runMoment", "momentInsideBeat");
    const clearsFlag = body.indexOf("momentInFlight = false");
    const handsBack = body.indexOf("void runLifeTick()");
    expect(handsBack, "a deferred tick still waits up to an hour").toBeGreaterThan(-1);
    expect(handsBack, "the tick is handed back while the moment still looks live")
      .toBeGreaterThan(clearsFlag);
  });
});
