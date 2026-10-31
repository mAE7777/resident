import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createNotifier } from "../../../src/autonomy/notifier.js";
import { createFaultLog } from "../../../src/life/faults.js";
import { detectAnomalies, planReaction } from "../../../src/life/vitals.js";
import { createRealWorld, liveOrdinaryDays, DAY, HOUR, MINUTE } from "./_real-world.js";

// AN ALERT ACTUALLY ARRIVES.
//
// Everything upstream of this was tested and everything upstream of this worked. What was never
// tested was the last few inches, and all of it was broken:
//
//   1. `(critical ? logger.error : logger.warn)(msg)` detaches the method from the logger, so pino
//      throws on the `this` it expects. That line was in the monitor cycle AND in the fault
//      reporter, which meant: any cycle with something to report threw; the throw recorded a
//      critical `vitals.cycle` fault; that fault became the next cycle's alert; which threw again.
//      A permanent crash loop that started the instant anything was wrong, and no alert ever left
//      the process. Found by booting the daemon, not by any unit test.
//   2. Delivery was `if (chatId) send(...)`, and `allowedUserIds: [0]`, the value in the
//      checked-in config: is falsy. Every alert dropped with no throw and no log.
//   3. The alert was marked as delivered BEFORE the send, so a transient failure lost it forever.
//   4. A code stayed "already reported" for as long as it kept occurring, so a subsystem failing
//      continuously alerted exactly once.
//
// A watchtower that cannot deliver is not a watchtower. This file walks the whole path.

/**
 * The daemon's cycle, reduced to the part that decides and delivers. Mirrors src/index.ts.
 *
 * Timestamps are anchored to the real clock, because the fault log stamps with `Date.now()` and the
 * cursor is compared against those stamps. A harness on synthetic milliseconds would have the cursor
 * permanently ahead of every fault and would quietly test nothing.
 */
function makeCycle(send: (text: string) => Promise<void>) {
  const T0 = Date.now();
  let clockMs = T0;
  const faults = createFaultLog(200, undefined, () => clockMs);
  const notifier = createNotifier({ sendMessage: async (t) => send(t) });
  const lastAlertedMs = new Map<string, number>();
  const RE_ALERT_AFTER_MS = 6 * HOUR;
  let cursorMs = T0 - 60_000;
  let undeliverableSince: number | null = null;
  // The pending half of the cursor contract, mirrored from the daemon: the cursor advances per
  // capture (so a burst is a burst IN ONE CYCLE, not "three faults ever"), which means a fault
  // anomaly exists for exactly one cycle, an alert that failed to send is kept alive HERE.
  const pendingAlertLines: string[] = [];
  let pendingCritical = false;
  const PENDING_ALERT_CAP = 10;
  const history: ReturnType<typeof detectAnomalies> extends never ? never : Parameters<typeof detectAnomalies>[0][number][] = [];

  let lastNewFaults: ReturnType<typeof faults.since> = [];

  return {
    faults,
    delivered: [] as string[],
    cursor: () => cursorMs,
    pending: () => [...pendingAlertLines],
    lastNewFaults: () => lastNewFaults,
    startedAt: T0,
    /** Something broke in her at `at`. Uses the same clock as the cycle, so ordering is real. */
    breaks(at: number, where: string, detail: string, severity: "warn" | "critical" = "critical") {
      clockMs = T0 + at;
      faults.record(where, new Error(detail), severity);
    },
    /** `at` is an offset from the harness's origin, so it lines up with the fault log's clock. */
    async run(at: number, snapshot: Parameters<typeof detectAnomalies>[0][number]) {
      clockMs = T0 + at;
      const v = { ...snapshot, ts: clockMs, newFaults: faults.since(cursorMs) };
      lastNewFaults = v.newFaults;
      cursorMs = v.ts;
      history.push(v);
      const anomalies = detectAnomalies(history);
      const reaction = planReaction(anomalies);
      const due = reaction.alerts.filter((a) => {
        const since = lastAlertedMs.get(a.code);
        return since === undefined || v.ts - since >= RE_ALERT_AFTER_MS;
      });
      if (due.length > 0 || pendingAlertLines.length > 0) {
        const critical = due.some((a) => a.severity === "critical") || pendingCritical;
        const lines = [
          ...due.map((a) => a.message),
          ...pendingAlertLines.filter((l) => !due.some((a) => a.message === l)),
        ];
        try {
          await notifier.push({ priority: critical ? "urgent" : "normal", category: "vitals", message: `Vitals: ${lines.join(" · ")}` });
          for (const a of due) lastAlertedMs.set(a.code, v.ts);
          pendingAlertLines.length = 0;
          pendingCritical = false;
          undeliverableSince = null;
        } catch (err) {
          for (const l of lines) {
            if (pendingAlertLines.length >= PENDING_ALERT_CAP) break;
            if (!pendingAlertLines.includes(l)) pendingAlertLines.push(l);
          }
          pendingCritical = pendingCritical || critical;
          if (undeliverableSince === null || v.ts - undeliverableSince >= RE_ALERT_AFTER_MS) {
            undeliverableSince = v.ts;
            faults.record("alert.undeliverable", err, "critical");
          }
        }
      }
      const nowCodes = new Set(anomalies.map((a) => a.code));
      for (const code of [...lastAlertedMs.keys()]) if (!nowCodes.has(code)) lastAlertedMs.delete(code);
      return due.map((a) => a.code);
    },
  };
}

/** A real snapshot from live modules, so this is not testing against a shape that cannot occur. */
function realSnapshot() {
  const w = createRealWorld();
  liveOrdinaryDays(w, 12);
  return w.capture();
}

describe("the harness above is the daemon's cycle, not a story about it", () => {
  it("the daemon carries the same cursor-and-pending contract this file exercises", () => {
    // This file's `makeCycle` is a COPY of the monitor cycle, and a copy can drift: the latch
    // this contract replaced was asserted as DESIRED here for months while the daemon shipped
    // it. So the load-bearing lines are pinned to the real source.
    const src = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8");
    const cycleStart = src.indexOf("async function runVitalsMonitor");
    expect(cycleStart, "the monitor cycle exists").toBeGreaterThan(-1);
    // The span runs to where the cycle's timer is armed, not a fixed character count: this was
    // `cycleStart + 6000`, and adding an unrelated file watch near the top of the cycle pushed
    // the pending-buffer lines out of the window while the contract they pin was untouched, the
    // exact stale-window defect the diary-check guard in her-own-vocabulary.test.ts already
    // documents. An end ANCHOR moves with the function; a length does not.
    const cycleEnd = src.indexOf("const vitalsTimer = setInterval", cycleStart);
    expect(cycleEnd, "the cycle's timer arming moved — re-anchor the span").toBeGreaterThan(cycleStart);
    const cycle = src.slice(cycleStart, cycleEnd);
    expect(cycle, "the cursor advances at capture, unconditionally").toContain("faultCursorMs = v.ts;");
    expect(cycle.indexOf("faultCursorMs = v.ts;"), "…BEFORE anomaly detection, not inside the delivery branch")
      .toBeLessThan(cycle.indexOf("detectAnomalies"));
    expect(cycle, "an undelivered alert stays alive in the pending buffer").toContain("pendingAlertLines");
    expect(cycle, "a cycle with only pending content still attempts delivery")
      .toContain("if (due.length > 0 || pendingAlertLines.length > 0)");
  });
});

describe("a fault becomes a message that actually leaves the process", () => {
  it("walks the whole path: something breaks in her, and he is told", async () => {
    const sent: string[] = [];
    const cycle = makeCycle(async (t) => { sent.push(t); });
    const snap = realSnapshot();

    expect(await cycle.run(1_000, snap), "nothing wrong, nothing said").toEqual([]);

    cycle.breaks(1_500, "field.store.save", "the disk went away");
    const codes = await cycle.run(2_000, snap);

    expect(codes).toContain("fault");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("the disk went away");
    console.log(`\n  he receives: ${sent[0]}`);
  });

  it("a detached logger method cannot silently kill the cycle", () => {
    // The exact shape of the bug: pino needs its own `this`, and `(cond ? a.b : a.c)(x)` does not
    // give it one. Asserted structurally so the pattern cannot come back anywhere in the daemon.
    const logger = {
      calls: [] as string[],
      warn(this: { calls: string[] }, m: string) { this.calls.push(m); },
      error(this: { calls: string[] }, m: string) { this.calls.push(m); },
    };
    const detached = (true ? logger.error : logger.warn) as (m: string) => void;
    expect(() => detached("boom"), "this is what shipped").toThrow();
    expect(() => { logger.error("fine"); }, "and this is what it must be").not.toThrow();
  });
});

describe("a channel that cannot deliver is loud, never silent", () => {
  it("refuses to treat an unusable chat id as a successful send", async () => {
    // `allowedUserIds: [0]` is the value in the checked-in config, and `0` is falsy.
    for (const chatId of [0, undefined, Number.NaN]) {
      const notifier = createNotifier({
        sendMessage: async (text: string) => {
          if (chatId === undefined || !Number.isFinite(chatId) || chatId === 0) {
            throw new Error(`cannot deliver: telegram.allowedUserIds[0] is ${String(chatId)}, which is not a chat`);
          }
          void text;
        },
      });
      await expect(
        notifier.push({ priority: "urgent", category: "vitals", message: "something is wrong" }),
        `chatId ${String(chatId)} must not read as delivered`,
      ).rejects.toThrow(/not a chat/);
    }
  });

  it("keeps the alert PENDING when the send fails, and delivers it when the channel returns", async () => {
    let up = false;
    const sent: string[] = [];
    const cycle = makeCycle(async (t) => {
      if (!up) throw new Error("telegram is down");
      sent.push(t);
    });
    const snap = realSnapshot();

    cycle.breaks(500, "field.store.save", "the disk went away");
    await cycle.run(1_000, snap);
    expect(sent, "it could not go out").toHaveLength(0);
    // The cursor STILL advances: it means "read into a snapshot", never "delivered". Holding it
    // back was the latch that turned the burst rule into "three faults ever" on any machine with
    // no usable chat id. What keeps the alert alive is the pending buffer, not a frozen window.
    expect(cycle.cursor(), "the burst window stays per-cycle even while the channel is down").toBeGreaterThan(cycle.startedAt);
    expect(cycle.pending(), "the composed alert is held, not lost").not.toHaveLength(0);

    up = true;
    await cycle.run(2_000, snap);
    expect(sent, "and it goes out as soon as the channel is back").toHaveLength(1);
    expect(sent[0]).toContain("the disk went away");
    expect(cycle.pending(), "delivered means no longer pending").toHaveLength(0);
  });

  it("faults spread across cycles never add up to one cycle's burst", async () => {
    // THE DEGRADATION THIS CONTRACT EXISTS TO PREVENT. With the cursor latched by a dead
    // channel, `newFaults` grew into "every fault since boot", so the third warn-level hiccup
    // in a WEEK read as a critical burst and walked her into permanent safe mode, compounded
    // by the quiet-week pinning sentinel, which manufactured exactly such faults daily. Three
    // warns in one CYCLE are a burst; three warns days apart are a life.
    const cycle = makeCycle(async () => { throw new Error("telegram is down"); });
    const snap = realSnapshot();
    for (let i = 1; i <= 3; i++) {
      cycle.breaks(i * DAY - MINUTE, "field.told", `hiccup ${i}`, "warn");
      await cycle.run(i * DAY, snap);
      expect(cycle.lastNewFaults().filter((f) => f.where === "field.told").length,
        "a cycle's window held more than its own cycle's faults").toBeLessThanOrEqual(1);
    }
  });

  it("records the channel being down, but rarely enough not to bury what it is trying to say", async () => {
    const cycle = makeCycle(async () => { throw new Error("telegram is down"); });
    const snap = realSnapshot();
    cycle.breaks(0, "field.store.save", "the disk went away");
    // Twelve cycles across an hour: at one fault each, this would fill the 200-entry ring in a day
    // with reports of its own undeliverability, burying the original.
    for (let i = 1; i <= 12; i++) await cycle.run(i * 5 * MINUTE, snap);
    const undeliverable = cycle.faults.since(0).filter((f) => f.where === "alert.undeliverable");
    console.log(`  12 failed cycles recorded ${undeliverable.length} undeliverable fault(s)`);
    expect(undeliverable.length).toBeLessThanOrEqual(1);
  });
});

describe("a problem that keeps happening keeps being reported", () => {
  it("re-alerts a persisting fault instead of mentioning it once and going quiet", async () => {
    const sent: string[] = [];
    const cycle = makeCycle(async (t) => { sent.push(t); });
    const snap = realSnapshot();

    // It keeps failing, every cycle, for a day.
    for (let i = 1; i <= 24; i++) {
      cycle.breaks(i * HOUR - 1, "field.store.save", "the disk is still gone");
      await cycle.run(i * HOUR, snap);
    }
    console.log(`  a day of continuous failure produced ${sent.length} alerts`);
    expect(sent.length, "once would mean he stops hearing about a live failure").toBeGreaterThan(1);
    expect(sent.length, "and every cycle would be spam").toBeLessThan(24);
  });

  it("treats it as news again once it has cleared and come back", async () => {
    const sent: string[] = [];
    const cycle = makeCycle(async (t) => { sent.push(t); });
    const snap = realSnapshot();

    cycle.breaks(500, "field.store.save", "first");
    await cycle.run(1_000, snap);
    await cycle.run(2_000, snap); // clear
    cycle.breaks(2_500, "field.store.save", "again");
    await cycle.run(3_000, snap);

    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("again");
  });
});

describe("what he is told carries enough to act on", () => {
  it("does not collapse ten different failures into one detail", async () => {
    const sent: string[] = [];
    const cycle = makeCycle(async (t) => { sent.push(t); });
    const snap = realSnapshot();
    for (const where of ["field.store.save", "agency.moment", "guard.home-boundary"]) {
      cycle.breaks(500, where, `${where} broke`);
    }
    await cycle.run(1_000, snap);
    console.log(`  three failures at once: ${sent[0]}`);
    // Every distinct source is named, even though only one detail is quoted.
    for (const where of ["field.store.save", "agency.moment", "guard.home-boundary"]) {
      expect(sent[0]).toContain(where);
    }
  });
});

describe("safe mode answers the failures that warrant it", () => {
  it("a critical fault now enters safe mode, and an ordinary warning does not", () => {
    const snap = realSnapshot();
    const faults = createFaultLog(200);
    faults.record("field.store.save", new Error("the disk went away"), "critical");
    const bad = planReaction(detectAnomalies([{ ...snap, newFaults: faults.since(0) }]));
    expect(bad.enterSafeMode, "the most general 'something broke badly' signal must be able to trigger it").toBe(true);

    const warned = createFaultLog(200);
    warned.record("field.told", new Error("a claim would not parse"), "warn");
    const ok = planReaction(detectAnomalies([{ ...snap, newFaults: warned.since(0) }]));
    expect(ok.enterSafeMode, "and an ordinary warning must not").toBe(false);
  });

  it("her life stopping enters safe mode", () => {
    const w = createRealWorld();
    liveOrdinaryDays(w, 12);
    w.advance(8 * HOUR); // past the stall bound, which moved 3h → 6h on 2026-09-04
    const r = planReaction(detectAnomalies([w.capture()]));
    expect(r.enterSafeMode).toBe(true);
  });
});

describe("a broken messenger may never look like a broken watchtower (2026-09-06)", () => {
  const daemon = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");

  it("PLANTED: every watchtower push goes through the delivery-classed guard", () => {
    const at = daemon.indexOf("async function tellHim(");
    expect(at, "the watchtower's push guard is gone").toBeGreaterThan(-1);
    expect(daemon.slice(at, at + 400)).toContain('faultLog.record("alert.undeliverable", err, "critical")');
    // The cycle's own body must not push directly any more: a throw there lands in the cycle's
    // catch, is filed as `vitals.cycle`, and that name is NOT excused by the burst rule, which
    // is how a network outage muted her four times in one night.
    const monitorStart = daemon.indexOf("async function runVitalsMonitor(");
    // Up to the guard's own doc comment, not past it: `tellHim` naturally contains the one
    // remaining `notifier.push` in this region, and framing it as a violation would be the
    // scanner reading its own fix as the defect.
    const monitorEnd = daemon.indexOf("A BROKEN MESSENGER MAY NEVER LOOK LIKE", monitorStart);
    const body = daemon.slice(monitorStart, monitorEnd);
    expect(body.includes("notifier.push("), "a raw push is back inside the watchtower cycle").toBe(false);
    expect(body).toContain("await tellHim({");
  });

  it("delivery failures stay out of the burst, so an outage cannot mute her", () => {
    const w = createRealWorld();
    liveOrdinaryDays(w, 12);
    const reading = w.capture();
    const faults = ["alert.undeliverable", "notifier.send", "telegram.sendMessage"].map((where, i) => ({
      ts: 1000 + i, where, detail: "Network request for 'sendMessage' failed!", severity: "critical" as const,
    }));
    const r = planReaction(detectAnomalies([{ ...reading, newFaults: faults }]));
    expect(r.enterSafeMode, "a broken wire to him silenced her").toBe(false);
  });
});
