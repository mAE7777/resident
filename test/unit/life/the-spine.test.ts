import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * EVERY ENTRY POINT RUNS INSIDE A BEAT, AND EVERY WRITER CARRIES THE ID.
 *
 * `beat.test.ts` proves the spine works; this file proves the daemon is ON it. The two rot
 * differently: the module can stay perfect while someone adds a seventh timer that runs outside
 * any beat, and from that day one class of faults is unattributable again. Each anchor below is
 * the thing itself (the wrapper call at its entry point), not a window, the alert-delivery
 * guard's stale 6000-char window is the documented counterexample.
 *
 * Entry points deliberately NOT wrapped, so their absence here is a decision and not a hole:
 *   · boot and shutdown, the two moments of her day that genuinely are not beats; their faults
 *     carry no beat id and `_beat.ts faults` lists them as legitimate orphans
 *   · the face tick, a stateless frame render several times a minute; journalling it would
 *     drown the spine in no-ops (its failures still reach the fault channel, timestamped)
 *   · gate refusals (moment gate, tick guards, dream mutex), a beat is an occasion that RAN
 */

const ROOT = process.cwd();
const src = (p: string): string => readFileSync(join(ROOT, p), "utf8");

describe("the daemon's entry points are on the spine", () => {
  const daemon = src("src/index.ts");

  it.each([
    ["the turn", 'return inBeat("turn", async () => {'],
    // Awaited inside a try since 2026-08-27: still one beat, but a throw out of the wrapper
    // now re-arms her life chain instead of ending it (interval-wiring.test.ts pins the rest).
    ["her moment (past the gate)", 'return await inBeat("moment", () => momentInsideBeat(nowMs));'],
    ["the daily life tick (past the guards)", 'return inBeat("tick", () => lifeTickInsideBeat(today));'],
    ["the watchtower cycle", 'return inBeat("watch", () => vitalsMonitorInsideBeat());'],
    ["disk maintenance", 'void inBeat("maintenance", () => diskMonitor.checkAndRunMaintenance'],
    ["the hourly snapshot", 'void inBeat("maintenance", async () => { takeHerSnapshot("hourly"); })'],
    ["a cron job firing", 'inBeat("cron", async () => {'],
  ])("%s", (_name, anchor) => {
    expect(daemon, `entry point no longer wrapped: expected to find ${anchor}`).toContain(anchor);
  });

  it("the turn annotates who spoke and how much, so the journal line stands alone", () => {
    expect(daemon).toContain("annotateBeat({ chatId, heSaidChars: text.length });");
  });

  it("the spine's own journal and the fault ring are on the rotation list", () => {
    // Both were born after the every-append-only-file audit; a file missing from this list
    // grows until the reader that loads it whole dies first, the audit's own words.
    expect(daemon).toContain('join(workspacePath, "..", "beats.jsonl"),');
    expect(daemon).toContain('join(workspacePath, "..", "faults.jsonl"),');
  });
});

describe("every stream carries the id", () => {
  it("faults: stamped inside record(), the one door every fault passes through", () => {
    const faults = src("src/life/faults.ts");
    expect(faults).toContain("const beat = currentBeat()?.id;");
  });

  it("ops: stamped inside write(), the one door every event passes through", () => {
    const ops = src("src/utils/ops-log.ts");
    expect(ops).toContain("const beat = currentBeat()?.id;");
  });

  it("the conversation log, her history, and her agency record each carry it per line", () => {
    const daemon = src("src/index.ts");
    expect(daemon, "conversation-log line lost the beat").toContain("beat: currentBeat()?.id,\n          ...entry,");
    expect(daemon, "history archive entry lost the beat").toContain("cursor: ++historyCursor,\n          beat: currentBeat()?.id,");
    expect(daemon, "agency.jsonl row lost the beat").toContain('JSON.stringify({ ...o, beat: currentBeat()?.id })');
  });

});
