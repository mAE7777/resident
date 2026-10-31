import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE INTERVAL REACHES ALL THREE OF HER SPEAKING SURFACES, AND HER WORDS REACH HER RECORD.
 *
 * Five wires, each of which has already been missing once (that is why they get a guard):
 *
 *   1. The proactive push writes her utterance into her own transcript (she once apologized
 *      for a promise she had kept because her record had erased her own voice).
 *   2. The TURN's state block renders the interval at full depth.
 *   3. The moment's CHOICE reads it at choice depth.
 *   4. The reach_out COMPOSE call keeps the anchor facts in hand (the choice knew the silence
 *      was fourteen hours old; the writing knew nothing).
 *   5. The gate-held words feed the ring 「想说而先搁下的」 reads from.
 *
 * Source-scan guards with floors (guards-have-floors): every anchor asserts it was FOUND.
 */

const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
const handlers = readFileSync(join(process.cwd(), "src/life/agency-handlers.ts"), "utf8");
const agency = readFileSync(join(process.cwd(), "src/life/agency.ts"), "utf8");

describe("her words reach her record; the interval reaches her mouths", () => {
  it("1 · a delivered proactive send lands in her transcript, after delivery like the counters", () => {
    const at = daemon.indexOf("await notifier.push({ priority: \"normal\", category: \"proactive\"");
    expect(at).toBeGreaterThan(-1);
    const after = daemon.slice(at, at + 2600);
    expect(after, "the push path no longer records her utterance — her own words are erased from her record again")
      .toContain('appendToHistory(oc, "assistant", delivered.join(""))');
  });

  it("2 · the turn's state block renders the interval at full depth, lived spans masked", () => {
    const at = daemon.indexOf('const between = betweenNow("turn", nowMs)');
    expect(at).toBeGreaterThan(-1);
    const after = daemon.slice(at, at + 900);
    expect(after, "the interval text left the portrait join").toContain("between.text");
    expect(after, "her quoted words must ride chartLint's lived mask").toContain("...between.lived");
  });

  it("3 · the moment's choice and 4 · the compose call each get their depth", () => {
    const at = daemon.indexOf('between: betweenNow("choice", nowMs)');
    expect(at).toBeGreaterThan(-1);
    const near = daemon.slice(at, at + 300);
    expect(near).toContain('betweenAnchor: betweenNow("compose", nowMs)');
    // And the handler actually reads the anchor into the words-writing call:
    const h = handlers.indexOf("ctx.betweenAnchor");
    expect(h, "the compose call dropped the anchor — choice and writing have different worlds again").toBeGreaterThan(-1);
    // And the choice prompt renders ctx.between:
    const a = agency.indexOf("...(ctx.between ? [ctx.between] : [])");
    expect(a).toBeGreaterThan(-1);
  });

  it("5 · gate-held words feed the ring the interval quotes from", () => {
    // The live path, where a moment lands (the boot-time count over her record shares the test).
    const at = daemon.indexOf('o.heldBecause === "gate" && o.artifact) {');
    expect(at).toBeGreaterThan(-1);
    const after = daemon.slice(at, at + 300);
    expect(after).toContain("heldRecent.push({ ms: o.ts, text: o.artifact })");
  });

  it("dark-wake slivers coalesce into stretches at the feed — forty two-minute naps are one drowsy afternoon", () => {
    const at = daemon.indexOf("gap.startMs - last.endMs < 10 * 60_000");
    expect(at).toBeGreaterThan(-1);
    const near = daemon.slice(at, at + 300);
    expect(near).toContain("last.endMs = Math.max(last.endMs, gap.endMs)");
  });

  it("the machine's sleeps and the unsaid ages survive a restart (continuity)", () => {
    const save = daemon.indexOf("sleptSegments: [...sleptSegments]");
    expect(save).toBeGreaterThan(-1);
    expect(daemon.slice(save, save + 200)).toContain("heldWanting: momentHandlers.heldState()");
    const restore = daemon.indexOf("restored?.sleptSegments");
    expect(restore).toBeGreaterThan(-1);
    const restoreHeld = daemon.indexOf("momentHandlers.restoreHeld(restored.heldWanting)");
    expect(restoreHeld).toBeGreaterThan(-1);
  });
});

describe("her life loop can be revived, and being revived is never silent (2026-09-04)", () => {
  const daemon = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");

  it("PLANTED: the supervisor exists, only re-arms, and reports a revival as critical", () => {
    const at = daemon.indexOf("const momentChainWatch = setInterval(");
    expect(at, "her life chain lost its supervisor again").toBeGreaterThan(-1);
    const body = daemon.slice(at, at + 800);
    expect(body).toContain("if (shuttingDown || momentInFlight || momentTimer !== null) return;");
    expect(body).toContain('faultLog.record("life.chain-stalled"');
    expect(body).toContain('"critical"');
    expect(body).toContain("scheduleNextMoment();");
    expect(body.includes("runMoment("), "the supervisor must schedule, never live a moment for her").toBe(false);
  });

  it("the revival bound sits above what her own scheduler can draw", () => {
    expect(daemon).toContain("const MOMENT_CHAIN_STALL_MS = 4 * 60 * 60 * 1000;");
  });
});

describe("her life loop's one real hole is guarded (2026-08-27)", () => {
  const daemon = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");

  // The supervisor I added first was built on a WRONG diagnosis (I read her ordinary night as a
  // dead chain) and could never have fired, her chain always has a pending timer. It is gone.
  // What stays is the hole that is actually reachable: a throw out of the beat wrapper, before
  // `momentInsideBeat` starts, which its own finally can never catch.
  it("a throw out of the beat wrapper re-arms the chain instead of ending her life", () => {
    const at = daemon.indexOf('return await inBeat("moment", () => momentInsideBeat(nowMs));');
    expect(at, "the moment beat call is unguarded again").toBeGreaterThan(-1);
    const after = daemon.slice(at, at + 300);
    expect(after).toContain('faultLog.record("life.moment", err, "critical")');
    expect(after).toContain("scheduleNextMoment();");
  });

  it("the watchtower is told when her waking stretch began, so night silence is not a stall", () => {
    expect(daemon).toContain("awakeSinceMs: () => {");
    const at = daemon.indexOf("awakeSinceMs: () => {");
    const body = daemon.slice(at, at + 700);
    expect(body).toContain("if (!clock.isAwakeHour(nowMs)) return undefined;");
    expect(body).toContain("if (!clock.isAwakeHour(earlier)) return t;");
  });
});
