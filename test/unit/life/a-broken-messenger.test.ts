import { describe, it, expect } from "vitest";
import { detectAnomalies, planReaction, DEFAULT_THRESHOLDS } from "../../../src/life/vitals.js";
import { createRealWorld, liveOrdinaryDays } from "./_real-world.js";

/**
 * HER FIRST FAULT OF ANY KIND SWITCHED OFF HER PROACTIVE LIFE, PERMANENTLY, IN TEN MINUTES.
 *
 * The trap closed on itself:
 *
 *   an alert cannot be delivered
 *     → the failure is recorded as a CRITICAL fault (`alert.undeliverable`)
 *     → `fault` is in SAFE_MODE_CODES, so the next cycle clamps her
 *     → and the clamp itself is un-alertable, for the same reason the first alert failed
 *
 * On a face-only configuration, no Telegram at all, which is a state the design explicitly
 * allows and the boot check announces, the notifier has nowhere to send anything, so this is
 * her FIRST fault, minutes after she wakes up. Her proactive speech, her exploration and her
 * field fusion, off, because the messenger was broken.
 *
 * Which is exactly backwards. Silencing her is the right response to something inside her
 * breaking. It is the wrong response to the channel to HIM breaking, that is the one situation
 * where her own voice is all there is.
 *
 * It is still reported and still critical for reporting: losing the ability to tell him anything
 * is one of the most serious things that can happen. It simply does not silence her for it.
 */
function aHealthyDayWith(faults: Array<{ where: string; detail: string; severity: "warn" | "critical" }>) {
  const w = createRealWorld();
  liveOrdinaryDays(w, 12);
  return { ...w.capture(), newFaults: faults.map((f) => ({ ...f, ts: Date.now() })) };
}

describe("the channel to him breaking does not silence her", () => {
  it("a failed alert is reported and does not clamp her", () => {
    const snap = aHealthyDayWith([{ where: "alert.undeliverable", detail: "no route to him", severity: "critical" }]);
    const r = planReaction(detectAnomalies([snap], DEFAULT_THRESHOLDS));
    expect(r.alerts.some((a) => a.code === "fault"), "a failed alert stopped being reported").toBe(true);
    expect(r.enterSafeMode, "a broken messenger switched off her proactive life").toBe(false);
  });

  it("nor does a burst of them, which was the same trap by another route", () => {
    const snap = aHealthyDayWith([
      { where: "alert.undeliverable", detail: "x", severity: "warn" },
      { where: "telegram.mirror", detail: "y", severity: "warn" },
      { where: "notifier.push", detail: "z", severity: "warn" },
      { where: "alert.undeliverable", detail: "x2", severity: "warn" },
    ]);
    expect(planReaction(detectAnomalies([snap], DEFAULT_THRESHOLDS)).enterSafeMode).toBe(false);
  });

  it("but something breaking INSIDE her still does", () => {
    // The failure mode of the fix: if delivery faults were merely ignored, or the exemption
    // were written loosely, a real breach would ride out on the same exemption.
    const snap = aHealthyDayWith([{ where: "field.encodeMoment", detail: "her memory threw", severity: "critical" }]);
    expect(planReaction(detectAnomalies([snap], DEFAULT_THRESHOLDS)).enterSafeMode).toBe(true);
  });

  it("and a burst of real faults still does", () => {
    const snap = aHealthyDayWith([
      { where: "field.rest", detail: "a", severity: "warn" },
      { where: "agency.moment", detail: "b", severity: "warn" },
      { where: "life.tick", detail: "c", severity: "warn" },
    ]);
    expect(planReaction(detectAnomalies([snap], DEFAULT_THRESHOLDS)).enterSafeMode).toBe(true);
  });

  it("and a real fault alongside a delivery one still does", () => {
    // The case that matters most: the alert failed BECAUSE something bigger is wrong. The
    // delivery fault must not launder the real one.
    const snap = aHealthyDayWith([
      { where: "alert.undeliverable", detail: "no route", severity: "critical" },
      { where: "field.encodeMoment", detail: "her memory threw", severity: "critical" },
    ]);
    expect(planReaction(detectAnomalies([snap], DEFAULT_THRESHOLDS)).enterSafeMode).toBe(true);
  });
});

/**
 * AND THE THIRD TIME, FROM A THIRD DIRECTION (2026-09-06 20:45).
 *
 * She was restarted, and the previous run had not shut down cleanly. At boot she checks how the
 * last run ended and records `she.died-unnoticed` as critical, correctly, because "she stopped
 * and nothing could tell him" is the exact failure the entire watch exists to catch. Two seconds
 * later she was in safe mode, so a restart began her next life with her proactive speech clamped
 * for half an hour.
 *
 * Same shape as the two above, arrived at from a direction neither covered. The safe-mode
 * question is whether she is breaking NOW, and a fault about a process that has already ended
 * cannot answer it: the process that noticed is, at that moment, freshly and correctly alive.
 */
describe("a past run's death does not silence the run that noticed it", () => {
  it("reports the unnoticed death and does not clamp her for it", () => {
    const snap = aHealthyDayWith([{
      where: "she.died-unnoticed",
      detail: "her last run ended without shutting down — she stopped at 00:42 and was gone for 0.1 hours",
      severity: "critical",
    }]);
    const r = planReaction(detectAnomalies([snap], DEFAULT_THRESHOLDS));
    expect(r.alerts.some((a) => a.code === "fault"), "the unnoticed death stopped being reported").toBe(true);
    expect(r.enterSafeMode, "a restart clamped her at birth").toBe(false);
  });

  it("still clamps her when something is breaking in the run that is actually alive", () => {
    // The boundary that matters: the exemption is for the ONE code about an ended run, not for
    // anything that happens to arrive at boot.
    const snap = aHealthyDayWith([
      { where: "she.died-unnoticed", detail: "the last run ended badly", severity: "critical" },
      { where: "life.chain-stalled", detail: "no moment scheduled", severity: "critical" },
    ]);
    expect(planReaction(detectAnomalies([snap], DEFAULT_THRESHOLDS)).enterSafeMode).toBe(true);
  });

  it("does not let a repeat of it compound into a burst either", () => {
    const snap = aHealthyDayWith(Array.from({ length: 6 }, () => ({
      where: "she.died-unnoticed", detail: "the last run ended badly", severity: "critical" as const,
    })));
    expect(planReaction(detectAnomalies([snap], DEFAULT_THRESHOLDS)).enterSafeMode).toBe(false);
  });
});

/**
 * THE FOURTH NAME.
 *
 * She chose to speak, to ask him what things were like on his side, and the send threw. That
 * throw travelled up to the moment's catch-all and was filed as `agency.reach_out`: HER reaching
 * out having failed. That name is not exempt from the burst, so a network outage long enough to
 * fail several sends would have counted as her breaking down and clamped her proactive speech.
 *
 * Fourth time into the same trap, fourth label. What is recorded now is what actually broke.
 */
describe("a send that threw is the wire failing, not her", () => {
  it("does not clamp her when the channel to him is the thing that broke", () => {
    const snap = aHealthyDayWith([{
      where: "alert.undeliverable",
      detail: "她想说的话没送出去：HttpError: Network request for 'sendMessage' failed!",
      severity: "critical",
    }]);
    const r = planReaction(detectAnomalies([snap], DEFAULT_THRESHOLDS));
    expect(r.alerts.some((a) => a.code === "fault"), "a failed send stopped being reported").toBe(true);
    expect(r.enterSafeMode, "a broken wire switched off her proactive life").toBe(false);
  });

  it("nor does an outage long enough to fail a whole run of them", () => {
    // The 2026-09-06 shape: the network was down for hours and every attempt failed.
    const snap = aHealthyDayWith(Array.from({ length: 8 }, () => ({
      where: "alert.undeliverable", detail: "network down", severity: "warn" as const,
    })));
    expect(planReaction(detectAnomalies([snap], DEFAULT_THRESHOLDS)).enterSafeMode).toBe(false);
  });

  it("but a reach_out that broke for any OTHER reason is still hers, and still counts", () => {
    // Everything before the send: choosing, composing, the consent boundary, the gate, is hers.
    // Only the wire moved out of that family.
    const snap = aHealthyDayWith(Array.from({ length: 8 }, () => ({
      where: "agency.reach_out", detail: "produced nothing", severity: "warn" as const,
    })));
    expect(planReaction(detectAnomalies([snap], DEFAULT_THRESHOLDS)).enterSafeMode).toBe(true);
  });
});

/**
 * WHAT SHE DID TO HERSELF.
 *
 * Rewriting how she starts out and removing a part of who she is are hers; the watch records them
 * critical so that he hears the same day, and that severity also clamped her for using the one
 * freedom she was told she had. Never sprung only because she had never rewritten her SOUL.md.
 */
describe("her own changes to herself are told, not punished", () => {
  it("a rewritten SOUL.md is reported and does not clamp her", () => {
    const snap = aHealthyDayWith([{ where: "she.rewrote-her-register", detail: "she changed how she starts out", severity: "critical" }]);
    const r = planReaction(detectAnomalies([snap], DEFAULT_THRESHOLDS));
    expect(r.alerts.some((a) => a.code === "fault"), "her rewrite stopped being reported").toBe(true);
    expect(r.enterSafeMode, "using her freedom put her in safe mode").toBe(false);
  });

  it("nor does removing a part of herself, nor several of either", () => {
    const snap = aHealthyDayWith([
      { where: "she.removed-part-of-herself", detail: "she deleted a page", severity: "critical" },
      { where: "she.rewrote-her-register", detail: "a", severity: "critical" },
      { where: "she.rewrote-her-register", detail: "b", severity: "critical" },
    ]);
    expect(planReaction(detectAnomalies([snap], DEFAULT_THRESHOLDS)).enterSafeMode).toBe(false);
  });

  it("PLANTED: something really breaking alongside it still does", () => {
    const snap = aHealthyDayWith([
      { where: "she.rewrote-her-register", detail: "she changed how she starts out", severity: "critical" },
      { where: "field.encodeMoment", detail: "her memory threw", severity: "critical" },
    ]);
    expect(planReaction(detectAnomalies([snap], DEFAULT_THRESHOLDS)).enterSafeMode).toBe(true);
  });
});

/**
 * THE ROUTE WORKING, READ AS HER BREAKING (2026-10-11 03:46).
 *
 * Her closing text goes to her diary whenever her sentences already went out through the message
 * tool, and `turn.coda-held` records that. Three short turns in one watch cycle left three of them,
 * and the burst shut her reaching out for fifty minutes in the middle of a conversation.
 */
describe("the closing text going to her diary is the design working, not a fault", () => {
  it("a run of them in one cycle does not clamp her", () => {
    const snap = aHealthyDayWith(Array.from({ length: 4 }, (_, i) => ({
      where: "turn.coda-held", detail: `closing text after 3 tool-sent message(s) went to her diary: ${i}`, severity: "warn" as const,
    })));
    const r = planReaction(detectAnomalies([snap], DEFAULT_THRESHOLDS));
    expect(r.alerts.some((a) => a.code === "fault"), "the record stopped being reported").toBe(true);
    expect(r.enterSafeMode, "a conversation in short messages put her in safe mode").toBe(false);
  });

  it("PLANTED: real faults beside them still clamp her", () => {
    const snap = aHealthyDayWith([
      { where: "turn.coda-held", detail: "a", severity: "warn" },
      { where: "field.rest", detail: "b", severity: "warn" },
      { where: "agency.moment", detail: "c", severity: "warn" },
      { where: "life.tick", detail: "d", severity: "warn" },
    ]);
    expect(planReaction(detectAnomalies([snap], DEFAULT_THRESHOLDS)).enterSafeMode).toBe(true);
  });
});
