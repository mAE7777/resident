import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { createBeatKeeper, currentBeat, annotateBeat } from "../../../src/utils/beat.js";
import { createFaultLog } from "../../../src/life/faults.js";
import { createOpsLog } from "../../../src/utils/ops-log.js";

/**
 * THE SPINE: one id per beat of her life, stamped into every stream.
 *
 * The load-bearing test here is the INTERLEAVE. The naive build, a module-level `currentBeat`
 * variable set at the top of each entry point, passes every straight-line test and fails the
 * one situation the spine exists for: a turn awaiting the model while the watchtower cycle runs
 * in the gap. That build would stamp the watchtower's faults with the TURN's id, manufacturing
 * false evidence. `AsyncLocalStorage` is the primitive that keeps the two contexts apart, and
 * the first test is the planted violation that would go red under the naive build.
 */

function tempDir(): string {
  const p = join(tmpdir(), `beat-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(p, { recursive: true });
  return p;
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

describe("two interleaved beats never contaminate each other", () => {
  it("faults raised in the gaps of one beat's awaits carry their OWN beat's id", async () => {
    const dir = tempDir();
    const faultLog = createFaultLog(50);
    const { inBeat } = createBeatKeeper({ journalPath: join(dir, "beats.jsonl") });

    // A long "turn" that awaits twice, and a "watch" cycle that runs inside those gaps,
    // exactly the daemon's shape. Each records a fault while the OTHER is mid-flight.
    const turn = inBeat("turn", async () => {
      faultLog.record("turn.first", "before the model call");
      await tick();
      faultLog.record("turn.second", "after the watchtower interleaved");
      await tick();
    });
    const watch = (async (): Promise<void> => {
      await new Promise((r) => setTimeout(r, 2)); // land inside the turn's first await
      await inBeat("watch", async () => {
        faultLog.record("watch.inside", "raised while the turn is mid-await");
        await tick();
      });
    })();
    await Promise.all([turn, watch]);

    const faults = faultLog.all();
    const byWhere = Object.fromEntries(faults.map((f) => [f.where, f.beat]));
    expect(byWhere["turn.first"], "a fault inside the turn must carry the turn's id").toMatch(/^turn:/u);
    expect(byWhere["turn.second"], "…including AFTER an interleaved watch cycle").toMatch(/^turn:/u);
    expect(byWhere["watch.inside"], "the watch fault must NOT be blamed on the turn").toMatch(/^watch:/u);
    expect(byWhere["turn.first"]).toBe(byWhere["turn.second"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("ops events are stamped the same way, centrally in write", async () => {
    const dir = tempDir();
    const opsLog = createOpsLog(join(dir, "ops.jsonl"));
    const { inBeat } = createBeatKeeper({ journalPath: join(dir, "beats.jsonl") });
    await inBeat("moment", async () => {
      opsLog.cronFire({ jobId: "1", jobName: "inside" });
      await tick();
    });
    opsLog.cronFire({ jobId: "2", jobName: "outside" });
    const rows = readFileSync(join(dir, "ops.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { jobName?: string; beat?: string });
    const inside = rows.find((r) => r.jobName === "inside");
    const outside = rows.find((r) => r.jobName === "outside");
    expect(inside?.beat).toMatch(/^moment:/u);
    expect(outside?.beat, "outside any beat, absent is honest — boot and shutdown are not beats").toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("the journal line", () => {
  it("carries id, kind, both timestamps, both state readings, and the beat's own notes", async () => {
    const dir = tempDir();
    let n = 0;
    const { inBeat } = createBeatKeeper({
      journalPath: join(dir, "beats.jsonl"),
      snapshot: () => ({ n: ++n }),
    });
    await inBeat("turn", async () => {
      annotateBeat({ chatId: 7 });
      annotateBeat({ heSaidChars: 42 });
      await tick();
    });
    const line = JSON.parse(readFileSync(join(dir, "beats.jsonl"), "utf8").trim()) as Record<string, unknown>;
    expect(line.id).toMatch(/^turn:\d+:\d+$/u);
    expect(line.kind).toBe("turn");
    expect(line.ok).toBe(true);
    expect(Number(line.t1)).toBeGreaterThanOrEqual(Number(line.t0));
    expect(line.state0).toEqual({ n: 1 });
    expect(line.state1).toEqual({ n: 2 });
    expect(line.chatId).toBe(7);
    expect(line.heSaidChars).toBe(42);
    rmSync(dir, { recursive: true, force: true });
  });

  it("a beat that throws is journalled ok:false and the error is RETHROWN unchanged", async () => {
    const dir = tempDir();
    const { inBeat } = createBeatKeeper({ journalPath: join(dir, "beats.jsonl") });
    const boom = new Error("the model hung");
    await expect(inBeat("turn", async () => { throw boom; })).rejects.toBe(boom);
    const line = JSON.parse(readFileSync(join(dir, "beats.jsonl"), "utf8").trim()) as Record<string, unknown>;
    expect(line.ok).toBe(false);
    expect(line.err).toBe("the model hung");
    rmSync(dir, { recursive: true, force: true });
  });

  it("a journal that cannot be written is a NAMED fault, never a silent absence", async () => {
    const dir = tempDir();
    const faults: string[] = [];
    // The journal path IS a directory: every append fails.
    const { inBeat } = createBeatKeeper({
      journalPath: dir,
      onFault: (where) => faults.push(where),
    });
    await inBeat("turn", async () => { /* the beat itself succeeds */ });
    expect(faults).toContain("beat.journal.write");
    rmSync(dir, { recursive: true, force: true });
  });

  it("a snapshot that throws costs the reading, never the beat", async () => {
    const dir = tempDir();
    const { inBeat } = createBeatKeeper({
      journalPath: join(dir, "beats.jsonl"),
      snapshot: () => { throw new Error("state not constructed yet"); },
    });
    const out = await inBeat("watch", async () => "still ran");
    expect(out).toBe("still ran");
    const line = JSON.parse(readFileSync(join(dir, "beats.jsonl"), "utf8").trim()) as Record<string, unknown>;
    expect(line.state0).toBeNull();
    expect(existsSync(join(dir, "beats.jsonl"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("outside any beat", () => {
  it("currentBeat is undefined, a fault carries no beat field, and annotate is a no-op", () => {
    expect(currentBeat()).toBeUndefined();
    annotateBeat({ ignored: true }); // must not throw
    const faultLog = createFaultLog(10);
    faultLog.record("boot.something", "before any beat exists");
    const f = faultLog.all()[0]!;
    expect("beat" in f).toBe(false);
  });
});
