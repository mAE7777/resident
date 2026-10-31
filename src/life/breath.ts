// The breath: where one reply becomes two or three messages, the way a person actually texts.
//
// S-4'S SECOND HALF. A person at a keyboard does not deliver a wall; a thought gets its own
// message, a beat falls between them. Today her longest reply arrives as one block, however
// alive its insides are: the ONE channel property that reads as machine regardless of the
// words. The breath is a DELIVERY property, not a content property: it belongs to the channel
// (the Telegram bridge), her history and her memory keep the whole reply as one thing she
// said, and the face's mouth keeps its own segmentation untouched.
//
// THE LAW, from the design's constitution: SPLIT ONLY, at boundaries the text already has.
// Concatenating the delivered segments must reproduce the composed reply byte for byte,
// planted-reply tests assert exactly that. No segment ever ends mid-sentence, no character is
// added or removed, and a reply too short to breathe goes as one message, which is most of
// them.
//
// THE UNIT IS HERS. How much goes in one message follows her state (breath-unit arithmetic in
// the daemon): keyed up runs short and quick, weary runs even shorter, a settled ordinary
// evening lets a thought run longer. The cap (`MAX_SEGMENTS`) keeps a reply from becoming a
// drumroll: it said "three" here for a long time while the constant was four.

import { sentencesOf } from "./register-scissors.js";

/** The most messages one reply may become. Two beats is breathing; six is a machine gun. */
export const MAX_SEGMENTS = 4;

/** Under this multiple of the unit, a reply does not split at all. */
const ONE_BREATH = 1.6;

/**
 * Split a finished reply into delivery segments at sentence boundaries.
 *
 * Greedy: sentences pack into a segment until the unit is reached, then a new segment starts;
 * everything past the segment cap folds into the last. Join of the result is byte-identical
 * to the input, always.
 */
export function breathe(text: string, unitChars: number): string[] {
  const unit = Math.max(24, unitChars);
  if (text.length <= unit * ONE_BREATH) return [text];
  const sentences = sentencesOf(text);
  if (sentences.length <= 1) return [text];

  const segments: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current.length >= unit && segments.length < MAX_SEGMENTS - 1) {
      segments.push(current);
      current = "";
    }
    current += sentence;
  }
  if (current) segments.push(current);
  return segments;
}

export interface BreathState {
  /** capacity.reserveOf, 0..1. */
  reserve: number;
  /** PAD arousal, -1..1. */
  arousal: number;
}

/**
 * How much goes in one message, from her state.
 *
 * RECALIBRATED against a corpus of real chat messages: the first band [70, 220] came from intuition about essays, and the corpus says a
 * natural chat bubble is far smaller, one thought-unit, with anything over ~40 characters
 * already reading as marked. The band is now [30, 110]: an ordinary evening breathes around
 * 60-90 visible characters per message, keyed up runs toward 30-40, and a long single block
 * remains AVAILABLE at the top of the band because the corpus itself says the monoblock is a
 * real register with a real meaning (serious business), just not the default. The tension the
 * ledger names, a four-bubble cap against the natural bubbling of a truly long thought, is
 * resolved toward the cap on purpose: a drumroll of eight messages is machine again.
 */
export function breathUnitFor(s: BreathState): number {
  const arousal01 = Math.max(0, Math.min(1, (s.arousal + 1) / 2));
  const base = 45 + 65 * Math.max(0, Math.min(1, s.reserve));
  const quickness = 1 - 0.35 * arousal01;
  return Math.round(Math.max(30, Math.min(110, base * quickness)));
}

/**
 * The beat between two messages, in milliseconds.
 *
 * A person's follow-on message does not arrive the instant the first lands; the gap is the
 * typing of it. So the pause reads as composition time for what is ABOUT to arrive: longer
 * before a long thought, never so long the conversation stalls. Only ever BETWEEN segments,
 * the first arrives as fast as today, so the breath adds no latency he can feel to the reply
 * itself, which is the design's standing constraint.
 */
export function pauseBefore(nextSegment: string): number {
  return Math.min(1_200, 250 + Math.round(nextSegment.trim().length * 8));
}
