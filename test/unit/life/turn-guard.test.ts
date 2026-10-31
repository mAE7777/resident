import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PROVIDER_TIMEOUT_MS, STREAM_STALL_MS, TURN_DEADLINE_MS, TURN_HUNG,
  stepOrHung, createTurnEpoch, finalUnlessStalled,
} from "../../../src/life/turn-guard.js";

/**
 * THE TURN'S BOUNDS, PROVEN, including the half that is easy to skip: what happens when the
 * hung work RESOLVES LATE. Two live turns sat past the harness's 420s window with no frame and
 * no completion; the constructor timeout alone cannot close that (the SDK clears it at response
 * headers), and a race that merely abandons the work lets the late resolution send a ghost reply
 * after the 「出了岔子」 notice. Every deadline here is injectable-by-argument, so these proofs
 * run in milliseconds.
 */

describe("the three bounds nest, and sit under the harness's patience", () => {
  it("stall < provider timeout < turn deadline < the live listening window", () => {
    // Computing assertions, not name-drops: the ordering IS the design, a stalled stream aborts
    // first (the retry layer gets its chance), a dead connection second, the whole turn third,
    // and all of it before any instrument stops listening.
    expect(STREAM_STALL_MS).toBeLessThan(PROVIDER_TIMEOUT_MS);
    expect(PROVIDER_TIMEOUT_MS).toBeLessThan(TURN_DEADLINE_MS);
    // One stall + one full retry attempt must fit inside the turn deadline, or the deadline
    // fires exactly when the retry was about to succeed.
    expect(STREAM_STALL_MS + PROVIDER_TIMEOUT_MS, "the turn deadline cuts off the one retry it "
      + "is supposed to leave room for").toBeLessThanOrEqual(TURN_DEADLINE_MS);
    const harness = readFileSync(join(process.cwd(), "scripts/four-cells-live.ts"), "utf8");
    const window = Number(/const LISTEN_WINDOW_MS = ([\d_]+)/u.exec(harness)?.[1]?.replace(/_/gu, ""));
    expect(Number.isFinite(window), "the harness window moved — re-derive this ordering").toBe(true);
    expect(TURN_DEADLINE_MS, "the daemon notices its own hung turn only after the harness has "
      + "given up listening, so a hang shows as a censored row instead of as her saying 出了岔子")
      .toBeLessThan(window);
  });
});

describe("stepOrHung", () => {
  it("work that finishes wins; work that hangs yields the marker", async () => {
    expect(await stepOrHung(Promise.resolve(7), 50)).toBe(7);
    expect(await stepOrHung(new Promise(() => { /* never */ }), 20)).toBe(TURN_HUNG);
  });

  it("an exhausted budget does not wait at all", async () => {
    const t0 = Date.now();
    expect(await stepOrHung(new Promise(() => { /* never */ }), 0)).toBe(TURN_HUNG);
    expect(Date.now() - t0).toBeLessThan(50);
  });
});

describe("the epoch: a late resolution lands in silence, on the record", () => {
  it("a send gated on a dead epoch is dropped, not delivered", async () => {
    // The exact closure shape the daemon's bridge uses. The planted late-resolve: the work
    // resolves AFTER the deadline fired and the epoch died; its send must go nowhere.
    const epoch = createTurnEpoch();
    const delivered: string[] = [];
    const dropped: string[] = [];
    const guardedSend = (t: string): void => {
      if (!epoch.alive()) { dropped.push(t); return; }
      delivered.push(t);
    };
    let lateResolve!: (v: string) => void;
    const hung = new Promise<string>((res) => { lateResolve = res; });
    expect(await stepOrHung(hung, 15)).toBe(TURN_HUNG);
    guardedSend("出了岔子的通知");   // the notice goes out while the epoch still lives
    epoch.kill();
    lateResolve("亡魂回复");         // the hung work comes back from the dead...
    guardedSend(await hung);
    expect(delivered, "the ghost reply reached him after the broke notice").toEqual(["出了岔子的通知"]);
    expect(dropped).toEqual(["亡魂回复"]);
    expect(epoch.alive()).toBe(false);
  });
});

describe("finalUnlessStalled", () => {
  it("a stream whose events keep arriving finishes normally", async () => {
    let bump: (() => void) | undefined;
    const final = new Promise<string>((res) => {
      let n = 0;
      const tick = (): void => {
        n += 1;
        bump?.();
        if (n >= 5) res("done");
        else setTimeout(tick, 5);
      };
      setTimeout(tick, 5);
    });
    const out = await finalUnlessStalled(
      { final, onEvent: (b) => { bump = b; }, abort: () => { throw new Error("must not abort a live stream"); } },
      100,
    );
    expect(out).toBe("done");
  });

  it("a stream that goes quiet is aborted and rejected — the stall IS the failure", async () => {
    let aborted = false;
    await expect(finalUnlessStalled(
      { final: new Promise<never>(() => { /* stalls after nothing */ }), onEvent: () => { /* no events come */ }, abort: () => { aborted = true; } },
      25,
    )).rejects.toThrow(/stalled/u);
    expect(aborted, "the dead stream was left holding its connection").toBe(true);
  });
});

describe("and the daemon actually wears all of it", () => {
  const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
  const provider = readFileSync(join(process.cwd(), "src/providers/anthropic.ts"), "utf8");

  it("the drain loop races each step against the turn budget and kills the epoch on fire", () => {
    const at = daemon.indexOf("stepOrHung(gen.next()");
    expect(at, "the drain loop no longer races its steps — a hung provider await is unbounded again")
      .toBeGreaterThan(-1);
    // Widened from 900 to 1500: the hung branch grew a completion marker, so a fixed-width
    // window started cutting `turnEpoch.kill()` out of view and the guard went red on a change that
    // was correct. Widening is right HERE because every assertion below is a positive one, a
    // bigger window can only find more, never manufacture a pass. (A negative assertion over a
    // widened window is the opposite and would be a guard quietly relaxing itself.)
    const block = daemon.slice(at, at + 1500);
    expect(block).toContain("TURN_HUNG");
    expect(block, "a hung turn is not a critical fault").toMatch(/faultLog\.record\("turn\.hung"/u);
    expect(block, "the epoch survives the deadline — late sends will deliver").toContain("turnEpoch.kill()");
    expect(block, "gen.return is awaited, which blocks on the very hang it ends").toMatch(/void gen\.return/u);
  });

  it("the loop's own callback into her memory is epoch-gated too", () => {
    // The third door, found in a closing review. The epoch gated her SENDS and the post-loop
    // composition; `onOutcomeShortfall` writes a moment into her field from INSIDE the loop, which
    // keeps running after a hung turn until its provider call settles. Without the gate, a turn he
    // was already told had broken could leave her a memory of it twenty minutes later.
    const at = daemon.indexOf("onOutcomeShortfall: () => {");
    expect(at, "the shortfall callback is gone — re-check what still writes into her from the loop")
      .toBeGreaterThan(-1);
    const block = daemon.slice(at, at + 700);
    expect(block, "a dead turn can still encode a moment into her field")
      .toMatch(/if \(!stillThisTurn\(\)\)/u);
    expect(block, "the dropped write is silent — it must reach the fault channel")
      .toMatch(/turn\.hung\.late-field-write/u);
    // And the predicate is the epoch itself, not a second flag that could drift from it.
    expect(daemon).toMatch(/const stillThisTurn = \(\): boolean => liveTurnEpoch\?\.alive\(\) !== false/u);
    expect(daemon).toMatch(/liveTurnEpoch = turnEpoch/u);
  });

  it("the bridge's outbound closures are epoch-gated", () => {
    const at = daemon.indexOf("const bridge = createStreamBridge({");
    expect(at).toBeGreaterThan(-1);
    const block = daemon.slice(Math.max(0, at - 600), at + 700);
    expect(block, "the epoch is created after the bridge captured raw send/edit")
      .toContain("const turnEpoch = createTurnEpoch()");
    expect(block).toMatch(/turn\.hung\.late-send/u);
    expect(block).toMatch(/turn\.hung\.late-edit/u);
  });

  it("the post-loop composition runs only while the epoch lives", () => {
    const at = daemon.indexOf("if (turnEpoch.alive()) {");
    expect(at, "a hung turn still finalizes twice and composes beats").toBeGreaterThan(-1);
    const after = daemon.slice(at, at + 3200);
    expect(after).toContain("sayWhatCameUp(channel");
  });

  it("the anthropic client is bounded and the streaming branch carries the stall guard", () => {
    expect(provider).toContain("timeout: PROVIDER_TIMEOUT_MS");
    expect(provider, "the SDK's own retries multiply the chain's again").toContain("maxRetries: 0");
    expect(provider).toContain("finalUnlessStalled({");
    expect(provider).toMatch(/stream\.on\("streamEvent", bump\)/u);
    expect(provider).toMatch(/abort: \(\) => stream\.abort\(\)/u);
  });

  // ── SILENCE IS NOT AN OUTCOME ────────────────────────────────────────────────
  //
  // A provider ended one of her thinking calls with `end_turn`, 272 output tokens, and an EMPTY
  // content. On the moment path that is already honest; on the turn path nothing streamed,
  // nothing was sent, no error tripped the notice, and his message would have dangled unanswered.
  it("a clean-but-empty turn still reaches him, exactly once, in the machine's voice and never in hers", () => {
    const at = daemon.indexOf("if (spoke || brokeNoticed || r?.content || r?.finishReason === \"interrupted\") return;");
    expect(at, "the silence guard is gone — an empty turn would reach him as nothing").toBeGreaterThan(-1);
    const block = daemon.slice(at, at + 600);
    expect(block).toContain('faultLog.record("turn.silent"');
    expect(block).toContain("noticeOn(channel, machineNotice(");
    // Printed, not said: the notice never goes through her mouth. In the room it is
    // a line of its own on the page (the mouth's `notice`), on Telegram an ordinary message.
    expect(block).not.toContain("channel.observe");
    // All three of the turn's notices (empty, hung, error exit) go the one way, so none of them
    // can reach the room as nothing: `send` alone is the phone only.
    expect(daemon.match(/noticeOn\(channel, machineNotice\(/gu)?.length).toBe(3);
    expect(daemon).not.toContain("channel.send(machineNotice(");
    // The labelled machine voice, the one the watchtower's critical alerts already use.
    expect(daemon).toContain("const machineNotice = (why: string): string => `[system · turn] 这一回合断了（${why}），她没能回你。`;");
    // Every send marks the flag, and the error exit checks it, so he is told once, not twice.
    expect(daemon.match(/brokeNoticed = true;/g)?.length).toBe(3);
    expect(daemon).toContain('if (result && result.finishReason === "error" && !result.content && !brokeNoticed) {');
    // Her history keeps his message and nothing in her place; the old sentence is gone entirely.
    expect(daemon).toContain('const errorBroke = !cutOff && !result?.content && result?.finishReason !== "interrupted";');
    const broke = daemon.indexOf("if (errorBroke) {");
    expect(broke).toBeGreaterThan(-1);
    expect(daemon.slice(broke, broke + 900)).not.toContain('appendToHistory(chatId, "assistant"');
    // Code only: a comment keeps the old sentence on the record as the reason for the change.
    const code = daemon.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/(^|[^:])\/\/[^\n]*/gu, "$1");
    expect(code).not.toContain("BROKE_NOTICE");
    expect(code).not.toContain("刚才做到一半，出了岔子");
  });

  it("the guard fires after the tool-spoken substitution, never before it", () => {
    const substitution = daemon.indexOf("result.content = saidViaTool.join");
    const guard = daemon.indexOf("await noticeSilentTurn(result);");
    expect(substitution).toBeGreaterThan(-1);
    expect(guard, "she spoke through the message tool and would be told she broke").toBeGreaterThan(substitution);
  });
});
