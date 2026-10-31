import { describe, it, expect } from "vitest";
import { encodeFace, decodeClient, type FaceMessage } from "../../../src/embodiment/protocol.js";

describe("mind<->face protocol", () => {
  it("encodes a face PAD message", () => {
    const m: FaceMessage = { type: "pad", pleasure: 0.2, arousal: -0.1, dominance: 0.3, ts: 123 };
    expect(JSON.parse(encodeFace(m))).toEqual(m);
  });

  it("decodes valid client messages", () => {
    expect(decodeClient(JSON.stringify({ type: "interrupt" }))).toEqual({ type: "interrupt" });
    expect(decodeClient(JSON.stringify({ type: "reply", text: "hi" }))).toEqual({ type: "reply", text: "hi" });
    const pres = decodeClient(JSON.stringify({ type: "presence", signals: { idleSeconds: 3, dndOrFocus: true } }));
    expect(pres?.type).toBe("presence");
    if (pres?.type === "presence") {
      expect(pres.signals.idleSeconds).toBe(3);
      expect(pres.signals.dndOrFocus).toBe(true);
      expect(pres.signals.micActive).toBe(false); // defaulted
    }
  });

  it("drops malformed or untrusted frames", () => {
    expect(decodeClient("not json")).toBeNull();
    expect(decodeClient(JSON.stringify({ type: "reply" }))).toBeNull(); // no text
    expect(decodeClient(JSON.stringify({ type: "presence", signals: {} }))).toBeNull(); // no idleSeconds
    expect(decodeClient(JSON.stringify({ type: "evil" }))).toBeNull();
    expect(decodeClient(JSON.stringify(42))).toBeNull();
  });
});
