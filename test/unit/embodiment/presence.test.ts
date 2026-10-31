import { describe, it, expect } from "vitest";
import { derivePresence, type PresenceSignals } from "../../../src/embodiment/presence.js";

function sig(p: Partial<PresenceSignals>): PresenceSignals {
  return { idleSeconds: 0, frontAppFocused: true, dndOrFocus: false, screenSharing: false, micActive: false, ...p };
}

describe("presence tiers", () => {
  it("is idle and not present when Eric is away", () => {
    const s = derivePresence(sig({ idleSeconds: 600 }));
    expect(s.tier).toBe("idle");
    expect(s.present).toBe(false);
  });

  it("is speakup when present, available, and focused here", () => {
    const s = derivePresence(sig({ idleSeconds: 5, frontAppFocused: true }));
    expect(s.tier).toBe("speakup");
    expect(s.present).toBe(true);
    expect(s.available).toBe(true);
  });

  it("drops to ambient (not available) under Focus/DND", () => {
    const s = derivePresence(sig({ idleSeconds: 5, dndOrFocus: true }));
    expect(s.tier).toBe("ambient");
    expect(s.available).toBe(false);
  });

  it("backs off when the mic is active (likely a meeting)", () => {
    expect(derivePresence(sig({ idleSeconds: 5, micActive: true })).available).toBe(false);
  });

  it("is backchannel when present+available but focused elsewhere", () => {
    const s = derivePresence(sig({ idleSeconds: 5, frontAppFocused: false }));
    expect(s.tier).toBe("backchannel");
  });

  it("an opt-in camera-present signal counts as present even when idle", () => {
    const s = derivePresence(sig({ idleSeconds: 600, cameraPresent: true }));
    expect(s.present).toBe(true);
  });
});
