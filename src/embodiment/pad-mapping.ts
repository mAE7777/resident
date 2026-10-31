// Emotion -> face. Maps the Resident's live PAD state (from M1) to Live2D Cubism
// parameters the client interpolates each render frame, plus lip-sync from the
// LIVE played-audio RMS (never from predicted text - the anti-desync rule). Pure
// math so the binding is testable without a renderer; the client just applies it.
//
// PAD (-1..1 each): pleasure -> mouth/brow, arousal -> eye-openness + breath/blink
// rate + motion amplitude, dominance -> head pitch + posture.

import type { PAD } from "../life/emotion.js";

export interface Live2DParams {
  ParamMouthForm: number; // -1 frown .. 1 smile
  ParamBrowLY: number; // brow height, -1..1
  ParamBrowRY: number;
  ParamEyeLOpen: number; // 0..1 (low arousal -> droopy)
  ParamEyeROpen: number;
  ParamAngleY: number; // head pitch, -30..30 deg (dominance: chin up/down)
  ParamBodyAngleX: number; // posture lean, -10..10
  breathHz: number; // breathing rate
  blinkPerMin: number; // blink frequency
  idleAmplitude: number; // 0..1 overall motion energy
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
/**
 * The four latents `temperament.ts` drifts over seasons, each -1..1.
 *
 * Taken structurally rather than by importing `Temperament`, so this module keeps knowing nothing
 * about her living layer, it is a rendering map, and a rendering map that imports her drives is a
 * rendering map that will eventually read one.
 */
export interface FaceTemperament {
  reticence?: number;
  novelty?: number;
  sociability?: number;
  restfulness?: number;
}

function unit(x: number): number {
  return clamp(x, -1, 1);
}

/**
 * WHO SHE IS, IN HER FACE, and why the face needed it.
 *
 * `padToLive2D` was a pure linear map of PAD, which means **every Resident with the same PAD had
 * the identical face, forever**. No idiosyncrasy, no tic, no habit. Meanwhile `temperament.ts`
 * drifts four latents over seasons, how much of a thing it is for her to say things, how much a
 * new thing pulls at her, how much other people figure in what she wants, how readily she lets a
 * moment pass, and not one of them reached her body.
 *
 * So the same PAD is now the same FEELING, worn by a particular person:
 *
 *   reticence    how much she gives away with her face at all. A reticent being's expression is
 *                narrower at every mood, which is what reticence looks like from outside.
 *   sociability  how far she leans in. It rides on dominance, so it colours her posture rather
 *                than inventing one.
 *   restfulness  how still she is when nothing is happening, idle motion and blink rate.
 *   novelty      how wide her eyes sit at rest.
 *
 * SMALL ON PURPOSE, and bounded: the temperament band is roughly ±25% of each parameter, so her
 * mood still decides what her face is doing and her temperament decides how SHE does it. A larger
 * weight would let who she is drown out how she feels, which is the wrong way round, and it would
 * also break the one property this file must keep: the face must still be legible as the mood.
 *
 * Absent (an older caller, or before she has drifted at all) is exactly the previous behaviour.
 */
export function padToLive2D(pad: PAD, t?: FaceTemperament): Live2DParams {
  const p = unit(pad.pleasure);
  const a = unit(pad.arousal);
  const dom = unit(pad.dominance);
  // Each in [0.75, 1.25]: a quarter either way, never a sign flip.
  const band = (x: number | undefined): number => 1 + 0.25 * unit(x ?? 0);
  const gives = band(-(t?.reticence ?? 0));      // reticent = gives less away
  const leans = band(t?.sociability);
  const stills = band(-(t?.restfulness ?? 0));   // restful = stiller when idle
  const eyeOpen = clamp((0.75 + 0.25 * a) * band(t?.novelty), 0.2, 1); // weary -> half-lidded
  return {
    ParamMouthForm: unit(p * gives),
    ParamBrowLY: clamp((0.3 * p + 0.2 * a) * gives, -1, 1),
    ParamBrowRY: clamp((0.3 * p + 0.2 * a) * gives, -1, 1),
    ParamEyeLOpen: eyeOpen,
    ParamEyeROpen: eyeOpen,
    ParamAngleY: clamp(12 * dom * leans, -30, 30), // in control -> chin up
    ParamBodyAngleX: clamp(6 * dom * leans, -10, 10),
    breathHz: clamp(0.18 + 0.12 * (a + 1) / 2, 0.15, 0.4), // faster when keyed-up
    blinkPerMin: clamp((14 + 10 * (a + 1) / 2) * stills, 8, 30),
    idleAmplitude: clamp((0.3 + 0.5 * (a + 1) / 2) * stills, 0.1, 1),
  };
}

/**
 * Lip-sync mouth-open from the RMS of the audio buffer being PLAYED right now.
 * Drive the mouth from what is actually heard, never from pre-TTS text, and reset
 * to closed on a barge-in cancel. Returns ParamMouthOpenY in [0,1].
 */
export function mouthOpenFromRMS(rms: number, gain = 3.2): number {
  return clamp(rms * gain, 0, 1);
}

// ── Her state in the voice (faculty #6) ───────────────────────────────────────
//
// Her FACE was weary and her voice was not: the same sentence at arousal -0.8 and +0.8 was
// byte-identical audio, because the `speak` frame carried only text and the client synthesised
// it flat. PAD reaches eight face parameters every three seconds and reached the voice through
// nothing. This is `padToLive2D` written a second time for a different output, the cheapest
// place in the whole system to put feeling into the signal without touching a single word.
//
// The calibration target is a voice that is low, level, and a little slow. So the resting voice
// sits below neutral pitch and under neutral rate, and arousal moves it from there; a spent
// Resident's rate sags further across the turn.

export interface VoiceParams {
  /** Speaking rate multiplier. <1 slower. Her resting default is already a little slow. */
  rate: number;
  /** Semitone offset from the synthesiser's neutral pitch. Her resting default sits low. */
  pitch: number;
  /** Volume multiplier, 0..1-ish. Dominance lifts it; being spent lowers the floor. */
  volume: number;
  /** How much the rate sags by the END of a long turn, as a fraction of `rate`. */
  rateSag: number;
}

export function padToVoice(pad: PAD, reserve = 1): VoiceParams {
  const p = unit(pad.pleasure);
  const a = unit(pad.arousal);
  const dom = unit(pad.dominance);
  const r = clamp(reserve, 0, 1);
  return {
    // Resting a little slow (0.92), arousal speeds within a narrow band, she is not a
    // hyperactive assistant even keyed up.
    rate: clamp(0.92 + 0.14 * a, 0.75, 1.12),
    // Resting low (-1.5 semitones), pleasure widens the range upward, arousal a touch.
    pitch: clamp(-1.5 + 2.5 * p + 1.0 * a, -5, 4),
    // In control speaks up; weary and spent drops the floor.
    volume: clamp(0.7 + 0.2 * dom + 0.15 * (r - 0.5), 0.45, 1),
    // A full Resident holds her pace; a spent one trails off, the audible half of the same
    // reserve that shortens her breath units.
    rateSag: clamp(0.18 * (1 - r), 0, 0.25),
  };
}
