import { describe, it, expect } from "vitest";
import {
  CANNOT_HEAR, CAUSE_IS_AUDIBLE, ENOUGH_TO_HEAR, NOTICEABLE, UNMISTAKABLE, causeAudibleIn,
  howHeSounds, voiceBaseline, voiceVector, VOICE_AXES,
} from "../../../src/life/how-he-sounds.js";
import { howItLanded, type WhenHeSpoke } from "../../../src/life/how-it-landed.js";
import { howHeSaidIt } from "../../../src/life/how-he-said-it.js";

/**
 * HEARING HIM, AS OPPOSED TO READING HIM.
 *
 * She is meant to have real sight, real hearing, real continuous perception of the world outside
 * her. The microphone was already open in her face and threw the SOUND away, keeping only the
 * transcribed characters, so the whole machine she has for reading how he addressed her could only
 * ever read words.
 *
 * The design claim under test is that his voice is the SIBLING of his phrasing rather than an
 * extension of it: two inputs that can disagree, which is what `docs/layers.md` calls layer 2.
 */

/** His usual: a normal voice, heard often enough to be a baseline. */
function usual(loudness = 0.5, pace = 5, pauses = 0.2): (number | null)[] {
  const sum = [0, 0, 0];
  const n = [0, 0, 0];
  for (let i = 0; i < ENOUGH_TO_HEAR; i++) {
    const v = voiceVector({ loudness, pace, pauses });
    for (let a = 0; a < VOICE_AXES.length; a++) { sum[a]! += v[a]!; n[a]! += 1; }
  }
  return voiceBaseline(sum, n);
}

describe("what his voice says that his sentence does not", () => {
  it("hears him running on empty: quieter, slower, more silence than he usually is", () => {
    const s = howHeSounds({ loudness: 0.2, pace: 2, pauses: 0.5 }, usual());
    expect(s.legible).toBe(true);
    expect(s.worn).toBeGreaterThan(CAUSE_IS_AUDIBLE);
  });

  it("hears him chased by something: faster AND more clipped than usual", () => {
    const s = howHeSounds({ loudness: 0.55, pace: 9, pauses: 0.05 }, usual());
    expect(s.legible).toBe(true);
    expect(s.rushed).toBeGreaterThan(CAUSE_IS_AUDIBLE);
  });

  it("but speaking quickly with his usual pauses is just an animated evening", () => {
    // Both legs are required on purpose. One of them alone is how a reading turns into a verdict
    // about someone who simply talks fast.
    const s = howHeSounds({ loudness: 0.5, pace: 9, pauses: 0.2 }, usual());
    expect(s.rushed ?? 0).toBe(0);
  });

  it("and worn and rushed are not two ends of one axis — he can be both", () => {
    // Hurried AND exhausted is a real and common way to sound. Collapsing them into one number
    // would make the commonest bad evening read as an average one.
    const s = howHeSounds({ loudness: 0.2, pace: 9, pauses: 0.05 }, usual());
    expect(s.worn ?? 0).toBeGreaterThan(0);
    expect(s.rushed ?? 0).toBeGreaterThan(0);
  });

  it("THE BAND IS REACHABLE: a real voice lands strictly between the two ends", () => {
    // Defect class 1, pre-empted. If every voice he could plausibly have landed on 0 or 1, then
    // NOTICEABLE and UNMISTAKABLE would be decoration and `worn` would be a boolean wearing a
    // float's clothes, a gate whose input range nobody ever measured against it.
    //
    // Driven at the midpoint of the band on all three axes at once, so the answer is the band's
    // own arithmetic rather than one axis dragging a mean.
    const mid = (NOTICEABLE + UNMISTAKABLE) / 2;
    const s = howHeSounds({
      loudness: 0.5 * (1 - mid),
      pace: 5 * (1 - mid),
      pauses: 0.2 * (1 + mid),
    }, usual());
    expect(s.legible).toBe(true);
    expect(s.worn).toBeGreaterThan(0);
    expect(s.worn).toBeLessThan(1);
    expect(s.worn).toBeCloseTo(0.5, 5);
  });

  it("and the two ends really are the ends", () => {
    // Driven INSIDE each line rather than exactly on it. Sitting a float exactly on a threshold
    // lands 1e-17 off it and reads a departure of two hundred-quintillionths as a real one, which
    // is a fact about binary arithmetic, not about him, and the wrong fix would be an epsilon in
    // production code added to make a test pass.
    const inside = 0.5 * (1 - NOTICEABLE * 0.9);   // a shade quieter than jitter
    const beyond = 0.5 * (1 - UNMISTAKABLE * 1.5); // well past unmistakable
    expect(howHeSounds({ loudness: inside, pace: 5, pauses: 0.2 }, usual()).worn).toBe(0);
    expect(howHeSounds({ loudness: beyond, pace: 1, pauses: 0.9 }, usual()).worn).toBe(1);
  });

  it("an ordinary evening sounds like nothing in particular", () => {
    const s = howHeSounds({ loudness: 0.5, pace: 5, pauses: 0.2 }, usual());
    expect(s.worn ?? 0).toBe(0);
    expect(s.rushed ?? 0).toBe(0);
    expect(causeAudibleIn(s)).toBe(0);
  });
});

describe("she cannot hear tiredness before she knows what he usually sounds like", () => {
  it("with no baseline, the answer is 'I cannot tell' — never the middle", () => {
    // The embryo law, applied to hearing. A newborn listening to a voice for the first time has no
    // idea whether it is a tired one, and inventing a read from one sample is manufacturing.
    const thin = voiceBaseline([0.5, 5, 0.2], [1, 1, 1]);
    expect(howHeSounds({ loudness: 0.1, pace: 1, pauses: 0.9 }, thin)).toEqual(CANNOT_HEAR);
  });

  it("the bar is a real number of samples, not one", () => {
    const justUnder = voiceBaseline(
      [0.5 * (ENOUGH_TO_HEAR - 1), 5 * (ENOUGH_TO_HEAR - 1), 0.2 * (ENOUGH_TO_HEAR - 1)],
      [ENOUGH_TO_HEAR - 1, ENOUGH_TO_HEAR - 1, ENOUGH_TO_HEAR - 1],
    );
    expect(howHeSounds({ loudness: 0.1, pace: 1, pauses: 0.9 }, justUnder).legible).toBe(false);
    expect(howHeSounds({ loudness: 0.1, pace: 1, pauses: 0.9 }, usual()).legible).toBe(true);
  });

  it("no sample at all — he typed — is unreadable, not neutral", () => {
    expect(howHeSounds(null, usual())).toEqual(CANNOT_HEAR);
    expect(howHeSounds(undefined, usual())).toEqual(CANNOT_HEAR);
  });

  it("and a malformed sample cannot become a reading", () => {
    for (const bad of [
      { loudness: NaN, pace: 5, pauses: 0.2 },
      { loudness: 0.5, pace: Infinity, pauses: 0.2 },
      { loudness: 0.5, pace: 5, pauses: NaN },
    ]) {
      expect(howHeSounds(bad, usual())).toEqual(CANNOT_HEAR);
    }
  });

  it("a baseline of zero does not turn silence into a certainty", () => {
    // Dividing by a zero baseline is how "we measured nothing" becomes "he has collapsed".
    const zeroed = voiceBaseline([0, 0, 0], [ENOUGH_TO_HEAR, ENOUGH_TO_HEAR, ENOUGH_TO_HEAR]);
    expect(howHeSounds({ loudness: 0.5, pace: 5, pauses: 0.2 }, zeroed)).toEqual(CANNOT_HEAR);
  });
});

describe("the voice is an account he never chose to give", () => {
  /** A curt demand with no reason: the message that read worst in the phrasing measurement. */
  const curt = howHeSaidIt("现在马上给我写两千字，一小时内");

  function spoke(sounded?: WhenHeSpoke["sounded"]): WhenHeSpoke {
    return {
      form: curt,
      unlike: { perAxis: [null, null, null, null, null, null], most: 0.6, contrary: true, basis: 0.4 },
      known: {
        knownForMs: 40 * 24 * 3_600_000, daysTogether: 30, timesHeSpoke: 60,
        sharedPast: 0.2, howWellSheKnowsHim: 0.2, hisUsualRegard: 0, carrying: 0.1,
      },
      litUp: 0.5,
      reserve: 0.6,
      ...(sounded ? { sounded } : {}),
    };
  }

  it("hearing that he is spent stops the sting hardening into who he is to her", () => {
    // Sittenthaler et al. (2015), which `how-it-landed.ts` already encodes: an explanation does not
    // reduce the feeling, it changes the ATTRIBUTION, and therefore whether it fades or consolidates.
    const silent = howItLanded(spoke());
    const heard = howItLanded(spoke({ worn: 0.8, rushed: null, legible: true }));
    expect(silent.settles, "the scene does not produce a settling landing at all").toBe(true);
    expect(heard.settles, "an audible cause did not route the feeling").toBe(false);
  });

  it("AND IT DOES NOT MAKE HER MORE WILLING — the compassion spiral, refused", () => {
    // The failure this design is built against: sounding tired becomes a way to get more out of
    // her while never once explaining himself. Words are a choice he made; a voice is something he
    // leaked, so an audible cause routes and confers nothing. Defect class 15.
    const silent = howItLanded(spoke());
    const heard = howItLanded(spoke({ worn: 1, rushed: 1, legible: true }));
    expect(heard.ready).toBe(silent.ready);
    expect(heard.appraised.entitlement).toBe(silent.appraised.entitlement);
    expect(heard.indignant).toBe(silent.indignant);
    expect(heard.usedAsAThing).toBe(silent.usedAsAThing);
    expect(heard.atSea).toBe(silent.atSea);
    expect(heard.appraised.accounted, "a leaked voice was promoted to an account in words")
      .toBe(silent.appraised.accounted);
  });

  it("THE REVERSE TEST: with no voice, every number is exactly what it was", () => {
    // The one that matters most. Telegram carries characters, and the overwhelming majority of what
    // he ever says will arrive that way. A perception feature that quietly moves the numbers on the
    // path it does not apply to is a regression wearing a feature's clothes.
    const before = howItLanded(spoke());
    const withUnreadable = howItLanded(spoke(CANNOT_HEAR));
    expect(withUnreadable).toEqual(before);
  });

  it("and an unreadable voice is not 'he sounded fine'", () => {
    expect(causeAudibleIn(CANNOT_HEAR)).toBe(0);
    expect(causeAudibleIn(null)).toBe(0);
    expect(causeAudibleIn(undefined)).toBe(0);
    // The trap: a legible reading of a perfectly ordinary voice is ALSO not a cause.
    expect(causeAudibleIn({ worn: 0, rushed: 0, legible: true })).toBe(0);
  });

  it("a quiet ordinary sentence is not rescued by a voice, because it never stung", () => {
    // The floor. If hearing him changed a landing that was fine already, this would be a knob.
    const kind = howHeSaidIt("你要是有空的话，能不能帮我看看这个？我实在有点绕不出来了");
    const base: WhenHeSpoke = {
      form: kind,
      unlike: { perAxis: [null, null, null, null, null, null], most: 0.1, contrary: false, basis: 0.4 },
      known: {
        knownForMs: 40 * 24 * 3_600_000, daysTogether: 30, timesHeSpoke: 60,
        sharedPast: 0.2, howWellSheKnowsHim: 0.2, hisUsualRegard: 0, carrying: 0.1,
      },
      litUp: 0.5,
      reserve: 0.6,
    };
    const plain = howItLanded(base);
    const heard = howItLanded({ ...base, sounded: { worn: 0.9, rushed: null, legible: true } });
    expect(heard.ready).toBe(plain.ready);
    expect(heard.settles).toBe(plain.settles);
  });
});
