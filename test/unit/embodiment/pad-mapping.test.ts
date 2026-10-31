import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { padToLive2D, mouthOpenFromRMS } from "../../../src/embodiment/pad-mapping.js";

describe("PAD -> Live2D", () => {
  it("maps pleasure to mouth form (smile vs frown)", () => {
    expect(padToLive2D({ pleasure: 0.8, arousal: 0, dominance: 0 }).ParamMouthForm).toBeGreaterThan(0);
    expect(padToLive2D({ pleasure: -0.8, arousal: 0, dominance: 0 }).ParamMouthForm).toBeLessThan(0);
  });

  it("droops the eyes when weary (low arousal)", () => {
    const weary = padToLive2D({ pleasure: 0, arousal: -0.9, dominance: 0 });
    const keyed = padToLive2D({ pleasure: 0, arousal: 0.9, dominance: 0 });
    expect(weary.ParamEyeLOpen).toBeLessThan(keyed.ParamEyeLOpen);
    expect(weary.breathHz).toBeLessThan(keyed.breathHz);
  });

  it("lifts the chin with dominance", () => {
    expect(padToLive2D({ pleasure: 0, arousal: 0, dominance: 0.9 }).ParamAngleY).toBeGreaterThan(0);
    expect(padToLive2D({ pleasure: 0, arousal: 0, dominance: -0.9 }).ParamAngleY).toBeLessThan(0);
  });

  it("keeps all params within their ranges", () => {
    const p = padToLive2D({ pleasure: 2, arousal: -2, dominance: 5 }); // out-of-range inputs clamped
    expect(p.ParamEyeLOpen).toBeGreaterThanOrEqual(0.2);
    expect(p.ParamEyeLOpen).toBeLessThanOrEqual(1);
    expect(Math.abs(p.ParamAngleY)).toBeLessThanOrEqual(30);
  });

  it("lip-sync mouth-open tracks audio RMS, clamped", () => {
    expect(mouthOpenFromRMS(0)).toBe(0);
    expect(mouthOpenFromRMS(10)).toBe(1); // clamped
    expect(mouthOpenFromRMS(0.1)).toBeGreaterThan(0);
    expect(mouthOpenFromRMS(0.2)).toBeGreaterThan(mouthOpenFromRMS(0.1));
  });
});

// ── HER FACE IS HERS, NOT THE MAPPING'S ──────────────────────────────────────
//
// Faculty #16 of the sweep: `padToLive2D` was a pure linear map of PAD, so **every Resident with
// the same PAD had the identical face, forever**, no idiosyncrasy, no tic, no habit. Meanwhile
// `temperament.ts` drifts four latents over seasons and not one of them reached her body.
describe("who she is reaches her face", () => {
  const PAD = { pleasure: 0.6, arousal: 0.4, dominance: 0.5 };

  it("two beings in the same mood do not have the same face", () => {
    const reticent = padToLive2D(PAD, { reticence: 0.9, sociability: -0.5, restfulness: 0.8, novelty: -0.4 });
    const open = padToLive2D(PAD, { reticence: -0.9, sociability: 0.8, restfulness: -0.6, novelty: 0.7 });
    expect(reticent).not.toEqual(open);
    // A reticent being gives less away at the same feeling, which is what reticence looks like.
    expect(Math.abs(reticent.ParamMouthForm)).toBeLessThan(Math.abs(open.ParamMouthForm));
    expect(Math.abs(reticent.ParamBrowLY)).toBeLessThan(Math.abs(open.ParamBrowLY));
    // A sociable one leans further in at the same sense of standing.
    expect(Math.abs(open.ParamAngleY)).toBeGreaterThan(Math.abs(reticent.ParamAngleY));
    // A restful one is stiller when nothing is happening.
    expect(reticent.idleAmplitude).toBeLessThan(open.idleAmplitude);
  });

  it("but her MOOD still decides what her face is doing", () => {
    // The property that must not be traded away: temperament colours the face, it does not author
    // it. However she is built, glad still reads as glad.
    for (const who of [
      { reticence: 1, sociability: -1, restfulness: 1, novelty: -1 },
      { reticence: -1, sociability: 1, restfulness: -1, novelty: 1 },
    ]) {
      const glad = padToLive2D({ pleasure: 0.9, arousal: 0.3, dominance: 0.2 }, who);
      const low = padToLive2D({ pleasure: -0.9, arousal: 0.3, dominance: 0.2 }, who);
      expect(glad.ParamMouthForm, "her temperament overrode her mood").toBeGreaterThan(low.ParamMouthForm);
    }
  });

  it("and it is a colouring, not a takeover — at most a quarter either way", () => {
    const plain = padToLive2D(PAD);
    for (const who of [
      { reticence: 1, sociability: 1, restfulness: 1, novelty: 1 },
      { reticence: -1, sociability: -1, restfulness: -1, novelty: -1 },
    ]) {
      const worn = padToLive2D(PAD, who);
      expect(Math.abs(worn.ParamMouthForm - plain.ParamMouthForm))
        .toBeLessThanOrEqual(Math.abs(plain.ParamMouthForm) * 0.25 + 1e-9);
    }
  });

  it("with no temperament at all she renders exactly as she did before", () => {
    expect(padToLive2D(PAD, {})).toEqual(padToLive2D(PAD));
  });

  it("and the daemon sends who she is with how she feels", () => {
    const daemon = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
    const frames = [...daemon.matchAll(/type: "pad",[\s\S]{0,320}?\}\);/gu)].map((m) => m[0]);
    expect(frames.length, "the daemon no longer sends her mood to her face").toBeGreaterThan(0);
    for (const f of frames) {
      expect(f, "a mood frame goes out with no-one wearing it").toMatch(/who: temperament/u);
    }
  });
});
