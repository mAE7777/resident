import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createProviderPulse } from "../../../src/providers/pulse.js";
import type { LLMProvider, LLMRequest, LLMResponse } from "../../../src/providers/types.js";
import { detectAnomalies, planReaction, DEFAULT_THRESHOLDS } from "../../../src/life/vitals.js";
import { createRealWorld, liveOrdinaryDays } from "../life/_real-world.js";

/**
 * THE VENDOR'S SILENCE IS NOT HER MOMENT HANGING.
 *
 * Once the model service answered nothing for half an hour. Two of her moments ran out
 * their ten-minute deadline inside that half hour, each was filed as `agency.moment.hung` at
 * critical, and each put her into safe mode. The pulse tells the two apart; the vitals exemption
 * keeps the vendor's failures from silencing her.
 */

const MIN = 60_000;
const WINDOW = 10 * MIN;
const ok: LLMResponse = { id: "r", content: [{ type: "text", text: "嗯" }], model: "m", stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };

/** A provider whose calls stay out until the test settles them. */
function heldProvider() {
  const pending: Array<{ resolve: (r: LLMResponse) => void; reject: (e: unknown) => void }> = [];
  const p: LLMProvider = {
    complete: () => new Promise<LLMResponse>((resolve, reject) => { pending.push({ resolve, reject }); }),
  };
  return { p, pending };
}

const req: LLMRequest = { model: "m", maxTokens: 10, messages: [] };

describe("the pulse", () => {
  it("a call that has owed an answer for half the window, still out, is the vendor's silence", async () => {
    let now = 0;
    const pulse = createProviderPulse(() => now);
    const { p } = heldProvider();
    void pulse.wrap(p).complete(req);
    now = 4 * MIN;
    expect(pulse.silent(now, WINDOW)).toBe(false);
    now = 5 * MIN;
    expect(pulse.silent(now, WINDOW)).toBe(true);
    expect(pulse.owedMs(now)).toBe(5 * MIN);
  });

  it("the outage shape: attempts that time out one after another add up to one silence", async () => {
    let now = 0;
    const pulse = createProviderPulse(() => now);
    const { p, pending } = heldProvider();
    const wrapped = pulse.wrap(p);
    for (let attempt = 0; attempt < 4; attempt++) {
      const call = wrapped.complete(req).catch(() => undefined);
      now += 2 * MIN; // the provider's own 120s abort
      pending.shift()!.reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
      await call;
      now += 2_000; // the retry layer's pause: no call is out
    }
    expect(pulse.silent(now, WINDOW), "the pause between attempts hid the silence").toBe(true);
  });

  it("a reply clears it, and so does an error with an HTTP status (the vendor was there)", async () => {
    let now = 0;
    const pulse = createProviderPulse(() => now);
    const { p, pending } = heldProvider();
    const wrapped = pulse.wrap(p);
    const first = wrapped.complete(req);
    now = 6 * MIN;
    pending.shift()!.resolve(ok);
    await first;
    expect(pulse.silent(now, WINDOW)).toBe(false);
    expect(pulse.owedMs(now)).toBe(0);

    const second = wrapped.complete(req).catch(() => undefined);
    now = 12 * MIN;
    pending.shift()!.reject(Object.assign(new Error("429"), { status: 429 }));
    await second;
    expect(pulse.silent(now, WINDOW)).toBe(false);
  });

  it("a tool that hung for most of the window is still hers: the call that followed is seconds old", async () => {
    let now = 0;
    const pulse = createProviderPulse(() => now);
    const { p, pending } = heldProvider();
    const wrapped = pulse.wrap(p);
    const first = wrapped.complete(req);
    now = 10_000;
    pending.shift()!.resolve(ok);
    await first;
    now = 9.5 * MIN; // the tool hangs from 0:10 to 9:30
    void wrapped.complete(req);
    now = WINDOW;
    expect(pulse.silent(now, WINDOW)).toBe(false);
  });

  it("an old unanswered attempt with nothing asked since is not a vendor holding up a moment", async () => {
    let now = 0;
    const pulse = createProviderPulse(() => now);
    const { p, pending } = heldProvider();
    const call = pulse.wrap(p).complete(req).catch(() => undefined);
    now = MIN;
    pending.shift()!.reject(new Error("fetch failed"));
    await call;
    now = WINDOW; // nine minutes of something else
    expect(pulse.silent(now, WINDOW)).toBe(false);
  });

  it("passes the reply and the error through untouched", async () => {
    const pulse = createProviderPulse();
    await expect(pulse.wrap({ complete: async () => ok }).complete(req)).resolves.toBe(ok);
    const boom = new Error("boom");
    await expect(pulse.wrap({ complete: async () => { throw boom; } }).complete(req)).rejects.toBe(boom);
  });
});

function aHealthyDayWith(faults: Array<{ where: string; detail: string; severity: "warn" | "critical" }>) {
  const w = createRealWorld();
  liveOrdinaryDays(w, 12);
  return { ...w.capture(), newFaults: faults.map((f) => ({ ...f, ts: Date.now() })) };
}

describe("the vendor's failures do not silence her", () => {
  it("a stall, its empty replies and its tool syntax are reported and do not clamp her", () => {
    const snap = aHealthyDayWith([
      { where: "provider.stalled", detail: "answered nothing for 10m", severity: "warn" },
      { where: "provider.emptyRetry", detail: "empty", severity: "warn" },
      { where: "provider.tool-markup", detail: "markup", severity: "warn" },
      { where: "provider.notProse", detail: "html", severity: "warn" },
      { where: "provider.stalled", detail: "again", severity: "warn" },
    ]);
    const r = planReaction(detectAnomalies([snap], DEFAULT_THRESHOLDS));
    expect(r.alerts.some((a) => a.code === "fault"), "the vendor's failures stopped being reported").toBe(true);
    expect(r.enterSafeMode).toBe(false);
  });

  it("PLANTED: her moment hanging for any other reason still does", () => {
    const snap = aHealthyDayWith([{ where: "agency.moment.hung", detail: "a moment did not finish", severity: "critical" }]);
    expect(planReaction(detectAnomalies([snap], DEFAULT_THRESHOLDS)).enterSafeMode).toBe(true);
  });

  it("the daemon counts every provider the factory makes and asks the pulse at the deadline (text pins)", () => {
    const daemon = readFileSync(join(process.cwd(), "src", "index.ts"), "utf8");
    for (const token of [
      "const providerPulse = createProviderPulse();",
      "? counted(createOpenAICompatibleProvider(apiKey, {",
      ": counted(createAnthropicProvider(apiKey, { baseURL: config.llm.baseUrl }));",
      "const vendorSilent = providerPulse.silent(now, MOMENT_DEADLINE_MS);",
      'faultLog.record("provider.stalled"',
      'faultLog.record("agency.moment.hung"',
    ]) {
      expect(daemon.includes(token), `index.ts lost: ${token}`).toBe(true);
    }
  });
});
