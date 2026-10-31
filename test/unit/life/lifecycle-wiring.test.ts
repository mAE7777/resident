import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Lifecycle correctness lives in daemon closures, so these pins
// hold the load-bearing lines the way body.test.ts pins the face wiring. Each names the
// defect it guards against; removing the fix makes the quoted line disappear and goes red.

const src = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8");

describe("days cannot silently vanish from her autobiography", () => {
  it("the closed-day writer walks back over the days she missed, oldest first, not just yesterday", () => {
    // The literal `back = 7` is gone, and its going is the finding rather than a rename. The walk
    // was fed the life tick's event slice, which is cut off at THIRTY-SIX HOURS, so it walked
    // seven days through a map that could only ever hold two, and every day older than yesterday
    // took the skip branch. The failure this test was written to prevent was still happening,
    // behind a guard that was green. The horizon is one named constant now, used by both the walk
    // and the evidence window, so the two cannot drift apart again.
    expect(src).toContain("for (let back = DIARY_CATCH_UP_DAYS; back >= 1; back--)");
    expect(src).toMatch(/const DIARY_CATCH_UP_DAYS = \d+;/u);
    expect(src).toContain("catching up her autobiography after days away");
    expect(src, "each caught-up day is authored in the same pass").toContain("for (const yesterday of unwritten)");
    expect(src, "the narration check must not testify against a day it did not see")
      .toContain("if (yesterday !== unwritten[unwritten.length - 1]) continue;");
  });
});

describe("waking and booting actually catch up", () => {
  it("a same-day nap brings the field current; the day tick guards itself", () => {
    const wake = src.slice(src.indexOf("onMachineWake = (gap)"), src.indexOf("sleepWatcher.start()"));
    expect(wake, "time passed regardless of the day").toContain("field.tick(Date.now());");
    expect(wake).toContain("void runLifeTick();");
  });
  it("boot runs the day tick once, AFTER every declaration the tick touches", () => {
    // The first placement sat beside the timer arming, upstream of `lastConsolidatedDay`'s
    // declaration, and hit the temporal dead zone live on Eric's machine: the hourly timer
    // never trips TDZ (an hour has passed), an immediate boot call does. The pin therefore
    // asserts ORDER, not proximity: declaration first, watcher start, THEN the catch-up call.
    const decl = src.indexOf("let lastConsolidatedDay");
    const watcherStart = src.indexOf("sleepWatcher.start();");
    const bootCall = src.indexOf("void runLifeTick();", watcherStart);
    expect(decl, "the declaration exists").toBeGreaterThan(-1);
    expect(watcherStart, "the watcher start exists").toBeGreaterThan(decl);
    expect(bootCall, "the boot catch-up runs after the watcher starts").toBeGreaterThan(watcherStart);
    expect(bootCall - watcherStart, "and immediately after it, not somewhere unrelated").toBeLessThan(900);
  });
});

describe("shutdown cannot be defeated by a moment's own finally", () => {
  it("the re-arm is gated, the drain is bounded, and the flag is set first", () => {
    const sched = src.slice(src.indexOf("function scheduleNextMoment"), src.indexOf("function scheduleNextMoment") + 900);
    expect(sched, "an in-flight moment's finally must not resurrect the timer").toContain("if (shuttingDown) return;");
    const shut = src.slice(src.indexOf("async function shutdown"), src.indexOf("shutdown complete"));
    expect(shut.indexOf("shuttingDown = true;"), "the flag goes up before anything else").toBeLessThan(shut.indexOf("clearInterval"));
    expect(shut, "a mid-flight moment gets a bounded drain, not a rug-pull").toContain("momentInFlight && waited < 10_000");
  });
});

describe("turns serialize and abort cleanly across both channels", () => {
  it("a face turn drains the steering queue before freeing its thread", () => {
    // THE ANCHOR IS ASSERTED BEFORE IT IS USED, and that is not decoration. This slice used to
    // start at a literal `onReply: (text) => {`, and adding a second parameter made `indexOf`
    // return -1: at which point `slice(-1, …)` does not throw, it quietly returns a different
    // region of the file, and this guard goes from checking the ordering to checking a fragment
    // that happens not to contain either string. A guard whose anchor can miss silently is a guard
    // that reports on whatever it happened to land on.
    const at = src.search(/onReply: \(text[^)]*\) => \{/u);
    expect(at, "the anchor for the face turn's reply handler no longer matches the source")
      .toBeGreaterThan(-1);
    const onReply = src.slice(at, src.indexOf("// He cut in."));
    const drainAt = onReply.indexOf("await drainSteering(thread)");
    const freeAt = onReply.indexOf("activeTurns.delete(thread)");
    expect(drainAt, "the face turn's ending drains what queued behind it").toBeGreaterThan(-1);
    expect(drainAt, "…BEFORE freeing the thread, so nothing races past the queue").toBeLessThan(freeAt);
  });

  it("no finally anywhere deletes another turn's abort controller", () => {
    // Every deletion must be guarded by identity with the controller that finally owns.
    const deletions = [...src.matchAll(/turnAbortControllers\.delete\(/gu)];
    expect(deletions.length).toBeGreaterThanOrEqual(4);
    for (const m of deletions) {
      const before = src.slice(Math.max(0, m.index - 260), m.index);
      expect(/turnAbortControllers\.get\((?:chatId|thread)\) === \w+/u.test(before),
        `an unguarded controller deletion at index ${m.index}:\n…${before.slice(-140)}`).toBe(true);
    }
  });
});

describe("the poisoned-page attack is blocked on the conversational path too", () => {
  it("both conversational executors go through the egress guard, not the raw executor", () => {
    // The exploration path was guarded; the ordinary turn, the one where a human is nominally
    // present: ran web_fetch with no mayReach check, so a fabricated URL from a poisoned page
    // was fetched. Both conversational executeTools now wrap the SAME general egress guard.
    const spec = src.slice(src.indexOf("function baseSpec"), src.indexOf("async function processPhotoTurn"));
    const guardedCount = (spec.match(/executeTools: guardedConversationalExecutor\(/gu) ?? []).length;
    expect(guardedCount, "the conversational executor is guarded (plan mode is gone)").toBe(1);
    // And the raw executor is no longer handed straight to a conversational executeTools.
    expect(spec).not.toMatch(/executeTools: \(calls, options\) => executor\.executeBatch/u);
    // The guard refuses via a fault on a turn he drives, not an autonomous wall-question.
    expect(src).toContain('faultLog.record("egress.conversation"');
  });
});

describe("her working memory of the conversation is floored by HER state (faculty #8)", () => {
  it("history is bounded by the smaller of his diction's tier and her own capacity", () => {
    const fn = src.slice(src.indexOf("function historyForTurn"), src.indexOf("function maxOutputTokensForTurn"));
    expect(fn, "her lookback halves into message pairs and floors the count").toContain("herCapacity().lookbackRecords >> 1");
    expect(fn, "the tier can only NARROW, never widen past her state").toContain("Math.min(maxMessages, herLookback)");
    // The slice must use the bounded count, not the raw tier count.
    expect(fn).toContain("getChatHistory(chatId).slice(-boundedMessages)");
    expect(fn).not.toMatch(/getChatHistory\(chatId\)\.slice\(-maxMessages\)/u);
  });
});
